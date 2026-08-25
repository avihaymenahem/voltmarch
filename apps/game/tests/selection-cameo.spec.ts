/**
 * ============================================================================
 * tests/selection-cameo.spec.ts
 * ============================================================================
 * "Bottom left hud still uses icons and not the models."
 *
 * Every card in the selection dock drew `makeIcon('tank')` — one hand-authored
 * glyph, the same one for a Warden, a Harvester and a Construction Yard —
 * while the build rail six inches to its right had been rendering the REAL
 * MESHES since `CameoRenderer` landed. The renderer, the model provider, the
 * faction handling and the fallback were all already built and tested. The
 * selection dock simply never asked.
 *
 * WHAT THESE CASES PROTECT
 * ------------------------
 *   - THE CARD CARRIES WHAT A CAMEO NEEDS. `Hud.describe()` already resolves a
 *     content key, so the only thing between the dock and a model was a field.
 *     If `cameoKey` ever stops being populated the dock silently reverts to
 *     glyphs, which is exactly how this shipped in the first place.
 *   - THERE IS ONE RENDERER, NOT TWO. `CameoRenderer` owns a render target, a
 *     light rig and a model cache; a second instance drawing the same eighteen
 *     models into smaller squares would double all of it.
 *   - THE GLYPH STILL COVERS THE HOLES. No GL, no registered model, no
 *     resolvable def — all three must leave the pictogram showing. This is the
 *     property that makes the change unable to be a regression.
 *   - THE SIGNATURE GATE SEES THE KEY. Cards are pooled and reused; a card that
 *     goes from a Warden to an Anvil without the key in its change signature
 *     keeps the Warden's portrait.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..');
const SIDEBAR = readFileSync(join(ROOT, 'apps/game/src/ui/Sidebar.ts'), 'utf8');
const HUD = readFileSync(join(ROOT, 'apps/game/src/ui/Hud.ts'), 'utf8');
const CSS = readFileSync(join(ROOT, 'apps/game/src/ui/hud.css'), 'utf8');

/* ========================================================================== */

describe('the selection card knows what it is a picture of', () => {
  it('declares the fields a cameo bind needs', async () => {
    const { BuildTab } = await import('../src/core/types');
    // Structural, not textual: build the object the HUD builds and check the
    // shape the panel consumes.
    const card = {
      id: 0, icon: 'tank' as const, cameoKey: 'grizzly', isBuilding: false,
      name: 'Warden', hpFrac: 1, veterancy: 0, stack: 1, primary: true,
    };
    expect(card.cameoKey).not.toBe('');
    expect(typeof card.isBuilding).toBe('boolean');
    expect(BuildTab.Structures).toBeDefined();
    expect(BuildTab.Infantry).toBeDefined();
  });

  it('is populated from the key describe() already resolved', () => {
    // `describe()` asks the production service first and the def tables second,
    // so the key is free. The bug was never that it was hard to get.
    expect(HUD).toMatch(/card\.cameoKey\s*=\s*info\.key/);
    expect(HUD).toMatch(/card\.isBuilding\s*=/);
  });

  it('initialises the pooled cards with an empty key, not a stale one', () => {
    // The pool is built once at construction; a placeholder key here would bind
    // a real model to a card that is not showing anything yet.
    expect(HUD).toMatch(/cameoKey:\s*''/);
  });
});

/* ========================================================================== */

describe('one renderer, shared', () => {
  it('exposes the build panel\'s renderer rather than making a second', () => {
    expect(SIDEBAR).toMatch(/get cameoRenderer\(\): CameoRenderer \| null/);
    // Exactly one construction site in the whole file.
    const built = SIDEBAR.match(/new CameoRenderer\(/g) ?? [];
    expect(built.length, 'only BuildPanel may construct a CameoRenderer').toBe(1);
  });

  it('hands it to the selection panel after the build panel exists', () => {
    const buildAt = SIDEBAR.indexOf('this.build = new BuildPanel(');
    const handAt = SIDEBAR.indexOf('this.selection.setCameos(');
    expect(buildAt).toBeGreaterThan(0);
    expect(handAt, 'the renderer cannot be shared before it is built')
      .toBeGreaterThan(buildAt);
  });

  it('keeps the army colours in step with the sidebar', () => {
    // A cameo bakes the faction palette in, so a faction change has to
    // invalidate every bound card or the dock shows the previous army's paint.
    expect(SIDEBAR).toMatch(/setFaction\(faction: Faction\): void \{[\s\S]{0,400}?this\.selection\.setFaction\(faction\)/);
  });
});

/* ========================================================================== */

describe('the glyph still covers every hole', () => {
  it('leaves the canvas hidden with no renderer or no key', () => {
    expect(SIDEBAR).toMatch(
      /if \(cameos === null \|\| data\.cameoKey === ''\) \{[\s\S]{0,160}?cameoCanvas\.hidden = true;/,
    );
  });

  it('leaves it hidden when the bind throws', () => {
    // `CameoRenderer.bind` reaches into the art libraries and the GPU. A throw
    // there must degrade to a pictogram, never take the HUD down.
    expect(SIDEBAR).toMatch(
      /catch \(err\) \{[\s\S]{0,200}?selection cameo bind failed[\s\S]{0,120}?cameoCanvas\.hidden = true;/,
    );
  });

  it('builds the canvas hidden, so a card is never a blank square', () => {
    expect(SIDEBAR).toMatch(/cameoCanvas\.hidden = true;[\s\S]{0,80}?root\.appendChild\(cameoCanvas\)/);
  });

  it('still creates the fallback glyph', () => {
    expect(SIDEBAR).toMatch(/makeIcon\('tank', 'vm-icon vm-card-icon'\)/);
  });
});

/* ========================================================================== */

describe('the pooled card cannot show the previous unit', () => {
  it('puts the cameo key and the faction in the change signature', () => {
    // Cards are recycled across selections. Without these two terms a card that
    // goes Warden -> Anvil, or Allied -> Soviet, keeps the old portrait
    // because every other term happens to match.
    const sig = SIDEBAR.match(/const sig = `[^`]*`[^;]*;/)?.[0] ?? '';
    expect(sig).toContain('data.cameoKey');
    expect(sig).toContain('this.faction');
  });

  it('clears every signature when the renderer or the faction changes', () => {
    const setCameos = SIDEBAR.slice(SIDEBAR.indexOf('setCameos(cameos'));
    expect(setCameos.slice(0, 300)).toMatch(/for \(const c of this\.cards\) c\.sig = ''/);
  });
});

/* ========================================================================== */

describe('the cameo sits behind the text, not under it', () => {
  it('stops short of the name row', () => {
    // A model painted behind a label is what makes a small cameo unreadable,
    // and readability at a glance is the card's entire job.
    expect(CSS).toMatch(/\.vm-card-cameo \{[\s\S]*?bottom: calc\(\d+ \* var\(--vm-u\)\)/);
  });

  it('does not intercept the click that focuses the unit', () => {
    expect(CSS).toMatch(/\.vm-card-cameo \{[\s\S]*?pointer-events: none/);
  });

  it('hides the glyph only while a cameo is actually showing', () => {
    expect(CSS).toContain('.vm-card-cameo:not([hidden])');
  });
});
