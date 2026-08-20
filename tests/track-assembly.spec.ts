/**
 * ============================================================================
 * tests/track-assembly.spec.ts — THE RUNNING GEAR, AND ITS ROAD-WHEEL DOTS
 * ============================================================================
 * Before this file there was no test in `tests/` that mentioned `'tracks'` or
 * `trackAssembly` at all, and that hole is why the following shipped:
 *
 *   The road wheels were invisible. Every one of them. `Shapes.ts` authored the
 *   hub cluster INBOARD of the band ("road wheels, inboard, sitting on the
 *   ground line"), which on the Guardian put the wheels at worldX
 *   [1.032, 1.297] behind a band at [1.345, 1.855]. The band sealed them from
 *   outboard, the hull deck sealed them from above and the far track sealed
 *   them from inboard, so the measured visible wheel area was EXACTLY 0.0000 m2
 *   on all ten Allied/Soviet tracked units, with 0 dots.
 *
 * That fails two prose-backed lines, not a guessed one:
 *
 *   VISUAL_DNA.md:499 S5 — "Every tracked vehicle carries a 3-4 px dark band
 *     (#101010-#202020) along its lower edge with 5-7 bright road-wheel dots
 *     (#8A8A8A). Without it, vehicles float."
 *   VISUAL_DNA.md:1416 C16, weight x2 — "a 3-4 px dark track band with
 *     road-wheel dots".
 *
 * So the first two tests here MEASURE the dots rather than asserting a
 * coordinate: they rasterise an orthographic side elevation of the assembly
 * with a depth buffer along X, exactly as VISUAL_DNA writes the rule (it is a
 * sprite-silhouette law), and count how much of what the camera sees is wheel.
 * The second test drags the wheel group back to where it shipped and asserts
 * the metric collapses to zero — a gate that cannot fail is not a gate.
 *
 * The rest of the file pins the numbers that were ALREADY right, because the
 * fix moved geometry and the cheapest way to break a compliant number is to
 * move something near it:
 *
 *   - the track's outboard protrusion is 11.00% of hull width, dead on
 *     `UNIT_GEOMETRY.trackOutboardFraction` and inside the bible's [0.08, 0.14];
 *   - `trackHeightFraction` is 0.22, inside the bible's [0.18, 0.25], and it is
 *     the same number the tank chassis is derived from;
 *   - `MassDef.size` is still the authoritative AABB of the built mesh.
 *
 * And two the fix introduced and must keep: the assembly's raw X extent now
 * equals its `size[0]` (so `fitMesh` scales X by 1.000 instead of squashing it
 * by 0.5315), and the band is exactly 16% of hull width per side, which is what
 * it measured before the relayout and what a real MBT runs.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';

import { fitMesh, shapeMesh } from '../src/art/Shapes';
import type { ShapeMesh, ShapePoly } from '../src/art/Shapes';
import { shapeFitMode, shapeSpecFor, unitBounds } from '../src/art/MassList';
import type { MassDef, UnitMassList } from '../src/art/MassList';
import { UNIT_MASS_LISTS } from '../src/art/UnitDefs';
import { UNIT_GEOMETRY, UNIT_LADDER } from '../src/core/config';

/* ==========================================================================
 * Every tracked unit, built the way `UnitFactory` builds it
 *
 * `UnitFactory.ts:717` does `shapeSpecFor(m, chamfer)` -> `shapeMesh(spec)` ->
 * `fitMesh(mesh, m.size, shapeFitMode(m))`. The `tracks` branch of
 * `shapeSpecFor` ignores `chamfer`, so 0 here is the real spec.
 * ========================================================================== */

interface Tracked {
  readonly key: string;
  readonly mass: MassDef;
  /** As authored by `trackAssemblyMesh`, before the fit. */
  readonly raw: ShapeMesh;
  /** As emitted into the unit: fitted to `mass.size`, still at the origin. */
  readonly fitted: ShapeMesh;
  /** Centreline body width. Tanks call it 'hull', support hulls 'chassis'. */
  readonly hullWidth: number;
  readonly hullLength: number;
  /** Total silhouette height, mirrored copies included. */
  readonly unitHeight: number;
}

const TRACKED: readonly Tracked[] = UNIT_MASS_LISTS.flatMap((u: UnitMassList): Tracked[] => {
  const mass = u.masses.find((m) => m.primitive === 'tracks');
  if (mass === undefined) return [];
  const spec = shapeSpecFor(mass, 0);
  if (spec === null) throw new Error(`${u.key}: shapeSpecFor returned null for a 'tracks' mass`);
  const body = u.masses.find((m) => m.name === 'hull' || m.name === 'chassis');
  if (body === undefined) throw new Error(`${u.key}: no 'hull' or 'chassis' mass to measure against`);
  const bb = unitBounds(u);
  const raw = shapeMesh(spec);
  // 'none' is for masses already authored in real metres; a track run is not
  // one, and the AABB test below pins that it never becomes one.
  const mode = shapeFitMode(mass);
  if (mode === 'none') throw new Error(`${u.key}: a 'tracks' mass must not opt out of the fit`);
  return [{
    key: u.key,
    mass,
    raw,
    fitted: fitMesh(raw, mass.size, mode),
    hullWidth: body.size[0],
    hullLength: u.hullLength,
    unitHeight: bb.max[1] - bb.min[1],
  }];
});

/** Axis-aligned box of one sub-group of a built assembly, in mass-local space. */
function groupBox(mesh: ShapeMesh, group: string): { min: number[]; max: number[] } | null {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let hit = false;
  for (const p of mesh.polys) {
    if (p.group !== group) continue;
    hit = true;
    for (const v of p.v) {
      for (let i = 0; i < 3; i++) {
        if (v[i] < min[i]) min[i] = v[i];
        if (v[i] > max[i]) max[i] = v[i];
      }
    }
  }
  return hit ? { min, max } : null;
}

function box(t: Tracked, group: string): { min: number[]; max: number[] } {
  const b = groupBox(t.fitted, group);
  if (b === null) throw new Error(`${t.key}: the assembly emitted no '${group}' geometry at all`);
  return b;
}

/* ==========================================================================
 * THE MEASUREMENT: an orthographic side elevation with an X depth buffer
 *
 * S5 and C16 are written about a SPRITE — "a dark band along its lower edge
 * with 5-7 bright dots" — so the honest metric is a silhouette, not a
 * coordinate comparison. Every outboard-facing polygon is rasterised into a
 * YZ grid; at each pixel the surface with the largest X wins, because that is
 * the one a camera outboard of the track sees. Whatever the wheel group still
 * owns afterwards is a dot the player can actually look at.
 * ========================================================================== */

const N = 384;

interface Elevation {
  /** Group index per pixel, -1 where nothing faces outboard. */
  readonly owner: Int16Array;
  readonly groups: readonly string[];
  /** Square metres per pixel. */
  readonly cell: number;
}

function sideElevation(mesh: ShapeMesh): Elevation {
  const groups: string[] = [];
  const idOf = (g: string): number => {
    let i = groups.indexOf(g);
    if (i < 0) { i = groups.length; groups.push(g); }
    return i;
  };
  const z0 = mesh.min[2], y0 = mesh.min[1];
  const dz = (mesh.max[2] - mesh.min[2]) / N;
  const dy = (mesh.max[1] - mesh.min[1]) / N;
  const depth = new Float64Array(N * N).fill(-Infinity);
  const owner = new Int16Array(N * N).fill(-1);

  for (const p of mesh.polys) {
    if (p.n[0] <= 0.02) continue;                       // does not face outboard
    const gid = idOf(p.group ?? '(none)');
    for (let t = 2; t < p.v.length; t++) {              // fan-triangulate
      const a = p.v[0], b = p.v[t - 1], c = p.v[t];
      const az = (a[2] - z0) / dz, ay = (a[1] - y0) / dy;
      const bz = (b[2] - z0) / dz, by = (b[1] - y0) / dy;
      const cz = (c[2] - z0) / dz, cy = (c[1] - y0) / dy;
      const det = (bz - az) * (cy - ay) - (cz - az) * (by - ay);
      if (Math.abs(det) < 1e-12) continue;
      const z1 = Math.max(0, Math.floor(Math.min(az, bz, cz)));
      const z2 = Math.min(N - 1, Math.ceil(Math.max(az, bz, cz)));
      const y1 = Math.max(0, Math.floor(Math.min(ay, by, cy)));
      const y2 = Math.min(N - 1, Math.ceil(Math.max(ay, by, cy)));
      for (let iy = y1; iy <= y2; iy++) {
        for (let iz = z1; iz <= z2; iz++) {
          const pz = iz + 0.5, py = iy + 0.5;
          const w0 = ((bz - pz) * (cy - py) - (cz - pz) * (by - py)) / det;
          const w1 = ((cz - pz) * (ay - py) - (az - pz) * (cy - py)) / det;
          const w2 = 1 - w0 - w1;
          if (w0 < -1e-9 || w1 < -1e-9 || w2 < -1e-9) continue;
          const x = w0 * a[0] + w1 * b[0] + w2 * c[0];
          const k = iy * N + iz;
          if (x > depth[k]) { depth[k] = x; owner[k] = gid; }
        }
      }
    }
  }
  return { owner, groups, cell: dz * dy };
}

/** Visible pixels owned by `group`, and how many separate blobs they form. */
function dots(e: Elevation, group: string): { pixels: number; covered: number; blobs: number } {
  const gid = e.groups.indexOf(group);
  let pixels = 0, covered = 0;
  for (let i = 0; i < e.owner.length; i++) {
    if (e.owner[i] < 0) continue;
    covered++;
    if (e.owner[i] === gid) pixels++;
  }
  if (gid < 0) return { pixels: 0, covered, blobs: 0 };

  // A blob under 1% of the group's visible pixels is a rasteriser seam where
  // two surfaces tie on X, not a road wheel.
  const minPx = Math.max(4, pixels * 0.01);
  const seen = new Uint8Array(N * N);
  const stack: number[] = [];
  let blobs = 0;
  for (let i = 0; i < N * N; i++) {
    if (e.owner[i] !== gid || seen[i] === 1) continue;
    let size = 0;
    stack.push(i);
    seen[i] = 1;
    while (stack.length > 0) {
      const k = stack.pop() as number;
      size++;
      const y = (k / N) | 0, z = k % N;
      const push = (yy: number, zz: number): void => {
        if (yy < 0 || zz < 0 || yy >= N || zz >= N) return;
        const j = yy * N + zz;
        if (seen[j] === 1 || e.owner[j] !== gid) return;
        seen[j] = 1;
        stack.push(j);
      };
      push(y + 1, z); push(y - 1, z); push(y, z + 1); push(y, z - 1);
    }
    if (size >= minPx) blobs++;
  }
  return { pixels, covered, blobs };
}

/** The same mesh with one group slid along X. Used to rebuild the old defect. */
function slideGroup(mesh: ShapeMesh, group: string, dx: number): ShapeMesh {
  const polys: ShapePoly[] = mesh.polys.map((p) => (p.group !== group ? p : {
    ...p,
    v: p.v.map((v): readonly [number, number, number] => [v[0] + dx, v[1], v[2]]),
  }));
  return { ...mesh, polys };
}

/* ==========================================================================
 * 1. The dots exist
 * ========================================================================== */

describe('VISUAL_DNA S5 / C16 — road-wheel dots on the track band', () => {
  it('every tracked unit has a road wheel run at all', () => {
    // Ten: five Allied, five Soviet. If a unit stops being tracked this number
    // moves, and the whole file below stops covering it.
    expect(TRACKED.map((t) => t.key)).toEqual([
      'allied_guardian', 'allied_ifv', 'allied_prism', 'allied_harvester', 'allied_dozer',
      'soviet_rhino', 'soviet_apocalypse', 'soviet_v4', 'soviet_harvester', 'soviet_dozer',
    ]);
  });

  it.each(TRACKED.map((t) => [t.key, t] as const))(
    '%s shows 5-7 road-wheel dots in side elevation', (key, t) => {
      const d = dots(sideElevation(t.fitted), 'wheel');
      // S5: "5-7 bright road-wheel dots". Measured, not counted from the param.
      expect(d.blobs, `${key}: visible road-wheel dots`).toBeGreaterThanOrEqual(5);
      expect(d.blobs, `${key}: visible road-wheel dots`).toBeLessThanOrEqual(7);
      // And each one has to be worth a pixel. This was 0.00% on every unit.
      expect(d.pixels / d.covered, `${key}: wheel share of the visible assembly`)
        .toBeGreaterThan(0.08);
    });

  it('the sprocket and idler are visible too, so the run reads end to end', () => {
    for (const t of TRACKED) {
      const e = sideElevation(t.fitted);
      for (const g of ['sprocket', 'idler'] as const) {
        const d = dots(e, g);
        expect(d.pixels, `${t.key}: visible '${g}' pixels`).toBeGreaterThan(0);
      }
    }
  });

  /* ------------------------------------------------------------------------
   * The gate has to be able to fire. Put the wheels back where they shipped —
   * fully inboard of the band — and the same measurement must report nothing.
   * ---------------------------------------------------------------------- */
  it('reports zero when the wheels are inboard, which is how this shipped', () => {
    for (const t of TRACKED) {
      const band = box(t, 'band');
      const wheel = box(t, 'wheel');
      // Slide the run inboard until its outer face is behind the band's inner
      // face: the old `inner = -w * 0.5 - wheelT * 0.18` placement.
      const dx = band.min[0] - wheel.max[0] - 0.001;
      expect(dx).toBeLessThan(0);
      const d = dots(sideElevation(slideGroup(t.fitted, 'wheel', dx)), 'wheel');
      expect(d.pixels, `${t.key}: buried wheels must measure zero`).toBe(0);
      expect(d.blobs, `${t.key}: buried wheels must measure zero`).toBe(0);
    }
  });
});

/* ==========================================================================
 * 2. Why they are visible — the layout, stated as geometry
 * ========================================================================== */

describe('the hub plane stands proud of the band and clears the skirt', () => {
  it('the wheel discs face outboard of the band on every unit', () => {
    for (const t of TRACKED) {
      const band = box(t, 'band');
      const wheel = box(t, 'wheel');
      const proud = wheel.max[0] - band.max[0];
      expect(proud, `${t.key}: wheel face proud of the band`).toBeGreaterThan(0);
      // It is the configured fraction of the assembly's footprint, exactly.
      expect(proud).toBeCloseTo(t.mass.size[0] * UNIT_GEOMETRY.trackHubProudFraction, 6);
    }
  });

  it('nothing pokes through the skirt, and the skirt stays the outer edge', () => {
    for (const t of TRACKED) {
      const wheel = box(t, 'wheel');
      const skirt = box(t, 'skirt');
      expect(wheel.max[0], `${t.key}: wheel must not intersect the skirt`)
        .toBeLessThan(skirt.min[0]);
      // The skirt defines the outboard protrusion; see the R8 test below.
      for (const g of ['band', 'wheel', 'sprocket', 'idler', 'roller', 'tooth']) {
        const b = groupBox(t.fitted, g);
        if (b === null) continue;
        expect(b.max[0], `${t.key}: '${g}' must not out-reach the skirt`)
          .toBeLessThanOrEqual(skirt.max[0] + 1e-9);
      }
    }
  });

  it('the lower half of every wheel is clear of the skirt', () => {
    for (const t of TRACKED) {
      const wheel = box(t, 'wheel');
      const skirt = box(t, 'skirt');
      const diameter = wheel.max[1] - wheel.min[1];
      const exposed = Math.min(wheel.max[1], skirt.min[1]) - wheel.min[1];
      expect(exposed / diameter, `${t.key}: wheel height below the skirt line`)
        .toBeGreaterThan(0.40);
    }
  });

  it('the wheels are still DOTS — visibility was the defect, not diameter', () => {
    // The trap the verifiers flagged: "make the wheels bigger" takes a
    // compliant 0.516 m wheel to 1.364 m, a 7.7 px blob on S5's own 35 px
    // reference hull. Nothing here changed a diameter; this pins that.
    for (const t of TRACKED) {
      const wheel = box(t, 'wheel');
      const ratio = (wheel.max[1] - wheel.min[1]) / t.hullLength;
      expect(ratio, `${t.key}: wheel diameter over hull length`).toBeGreaterThan(0.055);
      expect(ratio, `${t.key}: wheel diameter over hull length`).toBeLessThan(0.11);
    }
  });
});

/* ==========================================================================
 * 3. The numbers that were already compliant, pinned
 * ========================================================================== */

describe('the compliant track numbers survive the relayout', () => {
  it('tracks protrude exactly trackOutboardFraction of hull width', () => {
    // RA3_LOOK_BIBLE.md `trackProudFractionOfHullWidth` wants 0.08-0.14 and config says 0.11.
    expect(UNIT_GEOMETRY.trackOutboardFraction).toBe(0.11);
    expect(UNIT_GEOMETRY.trackOutboardFraction).toBeGreaterThanOrEqual(0.08);
    expect(UNIT_GEOMETRY.trackOutboardFraction).toBeLessThanOrEqual(0.14);

    for (const t of TRACKED) {
      // The outermost geometry of the assembly, in unit space.
      const outer = t.mass.anchor[0] + t.mass.size[0] * 0.5;
      const protrusion = (outer - t.hullWidth * 0.5) / t.hullWidth;
      expect(protrusion, `${t.key}: outboard protrusion`)
        .toBeCloseTo(UNIT_GEOMETRY.trackOutboardFraction, 10);
      // And it is the skirt that lands there, not a stray wheel.
      expect(box(t, 'skirt').max[0] + t.mass.anchor[0]).toBeCloseTo(outer, 6);
    }
  });

  it('the anchor cancels the track width, so protrusion cannot drift with it', () => {
    // 2 * |anchor.x| + size.x is 1.22 * hullWidth for ANY width, which is why
    // retuning the assembly's footprint cannot move the 11% or the turret/hull
    // width ratio that `validateUnit` derives from the same span.
    for (const t of TRACKED) {
      const span = Math.abs(t.mass.anchor[0]) * 2 + t.mass.size[0];
      expect(span / t.hullWidth, `${t.key}: mirrored track span over hull width`)
        .toBeCloseTo(1 + 2 * UNIT_GEOMETRY.trackOutboardFraction, 10);
    }
  });

  it('trackHeightFraction is 0.22 and it is where the tank chassis comes from', () => {
    // RA3_LOOK_BIBLE.md `trackHeightFractionOfUnit` [0.18, 0.25].
    expect(UNIT_GEOMETRY.trackHeightFraction).toBe(0.22);
    expect(UNIT_GEOMETRY.trackHeightFraction).toBeGreaterThanOrEqual(0.18);
    expect(UNIT_GEOMETRY.trackHeightFraction).toBeLessThanOrEqual(0.25);
    // `UnitDefs.tank()` builds trackH as H * chassisHeightFraction * 0.55.
    expect(UNIT_LADDER.chassisHeightFraction * 0.55)
      .toBeCloseTo(UNIT_GEOMETRY.trackHeightFraction, 12);
  });

  it('every unit keeps its measured track height fraction', () => {
    // Pinned as measured. The six turreted hulls sit on the bible's 0.22 (the
    // V4 reads lower only because its mast lifts `unitBounds`); the harvester
    // and dozer have always run a taller chassis than the bible band, which is
    // a pre-existing deviation this file records rather than blesses.
    const expected: Record<string, number> = {
      allied_guardian: 0.2200, allied_ifv: 0.2200, allied_prism: 0.2200,
      allied_harvester: 0.3097, allied_dozer: 0.3000,
      soviet_rhino: 0.2200, soviet_apocalypse: 0.2200, soviet_v4: 0.2123,
      soviet_harvester: 0.3097, soviet_dozer: 0.3000,
    };
    for (const t of TRACKED) {
      expect(t.mass.size[1] / t.unitHeight, `${t.key}: track height over unit height`)
        .toBeCloseTo(expected[t.key], 4);
    }
  });

  it('MassDef.size is still the authoritative AABB of the built mesh', () => {
    // `MassList.ts:1550` calls this the rule that makes everything else work:
    // `massExtents`, `unitBounds`, `silhouetteArea` and `validateUnit` all read
    // `size` and never touch the mesh.
    for (const t of TRACKED) {
      expect(shapeFitMode(t.mass)).toBe('stretch');
      for (let a = 0; a < 3; a++) {
        expect(t.fitted.max[a] - t.fitted.min[a], `${t.key}: fitted extent on axis ${a}`)
          .toBeCloseTo(t.mass.size[a], 9);
        expect(t.fitted.max[a] + t.fitted.min[a], `${t.key}: fitted mesh is centred`)
          .toBeCloseTo(0, 9);
      }
    }
  });
});

/* ==========================================================================
 * 4. What the relayout introduced, and what it cost
 * ========================================================================== */

describe('the assembly is authored to the box it is given', () => {
  it('the four layout fractions divide the footprint exactly', () => {
    const sum = UNIT_GEOMETRY.trackBandFraction
      + UNIT_GEOMETRY.trackHubProudFraction
      + UNIT_GEOMETRY.trackSkirtGapFraction
      + UNIT_GEOMETRY.trackSkirtFraction;
    expect(sum).toBeCloseTo(1, 12);
  });

  it('fitMesh scales X by 1.000 instead of squashing it', () => {
    // This used to be 0.5315: `width` was documented as the band width but the
    // hub cluster hanging off the inboard face padded the AABB to 1.88x it, and
    // `fitMesh` squashed the whole assembly to compensate. Nothing in the file
    // said so, and the band came out 47% narrower than the number that named it.
    for (const t of TRACKED) {
      const rawX = t.raw.max[0] - t.raw.min[0];
      expect(t.mass.size[0] / rawX, `${t.key}: fitMesh X scale`).toBeCloseTo(1, 3);
    }
  });

  it('the band is 16% of hull width per side, as it measured before', () => {
    for (const t of TRACKED) {
      const band = box(t, 'band');
      expect((band.max[0] - band.min[0]) / t.hullWidth, `${t.key}: band width over hull width`)
        .toBeCloseTo(UNIT_GEOMETRY.trackBandFractionOfHull, 6);
    }
    // Guardian: 0.512 m of band on a 3.2 m hull. It was 0.510 m before the
    // relayout, so the visible track thickness is unchanged to within 0.4%.
    const guardian = TRACKED.find((t) => t.key === 'allied_guardian');
    expect(guardian).toBeDefined();
    if (guardian !== undefined) {
      const band = box(guardian, 'band');
      expect(band.max[0] - band.min[0]).toBeCloseTo(0.512, 3);
    }
  });

  it('keeps the higher-resolution running gear inside its measured budget', () => {
    // Still one merged mesh and one draw call per assembly. V3 deliberately
    // spends more triangles on the highly visible stadium band, round wheels,
    // sprockets and return rollers; exact counts prevent that approved spend
    // becoming unmeasured future drift.
    const expected: Record<string, number> = {
      allied_guardian: 1508, allied_ifv: 1508, allied_prism: 1508,
      allied_harvester: 1676, allied_dozer: 1676,
      soviet_rhino: 1600, soviet_apocalypse: 1768, soviet_v4: 1508,
      soviet_harvester: 1676, soviet_dozer: 1676,
    };
    let total = 0;
    for (const t of TRACKED) {
      expect(t.raw.triangles, `${t.key}: track assembly triangles`).toBe(expected[t.key]);
      expect(t.fitted.triangles, `${t.key}: fitting must not add geometry`).toBe(t.raw.triangles);
      total += t.raw.triangles;
    }
    expect(total).toBe(16104);
  });
});
