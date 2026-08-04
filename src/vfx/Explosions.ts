/**
 * ============================================================================
 * VOLTMARCH — src/vfx/Explosions.ts
 * ============================================================================
 * EXPLOSIONS, IMPACTS, SMOKE COLUMNS AND DUST — the composed recipes.
 *
 * Everything here is a *composition* of `Particles.ts` emissions plus a
 * `LightPool` claim. There is no new rendering machinery in this file; there
 * is a great deal of bible §8.2 / §8.5 / §8.7 / §8.10 transcribed into
 * emission loops, because that transcription IS the look.
 *
 * THE ONE THING THAT MUST NOT BE COMPROMISED
 * ------------------------------------------
 * Scorecard #14: **"the brightest 40% of any fireball is L>245, channel spread
 * <30"**, and the bible's own gloss: *"a fireball whose centre is orange fails
 * the critique immediately."* Every billow here is emitted with
 * `radial = 1`, which sweeps the fireball ramp across the sprite's RADIUS
 * rather than its age. Because that ramp holds `#FFFAFF` out to t=0.52, each
 * billow gets a pure-white core covering half its radius with the saturated
 * orange fringe outside it — per billow, in one draw call, for free.
 *
 * THE SECOND THING: THE LIGHT
 * ---------------------------
 * Every explosion, impact and cook-off claims a `PointLight`. Bible §8.9 is
 * marked NON-NEGOTIABLE and §14 R6 names "additive quads with no scene-light
 * injection" as the failure mode that makes VFX read as a particle demo. An
 * explosion that skips its light is a bug.
 *
 * WHAT THIS FILE DOES NOT OWN
 * ---------------------------
 * The permanent scorch decal. Bible §8.10 puts scorches in a world-space decal
 * atlas capped at ~200 with oldest-eviction — that is the roads/decals module's
 * buffer, not a particle. So this file calls a SINK (`setScorchSink`) and, when
 * nothing has registered one, falls back to a long-lived ground-plane sprite so
 * a battlefield is never pristine. See §5.
 * ============================================================================
 */

import {
  VFX_EXPLOSION,
  VFX_GROUND,
  VFX_GUNS,
  VFX_LIT_PRESSURE_CUTOFF,
  VFX_LIGHTS,
  VFX_RAMP,
  VFX_SMOKE,
  VFX_TILE,
} from '../core/config';
import { presentationRng } from '../core/math';

import { spawnLight } from './LightPool';
import { emitAdditive, emitLit, particles, resetEmit } from './Particles';

/** 1 tank length, the bible's unit of size for every VFX figure. */
const TL = 7;

/* ==========================================================================
 * 0. GLOW SHAPING — "the glow on tank explosion is too big"
 *
 * These four numbers reshape the bloom FEED without touching the bloom pass or
 * any of the authored colour. They live here rather than in config.ts because
 * config.ts is owned by the grade agent this round; the integrator should
 * fold them into VFX_EXPLOSION when that lands (exact names in the report).
 *
 * THE DIAGNOSIS. The fireball's halo is not set by the bloom pass's radius; it
 * is set by how much SURFACE the pass is handed above its 1.05 threshold. Two
 * things were handing it far too much:
 *
 *   1. The flash disc grew to 3.2 TL — 22.4 metres, which at a normal RTS zoom
 *      is over a third of the frame's width — and it was a LIFE-driven sprite,
 *      so its 7.0 HDR gain was applied FLAT across every one of those pixels.
 *      A uniform 7.0-linear white disc a third of a screen wide is not a flash
 *      with a halo, it is a bloom source the size of the shot. It is now
 *      radial (a hot core with the ramp falling across the radius, the same
 *      trick the billows already use) and smaller.
 *
 *   2. Every billow was above threshold out to ~95% of its radius. Fixed in
 *      the shader — see HALO_T0/HALO_T1 in Particles.ts.
 *
 * Scorecard #14 is untouched by all of this: nothing here reduces the gain
 * inside the white core, and #24's "gone by 3.5% of frame width" is exactly
 * what shrinking the above-threshold disc buys.
 * ========================================================================== */
const GLOW = {
  /**
   * Multiplier on the flash disc's FINAL diameter. 0.60 takes the bible's
   * 3.2 TL to 1.9 TL (13.4 m), which is still wider than the fireball it caps
   * and reads as a flash at every zoom the camera rig allows.
   */
  flashSizeMul: 0.60,
  /**
   * Multiplier on the flash disc's STARTING diameter. Kept nearer 1.0 than the
   * end size so the disc still snaps open in the first frames — the 40 ms peak
   * is the whole character of the effect and shrinking the onset kills it.
   */
  flashSize0Mul: 0.78,
  /**
   * How far the flash ramp is stretched across the disc's radius. Above 1.0 for
   * the same reason `billowRadialSpan` is: the core tile's alpha is already
   * fading at the quad edge, so a 1.0 span parks the ramp's transparent tail in
   * invisible pixels and the disc reads as a flat white plate again.
   */
  flashRadialSpan: 1.12,
  /**
   * Multiplier on the structure death's separate 8 TL flash. Same argument at
   * a bigger scale: 8 TL is 56 metres of flat white.
   */
  structureFlashMul: 0.55,

  /**
   * Multiplier on EACH BILLOW's final diameter — the second half of "the glow
   * on a tank explosion is too big", and the more important half.
   *
   * `billowSize1TL` is 2.6, which is the bible's figure for the WHOLE fireball
   * of a unit death (2.2 TL) with a little headroom. It was being applied to
   * every one of the 8-14 billows individually. Work the ensemble out: the
   * billows are born on a ~3 m shell and drift ~2 m outward against drag 2.6
   * over their 750 ms life, so their centres end within about 5 m of the
   * origin; add a 9.1 m radius each and the fireball's envelope is 28 m — a
   * 4 TL fireball where the bible asks for 2.2 TL, at nearly double the
   * authored area and therefore nearly double the bloom feed.
   *
   * 0.45 puts each billow at 1.17 TL (8.2 m) and the ensemble envelope at
   * about 2.6 TL, which is the bible's figure plus the sparse outliers. The
   * RADIAL ramp fractions are untouched, so scorecard #14's "brightest 40% at
   * L>245" is unaffected — a billow is the same picture, smaller.
   */
  billowSizeMul: 0.45,

  /**
   * The same correction for EACH smoke-plume puff, and the reason `05-combat`
   * was a white sheet even after the shading was fixed.
   *
   * `puffSize1TL` is 4.0 — the bible's figure for the plume — and it was being
   * applied to each of 14-22 puffs, giving 28-metre near-opaque smoke balls.
   * The combat fixture frames from 48 m, where the visible ground is about
   * 31 m tall: ONE puff covers the frame and one death emits twenty of them.
   * 0.50 puts a puff at 2 TL (14 m); with the puffs' own spread and rise the
   * plume's envelope still comes out at the authored 4 TL.
   */
  puffSizeMul: 0.50,

  /**
   * Master opacity of the plume, replacing the flat 0.92.
   *
   * Bible §8.7 runs a column from 0.85 at the base to 0.15 at the top, and the
   * plume already computes that `f` — it just was not using it. Twenty stacked
   * puffs at an effective 0.83 alpha are a solid wall: the wreck that produced
   * the plume is not visible through its own smoke, which is not what an RA3
   * frame does.
   */
  puffAlphaBase: 0.72,
  puffAlphaTop: 0.20,
} as const;

/* ==========================================================================
 * 1. HOST HOOKS
 *
 * Three things this module needs from outside and must not import directly:
 * the ground height (terrain owns it), the camera trauma channel (input-camera
 * owns it) and the decal buffer (roads owns it). All three are settable sinks
 * with safe fallbacks, so `src/vfx/**` never reaches sideways into another
 * module's files.
 * ========================================================================== */

export type GroundHeightFn = (x: number, z: number) => number;
export type ShakeFn = (trauma: number) => void;

/**
 * Receives a scorch mark. `radius` is the SEMI-major axis in metres — the mark
 * spans `2 * radius` across its long dimension. The decal module is expected to
 * apply the bible's 1.7:1 aspect and `#2A2118` at 55% centre opacity feathering
 * out over the outer 35%.
 *
 * THE UNITS ARE SPELLED OUT BECAUSE THEY WERE WRONG. This doc used to say
 * "MAJOR axis" while the call site passed a diameter and the only registered
 * consumer — `DecalField.scorch` in src/world/Decals.ts, which builds its quad
 * as `radius/1.7` by `radius` HALF-extents — read it as a semi-axis. Every
 * scorch in the game was therefore laid at twice its authored radius, four
 * times its authored area. In a scenario that kills things (`?shot=battle`,
 * `?shot=naval`) the marks merged into one continuous near-black carpet over
 * the whole engagement, which is the "pure black ground" half of those two
 * fixtures' failure. Verified by ablation: hiding `GroundDecals` restores the
 * terrain exactly.
 */
export type ScorchSink = (x: number, z: number, radius: number, rotation: number) => void;

let groundHeight: GroundHeightFn = () => 0;
let shakeSink: ShakeFn | null = null;
let scorchSink: ScorchSink | null = null;
let scorchWarned = false;

/** Terrain publishes its sampler here; defaults to a flat plane at y=0. */
export function setGroundHeightFn(fn: GroundHeightFn | null): void {
  groundHeight = fn ?? (() => 0);
}

/** Input/camera publishes `cameraRig.addShake` here. */
export function setShakeSink(fn: ShakeFn | null): void {
  shakeSink = fn;
}

/** The decals/roads module publishes its scorch writer here. */
export function setScorchSink(fn: ScorchSink | null): void {
  scorchSink = fn;
}

/** True once a real decal buffer is bound. Diagnostics for the boot log. */
export function hasScorchSink(): boolean {
  return scorchSink !== null;
}

/* ==========================================================================
 * 2. COOK-OFF SCHEDULER
 *
 * Bible §8.2: a structure death is followed by "a 3–5 s cook-off of 3–6
 * smaller 1.2 TL fireballs at 250 ms intervals". Those cannot be emitted up
 * front, so a tiny fixed ring of pending detonations is stepped each frame.
 * ========================================================================== */

const MAX_PENDING = 64;

const pendX = new Float32Array(MAX_PENDING);
const pendY = new Float32Array(MAX_PENDING);
const pendZ = new Float32Array(MAX_PENDING);
const pendSize = new Float32Array(MAX_PENDING);
const pendDelay = new Float32Array(MAX_PENDING);
const pendActive = new Uint8Array(MAX_PENDING);
let pendCount = 0;

function schedule(x: number, y: number, z: number, sizeTL: number, delayMs: number): void {
  for (let i = 0; i < MAX_PENDING; i++) {
    if (pendActive[i] !== 0) continue;
    pendActive[i] = 1;
    pendX[i] = x; pendY[i] = y; pendZ[i] = z;
    pendSize[i] = sizeTL;
    pendDelay[i] = delayMs;
    pendCount++;
    return;
  }
  // Full: drop it. A 65th simultaneous cook-off is not a thing a player sees.
}

/** Advance the cook-off queue. Called once per rendered frame by the system. */
export function stepExplosions(dtMs: number): void {
  if (pendCount === 0) return;
  for (let i = 0; i < MAX_PENDING; i++) {
    if (pendActive[i] === 0) continue;
    pendDelay[i] -= dtMs;
    if (pendDelay[i] > 0) continue;
    pendActive[i] = 0;
    pendCount--;
    spawnExplosion(pendX[i], pendY[i], pendZ[i], pendSize[i], 'small');
  }
}

/** Drop every pending cook-off. Between matches. */
export function clearExplosions(): void {
  pendActive.fill(0);
  pendCount = 0;
}

/* ==========================================================================
 * 3. THE EXPLOSION
 * ========================================================================== */

export type ExplosionKind = 'small' | 'unit' | 'structure';

/**
 * The full RA3 detonation: white flash disc, 8–14 white-cored fireball billows,
 * a ground-flattened shockwave ring, a lit smoke plume, tumbling debris,
 * flickering embers, a scorch mark, a PointLight and camera trauma.
 *
 * @param sizeTL Fireball diameter in tank lengths. Unit death 2.2, structure
 *               death 5.0, cook-off 1.2. Defaults to the unit-death size.
 */
export function spawnExplosion(
  x: number, y: number, z: number,
  sizeTL: number = VFX_EXPLOSION.unitDeathTL,
  kind: ExplosionKind = 'unit',
): void {
  const P = particles();
  if (P === null) return;
  const X = VFX_EXPLOSION;
  const rng = presentationRng;
  // Everything in the bible's table is quoted for a 2.2 TL unit death.
  const k = sizeTL / X.unitDeathTL;
  const floor = groundHeight(x, z);

  /* -- 1. flash disc: additive pure white, peak 40 ms, gone by 140 ms ----- */
  let e = resetEmit();
  e.x = x; e.y = y; e.z = z;
  e.lifeMs = X.flashLifeMs;
  e.size0 = X.flashSize0TL * TL * k * GLOW.flashSize0Mul;
  e.size1 = X.flashSize1TL * TL * k * GLOW.flashSizeMul;
  e.sizeEase = 0.4;                        // most of the growth in the first frames
  // RADIAL, not life-driven: the disc must have a white-hot centre and a fast
  // falloff, not a uniform 7.0-gain plate. See the GLOW block above.
  e.ramp = VFX_RAMP.flash; e.tA = 0; e.tB = GLOW.flashRadialSpan; e.radial = 1;
  e.tile = VFX_TILE.core;
  e.i0 = X.flashIntensity; e.i1 = X.flashIntensity * 0.15;
  emitAdditive(e);
  // Structure deaths get the bible's separate 8 TL flash on top.
  if (kind === 'structure') {
    e = resetEmit();
    e.x = x; e.y = y + 1.5; e.z = z;
    e.lifeMs = X.flashLifeMs * 1.3;
    e.size0 = 3.0 * TL * GLOW.structureFlashMul;
    e.size1 = 8.0 * TL * GLOW.structureFlashMul;
    e.sizeEase = 0.35;
    e.ramp = VFX_RAMP.flash; e.tA = 0; e.tB = GLOW.flashRadialSpan; e.radial = 1;
    e.tile = VFX_TILE.soft;
    e.i0 = X.flashIntensity * 0.8; e.i1 = 0;
    emitAdditive(e);
  }

  /* -- 2. fireball: 8–14 billows, each with a WHITE RADIAL CORE ----------- */
  const billows = rng.int(X.billowMin, X.billowMax);
  const spread = X.billowSpread * k;
  for (let i = 0; i < billows; i++) {
    // Distribute on a squashed shell so the fireball reads as a mass, not a
    // ring: bias the vertical component up, because fire rises.
    const th = rng.range(0, Math.PI * 2);
    const ph = Math.acos(rng.range(-0.55, 1));
    const sx = Math.sin(ph) * Math.cos(th);
    const sy = Math.cos(ph);
    const sz = Math.sin(ph) * Math.sin(th);
    const v = rng.range(0.35, 1) * spread;

    e = resetEmit();
    // Born on a real shell, not all at the origin — see billowShellFrac.
    const shell = X.billowSize0TL * TL * k * X.billowShellFrac * rng.range(0.55, 1.15);
    e.x = x + sx * shell;
    e.y = y + sy * shell * 0.75 + 0.4;
    e.z = z + sz * shell;
    e.vx = sx * v; e.vy = sy * v * 0.85 + 1.2 * k; e.vz = sz * v;
    e.drag = 2.6;
    e.lifeMs = X.billowLifeMs * rng.range(0.75, 1.15);
    e.size0 = X.billowSize0TL * TL * k * GLOW.billowSizeMul * rng.range(0.8, 1.15);
    e.size1 = X.billowSize1TL * TL * k * GLOW.billowSizeMul * rng.range(0.85, 1.2);
    e.sizeEase = 0.55;
    // radial = 1 is the whole ballgame — see the header. The >1 span is what
    // keeps the orange fringe inside the sprite's visible alpha.
    e.ramp = VFX_RAMP.fireball; e.tA = 0; e.tB = X.billowRadialSpan; e.radial = 1;
    e.tile = (i & 1) === 0 ? VFX_TILE.billow : VFX_TILE.puffAlt;
    e.rot = rng.range(0, Math.PI * 2);
    e.rotVel = rng.range(-1, 1) * X.billowSpinDegPerSec * Math.PI / 180;
    e.i0 = X.billowIntensity; e.i1 = 0.35;
    emitAdditive(e);
  }

  /* -- 3. shockwave ring, flattened onto the ground ---------------------- */
  e = resetEmit();
  e.x = x; e.y = floor + 0.25; e.z = z;
  e.delayMs = X.shockDelayMs;
  e.lifeMs = X.shockLifeMs;
  e.size0 = X.shockSize0TL * TL * k;
  e.size1 = X.shockSize1TL * TL * k;
  e.sizeEase = 0.5;
  e.ramp = VFX_RAMP.shockwave; e.tA = 0; e.tB = 1;
  e.tile = VFX_TILE.shock;
  e.orient = 1;                            // lies in the XZ plane
  e.i0 = X.shockIntensity; e.i1 = 0.2;
  emitAdditive(e);

  /* -- 4. smoke plume: 14–22 LIT puffs over 5.5 s ------------------------ */
  const puffs = rng.int(X.puffMin, X.puffMax);
  for (let i = 0; i < puffs; i++) {
    const f = i / puffs;
    const th = rng.range(0, Math.PI * 2);
    const rad = rng.range(0, 1.1) * k * TL * 0.35;
    e = resetEmit();
    e.x = x + Math.cos(th) * rad;
    e.y = y + 0.6 + f * 1.6 * k;
    e.z = z + Math.sin(th) * rad;
    e.vx = Math.cos(th) * rng.range(0.3, 1.4) * k;
    e.vz = Math.sin(th) * rng.range(0.3, 1.4) * k;
    e.vy = X.puffRise * rng.range(0.7, 1.35);
    e.drag = 0.55;
    e.delayMs = X.puffDelayMs + f * 380;
    e.lifeMs = X.puffLifeMs * rng.range(0.7, 1.15);
    e.size0 = X.puffSize0TL * TL * k * 0.45 * GLOW.puffSizeMul;
    e.size1 = X.puffSize1TL * TL * k * GLOW.puffSizeMul * rng.range(0.8, 1.25);
    e.sizeEase = 0.65;
    e.ramp = VFX_RAMP.smokeDark; e.tA = 0; e.tB = 1;
    e.tile = (i % 3) === 0 ? VFX_TILE.lobe : (i & 1) === 0 ? VFX_TILE.billow : VFX_TILE.puffAlt;
    e.rot = rng.range(0, Math.PI * 2);
    e.rotVel = rng.range(-0.35, 0.35);
    // Bible §8.7's own base-to-top opacity curve, applied over the emission
    // index the loop already computes. `f` also drives the delay and the birth
    // height, so the later, higher, thinner puffs are exactly the ones that
    // thin out — which is what a column does.
    e.alpha = GLOW.puffAlphaBase + (GLOW.puffAlphaTop - GLOW.puffAlphaBase) * f;
    emitLit(e);
  }

  /* -- 5. debris: opaque tumbling chunks in a 55° cone -------------------- */
  const chunks = rng.int(X.debrisMin, X.debrisMax);
  const cone = X.debrisConeDeg * Math.PI / 180;
  const spin = X.debrisTumbleDegPerSec * Math.PI / 180;
  for (let i = 0; i < chunks; i++) {
    const th = rng.range(0, Math.PI * 2);
    const ph = rng.range(0, cone);
    const speed = rng.range(X.debrisSpeedTL[0], X.debrisSpeedTL[1]) * TL * (0.45 + 0.55 * k);
    P.debris.spawn(
      x, y + 0.5, z,
      Math.sin(ph) * Math.cos(th) * speed,
      Math.cos(ph) * speed,
      Math.sin(ph) * Math.sin(th) * speed,
      rng.range(X.debrisSize0TL, X.debrisSize1TL) * TL * k,
      X.debrisLifeMs * rng.range(0.7, 1.25),
      rng.range(-spin, spin), rng.range(-spin, spin), rng.range(-spin, spin),
      floor,
    );
  }

  /* -- 6. embers: additive pinpricks flickering at 18 Hz ------------------ */
  const embers = rng.int(X.emberMin, X.emberMax);
  for (let i = 0; i < embers; i++) {
    const th = rng.range(0, Math.PI * 2);
    const ph = rng.range(0, Math.PI * 0.75);
    const speed = rng.range(X.emberSpeedTL[0], X.emberSpeedTL[1]) * TL * k * 0.35;
    e = resetEmit();
    e.x = x; e.y = y + 0.5; e.z = z;
    e.vx = Math.sin(ph) * Math.cos(th) * speed;
    e.vy = Math.cos(ph) * speed;
    e.vz = Math.sin(ph) * Math.sin(th) * speed;
    e.gravity = 9.5; e.drag = 0.9;
    e.floorY = floor;
    e.lifeMs = X.emberLifeMs * rng.range(0.6, 1.3);
    e.size0 = X.emberSize0TL * TL * k;
    e.size1 = X.emberSize1TL * TL * k;
    e.ramp = VFX_RAMP.ember; e.tA = 0; e.tB = 1;
    e.tile = VFX_TILE.emberDot;
    e.flickerHz = X.emberFlickerHz;
    e.i0 = X.emberIntensity; e.i1 = 0.5;
    emitAdditive(e);
  }

  /* -- 7. scene light. NON-NEGOTIABLE (bible §8.9). ---------------------- */
  // Placed roughly a third of a fireball radius up, not at the blast origin.
  // A light sitting at ground level reaches the surrounding ground at a
  // grazing angle, so N.L collapses and most of its energy is spent lighting
  // nothing; lifting it trades a little inverse-square for a much better dot
  // product over the whole scorched circle.
  spawnLight(x, y + 1.6 * k + 1.4, z, VFX_LIGHTS.explosion, k);

  /* -- 8. scorch and shake ----------------------------------------------- */
  const scorchR = rng.range(X.scorchMinTL, X.scorchMaxTL) * TL * k * 0.5;
  emitScorch(x, z, floor, scorchR, rng.range(0, Math.PI));
  shakeSink?.(X.shakePerTL * sizeTL);

  /* -- 9. structure cook-off --------------------------------------------- */
  if (kind === 'structure') {
    const n = rng.int(X.cookOffMin, X.cookOffMax);
    for (let i = 0; i < n; i++) {
      schedule(
        x + rng.range(-1, 1) * TL * k * 0.4,
        y + rng.range(0, 2.5),
        z + rng.range(-1, 1) * TL * k * 0.4,
        X.cookOffTL,
        X.cookOffIntervalMs * (i + 1) + rng.range(-60, 60),
      );
    }
  }
}

/* ==========================================================================
 * 4. IMPACTS
 * ========================================================================== */

export type ImpactSurface = 'dirt' | 'metal' | 'concrete' | 'water';

/**
 * A projectile landing. `nx,ny,nz` is the incoming shot vector (the
 * `PresentationQueue.pushImpact` convention: impact minus shooter), used to
 * bias sprays back along the surface.
 */
export function spawnImpact(
  x: number, y: number, z: number,
  nx: number, ny: number, nz: number,
  surface: ImpactSurface = 'dirt',
  scale = 1,
): void {
  const rng = presentationRng;
  const floor = groundHeight(x, z);
  // Reflect the incoming vector so debris sprays back the way it came.
  const inv = 1 / Math.max(1e-4, Math.hypot(nx, ny, nz));
  const rx = -nx * inv, ry = -ny * inv, rz = -nz * inv;

  if (surface === 'metal') {
    sparkBurst(x, y, z, rx, ry, rz, scale);
    spawnLight(x, y, z, VFX_LIGHTS.impact, scale * 0.7);
    return;
  }

  if (surface === 'water') {
    spawnSplash(x, y, z, scale);
    return;
  }

  const dustRamp = VFX_RAMP.dust;
  const puffs = 4 + ((scale * 3) | 0);
  for (let i = 0; i < puffs; i++) {
    const th = rng.range(0, Math.PI * 2);
    const e = resetEmit();
    e.x = x; e.y = y + 0.15; e.z = z;
    e.vx = Math.cos(th) * rng.range(1.2, 4.5) * scale + rx * 1.5;
    e.vy = rng.range(1.5, 4.0) * scale + ry;
    e.vz = Math.sin(th) * rng.range(1.2, 4.5) * scale + rz * 1.5;
    e.drag = 1.9;
    e.floorY = floor;
    e.lifeMs = rng.range(700, 1500);
    e.size0 = 0.30 * scale; e.size1 = 1.6 * scale;
    e.sizeEase = 0.6;
    e.ramp = dustRamp; e.tA = 0; e.tB = 1;
    e.tile = (i & 1) === 0 ? VFX_TILE.billow : VFX_TILE.puffAlt;
    e.rot = rng.range(0, Math.PI * 2);
    e.rotVel = rng.range(-0.6, 0.6);
    e.alpha = surface === 'concrete' ? 0.75 : 1.0;
    emitLit(e);
  }

  // A brief hot flash: even a dirt hit is a detonation, and the frame is dark.
  const e = resetEmit();
  e.x = x; e.y = y + 0.2; e.z = z;
  e.lifeMs = 110;
  e.size0 = 0.8 * scale; e.size1 = 2.1 * scale; e.sizeEase = 0.45;
  e.ramp = VFX_RAMP.fireball; e.tA = 0; e.tB = VFX_EXPLOSION.billowRadialSpan; e.radial = 1;
  e.tile = VFX_TILE.billow;
  e.i0 = 3.2; e.i1 = 0.2;
  emitAdditive(e);

  // A handful of chips, and the light.
  const P = particles();
  if (P !== null) {
    const chips = 3 + ((scale * 4) | 0);
    for (let i = 0; i < chips; i++) {
      const th = rng.range(0, Math.PI * 2);
      const ph = rng.range(0, 1.0);
      const sp = rng.range(6, 16) * scale;
      P.debris.spawn(
        x, y + 0.2, z,
        Math.sin(ph) * Math.cos(th) * sp, Math.cos(ph) * sp, Math.sin(ph) * Math.sin(th) * sp,
        rng.range(0.10, 0.26) * scale, rng.range(600, 1200),
        rng.range(-9, 9), rng.range(-9, 9), rng.range(-9, 9),
        floor,
      );
    }
  }
  spawnLight(x, y + 0.4, z, VFX_LIGHTS.impact, scale);
}

/**
 * The armour-impact spark burst — bible §8.5 flags it as "frequently missed,
 * very characteristic": 30–45 straight thin streaks in a ~140° upward-biased
 * fan with a slight gravity droop, plus a 20 px white flash disc for 60 ms.
 */
export function sparkBurst(
  x: number, y: number, z: number,
  rx: number, ry: number, rz: number,
  scale = 1,
): void {
  const G = VFX_GUNS;
  const rng = presentationRng;
  const mpp = metresPerPixel();
  const n = rng.int(G.sparkMin, G.sparkMax);
  const half = (G.sparkFanDeg * 0.5) * Math.PI / 180;

  for (let i = 0; i < n; i++) {
    // Fan around the reflected direction, biased upward.
    const th = rng.range(-half, half);
    const ph = rng.range(-half * 0.45, half * 0.45);
    const ct = Math.cos(th), st = Math.sin(th);
    const dx = rx * ct - rz * st;
    const dz = rx * st + rz * ct;
    const dy = ry + Math.sin(ph) + 0.55;      // upward bias
    const inv = 1 / Math.max(1e-4, Math.hypot(dx, dy, dz));
    const sp = rng.range(G.sparkSpeed[0], G.sparkSpeed[1]) * scale;

    const lenPx = rng.range(G.sparkLenPx[0], G.sparkLenPx[1]);
    const wid = G.sparkWidthPx * mpp * 2.2;
    const e = resetEmit();
    e.x = x; e.y = y; e.z = z;
    e.vx = dx * inv * sp; e.vy = dy * inv * sp; e.vz = dz * inv * sp;
    e.gravity = G.sparkGravity;
    e.drag = 0.9;
    e.lifeMs = G.sparkLifeMs * rng.range(0.6, 1.15);
    e.size0 = wid; e.size1 = wid * 0.5;
    e.aspect = (lenPx * mpp) / Math.max(1e-4, wid);
    e.ramp = VFX_RAMP.spark; e.tA = 0; e.tB = 1;
    e.tile = VFX_TILE.spark;
    e.alignVel = 1;                            // the streak points where it goes
    e.i0 = G.sparkIntensity; e.i1 = 0.3;
    emitAdditive(e);
  }

  const e = resetEmit();
  e.x = x; e.y = y; e.z = z;
  e.lifeMs = G.sparkFlashMs;
  e.size0 = G.sparkFlashPx * mpp * 2 * scale;
  e.size1 = G.sparkFlashPx * mpp * 2.6 * scale;
  // Radial for the same reason the explosion flash is: a flat 6.0-gain disc,
  // however small, is a disc-shaped bloom source rather than a point one.
  e.ramp = VFX_RAMP.flash; e.tA = 0; e.tB = GLOW.flashRadialSpan; e.radial = 1;
  e.tile = VFX_TILE.core;
  e.i0 = 6.0; e.i1 = 0;
  emitAdditive(e);
}

/** Water hit: a filigree column, a ring on the surface and a light spray. */
export function spawnSplash(x: number, y: number, z: number, scale = 1): void {
  const rng = presentationRng;

  const ring = resetEmit();
  ring.x = x; ring.y = y + 0.06; ring.z = z;
  ring.lifeMs = 620;
  ring.size0 = 0.7 * scale; ring.size1 = 4.2 * scale; ring.sizeEase = 0.5;
  ring.ramp = VFX_RAMP.splash; ring.tile = VFX_TILE.ring; ring.orient = 1;
  ring.i0 = 1.6; ring.i1 = 0.1;
  emitAdditive(ring);

  const n = 8 + ((scale * 6) | 0);
  for (let i = 0; i < n; i++) {
    const th = rng.range(0, Math.PI * 2);
    const sp = rng.range(2.5, 8) * scale;
    const e = resetEmit();
    e.x = x; e.y = y + 0.1; e.z = z;
    e.vx = Math.cos(th) * sp * 0.5;
    e.vy = rng.range(4, 11) * scale;
    e.vz = Math.sin(th) * sp * 0.5;
    e.gravity = 16;
    e.floorY = y;
    e.lifeMs = rng.range(500, 1100);
    e.size0 = 0.35 * scale; e.size1 = 1.0 * scale;
    e.ramp = VFX_RAMP.splash; e.tA = 0; e.tB = 1;
    e.tile = (i & 1) === 0 ? VFX_TILE.filigree : VFX_TILE.billow;
    e.rot = rng.range(0, Math.PI * 2);
    e.i0 = 1.35; e.i1 = 0.6;
    e.alpha = 0.9;
    emitLit(e);
  }
}

/* ==========================================================================
 * 5. SMOKE COLUMNS AND DUST
 * ========================================================================== */

/**
 * A rising smoke column. Bible §8.7: **8–14 visible discrete lobes**, rising
 * 1.9–2.7 TL, widening from a 30 px base to 90–110 px at the top — the ≥3×
 * widening is an explicit acceptance test, so the lobe sizes here interpolate
 * `baseRadiusM -> topRadiusM` by height fraction rather than by age.
 *
 * @param heightTL How far the column climbs, in tank lengths.
 * @param tint     0 = near-black wreck smoke, 1 = light warm dust.
 * @param spreadMs Stagger between the first and last lobe.
 */
export function spawnSmokeColumn(
  x: number, y: number, z: number,
  heightTL = 2.3, tint = 0, spreadMs = 900, scale = 1,
): void {
  const S = VFX_SMOKE;
  const rng = presentationRng;
  const lobes = rng.int(S.lobeMin, S.lobeMax);
  const rise = heightTL * TL;
  const climbSpeed = rise / (S.lobeLifeMs * 0.001);

  for (let i = 0; i < lobes; i++) {
    const f = i / Math.max(1, lobes - 1);
    const e = resetEmit();
    // Lobes are born at the base and climb; the delay is what makes them read
    // as a continuous column rather than a firework.
    e.x = x + rng.range(-0.35, 0.35) * scale;
    e.y = y + 0.25;
    e.z = z + rng.range(-0.35, 0.35) * scale;
    e.vx = rng.range(-0.55, 0.55) * scale;
    e.vy = climbSpeed * rng.range(0.85, 1.2);
    e.vz = rng.range(-0.55, 0.55) * scale;
    e.drag = 0.32;
    e.delayMs = f * spreadMs;
    e.lifeMs = S.lobeLifeMs * rng.range(0.8, 1.2);
    e.size0 = S.baseRadiusM * 2 * scale;
    e.size1 = S.topRadiusM * 2 * scale * rng.range(0.85, 1.25);
    e.sizeEase = 0.72;
    e.ramp = tint > 0.5 ? VFX_RAMP.dust : VFX_RAMP.smokeDark;
    e.tA = 0; e.tB = 1;
    e.tile = (i % 3) === 0 ? VFX_TILE.lobe : (i & 1) === 0 ? VFX_TILE.billow : VFX_TILE.puffAlt;
    e.rot = rng.range(0, Math.PI * 2);
    e.rotVel = rng.range(-0.3, 0.3);
    // Opacity 0.85 at the base -> 0.15 at the top (bible §8.7).
    e.alpha = S.opacityBase + (S.opacityTop - S.opacityBase) * f;
    emitLit(e);
  }
}

/** One damage wisp: the 65–33% health state. Cheap, called on a timer. */
export function spawnDamageWisp(x: number, y: number, z: number, scale = 1): void {
  const S = VFX_SMOKE;
  const rng = presentationRng;
  // Same back-pressure as tread dust: a lightly damaged unit's wisp is the
  // least important thing in a burning frame.
  const P = particles();
  if (P !== null && P.lit.pressure > VFX_LIT_PRESSURE_CUTOFF) return;
  const e = resetEmit();
  e.x = x + rng.range(-0.3, 0.3); e.y = y; e.z = z + rng.range(-0.3, 0.3);
  e.vy = (S.wispRiseTL * TL) / 2.4;
  e.vx = rng.range(-0.3, 0.3); e.vz = rng.range(-0.3, 0.3);
  e.drag = 0.45;
  e.lifeMs = 2400;
  e.size0 = 0.45 * scale; e.size1 = 2.0 * scale; e.sizeEase = 0.7;
  e.ramp = VFX_RAMP.rocketSmoke; e.tA = 0; e.tB = 1;
  e.tile = VFX_TILE.puffAlt;
  e.rot = rng.range(0, Math.PI * 2);
  e.alpha = S.wispAlpha;
  emitLit(e);
}

/**
 * The 32–1% health state: a black puff plus 2–4 flame tongues flickering at
 * 12 Hz on the hull, and a flickering ember-orange light.
 */
export function spawnDamageFire(x: number, y: number, z: number, scale = 1): void {
  const S = VFX_SMOKE;
  const rng = presentationRng;

  const smoke = resetEmit();
  smoke.x = x + rng.range(-0.35, 0.35); smoke.y = y; smoke.z = z + rng.range(-0.35, 0.35);
  smoke.vy = 2.3; smoke.vx = rng.range(-0.4, 0.4); smoke.vz = rng.range(-0.4, 0.4);
  smoke.drag = 0.42;
  smoke.lifeMs = 3000;
  smoke.size0 = 0.55 * scale; smoke.size1 = 3.0 * scale; smoke.sizeEase = 0.7;
  smoke.ramp = VFX_RAMP.smokeDark; smoke.tA = 0; smoke.tB = 1;
  smoke.tile = VFX_TILE.billow;
  smoke.rot = rng.range(0, Math.PI * 2);
  smoke.alpha = 0.88;
  emitLit(smoke);

  const tongues = rng.int(S.tongueMin, S.tongueMax);
  for (let i = 0; i < tongues; i++) {
    const h = rng.range(S.tongueTL[0], S.tongueTL[1]) * TL * scale;
    const e = resetEmit();
    e.x = x + rng.range(-0.5, 0.5) * scale;
    e.y = y + h * 0.35;
    e.z = z + rng.range(-0.5, 0.5) * scale;
    e.vy = 1.4;
    e.lifeMs = rng.range(280, 460);
    e.size0 = h * 0.55; e.size1 = h * 0.28; e.sizeEase = 1.2;
    e.aspect = 1.9;
    // A HULL FLAME IS ORANGE, NOT WHITE. Bible §8.8 gives these tongues
    // `#FFB020 -> #FF6A00`; the white-cored fireball ramp belongs to a
    // detonation. Rendering a burning tank as a cluster of small white
    // fireballs is what makes a battlefield read as a particle demo — the
    // ember ramp starts at #FFC24A and never goes near pure white.
    e.ramp = VFX_RAMP.ember; e.tA = 0.18; e.tB = 1; e.radial = 0;
    e.tile = VFX_TILE.billow;
    e.flickerHz = S.tongueFlickerHz;
    e.i0 = 1.9; e.i1 = 0.35;
    emitAdditive(e);
  }

  // Bible §8.9's burning-wreck light is a SUSTAINED flicker, but this function
  // is called every 220 ms by the damage scan. Claiming a light on every puff
  // would pin the whole 12-light pool on smouldering hulls and force every
  // explosion to fight for a slot. The envelope already runs ~800 ms, so a
  // third of the puffs gives continuous coverage at a third of the pressure.
  if (rng.chance(0.34)) spawnLight(x, y + 0.8, z, VFX_LIGHTS.burning, scale);
}

/**
 * Tread dust. Bible §8.10: `#C6C6C0`, alpha 0.40–0.55, r 10→32 px, life 2.8 s,
 * one puff per track every 0.15 s while moving; on paving, alpha 0.18 and 60%
 * radius.
 */
export function spawnDust(x: number, y: number, z: number, scale = 1, onPaving = false): void {
  const D = VFX_GROUND;
  const rng = presentationRng;
  // Tread dust is the cheapest, most frequent emission in the game: thirty
  // moving vehicles at two puffs per 150 ms with a 2.8 s life is ~1100 live
  // sprites on its own. Left unchecked it fills the lit pool and an explosion's
  // plume — the effect that actually matters — gets nothing. So it stands down
  // first. Measured: the original split dropped 16 000 emissions in a minute.
  const P = particles();
  if (P !== null && P.lit.pressure > VFX_LIT_PRESSURE_CUTOFF) return;
  const e = resetEmit();
  e.x = x + rng.range(-0.25, 0.25);
  e.y = y + 0.10;
  e.z = z + rng.range(-0.25, 0.25);
  e.vx = rng.range(-0.5, 0.5); e.vy = rng.range(0.25, 0.8); e.vz = rng.range(-0.5, 0.5);
  e.drag = 1.1;
  e.floorY = y;
  e.lifeMs = D.dustLifeMs * rng.range(0.75, 1.15);
  const rmul = (onPaving ? D.pavingRadiusMul : 1) * scale;
  e.size0 = D.dustSize0 * rmul; e.size1 = D.dustSize1 * rmul;
  e.sizeEase = 0.65;
  e.ramp = VFX_RAMP.dust; e.tA = 0; e.tB = 1;
  e.tile = (rng.next() < 0.5) ? VFX_TILE.billow : VFX_TILE.puffAlt;
  e.rot = rng.range(0, Math.PI * 2);
  e.rotVel = rng.range(-0.4, 0.4);
  e.alpha = rng.range(D.dustAlpha[0], D.dustAlpha[1]) * (onPaving ? D.pavingAlphaMul : 1);
  emitLit(e);
}

/* ==========================================================================
 * 6. SCORCH HANDOFF
 * ========================================================================== */

/**
 * Hand the scorch to the decal module. If nothing has registered a sink — the
 * decals/roads module has not landed — fall back to a long-lived ground-plane
 * sprite so a fought-over field is never pristine, and say so ONCE.
 *
 * The fallback is deliberately NOT equivalent: it lives 40 s, not forever, and
 * it costs a slot in the 700-particle lit pool. It exists so the frame reads
 * correctly today, not so anyone can skip building the real decal buffer.
 */
function emitScorch(x: number, z: number, floorY: number, radius: number, rotation: number): void {
  if (scorchSink !== null) {
    // `radius` is already the semi-major axis: `scorchMinTL..scorchMaxTL` is
    // the bible's MAJOR-axis figure in tank lengths and the caller has already
    // halved it. Passing `radius * 2` here doubled every mark. See ScorchSink.
    scorchSink(x, z, radius, rotation);
    return;
  }
  if (!scorchWarned) {
    scorchWarned = true;
    console.info(
      '[vfx] no scorch decal sink registered — using a 40 s ground-sprite fallback. ' +
      'The decals module should call setScorchSink() from src/vfx/Explosions.',
    );
  }
  const e = resetEmit();
  e.x = x; e.y = floorY + 0.06; e.z = z;
  e.lifeMs = 40000;
  e.size0 = radius * 2 * 0.85; e.size1 = radius * 2; e.sizeEase = 0.25;
  e.aspect = 1 / VFX_EXPLOSION.scorchAspect;
  e.ramp = VFX_RAMP.smokeDark; e.tA = 0.02; e.tB = 0.02;
  e.tile = VFX_TILE.soft;
  e.orient = 1;
  e.rot = rotation;
  e.alpha = 0.55;
  emitLit(e);
}

/* ==========================================================================
 * 7. HELPERS
 * ========================================================================== */

/**
 * Metres per reference pixel at the camera's focus. Bible figures quoted in px
 * (spark streak lengths, flash disc radii) resolve through here. Falls back to
 * the measured 0.036 m/px of a default-zoom 1440p frame before the beam system
 * has told us the real camera depth.
 */
let mppCache = 0.036;

/** The VFX system pushes the live value once per frame. */
export function setMetresPerPixel(v: number): void {
  if (v > 0 && Number.isFinite(v)) mppCache = v;
}

export function metresPerPixel(): number {
  return mppCache;
}
