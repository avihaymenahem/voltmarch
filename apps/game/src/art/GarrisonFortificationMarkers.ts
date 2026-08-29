/**
 * Smooth, render-only occupation rails for garrisoned buildings.
 *
 * A captured structure needs a persistent world-space read, but chunky wall
 * blocks made the host look boxed-in and visibly procedural. Four rounded,
 * faction-coloured rails now frame the footprint instead. A polished core and
 * a very soft additive halo share the same instance transforms, so the marker
 * reads at RTS distance without pretending to be collision geometry.
 *
 * The pool casts no shadow, is excluded from AO, owns no collider and never
 * writes to the world store, nav grid or simulation.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import { CELL, FACTION_PALETTE } from '../core/config';
import { hexToLinearRgb } from '../core/math';
import { FACTION_PALETTE_KEYS, Faction } from '../core/types';
import { LAYERS, RENDER_ORDER } from '../render/scene';

export const GARRISON_MARKER_SEGMENTS = 4;
export const GARRISON_MARKER_TRIANGLES_PER_SEGMENT = 2_304;
export const MAX_MARKED_GARRISONS = 64;

const RAIL_ARM_LENGTH = 1.72;
const RAIL_CORNER_RADIUS = 0.34;
const RAIL_CORE_RADIUS = 0.075;
const RAIL_GLOW_RADIUS = 0.14;
const RAIL_TUBULAR_SEGMENTS = 24;
const RAIL_RADIAL_SEGMENTS = 12;
const RAIL_CAP_WIDTH_SEGMENTS = 16;
const RAIL_CAP_HEIGHT_SEGMENTS = 10;
const FOOTPRINT_GAP = 0.3;
const RAIL_ELEVATION = 0.115;

export interface GarrisonMarkerHost {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly footprintW: number;
  readonly footprintH: number;
  readonly faction: Faction;
}

export interface GarrisonMarkerCost {
  readonly colourDraws: number;
  readonly triangles: number;
}

const LAYOUT_Q = new THREE.Quaternion();
const LAYOUT_P = new THREE.Vector3();
const UNIT_SCALE = new THREE.Vector3(1, 1, 1);

/** Honest visible-pass budget: one core draw plus one glow draw. */
export function garrisonMarkerCost(markedBuildings: number): GarrisonMarkerCost {
  const count = Math.max(0, Math.min(MAX_MARKED_GARRISONS, Math.floor(markedBuildings)));
  return {
    colourDraws: count > 0 ? 2 : 0,
    triangles: count * GARRISON_MARKER_SEGMENTS * GARRISON_MARKER_TRIANGLES_PER_SEGMENT,
  };
}

/**
 * Emits four corner transforms, respecting footprint and building yaw. The
 * canonical rail opens toward local +X/+Z; rotations point every copy inward.
 * Kept pure so placement can be regression-tested without a renderer.
 */
export function writeGarrisonMarkerMatrices(
  host: GarrisonMarkerHost,
  out: THREE.Matrix4[],
): number {
  const halfW = Math.max(1, host.footprintW) * CELL * 0.5 + FOOTPRINT_GAP;
  const halfH = Math.max(1, host.footprintH) * CELL * 0.5 + FOOTPRINT_GAP;
  const cos = Math.cos(host.yaw);
  const sin = Math.sin(host.yaw);
  let n = 0;

  const emit = (sx: -1 | 1, sz: -1 | 1, cornerYaw: number): void => {
    const lx = sx * halfW;
    const lz = sz * halfH;
    const worldX = host.x + lx * cos + lz * sin;
    const worldZ = host.z - lx * sin + lz * cos;
    LAYOUT_P.set(worldX, host.y + RAIL_ELEVATION, worldZ);
    LAYOUT_Q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, host.yaw + cornerYaw);
    const matrix = out[n] ?? (out[n] = new THREE.Matrix4());
    matrix.compose(LAYOUT_P, LAYOUT_Q, UNIT_SCALE);
    n++;
  };

  emit(-1, -1, 0);
  emit(-1, 1, Math.PI * 0.5);
  emit(1, 1, Math.PI);
  emit(1, -1, -Math.PI * 0.5);
  return n;
}

/** Smooth, closed quarter rail with long inward-facing arms and no block silhouette. */
function createCornerRailGeometry(radius: number, name: string): THREE.BufferGeometry {
  const bend = RAIL_CORNER_RADIUS;
  const path = new THREE.CurvePath<THREE.Vector3>();
  path.add(new THREE.LineCurve3(
    new THREE.Vector3(RAIL_ARM_LENGTH, 0, 0),
    new THREE.Vector3(bend, 0, 0),
  ));
  path.add(new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(bend, 0, 0),
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, bend),
  ));
  path.add(new THREE.LineCurve3(
    new THREE.Vector3(0, 0, bend),
    new THREE.Vector3(0, 0, RAIL_ARM_LENGTH),
  ));
  const tube = new THREE.TubeGeometry(
    path,
    RAIL_TUBULAR_SEGMENTS,
    radius,
    RAIL_RADIAL_SEGMENTS,
    false,
  );
  const capA = new THREE.SphereGeometry(
    radius,
    RAIL_CAP_WIDTH_SEGMENTS,
    RAIL_CAP_HEIGHT_SEGMENTS,
  );
  const capB = capA.clone();
  capA.translate(RAIL_ARM_LENGTH, 0, 0);
  capB.translate(0, 0, RAIL_ARM_LENGTH);
  const geometry = mergeGeometries([tube, capA, capB], false);
  tube.dispose();
  capA.dispose();
  capB.dispose();
  if (geometry === null) throw new Error('Failed to build garrison occupation rail geometry');
  geometry.name = name;
  return geometry;
}

const LINEAR = new Float32Array(3);

export function garrisonFactionColour(faction: Faction, out: THREE.Color): THREE.Color {
  const key = FACTION_PALETTE_KEYS[faction as number] ?? 'neutral';
  hexToLinearRgb(FACTION_PALETTE[key].team, LINEAR);
  return out.setRGB(LINEAR[0], LINEAR[1], LINEAR[2]);
}

export class GarrisonFortificationMarkers {
  /** Polished rail exposed for renderer diagnostics and tests. */
  readonly mesh: THREE.InstancedMesh;
  readonly glowMesh: THREE.InstancedMesh;

  private readonly matrices: THREE.Matrix4[] = [];
  private readonly colour = new THREE.Color();
  private readonly glowMaterial: THREE.MeshBasicMaterial;

  constructor(scene: THREE.Scene) {
    const coreGeometry = createCornerRailGeometry(
      RAIL_CORE_RADIUS,
      'GarrisonOccupationRailCore',
    );
    const coreMaterial = new THREE.MeshPhysicalMaterial({
      name: 'GarrisonOccupationRailMaterial',
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.26,
      metalness: 0.72,
      clearcoat: 0.78,
      clearcoatRoughness: 0.2,
    });
    const glowGeometry = createCornerRailGeometry(
      RAIL_GLOW_RADIUS,
      'GarrisonOccupationRailGlow',
    );
    const glowMaterial = new THREE.MeshBasicMaterial({
      name: 'GarrisonOccupationGlowMaterial',
      color: 0xffffff,
      vertexColors: true,
      transparent: true,
      opacity: 0.115,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    const capacity = MAX_MARKED_GARRISONS * GARRISON_MARKER_SEGMENTS;
    const core = new THREE.InstancedMesh(coreGeometry, coreMaterial, capacity);
    const glow = new THREE.InstancedMesh(glowGeometry, glowMaterial, capacity);
    core.name = 'GarrisonOccupationRails';
    glow.name = 'GarrisonOccupationRailGlow';
    core.count = 0;
    glow.count = 0;
    core.castShadow = false;
    core.receiveShadow = true;
    glow.castShadow = false;
    glow.receiveShadow = false;
    core.renderOrder = RENDER_ORDER.OPAQUE;
    glow.renderOrder = RENDER_ORDER.PARTICLES;
    for (const pooledMesh of [core, glow]) {
      pooledMesh.layers.set(LAYERS.DEFAULT);
      pooledMesh.layers.enable(LAYERS.EFFECTS);
      pooledMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(pooledMesh);
    }
    this.mesh = core;
    this.glowMesh = glow;
    this.glowMaterial = glowMaterial;
  }

  update(hosts: readonly GarrisonMarkerHost[]): void {
    const hostCount = Math.min(hosts.length, MAX_MARKED_GARRISONS);
    let slot = 0;
    for (let h = 0; h < hostCount; h++) {
      const host = hosts[h];
      const matrixCount = writeGarrisonMarkerMatrices(host, this.matrices);
      garrisonFactionColour(host.faction, this.colour);
      for (let i = 0; i < matrixCount; i++) {
        this.mesh.setMatrixAt(slot, this.matrices[i]);
        this.mesh.setColorAt(slot, this.colour);
        this.glowMesh.setMatrixAt(slot, this.matrices[i]);
        this.glowMesh.setColorAt(slot, this.colour);
        slot++;
      }
    }
    this.commitInstances(this.mesh, slot);
    this.commitInstances(this.glowMesh, slot);
  }

  /** Slow enough to read as powered trim instead of a flashing UI widget. */
  updatePulse(time: number): void {
    this.glowMaterial.opacity = 0.105 + Math.sin(time * 1.65) * 0.025;
  }

  private commitInstances(mesh: THREE.InstancedMesh, count: number): void {
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
    mesh.boundingBox = null;
    mesh.boundingSphere = null;
    if (count > 0) {
      mesh.computeBoundingBox();
      mesh.computeBoundingSphere();
    }
  }

  dispose(): void {
    for (const mesh of [this.mesh, this.glowMesh]) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      mesh.dispose();
    }
  }
}
