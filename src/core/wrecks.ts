/**
 * Runtime identities for procedural wreck art.
 *
 * Wrecks are real entities, so the renderer needs a stable discriminator that
 * survives the sim/render boundary.  These ids occupy the high end of the
 * signed-I16-safe positive range used by EntityStore.defId; they are local to
 * EntityKind.Wreck and therefore cannot alias a unit or structure definition.
 */

export type WreckClass = 'light' | 'medium' | 'heavy' | 'support' | 'naval';
export type RubbleSize = 'small' | 'medium' | 'large';

export const VEHICLE_WRECK_DEF: Readonly<Record<WreckClass, number>> = {
  light: 30_000,
  medium: 30_001,
  heavy: 30_002,
  support: 30_003,
  naval: 30_004,
};

export const BUILDING_RUBBLE_DEF: Readonly<Record<RubbleSize, number>> = {
  small: 30_010,
  medium: 30_011,
  large: 30_012,
};

export const WRECK_CLASSES: readonly WreckClass[] = [
  'light', 'medium', 'heavy', 'support', 'naval',
];

/** Long-axis metres each hulk class is built to. */
export const WRECK_LENGTH: Readonly<Record<WreckClass, number>> = {
  light: 4.6,
  medium: 6.4,
  heavy: 8.2,
  support: 8.8,
  naval: 13.0,
};

export const RUBBLE_SIZES: readonly RubbleSize[] = ['small', 'medium', 'large'];

/** Classify a vehicle from its authored long axis in metres. */
export function wreckClassForLength(hullLengthMetres: number): WreckClass {
  if (hullLengthMetres >= 11.0) return 'naval';
  if (hullLengthMetres >= 8.2) return 'support';
  if (hullLengthMetres >= 7.0) return 'heavy';
  if (hullLengthMetres >= 5.6) return 'medium';
  return 'light';
}

/**
 * EntityStore.radius is authored as 45% of the hull's long axis.  Reversing
 * that derivation keeps the hulk on the same size rung as the live model.
 */
export function vehicleWreckDefForRadius(radiusMetres: number): number {
  return VEHICLE_WRECK_DEF[wreckClassForLength(Math.max(0, radiusMetres) / 0.45)];
}

export function wreckClassForDef(defId: number): WreckClass | null {
  for (const cls of WRECK_CLASSES) if (VEHICLE_WRECK_DEF[cls] === defId) return cls;
  return null;
}

/** Pick a ruin size from a structure footprint in cells (w * h). */
export function rubbleSizeForFootprint(footprintCells: number): RubbleSize {
  if (footprintCells >= 6) return 'large';
  if (footprintCells >= 4) return 'medium';
  return 'small';
}

export function buildingRubbleDefForFootprint(footprintCells: number): number {
  return BUILDING_RUBBLE_DEF[rubbleSizeForFootprint(footprintCells)];
}

export function rubbleSizeForDef(defId: number): RubbleSize | null {
  for (const size of RUBBLE_SIZES) if (BUILDING_RUBBLE_DEF[size] === defId) return size;
  return null;
}
