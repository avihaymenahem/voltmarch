/**
 * ============================================================================
 * tests/amphibious-landing.spec.ts — DOES A LANDING ACTUALLY HAPPEN?
 * ============================================================================
 * AN INSTRUMENT, NOT A GATE, and it is skipped unless `VM_LANDING_PROBE` is set:
 *
 *     VM_LANDING_PROBE=1 npx vitest run tests/amphibious-landing.spec.ts
 *     VM_LANDING_PROBE=1 VM_LANDING_MIN=12 npx vitest run tests/amphibious-landing.spec.ts
 *     VM_LANDING_PROBE=1 VM_LANDING_OUT=probe.json npx vitest run ...   # full trace
 *
 * WHY IT IS NOT PART OF `npm test`. It runs a REAL 24 sim-minute four-army match
 * on the real Sunder Atoll heightfield — terrain, flow fields, steering,
 * movement, production, economy, harvesting, transport, combat, vision and four
 * `AiBrain`s on their real phases — which takes about 3.5 minutes. It is also
 * SEED-DEPENDENT in a way a gate must not be: "the Reclamation brain lands
 * twelve times" is a fact about one match, not an invariant, and pinning it
 * would fail on the next content change for a reason that is not a regression.
 * The invariants live in `tests/ai-naval-yard.spec.ts`, which is fast; this file
 * is what you run when you want to know whether the whole chain works.
 *
 * WHY IT EXISTS AT ALL. Every layer of the amphibious feature had passing tests
 * while the feature produced nothing: `tests/naval-shore.spec.ts` proved a hull
 * egresses onto water, `tests/transport.spec.ts` proved boarding and unloading,
 * `tests/sunder-atoll.spec.ts` proved the map offers 532 legal dock sites, and
 * `tests/ai.spec.ts` proved the brain issues commands. All four were green while
 * a four-army match produced `navalYardCount = 0` and `landings = 0` for every
 * brain. Nothing was looking at the end-to-end number, so nothing saw that three
 * independent walls stood between the parts.
 *
 * WHAT IT MEASURES, per brain and per sim-minute: naval yards, transports,
 * warships, landings, the amphibious verdict with its numbers, the naval goal,
 * and what the build layer is blocked on. With `VM_LANDING_OUT` it also writes a
 * per-player decomposition of WHY there is or is not a legal dock site —
 * buildable ground, ground beside navigable water, ground inside the build
 * radius, and the intersection of the three. That decomposition is what turned
 * "the AI never builds a dock" into "for three of four armies the intersection
 * is EMPTY, and the nearest coastal site is 72-79 m from a 56 m build radius".
 *
 * MEASURED ON `mapSeed 0xa7011`, `simSeed 4242`, four brains, 24 minutes:
 *
 *                      before          after
 *     naval yards      0 / 0 / 0 / 1   0 / 1 / 0 / 1
 *     transports       0 / 0 / 0 / 0   0 / 0 / 0 / 3
 *     landings         0 / 0 / 0 / 0   0 / 0 / 0 / 12
 *
 * The Reclamation brain's first landing is at minute 8 and it runs them
 * continuously after. Two brains still never reach the water on this seed; see
 * the note in `AiBrain.coastCreepWanted`.
 * ============================================================================
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import * as THREE from 'three';

import { World } from '../src/core/world';
import { Channels } from '../src/core/events';
import { Rng } from '../src/core/math';
import { AI_BUILD } from '../src/core/config';
import { BUILD_RADIUS, CELL, MAP_CELLS, PRODUCTION, SIM_DT } from '../src/core/config';
import { EntityFlag, EntityKind, Faction, Locomotor } from '../src/core/types';
import type { AvailabilityResult, EntityId, PlayerId, SimContext } from '../src/core/types';

import { Terrain, setActiveTerrain } from '../src/world/Terrain';
import { FlowFieldCache, setActiveNav } from '../src/sim/Flowfield';
import { NavAgents, NavAssigner, SteeringSolver } from '../src/sim/Steering';
import { MovementIntegrator } from '../src/sim/Movement';
import { OrderExecutor, setOrderExecutionEnabled } from '../src/input/Commands';
import { ProductionService, BuildKind, createCatalog, setProduction } from '../src/sim/Production';
import { evaluatePlacement, makePlacementReport, withinBuildRadius } from '../src/sim/Placement';
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
import { BuildRole } from '../src/sim/AIStrategy';
import type { ProductionFacts, ProductionOracle } from '../src/sim/AIStrategy';
import { invalidateNavalWater } from '../src/sim/NavalWater';
import {
  MAP_SEAS, SKIRMISH_ARMIES_MAX, buildScenario, clearScenario, startPointsFor,
} from '../src/game/Scenarios';

const PRESET = 'atoll';
const BIOME = 'temperate';
const MAP_SEED = 0xa7011;
const SIM_SEED = 4242;

let terrain: Terrain;

beforeAll(() => {
  terrain = new Terrain({
    scene: new THREE.Scene(),
    seed: MAP_SEED,
    biome: BIOME as never,
    anisotropy: 1,
    starts: startPointsFor(SKIRMISH_ARMIES_MAX, MAP_SEAS[PRESET] ?? null).map(
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

interface Match {
  world: World;
  director: AiDirector;
  commands: Record<string, number>;
  step(ticks: number): void;
  diagnose(): unknown;
  census(): unknown;
  queues(): unknown;
  dispose(): void;
}

async function boot(): Promise<Match> {
  invalidateNavalWater();
  const world = new World();
  const channels = new Channels();
  world.terrain = terrain;
  // Four armies, all AI. Slot 0 is nominally "local" so the world has one, but
  // it is NOT human — every slot gets a brain.
  world.addPlayer(Faction.Allies, 'Alpha', false, false);
  world.addPlayer(Faction.Soviets, 'Bravo', false, false);
  world.addPlayer(Faction.Meridian, 'Charlie', false, false);
  world.addPlayer(Faction.Reclaim, 'Delta', false, false);

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
    const { Locomotor } = await import('../src/core/types');
    const accept = (cx: number, cz: number): boolean =>
      !world.terrain.isWater(cx, cz) && world.terrain.isPassable(cx, cz, Locomotor.Track);
    for (const f of spec.ore) ore.seedField(f.x, f.z, f.radius, f.richness, accept);
  }
  economy.recomputeStorage();
  power.recompute();

  const rng = new Rng(11);
  let tick = 0;
  let regrow = 0;

  const cmdLog: Record<string, number> = {};
  const { CommandKind } = await import('../src/core/types');
  channels.commands.observe((c) => {
    if (c.kind === CommandKind.ProductionStart) {
      const e = production.catalog.resolve(c.defId, c.tab === 0);
      const k = `p${c.player} start ${e?.key ?? `#${c.defId}`}`;
      cmdLog[k] = (cmdLog[k] ?? 0) + 1;
    } else if (c.kind === CommandKind.PlaceBuilding) {
      const e = production.catalog.resolve(c.defId, true);
      const k = `p${c.player} place ${e?.key ?? `#${c.defId}`}`;
      cmdLog[k] = (cmdLog[k] ?? 0) + 1;
    }
  });

  return {
    world,
    director,
    commands: cmdLog,
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
        movement.simTick(s);              // Phase.Movement
        harvesters.drive(s.dt);
        world.spatial.rebuild();          // Phase.SpatialRebuild
        targeting.tick(s);                // Phase.Targeting
        weapons.tick(s);                  // Phase.Weapons
        projectiles.tick(s);              // Phase.Projectiles
        damage.damageTick(s);             // Phase.Damage
        damage.cleanupTick(s);            // Phase.Cleanup 0
        transport.simTick(s);             // Phase.Cleanup -395 (after cleanup here is fine)
        vision.update();                  // Phase.Vision
      }
    },
    queues(): unknown {
      const out: unknown[] = [];
      for (const b of director.brains) {
        const p = world.player(b.player);
        for (let t = 0; t < p.queues.length; t++) {
          const q = p.queues[t];
          if (q.items.length === 0) continue;
          out.push({
            p: b.player, tab: t, awaiting: q.awaitingPlacement,
            head: production.catalog.resolve(q.items[0].defId, q.items[0].isBuilding)?.key ?? '?',
            ready: q.items[0].ready, progress: +q.items[0].progress.toFixed(3),
            depth: q.items.length,
          });
        }
      }
      return out;
    },
    census(): unknown {
      const st = world.store;
      const out: Record<string, number> = {};
      for (let a = 0; a < st.aliveCount; a++) {
        const i = st.alive[a];
        const k = production.entryOf(st.handleOf(i))?.key ?? '';
        if (k === '') continue;
        const key = `p${st.owner[i]} ${k}`;
        out[key] = (out[key] ?? 0) + 1;
      }
      return out;
    },
    diagnose(): unknown {
      const st = world.store;
      const rep = makePlacementReport();
      const res: unknown[] = [];
      for (const b of director.brains) {
        const faction = world.player(b.player).faction;
        const cat = director.catalog.forRole(BuildRole.NavalYard, faction);
        const entry = cat === undefined ? null : production.catalog.byKey(cat.key);
        if (entry === null) {
          res.push({ p: b.player, key: cat?.key ?? '(none)', entry: 'unresolved' });
          continue;
        }
        // The Construction Yard — what the AI's placement spiral anchors on.
        let bx = -1; let bz = -1;
        for (let a = 0; a < st.aliveCount; a++) {
          const i = st.alive[a];
          if (st.kind[i] !== EntityKind.Building) continue;
          if (st.owner[i] !== (b.player as number)) continue;
          if ((st.flags[i] & EntityFlag.IsBuilder) === 0) continue;
          bx = st.posX[i]; bz = st.posZ[i];
          break;
        }
        let legal = 0;
        let nearest = 1e9;
        let withinSpiral = 0;
        // Decomposition: which of the three independent conditions is the wall.
        let groundOk = 0;      // buildable + unoccupied
        let groundShore = 0;   // ...and navigable water beside it
        let groundRadius = 0;  // ...and inside the build radius (shore ignored)
        let nearestGroundShore = 1e9;
        const faults: Record<number, number> = {};
        const inRadiusPts: number[] = [];
        const shorePts: number[] = [];
        const w = entry.footprintW; const h = entry.footprintH;
        const acx = Math.floor(bx / CELL) - ((w / 2) | 0);
        const acz = Math.floor(bz / CELL) - ((h / 2) | 0);
        const r = PRODUCTION.shoreSearchCells;
        for (let cz = 0; cz + h < MAP_CELLS; cz++) {
          for (let cx = 0; cx + w < MAP_CELLS; cx++) {
            let ground = true;
            for (let dz = 0; ground && dz < h; dz++) {
              for (let dx = 0; dx < w; dx++) {
                if (!terrain.isBuildable(cx + dx, cz + dz) || terrain.isOccupied(cx + dx, cz + dz)) {
                  ground = false; break;
                }
              }
            }
            if (!ground) continue;
            groundOk++;
            const centreX = (cx + w * 0.5) * CELL;
            const centreZ = (cz + h * 0.5) * CELL;
            let wet = 0;
            for (let z = cz - r; z < cz + h + r && wet < PRODUCTION.shoreWaterCells; z++) {
              for (let x = cx - r; x < cx + w + r; x++) {
                if (x < 0 || z < 0 || x >= MAP_CELLS || z >= MAP_CELLS) continue;
                if (!terrain.isWater(x, z)) continue;
                if (!terrain.isPassable(x, z, Locomotor.Hover)) continue;
                if (++wet >= PRODUCTION.shoreWaterCells) break;
              }
            }
            const shore = wet >= PRODUCTION.shoreWaterCells;
            const inRadius = withinBuildRadius(world, b.player, centreX, centreZ);
            if (shore) {
              groundShore++;
              const d = Math.hypot(centreX - bx, centreZ - bz);
              if (d < nearestGroundShore) nearestGroundShore = d;
            }
            if (inRadius) { groundRadius++; inRadiusPts.push(centreX, centreZ); }
            if (shore) shorePts.push(centreX, centreZ);
            if (shore && inRadius) {
              const rr = evaluatePlacement(world, b.player, entry, cx, cz, rep);
              if (!rr.ok) faults[rr.fault] = (faults[rr.fault] ?? 0) + 1;
            }
            if (!evaluatePlacement(world, b.player, entry, cx, cz, rep).ok) continue;
            legal++;
            const d = Math.hypot(centreX - bx, centreZ - bz);
            if (d < nearest) nearest = d;
            const ring = Math.max(Math.abs(cx - acx), Math.abs(cz - acz));
            if (ring <= AI_BUILD.placementRings) withinSpiral++;
          }
        }
        let gap = 1e9;
        for (let a = 0; a < inRadiusPts.length; a += 2) {
          for (let c = 0; c < shorePts.length; c += 2) {
            const d = Math.hypot(inRadiusPts[a] - shorePts[c], inRadiusPts[a + 1] - shorePts[c + 1]);
            if (d < gap) gap = d;
          }
        }
        res.push({
          p: b.player,
          faction,
          key: cat?.key ?? '(none)',
          available: oracle.available(b.player as number, entry.publicId),
          reason: oracle.reason?.(b.player as number, entry.publicId) ?? '',
          groundOk,
          groundAndShore: groundShore,
          groundAndRadius: groundRadius,
          legalSitesAnywhere: legal,
          legalSitesInsideSpiral: withinSpiral,
          nearestLegalMetresFromYard: legal === 0 ? -1 : Math.round(nearest),
          nearestGroundShoreMetresFromYard:
            groundShore === 0 ? -1 : Math.round(nearestGroundShore),
          buildRadius: BUILD_RADIUS,
          gapMetres: gap === 1e9 ? -1 : Math.round(gap),
          faultsOnShoreRadiusSites: faults,
          yards: b.navalYardCount,
          landings: b.landingCount,
        });
      }
      return res;
    },
    dispose(): void {
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

const ENABLED = process.env.VM_LANDING_PROBE !== undefined
  && process.env.VM_LANDING_PROBE !== '';

describe('a four-army match on Sunder Atoll puts a squad ashore on another island', () => {
  it.runIf(ENABLED)('founds a dock, builds a hull, and lands', async () => {
    const { writeFileSync } = await import('node:fs');
    const MINUTES = Number(process.env.VM_LANDING_MIN ?? '24');
    const out = process.env.VM_LANDING_OUT ?? '';
    const m = await boot();
    const rows: unknown[] = [];
    const atStart = m.diagnose();
    try {
      const TICKS = MINUTES * 60 * 30;
      const CHUNK = 30 * 60;
      for (let t = 0; t < TICKS; t += CHUNK) {
        m.step(CHUNK);
        rows.push({
          minute: (t + CHUNK) / 30 / 60,
          sites: (t + CHUNK) / 30 / 60 <= 6 ? m.diagnose() : undefined,
          brains: m.director.brains.map((b) => {
            const it = b.intent();
            return {
              p: b.player,
              yards: b.navalYardCount,
              transports: it.transports,
              warships: it.warships,
              landings: b.landingCount,
              seaCells: it.seaCells,
              amph: b.amphibiousVerdict,
              naval: it.naval,
              blocked: it.blocked,
              military: it.military,
              economy: it.economy,
              army: it.army,
              strike: it.strike,
              credits: Math.round(it.credits),
              structures: it.structures,
            };
          }),
        });
      }
      const st = m.world.store;
      const perOwner: Record<number, number> = {};
      for (let a = 0; a < st.aliveCount; a++) {
        const i = st.alive[a];
        if (st.kind[i] !== EntityKind.Building) continue;
        perOwner[st.owner[i]] = (perOwner[st.owner[i]] ?? 0) + 1;
      }
      if (out !== '') {
        writeFileSync(out, `${JSON.stringify({
          minutes: MINUTES,
          perOwner,
          commands: m.commands,
          atStart,
          diagnosis: m.diagnose(),
          census: m.census(),
          queues: m.queues(),
          rows,
        }, null, 1)}
`);
      }

      const last = rows[rows.length - 1] as {
        brains: { p: number; yards: number; transports: number;
          landings: number; amph: string }[];
      };
      const line = last.brains.map((b) => `p${b.p} yards=${b.yards} `
        + `transports=${b.transports} landings=${b.landings} amph="${b.amph}"`).join('; ');
      const yards = last.brains.reduce((a, b) => a + b.yards, 0);
      const landings = last.brains.reduce((a, b) => a + b.landings, 0);

      // THE THREE FACTS, in the order they have to become true. Each gets its
      // own message, because a failure of the first explains a failure of the
      // third and the reverse is not true.
      expect(last.brains.some((b) => b.amph.startsWith('objective unreachable')),
        `no brain ever wanted a landing: ${line}`).toBe(true);
      expect(yards, `no brain ever founded a dock: ${line}`).toBeGreaterThan(0);
      expect(landings, `a dock was founded and nobody ever crossed: ${line}`)
        .toBeGreaterThan(0);
    } finally {
      m.dispose();
    }
  }, 3_000_000);
});
