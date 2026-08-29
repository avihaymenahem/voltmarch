import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import {
  GarrisonFortificationMarkers,
  GARRISON_MARKER_SEGMENTS,
  MAX_MARKED_GARRISONS,
  garrisonMarkerCost,
  writeGarrisonMarkerMatrices,
} from '../src/art/GarrisonFortificationMarkers';
import { Faction } from '../src/core/types';

describe('garrison occupation rail presentation', () => {
  it('emits four smooth rail corners around the footprint', () => {
    const matrices: THREE.Matrix4[] = [];
    const count = writeGarrisonMarkerMatrices({
      x: 20,
      y: 2,
      z: 40,
      yaw: 0,
      footprintW: 3,
      footprintH: 2,
      faction: Faction.Allies,
    }, matrices);

    expect(count).toBe(GARRISON_MARKER_SEGMENTS);
    const positions = matrices.map((matrix) => new THREE.Vector3().setFromMatrixPosition(matrix));
    expect(Math.min(...positions.map((p) => p.x))).toBeLessThan(20 - 5);
    expect(Math.max(...positions.map((p) => p.x))).toBeGreaterThan(20 + 5);
    expect(Math.min(...positions.map((p) => p.z))).toBeLessThan(40 - 3);
    expect(Math.max(...positions.map((p) => p.z))).toBeGreaterThan(40 + 3);
  });

  it('rotates the entire marker layout with the host', () => {
    const a: THREE.Matrix4[] = [];
    const b: THREE.Matrix4[] = [];
    const base = { x: 0, y: 0, z: 0, footprintW: 3, footprintH: 1, faction: Faction.Soviets };
    writeGarrisonMarkerMatrices({ ...base, yaw: 0 }, a);
    writeGarrisonMarkerMatrices({ ...base, yaw: Math.PI * 0.5 }, b);
    const extents = (matrices: THREE.Matrix4[]) => {
      const points = matrices.map((matrix) => new THREE.Vector3().setFromMatrixPosition(matrix));
      return {
        x: Math.max(...points.map((p) => Math.abs(p.x))),
        z: Math.max(...points.map((p) => Math.abs(p.z))),
      };
    };
    const e0 = extents(a);
    const e90 = extents(b);
    expect(e0.x).toBeCloseTo(e90.z, 5);
    expect(e0.z).toBeCloseTo(e90.x, 5);
  });

  it('budgets the polished core and soft glow honestly', () => {
    expect(garrisonMarkerCost(0)).toEqual({ colourDraws: 0, triangles: 0 });
    expect(garrisonMarkerCost(1)).toEqual({ colourDraws: 2, triangles: 9_216 });
    expect(garrisonMarkerCost(12)).toEqual({ colourDraws: 2, triangles: 110_592 });
    expect(garrisonMarkerCost(MAX_MARKED_GARRISONS + 20)).toEqual({
      colourDraws: 2,
      triangles: MAX_MARKED_GARRISONS * 9_216,
    });
  });

  it('keeps the published budget in sync with the smooth renderer geometry', () => {
    const scene = new THREE.Scene();
    const markers = new GarrisonFortificationMarkers(scene);
    const triangles = (mesh: THREE.InstancedMesh): number => {
      const geometry = mesh.geometry;
      return (geometry.index?.count ?? geometry.getAttribute('position').count) / 3;
    };
    const actual = GARRISON_MARKER_SEGMENTS
      * (triangles(markers.mesh) + triangles(markers.glowMesh));
    expect(actual).toBe(garrisonMarkerCost(1).triangles);
    markers.dispose();
    expect(scene.children).toHaveLength(0);
  });
});
