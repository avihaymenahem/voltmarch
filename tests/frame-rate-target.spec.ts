/**
 * ============================================================================
 * tests/frame-rate-target.spec.ts — the two dead settings, and why the obvious
 * fix was backwards
 * ============================================================================
 * `graphics.fpsCap` and the desktop bridge's `displayFrequency()` were both
 * PLUMBED AND READ BY NOBODY. `fpsCap` was persisted, clamped and exempted from
 * retiring the calibration; `displayFrequency` was an IPC handler, a preload
 * method and a declared interface with zero call sites in `src/`.
 *
 * The task said: *"a 144 Hz desktop player is calibrated against a 60 Hz target
 * exactly as a browser player is, and the one capability that could fix it is
 * already delivered."* That reads as an obvious wiring job — take the panel's
 * refresh rate, make it the calibration target.
 *
 * **IT IS BACKWARDS, AND THIS FILE IS THE MEASUREMENT THAT SAYS SO.** Section 1
 * feeds §9's own fitted line through the real solver at each candidate target.
 * Every target above 60 lands on the resolution FLOOR with ambient occlusion
 * switched off, because that machine's 5.86 ms of fixed cost is already 84% of
 * a 144 Hz frame budget and no resolution scale can buy that back. On a machine
 * fast enough to actually reach 144, the answer clamps to the ceiling and is
 * IDENTICAL to what 60 gives.
 *
 * Inert where it would help, destructive where it would not. So the target is
 * opt-in: `fpsCap` drives it, default 0 means 60, and `displayFrequency` only
 * annotates the row.
 *
 * ============================================================================
 * SECTION 3 IS THE ONE THAT WOULD HAVE CAUGHT THE REAL BUG
 * ============================================================================
 * `graphics.fpsCap` sat on `CALIBRATION_EXEMPT` under an argument that was true
 * when written — *"it has ZERO readers... it cannot affect anything, including
 * the frame"*. Wiring it up expired that argument silently. Left on the list,
 * choosing 120 fps would have retired nothing, the stored calibration solved
 * for 60 would have stood, and the setting would have appeared to do nothing at
 * all. An exemption argued from "nothing reads it" has an expiry date and no
 * mechanism can notice it passing — so it is pinned here instead.
 * ========================================================================== */

import { describe, expect, it } from 'vitest';

import {
  CALIBRATION,
  HardwareCalibration,
  solveScale,
  targetMsForCap,
  type CalibrationResult,
} from '../src/render/HardwareCalibration';
import { FPS_CAPS, retiresCalibration } from '../src/shell/settings-store';

/** §9's own machine: 2560x1440, integrated Radeon, 194 drawn units, r² 0.995. */
const REPORTER = { fixedMs: 5.86, perMpxMs: 6.40, nativeMpx: (2560 * 1440) / 1e6 };
/** A machine that genuinely has the headroom a high-refresh panel implies. */
const FAST = { fixedMs: 1.5, perMpxMs: 1.2, nativeMpx: (2560 * 1440) / 1e6 };

function frameMsAt(m: typeof REPORTER, scale: number): number {
  return m.fixedMs + m.perMpxMs * m.nativeMpx * scale * scale;
}

/** Mirrors `calibration.system.ts`: first probe applied before the first sample. */
function drive(c: HardwareCalibration, m: typeof REPORTER): CalibrationResult | null {
  let scale = c.firstProbeScale;
  for (let i = 0; i < 5000; i++) {
    const step = c.sample(frameMsAt(m, scale), m.nativeMpx * scale * scale);
    if (step.result !== null) return step.result;
    if (step.scale !== null) scale = step.scale;
  }
  return null;
}

/* ==========================================================================
 * 1. THE MEASUREMENT — what a higher target actually costs
 * ========================================================================== */

describe('a higher frame-rate target is inert or destructive, never free', () => {
  it('every target above 60 floors §9\'s machine and sheds ambient occlusion', () => {
    const line = { fixedMs: REPORTER.fixedMs, perMpxMs: REPORTER.perMpxMs };

    // 60 fps — the shipped default. A real, sharp, mid-range answer.
    const at60 = solveScale(line, targetMsForCap(0), REPORTER.nativeMpx) as number;
    expect(at60).toBeCloseTo(0.624932, 6);
    expect(at60).toBeGreaterThan(CALIBRATION.minScale);

    // Everything above it solves BELOW the floor, so the controller clamps and
    // `finish` switches AO off and shadows to low. That is the whole cost.
    for (const [cap, expected] of [[90, 0.434955], [120, 0.298510], [144, 0.197661]] as const) {
      const s = solveScale(line, targetMsForCap(cap), REPORTER.nativeMpx) as number;
      expect(s, `${cap} fps solved to ${s.toFixed(6)}`).toBeCloseTo(expected, 6);
      expect(s, `${cap} fps must be under the floor`).toBeLessThan(CALIBRATION.minScale);
    }
  });

  it('the cause is the INTERCEPT, not the slope — fixed cost alone eats the budget', () => {
    // 5.86 ms before a single pixel is drawn. This is why no resolution scale
    // rescues a high target: the pixel term can go to zero and the frame still
    // misses. Quoted in `targetMsForCap`'s header.
    expect(REPORTER.fixedMs / targetMsForCap(144)).toBeCloseTo(0.843840, 6);
    expect(REPORTER.fixedMs / targetMsForCap(120)).toBeCloseTo(0.703200, 6);
    expect(REPORTER.fixedMs / targetMsForCap(0)).toBeCloseTo(0.350898, 6);
  });

  it('on hardware that COULD reach 144, the target changes nothing at all', () => {
    // Both clamp to the ceiling, so the two answers are the same answer. A
    // feature that is inert exactly where it would be justified is not a
    // feature, which is the other half of the argument for opt-in.
    const line = { fixedMs: FAST.fixedMs, perMpxMs: FAST.perMpxMs };
    const at60 = solveScale(line, targetMsForCap(0), FAST.nativeMpx) as number;
    const at144 = solveScale(line, targetMsForCap(144), FAST.nativeMpx) as number;
    expect(at60).toBeGreaterThan(CALIBRATION.maxScale);
    expect(at144).toBeGreaterThan(CALIBRATION.maxScale);

    const r60 = drive(new HardwareCalibration(1, 1, CALIBRATION.maxScale, targetMsForCap(0)), FAST);
    const r144 = drive(
      new HardwareCalibration(1, 1, CALIBRATION.maxScale, targetMsForCap(144)), FAST,
    );
    expect(r60?.resolutionScale).toBe(r144?.resolutionScale);
    expect(r60?.ao).toBe(r144?.ao);
  });
});

/* ==========================================================================
 * 2. THE CONTROLLER HONOURS THE TARGET IT IS HANDED
 * ========================================================================== */

describe('the target reaches the controller', () => {
  it('a 144 fps run really does end at the floor with AO off', () => {
    const r = drive(
      new HardwareCalibration(1, 1, CALIBRATION.maxScale, targetMsForCap(144)), REPORTER,
    ) as CalibrationResult;
    expect(r.reason).toBe('floor');
    expect(r.resolutionScale).toBe(CALIBRATION.minScale);
    expect(r.ao).toBe(false);
    expect(r.shadowQuality).toBe('low');
  });

  it('the same machine at the default target keeps AO and lands mid-range', () => {
    const r = drive(
      new HardwareCalibration(1, 1, CALIBRATION.maxScale, targetMsForCap(0)), REPORTER,
    ) as CalibrationResult;
    expect(r.reason).toBe('fill-rate');
    expect(r.resolutionScale).toBeGreaterThan(CALIBRATION.minScale);
    expect(r.ao).toBe(true);
    expect(r.shadowQuality).toBe('high');
  });

  it('omitting the target is exactly the old behaviour', () => {
    // The parameter is optional so the ~15 existing call sites in
    // `hardware-calibration.spec.ts` keep meaning what they meant.
    const withDefault = drive(new HardwareCalibration(1, 1, CALIBRATION.maxScale), REPORTER);
    const explicit = drive(
      new HardwareCalibration(1, 1, CALIBRATION.maxScale, CALIBRATION.targetMs), REPORTER,
    );
    expect(withDefault?.resolutionScale).toBe(explicit?.resolutionScale);
  });

  it('a nonsense target falls back rather than flooring every machine', () => {
    // `solveScale` returns 0 for a non-positive budget, which clamps to the
    // floor — so an unvalidated 0 or NaN would quietly mush the picture on
    // hardware that needed no help at all.
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const r = drive(
        new HardwareCalibration(1, 1, CALIBRATION.maxScale, bad), REPORTER,
      ) as CalibrationResult;
      expect(r.reason, `target ${bad}`).toBe('fill-rate');
    }
  });

  it('targetMsForCap maps a cap to a frame time, and 0 means 60', () => {
    expect(targetMsForCap(0)).toBe(CALIBRATION.targetMs);
    expect(targetMsForCap(60)).toBeCloseTo(16.667, 3);
    expect(targetMsForCap(144)).toBeCloseTo(6.944, 3);
    for (const bad of [-1, Number.NaN]) expect(targetMsForCap(bad)).toBe(CALIBRATION.targetMs);
    // Every cap the UI can offer must produce a usable target.
    for (const cap of FPS_CAPS) expect(targetMsForCap(cap)).toBeGreaterThan(0);
  });
});

/* ==========================================================================
 * 3. THE EXPIRED EXEMPTION
 * ========================================================================== */

describe('changing the frame-rate target retires the calibration', () => {
  it('graphics.fpsCap is NOT calibration-exempt', () => {
    // THE REGRESSION THIS FILE EXISTS FOR. While `fpsCap` had no readers it was
    // correctly exempt. It has one now, so an exempt `fpsCap` means the player
    // picks 120, nothing re-measures, the calibration solved for 60 stands, and
    // the row silently does nothing.
    expect(
      retiresCalibration(['graphics.fpsCap']),
      'fpsCap drives the calibration target — changing it must re-measure',
    ).toBe(true);
  });

  it('the rows that genuinely cannot affect a pixel are still exempt', () => {
    // The falsifier: without this, "everything retires" would also pass above.
    for (const p of [
      'graphics.calibrated',
      'graphics.panelBlur',
      'graphics.perfOverlay',
      'graphics.fov',
      'graphics.minZoom',
      'graphics.maxZoom',
    ]) {
      expect(retiresCalibration([p]), `${p} should not retire the calibration`).toBe(false);
    }
  });
});
