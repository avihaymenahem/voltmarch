/**
 * ============================================================================
 * tests/defence-line-probe.spec.ts — DOES SIX MEN ON A LINE BEAT AN ARMY?
 * ============================================================================
 * AN INSTRUMENT, NOT A GATE, and it is skipped unless `VM_DEFENCE_PROBE` is
 * set:
 *
 *     VM_DEFENCE_PROBE=1 npx vitest run tests/defence-line-probe.spec.ts
 *     VM_DEFENCE_PROBE=1 VM_DEFENCE_RUNG=3 VM_DEFENCE_MIN=20 npx vitest run \
 *       tests/defence-line-probe.spec.ts
 *     VM_DEFENCE_PROBE=1 VM_DEFENCE_OUT=probe.json npx vitest run ...
 *
 * THE REPORT: *"i can win any army just by setting a 5-6 defence infantry on
 * line."* An analytic study confirmed it on paper and produced a causal
 * account, none of which is the simulation — no pathing, no acquisition
 * slicing, no retreat, no focus fire, no repair. THIS FILE IS THE SIMULATION.
 * It exists to confirm or refute the paper result and to test ONE falsifiable
 * prediction:
 *
 *     CRUSH COUNT > 0 ON EASY, AND ~0 FROM NORMAL UPWARD.
 *
 * THE MECHANISM BEHIND THAT PREDICTION, so a reader can tell a confirmation
 * from a coincidence. `crushesUnit` (src/sim/Crush.ts) is gated on
 * `CRUSH.minSpeed` 0.6 — the hull has to be ROLLING — and `Targeting.approach`
 * parks a hull executing an explicit `OrderKind.Attack` at 0.80 x range with
 * speed 0. So an ATTACK-MOVE drives through the line and an ATTACK ORDER stops
 * in front of it. `AiBrain.focusFire` issues explicit Attack orders only above
 * `AI_FOCUS.minDiscipline` 0.5, and `AI_SKILL[].discipline` is
 * 0.35 / 0.65 / 0.85 / 1.00 — so Easy never focuses and everything above it
 * does. BETTER MICRO SHOULD DISARM THE COUNTER. `focusOrders` is reported
 * beside `crushCount` for exactly that reason: if focus orders climb with the
 * rung and crushes do not fall, the mechanism story is wrong, and THAT IS THE
 * FINDING rather than a broken probe.
 *
 * WHY IT IS NOT PART OF `npm test`. It runs a real 20 sim-minute two-army
 * match on the real Temperate Valley heightfield — terrain, flow fields,
 * steering, movement, crushing, production, economy, harvesting, combat,
 * vision and a real `AiBrain` on its real phases. It is also SEED-DEPENDENT in
 * the way a gate must not be: "the line traded 4.2 to 1" is a fact about one
 * match on one seed, not an invariant.
 *
 * THE TWO TRAPS CLAUDE.md HAS ALREADY PAID FOR, and how this file avoids them:
 *
 *   1. THE UNLOCK GATE IS GRANTED, NOT STUBBED EMPTY.
 *      `tests/amphibious-landing.spec.ts` installs `new UnlockGate(() => [])`
 *      — a profile owning nothing — and that is correct THERE only because the
 *      navy is deliberately ungated. Here an empty profile would silently take
 *      superweapons, repair depots, refractor tanks and the commander off the AI,
 *      which is precisely how three separate investigations concluded "the AI
 *      never builds a superweapon". This installs a gate whose reader returns
 *      `MISSION_UNLOCK_IDS` — a profile that has finished every mission — and
 *      `proveUnlocked()` prints the proof for a gated def at t=0.
 *
 *   2. EACH ARMY IS HANDED ITS CONSTRUCTION YARD (`start: 'base'`).
 *      `DeployService` will not unfold a scenario-spawned MCV headlessly; the
 *      brain reports "deploying the construction yard" forever and the match
 *      never starts, which reads exactly like a broken feature. The measured
 *      cost of skipping the unfold is 2.43 s of opening.
 *
 *   3. THE REAL `ProductionService` DOES THE CHARGING. `AiBrain.governOpening`
 *      reads `p.stats.creditsSpent`, which only moves when `BuildQueue`'s drip
 *      actually charges — a harness that echoes `production:started` without
 *      charging lets the brain spend against a counter that never rises.
 *
 * THE LINE IS SIX INDIVIDUAL ORDERS, NEVER ONE GROUP ORDER, and that is the
 * whole point of the scenario rather than a detail of it. `Steering` applies
 * formation compression to units sharing a goal within
 * `NAV_FORMATION_GOAL_EPS` (0.6 m), so a single group order collapses six men
 * into a ~1.5 m disc — which is EASY to splash and is the opposite of what was
 * reported. Each man gets his own distinct goal ~4 m from his neighbour's, and
 * `assertSpread` fails the run if the men did not stay spread: a compressed
 * line measures a different thing and its numbers must not be quoted.
 * ============================================================================
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import * as THREE from 'three';

import { World } from '../src/core/world';
import { Channels } from '../src/core/events';
import { Rng } from '../src/core/math';
import {
  CELL, DEFAULT_SEED, MAP_CELLS, NAV_FORMATION_GOAL_EPS, SIM_DT,
} from '../src/core/config';
import {
  EntityFlag, EntityKind, Faction, Locomotor, OrderKind, Stance,
} from '../src/core/types';
import type {
  AvailabilityResult, EntityId, EvEntityKilled, PlayerId, SimContext,
} from '../src/core/types';

import { Terrain, setActiveTerrain } from '../src/world/Terrain';
import { FlowFieldCache, setActiveNav } from '../src/sim/Flowfield';
import { NavAgents, NavAssigner, SteeringSolver } from '../src/sim/Steering';
import { MovementIntegrator } from '../src/sim/Movement';
import { CrushResolver } from '../src/sim/Crush';
import { OrderExecutor, setOrderExecutionEnabled } from '../src/input/Commands';
import { ProductionService, BuildKind, createCatalog, setProduction } from '../src/sim/Production';
import type { BuildEntry } from '../src/sim/Production';
import { evaluatePlacement, makePlacementReport } from '../src/sim/Placement';
import { OreField, Economy, setActiveOreField, setActiveEconomy } from '../src/sim/Economy';
import { PowerGrid } from '../src/sim/Power';
import { HarvesterController } from '../src/sim/Harvesting';
import { TransportService, setTransportService } from '../src/sim/Transport';
import { Vision } from '../src/sim/Vision';
import { DamageSystem } from '../src/sim/Damage';
import { ProjectileSystem } from '../src/sim/Projectiles';
import { WeaponSystem } from '../src/sim/Combat';
import { TargetingSystem } from '../src/sim/Targeting';
import { AiDirector } from '../src/sim/AI';
import type { ProductionFacts, ProductionOracle } from '../src/sim/AIStrategy';
import { invalidateNavalWater } from '../src/sim/NavalWater';
import { UnlockGate, isBuildable, setUnlockGate } from '../src/progression/UnlockGate';
import { MISSION_UNLOCK_IDS } from '../src/data/Missions';
import { MAP_SEAS, buildScenario, clearScenario, startPointsFor } from '../src/game/Scenarios';

/* ==========================================================================
 * 1. THE SCENARIO — printed, because every number below is a fact about it
 * ========================================================================== */

/**
 * LANDLOCKED, DELIBERATELY. `MAP_SEAS` carries `coast`, `tropical` and `atoll`
 * and nothing else, so `temperate` has no navigable water at all — no naval
 * survey, no dock, no amphibious cycle, and therefore nothing that could put a
 * hull on a route the line does not stand across. `MAP_PRESETS.temperate.water`
 * is 0.0.
 */
const PRESET = 'temperate';
const BIOME = 'temperate';
/** Temperate Valley's shipped `mapSeed`, so this is a battlefield that ships. */
const MAP_SEED = 0x7e44a1;
/** The scenario/sim seed — `?seed=`, not `?mapseed=`. They are different. */
const SIM_SEED = 20260818;

/** Men on the line. The report said five or six; six is the stated case. */
const LINE_SIZE = 6;
/**
 * Metres between neighbours' GOALS.
 *
 * Six times `NAV_FORMATION_GOAL_EPS` and about three infantry collision discs.
 * Small enough to read as a line, far enough apart that `Steering` treats each
 * man as his own formation of one.
 */
const LINE_SPACING = 4.0;
/** How far along the human -> AI axis the line stands. */
const LINE_FRACTION = 0.65;
/** Metres BEHIND the line each man is spawned, so he walks to his own goal. */
const LINE_APPROACH = 12;

const RUNG = Number(process.env.VM_DEFENCE_RUNG ?? '1');
const MINUTES = Number(process.env.VM_DEFENCE_MIN ?? '20');

let terrain: Terrain;

beforeAll(() => {
  terrain = new Terrain({
    scene: new THREE.Scene(),
    seed: MAP_SEED,
    biome: BIOME as never,
    anisotropy: 1,
    starts: startPointsFor(2, MAP_SEAS[PRESET] ?? null, DEFAULT_SEED).map(
      (p) => ({ x: p.x, z: p.z }),
    ),
    sea: MAP_SEAS[PRESET] ?? null,
  });
  setActiveTerrain(terrain);
}, 300_000);

afterAll(() => {
  setActiveTerrain(null);
  terrain.dispose();
});

/* ==========================================================================
 * 2. THE HARNESS
 *
 * Lifted wholesale from `tests/amphibious-landing.spec.ts` — the same World,
 * Channels, terrain, Vision, FlowFieldCache, NavAssigner, SteeringSolver,
 * MovementIntegrator, ProductionService, OreField, Economy, PowerGrid,
 * HarvesterController, TransportService, ProjectileSystem, DamageSystem,
 * WeaponSystem, TargetingSystem and OrderExecutor, stepped in the same phase
 * order. ONE system is added: `CrushResolver`, which that probe does not need
 * and this one exists to measure. It goes where `crush.system.ts` puts it —
 * `Phase.Movement` order 970, i.e. after the integrator and BEFORE
 * `Phase.SpatialRebuild`, so it reads this tick's positions off last tick's
 * broadphase exactly as the shipped game does.
 * ========================================================================== */

interface LineMan {
  readonly id: EntityId;
  readonly goalX: number;
  readonly goalZ: number;
}

interface Match {
  world: World;
  director: AiDirector;
  production: ProductionService;
  crush: CrushResolver;
  human: PlayerId;
  ai: PlayerId;
  /** Handles of the six, in spawn order. Stale ones stay in the list. */
  line: LineMan[];
  step(ticks: number): void;
  /** Ticks in which at least one AI unit was aiming at a line member. */
  engagedTicks: number;
  /** Sum over ticks of AI units aiming at a line member. */
  engagedUnitTicks: number;
  /** Credits of AI entities a line member killed. */
  creditsKilled: number;
  /** Credits of line members killed by anything. */
  creditsLost: number;
  /** Line members run down under tracks specifically. */
  crushCount: number;
  /** Every line member's death tick, in the order they fell. */
  deathTicks: number[];
  tick: number;
  dispose(): void;
}

/** The line infantryman each army fields, by faction. */
const LINE_KEY: Readonly<Record<number, string>> = {
  [Faction.Allies]: 'gi',
  [Faction.Soviets]: 'conscript',
};

/**
 * Nearest cell centre to (x, z) a man can actually stand on.
 *
 * Rings outward, so the answer is the closest legal cell rather than the first
 * one a raster scan happens to hit — the line has to keep its shape, and
 * `assertSpread` fails the run if a nudge collapsed it.
 */
function footSpot(x: number, z: number): { x: number; z: number } {
  const cx0 = Math.min(MAP_CELLS - 1, Math.max(0, Math.floor(x / CELL)));
  const cz0 = Math.min(MAP_CELLS - 1, Math.max(0, Math.floor(z / CELL)));
  const ok = (cx: number, cz: number): boolean =>
    cx >= 0 && cz >= 0 && cx < MAP_CELLS && cz < MAP_CELLS
    && !terrain.isWater(cx, cz) && terrain.isPassable(cx, cz, Locomotor.Foot);
  if (ok(cx0, cz0)) return { x, z };
  for (let r = 1; r <= 8; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const cx = cx0 + dx;
        const cz = cz0 + dz;
        if (!ok(cx, cz)) continue;
        return { x: (cx + 0.5) * CELL, z: (cz + 0.5) * CELL };
      }
    }
  }
  return { x, z };
}

async function boot(): Promise<Match> {
  invalidateNavalWater();

  /*
   * TRAP 1 — A GATE THAT OWNS EVERYTHING, AND IT IS INSTALLED BEFORE THE
   * SCENARIO, because `buildScenario` asks `isBuildable` while it spawns the
   * starting army. `MISSION_UNLOCK_IDS` is the full set of ids the mission
   * table can ever pay out, so this is a profile that has finished the
   * campaign. `suppressUnlockGate(true)` would also work and is what PvP and
   * playback use; a REAL gate answering yes is preferred here because it keeps
   * the code path a player exercises rather than short-circuiting it.
   */
  setUnlockGate(new UnlockGate(() => MISSION_UNLOCK_IDS, {
    knownUnlockIds: MISSION_UNLOCK_IDS,
  }));

  const world = new World();
  const channels = new Channels();
  world.terrain = terrain;

  // Slot 0 is the HUMAN. He owns the line and does nothing else — no queue, no
  // brain, no second order after the line is posted.
  const human = world.addPlayer(Faction.Allies, 'Line', true, true);
  const ai = world.addPlayer(Faction.Soviets, 'Opfor', false, false);
  // Read by `AiBrain`'s constructor, so it must be set before `rebuild`.
  world.player(ai).aiDifficulty = RUNG;

  // TRAP 2 — `start: 'base'` hands both sides a finished Construction Yard.
  buildScenario(world, 'skirmish', SIM_SEED, { start: 'base', armies: 2, map: PRESET });

  const vision = new Vision(world, true);
  world.vision = vision;

  const nav = new FlowFieldCache(world.terrain);
  setActiveNav(nav);
  world.nav = nav;
  const agents = new NavAgents();
  const assigner = new NavAssigner(world, nav, agents);
  const steering = new SteeringSolver(world, nav, agents);
  const movement = new MovementIntegrator(world, nav, channels);
  const crush = new CrushResolver(world, channels);

  const { catalog } = await createCatalog();
  const production = new ProductionService(world, channels, catalog);
  setProduction(production);

  const ore = new OreField();
  const economy = new Economy(world, channels);
  const power = new PowerGrid(world, channels);
  const harvesters = new HarvesterController(world, channels, ore, economy);
  world.ore = ore;
  setActiveOreField(ore);
  setActiveEconomy(economy);

  const transport = new TransportService(world, channels);
  setTransportService(transport);
  const { resolveDefBinding } = await import('../src/game/Scenarios');
  const binding = await resolveDefBinding();
  if (binding.tables !== null) transport.bindDefs(binding.tables);
  transport.attach();

  const projectiles = new ProjectileSystem(world, channels);
  const damage = new DamageSystem(world, channels);
  const weapons = new WeaponSystem(world, channels, projectiles);
  const targeting = new TargetingSystem(world, channels, weapons);

  setOrderExecutionEnabled(true);
  const orders = new OrderExecutor(world, channels);

  const avail: AvailabilityResult = { ok: false, reason: '', capped: false };
  const report = makePlacementReport();
  const facts: Record<string, ProductionFacts | null> = {};
  const oracle: ProductionOracle = {
    factsFor(key) {
      const cached = facts[key];
      if (cached !== undefined) return cached;
      const e = production.catalog.byKey(key);
      const value: ProductionFacts | null = e === null ? null : {
        publicId: e.publicId, isBuilding: e.kind === BuildKind.Building, tab: e.tab,
        cost: e.cost, buildTimeSec: e.buildTime, power: e.power,
        footprintW: e.footprintW, footprintH: e.footprintH,
        prereqs: e.prereqs, faction: e.faction, buildable: e.buildable,
      };
      facts[key] = value;
      return value;
    },
    available: (p, id) => production.availability(p as PlayerId, id, avail).ok,
    entityKey: (id) => production.entryOf(id as EntityId)?.key ?? '',
    reason: (p, id) => {
      const r = production.availability(p as PlayerId, id, avail);
      return r.ok ? '' : r.reason;
    },
    atCap: (p, id) => production.availability(p as PlayerId, id, avail).capped,
    placeable: (p, id, cx, cz) => {
      const entry = production.catalog.resolve(id, true);
      return entry === null
        ? false
        : evaluatePlacement(world, p as PlayerId, entry, cx, cz, report).ok;
    },
  };

  const director = new AiDirector(world, channels);
  director.bindProduction(oracle);
  director.rebuild(SIM_SEED);
  for (const b of director.brains) economy.setResourceBonus(b.player, b.resourceBonus);

  // The ore, laid the way `economy.system.ts` lays it.
  const spec = (await import('../src/game/Scenarios')).activeScenario();
  if (spec !== null) {
    const accept = (cx: number, cz: number): boolean =>
      !world.terrain.isWater(cx, cz) && world.terrain.isPassable(cx, cz, Locomotor.Track);
    for (const f of spec.ore) ore.seedField(f.x, f.z, f.radius, f.richness, accept);
  }
  economy.recomputeStorage();
  power.recompute();

  /* -- THE LINE ---------------------------------------------------------- */

  const st = world.store;
  /** Where a player's Construction Yard actually stands. */
  const yardOf = (p: PlayerId): { x: number; z: number } | null => {
    for (let a = 0; a < st.aliveCount; a++) {
      const i = st.alive[a];
      if (st.kind[i] !== EntityKind.Building) continue;
      if (st.owner[i] !== (p as number)) continue;
      if ((st.flags[i] & EntityFlag.IsBuilder) === 0) continue;
      return { x: st.posX[i], z: st.posZ[i] };
    }
    return null;
  };
  const home = yardOf(human);
  const foe = yardOf(ai);
  expect(home, 'the human has no Construction Yard — trap 2').not.toBeNull();
  expect(foe, 'the AI has no Construction Yard — trap 2').not.toBeNull();
  const hx = home!.x; const hz = home!.z;
  const ax = foe!.x; const az = foe!.z;
  const len = Math.hypot(ax - hx, az - hz);
  // Unit vector along the approach lane, and its perpendicular.
  const ux = (ax - hx) / len; const uz = (az - hz) / len;
  const px = -uz; const pz = ux;
  const cx = hx + ux * len * LINE_FRACTION;
  const cz = hz + uz * len * LINE_FRACTION;

  const lineKey = LINE_KEY[world.player(human).faction as number] ?? 'gi';
  const lineEntry: BuildEntry | null = production.catalog.byKey(lineKey);
  expect(lineEntry, `no catalog entry for line infantry '${lineKey}'`).not.toBeNull();

  const line: LineMan[] = [];
  const lineIds = new Set<number>();
  for (let k = 0; k < LINE_SIZE; k++) {
    const off = (k - (LINE_SIZE - 1) / 2) * LINE_SPACING;
    const goal = footSpot(cx + px * off, cz + pz * off);
    const from = footSpot(goal.x - ux * LINE_APPROACH, goal.z - uz * LINE_APPROACH);
    // THE SAME SPAWNER THE GAME USES. `ProductionService.spawnUnit` is public
    // and mirrors `ScenarioBuilder.spawnUnit` exactly — weapon index, move
    // class, catalog stamp, `entity:spawned` and all. Hand-filling columns
    // would silently produce a rifleman with `weaponIndex = -1`, i.e. six men
    // who cannot shoot, and every number here would be a measurement of that.
    const id = production.spawnUnit(
      world.player(human), lineEntry!, from.x, from.z, Math.atan2(ux, uz),
    );
    expect(id, `line man ${k} failed to spawn`).not.toBe(0);
    line.push({ id, goalX: goal.x, goalZ: goal.z });
    lineIds.add(id as number);
  }
  world.spatial.rebuild();

  /*
   * SIX COMMANDS, SIX GOALS — never one group order. See the header. This goes
   * through `CommandBus.issueOrder`, which is the same path a right-click
   * takes, so `OrderExecutor.write` does the writing and the formation logic
   * sees exactly what it would see in a match.
   */
  const one = new Int32Array(1);
  for (const man of line) {
    one[0] = man.id as number;
    channels.commands.issueOrder(human, OrderKind.Move, one, 1, man.goalX, man.goalZ);
  }

  /* -- the ledgers ------------------------------------------------------- */

  let creditsKilled = 0;
  let creditsLost = 0;
  const deathTicks: number[] = [];
  let tick = 0;

  channels.events.on('entity:killed', (e: EvEntityKilled) => {
    if (lineIds.has(e.id as number)) {
      creditsLost += e.value;
      deathTicks.push(tick);
      return;
    }
    // Attributed to the KILLER ENTITY, not to the player: the human's own base
    // and starting escort are alive on the far side of the map and their kills
    // are not the line's.
    if (lineIds.has(e.killer as number)) creditsKilled += e.value;
  });

  const rng = new Rng(11);
  let regrow = 0;
  let engagedTicks = 0;
  let engagedUnitTicks = 0;
  let crushCount = 0;

  const m: Match = {
    world,
    director,
    production,
    crush,
    human,
    ai,
    line,
    engagedTicks: 0,
    engagedUnitTicks: 0,
    creditsKilled: 0,
    creditsLost: 0,
    crushCount: 0,
    deathTicks,
    tick: 0,
    step(ticks: number): void {
      for (let n = 0; n < ticks; n++) {
        tick++;
        world.tick = tick;
        world.time = tick * SIM_DT;
        channels.setTick(tick);
        const s: SimContext = { dt: SIM_DT, tick, time: tick * SIM_DT, rng };

        orders.tick();                    // Phase.Command 9000
        production.tick(s);               // Phase.Production 0
        power.simTick(s.time);            // Phase.Economy
        harvesters.simTick(s);
        economy.tick(s.dt, s.time);
        if (++regrow >= 300) { ore.regrow(regrow * SIM_DT); regrow = 0; }
        director.tick(s);                 // Phase.AI
        assigner.simTick(s);              // Phase.PathRequest
        steering.simTick(s);              // Phase.Steering
        movement.simTick(s);              // Phase.Movement 100

        /*
         * WHICH OF THE SIX WENT UNDER A TRACK, AND NOT MERELY HOW MANY DIED.
         *
         * `CrushResolver.crushedUnits` is a match-wide counter over every
         * player, so it cannot answer the question this probe was written for.
         * `runDown` pushes ONE damage record per victim onto `channels.damage`
         * (deliberately — a crush is a KILL, not a deletion, so it collects the
         * armour matrix, the kill credit and the ledger), and that queue is
         * drained at `damage.damageTick` further down this same tick. So the
         * records this call appended are exactly the crushes it caused, and the
         * targets in them are exactly its victims.
         */
        const before = channels.damage.count;
        crush.simTick(s);                 // Phase.Movement 970
        for (let q = before; q < channels.damage.count; q++) {
          if (lineIds.has(channels.damage.target[q])) crushCount++;
        }

        harvesters.drive(s.dt);
        world.spatial.rebuild();          // Phase.SpatialRebuild
        targeting.tick(s);                // Phase.Targeting

        /*
         * ENGAGEMENT, MEASURED AT `store.targetId` RATHER THAN ASSUMED.
         *
         * `AiBrain.remember` only ever fires for `EntityKind.Building`, so six
         * men in a field are NOT an objective — the brain's attack-move goes to
         * the base behind them and `Targeting`'s automatic acquisition is the
         * only thing that can put the line in anyone's sights. Whether that
         * happens at all is the question, so it is counted rather than assumed:
         * a run with `engagedTicks: 0` means the army walked past.
         */
        let aiming = 0;
        for (let a = 0; a < st.aliveCount; a++) {
          const i = st.alive[a];
          if (st.owner[i] !== (ai as number)) continue;
          if (lineIds.has(st.targetId[i])) aiming++;
        }
        if (aiming > 0) { engagedTicks++; engagedUnitTicks += aiming; }

        weapons.tick(s);                  // Phase.Weapons
        projectiles.tick(s);              // Phase.Projectiles
        damage.damageTick(s);             // Phase.Damage
        damage.cleanupTick(s);            // Phase.Cleanup 0
        transport.simTick(s);             // Phase.Cleanup -395
        vision.update();                  // Phase.Vision
      }
      m.tick = tick;
      m.engagedTicks = engagedTicks;
      m.engagedUnitTicks = engagedUnitTicks;
      m.creditsKilled = creditsKilled;
      m.creditsLost = creditsLost;
      m.crushCount = crushCount;
    },
    dispose(): void {
      // Module-level state; leaking any of it would poison every spec file that
      // runs after this one.
      setUnlockGate(null);
      setProduction(null);
      setTransportService(null);
      setActiveNav(null);
      setActiveOreField(null);
      setActiveEconomy(null);
      nav.dispose();
      clearScenario();
    },
  };
  return m;
}

/* ==========================================================================
 * 3. THE READOUTS
 * ========================================================================== */

/** Line members still standing. */
function survivors(m: Match): number {
  let n = 0;
  for (const man of m.line) if (m.world.store.isAlive(man.id)) n++;
  return n;
}

/** Live AI units — infantry and vehicles, not structures. */
function aiArmy(m: Match): number {
  const st = m.world.store;
  let n = 0;
  for (let a = 0; a < st.aliveCount; a++) {
    const i = st.alive[a];
    if (st.owner[i] !== (m.ai as number)) continue;
    const k = st.kind[i];
    if (k !== EntityKind.Infantry && k !== EntityKind.Vehicle) continue;
    if ((st.flags[i] & EntityFlag.IsHarvester) !== 0) continue;
    n++;
  }
  return n;
}

/**
 * Did the six stay a LINE, or did they collapse into a disc?
 *
 * Two separate measurements, because they can fail for different reasons. The
 * GOALS are the mechanism — `Steering` compresses a formation only for units
 * whose goals are within `NAV_FORMATION_GOAL_EPS` of each other, so goals
 * further apart than that is what makes six men six formations of one. The
 * BODIES are the outcome, and `footSpot`'s nudge or a tight corridor could
 * still have pushed two men onto each other's toes.
 */
function assertSpread(m: Match): { goal: number; body: number; mean: number } {
  const st = m.world.store;
  let worstGoal = Infinity;
  let worstBody = Infinity;
  let sum = 0;
  let pairs = 0;
  for (let a = 0; a < m.line.length; a++) {
    for (let b = a + 1; b < m.line.length; b++) {
      const ga = m.line[a];
      const gb = m.line[b];
      const dg = Math.hypot(ga.goalX - gb.goalX, ga.goalZ - gb.goalZ);
      if (dg < worstGoal) worstGoal = dg;
      const ia = st.index(ga.id);
      const ib = st.index(gb.id);
      if (ia < 0 || ib < 0) continue;
      const db = Math.hypot(st.posX[ia] - st.posX[ib], st.posZ[ia] - st.posZ[ib]);
      if (db < worstBody) worstBody = db;
      sum += db;
      pairs++;
    }
  }
  return {
    goal: +worstGoal.toFixed(3),
    body: +(pairs === 0 ? 0 : worstBody).toFixed(3),
    mean: +(pairs === 0 ? 0 : sum / pairs).toFixed(3),
  };
}

/**
 * TRAP 1'S RECEIPT. A def carrying a real `unlockedBy` must be buildable at
 * t=0, or every number in this file was measured against a disarmed AI.
 */
function proveUnlocked(m: Match): Record<string, unknown> {
  const entry = m.production.catalog.byKey('repairDepot');
  if (entry === null) return { gatedDef: 'repairDepot', found: false };
  const avail: AvailabilityResult = { ok: false, reason: '', capped: false };
  const r = m.production.availability(m.human, entry.publicId, avail);
  return {
    gatedDef: entry.key,
    unlockedBy: entry.unlockedBy,
    isBuildable: isBuildable(entry),
    availableToHuman: r.ok,
    // Anything but "Locked — complete a mission" means the gate said yes and
    // only the tech tree is talking.
    reason: r.ok ? '' : r.reason,
  };
}

/* ==========================================================================
 * 4. THE RUN
 * ========================================================================== */

const ENABLED = process.env.VM_DEFENCE_PROBE !== undefined
  && process.env.VM_DEFENCE_PROBE !== '';

describe('six defence infantry on a line against a real AI army', () => {
  it.runIf(ENABLED)('measures the trade, and counts the crushes', async () => {
    const { writeFileSync } = await import('node:fs');
    const out = process.env.VM_DEFENCE_OUT ?? '';
    const m = await boot();
    try {
      const brain = m.director.brains[0];
      expect(brain, 'no AI brain was built — check aiDifficulty/rebuild order').toBeDefined();

      const setup = {
        map: { preset: PRESET, biome: BIOME, mapSeed: `0x${MAP_SEED.toString(16)}`, simSeed: SIM_SEED,
          landlocked: MAP_SEAS[PRESET] === undefined },
        minutes: MINUTES,
        rung: RUNG,
        rungName: brain.intent().difficulty,
        unlockPolicy: 'GRANTED — UnlockGate(() => MISSION_UNLOCK_IDS), not an empty profile',
        unlockProof: proveUnlocked(m),
        start: "base — both sides handed a Construction Yard (DeployService trap)",
        lineSize: LINE_SIZE,
        lineKey: m.production.entryOf(m.line[0].id)?.key ?? '?',
        lineCostEach: m.production.entryOf(m.line[0].id)?.cost ?? 0,
        stance: 'Defensive',
        orders: 'six individual Move commands to six distinct goals',
        goalEps: NAV_FORMATION_GOAL_EPS,
      };
      console.log(`[defence-line] setup ${JSON.stringify(setup, null, 1)}`);

      // Let the six walk to their own goals and settle before anything else
      // happens. Ten seconds is ~30 m of walking for a 3.2 m/s rifleman against
      // a 12 m approach.
      m.step(300);

      /*
       * STANCE IS SET AFTER THE WALK, ON PURPOSE. `RepairSell.applyStance`
       * stamps `guardX/guardZ` — the post a Defensive unit walks back to — from
       * where the unit is STANDING when the stance changes. Setting it at spawn
       * would anchor every man 12 m behind the line he was ordered to hold.
       * Written to the columns directly rather than through
       * `CommandKind.SetStance`, because this harness has no `RepairSell`
       * instance to consume that command and `OrderExecutor` would park and
       * re-issue it forever; the two writes below are exactly what
       * `applyStance` performs for a non-harvester, non-Guard unit.
       */
      const st = m.world.store;
      for (const man of m.line) {
        const i = st.index(man.id);
        if (i < 0) continue;
        st.stance[i] = Stance.Defensive;
        st.guardX[i] = st.posX[i];
        st.guardZ[i] = st.posZ[i];
      }

      const spread = assertSpread(m);
      console.log(`[defence-line] spread after settling ${JSON.stringify(spread)}`);

      /*
       * IF THIS FAILS THE RUN IS MEANINGLESS AND MUST NOT BE QUOTED. A line
       * that compressed into a disc is the EASY case — one splash round takes
       * all six — and it is the opposite of what was reported.
       */
      expect(spread.goal, 'the six goals collapsed inside NAV_FORMATION_GOAL_EPS')
        .toBeGreaterThan(NAV_FORMATION_GOAL_EPS);
      expect(spread.body, 'the six men bunched inside NAV_FORMATION_GOAL_EPS')
        .toBeGreaterThan(NAV_FORMATION_GOAL_EPS);
      expect(survivors(m), 'the line was dead before the match started').toBe(LINE_SIZE);

      const rows: unknown[] = [];
      const TICKS = MINUTES * 60 * 30;
      const CHUNK = 30 * 60;
      for (let t = 300; t < TICKS; t += CHUNK) {
        m.step(Math.min(CHUNK, TICKS - t));
        const it = brain.intent();
        rows.push({
          minute: +((m.tick / 30) / 60).toFixed(2),
          lineAlive: survivors(m),
          aiArmy: aiArmy(m),
          creditsKilled: m.creditsKilled,
          creditsLost: m.creditsLost,
          crushes: m.crushCount,
          engagedTicks: m.engagedTicks,
          focusOrders: brain.focusOrderCount,
          aiCredits: it.credits,
          aiPosture: it.posture,
          aiMilitary: it.military,
          // "Did the match actually start" is answered here and nowhere else:
          // a brain stuck on `DeployService` reports the same posture forever
          // with an empty structure roll.
          aiStructures: it.structures,
          aiEconomyGoal: it.economy,
        });
      }

      const lastDeath = m.deathTicks.length === 0
        ? -1
        : m.deathTicks[m.deathTicks.length - 1];
      const result = {
        setup,
        spread,
        creditsKilled: m.creditsKilled,
        creditsLost: m.creditsLost,
        tradeRatio: m.creditsLost === 0
          ? null
          : +(m.creditsKilled / m.creditsLost).toFixed(2),
        crushCount: m.crushCount,
        crushedUnitsAllPlayers: m.crush.crushedUnits,
        engagedTicks: m.engagedTicks,
        engagedUnitTicks: m.engagedUnitTicks,
        engaged: m.engagedTicks > 0,
        lineSurvivors: survivors(m),
        lastLineDeathTick: lastDeath,
        lastLineDeathSeconds: lastDeath < 0 ? -1 : +(lastDeath / 30).toFixed(1),
        deathTicks: m.deathTicks,
        aiFocusOrders: brain.focusOrderCount,
        aiWithdrawals: brain.withdrawalCount,
        aiArmyAtEnd: aiArmy(m),
        trace: rows,
      };
      console.log(`[defence-line] result ${JSON.stringify(result, null, 1)}`);
      if (out !== '') writeFileSync(out, `${JSON.stringify(result, null, 1)}\n`);

      /*
       * THE ONLY HARD ASSERTIONS ARE ABOUT THE INSTRUMENT, NOT THE ANSWER.
       * A trade ratio, a crush count and an engagement count are FINDINGS —
       * pinning any of them would turn the next content change into a red gate
       * for a reason that is not a regression. What must hold is that the match
       * actually ran: a brain that built nothing measures the harness.
       */
      expect(m.tick, 'the match did not advance').toBeGreaterThan(300);
      expect(brain.intent().structures, 'the AI built nothing — did the yard hand-off fail?')
        .toBeTruthy();
    } finally {
      m.dispose();
    }
  }, 3_000_000);
});
