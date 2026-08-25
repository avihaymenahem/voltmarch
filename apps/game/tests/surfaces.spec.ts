/**
 * ============================================================================
 * tests/surfaces.spec.ts — THE NOISE BUDGET IS ENFORCED HERE
 * ============================================================================
 * The clean generator set in `src/core/assets.ts` exists because our surfaces
 * were salt-and-pepper noise and Red Alert 3's are flat painted plastic. That
 * is a look decision, and look decisions rot silently — somebody adds "a bit
 * of grain to break it up" and six months later the roads are TV static again.
 *
 * So the rule is a test, not a comment:
 *
 *   THE ONE RULE — if per-pixel noise is visible at gameplay zoom, it is wrong.
 *
 * `checkNoiseBudget` measures the fraction of texels that disagree with BOTH
 * of their horizontal neighbours by more than half the albedo budget. That is
 * the signature of static, and it is near zero for every clean surface.
 * ============================================================================
 */

import { describe, it, expect } from 'vitest';
import {
  TextureFactory, NOISE_BUDGET, checkNoiseBudget, budgetedNoise, broadDrift,
  normalFromStructure, normalFromHeight, decalPolygons, rasterizePolygons,
  packAlbedo, CLEAN_KINDS, STRUCTURE_GRADIENT_FLOOR,
  type AnyGenParams, type TextureKind,
} from '../src/core/assets';
import { Rng } from '../src/core/math';

const SIZE = 128;

/** One representative request per clean kind, at a size the suite can afford. */
const CLEAN_CASES: ReadonlyArray<readonly [TextureKind, AnyGenParams]> = [
  ['flatPaint', { size: SIZE, colour: '#b7bd63', sheen: 0.55, wear: 1 }],
  ['panelLines', { size: SIZE, colour: '#b7bd63', scale: 4, lineWidth: 2, rivets: 12 }],
  ['asphalt', { size: SIZE, colour: '#2c2926', wear: 1 }],
  ['paving', { size: SIZE, colour: '#cbc0ae', slabW: 32, slabH: 32, variation: 0.05, wear: 1 }],
  ['cobblestone', { size: SIZE, colour: '#b8ab98', stoneSize: 16, variation: 0.05, wear: 1 }],
  ['decal', { size: SIZE, colour: '#c8202a', path: 'star5' }],
  ['brushedMetal', { size: SIZE, colour: '#9aa0a6' }],
];

describe('the noise budget', () => {
  it('caps amplitude no matter what a caller asks for', () => {
    for (let i = 0; i < 4096; i++) {
      const v = budgetedNoise(i % 64, (i / 64) | 0, 64, 1, 999, 7);
      expect(Math.abs(v)).toBeLessThanOrEqual(NOISE_BUDGET.ALBEDO + 1e-6);
    }
  });

  it('caps FREQUENCY too, so a caller cannot ask for static', () => {
    // Request a one-texel wavelength. It must be clamped to the feature floor.
    let maxAdjacent = 0;
    for (let y = 0; y < 256; y += 7) {
      for (let x = 0; x < 255; x++) {
        const a = budgetedNoise(x, y, 256, 1, NOISE_BUDGET.ALBEDO, 3);
        const b = budgetedNoise(x + 1, y, 256, 1, NOISE_BUDGET.ALBEDO, 3);
        maxAdjacent = Math.max(maxAdjacent, Math.abs(a - b));
      }
    }
    // Analytic bound for a band-limited field: amp * 2*PI / wavelength. The
    // field is built from plane waves at or below the floor frequency, so this
    // is a hard ceiling, not a sampled estimate.
    const bound = NOISE_BUDGET.ALBEDO * Math.PI * 2 / NOISE_BUDGET.MIN_FEATURE_TEXELS;
    expect(maxAdjacent).toBeLessThanOrEqual(bound);
    // ...and that ceiling is a quarter of the amplitude: it takes many texels
    // to traverse the full swing, which is the definition of "not static".
    expect(bound).toBeLessThan(NOISE_BUDGET.ALBEDO * 0.3);
  });

  it('tiles exactly, so a repeating surface has no seam', () => {
    for (let y = 0; y < 128; y += 5) {
      const a = budgetedNoise(0, y, 128, 32, NOISE_BUDGET.ALBEDO, 9);
      const b = budgetedNoise(128, y, 128, 32, NOISE_BUDGET.ALBEDO, 9);
      expect(b).toBeCloseTo(a, 6);
    }
  });

  it('broadDrift stays inside 1 +/- the albedo budget', () => {
    for (let y = 0; y < 64; y += 3) {
      for (let x = 0; x < 64; x += 3) {
        const v = broadDrift(x, y, 64, 1, 11);
        expect(v).toBeGreaterThan(1 - NOISE_BUDGET.ALBEDO - 1e-6);
        expect(v).toBeLessThan(1 + NOISE_BUDGET.ALBEDO + 1e-6);
      }
    }
  });
});

describe('clean surfaces carry no per-pixel noise', () => {
  const factory = new TextureFactory();

  for (const [kind, params] of CLEAN_CASES) {
    it(`${kind} has a near-zero speckle ratio`, () => {
      const report = checkNoiseBudget(factory.surface(kind, params));
      // 2% is already generous: the clean set scores essentially 0, while
      // unfiltered value noise scores above 50%.
      expect(report.speckleRatio).toBeLessThan(0.02);
      expect(report.ok).toBe(true);
    });
  }

  it('flat paint really is flat — no albedo step exceeds the budget', () => {
    // flatPaint has no drawn features at all, so EVERY neighbour step must be
    // inside the budget. This is the strictest statement of the one rule.
    const report = checkNoiseBudget(
      factory.surface('flatPaint', { size: SIZE, colour: '#8899aa', wear: 1 }),
    );
    expect(report.maxStep).toBeLessThan(NOISE_BUDGET.ALBEDO);
  });

  it('asphalt is flat too — the RA3 road is a painted surface', () => {
    const s = factory.surface('asphalt', { size: SIZE, colour: '#2c2926', wear: 1 });
    const report = checkNoiseBudget(s);
    expect(report.maxStep).toBeLessThan(NOISE_BUDGET.ALBEDO);
    // And its height field is EXACTLY constant, so the normal map is flat.
    for (let i = 0; i < s.height.length; i++) expect(s.height[i]).toBe(0.5);
  });

  it('the legacy generators are the ones that fail — that is why they are legacy', () => {
    const concrete = checkNoiseBudget(
      factory.surface('concrete', { size: SIZE, colorA: '#8d8d8d', colorC: '#5a5a5a', scale: 4 }),
    );
    // Documents the diagnosis. If somebody ever cleans these up, this test
    // fails loudly and should simply be deleted along with the old generator.
    expect(concrete.speckleRatio).toBeGreaterThan(0.05);
  });
});

describe('structural normals', () => {
  const n = 64;

  it('erases budget-legal drift COMPLETELY — the case that actually matters', () => {
    const height = new Float32Array(n * n);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        height[y * n + x] = 0.5 + budgetedNoise(
          x, y, n, NOISE_BUDGET.MIN_FEATURE_TEXELS, NOISE_BUDGET.HEIGHT, 77,
          NOISE_BUDGET.HEIGHT);
      }
    }
    const sx = new Float32Array(n * n), sy = new Float32Array(n * n);
    normalFromStructure(height, n, 2, sx, sy);
    // Not "small". Zero. The deadband subtracts it out entirely, so a clean
    // surface's normal map is byte-for-byte flat.
    for (let i = 0; i < n * n; i++) {
      expect(sx[i]).toBe(0);
      expect(sy[i]).toBe(0);
    }
  });

  it('damps full-contrast noise that a legacy generator would feed it', () => {
    const rng = new Rng(1234);
    const height = new Float32Array(n * n);
    for (let i = 0; i < height.length; i++) height[i] = rng.next();

    const sx = new Float32Array(n * n), sy = new Float32Array(n * n);
    const px = new Float32Array(n * n), py = new Float32Array(n * n);
    normalFromStructure(height, n, 2, sx, sy);
    normalFromHeight(height, n, 2, px, py);

    let structTilt = 0, plainTilt = 0;
    for (let i = 0; i < n * n; i++) {
      structTilt += Math.abs(sx[i]) + Math.abs(sy[i]);
      plainTilt += Math.abs(px[i]) + Math.abs(py[i]);
    }
    // Only a partial win, and deliberately asserted as such: a 1-texel spike
    // and a 2-texel groove are three times apart in frequency, so no filter
    // separates them cleanly. The real fix is not to generate the noise.
    expect(structTilt).toBeLessThan(plainTilt * 0.8);
  });

  it('keeps a real groove', () => {
    const height = new Float32Array(n * n);
    height.fill(0.5);
    // A 2-texel wide, 0.11-deep seam — the panelLines groove.
    for (let y = 0; y < n; y++) {
      height[y * n + 31] = 0.39;
      height[y * n + 32] = 0.39;
    }
    const sx = new Float32Array(n * n), sy = new Float32Array(n * n);
    normalFromStructure(height, n, 2, sx, sy);
    // Strong tilt on the groove walls...
    let wall = 0;
    for (let y = 0; y < n; y++) wall = Math.max(wall, Math.abs(sx[y * n + 30]));
    expect(wall).toBeGreaterThan(0.2);
    // ...and exactly nothing on the flat, far from it.
    expect(Math.abs(sx[10 * n + 10])).toBe(0);
    expect(Math.abs(sy[10 * n + 10])).toBe(0);
  });

  it('has a deadband well below any real feature slope', () => {
    // A 0.11 groove over 2 texels is ~0.055/texel: an order of magnitude above
    // the floor. A budgeted drift over 24 texels is ~0.0008/texel: below it.
    expect(STRUCTURE_GRADIENT_FLOOR).toBeLessThan(0.055 / 10);
    expect(STRUCTURE_GRADIENT_FLOOR).toBeGreaterThan(NOISE_BUDGET.ALBEDO / 24);
  });
});

describe('decals are crisp vector shapes', () => {
  it('a star is hard-edged: almost no partially covered texels', () => {
    const size = 256;
    const cov = new Float32Array(size * size);
    rasterizePolygons(cov, size, decalPolygons('star5'));
    let inside = 0, edge = 0;
    for (let i = 0; i < cov.length; i++) {
      if (cov[i] > 0.9) inside++;
      else if (cov[i] > 0.1) edge++;
    }
    expect(inside).toBeGreaterThan(size * size * 0.2);   // the star has area
    // One texel of antialiasing on a ~1000-texel perimeter, nothing more.
    expect(edge).toBeLessThan(size * size * 0.02);
  });

  it('every named shape produces non-degenerate geometry', () => {
    const shapes = [
      'star5', 'star3', 'triangle', 'cross', 'chevron', 'arrowStraight',
      'arrowTurn', 'laneDash', 'laneSolid', 'crosswalk', 'hazardStripes',
      'disc', 'ring', 'bar', 'numeral',
    ] as const;
    for (const shape of shapes) {
      const polys = decalPolygons(shape, '407');
      expect(polys.length).toBeGreaterThan(0);
      for (const p of polys) {
        expect(p.length).toBeGreaterThanOrEqual(6);
        expect(p.length % 2).toBe(0);
        for (const v of p) expect(Number.isFinite(v)).toBe(true);
      }
    }
  });

  it('accepts an explicit polygon path', () => {
    const size = 64;
    const cov = new Float32Array(size * size);
    rasterizePolygons(cov, size, [[0.25, 0.25, 0.75, 0.25, 0.75, 0.75, 0.25, 0.75]]);
    expect(cov[32 * size + 32]).toBeCloseTo(1, 5);   // centre filled
    expect(cov[2 * size + 2]).toBe(0);               // corner empty
  });
});

describe('the factory', () => {
  it('is deterministic — two runs are byte-identical', () => {
    for (const [kind, params] of CLEAN_CASES) {
      const a = packAlbedo(new TextureFactory().surface(kind, params));
      const b = packAlbedo(new TextureFactory().surface(kind, params));
      expect(a).toEqual(b);
    }
  });

  it('keys every clean parameter, so a tweak invalidates its cache', () => {
    const f = new TextureFactory();
    const base: AnyGenParams = { size: 32, colour: '#808080', slabW: 16, slabH: 16 };
    f.surface('paving', base);
    const before = f.surface('paving', base);
    // Same params -> same cached Surface object.
    expect(f.surface('paving', base)).toBe(before);
    // Changed params -> a different one.
    expect(f.surface('paving', { ...base, jointWidth: 5 })).not.toBe(before);
    expect(f.surface('paving', { ...base, variation: 0.05 })).not.toBe(before);
    expect(f.surface('paving', { ...base, colour: '#818181' })).not.toBe(before);
  });

  it('clamps anisotropy to the hardware ceiling', () => {
    const f = new TextureFactory();
    f.maxAnisotropy = 4;
    const tex = f.get({ kind: 'asphalt', size: 32, anisotropy: 16 });
    expect(tex.anisotropy).toBe(4);
    expect(tex.generateMipmaps).toBe(true);
  });

  it('tags colour space per channel: sRGB albedo, linear data maps', () => {
    const f = new TextureFactory();
    const req = { kind: 'paving' as TextureKind, size: 32 };
    expect(f.get({ ...req, channel: 'albedo' }).colorSpace).toBe('srgb');
    expect(f.get({ ...req, channel: 'normal' }).colorSpace).toBe('');
    expect(f.get({ ...req, channel: 'orm' }).colorSpace).toBe('');
  });

  it('routes every clean kind through the structural normal packer', () => {
    for (const [kind] of CLEAN_CASES) expect(CLEAN_KINDS.has(kind)).toBe(true);
  });
});

describe('tiling', () => {
  /**
   * A tiling texture has no seam: the step across the wrap boundary must be no
   * worse than the largest step anywhere else in the same row. A generator
   * that sampled non-wrapping noise fails this immediately.
   */
  function seamIsInvisible(kind: TextureKind, params: AnyGenParams): void {
    const s = new TextureFactory().surface(kind, params);
    const n = s.size;
    let interior = 0, seam = 0;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n - 1; x++) {
        const a = s.albedo[(y * n + x) * 3], b = s.albedo[(y * n + x + 1) * 3];
        interior = Math.max(interior, Math.abs(a - b));
      }
      const l = s.albedo[(y * n) * 3], r = s.albedo[(y * n + n - 1) * 3];
      seam = Math.max(seam, Math.abs(l - r));
    }
    expect(seam).toBeLessThanOrEqual(interior + 1e-6);
  }

  it('asphalt tiles', () => seamIsInvisible('asphalt', { size: 64, colour: '#2c2926', wear: 1 }));
  it('paving tiles', () =>
    seamIsInvisible('paving', { size: 64, colour: '#cbc0ae', slabW: 16, slabH: 16 }));
  it('cobblestone tiles', () =>
    seamIsInvisible('cobblestone', { size: 64, colour: '#b8ab98', stoneSize: 16 }));
  it('brushed metal tiles', () =>
    seamIsInvisible('brushedMetal', { size: 64, colour: '#9aa0a6' }));
});
