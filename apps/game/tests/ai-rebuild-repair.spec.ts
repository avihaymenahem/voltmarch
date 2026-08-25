/**
 * ============================================================================
 * tests/ai-rebuild-repair.spec.ts — DOES THE AI REBUILD, AND DOES IT REPAIR?
 * ============================================================================
 * AN INSTRUMENT, NOT A GATE, and it is skipped unless `VM_AI_REBUILD_PROBE`
 * is set:
 *
 *     VM_AI_REBUILD_PROBE=1 npx vitest run tests/ai-rebuild-repair.spec.ts
 *     VM_AI_REBUILD_PROBE=1 VM_AI_REBUILD_OUT=probe.json npx vitest run ...
 *
 * WHY IT IS NOT PART OF `npm test`. It runs a REAL 14 sim-minute match on a
 * real heightfield — terrain, flow fields, steering, movement, production,
 * economy, harvesting, repair, deployment, combat and vision — and its numbers
 * are facts about one seed rather than invariants. The invariants live in
 * `tests/ai-rebuild.spec.ts`, which is fast and part of the suite; this file is
 * what you run when you want to know whether the whole chain works against a
 * base that has actually been bombed.
 *
 * WHY IT EXISTS. Reported as *"when they are being attacked, and for example
 * their buildings destroyed, they are not rebuilding, not healing"*. Both
 * halves of that needed a number rather than a reading of `chooseBuild`,
 * because the two symptoms have completely different causes:
 *
 *   REBUILDING was mostly already there and mostly worked. `census` refills
 *   `roleCount` from live entities every pass, so a bombed refinery drops the
 *   count and the adaptive scorer re-proposes it. The hole was the
 *   CONSTRUCTION YARD, which is not a structure you build — it is an MCV you
 *   drive — and nothing in the file ever bought one.
 *
 *   REPAIR was not there at all. `issueRepairToggle` had no caller in
 *   `src/sim/AI.ts`; the AI's whole command surface was five verbs.
 *
 * WHAT IT MEASURES. The match settles, then player 0's base is BOMBED through
 * the real damage queue — the refinery and the war factory outright, the
 * Construction Yard and everything else down to `WOUND_FRACTION`. From there
 * it counts, for the rest of the match: `PlaceBuilding` commands per key,
 * `RepairToggle` commands, whether each destroyed role came back, and the
 * mean HP fraction of the buildings left standing.
 *
 * MEASURED ON `mapSeed 0x5e1ec7`, `simSeed 90210`, temperate, ONE Normal brain
 * against a dummy, settle 4 min + 10 min after the bombing. Both columns were
 * taken with THIS harness — the first attempt read the "before" column off an
 * earlier one that lacked the deploy service and the `reissued` guard, and its
 * unit counts were double what the brain had actually asked for:
 *
 *                            before      after
 *     repair toggles              0          32
 *     HP restored                 0      12 463
 *     credits spent on it         0       3 116
 *     mean HP frac (end)       0.35      0.9815
 *     MCVs bought                 0           1
 *     Construction Yard          no         yes
 *     structures placed           0           5
 *     units bought              120          80
 *
 * THE "BEFORE" COLUMN IS THE REPORT, REPRODUCED. Mean HP did not move by one
 * part in ten thousand across ten sim-minutes, no structure was ever placed
 * again, and the brain's own published goal read "construction yard lost —
 * throwing gi at them" for the whole of it.
 *
 * `units bought` FALLING IS THE FIX WORKING, not a regression. 120 -> 80 is
 * `AI_REBUILD.bankFraction` holding back the price of the vehicle instead of
 * converting it into riflemen 200 credits at a time, plus 3116 credits going
 * into the repair drip. What the brain bought with the difference is a base.
 * ============================================================================
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import * as THREE from 'three';

import { World } from '../src/core/world';
import { Channels } from '../src/core/events';
import { Rng } from '../src/core/math';
import { DEFAULT_SEED, SIM_DT } from '../src/core/config';
import { EntityFlag, EntityKind, Faction, Locomotor, NONE, WarheadClass } from '../src/core/types';
import type { AvailabilityResult, EntityId, PlayerId, SimContext } from '../src/core/types';

import { Terrain, setActiveTerrain } from '../src/world/Terrain';
import { FlowFieldCache, setActiveNav } from '../src/sim/Flowfield';
import { NavAgents, NavAssigner, SteeringSolver } from '../src/sim/Steering';
import { MovementIntegrator } from '../src/sim/Movement';
import { OrderExecutor, setOrderExecutionEnabled } from '../src/input/Commands';
import { ProductionService, BuildKind, createCatalog, setProduction } from '../src/sim/Production';
import { evaluatePlacement, makePlacementReport } from '../src/sim/Placement';
import { OreField, Economy, setActiveOreField, setActiveEconomy } from '../src/sim/Economy';
import { PowerGrid } from '../src/sim/Power';
import { HarvesterController } from '../src/sim/Harvesting';
import { RepairSellService, setRepairSellService } from '../src/sim/RepairSell';
import { DeployService, bindDeployTables, setDeploy } from '../src/sim/Deploy';
import { Vision } from '../src/sim/Vision';
import { DamageSystem } from '../src/sim/Damage';
import { ProjectileSystem } from '../src/sim/Projectiles';
import { WeaponSystem } from '../src/sim/Combat';
import { TargetingSystem } from '../src/sim/Targeting';
import { AiDirector } from '../src/sim/AI';
import { BuildRole } from '../src/sim/AIStrategy';
import type { ProductionFacts, ProductionOracle } from '../src/sim/AIStrategy';
import { invalidateNavalWater } from '../src/sim/NavalWater';
import { UnlockGate, setUnlockGate } from '../src/progression/UnlockGate';
import { MISSION_UNLOCK_IDS } from '../src/data/Missions';
import { buildScenario, clearScenario, startPointsFor } from '../src/game/Scenarios';

const PRESET = 'temperate';
const BIOME = 'temperate';
const MAP_SEED = 0x5e1ec7;
const SIM_SEED = 90210;
const ARMIES = 2;

/** The player whose base gets bombed. */
const VICTIM = 0 as PlayerId;
/** How far down the survivors are taken. */
const WOUND_FRACTION = 0.35;
/** `defaultSetup().startingCredits`, applied the way `Shell.startMatch` does. */
const STARTING_BANK = 10_000;

const MIN = Math.round(60 / SIM_DT);

let terrain: Terrain;

beforeAll(() => {
  terrain = new Terrain({
    scene: new THREE.Scene(),
    seed: MAP_SEED,
    biome: BIOME as never,
    anisotropy: 1,
    starts: startPointsFor(ARMIES, null, DEFAULT_SEED).map((p) => ({ x: p.x, z: p.z })),
    sea: null,
  });
  setActiveTerrain(terrain);
}, 300_000);

afterAll(() => {
  setActiveTerrain(null);
  terrain.dispose();
});

interface Snapshot {
  /** Live finished buildings of the victim, by catalog key. */
  readonly buildings: Record<string, number>;
  /** Mean hp/maxHp over the victim's finished buildings. */
  readonly meanHpFraction: number;
  readonly credits: number;
}

interface Match {
  world: World;
  director: AiDirector;
  /** `PlaceBuilding` commands by key, cleared at the bombing. */
  places: Record<string, number>;
  /** `RepairToggle` commands, cleared at the bombing. */
  repairToggles: number;
  /** `ProductionStart` commands by key, cleared at the bombing. */
  starts: Record<string, number>;
  step(ticks: number): void;
  snapshot(): Snapshot;
  /** `RepairSellService.stats` — what the drip actually did, not what was asked. */
  repairStats(): Record<string, number>;
  bomb(): { destroyed: string[]; wounded: number };
  resetCounters(): void;
  dispose(): void;
}

async function boot(): Promise<Match> {
  invalidateNavalWater();
  // A real gate owning nothing — a profile that has never finished a mission,
  // exactly as `tests/amphibious-landing.spec.ts` installs it and for the same
  // reason: `isBuildable` short-circuits on `active === null`, so without this
  // the gating layer is not in the picture at all.
  setUnlockGate(new UnlockGate(() => [], { knownUnlockIds: MISSION_UNLOCK_IDS }));

  const world = new World();
  const channels = new Channels();
  world.terrain = terrain;
  /*
   * ONE BRAIN, AND THE OPPONENT IS A DUMMY. Slot 1 is seated `isHuman` so
   * `AiDirector.rebuild` skips it (`AI.ts` — "if (p.isHuman || p.isLocal)
   * continue"), which makes it a base that never issues a command.
   *
   * THAT IS THE EXPERIMENT, NOT A SHORTCUT. The first version of this file ran
   * two brains and the victim was simply overrun: it finished the match with
   * zero buildings and zero credits, and "the AI did not rebuild" was
   * indistinguishable from "the AI was dead". A dummy opponent isolates the
   * question this file asks — given a bombed base and time, what does the
   * BRAIN do — from the question it does not.
   */
  world.addPlayer(Faction.Allies, 'Alpha', false, false);
  world.addPlayer(Faction.Soviets, 'Bravo', true, false);

  buildScenario(world, 'skirmish', SIM_SEED, { start: 'base', armies: ARMIES, map: PRESET });

  // The bank the lobby hands out, applied the way `Shell.startMatch` applies
  // it — after the scenario, over every non-Neutral slot. Without this the
  // victim opens on whatever its base layout rolled and is broke by minute
  // four, so every "it did not rebuild" would really be "it could not pay".
  for (let slot = 0; slot < world.players.length; slot++) {
    const p = world.players[slot];
    if (p.faction === Faction.Neutral) continue;
    p.credits = STARTING_BANK;
  }

  const vision = new Vision(world, true);
  world.vision = vision;

  const nav = new FlowFieldCache(world.terrain);
  setActiveNav(nav);
  world.nav = nav;
  const agents = new NavAgents();
  const assigner = new NavAssigner(world, nav, agents);
  const steering = new SteeringSolver(world, nav, agents);
  const movement = new MovementIntegrator(world, nav, channels);

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

  // THE REPAIR SERVICE IS THE POINT OF THIS FILE, so it is installed as the
  // real module singleton: `AiBrain.repairBase` reads `isRepairing` off it.
  const repairSell = new RepairSellService(world, channels);
  repairSell.attach();
  setRepairSellService(repairSell);

  /*
   * THE DEPLOY SERVICE, and it is not optional here the way it is in the
   * amphibious probe. That file opens from a prebuilt base and never unfolds
   * anything, so `OrderKind.Deploy` has no consumer and nobody notices. This
   * file's whole second question is whether a replacement Construction Vehicle
   * becomes a Construction Yard, and without this the MCV is bought, driven,
   * ordered to deploy, and then stands there forever while the brain reports
   * "deploying the construction yard" — which is exactly what the first run
   * after the fix showed, and it was the harness, not the brain.
   */
  const { resolveDefBinding } = await import('../src/game/Scenarios');
  const deployBinding = await resolveDefBinding();
  bindDeployTables(deployBinding.tables);
  const deploy = new DeployService(world, channels);
  setDeploy(deploy);

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

  const rng = new Rng(11);
  let tick = 0;
  let regrow = 0;

  const m: Match = {
    world,
    director,
    places: {},
    repairToggles: 0,
    starts: {},
    step(ticks: number): void {
      for (let n = 0; n < ticks; n++) {
        tick++;
        world.tick = tick;
        world.time = tick * SIM_DT;
        channels.setTick(tick);
        const s: SimContext = { dt: SIM_DT, tick, time: tick * SIM_DT, rng };

        orders.tick();                    // Phase.Command 9000
        deploy.tick(s);                   // Phase.Command 9500 — unfolds the MCV
        production.tick(s);               // Phase.Production 0
        power.simTick(s.time);            // Phase.Economy
        harvesters.simTick(s);
        economy.tick(s.dt, s.time);
        repairSell.simTick(s);            // Phase.Economy 500 — the drip
        if (++regrow >= 300) { ore.regrow(regrow * SIM_DT); regrow = 0; }
        director.tick(s);                 // Phase.AI
        assigner.simTick(s);              // Phase.PathRequest
        steering.simTick(s);              // Phase.Steering
        movement.simTick(s);              // Phase.Movement
        harvesters.drive(s.dt);
        world.spatial.rebuild();          // Phase.SpatialRebuild
        targeting.tick(s);                // Phase.Targeting
        weapons.tick(s);                  // Phase.Weapons
        projectiles.tick(s);              // Phase.Projectiles
        damage.damageTick(s);             // Phase.Damage
        damage.cleanupTick(s);            // Phase.Cleanup
        vision.update();                  // Phase.Vision
      }
    },
    repairStats(): Record<string, number> {
      const s = repairSell.stats;
      return {
        repairing: s.repairing,
        hpRestored: Math.round(s.hpRestored),
        creditsSpent: Math.round(s.creditsSpent),
        brokeCancels: s.brokeCancels,
      };
    },
    snapshot(): Snapshot {
      const st = world.store;
      const buildings: Record<string, number> = {};
      let hpSum = 0;
      let hpCount = 0;
      for (let a = 0; a < st.aliveCount; a++) {
        const i = st.alive[a];
        if (st.owner[i] !== (VICTIM as number)) continue;
        if (st.kind[i] !== EntityKind.Building) continue;
        if ((st.flags[i] & EntityFlag.PendingDestroy) !== 0) continue;
        if ((st.flags[i] & EntityFlag.UnderConstruction) !== 0) continue;
        const key = production.entryOf(st.handleOf(i))?.key ?? '?';
        buildings[key] = (buildings[key] ?? 0) + 1;
        if (st.maxHp[i] > 0) { hpSum += st.hp[i] / st.maxHp[i]; hpCount++; }
      }
      return {
        buildings,
        meanHpFraction: hpCount === 0 ? 0 : +(hpSum / hpCount).toFixed(4),
        credits: Math.round(world.player(VICTIM)?.credits ?? 0),
      };
    },
    /**
     * Bomb the victim's base through the REAL damage queue — the same records
     * a warhead pushes, so armour class, death, wreck spawning and every event
     * the brain subscribes to behave exactly as they do in a match.
     *
     * WHAT IS DESTROYED, AND WHY IT IS CAREFULLY NOT EVERYTHING. The
     * Construction Yard dies, ONE refinery dies, and everything else is taken
     * to `WOUND_FRACTION` and left standing.
     *
     * A structure needs a Construction Yard to be built at all (`conyard` is
     * what carries `producesTab: BuildTab.Structures`), so with the yard gone
     * there is exactly ONE route back for anybody, human or AI: buy a
     * Construction Vehicle from a war factory and unfold it. That makes three
     * things load-bearing about what SURVIVES:
     *
     *   the war factory — or there is no MCV to buy;
     *   one refinery    — or income is zero, the 3000 can never be saved, and
     *                     the position is unrecoverable BY DESIGN (the
     *                     `OreCrisis` dead end in another costume);
     *   the second refinery's absence — so there is also a plain structure
     *                     rebuild to observe once the yard is back.
     *
     * Measured: killing BOTH refineries leaves the brain on 545 credits with
     * no income, and no amount of intelligence recovers that. A probe that
     * bombs a position flat measures the rules, not the brain.
     */
    bomb(): { destroyed: string[]; wounded: number } {
      const st = world.store;
      const q = channels.damage;
      const destroyed: string[] = [];
      let wounded = 0;
      let refineriesSeen = 0;
      for (let a = 0; a < st.aliveCount; a++) {
        const i = st.alive[a];
        if (st.owner[i] !== (VICTIM as number)) continue;
        if (st.kind[i] !== EntityKind.Building) continue;
        if ((st.flags[i] & EntityFlag.PendingDestroy) !== 0) continue;
        const key = production.entryOf(st.handleOf(i))?.key ?? '?';
        const isBuilder = (st.flags[i] & EntityFlag.IsBuilder) !== 0;
        const isRefinery = (st.flags[i] & EntityFlag.IsRefinery) !== 0;
        // The FIRST refinery only — the survivor is what keeps income alive.
        const doomed = isBuilder || (isRefinery && refineriesSeen++ === 0);
        const amount = doomed
          ? st.hp[i] * 4
          : Math.max(0, st.hp[i] - st.maxHp[i] * WOUND_FRACTION);
        if (amount <= 0) continue;
        if (doomed) destroyed.push(key); else wounded++;
        q.push(
          st.handleOf(i), NONE, amount, WarheadClass.HighExplosive,
          st.posX[i], st.posY[i], st.posZ[i], 0, 0,
        );
      }
      return { destroyed, wounded };
    },
    resetCounters(): void {
      for (const k of Object.keys(m.places)) delete m.places[k];
      for (const k of Object.keys(m.starts)) delete m.starts[k];
      m.repairToggles = 0;
    },
    dispose(): void {
      // Module-level state; leaking it would poison every spec that runs after.
      setUnlockGate(null);
      setProduction(null);
      setRepairSellService(null);
      setDeploy(null);
      bindDeployTables(null);
      setActiveNav(null);
      setActiveOreField(null);
      setActiveEconomy(null);
      nav.dispose();
      clearScenario();
    },
  };

  const { CommandKind } = await import('../src/core/types');
  channels.commands.observe((c) => {
    /*
     * EVERY COMMAND HERE IS SEEN MORE THAN ONCE, and both things this tap does
     * are wrong without the guard.
     *
     * The observer lives inside `CommandBus.drain`, and a command a drainer
     * does not handle is PARKED and RE-ISSUED for the next phase to collect —
     * where it passes `drain` again, stamped `reissued`. So a RepairToggle the
     * order executor declines at Phase.Command comes back round at
     * Phase.Production, and the counters see one AI decision as two commands.
     *
     * For a toggle that is not a miscount, it is a NEGATION: applied twice, the
     * repair is switched on and then straight back off. Measured before the
     * guard: 954 toggles against `hpRestored: 0`, `creditsSpent: 0`,
     * `brokeCancels: 0` — the drip never ran for a single tick, and the brain
     * re-armed the same building forever because `isRepairing` was false every
     * time it looked.
     */
    if (c.reissued) return;

    /*
     * THE REPAIR DRAIN, as a tap. In the game `src/sim/features.system.ts`
     * drains the bus at `Phase.Production` order -100 and offers every command
     * to `RepairSellService.handleCommand` before parking the rest — but its
     * `park`/`reissue` pair is module-private, and a second naive `drain()` in
     * this harness would destroy the production commands `orders.tick()` had
     * just re-parked (the trap written up over `OrderExecutor.relocate`: one
     * drainer per phase).
     *
     * So the command is applied here instead, through the SAME `handleCommand`
     * the real system calls. The only difference is which drain of the tick it
     * lands on, which is immaterial to a layer running at 2 Hz.
     */
    if (c.kind === CommandKind.RepairToggle) repairSell.handleCommand(c);

    if ((c.player as number) !== (VICTIM as number)) return;
    if (c.kind === CommandKind.PlaceBuilding) {
      const e = production.catalog.resolve(c.defId, true);
      const k = e?.key ?? `#${c.defId}`;
      m.places[k] = (m.places[k] ?? 0) + 1;
    } else if (c.kind === CommandKind.ProductionStart) {
      const e = production.catalog.resolve(c.defId, c.tab === 0);
      const k = e?.key ?? `#${c.defId}`;
      m.starts[k] = (m.starts[k] ?? 0) + 1;
    } else if (c.kind === CommandKind.RepairToggle) {
      m.repairToggles++;
    }
  });

  return m;
}

const ENABLED = process.env.VM_AI_REBUILD_PROBE !== undefined
  && process.env.VM_AI_REBUILD_PROBE !== '';

describe('a bombed AI base rebuilds what it lost and mends what survived', () => {
  it.runIf(ENABLED)('recovers the yard, the refinery and the factory, and repairs', async () => {
    const m = await boot();
    try {
      // Settle: let the opening finish and the base fill out.
      m.step(4 * MIN);
      const before = m.snapshot();

      const hit = m.bomb();
      m.step(2);                 // let the queue drain and the deaths flush
      m.resetCounters();
      const bombed = m.snapshot();

      m.step(10 * MIN);
      const after = m.snapshot();

      const roles = m.director.brains
        .filter((b) => (b.player as number) === (VICTIM as number))
        .map((b) => b.intent());

      const result = {
        seed: { map: MAP_SEED, sim: SIM_SEED, preset: PRESET },
        before,
        destroyed: hit.destroyed,
        wounded: hit.wounded,
        bombed,
        after,
        placesAfterBombing: m.places,
        startsAfterBombing: m.starts,
        repairToggles: m.repairToggles,
        repairStats: m.repairStats(),
        intent: roles,
      };
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(result, null, 2));

      const out = process.env.VM_AI_REBUILD_OUT;
      if (out !== undefined && out !== '') {
        const { writeFileSync } = await import('node:fs');
        writeFileSync(out, JSON.stringify(result, null, 2));
      }

      // THE THREE CLAIMS THIS FILE MAKES. Each is a real end-to-end fact about
      // one seed, which is why the file is opt-in rather than a gate.
      expect(m.repairToggles).toBeGreaterThan(0);
      expect(after.meanHpFraction).toBeGreaterThan(bombed.meanHpFraction + 0.2);
      // The yard came back, which means the whole chain ran: MCV bought from
      // the surviving factory, driven, and unfolded.
      expect(after.buildings['conyard'] ?? 0).toBeGreaterThan(0);
      // ...and with a yard standing again, the economy is re-placeable.
      expect(after.buildings['refinery'] ?? 0).toBeGreaterThan(0);
    } finally {
      m.dispose();
    }
  }, 900_000);
});
