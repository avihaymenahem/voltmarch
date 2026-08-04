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
 *   - the Iron Curtain restores the EXACT hp it suspended (it is invulnerability,
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

    expect(rig.world.store.isPendingDestroy(gi)).toBe(true);
  });
});

/* ========================================================================== */
/* Superweapons                                                               */
/* ========================================================================== */

describe('superweapons', () => {
  let rig: Rig;
  beforeEach(() => { rig = makeRig(); });

  it('is unavailable without the gating structure', () => {
    rig.supers.rescanAvailability();
    expect(rig.supers.remainingFor(ALLIES, 'chronosphere')).toBe(-1);
    expect(rig.supers.fireAt(ALLIES, 'chronosphere', 100, 100)).toBe('rejected');
  });

  it('charges only while the structure stands, and pauses when it falls', () => {
    const lab = rig.building('battleLab', ALLIES, 20, 20);
    rig.supers.rescanAvailability();
    const t0 = rig.supers.remainingFor(ALLIES, 'lightningStorm');
    expect(t0).toBeGreaterThan(0);

    rig.step((s) => rig.supers.simTick(s), 60);
    const t1 = rig.supers.remainingFor(ALLIES, 'lightningStorm');
    expect(t1).toBeLessThan(t0);

    rig.world.store.markDead(lab);
    rig.world.store.flushDestroyed();
    rig.supers.rescanAvailability();
    expect(rig.supers.remainingFor(ALLIES, 'lightningStorm')).toBe(-1);
    rig.step((s) => rig.supers.simTick(s), 60);

    // The charge is PAUSED, not reset: rebuilding the lab resumes where it
    // stopped rather than starting the seven-minute wait again.
    rig.building('battleLab', ALLIES, 24, 24);
    rig.supers.rescanAvailability();
    expect(rig.supers.remainingFor(ALLIES, 'lightningStorm')).toBeCloseTo(t1, 2);
  });

  it('respects faction ownership', () => {
    rig.building('battleLab', ALLIES, 20, 20);
    rig.supers.rescanAvailability();
    expect(rig.supers.remainingFor(ALLIES, 'nuke')).toBe(-1);
    expect(rig.supers.remainingFor(ALLIES, 'chronosphere')).toBeGreaterThanOrEqual(0);
  });

  it('lands a nuke only after its warning, and shakes the camera', () => {
    rig.building('battleLab', SOVIETS, 20, 20);
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
    rig.building('battleLab', ALLIES, 20, 20);
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
    rig.building('battleLab', ALLIES, 20, 20);
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

  it('makes Iron Curtain units invulnerable, then restores the exact hp', () => {
    rig.building('battleLab', SOVIETS, 20, 20);
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
    rig.building('battleLab', SOVIETS, 20, 20);
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
