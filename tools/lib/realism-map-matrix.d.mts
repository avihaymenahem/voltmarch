export type RealismWeatherCell = 'off' | 'light' | 'heavy';
export type RealismPrecipitation = 'none' | 'rain' | 'snow';
export type SemanticContextCoverage = 'required';

export interface RealismMapCell {
  readonly id: string;
  readonly preset: string;
  readonly biome: string;
  readonly mood: string;
  readonly weather: RealismWeatherCell;
  readonly precipitation: RealismPrecipitation;
  readonly dayPhase: 'day' | 'dusk' | 'night' | 'dawn' | null;
  readonly semanticContext: SemanticContextCoverage;
}

export interface RealismMapThresholds {
  readonly irradianceFieldPixelsMin: number;
  readonly structureWearMarksMin: number;
  readonly colourDrawCallsMax: number;
  readonly programGrowthAfterWarmupMax: number;
  readonly simulationHashChangesMax: number;
}

export const REALISM_MAP_CELLS: readonly RealismMapCell[];
export const REALISM_MAP_THRESHOLDS: Readonly<RealismMapThresholds>;
