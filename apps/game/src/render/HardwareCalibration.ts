/**
 * ============================================================================
 * VOLTMARCH — src/render/HardwareCalibration.ts
 * ============================================================================
 * ONE-TIME, MEASURED GRAPHICS SETUP. The controller only; the wiring is in
 * `calibration.system.ts` and the persistence is `shell/settings-store.ts`.
 *
 * WHY THIS EXISTS
 * ---------------
 * Reported: *"i want the adaptive resolution to be off by default. instead, set
 * the graphic options that match the best for user for the first time and thats
 * it"*.
 *
 * `AdaptiveResolution` steers forever. It is a good controller and it stays
 * available, but it is a permanent negotiation with the frame: a player who
 * never touches Settings has their sharpness moved around behind them for the
 * whole session, and the Settings screen had to grow a paragraph explaining why
 * the slider said 100% while the renderer was at 55%. What the player asked for
 * instead is a decision, taken once, with their name on it.
 *
 * WHY IT CAN BE SOLVED RATHER THAN GUESSED
 * ----------------------------------------
 * `docs/RENDER_FINDINGS.md` §9 measured this project's frame on real GPU timer
 * queries, 194 units at 2560x1440:
 *
 *     GPU ms = 5.86 + 6.40 x Mpx      r² 0.995   (a second run gave r² 1.000)
 *     79-90% of GPU time is pixel-proportional
 *     GPU exceeds CPU by 8.4x; the CPU is idle 88% of the frame
 *
 * **The frame is fill-rate bound and very nearly a straight line in pixel
 * count.** So a calibration does not have to guess from a GPU name: render a
 * couple of windows at two known pixel counts, fit the line, and solve for the
 * pixel count that meets the frame-time target. Two points and some patience
 * beat any lookup table of adapter strings, and they keep being right on
 * hardware that did not exist when the table was written.
 *
 * THE ADAPTER IS A PRIOR, NOT THE ANSWER
 * --------------------------------------
 * `capabilities.adapter` (§7g) and the WebGL renderer string say something
 * useful — an integrated part should not have its first probe run at native
 * 4K — but they decide only WHERE THE PROBING STARTS. Nothing here skips the
 * measurement on the strength of a name.
 *
 * WHAT IT SETS, AND WHAT IS ACTUALLY A KNOB
 * -----------------------------------------
 * This is the part worth being blunt about, because this codebase has a
 * documented history of fully-specified config with no readers (`SURFACES`,
 * `shadowCascades`, `lodDistances`, `VFX_NOON.muzzleMs`).
 *
 *   - **`resolutionScale` is the lever.** It is 79-90% of the GPU frame and it
 *     is what this solves for. Everything else is rounding by comparison.
 *   - **AO is the second lever** — 16.9% of the frame, 4.97 ms recovered by
 *     disabling it (§9). Shed only when the fit says the floor scale still
 *     misses the target.
 *   - **Shadow map size is ~2%.** Dropped alongside AO in that same last-ditch
 *     case because it is free to do and never otherwise.
 *   - **MSAA is never turned on.** `PostConfig.msaaSamples` records the measured
 *     regression (7-8 fps of ~22 on integrated graphics) and the cost is memory
 *     bandwidth, which no capability guess models.
 *   - **THE QUALITY TIER IS DELIBERATELY NOT TOUCHED.** It is the one setting
 *     that moves `maxPixelRatio` (1.0 / 1.5 / 2.0), which changes the pixel
 *     count this calibration just solved for — a feedback loop the measurement
 *     cannot see, because it measured under exactly one pixel-ratio cap.
 *     Everything else the tier carries is either re-asserted on top of it by
 *     `shell/Settings.ts#applySettings` (`ao`, `bloom`, `smaa`, `shadowQuality`,
 *     `resolutionScale`) or is art detail the frame-time fit says nothing about
 *     (`textureSize`). `tier: 'auto'` already runs `detectQualityTier()` off the
 *     GPU string; that stays the prior it always was.
 *
 * THE ONE THING IT REFUSES TO DO
 * ------------------------------
 * **If the frame is not fill-rate bound, it does not cut resolution.** A flat
 * fitted slope means the pixels are not what costs — a vsync-capped display
 * with headroom to spare, or a genuinely CPU-bound frame — and blurring the
 * image buys nothing at all in either case. A calibration that traded sharpness
 * for a frame rate resolution cannot deliver would be worse than no calibration.
 *
 * Deliberately free of any runtime renderer import: it takes numbers and returns
 * numbers, so a test drives it with a synthetic clock and no GL context. The two
 * `import type`s below are erased at build time.
 * ============================================================================
 */

import type { AdapterIdentity, LiveBackend } from './backend';
import type { GpuClass } from './renderer';

/* ==========================================================================
 * 1. TUNABLES
 * ========================================================================== */

export const CALIBRATION = {
  /**
   * DEFAULT frame-time target in ms. 16.7 = 60 fps, the same target `ADAPTIVE`
   * uses. The live target is `targetMsForCap(settings.graphics.fpsCap)` and is
   * passed in per run — see that function for why the default is 60 on a 144 Hz
   * panel and why raising it is a decision only the player may make.
   */
  targetMs: 16.7,
  /**
   * Fraction of the solved pixel budget actually spent.
   *
   * NOT superstition. The calibration runs in the opening minute of a match, on
   * a base and an escort; §9's line was fitted at 194 drawn units in a
   * four-army late game. The scene this measures is the cheapest one the player
   * will see, so the budget is deliberately underspent and the result errs
   * sharp-but-safe rather than exactly-on-target-until-the-first-firefight.
   */
  headroom: 0.85,
  /** Never calibrate below this. Past it the image mushes. Matches `ADAPTIVE`. */
  minScale: 0.55,
  /**
   * Never calibrate above native.
   *
   * Supersampling is reachable — the slider goes to 200% and `setCeiling` was
   * fixed so it sticks — but it is a deliberate choice about aliasing, not
   * something a first-run wizard should spend a stranger's GPU on.
   */
  maxScale: 1.0,
  /** Result granularity. The Settings slider's own step, so the number is legible. */
  step: 0.05,
  /**
   * Frames discarded before the first probe window.
   *
   * The opening frames of a match are shader compilation, texture upload and
   * the first shadow-map fit. They describe the boot, not the machine.
   */
  warmupFrames: 30,
  /**
   * Frames discarded after each scale change, before that probe's window opens.
   *
   * A scale change reallocates every composer target; the frames either side of
   * one are about the reallocation.
   */
  settleFrames: 10,
  /** Frames per probe window. The median of these is the probe's frame time. */
  windowFrames: 30,
  /**
   * Second probe's scale, as a fraction of the first.
   *
   * 0.7 is 49% of the pixels — far enough apart that the fitted slope is not
   * two noisy samples of one point, close enough that both probes render a
   * frame the player would recognise.
   */
  probeRatio: 0.7,
  /**
   * Slope below which the frame is NOT fill-rate bound, in ms per megapixel.
   *
   * §9 measured 6.40 on an integrated Radeon. A machine reporting under 1.0 is
   * either vsync-flat with headroom or bound on something resolution cannot
   * touch; in both cases cutting pixels is pure loss. See the header.
   */
  flatSlopeMs: 1.0,
} as const;

/**
 * The frame-time target a chosen frame-rate cap implies, in ms.
 *
 * `0` means "no cap", which is the shipped default and resolves to 60 fps.
 *
 * ============================================================================
 * WHY THE DEFAULT IS 60 ON A 144 Hz PANEL, AND WHY THAT IS NOT THE BUG IT
 * LOOKS LIKE
 * ============================================================================
 * The obvious reading — "a 144 Hz desktop player is calibrated against a 60 Hz
 * target, and `screen.getPrimaryDisplay().displayFrequency` is already on the
 * bridge, so wire it up" — is BACKWARDS, and this was measured rather than
 * argued. Feeding §9's own fitted line (`GPU ms = 5.86 + 6.40 x Mpx`, r2 0.995)
 * through `solveScale` at a 1440p buffer:
 *
 * ```
 *   target      solved scale   outcome
 *   16.7  60Hz  0.625          fill-rate — a sharp, honest answer
 *   11.1  90Hz  0.435          FLOOR: 0.55 + AO OFF + shadows LOW
 *    8.3 120Hz  0.298          FLOOR: 0.55 + AO OFF + shadows LOW
 *    6.9 144Hz  0.197          FLOOR: 0.55 + AO OFF + shadows LOW
 * ```
 *
 * The cause is the INTERCEPT, not the slope. That machine spends 5.86 ms before
 * a single pixel is drawn — **84% of a 144 Hz frame budget and 70% of a 120 Hz
 * one** — so no resolution scale on earth delivers those frame rates, and the
 * calibration would spend every quality setting it owns discovering that. The
 * player would be handed a mushed 55% frame with ambient occlusion switched off
 * in exchange for nothing at all.
 *
 * And at the other end it does not even do anything. On a fast machine
 * (`1.50 + 1.20 x Mpx`) a 144 Hz target solves to 1.022, which clamps to the
 * ceiling — the identical answer 60 Hz gives. **So a higher target is inert on
 * hardware that could use it and destructive on hardware that cannot.** It buys
 * something only in a narrow middle band, and what it buys there is sharpness
 * traded for frames, which is exactly the trade the header's ONE THING IT
 * REFUSES TO DO is about. That is a decision for the player, never for a
 * first-run wizard measuring a stranger's GPU.
 *
 * Hence: opt-in. `displayFrequency` decides which caps are OFFERED (a 60 Hz
 * panel must not be sold 144), and the player decides whether to chase one.
 */
export function targetMsForCap(fpsCap: number): number {
  if (!Number.isFinite(fpsCap) || fpsCap <= 0) return CALIBRATION.targetMs;
  return 1000 / fpsCap;
}

/* ==========================================================================
 * 2. SHAPES
 * ========================================================================== */

/** One probe: a megapixel count and the median frame time it produced. */
export interface CalibrationPoint {
  /** Drawing-buffer megapixels. */
  readonly mpx: number;
  /** Median frame time across the window, in ms. */
  readonly ms: number;
  /** The resolution scale that produced `mpx`. */
  readonly scale: number;
}

/**
 * Why the calibration landed where it did. Carried into the log and the
 * Settings row, because "it picked 65%" is not an answer anyone can act on.
 */
export type CalibrationReason =
  /** Fitted, solved, and the answer is between the floor and the ceiling. */
  | 'fill-rate'
  /** Solved at or above native: nothing to give back. */
  | 'headroom'
  /** Solved below the floor: clamped, and AO and shadow detail shed with it. */
  | 'floor'
  /** The fitted slope is flat. Pixels are not the cost; nothing is cut. */
  | 'not-fill-rate-bound';

/**
 * Shadow map bucket.
 *
 * Structurally identical to `ShadowChoice` in `shell/settings-store.ts` and
 * deliberately re-declared: this module has no shell imports. The link is not a
 * comment — `Shell#commitCalibration` assigns this straight into a
 * `Partial<GraphicsSettings>`, so the two drifting apart is a build error.
 */
export type CalibrationShadowQuality = 'low' | 'medium' | 'high' | 'ultra';

/** What the calibration decided. Every field maps to one row in Settings. */
export interface CalibrationResult {
  /** Solved render scale, clamped to [minScale, maxScale] and stepped. */
  readonly resolutionScale: number;
  /** Screen-space AO. False only under `'floor'`. */
  readonly ao: boolean;
  /** Shadow map bucket. Dropped only under `'floor'`. */
  readonly shadowQuality: CalibrationShadowQuality;
  readonly reason: CalibrationReason;
  /** The fitted line: `ms = fixedMs + perMpxMs * Mpx`. Kept for bug reports. */
  readonly fixedMs: number;
  readonly perMpxMs: number;
  /** The probes it fitted, newest last. */
  readonly points: readonly CalibrationPoint[];
}

/** Where the controller is. `'done'` is terminal. */
export type CalibrationStage = 'warmup' | 'probe-a' | 'probe-b' | 'done';

/**
 * What one fed frame produced.
 *
 * **THE OBJECT IS REUSED.** `HardwareCalibration` owns exactly one and mutates
 * it in place, because `frame()` in a render system must allocate nothing (see
 * CLAUDE.md, and `tests/perf-hud.spec.ts`, which asserts `toBe(0)` exactly).
 * Read it before the next `sample()`; never store it.
 */
export interface CalibrationStep {
  /** Scale the caller must apply NOW, or null to leave the handle alone. */
  scale: number | null;
  /** Non-null on exactly one frame: the one the calibration finishes on. */
  result: CalibrationResult | null;
  /** 0..1, for a status line. */
  progress: number;
}

/* ==========================================================================
 * 3. THE PRIOR — where the probing starts
 * ========================================================================== */

/** The opening probe scale, and one line saying what chose it. */
export interface CalibrationPrior {
  readonly startScale: number;
  readonly note: string;
}

/**
 * Vendors whose WebGPU adapters are integrated by construction.
 *
 * `amd` is absent ON PURPOSE and it is the interesting one: §7g's own probe saw
 * an integrated `amd`/`gcn-5` adapter on a box holding an RTX 3080, and `amd`
 * also names every discrete Radeon. The vendor string cannot separate them, so
 * it is not asked to.
 */
const INTEGRATED_VENDORS: readonly string[] = ['intel', 'qualcomm', 'arm', 'imgtec', 'broadcom'];

/**
 * Where to start probing, from what can be known before drawing anything.
 *
 * THE ONLY THING THIS DECIDES IS THE FIRST PROBE'S SCALE. Getting it wrong
 * costs a slightly worse-conditioned fit and nothing else — both probes are
 * measured, the line is fitted from both, and the answer comes out of the line.
 * That is the difference between a prior and a lookup table.
 *
 * @param gpu     WebGL's classification of the unmasked renderer string.
 * @param adapter The WebGPU adapter identity, or null on the WebGL path.
 * @param backend Which renderer is actually live.
 */
export function calibrationPrior(
  gpu: GpuClass,
  adapter: AdapterIdentity | null,
  backend: LiveBackend,
): CalibrationPrior {
  let scale = 1.0;
  let note = 'native';

  if (gpu === 'software') {
    // SwiftShader/llvmpipe. Probing this at native is minutes, not seconds.
    scale = 0.55;
    note = 'software rasteriser';
  } else if (gpu === 'integrated') {
    scale = 0.75;
    note = 'integrated GPU';
  } else if (gpu === 'unknown' && adapter !== null) {
    // The WebGL string was masked, which browsers increasingly do. The WebGPU
    // adapter is the only other witness, and on the vendors above it is decisive.
    const vendor = adapter.vendor.toLowerCase();
    if (INTEGRATED_VENDORS.includes(vendor)) {
      scale = 0.75;
      note = `integrated adapter (${vendor})`;
    }
  }

  /*
   * THE BACKEND IS PART OF THE PRIOR. §7f measured the REAL GAME at 1.74-1.89x
   * faster on WebGPU than on WebGL, on the same hardware — so the same machine
   * can afford a higher opening probe on the node path. Capped at `maxScale`:
   * this raises where the probing starts, never where it may finish.
   */
  if (backend === 'webgpu' && scale < CALIBRATION.maxScale) {
    scale = Math.min(CALIBRATION.maxScale, scale * 1.2);
    note += ' on WebGPU';
  }

  return { startScale: round3(clamp(scale, CALIBRATION.minScale, CALIBRATION.maxScale)), note };
}

/* ==========================================================================
 * 4. THE FIT AND THE SOLVE — pure arithmetic, exported for the tests
 * ========================================================================== */

/** `ms = fixedMs + perMpxMs * Mpx`. */
export interface FillRateLine {
  readonly fixedMs: number;
  readonly perMpxMs: number;
}

/**
 * Ordinary least squares of frame time against megapixels.
 *
 * With exactly two points this is the line through them, which is the shipping
 * case; it is written as a fit rather than a two-point formula so a third probe
 * can be added without touching the solver.
 *
 * Returns a zero slope for a degenerate input (fewer than two points, or every
 * point at the same pixel count) rather than dividing by zero — and a zero
 * slope is exactly what `solveScale` reads as "not fill-rate bound", which is
 * the correct answer for data that cannot distinguish one resolution from
 * another.
 */
export function fitFillRate(points: readonly CalibrationPoint[]): FillRateLine {
  const n = points.length;
  if (n < 2) return { fixedMs: n === 1 ? points[0].ms : 0, perMpxMs: 0 };

  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += points[i].mpx;
    sy += points[i].ms;
  }
  const mx = sx / n;
  const my = sy / n;

  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = points[i].mpx - mx;
    sxx += dx * dx;
    sxy += dx * (points[i].ms - my);
  }
  if (sxx <= 1e-9) return { fixedMs: my, perMpxMs: 0 };

  const perMpxMs = sxy / sxx;
  return { fixedMs: my - perMpxMs * mx, perMpxMs };
}

/**
 * Solve the fitted line for the resolution scale that meets `targetMs`.
 *
 * `mpxPerScaleSq` is the drawing buffer's megapixels at scale 1 — the constant
 * of proportionality, since `planDrawingBuffer` makes the buffer exactly
 * `css * pixelRatio * scale` on each axis and therefore the pixel count exactly
 * quadratic in the scale.
 *
 * Returns `null` when the slope is flat: see the header. The caller must read
 * that as "keep the ceiling", never as "cut to the floor".
 */
export function solveScale(
  line: FillRateLine,
  targetMs: number,
  mpxPerScaleSq: number,
): number | null {
  if (!(line.perMpxMs >= CALIBRATION.flatSlopeMs)) return null;
  if (!(mpxPerScaleSq > 0)) return null;

  const mpxBudget = (CALIBRATION.headroom * (targetMs - line.fixedMs)) / line.perMpxMs;
  // A negative budget means the frame's FIXED cost alone blows the target. The
  // pixel term still dominates what is left — §9's own numbers put scale 0.55
  // at 27 ms against 44 ms at native on a machine that cannot reach 60 either
  // way — so this is not "give up", it is "the floor is the best answer", and
  // the clamp below is what says so.
  if (!(mpxBudget > 0)) return 0;
  return Math.sqrt(mpxBudget / mpxPerScaleSq);
}

/* ==========================================================================
 * 5. THE STAGED CONTROLLER
 * ========================================================================== */

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Kill the 0.30000000000000004 that `n * 0.05` produces. */
function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/** Snap to `CALIBRATION.step`, so the result reads as a slider position. */
export function snapScale(v: number): number {
  return round3(Math.round(v / CALIBRATION.step) * CALIBRATION.step);
}

/**
 * Drives the probe sequence and produces one `CalibrationResult`.
 *
 * warmup -> probe A (settle, window) -> probe B (settle, window) -> done.
 *
 * At 60 fps that is 30 + 2 x (10 + 30) = 110 frames, about 1.8 seconds; on the
 * machine that actually needs calibrating — §9's, at 23.6 fps — it is about
 * 4.7 seconds. It runs once per profile and never again.
 */
export class HardwareCalibration {
  private stageId: CalibrationStage = 'warmup';
  /** Frames seen in the current sub-phase (warmup, settle, or window). */
  private counted = 0;
  /** True while discarding frames after a scale change. */
  private settling = true;
  /** The window's samples. Fixed size, so a window allocates nothing. */
  private readonly window = new Float32Array(CALIBRATION.windowFrames);
  private readonly sorted = new Float32Array(CALIBRATION.windowFrames);
  /** Megapixels the current window is being measured at. */
  private windowMpx = 0;
  private readonly points: CalibrationPoint[] = [];

  /** The scale each probe renders at. */
  private readonly scaleA: number;
  private readonly scaleB: number;
  /** The scale to restore if this is abandoned. */
  readonly entryScale: number;
  private readonly ceiling: number;
  /** Frame-time target this run is solving for. See `targetMsForCap`. */
  private readonly targetMs: number;

  /** Reused; see `CalibrationStep`. */
  private readonly step: CalibrationStep = { scale: null, result: null, progress: 0 };

  /**
   * @param startScale where the prior says to begin probing.
   * @param entryScale the scale in force before calibration started.
   * @param ceiling    the highest scale the result may name.
   */
  constructor(
    startScale: number,
    entryScale: number,
    ceiling: number = CALIBRATION.maxScale,
    targetMs: number = CALIBRATION.targetMs,
  ) {
    // A non-finite or non-positive target would make `solveScale` return 0 and
    // floor every machine — see `targetMsForCap` for what flooring costs.
    this.targetMs = Number.isFinite(targetMs) && targetMs > 0 ? targetMs : CALIBRATION.targetMs;
    this.ceiling = clamp(ceiling, CALIBRATION.minScale, 2);
    this.entryScale = entryScale;
    this.scaleA = round3(clamp(startScale, CALIBRATION.minScale, this.ceiling));
    // The second probe must be a genuinely different pixel count. Clamping A to
    // the floor would otherwise put B on top of it and leave the fit singular.
    this.scaleB = round3(
      Math.max(CALIBRATION.minScale * 0.8, this.scaleA * CALIBRATION.probeRatio),
    );
  }

  get stage(): CalibrationStage { return this.stageId; }
  /** The probes measured so far. */
  get measured(): readonly CalibrationPoint[] { return this.points; }

  /**
   * The scale the FIRST probe needs, to be applied before the first sample.
   *
   * Applied by the system on arming rather than returned from `sample`, so the
   * warmup frames are already at probe A's resolution and the settle after it
   * is not paying for a change the caller could have made earlier.
   */
  get firstProbeScale(): number { return this.scaleA; }

  /**
   * Feed one presented frame.
   *
   * @param frameMs wall-clock milliseconds for the frame just presented.
   * @param mpx     drawing-buffer megapixels that frame was rendered at.
   */
  sample(frameMs: number, mpx: number): CalibrationStep {
    const out = this.step;
    out.scale = null;
    out.result = null;
    out.progress = this.progress();
    if (this.stageId === 'done') return out;

    // Same filter as `AdaptiveResolution`: a backgrounded tab, a breakpoint or
    // the frame after a shader compile describes nothing about the scene.
    if (!(Number.isFinite(frameMs) && frameMs > 0 && frameMs < 1000)) return out;
    if (!(mpx > 0)) return out;

    if (this.stageId === 'warmup') {
      this.counted++;
      if (this.counted < CALIBRATION.warmupFrames) return out;
      this.beginWindow('probe-a', mpx);
      return out;
    }

    if (this.settling) {
      this.counted++;
      if (this.counted < CALIBRATION.settleFrames) return out;
      this.settling = false;
      this.counted = 0;
      this.windowMpx = mpx;
      return out;
    }

    /*
     * THE PIXEL COUNT MUST NOT MOVE INSIDE A WINDOW. It does if the player
     * resizes the window, enters fullscreen, or drags the page to a display
     * with a different DPR mid-probe — and a window whose samples describe two
     * resolutions fits a line through nothing. Restart the probe instead.
     */
    if (Math.abs(mpx - this.windowMpx) > this.windowMpx * 0.01) {
      this.counted = 0;
      this.windowMpx = mpx;
      return out;
    }

    this.window[this.counted++] = frameMs;
    if (this.counted < CALIBRATION.windowFrames) return out;

    this.points.push({ mpx: this.windowMpx, ms: this.median(), scale: this.currentProbeScale() });

    if (this.stageId === 'probe-a') {
      this.beginWindow('probe-b', mpx);
      out.scale = this.scaleB;
      out.progress = this.progress();
      return out;
    }

    this.stageId = 'done';
    const result = this.decide();
    out.result = result;
    out.scale = result.resolutionScale;
    out.progress = 1;
    return out;
  }

  /** Abandon: the scale the caller should put back. */
  abort(): number {
    this.stageId = 'done';
    return this.entryScale;
  }

  private currentProbeScale(): number {
    return this.stageId === 'probe-a' ? this.scaleA : this.scaleB;
  }

  private beginWindow(stage: CalibrationStage, mpx: number): void {
    this.stageId = stage;
    this.settling = true;
    this.counted = 0;
    this.windowMpx = mpx;
  }

  private median(): number {
    const n = CALIBRATION.windowFrames;
    this.sorted.set(this.window);
    this.sorted.sort();
    return n % 2 === 1 ? this.sorted[(n - 1) >> 1] : (this.sorted[n / 2 - 1] + this.sorted[n / 2]) * 0.5;
  }

  private progress(): number {
    const total = CALIBRATION.warmupFrames + 2 * (CALIBRATION.settleFrames + CALIBRATION.windowFrames);
    let done = 0;
    switch (this.stageId) {
      case 'warmup': done = this.counted; break;
      case 'probe-a': done = CALIBRATION.warmupFrames + this.counted + (this.settling ? 0 : CALIBRATION.settleFrames); break;
      case 'probe-b': done = CALIBRATION.warmupFrames + CALIBRATION.settleFrames + CALIBRATION.windowFrames
        + this.counted + (this.settling ? 0 : CALIBRATION.settleFrames); break;
      default: return 1;
    }
    return clamp(done / total, 0, 1);
  }

  /** Fit, solve, clamp, and say why. */
  private decide(): CalibrationResult {
    const line = fitFillRate(this.points);
    // Take the constant of proportionality off the LARGEST probe: the drawing
    // buffer is rounded to whole pixels on each axis, and that rounding is a
    // smaller fraction of a bigger buffer.
    let mpxPerScaleSq = 0;
    for (const p of this.points) {
      const k = p.mpx / (p.scale * p.scale);
      if (k > mpxPerScaleSq) mpxPerScaleSq = k;
    }

    const raw = solveScale(line, this.targetMs, mpxPerScaleSq);

    if (raw === null) {
      // Flat slope. Pixels are not what costs; cutting them is pure loss.
      return this.finish(this.ceiling, 'not-fill-rate-bound', line);
    }
    const snapped = snapScale(raw);
    if (snapped >= this.ceiling) return this.finish(this.ceiling, 'headroom', line);
    if (snapped <= CALIBRATION.minScale) return this.finish(CALIBRATION.minScale, 'floor', line);
    return this.finish(snapped, 'fill-rate', line);
  }

  private finish(scale: number, reason: CalibrationReason, line: FillRateLine): CalibrationResult {
    /*
     * AO AND SHADOW DETAIL ARE SHED ONLY AT THE FLOOR, and that is the whole
     * escalation ladder. §9: AO is 16.9% of the frame and 4.97 ms recovered;
     * shadows are ~2%. Below the floor there is no resolution left to trade, so
     * these are the next two things worth anything — and above it, spending a
     * player's contact shadows to buy a fraction of a millisecond would be a
     * bad deal made on their behalf.
     */
    const floored = reason === 'floor';
    return {
      resolutionScale: round3(clamp(scale, CALIBRATION.minScale, this.ceiling)),
      ao: !floored,
      shadowQuality: floored ? 'low' : 'high',
      reason,
      fixedMs: line.fixedMs,
      perMpxMs: line.perMpxMs,
      points: this.points.slice(),
    };
  }
}

/**
 * One line for the console and the Settings row.
 *
 * Separate from the result so the numbers stay numbers — a caller that wants to
 * act on `reason` is not made to parse prose.
 */
export function describeCalibration(r: CalibrationResult): string {
  const pct = `${Math.round(r.resolutionScale * 100)}%`;
  const fit = `${r.fixedMs.toFixed(2)} + ${r.perMpxMs.toFixed(2)}/Mpx ms`;
  switch (r.reason) {
    case 'not-fill-rate-bound':
      return `Resolution left at ${pct}: this frame is not limited by pixel count (${fit}), `
        + 'so rendering fewer of them would cost sharpness and buy nothing.';
    case 'headroom':
      return `Resolution at ${pct} — full native, with frame time to spare (${fit}).`;
    case 'floor':
      return `Resolution at ${pct}, ambient occlusion off and shadow detail low: `
        + `the measured frame (${fit}) misses 60 fps even at the lowest scale.`;
    default:
      return `Resolution at ${pct}, solved from the measured frame (${fit}).`;
  }
}
