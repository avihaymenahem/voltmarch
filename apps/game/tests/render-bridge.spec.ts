/**
 * RenderBridge + InstanceBatcher — the sim->render seam.
 *
 * Everything here runs headless: `THREE.InstancedMesh`, `BoxGeometry` and
 * `BufferAttribute` are pure JS objects and never touch a GL context, so the
 * whole batching/binding/interpolation path is testable in Node.
 */

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { EntityStore } from '../src/core/world';
import { EntityFlag, EntityKind, Faction, PartId } from '../src/core/types';
import type { PlayerId } from '../src/core/types';
import { DEFAULT_ART, INSTANCE_BATCH_INITIAL_CAPACITY } from '../src/core/config';
import { DeployVisualClip } from '../src/core/DeployVisual';
import { hexToLinearRgb, wrapAngle } from '../src/core/math';
import {
  FACTION_ANY,
  RenderBridge,
  clearKindMeshes,
  registerKindMesh,
  resolveRegisteredKindPreviewParts,
  resolveKindPreviewParts,
  setRenderBridge,
  type KindMesh,
} from '../src/render/RenderBridge';
import { CameraRenderCullVolume } from '../src/render/RenderCullVolume';

const P0 = 0 as PlayerId;

function makeRig(): { store: EntityStore; scene: THREE.Scene; bridge: RenderBridge } {
  clearKindMeshes();
  const store = new EntityStore();
  const scene = new THREE.Scene();
  const bridge = new RenderBridge(store, scene);
  setRenderBridge(bridge);
  return { store, scene, bridge };
}

function teardown(bridge: RenderBridge): void {
  clearKindMeshes();
  setRenderBridge(null);
  bridge.dispose();
}

/** Every InstancedMesh currently under the batcher's root group. */
function meshes(scene: THREE.Scene): THREE.InstancedMesh[] {
  const out: THREE.InstancedMesh[] = [];
  scene.traverse((o) => {
    if ((o as THREE.InstancedMesh).isInstancedMesh) out.push(o as THREE.InstancedMesh);
  });
  return out;
}

/** Translation column of one instance. */
function translation(mesh: THREE.InstancedMesh, slot: number): [number, number, number] {
  const a = mesh.instanceMatrix.array;
  return [a[slot * 16 + 12], a[slot * 16 + 13], a[slot * 16 + 14]];
}

/** Length of each basis column = instance scale on that local axis. */
function scale(mesh: THREE.InstancedMesh, slot: number): [number, number, number] {
  const a = mesh.instanceMatrix.array;
  const o = slot * 16;
  return [
    Math.hypot(a[o], a[o + 1], a[o + 2]),
    Math.hypot(a[o + 4], a[o + 5], a[o + 6]),
    Math.hypot(a[o + 8], a[o + 9], a[o + 10]),
  ];
}

/* ========================================================================== */

describe('RenderBridge — placeholders', () => {
  it('draws an unregistered kind rather than nothing', () => {
    const { store, scene, bridge } = makeRig();
    store.alloc(EntityKind.Vehicle, -1, P0, Faction.Allies, 100, 0, 200, 0);
    store.snapshotPrev();

    bridge.update(1);

    const list = meshes(scene);
    expect(list.length).toBe(1);
    expect(list[0].count).toBe(1);
    expect(list[0].visible).toBe(true);
    expect(translation(list[0], 0)).toEqual([100, 0, 200]);
    expect(bridge.visibleUnits).toBe(1);
    teardown(bridge);
  });

  it('stretches a placeholder building to its real footprint', () => {
    const { store, scene, bridge } = makeRig();
    const id = store.alloc(EntityKind.Building, -1, P0, Faction.Soviets, 64, 0, 64, 0);
    const i = store.index(id);
    store.footprintW[i] = 3;
    store.footprintH[i] = 2;
    store.snapshotPrev();

    bridge.update(1);

    // Unit cube scaled by (w*CELL, height, h*CELL): column lengths are the scale.
    const a = meshes(scene)[0].instanceMatrix.array;
    const sx = Math.hypot(a[0], a[1], a[2]);
    const sz = Math.hypot(a[8], a[9], a[10]);
    expect(sx).toBeCloseTo(12, 5);
    expect(sz).toBeCloseTo(8, 5);
    expect(bridge.visibleBuildings).toBe(1);
    teardown(bridge);
  });

  it('gives each kind its own batch and never mixes them', () => {
    const { store, scene, bridge } = makeRig();
    store.alloc(EntityKind.Vehicle, -1, P0, Faction.Allies, 10, 0, 10, 0);
    store.alloc(EntityKind.Infantry, -1, P0, Faction.Allies, 20, 0, 20, 0);
    store.alloc(EntityKind.Building, -1, P0, Faction.Allies, 30, 0, 30, 0);
    store.snapshotPrev();

    bridge.update(1);
    expect(meshes(scene).length).toBe(3);
    expect(bridge.batchCount).toBe(3);
    teardown(bridge);
  });
});

describe('RenderBridge — unowned model previews', () => {
  it('hands placement the same faction/definition geometry and local offsets', () => {
    clearKindMeshes();
    const root = new THREE.BoxGeometry(5, 2, 4);
    const stack = new THREE.CylinderGeometry(0.4, 0.5, 3);
    registerKindMesh(EntityKind.Building, Faction.Allies, {
      geometry: root,
      material: new THREE.MeshStandardMaterial(),
      parts: [{
        geometry: stack,
        material: new THREE.MeshStandardMaterial(),
        x: 1.25,
        y: 2,
        z: -0.5,
      }],
    }, 17);

    const preview = resolveKindPreviewParts(EntityKind.Building, Faction.Allies, 17);
    expect(preview).toHaveLength(2);
    expect(preview[0].geometry).toBe(root);
    expect(preview[0].material).toBeDefined();
    expect(preview[1].geometry).toBe(stack);
    expect([preview[1].offsetX, preview[1].offsetY, preview[1].offsetZ])
      .toEqual([1.25, 2, -0.5]);
    clearKindMeshes();
  });

  it('does not expose a bridge placeholder as authored HUD art', () => {
    clearKindMeshes();
    expect(resolveRegisteredKindPreviewParts(EntityKind.Vehicle, Faction.Allies, 404))
      .toBeNull();
    clearKindMeshes();
  });
});

describe('RenderBridge — imported WebGPU construction rise', () => {
  it('raises marked parts from below ground using the existing build progress', () => {
    const { store, scene, bridge } = makeRig();
    registerKindMesh(EntityKind.Building, Faction.Allies, {
      geometry: new THREE.BoxGeometry(4, 8, 4),
      material: new THREE.MeshStandardMaterial(),
      constructionRise: 8,
    }, 23);
    const id = store.alloc(EntityKind.Building, 23, P0, Faction.Allies, 30, 10, 40, 0);
    const i = store.index(id);
    store.buildProgress[i] = 0.25;
    store.snapshotPrev();

    bridge.update(1);
    expect(translation(meshes(scene)[0], 0)[1]).toBeCloseTo(4, 5);

    store.buildProgress[i] = 1;
    bridge.update(1);
    expect(translation(meshes(scene)[0], 0)[1]).toBeCloseTo(10, 5);
    teardown(bridge);
  });
});

describe('RenderBridge — MCV conversion', () => {
  it('hydraulically folds a deploying vehicle instead of leaving it static', () => {
    const { store, scene, bridge } = makeRig();
    const id = store.alloc(EntityKind.Vehicle, -1, P0, Faction.Allies, 30, 5, 40, 0);
    const i = store.index(id);
    store.animClip[i] = DeployVisualClip.Fold;
    store.animTime[i] = 0.5;
    store.snapshotPrev();

    bridge.update(1);
    const mesh = meshes(scene)[0];
    const [sx, sy, sz] = scale(mesh, 0);
    expect(sx).toBeGreaterThan(1);
    expect(sz).toBeGreaterThan(1);
    expect(sy).toBeLessThan(0.7);
    expect(translation(mesh, 0)[1]).toBeLessThan(5);
    teardown(bridge);
  });

  it('raises the finished yard from below its pad, then restores authored transform', () => {
    const { store, scene, bridge } = makeRig();
    registerKindMesh(EntityKind.Building, Faction.Allies, {
      geometry: new THREE.BoxGeometry(8, 10, 8),
      material: new THREE.MeshStandardMaterial(),
    }, 44);
    const id = store.alloc(EntityKind.Building, 44, P0, Faction.Allies, 30, 10, 40, 0);
    const i = store.index(id);
    store.footprintW[i] = 4;
    store.footprintH[i] = 4;
    store.animClip[i] = DeployVisualClip.Rise;
    store.animTime[i] = 0;
    store.snapshotPrev();

    bridge.update(1);
    let mesh = meshes(scene)[0];
    expect(translation(mesh, 0)[1]).toBeLessThan(5);
    expect(scale(mesh, 0)[1]).toBeLessThan(0.35);

    store.animTime[i] = 1;
    bridge.update(1);
    mesh = meshes(scene)[0];
    expect(translation(mesh, 0)[1]).toBeCloseTo(10, 5);
    expect(scale(mesh, 0)).toEqual([1, 1, 1]);
    teardown(bridge);
  });
});

describe('RenderBridge — team colour is per-instance, never a batch key', () => {
  it('renders both armies from ONE batch when they share a model', () => {
    const { store, scene, bridge } = makeRig();
    const geo = new THREE.BoxGeometry(3, 2, 6);
    const mesh: KindMesh = { geometry: geo, material: new THREE.MeshStandardMaterial() };
    // The SAME object registered for both factions must dedupe to one entry.
    registerKindMesh(EntityKind.Vehicle, Faction.Allies, mesh);
    registerKindMesh(EntityKind.Vehicle, Faction.Soviets, mesh);

    store.alloc(EntityKind.Vehicle, -1, P0, Faction.Allies, 10, 0, 10, 0);
    store.alloc(EntityKind.Vehicle, -1, P0, Faction.Soviets, 20, 0, 20, 0);
    store.snapshotPrev();

    bridge.update(1);

    const list = meshes(scene);
    expect(list.length).toBe(1);
    expect(list[0].count).toBe(2);

    const team = list[0].geometry.getAttribute('aTeamColor').array as Float32Array;
    const allies = new Float32Array(3);
    const soviets = new Float32Array(3);
    hexToLinearRgb(DEFAULT_ART.factions.allies.team, allies);
    hexToLinearRgb(DEFAULT_ART.factions.soviets.team, soviets);

    expect(team[0]).toBeCloseTo(allies[0], 5);
    expect(team[3]).toBeCloseTo(soviets[0], 5);
    expect(team[4]).toBeCloseTo(soviets[1], 5);
    teardown(bridge);
  });

  it('resolves FACTION_ANY when no faction-specific model exists', () => {
    const { store, scene, bridge } = makeRig();
    registerKindMesh(EntityKind.Prop, FACTION_ANY, {
      geometry: new THREE.BoxGeometry(1, 3, 1),
      material: new THREE.MeshStandardMaterial(),
    });
    store.alloc(EntityKind.Prop, -1, P0, Faction.Neutral, 40, 0, 40, 0);
    store.snapshotPrev();

    bridge.update(1);
    expect(meshes(scene).length).toBe(1);
    expect(bridge.batchCount).toBe(1);
    teardown(bridge);
  });
});

describe('RenderBridge — interpolation', () => {
  it('lerps position between the previous and current tick', () => {
    const { store, scene, bridge } = makeRig();
    const id = store.alloc(EntityKind.Vehicle, -1, P0, Faction.Allies, 0, 0, 0, 0);
    const i = store.index(id);
    store.snapshotPrev();
    store.posX[i] = 10;
    store.posZ[i] = 20;

    bridge.update(0.25);
    expect(translation(meshes(scene)[0], 0)).toEqual([2.5, 0, 5]);
    teardown(bridge);
  });

  it('slews a turret the SHORT way across the +/-PI seam', () => {
    const { store, scene, bridge } = makeRig();
    const id = store.alloc(EntityKind.Vehicle, -1, P0, Faction.Allies, 0, 0, 0, 0);
    const i = store.index(id);
    // Just under +PI to just over -PI: 0.2 rad apart the short way, 6.08 the long way.
    store.turretYaw[i] = wrapAngle(Math.PI - 0.1);
    store.snapshotPrev();
    store.turretYaw[i] = wrapAngle(-Math.PI + 0.1);

    // A registered model with a turret part, so the seam is actually rendered.
    clearKindMeshes();
    registerKindMesh(EntityKind.Vehicle, FACTION_ANY, {
      geometry: new THREE.BoxGeometry(3, 1, 6),
      material: new THREE.MeshStandardMaterial(),
      parts: [{
        geometry: new THREE.BoxGeometry(2, 1, 2),
        material: new THREE.MeshStandardMaterial(),
        y: 1.5,
        followsTurret: true,
        part: PartId.Turret,
      }],
    });

    bridge.update(0.5);

    // Halfway along the SHORT arc is exactly +/-PI, i.e. facing -Z.
    const turret = meshes(scene).find((m) => m.name.endsWith('turret'))!;
    const a = turret.instanceMatrix.array;
    const forwardX = a[8];
    const forwardZ = a[10];
    expect(Math.abs(forwardX)).toBeLessThan(1e-6);
    expect(forwardZ).toBeCloseTo(-1, 5);
    teardown(bridge);
  });

  it('composes yaw so that local +Z is the unit forward vector', () => {
    const { store, scene, bridge } = makeRig();
    // yaw = PI/2 must face +X, per the core convention.
    store.alloc(EntityKind.Vehicle, -1, P0, Faction.Allies, 0, 0, 0, Math.PI / 2);
    store.snapshotPrev();

    bridge.update(1);
    const a = meshes(scene)[0].instanceMatrix.array;
    expect(a[8]).toBeCloseTo(1, 5);   // forward.x
    expect(a[9]).toBeCloseTo(0, 5);
    expect(a[10]).toBeCloseTo(0, 5);
    teardown(bridge);
  });
});

describe('InstanceBatcher — slot lifecycle', () => {
  it('blanks a freed slot so no stale pose survives recycling', () => {
    const { store, scene, bridge } = makeRig();
    const id = store.alloc(EntityKind.Vehicle, -1, P0, Faction.Allies, 77, 0, 88, 0);
    store.snapshotPrev();
    bridge.update(1);
    expect(translation(meshes(scene)[0], 0)).toEqual([77, 0, 88]);

    store.markDead(id);
    store.flushDestroyed();
    bridge.update(1);

    const mesh = meshes(scene)[0];
    expect(mesh.count).toBe(0);
    expect(mesh.visible).toBe(false);
    // Zero basis AND zero translation: the instance collapses to a point.
    const a = mesh.instanceMatrix.array;
    for (let k = 0; k < 16; k++) expect(a[k]).toBe(0);
    teardown(bridge);
  });

  it('A RECYCLED SLOT IS STILL AFFINE — w must be 1, or the instance vanishes', () => {
    // THE INVISIBLE-UNITS BUG, reported four times before it was found.
    //
    // `free()` zeroes all sixteen floats, destroying the `m[15] = 1` that only
    // the constructor and `grow()` used to establish. `writeMatrix` cannot
    // repair it — MATRIX_SLOTS deliberately covers only the twelve mutable
    // elements. So a slot was correct on first use and projective (w = 0) on
    // every reuse, which collapses the model to a sub-pixel dot at the far
    // plane while the entity stays alive and shootable.
    //
    // The population that gets recycled slots is precisely "an enemy that
    // crossed your vision boundary", which is why it read as
    // "invisible enemies inside my base, not in fog".
    const { store, scene, bridge } = makeRig();

    const first = store.alloc(EntityKind.Infantry, -1, P0, Faction.Allies, 20, 0, 20, 0);
    store.snapshotPrev();
    bridge.update(1);

    // Kill it: the slot goes back on the LIFO free list, blanked.
    store.markDead(first);
    store.flushDestroyed();
    bridge.update(1);

    // The next allocation pops that very slot straight back off the free list.
    const second = store.alloc(EntityKind.Infantry, -1, P0, Faction.Allies, 40, 0, 40, 0);
    store.snapshotPrev();
    bridge.update(1);
    expect(second).toBeGreaterThanOrEqual(0);

    const mesh = meshes(scene)[0];
    expect(mesh.count).toBe(1);
    const a = mesh.instanceMatrix.array;
    // The four constant elements of a column-major affine transform. w = 0 is
    // the whole defect: it makes the vertex a direction instead of a point.
    expect(a[3]).toBe(0);
    expect(a[7]).toBe(0);
    expect(a[11]).toBe(0);
    expect(a[15], 'recycled slot lost its w=1 — the unit renders invisible').toBe(1);
    // And it is genuinely placed, not merely affine.
    expect(translation(mesh, 0)).toEqual([40, 0, 40]);
    teardown(bridge);
  });

  it('hides garrisoned and cloaked entities and reclaims their slots', () => {
    const { store, scene, bridge } = makeRig();
    const id = store.alloc(EntityKind.Infantry, -1, P0, Faction.Allies, 5, 0, 5, 0);
    const i = store.index(id);
    store.snapshotPrev();
    bridge.update(1);
    expect(meshes(scene)[0].count).toBe(1);

    store.flags[i] |= EntityFlag.Garrisoned;
    bridge.update(1);
    expect(meshes(scene)[0].count).toBe(0);

    store.flags[i] &= ~EntityFlag.Garrisoned;
    bridge.update(1);
    expect(meshes(scene)[0].count).toBe(1);
    teardown(bridge);
  });

  it('grows geometrically past the initial capacity without losing anyone', () => {
    const { store, scene, bridge } = makeRig();
    const n = INSTANCE_BATCH_INITIAL_CAPACITY * 3 + 7;
    // Render the initial allocation first. WebGPU compiles its instance node at
    // this point, which is the production path a later Cheat Engine burst hits.
    for (let k = 0; k < INSTANCE_BATCH_INITIAL_CAPACITY; k++) {
      store.alloc(EntityKind.Vehicle, -1, P0, Faction.Allies, k, 0, k * 2, 0);
    }
    store.snapshotPrev();
    bridge.update(1);
    const initialMesh = meshes(scene)[0];
    expect(initialMesh.instanceMatrix.count).toBe(INSTANCE_BATCH_INITIAL_CAPACITY);

    for (let k = INSTANCE_BATCH_INITIAL_CAPACITY; k < n; k++) {
      store.alloc(EntityKind.Vehicle, -1, P0, Faction.Allies, k, 0, k * 2, 0);
    }
    store.snapshotPrev();
    bridge.update(1);

    const mesh = meshes(scene)[0];
    // Growth must replace the draw object. Three/WebGPU's compiled instancing
    // node captures the original attribute and cannot observe an array swap.
    expect(mesh).not.toBe(initialMesh);
    expect(initialMesh.parent).toBeNull();
    expect(mesh.instanceMatrix.count).toBeGreaterThanOrEqual(n);
    expect(mesh.count).toBe(n);
    expect(bridge.instanceCount).toBe(n);
    // Growth reallocates the buffer; every earlier instance must survive it.
    expect(translation(mesh, 0)).toEqual([0, 0, 0]);
    expect(translation(mesh, n - 1)).toEqual([n - 1, 0, (n - 1) * 2]);
    teardown(bridge);
  });

  it('keeps a bounding sphere that encloses every live instance', () => {
    const { store, scene, bridge } = makeRig();
    store.alloc(EntityKind.Vehicle, -1, P0, Faction.Allies, 0, 0, 0, 0);
    store.alloc(EntityKind.Vehicle, -1, P0, Faction.Allies, 400, 0, 300, 0);
    store.snapshotPrev();
    bridge.update(1);

    const sphere = meshes(scene)[0].boundingSphere!;
    expect(sphere.center.x).toBeCloseTo(200, 4);
    expect(sphere.center.z).toBeCloseTo(150, 4);
    // Must reach both corners plus the model's own radius.
    expect(sphere.radius).toBeGreaterThan(Math.hypot(200, 150));
    teardown(bridge);
  });

  it('compacts a camera-culled hole so drawCount and GPU vertex work shrink', () => {
    const { store, scene, bridge } = makeRig();
    const first = store.alloc(EntityKind.Vehicle, -1, P0, Faction.Allies, 10, 0, 0, 0);
    const middle = store.alloc(EntityKind.Vehicle, -1, P0, Faction.Allies, 20, 0, 0, 0);
    const last = store.alloc(EntityKind.Vehicle, -1, P0, Faction.Allies, 30, 0, 0, 0);
    store.snapshotPrev();
    bridge.update(1);
    expect(meshes(scene)[0].count).toBe(3);

    bridge.update(1, 1, 0, {
      intersectsSphere: (x) => x !== 20,
    });

    const mesh = meshes(scene)[0];
    expect(mesh.count).toBe(2);
    expect(translation(mesh, 0)).toEqual([10, 0, 0]);
    // The former tail moved into the released middle slot, including its
    // owner binding. It must stay addressable by gameplay/VFX queries.
    expect(translation(mesh, 1)).toEqual([30, 0, 0]);
    expect(bridge.isRendered(first)).toBe(true);
    expect(bridge.isRendered(middle)).toBe(false);
    expect(bridge.isRendered(last)).toBe(true);
    expect(bridge.cameraCulled).toBe(1);
    expect(bridge.auditNow().misses).toHaveLength(0);
    teardown(bridge);
  });
});

describe('CameraRenderCullVolume', () => {
  it('rejects distant spheres but preserves objects inside the expanded margin', () => {
    const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 500);
    camera.position.set(0, 30, 30);
    camera.lookAt(0, 0, 0);
    const volume = new CameraRenderCullVolume();

    volume.update(camera, 0);
    expect(volume.intersectsSphere(0, 0, 0, 1)).toBe(true);
    expect(volume.intersectsSphere(200, 0, 0, 1)).toBe(false);

    volume.update(camera, 40);
    // Just outside the colour frustum remains resident for a possible shadow.
    expect(volume.intersectsSphere(45, 0, 0, 2)).toBe(true);
    expect(volume.intersectsSphere(200, 0, 0, 2)).toBe(false);
  });
});

describe('RenderBridge — per-instance state', () => {
  it('packs hpFrac, buildProgress, selection and seed into aState', () => {
    const { store, scene, bridge } = makeRig();
    const id = store.alloc(EntityKind.Building, -1, P0, Faction.Allies, 8, 0, 8, 0);
    const i = store.index(id);
    store.maxHp[i] = 200;
    store.hp[i] = 50;
    store.buildProgress[i] = 0.4;
    store.flags[i] |= EntityFlag.Selected;
    store.snapshotPrev();

    bridge.update(1);
    const st = meshes(scene)[0].geometry.getAttribute('aState').array as Float32Array;
    expect(st[0]).toBeCloseTo(0.25, 6);
    expect(st[1]).toBeCloseTo(0.4, 6);
    expect(st[2]).toBe(1);
    expect(st[3]).toBeCloseTo(store.seed[i], 6);
    teardown(bridge);
  });
});

describe('RenderBridge — sockets', () => {
  it('places a turret muzzle in world space, following the turret not the hull', () => {
    const { store, scene, bridge } = makeRig();
    registerKindMesh(EntityKind.Vehicle, FACTION_ANY, {
      geometry: new THREE.BoxGeometry(3, 1, 6),
      material: new THREE.MeshStandardMaterial(),
      turretPivotY: 1.5,
      sockets: [{ part: PartId.MuzzleA, x: 0, y: 1.5, z: 3, followsTurret: true }],
    });

    const id = store.alloc(EntityKind.Vehicle, -1, P0, Faction.Allies, 100, 0, 100, 0);
    const i = store.index(id);
    // Hull faces +Z, turret faces +X. The muzzle must follow the TURRET.
    store.yaw[i] = 0;
    store.turretYaw[i] = Math.PI / 2;
    store.snapshotPrev();
    bridge.update(1);

    const out = new Float32Array(7);
    expect(bridge.socketWorld(id, PartId.MuzzleA, out)).toBe(true);
    expect(out[0]).toBeCloseTo(103, 5);  // 3 m out along +X
    expect(out[1]).toBeCloseTo(1.5, 5);
    expect(out[2]).toBeCloseTo(100, 5);
    expect(out[3]).toBeCloseTo(1, 5);    // forward is +X
    expect(out[5]).toBeCloseTo(0, 5);
    teardown(bridge);
  });

  it('swings an elevated muzzle about the trunnion, not the model origin', () => {
    const { store, scene, bridge } = makeRig();
    registerKindMesh(EntityKind.Vehicle, FACTION_ANY, {
      geometry: new THREE.BoxGeometry(3, 1, 6),
      material: new THREE.MeshStandardMaterial(),
      turretPivotY: 1.5,
      sockets: [{ part: PartId.MuzzleA, x: 0, y: 1.5, z: 4, followsTurret: true }],
    });
    const id = store.alloc(EntityKind.Vehicle, -1, P0, Faction.Allies, 0, 0, 0, 0);
    const i = store.index(id);
    store.barrelPitch[i] = Math.PI / 6;  // 30 degrees of ELEVATION
    store.snapshotPrev();
    bridge.update(1);

    const out = new Float32Array(7);
    bridge.socketWorld(id, PartId.MuzzleA, out);
    // Positive pitch must RAISE the muzzle, and the pivot keeps it 4 m from the
    // ring rather than 4 m from the model origin.
    expect(out[1]).toBeCloseTo(1.5 + 4 * Math.sin(Math.PI / 6), 5);
    expect(out[2]).toBeCloseTo(4 * Math.cos(Math.PI / 6), 5);
    expect(out[4]).toBeCloseTo(Math.sin(Math.PI / 6), 5);
    teardown(bridge);
  });

  it('refuses a stale handle and an unknown socket', () => {
    const { store, bridge } = makeRig();
    const id = store.alloc(EntityKind.Vehicle, -1, P0, Faction.Allies, 0, 0, 0, 0);
    store.snapshotPrev();
    bridge.update(1);

    const out = new Float32Array(7);
    // The placeholder model has no sockets at all.
    expect(bridge.socketWorld(id, PartId.MuzzleA, out)).toBe(false);

    store.markDead(id);
    store.flushDestroyed();
    bridge.update(1);
    expect(bridge.socketWorld(id, PartId.MuzzleA, out)).toBe(false);
    expect(bridge.entityWorld(id, out)).toBe(false);
    teardown(bridge);
  });
});

describe('RenderBridge — late-arriving art replaces the placeholder', () => {
  it('rebinds live entities when a model is registered mid-match', () => {
    const { store, scene, bridge } = makeRig();
    store.alloc(EntityKind.Vehicle, -1, P0, Faction.Allies, 12, 0, 12, 0);
    store.snapshotPrev();
    bridge.update(1);
    expect(meshes(scene)[0].name.startsWith('placeholder')).toBe(true);

    registerKindMesh(EntityKind.Vehicle, Faction.Allies, {
      geometry: new THREE.BoxGeometry(3.4, 2.5, 7),
      material: new THREE.MeshStandardMaterial(),
    });
    bridge.update(1);

    const live = meshes(scene).filter((m) => m.count > 0);
    expect(live.length).toBe(1);
    expect(live[0].name.startsWith('placeholder')).toBe(false);
    expect(translation(live[0], 0)).toEqual([12, 0, 12]);
    teardown(bridge);
  });
});

/* ==========================================================================
 * FOG OF WAR IS NOT A SIMULATION FLAG
 *
 * The bridge used to skip anything carrying `EntityFlag.Cloaked`, and fog of
 * war exploited that by setting the flag on whatever the local player could not
 * see and putting it back before the next sim step. `Targeting`, `Combat` and
 * `Selection` read the same bit, so one missed restore produced a unit that was
 * invisible AND un-acquirable AND un-shootable AND un-clickable, permanently.
 *
 * Render visibility now arrives through `RenderBridge.visibility`, which is
 * render-owned state. These tests pin both halves of that: the mask decides
 * what is drawn, and the flag no longer does.
 * ========================================================================== */
describe('RenderBridge — render visibility mask', () => {
  it('draws everything when no mask is attached', () => {
    const { store, scene, bridge } = makeRig();
    store.alloc(EntityKind.Vehicle, -1, P0, Faction.Allies, 10, 0, 10, 0);
    store.alloc(EntityKind.Vehicle, -1, P0, Faction.Allies, 20, 0, 20, 0);
    store.snapshotPrev();
    bridge.update(1);
    expect(bridge.visibleUnits).toBe(2);
    teardown(bridge);
  });

  it('skips exactly the slots the mask hides, and nothing else', () => {
    const { store, scene, bridge } = makeRig();
    const a = store.alloc(EntityKind.Vehicle, -1, P0, Faction.Allies, 10, 0, 10, 0);
    store.alloc(EntityKind.Vehicle, -1, P0, Faction.Allies, 20, 0, 20, 0);
    store.snapshotPrev();

    const hidden = new Set<number>([store.index(a)]);
    bridge.visibility = { isRenderHiddenAt: (i) => hidden.has(i) };

    bridge.update(1);
    expect(bridge.visibleUnits).toBe(1);
    expect(bridge.isRendered(a)).toBe(false);

    // And it is a per-frame decision, not a state change: unhide, redraw.
    hidden.clear();
    bridge.update(1);
    expect(bridge.visibleUnits).toBe(2);
    expect(bridge.isRendered(a)).toBe(true);
    teardown(bridge);
  });

  it('no longer hides an entity for carrying EntityFlag.Cloaked', () => {
    const { store, scene, bridge } = makeRig();
    // Your own submarine: genuinely cloaked in the simulation, and yours to see.
    const sub = store.alloc(EntityKind.Vehicle, -1, P0, Faction.Allies, 10, 0, 10, 0);
    store.flags[store.index(sub)] |= EntityFlag.Cloaked;
    store.snapshotPrev();
    bridge.update(1);
    expect(bridge.isRendered(sub)).toBe(true);
    teardown(bridge);
  });

  it('still hides a garrisoned passenger, which IS simulation state', () => {
    const { store, scene, bridge } = makeRig();
    const rider = store.alloc(EntityKind.Infantry, -1, P0, Faction.Allies, 10, 0, 10, 0);
    store.flags[store.index(rider)] |= EntityFlag.Garrisoned;
    store.snapshotPrev();
    bridge.update(1);
    expect(bridge.isRendered(rider)).toBe(false);
    teardown(bridge);
  });

  it('drops the mask on dispose so a dead fog module cannot hide anything', () => {
    const { store, scene, bridge } = makeRig();
    store.alloc(EntityKind.Vehicle, -1, P0, Faction.Allies, 10, 0, 10, 0);
    bridge.visibility = { isRenderHiddenAt: () => true };
    bridge.dispose();
    expect(bridge.visibility).toBe(null);
    clearKindMeshes();
    setRenderBridge(null);
    void scene;
  });
});
