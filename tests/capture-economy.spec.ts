/**
 * ============================================================================
 * VOLTMARCH — tests/capture-economy.spec.ts
 * ============================================================================
 * "OCCUPYING AN ENEMY ORE BUILDING SHOULD GIVE ME HIS INCOME."
 *
 * Capture was already plumbed end to end (`src/sim/Capture.ts`) and the
 * STRUCTURAL half of ownership already followed the deed — storage cap, power,
 * prerequisites, AI `roleCount`, the OreCrisis survey — because every one of
 * those is a rescan over `store.owner` rather than a running total. The audit
 * is written out at `captureBuilding`.
 *
 * THE CREDITS DID NOT FOLLOW, and the honest description is that they were not
 * so much wrong as unfalsifiable. `HarvesterController.tickDock` deposited to
 * `store.owner[i]` — THE HAULER — while `isUsableRefinery` refuses any dock the
 * harvester is not allied to, and the only alliance this game has is with
 * yourself and with Gaia (nothing but `createPlayerState` and
 * `Scenarios.addGaia` writes `allyMask`, and no Gaia structure carries
 * `EntityFlag.IsRefinery`). So "hauler's owner" and "refinery's owner" named one
 * player in every reachable state and the feature had nowhere to live.
 *
 * §DEED in `src/sim/Harvesting.ts` is the rule these tests pin: ore is sold
 * where it is unloaded and the deed-holder is paid. Three properties matter and
 * each has a case below.
 *
 *   1. THE PAYOUT. A load emptying into a bay that changes hands is the new
 *      owner's. Before: the victim banked 700 and the captor 0. After: the
 *      captor banks 700 and the victim 0.
 *   2. NO LUMP, SO NOTHING TO FARM. Capture by itself pays exactly zero. Every
 *      credit this rule moves is ore `takeOre` removed from the ground, which
 *      is the same property `civilian.system.ts` buys with a drip instead of a
 *      capture bonus — and for the same reason, because `GarrisonService`
 *      flips a structure every time one rifleman walks in and out.
 *   3. §ANCHOR SURVIVES. The widened guard is in `tickDock` ONLY. A harvester
 *      still refuses to DRIVE to a refinery it does not own, because one that
 *      does is a harvester driving into the enemy base — the reported defect
 *      §ANCHOR exists to answer.
 *
 * The rig is `tests/harvester-orders.spec.ts`'s: flat null terrain, no nav, the
 * real `HarvesterController` and the real `Economy`, because what is under test
 * is a decision about a ledger and not locomotion.
 * ============================================================================
 */

import { afterEach, describe, expect, it } from 'vitest';

import { World } from '../src/core/world';
import { Channels } from '../src/core/events';
import { EntityFlag, EntityKind, Faction, Locomotor, UnitState } from '../src/core/types';
import type { EntityId, PlayerId, SimContext } from '../src/core/types';
import { HARVESTER_CAPACITY, ORE_VALUE, REFINERY_STORAGE, SIM_DT, SIM_HZ } from '../src/core/config';
import { Rng } from '../src/core/math';

import { Economy, OreField, setActiveEconomy } from '../src/sim/Economy';
import { HarvesterController, setHarvesterDrive } from '../src/sim/Harvesting';
import { CaptureService } from '../src/sim/Capture';
import { GarrisonService } from '../src/sim/Garrison';

/** Slot 0 loses the building; slot 1 walks the engineer in. */
const VICTIM = 0 as PlayerId;
const CAPTOR = 1 as PlayerId;

const PATCH_X = 200;
const PATCH_Z = 256;
/** The victim's near refinery — the one that gets taken. */
const REF_NEAR_X = 150;
/** Their fallback, far enough that the choice between the two is unambiguous. */
const REF_FAR_X = 380;

interface Rig {
  world: World;
  channels: Channels;
  ore: OreField;
  economy: Economy;
  harvesters: HarvesterController;
  capture: CaptureService;
  tick: number;
  step(n?: number): void;
  /** Advance until `pred` holds, or fail after `limit` ticks. */
  until(pred: () => boolean, limit: number, what: string): void;
}

function makeRig(): Rig {
  const world = new World();
  world.addPlayer(Faction.Soviets, 'Victim', true, true);
  world.addPlayer(Faction.Allies, 'Captor', false, false);
  const channels = new Channels();
  const ore = new OreField();
  const economy = new Economy(world, channels);
  const harvesters = new HarvesterController(world, channels, ore, economy);
  const capture = new CaptureService(world, channels);
  world.ore = ore;
  setHarvesterDrive('full');
  // `captureBuilding` reaches the ledger through `getEconomy()` to move the
  // storage cap with the deed. Without this the capture still works and the cap
  // silently does not, which is half of what these tests are about.
  setActiveEconomy(economy);

  // Both banks start EMPTY, so every credit either player holds at the end of a
  // case was put there by a dock in that case. `START_CREDITS` would otherwise
  // sit under every assertion as a 10 000-credit constant.
  world.player(VICTIM).credits = 0;
  world.player(CAPTOR).credits = 0;

  const rng = new Rng(4242);
  const rig: Rig = {
    world, channels, ore, economy, harvesters, capture,
    tick: 0,
    step(n = 1): void {
      for (let k = 0; k < n; k++) {
        world.store.snapshotPrev();
        rig.tick++;
        world.tick = rig.tick;
        world.time = rig.tick * SIM_DT;
        const s: SimContext = { dt: SIM_DT, tick: rig.tick, time: world.time, rng };
        economy.recomputeStorage();
        harvesters.simTick(s);
        economy.tick(s.dt, s.time);
        harvesters.drive(s.dt);
      }
    },
    until(pred: () => boolean, limit: number, what: string): void {
      for (let k = 0; k < limit && !pred(); k++) rig.step(1);
      expect(pred(), `${what} within ${limit} ticks`).toBe(true);
    },
  };
  economy.recomputeStorage();
  return rig;
}

function spawnRefinery(rig: Rig, owner: PlayerId, x: number, z: number): EntityId {
  const s = rig.world.store;
  const id = s.alloc(EntityKind.Building, -1, owner, rig.world.player(owner).faction, x, 0, z, 0);
  const i = s.index(id);
  s.flags[i] |= EntityFlag.IsRefinery;
  s.footprintW[i] = 3;
  s.footprintH[i] = 3;
  s.maxHp[i] = 1200;
  s.hp[i] = 1200;
  s.radius[i] = 6;
  s.buildProgress[i] = 1;
  return id;
}

function spawnHarvester(rig: Rig, owner: PlayerId, x: number, z: number): EntityId {
  const s = rig.world.store;
  const id = s.alloc(EntityKind.Vehicle, -1, owner, rig.world.player(owner).faction, x, 0, z, 0);
  const i = s.index(id);
  s.flags[i] |= EntityFlag.IsHarvester | EntityFlag.CanMove;
  s.cargoMax[i] = HARVESTER_CAPACITY;
  s.cargo[i] = 0;
  s.maxSpeed[i] = 8;
  s.accel[i] = 8;
  s.turnRate[i] = 4;
  s.locomotor[i] = Locomotor.Track;
  s.radius[i] = 2.2;
  s.maxHp[i] = 1000;
  s.hp[i] = 1000;
  s.state[i] = UnitState.Idle;
  return id;
}

const credits = (rig: Rig, p: PlayerId): number => rig.world.player(p).credits;

afterEach(() => {
  setActiveEconomy(null);
  setHarvesterDrive('full');
});

/* ==========================================================================
 * 1. THE PAYOUT — the load in the bay belongs to the building
 * ========================================================================== */

describe('a captured refinery pays its new owner', () => {
  it('THE REPORT: a load emptying when the deed flips lands in the captor bank', () => {
    const rig = makeRig();
    rig.ore.seedField(PATCH_X, PATCH_Z, 24, 900);
    const ref = spawnRefinery(rig, VICTIM, REF_NEAR_X, PATCH_Z);
    const h = spawnHarvester(rig, VICTIM, PATCH_X, PATCH_Z);
    const st = rig.world.store;
    const hi = st.index(h);

    // Drive the whole real loop rather than posing `Docked` by hand: the guard
    // under test is exactly "how did this hull get here", and only `tickReturn`
    // may put it here.
    rig.until(() => st.state[hi] === UnitState.Docked, 60 * SIM_HZ, 'the miner docks');

    const inTheBay = st.cargo[hi];
    expect(inTheBay, 'a full hopper, so the number below is the whole load').toBeGreaterThan(600);
    const victimBefore = credits(rig, VICTIM);
    const captorBefore = credits(rig, CAPTOR);

    expect(rig.capture.captureBuilding(ref, CAPTOR)).toBe(true);
    rig.until(() => st.cargo[hi] <= 0, 10 * SIM_HZ, 'the hopper empties');

    // The whole remaining load, to the new owner. BEFORE THIS RULE these two
    // expectations were exactly swapped: 700 to the victim, 0 to the captor.
    //
    // Two decimals rather than four because `tickDock` snaps the last <= 0.001
    // of a hopper to zero instead of paying it — measured residue on this case
    // is 8.2e-5 credits, which is the snap and not a leak.
    expect(credits(rig, CAPTOR) - captorBefore).toBeCloseTo(inTheBay * ORE_VALUE, 2);
    expect(credits(rig, VICTIM) - victimBefore).toBe(0);
  });

  it('and the storage cap moves with the deed on the same tick', () => {
    const rig = makeRig();
    const ref = spawnRefinery(rig, VICTIM, REF_NEAR_X, PATCH_Z);
    rig.step(1);
    const victimCap = rig.economy.storageMax(VICTIM);
    const captorCap = rig.economy.storageMax(CAPTOR);

    rig.capture.captureBuilding(ref, CAPTOR);

    // `captureBuilding` calls `recomputeStorage` itself — no tick required, and
    // no spawn hook, because the rescan reads `store.owner` and nothing caches.
    expect(victimCap - rig.economy.storageMax(VICTIM)).toBe(REFINERY_STORAGE);
    expect(rig.economy.storageMax(CAPTOR) - captorCap).toBe(REFINERY_STORAGE);
  });

  it('the captor own miners can then use it, which is the ordinary case', () => {
    const rig = makeRig();
    rig.ore.seedField(PATCH_X, PATCH_Z, 24, 900);
    const ref = spawnRefinery(rig, VICTIM, REF_NEAR_X, PATCH_Z);
    rig.capture.captureBuilding(ref, CAPTOR);
    spawnHarvester(rig, CAPTOR, PATCH_X, PATCH_Z);

    rig.step(60 * SIM_HZ);
    expect(credits(rig, CAPTOR)).toBeGreaterThan(0);
    expect(credits(rig, VICTIM)).toBe(0);
  });
});

/* ==========================================================================
 * 2. NO LUMP — the reason this cannot be farmed
 * ========================================================================== */

describe('capture pays nothing by itself', () => {
  it('flipping a refinery back and forth mints exactly zero', () => {
    const rig = makeRig();
    const ref = spawnRefinery(rig, VICTIM, REF_NEAR_X, PATCH_Z);
    rig.step(1);

    // Twenty flips is far more than any engineer economy could pay for; the
    // point is that the number is zero rather than small.
    for (let k = 0; k < 20; k++) {
      rig.capture.captureBuilding(ref, k % 2 === 0 ? CAPTOR : VICTIM);
      rig.step(1);
    }

    expect(credits(rig, VICTIM)).toBe(0);
    expect(credits(rig, CAPTOR)).toBe(0);
  });

  it('THE REPEATABLE-FLIP DOOR IS SHUT: a garrison cannot take a refinery', () => {
    // `GarrisonService.enter` flips a structure through `captureBuilding` and
    // `releaseEmptied` flips it straight back — the mechanism `Civilians.ts`
    // refuses to pay a capture bonus over. It cannot reach a refinery at all,
    // and this is the assertion that keeps that true: the refusal is by FLAG,
    // so a fifth army's refinery inherits it without anybody remembering.
    const rig = makeRig();
    const garrison = new GarrisonService(rig.world, rig.channels);
    const ref = spawnRefinery(rig, VICTIM, REF_NEAR_X, PATCH_Z);

    expect(garrison.refusalFor(ref, CAPTOR)).toBe('production structure');
    expect(garrison.canGarrison(ref, CAPTOR)).toBe(false);
  });

  it('an idle captured refinery keeps paying nobody', () => {
    const rig = makeRig();
    const ref = spawnRefinery(rig, VICTIM, REF_NEAR_X, PATCH_Z);
    rig.capture.captureBuilding(ref, CAPTOR);
    rig.step(60 * SIM_HZ);

    // No harvester anywhere, so no ore left the ground, so no credit exists.
    expect(credits(rig, CAPTOR)).toBe(0);
    expect(credits(rig, VICTIM)).toBe(0);
    expect(rig.harvesters.stats().delivered).toBe(0);
  });
});

/* ==========================================================================
 * 3. §ANCHOR SURVIVES — nobody hauls into the enemy base
 * ========================================================================== */

describe('the widened guard is tickDock only', () => {
  it('a miner still HAULING when the deed flips re-picks a dock it owns', () => {
    const rig = makeRig();
    const near = spawnRefinery(rig, VICTIM, REF_NEAR_X, PATCH_Z);
    const far = spawnRefinery(rig, VICTIM, REF_FAR_X, PATCH_Z);
    const h = spawnHarvester(rig, VICTIM, PATCH_X, PATCH_Z);
    const st = rig.world.store;
    const hi = st.index(h);

    // A full hopper and no ore on the map: the only thing this hull can do is
    // choose a dock, which is precisely the decision under test.
    st.cargo[hi] = st.cargoMax[hi];
    rig.until(
      () => st.state[hi] === UnitState.ReturnToRefinery, 10,
      'the miner sets off for the near refinery',
    );
    expect(st.dockTarget[hi]).toBe(near as number);

    rig.capture.captureBuilding(near, CAPTOR);
    rig.step(1);

    // It must NOT keep driving at a building the enemy now holds. That is the
    // literal §ANCHOR report — "they just suicide and going to enemy camp".
    expect(st.dockTarget[hi]).toBe(far as number);

    rig.until(() => st.cargo[hi] <= 0, 120 * SIM_HZ, 'the load reaches the far refinery');
    expect(credits(rig, VICTIM)).toBeGreaterThan(0);
    expect(credits(rig, CAPTOR)).toBe(0);
  });

  it('and a miner never CHOOSES an enemy refinery, even as the only one left', () => {
    const rig = makeRig();
    rig.ore.seedField(PATCH_X, PATCH_Z, 24, 900);
    const ref = spawnRefinery(rig, VICTIM, REF_NEAR_X, PATCH_Z);
    const h = spawnHarvester(rig, VICTIM, PATCH_X, PATCH_Z);
    const st = rig.world.store;
    const hi = st.index(h);

    rig.capture.captureBuilding(ref, CAPTOR);
    st.cargo[hi] = st.cargoMax[hi];
    rig.step(60 * SIM_HZ);

    // Nowhere to unload is the correct answer here, and it is what starving a
    // player out is supposed to look like. The captor is not paid for it.
    expect(st.dockTarget[hi]).not.toBe(ref as number);
    expect(st.cargo[hi]).toBe(st.cargoMax[hi]);
    expect(credits(rig, CAPTOR)).toBe(0);
    expect(credits(rig, VICTIM)).toBe(0);
  });
});
