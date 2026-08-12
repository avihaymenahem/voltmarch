/**
 * ============================================================================
 * tests/shot-camera.spec.ts — the scorecard must keep measuring the same camera
 * ============================================================================
 * VOLTMARCH grades itself against a 40-point weighted scorecard over twelve
 * fixtures. That grade is a measurement of the ART, and it only is one while
 * the CAMERA is identical between runs. Nothing downstream can tell a pitch
 * that moved two degrees from a lighting change — both show up as a shifted
 * luminance histogram, and the repo has twice acted on a contaminated grade.
 *
 * Pitch was safe for free until now: `CameraRig` derived it from the dolly and
 * had no second writer. It is becoming player state. This file is the standing
 * proof that it cannot reach a capture run.
 *
 * FIVE CLAIMS, EACH TESTED SEPARATELY
 * -----------------------------------
 *   1. Every fixture spec carries an EXPLICIT pitch. A scenario added without
 *      one is a fixture shot at whatever pose it inherited.
 *   2. Those pitches are the camera the config actually describes — re-derived
 *      here from `RENDER_CONFIG`, so a config edit turns this red instead of
 *      silently moving the grade.
 *   3. `canonicalPitchDeg` agrees with a REAL `CameraRig`. It is deliberately a
 *      second implementation of the rig's zoom curve; this is what stops the
 *      two drifting.
 *   4. The canonical pose is what the rig REPORTS after posing — not what the
 *      setter was handed.
 *   5. A deliberately wrong pose is REJECTED. A guard nobody has watched fire
 *      is indistinguishable from no guard, and this repo has shipped exactly
 *      that before.
 *
 * The twelve-entry table inside `tools/shoot.mjs` is checked here too, by
 * reading the file. That is not elegant, but the alternative is a harness
 * whose declared pitches are unverified, and the harness is the thing that
 * feeds the grade.
 * ============================================================================
 */

import { describe, expect, it, beforeEach } from 'vitest';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { CameraRig } from '../src/render/camera';
import { RENDER_CONFIG, configureRender } from '../src/render/renderer';
import {
  canonicalPitchDeg,
  comparePoseDeg,
  DEFAULT_POSE_TOLERANCE,
  type CameraPoseDeg,
} from '../src/render/debug';
import { SCENARIO_PITCH_DEG, scenarioPitchDeg } from '../src/game/scenarios.system';
import { SCENARIO_NAMES, planScenario } from '../src/game/Scenarios';

/* ==========================================================================
 * Fixtures
 * ========================================================================== */

const VIEW_W = 2560;
const VIEW_H = 1440;

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

function makeRig(): CameraRig {
  return new CameraRig({ domElement: fakeElement(), attachInput: false, aspect: VIEW_W / VIEW_H });
}

/** The rig's pose in degrees — the same conversion `__VM.getCameraPoseDeg` does. */
function poseDegOf(rig: CameraRig): CameraPoseDeg {
  const p = rig.getPose();
  return {
    x: p.x,
    z: p.z,
    yawDeg: THREE.MathUtils.radToDeg(p.yaw),
    pitchDeg: THREE.MathUtils.radToDeg(p.pitch),
    distance: p.distance,
  };
}

/** The camera config the harness is calibrated against, restored between cases. */
const SHIPPING_CAMERA = {
  minDistance: RENDER_CONFIG.camera.minDistance,
  maxDistance: RENDER_CONFIG.camera.maxDistance,
  pitchAtMinDistance: RENDER_CONFIG.camera.pitchAtMinDistance,
  pitchAtMaxDistance: RENDER_CONFIG.camera.pitchAtMaxDistance,
};

beforeEach(() => {
  configureRender({ camera: { ...SHIPPING_CAMERA } });
});

/* ==========================================================================
 * 1. Every fixture declares a pitch
 * ========================================================================== */

describe('the canonical pitch table', () => {
  it('has an explicit entry for every scenario the harness can ask for', () => {
    for (const name of SCENARIO_NAMES) {
      const deg = SCENARIO_PITCH_DEG[name];
      expect(deg, `SCENARIO_PITCH_DEG is missing '${name}'`).toBeTypeOf('number');
      expect(Number.isFinite(deg)).toBe(true);
    }
  });

  it('declares nothing outside the rig\'s own pitch range', () => {
    const lo = RENDER_CONFIG.camera.pitchAtMinDistance;
    const hi = RENDER_CONFIG.camera.pitchAtMaxDistance;
    for (const name of SCENARIO_NAMES) {
      const deg = SCENARIO_PITCH_DEG[name];
      expect(deg, `'${name}' pitch ${deg} is outside ${lo}..${hi}`).toBeGreaterThanOrEqual(lo);
      expect(deg).toBeLessThanOrEqual(hi);
    }
  });

  it('carries no entry the scenario router does not know about', () => {
    const known = new Set<string>(SCENARIO_NAMES);
    for (const name of Object.keys(SCENARIO_PITCH_DEG)) {
      expect(known.has(name), `SCENARIO_PITCH_DEG has a stale '${name}' entry`).toBe(true);
    }
  });

  it('is the pitch the config curve prescribes at each plan\'s dolly', () => {
    // This is the claim that keeps the guard from MOVING the thing it guards:
    // the pinned pitch is the pitch these fixtures already rendered at.
    for (const name of SCENARIO_NAMES) {
      const plan = planScenario(name);
      const wanted = canonicalPitchDeg(plan.distance);
      expect(
        Math.abs(SCENARIO_PITCH_DEG[name] - wanted),
        `'${name}' declares ${SCENARIO_PITCH_DEG[name]} deg but the curve at ` +
          `${plan.distance} m gives ${wanted.toFixed(4)} deg`,
      ).toBeLessThan(0.001);
    }
  });

  it('reports a miss loudly rather than inventing a pose', () => {
    // A fallback is correct here — a fixture with no pitch must still be
    // REPRODUCIBLE — but it must never be silent.
    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (msg: unknown) => { warnings.push(String(msg)); };
    try {
      const deg = scenarioPitchDeg('a-scenario-nobody-declared');
      expect(Number.isFinite(deg)).toBe(true);
    } finally {
      console.warn = original;
    }
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain('SCENARIO_PITCH_DEG');
  });
});

/* ==========================================================================
 * 2. The second implementation agrees with the rig
 * ========================================================================== */

describe('canonicalPitchDeg', () => {
  const DISTANCES = [30, 34, 36, 38, 42, 48, 50, 55, 58, 62];

  it('matches what a real CameraRig arrives at, at every fixture dolly', () => {
    const rig = makeRig();
    try {
      for (const d of DISTANCES) {
        rig.clearPitchOverride();
        rig.setDistance(d, true);
        const actual = THREE.MathUtils.radToDeg(rig.getPose().pitch);
        expect(
          Math.abs(actual - canonicalPitchDeg(d)),
          `rig says ${actual.toFixed(4)} deg at ${d} m, canonicalPitchDeg says ` +
            `${canonicalPitchDeg(d).toFixed(4)}`,
        ).toBeLessThan(1e-6);
      }
    } finally {
      rig.dispose();
    }
  });

  it('clamps at both ends of the dolly range', () => {
    const cfg = RENDER_CONFIG.camera;
    expect(canonicalPitchDeg(cfg.minDistance - 50)).toBeCloseTo(cfg.pitchAtMinDistance, 9);
    expect(canonicalPitchDeg(cfg.maxDistance + 50)).toBeCloseTo(cfg.pitchAtMaxDistance, 9);
  });

  it('follows the config rather than hard-coding the shipping numbers', () => {
    configureRender({ camera: { pitchAtMinDistance: 20, pitchAtMaxDistance: 80 } });
    expect(canonicalPitchDeg(RENDER_CONFIG.camera.minDistance)).toBeCloseTo(20, 9);
    expect(canonicalPitchDeg(RENDER_CONFIG.camera.maxDistance)).toBeCloseTo(80, 9);
  });
});

/* ==========================================================================
 * 3. The pose the rig REPORTS is the pose that was asked for
 * ========================================================================== */

describe('posing a fixture', () => {
  it('reports back the pitch, yaw and dolly it was given', () => {
    const rig = makeRig();
    try {
      for (const name of SCENARIO_NAMES) {
        const plan = planScenario(name);
        const pitchDeg = SCENARIO_PITCH_DEG[name];
        rig.setPose({
          x: 256,
          z: 256,
          distance: plan.distance,
          yaw: THREE.MathUtils.degToRad(plan.yawDeg),
          pitch: THREE.MathUtils.degToRad(pitchDeg),
          immediate: true,
        });

        const check = comparePoseDeg(
          { yawDeg: plan.yawDeg, pitchDeg, distance: plan.distance },
          poseDegOf(rig),
        );
        expect(check.ok, `${name}: ${check.summary}`).toBe(true);
      }
    } finally {
      rig.dispose();
    }
  });

  it('keeps the pinned pitch across a focus move — focusOn must not release it', () => {
    // `tools/shoot.mjs` calls focusOn AFTER the scenario system has pinned the
    // pitch. If a focus change quietly reverted to the zoom curve, every shot
    // would be captured at a pitch nobody declared.
    const rig = makeRig();
    try {
      rig.setPose({ distance: 62, pitch: THREE.MathUtils.degToRad(48.4558), immediate: true });
      rig.setPose({ x: 300, z: 200, immediate: true });
      expect(poseDegOf(rig).pitchDeg).toBeCloseTo(48.4558, 4);
    } finally {
      rig.dispose();
    }
  });

  it('overwrites a pitch a player already chose', () => {
    // THE LEAK CASE. Whatever put a pitch on the rig — a persisted setting, a
    // keybinding, a previous scene — posing the fixture must win outright.
    const rig = makeRig();
    try {
      rig.setPose({ pitch: THREE.MathUtils.degToRad(28), immediate: true });
      expect(poseDegOf(rig).pitchDeg).toBeCloseTo(28, 6);

      const canonical = SCENARIO_PITCH_DEG['allied-base'];
      rig.setPose({
        x: 256, z: 256, distance: 62,
        yaw: THREE.MathUtils.degToRad(24),
        pitch: THREE.MathUtils.degToRad(canonical),
        immediate: true,
      });

      const check = comparePoseDeg({ pitchDeg: canonical, yawDeg: 24 }, poseDegOf(rig));
      expect(check.ok, check.summary).toBe(true);
    } finally {
      rig.dispose();
    }
  });
});

/* ==========================================================================
 * 4. A wrong pose is REJECTED — the guard observed firing
 * ========================================================================== */

describe('the pose guard', () => {
  const AT_62: CameraPoseDeg = { x: 256, z: 256, yawDeg: 24, pitchDeg: 48.4558, distance: 62 };

  it('accepts the canonical pose', () => {
    expect(comparePoseDeg({ yawDeg: 24, pitchDeg: 48.4558, distance: 62 }, AT_62).ok).toBe(true);
  });

  it('rejects a pitch a player might plausibly have chosen', () => {
    const check = comparePoseDeg({ pitchDeg: 38 }, AT_62);
    expect(check.ok).toBe(false);
    expect(check.mismatches.map((m) => m.field)).toEqual(['pitchDeg']);
    expect(check.summary).toContain('pitchDeg');
  });

  it('rejects a pitch off by barely more than the tolerance', () => {
    const off = DEFAULT_POSE_TOLERANCE.angleDeg * 1.5;
    expect(comparePoseDeg({ pitchDeg: 48.4558 + off }, AT_62).ok).toBe(false);
    expect(comparePoseDeg({ pitchDeg: 48.4558 + off * 0.5 }, AT_62).ok).toBe(true);
  });

  it('rejects a yaw or a dolly that moved', () => {
    expect(comparePoseDeg({ yawDeg: 0 }, AT_62).ok).toBe(false);
    expect(comparePoseDeg({ distance: 55 }, AT_62).ok).toBe(false);
  });

  it('rejects NaN rather than letting it compare as equal', () => {
    const broken: CameraPoseDeg = { ...AT_62, pitchDeg: Number.NaN };
    const check = comparePoseDeg({ pitchDeg: 48.4558 }, broken);
    expect(check.ok).toBe(false);
  });

  it('treats yaw as a bearing, so 24 and 384 degrees are the same camera', () => {
    const wrapped: CameraPoseDeg = { ...AT_62, yawDeg: 384 };
    expect(comparePoseDeg({ yawDeg: 24 }, wrapped).ok).toBe(true);
    const negative: CameraPoseDeg = { ...AT_62, yawDeg: -336 };
    expect(comparePoseDeg({ yawDeg: 24 }, negative).ok).toBe(true);
  });

  it('checks only the fields it was given', () => {
    expect(comparePoseDeg({}, AT_62).ok).toBe(true);
    expect(comparePoseDeg({ pitchDeg: 48.4558 }, { ...AT_62, yawDeg: 99 }).ok).toBe(true);
  });
});

/* ==========================================================================
 * 5. The harness table is the camera the config describes
 * ========================================================================== */

describe('tools/shoot.mjs', () => {
  const source = readFileSync(
    fileURLToPath(new URL('../tools/shoot.mjs', import.meta.url)),
    'utf8',
  );

  /** Every `camera: { distance: N, pitchDeg: M }` block in the shot table. */
  function declaredCameras(): Array<{ distance: number; pitchDeg: number }> {
    const re = /camera:\s*\{\s*distance:\s*([\d.]+),\s*pitchDeg:\s*([\d.]+)\s*\}/g;
    const out: Array<{ distance: number; pitchDeg: number }> = [];
    for (const m of source.matchAll(re)) {
      out.push({ distance: Number(m[1]), pitchDeg: Number(m[2]) });
    }
    return out;
  }

  it('declares a canonical camera for every shot in the table', () => {
    /*
     * THIRTEEN SINCE `13-atoll-crossing` LANDED, and the number is restated in
     * three places that must move together: here, the `rows.length` floor in
     * `tools/metrics.mjs`, and whatever `--expect N` a caller passes it.
     *
     * The floor is not decoration. `metrics.mjs` aggregates a WEIGHTED score
     * across every image it is handed, and scenario mix dominates that number —
     * a run over four shots and a run over thirteen are not comparable figures
     * even when nothing about the art has changed. So a short sample warns
     * loudly rather than quietly reporting a better score.
     */
    expect(declaredCameras().length).toBe(13);
  });

  it('declares a pitch that matches the config curve at each shot\'s dolly', () => {
    for (const cam of declaredCameras()) {
      const wanted = canonicalPitchDeg(cam.distance);
      expect(
        Math.abs(cam.pitchDeg - wanted),
        `shoot.mjs declares ${cam.pitchDeg} deg at ${cam.distance} m; the curve gives ` +
          `${wanted.toFixed(4)} deg. Re-derive the table before capturing.`,
      ).toBeLessThan(0.001);
    }
  });

  it('refuses the run rather than warning when the pose is wrong', () => {
    // The distinction that matters: a warning scrolls past in a 12-shot run and
    // the images get scored anyway. Assert the refusal is a `throw`, and that
    // the process exits non-zero when a shot fails.
    expect(source).toContain('camera is not at the canonical pose');
    expect(source).toMatch(/throw new Error\(\s*`camera is not at the canonical pose/);
    expect(source).toContain('process.exit(4)');
    expect(source).toMatch(/if \(failed\.length\) \{[\s\S]*process\.exit\(1\)/);
  });

  it('applies the canonical pitch through the same fail-loud pose path', () => {
    expect(source).toContain("'setCameraPitchDeg'");
    expect(source).toContain('__VM is missing');
  });
});
