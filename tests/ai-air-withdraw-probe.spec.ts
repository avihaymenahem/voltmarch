/**
 * ============================================================================
 * tests/ai-air-withdraw-probe.spec.ts — DOES THE AIR RETREAT EVER FIRE?
 * ============================================================================
 * AN INSTRUMENT, NOT A GATE, and it is skipped unless `VM_AIR_PROBE` is set:
 *
 *     VM_AIR_PROBE=1 npx vitest run tests/ai-air-withdraw-probe.spec.ts
 *     VM_AIR_PROBE=1 VM_AIR_MIN=30 VM_AIR_OUT=probe.json npx vitest run ...
 *
 * `tests/ai-air-withdraw.spec.ts` proves the rule is CORRECT. That is a
 * different question from whether it is ever REACHED, and a rule that is
 * correct and unreachable is inert — which is the honest risk here, because it
 * needs an aircraft, in a strike group, under fire, between 30% and 50% health,
 * on a rung above Easy, on a pass where the brain has an action to spend.
 *
 * WHY IT IS NOT PART OF `npm test`. It runs a real four-army match — terrain,
 * flow fields, steering, movement, production, economy, harvesting, combat,
 * vision and four `AiBrain`s on their real phases — for `VM_AIR_MIN` sim
 * minutes. It is also SEED-DEPENDENT in the way `amphibious-landing.spec.ts`
 * describes: "the Hard brain withdrew four aircraft" is a fact about one match,
 * not an invariant, and pinning it fails on the next content change for a
 * reason that is not a regression.
 *
 * THE TRAP THIS FILE EXISTS TO AVOID, WRITTEN OUT BECAUSE IT HAS COST THIS
 * PROJECT THREE INVESTIGATIONS ALREADY: **any AI harness that stubs
 * `UnlockGate` with an empty profile is measuring a different game.** Aircraft
 * sit behind `unit.air`; `amphibious-landing.spec.ts` deliberately installs a
 * gate owning NOTHING, and the same shape read `sw=0/0` and concluded three
 * separate times that the AI never builds a superweapon. It does. This probe
 * installs a gate owning EVERY mission unlock, and `mirrorAI` is left at its
 * default so the AI resolves against that same full profile.
 *
 * ONE MATCH, FOUR RUNGS. Slot 0 is Easy, 1 Normal, 2 Hard, 3 Brutal, so a
 * single run answers the ladder question. That is not a strength comparison and
 * must not be read as one — the four are fighting each other, so every number
 * below is contingent on who happened to attack whom.
 *
 * THE COUNTER IT READS IS `AiBrain.airWithdrawalCount`, not the command stream.
 * A withdrawal is a single-entity `OrderKind.Move`, and so is every scout
 * waypoint — and `chooseScout` scores `sight * 0.6 + maxSpeed * 2 - maxHp *
 * 0.01`, which is a description of an airframe. Counting Moves would credit
 * this rule with the AI's scouting.
 * ============================================================================
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import * as THREE from 'three';

import { World } from '../src/core/world';
import { Channels } from '../src/core/events';
import { Rng } from '../src/core/math';
import { DEFAULT_SEED, SIM_DT } from '../src/core/config';
import { EntityFlag, EntityKind, Faction, Locomotor } from '../src/core/types';
import type { AvailabilityResult, PlayerId, SimContext } from '../src/core/types';

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
import { TransportService, setTransportService } from '../src/sim/Transport';
import { Vision } from '../src/sim/Vision';
import { DamageSystem } from '../src/sim/Damage';
import { ProjectileSystem } from '../src/sim/Projectiles';
import { WeaponSystem } from '../src/sim/Combat';
import { TargetingSystem } from '../src/sim/Targeting';
import { AiDirector } from '../src/sim/AI';
import type { ProductionFacts, ProductionOracle } from '../src/sim/AIStrategy';
import { invalidateNavalWater } from '../src/sim/NavalWater';
import { UnlockGate, setUnlockGate } from '../src/progression/UnlockGate';
import { MISSION_UNLOCK_IDS } from '../src/data/Missions';
import {
  MAP_SEAS, SKIRMISH_ARMIES_MAX, buildScenario, clearScenario, startPointsFor,
} from '../src/game/Scenarios';

const PRESET = 'temperate';
const BIOME = 'temperate';
const MAP_SEED = 0x5e1ec7;
const SIM_SEED = 90210;

let terrain: Terrain;

beforeAll(() => {
  terrain = new Terrain({
    scene: new THREE.Scene(),
    seed: MAP_SEED,
    biome: BIOME as never,
    anisotropy: 1,
    starts: startPointsFor(SKIRMISH_ARMIES_MAX, MAP_SEAS[PRESET] ?? null, DEFAULT_SEED).map(
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

interface AirRow {
  p: number;
  rung: number;
  aircraftBuilt: number;
  aircraftAlive: number;
  aircraftLost: number;
  airWithdrawals: number;
  withdrawals: number;
  army: number;
  strike: number;
}

interface Match {
  world: World;
  director: AiDirector;
  step(ticks: number): void;
  rows(): AirRow[];
  dispose(): void;
}

/** Rung per slot, so one match answers the ladder question. */
const RUNGS = [0, 1, 2, 3];

async function boot(): Promise<Match> {
  invalidateNavalWater();
  /*
   * A GATE OWNING EVERYTHING. See the header: an empty profile removes every
   * aircraft in the game and the probe would measure zero withdrawals for a
   * reason that has nothing to do with the rule under test.
   */
  setUnlockGate(new UnlockGate(
    () => MISSION_UNLOCK_IDS, { knownUnlockIds: MISSION_UNLOCK_IDS },
  ));
  const world = new World();
  const channels = new Channels();
  world.terrain = terrain;
  world.addPlayer(Faction.Allies, 'Alpha', false, false);
  world.addPlayer(Faction.Soviets, 'Bravo', false, false);
  world.addPlayer(Faction.Meridian, 'Charlie', false, false);
  world.addPlayer(Faction.Reclaim, 'Delta', false, false);
  for (let p = 0; p < RUNGS.length; p++) world.player(p as PlayerId).aiDifficulty = RUNGS[p];

  buildScenario(world, 'skirmish', SIM_SEED, { start: 'base', armies: 4, map: PRESET });

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
    entityKey: (id) => production.entryOf(id as never)?.key ?? '',
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

  const spec = (await import('../src/game/Scenarios')).activeScenario();
  if (spec !== null) {
    const accept = (cx: number, cz: number): boolean =>
      !world.terrain.isWater(cx, cz) && world.terrain.isPassable(cx, cz, Locomotor.Track);
    for (const f of spec.ore) ore.seedField(f.x, f.z, f.radius, f.richness, accept);
  }
  economy.recomputeStorage();
  power.recompute();

  // Aircraft BUILT and LOST, per owner. The alive count alone cannot tell "the
  // AI never built one" from "it built four and they all burned", and those two
  // findings are opposite conclusions about this rule.
  const built: Record<number, number> = {};
  const lost: Record<number, number> = {};
  channels.events.on('entity:spawned', (e) => {
    const i = world.store.index(e.id);
    if (i >= 0 && world.store.locomotor[i] === Locomotor.Air) {
      built[e.player as number] = (built[e.player as number] ?? 0) + 1;
    }
  });
  channels.events.on('entity:killed', (e) => {
    const i = world.store.index(e.id);
    if (i >= 0 && world.store.locomotor[i] === Locomotor.Air) {
      lost[e.player as number] = (lost[e.player as number] ?? 0) + 1;
    }
  });

  const rng = new Rng(11);
  let tick = 0;
  let regrow = 0;

  return {
    world,
    director,
    step(ticks: number): void {
      for (let n = 0; n < ticks; n++) {
        tick++;
        world.tick = tick;
        world.time = tick * SIM_DT;
        channels.setTick(tick);
        const s: SimContext = { dt: SIM_DT, tick, time: tick * SIM_DT, rng };

        orders.tick();
        production.tick(s);
        power.simTick(s.time);
        harvesters.simTick(s);
        economy.tick(s.dt, s.time);
        if (++regrow >= 300) { ore.regrow(regrow * SIM_DT); regrow = 0; }
        director.tick(s);
        assigner.simTick(s);
        steering.simTick(s);
        movement.simTick(s);
        harvesters.drive(s.dt);
        world.spatial.rebuild();
        targeting.tick(s);
        weapons.tick(s);
        projectiles.tick(s);
        damage.damageTick(s);
        damage.cleanupTick(s);
        transport.simTick(s);
        vision.update();
      }
    },
    rows(): AirRow[] {
      const st = world.store;
      const alive: Record<number, number> = {};
      for (let a = 0; a < st.aliveCount; a++) {
        const i = st.alive[a];
        if (st.kind[i] === EntityKind.Building) continue;
        if (st.locomotor[i] !== Locomotor.Air) continue;
        if ((st.flags[i] & EntityFlag.Alive) === 0) continue;
        alive[st.owner[i]] = (alive[st.owner[i]] ?? 0) + 1;
      }
      return director.brains.map((b) => {
        const it = b.intent();
        return {
          p: b.player as number,
          rung: RUNGS[b.player as number],
          aircraftBuilt: built[b.player as number] ?? 0,
          aircraftAlive: alive[b.player as number] ?? 0,
          aircraftLost: lost[b.player as number] ?? 0,
          airWithdrawals: b.airWithdrawalCount,
          withdrawals: b.withdrawalCount,
          army: it.army,
          strike: it.strike,
        };
      });
    },
    dispose(): void {
      // Module-level state; leaking it would gate every spec that runs after.
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
}

const ENABLED = process.env.VM_AIR_PROBE !== undefined && process.env.VM_AIR_PROBE !== '';

describe('a four-army match reaches the air retreat', () => {
  it.runIf(ENABLED)('counts air withdrawals per rung', async () => {
    const { writeFileSync } = await import('node:fs');
    const MINUTES = Number(process.env.VM_AIR_MIN ?? '30');
    const out = process.env.VM_AIR_OUT ?? '';
    const m = await boot();
    const trace: unknown[] = [];
    try {
      const TICKS = MINUTES * 60 * 30;
      const CHUNK = 30 * 60;
      for (let t = 0; t < TICKS; t += CHUNK) {
        m.step(CHUNK);
        trace.push({ minute: (t + CHUNK) / 30 / 60, rows: m.rows() });
      }
      const rows = m.rows();
      const line = rows.map((r) => `p${r.p}/rung${r.rung} built=${r.aircraftBuilt} `
        + `alive=${r.aircraftAlive} lost=${r.aircraftLost} `
        + `airOut=${r.airWithdrawals} allOut=${r.withdrawals}`).join('; ');
      if (out !== '') writeFileSync(out, `${JSON.stringify({ MINUTES, rows, trace }, null, 1)}\n`);

      const totalBuilt = rows.reduce((a, r) => a + r.aircraftBuilt, 0);
      const totalAir = rows.reduce((a, r) => a + r.airWithdrawals, 0);

      // IN THE ORDER THE FACTS HAVE TO BECOME TRUE. A failure of the first
      // explains a failure of the second and the reverse is not true — if no
      // brain ever buys an aircraft, that is a finding about the AI's build
      // priorities and says NOTHING about this rule.
      expect(totalBuilt, `no brain ever built an aircraft: ${line}`).toBeGreaterThan(0);
      expect(totalAir, `aircraft existed and none was ever pulled out: ${line}`)
        .toBeGreaterThan(0);
      // Easy is excluded by `AI_RETREAT.minDiscipline` and must stay at zero
      // however many aircraft it owns.
      const easy = rows.find((r) => r.rung === 0);
      expect(easy?.airWithdrawals, `Easy withdrew an aircraft: ${line}`).toBe(0);
    } finally {
      m.dispose();
    }
  }, 3_000_000);
});
