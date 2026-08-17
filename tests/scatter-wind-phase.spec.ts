/**
 * ============================================================================
 * VOLTMARCH — tests/scatter-wind-phase.spec.ts
 * ============================================================================
 * `aSwayPhase`: the per-instance wind phase `Scatter` publishes for the node
 * path, and the ONE deliberate hole Stage D left in `PropNodeMaterial.ts`.
 *
 * WHY IT NEEDS ITS OWN GATE. The shipping WebGL material does not read this
 * attribute — it takes the phase off `instanceMatrix[3]`, which a TSL node
 * material cannot reach — so the column is INERT on the renderer everything else
 * here verifies. `npm run shots` cannot see it. `tests/scatter.spec.ts` does not
 * look at it. Until the cutover, these assertions are the only thing standing
 * between a wrong phase and a forest that sways in step on WebGPU.
 *
 * THE FAILURE IT IS WRITTEN AGAINST IS NOT "MISSING". A missing attribute is
 * loud: `attribute()` warns and substitutes and the console names it. The
 * dangerous one is a phase that is PRESENT and wrong — packed against the wrong
 * cursor, computed from the pre-sort placement order, or left behind when a
 * camera pan repacks the visible chunk set. Every one of those renders a forest
 * that looks plausible and matches nothing, which is exactly why Stage D refused
 * to substitute `instanceIndex` for it.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { Terrain } from '../src/world/Terrain';
import { Scatter } from '../src/world/Scatter';
import { PROP_WIND, PROP_WIND_PHASE_ATTRIBUTE } from '../src/world/prop-wind';

function rig(): { scene: THREE.Scene; scatter: Scatter } {
  const scene = new THREE.Scene();
  const terrain = new Terrain({ scene, seed: 0x7e44a1, biome: 'temperate', anisotropy: 1 });
  const scatter = new Scatter({
    scene, terrain, biome: 'temperate', seed: 0x5ca77e, urban: 0.2, densityScale: 1,
    preferred: ['tree', 'bush', 'rock'],
  });
  scatter.generate();
  return { scene, scatter };
}

/** Every `InstancedMesh` the scatter mounted, with its phase attribute. */
function meshes(scene: THREE.Scene): THREE.InstancedMesh[] {
  const out: THREE.InstancedMesh[] = [];
  scene.traverse((o) => {
    const m = o as THREE.InstancedMesh;
    if (m.isInstancedMesh === true && m.name.startsWith('prop.')) out.push(m);
  });
  return out;
}

/**
 * A camera that sees the whole map, so `update()` marks every chunk visible and
 * the repack copies every live instance rather than a corner of them.
 */
function wideCamera(): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(60, 1.6, 1, 4000);
  cam.position.set(256, 900, 256);
  cam.lookAt(256, 0, 256);
  cam.updateMatrixWorld();
  cam.updateProjectionMatrix();
  return cam;
}

describe('the scatter publishes a real per-instance wind phase', () => {
  it('gives every prop mesh an aSwayPhase attribute sized to its population', () => {
    const { scene, scatter } = rig();
    const list = meshes(scene);
    expect(list.length, 'the scatter mounted no prop meshes at all').toBeGreaterThan(3);

    for (const mesh of list) {
      const attr = mesh.geometry.getAttribute(PROP_WIND_PHASE_ATTRIBUTE);
      expect(attr, `${mesh.name} has no ${PROP_WIND_PHASE_ATTRIBUTE}`).toBeTruthy();
      expect(attr.itemSize).toBe(1);
      /*
       * The instanced attribute is sized by the instance count, NOT the vertex
       * count, and getting that wrong is the one mistake here that reads past the
       * end of a buffer. `InstancedMesh.count` is the DRAW count and moves with
       * culling; the allocation is the type's full population, which is what
       * `instanceMatrix` is allocated at too.
       */
      expect((attr as THREE.InstancedBufferAttribute).isInstancedBufferAttribute).toBe(true);
      expect(attr.count).toBe(mesh.instanceMatrix.count);
    }
    scatter.dispose();
  });

  it('matches the phase the shipping GLSL derives from instanceMatrix[3]', () => {
    /*
     * THE ASSERTION THE WHOLE FILE EXISTS FOR. `PropLibrary.WIND_BODY` computes
     *
     *     swayPhase = instanceMatrix[3].x * phaseX + instanceMatrix[3].z * phaseZ
     *
     * in the shader, and this column is the same number precomputed. If they ever
     * disagree, the WebGL build and the WebGPU build sway the same tree at two
     * different moments — a difference no scorecard measures and no test outside
     * this file would notice.
     *
     * Read off the UPLOADED buffers after a repack, not off the private source
     * arrays: the repack is where a cursor bug would land, and it is the data the
     * GPU actually sees.
     */
    const { scene, scatter } = rig();
    scatter.update(wideCamera(), 0);

    let checked = 0;
    for (const mesh of meshes(scene)) {
      const phase = mesh.geometry.getAttribute(PROP_WIND_PHASE_ATTRIBUTE);
      const m = mesh.instanceMatrix.array as Float32Array;
      for (let i = 0; i < mesh.count; i++) {
        // Column-major: 12 and 14 are the translation's X and Z.
        const want = m[i * 16 + 12] * PROP_WIND.phaseX + m[i * 16 + 14] * PROP_WIND.phaseZ;
        expect(phase.getX(i), `${mesh.name} instance ${i}`).toBeCloseTo(want, 4);
        checked++;
      }
    }
    expect(checked, 'no visible instances, so the comparison proved nothing')
      .toBeGreaterThan(200);
    scatter.dispose();
  });

  it('is not a constant, so the forest does not sway in step', () => {
    /*
     * The control, and the exact defect this attribute was added to fix: Stage D
     * shipped with nothing publishing the name, `attribute()` substituted, every
     * prop took phase 0 and the whole map moved as one. An all-zero column would
     * pass the equality test above on any mesh standing at the origin, so the
     * spread is asserted separately.
     */
    const { scene, scatter } = rig();
    scatter.update(wideCamera(), 0);

    const seen = new Set<number>();
    let total = 0;
    for (const mesh of meshes(scene)) {
      const phase = mesh.geometry.getAttribute(PROP_WIND_PHASE_ATTRIBUTE);
      for (let i = 0; i < mesh.count; i++) {
        seen.add(Math.round(phase.getX(i) * 1000));
        total++;
      }
    }
    expect(total).toBeGreaterThan(200);
    // Two irrational-looking coefficients over a 512 m map: distinct phases
    // should be almost as numerous as the props themselves.
    expect(seen.size / total).toBeGreaterThan(0.8);
    scatter.dispose();
  });

  it('stays in step with the matrix through a repack, not just after generate', () => {
    /*
     * `update()` repacks the visible chunk set into the head of the buffers with
     * one shared cursor, and the phase rides that cursor. A phase copied with its
     * own index — or not copied at all — leaves instance k holding another prop's
     * phase the moment the camera crosses a 32 m chunk boundary, which is a
     * defect that only appears while panning and never in a still capture.
     *
     * So: fill the buffers from a wide camera, then repack from a tight one, and
     * re-check the invariant against the matrix that came with it.
     */
    const { scene, scatter } = rig();
    scatter.update(wideCamera(), 0);

    const tight = new THREE.PerspectiveCamera(35, 1.6, 1, 400);
    tight.position.set(140, 60, 140);
    tight.lookAt(200, 0, 200);
    tight.updateMatrixWorld();
    tight.updateProjectionMatrix();
    scatter.update(tight, 1.5);

    let checked = 0;
    let moved = false;
    for (const mesh of meshes(scene)) {
      const phase = mesh.geometry.getAttribute(PROP_WIND_PHASE_ATTRIBUTE);
      const m = mesh.instanceMatrix.array as Float32Array;
      if (mesh.count < phase.count) moved = true;
      for (let i = 0; i < mesh.count; i++) {
        const want = m[i * 16 + 12] * PROP_WIND.phaseX + m[i * 16 + 14] * PROP_WIND.phaseZ;
        expect(phase.getX(i), `${mesh.name} instance ${i} after repack`).toBeCloseTo(want, 4);
        checked++;
      }
    }
    expect(checked, 'the tight camera saw nothing, so the repack was never exercised')
      .toBeGreaterThan(20);
    expect(moved, 'the second camera culled nothing, so no repack happened').toBe(true);
    scatter.dispose();
  });

  it('queues the phase upload alongside the matrix and the colour', () => {
    /*
     * `markRange` is what turns a written buffer into a `bufferSubData`. A column
     * repacked and never marked is correct in memory and stale on the GPU —
     * invisible in every assertion above, because they all read the CPU side.
     */
    const { scene, scatter } = rig();
    scatter.update(wideCamera(), 0);

    let marked = 0;
    for (const mesh of meshes(scene)) {
      const phase = mesh.geometry.getAttribute(
        PROP_WIND_PHASE_ATTRIBUTE,
      ) as THREE.InstancedBufferAttribute;
      if (mesh.count === 0) continue;
      expect(phase.updateRanges.length, `${mesh.name} queued no phase upload`).toBe(1);
      expect(phase.updateRanges[0].start).toBe(0);
      expect(phase.updateRanges[0].count).toBe(mesh.count);
      // And it is the SAME shape the matrix queued, scaled by the item size.
      expect(mesh.instanceMatrix.updateRanges[0].count).toBe(mesh.count * 16);
      marked++;
    }
    expect(marked).toBeGreaterThan(3);
    scatter.dispose();
  });
});

describe('the wind phase constant lives where both bundles can reach it', () => {
  it('is exported from prop-wind.ts, which imports no node system', () => {
    /*
     * `Scatter` is in the main bundle. If this name lived in
     * `PropNodeMaterial.ts` — where Stage D put it — importing it would pull
     * `three/webgpu` into the WebGL build for a renderer those players never run.
     * The name is asserted rather than the import graph because
     * `tests/render-backend.spec.ts` already owns the graph; this is the pointer
     * that says why it moved.
     */
    expect(PROP_WIND_PHASE_ATTRIBUTE).toBe('aSwayPhase');
  });
});
