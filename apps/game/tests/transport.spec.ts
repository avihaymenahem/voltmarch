/// <reference types="vite/client" />
/**
 * TROOP TRANSPORTS — infantry ride inside vehicles.
 *
 * `src/sim/Transport.ts` is a plain class over `World` + `Channels`, so all of
 * this runs headless; `features.system.ts` is a registration shim and is
 * deliberately not imported.
 *
 * THE LOAD-BEARING TEST IS `leaves an Enter order aimed at a vehicle alone`.
 * That is the exact defect this feature fixes: `Garrison.ts` used to clear
 * every `Enter` order whose target was not a `Building`, which is why the Hover
 * Transport — blurb "Carries a squad across water" — could not carry anything.
 * Reinstate the old line and that one test fails while everything else here
 * still passes, because nothing else can see the order being eaten.
 *
 * The rest of the load-bearing assertions:
 *   - a full transport refuses the next man rather than silently overwriting,
 *   - passengers RIDE: their bodies track the hull, so a hull that dies at sea
 *     kills them at sea,
 *   - an unload over impassable ground refuses and KEEPS the squad, rather than
 *     putting it in the water,
 *   - two runs of one seed unload to identical positions.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { resetMoveClasses } from '../src/sim/Movement';

import { World } from '../src/core/world';
import { Channels } from '../src/core/events';
import { Rng } from '../src/core/math';
import {
  EntityFlag, EntityKind, Faction, Locomotor, OrderKind, UnitState,
} from '../src/core/types';
import type { EntityId, ITerrain, PlayerId, SimContext } from '../src/core/types';
import { SIM_DT } from '../src/core/config';

import { ProductionCatalog, ProductionService, setProduction } from '../src/sim/Production';
import type { BuildEntry } from '../src/sim/Production';
import { GarrisonService } from '../src/sim/Garrison';
import {
  TransportService, carrierMayAnswerPickup, setTransportService,
} from '../src/sim/Transport';

import { DEF_TABLES, UNITS } from '../src/data/Defs';

const ALLIES = 0 as PlayerId;
const SOVIETS = 1 as PlayerId;

/**
 * A binding over the REAL def tables, not the empty one most specs use.
 *
 * Seats are content — `UnitDef.passengers` — so a rig on the fallback roster
 * would answer 0 for everything and every assertion below would pass
 * vacuously. This is the one thing in this file that must come from
 * `src/data/Defs.ts` rather than from a literal.
 */
function boundBinding(): { tables: typeof DEF_TABLES; unitId: Record<string, number>;
  buildingId: Record<string, number> } {
  const unitId: Record<string, number> = {};
  DEF_TABLES.unitByKey.forEach((v, k) => { unitId[k] = v; });
  const buildingId: Record<string, number> = {};
  DEF_TABLES.buildingByKey.forEach((v, k) => { buildingId[k] = v; });
  return { tables: DEF_TABLES, unitId, buildingId };
}

/* ========================================================================== */
/* Fixture                                                                    */
/* ========================================================================== */

interface Rig {
  world: World;
  channels: Channels;
  production: ProductionService;
  garrison: GarrisonService;
  transport: TransportService;
  rng: Rng;
  tick: number;
  /** Garrison then Transport, in the registered order (-400 then -395). */
  step(steps?: number): void;
  unit(key: string, owner: PlayerId, x: number, z: number): EntityId;
}

function makeRig(seed = 4242): Rig {
  // The move-class table is MODULE-level and survives a new `World`. Its own
  // docstring names a test rig as the thing `resetMoveClasses` exists to
  // protect, and this rig never called it: a slot recycled at the same
  // generation kept a previous rig's class, so `Transport.place` - which now
  // asks the passenger's own class, so a tank is not put down on foot-only
  // ground - read a stale Hover off a rifleman and landed him in open sea.
  // It passed in isolation and failed in a full run, which is the signature.
  resetMoveClasses();
  const world = new World();
  world.addPlayer(Faction.Allies, 'Commander', true, true);
  world.addPlayer(Faction.Soviets, 'Opponent', false, false);

  const channels = new Channels();
  const binding = boundBinding();
  const production = new ProductionService(world, channels, new ProductionCatalog(binding));
  setProduction(production);

  const garrison = new GarrisonService(world, channels);
  garrison.attach();
  const transport = new TransportService(world, channels);
  transport.bindDefs(DEF_TABLES);
  transport.attach();
  setTransportService(transport);

  const rig: Rig = {
    world, channels, production, garrison, transport,
    rng: new Rng(seed),
    tick: 0,

    step(steps = 1): void {
      for (let i = 0; i < steps; i++) {
        rig.tick++;
        world.tick = rig.tick;
        world.time = rig.tick * SIM_DT;
        world.spatial.rebuild();
        const s: SimContext = { dt: SIM_DT, tick: rig.tick, time: world.time, rng: rig.rng };
        garrison.simTick(s);
        transport.simTick(s);
      }
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

/** Put a passenger right up against a hull, inside the boarding reach. */
function placeAgainst(rig: Rig, unit: EntityId, hull: EntityId): void {
  const st = rig.world.store;
  const i = st.index(unit);
  const t = st.index(hull);
  st.posX[i] = st.posX[t] + 0.5;
  st.posZ[i] = st.posZ[t];
  st.prevX[i] = st.posX[i];
  st.prevZ[i] = st.posZ[i];
}

function isAboard(rig: Rig, unit: EntityId): boolean {
  const st = rig.world.store;
  const i = st.index(unit);
  return i >= 0 && (st.flags[i] & EntityFlag.Garrisoned) !== 0;
}

/** Load `n` riflemen onto `hull` and assert they all got in. */
function loadSquad(rig: Rig, hull: EntityId, n: number, key = 'gi'): EntityId[] {
  const men: EntityId[] = [];
  for (let k = 0; k < n; k++) {
    const m = rig.unit(key, ALLIES, 200 + k, 200);
    placeAgainst(rig, m, hull);
    order(rig, m, OrderKind.Enter, hull);
    men.push(m);
  }
  rig.step();
  return men;
}

/* ========================================================================== */
/* Content                                                                    */
/* ========================================================================== */

describe('transport content', () => {
  it('gives every army a carrier at each rung of the naval line', () => {
    // Pinned as a SHAPE rather than a key list. The roster grew from three
    // hulls to a full line per army, and a hard-coded set of three keys is
    // exactly the assertion that would have had to be edited rather than
    // consulted - `naval-shore.spec.ts` had one of those and it pinned a defect
    // in place for months under a name that claimed the opposite.
    const slots = new Map<string, number>();
    for (const u of UNITS) if (u.cargoSlots > 0) slots.set(u.key, u.cargoSlots);

    // Every capacity is a legal rung: 2 (the Pact raider), 4 (landing), 8 (heavy).
    for (const [key, n] of slots) {
      expect([2, 4, 8], `"${key}" carries ${n} slots, which is not a rung`).toContain(n);
    }
    // A slot is not a seat, so the heavy hull must fit four vehicles at two each.
    expect(slots.get('transport')).toBe(8);
    expect(slots.get('rclScow')).toBe(4);
    expect(slots.get('mrdSkiff')).toBe(2);
  });

  it('gives every playable army a hull that carries', () => {
    // Allies and Soviets draw the shared `transport`; the Pact and the
    // Reclamation have parallel trees that the Neutral pool never reaches, so
    // each needs a carrier of its own or the verb is missing for half the game.
    const carriersFor = (f: Faction, shared: boolean): string[] => UNITS
      .filter((u) => u.cargoSlots > 0 && (u.faction === f || (shared && u.faction === Faction.Neutral)))
      .map((u) => u.key);

    expect(carriersFor(Faction.Allies, true).length).toBeGreaterThan(0);
    expect(carriersFor(Faction.Soviets, true).length).toBeGreaterThan(0);
    expect(carriersFor(Faction.Meridian, false).length).toBeGreaterThan(0);
    expect(carriersFor(Faction.Reclaim, false).length).toBeGreaterThan(0);
  });

  it('never puts a cargo hold on infantry', () => {
    for (const u of UNITS) {
      if (u.cargoSlots <= 0) continue;
      expect(u.kind, `"${u.key}" carries cargo`).toBe(EntityKind.Vehicle);
    }
  });

  it('keeps every carrier out of its own hold', () => {
    // `refusalFor` rejects a passenger that itself has capacity, because
    // nothing anywhere detects a cycle: two hulls each holding the other would
    // copy each other's position forever. This is the content half - a hull
    // whose slot cost is payable by another hull would make that reachable.
    for (const u of UNITS) {
      if (u.cargoSlots <= 0) continue;
      const largest = Math.max(...UNITS.map((o) => o.cargoSlots));
      expect(largest, `"${u.key}"`).toBeLessThanOrEqual(8);
    }
  });

  it('keeps seats and ore cargo as separate columns', () => {
    // `cargoMax` is ore by the tonne and is read as a float fill fraction by
    // every line of sim/Harvesting.ts. Nothing may be both.
    for (const u of UNITS) {
      if (u.cargoSlots > 0) expect(u.cargoMax, `"${u.key}"`).toBe(0);
    }
  });
});

/* ========================================================================== */
/* The order handover — THE regression test                                   */
/* ========================================================================== */

describe('the Enter order', () => {
  let rig: Rig;
  beforeEach(() => { rig = makeRig(); });

  it('leaves an Enter order aimed at a vehicle alone', () => {
    // GarrisonService used to own `Enter` outright and cleared it for any
    // target that was not a Building. Restoring that one line makes this fail.
    const hull = rig.unit('transport', ALLIES, 300, 300);
    const man = rig.unit('gi', ALLIES, 340, 300);      // far away: no boarding yet
    order(rig, man, OrderKind.Enter, hull);

    const st = rig.world.store;
    const i = st.index(man);

    const s: SimContext = { dt: SIM_DT, tick: 1, time: SIM_DT, rng: rig.rng };
    rig.garrison.simTick(s);

    expect(st.orderKind[i]).toBe(OrderKind.Enter);
    expect(st.orderTarget[i]).toBe(hull as number);
  });

  it('walks the passenger at the hull rather than at where it was', () => {
    const hull = rig.unit('transport', ALLIES, 300, 300);
    const man = rig.unit('gi', ALLIES, 340, 300);
    order(rig, man, OrderKind.Enter, hull);

    const st = rig.world.store;
    const i = st.index(man);
    const t = st.index(hull);

    rig.step();
    expect(st.orderX[i]).toBeCloseTo(300, 5);

    // The transport drives off; the squad chases the new position.
    st.posX[t] = 360;
    rig.step();
    expect(st.orderX[i]).toBeCloseTo(360, 5);
    expect(st.state[i]).toBe(UnitState.Moving);
  });

  it('clears an Enter order aimed at a hull with no seats', () => {
    const tank = rig.unit('grizzly', ALLIES, 300, 300);
    const man = rig.unit('gi', ALLIES, 340, 300);
    order(rig, man, OrderKind.Enter, tank);

    const st = rig.world.store;
    const i = st.index(man);
    rig.step();

    expect(st.orderKind[i]).toBe(OrderKind.None);
    expect(st.state[i]).toBe(UnitState.Idle);
  });
});

/* ========================================================================== */
/* Boarding                                                                   */
/* ========================================================================== */

describe('boarding', () => {
  let rig: Rig;
  beforeEach(() => { rig = makeRig(); });

  it('puts a man aboard and takes him off the field', () => {
    const hull = rig.unit('transport', ALLIES, 300, 300);
    const [man] = loadSquad(rig, hull, 1);

    const st = rig.world.store;
    const i = st.index(man);

    expect(isAboard(rig, man)).toBe(true);
    expect(st.flags[i] & EntityFlag.Immobilized).not.toBe(0);
    expect(st.orderKind[i]).toBe(OrderKind.None);
    expect(rig.transport.passengerCount(hull)).toBe(1);
    expect(rig.transport.hostOfUnit(man)).toBe(hull);
  });

  it('fills every slot and then refuses', () => {
    const hull = rig.unit('transport', ALLIES, 300, 300);
    expect(rig.transport.capacity(hull)).toBe(8);

    loadSquad(rig, hull, 8);
    expect(rig.transport.passengerCount(hull)).toBe(8);
    expect(rig.transport.usedSlots(hull), 'eight men at one slot each').toBe(8);

    const ninth = rig.unit('gi', ALLIES, 400, 400);
    placeAgainst(rig, ninth, hull);
    expect(rig.transport.refusalFor(hull, rig.world.store.index(ninth))).toBe('full');

    order(rig, ninth, OrderKind.Enter, hull);
    rig.step();

    expect(isAboard(rig, ninth)).toBe(false);
    expect(rig.transport.passengerCount(hull)).toBe(8);
    expect(rig.world.store.orderKind[rig.world.store.index(ninth)]).toBe(OrderKind.None);
  });

  it('charges a vehicle two slots, so four tanks fill an eight-slot hull', () => {
    // THE WHOLE POINT OF SLOTS. A head count would call this hull half empty.
    const hull = rig.unit('transport', ALLIES, 300, 300);
    const st = rig.world.store;

    for (let n = 0; n < 4; n++) {
      const tank = rig.unit('grizzly', ALLIES, 300, 302);
      placeAgainst(rig, tank, hull);
      order(rig, tank, OrderKind.Enter, hull);
      rig.step();
    }

    expect(rig.transport.passengerCount(hull), 'four hulls aboard').toBe(4);
    expect(rig.transport.usedSlots(hull), 'at two slots each, it is FULL').toBe(8);

    const fifth = rig.unit('grizzly', ALLIES, 300, 304);
    placeAgainst(rig, fifth, hull);
    expect(rig.transport.refusalFor(hull, st.index(fifth))).toBe('full');
    // And a single rifleman does not fit either: there is no slot left at all.
    const man = rig.unit('gi', ALLIES, 300, 306);
    placeAgainst(rig, man, hull);
    expect(rig.transport.refusalFor(hull, st.index(man))).toBe('full');
  });

  it('refuses an enemy hull, and refuses a carrier as cargo', () => {
    const mine = rig.unit('transport', ALLIES, 300, 300);
    const theirs = rig.unit('transport', SOVIETS, 320, 300);
    const man = rig.unit('gi', ALLIES, 300, 302);
    const tank = rig.unit('grizzly', ALLIES, 300, 304);
    const st = rig.world.store;

    expect(rig.transport.refusalFor(theirs, st.index(man))).toBe('hostile');
    // A tank RIDES now. That is the feature.
    expect(rig.transport.refusalFor(mine, st.index(tank))).toBe('');
    expect(rig.transport.refusalFor(mine, st.index(man))).toBe('');
    // A carrier may not board a carrier: nothing detects the cycle, and two
    // hulls each holding the other would copy each other's position forever.
    expect(rig.transport.refusalFor(mine, st.index(theirs))).toBe('cannot ride');
  });

  it('answers 0 seats until the def tables are bound', () => {
    // A transport whose capacity has not landed reads as "not a transport",
    // which is why features.system.ts AWAITS the binding before attaching.
    const bare = new TransportService(rig.world, rig.channels);
    const hull = rig.unit('transport', ALLIES, 300, 300);
    expect(bare.capacity(hull)).toBe(0);
    expect(rig.transport.capacity(hull)).toBe(8);
  });
});

describe('shore pickup order arbitration', () => {
  it('lets an idle hull answer after a completed combat order', () => {
    // Steering intentionally leaves the completed intent in `orderKind`; live
    // state, not that stale ledger entry, says whether boarding may call it in.
    expect(carrierMayAnswerPickup(UnitState.Idle, OrderKind.Attack)).toBe(true);
    expect(carrierMayAnswerPickup(UnitState.Idle, OrderKind.Guard)).toBe(true);
  });

  it('does not steal a hull from live combat or an explicit unload', () => {
    expect(carrierMayAnswerPickup(UnitState.Attacking, OrderKind.Attack)).toBe(false);
    expect(carrierMayAnswerPickup(UnitState.Guarding, OrderKind.Guard)).toBe(false);
    expect(carrierMayAnswerPickup(UnitState.Idle, OrderKind.Unload)).toBe(false);
  });
});

/* ========================================================================== */
/* Riding                                                                     */
/* ========================================================================== */

describe('riding', () => {
  let rig: Rig;
  beforeEach(() => { rig = makeRig(); });

  it('drags passengers along with the hull', () => {
    const hull = rig.unit('transport', ALLIES, 300, 300);
    const [man] = loadSquad(rig, hull, 1);
    const st = rig.world.store;
    const i = st.index(man);
    const t = st.index(hull);

    st.posX[t] = 500;
    st.posZ[t] = 640;
    rig.step();

    expect(st.posX[i]).toBeCloseTo(500, 5);
    expect(st.posZ[i]).toBeCloseTo(640, 5);
    // prev is dragged too, so the render bridge does not interpolate a
    // passenger across the map on the frame it lands.
    expect(st.prevX[i]).toBeCloseTo(500, 5);
  });

  it('kills the squad with the hull', () => {
    const hull = rig.unit('transport', ALLIES, 300, 300);
    const men = loadSquad(rig, hull, 3);
    expect(rig.transport.passengerCount(hull)).toBe(3);

    const st = rig.world.store;
    // `store.markDead` sets a flag and nothing else — `sim/Damage.ts` is what
    // emits the event, so a headless kill has to emit it the same way. This is
    // the shape Damage.ts publishes verbatim.
    st.markDead(hull);
    rig.channels.events.emit('entity:killed', {
      id: hull, kind: EntityKind.Vehicle, defId: st.defId[st.index(hull)], player: ALLIES,
      killer: 0 as EntityId, killerPlayer: SOVIETS, x: 300, z: 300, value: 0,
    });

    for (const m of men) {
      const i = st.index(m);
      expect((st.flags[i] & EntityFlag.PendingDestroy) !== 0, 'passenger survived').toBe(true);
    }
    expect(rig.transport.stats.drowned).toBe(3);
  });

  it('sinks the squad in front of the death scan, so each man is counted', () => {
    // The path a hull actually takes: Phase.Damage stamps PendingDestroy, the
    // transport tick sees it at Cleanup -395, and Damage.cleanupTick scans for
    // the flag at Cleanup 0. Marking the men at -395 is what gets each of them
    // their own `entity:killed` instead of being freed silently.
    const hull = rig.unit('transport', ALLIES, 300, 300);
    const men = loadSquad(rig, hull, 3);
    const st = rig.world.store;

    st.markDead(hull);            // no event: this is what Phase.Damage does
    rig.step();

    for (const m of men) {
      expect(st.isPendingDestroy(m), 'passenger survived its hull').toBe(true);
    }
    expect(rig.transport.stats.drowned).toBe(3);
    expect(rig.transport.passengerCount(hull)).toBe(0);
  });

  it('puts a passenger back on the field if its hull vanishes silently', () => {
    const hull = rig.unit('transport', ALLIES, 300, 300);
    const [man] = loadSquad(rig, hull, 1);
    const st = rig.world.store;

    // Straight to the store, bypassing `entity:killed` — a save load or a
    // service torn down mid-match reaches this state.
    setTransportService(rig.transport);
    st.markDead(hull);
    st.flushDestroyed();
    rig.step();

    expect(isAboard(rig, man)).toBe(false);
    expect(st.flags[st.index(man)] & EntityFlag.Immobilized).toBe(0);
  });
});

/* ========================================================================== */
/* Unloading                                                                  */
/* ========================================================================== */

describe('unloading', () => {
  let rig: Rig;
  beforeEach(() => { rig = makeRig(); });

  it('puts the squad down around the hull and clears the order', () => {
    const hull = rig.unit('transport', ALLIES, 300, 300);
    const men = loadSquad(rig, hull, 4);
    const st = rig.world.store;
    const t = st.index(hull);

    st.orderKind[t] = OrderKind.Unload;
    rig.step();

    expect(rig.transport.passengerCount(hull)).toBe(0);
    expect(st.orderKind[t]).toBe(OrderKind.None);
    for (const m of men) {
      const i = st.index(m);
      expect(isAboard(rig, m)).toBe(false);
      expect(st.flags[i] & EntityFlag.Immobilized).toBe(0);
      expect(st.state[i]).toBe(UnitState.Idle);
      // Beside the hull, not on top of it.
      const d = Math.hypot(st.posX[i] - st.posX[t], st.posZ[i] - st.posZ[t]);
      expect(d).toBeGreaterThan(0.5);
      expect(d).toBeLessThan(20);
    }
  });

  it('does not stack two men on the same metre', () => {
    const hull = rig.unit('transport', ALLIES, 300, 300);
    const men = loadSquad(rig, hull, 5);
    const st = rig.world.store;
    st.orderKind[st.index(hull)] = OrderKind.Unload;
    rig.step();

    for (let a = 0; a < men.length; a++) {
      for (let b = a + 1; b < men.length; b++) {
        const i = st.index(men[a]);
        const j = st.index(men[b]);
        const d = Math.hypot(st.posX[i] - st.posX[j], st.posZ[i] - st.posZ[j]);
        expect(d, `men ${a} and ${b} landed on top of each other`).toBeGreaterThan(0.5);
      }
    }
  });

  it('keeps the squad rather than drowning it when nothing is standable', () => {
    const hull = rig.unit('transport', ALLIES, 300, 300);
    loadSquad(rig, hull, 2);
    const st = rig.world.store;

    // Open sea: every cell refuses a foot unit. `place` must find no ring.
    const base = rig.world.terrain;
    const drowned: ITerrain = {
      ...base,
      heightAt: (x: number, z: number) => base.heightAt(x, z),
      isPassable: (_cx: number, _cz: number, loco: Locomotor) => loco !== Locomotor.Foot,
      isOccupied: () => false,
    } as ITerrain;
    rig.world.terrain = drowned;

    st.orderKind[st.index(hull)] = OrderKind.Unload;
    rig.step();

    expect(rig.transport.passengerCount(hull)).toBe(2);
    expect(rig.transport.stats.unloaded).toBe(0);
    expect(rig.transport.stats.unloadRefusals).toBeGreaterThan(0);
    // The order STANDS, so the hull unloads the moment it reaches a coast.
    expect(st.orderKind[st.index(hull)]).toBe(OrderKind.Unload);

    rig.world.terrain = base;
    rig.step();
    expect(rig.transport.passengerCount(hull)).toBe(0);
    expect(st.orderKind[st.index(hull)]).toBe(OrderKind.None);
  });

  it('unloads to identical positions from an identical seed', () => {
    const run = (): number[] => {
      const r = makeRig(99);
      const hull = r.unit('transport', ALLIES, 300, 300);
      const men = loadSquad(r, hull, 5);
      const st = r.world.store;
      st.orderKind[st.index(hull)] = OrderKind.Unload;
      r.step();
      const out: number[] = [];
      for (const m of men) {
        const i = st.index(m);
        out.push(st.posX[i], st.posZ[i]);
      }
      return out;
    };
    expect(run()).toEqual(run());
  });

  it('reports occupancy for the HUD', () => {
    const hull = rig.unit('transport', ALLIES, 300, 300);
    const st = rig.world.store;
    const t = st.index(hull);

    expect(rig.transport.isLoadedAt(t)).toBe(false);
    loadSquad(rig, hull, 2);
    expect(rig.transport.isLoadedAt(t)).toBe(true);
    expect(rig.transport.stats.riding).toBe(2);
    expect(rig.transport.stats.loaded).toBe(1);

    const out = new Int32Array(8);
    expect(rig.transport.passengers(hull, out)).toBe(2);
  });
});

/* ========================================================================== */
/* Garrisons and transports coexist                                           */
/* ========================================================================== */

describe('garrisons and transports', () => {
  it('do not count each other\'s occupants', () => {
    const rig = makeRig();
    const hull = rig.unit('transport', ALLIES, 300, 300);
    loadSquad(rig, hull, 2);

    // A man inside a BUILDING carries the same flag and must not be counted as
    // a passenger; `store.garrisonId` against `store.carrierId` is what
    // separates them.
    //
    // THE HOST IS REAL, and it has to be. This used to set the flag and nothing
    // else, so the "garrison occupant" was a man with no host of either kind —
    // which is not a garrison occupant, it is the permanently invisible state
    // `GarrisonService.recover` now repairs, and the fixture asserted it
    // survived the tick. Held by an actual building, the assertion means what it
    // says: two services, two columns, neither one touching the other's men.
    const st = rig.world.store;
    const block = st.alloc(
      EntityKind.Building, 0, ALLIES, Faction.Allies, 600, 0, 600, 0,
    );
    st.footprintW[st.index(block)] = 2;
    st.footprintH[st.index(block)] = 2;
    const stray = rig.unit('gi', ALLIES, 600, 600);
    st.flags[st.index(stray)] |= EntityFlag.Garrisoned;
    st.garrisonId[st.index(stray)] = block as number;
    rig.step();

    expect(rig.transport.passengerCount(hull)).toBe(2);
    expect(rig.transport.stats.riding).toBe(2);
    expect(isAboard(rig, stray)).toBe(true);   // untouched by the transport tick
    expect(rig.garrison.hostOfUnit(stray)).toBe(block);
  });
});

/* ========================================================================== */
/* Orphaned passengers                                                        */
/* ========================================================================== */

/**
 * A HULL THAT VANISHES WITHOUT KILLING ITS SQUAD.
 *
 * `ride` reaches `strand` when `st.index(carrierId)` no longer resolves — the
 * "flushDestroyed race" its own header names, alongside a save load and a
 * disposed service. Forcing an unresolvable handle is the honest way to
 * reproduce it: it is the state, not the route, that these two pin.
 *
 * Reported as an unwinnable match on Sunder Atoll — the enemy base was flat and
 * two harvesters sat in open water, alive, unkillable and counted by
 * `Shell.pollOutcome`. `strand` used to `disembark` at the passenger's own
 * position, which while riding IS the hull's position, and a shipyard hull is
 * always afloat.
 */
describe('a passenger whose hull disappeared', () => {
  let rig: Rig;
  beforeEach(() => { rig = makeRig(); });

  /** Point `carrierId` at a handle no live slot answers to. */
  function orphan(rig: Rig, man: EntityId): void {
    const st = rig.world.store;
    st.carrierId[st.index(man)] = 0x7ffffff0;
  }

  it('drowns rather than standing on the sea when no ground is in reach', () => {
    const hull = rig.unit('transport', ALLIES, 300, 300);
    const men = loadSquad(rig, hull, 2);
    const st = rig.world.store;

    const base = rig.world.terrain;
    rig.world.terrain = {
      ...base,
      isPassable: (_cx: number, _cz: number, loco: Locomotor) => loco !== Locomotor.Foot,
      isOccupied: () => false,
    } as ITerrain;

    for (const m of men) orphan(rig, m);
    rig.step();

    for (const m of men) {
      const i = st.index(m);
      expect(i, 'slot vanished without a flush').toBeGreaterThanOrEqual(0);
      // `markDead` only STAMPS: the slot is not freed and `Alive` is not
      // cleared until `flushDestroyed` runs at Phase.Cleanup, which this rig
      // does not drive. `PendingDestroy` is therefore the assertion — it is
      // what `Damage.cleanupTick` scans for, and what makes the harvester
      // stop being a living asset the moment a real tick runs.
      expect(st.flags[i] & EntityFlag.PendingDestroy, 'left afloat and alive').not.toBe(0);
      expect(st.state[i]).toBe(UnitState.Drowned);
      expect(st.carrierId[i]).toBe(0);
    }
    expect(rig.transport.stats.stranded).toBe(2);
    expect(rig.transport.stats.drowned).toBe(2);
  });

  it('is set down where it stands when that ground is legitimate', () => {
    const hull = rig.unit('transport', ALLIES, 300, 300);
    const men = loadSquad(rig, hull, 2);
    const st = rig.world.store;

    // Land under the hull: the save-load and disposal cases the old comment
    // was protecting. Behaviour must be UNCHANGED for them.
    for (const m of men) orphan(rig, m);
    rig.step();

    for (const m of men) {
      const i = st.index(m);
      expect(i, 'killed on passable ground').toBeGreaterThanOrEqual(0);
      expect(st.flags[i] & EntityFlag.Alive).not.toBe(0);
      expect(st.flags[i] & EntityFlag.Garrisoned).toBe(0);
      expect(st.carrierId[i]).toBe(0);
    }
    expect(rig.transport.stats.stranded).toBe(0);
  });
});
