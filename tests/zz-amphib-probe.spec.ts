/**
 * TEMPORARY PROBE — a real four-army match on Sunder Atoll, headless.
 * Deleted before the branch lands; see tests/amphibious-landing.spec.ts.
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
            if (inRadius) groundRadius++;
            if (!evaluatePlacement(world, b.player, entry, cx, cz, rep).ok) continue;
            legal++;
            const d = Math.hypot(centreX - bx, centreZ - bz);
            if (d < nearest) nearest = d;
            const ring = Math.max(Math.abs(cx - acx), Math.abs(cz - acz));
            if (ring <= AI_BUILD.placementRings) withinSpiral++;
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

describe('probe', () => {
  it('runs a four-army match on sunder-atoll', async () => {
    const { writeFileSync } = await import('node:fs');
    const MINUTES = Number(process.env.VM_PROBE_MIN ?? '24');
    const out = process.env.VM_PROBE_OUT ?? 'probe.json';
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
              dbgYard: { ...b.dbgYard },
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
      writeFileSync(
        out,
        `${JSON.stringify(
          { minutes: MINUTES, perOwner, commands: m.commands, atStart, diagnosis: m.diagnose(), rows },
          null, 1,
        )}\n`,
      );
      expect(true).toBe(true);
    } finally {
      m.dispose();
    }
  }, 3_000_000);
});
