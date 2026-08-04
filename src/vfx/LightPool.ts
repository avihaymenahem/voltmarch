/**
 * ============================================================================
 * VOLTMARCH — src/vfx/LightPool.ts
 * ============================================================================
 * SCENE-LIGHT INJECTION. Bible §8.9, and the mitigation for §14 R6.
 *
 * The single measurable difference between "particles pasted on a screenshot"
 * and Red Alert 3 is that RA3's effects LIGHT THE WORLD. In one measured frame
 * the pavement on the beam side reads `#4560A3` while the pavement on the
 * fireball side of the SAME frame reads `#B5501C` — two competing coloured
 * washes at once. Scorecard #28 is automated against exactly that: ground
 * within 200 px of an active beam must shift ≥35 L toward the effect hue.
 *
 * So this file is built FIRST and every other file in src/vfx calls into it.
 * A muzzle flash that does not claim a light is a bug, not a saving.
 *
 * THREE THINGS THAT ARE NOT NEGOTIABLE HERE
 * -----------------------------------------
 * 1. **The lights are created once and never added to or removed from the
 *    scene.** `WebGLRenderer` bakes `NUM_POINT_LIGHTS` into every program it
 *    compiles; adding the 5th light mid-battle recompiles the terrain shader,
 *    both unit atlases and every particle material — a multi-hundred-millisecond
 *    hitch at the exact moment the player is watching an explosion. An idle
 *    light sits at `intensity 0` instead. It costs a handful of ALU per pixel
 *    and nothing else.
 *
 * 2. **Falloff is `decay 1.35`, not the physically correct 2.0.** Inverse square
 *    puts a 28-candela explosion at 0.011 irradiance 49 m away, which is
 *    invisible — but RA3's wash is clearly readable 300 px from the source.
 *    1.35 reproduces the measured reach without a 10× intensity that would blow
 *    the core white. This is a deliberate art cheat; see VFX_LIGHT_DECAY.
 *
 * 3. **Claiming never allocates and never fails silently.** When the pool is
 *    full the weakest active light is evicted if the newcomer outranks it, by
 *    `peak * range / (10 + distanceToCamera)` — so the explosion at your feet
 *    always beats a muzzle flash at the map edge, and a dropped light is
 *    counted rather than mourned.
 *
 * ENVELOPE
 * --------
 * Every light runs rise → hold → fall in milliseconds. A one-shot (explosion,
 * muzzle flash) gets a finite hold and expires on its own. A sustained source
 * (beam midpoint, burning wreck) passes `holdMs = Infinity` and is ended by
 * `release(handle)`, which snaps it into the fall phase from wherever it is.
 * ============================================================================
 */

import * as THREE from 'three';

import {
  VFX_LIGHT_DECAY,
  VFX_LIGHT_INTENSITY_SCALE,
  VFX_LIGHT_POOL,
} from '../core/config';
import { hexToLinearRgb } from '../core/math';

/* ==========================================================================
 * Handles
 *
 * A handle is `slot | (generation << 8)`. The generation invalidates a stale
 * handle the instant its slot is recycled, so a beam that outlives its light
 * (because it got evicted) can call `move()` forever without ever steering
 * somebody else's explosion.
 * ========================================================================== */

/** Opaque light handle. 0 is never valid. */
export type LightHandle = number;

/** The null handle. */
export const NO_LIGHT: LightHandle = 0;

const SLOT_BITS = 8;
const SLOT_MASK = (1 << SLOT_BITS) - 1;

/* ==========================================================================
 * Envelope phases
 * ========================================================================== */

const PHASE_FREE = 0;
const PHASE_RISE = 1;
const PHASE_HOLD = 2;
const PHASE_FALL = 3;

/** One-shot / sustained light parameters, matching the bible's §8.9 table. */
export interface LightEnvelope {
  /** sRGB hex, e.g. '#FFB05A'. Converted to linear once per spawn. */
  readonly color: string;
  /** Peak candela at the top of the rise. */
  readonly peak: number;
  /** Cutoff distance in metres (THREE's `PointLight.distance`). */
  readonly range: number;
  readonly riseMs: number;
  /** `Infinity` for a sustained source ended by `release()`. */
  readonly holdMs: number;
  readonly fallMs: number;
  /** 0 disables. Bible uses 7 Hz for a burning wreck. */
  readonly flickerHz: number;
  /** Fractional amplitude of the flicker, e.g. 0.30 for ±30%. */
  readonly flickerAmp: number;
}

/* ==========================================================================
 * The pool
 * ========================================================================== */

export class LightPool {
  readonly capacity: number;
  /** The live THREE lights. Parented to one group so teardown is one remove. */
  readonly root = new THREE.Group();
  private readonly lights: THREE.PointLight[] = [];

  /* -- SoA state, allocated once ---------------------------------------- */
  private readonly phase = new Uint8Array(VFX_LIGHT_POOL);
  private readonly gen = new Uint8Array(VFX_LIGHT_POOL);
  private readonly age = new Float32Array(VFX_LIGHT_POOL);
  private readonly riseMs = new Float32Array(VFX_LIGHT_POOL);
  private readonly holdMs = new Float32Array(VFX_LIGHT_POOL);
  private readonly fallMs = new Float32Array(VFX_LIGHT_POOL);
  private readonly peak = new Float32Array(VFX_LIGHT_POOL);
  private readonly range = new Float32Array(VFX_LIGHT_POOL);
  private readonly flickerHz = new Float32Array(VFX_LIGHT_POOL);
  private readonly flickerAmp = new Float32Array(VFX_LIGHT_POOL);
  private readonly scale = new Float32Array(VFX_LIGHT_POOL);
  /** Intensity at the moment `release()` was called, so the fall is continuous. */
  private readonly releaseFrom = new Float32Array(VFX_LIGHT_POOL);
  private readonly px = new Float32Array(VFX_LIGHT_POOL);
  private readonly py = new Float32Array(VFX_LIGHT_POOL);
  private readonly pz = new Float32Array(VFX_LIGHT_POOL);
  /** Priority recomputed each update; drives eviction. */
  private readonly priority = new Float32Array(VFX_LIGHT_POOL);

  /* -- diagnostics ------------------------------------------------------- */
  /** Lights currently emitting. */
  activeCount = 0;
  /** Claims that found no slot AND could not out-rank an incumbent. */
  droppedClaims = 0;
  /** Claims that stole a slot from a weaker light. */
  evictions = 0;

  /** Scratch for the linear colour conversion. Never allocates per spawn. */
  private readonly rgb = new Float32Array(3);
  private disposed = false;

  constructor(capacity: number = VFX_LIGHT_POOL) {
    this.capacity = Math.max(1, Math.min(capacity, VFX_LIGHT_POOL));
    this.root.name = 'VfxLightPool';
    // Lights are tiny and always inside the frustum conceptually; culling a
    // Group of lights is meaningless and three would skip them.
    this.root.frustumCulled = false;

    for (let i = 0; i < this.capacity; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 1, VFX_LIGHT_DECAY);
      l.name = `vfxLight${i}`;
      // Shadow-casting point lights are six extra render passes each. RA3 does
      // not shadow its effect lights and neither do we.
      l.castShadow = false;
      // MUST stay visible: `visible = false` removes it from the light list and
      // recompiles every program. Idle means intensity 0, never invisible.
      l.visible = true;
      l.frustumCulled = false;
      this.lights.push(l);
      this.root.add(l);
      this.gen[i] = 1;
      this.scale[i] = 1;
    }
  }

  /** Attach to the scene. Call once, from the VFX system's `init`. */
  attach(scene: THREE.Scene): void {
    scene.add(this.root);
  }

  /* ======================================================================
   * Claiming
   * ====================================================================== */

  /**
   * Claim a light. Returns `NO_LIGHT` only when the pool is full of things
   * more important than this one.
   *
   * @param env    One of the frozen envelopes in `VFX_LIGHTS`.
   * @param sizeMul Multiplies peak intensity AND range — a 5 TL structure
   *                fireball must wash further than a 1.2 TL cook-off.
   */
  spawn(
    x: number, y: number, z: number,
    env: LightEnvelope,
    sizeMul = 1,
  ): LightHandle {
    const peak = env.peak * sizeMul * VFX_LIGHT_INTENSITY_SCALE;
    const range = env.range * (0.55 + 0.45 * sizeMul);
    const slot = this.claimSlot(x, y, z, peak, range);
    if (slot < 0) { this.droppedClaims++; return NO_LIGHT; }

    this.phase[slot] = PHASE_RISE;
    this.age[slot] = 0;
    this.riseMs[slot] = Math.max(1, env.riseMs);
    this.holdMs[slot] = env.holdMs;
    this.fallMs[slot] = Math.max(1, env.fallMs);
    this.peak[slot] = peak;
    this.range[slot] = range;
    this.flickerHz[slot] = env.flickerHz;
    this.flickerAmp[slot] = env.flickerAmp;
    this.scale[slot] = 1;
    this.releaseFrom[slot] = -1;
    this.px[slot] = x; this.py[slot] = y; this.pz[slot] = z;

    const l = this.lights[slot];
    hexToLinearRgb(env.color, this.rgb);
    // setRGB in LinearSRGBColorSpace: the hex has already been de-gamma'd, so
    // three must NOT convert it a second time.
    l.color.setRGB(this.rgb[0], this.rgb[1], this.rgb[2], THREE.LinearSRGBColorSpace);
    l.distance = range;
    l.decay = VFX_LIGHT_DECAY;
    l.position.set(x, y, z);
    l.intensity = 0;

    return (slot & SLOT_MASK) | (this.gen[slot] << SLOT_BITS);
  }

  /**
   * Find a slot: a free one, else the weakest active light that this claim
   * outranks. Returns -1 when everything alive is more important.
   */
  private claimSlot(x: number, y: number, z: number, peak: number, range: number): number {
    for (let i = 0; i < this.capacity; i++) {
      if (this.phase[i] === PHASE_FREE) return i;
    }
    // Full. Rank the newcomer with the same formula the update pass uses.
    const mine = rank(peak, range, x, y, z, this.camX, this.camY, this.camZ);
    let worst = -1;
    let worstScore = mine;
    for (let i = 0; i < this.capacity; i++) {
      if (this.priority[i] < worstScore) { worstScore = this.priority[i]; worst = i; }
    }
    if (worst < 0) return -1;
    this.evictions++;
    // Bump the generation so the evicted owner's handle stops resolving.
    this.gen[worst] = (this.gen[worst] + 1) & 0xff;
    if (this.gen[worst] === 0) this.gen[worst] = 1;
    return worst;
  }

  /* ======================================================================
   * Driving a live light
   * ====================================================================== */

  /** Resolve a handle to a slot, or -1 if it is stale. */
  private slotOf(h: LightHandle): number {
    if (h === NO_LIGHT) return -1;
    const slot = h & SLOT_MASK;
    if (slot >= this.capacity) return -1;
    if (this.phase[slot] === PHASE_FREE) return -1;
    return this.gen[slot] === (h >>> SLOT_BITS) ? slot : -1;
  }

  /** True while the handle still owns a live light. */
  alive(h: LightHandle): boolean {
    return this.slotOf(h) >= 0;
  }

  /** Follow a moving source — a beam midpoint, a burning hull. */
  move(h: LightHandle, x: number, y: number, z: number): void {
    const s = this.slotOf(h);
    if (s < 0) return;
    this.px[s] = x; this.py[s] = y; this.pz[s] = z;
    this.lights[s].position.set(x, y, z);
  }

  /** Multiply the envelope, e.g. to breathe a beam's light with its width. */
  setScale(h: LightHandle, s: number): void {
    const i = this.slotOf(h);
    if (i < 0) return;
    this.scale[i] = s;
  }

  /**
   * End a sustained light gracefully: it falls from its CURRENT intensity over
   * `fallMs`, so switching a beam off never pops.
   */
  release(h: LightHandle): void {
    const s = this.slotOf(h);
    if (s < 0) return;
    if (this.phase[s] === PHASE_FALL) return;
    this.releaseFrom[s] = this.lights[s].intensity;
    this.phase[s] = PHASE_FALL;
    this.age[s] = 0;
  }

  /** Kill immediately. Used on teardown, not in normal play. */
  kill(h: LightHandle): void {
    const s = this.slotOf(h);
    if (s < 0) return;
    this.free(s);
  }

  private free(slot: number): void {
    this.phase[slot] = PHASE_FREE;
    this.lights[slot].intensity = 0;
    this.priority[slot] = 0;
    this.gen[slot] = (this.gen[slot] + 1) & 0xff;
    if (this.gen[slot] === 0) this.gen[slot] = 1;
  }

  /* ======================================================================
   * Per-frame
   * ====================================================================== */

  /** Camera position, cached from the last `update` for the eviction rank. */
  private camX = 0;
  private camY = 0;
  private camZ = 0;
  /** Wall-clock milliseconds, for the flicker phase. Render-side, never sim. */
  private clockMs = 0;

  /**
   * Advance every envelope. Call once per RENDERED frame, before the draw.
   * Allocation-free.
   */
  update(dtMs: number, camX: number, camY: number, camZ: number): void {
    this.camX = camX; this.camY = camY; this.camZ = camZ;
    this.clockMs += dtMs;

    let active = 0;
    for (let i = 0; i < this.capacity; i++) {
      const ph = this.phase[i];
      if (ph === PHASE_FREE) { this.priority[i] = 0; continue; }

      this.age[i] += dtMs;
      let env: number;

      if (ph === PHASE_RISE) {
        const t = this.age[i] / this.riseMs[i];
        if (t >= 1) {
          this.phase[i] = PHASE_HOLD;
          this.age[i] = 0;
          env = 1;
        } else {
          // Fast attack: a fireball is at full brightness in 40 ms and a linear
          // ramp reads as a fade-in rather than a detonation.
          env = t * t * (3 - 2 * t);
        }
      } else if (ph === PHASE_HOLD) {
        if (this.age[i] >= this.holdMs[i]) {
          this.phase[i] = PHASE_FALL;
          this.releaseFrom[i] = -1;
          this.age[i] = 0;
        }
        env = 1;
      } else {
        const t = this.age[i] / this.fallMs[i];
        if (t >= 1) { this.free(i); continue; }
        const from = this.releaseFrom[i] >= 0
          ? this.releaseFrom[i] / Math.max(1e-4, this.peak[i] * this.scale[i])
          : 1;
        // Quadratic decay: the tail of a fireball dims fast, then lingers.
        env = from * (1 - t) * (1 - t);
      }

      let intensity = this.peak[i] * this.scale[i] * env;
      const hz = this.flickerHz[i];
      if (hz > 0) {
        // Two incommensurate sines beat against each other, so a burning wreck
        // never looks like a metronome.
        const p = this.clockMs * 0.001 * hz * Math.PI * 2 + i * 1.7;
        intensity *= 1 + this.flickerAmp[i] * (Math.sin(p) * 0.62 + Math.sin(p * 2.37) * 0.38);
      }

      const l = this.lights[i];
      l.intensity = intensity > 0 ? intensity : 0;
      this.priority[i] = rank(intensity, this.range[i], this.px[i], this.py[i], this.pz[i], camX, camY, camZ);
      active++;
    }
    this.activeCount = active;
  }

  /**
   * The highest-ranked live light, written into `out` as
   * `[x, y, z, r, g, b, range]` with the colour already scaled by intensity.
   *
   * The lit-smoke shader takes exactly one dynamic light, and this is how it
   * picks which — so a plume beside a fireball goes orange on its underside
   * (bible §8.7's `#926339`) instead of staying neutral grey.
   */
  dominant(out: Float32Array): boolean {
    let best = -1;
    let bestScore = 0;
    for (let i = 0; i < this.capacity; i++) {
      if (this.phase[i] === PHASE_FREE) continue;
      if (this.priority[i] > bestScore) { bestScore = this.priority[i]; best = i; }
    }
    if (best < 0) return false;
    const l = this.lights[best];
    out[0] = this.px[best]; out[1] = this.py[best]; out[2] = this.pz[best];
    out[3] = l.color.r * l.intensity;
    out[4] = l.color.g * l.intensity;
    out[5] = l.color.b * l.intensity;
    out[6] = this.range[best];
    return true;
  }

  /** Snap every light off. Between matches, and on `dispose`. */
  clear(): void {
    for (let i = 0; i < this.capacity; i++) {
      if (this.phase[i] !== PHASE_FREE) this.free(i);
    }
    this.activeCount = 0;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clear();
    for (const l of this.lights) {
      l.removeFromParent();
      l.dispose();
    }
    this.lights.length = 0;
    this.root.removeFromParent();
  }
}

/**
 * Eviction rank. Bible §8.9: "allocated by (distance-to-camera × intensity)
 * priority". Range participates because a wide dim wash is worth more to the
 * frame than a bright pinprick, and the +10 keeps a light at the camera's exact
 * position from ranking at infinity.
 */
function rank(
  intensity: number, range: number,
  x: number, y: number, z: number,
  cx: number, cy: number, cz: number,
): number {
  const dx = x - cx, dy = y - cy, dz = z - cz;
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  return (intensity * range) / (10 + d);
}

/* ==========================================================================
 * Module-level access
 *
 * Same pattern as RenderBridge: every other VFX file, and any gameplay module
 * that wants to light something, reaches the pool through here and never has
 * to know when the system initialised. Before `init` the calls are no-ops that
 * return NO_LIGHT, so a light request during boot cannot throw.
 * ========================================================================== */

let poolInstance: LightPool | null = null;

/** The VFX system sets this in `init()` and clears it in `dispose()`. */
export function setLightPool(next: LightPool | null): void {
  poolInstance = next;
}

/** The live pool, or null before `init()`. */
export function lightPool(): LightPool | null {
  return poolInstance;
}

/** @see LightPool.spawn — safe before init. */
export function spawnLight(
  x: number, y: number, z: number, env: LightEnvelope, sizeMul = 1,
): LightHandle {
  return poolInstance === null ? NO_LIGHT : poolInstance.spawn(x, y, z, env, sizeMul);
}

/** @see LightPool.move — safe before init and with a stale handle. */
export function moveLight(h: LightHandle, x: number, y: number, z: number): void {
  poolInstance?.move(h, x, y, z);
}

/** @see LightPool.release — safe before init and with a stale handle. */
export function releaseLight(h: LightHandle): void {
  poolInstance?.release(h);
}
