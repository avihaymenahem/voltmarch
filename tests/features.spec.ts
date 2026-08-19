/// <reference types="vite/client" />
/**
 * The missing-series-features set: superweapons, engineer capture, base repair,
 * map crates and infantry garrisons.
 *
 * Everything here runs headless. The five services are plain classes over
 * `World` + `Channels`; `features.system.ts` is a registration shim and is the
 * only part that touches `ctx()` or THREE, so it is deliberately not imported.
 *
 * The load-bearing assertions:
 *   - an engineer cannot flip a healthy enemy structure (the low-health rule),
 *   - a repair that cannot be paid for does not happen,
 *   - crates roll identically from an identical seed,
 *   - the Ironclad Field restores the EXACT hp it suspended (it is invulnerability,
 *     not a heal).
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { World } from '../src/core/world';
import { Channels } from '../src/core/events';
import { Rng } from '../src/core/math';
import {
  CommandKind, EntityFlag, EntityKind, Faction, OrderKind, Stance, UnitState,
  WarheadClass,
} from '../src/core/types';
import type { Command, EntityId, PlayerId, SimContext } from '../src/core/types';
import { CELL, REPAIR_RATE, SIM_DT } from '../src/core/config';

import { ProductionCatalog, ProductionService, setProduction } from '../src/sim/Production';
import type { BuildEntry } from '../src/sim/Production';

import { CAPTURE, CaptureService, setCaptureService } from '../src/sim/Capture';
import { CRATES, CrateReward, CrateService } from '../src/sim/Crates';
import { DamageSystem } from '../src/sim/Damage';
import { GARRISON, GarrisonService } from '../src/sim/Garrison';
import { RepairSellService } from '../src/sim/RepairSell';
import {
  SUPERWEAPON_FX, SuperweaponService,
} from '../src/sim/Superweapons';

const EMPTY_BINDING = { tables: null, unitId: {}, buildingId: {} };
const ALLIES = 0 as PlayerId;
const SOVIETS = 1 as PlayerId;
const GAIA = 2 as PlayerId;

/* ========================================================================== */
/* Fixture                                                                    */
/* ========================================================================== */

interface Rig {
  world: World;
  channels: Channels;
  production: ProductionService;
  capture: CaptureService;
  garrison: GarrisonService;
  crates: CrateService;
  repair: RepairSellService;
  supers: SuperweaponService;
  rng: Rng;
  tick: number;
  step(fn: (s: SimContext) => void, steps?: number): void;
  building(key: string, owner: PlayerId, cx: number, cz: number): EntityId;
  unit(key: string, owner: PlayerId, x: number, z: number): EntityId;
}

function makeRig(seed = 1234): Rig {
  const world = new World();
  world.addPlayer(Faction.Allies, 'Commander', true, true);
  world.addPlayer(Faction.Soviets, 'Opponent', false, false);
  world.addPlayer(Faction.Neutral, 'Gaia', false, false);
  // Gaia is friends with everyone, exactly as ScenarioBuilder wires it.
  for (let i = 0; i < world.players.length; i++) {
    world.players[GAIA as number].allyMask |= 1 << i;
    world.players[i].allyMask |= 1 << (GAIA as number);
  }

  const channels = new Channels();
  const production = new ProductionService(world, channels, new ProductionCatalog(EMPTY_BINDING));
  setProduction(production);

  const capture = new CaptureService(world, channels);
  setCaptureService(capture);
  const garrison = new GarrisonService(world, channels);
  garrison.attach();
  const crates = new CrateService(world, channels);
  const repair = new RepairSellService(world, channels);
  repair.attach();
  const supers = new SuperweaponService(world, channels);

  const rig: Rig = {
    world, channels, production, capture, garrison, crates, repair, supers,
    rng: new Rng(seed),
    tick: 0,

    step(fn, steps = 1): void {
      for (let i = 0; i < steps; i++) {
        rig.tick++;
        world.tick = rig.tick;
        world.time = rig.tick * SIM_DT;
        world.spatial.rebuild();
        fn({ dt: SIM_DT, tick: rig.tick, time: world.time, rng: rig.rng });
      }
    },

    building(key, owner, cx, cz): EntityId {
      const entry = production.catalog.byKey(key) as BuildEntry;
      expect(entry, `catalog is missing "${key}"`).not.toBeNull();
      return production.spawnBuilding(world.players[owner as number], entry, cx, cz, 1);
    },

    unit(key, owner, x, z): EntityId {
      const entry = production.catalog.byKey(key) as BuildEntry;
      expect(entry, `catalog is missing "${key}"`).not.toBeNull();
      return production.spawnUnit(world.players[owner as number], entry, x, z, 0);
    },
  };
  return rig;
}

/** Aim a unit at a target with a specific order, the way input/Commands does. */
function order(rig: Rig, unit: EntityId, kind: OrderKind, target: EntityId): void {
  const st = rig.world.store;
  const i = st.index(unit);
  const t = st.index(target);
  st.orderKind[i] = kind;
  st.orderTarget[i] = target as number;
  st.orderX[i] = st.posX[t];
  st.orderZ[i] = st.posZ[t];
  st.state[i] = UnitState.Moving;
}

/** Drop a unit right against a structure's south face. */
function placeAgainst(rig: Rig, unit: EntityId, building: EntityId): void {
  const st = rig.world.store;
  const i = st.index(unit);
  const b = st.index(building);
  st.posX[i] = st.posX[b];
  st.posZ[i] = st.posZ[b] - st.footprintH[b] * CELL * 0.5 - 0.5;
  st.prevX[i] = st.posX[i];
  st.prevZ[i] = st.posZ[i];
}

function makeCommand(kind: CommandKind, player: PlayerId): Command {
  return {
    kind, player, tick: 0, order: OrderKind.None, target: 0 as EntityId,
    x: 0, z: 0, defId: -1, tab: 0, cx: 0, cz: 0,
    stance: Stance.Aggressive, queued: false, arg: 0,
    entityCount: 0, entities: new Int32Array(0),
  } as Command;
}

/* ========================================================================== */
/* Engineer capture                                                           */
/* ========================================================================== */

describe('engineer capture', () => {
  let rig: Rig;
  beforeEach(() => { rig = makeRig(); });

  it('flips a damaged enemy structure and consumes the engineer', () => {
    const target = rig.building('powerPlant', SOVIETS, 20, 20);
    const eng = rig.unit('engineer', ALLIES, 0, 0);
    placeAgainst(rig, eng, target);
    order(rig, eng, OrderKind.Capture, target);

    const st = rig.world.store;
    const t = st.index(target);
    st.hp[t] = st.maxHp[t] * (CAPTURE.captureHpFrac - 0.1);

    let captured = 0;
    rig.channels.events.on('building:captured', (ev) => {
      expect(ev.fromPlayer).toBe(SOVIETS);
      expect(ev.toPlayer).toBe(ALLIES);
      captured++;
    });

    rig.step((s) => rig.capture.simTick(s));

    expect(captured).toBe(1);
    expect(st.owner[t]).toBe(ALLIES as number);
    expect(st.faction[t]).toBe(Faction.Allies);
    expect(st.isPendingDestroy(eng)).toBe(true);
    expect(rig.capture.stats.captures).toBe(1);
  });

  it('refuses a HEALTHY enemy structure and softens it instead', () => {
    const target = rig.building('powerPlant', SOVIETS, 20, 20);
    const eng = rig.unit('engineer', ALLIES, 0, 0);
    placeAgainst(rig, eng, target);
    order(rig, eng, OrderKind.Capture, target);

    rig.step((s) => rig.capture.simTick(s));

    const st = rig.world.store;
    expect(st.owner[st.index(target)]).toBe(SOVIETS as number);
    expect(rig.capture.stats.softens).toBe(1);
    expect(rig.channels.damage.count).toBe(1);
    expect(rig.channels.damage.amount[0]).toBeCloseTo(
      st.maxHp[st.index(target)] * CAPTURE.softenFrac, 3,
    );
    // Three engineers take a full-health structure. That is the design.
    const perHit = CAPTURE.softenFrac;
    expect(Math.ceil((1 - CAPTURE.captureHpFrac) / perHit) + 1).toBe(3);
  });

  it('takes a NEUTRAL structure at any health', () => {
    const target = rig.building('powerPlant', GAIA, 20, 20);
    const eng = rig.unit('engineer', ALLIES, 0, 0);
    placeAgainst(rig, eng, target);
    order(rig, eng, OrderKind.Capture, target);

    rig.step((s) => rig.capture.simTick(s));

    expect(rig.world.store.owner[rig.world.store.index(target)]).toBe(ALLIES as number);
  });

  it('repairs a damaged friendly structure to full', () => {
    const target = rig.building('powerPlant', ALLIES, 20, 20);
    const eng = rig.unit('engineer', ALLIES, 0, 0);
    placeAgainst(rig, eng, target);
    order(rig, eng, OrderKind.Repair, target);

    const st = rig.world.store;
    const t = st.index(target);
    st.hp[t] = st.maxHp[t] * 0.3;

    rig.step((s) => rig.capture.simTick(s));

    expect(st.hp[t]).toBe(st.maxHp[t]);
    expect(st.isPendingDestroy(eng)).toBe(true);
    expect(rig.capture.stats.repairs).toBe(1);
  });

  it('does not eat an engineer sent at an undamaged friendly structure', () => {
    const target = rig.building('powerPlant', ALLIES, 20, 20);
    const eng = rig.unit('engineer', ALLIES, 0, 0);
    placeAgainst(rig, eng, target);
    order(rig, eng, OrderKind.Repair, target);

    rig.step((s) => rig.capture.simTick(s));

    expect(rig.world.store.isPendingDestroy(eng)).toBe(false);
    expect(rig.capture.stats.refusals).toBe(1);
  });

  it('keeps walking while out of reach', () => {
    const target = rig.building('powerPlant', SOVIETS, 20, 20);
    const eng = rig.unit('engineer', ALLIES, 4, 4);
    order(rig, eng, OrderKind.Capture, target);

    rig.step((s) => rig.capture.simTick(s));

    const st = rig.world.store;
    const i = st.index(eng);
    expect(st.state[i]).toBe(UnitState.Capturing);
    expect(st.orderX[i]).toBeCloseTo(st.posX[st.index(target)], 3);
    expect(rig.capture.stats.pursuing).toBe(1);
  });

  it('will not capture a structure a veto is holding', () => {
    const target = rig.building('powerPlant', SOVIETS, 20, 20);
    const eng = rig.unit('engineer', ALLIES, 0, 0);
    placeAgainst(rig, eng, target);
    order(rig, eng, OrderKind.Capture, target);
    rig.capture.addVeto(() => true);

    rig.step((s) => rig.capture.simTick(s));

    expect(rig.world.store.owner[rig.world.store.index(target)]).toBe(SOVIETS as number);
    expect(rig.world.store.isPendingDestroy(eng)).toBe(false);
  });

  it('only ever moves a building between two real owners', () => {
    const target = rig.building('powerPlant', SOVIETS, 20, 20);
    expect(rig.capture.captureBuilding(target, SOVIETS)).toBe(false);
    expect(rig.capture.captureBuilding(target, 7 as PlayerId)).toBe(false);
  });
});

/* ========================================================================== */
/* Base repair, stances, self-destruct                                        */
/* ========================================================================== */

describe('base repair', () => {
  let rig: Rig;
  beforeEach(() => { rig = makeRig(); });

  it('heals over time and charges for every point', () => {
    const b = rig.building('powerPlant', ALLIES, 20, 20);
    const st = rig.world.store;
    const i = st.index(b);
    st.hp[i] = st.maxHp[i] * 0.4;
    const p = rig.world.players[ALLIES as number];
    p.credits = 10000;

    const cmd = makeCommand(CommandKind.RepairToggle, ALLIES);
    cmd.target = b;
    expect(rig.repair.handleCommand(cmd)).toBe(true);
    expect(rig.repair.isRepairing(b)).toBe(true);

    const hp0 = st.hp[i];
    const credits0 = p.credits;
    rig.step((s) => rig.repair.simTick(s), 30);

    expect(st.hp[i]).toBeGreaterThan(hp0);
    expect(st.hp[i]).toBeCloseTo(hp0 + REPAIR_RATE * SIM_DT * 30, 1);
    expect(p.credits).toBeLessThan(credits0);
    expect((st.flags[i] & EntityFlag.BeingRepaired) !== 0).toBe(true);
    expect(rig.repair.stats.hpRestored).toBeGreaterThan(0);
  });

  it('stops instead of healing for free when the owner is broke', () => {
    const b = rig.building('powerPlant', ALLIES, 20, 20);
    const st = rig.world.store;
    const i = st.index(b);
    st.hp[i] = 10;
    rig.world.players[ALLIES as number].credits = 0;

    rig.repair.setRepairing(ALLIES, b, true);
    rig.step((s) => rig.repair.simTick(s), 5);

    expect(st.hp[i]).toBe(10);
    expect(rig.repair.isRepairing(b)).toBe(false);
    expect(rig.repair.stats.brokeCancels).toBe(1);
  });

  it('clears itself at full health', () => {
    const b = rig.building('powerPlant', ALLIES, 20, 20);
    const st = rig.world.store;
    const i = st.index(b);
    st.hp[i] = st.maxHp[i] - 1;
    rig.world.players[ALLIES as number].credits = 10000;

    rig.repair.setRepairing(ALLIES, b, true);
    rig.step((s) => rig.repair.simTick(s), 10);

    expect(st.hp[i]).toBe(st.maxHp[i]);
    expect(rig.repair.isRepairing(b)).toBe(false);
    expect((st.flags[i] & EntityFlag.BeingRepaired) !== 0).toBe(false);
  });

  it('refuses to repair somebody else’s structure', () => {
    const b = rig.building('powerPlant', SOVIETS, 20, 20);
    rig.world.store.hp[rig.world.store.index(b)] = 10;
    expect(rig.repair.setRepairing(ALLIES, b, true)).toBe(false);
  });

  it('spawns a crew when a structure is sold', () => {
    const b = rig.building('powerPlant', ALLIES, 20, 20);
    const before = rig.world.store.byKindCount[EntityKind.Infantry];
    rig.production.sell(ALLIES, b);
    // Production applies the sale on its own tick; the crew lands on the next
    // features tick, deterministically, off `s.rng`.
    rig.step((s) => { rig.production.tick(s); rig.repair.simTick(s); }, 2);

    expect(rig.world.store.byKindCount[EntityKind.Infantry]).toBeGreaterThan(before);
    expect(rig.repair.stats.survivorsSpawned).toBeGreaterThan(0);
  });
});

describe('stances', () => {
  let rig: Rig;
  beforeEach(() => { rig = makeRig(); });

  it('writes store.stance for owned units only', () => {
    const mine = rig.unit('gi', ALLIES, 40, 40);
    const theirs = rig.unit('conscript', SOVIETS, 44, 40);
    const st = rig.world.store;

    expect(st.stance[st.index(mine)]).toBe(Stance.Aggressive);

    const cmd = makeCommand(CommandKind.SetStance, ALLIES);
    cmd.stance = Stance.HoldGround;
    cmd.entities = new Int32Array([mine as number, theirs as number]);
    cmd.entityCount = 2;

    expect(rig.repair.handleCommand(cmd)).toBe(true);
    expect(st.stance[st.index(mine)]).toBe(Stance.HoldGround);
    expect(st.stance[st.index(theirs)]).toBe(Stance.Aggressive);
    expect(rig.repair.stats.stanceChanges).toBe(1);
  });

  it('stamps the guard point when the stance becomes positional', () => {
    const u = rig.unit('gi', ALLIES, 40, 44);
    const st = rig.world.store;
    const i = st.index(u);
    st.posX[i] = 123;
    st.posZ[i] = 77;

    const cmd = makeCommand(CommandKind.SetStance, ALLIES);
    cmd.stance = Stance.Defensive;
    cmd.entities = new Int32Array([u as number]);
    cmd.entityCount = 1;
    rig.repair.handleCommand(cmd);

    expect(st.guardX[i]).toBe(123);
    expect(st.guardZ[i]).toBe(77);
  });

  /* ------------------------------------------------------------------------
   * THE POST BELONGS TO THE UNIT, NOT TO TWO OF THE FOUR STANCES.
   *
   * `applyStance` used to stamp `guardX/guardZ` for `Defensive` and
   * `HoldGround` only. Cross-referenced against `Targeting.holdPost`, which is
   * the only consumer, that pair is close to backwards: HoldGround is the one
   * stance whose behaviour the post cannot affect (`STANCE_RETURNS` is false,
   * so every branch ends in `settle()`), while Aggressive measures its whole
   * chase envelope from the post AND walks back to it, and HoldFire is
   * Defensive with the trigger disabled — same 0 chase, same true return.
   *
   * So the same gesture meant two different things: switching a displaced unit
   * to Defensive settled it where it stood, switching it to Aggressive sent it
   * walking back to a post it might have left minutes ago.
   * --------------------------------------------------------------------- */
  const ALL_STANCES: readonly Stance[] = [
    Stance.Aggressive, Stance.Defensive, Stance.HoldFire, Stance.HoldGround,
  ];

  function setStance(r: Rig, u: EntityId, stance: Stance): boolean {
    const cmd = makeCommand(CommandKind.SetStance, ALLIES);
    cmd.stance = stance;
    cmd.entities = new Int32Array([u as number]);
    cmd.entityCount = 1;
    return r.repair.handleCommand(cmd);
  }

  it('stamps the guard point for every stance, not just two of them', () => {
    for (const stance of ALL_STANCES) {
      const r = makeRig();
      // Spawn under a DIFFERENT stance so the `stance[i] === stance` early-out
      // never swallows the case under test.
      const u = r.unit('gi', ALLIES, 40, 44);
      const st = r.world.store;
      const i = st.index(u);
      if (st.stance[i] === (stance as number)) {
        setStance(r, u, stance === Stance.Aggressive ? Stance.HoldFire : Stance.Aggressive);
      }
      // A stale post, of the kind a nav pocket rescue or a neighbour's
      // separation force leaves behind.
      st.guardX[i] = 5;
      st.guardZ[i] = 5;
      st.posX[i] = 211;
      st.posZ[i] = 133;

      expect(setStance(r, u, stance), `stance ${stance} should apply`).toBe(true);
      expect(st.guardX[i], `stance ${stance} must take its post from the unit`).toBe(211);
      expect(st.guardZ[i], `stance ${stance} must take its post from the unit`).toBe(133);
    }
  });

  it('never moves the point an explicit Guard order named', () => {
    // `OrderKind.Guard` is the player having already chosen the post — and the
    // unit is usually still DRIVING to it. Stamping its current position there
    // cancels the order in everything but the `orderKind` column, silently.
    // `Steering` refuses to re-take the post under the same condition.
    for (const stance of ALL_STANCES) {
      const r = makeRig();
      const u = r.unit('gi', ALLIES, 40, 44);
      const st = r.world.store;
      const i = st.index(u);
      if (st.stance[i] === (stance as number)) {
        setStance(r, u, stance === Stance.Aggressive ? Stance.HoldFire : Stance.Aggressive);
      }
      st.orderKind[i] = OrderKind.Guard;
      st.orderX[i] = 90; st.orderZ[i] = 60;
      st.guardX[i] = 90; st.guardZ[i] = 60;
      st.state[i] = UnitState.Guarding;
      // Halfway there.
      st.posX[i] = 65; st.posZ[i] = 52;

      expect(setStance(r, u, stance)).toBe(true);
      expect(st.stance[i], 'the stance still changed').toBe(stance as number);
      expect(st.guardX[i], `stance ${stance} must not eat a Guard order`).toBe(90);
      expect(st.guardZ[i], `stance ${stance} must not eat a Guard order`).toBe(60);
    }
  });
});

describe('self destruct', () => {
  it('queues a lethal blast on the volunteer and its neighbours', () => {
    const rig = makeRig();
    const u = rig.unit('grizzly', ALLIES, 40, 40);
    const cmd = makeCommand(CommandKind.SelfDestruct, ALLIES);
    cmd.target = u;

    expect(rig.repair.handleCommand(cmd)).toBe(true);
    expect(rig.channels.damage.count).toBe(2);
    // One splash record, one guaranteed direct hit.
    expect(rig.channels.damage.splashRadius[0]).toBeGreaterThan(0);
    expect(rig.channels.damage.splashRadius[1]).toBe(0);
    expect(rig.channels.damage.amount[1]).toBeGreaterThan(
      rig.world.store.hp[rig.world.store.index(u)],
    );
  });

  it('will not blow up somebody else’s tank', () => {
    const rig = makeRig();
    const u = rig.unit('rhino', SOVIETS, 40, 40);
    const cmd = makeCommand(CommandKind.SelfDestruct, ALLIES);
    cmd.target = u;
    rig.repair.handleCommand(cmd);
    expect(rig.channels.damage.count).toBe(0);
  });
});

/* ========================================================================== */
/* Crates                                                                     */
/* ========================================================================== */

describe('crates', () => {
  let rig: Rig;
  beforeEach(() => { rig = makeRig(); });

  it('is collected by a unit standing on it', () => {
    const crate = rig.crates.spawnCrate(100, 100);
    const u = rig.unit('grizzly', ALLIES, 100, 100);
    expect(crate).not.toBe(0);

    let seen = 0;
    rig.crates.onPickup((pk) => { seen++; expect(pk.finder).toBe(u); });
    rig.step((s) => rig.crates.simTick(s));

    expect(seen).toBe(1);
    expect(rig.world.store.isPendingDestroy(crate)).toBe(true);
    expect(rig.crates.stats.collected).toBe(1);
  });

  it('is not collected by a building or by scenery', () => {
    rig.crates.spawnCrate(100, 100);
    rig.building('powerPlant', ALLIES, 25, 25);
    rig.step((s) => rig.crates.simTick(s), 3);
    expect(rig.crates.stats.collected).toBe(0);
  });

  it('rolls identically from an identical seed', () => {
    const rolls = (seed: number): string => {
      const r = makeRig(seed);
      const out: number[] = [];
      r.crates.onPickup((pk) => out.push(pk.reward));
      for (let k = 0; k < 12; k++) {
        r.crates.spawnCrate(120 + k * 20, 120);
        r.unit('grizzly', ALLIES, 120 + k * 20, 120);
        r.step((s) => r.crates.simTick(s));
      }
      return out.join(',');
    };
    expect(rolls(99)).toBe(rolls(99));
    expect(rolls(99).length).toBeGreaterThan(0);
  });

  it('covers every reward across enough rolls', () => {
    const seen = new Set<CrateReward>();
    for (let k = 0; k < 200 && seen.size < 5; k++) {
      rig.crates.spawnCrate(150, 150);
      rig.unit('grizzly', ALLIES, 150, 150);
      rig.crates.onPickup((pk) => seen.add(pk.reward));
      rig.step((s) => rig.crates.simTick(s));
    }
    expect(seen.size).toBe(5);
  });

  it('keeps the map stocked but never past the cap', () => {
    rig.step((s) => rig.crates.simTick(s), Math.ceil(
      (CRATES.firstDropSeconds + CRATES.respawnSeconds * (CRATES.maxOnMap + 3)) / SIM_DT,
    ));
    expect(rig.crates.stats.live).toBeLessThanOrEqual(CRATES.maxOnMap);
    expect(rig.crates.stats.dropped).toBeGreaterThan(0);
  });
});

/* ========================================================================== */
/* Garrison                                                                   */
/* ========================================================================== */

describe('garrison', () => {
  let rig: Rig;
  beforeEach(() => { rig = makeRig(); });

  it('lets infantry into an eligible structure and hides them', () => {
    const b = rig.building('powerPlant', ALLIES, 20, 20);
    const gi = rig.unit('gi', ALLIES, 0, 0);
    placeAgainst(rig, gi, b);
    order(rig, gi, OrderKind.Enter, b);

    rig.step((s) => rig.garrison.simTick(s));

    const st = rig.world.store;
    expect((st.flags[st.index(gi)] & EntityFlag.Garrisoned) !== 0).toBe(true);
    expect(rig.garrison.occupantCount(b)).toBe(1);
    expect(rig.garrison.hostOfUnit(gi)).toBe(b);
  });

  it('refuses armed, tiny and production structures', () => {
    const silo = rig.building('oreSilo', ALLIES, 30, 30);
    const barracks = rig.building('barracks', ALLIES, 40, 40);
    expect(rig.garrison.refusalFor(silo, ALLIES)).toBe('too small');
    expect(rig.garrison.refusalFor(barracks, ALLIES)).toBe('production structure');
  });

  it('caps occupancy', () => {
    const b = rig.building('powerPlant', ALLIES, 20, 20);
    for (let k = 0; k < GARRISON.capacity + 2; k++) {
      const gi = rig.unit('gi', ALLIES, 0, 0);
      placeAgainst(rig, gi, b);
      order(rig, gi, OrderKind.Enter, b);
      rig.step((s) => rig.garrison.simTick(s));
    }
    expect(rig.garrison.occupantCount(b)).toBe(GARRISON.capacity);
  });

  it('fires on an enemy in range, scaling with occupancy', () => {
    const b = rig.building('powerPlant', ALLIES, 20, 20);
    const st = rig.world.store;
    const enemy = rig.unit('conscript', SOVIETS, st.posX[st.index(b)] + 8, st.posZ[st.index(b)]);
    expect(enemy).not.toBe(0);

    /** Add `men` more occupants, then wait out the cooldown for one volley. */
    const nextVolley = (men: number): number => {
      for (let k = 0; k < men; k++) {
        const gi = rig.unit('gi', ALLIES, 0, 0);
        placeAgainst(rig, gi, b);
        order(rig, gi, OrderKind.Enter, b);
        rig.step((s) => rig.garrison.simTick(s));
      }
      rig.channels.damage.clear();
      for (let t = 0; t < 120 && rig.channels.damage.count === 0; t++) {
        rig.step((s) => rig.garrison.weaponsTick(s));
      }
      return rig.channels.damage.count > 0 ? rig.channels.damage.amount[0] : 0;
    };

    const one = nextVolley(1);
    expect(one).toBeGreaterThan(0);
    expect(rig.garrison.stats.volleys).toBeGreaterThan(0);
    const three = nextVolley(2);
    expect(three).toBeGreaterThan(one);
  });

  it('takes a neutral structure while held and gives it back when emptied', () => {
    const b = rig.building('powerPlant', GAIA, 20, 20);
    const gi = rig.unit('gi', ALLIES, 0, 0);
    placeAgainst(rig, gi, b);
    order(rig, gi, OrderKind.Enter, b);

    rig.step((s) => rig.garrison.simTick(s));
    const st = rig.world.store;
    expect(st.owner[st.index(b)]).toBe(ALLIES as number);

    expect(rig.garrison.evacuate(b)).toBe(1);
    expect((st.flags[st.index(gi)] & EntityFlag.Garrisoned) !== 0).toBe(false);
    expect(st.owner[st.index(b)]).toBe(GAIA as number);
  });

  it('vetoes capture of an occupied strongpoint', () => {
    const b = rig.building('powerPlant', GAIA, 20, 20);
    const gi = rig.unit('gi', ALLIES, 0, 0);
    placeAgainst(rig, gi, b);
    order(rig, gi, OrderKind.Enter, b);
    rig.step((s) => rig.garrison.simTick(s));

    expect(rig.capture.isCapturable(b, SOVIETS)).toBe(false);
  });

  it('kills its occupants with the building', () => {
    const b = rig.building('powerPlant', ALLIES, 20, 20);
    const gi = rig.unit('gi', ALLIES, 0, 0);
    placeAgainst(rig, gi, b);
    order(rig, gi, OrderKind.Enter, b);
    rig.step((s) => rig.garrison.simTick(s));

    rig.channels.events.emit('entity:killed', {
      id: b, kind: EntityKind.Building, defId: 0, player: ALLIES,
      killer: 0 as EntityId, killerPlayer: SOVIETS, x: 0, z: 0, value: 0,
    });

    const st = rig.world.store;
    expect(st.isPendingDestroy(gi)).toBe(true);
    // `Drowned` and not `Selling`. `Damage.onDeath` returns on `Selling` BEFORE
    // the statistics block, so this used to be a loss that reached neither
    // scoreboard while the comment above it said otherwise.
    expect(st.state[st.index(gi)]).toBe(UnitState.Drowned);
    expect(rig.garrison.stats.drowned).toBe(1);
  });

  it('marks a dying building\'s occupants in FRONT of the death scan', () => {
    // THE MEN ARE SPAWNED FIRST, AND THAT IS THE TEST. `Damage.cleanupTick`
    // walks `alive[]` in slot order and emits one `entity:killed` per corpse;
    // the garrison's own hook fires from INSIDE that loop, so an occupant
    // sitting earlier in the list than his building has already been walked
    // past and `flushDestroyed()` frees him with no event and no `unitsLost`.
    // Order them the other way round and the hook alone looks correct.
    const men: EntityId[] = [];
    for (let k = 0; k < 3; k++) men.push(rig.unit('gi', ALLIES, 0, 0));
    const b = rig.building('powerPlant', ALLIES, 20, 20);
    for (const m of men) {
      placeAgainst(rig, m, b);
      order(rig, m, OrderKind.Enter, b);
    }
    rig.step((s) => rig.garrison.simTick(s));
    expect(rig.garrison.occupantCount(b)).toBe(3);

    const damage = new DamageSystem(rig.world, rig.channels);
    let infantryDeaths = 0;
    rig.channels.events.on('entity:killed', (ev) => {
      if (ev.kind === EntityKind.Infantry) infantryDeaths++;
    });

    // What Phase.Damage does to a building it has finished off: a flag, no
    // event. Then Phase.Cleanup in its registered order — garrison at -400,
    // the death scan at 0.
    rig.world.store.markDead(b);
    rig.step((s) => { rig.garrison.simTick(s); damage.cleanupTick(s); });

    expect(infantryDeaths, 'a man went down without an entity:killed').toBe(3);
    expect(rig.world.players[ALLIES as number].stats.unitsLost).toBe(3);
    expect(rig.garrison.stats.drowned).toBe(3);
  });

  it('puts an occupant back on the ground if its host vanishes silently', () => {
    const b = rig.building('powerPlant', ALLIES, 20, 20);
    const gi = rig.unit('gi', ALLIES, 0, 0);
    placeAgainst(rig, gi, b);
    order(rig, gi, OrderKind.Enter, b);
    rig.step((s) => rig.garrison.simTick(s));

    // Straight to the store, bypassing `entity:killed` — a service torn down
    // mid-match reaches this, and so does a `flushDestroyed` race.
    const st = rig.world.store;
    st.markDead(b);
    st.flushDestroyed();
    rig.step((s) => rig.garrison.simTick(s));

    const i = st.index(gi);
    expect(st.flags[i] & EntityFlag.Garrisoned).toBe(0);
    expect(st.flags[i] & EntityFlag.Immobilized).toBe(0);
    expect(rig.garrison.stats.stranded).toBe(1);
  });

  it('never leaves a man alive, garrisoned and hostless', () => {
    // THE STATE A SAVE USED TO PRODUCE FOR EVERY OCCUPANT OF EVERY GARRISON,
    // and the reason `garrisonId` is a store column: a load bumps every
    // generation, so the service-private side array that held this read as 0,
    // `tally` skipped the man at `b < 0`, and nothing put him back. Hidden by
    // `RenderBridge.HIDDEN_MASK`, refused by `Selection`, rejected by
    // `TARGETABLE_REJECT_MASK`, skipped by `Movement` — alive and untouchable
    // for the rest of that save's life. A file written before the column
    // existed still loads and still lands here, which is why the repair is a
    // tick of the service and not the save format alone.
    const b = rig.building('powerPlant', ALLIES, 20, 20);
    const gi = rig.unit('gi', ALLIES, 0, 0);
    placeAgainst(rig, gi, b);
    order(rig, gi, OrderKind.Enter, b);
    rig.step((s) => rig.garrison.simTick(s));

    const st = rig.world.store;
    const i = st.index(gi);
    st.garrisonId[i] = 0;                       // what an older save restores to
    rig.step((s) => rig.garrison.simTick(s));

    expect(st.flags[i] & EntityFlag.Garrisoned).toBe(0);
    expect(st.state[i]).toBe(UnitState.Idle);
    expect(rig.garrison.hostOfUnit(gi)).toBe(0);
    expect(rig.garrison.stats.stranded).toBe(1);
  });

  it('leaves a transport passenger to the transport', () => {
    // The other side of the two-column split. A man in a hull carries the same
    // `Garrisoned` flag and an empty `garrisonId`, which is byte-identical to
    // the hostless state above — `carrierId` is the only thing that tells them
    // apart, so it is read before anybody is dropped. Tip a passenger out of a
    // moving hull and he lands wherever the hull happens to be, which on a sea
    // crossing is the sea.
    const st = rig.world.store;
    const gi = rig.unit('gi', ALLIES, 100, 100);
    const hull = rig.unit('grizzly', ALLIES, 100, 100);
    const i = st.index(gi);
    st.flags[i] |= EntityFlag.Garrisoned | EntityFlag.Immobilized;
    st.carrierId[i] = hull as number;

    rig.step((s) => rig.garrison.simTick(s));

    expect(st.flags[i] & EntityFlag.Garrisoned).not.toBe(0);
    expect(rig.garrison.stats.stranded).toBe(0);
  });
});

/* ========================================================================== */
/* Superweapons                                                               */
/* ========================================================================== */

/**
 * The gating structure for each weapon. These used to be `battleLab` on every
 * line, because when this block was written the structures did not exist and
 * `SUPERWEAPONS[i].structureKeys` ended its fallback chain at the tech
 * building. That fallback also meant one Proving Ground armed BOTH of its army's
 * superweapons, which is why it is gone — see the header of Superweapons.ts.
 */
const GATE: Readonly<Record<string, string>> = {
  nuke: 'nuclearSilo',
  ironCurtain: 'ironCurtain',
  chronosphere: 'chronosphere',
  lightningStorm: 'weatherControl',
};

describe('superweapons', () => {
  let rig: Rig;
  beforeEach(() => { rig = makeRig(); });

  it('is unavailable without the gating structure', () => {
    rig.supers.rescanAvailability();
    expect(rig.supers.remainingFor(ALLIES, 'chronosphere')).toBe(-1);
    expect(rig.supers.fireAt(ALLIES, 'chronosphere', 100, 100)).toBe('rejected');
  });

  it('is unavailable on a Proving Ground alone', () => {
    // THE REGRESSION THIS FILE'S OWN FIXTURES USED TO ENCODE. Every case below
    // built a `battleLab` and got a charged nuke out of it, because the
    // structure chain fell back to the tech building. It does not any more:
    // the silo is a 2500-credit, 150-power commitment of its own.
    rig.building('battleLab', SOVIETS, 20, 20);
    rig.supers.rescanAvailability();
    expect(rig.supers.remainingFor(SOVIETS, 'nuke')).toBe(-1);
    expect(rig.supers.remainingFor(SOVIETS, 'ironCurtain')).toBe(-1);
  });

  it('gates each weapon on its OWN structure, not on its army', () => {
    // One silo arms the missile and nothing else. Two superweapons per army
    // means two buildings, which is the whole reason each has its own def.
    rig.building('nuclearSilo', SOVIETS, 20, 20);
    rig.supers.rescanAvailability();
    expect(rig.supers.remainingFor(SOVIETS, 'nuke')).toBeGreaterThanOrEqual(0);
    expect(rig.supers.remainingFor(SOVIETS, 'ironCurtain')).toBe(-1);
  });

  it('charges only while the structure stands, and pauses when it falls', () => {
    const gate = rig.building(GATE.lightningStorm, ALLIES, 20, 20);
    rig.supers.rescanAvailability();
    const t0 = rig.supers.remainingFor(ALLIES, 'lightningStorm');
    expect(t0).toBeGreaterThan(0);

    rig.step((s) => rig.supers.simTick(s), 60);
    const t1 = rig.supers.remainingFor(ALLIES, 'lightningStorm');
    expect(t1).toBeLessThan(t0);

    rig.world.store.markDead(gate);
    rig.world.store.flushDestroyed();
    rig.supers.rescanAvailability();
    expect(rig.supers.remainingFor(ALLIES, 'lightningStorm')).toBe(-1);
    rig.step((s) => rig.supers.simTick(s), 60);

    // The charge is PAUSED, not reset: rebuilding resumes where it stopped
    // rather than starting the seven-minute wait again.
    rig.building(GATE.lightningStorm, ALLIES, 24, 24);
    rig.supers.rescanAvailability();
    expect(rig.supers.remainingFor(ALLIES, 'lightningStorm')).toBeCloseTo(t1, 2);
  });

  it('respects faction ownership', () => {
    rig.building(GATE.chronosphere, ALLIES, 20, 20);
    rig.supers.rescanAvailability();
    expect(rig.supers.remainingFor(ALLIES, 'nuke')).toBe(-1);
    expect(rig.supers.remainingFor(ALLIES, 'chronosphere')).toBeGreaterThanOrEqual(0);
  });

  it('lands a nuke only after its warning, and shakes the camera', () => {
    rig.building(GATE.nuke, SOVIETS, 20, 20);
    rig.supers.rescanAvailability();
    rig.supers.grantReady(SOVIETS, 'nuke');
    expect(rig.supers.isReady(SOVIETS, 'nuke')).toBe(true);

    expect(rig.supers.fireAt(SOVIETS, 'nuke', 200, 200)).toBe('fired');
    // Charge is spent the moment it is committed.
    expect(rig.supers.isReady(SOVIETS, 'nuke')).toBe(false);

    rig.step((s) => rig.supers.simTick(s), 2);
    expect(rig.channels.damage.count).toBe(0);

    rig.step((s) => rig.supers.simTick(s), Math.ceil(SUPERWEAPON_FX.nukeWarnSeconds / SIM_DT) + 2);
    expect(rig.channels.damage.count).toBe(1);
    expect(rig.channels.damage.warhead[0]).toBe(WarheadClass.HighExplosive);
    expect(rig.channels.damage.splashRadius[0]).toBeGreaterThan(20);
    expect(rig.supers.stats.strikesResolved).toBe(1);
  });

  it('makes a lightning storm throw many small bolts, not one big one', () => {
    rig.building(GATE.lightningStorm, ALLIES, 20, 20);
    rig.supers.rescanAvailability();
    rig.supers.grantReady(ALLIES, 'lightningStorm');
    expect(rig.supers.fireAt(ALLIES, 'lightningStorm', 300, 300)).toBe('fired');

    rig.step((s) => rig.supers.simTick(s), Math.ceil(
      (SUPERWEAPON_FX.stormDelaySeconds + SUPERWEAPON_FX.stormDurationSeconds) / SIM_DT,
    ) + 2);

    expect(rig.supers.stats.boltsThrown).toBeGreaterThan(10);
    expect(rig.channels.damage.warhead[0]).toBe(WarheadClass.Tesla);
  });

  it('stages then fires the chronosphere, and moves the units', () => {
    rig.building(GATE.chronosphere, ALLIES, 20, 20);
    rig.supers.rescanAvailability();
    rig.supers.grantReady(ALLIES, 'chronosphere');

    const tank = rig.unit('grizzly', ALLIES, 300, 300);
    const st = rig.world.store;
    const i = st.index(tank);

    expect(rig.supers.fireAt(ALLIES, 'chronosphere', 300, 300)).toBe('staged');
    expect(rig.supers.fireAt(ALLIES, 'chronosphere', 500, 500)).toBe('fired');

    rig.step((s) => rig.supers.simTick(s), 2);

    expect(Math.hypot(st.posX[i] - 500, st.posZ[i] - 500)).toBeLessThan(20);
    expect(st.prevX[i]).toBe(st.posX[i]);
    expect(st.state[i]).toBe(UnitState.Idle);
    expect(rig.supers.stats.unitsTeleported).toBe(1);
  });

  it('makes units under the Ironclad Field invulnerable, then restores the exact hp', () => {
    rig.building(GATE.ironCurtain, SOVIETS, 20, 20);
    rig.supers.rescanAvailability();
    rig.supers.grantReady(SOVIETS, 'ironCurtain');

    const tank = rig.unit('rhino', SOVIETS, 400, 400);
    const st = rig.world.store;
    const i = st.index(tank);
    const realMax = st.maxHp[i];
    st.hp[i] = realMax * 0.5;
    const wounded = st.hp[i];

    expect(rig.supers.fireAt(SOVIETS, 'ironCurtain', 400, 400)).toBe('fired');
    rig.step((s) => rig.supers.simTick(s), 2);

    expect(rig.supers.isProtected(tank)).toBe(true);
    expect(st.maxHp[i]).toBe(SUPERWEAPON_FX.curtainHp);

    // Nothing the game can produce dents it.
    st.hp[i] -= 5000;
    expect(st.hp[i]).toBeGreaterThan(0);

    rig.step((s) => rig.supers.simTick(s), Math.ceil(SUPERWEAPON_FX.curtainSeconds / SIM_DT) + 2);

    expect(rig.supers.isProtected(tank)).toBe(false);
    expect(st.maxHp[i]).toBeCloseTo(realMax, 3);
    // Invulnerability, not a heal: it comes out on exactly the hp it went in on.
    expect(st.hp[i]).toBeCloseTo(wounded, 0);
  });

  it('restores every protected unit on dispose', () => {
    rig.building(GATE.ironCurtain, SOVIETS, 20, 20);
    rig.supers.rescanAvailability();
    rig.supers.grantReady(SOVIETS, 'ironCurtain');
    const tank = rig.unit('rhino', SOVIETS, 400, 400);
    const st = rig.world.store;
    const i = st.index(tank);
    const realMax = st.maxHp[i];

    rig.supers.fireAt(SOVIETS, 'ironCurtain', 400, 400);
    rig.step((s) => rig.supers.simTick(s), 2);
    expect(st.maxHp[i]).toBe(SUPERWEAPON_FX.curtainHp);

    rig.supers.dispose();
    expect(st.maxHp[i]).toBeCloseTo(realMax, 3);
  });
});
