/**
 * ============================================================================
 * VOLTMARCH — src/render/RepaintGuard.ts
 * ============================================================================
 * "NEVER PRESENT A DRAWING BUFFER NOBODY HAS DRAWN INTO."
 *
 * THE DEFECT THIS EXISTS FOR
 * --------------------------
 * Reported twice: "black overlays that show for a millisecond and disappear,
 * like a flashing black overlay", on macOS. Marked fixed once — the fix then
 * was the backdrop-filter gate in `renderer.ts`, which is a real and separate
 * problem — and it came back.
 *
 * The mechanism, MEASURED on Windows/ANGLE rather than assumed (see
 * `tests/resize-repaint.spec.ts` for the pure half of it):
 *
 *   Resizing the canvas REALLOCATES the drawing buffer. The replacement is
 *   zero-filled, and with `alpha: false` that is opaque black; `doResize` paints
 *   the sky colour into it, so the best case is a flat sky-coloured rectangle
 *   and the worst case — a compositor that has not been handed the new-size
 *   texture yet — is black. Either way it is not the game.
 *
 *   Nothing guaranteed a draw between that reallocation and the next present.
 *   `src/main.ts` debounces window `resize` and DPR changes into a
 *   `requestAnimationFrame`, and `GameHandle.resize()` calls `handle.resize(true)`
 *   — a FORCED resize, which never early-outs. That callback is registered while
 *   the game loop's own next-frame callback is ALREADY in the queue, so it runs
 *   AFTER the loop has drawn the frame, throws the finished image away, and the
 *   compositor presents the flat replacement.
 *
 *   Driving exactly that ordering in a real browser: 10 forced resizes issued
 *   from a rAF registered after the loop's produced 10 presented frames whose
 *   every single pixel was the clear colour. Not "1 in N" — every one.
 *
 * On a Retina MacBook a fullscreen toggle or a display change animates the
 * window size, firing `resize` on nearly every frame for the length of the
 * animation. That is a run of flat frames, which is what "flashing" means.
 *
 * THE GUARANTEE
 * -------------
 * The buffer is INVALIDATED when it is reallocated, and a repaint is scheduled
 * on the microtask queue. A microtask queued from inside a rAF callback (or any
 * task) runs before the browser's paint step, so the repaint lands in the SAME
 * animation frame — there is no window in which the flat buffer can reach the
 * screen.
 *
 * WHY IT IS ALMOST ALWAYS FREE
 * ----------------------------
 * `frameStarting()` is called by `RendererHandle.beginFrame()`, i.e. at the top
 * of a complete frame that is about to be drawn into the current buffer. That
 * cancels the pending repaint. So the common case — the adaptive-resolution
 * controller changing scale at `RenderPhase.Present`, BEFORE the host draws —
 * costs nothing at all, and only a resize that arrives after the draw pays for a
 * second one. `coalesced` counts the free ones and `repaints` the paid ones, so
 * "is this costing us frames?" is a number rather than an argument.
 *
 * It is a separate file with no renderer import for the usual reason: it takes a
 * scheduler and a callback, so a test drives it with a synthetic queue and no GL
 * context.
 * ============================================================================
 */

/** Defers a function to before the next paint. Injected so tests can drive it. */
export type RepaintScheduler = (fn: () => void) => void;

/**
 * Microtask, not `requestAnimationFrame`.
 *
 * rAF would schedule the repaint for the NEXT animation frame, which is one
 * presented flat frame too late — that is the bug. A microtask checkpoint runs
 * as soon as the current callback's stack empties and always before the
 * rendering steps, so the repaint is in the same frame as the resize.
 */
export const defaultRepaintScheduler: RepaintScheduler =
  typeof queueMicrotask === 'function'
    ? (fn) => queueMicrotask(fn)
    : (fn) => { void Promise.resolve().then(fn); };

export class RepaintGuard {
  private needed = false;
  private queued = false;
  private running = false;
  private painter: (() => void) | null = null;

  /** Repaints actually issued — the ones that cost a frame. */
  repaints = 0;
  /**
   * Invalidations cancelled by a frame that was going to draw anyway. The
   * adaptive-resolution path lands here, which is why it is free.
   */
  coalesced = 0;
  /** Invalidations dropped because no painter was registered (boot, teardown). */
  unpainted = 0;

  constructor(private readonly schedule: RepaintScheduler = defaultRepaintScheduler) {}

  /**
   * Register the "draw one complete frame into the current buffer, now" hook.
   * Null while nothing can draw — during boot, and after teardown.
   */
  setPainter(fn: (() => void) | null): void {
    this.painter = fn;
  }

  get hasPainter(): boolean { return this.painter !== null; }
  /** True while a reallocated buffer is still undrawn. */
  get pending(): boolean { return this.needed; }

  /** The drawing buffer was just reallocated and holds nothing real. */
  invalidate(): void {
    this.needed = true;
    if (this.queued) return;
    this.queued = true;
    this.schedule(() => { this.flush(); });
  }

  /**
   * A complete frame is about to be drawn into the current buffer, so any
   * pending repaint is redundant. Called from `RendererHandle.beginFrame()`.
   */
  frameStarting(): void {
    if (!this.needed) return;
    this.needed = false;
    this.coalesced++;
  }

  /**
   * Draw now if the buffer is still undrawn. Idempotent, re-entrancy safe, and
   * it never throws: a painter that fails must not take the resize with it.
   */
  flush(): void {
    this.queued = false;
    if (!this.needed) return;
    this.needed = false;
    const fn = this.painter;
    if (fn === null) { this.unpainted++; return; }
    if (this.running) return;
    this.running = true;
    try {
      fn();
      this.repaints++;
    } catch (err) {
      console.error('[render] repaint after resize failed', err);
    } finally {
      this.running = false;
    }
  }

  dispose(): void {
    this.painter = null;
    this.needed = false;
  }
}
