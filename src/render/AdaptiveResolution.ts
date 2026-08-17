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
 * It never exceeds its CEILING — it only ever reclaims frame time below it. It
 * is disabled outright for fixed-size offscreen renders, because the screenshot
 * harness demands one drawing-buffer pixel per requested pixel and a scaled
 * capture would silently corrupt the visual scorecard.
 *
 * THE CEILING IS NOT FROZEN, AND THIS BLOCK USED TO PROMISE THE OPPOSITE
 * ---------------------------------------------------------------------
 * It said "it never exceeds the ceiling the quality tier chose, so it cannot
 * quietly undo a deliberate setting". The first clause was true and the second
 * did not follow from it — in fact it was precisely backwards, because the
 * Resolution Scale slider IS a deliberate setting and this controller quietly
 * undid it. `ceiling` was `readonly`, captured once at boot from the tier, so a
 * player who set 150% had it applied, then cut to tier-minus-one-step on the
 * next over-budget window, then permanently re-clamped to the tier value by
 * `scale < ceiling`. Supersampling — the one real answer to aliasing this
 * renderer already supports — was unreachable, and it looked like the slider
 * did nothing.
 *
 * `setCeiling` fixes that, and `adaptive-res.system.ts` calls it whenever it
 * observes a scale on the handle that it did not itself command. So the rule is
 * now what the old comment claimed: a deliberate choice wins, and the controller
 * reclaims only what is below it.
 *
 * THE RESTORE THRESHOLD, AND WHY IT IS NOT THE MIRROR OF THE CUT THRESHOLD
 * -----------------------------------------------------------------------
 * It used to be. Cutting needed `median > targetMs * 1.18` (19.7 ms) and
 * restoring needed `median < targetMs * 0.82` — **13.69 ms**. That second
 * number is below the 16.67 ms vsync interval of a 60 Hz display, so on the
 * commonest display in the world the restore branch could not be reached, ever,
 * by any scene. THE CONTROLLER WAS A ONE-WAY RATCHET: one heavy moment — a
 * battle, a shader-compile storm, an alt-tab — walked the resolution down and
 * nothing walked it back, for the rest of the session, while the Settings
 * screen went on reporting the slider's 100%.
 *
 * Measured on an AMD iGPU through ANGLE/D3D11, a real match at a 3840x2160
 * drawing buffer. The controller cut correctly, five steps, 1.0 -> 0.55, and
 * the 90th-percentile frame came down 253.1 ms -> 25.9 ms doing it. Then the
 * load was cut to a QUARTER of the pixels (`maxPixelRatio` 2 -> 1), leaving the
 * frame vsync-locked with enormous headroom — p10 15.5 ms, median 16.6 ms,
 * p90 17.8 ms — and it was watched for 121 more seconds:
 *
 *     scale 0.55, changes 5 ... unchanged, every sample, for the whole watch
 *
 * So the fix is that RESTORING NO LONGER NEEDS PROOF OF HEADROOM, because under
 * vsync there is no way to observe any. It needs only the absence of a
 * violation: `patienceUp` consecutive windows NOT over budget. That is a probe,
 * and a probe can be wrong, so a step up that gets cut straight back doubles
 * `patienceUp` (see `probing`) up to `patienceUpMax`. A machine with real
 * headroom climbs back to its ceiling; a machine sitting exactly on the edge
 * backs off to trying about once a minute rather than sawing every few seconds.
 *
 * The dead zone is therefore ONE-SIDED on purpose. Do not "restore the
 * symmetry" — the asymmetry is the finding.
 * ============================================================================
 */

/**
 * HARD CAP on the samples in one window. A window normally closes long before
 * this — see `windowMinSamples`/`windowSec` — and this only bounds the buffer.
 *
 * IT USED TO BE THE ONLY BOUND, AND THAT MADE THE CONTROLLER SLOWEST EXACTLY
 * WHERE IT WAS NEEDED MOST. 120 frames is 2 s at 60 fps and **9.4 s at the
 * reporter's measured 13 fps**; `commit` clears the window, so every further
 * step cost another 120 frames. Walking 1.0 -> 0.55 is six steps, so the
 * machine that prompted this whole feature would have spent roughly forty
 * seconds unplayable before the rescue finished. A window has to be bounded in
 * TIME, not only in frames, or its latency scales with the problem.
 */
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
   *
   * ONE-SIDED NOW. It sets the CUT threshold (`targetMs * (1 + deadZone)` =
   * 19.7 ms) and nothing else. See `THE RESTORE THRESHOLD` below for the
   * measurement that took the matching lower threshold out.
   */
  deadZone: 0.18,
  /** Never render below this fraction of native. Past it, the image mushes. */
  minScale: 0.55,
  /** One adjustment, up or down. Coarse so changes are few. */
  step: 0.075,
  /** Seconds between adjustments, so a change is judged before the next. */
  cooldownSec: 2.5,
  /**
   * A window closes once it holds this many samples AND spans `windowSec` of
   * rendering. Both, not either: 24 samples is enough for a median that one
   * hitch cannot move (it would take thirteen), and the time floor stops a
   * 300 fps menu from deciding off a quarter-second glance.
   */
  windowMinSamples: 24,
  /** Seconds of ACCEPTED frame time a window must span before it closes. */
  windowSec: 0.75,
  /** Consecutive windows over budget before the FIRST cut. */
  patienceDown: 1,
  /**
   * Consecutive windows NOT over budget before giving resolution back.
   *
   * Deliberately far higher than `patienceDown`: dropping is felt immediately
   * and recovering is not, so the controller should be quick to help and slow
   * to risk. It also stops a scene that is briefly cheap — a camera pointed at
   * empty ground — from pumping the resolution back and forth.
   *
   * **THIS COUNTS WINDOWS NOW, AND IT USED TO COUNT FRAMES.** The prose here
   * said "windows" in three places while `sample()` incremented the counter on
   * every call, so `patienceUp: 3` meant three FRAMES — fifty milliseconds. The
   * asymmetry this comment spends a paragraph justifying did not exist: both
   * directions were gated by the 2.5 s cooldown and separated by 33 ms.
   */
  patienceUp: 6,
  /**
   * Ceiling on the escalated `patienceUp` after probes that get cut straight
   * back. See `probing` — six windows is ~4.5 s, forty-eight is ~36 s, so a
   * machine that genuinely cannot afford the next step up settles into trying
   * roughly once a minute instead of oscillating.
   */
  patienceUpMax: 48,
} as const;

/**
 * What the controller decided this frame.
 *
 * **THE INSTANCE IS REUSED.** `sample()` runs at `RenderPhase.Present` on every
 * rendered frame, and CLAUDE.md's performance rule is zero allocation in the
 * frame loop — a fresh object literal per frame is exactly what that forbids.
 * Read the two fields and drop the reference; never store the object itself.
 */
export interface AdaptiveDecision {
  /** New scale to apply, or null to leave it alone. */
  scale: number | null;
  /** Median frame time of the last CLOSED window, or 0 before the first one. */
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
  /**
   * The one decision object, handed back from every `sample()`. See
   * `AdaptiveDecision` — the frame loop may not allocate.
   */
  private readonly decision: AdaptiveDecision = { scale: null, medianMs: 0 };
  /** Samples in the window under construction. Never exceeds the buffer. */
  private filled = 0;
  /** Milliseconds of ACCEPTED frame time in that window. */
  private windowMs = 0;
  /** Median of the last CLOSED window. Persisted so reporting has a number. */
  private lastMedianMs = 0;
  private sinceChange = 0;
  private overRuns = 0;
  private underRuns = 0;
  /**
   * Windows of calm required before the next step up. Starts at
   * `ADAPTIVE.patienceUp` and doubles every time a step up is cut straight
   * back, up to `ADAPTIVE.patienceUpMax`.
   */
  private upPatience: number = ADAPTIVE.patienceUp;
  /**
   * True while the most recent change was a step UP whose verdict is still
   * out. A cut arriving in that state means the probe was wrong.
   */
  private probing = false;

  /** Current scale, and the ceiling it may never exceed. */
  private scale: number;
  private ceiling: number;

  constructor(startScale: number) {
    this.scale = startScale;
    this.ceiling = startScale;
  }

  /** The scale the controller currently wants. */
  get current(): number { return this.scale; }
  /** Highest scale it may ever ask for. */
  get maxScale(): number { return this.ceiling; }

  /**
   * Raise or lower the ceiling because someone DELIBERATELY chose a scale.
   *
   * This was `readonly`, set once in the constructor from whatever the quality
   * tier picked at boot, and that made the Resolution Scale slider unusable
   * above the tier default. A player fighting aliasing sets 150%;
   * `handle.setResolutionScale(1.5)` applies it; this controller never learns,
   * still believes it is at 0.9, and on the next over-budget window commits
   * 0.9 - 0.075 = 0.825. The 1.5 is gone within seconds, and recovery is then
   * clamped by `this.scale < this.ceiling` to 0.9 forever. Supersampling — the
   * one genuine fix for aliasing this renderer already supports — was
   * unreachable, and it looked like the slider was ignored.
   *
   * Resetting `scale` too is the point: a deliberate choice is not something to
   * creep back from, it is the new starting position.
   */
  setCeiling(v: number): void {
    this.ceiling = v;
    this.scale = v;
    this.reset(v);
  }

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
    //
    // Rejected samples are excluded from `windowMs` as well as from the median,
    // which is the point of measuring the span in ACCEPTED frame time: one
    // 4.5 s stall (I have watched Vite hand the page one) must not close a
    // window that holds four real samples.
    if (Number.isFinite(frameMs) && frameMs > 0 && frameMs < 1000) {
      this.samples[this.filled++] = frameMs;
      this.windowMs += frameMs;
    }
    this.sinceChange += dtSec;

    /*
     * IS THE WINDOW CLOSED?
     *
     * Whichever comes first: enough evidence (samples AND time), or the buffer
     * is full. A closed window is consumed and cleared — the counters below
     * therefore count WINDOWS, which is what this file has always claimed and
     * never did.
     */
    const enough =
      this.filled >= ADAPTIVE.windowMinSamples && this.windowMs >= ADAPTIVE.windowSec * 1000;
    if (!enough && this.filled < ADAPTIVE_WINDOW) return this.verdict(null);

    this.lastMedianMs = this.median();
    this.filled = 0;
    this.windowMs = 0;

    /*
     * A WINDOW THAT LANDS INSIDE THE COOLDOWN IS DISCARDED, NOT COUNTED.
     *
     * The frames just after a change are polluted by the change itself — a
     * reallocated drawing buffer, re-specialised shaders — so they are evidence
     * about the resize, not about the scene. "A change is judged before the
     * next" means the judging starts after the cooldown, not during it.
     */
    if (this.sinceChange < ADAPTIVE.cooldownSec) return this.verdict(null);

    const high = ADAPTIVE.targetMs * (1 + ADAPTIVE.deadZone);

    if (this.lastMedianMs > high) {
      this.underRuns = 0;
      this.overRuns++;
      if (this.overRuns >= ADAPTIVE.patienceDown && this.scale > ADAPTIVE.minScale) {
        // A cut while a step up is still on probation means that step was
        // wrong. Back off before trying it again.
        if (this.probing) {
          this.upPatience = Math.min(ADAPTIVE.patienceUpMax, this.upPatience * 2);
          this.probing = false;
        }
        return this.commit(Math.max(ADAPTIVE.minScale, this.scale - ADAPTIVE.step));
      }
      return this.verdict(null);
    }

    /*
     * NOT OVER BUDGET. That is the whole restore condition — see the header.
     * Under vsync the median cannot go below the refresh interval, so "prove
     * you have headroom" is unsatisfiable and this used to be a one-way ratchet.
     */
    this.overRuns = 0;
    this.underRuns++;
    if (this.underRuns >= this.upPatience && this.scale < this.ceiling) {
      // A second step up in a row means the previous probe survived, so the
      // escalated patience was pessimism about a machine that does have room.
      if (this.probing) this.upPatience = ADAPTIVE.patienceUp;
      this.probing = true;
      return this.commit(Math.min(this.ceiling, this.scale + ADAPTIVE.step));
    }
    return this.verdict(null);
  }

  /** Fill in the reused decision object. Never allocates. */
  private verdict(scale: number | null): AdaptiveDecision {
    this.decision.scale = scale;
    this.decision.medianMs = this.lastMedianMs;
    return this.decision;
  }

  private commit(next: number): AdaptiveDecision {
    if (Math.abs(next - this.scale) < 1e-4) return this.verdict(null);
    this.scale = next;
    this.sinceChange = 0;
    this.overRuns = 0;
    this.underRuns = 0;
    // Clear the window. The samples describe the OLD resolution and would drag
    // the next decision toward a frame cost that no longer exists.
    this.filled = 0;
    this.windowMs = 0;
    return this.verdict(next);
  }

  /**
   * Median of the window. Allocation-free.
   *
   * The tail is padded with `Infinity` and the WHOLE buffer sorted, rather than
   * sorting a `subarray` view of the first `n`. `subarray` allocates a fresh
   * TypedArray object on every call, and this runs once per closed window on
   * the render thread; sorting 120 floats instead of 24 is cheaper than the
   * garbage was.
   */
  private median(): number {
    const n = this.filled;
    if (n === 0) return this.lastMedianMs;
    const s = this.sorted;
    for (let i = 0; i < n; i++) s[i] = this.samples[i];
    for (let i = n; i < ADAPTIVE_WINDOW; i++) s[i] = Number.POSITIVE_INFINITY;
    s.sort();
    return n % 2 === 1 ? s[(n - 1) >> 1] : (s[n / 2 - 1] + s[n / 2]) * 0.5;
  }

  /** Forget history — after a match change, a resize, or a tier change. */
  reset(scale: number): void {
    this.scale = Math.min(scale, this.ceiling);
    this.filled = 0;
    this.windowMs = 0;
    this.sinceChange = 0;
    this.overRuns = 0;
    this.underRuns = 0;
    this.upPatience = ADAPTIVE.patienceUp;
    this.probing = false;
  }
}
