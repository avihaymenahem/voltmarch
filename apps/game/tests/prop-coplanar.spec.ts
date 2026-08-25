/**
 * ============================================================================
 * VOLTMARCH — tests/prop-coplanar.spec.ts
 * ============================================================================
 * NO PROP MAY DRAW THE SAME PATCH OF SURFACE TWICE AT THE SAME DEPTH.
 *
 * Reported by the author, over a screenshot of a dusk map:
 *
 *   "Fix also this artifact, the top boxes... when moving around or camera
 *    rotate, the top texture just jitter"
 *
 * Two things produce that symptom and they need opposite fixes — z-fighting
 * between coplanar surfaces, and shadow acne from an under-biased shadow map.
 * This file exists because the FIRST of them is decidable without rendering
 * anything, and on `crateStack` it was not a hypothesis:
 *
 *   - `crate()`'s top rail had its lid at `y + s`, which is the crate body
 *     box's lid. Same plane to the last bit, same +Y normal, rail footprint
 *     larger than the body, so 100% of every crate top was submitted twice at
 *     identical depth. 2.95 m2 across the five crates in one `crateStack`.
 *   - the visible half of the pair carried a linear-luminance gap of
 *     0.092..0.229 (tan body against dark seam batten), while the SAME defect
 *     on the crate flanks — the rails' outer faces sitting exactly on the
 *     corner battens' outer faces, another 0.37 m2 — carried a gap of
 *     0.014..0.023 between two shades of one dark colour.
 *
 * That second bullet is the discriminator the report itself supplied. "Side
 * faces look stable; it is the horizontal top surfaces that misbehave" is
 * explained by ALBEDO here: the same geometric defect is present on both, and
 * only the pair with a colour difference can be seen. Shadow acne has no such
 * mechanism — it modulates the light term, so it does not care what the two
 * co-located triangles' vertex colours are, and at the shipped sun elevation
 * of 38 degrees a vertical face is not the safer orientation anyway.
 *
 * The gate is a pure geometry read, so it needs no GPU, no dist/ and no shot
 * harness. `npm run shots` could not have caught the original defect: every
 * fixture is posed and paused, and z-fighting resolves to ONE of the two
 * surfaces per pixel per frame, so a still frame can look entirely correct.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { PROP_DEFS, PropLibrary } from '../src/world/PropLibrary';
import { BIOME_NAMES } from '../src/world/Biomes';

/**
 * Two surfaces closer than this in depth cannot be separated by the depth
 * buffer at any camera distance the rig allows, so they are one plane.
 *
 * `RENDER_CONFIG.camera` is near 1.0 / far 900. On a 24-bit depth buffer the
 * quantum at distance z is about `z^2 / (near * 2^24)`, i.e. 0.2 mm at the
 * 55 m default dolly and ~5 mm at 300 m. 2e-4 m is therefore a floor rather
 * than a judgement: everything this catches is a genuine tie at every
 * distance, and every separation the fixes introduce is 14 mm or more.
 */
const PLANE_EPS = 2e-4;

interface Tri {
  readonly p: Float64Array;
  readonly n: Float64Array;
  readonly d: number;
}

function trianglesOf(geo: THREE.BufferGeometry): Tri[] {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const idx = geo.getIndex();
  const count = idx !== null ? idx.count : pos.count;
  const out: Tri[] = [];
  for (let i = 0; i < count; i += 3) {
    const a = idx !== null ? idx.getX(i) : i;
    const b = idx !== null ? idx.getX(i + 1) : i + 1;
    const c = idx !== null ? idx.getX(i + 2) : i + 2;
    const p = new Float64Array(9);
    p[0] = pos.getX(a); p[1] = pos.getY(a); p[2] = pos.getZ(a);
    p[3] = pos.getX(b); p[4] = pos.getY(b); p[5] = pos.getZ(b);
    p[6] = pos.getX(c); p[7] = pos.getY(c); p[8] = pos.getZ(c);
    const ux = p[3] - p[0], uy = p[4] - p[1], uz = p[5] - p[2];
    const vx = p[6] - p[0], vy = p[7] - p[1], vz = p[8] - p[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-12) continue;               // degenerate, draws nothing
    nx /= len; ny /= len; nz /= len;
    out.push({
      p,
      n: new Float64Array([nx, ny, nz]),
      d: nx * p[0] + ny * p[1] + nz * p[2],
    });
  }
  return out;
}

function signedArea(poly: readonly number[]): number {
  let s = 0;
  for (let i = 0, n = poly.length / 2; i < n; i++) {
    const j = (i + 1) % n;
    s += poly[i * 2] * poly[j * 2 + 1] - poly[j * 2] * poly[i * 2 + 1];
  }
  return s * 0.5;
}

/** Sutherland-Hodgman: area of `poly` clipped by triangle `clip`, both 2-D. */
function clippedArea(poly: readonly number[], clip: readonly number[]): number {
  const cw = signedArea(clip) < 0
    ? [clip[4], clip[5], clip[2], clip[3], clip[0], clip[1]]
    : clip;
  let cur: number[] = [...poly];
  for (let e = 0; e < 3; e++) {
    const ax = cw[e * 2], ay = cw[e * 2 + 1];
    const bx = cw[((e + 1) % 3) * 2], by = cw[((e + 1) % 3) * 2 + 1];
    const ex = bx - ax, ey = by - ay;
    const m = cur.length / 2;
    if (m === 0) return 0;
    const next: number[] = [];
    for (let i = 0; i < m; i++) {
      const cx = cur[i * 2], cy = cur[i * 2 + 1];
      const px = cur[((i + m - 1) % m) * 2], py = cur[((i + m - 1) % m) * 2 + 1];
      const sc = ex * (cy - ay) - ey * (cx - ax);
      const sp = ex * (py - ay) - ey * (px - ax);
      if (sc >= 0) {
        if (sp < 0) {
          const t = sp / (sp - sc);
          next.push(px + (cx - px) * t, py + (cy - py) * t);
        }
        next.push(cx, cy);
      } else if (sp >= 0) {
        const t = sp / (sp - sc);
        next.push(px + (cx - px) * t, py + (cy - py) * t);
      }
    }
    cur = next;
  }
  return Math.abs(signedArea(cur));
}

/**
 * Square metres of surface a prop submits TWICE at one depth.
 *
 * A pair counts when the two triangles are coplanar within `PLANE_EPS`, face
 * the SAME way — opposed normals are back-face culled, and every prop material
 * is `FrontSide` — and overlap in the shared plane. Sharing an edge is not
 * overlapping, which is why this clips polygons rather than comparing boxes:
 * every quad in `PropMesh` is two triangles that share their diagonal.
 */
export function coplanarOverlapArea(geo: THREE.BufferGeometry): number {
  const tris = trianglesOf(geo);
  let total = 0;
  for (let i = 0; i < tris.length; i++) {
    const a = tris[i];
    for (let j = i + 1; j < tris.length; j++) {
      const b = tris[j];
      if (a.n[0] * b.n[0] + a.n[1] * b.n[1] + a.n[2] * b.n[2] < 0.9995) continue;
      if (Math.abs(a.d - b.d) > PLANE_EPS) continue;
      // An orthonormal 2-D basis on the shared plane.
      let tx = 1, ty = 0;
      if (Math.abs(a.n[0]) > 0.9) { tx = 0; ty = 1; }
      const nx = a.n[0], ny = a.n[1], nz = a.n[2];
      const dt = tx * nx + ty * ny;
      let ux = tx - nx * dt, uy = ty - ny * dt, uz = -nz * dt;
      const ul = Math.hypot(ux, uy, uz);
      ux /= ul; uy /= ul; uz /= ul;
      const vx = ny * uz - nz * uy, vy = nz * ux - nx * uz, vz = nx * uy - ny * ux;
      const flat = (t: Tri): number[] => {
        const o: number[] = [];
        for (let k = 0; k < 3; k++) {
          const x = t.p[k * 3], y = t.p[k * 3 + 1], z = t.p[k * 3 + 2];
          o.push(x * ux + y * uy + z * uz, x * vx + y * vy + z * vz);
        }
        return o;
      };
      const area = clippedArea(flat(a), flat(b));
      if (area > 1e-7) total += area;
    }
  }
  return total;
}

/**
 * THE ONE SURVIVOR, AND WHY IT STAYS.
 *
 * Every fixed case was TWO HAND-AUTHORED NUMBERS that happened to agree, and is
 * therefore present on every seed, every biome and every map. Every row below
 * is the other kind: an overlap that falls out of a SEEDED PLACEMENT, present
 * on some seeds and absent on others. Removing it means moving props about,
 * which changes what every map looks like for a defect smaller than the change.
 *
 * `PropDef.build` is the boundary that makes this table safe to have: these are
 * budgets on foliage and on a barrel cluster, not a licence for a new flush
 * face elsewhere in the same builder — the numbers are tight enough that one
 * would blow straight through them.
 *
 * Rows fail in BOTH directions. A row that is zero across every seed swept is
 * either fixed or unreachable, and either way it must be DELETED — a table that
 * silently tolerates a fixed defect is how the next one hides.
 */
const DECLARED: ReadonlyMap<string, { readonly max: number; readonly why: string }> =
  new Map([
    ['barrel', {
      max: 0.08,
      why: 'the centre drum interpenetrates a ring drum whenever the seeded '
        + 'radius draws under 2r, so their lids and floors coincide. Worst '
        + 'measured 0.0436 m2, and HALF of that is the drums\' undersides at '
        + 'y = 0, which are in the ground. Pushing the ring out past 0.84 m '
        + 'would take the group past its declared PropDef.radius of 1.2. '
        + 'Luminance gap between the surviving pairs: 0.000-0.002, i.e. this '
        + 'one is invisible as well as small.',
    }],
  ]);

/**
 * FIVE seeds, because a builder that places by seeded RNG can be clean on one
 * of them by luck. Every DECLARED row above is seed-dependent by nature, which
 * is exactly what puts it in the table rather than in the fixed set, so one
 * seed is not evidence in either direction. The authored cases this gate
 * exists for are seed-INDEPENDENT and would fail on any one of them.
 */
const SEEDS: readonly number[] = [0x5eed_1234, 7, 99, 12345, 4242];

describe('props draw no surface twice at one depth', () => {
  it('is clean on every prop in every biome, bar one declared placement', () => {
    const worst = new Map<string, number>();
    for (const seed of SEEDS) {
      for (const biome of BIOME_NAMES) {
        const lib = new PropLibrary({ biome, seed });
        for (const pg of lib.all()) {
          const area = coplanarOverlapArea(pg.geometry);
          worst.set(pg.def.key, Math.max(worst.get(pg.def.key) ?? 0, area));
        }
        lib.dispose();
      }
    }
    expect(worst.size).toBeGreaterThan(20);

    for (const [key, area] of worst) {
      const declared = DECLARED.get(key);
      if (declared === undefined) {
        expect(area, `${key} draws ${area.toFixed(4)} m2 of surface twice`).toBe(0);
      } else {
        // Still falsifiable in both directions: a row that is zero across
        // every seed swept is either fixed or unreachable, and must go.
        expect(area, `${key} is clean on every seed — delete its DECLARED row`)
          .toBeGreaterThan(0);
        expect(area, `${key}: ${declared.why}`).toBeLessThanOrEqual(declared.max);
      }
    }
  }, 120_000);

  it('declares nothing it does not build', () => {
    const keys = new Set(PROP_DEFS.map((d) => d.key));
    for (const key of DECLARED.keys()) expect(keys.has(key), key).toBe(true);
  });

  it('the crate lid — the reported defect — is one unbroken surface', () => {
    // The regression in its own right, named, so a failure points at the
    // report rather than at a table. The top rail's lid must clear the body's
    // by enough to survive the depth quantum at the far end of the dolly.
    const lib = new PropLibrary({ biome: 'urban', seed: 7 });
    const geo = lib.get('crateStack')!.geometry;
    expect(coplanarOverlapArea(geo)).toBe(0);

    // ...and the tan body lid is still the topmost surface of each crate, i.e.
    // the fix moved the dark batten DOWN rather than covering the crate in it.
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const col = geo.getAttribute('color') as THREE.BufferAttribute;
    let topY = -Infinity;
    let topLum = 0;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y > topY + 1e-6) {
        topY = y;
        topLum = 0.2126 * col.getX(i) + 0.7152 * col.getY(i) + 0.0722 * col.getZ(i);
      }
    }
    // Timber tan, not the near-black seam colour it fought with (L ~= 0.06).
    expect(topLum).toBeGreaterThan(0.10);
    lib.dispose();
  }, 120_000);
});
