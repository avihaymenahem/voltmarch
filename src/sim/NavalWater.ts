/**
 * ============================================================================
 * VOLTMARCH — src/sim/NavalWater.ts
 * ============================================================================
 * ONE ANSWER TO "DOES THIS BATTLEFIELD HAVE A SEA?", FOR EVERYONE WHO ASKS.
 *
 * Four separate features want that answer and they want the SAME one:
 *
 *   - `sim/Placement.ts`  refuses a Naval Yard that is not on a coast, and has
 *                         to say WHY — "not on the coast" and "this map has no
 *                         coast" are different sentences and only one of them
 *                         is actionable.
 *   - the sidebar         should not offer four naval structures and nine hulls
 *                         on a map with no water in it.
 *   - `sim/AI.ts`         should not spend an opening on a shipyard it cannot
 *                         found.
 *   - the map lobby       wants to say what kind of game a battlefield is.
 *
 * Three independent notions of "has water" is how a codebase grows a
 * contradiction — and TWO of them actually shipped into the same merge, this
 * one and a `mapSupportsNaval` in `sim/Flowfield.ts` with a threshold of 400
 * against this file's 300. They agreed on every map in the game, because the
 * real numbers are 0/3/11/14 against 3622/3952, which is exactly what makes a
 * duplicated definition dangerous: no test over the maps you own can catch it.
 * `Flowfield`'s copy is gone and its measurement is imported here instead.
 *
 * So this module imports `core/config`, `core/types` and `sim/Flowfield` — and
 * nothing else. None of the three touches THREE or the terrain implementation,
 * so anything in `src/` can still take it: the shell, the HUD, the sim.
 *
 * WHAT IT MEASURES, AND WHY IT IS NOT "ANY WATER"
 * ----------------------------------------------
 * Every biome in this game carves basins, so every map has ALWAYS had a little
 * water. Measured on the six shipped battlefields at their pinned seeds before
 * the seas landed: 0.00%-0.16% of cells wet, and the largest single body on any
 * of them was FOURTEEN CELLS. A test for "is there water" would have called
 * those puddles an ocean.
 *
 * So the measure is the LARGEST 4-CONNECTED BODY of navigable water, which is
 * the same quantity `tests/naval-maps.spec.ts` scores the sea maps on:
 *
 *     contested-strait  3622 cells        airbase-flats        0
 *     coral-shore       3952 cells        industrial-grid      0
 *                                         temperate-valley     3
 *                                         frozen-sector       11
 *
 * Two clusters four orders of magnitude apart, and `NAVAL_MIN_SEA_CELLS` sits
 * between them with a decade of margin on each side.
 *
 * "NAVIGABLE" IS THE PATHFINDER'S OWN RULE, NOT A RESTATEMENT OF IT. A cell
 * counts when it is water AND passable to a hover skirt, which is precisely
 * what `Flowfield.rebuildCost` requires before it will route `MoveClass.Naval`
 * through a cell (`water && PASS_HOVER`). Asked through the `ITerrain` port so
 * this module needs no nav cache and can be called before one exists.
 * ============================================================================
 */

import { CELL, MAP_CELLS, MAP_CELL_COUNT, NAVAL_MIN_SEA_CELLS } from '../core/config';
import { Locomotor } from '../core/types';
import type { ITerrain } from '../core/types';
import { MoveClass, getNav, navigableSeaCells } from './Flowfield';

/** What one map's water adds up to. */
export interface NavalWaterSurvey {
  /** Navigable water cells anywhere on the map. */
  readonly total: number;
  /** Cells in the largest 4-connected body of them. */
  readonly largest: number;
  /** A cell inside that body, or -1 when there is none. */
  readonly cx: number;
  readonly cz: number;
  /** `largest >= NAVAL_MIN_SEA_CELLS`. The one-bit answer. */
  readonly navalViable: boolean;
}

const EMPTY: NavalWaterSurvey = { total: 0, largest: 0, cx: -1, cz: -1, navalViable: false };

/* -- scratch, allocated once ---------------------------------------------- */
const label = new Int32Array(MAP_CELL_COUNT);
const stack = new Int32Array(MAP_CELL_COUNT);
const wet = new Uint8Array(MAP_CELL_COUNT);

/* --------------------------------------------------------------------------
 * MEMOISATION, AND THE ONE HAZARD IT HAS TO SURVIVE
 *
 * A flood fill over 16384 cells is nothing once and far too much sixty times a
 * second — and it IS asked that often: the AI's placement ring search calls
 * `evaluatePlacement` for hundreds of candidate sites in a single tick, and
 * every site that fails the shore test asks this module for the sentence to
 * refuse with.
 *
 * Caching on the terrain OBJECT alone is not enough, because `Terrain.setSea`
 * and `Terrain.setBiome` regenerate the whole heightfield IN PLACE: same
 * object, different map, and a stale "this battlefield has no water" would be
 * unfalsifiable from the player's side. So the key is the object PLUS a
 * fingerprint of the water grid itself, sampled on a fixed lattice. A sea
 * covers a fifth of the map or it is not a sea, so a re-roll cannot hide from
 * 64 probes; and 64 reads is a cost that can be paid per call.
 * ------------------------------------------------------------------------ */

/** Probes per axis for the fingerprint. 8x8 = 64 samples over the whole map. */
const PROBE_N = 8;
const PROBE_STEP = Math.max(1, Math.floor(MAP_CELLS / PROBE_N));

let cachedFor: ITerrain | null = null;
let cachedPrint = -1;
let cached: NavalWaterSurvey = EMPTY;

function fingerprint(terrain: ITerrain): number {
  let h = 0x811c9dc5;
  for (let z = 0; z < MAP_CELLS; z += PROBE_STEP) {
    for (let x = 0; x < MAP_CELLS; x += PROBE_STEP) {
      h ^= terrain.isWater(x, z) ? 1 : 0;
      // FNV-ish mix. Any avalanche will do; this is a change detector, not a
      // hash table key.
      h = Math.imul(h, 0x01000193);
    }
  }
  return h | 0;
}

/** Drop the memo. New match, new map, or a test rig starting over. */
export function invalidateNavalWater(): void {
  cachedFor = null;
  cachedPrint = -1;
  cached = EMPTY;
}

/**
 * Measure the map's navigable water. Memoised; see the note above.
 *
 * Allocation-free after the first call — the flood fill runs in module-scope
 * typed arrays and the result object is only rebuilt when the map changes.
 */
export function surveyNavalWater(terrain: ITerrain | null): NavalWaterSurvey {
  if (terrain === null) return EMPTY;
  const print = fingerprint(terrain);
  if (terrain === cachedFor && print === cachedPrint) return cached;

  wet.fill(0);
  let total = 0;
  for (let cz = 0; cz < MAP_CELLS; cz++) {
    const row = cz * MAP_CELLS;
    for (let cx = 0; cx < MAP_CELLS; cx++) {
      if (!terrain.isWater(cx, cz)) continue;
      // The pathfinder's own test. A flooded cell inside a cliff shadow is not
      // sea a ship can be in.
      if (!terrain.isPassable(cx, cz, Locomotor.Hover)) continue;
      wet[row + cx] = 1;
      total++;
    }
  }

  label.fill(0);
  let next = 0;
  let largest = 0;
  let seed = -1;
  for (let start = 0; start < MAP_CELL_COUNT; start++) {
    if (wet[start] === 0 || label[start] !== 0) continue;
    const id = ++next;
    let sp = 0;
    stack[sp++] = start;
    label[start] = id;
    let size = 0;
    while (sp > 0) {
      const c = stack[--sp];
      size++;
      const cx = c % MAP_CELLS;
      if (cx > 0) { const n = c - 1; if (wet[n] !== 0 && label[n] === 0) { label[n] = id; stack[sp++] = n; } }
      if (cx < MAP_CELLS - 1) { const n = c + 1; if (wet[n] !== 0 && label[n] === 0) { label[n] = id; stack[sp++] = n; } }
      if (c >= MAP_CELLS) { const n = c - MAP_CELLS; if (wet[n] !== 0 && label[n] === 0) { label[n] = id; stack[sp++] = n; } }
      if (c < MAP_CELL_COUNT - MAP_CELLS) {
        const n = c + MAP_CELLS;
        if (wet[n] !== 0 && label[n] === 0) { label[n] = id; stack[sp++] = n; }
      }
    }
    if (size > largest) { largest = size; seed = start; }
  }

  cached = {
    total,
    largest,
    cx: seed < 0 ? -1 : seed % MAP_CELLS,
    cz: seed < 0 ? -1 : (seed / MAP_CELLS) | 0,
    navalViable: largest >= NAVAL_MIN_SEA_CELLS,
  };
  cachedFor = terrain;
  cachedPrint = print;
  return cached;
}

/**
 * THE PREDICATE. Is there enough open water on this battlefield for a navy to
 * be a thing a player can have?
 *
 * Every consumer should ask through here rather than counting wet cells of its
 * own: the sidebar hiding naval rows, the AI skipping a shipyard in its
 * opening, the placement rule choosing which sentence to refuse with, and the
 * lobby describing the map must all agree, or a player is offered a Naval Yard
 * by one of them and told by another that there is nowhere to put it.
 */
export function mapSupportsNaval(terrain: ITerrain | null): boolean {
  // THE LIVE PATHFINDER WINS WHENEVER THERE IS ONE, and that is not an
  // optimisation. `surveyNavalWater` re-derives "navigable water" as
  // water AND hover-passable — the same rule `Flowfield.rebuildCost` uses, but
  // a SECOND copy of it. A gate that answers "there is a navy here" from its
  // own copy of the rule can drift from the module that actually decides where
  // a hull may go, and then the build menu offers a shipyard for a sea no ship
  // can enter. Asking the nav removes the possibility rather than testing for
  // it.
  //
  // The flood below is the fallback for the cases with no nav yet: the lobby
  // describing a map before a match exists, a headless test, the `?shot=`
  // harness. Same threshold either way.
  if (getNav() !== null) return navigableSeaCells() >= NAVAL_MIN_SEA_CELLS;
  return surveyNavalWater(terrain).navalViable;
}

/* ==========================================================================
 * PICKUP POINTS — where a hull and a land unit can actually touch
 * ========================================================================== */

/**
 * The navigable cell nearest to (`cx`, `cz`) that a hull can sit in.
 *
 * Both halves of an amphibious pickup need this and they used to have neither.
 * A carrier is `MoveClass.Naval` and cannot cross a beach; infantry are
 * `MoveClass.Foot` and water is impassable to them, so `Flowfield` snaps their
 * goal back to the last dry cell. Told to board a hull sitting offshore, a
 * squad therefore walked to the sand and stopped, while `TransportService.board`
 * re-stamped the order every tick — the boarding sat at 0 aboard forever, which
 * is exactly the failure `sim/AI.ts` documents having hit from the other side.
 *
 * Nothing moved the HULL toward them. The AI eventually learned to, privately,
 * inside `AiBrain`; the player path never did. This is that search, extracted
 * so both callers ask one question, and pinned to the MAIN naval region so a
 * hull is never sent to a landlocked pond it cannot reach.
 *
 * Returns false when there is no nav cache, no sea, or nothing within
 * `maxRadius` cells — every caller must handle that rather than assume a coast.
 */
export function nearestBoardingWater(
  cx: number, cz: number, out: Int32Array, maxRadius = PICKUP_SEARCH_CELLS,
): boolean {
  const nav = getNav();
  if (nav === null) return false;
  const main = nav.mainRegion(MoveClass.Naval);
  if (main === 0) return false;
  return nav.nearestInRegion(cx, cz, main, MoveClass.Naval, out, maxRadius);
}

/**
 * How far a carrier will divert to collect a squad, in cells.
 *
 * Generous, because the cost of being short is the reported bug — a hull that
 * refuses to come in and a squad that stands on the sand — and the cost of
 * being long is one hull crossing more open water than it needed to. 30 cells
 * is 120 m, the same reach `AI_NAVAL.shoreSearchCells` uses to find a beach.
 */
export const PICKUP_SEARCH_CELLS = 30;

/**
 * Metres of slack before a waiting hull is re-ordered toward its pickup point.
 *
 * Without it every tick rewrites the hull's destination, which restarts its
 * path and leaves it shuffling in place. Two cells, matching the tolerance the
 * AI's own boarding loop settled on.
 */
export const PICKUP_SETTLE_METRES = CELL * 2;
