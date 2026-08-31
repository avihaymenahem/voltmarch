/**
 * The one numeric boundary in front of Web Audio's AudioParam API.
 *
 * Web Audio throws synchronously when a value, automation time, or time
 * constant is NaN/Infinity. JavaScript's Math.min/Math.max do not repair NaN,
 * so validating only at selected callers still leaves the mixer vulnerable to
 * a malformed setting, spatial sample, or computed envelope. Every AudioParam
 * write in src/audio goes through this module; the source-boundary spec keeps
 * that invariant enforceable for future audio work.
 */

export interface AudioParamGuardStats {
  repairedValues: number;
  repairedTimes: number;
  repairedTimeConstants: number;
}

export const audioParamGuardStats: AudioParamGuardStats = {
  repairedValues: 0,
  repairedTimes: 0,
  repairedTimeConstants: 0,
};

const WARNING_LIMIT = 4;
const EXPONENTIAL_FLOOR = 1e-7;
let warningCount = 0;

type RepairKind = keyof AudioParamGuardStats;

function noteRepair(kind: RepairKind, received: number, replacement: number): void {
  audioParamGuardStats[kind]++;
  if (warningCount >= WARNING_LIMIT || typeof console === 'undefined') return;
  warningCount++;
  console.warn(
    `[audio] repaired invalid AudioParam ${kind === 'repairedValues' ? 'value' : 'time'} `
    + `(received ${String(received)}, using ${replacement})`,
  );
}

/** Return a finite number, repairing NaN and both infinities. */
export function finiteAudioNumber(value: number, fallback = 0): number {
  if (Number.isFinite(value)) return value;
  const replacement = Number.isFinite(fallback) ? fallback : 0;
  noteRepair('repairedValues', value, replacement);
  return replacement;
}

function safeTime(value: number): number {
  if (Number.isFinite(value) && value >= 0) return value;
  noteRepair('repairedTimes', value, 0);
  return 0;
}

function safeTimeConstant(value: number): number {
  if (Number.isFinite(value) && value > 0) return value;
  noteRepair('repairedTimeConstants', value, 0.01);
  return 0.01;
}

function safeParamValue(param: AudioParam, value: number, fallback?: number): number {
  const defaultValue = Number.isFinite(param.defaultValue) ? param.defaultValue : 0;
  const replacement = fallback === undefined
    ? defaultValue
    : (Number.isFinite(fallback) ? fallback : defaultValue);
  let safe = value;
  if (!Number.isFinite(safe)) {
    safe = replacement;
    noteRepair('repairedValues', value, safe);
  }

  const min = Number.isFinite(param.minValue) ? param.minValue : -Number.MAX_VALUE;
  const max = Number.isFinite(param.maxValue) ? param.maxValue : Number.MAX_VALUE;
  const clamped = safe < min ? min : safe > max ? max : safe;
  if (clamped !== safe) noteRepair('repairedValues', value, clamped);
  return clamped;
}

export function setAudioParamValue(param: AudioParam, value: number, fallback?: number): void {
  param.value = safeParamValue(param, value, fallback);
}

export function setAudioParamValueAtTime(
  param: AudioParam, value: number, time: number, fallback?: number,
): void {
  param.setValueAtTime(safeParamValue(param, value, fallback), safeTime(time));
}

export function linearRampAudioParamToValueAtTime(
  param: AudioParam, value: number, endTime: number, fallback?: number,
): void {
  param.linearRampToValueAtTime(safeParamValue(param, value, fallback), safeTime(endTime));
}

export function exponentialRampAudioParamToValueAtTime(
  param: AudioParam, value: number, endTime: number, fallback?: number,
): void {
  const safe = Math.max(EXPONENTIAL_FLOOR, safeParamValue(param, value, fallback));
  param.exponentialRampToValueAtTime(safe, safeTime(endTime));
}

export function setAudioParamTargetAtTime(
  param: AudioParam, value: number, startTime: number, timeConstant: number, fallback?: number,
): void {
  param.setTargetAtTime(
    safeParamValue(param, value, fallback),
    safeTime(startTime),
    safeTimeConstant(timeConstant),
  );
}

export function cancelAudioParamScheduledValues(param: AudioParam, startTime: number): void {
  param.cancelScheduledValues(safeTime(startTime));
}

/** Test-only reset; production callers read the cumulative diagnostic counters. */
export function resetAudioParamGuardForTest(): void {
  audioParamGuardStats.repairedValues = 0;
  audioParamGuardStats.repairedTimes = 0;
  audioParamGuardStats.repairedTimeConstants = 0;
  warningCount = 0;
}
