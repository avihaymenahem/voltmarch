import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..');
const HUD = readFileSync(join(ROOT, 'apps/game/src/ui/Hud.ts'), 'utf8');
const SIDEBAR = readFileSync(join(ROOT, 'apps/game/src/ui/Sidebar.ts'), 'utf8');
const INPUT = readFileSync(join(ROOT, 'apps/game/src/input/input.system.ts'), 'utf8');
const CSS = readFileSync(join(ROOT, 'apps/game/src/ui/hud-redesign.css'), 'utf8');
const COMMAND_DECK_CSS = readFileSync(join(ROOT, 'apps/game/src/ui/hud-command-deck.css'), 'utf8');

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

  it('restores the four explicit formation controls above the command deck', () => {
    for (const shape of ['line', 'box', 'wedge', 'triangle']) {
      expect(SIDEBAR).toContain(`['${shape}',`);
    }
    expect(CSS).toContain('.vm-formation-row');
    expect(INPUT).toContain('invokeHudFormation');
  });

  it('uses the centre node for match identity, not a duplicate objective', () => {
    expect(SIDEBAR).toContain("'vm-command-map'");
    expect(SIDEBAR).toContain('tele.matchMode');
    expect(SIDEBAR).toContain('tele.matchDifficulty');
    expect(SIDEBAR).toContain('tele.mapName');
    expect(SIDEBAR).not.toContain("'vm-command-objective'");
    expect(CSS).toContain('.vm-command-map');
  });

  it('gives the power meter, numbers and status badge separate columns', () => {
    expect(CSS).toMatch(
      /\.vm-res-power \.vm-power-line\s*\{[\s\S]*?display:\s*grid;[\s\S]*?grid-template-columns:[^;]*max-content;/,
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
    expect(SIDEBAR).toContain("formationRow.setAttribute('aria-label', 'Formation orders')");
    expect(CSS).toMatch(/--vm-command-h:\s*calc\(70 \* var\(--vm-u\)\)/);
    expect(CSS).toMatch(/\.vm-stance-actions \.vm-stance\s*\{[\s\S]*?width:\s*calc\(16 \* var\(--vm-u\)\)/);
    expect(CSS).toMatch(/\.vm-formation\s*\{[\s\S]*?width:\s*calc\(25 \* var\(--vm-u\)\);[\s\S]*?height:\s*calc\(15 \* var\(--vm-u\)\)/);
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

  it('uses the authored plate proportions without distorting bitmap chrome', () => {
    expect(seal).toContain('--vm-map-w: calc(286 * var(--vm-u))');
    expect(seal).toContain('--vm-map-h: calc(359 * var(--vm-u))');
    expect(seal).toContain('--vm-selection-w: calc(250 * var(--vm-u))');
    expect(seal).toContain('--vm-selection-h: calc(329 * var(--vm-u))');
    expect(seal).toContain('calc(546 * var(--vm-u))');
    expect(seal).toContain('calc(100vw - (912 * var(--vm-u)))');
    expect(seal).toContain('--vm-rail-w: calc(580 * var(--vm-u))');
  });

  it('renders a wide four-column, two-row production console', () => {
    expect(SIDEBAR).toContain("'vm-build-title'");
    expect(SIDEBAR).toContain("['ALL', 'STRUCTURES', 'DEFENSE', 'UNITS', 'SUPPORT']");
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
      'top-wing-left.png',
      'top-wing-right.png',
      'operation.png',
      'objectives.png',
      'minimap.png',
      'selection.png',
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

  it('keeps the build inventory continuous and scrollable beyond the visible eight cards', () => {
    expect(SIDEBAR).toContain('export const BUILD_ROWS = 7');
    expect(COMMAND_DECK_CSS).toMatch(/\.vm-grid\s*\{[\s\S]*?overflow-y:\s*auto/);
    expect(COMMAND_DECK_CSS).toContain('grid-template-rows: none');
    expect(COMMAND_DECK_CSS).toContain('scrollbar-color:');
  });

  it('keeps the selection cameo in its own measured track', () => {
    expect(COMMAND_DECK_CSS).toMatch(
      /\.vm-sel-body\s*\{[\s\S]*?display:\s*grid;[\s\S]*?grid-template-columns:\s*minmax\(calc\(72 \* var\(--vm-u\)\), 38%\)/,
    );
  });

  it('offers persistent resizing without letting the build default override it', () => {
    expect(SIDEBAR).toContain('new AspectPanelResize(this.root');
    expect(SIDEBAR).toContain('new AspectPanelResize(this.mapDock');
    expect(HUD).toContain('mapResized: () => this.resize(true)');
    expect(SIDEBAR).toContain("edge: 'top'");
    expect(COMMAND_DECK_CSS).not.toMatch(
      /\.vm-dock-build\.vm-height-resizable\.has-user-height\s*\{[^}]*\bheight:\s*calc\([^}]*!important/,
    );
    expect(CSS).not.toContain('.vm-dock-build.vm-height-resizable.has-user-height');
    expect(SIDEBAR).toContain('getMinWidthPx: mapMinimum');
    expect(SIDEBAR).toContain('selectionMinimum');
  });

  it('composes variable-height chrome from undistorted artwork caps', () => {
    expect(COMMAND_DECK_CSS).toMatch(
      /\.vm-dock-build\.vm-height-resizable::before\s*\{[\s\S]*?height:\s*calc\(56 \* var\(--vm-u\)\);[\s\S]*?background-size:\s*100% auto;/,
    );
    expect(COMMAND_DECK_CSS).toMatch(
      /\.vm-dock-build\.vm-height-resizable::after\s*\{[\s\S]*?height:\s*calc\(22 \* var\(--vm-u\)\);[\s\S]*?100% auto no-repeat;/,
    );
    expect(COMMAND_DECK_CSS).toMatch(
      /\.vm-objectives\.vm-height-resizable:not\(\.is-collapsed\)::before\s*\{[\s\S]*?height:\s*calc\(33 \* var\(--vm-u\)\);[\s\S]*?background-size:\s*100% auto;/,
    );
    expect(COMMAND_DECK_CSS).not.toContain('border-image-repeat: stretch round');
  });

  it('preserves generated plate ratios and the reference info grid', () => {
    expect(COMMAND_DECK_CSS).toMatch(
      /\.vm-resources::before,[\s\S]*?\.vm-resources::after\s*\{[\s\S]*?aspect-ratio:\s*899 \/ 227;[\s\S]*?background-size:\s*contain;/,
    );
    expect(COMMAND_DECK_CSS).toContain('aspect-ratio: 898 / 227;');
    expect(COMMAND_DECK_CSS).toMatch(
      /\.vm-command-deck::before\s*\{[\s\S]*?background-size:\s*100% auto;/,
    );
    expect(COMMAND_DECK_CSS).toMatch(
      /\.vm-sel-stats\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/,
    );
  });

  it('uses a dedicated horizontal asset for the empty selection state', () => {
    expect(COMMAND_DECK_CSS).toMatch(
      /\.vm-dock-selection\.is-empty::before\s*\{[\s\S]*?selection-empty\.png[\s\S]*?background-size:\s*100% auto;/,
    );
  });

  it('caps structured top wings before filling ultrawide space with neutral rails', () => {
    expect(COMMAND_DECK_CSS).toContain(
      'width: min(calc(50% - 235 * var(--vm-u)), calc(610 * var(--vm-u)))',
    );
    expect(COMMAND_DECK_CSS).toContain(
      '.vm-res-credits { left: calc(18 * var(--vm-u)); width: calc(192 * var(--vm-u)); }',
    );
  });

  it('registers the radar controls to the three authored hardware wells', () => {
    expect(COMMAND_DECK_CSS).toMatch(
      /\.vm-map-hardware\s*\{[\s\S]*?left:\s*8\.5%;[\s\S]*?right:\s*8\.5%;/,
    );
  });

  it('keeps compact layouts usable without changing the desktop target', () => {
    expect(seal).toContain('@media (max-width: 1400px)');
    expect(seal).toContain('@media (max-width: 900px)');
  });
});
