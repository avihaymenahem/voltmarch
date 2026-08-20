/**
 * ============================================================================
 * VOLTMARCH — src/campaign/layouts/soviets-carriage-forward.ts
 * ============================================================================
 * S8 — THE GROUND. One ore body on the perpendicular bisector with a Soviet
 * refinery already standing on its edge, two neutral taps flanking it, and two
 * Continental posts sitting on the haul road between it and the player's yard.
 *
 * Every figure below is read off a headless build with the def tables BOUND
 * (`buildScenario(..., { defs })`) and `setCampaignRoster` INSTALLED, which is
 * the only state in which this operation's allow-list is in force —
 * `soviets-demolition-order`'s header measures all four combinations and finds
 * that neither half alone does anything, because `spawnBuilding` hands
 * `isBuildable` the RESOLVED def and `rosterAllows` answers TRUE for an
 * `undefined` one.
 *
 * ============================================================================
 * WHAT LANDED, AND WHERE
 * ============================================================================
 *     PLANT     refinery       (278, 252)  1200 hp  seat 0   +2000 storage
 *     TAP_EAST  civOilDerrick  (300, 256)   900 hp  Gaia     hitRadius 5.657
 *     TAP_WEST  civOilDerrick  (204, 272)   900 hp  Gaia     hitRadius 5.657
 *     picket    pillbox        (314, 218)   500 hp  seat 1   range 22, power 0
 *     picket    pillbox        (294, 198)   500 hp  seat 1   range 22, power 0
 *     WORKING   the ore body   (252, 264)   r 30    29 738 credits
 *
 *     player yard   (402, 134)        Continental yard  (110, 134)
 *     yard to yard  292.00 m
 *
 *                        from the player's yard   from Continental's
 *     WORKING                    198.49 m               192.52 m
 *     PLANT                      171.17 m               205.30 m
 *     TAP_EAST                   159.02 m               225.80 m
 *     TAP_WEST                   241.35 m               166.97 m
 *     the picket (anchor)        122.80 m               207.63 m
 *
 * **THE WORKING IS 5.97 m OFF EQUIDISTANT AND THE TAPS ARE EXACTLY
 * ANTISYMMETRIC.** `TAP_EAST` sits at (+48, -8) from the working and `TAP_WEST`
 * at (-48, +8), so both are **48.66 m** out on opposite bearings, and each is
 * 159.02 m from one yard and 241.35 m from the other. One tap is a walk and the
 * other is a raid, and which is which depends only on which army you are.
 *
 * ============================================================================
 * THE HAUL ROAD IS ONE CORRIDOR, IT IS MEASURED, AND THE PICKET SITS ON IT
 * ============================================================================
 * The whole operation is a walk, so the walk is the thing that had to be
 * measured rather than eyeballed. Two instruments, and the FIRST ONE WAS THE
 * ONLY ONE THIS HEADER USED UNTIL 2026-08-20, WHICH IS THE DEFECT THIS SECTION
 * IS A REWRITE OF. See the block below.
 *
 * **A. THE 4-CONNECTED CORRIDOR MAP.** Flood-filled from the player's
 * Construction Yard over 4 m cells through the real `Terrain.isPassable` AND
 * `Terrain.isOccupied` — so every structure this file plants is in the grid —
 * for BOTH `Locomotor.Foot` (the shift) and `Locomotor.Track` (everything that
 * escorts it):
 *
 *     MUSTER    104 m of 4 m steps     ROAD_B    212 m
 *     picket    172 m                  ROAD_A    248 m
 *     PLANT     252 m                  WORKING   280 m
 *     TAP_EAST  216 m                  TAP_WEST  328 m
 *
 * Identical for Foot and Track, and **identical to the same fill run with the
 * two post cells forced open** — measured cell by cell, all eight rows above
 * unchanged and the 8-connected walk below unchanged to the centimetre — so
 * nothing this layout places closes the road or lengthens it. That control is
 * the half that matters: `config.ts` already records a 2 m rock sealing a
 * one-cell corridor and parking a hull for 2100 ticks.
 *
 * **B. THE ENGINE'S OWN EXPANDER, WHICH IS THE ONE THAT DECIDES WHERE ANYBODY
 * WALKS.** `Flowfield.ts`'s private `Expander.step` is 8-connected (`NX`/`NZ`,
 * `FIRST_DIAG` 4), charges the DESTINATION cell's weight out of `costGridFor`,
 * multiplies a diagonal by `DIAG` with `| 0`, and REFUSES A CORNER CUT unless
 * both orthogonal neighbours are open. Re-implemented against those exact
 * lines and run over the built world:
 *
 *     MUSTER  -> WORKING   133.82 m of geometry, 27 cells, straight 125.87  (+6.3%)
 *     yard    -> WORKING   207.36 m of geometry, 40 cells, straight 198.49  (+4.5%)
 *
 * **THE TWO INSTRUMENTS DISAGREE BY 42 m ON THE LIFT WALK AND THE 4-CONNECTED
 * ONE IS NOT A TRAVEL DISTANCE.** A Manhattan fill cannot spend a diagonal, so
 * it charges 8 m for a step the engine charges 5.66 m for; it is a fine
 * description of WHICH GROUND is reachable and a 32% overstatement of HOW FAR.
 * This header quoted its 176 m as "the lift walk" and the operation file costed
 * lift C against it. Table A is kept — it is what shows the picket is not a
 * wall — and every travel figure in either file now comes from B.
 *
 * **THE PICKET COVERS THE WALK, AND THE STATEMENT IS AN EXCLUSION CONTROL
 * RATHER THAN A DISTANCE.** The posts are at (314, 218) and (294, 198), 14.14 m
 * either side of `PICKET` and 28.28 m apart, on the two shoulders of the run
 * the corridor makes between the muster and the seam. Two measurements, both
 * over `costGridFor` and both identical for Foot and Track:
 *
 *   - A lexicographic (cost, exposed-metres) expansion — cheapest route first,
 *     least time under a gun as the tie-break — says the BEST any shortest
 *     route can do is **38.63 m inside `pillboxMg`'s 22**, from the muster and
 *     from the yard alike. At an `engineer`'s 3.4 m/s that is **11.4 seconds**.
 *   - Blocking every cell within 22 m of either post (155 cells) and re-running
 *     the same expander: the cheapest gun-free route costs **+45.16 metres of
 *     traversal cost from the muster (+33.8%)** and **+25.96 m from the yard
 *     (+12.6%)**.
 *
 * A non-zero second figure is the whole proof: if any shortest route avoided
 * both discs, removing the discs would leave it available and the cost would
 * not move. So **every shortest route walks under a gun**, and the way round is
 * real, findable and a third longer. The picket does not block the road; it
 * covers it, and refusing it is a decision with a price rather than an
 * impossibility.
 *
 * **THAT IS WHAT AN ENGINEER IS WORTH ON THAT ROAD.** `pillboxMg` is 5 x 13
 * `WarheadClass.SmallArms` on a cycle of `4 x burstDelay 0.06 + cooldown 0.55`
 * = **0.79 s**, and `ARMOR_MATRIX[SmallArms][Infantry]` is **1.00**, so one
 * trigger pull delivers `5 x 13 x 1.00 x COMBAT_DAMAGE.globalMul 0.80` =
 * **52.0** against an `engineer`'s **90 hp**. The first pull leaves him on 38,
 * the second — 0.79 s later — kills him, and there are two posts. Eleven
 * seconds of exposure is fourteen pulls from one of them. Walking the shift
 * past an intact picket is not a risk, it is a schedule.
 *
 * **AND THE POSTS REACH NOTHING ELSE.** Against the same 22 m: the nearer one
 * is **36.88 m** from the closest of lift A's four ring points, so a lift lands
 * outside both guns and can stand on the ramp all day; **40.50 m** from
 * `TAP_EAST` and 116.52 from `TAP_WEST`, so a captured tap is not under the
 * picket; **49.52 m** from the plant; and **77.20 m** from the working, which
 * is **39.20 m** of clearance outside `WORKING_AREA`'s r = 38, so no part of
 * the disc the primary counts in is covered. Every one of those is a margin the
 * placement was chosen for rather than a number it happened to get.
 *
 * ============================================================================
 * THE PLANT IS OURS AND IT IS 171 m FROM ANYTHING THAT DEFENDS IT
 * ============================================================================
 * `refinery` on seat 0, 1200 hp, `ArmorClass.Concrete`, standing 28.64 m from
 * the centre of the working — on the EDGE of the body, which is where a
 * refinery belongs and which keeps the ore from seeding under its footprint.
 *
 * What it costs Continental to level it, through `ARMOR_MATRIX` and
 * `COMBAT_DAMAGE.globalMul` 0.80 against `ArmorClass.Concrete`:
 *
 *     rifle        3 x 18 SmallArms x 0.18 / 1.03 s cycle    7.55 dps a `gi`
 *     lightCannon  55 ArmorPiercing x 0.55 / 1.50 s         16.13 dps a `grizzly`
 *     prismBeam    92 Prism x 0.80 / 2.60 s                 22.65 dps a `prismTank`
 *
 * So the second movement — five `gi` and three `grizzly` — is **86.14 dps and
 * levels an undefended plant in 13.9 seconds**, and the fourth — four `gi`,
 * three `grizzly` and two `prismTank` — is 123.89 dps and does it in 9.7.
 * That is the operation's real clock, and it is why the
 * FIRST movement is authored at the picket rather than here: the plant's first
 * threat is at eight minutes, not four.
 *
 * **IT ALSO GIVES THE PLAYER A SECOND DOCK, WHICH IS THE POINT.** Measured on
 * the built world, seat 0 opens at **+360 net power and 7000 of structural
 * storage** (two refineries and two silos) against seat 1's +230 and 5000 — the
 * whole difference is this one building. A working with a refinery on it is a
 * working; the body under it is **29 738 credits**, the same order as either
 * home field (28 236 ours, 29 562 theirs) and nearly twice the contested lane
 * patch at 15 653. That is the hinge this operation hands forward: by the close
 * the seam is not a survey, it is an output.
 *
 * ============================================================================
 * THE TAPS ARE GAIA, AND THERE ARE TWO VERBS THAT TAKE THEM
 * ============================================================================
 * `Capture.ts` rule 1 flips a NEUTRAL structure at ANY health, so a tap costs
 * one 500-credit engineer and a walk — no soften ladder and nothing like
 * `soviets.07.right-of-entry`'s four men, whose record blocks were on seat 1
 * precisely so that the ladder existed.
 *
 * **AND A SQUAD IS THE SECOND VERB.** `civOilDerrick` is 2x2 and
 * `src/data/Civilians.ts` says in as many words that both axes clear
 * `GARRISON.minFootprint` so that a squad can take one; `GarrisonService.enter`
 * calls `captureBuilding` and `releaseEmptied` hands it back when the last man
 * leaves. So the shown secondary has a cheap reversible route (two squads
 * standing in two derricks) and an expensive permanent one (two engineers, or
 * two of the twelve the yards sent). Both are real and the operation does not
 * pick for the player.
 *
 * `CIVILIAN_INCOME` prices a held derrick at 15 credits a second — **900 a
 * minute**, against a real harvester measured at 429-700 a minute in
 * `tests/harvester-soak.spec.ts` — so a tap is worth roughly two harvesters
 * that cost nothing and need no ore field. Nothing in this operation's
 * objectives reads credits; the taps pay for the defence of the plant, which is
 * the only reason to want them.
 *
 * **NOTHING STATIC SHOOTS A CAPTURED TAP.** The nearer post is 40.50 m from
 * `TAP_EAST` against a 22 m gun, and while a tap is Gaia's nothing shoots it at
 * all — `ScenarioBuilder.gaia` sets both directions of `allyMask` for the
 * Neutral slot and `Targeting.isValidTarget` refuses allies. A tap becomes a
 * target the tick it becomes ours, and what arrives to shoot it is a movement.
 *
 * ============================================================================
 * WHERE THE MOVEMENTS AND THE LIFTS FORM
 * ============================================================================
 * `EffectSink.spawnUnits` lays a DETERMINISTIC RING: unit `i` of `count` at
 * `angle = i / count * 2pi`, radius `spread`, written verbatim by
 * `ProductionService.spawnUnit` with no egress search. Every ring point of
 * every wave and every lift in `08-carriage-forward.ts` was checked against
 * that wave's own move class on the built world and all of them are passable;
 * the clear radius below is the stronger reading — every 2 m sample inside it
 * is passable to Foot AND Track — so the counts may be retuned without
 * re-measuring while the spread stays inside it.
 *
 *     ROAD_A   (218, 196)   clearR 30   124.53 m from their yard,  76.03 m from the working
 *     ROAD_B   (206, 110)   clearR 22    98.95 m from their yard,  54.63 m from the lane patch
 *     MUSTER   (342, 176)   clearR 28    73.24 m from OUR yard,   133.82 m of route to the working
 *
 * The two roads are **86.83 m apart** on opposite bearings out of the
 * Continental gate, so a movement aimed at the lane is a second bearing rather
 * than a second helping of the first. **THE ORDER IS A HEADING, NOT A LEASH** —
 * `AiBrain.regroupSquads` files every untagged hull the seat owns into a squad
 * on its next pass, so the attack-move is the first thing these hulls do and
 * the brain owns them afterwards. What the movements buy is that the
 * establishment is stronger at 4:00, 8:00, 12:00 and 16:00 than it could have
 * built itself, on a timetable the player has been shown.
 *
 * **NO WAVE IS ORDERED AT THE PLANT'S OWN CELL, AND THAT IS DELIBERATE.**
 * `Damage.applySplash` clamps `surface` to zero inside a victim's `hitRadius`,
 * so an order at a tagged structure makes its wall the designed end state of
 * every wave, and every splash shell fired there lands at `falloff` 1.0 — the
 * defect `soviets-right-of-entry` records finding in its own trigger table. The
 * two seam-bound movements are ordered at `WORKING`, **28.64 m** off the plant
 * and **48.66 m** off either tap, against a largest player blast of
 * `flameTower`'s `flameJet` at `splashRadius` 3.2 (the two flame towers stand
 * in the opening base, and nothing bigger reaches land under this roster).
 *
 * ============================================================================
 * NO TRIGONOMETRY IN THE PLACEMENT
 * ============================================================================
 * Every authored point is an integer literal and the search rings are integer
 * offsets. ECMA-262 pins `+ - * /` and `Math.sqrt` and pins neither `sin` nor
 * `cos`; a layout runs independently on both machines of a lockstep match, so a
 * table rotated by trig is a tick-zero desync waiting for two engines to
 * disagree in the last mantissa bit. `rotateStarts` is not called either: an
 * operation pins its seed, so the rotation is a moving part with exactly one
 * value.
 *
 * **THE POINTS ARE AUTHORED WHERE THEY LAND, NOT WHERE THEY WERE AIMED.**
 * `place` returning a point is not the same as a structure standing on it —
 * `spawnBuilding` snaps the result to the footprint grid a SECOND time — and
 * the first draft aimed the plant at (276, 250) and got (278, 252) back. The
 * literals below are the built world's own coordinates, which makes the ring
 * search a CHECK rather than a mechanism: it finds all five at ring zero today
 * and would report if the ground under one ever moved.
 *
 * **AND `place` FALLS THROUGH TO `findClearFootprint`, WHICH ASKS NOTHING
 * ABOUT SLOPE.** Moving the picket onto the corridor found this out loud: an
 * anchor whose posts sat in the middle of the bend exhausted all six rings —
 * the band the road threads through is passable and NOT buildable, which is
 * what makes it a bend — and the fallback planted a pillbox on ground
 * `isBuildable` refuses, silently, exactly as the helper's own comment warns.
 * Both posts are authored on cells the terrain's `isBuildable` accepts, which
 * is why they land at ring zero; a post that starts needing the search is a
 * post standing somewhere nobody measured.
 *
 * `simSeed` **5205** draws the start pair **[1, 3]** for a two-army match — the
 * fourth and last of the four pairs, and the one this chapter had not used
 * (`soviets.05.short-allocation` [0, 1], `.06.demolition-order` [2, 3],
 * `.07.right-of-entry` [0, 2]). `mapSeed` **20261020** was chosen over nine
 * others on a measured sweep, counting 4 m cells through the real
 * `Terrain.isPassable` for Foot AND Track: **73.11%** of the map is passable,
 * **96.83%** of the corridor within 40 m of the segment joining the two start
 * spots is — the best lane figure of the ten, against a band of 86.30% to
 * 96.83% — **96.15%** of the corridor within 30 m of the haul road, and
 * **91.48%** of the disc of radius 60 about the working. **Change either seed
 * and every distance in this file is a different distance.**
 *
 * ============================================================================
 * TAGS
 * ============================================================================
 * `plant`    — the seat 0 refinery on the seam. Read through `ownerCount` so
 *              that a capture counts as a loss exactly as a demolition does —
 *              every threshold in this operation counts what SEAT 0 holds, and
 *              `reclamation.05.closing-entry` is the other operation with that
 *              shape.
 * `taps`     — both derricks, so the shown secondary can count them without
 *              naming either.
 * `tapEast`  — the near tap alone, so a beat can name which one is being shot.
 * `tapWest`  — the far one. Two tags rather than one because the frozen
 *              vocabulary has no "exactly two alive with this tag":
 *              `entityAlive` is at-least-one and `entityDead` is none.
 * `picket`   — the two posts on the haul road, read through `ownerCount` for
 *              the same capture reason as `plant`.
 * `shift`    — every engineer of every lift, produced by `spawnUnits` in the
 *              trigger table and never by this file.
 * `moveA` / `moveB` / `moveC` / `moveD` — the four Continental movements, also
 *              produced by the trigger table, and declared here so a reader
 *              asking where the pressure comes from finds the answer in the
 *              file that owns the ground.
 *
 * **IT READS NO CLOCK, NO PROFILE AND NO DOM.** It runs inside the world build,
 * which is where the tick-zero desync lives: `Scenarios.ts` calls `isBuildable`
 * while spawning, and that answers from the LOCAL profile unless the
 * operation's roster is installed first. `campaign-install.ts` installs it
 * BEFORE the boot.
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
 * somewhere. This module owns them and
 * `operations/soviets/08-carriage-forward.ts` imports them; the dependency runs
 * operation -> layout and never back. A number written in two files is a number
 * that will disagree the first time either is tuned, and the failure — a reveal
 * that frames empty ground, a column that lands somewhere nobody authored — is
 * invisible to every gate.
 * ========================================================================== */

/** The map centre. `startPointsFor` reserves a shelf here first, on a continent. */
const CENTRE = MAP_SIZE * 0.5;

/**
 * The centre of the ore body, and the point both seam-bound movements are
 * ordered at.
 *
 * ONE CONSTANT FOR BOTH, deliberately: the movement IS at the working, and
 * writing it twice is how a wave comes to be aimed four metres off the thing
 * the dialogue names. 198.49 m from our yard, 192.52 m from theirs.
 */
export const WORKING: Point = { x: 252, z: 264 };
/** The refinery the yards pushed out last quarter. 28.64 m from the working. */
export const PLANT: Point = { x: 278, z: 252 };
/** The near tap. 159.02 m from our yard, 225.80 m from theirs. */
export const TAP_EAST: Point = { x: 300, z: 256 };
/** The far tap. The mirror image: 241.35 m and 166.97 m. */
export const TAP_WEST: Point = { x: 204, z: 272 };
/**
 * The anchor of Continental's two road posts, 122.80 m from OUR yard and
 * 207.63 m from theirs, on the run the haul corridor makes between the muster
 * and the seam.
 *
 * See the header: the two posts stand 14.14 m either side of this point, and
 * the claim they carry is an EXCLUSION CONTROL rather than a distance — every
 * shortest Foot route to the working spends at least 38.63 m inside a 22 m gun,
 * and the cheapest route that avoids both costs 33.8% more from the muster.
 * A distance from one reconstructed path proves nothing, because the corridor
 * holds 168 cells of equally short route and the reconstruction picks one.
 */
export const PICKET: Point = { x: 304, z: 208 };

/**
 * The opening reveal, AND the disc the primary counts the shift in.
 *
 * r = 38 covers the plant at 28.64 m and stops **10.66 m** short of either tap
 * at 48.66 m. `revealArea` is `Vision.exploreCircle`, which is PERMANENT, so a
 * disc that already covered them would make the next beat a reveal of ground
 * the player has been looking at since four seconds — the trap
 * `soviets-short-allocation` records for its third wave. One constant for the
 * reveal and the count, because a player who is shown a disc and then counted
 * in a different one has been lied to by geometry.
 */
export const WORKING_AREA: Area = { x: WORKING.x, z: WORKING.z, r: 38 };
/** Each tap on its own, revealed with the orders. */
export const TAP_EAST_AREA: Area = { x: TAP_EAST.x, z: TAP_EAST.z, r: 26 };
export const TAP_WEST_AREA: Area = { x: TAP_WEST.x, z: TAP_WEST.z, r: 26 };
/** The two road posts. r = 22 — `pillboxMg`'s own range — covers both at 14.14 m. */
export const PICKET_AREA: Area = { x: PICKET.x, z: PICKET.z, r: 22 };

/** Their seam road. clearR 30, 124.53 m from their yard, 76.03 m from the working. */
export const ROAD_A: Point = { x: 218, z: 196 };
/** Their lane road, the other bearing. clearR 22, 98.95 m from their yard. */
export const ROAD_B: Point = { x: 206, z: 110 };
/**
 * Where the yards put each lift down. clearR 28, and **133.82 m of route to the
 * working** through the engine's own 8-connected expander — 93.54 m to the
 * near edge of `WORKING_AREA`, which is the boundary the primary actually
 * counts at. The 176 m this line used to carry was the 4-connected fill, which
 * cannot spend a diagonal; see the header.
 */
export const MUSTER: Point = { x: 342, z: 176 };
/**
 * The contested patch `addStartOre` lays on the midpoint of the two openings —
 * 146.01 m from each yard, and the body a player who never leaves home is
 * living on. The third movement is aimed here rather than at the seam.
 */
export const PUSH: Point = { x: 256, z: 132 };

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

/** The two road posts, as offsets from `PICKET`. Both land 14.14 m out, at ring zero. */
const PICKET_POSTS: readonly Point[] = [{ x: 10, z: 10 }, { x: -10, z: -10 }];

export default layout({
  id: 'soviets-carriage-forward',
  tags: [
    'plant', 'taps', 'tapEast', 'tapWest', 'picket',
    'shift', 'moveA', 'moveB', 'moveC', 'moveD',
  ],

  build(b, cx, cz, start, c) {
    /*
     * THE EXPORTED POINTS ARE ABSOLUTE AND THE START SPOTS ARE DERIVED FROM
     * (cx, cz), SO THE TWO HAVE TO AGREE. `buildScenario` passes `startShelf()`,
     * which `startPointsFor` puts at the map centre on every continent. If that
     * ever stops being true this file is dressing ground the trigger table is
     * not naming — and it would be invisible, because every tag would still
     * land and every test would still pass.
     */
    if (Math.abs(cx - CENTRE) > 1 || Math.abs(cz - CENTRE) > 1) {
      console.error(
        `[campaign] soviets-carriage-forward built on (${cx}, ${cz}), not the map centre `
        + `(${CENTRE}, ${CENTRE}) — the working is authored in absolute coordinates and will `
        + 'not line up with the openings this build lays down.',
      );
    }

    const spots = startSpots(cx, cz, b.armies, b.sea, b.seed);

    /*
     * SLOT ORDER, NOT `rotateStarts`. See the header: the seed is a constant
     * for an operation, so the rotation has exactly one value and taking it
     * would make every measured coordinate in this file depend on
     * `startOffset`.
     */
    for (let i = 0; i < spots.length; i++) {
      buildBaseFor(b, c.seat(i), spots[i].x, spots[i].z, {
        facingDeg: wrapDeg(spots[i].facingDeg + 180),
      });
    }

    // `c.seat` is `b.armySlot`, which CREATES a slot rather than returning
    // undefined, so neither of these needs a fallback — and a `?? …` here would
    // be a dead branch that reads as a guard.
    const us: PlayerId = c.seat(0);
    const them: PlayerId = c.seat(1);
    const home = spots[0];

    /* -- placement helper -------------------------------------------------
     * `findClearFootprint` ALONE IS NOT ENOUGH and the build says so out loud.
     * It asks `footprintClear` (is anything already there) and
     * `connectedGround` (can an army reach it) and NOTHING about slope, so
     * `spawnBuilding` will plant a structure on a grade `isBuildable` refuses
     * and report success — the split `footprintBuildable`'s own header draws.
     * `temperate` is `relief` 0.42 / `cliffs` 0.35 — behind `snow`'s 0.50 and
     * level with `atoll`, stated as the tie rather than as a superlative — and
     * the haul road this operation is about threads a bend in exactly that
     * relief. All five structures below are found at ring zero on this roll;
     * the search is the check that says so.
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

    /* -- the plant, ours ---------------------------------------------------
     * ON SEAT 0, WHICH IS WHAT MAKES THE WHOLE OPERATION A PROTECT RATHER THAN
     * AN ASSAULT. It is the thing that has to survive the walk, and
     * `t.plantLost` reads it through
     * `ownerCount(0, 'building', 'plant', max: 0)` so that a capture counts
     * exactly as a demolition does — see the operation file, where the argument
     * for NOT declaring `captureProof` against it is written out with the
     * measurement behind it.
     *
     * `refinery` carries no `unlockedBy`, so this operation's allow-list can
     * neither refuse it nor be blamed if it fails to land, and
     * `tests/campaign-roster-ground.spec.ts` will not report it either way.
     */
    {
      const at = place('refinery', PLANT);
      const id: EntityId = b.spawnBuilding('refinery', us, at.x, at.z, { yawDeg: 200 });
      c.tag('plant', id);
      if (id !== NONE) b.block(at.x, at.z, 16);
    }

    /* -- the two taps, Gaia -------------------------------------------------
     * NEUTRAL, so both armies are allied to them and neither has to shoot one
     * to use it, and so `Capture.ts` rule 1 flips one at any health for a
     * single engineer. See the header for the second verb.
     */
    const nominals: readonly Point[] = [TAP_EAST, TAP_WEST];
    const names: readonly string[] = ['tapEast', 'tapWest'];
    for (let k = 0; k < nominals.length; k++) {
      const at = place('civOilDerrick', nominals[k]);
      const id: EntityId = b.spawnBuilding('civOilDerrick', b.gaia, at.x, at.z, { yawDeg: 20 });
      c.tag('taps', id);
      c.tag(names[k], id);
      if (id !== NONE) b.block(at.x, at.z, 12);
    }

    /* -- Continental's picket on the haul road ------------------------------
     * TWO STRUCTURES AND NOT A GUARD DETAIL, for the reason every other
     * campaign guard is: `AiBrain.regroupSquads` files every untagged hull the
     * seat owns into a squad on its next pass and drives it to the rally point,
     * and an emplacement cannot be re-filed. `tests/campaign-maps.spec.ts`
     * states that rule and `soviets-common-standard` paid for it.
     *
     * `pillbox` carries no `unlockedBy` either — the cheap emplacement row is
     * day-one open, which `UNLOCK_TAGS`'s own comment records for the Soviet
     * twin — so the empty `roster.ai` cannot refuse these and the posts stand
     * whatever the allow-list says. That is deliberate: this operation's
     * asymmetry is what ARRIVES, not what stands.
     *
     * THEY STAND ON THE SHOULDERS OF THE ROAD, NOT ON THE ROAD. The 4-connected
     * route table is identical with these two cells forced open, so they close
     * nothing; what they do is put 38.63 m of every shortest Foot route inside
     * a 22 m gun. Both figures and the exclusion control behind them are in the
     * header.
     */
    for (const off of PICKET_POSTS) {
      const at = place('pillbox', { x: PICKET.x + off.x, z: PICKET.z + off.z });
      const id: EntityId = b.spawnBuilding('pillbox', them, at.x, at.z, { yawDeg: 20 });
      c.tag('picket', id);
      if (id !== NONE) b.block(at.x, at.z, 8);
    }

    /* -- economy ------------------------------------------------------------
     * `addStartOre` lays one home field per opening — ours at (386, 88),
     * 28 236 credits; theirs at (126, 176), 29 562 — plus the contested LANE
     * patch at (256, 132), 15 653, which is the midpoint of the two openings and
     * the point `PUSH` names.
     *
     * The working is a FOURTH field and it is the operation: r = 30 at the
     * preset's own `oreRichness` seeds **29 738 credits**, measured through the
     * real `OreField.seedField` with the accept function `economy.system.ts`
     * uses (`!isWater && isPassable(Track)`).
     *
     * NO `addCivilians`: it hangs its own capturable `civOilDerrick`s off the
     * bisector and walks a `civOreMine` out from the midpoint. The shown
     * secondary counts a TAG, so extra derricks could not corrupt the count —
     * but a player cannot see a tag, and two more derricks in the middle of a
     * map whose whole subject is two derricks is a legibility problem rather
     * than a correctness one. `soviets-company-town`,
     * `soviets-short-allocation` and `allies-sounding-line` skip it for weaker
     * versions of the same reason.
     */
    addStartOre(b, spots, b.sea);
    b.addOre(WORKING.x, WORKING.z, 30);

    // The opening frame: the yard with the haul road behind it. Biased 13%
    // toward the centre, the same bias `allies-sounding-line` uses, so the
    // first thing on screen is the direction the operation goes.
    b.setCameraFocus(home.x + (cx - home.x) * 0.13, home.z + (cz - home.z) * 0.13);
    b.scatter({ minX: cx - 170, minZ: cz - 170, maxX: cx + 170, maxZ: cz + 170 }, 150);
    void start;
  },
});
