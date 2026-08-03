/**
 * ============================================================================
 * RED ALERT — src/art/units.system.ts
 * ============================================================================
 * The plugin entry point for the unit-art module.
 *
 * WHAT IT DOES AT BOOT
 *   1. Picks an atlas size from the quality tier.
 *   2. Generates one greeble atlas per faction (3 textures each + emissive).
 *   3. Builds all 18 mass lists into merged geometries, validating each against
 *      R8/R12 and REJECTING anything that misses.
 *   4. Publishes them on `unitLibrary` and hands them to RenderBridge.
 *   5. Prints the scorecard line for every unit, so the critic loop has numbers
 *      instead of opinions.
 *
 * HANDING OFF TO RenderBridge
 * ---------------------------
 * `registerKindMesh(kind, faction, mesh, defId)` is the bridge's registration
 * call and it is valid before or after the bridge itself has init'd, so this
 * module does not care about phase ordering. Two passes:
 *
 *   a. a DEFAULT per (EntityKind, Faction) at defId -1, so an entity spawned
 *      before the content tables exist still gets real art instead of the
 *      hazard box;
 *   b. an EXACT registration per content key once `resolveDefBinding()` has a
 *      def table, so a Prism Tank stops borrowing the Guardian's hull.
 *
 * `unitLibrary` stays the direct surface for anything that wants the geometry
 * itself (cameo baking, a wreck module, the harness).
 *
 * There is no scene object created by this module in normal operation. `?parade`
 * adds a static display rack for isolating unit art from scenario code.
 * ============================================================================
 */

import * as THREE from 'three';
import { defineSystem } from '../core/loop';
import { QUALITY_PRESETS, RA3_UNIT_PALETTE, UNIT_GREEBLE, MAP_SIZE, type UnitPalette } from '../core/config';
import { EntityKind, Faction, PartId, type QualityTier } from '../core/types';
import { ctx } from '../game/context';
import { resolveDefBinding } from '../game/Scenarios';
import { FACTION_ANY, registerKindMesh, type KindMesh, type SocketSpec } from '../render/RenderBridge';
import { formatStats } from './MassList';
import { UNIT_MASS_LISTS } from './UnitDefs';
import { unitLibrary, type UnitModel } from './UnitFactory';

interface BridgeGlobal { __raUnits?: unknown; }

/**
 * Content key -> model key. The content vocabulary is another module's, so this
 * is the one place the two namespaces meet; an unmapped content key falls back
 * to the per-faction default below rather than to a hazard box.
 */
const CONTENT_TO_MODEL: Readonly<Record<string, string>> = {
  gi: 'allied_rifle',
  engineer: 'allied_engineer',
  grizzly: 'allied_guardian',
  ifv: 'allied_ifv',
  prismTank: 'allied_prism',
  gunboat: 'allied_destroyer',
  destroyer: 'allied_destroyer',

  conscript: 'soviet_conscript',
  attackDog: 'soviet_conscript',
  rhino: 'soviet_rhino',
  apocalypse: 'soviet_rhino',
  submarine: 'soviet_dreadnought',
  dreadnought: 'soviet_dreadnought',

};

/**
 * Content keys whose def is faction-NEUTRAL — one `defId` serves both armies.
 * These cannot go in the table above: that one registers at `FACTION_ANY`, and
 * a FACTION_ANY entry for `harvester` would hand the Soviets the Allied hull
 * and leave `soviet_harvester` / `soviet_dozer` built but never drawn. Two
 * per-faction registrations at the same defId resolve ahead of it instead
 * (the bridge tries (kind, faction, defId) before (kind, ANY, defId)).
 */
const SHARED_CONTENT_TO_MODEL: Readonly<Record<string, readonly [string, string]>> = {
  //           [ allied model,       soviet model      ]
  harvester:   ['allied_harvester',  'soviet_harvester'],
  mcv:         ['allied_dozer',      'soviet_dozer'],
  transport:   ['allied_harvester',  'soviet_harvester'],
};

/** The model each (kind, faction) falls back to when a defId is unknown. */
const DEFAULTS: readonly { kind: EntityKind; faction: Faction; key: string }[] = [
  { kind: EntityKind.Infantry, faction: Faction.Allies, key: 'allied_rifle' },
  { kind: EntityKind.Infantry, faction: Faction.Soviets, key: 'soviet_conscript' },
  { kind: EntityKind.Infantry, faction: Faction.Neutral, key: 'allied_engineer' },
  { kind: EntityKind.Vehicle, faction: Faction.Allies, key: 'allied_guardian' },
  { kind: EntityKind.Vehicle, faction: Faction.Soviets, key: 'soviet_rhino' },
  { kind: EntityKind.Vehicle, faction: Faction.Neutral, key: 'allied_harvester' },
];

/**
 * Translate a built model into the bridge's shape.
 *
 * Sockets go over in MODEL space (the bridge's stated convention) with
 * `pivotY` set on the turret-riding ones, so an elevating barrel swings its
 * muzzle about the trunnion instead of about the model origin.
 */
function toKindMesh(m: UnitModel): KindMesh {
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
  return {
    geometry: m.hull,
    material: m.material,
    parts: m.turret === null ? undefined : [{
      geometry: m.turret,
      material: m.material,
      x: m.turretPivot[0], y: m.turretPivot[1], z: m.turretPivot[2],
      followsTurret: true,
      part: PartId.Turret,
      castShadow: true,
      receiveShadow: true,
    }],
    sockets,
    turretPivotY: m.turretPivot[1],
    castShadow: true,
    receiveShadow: true,
  };
}

/** 256 on Low, 512 everywhere else: 1024 buys nothing at RTS unit size. */
function atlasSizeFor(tier: QualityTier): number {
  const preset = QUALITY_PRESETS[tier] ?? QUALITY_PRESETS[2];
  return Math.min(UNIT_GREEBLE.atlasSize, Math.max(256, preset.textureSize));
}

function paletteFor(faction: UnitModel['faction']): UnitPalette {
  return RA3_UNIT_PALETTE[faction];
}

/** Fixed per-faction generator seeds. Deterministic, so atlases are diffable. */
const ATLAS_SEED: Record<UnitModel['faction'], number> = {
  allies: 0x41_11,
  soviets: 0x50_77,
  neutral: 0x4e_11,
};

/** True when the URL asks for the static display rack. Never true in a match. */
function paradeRequested(): boolean {
  if (typeof location === 'undefined') return false;
  return new URLSearchParams(location.search).has('parade');
}

let paradeRoot: THREE.Group | null = null;

/**
 * A deterministic display rack: every unit, one per slot, facing the camera's
 * default yaw, on a grid pitched at 1.4x the widest unit. Exists so a visual
 * critic can score silhouette, bevel, team-colour coverage and greeble density
 * from one screenshot without a running match.
 */
function buildParade(scene: THREE.Scene, models: UnitModel[]): THREE.Group {
  const root = new THREE.Group();
  root.name = 'unitParade';

  let pitch = 0;
  for (const m of models) pitch = Math.max(pitch, m.bounds[0], m.bounds[2]);
  pitch *= 1.35;

  const cols = 5;
  const cx = MAP_SIZE * 0.5, cz = MAP_SIZE * 0.5;
  models.forEach((m, i) => {
    const col = i % cols, row = (i / cols) | 0;
    const obj = m.prototype();
    obj.position.set(
      cx + (col - (cols - 1) * 0.5) * pitch,
      0,
      cz + (row - 1.5) * pitch,
    );
    // A fixed quarter-turn so both the flank slabs and the glacis read.
    obj.rotation.y = Math.PI * 0.25;
    root.add(obj);
  });

  scene.add(root);
  return root;
}

export default defineSystem({
  id: 'art.units',

  async init(): Promise<void> {
    const { sceneRig, loop } = ctx();
    const size = atlasSizeFor(loop.quality);
    const t0 = Date.now();

    const built: UnitModel[] = [];
    const failed: string[] = [];
    for (const list of UNIT_MASS_LISTS) {
      try {
        // The seed is per FACTION, not per unit: one atlas serves the army, and
        // a per-unit seed would fork the spec hash into 18 atlases.
        const seed = ATLAS_SEED[list.faction];
        built.push(unitLibrary.build(list, paletteFor(list.faction), size, seed));
      } catch (err) {
        // One bad mass list must not take the whole roster (and with it the
        // whole render) down; it is loud, skipped, and reported.
        failed.push(`${list.key}: ${String(err)}`);
      }
    }

    /* -- hand off to RenderBridge ------------------------------------------ */
    const g = globalThis as unknown as BridgeGlobal;
    g.__raUnits = unitLibrary;

    // One KindMesh per model, cached: handing the SAME object to two factions
    // is how the bridge knows they can share one batch.
    const meshes = new Map<string, KindMesh>();
    const meshFor = (key: string): KindMesh | null => {
      const model = unitLibrary.get(key);
      if (model === undefined) return null;
      let mesh = meshes.get(key);
      if (mesh === undefined) { mesh = toKindMesh(model); meshes.set(key, mesh); }
      return mesh;
    };

    // (a) per-faction defaults at defId -1. Entities spawned before the content
    //     tables exist carry defId -1, so without this every unit in every
    //     scenario would draw as the bridge's hazard box.
    let registered = 0;
    for (const d of DEFAULTS) {
      const mesh = meshFor(d.key);
      if (mesh === null) continue;
      registerKindMesh(d.kind, d.faction, mesh, -1);
      registered++;
    }

    // (b) exact per-def registrations, the moment a def table exists.
    const binding = await resolveDefBinding();
    let bound = 0;
    const bind = (defId: number, modelKey: string, faction: Faction | typeof FACTION_ANY): void => {
      const mesh = meshFor(modelKey);
      const model = unitLibrary.get(modelKey);
      if (mesh === null || model === undefined) return;
      const kind = model.cls === 'infantry' ? EntityKind.Infantry : EntityKind.Vehicle;
      registerKindMesh(kind, faction, mesh, defId);
      registered++;
    };

    for (const [contentKey, modelKey] of Object.entries(CONTENT_TO_MODEL)) {
      const defId = binding.unitId[contentKey];
      if (defId === undefined || defId < 0) continue;
      // FACTION_ANY: the content key already decides the army, and registering
      // per faction here would mask the (kind, faction, -1) defaults.
      bind(defId, modelKey, FACTION_ANY);
      bound++;
    }
    for (const [contentKey, pair] of Object.entries(SHARED_CONTENT_TO_MODEL)) {
      const defId = binding.unitId[contentKey];
      if (defId === undefined || defId < 0) continue;
      bind(defId, pair[0], Faction.Allies);
      bind(defId, pair[1], Faction.Soviets);
      bind(defId, pair[0], Faction.Neutral);
      bound++;
    }
    if (bound === 0) {
      console.warn(
        '[units] no unit def table resolved, so every unit carries defId -1 and each army ' +
        'draws ONE model for its whole roster. src/data/Defs.ts is what binds these.');
    }

    /* -- the report the critic loop reads ---------------------------------- */
    const atlases = unitLibrary.materialCount();
    let tris = 0;
    for (const m of built) tris += m.stats.triangles;
    console.info(
      `%c[units]%c ${built.length}/${UNIT_MASS_LISTS.length} models, ${atlases} materials, ` +
      `${tris} tris, ${registered} bridge registrations, atlas ${size}px, ${Date.now() - t0} ms`,
      'color:#7fd', 'color:inherit',
    );
    for (const m of built) console.info(`[units] ${formatStats(m.stats)}`);
    const reported = new Set<string>();
    for (const m of built) {
      if (reported.has(m.atlas.key)) continue;
      reported.add(m.atlas.key);
      console.info(
        `[units] atlas ${m.faction}: Sobel ${(m.atlas.metrics.paintEdgeCoverage * 100).toFixed(1)}% ` +
        `(scorecard #34 wants 28-36%), gen ${m.atlas.metrics.generateMs} ms`);
    }
    for (const f of failed) console.error(`[units] REJECTED ${f}`);

    if (paradeRequested()) paradeRoot = buildParade(sceneRig.scene, built);
  },

  dispose(): void {
    if (paradeRoot !== null) {
      paradeRoot.removeFromParent();
      paradeRoot = null;
    }
    const g = globalThis as unknown as BridgeGlobal;
    delete g.__raUnits;
    unitLibrary.dispose();
  },
});
