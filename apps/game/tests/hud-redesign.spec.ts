import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..');
const HUD = readFileSync(join(ROOT, 'apps/game/src/ui/Hud.ts'), 'utf8');
const SIDEBAR = readFileSync(join(ROOT, 'apps/game/src/ui/Sidebar.ts'), 'utf8');
const INPUT = readFileSync(join(ROOT, 'apps/game/src/input/input.system.ts'), 'utf8');
const CSS = readFileSync(join(ROOT, 'apps/game/src/ui/hud-redesign.css'), 'utf8');

describe('perimeter HUD composition', () => {
  it('is an explicit layout layer loaded after the base HUD', () => {
    expect(HUD.indexOf("import './hud-redesign.css'")).toBeGreaterThan(HUD.indexOf("import './hud.css'"));
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
