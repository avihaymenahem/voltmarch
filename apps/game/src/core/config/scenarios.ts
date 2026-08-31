/**
 * Domain-owned config slice: scenario and map-preset presentation data.
 *
 * Public compatibility remains apps/game/src/core/config.ts. Keep literals
 * and exported identities stable; dependency architecture, not tuning, owns
 * this file boundary.
 */

/* ==========================================================================
 * 20. SCENARIOS AND MAP PRESETS
 *
 * `?shot=<name>` picks a scenario (src/game/Scenarios.ts); `?map=<preset>`
 * picks the biome it is built on. The scenario router resolves both, publishes
 * the result as `activeScenario()`, and the terrain / ore / scatter modules
 * shape the world from the knobs below rather than inventing their own.
 * ========================================================================== */

/** Scenario used when no `?shot=` flag is present. */
export const SCENARIO_DEFAULT = 'skirmish';
/** Map preset used when neither `?map=` nor the scenario names one. */
export const MAP_PRESET_DEFAULT = 'temperate';

/**
 * One biome. Every field is a 0..1 weight unless noted — the terrain module
 * decides what a "0.55 relief" heightfield looks like, but two presets with the
 * same number must produce the same amount of it.
 */
export interface MapPreset {
  /** Human name, for the loading line and the debug overlay. */
  readonly name: string;
  /** Advisory `?art=` mood. NOT auto-applied — `?art=` always wins. */
  readonly mood: string;
  /**
   * Optional presentation-only day/night cycle. `phaseOffset` is a normalized
   * 0..1 position in the authored timeline; simulation state never reads it.
   */
  readonly timeOfDayCycle?: {
    readonly durationSeconds: number;
    readonly phaseOffset: number;
  };
  /** Heightfield amplitude as a fraction of TERRAIN_MAX_HEIGHT. */
  readonly relief: number;
  /** How much of the relief is expressed as impassable cliff faces. */
  readonly cliffs: number;
  /** Fraction of the map below WATER_LEVEL. 0 = landlocked. */
  readonly water: number;
  /** Prop/vegetation density multiplier over the bible's 260/ha wilderness base. */
  readonly scatter: number;
  /** Road, kerb and hardstanding coverage. 0 = wilderness, 1 = city block. */
  readonly urban: number;
  /** Ore units per cell at a field's centre, as a fraction of ORE_CELL_MAX. */
  readonly oreRichness: number;
  /** Scatter prop keys, richest first. The scatter module weights them 3:2:1... */
  readonly props: readonly string[];
}

/**
 * ROCK AND BOULDER ORDERING IS A DENSITY KNOB, and it is the biggest one.
 *
 * "reduce the number of boulders and rocks by at least 30% all around, they
 * spawn way too much and causing other bugs."
 *
 * `ScenarioBuilder.scatter` picks with `floor(-log2(1 - r))`, so INDEX 0
 * APPEARS HALF THE TIME, index 1 a quarter, index 2 an eighth, and the tail
 * clamps onto the last entry. Ordering is therefore not cosmetic — it is the
 * weight. Before this pass:
 *
 *      arid   ['rock', 'boulder', ...]   rock 50% + boulder 25%  = 75% rock
 *      coast  ['rock', 'bush', 'tree', 'boulder']                = 56%
 *      snow   ['pine', 'rock', 'boulder']                        = 50%
 *
 * THE SECOND HALF OF THE REPORT IS THE IMPORTANT ONE. `rock` is a 2 m nav
 * blocker and `boulder` a 3.2 m one, and tests/start-clearance.spec.ts already
 * records what that costs: measured share of armies whose deploy footprint was
 * fouled was arid 48%, coast 39%, snow 29% — and 48% is almost exactly the 75%
 * blocking share above, filtered through where the scatter lands. These are the
 * three presets that lead with rock. That is not a coincidence, it is the
 * mechanism.
 *
 * Reordered so nothing leads with a nav blocker. Rock+boulder share:
 *      arid  75% -> 37.5%      coast 56% -> 25%      snow 50% -> 25%
 * temperate and tropical already sat at 12.5% and are unchanged.
 *
 * The per-biome WEIGHTS in `src/world/PropLibrary.ts` came down 35% in the same
 * pass; that governs the world scatter, this governs the base scatter, and both
 * had to move or the cut would only show in half the props on screen.
 */
export const MAP_PRESETS: Record<string, MapPreset> = {
  /** The shipping biome: yellow-green grass, low plateaus, scattered woodland. */
  temperate: {
    name: 'Temperate Valley', mood: 'noon',
    relief: 0.42, cliffs: 0.35, water: 0.0, scatter: 1.0, urban: 0.25,
    oreRichness: 0.85, props: ['tree', 'bush', 'rock', 'pine'],
  },
  /**
   * The bible's calibration preset. Bare, hot, high contrast, long shadows.
   *
   * `scatter` raised 0.55 -> 0.85. "Bare" was being taken literally and this is
   * the preset `07-soviet-base` shoots on — the one shot that trips the 25x25 m
   * ship-blocking rule (bible §6.6 / scorecard #15). The texture overhaul that
   * removed per-pixel ground noise also removed the "texture variation" half of
   * what that rule accepts as adornment, so bare ground now has to be adorned
   * with actual props or not at all. 0.85 still reads as sparse desert against
   * tropical's 1.45; it just is not empty.
   */
  arid: {
    name: 'Airbase Flats', mood: 'noon',
    relief: 0.28, cliffs: 0.55, water: 0.0, scatter: 0.85, urban: 0.45,
    oreRichness: 1.0, props: ['bush', 'rock', 'barrel', 'boulder'],
  },
  /** Dense canopy, wet ground, the highest prop count in the game. */
  tropical: {
    name: 'Coral Shore', mood: 'noon',
    relief: 0.36, cliffs: 0.30, water: 0.22, scatter: 1.45, urban: 0.15,
    oreRichness: 0.75, props: ['tree', 'bush', 'pine', 'rock'],
  },
  /** Warm grey snow — saturation drops by half for this preset only (bible §10). */
  snow: {
    name: 'Frozen Sector', mood: 'overcast',
    relief: 0.50, cliffs: 0.40, water: 0.05, scatter: 0.70, urban: 0.20,
    oreRichness: 0.90, props: ['pine', 'bush', 'rock', 'boulder'],
  },
  /** Naval: one shoreline running through the map, land on one side. */
  coast: {
    name: 'Contested Strait', mood: 'noon',
    relief: 0.30, cliffs: 0.45, water: 0.45, scatter: 0.85, urban: 0.30,
    oreRichness: 0.80, props: ['bush', 'tree', 'rock', 'boulder'],
  },
  /*
   * FOUR ISLANDS, NO LAND ROUTE — the preset that selects `ARCHIPELAGO_SEA`.
   *
   * THE BIOME IS `temperate`, AND IT WAS THE SECOND CHOICE. `MapChoice.biome`
   * is a separate flag from this key, so the pairing is authored and has to be
   * argued; the argument for `desert` was a good one and it lost on the
   * scorecard, which is worth recording because it is not the answer anybody
   * reasoning from first principles arrives at.
   *
   * THE CASE FOR DESERT, all of it true:
   *   `WATER_PALETTE_BY_BIOME.desert` is `tropical`, the turquoise ramp.
   *   `PROP_DEFS.palm` weights desert 0.85 against temperate 0.10 and snow
   *     0.00, and is the heaviest CANOPY entry desert has, so an arid coast
   *     grows palms with nothing in this table asking for them.
   *   Desert is hue-locked to 41 degrees and has `basinDepth: 0`, so the map
   *     would carry no green ground at all and no inland puddles.
   *
   * WHAT IT MEASURED, on the `13-atoll-crossing` fixture, same frame, same
   * seed, biome the only variable:
   *
   *                            desert     temperate   band
   *     #4  median luminance   0.5228     0.4461      0.134-0.491
   *     #9  emerald leak       0.0411     0.0181      0.000-0.020
   *
   * Two FATAL failures against none. Both are the same cause seen twice: this
   * map is 54% water over a seabed the biome colours, and a bright sand bed
   * does two things at once — it fills the dry half of the frame with sunlit
   * hardpan, which is what puts the median over its ceiling, and it lights the
   * SHALLOWS from below, which walks the turquoise ramp round into hue 100-120
   * over the shoals. The palette that was the best reason to pick desert is
   * what disqualified it. `docs/RA3_LOOK_BIBLE.md` wins over instinct, and this
   * is an instance of it doing so.
   *
   * `water` is the MEASURED 53.6-54.1% across four seeds, not an intention, and
   * it is a ceiling set by the start guarantee — see the block above
   * `ARCHIPELAGO_SEA` in `src/game/Scenarios.ts`. `relief` and `cliffs` restate
   * `temperate`'s because the landform comes from the same `BiomeDef`.
   *
   * `scatter` 1.15: above `temperate`'s 1.0 because the coastline is the
   * subject here and a bare island reads as a sandbar, below `tropical`'s 1.45
   * because a 98 m island cannot carry Coral Shore's density and still show the
   * ground a base stands on.
   *
   * `urban` 0.10 is the lowest in the game. Road edges are refused on wet
   * ground, so a lattice would come out as four disconnected stubs; an atoll
   * with kerbs is a worse lie than an atoll with none.
   *
   * `oreRichness` 0.80, same as `coast`: an island economy cannot be reinforced
   * by walking to a neighbour's field, so it must not be poor; each army opens
   * on two uncontested patches, so it must not be rich.
   *
   * `props` leads with `bush` for the reason the header above gives, and
   * rock+boulder come to 25%.
   *
   * `barrel` HOLDS INDEX 1 ON A MEASUREMENT, not on a reading. It was `tree`
   * for one pass — matching `coast`, and better jetsam than oil drums on an
   * island nobody has lived on — and `tree` at index 1 is a 3x weight on the
   * canopy def in `Scatter`'s picker ON TOP of temperate's own 1.00 for it.
   * Scorecard #9 (hue 100-120, weight 3, FATAL) went 0.0181 -> 0.0260 against a
   * 0.020 ceiling on the `13-atoll-crossing` frame, twice, with nothing else
   * changed. The canopy this map wants comes from the biome weights unprompted;
   * asking for more of it is what tips a green island into an emerald one.
   */
  atoll: {
    name: 'Sunder Atoll', mood: 'noon',
    relief: 0.42, cliffs: 0.35, water: 0.54, scatter: 1.15, urban: 0.10,
    oreRichness: 0.80, props: ['bush', 'barrel', 'rock', 'boulder'],
  },
  /** Roads, kerbs, crosswalks, container stacks. The terrain-detail fixture. */
  urban: {
    name: 'Industrial Grid', mood: 'night',
    timeOfDayCycle: { durationSeconds: 480, phaseOffset: 0.57 },
    relief: 0.14, cliffs: 0.10, water: 0.0, scatter: 0.60, urban: 0.95,
    oreRichness: 0.70, props: ['barrel', 'crate', 'bush', 'rock'],
  },
};

/**
 * Scenario prop scatter. The full 260/ha wilderness carpet belongs to the
 * instanced scatter system; these are the ENTITY props (crushable, blocking,
 * shadow-casting) the scenario itself places inside the photographed area.
 */
export const SCENARIO_SCATTER = {
  /** Metres around the subject that a scenario dresses with entity props. */
  framedRadius: 80,
  /** Hard cap so a fixture can never eat the entity budget a blob shot needs. */
  maxProps: 200,
  /** Minimum metres between two scattered props. Below this they read as one blob. */
  minSpacing: 3.2,
} as const;

/** Naval hulls, metres. Same contract as UNIT_DIMENSIONS. */
export const NAVAL_UNIT_DIMENSIONS = {
  //                    length  width  height  turret ring Y
  // The Assault Destroyer is the escort rung, not a second recon boat. Keep
  // this gameplay envelope synchronized with UnitDefs and the imported GLB
  // target so radius, turn rate, selection and art all describe one hull.
  gunboat:     { l: 12.0, w: 4.0, h: 3.8, turretY: 1.80 },
  destroyer:   { l: 14.0, w: 4.2, h: 3.4, turretY: 1.90 },
  submarine:   { l: 12.0, w: 3.2, h: 1.8, turretY: 0 },
  dreadnought: { l: 18.0, w: 5.6, h: 4.2, turretY: 2.40 },
  transport:   { l: 13.0, w: 6.0, h: 2.4, turretY: 0 },
  // The recon hull remains the fleet's smallest combat rung, but 7 m made all
  // four authored boats read as dinghies at the naval camera scale. Nine metres
  // preserves a clear step below 10-12 m escorts while keeping the art,
  // selection radius and turn-rate contract synchronized for every faction.
  recon:       { l: 9.0,  w: 3.2, h: 2.8, turretY: 1.25 },
  lighter:     { l: 11.0, w: 5.0, h: 2.0, turretY: 0 },
} as const;

/** Naval structures. Footprint in CELLS, height in metres. */
export const NAVAL_BUILDING_DIMENSIONS = {
  navalYard: { w: 3, h: 3, height: 7.5 },
  subPen:    { w: 3, h: 3, height: 6.0 },
} as const;
