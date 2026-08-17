/**
 * ============================================================================
 * VOLTMARCH — src/vfx/Beams.ts
 * ============================================================================
 * TESLA ARCS AND ENERGY BEAMS, plus the screen-width ribbon renderer they and
 * `Tracers.ts` both draw through.
 *
 * WHY A RIBBON RENDERER AT ALL
 * ----------------------------
 * Every width in bible §8.3/§8.4/§8.5 is quoted in PIXELS: "core filament 2–3
 * px at L ≥ 248", "prism white core 3.5 px, inner cyan band 33 px, outer halo
 * 64 px", "MG tracers 25–65 px long × 2.5–4 px". Scorecard #30 measures the
 * tesla core in pixels off a 2560×1440 screenshot. A world-space tube cannot
 * hold a pixel width across a 2.25× zoom range, and `THREE.Line`'s `linewidth`
 * is ignored by every WebGL driver.
 *
 * So a stroke is expanded to a camera-facing quad IN THE VERTEX SHADER, offset
 * along the screen-space perpendicular of its own tangent by
 * `widthPx * 0.5 * uPxScale * viewDepth`. With
 * `uPxScale = 2·tan(fovY/2) / 1440` the conversion is independent of the actual
 * render height, so "3 px" is exactly 3 px when the critic screenshots at
 * 1440p and keeps its apparent size at 1080p or 4K instead of scaling with the
 * framebuffer. That is the whole trick and everything else here is content.
 *
 * WHY EACH SEGMENT IS FOUR INDEPENDENT VERTICES
 * ---------------------------------------------
 * Sharing vertices between segments means one static index buffer, but it also
 * means quad q always bridges verts 2q..2q+3 — so the end of one bolt would be
 * stitched to the start of the next. Four verts per segment keeps every stroke
 * isolated, lets the index buffer stay static, and the miter gap at a sharp
 * tesla bend is closed by extending each quad half a width along its own
 * tangent. Under additive blending the overlap is free.
 *
 * A TESLA BOLT IS NOT ONE LINE
 * ----------------------------
 * Bible §8.3, and it is the single most recognisable RA3 effect:
 *   - 3–5 OVERLAPPING independently jittered copies of the same path;
 *   - 4–8 branches, ~30% of which REJOIN the trunk to form visible closed
 *     loops (scorecard #30 requires ≥1 loop per bolt, and the count is logged);
 *   - the whole path re-rolled every 50 ms while the beam is up;
 *   - `depthTest: false`, because RA3 bolts draw over ships and terrain alike.
 * ============================================================================
 */

import * as THREE from 'three';
import { nodePath } from '../render/gpu-path';

import {
  VFX_BEAM,
  VFX_GLARE,
  VFX_LIGHTS,
  VFX_MAX_BEAMS,
  VFX_MAX_BOLTS,
  VFX_MAX_TRACERS,
  VFX_PX_REFERENCE_HEIGHT,
  VFX_RAMP,
  VFX_RIBBON_VERTS,
  VFX_TESLA,
  VFX_TILE,
} from '../core/config';
import { NONE, PartId } from '../core/types';
import type { EntityId } from '../core/types';
import { presentationRng } from '../core/math';
import { entityWorld, socketWorld } from '../render/RenderBridge';
import { RENDER_ORDER } from '../render/scene';

import {
  NO_LIGHT, moveLight, releaseLight, spawnLight,
  type LightEnvelope, type LightHandle,
} from './LightPool';
import { emitAdditive, resetEmit } from './Particles';
import { admitGlare } from './FlashBudget';
// Shared with the TSL twin in `./vfx-node-materials.ts` — see that file's header.
import {
  RIBBON_DEFAULT_FOV_DEG, VFX_ALPHA_CUTOFF, ribbonPxScale,
} from './vfx-material-constants';

/**
 * Sustained-light envelopes, built ONCE at module load.
 *
 * `{ ...VFX_LIGHTS.beam, holdMs: Infinity }` at the call site would allocate a
 * fresh object on every shot — the exact per-spawn garbage the performance
 * contract bans. `holdMs: Infinity` means "burn until `release()`", which for a
 * beam is when the beam ends.
 */
const TESLA_BEAM_LIGHT: LightEnvelope = { ...VFX_LIGHTS.teslaArc, holdMs: Infinity };
const PRISM_BEAM_LIGHT: LightEnvelope = { ...VFX_LIGHTS.prism, holdMs: Infinity };

/* ==========================================================================
 * 1. RIBBON BATCH — pixel-width strokes, one draw call
 * ========================================================================== */

const RIBBON_VERT = /* glsl */ `
precision highp float;

attribute vec3 aDir;      // spine tangent, world space
attribute vec4 aParam;    // side(-1/+1), widthPx, extendPx, falloffExp
attribute vec4 aRamp;     // rampRow, rampT, hdrIntensity, alpha

uniform float uPxScale;   // 2 * tan(fovY/2) / 1440

varying float vSide;
varying float vFall;
varying vec4  vRamp;

void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vec3 tv = (modelViewMatrix * vec4(aDir, 0.0)).xyz;

  // Screen-space tangent. When the stroke points almost straight at the camera
  // the projection collapses; fall back to a fixed axis so the quad degenerates
  // gracefully instead of exploding to NaN.
  vec2 t2 = tv.xy;
  float l = length(t2);
  vec2 tan2 = (l > 1e-5) ? t2 / l : vec2(1.0, 0.0);
  vec2 perp = vec2(-tan2.y, tan2.x);

  float depth = max(-mv.z, 0.1);
  float mpp = uPxScale * depth;              // metres per reference pixel

  mv.xy += perp * (aParam.x * aParam.y * 0.5 * mpp);
  mv.xy += tan2 * (aParam.z * mpp);

  gl_Position = projectionMatrix * mv;
  vSide = aParam.x;
  vFall = aParam.w;
  vRamp = aRamp;
}
`;

const RIBBON_FRAG = /* glsl */ `
precision highp float;

uniform sampler2D uRamp;
uniform float uRowStep;

varying float vSide;
varying float vFall;
varying vec4  vRamp;

void main() {
  // Cross-section profile. A near-flat exponent gives the hard filament core
  // that must clip to white; a high one gives the soft ±20-40 px glow.
  float cs = pow(max(0.0, 1.0 - abs(vSide)), vFall);
  vec4 ramp = texture2D(uRamp, vec2(vRamp.y, (vRamp.x + 0.5) * uRowStep));
  float a = ramp.a * vRamp.w * cs;
  if (a <= ${VFX_ALPHA_CUTOFF.toFixed(3)}) discard;
  vec3 col = ramp.rgb * vRamp.z;
  gl_FragColor = vec4(col * a, a);   // premultiplied additive
}
`;

/**
 * A pool of camera-facing quads whose width is specified in reference pixels.
 * Rebuilt from scratch every frame — beams and tesla paths change completely
 * between frames anyway, so there is nothing to preserve.
 */
export class RibbonBatch {
  readonly mesh: THREE.Mesh;
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.Material;
  readonly maxQuads: number;

  /**
   * THE ACCESSOR STAGE E ASKED FOR, and the whole of `VFX_NODE_CUTOVER_NOTES`
   * #2. This class reached through `material.uniforms.uPxScale` in two places —
   * `setFov` here and `BeamSystem.pxToMetres` — and a node material has no
   * `uniforms` map at all. `VfxRibbonNodeSet` publishes `setFov` and `pxScale`
   * for exactly those two callers; this pair is where the batch stops caring
   * which kind it holds.
   */
  private readonly writeFov: (fovDeg: number) => void;
  private readonly readPxScale: () => number;

  /** `2 * tan(fovY/2) / 1440`, live. `BeamSystem.pxToMetres` is the caller. */
  get pxScale(): number { return this.readPxScale(); }

  private readonly pos: Float32Array;
  private readonly dir: Float32Array;
  private readonly param: Float32Array;
  private readonly ramp: Float32Array;
  private readonly aPos: THREE.BufferAttribute;
  private readonly aDir: THREE.BufferAttribute;
  private readonly aParam: THREE.BufferAttribute;
  private readonly aRamp: THREE.BufferAttribute;

  /** Quads written so far this frame. */
  private quads = 0;
  /** Quads dropped because the buffer filled. Diagnostics only. */
  dropped = 0;

  /**
   * @param maxVerts Vertex ceiling. Defaults to the full `VFX_RIBBON_VERTS`
   *   budget, which the tesla/beam overlay needs (a bolt is ~450 verts). The
   *   tracer batch asks for far less: at 4 verts per quad and 2 quads per
   *   round, 320 in-flight tracers need 2560 verts, and handing it the full
   *   32 768 would waste 1.7 MB of buffers that are re-uploaded every frame.
   */
  constructor(
    rampTexture: THREE.DataTexture, rampRows: number, name: string, depthTest: boolean,
    maxVerts: number = VFX_RIBBON_VERTS,
  ) {
    this.maxQuads = Math.max(64, Math.floor(maxVerts / 4));
    const verts = this.maxQuads * 4;

    this.pos = new Float32Array(verts * 3);
    this.dir = new Float32Array(verts * 3);
    this.param = new Float32Array(verts * 4);
    this.ramp = new Float32Array(verts * 4);

    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aDir = new THREE.BufferAttribute(this.dir, 3).setUsage(THREE.DynamicDrawUsage);
    this.aParam = new THREE.BufferAttribute(this.param, 4).setUsage(THREE.DynamicDrawUsage);
    this.aRamp = new THREE.BufferAttribute(this.ramp, 4).setUsage(THREE.DynamicDrawUsage);

    // Static index pattern: quad q owns verts 4q..4q+3 laid out
    //   0 = start/left, 1 = start/right, 2 = end/left, 3 = end/right.
    const index = new Uint32Array(this.maxQuads * 6);
    for (let q = 0; q < this.maxQuads; q++) {
      const v = q * 4;
      const o = q * 6;
      index[o] = v; index[o + 1] = v + 2; index[o + 2] = v + 1;
      index[o + 3] = v + 1; index[o + 4] = v + 2; index[o + 5] = v + 3;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', this.aPos);
    geo.setAttribute('aDir', this.aDir);
    geo.setAttribute('aParam', this.aParam);
    geo.setAttribute('aRamp', this.aRamp);
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    geo.setDrawRange(0, 0);
    this.geometry = geo;

    const np = nodePath();
    const glsl = np !== null ? null : new THREE.ShaderMaterial({
      uniforms: {
        uRamp: { value: rampTexture },
        uRowStep: { value: 1 / rampRows },
        uPxScale: { value: ribbonPxScale(RIBBON_DEFAULT_FOV_DEG) },
      },
      vertexShader: RIBBON_VERT,
      fragmentShader: RIBBON_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendEquation: THREE.AddEquation,
      side: THREE.DoubleSide,
      fog: false,
    });

    if (glsl !== null) {
      glsl.name = name;
      this.material = glsl;
      this.writeFov = (fovDeg) => { glsl.uniforms.uPxScale.value = ribbonPxScale(fovDeg); };
      this.readPxScale = () => glsl.uniforms.uPxScale.value as number;
    } else {
      const set = np!.createRibbonMaterial(rampTexture, rampRows, name, depthTest);
      this.material = set.material;
      this.writeFov = (fovDeg) => set.setFov(fovDeg);
      this.readPxScale = () => set.pxScale;
    }

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.name = name;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.renderOrder = RENDER_ORDER.TRAILS;
  }

  /** Push the camera's vertical FOV so pixel widths stay honest after a zoom. */
  setFov(fovDeg: number): void {
    this.writeFov(fovDeg);
  }

  /** Start a frame. Must be paired with `end()`. */
  begin(): void {
    this.quads = 0;
  }

  /**
   * Append one straight segment.
   *
   * @param w0/@param w1 widths in reference pixels at each end (tapering).
   * @param t0/@param t1 ramp coordinate at each end.
   * @param fall cross-section falloff exponent (0.3 = hard core, 2.2 = glow).
   */
  segment(
    x0: number, y0: number, z0: number,
    x1: number, y1: number, z1: number,
    w0: number, w1: number,
    rampRow: number, t0: number, t1: number,
    intensity: number, alpha: number, fall: number,
  ): void {
    if (this.quads >= this.maxQuads) { this.dropped++; return; }
    let dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 1e-5) return;
    dx /= len; dy /= len; dz /= len;

    const q = this.quads++;
    const v = q * 4;
    const p = this.pos, d = this.dir, pa = this.param, rm = this.ramp;

    // Extend each end by half its own width so consecutive segments overlap at
    // the joint instead of leaving a wedge-shaped hole on a sharp bend.
    const e0 = -w0 * 0.5;
    const e1 = w1 * 0.5;

    for (let k = 0; k < 4; k++) {
      const i3 = (v + k) * 3;
      const i4 = (v + k) * 4;
      const atEnd = k >= 2;
      p[i3] = atEnd ? x1 : x0;
      p[i3 + 1] = atEnd ? y1 : y0;
      p[i3 + 2] = atEnd ? z1 : z0;
      d[i3] = dx; d[i3 + 1] = dy; d[i3 + 2] = dz;
      pa[i4] = (k & 1) === 0 ? -1 : 1;          // left / right
      pa[i4 + 1] = atEnd ? w1 : w0;
      pa[i4 + 2] = atEnd ? e1 : e0;
      pa[i4 + 3] = fall;
      rm[i4] = rampRow;
      rm[i4 + 1] = atEnd ? t1 : t0;
      rm[i4 + 2] = intensity;
      rm[i4 + 3] = alpha;
    }
  }

  /**
   * Append a whole polyline. `pts` is a flat xyz array; `start` is a POINT
   * index, not a float index.
   */
  stroke(
    pts: Float32Array, start: number, count: number,
    widthPx: number, rampRow: number, rampT: number,
    intensity: number, alpha: number, fall: number,
    taper = 1,
  ): void {
    for (let i = 0; i < count - 1; i++) {
      const a = (start + i) * 3;
      const b = (start + i + 1) * 3;
      const f0 = count > 1 ? i / (count - 1) : 0;
      const f1 = count > 1 ? (i + 1) / (count - 1) : 1;
      this.segment(
        pts[a], pts[a + 1], pts[a + 2],
        pts[b], pts[b + 1], pts[b + 2],
        widthPx * (1 + (taper - 1) * f0),
        widthPx * (1 + (taper - 1) * f1),
        rampRow, rampT, rampT, intensity, alpha, fall,
      );
    }
  }

  /** Publish this frame's writes. */
  end(): void {
    this.geometry.setDrawRange(0, this.quads * 6);
    // A drawRange of 0 does NOT keep three from submitting the mesh: it is
    // frustumCulled=false, so it goes into the transparent list, binds its
    // program and issues an empty indexed draw — once for the colour pass and
    // again for the GTAO normal prepass. Both ribbon batches are empty in the
    // overwhelming majority of frames (no tesla up, nothing in flight), and
    // the profiling audit named exactly this: "~10 VFX/UI meshes submitted
    // every frame while rendering 0-2 triangles".
    this.mesh.visible = this.quads > 0;
    if (this.quads === 0) return;
    const verts = this.quads * 4;
    mark(this.aPos, verts * 3);
    mark(this.aDir, verts * 3);
    mark(this.aParam, verts * 4);
    mark(this.aRamp, verts * 4);
  }

  get quadCount(): number { return this.quads; }

  dispose(): void {
    this.mesh.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}

function mark(attr: THREE.BufferAttribute, count: number): void {
  const a = attr as unknown as {
    clearUpdateRanges?: () => void;
    addUpdateRange?: (start: number, count: number) => void;
  };
  if (typeof a.clearUpdateRanges === 'function' && typeof a.addUpdateRange === 'function') {
    a.clearUpdateRanges();
    a.addUpdateRange(0, count);
  }
  attr.needsUpdate = true;
}

/**
 * Metres the beam/arc light is lifted above the midpoint of its own segment.
 *
 * Measured, and it matters more than the intensity does. An arc running 2 m off
 * the deck puts its light 2 m off the deck, so every square metre of ground
 * around it is lit at a grazing angle and N.L collapses; the same light at 26
 * candela moved from y=2.0 to y=5.0 took the median ground shift over the
 * scorecard #28 annulus from +6.3 L to the mid-thirties. Physically it is a
 * cheat (the light should be ON the bolt) and visually it is what RA3 shows:
 * a pool of colour under the arc, not a thin stripe.
 */
const BEAM_LIGHT_LIFT = 3.2;

/* ==========================================================================
 * 2. TESLA PATH GENERATION
 * ========================================================================== */

/** Points a single bolt may hold across all of its strokes. */
const MAX_BOLT_POINTS = 200;
/** Strokes (jittered trunk copies + branches) a single bolt may hold. */
const MAX_BOLT_STROKES = 20;

const STROKE_TRUNK = 0;
const STROKE_BRANCH = 1;

/** Scratch basis so path generation never allocates. */
const _axis = new THREE.Vector3();
const _u = new THREE.Vector3();
const _v = new THREE.Vector3();
const _tmp = new THREE.Vector3();

/** Build an arbitrary orthonormal basis perpendicular to `axis`. */
function perpBasis(ax: number, ay: number, az: number): void {
  _axis.set(ax, ay, az).normalize();
  // Cross with whichever world axis the bolt is least aligned to, so the basis
  // never degenerates on a vertical or horizontal shot.
  _tmp.set(Math.abs(_axis.y) < 0.9 ? 0 : 1, Math.abs(_axis.y) < 0.9 ? 1 : 0, 0);
  _u.copy(_tmp).cross(_axis).normalize();
  _v.copy(_axis).cross(_u).normalize();
}

export class TeslaBolt {
  active = false;
  ageMs = 0;
  lifeMs = 0;
  rerollTimer = 0;
  gen = 1;

  ax = 0; ay = 0; az = 0;
  bx = 0; by = 0; bz = 0;
  /** When set, endpoint A tracks this entity's socket every frame. */
  sourceId: EntityId = NONE;
  sourcePart: PartId = PartId.MuzzleA;
  /** When set, endpoint B tracks this entity's body every frame. */
  targetId: EntityId = NONE;
  targetLift = 1.2;
  sizeMul = 1;

  light: LightHandle = NO_LIGHT;
  /**
   * Glare admission, `[VFX_GLARE.floor, 1]`, resolved once at spawn.
   *
   * Exactly 1 for the first arc in a locality, so a lone Tesla Coil is
   * unchanged. See the block comment on `admitGlare` in the two spawners.
   */
  glare = 1;
  /** True once the impact starburst has fired, so it fires exactly once. */
  burst = false;

  readonly pts = new Float32Array(MAX_BOLT_POINTS * 3);
  readonly strokeStart = new Int32Array(MAX_BOLT_STROKES);
  readonly strokeLen = new Int32Array(MAX_BOLT_STROKES);
  readonly strokeKind = new Uint8Array(MAX_BOLT_STROKES);
  strokes = 0;
  pointCount = 0;

  /** Scorecard #30 evidence, recomputed on every re-roll. */
  branchCount = 0;
  loopCount = 0;

  /** Trunk vertex positions of the FIRST copy, reused as branch anchors. */
  private readonly trunk = new Float32Array(32 * 3);
  private trunkLen = 0;

  /**
   * Regenerate the whole bolt: a fractal trunk, 3–5 jittered copies of it, and
   * 4–8 branches of which ~30% rejoin to form closed loops.
   */
  reroll(): void {
    const rng = presentationRng;
    this.strokes = 0;
    this.pointCount = 0;
    this.branchCount = 0;
    this.loopCount = 0;

    const dx = this.bx - this.ax, dy = this.by - this.ay, dz = this.bz - this.az;
    const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (length < 0.05) return;
    perpBasis(dx, dy, dz);

    const segs = rng.int(VFX_TESLA.segMin, VFX_TESLA.segMax);
    const n = segs + 1;
    const amp = VFX_TESLA.jitterFrac * length;

    /* -- the trunk: midpoint displacement, 3 levels, roughness 0.55 -------- */
    this.trunkLen = n;
    this.displace(this.trunk, 0, n, amp, VFX_TESLA.displaceLevels, VFX_TESLA.roughness);

    /* -- 3–5 overlapping independently jittered copies --------------------- */
    const copies = rng.int(VFX_TESLA.strokeMin, VFX_TESLA.strokeMax);
    for (let c = 0; c < copies; c++) {
      if (this.pointCount + n > MAX_BOLT_POINTS || this.strokes >= MAX_BOLT_STROKES) break;
      const start = this.pointCount;
      // Copy 0 is the trunk verbatim; the rest wander around it by ~35%.
      const extra = c === 0 ? 0 : amp * 0.35;
      for (let i = 0; i < n; i++) {
        const s = (start + i) * 3;
        const t = i * 3;
        let ox = 0, oy = 0, oz = 0;
        if (extra > 0 && i > 0 && i < n - 1) {
          const a = rng.gauss() * extra;
          const b = rng.gauss() * extra;
          ox = _u.x * a + _v.x * b;
          oy = _u.y * a + _v.y * b;
          oz = _u.z * a + _v.z * b;
        }
        this.pts[s] = this.trunk[t] + ox;
        this.pts[s + 1] = this.trunk[t + 1] + oy;
        this.pts[s + 2] = this.trunk[t + 2] + oz;
      }
      this.pushStroke(start, n, STROKE_TRUNK);
    }

    /* -- branches ---------------------------------------------------------- */
    const wanted = rng.int(VFX_TESLA.branchMin, VFX_TESLA.branchMax);
    // Walk the trunk and roll at each interior vertex. The 0.35/vertex rate
    // from the bible under-delivers on a short 9-vertex bolt, so the loop keeps
    // sweeping until it has at least `branchMin` — scorecard #30 is a floor.
    let guard = 0;
    while (this.branchCount < wanted && guard++ < 6) {
      for (let i = 1; i < n - 2 && this.branchCount < wanted; i++) {
        if (guard === 1 && !rng.chance(VFX_TESLA.branchChance)) continue;
        if (this.strokes >= MAX_BOLT_STROKES) break;
        const bp = VFX_TESLA.branchPoints;
        if (this.pointCount + bp > MAX_BOLT_POINTS) break;

        const start = this.pointCount;
        const ax = this.trunk[i * 3], ay = this.trunk[i * 3 + 1], az = this.trunk[i * 3 + 2];

        // ~30% of branches REJOIN the trunk further along. Those closed loops
        // are the unmistakable RA3 tell and scorecard #30 wants ≥1 per bolt.
        const rejoinAt = rng.chance(VFX_TESLA.branchRejoinChance)
          ? Math.min(n - 1, i + rng.int(2, 5))
          : -1;

        let ex: number, ey: number, ez: number;
        if (rejoinAt > i) {
          ex = this.trunk[rejoinAt * 3];
          ey = this.trunk[rejoinAt * 3 + 1];
          ez = this.trunk[rejoinAt * 3 + 2];
          this.loopCount++;
        } else {
          const frac = rng.range(VFX_TESLA.branchLenFrac[0], VFX_TESLA.branchLenFrac[1]);
          const blen = length * frac * (1 - i / n);
          // Splay off the trunk direction into the perpendicular plane.
          const a = rng.gauss(), b = rng.gauss();
          const inv = 1 / Math.max(0.2, Math.hypot(a, b));
          ex = ax + (_axis.x * 0.45 + (_u.x * a + _v.x * b) * inv) * blen;
          ey = ay + (_axis.y * 0.45 + (_u.y * a + _v.y * b) * inv) * blen;
          ez = az + (_axis.z * 0.45 + (_u.z * a + _v.z * b) * inv) * blen;
        }

        // A branch is a short fractal of its own, or it reads as a straight
        // whisker glued to a jagged bolt.
        this.writeFractal(this.pts, start, bp, ax, ay, az, ex, ey, ez, amp * 0.30);
        this.pushStroke(start, bp, STROKE_BRANCH);
        this.branchCount++;
      }
    }

    // A bolt with no loop fails scorecard #30 outright. If the dice never
    // produced one, force the last branch to close.
    if (this.loopCount === 0 && this.branchCount > 0 && n > 4) {
      const s = this.strokes - 1;
      const start = this.strokeStart[s];
      const len = this.strokeLen[s];
      const j = Math.min(n - 1, Math.floor(n * 0.72));
      const e = (start + len - 1) * 3;
      this.pts[e] = this.trunk[j * 3];
      this.pts[e + 1] = this.trunk[j * 3 + 1];
      this.pts[e + 2] = this.trunk[j * 3 + 2];
      this.loopCount = 1;
    }
  }

  private pushStroke(start: number, count: number, kind: number): void {
    this.strokeStart[this.strokes] = start;
    this.strokeLen[this.strokes] = count;
    this.strokeKind[this.strokes] = kind;
    this.strokes++;
    this.pointCount = start + count;
  }

  /**
   * Midpoint displacement between the bolt's two endpoints, written straight
   * into `out` as `count` points. Three levels at roughness 0.55 is the bible's
   * recipe; each level adds a finer, weaker perpendicular offset.
   */
  private displace(out: Float32Array, start: number, count: number, amp: number, levels: number, roughness: number): void {
    this.writeFractal(out, start, count, this.ax, this.ay, this.az, this.bx, this.by, this.bz, amp, levels, roughness);
  }

  private writeFractal(
    out: Float32Array, start: number, count: number,
    x0: number, y0: number, z0: number,
    x1: number, y1: number, z1: number,
    amp: number, levels = 3, roughness = 0.55,
  ): void {
    const rng = presentationRng;
    for (let i = 0; i < count; i++) {
      const t = count > 1 ? i / (count - 1) : 0;
      const o = (start + i) * 3;
      out[o] = x0 + (x1 - x0) * t;
      out[o + 1] = y0 + (y1 - y0) * t;
      out[o + 2] = z0 + (z1 - z0) * t;
    }
    let a = amp;
    for (let lv = 0; lv < levels; lv++) {
      // Level `lv` has 2^lv independent control values; interior points get a
      // linear blend of the two nearest, which IS midpoint displacement.
      const knots = 1 << (lv + 1);
      for (let k = 0; k <= knots; k++) SCRATCH_KNOT_U[k] = rng.gauss() * a;
      for (let k = 0; k <= knots; k++) SCRATCH_KNOT_V[k] = rng.gauss() * a;
      for (let i = 1; i < count - 1; i++) {
        const t = (i / (count - 1)) * knots;
        const k0 = Math.min(knots, Math.floor(t));
        const k1 = Math.min(knots, k0 + 1);
        const f = t - k0;
        const du = SCRATCH_KNOT_U[k0] + (SCRATCH_KNOT_U[k1] - SCRATCH_KNOT_U[k0]) * f;
        const dv = SCRATCH_KNOT_V[k0] + (SCRATCH_KNOT_V[k1] - SCRATCH_KNOT_V[k0]) * f;
        // Taper to zero at both ends so the bolt stays welded to muzzle and hit.
        const w = Math.sin(Math.PI * (i / (count - 1)));
        const o = (start + i) * 3;
        out[o] += (_u.x * du + _v.x * dv) * w;
        out[o + 1] += (_u.y * du + _v.y * dv) * w;
        out[o + 2] += (_u.z * du + _v.z * dv) * w;
      }
      a *= roughness;
    }
  }
}

/** Knot scratch for the fractal. 2^(levels)+1 entries is plenty at levels ≤ 5. */
const SCRATCH_KNOT_U = new Float32Array(64);
const SCRATCH_KNOT_V = new Float32Array(64);

/* ==========================================================================
 * 3. CONTINUOUS BEAMS (prism / cryo / designator)
 * ========================================================================== */

export type BeamKind = 'prism' | 'cryo' | 'designator';

class Beam {
  active = false;
  gen = 1;
  kind: BeamKind = 'prism';
  ageMs = 0;
  lifeMs = 0;
  ax = 0; ay = 0; az = 0;
  bx = 0; by = 0; bz = 0;
  sourceId: EntityId = NONE;
  sourcePart: PartId = PartId.MuzzleA;
  targetId: EntityId = NONE;
  targetLift = 1.2;
  light: LightHandle = NO_LIGHT;
  /** See `TeslaBolt.glare`. */
  glare = 1;
}

/** Opaque handle to a live bolt or beam. */
export type BeamHandle = number;
export const NO_BEAM: BeamHandle = 0;

const H_SLOT_BITS = 10;
const H_SLOT_MASK = (1 << H_SLOT_BITS) - 1;
const H_KIND_TESLA = 1 << 20;

/* ==========================================================================
 * 4. THE BEAM SYSTEM
 * ========================================================================== */

export class BeamSystem {
  readonly root = new THREE.Group();
  /** depthTest OFF: bible §8.3 verified RA3 bolts draw over everything. */
  readonly overlay: RibbonBatch;
  /** depthTest ON: tracers must hide behind a hill. Driven by Tracers.ts. */
  readonly depthed: RibbonBatch;

  private readonly bolts: TeslaBolt[] = [];
  private readonly beams: Beam[] = [];
  private readonly _w = new Float32Array(7);

  /** Last frame's evidence for scorecard #30. */
  lastBranches = 0;
  lastLoops = 0;
  /** Metres per reference pixel at the focus depth; refreshed each frame. */
  private mppAtFocus = 0.036;

  constructor(rampTexture: THREE.DataTexture, rampRows: number) {
    this.root.name = 'VfxBeams';
    this.root.frustumCulled = false;
    this.overlay = new RibbonBatch(rampTexture, rampRows, 'VfxBeamOverlay', false);
    // Two quads per tracer (body + head), plus slack for a burst arriving in
    // the same frame the pool is already full.
    this.depthed = new RibbonBatch(
      rampTexture, rampRows, 'VfxRibbonDepth', true, VFX_MAX_TRACERS * 3 * 4,
    );
    this.depthed.mesh.renderOrder = RENDER_ORDER.PARTICLES;
    this.root.add(this.overlay.mesh);
    this.root.add(this.depthed.mesh);

    for (let i = 0; i < VFX_MAX_BOLTS; i++) this.bolts.push(new TeslaBolt());
    for (let i = 0; i < VFX_MAX_BEAMS; i++) this.beams.push(new Beam());
  }

  attach(scene: THREE.Scene): void {
    scene.add(this.root);
  }

  /**
   * Convert a reference-pixel length into metres at a given world point.
   * Effects whose SIZE the bible quotes in px (tesla starburst spikes, impact
   * streaks) resolve through here once, at spawn.
   */
  pxToMetres(px: number, viewDepth: number): number {
    return px * this.overlay.pxScale * viewDepth;
  }

  /** Nominal conversion at the camera's focus, for effects with no depth yet. */
  get metresPerPixel(): number { return this.mppAtFocus; }

  /* -- spawning ---------------------------------------------------------- */

  /**
   * A tesla arc. Endpoints may be static coordinates or may track entities:
   * pass `sourceId` to weld the origin to a muzzle socket and `targetId` to
   * weld the far end to a moving victim.
   */
  spawnTesla(
    x0: number, y0: number, z0: number,
    x1: number, y1: number, z1: number,
    durationMs: number = VFX_TESLA.defaultDurationMs,
    sourceId: EntityId = NONE, targetId: EntityId = NONE,
    sizeMul = 1,
  ): BeamHandle {
    const slot = this.freeBolt();
    if (slot < 0) return NO_BEAM;
    const b = this.bolts[slot];
    b.active = true;
    b.ageMs = 0;
    b.lifeMs = durationMs;
    b.rerollTimer = 0;
    b.ax = x0; b.ay = y0; b.az = z0;
    b.bx = x1; b.by = y1; b.bz = z1;
    b.sourceId = sourceId;
    b.sourcePart = PartId.CoilTip;
    b.targetId = targetId;
    b.sizeMul = sizeMul;
    b.burst = false;
    b.reroll();
    // Bible §8.9: a beam owns a light for as long as it is up. Placed at the
    // midpoint so the wash straddles both ends of the arc.
    b.light = spawnLight(
      (x0 + x1) * 0.5, (y0 + y1) * 0.5 + BEAM_LIGHT_LIFT, (z0 + z1) * 0.5,
      TESLA_BEAM_LIGHT, sizeMul,
    );
    /*
     * ARCS ARE NOW CHARGED TO THE GLARE BUDGET, and were not before.
     *
     * `FlashBudget` exists because "the additive layer SUMS and nothing bounded
     * the sum". Explosions were charged. Muzzle flashes were charged. Tracers
     * were charged. The two brightest additive emitters in the game — a live
     * tesla arc and a prism beam — were not, and `src/vfx/Beams.ts` did not
     * import `admitGlare` at all.
     *
     * Measured by `tools/flash-stack.mjs --ablate` once its arc sweep existed:
     * from one arc to four, the RIBBON contribution to blue-dominant frame area
     * grew 1.20pp -> 4.59pp, a factor of 3.8, while the point-light
     * contribution grew 1.37pp -> 1.83pp because lights merge and ribbons did
     * not. Four coils firing at once were four full-strength beams stacked.
     *
     * Charged at the MIDPOINT, which is where the light goes and where the two
     * halves of a 9 m arc actually overlap on screen. The first arc in a
     * locality is charged nothing and attenuated not at all, so a lone Tesla
     * Coil looks exactly as it did.
     */
    b.glare = admitGlare(
      (x0 + x1) * 0.5, (y0 + y1) * 0.5, (z0 + z1) * 0.5, VFX_GLARE.cost.arc,
    );
    return (slot & H_SLOT_MASK) | (b.gen << H_SLOT_BITS) | H_KIND_TESLA;
  }

  /** A continuous prism / cryo / designator beam. */
  spawnBeam(
    x0: number, y0: number, z0: number,
    x1: number, y1: number, z1: number,
    kind: BeamKind = 'prism',
    durationMs = -1,
    sourceId: EntityId = NONE, targetId: EntityId = NONE,
  ): BeamHandle {
    const slot = this.freeBeam();
    if (slot < 0) return NO_BEAM;
    const cfg = VFX_BEAM[kind];
    const b = this.beams[slot];
    b.active = true;
    b.kind = kind;
    b.ageMs = 0;
    b.lifeMs = durationMs > 0 ? durationMs : cfg.defaultMs;
    b.ax = x0; b.ay = y0; b.az = z0;
    b.bx = x1; b.by = y1; b.bz = z1;
    b.sourceId = sourceId;
    b.sourcePart = PartId.MuzzleA;
    b.targetId = targetId;
    b.light = spawnLight(
      (x0 + x1) * 0.5, (y0 + y1) * 0.5 + BEAM_LIGHT_LIFT, (z0 + z1) * 0.5,
      PRISM_BEAM_LIGHT, 1,
    );
    // See the note in `spawnTesla`. Prism measured the same way: ribbons
    // 1.24pp -> 4.88pp of blue frame area from one beam to four, against
    // 1.23pp -> 1.49pp for its light.
    b.glare = admitGlare(
      (x0 + x1) * 0.5, (y0 + y1) * 0.5, (z0 + z1) * 0.5, VFX_GLARE.cost.beam,
    );
    return (slot & H_SLOT_MASK) | (b.gen << H_SLOT_BITS);
  }

  /** End a beam or bolt early. Both fade out rather than popping. */
  stop(h: BeamHandle): void {
    if (h === NO_BEAM) return;
    const slot = h & H_SLOT_MASK;
    const gen = (h >>> H_SLOT_BITS) & 0x3ff;
    if ((h & H_KIND_TESLA) !== 0) {
      const b = this.bolts[slot];
      if (b === undefined || !b.active || b.gen !== gen) return;
      // Snap the remaining life to a short tail so the arc flickers out.
      b.lifeMs = Math.min(b.lifeMs, b.ageMs + 90);
    } else {
      const b = this.beams[slot];
      if (b === undefined || !b.active || b.gen !== gen) return;
      const cfg = VFX_BEAM[b.kind];
      b.lifeMs = Math.min(b.lifeMs, b.ageMs + cfg.closeMs);
    }
  }

  /** Move a live beam's far end — a designator tracking a walking target. */
  retarget(h: BeamHandle, x: number, y: number, z: number): void {
    if (h === NO_BEAM) return;
    const slot = h & H_SLOT_MASK;
    const gen = (h >>> H_SLOT_BITS) & 0x3ff;
    const b = (h & H_KIND_TESLA) !== 0 ? this.bolts[slot] : this.beams[slot];
    if (b === undefined || !b.active || b.gen !== gen) return;
    b.bx = x; b.by = y; b.bz = z;
  }

  private freeBolt(): number {
    for (let i = 0; i < this.bolts.length; i++) if (!this.bolts[i].active) return i;
    // Full: steal the oldest, which is the one closest to expiring anyway.
    let oldest = 0;
    let best = -1;
    for (let i = 0; i < this.bolts.length; i++) {
      const f = this.bolts[i].ageMs / Math.max(1, this.bolts[i].lifeMs);
      if (f > best) { best = f; oldest = i; }
    }
    this.retireBolt(oldest);
    return oldest;
  }

  private freeBeam(): number {
    for (let i = 0; i < this.beams.length; i++) if (!this.beams[i].active) return i;
    let oldest = 0;
    let best = -1;
    for (let i = 0; i < this.beams.length; i++) {
      const f = this.beams[i].ageMs / Math.max(1, this.beams[i].lifeMs);
      if (f > best) { best = f; oldest = i; }
    }
    this.retireBeam(oldest);
    return oldest;
  }

  private retireBolt(i: number): void {
    const b = this.bolts[i];
    b.active = false;
    releaseLight(b.light);
    b.light = NO_LIGHT;
    b.gen = (b.gen + 1) & 0x3ff;
    if (b.gen === 0) b.gen = 1;
  }

  private retireBeam(i: number): void {
    const b = this.beams[i];
    b.active = false;
    releaseLight(b.light);
    b.light = NO_LIGHT;
    b.gen = (b.gen + 1) & 0x3ff;
    if (b.gen === 0) b.gen = 1;
  }

  /* -- per-frame --------------------------------------------------------- */

  /**
   * Advance every bolt and beam and rebuild both ribbon buffers.
   * `focusDepth` is the view-space distance to the camera's ground focus,
   * used to convert the bible's pixel figures into metres for sprite effects.
   */
  step(dtMs: number, fovDeg: number, focusDepth: number): void {
    this.overlay.setFov(fovDeg);
    this.depthed.setFov(fovDeg);
    this.mppAtFocus = this.pxToMetres(1, focusDepth);

    this.overlay.begin();
    this.lastBranches = 0;
    this.lastLoops = 0;

    for (let i = 0; i < this.bolts.length; i++) {
      const b = this.bolts[i];
      if (!b.active) continue;
      b.ageMs += dtMs;
      if (b.ageMs >= b.lifeMs) { this.retireBolt(i); continue; }
      this.trackEndpoints(b);

      b.rerollTimer += dtMs;
      if (b.rerollTimer >= VFX_TESLA.rerollMs) {
        b.rerollTimer = 0;
        b.reroll();
      }
      // The starburst fires once, on the first frame the arc exists, so the
      // hit reads as an impact and not as a slow bloom.
      if (!b.burst) {
        b.burst = true;
        this.teslaImpact(b.bx, b.by, b.bz, b.sizeMul);
      }

      moveLight(b.light, (b.ax + b.bx) * 0.5, (b.ay + b.by) * 0.5 + BEAM_LIGHT_LIFT, (b.az + b.bz) * 0.5);
      this.drawBolt(b);
      this.lastBranches += b.branchCount;
      this.lastLoops += b.loopCount;
    }

    for (let i = 0; i < this.beams.length; i++) {
      const b = this.beams[i];
      if (!b.active) continue;
      b.ageMs += dtMs;
      if (b.ageMs >= b.lifeMs) { this.retireBeam(i); continue; }
      this.trackEndpoints(b);
      moveLight(b.light, (b.ax + b.bx) * 0.5, (b.ay + b.by) * 0.5 + BEAM_LIGHT_LIFT, (b.az + b.bz) * 0.5);
      this.drawBeam(b);
    }

    this.overlay.end();
  }

  /** Re-anchor an effect to the muzzle / victim it belongs to, every frame. */
  private trackEndpoints(b: TeslaBolt | Beam): void {
    if (b.sourceId !== NONE) {
      // socketWorld is valid from RenderPhase.Bridge onward, so an arc is never
      // a frame behind the barrel it comes out of.
      if (socketWorld(b.sourceId, b.sourcePart, this._w)) {
        b.ax = this._w[0]; b.ay = this._w[1]; b.az = this._w[2];
      } else if (entityWorld(b.sourceId, this._w)) {
        b.ax = this._w[0]; b.ay = this._w[1] + 2.0; b.az = this._w[2];
      }
    }
    if (b.targetId !== NONE && entityWorld(b.targetId, this._w)) {
      b.bx = this._w[0]; b.by = this._w[1] + b.targetLift; b.bz = this._w[2];
    }
  }

  /* -- drawing ----------------------------------------------------------- */

  private drawBolt(b: TeslaBolt): void {
    const T = VFX_TESLA;
    // A bolt dims over its life but never fades smoothly — it is re-rolled
    // every 50 ms, so the flicker comes from the geometry, not the alpha.
    const t = b.ageMs / b.lifeMs;
    // `b.glare` multiplies the ENVELOPE, so it scales every layer of the bolt
    // — glow, sheath and core — by one factor. Attenuating only the glow would
    // leave four stacked white cores, which is the failure mode the "one
    // filament, many sheaths" note below already describes.
    const alpha = (t > 0.82 ? 1 - (t - 0.82) / 0.18 : 1) * b.glare;
    const s = b.sizeMul;

    for (let k = 0; k < b.strokes; k++) {
      const start = b.strokeStart[k];
      const n = b.strokeLen[k];
      const branch = b.strokeKind[k] === STROKE_BRANCH;
      const wm = branch ? 0.6 : 1;
      // The primary trunk and the branches are the FILAMENTS: they carry the
      // white core. The extra jittered trunk copies carry a dim sheath only.
      //
      // This is the single most important line in the file. Additive blending
      // means five 2.6 px cores scattered across the jitter radius sum into one
      // ~10 px bar of clipped white, which reads as a fat chalk scribble and
      // fails scorecard #30 ("core <= 3 px at L >= 248") outright — measured
      // in-engine, twice, before it was written this way.
      const primary = k === 0 || branch;

      // Only the first stroke carries the wide glow; stacking five of them
      // would wash the bolt into a blue smear instead of a filament.
      if (k === 0) {
        this.overlay.stroke(
          b.pts, start, n, T.glowWidthPx * s, VFX_RAMP.tesla, T.glowRampT,
          T.glowIntensity, alpha, T.glowFalloff,
        );
      }
      this.overlay.stroke(
        b.pts, start, n, T.sheathWidthPx * wm * s, VFX_RAMP.tesla, T.sheathRampT,
        T.sheathIntensity * (primary ? 1 : T.copyDim), alpha, T.sheathFalloff,
      );
      if (primary) {
        this.overlay.stroke(
          b.pts, start, n, T.coreWidthPx * wm, VFX_RAMP.tesla, T.coreRampT,
          T.coreIntensity, alpha, T.coreFalloff,
        );
      }
    }
  }

  private drawBeam(b: Beam): void {
    const cfg = VFX_BEAM[b.kind];
    // Open / close envelope: 60 ms in, 180 ms out for a prism.
    let env = 1;
    if (b.ageMs < cfg.openMs) env = b.ageMs / cfg.openMs;
    const remain = b.lifeMs - b.ageMs;
    if (remain < cfg.closeMs) env = Math.min(env, remain / cfg.closeMs);

    // Width breathing ±8% at 11 Hz. The beam must never sit perfectly still.
    const breathe = cfg.breatheAmp > 0
      ? 1 + cfg.breatheAmp * Math.sin(b.ageMs * 0.001 * cfg.breatheHz * Math.PI * 2)
      : 1;
    const w = env * breathe;
    // Charged at spawn; applied here so it rides the open/close envelope
    // instead of popping. See `spawnBeam`.
    env *= b.glare;

    const ax = b.ax, ay = b.ay, az = b.az;
    const bx = b.bx, by = b.by, bz = b.bz;

    // Outer halo -> inner band -> white core, in that order: the core must be
    // the last thing written so its additive contribution sits on top.
    this.overlay.segment(ax, ay, az, bx, by, bz,
      cfg.outerPx * w, cfg.outerPx * w * cfg.taper,
      cfg.ramp, cfg.outerT, cfg.outerT, cfg.outerI, env, cfg.outerFall);
    this.overlay.segment(ax, ay, az, bx, by, bz,
      cfg.innerPx * w, cfg.innerPx * w * cfg.taper,
      cfg.ramp, cfg.innerT, cfg.innerT, cfg.innerI, env, cfg.innerFall);
    this.overlay.segment(ax, ay, az, bx, by, bz,
      cfg.corePx * w, cfg.corePx * w * cfg.taper,
      cfg.ramp, cfg.coreT, cfg.coreT, cfg.coreI, env, cfg.coreFall);
  }

  /**
   * The mandatory tesla impact starburst (bible §8.3): a white→cyan ball plus
   * 14–20 radial spikes, four of them at double length. Sizes are the bible's
   * pixel figures resolved to metres at the impact point.
   */
  teslaImpact(x: number, y: number, z: number, sizeMul = 1): void {
    const T = VFX_TESLA;
    const rng = presentationRng;
    const mpp = this.mppAtFocus;

    /*
     * CHARGED TO THE GLARE BUDGET, which it never was.
     *
     * `admitGlare` bounds how much additive light one patch of ground may emit
     * at once, and every other emitter goes through it — explosions, muzzle
     * flashes, tracers, and since v1.17.0 the arc and the beam. This one did
     * not, so four coils firing into the same spot produced four full-strength
     * starbursts. Charged at the impact point, and the FIRST one in a locality
     * is charged nothing and attenuated not at all, so a lone Tesla Coil looks
     * exactly as it did.
     */
    const glare = admitGlare(x, y, z, VFX_GLARE.cost.teslaImpact);

    const ballPx = rng.range(T.burstRadiusPx[0], T.burstRadiusPx[1]);
    let e = resetEmit();
    e.x = x; e.y = y; e.z = z;
    e.lifeMs = T.burstLifeMs;
    e.size0 = ballPx * 2 * mpp * sizeMul * 0.55;
    e.size1 = ballPx * 2 * mpp * sizeMul * 1.25;
    e.sizeEase = 0.45;
    e.ramp = VFX_RAMP.tesla; e.tA = 0; e.tB = 0.55; e.radial = 1;
    e.tile = VFX_TILE.core;
    e.i0 = T.burstIntensity * glare; e.i1 = T.burstIntensity * 0.25 * glare;
    emitAdditive(e);

    const spikes = rng.int(T.spikeMin, T.spikeMax);
    for (let i = 0; i < spikes; i++) {
      const long = i < T.spikeLongCount;
      const lenPx = rng.range(T.spikeLenPx[0], T.spikeLenPx[1]) * (long ? T.spikeLongMul : 1);
      const widPx = rng.range(T.spikeWidthPx[0], T.spikeWidthPx[1]);
      const len = lenPx * mpp * sizeMul;
      e = resetEmit();
      e.x = x; e.y = y; e.z = z;
      e.lifeMs = T.spikeLifeMs;
      // The spike tile runs along the quad's Y axis with its head at the top,
      // so `size` is the width and `aspect` stretches it to length.
      e.size0 = widPx * mpp * 1.6;
      e.size1 = widPx * mpp * 1.6;
      e.aspect = len / Math.max(1e-4, widPx * mpp * 1.6);
      e.sizeEase = 1;
      e.ramp = VFX_RAMP.tesla; e.tA = 0.06; e.tB = 0.45; e.radial = 0;
      e.tile = VFX_TILE.spark;
      // Radiate around the billboard plane; +PI/2 because the tile's head is up.
      e.rot = (i / spikes) * Math.PI * 2 + rng.range(-0.16, 0.16);
      // Was a hard-coded 4.2 — the one additive gain in the VFX system that
      // lived outside `src/core/config.ts`, and therefore the one nobody could
      // find when they came looking for why the starburst was so bright.
      e.i0 = T.spikeIntensity * glare; e.i1 = T.spikeIntensity * 0.25 * glare;
      emitAdditive(e);
    }

    spawnLight(x, y, z, VFX_LIGHTS.teslaImpact, sizeMul);
  }

  /* -- lifecycle --------------------------------------------------------- */

  get activeBolts(): number {
    let n = 0;
    for (const b of this.bolts) if (b.active) n++;
    return n;
  }

  get activeBeams(): number {
    let n = 0;
    for (const b of this.beams) if (b.active) n++;
    return n;
  }

  clear(): void {
    for (let i = 0; i < this.bolts.length; i++) if (this.bolts[i].active) this.retireBolt(i);
    for (let i = 0; i < this.beams.length; i++) if (this.beams[i].active) this.retireBeam(i);
    this.overlay.begin(); this.overlay.end();
    this.depthed.begin(); this.depthed.end();
  }

  dispose(): void {
    this.clear();
    this.overlay.dispose();
    this.depthed.dispose();
    this.root.removeFromParent();
  }
}

/* ==========================================================================
 * 5. MODULE-LEVEL ACCESS
 * ========================================================================== */

let beamsInstance: BeamSystem | null = null;

export function setBeamSystem(next: BeamSystem | null): void {
  beamsInstance = next;
}

export function beamSystem(): BeamSystem | null {
  return beamsInstance;
}

/**
 * Fire a tesla arc. Safe before init (returns `NO_BEAM`).
 * @see BeamSystem.spawnTesla
 */
export function spawnTesla(
  x0: number, y0: number, z0: number,
  x1: number, y1: number, z1: number,
  durationMs = VFX_TESLA.defaultDurationMs,
  sourceId: EntityId = NONE, targetId: EntityId = NONE,
  sizeMul = 1,
): BeamHandle {
  return beamsInstance === null
    ? NO_BEAM
    : beamsInstance.spawnTesla(x0, y0, z0, x1, y1, z1, durationMs, sourceId, targetId, sizeMul);
}

/**
 * Fire a continuous energy beam. Safe before init (returns `NO_BEAM`).
 * @see BeamSystem.spawnBeam
 */
export function spawnBeam(
  x0: number, y0: number, z0: number,
  x1: number, y1: number, z1: number,
  kind: BeamKind = 'prism',
  durationMs = -1,
  sourceId: EntityId = NONE, targetId: EntityId = NONE,
): BeamHandle {
  return beamsInstance === null
    ? NO_BEAM
    : beamsInstance.spawnBeam(x0, y0, z0, x1, y1, z1, kind, durationMs, sourceId, targetId);
}

/** Stop a live beam or bolt early; it closes over its own envelope. */
export function stopBeam(h: BeamHandle): void {
  beamsInstance?.stop(h);
}

/** Move a live beam's far end. */
export function retargetBeam(h: BeamHandle, x: number, y: number, z: number): void {
  beamsInstance?.retarget(h, x, y, z);
}
