/**
 * ============================================================================
 * tests/ai-naval-yard.spec.ts — THE AI FOUNDS A DOCK, AND A HULL COMES OUT
 * ============================================================================
 * `Sunder Atoll` shipped with the AI's amphibious decision finally INVERTING —
 * two of four brains reporting "objective unreachable on land, the sea is the
 * only way" — and no landing ever happening. Measured over a 24 sim-minute
 * four-army match with real terrain, real production, real economy, real
 * harvesting, real transport and four real brains: `landings = 0` and
 * `navalYardCount = 0` for every brain. Three separate walls, each of which
 * alone is enough to produce that number:
 *
 *   1. THE DOCK WAS ANCHORED ON THE CONSTRUCTION YARD. `placeNext` carries
 *      role-specific anchors for Refinery, Defense and AntiAir and had none for
 *      `BuildRole.NavalYard`, so the one building in the game that MUST stand on
 *      a coast was hunted by a blind 16-ring spiral centred on the middle of the
 *      base. Sixteen rings is 64 m; on Sunder Atoll the buildable coast is
 *      61-79 m out. `shoreCx/shoreCz` — the beach `probeSea` already finds —
 *      were computed and read by nothing that places anything. §2.
 *
 *   2. THE BUILD RADIUS AND THE COAST DID NOT OVERLAP. Measured on that map
 *      through the real generator and the real placement rule: 532 sites are
 *      buildable ground beside navigable water, 400-470 sites per army are
 *      inside that army's build radius, and for three of four armies the
 *      INTERSECTION IS ZERO. No search can find a site that does not exist. The
 *      first answer was to make the base WALK to the water, which is what a
 *      human does; the real answer was that the human should not have had to
 *      either, and it is fixed in the MAP now — `islandSeats` seats each opening
 *      30 m along its own coast, and §4 measures that all four armies can found
 *      a dock without moving a building. §3 keeps the creep honest as the
 *      fallback it now is.
 *
 *   3. A HULL CAME OUT OF THE WAR FACTORY. All four docks declare
 *      `producesTabs: [V]`, the same tab the war factory declares, so
 *      `primaryFactory[V]` is whichever was founded first — always the war
 *      factory. `tryEgress` then looked for the hull's egress cell at the war
 *      factory's door, in the middle of the base, and a transport-sized hull is
 *      reliably `blockedByEntity` there. The finished ship sat at the head of the
 *      Vehicles queue with `ready: true` forever, taking every tank and harvester
 *      behind it down with it. §1.
 *
 * With all three closed, the same 24-minute match produces 3 transports and
 * TWELVE landings for the Reclamation brain, first at minute 8 and steadily
 * after.
 * ============================================================================
 */

import { describe, expect, it, beforeAll, afterAll, beforeEach } from 'vitest';
import * as THREE from 'three';

import { World } from '../src/core/world';
import { Channels } from '../src/core/events';
import { Rng } from '../src/core/math';
import {
  AI_SQUAD_MIN, BUILD_RADIUS, CELL, MAP_CELLS, SIM_DT,
} from '../src/core/config';
import {
  BuildTab, CommandKind, EntityFlag, EntityKind, Faction, Locomotor,
} from '../src/core/types';
import type { Command, EntityId, ITerrain, PlayerId, SimContext } from '../src/core/types';

import { Terrain, setActiveTerrain } from '../src/world/Terrain';
import { ProductionCatalog, ProductionService } from '../src/sim/Production';
import { evaluatePlacement, makePlacementReport } from '../src/sim/Placement';
import { resetMoveClasses } from '../src/sim/Movement';
import { FlowFieldCache, setActiveNav } from '../src/sim/Flowfield';
import { invalidateNavalWater } from '../src/sim/NavalWater';
import { AiBrain } from '../src/sim/AI';
import { AI_NAVAL, BuildCatalog, BuildRole } from '../src/sim/AIStrategy';
import type { DefLookup } from '../src/sim/AIStrategy';
import {
  ISLAND_SEAT_OFFSET, MAP_SEAS, SKIRMISH_ARMIES_MAX, buildScenario, clearScenario,
  resolveDefBinding, startPointsFor,
} from '../src/game/Scenarios';

/** Cell column the sea starts at. Everything at or past this is water. */
const SHORE_CX = 64;

/**
 * The same half-plane coast `tests/naval-shore.spec.ts` uses, and for the same
 * reason: the question here is "where does the AI aim", and a generated
 * coastline would make the answer depend on a seed.
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

/* ==========================================================================
 * 1. THE HULL COMES OUT OF THE DOCK
 * ========================================================================== */

describe('a hull launches from the dock, not from the war factory sharing its tab', () => {
  beforeEach(() => { resetMoveClasses(); invalidateNavalWater(); });

  interface Rig {
    world: World;
    service: ProductionService;
    catalog: ProductionCatalog;
    player: PlayerId;
    run(ticks: number): void;
    plant(key: string, cx: number, cz: number, extraFlags: number): EntityId;
  }

  async function makeRig(): Promise<Rig> {
    const world = new World();
    world.terrain = coastalTerrain(world.terrain);
    world.addPlayer(Faction.Allies, 'Commander', true, true);
    const channels = new Channels();
    const catalog = new ProductionCatalog(await resolveDefBinding());
    const service = new ProductionService(world, channels, catalog);
    const player = 0 as PlayerId;
    world.player(player).credits = 100_000;
    world.player(player).powerProduced = 900;

    const st = world.store;
    const plant = (key: string, cx: number, cz: number, extraFlags: number): EntityId => {
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
      st.radius[i] = Math.max(e.footprintW, e.footprintH) * CELL * 0.5;
      world.terrain.markOccupied(cx, cz, e.footprintW, e.footprintH, h);
      return h;
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
    return { world, service, catalog, player, run, plant };
  }

  /**
   * A war factory FIRST and inland, a dock second and on the coast — the order
   * every real build produces, and the order that made `primaryFactory[V]` the
   * war factory. The transport is then walled in at the factory door by a ring
   * of the player's own units, which is what a base full of army actually looks
   * like and what `blockedByEntity` sees.
   */
  async function riggedBase(): Promise<Rig> {
    const rig = await makeRig();
    rig.plant('conyard', 20, 40, EntityFlag.IsBuilder | EntityFlag.IsFactory);
    rig.plant('powerPlant', 25, 40, 0);
    rig.plant('refinery', 29, 40, 0);
    // The war factory, founded first and therefore primary for Vehicles.
    rig.plant('warFactory', 24, 46, EntityFlag.IsFactory);
    // The dock, on the coast. NOT flagged PrimaryFactory: nothing in a real
    // match ever sets that bit for an AI.
    rig.plant('navalYard', SHORE_CX - 4, 40, EntityFlag.IsFactory);

    // Wall the war factory's door with the player's own armour.
    const st = rig.world.store;
    const wf = rig.catalog.byKey('warFactory')!;
    const fx = 24 * CELL + wf.footprintW * CELL * 0.5;
    const fz = 46 * CELL + wf.footprintH * CELL * 0.5;
    for (let ring = 1; ring <= 4; ring++) {
      for (let a = 0; a < ring * 8; a++) {
        const ang = (a / (ring * 8)) * Math.PI * 2;
        const h = st.alloc(
          EntityKind.Vehicle, -1, rig.player, Faction.Allies,
          fx + Math.cos(ang) * ring * CELL, 0, fz + Math.sin(ang) * ring * CELL, 0,
        );
        if (h < 0) continue;
        const i = st.index(h);
        st.radius[i] = 2.4;
        st.hp[i] = 100; st.maxHp[i] = 100;
      }
    }
    rig.run(2);
    return rig;
  }

  it('produces an amphibious lift the war factory could never have released', async () => {
    /*
     * `transport` does NOT carry `warship` - it is the mobility half of the
     * naval arm - so `entry.warship` is the wrong discriminator and picking on
     * it leaves the lift at the war factory door. `ProductionCatalog.requiresSea`
     * is the right one: it is the prereq closure that already knows a carrier is
     * gated on a dock, and it excludes `mrdSkiff`, gated on a land forgeyard.
     */
    const rig = await riggedBase();
    const lift = rig.catalog.byKey('transport')!;
    expect(lift.warship, 'the lift is not a warship — that is the point').toBe(false);
    expect(rig.catalog.requiresSea(lift), 'but it does require a sea').toBe(true);

    expect(rig.service.availability(rig.player, lift.publicId).ok).toBe(true);
    rig.service.enqueue(rig.player, lift.publicId);
    rig.run(Math.ceil(lift.buildTime / SIM_DT) * 2 + 120);

    const st = rig.world.store;
    let built = 0;
    let nearestDockMetres = Infinity;
    const dockX = (SHORE_CX - 4) * CELL + 3 * CELL * 0.5;
    for (let a = 0; a < st.aliveCount; a++) {
      const i = st.alive[a];
      if (st.defId[i] !== lift.defId) continue;
      built++;
      nearestDockMetres = Math.min(nearestDockMetres, Math.abs(st.posX[i] - dockX));
    }
    expect(built, 'the lift never left the yard').toBe(1);
    // It came out at the DOCK, which is 150 m from the war factory in x.
    expect(nearestDockMetres, 'the lift egressed at the war factory, not the dock')
      .toBeLessThan(40);
    // And the queue drained, so "it launched" cannot mean "it is still coming".
    expect(rig.world.player(rig.player).queues[BuildTab.Vehicles].items.length,
      'the Vehicles queue is jammed behind a hull that cannot egress').toBe(0);
  });
});

/* ==========================================================================
 * 2. THE AI AIMS ITS DOCK AT THE BEACH
 * ========================================================================== */

describe('AiBrain places a Naval Yard on the shore', () => {
  const P_AI = 1 as PlayerId;

  /** Building ids from 0, unit ids from 1000. Same split as ai-late-game.spec. */
  function syntheticBinding(): DefLookup {
    const catalog = new BuildCatalog();
    const unitId: Record<string, number> = {};
    const buildingId: Record<string, number> = {};
    let u = 1000;
    let b = 0;
    for (const e of catalog.all) {
      if (e.isBuilding) buildingId[e.key] = b++;
      else unitId[e.key] = u++;
    }
    return { tables: null, unitId, buildingId };
  }

  interface Placed { cx: number; cz: number; defId: number }

  /**
   * A base whose Construction Yard sits `metres` inland of the waterline, one
   * Naval Yard already paid for and waiting to be put down, and nothing else in
   * the way. Returns every `PlaceBuilding` the brain issued.
   */
  function runPlacement(metresInland: number): { placed: Placed[]; yardDefId: number } {
    invalidateNavalWater();
    resetMoveClasses();
    const world = new World();
    world.terrain = coastalTerrain(world.terrain);
    world.addPlayer(Faction.Allies, 'Commander', true, true);
    world.addPlayer(Faction.Soviets, 'Opponent', false, false);
    const channels = new Channels();

    const nav = new FlowFieldCache(world.terrain);
    setActiveNav(nav);
    world.nav = nav;
    nav.update();

    const st = world.store;
    const shoreX = SHORE_CX * CELL;
    const yardX = shoreX - metresInland;
    const yardZ = 40 * CELL;
    const conyard = st.alloc(
      EntityKind.Building, 0, P_AI, Faction.Soviets, yardX, 0, yardZ, 0,
    );
    {
      const i = st.index(conyard);
      st.flags[i] |= EntityFlag.IsBuilder | EntityFlag.IsFactory;
      st.footprintW[i] = 3; st.footprintH[i] = 3;
      st.hp[i] = 2000; st.maxHp[i] = 2000;
      st.buildProgress[i] = 1;
      st.radius[i] = 6;
    }
    world.spatial.rebuild();

    const ai = world.player(P_AI);
    ai.aiDifficulty = 3;
    ai.credits = 20000;
    ai.storageMax = 40000;
    ai.powerProduced = 800;

    const catalog = new BuildCatalog();
    catalog.bind(syntheticBinding());
    const brain = new AiBrain(world, channels.commands, catalog, P_AI, 4242);
    brain.attach(channels.events);

    const yardEntry = catalog.forRole(BuildRole.NavalYard, Faction.Soviets);
    expect(yardEntry, 'the AI catalog has no Soviet naval yard').toBeDefined();
    const yardDefId = yardEntry!.defId;
    expect(yardDefId, 'the synthetic binding did not resolve the yard').toBeGreaterThanOrEqual(0);

    const placed: Placed[] = [];
    const rng = new Rng(7);
    for (let tick = 1; tick <= 400; tick++) {
      world.tick = tick;
      world.time = tick * SIM_DT;
      channels.setTick(tick);
      world.spatial.rebuild();
      // One tick in, the yard is finished and waiting to be placed. Announced
      // through the event the production module raises, which is the only way
      // anything ever enters `pendingPlaceDef`.
      if (tick === 30) {
        channels.events.emit('production:ready', {
          player: P_AI, tab: BuildTab.Structures, defId: yardDefId, isBuilding: true,
        } as never);
      }
      const s: SimContext = { dt: SIM_DT, tick, time: tick * SIM_DT, rng };
      brain.tick(s);
      channels.commands.drain((c: Command) => {
        if (c.kind === CommandKind.PlaceBuilding) {
          placed.push({ cx: c.cx, cz: c.cz, defId: c.defId });
        }
      });
    }
    setActiveNav(null);
    return { placed, yardDefId };
  }

  it('aims the dock at the beach rather than at the Construction Yard', () => {
    /*
     * THE DISCRIMINATOR IS A DISTANCE, not a boolean. Both the old anchor and
     * the new one produce a legal site in this rig — the waterline is inside
     * BUILD_RADIUS here, deliberately, so that the test is about AIM and not
     * about reach. The old code centred its spiral on the Construction Yard and
     * took the first legal cell it met, which is ring 1: a dock roughly a
     * footprint away from the yard and ~10 cells from the sea. The new code
     * centres it on `shoreCx/shoreCz`.
     */
    const inland = 36;
    const { placed, yardDefId } = runPlacement(inland);
    const yards = placed.filter((p) => p.defId === yardDefId);
    expect(yards.length, 'the AI never placed the naval yard at all')
      .toBeGreaterThan(0);

    const first = yards[0]!;
    // Cells from the footprint's seaward edge to the waterline.
    const gap = SHORE_CX - (first.cx + 3);
    expect(gap, `the yard was placed ${gap} cells from the water`).toBeLessThanOrEqual(2);
    // ...and that really is nearer the sea than the Construction Yard is.
    const conyardGap = Math.round(inland / CELL);
    expect(gap).toBeLessThan(conyardGap);
  });

  it('leaves the anchor alone on a battlefield with no sea', () => {
    // `probeSea` sets `shoreCx = -1` when `mapSupportsNaval()` is false, and the
    // new branch is guarded on `shoreCx >= 0`. The dry world's null terrain is
    // the landlocked case expressed as the absence of the double.
    invalidateNavalWater();
    const world = new World();
    world.addPlayer(Faction.Allies, 'Commander', true, true);
    world.addPlayer(Faction.Soviets, 'Opponent', false, false);
    const nav = new FlowFieldCache(world.terrain);
    setActiveNav(nav);
    world.nav = nav;
    nav.update();
    try {
      const catalog = new BuildCatalog();
      catalog.bind(syntheticBinding());
      const brain = new AiBrain(world, channelsOf(), catalog, P_AI, 4242);
      expect(brain.intent().seaCells).toBeLessThanOrEqual(0);
    } finally {
      setActiveNav(null);
    }
  });

  function channelsOf(): Channels['commands'] {
    return new Channels().commands;
  }
});

/* ==========================================================================
 * 3. THE TWO DEAD THINGS
 * ========================================================================== */

describe('the amphibious gate has one arm, and it is the live one', () => {
  it('no longer carries a saving threshold that could never be met', () => {
    /*
     * `amphibiousMinSaving` compared |G->O| against |G->E| + |E->L| + |L->O| —
     * a straight line against a polyline over the SAME endpoints — so the
     * triangle inequality made the saving non-positive on every map, at every
     * tick, and `saving < 12` was a constant `true`. The constant is gone
     * because no value of it can be reached, and this asserts the arithmetic
     * rather than only the deletion.
     */
    const G = { x: 0, z: 0 };
    const O = { x: 400, z: 0 };
    const d = (a: { x: number; z: number }, b: { x: number; z: number }): number =>
      Math.hypot(a.x - b.x, a.z - b.z);
    for (let k = 0; k < 64; k++) {
      const E = { x: (k * 37) % 400, z: ((k * 53) % 400) - 200 };
      const L = { x: (k * 71) % 400, z: ((k * 17) % 400) - 200 };
      const saving = d(G, O) - (d(G, E) + d(E, L) + d(L, O));
      expect(saving).toBeLessThanOrEqual(1e-9);
    }
    expect(Object.keys(AI_NAVAL)).not.toContain('amphibiousMinSaving');
  });

  it('bounds how long a brain will pay to reach a coast', () => {
    // Unbounded, "walk toward the sea" becomes "build generators forever" on a
    // base whose only beach is a cliff face.
    expect(AI_NAVAL.coastReachTicks).toBeGreaterThan(30 * 60);
    expect(AI_NAVAL.coastReachTicks).toBeLessThan(30 * 60 * 30);
  });

  it('keeps the build radius and the shore search commensurate', () => {
    // The coast creep exists because these two can be disjoint. If the beach
    // search could never reach past the build radius there would be nothing to
    // creep toward and the whole mechanism would be dead code.
    expect(AI_NAVAL.shoreSearchCells * CELL).toBeGreaterThan(BUILD_RADIUS);
  });

  it('sizes a landing party against the hull rather than against a land wave', () => {
    /*
     * `runAmphibious` gated staging on `minLandingSquad + waveThreshold()`, and
     * `waveThreshold` is the size of a LAND attack — 12 on a Normal Turtle. So a
     * brain needed 15 free bodies before it would put 4 of them on a 4-slot
     * landing ship, on a map where the land wave those other 11 are held back
     * for has nowhere to walk. The reserve is a property of the OPERATION now.
     */
    expect(AI_NAVAL.landingReserve).toBeLessThan(AI_SQUAD_MIN);
    expect(AI_NAVAL.minLandingSquad + AI_NAVAL.landingReserve).toBeLessThan(8);
  });

  it('knows how big every carrier it can buy actually is', async () => {
    /*
     * `CatalogEntry.slots` is DOCTRINE — authored in `AIStrategy.ts` because
     * `ProductionFacts` does not publish cargo capacity and the live oracle in
     * `ai.system.ts` is the only implementation of that seam the game runs. A
     * number transcribed by hand from a def table is a number that stops being
     * true, so this is the gate that keeps it true: every row the AI can name is
     * checked against `UnitDef.cargoSlots` from the real tables.
     *
     * It matters because `forLift` chooses a hull by this field alone. Wrong
     * here means an 8-slot heavy bought to carry three riflemen, or worse a
     * 2-slot raider bought for a landing that then never stages.
     */
    const binding = await resolveDefBinding();
    expect(binding.tables, 'the def tables must bind or this checks nothing').not.toBeNull();
    const catalog = new BuildCatalog();
    let carriers = 0;
    for (const e of catalog.all) {
      if (e.isBuilding) continue;
      const id = binding.unitId[e.key];
      if (id === undefined || id < 0) continue;
      const def = binding.tables!.units[id];
      if (def === undefined) continue;
      expect(e.slots, `${e.key} is authored ${e.slots} slots, the def says ${def.cargoSlots}`)
        .toBe(def.cargoSlots);
      if (def.cargoSlots > 0) carriers++;
    }
    // Every army fields a 4-slot lift and an 8-slot heavy, plus the Sandskiff:
    // the whole reason a hull can no longer be asked for by role alone.
    expect(carriers, 'carriers the AI can name').toBeGreaterThanOrEqual(8);
  });

  it('picks the smallest hull that fits, not the first row of the role', () => {
    /*
     * `forRole(Transport)` answers with the FIRST row a faction can field, and
     * for the Pact that is `mrdSkiff` — two slots, gated on their war factory.
     * A 2-slot hull cannot carry `minLandingSquad`, so a Meridian brain that
     * bought one had refused its own amphibious operation for the rest of the
     * match, at the moment of purchase, silently.
     */
    const catalog = new BuildCatalog();
    for (const f of [Faction.Allies, Faction.Soviets, Faction.Meridian, Faction.Reclaim]) {
      const small = catalog.forLift(f, AI_NAVAL.minLandingSquad);
      const large = catalog.forLift(f, 8);
      expect(small, `no lift at all for faction ${f}`).toBeDefined();
      expect(small!.slots, `${small!.key} cannot carry a minimum landing party`)
        .toBeGreaterThanOrEqual(AI_NAVAL.minLandingSquad);
      expect(large!.slots, `${large!.key} is the biggest hull ${f} fields`).toBe(8);
      // ...and the small one really is smaller: sizing to the squad is the
      // whole point, and one hull for both asks would mean it is not happening.
      expect(small!.slots).toBeLessThan(large!.slots);
    }
    // The Pact's raider is still in the catalog with its real capacity — a
    // human can put two men in one — it is simply not a landing craft.
    expect(catalog.get('mrdSkiff')?.slots).toBe(2);
  });

  it('never offers an army the Heavy Transport its dock cannot build', () => {
    /*
     * `Faction.Neutral` ON A HULL MEANS "THE TWO ORIGINAL ARMIES SHARE IT", not
     * "everyone": `transport` is gated on `navalYard`, which `subPen` aliases
     * and `mrdSlipway`/`rclDrydock` do not. Unfiltered, `forLift` answers the
     * Pact and the Reclamation with the one carrier they can never order — and
     * `consider` then refuses it and buys NOTHING, which measured as two brains
     * owning a dock, four warships between them and zero transports over a
     * 24-minute match.
     *
     * `allowed` is what the brain passes (`available && canQueue`); here it is
     * the prereq itself, so the test states the rule rather than the plumbing.
     */
    const catalog = new BuildCatalog();
    const ownDock: Record<number, string> = {
      [Faction.Allies]: 'navalYard',
      [Faction.Soviets]: 'navalYard',
      [Faction.Meridian]: 'mrdSlipway',
      [Faction.Reclaim]: 'rclDrydock',
    };
    for (const f of [Faction.Meridian, Faction.Reclaim]) {
      const unfiltered = catalog.forLift(f, 8);
      expect(unfiltered!.key, 'the shape of the defect, kept as the reason for the filter')
        .toBe('transport');
      const buildable = catalog.forLift(f, 8, (e) => e.prereqs.includes(ownDock[f]!));
      expect(buildable, `faction ${f} has no lift behind its own dock`).toBeDefined();
      expect(buildable!.key, `faction ${f} was offered "${buildable!.key}"`)
        .not.toBe('transport');
      expect(buildable!.slots).toBe(8);
    }
    // The two original armies really do field it, so the filter must not be a
    // blanket ban on Neutral rows.
    for (const f of [Faction.Allies, Faction.Soviets]) {
      const buildable = catalog.forLift(f, 8, (e) => e.prereqs.includes(ownDock[f]!));
      expect(buildable!.key, `faction ${f} lost the Heavy Transport`).toBe('transport');
    }
  });
});

/* ==========================================================================
 * 4. AN OPENING BASE CAN REACH THE WATER
 *
 * THE MEASUREMENT THAT WAS NEVER TAKEN, and the reason three of four brains on
 * Sunder Atoll never owned a boat. Everything either side of it was green:
 * `tests/sunder-atoll.spec.ts` counts 532 legal dock sites on the map and 106+
 * per island, and `§2` above proves the brain aims at the beach. Nobody asked
 * whether the two facts MEET — whether any of those sites is inside the
 * envelope an opening base actually opens with — and for three armies out of
 * four the answer was no, by 20-23 m. See `islandSeats` in
 * `src/game/Scenarios.ts` for the table.
 *
 * IT COSTS A REAL HEIGHTFIELD, which is why this section and not the three
 * above carries a `beforeAll` with a 300 s budget. There is no cheaper honest
 * version: the question is about a generated coastline, a spawned base and
 * `evaluatePlacement`'s own rule, and any two of those three can be faked into
 * agreeing with each other.
 *
 * IT IS NOT AN AI TEST. The envelope is `BUILD_RADIUS` around a Construction
 * Yard, which is the same for the human — a player on this map could not found
 * a dock on turn one either.
 * ========================================================================== */

describe('every opening on Sunder Atoll can found a dock without moving first', () => {
  const PRESET = 'atoll';
  const MAP_SEED = 0xa7011;
  const SIM_SEED = 4242;
  /** The dock each faction founds, in slot order for a four-army skirmish. */
  const YARDS = ['navalYard', 'subPen', 'mrdSlipway', 'rclDrydock'] as const;

  let terrain: Terrain;

  beforeAll(() => {
    terrain = new Terrain({
      scene: new THREE.Scene(),
      seed: MAP_SEED,
      biome: 'temperate' as never,
      anisotropy: 1,
      starts: startPointsFor(SKIRMISH_ARMIES_MAX, MAP_SEAS[PRESET] ?? null)
        .map((p) => ({ x: p.x, z: p.z })),
      sea: MAP_SEAS[PRESET] ?? null,
    });
    setActiveTerrain(terrain);
    invalidateNavalWater();
  }, 300_000);

  afterAll(() => {
    clearScenario();
    setActiveTerrain(null);
    terrain.dispose();
    invalidateNavalWater();
  });

  it('offers a legal naval yard site inside every army s build radius', async () => {
    const world = new World();
    world.terrain = terrain;
    world.addPlayer(Faction.Allies, 'Alpha', true, true);
    world.addPlayer(Faction.Soviets, 'Bravo', false, false);
    world.addPlayer(Faction.Meridian, 'Charlie', false, false);
    world.addPlayer(Faction.Reclaim, 'Delta', false, false);
    const catalog = new ProductionCatalog(await resolveDefBinding());
    expect(catalog.bound, 'the def tables must bind or this measures nothing').toBe(true);

    buildScenario(world, 'skirmish', SIM_SEED, { start: 'base', armies: 4, map: PRESET });
    world.spatial.rebuild();

    const report = makePlacementReport();
    const found: number[] = [];
    const nearest: number[] = [];
    for (let p = 0; p < YARDS.length; p++) {
      const entry = catalog.byKey(YARDS[p]!);
      expect(entry, `no catalog entry for "${YARDS[p]}"`).not.toBeNull();
      const w = entry!.footprintW;
      const h = entry!.footprintH;
      // The Construction Yard this army opened with — the anchor the envelope
      // is measured from, and the thing `islandSeats` moved.
      const st = world.store;
      let yx = -1;
      let yz = -1;
      for (let a = 0; a < st.aliveCount; a++) {
        const i = st.alive[a];
        if (st.kind[i] !== EntityKind.Building || st.owner[i] !== p) continue;
        if ((st.flags[i] & EntityFlag.IsBuilder) === 0) continue;
        yx = st.posX[i]; yz = st.posZ[i]; break;
      }
      expect(yx, `army ${p} opened with no Construction Yard`).toBeGreaterThanOrEqual(0);

      let sites = 0;
      let best = Infinity;
      for (let cz = 0; cz + h < MAP_CELLS; cz++) {
        for (let cx = 0; cx + w < MAP_CELLS; cx++) {
          if (!evaluatePlacement(world, p as PlayerId, entry!, cx, cz, report).ok) continue;
          sites++;
          const d = Math.hypot((cx + w * 0.5) * CELL - yx, (cz + h * 0.5) * CELL - yz);
          if (d < best) best = d;
        }
      }
      found.push(sites);
      nearest.push(sites === 0 ? -1 : Math.round(best));
    }

    // MEASURED 54 / 34 / 35 / 25 sites, nearest legal 48 / 48 / 52 / 53 m
    // against a 56 m radius. At the island centre it read 0 / 0 / 0 / 1 with
    // the nearest coastal ground 72-79 m out. The floor is far below the
    // measurement because the exact count moves with the seed; what it guards
    // is the step from none to some, for EVERY army rather than the lucky one.
    for (let p = 0; p < YARDS.length; p++) {
      expect(found[p], `army ${p} (${YARDS[p]}) has ${found[p]} legal `
        + `dock sites in its build radius; nearest legal ${nearest[p]} m `
        + `(all four: ${found.join(' / ')})`).toBeGreaterThan(0);
    }
    // ...and the seat is what bought it. A zero offset is the shipped defect.
    expect(ISLAND_SEAT_OFFSET).toBeGreaterThan(20);
  }, 300_000);
});
