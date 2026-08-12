/**
 * THE HARVESTER LEASH — see §ANCHOR in `src/sim/Harvesting.ts`.
 *
 * Reported: "they need to be bound to a specific area, whenever i lead them to
 * some point, they shouldnt go out of a range of it, because sometimes they
 * just suicide and going to enemy camp".
 *
 * TWO DEFECTS WERE BEHIND IT and this file pins both, because either one alone
 * reproduces the complaint:
 *
 *   1. The ore search had no memory. `acquireOre`/`rescoreOre` took the nearest
 *      cell within ORE_SEARCH_CELLS (160 m) OF THE HULL, so each re-score was a
 *      fresh 160 m step from wherever the last one left the harvester — a
 *      random walk that reaches the far side of a 512 m map.
 *   2. The player's click was DISCARDED. `OrderKind.Harvest` writes the order
 *      columns and sets `SeekOre`, and `tickSeek` republished the cell it was
 *      already claiming over the top of it on the very next tick.
 *
 * This rig is deliberately the SMALL one — `tests/economy.spec.ts`'s shape, flat
 * null terrain, no nav — because these are decisions, not locomotion. The
 * measurements on a real map with the real nav stack live in
 * `tests/harvester-soak.spec.ts`.
 */
import { describe, expect, it, beforeEach } from 'vitest';

import { World } from '../src/core/world';
import { Channels } from '../src/core/events';
import { EntityFlag, EntityKind, EvaLine, Faction, Locomotor, OrderKind, UnitState } from '../src/core/types';
import type { EntityId, PlayerId, SimContext } from '../src/core/types';
import {
  CELL, HARVESTER_LEASH_METRES, HARVESTER_LEASH_PATIENCE, SIM_DT, SIM_HZ,
} from '../src/core/config';
import { Rng } from '../src/core/math';

import { Economy, OreField } from '../src/sim/Economy';
import { HarvesterController, setHarvesterDrive } from '../src/sim/Harvesting';

const HUMAN = 0 as PlayerId;
const AI = 1 as PlayerId;

/**
 * The two patches. 200 m apart on X, which is far enough that neither can ever
 * be inside the other's leash and close enough that BOTH are inside
 * ORE_SEARCH_CELLS (160 m) of a harvester standing between them — that overlap
 * is the condition the old code walked across.
 */
const HOME_X = 160;
const FAR_X = 360;
const PATCH_Z = 256;

interface Rig {
  world: World;
  channels: Channels;
  ore: OreField;
  harvesters: HarvesterController;
  tick: number;
  step(n?: number): void;
}

function makeRig(): Rig {
  const world = new World();
  world.addPlayer(Faction.Allies, 'A', true, true);
  world.addPlayer(Faction.Soviets, 'B', false, false);
  const channels = new Channels();
  const ore = new OreField();
  const economy = new Economy(world, channels);
  const harvesters = new HarvesterController(world, channels, ore, economy);
  world.ore = ore;
  setHarvesterDrive('full');

  const rng = new Rng(1234);
  const rig: Rig = {
    world, channels, ore, harvesters,
    tick: 0,
    step(n = 1): void {
      for (let k = 0; k < n; k++) {
        world.store.snapshotPrev();
        rig.tick++;
        world.tick = rig.tick;
        world.time = rig.tick * SIM_DT;
        const s: SimContext = { dt: SIM_DT, tick: rig.tick, time: world.time, rng };
        harvesters.simTick(s);
        economy.tick(s.dt, s.time);
        harvesters.drive(s.dt);
      }
    },
  };
  return rig;
}

function spawnRefinery(rig: Rig, owner: PlayerId, x: number, z: number): void {
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
}

function spawnHarvester(rig: Rig, owner: PlayerId, x: number, z: number): number {
  const s = rig.world.store;
  const id = s.alloc(EntityKind.Vehicle, -1, owner, rig.world.player(owner).faction, x, 0, z, 0);
  const i = s.index(id);
  s.flags[i] |= EntityFlag.IsHarvester | EntityFlag.CanMove;
  s.cargoMax[i] = 300;
  s.cargo[i] = 0;
  s.maxSpeed[i] = 8;
  s.accel[i] = 8;
  s.turnRate[i] = 4;
  s.locomotor[i] = Locomotor.Track;
  s.radius[i] = 2.2;
  s.maxHp[i] = 1000;
  s.hp[i] = 1000;
  s.state[i] = UnitState.Idle;
  return i;
}

/** Exactly what `OrderExecutor.write` does for `OrderKind.Harvest`. */
function orderHarvest(rig: Rig, i: number, x: number, z: number): void {
  const s = rig.world.store;
  s.orderKind[i] = OrderKind.Harvest;
  s.orderTarget[i] = 0;
  s.orderX[i] = x;
  s.orderZ[i] = z;
  s.state[i] = UnitState.SeekOre;
}

/** And for `OrderKind.Move`. */
function orderMove(rig: Rig, i: number, x: number, z: number): void {
  const s = rig.world.store;
  s.orderKind[i] = OrderKind.Move;
  s.orderTarget[i] = 0;
  s.orderX[i] = x;
  s.orderZ[i] = z;
  s.state[i] = UnitState.Moving;
}

const anchorOf = (rig: Rig, i: number): { x: number; z: number } =>
  ({ x: rig.world.store.guardX[i], z: rig.world.store.guardZ[i] });

const distTo = (rig: Rig, i: number, x: number, z: number): number =>
  Math.hypot(rig.world.store.posX[i] - x, rig.world.store.posZ[i] - z);

/* ========================================================================== */

describe('the harvester leash', () => {
  let rig: Rig;

  beforeEach(() => {
    rig = makeRig();
    rig.ore.seedField(HOME_X, PATCH_Z, 24, 900);
    rig.ore.seedField(FAR_X, PATCH_Z, 24, 900);
    spawnRefinery(rig, HUMAN, HOME_X, PATCH_Z - 40);
    spawnRefinery(rig, AI, HOME_X, PATCH_Z - 40);
  });

  it('anchors a harvester on the patch it first chooses for itself', () => {
    const h = spawnHarvester(rig, HUMAN, HOME_X, PATCH_Z - 30);
    rig.step(4);
    const a = anchorOf(rig, h);
    // Snapped to the field NODE, not to the cell it happened to pick.
    expect(Math.hypot(a.x - HOME_X, a.z - PATCH_Z)).toBeLessThan(2 * CELL);
  });

  /* -- DEFECT 1: the map-crossing walk ----------------------------------- */

  it('never works a cell outside the leash, over a full run', () => {
    const h = spawnHarvester(rig, HUMAN, HOME_X, PATCH_Z - 30);
    rig.step(4);
    const a = anchorOf(rig, h);

    let worst = 0;
    for (let t = 0; t < 60 * SIM_HZ; t++) {
      // Shove it a cell toward the far patch every second and make it re-plan.
      // Crowd relaxation, nav's wedge displacement and a give-up park all do
      // this for real; doing it deliberately is what turns a 60 s run into the
      // several minutes of drift the soak needed to show the same thing.
      if (t % SIM_HZ === 0 && rig.world.store.posX[h] < FAR_X) {
        rig.world.store.posX[h] += CELL;
        rig.world.store.state[h] = UnitState.Idle;
      }
      rig.step(1);
      if (rig.world.store.state[h] !== UnitState.SeekOre
        && rig.world.store.state[h] !== UnitState.Harvesting) continue;
      const d = Math.hypot(
        rig.world.store.orderX[h] - a.x, rig.world.store.orderZ[h] - a.z);
      if (d > worst) worst = d;
    }
    // One cell of slack: the leash is applied to CELL CENTRES, and the anchor is
    // a field node whose own cell centre is up to half a cell off the record's
    // world coordinates.
    expect(worst, 'an ore destination outside the leash').toBeLessThanOrEqual(
      HARVESTER_LEASH_METRES + CELL);
  });

  it('does not cross to the far patch even when it is the nearest ore', () => {
    // THE WALK, IN ONE STEP. Anchored at home, then displaced most of the way to
    // the far patch and made to re-plan — which is exactly what a drifting
    // harvester did to itself every ORE_SCORING_INTERVAL, a little at a time.
    // From here the far patch is 40 m away and the home patch is 200 m, so an
    // unleashed re-plan takes the far one and never comes back.
    const h = spawnHarvester(rig, HUMAN, HOME_X, PATCH_Z);
    rig.step(4);
    const a = anchorOf(rig, h);
    rig.world.store.posX[h] = FAR_X - 40;
    rig.world.store.posZ[h] = PATCH_Z;
    // Idle is what forces the re-plan. Without it `tickSeek` republishes the
    // cell already claimed at home and the displacement proves nothing — which
    // is defect 2 masking defect 1, and is why this line is here.
    rig.world.store.state[h] = UnitState.Idle;

    // THE DECISION, not the position five seconds later. A harvester that took
    // the far cell would fill up there and haul back to the refinery at HOME, so
    // asking where the hull ended up can answer "at home" for both behaviours.
    let chose = -1;
    for (let t = 0; t < 10 * SIM_HZ; t++) {
      rig.step(1);
      if (rig.world.store.state[h] !== UnitState.SeekOre) continue;
      chose = Math.hypot(
        rig.world.store.orderX[h] - a.x, rig.world.store.orderZ[h] - a.z);
      break;
    }
    expect(chose, 'the harvester never re-planned at all').toBeGreaterThanOrEqual(0);
    expect(
      chose,
      'the harvester adopted the patch it happened to be standing next to',
    ).toBeLessThanOrEqual(HARVESTER_LEASH_METRES + CELL);
  });

  /* -- DEFECT 2: the discarded click ------------------------------------- */

  it('honours a Harvest order onto a different patch while already seeking', () => {
    const h = spawnHarvester(rig, HUMAN, HOME_X, PATCH_Z - 30);
    rig.step(2 * SIM_HZ);
    // Already busy on the home patch — seeking a cell or scooping one. Either
    // is the state the order used to be swallowed by.
    expect([UnitState.SeekOre, UnitState.Harvesting]).toContain(rig.world.store.state[h]);

    orderHarvest(rig, h, FAR_X, PATCH_Z);
    // The CLOSEST it ever got, not where it finished: obeying the order means
    // going there, and a harvester that goes there fills its hopper and hauls
    // back to the refinery, which is at the other end of the map.
    let closest = Infinity;
    for (let t = 0; t < 60 * SIM_HZ; t++) {
      rig.step(1);
      closest = Math.min(closest, distTo(rig, h, FAR_X, PATCH_Z));
    }
    expect(
      closest,
      'the order point was overwritten by the cell the harvester already held',
    ).toBeLessThan(HARVESTER_LEASH_METRES);
  });

  it('re-anchors on the field a Harvest order points into — that is the override', () => {
    const h = spawnHarvester(rig, HUMAN, HOME_X, PATCH_Z - 30);
    rig.step(4);
    orderHarvest(rig, h, FAR_X + 8, PATCH_Z + 8);
    rig.step(2);

    const a = anchorOf(rig, h);
    expect(Math.hypot(a.x - FAR_X, a.z - PATCH_Z)).toBeLessThan(2 * CELL);
  });

  it('ignores a Harvest order whose point holds no ore — that is the unload order', () => {
    const h = spawnHarvester(rig, HUMAN, HOME_X, PATCH_Z - 30);
    rig.step(4);
    const before = anchorOf(rig, h);
    // `Commands.ts` issues Harvest with a refinery TARGET and a point nobody
    // set when you right-click your own refinery. Bare ground must not anchor.
    orderHarvest(rig, h, 40, 40);
    rig.step(2);

    const a = anchorOf(rig, h);
    expect(Math.hypot(a.x - before.x, a.z - before.z)).toBeLessThan(0.001);
  });

  it('drops the anchor on a Move order and re-takes one where the move ended', () => {
    const h = spawnHarvester(rig, HUMAN, HOME_X, PATCH_Z - 30);
    rig.step(4);

    orderMove(rig, h, FAR_X, PATCH_Z + 30);
    rig.step(2);
    // The move put it somewhere else entirely; park it there and hand it back.
    rig.world.store.posX[h] = FAR_X;
    rig.world.store.posZ[h] = PATCH_Z + 30;
    rig.world.store.state[h] = UnitState.Idle;
    rig.world.store.orderKind[h] = OrderKind.None;
    rig.step(2 * SIM_HZ);

    const a = anchorOf(rig, h);
    expect(
      Math.hypot(a.x - FAR_X, a.z - PATCH_Z),
      'a harvester moved across the map should adopt the patch it was moved to',
    ).toBeLessThan(2 * CELL);
  });

  /* -- the dry patch ------------------------------------------------------ */

  /** Strip every cell of the home field, leaving the far one untouched. */
  function stripHome(rig: Rig): void {
    for (let cx = 0; cx < 128; cx++) {
      for (let cz = 0; cz < 128; cz++) {
        if (Math.hypot(cx * CELL - HOME_X, cz * CELL - PATCH_Z) > 40) continue;
        const have = rig.ore.oreAt(cx, cz);
        if (have > 0) rig.ore.takeOre(cx, cz, have);
      }
    }
  }

  it('parks a HUMAN harvester on its exhausted patch and announces it once', () => {
    const h = spawnHarvester(rig, HUMAN, HOME_X, PATCH_Z);
    rig.step(4);
    const a = anchorOf(rig, h);

    let lines = 0;
    rig.channels.events.on('eva:line', (e) => {
      if (e.line === EvaLine.HarvesterIdle && e.player === HUMAN) lines++;
    });

    stripHome(rig);
    rig.step(Math.round((HARVESTER_LEASH_PATIENCE + 20) * SIM_HZ));

    expect(rig.world.store.state[h], 'it should be waiting for orders').toBe(UnitState.Idle);
    expect(
      distTo(rig, h, a.x, a.z),
      'and waiting ON the patch, where the player can find it',
    ).toBeLessThan(HARVESTER_LEASH_METRES + CELL);
    expect(
      distTo(rig, h, FAR_X, PATCH_Z),
      'it must NOT have re-anchored itself across the map',
    ).toBeGreaterThan(HARVESTER_LEASH_METRES);
    // Coalesced: one notice per player per patch, not one per retry. Without
    // the `dryNotified` record this fires every DRY_RETRY for 20 s.
    expect(lines, 'the dry notice must not repeat').toBe(1);
  });

  it('re-anchors an AI harvester instead, because there is nobody to tell', () => {
    const h = spawnHarvester(rig, AI, HOME_X, PATCH_Z);
    rig.step(4);

    let lines = 0;
    rig.channels.events.on('eva:line', (e) => {
      if (e.line === EvaLine.HarvesterIdle) lines++;
    });

    stripHome(rig);
    rig.step(Math.round((HARVESTER_LEASH_PATIENCE + 40) * SIM_HZ));

    const a = anchorOf(rig, h);
    expect(
      Math.hypot(a.x - FAR_X, a.z - PATCH_Z),
      'an AI that waits for an order that will never come is a permanent stall',
    ).toBeLessThan(2 * CELL);
    expect(lines, 'the AI has no player to announce to').toBe(0);
  });

  it('re-arms the notice once the patch is worth working again', () => {
    const h = spawnHarvester(rig, HUMAN, HOME_X, PATCH_Z);
    rig.step(4);

    let lines = 0;
    rig.channels.events.on('eva:line', (e) => {
      if (e.line === EvaLine.HarvesterIdle) lines++;
    });

    stripHome(rig);
    rig.step(Math.round((HARVESTER_LEASH_PATIENCE + 10) * SIM_HZ));
    expect(lines).toBe(1);

    // The field comes back. The REAL mechanism, not a re-seed: `regrow` is what
    // runs in the game, and a re-seed would mint a new field id and make the
    // per-patch record trivially miss.
    rig.ore.regrow(120);
    rig.step(5 * SIM_HZ);
    stripHome(rig);
    rig.step(Math.round((HARVESTER_LEASH_PATIENCE + 10) * SIM_HZ));

    expect(lines, 'a patch that recovered and died again is a new event').toBe(2);
  });

  /* -- the leash must never be the reason there is nothing to do ---------- */

  it('sends an AI harvester to the only field left, however far it is', () => {
    // AI-owned, because the human path deliberately stops and asks instead —
    // see the two tests above. This is the guarantee for the branch that has to
    // keep going on its own: the leash must never be the reason a harvester
    // that COULD be working is not.
    const h = spawnHarvester(rig, AI, HOME_X, PATCH_Z);
    rig.step(4);

    // Strip both patches, then put the map's last ore 218 m away — far outside
    // every leash, and outside ORE_SEARCH_CELLS of the harvester's own patch.
    stripHome(rig);
    for (let cx = 0; cx < 128; cx++) {
      for (let cz = 0; cz < 128; cz++) {
        if (Math.hypot(cx * CELL - FAR_X, cz * CELL - PATCH_Z) > 40) continue;
        const have = rig.ore.oreAt(cx, cz);
        if (have > 0) rig.ore.takeOre(cx, cz, have);
      }
    }
    rig.ore.seedField(256, 60, 10, 900);

    rig.step(Math.round((HARVESTER_LEASH_PATIENCE + 10) * SIM_HZ));
    // THE ANCHOR, not the arrival: this is a test about the decision, and the
    // rig's backstop mover crossing 218 m is not what is under test.
    const a = anchorOf(rig, h);
    expect(
      Math.hypot(a.x - 256, a.z - 60),
      'the AI re-anchor never found the one field still holding ore',
    ).toBeLessThan(2 * CELL);
  });

  it('leaves an unanchored harvester the whole map, exactly as before', () => {
    // Parked midway between the two patches, so the nearest ore of any kind is
    // 76 m away — further than the leash would ever allow. It still finds it,
    // because the unleashed chain is untouched by any of this and still reaches
    // ORE_SEARCH_CELLS (160 m).
    const h = spawnHarvester(rig, HUMAN, (HOME_X + FAR_X) / 2, PATCH_Z);
    rig.step(4);
    expect(rig.world.store.state[h]).toBe(UnitState.SeekOre);
    const d = Math.hypot(
      rig.world.store.orderX[h] - (HOME_X + FAR_X) / 2,
      rig.world.store.orderZ[h] - PATCH_Z);
    expect(d).toBeGreaterThan(HARVESTER_LEASH_METRES);
  });
});

/* ========================================================================== */

describe('the anchor is the guard post, and nav no longer overwrites it', () => {
  it('is the column that is already saved and hashed', () => {
    // `guardX/guardZ` is serialised (SaveGame column 65) and mixed into the
    // desync checksum. This test exists so that a future change moving the
    // anchor into a private side table has to argue with something.
    const rig = makeRig();
    rig.ore.seedField(HOME_X, PATCH_Z, 24, 900);
    const h = spawnHarvester(rig, HUMAN, HOME_X, PATCH_Z);
    rig.step(4);
    expect(rig.world.store.guardX[h]).toBeCloseTo(HOME_X, 0);
    expect(rig.world.store.guardZ[h]).toBeCloseTo(PATCH_Z, 0);
  });
});
