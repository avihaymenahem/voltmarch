/**
 * Decides when a stable frame needs a new shadow map.
 *
 * The game presents at up to 60 Hz, but a 30 Hz shadow map is visually
 * sufficient at RTS camera distances while the camera is stationary. Camera
 * or projection movement is passed as `force` by Bootstrap and remains full
 * rate. At 30 fps or below the adaptive mode also updates every frame.
 *
 * `half` is a deterministic A/B mode for the render benchmark. Unlike the
 * time-based adaptive mode it alternates even when the harness feeds 1 / 30 s
 * presentation steps.
 */

export type ShadowCadenceMode = 'adaptive' | 'legacy' | 'half';

const TARGET_SECONDS = 1 / 30;
const MAX_ACCOUNTED_DT = 0.1;
const EPSILON = 1e-6;

export function shadowCadenceModeFromSearch(search = ''): ShadowCadenceMode {
  const raw = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
    .get('shadowcadence')
    ?.trim()
    .toLowerCase();
  if (raw === 'legacy' || raw === 'full') return 'legacy';
  if (raw === 'half' || raw === 'alternate') return 'half';
  return 'adaptive';
}

export class ShadowCadence {
  private started = false;
  private elapsed = 0;
  private halfPhase = 0;

  constructor(readonly mode: ShadowCadenceMode = 'adaptive') {}

  /** Return true when this frame should rebuild the shadow map. */
  shouldUpdate(dtSeconds: number, force = false): boolean {
    if (force || !this.started) {
      this.started = true;
      this.elapsed = 0;
      this.halfPhase = 1;
      return true;
    }

    if (this.mode === 'legacy') return true;

    if (this.mode === 'half') {
      const update = (this.halfPhase & 1) === 0;
      this.halfPhase++;
      return update;
    }

    const dt = Number.isFinite(dtSeconds)
      ? Math.min(MAX_ACCOUNTED_DT, Math.max(0, dtSeconds))
      : 0;
    this.elapsed += dt;
    if (this.elapsed + EPSILON < TARGET_SECONDS) return false;

    // Keep fractional time so a 50/75/120 Hz display converges on 30 Hz
    // instead of locking to an integer divisor below it.
    this.elapsed %= TARGET_SECONDS;
    return true;
  }
}
