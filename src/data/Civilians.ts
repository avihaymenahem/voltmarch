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
};

/** Every civilian content key, in def-table order. */
export const CIVILIAN_KEYS: readonly string[] = [
  'civOilDerrick', 'civHospital', 'civApartments',
];

/** Content key -> the `STRUCTURE_MASS_LISTS` key its art is registered under. */
export const CIVILIAN_MODELS: Readonly<Record<string, string>> = {
  civOilDerrick: 'civ_derrick',
  civHospital: 'civ_hospital',
  civApartments: 'civ_apartments',
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
  /** Content key of the only structure that pays. */
  key: 'civOilDerrick',
  /** Credits banked per payout. */
  credits: 15,
  /** Sim ticks between payouts. 30 Hz, so this is one second. */
  intervalTicks: 30,
} as const;
