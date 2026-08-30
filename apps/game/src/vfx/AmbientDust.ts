/**
 * Deterministic sampling for the camera-local cinematic dust layer.
 *
 * This is render-only state. It must never consume the simulation RNG: replay
 * checksums and unit decisions cannot depend on how many frames were drawn.
 */

export interface AmbientDustSample {
  angle: number;
  radius: number;
  height: number;
  lifeMs: number;
  size0: number;
  size1: number;
  driftX: number;
  driftY: number;
  driftZ: number;
  alpha: number;
  rotation: number;
  rotationVelocity: number;
}

const TAU = Math.PI * 2;
const RATE_BY_TIER = [0, 7, 12, 18] as const;

function hash(index: number, salt: number): number {
  let h = (index ^ salt) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 0x100000000;
}

/** Particles per second. Rain scrubs airborne dust rather than adding clutter. */
export function ambientDustRateForTier(tier: number, rainIntensity = 0): number {
  const index = Math.max(0, Math.min(3, Math.floor(Number.isFinite(tier) ? tier : 0)));
  const rain = Math.max(0, Math.min(1, Number.isFinite(rainIntensity) ? rainIntensity : 0));
  return RATE_BY_TIER[index] * (1 - rain * 0.92);
}

/** Stable low-discrepancy-ish sample around the camera focus. */
export function ambientDustSample(index: number): AmbientDustSample {
  const i = Math.max(0, Math.floor(index));
  const radiusUnit = hash(i, 0x13f26d4b);
  const heading = hash(i, 0x91e10da5);
  const windHeading = 0.48 + (hash(i, 0xa54ff53a) - 0.5) * 0.34;
  const windSpeed = 0.18 + hash(i, 0x510e527f) * 0.27;
  return {
    angle: heading * TAU,
    // sqrt produces even area density instead of a dense ring at the centre.
    radius: 7 + Math.sqrt(radiusUnit) * 38,
    height: 0.75 + hash(i, 0x6d2b79f5) * 4.4,
    lifeMs: 5200 + hash(i, 0x1b873593) * 3200,
    size0: 0.24 + hash(i, 0x85ebca6b) * 0.18,
    size1: 0.50 + hash(i, 0xc2b2ae35) * 0.35,
    driftX: Math.cos(windHeading) * windSpeed,
    driftY: 0.025 + hash(i, 0x27d4eb2f) * 0.055,
    driftZ: Math.sin(windHeading) * windSpeed,
    alpha: 0.22 + hash(i, 0x165667b1) * 0.18,
    rotation: hash(i, 0xd3a2646c) * TAU,
    rotationVelocity: (hash(i, 0xfd7046c5) - 0.5) * 0.18,
  };
}
