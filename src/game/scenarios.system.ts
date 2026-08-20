/**
 * ============================================================================
 * VOLTMARCH — src/game/scenarios.system.ts
 * ============================================================================
 * THE SCENARIO SYSTEM — reads the boot flags, builds the fixture, poses the
 * camera, and publishes the spec every other module reads.
 *
 * WHY IT INITS LAST
 * -----------------
 * `phase: Phase.Cleanup` with a very high `order` puts this module at the END
 * of the registry's init sweep (`SystemRegistry.init` sorts by phase, then
 * order, then registration sequence). That matters three times over:
 *
 *   - Terrain must have replaced `world.terrain` before a single building calls
 *     `heightAt` or `markOccupied`, or every structure sits at y = 0 on a
 *     heightfield that has hills in it.
 *   - The def tables and the ModelRegistry must exist before the first spawn,
 *     so entities carry real `defId`s and the bridge draws real meshes.
 *   - `settleTicks` runs the whole simulation forward, which requires every
 *     other system to be alive.
 *
 * WHY IT PRE-ADVANCES THE SIM
 * ---------------------------
 * `?shot=` boots paused (see Bootstrap.start), and `tools/shoot.mjs`'s
 * `advance` only sleeps wall-clock time — with the loop paused that advances
 * nothing. So the "in motion" fixtures (battle, economy, naval) step the sim
 * here instead, through `loop.runHeadless(n)`. Deterministic, instant, and
 * identical on a slow CI box and a fast workstation, which the wall-clock path
 * is not.
 *
 * ============================================================================
 * WHY PITCH IS PINNED UNDER `?shot=` AND FREE EVERYWHERE ELSE
 * ============================================================================
 * The 40-point scorecard in docs/RA3_LOOK_BIBLE.md is a measurement of the ART.
 * It is only a measurement of the art if the CAMERA is identical between runs.
 * Yaw and dolly have always been pinned here for exactly that reason.
 *
 * Pitch was safe without being pinned: `CameraRig` derived it from the dolly
 * distance and there was no other writer. That is ending — pitch is becoming
 * player state — and a player-chosen pitch reaching a capture run would move
 * the grade while every art asset stayed exactly where it was. The repo has
 * twice drawn conclusions from a contaminated grade (a score computed from 2 of
 * 12 images; a run that photographed the boot curtain) and both cost real time.
 *
 * So under `?shot=` the fixture DECLARES its pitch, this module writes it, and
 * then READS IT BACK off the rig — a setter that silently did nothing is
 * precisely the failure a "we set it, so it is set" assumption cannot catch.
 * The result is published on `__VM.hooks.canonicalPose()`, and
 * `tools/shoot.mjs` refuses to open the shutter unless it says `ok`.
 *
 * Without `?shot=` nothing is pinned. A match is not a fixture: pitch belongs
 * to the zoom curve and to the player, and this module must not take it away.
 * ============================================================================
 */

import { defineSystem } from '../core/loop';
import { Phase, RenderPhase } from '../core/types';
import type { RenderContext } from '../core/types';
import { DEFAULT_SEED } from '../core/config';
import { DEG2RAD, RAD2DEG } from '../core/math';
import {
  comparePoseDeg,
  DEFAULT_POSE_TOLERANCE,
  type CameraPoseAssertion,
  type CameraPoseDeg,
} from '../render/debug';
import type { CameraRig, CameraPose } from '../render/camera';
import { ctx } from './context';
import {
  buildScenario,
  clearScenario,
  resolveDefBinding,
  bootScenarioName,
  SCENARIO_NAMES,
  type DefBinding,
  type ScenarioSpec,
} from './Scenarios';

/** The stub module Bootstrap registers before discovery runs. */

/* -------------------------------------------------------------------------- */
/* Boot flags                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Read a URL flag. Returns null outside a browser (unit tests, workers) so this
 * module is importable from a node context without touching `location`.
 */
function flag(name: string): string | null {
  if (typeof location === 'undefined') return null;
  const v = new URLSearchParams(location.search).get(name);
  return v === null || v === '' ? null : v;
}

function seedFlag(): number {
  const raw = flag('seed');
  if (raw === null) return DEFAULT_SEED;
  const n = Number(raw);
  // A NaN seed would silently make every "deterministic" fixture random.
  return Number.isFinite(n) ? Math.trunc(n) : DEFAULT_SEED;
}

/* ==========================================================================
 * THE CANONICAL FIXTURE PITCH TABLE
 *
 * One entry per name in `SCENARIO_NAMES`; `tests/shot-camera.spec.ts` fails if
 * a scenario is ever added without one, because a fixture with no declared
 * pitch is a fixture whose camera is whatever the rig happened to be in.
 *
 * EVERY VALUE IS THE PITCH THAT FIXTURE ALREADY RENDERS AT, to four decimals.
 * That is the entire point: pinning the pose must not move a single pixel, so
 * the baseline grade stays comparable across the change that introduced the
 * guard. Each one is the rig's own zoom curve evaluated at the plan's dolly:
 *
 *     t   = clamp((distance - minDistance) / (maxDistance - minDistance), 0, 1)
 *     deg = lerp(pitchAtMinDistance, pitchAtMaxDistance, t * t * (3 - 2t))
 *
 * with the shipping camera config (30 .. 140 m, 46 .. 58 deg). The test
 * re-derives every row from `RENDER_CONFIG` and from a live `CameraRig`, so a
 * config change that invalidates the table is a red test, not a moved grade.
 *
 * STRUCTURED TO BE LIFTED. When `src/game/Scenarios.ts` and
 * `src/core/config.ts` are free, this becomes `ScenarioCamera.pitchDeg` on each
 * plan in `PLANS` and the lookup below collapses to `spec.camera.pitchDeg`.
 * Nothing else about this file has to change.
 * ========================================================================== */

export const SCENARIO_PITCH_DEG: Readonly<Record<string, number>> = {
  skirmish: 47.9367,          // d = 58
  'allied-base': 48.4558,     // d = 62
  'soviet-base': 48.4558,     // d = 62
  'terrain-showcase': 46.0000, // d = 30 (the zoom floor)
  'unit-parade': 48.4558,     // d = 62
  battle: 46.8588,            // d = 48
  economy: 46.3973,           // d = 42
  naval: 47.5778,             // d = 55
  placement: 46.1032,         // d = 36
  selection: 46.0464,         // d = 34
  blob: 47.0458,              // d = 50
  atoll: 48.4558,             // d = 62
  // A FIXTURE-TABLE ROW, NOT A DESIGN CONSTRAINT ON 37 OPERATIONS.
  // `applyCanonicalPose` writes pitch only when `enforced`, and off the harness
  // path "pitch is NOT ours" — so this binds under `?shot=campaign` and nowhere
  // else. It exists because `scenarioPitchDeg` warns and falls back for a name
  // it does not know, and a warning on every campaign boot is noise that trains
  // people to ignore the console.
  campaign: 47.9367,          // d = 58, the same dolly as `skirmish`
};

/**
 * The pitch the named fixture is photographed at.
 *
 * A miss is LOUD and falls back to the default scenario's value rather than to
 * "whatever the rig thinks", because the silent version of this — a new
 * scenario quietly inheriting live camera state — is the exact defect the whole
 * guard exists to prevent.
 */
export function scenarioPitchDeg(name: string): number {
  const deg = SCENARIO_PITCH_DEG[name];
  if (deg !== undefined) return deg;
  const fallback = SCENARIO_PITCH_DEG[SCENARIO_NAMES[0]];
  console.warn(
    `[scenario] no canonical pitch for '${name}' — add it to SCENARIO_PITCH_DEG. ` +
      `Using ${fallback} deg so the frame is at least reproducible.`,
  );
  return fallback;
}

/* -------------------------------------------------------------------------- */
/* Published pose report                                                      */
/* -------------------------------------------------------------------------- */

/** What `__VM.hooks.canonicalPose()` answers with. `tools/shoot.mjs` reads it. */
export interface CanonicalPoseReport {
  /** Resolved scenario name. */
  scenario: string;
  /** True when `?shot=` was on the URL and the pose is therefore PINNED. */
  enforced: boolean;
  /** The pose this fixture declares. */
  expected: CameraPoseDeg;
  /** What the rig reported straight after being posed. */
  actual: CameraPoseDeg;
  /** False means the rig did not take the pose. A capture must refuse. */
  ok: boolean;
  /** Human-readable mismatch list; empty when `ok`. */
  summary: string;
}

let spec: ScenarioSpec | null = null;
let enforced = false;
let report: CanonicalPoseReport | null = null;

/** Scratch, so re-asserting the pose on frames 0..4 allocates nothing. */
const poseScratch: CameraPose = { x: 0, z: 0, yaw: 0, pitch: 0, distance: 0 };

function expectedPose(s: ScenarioSpec): CameraPoseDeg {
  return {
    x: s.camera.x,
    z: s.camera.z,
    yawDeg: s.camera.yawDeg,
    pitchDeg: scenarioPitchDeg(s.name),
    distance: s.camera.distance,
  };
}

function readPoseDeg(rig: CameraRig): CameraPoseDeg {
  rig.getPose(poseScratch);
  return {
    x: poseScratch.x,
    z: poseScratch.z,
    yawDeg: poseScratch.yaw * RAD2DEG,
    pitchDeg: poseScratch.pitch * RAD2DEG,
    distance: poseScratch.distance,
  };
}

/**
 * Measure the rig against what the fixture declares.
 *
 * WHAT IS CHECKED, AND WHY IT IS NOT EVERYTHING
 *
 *   yaw       ALWAYS. Nothing downstream is allowed to re-yaw a fixture, and a
 *             yaw that came back different means a second writer exists.
 *   pitch     Only under `?shot=`, and only while the rig is still at the
 *             dolly this scenario declared. `tools/shoot.mjs` legitimately
 *             re-dollies some shots (02-hud-full frames the same base at 55 m
 *             rather than 62 m), and the canonical pitch for THAT frame is the
 *             harness's to declare, not ours. Asserting our pitch against a
 *             frame we no longer own would be a guard that cries wolf, which
 *             is worse than no guard — those get disabled.
 *   focus     Never. `focusOn` moves it on purpose, on every shot.
 *   distance  Never. The rig clamps to CAMERA.min/maxDistance and a fixture may
 *             legally ask for a dolly outside that range.
 */
function verifyPose(rig: CameraRig, s: ScenarioSpec): CanonicalPoseReport {
  const expected = expectedPose(s);
  const actual = readPoseDeg(rig);

  const stillAtDeclaredDolly =
    Math.abs(actual.distance - expected.distance) <= DEFAULT_POSE_TOLERANCE.metres;

  const wanted: Partial<CameraPoseDeg> = { yawDeg: expected.yawDeg };
  if (enforced && stillAtDeclaredDolly) wanted.pitchDeg = expected.pitchDeg;

  const check: CameraPoseAssertion = comparePoseDeg(wanted, actual);
  return {
    scenario: s.name,
    enforced,
    expected,
    actual,
    ok: check.ok,
    summary: check.summary,
  };
}

/** Pose the camera, then PROVE it took. */
function applyCanonicalPose(rig: CameraRig, s: ScenarioSpec): CanonicalPoseReport {
  const expected = expectedPose(s);

  rig.setPose({
    x: expected.x,
    z: expected.z,
    distance: expected.distance,
    yaw: expected.yawDeg * DEG2RAD,
    // Off the harness path pitch is NOT ours. Omitting the key leaves the zoom
    // curve — and the player — in charge, which is what a match needs.
    ...(enforced ? { pitch: expected.pitchDeg * DEG2RAD } : {}),
    immediate: true,
  });

  return verifyPose(rig, s);
}

export default defineSystem({
  id: 'game.scenario',
  // Last init, and last of anything that shares Cleanup.
  phase: Phase.Cleanup,
  order: 10_000,
  // A render phase is declared only so the one-shot camera pose can happen on
  // frame 0, after every render module has published its own state.
  renderPhase: RenderPhase.Overlay,

  async init(): Promise<void> {
    const { world, cameraRig, loop, debug } = ctx();

    const shotFlag = flag('shot');
    // The pose is pinned for a CAPTURE and only for a capture. `?shot=` is the
    // one signal that this boot is a fixture rather than a game.
    enforced = shotFlag !== null;

    // NOT `resolveScenarioName`. That reads `?shot=` alone, and the campaign is
    // selected by having an operation armed — see `bootScenarioName`.
    const name = bootScenarioName(shotFlag);
    const seed = seedFlag();

    // A def table may or may not exist yet; either way we get a binding.
    let defs: DefBinding | undefined;
    try {
      defs = await resolveDefBinding();
    } catch (err) {
      console.warn('[scenario] def discovery failed, using fallback content', err);
    }

    spec = buildScenario(world, name, seed, { map: flag('map'), defs });

    console.info(
      `%c[scenario]%c ${spec.name} on ${spec.map} (seed ${spec.seed}) — ` +
        `${spec.entityCount} entities, ${spec.ore.length} ore fields. ${spec.summary}`,
      'color:#7fd', 'color:inherit',
    );

    // Frame the composition. `tools/shoot.mjs` re-poses x/z/distance afterwards
    // through `__VM.focusOn`, but the YAW set here survives — and a yaw of
    // exactly 0 is the "flat axis-aligned table" failure the bible calls out as
    // identity property 3. Under `?shot=` the PITCH is written here too and
    // read straight back; see the header.
    report = applyCanonicalPose(cameraRig, spec);
    if (!report.ok) {
      console.error(
        `[scenario] CANONICAL POSE REJECTED for '${report.scenario}' — ${report.summary}. ` +
          'A capture taken now would not be comparable with the scorecard baseline.',
      );
    }

    // Run the world forward so "mid-action" fixtures are actually mid-action.
    // Guarded: a sim system that throws must cost us motion, not the frame.
    if (spec.settleTicks > 0) {
      try {
        loop.runHeadless(spec.settleTicks);
        world.spatial.rebuild();
      } catch (err) {
        console.error(`[scenario] settle of ${spec.settleTicks} ticks failed`, err);
      }
    }

    // Publish for the console and for the shot report.
    debug.setCounter('scenarioEntities', spec.entityCount);
    debug.api.registerHook('scenario', () => spec);
    // The guard `tools/shoot.mjs` refuses on. Recomputed on read so it reflects
    // the rig NOW, not the rig at init — that is what makes it a guard rather
    // than a receipt.
    debug.api.registerHook('canonicalPose', (): CanonicalPoseReport | null =>
      spec === null ? null : verifyPose(cameraRig, spec));
    // Visible on the F3 overlay: the number the whole guard is about.
    debug.setCounter('cameraPitchDeg', report.actual.pitchDeg);
  },

  /**
   * The camera rig damps toward its target every frame, and other modules may
   * install a ground-height function after our init ran — which pulls the focus
   * vertically for a frame or two. Re-assert the pose for the first handful of
   * frames so a screenshot taken immediately after `ready()` is framed exactly
   * as authored, then stop touching it so the player can move the camera.
   */
  frame(r: RenderContext): void {
    if (spec === null || r.frame > 4) return;
    const { cameraRig } = ctx();
    report = applyCanonicalPose(cameraRig, spec);
  },

  dispose(): void {
    spec = null;
    report = null;
    enforced = false;
    clearScenario();
  },
});

/** The last pose verification this module performed. Null before init. */
export function lastCanonicalPoseReport(): CanonicalPoseReport | null {
  return report;
}
