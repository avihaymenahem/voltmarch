/**
 * Road topology conflicts that become overlapping asphalt ribbons.
 *
 * The visual failure is not a shader artefact: two independent chains occupy
 * one corridor for a sustained distance, so their surfaces and lane markings
 * fight. This census exercises every biome and both route directions. The
 * production detector uses absolute tangent alignment, therefore reverse-flow
 * duplicates, curved near-parallels and shallow merges are all covered while
 * perpendicular crossings remain legal. Shared-endpoint chains get only a
 * compact junction throat; a parallel approach beyond it is one physical road
 * and must have one rendered owner.
 */

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { Terrain } from '../src/world/Terrain';
import { RoadClass, RoadNetwork, ROAD_MASK_N } from '../src/world/Roads';
import { SurfaceId } from '../src/world/Biomes';
import { CELL, ROAD_MASK_METRES } from '../src/core/config';

interface ChainView {
  id: number;
  sourceId: number;
  cls: number;
  nodeA: number;
  nodeB: number;
  way: number[];
  spline: number[];
}

interface NodeView {
  x: number;
  z: number;
}

interface NetworkView {
  chains: ChainView[];
  nodes: NodeView[];
  parallelRouteMetres(
    a: readonly number[], b: readonly number[], shared: readonly NodeView[], joinMetres?: number,
  ): number;
}

describe('road graph owns each sustained corridor once', () => {
  it('has no sustained parallel duplicate across biome and seed variations', () => {
    const biomes = ['temperate', 'desert', 'snow', 'urban'] as const;
    const failures: string[] = [];

    for (let biomeIndex = 0; biomeIndex < biomes.length; biomeIndex++) {
      const biome = biomes[biomeIndex];
      const scene = new THREE.Scene();
      const terrain = new Terrain({
        scene,
        seed: (0x271c4d ^ (biomeIndex * 0x45d9f3b)) | 0,
        biome,
      });

      for (let seed = 0; seed < 8; seed++) {
        const net = new RoadNetwork({
          scene,
          terrain,
          seed: (0x517cc1b7 ^ (seed * 0x9e3779b1)) | 0,
          decals: null,
          stampTerrain: false,
        });
        net.generate();
        const view = net as unknown as NetworkView;

        for (let ai = 0; ai < view.chains.length; ai++) {
          for (let bi = ai + 1; bi < view.chains.length; bi++) {
            const a = view.chains[ai];
            const b = view.chains[bi];
            if (a.sourceId === b.sourceId) continue;
            const shared: NodeView[] = [];
            if (a.nodeA === b.nodeA || a.nodeA === b.nodeB) shared.push(view.nodes[a.nodeA]);
            if ((a.nodeB === b.nodeA || a.nodeB === b.nodeB) && a.nodeB !== a.nodeA) {
              shared.push(view.nodes[a.nodeB]);
            }
            const sharedJoin = shared.length > 0 ? 11 : undefined;
            const duplicateMetres = shared.length > 0 ? 8 : 36;
            const ab = view.parallelRouteMetres(a.spline, b.spline, shared, sharedJoin);
            const ba = view.parallelRouteMetres(b.spline, a.spline, shared, sharedJoin);
            if (Math.max(ab, ba) >= duplicateMetres) {
              const rawAB = view.parallelRouteMetres(a.way, b.way, shared);
              const rawBA = view.parallelRouteMetres(b.way, a.way, shared);
              failures.push(`${biome}:${seed} chain ${a.id}:${a.cls}/${b.id}:${b.cls} `
                + `${ab.toFixed(1)}/${ba.toFixed(1)}m raw ${rawAB.toFixed(1)}/${rawBA.toFixed(1)}m `
                + `shared ${shared.length}`);
            }
          }
        }
        net.dispose();
      }
      terrain.dispose();
    }

    expect(failures).toEqual([]);
  }, 240_000);

  it('cuts both banks before a ravine and fades the new road ends', () => {
    const scene = new THREE.Scene();
    const terrain = new Terrain({ scene, seed: 0x5a17, biome: 'desert' });
    const mutableTerrain = terrain as unknown as {
      heightAt(x: number, z: number): number;
      isWater(cx: number, cz: number): boolean;
    };
    mutableTerrain.heightAt = (x: number): number => (x >= 248 && x <= 264 ? 20 : 0);
    mutableTerrain.isWater = (): boolean => false;

    const net = new RoadNetwork({ scene, terrain, seed: 0x71ff, decals: null, stampTerrain: false });
    const view = net as unknown as {
      nodes: unknown[];
      chains: {
        id: number; sourceId: number; cls: RoadClass; halfWidth: number;
        nodeA: number; nodeB: number; way: number[]; spline: number[]; pts: number[];
        nrm: number[]; wl: number[]; wr: number[]; edgeL: number[]; edgeR: number[]; fade: number[];
        trimA: number; trimB: number; junctionA: boolean; junctionB: boolean;
        detachedA: boolean; detachedB: boolean;
      }[];
      clipUnsafeCorridors(): void;
      trimChains(): void;
      rasteriseMask(): void;
      applyToTerrain(): void;
      stampOpacity: Uint8Array;
    };
    const node = (id: number, x: number): unknown => ({
      id, x, z: 256, active: true, border: false, edges: [], arms: [], trimRadius: 0,
      padBoundary: [], padTris: [], padFan: false, padRuns: [],
    });
    view.nodes.push(node(0, 120), node(1, 392));
    view.chains.push({
      id: 0, sourceId: 0, cls: RoadClass.Arterial, halfWidth: 6.8,
      nodeA: 0, nodeB: 1, way: [120, 256, 392, 256], spline: [120, 256, 392, 256],
      pts: [], nrm: [], wl: [], wr: [], edgeL: [], edgeR: [], fade: [],
      trimA: 0, trimB: 0, junctionA: false, junctionB: false,
      detachedA: false, detachedB: false,
    });

    view.clipUnsafeCorridors();
    view.trimChains();
    const banks = view.chains.filter((c) => c.pts.length >= 4);
    expect(banks).toHaveLength(2);
    const west = banks.find((c) => c.detachedB);
    const east = banks.find((c) => c.detachedA);
    expect(west).toBeDefined();
    expect(east).toBeDefined();
    expect(west!.fade[west!.fade.length - 1]).toBeCloseTo(0, 8);
    expect(west!.fade[Math.max(0, west!.fade.length - 10)]).toBeGreaterThan(0.9);
    expect(east!.fade[0]).toBeCloseTo(0, 8);
    expect(east!.fade[Math.min(9, east!.fade.length - 1)]).toBeGreaterThan(0.9);

    // The gameplay mask keeps the dissolving corridor, but the terrain splat
    // must stop before it. Otherwise the transparent asphalt reveals the pale
    // paving/cobble layer as the bright gravel fan from the report.
    view.rasteriseMask();
    const stampAt = (x: number, z: number): number => {
      const tx = Math.floor(x / ROAD_MASK_METRES);
      const tz = Math.floor(z / ROAD_MASK_METRES);
      return view.stampOpacity[tz * ROAD_MASK_N + tx];
    };
    const westEnd = west!.pts.length - 2;
    expect(stampAt(west!.pts[westEnd], west!.pts[westEnd + 1])).toBeLessThan(255);
    expect(stampAt(west!.pts[Math.max(0, westEnd - 20)], west!.pts[Math.max(1, westEnd - 19)]))
      .toBe(255);

    const paving: string[] = [];
    const stampSurface = mutableTerrain as unknown as {
      stampSurface(cx: number, cz: number, layer: SurfaceId, weight: number): void;
      commitSplat(): void;
    };
    stampSurface.stampSurface = (cx, cz, layer): void => {
      if (layer === SurfaceId.Paving) paving.push(`${cx},${cz}`);
    };
    stampSurface.commitSplat = (): void => {};
    view.applyToTerrain();
    expect(paving).not.toContain(
      `${Math.floor(west!.pts[westEnd] / CELL)},${Math.floor(west!.pts[westEnd + 1] / CELL)}`,
    );

    net.dispose();
    terrain.dispose();
  });
});
