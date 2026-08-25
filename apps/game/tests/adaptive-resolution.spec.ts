/**
 * Dynamic resolution scaling.
 *
 * Reported: "does it makes sense that im getting only 17 fps?" It did — this
 * machine profiled at 77.9 ms median at native 2560x1440, GPU-bound, which is
 * 13 fps. The lever to fix it (`resolutionScale`) had existed all along; what
 * was missing was anything that measured the frame and pulled it.
 *
 * The controller takes numbers and returns a number, so everything here runs
 * with a synthetic clock and no GL context.
 *
 * The properties that matter are the ones that keep it from being WORSE than
 * doing nothing: it must not thrash (every change reallocates the drawing
 * buffer, which is the documented cause of the macOS black-flash bug), it must
 * not chase a single hitch, and it must never exceed the ceiling the quality
 * tier chose.
 *
 * THREE OF THESE TESTS ARE NEW AND ONE GROUP OF THEM IS THE POINT OF THE FILE.
 * The controller was audited on a booted page and it DID engage — five cuts,
 * 1.0 -> 0.55, p90 frame 253.1 ms -> 25.9 ms — and then never gave a pixel
 * back, because the restore threshold sat below the vsync interval. See
 * "THE ONE-WAY RATCHET" below; that behaviour had no test, which is how it
 * shipped.
 */

import { describe, expect, it } from 'vitest';

import { ADAPTIVE, ADAPTIVE_WINDOW, AdaptiveResolution } from '../src/render/AdaptiveResolution';

/** Feed `n` frames of `ms` each. Returns every scale change that came out. */
function feed(c: AdaptiveResolution, ms: number, n: number): number[] {
  const changes: number[] = [];
  for (let i = 0; i < n; i++) {
    const d = c.sample(ms, ms / 1000);
    if (d.scale !== null) changes.push(d.scale);
  }
  return changes;
}

/** Samples a window of `ms`-long frames takes to close. Mirrors the controller. */
function windowLen(ms: number): number {
  return Math.min(
    ADAPTIVE_WINDOW,
    Math.max(ADAPTIVE.windowMinSamples, Math.ceil((ADAPTIVE.windowSec * 1000) / ms)),
  );
}

const SLOW = 78;   // the reporter's measured median: 13 fps
const GOOD = 16.7; // 60 fps, dead centre of the dead zone
const VSYNC = 16.8; // what a healthy 60 Hz frame actually measures
const FAST = 8;    // 125 fps — lots of headroom

describe('adaptive resolution', () => {
  it('decides nothing until a window has closed', () => {
    const c = new AdaptiveResolution(1);
    // One sample short of the first closed window: still silent, however slow
    // the frames are. A window needs BOTH a sample count and a span.
    expect(feed(c, SLOW, windowLen(SLOW) - 1)).toEqual([]);
    expect(c.current).toBe(1);
  });

  it('cuts resolution when frames are consistently over budget', () => {
    const c = new AdaptiveResolution(1);
    const changes = feed(c, SLOW, ADAPTIVE_WINDOW * 3);
    expect(changes.length).toBeGreaterThan(0);
    expect(c.current).toBeLessThan(1);
  });

  it('converges toward the floor under sustained load, and stops there', () => {
    // 78 ms is far beyond what any scale can rescue, so it must walk down to
    // the floor and then STOP rather than keep resizing forever.
    const c = new AdaptiveResolution(1);
    feed(c, SLOW, ADAPTIVE_WINDOW * 60);
    expect(c.current).toBeCloseTo(ADAPTIVE.minScale, 5);

    const after = feed(c, SLOW, ADAPTIVE_WINDOW * 10);
    expect(after, 'must stop resizing once it is at the floor').toEqual([]);
  });

  it('NEVER goes below the floor — a mushy image is not a fix', () => {
    const c = new AdaptiveResolution(1);
    feed(c, 500, ADAPTIVE_WINDOW * 80);
    expect(c.current).toBeGreaterThanOrEqual(ADAPTIVE.minScale);
  });

  it('NEVER exceeds the tier ceiling it started from', () => {
    // The quality tier's choice is a deliberate setting. This may reclaim frame
    // time below it and must never quietly override it.
    const c = new AdaptiveResolution(0.75);
    feed(c, FAST, ADAPTIVE_WINDOW * 80);
    expect(c.current).toBeLessThanOrEqual(0.75);
    expect(c.maxScale).toBe(0.75);
  });

  it('does nothing at all when frames sit on target', () => {
    // The steady state has to be sticky. A controller that keeps nudging at
    // target reallocates the drawing buffer forever.
    const c = new AdaptiveResolution(1);
    expect(feed(c, GOOD, ADAPTIVE_WINDOW * 20)).toEqual([]);
    expect(c.current).toBe(1);
  });

  it('gives resolution back when the load lifts', () => {
    const c = new AdaptiveResolution(1);
    feed(c, SLOW, ADAPTIVE_WINDOW * 4);
    const dropped = c.current;
    expect(dropped).toBeLessThan(1);

    feed(c, FAST, ADAPTIVE_WINDOW * 40);
    expect(c.current).toBeGreaterThan(dropped);
  });

  it('is slower to restore than to cut', () => {
    // Being too slow is felt continuously; being slightly soft is not. So the
    // controller should be quick to help and reluctant to risk.
    expect(ADAPTIVE.patienceUp).toBeGreaterThan(ADAPTIVE.patienceDown);
  });

  it('IGNORES A SINGLE HITCH — the reason it steers on a median', () => {
    // A 300 ms shader compile or GC pause inside an otherwise healthy window
    // must not cost a resolution step. This is exactly why the controller uses
    // a median and not a mean: a mean over a window of good frames plus one
    // 300 ms frame lands well past the dead zone.
    const c = new AdaptiveResolution(1);
    for (let w = 0; w < 20; w++) {
      for (let i = 0; i < ADAPTIVE_WINDOW - 1; i++) c.sample(GOOD, GOOD / 1000);
      const d = c.sample(300, 0.3);
      expect(d.scale, 'one hitch must not move the resolution').toBeNull();
    }
    expect(c.current).toBe(1);
  });

  it('a hitch cannot trigger a CUT even when there is room to cut', () => {
    // The test above sits at the ceiling, where an up-step is impossible, so it
    // could not have caught a spurious cut. This one starts below the ceiling.
    const c = new AdaptiveResolution(1);
    feed(c, SLOW, ADAPTIVE_WINDOW * 4);
    const dropped = c.current;
    expect(dropped).toBeGreaterThan(ADAPTIVE.minScale);

    for (let w = 0; w < 10; w++) {
      for (let i = 0; i < ADAPTIVE_WINDOW - 1; i++) c.sample(GOOD, GOOD / 1000);
      c.sample(300, 0.3);
    }
    expect(c.current, 'hitches must never push it DOWN either').toBeGreaterThanOrEqual(dropped);
  });

  it('discards impossible intervals rather than reacting to them', () => {
    // A backgrounded tab, a breakpoint or a paused debugger produces an
    // interval that describes nothing about the scene.
    const c = new AdaptiveResolution(1);
    for (let i = 0; i < ADAPTIVE_WINDOW * 4; i++) {
      c.sample(Number.NaN, 0.016);
      c.sample(0, 0.016);
      c.sample(-5, 0.016);
      c.sample(60_000, 0.016);
    }
    expect(c.current, 'garbage samples must not move anything').toBe(1);
  });

  it('respects the cooldown between changes', () => {
    const c = new AdaptiveResolution(1);
    // Fill and trip one change.
    feed(c, SLOW, ADAPTIVE_WINDOW * 2);
    const scaleAfterFirst = c.current;
    // Any number of further windows arriving in NO time must not produce a
    // second cut — the cooldown is wall time, not frames.
    for (let i = 0; i < ADAPTIVE_WINDOW * 4; i++) c.sample(SLOW, 0);
    expect(c.current).toBe(scaleAfterFirst);
  });

  it('reports the median it steered on', () => {
    const c = new AdaptiveResolution(1);
    let last = 0;
    for (let i = 0; i < ADAPTIVE_WINDOW; i++) last = c.sample(GOOD, GOOD / 1000).medianMs;
    expect(last).toBeCloseTo(GOOD, 3);
  });

  it('reset forgets history and cannot raise the ceiling', () => {
    const c = new AdaptiveResolution(0.9);
    feed(c, SLOW, ADAPTIVE_WINDOW * 4);
    c.reset(5);
    expect(c.current).toBe(0.9);
    // The pre-reset samples are gone: a window's worth short of a decision again.
    expect(feed(c, SLOW, windowLen(SLOW) - 1)).toEqual([]);
  });
});

/* ==========================================================================
 * THE SAMPLE PATH ALLOCATES NOTHING
 *
 * `sample()` runs at `RenderPhase.Present` on every rendered frame, and
 * CLAUDE.md's performance rule is zero allocation in the frame loop. Two
 * things used to break it every frame: a fresh `{ scale, medianMs }` literal,
 * and the two `subarray` views the median took. Both are gone; this pins the
 * observable half.
 * ========================================================================== */

describe('adaptive resolution — the frame loop may not allocate', () => {
  it('hands back the same decision object every time', () => {
    const c = new AdaptiveResolution(1);
    const first = c.sample(GOOD, GOOD / 1000);
    for (let i = 0; i < ADAPTIVE_WINDOW * 3; i++) {
      expect(c.sample(GOOD, GOOD / 1000)).toBe(first);
    }
  });
});

/* ==========================================================================
 * THE ONE-WAY RATCHET
 *
 * Restoring used to require `median < targetMs * (1 - deadZone)` = 13.69 ms.
 * A 60 Hz display cannot present a frame faster than 16.67 ms, so that branch
 * was unreachable on the commonest display in the world, by any scene, ever.
 *
 * Measured on a booted match, AMD iGPU through ANGLE/D3D11, 3840x2160 drawing
 * buffer: it cut correctly (five steps, 1.0 -> 0.55, p90 frame 253.1 ms ->
 * 25.9 ms), then the load was cut to a QUARTER of the pixels, leaving p10
 * 15.5 / median 16.6 / p90 17.8 ms — and across 121 further seconds the scale
 * stayed at 0.55 and the change count stayed at 5.
 *
 * So one battle, one shader-compile storm or one alt-tab pinned a player at
 * 55% resolution for the rest of the session, while the Settings screen went
 * on reporting the slider's 100%.
 * ========================================================================== */

describe('adaptive resolution — it must recover on a vsync-locked display', () => {
  it('restores at a 60 Hz vsync median, which is ABOVE the old restore threshold', () => {
    // The number that makes this a regression test: a healthy 60 Hz frame is
    // ~16.8 ms, and the old rule wanted under 13.69 ms before it would give
    // anything back.
    expect(VSYNC).toBeGreaterThan(ADAPTIVE.targetMs * (1 - ADAPTIVE.deadZone));

    const c = new AdaptiveResolution(1);
    feed(c, SLOW, ADAPTIVE_WINDOW * 6);
    const dropped = c.current;
    expect(dropped).toBeLessThan(1);

    feed(c, VSYNC, ADAPTIVE_WINDOW * 400);
    expect(c.current, 'a vsync-locked frame with headroom must climb back').toBeCloseTo(1, 5);
  });

  it('still refuses to restore while it is actually over budget', () => {
    // The restore rule is "not over budget", not "anything at all" — a frame
    // past the dead zone must keep cutting.
    const c = new AdaptiveResolution(1);
    const over = ADAPTIVE.targetMs * (1 + ADAPTIVE.deadZone) + 4;
    feed(c, over, ADAPTIVE_WINDOW * 40);
    expect(c.current).toBeLessThan(1);
  });

  it('backs off after a step up that gets cut straight back', () => {
    // A machine sitting exactly on the edge would otherwise saw one step, for
    // ever, and every edge of that saw reallocates the drawing buffer.
    const c = new AdaptiveResolution(1);
    feed(c, SLOW, ADAPTIVE_WINDOW * 6);
    const floorScale = c.current;

    // Alternate: calm long enough to provoke a probe, then over budget again.
    let changes = 0;
    for (let cycle = 0; cycle < 6; cycle++) {
      changes += feed(c, VSYNC, ADAPTIVE_WINDOW * 8).length;
      changes += feed(c, SLOW, ADAPTIVE_WINDOW * 4).length;
    }
    // Without the backoff this alternation produces a change on every single
    // cycle in both directions. With it, the probes get rarer.
    expect(changes, 'the saw must not run free').toBeLessThan(12);
    expect(c.current).toBeGreaterThanOrEqual(ADAPTIVE.minScale);
    expect(c.current).toBeLessThanOrEqual(Math.max(floorScale, ADAPTIVE.minScale) + ADAPTIVE.step * 2);
  });
});

/* ==========================================================================
 * PATIENCE COUNTS WINDOWS, AND IT USED TO COUNT FRAMES
 *
 * `ADAPTIVE.patienceDown`/`patienceUp` are documented as "consecutive windows",
 * in three separate comments. The code incremented them once per `sample()`
 * call — so `patienceUp: 3` meant three FRAMES, fifty milliseconds, and the
 * asymmetry the file argues for at length did not exist.
 * ========================================================================== */

describe('adaptive resolution — a window is a real unit', () => {
  it('closes a window on a sample floor AND a time span, whichever is slower', () => {
    // At 78 ms the sample floor binds (24 samples is already 1.9 s).
    const slowC = new AdaptiveResolution(1);
    expect(feed(slowC, SLOW, ADAPTIVE.windowMinSamples - 1)).toEqual([]);

    // At 8 ms the TIME floor binds — 24 samples is only 0.19 s, so a window
    // that closed on the sample count alone would steer off a glance.
    expect(windowLen(FAST)).toBeGreaterThan(ADAPTIVE.windowMinSamples);
    expect(windowLen(FAST) * FAST).toBeGreaterThanOrEqual(ADAPTIVE.windowSec * 1000);
  });

  it('never lets one window produce more than one decision', () => {
    // The old code decided on EVERY frame once its rolling window was full, so
    // `patienceDown: 1` fired on the first frame past the cooldown and
    // `patienceUp: 3` on the third — 33 ms apart.
    const c = new AdaptiveResolution(1);
    let steps = 0;
    const n = ADAPTIVE_WINDOW * 20;
    for (let i = 0; i < n; i++) if (c.sample(SLOW, SLOW / 1000).scale !== null) steps++;
    // Six steps take it from 1.0 to the 0.55 floor; it cannot have taken more.
    expect(steps).toBeLessThanOrEqual(Math.ceil((1 - ADAPTIVE.minScale) / ADAPTIVE.step));
  });

  it('reacts to a 13 fps machine in seconds, not tens of seconds', () => {
    // THE REGRESSION THIS EXISTS FOR. The window used to be 120 FRAMES with no
    // time bound, so at the reporter's measured 78 ms it took 9.4 s to reach a
    // first decision and another 9.4 s for every further step — roughly forty
    // seconds of unplayable frame rate before the rescue finished.
    const c = new AdaptiveResolution(1);
    let elapsedSec = 0;
    let firstCutAt = -1;
    for (let i = 0; i < ADAPTIVE_WINDOW * 20; i++) {
      const d = c.sample(SLOW, SLOW / 1000);
      elapsedSec += SLOW / 1000;
      if (d.scale !== null && firstCutAt < 0) firstCutAt = elapsedSec;
      if (c.current <= ADAPTIVE.minScale + 1e-6) break;
    }
    expect(firstCutAt).toBeGreaterThan(0);
    expect(firstCutAt, 'first cut must land just after the cooldown').toBeLessThan(6);
    expect(elapsedSec, 'and the whole walk to the floor must not take 40 s').toBeLessThan(30);
  });
});

/* ==========================================================================
 * A DELIBERATE CHOICE OUTRANKS THE BOOT-TIME CEILING
 *
 * `ceiling` was `readonly`, fixed in the constructor from whatever the quality
 * tier picked at boot. That made the Resolution Scale slider unusable above the
 * tier default: a player fighting aliasing sets 150%, the handle applies it,
 * this controller never learns, and on the next over-budget window it commits
 * ceiling - step. The 150% is gone in seconds and recovery is then clamped by
 * `scale < ceiling` back to the tier value forever.
 *
 * Supersampling is the one real answer to aliasing this renderer already
 * supports, and it was unreachable.
 * ========================================================================== */

describe('adaptive resolution — the ceiling can be re-armed', () => {
  it('lets a deliberate choice raise the ceiling above the tier default', () => {
    const c = new AdaptiveResolution(0.9);
    expect(c.maxScale).toBe(0.9);

    c.setCeiling(1.5);

    expect(c.maxScale).toBe(1.5);
    expect(c.current).toBe(1.5);
  });

  it('does not claw a raised scale straight back down', () => {
    // The exact reported sequence: set 150%, then keep rendering slowly.
    const c = new AdaptiveResolution(0.9);
    c.setCeiling(1.5);
    // It may cut under sustained load — that is its job — but it must start
    // from the value the player chose, not from the stale tier ceiling.
    const changes = feed(c, SLOW, ADAPTIVE_WINDOW);
    for (const s of changes) expect(s).toBeLessThan(1.5);
    expect(c.maxScale).toBe(1.5);
  });

  it('can recover all the way back to the raised ceiling, not the old one', () => {
    const c = new AdaptiveResolution(0.9);
    c.setCeiling(1.5);
    feed(c, SLOW, ADAPTIVE_WINDOW * 6);
    expect(c.current).toBeLessThan(1.5);
    feed(c, FAST, ADAPTIVE_WINDOW * 400);
    // Before the fix this could never exceed 0.9.
    expect(c.current).toBeCloseTo(1.5, 5);
  });

  it('clears the sample window, so the old resolution cannot steer the new one', () => {
    const c = new AdaptiveResolution(0.9);
    feed(c, SLOW, windowLen(SLOW) - 1);
    c.setCeiling(1.5);
    // A window short of a decision again: the pre-change samples are gone.
    expect(feed(c, SLOW, windowLen(SLOW) - 1)).toEqual([]);
  });

  it('lowering the ceiling takes the current scale down with it', () => {
    const c = new AdaptiveResolution(1.5);
    c.setCeiling(0.75);
    expect(c.maxScale).toBe(0.75);
    expect(c.current).toBe(0.75);
    // And it still may never climb back past the new, lower ceiling.
    feed(c, FAST, ADAPTIVE_WINDOW * 60);
    expect(c.current).toBeLessThanOrEqual(0.75);
  });
});

/* ==========================================================================
 * THE SCREENSHOT HARNESS MUST NEVER SEE THIS CONTROLLER MOVE
 *
 * `npm run shots` rests on ten of thirteen fixtures being BYTE-IDENTICAL run to
 * run. A resolution step mid-capture would change every pixel and read as an
 * art regression, and the whole visual scorecard is built on that property.
 *
 * There are two independent guards and this pins the controller-side one.
 * `?shot=` sets `GameLoop.captureClock` (Bootstrap.ts), which forces `realDt`
 * to 0, so the controller is fed `sample(0, 0)` on every organic frame. Zero is
 * rejected as an impossible interval, so the window can never close and no
 * decision can ever be reached. (The second guard is
 * `adaptive-res.system.ts`'s `handle.isFixedSize` early return, which covers
 * the pose steps `tools/shoot.mjs` takes after `setSize`.)
 * ========================================================================== */

describe('adaptive resolution — inert under the capture clock', () => {
  it('never decides anything when every frame is worth zero time', () => {
    const c = new AdaptiveResolution(1);
    for (let i = 0; i < ADAPTIVE_WINDOW * 100; i++) {
      expect(c.sample(0, 0).scale).toBeNull();
    }
    expect(c.current, 'a capture must render at the scale it was posed at').toBe(1);
  });
});
