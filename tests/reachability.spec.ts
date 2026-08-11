/**
 * ============================================================================
 * tests/reachability.spec.ts — NOTHING SPAWNS IN A PIT IT CANNOT LEAVE
 * ============================================================================
 * Reported bug: "starting a game with valleys, spawned tanks for example stuck
 * inside the valley and cant get out."
 *
 * `Terrain.ensureConnectivity()` labels connected passable regions and carves
 * ramps between them, but it deliberately gives up in three places:
 *
 *   - regions smaller than TERRAIN_MIN_REGION_CELLS (28) are left stranded
 *   - `linkRegion` fails when no ramp fits inside TERRAIN_RAMP_MAX_LINK_CELLS
 *     / TERRAIN_RAMP_MAX_LENGTH
 *   - the carver stops at TERRAIN_MAX_RAMPS (30) or six passes
 *
 * All three are reasonable on their own. The bug is that NOTHING then checks
 * that the cells a scenario spawns into survived as part of the main region.
 * A pocket that is intentionally left stranded is fine; an army standing in it
 * is not.
 *
 * These tests own that invariant. They flood-fill the passable grid through the
 * public API only (`isPassable`), so they measure what a unit's pathfinder can
 * actually traverse rather than what generation intended.
 * ============================================================================
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Terrain } from '../src/world/Terrain';
import { BIOME_NAMES } from '../src/world/Biomes';
import { Locomotor } from '../src/core/types';
import { CELL, MAP_CELLS, MAP_SIZE } from '../src/core/config';

/** Cells a scenario actually drops an army into, as a radius in metres. */
const SPAWN_RADIUS_M = 48;

function build(seed: number, biome: string): Terrain {
  const scene = new THREE.Scene();
  const t = new Terrain({ scene, seed, biome: biome as never, anisotropy: 1 });
  t.generate();
  return t;
}

/**
 * Label connected passable regions for one locomotor, 4-connected — the same
 * connectivity a grid pathfinder uses. Returns the label grid plus region sizes
 * indexed from 1.
 */
function labelRegions(t: Terrain, loco: Locomotor): { label: Int32Array; sizes: number[] } {
  const label = new Int32Array(MAP_CELLS * MAP_CELLS).fill(0);
  const sizes: number[] = [0];
  const stack: number[] = [];
  let next = 1;

  for (let z = 0; z < MAP_CELLS; z++) {
    for (let x = 0; x < MAP_CELLS; x++) {
      const start = z * MAP_CELLS + x;
      if (label[start] !== 0 || !t.isPassable(x, z, loco)) continue;

      const id = next++;
      let size = 0;
      stack.length = 0;
      stack.push(start);
      label[start] = id;

      while (stack.length > 0) {
        const i = stack.pop() as number;
        size++;
        const cx = i % MAP_CELLS;
        const cz = (i / MAP_CELLS) | 0;
        // 4-connected: a diagonal gap is not a corridor a unit can drive.
        if (cx > 0) push(i - 1, cx - 1, cz);
        if (cx < MAP_CELLS - 1) push(i + 1, cx + 1, cz);
        if (cz > 0) push(i - MAP_CELLS, cx, cz - 1);
        if (cz < MAP_CELLS - 1) push(i + MAP_CELLS, cx, cz + 1);
      }
      sizes[id] = size;

      function push(idx: number, nx: number, nz: number): void {
        if (label[idx] !== 0 || !t.isPassable(nx, nz, loco)) return;
        label[idx] = id;
        stack.push(idx);
      }
    }
  }
  return { label, sizes };
}

function mainRegion(sizes: number[]): number {
  let best = 1;
  for (let k = 2; k < sizes.length; k++) if (sizes[k] > sizes[best]) best = k;
  return best;
}

/**
 * Every passable cell inside the spawn footprint that is NOT joined to the main
 * region. These are the pockets an army can be dropped into and never leave.
 */
function strandedSpawnCells(t: Terrain, loco: Locomotor): { stranded: number; total: number; worst: number } {
  return strandedFrom(t, loco, labelRegions(t, loco));
}

/**
 * The counting half of `strandedSpawnCells`, split out so a caller that has
 * ALREADY labelled the grid does not label it a second time.
 *
 * This split is the whole reason this file stopped timing out. See the note on
 * `trackScan` below.
 */
function strandedFrom(
  t: Terrain,
  loco: Locomotor,
  { label, sizes }: { label: Int32Array; sizes: number[] },
): { stranded: number; total: number; worst: number } {
  const main = mainRegion(sizes);
  const c = (MAP_SIZE * 0.5) / CELL;
  const r = SPAWN_RADIUS_M / CELL;

  let stranded = 0;
  let total = 0;
  let worst = 0;
  for (let z = Math.floor(c - r); z <= Math.ceil(c + r); z++) {
    for (let x = Math.floor(c - r); x <= Math.ceil(c + r); x++) {
      if (x < 0 || z < 0 || x >= MAP_CELLS || z >= MAP_CELLS) continue;
      if (Math.hypot(x - c, z - c) > r) continue;
      if (!t.isPassable(x, z, loco)) continue;
      total++;
      const id = label[z * MAP_CELLS + x];
      if (id !== main) {
        stranded++;
        worst = Math.max(worst, sizes[id]);
      }
    }
  }
  return { stranded, total, worst };
}

/* ------------------------------------------------------------------ */

const SEEDS = [1, 3, 5, 7, 9, 11, 13, 4242, 0x7e44a1, 0xbeef];

/**
 * Seeds from OUTSIDE the ten above, kept as named regression guards.
 *
 * The ten seeds in `SEEDS` are the ones the fix was developed against, so on
 * their own they cannot show that it generalises. A sweep of 50 further random
 * seeds across all four biomes (200 combinations) found the spawn invariant
 * held everywhere, but turned up three maps that failed the "90% mutually
 * reachable" bar below — each with a single large plateau, 1357 to 4159 cells,
 * standing one terrace above the main landmass behind a cliff with no water
 * anywhere on its boundary. `ensureConnectivity` queued them and `linkRegion`
 * could not land a corridor inside `TERRAIN_RAMP_MAX_LENGTH`, so they were
 * abandoned silently.
 *
 * Measured on the pre-fix generator these three were already broken — 84.9%,
 * 61.5% and 78.5% — so they are a pre-existing defect the spawn fix exposed
 * rather than caused. `ensureMajorRegions` is what reclaims them. They are
 * pinned here by name because a random sweep that happens not to draw them
 * would let that regress unnoticed.
 */
const WIDE_CASES: readonly (readonly [string, number])[] = [
  ['temperate', 482126],
  ['desert', 982980],
  ['desert', 802294],
  // Ordinary members of the same sweep, to keep the sample honest rather than
  // exclusively adversarial.
  ['temperate', 581779],
  ['snow', 616329],
  ['urban', 290141],
  ['desert', 445592],
];

/**
 * ONE GENERATION AND ONE LABELLING PER (BIOME, SEED), SHARED BY BOTH TRACKED
 * TESTS.
 *
 * The two tests below ask different questions of the IDENTICAL 4x10 grid of
 * terrains, both for `Locomotor.Track`. Each used to call `build()` itself and
 * then label the grid itself — so every one of the forty maps was generated
 * twice and flood-filled twice, for two numbers that fall out of a single pass.
 *
 * That doubling is why this file ran ~120 s against a 120 s `testTimeout` with
 * no headroom at all, and it timed out for real once the suite grew. The budget
 * was measuring how busy the machine was rather than whether the terrain is
 * connected — the same defect CLAUDE.md records for the perf-hud GC counter
 * that "tracked V8's new-space size rather than the code".
 *
 * Computed lazily rather than in `beforeAll` on purpose: a hook carries the
 * same clock as a test, so moving the work there would have moved the timeout
 * rather than removed it. The scan is what got cheaper.
 *
 * `dispose()` still happens exactly once per terrain, inside the scan.
 */
interface TrackCase {
  biome: string;
  seed: number;
  stranded: number;
  total: number;
  worst: number;
  /** Fraction of passable ground held by the largest region. */
  frac: number;
}

let trackCases: TrackCase[] | null = null;

function trackScan(): TrackCase[] {
  if (trackCases !== null) return trackCases;
  const out: TrackCase[] = [];
  for (const biome of BIOME_NAMES) {
    for (const seed of SEEDS) {
      const t = build(seed, biome);
      // Tracked is the strictest common case: it cannot cross water or cliff
      // and it is what the reported bug was about (tanks).
      const labelled = labelRegions(t, Locomotor.Track);
      const r = strandedFrom(t, Locomotor.Track, labelled);
      const { sizes } = labelled;
      const main = mainRegion(sizes);
      let total = 0;
      for (let k = 1; k < sizes.length; k++) total += sizes[k];
      t.dispose();
      out.push({
        biome, seed,
        stranded: r.stranded, total: r.total, worst: r.worst,
        frac: total > 0 ? sizes[main] / total : 1,
      });
    }
  }
  trackCases = out;
  return out;
}

describe('terrain reachability', () => {
  it('leaves no passable pocket inside the spawn area cut off from the map', () => {
    const failures: string[] = [];
    for (const c of trackScan()) {
      if (c.stranded > 0) {
        failures.push(
          `${c.biome}/seed=${c.seed}: ${c.stranded}/${c.total} spawn-area cells stranded ` +
            `(largest stranded pocket ${c.worst} cells)`,
        );
      }
    }
    expect(failures, `\n${failures.join('\n')}\n`).toEqual([]);
  });

  it('keeps the overwhelming majority of passable ground mutually reachable', () => {
    const bad: string[] = [];
    for (const c of trackScan()) {
      // A few tiny ledges are acceptable; a map cut into competing halves is
      // not, because the AI on the far side can never reach the player.
      if (c.frac < 0.9) {
        bad.push(`${c.biome}/seed=${c.seed}: main region holds ${(c.frac * 100).toFixed(1)}% of passable ground`);
      }
    }
    expect(bad, `\n${bad.join('\n')}\n`).toEqual([]);
  });

  it('reports infantry are never stranded where tracked units are not', () => {
    // Foot has the loosest rules, so anywhere a tank can stand and escape,
    // infantry must too. A mismatch means the locomotor cost tables disagree.
    const bad: string[] = [];
    for (const seed of SEEDS.slice(0, 4)) {
      const t = build(seed, 'temperate');
      const foot = strandedSpawnCells(t, Locomotor.Foot);
      t.dispose();
      if (foot.stranded > 0) bad.push(`temperate/seed=${seed}: ${foot.stranded} infantry spawn cells stranded`);
    }
    expect(bad, `\n${bad.join('\n')}\n`).toEqual([]);
  });

  it('holds on seeds the fix was not developed against', () => {
    // Same two invariants as above, on the pinned out-of-sample seeds. Kept as
    // one test over an explicit (biome, seed) list rather than another full
    // cross product, so the guard costs six map builds instead of forty.
    const bad: string[] = [];

    for (const [biome, seed] of WIDE_CASES) {
      const t = build(seed, biome);
      const track = strandedSpawnCells(t, Locomotor.Track);
      const foot = strandedSpawnCells(t, Locomotor.Foot);
      const { sizes } = labelRegions(t, Locomotor.Track);
      const main = mainRegion(sizes);
      let total = 0;
      for (let k = 1; k < sizes.length; k++) total += sizes[k];
      const frac = total > 0 ? sizes[main] / total : 1;
      t.dispose();

      if (track.stranded > 0) {
        bad.push(`${biome}/seed=${seed}: ${track.stranded}/${track.total} tracked spawn cells stranded`);
      }
      if (foot.stranded > 0) {
        bad.push(`${biome}/seed=${seed}: ${foot.stranded}/${foot.total} infantry spawn cells stranded`);
      }
      if (frac < 0.9) {
        bad.push(`${biome}/seed=${seed}: main region holds ${(frac * 100).toFixed(1)}% of passable ground`);
      }
    }

    expect(bad, `\n${bad.join('\n')}\n`).toEqual([]);
  });
});
