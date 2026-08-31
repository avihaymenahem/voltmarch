/**
 * Asset-authored environment families that are allowed to replace procedural
 * PropLibrary geometry. Placement remains owned by PROP_DEFS / Scatter.
 */

import type { PropFamily } from './PropLibrary';

export type EnvironmentAssetStage =
  | 'briefed'
  | 'concept'
  | 'meshy-raw'
  | 'production'
  | 'integrated'
  | 'validated';

export interface EnvironmentAssetBudget {
  readonly rawTriangles: number;
  readonly lod0Triangles: number;
  readonly lod1Triangles: number;
  readonly lod2Triangles: number;
  readonly shadowTriangles: number;
  readonly emergencyTriangles: number;
  readonly shippingBytes: number;
}

export interface EnvironmentAssetDeliveries {
  readonly lod0: string;
  readonly lod1: string;
  readonly lod2: string;
  readonly shadow: string;
  readonly emergency: string;
}

export interface EnvironmentArchetypeManifest {
  /** Stable PropDef / save identity. */
  readonly key: string;
  readonly family: PropFamily;
  readonly stage: EnvironmentAssetStage;
  readonly materialFamily: string;
  readonly origin: 'ground-centre';
  readonly metres: { readonly radius: number; readonly height: number };
  readonly wind: 'none' | 'grass' | 'canopy';
  /**
   * An authored family can remain packaged for iteration without being allowed
   * to replace the procedural presentation. Use this when live camera review
   * rejects a delivery that passed only isolated asset-card checks.
   */
  readonly runtimePresentation?: 'procedural';
  readonly budget: EnvironmentAssetBudget;
  /** Absent until every referenced file has passed the local production gate. */
  readonly deliveries?: EnvironmentAssetDeliveries;
}

const STATIC_PROP_SPECS: readonly [
  key: string, family: PropFamily, radius: number, height: number, triangles: number, file: string,
][] = [
  ['haystack', 'yard', 2.4, 4.03, 264, 'haystack-v1'],
  ['containerStack', 'yard', 3.4, 5.29, 2_376, 'container-stack-v1'],
  ['barrel', 'yard', 1.2, 1.07, 1_524, 'barrel-v1'],
  ['streetLamp', 'street', 0.5, 6.63, 308, 'street-lamp-v1'],
  ['streetLampTwin', 'street', 0.5, 8.10, 492, 'street-lamp-twin-v1'],
  ['bench', 'street', 1.2, 0.96, 396, 'bench-v1'],
  ['carSedan', 'street', 2.4, 1.52, 496, 'car-sedan-v1'],
  ['carVan', 'street', 2.8, 1.99, 496, 'car-van-v1'],
  ['carPickup', 'street', 2.6, 1.66, 584, 'car-pickup-v1'],
  ['trafficLight', 'street', 0.5, 5.58, 472, 'traffic-light-v1'],
  ['fence', 'street', 2.1, 1.36, 176, 'fence-v1'],
  ['railing', 'street', 2.1, 1.65, 1_012, 'railing-v1'],
  ['telegraphPole', 'street', 0.5, 9.50, 576, 'telegraph-pole-v1'],
  ['roadSign', 'street', 0.4, 3.10, 164, 'road-sign-v1'],
  ['roadSignDisc', 'street', 0.4, 2.52, 250, 'road-sign-disc-v1'],
  ['cafeUmbrella', 'civic', 1.8, 3.15, 844, 'cafe-umbrella-v1'],
  ['statue', 'civic', 2.6, 4.29, 616, 'statue-v1'],
  ['statueRider', 'civic', 2.6, 4.40, 836, 'statue-rider-v1'],
  ['waterTower', 'civic', 3.2, 13.10, 1_778, 'water-tower-v1'],
];

/** Tiny soft silhouettes where reduction costs more visually than it saves. */
const STATIC_PROP_LOD_FLOORS: Readonly<Record<string, number>> = Object.freeze({
  haystack: 264,
});

const STATIC_PROP_CATALOG = Object.freeze(Object.fromEntries(STATIC_PROP_SPECS.map(([
  key, family, radius, height, triangles, file,
]) => [key, Object.freeze({
  key,
  family,
  stage: 'integrated' as const,
  materialFamily: 'prop-surface-v1-pbr',
  origin: 'ground-centre' as const,
  metres: Object.freeze({ radius, height }),
  wind: 'none' as const,
  budget: Object.freeze({
    rawTriangles: triangles,
    lod0Triangles: triangles,
    lod1Triangles: STATIC_PROP_LOD_FLOORS[key] ?? Math.ceil(triangles * 0.86),
    lod2Triangles: STATIC_PROP_LOD_FLOORS[key] ?? Math.ceil(triangles * 0.55),
    shadowTriangles: 12,
    emergencyTriangles: STATIC_PROP_LOD_FLOORS[key] ?? Math.ceil(triangles * 0.55),
    shippingBytes: 1_048_576,
  }),
  deliveries: Object.freeze({
    lod0: `${file}.glb`,
    lod1: `derived/${file}.lod1.glb`,
    lod2: `derived/${file}.lod2.glb`,
    shadow: `derived/${file}.shadow.glb`,
    emergency: `derived/${file}.lod2.glb`,
  }),
})])) as Record<string, EnvironmentArchetypeManifest>);

/**
 * POC catalogue. Every delivery below passed the local triangle, bounds and
 * package-size gates. Runtime loading still fails closed to the procedural
 * tree if any file is unavailable.
 */
export const ENVIRONMENT_ASSET_CATALOG: Readonly<Record<string, EnvironmentArchetypeManifest>> =
  Object.freeze({
    tree: Object.freeze({
      key: 'tree',
      family: 'canopy',
      stage: 'integrated',
      materialFamily: 'temperate-foliage-pilot',
      origin: 'ground-centre',
      metres: Object.freeze({ radius: 4.5, height: 12 }),
      wind: 'canopy',
      budget: Object.freeze({
        rawTriangles: 12_000,
        lod0Triangles: 3_500,
        lod1Triangles: 900,
        // Live WebGPU review rejected the 384-triangle crossed-card silhouette.
        // LOD1 is deliberately retained through the far camera band until a
        // silhouette-preserving derivative passes gameplay review.
        lod2Triangles: 900,
        shadowTriangles: 900,
        emergencyTriangles: 400,
        shippingBytes: 1_572_864,
      }),
      deliveries: Object.freeze({
        lod0: 'temperate-broadleaf-v1.glb',
        lod1: 'derived/temperate-broadleaf-v1.lod1.glb',
        lod2: 'derived/temperate-broadleaf-v1.lod1.glb',
        shadow: 'derived/temperate-broadleaf-v1.shadow.glb',
        emergency: 'derived/temperate-broadleaf-v1.lod2.glb',
      }),
    }),
    treeAutumn: Object.freeze({
      key: 'treeAutumn',
      family: 'canopy',
      stage: 'production',
      materialFamily: 'extended-foliage-v1-pbr',
      origin: 'ground-centre',
      metres: Object.freeze({ radius: 4.8, height: 10.6 }),
      wind: 'canopy',
      runtimePresentation: 'procedural',
      budget: Object.freeze({ rawTriangles: 54, lod0Triangles: 64, lod1Triangles: 56, lod2Triangles: 48, shadowTriangles: 48, emergencyTriangles: 48, shippingBytes: 786_432 }),
      deliveries: Object.freeze({
        lod0: 'tree-autumn-v1.glb', lod1: 'derived/tree-autumn-v1.lod1.glb',
        lod2: 'derived/tree-autumn-v1.lod2.glb', shadow: 'derived/tree-autumn-v1.shadow.glb',
        emergency: 'derived/tree-autumn-v1.lod2.glb',
      }),
    }),
    conifer: Object.freeze({
      key: 'conifer',
      family: 'canopy',
      stage: 'production',
      materialFamily: 'extended-foliage-v1-pbr',
      origin: 'ground-centre',
      metres: Object.freeze({ radius: 3.9, height: 11.4 }),
      wind: 'canopy',
      runtimePresentation: 'procedural',
      budget: Object.freeze({ rawTriangles: 82, lod0Triangles: 90, lod1Triangles: 70, lod2Triangles: 60, shadowTriangles: 48, emergencyTriangles: 60, shippingBytes: 131_072 }),
      deliveries: Object.freeze({
        lod0: 'conifer-v1.glb', lod1: 'derived/conifer-v1.lod1.glb',
        lod2: 'derived/conifer-v1.lod2.glb', shadow: 'derived/conifer-v1.shadow.glb',
        emergency: 'derived/conifer-v1.lod2.glb',
      }),
    }),
    palm: Object.freeze({
      key: 'palm',
      family: 'canopy',
      stage: 'production',
      materialFamily: 'extended-foliage-v1-pbr',
      origin: 'ground-centre',
      metres: Object.freeze({ radius: 4.7, height: 8.4 }),
      wind: 'canopy',
      runtimePresentation: 'procedural',
      budget: Object.freeze({ rawTriangles: 170, lod0Triangles: 180, lod1Triangles: 176, lod2Triangles: 172, shadowTriangles: 44, emergencyTriangles: 172, shippingBytes: 196_608 }),
      deliveries: Object.freeze({
        lod0: 'palm-v1.glb', lod1: 'derived/palm-v1.lod1.glb',
        lod2: 'derived/palm-v1.lod2.glb', shadow: 'derived/palm-v1.shadow.glb',
        emergency: 'derived/palm-v1.lod2.glb',
      }),
    }),
    grassTuft: Object.freeze({
      key: 'grassTuft',
      family: 'grass',
      stage: 'integrated',
      materialFamily: 'extended-foliage-v1-pbr',
      origin: 'ground-centre',
      metres: Object.freeze({ radius: 1.3, height: 2.15 }),
      wind: 'grass',
      budget: Object.freeze({ rawTriangles: 8, lod0Triangles: 10, lod1Triangles: 8, lod2Triangles: 6, shadowTriangles: 28, emergencyTriangles: 6, shippingBytes: 65_536 }),
      deliveries: Object.freeze({
        lod0: 'grass-tuft-v1.glb', lod1: 'derived/grass-tuft-v1.lod1.glb',
        lod2: 'derived/grass-tuft-v1.lod2.glb', shadow: 'derived/grass-tuft-v1.shadow.glb',
        emergency: 'derived/grass-tuft-v1.lod2.glb',
      }),
    }),
    grassTuftGreen: Object.freeze({
      key: 'grassTuftGreen',
      family: 'grass',
      stage: 'integrated',
      materialFamily: 'extended-foliage-v1-pbr',
      origin: 'ground-centre',
      metres: Object.freeze({ radius: 1.3, height: 2.15 }),
      wind: 'grass',
      budget: Object.freeze({ rawTriangles: 8, lod0Triangles: 10, lod1Triangles: 8, lod2Triangles: 6, shadowTriangles: 28, emergencyTriangles: 6, shippingBytes: 65_536 }),
      deliveries: Object.freeze({
        lod0: 'grass-tuft-green-v1.glb', lod1: 'derived/grass-tuft-green-v1.lod1.glb',
        lod2: 'derived/grass-tuft-green-v1.lod2.glb', shadow: 'derived/grass-tuft-green-v1.shadow.glb',
        emergency: 'derived/grass-tuft-green-v1.lod2.glb',
      }),
    }),
    bush: Object.freeze({
      key: 'bush',
      family: 'shrub',
      stage: 'integrated',
      materialFamily: 'temperate-shrub-v1-pbr',
      origin: 'ground-centre',
      metres: Object.freeze({ radius: 1.1, height: 1.8 }),
      wind: 'canopy',
      budget: Object.freeze({
        rawTriangles: 28,
        lod0Triangles: 32,
        lod1Triangles: 20,
        lod2Triangles: 8,
        shadowTriangles: 52,
        emergencyTriangles: 8,
        // Includes the single shared 1024/512/512 alpha-tested shrub set.
        shippingBytes: 786_432,
      }),
      deliveries: Object.freeze({
        lod0: 'bush-v1.glb',
        lod1: 'derived/bush-v1.lod1.glb',
        lod2: 'derived/bush-v1.lod2.glb',
        shadow: 'derived/bush-v1.shadow.glb',
        emergency: 'derived/bush-v1.lod2.glb',
      }),
    }),
    hedge: Object.freeze({
      key: 'hedge',
      family: 'shrub',
      stage: 'integrated',
      materialFamily: 'temperate-shrub-v1-pbr',
      origin: 'ground-centre',
      metres: Object.freeze({ radius: 1.9, height: 1.3 }),
      wind: 'canopy',
      budget: Object.freeze({
        rawTriangles: 12,
        lod0Triangles: 14,
        lod1Triangles: 12,
        lod2Triangles: 12,
        shadowTriangles: 14,
        emergencyTriangles: 12,
        shippingBytes: 65_536,
      }),
      deliveries: Object.freeze({
        lod0: 'hedge-v1.glb',
        lod1: 'derived/hedge-v1.lod1.glb',
        lod2: 'derived/hedge-v1.lod2.glb',
        shadow: 'derived/hedge-v1.shadow.glb',
        emergency: 'derived/hedge-v1.lod2.glb',
      }),
    }),
    boulder: Object.freeze({
      key: 'boulder',
      family: 'rock',
      stage: 'integrated',
      materialFamily: 'mineral-rock-v1-pbr',
      origin: 'ground-centre',
      metres: Object.freeze({ radius: 2.0, height: 2.8 }),
      wind: 'none',
      budget: Object.freeze({
        rawTriangles: 576,
        lod0Triangles: 600,
        lod1Triangles: 240,
        lod2Triangles: 120,
        shadowTriangles: 160,
        emergencyTriangles: 120,
        // Includes the single shared 1024/512/512 mineral texture set.
        shippingBytes: 1_048_576,
      }),
      deliveries: Object.freeze({
        lod0: 'boulder-v1.glb',
        lod1: 'derived/boulder-v1.lod1.glb',
        lod2: 'derived/boulder-v1.lod2.glb',
        shadow: 'derived/boulder-v1.shadow.glb',
        emergency: 'derived/boulder-v1.lod2.glb',
      }),
    }),
    rockCluster: Object.freeze({
      key: 'rockCluster',
      family: 'rock',
      stage: 'integrated',
      materialFamily: 'mineral-rock-v1-pbr',
      origin: 'ground-centre',
      metres: Object.freeze({ radius: 1.7, height: 1.22 }),
      wind: 'none',
      budget: Object.freeze({
        rawTriangles: 450,
        lod0Triangles: 480,
        lod1Triangles: 260,
        lod2Triangles: 140,
        shadowTriangles: 170,
        emergencyTriangles: 140,
        shippingBytes: 196_608,
      }),
      deliveries: Object.freeze({
        lod0: 'rock-cluster-v1.glb',
        lod1: 'derived/rock-cluster-v1.lod1.glb',
        lod2: 'derived/rock-cluster-v1.lod2.glb',
        shadow: 'derived/rock-cluster-v1.shadow.glb',
        emergency: 'derived/rock-cluster-v1.lod2.glb',
      }),
    }),
    debrisPile: Object.freeze({
      key: 'debrisPile',
      family: 'yard',
      stage: 'integrated',
      materialFamily: 'mineral-rock-v1-pbr',
      origin: 'ground-centre',
      metres: Object.freeze({ radius: 1.7, height: 1.22 }),
      wind: 'none',
      budget: Object.freeze({
        rawTriangles: 450,
        lod0Triangles: 480,
        lod1Triangles: 260,
        lod2Triangles: 140,
        shadowTriangles: 170,
        emergencyTriangles: 140,
        // Reuses the existing rock-cluster deliveries and resident mineral maps.
        shippingBytes: 196_608,
      }),
      deliveries: Object.freeze({
        lod0: 'rock-cluster-v1.glb',
        lod1: 'derived/rock-cluster-v1.lod1.glb',
        lod2: 'derived/rock-cluster-v1.lod2.glb',
        shadow: 'derived/rock-cluster-v1.shadow.glb',
        emergency: 'derived/rock-cluster-v1.lod2.glb',
      }),
    }),
    crateStack: Object.freeze({
      key: 'crateStack',
      family: 'yard',
      stage: 'integrated',
      materialFamily: 'box-prop-v1-pbr',
      origin: 'ground-centre',
      metres: Object.freeze({ radius: 2.2, height: 2.3 }),
      wind: 'none',
      budget: Object.freeze({
        rawTriangles: 60,
        lod0Triangles: 64,
        lod1Triangles: 64,
        lod2Triangles: 64,
        shadowTriangles: 28,
        emergencyTriangles: 64,
        // Includes the single shared 1024/512/512 crate/flower atlas.
        shippingBytes: 524_288,
      }),
      deliveries: Object.freeze({
        lod0: 'crate-stack-v1.glb',
        lod1: 'derived/crate-stack-v1.lod1.glb',
        lod2: 'derived/crate-stack-v1.lod2.glb',
        shadow: 'derived/crate-stack-v1.shadow.glb',
        emergency: 'derived/crate-stack-v1.lod2.glb',
      }),
    }),
    flowerBed: Object.freeze({
      key: 'flowerBed',
      family: 'civic',
      stage: 'integrated',
      materialFamily: 'box-prop-v1-pbr',
      origin: 'ground-centre',
      metres: Object.freeze({ radius: 2.4, height: 0.8 }),
      wind: 'none',
      budget: Object.freeze({
        rawTriangles: 16,
        lod0Triangles: 18,
        lod1Triangles: 18,
        lod2Triangles: 16,
        shadowTriangles: 14,
        emergencyTriangles: 16,
        shippingBytes: 65_536,
      }),
      deliveries: Object.freeze({
        lod0: 'flower-bed-v1.glb',
        lod1: 'derived/flower-bed-v1.lod1.glb',
        lod2: 'derived/flower-bed-v1.lod2.glb',
        shadow: 'derived/flower-bed-v1.shadow.glb',
        emergency: 'derived/flower-bed-v1.lod2.glb',
      }),
    }),
    ...STATIC_PROP_CATALOG,
  });

export const ENVIRONMENT_ASSET_KEYS: readonly string[] = Object.freeze(
  Object.keys(ENVIRONMENT_ASSET_CATALOG),
);

export function environmentAssetManifest(
  key: string,
): EnvironmentArchetypeManifest | undefined {
  return ENVIRONMENT_ASSET_CATALOG[key];
}
