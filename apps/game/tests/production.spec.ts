/// <reference types="vite/client" />
/**
 * Production, build queues and structure placement.
 *
 * Everything here runs headless. `PlacementController` is the only part that
 * touches THREE, and it is not constructed — the RULE (`evaluatePlacement`) is
 * a pure function over the World, which is exactly why it lives apart from the
 * ghost that draws it.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { World } from '../src/core/world';
import { Channels } from '../src/core/events';
import { Rng } from '../src/core/math';
import {
  BuildTab, EntityFlag, EntityKind, Faction, UnitState,
} from '../src/core/types';
import type { PlayerId, ProductionItem, SimContext } from '../src/core/types';
import {
  BUILD_RADIUS, CELL, CONSTRUCTION_RISE_SECONDS, MAX_QUEUE_DEPTH, PLACEMENT, PRODUCTION, SIM_DT,
} from '../src/core/config';

import { BuildQueues, HoldReason, factorySpeed } from '../src/sim/BuildQueue';
import type { QueueHooks, QueueItemInfo } from '../src/sim/BuildQueue';
import {
  BuildKind, ProductionCatalog, ProductionService, UNIT_PUBLIC_ID_BASE,
} from '../src/sim/Production';
import { evaluatePlacement, makePlacementReport, withinBuildRadius } from '../src/sim/Placement';
import { buildScenario, clearScenario, resolveDefBinding } from '../src/game/Scenarios';

const EMPTY_BINDING = { tables: null, unitId: {}, buildingId: {} };

/* ========================================================================== */
/* Fixtures                                                                   */
/* ========================================================================== */

function makeWorld(): { world: World; channels: Channels; service: ProductionService } {
  const world = new World();
  world.addPlayer(Faction.Allies, 'Commander', true, true);
  world.addPlayer(Faction.Soviets, 'Opponent', false, false);
  const channels = new Channels();
  const catalog = new ProductionCatalog(EMPTY_BINDING);
  const service = new ProductionService(world, channels, catalog);
  return { world, channels, service };
}

let simTick = 0;
function step(service: ProductionService, world: World, steps = 1): void {
  const rng = new Rng(7);
  for (let i = 0; i < steps; i++) {
    simTick++;
    world.tick = simTick;
    world.time = simTick * SIM_DT;
    const s: SimContext = { dt: SIM_DT, tick: simTick, time: world.time, rng };
    service.tick(s);
    // The real loop rebuilds the spatial index at Phase.SpatialRebuild; the
    // placement rule reads it, so a headless test has to do the same.
    world.spatial.rebuild();
  }
}

/** Plant a finished structure the way a scenario would. */
function place(service: ProductionService, world: World, key: string, cx: number, cz: number) {
  const entry = service.catalog.byKey(key)!;
  const p = world.player(0 as PlayerId);
  return service.spawnBuilding(p, entry, cx, cz, 1);
}

beforeEach(() => { simTick = 0; clearScenario(); });

/* ========================================================================== */

describe('ProductionCatalog', () => {
  it('resolves every authored entry against the fallback tables', () => {
    const catalog = new ProductionCatalog(EMPTY_BINDING);
    expect(catalog.count).toBeGreaterThan(20);
    // techMask is a Uint8Array(256) indexed by catalog index.
    expect(catalog.count).toBeLessThan(256);
    for (const e of catalog.entries) {
      expect(e.cost).toBeGreaterThan(0);
      expect(e.buildTime).toBeGreaterThan(0);
      if (e.kind === BuildKind.Building) {
        expect(e.footprintW).toBeGreaterThan(0);
        expect(e.footprintH).toBeGreaterThan(0);
      }
    }
  });

  it('gives each army its own roster and shares the neutral entries', () => {
    const catalog = new ProductionCatalog(EMPTY_BINDING);
    const alliedVehicles = catalog.roster(Faction.Allies, BuildTab.Vehicles).map((e) => e.key);
    const sovietVehicles = catalog.roster(Faction.Soviets, BuildTab.Vehicles).map((e) => e.key);
    expect(alliedVehicles).toContain('grizzly');
    expect(alliedVehicles).not.toContain('rhino');
    expect(sovietVehicles).toContain('rhino');
    expect(sovietVehicles).not.toContain('grizzly');
    // Both sides field a harvester, authored exactly once.
    expect(alliedVehicles).toContain('harvester');
    expect(sovietVehicles).toContain('harvester');
  });

  it('sorts each tab by sortOrder', () => {
    const catalog = new ProductionCatalog(EMPTY_BINDING);
    for (const tab of [BuildTab.Structures, BuildTab.Defense, BuildTab.Infantry, BuildTab.Vehicles]) {
      const roster = catalog.roster(Faction.Allies, tab);
      for (let i = 1; i < roster.length; i++) {
        expect(roster[i].sortOrder).toBeGreaterThanOrEqual(roster[i - 1].sortOrder);
      }
    }
  });

  it('excludes the Construction Yard from the buildable roster', () => {
    const catalog = new ProductionCatalog(EMPTY_BINDING);
    expect(catalog.byKey('conyard')!.buildable).toBe(false);
    expect(catalog.roster(Faction.Allies, BuildTab.Structures).map((e) => e.key))
      .not.toContain('conyard');
  });
});

describe('development Cheat Engine seam', () => {
  it('makes local production free and instant without mutating authored content', () => {
    const { world, service } = makeWorld();
    const player = world.player(0 as PlayerId);
    const rifleman = service.catalog.byKey('gi')!;
    expect(service.setDevCheats(player.id, {
      freeProduction: true,
      instantProduction: true,
      uncappedProduction: true,
    })).toBe(true);

    const info = service.info(player, rifleman.publicId, false)!;
    expect(info.cost).toBe(0);
    expect(info.buildTime).toBeLessThan(SIM_DT);
    expect(rifleman.cost).toBeGreaterThan(0);
  });

  it('bulk-spawns and retires a bounded test batch through the real unit initializer', () => {
    const { world, service } = makeWorld();
    const ids = service.devSpawnUnits({
      player: 0 as PlayerId,
      key: 'gi',
      count: 24,
      x: 100,
      z: 100,
    });
    expect(ids).toHaveLength(24);
    expect(world.store.aliveCount).toBe(24);
    expect(service.devDestroyUnits(ids)).toBe(24);
  });
});

/* ========================================================================== */

describe('BuildQueues', () => {
  /** A host with one buildable and an infinite bank, unless told otherwise. */
  function rig(credits = 100000) {
    const world = new World();
    world.addPlayer(Faction.Allies, 'P', true, true);
    const player = world.player(0 as PlayerId);
    player.credits = credits;
    const log: string[] = [];
    const hooks: QueueHooks = {
      info(_player, defId): QueueItemInfo | null {
        return defId === 1 ? { cost: 100, buildTime: 1 } : null;
      },
      charge(p, amount) {
        const paid = Math.min(amount, Math.max(0, p.credits));
        p.credits -= paid;
        return paid;
      },
      refund(p, amount) { p.credits += amount; },
      started(_p, _t, item) { log.push(`start:${item.defId}`); },
      progressed() { /* noisy */ },
      ready(_p, _t, item) { log.push(`ready:${item.defId}`); },
      cancelled(_p, _t, item, refunded) { log.push(`cancel:${item.defId}:${refunded}`); },
      holdChanged(_p, _t, reason) { log.push(`hold:${reason}`); },
    };
    const queues = new BuildQueues(hooks);
    player.queues[BuildTab.Vehicles].factoryCount = 1;
    return { world, player, queues, log };
  }

  it('drips credits and finishes in buildTime seconds at full power', () => {
    const { player, queues } = rig();
    queues.enqueue(player, BuildTab.Vehicles, 1, false, 1);
    const before = player.credits;
    let ticks = 0;
    while (!queues.head(player, BuildTab.Vehicles)!.ready && ticks < 200) {
      queues.advance(player, SIM_DT, false);
      ticks++;
    }
    // 1 second of build time at 30 Hz.
    expect(ticks).toBe(30);
    expect(before - player.credits).toBeCloseTo(100, 4);
    expect(queues.head(player, BuildTab.Vehicles)!.spent).toBeCloseTo(100, 4);
  });

  it('refunds exactly what was spent, never the full cost', () => {
    const { player, queues } = rig();
    queues.enqueue(player, BuildTab.Vehicles, 1, false, 1);
    for (let i = 0; i < 9; i++) queues.advance(player, SIM_DT, false);
    const spent = queues.head(player, BuildTab.Vehicles)!.spent;
    expect(spent).toBeGreaterThan(0);
    expect(spent).toBeLessThan(100);
    const before = player.credits;
    expect(queues.cancel(player, BuildTab.Vehicles, 1)).toBe(true);
    expect(player.credits - before).toBeCloseTo(spent, 5);
    expect(queues.depth(player, BuildTab.Vehicles)).toBe(0);
  });

  it('caps the queue at MAX_QUEUE_DEPTH', () => {
    const { player, queues } = rig();
    const added = queues.enqueue(player, BuildTab.Vehicles, 1, false, MAX_QUEUE_DEPTH + 5);
    expect(added).toBe(MAX_QUEUE_DEPTH);
    expect(queues.depth(player, BuildTab.Vehicles)).toBe(MAX_QUEUE_DEPTH);
  });

  it('can raise one player queue depth for a development load test', () => {
    const { player, queues } = rig();
    queues.setDepthLimit(player, 64);
    const added = queues.enqueue(player, BuildTab.Vehicles, 1, false, 64);
    expect(added).toBe(64);
    expect(queues.depth(player, BuildTab.Vehicles)).toBe(64);
  });

  it('crawls on partial payment and holds only after the grace window', () => {
    const { player, queues } = rig(2);
    queues.enqueue(player, BuildTab.Vehicles, 1, false, 1);
    // 100 credits over 1 s = 3.33/tick. Two credits buys most of one tick.
    queues.advance(player, SIM_DT, false);
    const item = queues.head(player, BuildTab.Vehicles)!;
    expect(item.progress).toBeGreaterThan(0);
    expect(item.progress).toBeLessThan(1 / 30);
    expect(queues.holdReason(player, BuildTab.Vehicles)).toBe(HoldReason.None);

    for (let i = 0; i < 30; i++) queues.advance(player, SIM_DT, false);
    expect(queues.holdReason(player, BuildTab.Vehicles)).toBe(HoldReason.Funds);
    expect(item.onHold).toBe(true);

    // Money arrives: it resumes itself without the player touching anything.
    player.credits = 1000;
    queues.advance(player, SIM_DT, false);
    expect(queues.holdReason(player, BuildTab.Vehicles)).toBe(HoldReason.None);
    expect(item.onHold).toBe(false);
  });

  it('freezes with no factory and never charges for it', () => {
    const { player, queues } = rig();
    queues.enqueue(player, BuildTab.Vehicles, 1, false, 1);
    player.queues[BuildTab.Vehicles].factoryCount = 0;
    const before = player.credits;
    for (let i = 0; i < 30; i++) queues.advance(player, SIM_DT, false);
    expect(player.credits).toBe(before);
    expect(queues.head(player, BuildTab.Vehicles)!.progress).toBe(0);
    expect(queues.holdReason(player, BuildTab.Vehicles)).toBe(HoldReason.NoFactory);
  });

  it('pauses and resumes only a player hold', () => {
    const { player, queues } = rig();
    queues.enqueue(player, BuildTab.Vehicles, 1, false, 1);
    queues.setPaused(player, BuildTab.Vehicles, true);
    const before = player.credits;
    for (let i = 0; i < 15; i++) queues.advance(player, SIM_DT, false);
    expect(player.credits).toBe(before);
    expect(queues.head(player, BuildTab.Vehicles)!.onHold).toBe(true);
    queues.setPaused(player, BuildTab.Vehicles, false);
    queues.advance(player, SIM_DT, false);
    expect(queues.head(player, BuildTab.Vehicles)!.progress).toBeGreaterThan(0);
  });

  it('starts the next item when the head is completed', () => {
    const { player, queues, log } = rig();
    queues.enqueue(player, BuildTab.Vehicles, 1, false, 3);
    expect(log.filter((l) => l.startsWith('start')).length).toBe(1);
    queues.completeHead(player, BuildTab.Vehicles);
    expect(log.filter((l) => l.startsWith('start')).length).toBe(2);
    expect(queues.depth(player, BuildTab.Vehicles)).toBe(2);
  });

  it('scales with factory count but never past the cap', () => {
    expect(factorySpeed(1)).toBe(1);
    expect(factorySpeed(2)).toBeCloseTo(1.35, 5);
    expect(factorySpeed(20)).toBe(2.0);
  });
});

/* ========================================================================== */

describe('placement rule', () => {
  it('refuses everything outside a build radius', () => {
    const { world, service } = makeWorld();
    const report = makePlacementReport();
    const entry = service.catalog.byKey('powerPlant')!;
    // No structures at all: nothing anywhere is legal.
    expect(evaluatePlacement(world, 0 as PlayerId, entry, 40, 40, report).ok).toBe(false);
    expect(report.inRadius).toBe(false);

    place(service, world, 'conyard', 40, 40);
    step(service, world, 1);
    expect(evaluatePlacement(world, 0 as PlayerId, entry, 45, 40, report).ok).toBe(true);
    // BUILD_RADIUS is 56 m = 14 cells; 30 cells away is well outside it.
    expect(evaluatePlacement(world, 0 as PlayerId, entry, 75, 40, report).ok).toBe(false);
  });

  it('marks the exact cells an existing structure occupies', () => {
    const { world, service } = makeWorld();
    place(service, world, 'conyard', 40, 40);
    step(service, world, 1);
    const report = makePlacementReport();
    const entry = service.catalog.byKey('powerPlant')!; // 2x2

    // Overlapping the yard's south-west corner by one cell.
    evaluatePlacement(world, 0 as PlayerId, entry, 39, 39, report);
    expect(report.ok).toBe(false);
    expect(report.blocked).toBe(1);
    expect(report.cells[3]).toBe(0); // the (1,1) cell is the yard's (40,40)
    expect(report.cells[0]).toBe(1);
  });

  it('refuses a site with a unit standing on it', () => {
    const { world, service } = makeWorld();
    place(service, world, 'conyard', 40, 40);
    const p = world.player(0 as PlayerId);
    const entry = service.catalog.byKey('powerPlant')!;
    const grizzly = service.catalog.byKey('grizzly')!;
    step(service, world, 1);

    const report = makePlacementReport();
    expect(evaluatePlacement(world, 0 as PlayerId, entry, 44, 40, report).ok).toBe(true);

    service.spawnUnit(p, grizzly, 45 * CELL, 40.5 * CELL, 0);
    world.spatial.rebuild();
    expect(evaluatePlacement(world, 0 as PlayerId, entry, 44, 40, report).ok).toBe(false);
    expect(report.blocked).toBeGreaterThan(0);
    expect(report.reason).not.toBe('');
  });

  it('projects a big radius from a yard and a small one from anything else', () => {
    const { world, service } = makeWorld();
    place(service, world, 'powerPlant', 40, 40);
    step(service, world, 1);
    const cx = (41) * CELL;
    const cz = (41) * CELL;
    expect(withinBuildRadius(world, 0 as PlayerId, cx, cz)).toBe(true);
    // Just past the adjacency radius, well inside BUILD_RADIUS.
    const far = cx + PLACEMENT.adjacencyRadius + 12;
    expect(withinBuildRadius(world, 0 as PlayerId, far, cz)).toBe(false);
    place(service, world, 'conyard', 40, 40 + 8);
    step(service, world, 1);
    expect(BUILD_RADIUS).toBeGreaterThan(PLACEMENT.adjacencyRadius);
  });
});

/* ========================================================================== */

describe('ProductionService — the whole loop', () => {
  it('unlocks the tech tree one structure at a time', () => {
    const { world, service } = makeWorld();
    const p = 0 as PlayerId;
    step(service, world, 1);
    // Nothing at all: no Construction Yard, so not even a power plant.
    expect(service.availability(p, service.catalog.byKey('powerPlant')!.index).ok).toBe(false);

    place(service, world, 'conyard', 40, 40);
    step(service, world, 1);
    expect(service.availability(p, service.catalog.byKey('powerPlant')!.index).ok).toBe(true);
    const refinery = service.availability(p, service.catalog.byKey('refinery')!.index);
    expect(refinery.ok).toBe(false);
    expect(refinery.reason).toContain('Power Plant');

    place(service, world, 'powerPlant', 44, 40);
    step(service, world, 1);
    expect(service.availability(p, service.catalog.byKey('refinery')!.index).ok).toBe(true);
    // Vehicles need a War Factory in the world, not just the tech for one.
    expect(service.availability(p, service.catalog.byKey('grizzly')!.index).ok).toBe(false);
  });

  it('writes techMask and announces new options exactly once', () => {
    const { world, channels, service } = makeWorld();
    let techChanges = 0;
    channels.events.on('tech:changed', () => { techChanges++; });
    place(service, world, 'conyard', 40, 40);
    step(service, world, 1);
    expect(techChanges).toBe(1);
    const player = world.player(0 as PlayerId);
    const powerPlant = service.catalog.byKey('powerPlant')!;
    expect(player.techMask[powerPlant.index]).toBe(1);
    // Static world: no further announcements.
    step(service, world, 10);
    expect(techChanges).toBe(1);
  });

  it('builds a structure, hands it to placement, plants it and raises it', () => {
    const { world, channels, service } = makeWorld();
    const p = 0 as PlayerId;
    const player = world.player(p);
    player.credits = 10000;
    place(service, world, 'conyard', 40, 40);
    step(service, world, 1);

    const powerPlant = service.catalog.byKey('powerPlant')!;
    let readyEvents = 0;
    channels.events.on('production:ready', () => { readyEvents++; });
    let placedEvents = 0;
    channels.events.on('building:placed', () => { placedEvents++; });
    let completedEvents = 0;
    channels.events.on('building:completed', () => { completedEvents++; });

    service.enqueue(p, powerPlant.index);
    step(service, world, Math.ceil(powerPlant.buildTime / SIM_DT) + 4);

    expect(readyEvents).toBe(1);
    expect(service.pendingStructure(p)!.key).toBe('powerPlant');
    expect(player.credits).toBeCloseTo(10000 - powerPlant.cost, 2);

    service.placeBuilding(p, powerPlant.index, 45, 41);
    step(service, world, 1);
    expect(placedEvents).toBe(1);
    expect(service.pendingStructure(p)).toBe(null);

    // Planted, occupying the grid, rising.
    expect(world.terrain.isOccupied(45, 41)).toBe(true);
    const store = world.store;
    const list = store.byKind[EntityKind.Building];
    let rising = -1;
    for (let i = 0; i < store.byKindCount[EntityKind.Building]; i++) {
      if ((store.flags[list[i]] & EntityFlag.UnderConstruction) !== 0) rising = list[i];
    }
    expect(rising).toBeGreaterThanOrEqual(0);
    expect(store.buildProgress[rising]).toBeLessThan(1);
    expect(store.state[rising]).toBe(UnitState.UnderConstruction);
    expect(store.hp[rising]).toBeLessThan(store.maxHp[rising]);

    step(service, world, Math.ceil(CONSTRUCTION_RISE_SECONDS / SIM_DT) + 2);
    expect(store.buildProgress[rising]).toBe(1);
    expect(store.flags[rising] & EntityFlag.UnderConstruction).toBe(0);
    expect(store.hp[rising]).toBe(store.maxHp[rising]);
    expect(completedEvents).toBe(1);
    expect(player.powerProduced).toBeGreaterThan(0);
  });

  it('refuses an illegal site, keeps the structure ready and says why', () => {
    const { world, service } = makeWorld();
    const p = 0 as PlayerId;
    const player = world.player(p);
    player.credits = 10000;
    place(service, world, 'conyard', 40, 40);
    step(service, world, 1);

    const notices: string[] = [];
    service.onPlacement((n) => { notices.push(`${n.phase}:${n.reason}`); });

    const powerPlant = service.catalog.byKey('powerPlant')!;
    service.enqueue(p, powerPlant.index);
    step(service, world, Math.ceil(powerPlant.buildTime / SIM_DT) + 4);

    // Straight on top of the Construction Yard.
    service.placeBuilding(p, powerPlant.index, 40, 40);
    step(service, world, 1);
    expect(notices.some((n) => n.startsWith('3'))).toBe(true); // Rejected
    expect(service.pendingStructure(p)!.key).toBe('powerPlant');

    // Somewhere legal: it lands.
    service.placeBuilding(p, powerPlant.index, 44, 44);
    step(service, world, 1);
    expect(service.pendingStructure(p)).toBe(null);
  });

  it('drives a finished vehicle out of the factory toward its rally point', () => {
    const { world, service } = makeWorld();
    const p = 0 as PlayerId;
    const player = world.player(p);
    player.credits = 20000;
    place(service, world, 'conyard', 40, 40);
    place(service, world, 'powerPlant', 44, 40);
    place(service, world, 'refinery', 36, 44);
    const factory = place(service, world, 'warFactory', 44, 44);
    step(service, world, 2);

    expect(service.spawnFactory(p, BuildTab.Vehicles)).toBe(factory);
    const rally = new Float32Array(2);
    expect(service.rallyPoint(p, factory, rally)).toBe(true);

    const grizzly = service.catalog.byKey('grizzly')!;
    expect(service.availability(p, grizzly.index).ok).toBe(true);
    const before = world.store.byKindCount[EntityKind.Vehicle];
    service.enqueue(p, grizzly.index);
    step(service, world, Math.ceil(grizzly.buildTime / SIM_DT) + 6);

    expect(world.store.byKindCount[EntityKind.Vehicle]).toBe(before + 1);
    const list = world.store.byKind[EntityKind.Vehicle];
    const tank = list[world.store.byKindCount[EntityKind.Vehicle] - 1];
    expect(world.store.state[tank]).toBe(UnitState.Moving);
    /*
     * NEAR THE FLAG, NOT ON IT — and the difference is the fix for
     * "they all spawn exactly at the same pixels".
     *
     * This asserted equality to three decimals, which was true because every
     * unit off the line was handed the IDENTICAL rally point. That is exactly
     * what made twenty riflemen settle inside a 3.1 m circle with the closest
     * pair interpenetrating at 0.2305 m against a 0.468 m hull sum. Each unit
     * now takes a slot on a packed lattice around the flag.
     *
     * The invariant that survives is the one this case was really about: the
     * unit is sent TO THE RALLY, not left where it was born and not sent
     * across the map. The bound is the outermost ring — two units of spacing,
     * diagonally — so it fails just as loudly if the dispersal ever runs away.
     */
    const spread = Math.max(
      PRODUCTION.rallyMinSpacing,
      world.store.radius[tank] * 2 + PRODUCTION.rallyGap,
    );
    const off = Math.hypot(world.store.orderX[tank] - rally[0], world.store.orderZ[tank] - rally[1]);
    expect(off, `sent ${off.toFixed(2)} m from the flag`).toBeLessThanOrEqual(Math.SQRT2 * 2 * spread + 1e-6);
    // And it is genuinely heading for the flag rather than standing still.
    const born = Math.hypot(world.store.orderX[tank] - world.store.posX[tank],
      world.store.orderZ[tank] - world.store.posZ[tank]);
    expect(born, 'ordered to where it already is').toBeGreaterThan(0);
    // It came out of the building, not inside it.
    expect(world.terrain.isOccupied(
      Math.floor(world.store.posX[tank] / CELL),
      Math.floor(world.store.posZ[tank] / CELL),
    )).toBe(false);
    // And the queue moved on.
    expect(world.player(p).queues[BuildTab.Vehicles].items.length).toBe(0);
  });

  it('honours a moved rally point for the whole life of the factory', () => {
    const { world, service } = makeWorld();
    const p = 0 as PlayerId;
    world.player(p).credits = 20000;
    place(service, world, 'conyard', 40, 40);
    place(service, world, 'powerPlant', 44, 40);
    place(service, world, 'refinery', 36, 44);
    const factory = place(service, world, 'warFactory', 44, 44);
    step(service, world, 2);

    service.setRally(p, factory, 200, 210);
    step(service, world, 1);
    const rally = new Float32Array(2);
    service.rallyPoint(p, factory, rally);
    expect(rally[0]).toBeCloseTo(200, 5);
    expect(rally[1]).toBeCloseTo(210, 5);
  });

  it('counts factories and speeds the queue up with a second one', () => {
    const { world, service } = makeWorld();
    const p = 0 as PlayerId;
    const player = world.player(p);
    place(service, world, 'conyard', 40, 40);
    place(service, world, 'powerPlant', 44, 40);
    place(service, world, 'barracks', 36, 40);
    step(service, world, 1);
    expect(player.queues[BuildTab.Infantry].factoryCount).toBe(1);
    place(service, world, 'barracks', 36, 44);
    step(service, world, 1);
    expect(player.queues[BuildTab.Infantry].factoryCount).toBe(2);
  });

  it('sells a structure for half of what it is worth so far', () => {
    const { world, channels, service } = makeWorld();
    const p = 0 as PlayerId;
    const player = world.player(p);
    place(service, world, 'conyard', 40, 40);
    const plant = place(service, world, 'powerPlant', 44, 40);
    step(service, world, 1);

    let sold = 0;
    channels.events.on('building:sold', (ev) => { sold = ev.refund; });
    const before = player.credits;
    service.sell(p, plant);
    step(service, world, 1);
    expect(sold).toBe(Math.round(service.catalog.byKey('powerPlant')!.cost * 0.5));
    expect(player.credits - before).toBe(sold);
    expect(world.store.isPendingDestroy(plant)).toBe(true);
    // The cells it sat on are free again.
    expect(world.terrain.isOccupied(44, 40)).toBe(false);
  });

  it('publishes a HUD snapshot with live cameo state', () => {
    const { world, service } = makeWorld();
    const p = 0 as PlayerId;
    world.player(p).credits = 10000;
    place(service, world, 'conyard', 40, 40);
    step(service, world, 1);

    const snap = service.snapshot;
    expect(snap.cameos[BuildTab.Structures].length).toBeGreaterThan(0);
    const cameo = snap.cameos[BuildTab.Structures]
      .find((c) => c.key === 'powerPlant')!;
    expect(cameo.available).toBe(true);
    expect(cameo.cost).toBeGreaterThan(0);
    expect(cameo.queued).toBe(0);

    service.enqueue(p, cameo.defId, 3);
    step(service, world, 6);
    expect(cameo.queued).toBe(3);
    expect(cameo.progress).toBeGreaterThan(0);
    expect(snap.creditsDisplay).toBeGreaterThan(0);

    service.cancel(p, cameo.defId);
    step(service, world, 1);
    expect(cameo.queued).toBe(2);
  });

  it('counts what the player OWNS onto the cameo — for units as well as buildings', async () => {
    // `HudCameo.owned` drives the sidebar's inventory badge. It shipped broken
    // for units and nobody could tell, because a wrong count renders as no
    // badge and no badge is also what "you own none" looks like.
    //
    // The cause: a unit's `entry.publicId` is `defId + UNIT_PUBLIC_ID_BASE`
    // (4096) so it cannot collide with the building sharing its def index,
    // while the owned census is bucketed by the RAW `store.defId`. Indexing a
    // 256-entry array by `publicId` therefore fell off the end every time and
    // the ternary quietly took its `: 0` branch. Buildings were fine — they are
    // unoffset — which is exactly why it looked like it worked.
    // MUST use the REAL def binding. The default rig builds its catalog from
    // EMPTY_BINDING, which leaves `entry.defId` at -1 for everything, so the
    // store records -1 for every unit and no census can distinguish them. A
    // version of this test on the default rig passes while proving nothing.
    const world = new World();
    world.addPlayer(Faction.Allies, 'Commander', true, true);
    world.addPlayer(Faction.Soviets, 'Opponent', false, false);
    const channels = new Channels();
    const service = new ProductionService(
      world, channels, new ProductionCatalog(await resolveDefBinding()),
    );

    const p = 0 as PlayerId;
    world.player(p).credits = 20000;
    place(service, world, 'conyard', 40, 40);
    place(service, world, 'barracks', 46, 40);
    step(service, world, 1);

    const gi = service.snapshot.cameos[BuildTab.Infantry].find((c) => c.key === 'gi');
    expect(gi, 'the infantry roster must contain a rifleman').toBeDefined();
    expect(gi!.owned, 'nothing built yet').toBe(0);
    // The two id spaces really are distinct, and conflating them is the bug.
    expect(gi!.defId).toBeGreaterThanOrEqual(UNIT_PUBLIC_ID_BASE);

    service.enqueue(p, gi!.defId, 2);
    step(service, world, 900);

    expect(gi!.owned, 'two riflemen were produced and must be counted').toBe(2);

    // The building branch is unoffset and must keep working.
    const barracks = service.snapshot.cameos[BuildTab.Structures]
      .find((c) => c.key === 'barracks');
    if (barracks !== undefined) expect(barracks.owned).toBeGreaterThan(0);
  });

  it('recognises a base the scenario built, not only one it built itself', () => {
    // The census identifies a structure three ways: our own stamp, the real def
    // table, then the scenario's published content key. Only the third one is
    // live today, and it is the one the `?shot=allied-base` frame depends on —
    // if it breaks, every cameo in the game greys out and nothing says why.
    const world = new World();
    world.addPlayer(Faction.Allies, 'Commander', true, true);
    world.addPlayer(Faction.Soviets, 'Opponent', false, false);
    const channels = new Channels();
    const service = new ProductionService(world, channels, new ProductionCatalog(EMPTY_BINDING));

    buildScenario(world, 'allied-base', 9);
    step(service, world, 2);

    const p = 0 as PlayerId;
    expect(service.hasStructure(p, 'conyard')).toBe(true);
    expect(service.hasStructure(p, 'powerPlant')).toBe(true);
    expect(world.player(p).queues[BuildTab.Structures].factoryCount).toBeGreaterThan(0);
    // And therefore the sidebar has something on it.
    const available = service.snapshot.cameos[BuildTab.Structures].filter((c) => c.available);
    expect(available.length).toBeGreaterThan(0);
    expect(available.map((c) => c.key)).toContain('powerPlant');
  });

  it('accepts a ready item staged by a scenario with a foreign defId', () => {
    const { world, service } = makeWorld();
    const p = 0 as PlayerId;
    place(service, world, 'conyard', 40, 40);
    step(service, world, 1);

    // Exactly what game/scenarios/Showcases.ts pushes for `?shot=placement`:
    // a finished structure with defId -1, because no def table exists.
    const item: ProductionItem = {
      defId: -1, isBuilding: true, progress: 1, spent: 2000,
      cost: 2000, ready: true, onHold: false,
    };
    const queue = world.player(p).queues[BuildTab.Structures];
    queue.items.length = 0;
    queue.items.push(item);
    queue.awaitingPlacement = true;

    // It must survive the tick rather than being cancelled as unknown content.
    step(service, world, 5);
    expect(queue.items.length).toBe(1);
    expect(queue.items[0].ready).toBe(true);
  });
});

/* ==========================================================================
 * A REFINERY SHIPS WITH A HARVESTER
 *
 * The blurb promised it in three factions' content and nothing implemented it,
 * which cost nothing while every match opened with a pre-built base whose
 * harvesters the scenario placed. Under the MCV opening it is the entire
 * economy: measured before the fix, three of the four factions' AIs stood next
 * to a finished refinery with no harvester and flatlined at 0-1600 credits for
 * the rest of the match.
 * ========================================================================== */

/** Every harvester-bearing structure, by faction. */
const REFINERIES: readonly [string, string, Faction][] = [
  ['refinery', 'harvester', Faction.Allies],
  ['refinery', 'harvester', Faction.Soviets],
  ['mrdCistern', 'mrdCollector', Faction.Meridian],
  ['rclSorter', 'rclScrapper', Faction.Reclaim],
];

describe('a refinery ships with a harvester', () => {
  it('names one on every faction\'s refinery, and nothing else', () => {
    const catalog = new ProductionCatalog(EMPTY_BINDING);
    const bundling = catalog.entries.filter((e) => e.shipsWith !== '');
    expect(bundling.map((e) => e.key).sort())
      .toEqual(['mrdCistern', 'rclSorter', 'refinery']);
    for (const e of bundling) {
      const unit = catalog.byKey(e.shipsWith);
      expect(unit, `${e.key} ships with "${e.shipsWith}"`).not.toBe(null);
      expect(unit!.kind).toBe(BuildKind.Unit);
    }
  });

  it('agrees with the blurb the player reads', () => {
    const catalog = new ProductionCatalog(EMPTY_BINDING);
    for (const e of catalog.entries) {
      if (!/Ships with one/i.test(e.blurb)) continue;
      expect(e.shipsWith, `"${e.key}" promises a unit it does not name`).not.toBe('');
    }
  });

  for (const [refKey, harvKey, faction] of REFINERIES) {
    it(`hands ${faction === Faction.Allies || faction === Faction.Soviets ? 'both classic armies' : harvKey} one, free, on completion`, () => {
      const world = new World();
      world.addPlayer(faction, 'Commander', true, true);
      const channels = new Channels();
      const catalog = new ProductionCatalog(EMPTY_BINDING);
      const service = new ProductionService(world, channels, catalog);
      const p = 0 as PlayerId;
      const player = world.player(p);
      player.credits = 20000;
      player.faction = faction;

      const yard = catalog.byKey(faction === Faction.Meridian ? 'mrdConclave'
        : faction === Faction.Reclaim ? 'rclFoundry' : 'conyard')!;
      service.spawnBuilding(player, yard, 40, 40, 1);
      step(service, world, 1);

      const before = player.credits;
      const refinery = catalog.byKey(refKey)!;
      // buildProgress < 1 so it goes through the real completion path, which is
      // where the delivery hangs.
      service.spawnBuilding(player, refinery, 50, 50, 0.5);
      step(service, world, Math.ceil(CONSTRUCTION_RISE_SECONDS / SIM_DT) + 4);

      const st = world.store;
      let found = 0;
      for (let a = 0; a < st.aliveCount; a++) {
        const i = st.alive[a];
        if (st.owner[i] !== (p as number)) continue;
        if (st.kind[i] === EntityKind.Building) continue;
        if (service.entryOf(st.handleOf(i))?.key === harvKey) found++;
      }
      expect(found, `${refKey} shipped a ${harvKey}`).toBe(1);
      // FREE. Not charged, not queued, not built.
      expect(player.credits).toBeCloseTo(before, 2);
      expect(world.player(p).queues[BuildTab.Vehicles].items.length).toBe(0);
    });
  }

  it('does not need a war factory — that is the whole point', () => {
    const { world, service } = makeWorld();
    const p = 0 as PlayerId;
    const player = world.player(p);
    place(service, world, 'conyard', 40, 40);
    step(service, world, 1);
    // The harvester is not buildable here: it wants a War Factory as well.
    expect(service.availability(p, service.catalog.byKey('harvester')!.index).ok).toBe(false);

    service.spawnBuilding(player, service.catalog.byKey('refinery')!, 50, 50, 0.5);
    step(service, world, Math.ceil(CONSTRUCTION_RISE_SECONDS / SIM_DT) + 4);

    const st = world.store;
    let harvesters = 0;
    for (let a = 0; a < st.aliveCount; a++) {
      const i = st.alive[a];
      if (st.kind[i] !== EntityKind.Building
        && service.entryOf(st.handleOf(i))?.key === 'harvester') harvesters++;
    }
    expect(harvesters).toBe(1);
  });

  it('leaves a structure that ships with nothing alone', () => {
    const { world, service } = makeWorld();
    const player = world.player(0 as PlayerId);
    place(service, world, 'conyard', 40, 40);
    step(service, world, 1);
    const before = world.store.aliveCount;
    service.spawnBuilding(player, service.catalog.byKey('powerPlant')!, 50, 50, 0.5);
    step(service, world, Math.ceil(CONSTRUCTION_RISE_SECONDS / SIM_DT) + 4);
    // The plant, and nothing riding along with it.
    expect(world.store.aliveCount).toBe(before + 1);
  });
});
