/**
 * ============================================================================
 * RED ALERT — src/world/Water.ts
 * ============================================================================
 * THE WATER BODY: the field bake, the surface mesh, the wake buffer and the
 * query API four other modules will call.
 *
 * refs/ra3steam_00.jpg is the frame this module is judged against — a naval
 * battle where water is most of the picture. Look at it before touching
 * anything here: the water is DARK teal, the seabed reads as soft low-contrast
 * masses only in the shallows, every hull drags a white filigree wake, and
 * there is a permanent churned band on every metre of coastline. There is not
 * one reflection of anything anywhere in that image.
 *
 * WHAT THIS FILE OWNS
 * -------------------
 *  1. THE FIELD. One 512^2 RGBA8 texture over the whole 512 m map, baked from
 *     the terrain heightfield:
 *        R  signed depth, sqrt-encoded over +/-16 m
 *        G  SIGNED distance to the waterline, +/-12 m  (the shoreline band)
 *        B  seabed macro blobs, 0.8-4 TL across
 *        A  seabed grit, one octave finer
 *     The sqrt encoding is not a micro-optimisation: it spends the 8 bits
 *     where the eye is, giving ~3 cm of depth resolution in the first metre
 *     (where the absorption gradient is steepest) and ~25 cm at 16 m (where
 *     nothing is visible anyway). Linear encoding bands the shallows visibly.
 *
 *  2. THE MESH. 4x4 chunks of 128 m at a 2 m vertex grid. A quad is only
 *     emitted if it touches water, so a map with one lake pays for one lake,
 *     and typical naval framing costs 2-4 draw calls.
 *
 *  3. THE WAKE BUFFER. A world-space R8 accumulation texture (bible §7 and
 *     "where we beat RA3" item 10) rather than particle ribbons: ships splat
 *     into it, it decays on a fixed 30 Hz clock, and the decay pass only
 *     touches a tracked dirty rectangle — so an idle map costs exactly zero.
 *
 * WHY THE RAMP DEPTH IS FITTED TO THE MAP
 * ---------------------------------------
 * Bible §7 tunes the absorption ramp so colour reaches p10 by 2.4 TL (16.8 m)
 * of depth. Our basins are procedural and usually 2-5 m deep. Run at the
 * literal coefficients, a 2 m lake renders as one flat waterline tone: no
 * gradient, no depth read, the entire absorption identity invisible. So the
 * ramp depth is fitted to the map's own p97 depth and the absorption
 * coefficients are scaled by the same factor (see `WaterMaterial.applyAbsorb`).
 * The LOOK is preserved exactly — the seabed still disappears at the same
 * fraction of the way down — while the numbers follow the terrain that was
 * actually generated. This is the one place this module deliberately reads
 * the bible's intent rather than its literal constant, and it is documented
 * again at the constant in config.ts §21.
 * ============================================================================
 */

import * as THREE from 'three';
import {
  MAP_CELLS, MAP_SIZE, WATER_FIELD, WATER_LEVEL, WATER_LOOK, WATER_MESH,
  WATER_PALETTES, WATER_PALETTE_BY_BIOME, WATER_SEED, WATER_SHORE,
  WATER_TEXTURE_SIZE, WATER_WAKE, WATER_WAVES,
  type WaterPalette,
} from '../core/config';
import { DEG2RAD, TAU, clamp, clamp01, fbm2 } from '../core/math';
import { LAYERS, RENDER_ORDER } from '../render/scene';
import {
  createWaterMaterial, probeFoam, probeOpenWaterLuminance,
  type FoamProbe, type LuminanceProbe, type WaterLightRig, type WaterMaterialSet,
} from './WaterMaterial';

/* ==========================================================================
 * 1. DERIVED LAYOUT
 * ========================================================================== */

/** Field texels along one axis. */
export const FIELD_N = WATER_FIELD.resolution;
/** Metres per field texel. */
const FIELD_M = MAP_SIZE / FIELD_N;
const INV_FIELD_M = 1 / FIELD_M;

/** Wake texels along one axis. */
export const WAKE_N = WATER_WAKE.resolution;
const WAKE_M = MAP_SIZE / WAKE_N;
const INV_WAKE_M = 1 / WAKE_M;

/** Water mesh chunks along one axis. */
export const WATER_CHUNK_N = Math.round(MAP_SIZE / WATER_MESH.chunkMetres);
/** Quads along one chunk edge. */
const CHUNK_QUADS = Math.round(WATER_MESH.chunkMetres / WATER_MESH.gridMetres);

/** Anything at or below this depth is not water. */
const MIN_DEPTH = 0.02;

/* ==========================================================================
 * 2. THE HEIGHT SOURCE PORT
 *
 * Water only needs one thing from the terrain: bed height at a world point.
 * Taking a function instead of the Terrain class keeps this module testable
 * headless and stops it growing a dependency on the terrain's internals.
 * ========================================================================== */

export type BedHeightFn = (x: number, z: number) => number;

export interface WaterOptions {
  scene: THREE.Scene;
  /** Bed height in metres at a world position. Usually `terrain.heightAt`. */
  bedHeight: BedHeightFn;
  /** Still-water surface height. Defaults to `WATER_LEVEL`. */
  level?: number;
  /** Palette key into `WATER_PALETTES`, or a biome key. */
  palette?: string;
  seed?: number;
  anisotropy?: number;
  textureSize?: number;
}

export interface WaterStats {
  /** Fraction of the map below the waterline. */
  coverage: number;
  /** Deepest point, metres. */
  maxDepth: number;
  /** p97 depth — what the ramp is fitted to. */
  rampDepth: number;
  /** Metres of land/water contact on the map. */
  shorelineMetres: number;
  /** Chunks actually built (== draw calls when all are on screen). */
  chunks: number;
  triangles: number;
}

/* ==========================================================================
 * 3. WATER
 * ========================================================================== */

export class Water {
  readonly root = new THREE.Group();
  readonly materials: WaterMaterialSet;

  /** Depth in metres below the waterline, per field texel. Negative on land. */
  readonly depth = new Float32Array(FIELD_N * FIELD_N);
  /** Signed metres to the waterline: positive offshore, negative inland. */
  readonly shore = new Float32Array(FIELD_N * FIELD_N);
  /** Per-CELL water mask, so gameplay code can ask in cell space like ITerrain. */
  readonly waterCells = new Uint8Array(MAP_CELLS * MAP_CELLS);

  /** Still-water surface height in metres. */
  level: number;

  private readonly scene: THREE.Scene;
  private bedHeight: BedHeightFn;
  private readonly seed: number;

  private readonly fieldData = new Uint8Array(FIELD_N * FIELD_N * 4);
  private readonly fieldTexture: THREE.DataTexture;

  private readonly wakeData = new Uint8Array(WAKE_N * WAKE_N);
  private readonly wakeTexture: THREE.DataTexture;
  /** Decay LUT, rebuilt only when the decay factor actually changes. */
  private readonly decayLut = new Uint8Array(256);
  private decayFactor = -1;
  /** Dirty rectangle of the wake buffer, in texels. Empty when x1 < x0. */
  private wx0 = 1; private wx1 = 0; private wz0 = 1; private wz1 = 0;
  private wakeDirty = false;
  private wakeAccum = 0;
  private splatsThisTick = 0;

  private readonly chunks: THREE.Mesh[] = [];
  private palette: WaterPalette;
  private paletteKey: string;
  private statsCache: WaterStats;
  private time = 0;
  private disposed = false;

  /* -- scratch, never escapes -------------------------------------------- */
  private readonly _edtF = new Float64Array(FIELD_N);
  private readonly _edtD = new Float64Array(FIELD_N);
  private readonly _edtV = new Int32Array(FIELD_N);
  private readonly _edtZ = new Float64Array(FIELD_N + 1);
  private readonly _grad = new Float32Array(2);

  constructor(options: WaterOptions) {
    this.scene = options.scene;
    this.bedHeight = options.bedHeight;
    this.level = options.level ?? WATER_LEVEL;
    this.seed = (options.seed ?? WATER_SEED) | 0;
    this.paletteKey = resolvePaletteKey(options.palette);
    this.palette = WATER_PALETTES[this.paletteKey];

    this.fieldTexture = new THREE.DataTexture(
      this.fieldData, FIELD_N, FIELD_N, THREE.RGBAFormat, THREE.UnsignedByteType,
    );
    this.fieldTexture.name = 'water.field';
    this.fieldTexture.wrapS = THREE.ClampToEdgeWrapping;
    this.fieldTexture.wrapT = THREE.ClampToEdgeWrapping;
    this.fieldTexture.minFilter = THREE.LinearFilter;
    this.fieldTexture.magFilter = THREE.LinearFilter;
    this.fieldTexture.generateMipmaps = false;

    this.wakeTexture = new THREE.DataTexture(
      this.wakeData, WAKE_N, WAKE_N, THREE.RedFormat, THREE.UnsignedByteType,
    );
    this.wakeTexture.name = 'water.wake';
    this.wakeTexture.wrapS = THREE.ClampToEdgeWrapping;
    this.wakeTexture.wrapT = THREE.ClampToEdgeWrapping;
    this.wakeTexture.minFilter = THREE.LinearFilter;
    this.wakeTexture.magFilter = THREE.LinearFilter;
    this.wakeTexture.generateMipmaps = false;
    this.wakeTexture.needsUpdate = true;

    this.materials = createWaterMaterial({
      palette: this.palette,
      rampDepth: WATER_LOOK.rampDepthMin,
      seed: this.seed,
      textureSize: options.textureSize ?? WATER_TEXTURE_SIZE,
      anisotropy: options.anisotropy,
    });
    this.materials.setField(this.fieldTexture);
    this.materials.setWake(this.wakeTexture);
    this.materials.setWaterLevel(this.level);

    this.root.name = 'Water';
    this.root.matrixAutoUpdate = false;
    this.scene.add(this.root);

    this.statsCache = EMPTY_STATS;
    this.rebuild();
  }

  /* ======================================================================
   * 4. THE BAKE
   * ====================================================================== */

  /**
   * Re-derive everything from the current bed. Call after the terrain
   * regenerates (biome swap, seed re-roll) or after `setLevel`.
   *
   * Cost is ~25 ms for a 512^2 field: one heightfield resample, two exact
   * euclidean distance transforms and one mesh build. It is a load-time
   * operation and allocates nothing after the constructor.
   */
  rebuild(): void {
    this.sampleDepth();
    this.buildShoreDistance();
    this.packField();
    this.fitRamp();
    this.buildMeshes();
    this.clearWakes();
  }

  /** Resample the bed onto the field grid and derive the cell water mask. */
  private sampleDepth(): void {
    const d = this.depth;
    const lvl = this.level;
    for (let z = 0; z < FIELD_N; z++) {
      const wz = (z + 0.5) * FIELD_M;
      const row = z * FIELD_N;
      for (let x = 0; x < FIELD_N; x++) {
        d[row + x] = lvl - this.bedHeight((x + 0.5) * FIELD_M, wz);
      }
    }

    // Cell mask: a cell is water if its centre is. Matches ITerrain.isWater's
    // granularity so nav and water never disagree about a cell.
    const cellM = MAP_SIZE / MAP_CELLS;
    for (let cz = 0; cz < MAP_CELLS; cz++) {
      for (let cx = 0; cx < MAP_CELLS; cx++) {
        const wet = this.depthAt((cx + 0.5) * cellM, (cz + 0.5) * cellM) > MIN_DEPTH;
        this.waterCells[cz * MAP_CELLS + cx] = wet ? 1 : 0;
      }
    }
  }

  /**
   * Signed distance to the waterline, via two exact euclidean distance
   * transforms (Felzenszwalb & Huttenlocher, O(n) per axis).
   *
   * An approximate chamfer transform would be cheaper, but the shoreline band
   * is 2 m wide on a 1 m grid: a 5-8% distance error is a visible 10-15 cm
   * wobble in a band that scorecard #27 measures in pixels. Exact is worth
   * 8 ms once.
   */
  private buildShoreDistance(): void {
    const n = FIELD_N * FIELD_N;
    // Deliberately FINITE, not Infinity: the parabola intersection below
    // subtracts two of these, and Infinity - Infinity is NaN.
    const INF = 1e12;
    // 2 MB each and only alive during a rebuild — not worth keeping resident
    // for the whole match to save a load-time allocation.
    const land = new Float64Array(n);
    const water = new Float64Array(n);

    // Seed: distance-to-land is 0 on land; distance-to-water is 0 in water.
    for (let i = 0; i < n; i++) {
      const wet = this.depth[i] > 0;
      land[i] = wet ? INF : 0;
      water[i] = wet ? 0 : INF;
    }
    this.edt2d(land);
    this.edt2d(water);

    for (let i = 0; i < n; i++) {
      // Offshore: distance to the nearest land texel. Inland: negated
      // distance to the nearest water texel. The half-texel offset puts the
      // zero crossing on the contact instead of on the first wet texel.
      const s = this.depth[i] > 0
        ? Math.sqrt(land[i]) - 0.5
        : -(Math.sqrt(water[i]) - 0.5);
      this.shore[i] = s * FIELD_M;
    }
  }

  /** In-place squared EDT of a 2D grid of 0 / INF seeds. */
  private edt2d(grid: Float64Array): void {
    const f = this._edtF;
    const d = this._edtD;
    // Columns first.
    for (let x = 0; x < FIELD_N; x++) {
      for (let z = 0; z < FIELD_N; z++) f[z] = grid[z * FIELD_N + x];
      this.edt1d(f, d);
      for (let z = 0; z < FIELD_N; z++) grid[z * FIELD_N + x] = d[z];
    }
    // Then rows.
    for (let z = 0; z < FIELD_N; z++) {
      const row = z * FIELD_N;
      for (let x = 0; x < FIELD_N; x++) f[x] = grid[row + x];
      this.edt1d(f, d);
      for (let x = 0; x < FIELD_N; x++) grid[row + x] = d[x];
    }
  }

  /** 1D squared EDT: lower envelope of the parabolas rooted at each sample. */
  private edt1d(f: Float64Array, d: Float64Array): void {
    const n = FIELD_N;
    const v = this._edtV;
    const z = this._edtZ;
    let k = 0;
    v[0] = 0;
    z[0] = -Infinity;
    z[1] = Infinity;
    for (let q = 1; q < n; q++) {
      let p = v[k];
      let s = ((f[q] + q * q) - (f[p] + p * p)) / (2 * q - 2 * p);
      // Pop parabolas that have left the lower envelope. z[0] = -Infinity
      // guarantees this terminates at k = 0.
      while (s <= z[k]) {
        k--;
        p = v[k];
        s = ((f[q] + q * q) - (f[p] + p * p)) / (2 * q - 2 * p);
      }
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
      while (z[k + 1] < q) k++;
      const p = v[k];
      d[q] = (q - p) * (q - p) + f[p];
    }
  }

  /**
   * Encode depth, shore distance and the two seabed noises into the texture.
   *
   * The seabed noises are 18 m and 5 m features over a 512 m map — grossly
   * oversampled at the field's 1 m grid. They are generated on coarse grids
   * and bilinearly upsampled, which removes ~1.2 M simplex evaluations from
   * every bake for a difference no pixel can carry.
   */
  private packField(): void {
    const enc = WATER_FIELD.encodeMetres;
    const shoreEnc = WATER_SHORE.encodeMetres;
    const s = this.seed;

    const blob = noiseGrid(128, 1 / WATER_LOOK.seabedBlobMetres, 3, s + 5);
    const grit = noiseGrid(256, 1 / (WATER_LOOK.seabedBlobMetres * 0.28), 2, s + 17);

    for (let z = 0; z < FIELD_N; z++) {
      const row = z * FIELD_N;
      for (let x = 0; x < FIELD_N; x++) {
        const i = row + x;
        const o = i * 4;

        // Signed sqrt encoding: 8 bits, ~3 cm resolution in the first metre.
        const dNorm = clamp(this.depth[i] / enc, -1, 1);
        const sg = dNorm < 0 ? -1 : 1;
        this.fieldData[o] = enc8(0.5 + 0.5 * sg * Math.sqrt(Math.abs(dNorm)));

        this.fieldData[o + 1] = enc8(0.5 + 0.5 * clamp(this.shore[i] / shoreEnc, -1, 1));

        // Seabed: large soft masses 0.8-4 TL across, plus one finer octave.
        // Bible §7 caps the contrast at 18-25 L units, so these are deliberately
        // low-amplitude — a high-contrast seabed reads as a swimming pool.
        this.fieldData[o + 2] = enc8(0.5 + 0.42 * sampleGrid(blob, x, z));
        this.fieldData[o + 3] = enc8(0.5 + 0.42 * sampleGrid(grit, x, z));
      }
    }
    this.fieldTexture.needsUpdate = true;
  }

  /**
   * Fit the absorption ramp to the basin that was actually generated, and
   * collect the stats the boot log prints. See the file header for why.
   */
  private fitRamp(): void {
    const n = FIELD_N * FIELD_N;
    let wet = 0;
    let maxDepth = 0;
    // 64-bin histogram over 0..encodeMetres is enough to find a p97.
    const BINS = 64;
    const hist = new Uint32Array(BINS);
    const binM = WATER_FIELD.encodeMetres / BINS;
    for (let i = 0; i < n; i++) {
      const d = this.depth[i];
      if (d <= MIN_DEPTH) continue;
      wet++;
      if (d > maxDepth) maxDepth = d;
      const b = (d / binM) | 0;
      hist[b >= BINS ? BINS - 1 : b]++;
    }

    let p97 = 0;
    if (wet > 0) {
      const target = wet * 0.97;
      let acc = 0;
      for (let b = 0; b < BINS; b++) {
        acc += hist[b];
        if (acc >= target) { p97 = (b + 1) * binM; break; }
      }
    }

    const rampDepth = clamp(p97, WATER_LOOK.rampDepthMin, WATER_LOOK.rampDepthMetres);
    this.materials.applyPalette(this.palette, rampDepth);

    // Shoreline length: count field texels straddling the contact. Each such
    // texel contributes about one texel edge of coastline.
    let contact = 0;
    for (let z = 1; z < FIELD_N - 1; z++) {
      const row = z * FIELD_N;
      for (let x = 1; x < FIELD_N - 1; x++) {
        const i = row + x;
        if (this.depth[i] <= 0) continue;
        if (this.depth[i - 1] <= 0 || this.depth[i + 1] <= 0 ||
            this.depth[i - FIELD_N] <= 0 || this.depth[i + FIELD_N] <= 0) contact++;
      }
    }

    this.statsCache = {
      coverage: wet / n,
      maxDepth,
      rampDepth,
      shorelineMetres: contact * FIELD_M,
      chunks: 0,
      triangles: 0,
    };
  }

  /* ======================================================================
   * 5. THE MESH
   * ====================================================================== */

  private disposeMeshes(): void {
    for (let i = 0; i < this.chunks.length; i++) {
      const m = this.chunks[i];
      this.root.remove(m);
      m.geometry.dispose();
    }
    this.chunks.length = 0;
  }

  /**
   * One mesh per 128 m chunk that contains water, indexing only the quads
   * that touch it. The vertex buffer is the full chunk grid (50 KB) because
   * filtering vertices as well as quads would need a remap table for a
   * saving nobody can measure; the INDEX filter is what removes the overdraw,
   * and that is the expensive half.
   */
  private buildMeshes(): void {
    this.disposeMeshes();

    const S = CHUNK_QUADS;
    const g = WATER_MESH.gridMetres;
    const vn = (S + 1) * (S + 1);
    const margin = WATER_MESH.marginMetres;
    let triangles = 0;

    for (let cz = 0; cz < WATER_CHUNK_N; cz++) {
      for (let cx = 0; cx < WATER_CHUNK_N; cx++) {
        const ox = cx * WATER_MESH.chunkMetres;
        const oz = cz * WATER_MESH.chunkMetres;

        // Cheap reject: does this chunk touch water at all?
        if (!this.chunkHasWater(ox, oz, WATER_MESH.chunkMetres)) continue;

        const pos = new Float32Array(vn * 3);
        for (let vz = 0; vz <= S; vz++) {
          for (let vx = 0; vx <= S; vx++) {
            const v = (vz * (S + 1) + vx) * 3;
            pos[v] = vx * g;
            pos[v + 1] = this.level;
            pos[v + 2] = vz * g;
          }
        }

        // Emit a quad if any corner is within `margin` of the waterline. The
        // margin is what lets the fragment shader own the exact edge: the
        // geometry always extends a little past the water, and `discard`
        // trims it to the field's own sub-texel contour.
        const index: number[] = [];
        for (let vz = 0; vz < S; vz++) {
          for (let vx = 0; vx < S; vx++) {
            const x0 = ox + vx * g;
            const z0 = oz + vz * g;
            const d = Math.max(
              this.depthSigned(x0, z0), this.depthSigned(x0 + g, z0),
              this.depthSigned(x0, z0 + g), this.depthSigned(x0 + g, z0 + g),
            );
            if (d < -margin) continue;
            const a = vz * (S + 1) + vx;
            const b = a + (S + 1);
            const c = a + 1;
            const e = b + 1;
            index.push(a, b, c, c, b, e);
          }
        }
        if (index.length === 0) continue;

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setIndex(index);
        geo.computeBoundingBox();
        geo.computeBoundingSphere();
        // The vertex shader displaces Y by the swell, which the baked bounds
        // know nothing about. Pad rather than let a crest pop a chunk out of
        // the frustum at the edge of the screen.
        if (geo.boundingSphere) {
          geo.boundingSphere.radius += WATER_WAVES.swellAmplitude + WATER_MESH.boundsPadding;
        }

        const mesh = new THREE.Mesh(geo, this.materials.material);
        mesh.name = `water.chunk.${cx}.${cz}`;
        mesh.position.set(ox, 0, oz);
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        mesh.renderOrder = RENDER_ORDER.WATER;
        mesh.layers.set(LAYERS.DEFAULT);
        mesh.layers.enable(LAYERS.TERRAIN);
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        this.root.add(mesh);
        this.chunks.push(mesh);
        triangles += index.length / 3;
      }
    }

    this.statsCache = { ...this.statsCache, chunks: this.chunks.length, triangles };
  }

  private chunkHasWater(ox: number, oz: number, size: number): boolean {
    const x0 = Math.max(0, Math.floor(ox * INV_FIELD_M) - 2);
    const z0 = Math.max(0, Math.floor(oz * INV_FIELD_M) - 2);
    const x1 = Math.min(FIELD_N - 1, Math.ceil((ox + size) * INV_FIELD_M) + 2);
    const z1 = Math.min(FIELD_N - 1, Math.ceil((oz + size) * INV_FIELD_M) + 2);
    for (let z = z0; z <= z1; z++) {
      const row = z * FIELD_N;
      for (let x = x0; x <= x1; x++) {
        if (this.depth[row + x] > MIN_DEPTH) return true;
      }
    }
    return false;
  }

  /* ======================================================================
   * 6. THE QUERY API — what other modules call
   * ====================================================================== */

  /** Still-water surface height in metres. */
  get waterLevel(): number {
    return this.level;
  }

  /** Move the waterline. Rebuilds the field and the mesh — not a per-frame call. */
  setLevel(y: number): void {
    if (Math.abs(y - this.level) < 1e-4) return;
    this.level = y;
    this.materials.setWaterLevel(y);
    this.rebuild();
  }

  /**
   * True if there is water at a WORLD position (metres, not cells).
   *
   * NOTE the units: `ITerrain.isWater(cx, cz)` takes CELLS. This one takes
   * metres, because every caller that cares about water (VFX, audio, ship
   * bobbing, wake spawning) already has a world position. `isWaterCell` is
   * the cell-space form.
   */
  isWater(x: number, z: number): boolean {
    return this.depthAt(x, z) > MIN_DEPTH;
  }

  /** Cell-space form, matching the `ITerrain.isWater` signature. */
  isWaterCell(cx: number, cz: number): boolean {
    if (cx < 0 || cz < 0 || cx >= MAP_CELLS || cz >= MAP_CELLS) return false;
    return this.waterCells[cz * MAP_CELLS + cx] !== 0;
  }

  /** Metres of water above the bed at a world position. 0 on land. */
  depthAt(x: number, z: number): number {
    const d = this.depthSigned(x, z);
    return d > 0 ? d : 0;
  }

  /** Signed depth — negative is height of land above the waterline. */
  depthSigned(x: number, z: number): number {
    return sampleBilinear(this.depth, x, z);
  }

  /** Signed metres to the nearest shoreline: positive offshore, negative inland. */
  shoreDistanceAt(x: number, z: number): number {
    return sampleBilinear(this.shore, x, z);
  }

  /**
   * Surface height including the band-A swell — what a hull should float at.
   *
   * `time` MUST be passed explicitly from a sim system (`s.time`); the
   * defaulted render clock is wall-clock and would make ship bobbing
   * non-deterministic.
   */
  surfaceHeightAt(x: number, z: number, time = this.time): number {
    if (this.depthSigned(x, z) <= 0) return this.level;
    return this.level + this.swellAt(x, z, time, null);
  }

  /**
   * Surface normal from the swell alone (the chop and micro bands live only in
   * the normal map, which the CPU has no business sampling). Writes
   * [nx, ny, nz] into `out` and returns it.
   */
  surfaceNormalAt(x: number, z: number, out: Float32Array, time = this.time): Float32Array {
    this.swellAt(x, z, time, this._grad);
    const nx = -this._grad[0];
    const nz = -this._grad[1];
    const inv = 1 / Math.sqrt(nx * nx + nz * nz + 1);
    out[0] = nx * inv;
    out[1] = inv;
    out[2] = nz * inv;
    return out;
  }

  /**
   * The CPU mirror of the vertex shader's band-A swell. These two must stay in
   * step or ships float visibly above or below their own wake, so both derive
   * from the same WATER_WAVES constants and the same crest-sharpening.
   */
  private swellAt(x: number, z: number, time: number, grad: Float32Array | null): number {
    const w = WATER_WAVES;
    const d1 = w.swellHeadingDeg * DEG2RAD;
    const d2 = w.swellHeadingDeg2 * DEG2RAD;
    const k1 = TAU / w.swellMetres;
    const k2 = TAU / w.swellMetres2;
    const dx1 = Math.cos(d1); const dz1 = Math.sin(d1);
    const dx2 = Math.cos(d2); const dz2 = Math.sin(d2);
    const ph1 = (x * dx1 + z * dz1) * k1 - time * w.swellSpeed * k1;
    const ph2 = (x * dx2 + z * dz2) * k2 - time * w.swellSpeed * 0.83 * k2;
    const amp = w.swellAmplitude * (0.55 + 0.45 * w.seaState) *
      smoothstep01(0, 0.75, this.depthSigned(x, z));
    const k = w.swellSharpness;

    const s1 = Math.sin(ph1);
    const a1 = Math.max(Math.abs(s1), 1e-4);
    const h1 = Math.sign(s1) * Math.pow(a1, k);
    const s2 = Math.sin(ph2);
    const a2 = Math.max(Math.abs(s2), 1e-4);
    const h2 = Math.sign(s2) * Math.pow(a2, k);

    if (grad !== null) {
      const g1 = k * Math.pow(a1, k - 1) * Math.cos(ph1);
      const g2 = k * Math.pow(a2, k - 1) * Math.cos(ph2);
      const c1 = g1 * k1 * 0.62 * amp;
      const c2 = g2 * k2 * 0.38 * amp;
      grad[0] = dx1 * c1 + dx2 * c2;
      grad[1] = dz1 * c1 + dz2 * c2;
    }
    return (h1 * 0.62 + h2 * 0.38) * amp;
  }

  /* ======================================================================
   * 7. WAKES
   * ====================================================================== */

  /**
   * Splat a ship's wake into the world-space accumulation buffer.
   *
   * @param x        world X of the hull centre
   * @param z        world Z
   * @param heading  radians, the direction the hull is POINTING (atan2(dz, dx)
   *                 convention, matching `math.yawTo`)
   * @param strength 0..1, normally speed / maxSpeed. Below ~0.05 nothing lands.
   * @param hullMetres hull length; defaults to `WATER_WAKE.defaultHullMetres`
   *
   * Shape, per bible §7: a stern churn ellipse 1.3x hull width by 1.4-1.8 hull
   * lengths, plus two Kelvin arms at +/-19 degrees made of DISCRETE DASHES
   * extending 3.5-5 hull lengths. Dashes matter — a continuous line reads as a
   * vapour trail; RA3's arms are a dotted chevron.
   *
   * Safe to call from `simTick`: this writes a render-side buffer that nothing
   * in the simulation ever reads back, and it uses no RNG.
   */
  addWake(x: number, z: number, heading: number, strength: number, hullMetres?: number): void {
    if (this.disposed) return;
    const s = clamp01(strength);
    if (s < 0.05) return;
    if (this.splatsThisTick >= WATER_WAKE.maxSplatsPerTick) return;
    if (!this.isWater(x, z)) return;
    this.splatsThisTick++;

    const hull = hullMetres !== undefined && hullMetres > 0
      ? hullMetres : WATER_WAKE.defaultHullMetres;
    const g = WATER_WAKE.splatGain;
    const fx = Math.cos(heading);
    const fz = Math.sin(heading);

    // --- stern churn -----------------------------------------------------
    const sternLen = hull * WATER_WAKE.sternLengthMul;
    const sternHalfW = hull * 0.5 * WATER_WAKE.sternWidthMul * 0.5;
    const steps = Math.max(3, Math.round(sternLen * INV_WAKE_M * 0.8));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      // Behind the hull, tapering and fading astern.
      const cx = x - fx * (hull * 0.35 + t * sternLen);
      const cz = z - fz * (hull * 0.35 + t * sternLen);
      const w = sternHalfW * (1 - 0.45 * t);
      this.splatDisc(cx, cz, w, s * (1 - t) * 0.9 * g);
    }

    // --- Kelvin arms -----------------------------------------------------
    const arm = WATER_WAKE.armAngleDeg * DEG2RAD;
    const armLen = hull * WATER_WAKE.armLengthMul;
    const pitch = WATER_WAKE.armDashMetres + WATER_WAKE.armGapMetres;
    const dashes = Math.max(2, Math.floor(armLen / pitch));
    for (let side = -1; side <= 1; side += 2) {
      const a = heading + Math.PI + side * arm;
      const ax = Math.cos(a);
      const az = Math.sin(a);
      for (let dsh = 0; dsh < dashes; dsh++) {
        const d0 = hull * 0.3 + dsh * pitch;
        if (d0 > armLen) break;
        const fade = 1 - d0 / armLen;
        const amp = s * fade * fade * 0.85 * g;
        if (amp < 0.004) continue;
        const sub = Math.max(1, Math.round(WATER_WAKE.armDashMetres * INV_WAKE_M));
        for (let k = 0; k <= sub; k++) {
          const dd = d0 + (k / sub) * WATER_WAKE.armDashMetres;
          this.splatDisc(x + ax * dd, z + az * dd, WATER_WAKE.armWidthMetres * 0.5, amp);
        }
      }
    }
  }

  /** Additive, saturating splat of a soft disc into the wake buffer. */
  private splatDisc(x: number, z: number, radius: number, amount: number): void {
    const r = Math.max(radius, WAKE_M * 0.5);
    const tx = x * INV_WAKE_M;
    const tz = z * INV_WAKE_M;
    const tr = r * INV_WAKE_M;
    let x0 = Math.floor(tx - tr); let x1 = Math.ceil(tx + tr);
    let z0 = Math.floor(tz - tr); let z1 = Math.ceil(tz + tr);
    if (x1 < 0 || z1 < 0 || x0 >= WAKE_N || z0 >= WAKE_N) return;
    if (x0 < 0) x0 = 0; if (z0 < 0) z0 = 0;
    if (x1 > WAKE_N - 1) x1 = WAKE_N - 1;
    if (z1 > WAKE_N - 1) z1 = WAKE_N - 1;

    const peak = amount * 255;
    const invR2 = 1 / (tr * tr);
    for (let tzi = z0; tzi <= z1; tzi++) {
      const dz = tzi + 0.5 - tz;
      const row = tzi * WAKE_N;
      for (let txi = x0; txi <= x1; txi++) {
        const dx = txi + 0.5 - tx;
        const q = (dx * dx + dz * dz) * invR2;
        if (q >= 1) continue;
        // Smooth falloff so the accumulation reads as churn, not as pixels.
        const f = (1 - q) * (1 - q);
        const v = this.wakeData[row + txi] + peak * f;
        this.wakeData[row + txi] = v > 255 ? 255 : v;
      }
    }
    if (!this.wakeDirty) {
      this.wakeDirty = true;
      this.wx0 = x0; this.wx1 = x1; this.wz0 = z0; this.wz1 = z1;
    } else {
      if (x0 < this.wx0) this.wx0 = x0;
      if (x1 > this.wx1) this.wx1 = x1;
      if (z0 < this.wz0) this.wz0 = z0;
      if (z1 > this.wz1) this.wz1 = z1;
    }
  }

  /** Wipe every wake. Called on rebuild and between matches. */
  clearWakes(): void {
    this.wakeData.fill(0);
    this.wakeDirty = false;
    this.wx0 = 1; this.wx1 = 0; this.wz0 = 1; this.wz1 = 0;
    this.wakeTexture.needsUpdate = true;
  }

  /**
   * Decay the wake buffer on a fixed clock and upload it.
   *
   * Two things keep this off the frame budget: it runs at 30 Hz, not at the
   * frame rate, and it only walks the dirty rectangle — which the pass itself
   * shrinks as texels reach zero, so a map whose ships have stopped goes fully
   * idle within one half-life instead of paying 262k multiplies forever.
   */
  private decayWakes(dt: number): void {
    this.wakeAccum += dt;
    const step = 1 / WATER_WAKE.decayHz;
    if (this.wakeAccum < step) return;
    const ticks = Math.min(6, Math.floor(this.wakeAccum / step));
    this.wakeAccum -= ticks * step;
    this.splatsThisTick = 0;
    if (!this.wakeDirty) return;

    const factor = Math.pow(0.5, (ticks * step) / WATER_WAKE.halfLifeSec);
    if (factor !== this.decayFactor) {
      this.decayFactor = factor;
      for (let i = 0; i < 256; i++) {
        const v = i * factor;
        // Floor to zero once a texel is below one 8-bit step, or the rect
        // never shrinks and the "idle costs nothing" property is lost.
        this.decayLut[i] = v < 1 ? 0 : v | 0;
      }
    }

    let nx0: number = WAKE_N; let nx1 = -1; let nz0: number = WAKE_N; let nz1 = -1;
    for (let z = this.wz0; z <= this.wz1; z++) {
      const row = z * WAKE_N;
      let rowLive = false;
      for (let x = this.wx0; x <= this.wx1; x++) {
        const v = this.decayLut[this.wakeData[row + x]];
        this.wakeData[row + x] = v;
        if (v !== 0) {
          rowLive = true;
          if (x < nx0) nx0 = x;
          if (x > nx1) nx1 = x;
        }
      }
      if (rowLive) {
        if (z < nz0) nz0 = z;
        if (z > nz1) nz1 = z;
      }
    }

    if (nx1 < 0) {
      this.wakeDirty = false;
      this.wx0 = 1; this.wx1 = 0; this.wz0 = 1; this.wz1 = 0;
    } else {
      this.wx0 = nx0; this.wx1 = nx1; this.wz0 = nz0; this.wz1 = nz1;
    }
    this.wakeTexture.needsUpdate = true;
  }

  /* ======================================================================
   * 8. FRAME
   * ====================================================================== */

  /** Advance the shader clock, decay the wakes, push the current light rig. */
  update(dt: number, rig: WaterLightRig | null): void {
    if (this.disposed || this.chunks.length === 0) return;
    this.time += dt;
    this.materials.setTime(this.time);
    if (rig !== null) this.materials.applyLighting(rig);
    this.decayWakes(dt);
  }

  /* ======================================================================
   * 9. LIFECYCLE AND REPORTING
   * ====================================================================== */

  /** Swap palette. Free — no texture rebuild, no shader recompile. */
  setPalette(key: string): void {
    const resolved = resolvePaletteKey(key);
    if (resolved === this.paletteKey) return;
    this.paletteKey = resolved;
    this.palette = WATER_PALETTES[resolved];
    this.materials.applyPalette(this.palette, this.statsCache.rampDepth);
  }

  get paletteName(): string {
    return this.paletteKey;
  }

  /** Replace the bed source and re-bake. Used when the terrain regenerates. */
  setBedHeight(fn: BedHeightFn): void {
    this.bedHeight = fn;
    this.rebuild();
  }

  setSeaState(v: number): void {
    this.materials.setSeaState(v);
  }

  setAnisotropy(a: number): void {
    this.materials.setAnisotropy(a);
  }

  stats(): WaterStats {
    return this.statsCache;
  }

  /** True when the map is landlocked and this module drew nothing. */
  get isEmpty(): boolean {
    return this.chunks.length === 0;
  }

  get drawCalls(): number {
    return this.chunks.length;
  }

  /** Scorecard #25 — see WaterMaterial.probeOpenWaterLuminance. */
  probeLuminance(rig: WaterLightRig, exposure: number, tone: 'agx' | 'aces' | 'none'): LuminanceProbe {
    return probeOpenWaterLuminance(this.palette, this.statsCache.rampDepth, rig, exposure, tone);
  }

  /** Scorecard #26 — see WaterMaterial.probeFoam. */
  probeFoamCoverage(): FoamProbe {
    return probeFoam();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.disposeMeshes();
    this.scene.remove(this.root);
    this.fieldTexture.dispose();
    this.wakeTexture.dispose();
    this.materials.dispose();
  }
}

/* ==========================================================================
 * 10. MODULE-PRIVATE HELPERS
 * ========================================================================== */

const EMPTY_STATS: WaterStats = {
  coverage: 0, maxDepth: 0, rampDepth: WATER_LOOK.rampDepthMin,
  shorelineMetres: 0, chunks: 0, triangles: 0,
};

function enc8(v: number): number {
  const c = v < 0 ? 0 : v > 1 ? 1 : v;
  return (c * 255 + 0.5) | 0;
}

interface CoarseGrid {
  readonly n: number;
  readonly data: Float32Array;
}

/** fbm over the whole map on an (n+1)^2 grid, for bilinear upsampling. */
function noiseGrid(n: number, scale: number, octaves: number, seed: number): CoarseGrid {
  const data = new Float32Array((n + 1) * (n + 1));
  const step = MAP_SIZE / n;
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      data[j * (n + 1) + i] = fbm2(i * step * scale, j * step * scale, octaves, 2, 0.5, seed);
    }
  }
  return { n, data };
}

/** Bilinear read of a coarse grid at field-texel coordinates. */
function sampleGrid(g: CoarseGrid, fx: number, fz: number): number {
  const sx = (fx + 0.5) * FIELD_M * (g.n / MAP_SIZE);
  const sz = (fz + 0.5) * FIELD_M * (g.n / MAP_SIZE);
  let i0 = sx | 0; if (i0 > g.n - 1) i0 = g.n - 1;
  let j0 = sz | 0; if (j0 > g.n - 1) j0 = g.n - 1;
  const tx = sx - i0;
  const tz = sz - j0;
  const r0 = j0 * (g.n + 1) + i0;
  const r1 = r0 + (g.n + 1);
  const a = g.data[r0] + (g.data[r0 + 1] - g.data[r0]) * tx;
  const b = g.data[r1] + (g.data[r1 + 1] - g.data[r1]) * tx;
  return a + (b - a) * tz;
}

function smoothstep01(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

/**
 * Bilinear sample of a field-resolution grid at a world position. Texel
 * centres sit at (i + 0.5) metres, matching the bake and the shader's own
 * `texture2D(uField, p / MAP_SIZE)`.
 */
function sampleBilinear(grid: Float32Array, x: number, z: number): number {
  let fx = x * INV_FIELD_M - 0.5;
  let fz = z * INV_FIELD_M - 0.5;
  if (!(fx > 0)) fx = 0; else if (fx > FIELD_N - 1) fx = FIELD_N - 1;
  if (!(fz > 0)) fz = 0; else if (fz > FIELD_N - 1) fz = FIELD_N - 1;
  let x0 = fx | 0; if (x0 > FIELD_N - 2) x0 = FIELD_N - 2;
  let z0 = fz | 0; if (z0 > FIELD_N - 2) z0 = FIELD_N - 2;
  const tx = fx - x0;
  const tz = fz - z0;
  const r0 = z0 * FIELD_N + x0;
  const r1 = r0 + FIELD_N;
  const a = grid[r0] + (grid[r0 + 1] - grid[r0]) * tx;
  const b = grid[r1] + (grid[r1 + 1] - grid[r1]) * tx;
  return a + (b - a) * tz;
}

/** Accepts a palette key or a biome key; falls back to temperate with a warn. */
function resolvePaletteKey(key: string | undefined): string {
  if (key === undefined) return 'temperate';
  if (WATER_PALETTES[key] !== undefined) return key;
  const viaBiome = WATER_PALETTE_BY_BIOME[key];
  if (viaBiome !== undefined && WATER_PALETTES[viaBiome] !== undefined) return viaBiome;
  console.warn(
    `[water] unknown palette "${key}" — using temperate. ` +
    `Known: ${Object.keys(WATER_PALETTES).join(', ')}`,
  );
  return 'temperate';
}

/* ==========================================================================
 * 11. THE MODULE-LEVEL ACCESSOR
 *
 * Same shape as `getTerrain()` in Terrain.ts: movement calls `addWake`, VFX
 * calls `isWater`, audio calls `depthAt`, and none of them should have to
 * thread a reference through five constructors to do it.
 * ========================================================================== */

let active: Water | null = null;

export function getWater(): Water | null {
  return active;
}

export function setActiveWater(w: Water | null): void {
  active = w;
}

/**
 * Convenience for the movement system: safe to call whether or not a water
 * module exists on this map. Returns true if the wake actually landed.
 */
export function addWake(
  x: number, z: number, heading: number, strength: number, hullMetres?: number,
): boolean {
  if (active === null || active.isEmpty) return false;
  active.addWake(x, z, heading, strength, hullMetres);
  return true;
}

/** Water surface height at a world point, or -Infinity where there is no water. */
export function waterLevelAt(x: number, z: number): number {
  if (active === null) return -Infinity;
  return active.isWater(x, z) ? active.waterLevel : -Infinity;
}
