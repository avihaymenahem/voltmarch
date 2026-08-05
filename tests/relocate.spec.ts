/// <reference types="vite/client" />
/**
 * ============================================================================
 * tests/relocate.spec.ts
 * ============================================================================
 * Picking a standing structure up and putting it down somewhere else, end to
 * end and headless.
 *
 * `src/sim/Relocate.ts` is a pure rule plus a service that counts ticks, so all
 * of it runs under `environment: 'node'`. Nothing here constructs a renderer:
 * `PlacementController` is the only part of the flow that touches THREE, and
 * the RULE it drives (`evaluatePlacement`, plus `PlacementExempt`) is a pure
 * function over the World, which is exactly why the two live apart.
 *
 * WHAT THESE CASES PROTECT
 * ------------------------
 *   - THE FEE IS TAKEN EXACTLY ONCE. Two clicks inside one tick, a commit that
 *     is then refused, a destination that goes bad in transit — none of them
 *     may charge twice, and none of them may charge nothing.
 *   - A REFUSAL COSTS NOTHING AND CHANGES NOTHING. The structure is still
 *     standing, the credits are still there, and the reason is a sentence a
 *     player can act on.
 *   - THE STRUCTURE IS NEVER LOST. Not to a blocked destination, not to a base
 *     that died while it was in transit. Worst case it goes home with the fee.
 *   - THE OWN-FOOTPRINT EXEMPTION. Without it every short move is refused and
 *     only long ones work, which is exactly backwards.
 *   - A STRUCTURE CANNOT WALK ON ITS OWN BUILD RADIUS. Without the self-mask a
 *     lone structure hops across the map one relocation at a time and the
 *     base-creep rule stops existing.
 *   - STATE SURVIVES: rally point, primary-factory flag, veterancy, damage, the
 *     repair wrench, and the build queue that was mid-item.
 *   - THE POWER GRID IS CONSISTENT: a moved plant supplies nothing while it is
 *     nowhere, and exactly what it used to once it lands.
 *   - DETERMINISM: two identical runs move on the identical tick to the
 *     identical cell.
 * ============================================================================
 */

import { beforeEach, afterEach, describe, expect, it } from 'vitest';

import { World } from '../src/core/world';
import { Channels } from '../src/core/events';
import { Rng } from '../src/core/math';
import {
  BuildTab, EntityFlag, EntityKind, EvaLine, Faction, NONE, OrderKind, UnitState,
} from '../src/core/types';
import type { EntityId, ITerrain, PlayerId, SimContext } from '../src/core/types';
import { CELL, SELL_REFUND, SIM_DT } from '../src/core/config';

import { ProductionCatalog, ProductionService, setProduction } from '../src/sim/Production';
import { DamageSystem } from '../src/sim/Damage';
import { PowerGrid } from '../src/sim/Power';
import { Economy, setActiveEconomy } from '../src/sim/Economy';
import { GarrisonService, setGarrisonService } from '../src/sim/Garrison';
import { RepairSellService, setRepairSellService } from '../src/sim/RepairSell';
import { bindDeployTables, contentKeyOf } from '../src/sim/Deploy';
import {
  RELOCATE, RelocateFault, RelocateService, TRANSIT_TICKS,
  evaluateRelocate, makeRelocateReport, relocationFee, setRelocate, subjectFault,
} from '../src/sim/Relocate';
import { setRelocateSeam } from '../src/sim/Placement';

import { RELOCATE as RELOCATE_FROM_DATA, relocationFee as feeFromData } from '../src/data/Defs';

const EMPTY_BINDING = { tables: null, unitId: {}, buildingId: {} };

/* ==========================================================================
 * Fixtures
 *
 * A relocation touches four phases of the real tick, so the rig runs four
 * phases in the real order. Skipping Cleanup in particular would be a false
 * result rather than a shortcut: `entity:killed` is what releases the uprooted
 * structure's occupancy grid cells, and without it the destination check at the
 * far end is answering a question about a world that never happened.
 * ========================================================================== */

interface Rig {
  world: World;
  channels: Channels;
  production: ProductionService;
  relocate: RelocateService;
  damage: DamageSystem;
  power: PowerGrid;
  eva: EvaLine[];
  tick: number;
}

function makeRig(credits = 20000): Rig {
  const world = new World();
  world.addPlayer(Faction.Allies, 'Commander', true, true);
  world.addPlayer(Faction.Soviets, 'Opponent', false, false);
  const channels = new Channels();
  const catalog = new ProductionCatalog(EMPTY_BINDING);
  const production = new ProductionService(world, channels, catalog);
  setProduction(production);
  // No data module in a headless test. `Deploy`'s three-row fallback is what
  // tells `subjectFault` that a Construction Yard packs into an MCV.
  bindDeployTables(null);

  const relocate = new RelocateService(world, channels);
  setRelocate(relocate);
  setRelocateSeam(relocate);

  world.player(0 as PlayerId).credits = credits;
  world.player(1 as PlayerId).credits = credits;

  const eva: EvaLine[] = [];
  channels.events.on('eva:line', (p) => { eva.push(p.line); });

  return {
    world,
    channels,
    production,
    relocate,
    damage: new DamageSystem(world, channels),
    power: new PowerGrid(world, channels),
    eva,
    tick: 0,
  };
}

/**
 * One sim step, in the real phase order.
 *
 *   Command (100)        relocate consumes the request and lands arrivals
 *   Production (200)     queues, construction rise, the rally/primary intents
 *   SpatialRebuild (800) the index `evaluatePlacement` reads
 *   Cleanup (1400)       `entity:killed`, occupancy release, slot recycling
 */
function step(rig: Rig, steps = 1): void {
  const rng = new Rng(1234);
  for (let n = 0; n < steps; n++) {
    rig.tick++;
    rig.world.tick = rig.tick;
    rig.world.time = rig.tick * SIM_DT;
    const s: SimContext = { dt: SIM_DT, tick: rig.tick, time: rig.world.time, rng };
    rig.relocate.tick(s);
    rig.production.tick(s);
    rig.world.spatial.rebuild();
    rig.damage.cleanupTick(s);
  }
}

/** Plant a finished structure the way a scenario would. */
function plant(rig: Rig, key: string, cx: number, cz: number, player = 0): EntityId {
  const entry = rig.production.catalog.byKey(key);
  expect(entry, `no catalog entry for "${key}"`).not.toBeNull();
  const id = rig.production.spawnBuilding(rig.world.player(player as PlayerId), entry!, cx, cz, 1);
  expect(id).not.toBe(NONE);
  rig.world.spatial.rebuild();
  return id;
}

/** The first live structure of a key owned by `player`, or NONE. */
function findBuilding(rig: Rig, key: string, player = 0): EntityId {
  const st = rig.world.store;
  const list = st.byKind[EntityKind.Building];
  for (let a = 0; a < st.byKindCount[EntityKind.Building]; a++) {
    const i = list[a];
    if ((st.flags[i] & EntityFlag.Alive) === 0) continue;
    if ((st.flags[i] & EntityFlag.PendingDestroy) !== 0) continue;
    if (st.owner[i] !== player) continue;
    if (contentKeyOf(rig.world, i) === key) return st.handleOf(i);
  }
  return NONE;
}

/** A base big enough to have somewhere to move things to. */
function base(rig: Rig): void {
  plant(rig, 'conyard', 40, 40);
}

function credits(rig: Rig, player = 0): number {
  return rig.world.player(player as PlayerId).credits;
}

function feeFor(rig: Rig, key: string): number {
  return relocationFee(rig.production.catalog.byKey(key)!.cost);
}

/** Drive one whole relocation to completion and return the new entity. */
function moveTo(rig: Rig, id: EntityId, cx: number, cz: number, player = 0): EntityId {
  expect(rig.relocate.commit(player as PlayerId, id, cx, cz)).toBe(true);
  // Request tick, transit, then the two-second rise plus a tick of slack.
  step(rig, TRANSIT_TICKS + 90);
  const st = rig.world.store;
  const scan = st.byKind[EntityKind.Building];
  for (let a = 0; a < st.byKindCount[EntityKind.Building]; a++) {
    const i = scan[a];
    if ((st.flags[i] & EntityFlag.Alive) === 0) continue;
    if (st.owner[i] !== player) continue;
    const originX = Math.round(st.posX[i] / CELL - st.footprintW[i] * 0.5);
    const originZ = Math.round(st.posZ[i] / CELL - st.footprintH[i] * 0.5);
    if (originX === cx && originZ === cz) return st.handleOf(i);
  }
  return NONE;
}

/** A terrain that refuses to be built on — a cliff, a lake, a crater field. */
function refuseBuildable(world: World): void {
  const b = world.terrain;
  const stub: ITerrain = {
    heightAt: (x, z) => b.heightAt(x, z),
    normalAt: (x, z, out) => b.normalAt(x, z, out),
    slopeAt: (x, z) => b.slopeAt(x, z),
    isPassable: (cx, cz, loco) => b.isPassable(cx, cz, loco),
    isBuildable: () => false,
    isOccupied: (cx, cz) => b.isOccupied(cx, cz),
    markOccupied: (cx, cz, w, h, id) => b.markOccupied(cx, cz, w, h, id),
    clearOccupied: (cx, cz, w, h) => b.clearOccupied(cx, cz, w, h),
    occupancyVersion: () => b.occupancyVersion(),
    isWater: (cx, cz) => b.isWater(cx, cz),
    raycastGround: (ox, oy, oz, dx, dy, dz, out) =>
      b.raycastGround(ox, oy, oz, dx, dy, dz, out),
  };
  world.terrain = stub;
}

beforeEach(() => {
  setProduction(null);
  setRelocate(null);
  setRelocateSeam(null);
  setActiveEconomy(null);
  setGarrisonService(null);
  setRepairSellService(null);
  bindDeployTables(null);
});

afterEach(() => {
  setProduction(null);
  setRelocate(null);
  setRelocateSeam(null);
  setActiveEconomy(null);
  setGarrisonService(null);
  setRepairSellService(null);
});

/* ==========================================================================
 * 1. THE PRICE
 * ========================================================================== */

describe('the fee', () => {
  it('is a rounded fraction of build cost with a floor under it', () => {
    expect(relocationFee(2000)).toBe(Math.round(2000 * RELOCATE.costFraction));
    expect(relocationFee(1000)).toBe(Math.round(1000 * RELOCATE.costFraction));
    // Below the floor the floor wins, and it is never free.
    expect(relocationFee(10)).toBe(RELOCATE.minCost);
    expect(relocationFee(0)).toBe(RELOCATE.minCost);
    expect(relocationFee(-500)).toBe(RELOCATE.minCost);
    // Always an integer: credits are not a float in any readout.
    for (const cost of [137, 349, 751, 1999]) {
      expect(Number.isInteger(relocationFee(cost))).toBe(true);
    }
  });

  it('undercuts sell-and-rebuild, which is the alternative it competes with', () => {
    // Selling refunds SELL_REFUND, so rebuilding costs (1 - SELL_REFUND) of
    // build cost PLUS the full build time PLUS a queue slot. If relocation were
    // not strictly cheaper than that, nobody would ever press it.
    expect(RELOCATE.costFraction).toBeLessThan(1 - SELL_REFUND);
    // ...and it is not so cheap that a badly laid-out base stops being a
    // mistake. Anything under a tenth is pocket change.
    expect(RELOCATE.costFraction).toBeGreaterThan(0.1);
  });

  it('costs real time, so a defensive line cannot be slid around under fire', () => {
    expect(RELOCATE.transitSeconds).toBeGreaterThan(1);
    expect(TRANSIT_TICKS).toBe(Math.max(1, Math.round(RELOCATE.transitSeconds / SIM_DT)));
  });

  it('is the same object the content layer publishes', () => {
    // src/data/Defs.ts re-exports the price so a designer finds it beside every
    // other price in the game. Re-export, not a copy — a copy would drift.
    expect(RELOCATE_FROM_DATA).toBe(RELOCATE);
    expect(feeFromData).toBe(relocationFee);
  });

  it('is quoted by the service before anything is committed', () => {
    const rig = makeRig();
    base(rig);
    const plant1 = plant(rig, 'powerPlant', 45, 40);
    expect(rig.relocate.costFor(plant1)).toBe(feeFor(rig, 'powerPlant'));
    expect(rig.relocate.inspect(0 as PlayerId, plant1).cost).toBe(feeFor(rig, 'powerPlant'));
    // Quoting a price is not buying anything.
    expect(credits(rig)).toBe(20000);
  });
});

/* ==========================================================================
 * 2. WHAT MAY BE MOVED
 * ========================================================================== */

describe('subjectFault', () => {
  it('accepts a finished structure the player owns', () => {
    const rig = makeRig();
    base(rig);
    const id = plant(rig, 'powerPlant', 45, 40);
    const out = makeRelocateReport();
    subjectFault(rig.world, rig.production, 0 as PlayerId, id, out);
    expect(out.ok).toBe(true);
    expect(out.reason).toBe('');
    expect(out.entry?.key).toBe('powerPlant');
  });

  it('refuses somebody else\'s structure', () => {
    const rig = makeRig();
    const id = plant(rig, 'powerPlant', 90, 90, 1);
    const out = makeRelocateReport();
    subjectFault(rig.world, rig.production, 0 as PlayerId, id, out);
    expect(out.ok).toBe(false);
    expect(out.fault).toBe(RelocateFault.NotYours);
    expect(out.reason).not.toBe('');
  });

  it('refuses a unit, and anything that is not a live entity', () => {
    const rig = makeRig();
    base(rig);
    const entry = rig.production.catalog.byKey('grizzly')!;
    const tank = rig.production.spawnUnit(rig.world.player(0 as PlayerId), entry, 200, 160, 0);
    const out = makeRelocateReport();
    subjectFault(rig.world, rig.production, 0 as PlayerId, tank, out);
    expect(out.fault).toBe(RelocateFault.NotYours);
    subjectFault(rig.world, rig.production, 0 as PlayerId, NONE, out);
    expect(out.fault).toBe(RelocateFault.NotYours);
  });

  it('refuses a structure that is still rising', () => {
    const rig = makeRig();
    base(rig);
    const entry = rig.production.catalog.byKey('powerPlant')!;
    const id = rig.production.spawnBuilding(rig.world.player(0 as PlayerId), entry, 45, 40, 0);
    rig.world.spatial.rebuild();
    const out = makeRelocateReport();
    subjectFault(rig.world, rig.production, 0 as PlayerId, id, out);
    expect(out.ok).toBe(false);
    expect(out.fault).toBe(RelocateFault.Busy);

    // ...and accepts it the moment it finishes.
    step(rig, 90);
    subjectFault(rig.world, rig.production, 0 as PlayerId, id, out);
    expect(out.ok).toBe(true);
  });

  it('refuses a Construction Yard and points at the vehicle instead', () => {
    // The load-bearing case. A yard MOVES by packing into an MCV; a yard that
    // blinked would strand every structure whose build radius it provides, and
    // it would be a second, worse copy of a mechanic Deploy.ts already owns.
    const rig = makeRig();
    const yard = plant(rig, 'conyard', 40, 40);
    const out = makeRelocateReport();
    subjectFault(rig.world, rig.production, 0 as PlayerId, yard, out);
    expect(out.ok).toBe(false);
    expect(out.fault).toBe(RelocateFault.PacksIntoVehicle);
    expect(out.reason).toMatch(/pack/i);

    // And the refusal survives the whole flow: no charge, no uproot.
    const before = credits(rig);
    expect(rig.relocate.commit(0 as PlayerId, yard, 50, 50)).toBe(false);
    step(rig, 4);
    expect(credits(rig)).toBe(before);
    expect(rig.world.store.index(yard)).toBeGreaterThanOrEqual(0);
  });

  it('refuses a structure the player cannot afford to move', () => {
    const rig = makeRig(10);
    base(rig);
    const id = plant(rig, 'powerPlant', 45, 40);
    const out = makeRelocateReport();
    subjectFault(rig.world, rig.production, 0 as PlayerId, id, out);
    expect(out.ok).toBe(false);
    expect(out.fault).toBe(RelocateFault.CannotAfford);
    // The price is still quoted on a refusal, so the button can print it.
    expect(out.cost).toBe(feeFor(rig, 'powerPlant'));
  });

  it('refuses a garrisoned structure', () => {
    const rig = makeRig();
    base(rig);
    const garrison = new GarrisonService(rig.world, rig.channels);
    setGarrisonService(garrison);

    // Find something the garrison rules actually accept, rather than asserting
    // a hand-picked key that a content edit could quietly make un-garrisonable.
    let host = NONE;
    let cell = 46;
    for (const entry of rig.production.catalog.entries) {
      if (entry.footprintW <= 0 || entry.key === 'conyard') continue;
      const id = rig.production.spawnBuilding(
        rig.world.player(0 as PlayerId), entry, cell, 46, 1,
      );
      if (id === NONE) continue;
      cell += entry.footprintW + 1;
      rig.world.spatial.rebuild();
      if (garrison.canGarrison(id, 0 as PlayerId)) { host = id; break; }
    }
    expect(host, 'no garrisonable structure in the catalog').not.toBe(NONE);

    const st = rig.world.store;
    const hi = st.index(host);
    const gi = rig.production.spawnUnit(
      rig.world.player(0 as PlayerId),
      rig.production.catalog.byKey('gi')!,
      st.posX[hi], st.posZ[hi], 0,
    );
    const ui = st.index(gi);
    st.orderKind[ui] = OrderKind.Enter;
    st.orderTarget[ui] = host as number;
    garrison.simTick({ dt: SIM_DT, tick: 1, time: SIM_DT, rng: new Rng(1) });
    expect(garrison.occupantCount(host)).toBe(1);

    const out = makeRelocateReport();
    subjectFault(rig.world, rig.production, 0 as PlayerId, host, out);
    expect(out.ok).toBe(false);
    expect(out.fault).toBe(RelocateFault.Garrisoned);
    expect(out.reason).toMatch(/garrison/i);
  });
});

/* ==========================================================================
 * 3. WHERE IT MAY GO
 * ========================================================================== */

describe('evaluateRelocate', () => {
  it('exempts the structure\'s own ground, so a one-cell nudge is legal', () => {
    // THE case the `PlacementExempt` rectangle exists for. Every overlapping
    // cell is occupied by the very structure about to vacate it, so without the
    // exemption short moves are refused and only long ones work.
    const rig = makeRig();
    base(rig);
    const id = plant(rig, 'warFactory', 45, 40);
    const out = makeRelocateReport();
    evaluateRelocate(rig.world, rig.production, 0 as PlayerId, id, 46, 40, out);
    expect(out.ok, out.reason).toBe(true);
    // Staying exactly where it is, too — that is the degenerate overlap.
    evaluateRelocate(rig.world, rig.production, 0 as PlayerId, id, 45, 40, out);
    expect(out.ok, out.reason).toBe(true);
  });

  it('refuses ground another structure already owns', () => {
    const rig = makeRig();
    base(rig);
    const mover = plant(rig, 'powerPlant', 45, 40);
    plant(rig, 'barracks', 45, 45);
    const out = makeRelocateReport();
    evaluateRelocate(rig.world, rig.production, 0 as PlayerId, mover, 45, 45, out);
    expect(out.ok).toBe(false);
    expect(out.fault).toBe(RelocateFault.Destination);
    expect(out.reason).not.toBe('');
    // The destination is still reported, so the HUD can point at the cell the
    // player actually clicked rather than at the map origin.
    expect(out.cx).toBe(45);
    expect(out.cz).toBe(45);
  });

  it('refuses ground the terrain rejects', () => {
    const rig = makeRig();
    base(rig);
    const id = plant(rig, 'powerPlant', 45, 40);
    refuseBuildable(rig.world);
    const out = makeRelocateReport();
    evaluateRelocate(rig.world, rig.production, 0 as PlayerId, id, 50, 44, out);
    expect(out.ok).toBe(false);
    expect(out.fault).toBe(RelocateFault.Destination);
  });

  it('refuses a site outside the rest of the base\'s build radius', () => {
    const rig = makeRig();
    base(rig);
    const id = plant(rig, 'powerPlant', 45, 40);
    const out = makeRelocateReport();
    evaluateRelocate(rig.world, rig.production, 0 as PlayerId, id, 110, 110, out);
    expect(out.ok).toBe(false);
    expect(out.fault).toBe(RelocateFault.Destination);
  });

  it('does not let a structure walk across the map on its own build radius', () => {
    // Without the PendingDestroy self-mask, every structure projects an
    // adjacency radius around ITSELF, so a lone building could hop to the edge
    // of its own radius forever and the base-creep rule would stop existing.
    const rig = makeRig();
    const lone = plant(rig, 'powerPlant', 60, 60);
    const out = makeRelocateReport();
    evaluateRelocate(rig.world, rig.production, 0 as PlayerId, lone, 63, 60, out);
    expect(out.ok).toBe(false);
    expect(out.fault).toBe(RelocateFault.Destination);

    // Give it a neighbour and the same move becomes legal, which proves the
    // refusal above was the radius and not something incidental.
    plant(rig, 'conyard', 60, 66);
    evaluateRelocate(rig.world, rig.production, 0 as PlayerId, lone, 63, 60, out);
    expect(out.ok, out.reason).toBe(true);
  });

  it('reports the subject fault ahead of the destination fault', () => {
    // A player who clicks an illegal cell with a Construction Yard should hear
    // the interesting reason, not "cannot relocate here".
    const rig = makeRig();
    const yard = plant(rig, 'conyard', 40, 40);
    const out = makeRelocateReport();
    evaluateRelocate(rig.world, rig.production, 0 as PlayerId, yard, 120, 120, out);
    expect(out.fault).toBe(RelocateFault.PacksIntoVehicle);
  });
});

/* ==========================================================================
 * 4. THE MOVE ITSELF
 * ========================================================================== */

describe('a committed relocation', () => {
  it('charges the fee exactly once and lands the structure on the new site', () => {
    const rig = makeRig();
    base(rig);
    const id = plant(rig, 'powerPlant', 45, 40);
    const fee = feeFor(rig, 'powerPlant');
    const before = credits(rig);

    const moved = moveTo(rig, id, 45, 46);
    expect(moved).not.toBe(NONE);
    expect(credits(rig)).toBe(before - fee);
    expect(rig.relocate.counters.charged).toBe(fee);
    expect(rig.relocate.counters.moved).toBe(1);
    expect(rig.relocate.counters.refused).toBe(0);

    // The old entity is gone; the new one is finished and is the same content.
    expect(rig.world.store.index(id)).toBe(-1);
    const st = rig.world.store;
    const i = st.index(moved);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(contentKeyOf(rig.world, i)).toBe('powerPlant');
    expect(st.buildProgress[i]).toBeGreaterThanOrEqual(1);
    expect(st.flags[i] & EntityFlag.UnderConstruction).toBe(0);
    // Exactly one power plant exists. A move must never duplicate a building.
    let plants = 0;
    for (let a = 0; a < st.byKindCount[EntityKind.Building]; a++) {
      const k = st.byKind[EntityKind.Building][a];
      if ((st.flags[k] & EntityFlag.Alive) === 0) continue;
      if (contentKeyOf(rig.world, k) === 'powerPlant') plants++;
    }
    expect(plants).toBe(1);
  });

  it('charges once for two commits inside a single tick', () => {
    // A double-click that lands between two sim ticks must buy ONE move.
    const rig = makeRig();
    base(rig);
    const id = plant(rig, 'powerPlant', 45, 40);
    const fee = feeFor(rig, 'powerPlant');
    const before = credits(rig);

    expect(rig.relocate.commit(0 as PlayerId, id, 45, 46)).toBe(true);
    expect(rig.relocate.commit(0 as PlayerId, id, 45, 48)).toBe(false);
    step(rig, TRANSIT_TICKS + 90);

    expect(credits(rig)).toBe(before - fee);
    expect(rig.relocate.counters.moved).toBe(1);
  });

  it('takes the credits through the live economy when there is one', () => {
    const rig = makeRig();
    const economy = new Economy(rig.world, rig.channels);
    setActiveEconomy(economy);
    base(rig);
    const id = plant(rig, 'powerPlant', 45, 40);
    const fee = feeFor(rig, 'powerPlant');
    const before = credits(rig);

    expect(moveTo(rig, id, 45, 46)).not.toBe(NONE);
    expect(credits(rig)).toBe(before - fee);
    // Spending, not vanishing: it shows up on the scoreboard like every other
    // credit the player parts with.
    expect(rig.world.player(0 as PlayerId).stats.creditsSpent).toBeGreaterThanOrEqual(fee);
  });

  it('is nowhere at all while it is in transit', () => {
    const rig = makeRig();
    base(rig);
    const id = plant(rig, 'powerPlant', 45, 40);
    expect(rig.relocate.commit(0 as PlayerId, id, 45, 46)).toBe(true);
    step(rig, 2);

    expect(rig.world.store.index(id)).toBe(-1);
    expect(rig.relocate.inTransit(0 as PlayerId)).toBe(1);
    expect(rig.relocate.counters.active).toBe(1);
    // No prerequisite, no census entry, no structure.
    expect(rig.production.hasStructure(0 as PlayerId, 'powerPlant')).toBe(false);
  });

  it('refuses without charging when the destination is illegal', () => {
    const rig = makeRig();
    base(rig);
    const id = plant(rig, 'powerPlant', 45, 40);
    plant(rig, 'barracks', 45, 45);
    const before = credits(rig);

    expect(rig.relocate.commit(0 as PlayerId, id, 45, 45)).toBe(false);
    step(rig, 4);

    expect(credits(rig)).toBe(before);
    expect(rig.relocate.counters.charged).toBe(0);
    expect(rig.relocate.counters.moved).toBe(0);
    expect(rig.relocate.counters.refused).toBeGreaterThan(0);
    // Still standing, exactly where it was.
    expect(rig.world.store.index(id)).toBeGreaterThanOrEqual(0);
    expect(rig.eva).toContain(EvaLine.CannotDeployHere);
  });

  it('refuses without charging when the player cannot afford it', () => {
    const rig = makeRig();
    base(rig);
    const id = plant(rig, 'powerPlant', 45, 40);
    rig.world.player(0 as PlayerId).credits = feeFor(rig, 'powerPlant') - 1;

    expect(rig.relocate.commit(0 as PlayerId, id, 45, 46)).toBe(false);
    step(rig, 4);
    expect(credits(rig)).toBe(feeFor(rig, 'powerPlant') - 1);
    expect(rig.world.store.index(id)).toBeGreaterThanOrEqual(0);
  });

  it('never charges for a query, however many times the HUD asks', () => {
    // The HUD calls `inspect` every frame for the selected building. If asking
    // cost anything, holding a structure selected would drain the bank.
    const rig = makeRig();
    base(rig);
    const id = plant(rig, 'powerPlant', 45, 40);
    const before = credits(rig);
    for (let i = 0; i < 200; i++) {
      expect(rig.relocate.eligible(0 as PlayerId, id)).toBe(true);
      rig.relocate.inspect(0 as PlayerId, id);
      rig.relocate.costFor(id);
    }
    step(rig, 10);
    expect(credits(rig)).toBe(before);
    expect(rig.relocate.counters.charged).toBe(0);
  });

  it('goes home with the fee when the destination is gone for good', () => {
    // The structure is never simply lost. A player who pays to move a building
    // and is handed nothing has been robbed, however defensible the sequence.
    const rig = makeRig();
    base(rig);
    const id = plant(rig, 'powerPlant', 45, 40);
    const before = credits(rig);

    expect(rig.relocate.commit(0 as PlayerId, id, 45, 46)).toBe(true);
    step(rig, 2);
    // While it is in transit, wall the destination off for good.
    plant(rig, 'barracks', 45, 46);

    step(rig, TRANSIT_TICKS + RELOCATE.arrivalGraceTicks + 90);

    expect(rig.relocate.counters.returned).toBe(1);
    expect(rig.relocate.counters.moved).toBe(0);
    // The fee came back with it.
    expect(credits(rig)).toBe(before);
    expect(rig.relocate.counters.charged).toBe(0);
    // And the structure is standing on its original cells again.
    const home = findBuilding(rig, 'powerPlant');
    expect(home).not.toBe(NONE);
    const st = rig.world.store;
    const i = st.index(home);
    expect(Math.round(st.posX[i] / CELL - st.footprintW[i] * 0.5)).toBe(45);
    expect(Math.round(st.posZ[i] / CELL - st.footprintH[i] * 0.5)).toBe(40);
  });

  it('waits out a transient blocker rather than giving up on the first tick', () => {
    const rig = makeRig();
    base(rig);
    const id = plant(rig, 'powerPlant', 45, 40);
    expect(rig.relocate.commit(0 as PlayerId, id, 45, 46)).toBe(true);

    // A tank parks on the site mid-transit, then drives off inside the grace.
    const tank = rig.production.spawnUnit(
      rig.world.player(0 as PlayerId), rig.production.catalog.byKey('grizzly')!,
      (45 + 1) * CELL, (46 + 1) * CELL, 0,
    );
    step(rig, TRANSIT_TICKS + 10);
    expect(rig.relocate.counters.moved).toBe(0);

    const ti = rig.world.store.index(tank);
    rig.world.store.posX[ti] = 300;
    rig.world.store.posZ[ti] = 300;
    step(rig, 92);

    expect(rig.relocate.counters.moved).toBe(1);
    expect(rig.relocate.counters.returned).toBe(0);
  });
});

/* ==========================================================================
 * 5. WHAT SURVIVES THE MOVE
 * ========================================================================== */

describe('state carried across a relocation', () => {
  it('keeps the rally point', () => {
    const rig = makeRig();
    base(rig);
    const factory = plant(rig, 'warFactory', 45, 40);
    rig.production.setRally(0 as PlayerId, factory, 300, 220);
    step(rig, 2);

    const before = new Float32Array(2);
    expect(rig.production.rallyPoint(0 as PlayerId, factory, before)).toBe(true);

    const moved = moveTo(rig, factory, 45, 46);
    expect(moved).not.toBe(NONE);

    const after = new Float32Array(2);
    expect(rig.production.rallyPoint(0 as PlayerId, moved, after)).toBe(true);
    expect(after[0]).toBeCloseTo(before[0], 3);
    expect(after[1]).toBeCloseTo(before[1], 3);
    // ...and the dead id does not keep a stale flag behind it.
    expect(rig.production.rallyPoint(0 as PlayerId, factory, after)).toBe(false);
  });

  it('keeps the primary-factory flag', () => {
    const rig = makeRig();
    base(rig);
    const first = plant(rig, 'warFactory', 45, 40);
    plant(rig, 'warFactory', 45, 46);
    rig.production.setPrimary(0 as PlayerId, first);
    step(rig, 2);
    expect(rig.world.store.flags[rig.world.store.index(first)] & EntityFlag.PrimaryFactory)
      .not.toBe(0);

    const moved = moveTo(rig, first, 51, 40);
    expect(moved).not.toBe(NONE);
    expect(rig.world.store.flags[rig.world.store.index(moved)] & EntityFlag.PrimaryFactory)
      .not.toBe(0);
    expect(rig.production.spawnFactory(0 as PlayerId, BuildTab.Vehicles)).toBe(moved);
  });

  it('keeps the damage, so this is not the cheapest repair in the game', () => {
    const rig = makeRig();
    base(rig);
    const id = plant(rig, 'powerPlant', 45, 40);
    const st = rig.world.store;
    const i = st.index(id);
    st.hp[i] = st.maxHp[i] * 0.4;
    const frac = st.hp[i] / st.maxHp[i];

    const moved = moveTo(rig, id, 45, 46);
    expect(moved).not.toBe(NONE);
    const j = st.index(moved);
    expect(st.hp[j] / st.maxHp[j]).toBeCloseTo(frac, 2);
  });

  it('keeps veterancy', () => {
    const rig = makeRig();
    base(rig);
    const id = plant(rig, 'warFactory', 45, 40);
    const st = rig.world.store;
    st.flags[st.index(id)] |= EntityFlag.Veteran1;

    const moved = moveTo(rig, id, 45, 46);
    expect(moved).not.toBe(NONE);
    expect(st.flags[st.index(moved)] & EntityFlag.Veteran1).not.toBe(0);
  });

  it('re-arms the repair wrench once the structure has finished rising', () => {
    // `RepairSell.setRepairing` refuses anything UnderConstruction, so arming
    // it on arrival would silently do nothing. It has to wait for the rise.
    const rig = makeRig();
    const repair = new RepairSellService(rig.world, rig.channels);
    setRepairSellService(repair);
    base(rig);
    const id = plant(rig, 'powerPlant', 45, 40);
    const st = rig.world.store;
    st.hp[st.index(id)] = st.maxHp[st.index(id)] * 0.5;
    expect(repair.setRepairing(0 as PlayerId, id, true)).toBe(true);

    const moved = moveTo(rig, id, 45, 46);
    expect(moved).not.toBe(NONE);
    expect(repair.isRepairing(moved)).toBe(true);
  });

  it('holds the build queue rather than cancelling it while the factory is away', () => {
    // Moving your only War Factory has to COST something, and the cost is that
    // the queue stalls. What it must not do is throw the item away: the credits
    // already sunk into it belong to the player.
    const rig = makeRig();
    base(rig);
    const factory = plant(rig, 'warFactory', 45, 40);
    plant(rig, 'powerPlant', 45, 46);
    plant(rig, 'refinery', 34, 40);
    step(rig, 4);

    rig.production.enqueueByKey(0 as PlayerId, 'grizzly');
    step(rig, 20);
    const queue = rig.world.player(0 as PlayerId).queues[BuildTab.Vehicles as number];
    expect(queue.items.length).toBe(1);
    const progress = queue.items[0].progress;
    expect(progress).toBeGreaterThan(0);

    expect(rig.relocate.commit(0 as PlayerId, factory, 51, 40)).toBe(true);
    step(rig, TRANSIT_TICKS - 5);

    // Still queued, still holding the progress it had, and explicitly on hold
    // rather than quietly ticking on with no factory.
    expect(queue.items.length).toBe(1);
    expect(queue.items[0].progress).toBeCloseTo(progress, 5);
    expect(queue.items[0].onHold).toBe(true);
    expect(queue.factoryCount).toBe(0);

    step(rig, 120);
    expect(rig.relocate.counters.moved).toBe(1);
    expect(queue.factoryCount).toBe(1);
    step(rig, 40);
    expect(queue.items[0].progress).toBeGreaterThan(progress);
  });
});

/* ==========================================================================
 * 6. THE POWER GRID
 * ========================================================================== */

describe('the power grid across a relocation', () => {
  it('loses the supply in transit and gets exactly it back on arrival', () => {
    const rig = makeRig();
    base(rig);
    const id = plant(rig, 'powerPlant', 45, 40);
    plant(rig, 'barracks', 34, 40);
    step(rig, 2);

    rig.power.recompute();
    const p = rig.world.player(0 as PlayerId);
    const producedBefore = p.powerProduced;
    const consumedBefore = p.powerConsumed;
    expect(producedBefore).toBeGreaterThan(0);

    expect(rig.relocate.commit(0 as PlayerId, id, 45, 46)).toBe(true);
    step(rig, 4);
    rig.power.recompute();
    // A structure that is nowhere is correctly worth nothing: no supply, and
    // no draw either.
    expect(p.powerProduced).toBe(producedBefore - rig.production.catalog.byKey('powerPlant')!.power);

    step(rig, TRANSIT_TICKS + 90);
    rig.power.recompute();
    expect(p.powerProduced).toBe(producedBefore);
    expect(p.powerConsumed).toBe(consumedBefore);
  });

  it('supplies nothing while it is still rising at the far end', () => {
    const rig = makeRig();
    base(rig);
    const id = plant(rig, 'powerPlant', 45, 40);
    step(rig, 2);
    rig.power.recompute();
    const p = rig.world.player(0 as PlayerId);
    const full = p.powerProduced;

    expect(rig.relocate.commit(0 as PlayerId, id, 45, 46)).toBe(true);
    step(rig, TRANSIT_TICKS + 3);
    // It exists again but is UnderConstruction, and the grid only counts
    // finished structures.
    expect(findBuilding(rig, 'powerPlant')).not.toBe(NONE);
    rig.power.recompute();
    expect(p.powerProduced).toBeLessThan(full);

    step(rig, 90);
    rig.power.recompute();
    expect(p.powerProduced).toBe(full);
  });
});

/* ==========================================================================
 * 7. DETERMINISM
 * ========================================================================== */

describe('determinism', () => {
  it('moves on the identical tick to the identical cell under the same seed', () => {
    function run(): { tick: number; x: number; z: number; credits: number } {
      const rig = makeRig();
      base(rig);
      const id = plant(rig, 'powerPlant', 45, 40);
      rig.relocate.commit(0 as PlayerId, id, 45, 46);
      let landedTick = -1;
      for (let n = 0; n < TRANSIT_TICKS + 120; n++) {
        step(rig, 1);
        if (landedTick < 0 && rig.relocate.counters.moved === 1) landedTick = rig.tick;
      }
      const moved = findBuilding(rig, 'powerPlant');
      const st = rig.world.store;
      const i = st.index(moved);
      return { tick: landedTick, x: st.posX[i], z: st.posZ[i], credits: credits(rig) };
    }
    const a = run();
    const b = run();
    expect(a.tick).toBeGreaterThan(0);
    expect(b).toEqual(a);
  });

  it('counts transit in ticks, not in accumulated seconds', () => {
    const rig = makeRig();
    base(rig);
    const id = plant(rig, 'powerPlant', 45, 40);
    rig.relocate.commit(0 as PlayerId, id, 45, 46);

    // One tick to drain the request, then exactly TRANSIT_TICKS of transit.
    step(rig, TRANSIT_TICKS);
    expect(rig.relocate.counters.moved).toBe(0);
    step(rig, 1);
    expect(rig.relocate.counters.moved).toBe(1);
  });

  it('reads no wall clock and no RNG anywhere in the module', async () => {
    const src = await import('../src/sim/Relocate?raw').then((m) => m.default as string);
    const body = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(body).not.toMatch(/Math\.random/);
    expect(body).not.toMatch(/Date\.now/);
    expect(body).not.toMatch(/performance\.now/);
  });
});

/* ==========================================================================
 * 8. THE SERVICE'S OWN HOUSEKEEPING
 * ========================================================================== */

describe('RelocateService', () => {
  it('does nothing at all before production exists', () => {
    const world = new World();
    world.addPlayer(Faction.Allies, 'Commander', true, true);
    const channels = new Channels();
    setProduction(null);
    const service = new RelocateService(world, channels);
    expect(service.eligible(0 as PlayerId, NONE)).toBe(false);
    expect(service.commit(0 as PlayerId, NONE, 10, 10)).toBe(false);
    expect(service.costFor(NONE)).toBe(0);
    expect(() => service.tick({ dt: SIM_DT, tick: 1, time: SIM_DT, rng: new Rng(1) })).not.toThrow();
  });

  it('drops everything in flight on dispose', () => {
    const rig = makeRig();
    base(rig);
    const id = plant(rig, 'powerPlant', 45, 40);
    expect(rig.relocate.commit(0 as PlayerId, id, 45, 46)).toBe(true);
    step(rig, 2);
    expect(rig.relocate.counters.active).toBe(1);

    rig.relocate.dispose();
    step(rig, 4);
    expect(rig.relocate.counters.active).toBe(0);
    expect(rig.relocate.stats()).toMatch(/relocate:/);
  });

  it('refuses a structure that is mid-sale or mid-deploy', () => {
    const rig = makeRig();
    base(rig);
    const id = plant(rig, 'powerPlant', 45, 40);
    const st = rig.world.store;
    st.state[st.index(id)] = UnitState.Deploying;
    const out = makeRelocateReport();
    subjectFault(rig.world, rig.production, 0 as PlayerId, id, out);
    expect(out.fault).toBe(RelocateFault.Busy);

    st.state[st.index(id)] = UnitState.Selling;
    subjectFault(rig.world, rig.production, 0 as PlayerId, id, out);
    expect(out.fault).toBe(RelocateFault.Busy);
  });
});
