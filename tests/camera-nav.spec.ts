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
 *   Chrome / Safari, macOS, two-finger swipe deltaMode 0, small deltas often
 *                                            fractional, deltaX usually non-
 *                                            zero, one event per frame
 *   macOS pinch-to-zoom                      a wheel event with ctrlKey TRUE
 *                                            and a small deltaY
 *
 * There is a second, stronger pass in a real headless Chromium that dispatches
 * genuine `WheelEvent`s at the live canvas; this file is the part that runs on
 * every commit.
 * ============================================================================
 */

import { describe, expect, it, beforeEach } from 'vitest';
import * as THREE from 'three';

import {
  CameraRig,
  classifyWheelEvent,
  createWheelDeviceState,
  type WheelSample,
} from '../src/render/camera';
import { RENDER_CONFIG, configureRender } from '../src/render/renderer';
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

  it('PANS on a two-finger trackpad swipe and leaves the dolly put', () => {
    const rig = makeRig();
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
    expect(rig.targetDistance).toBeCloseTo(d0, 6);
    // Yaw is 0, so +deltaX is +worldX and +deltaY is "further into the map".
    expect(rig.targetFocus.x).toBeGreaterThan(x0 + 0.5);
    expect(rig.targetFocus.z).toBeGreaterThan(z0 + 0.5);
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
    const forcedTrackpad = makeRig();
    forcedTrackpad.setNavigation({ pointerDevice: 'trackpad' });
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
    rig.setNavigation({ pointerDevice: 'trackpad', invertPanX: true, invertPanY: true });
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
  it('keeps the navigation gestures when the order layer takes the keyboard', () => {
    const rig = new CameraRig({ domElement: fakeElement(), attachInput: true });
    expect(rig.inputListeningMode).toBe('full');

    // This is what `input.system.ts` does on init. If it killed navigation the
    // entire trackpad scheme would be dead during an actual game.
    rig.detachInput();
    expect(rig.inputListeningMode).toBe('navigation');

    const d0 = rig.targetDistance;
    rig.setNavigation({ pointerDevice: 'trackpad' });
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
