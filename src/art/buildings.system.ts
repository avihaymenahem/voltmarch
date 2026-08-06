/**
 * ============================================================================
 * VOLTMARCH — src/art/buildings.system.ts
 * ============================================================================
 * The plugin entry point for the building-art module.
 *
 * WHAT IT DOES AT BOOT
 *   1. Picks an atlas size from the quality tier.
 *   2. Generates two greeble atlases per faction — architecture and ground —
 *      for four materials total, shared by all 24 structures.
 *   3. Builds every mass list, validating each against BUILDING_VALIDATION and
 *      REJECTING anything that misses.
 *   4. Measures the live heightfield to prove the foundation pads' skirt is
 *      deep enough to meet terrain on every buildable cell.
 *   5. Publishes them on `buildingLibrary` and hands them to RenderBridge.
 *   6. Prints the scorecard line for every structure, so the critic loop gets
 *      numbers instead of opinions.
 *
 * WHAT IT DOES EVERY FRAME
 *   One line: `buildingTime.value = r.time`. That single shared uniform drives
 *   construction rise, bay doors, radar sweeps, damage flicker and the
 *   selection pulse across every structure on the map, because all of them are
 *   per-instance shader effects reading `aState` and `aFeature`. There is no
 *   per-entity animation state anywhere in this module.
 *
 * HANDING OFF TO RenderBridge
 * ---------------------------
 * Two passes, the same shape `units.system.ts` uses:
 *
 *   a. a DEFAULT per Faction at defId -1, so a building spawned before the
 *      content tables exist gets real art instead of a hazard box;
 *   b. an EXACT registration per content key once `resolveDefBinding()` has a
 *      def table, so a Barracks stops borrowing the Construction Yard's shell.
 *
 * Until (b) has a table to bind against, every structure of an army draws its
 * Construction Yard. That is loud, deliberate, and reported at boot — the
 * alternative is silently guessing, and the fix is one data module away.
 * ============================================================================
 */

import * as THREE from 'three';

import { defineSystem } from '../core/loop';
import {
  BUILDING_GREEBLE,
  BUILDING_PAD,
  CELL,
  MAP_CELLS,
  MAP_SIZE,
  QUALITY_PRESETS,
  RA3_PAD_PALETTE,
  RA3_STRUCTURE_PALETTE,
} from '../core/config';
import { EntityKind, Faction, RenderPhase, type QualityTier, type RenderContext } from '../core/types';
import { ctx } from '../game/context';
import { resolveDefBinding } from '../game/Scenarios';
import { FACTION_ANY, registerKindMesh, type KindMesh, type SocketSpec } from '../render/RenderBridge';
import { STRUCTURE_MASS_LISTS } from './BuildingDefs';
import {
  buildingLibrary,
  buildingTime,
  formatStructureStats,
  type StructureFaction,
  type StructureModel,
} from './BuildingFactory';

interface BuildingGlobal { __vmBuildings?: unknown; }

/**
 * Content key -> [allied model, soviet model], for the keys whose def is
 * faction-neutral. The content vocabulary belongs to `src/game/Scenarios.ts`,
 * so this is the one place the two namespaces meet.
 */
const SHARED_KEYS: Readonly<Record<string, readonly [string, string]>> = {
  conyard: ['allied_conyard', 'soviet_conyard'],
  powerPlant: ['allied_power', 'soviet_power'],
  barracks: ['allied_barracks', 'soviet_barracks'],
  refinery: ['allied_refinery', 'soviet_refinery'],
  warFactory: ['allied_warfactory', 'soviet_warfactory'],
  radar: ['allied_radar', 'soviet_radar'],
  battleLab: ['allied_tech', 'soviet_tech'],
  oreSilo: ['allied_silo', 'soviet_silo'],
  repairDepot: ['allied_depot', 'soviet_depot'],
  wall: ['allied_wall', 'soviet_wall'],
  gate: ['allied_gate', 'soviet_gate'],
};

/** Content keys whose def already picks a side. Registered at FACTION_ANY. */
const FACTION_KEYS: Readonly<Record<string, string>> = {
  pillbox: 'allied_pillbox',
  // Real slewing crystal head, not the AA mount it stood in for.
  prismTower: 'allied_prismtower',
  teslaCoil: 'soviet_tesla',
  // Turretless with four radial nozzles: `Defs.flameTower` never sets
  // `hasTurret`, so nothing on it may slew.
  flameTower: 'soviet_flametower',
  // Single-faction in Defs.ts, so these are FACTION_ANY like the defences —
  // and they now have their own art instead of borrowing a Construction Yard.
  navalYard: 'allied_navalyard',
  subPen: 'soviet_subpen',
  // Freed from stand-in duty by the two rows above; these are the def rows the
  // models agent asked for and they now exist in Defs.ts.
  aaTurret: 'allied_aa',
  sentryGun: 'soviet_sentry',
};

/**
 * What a faction falls back to when the defId is unknown.
 *
 * The BARRACKS, deliberately, and it is worth saying why. Until a data module
 * publishes a `DefTables`, every structure the scenario spawns carries defId
 * -1, so the bridge resolves all of them to this one model and an entire base
 * is eight copies of it. The barracks is the least damaging choice available:
 * its 2x2 footprint is the modal structure size (only the Construction Yard,
 * Refinery and War Factory are bigger, and the defences and walls are 1x1), and
 * it is the plainest silhouette in the roster — no crane, no dish, no stacks —
 * so a base of them reads as a base rather than as eight Construction Yards,
 * which is what an obviously-repeated landmark building looks like.
 *
 * Every content key already has its real model in the tables above; the moment
 * `resolveDefBinding()` returns a table this fallback stops being reachable.
 */
const DEFAULT_KEY: Readonly<Record<StructureFaction, string>> = {
  allies: 'allied_barracks',
  soviets: 'soviet_barracks',
};

/* ==========================================================================
 * BRIDGE SHAPE
 * ========================================================================== */

/**
 * Translate a built structure into the bridge's shape.
 *
 * The pad is a separate PART because it carries a separate material (bible
 * 5.4's ground class), and the turret is a separate part because the bridge
 * slews it. Doors and radar dishes are NOT parts — they animate inside the
 * body geometry off `aFeature`, which is what keeps a War Factory at two draw
 * calls instead of four.
 */
function toKindMesh(m: StructureModel): KindMesh {
  const sockets: SocketSpec[] = m.sockets.map((s) => ({
    part: s.part, x: s.x, y: s.y, z: s.z, yaw: s.yaw, pitch: s.pitch, followsTurret: false,
  }));
  for (const s of m.turretSockets) {
    sockets.push({
      part: s.part,
      x: s.x + m.turretPivot[0], y: s.y + m.turretPivot[1], z: s.z + m.turretPivot[2],
      yaw: s.yaw, pitch: s.pitch, followsTurret: true, pivotY: m.turretPivot[1],
    });
  }

  const parts: NonNullable<KindMesh['parts']>[number][] = [];
  if (m.pad !== null) {
    parts.push({
      geometry: m.pad,
      material: m.padMaterial,
      // A pad is 40 mm of slab on the ground. Casting a shadow from it buys
      // nothing and costs a shadow-map draw per structure on screen.
      castShadow: false,
      receiveShadow: true,
    });
  }
  if (m.turret !== null) {
    parts.push({
      geometry: m.turret,
      material: m.material,
      x: m.turretPivot[0], y: m.turretPivot[1], z: m.turretPivot[2],
      followsTurret: true,
      castShadow: true,
      receiveShadow: true,
    });
  }

  return {
    geometry: m.body,
    material: m.material,
    parts: parts.length > 0 ? parts : undefined,
    sockets,
    turretPivotY: m.turretPivot[1],
    castShadow: true,
    receiveShadow: true,
  };
}

/** 256 on Low, 512 everywhere else. */
function atlasSizeFor(tier: QualityTier): number {
  const preset = QUALITY_PRESETS[tier] ?? QUALITY_PRESETS[2];
  return Math.min(BUILDING_GREEBLE.atlasSize, Math.max(256, preset.textureSize));
}

function palettesFor(faction: StructureFaction) {
  return {
    structure: RA3_STRUCTURE_PALETTE[faction],
    pad: RA3_PAD_PALETTE[faction],
    panelDensity: faction === 'allies'
      ? BUILDING_GREEBLE.panelDensityAllies
      : BUILDING_GREEBLE.panelDensitySoviets,
    seed: faction === 'allies' ? BUILDING_GREEBLE.seedAllies : BUILDING_GREEBLE.seedSoviets,
    padSeed: faction === 'allies' ? BUILDING_GREEBLE.seedPadAllies : BUILDING_GREEBLE.seedPadSoviets,
  };
}

/* ==========================================================================
 * PAD / TERRAIN CONTACT
 * ========================================================================== */

/**
 * Prove the pad skirt is deep enough.
 *
 * A structure is instanced from ONE shared geometry at ONE world Y, so the pad
 * cannot be re-meshed to the ground under it. Instead it is extruded down by
 * `BUILDING_PAD.skirtDepth`, and this measures whether that is actually enough:
 * for every buildable cell it takes the worst height difference across a 3x3
 * cell footprint (12 m, the largest structure in the roster) and reports the
 * maximum. If the answer ever exceeds the skirt, structures on the worst sites
 * would show daylight under one corner — so it is measured, not assumed.
 */
function measurePadContact(terrain: {
  heightAt(x: number, z: number): number;
  isBuildable(cx: number, cz: number): boolean;
}): { worst: number; sampled: number; over: number } {
  const half = 1; // cells either side: a 3x3 footprint
  let worst = 0;
  let sampled = 0;
  let over = 0;
  // Stride 2: 12 m footprints overlap heavily, and this runs at boot.
  for (let cz = half; cz < MAP_CELLS - half; cz += 2) {
    for (let cx = half; cx < MAP_CELLS - half; cx += 2) {
      if (!terrain.isBuildable(cx, cz)) continue;
      const centre = terrain.heightAt((cx + 0.5) * CELL, (cz + 0.5) * CELL);
      let drop = 0;
      for (let dz = -half; dz <= half; dz++) {
        for (let dx = -half; dx <= half; dx++) {
          const h = terrain.heightAt((cx + dx + 0.5) * CELL, (cz + dz + 0.5) * CELL);
          const d = centre - h;
          if (d > drop) drop = d;
        }
      }
      sampled++;
      if (drop > worst) worst = drop;
      if (drop > BUILDING_PAD.skirtDepth) over++;
    }
  }
  return { worst, sampled, over };
}

/* ==========================================================================
 * SHOWCASE
 * ========================================================================== */

function paradeRequested(): boolean {
  if (typeof location === 'undefined') return false;
  return new URLSearchParams(location.search).has('parade');
}

/**
 * A deterministic display rack: every structure, one per slot, on a grid
 * pitched at 1.35x the widest. Exists so a visual critic can score silhouette,
 * bevel, team-colour coverage and greeble density from one screenshot without
 * a running match.
 */
function buildParade(scene: THREE.Scene, models: StructureModel[]): THREE.Group {
  const root = new THREE.Group();
  root.name = 'buildingParade';

  let pitch = 0;
  for (const m of models) pitch = Math.max(pitch, m.bounds[0], m.bounds[2]);
  pitch *= 1.35;

  const cols = 6;
  const cx = MAP_SIZE * 0.5, cz = MAP_SIZE * 0.5;
  models.forEach((m, i) => {
    const col = i % cols, row = (i / cols) | 0;
    const obj = m.prototype();
    obj.position.set(
      cx + (col - (cols - 1) * 0.5) * pitch,
      0,
      cz + (row - 1.5) * pitch,
    );
    root.add(obj);
  });

  scene.add(root);
  return root;
}

let paradeRoot: THREE.Group | null = null;

/* ==========================================================================
 * THE SYSTEM
 * ========================================================================== */

export default defineSystem({
  id: 'art.buildings',
  renderPhase: RenderPhase.BuildingAnim,
  order: 0,

  async init(): Promise<void> {
    const { sceneRig, loop, world, debug } = ctx();
    const size = atlasSizeFor(loop.quality);
    const t0 = Date.now();

    const built: StructureModel[] = [];
    const failed: string[] = [];
    for (const list of STRUCTURE_MASS_LISTS) {
      try {
        built.push(buildingLibrary.build(list, palettesFor(list.faction), size));
      } catch (err) {
        // One bad mass list must not take the whole roster down with it.
        failed.push(`${list.key}: ${String(err)}`);
      }
    }

    const g = globalThis as unknown as BuildingGlobal;
    g.__vmBuildings = buildingLibrary;

    /* -- hand off to RenderBridge ------------------------------------------ */
    // One KindMesh per model, cached: handing the SAME object to two factions
    // is how the bridge knows they can share one batch.
    const meshes = new Map<string, KindMesh>();
    const meshFor = (key: string): KindMesh | null => {
      const model = buildingLibrary.get(key);
      if (model === undefined) return null;
      let mesh = meshes.get(key);
      if (mesh === undefined) { mesh = toKindMesh(model); meshes.set(key, mesh); }
      return mesh;
    };

    let registered = 0;
    const register = (faction: Faction | typeof FACTION_ANY, key: string, defId: number): void => {
      const mesh = meshFor(key);
      if (mesh === null) return;
      registerKindMesh(EntityKind.Building, faction, mesh, defId);
      registered++;
    };

    // (a) per-faction defaults. Without these every structure spawned before a
    //     def table exists draws the bridge's hazard box.
    register(Faction.Allies, DEFAULT_KEY.allies, -1);
    register(Faction.Soviets, DEFAULT_KEY.soviets, -1);
    // Neutral structures borrow Allied architecture. A third atlas for civilian
    // paint would cost 4 textures and a material for buildings nobody fights
    // over; the cobalt slabs are the price, and they are the smaller error
    // against a hazard-striped box.
    register(Faction.Neutral, DEFAULT_KEY.allies, -1);

    // (b) exact per-def registrations, the moment a def table exists.
    const binding = await resolveDefBinding();
    let bound = 0;
    for (const [contentKey, pair] of Object.entries(SHARED_KEYS)) {
      const defId = binding.buildingId[contentKey];
      if (defId === undefined || defId < 0) continue;
      register(Faction.Allies, pair[0], defId);
      register(Faction.Soviets, pair[1], defId);
      register(Faction.Neutral, pair[0], defId);
      bound++;
    }
    for (const [contentKey, modelKey] of Object.entries(FACTION_KEYS)) {
      const defId = binding.buildingId[contentKey];
      if (defId === undefined || defId < 0) continue;
      // FACTION_ANY: the content key already decides the army, and registering
      // per faction here would mask the (kind, faction, -1) defaults.
      register(FACTION_ANY, modelKey, defId);
      bound++;
    }

    /* -- prove the pads meet the ground ------------------------------------ */
    let padLine = '[buildings] pad contact: no terrain to measure against';
    const terrain = world.terrain;
    if (terrain !== null && terrain !== undefined) {
      const c = measurePadContact(terrain);
      padLine =
        `[buildings] pad contact: worst 12 m relief on a buildable cell is ` +
        `${c.worst.toFixed(2)} m against a ${BUILDING_PAD.skirtDepth.toFixed(2)} m skirt ` +
        `(${c.sampled} sites sampled, ${c.over} over)`;
      if (c.over > 0) {
        console.warn(
          `[buildings] ${c.over} buildable sites have more relief than the pad skirt can ` +
          `bury; raise BUILDING_PAD.skirtDepth to at least ${(c.worst + 0.3).toFixed(2)} m`);
      }
    }

    /* -- the report the critic loop reads ---------------------------------- */
    let tris = 0, parts = 0;
    for (const m of built) { tris += m.stats.triangles; parts += m.stats.parts; }
    console.info(
      `%c[buildings]%c ${built.length}/${STRUCTURE_MASS_LISTS.length} structures, ` +
      `${buildingLibrary.materialCount()} materials, ${tris} tris, ${parts} draw calls if every ` +
      `structure is on screen at once, ${registered} bridge registrations, atlas ${size}px, ` +
      `${Date.now() - t0} ms`,
      'color:#fd7', 'color:inherit',
    );
    for (const m of built) console.info(`[buildings] ${formatStructureStats(m.stats)}`);
    for (const a of buildingLibrary.atlasList()) {
      console.info(
        `[buildings] atlas ${a.spec.key}: Sobel ${(a.metrics.paintEdgeCoverage * 100).toFixed(1)}% ` +
        `over the paint tiles, gen ${a.metrics.generateMs} ms`);
    }
    console.info(padLine);
    if (bound === 0) {
      console.warn(
        '[buildings] no building def table resolved, so every structure carries defId -1 and ' +
        'each army draws its Construction Yard for everything. Publishing a DefTables from ' +
        'src/data/** binds all 24 models on the next boot with no change here.');
    }
    for (const f of failed) console.error(`[buildings] REJECTED ${f}`);

    debug.counters.structModels = built.length;
    debug.counters.structDraws = parts;

    if (paradeRequested()) paradeRoot = buildParade(sceneRig.scene, built);
  },

  /**
   * The entire per-frame cost of every animated structure on the map.
   *
   * Construction rise, bay doors, radar sweep, damage soot, interior fire and
   * the selection pulse are all per-instance shader effects driven by this one
   * uniform plus `aState`, which the bridge already writes. Adding a structure
   * to the map adds nothing here.
   */
  frame(r: RenderContext): void {
    buildingTime.value = r.time;
  },

  dispose(): void {
    if (paradeRoot !== null) {
      paradeRoot.removeFromParent();
      paradeRoot = null;
    }
    const g = globalThis as unknown as BuildingGlobal;
    delete g.__vmBuildings;
    buildingLibrary.dispose();
  },
});
