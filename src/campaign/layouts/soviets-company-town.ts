/**
 * ============================================================================
 * VOLTMARCH — src/campaign/layouts/soviets-company-town.ts
 * ============================================================================
 * S4 — THE GROUND. One Works company town on the map centre, five working
 * derricks in a ring round it, and THREE bases instead of two.
 *
 * ============================================================================
 * THREE SEATS, AND THE FIRST THING THAT CHANGES IS THAT THE SEED STOPS
 * CHOOSING THE CORNERS
 * ============================================================================
 * Every shipped operation is two armies, and for two armies `seatedSlots`
 * draws a PAIR out of `START_PAIRS` from `startPairFor(seed)` — which is why
 * `02-common-standard` and `03-deep-sector` both carry a paragraph saying
 * "change `simSeed` and every distance in this file is a different distance".
 *
 * **THAT PARAGRAPH DOES NOT APPLY HERE, AND THE REASON IS ONE LINE OF
 * `seatedSlots`:** `if (n !== 2) return Array.from({ length: n }, (_, i) => i)`.
 * A three-army match occupies slots 0, 1 and 2, at every seed, on every
 * landlocked preset. `startPointsFor` walks the same function to reserve the
 * shelves, so the ground and the bases agree by construction rather than by a
 * roll. Every distance below is therefore SEED-INDEPENDENT, and `simSeed` here
 * buys only the draws of `s.rng` — scatter, ore cells, formation jitter.
 *
 * The three slots are `SKIRMISH_START_OFFSETS` at `(±148, ±124)` from the map
 * centre, and this is the whole geometry of the operation:
 *
 *     slot 0   (108, 380)   the player
 *     slot 1   (404, 132)   the Ninth District
 *     slot 2   (404, 380)   the Eleventh District
 *
 *     player -> Ninth       386.16 m
 *     player -> Eleventh    296.00 m
 *     Ninth  -> Eleventh    248.00 m      <- the closest pair on the map
 *     every slot -> centre  193.08 m      <- exactly equal, by arithmetic
 *
 * Measured through the real generator at TWENTY-FOUR different `mapSeed`s on
 * this preset: **`nudgeToBuildable` moved no slot at any of them, and the three
 * distances above came back identical every time.** That is the shelf
 * reservation doing its job — `startPointsFor` reserves one per seated slot and
 * `buildableFraction` scores each 1.0, so the rescue branch never opens.
 *
 * **THE TWO DISTRICTS ARE NEARER TO EACH OTHER THAN EITHER IS TO THE PLAYER,
 * AND THEY ARE HOSTILE TO EACH OTHER.** `PlayerState.allyMask` defaults to
 * self-only, so a free-for-all needs no code at all (`Shell.applySetupToWorld`
 * says exactly that about itself) and nothing in `Shell.startOperation` allies
 * two opponent seats. So this is a three-way, and both other corners are
 * somebody's front line. **WHAT IS NOT CLAIMED IS THAT THE TWO BRAINS SPEND
 * MORE ON EACH OTHER THAN ON THE PLAYER.** That is an AI behaviour, it has not
 * been measured, and CLAUDE.md's own warning about mirror-match A/Bs applies:
 * do not read "they are mutually hostile" as "the player is fighting one army".
 *
 * The 193.08 is the same arithmetic `soviets-common-standard` states about
 * Survey 40: every authored slot sits at `(±START_SPREAD_X, ±START_SPREAD_Z)`
 * from the centre, so `hypot(148, 124)` is the distance from ALL of them and no
 * other point on the map is equidistant from three corners of a rectangle. On
 * a continent `startPointsFor` also puts `(256, 256)` FIRST in the shelf list,
 * ahead of the seated slots, so the town stands on flat, dry, buildable ground
 * that is joined to the main passable region — guaranteed inside
 * `TERRAIN_START_FLAT_RADIUS` (58 m), which is why a 38 m derrick ring is safe
 * as a literal.
 *
 * **A WARNING FOR WHOEVER RE-MEASURES THIS, BECAUSE IT COST A CYCLE.**
 * `startSpots` calls `nudgeToBuildable`, which scores `terrain.isBuildable`,
 * which is FALSE on a cell a structure occupies. So calling `startSpots` AFTER
 * the world is built reports openings that were never used: on this operation
 * it answered (73.4, 400.0) / (404, 164) / (372, 380) — three slots apparently
 * shoved 32-40 m — while the bases had in fact gone down on the nominal three.
 * Measure the spots BEFORE the build, or read the yards off the store.
 *
 * ============================================================================
 * THE TOWN IS NOBODY'S, WHICH IS THE ONLY REASON IT CAN BE CAPTURED
 * ============================================================================
 * All five derricks are GAIA. `Capture.ts` rule 1: a structure owned by a
 * `Faction.Neutral` player flips OUTRIGHT, at any health, and the engineer is
 * consumed. An AI-owned derrick would take rule 2 instead — capture only at or
 * below `CAPTURE.captureHpFrac` (0.5) — which is a demolition job wearing a
 * capture's name, and not what "a worked town" means.
 *
 * Three consequences fall out of that ownership and all three are the
 * operation:
 *
 *   1. **Gaia is allied to everybody**, so no targeting scan considers a
 *      derrick an enemy while the Works still holds it. The town is safe until
 *      the player touches it. **Capturing one is what paints it.**
 *   2. **The districts cannot take one, by either verb.** There are TWO ways to
 *      flip a neutral structure and `src/data/Civilians.ts` names both: an
 *      ENGINEER takes the deed permanently, and a SQUAD takes it for as long as
 *      they stand in it (`GarrisonService.enter` calls `captureBuilding`,
 *      `releaseEmptied` hands it back). Neither is reachable for a brain.
 *      `AiBrain` owns no engineer — CLAUDE.md's capability audit lists
 *      `Capture` as unreachable, the def's weight is 0 and `buildUnits` filters
 *      `weight <= 0` — and the ONLY `OrderKind.Enter` anywhere in `AI.ts` is
 *      the amphibious boarding path, addressed to a transport hull, on a map
 *      with a sea. This one is landlocked. So a derrick the player has taken
 *      stops counting only when it is DESTROYED, and `GarrisonService.enter`
 *      returns `'hostile'` for a structure its player is not allied to, which
 *      closes the last door.
 *
 *      **THE GARRISON ROUTE IS OPEN TO THE PLAYER AND IS NOT A CHEAPER
 *      ENGINEER.** A squad in a derrick holds the deed while it stands there
 *      and hands it straight back to Gaia the moment the last man walks out or
 *      dies — so it is a deed the hold timer can lose to a single splash, in a
 *      building both districts are shooting at. It is a real second answer with
 *      a real second cost, it needs no rule from this file, and the operation
 *      neither mentions it nor forbids it.
 *   3. **Five placed against three required is what that costs.** A derrick
 *      the districts level is gone for the rest of the match, so the operation
 *      has to be able to absorb two of them. It cannot absorb three, and
 *      `04-company-town.ts` says out loud that the vocabulary cannot express
 *      "fewer than three derricks left standing" — `entityAlive` is a
 *      threshold-free `> 0` and `ownerCount` can only name a SEAT, which Gaia
 *      is not, because `validateCampaign`'s `checkSeat` refuses any player
 *      index outside the three this operation seats.
 *
 * A captured derrick pays **15 credits a second** (`CIVILIAN_INCOME`), so three
 * are 2700 a minute against a measured harvester's 525 — 5.1 haulers — and it
 * also projects `PLACEMENT.adjacencyRadius` (20 m) of build space, because
 * `withinBuildRadius` reads every finished structure the player owns and asks
 * nothing about what kind it is. **Taking the town is what lets you fortify
 * it**, and nothing scripts that: it is the placement rule the player already
 * knows, pointed at a building they did not build.
 *
 * ============================================================================
 * NOTHING GUARDS THE TOWN, AND THAT IS THE HONEST SHAPE OF A CAPTURE-HOLD
 * ============================================================================
 * No emplacement, no picket, no wall. Two reasons, in ascending order.
 *
 * The first is fiction: a Works company town on a seam nobody has finished
 * arguing about is a town, not a post. Both filings say it is already theirs,
 * so neither district garrisoned it.
 *
 * The second is that a garrison would be a lie. `AiBrain.census` files every
 * AI-owned mobile hull into `armyIds` and `regroupSquads` files everything in
 * `armyIds` into a squad; measured 2026-08-19 on `02-common-standard`, two
 * Wardens parked on an objective were re-tasked inside FOUR SECONDS and died
 * 127 m away having never stood on it. `campaign-maps.spec.ts` pins the rule.
 * An emplacement would survive — but a concrete gun on a civilian town would be
 * asserting that somebody moved in, which is exactly what the premise says
 * nobody did.
 *
 * So the difficulty is not the taking. It is that the moment the deed changes
 * the town stops being scenery to two armies at once, 193 m from each of their
 * yards, and the clock only runs while you still hold three.
 *
 * ============================================================================
 * NO TRIGONOMETRY, AND NO `rotateStarts`
 * ============================================================================
 * The derrick ring is an authored INTEGER TABLE, not a table rotated by
 * `Math.cos`/`Math.sin`. ECMA-262 pins `+ - * /` and `Math.sqrt` and pins
 * neither trig function, a layout runs independently on both machines of a
 * lockstep match, and `soviets-common-standard` already states this rule about
 * its own placement rings. The five offsets sit at 37.9-38.8 m from the town
 * centre and 44.0-46.2 m from their neighbours, which is a ring by arithmetic.
 *
 * `rotateStarts` is not called, for `reclamation-held-paper`'s reason: an
 * operation pins its seed, so the rotation is a moving part with exactly one
 * value — a coin flipped once at authoring time deciding whether every measured
 * coordinate in this file belongs to the player or to a district. Seat `i`
 * takes slot `i` because this file never shuffles the owners.
 *
 * ============================================================================
 * TAGS
 * ============================================================================
 * `derrick` — the five Works derricks. Stamped here, and Gaia-owned, so the
 *   `campaign-maps.spec.ts` rule about a tag on an AI seat needing to be a
 *   building does not even reach them (it skips `Faction.Neutral`). The
 *   operation reads them through `ownerCount(0, 'building', tag)`, which counts
 *   what the PLAYER owns and is therefore zero at t=0 and rises with each
 *   capture.
 * `crew` — the four engineers. On seat 0, so nothing re-tasks them.
 * `ninth` / `eleventh` — the two district columns. Produced by `spawnUnits` in
 *   the trigger table, never by this file, and declared anyway so a reader
 *   asking "where does the pressure come from" finds the answer in the file
 *   that owns the ground. `validateCampaign` and `campaign-maps.spec.ts` both
 *   know a spawned tag is not the layout's to place.
 *
 * **IT READS NO CLOCK, NO PROFILE AND NO DOM.** It runs inside the world build,
 * which is where the tick-zero desync lives: `Scenarios.ts` calls `isBuildable`
 * while spawning, and that answers from the LOCAL profile unless the
 * operation's roster is installed first. `campaign-install.ts` installs it
 * BEFORE the boot, so this gets the same world on every machine.
 * ========================================================================== */

import { MAP_SIZE } from '../../core/config';
import { NONE } from '../../core/types';
import { addStartOre, buildBaseFor, startSpots, wrapDeg } from '../../game/Scenarios';
import type { EntityId, PlayerId } from '../../core/types';
import type { Area, Point } from '../types';
import { layout } from '../layout';

/* ==========================================================================
 * 1. THE PLACES THE TRIGGER TABLE ALSO READS
 *
 * World metres, absolute, on a 512 m map. A trigger table is STATIC DATA
 * frozen at module load, so an `Area` cannot be derived from a start spot the
 * generator has not chosen yet — the coordinates have to be literals
 * somewhere. This module owns them and `operations/soviets/04-company-town.ts`
 * imports them; the dependency runs operation -> layout and never back.
 *
 * A number written in two files is a number that will disagree the first time
 * either is tuned, and the failure is a reveal that frames empty ground or a
 * reinforcement that lands somewhere nobody authored.
 * ========================================================================== */

/** The map centre. `startPointsFor` reserves a shelf here first, on a continent. */
const CENTRE = MAP_SIZE * 0.5;

/**
 * The company town — 193.08 m from all three openings, by the arithmetic in
 * the header rather than by choice.
 */
export const TOWN: Point = { x: CENTRE, z: CENTRE };

/**
 * The town, as a disc, for `revealArea`.
 *
 * 62 m rather than the ring's 38, so the reveal covers the derricks, the town's
 * own mass and the ground a defender would stand on. It is NOT a hold disc —
 * the primary is `ownerCount` over a tag, so this operation never asks where
 * anybody is standing. See `04-company-town.ts` on why a deed beats a disc for
 * this beat.
 */
export const TOWN_AREA: Area = { x: TOWN.x, z: TOWN.z, r: 62 };

/**
 * Where the crew forms up: 54.7 m out from the player's START SPOT along the
 * line to the town — 51.6 m from the Construction Yard that spot raises, which
 * lands at (114, 382) and is not the same point.
 *
 * DERIVED, THEN WRITTEN DOWN. `(148, -124) / 193.08` is the unit vector from
 * slot 0 to the centre; 55 m along it from (108, 380) is (150.2, 344.7), and
 * this is that rounded to metres. Far enough out that the opening frame reads
 * as a column about to march rather than as four men loitering behind a yard,
 * close enough that the base's own garrison is still between them and both
 * districts.
 *
 * MEASURED ON THE BUILT WORLD: the four engineers settle at z 351, x 142.5 to
 * 157.5 — **136.85 m from the town centre for the nearest of them and
 * 100.65 m from the nearest derrick**, which is the number the operation's
 * clock is written against.
 */
export const STAGE: Point = { x: 150, z: 345 };

/**
 * Where the Ninth District's column forms, and where the Eleventh's does.
 *
 * **OUT FROM EACH DISTRICT'S OWN YARD, NOT ON THE TOWN.** `BUILD_RADIUS` is 56,
 * so both of these are just outside their own base — a column that has formed
 * up and is about to leave, which is a schedule the opponent gets stronger on.
 * Dropping either on the town would materialise an army inside a holding
 * player's formation, which reads as the map cheating however correct the
 * fiction is.
 *
 *     NINTH_ROAD      (369, 193)   66.29 m from its yard   129.38 m to the town
 *     ELEVENTH_ROAD   (360, 333)   64.54 m from its yard   129.40 m to the town
 *     apart                                                140.29 m
 *
 * (Those two figures are to the YARDS, measured at (406, 138) and (402, 382).
 * They read 70.33 and 64.38 while they were quoting the START SPOTS (404, 132)
 * and (404, 380) under the word "yard"; the spot and the yard are different
 * points and the yard is what `BUILD_RADIUS` is centred on.)
 *
 * **THE TWO ARE 0.02 m APART IN REACH TO THE TOWN AND THAT IS SELECTED, NOT
 * SYMMETRIC.** The mirror-image pair would have been (369, 193) and (369, 319),
 * and the ground is not a mirror. These two came out of a measured scan of the
 * 50-100 m band round each yard, chosen for equal reach rather than for equal
 * coordinates — so **a change of `mapSeed` invalidates both**, unlike every
 * other number in this file.
 *
 * **`EffectSink.spawnUnits` DOES NOT SNAP TO STANDABLE GROUND.** Everything
 * this file places goes through `ScenarioBuilder.spawnUnit`, which calls
 * `connectedGround`; the Director's path calls `ProductionService.spawnUnit`,
 * which clamps to the map, reads `heightAt` and allocates, and asks nothing.
 * `soviets-common-standard` shipped a reward hull standing on a knoll that way.
 *
 * That is exactly what the first draft of this file got wrong. (350, 177) reads
 * beautifully on the arithmetic — 70 m out along the line, exact mirror of
 * (350, 335) — and it is **impassable to Foot and to Track**, sitting on a
 * terrace face where `heightAt` runs 3.09 to 8.11 over twenty metres. Both
 * points above are measured passable at the centre AND at every point of **all
 * four spread rings the trigger table actually uses** (20x5, 14x2, 22x6, 15x3),
 * on the built world with all three bases standing. Re-measure all four if a
 * count or a spread changes.
 */
export const NINTH_ROAD: Point = { x: 369, z: 193 };
export const ELEVENTH_ROAD: Point = { x: 360, z: 333 };

/* ==========================================================================
 * 2. THE RING
 * ========================================================================== */

/**
 * The five derricks, as offsets from the town centre.
 *
 * INTEGERS, AUTHORED, NEVER A ROTATED TABLE — see the header. The nominal radii
 * are 38.0 / 37.9 / 38.8 / 38.8 / 37.9 m; MEASURED on the built world, after
 * `place` and after `spawnBuilding` snapped each footprint to the grid, they
 * land at **36.00 to 40.00 m from the town centre, nearest pair 43.27 m, widest
 * 74.40 m**. The largest `splashRadius` anywhere in the weapon tables is 6.5 m,
 * so nothing in the game can reach two derricks with one shell and each of the
 * five is a separate decision to defend.
 *
 * The whole ring sits inside `TERRAIN_START_FLAT_RADIUS` (58 m), which is the
 * promise that makes a literal safe here at all — and the audit agrees: the
 * built world reports **0 structures on ground `isBuildable` refuses** and 0
 * stranded entities, with one passable region holding 100% of its cells.
 */
const DERRICK_OFFSETS: readonly Point[] = [
  { x: 0, z: -38 },
  { x: 36, z: -12 },
  { x: 22, z: 32 },
  { x: -22, z: 32 },
  { x: -36, z: -12 },
];

/**
 * The town's own mass, as offsets from the centre. A works hall and two blocks.
 *
 * MEASURED: the hall lands at (256, 254) — 2.00 m off the centre, 1100 hp — and
 * the two blocks at (236, 270) and (276, 270), 24.41 m out, 800 hp each. All
 * three are well inside the 36 m the nearest derrick stands at, so the ring
 * encloses a solid core rather than sharing ground with it.
 */
const HALL_OFFSET: Point = { x: 0, z: -4 };
const BLOCK_OFFSETS: readonly Point[] = [
  { x: -20, z: 14 },
  { x: 20, z: 14 },
];

/** Metres reserved around each derrick, so the next search cannot land on it. */
const DERRICK_CLEAR = 10;
/** Metres reserved around the whole town, so `scatter` leaves the ring walkable. */
const TOWN_CLEAR = 56;

/** Metres searched outward for a legal footprint. Nearest first, integer rings. */
const PLACE_RINGS: readonly number[] = [0, 6, 12, 18, 26, 34];
/** Eight exact bearings. Integers only, so every candidate is bit-identical. */
const PLACE_BEARINGS: readonly (readonly [number, number])[] = [
  [1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
];
/** Ring zero is the nominal spot itself; the bearings would test it eight times. */
const ORIGIN_ONLY: readonly (readonly [number, number])[] = [[0, 0]];

/** Engineers the crew opens with. Three captures the primary, one spare. */
const CREW_SIZE = 4;

export default layout({
  id: 'soviets-company-town',
  tags: ['derrick', 'crew', 'ninth', 'eleventh'],

  build(b, cx, cz, start, c) {
    /*
     * THE EXPORTED POINTS ARE ABSOLUTE AND THIS BUILD IS SHELF-ANCHORED, SO THE
     * TWO HAVE TO AGREE. `buildScenario` passes `startShelf()`, which is
     * `startLocations()[0]`, which `startPointsFor` puts at the map centre on
     * every continent. If that ever stops being true the trigger table is
     * naming ground this file never dressed — and it would be invisible,
     * because every tag would still land and every test would still pass.
     * `soviets-common-standard` carries the same guard for the same reason.
     */
    if (Math.abs(cx - CENTRE) > 1 || Math.abs(cz - CENTRE) > 1) {
      console.error(
        `[campaign] soviets-company-town built on (${cx}, ${cz}), not the map centre `
        + `(${CENTRE}, ${CENTRE}) — the town is authored in absolute coordinates and will `
        + 'not line up with the ground this build lays down.',
      );
    }

    const spots = startSpots(cx, cz, b.armies, b.sea, b.seed);

    /*
     * SLOT ORDER, NOT `rotateStarts`. See the header: the seed is a constant
     * for an operation, so the rotation has exactly one value and taking it
     * would make every measured coordinate in this file depend on
     * `startOffset(seed, 3)`. Seat 0 is the player's corner by construction.
     */
    for (let i = 0; i < spots.length; i++) {
      buildBaseFor(b, c.seat(i), spots[i].x, spots[i].z, {
        facingDeg: wrapDeg(spots[i].facingDeg + 180),
      });
    }

    const us: PlayerId = c.seat(0);
    const home = spots[0];

    /* -- placement helper -------------------------------------------------
     * `findClearFootprint` ALONE IS NOT ENOUGH and the build says so out loud.
     * It asks `footprintClear` (is anything already there) and `connectedGround`
     * (can an army reach it) and NOTHING about slope, so `spawnBuilding` will
     * plant a structure on a grade `isBuildable` refuses and report success —
     * the split `footprintBuildable`'s own header draws, written after four
     * civilian derricks went down on a 0.45 slope. These derricks are the
     * objective and the player has to be able to build beside them, so both
     * questions are asked here and the shipped search is only the fallback.
     *
     * NO TRIGONOMETRY. The offsets are an exact integer table scaled by an
     * integer radius, so every candidate is bit-identical on any engine.
     */
    const scratch = new Float32Array(2);
    const place = (key: string, p: Point): Point => {
      const f = b.footprintOf(key);
      for (const r of PLACE_RINGS) {
        for (const [ox, oz] of r === 0 ? ORIGIN_ONLY : PLACE_BEARINGS) {
          const px = p.x + ox * r;
          const pz = p.z + oz * r;
          if (b.footprintBuildable(px, pz, f.w, f.h) && b.footprintClear(px, pz, f.w, f.h)) {
            return { x: px, z: pz };
          }
        }
      }
      if (b.findClearFootprint(p.x, p.z, f.w, f.h, scratch)) {
        return { x: scratch[0], z: scratch[1] };
      }
      return p;
    };

    const offset = (base: Point, d: Point): Point => ({ x: base.x + d.x, z: base.z + d.z });

    /* -- the derricks ------------------------------------------------------
     * PLACED FIRST, because they are the operation and everything else in the
     * town has to give way to them. Blocked after each placement so the next
     * search cannot land on top of it and so `scatter` keeps its distance —
     * `spawnBuilding` marks cells occupied, `block` is what holds props off.
     *
     * GAIA, and the whole capture rule depends on it. See the header.
     *
     * `civOilDerrick` is untagged in `UNLOCK_TAGS`, so this operation's empty
     * allow-list roster cannot refuse one — which matters more here than
     * anywhere else, because a refused `spawnBuilding` returns NONE, the tag
     * lands on nothing, and the primary would be unreachable with every test
     * still green. `campaign-maps.spec.ts` checks the declaration both ways.
     */
    for (let i = 0; i < DERRICK_OFFSETS.length; i++) {
      const at = place('civOilDerrick', offset(TOWN, DERRICK_OFFSETS[i]));
      const id: EntityId = b.spawnBuilding('civOilDerrick', b.gaia, at.x, at.z, {
        yawDeg: (i * 72) % 360,
      });
      c.tag('derrick', id);
      if (id !== NONE) b.block(at.x, at.z, DERRICK_CLEAR);
    }

    /* -- the town itself ---------------------------------------------------
     * A works hall on the centre and two housing blocks behind it, all Gaia.
     *
     * THE SOLID MIDDLE IS THE POINT, not the dressing. `soviets-common-standard`
     * makes the same argument about Survey 40: a ring with an open centre is
     * ground where whoever has more guns wins, while a ring round a block of
     * footprints is ground hulls have to commit to a side of. Every one of these
     * is a real navigation obstacle, and every one is a garrisonable civilian
     * structure the player can put a squad in — `civOilDerrick` and the blocks
     * are 2x2 and 2x3 precisely so a squad fits.
     */
    {
      const at = place('civHospital', offset(TOWN, HALL_OFFSET));
      const id = b.spawnBuilding('civHospital', b.gaia, at.x, at.z, { yawDeg: 90 });
      if (id !== NONE) b.block(at.x, at.z, 14);
    }
    for (let i = 0; i < BLOCK_OFFSETS.length; i++) {
      const at = place('civApartments', offset(TOWN, BLOCK_OFFSETS[i]));
      const id = b.spawnBuilding('civApartments', b.gaia, at.x, at.z, { yawDeg: i * 180 });
      if (id !== NONE) b.block(at.x, at.z, 12);
    }

    /* -- the crew ----------------------------------------------------------
     * Four engineers at the staging point, and the count is the objectives:
     * three captures is the primary and the fourth is the only spare the
     * operation hands out. Everything past that is 500 credits and ten seconds
     * out of the barracks the opening base already has — `engineer`'s prereqs
     * are `barracks` and `refinery` and `buildSovietBase` places both.
     *
     * SPAWNED ONE AT A TIME RATHER THAN THROUGH `b.formation`, because
     * `formation` returns a COUNT and `c.tag` needs a handle. The trigger table
     * reads this tag, so the crew has to be tagged, so the convenience helper
     * cannot be used.
     *
     * `engineer` goes through `keyFor`, which maps it per army — a layout's key
     * is a ROLE. The OPERATION file cannot do this: `EffectSink.spawnUnits`
     * resolves through `ProductionCatalog.byKey` and remaps nothing.
     */
    for (let i = 0; i < CREW_SIZE; i++) {
      const id = b.spawnUnit(
        'engineer', us,
        STAGE.x + (i - (CREW_SIZE - 1) * 0.5) * 5,
        STAGE.z + 6,
        { yawDeg: home.facingDeg },
      );
      c.tag('crew', id);
    }

    /*
     * THE ESCORT, AND IT IS NOT TAGGED. `ownerCount(..., tag: 'crew')` is the
     * trigger table's "have you any engineers left" and mixing hulls into that
     * tag would make it answer a different question. These are ordinary units
     * of the player's, indistinguishable from anything the war factory makes
     * afterwards, which is correct: the escort is replaceable and the crew is
     * the thing that is not.
     *
     * ONLY UNGATED ROLE KEYS. `roster: { player: [], ai: [] }` makes
     * `isBuildable` an ALLOW-LIST, so anything carrying an `UNLOCK_TAGS` id is
     * REFUSED for every seat and `spawnUnit` returns NONE without a word.
     * `grizzly` and `gi` carry no tag and resolve to this seat's own hulls.
     *
     * Units reserve nothing for themselves — see `START_CLEAR_RADIUS` — and
     * `b.scatter` honours the reservation list, so without the `block` below the
     * column forms up in a boulder field.
     */
    b.formation('grizzly', us, STAGE.x, STAGE.z - 10, 3, {
      yawDeg: home.facingDeg, spacing: 9, columns: 3, jitter: 0.5,
    });
    b.formation('gi', us, STAGE.x, STAGE.z - 22, 4, {
      yawDeg: home.facingDeg, spacing: 5, columns: 4, jitter: 0.6,
    });
    b.block(STAGE.x, STAGE.z, 26);

    /* -- economy and dressing ---------------------------------------------
     * `addStartOre` lays one home field per opening plus ONE contested patch on
     * the CENTROID of the three, which for slots 0/1/2 is (305.33, 297.33) —
     * **64.36 m off the town centre, on the districts' side of it**, with a
     * radius of 22, so its near rim is 42.4 m out and clears the outermost
     * derrick at 40.00 m by 2.4 m.
     *
     * That is the right place for it and it is why NO ore is laid in the town.
     * The town pays in DEEDS — 15 credits a second per derrick — and a
     * harvester parked inside the objective would be a second, unauthored
     * reason to be there. `soviets-deep-sector` had to move a whole ore field
     * 88 m for the same hazard, because a harvester counts to `unitsInArea`;
     * the primary here is `ownerCount` over a tag and cannot be gamed that way,
     * but the pull on the player's attention would be real either way.
     */
    addStartOre(b, spots, b.sea);

    /*
     * NO `addCivilians`, AND THE REASON IS THE DERRICKS.
     *
     * It hangs capturable `civOilDerrick`s and two hamlets off the perpendicular
     * bisector of the openings, and walks `MINE_BISECTOR_OFFSETS` outward from
     * the lane midpoint for a `civOreMine` — the same silhouette and the same
     * capture verb this operation has spent on the five derricks that ARE the
     * objective. A player told to work three derricks and able to see eight is a
     * player the layout has lied to. `allies-sounding-line` skips it for the
     * same reason and `soviets-common-standard` measured its mine landing 4.0 m
     * from that operation's objective.
     */

    // Reserved LAST, so every structure above could still find its own
    // footprint, and wide enough that `scatter`'s centre test cannot drop a 4 m
    // pine whose canopy overhangs the ring.
    b.block(TOWN.x, TOWN.z, TOWN_CLEAR);

    // The opening frame: the yard with the crew in front of it and the road to
    // the town behind them. Biased 13% toward the centre, the same bias
    // `allies-sounding-line` uses, so the first thing on screen is the
    // direction the operation goes.
    b.setCameraFocus(home.x + (cx - home.x) * 0.13, home.z + (cz - home.z) * 0.13);
    b.scatter({ minX: cx - 160, minZ: cz - 160, maxX: cx + 160, maxZ: cz + 160 }, 150);
    void start;
  },
});
