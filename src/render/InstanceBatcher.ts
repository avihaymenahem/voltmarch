/**
 * ============================================================================
 * VOLTMARCH — src/render/InstanceBatcher.ts
 * ============================================================================
 * ONE INSTANCED DRAW PER MODEL PART. THE DRAW-CALL BUDGET LIVES OR DIES HERE.
 *
 * WHAT A BATCH IS
 * ---------------
 * A `InstanceBatch` is one MODEL — a Grizzly tank, a Power Plant — rendered as
 * 1..N `THREE.InstancedMesh` "parts", one per (geometry, material) pair. Every
 * part shares ONE slot allocator, so instance 7 is the same entity in the hull
 * mesh and in the turret mesh. That is what lets the bridge slew a turret
 * independently of its hull without a second lookup.
 *
 * WHY TEAM COLOUR IS AN ATTRIBUTE AND NOT A BATCH KEY
 * ---------------------------------------------------
 * If Allied and Soviet Rhinos were separate batches, every shared model would
 * cost two draws and the 130-call budget would be gone before the first shot is
 * fired. So `aTeamColor` is a per-instance vec3 and one batch covers both
 * armies. An art module that hands the SAME `KindMesh` object to both factions
 * gets exactly one batch — see RenderBridge's dedupe.
 *
 * PER-INSTANCE CHANNELS
 * ---------------------
 *   instanceMatrix : mat4  (built in) — composed by the bridge, never by an Object3D
 *   aState         : vec4  (hpFrac, buildProgress, selected, seed)
 *   aTeamColor     : vec3  LINEAR rgb, ready to multiply into a material
 *
 * A material that never declares these attributes simply ignores them; the
 * binding state only wires what the compiled program actually asks for.
 *
 * ALLOCATION DISCIPLINE
 * ---------------------
 *  - Capacity grows GEOMETRICALLY (never per spawn) and every part of a batch
 *    grows in lockstep so slot indices stay valid across all of them.
 *  - Freeing a slot writes an all-zero matrix. A zero basis collapses every
 *    triangle of that instance to a point, so a recycled slot can never flash a
 *    stale pose for one frame — the single most common instancing bug.
 *  - Only the dirty slot range is uploaded (`attribute.updateRanges`), using a
 *    POOLED range object so the frame loop allocates nothing.
 *  - The bounding sphere is maintained from the instance translations we are
 *    already touching, so frustum culling is correct without an O(n) matrix
 *    decompose per frame. `InstancedMesh.computeBoundingSphere()` is never
 *    called.
 * ============================================================================
 */

import * as THREE from 'three';
import {
  INSTANCE_BATCH_GROWTH,
  INSTANCE_BATCH_INITIAL_CAPACITY,
  INSTANCE_BATCH_MAX_CAPACITY,
  INSTANCE_BOUNDS_PADDING,
} from '../core/config';
import { PartId } from '../core/types';
import { LAYERS, RENDER_ORDER } from './scene';

/* ==========================================================================
 * 1. SPECS
 * ========================================================================== */

/** One drawable piece of a model: a (geometry, material) pair plus its anchor. */
export interface BatchPartSpec {
  geometry: THREE.BufferGeometry;
  /** A single material, or an array when the geometry carries draw groups. */
  material: THREE.Material | THREE.Material[];
  /** Local offset from the model origin (ground-plane centre), metres. */
  offsetX?: number;
  offsetY?: number;
  offsetZ?: number;
  /** True when this piece slews with the turret instead of the hull. */
  followsTurret?: boolean;
  /** Which sub-part this is, so anim/VFX can find it. */
  part?: PartId;
  castShadow?: boolean;
  receiveShadow?: boolean;
  /** Extra camera layer to enable (LAYERS.UNITS / LAYERS.BUILDINGS). */
  layer?: number;
  /** Sort band. Defaults to RENDER_ORDER.OPAQUE. */
  renderOrder?: number;
}

/** Names the batch owns on its private geometry. Everything else is shared. */
const OWNED_ATTRIBUTES = ['aState', 'aTeamColor'] as const;

/**
 * Readable `PartId` names for mesh naming and the scene inspector. `PartId` is
 * a const enum, so it has no runtime reverse map — this table IS the reverse
 * map. Order must match `PartId` in core/types.ts.
 */
const PART_NAMES: readonly string[] = [
  'root', 'turret', 'barrel', 'muzzleA', 'muzzleB', 'exhaust', 'antenna',
  'hopper', 'scoop', 'dish', 'door', 'crane', 'conveyor', 'coilTip',
  'turbine', 'stack', 'dockEntry', 'exitPoint', 'flagPole', 'emitter',
];

/* ==========================================================================
 * 2. GEOMETRY SHARING
 *
 * The art module owns its geometry and may register it for several batches.
 * We must attach OUR per-instance attributes without touching theirs, so each
 * part gets a private BufferGeometry that REFERENCES the source's vertex
 * attributes (one GPU buffer, shared) and adds `aState` / `aTeamColor`.
 * ========================================================================== */

function instanceGeometry(src: THREE.BufferGeometry, name: string): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.name = `${name}#inst`;

  for (const key in src.attributes) {
    g.setAttribute(key, src.attributes[key]);
  }
  if (src.index !== null) g.setIndex(src.index);
  for (let i = 0; i < src.groups.length; i++) {
    const grp = src.groups[i];
    g.addGroup(grp.start, grp.count, grp.materialIndex);
  }
  g.setDrawRange(src.drawRange.start, src.drawRange.count);
  // Morph targets are shared by reference; RTS models do not use them, but a
  // silent drop here would be a nasty surprise for whoever eventually does.
  g.morphAttributes = src.morphAttributes;
  g.morphTargetsRelative = src.morphTargetsRelative;

  if (src.boundingSphere === null) src.computeBoundingSphere();
  if (src.boundingBox === null) src.computeBoundingBox();
  g.boundingSphere = src.boundingSphere !== null ? src.boundingSphere.clone() : new THREE.Sphere();
  g.boundingBox = src.boundingBox !== null ? src.boundingBox.clone() : new THREE.Box3();

  return g;
}

/**
 * Dispose a private instance geometry WITHOUT freeing the source's shared GPU
 * buffers. `WebGLGeometries.onGeometryDispose` removes every attribute it finds,
 * so the shared ones have to be detached first or another batch using the same
 * source geometry would silently lose its vertex buffer.
 */
function disposeInstanceGeometry(g: THREE.BufferGeometry): void {
  for (const key in g.attributes) {
    if ((OWNED_ATTRIBUTES as readonly string[]).includes(key)) continue;
    g.deleteAttribute(key);
  }
  g.setIndex(null);
  g.morphAttributes = {};
  g.dispose();
}

/* ==========================================================================
 * 3. BATCH PART
 * ========================================================================== */

/**
 * One InstancedMesh inside a batch. The bridge writes `matrix` DIRECTLY — that
 * is the hot path and a setter per float would double its cost.
 */
export class BatchPart {
  readonly mesh: THREE.InstancedMesh;
  /** `mesh.instanceMatrix.array`, cached. 16 floats per slot, column-major. */
  matrix: Float32Array;
  /** `aState` backing store, cached. 4 floats per slot. */
  state: Float32Array;
  /** `aTeamColor` backing store, cached. 3 floats per slot. */
  team: Float32Array;

  readonly offsetX: number;
  readonly offsetY: number;
  readonly offsetZ: number;
  readonly followsTurret: boolean;
  readonly part: PartId;

  /** Radius of the source geometry plus its anchor offset, in metres. */
  readonly localRadius: number;

  private readonly geometry: THREE.BufferGeometry;
  /**
   * Pooled update ranges — one per channel — so `endFrame` never allocates.
   * The renderer empties `updateRanges` after uploading, but it never retains
   * the objects, so re-pushing the same three every frame is safe.
   */
  private readonly rangeMatrix = { start: 0, count: 0 };
  private readonly rangeState = { start: 0, count: 0 };
  private readonly rangeTeam = { start: 0, count: 0 };

  constructor(spec: BatchPartSpec, capacity: number, name: string) {
    this.offsetX = spec.offsetX ?? 0;
    this.offsetY = spec.offsetY ?? 0;
    this.offsetZ = spec.offsetZ ?? 0;
    this.followsTurret = spec.followsTurret === true;
    this.part = spec.part ?? PartId.Root;

    this.geometry = instanceGeometry(spec.geometry, name);
    const bs = this.geometry.boundingSphere!;
    const anchor = Math.sqrt(
      this.offsetX * this.offsetX + this.offsetY * this.offsetY + this.offsetZ * this.offsetZ,
    );
    // The source sphere's centre is model-local; fold it in so an off-centre
    // mass (a turret authored around its ring) is still fully enclosed.
    this.localRadius = bs.radius + bs.center.length() + anchor;

    this.state = new Float32Array(capacity * 4);
    this.team = new Float32Array(capacity * 3);
    this.geometry.setAttribute(
      'aState',
      new THREE.InstancedBufferAttribute(this.state, 4).setUsage(THREE.DynamicDrawUsage),
    );
    this.geometry.setAttribute(
      'aTeamColor',
      new THREE.InstancedBufferAttribute(this.team, 3).setUsage(THREE.DynamicDrawUsage),
    );

    this.mesh = new THREE.InstancedMesh(this.geometry, spec.material, capacity);
    // `PartId` is a const enum — there is no reverse map at runtime, so the
    // readable name comes from PART_NAMES.
    this.mesh.name = `${name}:${PART_NAMES[this.part] ?? this.part}`;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.castShadow = spec.castShadow !== false;
    this.mesh.receiveShadow = spec.receiveShadow !== false;
    this.mesh.renderOrder = spec.renderOrder ?? RENDER_ORDER.OPAQUE;
    this.mesh.layers.set(LAYERS.DEFAULT);
    if (spec.layer !== undefined && spec.layer !== LAYERS.DEFAULT) {
      this.mesh.layers.enable(spec.layer);
    }
    // The mesh sits at the world origin forever: instance matrices are already
    // world-space, and `Frustum.intersectsObject` transforms our bounding
    // sphere by `matrixWorld`, which must therefore stay identity.
    this.mesh.matrixAutoUpdate = false;
    this.mesh.updateMatrix();
    this.mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 0);
    this.mesh.frustumCulled = true;

    this.matrix = this.mesh.instanceMatrix.array as Float32Array;
  }

  /** Grow every per-instance channel, preserving slot indices. */
  grow(capacity: number): void {
    const nextMatrix = new Float32Array(capacity * 16);
    nextMatrix.set(this.matrix);
    // NOTE: the previous attribute's GL buffer is only reclaimed on context
    // loss. Growth is geometric and stops after warm-up, so the total waste is
    // bounded by one final buffer — a few tens of KB, once, per batch.
    this.mesh.instanceMatrix = new THREE.InstancedBufferAttribute(nextMatrix, 16).setUsage(
      THREE.DynamicDrawUsage,
    );
    this.matrix = nextMatrix;

    const nextState = new Float32Array(capacity * 4);
    nextState.set(this.state);
    this.state = nextState;
    this.geometry.setAttribute(
      'aState',
      new THREE.InstancedBufferAttribute(nextState, 4).setUsage(THREE.DynamicDrawUsage),
    );

    const nextTeam = new Float32Array(capacity * 3);
    nextTeam.set(this.team);
    this.team = nextTeam;
    this.geometry.setAttribute(
      'aTeamColor',
      new THREE.InstancedBufferAttribute(nextTeam, 3).setUsage(THREE.DynamicDrawUsage),
    );
  }

  /**
   * Push the dirty slot span to the GPU.
   *
   * If a previous frame's range is still queued the mesh was never rendered, so
   * that upload never happened. Clearing the queue makes the driver do one full
   * `bufferSubData` instead, which is the only way to cover both spans.
   */
  upload(minSlot: number, maxSlot: number, drawCount: number): void {
    this.mesh.count = drawCount;
    if (minSlot > maxSlot) return;

    const count = maxSlot - minSlot + 1;
    this.uploadAttribute(this.mesh.instanceMatrix, this.rangeMatrix, minSlot * 16, count * 16);
    this.uploadAttribute(
      this.geometry.getAttribute('aState') as THREE.BufferAttribute,
      this.rangeState, minSlot * 4, count * 4,
    );
    this.uploadAttribute(
      this.geometry.getAttribute('aTeamColor') as THREE.BufferAttribute,
      this.rangeTeam, minSlot * 3, count * 3,
    );
  }

  private uploadAttribute(
    attr: THREE.BufferAttribute,
    range: { start: number; count: number },
    start: number,
    count: number,
  ): void {
    if (attr.updateRanges.length > 0) {
      // A range is still queued, which means the mesh was culled or hidden
      // before the renderer drained it — that upload never happened. Clearing
      // the queue makes the driver do one full bufferSubData, the only way to
      // cover the old span and the new one together.
      attr.clearUpdateRanges();
    } else {
      range.start = start;
      range.count = count;
      attr.updateRanges.push(range);
    }
    attr.needsUpdate = true;
  }

  setVisible(v: boolean): void {
    this.mesh.visible = v;
  }

  setBounds(cx: number, cy: number, cz: number, radius: number): void {
    const s = this.mesh.boundingSphere!;
    s.center.set(cx, cy, cz);
    s.radius = radius + this.localRadius + INSTANCE_BOUNDS_PADDING;
  }

  dispose(): void {
    this.mesh.dispose();
    disposeInstanceGeometry(this.geometry);
  }
}

/* ==========================================================================
 * 4. BATCH
 * ========================================================================== */

export class InstanceBatch {
  readonly parts: BatchPart[] = [];
  readonly name: string;

  private cap: number;
  /** LIFO free list of slot indices. */
  private freeList: Int32Array;
  private freeCount: number;
  /** 1 = slot in use. Drives the `drawCount` shrink. */
  private used: Uint8Array;
  /** Highest slot currently in use, or -1. */
  private high = -1;
  private live = 0;

  /** Dirty span for this frame, in slots. */
  private dirtyMin = 0x7fffffff;
  private dirtyMax = -1;

  /** World-space AABB of the live instance origins, rebuilt every frame. */
  private minX = 0; private minY = 0; private minZ = 0;
  private maxX = 0; private maxY = 0; private maxZ = 0;
  private boundsCount = 0;

  constructor(specs: readonly BatchPartSpec[], name: string) {
    this.name = name;
    this.cap = Math.min(INSTANCE_BATCH_INITIAL_CAPACITY, INSTANCE_BATCH_MAX_CAPACITY);

    this.freeList = new Int32Array(this.cap);
    this.used = new Uint8Array(this.cap);
    for (let i = 0; i < this.cap; i++) this.freeList[i] = this.cap - 1 - i;
    this.freeCount = this.cap;

    for (let i = 0; i < specs.length; i++) {
      this.parts.push(new BatchPart(specs[i], this.cap, name));
    }
    for (let s = 0; s < this.cap; s++) this.initSlotMatrix(s);
  }

  get capacity(): number { return this.cap; }
  get liveCount(): number { return this.live; }
  /** Instances the GPU is asked to draw: everything up to the high-water slot. */
  get drawCount(): number { return this.high + 1; }
  get partCount(): number { return this.parts.length; }

  /** The constant elements of a column-major affine matrix: [3]=[7]=[11]=0, [15]=1. */
  private initSlotMatrix(slot: number): void {
    const o = slot * 16;
    for (let p = 0; p < this.parts.length; p++) {
      const m = this.parts[p].matrix;
      m[o + 3] = 0; m[o + 7] = 0; m[o + 11] = 0; m[o + 15] = 1;
    }
  }

  /** Claim a slot. Returns -1 only when the batch has hit MAX_ENTITIES. */
  alloc(): number {
    if (this.freeCount === 0 && !this.grow()) return -1;
    const slot = this.freeList[--this.freeCount];
    this.used[slot] = 1;
    this.live++;
    if (slot > this.high) this.high = slot;
    this.markDirty(slot);
    return slot;
  }

  /**
   * Release a slot and blank it. An all-zero basis collapses the instance to a
   * point, so no stale pose can survive into the next frame.
   */
  free(slot: number): void {
    if (slot < 0 || slot >= this.cap || this.used[slot] === 0) return;
    this.used[slot] = 0;
    this.live--;
    this.freeList[this.freeCount++] = slot;

    const o = slot * 16;
    for (let p = 0; p < this.parts.length; p++) {
      const m = this.parts[p].matrix;
      for (let k = 0; k < 16; k++) m[o + k] = 0;
    }
    this.markDirty(slot);

    // Shrink the drawn range when the tail empties out.
    if (slot === this.high) {
      let h = this.high;
      while (h >= 0 && this.used[h] === 0) h--;
      this.high = h;
    }
  }

  /** True if a slot currently belongs to somebody. */
  isUsed(slot: number): boolean {
    return slot >= 0 && slot < this.cap && this.used[slot] === 1;
  }

  markDirty(slot: number): void {
    if (slot < this.dirtyMin) this.dirtyMin = slot;
    if (slot > this.dirtyMax) this.dirtyMax = slot;
  }

  /**
   * Write the four state floats, marking dirty ONLY on a real change so a
   * stationary building costs no upload.
   */
  writeState(slot: number, hpFrac: number, buildProgress: number, selected: number, seed: number): void {
    const o = slot * 4;
    for (let p = 0; p < this.parts.length; p++) {
      const a = this.parts[p].state;
      if (a[o] !== hpFrac || a[o + 1] !== buildProgress || a[o + 2] !== selected || a[o + 3] !== seed) {
        a[o] = hpFrac; a[o + 1] = buildProgress; a[o + 2] = selected; a[o + 3] = seed;
        this.markDirty(slot);
      }
    }
  }

  /** Team colour, LINEAR rgb. Changes only on capture, so this is nearly free. */
  writeTeam(slot: number, r: number, g: number, b: number): void {
    const o = slot * 3;
    for (let p = 0; p < this.parts.length; p++) {
      const a = this.parts[p].team;
      if (a[o] !== r || a[o + 1] !== g || a[o + 2] !== b) {
        a[o] = r; a[o + 1] = g; a[o + 2] = b;
        this.markDirty(slot);
      }
    }
  }

  /** Feed one instance origin into this frame's bounding box. */
  addBounds(x: number, y: number, z: number): void {
    if (this.boundsCount === 0) {
      this.minX = this.maxX = x;
      this.minY = this.maxY = y;
      this.minZ = this.maxZ = z;
    } else {
      if (x < this.minX) this.minX = x; else if (x > this.maxX) this.maxX = x;
      if (y < this.minY) this.minY = y; else if (y > this.maxY) this.maxY = y;
      if (z < this.minZ) this.minZ = z; else if (z > this.maxZ) this.maxZ = z;
    }
    this.boundsCount++;
  }

  beginFrame(): void {
    this.dirtyMin = 0x7fffffff;
    this.dirtyMax = -1;
    this.boundsCount = 0;
  }

  /** Upload the dirty span and refresh the culling sphere. */
  endFrame(): void {
    const visible = this.live > 0;
    const draw = visible ? this.high + 1 : 0;

    let cx = 0, cy = 0, cz = 0, radius = 0;
    if (this.boundsCount > 0) {
      cx = (this.minX + this.maxX) * 0.5;
      cy = (this.minY + this.maxY) * 0.5;
      cz = (this.minZ + this.maxZ) * 0.5;
      const hx = (this.maxX - this.minX) * 0.5;
      const hy = (this.maxY - this.minY) * 0.5;
      const hz = (this.maxZ - this.minZ) * 0.5;
      radius = Math.sqrt(hx * hx + hy * hy + hz * hz);
    }

    for (let p = 0; p < this.parts.length; p++) {
      const part = this.parts[p];
      part.setVisible(visible);
      part.setBounds(cx, cy, cz, radius);
      part.upload(this.dirtyMin, this.dirtyMax, draw);
    }
  }

  /** Geometric growth. False when already at the hard ceiling. */
  private grow(): boolean {
    if (this.cap >= INSTANCE_BATCH_MAX_CAPACITY) return false;
    const next = Math.min(
      Math.max(this.cap * INSTANCE_BATCH_GROWTH, this.cap + 1),
      INSTANCE_BATCH_MAX_CAPACITY,
    ) | 0;

    for (let p = 0; p < this.parts.length; p++) this.parts[p].grow(next);

    const used = new Uint8Array(next);
    used.set(this.used);
    this.used = used;

    // Rebuild the free list: the old free slots plus everything newly added,
    // seeded in reverse so the lowest index is handed out first.
    const freeList = new Int32Array(next);
    let n = 0;
    for (let s = next - 1; s >= 0; s--) if (used[s] === 0) freeList[n++] = s;
    this.freeList = freeList;
    this.freeCount = n;

    const oldCap = this.cap;
    this.cap = next;
    for (let s = oldCap; s < next; s++) this.initSlotMatrix(s);
    // Everything below the old capacity keeps its data; the new tail is zeroed
    // by the Float32Array allocation, so nothing stale can appear.
    return true;
  }

  dispose(): void {
    for (let p = 0; p < this.parts.length; p++) this.parts[p].dispose();
    this.parts.length = 0;
    this.live = 0;
    this.high = -1;
  }
}

/* ==========================================================================
 * 5. BATCHER
 * ========================================================================== */

/** Owns every batch and drives their per-frame begin/end. */
export class InstanceBatcher {
  private readonly batches: InstanceBatch[] = [];
  private readonly root: THREE.Group;

  constructor(private readonly scene: THREE.Scene) {
    this.root = new THREE.Group();
    this.root.name = '__instanceBatches';
    this.root.matrixAutoUpdate = false;
    this.root.updateMatrix();
    this.scene.add(this.root);
  }

  createBatch(specs: readonly BatchPartSpec[], name: string): InstanceBatch {
    const batch = new InstanceBatch(specs, name);
    for (let p = 0; p < batch.parts.length; p++) this.root.add(batch.parts[p].mesh);
    this.batches.push(batch);
    return batch;
  }

  destroyBatch(batch: InstanceBatch): void {
    const i = this.batches.indexOf(batch);
    if (i < 0) return;
    this.batches.splice(i, 1);
    for (let p = 0; p < batch.parts.length; p++) this.root.remove(batch.parts[p].mesh);
    batch.dispose();
  }

  beginFrame(): void {
    for (let i = 0; i < this.batches.length; i++) this.batches[i].beginFrame();
  }

  endFrame(): void {
    for (let i = 0; i < this.batches.length; i++) this.batches[i].endFrame();
  }

  get batchCount(): number { return this.batches.length; }

  /** Draw calls this batcher will contribute this frame (visible parts only). */
  get meshCount(): number {
    let n = 0;
    for (let i = 0; i < this.batches.length; i++) {
      if (this.batches[i].liveCount > 0) n += this.batches[i].partCount;
    }
    return n;
  }

  get instanceCount(): number {
    let n = 0;
    for (let i = 0; i < this.batches.length; i++) n += this.batches[i].liveCount;
    return n;
  }

  dispose(): void {
    for (let i = 0; i < this.batches.length; i++) {
      const batch = this.batches[i];
      for (let p = 0; p < batch.parts.length; p++) this.root.remove(batch.parts[p].mesh);
      batch.dispose();
    }
    this.batches.length = 0;
    this.scene.remove(this.root);
  }
}
