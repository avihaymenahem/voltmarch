import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const ROOT = join(__dirname, '..', '..', '..');
const HUD = readFileSync(join(ROOT, 'apps/game/src/ui/Hud.ts'), 'utf8');
const SIDEBAR = readFileSync(join(ROOT, 'apps/game/src/ui/Sidebar.ts'), 'utf8');
const INPUT = readFileSync(join(ROOT, 'apps/game/src/input/input.system.ts'), 'utf8');
const CSS = readFileSync(join(ROOT, 'apps/game/src/ui/hud-redesign.css'), 'utf8');
const COMMAND_DECK_CSS = readFileSync(join(ROOT, 'apps/game/src/ui/hud-command-deck.css'), 'utf8');

function pngHeader(name: string): { width: number; height: number; colorType: number } {
  const bytes = readFileSync(join(ROOT, 'apps/game/public/ui/command-deck', name));
  expect(bytes.subarray(1, 4).toString('ascii')).toBe('PNG');
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    colorType: bytes[25],
  };
}

describe('perimeter HUD composition', () => {
  it('is an explicit layout layer loaded after the base HUD', () => {
    expect(HUD.indexOf("import './hud-redesign.css'")).toBeGreaterThan(HUD.indexOf("import './hud.css'"));
    expect(HUD.indexOf("import './hud-command-deck.css'")).toBeGreaterThan(HUD.indexOf("import './hud-redesign.css'"));
    expect(HUD).toContain("this.root.dataset.layout = 'perimeter'");
  });

  it('anchors the five primary surfaces around the battlefield', () => {
    expect(CSS).toMatch(/\.vm-resources\s*\{[\s\S]*?left:\s*var\(--vm-edge\);[\s\S]*?right:\s*var\(--vm-edge\)/);
    expect(CSS).toMatch(/\.vm-dock-map\s*\{[\s\S]*?left:\s*var\(--vm-edge\);[\s\S]*?bottom:\s*var\(--vm-edge\)/);
    expect(CSS).toMatch(/\.vm-dock-build\s*\{[\s\S]*?right:\s*var\(--vm-edge\)/);
    expect(CSS).toMatch(/\.vm-objectives\s*\{[\s\S]*?left:\s*var\(--vm-edge\)/);
    expect(CSS).toMatch(/\.vm-command-deck\s*\{[\s\S]*?right:\s*var\(--vm-edge\);[\s\S]*?bottom:\s*var\(--vm-edge\)/);
  });

  it('keeps the performance overlay in the left information rail', () => {
    expect(CSS).toMatch(
      /\.vm-perf\s*\{[\s\S]*?top:\s*calc\(var\(--vm-rail-top\) \+ var\(--vm-obj-max-h\) \+ var\(--vm-panel-gap\)\);[\s\S]*?left:\s*var\(--vm-edge\)/,
    );
    expect(CSS).not.toContain("left: calc(50% - 75 * var(--vm-u))");
  });

  it('renders named production cards rather than anonymous cameos', () => {
    expect(SIDEBAR).toContain("'vm-slot-name'");
    expect(SIDEBAR).toContain('slot.nameNode.nodeValue = c.name');
    expect(CSS).toContain('.vm-slot-name');
  });

  it('keeps the four explicit formation controls with the selected group', () => {
    for (const shape of ['line', 'box', 'wedge', 'triangle']) {
      expect(SIDEBAR).toContain(`['${shape}',`);
    }
    expect(SIDEBAR).toContain("this.formationRow = el('div', 'vm-selection-formations', this.live)");
    expect(COMMAND_DECK_CSS).toContain('.vm-selection-formations');
    expect(INPUT).toContain('invokeHudFormation');
  });

  it('labels every build bay with its real category and keeps locked Powers visible', () => {
    expect(SIDEBAR).toContain(
      "const TAB_LABELS: readonly string[] = ['Structures', 'Defence', 'Infantry', 'Vehicles', 'Powers']",
    );
    expect(SIDEBAR).toContain("label(b, 'vm-tab-label', TAB_LABELS[t].toUpperCase())");
    expect(SIDEBAR).toContain("b.classList.toggle('is-locked', !this.tabVisible[t])");
    expect(SIDEBAR).not.toContain('const TAB_SHORT');
    expect(SIDEBAR).not.toContain('this.tabs[t].hidden = !on');
    expect(COMMAND_DECK_CSS).toContain(".vm-tab.is-locked");
    expect(COMMAND_DECK_CSS).toMatch(
      /@media \(max-width: 1400px\)[\s\S]*?\.vm-tab \.vm-hk\s*\{ display: none; \}/,
    );
    expect(COMMAND_DECK_CSS).toMatch(
      /\.vm-tab-label\s*\{[\s\S]*?font-size:\s*clamp\(7px, calc\(5\.25 \* var\(--vm-u\) \* var\(--vm-text-scale, 1\)\), 8px\);[\s\S]*?letter-spacing:\s*0\.02em;/,
    );
  });

  it('fits every full tab name in its 1280px artwork bay at maximum text scale', () => {
    const compactStripWidth = 372;
    const tabShares = [0.1681, 0.1327, 0.1048, 0.1146, 0.1120];
    const oldMeasuredWidths = [52, 36, 40, 39, 34];
    const oldFontSize = 8.625;
    const maxCompactFontSize = 7.875;
    const inlinePadding = 2;

    for (let i = 0; i < tabShares.length; i++) {
      const available = compactStripWidth * tabShares[i] - inlinePadding;
      const conservativeWidth = oldMeasuredWidths[i] * maxCompactFontSize / oldFontSize;
      expect(conservativeWidth).toBeLessThanOrEqual(available);
    }
  });

  it('uses the centre node for match identity, not a duplicate objective', () => {
    expect(SIDEBAR).toContain("'vm-command-map'");
    expect(SIDEBAR).toContain('tele.matchMode');
    expect(SIDEBAR).toContain('tele.matchDifficulty');
    expect(SIDEBAR).toContain('tele.mapName');
    expect(SIDEBAR).not.toContain("'vm-command-objective'");
    expect(CSS).toContain('.vm-command-map');
  });

  it('keeps the power badge beside its title and the live readout to two columns', () => {
    expect(SIDEBAR).toContain("const pHead = el('div', 'vm-power-head', pBody);");
    expect(SIDEBAR).toContain("this.stateEl = el('span', 'vm-power-state', pHead);");
    expect(CSS).toMatch(/\.vm-res-power \.vm-power-head\s*\{[\s\S]*?display:\s*flex;/);
    expect(CSS).toMatch(
      /\.vm-res-power \.vm-power-line\s*\{[\s\S]*?grid-template-columns:\s*minmax\([^;]*\) max-content;/,
    );
    expect(CSS).toMatch(/\.vm-res-power \.vm-power-value\s*\{[\s\S]*?min-width:\s*0;/);
  });

  it('puts objective tier/progress above a full-width title lane', () => {
    expect(CSS).toMatch(
      /\.vm-objectives \.vm-obj-top\s*\{[\s\S]*?display:\s*grid;[\s\S]*?grid-template-areas:[\s\S]*?'tier value'[\s\S]*?'name name'/,
    );
    expect(CSS).toMatch(/\.vm-objectives \.vm-obj-name\s*\{[\s\S]*?grid-area:\s*name;/);
    expect(CSS).toMatch(/\.vm-objectives \.vm-obj\s*\{[\s\S]*?flex:\s*0 0 auto;/);
  });

  it('keeps stance and formation orders as compact action strips', () => {
    expect(SIDEBAR).toContain("'vm-stances vm-stance-actions'");
    expect(SIDEBAR).toContain("this.formationRow.setAttribute('aria-label', 'Formation orders')");
    expect(COMMAND_DECK_CSS).toMatch(/--vm-command-h:\s*calc\(94\.5 \* var\(--vm-u\)\)/);
    expect(CSS).toMatch(/\.vm-stance-actions \.vm-stance\s*\{[\s\S]*?width:\s*calc\(16 \* var\(--vm-u\)\)/);
    expect(COMMAND_DECK_CSS).toMatch(/\.vm-selection-formations \.vm-formation\s*\{[\s\S]*?width:\s*calc\(22 \* var\(--vm-u\)\);[\s\S]*?height:\s*calc\(17 \* var\(--vm-u\)\)/);
  });

  it('gives the compact selection inspector enough room for formations and enlarged text', () => {
    expect(COMMAND_DECK_CSS).toContain('--vm-selection-w: calc(269 * var(--vm-u));');
    expect(COMMAND_DECK_CSS).toContain('--vm-selection-h: calc(210 * var(--vm-u));');
    expect(SIDEBAR).toContain(': viewport <= 1400 ? 447');
    expect(SIDEBAR).toContain(': viewport <= 1700 ? 490');
    expect(SIDEBAR).toContain(': viewport <= 1960 ? 596');
  });

  it('scrolls only the mixed-selection inventory between fixed header and formation rows', () => {
    expect(COMMAND_DECK_CSS).toMatch(
      /\.vm-dock-selection\.is-multi \.vm-sel-cards\s*\{[\s\S]*?grid-auto-flow:\s*row;[\s\S]*?grid-template-columns:\s*repeat\(3,[\s\S]*?overflow-x:\s*hidden;[\s\S]*?overflow-y:\s*auto;/,
    );
    expect(COMMAND_DECK_CSS).toMatch(
      /\.vm-selection-formations\s*\{[\s\S]*?flex:\s*0 0 auto;/,
    );
    expect(COMMAND_DECK_CSS).toMatch(
      /\.vm-sel-head\s*\{[\s\S]*?min-height:[\s\S]*?;/,
    );
    expect(COMMAND_DECK_CSS).not.toMatch(
      /\.vm-dock-selection\.is-multi \.vm-sel-live\s*\{[\s\S]*?overflow-y:\s*auto;/,
    );
  });
});

describe('command deck behavior', () => {
  for (const action of ['move', 'attack', 'guard', 'stop', 'scatter']) {
    it(`${action} is a real input-routed action`, () => {
      expect(SIDEBAR).toContain(`['${action}',`);
      expect(INPUT).toContain(`case '${action}':`);
    });
  }

  it('publishes and removes the input seam with the system lifecycle', () => {
    expect(INPUT).toContain('.__vmInputCommands = HUD_COMMAND_SERVICE');
    expect(INPUT).toContain('delete commandGlobal.__vmInputCommands');
  });
});

describe('approved command-deck skin', () => {
  const seal = COMMAND_DECK_CSS;
  const joined = COMMAND_DECK_CSS.slice(COMMAND_DECK_CSS.lastIndexOf('/* Joined radar + wide data assembly'));

  it('uses the authored plate proportions without distorting bitmap chrome', () => {
    expect(joined).toContain('--vm-map-w: calc(244 * var(--vm-u))');
    expect(joined).toContain('--vm-map-h: calc(288 * var(--vm-u))');
    expect(joined).toContain('--vm-selection-w: calc(369 * var(--vm-u))');
    expect(joined).toContain('--vm-selection-h: calc(288 * var(--vm-u))');
    expect(SIDEBAR).toContain('aspectRatio: 1571 / 738');
    expect(seal).toContain('calc(409.5 * var(--vm-u))');
    expect(seal).toContain('calc(100vw - (912 * var(--vm-u)))');
    expect(seal).toContain('--vm-rail-w: calc(580 * var(--vm-u))');
  });

  it('renders a wide four-column, two-row production console', () => {
    expect(SIDEBAR).toContain("'vm-build-title'");
    expect(SIDEBAR).toContain("['Structures', 'Defence', 'Infantry', 'Vehicles', 'Powers']");
    expect(seal).toContain('--vm-grid-cols: 4 !important');
    expect(seal).toContain('grid-template-rows: repeat(2, calc(158 * var(--vm-u)))');
  });

  it('orders the five large commands like the approved console', () => {
    const start = SIDEBAR.indexOf('const COMMAND_DECK');
    const end = SIDEBAR.indexOf('const FORMATIONS', start);
    const deck = SIDEBAR.slice(start, end);
    const actions = ['guard', 'attack', 'move', 'stop', 'scatter'];
    for (let i = 1; i < actions.length; i++) {
      expect(deck.indexOf(`['${actions[i - 1]}',`)).toBeLessThan(deck.indexOf(`['${actions[i]}',`));
    }
  });

  it('rounds live command hover, focus, and active outlines inside the authored wells', () => {
    expect(COMMAND_DECK_CSS).toMatch(
      /\.vm-command\s*\{[\s\S]*?border-radius:\s*calc\(4\.5 \* var\(--vm-u\)\);/,
    );
  });

  it('renders the authored command plate at 75% of its former desktop dimensions', () => {
    expect(COMMAND_DECK_CSS).toMatch(
      /\.vm-command-deck\s*\{[\s\S]*?height:\s*calc\(94\.5 \* var\(--vm-u\)\);[\s\S]*?container:\s*vm-command-deck \/ inline-size;/,
    );
    expect(COMMAND_DECK_CSS).toContain('background-size: 100% auto');
  });

  it('registers every command and its content stack inside the authored source wells', () => {
    expect(COMMAND_DECK_CSS).toMatch(
      /\.vm-command\s*\{[^}]*bottom:\s*5\.45cqw;[^}]*width:\s*14\.38%;[^}]*height:\s*14\.35cqw;/s,
    );
    for (const [index, left] of [
      [1, '11.73'], [2, '27.33'], [3, '42.94'], [4, '58.54'], [5, '74.15'],
    ] as const) {
      expect(COMMAND_DECK_CSS).toContain(
        `.vm-command:nth-of-type(${index}) { left: ${left}%; }`,
      );
    }
    expect(COMMAND_DECK_CSS).toMatch(
      /\.vm-command\s*\{[^}]*padding:\s*calc\(8 \* var\(--vm-u\)\)[^}]*gap:\s*calc\(5 \* var\(--vm-u\)\);/s,
    );
  });

  it('centres operation text between equal emblem and context tracks', () => {
    expect(COMMAND_DECK_CSS).toMatch(
      /grid-template-columns:\s*calc\(82 \* var\(--vm-u\)\)\s+minmax\(0, 1fr\)\s+calc\(82 \* var\(--vm-u\)\);/,
    );
  });

  it('keeps event toasts below the responsive operation bay even with perf enabled', () => {
    expect(COMMAND_DECK_CSS).toMatch(
      /\.vm-hud\[data-layout='perimeter'\] \.vm-toasts,\s*\.vm-hud\[data-layout='perimeter'\]\.vm-perf-on \.vm-toasts\s*\{[^}]*top:\s*calc\(var\(--vm-top-node-h\) \+ 24 \* var\(--vm-u\)\);[^}]*z-index:\s*13;/s,
    );
    expect(COMMAND_DECK_CSS).not.toContain(
      ".vm-hud[data-layout='perimeter'] .vm-toasts { top: calc(126 * var(--vm-u))",
    );
  });

  it('centres right-wing values beneath their instrument labels', () => {
    expect(COMMAND_DECK_CSS).toMatch(
      /:is\(\.vm-res-clock, \.vm-res-army, \.vm-res-base\)[\s\S]*?:is\(\.vm-res-label, \.vm-res-value\)[\s\S]*?text-align:\s*center;/,
    );
  });

  it('centres the complete Credits and Army readouts inside their bays', () => {
    expect(COMMAND_DECK_CSS).toMatch(
      /\.vm-resources > :is\(\.vm-res-credits, \.vm-res-army\)\s*\{\s*justify-content:\s*center;/,
    );
    expect(COMMAND_DECK_CSS).toMatch(
      /\.vm-resources > :is\(\.vm-res-credits, \.vm-res-army\) \.vm-res-body\s*\{[\s\S]*?align-items:\s*center;[\s\S]*?text-align:\s*center;/,
    );
    expect(COMMAND_DECK_CSS).toMatch(
      /\.vm-res-credits \.vm-credit-line\s*\{\s*justify-content:\s*center;/,
    );
  });

  it('mounts the operation bay outside the clipped resource armour', () => {
    expect(SIDEBAR).toContain("const command = el('section', 'vm-command-node', parent)");
    expect(SIDEBAR).not.toContain("const command = el('section', 'vm-command-node', this.root)");
    expect(SIDEBAR).toContain("'vm-command-pips'");
  });

  it('uses neutral gunmetal cameos and a real multi-plane material skin', () => {
    expect(COMMAND_DECK_CSS).toContain('--deck-shell-0:');
    expect(COMMAND_DECK_CSS).toContain('--deck-mint:');
    expect(COMMAND_DECK_CSS).toContain('--deck-violet:');
    expect(COMMAND_DECK_CSS).toContain('--deck-amber:');
    expect(COMMAND_DECK_CSS).toContain('.vm-map-hardware');
    expect(SIDEBAR).toContain("'vm-map-hardware'");
  });

  it('ships state-neutral standalone chrome plates with real live state above them', () => {
    const plates = [
      'top-wing-left-wide.png',
      'top-wing-right-wide.png',
      'operation.png',
      'objectives.png',
      'radar-dock-v2.png',
      'selection-wide-v2.png',
      'selection-empty.png',
      'commands.png',
      'build.png',
    ];
    for (const plate of plates) {
      expect(COMMAND_DECK_CSS).toContain(`url('/ui/command-deck/${plate}')`);
      expect(existsSync(join(ROOT, 'apps/game/public/ui/command-deck', plate))).toBe(true);
    }
    expect(COMMAND_DECK_CSS).not.toContain("url('/ui/command-deck-chrome-v2.png')");
    expect(COMMAND_DECK_CSS).toContain('.vm-command.is-active');
    expect(COMMAND_DECK_CSS).toContain('.vm-tab.is-active');
  });

  it('ships the joined components as matched-height RGBA plates', () => {
    expect(pngHeader('radar-dock-v2.png')).toEqual({ width: 625, height: 738, colorType: 6 });
    expect(pngHeader('selection-wide-v2.png')).toEqual({ width: 946, height: 738, colorType: 6 });
  });

  it('keeps the joined component apertures truly transparent', async () => {
    const alphaAt = async (name: string, x: number, y: number): Promise<number> => {
      const { data, info } = await sharp(join(ROOT, 'apps/game/public/ui/command-deck', name))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      return data[(y * info.width + x) * 4 + 3] ?? 255;
    };
    expect(await alphaAt('radar-dock-v2.png', 300, 300)).toBe(0);
    expect(await alphaAt('radar-dock-v2.png', 180, 660)).toBe(0);
    expect(await alphaAt('selection-wide-v2.png', 450, 300)).toBe(0);
    expect(await alphaAt('selection-wide-v2.png', 450, 665)).toBe(0);
  });

  it('separates every complete HUD shell from the battlefield with one black halo', () => {
    expect(COMMAND_DECK_CSS).toContain('--vm-shell-outer-glow:');
    expect(COMMAND_DECK_CSS).toContain('rgba(0, 0, 0, 0.92)');
    for (const shell of [
      'vm-resources', 'vm-command-node', 'vm-objectives', 'vm-dock-map',
      'vm-dock-selection', 'vm-command-deck', 'vm-dock-build', 'vm-perf',
      'vm-toast', 'vm-super-row',
    ]) {
      expect(COMMAND_DECK_CSS).toContain(`.${shell}`);
    }
    expect(COMMAND_DECK_CSS).toContain('filter: var(--vm-shell-outer-glow);');
  });

  it('keeps the build inventory continuous and scrollable beyond the visible eight cards', () => {
    expect(SIDEBAR).toContain('export const BUILD_ROWS = 7');
    expect(COMMAND_DECK_CSS).toMatch(/\.vm-grid\s*\{[\s\S]*?overflow-y:\s*auto/);
    expect(COMMAND_DECK_CSS).toContain('grid-template-rows: none');
    expect(COMMAND_DECK_CSS).toContain('scrollbar-color:');
  });

  it('keeps the selection cameo in its own measured track', () => {
    expect(joined).toMatch(
      /\.vm-sel-body\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, calc\(82 \* var\(--vm-u\)\)\) minmax\(0, 1fr\);/,
    );
  });

  it('turns a multi-selection into a type-card overview without stats', () => {
    expect(SIDEBAR).toContain("this.root.classList.toggle('is-multi', multi)");
    expect(SIDEBAR).toContain('this.infoNode.hidden = multi');
    expect(SIDEBAR).toContain('this.hpRoot.hidden = multi');
    expect(HUD).toContain('if (sel.count === 1)');
    expect(joined).toMatch(
      /\.vm-dock-selection\.is-multi \.vm-sel-info,[\s\S]*?\.vm-dock-selection\.is-multi \.vm-sel-hp\s*\{\s*display:\s*none;/,
    );
    expect(joined).toMatch(/grid-template-columns:\s*repeat\(3, calc\(72 \* var\(--vm-u\)\)\);/);
    expect(joined).toMatch(/grid-auto-flow:\s*row;/);
  });

  it('offers persistent resizing without letting the build default override it', () => {
    expect(SIDEBAR).toContain('new AspectPanelResize(this.joinedDocks');
    expect(SIDEBAR).not.toContain('new AspectPanelResize(this.mapDock');
    expect(SIDEBAR).not.toContain('new AspectPanelResize(this.root');
    expect(SIDEBAR).toContain('JOINED_PANEL_SIZE_KEY');
    expect(HUD).toContain('mapResized: () => this.resize(true)');
    expect(SIDEBAR).toContain("edge: 'top'");
    expect(COMMAND_DECK_CSS).not.toMatch(
      /\.vm-dock-build\.vm-height-resizable\.has-user-height\s*\{[^}]*\bheight:\s*calc\([^}]*!important/,
    );
    expect(CSS).not.toContain('.vm-dock-build.vm-height-resizable.has-user-height');
    expect(SIDEBAR).toContain('getMinWidthPx: joinedMinimum');
    expect(COMMAND_DECK_CSS).toMatch(
      /\.vm-radar-selection-group\s*\{[\s\S]*?grid-template-columns:\s*var\(--vm-map-w\) var\(--vm-selection-w\);[\s\S]*?gap:\s*0;/,
    );
  });

  it('composes variable-height chrome from undistorted artwork caps', () => {
    expect(COMMAND_DECK_CSS).toMatch(
      /\.vm-dock-build\.vm-height-resizable::before\s*\{[\s\S]*?height:\s*var\(--vm-build-cap-h\);[\s\S]*?background-size:\s*100% auto;/,
    );
    expect(COMMAND_DECK_CSS).toContain('--vm-build-cap-h: calc(58 * var(--vm-u))');
    expect(COMMAND_DECK_CSS).toContain('--vm-build-cap-h: calc(40 * var(--vm-u))');
    expect(COMMAND_DECK_CSS).toContain('--vm-build-cap-h: calc(29 * var(--vm-u))');
    expect(COMMAND_DECK_CSS).toMatch(
      /\.vm-dock-build\.vm-height-resizable::after\s*\{[\s\S]*?height:\s*calc\(22 \* var\(--vm-u\)\);[\s\S]*?100% auto no-repeat;/,
    );
    expect(COMMAND_DECK_CSS).toMatch(
      /\.vm-objectives\.vm-height-resizable:not\(\.is-collapsed\)::before\s*\{[\s\S]*?height:\s*calc\(33 \* var\(--vm-u\)\);[\s\S]*?background-size:\s*100% auto;/,
    );
    expect(COMMAND_DECK_CSS).not.toContain('border-image-repeat: stretch round');
  });

  it('clips elastic build and objective fills to their authored armour silhouettes', () => {
    expect(COMMAND_DECK_CSS).toMatch(
      /\.vm-dock-build\.vm-height-resizable\s*\{[^}]*overflow:\s*hidden;[^}]*clip-path:\s*polygon\([^}]*\)\s*!important;/s,
    );
    expect(COMMAND_DECK_CSS).toMatch(
      /\.vm-objectives\.vm-height-resizable:not\(\.is-collapsed\)\s*\{[^}]*overflow:\s*hidden;[^}]*clip-path:\s*polygon\([^}]*\)\s*!important;/s,
    );
    // Scrolling belongs to the live inventories, not to an overflowing root.
    expect(COMMAND_DECK_CSS).toMatch(/\.vm-grid\s*\{[^}]*overflow-y:\s*auto;/s);
    // The elastic middles are split into transparent-edged side rails and an
    // inset well; a single 100%-wide rectangle is the overflow regression.
    expect(COMMAND_DECK_CSS).toMatch(
      /\.vm-dock-build\.vm-height-resizable\s*\{[^}]*background-size:\s*3%[^;]*,\s*3%[^;]*,\s*94%/s,
    );
    expect(COMMAND_DECK_CSS).toMatch(
      /\.vm-objectives\.vm-height-resizable:not\(\.is-collapsed\)\s*\{[^}]*background-size:\s*5%[^;]*,\s*5%[^;]*,\s*90%/s,
    );
    expect(COMMAND_DECK_CSS).toMatch(
      /\.vm-objectives\.vm-height-resizable:not\(\.is-collapsed\)\s*\{[^}]*background-color:\s*transparent\s*!important;/s,
    );
  });

  it('preserves generated plate ratios and the reference info grid', () => {
    expect(COMMAND_DECK_CSS).toMatch(
      /\.vm-resources::before,[\s\S]*?\.vm-resources::after\s*\{[\s\S]*?aspect-ratio:\s*1475 \/ 227;[\s\S]*?background-size:\s*contain;/,
    );
    expect(COMMAND_DECK_CSS).toMatch(
      /\.vm-command-deck::before\s*\{[\s\S]*?background-size:\s*100% auto;/,
    );
    expect(COMMAND_DECK_CSS).toMatch(
      /\.vm-sel-stats\s*\{[\s\S]*?repeat\(auto-fit, minmax\(min\(100%, calc\(80 \* var\(--vm-u\) \* var\(--vm-text-scale, 1\)\)\), 1fr\)\);/,
    );
    expect(COMMAND_DECK_CSS).toMatch(
      /\.vm-stat-value\s*\{[\s\S]*?min-width:\s*0;[\s\S]*?text-overflow:\s*ellipsis;/,
    );
    expect(COMMAND_DECK_CSS).toMatch(
      /@media \(max-width: 1400px\)[\s\S]*?\.vm-sel-body\s*\{[\s\S]*?calc\(58 \* var\(--vm-u\)\)[\s\S]*?\.vm-card\s*\{[\s\S]*?width:\s*calc\(58 \* var\(--vm-u\)\);/,
    );
    expect(COMMAND_DECK_CSS).toMatch(
      /@container vm-selection \(max-width: 180px\)[\s\S]*?\.vm-stat-key\s*\{[\s\S]*?display:\s*none;/,
    );
  });

  it('uses a dedicated horizontal asset for the empty selection state', () => {
    expect(COMMAND_DECK_CSS).toMatch(
      /\.vm-dock-selection\.is-empty::before\s*\{[\s\S]*?selection-empty\.png[\s\S]*?background-size:\s*100% auto;/,
    );
  });

  it('caps structured top wings before filling ultrawide space with neutral rails', () => {
    expect(COMMAND_DECK_CSS).toContain(
      'width: min(calc(50% - 150 * var(--vm-u)), calc(610 * var(--vm-u)))',
    );
    expect(COMMAND_DECK_CSS).toContain('aspect-ratio: 1475 / 227;');
    expect(COMMAND_DECK_CSS).toContain("url('/ui/command-deck/top-wing-left-wide.png')");
    expect(COMMAND_DECK_CSS).toContain("url('/ui/command-deck/top-wing-right-wide.png')");
    expect(COMMAND_DECK_CSS).toContain(
      '--vm-wide-wing-a: min(calc(17.56% - 52.68 * var(--vm-u)), calc(214.232 * var(--vm-u)));',
    );
    expect(COMMAND_DECK_CSS).toContain(
      '--vm-wide-wing-b: min(calc(31.32% - 93.96 * var(--vm-u)), calc(382.104 * var(--vm-u)));',
    );
    expect(COMMAND_DECK_CSS).toContain(
      'width: calc(var(--vm-wide-wing-c) - var(--vm-wide-wing-b) - 18 * var(--vm-u));',
    );
    for (const cell of ['clock', 'army', 'base']) {
      expect(COMMAND_DECK_CSS).toContain(
        `.vm-resources > .vm-res.vm-res-${cell} {`,
      );
    }
    expect(COMMAND_DECK_CSS).not.toMatch(
      /\.vm-resources > \.vm-res\s*\{[^}]*right:\s*auto;/,
    );
    expect(COMMAND_DECK_CSS).toContain('right: calc(var(--vm-wide-wing-a) - 8 * var(--vm-u));');
    expect(COMMAND_DECK_CSS).toContain('padding-left: calc(8 * var(--vm-u));');
    expect(COMMAND_DECK_CSS).toMatch(
      /\.vm-resources > :is\([\s\S]*?\.vm-res-credits,[\s\S]*?\.vm-res-trend,[\s\S]*?\.vm-res-clock,[\s\S]*?\.vm-res-army[\s\S]*?\)\s*\{\s*transform:\s*translateX\(calc\(12 \* var\(--vm-u\)\)\);/,
    );
    expect(COMMAND_DECK_CSS).toContain('width: calc(2 * var(--vm-top-node-half));');
    expect(COMMAND_DECK_CSS).toMatch(
      /\[data-top-fit='tight'\] \.vm-power-state\s*\{\s*display:\s*none;/,
    );
  });

  it('registers three functional radar controls to the authored hardware wells', () => {
    expect(joined).toMatch(
      /\.vm-map-hardware\s*\{[\s\S]*?left:\s*18%;[\s\S]*?right:\s*18%;/,
    );
    expect(SIDEBAR).toContain("mapHardware.setAttribute('role', 'toolbar')");
    expect(SIDEBAR).toContain("'Centre camera on base'");
    expect(SIDEBAR).toContain("'Centre camera on selection'");
    expect(SIDEBAR).toContain("'Reset radar and selection size'");
    expect(SIDEBAR).not.toContain("mapHardware.setAttribute('aria-hidden', 'true')");
    expect(HUD).toContain('centreOnHome: () => this.cameraRig.centreOnHome()');
    expect(HUD).toContain('centreOnSelection: () => this.focusSelection()');
    expect(joined).toMatch(/\.vm-map-hardware-pod\s*\{\s*background:\s*transparent;/);
  });

  it('keeps inset opaque backings inside both transparent generated panels', () => {
    expect(joined).toMatch(
      /\.vm-dock-selection:not\(\.is-empty\)::before\s*\{[\s\S]*?z-index:\s*1;/,
    );
    expect(joined).toMatch(
      /\.vm-dock-map,[\s\S]*?\.vm-dock-selection:not\(\.is-empty\)\s*\{\s*background:\s*transparent !important;/,
    );
    expect(joined).toMatch(
      /\.vm-dock-map::after,[\s\S]*?\.vm-dock-selection:not\(\.is-empty\)::after\s*\{[\s\S]*?inset:\s*4%;[\s\S]*?background:\s*#020609;[\s\S]*?clip-path:\s*polygon\(/,
    );
  });

  it('centres and fits the empty selection advisory in a longer plate', () => {
    expect(COMMAND_DECK_CSS).toMatch(
      /\.vm-dock-selection\.is-empty\s*\{[\s\S]*?width:\s*calc\(380 \* var\(--vm-u\)\);[\s\S]*?height:\s*calc\(72 \* var\(--vm-u\)\);[\s\S]*?padding:\s*0 calc\(24 \* var\(--vm-u\)\);[\s\S]*?justify-content:\s*center;/,
    );
    expect(COMMAND_DECK_CSS).toMatch(
      /\.vm-dock-selection\.is-empty \.vm-sel-idle\s*\{[\s\S]*?width:\s*100%;[\s\S]*?height:\s*100%;[\s\S]*?gap:\s*calc\(6 \* var\(--vm-u\)\);[\s\S]*?justify-content:\s*center;[\s\S]*?font-size:\s*calc\(10\.75 \* var\(--vm-u\) \* var\(--vm-text-scale, 1\)\);/,
    );
  });

  it('registers live build controls to the authored asymmetric header bays', () => {
    expect(COMMAND_DECK_CSS).toMatch(
      /\.vm-tabs\s*\{[\s\S]*?height:\s*calc\(36 \* var\(--vm-u\)\);[\s\S]*?25\.55%[\s\S]*?16\.24%[\s\S]*?12\.79%[\s\S]*?10\.11%[\s\S]*?11\.04%[\s\S]*?10\.81%[\s\S]*?13\.46%/,
    );
    expect(COMMAND_DECK_CSS).toMatch(
      /@media \(max-width: 1400px\)[\s\S]*?\.vm-tabs\s*\{[\s\S]*?height:\s*calc\(25 \* var\(--vm-u\)\);/,
    );
    expect(COMMAND_DECK_CSS).toMatch(
      /@media \(max-width: 900px\)[\s\S]*?\.vm-tabs\s*\{[\s\S]*?height:\s*calc\(24 \* var\(--vm-u\)\);/,
    );
  });

  it('makes the complete build header a pointer island above the clipped inventory', () => {
    expect(COMMAND_DECK_CSS).toMatch(
      /\.vm-tabs\s*\{[^}]*z-index:\s*20;[^}]*isolation:\s*isolate;[^}]*pointer-events:\s*auto;/s,
    );
    expect(COMMAND_DECK_CSS).toMatch(
      /\.vm-tabs::after\s*\{[^}]*inset:\s*0;[^}]*z-index:\s*1;[^}]*pointer-events:\s*auto;/s,
    );
    expect(COMMAND_DECK_CSS).toMatch(
      /\.vm-build-body\s*\{[^}]*z-index:\s*1;[^}]*overflow:\s*hidden;[^}]*isolation:\s*isolate;/s,
    );
    expect(SIDEBAR).toContain("strip.addEventListener('pointerdown', containHeaderGesture)");
    expect(SIDEBAR).toContain('const header = this.tabStrip.getBoundingClientRect()');
  });

  it('keeps compact layouts usable without changing the desktop target', () => {
    expect(seal).toContain('@media (max-width: 1400px)');
    expect(seal).toContain('@media (max-width: 900px)');
  });
});
