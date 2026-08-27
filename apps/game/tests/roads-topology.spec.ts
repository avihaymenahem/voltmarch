/**
 * Road topology conflicts that become overlapping asphalt ribbons.
 *
 * The visual failure is not a shader artefact: two independent chains occupy
 * one corridor for a sustained distance, so their surfaces and lane markings
 * fight. This census exercises every biome and both route directions. The
 * production detector uses absolute tangent alignment, therefore reverse-flow
 * duplicates, curved near-parallels and shallow merges are all covered while
 * perpendicular crossings remain legal. Chains sharing a graph endpoint are
 * real junction arms and are owned by the junction solver instead.
 */

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { Terrain } from '../src/world/Terrain';
import { RoadClass, RoadNetwork } from '../src/world/Roads';

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
  parallelRouteMetres(a: readonly number[], b: readonly number[], shared: readonly NodeView[]): number;
}

describe('road graph owns each sustained corridor once', () => {
  it('has no independent parallel duplicate across biome and seed variations', () => {
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
            const ab = view.parallelRouteMetres(a.spline, b.spline, shared);
            const ba = view.parallelRouteMetres(b.spline, a.spline, shared);
            if (Math.max(ab, ba) >= 36) {
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

    net.dispose();
    terrain.dispose();
  });
});
