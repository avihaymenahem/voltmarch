/**
 * ============================================================================
 * VOLTMARCH — src/vfx/vfx.system.ts
 * ============================================================================
 * THE VFX PLUGIN. Owns the frame, drains the PresentationQueue, drives every
 * pool, and is the single import surface the rest of the game needs.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE PresentationQueue ORDERING BUG THE FOUNDATION FLAGGED
 * ────────────────────────────────────────────────────────────────────────────
 * `core/events.ts` builds a `PresentationQueue` and `core/loop.ts` calls
 * `channels.fx.clear()` unconditionally at the end of every rendered frame:
 *
 *     this.registry.runFrame(rc);     // <- every frame() in renderPhase order
 *     this.hooks.render?.(rc);        // <- Bootstrap: camera, shadow fit, present
 *     this.channels.fx.clear();       // <- the queue is emptied HERE
 *
 * So until something drained it, everything pushed to `channels.fx` was
 * silently discarded. THIS MODULE IS THAT CONSUMER.
 *
 * **The drain happens in `frame()` at `RenderPhase.Vfx` (60).** That is inside
 * `registry.runFrame`, which is strictly before `channels.fx.clear()`, so the
 * ordering holds by construction — there is no render phase a `frame()` can
 * run in that is *after* the clear. Vfx (60) rather than something earlier
 * because it is also strictly after `RenderPhase.Bridge` (30), which is what
 * makes `socketWorld()` return THIS frame's barrel transform: a muzzle flash
 * is never a frame behind the gun that fired it.
 *
 * It is verified, not asserted. `init()` pushes one sentinel event into
 * `channels.fx`; the first `frame()` reports whether it arrived, and
 * `tests/vfx.spec.ts` reproduces the whole loop headless. If anybody ever
 * moves the clear, both go red.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT RUNS EACH FRAME, IN ORDER
 * ────────────────────────────────────────────────────────────────────────────
 *   1. drain `channels.fx`            - sim intent becomes effects
 *   2. damage-state scan (sliced)     - bible §8.8 wisps, fires, tread dust
 *   3. cook-off queue                 - delayed structure secondaries
 *   4. lights                         - envelopes, eviction, the ground wash
 *   5. beams / tracers / particles    - integrate and upload
 *   6. shader sync                    - sun, sky and the dominant VFX light
 * ============================================================================
 */

import * as THREE from 'three';

import { defineSystem } from '../core/loop';
import {
  MAX_ENTITIES, VFX_BUILDING_LIFE, VFX_EXPLOSION, VFX_GROUND, VFX_LIGHT_POOL, VFX_LIGHT_POOL_BY_TIER,
  VFX_RAMP, VFX_RAMPS, VFX_SMOKE, VFX_TILE, WATER_LEVEL,
} from '../core/config';
import {
  DecalKind, EntityFlag, EntityKind, Faction, FxKind, NONE, PartId, RenderPhase,
} from '../core/types';
import { DecalKind as WorldDecalKind, layDecal, layRubbleStory } from '../world/Decals';
import type { EntityId, RenderContext } from '../core/types';
import { ctx } from '../game/context';
import { renderBridge, socketWorld } from '../render/RenderBridge';

import {
  clearFlashBudget, glareAttenuatedCount, glareSpotCount, stepFlashBudget,
} from './FlashBudget';
import { LightPool, setLightPool } from './LightPool';
import { ParticleSystem, resetEmit, setParticleSystem } from './Particles';
import { BeamSystem, setBeamSystem } from './Beams';
import { TracerSystem, setTracerSystem, spawnMuzzleFlash, spawnTrail } from './Tracers';
import {
  clearExplosions, hasScorchSink, setGroundHeightFn, setMetresPerPixel,
  setShakeSink, spawnCollectorMote, spawnDamageFire, spawnDamageWisp, spawnDust,
  spawnExplosion, spawnImpact, spawnMachineSparks, spawnSmokeColumn, spawnSplash,
  spawnSteamPuff, stepExplosions,
} from './Explosions';

/* -------------------------------------------------------------------------- */
/* Module state. Created in init(), torn down in dispose().                    */
/* -------------------------------------------------------------------------- */

let lights: LightPool | null = null;
let sprites: ParticleSystem | null = null;
let beams: BeamSystem | null = null;

/**
 * `core/types.ts` DecalKind -> `world/Decals.ts` DecalKind.
 *
 * TWO ENUMS, DIFFERENT NUMBERING, and neither file mentions the other. The sim
 * speaks the first; the decal field speaks the second. Written out as an
 * explicit map rather than a cast because the values collide in the worst
 * possible way — core's `Scorch = 0` is the field's `Tread = 0`, so a straight
 * pass-through would have laid a tyre mark where a tank exploded and a tread
 * strip where a nuke landed, and both would have looked like "the decals are
 * a bit odd" rather than like a bug.
 *
 * `TreadMark`, `FootPrint` and `OreStain` have no counterpart: treads are laid by
 * `layTread` straight from Movement and the other two were never drawn.
 * `undefined` means "drop it", which is what they were already doing.
 *
 * `Squish` USED TO BE ON THAT LIST and no longer is. Infantry crushing shipped —
 * `unitsCrushed` moves, `FxKind.CrushSquish` fires, `SFX.crush` plays — so the
 * game grew a verb that flattens a man under a track and left the ground
 * untouched, because the field enum had no tile and this map dropped the kind
 * silently. `world/Decals.ts` now owns atlas tile 10 and the mapping is real.
 */
const DECAL_PORT_MAP: Readonly<Record<number, WorldDecalKind>> = {
  [DecalKind.Scorch]: WorldDecalKind.Scorch,
  [DecalKind.Crater]: WorldDecalKind.Crater,
  [DecalKind.Squish]: WorldDecalKind.Squish,
};
let shots: TracerSystem | null = null;

/** Scratch, allocated once. The frame loop must not allocate. */
const _dominant = new Float32Array(7);
const _socket = new Float32Array(7);
const _camPos = new THREE.Vector3();

/**
 * Per-entity cooldowns for the damage-state and tread-dust emitters. These are
 * RENDER-side clocks in wall-clock milliseconds, deliberately not part of the
 * simulation: a machine rendering at 30 fps must not smoke differently from one
 * at 144 fps, and neither may perturb the sim RNG.
 */
const damageTimer = new Float32Array(MAX_ENTITIES);
const dustTimer = new Float32Array(MAX_ENTITIES);
/** Negative means an eligible building has not received its seeded first delay. */
const buildingLifeTimer = new Float32Array(MAX_ENTITIES);
/** Generation stamp prevents a recycled entity slot inheriting an old vent cycle. */
const buildingLifeGen = new Uint16Array(MAX_ENTITIES);
/** Rolling cursor for the round-robin damage scan. */
let scanCursor = 0;

/** Sentinel pushed into channels.fx at init to prove the drain ordering. */
const PROBE_SCALE = -12345;
let probePending = false;
let probeReported = false;

/** Cumulative diagnostics, surfaced through `__VM.counters` and the boot log. */
let drainedTotal = 0;

/**
 * Deterministic time control for the screenshot harness.
 *
 * Effects are the one part of the render that cannot be critiqued from a static
 * capture: a fireball is gone in 750 ms and a muzzle flash in 90, so under a
 * software rasteriser (where a frame can take seconds) every transient effect
 * has expired before the shutter opens. `timeScale = 0` freezes the pools where
 * they stand and `advance(ms)` steps them by an EXACT amount, so
 * "screenshot the fireball at its 220 ms peak" is reproducible on any machine.
 * Both default to normal play and are only ever touched through `__vmVfx`.
 *
 * THIS IS THE AD-HOC PROBE PATH, NOT THE FIXTURE PATH. `tools/flash-stack.mjs`
 * uses it to hold one explosion at 220 ms and photograph it. A fixture wants
 * the whole world advanced, not just the pools, and for that
 * `__VM.advanceTicks(n)` runs the simulation and a complete system frame in
 * lockstep — see `GameLoop.advanceTicks`. Ageing the pools without stepping the
 * sim that spawns into them is exactly how the two fall out of step.
 */
let timeScale = 1;
let pendingAdvanceMs = 0;

/* -------------------------------------------------------------------------- */
/* PresentationQueue -> effects                                               */
/* -------------------------------------------------------------------------- */

/**
 * Turn one queued FX record into effects.
 *
 * Two conventions the queue itself fixes and every producer must follow:
 *   - `push()` carries a DIRECTION (usually the shot vector) in `d*`.
 *   - `pushImpact()` sets `d* = impact − shooter`, so for a beam or arc the
 *     ORIGIN is `pos − d`. That is how `TeslaArc` and `PrismBeam` recover both
 *     endpoints from a single record.
 */
function dispatch(
  kind: FxKind,
  x: number, y: number, z: number,
  dx: number, dy: number, dz: number,
  scale: number,
  source: number,
  faction: Faction,
): void {
  // Allied guns fire the cold `#FFFFFF -> #C8E4FF -> #6FA8FF` tracer palette;
  // everyone else gets the warm one. Bible §8.5.
  const cold = faction === Faction.Allies;
  const src = source as unknown as EntityId;

  switch (kind) {
    case FxKind.MuzzleFlashSmall:
    case FxKind.MuzzleFlashMedium:
    case FxKind.MuzzleFlashLarge:
    case FxKind.MuzzleFlashFlak:
    case FxKind.MuzzleFlashArtillery: {
      // EXPLICIT, not arithmetic. This was `kind - MuzzleFlashSmall`, which
      // only works while the three sizes are contiguous — the two kinds added
      // for flak and artillery sit at the end of the enum (appending is the
      // only safe way to extend it), so the subtraction would have yielded 33
      // and 34 and indexed off the end of the flash table.
      const size: 0 | 1 | 2 =
        kind === FxKind.MuzzleFlashSmall ? 0
          : kind === FxKind.MuzzleFlashMedium || kind === FxKind.MuzzleFlashFlak ? 1
            : 2;
      // Prefer the real barrel socket: valid from RenderPhase.Bridge onward, so
      // the flash sits on the muzzle even while the turret is slewing.
      if (source !== NONE && socketWorld(src, PartId.MuzzleA, _socket)) {
        spawnMuzzleFlash(
          _socket[0], _socket[1], _socket[2],
          _socket[3], _socket[4], _socket[5], size, scale,
        );
      } else {
        spawnMuzzleFlash(x, y, z, dx, dy, dz, size, scale);
      }
      return;
    }

    case FxKind.TracerBullet:
      shots?.burst(x, y, z, dx, dy, dz, 4, cold, 90 * scale);
      return;

    case FxKind.TracerCannon:
      shots?.spawn(x, y, z, dx, dy, dz, 'cannon', cold, 120 * scale);
      return;

    case FxKind.RocketTrail:
      spawnTrail(x, y, z, dx, dy, dz, true, scale);
      return;

    case FxKind.TeslaArc:
      // pushImpact convention: the coil sits at pos − d.
      beams?.spawnTesla(x - dx, y - dy, z - dz, x, y, z, undefined, src, NONE, scale);
      return;

    case FxKind.PrismBeam:
      beams?.spawnBeam(x - dx, y - dy, z - dz, x, y, z, 'prism', -1, src, NONE);
      return;

    case FxKind.FlameJet:
      flameJet(x, y, z, dx, dy, dz, scale);
      return;

    case FxKind.ImpactDirt:     spawnImpact(x, y, z, dx, dy, dz, 'dirt', scale); return;
    case FxKind.ImpactMetal:    spawnImpact(x, y, z, dx, dy, dz, 'metal', scale); return;
    case FxKind.ImpactConcrete: spawnImpact(x, y, z, dx, dy, dz, 'concrete', scale); return;
    case FxKind.ImpactWater:    spawnImpact(x, y, z, dx, dy, dz, 'water', scale); return;

    case FxKind.ExplosionSmall:    spawnExplosion(x, y, z, 1.2 * scale, 'small'); return;
    case FxKind.ExplosionMedium:   spawnExplosion(x, y, z, 2.2 * scale, 'unit'); return;
    case FxKind.ExplosionLarge:    spawnExplosion(x, y, z, 3.4 * scale, 'unit'); return;
    case FxKind.ExplosionBuilding: spawnExplosion(x, y, z, 5.0 * scale, 'structure'); return;

    case FxKind.SmokePlumeSmall: spawnSmokeColumn(x, y, z, 1.4, 0, 700, scale); return;
    case FxKind.SmokePlumeLarge: spawnSmokeColumn(x, y, z, 2.6, 0, 1100, scale); return;

    case FxKind.DustPuff:
    case FxKind.DustTrail:
      // DustTrail is the paving variant: alpha 0.18 and 60% radius (§8.10).
      spawnDust(x, y, z, scale, kind === FxKind.DustTrail);
      return;

    case FxKind.ShellCasing:
      sprites?.debris.spawn(x, y, z, dx * 2 + 1.5, 3.5, dz * 2, 0.12, 900, 12, 9, 14, y - 1.2);
      return;

    case FxKind.Debris:
      spawnImpact(x, y, z, dx, dy, dz, 'concrete', scale);
      return;

    case FxKind.Sparks:
      spawnImpact(x, y, z, dx, dy, dz, 'metal', scale);
      return;

    case FxKind.RepairSpark:
      spawnImpact(x, y, z, dx, dy, dz, 'metal', scale * 0.45);
      return;

    case FxKind.Embers:
      spawnExplosion(x, y, z, 0.6 * scale, 'small');
      return;

    case FxKind.BuildComplete:
    case FxKind.BuildRise:
    case FxKind.SellPuff:
      groundPulse(x, y, z, scale, kind === FxKind.BuildComplete);
      return;

    case FxKind.OreSparkle:
      oreSparkle(x, y, z, scale);
      return;

    case FxKind.CrushSquish:
    case FxKind.UnitDeathInfantry:
      spawnDust(x, y, z, scale * 1.4, false);
      spawnImpact(x, y, z, dx, dy, dz, 'dirt', scale * 0.5);
      return;

    case FxKind.Splash:
      spawnSplash(x, y, z, scale);
      return;

    default:
      // FxKind.None and the boot probe land here on purpose.
      return;
  }
}

/** A short cone of fire: the flamethrower / napalm look. */
function flameJet(
  x: number, y: number, z: number,
  dx: number, dy: number, dz: number,
  scale: number,
): void {
  const P = sprites;
  if (P === null) return;
  const inv = 1 / Math.max(1e-4, Math.hypot(dx, dy, dz));
  const ux = dx * inv, uy = dy * inv, uz = dz * inv;
  for (let i = 0; i < 7; i++) {
    const f = i / 7;
    const e = resetEmit();
    e.x = x + ux * f * 3 * scale;
    e.y = y + uy * f * 3 * scale;
    e.z = z + uz * f * 3 * scale;
    e.vx = ux * 11 * scale; e.vy = uy * 11 * scale + 1.2; e.vz = uz * 11 * scale;
    e.drag = 3.2;
    e.lifeMs = 320 + f * 260;
    e.size0 = 0.28 * scale * (1 + f * 0.8);
    e.size1 = 0.65 * scale * (1 + f * 1.2);
    e.sizeEase = 0.72;
    e.aspect = 2.6;
    // A projected teardrop along the velocity reads as a flame jet. The old
    // radial billow made this seven expanding orange circles in a row.
    e.ramp = VFX_RAMP.rocketFlame; e.tA = 0.02; e.tB = 0.92; e.radial = 0;
    e.tile = VFX_TILE.kite;
    e.alignVel = 1;
    e.i0 = 2.8; e.i1 = 0.25;
    P.additive.emit(e);
  }
}

/** A ground-hugging pulse: construction complete, structure rise, sale. */
function groundPulse(x: number, y: number, z: number, scale: number, bright: boolean): void {
  const P = sprites;
  if (P === null) return;
  const ring = resetEmit();
  ring.x = x; ring.y = y + 0.12; ring.z = z;
  ring.lifeMs = 900;
  ring.size0 = 2 * scale; ring.size1 = 11 * scale; ring.sizeEase = 0.5;
  ring.ramp = VFX_RAMP.shockwave; ring.tile = VFX_TILE.ring; ring.orient = 1;
  ring.i0 = bright ? 2.4 : 0.9; ring.i1 = 0.05;
  P.additive.emit(ring);
  for (let i = 0; i < 8; i++) {
    const th = (i / 8) * Math.PI * 2;
    spawnDust(x + Math.cos(th) * 2.5 * scale, y, z + Math.sin(th) * 2.5 * scale, scale * 1.3, false);
  }
}

/** One glinting ore crystal. Cheap, because there are a great many. */
function oreSparkle(x: number, y: number, z: number, scale: number): void {
  const P = sprites;
  if (P === null) return;
  const e = resetEmit();
  e.x = x; e.y = y + 0.25; e.z = z;
  e.lifeMs = 520;
  e.size0 = 0.05 * scale; e.size1 = 0.45 * scale; e.sizeEase = 0.4;
  e.ramp = VFX_RAMP.spark; e.tile = VFX_TILE.flare;
  e.i0 = 3.0; e.i1 = 0;
  P.additive.emit(e);
}

/* -------------------------------------------------------------------------- */
/* Damage states and tread dust                                               */
/* -------------------------------------------------------------------------- */

function buildingLifeInterval(faction: Faction): number {
  switch (faction) {
    case Faction.Allies: return VFX_BUILDING_LIFE.alliedIntervalMs;
    case Faction.Soviets: return VFX_BUILDING_LIFE.sovietIntervalMs;
    case Faction.Meridian: return VFX_BUILDING_LIFE.meridianIntervalMs;
    case Faction.Reclaim: return VFX_BUILDING_LIFE.reclaimIntervalMs;
    default: return 0;
  }
}

/**
 * Low-frequency, healthy building activity. Damage smoke owns unhealthy
 * structures; this path explicitly excludes them and never emits a column.
 */
function buildingLife(i: number, hpFraction: number, chargedMs: number): void {
  const { world } = ctx();
  const s = world.store;
  const flags = s.flags[i];
  const faction = s.faction[i] as Faction;
  if (buildingLifeGen[i] !== s.gen[i]) {
    buildingLifeGen[i] = s.gen[i];
    buildingLifeTimer[i] = -1;
  }
  const interval = buildingLifeInterval(faction);
  const substantial = s.footprintW[i] >= 2 || s.footprintH[i] >= 2;
  const unpowered = (flags & EntityFlag.NeedsPower) !== 0 && (flags & EntityFlag.Powered) === 0;
  const hidden = renderBridge()?.visibility?.isRenderHiddenAt(i) ?? false;
  if (
    interval <= 0 || !substantial || unpowered || hidden
    || hpFraction < VFX_BUILDING_LIFE.minHpFraction
    || (flags & (EntityFlag.UnderConstruction | EntityFlag.Burning)) !== 0
    || s.buildProgress[i] < 1
  ) {
    buildingLifeTimer[i] = -1;
    return;
  }

  // First contact seeds a quiet delay rather than making every structure puff
  // during the six scan slices immediately after a match loads.
  const seed = s.seed[i];
  const stagger = interval * (0.55 + seed * 0.70);
  if (buildingLifeTimer[i] < 0) {
    buildingLifeTimer[i] = stagger;
    return;
  }
  buildingLifeTimer[i] -= chargedMs;
  if (buildingLifeTimer[i] > 0) return;
  buildingLifeTimer[i] = interval * (0.75 + ((seed * 17.13) % 1) * 0.50);

  const yaw = s.yaw[i];
  const c = Math.cos(yaw), sn = Math.sin(yaw);
  const lx = s.footprintW[i] * 4 * 0.22;
  const lz = -s.footprintH[i] * 4 * 0.17;
  const x = s.posX[i] + lx * c + lz * sn;
  const z = s.posZ[i] - lx * sn + lz * c;
  const y = s.posY[i] + VFX_BUILDING_LIFE.roofBaseM
    + Math.max(s.footprintW[i], s.footprintH[i]) * VFX_BUILDING_LIFE.roofPerCellM;

  switch (faction) {
    case Faction.Allies:
      spawnSteamPuff(x, y, z, 0.62);
      break;
    case Faction.Soviets:
      spawnSteamPuff(x, y, z, 0.92);
      break;
    case Faction.Meridian:
      spawnCollectorMote(x, y + 0.25, z, 0.90);
      break;
    case Faction.Reclaim:
      spawnMachineSparks(x, y - 0.35, z, 0.92);
      if (seed > 0.62) spawnSteamPuff(x - 0.35, y - 0.15, z + 0.20, 0.58);
      break;
  }
}

/**
 * Bible §8.8. Health 65–33% gets a thin grey wisp every 600 ms; 32–1% gets a
 * black column every 220 ms plus 2–4 flame tongues and a flickering ember
 * light. Also lays tread dust behind anything that is moving (§8.10).
 *
 * Sliced round-robin across `VFX_SMOKE.damageScanSlice` frames: at 200 units
 * that is ~33 entities a frame, which is free, and no unit's smoke drifts by
 * more than a sixth of a frame.
 */
function damageScan(dtMs: number): void {
  const { world } = ctx();
  const s = world.store;
  const n = s.aliveCount;
  if (n === 0) return;

  const slice = Math.max(1, Math.ceil(n / VFX_SMOKE.damageScanSlice));
  // Each entity is touched once every `damageScanSlice` frames, so its timer
  // must be charged for all of the frames it was skipped.
  const charged = dtMs * VFX_SMOKE.damageScanSlice;

  for (let k = 0; k < slice; k++) {
    if (scanCursor >= n) scanCursor = 0;
    const i = s.alive[scanCursor++];

    const flags = s.flags[i];
    if ((flags & EntityFlag.Alive) === 0) continue;
    if ((flags & EntityFlag.PendingDestroy) !== 0) continue;
    const kind = s.kind[i];
    if (kind === EntityKind.Prop || kind === EntityKind.Crate) continue;

    const maxHp = s.maxHp[i];
    if (maxHp <= 0) continue;
    const frac = s.hp[i] / maxHp;
    const x = s.posX[i], y = s.posY[i], z = s.posZ[i];
    // Buildings are big: put their smoke on the roof, not at the foundation.
    const big = kind === EntityKind.Building;
    const lift = big ? 4.5 : 1.4;

    if (frac < VFX_SMOKE.burnThreshold || kind === EntityKind.Wreck) {
      damageTimer[i] -= charged;
      if (damageTimer[i] <= 0) {
        damageTimer[i] = VFX_SMOKE.burnIntervalMs;
        spawnDamageFire(x, y + lift, z, big ? 2.2 : 1);
      }
    } else if (frac < VFX_SMOKE.wispThreshold) {
      damageTimer[i] -= charged;
      if (damageTimer[i] <= 0) {
        damageTimer[i] = VFX_SMOKE.wispIntervalMs;
        spawnDamageWisp(x, y + lift, z, big ? 1.8 : 1);
      }
    } else {
      damageTimer[i] = 0;
    }

    if (kind === EntityKind.Building) buildingLife(i, frac, charged);

    // TREAD DUST IS A GROUND EFFECT. `EntityKind.Vehicle` covers every ship and
    // every hovercraft in the game — `EntityKind` has no naval member — so
    // without the water test a destroyer under way laid two dust puffs per
    // interval across open sea. In `?shot=naval` that was six hulls steaming
    // for three seconds, and the result was a near-opaque pale sheet over a
    // third of the frame that ablation pinned on `VfxLitSmoke`. Sailing does
    // not raise dust.
    if (kind === EntityKind.Vehicle && s.speed[i] > 0.6 && y > WATER_LEVEL + 0.25) {
      dustTimer[i] -= charged;
      if (dustTimer[i] <= 0) {
        dustTimer[i] = VFX_GROUND.treadIntervalMs;
        // One puff per track, at the gauge, behind the hull.
        const c = Math.cos(s.yaw[i]), sn = Math.sin(s.yaw[i]);
        const gauge = 1.35;
        spawnDust(x + c * gauge - sn * 1.6, y, z - sn * gauge - c * 1.6, 1, false);
        spawnDust(x - c * gauge - sn * 1.6, y, z + sn * gauge - c * 1.6, 1, false);
      }
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Console / harness handle                                                   */
/* -------------------------------------------------------------------------- */

/**
 * `__vmVfx` — the scripting surface for the screenshot harness and the browser
 * console. VFX only exist for a fraction of a second, so there is no way to
 * critique them from a static scenario capture: the harness has to be able to
 * fire one and screenshot the next frame. Mirrors `__vmUnits` from the unit-art
 * module.
 */
interface VfxGlobal {
  __vmVfx?: {
    explode(x: number, y: number, z: number, sizeTL?: number, kind?: 'small' | 'unit' | 'structure'): void;
    tesla(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, ms?: number): void;
    /**
     * The IMPACT starburst on its own — the ball, the spikes and their light,
     * without the bolt.
     *
     * Added because `tools/flash-stack.mjs` could not reach it. Its arc sweep
     * called `tesla()`, which is the BOLT, so the starburst had never been
     * measured by the instrument built to police blue glare — the same gap that
     * hid the arc itself until v1.17.0.
     */
    teslaImpact(x: number, y: number, z: number, sizeMul?: number): void;
    beam(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, kind?: 'prism' | 'cryo' | 'designator'): void;
    muzzle(x: number, y: number, z: number, dx: number, dy: number, dz: number, size?: 0 | 1 | 2): void;
    impact(x: number, y: number, z: number, surface?: 'dirt' | 'metal' | 'concrete' | 'water'): void;
    trail(x: number, y: number, z: number, dx: number, dy: number, dz: number, hot?: boolean): void;
    smoke(x: number, y: number, z: number, heightTL?: number): void;
    tracer(x: number, y: number, z: number, dx: number, dy: number, dz: number, cannon?: boolean): void;
    stats(): Record<string, number>;
    clear(): void;
    /** 0 freezes every pool where it stands; 1 is normal play. */
    timeScale(s: number): void;
    /** Step every pool by an exact number of milliseconds on the next frame. */
    advance(ms: number): void;
  };
}

function installGlobal(): void {
  (globalThis as unknown as VfxGlobal).__vmVfx = {
    explode: (x, y, z, sizeTL = 2.2, kind = 'unit') => spawnExplosion(x, y, z, sizeTL, kind),
    tesla: (x0, y0, z0, x1, y1, z1, ms) => { beams?.spawnTesla(x0, y0, z0, x1, y1, z1, ms); },
    teslaImpact: (x, y, z, sizeMul = 1) => { beams?.teslaImpact(x, y, z, sizeMul); },
    beam: (x0, y0, z0, x1, y1, z1, kind = 'prism') => { beams?.spawnBeam(x0, y0, z0, x1, y1, z1, kind); },
    muzzle: (x, y, z, dx, dy, dz, size = 2) => spawnMuzzleFlash(x, y, z, dx, dy, dz, size),
    impact: (x, y, z, surface = 'metal') => spawnImpact(x, y, z, 0, -1, 0, surface, 1),
    trail: (x, y, z, dx, dy, dz, hot = true) => spawnTrail(x, y, z, dx, dy, dz, hot),
    smoke: (x, y, z, heightTL = 2.3) => spawnSmokeColumn(x, y, z, heightTL),
    tracer: (x, y, z, dx, dy, dz, cannon = false) =>
      shots?.spawn(x, y, z, dx, dy, dz, cannon ? 'cannon' : 'mg'),
    stats: () => ({
      additive: sprites?.additive.count ?? 0,
      lit: sprites?.lit.count ?? 0,
      debris: sprites?.debris.count ?? 0,
      lights: lights?.activeCount ?? 0,
      lightMerges: lights?.merges ?? 0,
      glareSpots: glareSpotCount(),
      glareDimmed: glareAttenuatedCount(),
      bolts: beams?.activeBolts ?? 0,
      beams: beams?.activeBeams ?? 0,
      tracers: shots?.count ?? 0,
      overlayQuads: beams?.overlay.quadCount ?? 0,
      depthQuads: beams?.depthed.quadCount ?? 0,
      branches: beams?.lastBranches ?? 0,
      loops: beams?.lastLoops ?? 0,
      drained: drainedTotal,
    }),
    clear: () => {
      sprites?.clear();
      beams?.clear();
      shots?.clear();
      lights?.clear();
      clearExplosions();
      // Without this a scripted capture inherits the previous case's glare load
      // and the first explosion of the run is dimmed — which would make this
      // probe measure the fix as a regression.
      clearFlashBudget();
    },
    timeScale: (s) => { timeScale = Math.max(0, s); },
    /*
     * ACCUMULATES. It used to assign, and that silently DROPPED work: a caller
     * that issued two advances before a frame consumed the first lost the
     * first one entirely.
     *
     * That is not hypothetical. `tools/shoot.mjs` steps a fixture one sim tick
     * and one `advance(SIM_DT)` per rendered frame, and whether a given advance
     * survived depended on how its `waitFrames(1)` happened to align with the
     * rAF that consumed it. Measured: `08-naval-water` median luminance moved
     * 0.5646 vs 0.5336 between two runs of identical code — WORSE than the
     * wall-clock sleep the deterministic path replaced, because a dropped
     * advance is a whole tick of ageing lost at random.
     *
     * "Advance by this much" must never lose any of it. Alignment then stops
     * mattering: coalescing two advances into one frame ages the pools by the
     * same total as consuming them separately.
     */
    advance: (ms) => { pendingAdvanceMs += Math.max(0, ms); },
  };
}

/* -------------------------------------------------------------------------- */
/* The system                                                                 */
/* -------------------------------------------------------------------------- */

export default defineSystem({
  id: 'vfx',
  // No simTick: nothing here may touch the simulation. VFX is downstream of it.
  renderPhase: RenderPhase.Vfx,
  order: 0,

  init(): void {
    const { sceneRig, cameraRig, world, channels } = ctx();

    // ORDER MATTERS: the pool is a prerequisite for the first effect, not
    // polish (bible §14 R6). Nothing else may be constructed before it.
    //
    // The size is fixed HERE, for the whole match: every light is resident in
    // the scene forever, so the count is compiled into every shader in the
    // world and cannot be changed later without a global recompile hitch.
    const tier = ctx().loop.quality as number;
    lights = new LightPool(VFX_LIGHT_POOL_BY_TIER[tier] ?? VFX_LIGHT_POOL);
    lights.attach(sceneRig.scene);
    setLightPool(lights);

    sprites = new ParticleSystem();
    sprites.attach(sceneRig.scene);
    setParticleSystem(sprites);

    // Beams share the particle system's ramp LUT — one 128x16 texture serves
    // fireballs, smoke, tesla and tracers alike.
    beams = new BeamSystem(sprites.ramps, VFX_RAMPS.length);
    beams.attach(sceneRig.scene);
    setBeamSystem(beams);

    // Tracers own the depth-TESTED ribbon batch; nothing else writes to it.
    shots = new TracerSystem(beams.depthed);
    setTracerSystem(shots);

    // Host hooks. Terrain owns the ground, the camera owns trauma; neither is
    // imported, they are handed in, so src/vfx never reaches sideways into
    // another module's files.
    setGroundHeightFn((x, z) => world.terrain.heightAt(x, z));
    setShakeSink((t) => cameraRig.addShake(t));

    /*
     * THE `world.vfx` PORT, WHICH NOTHING HAD EVER ASSIGNED.
     *
     * `World.vfx` is declared `IVfx = new NullVfx()` — a null object whose
     * every method is an empty body — and no module replaced it. TWENTY CALL
     * SITES across five sim modules were therefore silent no-ops for the whole
     * life of the project:
     *
     *   Abilities.ts    four `shake()` calls, one scorch decal
     *   Crates.ts       shake on pickup
     *   Damage.ts       three scorch decals, a rubble decal, three shakes
     *   Production.ts   BuildComplete and SellPuff
     *   RepairSell.ts   shake when a structure is sold
     *   Superweapons.ts the nuke's crater, its scorch, and its shake
     *
     * Explosions still shook the camera, which is exactly why this survived:
     * `Explosions.ts` reaches `cameraRig.addShake` through `setShakeSink`
     * above, so the ONE case anybody would test by playing worked, and the
     * nuke — the single most deserving effect in the game — did nothing.
     *
     * THE TWO DecalKind ENUMS DO NOT AGREE, and passing the value straight
     * through would have been worse than the no-op:
     *
     *   core/types.ts    Scorch=0 Crater=1 TreadMark=2 FootPrint=3 Squish=4
     *                    OreStain=5 Rubble=6
     *   world/Decals.ts  Tread=0  Tyre=1   Scorch=2    Crater=3    Oil=4
     *                    Dust=5   Manhole=6 LightPool=7 Crack=8    Patch=9
     *                    Squish=10
     *
     * A nuke's Crater(1) would have laid a Tyre mark. The map below is the
     * whole reason this adapter exists rather than a one-line assignment.
     */
    world.vfx = {
      play: (kind, x, y, z, dx, dy, dz, scale) => {
        // Straight onto the same channel the weapons write, so a sim-issued
        // effect and a weapon-issued one take one code path and cannot drift.
        channels.fx.push(kind, x, y, z, dx, dy, dz, scale, NONE, Faction.Neutral);
      },
      // Persistent attached emitters are driven by `EntityFlag.Burning` in
      // `frame()` below, which scans the store directly — there is no handle
      // table to hand out, and inventing one that nothing reads would be the
      // same defect this block is fixing.
      attach: () => -1,
      detach: () => {},
      decal: (kind, x, z, rot, size) => {
        // Rubble is a COMPOSITION rather than a one-tile translation: fading
        // dust over permanent grime plus two broken-stone fans. The persistent
        // Wreck entity supplies the large ruin silhouette above it.
        if (kind === DecalKind.Rubble) {
          layRubbleStory(x, z, Math.max(0.25, size), rot);
          return;
        }
        const mapped = DECAL_PORT_MAP[kind as number];
        if (mapped !== undefined) layDecal(mapped, x, z, Math.max(0.25, size), rot);
      },
      shake: (amount) => { cameraRig.addShake(amount); },
      particleCount: () => sprites?.additive.count ?? 0,
    };

    damageTimer.fill(0);
    dustTimer.fill(0);
    buildingLifeTimer.fill(-1);
    buildingLifeGen.fill(0);
    scanCursor = 0;
    drainedTotal = 0;
    probeReported = false;
    // Module-level state, so it outlives a match. The previous match's dying
    // base must not dim the first shot of the next one.
    clearFlashBudget();

    // THE ORDERING PROBE. See the file header. Pushed here, expected in the
    // first frame(); if the loop ever clears the queue before runFrame, this
    // reports it loudly on boot instead of silently eating every effect.
    channels.fx.push(FxKind.None, 0, 0, 0, 0, 1, 0, PROBE_SCALE, NONE, Faction.Neutral);
    probePending = true;

    installGlobal();

    console.info(
      `%c[vfx]%c ${sprites.additive.capacity} additive + ${sprites.lit.capacity} lit + ` +
      `${sprites.debris.capacity} debris particles, ${lights.capacity} scene lights, ` +
      `${beams.overlay.maxQuads} ribbon quads, 16 ramps, 16 atlas tiles. ` +
      `scorch sink: ${hasScorchSink() ? 'bound' : 'FALLBACK (no decal module yet)'}`,
      'color:#fd7', 'color:inherit',
    );
  },

  frame(r: RenderContext): void {
    const P = sprites;
    const L = lights;
    const B = beams;
    const T = shots;
    if (P === null || L === null || B === null || T === null) return;

    const { channels, cameraRig, sceneRig, debug } = ctx();
    /*
     * Real elapsed time, clamped: a 3 s tab-switch must not age every plume out
     * in one frame, and a jittery clock must not stall the pools. A pending
     * harness `advance()` overrides the clock entirely.
     *
     * A dt of EXACTLY ZERO ages nothing, and does not get the 0.5 ms floor.
     * That floor was written for a jittery real clock; under `?shot=` the loop
     * publishes a deliberate zero on every organic frame
     * (`GameLoop.captureClock`), and quietly turning that into half a
     * millisecond would put the one thing a capture cannot have — a dependence
     * on how many frames the machine rendered — straight back into the pools.
     * Twenty settle frames is 10 ms of ageing, which is an eighth of a muzzle
     * flash.
     */
    const raw = r.dt * 1000;
    let dtMs = raw > 0 ? Math.min(120, Math.max(0.5, raw)) * timeScale : 0;
    if (pendingAdvanceMs > 0) {
      dtMs = pendingAdvanceMs;
      pendingAdvanceMs = 0;
    }
    const camera = cameraRig.camera;

    /* -- 1. drain the PresentationQueue ---------------------------------- */
    const fx = channels.fx;
    const count = fx.count;
    let probeSeen = false;
    for (let i = 0; i < count; i++) {
      if (fx.scale[i] === PROBE_SCALE) { probeSeen = true; continue; }
      dispatch(
        fx.kind[i] as FxKind,
        fx.x[i], fx.y[i], fx.z[i],
        fx.dx[i], fx.dy[i], fx.dz[i],
        fx.scale[i],
        fx.source[i],
        fx.faction[i] as Faction,
      );
    }
    drainedTotal += count;

    if (probePending && !probeReported) {
      probePending = false;
      probeReported = true;
      if (probeSeen) {
        console.info(
          `%c[vfx]%c PresentationQueue drain VERIFIED at RenderPhase.Vfx (60): the ` +
          `probe pushed in init() survived to frame ${r.frame} with ${count} record(s) ` +
          'queued. channels.fx.clear() runs after registry.runFrame(), so the ordering holds.',
          'color:#7fd', 'color:inherit',
        );
      } else {
        console.error(
          '[vfx] PresentationQueue probe NOT received. Something is clearing ' +
          'channels.fx before RenderPhase.Vfx — every muzzle flash, impact and ' +
          'explosion pushed by the sim is being discarded. See core/loop.ts.',
        );
      }
    }

    /*
     * -- 2. damage states, tread dust ------------------------------------
     *
     * SKIPPED ENTIRELY ON A ZERO-TIME FRAME, and that is not an optimisation.
     * `damageScan` carries `scanCursor`, a round-robin cursor that advances
     * once per FRAME rather than once per millisecond. Under `?shot=` the
     * number of organic frames between boot and the shutter is not fixed —
     * `ready()` polls the loading manager, the harness polls for the curtain —
     * so running the scan on frames worth no time left the cursor at a
     * different offset every run, and a different set of damaged hulls got
     * their timer charged first once the capture did advance. `05-combat` was
     * still moving median luminance by 0.0016 between two runs of one build
     * after everything else had been pinned, and this was the remainder.
     *
     * A frame worth no time must have no side effects. That is the whole rule.
     */
    if (dtMs > 0) damageScan(dtMs);

    /* -- 3. delayed structure cook-offs ---------------------------------- */
    stepExplosions(dtMs);

    /*
     * -- 3b. decay the per-locality glare budget -------------------------
     *
     * AFTER the drain and the cook-offs, never before: everything emitted this
     * frame must see the load the previous frame left, or a volley that lands
     * across two frames gets two full budgets and the cap does nothing. It also
     * has to run on the same `dtMs` every other pool gets, so `timeScale(0)`
     * freezes it too and a scripted capture is reproducible.
     */
    stepFlashBudget(dtMs);

    /* -- 4. scene-light injection (bible §8.9, NON-NEGOTIABLE) ----------- */
    _camPos.setFromMatrixPosition(camera.matrixWorld);
    L.update(dtMs, _camPos.x, _camPos.y, _camPos.z);

    /* -- 5. beams, tracers, particles ------------------------------------ */
    // Eye-to-focus distance. Every bible figure quoted in pixels resolves to
    // metres through this depth.
    const focusDepth = Math.max(8, _camPos.distanceTo(cameraRig.focus));
    B.step(dtMs, camera.fov, focusDepth);
    const mpp = B.metresPerPixel;
    setMetresPerPixel(mpp);
    T.step(dtMs, mpp);
    // 22 TL/s^2 from bible §8.2, in metres.
    P.step(dtMs, camera, 154);

    /* -- 6. shader sync -------------------------------------------------- */
    P.syncLighting(
      camera,
      sceneRig.sunDir, sceneRig.sun.color, sceneRig.sun.intensity,
      sceneRig.hemi.color, sceneRig.hemi.groundColor, sceneRig.hemi.intensity,
    );
    if (L.dominant(_dominant)) {
      P.setDominantLight(
        camera,
        _dominant[0], _dominant[1], _dominant[2],
        _dominant[3], _dominant[4], _dominant[5], _dominant[6],
      );
    } else {
      P.setDominantLight(camera, 0, -1e6, 0, 0, 0, 0, 0);
    }

    /* -- 7. counters ------------------------------------------------------ */
    const c = debug.counters;
    c.particles = P.liveCount;
    c.vfxLights = L.activeCount;
    c.vfxBolts = B.activeBolts;
    c.vfxBeams = B.activeBeams;
    c.vfxTracers = T.count;
    c.vfxRibbonQuads = B.overlay.quadCount + B.depthed.quadCount;
    c.vfxBranches = B.lastBranches;
    c.vfxLoops = B.lastLoops;
    c.vfxDrained = drainedTotal;
    // Kept apart on purpose. A dropped PARTICLE means a pool is too small and
    // the frame is missing pixels; a dropped LIGHT CLAIM is the pool doing its
    // job — a distant muzzle flash losing to a nearby explosion is correct, and
    // folding the two together buries a real overflow under normal pressure.
    c.vfxDropped = P.additive.dropped + P.lit.dropped + P.debris.dropped + T.dropped;
    c.vfxLightDrops = L.droppedClaims;
    c.vfxLightEvictions = L.evictions;
    // The two halves of the anti-stacking fix, kept visible: a firefight with
    // zero merges and zero dimmed emissions means one of them stopped working.
    c.vfxLightMerges = L.merges;
    c.vfxGlareSpots = glareSpotCount();
    c.vfxGlareDimmed = glareAttenuatedCount();
  },

  dispose(): void {
    // Harness state must not survive a match teardown, or a scripted
    // `timeScale(0)` would silently freeze every effect in the next match.
    timeScale = 1;
    pendingAdvanceMs = 0;
    setTracerSystem(null);
    setBeamSystem(null);
    setParticleSystem(null);
    setLightPool(null);
    setGroundHeightFn(null);
    setShakeSink(null);
    delete (globalThis as unknown as VfxGlobal).__vmVfx;
    clearExplosions();
    clearFlashBudget();
    shots?.clear();
    beams?.dispose();
    sprites?.dispose();
    lights?.dispose();
    shots = null;
    beams = null;
    sprites = null;
    lights = null;
  },
});

/* ==========================================================================
 * THE PUBLIC SURFACE
 *
 * Everything a gameplay module needs, re-exported from one place, so a combat
 * or production system writes
 *   `import { spawnExplosion } from '../vfx/vfx.system'`
 * and never has to know which file a recipe happens to live in. The individual
 * modules remain importable directly for anything that wants the classes.
 * ========================================================================== */

export {
  spawnExplosion, spawnImpact, spawnSmokeColumn, spawnSplash, spawnDust,
  spawnSteamPuff, spawnMachineSparks, spawnCollectorMote,
  spawnDamageWisp, spawnDamageFire, sparkBurst,
  setScorchSink, setGroundHeightFn, setShakeSink, hasScorchSink,
  type ScorchSink, type ExplosionKind, type ImpactSurface,
} from './Explosions';

export {
  spawnMuzzleFlash, spawnMuzzleFlashAt, spawnTrail, spawnTrailSegment,
  spawnTracer, spawnTracerBurst, tracers as tracerSystem, TracerSystem,
  type FlashSize, type TracerKind,
} from './Tracers';

export {
  spawnBeam, spawnTesla, stopBeam, retargetBeam, beamSystem, BeamSystem,
  RibbonBatch, NO_BEAM, type BeamHandle, type BeamKind,
} from './Beams';

export {
  spawnLight, moveLight, releaseLight, lightPool, LightPool,
  NO_LIGHT, type LightHandle, type LightEnvelope,
} from './LightPool';

export {
  admitGlare, stepFlashBudget, clearFlashBudget, glareLoadAt,
  glareSpotCount, glareAttenuatedCount,
} from './FlashBudget';

export {
  particles as particleSystem, emitAdditive, emitLit, resetEmit, EMIT,
  ParticleSystem, type EmitDesc,
} from './Particles';
