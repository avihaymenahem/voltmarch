/**
 * VFX — particles, beams, explosions and scene-light injection.
 *
 * Everything here runs headless. The sprite atlas and the colour-ramp LUT are
 * generated into plain `Uint8Array`s (no `<canvas>`), and every THREE object
 * involved — `DataTexture`, `InstancedBufferGeometry`, `PointLight` — is a pure
 * JS object until a renderer touches it. So the whole pipeline is testable in
 * Node, including the one thing that actually needed proving: that a `frame()`
 * at `RenderPhase.Vfx` really does see `channels.fx` before `core/loop.ts`
 * clears it.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Channels } from '../src/core/events';
import { GameLoop, Profiler, SystemRegistry } from '../src/core/loop';
import { World } from '../src/core/world';
import { Faction, FxKind, NONE, RenderPhase } from '../src/core/types';
import type { SystemModule } from '../src/core/types';
import {
  VFX_ATLAS_COLS, VFX_ATLAS_SIZE, VFX_EXPLOSION, VFX_GLARE, VFX_GUNS,
  VFX_LIGHT_MERGE_CEIL, VFX_LIGHTS, VFX_RAMPS,
  VFX_RAMP_WIDTH, VFX_TESLA, VFX_TILE, VFX_TRAIL,
} from '../src/core/config';

import {
  admitGlare, clearFlashBudget, glareAttenuatedCount, glareEngagementCount,
  glareLoadAt, glareSpotCount, glareWideLoadAt, stepFlashBudget,
} from '../src/vfx/FlashBudget';
import { LightPool, NO_LIGHT, setLightPool } from '../src/vfx/LightPool';
import {
  ParticleSystem, buildRampTexture, buildSpriteAtlas, resetEmit, setParticleSystem,
} from '../src/vfx/Particles';
import { BeamSystem, TeslaBolt, setBeamSystem } from '../src/vfx/Beams';
import { TracerSystem, setTracerSystem, spawnTrail } from '../src/vfx/Tracers';
import {
  setGroundHeightFn, setScorchSink, spawnCollectorMote, spawnExplosion,
  spawnMachineSparks, spawnSteamPuff,
} from '../src/vfx/Explosions';

/* ========================================================================== */
/* Helpers                                                                    */
/* ========================================================================== */

/** A throwaway perspective camera at the bible's default pose. */
function makeCamera(): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(36, 16 / 9, 1, 900);
  cam.position.set(256 - 43.7, 50, 256 - 43.7);
  cam.lookAt(256, 0, 256);
  cam.updateMatrixWorld(true);
  return cam;
}

/** Read one texel of a DataTexture as [r,g,b,a] bytes. */
function texel(tex: THREE.DataTexture, x: number, y: number): [number, number, number, number] {
  const w = tex.image.width as number;
  const d = tex.image.data as Uint8Array;
  const o = (y * w + x) * 4;
  return [d[o], d[o + 1], d[o + 2], d[o + 3]];
}

/** Build a live particle system and register it as the module singleton. */
function makeParticles(): ParticleSystem {
  const p = new ParticleSystem();
  setParticleSystem(p);
  return p;
}

describe('healthy structure activity', () => {
  it('uses tiny bounded recipes instead of damage-sized smoke columns', () => {
    const P = makeParticles();
    spawnSteamPuff(0, 5, 0, 1);
    expect(P.lit.count).toBeGreaterThanOrEqual(1);
    expect(P.lit.count).toBeLessThanOrEqual(2);

    spawnMachineSparks(0, 5, 0, 1);
    expect(P.additive.count).toBeGreaterThanOrEqual(2);
    expect(P.additive.count).toBeLessThanOrEqual(4);

    const before = P.additive.count;
    spawnCollectorMote(0, 5, 0, 1);
    expect(P.additive.count).toBe(before + 1);
    P.dispose();
    setParticleSystem(null);
  });
});

/* ========================================================================== */
/* 1. THE ORDERING BUG — the one thing that had to be proven empirically      */
/* ========================================================================== */

describe('PresentationQueue drain ordering', () => {
  /**
   * Drives the REAL `GameLoop`, not a re-implementation of it, so this fails if
   * anyone moves `channels.fx.clear()`.
   */
  function run(renderPhase: RenderPhase): Promise<{ seen: number[]; afterFrame: number }> {
    const world = new World();
    const channels = new Channels();
    const registry = new SystemRegistry(new Profiler());
    const seen: number[] = [];
    let afterFrame = -1;

    const probe: SystemModule = {
      id: 'test.probe',
      renderPhase,
      frame() {
        seen.push(channels.fx.count);
      },
    };
    registry.add(probe);

    const loop = new GameLoop(world, channels, registry, {
      // The loop's own render hook runs AFTER every frame system and BEFORE the
      // clear; sampling on the FIRST frame proves the clear is not hiding
      // inside runFrame. Later frames legitimately see an empty queue.
      render() { if (afterFrame < 0) afterFrame = channels.fx.count; },
    }, 1);

    // Three records, exactly as a weapons system would push them.
    channels.fx.push(FxKind.MuzzleFlashLarge, 1, 2, 3, 0, 0, 1, 1, NONE, Faction.Soviets);
    channels.fx.pushImpact(FxKind.ImpactMetal, 10, 1, 10, 0, 1, 0, 1, Faction.Allies);
    channels.fx.push(FxKind.ExplosionMedium, 5, 0, 5);

    // Resolve as soon as TWO frames have run (so "the queue was emptied" is
    // observable) rather than after a fixed wall-clock wait — under a loaded
    // CI box a 90 ms budget does not reliably buy two rAF-equivalent ticks.
    return registry.init().then(() => new Promise((resolve) => {
      loop.start();
      const deadline = Date.now() + 4000;
      const poll = (): void => {
        if (seen.length >= 3 || Date.now() > deadline) {
          loop.stop();
          resolve({ seen, afterFrame });
          return;
        }
        setTimeout(poll, 10);
      };
      poll();
    }));
  }

  it('a frame() at RenderPhase.Vfx receives everything the sim pushed', async () => {
    const { seen, afterFrame } = await run(RenderPhase.Vfx);
    expect(seen.length).toBeGreaterThan(0);
    // The FIRST frame must carry all three records...
    expect(seen[0]).toBe(3);
    // ...the loop's render hook still sees them (the clear is after it)...
    expect(afterFrame).toBe(3);
    // ...and every subsequent frame is empty, i.e. the clear did run.
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBe(0);
  });

  it('holds at every render phase, including the last one', async () => {
    const { seen } = await run(RenderPhase.Present);
    expect(seen[0]).toBe(3);
  });

  it('the queue really is emptied — nothing accumulates across frames', async () => {
    const { seen } = await run(RenderPhase.Vfx);
    expect(seen.length).toBeGreaterThan(1);
    expect(Math.max(...seen.slice(1))).toBe(0);
  });
});

/* ========================================================================== */
/* 2. THE RAMP LUT — scorecard #14 at the source                              */
/* ========================================================================== */

describe('colour ramps', () => {
  const ramp = buildRampTexture();

  it('has one row per bible ramp at the configured width', () => {
    expect(ramp.image.width).toBe(VFX_RAMP_WIDTH);
    expect(ramp.image.height).toBe(VFX_RAMPS.length);
    expect(ramp.colorSpace).toBe(THREE.SRGBColorSpace);
  });

  it('keeps a compact white ignition core instead of a half-radius white plate', () => {
    // Row 0 is the fireball. V3 keeps only the inner 4% near-white, leaving the
    // rest of the billow available for yellow/orange volume separation.
    for (let i = 0; i < Math.floor(VFX_RAMP_WIDTH * 0.04); i++) {
      const [r, g, b, a] = texel(ramp, i, 0);
      expect(a).toBeGreaterThan(200);
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      expect(lum).toBeGreaterThan(240);
      const spread = Math.max(r, g, b) - Math.min(r, g, b);
      expect(spread).toBeLessThan(36);
    }
  });

  it('the fireball body becomes saturated orange before fading to soot', () => {
    const [r, g, b, a] = texel(ramp, Math.floor(VFX_RAMP_WIDTH * 0.62), 0);
    expect(a).toBeGreaterThan(190);
    expect(r).toBeGreaterThan(b + 120);
    expect(r).toBeGreaterThan(g + 45);
    expect(texel(ramp, VFX_RAMP_WIDTH - 2, 0)[3]).toBeLessThan(30);
  });

  it('the tesla core is L>=248 and the sheath saturates blue', () => {
    const row = 6;
    const [r, g, b] = texel(ramp, 1, row);
    expect(Math.min(r, g, b)).toBeGreaterThanOrEqual(248);
    // Bible: #1326B3-class saturation by t=0.80.
    const [er, , eb] = texel(ramp, Math.floor(VFX_RAMP_WIDTH * 0.8), row);
    expect(eb).toBeGreaterThan(er + 60);
  });

  it('every ramp ends transparent so nothing pops out of existence', () => {
    for (let row = 0; row < VFX_RAMPS.length; row++) {
      expect(texel(ramp, VFX_RAMP_WIDTH - 1, row)[3]).toBeLessThan(6);
    }
  });
});

/* ========================================================================== */
/* 3. THE SPRITE ATLAS                                                        */
/* ========================================================================== */

describe('sprite atlas', () => {
  const atlas = buildSpriteAtlas();
  const px = VFX_ATLAS_SIZE / VFX_ATLAS_COLS;

  it('is a 4x4 grid at the configured size, with shape in alpha only', () => {
    expect(atlas.image.width).toBe(VFX_ATLAS_SIZE);
    expect(atlas.image.height).toBe(VFX_ATLAS_SIZE);
    // RGB is flat white everywhere; the ramp supplies every hue.
    const [r, g, b] = texel(atlas, 3, 3);
    expect(r).toBe(255); expect(g).toBe(255); expect(b).toBe(255);
  });

  it('every one of the 16 tiles has real coverage and a clean border', () => {
    for (let t = 0; t < 16; t++) {
      const ox = (t % VFX_ATLAS_COLS) * px;
      const oy = Math.floor(t / VFX_ATLAS_COLS) * px;
      let sum = 0;
      let peak = 0;
      for (let j = 0; j < px; j++) {
        for (let i = 0; i < px; i++) {
          const a = texel(atlas, ox + i, oy + j)[3];
          if (a > peak) peak = a;
          if ((i % 3) === 0 && (j % 3) === 0) sum += a;
        }
      }
      // Opaque somewhere...
      expect(peak).toBeGreaterThan(200);
      // ...but not a filled square, or every particle would be a box.
      const mean = sum / ((px / 3) * (px / 3));
      expect(mean).toBeLessThan(190);
      // Corners must be empty or tiles bleed into each other when mipped.
      expect(texel(atlas, ox, oy)[3]).toBeLessThan(24);
      expect(texel(atlas, ox + px - 1, oy + px - 1)[3]).toBeLessThan(24);
    }
  });

  it('the mass-carrying tiles are SOLID at their centre', () => {
    // A translucent billow centre lets the orange fringe of the billow behind
    // it show through the white core, which is precisely what scorecard #14
    // penalises. These four have to be opaque in the middle.
    for (const t of [VFX_TILE.billow, VFX_TILE.puffAlt, VFX_TILE.bead, VFX_TILE.core]) {
      const ox = (t % VFX_ATLAS_COLS) * px;
      const oy = Math.floor(t / VFX_ATLAS_COLS) * px;
      const c = px >> 1;
      expect(texel(atlas, ox + c, oy + c)[3]).toBeGreaterThanOrEqual(250);
    }
  });

  it('the core tile is a hard disc — it is what clips to white', () => {
    const t = VFX_TILE.core;
    const ox = (t % VFX_ATLAS_COLS) * px;
    const oy = Math.floor(t / VFX_ATLAS_COLS) * px;
    const c = px >> 1;
    expect(texel(atlas, ox + c, oy + c)[3]).toBe(255);
    // Outside r=0.6 it is gone.
    expect(texel(atlas, ox + c + Math.floor(c * 0.75), oy + c)[3]).toBeLessThan(24);
  });
});

/* ========================================================================== */
/* 4. LIGHT POOL — the §14 R6 prerequisite                                    */
/* ========================================================================== */

describe('LightPool', () => {
  it('creates every light up front and never adds one later', () => {
    const scene = new THREE.Scene();
    const pool = new LightPool();
    pool.attach(scene);
    let n = 0;
    scene.traverse((o) => { if ((o as THREE.PointLight).isPointLight) n++; });
    expect(n).toBe(pool.capacity);

    // Claiming must not change the count — that is what would recompile every
    // shader in the scene mid-battle.
    for (let i = 0; i < pool.capacity + 4; i++) {
      pool.spawn(i * 3, 1, 0, VFX_LIGHTS.explosion);
    }
    let after = 0;
    scene.traverse((o) => { if ((o as THREE.PointLight).isPointLight) after++; });
    expect(after).toBe(pool.capacity);
    pool.dispose();
  });

  it('idle lights sit at intensity 0 but stay visible', () => {
    const pool = new LightPool();
    pool.attach(new THREE.Scene());
    pool.update(16, 0, 50, 0);
    let visible = 0;
    let lit = 0;
    pool.root.traverse((o) => {
      const l = o as THREE.PointLight;
      if (!l.isPointLight) return;
      if (l.visible) visible++;
      if (l.intensity > 0) lit++;
    });
    expect(visible).toBe(pool.capacity);
    expect(lit).toBe(0);
    pool.dispose();
  });

  it('runs a rise/hold/fall envelope and frees itself', () => {
    const pool = new LightPool();
    pool.attach(new THREE.Scene());
    const h = pool.spawn(0, 2, 0, VFX_LIGHTS.explosion);
    expect(h).not.toBe(NO_LIGHT);

    pool.update(VFX_LIGHTS.explosion.riseMs, 0, 50, 0);
    expect(pool.activeCount).toBe(1);
    const out = new Float32Array(7);
    expect(pool.dominant(out)).toBe(true);
    // At the top of the rise it must be at (near) full peak.
    expect(out[3] + out[4] + out[5]).toBeGreaterThan(1);

    // Past rise + hold + fall it is gone, and the handle stops resolving.
    const total = VFX_LIGHTS.explosion.riseMs + VFX_LIGHTS.explosion.holdMs
      + VFX_LIGHTS.explosion.fallMs + 50;
    pool.update(total, 0, 50, 0);
    pool.update(total, 0, 50, 0);
    expect(pool.activeCount).toBe(0);
    expect(pool.alive(h)).toBe(false);
    pool.dispose();
  });

  it('evicts the weakest light rather than dropping a nearby explosion', () => {
    const pool = new LightPool();
    pool.attach(new THREE.Scene());
    // Fill the pool with weak muzzle flashes 400 m from the camera.
    //
    // THE SPACING IS LOAD-BEARING. Co-located one-shots of the same envelope now
    // MERGE (see the anti-stacking suite below), so a metre apart these twelve
    // claims would collapse into one light and the pool would never fill —
    // which is what this test needs to exercise eviction. `mergeRadius * 3`
    // keeps them independent whatever the config says.
    const apart = VFX_LIGHTS.muzzle.mergeRadius * 3;
    for (let i = 0; i < pool.capacity; i++) {
      pool.spawn(400 + i * apart, 1, 400, VFX_LIGHTS.muzzle);
    }
    pool.update(16, 0, 50, 0);
    expect(pool.activeCount).toBe(pool.capacity);

    const before = pool.evictions;
    // A big explosion right at the camera must win a slot.
    const h = pool.spawn(0, 2, 0, VFX_LIGHTS.explosion, 2);
    expect(h).not.toBe(NO_LIGHT);
    expect(pool.evictions).toBe(before + 1);
    pool.dispose();
  });

  it('a sustained light burns until release(), then falls from where it was', () => {
    const pool = new LightPool();
    pool.attach(new THREE.Scene());
    const env = { ...VFX_LIGHTS.beam, holdMs: Infinity };
    const h = pool.spawn(0, 3, 0, env);
    for (let i = 0; i < 40; i++) pool.update(50, 0, 50, 0);
    expect(pool.alive(h)).toBe(true);        // 2 seconds later, still burning
    pool.release(h);
    for (let i = 0; i < 10; i++) pool.update(50, 0, 50, 0);
    expect(pool.alive(h)).toBe(false);
    pool.dispose();
  });
});

/* ========================================================================== */
/* 4b. CO-LOCATED FLASHES MUST NOT STACK                                      */
/*                                                                            */
/* The fourth report of "explosions and muzzle flashes are too bright", and    */
/* the first one aimed at the actual mechanism. Both previous fixes lowered a  */
/* single sprite's gain, so both measured correctly on one explosion and both  */
/* came back the moment a real firefight put twenty on the same pixels.        */
/*                                                                            */
/* Measured before the fix (tools/flash-stack.mjs, 1280x720, 48 m framing):   */
/* 20 unit deaths inside a 4 m radius put 65.9% of the frame over L=0.95       */
/* against 14.5% for one, and ablating each summing layer attributes x8.9 of   */
/* that growth to the additive quads and x3.0 to the point-light pile.         */
/*                                                                            */
/* THE SHAPE OF EVERY ASSERTION HERE IS THE SAME: one effect is untouched, N   */
/* co-located effects are BOUNDED. A test that only pinned "one flash is dim   */
/* enough" is exactly what let this ship three times.                          */
/* ========================================================================== */

/**
 * The flash gain an UNATTENUATED explosion actually emits.
 *
 * Not `VFX_EXPLOSION.flashIntensity` on its own. `spawnExplosion` folds
 * `outputGain` into `glare` before any emission, so the authored constant is
 * the RATIO an emitter is written against and this is what lands in the buffer.
 * The cases below are about the GLARE BUDGET — "an isolated death is not
 * dimmed" — and comparing them against the raw constant made them fail the
 * moment the whole layer was scaled, which is a false alarm about the wrong
 * thing.
 */
const EMITTED_FLASH_GAIN = VFX_EXPLOSION.flashIntensity * VFX_EXPLOSION.outputGain;

describe('the glare budget bounds co-located flashes', () => {
  beforeEach(() => {
    // Module-level state that outlives a match, and therefore a test. Nothing in
    // this file calls stepFlashBudget(), so load never decays on its own.
    clearFlashBudget();
  });

  it('charges the first effect in a locality nothing at all', () => {
    // The property the whole design rests on: a lone explosion, and every
    // explosion far from another one, is bit-identical to before this existed.
    expect(admitGlare(100, 1, 100, VFX_GLARE.cost.explosion)).toBe(1);
    clearFlashBudget();
    expect(admitGlare(0, 0, 0, VFX_GLARE.cost.muzzle)).toBe(1);
  });

  it('bounds the TOTAL emitted glare of N co-located effects', () => {
    const emitted = (n: number): number => {
      clearFlashBudget();
      let total = 0;
      for (let i = 0; i < n; i++) {
        total += VFX_GLARE.cost.explosion * admitGlare(256, 1, 256, VFX_GLARE.cost.explosion);
      }
      return total;
    };

    const one = emitted(1);
    expect(one).toBeCloseTo(VFX_GLARE.cost.explosion, 6);

    // The whole point, stated as arithmetic: twenty explosions on one spot are a
    // small multiple of one explosion, not twenty of them.
    expect(emitted(20) / one).toBeLessThan(4);

    // Past saturation the total grows as `ceiling + floor x N` — the marginal
    // cost of one more detonation is the FLOOR, not a whole detonation. That is
    // the honest statement of the bound: the bulk is capped and the tail is
    // linear at 6% slope. Pinned so that raising `floor` without thinking about
    // the tail fails here rather than in a fifth bug report.
    const hundred = emitted(100) / one;
    expect(hundred).toBeLessThan(VFX_GLARE.ceiling + 100 * VFX_GLARE.floor + 1);
    expect(hundred).toBeLessThan(0.12 * 100);

    // And monotonic — more explosions must never emit LESS in total, or a squad
    // wipe would read as quieter than a single death.
    let prev = 0;
    for (const n of [1, 2, 3, 5, 10, 20, 50]) {
      const t = emitted(n);
      expect(t).toBeGreaterThanOrEqual(prev - 1e-6);
      prev = t;
    }
  });

  it('is gentle for two and hard for twenty', () => {
    // A pair of deaths together must not read as one death plus one fizzle: the
    // exponent exists for exactly this. And by the time the locality is full the
    // newcomer must be down at the floor, not merely trimmed.
    clearFlashBudget();
    admitGlare(0, 0, 0, VFX_GLARE.cost.explosion);
    expect(admitGlare(0, 0, 0, VFX_GLARE.cost.explosion)).toBeGreaterThan(0.7);

    clearFlashBudget();
    for (let i = 0; i < 20; i++) admitGlare(0, 0, 0, VFX_GLARE.cost.explosion);
    const twentyFirst = admitGlare(0, 0, 0, VFX_GLARE.cost.explosion);
    expect(twentyFirst).toBeLessThan(0.2);
    // Never zero: a hard zero deletes the fireball and then pops it back when
    // the budget decays.
    expect(twentyFirst).toBeGreaterThanOrEqual(VFX_GLARE.floor);
  });

  it('does not dim an effect outside the locality radius', () => {
    // THIS TEST USED TO ASSERT `toBe(1)` AT 15 m AND THAT WAS THE SEVENTH BUG.
    // Fifteen metres is a different patch of ground and the SAME screenful, and
    // the frame is what goes white. The locality tier's independence is still
    // the thing being pinned — it is now pinned on the locality's own load
    // rather than on the multiplier, which two tiers share.
    clearFlashBudget();
    for (let i = 0; i < 8; i++) admitGlare(0, 0, 0, VFX_GLARE.cost.explosion);
    const far = VFX_GLARE.radiusM * 2 + 1;
    expect(glareLoadAt(far, 0, 0)).toBe(0);
    // Beyond the ENGAGEMENT radius as well, nothing dims it at all: a battle on
    // the far side of the map must not touch the one on screen.
    const offMap = VFX_GLARE.wide.radiusM * 2 + 1;
    expect(admitGlare(offMap, 0, 0, VFX_GLARE.cost.explosion)).toBe(1);

    // Just inside the locality, though, it is the same locality.
    clearFlashBudget();
    for (let i = 0; i < 8; i++) admitGlare(0, 0, 0, VFX_GLARE.cost.explosion);
    expect(admitGlare(VFX_GLARE.radiusM * 0.9, 0, 0, VFX_GLARE.cost.explosion)).toBeLessThan(0.5);
  });

  it('bounds a whole ENGAGEMENT, not only a patch of ground', () => {
    /*
     * THE GATE THE SEVENTH REPORT NEEDED AND DID NOT HAVE.
     *
     * Six passes of measurement all packed their emissions inside
     * `VFX_GLARE.radiusM`, so every one of them measured the case that was
     * already bounded. Twelve deaths spread across 18 m — one screenful, which
     * is what a firefight is — each took a private budget and the frame was the
     * unbounded sum. Measured at 1280x720 on the default 55 m dolly, that put
     * 15.580% of the frame over L=0.95 against a 2.430% baseline.
     */
    const emittedSpread = (n: number, spreadM: number): number => {
      clearFlashBudget();
      let total = 0;
      for (let i = 0; i < n; i++) {
        const a = i * 2.39996323;                       // golden angle
        const r = n === 1 ? 0 : spreadM * Math.sqrt((i + 0.5) / n);
        total += VFX_GLARE.cost.explosion
          * admitGlare(Math.cos(a) * r, 1, Math.sin(a) * r, VFX_GLARE.cost.explosion);
      }
      return total;
    };

    // Every death lands in its own locality — that is the configuration this
    // gate exists for, so assert it rather than assuming it.
    clearFlashBudget();
    emittedSpread(12, 18);
    expect(glareSpotCount()).toBeGreaterThan(6);
    expect(glareEngagementCount()).toBe(1);

    const one = emittedSpread(1, 18);
    expect(one).toBeCloseTo(VFX_GLARE.cost.explosion, 6);
    // Twelve deaths across a screenful are a handful of deaths' worth of glare,
    // not twelve. Without the engagement tier this is exactly 12.
    expect(emittedSpread(12, 18) / one).toBeLessThan(5.5);
    // And thirty — a base going up — must not be twice as bright as twelve.
    expect(emittedSpread(30, 18) / one).toBeLessThan(6.5);

    // The spread case must not end up HARSHER than the packed one: twelve
    // deaths on one spot is one fireball and twelve across a screenful is a
    // battle, and a battle is allowed to be the brighter of the two.
    expect(emittedSpread(12, 18)).toBeGreaterThan(emittedSpread(12, 3));
  });

  it('leaves a duel alone — the second death in a frame is not dimmed', () => {
    // The engagement tier's whole risk is making ordinary combat limp. Its
    // exponent is 3.0 against the locality's 2.0 precisely so that the curve
    // stays flat while the frame is nearly empty; if that is ever flattened to
    // 2.0 this fails.
    clearFlashBudget();
    admitGlare(0, 1, 0, VFX_GLARE.cost.explosion);
    // A second tank dying 20 m away: a different patch of ground, same screen.
    expect(admitGlare(20, 1, 0, VFX_GLARE.cost.explosion)).toBeGreaterThan(0.95);
    // A third, still comfortably alive.
    expect(admitGlare(-20, 1, 6, VFX_GLARE.cost.explosion)).toBeGreaterThan(0.85);
  });

  it('gives the engagement its budget back between fights', () => {
    clearFlashBudget();
    for (let i = 0; i < 12; i++) {
      admitGlare((i % 4) * 8 - 12, 1, ((i / 4) | 0) * 8 - 8, VFX_GLARE.cost.explosion);
    }
    expect(glareEngagementCount()).toBe(1);
    expect(glareWideLoadAt(0, 1, 0)).toBeGreaterThan(VFX_GLARE.wide.ceiling * 0.5);

    // Ten half-lives is ten seconds of quiet — long past any volley.
    for (let i = 0; i < 10; i++) stepFlashBudget(VFX_GLARE.wide.halfLifeMs);
    expect(glareEngagementCount()).toBe(0);
    expect(admitGlare(0, 1, 0, VFX_GLARE.cost.explosion)).toBe(1);
  });

  it('gives the locality its budget back as the fire burns out', () => {
    clearFlashBudget();
    for (let i = 0; i < 10; i++) admitGlare(0, 0, 0, VFX_GLARE.cost.explosion);
    expect(admitGlare(0, 0, 0, VFX_GLARE.cost.explosion)).toBeLessThan(0.3);
    expect(glareSpotCount()).toBe(1);

    // Ten half-lives is a full second and a bit — long past the fireball that
    // spent the budget. The locality must be retired, not merely quieter.
    for (let i = 0; i < 10; i++) stepFlashBudget(VFX_GLARE.halfLifeMs);
    expect(glareSpotCount()).toBe(0);
    expect(admitGlare(0, 0, 0, VFX_GLARE.cost.explosion)).toBe(1);
  });

  it('freezes with the rest of the VFX clock', () => {
    // `__vmVfx.timeScale(0)` passes dtMs 0 to every pool. If the budget decayed
    // on a wall clock instead, a scripted capture would not be reproducible.
    clearFlashBudget();
    for (let i = 0; i < 6; i++) admitGlare(0, 0, 0, VFX_GLARE.cost.explosion);
    const before = glareLoadAt(0, 0, 0);
    for (let i = 0; i < 30; i++) stepFlashBudget(0);
    expect(glareLoadAt(0, 0, 0)).toBe(before);
  });

  it('a single explosion emits the authored gains, twenty emit a small multiple', () => {
    const P = makeParticles();
    const pool = new LightPool();
    pool.attach(new THREE.Scene());
    setGroundHeightFn(() => 0);
    setLightPool(pool);

    /** Total additive HDR gain live in the frame after `n` co-located deaths. */
    const additiveGain = (n: number): number => {
      P.clear();
      pool.clear();
      clearFlashBudget();
      for (let i = 0; i < n; i++) {
        // A deterministic 4 m spiral: the same "co-located in a small area" the
        // browser probe fires, which is what a squad dying on one target is.
        const a = i * 2.39996323;
        const r = n === 1 ? 0 : 4 * Math.sqrt(i / n);
        spawnExplosion(256 + Math.cos(a) * r, 1, 256 + Math.sin(a) * r, VFX_EXPLOSION.unitDeathTL, 'unit');
      }
      P.step(1, makeCamera(), 154);
      const tint = P.additive.geometry.getAttribute('aTint').array as Float32Array;
      let sum = 0;
      for (let i = 0; i < P.additive.geometry.instanceCount; i++) sum += tint[i * 3];
      return sum;
    };

    const one = additiveGain(1);
    expect(one).toBeGreaterThan(0);

    // The flash disc is the hottest sprite a unit death emits and it must still
    // arrive at its authored gain: this is the half of the fix that the previous
    // two passes got backwards by paying for the crowd out of the soloist.
    const tint = P.additive.geometry.getAttribute('aTint').array as Float32Array;
    let hottest = 0;
    for (let i = 0; i < P.additive.geometry.instanceCount; i++) {
      if (tint[i * 3] > hottest) hottest = tint[i * 3];
    }
    expect(hottest).toBeGreaterThan(EMITTED_FLASH_GAIN * 0.98);

    // Twenty deaths in the same four metres emitted 20x this sum before the fix.
    const twenty = additiveGain(20);
    expect(twenty / one).toBeLessThan(5);
    // But not nothing: every death still shows, or they pop back in when the
    // budget decays.
    expect(twenty / one).toBeGreaterThan(1.5);

    setLightPool(null);
    pool.dispose();
    P.dispose();
  });

  it('a suppressed detonation stops spending the additive pool as well', () => {
    const P = makeParticles();
    const pool = new LightPool();
    pool.attach(new THREE.Scene());
    setGroundHeightFn(() => 0);
    setLightPool(pool);
    clearFlashBudget();

    // 20 co-located deaths at the authored 8-14 billows and 30-60 embers is
    // ~1160 of the 1200 additive slots: the twentieth explosion was starving the
    // rest of the battle to emit sprites nobody can see. Emitting FEWER billows
    // when the locality is already on fire is the same fire in less paint.
    for (let i = 0; i < 20; i++) {
      const a = i * 2.39996323;
      const r = 4 * Math.sqrt(i / 20);
      spawnExplosion(256 + Math.cos(a) * r, 1, 256 + Math.sin(a) * r, VFX_EXPLOSION.unitDeathTL, 'unit');
    }
    P.step(1, makeCamera(), 154);
    expect(P.additive.dropped).toBe(0);
    expect(P.additive.pressure).toBeLessThan(0.6);

    setLightPool(null);
    pool.dispose();
    P.dispose();
  });

  it('explosions in SEPARATE ENGAGEMENTS are NOT dimmed', () => {
    const P = makeParticles();
    const pool = new LightPool();
    pool.attach(new THREE.Scene());
    setGroundHeightFn(() => 0);
    setLightPool(pool);
    clearFlashBudget();

    /*
     * THIS TEST SAID `radiusM * 3` — 21 m — AND CALLED IT "ACROSS A
     * BATTLEFIELD", AND THAT IS THE SEVENTH REPORT IN ONE LINE.
     *
     * Twenty-one metres is not across a battlefield, it is across a screen: at
     * `CAMERA.defaultDistance` the focus plane is 35.7 m tall. So the case it
     * pinned as "must be full brightness" is the case a player sees as one
     * white sheet, and it pinned it hard enough that the engagement tier had to
     * be written against a failing test. The property it was reaching for is
     * real and is kept — a battle on the far side of the map must not dim the
     * one on screen — and it is now stated at the distance that actually means
     * that: beyond `VFX_GLARE.wide.radiusM`, which is one framed view.
     *
     * Six, not twenty, because `WIDE_SPOTS` is 8: twenty separate engagements
     * would exhaust the table and recycle, which is a different behaviour and
     * would make this test about slot pressure instead of about distance.
     */
    const apart = VFX_GLARE.wide.radiusM * 2.5;
    for (let i = 0; i < 6; i++) {
      spawnExplosion(60 + (i % 3) * apart, 1, 60 + ((i / 3) | 0) * apart, VFX_EXPLOSION.unitDeathTL, 'unit');
    }
    P.step(1, makeCamera(), 154);
    const tint = P.additive.geometry.getAttribute('aTint').array as Float32Array;
    const n = P.additive.geometry.instanceCount;
    let flashes = 0;
    for (let i = 0; i < n; i++) {
      if (tint[i * 3] > EMITTED_FLASH_GAIN * 0.98) flashes++;
    }
    // One full-gain flash disc per death, none of them attenuated.
    expect(flashes).toBe(6);
    expect(glareAttenuatedCount()).toBe(0);

    setLightPool(null);
    pool.dispose();
    P.dispose();
  });
});

describe('the light pool merges co-located one-shots', () => {
  it('twenty muzzle flashes in one place are ONE bounded light', () => {
    const pool = new LightPool();
    pool.attach(new THREE.Scene());

    const single = pool.spawn(0, 2, 0, VFX_LIGHTS.muzzle);
    expect(single).not.toBe(NO_LIGHT);
    pool.update(VFX_LIGHTS.muzzle.riseMs, 0, 50, 0);
    const onePeak = pool.root.children
      .reduce((m, o) => Math.max(m, (o as THREE.PointLight).intensity), 0);
    expect(onePeak).toBeGreaterThan(0);

    pool.clear();
    // Twenty guns firing into the same few metres — the reported case.
    for (let i = 0; i < 20; i++) {
      const a = i * 2.39996323;
      const r = 3 * Math.sqrt(i / 20);
      pool.spawn(Math.cos(a) * r, 2, Math.sin(a) * r, VFX_LIGHTS.muzzle);
    }
    pool.update(VFX_LIGHTS.muzzle.riseMs, 0, 50, 0);

    // ONE light, not twelve, so the pool has eleven slots left for the rest of
    // the battle — and at 2.57 ms per resident light that is also the cheaper
    // frame, not a trade against it.
    expect(pool.activeCount).toBe(1);
    expect(pool.merges).toBe(19);
    expect(pool.evictions).toBe(0);
    expect(pool.droppedClaims).toBe(0);

    let total = 0;
    for (const o of pool.root.children) total += (o as THREE.PointLight).intensity;
    // Bounded by the merge ceiling, where before it was 12x (pool-limited) —
    // and still BRIGHTER than one flash, because a volley should read as more.
    expect(total).toBeLessThanOrEqual(onePeak * VFX_LIGHT_MERGE_CEIL * 1.02);
    expect(total).toBeGreaterThan(onePeak * 1.2);

    pool.dispose();
  });

  it('does not merge lights that are far apart, or of different kinds', () => {
    const pool = new LightPool();
    pool.attach(new THREE.Scene());
    const apart = VFX_LIGHTS.muzzle.mergeRadius * 2 + 1;
    pool.spawn(0, 2, 0, VFX_LIGHTS.muzzle);
    pool.spawn(apart, 2, 0, VFX_LIGHTS.muzzle);
    pool.update(16, 0, 50, 0);
    expect(pool.activeCount).toBe(2);
    expect(pool.merges).toBe(0);

    // Same place, different effect: an orange fireball wash and a warm impact
    // wash are different envelopes and must stay separate lights.
    pool.spawn(0, 2, 0, VFX_LIGHTS.explosion);
    pool.update(16, 0, 50, 0);
    expect(pool.activeCount).toBe(3);
    expect(pool.merges).toBe(0);
    pool.dispose();
  });

  it('never merges a sustained light, so a beam cannot release another beam', () => {
    const pool = new LightPool();
    pool.attach(new THREE.Scene());
    // Exactly how Beams.ts builds its two: a spread copy with holdMs Infinity.
    const env = { ...VFX_LIGHTS.teslaArc, holdMs: Infinity, mergeRadius: 9 };
    const a = pool.spawn(0, 3, 0, env);
    const b = pool.spawn(1, 3, 1, env);
    expect(a).not.toBe(b);
    expect(pool.merges).toBe(0);
    pool.update(100, 0, 50, 0);
    expect(pool.activeCount).toBe(2);

    // Releasing one must leave the other burning. If they had merged, the first
    // beam to finish would have taken the second beam's wash with it.
    pool.release(a);
    for (let i = 0; i < 12; i++) pool.update(60, 0, 50, 0);
    expect(pool.alive(a)).toBe(false);
    expect(pool.alive(b)).toBe(true);
    pool.dispose();
  });

  it('a merged light revives one that was already fading out', () => {
    const pool = new LightPool();
    pool.attach(new THREE.Scene());
    const m = VFX_LIGHTS.muzzle;
    const lit = (): number => pool.root.children
      .reduce((s, o) => s + (o as THREE.PointLight).intensity, 0);

    pool.spawn(0, 2, 0, m);
    // Walk the envelope in real steps: `update` advances at most one phase per
    // call, so one big dt would leave this sitting at full hold and the test
    // would pass without ever exercising the revival.
    const step = 5;
    for (let t = 0; t < m.riseMs + m.holdMs + m.fallMs * 0.75; t += step) {
      pool.update(step, 0, 50, 0);
    }
    const fading = lit();
    expect(fading).toBeGreaterThan(0);
    expect(fading).toBeLessThan(m.peak * 0.5);   // genuinely on the way out

    // A gun firing again beside it has to relight the ground, not wait for the
    // fade to finish. Snapping to HOLD rather than to RISE is what avoids the
    // momentary blackout a restarted rise would produce.
    pool.spawn(1, 2, 1, m);
    expect(pool.merges).toBe(1);
    pool.update(1, 0, 50, 0);
    expect(lit()).toBeGreaterThan(fading * 2);
    pool.dispose();
  });

  it('a freed slot stops advertising its envelope', () => {
    // If `free()` left `envOf` set, the next co-located claim of that kind would
    // merge into a light that is not there — a silently dropped flash.
    const pool = new LightPool();
    pool.attach(new THREE.Scene());
    const m = VFX_LIGHTS.muzzle;
    pool.spawn(0, 2, 0, m);
    // Three calls minimum: RISE -> HOLD, HOLD -> FALL, FALL -> free.
    for (let i = 0; i < 6; i++) pool.update(m.riseMs + m.holdMs + m.fallMs, 0, 50, 0);
    expect(pool.activeCount).toBe(0);

    const before = pool.merges;
    pool.spawn(0, 2, 0, m);
    pool.update(m.riseMs, 0, 50, 0);
    expect(pool.merges).toBe(before);
    expect(pool.activeCount).toBe(1);
    pool.dispose();
  });
});

/* ========================================================================== */
/* 5. PARTICLE POOLS                                                          */
/* ========================================================================== */

describe('particle layers', () => {
  it('emits, integrates, uploads and recycles without growing', () => {
    const P = makeParticles();
    const cam = makeCamera();
    const layer = P.additive;

    const e = resetEmit();
    e.x = 256; e.y = 2; e.z = 256;
    e.vy = 10;
    e.lifeMs = 200;
    e.size0 = 1; e.size1 = 3;
    layer.emit(e);
    expect(layer.count).toBe(1);

    P.step(16, cam, 154);
    expect(layer.geometry.instanceCount).toBe(1);
    const off = layer.geometry.getAttribute('aOffset').array as Float32Array;
    expect(off[1]).toBeGreaterThan(2);        // it moved up

    // Past its life it is recycled, and the slot comes back.
    P.step(400, cam, 154);
    expect(layer.count).toBe(0);
    expect(layer.geometry.instanceCount).toBe(0);
    layer.emit(resetEmit());
    expect(layer.count).toBe(1);
    P.dispose();
  });

  it('drops rather than growing when the pool is full', () => {
    const P = makeParticles();
    for (let i = 0; i < P.additive.capacity + 25; i++) P.additive.emit(resetEmit());
    expect(P.additive.count).toBe(P.additive.capacity);
    expect(P.additive.dropped).toBe(25);
    P.dispose();
  });

  it('honours the emission delay so a smoke column staggers', () => {
    const P = makeParticles();
    const cam = makeCamera();
    const e = resetEmit();
    e.lifeMs = 1000;
    e.delayMs = 300;
    P.additive.emit(e);
    P.step(16, cam, 154);
    // Alive in the pool, but not yet written to the instance buffer.
    expect(P.additive.count).toBe(1);
    expect(P.additive.geometry.instanceCount).toBe(0);
    P.step(400, cam, 154);
    expect(P.additive.geometry.instanceCount).toBe(1);
    P.dispose();
  });

  it('a full explosion fills all three layers and claims a light', () => {
    const P = makeParticles();
    const pool = new LightPool();
    pool.attach(new THREE.Scene());
    // The vfx system normally installs these; do it by hand here.
    setGroundHeightFn(() => 0);
    setLightPool(pool);

    spawnExplosion(256, 1, 256, 2.2, 'unit');
    expect(P.additive.count).toBeGreaterThan(20);   // flash + billows + embers
    expect(P.lit.count).toBeGreaterThanOrEqual(14); // 14-22 smoke puffs
    expect(P.debris.count).toBeGreaterThanOrEqual(12);
    pool.update(16, 0, 50, 0);
    expect(pool.activeCount).toBe(1);               // §8.9 is non-negotiable

    setLightPool(null);
    pool.dispose();
    P.dispose();
  });
});

/* ========================================================================== */
/* 6. TESLA — scorecard #30                                                   */
/* ========================================================================== */

describe('tesla bolts', () => {
  it('scorecard #30: >=4 branches and >=1 closed loop, every single roll', () => {
    const bolt = new TeslaBolt();
    bolt.ax = 100; bolt.ay = 3; bolt.az = 100;
    bolt.bx = 118; bolt.by = 2; bolt.bz = 104;
    for (let i = 0; i < 200; i++) {
      bolt.reroll();
      expect(bolt.branchCount).toBeGreaterThanOrEqual(VFX_TESLA.branchMin);
      expect(bolt.loopCount).toBeGreaterThanOrEqual(1);
      expect(bolt.strokes).toBeGreaterThanOrEqual(VFX_TESLA.strokeMin);
    }
  });

  it('scorecard #30: the core filament is <= 3 px', () => {
    expect(VFX_TESLA.coreWidthPx).toBeLessThanOrEqual(3);
  });

  it('draws 3-5 overlapping jittered copies, not one line', () => {
    const bolt = new TeslaBolt();
    bolt.ax = 0; bolt.ay = 0; bolt.az = 0;
    bolt.bx = 20; bolt.by = 0; bolt.bz = 0;
    bolt.reroll();
    let trunks = 0;
    for (let i = 0; i < bolt.strokes; i++) if (bolt.strokeKind[i] === 0) trunks++;
    expect(trunks).toBeGreaterThanOrEqual(VFX_TESLA.strokeMin);
    expect(trunks).toBeLessThanOrEqual(VFX_TESLA.strokeMax);

    // Copies must actually differ, or they are one line drawn five times.
    const a0 = bolt.strokeStart[0], a1 = bolt.strokeStart[1];
    let diff = 0;
    for (let i = 1; i < bolt.strokeLen[0] - 1; i++) {
      diff += Math.abs(bolt.pts[(a0 + i) * 3 + 1] - bolt.pts[(a1 + i) * 3 + 1]);
    }
    expect(diff).toBeGreaterThan(0);
  });

  it('stays welded to both endpoints however hard it jitters', () => {
    const bolt = new TeslaBolt();
    bolt.ax = 5; bolt.ay = 4; bolt.az = -3;
    bolt.bx = 25; bolt.by = 1; bolt.bz = 9;
    bolt.reroll();
    const n = bolt.strokeLen[0];
    expect(bolt.pts[0]).toBeCloseTo(5, 5);
    expect(bolt.pts[(n - 1) * 3]).toBeCloseTo(25, 5);
    expect(bolt.pts[(n - 1) * 3 + 2]).toBeCloseTo(9, 5);
  });

  it('a live bolt emits geometry and claims a light', () => {
    const P = makeParticles();
    const pool = new LightPool();
    pool.attach(new THREE.Scene());
    setLightPool(pool);

    const B = new BeamSystem(P.ramps, VFX_RAMPS.length);
    setBeamSystem(B);
    B.spawnTesla(100, 4, 100, 116, 2, 103, 900);
    B.step(16, 36, 79.5);
    expect(B.activeBolts).toBe(1);
    expect(B.overlay.quadCount).toBeGreaterThan(40);
    expect(B.lastBranches).toBeGreaterThanOrEqual(4);
    expect(B.lastLoops).toBeGreaterThanOrEqual(1);
    // The mandatory impact starburst fired on the first frame.
    expect(P.additive.count).toBeGreaterThanOrEqual(VFX_TESLA.spikeMin);
    pool.update(16, 0, 50, 0);
    expect(pool.activeCount).toBeGreaterThanOrEqual(2);  // beam midpoint + impact

    B.dispose();
    setBeamSystem(null);
    setLightPool(null);
    pool.dispose();
    P.dispose();
  });
});

/* ========================================================================== */
/* 7. BEAMS AND RIBBONS                                                       */
/* ========================================================================== */

describe('ribbon batch', () => {
  it('writes four independent vertices per segment so strokes never bridge', () => {
    const P = makeParticles();
    const B = new BeamSystem(P.ramps, VFX_RAMPS.length);
    B.overlay.begin();
    B.overlay.segment(0, 0, 0, 10, 0, 0, 4, 4, 0, 0, 0, 1, 1, 1);
    B.overlay.segment(0, 0, 5, 10, 0, 5, 4, 4, 0, 0, 0, 1, 1, 1);
    B.overlay.end();
    expect(B.overlay.quadCount).toBe(2);
    expect(B.overlay.geometry.drawRange.count).toBe(12);
    const pos = B.overlay.geometry.getAttribute('position').array as Float32Array;
    // Quad 0's four verts are at z=0; quad 1's at z=5. Nothing in between.
    expect(pos[2]).toBe(0);
    expect(pos[4 * 3 + 2]).toBe(5);
    B.dispose();
    P.dispose();
  });

  it('rejects a zero-length segment instead of emitting a NaN quad', () => {
    const P = makeParticles();
    const B = new BeamSystem(P.ramps, VFX_RAMPS.length);
    B.overlay.begin();
    B.overlay.segment(1, 1, 1, 1, 1, 1, 4, 4, 0, 0, 0, 1, 1, 1);
    B.overlay.end();
    expect(B.overlay.quadCount).toBe(0);
    B.dispose();
    P.dispose();
  });

  it('pixel widths are resolution independent by construction', () => {
    const P = makeParticles();
    const B = new BeamSystem(P.ramps, VFX_RAMPS.length);
    // uPxScale = 2*tan(fov/2)/1440 — no framebuffer height in it at all.
    B.step(16, 36, 79.5);
    const expected = 2 * Math.tan((36 * Math.PI / 180) * 0.5) / 1440;
    // Through `RibbonBatch.pxScale`, not `material.uniforms`: the batch holds a
    // `THREE.Material` now so it can hold either kind, and the accessor is the
    // seam Stage F added for exactly this (`VFX_NODE_CUTOVER_NOTES` #2).
    expect(B.overlay.pxScale).toBeCloseTo(expected, 10);
    // A 3 px core at the bible's 79.5 m slant lands near the measured 0.1 m.
    expect(B.pxToMetres(3, 79.5)).toBeGreaterThan(0.05);
    expect(B.pxToMetres(3, 79.5)).toBeLessThan(0.2);
    B.dispose();
    P.dispose();
  });

  it('a prism beam opens, holds and closes on its own envelope', () => {
    const P = makeParticles();
    const B = new BeamSystem(P.ramps, VFX_RAMPS.length);
    setBeamSystem(B);
    B.spawnBeam(0, 3, 0, 40, 3, 0, 'prism', 500);
    B.step(16, 36, 79.5);
    expect(B.activeBeams).toBe(1);
    // Core + inner + outer = three quads for one straight beam.
    expect(B.overlay.quadCount).toBe(3);
    B.step(600, 36, 79.5);
    expect(B.activeBeams).toBe(0);
    B.dispose();
    setBeamSystem(null);
    P.dispose();
  });
});

/* ========================================================================== */
/* 8. GUNS AND TRAILS                                                         */
/* ========================================================================== */

describe('guns and trails', () => {
  it('scorecard #29: a heavy muzzle flash is >= 4x a 0.30 m barrel', () => {
    const barrelDiameter = 0.30;
    for (const f of VFX_GUNS.flash) {
      expect(f.lenM).toBeGreaterThanOrEqual(barrelDiameter * 4);
    }
    // And the heavy one is genuinely large relative to a 7 m hull.
    expect(VFX_GUNS.flash[2].lenM / 7).toBeGreaterThan(0.30);
  });

  it('scorecard #31: a trail is a BEAD CHAIN, not a ribbon', () => {
    const P = makeParticles();
    // 6.2 m of travel at the hot spacing must lay several discrete beads.
    spawnTrail(10, 2, 10, 6.2, 0, 0, true);
    const beads = Math.min(
      VFX_TRAIL.maxBeadsPerCall,
      Math.floor(6.2 / VFX_TRAIL.hotSpacingM),
    );
    expect(beads).toBeGreaterThanOrEqual(6);
    // A hot bead is a flame/smoke PAIR, so both layers filled.
    expect(P.additive.count).toBe(beads);
    expect(P.lit.count).toBe(beads);

    // They must be at DISTINCT positions along the travel vector — a smooth
    // ribbon would be one stretched quad.
    const cam = makeCamera();
    P.step(1, cam, 154);
    const off = P.additive.geometry.getAttribute('aOffset').array as Float32Array;
    const xs = new Set<number>();
    for (let i = 0; i < beads; i++) xs.add(Math.round(off[i * 3] * 4));
    expect(xs.size).toBeGreaterThanOrEqual(6);
    P.dispose();
  });

  it('a zero-length travel vector lays exactly one bead', () => {
    const P = makeParticles();
    spawnTrail(0, 0, 0, 0, 0, 0, false);
    expect(P.lit.count).toBe(1);
    P.dispose();
  });

  it('tracers taper: the head is wider than the tail', () => {
    const P = makeParticles();
    const B = new BeamSystem(P.ramps, VFX_RAMPS.length);
    const T = new TracerSystem(B.depthed);
    setTracerSystem(T);
    T.spawn(0, 2, 0, 1, 0, 0, 'cannon', false, 100);
    expect(T.count).toBe(1);
    T.step(16, 0.036);
    // Body quad + head quad.
    expect(B.depthed.quadCount).toBe(2);
    const param = B.depthed.geometry.getAttribute('aParam').array as Float32Array;
    const tailW = param[1];          // vert 0 = start (tail)
    const headW = param[2 * 4 + 1];  // vert 2 = end (head)
    expect(headW).toBeGreaterThan(tailW * 4);
    setTracerSystem(null);
    B.dispose();
    P.dispose();
  });

  it('only about one sixth of MG rounds are visible', () => {
    const P = makeParticles();
    const B = new BeamSystem(P.ramps, VFX_RAMPS.length);
    const T = new TracerSystem(B.depthed);
    let fired = 0;
    for (let i = 0; i < 300; i++) {
      const before = T.count;
      T.burst(0, 2, 0, 1, 0, 0, 1);
      fired += T.count - before;
      T.clear();
    }
    // The higher-density battlefield grade deliberately treats tracers as a
    // readable sample of the stream, not a luminous line for every projectile.
    expect(fired).toBeGreaterThan(25);
    expect(fired).toBeLessThan(90);
    B.dispose();
    P.dispose();
  });

  it('caps the drawn tracer stream without deleting live rounds', () => {
    const P = makeParticles();
    const B = new BeamSystem(P.ramps, VFX_RAMPS.length);
    const T = new TracerSystem(B.depthed);
    for (let i = 0; i < VFX_GUNS.tracerDrawBudget + 17; i++) {
      T.spawn(i * 0.1, 2, 0, 1, 0, 0, 'mg', false, 100);
    }
    const alive = T.count;
    T.step(1, 0.036);
    expect(T.count).toBe(alive);
    // Each visible tracer emits a tapered body and a rounded head.
    expect(B.depthed.quadCount).toBe(VFX_GUNS.tracerDrawBudget * 2);
    B.dispose();
    P.dispose();
  });
});

/* ========================================================================== */
/* 9. THE WHITE-OUT REGRESSIONS                                               */
/*                                                                            */
/* `05-combat` and `08-naval-water` rendered as a white haze over black ground */
/* for three independent reasons, all of them a per-element figure taken from  */
/* a whole-effect number. These lock the corrected readings in.               */
/* ========================================================================== */

describe('scorch decal sizing', () => {
  it('hands the decal sink a SEMI-major axis, not a diameter', () => {
    const P = makeParticles();
    const pool = new LightPool();
    pool.attach(new THREE.Scene());
    setGroundHeightFn(() => 0);
    setLightPool(pool);

    const radii: number[] = [];
    setScorchSink((_x, _z, radius) => { radii.push(radius); });
    for (let i = 0; i < 40; i++) spawnExplosion(256, 1, 256, VFX_EXPLOSION.unitDeathTL, 'unit');
    setScorchSink(null);

    expect(radii.length).toBe(40);
    // Bible §8.2: 1.6-2.4 TL across the MAJOR axis, so the semi-axis the
    // decal field wants is half of that. Passing the diameter (the bug) put
    // every value in 11.2-16.8 and carpeted a battlefield in black.
    const lo = VFX_EXPLOSION.scorchMinTL * 7 * 0.5;
    const hi = VFX_EXPLOSION.scorchMaxTL * 7 * 0.5;
    for (const r of radii) {
      expect(r).toBeGreaterThanOrEqual(lo - 1e-6);
      expect(r).toBeLessThanOrEqual(hi + 1e-6);
    }

    setLightPool(null);
    pool.dispose();
    P.dispose();
  });
});

describe('per-element sizes vs the whole-effect figures they came from', () => {
  it('one fireball billow is a FRACTION of the fireball, not the whole of it', () => {
    const P = makeParticles();
    const pool = new LightPool();
    pool.attach(new THREE.Scene());
    setGroundHeightFn(() => 0);
    setLightPool(pool);

    spawnExplosion(256, 1, 256, VFX_EXPLOSION.unitDeathTL, 'unit');
    P.step(760, makeCamera(), 154);   // step to the end of the billow life

    // The additive layer holds flash + billows + embers; the billows are the
    // only large sprites in it. The biggest one must still be well inside the
    // 2.2 TL fireball it is one of 8-14 of.
    const quad = P.additive.geometry.getAttribute('aQuad').array as Float32Array;
    let widest = 0;
    for (let i = 0; i < P.additive.geometry.instanceCount; i++) {
      if (quad[i * 4] > widest) widest = quad[i * 4];
    }
    expect(widest).toBeGreaterThan(0);
    expect(widest).toBeLessThan(VFX_EXPLOSION.unitDeathTL * 7);

    setLightPool(null);
    pool.dispose();
    P.dispose();
  });

  it('one plume puff is a fraction of the plume, and the plume is translucent', () => {
    const P = makeParticles();
    const pool = new LightPool();
    pool.attach(new THREE.Scene());
    setGroundHeightFn(() => 0);
    setLightPool(pool);

    spawnExplosion(256, 1, 256, VFX_EXPLOSION.unitDeathTL, 'unit');
    P.step(5400, makeCamera(), 154);

    const quad = P.lit.geometry.getAttribute('aQuad').array as Float32Array;
    const tint = P.lit.geometry.getAttribute('aTint').array as Float32Array;
    const n = P.lit.geometry.instanceCount;
    expect(n).toBeGreaterThan(0);
    let widest = 0;
    let maxAlpha = 0;
    for (let i = 0; i < n; i++) {
      if (quad[i * 4] > widest) widest = quad[i * 4];
      if (tint[i * 3 + 1] > maxAlpha) maxAlpha = tint[i * 3 + 1];
    }
    // A single puff must not be the whole plume on its own: at the combat
    // fixture's 48 m framing one 28 m puff covers the frame. `plumeEnvelopeTL`
    // is the bible's figure for the WHOLE column; `puffSize1TL` is one puff,
    // and reading the second where the first is meant is the exact mistake this
    // test exists to catch.
    expect(widest).toBeLessThan(VFX_EXPLOSION.plumeEnvelopeTL * 7 * 0.75);
    // And no puff may be near-opaque, or twenty of them are a wall.
    expect(maxAlpha).toBeLessThan(0.85);

    setLightPool(null);
    pool.dispose();
    P.dispose();
  });
});

/*
 * THE DETONATION BLOOM BUDGET.
 *
 * "The flashes when something explodes are HUGE, completely block the screen"
 * was reported twice. The first fix halved the flash disc's SIZE and left its
 * 7.0-linear GAIN alone, which is why it came back: against a 0.85 bloom
 * threshold a source that far over it is above threshold across its whole
 * visible disc, so a smaller quad is just a smaller solid white plate.
 *
 * These assertions are not style. Each one is a specific way that regression
 * comes back, written down so it fails in CI instead of in a bug report.
 */
describe('the detonation bloom budget', () => {
  const BLOOM_THRESHOLD = 1.20;

  it('reserves bloom for detonations and heavy ordnance', () => {
    // Above roughly this the source stops being "a hot core that haloes" and
    // becomes "a disc-shaped region the bloom pass must halo in its entirety".
    const ceiling = BLOOM_THRESHOLD * 5;
    const detonations: ReadonlyArray<readonly [string, number]> = [
      ['flashIntensity', VFX_EXPLOSION.flashIntensity],
      ['billowIntensity', VFX_EXPLOSION.billowIntensity],
      ['shockIntensity', VFX_EXPLOSION.shockIntensity],
      ['emberIntensity', VFX_EXPLOSION.emberIntensity],
      ['muzzle flashCoreIntensity', VFX_GUNS.flashCoreIntensity],
    ];
    for (const [name, gain] of detonations) {
      expect(gain, name).toBeGreaterThan(BLOOM_THRESHOLD);
      expect(gain, name).toBeLessThanOrEqual(ceiling);
    }

    const routineFire: ReadonlyArray<readonly [string, number]> = [
      ['impactFlashIntensity', VFX_EXPLOSION.impactFlashIntensity],
      ['sparkFlashIntensity', VFX_GUNS.sparkFlashIntensity],
      ['sparkIntensity', VFX_GUNS.sparkIntensity],
      ['tracerIntensity', VFX_GUNS.tracerIntensity],
      ['small muzzle', VFX_GUNS.flash[0].intensity],
      ['medium muzzle', VFX_GUNS.flash[1].intensity],
    ];
    for (const [name, gain] of routineFire) {
      expect(gain, name).toBeGreaterThan(0.8);
      expect(gain, name).toBeLessThanOrEqual(BLOOM_THRESHOLD);
    }

    expect(VFX_GUNS.cannonIntensity).toBeLessThan(BLOOM_THRESHOLD * 1.25);
    expect(VFX_GUNS.flash[2].intensity).toBeLessThan(BLOOM_THRESHOLD * 1.25);
  });

  it('the flash disc is a highlight ON the fireball, not a lid OVER it', () => {
    // A flash wider than the fireball it caps is the screen-filling white plate
    // the user reported: nothing of the explosion's structure survives under it.
    expect(VFX_EXPLOSION.flashSize1TL).toBeLessThan(VFX_EXPLOSION.unitDeathTL * 0.6);
    expect(VFX_EXPLOSION.flashSize0TL).toBeLessThan(VFX_EXPLOSION.flashSize1TL);
    // The structure flash is bigger — a building dying must read as bigger than
    // a tank dying — but still well inside the ~31 m of ground the combat
    // fixture frames at 48 m.
    expect(VFX_EXPLOSION.structureFlashSize1TL)
      .toBeGreaterThan(VFX_EXPLOSION.flashSize1TL);
    expect(VFX_EXPLOSION.structureFlashSize1TL * 7).toBeLessThan(20);
  });

  it('the billow shell is absolute, so shrinking billows cannot re-stack them', () => {
    // It used to be a fraction of `billowSize0TL`. Any pass that shrank the
    // billows silently collapsed the shell with them and piled 8-14 additive
    // sprites back onto the same pixels — which is BRIGHTER, not smaller.
    expect(VFX_EXPLOSION.billowShellTL).toBeGreaterThan(VFX_EXPLOSION.billowSize0TL);
  });

  it('one billow is a fraction of the fireball, one puff a fraction of the plume', () => {
    expect(VFX_EXPLOSION.billowSize1TL).toBeLessThan(VFX_EXPLOSION.unitDeathTL * 0.6);
    expect(VFX_EXPLOSION.puffSize1TL).toBeLessThan(VFX_EXPLOSION.plumeEnvelopeTL * 0.6);
  });

  it('the explosion light does not reach across a whole framing', () => {
    // The combat fixture frames about 60 m of ground. A light whose cutoff
    // exceeds that relights every pixel in the shot, which is the same
    // complaint arriving by a second route.
    expect(VFX_LIGHTS.explosion.range).toBeLessThan(45);
    // But it must still be the biggest one-shot in the table — an explosion
    // that does not light the world is bible §14 R6's particle-demo failure.
    expect(VFX_LIGHTS.explosion.peak).toBeGreaterThan(VFX_LIGHTS.muzzle.peak);
    expect(VFX_LIGHTS.explosion.range).toBeGreaterThan(VFX_LIGHTS.muzzle.range);
  });
});

describe('empty VFX meshes are not submitted', () => {
  it('a sprite layer with nothing live hides itself, and comes back', () => {
    const P = makeParticles();
    const cam = makeCamera();

    P.step(16, cam, 154);
    expect(P.additive.mesh.visible).toBe(false);
    expect(P.lit.mesh.visible).toBe(false);
    expect(P.debris.mesh.visible).toBe(false);

    const e = resetEmit();
    e.lifeMs = 500;
    P.additive.emit(e);
    P.debris.spawn(0, 5, 0, 0, 0, 0, 0.3, 500, 0, 0, 0, 0);
    P.step(16, cam, 154);
    expect(P.additive.mesh.visible).toBe(true);
    expect(P.debris.mesh.visible).toBe(true);
    expect(P.lit.mesh.visible).toBe(false);

    P.step(900, cam, 154);
    expect(P.additive.mesh.visible).toBe(false);
    expect(P.debris.mesh.visible).toBe(false);
    P.dispose();
  });

  it('a ribbon batch that drew no quads hides itself', () => {
    const P = makeParticles();
    const B = new BeamSystem(P.ramps, VFX_RAMPS.length);

    B.overlay.begin();
    B.overlay.end();
    expect(B.overlay.mesh.visible).toBe(false);

    B.overlay.begin();
    B.overlay.segment(0, 2, 0, 8, 2, 0, 4, 4, 0, 0, 1, 3, 1, 1);
    B.overlay.end();
    expect(B.overlay.mesh.visible).toBe(true);

    B.dispose();
    P.dispose();
  });
});

/* ========================================================================== */

describe('the fifth brightness report: one gain over the whole explosion', () => {
  /**
   * Explosion brightness was reported FIVE times and nothing shipped. Every
   * previous pass lowered one sprite — flashIntensity 7.0 -> 3.5,
   * billowIntensity 4.2 -> 2.1, the muzzle core 9.0 -> 4.0 — and every one
   * measured correctly, because each was measured on the sprite it changed.
   *
   * `tools/flash-stack.mjs --ablate`, with a mask that finally worked, showed
   * the LAYER is the unit of the problem: hiding the additive quads removes 94%
   * of a single explosion's blown-white area and 97% of a twenty-explosion
   * pile, and `everything-off` lands exactly on baseline so nothing is
   * unaccounted for. `outputGain` is the answer to that measurement.
   */
  it('reaches every emitter, because it is folded into `glare` and not into a sprite', () => {
    // The mechanism, asserted structurally. Applying it at each `e.i0` would
    // work today and be silently missed by the next emitter somebody adds;
    // `glare` is the one value every emission in `spawnExplosion` already
    // multiplies by.
    const src = readFileSync(join(__dirname, '..', 'src/vfx/Explosions.ts'), 'utf8');
    expect(src).toMatch(/admitGlare\([^)]*\)\s*\n?\s*\*\s*X\.outputGain/);
  });

  it('scales the LIT billows as well as the additive quads', () => {
    // Hiding the billows does not reduce blown area — so scaling only the
    // additive layer would look like the cheaper fix. It is not: the RATIOS are
    // the art direction, and `flashIntensity` dropping under `billowIntensity`
    // turns the highlight into a DARK SPOT on its own fireball. The two cases
    // above catch that by identifying a flash disc as the brightest sprite in
    // the frame; this states the invariant directly.
    const emittedFlash = VFX_EXPLOSION.flashIntensity * VFX_EXPLOSION.outputGain;
    const emittedBillow = VFX_EXPLOSION.billowIntensity * VFX_EXPLOSION.outputGain;
    expect(emittedFlash, 'the flash must out-gain the billows it sits inside')
      .toBeGreaterThan(emittedBillow);
    // And the ratio must be the authored one, i.e. the gain is uniform.
    expect(emittedFlash / emittedBillow)
      .toBeCloseTo(VFX_EXPLOSION.flashIntensity / VFX_EXPLOSION.billowIntensity, 10);
  });

  it('keeps the flash core above the bloom threshold', () => {
    // 0.875 — a literal 75% cut of the authored 3.5 — falls UNDER the 0.85
    // bloom threshold and the flash stops being a flash. The 75% cut this
    // report asked for was delivered in BLOWN AREA (5.753pp -> 1.416pp,
    // measured), which is what the player sees, not by dividing one constant.
    expect(VFX_EXPLOSION.flashIntensity * VFX_EXPLOSION.outputGain)
      .toBeGreaterThan(0.85);
  });

  it('is a real cut, not a token one', () => {
    expect(VFX_EXPLOSION.outputGain).toBeGreaterThan(0);
    expect(VFX_EXPLOSION.outputGain).toBeLessThan(1);
  });
});

/* ========================================================================== */

describe('the tesla starburst, and the gap that hid it', () => {
  /**
   * "tesla tower flash is HUGE HUGE HUGE, reduce its glow by at least 75%."
   *
   * THIRD report on the same effect. v1.17.0 cut the ARC by 59% and it came
   * back, because a Tesla Coil firing produces TWO things and the probe could
   * only reach one: `flash-stack --ablate` called `V.tesla()`, which is the
   * bolt. The impact starburst — a 112 px ball plus fourteen to twenty spikes
   * up to 280 px long — had never been measured at all.
   *
   * The measurement then REFUTED the hypothesis it was built to confirm: the
   * starburst is +1.78pp of blue frame area at four hits against the arc's
   * +4.50pp. A fifth of the problem, not the whole of it. Both were cut.
   */
  it('charges the starburst to the glare budget, which it never was', () => {
    // Every other additive emitter goes through `admitGlare`. This one did not,
    // so four coils firing into one spot produced four full-strength bursts —
    // the exact uncapped stacking `arc` and `beam` were given a cost for.
    const src = readFileSync(join(__dirname, '..', 'src/vfx/Beams.ts'), 'utf8');
    const fn = src.slice(src.indexOf('teslaImpact(x: number'));
    const body = fn.slice(0, fn.indexOf('\n  }'));
    expect(body).toMatch(/admitGlare\(x, y, z, VFX_GLARE\.cost\.teslaImpact\)/);
    // And it must reach BOTH emissions, not just the ball.
    expect(body).toMatch(/T\.burstIntensity \* glare/);
    expect(body).toMatch(/T\.spikeIntensity \* glare/);
  });

  it('has no additive gain left hiding outside the config', () => {
    // The spike gain was a hard-coded 4.2 inline in `teslaImpact` — the one
    // additive gain in the whole VFX system that did not live in the table
    // where somebody looking for it would look. Same defect shape as the water
    // foam's hard-coded lighting.
    expect(VFX_TESLA.spikeIntensity).toBeGreaterThan(0);
    const src = readFileSync(join(__dirname, '..', 'src/vfx/Beams.ts'), 'utf8');
    const fn = src.slice(src.indexOf('teslaImpact(x: number'));
    const body = fn.slice(0, fn.indexOf('\n  }'));
    expect(body, 'a bare numeric gain is back in teslaImpact')
      .not.toMatch(/e\.i0 = \d/);
  });

  it('keeps the core filament, which is what makes a bolt a bolt', () => {
    // Everything around it came down hard; the 2.6 px core did not. Scorecard
    // #30 measures "core <= 3 px at L >= 248", and a bolt whose core is dimmer
    // than its own sheath reads as a smear rather than as lightning.
    expect(VFX_TESLA.coreWidthPx).toBeLessThanOrEqual(3);
    expect(VFX_TESLA.coreIntensity).toBeGreaterThan(VFX_TESLA.sheathIntensity);
    expect(VFX_TESLA.sheathIntensity).toBeGreaterThan(VFX_TESLA.glowIntensity);
  });

  it('sizes the starburst below the ball it used to be', () => {
    // 35-45 px radius grown 1.25x is a 112 px disc; the spikes ran to 280 px
    // with the long multiplier. Both are quoted in PIXELS, so they claim the
    // same share of a 720p frame as of a 1440p one and read larger on the
    // smaller screen — which is why a capture at 1440p understated this.
    expect(VFX_TESLA.burstRadiusPx[1]).toBeLessThanOrEqual(24);
    expect(VFX_TESLA.spikeLenPx[1] * VFX_TESLA.spikeLongMul).toBeLessThan(140);
  });

  it('does not leave the Refractor Tower brighter than the Coil that was reported', () => {
    // The report named the Tesla Coil. Once the arc had been cut twice the
    // Allied equivalent measured WORSE (+4.13pp against +3.40pp blue at four),
    // and shipping that would simply be the next report.
    expect(VFX_LIGHTS.prism.peak).toBeLessThanOrEqual(VFX_LIGHTS.teslaArc.peak + 0.5);
    expect(VFX_LIGHTS.prism.range).toBeLessThanOrEqual(VFX_LIGHTS.teslaArc.range + 2);
  });
});
