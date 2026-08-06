/**
 * ============================================================================
 * VOLTMARCH — src/world/Terrain.ts
 * ============================================================================
 * THE HEIGHTFIELD, THE NAV GRIDS AND THE CHUNK MESHES.
 *
 * Eight other modules read this file's query API and nothing else about it, so
 * the API is the contract and the rest is implementation. It implements
 * `ITerrain` from core/types.ts and installs itself as `world.terrain`.
 *
 * THE SHAPE DECISION (this is the whole module in one paragraph)
 * -------------------------------------------------------------
 * RA3 terrain is ARCHITECTURALLY AUTHORED, not eroded. Bible §6.4: playable
 * ground is essentially flat (+/-0.4-0.8 m of swell over 15-30 m), and every
 * piece of meaningful relief is a DISCRETE TERRACE 4-8 m tall with 2-4 tiers
 * per map. Scorecard #35 fails smooth Perlin hills explicitly. So the
 * generator does not produce a height — it produces a TIER POTENTIAL, hard
 * quantises it, and lays the gentle swell on top. The quantisation width is
 * adapted to the local gradient so the resulting face is ~1.2 m of horizontal
 * run whatever the potential's slope, which at a 6 m step is a 79 degree wall:
 * inside the bible's 78-88 degree band, every time, everywhere on the map.
 *
 * WHY THE MAP EDGE IS HIGH
 * ------------------------
 * The tier potential is blended toward 1.0 at the map rim (`BiomeDef.edgeBias`).
 * That is a look decision AND a playability decision: it guarantees the middle
 * of the map is one contiguous low plateau — 200 units can always reach each
 * other — and it puts the rocky massifs around the border, which is how RA3's
 * own maps are composed. Interior mesas still appear from the noise; anything
 * they strand is reconnected by the ramp carver below.
 *
 * THE RAMP CARVER
 * ---------------
 * A procedural terrain that quietly cuts the map into islands is a silent,
 * total failure for pathfinding, the AI and the economy. So after the
 * heightfield is built we label connected passable regions, and for every
 * stranded region above `TERRAIN_MIN_REGION_CELLS` we cut an explicit ramp at
 * a legal grade between it and the main landmass. Bible §6.4 allows exactly
 * this ("no ramps except explicit built ones") and the carved corridors are
 * marked as dirt track in the splat so they read as authored.
 *
 * RESERVED START AREAS — AND WHY THE CARVER ALONE WAS NOT ENOUGH
 * -------------------------------------------------------------
 * The carver's economy rules (skip regions under 28 cells, give up past a
 * 13-cell link or a 52 m ramp, stop at 30 ramps) are all defensible for a ledge
 * on a distant hillside. They were a BUG under an army: a real match spawned
 * tanks into a valley pocket they could never leave, and 33 of 40 biome/seed
 * combinations put stranded pockets inside the 48 m the scenarios spawn into.
 * Every one of those pockets was smaller than 28 cells, i.e. skipped on purpose.
 *
 * The fix is the one every shipped RTS map uses: start positions are RESERVED,
 * not rolled. `levelStartAreas()` runs between the heightfield and the
 * classification pass and levels each start location into a shelf — a dead-flat
 * core out to `TERRAIN_START_FLAT_RADIUS` carrying only a residual swell, then
 * an apron that clamps the natural height into a `TERRAIN_START_APRON_GRADE`
 * cone until the landform is close enough to resume untouched. The clamp is
 * what makes it read as a natural basin rather than a stamped disc: the apron
 * binds at a different distance in every direction, and the rim itself wanders
 * outward on a long-wavelength noise.
 *
 * Then three guarantees are enforced rather than assumed:
 *
 *  1. `ensureConnectivity` does not apply the minimum-region skip to any region
 *     holding a guarded start cell, and such regions draw on their own ramp
 *     budget so the global cap cannot cancel the guarantee.
 *  2. `enforceStartAreas` re-labels the grid AFTER the carver and escalates on
 *     anything still stranded inside a guard radius: a wider bounded link, then
 *     a forced BFS-shortest corridor with the length cap lifted, then as a last
 *     resort raising the pocket to its own rim so the trap stops existing.
 *  3. `prunePockets` marks every remaining tiny unreachable region impassable,
 *     OUTSIDE the start areas only. A 6-cell ledge no unit can reach is scenery;
 *     leaving it flagged passable only produces "move here" orders that can
 *     never complete.
 *
 * PERFORMANCE SHAPE
 * -----------------
 * 8x8 chunks of 64 m at a 1 m grid, ~8.2k triangles each, ONE material (the
 * ground/cliff split is a per-triangle branch inside the shader, not a second
 * draw — see TerrainMaterial.ts). Chunks with no real relief are kept out of
 * the shadow map entirely. Measured at the default 86 m of visible ground:
 * **34 draw calls and 278k triangles**, main pass plus shadow pass, against a
 * 130-draw budget for the whole game. Nothing here allocates after
 * `generate()` returns — every query path writes into a caller-supplied array.
 * ============================================================================
 */

import * as THREE from 'three';
import {
  CELL, CLIFF_SLOPE, MAP_CELLS, MAP_CELL_COUNT, MAP_SIZE, ROUGH_SLOPE,
  TERRAIN_BORDER_CELLS, TERRAIN_BUILD_FLATNESS, TERRAIN_CHUNK_METRES,
  TERRAIN_GRID, TERRAIN_GROUND_NORMAL_CLAMP, TERRAIN_LAYER_TEXTURE_SIZE,
  TERRAIN_MAIN_REGION_SHARE, TERRAIN_MAJOR_ENFORCE_PASSES, TERRAIN_MAJOR_MAX_RAMPS,
  TERRAIN_MAX_HEIGHT, TERRAIN_MAX_RAMPS, TERRAIN_MIN_REGION_CELLS,
  TERRAIN_PRUNE_REGION_CELLS, TERRAIN_RAMP_CORE_WIDTH, TERRAIN_RAMP_HALF_WIDTH,
  TERRAIN_RAMP_FORCED_CORE_WIDTH, TERRAIN_RAMP_FORCED_HALF_WIDTH,
  TERRAIN_RAMP_MAX_GRADE, TERRAIN_RAMP_MAX_LENGTH, TERRAIN_RAMP_MAX_LINK_CELLS,
  TERRAIN_SEA_BEACH_GRADE, TERRAIN_SEA_START_CLEARANCE,
  TERRAIN_SPLAT_PER_CELL, TERRAIN_START_APRON_GRADE, TERRAIN_START_DRY_MARGIN,
  TERRAIN_START_EDGE_WOBBLE, TERRAIN_START_ENFORCE_PASSES,
  TERRAIN_START_FLAT_RADIUS, TERRAIN_START_GUARD_RADIUS,
  TERRAIN_START_MAX_RAMPS, TERRAIN_START_POSITIONS, TERRAIN_START_SWELL,
  TERRAIN_START_WOBBLE_METRES, WATER_LEVEL,
  type SeaSpec,
} from '../core/config';
import { Locomotor, type EntityId, type ITerrain } from '../core/types';
import { clamp, clamp01, fbm2, isInMap, lerp, simplex2, smoothstep } from '../core/math';
import { LAYERS, RENDER_ORDER } from '../render/scene';
import { SurfaceId, getBiome, type BiomeDef, type BiomeName } from './Biomes';
import { createTerrainMaterials, type TerrainMaterialSet } from './TerrainMaterial';

/* ==========================================================================
 * 1. DERIVED LAYOUT CONSTANTS
 * ========================================================================== */

/** Metres between heightfield samples. */
export const GRID = TERRAIN_GRID;
const INV_GRID = 1 / GRID;
/** Heightfield quads along one axis (512). */
export const GRID_N = Math.round(MAP_SIZE / GRID);
/** Heightfield samples along one axis (513). */
export const GRID_STRIDE = GRID_N + 1;
/** Total heightfield samples. */
export const GRID_COUNT = GRID_STRIDE * GRID_STRIDE;
/** Chunks along one axis (8). */
export const CHUNK_N = Math.round(MAP_SIZE / TERRAIN_CHUNK_METRES);
/** Heightfield quads along one chunk edge (64). */
const CHUNK_QUADS = Math.round(TERRAIN_CHUNK_METRES / GRID);
/** Splat control texels along one axis (256). */
export const SPLAT_N = MAP_CELLS * TERRAIN_SPLAT_PER_CELL;
/** Metres per splat texel (2). */
const SPLAT_METRES = MAP_SIZE / SPLAT_N;
/** Heightfield samples per build cell (4). */
const SAMPLES_PER_CELL = Math.round(CELL / GRID);
/** Face-normal Y below which a triangle is a cliff, not ground. */
const CLIFF_NY = Math.cos(CLIFF_SLOPE);

/**
 * Passability bitmask, one bit per `Locomotor`. Exposed raw as
 * `Terrain.passGrid` so the pathfinder can read a Uint8Array directly instead
 * of paying a virtual call 16384 times per flow field.
 */
export const PASS_FOOT = 1 << Locomotor.Foot;
export const PASS_TRACK = 1 << Locomotor.Track;
export const PASS_WHEEL = 1 << Locomotor.Wheel;
export const PASS_HOVER = 1 << Locomotor.Hover;
export const PASS_STATIC = 1 << Locomotor.Static;
/** Everything that drives or walks on dry land. */
export const PASS_GROUND = PASS_FOOT | PASS_TRACK | PASS_WHEEL;

/** `costGrid` is fixed point: 100 == 1.0x movement cost. */
export const COST_UNIT = 100;
/** Cost written for a cell nothing can enter. */
export const COST_BLOCKED = 255;

/* ==========================================================================
 * 2. TERRAIN
 * ========================================================================== */

export interface TerrainOptions {
  scene: THREE.Scene;
  /** Landform seed. Same seed + same biome => byte-identical map. */
  seed: number;
  biome: BiomeName | string;
  /** Renderer capability, pushed in so this module never touches the GL context. */
  anisotropy?: number;
  /**
   * World-space start locations to reserve a levelled, connected shelf around.
   * Omit and the generator uses `TERRAIN_START_POSITIONS`. Skirmish will pass
   * its own set once there is more than one player start.
   */
  starts?: readonly StartPoint[];
  /**
   * A sea to carve, in world metres. Omit and the value published by
   * `setPlannedSea()` is used; pass `null` to force a landlocked map.
   *
   * The default matters: `world/terrain.system.ts` constructs this class with
   * no sea option at all, so the module-level channel is the only way a
   * scenario's declared shoreline can reach the generator without that file
   * having to know the feature exists.
   */
  sea?: SeaSpec | null;
}

/** A world position the generator must guarantee an army can spawn on. */
export interface StartPoint {
  readonly x: number;
  readonly z: number;
}

/** One reserved start location and the radius its guarantee covers. */
export interface StartArea extends StartPoint {
  /** Metres of flat, dry, buildable, main-region-connected ground. */
  readonly radius: number;
  /** The elevation the shelf was levelled to, in metres. */
  readonly height: number;
}

/** What the start-area guarantee had to do this generation. For the boot log. */
export interface StartAreaReport {
  /** Start locations reserved. */
  areas: number;
  /** Ramps the carver cut specifically to reach a start region. */
  startRamps: number;
  /** Forced (length-cap lifted) corridors the escalation had to cut. */
  forcedRamps: number;
  /** Pockets raised to their own rim because no corridor could reach them. */
  filled: number;
  /** Cells demoted to scenery because nothing could ever reach them. */
  pruned: number;
  /** Guarded cells STILL not joined to the main region. Must be 0. */
  stranded: number;
  /** Corridors cut to reclaim a large stranded plateau. */
  majorRamps: number;
  /**
   * Large stranded regions the major pass could NOT reclaim — almost always an
   * island, where refusing is the correct answer. Not a failure on its own.
   */
  majorSkipped: number;
}

export class Terrain implements ITerrain {
  /* -- heightfield (grid resolution, GRID_STRIDE^2) ---------------------- */

  /** Metres above y=0 at each grid sample. */
  readonly height = new Float32Array(GRID_COUNT);
  /** Slope in radians at each grid sample, from the RAW (unclamped) gradient. */
  readonly slope = new Float32Array(GRID_COUNT);
  /**
   * Metres above the foot of the local terrace face, divided by the step
   * height and clamped to 0..1. Feeds the cliff shader's scree skirt.
   */
  readonly wallUp = new Float32Array(GRID_COUNT);
  /**
   * Metres below the lip of the local terrace face, same normalisation. Feeds
   * the coping cap and the overhang shadow.
   */
  readonly wallTop = new Float32Array(GRID_COUNT);

  /* -- per build cell (MAP_CELLS^2) -------------------------------------- */

  /** Height at the cell centre. */
  readonly cellHeight = new Float32Array(MAP_CELL_COUNT);
  /** MAX slope anywhere in the cell — a cell holding a wall is never passable. */
  readonly cellSlope = new Float32Array(MAP_CELL_COUNT);
  /** Dominant `SurfaceId`. */
  readonly surface = new Uint8Array(MAP_CELL_COUNT);
  /** Locomotor bitmask. THE array the pathfinder reads. */
  readonly passGrid = new Uint8Array(MAP_CELL_COUNT);
  /** Movement cost, `COST_UNIT` == 1.0x, `COST_BLOCKED` == impassable. */
  readonly costGrid = new Uint8Array(MAP_CELL_COUNT);
  /** 1 where a structure may be founded (before occupancy). */
  readonly buildGrid = new Uint8Array(MAP_CELL_COUNT);
  /** 1 where the cell centre is below WATER_LEVEL. */
  readonly waterGrid = new Uint8Array(MAP_CELL_COUNT);
  /** 1 where the connectivity carver cut a ramp. */
  readonly rampGrid = new Uint8Array(MAP_CELL_COUNT);

  /** EntityId of the structure standing on a cell, or 0. */
  private readonly occupant = new Int32Array(MAP_CELL_COUNT);
  private version = 0;

  /* -- splat control ------------------------------------------------------ */

  /** RGBA = weights of layers 0..3 (ground, dirt, sand, rock). */
  private readonly splatA = new Uint8Array(SPLAT_N * SPLAT_N * 4);
  /** RG = weights of layers 4..5 (concrete, paving). */
  private readonly splatB = new Uint8Array(SPLAT_N * SPLAT_N * 4);
  private readonly splatTexA: THREE.DataTexture;
  private readonly splatTexB: THREE.DataTexture;

  /* -- scene -------------------------------------------------------------- */

  private readonly scene: THREE.Scene;
  private readonly root = new THREE.Group();
  private readonly chunks: THREE.Mesh[] = [];
  readonly materials: TerrainMaterialSet;

  /* -- state -------------------------------------------------------------- */

  private seed: number;
  private biomeDef: BiomeDef;
  private rampsCarved = 0;

  /** The sea this map carries, or null for a landlocked map. */
  private sea: SeaSpec | null = null;
  /**
   * The start locations as REQUESTED, before any sea pushed them inland.
   * Kept so `setSea` can re-resolve them without the caller re-stating them.
   */
  private startRequest: readonly StartPoint[] | undefined = undefined;
  /** Start locations this terrain will reserve, in world metres. */
  private readonly startPoints: StartPoint[] = [];
  /** The reserved shelves, filled in by `levelStartAreas`. */
  private readonly startShelves: StartArea[] = [];
  /** 1 where a cell centre sits inside some start guarantee radius. */
  private readonly startMask = new Uint8Array(MAP_CELL_COUNT);
  /** What the guarantee cost this generation. */
  private readonly report: StartAreaReport = {
    areas: 0, startRamps: 0, forcedRamps: 0, filled: 0, pruned: 0, stranded: 0,
    majorRamps: 0, majorSkipped: 0,
  };

  /** Scratch reused by the region labeller. Never escapes. */
  private readonly regionId = new Int32Array(MAP_CELL_COUNT);
  private readonly regionStack = new Int32Array(MAP_CELL_COUNT);
  /** Scratch for the escalation BFS: step count and originating main-region cell. */
  private readonly bfsDist = new Int32Array(MAP_CELL_COUNT);
  private readonly bfsFrom = new Int32Array(MAP_CELL_COUNT);
  private readonly bfsQueue = new Int32Array(MAP_CELL_COUNT);
  /** Region ids that hold a guarded start cell but are not the main region. */
  private readonly strandedStarts: number[] = [];
  /** Scratch for the potential field during generation. */
  private readonly potential = new Float32Array(GRID_COUNT);
  /** Scratch for the separable min/max window that measures terrace faces. */
  private readonly windowLo = new Float32Array(GRID_COUNT);
  private readonly windowHi = new Float32Array(GRID_COUNT);

  constructor(options: TerrainOptions) {
    this.scene = options.scene;
    this.seed = options.seed | 0;
    this.biomeDef = getBiome(options.biome);
    // BEFORE setStarts: a sea moves the start points, so it has to be known
    // before they are resolved.
    this.sea = options.sea !== undefined ? options.sea : plannedSea();
    this.setStarts(options.starts);

    this.splatTexA = makeSplatTexture(this.splatA, 'terrain.splatA');
    this.splatTexB = makeSplatTexture(this.splatB, 'terrain.splatB');

    this.materials = createTerrainMaterials({
      biome: this.biomeDef,
      layerTextureSize: TERRAIN_LAYER_TEXTURE_SIZE,
      seed: this.seed,
    });
    this.materials.setSplat(this.splatTexA, this.splatTexB);
    if (options.anisotropy !== undefined) this.materials.setAnisotropy(options.anisotropy);

    this.root.name = 'Terrain';
    this.root.matrixAutoUpdate = false;
    this.scene.add(this.root);

    this.generate();
  }

  /** The active biome record. */
  get biome(): BiomeDef {
    return this.biomeDef;
  }

  /** The active biome key, for scenario save/load and the debug overlay. */
  get biomeKey(): BiomeName {
    return this.biomeDef.key;
  }

  /* ======================================================================
   * 3. GENERATION
   * ====================================================================== */

  /**
   * Rebuild everything from `seed` + `biome`. Deterministic and pure: two
   * calls with the same inputs produce byte-identical grids, which is what
   * makes the screenshot harness diffable.
   */
  generate(): void {
    this.rampsCarved = 0;
    this.report.startRamps = 0;
    this.report.forcedRamps = 0;
    this.report.filled = 0;
    this.report.pruned = 0;
    this.report.stranded = 0;
    this.report.majorRamps = 0;
    this.report.majorSkipped = 0;
    this.report.areas = this.startPoints.length;

    this.buildStartMask();
    this.buildPotential();
    this.buildHeightfield();
    // Before classification, so `computeDerived` sees the levelled shelf and
    // never marks a start cell as cliff, water or unbuildable in the first
    // place. Reserving after the fact would mean re-deriving everything twice.
    this.levelStartAreas();
    // The shelf's apron is a two-sided clamp and can raise ground. Re-assert
    // the bed before anything is classified, or a rim wobble dries the coast.
    // No-op on a landlocked map.
    this.carveSea();
    this.computeDerived();
    this.ensureConnectivity();
    this.carveSea();
    this.computeDerived();
    // Trust nothing: measure the guarantee and escalate until it holds.
    this.enforceStartAreas();
    // Then the same treatment for the map as a whole. Must run BEFORE
    // prunePockets, because pruning is the last word on passGrid and any
    // computeDerived after it would rebuild the grid and undo it.
    this.ensureMajorRegions();
    this.prunePockets();
    this.buildSplat();
    this.buildMeshes();
    this.logStartAreas();
  }

  /**
   * Replace the start locations to reserve. Takes effect on the next
   * `generate()`; the constructor calls it before its own generate.
   */
  setStarts(starts: readonly StartPoint[] | undefined): void {
    this.startRequest = starts;
    this.resolveStarts();
  }

  /**
   * Turn the requested start locations into the ones that will actually be
   * reserved, pushing any that sit on (or too near) the declared sea inland.
   *
   * A start area is guaranteed FLAT, DRY and BUILDABLE and is levelled to at
   * least `WATER_LEVEL + TERRAIN_START_DRY_MARGIN`. Leave one over water and
   * the guarantee wins — `levelStartAreas` simply fills the sea in. That is
   * exactly what drowned `08-naval-water`: `TERRAIN_START_POSITIONS` reserves
   * one shelf at the map centre, which is the one spot every fixture frames.
   *
   * Sliding along `-normal` rather than searching keeps this deterministic and
   * keeps the shelf on the map's own diagonal, which is where the authored
   * balance put it.
   */
  private resolveStarts(): void {
    this.startPoints.length = 0;
    const raw: StartPoint[] = [];
    const starts = this.startRequest;
    if (starts !== undefined && starts.length > 0) {
      for (let i = 0; i < starts.length; i++) {
        raw.push({ x: clamp(starts[i].x, 0, MAP_SIZE), z: clamp(starts[i].z, 0, MAP_SIZE) });
      }
    } else {
      for (let i = 0; i < TERRAIN_START_POSITIONS.length; i++) {
        const f = TERRAIN_START_POSITIONS[i];
        raw.push({ x: f[0] * MAP_SIZE, z: f[1] * MAP_SIZE });
      }
    }

    const sea = this.sea;
    for (let i = 0; i < raw.length; i++) {
      const p = raw[i];
      if (sea === null) {
        this.startPoints.push(p);
        continue;
      }
      // How far inland the whole flat radius has to sit. `wavinessMetres` is
      // included because the waterline wanders that far toward the land.
      const want = -(TERRAIN_START_FLAT_RADIUS + TERRAIN_START_EDGE_WOBBLE
        + sea.bandWidth + sea.wavinessMetres + TERRAIN_SEA_START_CLEARANCE);
      const d = (p.x - sea.x) * sea.normalX + (p.z - sea.z) * sea.normalZ;
      if (d <= want) {
        this.startPoints.push(p);
        continue;
      }
      const push = d - want;
      this.startPoints.push({
        x: clamp(p.x - sea.normalX * push, 0, MAP_SIZE),
        z: clamp(p.z - sea.normalZ * push, 0, MAP_SIZE),
      });
    }
    this.startShelves.length = 0;
  }

  /**
   * Declare (or clear) the sea and rebuild. Not a per-frame call — this is a
   * full regeneration, same cost as `setBiome`.
   */
  setSea(sea: SeaSpec | null): void {
    this.sea = sea;
    this.resolveStarts();
    this.rampGrid.fill(0);
    this.generate();
  }

  /** The sea this map carries, or null when it is landlocked. */
  get seaSpec(): SeaSpec | null {
    return this.sea;
  }

  /**
   * Signed metres seaward of the declared waterline, with the coastal wander
   * already applied. Negative inland. `+Infinity` would be wrong for a
   * landlocked map, so callers must check `seaSpec` first; this returns
   * -Infinity there, which reads as "as far inland as it is possible to be".
   */
  private seaDistance(x: number, z: number, sea: SeaSpec): number {
    const wob = sea.wavinessMetres > 0
      ? fbm2(x / sea.wavelengthMetres, z / sea.wavelengthMetres, 3, 2.0, 0.5, this.seed + 4409)
        * sea.wavinessMetres
      : 0;
    return (x - sea.x) * sea.normalX + (z - sea.z) * sea.normalZ + wob;
  }

  /**
   * The highest the ground is allowed to be at a given distance offshore.
   *
   * Seaward it is the bed: WATER_LEVEL falling to `WATER_LEVEL - depth` over
   * `shelfMetres`, smoothstepped so the absorption gradient has a real ramp to
   * read rather than a step. Landward it is a cone rising at
   * `TERRAIN_SEA_BEACH_GRADE`, so the coast is a beach and not a wall.
   */
  private seaCeiling(d: number, sea: SeaSpec): number {
    if (d <= 0) return WATER_LEVEL - d * TERRAIN_SEA_BEACH_GRADE;
    const t = clamp01(d / sea.shelfMetres);
    return WATER_LEVEL - sea.depth * (t * t * (3 - 2 * t));
  }

  /**
   * Re-assert the bed on the SEA SIDE ONLY.
   *
   * `buildHeightfield` already applies the full profile, so on a quiet seed
   * this changes nothing. It exists because `levelStartAreas` runs afterwards
   * and its apron is a two-sided clamp — it can RAISE ground that sits below
   * the cone — so an unlucky rim wobble could still dry a strip of coast. This
   * pass can only ever lower ground that the scenario declared to be sea, so it
   * cannot fight any land-side guarantee.
   */
  private carveSea(): void {
    const sea = this.sea;
    if (sea === null) return;
    const h = this.height;
    for (let gz = 0; gz < GRID_STRIDE; gz++) {
      const z = gz * GRID;
      const row = gz * GRID_STRIDE;
      for (let gx = 0; gx < GRID_STRIDE; gx++) {
        const x = gx * GRID;
        const d = this.seaDistance(x, z, sea);
        if (d <= 0) continue;
        const ceil = this.seaCeiling(d, sea);
        const i = row + gx;
        if (h[i] > ceil) h[i] = clamp(ceil, 0, TERRAIN_MAX_HEIGHT);
      }
    }
  }

  /**
   * The reserved start shelves, in world metres. Scenarios and skirmish setup
   * read this instead of assuming the middle of the map is standable.
   */
  startLocations(): readonly StartArea[] {
    return this.startShelves;
  }

  /** What the start-area guarantee cost this generation. */
  startReport(): Readonly<StartAreaReport> {
    return this.report;
  }

  /**
   * Map health, for the boot log and the F3 overlay. `reachable` is the
   * fraction of PASSABLE ground that the largest connected region holds — if
   * that is not 1.0 after generation, something is stranded and the AI will
   * eventually walk into it.
   */
  stats(): {
    passable: number; buildable: number; water: number; reachable: number;
    ramps: number; scenery: number; startsStranded: number; regions: number;
  } {
    let pass = 0;
    let build = 0;
    let water = 0;
    for (let i = 0; i < MAP_CELL_COUNT; i++) {
      if ((this.passGrid[i] & PASS_TRACK) !== 0) pass++;
      if (this.buildGrid[i] !== 0) build++;
      if (this.waterGrid[i] !== 0) water++;
    }
    const sizes: number[] = [];
    const regions = this.labelRegions(sizes);
    let largest = 0;
    for (let k = 1; k <= regions; k++) if (sizes[k] > largest) largest = sizes[k];
    return {
      passable: pass / MAP_CELL_COUNT,
      buildable: build / MAP_CELL_COUNT,
      water: water / MAP_CELL_COUNT,
      reachable: pass > 0 ? largest / pass : 0,
      ramps: this.rampsCarved,
      scenery: this.report.pruned,
      startsStranded: this.report.stranded,
      // The count nobody printed. `reachable` stayed above 99% on every map
      // affected by the reported bug because a fraction hides a hundred small
      // holes; the region COUNT does not.
      regions,
    };
  }

  /**
   * The tier potential: a domain-warped fbm blended toward 1.0 at the rim,
   * normalised so the full 0..tierCount range is always used whatever the
   * seed. Domain warping matters here for the same reason it matters in camo:
   * a raw fbm contour reads as "a noise function", a warped one reads as
   * "a landform".
   */
  private buildPotential(): void {
    const b = this.biomeDef;
    const p = this.potential;
    const inv = 1 / b.plateauMetres;
    const s = this.seed;

    let lo = Infinity;
    let hi = -Infinity;

    for (let gz = 0; gz < GRID_STRIDE; gz++) {
      const z = gz * GRID;
      for (let gx = 0; gx < GRID_STRIDE; gx++) {
        const x = gx * GRID;
        const wx = x * inv + simplex2(x * inv * 2.1, z * inv * 2.1, s + 31) * 0.34;
        const wz = z * inv + simplex2(x * inv * 2.1 + 4.7, z * inv * 2.1 - 2.3, s + 57) * 0.34;
        // The fine term does nothing to the plateaus (it is 3% of a tier) and
        // everything to the ISOLINE: without it the tier boundary is a smooth
        // curve and the 1 m grid renders it as a regular 45 degree staircase,
        // which reads as a grid artefact. VISUAL_DNA §1.6: cliffs are jagged,
        // with a silhouette break every 8-20 px. This is that jaggedness.
        const n = fbm2(wx, wz, 4, 2.0, 0.5, s)
          + fbm2(x * 0.075, z * 0.075, 2, 2.0, 0.5, s + 601) * 0.020;
        p[gz * GRID_STRIDE + gx] = n;
        if (n < lo) lo = n;
        if (n > hi) hi = n;
      }
    }

    const span = hi - lo < 1e-6 ? 1 : hi - lo;
    const half = MAP_SIZE * 0.5;
    const invHalf = 1 / half;

    for (let gz = 0; gz < GRID_STRIDE; gz++) {
      const z = gz * GRID;
      const dz = Math.abs(z - half) * invHalf;
      for (let gx = 0; gx < GRID_STRIDE; gx++) {
        const i = gz * GRID_STRIDE + gx;
        const x = gx * GRID;
        const dx = Math.abs(x - half) * invHalf;
        // Chebyshev radius: a square rim, so the raised border follows the map
        // edge instead of bulging into a circular arena.
        const r = dx > dz ? dx : dz;
        const edge = smoothstep(0.50, 0.99, r);
        const base = (p[i] - lo) / span;
        p[i] = clamp01(base * (1 - b.edgeBias) + edge * b.edgeBias);
      }
    }
  }

  /**
   * Quantise the potential into terraces and lay the swell on top.
   *
   * The transition width is adapted per sample: `w` is half the fraction of a
   * tier that the smoothstep spans, and dividing by the local gradient turns
   * that into a CONSTANT horizontal run in metres. Without this, a shallow
   * part of the potential produces a 20 m ramp and a steep part produces a
   * 1-sample staircase, and the map reads as noise instead of architecture.
   */
  private buildHeightfield(): void {
    const b = this.biomeDef;
    const p = this.potential;
    const h = this.height;
    const s = this.seed;
    const sea = this.sea;
    const invSwell = 1 / b.swellMetres;
    const tiers = b.tierCount;
    const halfGrad = 1 / (2 * GRID);

    for (let gz = 0; gz < GRID_STRIDE; gz++) {
      const z = gz * GRID;
      const zm = gz > 0 ? gz - 1 : 0;
      const zp = gz < GRID_N ? gz + 1 : GRID_N;
      for (let gx = 0; gx < GRID_STRIDE; gx++) {
        const i = gz * GRID_STRIDE + gx;
        const x = gx * GRID;
        const xm = gx > 0 ? gx - 1 : 0;
        const xp = gx < GRID_N ? gx + 1 : GRID_N;

        const t = p[i] * tiers;
        const gtx = (p[gz * GRID_STRIDE + xp] - p[gz * GRID_STRIDE + xm]) * tiers * halfGrad;
        const gtz = (p[zp * GRID_STRIDE + gx] - p[zm * GRID_STRIDE + gx]) * tiers * halfGrad;
        const grad = Math.sqrt(gtx * gtx + gtz * gtz);

        // Half-width of the smoothstep in TIER units, chosen so the face
        // occupies `cliffWidth` metres of horizontal run.
        //
        // The LOWER bound has to stay near zero. Clamping it up (0.02 looks
        // harmless) widens the transition wherever the potential is shallow,
        // and a shallow potential is exactly where the tier threshold spends
        // the most ground — the result is 10 m brick ramps instead of walls.
        // The upper bound only ever makes a face steeper, so it is safe.
        const w = clamp(b.cliffWidth * grad * 0.5, 0.001, 0.48);
        const floorT = Math.floor(t);
        const frac = t - floorT;
        const tierF = floorT + smoothstep(0.5 - w, 0.5 + w, frac);

        const swell = fbm2(x * invSwell, z * invSwell, 3, 2.0, 0.5, s + 907) * b.swellAmplitude;

        let y = b.baseHeight + tierF * b.stepHeight + swell;

        // Basins. Only the lowest sliver of the potential is carved, and only
        // in biomes that have water at all.
        if (b.basinDepth > 0) {
          y -= smoothstep(b.basinThreshold, 0, p[i]) * b.basinDepth;
        }

        // The declared sea. A CLAMP into the coastal cone, never a blend —
        // see TERRAIN_SEA_BEACH_GRADE for why that distinction is the whole
        // difference between a coast and a stamped wedge. Gated on `sea`, so a
        // landlocked map runs the identical arithmetic it always has.
        if (sea !== null) {
          const ceil = this.seaCeiling(this.seaDistance(x, z, sea), sea);
          if (y > ceil) y = ceil;
        }

        h[i] = clamp(y, 0, TERRAIN_MAX_HEIGHT);
      }
    }
  }

  /* ======================================================================
   * 3b. RESERVED START AREAS
   * ====================================================================== */

  /** Mark every cell whose centre falls inside a start guarantee radius. */
  private buildStartMask(): void {
    this.startMask.fill(0);
    const r = TERRAIN_START_GUARD_RADIUS;
    const r2 = r * r;
    for (let k = 0; k < this.startPoints.length; k++) {
      const p = this.startPoints[k];
      const cLo = Math.max(0, Math.floor((p.x - r) / CELL));
      const cHi = Math.min(MAP_CELLS - 1, Math.ceil((p.x + r) / CELL));
      const zLo = Math.max(0, Math.floor((p.z - r) / CELL));
      const zHi = Math.min(MAP_CELLS - 1, Math.ceil((p.z + r) / CELL));
      for (let cz = zLo; cz <= zHi; cz++) {
        const dz = (cz + 0.5) * CELL - p.z;
        for (let cx = cLo; cx <= cHi; cx++) {
          const dx = (cx + 0.5) * CELL - p.x;
          if (dx * dx + dz * dz <= r2) this.startMask[cz * MAP_CELLS + cx] = 1;
        }
      }
    }
  }

  /**
   * Level every start location into a shelf the moment the raw heightfield
   * exists, before anything is classified.
   *
   * The elevation is snapped to the nearest TERRACE rather than set to the
   * local mean, so the shelf sits on the same quantised ladder as the rest of
   * the map and reads as one of its plateaus instead of a cut. It is then held
   * clear of WATER_LEVEL, because a base whose cells classify as water is
   * impassable to everything without a skirt.
   */
  private levelStartAreas(): void {
    const b = this.biomeDef;
    const h = this.height;
    this.startShelves.length = 0;

    for (let k = 0; k < this.startPoints.length; k++) {
      const p = this.startPoints[k];

      // --- which terrace does this start naturally sit on? ------------------
      const r = TERRAIN_START_FLAT_RADIUS;
      const r2 = r * r;
      const gLo = Math.max(0, Math.floor((p.x - r) * INV_GRID));
      const gHi = Math.min(GRID_N, Math.ceil((p.x + r) * INV_GRID));
      const gzLo = Math.max(0, Math.floor((p.z - r) * INV_GRID));
      const gzHi = Math.min(GRID_N, Math.ceil((p.z + r) * INV_GRID));
      let sum = 0;
      let n = 0;
      for (let gz = gzLo; gz <= gzHi; gz++) {
        const dz = gz * GRID - p.z;
        const row = gz * GRID_STRIDE;
        for (let gx = gLo; gx <= gHi; gx++) {
          const dx = gx * GRID - p.x;
          if (dx * dx + dz * dz > r2) continue;
          sum += h[row + gx];
          n++;
        }
      }
      const mean = n > 0 ? sum / n : b.baseHeight;
      const tier = clamp(Math.round((mean - b.baseHeight) / b.stepHeight), 0, b.tierCount);
      const level = Math.max(
        b.baseHeight + tier * b.stepHeight,
        WATER_LEVEL + TERRAIN_START_DRY_MARGIN,
      );

      this.flattenDisc(
        p.x, p.z, TERRAIN_START_FLAT_RADIUS, level,
        TERRAIN_START_EDGE_WOBBLE, TERRAIN_START_SWELL,
      );

      this.startShelves.push({
        x: p.x, z: p.z, radius: TERRAIN_START_GUARD_RADIUS, height: level,
      });
    }
  }

  /**
   * Level a disc to `level` and grade the surround back into the landform.
   *
   * Inside the core the height IS the level (plus a residual swell, because a
   * dead-flat disc reads as a plate from the game camera). Outside it, the
   * natural height is CLAMPED into a cone of `TERRAIN_START_APRON_GRADE` rather
   * than blended toward the level — and that distinction is the whole trick.
   *
   * A lerp toward the level scales a 6 m terrace face down but leaves it a
   * face: at 80% blended it is still a 1.2 m step across one grid sample, i.e.
   * a 50 degree wall the nav grid still calls a cliff. A clamp REMOVES the face
   * outright wherever it exceeds the cone and leaves the terrain completely
   * untouched wherever it does not, so the shelf ends at a different distance
   * in every direction and never draws a circle on the map.
   *
   * The rim itself wanders outward on a long-wavelength noise. Outward only —
   * the guarantee is a floor, never a ceiling — and at a gradient (~0.14) that
   * cannot push the apron's effective grade past ROUGH_SLOPE.
   */
  private flattenDisc(
    px: number, pz: number, coreRadius: number, level: number,
    wobble: number, swellAmplitude: number,
  ): void {
    const b = this.biomeDef;
    const h = this.height;
    const s = this.seed;
    const g = TERRAIN_START_APRON_GRADE;
    const invSwell = 1 / b.swellMetres;
    const invWobble = 1 / TERRAIN_START_WOBBLE_METRES;
    // Past this distance the cone is wider than the map's entire relief, so the
    // clamp provably cannot bind and there is nothing to compute.
    const reach = coreRadius + wobble + TERRAIN_MAX_HEIGHT / g + GRID;

    const gxLo = Math.max(0, Math.floor((px - reach) * INV_GRID));
    const gxHi = Math.min(GRID_N, Math.ceil((px + reach) * INV_GRID));
    const gzLo = Math.max(0, Math.floor((pz - reach) * INV_GRID));
    const gzHi = Math.min(GRID_N, Math.ceil((pz + reach) * INV_GRID));

    for (let gz = gzLo; gz <= gzHi; gz++) {
      const z = gz * GRID;
      const dz = z - pz;
      const row = gz * GRID_STRIDE;
      for (let gx = gxLo; gx <= gxHi; gx++) {
        const x = gx * GRID;
        const dx = x - px;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d > reach) continue;

        const rim = wobble > 0
          ? coreRadius + clamp01(fbm2(x * invWobble, z * invWobble, 2, 2.0, 0.5, s + 1723) * 0.5 + 0.5) * wobble
          : coreRadius;
        const base = swellAmplitude > 0
          ? level + fbm2(x * invSwell, z * invSwell, 3, 2.0, 0.5, s + 907) * swellAmplitude
          : level;

        const i = row + gx;
        if (d <= rim) {
          h[i] = clamp(base, 0, TERRAIN_MAX_HEIGHT);
          continue;
        }
        const a = (d - rim) * g;
        h[i] = clamp(clamp(h[i], base - a, base + a), 0, TERRAIN_MAX_HEIGHT);
      }
    }
  }

  /**
   * Slope, terrace fraction, and every per-cell grid. Called twice: once
   * before the ramp carver and once after, because carving changes heights.
   */
  private computeDerived(): void {
    const b = this.biomeDef;
    const h = this.height;
    const sl = this.slope;
    const halfGrad = 1 / (2 * GRID);

    for (let gz = 0; gz < GRID_STRIDE; gz++) {
      const zm = (gz > 0 ? gz - 1 : 0) * GRID_STRIDE;
      const zp = (gz < GRID_N ? gz + 1 : GRID_N) * GRID_STRIDE;
      const row = gz * GRID_STRIDE;
      for (let gx = 0; gx < GRID_STRIDE; gx++) {
        const i = row + gx;
        const xm = gx > 0 ? gx - 1 : 0;
        const xp = gx < GRID_N ? gx + 1 : GRID_N;
        const dx = (h[row + xp] - h[row + xm]) * halfGrad;
        const dz = (h[zp + gx] - h[zm + gx]) * halfGrad;
        sl[i] = Math.atan(Math.sqrt(dx * dx + dz * dz));
      }
    }

    this.measureWalls();

    for (let cz = 0; cz < MAP_CELLS; cz++) {
      for (let cx = 0; cx < MAP_CELLS; cx++) {
        const ci = cz * MAP_CELLS + cx;
        const g0x = cx * SAMPLES_PER_CELL;
        const g0z = cz * SAMPLES_PER_CELL;

        let maxSlope = 0;
        let minH = Infinity;
        let maxH = -Infinity;
        for (let dz = 0; dz <= SAMPLES_PER_CELL; dz++) {
          const row = (g0z + dz) * GRID_STRIDE;
          for (let dx = 0; dx <= SAMPLES_PER_CELL; dx++) {
            const gi = row + g0x + dx;
            const sv = sl[gi];
            if (sv > maxSlope) maxSlope = sv;
            const hv = h[gi];
            if (hv < minH) minH = hv;
            if (hv > maxH) maxH = hv;
          }
        }

        const centre = h[(g0z + (SAMPLES_PER_CELL >> 1)) * GRID_STRIDE + g0x + (SAMPLES_PER_CELL >> 1)];
        this.cellHeight[ci] = centre;
        this.cellSlope[ci] = maxSlope;

        const isWater = centre < WATER_LEVEL ? 1 : 0;
        const isCliff = maxSlope >= CLIFF_SLOPE;
        const isRough = maxSlope >= ROUGH_SLOPE;
        this.waterGrid[ci] = isWater;

        const border =
          cx < TERRAIN_BORDER_CELLS || cz < TERRAIN_BORDER_CELLS ||
          cx >= MAP_CELLS - TERRAIN_BORDER_CELLS || cz >= MAP_CELLS - TERRAIN_BORDER_CELLS;

        let pass = 0;
        if (!isCliff && !border) {
          // Hover crosses water; nothing crosses a cliff.
          pass = PASS_HOVER;
          if (isWater === 0) pass |= PASS_GROUND;
        }
        this.passGrid[ci] = pass;

        this.costGrid[ci] =
          pass === 0 ? COST_BLOCKED
            : isWater ? COST_BLOCKED
              : isRough ? Math.round(COST_UNIT * 1.55)
                : COST_UNIT;

        this.buildGrid[ci] =
          !border && !isCliff && isWater === 0 &&
          maxSlope < ROUGH_SLOPE * 0.62 &&
          maxH - minH < TERRAIN_BUILD_FLATNESS
            ? 1 : 0;
      }
    }
  }

  /**
   * Measure where every sample sits inside its local terrace face, by taking
   * the min and max height over a +/-3 m window.
   *
   * The obvious cheaper answer — `fract((h - base) / stepHeight)` — is wrong,
   * and wrong in a way that is invisible until you look at a render: the swell
   * noise puts a plateau at 12.4 m or 11.6 m with equal probability, so the
   * fraction wraps between 0.07 and 0.93 along a single cliff top and the
   * coping cap breaks into disconnected slabs. Measuring the geometry instead
   * of inferring it costs one separable window pass and always agrees with
   * what is actually on screen.
   */
  private measureWalls(): void {
    const h = this.height;
    const lo = this.windowLo;
    const hi = this.windowHi;
    const R = 3;

    // Horizontal pass into the scratch pair.
    for (let gz = 0; gz < GRID_STRIDE; gz++) {
      const row = gz * GRID_STRIDE;
      for (let gx = 0; gx < GRID_STRIDE; gx++) {
        let mn = Infinity;
        let mx = -Infinity;
        const x0 = gx - R < 0 ? 0 : gx - R;
        const x1 = gx + R > GRID_N ? GRID_N : gx + R;
        for (let x = x0; x <= x1; x++) {
          const v = h[row + x];
          if (v < mn) mn = v;
          if (v > mx) mx = v;
        }
        lo[row + gx] = mn;
        hi[row + gx] = mx;
      }
    }

    // Vertical pass, straight into the output attributes.
    const invStep = 1 / this.biomeDef.stepHeight;
    for (let gz = 0; gz < GRID_STRIDE; gz++) {
      const z0 = gz - R < 0 ? 0 : gz - R;
      const z1 = gz + R > GRID_N ? GRID_N : gz + R;
      const row = gz * GRID_STRIDE;
      for (let gx = 0; gx < GRID_STRIDE; gx++) {
        let mn = Infinity;
        let mx = -Infinity;
        for (let z = z0; z <= z1; z++) {
          const i = z * GRID_STRIDE + gx;
          const a = lo[i];
          const c = hi[i];
          if (a < mn) mn = a;
          if (c > mx) mx = c;
        }
        const i = row + gx;
        const v = h[i];
        this.wallUp[i] = clamp01((v - mn) * invStep);
        this.wallTop[i] = clamp01((mx - v) * invStep);
      }
    }
  }

  /* ======================================================================
   * 4. CONNECTIVITY — the ramp carver
   * ====================================================================== */

  /**
   * Label 4-connected regions of cells a tracked vehicle can enter. Returns
   * the number of regions; `regionId` holds 0 for impassable and 1..n
   * otherwise, and `sizes[k]` is the area of region k.
   */
  private labelRegions(sizes: number[]): number {
    const id = this.regionId;
    const stack = this.regionStack;
    const pass = this.passGrid;
    id.fill(0);
    sizes.length = 1;
    sizes[0] = 0;

    let next = 0;
    for (let start = 0; start < MAP_CELL_COUNT; start++) {
      if (id[start] !== 0) continue;
      if ((pass[start] & PASS_TRACK) === 0) continue;

      next++;
      let area = 0;
      let sp = 0;
      stack[sp++] = start;
      id[start] = next;

      while (sp > 0) {
        const c = stack[--sp];
        area++;
        const cx = c % MAP_CELLS;
        const cz = (c / MAP_CELLS) | 0;

        if (cx > 0) {
          const n = c - 1;
          if (id[n] === 0 && (pass[n] & PASS_TRACK) !== 0) { id[n] = next; stack[sp++] = n; }
        }
        if (cx < MAP_CELLS - 1) {
          const n = c + 1;
          if (id[n] === 0 && (pass[n] & PASS_TRACK) !== 0) { id[n] = next; stack[sp++] = n; }
        }
        if (cz > 0) {
          const n = c - MAP_CELLS;
          if (id[n] === 0 && (pass[n] & PASS_TRACK) !== 0) { id[n] = next; stack[sp++] = n; }
        }
        if (cz < MAP_CELLS - 1) {
          const n = c + MAP_CELLS;
          if (id[n] === 0 && (pass[n] & PASS_TRACK) !== 0) { id[n] = next; stack[sp++] = n; }
        }
      }
      sizes[next] = area;
    }
    return next;
  }

  /**
   * Mark, in `out`, which region ids hold at least one guarded start cell.
   * `out[k]` is 1 for such a region and 0 otherwise; index 0 is unused.
   */
  private markStartRegions(regions: number, out: Uint8Array): void {
    out.fill(0, 0, regions + 1);
    if (this.startPoints.length === 0) return;
    const id = this.regionId;
    for (let i = 0; i < MAP_CELL_COUNT; i++) {
      if (this.startMask[i] === 0) continue;
      const r = id[i];
      if (r !== 0) out[r] = 1;
    }
  }

  /**
   * Guarantee that every worthwhile piece of ground is reachable from the main
   * landmass. Runs up to six passes because carving one ramp can merge two
   * regions and change which one is largest.
   *
   * `TERRAIN_MIN_REGION_CELLS` is the economy rule that stops the carver
   * bulldozing an 80 m trench to reach a 9-cell ledge. It does NOT apply to a
   * region holding start ground: there, the pocket is worth any ramp, because
   * it is where an army is about to be standing. Those links also draw on
   * `TERRAIN_START_MAX_RAMPS` rather than the global budget, so a map that
   * spent all thirty ramps on its hillsides still gets its start areas joined.
   */
  private ensureConnectivity(): void {
    const sizes: number[] = [];
    const order: number[] = [];
    const isStart = new Uint8Array(MAP_CELL_COUNT + 1);
    let carved = 0;
    let startCarved = 0;

    for (let pass = 0; pass < 6; pass++) {
      if (carved >= TERRAIN_MAX_RAMPS && startCarved >= TERRAIN_START_MAX_RAMPS) return;
      const regions = this.labelRegions(sizes);
      if (regions <= 1) return;

      let main = 1;
      for (let k = 2; k <= regions; k++) if (sizes[k] > sizes[main]) main = k;
      this.markStartRegions(regions, isStart);

      // Biggest stranded region first. Each carve merges regions, so spending
      // the ramp budget on the largest ones recovers the most ground per cut,
      // and a merge often drags several small neighbours along with it. Start
      // regions jump the queue whatever their size.
      order.length = 0;
      for (let k = 1; k <= regions; k++) {
        if (k === main) continue;
        if (isStart[k] !== 0 || sizes[k] >= TERRAIN_MIN_REGION_CELLS) order.push(k);
      }
      order.sort((a, b) => {
        if (isStart[a] !== isStart[b]) return isStart[b] - isStart[a];
        return sizes[b] - sizes[a];
      });
      if (order.length === 0) return;

      let carvedThisPass = 0;
      for (let i = 0; i < order.length; i++) {
        const k = order[i];
        const start = isStart[k] !== 0;
        if (start ? startCarved >= TERRAIN_START_MAX_RAMPS : carved >= TERRAIN_MAX_RAMPS) continue;
        if (!this.linkRegion(k, main)) continue;
        if (start) { startCarved++; this.report.startRamps++; } else carved++;
        carvedThisPass++;
        this.rampsCarved++;
      }
      if (carvedThisPass === 0) return;
      this.computeDerived();
    }
  }

  /**
   * Verify the start guarantee and escalate until it holds.
   *
   * This is the step the module was missing. Everything above is best-effort:
   * the carver has budgets, length caps and search windows, and every one of
   * them can legitimately decline. So after it has run, MEASURE — flood-fill
   * the grid the pathfinder will actually read and ask whether any guarded cell
   * ended up outside the main region. If one did, escalate in order of damage:
   *
   *   1. the ordinary bounded link (cheap, and usually all that is left);
   *   2. a BFS-shortest corridor with the length cap lifted — a long dirt track
   *      is ugly, an army that cannot move is fatal;
   *   3. raise the pocket to its own rim so the trap stops existing. A filled
   *      pit is strictly better than a pit with tanks in it.
   */
  private enforceStartAreas(): void {
    if (this.startPoints.length === 0) return;
    const sizes: number[] = [];
    const isStart = new Uint8Array(MAP_CELL_COUNT + 1);

    for (let pass = 0; pass < TERRAIN_START_ENFORCE_PASSES; pass++) {
      const regions = this.labelRegions(sizes);
      if (regions <= 1) { this.report.stranded = 0; return; }

      let main = 1;
      for (let k = 2; k <= regions; k++) if (sizes[k] > sizes[main]) main = k;
      this.markStartRegions(regions, isStart);

      this.strandedStarts.length = 0;
      for (let k = 1; k <= regions; k++) {
        if (k !== main && isStart[k] !== 0) this.strandedStarts.push(k);
      }
      if (this.strandedStarts.length === 0) { this.report.stranded = 0; return; }
      // Biggest first: merging the largest pocket often absorbs its neighbours.
      this.strandedStarts.sort((a, b) => sizes[b] - sizes[a]);

      let changed = false;
      for (let i = 0; i < this.strandedStarts.length; i++) {
        const k = this.strandedStarts[i];
        if (this.linkRegion(k, main)) {
          this.rampsCarved++;
          this.report.startRamps++;
          changed = true;
          continue;
        }
        if (this.linkRegionForced(k, main)) {
          this.rampsCarved++;
          this.report.forcedRamps++;
          changed = true;
          continue;
        }
        if (this.fillRegion(k)) {
          this.report.filled++;
          changed = true;
        }
      }
      if (!changed) break;
      this.computeDerived();
    }

    // Final measurement. Anything left here is a genuine generator failure and
    // is reported rather than papered over.
    const regions = this.labelRegions(sizes);
    let main = 1;
    for (let k = 2; k <= regions; k++) if (sizes[k] > sizes[main]) main = k;
    let stranded = 0;
    for (let i = 0; i < MAP_CELL_COUNT; i++) {
      if (this.startMask[i] === 0) continue;
      const r = this.regionId[i];
      if (r !== 0 && r !== main) stranded++;
    }
    this.report.stranded = stranded;
  }

  /**
   * Reclaim large stranded regions — the other half of the connectivity bug.
   *
   * `enforceStartAreas` guarantees the ground an army SPAWNS on. This
   * guarantees the ground it can later drive to. Measured across 200
   * biome/seed combinations, three maps ended generation with a single
   * stranded plateau holding 12%, 18% and 38% of all passable ground: big
   * enough to clear `TERRAIN_MIN_REGION_CELLS` and therefore genuinely queued
   * by `ensureConnectivity`, but with no corridor that fits inside
   * `TERRAIN_RAMP_MAX_LENGTH`, so the carver gave up and nothing checked.
   *
   * The rule is written as the invariant rather than as a size threshold: cut
   * the single worst split, re-measure, and stop as soon as the main region
   * holds `TERRAIN_MAIN_REGION_SHARE` of the ground that will still be passable
   * after pruning. A map that is already one piece does no work at all.
   *
   * ISLANDS ARE LEFT ALONE, and that is the point of the dry-only BFS: on the
   * three measured maps every stranded boundary was 100% cliff and 0% water, so
   * a land corridor is the right answer. On a naval map it is emphatically not
   * — dropping a causeway across a lake to reach an island would destroy the
   * map this pass exists to protect. If no dry corridor exists the region is
   * water-separated by definition, and hovercraft and transports already reach
   * it.
   */
  private ensureMajorRegions(): void {
    const sizes: number[] = [];
    const order: number[] = [];
    /** Cells the main region held at the end of the previous pass. */
    let prevMain = -1;
    /** Consecutive passes that carved without growing the main region. */
    let stalls = 0;

    for (let pass = 0; pass < TERRAIN_MAJOR_ENFORCE_PASSES; pass++) {
      if (this.report.majorRamps >= TERRAIN_MAJOR_MAX_RAMPS) return;

      const regions = this.labelRegions(sizes);
      if (regions <= 1) return;
      let main = 1;
      for (let k = 2; k <= regions; k++) if (sizes[k] > sizes[main]) main = k;

      // Ground that survives `prunePockets`. Counting the doomed scraps would
      // depress the ratio and buy ramps for cells that are about to stop
      // existing.
      let durable = 0;
      for (let k = 1; k <= regions; k++) {
        if (k === main || sizes[k] >= TERRAIN_PRUNE_REGION_CELLS) durable += sizes[k];
      }
      if (durable === 0) return;
      if (sizes[main] / durable >= TERRAIN_MAIN_REGION_SHARE) return;

      /* -- did the last carve actually breach? --------------------------------
       * `carveRamp` reports whether it MODIFIED the heightfield, not whether it
       * CONNECTED anything, and those differ: the corridor is feathered, so a
       * cut that only grazes the cliff still returns true. Trusting it meant
       * one measured seed (desert/802294) spent its entire ramp budget on
       * bounded links that never breached, and never reached the escalation.
       *
       * So the progress test is the main region's own size. No growth means the
       * pretty bounded ramp is not working here, and the next attempt goes
       * straight to the forced corridor. Two stalled passes in a row means even
       * that is not landing, and continuing would just scar the map.
       * -------------------------------------------------------------------- */
      const stalled = prevMain >= 0 && sizes[main] <= prevMain;
      if (stalled && ++stalls >= 2) {
        // Count only the regions that will still be passable after pruning —
        // reporting every 3-cell scrap as "abandoned" would bury the one number
        // that matters under noise.
        let abandoned = 0;
        for (let k = 1; k <= regions; k++) {
          if (k !== main && sizes[k] >= TERRAIN_PRUNE_REGION_CELLS) abandoned++;
        }
        this.report.majorSkipped = abandoned;
        return;
      }
      if (!stalled) stalls = 0;
      prevMain = sizes[main];

      // Largest survivor first: one carve at the worst split moves the ratio
      // further than several at the margins.
      order.length = 0;
      for (let k = 1; k <= regions; k++) {
        if (k !== main && sizes[k] >= TERRAIN_PRUNE_REGION_CELLS) order.push(k);
      }
      if (order.length === 0) return;
      order.sort((a, b) => sizes[b] - sizes[a]);

      let cut = false;
      for (let i = 0; i < order.length; i++) {
        const k = order[i];
        // The bounded link is the nicer cut, so it goes first — but only while
        // it is still earning its place. Once a pass has stalled, go straight
        // to the true-nearest corridor with the length cap lifted, restricted
        // to dry ground so an island is refused rather than causewayed.
        const ok = stalled
          ? this.linkRegionForced(k, main, true)
          : (this.linkRegion(k, main) || this.linkRegionForced(k, main, true));
        if (ok) {
          this.rampsCarved++;
          this.report.majorRamps++;
          cut = true;
          break;
        }
      }
      if (!cut) {
        // Nothing left that a dry corridor can reach: islands, or faces no
        // legal grade climbs. Recorded once, at the point we stop trying, so
        // the count is regions-abandoned and not attempts-made.
        this.report.majorSkipped = order.length;
        return;
      }
      this.computeDerived();
    }
  }

  /**
   * Demote every tiny unreachable region to scenery.
   *
   * A 6-cell ledge the carver deliberately skipped is not a bug; a 6-cell ledge
   * still flagged PASSABLE is, because the pathfinder will happily accept it as
   * the destination of a move order that can never complete, and the AI will
   * re-issue that order forever. Clearing the ground bits makes it what it
   * actually is: terrain you look at.
   *
   * Regions at or above `TERRAIN_PRUNE_REGION_CELLS` are left alone — those are
   * real mesas and islands, and a hover or a transport may legitimately want
   * them. The hover bit is never cleared for the same reason: a hovercraft that
   * can cross the water to a ledge is not stranded on it.
   */
  private prunePockets(): void {
    const sizes: number[] = [];
    const regions = this.labelRegions(sizes);
    if (regions <= 1) return;
    let main = 1;
    for (let k = 2; k <= regions; k++) if (sizes[k] > sizes[main]) main = k;

    let pruned = 0;
    for (let i = 0; i < MAP_CELL_COUNT; i++) {
      const r = this.regionId[i];
      if (r === 0 || r === main) continue;
      if (sizes[r] >= TERRAIN_PRUNE_REGION_CELLS) continue;
      // Never inside a guarantee: a hole in the base area is the bug, not the
      // fix. If one survives to here it is reported by `enforceStartAreas`.
      if (this.startMask[i] !== 0) continue;
      this.passGrid[i] &= ~PASS_GROUND;
      this.costGrid[i] = COST_BLOCKED;
      this.buildGrid[i] = 0;
      pruned++;
    }
    this.report.pruned = pruned;
  }

  /** One line at boot, but only when the guarantee actually cost something. */
  private logStartAreas(): void {
    const r = this.report;
    if (r.stranded > 0) {
      console.warn(
        `[terrain] START GUARANTEE UNMET — ${r.stranded} guarded cell(s) still cut off ` +
        `(seed ${this.seed}, biome ${this.biomeDef.key})`,
      );
      return;
    }
    if (r.startRamps === 0 && r.forcedRamps === 0 && r.filled === 0 && r.majorRamps === 0) return;
    console.info(
      `[terrain] start areas: ${r.areas} reserved, ${r.startRamps} link ramp(s), ` +
      `${r.forcedRamps} forced corridor(s), ${r.filled} pocket(s) filled, ` +
      `${r.majorRamps} plateau corridor(s), ${r.pruned} cell(s) demoted to scenery`,
    );
  }

  /**
   * Find the shortest hop between `from` and `to` and cut a ramp across it.
   * The search is a bounded window scan rather than a full BFS: a stranded
   * mesa is always within a handful of cells of the plateau below it, and an
   * unbounded search would happily connect two corners of the map with a
   * 400 m trench.
   */
  private linkRegion(from: number, to: number): boolean {
    const id = this.regionId;
    let bestD = Infinity;
    let bestA = -1;
    let bestB = -1;

    // Two attempts: a tight window first so a mesa links to the plateau
    // directly under it, then one bounded pass wider. Beyond
    // TERRAIN_RAMP_MAX_LINK_CELLS the region is left stranded on purpose —
    // cutting a 100 m trench across open ground to reach a ledge does more
    // damage to the map than the ledge is worth.
    for (const RANGE of [8, TERRAIN_RAMP_MAX_LINK_CELLS]) {
      for (let c = 0; c < MAP_CELL_COUNT; c++) {
        if (id[c] !== from) continue;
        const cx = c % MAP_CELLS;
        const cz = (c / MAP_CELLS) | 0;

        for (let dz = -RANGE; dz <= RANGE; dz++) {
          const nz = cz + dz;
          if (nz < 0 || nz >= MAP_CELLS) continue;
          for (let dx = -RANGE; dx <= RANGE; dx++) {
            const nx = cx + dx;
            if (nx < 0 || nx >= MAP_CELLS) continue;
            if (id[nz * MAP_CELLS + nx] !== to) continue;
            const d = dx * dx + dz * dz;
            if (d < bestD) {
              bestD = d;
              bestA = c;
              bestB = nz * MAP_CELLS + nx;
            }
          }
        }
      }
      if (bestA >= 0) break;
    }

    if (bestA < 0 || bestB < 0) return false;

    return this.carveRamp(
      ((bestB % MAP_CELLS) + 0.5) * CELL, (((bestB / MAP_CELLS) | 0) + 0.5) * CELL,
      ((bestA % MAP_CELLS) + 0.5) * CELL, (((bestA / MAP_CELLS) | 0) + 0.5) * CELL,
      false,
    );
  }

  /**
   * The escalation link: find the genuinely shortest hop between two regions
   * anywhere on the map and cut it with the length cap lifted.
   *
   * `linkRegion`'s windowed scan is O(cells x range^2) and so has to stay
   * bounded; this is a single multi-source BFS seeded from every cell of `to`,
   * which is O(cells) and finds the true nearest pair. The start-area
   * guarantee reaches it because "the corridor is 90 m long and shows" beats
   * "the player's army cannot move".
   *
   * `dryOnly` refuses to expand through water. The major-region pass sets it so
   * a stranded ISLAND is reported unreachable instead of being joined to the
   * mainland by a causeway — `carveRamp` interpolates height along the corridor
   * and would happily raise a lake bed into a land bridge, which is a far worse
   * map than the one it set out to repair. The start guarantee leaves it off:
   * there, a causeway is still better than an army that cannot move, and
   * `fillRegion` is waiting behind it either way.
   */
  private linkRegionForced(from: number, to: number, dryOnly = false): boolean {
    const id = this.regionId;
    const dist = this.bfsDist;
    const src = this.bfsFrom;
    const q = this.bfsQueue;
    const water = this.waterGrid;

    dist.fill(-1);
    let tail = 0;
    for (let i = 0; i < MAP_CELL_COUNT; i++) {
      if (id[i] !== to) continue;
      dist[i] = 0;
      src[i] = i;
      q[tail++] = i;
    }
    if (tail === 0) return false;

    let found = -1;
    for (let head = 0; head < tail; head++) {
      const c = q[head];
      if (id[c] === from) { found = c; break; }
      const cx = c % MAP_CELLS;
      const cz = (c / MAP_CELLS) | 0;
      const d = dist[c] + 1;
      const from0 = src[c];
      // Inlined four ways rather than through a helper: the helper would have
      // to close over `c` and `d` and so be reallocated for every one of the
      // ~16k nodes this walks.
      let n = 0;
      if (cx > 0) {
        n = c - 1;
        if (dist[n] < 0) {
          dist[n] = d; src[n] = from0;
          // A wet cell is marked visited but never expanded, so a dry-only
          // search cannot route through it. Marking rather than skipping stops
          // the frontier re-testing it from every neighbour.
          if (!dryOnly || water[n] === 0) q[tail++] = n;
        }
      }
      if (cx < MAP_CELLS - 1) {
        n = c + 1;
        if (dist[n] < 0) {
          dist[n] = d; src[n] = from0;
          if (!dryOnly || water[n] === 0) q[tail++] = n;
        }
      }
      if (cz > 0) {
        n = c - MAP_CELLS;
        if (dist[n] < 0) {
          dist[n] = d; src[n] = from0;
          if (!dryOnly || water[n] === 0) q[tail++] = n;
        }
      }
      if (cz < MAP_CELLS - 1) {
        n = c + MAP_CELLS;
        if (dist[n] < 0) {
          dist[n] = d; src[n] = from0;
          if (!dryOnly || water[n] === 0) q[tail++] = n;
        }
      }
    }
    if (found < 0) return false;

    const anchor = src[found];
    return this.carveRamp(
      ((anchor % MAP_CELLS) + 0.5) * CELL, (((anchor / MAP_CELLS) | 0) + 0.5) * CELL,
      ((found % MAP_CELLS) + 0.5) * CELL, (((found / MAP_CELLS) | 0) + 0.5) * CELL,
      true,
    );
  }

  /**
   * Last resort: raise a pocket until it is no longer a pocket.
   *
   * Reached only when no corridor at any grade can join a stranded start region
   * to the map — a pit whose rim is higher than the ramp budget can climb, or
   * one hemmed in on every side. Filling it to the rim (and grading the
   * surround with the same cone the start shelf uses, so the fill ties in
   * rather than leaving a mesa) removes the trap entirely. Losing 20 cells of
   * relief costs the map nothing; leaving a hole an army falls into costs the
   * match.
   */
  private fillRegion(region: number): boolean {
    const id = this.regionId;
    let minX = MAP_CELLS;
    let maxX = -1;
    let minZ = MAP_CELLS;
    let maxZ = -1;
    let rim = -Infinity;
    let cells = 0;

    for (let i = 0; i < MAP_CELL_COUNT; i++) {
      if (id[i] !== region) continue;
      const cx = i % MAP_CELLS;
      const cz = (i / MAP_CELLS) | 0;
      cells++;
      if (cx < minX) minX = cx;
      if (cx > maxX) maxX = cx;
      if (cz < minZ) minZ = cz;
      if (cz > maxZ) maxZ = cz;
      if (cx > 0 && id[i - 1] !== region) rim = Math.max(rim, this.cellHeight[i - 1]);
      if (cx < MAP_CELLS - 1 && id[i + 1] !== region) rim = Math.max(rim, this.cellHeight[i + 1]);
      if (cz > 0 && id[i - MAP_CELLS] !== region) rim = Math.max(rim, this.cellHeight[i - MAP_CELLS]);
      if (cz < MAP_CELLS - 1 && id[i + MAP_CELLS] !== region) rim = Math.max(rim, this.cellHeight[i + MAP_CELLS]);
    }
    if (cells === 0 || rim === -Infinity) return false;

    const cxm = (minX + maxX + 1) * 0.5 * CELL;
    const czm = (minZ + maxZ + 1) * 0.5 * CELL;
    const core = Math.max(CELL, Math.max(maxX - minX + 1, maxZ - minZ + 1) * 0.5 * CELL + CELL);
    this.flattenDisc(
      cxm, czm, core,
      clamp(rim, WATER_LEVEL + TERRAIN_START_DRY_MARGIN, TERRAIN_MAX_HEIGHT),
      0, TERRAIN_START_SWELL * 0.5,
    );
    return true;
  }

  /**
   * Cut a straight, legally graded corridor from (ax,az) on the main landmass
   * to (bx,bz) on the stranded one. The corridor is lengthened until its grade
   * is under `TERRAIN_RAMP_MAX_GRADE`, which is under ROUGH_SLOPE, so the
   * result is passable but still costs a vehicle time to climb.
   *
   * `force` lifts the length cap. Only the start-area guarantee sets it: the
   * cap exists so the carver does not bulldoze the map for a ledge nobody
   * needed, and that trade stops applying the moment the ledge is a spawn.
   *
   * Returns whether the heightfield was actually modified. The callers count
   * ramps and decide whether to escalate on that answer, so "I declined" and
   * "I cut it" must not look the same — that is how a rescue pass ends up
   * looping six times over a pocket it never touched.
   */
  private carveRamp(ax: number, az: number, bx: number, bz: number, force: boolean): boolean {
    let dx = bx - ax;
    let dz = bz - az;
    let len = Math.sqrt(dx * dx + dz * dz);
    if (len < 1e-3) {
      dx = 1; dz = 0; len = 1;
    }
    const ux = dx / len;
    const uz = dz / len;

    const PAD = 6;
    let x0 = ax - ux * PAD;
    let z0 = az - uz * PAD;
    let x1 = bx + ux * PAD;
    let z1 = bz + uz * PAD;

    // Two relaxation passes: extending the ends changes the endpoint heights,
    // which changes the length the grade requires.
    for (let iter = 0; iter < 2; iter++) {
      x0 = clamp(x0, 2, MAP_SIZE - 2); z0 = clamp(z0, 2, MAP_SIZE - 2);
      x1 = clamp(x1, 2, MAP_SIZE - 2); z1 = clamp(z1, 2, MAP_SIZE - 2);
      const h0 = this.heightAt(x0, z0);
      const h1 = this.heightAt(x1, z1);
      const l = Math.sqrt((x1 - x0) * (x1 - x0) + (z1 - z0) * (z1 - z0));
      const need = Math.abs(h1 - h0) / TERRAIN_RAMP_MAX_GRADE;
      // Too tall to bridge at a legal grade inside the length budget. Abandon
      // rather than flatten half a plateau to get there — unless the far end is
      // a start area, in which case half a plateau is the cheaper loss.
      if (need > (force ? MAP_SIZE : TERRAIN_RAMP_MAX_LENGTH)) return false;
      if (l >= need) break;
      const extra = (need - l) * 0.5;
      x0 -= ux * extra; z0 -= uz * extra;
      x1 += ux * extra; z1 += uz * extra;
    }
    x0 = clamp(x0, 2, MAP_SIZE - 2); z0 = clamp(z0, 2, MAP_SIZE - 2);
    x1 = clamp(x1, 2, MAP_SIZE - 2); z1 = clamp(z1, 2, MAP_SIZE - 2);

    const h0 = this.heightAt(x0, z0);
    const h1 = this.heightAt(x1, z1);
    const rx = x1 - x0;
    const rz = z1 - z0;
    const rl = Math.sqrt(rx * rx + rz * rz);
    if (rl < 1e-3) return false;
    const invRl2 = 1 / (rl * rl);
    let cut = false;

    // A forced corridor is widened so that whole CELLS land inside its flat
    // core. `cellSlope` is the max over the cell, so a corridor narrower than
    // the cell grid can be cut perfectly and still classify as cliff.
    const hw = force ? TERRAIN_RAMP_FORCED_HALF_WIDTH : TERRAIN_RAMP_HALF_WIDTH;
    const core = force ? TERRAIN_RAMP_FORCED_CORE_WIDTH : TERRAIN_RAMP_CORE_WIDTH;
    const gxLo = Math.max(0, Math.floor((Math.min(x0, x1) - hw) * INV_GRID));
    const gxHi = Math.min(GRID_N, Math.ceil((Math.max(x0, x1) + hw) * INV_GRID));
    const gzLo = Math.max(0, Math.floor((Math.min(z0, z1) - hw) * INV_GRID));
    const gzHi = Math.min(GRID_N, Math.ceil((Math.max(z0, z1) + hw) * INV_GRID));

    for (let gz = gzLo; gz <= gzHi; gz++) {
      const pz = gz * GRID;
      for (let gx = gxLo; gx <= gxHi; gx++) {
        const px = gx * GRID;
        let t = ((px - x0) * rx + (pz - z0) * rz) * invRl2;
        if (t < 0 || t > 1) continue;
        const cxp = x0 + rx * t;
        const czp = z0 + rz * t;
        const ddx = px - cxp;
        const ddz = pz - czp;
        const d = Math.sqrt(ddx * ddx + ddz * ddz);
        if (d > hw) continue;

        // 1 inside the flat core, feathering to 0 at the corridor edge so the
        // cut ties into the plateau instead of leaving a floating shelf.
        const w = smoothstep(hw, core, d);
        const i = gz * GRID_STRIDE + gx;
        this.height[i] = clamp(lerp(this.height[i], h0 + (h1 - h0) * t, w), 0, TERRAIN_MAX_HEIGHT);
        cut = true;

        // Only the flat core of the corridor reads as a worn dirt track; the
        // feathered edges keep whatever surface they had.
        if (w > 0.8) {
          const cx = (px / CELL) | 0;
          const cz = (pz / CELL) | 0;
          if (isInMap(cx, cz)) this.rampGrid[cz * MAP_CELLS + cx] = 1;
        }
      }
    }
    return cut;
  }

  /* ======================================================================
   * 5. SPLAT CLASSIFICATION
   * ====================================================================== */

  /**
   * Paint the six-layer control texture and derive the per-cell dominant
   * surface from it.
   *
   * The layers resolve as a PRIORITY STACK rather than a normalised blend:
   * rock wins over sand wins over dirt wins over ground, each consuming what
   * the one above it left. That is how real ground works (a rock outcrop is
   * not 40% grass) and it keeps the sum at exactly 1 without a normalise pass.
   */
  private buildSplat(): void {
    const b = this.biomeDef;
    const s = this.seed;
    const A = this.splatA;
    const B = this.splatB;
    const invDirt = 1 / b.dirtPatchMetres;
    const invSand = 1 / (b.dirtPatchMetres * 1.7);
    const totalRise = Math.max(1e-3, b.tierCount * b.stepHeight);

    for (let tz = 0; tz < SPLAT_N; tz++) {
      const z = (tz + 0.5) * SPLAT_METRES;
      const cz = clamp((z / CELL) | 0, 0, MAP_CELLS - 1);
      for (let tx = 0; tx < SPLAT_N; tx++) {
        const x = (tx + 0.5) * SPLAT_METRES;
        const cx = clamp((x / CELL) | 0, 0, MAP_CELLS - 1);
        const ci = cz * MAP_CELLS + cx;

        const h = this.heightAt(x, z);
        const slope = this.slopeAt(x, z);
        const neighbourSlope = this.cellSlope[ci];

        // Rock: steep faces, plus a scree apron wherever the neighbourhood is
        // steep even if this exact texel is flat.
        let rock = smoothstep(b.rockSlope, CLIFF_SLOPE * 0.92, slope);
        rock = Math.max(rock, smoothstep(b.rockSlope * 1.15, CLIFF_SLOPE, neighbourSlope) * 0.34);

        // Sand: shoreline band plus inland drifts.
        //
        // The threshold windows below are DELIBERATELY narrow (+/-0.07 on a
        // 0..1 noise). A wide window turns every boundary into a 30 m gradient,
        // which is the "airbrushed procedural terrain" look; the bible wants a
        // 1.5-4 m blend, and the shader's mask warp supplies the raggedness.
        let sand = 0;
        if (b.sandBandMetres > 0) {
          sand = smoothstep(WATER_LEVEL + b.sandBandMetres, WATER_LEVEL - 0.8, h);
        }
        if (b.sandPatchAmount > 0) {
          const n = fbm2(x * invSand, z * invSand, 3, 2.0, 0.5, s + 211) * 0.5 + 0.5;
          const edge = 1 - b.sandPatchAmount;
          sand = Math.max(sand, smoothstep(edge - 0.08, edge + 0.08, n));
        }

        // Dirt: blobby patches, drier with altitude, guaranteed on ramps.
        const patch = fbm2(x * invDirt, z * invDirt, 3, 2.0, 0.5, s + 13) * 0.5 + 0.5;
        const dEdge = 1 - b.dirtPatchAmount;
        let dirt = smoothstep(dEdge - 0.07, dEdge + 0.07, patch);
        dirt = clamp01(dirt + clamp01((h - b.baseHeight) / totalRise) * b.dirtAltitude);
        dirt = clamp01(dirt + smoothstep(b.rockSlope * 0.5, b.rockSlope, neighbourSlope) * 0.38);
        if (this.rampGrid[ci] !== 0) dirt = Math.max(dirt, 0.85);

        let remain = 1;
        const wRock = remain * rock; remain -= wRock;
        const wSand = remain * sand; remain -= wSand;
        const wDirt = remain * dirt; remain -= wDirt;
        const wGround = remain;

        const o = (tz * SPLAT_N + tx) * 4;
        A[o] = (wGround * 255) | 0;
        A[o + 1] = (wDirt * 255) | 0;
        A[o + 2] = (wSand * 255) | 0;
        A[o + 3] = (wRock * 255) | 0;
        B[o] = 0;
        B[o + 1] = 0;
        B[o + 2] = 0;
        B[o + 3] = 255;
      }
    }

    this.rebuildSurfaceGrid();
    this.commitSplat();
  }

  /** Recompute the per-cell dominant surface from the control texture. */
  private rebuildSurfaceGrid(): void {
    for (let cz = 0; cz < MAP_CELLS; cz++) {
      for (let cx = 0; cx < MAP_CELLS; cx++) {
        const tx = cx * TERRAIN_SPLAT_PER_CELL + (TERRAIN_SPLAT_PER_CELL >> 1);
        const tz = cz * TERRAIN_SPLAT_PER_CELL + (TERRAIN_SPLAT_PER_CELL >> 1);
        const o = (tz * SPLAT_N + tx) * 4;
        let best = 0;
        let bestW = this.splatA[o];
        for (let k = 1; k < 4; k++) {
          if (this.splatA[o + k] > bestW) { bestW = this.splatA[o + k]; best = k; }
        }
        for (let k = 0; k < 2; k++) {
          if (this.splatB[o + k] > bestW) { bestW = this.splatB[o + k]; best = 4 + k; }
        }
        this.surface[cz * MAP_CELLS + cx] = best;
      }
    }
  }

  /**
   * Paint one layer into one build cell, rescaling the others so the weights
   * still sum to 1. This is the hook the road and building-pad modules use to
   * lay concrete and cobble without adding geometry — a surface that is part
   * of the terrain splat costs zero draw calls and cannot z-fight.
   *
   * Call `commitSplat()` once after a batch of stamps.
   */
  stampSurface(cx: number, cz: number, layer: SurfaceId, weight: number): void {
    if (!isInMap(cx, cz)) return;
    const w = clamp01(weight);
    const keep = 1 - w;
    const t0x = cx * TERRAIN_SPLAT_PER_CELL;
    const t0z = cz * TERRAIN_SPLAT_PER_CELL;

    for (let dz = 0; dz < TERRAIN_SPLAT_PER_CELL; dz++) {
      for (let dx = 0; dx < TERRAIN_SPLAT_PER_CELL; dx++) {
        const o = ((t0z + dz) * SPLAT_N + t0x + dx) * 4;
        for (let k = 0; k < 4; k++) this.splatA[o + k] = (this.splatA[o + k] * keep) | 0;
        for (let k = 0; k < 2; k++) this.splatB[o + k] = (this.splatB[o + k] * keep) | 0;
        const v = (w * 255) | 0;
        if (layer < 4) this.splatA[o + layer] = v;
        else this.splatB[o + (layer - 4)] = v;
      }
    }
    this.surface[cz * MAP_CELLS + cx] = layer;
  }

  /** Upload the control textures after a batch of `stampSurface` calls. */
  commitSplat(): void {
    this.splatTexA.needsUpdate = true;
    this.splatTexB.needsUpdate = true;
  }

  /* ======================================================================
   * 6. GEOMETRY
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
   * Build the 8x8 chunk meshes.
   *
   * Two things here are load-bearing:
   *
   *  1. **Vertex normals use a CLAMPED gradient.** A 6 m terrace face beside a
   *     flat plateau would otherwise drag the plateau's normals down and put a
   *     soft shading ramp along every cliff top. Clamping the per-step delta to
   *     `TERRAIN_GROUND_NORMAL_CLAMP` keeps the plateau flat; the face gets its
   *     real normal back from screen-space derivatives inside the cliff shader.
   *  2. **Triangles are sorted into two index groups by face steepness.** That
   *     is what lets one vertex buffer feed two genuinely different materials
   *     with no duplicated vertices and no seam.
   */
  private buildMeshes(): void {
    this.disposeMeshes();

    const S = CHUNK_QUADS;
    const vn = (S + 1) * (S + 1);
    const clampD = TERRAIN_GROUND_NORMAL_CLAMP;

    for (let cz = 0; cz < CHUNK_N; cz++) {
      for (let cx = 0; cx < CHUNK_N; cx++) {
        const ox = cx * TERRAIN_CHUNK_METRES;
        const oz = cz * TERRAIN_CHUNK_METRES;
        const g0x = Math.round(ox * INV_GRID);
        const g0z = Math.round(oz * INV_GRID);

        const pos = new Float32Array(vn * 3);
        const nrm = new Float32Array(vn * 3);
        const up = new Float32Array(vn);
        const top = new Float32Array(vn);

        for (let vz = 0; vz <= S; vz++) {
          const gz = g0z + vz;
          const row = gz * GRID_STRIDE;
          const zm = (gz > 0 ? gz - 1 : 0) * GRID_STRIDE;
          const zp = (gz < GRID_N ? gz + 1 : GRID_N) * GRID_STRIDE;
          for (let vx = 0; vx <= S; vx++) {
            const gx = g0x + vx;
            const v = vz * (S + 1) + vx;
            const gi = row + gx;
            const xm = gx > 0 ? gx - 1 : 0;
            const xp = gx < GRID_N ? gx + 1 : GRID_N;

            pos[v * 3] = vx * GRID;
            pos[v * 3 + 1] = this.height[gi];
            pos[v * 3 + 2] = vz * GRID;

            const dx = clamp(this.height[row + xp] - this.height[row + xm], -clampD * 2, clampD * 2);
            const dz = clamp(this.height[zp + gx] - this.height[zm + gx], -clampD * 2, clampD * 2);
            const nx = -dx / (2 * GRID);
            const nz = -dz / (2 * GRID);
            const inv = 1 / Math.sqrt(nx * nx + nz * nz + 1);
            nrm[v * 3] = nx * inv;
            nrm[v * 3 + 1] = inv;
            nrm[v * 3 + 2] = nz * inv;

            up[v] = this.wallUp[gi];
            top[v] = this.wallTop[gi];
          }
        }

        // One index list; the shader picks its shading model per triangle. We
        // still COUNT the steep triangles, because a chunk with no relief has
        // nothing to cast and can skip the shadow pass entirely.
        const index = new Uint16Array(S * S * 6);
        let w = 0;
        let cliffTris = 0;
        for (let vz = 0; vz < S; vz++) {
          for (let vx = 0; vx < S; vx++) {
            const a = vz * (S + 1) + vx;
            const b = a + (S + 1);
            const c = a + 1;
            const d = b + 1;
            index[w] = a; index[w + 1] = b; index[w + 2] = c;
            index[w + 3] = c; index[w + 4] = b; index[w + 5] = d;
            w += 6;
            if (isCliffTri(pos, a, b, c)) cliffTris++;
            if (isCliffTri(pos, c, b, d)) cliffTris++;
          }
        }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
        geo.setAttribute('aUp', new THREE.BufferAttribute(up, 1));
        geo.setAttribute('aTop', new THREE.BufferAttribute(top, 1));
        geo.setIndex(new THREE.BufferAttribute(index, 1));
        geo.computeBoundingSphere();
        geo.computeBoundingBox();

        const mesh = new THREE.Mesh(geo, this.materials.material);
        mesh.name = `terrain.chunk.${cx}.${cz}`;
        mesh.position.set(ox, 0, oz);
        // Only chunks with REAL relief go into the shadow map. The shadow
        // cascade covers several times the camera's ground quad, so this is by
        // far the cheapest draw call in the module to delete: a chunk whose
        // steep triangles cover under ~4% of its area has nothing a 38-degree
        // sun could throw far enough to notice.
        mesh.castShadow = cliffTris >= (S * S * 2) * 0.04;
        mesh.receiveShadow = true;
        mesh.renderOrder = RENDER_ORDER.TERRAIN;
        mesh.layers.set(LAYERS.DEFAULT);
        mesh.layers.enable(LAYERS.TERRAIN);
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        this.root.add(mesh);
        this.chunks.push(mesh);
      }
    }
  }

  /* ======================================================================
   * 7. QUERY API — the surface eight other modules depend on
   * ====================================================================== */

  /** Bilinear ground height in metres. Clamped to the map at the edges. */
  heightAt(x: number, z: number): number {
    let gx = x * INV_GRID;
    let gz = z * INV_GRID;
    if (!(gx > 0)) gx = 0; else if (gx > GRID_N) gx = GRID_N;
    if (!(gz > 0)) gz = 0; else if (gz > GRID_N) gz = GRID_N;
    let x0 = gx | 0; if (x0 >= GRID_N) x0 = GRID_N - 1;
    let z0 = gz | 0; if (z0 >= GRID_N) z0 = GRID_N - 1;
    const fx = gx - x0;
    const fz = gz - z0;
    const h = this.height;
    const r0 = z0 * GRID_STRIDE + x0;
    const r1 = r0 + GRID_STRIDE;
    const top = h[r0] + (h[r0 + 1] - h[r0]) * fx;
    const bot = h[r1] + (h[r1 + 1] - h[r1]) * fx;
    return top + (bot - top) * fz;
  }

  /** Geometric ground normal, written into `out` as [nx, ny, nz]. */
  normalAt(x: number, z: number, out: Float32Array): Float32Array {
    const dx = (this.heightAt(x + GRID, z) - this.heightAt(x - GRID, z)) / (2 * GRID);
    const dz = (this.heightAt(x, z + GRID) - this.heightAt(x, z - GRID)) / (2 * GRID);
    const inv = 1 / Math.sqrt(dx * dx + dz * dz + 1);
    out[0] = -dx * inv;
    out[1] = inv;
    out[2] = -dz * inv;
    return out;
  }

  /** Slope in radians, bilinear. 0 is flat. */
  slopeAt(x: number, z: number): number {
    let gx = x * INV_GRID;
    let gz = z * INV_GRID;
    if (!(gx > 0)) gx = 0; else if (gx > GRID_N) gx = GRID_N;
    if (!(gz > 0)) gz = 0; else if (gz > GRID_N) gz = GRID_N;
    let x0 = gx | 0; if (x0 >= GRID_N) x0 = GRID_N - 1;
    let z0 = gz | 0; if (z0 >= GRID_N) z0 = GRID_N - 1;
    const fx = gx - x0;
    const fz = gz - z0;
    const s = this.slope;
    const r0 = z0 * GRID_STRIDE + x0;
    const r1 = r0 + GRID_STRIDE;
    const top = s[r0] + (s[r0 + 1] - s[r0]) * fx;
    const bot = s[r1] + (s[r1 + 1] - s[r1]) * fx;
    return top + (bot - top) * fz;
  }

  /** True if `loco` may enter the cell. Occupied cells are never passable. */
  isPassable(cx: number, cz: number, loco: Locomotor): boolean {
    if (!isInMap(cx, cz)) return false;
    const i = cz * MAP_CELLS + cx;
    if (this.occupant[i] !== 0) return false;
    return (this.passGrid[i] & (1 << loco)) !== 0;
  }

  /** Movement cost multiplier for a cell. `COST_BLOCKED` means impassable. */
  moveCostAt(cx: number, cz: number): number {
    if (!isInMap(cx, cz)) return COST_BLOCKED;
    return this.costGrid[cz * MAP_CELLS + cx];
  }

  /** True if a structure may be founded here: flat, dry, on-map and unoccupied. */
  isBuildable(cx: number, cz: number): boolean {
    if (!isInMap(cx, cz)) return false;
    const i = cz * MAP_CELLS + cx;
    return this.buildGrid[i] !== 0 && this.occupant[i] === 0;
  }

  isOccupied(cx: number, cz: number): boolean {
    return isInMap(cx, cz) && this.occupant[cz * MAP_CELLS + cx] !== 0;
  }

  markOccupied(cx: number, cz: number, w: number, h: number, id: EntityId): void {
    for (let z = cz; z < cz + h; z++) {
      for (let x = cx; x < cx + w; x++) {
        if (isInMap(x, z)) this.occupant[z * MAP_CELLS + x] = id as number;
      }
    }
    this.version++;
  }

  clearOccupied(cx: number, cz: number, w: number, h: number): void {
    for (let z = cz; z < cz + h; z++) {
      for (let x = cx; x < cx + w; x++) {
        if (isInMap(x, z)) this.occupant[z * MAP_CELLS + x] = 0;
      }
    }
    this.version++;
  }

  occupancyVersion(): number {
    return this.version;
  }

  isWater(cx: number, cz: number): boolean {
    return isInMap(cx, cz) && this.waterGrid[cz * MAP_CELLS + cx] !== 0;
  }

  /** True if the cell is steep enough to be a terrace face. */
  isCliff(cx: number, cz: number): boolean {
    return isInMap(cx, cz) && this.cellSlope[cz * MAP_CELLS + cx] >= CLIFF_SLOPE;
  }

  /** The dominant surface layer at a world position. */
  surfaceAt(x: number, z: number): SurfaceId {
    const cx = (x / CELL) | 0;
    const cz = (z / CELL) | 0;
    if (!isInMap(cx, cz)) return SurfaceId.Ground;
    return this.surface[cz * MAP_CELLS + cx] as SurfaceId;
  }

  /**
   * All six splat weights at a world position, written into `out` (length 6).
   * The dust and decal modules use this to tint an effect with the ground it
   * came off, which is the cheapest possible way to stop VFX reading as
   * sprites pasted on top of the scene (bible §14/R6).
   */
  surfaceWeightsAt(x: number, z: number, out: Float32Array): Float32Array {
    const tx = clamp((x / SPLAT_METRES) | 0, 0, SPLAT_N - 1);
    const tz = clamp((z / SPLAT_METRES) | 0, 0, SPLAT_N - 1);
    const o = (tz * SPLAT_N + tx) * 4;
    out[0] = this.splatA[o] / 255;
    out[1] = this.splatA[o + 1] / 255;
    out[2] = this.splatA[o + 2] / 255;
    out[3] = this.splatA[o + 3] / 255;
    out[4] = this.splatB[o] / 255;
    out[5] = this.splatB[o + 1] / 255;
    return out;
  }

  /**
   * Intersect a ray with the heightfield. Writes [x,y,z] into `out`.
   *
   * Sphere-traced rather than DDA-marched: the step is the vertical clearance
   * scaled down, so a cursor ray from 50 m up resolves in a dozen iterations
   * instead of 500, and it degrades gracefully to a fine march near the
   * surface where precision matters.
   */
  raycastGround(
    ox: number, oy: number, oz: number,
    dx: number, dy: number, dz: number,
    out: Float32Array,
  ): boolean {
    const dl = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dl < 1e-9) return false;
    const nx = dx / dl;
    const ny = dy / dl;
    const nz = dz / dl;

    // Clip to the map's XZ slab so a ray parallel to the ground terminates.
    let tMin = 0;
    let tMax = MAP_SIZE * 3;
    if (!slabClip(ox, nx, 0, MAP_SIZE)) return false;
    tMin = Math.max(tMin, SLAB[0]);
    tMax = Math.min(tMax, SLAB[1]);
    if (!slabClip(oz, nz, 0, MAP_SIZE)) return false;
    tMin = Math.max(tMin, SLAB[0]);
    tMax = Math.min(tMax, SLAB[1]);
    if (tMin > tMax) return false;

    let t = tMin;
    let px = ox + nx * t;
    let py = oy + ny * t;
    let pz = oz + nz * t;
    let prevT = t;
    let prevGap = py - this.heightAt(px, pz);

    if (prevGap <= 0) {
      out[0] = px; out[1] = py; out[2] = pz;
      return true;
    }

    for (let i = 0; i < 512 && t < tMax; i++) {
      const step = clamp(prevGap * 0.7, GRID * 0.5, 12);
      t = Math.min(t + step, tMax);
      px = ox + nx * t;
      py = oy + ny * t;
      pz = oz + nz * t;
      const gap = py - this.heightAt(px, pz);

      if (gap <= 0) {
        // Bisect the bracketing interval for a sub-centimetre hit point.
        let lo = prevT;
        let hi = t;
        for (let k = 0; k < 12; k++) {
          const mid = (lo + hi) * 0.5;
          const mx = ox + nx * mid;
          const my = oy + ny * mid;
          const mz = oz + nz * mid;
          if (my - this.heightAt(mx, mz) > 0) lo = mid; else hi = mid;
        }
        out[0] = ox + nx * hi;
        out[1] = oy + ny * hi;
        out[2] = oz + nz * hi;
        return true;
      }
      prevT = t;
      prevGap = gap;
      if (t >= tMax) break;
    }
    return false;
  }

  /** Alias of `raycastGround` — the name most callers reach for first. */
  raycast(
    ox: number, oy: number, oz: number,
    dx: number, dy: number, dz: number,
    out: Float32Array,
  ): boolean {
    return this.raycastGround(ox, oy, oz, dx, dy, dz, out);
  }

  /* ======================================================================
   * 8. LIFECYCLE
   * ====================================================================== */

  /**
   * Switch biome. Rebuilds the heightfield, the grids, the splat and the
   * chunk meshes; the material programs are untouched, so this costs one
   * generation pass and no shader compile.
   */
  setBiome(name: BiomeName | string): void {
    const next = getBiome(name);
    if (next.key === this.biomeDef.key) return;
    this.biomeDef = next;
    this.rampGrid.fill(0);
    this.materials.applyBiome(next);
    this.generate();
  }

  /** Re-roll the landform with a new seed, keeping the biome. */
  setSeed(seed: number): void {
    this.seed = seed | 0;
    this.rampGrid.fill(0);
    this.generate();
  }

  /** Triangle count across every chunk, for the perf budget readout. */
  triangleCount(): number {
    let n = 0;
    for (let i = 0; i < this.chunks.length; i++) {
      const idx = this.chunks[i].geometry.getIndex();
      if (idx) n += idx.count / 3;
    }
    return n;
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
 * 9. MODULE-PRIVATE HELPERS
 * ========================================================================== */

/** Ray/slab clip result, module scratch. `raycastGround` allocates nothing. */
const SLAB = new Float32Array(2);

/** Clip a ray against one axis slab. Writes [tNear, tFar] into SLAB. */
function slabClip(origin: number, dir: number, lo: number, hi: number): boolean {
  if (Math.abs(dir) < 1e-9) {
    if (origin < lo || origin > hi) return false;
    SLAB[0] = -1e9;
    SLAB[1] = 1e9;
    return true;
  }
  let t0 = (lo - origin) / dir;
  let t1 = (hi - origin) / dir;
  if (t0 > t1) { const tmp = t0; t0 = t1; t1 = tmp; }
  SLAB[0] = t0;
  SLAB[1] = t1;
  return t1 >= 0;
}

/**
 * True if a triangle is steeper than `CLIFF_SLOPE`. The same threshold the nav
 * grid and the shader use, so "a face a unit cannot climb" and "a face that
 * renders as rock" are the same set of triangles by construction.
 */
function isCliffTri(pos: Float32Array, a: number, b: number, c: number): boolean {
  const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
  const bx = pos[b * 3], by = pos[b * 3 + 1], bz = pos[b * 3 + 2];
  const cx = pos[c * 3], cy = pos[c * 3 + 1], cz = pos[c * 3 + 2];
  const ux = bx - ax, uy = by - ay, uz = bz - az;
  const vx = cx - ax, vy = cy - ay, vz = cz - az;
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
  return len > 1e-9 && Math.abs(ny) / len < CLIFF_NY;
}

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
 * 10. THE ACTIVE INSTANCE
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
