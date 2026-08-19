/**
 * ============================================================================
 * VOLTMARCH — src/art/units.system.ts
 * ============================================================================
 * The plugin entry point for the unit-art module.
 *
 * WHAT IT DOES AT BOOT
 *   1. Picks an atlas size from the quality tier.
 *   2. Generates one greeble atlas per faction (3 textures each + emissive).
 *   3. Builds every list in `UNIT_MASS_LISTS` into a merged geometry, validating
 *      each against R8/R12 and REJECTING anything that misses. (This said "all
 *      18 mass lists" against a roster that has been 26 for several releases and
 *      is 27 now — a count in prose is a claim that rots on the next unit, and
 *      the boot line already prints the real figure.)
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
 *      def table, so a Refractor Tank stops borrowing the Guardian's hull.
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
import { resolveDefBinding, type DefBinding } from '../game/Scenarios';
import { FACTION_ANY, registerKindMesh, type KindMesh, type SocketSpec } from '../render/RenderBridge';
import { ARMY_ORDER, GAIA_SLOT, type PerArmy } from './faction-models';
import { formatStats } from './MassList';
import { UNIT_MASS_LISTS } from './UnitDefs';
import { unitLibrary, type UnitModel } from './UnitFactory';

interface BridgeGlobal { __vmUnits?: unknown; }

/**
 * Content key -> model key, for defs ONE ARMY OWNS.
 *
 * The content vocabulary is another module's, so this is the one place the two
 * namespaces meet; an unmapped content key falls back to the per-faction default
 * below rather than to a hazard box.
 *
 * EVERY KEY IN HERE MUST NAME A DEF WITH A REAL `faction`, because the whole
 * table registers at `FACTION_ANY` — see the bind loop. `engineer` used to sit
 * on the line below `javelin` and it is a `Faction.Neutral` def that BOTH
 * original armies build, so every Soviet barracks turned out a plated Allied
 * technician. That is the same defect `SHARED_CONTENT_TO_MODEL`'s own header
 * describes for `harvester`, one table over, and it survived because nothing
 * checked which table a key belonged in. Something does now: `assertNoSharedDefs`
 * at the bottom of `init`, and `tests/faction-models-distinct.spec.ts`.
 */
export const CONTENT_TO_MODEL: Readonly<Record<string, string>> = {
  gi: 'allied_rifle',
  javelin: 'allied_javelin',
  fieldMarshal: 'allied_marshal',
  grizzly: 'allied_guardian',
  ifv: 'allied_ifv',
  prismTank: 'allied_prism',
  gunboat: 'allied_gunboat',
  destroyer: 'allied_destroyer',
  // `allied_vindicator` and `soviet_mig` are the SECOND and THIRD models this
  // table has been the missing half of. Both have been in `UNIT_MASS_LISTS`
  // since the roster was authored — merged, silhouette-validated and printed in
  // the boot scorecard on every single boot — with no def row and no line here.
  // See `flakTrooper` below: same defect, same fix, three files apart.
  vindicator: 'allied_vindicator',
  hydrofoil: 'allied_hydrofoil',
  landingCraft: 'allied_lighter',
  frogman: 'allied_frogman',

  conscript: 'soviet_conscript',
  // `soviet_flak` was built into every match and bound to nothing until the
  // Flak Trooper got a def row. It was not a missing model; it was a missing
  // line in this table.
  flakTrooper: 'soviet_flak',
  commissar: 'soviet_commissar',
  attackDog: 'soviet_dog',
  rhino: 'soviet_rhino',
  apocalypse: 'soviet_apocalypse',
  submarine: 'soviet_sub',
  dreadnought: 'soviet_dreadnought',
  mig: 'soviet_mig',
  picketBoat: 'soviet_picket',
  assaultBarge: 'soviet_lighter',
  navalInfantry: 'soviet_diver',
};

/**
 * Content keys that are INFANTRY in the sim whatever their model class says.
 *
 * `bind` normally infers the entity kind from `UnitModel.cls`, and the Attack
 * Dog is authored `cls: 'walker'` on purpose: `validateUnit` holds `'infantry'`
 * to R-S4's 2.1-2.7 m height band, which a dog cannot meet without becoming a
 * bear. Without this set it would register as a Vehicle and resolve against the
 * vehicle default.
 */
const INFANTRY_CONTENT: ReadonlySet<string> = new Set([
  'gi', 'engineer', 'conscript', 'attackDog',
  'javelin', 'flakTrooper',
  'fieldMarshal', 'commissar',
  'mrdWayfarer', 'mrdSunlancer', 'mrdArtificer',
]);

/**
 * "This army does not draw this def" — it reaches the ROLE through its own def
 * key, in its own art module, out of its own private library.
 *
 * NOT THE SAME AS LEAVING THE ARMY OUT, and that difference is the whole fix.
 * An absent row and a wrong row are indistinguishable at the point of failure:
 * both end with the bridge falling through to somebody else's model, in
 * silence, on a battlefield. A row that says `OWN_ROSTER` says go and read the
 * other module — and `tests/faction-models-distinct.spec.ts` checks the claim
 * rather than taking it, because that army really must resolve the role
 * somewhere, and to a DIFFERENT model.
 */
const OWN_ROSTER = null;

/**
 * Which model each army draws for one def, in `ARMY_ORDER`.
 *
 * THE ARITY IS THE MECHANISM. This was `readonly [string, string]` — a
 * hand-written pair, `[allied, soviet]` — with no slot for a third army and no
 * way to notice one was missing. `PerArmy` is DERIVED from `ARMY_ORDER`, so a
 * fifth army turns every literal below into a compile error until somebody
 * says, per def, what it draws. See `src/art/faction-models.ts`.
 */
type SharedModels = PerArmy<string | typeof OWN_ROSTER>;

/**
 * Content keys whose def is faction-NEUTRAL — one `defId` serves more than one
 * army.
 *
 * These cannot go in the table above: that one registers at `FACTION_ANY`, and
 * a FACTION_ANY entry for `harvester` would hand the Soviets the Allied hull
 * and leave `soviet_harvester` / `soviet_dozer` built but never drawn. Two
 * per-faction registrations at the same defId resolve ahead of it instead
 * (the bridge tries (kind, faction, defId) before (kind, ANY, defId)).
 *
 * `engineer` IS IN HERE NOW. It was in the FACTION_ANY table — the exact hazard
 * the paragraph above describes, on the one def where it was reachable — and it
 * is the report *"the engineers among factions have all the same skin"*.
 * `soviet_engineer` is the model that had to be authored to close it; the other
 * three rows already had both halves built.
 *
 * The Pact and the Reclamation take `OWN_ROSTER` on all four rows, because both
 * are complete parallel trees down to their own construction yards: their
 * barracks builds `mrdArtificer` / `rclTinker`, their factory builds
 * `mrdCarryall` / `rclCrawler`, and neither can reach a `Faction.Neutral` def
 * at all. `src/sim/Production.ts#SHARED_POOL_FACTIONS` is the sim-side
 * statement of the same fact, and `src/game/Scenarios.ts#FACTION_KEY_MAP` the
 * scenario-side one.
 */
export const SHARED_CONTENT_TO_MODEL: Readonly<Record<string, SharedModels>> = {
  //           [ allies,              soviets,             meridian,    reclaim   ]
  engineer:    ['allied_engineer',   'soviet_engineer',   OWN_ROSTER,  OWN_ROSTER],
  harvester:   ['allied_harvester',  'soviet_harvester',  OWN_ROSTER,  OWN_ROSTER],
  mcv:         ['allied_dozer',      'soviet_dozer',      OWN_ROSTER,  OWN_ROSTER],
  transport:   ['allied_transport',  'soviet_transport',  OWN_ROSTER,  OWN_ROSTER],
};

/**
 * THE TRIPWIRE FOR THE CLASS OF BUG, not for the one instance of it.
 *
 * `CONTENT_TO_MODEL` registers at `FACTION_ANY`, which is correct for a def
 * exactly one army can build and WRONG for a `Faction.Neutral` def, because a
 * Neutral def is one row that several armies build and one wildcard entry
 * answers for all of them. That is how the Soviet engineer came to be an Allied
 * engineer for the whole life of the module.
 *
 * The two tables cannot tell the difference by themselves — a content key is a
 * string in both — so the answer has to come from the def table, which arrives
 * at `init` and only at `init`. A `console.error`, not a throw: a wrong model
 * is a bad picture and the match must still run. `tests/faction-models-distinct.spec.ts`
 * is the copy of this check that goes red in the gate.
 */
function assertNoSharedDefs(binding: DefBinding): void {
  const tables = binding.tables;
  if (tables === null) return;
  const shared: string[] = [];
  for (const contentKey of Object.keys(CONTENT_TO_MODEL)) {
    const defId = binding.unitId[contentKey];
    if (defId === undefined || defId < 0) continue;
    if (tables.units[defId]?.faction === Faction.Neutral) shared.push(contentKey);
  }
  if (shared.length === 0) return;
  console.error(
    `[units] ${shared.join(', ')} ${shared.length === 1 ? 'is a' : 'are'} Faction.Neutral def(s) ` +
    'registered at FACTION_ANY, so EVERY army that builds one draws the same model. ' +
    'Move the key to SHARED_CONTENT_TO_MODEL and give each army its own row.');
}

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

    // ATLASES FIRST, OFF-THREAD. Same argument as `art.buildings`: the two unit
    // atlases cost ~440 ms of unbroken main-thread time (allies 217, soviets
    // 225, from the boot log) and the loading curtain cannot animate through it.
    // The `build` loop below is unchanged and stays synchronous — every atlas it
    // asks for is a cache hit, so `validateUnit`'s detail-coverage and speckle
    // gates still run against real numbers at the moment they always did.
    //
    // One prewarm per FACTION, matching the seeding rule the loop relies on.
    const factions = [...new Set(UNIT_MASS_LISTS.map((l) => l.faction))];
    const warmedCounts = await Promise.all(factions.map(
      (f) => unitLibrary.prewarm(f, paletteFor(f), size, ATLAS_SEED[f]),
    ));
    const warmed = warmedCounts.reduce((a, b) => a + b, 0);

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
    g.__vmUnits = unitLibrary;

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
    const bind = (
      defId: number, modelKey: string, faction: Faction | typeof FACTION_ANY, contentKey: string,
    ): void => {
      const mesh = meshFor(modelKey);
      const model = unitLibrary.get(modelKey);
      if (mesh === null || model === undefined) return;
      const kind = model.cls === 'infantry' || INFANTRY_CONTENT.has(contentKey)
        ? EntityKind.Infantry
        : EntityKind.Vehicle;
      registerKindMesh(kind, faction, mesh, defId);
      registered++;
    };

    for (const [contentKey, modelKey] of Object.entries(CONTENT_TO_MODEL)) {
      const defId = binding.unitId[contentKey];
      if (defId === undefined || defId < 0) continue;
      // FACTION_ANY: the content key already decides the army, and registering
      // per faction here would mask the (kind, faction, -1) defaults.
      bind(defId, modelKey, FACTION_ANY, contentKey);
      bound++;
    }
    for (const [contentKey, models] of Object.entries(SHARED_CONTENT_TO_MODEL)) {
      const defId = binding.unitId[contentKey];
      if (defId === undefined || defId < 0) continue;
      // ONE REGISTRATION PER ARMY THAT DRAWS THE DEF, and none for an army that
      // does not — an `OWN_ROSTER` army must fall through to the model its own
      // module bound, not to whatever this loop happened to register first.
      ARMY_ORDER.forEach((f, i) => {
        const modelKey = models[i];
        if (modelKey === OWN_ROSTER) return;
        bind(defId, modelKey, f, contentKey);
      });
      // Gaia owns entities without being an army; `GAIA_SLOT` names which row
      // it reads instead of leaving it as "slot 0 of a tuple".
      const gaia = models[GAIA_SLOT];
      if (gaia !== OWN_ROSTER) bind(defId, gaia, Faction.Neutral, contentKey);
      bound++;
    }
    assertNoSharedDefs(binding);
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
      // `warmed` is printed even at 0 — see the note on the same figure in
      // `buildings.system.ts`. A silent fallback to the main thread must not
      // look identical to a working offload.
      `${tris} tris, ${registered} bridge registrations, atlas ${size}px, ` +
      `${warmed} atlas(es) off-thread, ${Date.now() - t0} ms`,
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
    delete g.__vmUnits;
    unitLibrary.dispose();
  },
});
