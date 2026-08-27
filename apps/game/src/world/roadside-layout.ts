/**
 * Sparse, deterministic composition rules for road furniture.
 *
 * A road run receives a small number of independent "stories" (lighting,
 * parking, seating, and so on). Variants in one story are mutually exclusive,
 * so three car archetypes cannot all march down the same pavement. Most runs
 * intentionally receive no parking, seating, hedge, or barrier story at all.
 */

export interface RoadsideLayout {
  readonly chance: number;
  readonly pitchMin: number;
  readonly pitchMax: number;
  readonly maxPerRun: number;
  readonly endClearance: number;
}

interface RoadsideStory extends RoadsideLayout {
  readonly salt: number;
  /** Repeated entries are intentional weights. */
  readonly variants: readonly string[];
}

const STORIES: readonly RoadsideStory[] = [
  // Lamps remain the street's visual rhythm, but at block scale rather than
  // the previous one-pole-per-8-metres asset-test cadence.
  { salt: 0x51a771, chance: 0.58, pitchMin: 30, pitchMax: 43, maxPerRun: 4,
    endClearance: 15, variants: ['streetLamp', 'streetLamp', 'streetLamp', 'streetLampTwin'] },
  { salt: 0xbec401, chance: 0.15, pitchMin: 50, pitchMax: 76, maxPerRun: 2,
    endClearance: 20, variants: ['bench'] },
  // Only one vehicle silhouette is allowed on a selected run. Long empty
  // kerbs are more useful than a continuous red/green traffic jam.
  { salt: 0xca4517, chance: 0.22, pitchMin: 52, pitchMax: 78, maxPerRun: 2,
    endClearance: 24, variants: ['carSedan', 'carVan', 'carPickup'] },
  { salt: 0x7aaff1, chance: 0.13, pitchMin: 35, pitchMax: 52, maxPerRun: 3,
    endClearance: 18, variants: ['hedge'] },
  { salt: 0xba771e, chance: 0.10, pitchMin: 19, pitchMax: 27, maxPerRun: 3,
    endClearance: 18, variants: ['fence', 'railing'] },
  { salt: 0x7e1e90, chance: 0.11, pitchMin: 42, pitchMax: 62, maxPerRun: 2,
    endClearance: 18, variants: ['telegraphPole'] },
  { salt: 0x519a55, chance: 0.14, pitchMin: 46, pitchMax: 68, maxPerRun: 2,
    endClearance: 16, variants: ['roadSign', 'roadSignDisc'] },
  { salt: 0x7aff1c, chance: 0.06, pitchMin: 90, pitchMax: 110, maxPerRun: 1,
    endClearance: 8, variants: ['trafficLight'] },
];

const STORY_BY_KEY = new Map<string, RoadsideStory>();
for (const story of STORIES) {
  for (const key of story.variants) STORY_BY_KEY.set(key, story);
}

function mix32(value: number): number {
  let x = value >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

function unit(value: number): number {
  return mix32(value) / 0x1_0000_0000;
}

/** Policy for a road-bound prop, or null for non-road/synthetic line props. */
export function roadsideLayoutFor(key: string): RoadsideLayout | null {
  return STORY_BY_KEY.get(key) ?? null;
}

/**
 * Whether this exact archetype owns a run. Story selection and variant choice
 * share one hash, making variants mutually exclusive without mutable state.
 */
export function roadsideRunAllows(seed: number, key: string, runIndex: number): boolean {
  const story = STORY_BY_KEY.get(key);
  if (story === undefined) return true;
  const h = mix32((seed ^ story.salt ^ Math.imul(runIndex + 1, 0x9e3779b1)) >>> 0);
  if (unit(h ^ 0x68bc21eb) >= story.chance) return false;
  const variant = story.variants[Math.floor(unit(h ^ 0x02e5be93) * story.variants.length)];
  return variant === key;
}
