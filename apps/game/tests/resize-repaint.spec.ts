/**
 * THE macOS BLACK FLASH: never present a drawing buffer nobody drew into.
 *
 * Reported twice — "black overlays that show for a millisecond and disappear" —
 * and closed once against the backdrop-filter gate, which is a different (also
 * real) problem. The mechanism that was missed, measured in a real browser
 * rather than reasoned about:
 *
 *   Ten forced resizes issued from a `requestAnimationFrame` registered after
 *   the game loop's own produced TEN presented frames in which every single
 *   pixel was the clear colour. `src/main.ts` debounces every window `resize`
 *   and every DPR change into exactly that shape, via `GameHandle.resize()` ->
 *   `handle.resize(true)`.
 *
 * Two properties fix it, and both are pure enough to test here:
 *
 *   1. A resize that does not change the drawing buffer must not touch it.
 *      `renderer.setSize` assigns to `canvas.width`, which reallocates even when
 *      the value is unchanged, and the product forces a resize on every window
 *      event.
 *   2. A reallocation that IS real must be followed by a complete frame before
 *      the browser paints — on the microtask queue, not on the next rAF, which
 *      would be one presented flat frame too late.
 */

import { describe, expect, it, vi } from 'vitest';

import { ADAPTIVE, ADAPTIVE_WINDOW, AdaptiveResolution } from '../src/render/AdaptiveResolution';
import { RepaintGuard } from '../src/render/RepaintGuard';
import {
  drawingBufferUnchanged,
  planDrawingBuffer,
  type RenderSize,
} from '../src/render/renderer';

/** A synthetic microtask queue, so ordering is asserted rather than awaited. */
function queue() {
  const pending: Array<() => void> = [];
  return {
    schedule: (fn: () => void) => { pending.push(fn); },
    /** Drain, exactly as a microtask checkpoint does before paint. */
    flush: () => { while (pending.length) pending.shift()!(); },
    get depth() { return pending.length; },
  };
}

describe('planDrawingBuffer', () => {
  it('multiplies the clamped DPR by the resolution scale', () => {
    const p = planDrawingBuffer(1280, 720, 2, 2, 0.75, false);
    expect(p.pixelRatio).toBeCloseTo(1.5, 6);
    expect(p.width).toBe(1920);
    expect(p.height).toBe(1080);
    expect(p.cssWidth).toBe(1280);
    expect(p.cssHeight).toBe(720);
  });

  /*
   * A DRAWING BUFFER THAT CANNOT EXIST.
   *
   * The clamp chain reads as total and is not. `Math.min(4, NaN)` is NaN and
   * `Math.max(0.25, NaN)` is NaN, so one non-finite scale makes `width` and
   * `height` NaN and the renderer is sized NaN x NaN — `stats().resolution`
   * reads the string "NaNxNaN", which is how this was noticed.
   *
   * Found by fat-fingering `__VM.setResolutionScale(undefined)` on a live game,
   * not by a real code path. `setResolutionScale` refuses non-finite input now,
   * which is the actual fix; this pins the second wall, because this function is
   * exported and pure and should never be ABLE to return an impossible size.
   *
   * CLAUDE.md records where a loose NaN ends up in this renderer: an instance
   * colour, then the bloom mip chain, then a black frame while stats reported
   * 285 draws.
   */
  it('never returns a NaN size, whatever it is handed', () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      const p = planDrawingBuffer(1280, 720, 1, 2, bad, false);
      expect(Number.isFinite(p.width), `scale ${bad} -> width`).toBe(true);
      expect(Number.isFinite(p.height), `scale ${bad} -> height`).toBe(true);
      expect(Number.isFinite(p.pixelRatio), `scale ${bad} -> pixelRatio`).toBe(true);
      expect(p.width).toBeGreaterThan(0);
      expect(p.height).toBeGreaterThan(0);
    }
  });

  it('falls back to native rather than to nothing when the scale is unusable', () => {
    // 1.0, not 0.25: a bad argument should cost sharpness nowhere, not
    // everywhere. Native is the honest default when the request is meaningless.
    const p = planDrawingBuffer(1280, 720, 1, 2, NaN, false);
    expect(p.pixelRatio).toBe(1);
    expect(p.width).toBe(1280);
    expect(p.height).toBe(720);
  });

  it('clamps devicePixelRatio to the configured ceiling', () => {
    // A 3x phone-class DPR must not produce a 3x buffer on a 2.0 ceiling.
    expect(planDrawingBuffer(1000, 1000, 3, 2, 1, false).width).toBe(2000);
  });

  it('IGNORES DPR AND SCALE IN FIXED-SIZE MODE — the screenshot contract', () => {
    // tools/shoot.mjs asserts the buffer is exactly 2560x1440. One
    // drawing-buffer pixel per requested pixel, whatever the machine's DPR and
    // whatever the adaptive controller last chose.
    const p = planDrawingBuffer(2560, 1440, 2, 2, 0.55, true);
    expect(p.width).toBe(2560);
    expect(p.height).toBe(1440);
    expect(p.pixelRatio).toBe(1);
  });

  it('never produces a degenerate buffer', () => {
    const p = planDrawingBuffer(0, 0, 0.001, 2, 0.25, false);
    expect(p.width).toBeGreaterThanOrEqual(2);
    expect(p.height).toBeGreaterThanOrEqual(2);
  });
});

describe('drawingBufferUnchanged', () => {
  const at = (o: Partial<RenderSize> = {}): RenderSize => ({
    cssWidth: 1280, cssHeight: 720, width: 2560, height: 1440, pixelRatio: 2, ...o,
  });

  it('is true when nothing moved — the case a forced resize used to reallocate', () => {
    expect(drawingBufferUnchanged(at(), at())).toBe(true);
  });

  it('is false for a changed buffer size', () => {
    expect(drawingBufferUnchanged(at({ width: 2304 }), at())).toBe(false);
  });

  it('is false when only the CSS box moved', () => {
    // Same pixels, different layout: the camera aspect depends on this, so it
    // must still count as a change.
    expect(drawingBufferUnchanged(at({ cssWidth: 1281 }), at())).toBe(false);
  });

  it('is false when only the pixel ratio moved', () => {
    expect(drawingBufferUnchanged(at({ pixelRatio: 1.9 }), at())).toBe(false);
  });

  it('a window nudge at an unchanged size is a no-op end to end', () => {
    const current = at();
    const again = planDrawingBuffer(1280, 720, 2, 2, 1, false);
    expect(drawingBufferUnchanged(again, current)).toBe(true);
  });
});

describe('RepaintGuard', () => {
  it('draws a frame before the paint when the buffer is left undrawn', () => {
    const q = queue();
    const g = new RepaintGuard(q.schedule);
    const paint = vi.fn();
    g.setPainter(paint);

    g.invalidate();
    expect(paint, 'nothing runs synchronously inside doResize').not.toHaveBeenCalled();
    expect(g.pending).toBe(true);

    q.flush();
    expect(paint).toHaveBeenCalledTimes(1);
    expect(g.repaints).toBe(1);
    expect(g.pending).toBe(false);
  });

  it('COSTS NOTHING when a frame was going to draw anyway', () => {
    // This is the adaptive-resolution path: the controller changes scale at
    // RenderPhase.Present, which is before the host's render hook, so
    // beginFrame() -> frameStarting() cancels the repaint.
    const q = queue();
    const g = new RepaintGuard(q.schedule);
    const paint = vi.fn();
    g.setPainter(paint);

    g.invalidate();
    g.frameStarting();
    q.flush();

    expect(paint).not.toHaveBeenCalled();
    expect(g.repaints).toBe(0);
    expect(g.coalesced).toBe(1);
  });

  it('coalesces a burst of resizes into ONE repaint', () => {
    // A fullscreen transition fires resize on nearly every frame. Each one
    // reallocates; only the last state needs drawing.
    const q = queue();
    const g = new RepaintGuard(q.schedule);
    const paint = vi.fn();
    g.setPainter(paint);

    for (let i = 0; i < 8; i++) g.invalidate();
    expect(q.depth, 'one scheduled callback, not eight').toBe(1);

    q.flush();
    expect(paint).toHaveBeenCalledTimes(1);
  });

  it('re-arms after a flush, so the next resize is covered too', () => {
    const q = queue();
    const g = new RepaintGuard(q.schedule);
    const paint = vi.fn();
    g.setPainter(paint);

    g.invalidate();
    q.flush();
    g.invalidate();
    q.flush();

    expect(paint).toHaveBeenCalledTimes(2);
  });

  it('does nothing when there is no painter, and does not wedge', () => {
    // Boot and teardown: the renderer exists before anything can draw the game.
    const q = queue();
    const g = new RepaintGuard(q.schedule);

    g.invalidate();
    q.flush();
    expect(g.unpainted).toBe(1);
    expect(g.pending).toBe(false);

    const paint = vi.fn();
    g.setPainter(paint);
    g.invalidate();
    q.flush();
    expect(paint).toHaveBeenCalledTimes(1);
  });

  it('a painter that throws must not take the renderer with it', () => {
    const q = queue();
    const g = new RepaintGuard(q.schedule);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    g.setPainter(() => { throw new Error('post chain is mid-rebuild'); });

    expect(() => { g.invalidate(); q.flush(); }).not.toThrow();
    expect(g.repaints).toBe(0);

    // And it recovers.
    const paint = vi.fn();
    g.setPainter(paint);
    g.invalidate();
    q.flush();
    expect(paint).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('does not recurse when the painter itself invalidates', () => {
    const q = queue();
    const g = new RepaintGuard(q.schedule);
    let depth = 0;
    let maxDepth = 0;
    g.setPainter(() => {
      depth++;
      maxDepth = Math.max(maxDepth, depth);
      g.invalidate();
      g.flush();
      depth--;
    });

    g.invalidate();
    q.flush();
    expect(maxDepth).toBe(1);
  });

  it('dispose drops the painter and any pending repaint', () => {
    const q = queue();
    const g = new RepaintGuard(q.schedule);
    const paint = vi.fn();
    g.setPainter(paint);

    g.invalidate();
    g.dispose();
    q.flush();

    expect(paint).not.toHaveBeenCalled();
  });

  it('a repaint is bookkept separately from a coalesced one', () => {
    const q = queue();
    const g = new RepaintGuard(q.schedule);
    g.setPainter(() => {});

    g.invalidate(); g.frameStarting(); q.flush();   // free
    g.invalidate(); q.flush();                      // paid
    g.invalidate(); g.frameStarting(); q.flush();   // free

    expect(g.repaints).toBe(1);
    expect(g.coalesced).toBe(2);
  });

  it('defaults to a MICROTASK, not an animation frame', async () => {
    // rAF would land the repaint in the NEXT frame — one presented flat frame
    // too late, which is the whole bug. A microtask runs before paint.
    const g = new RepaintGuard();
    const paint = vi.fn();
    g.setPainter(paint);

    g.invalidate();
    expect(paint).not.toHaveBeenCalled();
    await Promise.resolve();
    await Promise.resolve();
    expect(paint).toHaveBeenCalledTimes(1);
  });
});

/**
 * `adaptive-res.system.ts` now throws the controller's window away whenever the
 * CSS LAYOUT BOX changes — a fullscreen toggle or a drag between displays — so a
 * burst of expensive transition frames cannot be mistaken for a heavy scene and
 * answered with a resolution cut, which would be another reallocation on top of
 * the burst. These are the two properties that wiring depends on.
 */
describe('AdaptiveResolution.reset, as the resize hook uses it', () => {
  const SLOW = 78;
  const GOOD = 16.7;

  it('reset(current) leaves the scale exactly where it is', () => {
    const c = new AdaptiveResolution(1);
    for (let i = 0; i < ADAPTIVE_WINDOW * 4; i++) c.sample(SLOW, SLOW / 1000);
    const held = c.current;
    expect(held).toBeLessThan(1);

    c.reset(c.current);
    expect(c.current, 'a window resize must not also change the resolution').toBe(held);
  });

  it('reset restarts the cooldown, so a transition cannot trip an immediate cut', () => {
    const c = new AdaptiveResolution(1);
    // Fill the window with healthy frames and let the cooldown expire.
    for (let i = 0; i < ADAPTIVE_WINDOW * 3; i++) c.sample(GOOD, GOOD / 1000);
    c.reset(c.current);

    // A whole window of transition-priced frames arriving inside the cooldown.
    const changes: number[] = [];
    for (let i = 0; i < ADAPTIVE_WINDOW; i++) {
      const d = c.sample(SLOW, (ADAPTIVE.cooldownSec / ADAPTIVE_WINDOW) * 0.5);
      if (d.scale !== null) changes.push(d.scale);
    }
    expect(changes, 'a resize burst must not cost a resolution step').toEqual([]);
    expect(c.current).toBe(1);
  });
});
