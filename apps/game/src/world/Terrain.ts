/**
 * ============================================================================
 * VOLTMARCH — src/world/Terrain.ts
 * ============================================================================
 * THE CHUNK MESHES, THE SPLAT TEXTURES, AND NOTHING ELSE.
 *
 * The heightfield, the nav grids, the ramp carver, the start-area guarantee and
 * the whole query API live in `./terrain-gen.ts`, which imports no THREE and no
 * DOM so a Web Worker can run it. This file is the renderer's half: a subclass
 * that adds a scene, two `DataTexture`s, two terrain batches and a material set.
 *
 * WHY THE SPLIT EXISTS. Terrain generation was 600-1300 ms of unbroken
 * main-thread time at boot, and the loading curtain cannot animate through any
 * of it. `src/core/workers/world-warm.ts` now hands the generation to a worker
 * at module-discovery time, so it runs while `art.buildings` and `art.units`
 * are building their models on this thread. Vite emits the worker's import
 * graph as its own chunk, which is why the generator may not touch THREE — the
 * identical rule `src/core/surfaces.ts` and `src/art/greeble-gen.ts` live under.
 *
 * THE PUBLIC SURFACE IS UNCHANGED. Every constant and type this module has ever
 * exported is re-exported below, so nothing that imports `./Terrain` had to
 * move. `Terrain` still generates in its constructor unless it is handed a
 * `fields` set to adopt, and `adopt()` is byte-identical to `generate()` by
 * construction: there is one implementation of every pass, in the base class,
 * and both paths run it.
 *
 * THE ONE THING THAT DID CHANGE. `TerrainOptions.sea` used to be resolved
 * against the `setPlannedSea()` channel INSIDE the base constructor. The
 * generator has no module-level channel to read (a worker gets a message, not a
 * global), so the resolution moved here — see the constructor. The behaviour is
 * the same: omit `sea` and you get the planned one.
 * ============================================================================
 */

import * as THREE from 'three';
import { nodePath, type TerrainMaterialSetLike } from '../render/gpu-path';
import { TERRAIN_CHUNK_METRES, TERRAIN_LAYER_TEXTURE_SIZE, type SeaSpec } from '../core/config';
import { LAYERS, RENDER_ORDER } from '../render/scene';
import type { BiomeDef } from './Biomes';
import {
  createTerrainMaterials, type TerrainMaterialSet, type TerrainTextureData,
} from './TerrainMaterial';
import {
  CHUNK_N, CHUNK_QUADS, GRID, SPLAT_N, TerrainFields, buildTerrainChunks, chunkCastsShadow,
  drawnTerrainHeightAt, terrainGenKey,
  type TerrainFieldData, type TerrainGenOptions,
} from './terrain-gen';

/* ==========================================================================
 * 1. THE PUBLIC SURFACE OF THE OLD FILE
 *
 * Re-exported rather than moved, because eight modules and a dozen specs import
 * these from here and the split is an implementation detail of this module, not
 * a change to its contract.
 * ========================================================================== */

export {
  GRID, GRID_N, GRID_STRIDE, GRID_COUNT, CHUNK_N, SPLAT_N,
  PASS_FOOT, PASS_TRACK, PASS_WHEEL, PASS_HOVER, PASS_STATIC, PASS_GROUND,
  COST_UNIT, COST_BLOCKED,
  TerrainFields, generateTerrainFields, terrainGenKey, terrainFieldTransfers,
} from './terrain-gen';
export type {
  StartPoint, StartArea, StartAreaReport, TerrainGenOptions, TerrainFieldData,
} from './terrain-gen';

/* ==========================================================================
 * 2. TERRAIN
 * ========================================================================== */

export interface TerrainOptions extends TerrainGenOptions {
  scene: THREE.Scene;
  /** Renderer capability, pushed in so this module never touches the GL context. */
  anisotropy?: number;
  /**
   * A field set generated elsewhere — by a worker, during boot — to adopt
   * instead of generating.
   *
   * `world/terrain.system.ts` is the only caller that passes one, and it passes
   * `null` whenever the prewarm missed, was switched off with
   * `?terrainworkers=off`, or could not start a worker at all. A null is not an
   * error: it means "generate it here", which is what this class did before the
   * worker existed.
   *
   * The fields are CHECKED against `terrainGenKey` before they are adopted, so
   * a set generated for a different seed, biome, start layout or shoreline is
   * refused rather than quietly drawn.
   */
  fields?: TerrainFieldData | null;
  /**
   * The layer, warp and macro TILES, generated elsewhere. Passed straight
   * through to `createTerrainMaterials`, which checks its own key.
   *
   * Separate from `fields` and deliberately so: the fields are a generation of
   * THIS MAP — seed, biome, starts and shoreline — while the tiles depend only
   * on `(biome, layerTextureSize, seed)`. That is why the texture job can be
   * dispatched alongside the terrain job instead of behind it.
   */
  textures?: TerrainTextureData | null;
}

/**
 * Everything in `TerrainFields`, plus the meshes.
 *
 * `sea` is resolved before `super()` because the base constructor uses it to
 * push start points inland, and it has to be a value by then.
 */
export class Terrain extends TerrainFields {
  private readonly splatTexA: THREE.DataTexture;
  private readonly splatTexB: THREE.DataTexture;

  private readonly scene: THREE.Scene;
  private readonly root = new THREE.Group();
  private readonly batches: THREE.BatchedMesh[] = [];
  /** Which chunk index the colour renderer selected during the last mesh build. */
  private readonly drawnLod = new Uint8Array(CHUNK_N * CHUNK_N);
  private terrainTriangles = 0;
  /**
   * `TerrainMaterialSetLike`, not `TerrainMaterialSet` — the GLSL set and
   * `TerrainNodeMaterial`'s twin have the same METHODS and different TYPES.
   * See `render/gpu-path.ts`.
   */
  readonly materials: TerrainMaterialSetLike;

  constructor(options: TerrainOptions) {
    super({
      seed: options.seed,
      biome: options.biome,
      starts: options.starts,
      // THE SEA CHANNEL, resolved here rather than in the generator. See the
      // file header: a worker has no module-level state to read, so the base
      // takes an explicit value and this is the only place the default lives.
      sea: options.sea !== undefined ? options.sea : plannedSea(),
    });

    this.scene = options.scene;

    this.splatTexA = makeSplatTexture(this.splatA, 'terrain.splatA');
    this.splatTexB = makeSplatTexture(this.splatB, 'terrain.splatB');

    const terrainOptions = {
      biome: this.biomeDef,
      layerTextureSize: TERRAIN_LAYER_TEXTURE_SIZE,
      seed: this.seed,
      textures: options.textures ?? null,
    };
    const np = nodePath();
    this.materials = np !== null
      ? np.createTerrainMaterials(terrainOptions)
      : createTerrainMaterials(terrainOptions);
    this.materials.setSplat(this.splatTexA, this.splatTexB);
    if (options.anisotropy !== undefined) this.materials.setAnisotropy(options.anisotropy);

    this.root.name = 'Terrain';
    this.root.matrixAutoUpdate = false;
    this.scene.add(this.root);

    /*
     * ADOPT OR GENERATE — and the key comparison is what makes that safe.
     *
     * A prewarmed set is only ever accepted when it was generated from exactly
     * these inputs. Anything else falls through to `generate()`, which is the
     * path this class has always taken and is the fallback for every failure
     * mode of the worker: no `Worker` on the platform, a script that will not
     * load, a job that timed out, a URL flag that turned it off.
     */
    const pre = options.fields ?? null;
    if (pre !== null && pre.key === this.genKey) this.adopt(pre);
    else this.generate();
  }

  /** The key the prewarmed fields must carry to be adopted. */
  get genKey(): string {
    return terrainGenKey({
      seed: this.seed, biome: this.biomeDef.key, starts: this.startRequest, sea: this.seaSpec,
    });
  }

  /* ======================================================================
   * 3. GEOMETRY
   * ====================================================================== */

  private disposeMeshes(): void {
    for (let i = 0; i < this.batches.length; i++) {
      const batch = this.batches[i];
      this.root.remove(batch);
      batch.dispose();
    }
    this.batches.length = 0;
    this.terrainTriangles = 0;
  }

  /**
   * Wrap the 8x8 chunks' vertex attributes in geometry.
   *
   * THE ARITHMETIC IS NOT HERE ANY MORE. It is `buildTerrainChunks` in
   * `./terrain-gen.ts`, and it moved for a measured reason: with generation
   * already off-thread, this init still stopped the boot for ~330 ms and all of
   * it was the vertex loop. What is left below genuinely needs THREE —
   * `BufferGeometry`, `BatchedMesh`, layers, bounds — and does not cross
   * `postMessage`.
   *
   * `adoptedChunks` is a worker's set, consumed once. When it is null (a biome
   * swap, a seed re-roll, `?terrainworkers=off`, any worker failure) the same
   * function runs here instead, so an adopted mesh and a locally derived one
   * are the same vertices by construction.
   */
  protected override buildMeshes(): void {
    this.disposeMeshes();

    const chunks = this.adoptedChunks
      ?? buildTerrainChunks(this.height, this.wallUp, this.wallTop);
    this.adoptedChunks = null;
    this.drawnLod.fill(0);
    for (const chunk of chunks) {
      if (chunk.lodIndex !== null) this.drawnLod[chunk.cz * CHUNK_N + chunk.cx] = 1;
    }

    /*
     * A BatchedMesh still keeps every chunk as an independently transformed,
     * independently frustum-culled draw range. The difference is that Three's
     * WebGPU renderer sees ONE render object instead of compiling the same
     * TerrainNodeMaterial once for every visible chunk. Relief and flat chunks
     * remain separate because only the former belong in the shadow pass.
     */
    for (const castsShadow of [false, true]) {
      const group = chunks.filter((c) => chunkCastsShadow(c.cliffTris) === castsShadow);
      if (group.length === 0) continue;

      let vertexCount = 0;
      let indexCount = 0;
      for (const c of group) {
        vertexCount += c.position.length / 3;
        indexCount += (c.lodIndex ?? c.index).length;
      }

      const batch = new THREE.BatchedMesh(
        group.length,
        vertexCount,
        indexCount,
        this.materials.material,
      );
      batch.name = castsShadow ? 'terrain.batch.relief' : 'terrain.batch.flat';
      batch.perObjectFrustumCulled = true;
      // Opaque terrain does not need per-frame depth sorting; chunk order is
      // immaterial because the depth buffer resolves it.
      batch.sortObjects = false;
      batch.castShadow = castsShadow;
      batch.receiveShadow = true;
      batch.renderOrder = RENDER_ORDER.TERRAIN;
      batch.layers.set(LAYERS.DEFAULT);
      batch.layers.enable(LAYERS.TERRAIN);
      batch.matrixAutoUpdate = false;
      batch.updateMatrix();

      const matrix = new THREE.Matrix4();
      for (const c of group) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(c.position, 3));
        geo.setAttribute('normal', new THREE.BufferAttribute(c.normal, 3));
        geo.setAttribute('aUp', new THREE.BufferAttribute(c.up, 1));
        geo.setAttribute('aTop', new THREE.BufferAttribute(c.top, 1));
        /*
         * THE HALF-RESOLUTION INDEX WHEN THE CHUNK EARNED ONE — 2424 triangles
         * against 8192, over the SAME position/normal/aUp/aTop buffers. There is
         * no second geometry, no second upload and no runtime switch: which index
         * a chunk draws was decided in `buildTerrainChunks`, off-thread, from the
         * heightfield alone. Its own header explains why this cannot crack
         * against a full-resolution neighbour.
         */
        const index = c.lodIndex ?? c.index;
        geo.setIndex(new THREE.BufferAttribute(index, 1));
        geo.computeBoundingSphere();
        geo.computeBoundingBox();

        const geometryId = batch.addGeometry(geo);
        const instanceId = batch.addInstance(geometryId);
        matrix.makeTranslation(
          c.cx * TERRAIN_CHUNK_METRES,
          0,
          c.cz * TERRAIN_CHUNK_METRES,
        );
        batch.setMatrixAt(instanceId, matrix);
        this.terrainTriangles += index.length / 3;
        // addGeometry copied the attributes into the batch-owned buffers.
        geo.dispose();
      }

      batch.computeBoundingBox();
      batch.computeBoundingSphere();
      this.root.add(batch);
      this.batches.push(batch);
    }
  }

  /**
   * Presentation height of the triangle mesh currently submitted for colour.
   * Gameplay continues to use `heightAt`; close ground overlays use the higher
   * of the two so neither the authoritative field nor its optimized draw mesh
   * can pass through them.
   */
  drawnHeightAt(x: number, z: number): number {
    const cx = Math.min(Math.max(Math.floor(x / (CHUNK_QUADS * GRID)), 0), CHUNK_N - 1);
    const cz = Math.min(Math.max(Math.floor(z / (CHUNK_QUADS * GRID)), 0), CHUNK_N - 1);
    return drawnTerrainHeightAt(this.height, x, z, this.drawnLod[cz * CHUNK_N + cx] !== 0);
  }

  /** Upload the control textures after a batch of `stampSurface` calls. */
  override commitSplat(): void {
    this.splatTexA.needsUpdate = true;
    this.splatTexB.needsUpdate = true;
  }

  protected override applyBiomeToMaterials(biome: BiomeDef): void {
    this.materials.applyBiome(biome);
  }

  /* ======================================================================
   * 4. LIFECYCLE
   * ====================================================================== */

  /** Triangle count across every chunk, for the perf budget readout. */
  triangleCount(): number {
    return this.terrainTriangles;
  }

  dispose(): void {
    this.disposeMeshes();
    this.scene.remove(this.root);
    this.splatTexA.dispose();
    this.splatTexB.dispose();
    this.materials.dispose();
  }
}

/* ==========================================================================
 * 5. MODULE-PRIVATE HELPERS
 * ========================================================================== */

/** A splat control texture: data, not colour. No mips, no sRGB, no filtering surprises. */
function makeSplatTexture(data: Uint8Array, name: string): THREE.DataTexture {
  const tex = new THREE.DataTexture(data, SPLAT_N, SPLAT_N, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.name = name;
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/* ==========================================================================
 * 6. THE ACTIVE INSTANCE
 *
 * `world.terrain` covers the ITerrain port, but several modules need the
 * terrain-specific extras (`surfaceAt`, `passGrid`, `stampSurface`,
 * `setBiome`) that the port deliberately does not carry. They reach them here
 * rather than importing terrain.system.ts, so the system file stays a thin
 * registration shim.
 * ========================================================================== */

let active: Terrain | null = null;

/** The live terrain, or null before `terrain.system.ts` has run its init. */
export function getTerrain(): Terrain | null {
  return active;
}

/** Set by terrain.system.ts. Nothing else may call this. */
export function setActiveTerrain(t: Terrain | null): void {
  active = t;
}

/* --------------------------------------------------------------------------
 * THE SEA CHANNEL
 *
 * `world/terrain.system.ts` is a thin registration shim and constructs
 * `Terrain` with no knowledge of scenarios. The shoreline a scenario declares
 * has to arrive BEFORE that constructor runs, which rules out
 * `activeScenario()` (published last, at Phase.Cleanup order 10 000) and rules
 * out an import from `src/game/` in this file (Scenarios.ts already imports
 * `getTerrain` from here — the cycle would be real).
 *
 * So the plan is pushed in from the outside, exactly the way `setActiveTerrain`
 * is pulled out. `src/world/sea.system.ts` owns the push and runs at
 * `Phase.Command, order: 20` — after nothing in particular, and before
 * `world.terrain` at order 40.
 * -------------------------------------------------------------------------- */

let plannedSeaSpec: SeaSpec | null = null;

/**
 * Declare the sea the NEXT `Terrain` will be generated with. Set by
 * `sea.system.ts` from `plannedScenario().sea`; null means landlocked, which
 * is what every fixture but `naval` gets.
 */
export function setPlannedSea(sea: SeaSpec | null): void {
  plannedSeaSpec = sea;
}

/** The sea a `Terrain` will pick up when its options do not name one. */
export function plannedSea(): SeaSpec | null {
  return plannedSeaSpec;
}
