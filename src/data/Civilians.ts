/**
 * ============================================================================
 * VOLTMARCH — src/data/Civilians.ts   THE NEUTRAL MAP FURNITURE
 * ============================================================================
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `src/sim/Capture.ts` opens by naming "oil derricks, hospitals, civilian
 * blocks" as the reason a neutral structure is captured outright at any health.
 * `src/sim/Garrison.ts` says in its own header that the eligible set is "your
 * own unarmed, non-production structures ... plus any neutral-owned structure
 * the moment one exists". Both mechanics were finished. Neither had a single
 * object on the map to act on. These are those objects.
 *
 * THE NUMBERS LIVE HERE AND NOWHERE ELSE, because a structure needs FOUR tables
 * to agree and three of them fail silently:
 *
 *   `src/data/Defs.ts`          the def row  (footprint, hp, sight, power)
 *   `src/game/Scenarios.ts`     `FALLBACK_BUILDINGS` + `BUILDING_ALIASES`
 *   `src/art/BuildingDefs.ts`   the mass list, sized off the same footprint
 *   `src/ui/Cameos.ts`          the model binding
 *
 * `tests/data.spec.ts` already asserts def-vs-fallback agreement field by
 * field; nothing asserts def-vs-ART agreement, and a mass list built on a
 * footprint the def does not share is a building whose pad is the wrong size
 * with no error anywhere. One table, imported by all three, makes that
 * impossible rather than merely unlikely.
 *
 * IMPORT DIRECTION. This module imports NOTHING. `src/data/Defs.ts` documents
 * that the one edge out of `src/data` is into `src/sim/Combat`, and that no
 * file under `src/sim` imports `src/data`; a leaf with no imports at all cannot
 * participate in a cycle whoever picks it up. `src/game/Scenarios.ts` globs
 * `../data/**\/*.ts` looking for a `DefTables` — this file exports none, so the
 * scan walks past it.
 *
 * NOT BUILDABLE, DELIBERATELY. There is no `ContentSpec` for any of these keys
 * in `src/sim/Production.ts`, and that omission is the whole enforcement:
 * `ProductionCatalog` is keyed on `CONTENT`, every build tab is a view of the
 * catalog, so a key that is not in `CONTENT` cannot appear in a sidebar, cannot
 * be queued, and cannot be placed. They reach the world through
 * `ScenarioBuilder.spawnBuilding` and no other door.
 * ============================================================================
 */

/** Footprint in CELLS (4 m each) plus the frozen roofline in metres. */
export interface CivilianDimension {
  readonly w: number;
  readonly h: number;
  readonly height: number;
}

/**
 * THE FOOTPRINTS ARE THE GAMEPLAY, not the art.
 *
 * `GarrisonService.refusalFor` refuses anything under `GARRISON.minFootprint`
 * (2 cells on BOTH axes) with 'too small', so every one of these is at least
 * 2x2. That is not a coincidence to be tidied away later: a civilian structure
 * a squad cannot stand inside is a civilian structure with no mechanic.
 */
export const CIVILIAN_DIMENSIONS: Readonly<Record<string, CivilianDimension>> = {
  /** 8x8 m and tall: the derrick is a landmark you can see across a valley. */
  civOilDerrick: { w: 2, h: 2, height: 13 },
  /** 12x8 m, the widest of the three — the one worth fighting a squad over. */
  civHospital: { w: 3, h: 2, height: 10 },
  /** 8x12 m and the tallest, so a held block reads from the far side of a map. */
  civApartments: { w: 2, h: 3, height: 15 },
  /**
   * 8x8 m under a 12 m headframe. Same footprint as the derrick and for the
   * same two reasons: both axes clear `GARRISON.minFootprint`, so a SQUAD can
   * take it (the reported ask was "conquering with troops"), and a 2x2 is the
   * smallest thing `spawnBuilding` can seat on the patchy ground 128 m off the
   * lane midpoint without needing a parade square.
   */
  civOreMine: { w: 2, h: 2, height: 12 },
};

/**
 * Every civilian content key.
 *
 * NOT "in def-table order" any more, and the correction matters. That is what
 * this said, and it was true while the three rows were consecutive at index 51.
 * `civOreMine`'s def row is APPENDED to the END of `BUILDINGS` instead, because
 * `store.defId` is a raw array index that `src/game/Replay.ts` records raw — a
 * row inserted next to the civilian block to keep it tidy would repoint every
 * def id above it and make every recording on disk play back a different game.
 * Tidiness in this table is not worth that; `tests/civilians.spec.ts` pins both
 * halves (the original three still consecutive at 51, the new one last).
 */
export const CIVILIAN_KEYS: readonly string[] = [
  'civOilDerrick', 'civHospital', 'civApartments', 'civOreMine',
];

/** Content key -> the `STRUCTURE_MASS_LISTS` key its art is registered under. */
export const CIVILIAN_MODELS: Readonly<Record<string, string>> = {
  civOilDerrick: 'civ_derrick',
  civHospital: 'civ_hospital',
  civApartments: 'civ_apartments',
  civOreMine: 'civ_mine',
};

/* ==========================================================================
 * THE DERRICK'S INCOME
 * ========================================================================== */

/**
 * WHAT A DERRICK IS WORTH, and why it is a drip rather than a lump.
 *
 * A LUMP ON CAPTURE IS EXPLOITABLE HERE, and the exploit is structural rather
 * than a balance question. `GarrisonService.enter` flips a neutral structure to
 * the occupier through `captureService().captureBuilding(...)`, and
 * `releaseEmptied` flips it back the moment the last man leaves. So a
 * capture-bonus paid on `'building:captured'` would pay out every time one
 * rifleman walked in and out of a building, forever. The drip has no such edge:
 * income is a function of who holds the deed at each interval and of nothing
 * else.
 *
 * THE RATE. 15 credits a second, paid once a second. A harvester carries
 * `HARVESTER_CAPACITY` 700 credits on a round trip that measures 45-70 s in a
 * real match, so a derrick is worth roughly one harvester — without the 1400
 * credits, the War Factory, the escort or the micromanagement, and in exchange
 * for holding ground in the middle of the map. That trade is the entire design:
 * the map pays you for standing somewhere dangerous.
 *
 * IT IS PAID OFF THE TICK COUNTER, never a wall clock — see
 * `src/sim/civilian.system.ts`. Two clients in lockstep must bank the same
 * credit on the same tick or the checksum diverges on the first payout.
 */
export const CIVILIAN_INCOME = {
  /** Content key of the structure this row prices. */
  key: 'civOilDerrick',
  /** Credits banked per payout. */
  credits: 15,
  /** Sim ticks between payouts. 30 Hz, so this is one second. */
  intervalTicks: 30,
} as const;

/* ==========================================================================
 * THE ORE MINES
 *
 * Reported as: "lets spawn small amount of coal / ore / money mines around the
 * map, conquering with troops make us get income".
 *
 * The VERB was already finished — this is the derrick's mechanic, unchanged,
 * pointed at a second structure — so nothing below is new machinery. What is
 * new is a second content key, a second rate, and two more places on the map
 * worth walking to. `src/sim/civilian.system.ts` loops `CIVILIAN_INCOME_SOURCES`
 * instead of pinning one def id; that loop is the entire code change.
 *
 * "CONQUERING WITH TROOPS" IS ALREADY TWO VERBS AND BOTH WORK. An ENGINEER
 * takes the deed permanently (`Capture.ts` rule 1: a neutral structure flips at
 * any health). A SQUAD takes it for as long as they stand in it
 * (`Garrison.enter` calls `captureBuilding`, `releaseEmptied` hands it back).
 * The 2x2 footprint above is what keeps the second one available.
 *
 * THE RATE, DERIVED FROM THE MEASURED HARVESTER RATHER THAN THE INTENDED ONE
 * ------------------------------------------------------------------------
 * `config.ts` implies 700 credits a load (`HARVESTER_CAPACITY` 700 x
 * `ORE_VALUE` 1.0) on a `HARVESTER_TARGET_ROUNDTRIP` of 32 s — 21.875 credits
 * a second, 1312 a minute. THAT NUMBER HAS NEVER BEEN OBSERVED. Twelve
 * harvesters over seeds 4242/1337/90210 returned 36 loads in 240 s in
 * `tests/harvester-soak.spec.ts` — 429 to 700 credits per harvester per
 * minute, midpoint ~525 — and `src/data/Missions.ts` had already re-priced a
 * whole mission chain off that gap rather than off the constant. Pricing a map
 * reward against 1312 would make it look modest and play as a second economy.
 *
 * So, against the MEASURED 525/min:
 *
 *     derrick   15 cr/s   900 cr/min   1.71 harvesters
 *     ore mine   5 cr/s   300 cr/min   0.57 harvesters  (0.43-0.70 of the band)
 *
 * FIVE, i.e. exactly a third of a derrick, and the third is the point: a mine
 * has to be worth the walk and must not be worth abandoning an ore field for.
 * At 300 a minute a single mine pays for the 500-credit engineer that took it
 * in 100 seconds and pays for a 1400-credit harvester in under five minutes —
 * a real supplement to an economy, and nothing like a replacement for one.
 *
 * THE COUNT IS TWO, and it is bounded by geometry rather than by taste. They
 * go on the perpendicular bisector of the lane between the two openings, which
 * `Scenarios.addCivilians` establishes as THE ONLY LOCUS on a two-army map
 * where a point is exactly as far from one army as from the other — and that
 * line has two arms. Both mines held is 600 cr/min against the 1800 the two
 * derricks already offer, so this is +33% on the neutral income a 1v1 already
 * carried, not a new tier of it. See `MINE_BISECTOR_OFFSETS` for where on the
 * arms they land and why they are not on the atoll.
 * ========================================================================== */

/** One structure that pays its holder, and what it pays. */
export interface CivilianIncomeSource {
  /** Content key. Resolved to a def id once, at init. */
  readonly key: string;
  /** Credits banked per payout. */
  readonly credits: number;
  /** Sim ticks between payouts. */
  readonly intervalTicks: number;
}

/** The ore mine's row. See the block above for where 5 comes from. */
export const CIVILIAN_MINE_INCOME: CivilianIncomeSource = {
  key: 'civOreMine',
  credits: 5,
  intervalTicks: 30,
};

/**
 * Every structure that pays its holder.
 *
 * ONE INTERVAL FOR ALL OF THEM, and `tests/civilians.spec.ts` asserts it.
 * `civilian.system.ts` gates the whole payout round on a single
 * `s.tick % intervalTicks`, so a source with its own period would either need a
 * second modulus (two coalescing windows for one mechanic) or would silently
 * be paid on the wrong schedule. Varying the CREDITS is the whole of the
 * variation this table is for.
 */
export const CIVILIAN_INCOME_SOURCES: readonly CivilianIncomeSource[] = [
  CIVILIAN_INCOME, CIVILIAN_MINE_INCOME,
];

/**
 * Just the keys, for consumers that need to ask "does this structure pay
 * anybody" without caring how much.
 *
 * `src/sim/OreCrisis.ts` is the one that does, and it is the reason this export
 * is a bare string list: that module answers "can this player still EARN", and
 * a player holding one of these can, which is a fact about the KEY and not
 * about the rate.
 */
export const CIVILIAN_INCOME_KEYS: readonly string[] =
  CIVILIAN_INCOME_SOURCES.map((s) => s.key);
