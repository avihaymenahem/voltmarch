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
}

export interface EnvironmentGeometryResolution {
  readonly requested: FoliagePresentation;
  readonly source: EnvironmentGeometrySource;
  readonly geometry: PropGeometry;
  readonly reason: 'requested' | 'unregistered-key' | 'missing-imported' | 'missing-emergency';
}

export interface FoliageEngineOptions {
  readonly fallback: PropLibrary;
  readonly presentation?: FoliagePresentation;
  readonly importedFamilies?: ReadonlyMap<string, EnvironmentGeometryFamily>;
}

export function resolveFoliagePresentation(value: string | null | undefined): FoliagePresentation {
  if (value === 'imported' || value === 'emergency' || value === 'procedural') return value;
  return 'procedural';
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

  constructor(options: FoliageEngineOptions) {
    this.fallback = options.fallback;
    this.presentation = options.presentation ?? 'procedural';
    for (const [key, family] of options.importedFamilies ?? []) this.register(key, family);
  }

  /** Register only a complete pilot family; partial LOD delivery is rejected upstream. */
  register(key: string, family: EnvironmentGeometryFamily): void {
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
    assertGeometry(key, family.lod0, manifest.budget.lod0Triangles, 'lod0');
    assertGeometry(key, family.lod1, manifest.budget.lod1Triangles, 'lod1');
    assertGeometry(key, family.lod2, manifest.budget.lod2Triangles, 'lod2');
    assertGeometry(key, family.shadow, manifest.budget.shadowTriangles, 'shadow');
    assertGeometry(key, family.emergency, manifest.budget.emergencyTriangles, 'emergency');
    this.families.set(key, family);
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

  get(key: string): PropGeometry | undefined { return this.resolution(key)?.geometry; }

  get totalTriangles(): number {
    let triangles = 0;
    for (const def of PROP_DEFS) triangles += this.get(def.key)?.triangles ?? 0;
    return triangles;
  }

  get buildMs(): number { return this.fallback.buildMs; }

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
  }
}
