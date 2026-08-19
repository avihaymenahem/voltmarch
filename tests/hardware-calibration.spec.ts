/**
 * ============================================================================
 * tests/hardware-calibration.spec.ts — THE ONE-TIME GRAPHICS CALIBRATION
 * ============================================================================
 * Reported: *"i want the adaptive resolution to be off by default. instead, set
 * the graphic options that match the best for user for the first time and thats
 * it"*.
 *
 * Four things are checked here and they are not equally important.
 *
 *   §1-3 THE ARITHMETIC. `docs/RENDER_FINDINGS.md` §9 measured this project's
 *        frame at `GPU ms = 5.86 + 6.40 x Mpx`, r² 0.995. The solver is fed
 *        exactly that machine and has to recover exactly that line — which is
 *        the strongest test available, because the answer was measured on real
 *        GPU timer queries by somebody else, months before this code existed.
 *
 *   §4   **THE `?shot=` GUARDS, WHICH ARE THE ONES THAT COULD RUIN EVERYTHING.**
 *        `npm run shots` rests on captures being byte-identical run to run — ten
 *        of thirteen fixtures are byte-exact and the whole visual-regression
 *        pipeline is built on it. A calibration that fired during a capture
 *        would resize the drawing buffer mid-run, and the damage would present
 *        as a look-bible regression rather than as this. Every guard here was
 *        mutation-tested: deleted from the source, suite run, confirmed red,
 *        restored.
 *
 *   §5   THE PERSISTENCE RULES, which are what make "it runs ONCE" true.
 * ============================================================================
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  CALIBRATION,
  HardwareCalibration,
  calibrationPrior,
  describeCalibration,
  fitFillRate,
  snapScale,
  solveScale,
  type CalibrationPoint,
  type CalibrationResult,
} from '../src/render/HardwareCalibration';

/* ==========================================================================
 * A MACHINE, AS A STRAIGHT LINE
 * ========================================================================== */

interface Machine {
  /** Frame cost that does not depend on pixel count, in ms. */
  readonly fixedMs: number;
  /** Additional ms per megapixel. */
  readonly perMpxMs: number;
  /** Drawing-buffer megapixels at resolution scale 1. */
  readonly nativeMpx: number;
  /** Present interval the display quantises to, or 0 for a free-running frame. */
  readonly vsyncMs?: number;
}

const ROOT = join(__dirname, '..');

/** §9's own machine: 2560x1440, integrated Radeon, 194 drawn units. */
const REPORTER: Machine = { fixedMs: 5.86, perMpxMs: 6.40, nativeMpx: (2560 * 1440) / 1e6 };

function frameMsAt(m: Machine, scale: number): number {
  const raw = m.fixedMs + m.perMpxMs * m.nativeMpx * scale * scale;
  if (m.vsyncMs === undefined || m.vsyncMs <= 0) return raw;
  // A vsync-capped display presents on a whole refresh interval. A machine with
  // headroom therefore reports the MONITOR's number at every resolution — see
  // `docs/RENDER_FINDINGS.md` §9's note on `stats().cpuMs`.
  return Math.ceil(raw / m.vsyncMs) * m.vsyncMs;
}

/**
 * Drive a controller against a machine until it produces a result.
 *
 * Mirrors `calibration.system.ts` exactly: the first probe's scale is applied
 * BEFORE the first sample, and any scale the controller returns takes effect on
 * the NEXT frame, because the drawing buffer is reallocated after the sample.
 */
function drive(
  c: HardwareCalibration,
  m: Machine,
  limit = 5000,
): { result: CalibrationResult | null; frames: number; scales: number[] } {
  let scale = c.firstProbeScale;
  const scales: number[] = [scale];
  for (let i = 0; i < limit; i++) {
    const mpx = m.nativeMpx * scale * scale;
    const step = c.sample(frameMsAt(m, scale), mpx);
    if (step.result !== null) {
      if (step.scale !== null) scales.push(step.scale);
      return { result: step.result, frames: i + 1, scales };
    }
    if (step.scale !== null) {
      scale = step.scale;
      scales.push(scale);
    }
  }
  return { result: null, frames: limit, scales };
}

function fresh(start = 1.0): HardwareCalibration {
  return new HardwareCalibration(start, 1.0, CALIBRATION.maxScale);
}

/* ==========================================================================
 * 1. THE FIT — recover a line that somebody else measured
 * ========================================================================== */

describe('hardware calibration — the fill-rate fit', () => {
  it("recovers RENDER_FINDINGS §9's line exactly from two probes", () => {
    const points: CalibrationPoint[] = [1.0, 0.7].map((s) => ({
      scale: s,
      mpx: REPORTER.nativeMpx * s * s,
      ms: frameMsAt(REPORTER, s),
    }));
    const line = fitFillRate(points);
    expect(line.fixedMs).toBeCloseTo(5.86, 6);
    expect(line.perMpxMs).toBeCloseTo(6.40, 6);
  });

  it('is a real least-squares fit, so a third noisy probe helps rather than breaks it', () => {
    const points: CalibrationPoint[] = [1.0, 0.85, 0.7].map((s, i) => ({
      scale: s,
      // +-0.2 ms of noise, alternating, so the line through any TWO of them is
      // wrong and the line through all three is not.
      mpx: REPORTER.nativeMpx * s * s,
      ms: frameMsAt(REPORTER, s) + (i === 1 ? 0.4 : -0.2),
    }));
    const line = fitFillRate(points);
    expect(line.perMpxMs).toBeCloseTo(6.40, 1);
  });

  it('reports a flat line rather than dividing by zero on degenerate input', () => {
    expect(fitFillRate([]).perMpxMs).toBe(0);
    expect(fitFillRate([{ scale: 1, mpx: 2, ms: 20 }]).perMpxMs).toBe(0);
    // Two probes at the SAME pixel count carry no information about resolution.
    expect(fitFillRate([
      { scale: 1, mpx: 2, ms: 20 },
      { scale: 1, mpx: 2, ms: 22 },
    ]).perMpxMs).toBe(0);
  });
});

/* ==========================================================================
 * 2. THE SOLVE
 * ========================================================================== */

describe('hardware calibration — the solve', () => {
  it("reproduces §9's published 60 fps point once the safety margin is removed", () => {
    // §9: "60 fps lands at render scale 0.694 on the reporter's integrated
    // adapter". Inverting that against the same line puts its target at
    // 17.22 ms, not 16.7 — so this controller, which targets 16.7, solves the
    // SAME line to 0.678. Both figures are the same solve and the difference is
    // entirely the target; quoting one for the other is exactly the drift
    // `docs/SPEC_DRIFT_AUDIT.md` catalogues, so both are pinned here.
    const line = { fixedMs: 5.86, perMpxMs: 6.40 };
    const withMargin = solveScale(line, 16.7, REPORTER.nativeMpx);
    expect(withMargin).not.toBeNull();
    const raw = (withMargin as number) / Math.sqrt(CALIBRATION.headroom);
    expect(raw).toBeCloseTo(0.678, 3);
    expect(
      (solveScale(line, 17.22, REPORTER.nativeMpx) as number) / Math.sqrt(CALIBRATION.headroom),
    ).toBeCloseTo(0.694, 3);
  });

  it('spends less than the frame can afford, on purpose', () => {
    // The calibration runs on an opening base; §9's line was fitted at 194 units
    // in a four-army late game. Underspending is the difference between a
    // result that holds and one that is exactly right until the first firefight.
    const line = { fixedMs: 5.86, perMpxMs: 6.40 };
    const solved = solveScale(line, 16.7, REPORTER.nativeMpx) as number;
    const spent = line.fixedMs + line.perMpxMs * REPORTER.nativeMpx * solved * solved;
    expect(spent).toBeLessThan(16.7);
    expect(CALIBRATION.headroom).toBeLessThan(1);
  });

  it('REFUSES TO CUT when the frame is not fill-rate bound', () => {
    // The single most important property. A flat slope means pixels are not
    // what costs — a vsync-capped display with headroom, or a genuinely
    // CPU-bound frame — and blurring the image buys nothing in either case.
    expect(solveScale({ fixedMs: 40, perMpxMs: 0 }, 16.7, 3.68)).toBeNull();
    expect(solveScale({ fixedMs: 40, perMpxMs: 0.4 }, 16.7, 3.68)).toBeNull();
    // ...and one hair above the threshold it does solve, so the threshold is
    // the thing being tested and not an accident of the other numbers.
    expect(solveScale({ fixedMs: 4, perMpxMs: CALIBRATION.flatSlopeMs }, 16.7, 3.68)).not.toBeNull();
  });

  it('answers zero when even an empty frame misses the target', () => {
    // The fixed cost alone blows the budget. The pixel term still dominates
    // what is left, so the caller clamps to the floor rather than giving up —
    // it must not read this as "not fill-rate bound".
    expect(solveScale({ fixedMs: 30, perMpxMs: 6.4 }, 16.7, 3.68)).toBe(0);
  });

  it('snaps to the slider step, with no floating-point residue', () => {
    expect(snapScale(0.6249)).toBe(0.6);
    expect(snapScale(0.63)).toBe(0.65);
    expect(snapScale(1.0)).toBe(1);
    // `13 * 0.05` is 0.6500000000000001 in IEEE 754. The settings store clamps
    // but does not round, so an unrounded value would persist and be rendered.
    for (let i = 11; i <= 20; i++) {
      const v = snapScale(i * 0.05);
      expect(String(v).length, `snapScale(${i} * 0.05) leaked float residue`).toBeLessThan(6);
    }
  });
});

/* ==========================================================================
 * 3. THE STAGED CONTROLLER
 * ========================================================================== */

describe('hardware calibration — the probe sequence', () => {
  it('probes twice and finishes in a bounded number of frames', () => {
    const c = fresh();
    const run = drive(c, REPORTER);
    expect(run.result).not.toBeNull();
    expect(c.measured).toHaveLength(2);
    // warmup + 2 x (settle + window). Every frame this machine produces is a
    // valid sample, so the count is exact.
    const expected =
      CALIBRATION.warmupFrames + 2 * (CALIBRATION.settleFrames + CALIBRATION.windowFrames);
    expect(run.frames).toBe(expected);
    // 110 frames: ~1.8 s at 60 fps, ~4.7 s on the 23.6 fps machine §9 measured.
    expect(expected).toBeLessThanOrEqual(120);
  });

  it('measures two genuinely different pixel counts', () => {
    const c = fresh();
    drive(c, REPORTER);
    const [a, b] = c.measured;
    expect(a.scale).toBeCloseTo(1.0, 6);
    expect(b.scale).toBeCloseTo(0.7, 6);
    // Half the pixels. A fit through two near-identical points is noise.
    expect(b.mpx / a.mpx).toBeCloseTo(0.49, 3);
  });

  it("solves the reporter's machine to a scale it can actually hold", () => {
    const c = fresh();
    const r = drive(c, REPORTER).result as CalibrationResult;
    expect(r.reason).toBe('fill-rate');
    expect(r.resolutionScale).toBe(0.6);
    expect(r.ao, 'AO is only shed at the floor').toBe(true);
    expect(r.shadowQuality).toBe('high');
    // The frame it bought, on the line it fitted.
    const ms = r.fixedMs + r.perMpxMs * REPORTER.nativeMpx * r.resolutionScale ** 2;
    expect(ms).toBeLessThan(CALIBRATION.targetMs);
  });

  it('LEAVES A VSYNC-CAPPED MACHINE ALONE — it is not slow, it is capped', () => {
    // 60 Hz display, a GPU with headroom at every scale. Every probe reports
    // 16.67 ms, the fitted slope is zero, and cutting resolution would cost
    // sharpness for a frame rate the display already delivers.
    const capped: Machine = { fixedMs: 2, perMpxMs: 1.5, nativeMpx: 2.07, vsyncMs: 1000 / 60 };
    const r = drive(fresh(), capped).result as CalibrationResult;
    expect(r.reason).toBe('not-fill-rate-bound');
    expect(r.resolutionScale).toBe(1);
    expect(r.ao).toBe(true);
  });

  it('LEAVES A CPU-BOUND MACHINE ALONE, even though it is missing 60 fps', () => {
    // 40 ms a frame at every resolution. Resolution cannot fix this and a
    // calibration that blurred the game to 55% would be strictly worse than
    // doing nothing.
    const cpuBound: Machine = { fixedMs: 40, perMpxMs: 0, nativeMpx: 3.69 };
    const r = drive(fresh(), cpuBound).result as CalibrationResult;
    expect(r.reason).toBe('not-fill-rate-bound');
    expect(r.resolutionScale).toBe(1);
  });

  it('gives a machine with headroom the full native resolution and nothing more', () => {
    // Supersampling is reachable from the slider and is a deliberate choice
    // about aliasing. A first-run wizard must not spend a stranger's GPU on it.
    const fast: Machine = { fixedMs: 2, perMpxMs: 1.5, nativeMpx: 3.69 };
    const r = drive(fresh(), fast).result as CalibrationResult;
    expect(r.reason).toBe('headroom');
    expect(r.resolutionScale).toBe(CALIBRATION.maxScale);
    expect(r.resolutionScale).toBe(1);
  });

  it('sheds AO and shadow detail ONLY when the floor still misses', () => {
    const weak: Machine = { fixedMs: 6, perMpxMs: 25, nativeMpx: 3.69 };
    const r = drive(fresh(), weak).result as CalibrationResult;
    expect(r.reason).toBe('floor');
    expect(r.resolutionScale).toBe(CALIBRATION.minScale);
    expect(r.ao, 'AO is 16.9% of the frame — the next lever after resolution').toBe(false);
    expect(r.shadowQuality).toBe('low');
  });

  it('NEVER goes below the floor — a mushy image is not a fix', () => {
    const hopeless: Machine = { fixedMs: 100, perMpxMs: 60, nativeMpx: 8.29 };
    const r = drive(fresh(), hopeless).result as CalibrationResult;
    expect(r.resolutionScale).toBeGreaterThanOrEqual(CALIBRATION.minScale);
  });

  it('discards impossible intervals rather than measuring them', () => {
    // A backgrounded tab, a breakpoint, or the frame after a shader compile.
    const c = fresh();
    for (let i = 0; i < 500; i++) {
      expect(c.sample(Number.NaN, 3.69).result).toBeNull();
      expect(c.sample(0, 3.69).result).toBeNull();
      expect(c.sample(-5, 3.69).result).toBeNull();
      expect(c.sample(60_000, 3.69).result).toBeNull();
      expect(c.sample(20, 0).result).toBeNull();
    }
    expect(c.stage).toBe('warmup');
    expect(c.measured).toHaveLength(0);
    // And it still completes normally afterwards, so the filter drops samples
    // rather than poisoning the run.
    expect(drive(c, REPORTER).result).not.toBeNull();
  });

  it('RESTARTS A WINDOW whose pixel count moves under it', () => {
    // A fullscreen toggle or a drag to a display with a different DPR mid-probe.
    // A window whose samples describe two resolutions fits a line through
    // nothing, so it must be thrown away rather than averaged.
    const c = fresh();
    let scale = c.firstProbeScale;
    let flips = 0;
    let finished = false;
    for (let i = 0; i < 4000 && !finished; i++) {
      // Alternate the CSS box every frame for the first 600 frames: no window
      // can ever fill, so no probe can ever complete.
      const boxed = i < 600 && (i & 1) === 0 ? 1.4 : 1.0;
      const mpx = REPORTER.nativeMpx * boxed * scale * scale;
      const step = c.sample(frameMsAt(REPORTER, scale), mpx);
      if (i < 600 && (i & 1) === 0) flips++;
      if (step.result !== null) finished = true;
      if (step.scale !== null) scale = step.scale;
    }
    expect(flips).toBeGreaterThan(200);
    expect(finished, 'it must still finish once the window stops moving').toBe(true);
    // Both probes measured ONE pixel count each, not an average of two.
    for (const p of c.measured) {
      expect(p.mpx).toBeCloseTo(REPORTER.nativeMpx * p.scale * p.scale, 6);
    }
  });

  it('is terminal: a finished controller never speaks again', () => {
    const c = fresh();
    expect(drive(c, REPORTER).result).not.toBeNull();
    expect(c.stage).toBe('done');
    for (let i = 0; i < 500; i++) {
      const step = c.sample(90, 3.69);
      expect(step.result).toBeNull();
      expect(step.scale).toBeNull();
    }
  });

  it('abort hands back the scale it was told to restore', () => {
    const c = new HardwareCalibration(0.75, 1.35, 1.5);
    expect(c.abort()).toBe(1.35);
    expect(c.stage).toBe('done');
  });

  it('reuses one step object, so a probing frame allocates nothing', () => {
    // CLAUDE.md: zero allocation in the frame loop. `AdaptiveResolution` returns
    // a fresh decision per frame; this one does not, because it also runs on the
    // very first seconds of a match where a GC pause is most visible.
    const c = fresh();
    const first = c.sample(16, 3.69);
    const second = c.sample(16, 3.69);
    expect(second).toBe(first);
  });
});

/* ==========================================================================
 * 3b. THE PRIOR — where probing starts, and nothing else
 * ========================================================================== */

describe('hardware calibration — the adapter is a prior, not the answer', () => {
  const noAdapter = null;

  it('starts a discrete card at native and an integrated part below it', () => {
    expect(calibrationPrior('discrete', noAdapter, 'webgl').startScale).toBe(1);
    expect(calibrationPrior('integrated', noAdapter, 'webgl').startScale).toBe(0.75);
    expect(calibrationPrior('software', noAdapter, 'webgl').startScale).toBe(0.55);
  });

  it('falls back to the WebGPU adapter when the WebGL string was masked', () => {
    const intel = { vendor: 'intel', architecture: 'gen-12lp', device: '', description: '' };
    expect(calibrationPrior('unknown', intel, 'webgpu').startScale).toBeLessThan(1);
  });

  it('DOES NOT read `amd` as integrated, because that string cannot tell', () => {
    // §7g: the probe saw an integrated `amd`/`gcn-5` adapter on a box holding an
    // RTX 3080, and `amd` also names every discrete Radeon. Guessing here would
    // start a 3080 at 75% for no reason.
    const amd = { vendor: 'amd', architecture: 'gcn-5', device: '', description: '' };
    expect(calibrationPrior('unknown', amd, 'webgl').startScale).toBe(1);
  });

  it('lets the node path start higher, because §7f measured it 1.74-1.89x faster', () => {
    const webgl = calibrationPrior('integrated', noAdapter, 'webgl').startScale;
    const webgpu = calibrationPrior('integrated', noAdapter, 'webgpu').startScale;
    expect(webgpu).toBeGreaterThan(webgl);
    // And never past the ceiling: this moves where probing STARTS, never where
    // it may finish.
    expect(calibrationPrior('discrete', noAdapter, 'webgpu').startScale)
      .toBeLessThanOrEqual(CALIBRATION.maxScale);
  });

  it('CANNOT change the answer — two priors, one machine, one result', () => {
    // The whole claim of the header. If the prior could move the outcome it
    // would be a lookup table wearing a measurement's clothes.
    const low = drive(new HardwareCalibration(0.6, 1, 1), REPORTER).result as CalibrationResult;
    const high = drive(new HardwareCalibration(1.0, 1, 1), REPORTER).result as CalibrationResult;
    expect(low.resolutionScale).toBe(high.resolutionScale);
    expect(low.reason).toBe(high.reason);
  });

  it('keeps the two probes apart even when the prior starts at the floor', () => {
    // Clamping probe A to the floor and then deriving B from it must not put
    // both probes on the same pixel count, which would leave the fit singular.
    const c = new HardwareCalibration(CALIBRATION.minScale, 1, 1);
    drive(c, REPORTER);
    const [a, b] = c.measured;
    expect(a.mpx).not.toBeCloseTo(b.mpx, 3);
  });
});

describe('hardware calibration — the explanation', () => {
  it('names the reason, not just the number', () => {
    const cpuBound: Machine = { fixedMs: 40, perMpxMs: 0, nativeMpx: 3.69 };
    const r = drive(fresh(), cpuBound).result as CalibrationResult;
    expect(describeCalibration(r)).toMatch(/not limited by pixel count/);
    const weak: Machine = { fixedMs: 6, perMpxMs: 25, nativeMpx: 3.69 };
    expect(describeCalibration(drive(fresh(), weak).result as CalibrationResult))
      .toMatch(/ambient occlusion off/);
  });
});

/* ==========================================================================
 * 4. THE `?shot=` GUARDS
 *
 * These are the assertions the whole visual pipeline depends on. Every one was
 * mutation-tested: the guard was deleted from `calibration.system.ts`, this file
 * was run, and it went red.
 * ========================================================================== */

interface FakeHandle {
  capabilities: { gpu: string; adapter: null };
  backend: 'webgl';
  isFixedSize: boolean;
  resolutionScale: number;
  size: { width: number; height: number; cssWidth: number; cssHeight: number; pixelRatio: number };
  setResolutionScale(v: number): void;
  /** `adaptive-res.system.ts` subscribes in its `init`; the stand-down test needs it. */
  onResize(fn: unknown): () => void;
}

interface Rig {
  handle: FakeHandle;
  loop: { captureClock: boolean };
  /** Every scale the system asked for, in order. */
  applied: number[];
  frame(n: number, dt?: number): void;
  teardown(): void;
}

async function systemRig(machine: Machine = REPORTER, captureClock = false): Promise<Rig> {
  const { setGameContext } = await import('../src/game/context');
  const system = (await import('../src/render/calibration.system')).default;

  const applied: number[] = [];
  const native = { w: 2560, h: 1440 };
  const handle: FakeHandle = {
    capabilities: { gpu: 'AMD Radeon(TM) Graphics', adapter: null },
    backend: 'webgl',
    isFixedSize: false,
    resolutionScale: 1,
    size: { width: native.w, height: native.h, cssWidth: native.w, cssHeight: native.h, pixelRatio: 1 },
    setResolutionScale(v: number): void {
      handle.resolutionScale = v;
      handle.size.width = Math.round(native.w * v);
      handle.size.height = Math.round(native.h * v);
      applied.push(v);
    },
    onResize(): () => void { return () => { /* no subscriber bookkeeping needed */ }; },
  };
  const loop = { captureClock };
  setGameContext({ handle, loop } as never);
  system.init?.();

  const rc = { dt: 1 / 60, time: 0, alpha: 0, frame: 0, quality: 0 };
  return {
    handle,
    loop,
    applied,
    frame(n: number, dt = 0.016): void {
      for (let i = 0; i < n; i++) {
        rc.frame++;
        // `dt` IS the frame time this machine would have produced at the live
        // scale — that is the whole quantity the controller steers on. Passing
        // 0 is the frozen capture clock.
        rc.dt = dt === 0 ? 0 : frameMsAt(machine, handle.resolutionScale) / 1000;
        system.frame?.(rc as never);
      }
    },
    teardown(): void {
      system.dispose?.();
      setGameContext(null);
    },
  };
}

describe('hardware calibration — IT CANNOT RUN UNDER ?shot=', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('IS ARMED FROM THE SHELL AND NOWHERE ELSE, which is the structural guard', () => {
    /*
     * `?shot=` takes `main.ts#bootHarness`, which calls `bootstrap()` directly.
     * The shell is a LAZY import reached only by `bootProduct` — "so the
     * harness path never pays for the shell bundle", in that file's own words —
     * so a calibration that can only be armed from inside `src/shell/` cannot
     * be armed by a capture. That is a stronger statement than any runtime
     * check, and it is only true while this list has one entry in it.
     */
    const files = globSync('src/**/*.ts', { cwd: ROOT });
    const callers = files.filter((f) => {
      if (f.replace(/\\/g, '/') === 'src/render/calibration.system.ts') return false;
      return /\barmCalibration\b/.test(readFileSync(join(ROOT, f), 'utf8'));
    }).map((f) => f.replace(/\\/g, '/'));
    expect(callers).toEqual(['src/shell/Shell.ts']);
  });

  it('does nothing at all until something arms it', async () => {
    // GUARD 1, and the structural one: `armCalibration` has exactly one caller,
    // `src/shell/Shell.ts`, and `?shot=` never loads the shell — `main.ts`
    // routes the harness straight into `bootstrap()`.
    const rig = await systemRig();
    try {
      rig.frame(2000);
      expect(rig.applied, 'an unarmed system must never touch the scale').toEqual([]);
      expect(rig.handle.resolutionScale).toBe(1);
    } finally { rig.teardown(); }
  });

  it('REFUSES TO ARM when loop.captureClock is set', async () => {
    // GUARD 2. `Bootstrap` sets `captureClock` from `shotMode`; it is the single
    // flag that means "these frames belong to the harness".
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const rig = await systemRig(REPORTER, true);
    try {
      const { armCalibration } = await import('../src/render/calibration.system');
      expect(armCalibration(() => {})).toBe(false);
      rig.frame(2000);
      expect(rig.applied).toEqual([]);
    } finally { rig.teardown(); }
  });

  it('STOPS MID-PROBE if the capture clock comes on', async () => {
    // The same guard, read live in `frame()` rather than latched at `init()`.
    // A latched copy makes this branch unreachable, and an unreachable guard is
    // an assertion nobody can test.
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const rig = await systemRig();
    try {
      const { armCalibration } = await import('../src/render/calibration.system');
      let finished = false;
      expect(armCalibration(() => { finished = true; })).toBe(true);
      rig.frame(20);
      const soFar = rig.applied.length;
      rig.loop.captureClock = true;
      rig.frame(4000);
      expect(rig.applied.length, 'no scale may move under the capture clock').toBe(soFar);
      expect(finished).toBe(false);
    } finally { rig.teardown(); }
  });

  it('STANDS DOWN during a fixed-size offscreen render', async () => {
    // GUARD 3. `setFixedSize` is the screenshot path: one drawing-buffer pixel
    // per requested pixel. A scaled capture silently corrupts the scorecard.
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const rig = await systemRig();
    try {
      const { armCalibration } = await import('../src/render/calibration.system');
      expect(armCalibration(() => {})).toBe(true);
      rig.frame(20);
      const soFar = rig.applied.length;
      rig.handle.isFixedSize = true;
      rig.frame(4000);
      expect(rig.applied.length).toBe(soFar);
    } finally { rig.teardown(); }
  });

  it('refuses to arm at all while a fixed-size render is in force', async () => {
    const rig = await systemRig();
    try {
      const { armCalibration } = await import('../src/render/calibration.system');
      rig.handle.isFixedSize = true;
      expect(armCalibration(() => {})).toBe(false);
      expect(rig.applied).toEqual([]);
    } finally { rig.teardown(); }
  });

  it('MEASURES NOTHING ON A FROZEN CLOCK — and this is not a guard test', async () => {
    /*
     * `captureClock` also forces `realDt = 0`, so a frozen clock is a second
     * symptom of the same condition guard 2 covers. THIS TEST DOES NOT PROVE
     * THE `rc.dt > 0` LINE IN `frame()`, and saying it did was the first version
     * of this file: deleting that line leaves the suite green, because a zero
     * interval is refused one call later by `HardwareCalibration.sample`'s own
     * `frameMs > 0` filter. What is asserted here is the BEHAVIOUR, and the
     * filter that actually delivers it IS mutation-killed by this test.
     *
     * A zero dt was never sufficient on its own regardless:
     * `GameLoop.advanceTicks` renders at a synthetic SIM_DT of 33.3 ms.
     */
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const rig = await systemRig();
    try {
      const { armCalibration } = await import('../src/render/calibration.system');
      let finished = false;
      expect(armCalibration(() => { finished = true; })).toBe(true);
      const soFar = rig.applied.length;
      rig.frame(4000, 0);
      expect(rig.applied.length).toBe(soFar);
      expect(finished).toBe(false);
    } finally { rig.teardown(); }
  });
});

describe('hardware calibration — the wiring', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('probes, solves and calls back exactly once', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const rig = await systemRig();
    try {
      const { armCalibration, calibrationRunning } = await import('../src/render/calibration.system');
      const results: CalibrationResult[] = [];
      expect(armCalibration((r) => results.push(r))).toBe(true);
      expect(calibrationRunning()).toBe(true);
      rig.frame(4000);
      expect(results).toHaveLength(1);
      expect(results[0].resolutionScale).toBe(0.6);
      // probe A applied on arming (0.75 — the prior read the fake handle's
      // integrated Radeon string), probe B at 70% of it, then the solved answer.
      expect(rig.applied).toEqual([0.75, 0.525, 0.6]);
      expect(rig.handle.resolutionScale).toBe(0.6);
      // DISARMED BEFORE THE CALLBACK: the callback persists the result, which
      // notifies the shell, which cancels any RUNNING calibration. A run that
      // was still armed here would cancel itself and undo its own answer.
      expect(calibrationRunning()).toBe(false);
      rig.frame(4000);
      expect(results).toHaveLength(1);
    } finally { rig.teardown(); }
  });

  it('will not arm twice — a line fitted across two scenes is not a line', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const rig = await systemRig();
    try {
      const { armCalibration } = await import('../src/render/calibration.system');
      expect(armCalibration(() => {})).toBe(true);
      expect(armCalibration(() => {})).toBe(false);
    } finally { rig.teardown(); }
  });

  it('DISARMING PUTS THE SCALE BACK, which is the half that matters', async () => {
    // A player who opens Settings mid-probe and moves any graphics row cancels
    // this. Without the restore they are parked at probe B's 70% forever:
    // `applySettings` re-pushes `resolutionScale` only when it CHANGED, and
    // their stored value never did.
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const rig = await systemRig();
    try {
      const mod = await import('../src/render/calibration.system');
      rig.handle.setResolutionScale(0.9);
      expect(mod.armCalibration(() => {})).toBe(true);
      rig.frame(60);
      expect(rig.handle.resolutionScale).not.toBe(0.9);
      mod.disarmCalibration();
      expect(rig.handle.resolutionScale).toBe(0.9);
      expect(mod.calibrationRunning()).toBe(false);
    } finally { rig.teardown(); }
  });

  it('DISARMING LEAVES A NEWER VALUE ALONE, whichever order the shell runs in', async () => {
    /*
     * The change that cancels a calibration is very often a move of the
     * Resolution Scale slider itself, and `applySettings` and
     * `disarmCalibration` run in the same turn of the shell's settings
     * listener. An unconditional restore would put the probe's entry value back
     * over the number the player had just chosen — slider reading one thing,
     * renderer doing another, which is the exact defect that row's own comment
     * in `Settings.ts` was written about.
     */
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const rig = await systemRig();
    try {
      const mod = await import('../src/render/calibration.system');
      expect(mod.armCalibration(() => {})).toBe(true);
      rig.frame(60);
      // `applySettings` pushing the player's brand-new choice.
      rig.handle.setResolutionScale(1.25);
      mod.disarmCalibration();
      expect(rig.handle.resolutionScale, 'the player\'s choice must survive').toBe(1.25);
    } finally { rig.teardown(); }
  });

  it('ADAPTIVE ADOPTS A SCALE SET AFTER ITS init AS THE NEW CEILING', async () => {
    /*
     * `lastCommanded` used to start at -1, which switched off the
     * outside-change check until the adaptive controller had itself commanded
     * one. THE BOOT ORDER GUARANTEES AN OUTSIDE CHANGE COMES FIRST: `init()`
     * runs inside `bootstrap()` and `Shell.bootGame` calls `applySettings`
     * after `bootstrap()` returns. So the ceiling was captured from whatever
     * the quality tier picked, the player's stored Resolution Scale (or a
     * calibration result) landed a moment later, and this controller went on
     * steering from a scale that was no longer real.
     *
     * The damage is not a graceful climb — it is a CUT that lands above the
     * player's setting. Believing itself at 1.0 while the renderer is at 0.6,
     * one over-budget window commits 1.0 - 0.075 and RAISES the resolution on a
     * machine that was already too slow. That is what this drives.
     */
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const rig = await systemRig();
    try {
      const adaptive = (await import('../src/render/adaptive-res.system')).default;
      const { setAdaptiveResolution } = await import('../src/render/adaptive-res.system');
      adaptive.init?.();                     // boot ceiling: the tier's 1.0
      setAdaptiveResolution(true);
      rig.handle.setResolutionScale(0.6);    // applySettings / the calibration
      rig.applied.length = 0;

      // Sustained 80 ms frames: it must cut, and every cut must land at or
      // below the 0.6 that is actually in force.
      const rc = { dt: 0.08, time: 0, alpha: 0, frame: 0, quality: 0 };
      for (let i = 0; i < 4000; i++) adaptive.frame?.(rc as never);
      expect(rig.applied.length, 'it should still be doing its job').toBeGreaterThan(0);
      for (const s of rig.applied) {
        expect(s, 'a cut may never land above the scale actually in force').toBeLessThanOrEqual(0.6);
      }
      adaptive.dispose?.();
    } finally { rig.teardown(); }
  });

  it('the adaptive controller stands down while this one is measuring', async () => {
    // Two controllers on one handle fit a line through a moving target. The
    // adaptive system reads every outside scale change as a deliberate choice,
    // so without this it would re-arm its ceiling on every probe.
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const rig = await systemRig();
    try {
      const mod = await import('../src/render/calibration.system');
      const adaptive = (await import('../src/render/adaptive-res.system')).default;
      const { setAdaptiveResolution } = await import('../src/render/adaptive-res.system');
      adaptive.init?.();
      setAdaptiveResolution(true);
      expect(mod.armCalibration(() => {})).toBe(true);

      const before = rig.applied.length;
      const rc = { dt: 0.08, time: 0, alpha: 0, frame: 0, quality: 0 };
      for (let i = 0; i < 2000; i++) adaptive.frame?.(rc as never);
      expect(
        rig.applied.length,
        'adaptive resolution must not touch the handle mid-calibration',
      ).toBe(before);
      adaptive.dispose?.();
    } finally { rig.teardown(); }
  });
});

/* ==========================================================================
 * 5. IT RUNS ONCE, AND THE PLAYER OWNS THE RESULT
 *
 * Three promises, all of them carried by `graphics.calibrated` and all of them
 * about NOT changing something somebody chose.
 * ========================================================================== */

describe('hardware calibration — persistence', () => {
  it('adaptive resolution is OFF by default', async () => {
    const { defaultSettings } = await import('../src/shell/settings-store');
    expect(defaultSettings().graphics.adaptiveResolution).toBe(false);
  });

  it('a fresh profile is uncalibrated; a profile with any stored settings is not', async () => {
    const { defaultSettings, normalizeSettings } = await import('../src/shell/settings-store');
    // No blob at all — a genuinely new player.
    expect(defaultSettings().graphics.calibrated).toBe(false);
    expect(normalizeSettings(null).graphics.calibrated).toBe(false);
    expect(normalizeSettings('not json').graphics.calibrated).toBe(false);

    // A blob written before calibration existed. RAISING A SETTING SOMEBODY
    // LOWERED IS THE ONE FAILURE THIS FEATURE HAS TO AVOID, so a returning
    // player is treated as already decided.
    const old = { version: 2, graphics: { resolutionScale: 0.7, ao: false } };
    const loaded = normalizeSettings(old);
    expect(loaded.graphics.calibrated).toBe(true);
    expect(loaded.graphics.resolutionScale).toBe(0.7);
    expect(loaded.graphics.ao).toBe(false);
  });

  it('v3 takes adaptive resolution off an older profile that never chose it', async () => {
    const { normalizeSettings, SETTINGS_VERSION } = await import('../src/shell/settings-store');
    expect(SETTINGS_VERSION).toBe(3);
    // `true` on a pre-v3 blob is the OLD DEFAULT and nothing distinguishes it
    // from a deliberate choice — the same honest limit `migrateBindings` has.
    expect(normalizeSettings({ version: 2, graphics: { adaptiveResolution: true } })
      .graphics.adaptiveResolution).toBe(false);
    // An explicit `false` is already the new value and is left alone.
    expect(normalizeSettings({ version: 2, graphics: { adaptiveResolution: false } })
      .graphics.adaptiveResolution).toBe(false);
    // And a v3 blob is never migrated again, so switching it back sticks.
    expect(normalizeSettings({ version: 3, graphics: { adaptiveResolution: true } })
      .graphics.adaptiveResolution).toBe(true);
  });

  it('MOVING ANY GRAPHICS ROW RETIRES A PENDING CALIBRATION', async () => {
    // The rule lives in the STORE, not in the options screen, so it holds for
    // every control at once and for the next row somebody adds. A player who
    // sets a resolution before their first battle must not have it measured
    // over the top of.
    const { SettingsStore, memoryStorage } = await import('../src/shell/settings-store');
    for (const row of [
      { resolutionScale: 0.75 },
      { ao: false },
      { shadows: false },
      { tier: 'low' as const },
      { adaptiveResolution: true },
      /*
       * MOVED HERE FROM THE EXEMPT LIST BELOW, and the move is the point.
       *
       * `fpsCap` was exempt under an argument that was TRUE when it was
       * written — it had no readers anywhere in `src/`, so it could not affect
       * a pixel. `Shell.maybeCalibrate` passes `targetMsForCap(fpsCap)` as the
       * calibration's frame-time target now, which expired that argument
       * silently and left this spec PINNING THE OBSOLETE BEHAVIOUR: the player
       * picks 120 fps, nothing re-measures, the calibration solved for 60
       * stands, and the row appears to do nothing.
       *
       * An exemption argued from "nothing reads it" carries an expiry date that
       * no mechanism can notice passing. See `tests/frame-rate-target.spec.ts`.
       */
      { fpsCap: 120 },
    ]) {
      const store = new SettingsStore(memoryStorage());
      expect(store.get().graphics.calibrated).toBe(false);
      store.patch({ graphics: row });
      expect(
        store.get().graphics.calibrated,
        `changing ${Object.keys(row)[0]} must retire the calibration`,
      ).toBe(true);
    }
  });

  it('but a change to something that is not graphics does not', async () => {
    const { SettingsStore, memoryStorage } = await import('../src/shell/settings-store');
    const store = new SettingsStore(memoryStorage());
    store.patch({ audio: { master: 40 } });
    store.patch({ gameplay: { edgeScroll: true } });
    expect(store.get().graphics.calibrated).toBe(false);
  });

  it('nor does a camera or diagnostic row, which decide nothing about cost', async () => {
    // OPENING THE FRAME-TIME READOUT IS HOW YOU INVESTIGATE PERFORMANCE, not a
    // decision about it — and a field of view is what is on screen, not what a
    // pixel costs. Everything NOT on this exempt list retires the calibration,
    // so a row added later inherits the conservative behaviour by default.
    const { SettingsStore, memoryStorage } = await import('../src/shell/settings-store');
    for (const row of [
      { perfOverlay: true },
      { fov: 44 },
      { panelBlur: 'off' as const },
      { minZoom: 20 },
    ]) {
      const store = new SettingsStore(memoryStorage());
      store.patch({ graphics: row });
      expect(
        store.get().graphics.calibrated,
        `${Object.keys(row)[0]} is not a decision about the picture`,
      ).toBe(false);
    }
  });

  it('"Calibrate Now" is not instantly retired by its own write', async () => {
    const { SettingsStore, memoryStorage } = await import('../src/shell/settings-store');
    const store = new SettingsStore(memoryStorage());
    store.patch({ graphics: { resolutionScale: 0.8 } });
    expect(store.get().graphics.calibrated).toBe(true);
    store.patch({ graphics: { calibrated: false } });
    expect(store.get().graphics.calibrated).toBe(false);
  });

  it('a manual choice survives every later load', async () => {
    const { SettingsStore, memoryStorage } = await import('../src/shell/settings-store');
    const storage = memoryStorage();
    const a = new SettingsStore(storage);
    expect(a.get().graphics.calibrated).toBe(false);
    a.patch({ graphics: { resolutionScale: 0.75 } });

    const b = new SettingsStore(storage);
    expect(b.get().graphics.calibrated).toBe(true);
    expect(b.get().graphics.resolutionScale).toBe(0.75);
  });

  it('Reset Graphics is the route back — and the only one besides Calibrate Now', async () => {
    const { SettingsStore, memoryStorage } = await import('../src/shell/settings-store');
    const store = new SettingsStore(memoryStorage());
    store.patch({ graphics: { calibrated: true } });
    expect(store.get().graphics.calibrated).toBe(true);

    store.reset('graphics');
    expect(store.get().graphics.calibrated).toBe(false);
    // Resetting an unrelated section must NOT re-arm it.
    store.patch({ graphics: { calibrated: true } });
    store.reset('audio');
    expect(store.get().graphics.calibrated).toBe(true);
  });

  it('the calibration writes rows the player can then edit, not a private copy', async () => {
    const { SettingsStore, memoryStorage } = await import('../src/shell/settings-store');
    const store = new SettingsStore(memoryStorage());
    // Exactly what `Shell#commitCalibration` writes.
    const changed = store.patch({
      graphics: { calibrated: true, resolutionScale: 0.6, ao: true, shadowQuality: 'high' },
    });
    expect(changed).toContain('graphics.resolutionScale');
    // The player moves it afterwards; nothing puts it back.
    store.patch({ graphics: { resolutionScale: 1.0 } });
    expect(store.get().graphics.resolutionScale).toBe(1);
    expect(store.get().graphics.calibrated).toBe(true);
  });
});
