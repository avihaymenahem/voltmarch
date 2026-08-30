/**
 * ============================================================================
 * tests/camera-nav.spec.ts — the camera navigation scheme
 * ============================================================================
 * The whole point of this file is that NOBODY HERE HAS A TRACKPAD. The change
 * it covers is "make a two-finger swipe pan instead of zoom", and the only way
 * to be honest about that without the hardware is to synthesise the events the
 * hardware produces and assert on which branch the rig takes.
 *
 * The signatures below are not invented. They are the shapes real browsers
 * emit:
 *
 *   Chrome / Edge, Windows, mouse wheel      deltaY  100 or 120, deltaX 0,
 *                                            deltaMode 0, isolated in time
 *   Firefox, any platform, mouse wheel       deltaMode 1 (lines), deltaY +-3
 *   Windows precision touchpad, swipe   deltaMode 0, small deltas often
 *                                            fractional, deltaX usually non-
 *                                            zero, one event per frame
 *   macOS trackpad, two-finger swipe    deltaMode 0, small INTEGER deltas, and
 *                                            deltaX EXACTLY 0 on a deliberate
 *                                            vertical swipe (the OS axis-locks
 *                                            it). w3c/uievents#337: "Mac
 *                                            touchpads never produce deltas
 *                                            with a fractional part."
 *   macOS pinch-to-zoom                 a wheel event with ctrlKey TRUE and a
 *                                            small deltaY, in EVERY browser
 *                                            including Safari 15+ (WebKit
 *                                            r277772; retested across Safari
 *                                            18 / Chrome 128 / Firefox 131 in
 *                                            the W3C public-webapps thread of
 *                                            Oct 2024)
 *
 * THE macOS ROW WAS MISSING AND ITS ABSENCE HID A REAL DEFECT. This file's
 * only trackpad fixture was `deltaX: 6.5, deltaY: 9.25` — non-zero AND
 * fractional, so it trips both of the classifier's rescue signals at once, and
 * it is the one shape a macOS trackpad is documented not to produce. Section 1b
 * pins the real macOS shapes, including the one the classifier gets WRONG.
 *
 * There is a second, stronger pass in a real headless Chromium that dispatches
 * genuine `WheelEvent`s at the live canvas; this file is the part that runs on
 * every commit. NOBODY HERE HAS A MAC: every event shape above is cited
 * documentation, and everything asserted below is our code's response to it.
 * ============================================================================
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it, beforeEach } from 'vitest';
import * as THREE from 'three';

import {
  CameraRig,
  cameraMayArmRightDrag,
  classifyWheelEvent,
  createWheelDeviceState,
  type WheelSample,
} from '../src/render/camera';
import { defaultNavigationOptions } from '../src/render/camera';
import { RENDER_CONFIG, configureRender } from '../src/render/renderer';
import { defaultBindings, defaultSettings, findConflicts, KEYBINDS } from '../src/shell/settings-store';
import { cameraPatch } from '../src/game/ArtBridge';
import { CAMERA, CAMERA_NAV } from '../src/core/config';

/* ==========================================================================
 * Fixtures
 * ========================================================================== */

const VIEW_W = 1600;
const VIEW_H = 900;

/** The parts of an HTMLElement the rig actually touches. */
function fakeElement(): HTMLElement {
  const el = {
    clientWidth: VIEW_W,
    clientHeight: VIEW_H,
    style: {} as CSSStyleDeclaration,
    getBoundingClientRect: () => ({
      left: 0, top: 0, right: VIEW_W, bottom: VIEW_H,
      width: VIEW_W, height: VIEW_H, x: 0, y: 0,
      toJSON: () => ({}),
    }),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => true,
    setPointerCapture: () => undefined,
    releasePointerCapture: () => undefined,
    hasPointerCapture: () => false,
    contains: () => true,
  };
  return el as unknown as HTMLElement;
}

interface WheelParts {
  deltaX?: number;
  deltaY?: number;
  deltaMode?: number;
  timeStamp?: number;
  clientX?: number;
  clientY?: number;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

/** A duck-typed WheelEvent. `handleWheel` reads exactly these fields. */
function wheel(p: WheelParts): WheelEvent {
  return {
    deltaX: p.deltaX ?? 0,
    deltaY: p.deltaY ?? 0,
    deltaZ: 0,
    deltaMode: p.deltaMode ?? 0,
    timeStamp: p.timeStamp ?? 0,
    clientX: p.clientX ?? VIEW_W / 2,
    clientY: p.clientY ?? VIEW_H / 2,
    ctrlKey: p.ctrlKey ?? false,
    altKey: p.altKey ?? false,
    shiftKey: p.shiftKey ?? false,
    metaKey: false,
    preventDefault: () => undefined,
    stopPropagation: () => undefined,
  } as unknown as WheelEvent;
}

function sample(p: WheelParts): WheelSample {
  return {
    deltaX: p.deltaX ?? 0,
    deltaY: p.deltaY ?? 0,
    deltaMode: p.deltaMode ?? 0,
    timeStamp: p.timeStamp ?? 0,
  };
}

function makeRig(): CameraRig {
  return new CameraRig({
    domElement: fakeElement(),
    attachInput: false,
    focusX: 256,
    focusZ: 256,
    aspect: VIEW_W / VIEW_H,
  });
}

/** Restore every config value these tests write, so ordering cannot matter. */
const CAMERA_DEFAULTS = { ...RENDER_CONFIG.camera };

beforeEach(() => {
  configureRender({
    camera: {
      zoomStep: CAMERA_DEFAULTS.zoomStep,
      zoomToCursor: CAMERA_DEFAULTS.zoomToCursor,
      edgePanPixels: CAMERA_DEFAULTS.edgePanPixels,
      minDistance: CAMERA_DEFAULTS.minDistance,
      gameplayMinDistance: CAMERA_DEFAULTS.gameplayMinDistance,
      maxDistance: CAMERA_DEFAULTS.maxDistance,
      distance: CAMERA_DEFAULTS.distance,
    },
  });
});

/* ==========================================================================
 * 1. The device classifier
 * ========================================================================== */

describe('camera — trackpad vs mouse classification', () => {
  it('calls a Chrome/Windows wheel detent a mouse on the very first event', () => {
    for (const notch of [100, 120, -100, -120, 240]) {
      const st = createWheelDeviceState();
      expect(classifyWheelEvent(sample({ deltaY: notch, timeStamp: 1000 }), st)).toBe('mouse');
    }
  });

  it('calls a Firefox line-mode wheel a mouse whatever else the event says', () => {
    const st = createWheelDeviceState();
    // deltaMode 1 is decisive: even with a horizontal component and a fast
    // repeat — the two strongest trackpad tells — this is a wheel.
    expect(classifyWheelEvent(
      sample({ deltaY: -3, deltaX: 1, deltaMode: 1, timeStamp: 1000 }), st,
    )).toBe('mouse');
    expect(classifyWheelEvent(
      sample({ deltaY: -3, deltaX: 1, deltaMode: 1, timeStamp: 1010 }), st,
    )).toBe('mouse');
  });

  it('calls a macOS two-finger swipe a trackpad on the very first event', () => {
    // Purely vertical, small, integer — the hardest trackpad case there is,
    // because it shares every signal with a slow wheel except magnitude.
    const a = createWheelDeviceState();
    expect(classifyWheelEvent(sample({ deltaY: 2, timeStamp: 1000 }), a)).toBe('trackpad');

    // With a horizontal component and fractional deltas it is unambiguous.
    const b = createWheelDeviceState();
    expect(classifyWheelEvent(
      sample({ deltaX: -1.5, deltaY: 4.25, timeStamp: 1000 }), b,
    )).toBe('trackpad');
  });

  it('holds the verdict across a whole fling rather than flapping per event', () => {
    // A real macOS fling: ramps up, overshoots past the coarse threshold at its
    // peak, then decays. The peak samples look like wheel detents in isolation.
    const st = createWheelDeviceState();
    const fling = [1, 3, 8, 21, 44, 68, 55, 30, 12, 4, 1];
    let t = 1000;
    const verdicts: string[] = [];
    for (const dy of fling) {
      verdicts.push(classifyWheelEvent(sample({ deltaY: dy, deltaX: dy * 0.2, timeStamp: t }), st));
      t += 16;
    }
    expect(verdicts.every((v) => v === 'trackpad')).toBe(true);
  });

  it('holds "mouse" across a burst of detents from a fast scroller', () => {
    const st = createWheelDeviceState();
    let t = 1000;
    for (let i = 0; i < 8; i++) {
      expect(classifyWheelEvent(sample({ deltaY: 100, timeStamp: t }), st)).toBe('mouse');
      t += 70; // faster than a human normally scrolls, still isolated detents
    }
  });

  it('switches over when the player genuinely swaps device mid-session', () => {
    const st = createWheelDeviceState();
    let t = 1000;
    for (let i = 0; i < 6; i++) {
      classifyWheelEvent(sample({ deltaY: 100, timeStamp: t }), st);
      t += 200;
    }
    expect(st.kind).toBe('mouse');
    for (let i = 0; i < 8; i++) {
      classifyWheelEvent(sample({ deltaY: 3.5, deltaX: -1.25, timeStamp: t }), st);
      t += 16;
    }
    expect(st.kind).toBe('trackpad');
  });
});

/* ==========================================================================
 * 1b. THE macOS SHAPES, AND THE ONE THE CLASSIFIER GETS WRONG
 *
 * Section 1's trackpad fixtures all carry a `deltaX` or a fraction. macOS
 * produces neither on a deliberate vertical swipe: the OS axis-locks it, and
 * w3c/uievents#337 reports "Mac touchpads never produce deltas with a
 * fractional part". So the two strongest signals in `wheelEvidence` are absent
 * by construction there and only magnitude and rate are left.
 *
 * Every verdict below is MEASURED against the shipped classifier, not
 * predicted. The event shapes are documentation; nobody here has a Mac.
 * ========================================================================== */

describe('camera — an axis-locked integer swipe, which is what macOS emits', () => {
  /** Feed one axis-locked integer stream at display refresh. */
  function stream(deltas: readonly number[]): { verdicts: string; score: number } {
    const st = createWheelDeviceState();
    let t = 1000;
    let verdicts = '';
    for (const dy of deltas) {
      verdicts += classifyWheelEvent(sample({ deltaX: 0, deltaY: dy, timeStamp: t }), st)[0];
      t += 8;
    }
    return { verdicts, score: st.score };
  }

  it('reads a slow swipe as a trackpad from the first event', () => {
    expect(stream([2, 2, 3, 3, 4]).verdicts).toBe('ttttt');
    expect(stream([9, 9, 9]).verdicts).toBe('ttt');
  });

  it('puts the first-event boundary at 9/10, which is `fineDeltaPx`', () => {
    // 0 + 0.6 - 0.4 = +0.2 at 9; 0 + 0.0 - 0.4 = -0.4 at 10. Both derived from
    // `wheelEvidence` and both confirmed here, so a retune of `fineDeltaPx`
    // reports rather than drifts.
    expect(CAMERA_NAV.fineDeltaPx).toBe(10);
    expect(stream([9]).verdicts).toBe('t');
    expect(stream([10]).verdicts).toBe('m');
  });

  it('recovers within two events for a mid swipe, 10..49', () => {
    expect(stream([12, 12, 12, 12, 12, 12]).verdicts).toBe('mmtttt');
    expect(stream([30, 30, 30, 30, 30, 30]).verdicts).toBe('mmtttt');
  });

  /**
   * THE DEFECT, PINNED RATHER THAN FIXED.
   *
   * A stream whose samples stay at or above `coarseDeltaPx` (50) scores
   * -0.9 + 0.7 = -0.2 per event, so the running score is pinned at -1 and the
   * verdict is `mouse` for the rest of the SESSION — measured here at 20
   * events, and the score shows it cannot climb back.
   *
   * It is not fixed by retuning `wheelEvidence`, because the weights that
   * would have to move are the same ones giving a Chrome detent its -2.7
   * margin, and that margin is the thing in this heuristic that must not
   * move. It is made HARMLESS instead — see the identity test in section 2c:
   * both verdicts dolly, by the same amount, so a misdetection changes
   * nothing a player can feel. A REAL fling ramps up from small samples and
   * is already `trackpad` by its peak; this is the coalesced / starts-fast
   * case.
   */
  it('is called a mouse forever once the samples stay above `coarseDeltaPx`', () => {
    expect(CAMERA_NAV.coarseDeltaPx).toBe(50);
    const fast = stream(Array<number>(20).fill(60));
    expect(fast.verdicts).toBe('m'.repeat(20));
    expect(fast.score).toBe(-1);

    // And the ordinary fling, which ramps, is not affected at all.
    expect(stream([1, 3, 8, 21, 44, 68, 55, 30, 12, 4, 1]).verdicts).toBe('t'.repeat(11));
  });
});

/* ==========================================================================
 * 2. The branch the rig actually takes
 * ========================================================================== */

describe('camera — wheel events reach the right gesture', () => {
  it('ZOOMS on a mouse wheel notch and leaves the focus put', () => {
    const rig = makeRig();
    // Isolate the zoom from the zoom-to-cursor pull, which is a separate
    // feature with its own test below.
    configureRender({ camera: { zoomToCursor: 0 } });
    const d0 = rig.targetDistance;
    const x0 = rig.targetFocus.x;
    const z0 = rig.targetFocus.z;

    rig.handleWheel(wheel({ deltaY: 100, timeStamp: 1000 }));

    expect(rig.targetDistance).toBeGreaterThan(d0);
    expect(rig.targetFocus.x).toBeCloseTo(x0, 6);
    expect(rig.targetFocus.z).toBeCloseTo(z0, 6);
    expect(rig.pointerDevice).toBe('mouse');
  });

  it('ZOOMS on a two-finger trackpad swipe, which is the shipping default', () => {
    // THIS TEST USED TO ASSERT THE OPPOSITE, and the change is the fix.
    // Reported by a Mac player as "cant zoom or scroll on z": two fingers
    // panned (the macOS maps convention) and the product offered no way to get
    // scroll-to-zoom, which is close to universal in this genre.
    const rig = makeRig();
    configureRender({ camera: { zoomToCursor: 0 } });
    const d0 = rig.targetDistance;
    const x0 = rig.targetFocus.x;
    const z0 = rig.targetFocus.z;

    // A short swipe: down-and-right, small fractional deltas, one per frame.
    let t = 1000;
    for (let i = 0; i < 6; i++) {
      rig.handleWheel(wheel({ deltaX: 6.5, deltaY: 9.25, timeStamp: t }));
      t += 16;
    }

    expect(rig.pointerDevice).toBe('trackpad');
    expect(rig.targetDistance).toBeGreaterThan(d0);
    expect(rig.targetFocus.x).toBeCloseTo(x0, 6);
    expect(rig.targetFocus.z).toBeCloseTo(z0, 6);
  });

  it('still PANS on that swipe when the player asks for the maps convention', () => {
    // `trackpadScroll: 'pan'` is the behaviour this file shipped with, kept as
    // a chooser rather than deleted. Every assertion here is the one the test
    // above used to make, verbatim.
    const rig = makeRig();
    rig.setNavigation({ trackpadScroll: 'pan' });
    const d0 = rig.targetDistance;
    const x0 = rig.targetFocus.x;
    const z0 = rig.targetFocus.z;

    let t = 1000;
    for (let i = 0; i < 6; i++) {
      rig.handleWheel(wheel({ deltaX: 6.5, deltaY: 9.25, timeStamp: t }));
      t += 16;
    }

    expect(rig.pointerDevice).toBe('trackpad');
    expect(rig.targetDistance).toBeCloseTo(d0, 6);
    // Yaw is 0, so +deltaX is +worldX and +deltaY is "further into the map".
    expect(rig.targetFocus.x).toBeGreaterThan(x0 + 0.5);
    expect(rig.targetFocus.z).toBeGreaterThan(z0 + 0.5);
  });

  it('SHIFT is the trackpad way back to a two-finger pan, in either mode', () => {
    // Shift is already the documented "pan instead" modifier, it did nothing
    // on a mouse (see section 2b), and reusing it costs one clause. Without
    // it, `trackpadScroll: 'zoom'` would take the pan gesture away from anyone
    // who did not go looking in Options.
    for (const mode of ['zoom', 'pan'] as const) {
      const rig = makeRig();
      rig.setNavigation({ pointerDevice: 'trackpad', trackpadScroll: mode });
      const d0 = rig.targetDistance;
      rig.handleWheel(wheel({ deltaX: 30, deltaY: 30, shiftKey: true, timeStamp: 1000 }));
      expect(rig.targetDistance, mode).toBeCloseTo(d0, 6);
      // BOTH axes: a trackpad already has two of them.
      expect(rig.targetFocus.x, mode).toBeGreaterThan(256.5);
      expect(rig.targetFocus.z, mode).toBeGreaterThan(256.5);
    }
  });

  it('does NOT swap the axes for a trackpad Shift — that is a mouse-only rule', () => {
    // `wheelPan`'s swap turns a vertical scroll into a sideways pan, which is
    // the only horizontal pan a wheel with no tilt can reach. Applied to a
    // trackpad it would delete the vertical half of the pan the player just
    // asked for by holding Shift.
    const rig = makeRig();
    rig.setNavigation({ pointerDevice: 'trackpad' });
    rig.handleWheel(wheel({ deltaX: 0, deltaY: 30, shiftKey: true, timeStamp: 1000 }));
    expect(rig.targetFocus.x).toBeCloseTo(256, 6);
    expect(rig.targetFocus.z).toBeGreaterThan(256.5);
  });

  it('lets a pinch outrank Shift — a pinch is a pinch whatever else is held', () => {
    const rig = makeRig();
    rig.setNavigation({ pointerDevice: 'trackpad' });
    configureRender({ camera: { zoomToCursor: 0 } });
    const d0 = rig.targetDistance;
    for (let i = 0; i < 10; i++) {
      rig.handleWheel(wheel({ deltaY: 6, ctrlKey: true, shiftKey: true, timeStamp: 1000 + i * 16 }));
    }
    expect(rig.targetDistance).toBeGreaterThan(d0);
    expect(rig.targetFocus.z).toBeCloseTo(256, 6);
  });

  it('never zooms on a sideways trackpad swipe, in either mode', () => {
    for (const mode of ['zoom', 'pan'] as const) {
      const rig = makeRig();
      rig.setNavigation({ pointerDevice: 'trackpad', trackpadScroll: mode });
      const d0 = rig.targetDistance;
      rig.handleWheel(wheel({ deltaX: 40, deltaY: 4, timeStamp: 1000 }));
      expect(rig.targetDistance, mode).toBeCloseTo(d0, 6);
      expect(rig.targetFocus.x, mode).toBeGreaterThan(256.5);
    }
  });

  it('ZOOMS on a macOS pinch — a wheel event with ctrlKey — even on a trackpad', () => {
    const rig = makeRig();
    configureRender({ camera: { zoomToCursor: 0 } });

    // Establish the device as a trackpad first, exactly as a real session does.
    let t = 1000;
    for (let i = 0; i < 5; i++) {
      rig.handleWheel(wheel({ deltaX: 3.5, deltaY: 1.25, timeStamp: t }));
      t += 16;
    }
    expect(rig.pointerDevice).toBe('trackpad');

    const d0 = rig.targetDistance;
    const x0 = rig.targetFocus.x;
    for (let i = 0; i < 10; i++) {
      rig.handleWheel(wheel({ deltaY: -4, ctrlKey: true, timeStamp: t }));
      t += 16;
    }
    // Pinch out = zoom in = closer.
    expect(rig.targetDistance).toBeLessThan(d0 - 1);
    expect(rig.targetFocus.x).toBeCloseTo(x0, 6);
  });

  it('never zooms on a sideways gesture, even misdetected as a mouse', () => {
    const rig = makeRig();
    rig.setNavigation({ pointerDevice: 'mouse' });
    const d0 = rig.targetDistance;
    const x0 = rig.targetFocus.x;

    // The safety net: a horizontal-dominant wheel event is a pan whatever the
    // classifier thinks, because horizontal zoom does not exist.
    rig.handleWheel(wheel({ deltaX: 40, deltaY: 4, timeStamp: 1000 }));

    expect(rig.targetDistance).toBeCloseTo(d0, 6);
    expect(rig.targetFocus.x).toBeGreaterThan(x0 + 0.5);
  });

  it('obeys the manual override in both directions', () => {
    // UNDER `trackpadScroll: 'pan'`, which is the mode in which the override
    // still changes the VERB. This case is the reason the setting was kept:
    // "force trackpad" has to mean something, and under the zoom default both
    // verdicts dolly.
    const forcedTrackpad = makeRig();
    forcedTrackpad.setNavigation({ pointerDevice: 'trackpad', trackpadScroll: 'pan' });
    const dT = forcedTrackpad.targetDistance;
    // A textbook mouse detent, forced to pan.
    forcedTrackpad.handleWheel(wheel({ deltaY: 120, timeStamp: 1000 }));
    expect(forcedTrackpad.targetDistance).toBeCloseTo(dT, 6);
    expect(forcedTrackpad.targetFocus.z).toBeGreaterThan(256);

    const forcedMouse = makeRig();
    forcedMouse.setNavigation({ pointerDevice: 'mouse' });
    configureRender({ camera: { zoomToCursor: 0 } });
    const dM = forcedMouse.targetDistance;
    // A textbook trackpad sample, forced to zoom.
    forcedMouse.handleWheel(wheel({ deltaY: 2.5, timeStamp: 1000 }));
    expect(forcedMouse.targetDistance).toBeGreaterThan(dM);
    expect(forcedMouse.targetFocus.z).toBeCloseTo(256, 6);
  });

  it('scales a pinch so a whole gesture is a usable amount of zoom', () => {
    // Regression guard on the sensitivity split: pinch deltas are ~1/30 of a
    // wheel detent, so reusing the wheel's /100 normalisation would make a full
    // pinch worth a rounding error.
    const rig = makeRig();
    configureRender({ camera: { zoomToCursor: 0 } });
    const d0 = rig.targetDistance;
    let t = 1000;
    for (let i = 0; i < 20; i++) {
      rig.handleWheel(wheel({ deltaY: 6, ctrlKey: true, timeStamp: t }));
      t += 16;
    }
    // 20 events of a slow pinch should cross a meaningful part of the range.
    expect(rig.targetDistance).toBeGreaterThan(d0 * 1.2);
  });

  it('honours invert for pan and for zoom independently', () => {
    const rig = makeRig();
    // `trackpadScroll: 'pan'`, because inverting a PAN needs a pan to invert.
    rig.setNavigation({
      pointerDevice: 'trackpad', trackpadScroll: 'pan', invertPanX: true, invertPanY: true,
    });
    rig.handleWheel(wheel({ deltaX: 20, deltaY: 20, timeStamp: 1000 }));
    expect(rig.targetFocus.x).toBeLessThan(256);
    expect(rig.targetFocus.z).toBeLessThan(256);

    const zoomer = makeRig();
    configureRender({ camera: { zoomToCursor: 0 } });
    zoomer.setNavigation({ pointerDevice: 'mouse', invertZoom: true });
    const d0 = zoomer.targetDistance;
    zoomer.handleWheel(wheel({ deltaY: 100, timeStamp: 1000 }));
    expect(zoomer.targetDistance).toBeLessThan(d0);
  });

  it('pulls the point under the cursor toward the centre when zooming to cursor', () => {
    const rig = makeRig();
    configureRender({ camera: { zoomToCursor: 1 } });
    const before = new THREE.Vector3();
    // A point well off-centre, toward the top-left of the viewport.
    expect(rig.screenToGround(300, 250, before)).toBe(true);

    rig.handleWheel(wheel({ deltaY: -100, clientX: 300, clientY: 250, timeStamp: 1000 }));
    rig.setPose({ immediate: true, x: rig.targetFocus.x, z: rig.targetFocus.z, distance: rig.targetDistance });

    const after = new THREE.Vector3();
    expect(rig.screenToGround(300, 250, after)).toBe(true);
    // The ground point under the cursor barely moved: that is the whole promise.
    expect(before.distanceTo(after)).toBeLessThan(1.5);
  });
});

/* ==========================================================================
 * 2b. THE MOUSE WHEEL IS EXACTLY WHAT IT WAS
 *
 * The trackpad default changed. A Windows mouse player's wheel must not have
 * moved by a millimetre, and "it cannot have, structurally" is not the same
 * claim as "it did not".
 *
 * STRUCTURALLY: `scrollZooms` is `kind === 'trackpad' && ...`, a branch a
 * mouse cannot enter, and the mouse still routes through `wheelZoom`'s
 * unchanged `'wheel'` arithmetic. That argument is sound TODAY and stops being
 * obvious the moment anybody edits `handleWheel` again, which is what this
 * table is for.
 *
 * Every figure is a fact about the tree, re-derivable by hand from
 * `zoomStep 1.14`, the /100 normalisation, the x16 / x400 `deltaMode` factors
 * and `maxNotchesPerEvent: 3`. They are asserted to SIX DECIMAL PLACES on
 * purpose: a tolerance here would hide exactly the drift the section exists to
 * catch.
 * ========================================================================== */

describe('camera — the mouse wheel is exactly what it was', () => {
  /** One event at a fresh rig, with the zoom-to-cursor pull isolated out. */
  function afterOne(p: WheelParts): number {
    const rig = makeRig();
    rig.setNavigation({ pointerDevice: 'mouse' });
    configureRender({ camera: { zoomToCursor: 0 } });
    rig.handleWheel(wheel({ timeStamp: 1000, ...p }));
    return rig.targetDistance;
  }

  it('lands on the same six decimal places it always did', () => {
    expect(afterOne({ deltaY: 100 })).toBeCloseTo(62.700000, 6);
    expect(afterOne({ deltaY: 120 })).toBeCloseTo(64.364813, 6);
    expect(afterOne({ deltaY: -100 })).toBeCloseTo(48.245614, 6);
    // Firefox line mode, x16.
    expect(afterOne({ deltaY: 3, deltaMode: 1 })).toBeCloseTo(58.570242, 6);
    // Page mode, x400 = 4 notches, clamped to `maxNotchesPerEvent` 3.
    expect(afterOne({ deltaY: 1, deltaMode: 2 })).toBeCloseTo(81.484920, 6);
  });

  it('still refuses to zoom on a sideways wheel event', () => {
    const rig = makeRig();
    rig.setNavigation({ pointerDevice: 'mouse' });
    const d0 = rig.targetDistance;
    rig.handleWheel(wheel({ deltaX: 40, deltaY: 4, timeStamp: 1000 }));
    expect(rig.targetDistance).toBeCloseTo(d0, 6);
  });

  /**
   * THE ONE DECLARED EXCEPTION, and it is a defect being fixed rather than a
   * behaviour being lost.
   *
   * `cam.wheelPanX` in `src/input/ActionCatalogue.ts` has always described
   * Shift+wheel as "the only sideways pan available on a mouse with no tilt
   * wheel", and `wiki/Controls.md` printed the same row. It was unreachable:
   * `wantsZoom` was unconditionally true for a mouse, so a mouse Shift+wheel
   * ZOOMED (x1.140000, focus unmoved) and `wheelPan`'s axis-swap branch could
   * never run. Declaring this explicitly is what stops "mouse behaviour must
   * not move" from being quietly weakened later.
   */
  it('pans sideways on Shift+wheel, which the catalogue has always promised', () => {
    const rig = makeRig();
    rig.setNavigation({ pointerDevice: 'mouse' });
    configureRender({ camera: { zoomToCursor: 0 } });
    const d0 = rig.targetDistance;

    rig.handleWheel(wheel({ deltaY: 100, shiftKey: true, timeStamp: 1000 }));

    expect(rig.targetDistance, 'Shift+wheel must no longer dolly').toBeCloseTo(d0, 6);
    // Sideways: the vertical delta became a horizontal pan, and z did not move.
    expect(rig.targetFocus.x).toBeGreaterThan(256.5);
    expect(rig.targetFocus.z).toBeCloseTo(256, 6);
  });
});

/* ==========================================================================
 * 2c. THE TRACKPAD ZOOM SCALE
 *
 * `wheelZoom` takes a three-valued scale selector. It was a BOOLEAN with
 * `pinch || kind === 'trackpad'` folded into it, and that collapse is the
 * regression this section exists to catch: the pinch scale is 0.035 PER PIXEL,
 * sized for deltas of 0.5-3, and a trackpad SCROLL is tens of pixels per
 * event.
 * ========================================================================== */

describe('camera — a two-finger scroll dollies a sane amount', () => {
  /** A decaying macOS inertia tail summing ~130 px, after the fingers lift. */
  const TAIL = [26, 22, 18, 15, 12, 10, 8, 6, 5, 4, 3, 1];

  /** Notches of zoom the rig ended up applying, from the distance ratio. */
  function notchesOf(rig: CameraRig, from: number): number {
    return Math.log(rig.targetDistance / from) / Math.log(RENDER_CONFIG.camera.zoomStep);
  }

  function feed(deltas: readonly number[], parts: WheelParts = {}): { rig: CameraRig; d0: number } {
    const rig = makeRig();
    rig.setNavigation({ pointerDevice: 'trackpad' });
    configureRender({ camera: { zoomToCursor: 0 } });
    const d0 = rig.targetDistance;
    let t = 1000;
    for (const dy of deltas) {
      rig.handleWheel(wheel({ ...parts, deltaY: dy, timeStamp: t }));
      t += 8;
    }
    return { rig, d0 };
  }

  it('spends under two notches on the whole inertia tail', () => {
    expect(TAIL.reduce((a, b) => a + b, 0)).toBe(130);
    const { rig, d0 } = feed(TAIL);
    const notches = notchesOf(rig, d0);
    expect(
      notches,
      'the tail arrives AFTER the fingers lift; more than ~2 notches of it reads as a lurch. '
      + 'Reusing CAMERA_NAV.pinchZoomSensitivity here spends 4.5 — more than the whole 55 -> 36 m span.',
    ).toBeLessThan(2);
    // ...and it is a coast, not a no-op.
    expect(notches).toBeGreaterThan(0.5);
  });

  it('crosses a useful part of the range on one comfortable swipe', () => {
    // 320 px is a comfortable macOS swipe. The dolly is
    // ln(140/36)/ln(1.14) = 10.365 notches end to end, so this should be worth
    // roughly a quarter of it — enough to feel, far from a slam.
    const { rig, d0 } = feed(new Array<number>(40).fill(8));
    const notches = notchesOf(rig, d0);
    expect(notches, '320 px of swipe should be worth about three notches').toBeGreaterThan(2);
    expect(notches).toBeLessThan(5);
  });

  /**
   * THE PROPERTY THAT MAKES THE CLASSIFIER'S KNOWN FAILURE FREE.
   *
   * Section 1b pins a real defect: an axis-locked integer stream at or above
   * `coarseDeltaPx` is called a mouse for the rest of the session. With the
   * two sensitivity constants equal, that verdict changes NOTHING about a
   * vertical scroll — same verb, same notches, bit for bit.
   *
   * If this goes red, the defect in 1b has been re-armed. That may be a
   * deliberate choice once somebody has measured a real Mac; it must not be a
   * side effect. Read `CAMERA_NAV.trackpadZoomSensitivity` before changing it.
   */
  it('dollies identically whichever device the classifier decided on', () => {
    expect(CAMERA_NAV.trackpadZoomSensitivity).toBe(CAMERA_NAV.wheelZoomSensitivity);

    const run = (device: 'mouse' | 'trackpad'): number => {
      const rig = makeRig();
      rig.setNavigation({ pointerDevice: device });
      configureRender({ camera: { zoomToCursor: 0 } });
      let t = 1000;
      for (const dy of [60, 60, 60, 45, 30, 18, 9, 4]) {
        rig.handleWheel(wheel({ deltaY: dy, timeStamp: t }));
        t += 8;
      }
      return rig.targetDistance;
    };
    expect(run('trackpad')).toBe(run('mouse'));
  });

  it('keeps the pinch on its own per-pixel scale', () => {
    // A pinch sample is 0.5-3 px. Through the /100 branch it would be a
    // rounding error; through its own scale it is a real amount of zoom.
    const { rig, d0 } = feed(new Array<number>(20).fill(3), { ctrlKey: true });
    expect(notchesOf(rig, d0)).toBeCloseTo(60 * CAMERA_NAV.pinchZoomSensitivity, 6);
  });

  it('ships `zoom` as the default in the rig and in the settings store', () => {
    // A setting is not a fix if the default is still the broken behaviour, and
    // "we remembered to set it" is not a mechanism.
    expect(defaultNavigationOptions().trackpadScroll).toBe('zoom');
    expect(defaultSettings().gameplay.trackpadScroll).toBe('zoom');
  });
});

/* ==========================================================================
 * 3. Zoom range — the config bug this change also fixed
 * ========================================================================== */

describe('camera — the dolly covers its range instead of slamming to a limit', () => {
  it('treats CAMERA.zoomStep as a multiplier above 1', () => {
    // It was 0.12 and documented as a fraction, while `zoomBy` has always done
    // `distance * pow(zoomStep, notches)`. One notch collapsed the camera onto
    // a limit and there was nothing in between.
    expect(CAMERA.zoomStep).toBeGreaterThan(1);
    expect(CAMERA.zoomStep).toBeLessThan(1.5);
  });

  it('takes several notches to cross the whole range', () => {
    const rig = makeRig();
    configureRender({ camera: { zoomToCursor: 0 } });
    let notches = 0;
    while (rig.targetDistance < RENDER_CONFIG.camera.maxDistance - 0.01 && notches < 100) {
      rig.handleWheel(wheel({ deltaY: 100, timeStamp: 1000 + notches * 300 }));
      notches++;
    }
    expect(notches).toBeGreaterThan(4);
    expect(notches).toBeLessThan(40);
  });

  it('keeps Q/E yaw speed in degrees, which is what the rig converts from', () => {
    // Same class of bug: this was 1.4 and commented "radians/sec", but the rig
    // does degToRad() on it, so Q/E turned at 1.4 deg/s.
    expect(CAMERA.yawSpeed).toBeGreaterThan(20);
  });
});

/* ==========================================================================
 * 4. Momentum
 * ========================================================================== */

/** Feed a constant world-space pan speed for `seconds`, then coast. */
function drive(rig: CameraRig, speed: number, seconds: number, dt: number): void {
  for (let t = 0; t < seconds; t += dt) {
    rig.panBy(speed * dt, 0);
    rig.update(dt);
  }
}

function coast(rig: CameraRig, seconds: number, dt: number): number {
  const start = rig.targetFocus.x;
  for (let t = 0; t < seconds; t += dt) rig.update(dt);
  return rig.targetFocus.x - start;
}

describe('camera — pan momentum', () => {
  it('carries past the input and then settles', () => {
    const rig = makeRig();
    drive(rig, 40, 0.3, 1 / 60);
    const glide = coast(rig, 1.5, 1 / 60);
    expect(glide).toBeGreaterThan(1);

    // And it really does stop, rather than creeping forever.
    const residual = coast(rig, 1.0, 1 / 60);
    expect(residual).toBeLessThan(0.01);
  });

  it('glides the same distance at 60 fps and at 240 fps', () => {
    const slow = makeRig();
    drive(slow, 40, 0.4, 1 / 60);
    const slowGlide = coast(slow, 1.2, 1 / 60);

    const fast = makeRig();
    drive(fast, 40, 0.4, 1 / 240);
    const fastGlide = coast(fast, 1.2, 1 / 240);

    // A naive `lerp(a, b, 0.1)` would be 4x apart here.
    expect(Math.abs(slowGlide - fastGlide) / slowGlide).toBeLessThan(0.06);
  });

  it('does not coast at all when the player turns momentum off', () => {
    const rig = makeRig();
    rig.setNavigation({ momentum: false });
    drive(rig, 40, 0.3, 1 / 60);
    expect(Math.abs(coast(rig, 1.0, 1 / 60))).toBeLessThan(1e-6);
  });

  it('never flings from a jump — a minimap click lands where it was told', () => {
    const rig = makeRig();
    drive(rig, 60, 0.3, 1 / 60);
    rig.setFocus(100, 100);
    const x = rig.targetFocus.x;
    coast(rig, 1.0, 1 / 60);
    expect(rig.targetFocus.x).toBeCloseTo(x, 6);
  });

  it('caps the fling so a violent swipe cannot throw the camera off the map', () => {
    const rig = makeRig();
    // Ten thousand metres in one frame — a hostile input, not a human one.
    for (let i = 0; i < 8; i++) {
      rig.panBy(10000, 0);
      rig.update(1 / 60);
    }
    const glide = coast(rig, 2.0, 1 / 60);
    expect(glide).toBeLessThanOrEqual(CAMERA_NAV.momentumMaxSpeed / CAMERA_NAV.momentumDamping + 1);
  });
});

/* ==========================================================================
 * 5. Edge panning
 * ========================================================================== */

describe('camera — edge panning', () => {
  it('is off in the shipping config', () => {
    expect(CAMERA.edgePanPixels).toBe(0);
    // `RENDER_CONFIG.camera` still carries the renderer's own literal 8, so
    // assert the value that actually reaches it: `Bootstrap` calls
    // `pushCamera()` before `createCameraRig`, and that patch is built from the
    // core constant above. Asserting the render default instead would pass
    // while the boot path silently disagreed.
    expect(cameraPatch().camera?.edgePanPixels).toBe(0);
  });

  it('does nothing for a cursor parked in the band with no movement', () => {
    const rig = makeRig();
    configureRender({ camera: { edgePanPixels: 12 } });
    // No pointermove was ever delivered, so nothing is armed.
    const x0 = rig.targetFocus.x;
    for (let i = 0; i < 60; i++) rig.update(1 / 60);
    expect(rig.targetFocus.x).toBeCloseTo(x0, 6);
  });
});

/* ==========================================================================
 * 6. Centre on base
 * ========================================================================== */

describe('camera — centre on base', () => {
  it('glides to the home point the game set, not to the map centre', () => {
    const rig = makeRig();
    rig.setHome(64, 448);
    rig.panBy(120, -80);
    rig.centreOnHome();
    expect(rig.targetFocus.x).toBeCloseTo(64, 6);
    expect(rig.targetFocus.z).toBeCloseTo(448, 6);
    // Not immediate: the travel is what tells the player where they went.
    expect(rig.focus.x).not.toBeCloseTo(64, 1);
  });

  it('defaults home to wherever the rig was first focused', () => {
    const rig = makeRig();
    rig.panBy(100, 100);
    rig.centreOnHome();
    expect(rig.targetFocus.x).toBeCloseTo(256, 6);
    expect(rig.targetFocus.z).toBeCloseTo(256, 6);
  });
});

/* ==========================================================================
 * 7. Input ownership
 * ========================================================================== */

describe('camera — input ownership handover', () => {
  it('reserves right-drag for orders while a match owns the command layer', () => {
    expect(cameraMayArmRightDrag('full', true)).toBe(true);
    expect(cameraMayArmRightDrag('navigation', true)).toBe(false);
    expect(cameraMayArmRightDrag('none', true)).toBe(false);
    expect(cameraMayArmRightDrag('full', false)).toBe(false);
  });

  it('keeps the navigation gestures when the order layer takes the keyboard', () => {
    const rig = new CameraRig({ domElement: fakeElement(), attachInput: true });
    expect(rig.inputListeningMode).toBe('full');

    // This is what `input.system.ts` does on init. If it killed navigation the
    // entire trackpad scheme would be dead during an actual game.
    rig.detachInput();
    expect(rig.inputListeningMode).toBe('navigation');

    // The claim is OWNERSHIP — that a gesture is still consumed and still
    // moves the camera — not which verb it picks, so it is written against
    // the pan mode where "the dolly stayed put and the focus moved" is a
    // sharper statement than "something changed".
    const d0 = rig.targetDistance;
    rig.setNavigation({ pointerDevice: 'trackpad', trackpadScroll: 'pan' });
    rig.handleWheel(wheel({ deltaX: 12, deltaY: 12, timeStamp: 1000 }));
    expect(rig.targetDistance).toBeCloseTo(d0, 6);
    expect(rig.targetFocus.x).not.toBeCloseTo(256, 3);
  });

  it('still supports a total release for callers that want one', () => {
    const rig = new CameraRig({ domElement: fakeElement(), attachInput: true });
    rig.detachInput({ keepNavigation: false });
    expect(rig.inputListeningMode).toBe('none');
  });

  it('never wakes input up in ?shot= mode, where nothing was attached', () => {
    const rig = new CameraRig({ domElement: fakeElement(), attachInput: false });
    expect(rig.inputListeningMode).toBe('none');
    rig.detachInput();
    expect(rig.inputListeningMode).toBe('none');
  });

  it('ignores every gesture while the shell has the input disabled', () => {
    const rig = makeRig();
    rig.setInputEnabled(false);
    const d0 = rig.targetDistance;
    const x0 = rig.targetFocus.x;
    expect(rig.handleWheel(wheel({ deltaY: 100, timeStamp: 1000 }))).toBe(false);
    expect(rig.targetDistance).toBeCloseTo(d0, 6);
    expect(rig.targetFocus.x).toBeCloseTo(x0, 6);
  });
});

/* ==========================================================================
 * 8. THE KEYBOARD ZOOM
 *
 * Reported as "Im trying to play from mac using a trackpad, and cant zoom or
 * scroll on z". Before `cam.zoomIn` / `cam.zoomOut` there were FIFTEEN `cam.*`
 * actions and not one touched the dolly: `zoomBy` had exactly two callers and
 * both were wheel-driven, so every route to the zoom depended on a `wheel`
 * event arriving with the shape the browser is documented to send.
 *
 * This is the half of the fix that is immune to every macOS unknown — it needs
 * no pointing device, no classifier verdict and no event shape. Everything
 * else in this file is our code's response to documentation; this is not.
 * ========================================================================== */

describe('camera — the held-key zoom', () => {
  /** What `input.system.ts` does per frame while a zoom key is down. */
  function holdZoomIn(rig: CameraRig, seconds: number, dt: number): void {
    for (let t = 0; t < seconds - 1e-9; t += dt) {
      rig.zoomBy(-CAMERA_NAV.keyZoomNotchesPerSecond * Math.min(dt, 0.1));
    }
  }

  it('lands on the same distance at 60 fps and at 240 fps', () => {
    // `zoomBy` composes — `pow(s, a) * pow(s, b) === pow(s, a + b)` — so a
    // per-frame `zoomBy(rate * dt)` lands on exactly `zoomStep^(rate * Σdt)`
    // however the frames fall. That is frame-rate independence BY
    // CONSTRUCTION, not by tuning, and it is the reason the poll may call
    // `zoomBy` every frame at all.
    //
    // WHAT THIS CATCHES IS A `zoomBy` THAT STOPS COMPOSING — replace the
    // `Math.pow` with a linear `1 + (zoomStep - 1) * notches` and this goes
    // red. It deliberately does NOT distinguish multiplicative from
    // additive-scaled-by-dt — both compose — and an earlier draft of this
    // comment claimed it did. The argument for multiplicative is
    // `CameraRig.zoomBy`'s: a dolly is a ratio, so a notch must mean the same
    // 13% at 36 m as at 140.
    //
    // WHAT IT CANNOT CATCH IS THE MISSING `dt`, and a previous draft of this
    // comment claimed exactly that. `holdZoomIn` below RE-IMPLEMENTS the poll
    // rather than driving it, so deleting `* d` from `input.system.ts` leaves
    // this test — and the whole suite — green. Measured: it does. The `dt` is
    // pinned structurally instead, in `scales the held-key zoom by the frame
    // delta` below, which is the only reader that can see that line.
    const slow = makeRig();
    const fast = makeRig();
    holdZoomIn(slow, 1.0, 1 / 60);
    holdZoomIn(fast, 1.0, 1 / 240);
    expect(fast.targetDistance).toBeCloseTo(slow.targetDistance, 9);

    // ...and it really moved, so the equality above is not two no-ops agreeing.
    expect(slow.targetDistance).toBeLessThan(55 - 5);
  });

  it('crosses the whole dolly range in a few seconds, not in a flick', () => {
    const range = Math.log(RENDER_CONFIG.camera.maxDistance / RENDER_CONFIG.camera.gameplayMinDistance)
      / Math.log(RENDER_CONFIG.camera.zoomStep);
    expect(range).toBeCloseTo(10.365, 3);

    const seconds = range / CAMERA_NAV.keyZoomNotchesPerSecond;
    expect(seconds, 'a held key that crosses the range in under a second is a slam')
      .toBeGreaterThan(1.5);
    expect(seconds, 'a held key that takes ten seconds reads as broken').toBeLessThan(6);
  });

  it('player zoom bottoms out at gameplayMinDistance and tops out at maxDistance', () => {
    const inward = makeRig();
    holdZoomIn(inward, 20, 1 / 60);
    expect(inward.targetDistance).toBeCloseTo(RENDER_CONFIG.camera.gameplayMinDistance, 6);

    const outward = makeRig();
    for (let t = 0; t < 20; t += 1 / 60) {
      outward.zoomBy(CAMERA_NAV.keyZoomNotchesPerSecond / 60);
    }
    expect(outward.targetDistance).toBeCloseTo(RENDER_CONFIG.camera.maxDistance, 6);
  });

  it('retains the lower absolute floor for authored camera poses', () => {
    const rig = makeRig();
    rig.setDistance(RENDER_CONFIG.camera.minDistance, true);
    expect(rig.targetDistance).toBeCloseTo(RENDER_CONFIG.camera.minDistance, 6);

    rig.zoomBy(-1);
    expect(rig.targetDistance).toBeCloseTo(RENDER_CONFIG.camera.gameplayMinDistance, 6);
  });

  /**
   * THE WIRING, READ FROM THE SOURCE.
   *
   * The poll itself lives in `src/input/input.system.ts`, which reaches for
   * `ctx()` and cannot be driven from this suite. A catalogue row with no
   * consumer is exactly the failure `Shell.playCampaignBeat` shipped — a value
   * authored, validated and dropped on one line — so the seam is checked
   * structurally instead.
   *
   * COMMENTS ARE STRIPPED FIRST. `tests/campaign-presentation.spec.ts` records
   * why: its first draft passed with the one live line commented out, because
   * `// sayEva(...)` still contains the token being matched.
   */
  it('is actually polled by the input system', () => {
    const src = stripLineAndBlockComments(
      readFileSync(new URL('../src/input/input.system.ts', import.meta.url), 'utf8'),
    );
    expect(src).toContain("held('cam.zoomIn'");
    expect(src).toContain("held('cam.zoomOut'");
    expect(src).toContain('rig.zoomBy(');
    expect(src).toContain('CAMERA_NAV.keyZoomNotchesPerSecond');
  });

  /**
   * THE `dt`, WHICH NOTHING BEHAVIOURAL CAN SEE.
   *
   * `holdZoomIn` above re-implements the poll, so it measures `zoomBy`'s
   * compositional property and says nothing about the line that feeds it.
   * Deleting `* d` from `input.system.ts` — a fixed step per frame, 4x faster
   * at 240 fps, the exact class of bug `camera.ts`'s DAMPING header names —
   * left the entire suite green. This is the reader that sees it.
   *
   * The delta's IDENTIFIER is derived from the source rather than spelled `d`
   * here, so renaming the local reports the rename it is rather than a
   * missing `dt` it is not.
   */
  it('scales the held-key zoom by the frame delta, like every rate beside it', () => {
    const src = stripLineAndBlockComments(
      readFileSync(new URL('../src/input/input.system.ts', import.meta.url), 'utf8'),
    );
    const fn = src.slice(src.indexOf('function updateCamera('));
    const body = fn.slice(0, fn.indexOf('\n}'));

    const delta = /const\s+(\w+)\s*=\s*Math\.min\(dt,/.exec(body)?.[1];
    expect(delta, '`updateCamera` no longer clamps `dt` into a local').toBeTruthy();

    // The pan speed on the next line already multiplies by it; the zoom rate
    // must too, or a held key is frame-rate dependent and nothing says so.
    expect(
      new RegExp(`zoomRate\\s*=\\s*CAMERA_NAV\\.keyZoomNotchesPerSecond\\s*\\*\\s*${delta}\\b`)
        .test(body),
      'the held-key zoom rate is not scaled by the clamped frame delta, so it '
      + 'is 4x faster at 240 fps than at 60. No behavioural test in this file '
      + 'can see that line — `holdZoomIn` re-implements the poll.',
    ).toBe(true);
  });

  it('names two rows the settings store will actually persist', () => {
    // `action-catalogue.spec.ts` owns the general rule in both directions;
    // this pins the two ids and their chosen keys, because "= and - were free"
    // is a claim about the whole default scheme and is worth failing on.
    for (const id of ['cam.zoomIn', 'cam.zoomOut']) {
      expect(KEYBINDS.some((k) => k.id === id), id).toBe(true);
    }
    expect(KEYBINDS.find((k) => k.id === 'cam.zoomIn')?.def.code).toBe('Equal');
    expect(KEYBINDS.find((k) => k.id === 'cam.zoomOut')?.def.code).toBe('Minus');
    expect(findConflicts(defaultBindings())).toEqual([]);
  });
});

/** Strip `//` and block comments so a structural read cannot match a comment. */
function stripLineAndBlockComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
