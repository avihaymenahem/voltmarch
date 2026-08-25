/**
 * ============================================================================
 * VOLTMARCH — src/render/calibration.system.ts
 * ============================================================================
 * The registration shim for the one-time hardware calibration. The controller
 * is in `HardwareCalibration.ts`; this file measures a frame, applies a probe
 * scale, and hands the finished decision to whoever armed it.
 *
 * A MODULE RATHER THAN AN EDIT TO `renderer.ts`, for the same reason
 * `adaptive-res.system.ts` is one: the whole lever is already public
 * (`RendererHandle.setResolutionScale`, `RendererHandle.size`), so this needs no
 * change to the renderer, none to `core/`, and can be removed by deleting one
 * file.
 *
 * `RenderPhase.Present` order 90 — just before the adaptive controller at 100,
 * and for the same two reasons written out at length in that file: `ctx.dt` here
 * covers a whole rendered frame, and `Present` runs inside `GameLoop.renderPass`
 * BEFORE the host draws, so a scale change is followed by a complete frame in
 * the same task and nothing flat is ever presented (`src/render/RepaintGuard.ts`).
 *
 * ============================================================================
 * IT MUST NEVER RUN UNDER `?shot=`, AND THAT IS ENFORCED THREE WAYS
 * ============================================================================
 * `npm run shots` rests on captures being byte-identical run to run — ten of
 * thirteen fixtures are byte-exact, and the whole visual-regression pipeline is
 * built on that. A capture that changed its own resolution mid-run would be
 * nondeterministic, and the failure would look like a look-bible regression
 * rather than like this.
 *
 *   1. **IT IS INERT UNTIL ARMED.** `armCalibration()` has exactly one caller,
 *      `src/shell/Shell.ts`, and `?shot=` never loads the shell — `main.ts`
 *      routes the harness straight into `bootstrap()` and the shell module is
 *      not even imported on that path. This is the structural guard and it is
 *      the one that matters; the other three are belt and braces for a future
 *      caller that does not know any of this. Same shape as `net.system.ts`
 *      being inert until `attachSession()`.
 *   2. **`loop.captureClock`.** `Bootstrap` sets it from `shotMode`, and it is
 *      the single flag that means "these frames belong to the harness".
 *      `armCalibration` REFUSES under it and `frame()` returns under it — two
 *      independent reads, both LIVE rather than latched at `init()`, because a
 *      latched copy makes the second one unreachable and an unreachable guard
 *      cannot be tested and therefore cannot be trusted.
 *   3. **`handle.isFixedSize`.** `setFixedSize` is driving an offscreen render
 *      at an exact pixel size; a scaled capture would silently corrupt the
 *      scorecard. The same guard `adaptive-res.system.ts` carries.
 *
 * `tests/hardware-calibration.spec.ts` drives all three against a fake handle,
 * and every one was mutation-tested: deleted from this file, suite run,
 * confirmed red, restored.
 *
 * **THERE WAS A FOURTH AND IT IS NOT A GUARD.** `captureClock` also forces
 * `realDt = 0`, so an `rc.dt > 0` test looks like it belongs here — and it
 * survived mutation, because a zero interval is already refused one call later
 * by `HardwareCalibration.sample`'s own `frameMs > 0` filter (which is
 * mutation-killed, by the frozen-clock test below). It is kept as a cheap
 * early-out and demoted in the prose, because a line labelled "guard" that
 * cannot be made to fail is exactly the kind of assertion this project has
 * shipped believing.
 *
 * It would not have been sufficient anyway: `GameLoop.advanceTicks` renders at
 * a synthetic `SIM_DT`, which is 33.3 ms and very much non-zero. Guard 2 is
 * what covers that, and it is checked separately for that reason.
 * ============================================================================
 */

import { RenderPhase } from '../core/types';
import type { RenderContext } from '../core/types';
import { defineSystem } from '../core/loop';
import type { GameLoop } from '../core/loop';
import { ctx } from '../game/context';
import type { RendererHandle } from './renderer';
import { classifyGpu } from './renderer';

import {
  CALIBRATION,
  HardwareCalibration,
  calibrationPrior,
  describeCalibration,
  type CalibrationResult,
  type CalibrationStage,
} from './HardwareCalibration';

let handle: RendererHandle | null = null;
let controller: HardwareCalibration | null = null;
let done: ((result: CalibrationResult) => void) | null = null;
/**
 * The loop, kept only for `captureClock`.
 *
 * READ LIVE ON EVERY FRAME rather than latched at `init()`. Latching would make
 * the `frame()` guard unreachable — and therefore untestable, and therefore
 * exactly the kind of assertion this project has shipped passing while asserting
 * nothing. A live read costs one property load on the frames a calibration is
 * actually running, which is at most 110 of them, once per profile.
 */
let loop: GameLoop | null = null;
/**
 * The last scale THIS module put on the handle, or -1.
 *
 * Read by `disarmCalibration` so a restore can never clobber somebody else's
 * newer value. See the argument there.
 */
let lastApplied = -1;

/** True when the screenshot harness owns this page. `?shot=` sets it in `Bootstrap`. */
function underHarness(): boolean {
  return loop === null || loop.captureClock === true;
}

/** Every scale this module commands goes through here, so `lastApplied` cannot drift. */
function apply(scale: number): void {
  if (handle === null) return;
  handle.setResolutionScale(scale);
  lastApplied = handle.resolutionScale;
}

/** Progress 0..1 of a running calibration, for a status line. */
export let calibrationProgress = 0;

/** True while a calibration is measuring. */
export function calibrationRunning(): boolean {
  return controller !== null;
}

/** Which probe it is on, or null when nothing is running. */
export function calibrationStage(): CalibrationStage | null {
  return controller === null ? null : controller.stage;
}

/**
 * Begin a calibration on the live renderer.
 *
 * ONE CALLER, ON PURPOSE — see guard 1 in the header. `onDone` is invoked
 * exactly once, on the frame the measurement completes, AFTER this module has
 * already disarmed itself. That ordering is load-bearing: the callback persists
 * the result through `SettingsStore.patch`, which notifies the shell, which
 * cancels any running calibration — and it must find none running rather than
 * cancel the one that just succeeded.
 *
 * A second call while one is running is ignored; re-arming mid-probe would fit
 * a line through two different scenes.
 */
export function armCalibration(
  onDone: (result: CalibrationResult) => void,
  targetMs: number = CALIBRATION.targetMs,
): boolean {
  if (underHarness() || handle === null || controller !== null) return false;
  if (handle.isFixedSize) return false;

  const entry = handle.resolutionScale;
  if (!Number.isFinite(entry) || entry <= 0) return false;

  // Read defensively: `capabilities.gpu` is a `string` by type, and is the
  // empty string on a driver that masked its renderer info.
  const name = typeof handle.capabilities.gpu === 'string' ? handle.capabilities.gpu : '';
  const prior = calibrationPrior(classifyGpu(name), handle.capabilities.adapter, handle.backend);
  controller = new HardwareCalibration(prior.startScale, entry, CALIBRATION.maxScale, targetMs);
  calibrationProgress = 0;
  done = onDone;

  console.info(
    `[render] hardware calibration: probing from ${Math.round(prior.startScale * 100)}% `
    + `for ${(1000 / targetMs).toFixed(0)} fps — ${prior.note}`,
  );
  // The first probe's scale goes on NOW so the warmup frames are already at it.
  apply(controller.firstProbeScale);
  return true;
}

/**
 * Stop a running calibration and put back the scale it started from.
 *
 * RESTORING IS THE HALF THAT MATTERS. A player who opens Settings mid-probe and
 * moves any graphics row is cancelling this, and without the restore they would
 * be left parked at probe B's 70% forever — `applySettings` re-pushes
 * `resolutionScale` only when it CHANGED, and their stored value never did.
 *
 * AND THE RESTORE ONLY FIRES IF THE LIVE SCALE IS STILL THE ONE THIS MODULE PUT
 * THERE. The cancelling change is very often a move of the Resolution Scale
 * slider itself, and the shell's settings listener runs `applySettings` and this
 * in one turn — so a restore that ran unconditionally would put the probe's
 * entry value back over the number the player had just chosen, leaving the
 * slider reading one thing and the renderer doing another. That is the exact
 * defect the Resolution Scale row's own comment was written about. Guarding on
 * `lastApplied` makes it independent of which of the two runs first, rather than
 * correct only while somebody remembers the order.
 */
export function disarmCalibration(): void {
  if (controller === null) return;
  const back = controller.abort();
  controller = null;
  done = null;
  calibrationProgress = 0;
  if (handle === null || !Number.isFinite(back) || back <= 0) return;
  const live = handle.resolutionScale;
  if (Number.isFinite(live) && Math.abs(live - lastApplied) > 1e-3) return;
  apply(back);
}

export default defineSystem({
  id: 'render.hardwareCalibration',
  renderPhase: RenderPhase.Present,
  // Before `render.adaptiveResolution` at 100. The two must never steer at the
  // same time; the adaptive system stands down while `calibrationRunning()`.
  order: 90,

  init(): void {
    const c = ctx();
    handle = c.handle;
    loop = c.loop;
    controller = null;
    done = null;
    lastApplied = -1;
    calibrationProgress = 0;
  },

  frame(rc: RenderContext): void {
    const c = controller;
    if (c === null || handle === null) return;      // guard 1: not armed
    if (underHarness()) return;                     // guard 2: ?shot=
    if (handle.isFixedSize) return;                 // guard 3: offscreen capture
    // Not a guard — see the header. `sample` refuses a zero interval itself;
    // this only saves the arithmetic on a frame that can never count.
    if (!(rc.dt > 0)) return;

    const size = handle.size;
    const mpx = (size.width * size.height) / 1e6;

    const step = c.sample(rc.dt * 1000, mpx);
    calibrationProgress = step.progress;
    if (step.scale !== null) apply(step.scale);

    const result = step.result;
    if (result === null) return;

    /*
     * DISARM BEFORE CALLING BACK. The callback writes the result into the
     * settings store, the store notifies the shell, and the shell cancels any
     * RUNNING calibration on a graphics change. Calling back first would have
     * the successful run cancel itself and restore the scale it just solved.
     */
    const cb = done;
    controller = null;
    done = null;
    calibrationProgress = 1;
    console.info(`[render] ${describeCalibration(result)}`);
    cb?.(result);
  },

  dispose(): void {
    handle = null;
    loop = null;
    controller = null;
    done = null;
    lastApplied = -1;
    calibrationProgress = 0;
  },
});
