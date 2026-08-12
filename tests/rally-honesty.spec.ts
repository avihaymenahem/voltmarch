/**
 * ============================================================================
 * tests/rally-honesty.spec.ts — the flag must not promise what the sim refuses
 * ============================================================================
 * Two carried defects from the v1.2.0 bucket, both of them the HUD telling the
 * player something the simulation will not honour.
 *
 * (3) THE FLAG OVER-PROMISES INSIDE A FOOTPRINT. A rally point dropped on a
 *     structure is drawn where the player clicked, but `terrain.isOccupied`
 *     closes those cells in the flowfield's hard grid, `Movement.canStand`
 *     refuses to put a hull centre in a closed cell, and `NavAssigner` copies
 *     `orderX/orderZ` into the goal VERBATIM. The arrival test then measures
 *     against that unreachable point, so it can never fire: the unit grinds
 *     through the wedge ladder and parks several metres short of a flag that is
 *     still drawn at the click.
 *
 * (4) THE TETHER CROSSES ITS OWN ROOF. It was anchored at `posX/posZ` — the
 *     footprint CENTRE — and the overlay canvas paints over the scene with no
 *     depth test, so the line was drawn straight across the building's body.
 *
 * WHAT IS DELIBERATELY NOT CLAIMED. Anchoring at the front face does not stop a
 * flag set BEHIND a structure from crossing it; nothing short of a depth test
 * does. And the snap handles OCCUPANCY only — a rally clicked onto a cliff or
 * into water looks identical and is a separate defect, left alone here because
 * testing passability without a per-factory move class would shove a Naval
 * Yard's rally off the water.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { Terrain } from '../src/world/Terrain';
import { World } from '../src/core/world';
import { Faction } from '../src/core/types';
import { CELL, MAP_SIZE } from '../src/core/config';
import { worldToCell } from '../src/core/math';
import { snapRallyClear } from '../src/sim/Placement';

const CX = MAP_SIZE * 0.5;
const CZ = MAP_SIZE * 0.5;

/**
 * THE CONSTRUCTOR ALREADY GENERATED — `Terrain` ends its constructor in
 * `adopt(fields)` or `generate()`, and nothing here passes prewarmed `fields`.
 * The `t.generate()` that used to sit below rebuilt the heightfield, the ramp
 * carver, the splat and all 64 chunk meshes for a result already in hand, once
 * per `rig()` and this file calls `rig()` eight times. Idempotency was
 * re-measured, not assumed: see the note on `build()` in
 * `tests/reachability.spec.ts` for the columns that were compared.
 */
function rig(): World {
  const world = new World();
  world.addPlayer(Faction.Allies, 'Commander', true, true);
  const scene = new THREE.Scene();
  world.terrain = new Terrain({ scene, seed: 4242, biome: 'temperate', anisotropy: 1 });
  return world;
}

/** Occupy a w x h block of cells centred near (x, z). Returns its origin cell. */
function occupy(world: World, x: number, z: number, w: number, h: number): [number, number] {
  const ox = worldToCell(x) - ((w / 2) | 0);
  const oz = worldToCell(z) - ((h / 2) | 0);
  world.terrain.markOccupied(ox, oz, w, h, 1 as never);
  return [ox, oz];
}

const out = new Float64Array(2);

/* ========================================================================== */

describe('a rally point is snapped out of a footprint', () => {
  it('moves a flag dropped in the middle of a structure', () => {
    const world = rig();
    occupy(world, CX, CZ, 4, 4);
    const moved = snapRallyClear(world, CX, CZ, out);
    expect(moved, 'a point inside a footprint must be corrected').toBe(true);
    expect(world.terrain.isOccupied(worldToCell(out[0]), worldToCell(out[1])),
      'and it must land somewhere a hull can actually stand').toBe(false);
  });

  it('leaves a flag on clear ground exactly where it was clicked', () => {
    // The common case by far. A snap that nudged every rally point would be a
    // worse lie than the one it replaced.
    const world = rig();
    occupy(world, CX, CZ, 4, 4);
    const x = CX + 40;
    const z = CZ + 40;
    expect(snapRallyClear(world, x, z, out)).toBe(false);
    expect(out[0]).toBe(x);
    expect(out[1]).toBe(z);
  });

  it('slides along ONE axis, so the flag keeps the aim the player had', () => {
    // Nearest EDGE, not nearest cell centre: a cell-centre snap can move the
    // point up to 2.8 m diagonally and lands it somewhere the player was not
    // pointing.
    const world = rig();
    occupy(world, CX, CZ, 4, 4);
    // Well off-centre inside the block, so one axis is clearly nearer out.
    const x = CX + CELL * 1.2;
    const z = CZ - CELL * 0.1;
    snapRallyClear(world, x, z, out);
    const movedX = Math.abs(out[0] - x) > 1e-9;
    const movedZ = Math.abs(out[1] - z) > 1e-9;
    expect(movedX !== movedZ, 'exactly one axis may change').toBe(true);
  });

  it('is idempotent — snapping a snapped point changes nothing', () => {
    // It runs on every SetRally, on the production default AND on every load,
    // so a point that crept a little further out on each pass would walk away
    // from the building over a long game.
    const world = rig();
    occupy(world, CX, CZ, 4, 4);
    snapRallyClear(world, CX, CZ, out);
    const x1 = out[0];
    const z1 = out[1];
    expect(snapRallyClear(world, x1, z1, out)).toBe(false);
    expect(out[0]).toBe(x1);
    expect(out[1]).toBe(z1);
  });

  it('gives up rather than teleporting the flag across a huge blocked field', () => {
    // A wall run longer than the search limit. Leaving the click alone is the
    // honest failure: moving it 40 m would be a bigger lie than not moving it.
    const world = rig();
    occupy(world, CX, CZ, 40, 40);
    const moved = snapRallyClear(world, CX, CZ, out);
    expect(moved).toBe(false);
    expect(out[0]).toBe(CX);
    expect(out[1]).toBe(CZ);
  });

  it('never returns NaN or the origin, whatever it is handed', () => {
    // This value reaches `orderX/orderZ` and then a nav goal. A NaN here is the
    // exact route by which this repo once got a fully black frame.
    const world = rig();
    occupy(world, CX, CZ, 6, 6);
    const cases: ReadonlyArray<readonly [number, number]> = [
      [CX, CZ], [0, 0], [-500, -500], [MAP_SIZE * 2, MAP_SIZE * 2],
      [NaN, CZ], [CX, NaN], [Infinity, CZ],
    ];
    for (const [x, z] of cases) {
      snapRallyClear(world, x, z, out);
      expect(Number.isFinite(out[0]), `x from (${x}, ${z})`).toBe(true);
      expect(Number.isFinite(out[1]), `z from (${x}, ${z})`).toBe(true);
      expect(out[0]).toBeGreaterThanOrEqual(0);
      expect(out[0]).toBeLessThanOrEqual(MAP_SIZE);
      expect(out[1]).toBeGreaterThanOrEqual(0);
      expect(out[1]).toBeLessThanOrEqual(MAP_SIZE);
    }
  });

  it('is deterministic — the same click and grid always give the same answer', () => {
    // It runs inside `simTick` on the command path, so a tie broken by
    // iteration order or by anything clock-like would desync a replay.
    const world = rig();
    occupy(world, CX, CZ, 5, 5);
    const first = new Float64Array(2);
    snapRallyClear(world, CX, CZ, first);
    for (let k = 0; k < 8; k++) {
      snapRallyClear(world, CX, CZ, out);
      expect(out[0]).toBe(first[0]);
      expect(out[1]).toBe(first[1]);
    }
  });
});

/* ========================================================================== */

describe('every writer of the rally map goes through the snap', () => {
  const read = (rel: string): string =>
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    (require('node:fs') as typeof import('node:fs'))
      .readFileSync(require('node:path').join(__dirname, '..', rel), 'utf8');

  it('the player command path', () => {
    expect(read('src/input/Commands.ts')).toContain('snapRallyClear(this.world, cmd.x, cmd.z');
  });

  it('the production service, for both setRally and the default', () => {
    const src = read('src/sim/Production.ts');
    const hits = src.match(/snapRallyClear\(/g) ?? [];
    expect(hits.length, 'setRally AND defaultRally').toBeGreaterThanOrEqual(2);
  });

  it('the save loader, AFTER occupancy is stamped', () => {
    // Ordering is the whole point here. Section 8 restores players; section 9
    // stamps `markOccupied`. A snap during the player restore would read an
    // empty grid and silently do nothing, which is how this would look fixed
    // and not be.
    const src = read('src/game/SaveGame.ts');
    const occAt = src.indexOf('-- 9. terrain occupancy');
    const snapAt = src.indexOf('snapRallyClear(world');
    expect(occAt).toBeGreaterThan(0);
    expect(snapAt, 'the load re-snap must come after the occupancy pass')
      .toBeGreaterThan(occAt);
  });
});

/* ========================================================================== */

describe('the tether anchors on the structure, not through it', () => {
  const read = (rel: string): string =>
    (require('node:fs') as typeof import('node:fs'))
      .readFileSync(require('node:path').join(__dirname, '..', rel), 'utf8');

  it('uses the exit offset rotated by the building yaw', () => {
    const src = read('src/ui/Overlay.ts');
    expect(src).toContain('exit.exitX * cos');
    expect(src).toContain('ez * cos - exit.exitX * sin');
  });

  it('clamps to the FRONT FACE, not the door', () => {
    // `exitZ` is halfDepth + clearance, so anchoring at the door detaches the
    // tether from the building by a full clearance — and pairing the line with
    // the structure is the entire feature.
    expect(read('src/ui/Overlay.ts'))
      .toContain('Math.min(exit.exitZ, exit.footprintH * CELL * 0.5)');
  });

  it('still draws with no production service bound', () => {
    // The overlay must keep working on a boot without `sim.production` — the
    // seam is pushed in, never imported, and null means "anchor at the centre",
    // which is exactly the old behaviour.
    const src = read('src/ui/Overlay.ts');
    expect(src).toContain('exits: FactoryExits | null = null');
    expect(src).toContain('const exit = exits === null ? null : exits.entryOf(handle)');
  });
});
