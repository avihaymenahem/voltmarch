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
 * `EXT_disjoint_timer_query_webgl2` is the only way from inside a browser to
 * measure GPU time directly, and Chrome ships it disabled on most platforms for
 * timing-attack reasons. When it is absent the best available answer is
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
 * ============================================================================
 */

import { el, label } from './Chrome';

import './perf.css';

/* ==========================================================================
 * SECTION 1 — BUDGETS AND THRESHOLDS
 *
 * Every number here is either documented in CLAUDE.md or derived from the two
 * measurements in the header. Nothing is a feeling.
 * ========================================================================== */

/** Draw-call ceiling. CLAUDE.md: "under 130 draw calls". Live matches: 194-203. */
export const DRAW_BUDGET = 130;

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
/** p95/min, cpu, gpu, draws, tris, tier, self. */
export const PERF_ROW_COUNT = 7;

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

/** Queries in flight. Three is enough for a driver that lags two frames. */
const TIMER_POOL = 3;

export class GpuTimer {
  /** Milliseconds of the most recently resolved frame, or null. */
  private lastMs: number | null = null;
  private readonly ext: TimerExt | null = null;
  private readonly queries: object[] = [];
  /** Indices of ended-but-unresolved queries, oldest first. Fixed length. */
  private readonly pending: Int32Array = new Int32Array(TIMER_POOL);
  private pendingCount = 0;
  private open = -1;
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
    return this.ext === null ? null : this.lastMs;
  }

  /** Why the readout is empty, for the panel's own row. */
  get status(): string {
    if (this.ext === null) return 'n/a';
    if (this.disjointSeen) return 'disjoint';
    return this.lastMs === null ? 'waiting' : '';
  }

  /**
   * Once per frame, before the frame's GL work. Closes the previous frame's
   * query, harvests whatever the driver has finished, and opens the next.
   * Allocates nothing.
   */
  tick(): void {
    const gl = this.gl;
    const ext = this.ext;
    if (gl === null || ext === null) return;

    if (this.open >= 0) {
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      if (this.pendingCount < TIMER_POOL) this.pending[this.pendingCount++] = this.open;
      this.open = -1;
    }

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
      this.lastMs = null;
      this.disjointSeen = true;
    } else if (this.pendingCount > 0) {
      const idx = this.pending[0];
      const q = this.queries[idx];
      let ready = false;
      try {
        ready = gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE) === true;
      } catch {
        ready = false;
      }
      if (ready) {
        let ns = 0;
        try {
          const raw = gl.getQueryParameter(q, gl.QUERY_RESULT);
          ns = typeof raw === 'number' ? raw : 0;
        } catch {
          ns = 0;
        }
        this.lastMs = ns / 1e6;
        this.disjointSeen = false;
        for (let i = 1; i < this.pendingCount; i++) this.pending[i - 1] = this.pending[i];
        this.pendingCount--;
      }
    }

    // Open the next one on a query that is not waiting for a result.
    for (let i = 0; i < this.queries.length; i++) {
      let busy = false;
      for (let p = 0; p < this.pendingCount; p++) if (this.pending[p] === i) busy = true;
      if (busy) continue;
      try {
        gl.beginQuery(ext.TIME_ELAPSED_EXT, this.queries[i]);
        this.open = i;
      } catch {
        this.open = -1;
      }
      return;
    }
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
  drawCalls: number;
  triangles: number;
  entities: number;
  /** Milliseconds of ONE fixed sim step. */
  simMs: number;
  substeps: number;
  /** The pipeline tier actually in use, not the one the player asked for. */
  tier: string;
  resolution: string;
  pixelRatio: number;
}

export function emptyReadout(): PerfReadout {
  return {
    drawCalls: 0,
    triangles: 0,
    entities: 0,
    simMs: 0,
    substeps: 0,
    tier: '—',
    resolution: '—',
    pixelRatio: 1,
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
    if (INTERACTIVE_TAGS.has(tag)) faults.push(`interactive element <${tag.toLowerCase()}>`);
    if (node.hasAttribute('tabindex')) faults.push(`tabindex on <${tag.toLowerCase()}>`);
    if (node.hasAttribute('onclick')) faults.push(`onclick on <${tag.toLowerCase()}>`);
    const style = (node as HTMLElement).style as CSSStyleDeclaration | undefined;
    const pe = style?.pointerEvents;
    if (pe !== undefined && pe !== '' && pe !== 'none') {
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

/* ==========================================================================
 * SECTION 8 — THE PANEL
 * ========================================================================== */

export interface PerfHudOptions {
  /** Where it lives. The HUD root in practice, so it inherits `--vm-u`. */
  mount: HTMLElement;
  source: PerfSource;
  /** WebGL2 context for the GPU timer. Omit and the timer stays absent. */
  gl?: TimerQueryGl | null;
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
  private readonly timer: GpuTimer;

  private readonly primary: Text;
  private readonly fps: Text;
  private readonly verdictText: Text;
  private readonly reasonText: Text;
  private readonly verdictNode: HTMLElement;
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

  /** Measured cost of one `frame()` call, in ms. Set by `calibrate()`. */
  private sampleCostMs = 0;
  /** Measured cost of the last text update, in ms. */
  private updateCostMs = 0;
  private calibrated = false;

  constructor(options: PerfHudOptions) {
    this.source = options.source;
    this.now = options.now ?? (() => performance.now());
    this.timer = new GpuTimer(options.gl ?? null);

    this.root = el('div', 'vm-perf', options.mount);
    // Inline as well as in the stylesheet: if perf.css ever fails to load, the
    // panel must still be incapable of taking a click.
    this.root.style.pointerEvents = 'none';
    this.root.setAttribute('aria-hidden', 'true');

    const head = el('div', 'vm-perf-head', this.root);
    el('span', 'vm-perf-title', head).textContent = 'PERFORMANCE';

    const primaryRow = el('div', 'vm-perf-primary', this.root);
    this.primary = label(primaryRow, 'vm-perf-big vm-num', '—');
    el('span', 'vm-perf-unit', primaryRow).textContent = 'ms';
    this.fps = label(primaryRow, 'vm-perf-fps vm-num', '—');

    this.verdictNode = el('div', 'vm-perf-verdict', this.root);
    this.verdictText = label(this.verdictNode, 'vm-perf-state', 'SAMPLING');
    this.reasonText = label(this.verdictNode, 'vm-perf-reason', '');

    const rows = el('div', 'vm-perf-rows', this.root);
    this.addRow(rows, 'p95 / min');
    this.addRow(rows, 'cpu');
    this.addRow(rows, 'gpu');
    this.addRow(rows, 'draws');
    this.addRow(rows, 'tris');
    this.addRow(rows, 'tier');
    this.addRow(rows, 'self');

    this.visible = options.visible ?? false;
    this.root.hidden = !this.visible;
    this.applyMountFlag();
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
    this.applyMountFlag();
    if (!value) return;
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

  /**
   * Once per rendered frame, from `ui/perf.system.ts`.
   *
   * THE HOT PATH. Two clock reads, two ring writes, and — only when a GPU timer
   * exists — the query rotation. No strings, no objects, no DOM, no layout.
   */
  frame(dt: number): void {
    if (!this.visible || this.disposed) return;

    const t = this.now();
    if (this.lastFrameAt > 0) this.frames.push(t - this.lastFrameAt);
    this.lastFrameAt = t;
    this.cpu.push(this.source.cpuMs());
    this.timer.tick();

    this.sinceUpdate += dt;
    if (this.sinceUpdate < 1 / UPDATE_HZ) return;
    this.sinceUpdate = 0;
    this.update();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.timer.dispose();
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
    this.write(0, `${s.frameP95Ms.toFixed(1)} / ${frames.min.toFixed(1)} ms`);

    const simTotal = r.simMs * Math.max(1, r.substeps);
    const gfx = Math.max(0, s.cpuMedianMs - simTotal);
    this.write(1, `${s.cpuMedianMs.toFixed(1)} — sim ${simTotal.toFixed(1)} gfx ${gfx.toFixed(1)}`);

    const gpuStatus = this.timer.status;
    this.write(2, gpuStatus === '' && s.gpuMs !== null ? `${s.gpuMs.toFixed(1)} ms` : gpuStatus);

    this.write(3, `${r.drawCalls} / ${DRAW_BUDGET}`);
    this.write(4, formatCount(r.triangles));
    this.write(5, `${r.tier} · ${r.entities} ents`);
    this.write(
      6,
      `${formatSmallMs(this.sampleCostMs)}/f · ${formatSmallMs(this.updateCostMs)}/upd`,
    );

    this.root.classList.toggle('is-draws-over', r.drawCalls > DRAW_BUDGET);
    this.root.classList.toggle('is-tris-over', r.triangles > TRIANGLE_ADVISORY);

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
