/**
 * ============================================================================
 * tests/armies-wire.spec.ts — the lobby's army count must reach the world
 * ============================================================================
 * `setPlannedArmies()` shipped EXPORTED, documented over sixteen lines as
 * "Called by the skirmish lobby", and with ZERO CALLERS anywhere in `src/`,
 * `tests/`, `tools/` or `server/`. One commit taught the lobby, the shell and
 * the radar to count to four. Another taught the start table to count to four.
 * Neither owned the wire between them, and nothing was looking at the join.
 *
 * Measured on the real call chain — four players seated exactly as
 * `Shell.applySetupToWorld` seats them, then `buildScenario(world, 'skirmish',
 * seed, {})` with the argument list `scenarios.system.ts` actually passes:
 *
 *     plannedScenario().armies = 2      plannedStartPoints() = 3 shelves
 *     seated players = 4
 *       p0 assets=6   p1 assets=7   p2 assets=0   p3 assets=0
 *
 * So choosing 3-Way or 4-Way in the lobby produced two armies that opened with
 * NOTHING, and an unearned victory about eight seconds later.
 *
 * WHY THE EXISTING FOUR-ARMY TEST DID NOT CATCH IT, which is the whole reason
 * this file exists separately. `tests/archipelago.spec.ts` proves four bases on
 * four different islands — by passing `{ armies: 4 }` EXPLICITLY. It is the
 * only caller in the repo that does. It therefore exercises the scenario
 * builder's four-army support perfectly while stepping straight over the
 * channel a player actually goes through. A test can be entirely correct about
 * the thing it tests and still leave the feature disconnected.
 *
 * So these cases pass NO `armies` option. Everything they assert has to arrive
 * through the module channel the shell writes, or not at all.
 * ============================================================================
 */

import * as THREE from 'three';
import { DEFAULT_SEED } from '../src/core/config';
import { afterEach, describe, expect, it } from 'vitest';

import { World } from '../src/core/world';
import { EntityKind, Faction } from '../src/core/types';
import { Terrain, setActiveTerrain } from '../src/world/Terrain';
import {
  buildScenario, plannedScenario, resetScenarioPlan, setPlannedArmies, startPointsFor,
} from '../src/game/Scenarios';

const SEED = 0x7e44a1;

function build(armies: number): Terrain {
  return new Terrain({
    scene: new THREE.Scene(),
    seed: SEED,
    biome: 'temperate' as never,
    anisotropy: 1,
    starts: startPointsFor(armies, null, DEFAULT_SEED).map((p) => ({ x: p.x, z: p.z })),
    sea: null,
  });
}

/** Seat N armies the way `applySetupToWorld` does, then open a skirmish. */
function openMatch(seated: number): { world: World; terrain: Terrain } {
  const terrain = build(seated);
  setActiveTerrain(terrain);
  const world = new World();
  world.addPlayer(Faction.Allies, 'Commander', true, true);
  for (let i = 1; i < seated; i++) {
    world.addPlayer(i === 1 ? Faction.Soviets : Faction.Meridian, `AI ${i}`, false, false);
  }
  world.terrain = terrain;
  // NO `armies` KEY. This is the argument list `scenarios.system.ts` passes.
  buildScenario(world, 'skirmish', SEED, { start: 'base' });
  return { world, terrain };
}

/** Assets each non-neutral player opened with — buildings plus units. */
function assetsByOwner(world: World): number[] {
  const out: number[] = [];
  for (let p = 0; p < world.players.length; p++) {
    out.push(world.players[p]!.faction === Faction.Neutral ? -1 : 0);
  }
  const st = world.store;
  for (let a = 0; a < st.aliveCount; a++) {
    const i = st.alive[a]!;
    if (st.kind[i] !== EntityKind.Building && st.kind[i] !== EntityKind.Vehicle
      && st.kind[i] !== EntityKind.Infantry) continue;
    const o = st.owner[i]!;
    if (out[o] !== undefined && out[o]! >= 0) out[o]!++;
  }
  return out;
}

afterEach(() => {
  resetScenarioPlan();
  setPlannedArmies(null);
});

describe('the army count the lobby chose reaches the world', () => {
  it('defaults to two when nothing sets it', () => {
    resetScenarioPlan();
    setPlannedArmies(null);
    expect(plannedScenario().armies, 'a duel is still the default').toBe(2);
  });

  it('carries a four-way through the plan channel', () => {
    resetScenarioPlan();
    setPlannedArmies(4);
    expect(plannedScenario().armies).toBe(4);
  });

  /**
   * THE CASE THAT FAILS WITHOUT THE WIRE. Verified by reverting the
   * `setPlannedArmies` call in `Shell.bootGame`: `armies` falls back to 2, the
   * scenario opens two bases, and p2/p3 come back with 0 assets each.
   */
  it('opens every seated army, not just the first two', () => {
    resetScenarioPlan();
    setPlannedArmies(4);
    const { world } = openMatch(4);

    const assets = assetsByOwner(world);
    const armies = assets.filter((n) => n >= 0);
    expect(armies.length, 'four non-neutral players are seated').toBe(4);

    const empty: number[] = [];
    for (let p = 0; p < assets.length; p++) if (assets[p] === 0) empty.push(p);
    expect(
      empty,
      'an army that opens with nothing cannot play, and the match ends in an '
      + 'unearned victory about eight seconds in — this is exactly what '
      + '`Shell.verifyArmies` logs, to a console nobody reads',
    ).toEqual([]);
  });

  it('still opens exactly two for a duel, so nothing leaked', () => {
    resetScenarioPlan();
    setPlannedArmies(2);
    const { world } = openMatch(2);
    const armies = assetsByOwner(world).filter((n) => n >= 0);
    expect(armies.length).toBe(2);
    for (const n of armies) expect(n).toBeGreaterThan(0);
  });

  /**
   * `null` is "the default two", and clearing it is what stops a four-way lobby
   * leaking into the tutorial, the title backdrop, or a PvP match whose slot
   * count comes from the relay rather than from settings.
   *
   * AND THE ORDER IS LOAD-BEARING, which this case exists to pin. The plan is
   * MEMOISED: once `plannedScenario()` has answered, neither setting nor
   * clearing moves it until `resetScenarioPlan()` drops the memo. So a caller
   * that clears AFTER the first read has done nothing at all.
   *
   * That is why `Shell.bootGame` calls `resetScenarioPlan()` first and
   * `setPlannedArmies()` immediately after, before anything can read the plan —
   * the same ordering, and the same reason, as the `resetTerrainPlan()` call
   * beside it, which was itself added after both sea maps shipped dry because a
   * stale memo outlived the lobby's choice.
   */
  it('goes back to two when cleared — on the next reset, which is the contract', () => {
    resetScenarioPlan();
    setPlannedArmies(4);
    expect(plannedScenario().armies).toBe(4);

    // Cleared, but the plan has already answered: the memo still says four.
    setPlannedArmies(null);
    expect(plannedScenario().armies, 'a memoised plan does not move under you').toBe(4);

    // The reset is what makes the clear take effect.
    resetScenarioPlan();
    expect(plannedScenario().armies).toBe(2);
  });
});
