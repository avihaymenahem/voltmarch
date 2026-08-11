/**
 * ============================================================================
 * tests/naval-shore.spec.ts — A SHIP LEAVES THE YARD ONTO WATER, AND KNOWS IT
 * ============================================================================
 * Three defects that were one defect, found after the seas landed and left
 * deliberately for this file to close.
 *
 *   1. NO HULL EVER GOT THE NAVAL MOVE CLASS. `Locomotor` has no Naval member,
 *      so every warship in the game is `Locomotor.Hover` — and
 *      `ITerrain.isPassable(_, _, Hover)` is TRUE ON LAND, because hovercraft
 *      are amphibious and share the locomotor. So `findEgressSpot` accepted
 *      ring 0, the factory door, and a destroyer was launched onto the BEACH.
 *      `Movement.moveClassAt` then latched `MoveClass.Hover` off the cell it
 *      was standing in for the life of that slot.
 *
 *      IT STILL SAILED AND STILL FOUGHT, which is exactly why nobody caught it:
 *      Hover crosses water. What it never got was the naval turn model, the
 *      heel, the bob and the wake — the four things that make a ship read as a
 *      ship. The corroborating evidence was sitting in plain sight:
 *      `setMoveClass`, whose own docstring calls it "the only way to say
 *      NAVAL", had ZERO callers outside `tests/`.
 *
 *   2. NOTHING FORCED A NAVAL YARD ONTO THE COAST. Fixing (1) alone converts a
 *      working hovercraft factory into a permanently stalled production queue
 *      the moment a player founds a yard inland — paid for, `ready: true`,
 *      nothing ever comes out, no error. That is the `Locomotor.Air` failure of
 *      `tests/air-layer.spec.ts` verbatim, with a different noun. So the
 *      placement rule and the egress search are TWO STATEMENTS OF ONE FACT and
 *      §1 below asserts the arithmetic that keeps them consistent.
 *
 *   3. THE BEACH WAS NEVER BUILDABLE. `TERRAIN_SEA_BEACH_GRADE` was 0.26 while
 *      `buildGrid` demands a slope under `ROUGH_SLOPE * 0.62` — a grade of
 *      0.175. So the coastal cone failed the build test by 46% along every
 *      metre of every coastline, and a dock could only be founded where natural
 *      ground happened to be flat NEAR the water. §4 measures that on the two
 *      shipped sea maps through the real generator.
 *
 * The rig for §2 and §3 is a terrain double with a straight coast rather than a
 * generated map, because the question there is "does the production layer put a
 * hull on water" and a generated coastline would make the answer depend on a
 * seed. §4 is the opposite: it must run on the real generator or it measures
 * intent instead of ground.
 * ============================================================================
 */

import { describe, expect, it, beforeEach, beforeAll, afterAll } from 'vitest';
import * as THREE from 'three';

import { World } from '../src/core/world';
import { Channels } from '../src/core/events';
import { Rng } from '../src/core/math';
import {
  BuildTab, EntityFlag, EntityKind, Faction, Locomotor,
} from '../src/core/types';
import type { EntityId, ITerrain, PlayerId } from '../src/core/types';
import {
  CELL, MAP_CELLS, MAP_SIZE, PLACEMENT, PRODUCTION, ROUGH_SLOPE, SIM_DT,
  NAVAL_BUILDING_DIMENSIONS,
  TERRAIN_SEA_BEACH_GRADE, TERRAIN_SEA_BEACH_RUN, TERRAIN_SEA_BLUFF_GRADE,
} from '../src/core/config';

import { ProductionCatalog, ProductionService } from '../src/sim/Production';
import type { BuildEntry } from '../src/sim/Production';
import {
  PlacementFault, evaluatePlacement, makePlacementReport,
} from '../src/sim/Placement';
import { moveClassOf, resetMoveClasses } from '../src/sim/Movement';
import { MoveClass, FlowFieldCache } from '../src/sim/Flowfield';
import { invalidateNavalWater, mapSupportsNaval, surveyNavalWater } from '../src/sim/NavalWater';
import { resolveDefBinding, MAP_SEAS, SKIRMISH_START_OFFSETS } from '../src/game/Scenarios';
import { Terrain, setActiveTerrain } from '../src/world/Terrain';

/* ==========================================================================
 * 1. THE ARITHMETIC — the two halves of the rule cannot drift apart
 * ========================================================================== */

describe('the placement rule and the egress search are sized against each other', () => {
  it('gives egress enough rings to reach any water a legal site may rely on', () => {
    /*
     * THE FAILURE THIS PREVENTS IS SILENT AND PERMANENT. `evaluatePlacement`
     * accepts a Naval Yard when navigable water sits within
     * `shoreSearchCells` of its FOOTPRINT, in any direction.
     * `findEgressSpot` then spirals out from its DOOR. If the budget for the
     * second is smaller than the reach of the first, a perfectly legal site
     * produces a queue that never delivers.
     *
     * Worst case, in cells: the water is `shoreSearchCells` beyond the BACK
     * edge while the door is on the FRONT. From the door that is
     *
     *     (footprint depth / 2 + exit clearance)   the door's own standoff
     *   + (footprint depth / 2)                    back across the building
     *   + shoreSearchCells                         out to the water
     *
     * The two halves sum to one full footprint depth, so the bound is
     * `maxFootprintCells + ceil(exitClearance / CELL) + shoreSearchCells`.
     */
    const doorStandoff = Math.ceil(PRODUCTION.exitClearanceMetres / CELL);
    const worstCase = PLACEMENT.maxFootprintCells + doorStandoff + PRODUCTION.shoreSearchCells;
    expect(PRODUCTION.navalEgressRings,
      `a legal shore site can put water ${worstCase} cells from the door`)
      .toBeGreaterThanOrEqual(worstCase);
    // And it is a WIDER budget than the ground one, which is the whole reason
    // it is a separate number.
    expect(PRODUCTION.navalEgressRings).toBeGreaterThan(PRODUCTION.egressSearchRings);
  });

  it('demands more than a puddle', () => {
    // Before the seas landed, every shipped map carried 0.00%-0.16% water in
    // noise basins whose largest body was 14 cells. A one-cell test would have
    // called those a harbour.
    expect(PRODUCTION.shoreWaterCells).toBeGreaterThan(1);
  });
});

/* ==========================================================================
 * 2. THE RIG — a straight coast, hand-built
 * ========================================================================== */

/** Cell column the sea starts at. Everything at or past this is water. */
const SHORE_CX = 64;

/**
 * Terrain that answers the way `world/Terrain.ts` does on a map with a sea.
 *
 * `World`'s null object is `FlatTerrain`, which is dry everywhere and ignores
 * the locomotor — it cannot express the one property this whole file is about.
 * The two answers that matter:
 *
 *   `isPassable(_, _, Hover)`  TRUE ON WATER *AND* ON LAND. This is not a
 *                              simplification; it is the shipped rule
 *                              (`passGrid` sets `PASS_HOVER` on every non-cliff
 *                              cell) and it is the entire reason a warship used
 *                              to egress onto the beach.
 *   `isWater`                  the half-plane.
 */
function coastalTerrain(base: ITerrain): ITerrain {
  const wet = (cx: number): boolean => cx >= SHORE_CX;
  return {
    heightAt: (x, z) => base.heightAt(x, z),
    normalAt: (x, z, out) => base.normalAt(x, z, out),
    slopeAt: (x, z) => base.slopeAt(x, z),
    isPassable: (cx, cz, loco) => {
      if (loco === Locomotor.Air) return false;
      if (loco === Locomotor.Hover) return cx >= 0 && cz >= 0 && cx < MAP_CELLS && cz < MAP_CELLS;
      return !wet(cx) && base.isPassable(cx, cz, loco);
    },
    // Water is never buildable, exactly as `computeDerived` writes it.
    isBuildable: (cx, cz) => !wet(cx) && base.isBuildable(cx, cz),
    isOccupied: (cx, cz) => base.isOccupied(cx, cz),
    markOccupied: (cx, cz, w, h, id) => { base.markOccupied(cx, cz, w, h, id); },
    clearOccupied: (cx, cz, w, h) => { base.clearOccupied(cx, cz, w, h); },
    occupancyVersion: () => base.occupancyVersion(),
    isWater: (cx) => wet(cx),
    raycastGround: (ox, oy, oz, dx, dy, dz, out) =>
      base.raycastGround(ox, oy, oz, dx, dy, dz, out),
  };
}

interface Rig {
  world: World;
  service: ProductionService;
  catalog: ProductionCatalog;
  player: PlayerId;
  run(ticks: number): void;
  plant(key: string, cx: number, cz: number, extraFlags: number): void;
  hullsOf(entry: BuildEntry): EntityId[];
}

async function makeRig(coast = true): Promise<Rig> {
  resetMoveClasses();
  invalidateNavalWater();
  const world = new World();
  // `coast: false` leaves the null object, which is dry in every cell — the
  // landlocked battlefield, expressed as the absence of the double.
  if (coast) world.terrain = coastalTerrain(world.terrain);
  world.addPlayer(Faction.Allies, 'Commander', true, true);
  const channels = new Channels();
  const catalog = new ProductionCatalog(await resolveDefBinding());
  const service = new ProductionService(world, channels, catalog);
  const player = 0 as PlayerId;
  world.player(player).credits = 100_000;
  world.player(player).powerProduced = 500;

  const st = world.store;
  const plant = (key: string, cx: number, cz: number, extraFlags: number): void => {
    const e = catalog.byKey(key)!;
    const x = cx * CELL + e.footprintW * CELL * 0.5;
    const z = cz * CELL + e.footprintH * CELL * 0.5;
    const h = st.alloc(EntityKind.Building, e.defId, player, Faction.Allies, x, 0, z, 0);
    const i = st.index(h);
    st.flags[i] |= extraFlags | EntityFlag.BlocksNav;
    st.footprintW[i] = e.footprintW;
    st.footprintH[i] = e.footprintH;
    st.hp[i] = 1000; st.maxHp[i] = 1000;
    st.powerDraw[i] = e.power;
    st.buildProgress[i] = 1;
    world.terrain.markOccupied(cx, cz, e.footprintW, e.footprintH, h);
  };

  const rng = new Rng(23);
  let tick = 0;
  const run = (n: number): void => {
    for (let k = 0; k < n; k++) {
      tick++;
      world.tick = tick;
      world.time = tick * SIM_DT;
      service.tick({ dt: SIM_DT, tick, time: world.time, rng });
      world.spatial.rebuild();
    }
  };

  const hullsOf = (entry: BuildEntry): EntityId[] => {
    const out: EntityId[] = [];
    for (let a = 0; a < st.aliveCount; a++) {
      const i = st.alive[a];
      if (st.kind[i] !== EntityKind.Vehicle) continue;
      if (st.defId[i] !== entry.defId) continue;
      out.push(st.handleOf(i));
    }
    return out;
  };

  return { world, service, catalog, player, run, plant, hullsOf };
}

/** The tech a Naval Yard needs, planted well clear of the waterline. */
function plantBase(rig: Rig, yardCx: number, yardCz: number): void {
  rig.plant('conyard', 40, 40, EntityFlag.IsBuilder | EntityFlag.IsFactory);
  rig.plant('powerPlant', 45, 40, 0);
  rig.plant('refinery', 49, 40, 0);
  rig.plant('navalYard', yardCx, yardCz, EntityFlag.IsFactory | EntityFlag.PrimaryFactory);
}

/* ==========================================================================
 * 3. THE LAUNCH
 * ========================================================================== */

describe('a warship leaves the yard onto water', () => {
  beforeEach(() => { resetMoveClasses(); });

  it('spawns a produced hull on a WATER cell, not on the beach', async () => {
    const rig = await makeRig();
    // Footprint ends one cell short of the waterline: the door is on dry land
    // and ring 0 is dry, which is precisely the spot the old code took.
    plantBase(rig, SHORE_CX - 4, 40);
    rig.run(2);

    const gunboat = rig.catalog.byKey('gunboat')!;
    expect(rig.service.availability(rig.player, gunboat.publicId).ok,
      'the rig cannot build a gunboat at all').toBe(true);
    rig.service.enqueue(rig.player, gunboat.publicId);
    rig.run(Math.ceil(gunboat.buildTime / SIM_DT) * 2 + 60);

    const hulls = rig.hullsOf(gunboat);
    expect(hulls.length, 'the gunboat never left the yard').toBe(1);

    const st = rig.world.store;
    const i = st.index(hulls[0]);
    const cx = Math.floor(st.posX[i] / CELL);
    const cz = Math.floor(st.posZ[i] / CELL);
    expect(rig.world.terrain.isWater(cx, cz),
      `hull launched onto land at cell ${cx},${cz} (shore is ${SHORE_CX})`).toBe(true);

    // And the queue is empty, so "it launched" cannot mean "it is still coming".
    expect(rig.world.player(rig.player).queues[BuildTab.Vehicles].items.length).toBe(0);
  });

  it('declares MoveClass.Naval rather than letting the water heuristic guess', async () => {
    /*
     * THE ASSERTION THIS FILE EXISTS FOR. `moveClassAt` derives a Hover hull's
     * class from the cell it is standing in the FIRST time anything asks, and
     * caches it against the slot generation. A ship that egressed onto sand
     * became `MoveClass.Hover` permanently — no naval turn model, no heel, no
     * bob, no wake — and every one of those is a visible property of the game
     * that simply never appeared.
     *
     * `Production.spawnUnit` now calls `setMoveClass` explicitly, so the answer
     * does not depend on where the spiral happened to land.
     */
    const rig = await makeRig();
    plantBase(rig, SHORE_CX - 4, 40);
    rig.run(2);

    const gunboat = rig.catalog.byKey('gunboat')!;
    rig.service.enqueue(rig.player, gunboat.publicId);
    rig.run(Math.ceil(gunboat.buildTime / SIM_DT) * 2 + 60);

    const hulls = rig.hullsOf(gunboat);
    expect(hulls.length).toBe(1);
    expect(moveClassOf(rig.world.store, hulls[0])).toBe(MoveClass.Naval);
  });

  it('launches even when the door faces INLAND, which is what §1 buys', async () => {
    /*
     * The yard is planted at the far edge of what `evaluatePlacement` accepts
     * and its door (local +Z at yaw 0) points AWAY from the water. Ring 0, the
     * whole first five rings, and every cell the ground budget could reach are
     * dry. Only `navalEgressRings` gets a hull out of this, and a player who
     * builds a legal yard is entitled to one.
     */
    const rig = await makeRig();
    const yard = rig.catalog.byKey('navalYard')!;
    // Origin such that the footprint's seaward CELL is exactly
    // `shoreSearchCells` short of the water — the last legal column there is.
    const originCx = SHORE_CX - PRODUCTION.shoreSearchCells - yard.footprintW + 1;
    plantBase(rig, originCx, 40);
    rig.run(2);

    // Prove the site really is legal by the same rule the ghost uses.
    const report = evaluatePlacement(
      rig.world, rig.player, yard, originCx, 40, makePlacementReport(),
      { cx: originCx, cz: 40, w: yard.footprintW, h: yard.footprintH },
    );
    expect(report.fault, 'the rig planted an ILLEGAL yard, so it proves nothing')
      .not.toBe(PlacementFault.NoShore);

    const gunboat = rig.catalog.byKey('gunboat')!;
    rig.service.enqueue(rig.player, gunboat.publicId);
    rig.run(Math.ceil(gunboat.buildTime / SIM_DT) * 2 + 60);

    const hulls = rig.hullsOf(gunboat);
    expect(hulls.length, 'a legal yard produced a stalled queue').toBe(1);
    const st = rig.world.store;
    const i = st.index(hulls[0]);
    expect(rig.world.terrain.isWater(Math.floor(st.posX[i] / CELL), Math.floor(st.posZ[i] / CELL)))
      .toBe(true);
  });

  it('still puts the AMPHIBIOUS transport down on land', async () => {
    /*
     * The counterweight, and the reason `naval` is a per-hull flag rather than
     * "anything a naval yard builds". A Hover Transport has five seats: an
     * amphibious lift that cannot beach is not a lift, and marking every hull
     * out of a shipyard water-only would have silently deleted every faction's
     * ability to move infantry over ground.
     */
    const rig = await makeRig();
    plantBase(rig, SHORE_CX - 4, 40);
    rig.run(2);

    const transport = rig.catalog.byKey('transport')!;
    expect(transport.naval, 'the transport must NOT be a warship').toBe(false);
    rig.service.enqueue(rig.player, transport.publicId);
    rig.run(Math.ceil(transport.buildTime / SIM_DT) * 2 + 60);

    const hulls = rig.hullsOf(transport);
    expect(hulls.length, 'the transport never left the yard').toBe(1);
    const st = rig.world.store;
    const i = st.index(hulls[0]);
    const cx = Math.floor(st.posX[i] / CELL);
    expect(rig.world.terrain.isWater(cx, Math.floor(st.posZ[i] / CELL)),
      'the transport was launched onto water and can no longer beach').toBe(false);
    expect(moveClassOf(st, hulls[0])).toBe(MoveClass.Hover);
  });

  it('marks exactly the gunned hulls as warships', () => {
    // Stated as a roster so a new ship cannot be added without a decision being
    // made about it. The rule is `passengers > 0` means amphibious lift.
    const catalog = new ProductionCatalog({ tables: null, unitId: {}, buildingId: {} });
    const naval = catalog.entries.filter((e) => e.naval).map((e) => e.key).sort();
    expect(naval).toEqual([
      'destroyer', 'dreadnought', 'gunboat', 'mrdCorvette', 'mrdMonitor',
      'rclHulk', 'submarine',
    ]);
    const shore = catalog.entries.filter((e) => e.needsShore).map((e) => e.key).sort();
    expect(shore).toEqual(['mrdSlipway', 'navalYard', 'rclDrydock', 'subPen']);
  });
});

/* ==========================================================================
 * 4. THE PLACEMENT RULE
 * ========================================================================== */

describe('a naval yard must be founded on the coast', () => {
  it('refuses an inland site and names the reason', async () => {
    const rig = await makeRig();
    plantBase(rig, SHORE_CX - 4, 40);
    rig.run(2);

    const yard = rig.catalog.byKey('navalYard')!;
    const report = makePlacementReport();
    // Deep inland, next to the conyard so the build radius is not the refusal.
    evaluatePlacement(rig.world, rig.player, yard, 44, 44, report);
    expect(report.ok).toBe(false);
    expect(report.fault).toBe(PlacementFault.NoShore);
    expect(report.reason).toBe('Must be founded on the coast');
  });

  it('accepts a site beside the water', async () => {
    const rig = await makeRig();
    // Conyard next to the shore so the site is inside the build radius.
    rig.plant('conyard', SHORE_CX - 8, 40, EntityFlag.IsBuilder | EntityFlag.IsFactory);
    rig.plant('powerPlant', SHORE_CX - 12, 40, 0);
    rig.plant('refinery', SHORE_CX - 16, 40, 0);
    rig.run(2);

    const yard = rig.catalog.byKey('navalYard')!;
    const report = makePlacementReport();
    evaluatePlacement(rig.world, rig.player, yard, SHORE_CX - 4, 44, report);
    expect(report.fault, report.reason).toBe(PlacementFault.None);
    expect(report.ok).toBe(true);
  });

  it('does not impose the rule on anything else', async () => {
    const rig = await makeRig();
    plantBase(rig, SHORE_CX - 4, 40);
    rig.run(2);

    const power = rig.catalog.byKey('powerPlant')!;
    expect(power.needsShore).toBe(false);
    const report = makePlacementReport();
    evaluatePlacement(rig.world, rig.player, power, 44, 44, report);
    expect(report.ok, report.reason).toBe(true);
  });

  it('says something DIFFERENT when the battlefield has no sea at all', async () => {
    /*
     * "Must be founded on the coast" is advice on a map with a coast and a
     * wild goose chase on one without. A refusal a player cannot act on has to
     * say that it cannot be acted on — the lesson of the locked cameo that
     * would not name its mission, and of the garrison that refused without a
     * reason.
     */
    const rig = await makeRig(false);   // FlatTerrain: dry in every cell.
    rig.plant('conyard', 40, 40, EntityFlag.IsBuilder | EntityFlag.IsFactory);
    rig.plant('powerPlant', 45, 40, 0);
    rig.run(2);
    expect(mapSupportsNaval(rig.world.terrain), 'a dry map claims to support a navy')
      .toBe(false);

    const yard = rig.catalog.byKey('navalYard')!;
    const report = makePlacementReport();
    // Clear of both footprints and well inside the yard's build radius, so
    // neither of those is what refuses it.
    evaluatePlacement(rig.world, rig.player, yard, 46, 45, report);
    expect(report.fault).toBe(PlacementFault.NoShore);
    expect(report.reason).toBe('No navigable water on this battlefield');
    expect(report.reason).not.toBe('Must be founded on the coast');
  });
});

/* ==========================================================================
 * 5. THE BEACH, MEASURED ON THE REAL GENERATOR
 * ========================================================================== */

const SEA_MAPS = [
  { id: 'contested-strait', preset: 'coast', biome: 'temperate', mapSeed: 0x0cea11 },
  { id: 'coral-shore', preset: 'tropical', biome: 'temperate', mapSeed: 0xc0aa11 },
] as const;

/** Two of the four dry battlefields, for the other side of the predicate. */
const DRY_MAPS = [
  { id: 'temperate-valley', biome: 'temperate', mapSeed: 0x7e44a1 },
  { id: 'airbase-flats', biome: 'desert', mapSeed: 0x3ba9f1 },
] as const;

/** Exactly what `terrain-plan.plannedTerrainInput` hands the generator. */
function requestedStarts(): { x: number; z: number }[] {
  return [
    { x: MAP_SIZE * 0.5, z: MAP_SIZE * 0.5 },
    ...SKIRMISH_START_OFFSETS.map((o) => ({ x: MAP_SIZE * 0.5 + o.dx, z: MAP_SIZE * 0.5 + o.dz })),
  ];
}

interface CoastFixture {
  terrain: Terrain;
  /** Buildable 3x3 dock sites able to reach open water. */
  sites: number;
  /** Dry cells within `TERRAIN_SEA_BEACH_RUN` of the waterline. */
  coastal: number;
  /** How many of those are buildable. */
  coastalBuildable: number;
}

const coasts = new Map<string, CoastFixture>();
const dry = new Map<string, Terrain>();

beforeAll(() => {
  for (const m of SEA_MAPS) {
    const sea = MAP_SEAS[m.preset];
    const terrain = new Terrain({
      scene: new THREE.Scene(), seed: m.mapSeed, biome: m.biome as never,
      anisotropy: 1, starts: requestedStarts(), sea,
    });
    terrain.generate();
    setActiveTerrain(terrain);
    const nav = new FlowFieldCache(terrain);

    let coastal = 0;
    let coastalBuildable = 0;
    for (let cz = 0; cz < MAP_CELLS; cz++) {
      for (let cx = 0; cx < MAP_CELLS; cx++) {
        if (terrain.isWater(cx, cz)) continue;
        const x = (cx + 0.5) * CELL;
        const z = (cz + 0.5) * CELL;
        const d = (x - sea.x) * sea.normalX + (z - sea.z) * sea.normalZ;
        if (d > 0 || d < -TERRAIN_SEA_BEACH_RUN) continue;
        coastal++;
        if (terrain.isBuildable(cx, cz)) coastalBuildable++;
      }
    }

    // A dock site is a buildable 3x3 with navigable water inside the halo the
    // placement rule demands — i.e. exactly what a player may found.
    const w = NAVAL_BUILDING_DIMENSIONS.navalYard.w;
    const h = NAVAL_BUILDING_DIMENSIONS.navalYard.h;
    const r = PRODUCTION.shoreSearchCells;
    let sites = 0;
    for (let cz = 0; cz + h < MAP_CELLS; cz++) {
      for (let cx = 0; cx + w < MAP_CELLS; cx++) {
        let ok = true;
        for (let dz = 0; ok && dz < h; dz++) {
          for (let dx = 0; dx < w; dx++) {
            if (!terrain.isBuildable(cx + dx, cz + dz)) { ok = false; break; }
          }
        }
        if (!ok) continue;
        let wet = 0;
        for (let z = cz - r; wet < PRODUCTION.shoreWaterCells && z < cz + h + r; z++) {
          for (let x = cx - r; x < cx + w + r; x++) {
            if (x < 0 || z < 0 || x >= MAP_CELLS || z >= MAP_CELLS) continue;
            if (nav.isPassableClass(x, z, MoveClass.Naval)) wet++;
          }
        }
        if (wet >= PRODUCTION.shoreWaterCells) sites++;
      }
    }
    setActiveTerrain(null);
    coasts.set(m.id, { terrain, sites, coastal, coastalBuildable });
  }
  for (const m of DRY_MAPS) {
    const terrain = new Terrain({
      scene: new THREE.Scene(), seed: m.mapSeed, biome: m.biome as never,
      anisotropy: 1, starts: requestedStarts(), sea: null,
    });
    terrain.generate();
    dry.set(m.id, terrain);
  }
}, 180_000);

afterAll(() => {
  setActiveTerrain(null);
  coasts.clear();
  dry.clear();
  invalidateNavalWater();
});

/* --------------------------------------------------------------------------
 * 5a. THE SHARED PREDICATE
 *
 * `mapSupportsNaval` is meant to be the ONE definition of "this battlefield has
 * a sea" — the placement rule's refusal wording, the sidebar gate that hides
 * naval rows on a dry map, and the AI's opening all have to agree, because a
 * player offered a Naval Yard by the sidebar and refused by the rule is a
 * contradiction with no error message. This section is the evidence that the
 * one definition separates the six shipped battlefields cleanly.
 * ------------------------------------------------------------------------ */

describe('one definition of "this battlefield has a sea"', () => {
  for (const m of SEA_MAPS) {
    it(`${m.id}: supports a navy`, () => {
      invalidateNavalWater();
      const survey = surveyNavalWater(coasts.get(m.id)!.terrain);
      // Measured: contested-strait 3622, coral-shore 3952 — the same quantity
      // `tests/naval-maps.spec.ts` scores these maps on.
      expect(survey.largest, `${m.id}: largest navigable body`).toBeGreaterThan(2000);
      expect(survey.navalViable).toBe(true);
    });
  }

  for (const m of DRY_MAPS) {
    it(`${m.id}: does not, and it is not close`, () => {
      invalidateNavalWater();
      const survey = surveyNavalWater(dry.get(m.id)!);
      // Measured before the seas landed and unchanged since: the largest single
      // body on any landlocked map is 14 cells of noise-basin puddle. This is
      // the assertion that stops "is there any water" from ever being the test.
      expect(survey.largest, `${m.id}: largest navigable body`).toBeLessThan(60);
      expect(survey.navalViable).toBe(false);
    });
  }

  it('re-surveys when the SAME terrain object is regenerated', () => {
    /*
     * The one hazard the memo has to survive. `Terrain.setSea` and
     * `Terrain.setBiome` rebuild the heightfield IN PLACE, so caching on object
     * identity alone would answer "no sea" for the rest of the match on a map
     * that had just grown one — and nothing on the player's side could
     * contradict it.
     */
    invalidateNavalWater();
    const t = new Terrain({
      scene: new THREE.Scene(), seed: 0x0cea11, biome: 'temperate',
      anisotropy: 1, starts: requestedStarts(), sea: null,
    });
    t.generate();
    expect(mapSupportsNaval(t), 'landlocked to begin with').toBe(false);
    t.setSea(MAP_SEAS.coast);
    expect(mapSupportsNaval(t), 'the memo went stale across setSea').toBe(true);
  }, 60_000);
});

describe('the beach is ground a dock can stand on', () => {
  it('cuts the beach cone under the BUILDABLE slope, not merely under rough', () => {
    /*
     * THE ARITHMETIC THE OLD NUMBER GOT WRONG, stated once so it cannot rot
     * again. `computeDerived` writes `buildGrid` at
     * `maxSlope < ROUGH_SLOPE * 0.62`. The old 0.26 was justified against
     * `tan(ROUGH_SLOPE)` — the ROUGH threshold, which is 1.6x looser — so the
     * beach passed the test nobody was asking and failed the one that decides
     * whether a Naval Yard has anywhere to stand.
     */
    const buildableSlope = ROUGH_SLOPE * 0.62;
    expect(Math.atan(TERRAIN_SEA_BEACH_GRADE)).toBeLessThan(buildableSlope);
    // And the bluff behind it is deliberately steeper than the old single cone:
    // a ceiling that climbs faster clamps LESS ground, so the landform survives.
    expect(TERRAIN_SEA_BLUFF_GRADE).toBeGreaterThan(TERRAIN_SEA_BEACH_GRADE);
    expect(Math.atan(TERRAIN_SEA_BLUFF_GRADE)).toBeGreaterThan(ROUGH_SLOPE);
  });

  for (const m of SEA_MAPS) {
    it(`${m.id}: most of the coastal strip is buildable`, () => {
      const f = coasts.get(m.id)!;
      const frac = f.coastalBuildable / f.coastal;
      // MEASURED, before -> after: contested-strait 16.4% -> 57.4%,
      // coral-shore 10.3% -> 54.0%. The floor is under both so a seed re-roll
      // does not fail this for a rounding change, and it is far above the
      // number this replaced.
      expect(frac, `${m.id}: ${f.coastalBuildable}/${f.coastal} coastal cells buildable`)
        .toBeGreaterThan(0.40);
    });

    it(`${m.id}: has somewhere to put a dock, in quantity`, () => {
      const f = coasts.get(m.id)!;
      /*
       * MEASURED with the SHORE RULE's own halo, which is tighter than the one
       * `tests/naval-maps.spec.ts` counts with — that file asks "can the old
       * egress spiral reach the main sea from here", this one asks the question
       * `evaluatePlacement` actually asks. The two numbers differ on purpose.
       *
       * Before -> after: contested-strait 17 -> 237, coral-shore 0 -> 319.
       *
       * THAT ZERO IS THE WHOLE ARGUMENT FOR DOING ALL THREE FIXES TOGETHER.
       * With the old 0.26 beach, the shore rule on its own would have made a
       * Naval Yard unbuildable on Coral Shore — a map whose entire identity is
       * its lagoon — and it would have done it silently, as a red ghost with a
       * correct-sounding reason.
       */
      expect(f.sites, `${m.id}: foundable dock sites`).toBeGreaterThan(120);
    });
  }
});
