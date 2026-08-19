/**
 * HUD chrome and cameo art — the falsifiable half.
 *
 * These are the checks behind one sentence of the brief: "chrome bevels, rivets
 * and gradients must be drawn as clean shapes with crisp edges — no noise, no
 * dithering artefacts", and "give each cameo a proper miniature ... a clean
 * silhouette on a graded background with a crisp border".
 *
 * Both halves are testable without a DOM. The chrome layers are pure strings,
 * so a dithering regression is a failed regex. The cameo painter takes a 2D
 * context, so a `RecordingContext` that logs every drawing call proves the
 * picture is made of PATHS — and lets us assert that no two subjects produce
 * the same picture, which is the actual complaint the pass exists to fix.
 *
 * Runs under `environment: 'node'` like the rest of the suite: `src/ui/Cameos`
 * touches `document` only inside constructors and painters, never at import.
 */

import { describe, expect, it } from 'vitest';

import { archetypeFor, paintCameoFallback, theatreFor, type CameoSubject } from '../src/ui/Cameos';
import { boltGradient, plateSheen, sovietBrush } from '../src/ui/Chrome';
import { HUD_GRID, HUD_SKIN_ALLIES, HUD_SKIN_SOVIETS } from '../src/core/config';
import { BuildTab, Faction } from '../src/core/types';

/* ==========================================================================
 * A recording 2D context
 *
 * Implements exactly the surface the painter uses. Every call lands in `ops`
 * as a string, so two runs can be compared for determinism and two subjects
 * for distinctness. Coordinates additionally land in `points` for the
 * "nothing spills out of the cell" check.
 * ========================================================================== */

class RecordingContext {
  readonly ops: string[] = [];
  readonly points: Array<[number, number]> = [];
  readonly fills: string[] = [];

  fillStyle: string | object = '#000';
  strokeStyle: string | object = '#000';
  lineWidth = 1;
  lineJoin = 'miter';
  globalAlpha = 1;
  imageSmoothingEnabled = true;
  imageSmoothingQuality = 'low';

  private xy(x: number, y: number): void {
    this.points.push([x, y]);
  }

  private styleName(s: string | object): string {
    return typeof s === 'string' ? s : '<gradient>';
  }

  createLinearGradient(...a: number[]): { addColorStop(o: number, c: string): void } {
    this.ops.push(`linGrad(${a.map((n) => n.toFixed(2)).join(',')})`);
    return { addColorStop: (o, c) => { this.ops.push(`stop(${o},${c})`); } };
  }

  createRadialGradient(...a: number[]): { addColorStop(o: number, c: string): void } {
    this.ops.push(`radGrad(${a.map((n) => n.toFixed(2)).join(',')})`);
    return { addColorStop: (o, c) => { this.ops.push(`stop(${o},${c})`); } };
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    this.ops.push(`fillRect(${x.toFixed(2)},${y.toFixed(2)},${w.toFixed(2)},${h.toFixed(2)},${this.styleName(this.fillStyle)})`);
  }
  clearRect(): void { this.ops.push('clearRect'); }
  beginPath(): void { this.ops.push('beginPath'); }
  closePath(): void { this.ops.push('closePath'); }
  moveTo(x: number, y: number): void { this.ops.push(`moveTo(${x.toFixed(2)},${y.toFixed(2)})`); this.xy(x, y); }
  lineTo(x: number, y: number): void { this.ops.push(`lineTo(${x.toFixed(2)},${y.toFixed(2)})`); this.xy(x, y); }
  arc(x: number, y: number, r: number): void { this.ops.push(`arc(${x.toFixed(2)},${y.toFixed(2)},${r.toFixed(2)})`); this.xy(x, y); }
  ellipse(x: number, y: number, rx: number, ry: number): void {
    this.ops.push(`ellipse(${x.toFixed(2)},${y.toFixed(2)},${rx.toFixed(2)},${ry.toFixed(2)})`);
    this.xy(x, y);
  }
  fill(): void { this.ops.push(`fill(${this.styleName(this.fillStyle)})`); this.fills.push(this.styleName(this.fillStyle)); }
  stroke(): void { this.ops.push(`stroke(${this.styleName(this.strokeStyle)},${this.lineWidth.toFixed(2)})`); }
  save(): void { this.ops.push('save'); }
  restore(): void { this.ops.push('restore'); }
  translate(x: number, y: number): void { this.ops.push(`translate(${x.toFixed(2)},${y.toFixed(2)})`); }
  scale(x: number, y: number): void { this.ops.push(`scale(${x},${y})`); }
}

function ctxFor(): CanvasRenderingContext2D {
  return new RecordingContext() as unknown as CanvasRenderingContext2D;
}

function subject(over: Partial<CameoSubject> = {}): CameoSubject {
  return {
    key: 'grizzly', name: 'Warden Tank', faction: Faction.Allies,
    tab: BuildTab.Vehicles, isBuilding: false, footprintW: 0, footprintH: 0,
    ...over,
  };
}

const W = HUD_GRID.artW * 4;
const H = HUD_GRID.artH * 4;

function paint(s: CameoSubject): RecordingContext {
  const rec = new RecordingContext();
  paintCameoFallback(rec as unknown as CanvasRenderingContext2D, W, H, s);
  return rec;
}

/* ==========================================================================
 * CHROME
 * ========================================================================== */

describe('HUD chrome — clean shapes, never noise', () => {
  it('never alternates the Soviet brush on a device pixel', () => {
    // THE REGRESSION THIS FILE EXISTS FOR. The brush used to be
    // `rgba(255,255,255,0.055) 0 1px, rgba(0,0,0,0.055) 1px 2px` — a
    // full-contrast one-device-pixel stripe under an `overlay` blend, i.e.
    // per-pixel noise that dithered against the display grid at every uiScale
    // above 1. Every stop must now be expressed in DESIGN pixels.
    const brush = sovietBrush();
    expect(brush).not.toMatch(/\b\d+px\b/);
    expect(brush).toContain('var(--ra-d)');
  });

  it('keeps the brush period long and its amplitude inside a few percent', () => {
    const brush = sovietBrush();
    const stops = [...brush.matchAll(/calc\(([\d.]+) \* var\(--ra-d\)\)/g)].map((m) => Number(m[1]));
    expect(stops.length).toBeGreaterThanOrEqual(3);
    // Shortest gap between consecutive stops is the half-wavelength.
    const sorted = [...new Set([0, ...stops])].sort((a, b) => a - b);
    let minGap = Infinity;
    for (let i = 1; i < sorted.length; i++) minGap = Math.min(minGap, sorted[i] - sorted[i - 1]);
    expect(minGap).toBeGreaterThanOrEqual(2);

    const alphas = [...brush.matchAll(/rgba\(\d+,\d+,\d+,([\d.]+)\)/g)].map((m) => Number(m[1]));
    expect(alphas.length).toBeGreaterThan(0);
    expect(Math.max(...alphas)).toBeLessThanOrEqual(0.05);
  });

  it('draws the bolt head with a hard terminator and one step of anti-aliasing', () => {
    for (const skin of [HUD_SKIN_ALLIES, HUD_SKIN_SOVIETS]) {
      const bolt = boltGradient(skin);
      expect(bolt.startsWith('radial-gradient(')).toBe(true);
      // Lit from the upper-left, like every other surface in the interface.
      expect(bolt).toContain('circle at 38% 32%');
      // The rim holds the black terminator to at least 90% of the radius and
      // then fades over a few percent. A bolt that fades over 30% of its
      // radius is an airbrushed blob, not a turned steel dome.
      const hardEdge = bolt.match(/rgba\(0,0,0,0\) (\d+)%/);
      expect(hardEdge).not.toBeNull();
      expect(Number(hardEdge![1])).toBeGreaterThanOrEqual(95);
      expect(bolt).toContain(`${skin.bevelLo} 92%`);
      // Faction material swap, not a tint: the ramp is the skin's own bevel.
      expect(bolt).toContain(skin.bevelHi);
      expect(bolt).toContain(skin.metalMid);
    }
    expect(boltGradient(HUD_SKIN_ALLIES)).not.toBe(boltGradient(HUD_SKIN_SOVIETS));
  });

  it('keeps the plate sheen to a single low-frequency sweep', () => {
    const sheen = plateSheen();
    expect(sheen.startsWith('linear-gradient(')).toBe(true);
    // Not `repeating-` — one band across the plate, never a stripe pattern.
    expect(sheen).not.toContain('repeating');
    const alphas = [...sheen.matchAll(/rgba\(255,255,255,([\d.]+)\)/g)].map((m) => Number(m[1]));
    expect(Math.max(...alphas)).toBeLessThanOrEqual(0.14);
    // Stops must be monotone up then down: one hump, not a comb.
    const offsets = [...sheen.matchAll(/(\d+)%/g)].map((m) => Number(m[1]));
    for (let i = 1; i < offsets.length; i++) expect(offsets[i]).toBeGreaterThan(offsets[i - 1]);
  });
});

/* ==========================================================================
 * ARCHETYPE RESOLUTION
 * ========================================================================== */

describe('cameo archetypes — every subject gets a specific silhouette', () => {
  it('maps the franchise vocabulary onto the right silhouette', () => {
    const cases: ReadonlyArray<readonly [string, boolean, string]> = [
      ['conyard', true, 'conyard'],
      ['Construction Yard', true, 'conyard'],
      ['tesla coil', true, 'tesla'],
      ['prism tower', true, 'prism'],
      ['flak cannon', true, 'aa'],
      ['pillbox', true, 'turret'],
      ['ore refinery', true, 'refinery'],
      ['war factory', true, 'warfactory'],
      ['air force hq', true, 'helipad'],
      ['grizzly tank', false, 'tank'],
      ['apocalypse', false, 'heavyTank'],
      ['v3 launcher', false, 'artillery'],
      ['chrono miner', false, 'harvester'],
      ['attack dog', false, 'dog'],
      ['rocket trooper', false, 'rocketeer'],
      ['conscript', false, 'rifleman'],
      ['twinblade', false, 'helicopter'],
      ['destroyer', false, 'ship'],
    ];
    for (const [key, isBuilding, want] of cases) {
      const got = archetypeFor(subject({
        key, name: key, isBuilding,
        tab: isBuilding ? BuildTab.Structures : BuildTab.Vehicles,
      }));
      expect(got, key).toBe(want);
    }
  });

  it('never gives a building a unit silhouette, or the reverse', () => {
    // "Naval yard" and "destroyer" share a keyword; the class flag decides.
    expect(archetypeFor(subject({ key: 'navalyard', name: 'Naval Yard', isBuilding: true, tab: BuildTab.Structures })))
      .not.toBe('ship');
    expect(archetypeFor(subject({ key: 'destroyer', name: 'Destroyer', isBuilding: false })))
      .toBe('ship');
    // "Missile silo" is a structure; "rocket trooper" is not.
    expect(archetypeFor(subject({ key: 'nukesilo', name: 'Nuclear Missile', isBuilding: true, tab: BuildTab.Structures })))
      .toBe('superweapon');
  });

  it('falls back by class rather than to one shared blob', () => {
    expect(archetypeFor(subject({ key: 'zzz', name: 'Unknown', isBuilding: true, tab: BuildTab.Defense }))).toBe('turret');
    expect(archetypeFor(subject({ key: 'zzz', name: 'Unknown', isBuilding: true, tab: BuildTab.Structures }))).toBe('depot');
    expect(archetypeFor(subject({ key: 'zzz', name: 'Unknown', isBuilding: false, tab: BuildTab.Infantry }))).toBe('rifleman');
    expect(archetypeFor(subject({ key: 'zzz', name: 'Unknown', isBuilding: false, tab: BuildTab.Vehicles }))).toBe('tank');
  });

  it('maps biome names onto the four authored theatres', () => {
    expect(theatreFor('desert')).toBe('desert');
    expect(theatreFor('arctic')).toBe('snow');
    expect(theatreFor('city')).toBe('urban');
    expect(theatreFor(null)).toBe('temperate');
    expect(theatreFor('something-else')).toBe('temperate');
  });
});

/* ==========================================================================
 * THE PAINTER
 * ========================================================================== */

describe('cameo painter — a drawn miniature, not a grey box', () => {
  const SAMPLES: ReadonlyArray<readonly [string, boolean, BuildTab]> = [
    ['conyard', true, BuildTab.Structures],
    ['power plant', true, BuildTab.Structures],
    ['ore refinery', true, BuildTab.Structures],
    ['barracks', true, BuildTab.Structures],
    ['war factory', true, BuildTab.Structures],
    ['radar dome', true, BuildTab.Structures],
    ['battle lab', true, BuildTab.Structures],
    ['nuclear missile', true, BuildTab.Structures],
    ['ore silo', true, BuildTab.Structures],
    ['air force hq', true, BuildTab.Structures],
    ['service depot', true, BuildTab.Structures],
    ['outpost', true, BuildTab.Structures],
    ['wall', true, BuildTab.Defense],
    ['pillbox', true, BuildTab.Defense],
    ['flak cannon', true, BuildTab.Defense],
    ['tesla coil', true, BuildTab.Defense],
    ['prism tower', true, BuildTab.Defense],
    ['grizzly tank', false, BuildTab.Vehicles],
    ['apocalypse tank', false, BuildTab.Vehicles],
    ['v3 launcher', false, BuildTab.Vehicles],
    ['ore harvester', false, BuildTab.Vehicles],
    ['ifv', false, BuildTab.Vehicles],
    ['mcv', false, BuildTab.Vehicles],
    ['harrier jet', false, BuildTab.Vehicles],
    ['twinblade', false, BuildTab.Vehicles],
    ['destroyer', false, BuildTab.Vehicles],
    ['conscript', false, BuildTab.Infantry],
    ['rocket trooper', false, BuildTab.Infantry],
    ['attack dog', false, BuildTab.Infantry],
  ];

  function sampleSubject(i: number, faction = Faction.Allies): CameoSubject {
    const [key, isBuilding, tab] = SAMPLES[i];
    return {
      key, name: key, faction, tab, isBuilding,
      footprintW: isBuilding ? 3 : 0,
      footprintH: isBuilding ? 3 : 0,
    };
  }

  it('builds every miniature out of real filled paths', () => {
    for (let i = 0; i < SAMPLES.length; i++) {
      const rec = paint(sampleSubject(i));
      // A silhouette is at least three solids and every solid is three faces,
      // so nine filled paths is a conservative floor. The old fallback drew
      // three boxes total.
      const fills = rec.ops.filter((o) => o.startsWith('fill(')).length;
      expect(fills, SAMPLES[i][0]).toBeGreaterThanOrEqual(9);
      // Every fill is preceded by a path. No image data, ever: a cameo built
      // from putImageData is a cameo that can carry per-pixel noise.
      expect(rec.ops.join('|')).not.toContain('ImageData');
    }
  });

  it('keeps every drawn point inside the cell', () => {
    for (let i = 0; i < SAMPLES.length; i++) {
      const rec = paint(sampleSubject(i));
      for (const [x, y] of rec.points) {
        expect(Number.isFinite(x) && Number.isFinite(y), SAMPLES[i][0]).toBe(true);
        expect(x, `${SAMPLES[i][0]} x`).toBeGreaterThanOrEqual(-1);
        expect(x, `${SAMPLES[i][0]} x`).toBeLessThanOrEqual(W + 1);
        expect(y, `${SAMPLES[i][0]} y`).toBeGreaterThanOrEqual(-1);
        expect(y, `${SAMPLES[i][0]} y`).toBeLessThanOrEqual(H + 1);
      }
    }
  });

  it('gives every subject a DIFFERENT picture', () => {
    // The whole complaint was twenty tiles that looked identical. If two
    // archetypes ever collapse onto the same op log, they look the same.
    const seen = new Map<string, string>();
    for (let i = 0; i < SAMPLES.length; i++) {
      const sig = paint(sampleSubject(i)).ops.join('\n');
      const clash = seen.get(sig);
      expect(clash, `${SAMPLES[i][0]} draws exactly like ${clash}`).toBeUndefined();
      seen.set(sig, SAMPLES[i][0]);
    }
  });

  it('is deterministic — same subject, byte-identical picture', () => {
    for (let i = 0; i < SAMPLES.length; i += 7) {
      const a = paint(sampleSubject(i)).ops;
      const b = paint(sampleSubject(i)).ops;
      expect(a).toEqual(b);
    }
  });

  it('repaints the whole cell in the faction material', () => {
    for (let i = 0; i < SAMPLES.length; i += 5) {
      const allied = paint(sampleSubject(i, Faction.Allies)).ops.join('\n');
      const soviet = paint(sampleSubject(i, Faction.Soviets)).ops.join('\n');
      expect(allied).not.toBe(soviet);
      // Team colour appears in the Soviet picture and the Allied blue does not.
      expect(soviet.toLowerCase()).not.toContain('#3b90f7');
    }
  });

  it('draws the crisp cell frame last, on integer-aligned rects', () => {
    const rec = paint(sampleSubject(0));
    // The final eight fills are the frame: black terminator (4), specular (2),
    // shadow (2). All are fillRect, never strokeRect, so no edge can land on a
    // half pixel.
    const tail = rec.ops.slice(-8);
    for (const op of tail) expect(op.startsWith('fillRect(')).toBe(true);
    const widths = tail.map((op) => Number(op.split(',')[2]));
    expect(widths.every((v) => Number.isFinite(v))).toBe(true);
  });

  it('scales the frame and the panel lines with the cell, not with the device', () => {
    // One design pixel per bevel zone at every uiScale: at 1x the frame is
    // 1 px, at 4x it is 4. A frame pinned to a device pixel disappears on the
    // displays we scale up for.
    const small = new RecordingContext();
    paintCameoFallback(small as unknown as CanvasRenderingContext2D, HUD_GRID.artW, HUD_GRID.artH, sampleSubject(0));
    const big = paint(sampleSubject(0));

    const firstRect = (r: RecordingContext): number =>
      Number(r.ops.slice(-8)[0].split(',')[3].replace(')', '').split(',')[0]);
    expect(firstRect(small)).toBeCloseTo(1, 5);
    expect(firstRect(big)).toBeCloseTo(4, 5);
  });

  it('sizes the generic structure from its real footprint', () => {
    // Two unknown structures of different footprints must not draw the same
    // picture — `depot` is the catch-all and it is the one most likely to be
    // used twenty times over.
    const small = paint(subject({
      key: 'zzz1', name: 'Unknown', isBuilding: true, tab: BuildTab.Structures,
      footprintW: 2, footprintH: 2,
    })).ops.join('\n');
    const large = paint(subject({
      key: 'zzz1', name: 'Unknown', isBuilding: true, tab: BuildTab.Structures,
      footprintW: 5, footprintH: 5,
    })).ops.join('\n');
    expect(small).not.toBe(large);
  });
});
