/**
 * ============================================================================
 * VOLTMARCH — src/render/ContactShadows.ts
 * ============================================================================
 * THE DARK POOL UNDER EVERY UNIT AND STRUCTURE.
 *
 * `docs/RA3_LOOK_BIBLE.md` §3.3 asks for it in one sentence — "units without
 * this float" — and calls it one of the highest-value cheap wins on the board.
 * Scorecard #13 has been a straight fail for the life of the project, and the
 * config block it needed (`CONTACT_DARKEN_*` in core/config.ts) was authored
 * with a comment pointing at THIS FILE while this file did not exist.
 *
 * WHY IT IS NOT THE CAST SHADOW. The sun's shadow map already puts a shadow
 * somewhere — but it is DIRECTIONAL, so at the shipped sun elevation it lands
 * offset from the hull, and at the shipped `shadowSoftness` its edge is several
 * pixels of gradient. Neither says "this object is resting on that ground".
 * Contact darkening is the ambient-occlusion half of the same idea: a small,
 * hard, centred pool that does not move with the sun, and it is what makes the
 * difference between a tank ON the grass and a tank hovering a metre above it.
 *
 * WHY IT IS NOT IN `world/Decals.ts`. That field is a ring buffer of transient
 * marks — treads, scorches, craters — and its slots are recycled by age. A
 * permanent per-entity pool put in there would be evicted by the first busy
 * firefight, and worse, it would be evicted UNPREDICTABLY, so units would start
 * floating in exactly the frames with the most going on. It also conforms each
 * decal with a 4x4 grid of `heightAt` samples taken ONCE at spawn, which is
 * correct for a mark that never moves and wrong for one that follows a hull.
 *
 * SO: one `InstancedMesh` of single quads, rewritten every frame from the live
 * entity list. One draw call. A contact pool is 2-6 m across, which is small
 * enough that one quad tilted to the ground normal reads as conformed — the 4x4
 * grid exists for long tread strips crossing real relief, and buys nothing at
 * this footprint.
 *
 * THE BLEND IS A MULTIPLY, copied deliberately from `Decals.ts` and for its
 * stated reason: src is a FACTOR, dst is the lit frame. `uFloor` bounds it so a
 * pool can never take the ground below `DECAL_DARKEN_FLOOR` of its albedo,
 * which is what keeps §3.3's "shadowed surfaces keep 20-52% per channel" true
 * where a pool lands on ground the sun has already lost.
 * ============================================================================
 */

import * as THREE from 'three';

import {
  CONTACT_DARKEN_CAPACITY, CONTACT_DARKEN_COLOR, CONTACT_DARKEN_CORE,
  CONTACT_DARKEN_LIFT, CONTACT_DARKEN_MIN_FOOTPRINT, CONTACT_DARKEN_PEAK_ALPHA,
  CONTACT_DARKEN_RADIUS_SCALE, DECAL_DARKEN_FLOOR, GROUND_OVERLAY_DEPTH_BIAS_FACTOR,
  GROUND_OVERLAY_DEPTH_BIAS_UNITS,
} from '../core/config';
import { EntityFlag, EntityKind } from '../core/types';
import type { World } from '../core/world';
import { applyShroudFactor } from './FogOfWar';
import { nodePath } from './gpu-path';

/* ==========================================================================
 * SHADER
 *
 * The falloff is COMPUTED, not sampled. A texture would need an atlas slot, a
 * mip chain and a fetch per fragment to deliver a radial gradient that two
 * lines of GLSL produce exactly — and "all art is generated from code" makes a
 * loaded one a non-starter anyway.
 * ========================================================================== */

const CONTACT_VERT = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  #include <begin_vertex>
  #include <project_vertex>
}
`;

const CONTACT_FRAG = /* glsl */`
precision highp float;
uniform vec3 uColor;
uniform float uPeak;
uniform float uCore;
uniform float uFloor;
varying vec2 vUv;

void main() {
  // Radial distance from the quad centre, 0..1 at the inscribed circle.
  float r = length(vUv - 0.5) * 2.0;
  // Held at full strength inside the core, then eased out. The darkest part of
  // a real contact shadow is the part the object is standing on, so a pool that
  // ramps from the very centre reads as a soft grey disc instead.
  float a = 1.0 - smoothstep(uCore, 1.0, r);
  if (a <= 0.0) discard;
  float k = a * uPeak;
  // A FACTOR, not a paint. mix toward the pool colour, then clamp so a single
  // pool can never take the ground below the shared decal floor.
  vec3 f = mix(vec3(1.0), uColor, k);
  gl_FragColor = vec4(max(f, vec3(uFloor)), 1.0);
  #include <tonemapping_fragment>
}
`;

/* ==========================================================================
 * THE FIELD
 * ========================================================================== */

/** Scratch, allocated once. Nothing in `update` may allocate. */
const MAT = new THREE.Matrix4();
const POS = new THREE.Vector3();
const QUAT = new THREE.Quaternion();
const SCL = new THREE.Vector3();
const NORMAL = new THREE.Vector3();
const FLAT = new THREE.Vector3(0, 1, 0);

/**
 * Entities that get a pool.
 *
 * Infantry, vehicles and buildings — the things that stand ON the ground and
 * are expected to be attached to it. Deliberately NOT aircraft (they are
 * genuinely airborne and a pool under one is a lie), not projectiles, and not
 * props: the scatter carpet is thousands of instances and its own art already
 * carries baked AO at the base.
 */
function wantsPool(kind: number, flags: number): boolean {
  if ((flags & EntityFlag.Alive) === 0) return false;
  if ((flags & (EntityFlag.PendingDestroy | EntityFlag.Garrisoned)) !== 0) return false;
  return kind === EntityKind.Infantry || kind === EntityKind.Vehicle
    || kind === EntityKind.Building;
}

export class ContactShadowField {
  readonly mesh: THREE.InstancedMesh;
  private readonly material: THREE.Material;
  private readonly geometry: THREE.PlaneGeometry;
  private capacity: number;

  constructor(private readonly heightAt: (x: number, z: number) => number) {
    // A unit quad in the XZ plane. `PlaneGeometry` is XY, so it is rotated once
    // here rather than per instance.
    this.geometry = new THREE.PlaneGeometry(1, 1);
    this.geometry.rotateX(-Math.PI / 2);

    /*
     * `ShaderMaterial` IS NOT IN `StandardNodeLibrary`. Under `WebGPURenderer`
     * this would draw through a bare `NodeMaterial` into a `(DstColor, Zero)`
     * blend — a hard black square under every unit and building.
     * `render/ground-overlay-nodes.ts` is the twin, and it carries the same
     * shroud self-tint from the same declaration.
     */
    const np = nodePath();
    const glsl = np !== null ? null : new THREE.ShaderMaterial({
      name: 'ContactShadows',
      uniforms: {
        uColor: { value: new THREE.Color(CONTACT_DARKEN_COLOR) },
        uPeak: { value: CONTACT_DARKEN_PEAK_ALPHA },
        uCore: { value: CONTACT_DARKEN_CORE },
        uFloor: { value: DECAL_DARKEN_FLOOR },
      },
      vertexShader: CONTACT_VERT,
      fragmentShader: CONTACT_FRAG,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      side: THREE.FrontSide,
      toneMapped: false,
      fog: false,
      // The identical multiply contract `Decals.ts` documents at length. Alpha
      // is left alone so a pool can never punch a hole in a target carrying
      // coverage.
      blending: THREE.CustomBlending,
      blendSrc: THREE.DstColorFactor,
      blendDst: THREE.ZeroFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
      polygonOffset: true,
      polygonOffsetFactor: GROUND_OVERLAY_DEPTH_BIAS_FACTOR,
      polygonOffsetUnits: GROUND_OVERLAY_DEPTH_BIAS_UNITS,
    });
    if (glsl !== null) {
      // This shader emits a MULTIPLY FACTOR, whose neutral fog value is white.
      // Applying a colour tint here darkens fog instead of hiding the pool.
      glsl.onBeforeCompile = (shader) => { applyShroudFactor(shader); };
      glsl.customProgramCacheKey = () => 'vm.contact.shroud-factor.v2';
    }
    this.material = glsl ?? np!.createContactShadowMaterial();

    this.capacity = CONTACT_DARKEN_CAPACITY;
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, this.capacity);
    this.mesh.name = 'ContactShadows';
    this.mesh.count = 0;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  }

  /**
   * Rewrite every pool from the live entity list.
   *
   * O(alive), one pass, no allocation. The whole set is rewritten rather than
   * diffed because a pool follows a moving hull: at 200 units the diff would
   * touch nearly every slot anyway and would cost a per-entity cache to find
   * out.
   */
  update(world: World): void {
    const st = world.store;
    const n = st.aliveCount;
    let w = 0;

    for (let a = 0; a < n; a++) {
      const i = st.alive[a];
      if (!wantsPool(st.kind[i], st.flags[i])) continue;

      // Footprint LONG AXIS, not the collision radius: a 3x2 refinery needs a
      // pool that covers the building, and `radius` on a structure is the
      // circumscribing circle of its centre cell only.
      const fw = st.footprintW[i];
      const fh = st.footprintH[i];
      const foot = fw > 0 || fh > 0
        ? Math.max(fw, fh) * 4 /* CELL */
        : st.radius[i] * 2;
      if (foot < CONTACT_DARKEN_MIN_FOOTPRINT) continue;
      if (w >= this.capacity) break;

      const x = st.posX[i];
      const z = st.posZ[i];
      const d = foot * CONTACT_DARKEN_RADIUS_SCALE * 2;

      /* CONFORMED BY NORMAL, NOT BY A GRID. Four height samples around the pool
       * give the local slope; tilting the quad to it keeps the rim in contact
       * on a hillside, which is the case a flat quad fails and the case that
       * makes an object look like it is hovering. The samples are at the pool's
       * own radius, so the tilt matches the ground the pool actually covers
       * rather than the ground at a fixed probe distance. */
      const r = d * 0.5;
      const hC = this.heightAt(x, z);
      const hL = this.heightAt(x - r, z);
      const hR = this.heightAt(x + r, z);
      const hD = this.heightAt(x, z - r);
      const hU = this.heightAt(x, z + r);
      NORMAL.set(hL - hR, 2 * r, hD - hU).normalize();

      POS.set(x, hC + CONTACT_DARKEN_LIFT, z);
      QUAT.setFromUnitVectors(FLAT, NORMAL);
      SCL.set(d, 1, d);
      MAT.compose(POS, QUAT, SCL);
      this.mesh.setMatrixAt(w, MAT);
      w++;
    }

    this.mesh.count = w;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}
