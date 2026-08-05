/**
 * ============================================================================
 * VOLTMARCH — src/render/RenderBridge.ts
 * ============================================================================
 * THE SIM->RENDER SEAM. Nothing the simulation owns is visible without this.
 *
 * Once per rendered frame it walks `EntityStore.alive`, interpolates each
 * entity's transform between the previous and current sim tick, and composes
 * the 16 matrix floats STRAIGHT into the InstancedMesh buffer. There is no
 * per-entity `Object3D`, no `Matrix4`, no `Quaternion` — 250 units at 60 fps
 * cannot afford 250 scene-graph nodes with their own `updateMatrixWorld`.
 *
 * FOUR THINGS THIS FILE IS RESPONSIBLE FOR
 * ----------------------------------------
 * 1. INTERPOLATION. The sim runs at 30 Hz; the screen runs at 60-144. Position
 *    is a plain lerp, but yaw and turretYaw take the SHORTEST ARC (`lerpAngle`),
 *    because a turret crossing the +/-PI seam with a naive lerp spins 350
 *    degrees the wrong way in one frame — the single most obvious render bug in
 *    an RTS.
 * 2. BINDING. Entity slot -> (model entry, instance slot), generation-stamped so
 *    a recycled entity slot can never inherit the dead unit's instance.
 * 3. MODEL RESOLUTION. `registerKindMesh` is what an art module calls. A kind
 *    with no art yet gets a hazard-striped PLACEHOLDER at real WorldScale
 *    dimensions, so an unfinished module shows up as a visible gap instead of
 *    an invisible entity that everyone assumes is a physics bug.
 * 4. SOCKETS. `InstancedMesh` cannot have children, so a muzzle flash cannot be
 *    parented to a moving tank barrel. `socketWorld()` is the ONLY way VFX and
 *    audio can find the world-space muzzle/exhaust/turret-tip of an instanced
 *    unit. It reads the same interpolated transform the mesh was drawn with, so
 *    the flash is never a frame behind the gun.
 *
 * ANGLE CONVENTIONS (normative for everything downstream)
 * -------------------------------------------------------
 *  - `yaw` / `turretYaw`: 0 faces +Z, increasing toward +X (core/types.ts).
 *  - `hullPitch` / `barrelPitch`: POSITIVE RAISES THE +Z-FACING NOSE/MUZZLE.
 *    Implemented as Euler-X of `-pitch`, so "gun elevation" reads the way its
 *    name promises.
 *  - `hullRoll`: positive rolls the +X side down (Euler-Z, Three's convention).
 *  - Composition is Euler order YXZ: R = Ry(yaw) * Rx(-pitch) * Rz(roll).
 *
 * ZERO ALLOCATION. Every buffer in this file is allocated once at construction.
 * The per-frame path touches typed arrays and numbers only — no closures, no
 * temporary vectors, no string keys (model lookup keys are packed integers).
 * ============================================================================
 */

import * as THREE from 'three';

import {
  CELL,
  DEFAULT_ART,
  MAX_ENTITIES,
  PLACEHOLDER_BODY_MUL,
  PLACEHOLDER_HAZARD_COLOR,
  PLACEHOLDER_MIN_RISE,
  PLACEHOLDER_SELECT_EMISSIVE,
  PLACEHOLDER_STRIPE_METRES,
  STOREY,
  UNIT_DIMENSIONS,
} from '../core/config';
import {
  EntityFlag,
  EntityKind,
  ENTITY_KIND_COUNT,
  Faction,
  FACTION_COUNT,
  FACTION_PALETTE_KEYS,
  PART_ID_COUNT,
  PartId,
  handleGen,
  handleIndex,
} from '../core/types';
import type { EntityId } from '../core/types';
import { clamp01, hexToLinearRgb, lerpAngle } from '../core/math';
import type { EntityStore } from '../core/world';

import { InstanceBatcher, type BatchPartSpec, type InstanceBatch } from './InstanceBatcher';
import { LAYERS } from './scene';

/* ==========================================================================
 * 1. REGISTRATION SURFACE — what an art module calls
 * ========================================================================== */

/** Pass as `faction` to register one model for every army. */
export const FACTION_ANY = -1;

/**
 * A named local-space anchor VFX and audio can query at runtime.
 * Coordinates are metres from the MODEL ORIGIN (ground-plane centre, +Z fwd).
 */
export interface SocketSpec {
  part: PartId;
  x: number;
  y: number;
  z: number;
  /** Extra yaw of the socket's own axis relative to its part. Default 0. */
  yaw?: number;
  /** Extra elevation. Positive raises. Default 0. */
  pitch?: number;
  /** True for anything mounted on the turret (muzzles, coil tips). */
  followsTurret?: boolean;
  /**
   * Y of the rotation pivot this socket hangs from — the turret ring height.
   * Without it a barrel elevating 15 degrees would swing its muzzle about the
   * model origin instead of about the trunnion, and the flash would sit a
   * metre behind the gun. Defaults to `KindMesh.turretPivotY`.
   */
  pivotY?: number;
}

/** One extra drawable beyond the model's root body: a turret, a barrel, a dish. */
export interface KindMeshPart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
  /** Local offset from the model origin, metres. */
  x?: number;
  y?: number;
  z?: number;
  /** True when this piece slews with the turret rather than the hull. */
  followsTurret?: boolean;
  /** `PartId.Barrel` additionally takes `barrelPitch`. */
  part?: PartId;
  castShadow?: boolean;
  receiveShadow?: boolean;
}

/**
 * Everything the bridge needs to draw one model.
 *
 * Hand the SAME object to two factions and they share ONE batch — team colour
 * is a per-instance attribute, so a shared silhouette must never cost a second
 * draw call.
 */
export interface KindMesh {
  /** The root body. Rotates with the hull. */
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
  /** Turret / barrel / dish / stack. Empty for a one-piece model. */
  parts?: readonly KindMeshPart[];
  /** Muzzles, exhausts, dock points. */
  sockets?: readonly SocketSpec[];
  part?: PartId;
  castShadow?: boolean;
  receiveShadow?: boolean;
  /** Default turret ring height, metres. Used by sockets that omit `pivotY`. */
  turretPivotY?: number;
}

/* ==========================================================================
 * 2. MODEL REGISTRY (module-level, valid before and after init)
 *
 * Art modules `init()` in registry phase order, which may put them before or
 * after this module. So registration must never depend on the bridge existing:
 * it fills a plain map, and batches are built lazily the first frame an entity
 * actually needs one.
 * ========================================================================== */

interface ResolvedSocket {
  part: PartId;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  followsTurret: boolean;
  pivotY: number;
}

interface ModelEntry {
  index: number;
  specs: BatchPartSpec[];
  sockets: ResolvedSocket[];
  /** PartId -> index into `sockets`, or -1. */
  socketByPart: Int32Array;
  /** Built on first use, because it needs the scene. */
  batch: InstanceBatch | null;
  /** True for the generated hazard box, so the bridge applies footprint scale. */
  placeholder: boolean;
  kind: EntityKind;
  name: string;
}

const entries: ModelEntry[] = [];
/** Packed key -> entry. See `packKey`. */
const byKey = new Map<number, ModelEntry>();
/** KindMesh identity -> entry, so one mesh shared by two factions is one batch. */
const byMesh = new Map<KindMesh, ModelEntry>();
/** Per-kind placeholders, built on demand. */
const placeholders: (ModelEntry | null)[] = new Array(ENTITY_KIND_COUNT).fill(null);
/** Bumped on every registration so bound entities re-resolve on the next frame. */
let registryVersion = 1;

/**
 * Faction slots 0..FACTION_COUNT-1 are real armies; the last slot is the
 * "any army" wildcard.
 *
 * Derived from FACTION_COUNT rather than hard-coded: when the Meridian Pact
 * took id 3 the old literal `3` wildcard silently ALIASED it, so every Pact
 * model registered as a wildcard and the first army to register a mesh for a
 * given (kind, defId) won for everyone.
 */
const FACTION_SLOTS = FACTION_COUNT + 1;

function factionSlot(faction: number): number {
  return faction < 0 || faction >= FACTION_COUNT ? FACTION_COUNT : faction;
}

/** Pack (kind, faction, defId) into one integer so lookups never build a string. */
function packKey(kind: EntityKind, faction: number, defId: number): number {
  return (((defId + 1) * FACTION_SLOTS + factionSlot(faction)) * 8) + kind;
}

/**
 * Bounding-sphere radius below which an entity PROP stops casting a shadow.
 *
 * A shadow caster costs a full extra instanced draw in the shadow pass, and the
 * profiling audit found 59 shadow draws serving 83 colour draws — the shadow
 * map is roughly half the frame's geometry submission. The cascade is fitted to
 * a `farExtent` of 320 m over a 2048-texel map, which is 0.16 m per texel at
 * the far end and worse under a wide camera, so a 0.6-metre grass tuft or
 * flower bed is casting a shadow one to three texels across: a bilinear smudge
 * that is, at RTS camera distance, sub-pixel.
 *
 * 0.70 m of RADIUS (1.4 m across) is deliberately below anything that has a
 * readable ground contact — bushes and rock clusters sit around 1.0-1.6 m and
 * keep their shadows, as do all units and structures, which are never Props.
 * This is the one place the rule can be applied without reaching into
 * src/world/Scatter.ts, which owns the far larger scattered-prop population and
 * should apply the same gate there.
 */
const PROP_SHADOW_MIN_RADIUS = 0.70;

/** True when this prop is too small for its shadow to survive the cascade. */
function propCastsShadow(geometry: THREE.BufferGeometry): boolean {
  if (geometry.boundingSphere === null) geometry.computeBoundingSphere();
  const bs = geometry.boundingSphere;
  return bs === null || bs.radius >= PROP_SHADOW_MIN_RADIUS;
}

function buildEntry(mesh: KindMesh, kind: EntityKind, name: string): ModelEntry {
  const layer =
    kind === EntityKind.Building ? LAYERS.BUILDINGS
      : (kind === EntityKind.Infantry || kind === EntityKind.Vehicle) ? LAYERS.UNITS
        : LAYERS.DEFAULT;

  const specs: BatchPartSpec[] = [{
    geometry: mesh.geometry,
    material: mesh.material,
    offsetX: 0,
    offsetY: 0,
    offsetZ: 0,
    followsTurret: false,
    part: mesh.part ?? PartId.Root,
    castShadow: mesh.castShadow !== false
      && (kind !== EntityKind.Prop || propCastsShadow(mesh.geometry)),
    receiveShadow: mesh.receiveShadow !== false,
    layer,
  }];

  const extra = mesh.parts;
  if (extra !== undefined) {
    for (let i = 0; i < extra.length; i++) {
      const p = extra[i];
      specs.push({
        geometry: p.geometry,
        material: p.material,
        offsetX: p.x ?? 0,
        offsetY: p.y ?? 0,
        offsetZ: p.z ?? 0,
        followsTurret: p.followsTurret === true,
        part: p.part ?? PartId.Root,
        castShadow: p.castShadow !== false
          && (kind !== EntityKind.Prop || propCastsShadow(p.geometry)),
        receiveShadow: p.receiveShadow !== false,
        layer,
      });
    }
  }

  const socketByPart = new Int32Array(PART_ID_COUNT).fill(-1);
  const sockets: ResolvedSocket[] = [];
  const defaultPivot = mesh.turretPivotY ?? 0;
  const src = mesh.sockets;
  if (src !== undefined) {
    for (let i = 0; i < src.length; i++) {
      const s = src[i];
      const follows = s.followsTurret === true;
      sockets.push({
        part: s.part,
        x: s.x,
        y: s.y,
        z: s.z,
        yaw: s.yaw ?? 0,
        pitch: s.pitch ?? 0,
        followsTurret: follows,
        pivotY: s.pivotY ?? (follows ? defaultPivot : 0),
      });
      // First registration of a PartId wins; a duplicate is a content bug, not
      // a crash, so it is reported and ignored.
      if (s.part >= 0 && s.part < PART_ID_COUNT) {
        if (socketByPart[s.part] < 0) socketByPart[s.part] = sockets.length - 1;
        else console.warn(`[render.bridge] duplicate socket ${s.part} on "${name}" ignored`);
      }
    }
  }

  const entry: ModelEntry = {
    index: entries.length,
    specs,
    sockets,
    socketByPart,
    batch: null,
    placeholder: false,
    kind,
    name,
  };
  entries.push(entry);
  return entry;
}

/**
 * Publish the art for one kind of entity. THE registration call for every art
 * module — call it from `init()`, before or after the bridge exists.
 *
 * Resolution is most-specific-first: an exact (kind, faction, defId) beats a
 * (kind, FACTION_ANY, defId) beats a (kind, faction, any-def) beats a
 * (kind, FACTION_ANY, any-def), and anything unmatched falls through to the
 * placeholder box.
 *
 * @param defId Index into the unit/building def table, or -1 for "every def of
 *              this kind" (the right value for props, wrecks and crates).
 */
export function registerKindMesh(
  kind: EntityKind,
  faction: Faction | typeof FACTION_ANY,
  mesh: KindMesh,
  defId = -1,
): void {
  let entry = byMesh.get(mesh);
  if (entry === undefined) {
    entry = buildEntry(mesh, kind, `model#${entries.length}`);
    byMesh.set(mesh, entry);
  }
  const key = packKey(kind, faction as number, defId);
  const previous = byKey.get(key);
  if (previous !== undefined && previous !== entry) {
    console.warn(
      `[render.bridge] kind=${kind} faction=${faction} def=${defId} re-registered; ` +
      'the newest model wins',
    );
  }
  byKey.set(key, entry);
  registryVersion++;
}

/**
 * Drop every registration, every batch and the generated placeholder assets.
 * Called between matches; art modules re-register from their own `init()`.
 */
export function clearKindMeshes(): void {
  for (let i = 0; i < entries.length; i++) {
    const b = entries[i].batch;
    if (b !== null && bridgeInstance !== null) bridgeInstance.batcher.destroyBatch(b);
    entries[i].batch = null;
  }
  entries.length = 0;
  byKey.clear();
  byMesh.clear();
  placeholders.fill(null);

  // The placeholder box geometries and material are ours, so we own their GPU
  // memory too. Nulling them means the next match regenerates them on demand.
  for (let k = 0; k < placeholderGeometries.length; k++) {
    placeholderGeometries[k]?.dispose();
    placeholderGeometries[k] = null;
  }
  placeholderMaterial?.dispose();
  placeholderMaterial = null;

  registryVersion++;
}

/* ==========================================================================
 * 3. PLACEHOLDER ART
 *
 * An unregistered kind draws a hazard-striped box at the real WorldScale size.
 * It must be UNMISTAKEABLY unfinished: a plain grey box reads as "someone's
 * minimalist tank" and quietly ships.
 * ========================================================================== */

let placeholderMaterial: THREE.MeshStandardMaterial | null = null;
const placeholderGeometries: (THREE.BoxGeometry | null)[] = new Array(ENTITY_KIND_COUNT).fill(null);

function makePlaceholderMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.72,
    metalness: 0.05,
    emissive: 0x000000,
  });
  mat.name = 'PlaceholderInstance';

  const hazard = new Float32Array(3);
  hexToLinearRgb(PLACEHOLDER_HAZARD_COLOR, hazard);

  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec4 aState;
        attribute vec3 aTeamColor;
        varying vec4 vRaState;
        varying vec3 vRaTeam;
        varying vec3 vRaLocal;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vRaState = aState;
        vRaTeam = aTeamColor;
        #ifdef USE_INSTANCING
          // Instance scale, so stripes stay a fixed size in METRES even on a
          // placeholder building that is a unit cube stretched to its footprint.
          vec3 raScale = vec3(
            length(instanceMatrix[0].xyz),
            length(instanceMatrix[1].xyz),
            length(instanceMatrix[2].xyz));
        #else
          vec3 raScale = vec3(1.0);
        #endif
        vRaLocal = position * raScale;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec4 vRaState;
        varying vec3 vRaTeam;
        varying vec3 vRaLocal;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          float raBand = (vRaLocal.x + vRaLocal.y * 1.7 + vRaLocal.z) / ${PLACEHOLDER_STRIPE_METRES.toFixed(3)};
          float raStripe = step(0.5, fract(raBand));
          vec3 raBody = vRaTeam * ${PLACEHOLDER_BODY_MUL.toFixed(3)};
          vec3 raHazard = vec3(${hazard[0].toFixed(4)}, ${hazard[1].toFixed(4)}, ${hazard[2].toFixed(4)});
          diffuseColor.rgb = mix(raBody, raHazard, raStripe * 0.34);
          // Damage reads even on a placeholder: soot down toward black.
          diffuseColor.rgb *= mix(0.42, 1.0, clamp(vRaState.x, 0.0, 1.0));
        }`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += vRaTeam * clamp(vRaState.z, 0.0, 1.0) * ${PLACEHOLDER_SELECT_EMISSIVE.toFixed(3)};`,
      );
  };

  return mat;
}

/** Real WorldScale dimensions per kind: [width X, height Y, depth Z]. */
function placeholderSize(kind: EntityKind, out: Float32Array): Float32Array {
  switch (kind) {
    case EntityKind.Infantry:
      out[0] = UNIT_DIMENSIONS.infantry.w; out[1] = UNIT_DIMENSIONS.infantry.h; out[2] = UNIT_DIMENSIONS.infantry.l;
      break;
    case EntityKind.Vehicle:
      out[0] = UNIT_DIMENSIONS.heavyTank.w; out[1] = UNIT_DIMENSIONS.heavyTank.h; out[2] = UNIT_DIMENSIONS.heavyTank.l;
      break;
    case EntityKind.Building:
      // A unit cube; the bridge stretches it to the entity's real footprint.
      out[0] = 1; out[1] = 1; out[2] = 1;
      break;
    case EntityKind.Wreck:
      out[0] = 3.0; out[1] = 1.2; out[2] = 5.4;
      break;
    case EntityKind.Prop:
      out[0] = 1.8; out[1] = 3.2; out[2] = 1.8;
      break;
    case EntityKind.Crate:
      out[0] = 1.6; out[1] = 1.6; out[2] = 1.6;
      break;
    default:
      out[0] = 1; out[1] = 1; out[2] = 1;
      break;
  }
  return out;
}

const SIZE3 = new Float32Array(3);

function placeholderEntry(kind: EntityKind): ModelEntry {
  const cached = placeholders[kind];
  if (cached !== null) return cached;

  if (placeholderMaterial === null) placeholderMaterial = makePlaceholderMaterial();

  placeholderSize(kind, SIZE3);
  let geo = placeholderGeometries[kind];
  if (geo === null) {
    geo = new THREE.BoxGeometry(SIZE3[0], SIZE3[1], SIZE3[2]);
    // Model origin is the GROUND-PLANE centre, so lift the box onto the ground.
    geo.translate(0, SIZE3[1] * 0.5, 0);
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    placeholderGeometries[kind] = geo;
  }

  // Deliberately NOT keyed into `byMesh` or `byKey`: every kind needs its own
  // sized box even though they all share one material, and a placeholder must
  // never satisfy a lookup that real art should later win.
  const entry = buildEntry(
    { geometry: geo, material: placeholderMaterial },
    kind,
    `placeholder:${kind}`,
  );
  entry.placeholder = true;
  placeholders[kind] = entry;
  return entry;
}

/**
 * Height of a placeholder building, derived from its footprint. Real art
 * replaces this; it exists so a 3x3 Construction Yard does not read as a 1 m
 * slab while its module is being written.
 */
function placeholderBuildingHeight(footprint: number): number {
  return Math.min(12, 2.2 + STOREY * 0.82 * footprint);
}

/* ==========================================================================
 * 4. SCRATCH — allocated once, reused forever
 * ========================================================================== */

/** The 12 mutable elements of a column-major affine matrix, in write order. */
const MATRIX_SLOTS = new Int32Array([0, 1, 2, 4, 5, 6, 8, 9, 10, 12, 13, 14]);
/** col0(x,y,z) col1(x,y,z) col2(x,y,z) translation(x,y,z). */
const M12 = new Float32Array(12);
/**
 * Linear team colour per faction, indexed by `Faction`.
 *
 * SIZED BY `FACTION_COUNT`, and that is load-bearing. This was a fixed
 * `Float32Array(3 * 3)` with a hard-coded [neutral, allies, soviets] list, so
 * the first Meridian entity read index 9 — off the end of a typed array, which
 * yields `undefined`, which becomes **NaN** in the instance colour attribute.
 * A single NaN texel is enough for `UnrealBloomPass` to spread NaN across its
 * whole mip chain, and the grade then wrote NaN to every pixel: the entire
 * frame came back transparent. Symptom was "a Meridian skirmish renders pure
 * black while `__VM.stats()` reports 285 draws and 1.8 M triangles".
 *
 * Built from `FACTION_PALETTE_KEYS` so a fifth army needs no edit here.
 */
const TEAM_RGB = new Float32Array(FACTION_COUNT * 3);
const RGB3 = new Float32Array(3);

function loadTeamColours(): void {
  const f = DEFAULT_ART.factions;
  for (let i = 0; i < FACTION_COUNT; i++) {
    const look = f[FACTION_PALETTE_KEYS[i]];
    hexToLinearRgb(look !== undefined ? look.team : f.neutral.team, RGB3);
    TEAM_RGB[i * 3] = RGB3[0];
    TEAM_RGB[i * 3 + 1] = RGB3[1];
    TEAM_RGB[i * 3 + 2] = RGB3[2];
  }
}
loadTeamColours();

/* ==========================================================================
 * 5. THE BRIDGE
 * ========================================================================== */

/**
 * Entities hidden from the render pass by simulation state alone.
 *
 * `EntityFlag.Cloaked` is deliberately NOT in here, and that is the fix to a
 * real bug rather than an oversight. Fog of war used to hide entities by
 * SETTING that flag on them for part of each frame and putting it back before
 * the next sim step — but the flag is also read by `Targeting`, `Combat` and
 * `Selection`, so one missed restore turned a render decision into a unit that
 * could not be seen, acquired, shot or clicked for the rest of the match. Fog
 * now answers through `RenderVisibilityMask` below, which owns render state and
 * touches no simulation column at all.
 *
 * The flag still means what its name says — a genuinely cloaked or submerged
 * unit — and the mask hides those too, with the difference that YOUR OWN
 * submarine stays on your screen where it belongs.
 */
const HIDDEN_MASK = EntityFlag.Garrisoned;

/**
 * The fog module's answer to "may the local player's screen draw this?",
 * supplied per store slot.
 *
 * Declared here rather than imported from the simulation so the render layer
 * states what it needs and depends on nothing to get it: `src/sim/Vision.ts`
 * satisfies this structurally, and a bridge with no mask attached draws
 * everything, which is the right behaviour for a scene with no fog module in it.
 */
export interface RenderVisibilityMask {
  /** True when the local view must not draw the entity in store slot `index`. */
  isRenderHiddenAt(index: number): boolean;
}

/* --------------------------------------------------------------------------
 * 5a. THE INVISIBLE-ENTITY AUDIT
 *
 * "Some enemies are invisible" was reported three times and survived one fix,
 * because every previous attempt narrowed by READING. This converts the
 * question to a measurement, and it is deliberately mechanical:
 *
 *   For every ALIVE entity the visibility mask says the local player may see,
 *   did it actually receive an instance slot that the GPU will draw this frame?
 *
 * "That the GPU will draw" is the important half, and it is more than "has a
 * slot". A slot is only drawn if the batch mesh is visible, the slot index is
 * below `InstancedMesh.count`, the instance matrix is a real basis rather than
 * zeros or NaN, and the instance lies inside the bounding sphere the frustum
 * test culls against. Each of those is checked separately so the answer names a
 * mechanism instead of a suspicion.
 * -------------------------------------------------------------------------- */

/** Why one entity the simulation believes in did not reach the screen. */
export type RenderMissReason =
  /** `ensureBinding` refused: the batch is at MAX_ENTITIES. */
  | 'no-instance-slot'
  /** Bound, but this frame's pass never wrote it. Should be impossible. */
  | 'not-written'
  /** `bindEntry` points outside the model table (a registry clear mid-frame). */
  | 'stale-entry'
  /** The model entry exists but never got a batch. */
  | 'no-batch'
  /** The batch says the slot it is bound to is free. */
  | 'slot-not-owned'
  /** `slot >= InstancedMesh.count`: the draw call never reaches it. */
  | 'beyond-draw-count'
  /** The batch mesh is `visible === false`. */
  | 'mesh-hidden'
  /** Zero basis — every triangle collapses to a point. */
  | 'degenerate-matrix'
  /** NaN anywhere in the 16 matrix floats, or in the team colour. */
  | 'nan-transform'
  /** Outside the sphere the frustum test culls the whole batch against. */
  | 'outside-batch-bounds'
  /** Drawn, but nowhere near where the simulation has it. */
  | 'transform-drift'
  /**
   * A finished structure whose `buildProgress` is still below 1. The structure
   * shader sinks it by its own model height and discards every fragment below
   * the ground plane — see the note on `sunkStructures`.
   */
  | 'sunk-below-ground-cut';

/**
 * How far the drawn transform may sit from the simulated position before it is
 * a miss, in metres.
 *
 * Interpolation legitimately puts an instance up to ONE SIM TICK of travel
 * behind `store.posX`, which at the fastest locomotor in the game is well under
 * a metre at 30 Hz. 8 m is an order of magnitude above that and still an order
 * of magnitude below "drawn somewhere you will never look".
 */
const AUDIT_DRIFT_METRES = 8;

/** One entity that the sim says is visible and the renderer will not draw. */
export interface RenderMissRow {
  /** Store slot index. */
  index: number;
  /** Store generation, so a row can be matched to a specific entity life. */
  gen: number;
  kind: EntityKind;
  faction: number;
  owner: number;
  defId: number;
  x: number;
  y: number;
  z: number;
  reason: RenderMissReason;
  /** The batch it belongs (or should belong) to. */
  batch: string;
  /** True when that batch is the hazard-striped placeholder. */
  placeholder: boolean;
  slot: number;
  drawCount: number;
  capacity: number;
  /** Human-readable specifics for the reason. */
  detail: string;
}

/** Per-batch state at audit time. */
export interface RenderAuditBatch {
  name: string;
  kind: EntityKind;
  placeholder: boolean;
  live: number;
  written: number;
  drawCount: number;
  capacity: number;
  parts: number;
  visible: boolean;
  unwrittenSlots: number;
}

/** Running totals since the audit was switched on. */
export interface RenderAuditTotals {
  frames: number;
  misses: number;
  byReason: Record<string, number>;
  byFaction: number[];
  byKind: number[];
}

export interface RenderAudit {
  /** The bridge frame counter this was taken on. */
  frame: number;
  alive: number;
  /** Alive, not garrisoned, not masked by the shroud — i.e. must be drawn. */
  eligible: number;
  /** Of those, how many actually reached a drawable instance slot. */
  drawn: number;
  misses: RenderMissRow[];
  /** True when `misses` was truncated. */
  truncated: boolean;
  batches: RenderAuditBatch[];
  totals: RenderAuditTotals;
}

/** How many miss rows a single report carries before it truncates. */
const AUDIT_MISS_LIMIT = 64;

export class RenderBridge {
  readonly batcher: InstanceBatcher;

  /**
   * Set by the fog module every frame at `RenderPhase.FowUpload` (20), which
   * runs before `RenderPhase.Bridge` (30) — so the mask this pass reads was
   * computed from the same tick's positions, never a frame late.
   */
  visibility: RenderVisibilityMask | null = null;

  /* -- binding: entity slot -> (entry, instance slot) --------------------- */
  private readonly bindEntry = new Int32Array(MAX_ENTITIES).fill(-1);
  private readonly bindSlot = new Int32Array(MAX_ENTITIES).fill(-1);
  /** Generation the binding was made for. 0 = unbound. */
  private readonly bindGen = new Uint16Array(MAX_ENTITIES);
  /** Registry version at bind time, so late-arriving art replaces placeholders. */
  private readonly bindVersion = new Uint32Array(MAX_ENTITIES);

  /** Dense list of currently bound entity slots, with O(1) swap-remove. */
  private readonly boundList = new Int32Array(MAX_ENTITIES);
  private readonly boundPos = new Int32Array(MAX_ENTITIES).fill(-1);
  private boundCount = 0;

  /** Frame id each bound entity was last written on; drives the release sweep. */
  private readonly visitStamp = new Int32Array(MAX_ENTITIES);
  private frameId = 0;

  /* -- the interpolated transform, cached for socketWorld() --------------- */
  private readonly lerpX = new Float32Array(MAX_ENTITIES);
  private readonly lerpY = new Float32Array(MAX_ENTITIES);
  private readonly lerpZ = new Float32Array(MAX_ENTITIES);
  private readonly lerpYaw = new Float32Array(MAX_ENTITIES);
  private readonly lerpTurretYaw = new Float32Array(MAX_ENTITIES);
  private readonly lerpBarrelPitch = new Float32Array(MAX_ENTITIES);

  /* -- diagnostics -------------------------------------------------------- */
  visibleUnits = 0;
  visibleBuildings = 0;
  /** Entities that could not get an instance slot (batch at MAX_ENTITIES). */
  overflow = 0;
  private overflowReported = false;

  /**
   * THE ALWAYS-ON HALF OF THE INVISIBLE-ENTITY GUARD.
   *
   * `update()` counts the entities the visibility mask says must be drawn, and
   * counts the ones that reached a batch. Two integer increments per entity; no
   * allocation, no branch that a profiler would find. When the two disagree,
   * something the player can see in the sim is missing from the screen, and the
   * expensive explanation (`auditNow`) is built exactly once, at that moment.
   *
   * The deep per-instance checks (draw count, degenerate matrix, culling
   * sphere) are NOT free, so they live behind `auditEnabled`.
   */
  missedDraws = 0;
  private missReported = false;

  /**
   * THE OTHER WAY TO BE INVISIBLE, WHICH NO SLOT-LEVEL CHECK CAN SEE.
   *
   * `src/art/BuildingFactory.ts` draws the construction rise in the vertex
   * shader: a structure sinks by its own model height in proportion to
   * `1 - aState.y` — that is `buildProgress` — and the fragment shader
   * `discard`s everything left below the ground plane. At `buildProgress === 0`
   * the entire structure is below the cut and NOTHING is rasterised.
   *
   * Such an entity has a live instance slot, a correct matrix, a real draw call
   * and sits inside the culling sphere. Every check in `inspect()` passes. It is
   * alive, targetable, hoverable and shootable, and the player cannot see it —
   * which is the reported bug word for word.
   *
   * The simulation always writes `buildProgress` and `EntityFlag.
   * UnderConstruction` together (Scenarios.ts, Production.spawnBuilding,
   * Production's rise loop, Relocate), and the rise loop is GATED on the flag —
   * so a structure that loses the flag while the column is still below 1 is
   * never advanced again and stays invisible for the rest of the match. That
   * pairing is load-bearing and nothing was checking it. Now the renderer does,
   * for the price of one compare on a branch it was already taking.
   */
  sunkStructures = 0;
  private sunkReported = false;

  /** Run the full audit every frame and keep the last report. Dev only. */
  auditEnabled = false;
  private audit: RenderAudit | null = null;
  private auditFailure: RenderAudit | null = null;
  private readonly auditTotals: RenderAuditTotals = {
    frames: 0,
    misses: 0,
    byReason: {},
    byFaction: new Array<number>(FACTION_COUNT).fill(0),
    byKind: new Array<number>(ENTITY_KIND_COUNT).fill(0),
  };

  constructor(private readonly store: EntityStore, scene: THREE.Scene) {
    this.batcher = new InstanceBatcher(scene);
  }

  /* ---------------------------------------------------------------------- */
  /* Per-frame                                                              */
  /* ---------------------------------------------------------------------- */

  /**
   * Interpolate and upload every visible entity. `alpha` is
   * `RenderContext.alpha`: 0 at the previous tick, 1 at the current one.
   */
  update(alpha: number): void {
    const s = this.store;
    this.frameId++;
    this.batcher.beginFrame();
    this.visibleUnits = 0;
    this.visibleBuildings = 0;

    const mask = this.visibility;
    const n = s.aliveCount;
    let eligible = 0;
    let drawn = 0;
    for (let a = 0; a < n; a++) {
      const i = s.alive[a];
      const flags = s.flags[i];
      if ((flags & HIDDEN_MASK) !== 0) continue;
      if (mask !== null && mask.isRenderHiddenAt(i)) continue;
      eligible++;

      const entryIndex = this.ensureBinding(i);
      if (entryIndex < 0) continue;
      drawn++;

      const entry = entries[entryIndex];
      const slot = this.bindSlot[i];
      this.visitStamp[i] = this.frameId;

      /* -- interpolate ---------------------------------------------------- */
      const px = s.prevX[i], py = s.prevY[i], pz = s.prevZ[i];
      const x = px + (s.posX[i] - px) * alpha;
      const y = py + (s.posY[i] - py) * alpha;
      const z = pz + (s.posZ[i] - pz) * alpha;
      // SHORTEST ARC. A plain lerp across the +/-PI seam spins a turret the
      // long way round in a single frame.
      const yaw = lerpAngle(s.prevYaw[i], s.yaw[i], alpha);
      const turretYaw = lerpAngle(s.prevTurretYaw[i], s.turretYaw[i], alpha);
      const pbp = s.prevBarrelPitch[i];
      const barrelPitch = pbp + (s.barrelPitch[i] - pbp) * alpha;

      this.lerpX[i] = x; this.lerpY[i] = y; this.lerpZ[i] = z;
      this.lerpYaw[i] = yaw;
      this.lerpTurretYaw[i] = turretYaw;
      this.lerpBarrelPitch[i] = barrelPitch;

      /* -- per-instance state --------------------------------------------- */
      const maxHp = s.maxHp[i];
      const hpFrac = maxHp > 0 ? clamp01(s.hp[i] / maxHp) : 1;
      const buildProgress = s.buildProgress[i];
      const selected = (flags & EntityFlag.Selected) !== 0 ? 1
        : (flags & EntityFlag.Hovered) !== 0 ? 0.5 : 0;

      const batch = entry.batch!;
      batch.writeState(slot, hpFrac, buildProgress, selected, s.seed[i]);
      const fi = s.faction[i] * 3;
      batch.writeTeam(slot, TEAM_RGB[fi], TEAM_RGB[fi + 1], TEAM_RGB[fi + 2]);

      /* -- scale ----------------------------------------------------------- */
      // Real art is authored at true metres and never scales, with two
      // exceptions.
      const kind = s.kind[i];
      let sx = 1, sy = 1, sz = 1;
      if (kind === EntityKind.Prop) {
        // Props carry a uniform size hint in `seed`, where 0.5 means "as
        // authored" (see ScenarioBuilder.spawnProp). Clamped, because a prop
        // whose seed was left as plain per-entity randomness would otherwise
        // occasionally scale to nothing.
        sx = sy = sz = Math.min(1.9, Math.max(0.6, s.seed[i] * 2));
      } else if (entry.placeholder && kind === EntityKind.Building) {
        // A placeholder BUILDING is a unit cube, stretched to the entity's real
        // footprint so the gap in the art is the right size and shape on the
        // grid, and rising with construction so the state still reads.
        const fw = s.footprintW[i] > 0 ? s.footprintW[i] : 1;
        const fh = s.footprintH[i] > 0 ? s.footprintH[i] : 1;
        sx = fw * CELL;
        sz = fh * CELL;
        sy = placeholderBuildingHeight(Math.max(fw, fh))
          * Math.max(PLACEHOLDER_MIN_RISE, buildProgress);
      }

      /* -- compose ---------------------------------------------------------- */
      const hullPitch = s.hullPitch[i];
      const hullRoll = s.hullRoll[i];
      const recoil = s.recoil[i];
      const specs = entry.specs;

      for (let p = 0; p < specs.length; p++) {
        const spec = specs[p];
        const follows = spec.followsTurret === true;
        const partYaw = follows ? turretYaw : yaw;
        const partPitch = follows
          ? (spec.part === PartId.Barrel ? barrelPitch : 0)
          : hullPitch;
        const partRoll = follows ? 0 : hullRoll;

        composeBasis(partYaw, partPitch, partRoll, sx, sy, sz);

        // Anchor: rotate the part's local offset into world space.
        const ox = spec.offsetX! * sx, oy = spec.offsetY! * sy, oz = spec.offsetZ! * sz;
        let tx = x + M12[0] * ox + M12[3] * oy + M12[6] * oz;
        let ty = y + M12[1] * ox + M12[4] * oy + M12[7] * oz;
        let tz = z + M12[2] * ox + M12[5] * oy + M12[8] * oz;

        // Recoil shoves the gun back along its own -forward.
        if (follows && recoil !== 0) {
          tx -= Math.sin(partYaw) * recoil;
          tz -= Math.cos(partYaw) * recoil;
        }
        M12[9] = tx; M12[10] = ty; M12[11] = tz;

        writeMatrix(batch.parts[p].matrix, slot, batch);
      }

      batch.addBounds(x, y, z);

      if (kind === EntityKind.Building) {
        this.visibleBuildings++;
        // See `sunkStructures`. One compare, on a branch already taken.
        if (buildProgress < 1 && (flags & EntityFlag.UnderConstruction) === 0) {
          this.sunkStructures++;
          if (!this.sunkReported) {
            this.sunkReported = true;
            console.error(
              `[render.bridge] building in slot ${i} (faction ${s.faction[i]}, def ` +
              `${s.defId[i]}) has buildProgress ${buildProgress.toFixed(3)} but is not ` +
              'UnderConstruction. The structure shader sinks it below its own ground ' +
              'cut and discards every fragment: it is alive, targetable and invisible.',
            );
          }
        }
      } else if (kind === EntityKind.Infantry || kind === EntityKind.Vehicle) this.visibleUnits++;
    }

    this.releaseUnvisited();
    this.batcher.endFrame();

    // Two integers compared once per frame. See `missedDraws`.
    if (drawn !== eligible) {
      this.missedDraws += eligible - drawn;
      if (!this.missReported) {
        this.missReported = true;
        const report = this.auditNow();
        console.error(
          `[render.bridge] ${eligible - drawn} entities the local player may ` +
          'see did not reach a draw slot this frame:',
          report.misses,
        );
      }
    }

    if (this.auditEnabled) this.captureAudit();
  }

  /* ---------------------------------------------------------------------- */
  /* Binding                                                                */
  /* ---------------------------------------------------------------------- */

  /**
   * Make sure entity slot `i` owns an instance slot in the right model's batch.
   * Returns the entry index, or -1 when the batch is full.
   */
  private ensureBinding(i: number): number {
    const s = this.store;
    const gen = s.gen[i];
    if (this.bindGen[i] === gen && this.bindVersion[i] === registryVersion) {
      return this.bindEntry[i];
    }

    const kind = s.kind[i] as EntityKind;
    const target = this.resolve(kind, s.faction[i], s.defId[i]);

    // Already on the right model (a version bump that changed nothing else):
    // keep the slot so no instance flickers.
    if (this.bindGen[i] === gen && this.bindEntry[i] === target.index) {
      this.bindVersion[i] = registryVersion;
      return target.index;
    }

    this.unbind(i);

    if (target.batch === null) {
      target.batch = this.batcher.createBatch(target.specs, target.name);
    }
    const slot = target.batch.alloc();
    if (slot < 0) {
      this.overflow++;
      if (!this.overflowReported) {
        this.overflowReported = true;
        console.error(`[render.bridge] batch "${target.name}" is full; entities will not render`);
      }
      return -1;
    }

    this.bindEntry[i] = target.index;
    this.bindSlot[i] = slot;
    this.bindGen[i] = gen;
    this.bindVersion[i] = registryVersion;
    this.boundPos[i] = this.boundCount;
    this.boundList[this.boundCount++] = i;
    return target.index;
  }

  /** Most-specific-first model lookup, falling through to the placeholder. */
  private resolve(kind: EntityKind, faction: number, defId: number): ModelEntry {
    let e = byKey.get(packKey(kind, faction, defId));
    if (e !== undefined) return e;
    e = byKey.get(packKey(kind, FACTION_ANY, defId));
    if (e !== undefined) return e;
    e = byKey.get(packKey(kind, faction, -1));
    if (e !== undefined) return e;
    e = byKey.get(packKey(kind, FACTION_ANY, -1));
    if (e !== undefined) return e;
    return placeholderEntry(kind);
  }

  /** Return an entity's instance slot to its batch and forget the binding. */
  private unbind(i: number): void {
    if (this.bindGen[i] === 0) return;
    const entryIndex = this.bindEntry[i];
    if (entryIndex >= 0 && entryIndex < entries.length) {
      const batch = entries[entryIndex].batch;
      if (batch !== null && this.bindSlot[i] >= 0) batch.free(this.bindSlot[i]);
    }
    this.bindEntry[i] = -1;
    this.bindSlot[i] = -1;
    this.bindGen[i] = 0;
    this.bindVersion[i] = 0;

    const pos = this.boundPos[i];
    if (pos >= 0) {
      const last = this.boundList[--this.boundCount];
      this.boundList[pos] = last;
      this.boundPos[last] = pos;
      this.boundPos[i] = -1;
    }
  }

  /**
   * Free the instance slot of anything that was bound but not written this
   * frame — dead, garrisoned, masked by the shroud, or simply gone.
   */
  private releaseUnvisited(): void {
    for (let k = this.boundCount - 1; k >= 0; k--) {
      const i = this.boundList[k];
      if (this.visitStamp[i] !== this.frameId) this.unbind(i);
    }
  }

  /* ---------------------------------------------------------------------- */
  /* The invisible-entity audit                                             */
  /* ---------------------------------------------------------------------- */

  /**
   * Walk every alive entity and answer, per entity, whether the GPU will draw
   * it — the measurement described in §5a.
   *
   * MUST be called immediately after `update()` for the frame you care about:
   * it reads `visitStamp` against the current `frameId` and reads live batch
   * state. Called mid-tick from a console it will report entities that were
   * spawned since the last rendered frame as `not-written`, which is true but
   * uninteresting.
   *
   * Allocates. That is fine — it never runs on a frame that is not already
   * broken, unless `auditEnabled` was deliberately switched on.
   */
  auditNow(limit = AUDIT_MISS_LIMIT): RenderAudit {
    const s = this.store;
    const mask = this.visibility;
    const misses: RenderMissRow[] = [];
    let eligible = 0;
    let drawn = 0;
    let truncated = false;

    for (let a = 0; a < s.aliveCount; a++) {
      const i = s.alive[a];
      if ((s.flags[i] & HIDDEN_MASK) !== 0) continue;
      if (mask !== null && mask.isRenderHiddenAt(i)) continue;
      eligible++;

      const fail = this.inspect(i);
      if (fail === null) { drawn++; continue; }
      if (misses.length < limit) misses.push(fail);
      else truncated = true;
    }

    const batches: RenderAuditBatch[] = [];
    for (let e = 0; e < entries.length; e++) {
      const entry = entries[e];
      const b = entry.batch;
      if (b === null) continue;
      batches.push({
        name: entry.name,
        kind: entry.kind,
        placeholder: entry.placeholder,
        live: b.liveCount,
        written: b.writtenCount,
        drawCount: b.drawCount,
        capacity: b.capacity,
        parts: b.partCount,
        visible: b.parts.length > 0 ? b.parts[0].mesh.visible : false,
        unwrittenSlots: b.unwrittenSlots,
      });
    }

    return {
      frame: this.frameId,
      alive: s.aliveCount,
      eligible,
      drawn,
      misses,
      truncated,
      batches,
      totals: this.auditTotals,
    };
  }

  /** The most recent report captured while `auditEnabled`, or null. */
  lastAudit(): RenderAudit | null { return this.audit; }

  /**
   * The FIRST report that found something, retained.
   *
   * Kept separately from `lastAudit` because the two answer different
   * questions and conflating them cost a whole probe run: a `lastAudit` that
   * only overwrote itself on failure reported frame 1's counters forever, so
   * every sample line in that run was stale and the numbers looked frozen.
   */
  failedAudit(): RenderAudit | null { return this.auditFailure; }

  /** Zero the running totals and forget both retained reports. */
  resetAudit(): void {
    this.audit = null;
    this.auditFailure = null;
    this.auditTotals.frames = 0;
    this.auditTotals.misses = 0;
    this.auditTotals.byReason = {};
    this.auditTotals.byFaction.fill(0);
    this.auditTotals.byKind.fill(0);
    this.missedDraws = 0;
    this.missReported = false;
  }

  private captureAudit(): void {
    const report = this.auditNow();
    this.auditTotals.frames++;
    this.auditTotals.misses += report.misses.length;
    for (let m = 0; m < report.misses.length; m++) {
      const row = report.misses[m];
      this.auditTotals.byReason[row.reason] = (this.auditTotals.byReason[row.reason] ?? 0) + 1;
      if (row.faction >= 0 && row.faction < FACTION_COUNT) this.auditTotals.byFaction[row.faction]++;
      if (row.kind >= 0 && row.kind < ENTITY_KIND_COUNT) this.auditTotals.byKind[row.kind]++;
    }
    this.audit = report;
    if (report.misses.length > 0 && this.auditFailure === null) this.auditFailure = report;
  }

  /**
   * The per-entity verdict. Returns null when the entity will be drawn, or the
   * row explaining why it will not.
   *
   * The checks are ordered from "no slot at all" outward to "has a slot the GPU
   * will skip", so the first failure is always the most fundamental one.
   */
  private inspect(i: number): RenderMissRow | null {
    const s = this.store;
    const row = (
      reason: RenderMissReason,
      detail: string,
      entry: ModelEntry | null,
      slot: number,
    ): RenderMissRow => ({
      index: i,
      gen: s.gen[i],
      kind: s.kind[i] as EntityKind,
      faction: s.faction[i],
      owner: s.owner[i],
      defId: s.defId[i],
      x: s.posX[i], y: s.posY[i], z: s.posZ[i],
      reason,
      batch: entry !== null ? entry.name : '(unresolved)',
      placeholder: entry !== null && entry.placeholder,
      slot,
      drawCount: entry !== null && entry.batch !== null ? entry.batch.drawCount : -1,
      capacity: entry !== null && entry.batch !== null ? entry.batch.capacity : -1,
      detail,
    });

    const entryIndex = this.bindEntry[i];
    if (this.bindGen[i] !== s.gen[i] || entryIndex < 0) {
      return row('no-instance-slot', 'no binding survived this frame', null, -1);
    }
    if (entryIndex >= entries.length) {
      return row('stale-entry', `bindEntry=${entryIndex} of ${entries.length}`, null, -1);
    }
    const entry = entries[entryIndex];
    if (this.visitStamp[i] !== this.frameId) {
      return row('not-written', `visitStamp=${this.visitStamp[i]} frame=${this.frameId}`, entry, -1);
    }
    const batch = entry.batch;
    if (batch === null) return row('no-batch', 'model entry has no batch', entry, -1);

    const slot = this.bindSlot[i];
    if (!batch.isUsed(slot)) {
      return row('slot-not-owned', `slot ${slot} is on the free list`, entry, slot);
    }

    // See `sunkStructures`: drawn perfectly, rasterised not at all.
    if (s.kind[i] === EntityKind.Building
      && s.buildProgress[i] < 1
      && (s.flags[i] & EntityFlag.UnderConstruction) === 0) {
      return row(
        'sunk-below-ground-cut',
        `buildProgress ${s.buildProgress[i].toFixed(3)} without the UnderConstruction ` +
        'flag: the structure shader discards every fragment',
        entry, slot,
      );
    }

    for (let p = 0; p < batch.parts.length; p++) {
      const part = batch.parts[p];
      if (!part.mesh.visible) {
        return row('mesh-hidden', `part ${p} (${part.mesh.name}) is not visible`, entry, slot);
      }
      if (slot >= part.mesh.count) {
        return row(
          'beyond-draw-count',
          `slot ${slot} >= count ${part.mesh.count} on part ${p}`,
          entry, slot,
        );
      }

      const m = part.matrix;
      const o = slot * 16;
      let basis = 0;
      for (let k = 0; k < 16; k++) {
        const v = m[o + k];
        if (Number.isNaN(v)) {
          return row('nan-transform', `matrix[${k}] is NaN on part ${p}`, entry, slot);
        }
      }
      for (let k = 0; k < 3; k++) {
        basis += Math.abs(m[o + k]) + Math.abs(m[o + 4 + k]) + Math.abs(m[o + 8 + k]);
      }
      if (basis === 0) {
        return row('degenerate-matrix', `zero basis on part ${p}`, entry, slot);
      }

      const t = part.team;
      const to = slot * 3;
      if (Number.isNaN(t[to]) || Number.isNaN(t[to + 1]) || Number.isNaN(t[to + 2])) {
        return row('nan-transform', `aTeamColor is NaN on part ${p}`, entry, slot);
      }

      // Part 0 carries no anchor offset, so its translation IS the entity's
      // drawn world position. Comparing it with the simulation catches the one
      // failure a slot-level check cannot see: an instance that has a slot, a
      // basis and a draw call, and is a hundred metres from where the player is
      // shooting. Also the only check that survives a later render module
      // rewriting the buffer, which is why the audit is safe to run at the END
      // of a frame rather than inside the bridge pass.
      if (p === 0) {
        const dxs = m[o + 12] - s.posX[i];
        const dys = m[o + 13] - s.posY[i];
        const dzs = m[o + 14] - s.posZ[i];
        const drift = Math.sqrt(dxs * dxs + dys * dys + dzs * dzs);
        if (drift > AUDIT_DRIFT_METRES) {
          return row(
            'transform-drift',
            `drawn at (${m[o + 12].toFixed(1)}, ${m[o + 13].toFixed(1)}, ${m[o + 14].toFixed(1)}) ` +
            `but simulated at (${s.posX[i].toFixed(1)}, ${s.posY[i].toFixed(1)}, ${s.posZ[i].toFixed(1)}) ` +
            `— ${drift.toFixed(1)} m apart`,
            entry, slot,
          );
        }
      }

      const sphere = part.mesh.boundingSphere;
      if (sphere !== null) {
        const dx = m[o + 12] - sphere.center.x;
        const dy = m[o + 13] - sphere.center.y;
        const dz = m[o + 14] - sphere.center.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d > sphere.radius) {
          return row(
            'outside-batch-bounds',
            `instance is ${(d - sphere.radius).toFixed(2)} m outside the culling ` +
            `sphere (r=${sphere.radius.toFixed(2)}) on part ${p}`,
            entry, slot,
          );
        }
      }
    }

    return null;
  }

  /* ---------------------------------------------------------------------- */
  /* Queries                                                                */
  /* ---------------------------------------------------------------------- */

  /** True when this entity has an instance on screen right now. */
  isRendered(id: EntityId): boolean {
    const i = this.slotOf(id);
    return i >= 0 && this.visitStamp[i] === this.frameId;
  }

  /** Validate a handle down to a store slot index, or -1. */
  private slotOf(id: EntityId): number {
    const raw = id as number;
    if (raw === 0) return -1;
    const i = handleIndex(id);
    if (i >= MAX_ENTITIES) return -1;
    return this.store.gen[i] === handleGen(id) ? i : -1;
  }

  /**
   * The interpolated world transform the entity was DRAWN with this frame.
   * Writes `[x, y, z, yaw, turretYaw, barrelPitch]` into `out` (length >= 6).
   * This is what a health bar, a selection ring or a positional sound wants —
   * never `store.posX`, which is a whole tick stale mid-frame.
   */
  entityWorld(id: EntityId, out: Float32Array): boolean {
    const i = this.slotOf(id);
    if (i < 0 || this.visitStamp[i] !== this.frameId) return false;
    out[0] = this.lerpX[i];
    out[1] = this.lerpY[i];
    out[2] = this.lerpZ[i];
    out[3] = this.lerpYaw[i];
    out[4] = this.lerpTurretYaw[i];
    out[5] = this.lerpBarrelPitch[i];
    return true;
  }

  /**
   * World-space position AND orientation of a named socket — the muzzle of a
   * slewing turret, an exhaust, a dock point.
   *
   * `InstancedMesh` cannot have children, so this is the ONLY way to pin a
   * muzzle flash to a moving gun. It uses the same interpolated transform the
   * instance was drawn with, so the flash is never a frame behind the barrel.
   *
   * Writes into `out` (length >= 7):
   *   [0..2] world position
   *   [3..5] unit forward vector (the direction the socket points)
   *   [6]    world yaw of that forward vector
   *
   * Returns false when the entity is stale, not rendered this frame, or its
   * model has no socket for that part.
   */
  socketWorld(id: EntityId, part: PartId, out: Float32Array): boolean {
    const i = this.slotOf(id);
    if (i < 0 || this.visitStamp[i] !== this.frameId) return false;

    const entryIndex = this.bindEntry[i];
    if (entryIndex < 0) return false;
    const entry = entries[entryIndex];
    if (part < 0 || part >= PART_ID_COUNT) return false;
    const si = entry.socketByPart[part];
    if (si < 0) return false;
    const socket = entry.sockets[si];

    const s = this.store;
    const follows = socket.followsTurret;
    const partYaw = follows ? this.lerpTurretYaw[i] : this.lerpYaw[i];
    const partPitch = follows ? this.lerpBarrelPitch[i] : s.hullPitch[i];
    const partRoll = follows ? 0 : s.hullRoll[i];

    // Position: rotate the offset about the part's pivot, not the model origin,
    // so an elevating barrel swings its muzzle about the trunnion.
    composeBasis(partYaw, partPitch, partRoll, 1, 1, 1);
    const lx = socket.x;
    const ly = socket.y - socket.pivotY;
    const lz = socket.z;
    let wx = this.lerpX[i] + M12[0] * lx + M12[3] * ly + M12[6] * lz;
    let wy = this.lerpY[i] + M12[1] * lx + M12[4] * ly + M12[7] * lz + socket.pivotY;
    let wz = this.lerpZ[i] + M12[2] * lx + M12[5] * ly + M12[8] * lz;

    if (follows) {
      const recoil = s.recoil[i];
      if (recoil !== 0) {
        wx -= Math.sin(partYaw) * recoil;
        wz -= Math.cos(partYaw) * recoil;
      }
    }

    // Direction: the part's aim plus the socket's own splay. Composing the two
    // as scalar sums is exact for the axis-aligned sockets models actually use
    // and visually correct for the rest.
    const aimYaw = partYaw + socket.yaw;
    const aimPitch = partPitch + socket.pitch;
    const cp = Math.cos(aimPitch), sp = Math.sin(aimPitch);

    out[0] = wx; out[1] = wy; out[2] = wz;
    out[3] = Math.sin(aimYaw) * cp;
    out[4] = sp;
    out[5] = Math.cos(aimYaw) * cp;
    out[6] = aimYaw;
    return true;
  }

  /** Draw calls this bridge contributes this frame. */
  get drawCalls(): number { return this.batcher.meshCount; }
  get batchCount(): number { return this.batcher.batchCount; }
  get instanceCount(): number { return this.batcher.instanceCount; }

  dispose(): void {
    this.visibility = null;
    while (this.boundCount > 0) this.unbind(this.boundList[this.boundCount - 1]);
    this.batcher.dispose();
  }
}

/* ==========================================================================
 * 6. MATRIX COMPOSITION
 *
 * Euler order YXZ with Euler-X negated, so positive pitch raises the nose.
 * Written into M12 as three scaled basis columns; the caller fills the
 * translation and hands it to `writeMatrix`.
 * ========================================================================== */

function composeBasis(
  yaw: number, pitch: number, roll: number,
  sx: number, sy: number, sz: number,
): void {
  const c = Math.cos(yaw), d = Math.sin(yaw);

  if (pitch === 0 && roll === 0) {
    // The common case by a wide margin: flat ground, no roll.
    M12[0] = c * sx;  M12[1] = 0;   M12[2] = -d * sx;
    M12[3] = 0;       M12[4] = sy;  M12[5] = 0;
    M12[6] = d * sz;  M12[7] = 0;   M12[8] = c * sz;
    return;
  }

  // Euler-X is -pitch: positive pitch must raise a +Z-facing nose.
  const a = Math.cos(pitch), b = -Math.sin(pitch);
  const e = Math.cos(roll), f = Math.sin(roll);
  const ce = c * e, cf = c * f, de = d * e, df = d * f;

  M12[0] = (ce + df * b) * sx;
  M12[1] = (a * f) * sx;
  M12[2] = (cf * b - de) * sx;

  M12[3] = (de * b - cf) * sy;
  M12[4] = (a * e) * sy;
  M12[5] = (df + ce * b) * sy;

  M12[6] = (a * d) * sz;
  M12[7] = (-b) * sz;
  M12[8] = (a * c) * sz;
}

/**
 * Copy M12 into the instance buffer, marking the slot dirty only if something
 * actually moved. A base full of stationary buildings then costs zero upload.
 */
function writeMatrix(m: Float32Array, slot: number, batch: InstanceBatch): void {
  const o = slot * 16;
  let changed = false;
  for (let k = 0; k < 12; k++) {
    const j = o + MATRIX_SLOTS[k];
    const v = M12[k];
    if (m[j] !== v) { m[j] = v; changed = true; }
  }
  if (changed) batch.markDirty(slot);
}

/* ==========================================================================
 * 7. MODULE-LEVEL ACCESS
 *
 * VFX, audio and the HUD reach the bridge through these, so they never have to
 * import the system module or know when it initialised.
 * ========================================================================== */

let bridgeInstance: RenderBridge | null = null;

/** Bootstrap-side: the system module sets this in `init()`. */
export function setRenderBridge(next: RenderBridge | null): void {
  bridgeInstance = next;
}

/** The live bridge, or null before `init()` / after `dispose()`. */
export function renderBridge(): RenderBridge | null {
  return bridgeInstance;
}

/** @see RenderBridge.socketWorld */
export function socketWorld(id: EntityId, part: PartId, out: Float32Array): boolean {
  return bridgeInstance !== null && bridgeInstance.socketWorld(id, part, out);
}

/** @see RenderBridge.entityWorld */
export function entityWorld(id: EntityId, out: Float32Array): boolean {
  return bridgeInstance !== null && bridgeInstance.entityWorld(id, out);
}
