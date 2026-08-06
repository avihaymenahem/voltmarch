/**
 * ============================================================================
 * VOLTMARCH — src/render/AdaptiveResolution.ts
 * ============================================================================
 * DYNAMIC RESOLUTION SCALING. The controller only; `adaptive-res.system.ts`
 * owns the wiring.
 *
 * WHY
 * ---
 * Reported: "does it makes sense that im getting only 17 fps?" It does. This
 * machine was profiled at **77.9 ms median at native 2560x1440, GPU-bound**,
 * 203 draw calls against a <130 budget. 77.9 ms is 13 fps. Nothing was wrong
 * with the reading.
 *
 * The renderer has always been able to fix this: `resolutionScale` exists,
 * `RendererHandle.setResolutionScale` exists, and the quality tiers already use
 * it (low 0.75, medium 0.9, high 1.0, ultra 1.0). What did not exist was
 * anything that MEASURES. The tier is chosen once at boot from a static GPU
 * classification, so an optimistic guess leaves the player at 17 fps forever
 * with a working lever nobody pulls.
 *
 * This is the same trade DLSS, FSR and TSR make — render fewer pixels, keep the
 * frame rate — minus the temporal reconstruction. It is the largest single
 * performance lever available to this project and it had never been tried.
 *
 * WHY IT MOVES SLOWLY, WHICH IS THE WHOLE DESIGN
 * ----------------------------------------------
 * Changing the scale calls `doResize(true)`, and `renderer.ts` documents what
 * that costs:
 *
 *   > Resizing the canvas REALLOCATES the drawing buffer, and a fresh drawing
 *   > buffer is zero-filled — opaque black... on a Retina MacBook a fullscreen
 *   > toggle or a display change fires this path several times in a row.
 *
 * This block used to call that "the black-flash bug the reporter confirmed fixed
 * earlier today". IT WAS NOT FIXED — it was reported again, and the fix credited
 * here was the backdrop-filter gate, which addresses a different and also real
 * problem. What actually presents a flat frame is a reallocation with no draw
 * after it, and that is now prevented at the source by
 * `src/render/RepaintGuard.ts`: this controller applies its decision at
 * `RenderPhase.Present`, before the host draws, so the frame it resizes is
 * redrawn in the same task and costs nothing extra.
 *
 * The guarantee makes a resize SAFE. It does not make one CHEAP — a reallocation
 * still throws away every composer target — so every reason below to move slowly
 * stands unchanged:
 *
 *   - decisions are made from a MEDIAN over a long window, never one frame;
 *   - there is a dead zone, so a frame time near target changes nothing;
 *   - there is a cooldown after every change;
 *   - going DOWN in quality is quicker than coming back up, because the cost of
 *     being too slow is felt continuously and the cost of being slightly too
 *     soft is not;
 *   - steps are coarse and bounded.
 *
 * Median and not mean: one 300 ms hitch from a shader compile or a GC must not
 * drop the whole game a resolution step. `p95` is the right tool for reporting
 * and the wrong one for steering.
 *
 * WHAT IT WILL NOT DO
 * -------------------
 * It never exceeds the ceiling the quality tier chose, so it cannot quietly
 * undo a deliberate setting — it only ever reclaims frame time below it. It is
 * disabled outright for fixed-size offscreen renders, because the screenshot
 * harness demands one drawing-buffer pixel per requested pixel and a scaled
 * capture would silently corrupt the visual scorecard.
 * ============================================================================
 */

/** Frame-time samples kept for the rolling median. ~2 s at 60 fps. */
export const ADAPTIVE_WINDOW = 120;

/** Tunables, exported so a test can assert against the same numbers. */
export const ADAPTIVE = {
  /** Target frame time in ms. 16.7 = 60 fps. */
  targetMs: 16.7,
  /**
   * Fraction of target that counts as "close enough".
   *
   * Wide on purpose. A controller that chases the last 5% resizes constantly,
   * and every resize reallocates the drawing buffer.
   */
  deadZone: 0.18,
  /** Never render below this fraction of native. Past it, the image mushes. */
  minScale: 0.55,
  /** One adjustment, up or down. Coarse so changes are few. */
  step: 0.075,
  /** Seconds between adjustments, so a change is judged before the next. */
  cooldownSec: 2.5,
  /** Consecutive windows over budget before the FIRST cut. */
  patienceDown: 1,
  /**
   * Consecutive windows under budget before giving resolution back.
   *
   * Deliberately higher than `patienceDown`: dropping is felt immediately and
   * recovering is not, so the controller should be quick to help and slow to
   * risk. It also stops a scene that is briefly cheap — a camera pointed at
   * empty ground — from pumping the resolution back and forth.
   */
  patienceUp: 3,
} as const;

/** What the controller decided this frame. */
export interface AdaptiveDecision {
  /** New scale to apply, or null to leave it alone. */
  scale: number | null;
  /** Median frame time over the window, or 0 before the window fills. */
  medianMs: number;
}

/**
 * A rolling-median frame-time controller.
 *
 * Deliberately free of any renderer import: it takes numbers and returns a
 * number, so a test can drive it with a synthetic clock and no GL context.
 */
export class AdaptiveResolution {
  private readonly samples = new Float32Array(ADAPTIVE_WINDOW);
  /** Scratch for the median, so a decision allocates nothing. */
  private readonly sorted = new Float32Array(ADAPTIVE_WINDOW);
  private filled = 0;
  private next = 0;
  private sinceChange = 0;
  private overRuns = 0;
  private underRuns = 0;

  /** Current scale, and the tier's ceiling. */
  private scale: number;
  private readonly ceiling: number;

  constructor(startScale: number) {
    this.scale = startScale;
    this.ceiling = startScale;
  }

  /** The scale the controller currently wants. */
  get current(): number { return this.scale; }
  /** Highest scale it may ever ask for — whatever the quality tier chose. */
  get maxScale(): number { return this.ceiling; }

  /**
   * Feed one rendered frame. Returns the new scale when it wants a change.
   *
   * @param frameMs wall-clock milliseconds for the frame just presented.
   * @param dtSec   the same interval in seconds, for the cooldown.
   */
  sample(frameMs: number, dtSec: number): AdaptiveDecision {
    // A tab restored from background, a breakpoint, or a first frame after a
    // shader compile produces an interval that describes nothing about the
    // scene. Feeding it in would drop the resolution for no reason.
    if (Number.isFinite(frameMs) && frameMs > 0 && frameMs < 1000) {
      this.samples[this.next] = frameMs;
      this.next = (this.next + 1) % ADAPTIVE_WINDOW;
      if (this.filled < ADAPTIVE_WINDOW) this.filled++;
    }
    this.sinceChange += dtSec;

    if (this.filled < ADAPTIVE_WINDOW) return { scale: null, medianMs: 0 };

    const medianMs = this.median();
    if (this.sinceChange < ADAPTIVE.cooldownSec) return { scale: null, medianMs };

    const high = ADAPTIVE.targetMs * (1 + ADAPTIVE.deadZone);
    const low = ADAPTIVE.targetMs * (1 - ADAPTIVE.deadZone);

    if (medianMs > high) {
      this.underRuns = 0;
      this.overRuns++;
      if (this.overRuns >= ADAPTIVE.patienceDown && this.scale > ADAPTIVE.minScale) {
        return this.commit(Math.max(ADAPTIVE.minScale, this.scale - ADAPTIVE.step), medianMs);
      }
      return { scale: null, medianMs };
    }

    if (medianMs < low) {
      this.overRuns = 0;
      this.underRuns++;
      if (this.underRuns >= ADAPTIVE.patienceUp && this.scale < this.ceiling) {
        return this.commit(Math.min(this.ceiling, this.scale + ADAPTIVE.step), medianMs);
      }
      return { scale: null, medianMs };
    }

    // Inside the dead zone: this is the steady state and it must be sticky.
    this.overRuns = 0;
    this.underRuns = 0;
    return { scale: null, medianMs };
  }

  private commit(next: number, medianMs: number): AdaptiveDecision {
    if (Math.abs(next - this.scale) < 1e-4) return { scale: null, medianMs };
    this.scale = next;
    this.sinceChange = 0;
    this.overRuns = 0;
    this.underRuns = 0;
    // Clear the window. The samples describe the OLD resolution and would drag
    // the next decision toward a frame cost that no longer exists.
    this.filled = 0;
    this.next = 0;
    return { scale: next, medianMs };
  }

  /** Median of the window. Allocation-free; sorts into a reused buffer. */
  private median(): number {
    const n = this.filled;
    this.sorted.set(this.samples.subarray(0, n));
    const view = this.sorted.subarray(0, n);
    view.sort();
    return n % 2 === 1 ? view[(n - 1) >> 1] : (view[n / 2 - 1] + view[n / 2]) * 0.5;
  }

  /** Forget history — after a match change, a resize, or a tier change. */
  reset(scale: number): void {
    this.scale = Math.min(scale, this.ceiling);
    this.filled = 0;
    this.next = 0;
    this.sinceChange = 0;
    this.overRuns = 0;
    this.underRuns = 0;
  }
}
