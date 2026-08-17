/**
 * ============================================================================
 * tests/overlay-frame-cost.spec.ts — the per-frame cost of the world overlay
 * ============================================================================
 * Four things that cost CPU every frame and change no pixels. Each one was a
 * measurement before it was a change, and each assertion below is the thing
 * that would silently come back:
 *
 *   1. `CameraRig.readRect` called `getBoundingClientRect` on EVERY invocation,
 *      and `worldToScreen` is at the bottom of it. `getBoundingClientRect`
 *      forces a synchronous layout flush, and `Overlay.drawSelectionRings`
 *      calls `worldToScreen` once per ring POINT per unit — 21 to a ring — so a
 *      forty-unit selection was driving thousands of forced reflows inside one
 *      overlay pass. The rect is cached now and dropped once per frame in
 *      `update()`, which is the only invalidation that catches a page SCROLL
 *      and a browser zoom as well as a resize.
 *
 *   2. The three selection-ring stroke passes each re-projected the same 21
 *      points. They share one `pulse` value, so all three produce identical
 *      screen coordinates.
 *
 *   3. The hover ring was found by walking `store.alive` TWICE per frame, to
 *      locate an entity of which there is at most one — `Selection.setHovered`
 *      moves the bit rather than adding one.
 *
 *   4. `OrderMarkers` is double-sided AND transparent, which makes three submit
 *      the mesh twice per frame with `material.needsUpdate = true` before each
 *      submission — so `getProgramCacheKey` mints an array and a string twice a
 *      frame even when `count === 0`.
 *
 * The rect test is behavioural, against a real `CameraRig` and an element that
 * counts its own measurements. The rest are source pins: the drawing passes
 * need a canvas, and the defects here are structural rather than observable
 * from a return value.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { CameraRig } from '../src/render/camera';

const VIEW_W = 1600;
const VIEW_H = 900;

const src = (rel: string): string =>
  readFileSync(join(__dirname, '..', rel), 'utf8');

/** A canvas stand-in that counts how often it is asked to measure itself. */
function countingElement(): { el: HTMLElement; reads: () => number } {
  let reads = 0;
  const el = {
    clientWidth: VIEW_W,
    clientHeight: VIEW_H,
    style: {} as CSSStyleDeclaration,
    getBoundingClientRect: () => {
      reads++;
      return {
        left: 0, top: 0, right: VIEW_W, bottom: VIEW_H,
        width: VIEW_W, height: VIEW_H, x: 0, y: 0,
        toJSON: () => ({}),
      };
    },
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => true,
    setPointerCapture: () => undefined,
    releasePointerCapture: () => undefined,
    hasPointerCapture: () => false,
    contains: () => true,
  };
  return { el: el as unknown as HTMLElement, reads: () => reads };
}

function makeRig(el: HTMLElement): CameraRig {
  return new CameraRig({
    domElement: el, attachInput: false, focusX: 256, focusZ: 256,
    aspect: VIEW_W / VIEW_H,
  });
}

/* ========================================================================== */

describe('CameraRig — the client rect is measured once a frame, not once a call', () => {
  it('projects a thousand points on one layout flush', () => {
    const { el, reads } = countingElement();
    const rig = makeRig(el);
    rig.update(1 / 60);

    const before = reads();
    const v = new THREE.Vector3(256, 0, 256);
    const out = new THREE.Vector2();
    for (let i = 0; i < 1000; i++) {
      v.set(250 + (i % 20), 0, 250 + (i % 17));
      rig.worldToScreen(v, out);
    }
    // The ring pass is thousands of these. One measurement, or none at all if
    // `update` already took it.
    expect(reads() - before).toBeLessThanOrEqual(1);
    rig.dispose();
  });

  it('re-measures on the next frame, so a scroll is one frame stale at worst', () => {
    // The rect is VIEWPORT-relative, so scrolling the page moves it with no
    // resize event anywhere. Nothing here can observe that; `update()` dropping
    // the cache every frame is what bounds the damage.
    const { el, reads } = countingElement();
    const rig = makeRig(el);
    const v = new THREE.Vector3(256, 0, 256);
    const out = new THREE.Vector2();

    let last = reads();
    for (let f = 0; f < 5; f++) {
      rig.update(1 / 60);
      rig.worldToScreen(v, out);
      expect(reads(), 'each frame must take a fresh measurement').toBeGreaterThan(last);
      last = reads();
    }
    rig.dispose();
  });

  it('drops the cache on a resize that preserves the aspect ratio', () => {
    // `setAspect` returns early when the aspect has not moved, so the
    // invalidation has to happen BEFORE that return or a proportional resize
    // would project against the old rectangle until the next frame.
    const text = src('src/render/camera.ts');
    const body = text.slice(text.indexOf('setAspect(width: number'));
    const invalidate = body.indexOf('this.rectValid = false');
    const earlyReturn = body.indexOf('if (Math.abs(this.camera.aspect - a)');
    expect(invalidate).toBeGreaterThanOrEqual(0);
    expect(invalidate).toBeLessThan(earlyReturn);
  });
});

/* ========================================================================== */

describe('Overlay — the selection ring is projected once and stroked three times', () => {
  const text = src('src/ui/Overlay.ts');

  it('keeps the buffers at module scope, never per frame', () => {
    expect(text).toContain('const RING_XY = new Float64Array(');
    expect(text).toContain('const RING_OK = new Uint8Array(');
  });

  it('holds the WHOLE selection, because the pass order is the picture', () => {
    // Projecting per unit and issuing that unit's three strokes together would
    // put unit A's accent UNDER unit B's dark under-stroke wherever two rings
    // overlap, which is most of a real group. So the buffer is sized for the
    // selection and the passes stay outermost.
    expect(text).toContain('(MAX_SELECTION + 1) * RING_POINTS');
    const body = text.slice(text.indexOf('private drawSelectionRings('));
    const project = body.indexOf('this.projectGroundRing(idx, pulse, rings)');
    const firstStroke = body.indexOf('this.strokeProjectedRing(i)');
    expect(project).toBeGreaterThanOrEqual(0);
    expect(firstStroke).toBeGreaterThan(project);
  });

  it('coordinates stay float64, so no ring point moves', () => {
    // Float32 rounding is up to ~1e-4 px on a 1600-wide frame, which is enough
    // to flip an antialiased edge by 1/255 — and the capture fixtures are
    // compared byte for byte.
    expect(text).not.toContain('const RING_XY = new Float32Array(');
  });

  it('finds the hovered entity by handle instead of scanning the alive list', () => {
    const body = text.slice(
      text.indexOf('private drawSelectionRings('),
      text.indexOf('private projectGroundRing('),
    );
    expect(body).not.toContain('store.aliveCount');
    expect(body).toContain('store.index(this.hoveredId)');
    // The FLAG is still the gate. The handle is a shortcut to the entity, never
    // a second opinion about whether it may be drawn.
    expect(body).toContain('EntityFlag.Hovered');
    expect(body).toContain('EntityFlag.Selected');
  });

  it('caches the self-repair pulse ink per frame rather than per bar', () => {
    // `beat` is a function of `this.time` alone, so every mending bar in a
    // frame wants the identical pair of strings — and `rgba()` mints a string
    // and an array inside `hexToRgb` for each one.
    expect(text).toContain('private rebuildMendInk(beat: number)');
    expect(text).toContain('if (beat === this.mendBeat) return;');
    const bar = text.slice(text.indexOf('private drawOneBar('));
    expect(bar).not.toContain('rgba(SEMANTIC.ok,');
  });
});

/* ========================================================================== */

describe('order markers — one submission per frame, not two', () => {
  const text = src('src/input/input.system.ts');

  it('forces a single pass on the double-sided additive material', () => {
    expect(text).toContain('forceSinglePass: true');
  });

  it('keeps DoubleSide rather than guessing at pushArc winding', () => {
    // `side: FrontSide` would depend on the winding `pushArc` happens to emit
    // and can make the whole glyph vanish. `forceSinglePass` is the safe form:
    // under AdditiveBlending the back-face submission rasterises nothing for a
    // flat XZ annulus seen from above, so this is provably the same pixels.
    const material = text.slice(text.indexOf('function overlayMaterial('));
    expect(material).toContain('side: THREE.DoubleSide');
    expect(material).not.toContain('side: THREE.FrontSide');
  });
});
