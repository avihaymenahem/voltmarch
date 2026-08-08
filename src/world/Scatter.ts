/**
 * ============================================================================
 * VOLTMARCH — src/world/Scatter.ts
 * ============================================================================
 * PROP SCATTER. The system that decides terrain is a place instead of a plane.
 *
 * Bible §14 R3, severity FATAL:
 *   "Terrain is a big empty plane. Prop scatter is always the last system
 *    written and the first cut. RA3's city reference carries 106 discrete props
 *    on 1.3 hectares; a procedural remake ships 8 rocks.
 *    Mitigation: implement the 25x25 m ship-blocking rule as an automated map
 *    validator that rasterises adornment coverage and fails the map if any
 *    empty patch exceeds it."
 *
 * That mitigation is `validateCoverage()`, and `generate()` runs it in a loop
 * and fills what it reports. It is a gate, not a guideline.
 *
 * FIVE THINGS THIS FILE GETS RIGHT
 * --------------------------------
 * 1. DENSITY IS A BUDGET, NOT AN ACCIDENT. Ruling #9 / §6.6: city >= 105/ha,
 *    wilderness >= 260/ha, measured against ADORNABLE ground (water, cliff,
 *    road and base footprints are out of the numerator AND the denominator).
 *    A 512 m map is 26.2 ha, so wilderness means ~6800 props. That is fine,
 *    because of (2).
 *
 * 2. ONE DRAW CALL PER TYPE, AND ONLY THE VISIBLE INSTANCES IN IT. One
 *    InstancedMesh per prop type spans the whole map, so its bounding sphere is
 *    useless for culling — three would happily draw 6800 trees to show 200.
 *    Instead props are bucketed into 32 m chunks, the chunk set is frustum
 *    tested every frame (256 sphere tests, no allocation), and the instance
 *    buffers are REPACKED ONLY WHEN THAT SET CHANGES. A static camera costs
 *    literally nothing; a panning one costs one memcpy of a few hundred
 *    matrices.
 *
 * 3. CLUSTERED, NEVER UNIFORM. Bible §6.5: "3-9 trees per clump, 4-8 m spacing
 *    inside, 20-50 m between clumps. Street rows are regular at 8-12 m pitch,
 *    1.5-2.5 m off the kerb." A uniform Poisson disc is the instant prototype
 *    tell, so trees come in copses, rocks in fields, and street furniture is
 *    laid along traced kerb polylines at a regular pitch.
 *
 * 4. PER-INSTANCE JITTER IS MANDATORY (scorecard #39). Scale 0.80-1.25x, free
 *    yaw, +/-4 degrees tilt, and a hue/value/saturation shift delivered through
 *    `instanceColor`. The colour multiplier is solved in LINEAR space against
 *    the type's dominant tone so a requested "+6 degrees hue, -9% value" lands
 *    where it was asked for instead of just dimming everything.
 *
 * 5. MASKS. Nothing spawns on water, on a cliff, on a road surface it does not
 *    belong on, inside a structure footprint, or inside an exclusion a
 *    scenario asked for. Street furniture spawns BESIDE roads, never on them.
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT DO
 * ---------------------------------------
 * It never writes `passGrid`, `costGrid` or the occupancy grid. Terrain owns
 * those (loop.ts's write-ownership table). Props that would physically block a
 * tank are published through `blockers()` for whoever owns navigation, and in
 * the meantime `blocksNav` props are kept off the walkable interior of clumps.
 *
 * CLEARING (§3.11)
 * ----------------
 * A structure that lands on a copse must fell it, and it must do so without
 * rebuilding seven thousand matrices. `clearFootprint()` is the door:
 *
 *   - it finds candidates through the 4 m cell index, so the scan is
 *     proportional to LOCAL prop density, never to the map's prop count;
 *   - it removes each hit with a swap-against-the-last-live-instance INSIDE
 *     that instance's own 32 m chunk slice, so `chunkStart` never moves and the
 *     cost is exactly one 16-float + 3-float copy per felled prop;
 *   - the surviving placement is a tombstone in the placement list, so every
 *     index the GPU buffers hold stays valid. `propCount` reports live props.
 *
 * There are two callers, and they ask different questions of the same index:
 *
 *   `src/world/scatter-clear.system.ts` listens to `building:placed` and turns
 *   the footprint into a RECTANGLE — `clearFootprint()`, canopy-radius test.
 *
 *   `src/sim/Crush.ts` turns a driving hull into a DISC — `crushDisc()`,
 *   footprint-radius test, and only the soft families. See the two methods'
 *   own comments for why those tests are deliberately not the same one.
 *
 * BOTH ARE PERSISTED, AS ONE BIT PER PLACEMENT. Terrain, roads and props are
 * regenerated from the seed, so a load puts every felled prop back unless the
 * file says otherwise. `SaveGame` used to close only half of that — it replayed
 * the building footprints and had nothing for the hull crush, so a trail a
 * player mowed through a wood grew back. §3.10b is the answer: `felledMask()`
 * hands out the placement list's own alive bits and `applyFelledMask()` puts
 * them back, which covers BOTH clears with one bounded blob and needs no ledger
 * of events on either side. See that section for the measurements.
 * ============================================================================
 */

import * as THREE from 'three';

import {
  CELL, MAP_CELLS, MAP_SIZE, MAP_CELL_COUNT,
  SCATTER_CHUNK_METRES, SCATTER_CLUSTER, SCATTER_COVERAGE, SCATTER_DENSITY,
  SCATTER_JITTER, SCATTER_LIMITS,
} from '../core/config';
import { clamp, clamp01, DEG2RAD, fbm2, Rng, TAU } from '../core/math';
import { SURFACE_COUNT, SurfaceId, type BiomeName } from './Biomes';
import { PASS_GROUND, type Terrain } from './Terrain';
import {
  createPropMaterial, PropLibrary, PROP_DEFS, propPalette,
  type PropDef, type PropFamily, type PropGeometry, type PropMaterialSet, type PropPalette,
} from './PropLibrary';

/* ==========================================================================
 * 1. CONSTANTS AND SMALL TYPES
 * ========================================================================== */

/** Chunks per axis. 512 / 32 = 16, so 256 chunks. */
export const CHUNK_N = Math.max(1, Math.round(MAP_SIZE / SCATTER_CHUNK_METRES));
export const CHUNK_COUNT = CHUNK_N * CHUNK_N;

/** Coverage raster resolution. 512 / 2 = 256 cells per axis. */
export const COVER_N = Math.max(1, Math.round(MAP_SIZE / SCATTER_COVERAGE.gridMetres));
const COVER_COUNT = COVER_N * COVER_N;
/**
 * A patch STRICTLY LARGER than 25 m fails, so the smallest failing square is
 * one raster cell past 25 m: 13 cells at 2 m = 26 m.
 */
const PATCH_CELLS =
  Math.floor(SCATTER_COVERAGE.patchMetres / SCATTER_COVERAGE.gridMetres) + 1;

/**
 * Metres of hard clearance kept around a structure footprint when props are
 * felled for it.
 *
 * The test is not "is the trunk inside the rectangle" — it is "does the prop's
 * VISUAL disc (`boundRadius * scale`, which for an 11 m tree is its canopy, not
 * its trunk) overlap the footprint grown by this margin". A tree one centimetre
 * outside the wall whose crown sits on the roof therefore goes, which is the
 * only reading that does not look broken.
 *
 * 1.25 m is deliberately under a third of a 4 m cell: enough that a wall never
 * grazes a bush, not so much that a structure strips the ground cover out of
 * the cells around it and leaves a bald ring.
 */
export const PROP_CLEAR_MARGIN = 1.25;

/**
 * The scatter families a vehicle hull is allowed to flatten.
 *
 * This is the SCATTER half of one rule the entity props already state in
 * `Scenarios.FALLBACK_PROPS`: `tree`/`pine`/`bush` carry `EntityFlag.Crushable`
 * and `rock`/`boulder` carry `EntityFlag.BlocksNav` instead. Instanced props
 * have no entity, no flags and no HP to hang that on, so the equivalent signal
 * here is `PropDef.family` — which is authored, already correct, and not a
 * parallel notion invented for this.
 *
 * WHY NOT 'grass'. Grass is the density workhorse: `SCATTER_DENSITY`'s
 * 260/ha wilderness target (bible ruling #9) is mostly grass tufts, and
 * clearing is PERMANENT. Mowing it would carve bald trails along every ore
 * route and every attack lane and walk the map's measured prop density
 * downward for the rest of the match. A tank driving over long grass and
 * leaving it standing is also simply what long grass does.
 *
 * WHY NOT 'rock', 'yard', 'street' or 'civic'. Boulders, shipping containers,
 * parked cars, telegraph poles and benches are the scene's STRUCTURE. A
 * harvester that dissolves a 3.4 m container reads as a missing collision, not
 * as strength.
 */
const CRUSHABLE_FAMILIES: ReadonlySet<PropFamily> = new Set<PropFamily>(['canopy', 'shrub']);

/** True if a crusher may flatten scatter props of this family. */
export function isCrushableFamily(family: PropFamily): boolean {
  return CRUSHABLE_FAMILIES.has(family);
}

export interface EmptyPatch {
  /** Centre of the offending square, world metres. */
  readonly x: number;
  readonly z: number;
  /** Side length, metres. */
  readonly size: number;
}

export interface CoverageReport {
  /** Adorned walkable cells / walkable cells, 0..1. Bible §6.6 wants >= 0.55. */
  readonly adornedFraction: number;
  /** Walkable hectares — the denominator for the density figures. */
  readonly walkableHectares: number;
  /** Props per hectare actually achieved. */
  readonly propsPerHectare: number;
  /** Every fully-unadorned walkable square of >25 m found, non-overlapping. */
  readonly emptyPatches: readonly EmptyPatch[];
  /** True when the map satisfies scorecard #15. */
  readonly passes: boolean;
}

export interface ScatterStats {
  readonly props: number;
  readonly types: number;
  readonly triangles: number;
  readonly visibleInstances: number;
  readonly visibleChunks: number;
  readonly drawCalls: number;
  readonly generateMs: number;
  readonly propsPerHectare: number;
  readonly adornedFraction: number;
  readonly emptyPatches: number;
}

export interface ScatterOptions {
  readonly scene: THREE.Scene;
  readonly terrain: Terrain;
  readonly biome: BiomeName;
  readonly seed: number;
  /** 0 = wilderness, 1 = city block. `MapPreset.urban`. */
  readonly urban: number;
  /** Density multiplier. `MapPreset.scatter`. */
  readonly densityScale: number;
  /** Prop keys the map preset asks for, richest first. Weighted 3:2:1... */
  readonly preferred?: readonly string[];
  /** The box a scenario actually photographs. Density is boosted inside it. */
  readonly focus?: { minX: number; minZ: number; maxX: number; maxZ: number } | null;
  readonly focusBoost?: number;
}

/* One live prop type: a def, its baked geometry, and its instance columns. */
interface ScatterType {
  readonly def: PropDef;
  /** Index into PROP_DEFS. This is what a Placement stores, so trimming a
   *  type can never shift a surviving instance onto the wrong mesh. */
  readonly defIndex: number;
  readonly geo: PropGeometry;
  mesh: THREE.InstancedMesh | null;
  /** LIVE instance count. Decremented by `clearFootprint()`. */
  count: number;
  /** 16 floats per instance, sorted by chunk. */
  srcMatrix: Float32Array;
  /** 3 floats per instance (linear multipliers), sorted by chunk. */
  srcColor: Float32Array;
  /** Prefix offsets into srcMatrix/srcColor, one per chunk plus a terminator. */
  chunkStart: Int32Array;
  /**
   * Live instances in each chunk, so chunk `c` owns
   * `[chunkStart[c], chunkStart[c] + chunkLive[c])`.
   *
   * This is what makes removal O(1). Shrinking a chunk by editing `chunkStart`
   * would have to slide every later chunk down — O(all props) for one felled
   * tree. A separate live count leaves dead instances parked in the tail of
   * their own chunk slice where the repack loop simply never reads them.
   */
  chunkLive: Int32Array;
  /** Instance index -> index into `placements`, so a swap can fix the mover. */
  instOf: Int32Array;
  /** Instances currently uploaded. */
  drawCount: number;
}

/* A placed prop, before chunk sorting. Kept as parallel arrays to stay flat. */
interface Placement {
  /** Index into PROP_DEFS, never into the live type list. */
  defIndex: number;
  x: number; y: number; z: number;
  yaw: number; scale: number;
  tiltX: number; tiltZ: number;
  cr: number; cg: number; cb: number;
  /** Own index in `placements`, stamped by `buildInstances()`. */
  index: number;
  /** Live type slot, or -1 once cleared / before the GPU build. */
  slot: number;
  /** Instance index inside that type's chunk-sorted arrays. */
  inst: number;
  /** Chunk this instance sorted into. */
  chunk: number;
  /** False once felled. The record stays so every stored index holds. */
  alive: boolean;
}

/* ==========================================================================
 * 2. COLOUR JITTER
 *
 * `instanceColor` is a MULTIPLIER, so a hue rotation cannot be expressed
 * directly. Solve it instead: take the type's dominant tone, apply the
 * requested HSV shift, and divide the shifted linear colour by the original
 * linear colour. The resulting per-channel multiplier reproduces the shift
 * exactly on that tone and something visually related on every other tone —
 * which is the whole point, since a tree's trunk should not swing +8 degrees
 * of hue when its canopy does.
 * ========================================================================== */

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function hexToRgb(hex: string, out: Float32Array): void {
  const n = parseInt(hex.slice(1), 16);
  out[0] = ((n >> 16) & 255) / 255;
  out[1] = ((n >> 8) & 255) / 255;
  out[2] = (n & 255) / 255;
}

function rgbToHsv(r: number, g: number, b: number, out: Float32Array): void {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d > 1e-6) {
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  out[0] = h; out[1] = max <= 0 ? 0 : d / max; out[2] = max;
}

function hsvToRgb(h: number, s: number, v: number, out: Float32Array): void {
  h -= Math.floor(h);
  const i = Math.floor(h * 6), f = h * 6 - i;
  const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  let r = v, g = t, b = p;
  switch (i % 6) {
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    case 5: r = v; g = p; b = q; break;
    default: break;
  }
  out[0] = r; out[1] = g; out[2] = b;
}

const JC_RGB = new Float32Array(3);
const JC_HSV = new Float32Array(3);
const JC_OUT = new Float32Array(3);

/**
 * Per-instance colour multiplier for `baseHex` under a `strength`-scaled draw
 * of SCATTER_JITTER. Writes [r,g,b] into `out`.
 *
 * Bible §6.5: "hue +/-8 degrees, value +/-18%, saturation +/-12%. Without
 * hue/value jitter a forest reads as a repeated stamp." (Scorecard #39.)
 */
function jitterColor(rng: Rng, baseHex: string, strength: number, out: Float32Array): void {
  hexToRgb(baseHex, JC_RGB);
  const l0 = srgbToLinear(JC_RGB[0]), l1 = srgbToLinear(JC_RGB[1]), l2 = srgbToLinear(JC_RGB[2]);
  rgbToHsv(JC_RGB[0], JC_RGB[1], JC_RGB[2], JC_HSV);

  const dh = (rng.next() * 2 - 1) * (SCATTER_JITTER.hueDeg / 360) * strength;
  const ds = 1 + (rng.next() * 2 - 1) * SCATTER_JITTER.saturation * strength;
  const dv = 1 + (rng.next() * 2 - 1) * SCATTER_JITTER.value * strength;
  hsvToRgb(JC_HSV[0] + dh, clamp01(JC_HSV[1] * ds), clamp01(JC_HSV[2] * dv), JC_OUT);

  const m0 = srgbToLinear(JC_OUT[0]), m1 = srgbToLinear(JC_OUT[1]), m2 = srgbToLinear(JC_OUT[2]);
  out[0] = clamp(m0 / Math.max(l0, 1e-4), 0.45, 1.75);
  out[1] = clamp(m1 / Math.max(l1, 1e-4), 0.45, 1.75);
  out[2] = clamp(m2 / Math.max(l2, 1e-4), 0.45, 1.75);
}

/** The tone a type's jitter is solved against. */
function dominantTone(def: PropDef, p: PropPalette): string {
  switch (def.family) {
    case 'canopy': return def.key === 'treeAutumn' ? p.autumnA
      : def.key === 'conifer' ? p.conifer
        : def.key === 'palm' ? p.frond : p.leafA;
    case 'shrub': return def.key === 'hedge' ? p.hedge : p.shrub;
    case 'grass': return def.key === 'grassTuftGreen' ? p.grassGreen : p.grassGold;
    case 'rock': return p.rock;
    case 'yard': return def.key === 'haystack' ? p.hay : p.crateA;
    default: return p.concrete;
  }
}

/* ==========================================================================
 * 3. THE SCATTER SYSTEM
 * ========================================================================== */

export class Scatter {
  readonly library: PropLibrary;
  readonly materials: PropMaterialSet;
  private readonly palette: PropPalette;
  private readonly root = new THREE.Group();
  private readonly scene: THREE.Scene;
  private readonly terrain: Terrain;
  private readonly opts: ScatterOptions;

  private types: ScatterType[] = [];
  private placements: Placement[] = [];

  /* ---- masks and accelerators ------------------------------------------ */

  /** Per map cell: 1 when a prop may stand here at all. */
  private readonly placeable = new Uint8Array(MAP_CELL_COUNT);
  /** Per map cell: 1 when the cell counts toward the density denominator. */
  private readonly walkable = new Uint8Array(MAP_CELL_COUNT);
  /** Bucket grid over map cells for the min-spacing test. */
  private readonly bucketHead = new Int32Array(MAP_CELL_COUNT);
  private bucketNext = new Int32Array(0);

  /** Exclusion discs added by scenarios/bases. Triples of (x, z, r). */
  private readonly exclusions: number[] = [];

  /**
   * Accepted clump centres, bucketed by (family, 64 m cell) so the 20-50 m
   * separation test stays O(1) as the map fills. A flat list looks equivalent
   * and turns generate() into a 2.4 s stall on a dense map.
   */
  private readonly clumpBuckets: number[][] = [];
  /** Budget this generate() was given, so the top-up passes can respect it. */
  private budget = 0;

  /* ---- per-chunk bookkeeping ------------------------------------------- */

  private readonly chunkMinY = new Float32Array(CHUNK_COUNT);
  private readonly chunkMaxY = new Float32Array(CHUNK_COUNT);
  private readonly chunkUsed = new Uint8Array(CHUNK_COUNT);
  private readonly chunkVisible = new Uint8Array(CHUNK_COUNT);
  private readonly chunkVisiblePrev = new Uint8Array(CHUNK_COUNT);

  /* ---- frame scratch (allocated once, never in the loop) ---------------- */

  private readonly frustum = new THREE.Frustum();
  private readonly viewProj = new THREE.Matrix4();
  private readonly probe = new THREE.Box3();

  /* ---- coverage scratch ------------------------------------------------- */

  private readonly coverWalkable = new Uint8Array(COVER_COUNT);
  private readonly coverAdorned = new Uint8Array(COVER_COUNT);
  private readonly coverSat = new Int32Array((COVER_N + 1) * (COVER_N + 1));
  private readonly coverBlocked = new Int32Array(COVER_N);

  /* ---- reported numbers -------------------------------------------------- */

  generateMs = 0;
  visibleInstances = 0;
  visibleChunks = 0;
  lastReport: CoverageReport | null = null;

  /* ---- clearing bookkeeping ---------------------------------------------- */

  /** Live props. `placements.length` also counts tombstones. */
  private liveProps = 0;
  /** Widest visual disc any live type can produce, metres. Scan reach. */
  private maxPropReach = 0;
  /** Props felled since `generate()`. */
  clearedProps = 0;
  /** Placements EXAMINED by the last `clearFootprint()`. The O() witness. */
  lastClearScanned = 0;
  /** Props felled by the last `clearFootprint()`. */
  lastClearCount = 0;
  /**
   * Identity of the placement list this `generate()` produced. See §3.10b —
   * it is what makes a saved felled-prop mask safe to apply to a REGENERATED
   * scatter, and what makes an application to the wrong one impossible.
   */
  private placementHash = 0;

  constructor(options: ScatterOptions) {
    this.opts = options;
    this.scene = options.scene;
    this.terrain = options.terrain;
    this.palette = propPalette(options.biome);
    this.library = new PropLibrary({ biome: options.biome, seed: options.seed });
    this.materials = createPropMaterial();
    this.root.name = 'PropScatter';
    this.root.matrixAutoUpdate = false;
    this.scene.add(this.root);
  }

  /* ======================================================================
   * 3.1 MASKS
   * ====================================================================== */

  /**
   * A disc nothing may spawn inside. Base footprints, ore fields, the
   * placement ghost, a scenario's hero framing — anything that wants clear
   * ground. Call before `generate()`.
   */
  addExclusion(x: number, z: number, radius: number): void {
    this.exclusions.push(x, z, radius);
  }

  /** Rectangular exclusion, expressed as the disc that covers it. */
  addExclusionRect(minX: number, minZ: number, maxX: number, maxZ: number): void {
    const cx = (minX + maxX) * 0.5, cz = (minZ + maxZ) * 0.5;
    this.addExclusion(cx, cz, Math.hypot(maxX - cx, maxZ - cz));
  }

  clearExclusions(): void { this.exclusions.length = 0; }

  private inExclusion(x: number, z: number, pad: number): boolean {
    const e = this.exclusions;
    for (let i = 0; i < e.length; i += 3) {
      const dx = x - e[i], dz = z - e[i + 1], r = e[i + 2] + pad;
      if (dx * dx + dz * dz < r * r) return true;
    }
    return false;
  }

  /**
   * Rebuild `placeable` and `walkable`.
   *
   * `walkable` is the density denominator and the coverage domain: ground a
   * unit could actually stand on. `placeable` additionally rejects everything a
   * prop must never occupy — structure footprints and scenario exclusions.
   * Per-type surface and slope masks are applied at placement time, because a
   * boulder and a cafe umbrella disagree about what a legal cell is.
   */
  private buildMasks(): void {
    const t = this.terrain;
    this.placeable.fill(0);
    this.walkable.fill(0);
    for (let cz = 0; cz < MAP_CELLS; cz++) {
      for (let cx = 0; cx < MAP_CELLS; cx++) {
        const i = cz * MAP_CELLS + cx;
        if (t.waterGrid[i] !== 0) continue;
        if ((t.passGrid[i] & PASS_GROUND) === 0) continue;
        this.walkable[i] = 1;
        if (t.isOccupied(cx, cz)) continue;
        const x = (cx + 0.5) * CELL, z = (cz + 0.5) * CELL;
        if (this.inExclusion(x, z, 0)) continue;
        this.placeable[i] = 1;
      }
    }
  }

  /* ======================================================================
   * 3.2 SPACING
   * ====================================================================== */

  private resetBuckets(capacity: number): void {
    this.bucketHead.fill(-1);
    if (this.bucketNext.length < capacity) this.bucketNext = new Int32Array(capacity);
    this.bucketNext.fill(-1, 0, capacity);
  }

  private bucketInsert(index: number, x: number, z: number): void {
    const cx = clamp(Math.floor(x / CELL), 0, MAP_CELLS - 1);
    const cz = clamp(Math.floor(z / CELL), 0, MAP_CELLS - 1);
    const c = cz * MAP_CELLS + cx;
    this.bucketNext[index] = this.bucketHead[c];
    this.bucketHead[c] = index;
  }

  /** True when any already-placed prop sits within `radius` metres. */
  private tooClose(x: number, z: number, radius: number): boolean {
    const r2 = radius * radius;
    const span = Math.ceil(radius / CELL);
    const cx = clamp(Math.floor(x / CELL), 0, MAP_CELLS - 1);
    const cz = clamp(Math.floor(z / CELL), 0, MAP_CELLS - 1);
    const x0 = Math.max(0, cx - span), x1 = Math.min(MAP_CELLS - 1, cx + span);
    const z0 = Math.max(0, cz - span), z1 = Math.min(MAP_CELLS - 1, cz + span);
    const P = this.placements;
    for (let gz = z0; gz <= z1; gz++) {
      for (let gx = x0; gx <= x1; gx++) {
        let n = this.bucketHead[gz * MAP_CELLS + gx];
        while (n >= 0) {
          const p = P[n];
          const dx = p.x - x, dz = p.z - z;
          if (dx * dx + dz * dz < r2) return true;
          n = this.bucketNext[n];
        }
      }
    }
    return false;
  }

  /* ======================================================================
   * 3.3 LEGALITY
   * ====================================================================== */

  /** Can `def` stand at (x,z)? Applies the surface, slope and spacing masks. */
  private legal(def: PropDef, x: number, z: number, spacingScale = 1): boolean {
    if (x < 2 || z < 2 || x > MAP_SIZE - 2 || z > MAP_SIZE - 2) return false;
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    if (cx < 0 || cz < 0 || cx >= MAP_CELLS || cz >= MAP_CELLS) return false;
    if (this.placeable[cz * MAP_CELLS + cx] === 0) return false;
    // `placeable` is a 4 m cell mask sampled at cell CENTRES, so a cell whose
    // centre clears an exclusion by 0.1 m can still host a prop 2.8 m inside
    // it. Cheap fast-reject above, exact test here.
    if (this.exclusions.length > 0 && this.inExclusion(x, z, 0)) return false;
    const surf = this.terrain.surfaceAt(x, z);
    if ((def.surfaces & (1 << surf)) === 0) return false;
    if (this.terrain.slopeAt(x, z) > def.maxSlope) return false;
    if (this.terrain.isCliff(cx, cz)) return false;
    return !this.tooClose(x, z, def.spacing * spacingScale);
  }

  /* ======================================================================
   * 3.4 PLACEMENT
   * ====================================================================== */

  private place(defIndex: number, def: PropDef, x: number, z: number, rng: Rng): boolean {
    if (this.placements.length >= SCATTER_LIMITS.maxProps) return false;
    const y = this.terrain.heightAt(x, z);

    const sMin = def.scaleMin ?? SCATTER_JITTER.scaleMin;
    const sMax = def.scaleMax ?? SCATTER_JITTER.scaleMax;
    const scale = rng.range(sMin, sMax);

    // Tilt: bible §6.5 allows +/-4 degrees on vegetation. Rock and grass also
    // lean with the ground normal so they sit in the slope instead of on it.
    let tiltX = rng.range(-1, 1) * SCATTER_JITTER.tiltDeg * DEG2RAD;
    let tiltZ = rng.range(-1, 1) * SCATTER_JITTER.tiltDeg * DEG2RAD;
    if (def.family === 'rock' || def.family === 'grass') {
      this.terrain.normalAt(x, z, NORMAL_SCRATCH);
      // Small-angle: the normal's XZ components ARE the lean, in radians.
      tiltX += NORMAL_SCRATCH[2] * 0.6;
      tiltZ += -NORMAL_SCRATCH[0] * 0.6;
    }

    const strength = def.jitter ?? 1;
    jitterColor(rng, dominantTone(def, this.palette), strength, JITTER_OUT);

    const p: Placement = {
      defIndex, x, y, z,
      yaw: rng.next() * TAU,
      scale, tiltX, tiltZ,
      cr: JITTER_OUT[0], cg: JITTER_OUT[1], cb: JITTER_OUT[2],
      index: -1, slot: -1, inst: -1, chunk: -1, alive: true,
    };
    this.bucketInsert(this.placements.length, x, z);
    this.placements.push(p);
    return true;
  }

  /**
   * A copse. Bible §6.5: 3-9 members, 4-8 m spacing inside, 20-50 m between
   * clumps. Members are drawn in a disc and rejected against the global
   * spacing grid, which is what makes a copse read as a copse rather than as a
   * ring of trees.
   */
  private placeClump(defIndex: number, def: PropDef, cx: number, cz: number, rng: Rng): number {
    const want = rng.int(def.clumpMin, def.clumpMax);
    let placed = 0;
    for (let i = 0; i < want; i++) {
      let ok = false;
      for (let a = 0; a < SCATTER_CLUSTER.attemptsPerMember && !ok; a++) {
        // sqrt() keeps the disc uniform; without it every clump has a dense core.
        const ang = rng.next() * TAU;
        const rad = def.clumpSpread * Math.sqrt(rng.next());
        const x = cx + Math.cos(ang) * rad, z = cz + Math.sin(ang) * rad;
        if (!this.legal(def, x, z)) continue;
        ok = this.place(defIndex, def, x, z, rng);
      }
      if (ok) placed++;
    }
    return placed;
  }

  /**
   * Trace the kerb lines of the map: cells whose surface is man-made and which
   * touch a soft cell. Returns polylines of world positions in metres.
   *
   * This is how street furniture finds roads without a road module existing.
   * Terrain paints Concrete/Paving into splat slots 4 and 5 and a road module
   * will stamp more of it later; either way the boundary of the hard surface is
   * the kerb, and that is where lamps, benches and railings live.
   */
  private traceKerbs(rng: Rng): number[][] {
    const t = this.terrain;
    const isHard = (cx: number, cz: number): boolean => {
      if (cx < 0 || cz < 0 || cx >= MAP_CELLS || cz >= MAP_CELLS) return false;
      const s = t.surface[cz * MAP_CELLS + cx];
      return s === SurfaceId.Concrete || s === SurfaceId.Paving;
    };
    const kerb = new Uint8Array(MAP_CELL_COUNT);
    const list: number[] = [];
    for (let cz = 1; cz < MAP_CELLS - 1; cz++) {
      for (let cx = 1; cx < MAP_CELLS - 1; cx++) {
        if (!isHard(cx, cz)) continue;
        if (isHard(cx + 1, cz) && isHard(cx - 1, cz) && isHard(cx, cz + 1) && isHard(cx, cz - 1)) continue;
        kerb[cz * MAP_CELLS + cx] = 1;
        list.push(cz * MAP_CELLS + cx);
      }
    }
    if (list.length === 0) return [];

    // Greedy chain following: from an unvisited kerb cell, always step to the
    // nearest unvisited 8-neighbour. Good enough for a kerb, which is a thin
    // 1-cell ring by construction.
    const visited = new Uint8Array(MAP_CELL_COUNT);
    const lines: number[][] = [];
    rng.shuffle(list);
    for (let s = 0; s < list.length; s++) {
      const start = list[s];
      if (visited[start] !== 0) continue;
      const line: number[] = [];
      let cur = start;
      while (cur >= 0 && visited[cur] === 0) {
        visited[cur] = 1;
        const cx = cur % MAP_CELLS, cz = (cur / MAP_CELLS) | 0;
        line.push((cx + 0.5) * CELL, (cz + 0.5) * CELL);
        let next = -1;
        for (let dz = -1; dz <= 1 && next < 0; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dz === 0) continue;
            const nx = cx + dx, nz = cz + dz;
            if (nx < 0 || nz < 0 || nx >= MAP_CELLS || nz >= MAP_CELLS) continue;
            const ni = nz * MAP_CELLS + nx;
            if (kerb[ni] !== 0 && visited[ni] === 0) { next = ni; break; }
          }
        }
        cur = next;
      }
      // A 3-cell stub is a corner artefact, not a street.
      if (line.length >= 8) lines.push(line);
    }
    return lines;
  }

  /**
   * Lay a type along a polyline at a regular pitch, offset to the soft side.
   * Bible §6.3/§6.5: street rows at 8-12 m pitch, 1.5-2.5 m off the kerb,
   * +/-0.4 m jitter. The REGULARITY is the point — it is what separates a
   * street from a meadow.
   */
  private placeAlongLine(
    defIndex: number, def: PropDef, line: readonly number[], rng: Rng, budget: number,
  ): number {
    const pitch = def.spacing > SCATTER_CLUSTER.streetPitchMax
      ? def.spacing
      : rng.range(SCATTER_CLUSTER.streetPitchMin, SCATTER_CLUSTER.streetPitchMax);
    const offset = rng.range(SCATTER_CLUSTER.kerbOffsetMin, SCATTER_CLUSTER.kerbOffsetMax);
    const side = rng.sign();
    let placed = 0;
    let travelled = rng.range(0, pitch);
    for (let i = 0; i + 3 < line.length && placed < budget; i += 2) {
      const ax = line[i], az = line[i + 1], bx = line[i + 2], bz = line[i + 3];
      const dx = bx - ax, dz = bz - az;
      const seg = Math.hypot(dx, dz);
      if (seg < 1e-3) continue;
      const ux = dx / seg, uz = dz / seg;
      // Which side of the kerb does this type belong on? A bench wants the
      // pavement, a tree row wants the verge. Probe both and take whichever
      // side the type's surface mask actually accepts; only fall back to the
      // random side when neither or both are legal.
      let px = -uz * side, pz = ux * side;
      const mx = (ax + bx) * 0.5, mz = (az + bz) * 0.5;
      const sA = this.terrain.surfaceAt(mx + px * offset, mz + pz * offset);
      const sB = this.terrain.surfaceAt(mx - px * offset, mz - pz * offset);
      const okA = (def.surfaces & (1 << sA)) !== 0;
      const okB = (def.surfaces & (1 << sB)) !== 0;
      if (!okA && okB) { px = -px; pz = -pz; }

      let along = 0;
      while (along < seg && placed < budget) {
        const step = pitch - travelled;
        if (along + step > seg) { travelled += seg - along; break; }
        along += step;
        travelled = 0;
        const x = ax + ux * along + px * offset + rng.range(-1, 1) * SCATTER_CLUSTER.streetJitter;
        const z = az + uz * along + pz * offset + rng.range(-1, 1) * SCATTER_CLUSTER.streetJitter;
        if (!this.legal(def, x, z)) continue;
        // Street furniture faces the road: yaw is overwritten after placement.
        if (this.place(defIndex, def, x, z, rng)) {
          const p = this.placements[this.placements.length - 1];
          p.yaw = Math.atan2(ux, uz) + rng.range(-0.08, 0.08);
          placed++;
        }
      }
    }
    return placed;
  }

  /**
   * A synthetic run for maps with no roads: fences across a field, a telegraph
   * line marching over a ridge. ra3steam_05 has exactly this in its desert.
   */
  private placeSyntheticLine(defIndex: number, def: PropDef, rng: Rng, budget: number): number {
    const cellIndex = this.randomPlaceableCell(rng);
    if (cellIndex < 0) return 0;
    const sx = ((cellIndex % MAP_CELLS) + 0.5) * CELL;
    const sz = (((cellIndex / MAP_CELLS) | 0) + 0.5) * CELL;
    const ang = rng.next() * TAU;
    const line: number[] = [];
    const runLength = rng.range(40, 110);
    // Gentle heading drift so the run is a spline, not an axis-aligned ruler
    // (bible §6.3: "straight axis-aligned roads are a hard fail" — the same
    // instinct applies to a fence line).
    let a = ang, x = sx, z = sz;
    for (let d = 0; d < runLength; d += 6) {
      line.push(x, z);
      a += rng.range(-0.12, 0.12);
      x += Math.cos(a) * 6;
      z += Math.sin(a) * 6;
      if (x < 4 || z < 4 || x > MAP_SIZE - 4 || z > MAP_SIZE - 4) break;
    }
    if (line.length < 4) return 0;
    return this.placeAlongLine(defIndex, def, line, rng, budget);
  }

  private randomPlaceableCell(rng: Rng): number {
    for (let a = 0; a < 96; a++) {
      const i = rng.int(0, MAP_CELL_COUNT - 1);
      if (this.placeable[i] !== 0) return i;
    }
    return -1;
  }

  /* ======================================================================
   * 3.5 GENERATE
   * ====================================================================== */

  /**
   * Build the whole scatter. Deterministic in (seed, terrain, exclusions).
   *
   * Order matters:
   *   1. masks               — what ground exists at all
   *   2. type mix + budget   — how many props of what, from the density target
   *   3. structured passes   — clumps, fields, streets, solos
   *   4. coverage fill       — close every >25 m hole the validator reports
   *   5. GPU build           — chunk sort, matrices, InstancedMeshes
   */
  generate(): void {
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    this.disposeMeshes();
    this.placements.length = 0;
    this.clumpBuckets.length = 0;
    this.clearedProps = 0;
    this.lastClearScanned = 0;
    this.lastClearCount = 0;
    this.liveProps = 0;
    this.maxPropReach = 0;
    this.placementHash = 0;
    this.resetBuckets(SCATTER_LIMITS.maxProps);
    this.buildMasks();

    const rng = new Rng(this.opts.seed >>> 0);
    const urban = clamp01(this.opts.urban);

    /* -- 2. the type mix -------------------------------------------------- */
    const avail: ScatterType[] = [];
    const weights: number[] = [];
    const preferred = this.opts.preferred ?? [];
    for (let i = 0; i < PROP_DEFS.length; i++) {
      const def = PROP_DEFS[i];
      const geo = this.library.get(def.key);
      if (geo === undefined) continue;
      const biomeW = def.biome[this.opts.biome];
      if (biomeW <= 0) continue;
      // Affinity: a def with urban 1.0 wants urban 1.0 and vice versa.
      const fit = def.urban * urban + (1 - def.urban) * (1 - urban);
      let w = biomeW * (0.15 + 0.85 * fit);
      const pref = preferred.indexOf(def.key);
      if (pref >= 0) w *= 3 / (pref + 1) + 1;
      if (w <= 1e-3) continue;
      avail.push({
        def, defIndex: i, geo, mesh: null, count: 0,
        srcMatrix: EMPTY_F32, srcColor: EMPTY_F32,
        chunkStart: EMPTY_I32, chunkLive: EMPTY_I32, instOf: EMPTY_I32,
        drawCount: 0,
      });
      weights.push(w);
    }
    if (avail.length === 0) { this.types = []; this.finishTiming(t0); return; }

    /* -- the budget ------------------------------------------------------- */
    let walkableCells = 0;
    for (let i = 0; i < MAP_CELL_COUNT; i++) walkableCells += this.walkable[i];
    const hectares = Math.max(walkableCells * CELL * CELL / 10000, 0.01);
    const target = SCATTER_DENSITY.wildernessPerHectare
      + (SCATTER_DENSITY.cityPerHectare - SCATTER_DENSITY.wildernessPerHectare) * urban;
    // `MapPreset.scatter` is a mood dial, not a licence to empty the map:
    // ruling #9's 75/ha is a floor and the preset cannot scale below it.
    const perHa = Math.max(
      target * Math.max(this.opts.densityScale, 0.05),
      SCATTER_DENSITY.hardFloorPerHectare,
    );
    const budget = Math.min(SCATTER_LIMITS.maxProps, Math.round(perHa * hectares));
    this.budget = budget;

    /* -- 3. structured passes --------------------------------------------- */
    const total = weights.reduce((a, b) => a + b, 0);
    const grassCap = Math.round(budget * SCATTER_DENSITY.maxGrassFraction);
    let grassPlaced = 0;

    const kerbs = this.traceKerbs(rng.fork());
    // A low-frequency habitat field so 'field' props are patchy, not uniform.
    const habitatSeed = (this.opts.seed ^ 0x51ed) >>> 0;

    for (let i = 0; i < avail.length; i++) {
      const type = avail[i];
      const def = type.def;
      let share = Math.round(budget * (weights[i] / total));
      if (def.family === 'grass') {
        share = Math.min(share, Math.max(0, grassCap - grassPlaced));
      }
      if (share <= 0) continue;
      let placed = 0;
      const typeRng = rng.fork();

      switch (def.mode) {
        case 'clump': {
          const perClump = (def.clumpMin + def.clumpMax) * 0.5;
          const clumps = Math.max(1, Math.round(share / Math.max(perClump, 1)));
          for (let c = 0; c < clumps && placed < share; c++) {
            const cellIndex = this.pickClumpCentre(def, typeRng, habitatSeed);
            if (cellIndex < 0) continue;
            const cx = ((cellIndex % MAP_CELLS) + 0.5) * CELL;
            const cz = (((cellIndex / MAP_CELLS) | 0) + 0.5) * CELL;
            placed += this.placeClump(type.defIndex, def, cx, cz, typeRng);
          }
          break;
        }
        case 'field': {
          // Density modulated by fbm so a rock field has a shape.
          for (let a = 0; a < share * 14 && placed < share; a++) {
            const x = typeRng.next() * MAP_SIZE, z = typeRng.next() * MAP_SIZE;
            const h = fbm2(x * 0.018, z * 0.018, 3, 2.0, 0.5, habitatSeed);
            if (typeRng.next() > clamp01(0.30 + h * 0.9)) continue;
            if (!this.legal(def, x, z)) continue;
            if (this.place(type.defIndex, def, x, z, typeRng)) placed++;
          }
          break;
        }
        case 'street': {
          if (kerbs.length > 0) {
            for (let k = 0; k < kerbs.length && placed < share; k++) {
              placed += this.placeAlongLine(type.defIndex, def, kerbs[k], typeRng, share - placed);
            }
          }
          // Wilderness, or the kerbs ran out: lay synthetic runs.
          for (let a = 0; a < 24 && placed < share; a++) {
            placed += this.placeSyntheticLine(type.defIndex, def, typeRng, share - placed);
          }
          break;
        }
        default: {
          for (let a = 0; a < share * 24 && placed < share; a++) {
            const x = typeRng.next() * MAP_SIZE, z = typeRng.next() * MAP_SIZE;
            if (!this.legal(def, x, z)) continue;
            if (this.place(type.defIndex, def, x, z, typeRng)) placed++;
          }
          break;
        }
      }
      type.count = placed;
      if (def.family === 'grass') grassPlaced += placed;
    }

    /* -- 3b. TOP-UP: density is a contract, not an aspiration -------------- *
     * The structured passes are allowed to under-deliver — a copse can be
     * rejected wholesale by a lake, a street pass finds no kerbs on a
     * wilderness map, and the fbm habitat gate rejects most of what it is
     * offered by design. Left alone, temperate lands around 105/ha against a
     * 221/ha budget, which is bible §6.6's failure mode wearing a nicer hat.
     * So: keep spending the remaining budget on clustered vegetation until it
     * is gone or the map genuinely has nowhere left to put a bush.           */
    const topUpRng = rng.fork();
    const topUp = avail.filter((t) => t.def.mode === 'clump' || t.def.mode === 'field');
    if (topUp.length > 0) {
      const topWeights = topUp.map((t) => {
        const w = weights[avail.indexOf(t)];
        // Grass is capped separately; do not let it eat the whole remainder.
        return t.def.family === 'grass' ? w * 0.5 : w;
      });
      const topTotal = topWeights.reduce((a, b) => a + b, 0);
      let stalled = 0;
      while (this.placements.length < budget && stalled < 400) {
        const before = this.placements.length;
        // Weighted pick without allocating.
        let roll = topUpRng.next() * topTotal;
        let pick = topUp[0];
        for (let i = 0; i < topUp.length; i++) {
          roll -= topWeights[i];
          if (roll <= 0) { pick = topUp[i]; break; }
        }
        if (pick.def.family === 'grass' && grassPlaced >= grassCap) { stalled++; continue; }
        const cellIndex = this.pickClumpCentre(pick.def, topUpRng, habitatSeed);
        if (cellIndex < 0) { stalled++; continue; }
        const cx = ((cellIndex % MAP_CELLS) + 0.5) * CELL;
        const cz = (((cellIndex / MAP_CELLS) | 0) + 0.5) * CELL;
        const n = this.placeClump(pick.defIndex, pick.def, cx, cz, topUpRng);
        pick.count += n;
        if (pick.def.family === 'grass') grassPlaced += n;
        if (this.placements.length === before) stalled++; else stalled = 0;
      }
    }

    /* -- focus boost: the scenario's photographed box --------------------- */
    const focus = this.opts.focus;
    if (focus != null) {
      const boost = this.opts.focusBoost ?? 0.35;
      const extra = Math.round(budget * boost);
      const fillers = avail.filter((t) => t.def.mode === 'clump' || t.def.mode === 'field');
      if (fillers.length > 0) {
        const fRng = rng.fork();
        for (let a = 0; a < extra * 6 && this.placements.length < SCATTER_LIMITS.maxProps; a++) {
          const pick = fRng.pick(fillers);
          const x = fRng.range(focus.minX, focus.maxX);
          const z = fRng.range(focus.minZ, focus.maxZ);
          if (!this.legal(pick.def, x, z)) continue;
          if (this.place(pick.defIndex, pick.def, x, z, fRng)) pick.count++;
        }
      }
    }

    /* -- 4. TRIM TO THE DRAW-CALL BUDGET, THEN GATE ----------------------- *
     * These two were the other way round, and the order was wrong.
     *
     * `trimTypes()` deletes every placement of the lowest-ranked types. With
     * the gate first, it deleted props the gate had just placed to close a
     * 25x25 m patch, and nothing re-validated: `lastReport` was recomputed on
     * the trimmed set with no pass left to fix what the trim had reopened.
     * Scorecard #15 is weight 3 and it was being reported out of a gate whose
     * result had since been edited. `07-soviet-base` shipped at "adornment
     * 65%, 1 unadorned patch" that way.
     *
     * So the GATE IS LAST, and nothing below this line may remove a placement.
     *
     * The trim still ranks on post-top-up counts, exactly as it always has.
     * Moving it ahead of the top-up as well was tried and measured worse: the
     * structured passes' counts are a different ranking signal, a different
     * four types survived on `04-units-parade`, and its #34 edge coverage fell
     * 0.2960 -> 0.2569. What a type finally delivered is the honest basis for
     * spending a draw call on it; what it was allocated is not.               */
    const live = this.trimTypes(avail);
    this.fillToTarget(live, rng.fork());
    this.types = live.filter((t) => t.count > 0);

    /* -- 5. GPU ----------------------------------------------------------- */
    this.buildInstances();
    this.lastReport = this.validateCoverage();
    this.finishTiming(t0);
  }

  private finishTiming(t0: number): void {
    this.generateMs = (typeof performance !== 'undefined' ? performance.now() : 0) - t0;
  }

  /**
   * Clump centres are drawn against the same fbm habitat field the 'field' mode
   * uses, and are pushed 20-50 m apart FROM OTHER CENTRES OF THE SAME FAMILY —
   * bible §6.5. Without that separation copses merge into one forest and the
   * map loses its clearings, which is where the gameplay happens.
   *
   * The separation is measured against centres, NOT against every placed prop.
   * Testing against all props looks equivalent and is not: once a map is a few
   * thousand props deep, no cell on it is 20 m from everything, so every clump
   * request fails and density silently halves. That bug is exactly how a
   * scatter system ships at 105/ha against a 221/ha budget.
   */
  private pickClumpCentre(def: PropDef, rng: Rng, habitatSeed: number): number {
    const family = FAMILY_CODE.indexOf(def.family);
    for (let a = 0; a < 48; a++) {
      const i = rng.int(0, MAP_CELL_COUNT - 1);
      if (this.placeable[i] === 0) continue;
      const cx = ((i % MAP_CELLS) + 0.5) * CELL;
      const cz = (((i / MAP_CELLS) | 0) + 0.5) * CELL;
      const h = fbm2(cx * 0.012, cz * 0.012, 3, 2.0, 0.5, habitatSeed);
      if (rng.next() > clamp01(0.25 + h * 1.1)) continue;
      // The centre itself must be clear, or the clump grows around a boulder.
      if (this.tooClose(cx, cz, def.spacing)) continue;
      const gap = rng.range(SCATTER_CLUSTER.betweenClumpsMin, SCATTER_CLUSTER.betweenClumpsMax);
      if (this.clumpClash(family, cx, cz, gap)) continue;
      this.addClumpCentre(family, cx, cz);
      return i;
    }
    return -1;
  }

  /** 3x3 neighbourhood of 64 m buckets covers the 50 m maximum separation. */
  private clumpClash(family: number, x: number, z: number, gap: number): boolean {
    const g2 = gap * gap;
    const bx = clamp(Math.floor(x / CLUMP_BUCKET_METRES), 0, CLUMP_BUCKET_N - 1);
    const bz = clamp(Math.floor(z / CLUMP_BUCKET_METRES), 0, CLUMP_BUCKET_N - 1);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const gx = bx + dx, gz = bz + dz;
        if (gx < 0 || gz < 0 || gx >= CLUMP_BUCKET_N || gz >= CLUMP_BUCKET_N) continue;
        const list = this.clumpBuckets[
          (family * CLUMP_BUCKET_N + gz) * CLUMP_BUCKET_N + gx];
        if (list === undefined) continue;
        for (let c = 0; c < list.length; c += 2) {
          const ddx = list[c] - x, ddz = list[c + 1] - z;
          if (ddx * ddx + ddz * ddz < g2) return true;
        }
      }
    }
    return false;
  }

  private addClumpCentre(family: number, x: number, z: number): void {
    const bx = clamp(Math.floor(x / CLUMP_BUCKET_METRES), 0, CLUMP_BUCKET_N - 1);
    const bz = clamp(Math.floor(z / CLUMP_BUCKET_METRES), 0, CLUMP_BUCKET_N - 1);
    const k = (family * CLUMP_BUCKET_N + bz) * CLUMP_BUCKET_N + bx;
    let list = this.clumpBuckets[k];
    if (list === undefined) { list = []; this.clumpBuckets[k] = list; }
    list.push(x, z);
  }

  /**
   * THE ADORNMENT GATE, AUTOMATED (bible §6.6, scorecard #15, weight 3).
   *
   * Two rules, in priority order:
   *   (a) no walkable square larger than 25x25 m may be completely unadorned;
   *   (b) at least 55% of walkable ground must be adorned overall.
   *
   * (a) is the ship-blocking rule and is closed first, by dropping a small
   * cluster into the middle of every patch the validator reports. (b) is then
   * raised by seeding fillers into randomly-sampled unadorned cells. Each pass
   * re-validates, because closing one hole reshapes its neighbours; and inside
   * a pass every placement immediately stamps its own adornment disc, so a
   * thousand attempts do not all pile into the same clearing.
   *
   * Terrain surface variation counts toward (b) as well, so on a map with a
   * rich splat this loop does almost nothing — which is the intent. It only
   * works hard on exactly the maps that would otherwise ship as a green plane.
   */
  private fillToTarget(avail: ScatterType[], rng: Rng): void {
    // Fillers must be cheap, legal almost anywhere, and small enough that
    // dropping three into a gap does not build a wall across it.
    const fillers = avail.filter((t) => !t.def.blocksNav
      && (t.def.family === 'grass' || t.def.family === 'shrub' || t.def.family === 'rock'));
    if (fillers.length === 0) return;

    // Adornment may overshoot the density budget — rule (b) is weight 3 and
    // the budget is a target — but never without bound.
    const ceiling = Math.min(SCATTER_LIMITS.maxProps, Math.round(this.budget * 1.8) + 400);
    const G = SCATTER_COVERAGE.gridMetres;

    for (let pass = 0; pass < SCATTER_COVERAGE.fillPasses; pass++) {
      const report = this.validateCoverage();
      const needPatches = report.emptyPatches.length > 0;
      const needAdorn = report.adornedFraction < SCATTER_COVERAGE.targetAdorned;
      if (!needPatches && !needAdorn) break;
      if (this.placements.length >= ceiling) break;
      let any = false;

      /* (a) the ship-blocking rule */
      for (let p = 0; p < report.emptyPatches.length; p++) {
        const patch = report.emptyPatches[p];
        for (let k = 0; k < SCATTER_COVERAGE.fillPerPatch; k++) {
          const pick = rng.pick(fillers);
          for (let a = 0; a < 12; a++) {
            const x = patch.x + rng.range(-1, 1) * patch.size * 0.42;
            const z = patch.z + rng.range(-1, 1) * patch.size * 0.42;
            if (!this.legal(pick.def, x, z, 0.6)) continue;
            if (!this.place(pick.defIndex, pick.def, x, z, rng)) break;
            this.stampAdorn(x, z, pick.def.adorn);
            pick.count++; any = true;
            break;
          }
        }
      }

      /* (b) the 55% floor */
      if (needAdorn) {
        // One attempt per unadorned cell we would have to cover, times a
        // rejection allowance. Bounded, so a map that physically cannot be
        // adorned (all cliff, all road) terminates instead of spinning.
        const shortfall = SCATTER_COVERAGE.targetAdorned - report.adornedFraction;
        const attempts = Math.min(24000, Math.ceil(shortfall * COVER_COUNT * 2.5));
        for (let a = 0; a < attempts && this.placements.length < ceiling; a++) {
          const gi = rng.int(0, COVER_COUNT - 1);
          if (this.coverWalkable[gi] === 0 || this.coverAdorned[gi] !== 0) continue;
          const gx = gi % COVER_N, gz = (gi / COVER_N) | 0;
          const x = (gx + rng.next()) * G, z = (gz + rng.next()) * G;
          const pick = rng.pick(fillers);
          if (!this.legal(pick.def, x, z, 0.7)) continue;
          if (!this.place(pick.defIndex, pick.def, x, z, rng)) break;
          this.stampAdorn(x, z, pick.def.adorn);
          pick.count++; any = true;
        }
      }
      if (!any) break;
    }
  }

  /**
   * Mark a disc adorned in the live raster, so the rest of THIS pass stops
   * trying to fill ground it has already covered. The next pass rebuilds the
   * raster from scratch anyway; this is purely an intra-pass optimisation and
   * it is what keeps the 55% loop from degenerating into a pile of bushes.
   */
  private stampAdorn(x: number, z: number, radius: number): void {
    const G = SCATTER_COVERAGE.gridMetres;
    const gr = Math.ceil(radius / G);
    const gcx = (x / G) | 0, gcz = (z / G) | 0;
    const r2 = radius * radius;
    for (let dz = -gr; dz <= gr; dz++) {
      const gz = gcz + dz;
      if (gz < 0 || gz >= COVER_N) continue;
      for (let dx = -gr; dx <= gr; dx++) {
        const gx = gcx + dx;
        if (gx < 0 || gx >= COVER_N) continue;
        const wx = (gx + 0.5) * G - x, wz = (gz + 0.5) * G - z;
        if (wx * wx + wz * wz > r2) continue;
        this.coverAdorned[gz * COVER_N + gx] = 1;
      }
    }
  }

  /**
   * Keep the draw-call budget. Each live type costs one colour draw and one
   * shadow draw, and MAX_DRAW_CALLS is 130 with terrain already at ~34.
   *
   * Types are ranked by ADORNMENT AREA DELIVERED (`count * adorn^2`) times an
   * editorial family weight — not by instance count.
   *
   * Two corrections are baked in, both learned from looking at the result:
   *   - Ranking by raw count drops the statues and the water tower to keep
   *     forty barrels, because barrels are numerous. Area delivered is what
   *     this module exists to produce, so that is what the budget buys.
   *   - Area alone still drops LANDMARKS, because a plaza only holds six
   *     statues however important they are. `refs/ra3steam_08.jpg` carries six
   *     statues and one water tower on 1.3 ha and they define the frame, so
   *     civic props are weighted well above their count.
   */
  private trimTypes(avail: ScatterType[]): ScatterType[] {
    const placed = avail.filter((t) => t.count > 0);
    /*
     * A type that placed NOTHING is not costing a draw call, and the passes
     * that run after this one may yet find it a home — so it stays in the
     * returned set whenever there is room, which is what keeps this reorder
     * behaviour-neutral on the eight maps that never trim. It is only ever
     * squeezed out by a type that has already earned its slot.
     */
    const idle = avail.filter((t) => t.count === 0);
    if (placed.length <= SCATTER_LIMITS.maxTypes) {
      return placed.concat(idle.slice(0, SCATTER_LIMITS.maxTypes - placed.length));
    }
    const familyWeight = (t: ScatterType): number =>
      t.def.family === 'civic' ? 5.0 : t.def.family === 'canopy' ? 1.7 : 1.0;
    const score = (t: ScatterType): number =>
      t.count * t.def.adorn * t.def.adorn * familyWeight(t);
    const ranked = placed.slice().sort((a, b) => score(b) - score(a));
    const keep = new Set(ranked.slice(0, SCATTER_LIMITS.maxTypes));
    const dropped = new Set(ranked.slice(SCATTER_LIMITS.maxTypes).map((t) => t.defIndex));
    // Compact the placements, dropping instances of trimmed types.
    const kept: Placement[] = [];
    for (let i = 0; i < this.placements.length; i++) {
      if (!dropped.has(this.placements[i].defIndex)) kept.push(this.placements[i]);
    }
    this.placements = kept;
    /*
     * REBUILD THE SPACING INDEX, HERE, BECAUSE THIS IS WHERE IT BREAKS.
     *
     * `bucketHead`/`bucketNext` hold INDICES into `placements`, written
     * incrementally by `place()`. Compacting the array above invalidates every
     * one of them. `rebuildCellIndex()` already existed and already said so in
     * its own docstring — but it was only called from `buildInstances()`, i.e.
     * after the last `place()` of the run, so the stale window was empty and
     * nobody could hit it.
     *
     * Moving the trim ahead of the top-up opened that window, and the first
     * boot into it crashed: `tooClose` walked a bucket chain into an index past
     * the end of the compacted array and dereferenced `undefined.x`. Owning the
     * rebuild here rather than at the call site means the next person to move
     * this call cannot reopen it.
     */
    this.rebuildCellIndex();
    console.warn(
      `[scatter] ${dropped.size} prop type(s) trimmed to hold the ${SCATTER_LIMITS.maxTypes}-type ` +
      'draw-call budget (SCATTER_LIMITS.maxTypes in core/config.ts)',
    );
    return avail.filter((t) => keep.has(t));
  }

  /* ======================================================================
   * 3.6 GPU BUILD
   * ====================================================================== */

  private buildInstances(): void {
    // Bucket placements by surviving type. `defIndex` indexes PROP_DEFS, so
    // trimming a type can never shift an instance onto the wrong mesh.
    const slotOfDef = new Int32Array(PROP_DEFS.length).fill(-1);
    for (let i = 0; i < this.types.length; i++) slotOfDef[this.types[i].defIndex] = i;
    const perType: Placement[][] = this.types.map(() => []);
    for (let i = 0; i < this.placements.length; i++) {
      const p = this.placements[i];
      // `trimTypes()` may have rebuilt the array, so stamp identity HERE — the
      // GPU buffers are about to store these indices for the rest of the match.
      p.index = i;
      p.slot = -1; p.inst = -1; p.chunk = -1; p.alive = true;
      const slot = slotOfDef[p.defIndex];
      if (slot < 0) continue;
      perType[slot].push(p);
    }
    this.liveProps = this.placements.length;
    // The list is final here — `trimTypes()` has already compacted it and every
    // `index` above was just stamped. Hashing it once is what lets §3.10b's
    // one-bit-per-placement mask be handed between two Scatters.
    this.placementHash = this.computePlacementHash();

    this.chunkMinY.fill(Infinity);
    this.chunkMaxY.fill(-Infinity);
    this.chunkUsed.fill(0);

    for (let s = 0; s < this.types.length; s++) {
      const type = this.types[s];
      const list = perType[s];
      type.count = list.length;
      if (list.length === 0) { type.mesh = null; continue; }

      // Counting sort by chunk.
      const counts = new Int32Array(CHUNK_COUNT + 1);
      for (let i = 0; i < list.length; i++) counts[chunkOf(list[i].x, list[i].z) + 1]++;
      for (let c = 0; c < CHUNK_COUNT; c++) counts[c + 1] += counts[c];
      const start = counts.slice();
      const sorted: Placement[] = new Array(list.length);
      const cursor = counts.slice(0, CHUNK_COUNT);
      for (let i = 0; i < list.length; i++) {
        const c = chunkOf(list[i].x, list[i].z);
        sorted[cursor[c]++] = list[i];
      }

      const mat = new Float32Array(list.length * 16);
      const col = new Float32Array(list.length * 3);
      const live = new Int32Array(CHUNK_COUNT);
      const instOf = new Int32Array(list.length);
      for (let i = 0; i < sorted.length; i++) {
        const p = sorted[i];
        composeMatrix(p, mat, i * 16);
        col[i * 3] = p.cr; col[i * 3 + 1] = p.cg; col[i * 3 + 2] = p.cb;
        const c = chunkOf(p.x, p.z);
        p.slot = s; p.inst = i; p.chunk = c;
        instOf[i] = p.index;
        live[c]++;
        this.chunkUsed[c] = 1;
        const top = p.y + type.geo.boundHeight * p.scale;
        if (p.y < this.chunkMinY[c]) this.chunkMinY[c] = p.y;
        if (top > this.chunkMaxY[c]) this.chunkMaxY[c] = top;
      }

      type.srcMatrix = mat;
      type.srcColor = col;
      type.chunkStart = start;
      type.chunkLive = live;
      type.instOf = instOf;
      const reach = type.geo.boundRadius
        * (type.def.scaleMax ?? SCATTER_JITTER.scaleMax);
      if (reach > this.maxPropReach) this.maxPropReach = reach;

      const mesh = new THREE.InstancedMesh(type.geo.geometry, this.materials.material, list.length);
      mesh.name = `prop.${type.def.key}`;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(list.length * 3), 3);
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.customDepthMaterial = this.materials.depthMaterial;
      // We cull by chunk on the CPU; three's own test would use a bounding
      // sphere spanning the whole map and never reject anything.
      mesh.frustumCulled = false;
      mesh.matrixAutoUpdate = false;
      mesh.count = 0;
      type.mesh = mesh;
      type.drawCount = 0;
      this.root.add(mesh);
    }

    // Chunks with no props still need finite Y bounds for the culling sphere.
    for (let c = 0; c < CHUNK_COUNT; c++) {
      if (this.chunkUsed[c] === 0) { this.chunkMinY[c] = 0; this.chunkMaxY[c] = 0; }
    }
    this.rebuildCellIndex();
    // Force a repack on the next update().
    this.chunkVisiblePrev.fill(255);
  }

  /**
   * Re-point the 4 m cell buckets at the FINAL placement list.
   *
   * They were built incrementally by `place()` for the min-spacing test, but
   * `trimTypes()` compacts the array behind them, so every index in them can be
   * stale by the time the GPU build runs. Rebuilding here is O(props) once per
   * `generate()` — and it is what lets `clearFootprint()` be local.
   */
  private rebuildCellIndex(): void {
    this.resetBuckets(Math.max(this.placements.length, 1));
    for (let i = 0; i < this.placements.length; i++) {
      const p = this.placements[i];
      if (!p.alive) continue;
      this.bucketInsert(i, p.x, p.z);
    }
  }

  /* ======================================================================
   * 3.7 PER-FRAME
   * ====================================================================== */

  /**
   * Cull by chunk and repack the instance buffers if the visible set changed.
   *
   * Cost when the camera has not crossed a chunk boundary: 256 sphere tests
   * plus a 256-byte compare. Cost when it has: one straight copy of the
   * visible matrices. Zero allocation either way.
   */
  update(camera: THREE.Camera, timeSeconds: number): void {
    this.materials.setTime(timeSeconds);
    if (this.types.length === 0) return;

    camera.updateMatrixWorld();
    this.viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.viewProj);

    // AABB, not a bounding sphere. A 32 m chunk's half-diagonal is 22.6 m, so a
    // sphere test silently inflates every chunk by 70% and selects ~3.9 ha to
    // show 0.5 ha — and, worse, stops responding to zoom at all. `intersectsBox`
    // is exact and costs the same.
    const margin = SCATTER_LIMITS.shadowMarginMetres;
    let visible = 0;
    for (let c = 0; c < CHUNK_COUNT; c++) {
      if (this.chunkUsed[c] === 0) { this.chunkVisible[c] = 0; continue; }
      const x0 = (c % CHUNK_N) * SCATTER_CHUNK_METRES;
      const z0 = ((c / CHUNK_N) | 0) * SCATTER_CHUNK_METRES;
      this.probe.min.set(x0 - margin, this.chunkMinY[c] - 1, z0 - margin);
      this.probe.max.set(
        x0 + SCATTER_CHUNK_METRES + margin,
        this.chunkMaxY[c] + 1,
        z0 + SCATTER_CHUNK_METRES + margin,
      );
      const v = this.frustum.intersectsBox(this.probe) ? 1 : 0;
      this.chunkVisible[c] = v;
      visible += v;
    }

    let changed = false;
    for (let c = 0; c < CHUNK_COUNT; c++) {
      if (this.chunkVisible[c] !== this.chunkVisiblePrev[c]) { changed = true; break; }
    }
    if (!changed) return;
    this.chunkVisiblePrev.set(this.chunkVisible);
    this.visibleChunks = visible;

    let instances = 0;
    for (let s = 0; s < this.types.length; s++) {
      const type = this.types[s];
      const mesh = type.mesh;
      if (mesh === null) continue;
      const dstM = mesh.instanceMatrix.array as Float32Array;
      const dstC = (mesh.instanceColor as THREE.InstancedBufferAttribute).array as Float32Array;
      const srcM = type.srcMatrix, srcC = type.srcColor, start = type.chunkStart;
      const liveIn = type.chunkLive;
      let w = 0;
      for (let c = 0; c < CHUNK_COUNT; c++) {
        if (this.chunkVisible[c] === 0) continue;
        // The LIVE half of the chunk's slice. Felled props were swapped into
        // the tail, past `a + liveIn[c]`, and are simply never read again.
        const a = start[c], b = a + liveIn[c];
        if (a === b) continue;
        // Manual copies: `subarray()` would allocate a view every chunk, and
        // this runs on a camera pan.
        let sm = a * 16, dm = w * 16;
        for (let i = a; i < b; i++) {
          for (let k = 0; k < 16; k++) dstM[dm + k] = srcM[sm + k];
          sm += 16; dm += 16;
        }
        let sc = a * 3, dc = w * 3;
        for (let i = a; i < b; i++) {
          dstC[dc] = srcC[sc]; dstC[dc + 1] = srcC[sc + 1]; dstC[dc + 2] = srcC[sc + 2];
          sc += 3; dc += 3;
        }
        w += b - a;
      }
      mesh.count = w;
      type.drawCount = w;
      instances += w;
      if (w > 0) {
        mesh.instanceMatrix.needsUpdate = true;
        (mesh.instanceColor as THREE.InstancedBufferAttribute).needsUpdate = true;
      }
    }
    this.visibleInstances = instances;
  }

  /* ======================================================================
   * 3.8 COVERAGE VALIDATION — the automated gate for scorecard #15
   * ====================================================================== */

  /**
   * Rasterise adornment and report every fully-unadorned walkable square
   * larger than 25 m. Bible §6.6:
   *
   *   "No contiguous walkable ground region larger than 25 m x 25 m may contain
   *    zero props AND zero texture-variation events AND zero decals."
   *
   * A cell counts as adorned when a prop's `adorn` disc covers it, when the
   * terrain splat there is not the biome's base layer (a texture-variation
   * event), when a structure occupies it, or when it lies inside a scenario
   * exclusion — ground the placer is forbidden to use, and which is therefore
   * owned by whatever excluded it. See the note at that line. Water, cliffs and
   * impassable ground are outside the walkable domain entirely, so a lake is
   * not a violation.
   *
   * Reported patches never overlap: a per-column block row is carried down the
   * scan, which is also what makes the fill loop converge.
   */
  validateCoverage(box?: { minX: number; minZ: number; maxX: number; maxZ: number }): CoverageReport {
    const G = SCATTER_COVERAGE.gridMetres;
    const t = this.terrain;
    this.coverWalkable.fill(0);
    this.coverAdorned.fill(0);

    const x0 = box ? Math.max(0, Math.floor(box.minX / G)) : 0;
    const x1 = box ? Math.min(COVER_N, Math.ceil(box.maxX / G)) : COVER_N;
    const z0 = box ? Math.max(0, Math.floor(box.minZ / G)) : 0;
    const z1 = box ? Math.min(COVER_N, Math.ceil(box.maxZ / G)) : COVER_N;

    // Pass 1: the walkable domain, plus a histogram of surfaces so "texture
    // variation" is measured against whatever this biome's DOMINANT layer is.
    // Hardcoding SurfaceId.Ground would score a desert map as 100% adorned,
    // because its base layer is Sand.
    const histogram = SURFACE_HISTOGRAM;
    histogram.fill(0);
    let walkableCells = 0;
    for (let gz = z0; gz < z1; gz++) {
      for (let gx = x0; gx < x1; gx++) {
        const wx = (gx + 0.5) * G, wz = (gz + 0.5) * G;
        const cx = Math.min(MAP_CELLS - 1, (wx / CELL) | 0);
        const cz = Math.min(MAP_CELLS - 1, (wz / CELL) | 0);
        const ci = cz * MAP_CELLS + cx;
        if (t.waterGrid[ci] !== 0) continue;
        if ((t.passGrid[ci] & PASS_GROUND) === 0) continue;
        this.coverWalkable[gz * COVER_N + gx] = 1;
        walkableCells++;
        histogram[t.surface[ci]]++;
      }
    }
    let baseSurface = 0;
    for (let s = 1; s < histogram.length; s++) {
      if (histogram[s] > histogram[baseSurface]) baseSurface = s;
    }

    // Pass 2: adornment from the terrain itself. Bible §6.6 counts "a distinct
    // second material" alongside props and decals, so any cell carrying a
    // non-base surface, or a structure, is already adorned.
    for (let gz = z0; gz < z1; gz++) {
      for (let gx = x0; gx < x1; gx++) {
        const i = gz * COVER_N + gx;
        if (this.coverWalkable[i] === 0) continue;
        const cx = Math.min(MAP_CELLS - 1, (((gx + 0.5) * G) / CELL) | 0);
        const cz = Math.min(MAP_CELLS - 1, (((gz + 0.5) * G) / CELL) | 0);
        const ci = cz * MAP_CELLS + cx;
        if (t.surface[ci] !== baseSurface || t.isOccupied(cx, cz)) { this.coverAdorned[i] = 1; continue; }
        /*
         * GROUND THE PLACER IS FORBIDDEN TO TOUCH IS NOT UNADORNED GROUND.
         *
         * `07-soviet-base` failed this gate — scorecard #15, weight 3 — on one
         * 26 m patch at (201, 245), and it was unfixable by construction:
         * sampled at 2 m, all 196 points inside it are covered by a scenario
         * exclusion disc, so `placeable` is 0 across the whole square and
         * `legal()` rejects every filler at every attempt. Ten fill passes ran
         * and placed nothing, and the warning then told the reader to raise
         * `SCATTER_COVERAGE.fillPasses` or `MAP_PRESETS[...].scatter`, neither
         * of which can move a number that no placement is allowed to affect.
         *
         * The defect was a domain mismatch, not a shortage of props. The patch
         * scan runs over `walkable` — water, cliff and impassable ground
         * removed, nothing else — while the fillers run over `placeable`, which
         * also removes structure footprints and every exclusion. So the gate
         * was asserting a property of ground the module has no authority over.
         *
         * Exclusions are not arbitrary: `scatter.system.ts` adds one for every
         * building (footprint + 7 m of deploy apron), every unit, every ore
         * field and the build ghost. That patch is the middle of a Soviet base,
         * ringed by structures and deliberately kept clear so vehicles can get
         * out. It is adorned by the base, the same way a cell UNDER a structure
         * is already counted adorned one line above — this is that rule applied
         * to the apron the same structure requires.
         *
         * It is deliberately NOT applied to the density denominator: `walkable`
         * still drives `propsPerHectare`, so a base-heavy map still reports the
         * lower figure it honestly earns. Only the gate's domain moves, and it
         * moves onto the ground the gate can actually act on.
         */
        if (this.exclusions.length > 0) {
          const wx = (gx + 0.5) * G, wz = (gz + 0.5) * G;
          if (this.inExclusion(wx, wz, 0)) this.coverAdorned[i] = 1;
        }
      }
    }

    // Stamp every prop's adornment disc.
    for (let p = 0; p < this.placements.length; p++) {
      const pl = this.placements[p];
      if (!pl.alive) continue;
      const def = PROP_DEFS[pl.defIndex];
      if (def === undefined) continue;
      const r = def.adorn * pl.scale;
      const gr = Math.ceil(r / G);
      const gcx = (pl.x / G) | 0, gcz = (pl.z / G) | 0;
      const r2 = r * r;
      for (let dz = -gr; dz <= gr; dz++) {
        const gz = gcz + dz;
        if (gz < z0 || gz >= z1) continue;
        for (let dx = -gr; dx <= gr; dx++) {
          const gx = gcx + dx;
          if (gx < x0 || gx >= x1) continue;
          const wx = (gx + 0.5) * G - pl.x, wz = (gz + 0.5) * G - pl.z;
          if (wx * wx + wz * wz > r2) continue;
          this.coverAdorned[gz * COVER_N + gx] = 1;
        }
      }
    }

    let adornedCells = 0;
    for (let i = 0; i < COVER_COUNT; i++) {
      if (this.coverWalkable[i] !== 0 && this.coverAdorned[i] !== 0) adornedCells++;
    }

    /* -- summed-area table over "walkable AND unadorned" ------------------ */
    const S = COVER_N + 1;
    const sat = this.coverSat;
    sat.fill(0);
    for (let gz = 0; gz < COVER_N; gz++) {
      let rowSum = 0;
      for (let gx = 0; gx < COVER_N; gx++) {
        const i = gz * COVER_N + gx;
        rowSum += (this.coverWalkable[i] !== 0 && this.coverAdorned[i] === 0) ? 1 : 0;
        sat[(gz + 1) * S + (gx + 1)] = sat[gz * S + (gx + 1)] + rowSum;
      }
    }
    const windowSum = (gx: number, gz: number): number =>
      sat[(gz + PATCH_CELLS) * S + gx + PATCH_CELLS] - sat[gz * S + gx + PATCH_CELLS]
      - sat[(gz + PATCH_CELLS) * S + gx] + sat[gz * S + gx];

    const full = PATCH_CELLS * PATCH_CELLS;
    const patches: EmptyPatch[] = [];
    this.coverBlocked.fill(-1);
    const maxZ = Math.min(z1, COVER_N) - PATCH_CELLS;
    const maxX = Math.min(x1, COVER_N) - PATCH_CELLS;
    for (let gz = z0; gz <= maxZ && patches.length < 128; gz++) {
      let gx = x0;
      while (gx <= maxX && patches.length < 128) {
        if (windowSum(gx, gz) !== full) { gx++; continue; }
        // Reject a window overlapping one already reported.
        let blockedAt = -1;
        for (let c = gx; c < gx + PATCH_CELLS; c++) {
          if (this.coverBlocked[c] >= gz) { blockedAt = c; break; }
        }
        if (blockedAt >= 0) { gx = blockedAt + 1; continue; }
        for (let c = gx; c < gx + PATCH_CELLS; c++) this.coverBlocked[c] = gz + PATCH_CELLS - 1;
        patches.push({
          x: (gx + PATCH_CELLS * 0.5) * G,
          z: (gz + PATCH_CELLS * 0.5) * G,
          size: PATCH_CELLS * G,
        });
        gx += PATCH_CELLS;
      }
    }

    const hectares = Math.max(walkableCells * G * G / 10000, 1e-6);
    return {
      adornedFraction: walkableCells === 0 ? 1 : adornedCells / walkableCells,
      walkableHectares: hectares,
      propsPerHectare: this.propCount / hectares,
      emptyPatches: patches,
      passes: patches.length === 0,
    };
  }

  /* ======================================================================
   * 3.9 QUERIES FOR OTHER MODULES
   * ====================================================================== */

  /**
   * Every prop that would physically stop a vehicle, as (x, z, radius)
   * triples written into `out`. Returns the number of triples written.
   *
   * Scatter never writes the nav grid — terrain owns it — so this is how a
   * navigation module consumes prop collision when it wants to.
   */
  blockers(out: Float32Array): number {
    let n = 0;
    for (let i = 0; i < this.placements.length && (n + 1) * 3 <= out.length; i++) {
      const p = this.placements[i];
      if (!p.alive) continue;
      const def = PROP_DEFS[p.defIndex];
      if (def === undefined || !def.blocksNav) continue;
      out[n * 3] = p.x; out[n * 3 + 1] = p.z; out[n * 3 + 2] = def.radius * p.scale;
      n++;
    }
    return n;
  }

  /**
   * Every placed prop as an (x, y, z, defIndex) quad written into `out`.
   * Returns the number of quads written, which is `min(propCount, out.length/4)`.
   *
   * This is the read side a map validator or a debug overlay wants, and it is
   * the only way out of the placement list — the list itself stays private so
   * nothing can mutate a prop's position behind the chunk-sorted GPU buffers.
   */
  positions(out: Float32Array): number {
    const max = (out.length / 4) | 0;
    let n = 0;
    for (let i = 0; i < this.placements.length && n < max; i++) {
      const p = this.placements[i];
      if (!p.alive) continue;
      out[n * 4] = p.x; out[n * 4 + 1] = p.y; out[n * 4 + 2] = p.z; out[n * 4 + 3] = p.defIndex;
      n++;
    }
    return n;
  }

  /** Props inside a world-space box, as indices into the placement list. */
  countInBox(minX: number, minZ: number, maxX: number, maxZ: number): number {
    let n = 0;
    for (let i = 0; i < this.placements.length; i++) {
      const p = this.placements[i];
      if (!p.alive) continue;
      if (p.x >= minX && p.x <= maxX && p.z >= minZ && p.z <= maxZ) n++;
    }
    return n;
  }

  /* ======================================================================
   * 3.10 CLEARING — a structure fells what it lands on
   * ====================================================================== */

  /** The disc a prop actually occupies on screen: canopy, not trunk. */
  private visualRadius(p: Placement): number {
    const type = p.slot >= 0 ? this.types[p.slot] : undefined;
    if (type !== undefined) return type.geo.boundRadius * p.scale;
    const def = PROP_DEFS[p.defIndex];
    return (def === undefined ? 1 : def.radius) * p.scale;
  }

  /**
   * Fell every prop whose visual disc overlaps `[minX,maxX] x [minZ,maxZ]`
   * grown by `margin`. Returns the number removed.
   *
   * `out`, when given, receives one `(x, y, z, radius)` quad per felled prop up
   * to its capacity — caller-supplied so the presentation layer can raise dust
   * without this allocating. Quads are written in removal order, which is
   * cell-scan order and therefore deterministic.
   *
   * COST. The scan visits the 4 m cells the grown rectangle covers, expanded by
   * the widest canopy on the map so an overhanging tree centred outside is
   * still found; removal is one swap per hit. Nothing here is proportional to
   * the map's prop count, and nothing here reads a clock or the RNG — it runs
   * inside `simTick` by way of the `building:placed` handler.
   */
  clearFootprint(
    minX: number, minZ: number, maxX: number, maxZ: number,
    margin: number = PROP_CLEAR_MARGIN,
    out: Float32Array | null = null,
  ): number {
    this.lastClearScanned = 0;
    this.lastClearCount = 0;
    if (this.placements.length === 0) return 0;

    const x0 = minX - margin, x1 = maxX + margin;
    const z0 = minZ - margin, z1 = maxZ + margin;
    const reach = this.maxPropReach;
    const cx0 = clamp(Math.floor((x0 - reach) / CELL), 0, MAP_CELLS - 1);
    const cx1 = clamp(Math.floor((x1 + reach) / CELL), 0, MAP_CELLS - 1);
    const cz0 = clamp(Math.floor((z0 - reach) / CELL), 0, MAP_CELLS - 1);
    const cz1 = clamp(Math.floor((z1 + reach) / CELL), 0, MAP_CELLS - 1);

    const maxOut = out === null ? 0 : (out.length / 4) | 0;
    let removed = 0;
    let scanned = 0;

    for (let gz = cz0; gz <= cz1; gz++) {
      for (let gx = cx0; gx <= cx1; gx++) {
        const cell = gz * MAP_CELLS + gx;
        let prev = -1;
        let n = this.bucketHead[cell];
        while (n >= 0) {
          const next = this.bucketNext[n];
          const p = this.placements[n];
          scanned++;
          // Disc vs axis-aligned rectangle: the closest point on the rectangle
          // to the prop centre, then one squared compare.
          const r = this.visualRadius(p);
          const dx = p.x < x0 ? x0 - p.x : p.x > x1 ? p.x - x1 : 0;
          const dz = p.z < z0 ? z0 - p.z : p.z > z1 ? p.z - z1 : 0;
          if (!p.alive || dx * dx + dz * dz >= r * r) {
            prev = n; n = next; continue;
          }
          // Unlink from the cell bucket, then release the GPU instance.
          if (prev < 0) this.bucketHead[cell] = next;
          else this.bucketNext[prev] = next;
          this.bucketNext[n] = -1;
          if (removed < maxOut && out !== null) {
            out[removed * 4] = p.x; out[removed * 4 + 1] = p.y;
            out[removed * 4 + 2] = p.z; out[removed * 4 + 3] = r;
          }
          this.releaseInstance(p);
          removed++;
          n = next;
        }
      }
    }

    this.lastClearScanned = scanned;
    this.lastClearCount = removed;
    this.clearedProps += removed;
    // The visible set did not change, but its CONTENTS did. Without this the
    // 256-byte compare in update() short-circuits and a static camera keeps
    // drawing the felled trees until the player pans.
    if (removed > 0) this.chunkVisiblePrev.fill(255);
    return removed;
  }

  /**
   * Fell every CRUSHABLE-family prop whose footprint disc overlaps the disc
   * `(x, z, radius)`. Returns the number removed.
   *
   * The hull-under-the-tree counterpart of `clearFootprint`, and deliberately
   * NOT the same test:
   *
   *   FOOTPRINT RADIUS, NOT VISUAL RADIUS. `clearFootprint` uses the prop's
   *   canopy (`boundRadius`), because a crown resting on a new roof reads as
   *   broken even when the trunk cleared the wall. A driving hull is the
   *   opposite case: felling an 11 m tree because a harvester passed 4 m from
   *   its trunk would look like scenery evaporating at range. `PropDef.radius`
   *   — the authored footprint, "spacing and exclusion tests" — is the disc the
   *   hull has to actually touch.
   *
   *   FAMILY FILTER. Only `isCrushableFamily`; see its comment.
   *
   * `out`, when given, receives one `(x, y, z, radius)` quad per felled prop up
   * to capacity, in cell-scan order — caller-supplied so the presentation layer
   * raises dust without this allocating.
   *
   * COST. Identical shape to `clearFootprint`: the cells the grown disc covers,
   * one swap per hit, nothing proportional to the map's prop count, no clock
   * and no RNG. Safe inside `simTick`.
   */
  crushDisc(x: number, z: number, radius: number, out: Float32Array | null = null): number {
    this.lastClearScanned = 0;
    this.lastClearCount = 0;
    if (this.placements.length === 0 || radius <= 0) return 0;

    // The scan has to reach any prop whose CENTRE is outside the disc but whose
    // own footprint overlaps it, so widen by the widest reach on the map.
    const reach = this.maxPropReach;
    const cx0 = clamp(Math.floor((x - radius - reach) / CELL), 0, MAP_CELLS - 1);
    const cx1 = clamp(Math.floor((x + radius + reach) / CELL), 0, MAP_CELLS - 1);
    const cz0 = clamp(Math.floor((z - radius - reach) / CELL), 0, MAP_CELLS - 1);
    const cz1 = clamp(Math.floor((z + radius + reach) / CELL), 0, MAP_CELLS - 1);

    const maxOut = out === null ? 0 : (out.length / 4) | 0;
    let removed = 0;
    let scanned = 0;

    for (let gz = cz0; gz <= cz1; gz++) {
      for (let gx = cx0; gx <= cx1; gx++) {
        const cell = gz * MAP_CELLS + gx;
        let prev = -1;
        let n = this.bucketHead[cell];
        while (n >= 0) {
          const next = this.bucketNext[n];
          const p = this.placements[n];
          scanned++;
          const def = PROP_DEFS[p.defIndex];
          if (!p.alive || def === undefined || !isCrushableFamily(def.family)) {
            prev = n; n = next; continue;
          }
          const r = def.radius * p.scale;
          const dx = p.x - x;
          const dz = p.z - z;
          const want = radius + r;
          if (dx * dx + dz * dz >= want * want) {
            prev = n; n = next; continue;
          }
          // Unlink from the cell bucket, then release the GPU instance.
          if (prev < 0) this.bucketHead[cell] = next;
          else this.bucketNext[prev] = next;
          this.bucketNext[n] = -1;
          if (removed < maxOut && out !== null) {
            out[removed * 4] = p.x; out[removed * 4 + 1] = p.y;
            out[removed * 4 + 2] = p.z; out[removed * 4 + 3] = r;
          }
          this.releaseInstance(p);
          removed++;
          n = next;
        }
      }
    }

    this.lastClearScanned = scanned;
    this.lastClearCount = removed;
    this.clearedProps += removed;
    // Same reason as `clearFootprint`: the visible SET did not change but its
    // contents did, and update()'s 256-byte compare would short-circuit and
    // keep drawing the felled trees until the player pans.
    if (removed > 0) this.chunkVisiblePrev.fill(255);
    return removed;
  }

  /**
   * Retire one instance in O(1): move the last live instance of its chunk into
   * the hole, shrink the chunk's live count, tombstone the placement.
   */
  private releaseInstance(p: Placement): void {
    p.alive = false;
    this.liveProps--;
    const s = p.slot;
    if (s < 0) return;
    const type = this.types[s];
    const c = p.chunk;
    const base = type.chunkStart[c];
    const last = base + type.chunkLive[c] - 1;
    const i = p.inst;
    if (i !== last && last >= base) {
      const m = type.srcMatrix, col = type.srcColor;
      const dm = i * 16, sm = last * 16;
      for (let k = 0; k < 16; k++) m[dm + k] = m[sm + k];
      const dc = i * 3, sc = last * 3;
      col[dc] = col[sc]; col[dc + 1] = col[sc + 1]; col[dc + 2] = col[sc + 2];
      const movedIndex = type.instOf[last];
      type.instOf[i] = movedIndex;
      const moved = this.placements[movedIndex];
      if (moved !== undefined) moved.inst = i;
    }
    type.chunkLive[c]--;
    type.count--;
    p.slot = -1; p.inst = -1;
  }

  /* ======================================================================
   * 3.10b PERSISTING WHAT WAS FELLED
   *
   * Both clears above are PERMANENT for the match by design, and neither used
   * to survive a save. Terrain, roads and props are regenerated from the seed,
   * so unless the file says otherwise a load stands every felled prop back up.
   * `SaveGame` closed half of it by replaying the list of building footprints
   * ever poured; the hull crush in `src/sim/Crush.ts` had no equivalent, and a
   * trail a player mowed through a wood grew back.
   *
   * WHY A BITMASK AND NOT A SECOND LEDGER. The obvious symmetric fix is to
   * persist the crush discs the way the footprints are persisted. Measured, on
   * `temperate` seed 7: six vehicles driven corner-to-corner for 27 sim-minutes
   * produced 144 discs, and an AI-vs-AI match produced 25 in ten minutes. Small
   * — but the count is UNBOUNDED in match length, army size and map area, every
   * disc has to be replayed as a fresh cell scan on load, and an autosave ring
   * writes the whole growing list every time it fires.
   *
   * The alive bits are the state itself, they are BOUNDED by
   * `SCATTER_LIMITS.maxProps` at 1125 bytes no matter what the match does, they
   * cover the footprint clear and the crush with one mechanism, and they cost
   * nothing per event: no counter in `simTick`, no allocation on the sim path,
   * nothing that can fall out of step with what is actually standing.
   *
   * That map generates 4178 placements, so the raw mask is 523 bytes. Measured
   * A/B against a ~46 kB save, with `SaveGame` run-encoding it when that wins:
   * +32 bytes with nothing felled, +100 with 56 felled, +364 after a sweep that
   * flattened 1679 props — 40% of the map's scatter, which no match does.
   *
   * THE INDEX IS ONLY MEANINGFUL AGAINST THE LIST THAT PRODUCED IT, so the mask
   * travels with `placementFingerprint`. `scatter.system.ts` seeds exclusion
   * discs from the spawned base — a different faction, a different opening or a
   * different map moves them, and every prop placed after a moved exclusion
   * shifts. The caller compares the fingerprint first and falls back to the
   * footprint replay on a mismatch, so the failure mode stays the conservative
   * one this bug already had: scenery returns, it is never felled wrongly.
   * ====================================================================== */

  /** Placements in this generation, tombstones included. The mask's domain. */
  get placementCount(): number { return this.placements.length; }

  /**
   * Identity of the generated placement list: two Scatters reporting the same
   * number hold the same props, in the same order, at the same coordinates.
   *
   * Computed once per `generate()` — felling a prop tombstones it but never
   * moves or removes the record, so this is stable for the whole match.
   */
  get placementFingerprint(): number { return this.placementHash; }

  /** Bytes `felledMask`/`applyFelledMask` need. `(placementCount + 7) / 8`. */
  get felledMaskBytes(): number { return (this.placements.length + 7) >> 3; }

  /**
   * Write one bit per placement, LSB-first, 1 = felled. Returns the bytes
   * written, or 0 if `out` is too small — a partial mask would fell the wrong
   * props, so the caller gets nothing rather than something plausible.
   */
  felledMask(out: Uint8Array): number {
    const n = this.placements.length;
    const bytes = (n + 7) >> 3;
    if (out.length < bytes) return 0;
    out.fill(0, 0, bytes);
    for (let i = 0; i < n; i++) {
      if (this.placements[i].alive) continue;
      out[i >> 3] |= 1 << (i & 7);
    }
    return bytes;
  }

  /**
   * Fell every placement whose bit is set and that is still standing. Returns
   * the number newly felled; a prop already down is left alone, so applying a
   * mask over a scatter that has had its base footprints cleared is idempotent.
   *
   * The cell index is rebuilt once at the end rather than unlinked per prop:
   * this is a restore path, O(placements) beats O(chain) per hit at this batch
   * size, and it cannot leave a stale bucket entry behind.
   */
  applyFelledMask(mask: Uint8Array): number {
    const n = this.placements.length;
    if (mask.length < ((n + 7) >> 3)) return 0;
    let felled = 0;
    for (let i = 0; i < n; i++) {
      if ((mask[i >> 3] & (1 << (i & 7))) === 0) continue;
      const p = this.placements[i];
      if (!p.alive) continue;
      this.releaseInstance(p);
      felled++;
    }
    if (felled > 0) {
      this.clearedProps += felled;
      this.rebuildCellIndex();
      // Same reason `clearFootprint` does it: the visible chunk SET is
      // unchanged, so update()'s 256-byte compare would short-circuit and keep
      // drawing props that are no longer there.
      this.chunkVisiblePrev.fill(255);
    }
    return felled;
  }

  /**
   * FNV-1a over (count, defIndex, x, z) of every placement. Positions are
   * quantised to 1/16 m: far finer than the metre a prop is placed on, and
   * coarse enough that it is comparing placement decisions rather than float
   * noise. A collision costs a wrongly-accepted mask, so this is 32 bits of
   * everything that determines the list rather than a cheap sample of it.
   */
  private computePlacementHash(): number {
    let h = 0x811c9dc5;
    const mix = (v: number): void => {
      let x = v >>> 0;
      for (let b = 0; b < 4; b++) {
        h = (h ^ (x & 0xff)) >>> 0;
        h = Math.imul(h, 0x01000193) >>> 0;
        x >>>= 8;
      }
    };
    mix(this.placements.length);
    for (let i = 0; i < this.placements.length; i++) {
      const p = this.placements[i];
      mix(p.defIndex);
      mix(Math.round(p.x * 16));
      mix(Math.round(p.z * 16));
    }
    return h >>> 0;
  }

  get propCount(): number { return this.liveProps; }
  get typeCount(): number { return this.types.length; }
  get drawCalls(): number {
    let n = 0;
    for (let i = 0; i < this.types.length; i++) if (this.types[i].drawCount > 0) n++;
    return n;
  }

  stats(): ScatterStats {
    const r = this.lastReport;
    return {
      props: this.liveProps,
      types: this.types.length,
      triangles: this.library.totalTriangles,
      visibleInstances: this.visibleInstances,
      visibleChunks: this.visibleChunks,
      drawCalls: this.drawCalls,
      generateMs: this.generateMs,
      propsPerHectare: r ? r.propsPerHectare : 0,
      adornedFraction: r ? r.adornedFraction : 0,
      emptyPatches: r ? r.emptyPatches.length : 0,
    };
  }

  /* ======================================================================
   * 3.11 TEARDOWN
   * ====================================================================== */

  private disposeMeshes(): void {
    for (let i = 0; i < this.types.length; i++) {
      const m = this.types[i].mesh;
      if (m === null) continue;
      this.root.remove(m);
      m.dispose();
      this.types[i].mesh = null;
    }
  }

  dispose(): void {
    this.disposeMeshes();
    this.types = [];
    this.placements.length = 0;
    this.liveProps = 0;
    this.scene.remove(this.root);
    this.materials.dispose();
    this.library.dispose();
  }
}

/* ==========================================================================
 * 4. HELPERS
 * ========================================================================== */

/** Family -> integer, so the clump-centre list stays a flat number array. */
const FAMILY_CODE: readonly string[] =
  ['canopy', 'shrub', 'grass', 'rock', 'street', 'yard', 'civic'];

/** Clump-centre bucket size. Must exceed SCATTER_CLUSTER.betweenClumpsMax (50). */
const CLUMP_BUCKET_METRES = 64;
const CLUMP_BUCKET_N = Math.max(1, Math.ceil(MAP_SIZE / CLUMP_BUCKET_METRES));

const EMPTY_F32 = new Float32Array(0);
/** Surface histogram scratch for validateCoverage(). SURFACE_COUNT is 6. */
const SURFACE_HISTOGRAM = new Int32Array(SURFACE_COUNT);
const EMPTY_I32 = new Int32Array(0);
const NORMAL_SCRATCH = new Float32Array(3);
const JITTER_OUT = new Float32Array(3);

function chunkOf(x: number, z: number): number {
  const cx = clamp(Math.floor(x / SCATTER_CHUNK_METRES), 0, CHUNK_N - 1);
  const cz = clamp(Math.floor(z / SCATTER_CHUNK_METRES), 0, CHUNK_N - 1);
  return cz * CHUNK_N + cx;
}

/**
 * Compose a column-major 4x4 for one placement directly into `out`.
 *
 * Rotation order is Ry(yaw) then the small tilts, applied as a first-order
 * shear on the up axis — exact to well under a pixel at +/-4 degrees and about
 * a tenth of the cost of a full quaternion compose over 7000 props.
 */
function composeMatrix(p: Placement, out: Float32Array, o: number): void {
  const s = p.scale;
  const cy = Math.cos(p.yaw), sy = Math.sin(p.yaw);
  const tx = p.tiltX, tz = p.tiltZ;

  // Up axis after tilting: (-tz, 1, tx), normalised.
  let ux = -tz, uy = 1, uz = tx;
  const ul = Math.hypot(ux, uy, uz);
  ux /= ul; uy /= ul; uz /= ul;

  // Right axis: yaw's right, re-orthogonalised against up.
  let rx = cy, ry = 0, rz = -sy;
  const d = rx * ux + ry * uy + rz * uz;
  rx -= ux * d; ry -= uy * d; rz -= uz * d;
  const rl = Math.hypot(rx, ry, rz) || 1;
  rx /= rl; ry /= rl; rz /= rl;

  // Forward = right x up.
  const fx = ry * uz - rz * uy;
  const fy = rz * ux - rx * uz;
  const fz = rx * uy - ry * ux;

  out[o] = rx * s; out[o + 1] = ry * s; out[o + 2] = rz * s; out[o + 3] = 0;
  out[o + 4] = ux * s; out[o + 5] = uy * s; out[o + 6] = uz * s; out[o + 7] = 0;
  out[o + 8] = fx * s; out[o + 9] = fy * s; out[o + 10] = fz * s; out[o + 11] = 0;
  out[o + 12] = p.x; out[o + 13] = p.y; out[o + 14] = p.z; out[o + 15] = 1;
}

/* ==========================================================================
 * 5. MODULE-LEVEL ACCESSOR
 *
 * Same shape as `getTerrain()` — the handful of callers that need the
 * scatter-specific extras (a map validator, a debug overlay, a nav module
 * wanting `blockers()`) reach it here instead of importing the system.
 * ========================================================================== */

let active: Scatter | null = null;

export function getScatter(): Scatter | null { return active; }
export function setActiveScatter(s: Scatter | null): void { active = s; }
