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

const SLOW = 78;   // the reporter's measured median: 13 fps
const GOOD = 16.7; // 60 fps, dead centre of the dead zone
const FAST = 8;    // 125 fps — lots of headroom

describe('adaptive resolution', () => {
  it('decides nothing until it has a full window', () => {
    const c = new AdaptiveResolution(1);
    // One frame short of the window: still silent, however slow the frames are.
    expect(feed(c, SLOW, ADAPTIVE_WINDOW - 1)).toEqual([]);
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
    // a median and not a mean: a mean over 120 good frames plus one 300 ms
    // frame lands at ~19 ms and would trip the dead zone.
    const c = new AdaptiveResolution(1);
    for (let w = 0; w < 20; w++) {
      for (let i = 0; i < ADAPTIVE_WINDOW - 1; i++) c.sample(GOOD, GOOD / 1000);
      const d = c.sample(300, 0.3);
      expect(d.scale, 'one hitch must not move the resolution').toBeNull();
    }
    expect(c.current).toBe(1);
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
    // A second full window arriving in NO time must not produce a second cut.
    for (let i = 0; i < ADAPTIVE_WINDOW; i++) c.sample(SLOW, 0);
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
    expect(feed(c, SLOW, ADAPTIVE_WINDOW - 1)).toEqual([]);
  });
});
