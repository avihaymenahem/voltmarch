/**
 * ============================================================================
 * RED ALERT — src/vfx/Tracers.ts
 * ============================================================================
 * MUZZLE FLASHES, TRACERS AND BEAD-CHAIN TRAILS. Bible §8.5 and §8.6.
 *
 * THREE RULES, ALL OF THEM SCORED
 * -------------------------------
 * 1. **Muzzle flashes are WHITE/CREAM and they are LARGE** (scorecard #29:
 *    "white/cream core, ≥4× barrel diameter long"). The bible's closing note
 *    for §8 is "do not shrink the muzzle flashes", and a 0.3 m MBT barrel with
 *    the 3.0 m heavy flash here comes out at 10× — deliberately past the bar,
 *    because the reference frames put a heavy flash at roughly half a hull
 *    length. An orange, tasteful, unit-sized flash is the failure mode.
 *
 * 2. **Tracers are tapered lozenges, never uniform lines** — bright rounded
 *    head, tail tapering to a point, ratio ≈14:1, and only ~1 in 3 rounds is
 *    visible. They draw through the ribbon batch so their 2.5–4 px width is
 *    real pixels at any zoom.
 *
 * 3. **Trails are BEAD CHAINS, never ribbons** (scorecard #31: a scanline
 *    along a rocket trail must show ≥6 luminance oscillations of ≥25 L). So
 *    `spawnTrail` lays DISCRETE puffs at a fixed spacing IN METRES along the
 *    travel vector it is handed, and never interpolates a continuous strip. A
 *    smooth ribbon is explicitly an RA3 negative.
 *
 * WHERE THE TRACERS DRAW
 * ----------------------
 * Into `BeamSystem.depthed`, the depth-TESTED ribbon batch — a tracer behind a
 * cliff must be hidden, unlike a tesla bolt which the bible verifies draws over
 * terrain. This module owns that batch's `begin()`/`end()` pair; nothing else
 * may write to it.
 * ============================================================================
 */

import {
  VFX_GUNS,
  VFX_LIGHTS,
  VFX_MAX_TRACERS,
  VFX_RAMP,
  VFX_TILE,
  VFX_TRAIL,
} from '../core/config';
import { PartId } from '../core/types';
import type { EntityId } from '../core/types';
import { presentationRng } from '../core/math';
import { socketWorld } from '../render/RenderBridge';

import type { RibbonBatch } from './Beams';
import { spawnLight } from './LightPool';
import { emitAdditive, emitLit, resetEmit } from './Particles';

/* ==========================================================================
 * 1. MUZZLE FLASHES
 * ========================================================================== */

/** 0 = light gun, 1 = medium, 2 = heavy. Indexes `VFX_GUNS.flash`. */
export type FlashSize = 0 | 1 | 2;

/**
 * A muzzle flash at a world point, thrown along `(dx,dy,dz)`.
 *
 * The flash is three things at once, which is why a single sprite always looks
 * cheap: a big cream 4-point star / kite oriented down the barrel, a small
 * white-hot core disc that CLIPS and feeds the bloom threshold, and a
 * `PointLight` so the ground under the tank goes warm for 90 ms.
 */
export function spawnMuzzleFlash(
  x: number, y: number, z: number,
  dx: number, dy: number, dz: number,
  size: FlashSize = 1,
  scale = 1,
): void {
  const G = VFX_GUNS;
  const cfg = G.flash[size] ?? G.flash[1];
  const rng = presentationRng;

  const inv = 1 / Math.max(1e-4, Math.hypot(dx, dy, dz));
  const ux = dx * inv, uy = dy * inv, uz = dz * inv;
  const len = cfg.lenM * scale;
  const wid = cfg.widM * scale;

  // Sit the flash forward of the muzzle so it reads as coming OUT of the gun
  // rather than being centred on it.
  const cx = x + ux * len * 0.34;
  const cy = y + uy * len * 0.34;
  const cz = z + uz * len * 0.34;

  // The big shape. A small forward drift doubles as the `alignVel` direction.
  let e = resetEmit();
  e.x = cx; e.y = cy; e.z = cz;
  e.vx = ux * 2.2; e.vy = uy * 2.2; e.vz = uz * 2.2;
  e.lifeMs = cfg.lifeMs;
  // Bible scale curve: 0 -> 1.0 at 15 ms -> 0.85 -> 0. The pool interpolates
  // size0->size1 monotonically, so the snap-open lives in the ease exponent
  // and the drop-off in the alpha ramp.
  e.size0 = wid * 0.35;
  e.size1 = wid;
  e.aspect = len / Math.max(1e-4, wid);
  e.sizeEase = 0.22;
  e.ramp = VFX_RAMP.muzzle; e.tA = 0; e.tB = 1;
  e.tile = cfg.tile;
  e.alignVel = 1;
  e.i0 = cfg.intensity; e.i1 = 0.2;
  emitAdditive(e);

  // The white-hot core. This is the pixel that must clip to #FFFFFF.
  e = resetEmit();
  e.x = cx; e.y = cy; e.z = cz;
  e.lifeMs = cfg.lifeMs * 0.62;
  e.size0 = len * G.flashCoreFrac * 0.55;
  e.size1 = len * G.flashCoreFrac;
  e.sizeEase = 0.3;
  e.ramp = VFX_RAMP.flash; e.tA = 0; e.tB = 1;
  e.tile = VFX_TILE.core;
  e.i0 = G.flashCoreIntensity; e.i1 = 0.5;
  emitAdditive(e);

  // A thin smoke ribbon off the barrel — bible §8.5, alpha 0.25.
  if (size > 0) {
    e = resetEmit();
    e.x = cx + ux * len * 0.4; e.y = cy + uy * len * 0.4; e.z = cz + uz * len * 0.4;
    e.vx = ux * 3.4 + rng.range(-0.4, 0.4);
    e.vy = uy * 3.4 + 0.9;
    e.vz = uz * 3.4 + rng.range(-0.4, 0.4);
    e.drag = 1.6;
    e.lifeMs = 900;
    e.size0 = wid * 0.55; e.size1 = wid * 2.2; e.sizeEase = 0.7;
    e.ramp = VFX_RAMP.rocketSmoke; e.tA = 0; e.tB = 1;
    e.tile = VFX_TILE.puffAlt;
    e.rot = rng.range(0, Math.PI * 2);
    e.alpha = G.barrelSmokeAlpha;
    emitLit(e);
  }

  // Scene light. Bible §8.9: #FFD28A, peak 12, 2.5 TL, gone by 90 ms.
  spawnLight(cx, cy, cz, VFX_LIGHTS.muzzle, size === 2 ? 1.5 : size === 1 ? 1.0 : 0.7);
}

/**
 * Convenience for combat: flash at a unit's muzzle socket, using the
 * RenderBridge transform so the flash is welded to the barrel on the SAME
 * frame it fires rather than one behind it.
 */
export function spawnMuzzleFlashAt(
  id: EntityId, part: PartId = PartId.MuzzleA, size: FlashSize = 1, scale = 1,
): boolean {
  const out = SOCKET_SCRATCH;
  if (!socketWorld(id, part, out)) return false;
  spawnMuzzleFlash(out[0], out[1], out[2], out[3], out[4], out[5], size, scale);
  return true;
}

const SOCKET_SCRATCH = new Float32Array(7);

/* ==========================================================================
 * 2. TRAILS — bead chains
 * ========================================================================== */

/**
 * Lay a bead chain along a travel vector.
 *
 * The caller passes the movement SINCE ITS LAST CALL, not a velocity: a
 * projectile stepping 1 m per sim tick gets ~2 beads laid along that metre, so
 * the chain reads at any speed and any frame rate without the caller
 * remembering anything. Passing a zero-length vector lays exactly one bead.
 *
 * @param hot `true` for a rocket motor (flame + smoke pair), `false` for cold
 *            missile vapour (a single normal-blended puff).
 */
export function spawnTrail(
  x: number, y: number, z: number,
  dx: number, dy: number, dz: number,
  hot = true,
  scale = 1,
): void {
  const T = VFX_TRAIL;
  const rng = presentationRng;
  const travel = Math.hypot(dx, dy, dz);
  const spacing = (hot ? T.hotSpacingM : T.coldSpacingM) * scale;
  const beads = travel > spacing
    ? Math.min(T.maxBeadsPerCall, Math.max(1, Math.floor(travel / spacing)))
    : 1;

  for (let i = 0; i < beads; i++) {
    // Walk BACKWARDS from the current position along the travel vector, so the
    // newest bead is at the nose and the chain trails behind it.
    const f = beads > 1 ? i / beads : 0;
    const bx = x - dx * f;
    const by = y - dy * f;
    const bz = z - dz * f;
    const jitter = spacing * 0.18;

    if (hot) {
      // Flame puff: additive, short, bright.
      let e = resetEmit();
      e.x = bx + rng.range(-jitter, jitter);
      e.y = by + rng.range(-jitter, jitter);
      e.z = bz + rng.range(-jitter, jitter);
      e.lifeMs = T.hotFlameLifeMs * rng.range(0.75, 1.2);
      e.size0 = T.hotFlameSize0 * scale;
      e.size1 = T.hotFlameSize1 * scale;
      e.sizeEase = 0.6;
      e.ramp = VFX_RAMP.rocketFlame; e.tA = 0; e.tB = 1;
      e.tile = VFX_TILE.bead;
      e.rot = rng.range(0, Math.PI * 2);
      e.i0 = T.hotFlameIntensity; e.i1 = 0.25;
      emitAdditive(e);

      // Smoke bead behind it: normal blend, lit, long-lived.
      e = resetEmit();
      e.x = bx + rng.range(-jitter, jitter);
      e.y = by + rng.range(-jitter, jitter);
      e.z = bz + rng.range(-jitter, jitter);
      e.vy = 0.55;
      e.drag = 0.6;
      e.lifeMs = T.hotSmokeLifeMs * rng.range(0.8, 1.25);
      e.size0 = T.hotSmokeSize0 * scale;
      e.size1 = T.hotSmokeSize1 * scale;
      e.sizeEase = 0.7;
      e.ramp = VFX_RAMP.rocketSmoke; e.tA = 0; e.tB = 1;
      e.tile = (i & 1) === 0 ? VFX_TILE.bead : VFX_TILE.puffAlt;
      e.rot = rng.range(0, Math.PI * 2);
      e.rotVel = rng.range(-0.5, 0.5);
      e.alpha = T.hotSmokeAlpha;
      emitLit(e);
    } else {
      const e = resetEmit();
      e.x = bx + rng.range(-jitter, jitter);
      e.y = by + rng.range(-jitter, jitter);
      e.z = bz + rng.range(-jitter, jitter);
      e.drag = 0.35;
      e.lifeMs = T.coldLifeMs * rng.range(0.8, 1.2);
      e.size0 = T.coldSize0 * scale;
      e.size1 = T.coldSize1 * scale;
      e.sizeEase = 0.65;
      e.ramp = VFX_RAMP.vapour; e.tA = 0; e.tB = 1;
      e.tile = VFX_TILE.bead;
      e.rot = rng.range(0, Math.PI * 2);
      e.alpha = T.coldAlpha;
      emitLit(e);
    }
  }
}

/** Lay a bead chain between two explicit points. */
export function spawnTrailSegment(
  x0: number, y0: number, z0: number,
  x1: number, y1: number, z1: number,
  hot = true, scale = 1,
): void {
  spawnTrail(x1, y1, z1, x1 - x0, y1 - y0, z1 - z0, hot, scale);
}

/* ==========================================================================
 * 3. TRACERS
 * ========================================================================== */

/** MG burst or main-gun round. Selects the bible's two size/speed bands. */
export type TracerKind = 'mg' | 'cannon';

export class TracerSystem {
  readonly capacity = VFX_MAX_TRACERS;

  private readonly px = new Float32Array(VFX_MAX_TRACERS);
  private readonly py = new Float32Array(VFX_MAX_TRACERS);
  private readonly pz = new Float32Array(VFX_MAX_TRACERS);
  private readonly vx = new Float32Array(VFX_MAX_TRACERS);
  private readonly vy = new Float32Array(VFX_MAX_TRACERS);
  private readonly vz = new Float32Array(VFX_MAX_TRACERS);
  private readonly age = new Float32Array(VFX_MAX_TRACERS);
  private readonly life = new Float32Array(VFX_MAX_TRACERS);
  private readonly lenPx = new Float32Array(VFX_MAX_TRACERS);
  private readonly widPx = new Float32Array(VFX_MAX_TRACERS);
  private readonly ramp = new Float32Array(VFX_MAX_TRACERS);
  private readonly inten = new Float32Array(VFX_MAX_TRACERS);
  private readonly smoke = new Uint8Array(VFX_MAX_TRACERS);

  private readonly free = new Int32Array(VFX_MAX_TRACERS);
  private freeCount = VFX_MAX_TRACERS;
  private readonly live = new Int32Array(VFX_MAX_TRACERS);
  private liveCount = 0;
  private readonly livePos = new Int32Array(VFX_MAX_TRACERS).fill(-1);

  dropped = 0;

  /** The depth-tested ribbon batch this system owns for the frame. */
  constructor(private readonly batch: RibbonBatch) {
    for (let i = 0; i < VFX_MAX_TRACERS; i++) this.free[i] = VFX_MAX_TRACERS - 1 - i;
  }

  get count(): number { return this.liveCount; }

  /**
   * Fire one visible round.
   *
   * @param cold  Allied cold palette (`#FFFFFF→#C8E4FF→#6FA8FF`) instead of the
   *              warm `#FFD26A→#FF9A2E→#E8781C`.
   * @param rangeM How far it may travel before it is retired.
   */
  spawn(
    x: number, y: number, z: number,
    dx: number, dy: number, dz: number,
    kind: TracerKind = 'mg',
    cold = false,
    rangeM = 90,
  ): void {
    const G = VFX_GUNS;
    const rng = presentationRng;
    if (this.freeCount === 0) { this.dropped++; return; }

    const inv = 1 / Math.max(1e-4, Math.hypot(dx, dy, dz));
    const speed = kind === 'cannon' ? G.cannonSpeed : G.tracerSpeed;
    const i = this.free[--this.freeCount];

    this.px[i] = x; this.py[i] = y; this.pz[i] = z;
    this.vx[i] = dx * inv * speed;
    this.vy[i] = dy * inv * speed;
    this.vz[i] = dz * inv * speed;
    this.age[i] = 0;
    this.life[i] = (rangeM / speed) * 1000;
    if (kind === 'cannon') {
      this.lenPx[i] = rng.range(G.cannonLenPx[0], G.cannonLenPx[1]);
      this.widPx[i] = rng.range(G.cannonWidthPx[0], G.cannonWidthPx[1]);
      this.inten[i] = G.cannonIntensity;
      this.smoke[i] = 1;
    } else {
      this.lenPx[i] = rng.range(G.tracerLenPx[0], G.tracerLenPx[1]);
      this.widPx[i] = rng.range(G.tracerWidthPx[0], G.tracerWidthPx[1]);
      this.inten[i] = G.tracerIntensity;
      this.smoke[i] = 0;
    }
    this.ramp[i] = cold ? VFX_RAMP.tracerCold : VFX_RAMP.tracerWarm;

    this.livePos[i] = this.liveCount;
    this.live[this.liveCount++] = i;
  }

  /**
   * Fire a burst. Bible §8.5: bursts of 3–6 at 55–90 ms, then a 450–900 ms
   * gap, and only ~1 in 3 rounds is visible — so a "burst of 5" here emits
   * roughly two tracers, which is what the reference frames actually show.
   */
  burst(
    x: number, y: number, z: number,
    dx: number, dy: number, dz: number,
    rounds = 4, cold = false, rangeM = 90,
  ): void {
    const rng = presentationRng;
    for (let i = 0; i < rounds; i++) {
      if (!rng.chance(VFX_GUNS.tracerVisibleFrac)) continue;
      // Spread the burst so it is not a single thick line.
      this.spawn(
        x, y, z,
        dx + rng.range(-0.035, 0.035),
        dy + rng.range(-0.025, 0.025),
        dz + rng.range(-0.035, 0.035),
        'mg', cold, rangeM,
      );
    }
  }

  private kill(slot: number): void {
    const pos = this.livePos[slot];
    if (pos < 0) return;
    const last = this.live[--this.liveCount];
    this.live[pos] = last;
    this.livePos[last] = pos;
    this.livePos[slot] = -1;
    this.free[this.freeCount++] = slot;
  }

  /**
   * Advance and draw. Owns `batch.begin()`/`batch.end()` for the frame.
   *
   * `mpp` is metres per reference pixel — the pixel widths and lengths in the
   * bible only become world geometry here.
   */
  step(dtMs: number, mpp: number): void {
    const dt = dtMs * 0.001;
    this.batch.begin();

    for (let k = this.liveCount - 1; k >= 0; k--) {
      const i = this.live[k];
      this.age[i] += dtMs;
      if (this.age[i] >= this.life[i]) { this.kill(i); continue; }
      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
      this.pz[i] += this.vz[i] * dt;
    }

    for (let k = 0; k < this.liveCount; k++) {
      const i = this.live[k];
      const speed = Math.hypot(this.vx[i], this.vy[i], this.vz[i]);
      if (speed < 1e-4) continue;
      const ux = this.vx[i] / speed, uy = this.vy[i] / speed, uz = this.vz[i] / speed;
      const len = this.lenPx[i] * mpp;
      const w = this.widPx[i];

      const hx = this.px[i], hy = this.py[i], hz = this.pz[i];
      const tx = hx - ux * len, ty = hy - uy * len, tz = hz - uz * len;

      // Tail (a point) -> head (full width). NOT a uniform line: the bible
      // calls that out specifically, and it is what makes a tracer read as a
      // round rather than a laser.
      this.batch.segment(
        tx, ty, tz, hx, hy, hz,
        w * 0.12, w,
        this.ramp[i], 0.85, 0.10, this.inten[i], 1, 0.55,
      );
      // The bright rounded head: a short, wide, near-flat overlap that clips.
      this.batch.segment(
        hx - ux * len * 0.20, hy - uy * len * 0.20, hz - uz * len * 0.20,
        hx + ux * len * 0.05, hy + uy * len * 0.05, hz + uz * len * 0.05,
        w * this.smokeHeadMul(i), w * this.smokeHeadMul(i),
        this.ramp[i], 0.02, 0.02, this.inten[i] * 1.6, 1, 0.30,
      );
    }

    this.batch.end();
  }

  private smokeHeadMul(i: number): number {
    return this.smoke[i] !== 0 ? VFX_GUNS.tracerHeadWidthMul * 1.1 : VFX_GUNS.tracerHeadWidthMul;
  }

  clear(): void {
    while (this.liveCount > 0) this.kill(this.live[this.liveCount - 1]);
    this.batch.begin();
    this.batch.end();
  }
}

/* ==========================================================================
 * 4. MODULE-LEVEL ACCESS
 * ========================================================================== */

let tracerInstance: TracerSystem | null = null;

export function setTracerSystem(next: TracerSystem | null): void {
  tracerInstance = next;
}

export function tracers(): TracerSystem | null {
  return tracerInstance;
}

/** @see TracerSystem.spawn — safe before init. */
export function spawnTracer(
  x: number, y: number, z: number,
  dx: number, dy: number, dz: number,
  kind: TracerKind = 'mg', cold = false, rangeM = 90,
): void {
  tracerInstance?.spawn(x, y, z, dx, dy, dz, kind, cold, rangeM);
}

/** @see TracerSystem.burst — safe before init. */
export function spawnTracerBurst(
  x: number, y: number, z: number,
  dx: number, dy: number, dz: number,
  rounds = 4, cold = false, rangeM = 90,
): void {
  tracerInstance?.burst(x, y, z, dx, dy, dz, rounds, cold, rangeM);
}
