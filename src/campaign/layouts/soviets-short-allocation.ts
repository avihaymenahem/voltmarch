/**
 * ============================================================================
 * VOLTMARCH — src/campaign/layouts/soviets-short-allocation.ts
 * ============================================================================
 * S5 — THE GROUND. Three workings strung along one lane, and the whole
 * operation is how far along that lane the player is willing to stand.
 *
 * ============================================================================
 * THE THREAT IS THE LANE, NOT THE TRIGGER TABLE
 * ============================================================================
 * `soviets-company-town` records the measurement this layout is built around:
 * two hulls parked on an objective were re-filed by `AiBrain.regroupSquads`
 * within FOUR SECONDS and died 127 m away having never stood on it. The same
 * fact runs the other way for a DEFEND, and it is the reason the workings are
 * strung along the opening-to-opening lane rather than hung off its flanks:
 *
 * **`orderTagged ... attackMove` IS A HEADING AND NOT A LEASH.** A wave the
 * trigger table points at a working is the AI's within a pass or two, and the
 * brain then attacks whatever the brain wanted to attack. So an operation
 * whose pressure depends on waves ARRIVING somewhere is an operation whose
 * pressure is a guess. An operation whose objectives sit ON the ground every
 * Allied advance already crosses does not need the waves to obey: attack-move
 * engages what is in front of it, and what is in front of it is a working.
 *
 * The waves still buy something real, and it is exactly what
 * `soviets-company-town` claims for its own: an army already formed up outside
 * the Ninth's gate at a known minute, on a bearing, without having had to build
 * it. Read them as the district being stronger at 3:00, 6:30, 10:00 and 13:30
 * than it could otherwise have been — not as a scripted attack on a named
 * building.
 *
 * ============================================================================
 * `simSeed` PICKS THE CORNERS AND EVERY NUMBER BELOW DEPENDS ON IT
 * ============================================================================
 * `seatedSlots` draws a PAIR out of `START_PAIRS` from `startPairFor(seed)` for
 * a two-army match. At `simSeed` **5521** that is the pair **[0, 1]**, so the
 * player opens at **(108, 380)** facing 130 and the Ninth at **(404, 132)**
 * facing -50, on the 386.16 m diagonal — the widest of the four layouts, and
 * the only one with room for three separated positions between the openings.
 * **Change `simSeed` and every distance in this file is a different distance.**
 *
 * `facingDeg` 130 is not decoration either: `sin(130)`/`cos(130)` is
 * (0.7665, -0.6422), which is the unit vector from the player's opening to the
 * Ninth's to four places. The openings face each other down the lane, so
 * "along the lane" and "the direction the base is pointing" are the same
 * bearing, and `addStartOre`'s perpendicular home field lands on the side of
 * the base the workings are NOT on.
 *
 * ============================================================================
 * THE LADDER, MEASURED ON THE BUILT WORLD
 * ============================================================================
 * Three workings, and the operation asks for two. Which two is the decision,
 * and the ground makes it for the player by putting them at three different
 * distances from home along one axis. Every figure below is read off a headless
 * build with the def tables BOUND and `setCampaignRoster` INSTALLED, which is
 * the only state in which the operation's allow-list is actually in force —
 * unbound it reads 31 / 28 buildings and is measuring a different game:
 *
 *     WORKING_NEAR   (148, 296)    93.04 m from the player, 304.03 m from the Ninth
 *     WORKING_MID    (216, 232)   183.22 m                  212.94 m
 *     WORKING_FAR    (280, 192)   254.81 m                  137.75 m
 *
 * **BOTH COLUMNS ARE MEASURED TO THE OPENINGS** — (108, 380) and (404, 132) —
 * and NOT to the Construction Yards, which land at (114, 382) and (402, 134).
 * To the yards the same six figures are 92.48 / 301.26, 181.40 / 210.24 and
 * 252.30 / 135.09. The spot is what the generator levels a shelf at; the yard
 * is what `BUILD_RADIUS` is centred on, so a sentence has to say which.
 *
 *     NEAR -> MID   93.38 m     MID -> FAR   75.47 m     NEAR -> FAR   168.05 m
 *
 * All three land on their literals: nothing in this file was moved by the ring
 * search, and the build reports **0 structures on ground `isBuildable` refuses**
 * and 0 stranded entities, with one passable region holding 11 648 of 11 729
 * cells (99.3%) for a tracked hull.
 *
 * The near working is 92.48 m from the yard — 36 m past `BUILD_RADIUS` (56), so
 * the base's build space does not reach it and the base's own guns do not cover
 * it, but it is one short walk from both. The far working is 135.09 m from the
 * Ninth's yard and 252.30 m from the player's: holding it is standing on
 * somebody else's doorstep for seventeen minutes. The middle one is the one the
 * operation is actually about.
 *
 * **NO TWO OF THEM CAN BE COVERED BY ONE POSITION AND THAT IS ARITHMETIC.** The
 * closest pair is 75.47 m apart. The longest structure weapon either army can
 * build under this operation's roster is `pillboxMg` at **22 m** (`sentryGun`,
 * `pillbox`); `flameJet` is 18 and `teslaBolt`'s 30 is withheld. Two 22 m rings
 * reach 44 m between them against a 75.47 m gap, so one emplacement covers one
 * working, and a mobile force covers one at a time and pays 75 to 168 m to
 * change its mind.
 *
 * **AND EACH WORKING PROJECTS ITS OWN BUILD SPACE, WHICH IS WHY THIS IS
 * PLAYABLE AT ALL.** `withinBuildRadius` walks every finished structure the
 * player owns and asks nothing about what kind it is, so a `civOreMine` — 2x2,
 * `store.radius` 4 — carries `PLACEMENT.adjacencyRadius` 20 + 4 = **24 m** of
 * legal ground around itself. A Sentry Gun (400 credits, 480 hp, no power draw,
 * off the Barracks the opening base already has) goes up beside any of the
 * three without extending the base to reach it. Three of them is 1200 credits
 * out of a 3000 bank. None of that is scripted; it is the placement rule the
 * player already knows, pointed at a building they did not build.
 *
 * ============================================================================
 * THE SEAM PAYS BOTH SIDES THE SAME, AND THE DIFFERENCE IS THE SHAPE
 * ============================================================================
 * Every working is a `civOreMine` owned by the PLAYER from tick zero, and
 * `CIVILIAN_MINE_INCOME` pays its holder **5 credits a second — 300 a minute**.
 * Three of them is 900 a minute, which against a MEASURED harvester's 525 is
 * 1.71 haulers. The Ninth's tap is a `civOilDerrick` on seat 1, and
 * `CIVILIAN_INCOME` pays **15 a second — 900 a minute**.
 *
 * **900 EACH. THE TWO ARMIES HAVE IDENTICAL SEAM INCOME AND IT IS DISTRIBUTED
 * ON ONE SIDE AND CONCENTRATED ON THE OTHER.** That is the operation in one
 * line: the player's income is in three places and can be taken a third at a
 * time; the Ninth's is in one place and can be taken all at once. It is why the
 * hidden secondary is worth a detachment and why losing a working is worth
 * more than an objective counter.
 *
 * `civOreMine` and `civOilDerrick` are CIVILIAN keys, which is the load-bearing
 * half. No sidebar in the game builds one, so a working the player loses is
 * gone — where an `oreSilo` (150 credits, five seconds) would have let a player
 * rebuild the thing on the same spot and find the objective still counting it
 * as lost, because a rebuilt structure carries no tag. An objective that can be
 * replaced by a structure the objective does not recognise is a rule nobody can
 * see.
 *
 * **NEITHER SIDE CAN TAKE THE OTHER'S BY CAPTURE, WHICH LEAVES ONLY THE GUN.**
 * `Capture.ts` rule 2 refuses an army-owned structure above
 * `CAPTURE.captureHpFrac` (0.5), and `GarrisonService.enter` returns
 * `'hostile'` for a structure its player is not allied to — so the garrison
 * route is closed outright.
 *
 * **THE ENGINEER ROUTE IS CLOSED FOR THE NINTH BY THE VERB, NOT BY THE ROSTER,
 * AND AN EARLIER DRAFT HAD THIS BACKWARDS.** It said "`AiBrain` owns no
 * engineer", which is true of what the brain BUILDS (`weight` 0, and
 * `buildUnits` filters `weight <= 0`) and false of what it HOLDS:
 * `game/scenarios/AlliedBase.ts` spawns one with every Allied opening, so seat 1
 * owns an engineer from tick zero — measured on the bound headless build,
 * `seat1 u:engineer x1`. What actually closes the route is that
 * `OrderKind.Capture` has **zero occurrences in `src/sim/AI.ts`**: the brain has
 * never issued the verb, which is the gap CLAUDE.md's capability audit already
 * lists. `regroupSquads` files that engineer into a squad and attack-moves it
 * like any other hull. If the brain is ever given `Capture`, this operation
 * needs re-reading — a working taken rather than killed still drops
 * `ownerCount`, so `t.cut` would fire correctly, but the header's "DESTROYED,
 * not contested" stops being true. It is NOT closed for the player against
 * the Ninth's tap, and the operation deliberately leaves that open — see
 * `05-short-allocation.ts` on why the objective still says destroy.
 *
 * ============================================================================
 * NOTHING GUARDS THE PLAYER'S WORKINGS AND ONE THING GUARDS THE NINTH'S
 * ============================================================================
 * No emplacement, no picket, no wall at any of the three. The operation is
 * "which of these do you cover", and a layout that covers them has answered the
 * question on the player's behalf. What the ground gives instead is one
 * compensation, at the position that needs it: a Gaia `civApartments` (800 hp)
 * measured **22.36 m** from WORKING_FAR, which is a garrisonable building —
 * `GarrisonService.enter` allows an allied owner and Gaia is allied to
 * everybody — so the hardest working to hold is the only one with a firing
 * position beside it. That is a real affordance and it is not scripted
 * anywhere. 22.36 m is also past the largest `splashRadius` in the weapon
 * tables (6.5 m), so nothing in the game reaches the working and the house with
 * one shell.
 *
 * The Ninth's tap gets two `pillbox`es, measured 20.59 m and 18.11 m off it,
 * because an emplacement cannot be re-filed into a squad and a parked hull can.
 * Same rule, same measurement, stated in `soviets-deep-sector`'s header first.
 *
 * The opening forces, on that same bound-and-installed build:
 *
 *     seat 0  the player   27 buildings   13 units   <- 3 of them are workings
 *     seat 1  the Ninth    26 buildings   12 units   <- 3 of them are tap + guns
 *     Gaia                  1 building     0 units   <- the shift house
 *
 * So the two bases are 24 against 23 and the operation adds the rest. There is
 * no thumb on the scale here; the asymmetry this operation ships is the SHAPE of
 * the seam income, not the size of the opening.
 *
 * ============================================================================
 * NO TRIGONOMETRY IN THE PLACEMENT
 * ============================================================================
 * Every authored point is an integer literal and the search rings are integer
 * offsets. ECMA-262 pins `+ - * /` and `Math.sqrt` and pins neither `sin` nor
 * `cos`; a layout runs independently on both machines of a lockstep match, so a
 * table rotated by trig is a tick-zero desync waiting for two engines to
 * disagree in the last mantissa bit. `soviets-company-town` states the same
 * rule about its ring.
 *
 * `rotateStarts` is not called, for `reclamation-held-paper`'s reason: an
 * operation pins its seed, so the rotation is a moving part with exactly one
 * value — a coin flipped once at authoring time deciding whether every measured
 * coordinate in this file belongs to the player or to the Ninth.
 *
 * ============================================================================
 * TAGS
 * ============================================================================
 * `working`   — the three player-owned mine workings. Read by
 *               `ownerCount(0, 'building', tag)`, which counts what the PLAYER
 *               owns, so it is 3 at tick zero and only ever falls.
 * `alliedTap` — the Ninth's derrick. On seat 1 and a BUILDING, which is what
 *               `campaign-maps.spec.ts` requires of any tag an `entity*`
 *               condition reads on an AI seat.
 * `wave1` / `wave2` / `wave3e` / `wave3w` / `wave4` — the four Allied troops,
 *               the third of them in two prongs and so carrying two tags.
 *               Produced by `spawnUnits` in the trigger table, never by this
 *               file, and declared anyway so a reader asking "where does the
 *               pressure come from" finds the answer in the file that owns the
 *               ground. `validateCampaign` and `campaign-maps.spec.ts` both know
 *               a spawned tag is not the layout's to place.
 *
 * **IT READS NO CLOCK, NO PROFILE AND NO DOM.** It runs inside the world build,
 * which is where the tick-zero desync lives: `Scenarios.ts` calls `isBuildable`
 * while spawning, and that answers from the LOCAL profile unless the operation's
 * roster is installed first. `campaign-install.ts` installs it BEFORE the boot.
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
 * World metres, absolute, on a 512 m map. A trigger table is STATIC DATA frozen
 * at module load, so an `Area` or an order point cannot be derived from a start
 * spot the generator has not chosen yet — the coordinates have to be literals
 * somewhere. This module owns them and `operations/soviets/05-short-allocation.ts`
 * imports them; the dependency runs operation -> layout and never back.
 *
 * A number written in two files is a number that will disagree the first time
 * either is tuned, and the failure — a reveal that frames empty ground, a
 * column that lands somewhere nobody authored — is invisible to every gate.
 * ========================================================================== */

/** The map centre. `startPointsFor` reserves a shelf here first, on a continent. */
const CENTRE = MAP_SIZE * 0.5;

/**
 * The three workings, nearest to farthest along the lane.
 *
 * AUTHORED AT THE SPOT THEY ACTUALLY LAND ON. The first draft wrote the nominal
 * points a fraction along the lane produced — (154, 302), (216, 232),
 * (279, 193) — and `place` moved the first one 8.49 m and `spawnBuilding`'s own
 * footprint snap moved the third. **`place` returning a point is not the same
 * as a structure standing on it**: `spawnBuilding` snaps the result to the
 * footprint grid a second time, so the only honest source for a coordinate in a
 * header is the built world. These three are those coordinates, which makes the
 * ring search a check rather than a mechanism — it now finds all three at ring
 * zero, and would report if the ground under one ever changed.
 */
export const WORKING_NEAR: Point = { x: 148, z: 296 };
export const WORKING_MID: Point = { x: 216, z: 232 };
export const WORKING_FAR: Point = { x: 280, z: 192 };

/**
 * The shift house: a Gaia `civApartments` 22.36 m from the far working.
 *
 * THE ONLY THING ON THE MAP THAT COMPENSATES A POSITION FOR BEING HARD TO
 * HOLD. See the header — it is garrisonable, and the far working is the one
 * that needs it.
 *
 * **THIS LITERAL IS THE REQUESTED POINT AND NOT THE LANDING**, which is the one
 * place in this file that breaks the "authored at the spot they actually land
 * on" convention stated below. `civApartments` is a 2x3 footprint raised at a
 * yaw that quantises to 90, and `ScenarioBuilder.spawnBuilding` snaps on the
 * FACED footprint, so a non-square block at that yaw snaps on the swapped
 * lattice and lands at **(258, 188)** — 2.83 m out, which is where the 24.74 m
 * this comment used to quote went. The three workings and both tap pillboxes
 * are square or axis-neutral and do land on their literals.
 */
const SHIFT_HOUSE: Point = { x: 256, z: 186 };

/**
 * The Ninth's tap — a `civOilDerrick` on seat 1, paying them 900 credits a
 * minute, with two pillboxes on it.
 *
 * ON THE NINTH'S SIDE OF THE SEAM AND NOT IN THEIR BASE. Measured **121.85 m**
 * from their opening and 282.84 m from the player's, with the far working
 * 92.09 m away — far enough out that a raid is a raid rather than a base
 * assault, near enough that a raid meets whatever they have at home.
 * `soviets-deep-sector` puts its deep tap at 129 m from the Allied opening and
 * calls that "standing on its doorstep"; this is the same band.
 */
export const ALLIED_TAP: Point = { x: 356, z: 244 };

/** The tap, as a disc, for the reveal that discloses the hidden secondary. */
export const ALLIED_TAP_AREA: Area = { x: ALLIED_TAP.x, z: ALLIED_TAP.z, r: 52 };

/**
 * Where the Ninth's columns form up.
 *
 * **OUT FROM THEIR OWN YARD, NOT ON A WORKING.** `BUILD_RADIUS` is 56 and these
 * sit 12 m and 27 m past it — a column that has formed up and is about to
 * leave, which is a schedule the opponent gets stronger on. Dropping either on
 * a working would materialise an army inside a defending player's formation,
 * which reads as the map cheating however correct the fiction is.
 *
 * **`EffectSink.spawnUnits` DOES NOT SNAP TO STANDABLE GROUND.** Everything
 * this file places goes through `ScenarioBuilder.spawnUnit`, which calls
 * `connectedGround`; the Director's path calls `ProductionService.spawnUnit`,
 * which clamps to the map, reads `heightAt` and allocates, and asks nothing.
 * `soviets-common-standard` shipped a reward hull standing on a knoll that way.
 *
 * **THE GUARANTEE IS A RADIUS, NOT A LIST OF RING POINTS, AND THAT IS WHAT
 * MAKES IT SURVIVE A RETUNE.** `spawnUnits` lays a deterministic ring of
 * `count` points at radius `spread`, so the exact points move whenever a count
 * moves. Measured instead: **every 2 m sample within 24 m of each of these two
 * points is passable to Foot AND to Track**, on the built world with both bases
 * standing — so any spread up to 24 and any count is safe, and re-measurement
 * is only needed if a spread goes past 24 or the ground moves.
 *
 * The first draft put the west one at (315, 134), which is 82 m from the same
 * yard, reads correctly as a mirror, and is **impassable at its own centre** —
 * clear radius 1. The east one was at (395, 205) with a clear radius of 17,
 * which passed nine of the ten authored rings and dropped one rifleman of one
 * wave on a blocked cell. `temperate` is the steepest preset any operation uses
 * and a symmetric-looking pair of points is not a measured one.
 *
 *     ROAD_EAST   (402, 200)   66.00 m from the Ninth's yard, lane offset +50.8
 *     ROAD_WEST   (334,  88)   82.10 m,                        lane offset -78.7
 *     apart                   131.03 m
 *
 * (68.03 and 82.68 are the distances to the Ninth's START SPOT (404, 132). The
 * yard that spot raises lands at (402, 134); the two are different points and
 * the yard is the one a column forms up outside of.)
 *
 *     ROAD_EAST -> FAR 122.26   -> MID 188.73   -> NEAR 271.54   -> tap 63.66
 *     ROAD_WEST -> FAR 117.18   -> MID 186.17
 *
 * ROAD_WEST is also 35.47 m from the Ninth's home ore field (radius 30), which
 * clears its rim by 5.5 m — a column forming up in their own harvesters would
 * look like the map having nowhere else to put it.
 */
export const ROAD_EAST: Point = { x: 402, z: 200 };
export const ROAD_WEST: Point = { x: 334, z: 88 };

/* ==========================================================================
 * 2. PLACEMENT
 * ========================================================================== */

/** Metres searched outward for a legal footprint. Nearest first, integer rings. */
const PLACE_RINGS: readonly number[] = [0, 6, 12, 18, 26, 34];
/** Eight exact bearings. Integers only, so every candidate is bit-identical. */
const PLACE_BEARINGS: readonly (readonly [number, number])[] = [
  [1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
];
/** Ring zero is the nominal spot itself; the bearings would test it eight times. */
const ORIGIN_ONLY: readonly (readonly [number, number])[] = [[0, 0]];

/** Metres reserved around a working, so `scatter` leaves it approachable. */
const WORKING_CLEAR = 14;

export default layout({
  id: 'soviets-short-allocation',
  tags: ['working', 'alliedTap', 'wave1', 'wave2', 'wave3e', 'wave3w', 'wave4'],

  build(b, cx, cz, start, c) {
    /*
     * THE EXPORTED POINTS ARE ABSOLUTE AND THE START SPOTS ARE DERIVED FROM
     * (cx, cz), SO THE TWO HAVE TO AGREE. `buildScenario` passes `startShelf()`,
     * which is `startLocations()[0]`, which `startPointsFor` puts at the map
     * centre on every continent. If that ever stops being true this file is
     * dressing ground the trigger table is not naming — and it would be
     * invisible, because every tag would still land and every test would still
     * pass. `soviets-company-town` carries the same guard for the same reason.
     */
    if (Math.abs(cx - CENTRE) > 1 || Math.abs(cz - CENTRE) > 1) {
      console.error(
        `[campaign] soviets-short-allocation built on (${cx}, ${cz}), not the map centre `
        + `(${CENTRE}, ${CENTRE}) — the workings are authored in absolute coordinates and `
        + 'will not line up with the openings this build lays down.',
      );
    }

    const spots = startSpots(cx, cz, b.armies, b.sea, b.seed);

    /*
     * SLOT ORDER, NOT `rotateStarts`. See the header: the seed is a constant for
     * an operation, so the rotation has exactly one value and taking it would
     * make every measured coordinate in this file depend on `startOffset`.
     */
    for (let i = 0; i < spots.length; i++) {
      buildBaseFor(b, c.seat(i), spots[i].x, spots[i].z, {
        facingDeg: wrapDeg(spots[i].facingDeg + 180),
      });
    }

    // `c.seat` is `b.armySlot`, which CREATES a slot rather than returning
    // undefined, so neither of these needs a fallback — and a `?? us` here would
    // be a dead branch that reads as a guard.
    const us: PlayerId = c.seat(0);
    const them: PlayerId = c.seat(1);
    const home = spots[0];

    /* -- placement helper -------------------------------------------------
     * `findClearFootprint` ALONE IS NOT ENOUGH and the build says so out loud.
     * It asks `footprintClear` (is anything already there) and `connectedGround`
     * (can an army reach it) and NOTHING about slope, so `spawnBuilding` will
     * plant a structure on a grade `isBuildable` refuses and report success —
     * the split `footprintBuildable`'s own header draws, written after four
     * civilian derricks went down on a 0.45 slope.
     *
     * `temperate` is `relief` 0.42 / `cliffs` 0.35, so this matters more here
     * than it did on `soviets-company-town`'s urban 0.14 / 0.10. It is NOT the
     * steepest preset a shipped operation uses — `snow` is 0.50 / 0.40 under
     * `soviets.03.deep-sector` and `arid` carries `cliffs` 0.55 under
     * `soviets.01.first-tap` — and an earlier draft said it was. Both questions
     * are asked, and the shipped search is only the fallback.
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

    /* -- the three workings ------------------------------------------------
     * PLACED FIRST, because they are the operation and everything else has to
     * give way to them. Owned by the PLAYER from tick zero — this is a defence,
     * not a capture, and `ownerCount(0, 'building', 'working')` therefore reads
     * 3 at the first tick and only ever falls.
     *
     * `civOreMine` carries no `UNLOCK_TAGS` row, so this operation's empty
     * allow-list roster cannot refuse one — which matters more here than
     * anywhere else, because a refused `spawnBuilding` returns NONE, the tag
     * lands on nothing, and `ownerCount(max: 1)` would end the operation in
     * defeat twenty seconds in with every test still green.
     * `campaign-maps.spec.ts` checks the declaration both ways.
     */
    for (const nominal of [WORKING_NEAR, WORKING_MID, WORKING_FAR]) {
      const at = place('civOreMine', nominal);
      const id: EntityId = b.spawnBuilding('civOreMine', us, at.x, at.z, { yawDeg: 0 });
      c.tag('working', id);
      if (id !== NONE) b.block(at.x, at.z, WORKING_CLEAR);
    }

    /* -- the shift house ---------------------------------------------------
     * Gaia, so both armies are allied to it and neither has to shoot it to use
     * it. A squad inside holds the deed while it stands there and hands it back
     * the moment the last man leaves — see `src/data/Civilians.ts` — so it is a
     * firing position rather than a possession, which is the right weight for a
     * compensation.
     */
    {
      const at = place('civApartments', SHIFT_HOUSE);
      const id = b.spawnBuilding('civApartments', b.gaia, at.x, at.z, { yawDeg: 90 });
      if (id !== NONE) b.block(at.x, at.z, 12);
    }

    /* -- the Ninth's tap ---------------------------------------------------
     * ON SEAT 1, WHICH IS WHAT MAKES IT PAY THEM. `civilian.system.ts` credits
     * whichever real army holds a paying structure and skips Gaia, so a
     * Gaia-owned derrick here would be worth 900 credits a minute to nobody and
     * the raid would be worth only its 400-credit payout.
     */
    {
      const at = place('civOilDerrick', ALLIED_TAP);
      const id = b.spawnBuilding('civOilDerrick', them, at.x, at.z, { yawDeg: 200 });
      c.tag('alliedTap', id);
      if (id !== NONE) b.block(at.x, at.z, 16);
      /*
       * TWO PILLBOXES, AND THEY ARE STRUCTURES FOR THE REASON EVERY OTHER
       * CAMPAIGN GUARD IS. `AiBrain.regroupSquads` files every untagged hull the
       * seat owns into a squad on its next pass; measured on
       * `02-common-standard`, two parked Wardens were 116-129 m away inside
       * twenty seconds. An emplacement cannot be re-filed. `pillbox` carries no
       * `UNLOCK_TAGS` row, so the empty roster leaves it standing.
       */
      for (const d of [{ x: -18, z: 10 }, { x: 18, z: -2 }]) {
        const gun = place('pillbox', { x: at.x + d.x, z: at.z + d.z });
        const gid = b.spawnBuilding('pillbox', them, gun.x, gun.z, { yawDeg: 0 });
        if (gid !== NONE) b.block(gun.x, gun.z, 8);
      }
    }

    /* -- economy and dressing ---------------------------------------------
     * `addStartOre` lays one home field per opening on the flank AWAY from the
     * lane, plus one contested patch on the midpoint of the two — which for
     * slots 0 and 1 is the map centre (256, 256) exactly. Measured, that patch
     * is 46.65 m from WORKING_MID, 68.35 m from WORKING_FAR and 115.17 m from
     * WORKING_NEAR, so its 22 m rim clears all three by 24 m or more: the ore is
     * out on the same ground the workings are on without being ON one, which is
     * the pull this operation wants and the overlap it does not.
     *
     * The two home fields land at (150.06, 402.17) and (361.94, 109.83).
     * **ONLY THE PLAYER'S IS ON THE LANE OFFSET THE WORKINGS ARE NOT ON, AND AN
     * EARLIER DRAFT CLAIMED BOTH WERE.** Measured against the perpendicular of
     * the opening-to-opening line, with the sign convention `ROAD_EAST` +50.8 /
     * `ROAD_WEST` -78.7 uses: the workings sit at -38.70, -44.09 and -33.64, the
     * player's field at **+44.00** and the Ninth's at **-44.00**. So the
     * player's economy is on the far side of the lane from the seam — 106.19 m
     * from the near working, which is what makes an expansion at home not a
     * defence of it — and the Ninth's is on the SAME side, 116.04 m from the far
     * working. That is not a defect; it is why the far working is the hard one
     * to hold, and it should be read as part of the ladder rather than as
     * symmetry.
     */
    addStartOre(b, spots, b.sea);

    /*
     * NO `addCivilians`, AND THE REASON IS THE WORKINGS.
     *
     * It walks `MINE_BISECTOR_OFFSETS` outward from the lane midpoint for a
     * `civOreMine` and hangs capturable `civOilDerrick`s off the bisector — the
     * same two silhouettes and the same capture verb this operation has spent on
     * the three workings that ARE the objective and the one tap that is the
     * secondary. A player told to hold three mine workings and able to see five
     * mines is a player the layout has lied to. `soviets-company-town` and
     * `allies-sounding-line` skip it for the same reason.
     */

    // The opening frame: the yard with the lane behind it. Biased 13% toward
    // the centre, the same bias `allies-sounding-line` uses, so the first thing
    // on screen is the direction the operation goes.
    b.setCameraFocus(home.x + (cx - home.x) * 0.13, home.z + (cz - home.z) * 0.13);
    b.scatter({ minX: cx - 170, minZ: cz - 170, maxX: cx + 170, maxZ: cz + 170 }, 150);
    void start;
  },
});
