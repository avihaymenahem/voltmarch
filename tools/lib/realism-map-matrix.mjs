/**
 * Shipped-map coverage cells for the WebGPU realism acceptance run.
 *
 * This is tooling data, not product configuration. `weather` and `dayPhase`
 * name existing critic-only presentation controls used to make a repeatable
 * frame; they do not enable or disable a shipping graphics feature.
 */
export const REALISM_MAP_CELLS = Object.freeze([
  Object.freeze({
    id: 'temperate-valley', preset: 'temperate', biome: 'temperate', mood: 'noon',
    weather: 'heavy', precipitation: 'rain', dayPhase: null,
    semanticContext: 'required',
  }),
  Object.freeze({
    id: 'airbase-flats', preset: 'arid', biome: 'desert', mood: 'noon',
    weather: 'off', precipitation: 'none', dayPhase: null,
    semanticContext: 'required',
  }),
  Object.freeze({
    id: 'frozen-sector', preset: 'snow', biome: 'snow', mood: 'overcast',
    weather: 'heavy', precipitation: 'snow', dayPhase: null,
    semanticContext: 'required',
  }),
  Object.freeze({
    id: 'industrial-grid', preset: 'urban', biome: 'urban', mood: 'night',
    weather: 'off', precipitation: 'none', dayPhase: 'night',
    semanticContext: 'required',
  }),
  Object.freeze({
    id: 'contested-strait', preset: 'coast', biome: 'temperate', mood: 'noon',
    weather: 'heavy', precipitation: 'rain', dayPhase: null,
    semanticContext: 'required',
  }),
  Object.freeze({
    id: 'coral-shore', preset: 'tropical', biome: 'temperate', mood: 'noon',
    weather: 'light', precipitation: 'rain', dayPhase: null,
    semanticContext: 'required',
  }),
  Object.freeze({
    id: 'sunder-atoll', preset: 'atoll', biome: 'temperate', mood: 'noon',
    weather: 'heavy', precipitation: 'rain', dayPhase: null,
    semanticContext: 'required',
  }),
]);

export const REALISM_MAP_THRESHOLDS = Object.freeze({
  irradianceFieldPixelsMin: 64 * 64,
  structureWearMarksMin: 1,
  colourDrawCallsMax: 130,
  programGrowthAfterWarmupMax: 0,
  simulationHashChangesMax: 0,
});
