/**
 * ============================================================================
 * VOLTMARCH — src/world/ore.system.ts
 * ============================================================================
 * ORE, DRAWN IN THE WORLD. The crystal instancer.
 *
 * THE HOLE THIS FILLS
 * -------------------
 * Reported as: "We have ore scattered around the map, but i cant see it, how do
 * i know where to place my harvesters?" — and the answer was that ore had NO
 * world-space representation at all. Not a dim one. None.
 *
 * `OreField` publishes a complete, correct render API and had zero production
 * callers for every part of it: `densityAt` (Economy.ts:521, docstring "for the
 * crystal renderer"), `densityAtWorld`, `drainDirty` ("the crystal instancer
 * calls this once per frame"), `pendingDirty`, and `getOreField()` ("for the
 * render-side crystal instancer"). The supporting content was authored and
 * equally dead: `ORE_CRYSTAL_COLOR`, `SURFACES.oreCrystal`, `ORE_DENSITY_STEPS`
 * and the `'oreCrystal'` SurfaceArchetype. Nine separate prose sites across
 * five files describe this module's behaviour in the present tense. Three of
 * them state something flatly false about the tree as it stood — config.ts's
 * "Referenced by both terrain and HUD" (referenced by neither) being the
 * bluntest. It is the largest single entry `docs/SPEC_DRIFT_AUDIT.md` could
 * have had, and it was invisible because a module that was never written
 * generates no failing test.
 *
 * WHAT THE PLAYER ACTUALLY HAD. Three things, none of which finds ore:
 *   1. The MINIMAP bakes it gold (`Minimap.drawTerrain`'s ore blend) — a 1px-per-cell
 *      abstraction on a HUD panel, and the only ore display that existed.
 *   2. `FxKind.OreSparkle`, emitted at a harvester that is ALREADY mining.
 *   3. The cursor swapping to `CursorKind.Harvest` over an ore cell — which
 *      requires a harvester already selected and the pointer already on the
 *      right patch. A probe, not a display: it confirms a guess, it cannot
 *      direct one.
 *
 * AND THE GROUND CUE POINTED THE WRONG WAY. `scatter.system.ts` registers
 * `addExclusion(o.x, o.z, o.radius + 4)` for every field, correctly — "a
 * harvester needs a clear run to the ore" — so an ore patch was a bare disc
 * about 6 m wider than the ore itself, in a biome scattered to ~105-221 props
 * per hectare. With nothing drawn back into it, ore ground read as EMPTIER than
 * ordinary ground. A player scanning for a resource sees a mown clearing and
 * reads "nothing here", which is the exact opposite of the truth.
 *
 * That exclusion stays. This module is what fills the disc it clears.
 *
 * HOW IT DRAWS
 * ------------
 * ONE `InstancedMesh`, one instance per SEEDED cell. It is one colour draw and
 * one instanced shadow draw against a measured 145-218 scene draws. The
 * geometry is a small hard-faceted crystal cluster built from `PropMesh`
 * primitives, never a box (`MassList` rejects a silhouette more than ~85%
 * axis-aligned, and it would be right to).
 *
 * SCALE IS QUANTISED TO `ORE_DENSITY_STEPS`, and that is the point rather than
 * an optimisation. A cell fading continuously to nothing reads as a fog bug; a
 * cell that visibly drops through four discrete sizes and then vanishes reads
 * as ore being consumed. `Economy.ts`'s own header makes the case: "Ore visibly
 * draining is the single clearest signal this game gives that the economy is a
 * real system."
 *
 * UPDATES COME FROM `drainDirty` ONLY. Never a rescan: the map is 16 384 cells
 * and the changed set is normally single digits. Regrowth is free, because
 * `OreField.regrow` marks the same dirty list — VERIFIED rather than asserted
 * this time: one `regrow` pass on a stripped field leaves exactly 1 cell in
 * `pendingDirty`, which is also the exact count of cells that moved. The
 * instance matrix for a cell at density 0 is written all-zero, which is this
 * codebase's existing collapse idiom (`InstanceBatcher`, `Decals`) and costs no
 * branch in the shader.
 *
 * ONE cell, though — and that is why `CLUSTER_DROP` has an exemption now. The
 * dirty plumbing was never the reason regrowth could not be seen; the drop was.
 * See `drawsCluster`.
 *
 * THE SHROUD IS NOT OPTIONAL. Without `applyShroudTint` this module is a map
 * hack — every ore field on the map, visible through unexplored fog, which is
 * strictly worse than the defect it fixes. `FogOfWar`'s injection already
 * transforms through `instanceMatrix`, so an InstancedMesh needs no special
 * handling; it needs the tint and its own `customProgramCacheKey`.
 *
 * DETERMINISM. Per-instance yaw and scale jitter come from `hash2f(cx, cz)` —
 * the same pure hash `OreField.seedField` already uses — so the patch reads
 * blotchy rather than gridded, and two machines agree bit for bit. Nothing here
 * runs inside `simTick` and nothing writes sim state, but the hash is used
 * rather than `Math.random()` anyway, because a replay that re-renders
 * differently is a bug report waiting to happen.
 * ============================================================================
 */

import * as THREE from 'three';
import { nodePath } from '../render/gpu-path';

import { defineSystem } from '../core/loop';
import { RenderPhase } from '../core/types';
import { CELL, MAP_CELLS, ORE_CRYSTAL_COLOR, ORE_DENSITY_STEPS } from '../core/config';
import { ctx } from '../game/context';
import { getOreField } from '../sim/Economy';
import { applyShroudTint } from '../render/FogOfWar';
import { PropMesh } from './PropLibrary';
import { getTerrain } from './Terrain';

/**
 * Instances the mesh can hold.
 *
 * A continent map seeds five fields at 22-30 m radius, which is roughly 900
 * cells; the archipelago presets seed more, smaller ones. 4096 is generous
 * headroom at 64 bytes of matrix each — 256 kB, allocated once. Overflow is
 * clamped and logged rather than silently truncated, because an ore field that
 * renders half of itself is worse than one that renders none: it tells the
 * player the patch is smaller than it is.
 */
const MAX_ORE_INSTANCES = 4096;

/** Metres. A crystal cluster is knee-high on a 3.87 m harvester. */
const CRYSTAL_HEIGHT = 1.15;

/**
 * The smallest scale a live cell may draw at, as a fraction of full.
 *
 * A cell holding one unit of ore is still a cell a harvester will drive to, so
 * it has to be visible. Below about a third the cluster stops reading as
 * anything at gameplay zoom and the patch appears to have holes in it.
 */
const MIN_LIVE_SCALE = 0.34;

/**
 * Fraction of ore cells that draw no cluster at all.
 *
 * ONE CLUSTER PER CELL IS A PLANTATION. The grid is 4 m, so drawing every cell
 * puts a pile every four metres in a perfect lattice and the eye reconstructs
 * it instantly however hard each one is jittered. Dropping most of them and
 * enlarging the survivors is what turns a mosaic into clumps.
 *
 * The drop is a pure function of the cell, so it is stable frame to frame and
 * identical on every machine — a cell does not flicker in and out as it drains,
 * it is simply never one of the drawn ones. Mining is unaffected: every cell
 * still holds and yields ore, drawn or not.
 */
const CLUSTER_DROP = 0.62;

/** Survivors carry the dropped cells' visual mass, so a rich patch still reads rich. */
const CLUSTER_GAIN = 1.55;

/**
 * Does this cell draw a cluster at all? Pure, so the rule is testable without a
 * renderer — `tests/ore-regrowth.spec.ts` asserts the source exemption.
 *
 * THE SOURCE CELL IS EXEMPT FROM THE DROP, AND THAT IS NOT A NICETY.
 * `OreField.regrow` gates every other cell of a field on its upstream, so a
 * field stripped to zero has EXACTLY ONE cell growing — `rec.cells[0]`, the
 * source — for the first minute and a half. At `CLUSTER_DROP` 0.62 that cell
 * draws nothing about two thirds of the time: measured over 400 seeded fields,
 * the source drew a cluster in 136 of them, 34%. So on two fields out of three,
 * the whole first stage of a field coming back was invisible — 1/149 cells
 * holding ore at t=30 s and t=60 s, 0 of them drawn.
 *
 * That is a real part of "ore fields should regenerate over time": for most
 * fields there was no pixel anywhere on the map that said they were.
 *
 * One exempt cell per field cannot rebuild the lattice the drop exists to
 * break — it is one cluster in the middle of a 95-149 cell patch, and it is the
 * cell a player is looking at when they ask whether the patch is coming back.
 */
export function drawsCluster(cx: number, cz: number, isSource: boolean): boolean {
  return isSource || hashCell(cx + 977, cz + 313) >= CLUSTER_DROP;
}

/**
 * How far the cluster's base sits below the sampled ground height, as a
 * fraction of its height. The base is a flat disc and real terrain is never
 * flat, so an un-sunk cluster hangs in the air on its downhill side — which is
 * exactly the "seems just floating there" report.
 */
const SINK_FRACTION = 0.22;

/** Metres sampled around a cluster to align its buried foot to the terrain. */
const GROUND_SAMPLE_RADIUS = 0.46;

/* ==========================================================================
 * GEOMETRY
 * ========================================================================== */

/**
 * Add one hard-surface crystal: a prismatic shaft with a separate pointed cap.
 *
 * A cone tapers from the ground on every face and reads as a traffic marker.
 * Keeping most of the shard width through the shoulder creates the vertical
 * planes and sharp silhouette breaks a crystal needs. `leanX/Z` moves the
 * shoulder and tip while the foot stays buried, so no individual shard can
 * lift the whole cluster off the ground.
 */
function addCrystalShard(
  m: PropMesh,
  x: number,
  z: number,
  radius: number,
  height: number,
  sides: number,
  leanX: number,
  leanZ: number,
  yaw: number,
): void {
  const baseY = -0.06;
  const shoulderY = height * 0.72;
  const tipY = height;
  const shoulderX = x + leanX * 0.72;
  const shoulderZ = z + leanZ * 0.72;
  const tipX = x + leanX;
  const tipZ = z + leanZ;
  const shoulderRadius = radius * 0.78;
  const count = Math.max(4, Math.round(sides));

  for (let i = 0; i < count; i++) {
    const a0 = yaw + (i / count) * Math.PI * 2;
    const a1 = yaw + ((i + 1) / count) * Math.PI * 2;
    const c0 = Math.cos(a0), s0 = Math.sin(a0);
    const c1 = Math.cos(a1), s1 = Math.sin(a1);
    const ox = (c0 + c1) * 0.5 + leanX * 0.2;
    const oz = (s0 + s1) * 0.5 + leanZ * 0.2;

    m.quad(
      x + c0 * radius, baseY, z + s0 * radius,
      x + c1 * radius, baseY, z + s1 * radius,
      shoulderX + c1 * shoulderRadius, shoulderY, shoulderZ + s1 * shoulderRadius,
      shoulderX + c0 * shoulderRadius, shoulderY, shoulderZ + s0 * shoulderRadius,
      ox, 0.12, oz,
    );
    m.tri(
      shoulderX + c0 * shoulderRadius, shoulderY, shoulderZ + s0 * shoulderRadius,
      shoulderX + c1 * shoulderRadius, shoulderY, shoulderZ + s1 * shoulderRadius,
      tipX, tipY, tipZ,
      ox, 0.35, oz,
      true,
    );
  }
}

/**
 * A cluster of canted crystal shards with a buried mineral-bearing foot.
 *
 * FIVE SHARDS, NOT ONE, and not a spray of identical cones. The authored broad
 * planes catch the key light as distinct pieces, while the dark irregular foot
 * supplies contact and survives on snow, dirt and grass. The whole asset stays
 * one small shared geometry and is instanced for every visible ore cell.
 *
 * Exported for the geometry-budget test; production still builds it exactly
 * once during system init.
 */
export function buildCrystalCluster(): THREE.BufferGeometry {
  const m = new PropMesh();
  const gold = ORE_CRYSTAL_COLOR;
  const pale = '#FFD77A';
  const amber = '#D88A22';
  const deep = '#7D4B17';
  const earth = '#46351F';

  // Two overlapping, low-poly mineral-bearing rocks. Their lower halves are
  // below the local origin, so the cluster has a broad dark contact region but
  // never a visible circular "shadow decal" under it.
  m.color(earth).bevel(deep).ao(0.44, -0.18, 0.28);
  m.blob(-0.12, -0.04, 0.02, 0.68, 0.25, 0.64, 7, 3, 0.48, 0.18);
  m.color(deep).bevel(amber);
  m.blob(0.22, -0.02, -0.10, 0.48, 0.20, 0.45, 6, 3, 0.55, 0.62);

  // Tall anchor, offset from centre so the cluster does not read as a trophy.
  m.color(gold).bevel(pale).ao(0.50, -0.06, CRYSTAL_HEIGHT);
  addCrystalShard(m, 0.04, -0.05, 0.27, CRYSTAL_HEIGHT, 6, 0.10, -0.06, 0.12);

  // Broad mid shards define the cluster at normal gameplay zoom.
  m.color(amber).bevel(gold);
  addCrystalShard(m, -0.35, 0.18, 0.22, CRYSTAL_HEIGHT * 0.70, 5, -0.12, 0.06, 0.44);
  m.color(pale).bevel('#FFE6A6');
  addCrystalShard(m, 0.31, 0.24, 0.19, CRYSTAL_HEIGHT * 0.56, 5, 0.10, 0.08, 0.15);

  // Rear shard and dark stub break the three-spike rhythm and keep a depleted
  // (one-third scale) cluster legible as mineral rather than yellow grass.
  m.color(gold).bevel(pale);
  addCrystalShard(m, 0.24, -0.32, 0.16, CRYSTAL_HEIGHT * 0.43, 5, 0.07, -0.11, 0.70);
  m.color(deep).bevel(amber);
  addCrystalShard(m, -0.25, -0.29, 0.17, CRYSTAL_HEIGHT * 0.31, 5, -0.08, -0.05, 0.28);

  return m.toGeometry('ore.crystal');
}

/* ==========================================================================
 * THE DETERMINISTIC JITTER
 * ========================================================================== */

/**
 * A stable 0..1 hash of a cell. Integer arithmetic only — `Math.sin`-based
 * hashes are not bit-identical across engines, and this feeds a position that
 * two machines must agree on for a replay to look the same.
 */
function hashCell(cx: number, cz: number): number {
  let h = (cx * 0x1F1F1F1F) ^ (cz * 0x2545F491);
  h = Math.imul(h ^ (h >>> 15), 0x2C1B3C6D);
  h = Math.imul(h ^ (h >>> 12), 0x297A2D39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/* ==========================================================================
 * MODULE
 * ========================================================================== */

let mesh: THREE.InstancedMesh | null = null;
let material: THREE.Material | null = null;
let geometry: THREE.BufferGeometry | null = null;

/** Packed cell index -> instance slot, and back. Sized once at init. */
let slotOfCell: Map<number, number> | null = null;
let cellOfSlot: Int32Array | null = null;
/**
 * 1 for the slot holding a field's SOURCE cell (`OreFieldRecord.cells[0]`, the
 * one `regrow` seeds from), 0 otherwise. Read by `stamp` to exempt that slot
 * from `CLUSTER_DROP` — see `drawsCluster`.
 *
 * A flat array rather than a lookup on the field records, because `stamp` runs
 * once per dirty cell per frame and must not touch the sim.
 */
let sourceSlot: Uint8Array | null = null;
let instanceCount = 0;

/** Scratch, reused every frame. Never allocated in `frame`. */
const DIRTY = new Int32Array(2048);
const MAT = new THREE.Matrix4();
const POS = new THREE.Vector3();
const QUAT = new THREE.Quaternion();
const SCL = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const GROUND_NORMAL = new THREE.Vector3();
const SURFACE_QUAT = new THREE.Quaternion();
const YAW_QUAT = new THREE.Quaternion();

/**
 * Write one cell's transform into its instance slot.
 *
 * ============================== THE FIRST VERSION LOOKED WRONG ==============
 * "the ore you added to map is ugly as hell, seems just floating there and the
 * scatter is aweful". Both halves were fair and both had the same root cause:
 * the transform was doing far too little with the cell it was given.
 *
 * IT READ AS A LATTICE. One cluster per cell is one cluster every 4 m, and the
 * jitter was +-0.2 of a cell — under a metre — so the eye reconstructed the
 * grid immediately. A field is not a plantation. Two changes fix it: jitter
 * across the WHOLE cell, and DROP cells outright on a hash threshold so the
 * survivors sit at irregular spacing instead of on a thinned grid. Dropped
 * cells still mine; they simply are not each drawn as their own pile, which is
 * how RA2/RA3 read too — a field is clumps, not a mosaic.
 *
 * IT FLOATED. The cluster's base is a flat disc, and the position was the
 * terrain height at the centre point. On any slope the downhill rim then hangs
 * in the air, and the shipped terrain is never flat. The fix is to SINK the
 * origin — bury the base by a fraction of the cluster's height, so the
 * silhouette starts at the ground instead of resting on it — plus a small
 * per-instance tilt so the shards are not all plumb-vertical on sloped ground.
 * Sinking is the standard trick and it is why scattered rocks do not float.
 * ========================================================================== */
function stamp(slot: number, cx: number, cz: number, density: number): void {
  const im = mesh;
  if (im === null) return;

  const h = hashCell(cx, cz);
  const h2 = hashCell(cz, cx);
  const h3 = hashCell(cx + 977, cz + 313);

  // A cell that holds no ore, or one this field deliberately does not draw,
  // collapses to a zero matrix — draws nothing, costs no branch in the shader.
  if (density <= 0 || !drawsCluster(cx, cz, sourceSlot !== null && sourceSlot[slot] !== 0)) {
    MAT.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    im.setMatrixAt(slot, MAT);
    return;
  }

  // Quantised, so a draining cell steps visibly instead of dissolving.
  const step = Math.max(1, Math.ceil(density * ORE_DENSITY_STEPS));
  const q = step / ORE_DENSITY_STEPS;
  // Survivors carry the mass of the cells that dropped out, so a full patch
  // still reads as rich rather than as a thinned-out one.
  const scale = (MIN_LIVE_SCALE + (1 - MIN_LIVE_SCALE) * q) * CLUSTER_GAIN;

  const terrain = getTerrain();
  // The FULL cell, so no two neighbours share a spacing.
  const x = (cx + h) * CELL;
  const z = (cz + h2) * CELL;
  const y = terrain === null ? 0 : terrain.heightAt(x, z);

  // Sunk, so the flat base is under the surface and the silhouette starts at
  // the ground. Proportional to the instance's own scale or a small cluster
  // would bury itself.
  const sink = CRYSTAL_HEIGHT * SINK_FRACTION * scale;
  POS.set(x, y - sink, z);

  // Follow the actual ground plane instead of applying a random whole-cluster
  // lean. Random lean was what lifted one side of the old flat pedestal. The
  // shards already have authored cant, so the buried foot should obey terrain.
  if (terrain === null) {
    SURFACE_QUAT.identity();
  } else {
    const r = GROUND_SAMPLE_RADIUS * scale;
    const left = terrain.heightAt(x - r, z);
    const right = terrain.heightAt(x + r, z);
    const near = terrain.heightAt(x, z - r);
    const far = terrain.heightAt(x, z + r);
    GROUND_NORMAL.set(left - right, r * 2, near - far).normalize();
    SURFACE_QUAT.setFromUnitVectors(UP, GROUND_NORMAL);
  }
  YAW_QUAT.setFromAxisAngle(UP, h * Math.PI * 2);
  QUAT.copy(SURFACE_QUAT).multiply(YAW_QUAT);

  SCL.set(scale * (0.70 + h2 * 0.62), scale * (0.66 + h * 0.72), scale * (0.70 + h3 * 0.62));
  MAT.compose(POS, QUAT, SCL);
  im.setMatrixAt(slot, MAT);
}

/**
 * Fields the slot map was last built for. `-1` means "never built".
 *
 * `OreField.fieldCount` is the cheapest honest trigger: it is 0 until the
 * scenario seeds, then constant for the match. Comparing against it makes this
 * a one-shot that also survives a new scenario reseeding into the same module
 * instance, without polling anything expensive.
 */
let builtForFields = -1;

/**
 * Give every seeded cell a permanent instance slot, once ore exists.
 *
 * MEMBERSHIP NEVER CHANGES after this runs. A cell that drains to zero collapses
 * to a zero matrix and comes back when regrowth lifts it, so there is no
 * add/remove churn, no compaction, and no per-frame allocation — which is what
 * lets `frame()` be a pure `drainDirty` walk.
 */
function ensureSlots(ore: NonNullable<ReturnType<typeof getOreField>>): void {
  if (mesh === null) return;
  if (ore.fieldCount === builtForFields) return;
  if (ore.fieldCount === 0) return;
  builtForFields = ore.fieldCount;

  slotOfCell = new Map<number, number>();
  cellOfSlot = new Int32Array(MAX_ORE_INSTANCES);
  sourceSlot = new Uint8Array(MAX_ORE_INSTANCES);
  let n = 0;
  let overflow = 0;
  for (let f = 0; f < ore.fieldCount; f++) {
    const rec = ore.field(f);
    if (rec === undefined) continue;
    for (let k = 0; k < rec.cells.length; k++) {
      const packed = rec.cells[k];
      if (slotOfCell.has(packed)) continue;
      if (n >= MAX_ORE_INSTANCES) { overflow++; continue; }
      slotOfCell.set(packed, n);
      cellOfSlot[n] = packed;
      n++;
    }
    // `cells` is sorted by distance from the node, so `cells[0]` IS the source
    // `regrow` seeds from — and it is not necessarily the node COORDINATE, which
    // `seedField`'s `accept` predicate may have rejected (water, cliff, road).
    // Taken from the record rather than recomputed for exactly that reason.
    if (rec.cells.length > 0) {
      const src = slotOfCell.get(rec.cells[0]);
      if (src !== undefined) sourceSlot[src] = 1;
    }
  }
  instanceCount = n;
  if (overflow > 0) {
    // Loud, because a patch that renders short tells the player it is smaller
    // than it is — a worse lie than drawing nothing.
    console.warn(`[ore] ${overflow} cells past MAX_ORE_INSTANCES — patch renders short`);
  }

  for (let s = 0; s < instanceCount; s++) {
    const packed = cellOfSlot[s];
    const cx = packed % MAP_CELLS | 0;
    const cz = (packed / MAP_CELLS) | 0;
    stamp(s, cx, cz, ore.densityAt(cx, cz));
  }
  mesh.count = instanceCount;
  mesh.instanceMatrix.needsUpdate = true;

  // Drop anything queued during seeding: the full stamp above IS the truth, so
  // replaying those dirty cells would be redundant work on frame one.
  while (ore.pendingDirty > 0) ore.drainDirty(DIRTY);
  ctx().debug.counters.oreCrystals = instanceCount;
}

export default defineSystem({
  id: 'world.ore',
  // Terrain phase: the crystals sit ON the terrain and read its height, so they
  // must follow the terrain's own frame work. Before the bridge, so a harvester
  // parked on a cell is composited over crystals that already moved this frame.
  renderPhase: RenderPhase.Terrain,
  order: 60,

  init(): void {
    const { sceneRig, debug } = ctx();

    /* NO `getOreField()` CHECK HERE, and that omission is deliberate.
     *
     * `sim.economy.init()` is what calls `setActiveOreField`, and module init
     * order does not guarantee it has run yet — measured: it had not, so an
     * early return here left `OreCrystals` out of the scene graph entirely and
     * the renderer silently did nothing. That is the SECOND time this feature
     * has failed by being absent rather than wrong, which is a strong argument
     * for building the mesh unconditionally and resolving the data later.
     *
     * The mesh is therefore built with no dependency on the sim at all;
     * `ensureSlots` picks the field up on the first frame it exists and fills
     * in. Until then `count = 0` submits no draw.
     */
    geometry = buildCrystalCluster();
    /*
     * ONE PARAMETER OBJECT, TWO CONSTRUCTORS. The node twin is a
     * `MeshStandardNodeMaterial` wearing the same self-tint (`shroud-nodes.ts`
     * §4), and it is handed this literal verbatim so `vertexColors`, the
     * emissive and the roughness cannot drift between the two renderers.
     */
    const oreParams: THREE.MeshStandardMaterialParameters = {
      color: 0xffffff,
      vertexColors: true,
      // Mineral facets need a controlled glint, not the wet-plastic sheet the
      // old 0.22 surface produced under the noon key.
      roughness: 0.36,
      metalness: 0.0,
      // Ore glints. The emissive is deliberately weak — `post.ts` thresholds
      // bloom just above sunlit white paint, and ore that blooms would pull the
      // eye off units, which is the one thing the bible's readability section
      // will not trade for anything.
      emissive: new THREE.Color(ORE_CRYSTAL_COLOR),
      emissiveIntensity: 0.06,
    };
    const np = nodePath();
    if (np !== null) {
      material = np.createShroudTintedStandard(oreParams);
      material.name = 'OreCrystalMaterial';
    } else {
      const glsl = new THREE.MeshStandardMaterial(oreParams);
      glsl.name = 'OreCrystalMaterial';
      // Not optional — see the header. Without this, every ore field on the map
      // is visible through unexplored fog.
      glsl.onBeforeCompile = (shader) => { applyShroudTint(shader); };
      glsl.customProgramCacheKey = () => 'vm.ore.shroud.v1';
      material = glsl;
    }

    /* THE MESH IS ALLOCATED AT FULL CAPACITY AND FILLED LATER, and that split
     * is not tidiness — it is the whole reason this module works.
     *
     * `init()` runs long before any ore exists. Fields are seeded by the
     * SCENARIO, which runs at `Phase.Cleanup`, so at this point `fieldCount` is
     * 0 and enumerating seeded cells here yields an empty set. The first
     * version of this file did exactly that, drew nothing, and looked for all
     * the world like the module had failed to register — which is a
     * particularly bad failure mode for a renderer whose entire defect history
     * is "it was never written and nobody noticed".
     *
     * So: allocate once, at capacity, with `count = 0`; `ensureSlots` below
     * fills it on the first frame that finds ore, and refills if a new scenario
     * reseeds. Allocating 4096 instances up front costs 256 kB and no draw —
     * `count = 0` submits nothing.
     */
    mesh = new THREE.InstancedMesh(geometry, material, MAX_ORE_INSTANCES);
    mesh.name = 'OreCrystals';
    mesh.count = 0;
    // Still one instanced submission in the shadow pass. The nearest visible
    // clusters now ground correctly; far clusters remain below a shadow texel
    // and therefore cost no additional visible fill.
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    sceneRig.scene.add(mesh);
    debug.counters.oreCrystals = 0;
  },

  frame(): void {
    const ore = getOreField();
    if (mesh === null || ore === null) return;
    ensureSlots(ore);
    const im = mesh;
    if (slotOfCell === null || instanceCount === 0) return;
    if (ore.pendingDirty === 0) return;

    let touched = 0;
    // Bounded per frame. A pathological tick cannot make this unbounded work;
    // the remainder stays queued and is picked up next frame, which for a
    // scale change nobody can see in 16 ms is the right trade.
    const n = ore.drainDirty(DIRTY);
    for (let k = 0; k < n; k++) {
      const packed = DIRTY[k];
      const slot = slotOfCell.get(packed);
      // A cell outside every seeded field has no slot — scrap ore dropped by a
      // scenario, or a cell past MAX_ORE_INSTANCES. Skipping is correct: it was
      // never drawn, so there is nothing to update.
      if (slot === undefined) continue;
      const cx = packed % MAP_CELLS | 0;
      const cz = (packed / MAP_CELLS) | 0;
      stamp(slot, cx, cz, ore.densityAt(cx, cz));
      touched++;
    }
    if (touched > 0) im.instanceMatrix.needsUpdate = true;
  },

  dispose(): void {
    if (mesh !== null) {
      mesh.removeFromParent();
      mesh.dispose();
      mesh = null;
    }
    geometry?.dispose();
    geometry = null;
    material?.dispose();
    material = null;
    slotOfCell = null;
    cellOfSlot = null;
    sourceSlot = null;
    instanceCount = 0;
    /* RESET THE BUILD LATCH, and this line is not optional.
     *
     * `builtForFields` is module-level, and `dispose()` runs between matches
     * while the module object survives. Left at its old value, the next match
     * would skip `ensureSlots` entirely whenever the new scenario happened to
     * seed the SAME NUMBER of fields as the last one — which the shipped map
     * presets do constantly — and the second match of a session would render no
     * ore at all. Exactly the class of "works once, silently dead afterwards"
     * bug that `PerEntity*` generation stamping exists to prevent elsewhere.
     */
    builtForFields = -1;
  },
});
