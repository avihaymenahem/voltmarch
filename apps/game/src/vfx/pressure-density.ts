/**
 * Retain authored density until a pool is busy, then shed redundant particles.
 * The hero flash/light remains; only repeated sparks, embers and dust puffs use
 * this multiplier.
 */
export function vfxDensityAtPressure(pressure: number): number {
  if (!Number.isFinite(pressure) || pressure <= 0.55) return 1;
  if (pressure >= 0.9) return 0.25;
  const t = (pressure - 0.55) / 0.35;
  return 1 - t * 0.75;
}
