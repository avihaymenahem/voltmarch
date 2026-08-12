/**
 * ============================================================================
 * VOLTMARCH — src/sim/LandRoutes.ts
 * ============================================================================
 * "CAN THE ARMIES ON THIS BATTLEFIELD REACH EACH OTHER WITHOUT A BOAT?"
 *
 * THIS IS NOT `mapSupportsNaval`, AND THE DIFFERENCE IS THE WHOLE FILE.
 * `sim/NavalWater.ts` answers "is there enough open water here for a navy to be
 * a thing a player can have" — a question about the SEA, asked by the sidebar,
 * the placement rule, the AI's opening and the lobby, and it is deliberately the
 * ONE copy of that measurement (its own header records the two that shipped in
 * one merge at thresholds 300 and 400). Nothing here duplicates it; this module
 * imports it and composes with it.
 *
 * What this file measures is the GROUND, and the two answers are independent:
 *
 *     contested-strait   sea: yes   ground: one region   -> a navy is optional
 *     airbase-flats      sea: no    ground: one region   -> there is no navy
 *     sunder-atoll       sea: yes   ground: FOUR regions -> a navy is the only
 *                                                           way to touch anyone
 *
 * WHY THE THIRD ROW NEEDED A NEW PREDICATE
 * ----------------------------------------
 * `Sunder Atoll` shipped with no map unlock so a fresh profile could select it,
 * and was a PERMANENT STALEMATE on one: `struct.naval` gates all four docks and
 * is paid by a single mission ("win 10 skirmishes"), the Hover Transport is
 * gated on a dock, and `UnlockGate.mirrorAI` resolves the AI against the human's
 * profile — so four armies sat on four islands, none of them able to build a
 * hull, and the match could not end. `mapSupportsNaval` was TRUE the whole time
 * and could not have caught it: it says a navy is possible, not that it is the
 * only road.
 *
 * The rule that was actually broken is narrower than "ungate naval", and it is
 * the one `Production.mobilityExempt` implements against this predicate:
 *
 *     CONTENT REQUIRED TO REACH THE ENEMY IS NEVER PROGRESSION-GATED.
 *
 * On a land map a dock is optional content and gating it is forty releases of
 * intended design (`docs/MISSIONS_DESIGN.md`). On a map where the only road runs
 * over water, the same dock is the road.
 *
 * WHAT COUNTS AS A LAND MASS, AND WHY IT IS NOT "MORE THAN ONE REGION"
 * -------------------------------------------------------------------
 * A region big enough to be somebody's home, i.e. at least
 * `TERRAIN_ISLAND_MIN_CELLS` — a constant this module did not invent and does
 * not restate: `core/config` derives it as the cell count of the start
 * guarantee's own disc, and `terrain-gen`'s `islandStartSatisfied` already uses
 * it for exactly this meaning. Measured by THIS function over the seven shipped
 * battlefields, at the preset, biome, pinned `mapSeed` and army count the lobby
 * offers — land masses, and the ground they hold:
 *
 *     temperate-valley  1 x 12802        airbase-flats     1 x 12692
 *     frozen-sector     1 x 11909        industrial-grid   1 x 12849
 *     contested-strait  1 x  9285        coral-shore       1 x  9705
 *     sunder-atoll      4 x 1819..1874 (7404 cells) + one 31-cell noise basin
 *
 * So the floor sits between 31 and 1819 with two orders of magnitude of margin
 * on each side, and a bare region COUNT would have read that 31-cell basin as a
 * fifth island — and would read any comparable pocket on a land map as an
 * archipelago, which is the regression that matters.
 *
 * OCCUPANCY IS CANCELLED OUT, ON PURPOSE
 * --------------------------------------
 * `ITerrain.isPassable` returns false for a cell a structure or an impassable
 * prop sits on, so a naive flood would measure TODAY'S BASE LAYOUT and not the
 * battlefield. Two things follow from that and both are bad: the verdict could
 * flip mid-match (wall off 573 cells of a continent and the naval arm silently
 * ungates), and the memo below would re-flood every time a building went up. A
 * cell counts here when it is passable OR occupied, which is a pure function of
 * the heightfield and the waterline. Occupancy can only ever MERGE regions, so
 * the error direction is toward "this is a continent" — the conservative one.
 *
 * DERIVED FROM THE MAP, WHICH EVERY CLIENT SHARES. That is what makes it safe
 * to feed a build gate: two players on one battlefield always get the same
 * answer. It is emphatically NOT the progression unlock gate, which answers from
 * the LOCAL PROFILE and caused the tick-zero desync `Scenarios.ts` had to be
 * rescued from. See `Production.rebuildCameos` for the same two properties
 * written out against the landlocked filter.
 *
 * Imports `core/config`, `core/types` and `sim/NavalWater` — none of which
 * touches THREE or the terrain implementation — so anything in `src/` can take
 * it.
 * ============================================================================
 */

import { MAP_CELLS, MAP_CELL_COUNT, TERRAIN_ISLAND_MIN_CELLS } from '../core/config';
import { Locomotor } from '../core/types';
import type { ITerrain } from '../core/types';
import { mapSupportsNaval } from './NavalWater';

/** What one map's dry ground adds up to. */
export interface LandMassSurvey {
  /** Cells a ground hull could stand on, ignoring what is parked there. */
  readonly ground: number;
  /** Cells in the largest single land mass. */
  readonly largest: number;
  /** Land masses of at least `TERRAIN_ISLAND_MIN_CELLS`. */
  readonly landMasses: number;
  /** `landMasses <= 1`. The one-bit answer: one land world, or several. */
  readonly landLinked: boolean;
}

const EMPTY: LandMassSurvey = { ground: 0, largest: 0, landMasses: 0, landLinked: true };

/* -- scratch, allocated once ---------------------------------------------- */
const label = new Int32Array(MAP_CELL_COUNT);
const stack = new Int32Array(MAP_CELL_COUNT);
const dry = new Uint8Array(MAP_CELL_COUNT);

/**
 * MEMOISATION, WITH THE SAME HAZARD `NavalWater` DOCUMENTS.
 *
 * `Terrain.setSea` and `Terrain.setBiome` regenerate the whole heightfield IN
 * PLACE — same object, different battlefield — so the terrain identity alone is
 * not a key. The key is the object PLUS a fingerprint of the ground itself,
 * sampled on a fixed 8x8 lattice. An island map differs from a continent over a
 * quarter of the map or it is not an island map, so a re-roll cannot hide from
 * 64 probes.
 *
 * The probe reads the SAME predicate the flood does (passable-or-occupied), so
 * placing a building never disturbs the fingerprint and never re-floods.
 */
const PROBE_N = 8;
const PROBE_STEP = Math.max(1, Math.floor(MAP_CELLS / PROBE_N));

let cachedFor: ITerrain | null = null;
let cachedPrint = -1;
let cached: LandMassSurvey = EMPTY;

/**
 * Ground a tracked hull could occupy if nothing were parked on it.
 *
 * `Locomotor.Track` is the ground class, and it is the right one to ask with:
 * `Locomotor.Hover` is amphibious (it is what `Flowfield.moveClassForLocomotor`
 * promotes to `MoveClass.Naval` over water), so flooding with it would report
 * an atoll as one continent and defeat the whole measurement.
 */
function isGround(terrain: ITerrain, cx: number, cz: number): boolean {
  return terrain.isPassable(cx, cz, Locomotor.Track) || terrain.isOccupied(cx, cz);
}

function fingerprint(terrain: ITerrain): number {
  let h = 0x811c9dc5;
  for (let cz = 0; cz < MAP_CELLS; cz += PROBE_STEP) {
    for (let cx = 0; cx < MAP_CELLS; cx += PROBE_STEP) {
      h ^= isGround(terrain, cx, cz) ? 1 : 0;
      // FNV-ish mix. Any avalanche will do; this is a change detector, not a
      // hash table key.
      h = Math.imul(h, 0x01000193);
    }
  }
  return h | 0;
}

/** Drop the memo. New match, new map, or a test rig starting over. */
export function invalidateLandRoutes(): void {
  cachedFor = null;
  cachedPrint = -1;
  cached = EMPTY;
}

/**
 * Measure the map's land masses. Memoised; see the note above.
 *
 * Allocation-free after the first call — the flood runs in module-scope typed
 * arrays and the result object is only rebuilt when the map changes.
 */
export function surveyLandMasses(terrain: ITerrain | null): LandMassSurvey {
  if (terrain === null) return EMPTY;
  const print = fingerprint(terrain);
  if (terrain === cachedFor && print === cachedPrint) return cached;

  dry.fill(0);
  let ground = 0;
  for (let cz = 0; cz < MAP_CELLS; cz++) {
    const row = cz * MAP_CELLS;
    for (let cx = 0; cx < MAP_CELLS; cx++) {
      if (!isGround(terrain, cx, cz)) continue;
      dry[row + cx] = 1;
      ground++;
    }
  }

  label.fill(0);
  let next = 0;
  let largest = 0;
  let masses = 0;
  for (let start = 0; start < MAP_CELL_COUNT; start++) {
    if (dry[start] === 0 || label[start] !== 0) continue;
    const id = ++next;
    let sp = 0;
    stack[sp++] = start;
    label[start] = id;
    let size = 0;
    // 4-connected, which is the connectivity a grid pathfinder actually uses —
    // the same rule `Flowfield.labelRegions` and `tests/archipelago.spec.ts`
    // apply. 8-connected would join two islands through a diagonal touch.
    while (sp > 0) {
      const c = stack[--sp];
      size++;
      const cx = c % MAP_CELLS;
      if (cx > 0) { const n = c - 1; if (dry[n] !== 0 && label[n] === 0) { label[n] = id; stack[sp++] = n; } }
      if (cx < MAP_CELLS - 1) { const n = c + 1; if (dry[n] !== 0 && label[n] === 0) { label[n] = id; stack[sp++] = n; } }
      if (c >= MAP_CELLS) { const n = c - MAP_CELLS; if (dry[n] !== 0 && label[n] === 0) { label[n] = id; stack[sp++] = n; } }
      if (c < MAP_CELL_COUNT - MAP_CELLS) {
        const n = c + MAP_CELLS;
        if (dry[n] !== 0 && label[n] === 0) { label[n] = id; stack[sp++] = n; }
      }
    }
    if (size > largest) largest = size;
    if (size >= TERRAIN_ISLAND_MIN_CELLS) masses++;
  }

  cached = { ground, largest, landMasses: masses, landLinked: masses <= 1 };
  cachedFor = terrain;
  cachedPrint = print;
  return cached;
}

/**
 * Is all the ground worth fighting over on ONE land mass?
 *
 * True for every battlefield in the game except `Sunder Atoll`, and true for a
 * map with no ground at all — "nobody is separated" is the right answer to an
 * empty measurement, and it keeps a null or stub terrain (the `?shot=` harness,
 * a headless test) on the ordinary path.
 */
export function mapLandLinked(terrain: ITerrain | null): boolean {
  return surveyLandMasses(terrain).landLinked;
}

/**
 * THE PREDICATE. Must an army cross water to reach another army here?
 *
 * BOTH HALVES ARE LOAD-BEARING, and the AND is what makes this compose with the
 * landlocked filter rather than fight it:
 *
 *   - `mapSupportsNaval` false  -> a map with no navigable water. Naval content
 *     is HIDDEN outright (`Production.rebuildCameos` skips every `requiresSea`
 *     entry), so an exemption here would be ungating cameos nobody can see and
 *     a dock `evaluatePlacement` refuses. False.
 *   - `mapLandLinked` true      -> one land mass. A dock is optional content and
 *     the progression gate on it is the intended design. False.
 *
 * Only the third combination — real water AND separated ground — makes the sea
 * the only road, and that is the one case the exemption fires in.
 */
export function mapForcesSeaCrossing(terrain: ITerrain | null): boolean {
  if (terrain === null) return false;
  return mapSupportsNaval(terrain) && !mapLandLinked(terrain);
}
