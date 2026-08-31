/**
 * Asset-presentation boundary for foliage and neutral environment props.
 *
 * Scatter remains the placement/simulation authority. This engine resolves a
 * stable key to procedural, imported, or packaged-emergency geometry without
 * allowing asset availability to affect placement order or save identity.
 */

import { environmentAssetManifest } from './EnvironmentAssetCatalog';
import { PROP_DEFS, propDef, type PropGeometry, type PropLibrary } from './PropLibrary';

export type FoliagePresentation = 'procedural' | 'imported' | 'emergency';
export type EnvironmentGeometrySource = FoliagePresentation;

export interface EnvironmentGeometryFamily {
  readonly lod0: PropGeometry;
  readonly lod1: PropGeometry;
  readonly lod2: PropGeometry;
  readonly shadow: PropGeometry;
  readonly emergency: PropGeometry;
  /**
   * Delivery actually backing each slot when a packaged file failed to load.
   * Omitted means the family is complete and every slot owns its named file.
   */
  readonly deliverySources?: Readonly<{
    lod0: 'lod0' | 'lod1' | 'lod2';
    lod1: 'lod0' | 'lod1' | 'lod2';
    lod2: 'lod0' | 'lod1' | 'lod2';
    shadow: 'lod0' | 'lod1' | 'lod2' | 'shadow';
    emergency: 'lod0' | 'lod1' | 'lod2';
  }>;
}

export interface EnvironmentGeometryResolution {
  readonly requested: FoliagePresentation;
  readonly source: EnvironmentGeometrySource;
  readonly geometry: PropGeometry;
  readonly reason: 'requested' | 'unregistered-key' | 'missing-imported' | 'missing-emergency';
}

export interface EnvironmentRenderFamily {
  readonly lod0: PropGeometry;
  readonly lod1: PropGeometry;
  readonly lod2: PropGeometry;
  readonly shadow: PropGeometry;
}

export interface FoliageEngineOptions {
  readonly fallback: PropLibrary;
  readonly presentation?: FoliagePresentation;
  readonly importedFamilies?: ReadonlyMap<string, EnvironmentGeometryFamily>;
}

export function resolveFoliagePresentation(value: string | null | undefined): FoliagePresentation {
  if (value === 'imported' || value === 'emergency' || value === 'procedural') return value;
  // Authored PBR families are the shipped presentation. The procedural kit is
  // retained as an explicit diagnostic/failure fallback, not as the ordinary
  // no-flag path; otherwise every desktop and web launch silently bypasses the
  // asset pipeline that replaced it.
  return 'imported';
}

function assertGeometry(
  key: string,
  geometry: PropGeometry,
  maxTriangles: number,
  delivery: 'lod0' | 'lod1' | 'lod2' | 'shadow' | 'emergency',
): void {
  if (geometry.def.key !== key) {
    throw new Error(`[foliage] ${delivery} key mismatch: expected ${key}, got ${geometry.def.key}`);
  }
  if (geometry.triangles <= 0 || geometry.triangles > maxTriangles) {
    throw new Error(
      `[foliage] ${key}.${delivery} has ${geometry.triangles} triangles; budget is ${maxTriangles}`,
    );
  }
  if (geometry.geometry.getIndex() === null) {
    throw new Error(`[foliage] ${key}.${delivery} must use indexed geometry`);
  }
  const position = geometry.geometry.getAttribute('position');
  if (position === undefined) {
    throw new Error(`[foliage] ${key}.${delivery} has no position attribute`);
  }
  const index = geometry.geometry.getIndex();
  if (index === null || index.count / 3 !== geometry.triangles) {
    throw new Error(`[foliage] ${key}.${delivery} triangle audit does not match its index`);
  }
  for (const attribute of ['normal', 'color', 'aSway', 'aSurface']) {
    const value = geometry.geometry.getAttribute(attribute);
    if (value === undefined || value.count !== position.count) {
      throw new Error(`[foliage] ${key}.${delivery} has an invalid ${attribute} attribute`);
    }
  }
  if (!(geometry.boundRadius > 0) || !(geometry.boundHeight > 0)
    || !(geometry.boundSphereRadius > 0)) {
    throw new Error(`[foliage] ${key}.${delivery} has invalid runtime bounds`);
  }
}

export class FoliageEngine {
  readonly presentation: FoliagePresentation;
  private readonly fallback: PropLibrary;
  private readonly families = new Map<string, EnvironmentGeometryFamily>();
  private readonly timedMaterials: { material: unknown; setTime: (time: number) => void }[] = [];

  constructor(options: FoliageEngineOptions) {
    this.fallback = options.fallback;
    this.presentation = options.presentation ?? 'procedural';
    for (const [key, family] of options.importedFamilies ?? []) this.register(key, family);
  }

  private validate(key: string, family: EnvironmentGeometryFamily): void {
    const manifest = environmentAssetManifest(key);
    if (manifest === undefined) throw new Error(`[foliage] no asset manifest for ${key}`);
    const identity = propDef(key);
    if (identity === undefined
      || identity !== family.lod0.def
      || identity !== family.lod1.def
      || identity !== family.lod2.def
      || identity !== family.shadow.def
      || identity !== family.emergency.def) {
      throw new Error(`[foliage] ${key} must retain the exact PropDef placement identity`);
    }
    const budget = {
      lod0: manifest.budget.lod0Triangles,
      lod1: manifest.budget.lod1Triangles,
      lod2: manifest.budget.lod2Triangles,
      shadow: manifest.budget.shadowTriangles,
    } as const;
    const source = family.deliverySources;
    assertGeometry(key, family.lod0, budget[source?.lod0 ?? 'lod0'], 'lod0');
    assertGeometry(key, family.lod1, budget[source?.lod1 ?? 'lod1'], 'lod1');
    assertGeometry(key, family.lod2, budget[source?.lod2 ?? 'lod2'], 'lod2');
    assertGeometry(key, family.shadow, budget[source?.shadow ?? 'shadow'], 'shadow');
    assertGeometry(
      key,
      family.emergency,
      source === undefined ? manifest.budget.emergencyTriangles : budget[source.emergency],
      'emergency',
    );
  }

  private install(key: string, family: EnvironmentGeometryFamily): void {
    this.families.set(key, family);
    for (const delivery of [family.lod0, family.lod1, family.lod2]) {
      const material = delivery.material;
      if (material === undefined
        || this.timedMaterials.some((entry) => entry.material === material)) continue;
      const setTime = material.userData.vmFoliageSetTime;
      if (typeof setTime === 'function') {
        this.timedMaterials.push({ material, setTime: setTime as (time: number) => void });
      }
    }
  }

  /** Register one already-conditioned family without changing placement identity. */
  register(key: string, family: EnvironmentGeometryFamily): void {
    this.validate(key, family);
    this.install(key, family);
  }

  /** Validate the whole handoff before the engine adopts any of its resources. */
  registerFamilies(families: ReadonlyMap<string, EnvironmentGeometryFamily>): number {
    for (const [key, family] of families) this.validate(key, family);
    for (const [key, family] of families) this.install(key, family);
    return families.size;
  }

  resolution(key: string): EnvironmentGeometryResolution | undefined {
    const fallback = this.fallback.get(key);
    if (this.presentation === 'procedural') {
      if (fallback === undefined) return undefined;
      return { requested: this.presentation, source: 'procedural', geometry: fallback, reason: 'requested' };
    }

    const manifest = environmentAssetManifest(key);
    if (manifest === undefined) {
      if (fallback === undefined) return undefined;
      return {
        requested: this.presentation,
        source: 'procedural',
        geometry: fallback,
        reason: 'unregistered-key',
      };
    }
    const family = this.families.get(key);
    if (family === undefined) {
      if (fallback === undefined) return undefined;
      return {
        requested: this.presentation,
        source: 'procedural',
        geometry: fallback,
        reason: this.presentation === 'imported' ? 'missing-imported' : 'missing-emergency',
      };
    }
    if (this.presentation === 'emergency') {
      return {
        requested: this.presentation,
        source: 'emergency',
        geometry: family.emergency,
        reason: 'requested',
      };
    }
    return {
      requested: this.presentation,
      source: 'imported',
      geometry: family.lod0,
      reason: 'requested',
    };
  }

  /** Resolve the colour LODs and independent caster without changing identity. */
  renderFamily(key: string): EnvironmentRenderFamily | undefined {
    const resolution = this.resolution(key);
    if (resolution === undefined) return undefined;
    const imported = this.families.get(key);
    if (resolution.source === 'imported' && imported !== undefined) return imported;
    if (resolution.source === 'emergency' && imported !== undefined) {
      return {
        lod0: imported.emergency,
        lod1: imported.emergency,
        lod2: imported.emergency,
        shadow: imported.shadow,
      };
    }
    return {
      lod0: resolution.geometry,
      lod1: resolution.geometry,
      lod2: resolution.geometry,
      shadow: resolution.geometry,
    };
  }

  get(key: string): PropGeometry | undefined { return this.resolution(key)?.geometry; }

  get totalTriangles(): number {
    let triangles = 0;
    for (const def of PROP_DEFS) triangles += this.get(def.key)?.triangles ?? 0;
    return triangles;
  }

  get buildMs(): number { return this.fallback.buildMs; }

  /** Advance each authored wind material once, independent of active buckets. */
  setTime(timeSeconds: number): void {
    for (let i = 0; i < this.timedMaterials.length; i++) {
      this.timedMaterials[i].setTime(timeSeconds);
    }
  }

  dispose(): void {
    const fallbackGeometries = new Set(this.fallback.all().map((entry) => entry.geometry));
    const disposed = new Set();
    const disposedMaterials = new Set<unknown>();
    for (const family of this.families.values()) {
      for (const delivery of [
        family.lod0,
        family.lod1,
        family.lod2,
        family.shadow,
        family.emergency,
      ]) {
        if (!fallbackGeometries.has(delivery.geometry) && !disposed.has(delivery.geometry)) {
          delivery.geometry.dispose();
          disposed.add(delivery.geometry);
        }
        if (delivery.material !== undefined && !disposedMaterials.has(delivery.material)) {
          const depthMaterial = delivery.material.userData.vmFoliageDepthMaterial;
          if (depthMaterial !== undefined && typeof depthMaterial.dispose === 'function') {
            depthMaterial.dispose();
          }
          if ('map' in delivery.material) {
            const textured = delivery.material as {
              map?: { dispose(): void } | null;
              normalMap?: { dispose(): void } | null;
              metalnessMap?: { dispose(): void } | null;
              roughnessMap?: { dispose(): void } | null;
            };
            const textures = new Set([
              textured.map, textured.normalMap, textured.metalnessMap, textured.roughnessMap,
            ]);
            for (const texture of textures) texture?.dispose();
          }
          delivery.material.dispose();
          disposedMaterials.add(delivery.material);
        }
      }
    }
    this.families.clear();
    this.timedMaterials.length = 0;
  }
}
