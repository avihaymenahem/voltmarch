/**
 * ============================================================================
 * src/ui/PerfHud.ts — THE PERFORMANCE READOUT, TOP LEFT
 * ============================================================================
 * WHY A NAIVE FPS COUNTER WOULD HAVE LIED TO US
 * ---------------------------------------------
 * Two measurements from this project's own machine, in a live match at native
 * 2560x1440:
 *
 *   baseline       med 16.6 ms   min  3.1   p95 322.7   60 fps   draws 194
 *   scale 1.00     med 77.9 ms   min 15.5   p95 132.6   13 fps   draws 203
 *
 * The first row reads "60 fps". It is also a machine at 100% GPU load with
 * nothing left, which was the user's actual complaint. A median of 16.6 ms is
 * not a measurement of performance — it is the vsync interval, and a display
 * cadence hides everything behind it. An overlay that printed a green 60 there
 * would have certified a drowning machine as healthy.
 *
 * So this overlay is built around one rule:
 *
 *   **WHILE FRAME TIME IS PINNED TO A DISPLAY CADENCE, FRAME TIME CARRIES NO
 *   INFORMATION ABOUT HEADROOM, AND THE OVERLAY MUST NOT PRETEND OTHERWISE.**
 *
 * `classifyLoad()` below therefore has FOUR answers for a pinned machine, not
 * two, and only one of them claims headroom:
 *
 *   VSYNC n · SPARE x ms        a GPU timer query MEASURED the spare time.
 *                               The only state with `claimsHeadroom: true`.
 *   VSYNC n · NO HEADROOM       pinned, but the evidence says it is at the
 *                               edge: the p95 blows past the cadence, or
 *                               frames are being missed, or the cadence itself
 *                               has halved (60 -> 30 is frame doubling, which
 *                               is what a saturated GPU looks like from JS), or
 *                               a GPU timer measured >= 85% of the interval.
 *   VSYNC n · HEADROOM UNKNOWN  pinned, tight, nothing wrong — and no GPU
 *                               timer, so we cannot prove there is slack. This
 *                               is the honest answer for most machines and it
 *                               is deliberately NOT green.
 *   CPU-BOUND / GPU-BOUND       not pinned at all. Frame time is the truth
 *                               again, and the CPU share says which side.
 *
 * WHAT THE DETECTOR CANNOT DO
 * ---------------------------
 * GPU time needs an API-level clock: `EXT_disjoint_timer_query_webgl2` on WebGL
 * or the adapter's `timestamp-query` feature on WebGPU. Browsers and adapters
 * may withhold either for capability or timing-attack reasons. When the active
 * backend exposes neither, the best available answer is
 * "unknown", and the only way to turn that into a number is to PROBE — raise
 * the load and see whether frame time moves, which is exactly how the two rows
 * quoted above were produced. A probe perturbs the thing it measures, so it
 * belongs in `tools/`, not in an always-on overlay. This is the honest limit of
 * the feature and it is printed on the panel rather than buried here.
 *
 * ZERO ALLOCATION, AND THE COST IS MEASURED RATHER THAN CLAIMED
 * ------------------------------------------------------------
 * The per-frame path pushes two floats into pre-allocated `Float32Array` rings
 * and returns. No strings, no objects, no `querySelector`, no DOM. Text is
 * rewritten at `UPDATE_HZ` (4 Hz) — a readout that changes at 60 Hz is
 * unreadable AND forces a layout every frame.
 *
 * The overlay times ITSELF: `calibrate()` runs the sample path ten thousand
 * times behind a stopwatch the first time the panel is shown, the update path
 * is timed on every update, and both numbers are printed on the last row. An
 * instrument that changes the reading is worse than no instrument, so the size
 * of the change is on the instrument's own face.
 *
 * IT CANNOT EAT A CLICK
 * ---------------------
 * `pointer-events: none` on the root, inline as well as in the stylesheet, and
 * nothing inside it is interactive. `perfLayerFaults()` walks the built tree so
 * that is a test rather than a sentence.
 *
 * THERE ARE TWO RENDERERS, AND A ROW THAT CANNOT BE MEASURED SAYS SO
 * -----------------------------------------------------------------
 * `?gpu=webgpu` boots the real game on a TSL node renderer, and this panel was
 * written when there was only one renderer to write for. A ZERO IS A CLAIM.
 * `src/render/debug.ts` made that call first — it prints
 * `${total} (no per-pass split)` rather than `0 col` — and this file follows it
 * rather than inventing a second answer to the same question. Three rows
 * changed, and one of them was wrong on BOTH backends:
 *
 *   draws   `drawCalls` is a SUM OVER EVERY SCENE SUBMISSION and `DRAW_BUDGET`
 *           bounds the COLOUR PASS ALONE — CLAUDE.md is explicit that the two
 *           are different quantities. This row printed `151 / 130` and went red
 *           on a WebGL frame whose colour pass was 77 of 130, i.e. the panel
 *           reported a permanent budget breach against a budget that was half
 *           empty. It prints the colour count against the budget now, with the
 *           total beside it as the content fingerprint it is. On the node path
 *           there IS no colour count — the node `Renderer` has no seam between
 *           the shadow pass and the colour pass to meter — so the slot reads
 *           `n/a` and `is-draws-over` cannot fire. **Do not invent a split**: a
 *           faked one looks like the WebGL number and means something else.
 *   gpu     WebGL uses `EXT_disjoint_timer_query_webgl2`; WebGPU uses Three's
 *           real `timestamp-query` integration. A bare `n/a` would conflate
 *           different missing capabilities, so the row names which one it is.
 *   device  New, and the reason is `docs/RENDER_FINDINGS.md` §7g:
 *           `powerPreference: 'high-performance'` is a HINT that Windows
 *           ignores, so a frame-time reading can be about a GPU nobody chose
 *           and nothing on this panel could say which. The live backend is on
 *           the header line, the adapter is on this row, and both are READ off
 *           the renderer rather than inferred from `?gpu=`.
 *
 * `classifyLoad` is deliberately API-neutral. If the live backend has no GPU
 * clock, frame time remains the display rather than a fabricated load metric.
 * ============================================================================
 */

import { el, label } from './Chrome';

/**
 * TYPE ONLY, and it stays that way. `src/render/backend.ts` imports no three
 * and this import is erased at build time, so "the panel never imports the
 * engine" survives intact — while the backend names stay a single spelling
 * instead of a copy in this file that drifts from the renderer's.
 */
import type { LiveBackend } from '../render/backend';
import {
  GPU_PASS_COUNT,
  gpuPassIndex,
  installGpuPassTimer,
  type GpuPassId,
  type GpuPassSnapshot,
  type GpuPassTimerSink,
} from '../render/gpu-pass-timings';

import './perf.css';
import {
  DraggablePanel,
  PERFORMANCE_PANEL_POSITION_KEY,
} from './DraggablePanel';

/* ==========================================================================
 * SECTION 1 — BUDGETS AND THRESHOLDS
 *
 * Every number here is either documented in CLAUDE.md or derived from the two
 * measurements in the header. Nothing is a feeling.
 * ========================================================================== */

/**
 * Draw-call ceiling — `MAX_DRAW_CALLS` in `src/core/config.ts`.
 *
 * **IT BOUNDS THE COLOUR PASS, NOT THE FRAME.** `renderer.info.autoReset` is
 * false and the reset happens once per frame, so the total this panel also
 * shows is a SUM over the shadow pass, the colour pass and whatever quads the
 * post chain ran. Measured across the thirteen capture fixtures: total 105-157,
 * colour 51-77. Comparing the first against 130 is what made this row read as a
 * permanent overrun; `formatDraws` compares the second.
 */
export const DRAW_BUDGET = 130;

/**
 * The 130 ceiling was authored and captured against WebGL's submission model.
 * Three's common WebGPU renderer splits the same allied-base colour work into
 * 445 submissions versus WebGL's 68 while completing the measured frame faster
 * (7.13 ms versus 12.23 ms at 1280x720). Treating 130 as backend-neutral would
 * make a truthful WebGPU counter produce a permanently false red warning.
 */
export function drawBudgetForBackend(backend: LiveBackend | null): number | null {
  return backend === 'webgl' ? DRAW_BUDGET : null;
}

/**
 * Triangle advisory. There is no documented triangle budget, so this is not
 * presented as one: the GPU-bound capture in the header measured 1.75 M, and
 * this line marks anything within reach of that as worth looking at. It warns;
 * it never says "over budget", because there is no budget to be over.
 */
export const TRIANGLE_ADVISORY = 1_200_000;

/** Frames of history. 240 at 60 fps is four seconds — enough for a real p95. */
export const HISTORY_FRAMES = 240;

/** Below this many samples the panel says it is still sampling. */
export const MIN_SAMPLES = 30;

/** Text rewrites per second. Sampling stays at frame rate. */
export const UPDATE_HZ = 4;

/**
 * Display cadences we recognise, in milliseconds.
 *
 * The gaps between neighbours are all wider than 16%, so the +-8% match windows
 * below can never overlap and the winner is unambiguous.
 */
export const REFRESH_INTERVALS_MS: readonly number[] = [
  1000 / 240, 1000 / 165, 1000 / 144, 1000 / 120,
  1000 / 90, 1000 / 75, 1000 / 60, 1000 / 50, 1000 / 30,
];

/** How close a frame has to be to a cadence to count as sitting on it. */
export const CADENCE_TOLERANCE = 0.08;

/** Share of the window that must sit on one cadence before we call it pinned. */
export const CADENCE_SHARE = 0.5;

/** p95 at or past this multiple of the cadence means the machine is at the edge. */
export const TAIL_SATURATION_FACTOR = 1.5;

/** Fraction of frames allowed to miss the cadence before it counts as missing. */
export const MISS_RATIO_LIMIT = 0.02;

/** Measured GPU time at or past this share of the interval is saturation. */
export const GPU_SATURATION_SHARE = 0.85;

/** Measured GPU time below this share of the interval is provable headroom. */
export const GPU_SPARE_SHARE = 0.7;

/** CPU share of the frame at or past which a free-running frame is CPU-bound. */
export const CPU_BOUND_SHARE = 0.75;

/* -- layout arithmetic, in code so the stylesheet cannot drift from it ----- */

/** Panel width in design units. Mirrors `.vm-perf` in perf.css. */
export const PERF_WIDTH_UNITS = 150;
const PAD_UNITS = 4;
const HEAD_UNITS = 11;
const PRIMARY_UNITS = 20;
const VERDICT_UNITS = 11;
const ROW_UNITS = 11;
const ROW_GAP_UNITS = 1;
const BLOCK_GAP_UNITS = 3;
/** Core diagnostics plus five GPU/CPU subsystem rows. */
export const PERF_ROW_COUNT = 13;

/**
 * Panel height in design units.
 *
 * The same arithmetic as `perf.css`, restated here because the frame cost of a
 * diagnostic overlay is a claim, and a claim that lives only in a comment is
 * one nobody can fail. `tests/perf-hud.spec.ts` pins both against each other.
 */
export function perfPanelHeightUnits(rows: number = PERF_ROW_COUNT): number {
  const n = Math.max(0, Math.floor(rows));
  return (
    PAD_UNITS + HEAD_UNITS + BLOCK_GAP_UNITS + PRIMARY_UNITS + BLOCK_GAP_UNITS +
    VERDICT_UNITS + BLOCK_GAP_UNITS + n * ROW_UNITS + Math.max(0, n - 1) * ROW_GAP_UNITS +
    PAD_UNITS
  );
}

/** Fraction of a frame the panel occupies at `uiScale` 1. */
export function perfFrameShareOf(frameW: number, frameH: number): number {
  if (frameW <= 0 || frameH <= 0) return 0;
  return (PERF_WIDTH_UNITS * perfPanelHeightUnits()) / (frameW * frameH);
}

/* ==========================================================================
 * SECTION 2 — THE RING
 *
 * Fixed capacity, written every frame, sorted only when the text is rewritten.
 * Insertion sort rather than anything cleverer: 240 elements four times a
 * second is ~30 microseconds, it allocates nothing, and — unlike a quicksort
 * with a stack — it cannot be wrong.
 * ========================================================================== */

export class FrameRing {
  private readonly buf: Float32Array;
  private readonly sorted: Float32Array;
  private head = 0;
  private filled = 0;
  /** Live count in `sorted` after the last `snapshot()`. */
  private sortedCount = 0;

  constructor(capacity: number = HISTORY_FRAMES) {
    const n = Math.max(1, Math.floor(capacity));
    this.buf = new Float32Array(n);
    this.sorted = new Float32Array(n);
  }

  /** The only per-frame call. Writes one float; allocates nothing. */
  push(value: number): void {
    this.buf[this.head] = value;
    this.head = (this.head + 1) % this.buf.length;
    if (this.filled < this.buf.length) this.filled++;
  }

  get count(): number {
    return this.filled;
  }

  get capacity(): number {
    return this.buf.length;
  }

  /** For the allocation test: the backing store must never be replaced. */
  get storage(): ArrayBufferLike {
    return this.buf.buffer;
  }

  reset(): void {
    this.head = 0;
    this.filled = 0;
    this.sortedCount = 0;
  }

  /** Copy the live window out and sort it. Call once before reading quantiles. */
  snapshot(): number {
    const n = this.filled;
    const src = this.buf;
    const dst = this.sorted;
    const cap = src.length;
    const start = (this.head - n + cap) % cap;
    for (let i = 0; i < n; i++) dst[i] = src[(start + i) % cap];
    for (let i = 1; i < n; i++) {
      const v = dst[i];
      let j = i - 1;
      while (j >= 0 && dst[j] > v) {
        dst[j + 1] = dst[j];
        j--;
      }
      dst[j + 1] = v;
    }
    this.sortedCount = n;
    return n;
  }

  /** Nearest-rank quantile over the last `snapshot()`. 0 when empty. */
  quantile(q: number): number {
    const n = this.sortedCount;
    if (n === 0) return 0;
    const clamped = q < 0 ? 0 : q > 1 ? 1 : q;
    const idx = Math.round(clamped * (n - 1));
    return this.sorted[idx];
  }

  get median(): number {
    return this.quantile(0.5);
  }

  get min(): number {
    return this.sortedCount === 0 ? 0 : this.sorted[0];
  }

  get max(): number {
    return this.sortedCount === 0 ? 0 : this.sorted[this.sortedCount - 1];
  }

  /** Share of the sorted window strictly above `limit`. Requires `snapshot()`. */
  shareAbove(limit: number): number {
    const n = this.sortedCount;
    if (n === 0) return 0;
    let above = 0;
    for (let i = n - 1; i >= 0; i--) {
      if (this.sorted[i] > limit) above++;
      else break;
    }
    return above / n;
  }

  /**
   * Share of the sorted window within `tolerance` of `centre`.
   * Requires `snapshot()`. Pure arithmetic over the sorted copy.
   */
  shareNear(centre: number, tolerance: number): number {
    const n = this.sortedCount;
    if (n === 0) return 0;
    const lo = centre * (1 - tolerance);
    const hi = centre * (1 + tolerance);
    let hits = 0;
    for (let i = 0; i < n; i++) {
      const v = this.sorted[i];
      if (v > hi) break;
      if (v >= lo) hits++;
    }
    return hits / n;
  }
}

/**
 * The display cadence the window is sitting on, or null when it is free.
 *
 * Deliberately NOT `1000 / screen.refreshRate` — the browser does not offer
 * that, and a fixed 16.67 assumption is wrong on every 120 Hz laptop shipped in
 * the last five years. This reads the cadence out of the data instead, which
 * also means a machine that is NOT vsync-limited correctly reports nothing.
 */
export function detectCadenceMs(ring: FrameRing): number | null {
  if (ring.count < MIN_SAMPLES) return null;
  let best: number | null = null;
  let bestShare = CADENCE_SHARE;
  for (let i = 0; i < REFRESH_INTERVALS_MS.length; i++) {
    const interval = REFRESH_INTERVALS_MS[i];
    const share = ring.shareNear(interval, CADENCE_TOLERANCE);
    if (share > bestShare) {
      bestShare = share;
      best = interval;
    }
  }
  return best;
}

/* ==========================================================================
 * SECTION 3 — THE VERDICT (pure, and therefore testable)
 * ========================================================================== */

export type LoadState =
  | 'warmup'
  | 'cpu-bound'
  | 'gpu-bound'
  | 'vsync-spare'
  | 'vsync-unknown'
  | 'vsync-saturated';

export type LoadSeverity = 'ok' | 'watch' | 'warn' | 'bad';

export interface LoadSample {
  /** Samples in the window. Below MIN_SAMPLES the answer is 'warmup'. */
  samples: number;
  frameMedianMs: number;
  frameP95Ms: number;
  /** Full JS cost of a frame — sim plus every system plus the submit. */
  cpuMedianMs: number;
  /** GPU time from a timer query, or null when the extension is absent. */
  gpuMs: number | null;
  /** The cadence the window sits on, or null when free-running. */
  cadenceMs: number | null;
  /** Shortest cadence seen this session. 60 -> 30 is frame doubling. */
  bestCadenceMs: number | null;
  /** Share of frames that overran the cadence by half again. */
  missRatio: number;
}

export interface LoadVerdict {
  state: LoadState;
  /** The line the panel prints. */
  label: string;
  /** One short clause saying WHY, so the state is never a bare assertion. */
  reason: string;
  severity: LoadSeverity;
  /**
   * True only when spare GPU time was MEASURED. Nothing else may set it — this
   * flag is the whole point of the module and `tests/perf-hud.spec.ts` asserts
   * it stays false for every pinned case without a timer.
   */
  claimsHeadroom: boolean;
}

/** `60` from 16.67, `144` from 6.94 — for the label only. */
function cadenceHz(intervalMs: number): number {
  return Math.round(1000 / intervalMs);
}

/**
 * Turn a window of measurements into one honest sentence.
 *
 * Pure: no DOM, no clock, no engine. Every branch below is exercised by
 * `tests/perf-hud.spec.ts`, including the two real captures in the file header.
 */
export function classifyLoad(s: LoadSample): LoadVerdict {
  if (s.samples < MIN_SAMPLES) {
    return {
      state: 'warmup',
      label: 'SAMPLING',
      reason: `${s.samples}/${MIN_SAMPLES} frames`,
      severity: 'ok',
      claimsHeadroom: false,
    };
  }

  const cadence = s.cadenceMs;

  /* -- free-running: frame time means what it says ----------------------- */
  if (cadence === null) {
    const share = s.frameMedianMs > 0 ? s.cpuMedianMs / s.frameMedianMs : 0;
    const cpuBound = share >= CPU_BOUND_SHARE;
    const severity: LoadSeverity =
      s.frameMedianMs >= 33.3 ? 'bad' : s.frameMedianMs >= 20 ? 'warn' : 'watch';
    return {
      state: cpuBound ? 'cpu-bound' : 'gpu-bound',
      label: cpuBound ? 'CPU-BOUND' : 'GPU-BOUND',
      reason: cpuBound
        ? `js ${s.cpuMedianMs.toFixed(1)} ms of ${s.frameMedianMs.toFixed(1)}`
        : `js only ${s.cpuMedianMs.toFixed(1)} ms of ${s.frameMedianMs.toFixed(1)}`,
      severity,
      claimsHeadroom: false,
    };
  }

  const hz = cadenceHz(cadence);

  /* -- pinned: frame time is the display talking, not the game ----------- */
  const best = s.bestCadenceMs;
  const gpu = s.gpuMs;
  const doubled = best !== null && cadence > best * 1.5;
  const tail = s.frameP95Ms >= cadence * TAIL_SATURATION_FACTOR;
  const missing = s.missRatio > MISS_RATIO_LIMIT;
  const gpuHot = gpu !== null && gpu >= cadence * GPU_SATURATION_SHARE;

  if (doubled || tail || missing || gpuHot) {
    const reason = doubled && best !== null
      ? `locked to ${hz} after ${cadenceHz(best)} — frames doubling`
      : gpuHot && gpu !== null
        ? `gpu ${gpu.toFixed(1)} of ${cadence.toFixed(1)} ms`
        : tail
          ? `p95 ${s.frameP95Ms.toFixed(1)} ms past the ${cadence.toFixed(1)} ms cap`
          : `${(s.missRatio * 100).toFixed(0)}% of frames miss the cap`;
    return {
      state: 'vsync-saturated',
      label: `VSYNC ${hz} · NO HEADROOM`,
      reason,
      severity: 'bad',
      claimsHeadroom: false,
    };
  }

  if (gpu !== null && gpu < cadence * GPU_SPARE_SHARE) {
    return {
      state: 'vsync-spare',
      label: `VSYNC ${hz} · SPARE ${(cadence - gpu).toFixed(1)} ms`,
      reason: `gpu ${gpu.toFixed(1)} of ${cadence.toFixed(1)} ms, measured`,
      severity: 'ok',
      claimsHeadroom: true,
    };
  }

  return {
    state: 'vsync-unknown',
    label: `VSYNC ${hz} · HEADROOM UNKNOWN`,
    reason: 'no gpu timer — frame time is the display, not the load',
    severity: 'watch',
    claimsHeadroom: false,
  };
}

/* ==========================================================================
 * SECTION 4 — THE GPU TIMER
 *
 * `EXT_disjoint_timer_query_webgl2` where the browser offers it, and silence
 * where it does not. It is the only measurement that can PROVE headroom, and it
 * is unavailable on most Chrome installs, which is why the whole design above
 * treats it as a bonus rather than a foundation.
 *
 * THE BRACKET
 * -----------
 * `SystemRegistry.runFrame` runs every render-phase module BEFORE the loop's
 * render hook submits the frame, so a query opened in this module's `frame()`
 * and closed in the NEXT one brackets exactly one presentation: the whole of
 * `present()` and nothing else, because nothing else in the page issues GL
 * commands. A query therefore spans a frame boundary by design.
 * ========================================================================== */

/** The members of a WebGL2 context this module touches, and no others. */
export interface TimerQueryGl {
  getExtension(name: string): unknown;
  createQuery(): object | null;
  deleteQuery(query: object): void;
  beginQuery(target: number, query: object): void;
  endQuery(target: number): void;
  getQueryParameter(query: object, pname: number): unknown;
  getParameter(pname: number): unknown;
  readonly QUERY_RESULT_AVAILABLE: number;
  readonly QUERY_RESULT: number;
}

interface TimerExt {
  readonly TIME_ELAPSED_EXT: number;
  readonly GPU_DISJOINT_EXT: number;
}

function isTimerExt(v: unknown): v is TimerExt {
  if (typeof v !== 'object' || v === null) return false;
  const e = v as Partial<TimerExt>;
  return typeof e.TIME_ELAPSED_EXT === 'number' && typeof e.GPU_DISJOINT_EXT === 'number';
}

/**
 * Queries in flight. Pass sampling rotates one category per frame; the larger
 * pool covers a particle frame (three meshes) plus several frames of driver
 * latency without ever blocking for a result.
 */
const TIMER_POOL = 24;
const TIMER_SAMPLE_RING = 32;

/**
 * Why the GPU row is or is not showing a number.
 *
 * A UNION RATHER THAN THE FOUR BARE STRINGS IT USED TO RETURN, because the
 * panel now has to answer a second question about the same state — "absent for
 * which reason" — and a `''`-means-ok convention cannot be exhaustively
 * switched on. `formatGpuTime` is the only consumer.
 *
 * `disjoint` is WebGL vocabulary; the API-neutral surface retains it because a
 * WebGPU timer can use the other three states. The backend-aware formatter is
 * what explains why an unavailable timer is absent.
 */
export type GpuTimerStatus =
  /** The active graphics API exposes no usable GPU clock. */
  | 'absent'
  /** The extension is live and no query has resolved yet. */
  | 'waiting'
  /** The GPU was preempted or its clock reset; the window was thrown away. */
  | 'disjoint'
  /** A real measurement is available. */
  | 'ok';

/** The timer surface consumed by the panel, independent of graphics API. */
export interface GpuTimerLike extends Partial<GpuPassTimerSink> {
  readonly available: boolean;
  readonly gpuMs: number | null;
  readonly status: GpuTimerStatus;
  readonly passSnapshot?: GpuPassSnapshot;
  tick(): void;
  /** Optional activation hook; writes stop when neither HUD nor governor needs them. */
  setActive?(active: boolean): void;
  dispose(): void;
}

export class GpuTimer implements GpuTimerLike {
  private readonly ext: TimerExt | null = null;
  private readonly queries: object[] = [];
  private readonly pending: Int32Array = new Int32Array(TIMER_POOL);
  private readonly querySample: Int32Array = new Int32Array(TIMER_POOL).fill(-1);
  private readonly samplePass: Int8Array = new Int8Array(TIMER_SAMPLE_RING).fill(-1);
  private readonly samplePending: Int8Array = new Int8Array(TIMER_SAMPLE_RING);
  private readonly sampleClosed: Uint8Array = new Uint8Array(TIMER_SAMPLE_RING);
  private readonly sampleSum: Float32Array = new Float32Array(TIMER_SAMPLE_RING);
  private readonly passValues: Array<number | null> = Array<number | null>(GPU_PASS_COUNT).fill(null);
  private readonly snapshot: { revision: number; values: ReadonlyArray<number | null> } = {
    revision: 0,
    values: this.passValues,
  };
  private pendingCount = 0;
  private open = -1;
  private openSample = -1;
  private active = false;
  private target = gpuPassIndex('total');
  private sampleSerial = 0;
  private currentSample = -1;
  private sceneArmed = false;
  private disjointSeen = false;

  constructor(private readonly gl: TimerQueryGl | null) {
    if (gl === null) return;
    let ext: unknown = null;
    try {
      ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    } catch {
      ext = null;
    }
    if (!isTimerExt(ext)) return;
    for (let i = 0; i < TIMER_POOL; i++) {
      const q = gl.createQuery();
      if (q === null) break;
      this.queries.push(q);
    }
    if (this.queries.length === 0) return;
    this.ext = ext;
  }

  get available(): boolean {
    return this.ext !== null;
  }

  /** The last resolved GPU frame time, or null when nothing is measurable. */
  get gpuMs(): number | null {
    return this.ext === null ? null : this.passValues[gpuPassIndex('total')];
  }

  get passSnapshot(): GpuPassSnapshot { return this.snapshot; }

  /** Why the readout is empty, for the panel's own row. */
  get status(): GpuTimerStatus {
    if (this.ext === null) return 'absent';
    if (this.disjointSeen) return 'disjoint';
    return this.gpuMs === null ? 'waiting' : 'ok';
  }

  setActive(active: boolean): void {
    this.active = active;
    if (!active) this.closeOpen();
  }

  beginPass(id: GpuPassId): void {
    if (!this.active || this.ext === null || this.currentSample < 0) return;
    const idx = gpuPassIndex(id);
    if (idx !== this.target) {
      // The scene query begins only after Three's nested shadow submission.
      if (id === 'scene' && this.target === gpuPassIndex('scene')) this.sceneArmed = true;
      return;
    }
    if (id === 'scene') {
      this.sceneArmed = true;
      return;
    }
    this.openQuery();
  }

  endPass(id: GpuPassId): void {
    if (!this.active || this.ext === null || this.currentSample < 0) return;
    if (id === 'shadow' && this.sceneArmed && this.target === gpuPassIndex('scene')) {
      // `WebGLRenderer.render()` has just returned from shadowMap.render; the
      // remaining work in the outer RenderPass is the colour scene exactly.
      this.openQuery();
      return;
    }
    if (gpuPassIndex(id) !== this.target) return;
    this.closeOpen();
    if (id === 'scene') this.sceneArmed = false;
  }

  /**
   * Once per frame, before the frame's GL work. Closes the previous frame's
   * query, harvests whatever the driver has finished, and opens the next.
   * Allocates nothing.
   */
  tick(): void {
    const gl = this.gl;
    const ext = this.ext;
    if (gl === null || ext === null || !this.active) return;

    this.closeOpen();
    this.closeSample();

    // A disjoint event means every query in flight is garbage — the GPU was
    // preempted or the clock was reset. Throw the window away rather than
    // report a number that is silently wrong.
    let disjoint = false;
    try {
      disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT) === true;
    } catch {
      disjoint = false;
    }
    if (disjoint) {
      this.pendingCount = 0;
      this.passValues.fill(null);
      this.querySample.fill(-1);
      this.samplePending.fill(0);
      this.sampleClosed.fill(0);
      this.disjointSeen = true;
    } else {
      // Harvest every ready query at the head. Results are ordered by issue,
      // so the first unavailable one is also the boundary for this poll.
      while (this.pendingCount > 0) {
      const idx = this.pending[0];
      const q = this.queries[idx];
      let ready = false;
      try {
        ready = gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE) === true;
      } catch {
        ready = false;
      }
        if (!ready) break;
        let ns = 0;
        try {
          const raw = gl.getQueryParameter(q, gl.QUERY_RESULT);
          ns = typeof raw === 'number' ? raw : 0;
        } catch {
          ns = 0;
        }
        const sample = this.querySample[idx];
        if (sample >= 0) {
          this.sampleSum[sample] += ns / 1e6;
          if (this.samplePending[sample] > 0) this.samplePending[sample]--;
          this.publishSample(sample);
        }
        this.querySample[idx] = -1;
        this.disjointSeen = false;
        for (let i = 1; i < this.pendingCount; i++) this.pending[i - 1] = this.pending[i];
        this.pendingCount--;
      }
    }

    this.beginSample();
    if (this.target === gpuPassIndex('total')) this.openQuery();
  }

  private beginSample(): void {
    const slot = this.sampleSerial++ % TIMER_SAMPLE_RING;
    // A driver more than 32 sampled frames behind is not a clock we should
    // steer from. Leave that old slot pending and skip this sample.
    if (this.samplePending[slot] !== 0) {
      this.currentSample = -1;
      return;
    }
    this.currentSample = slot;
    this.target = this.sampleSerial % GPU_PASS_COUNT;
    this.samplePass[slot] = this.target;
    this.sampleClosed[slot] = 0;
    this.sampleSum[slot] = 0;
    this.sceneArmed = false;
  }

  private closeSample(): void {
    const sample = this.currentSample;
    if (sample < 0) return;
    this.sampleClosed[sample] = 1;
    this.publishSample(sample);
    this.currentSample = -1;
    this.sceneArmed = false;
  }

  private publishSample(sample: number): void {
    if (this.sampleClosed[sample] === 0 || this.samplePending[sample] !== 0) return;
    const pass = this.samplePass[sample];
    if (pass >= 0) {
      this.passValues[pass] = this.sampleSum[sample] > 0 ? this.sampleSum[sample] : null;
      this.snapshot.revision++;
    }
    this.sampleClosed[sample] = 0;
    this.samplePass[sample] = -1;
    this.sampleSum[sample] = 0;
  }

  private openQuery(): void {
    const gl = this.gl;
    const ext = this.ext;
    if (gl === null || ext === null || this.open >= 0 || this.currentSample < 0) return;
    for (let i = 0; i < this.queries.length; i++) {
      if (this.querySample[i] >= 0) continue;
      try {
        gl.beginQuery(ext.TIME_ELAPSED_EXT, this.queries[i]);
        this.open = i;
        this.openSample = this.currentSample;
      } catch {
        this.open = -1;
        this.openSample = -1;
      }
      return;
    }
  }

  private closeOpen(): void {
    const gl = this.gl;
    const ext = this.ext;
    if (gl === null || ext === null || this.open < 0) return;
    const idx = this.open;
    const sample = this.openSample;
    try {
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      if (this.pendingCount < TIMER_POOL && sample >= 0) {
        this.pending[this.pendingCount++] = idx;
        this.querySample[idx] = sample;
        this.samplePending[sample]++;
      }
    } catch {
      this.querySample[idx] = -1;
    }
    this.open = -1;
    this.openSample = -1;
  }

  dispose(): void {
    const gl = this.gl;
    const ext = this.ext;
    if (gl === null || ext === null) return;
    if (this.open >= 0) {
      try {
        gl.endQuery(ext.TIME_ELAPSED_EXT);
      } catch {
        /* The context may already be lost; there is nothing to salvage. */
      }
      this.open = -1;
    }
    for (const q of this.queries) {
      try {
        gl.deleteQuery(q);
      } catch {
        /* Same. */
      }
    }
    this.queries.length = 0;
    this.pendingCount = 0;
    this.currentSample = -1;
  }
}

/** Structural surface of Three's WebGPU timestamp-query path. */
export interface WebGpuTimestampRenderer {
  readonly info: { readonly frame?: number; readonly render: { timestamp: number } };
  readonly backend: WebGpuTimestampBackend;
  resolveTimestampsAsync(type?: string): Promise<number | undefined>;
}

interface WebGpuRenderContextLike {
  readonly id?: number;
  readonly camera?: { readonly isOrthographicCamera?: boolean } | null;
  readonly clippingContext?: { readonly shadowPass?: boolean } | null;
  readonly textures?: ReadonlyArray<{ readonly name?: string }> | null;
}

interface WebGpuTimestampPoolLike {
  readonly timestamps?: Map<string, number>;
}

interface WebGpuTimestampBackend {
  trackTimestamp?: boolean;
  beginRender?(context: WebGpuRenderContextLike): void;
  getTimestampUID?(context: WebGpuRenderContextLike): string;
  readonly timestampQueryPool?: { readonly render?: WebGpuTimestampPoolLike };
}

/** Resolve often enough to keep Three's fixed query pool bounded, not per frame. */
const WEBGPU_RESOLVE_FRAMES = 15;

/**
 * Real WebGPU GPU time from Three's `timestamp-query` integration.
 *
 * The feature is requested when the renderer is created, but timestamp writes
 * run only while the overlay or governor needs them. Every fifteenth sampled
 * frame resolves asynchronously; the renderer reports the latest complete
 * frame in milliseconds.
 */
export class WebGpuTimer implements GpuTimerLike, GpuPassTimerSink {
  private readonly supported: boolean;
  private active = false;
  private pending = false;
  private failed = false;
  private frames = 0;
  private lastMs: number | null = null;
  private readonly passValues: Array<number | null> = Array<number | null>(GPU_PASS_COUNT).fill(null);
  private readonly snapshot: { revision: number; values: ReadonlyArray<number | null> } = {
    revision: 0,
    values: this.passValues,
  };
  private readonly contextUids: string[] = new Array<string>(2048);
  private readonly contextPass: Int8Array = new Int8Array(2048);
  private readonly contextFrame: Int32Array = new Int32Array(2048);
  private contextCount = 0;
  private readonly sums = new Float32Array(GPU_PASS_COUNT);
  private readonly baseBeginRender: ((context: WebGpuRenderContextLike) => void) | null;

  constructor(private readonly renderer: WebGpuTimestampRenderer) {
    // WebGPUBackend folds the constructor request together with actual adapter
    // support during init. Reading this after init is therefore the capability
    // test; do not infer support from the requested backend.
    this.supported = renderer.backend.trackTimestamp === true;
    const backend = renderer.backend;
    const begin = backend.beginRender;
    this.baseBeginRender = typeof begin === 'function' ? begin.bind(backend) : null;
    if (this.supported && this.baseBeginRender !== null) {
      const self = this;
      backend.beginRender = function timedBeginRender(context: WebGpuRenderContextLike): void {
        self.captureContext(context);
        self.baseBeginRender!(context);
      };
    }
    // Capability and activity are separate. PerfHud explicitly activates the
    // timer after installing it; direct users retain the prior opt-in contract.
    backend.trackTimestamp = false;
  }

  get available(): boolean { return this.supported && !this.failed; }
  get gpuMs(): number | null { return this.available ? this.lastMs : null; }
  get passSnapshot(): GpuPassSnapshot { return this.snapshot; }
  get status(): GpuTimerStatus {
    if (!this.available) return 'absent';
    return this.lastMs === null ? 'waiting' : 'ok';
  }

  setActive(active: boolean): void {
    if (!this.supported || this.failed) return;
    this.active = active;
    this.renderer.backend.trackTimestamp = active;
    if (!active) this.frames = 0;
  }

  beginPass(_id: GpuPassId): void { /* Render contexts are the WebGPU pass boundaries. */ }
  endPass(_id: GpuPassId): void { /* See captureContext(). */ }

  tick(): void {
    if (!this.active || !this.available || this.pending) return;
    this.frames++;
    if (this.frames < WEBGPU_RESOLVE_FRAMES) return;
    this.frames = 0;
    this.pending = true;
    void this.renderer.resolveTimestampsAsync('render').then((ms) => {
      this.pending = false;
      if (typeof ms === 'number' && Number.isFinite(ms) && ms >= 0) {
        this.lastMs = ms;
        this.passValues[gpuPassIndex('total')] = ms;
        this.resolveContexts();
        this.snapshot.revision++;
      }
    }, () => {
      this.pending = false;
      this.failed = true;
      this.active = false;
      this.renderer.backend.trackTimestamp = false;
    });
  }

  private captureContext(context: WebGpuRenderContextLike): void {
    if (!this.active || !this.available || this.contextCount >= this.contextUids.length) return;
    const getUid = this.renderer.backend.getTimestampUID;
    if (typeof getUid !== 'function') return;
    let uid = '';
    try {
      uid = getUid.call(this.renderer.backend, context);
    } catch {
      return;
    }
    if (uid === '') return;
    const i = this.contextCount++;
    this.contextUids[i] = uid;
    this.contextPass[i] = this.classifyContext(context);
    this.contextFrame[i] = this.renderer.info.frame ?? this.frameFromUid(uid);
  }

  private classifyContext(context: WebGpuRenderContextLike): number {
    // Full-screen post nodes also use an orthographic camera. The renderer's
    // clipping context is the reliable statement that this is a shadow pass.
    if (context.clippingContext?.shadowPass === true) return gpuPassIndex('shadow');
    const name = context.textures?.[0]?.name ?? '';
    if (name === 'PostHDR') return gpuPassIndex('scene');
    if (name.startsWith('Ssgi') || name.startsWith('SSGI')) return gpuPassIndex('gi');
    if (name.startsWith('Ao')) return gpuPassIndex('ao');
    if (name.startsWith('UnrealBloomPass') || name === 'PostBloomInput' || name === 'PostGradeInput') {
      return gpuPassIndex('bloom');
    }
    if (name.toUpperCase().includes('SMAA')) return gpuPassIndex('smaa');
    // The final default-framebuffer context evaluates the grade expression.
    if (context.textures === null) return gpuPassIndex('grade');
    return gpuPassIndex('scene');
  }

  private frameFromUid(uid: string): number {
    const marker = uid.lastIndexOf(':f');
    if (marker < 0) return -1;
    const n = Number(uid.slice(marker + 2));
    return Number.isFinite(n) ? n : -1;
  }

  private resolveContexts(): void {
    const timestamps = this.renderer.backend.timestampQueryPool?.render?.timestamps;
    if (timestamps === undefined || this.contextCount === 0) {
      this.contextCount = 0;
      return;
    }
    let latest = -1;
    for (let i = 0; i < this.contextCount; i++) {
      if (timestamps.has(this.contextUids[i]) && this.contextFrame[i] > latest) latest = this.contextFrame[i];
    }
    if (latest < 0) {
      this.contextCount = 0;
      return;
    }
    this.sums.fill(0);
    for (let i = 0; i < this.contextCount; i++) {
      if (this.contextFrame[i] !== latest) continue;
      const ms = timestamps.get(this.contextUids[i]);
      if (ms === undefined || !Number.isFinite(ms) || ms < 0) continue;
      this.sums[this.contextPass[i]] += ms;
    }
    for (let i = 1; i < GPU_PASS_COUNT; i++) {
      this.passValues[i] = null;
      if (this.sums[i] > 0) this.passValues[i] = this.sums[i];
    }
    this.contextCount = 0;
  }

  dispose(): void {
    this.active = false;
    this.renderer.backend.trackTimestamp = false;
    if (this.baseBeginRender !== null) this.renderer.backend.beginRender = this.baseBeginRender;
    this.contextCount = 0;
  }
}

/**
 * A WebGL2 context that can actually run timer queries, or null.
 *
 * Duck-typed off `unknown` for the same reason `readProgression()` in
 * Objectives.ts is: the caller has a `WebGLRenderingContext | WebGL2RenderingContext`
 * union from Three, and the honest way to narrow it is to check for the members
 * this module calls.
 */
export function asTimerGl(gl: unknown): TimerQueryGl | null {
  if (typeof gl !== 'object' || gl === null) return null;
  const c = gl as Partial<TimerQueryGl>;
  if (typeof c.getExtension !== 'function') return null;
  if (typeof c.createQuery !== 'function') return null;
  if (typeof c.beginQuery !== 'function') return null;
  if (typeof c.endQuery !== 'function') return null;
  if (typeof c.getQueryParameter !== 'function') return null;
  if (typeof c.getParameter !== 'function') return null;
  if (typeof c.QUERY_RESULT !== 'number') return null;
  return gl as TimerQueryGl;
}

/* ==========================================================================
 * SECTION 5 — THE ENGINE SEAM
 *
 * The panel never imports the engine. `src/ui/perf.system.ts` implements this
 * against `window.__VM.stats()` and the loop's own `Profiler`, so there is no
 * second source of truth for anything `__VM` already reports — CLAUDE.md is
 * explicit that surface may not be changed or duplicated.
 * ========================================================================== */

/** Filled in place, once per text update. Never re-created. */
export interface PerfReadout {
  /**
   * The frame's TOTAL draws, across every scene submission. A content
   * fingerprint — "was that the same scene?" — and never a budget figure.
   */
  drawCalls: number;
  /**
   * The COLOUR PASS alone, which is what `DRAW_BUDGET` bounds — or **null when
   * the live renderer cannot split the frame**, such as a WebGL boot with no
   * post chain to meter. The WebGPU path supplies an exact renderObject split.
   *
   * NULL IS NOT ZERO AND MUST NOT BECOME ZERO. `src/render/post.ts` reports the
   * node split as zeros with a true total precisely so that a consumer which
   * reads the buckets raw gets an obviously impossible answer rather than a
   * plausible wrong one; collapsing that to 0 here would hand the panel a
   * plausible wrong one after all.
   */
  drawCallsColour: number | null;
  triangles: number;
  /** Main colour-pass triangles, or null on a backend without a split. */
  trianglesColour: number | null;
  entities: number;
  /** Milliseconds of ONE fixed sim step. */
  simMs: number;
  substeps: number;
  /** The pipeline tier actually in use, not the one the player asked for. */
  tier: string;
  resolution: string;
  pixelRatio: number;
  /**
   * The backend that is ACTUALLY LIVE, read off the renderer — never
   * `requestedBackend()`, which is what the URL asked for. `webgl2-fallback`
   * is a third answer and not a synonym for either of the other two.
   *
   * Null until the seam has managed one read, so the header says `—` rather
   * than naming a renderer on no evidence.
   */
  backend: LiveBackend | null;
  /**
   * One line naming the GPU, already shortened for the row. See `shortDevice`.
   */
  device: string;
  /** CPU-side frame-system work; GPU draw cost is reported by the timer rows. */
  waterCpuMs: number;
  particlesCpuMs: number;
  uiCpuMs: number;
  /** Visible frame gaps retained for the whole match, not only the 240-frame ring. */
  longFrameCount: number;
  lastLongFrameGapMs: number;
  lastLongFrameCpuMs: number;
  worstLongFrameGapMs: number;
}

export function emptyReadout(): PerfReadout {
  return {
    drawCalls: 0,
    drawCallsColour: null,
    triangles: 0,
    trianglesColour: null,
    entities: 0,
    simMs: 0,
    substeps: 0,
    tier: '—',
    resolution: '—',
    pixelRatio: 1,
    backend: null,
    device: '—',
    waterCpuMs: 0,
    particlesCpuMs: 0,
    uiCpuMs: 0,
    longFrameCount: 0,
    lastLongFrameGapMs: 0,
    lastLongFrameCpuMs: 0,
    worstLongFrameGapMs: 0,
  };
}

export interface PerfSource {
  /**
   * The previous frame's full JS cost in milliseconds — sim, every system and
   * the submit. Read EVERY frame, so it must be a field read and nothing more.
   */
  cpuMs(): number;
  /** Fill `out`. Called `UPDATE_HZ` times a second, never per frame. */
  read(out: PerfReadout): void;
}

/* ==========================================================================
 * SECTION 6 — INERTNESS, ASSERTED
 * ========================================================================== */

const INTERACTIVE_TAGS = new Set([
  'A', 'AREA', 'BUTTON', 'DETAILS', 'EMBED', 'IFRAME', 'INPUT', 'LABEL',
  'OBJECT', 'SELECT', 'SUMMARY', 'TEXTAREA',
]);

/**
 * Every reason the overlay could capture a pointer. Empty means inert.
 *
 * Exported so the suite can walk the built tree. A diagnostic panel that
 * swallows a right-click during a fight is a catastrophic bug and a trivial one
 * to ship, so it is asserted rather than reviewed.
 */
export function perfLayerFaults(root: Element): string[] {
  const faults: string[] = [];
  const rootStyle = (root as HTMLElement).style as CSSStyleDeclaration | undefined;
  if (rootStyle?.pointerEvents !== 'none') {
    faults.push('root does not set pointer-events:none inline');
  }
  const walk = (node: Element): void => {
    const tag = node.tagName.toUpperCase();
    const dragHandle = node.getAttribute('data-perf-drag-handle') === 'true';
    const resizeHandle = node.getAttribute('data-perf-resize-handle') === 'true';
    const panelControl = dragHandle || resizeHandle;
    if (INTERACTIVE_TAGS.has(tag) && !panelControl) faults.push(`interactive element <${tag.toLowerCase()}>`);
    if (node.hasAttribute('tabindex') && !panelControl) faults.push(`tabindex on <${tag.toLowerCase()}>`);
    if (node.hasAttribute('onclick')) faults.push(`onclick on <${tag.toLowerCase()}>`);
    const style = (node as HTMLElement).style as CSSStyleDeclaration | undefined;
    const pe = style?.pointerEvents;
    if (pe !== undefined && pe !== '' && pe !== 'none' && !panelControl) {
      faults.push(`inline pointer-events:${pe} on <${tag.toLowerCase()}>`);
    }
    const kids = node.children;
    for (let i = 0; i < kids.length; i++) walk(kids[i]);
  };
  walk(root);
  return faults;
}

/* ==========================================================================
 * SECTION 7 — FORMATTING
 * ========================================================================== */

/** `1.75 M`, `284 k`, `912`. Triangle counts are unreadable in full. */
export function formatCount(n: number): string {
  const v = Math.max(0, Math.round(n));
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)} M`;
  if (v >= 1e4) return `${(v / 1e3).toFixed(0)} k`;
  return String(v);
}

/** Sub-millisecond costs read as microseconds; nobody parses `0.0004 ms`. */
export function formatSmallMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0 µs';
  return ms < 1 ? `${(ms * 1000).toFixed(0)} µs` : `${ms.toFixed(2)} ms`;
}

/* -- the unavailable case -------------------------------------------------- *
 * ONE TOKEN, SPELLED ONCE. Every row that cannot be measured on the live
 * backend prints this in the slot the number would have occupied, so "there is
 * no measurement here" is visually distinct from "the measurement is zero" and
 * a test can assert the difference without matching prose.                     */

/** What a row prints where a number it cannot measure would go. */
export const UNAVAILABLE = 'n/a';

/**
 * The live backend, for the header line.
 *
 * `webgl2-fallback` is spelled out rather than folded into either neighbour:
 * it is `WebGPURenderer` running node materials over WebGL2, a THIRD renderer,
 * measured the slowest of the three (`docs/RENDER_FINDINGS.md` §7b).
 * `assertBackend` refuses it at boot so it should be unreachable — which is
 * exactly why it must be legible if it ever appears.
 */
export function formatBackend(backend: LiveBackend | null): string {
  if (backend === null) return '—';
  return backend === 'webgl2-fallback' ? 'WEBGL2 FALLBACK' : backend.toUpperCase();
}

/**
 * The draws row: the colour pass against the budget, then the frame total.
 *
 * BOTH NUMBERS, BECAUSE THEY ANSWER DIFFERENT QUESTIONS and printing only one
 * of them is how this row came to be wrong. The first is the budget figure; the
 * second is the fingerprint `shots/_report.json` publishes. The shape is fixed,
 * so on a renderer that cannot split the frame `n/a` sits in the exact slot the
 * colour count occupies — never a `0`, which would read as a colour pass that
 * drew nothing at all. A null budget omits the ceiling while retaining both
 * measured counts; this is the WebGPU shape because 130 is WebGL-specific.
 */
export function formatDraws(
  total: number,
  colour: number | null,
  budget: number | null = DRAW_BUDGET,
): string {
  const head = colour === null ? UNAVAILABLE : String(colour);
  const ceiling = budget === null ? '' : ` / ${budget}`;
  return `${head} col${ceiling} · ${total} all`;
}

/**
 * Whether the draws row is over budget.
 *
 * FALSE WHENEVER THE SPLIT IS UNAVAILABLE, and that is not a hedge: with no
 * colour count there is no number to compare, and both alternatives are lies —
 * claiming a breach off the total means claiming one on every WebGL frame ever
 * captured (105-157 total against a 51-77 colour pass), and claiming compliance
 * asserts something nothing measured.
 */
export function drawsOverBudget(
  colour: number | null,
  budget: number | null = DRAW_BUDGET,
): boolean {
  return colour !== null && budget !== null && colour > budget;
}

/**
 * The GPU-time row.
 *
 * WebGL uses `EXT_disjoint_timer_query_webgl2`; WebGPU uses Three's
 * `timestamp-query` integration. Both arrive through `GpuTimerLike` and both
 * are real GPU clock measurements. An absent row still names the missing API
 * capability rather than turning absence into zero.
 */
export function formatGpuTime(
  status: GpuTimerStatus,
  ms: number | null,
  backend: LiveBackend | null,
): string {
  if (status === 'ok' && ms !== null) return `${ms.toFixed(1)} ms`;
  if (status === 'disjoint') return 'disjoint';
  if (status === 'waiting') return 'waiting';
  // `absent`. Null backend is the pre-boot case, where "no extension" is the
  // only thing actually known.
  if (backend === null || backend === 'webgl') return `${UNAVAILABLE} · no timer ext`;
  if (backend === 'webgpu') return `${UNAVAILABLE} · no timestamp-query`;
  return `${UNAVAILABLE} · not on ${backend}`;
}

/**
 * The GPU string, cut down to the part that fits a 150u row.
 *
 * A WebGPU adapter line comes from `describeAdapter` and is already short
 * (`NVIDIA GeForce RTX 3080 Laptop GPU (nvidia ampere)`), so it passes through.
 * The WebGL path's `WEBGL_debug_renderer_info` string is an ANGLE wrapper —
 *
 *     ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Laptop GPU Direct3D11 vs_5_0 ps_5_0, D3D11)
 *
 * — four times the width of the row, with the model in the middle field and a
 * shader-model tail that names no hardware. Truncation is left to CSS; this
 * removes the parts that are known not to be the answer, so what CSS truncates
 * is the end of a model name rather than the word "ANGLE".
 */
export function shortDevice(raw: string): string {
  const s = raw.trim();
  if (s === '') return '—';
  const angle = /^ANGLE \((.+)\)$/.exec(s);
  if (angle === null) return s;
  const parts = angle[1].split(', ');
  const model = (parts.length >= 2 ? parts[1] : parts[0]).trim();
  const trimmed = model
    .replace(/\s+Direct3D\d+.*$/i, '')
    .replace(/\s+\(0x[0-9A-Fa-f]+\)/g, '')
    .trim();
  return trimmed === '' ? s : trimmed;
}

/* ==========================================================================
 * SECTION 8 — THE PANEL
 * ========================================================================== */

export interface PerfHudOptions {
  /** Where it lives. The HUD root in practice, so it inherits `--vm-u`. */
  mount: HTMLElement;
  source: PerfSource;
  /** WebGL2 context for the GPU timer. Omit and the timer stays absent. */
  gl?: TimerQueryGl | null;
  /** API-neutral timer; supplied by the WebGPU path. Takes precedence over `gl`. */
  timer?: GpuTimerLike;
  /** Start visible. Default false — the setting is off by default. */
  visible?: boolean;
  /**
   * Monotonic clock. Injected so the suite can drive frames without a real
   * one; production passes `performance.now`, which is legal here because this
   * is the RENDER path — the determinism ban applies inside `simTick`.
   */
  now?: () => number;
}

/** One label/value line. Built once; only `value.nodeValue` is ever written. */
interface Row {
  value: Text;
  /** The string currently in the DOM, so an unchanged row costs no write. */
  last: string;
}

export class PerfHud {
  readonly root: HTMLElement;

  private readonly source: PerfSource;
  private readonly now: () => number;
  private readonly frames = new FrameRing(HISTORY_FRAMES);
  private readonly cpu = new FrameRing(HISTORY_FRAMES);
  private readonly readout: PerfReadout = emptyReadout();
  private readonly timer: GpuTimerLike;
  private readonly removePassTimer: () => void;

  private readonly primary: Text;
  private readonly fps: Text;
  /** The live backend, on the header line. See `formatBackend`. */
  private readonly backendText: Text;
  private readonly verdictText: Text;
  private readonly reasonText: Text;
  private readonly verdictNode: HTMLElement;
  private readonly drag: DraggablePanel;
  private readonly rows: Row[] = [];

  /** Reused every update. `classifyLoad` takes it; nothing keeps a reference. */
  private readonly sample: LoadSample = {
    samples: 0,
    frameMedianMs: 0,
    frameP95Ms: 0,
    cpuMedianMs: 0,
    gpuMs: null,
    cadenceMs: null,
    bestCadenceMs: null,
    missRatio: 0,
  };

  private visible: boolean;
  private lastFrameAt = 0;
  private sinceUpdate = 0;
  private bestCadenceMs: number | null = null;
  private lastVerdict: LoadVerdict | null = null;
  private verdictClass = '';
  private disposed = false;
  private profilingActive = false;

  /** Measured cost of one `frame()` call, in ms. Set by `calibrate()`. */
  private sampleCostMs = 0;
  /** Measured cost of the last text update, in ms. */
  private updateCostMs = 0;
  private calibrated = false;

  constructor(options: PerfHudOptions) {
    this.source = options.source;
    this.now = options.now ?? (() => performance.now());
    this.timer = options.timer ?? new GpuTimer(options.gl ?? null);
    this.removePassTimer =
      typeof this.timer.beginPass === 'function' && typeof this.timer.endPass === 'function' &&
      this.timer.passSnapshot !== undefined
        ? installGpuPassTimer(this.timer as GpuPassTimerSink)
        : () => {};

    this.root = el('div', 'vm-perf', options.mount);
    // Inline as well as in the stylesheet: if perf.css ever fails to load, the
    // panel must still be incapable of taking a click.
    this.root.style.pointerEvents = 'none';
    this.root.setAttribute('aria-hidden', 'true');

    const head = el('div', 'vm-perf-head', this.root);
    el('span', 'vm-perf-title', head).textContent = 'PERFORMANCE';
    // The header is `space-between`, so this lands at the right edge and costs
    // the panel no height. Which renderer produced the numbers below is a
    // property of the whole panel rather than of any one row.
    this.backendText = label(head, 'vm-perf-backend', '—');
    const resizeHandle = el('div', 'vm-perf-resize', this.root);
    this.drag = new DraggablePanel(
      this.root,
      head,
      PERFORMANCE_PANEL_POSITION_KEY,
      'Move performance panel',
      {
        resizeHandle,
        resizeLabel: 'Resize performance panel',
        minWidth: 180,
        minHeight: 140,
        maxWidthShare: 0.72,
        maxHeightShare: 0.9,
      },
    );

    const primaryRow = el('div', 'vm-perf-primary', this.root);
    this.primary = label(primaryRow, 'vm-perf-big vm-num', '—');
    el('span', 'vm-perf-unit', primaryRow).textContent = 'ms';
    this.fps = label(primaryRow, 'vm-perf-fps vm-num', '—');

    this.verdictNode = el('div', 'vm-perf-verdict', this.root);
    this.verdictText = label(this.verdictNode, 'vm-perf-state', 'SAMPLING');
    this.reasonText = label(this.verdictNode, 'vm-perf-reason', '');

    const rows = el('div', 'vm-perf-rows', this.root);
    this.addRow(rows, 'p95 / max');
    this.addRow(rows, 'cpu');
    this.addRow(rows, 'gpu');
    this.addRow(rows, 'draws');
    this.addRow(rows, 'tris');
    this.addRow(rows, 'tier');
    this.addRow(rows, 'device');
    this.addRow(rows, 'hitches');
    this.addRow(rows, 'gpu scene / sh');
    this.addRow(rows, 'gpu ao / gi / blm');
    this.addRow(rows, 'gpu grade / smaa / ui');
    this.addRow(rows, 'gpu water / fx');
    this.addRow(rows, 'cpu water / fx / ui');

    this.visible = options.visible ?? false;
    this.root.hidden = !this.visible;
    this.setProfilingActive(this.visible);
    this.applyMountFlag();
    if (this.visible) this.drag.restore();
  }

  /* -------------------------------------------------------------------- */
  /* public surface                                                        */
  /* -------------------------------------------------------------------- */

  get shown(): boolean {
    return this.visible;
  }

  /** Measured cost of one sampled frame, in ms. Zero until first shown. */
  get selfSampleMs(): number {
    return this.sampleCostMs;
  }

  /** Measured cost of one text update, in ms. */
  get selfUpdateMs(): number {
    return this.updateCostMs;
  }

  /** Average cost per rendered frame, amortising the 4 Hz text rewrite. */
  get selfAmortisedMs(): number {
    return this.sampleCostMs + this.updateCostMs * (UPDATE_HZ / 60);
  }

  /** The last computed verdict. Null until the first update. */
  get verdict(): LoadVerdict | null {
    return this.lastVerdict;
  }

  /** True when a GPU timer query is actually running. */
  get gpuTimerAvailable(): boolean {
    return this.timer.available;
  }

  setVisible(value: boolean): void {
    if (this.disposed || this.visible === value) return;
    this.visible = value;
    this.root.hidden = !value;
    this.setProfilingActive(value);
    this.applyMountFlag();
    if (!value) return;
    this.drag.restore();
    // A window collected before the panel was opened would describe a different
    // machine state; start clean and say "sampling" until it refills.
    this.frames.reset();
    this.cpu.reset();
    this.lastFrameAt = 0;
    this.sinceUpdate = 0;
    this.calibrate();
  }

  toggle(): void {
    this.setVisible(!this.visible);
  }

  /** Keep queries alive for either the visible instrument or adaptive quality. */
  setProfilingActive(value: boolean): void {
    if (this.disposed || this.profilingActive === value) return;
    this.profilingActive = value;
    this.timer.setActive?.(value);
  }

  /**
   * Once per rendered frame, from `ui/perf.system.ts`.
   *
   * THE HOT PATH. Two clock reads, two ring writes, and — only when a GPU timer
   * exists — the query rotation. No strings, no objects, no DOM, no layout.
   */
  frame(dt: number): void {
    if (this.disposed) return;
    // Pass timing also feeds adaptive quality while the panel is hidden.
    this.timer.tick();
    if (!this.visible) return;

    const t = this.now();
    if (this.lastFrameAt > 0) this.frames.push(t - this.lastFrameAt);
    this.lastFrameAt = t;
    this.cpu.push(this.source.cpuMs());
    this.sinceUpdate += dt;
    if (this.sinceUpdate < 1 / UPDATE_HZ) return;
    this.sinceUpdate = 0;
    this.update();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.removePassTimer();
    this.timer.dispose();
    this.drag.dispose();
    this.visible = false;
    this.applyMountFlag();
    this.root.remove();
  }

  /* -------------------------------------------------------------------- */
  /* internals                                                             */
  /* -------------------------------------------------------------------- */

  private addRow(parent: HTMLElement, name: string): void {
    const line = el('div', 'vm-perf-row', parent);
    el('span', 'vm-perf-k', line).textContent = name;
    this.rows.push({ value: label(line, 'vm-perf-v vm-num', '—'), last: '—' });
  }

  /** Write a row only when it actually changed. Skips a needless layout. */
  private write(index: number, text: string): void {
    const row = this.rows[index];
    if (row === undefined || row.last === text) return;
    row.last = text;
    row.value.nodeValue = text;
  }

  /**
   * Time the hot path against a stopwatch, once, on first show.
   *
   * Ten thousand calls of the real sample path, divided out. It costs about a
   * millisecond, it happens on a frame the player just spent opening a panel,
   * and it is the only way the `self` row can be a measurement instead of a
   * hope. The rings are reset afterwards so the calibration burst never lands
   * in the window the panel reports.
   */
  private calibrate(): void {
    if (this.calibrated) return;
    this.calibrated = true;
    const N = 10_000;
    const t0 = this.now();
    for (let i = 0; i < N; i++) {
      this.frames.push(16.7);
      this.cpu.push(4.2);
    }
    const t1 = this.now();
    // The loop above does not perform the clock read the real hot path makes,
    // so it is measured separately and added rather than assumed to be free.
    this.sampleCostMs = (t1 - t0) / N + this.clockCostMs();
    this.frames.reset();
    this.cpu.reset();
  }

  /** Cost of the one `now()` read the hot path makes, measured the same way. */
  private clockCostMs(): number {
    const N = 2000;
    const t0 = this.now();
    let sink = 0;
    for (let i = 0; i < N; i++) sink += this.now();
    const t1 = this.now();
    // `sink` is read so the loop cannot be optimised away as dead.
    return sink === 0 ? 0 : (t1 - t0) / N;
  }

  /** The 4 Hz path. Allocates the strings it prints and nothing else. */
  private update(): void {
    const t0 = this.now();

    const frames = this.frames;
    const cpu = this.cpu;
    frames.snapshot();
    cpu.snapshot();

    const cadence = detectCadenceMs(frames);
    if (cadence !== null && (this.bestCadenceMs === null || cadence < this.bestCadenceMs)) {
      this.bestCadenceMs = cadence;
    }

    const s = this.sample;
    s.samples = frames.count;
    s.frameMedianMs = frames.median;
    s.frameP95Ms = frames.quantile(0.95);
    s.cpuMedianMs = cpu.median;
    s.gpuMs = this.timer.gpuMs;
    s.cadenceMs = cadence;
    s.bestCadenceMs = this.bestCadenceMs;
    s.missRatio = cadence === null ? 0 : frames.shareAbove(cadence * TAIL_SATURATION_FACTOR);

    const verdict = classifyLoad(s);
    this.lastVerdict = verdict;

    this.source.read(this.readout);
    const r = this.readout;

    /* -- the two headline numbers -------------------------------------- */
    const med = s.frameMedianMs;
    this.primary.nodeValue = med > 0 ? med.toFixed(1) : '—';
    this.fps.nodeValue = med > 0 ? `${Math.round(1000 / med)} fps` : '—';

    if (this.verdictText.nodeValue !== verdict.label) this.verdictText.nodeValue = verdict.label;
    if (this.reasonText.nodeValue !== verdict.reason) this.reasonText.nodeValue = verdict.reason;
    const cls = `vm-perf-verdict is-${verdict.severity}`;
    if (cls !== this.verdictClass) {
      this.verdictClass = cls;
      this.verdictNode.className = cls;
    }

    /* -- the rows ------------------------------------------------------- */
    this.write(0, `${s.frameP95Ms.toFixed(1)} / ${frames.max.toFixed(1)} ms`);

    const simTotal = r.simMs * Math.max(1, r.substeps);
    const gfx = Math.max(0, s.cpuMedianMs - simTotal);
    this.write(1, `${s.cpuMedianMs.toFixed(1)} — sim ${simTotal.toFixed(1)} gfx ${gfx.toFixed(1)}`);

    this.write(2, formatGpuTime(this.timer.status, s.gpuMs, r.backend));

    const drawBudget = drawBudgetForBackend(r.backend);
    this.write(3, formatDraws(r.drawCalls, r.drawCallsColour, drawBudget));
    this.write(4, r.trianglesColour === null
      ? formatCount(r.triangles)
      : `${formatCount(r.trianglesColour)} col · ${formatCount(r.triangles)} all`);
    this.write(5, `${r.tier} · ${r.entities} ents`);
    this.write(6, r.device);
    this.write(7, r.longFrameCount === 0
      ? '0'
      : `${r.longFrameCount} · last ${r.lastLongFrameGapMs.toFixed(0)} wall / ` +
        `${r.lastLongFrameCpuMs.toFixed(0)} cpu · worst ${r.worstLongFrameGapMs.toFixed(0)} ms`);

    const pass = this.timer.passSnapshot?.values;
    const passMs = (id: GpuPassId): string => {
      const value = pass?.[gpuPassIndex(id)] ?? null;
      return value === null ? UNAVAILABLE : value.toFixed(value < 10 ? 2 : 1);
    };
    this.write(8, `${passMs('scene')} / ${passMs('shadow')} ms`);
    this.write(9, `${passMs('ao')} / ${passMs('gi')} / ${passMs('bloom')} ms`);
    this.write(10, `${passMs('grade')} / ${passMs('smaa')} / ${passMs('ui')} ms`);
    this.write(11, `${passMs('water')} / ${passMs('particles')} ms`);
    this.write(
      12,
      `${formatSmallMs(r.waterCpuMs)} / ${formatSmallMs(r.particlesCpuMs)} / ${formatSmallMs(r.uiCpuMs)}`,
    );

    const badge = formatBackend(r.backend);
    if (this.backendText.nodeValue !== badge) this.backendText.nodeValue = badge;

    /*
     * OFF THE COLOUR PASS, NOT THE TOTAL. This used to be `r.drawCalls > 130`,
     * which is 105-157 against 130 on every WebGL frame in the capture set —
     * the row was permanently red about a colour pass of 51-77. The unknown
     * state gets its own class rather than borrowing either verdict: a panel
     * that cannot check the budget must not look like one that checked it and
     * approved.
     */
    this.root.classList.toggle('is-draws-over', drawsOverBudget(r.drawCallsColour, drawBudget));
    this.root.classList.toggle('is-draws-unknown', r.drawCallsColour === null);
    // Match the draw-call ruling above: advisory geometry is the gameplay
    // colour pass when the backend can split it. Shadow/AO resubmissions still
    // remain visible in the `all` readout, but cannot turn the row red as if
    // they were extra scene detail.
    const advisoryTriangles = r.trianglesColour ?? r.triangles;
    this.root.classList.toggle('is-tris-over', advisoryTriangles > TRIANGLE_ADVISORY);

    this.updateCostMs = this.now() - t0;
  }

  /**
   * Tell the HUD the overlay is up.
   *
   * The event toasts live in the same corner (`.vm-toasts`, hud.css §10) and
   * `src/ui/hud.css` belongs to another workflow. The class goes on the mount
   * and `perf.css` moves the toast stack down below the panel while — and only
   * while — the panel is actually on screen. Nothing in hud.css is edited and
   * nothing moves when the overlay is off, which is the shipping default.
   */
  private applyMountFlag(): void {
    const parent = this.root.parentElement;
    if (parent === null) return;
    parent.classList.toggle('vm-perf-on', this.visible && !this.disposed);
  }
}
