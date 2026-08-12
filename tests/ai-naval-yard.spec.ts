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
 *      INTERSECTION IS ZERO. No search can find a site that does not exist, so
 *      the base has to walk to the water — which is what a human does and what
 *      this map's ore layout is designed around. §3.
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

import { describe, expect, it, beforeEach } from 'vitest';

import { World } from '../src/core/world';
import { Channels } from '../src/core/events';
import { Rng } from '../src/core/math';
import {
  BUILD_RADIUS, CELL, MAP_CELLS, SIM_DT,
} from '../src/core/config';
import {
  BuildTab, CommandKind, EntityFlag, EntityKind, Faction, Locomotor,
} from '../src/core/types';
import type { Command, EntityId, ITerrain, PlayerId, SimContext } from '../src/core/types';

import { ProductionCatalog, ProductionService } from '../src/sim/Production';
import { resetMoveClasses } from '../src/sim/Movement';
import { FlowFieldCache, setActiveNav } from '../src/sim/Flowfield';
import { invalidateNavalWater } from '../src/sim/NavalWater';
import { AiBrain } from '../src/sim/AI';
import { AI_NAVAL, BuildCatalog, BuildRole } from '../src/sim/AIStrategy';
import type { DefLookup } from '../src/sim/AIStrategy';
import { resolveDefBinding } from '../src/game/Scenarios';

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
     * `transport` does NOT carry `naval` — it beaches itself on purpose — so
     * `entry.naval` is the wrong discriminator and picking on it leaves the lift
     * at the war factory door. `ProductionCatalog.requiresSea` is the right one:
     * it is the prereq closure that already knows a Hover Transport is gated on
     * a dock, and it excludes `mrdSkiff`, which is gated on a land forgeyard.
     */
    const rig = await riggedBase();
    const lift = rig.catalog.byKey('transport')!;
    expect(lift.naval, 'the lift is not flagged naval — that is the point').toBe(false);
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
});
