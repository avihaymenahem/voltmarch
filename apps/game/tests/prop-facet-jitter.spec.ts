/**
 * PER-FACET PAINT JITTER — the shape of the thing, pinned.
 *
 * Scorecard #34 ("Sobel |grad|>25 coverage") fails on all thirteen capture
 * fixtures, and native-resolution crops put the deficit in bare ground and tree
 * canopies. `PropMesh.facetJitter` is the canopy half: flat-shaded props already
 * split their vertices per face, so a per-facet albedo step costs no attribute,
 * no draw call and no triangle, and every facet boundary becomes an edge the
 * Sobel operator can see.
 *
 * What must stay true, and why each one is here rather than left to review:
 *
 *   1. The jitter is PER FACET, never within one. CLAUDE.md's hard rule is "if
 *      per-pixel noise is visible at gameplay zoom, it is wrong"; a facet is a
 *      crisp shape with a real crease, a gradient inside one is not. If a later
 *      change rolls per VERTEX instead, the render turns to mush and nothing
 *      else in the suite notices.
 *   2. It is SEEDED. `Math.random()` here would make the prop library
 *      non-reproducible, which breaks the shot harness's byte-identity claim
 *      before it ever reaches the sim's determinism rules.
 *   3. It stays inside its band. The value swing interacts with the tone-ladder
 *      rule in `PropLibrary`'s section 3 (see `props-surface.spec.ts`), so the
 *      number is worth holding still.
 *   4. It is OFF for everything that is not foliage. A 6 px grass blade with a
 *      colour step across it is exactly the noise rule 1 forbids.
 */

import { describe, expect, it } from 'vitest';

import { Rng } from '../src/core/math';
import { PropLibrary, PropMesh } from '../src/world/PropLibrary';

/** Distinct colour triples over a geometry, keyed to 5 decimal places. */
function distinctColours(geometry: THREE_LIKE): number {
  const col = geometry.getAttribute('color');
  const seen = new Set<string>();
  for (let i = 0; i < col.count; i++) {
    seen.add(`${col.getX(i).toFixed(5)},${col.getY(i).toFixed(5)},${col.getZ(i).toFixed(5)}`);
  }
  return seen.size;
}

interface THREE_LIKE {
  getAttribute(n: string): {
    count: number;
    getX(i: number): number;
    getY(i: number): number;
    getZ(i: number): number;
  };
  getIndex(): { count: number; getX(i: number): number } | null;
}

/** Max/min of the green channel over a geometry, ignoring true black. */
function greenSpan(geometry: THREE_LIKE): number {
  const col = geometry.getAttribute('color');
  let lo = Infinity, hi = 0;
  for (let i = 0; i < col.count; i++) {
    const g = col.getY(i);
    if (g < 1e-6) continue;
    if (g < lo) lo = g;
    if (g > hi) hi = g;
  }
  return hi / lo;
}

describe('PropMesh.facetJitter', () => {
  it('gives every triangle of a blob its own colour', () => {
    const m = new PropMesh();
    m.facetJitter(new Rng(1), 0.14, 6);
    m.color('#7E8A30');
    m.blob(0, 2, 0, 2, 2, 2, 10, 5, 0);
    const g = m.toGeometry('probe') as unknown as THREE_LIKE;
    // 10 segs x 5 rings = 50 facets. Two rolls could collide at 5 decimals, so
    // the bar is "most of them are distinct", not "all".
    expect(distinctColours(g)).toBeGreaterThan(40);
  });

  it('paints every vertex of one facet identically — a facet, not a gradient', () => {
    const m = new PropMesh();
    m.facetJitter(new Rng(2), 0.14, 6);
    m.color('#7E8A30');
    m.blob(0, 2, 0, 2, 2, 2, 10, 5, 0);
    const g = m.toGeometry('probe') as unknown as THREE_LIKE;
    const idx = g.getIndex()!;
    const col = g.getAttribute('color');
    for (let t = 0; t < idx.count / 3; t++) {
      const a = idx.getX(t * 3), b = idx.getX(t * 3 + 1), c = idx.getX(t * 3 + 2);
      // Exact equality, not toBeCloseTo: all three corners are written from the
      // same three fields in the same roll, so any drift means a per-vertex
      // path crept in.
      expect(col.getX(a), `tri ${t}`).toBe(col.getX(b));
      expect(col.getX(a), `tri ${t}`).toBe(col.getX(c));
      expect(col.getY(a), `tri ${t}`).toBe(col.getY(b));
      expect(col.getZ(a), `tri ${t}`).toBe(col.getZ(c));
    }
  });

  it('holds the value swing inside the declared band', () => {
    const m = new PropMesh();
    m.facetJitter(new Rng(3), 0.14, 6);
    m.color('#7E8A30');
    m.blob(0, 2, 0, 2, 2, 2, 12, 8, 0);
    const g = m.toGeometry('probe') as unknown as THREE_LIKE;
    // +-14% in sRGB VALUE. The channel is linear, so the ceiling is the sRGB
    // ratio pushed through the 2.4 exponent: (1.14/0.86)^2.4 = 1.98. Anything
    // above that means the band was widened without this comment being updated.
    // No AO ramp is set here, so the ramp cannot be what is spreading it.
    expect(greenSpan(g)).toBeLessThan(1.98);
    expect(greenSpan(g)).toBeGreaterThan(1.10);
  });

  it('restores the authored paint bit-for-bit when switched off', () => {
    const plain = new PropMesh();
    plain.color('#7E8A30');
    plain.box(0, 1, 0, 2, 2, 2, 0.2);

    const cycled = new PropMesh();
    cycled.color('#7E8A30');
    cycled.facetJitter(new Rng(4), 0.14, 6);
    cycled.noFacetJitter();
    cycled.box(0, 1, 0, 2, 2, 2, 0.2);

    const a = plain.toGeometry('a') as unknown as THREE_LIKE;
    const b = cycled.toGeometry('b') as unknown as THREE_LIKE;
    const ca = a.getAttribute('color'), cb = b.getAttribute('color');
    expect(cb.count).toBe(ca.count);
    for (let i = 0; i < ca.count; i++) {
      expect(cb.getX(i), `vertex ${i}`).toBe(ca.getX(i));
      expect(cb.getZ(i), `vertex ${i}`).toBe(ca.getZ(i));
    }
  });

  it('is seeded — same seed, same paint; different seed, different paint', () => {
    const build = (seed: number): number[] => {
      const m = new PropMesh();
      m.facetJitter(new Rng(seed), 0.14, 6);
      m.color('#7E8A30');
      m.blob(0, 2, 0, 2, 2, 2, 10, 5, 0);
      const col = (m.toGeometry('probe') as unknown as THREE_LIKE).getAttribute('color');
      const out: number[] = [];
      for (let i = 0; i < col.count; i++) out.push(col.getY(i));
      return out;
    };
    const a = build(77), b = build(77), c = build(78);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });
});

describe('the roster — jitter reaches foliage and nothing else', () => {
  const lib = new PropLibrary({ biome: 'temperate', seed: 7 });

  /**
   * Distinct colour DIRECTIONS per triangle.
   *
   * Counting raw colours does not separate the two cases: the baked AO ramp is
   * a continuous function of Y, so an un-jittered `grassTuft` already carries a
   * different triple on almost every vertex. But AO is a SCALAR multiply, and
   * `shadeOf` holds hue and saturation, so both leave the RGB direction alone —
   * exactly the argument `props-surface.spec.ts` makes for its `toneFraction`.
   * Normalising to unit length therefore collapses an un-jittered prop to its
   * handful of authored tones, while the +-6 degree hue roll gives a jittered
   * one a fresh direction per facet.
   */
  const directionsPerTri = (key: string): number => {
    const pg = lib.get(key);
    expect(pg, `${key} missing from the temperate roster`).toBeTruthy();
    const col = pg!.geometry.getAttribute('color');
    const seen = new Set<string>();
    for (let i = 0; i < col.count; i++) {
      const r = col.getX(i), g = col.getY(i), b = col.getZ(i);
      const len = Math.hypot(r, g, b);
      if (len < 1e-6) continue;
      seen.add(`${(r / len).toFixed(4)},${(g / len).toFixed(4)},${(b / len).toFixed(4)}`);
    }
    return seen.size / pg!.triangles;
  };

  it('jitters canopy blobs, conifer tiers and shrub lobes', () => {
    for (const key of ['tree', 'treeAutumn', 'conifer', 'bush']) {
      expect(directionsPerTri(key), key).toBeGreaterThan(0.20);
    }
  });

  it('leaves grass fans, hedges and man-made props flat', () => {
    // A grass blade is 0.20 m wide, a hedge is a box silhouette, and a car is
    // painted plastic. All three read as noise the moment a facet step lands on
    // them at gameplay zoom. Each carries at most a handful of authored tones
    // over hundreds of triangles.
    for (const key of ['grassTuft', 'hedge', 'carSedan', 'boulder', 'palm']) {
      expect(directionsPerTri(key), key).toBeLessThan(0.05);
    }
  });
});
