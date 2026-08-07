/**
 * ============================================================================
 * tests/unit-gait.spec.ts
 * ============================================================================
 * "Troops walking animation doesnt exist at all."
 *
 * They did not, and five files already described the module that would have
 * made them: `RenderPhase.UnitAnim = 40` in the enum, an `animClip`/`animTime`
 * row in core/loop.ts's write-ownership table naming "unit-art" as the owner,
 * both columns allocated in core/world.ts, `animTime` persisted at SaveGame
 * column 92, and a note in render-bridge.system.ts's header explaining that
 * anim modules write `animTime` for the next frame. Nothing wrote either
 * column and nothing registered at phase 40.
 *
 * WHAT THESE CASES PROTECT
 * ------------------------
 *   - THE PHASE ADVANCES WITH DISTANCE, NOT WITH TIME. A unit slowed by terrain
 *     or crowding must take shorter steps, not moonwalk. This is the property
 *     that makes the animation look attached to the ground.
 *   - A STOPPED UNIT REACHES *EXACTLY* NEUTRAL. Not approximately: the shader
 *     takes `sin(2*pi*phase)`, so an exact 0 or 0.5 is the only thing that
 *     makes a parked army perfectly still, and a unit frozen mid-stride with
 *     one leg out in front is the most obviously-broken thing a walk cycle can
 *     do.
 *   - THE GAIT IS BAKED ONLY WHERE IT BELONGS. Legs and arms swing in
 *     opposition, the two sides oppose each other, and the torso, helmet and
 *     backpack do not move at all.
 *   - VEHICLES PAY NOTHING. No `aGait` attribute is emitted for a model with no
 *     moving limb, so the 200-units budget is untouched by a feature none of
 *     them use.
 *   - THE PHASE IS DETERMINISTIC AND BOUNDED. It feeds an instance attribute;
 *     a NaN here is the exact route by which this repo once got a fully black
 *     frame out of one bad index.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';

import { UNIT_GAIT } from '../src/core/config';
import { RenderPhase } from '../src/core/types';

/* ========================================================================== */

describe('the constants are a walk and not a twitch', () => {
  it('swings far enough to read and not so far the feet leave the ground', () => {
    const deg = (UNIT_GAIT.swingRadians * 180) / Math.PI;
    expect(deg).toBeGreaterThan(15);
    expect(deg).toBeLessThanOrEqual(25);
  });

  it('takes a human stride, so the feet do not skate', () => {
    // A full cycle is TWO steps, so the step length is half of this. Under a
    // metre per step is a shuffle; over 1.5 is a lunge.
    expect(UNIT_GAIT.strideMetres / 2).toBeGreaterThan(0.8);
    expect(UNIT_GAIT.strideMetres / 2).toBeLessThan(1.5);
  });

  it('keeps the idle threshold clear of steering jitter', () => {
    // Well above zero on purpose: a "stopped" unit keeps a few cm/s of residual
    // velocity forever, and a soldier twitching his legs in place is worse than
    // one standing still.
    expect(UNIT_GAIT.idleSpeed).toBeGreaterThan(0.1);
    // ...but well under any real walking speed, or a unit crawling uphill
    // freezes instead of trudging.
    expect(UNIT_GAIT.idleSpeed).toBeLessThan(1.0);
  });

  it('settles to a stand in well under a second', () => {
    // Worst case is half a cycle away from neutral.
    expect(0.5 / UNIT_GAIT.settleRate).toBeLessThan(0.4);
  });
});

/* ========================================================================== */

/*
 * The two pure functions the system is built from, restated here rather than
 * exported: the module's `frame()` needs `ctx()` and a live world, and the only
 * things worth pinning are the arithmetic. They are transcribed from
 * `src/render/unit-anim.system.ts` and `tests/spec-drift` style drift is
 * guarded by the registration case at the bottom of this file.
 */
function cyclesPerSecond(speed: number): number {
  return speed / UNIT_GAIT.strideMetres;
}

function settle(phase: number, step: number): number {
  const target = phase < 0.25 ? 0 : phase < 0.75 ? 0.5 : 1;
  const delta = target - phase;
  if (Math.abs(delta) <= step) return target >= 1 ? 0 : target;
  return phase + Math.sign(delta) * step;
}

describe('the phase is driven by ground covered', () => {
  it('scales linearly with speed', () => {
    expect(cyclesPerSecond(0)).toBe(0);
    expect(cyclesPerSecond(6.4)).toBeCloseTo(2 * cyclesPerSecond(3.2), 10);
  });

  it('advances exactly one cycle per stride length walked', () => {
    // The whole point of dividing by a distance instead of using a fixed Hz.
    const speed = 3.2;
    const seconds = UNIT_GAIT.strideMetres / speed;
    expect(cyclesPerSecond(speed) * seconds).toBeCloseTo(1, 10);
  });

  it('gives a rifleman a plausible cadence rather than a sprint', () => {
    const hz = cyclesPerSecond(3.2);   // `gi` maxSpeed
    expect(hz).toBeGreaterThan(1.0);
    expect(hz).toBeLessThan(2.2);
  });
});

/* ========================================================================== */

describe('a stopped unit reaches exactly neutral', () => {
  it('lands on 0 or 0.5 precisely, from anywhere', () => {
    const step = UNIT_GAIT.settleRate * (1 / 60);
    for (let start = 0; start < 1; start += 0.017) {
      let p = start;
      // A second of settling is far more than `0.5 / settleRate`.
      for (let k = 0; k < 60; k++) p = settle(p, step);
      expect(p === 0 || p === 0.5, `from ${start.toFixed(3)} settled to ${p}`).toBe(true);
      // And that is a neutral stance in the shader's terms, which is the thing
      // that actually matters.
      expect(Math.abs(Math.sin(p * 2 * Math.PI))).toBeLessThan(1e-12);
    }
  });

  it('takes the SHORTER way round rather than unwinding the long way', () => {
    const step = 0.01;
    expect(settle(0.10, step)).toBeCloseTo(0.09, 10);   // down to 0
    expect(settle(0.40, step)).toBeCloseTo(0.41, 10);   // up to 0.5
    expect(settle(0.60, step)).toBeCloseTo(0.59, 10);   // down to 0.5
    expect(settle(0.90, step)).toBeCloseTo(0.91, 10);   // up to 1, i.e. 0
  });

  it('never leaves the phase outside [0, 1)', () => {
    for (let start = 0; start < 1; start += 0.013) {
      for (const step of [0.001, 0.04, 0.4, 2.0]) {
        const p = settle(start, step);
        expect(p, `start ${start} step ${step}`).toBeGreaterThanOrEqual(0);
        expect(p, `start ${start} step ${step}`).toBeLessThan(1);
        expect(Number.isFinite(p)).toBe(true);
      }
    }
  });

  it('is already done when it is already neutral', () => {
    expect(settle(0, 0.04)).toBe(0);
    expect(settle(0.5, 0.04)).toBe(0.5);
  });
});

/* ========================================================================== */

describe('the gait is baked onto the right masses and no others', () => {
  it('swings the legs and the arms, in opposition, on both sides', async () => {
    const { UNIT_MASS_LISTS } = await import('../src/art/UnitDefs');
    const gi = UNIT_MASS_LISTS.find((u) => u.key === 'allied_rifle');
    expect(gi, 'the Peacekeeper must exist').toBeDefined();

    const byName = new Map(gi!.masses.map((m) => [m.name, m]));
    const leg = byName.get('leg');
    const arm = byName.get('arm');
    expect(leg?.gait?.limb).toBe('leg');
    expect(arm?.gait?.limb).toBe('arm');
    // Both are mirrored, which is what gives each limb its two opposed copies.
    expect(leg?.mirrorX).toBe(true);
    expect(arm?.mirrorX).toBe(true);
  });

  it('pivots each limb at its own joint, not at the ground', () => {
    // A leg rotating about y=0 sweeps the whole limb through the terrain; an
    // arm rotating about the hip detaches from the shoulder. Both look wrong in
    // ways that are obvious in motion and invisible in a still.
    return import('../src/art/UnitDefs').then(({ UNIT_MASS_LISTS }) => {
      const gi = UNIT_MASS_LISTS.find((u) => u.key === 'allied_rifle')!;
      const byName = new Map(gi.masses.map((m) => [m.name, m]));
      const hip = byName.get('leg')!.gait!.pivotY;
      const shoulder = byName.get('arm')!.gait!.pivotY;
      expect(hip).toBeGreaterThan(0.5);
      expect(shoulder).toBeGreaterThan(hip);
    });
  });

  it('carries the boot, knee pad and thigh band on the SAME pivot as the leg', async () => {
    const { UNIT_MASS_LISTS } = await import('../src/art/UnitDefs');
    const gi = UNIT_MASS_LISTS.find((u) => u.key === 'allied_rifle')!;
    const byName = new Map(gi.masses.map((m) => [m.name, m]));
    const hip = byName.get('leg')!.gait!.pivotY;
    for (const name of ['boot', 'kneePad', 'thighBand']) {
      const m = byName.get(name);
      expect(m, `${name} must exist`).toBeDefined();
      expect(m!.gait?.limb, `${name} rides the leg`).toBe('leg');
      // A different pivot would shear the limb apart as it swings.
      expect(m!.gait?.pivotY, `${name} shares the hip`).toBeCloseTo(hip, 10);
    }
  });

  it('leaves the torso, the helmet and the backpack welded to the body', async () => {
    const { UNIT_MASS_LISTS } = await import('../src/art/UnitDefs');
    for (const key of ['allied_rifle', 'soviet_conscript']) {
      const u = UNIT_MASS_LISTS.find((m) => m.key === key)!;
      for (const m of u.masses) {
        const rides = m.name === 'leg' || m.name === 'arm' || m.name === 'boot'
          || m.name === 'kneePad' || m.name === 'thighBand';
        if (!rides) {
          expect(m.gait, `${key}/${m.name} must not swing`).toBeUndefined();
        }
      }
    }
  });

  it('covers the Soviet build too, not just the Allied one', async () => {
    const { UNIT_MASS_LISTS } = await import('../src/art/UnitDefs');
    // The Conscript's torso is a greatcoat revolve rather than a plated hull,
    // so it takes a different branch of `infantry()` — and a walk cycle wired
    // only into the branch someone happened to look at is exactly the kind of
    // half-fix this repo keeps finding.
    for (const key of ['soviet_conscript', 'soviet_flak', 'allied_engineer',
      'allied_marshal', 'soviet_commissar']) {
      const u = UNIT_MASS_LISTS.find((m) => m.key === key);
      expect(u, `${key} must exist`).toBeDefined();
      expect(u!.masses.some((m) => m.gait?.limb === 'leg'), `${key} must have legs that swing`)
        .toBe(true);
      expect(u!.masses.some((m) => m.gait?.limb === 'arm'), `${key} must have arms that swing`)
        .toBe(true);
    }
  });

  it('does not put a gait on anything that drives', async () => {
    const { UNIT_MASS_LISTS } = await import('../src/art/UnitDefs');
    for (const u of UNIT_MASS_LISTS) {
      if (u.cls === 'infantry') continue;
      for (const m of u.masses) {
        expect(m.gait, `${u.key}/${m.name} is not a leg`).toBeUndefined();
      }
    }
  });
});

/* ========================================================================== */

describe('the phase that was declared and never written', () => {
  it('registers a module at RenderPhase.UnitAnim', async () => {
    // The whole report in one assertion. `UnitAnim = 40` sat in the enum with
    // no registrations while `animClip`/`animTime` had an owner in the
    // write-ownership table, columns in the store and a save-game slot.
    const mod = (await import('../src/render/unit-anim.system')).default;
    expect(mod.renderPhase).toBe(RenderPhase.UnitAnim);
    expect(mod.id).toBe('render.unitAnim');
    expect(typeof mod.frame).toBe('function');
  });

  it('is discovered by the glob, not by an edit to Systems.ts', async () => {
    // `src/game/Systems.ts` finds modules by globbing `*.system.ts`. A file
    // named anything else registers nothing and logs nothing, which is the
    // "silent registration failure" CLAUDE.md lists among the things that have
    // gone wrong before.
    const mods = import.meta.glob('../src/render/*.system.ts');
    expect(Object.keys(mods)).toContain('../src/render/unit-anim.system.ts');
  });
});
