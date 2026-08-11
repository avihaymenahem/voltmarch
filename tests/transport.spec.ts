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
import { TransportService, setTransportService } from '../src/sim/Transport';

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
  it('gives seats to exactly the three hulls that are meant to carry', () => {
    const seats = new Map<string, number>();
    for (const u of UNITS) if (u.passengers > 0) seats.set(u.key, u.passengers);

    expect([...seats.keys()].sort()).toEqual(['mrdSkiff', 'rclScow', 'transport']);
    expect(seats.get('transport')).toBe(5);
    expect(seats.get('mrdSkiff')).toBe(2);
    expect(seats.get('rclScow')).toBe(4);
  });

  it('gives every playable army a hull that carries', () => {
    // Allies and Soviets draw the shared `transport`; the Pact and the
    // Reclamation have parallel trees that the Neutral pool never reaches, so
    // each needs a carrier of its own or the verb is missing for half the game.
    const carriersFor = (f: Faction, shared: boolean): string[] => UNITS
      .filter((u) => u.passengers > 0 && (u.faction === f || (shared && u.faction === Faction.Neutral)))
      .map((u) => u.key);

    expect(carriersFor(Faction.Allies, true).length).toBeGreaterThan(0);
    expect(carriersFor(Faction.Soviets, true).length).toBeGreaterThan(0);
    expect(carriersFor(Faction.Meridian, false).length).toBeGreaterThan(0);
    expect(carriersFor(Faction.Reclaim, false).length).toBeGreaterThan(0);
  });

  it('never puts seats on infantry', () => {
    for (const u of UNITS) {
      if (u.passengers <= 0) continue;
      expect(u.kind, `"${u.key}" carries passengers`).toBe(EntityKind.Vehicle);
    }
  });

  it('keeps seats and ore cargo as separate columns', () => {
    // `cargoMax` is ore by the tonne and is read as a float fill fraction by
    // every line of sim/Harvesting.ts. Nothing may be both.
    for (const u of UNITS) {
      if (u.passengers > 0) expect(u.cargoMax, `"${u.key}"`).toBe(0);
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

  it('fills every seat and then refuses', () => {
    const hull = rig.unit('transport', ALLIES, 300, 300);
    expect(rig.transport.capacity(hull)).toBe(5);

    loadSquad(rig, hull, 5);
    expect(rig.transport.passengerCount(hull)).toBe(5);

    const sixth = rig.unit('gi', ALLIES, 400, 400);
    placeAgainst(rig, sixth, hull);
    expect(rig.transport.refusalFor(hull, rig.world.store.index(sixth))).toBe('full');

    order(rig, sixth, OrderKind.Enter, hull);
    rig.step();

    expect(isAboard(rig, sixth)).toBe(false);
    expect(rig.transport.passengerCount(hull)).toBe(5);
    expect(rig.world.store.orderKind[rig.world.store.index(sixth)]).toBe(OrderKind.None);
  });

  it('refuses an enemy hull and a non-infantry passenger', () => {
    const mine = rig.unit('transport', ALLIES, 300, 300);
    const theirs = rig.unit('transport', SOVIETS, 320, 300);
    const man = rig.unit('gi', ALLIES, 300, 302);
    const tank = rig.unit('grizzly', ALLIES, 300, 304);
    const st = rig.world.store;

    expect(rig.transport.refusalFor(theirs, st.index(man))).toBe('hostile');
    expect(rig.transport.refusalFor(mine, st.index(tank))).toBe('not infantry');
    expect(rig.transport.refusalFor(mine, st.index(man))).toBe('');
  });

  it('answers 0 seats until the def tables are bound', () => {
    // A transport whose capacity has not landed reads as "not a transport",
    // which is why features.system.ts AWAITS the binding before attaching.
    const bare = new TransportService(rig.world, rig.channels);
    const hull = rig.unit('transport', ALLIES, 300, 300);
    expect(bare.capacity(hull)).toBe(0);
    expect(rig.transport.capacity(hull)).toBe(5);
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
    // a passenger; the garrison's own `hostOf` column is what separates them.
    const st = rig.world.store;
    const stray = rig.unit('gi', ALLIES, 600, 600);
    st.flags[st.index(stray)] |= EntityFlag.Garrisoned;
    rig.step();

    expect(rig.transport.passengerCount(hull)).toBe(2);
    expect(rig.transport.stats.riding).toBe(2);
    expect(isAboard(rig, stray)).toBe(true);   // untouched by the transport tick
  });
});
