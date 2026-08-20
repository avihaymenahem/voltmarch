/**
 * ============================================================================
 * VOLTMARCH — src/art/Greeble.ts
 * ============================================================================
 * THE RENDERER-FACING HALF OF THE GREEBLE FACTORY.
 *
 * All of the painting, packing and measurement now lives in `./greeble-gen.ts`,
 * which imports no THREE at all and is re-exported wholesale below — so every
 * existing `from './Greeble'` import keeps working exactly as it did. What is
 * left here is the part that genuinely needs a renderer: wrapping four byte
 * arrays in `THREE.DataTexture`, and the cache that hands them out.
 *
 * WHY THE FILE WAS SPLIT
 * ----------------------
 * Generating the four 512² atlases costs ~960 ms of unbroken main-thread time
 * at boot (measured from the boot log: allies.structure 421 ms, allies.pad
 * 166 ms, soviets.structure 310 ms, soviets.pad 61 ms), and the unit atlases
 * another ~440 ms on top. The loading curtain cannot animate through any of it.
 *
 * That work is pure typed-array maths, so it can run on a worker — but only if
 * the module holding it does not import THREE, because Vite emits the worker's
 * whole import graph as its own chunk. This is the same split, for the same
 * reason, as `core/surfaces.ts` out of `core/assets.ts`, and
 * `tests/texture-workers.spec.ts` walks the graph and fails on a stray import.
 *
 * `atlas()` IS STILL SYNCHRONOUS, AND THAT IS THE WHOLE DESIGN
 * -----------------------------------------------------------
 * It would have been easy to make it async and much worse. `BuildingFactory`
 * reads `atlas.structure` AND `atlas.surface` while validating a model it is
 * building right now (the R1 gate, `validateStructure`), and `UnitFactory`
 * gates on `atlas.metrics.paintDetailCoverage` the same way. Deferring the data
 * would mean unpicking every one of those checks, and a validation that runs
 * "later, probably" is not a validation.
 *
 * So the worker path is a PREWARM instead: `prewarm()` generates atlases off
 * the main thread and installs them in this cache, and `atlas()` then hits the
 * cache. A spec nobody prewarmed, or a machine with no workers, generates on
 * the main thread exactly as before — the fallback is the original code path,
 * not a degraded one. `core/workers/texture-warm.system.ts` already establishes
 * this shape for `TextureFactory`.
 * ============================================================================
 */

import * as THREE from 'three';

import {
  SLOT_NAMES, generateGreebleAtlas, greebleSpecHash, slotBevelUv, slotUv,
  type GreebleAtlasData, type GreebleMetrics, type GreebleSpec, type SlotName,
  type UvRect,
} from './greeble-gen';
import type { Surface } from '../core/surfaces';

export * from './greeble-gen';

/** The generated set for one faction-class. */
export interface GreebleAtlas {
  key: string;
  size: number;
  spec: Readonly<GreebleSpec>;
  /** sRGB albedo, team mask in alpha. */
  map: THREE.DataTexture;
  /** Tangent-space XY + cavity in B + curvature in A. STRUCTURAL: a flat plate
   *  comes out exactly (0, 0, 1) with no ripple to catch a specular. */
  normalMap: THREE.DataTexture;
  /** AO / roughness / metalness + architecture clearcoat factor in alpha. */
  ormMap: THREE.DataTexture;
  /** Pre-multiplied emissive colour. */
  emissiveMap: THREE.DataTexture;
  /** Retained for build-time measurement; not uploaded. */
  surface: Surface;
  /** Accumulated drawn-structure mask, for `detailCoverage`. Not uploaded. */
  structure: Float32Array;
  /** Sampled UV rect per slot. */
  uv: Record<SlotName, UvRect>;
  /** Flat patch per slot, sampled by chamfer strips. */
  bevelUv: Record<SlotName, UvRect>;
  metrics: GreebleMetrics;
}

function makeTexture(
  data: Uint8Array, size: number, srgb: boolean, name: string, aniso: number,
): THREE.DataTexture {
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.name = name;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  // CLAMP, not repeat: this is an atlas. A repeating wrap would let a mip pull
  // the opposite edge of the sheet into a bevel strip.
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = aniso;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Generate an atlas off the main thread. Installed by
 * `core/workers/greeble-warm.system.ts`; null before it runs, and null forever
 * on a platform with no workers.
 */
export type GreebleGenerator = (spec: GreebleSpec) => Promise<GreebleAtlasData | null>;

let offThread: GreebleGenerator | null = null;

/**
 * Point `prewarm` at a worker-backed generator, or pass null to stand it down.
 *
 * Module-level for the same reason `setHarvesterDrive` is: the worker layer can
 * reach the art layer with one call and no import cycle, and `src/art/**` never
 * learns that a worker exists.
 */
export function setGreebleGenerator(fn: GreebleGenerator | null): void {
  offThread = fn;
}

/**
 * THE ONLY WAY TO GET A GREEBLE ATLAS. Cached on the full spec hash, so the
 * same texture is never generated twice however many units ask for it.
 */
export class GreebleFactory {
  private readonly cache = new Map<string, GreebleAtlas>();
  /** Max anisotropic samples; clamped by the renderer at upload. */
  anisotropy = 8;
  generated = 0;
  hits = 0;
  /** Atlases that came back from a worker rather than being built here. */
  offThreadCount = 0;

  atlas(spec: GreebleSpec): GreebleAtlas {
    const key = greebleSpecHash(spec);
    const hit = this.cache.get(key);
    if (hit !== undefined) { this.hits++; return hit; }
    const t0 = Date.now();
    const built = this.install(generateGreebleAtlas(spec, 0), Date.now() - t0);
    this.generated++;
    return built;
  }

  /**
   * Build these specs off the main thread, if a generator is installed, and put
   * the results in the cache so `atlas()` becomes a hit.
   *
   * Never rejects and never throws. A worker that dies, a platform that has
   * none, or a spec that fails mid-generation all leave the cache untouched,
   * and `atlas()` then does exactly what it always did. That is the property
   * worth protecting: this is an optimisation, and an optimisation must not be
   * able to stop the game from starting.
   */
  async prewarm(specs: readonly GreebleSpec[]): Promise<number> {
    const gen = offThread;
    if (gen === null) return 0;
    let done = 0;
    // Sequential submission, but the pool round-robins across its workers, so
    // the awaits overlap. `Promise.all` over the whole set is what actually
    // parallelises it.
    const results = await Promise.all(specs.map(async (spec) => {
      const key = greebleSpecHash(spec);
      if (this.cache.has(key)) return null;
      try {
        return await gen(spec);
      } catch {
        return null;
      }
    }));
    for (const data of results) {
      if (data === null) continue;
      if (this.cache.has(data.key)) continue;
      this.install(data, data.metrics.generateMs);
      this.offThreadCount++;
      done++;
    }
    return done;
  }

  /** Wrap generated buffers in textures and cache them. */
  private install(data: GreebleAtlasData, elapsedMs: number): GreebleAtlas {
    const size = data.size;
    const aniso = this.anisotropy;
    const uv = {} as Record<SlotName, UvRect>;
    const bevelUv = {} as Record<SlotName, UvRect>;
    for (const slot of SLOT_NAMES) {
      uv[slot] = slotUv(slot, size);
      bevelUv[slot] = slotBevelUv(slot, size);
    }
    const built: GreebleAtlas = {
      key: data.key,
      size,
      spec: data.spec,
      map: makeTexture(data.albedo, size, true, `${data.spec.key}.albedo`, aniso),
      normalMap: makeTexture(data.normal, size, false, `${data.spec.key}.normal`, aniso),
      ormMap: makeTexture(data.orm, size, false, `${data.spec.key}.orm`, aniso),
      emissiveMap: makeTexture(data.emissive, size, true, `${data.spec.key}.emissive`, 1),
      surface: data.surface,
      structure: data.structure,
      uv,
      bevelUv,
      metrics: { ...data.metrics, generateMs: elapsedMs },
    };
    this.cache.set(data.key, built);
    return built;
  }

  /** Everything built so far, for the boot report. */
  all(): GreebleAtlas[] { return Array.from(this.cache.values()); }

  dispose(): void {
    for (const a of this.cache.values()) {
      a.map.dispose(); a.normalMap.dispose(); a.ormMap.dispose(); a.emissiveMap.dispose();
    }
    this.cache.clear();
  }

  stats(): {
    atlases: number; generated: number; hits: number; megabytes: number; offThread: number;
  } {
    let bytes = 0;
    for (const a of this.cache.values()) bytes += a.size * a.size * 4 * 4 * (4 / 3);
    return {
      atlases: this.cache.size,
      generated: this.generated,
      hits: this.hits,
      megabytes: bytes / (1024 * 1024),
      offThread: this.offThreadCount,
    };
  }
}

/** The shared factory. One per process; tests may construct their own. */
export const greebles = new GreebleFactory();
