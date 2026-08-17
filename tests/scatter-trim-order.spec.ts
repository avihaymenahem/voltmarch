/**
 * THE ORDER OF `Scatter.generate()`'s LAST THREE PASSES.
 *
 * `tests/scatter.spec.ts` proves the 25x25 m ship-blocking gate (scorecard #15,
 * weight 3) passes. It proves it on `lastReport`, which is the gate's own
 * verdict — so it can only be trusted if nothing removes a placement AFTER the
 * gate has run. For the whole life of the module something did.
 *
 * `trimTypes()` holds the draw-call budget by deleting every placement of the
 * lowest-ranked prop types, and it used to run at the very end of `generate()`,
 * after `fillToTarget()` had closed the patches. So on any map that trimmed —
 * four of the twelve critique fixtures did, `03-terrain-closeup` dropping eight
 * whole types — the gate closed a hole and the trim then reopened it, and the
 * report was recomputed on the trimmed set with no pass left to fix it.
 * `07-soviet-base` shipped with "adornment 65%, 1 unadorned patch" out of a
 * gate that had passed.
 *
 * Two things follow, and both are asserted here rather than described:
 *
 *   1. **The gate is last.** After `generate()`, `validateCoverage()` re-run
 *      from scratch must agree with `lastReport`. It cannot, if a later pass
 *      removed props.
 *   2. **The spacing index survives the trim.** `bucketHead`/`bucketNext` hold
 *      indices into `placements`, and the trim compacts that array. While the
 *      trim ran last, the stale window was empty and nothing could enter it;
 *      moving it earlier crashed the first boot into it, in `tooClose`, on
 *      `undefined.x`. `trimTypes()` now rebuilds the index itself.
 *
 * Both are exercised on the URBAN preset at the density the `terrain-showcase`
 * fixture actually runs — the one combination in the repo that reliably drives
 * the trim, because a city prop mix lights up more distinct types than the
 * 22-type budget can hold.
 */

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { SCATTER_COVERAGE, SCATTER_LIMITS } from '../src/core/config';
import { Terrain } from '../src/world/Terrain';
import type { BiomeName } from '../src/world/Biomes';
import { Scatter } from '../src/world/Scatter';

/** `03-terrain-closeup`'s own inputs: MAP_PRESETS.urban through scatter.system.ts. */
const URBAN_FIXTURE = { biome: 'temperate' as BiomeName, urban: 0.95, density: 0.6 };

function rig(biome: BiomeName, urban: number, densityScale: number): Scatter {
  const scene = new THREE.Scene();
  const terrain = new Terrain({ scene, seed: 0x7e44a1, biome, anisotropy: 1 });
  return new Scatter({
    scene, terrain, biome, seed: 0x5ca77e, urban, densityScale,
    preferred: ['tree', 'bush', 'rock'],
  });
}

describe('Scatter — the trim runs BEFORE the coverage gate', () => {
  it('drives the trim on the urban fixture, so the rest of this file means something', () => {
    const scatter = rig(URBAN_FIXTURE.biome, URBAN_FIXTURE.urban, URBAN_FIXTURE.density);
    scatter.generate();
    // The whole point of these assertions is the trimming path. If a roster
    // change ever stops this combination from trimming, the tests below go
    // green while testing nothing, so say so out loud here.
    expect(
      scatter.stats().types,
      'urban fixture no longer saturates the type budget — pick another combination',
    ).toBe(SCATTER_LIMITS.maxTypes);
    scatter.dispose();
  });

  it('never exceeds the draw-call type budget', () => {
    for (const [urban, density] of [[0.95, 0.6], [0.25, 1.0], [0.45, 0.85]] as const) {
      const scatter = rig('temperate', urban, density);
      scatter.generate();
      expect(scatter.stats().types).toBeLessThanOrEqual(SCATTER_LIMITS.maxTypes);
      scatter.dispose();
    }
  });

  it('reports the coverage of what is actually DRAWN, not of what was placed', () => {
    const scatter = rig(URBAN_FIXTURE.biome, URBAN_FIXTURE.urban, URBAN_FIXTURE.density);
    scatter.generate();
    const reported = scatter.lastReport!;
    // Re-run the validator against the live placement list. Any pass that
    // removed a prop after `lastReport` was taken shows up here as a
    // disagreement — which is exactly what the trim used to do.
    const actual = scatter.validateCoverage();
    expect(actual.emptyPatches.length).toBe(reported.emptyPatches.length);
    expect(actual.adornedFraction).toBeCloseTo(reported.adornedFraction, 6);
    expect(actual.propsPerHectare).toBeCloseTo(reported.propsPerHectare, 6);
    expect(reported.passes, 'the gate must still pass on a trimming map').toBe(true);
    expect(reported.adornedFraction).toBeGreaterThanOrEqual(SCATTER_COVERAGE.targetAdorned);
    scatter.dispose();
  });

  it('leaves the min-spacing index consistent with the compacted placement list', () => {
    /*
     * The crash this guards. `place()` inserts `placements.length` into a cell
     * bucket before pushing; the trim compacts `placements` behind it. If the
     * index is not rebuilt, the next `tooClose()` walks a chain into an index
     * past the end of the array. Reaching in through the private fields is
     * deliberate: the failure is an internal invariant and there is no public
     * surface that exposes it before the whole boot falls over.
     */
    const scatter = rig(URBAN_FIXTURE.biome, URBAN_FIXTURE.urban, URBAN_FIXTURE.density);
    scatter.generate();
    const internals = scatter as unknown as {
      bucketHead: Int32Array; bucketNext: Int32Array;
      placements: readonly { x: number; z: number }[];
    };
    const n = internals.placements.length;
    expect(n).toBeGreaterThan(0);
    let chained = 0;
    for (let head = 0; head < internals.bucketHead.length; head++) {
      let i = internals.bucketHead[head];
      let guard = 0;
      while (i >= 0) {
        expect(i, 'bucket chain points past the end of placements').toBeLessThan(n);
        expect(internals.placements[i], `placement ${i} is missing`).toBeDefined();
        chained++;
        i = internals.bucketNext[i];
        expect(++guard, 'bucket chain does not terminate').toBeLessThan(n + 2);
      }
    }
    // Every live placement is reachable exactly once, or the spacing test is
    // silently checking a subset of the map.
    expect(chained).toBe(n);
    scatter.dispose();
  });

  it('leaves no placement orphaned by a type that did not survive', () => {
    /*
     * The other half of "the report describes what is drawn": a placement
     * whose type was trimmed is never uploaded, so if one survives in the list
     * it is counted by `validateCoverage` and by `propsPerHectare` while
     * contributing nothing to the frame. The trim compacts them out; this is
     * the assertion that it still does after being moved.
     */
    const scatter = rig(URBAN_FIXTURE.biome, URBAN_FIXTURE.urban, URBAN_FIXTURE.density);
    scatter.generate();
    const internals = scatter as unknown as {
      placements: readonly { defIndex: number }[];
      types: readonly { defIndex: number }[];
    };
    const live = new Set(internals.types.map((t) => t.defIndex));
    for (const p of internals.placements) {
      expect(live.has(p.defIndex), `placement of trimmed type ${p.defIndex} survived`).toBe(true);
    }
    scatter.dispose();
  });
});

describe('Scatter — the 25x25 m gate only judges ground it can act on', () => {
  /**
   * `07-soviet-base` failed scorecard #15 (weight 3) on one 26 m patch at
   * (201, 245) that no setting could close: sampled at 2 m, all 196 points in
   * it sat inside a scenario exclusion disc, so `placeable` was 0 across the
   * square and `legal()` rejected every filler at every one of ~600 attempts.
   * The patch scan ran over `walkable` (water/cliff/impassable removed) while
   * the fillers ran over `placeable` (structures and exclusions removed too),
   * so the gate was asserting a property of ground the module cannot touch.
   *
   * Reproduced here directly: exclude a region outright and check the gate does
   * not then report it as an unadorned patch.
   */
  it('does not report an exclusion-covered square as an unadorned patch', () => {
    const scatter = rig('temperate', 0.25, 1.0);
    // A 60 m disc at the map centre — comfortably larger than the 25 m rule,
    // and the shape `scatter.system.ts` adds around every building and ore field.
    scatter.addExclusion(256, 256, 60);
    scatter.generate();
    const report = scatter.lastReport!;
    for (const p of report.emptyPatches) {
      const d = Math.hypot(p.x - 256, p.z - 256);
      expect(d, `patch at (${p.x}, ${p.z}) is inside the exclusion the placer may not use`)
        .toBeGreaterThan(60);
    }
    scatter.dispose();
  });

  it('still fails on genuinely empty ground, so the gate can still catch something', () => {
    // The corrected domain must not have turned the gate into a rubber stamp:
    // with no props at all and no exclusions, every walkable square is a
    // violation and the validator has to say so.
    const scatter = rig('temperate', 0.25, 1.0);
    const report = scatter.validateCoverage();
    expect(report.emptyPatches.length).toBeGreaterThan(10);
    expect(report.passes).toBe(false);
    scatter.dispose();
  });
});

/*
 * ==========================================================================
 * THE MEASUREMENT FRAME OF SCORECARD #34, WRITTEN DOWN SO IT IS NOT RE-DERIVED
 * ==========================================================================
 * SETTLED 2026-08-17: `tools/metrics.mjs` no longer GATES on #34. It scored
 * "Sobel |grad|>25 coverage" against the RA3 band in `docs/grade-baseline.json`,
 * [0.599, 0.855], and every one of the thirteen fixtures failed it. Two separate
 * investigations went into why. The answer is not in the scene, the check is
 * `w: 0` now, and the full evidence is in that file's header — read it there
 * rather than re-deriving it here.
 *
 * Sobel coverage on flat-shaded art is a BOUNDARY DENSITY: a step edge lights
 * about two pixel columns, so coverage ~= 2 * L / A for L pixels of visible
 * contrast boundary in A pixels of frame. 0.60 therefore asks for a boundary
 * roughly every 3.3 px, everywhere — which at `03-terrain-closeup`'s 36 px/m is
 * a feature every 9 cm of ground. CLAUDE.md bans exactly that: "if per-pixel
 * noise is visible at gameplay zoom, it is wrong." Measured directly: gaussian
 * luma noise at sigma = 8/255 takes ANY of the thirteen to the RA3 median of
 * 0.745, which is what the band is really asking for.
 *
 * The band was measured on fourteen references that are 1440x1080 or 1024x768
 * JPEGs (`docs/SPEC_DRIFT_AUDIT.md` finding 17). Coverage is not scale
 * invariant, and JPEG ringing manufactures more of it. Measured across all
 * thirteen captures at the corpus's own two geometries and format, combined
 * 10:4 the way the corpus is, the correction is **1.264 +/- 0.039** — and it is
 * not enough: normalised into that frame, ZERO of thirteen reach the 0.599
 * floor. The best gets to 0.5719. Resolution supplies about 29% of the gap in
 * log terms and per-pixel noise is the rest.
 *
 * An earlier spot check here read `01-base 1024x768 JPEG q75 = 0.5972` against
 * a 0.599 floor and made the gap look like rounding. That was one fixture at
 * the corpus's SMALLEST geometry; over all thirteen at the 10:4 mix it is not
 * close.
 *
 * The checks below are the load-bearing half of that, as executable facts
 * rather than a paragraph: the estimator's own scale sensitivity, on a figure
 * with a fixed number of real edges. They stay green and stay relevant — they
 * are why the gate came off.
 */
describe('scorecard #34 — the estimator is not scale invariant', () => {
  /** `tools/metrics.mjs`'s kernel and threshold, verbatim. */
  function edgeCoverage(gray: Uint8Array, W: number, H: number): number {
    let hits = 0;
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        const gx = -gray[i - W - 1] - 2 * gray[i - 1] - gray[i + W - 1]
          + gray[i - W + 1] + 2 * gray[i + 1] + gray[i + W + 1];
        const gy = -gray[i - W - 1] - 2 * gray[i - W] - gray[i - W + 1]
          + gray[i + W - 1] + 2 * gray[i + W] + gray[i + W + 1];
        if (Math.hypot(gx, gy) > 25) hits++;
      }
    }
    return hits / (W * H);
  }

  /** A scene with a FIXED feature count, rendered at a given pixel size. */
  function stripes(W: number, H: number, features: number): Uint8Array {
    const g = new Uint8Array(W * H);
    const pitch = W / features;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) g[y * W + x] = Math.floor(x / pitch) % 2 === 0 ? 60 : 160;
    }
    return g;
  }

  it('reports more coverage for the same content at a smaller size', () => {
    const FEATURES = 40;
    const big = edgeCoverage(stripes(2560, 1440, FEATURES), 2560, 1440);
    const small = edgeCoverage(stripes(1024, 768, FEATURES), 1024, 768);
    // Same forty boundaries in both. The only thing that changed is how many
    // pixels each boundary is a fraction of.
    expect(small).toBeGreaterThan(big * 2.0);
  });

  it('is a boundary-density measure: coverage scales with feature count', () => {
    const c20 = edgeCoverage(stripes(2560, 1440, 20), 2560, 1440);
    const c80 = edgeCoverage(stripes(2560, 1440, 80), 2560, 1440);
    expect(c80 / c20).toBeGreaterThan(3.5);
    expect(c80 / c20).toBeLessThan(4.5);
  });

  it('needs a boundary every ~3 px to reach the enforced 0.60 floor', () => {
    // The number that decides the whole question. 2560 / 0.60 * 2 ~= 8500
    // boundaries across the frame; below that the band is unreachable however
    // the art is authored.
    const W = 2560, H = 1440;
    let features = 100;
    while (features < 4000 && edgeCoverage(stripes(W, H, features), W, H) < 0.60) features *= 2;
    const pitchPx = W / features;
    expect(pitchPx).toBeLessThan(4.0);
  });
});
