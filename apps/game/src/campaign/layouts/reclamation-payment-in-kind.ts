/**
 * ============================================================================
 * VOLTMARCH — src/campaign/layouts/reclamation-payment-in-kind.ts
 * ============================================================================
 * R7 — THE GROUND. Survey 52-130, a Continental Works marshalling yard on the
 * valley floor: a weighbridge on the approach road, three transfer gantries on
 * a siding forward of the yard, a receiving office beside the weighbridge, and
 * the Works' own establishment at the far corner.
 *
 * The three gantries are the eleven months of delivery notes made of steel.
 * They were rebuilt in Reclamation shops and delivered here between the March
 * and the autumn, they were signed for on that weighbridge, and they have never
 * been paid for. `reclamation.07.payment-in-kind` comes to take them.
 *
 * ============================================================================
 * EVERY EXPORTED POINT IS ARITHMETIC, AND THE ONE MEASUREMENT THAT MAKES THAT
 * SAFE IS AT THE TOP OF `build`
 * ============================================================================
 * `reclamation-served-notice` and `reclamation-closing-entry` are the
 * precedents and they carry the argument: `SIM_SEED` lives HERE,
 * `07-payment-in-kind.ts` imports it into `map.simSeed` rather than restating
 * it, and every point below is computed from it at module load out of
 * `seatedSlots`, `SKIRMISH_START_OFFSETS` and `MAP_SIZE`. A number written in
 * two files is a number that will disagree the first time either is tuned, and
 * the failure — a reading disc framing open country, a working forming up where
 * nobody authored one — is invisible to every gate.
 *
 * **THE RAW CORNER AND THE BUILT CORNER ARE NOT THE SAME QUANTITY, AND IT IS
 * MEASURED RATHER THAN ASSUMED.** `startSpots` runs `nudgeToBuildable` over the
 * authored offsets, so what the layout is handed can differ from
 * `CENTRE + SKIRMISH_START_OFFSETS[slot]` — and every point in this file is
 * derived from the RAW corner. Measured INSIDE the build, before a single
 * footprint is marked, at this operation's seeds:
 *
 *     startSpots  (108.00, 380.00)      (404.00, 132.00)
 *     raw slots   (108, 380)            (404, 132)
 *
 * — identical, to two decimals, on both corners. `build` re-checks it every
 * time and `console.error`s if it ever stops being true, because the
 * alternative is a silent offset between the composition and the ground. Taken
 * INSIDE the build for `reclamation-sold-twice`'s reason: `nudgeToBuildable`
 * scores `terrain.isBuildable`, which is FALSE on a cell a structure already
 * occupies, so calling `startSpots` after the world is built reports openings
 * that were never used.
 *
 * `seatedSlots(2, 22461, null)` draws **[0, 1]**, the diagonal pair, so the two
 * openings are `hypot(296, 248)` = **386.16 m** apart rather than an edge pair's
 * 296.00 — which is what leaves room for a weighbridge, a siding and a yard
 * between them. Every point below is `lane(along, off)`: a fraction of that line
 * from the player's corner, plus metres along its left-hand perpendicular.
 *
 * ============================================================================
 * THE SEEDS WERE SWEPT FOR GROUND, NOT CHOSEN FOR THE FICTION
 * ============================================================================
 * `temperate` carries `relief` 0.42 and `cliffs` 0.35 against `urban`'s 0.14 and
 * 0.10, and the chapter has been paying for that difference all along:
 * `reclamation.04.served-notice` swept 300 snow rolls and 266 of them put at
 * least one scripted drop on ground its own locomotor cannot enter, and
 * `reclamation.03.sold-twice` lost 188 of 200 desert rolls the same way. So this
 * file swept the MAP SEED against the ten stations the composition needs before
 * a word of the operation was written, at the fixed `simSeed` 22 461.
 *
 * Eight rolls, each scored on a 3x3 `isBuildable` block plus Foot and Track
 * passability at every station, and on Wheel passability sampled every 0.005 of
 * the lane between the party's forming-up ground and the Works' own:
 *
 *     seed     stations failing   lane samples blocked (of 147)
 *     11 206         2                      17
 *     21 704         5                      25
 *     33 419         4                      31
 *     47 852         3                      22
 *     52 130         0                       0
 *      9 640         2                      21
 *     63 118         2                      17
 *     28 905         2                      12
 *
 * **52 130 IS THE ONLY CLEAN ROLL IN THE EIGHT ON EITHER COLUMN** — every
 * station buildable and standable, and an unbroken corridor for a wheeled hull
 * from one end of the approach to the other. The survey number in the briefing
 * is that seed; the fiction was fitted to the ground rather than the other way
 * round, which is the only order that does not end in a re-sweep.
 *
 * `urban` was the obvious choice — it is the flattest preset in the roster and
 * `reclamation.05.closing-entry` argues for it at length — and was refused for a
 * reason that is not about ground: R5 and `reclamation.06.in-duplicate` are both
 * on it, and a chapter whose last three operations share a preset has stopped
 * using the map as content. `temperate` is `reclamation.02.written-off`'s ground
 * and that is the rhyme: R2 is the Soviet field written off in week two, and
 * this is the Works being handed a bill on the same kind of country.
 *
 * ============================================================================
 * THE THREE GANTRIES ARE ONE DEF, THREE TIMES, AND THAT IS THE POINT
 * ============================================================================
 * `civOreMine` — 700 hp, `ArmorClass.Concrete`, a 2x2 footprint, `power: 0`,
 * `Faction.Neutral` in the def table and therefore carrying no `unlockedBy`, so
 * no roster can refuse one and `keyFor` does not remap it (it is not in
 * `FACTION_KEY_MAP`). Owned by SEAT 1.
 *
 * Three identical structures rather than three different ones, because the
 * entry that names them is one line repeated three times: the same machine,
 * rebuilt and delivered three times, at the same price. `allies.06.machine-time`
 * uses the same def for a plant's load meter and `allies.09.made-good` for a
 * bore head, so the silhouette is a headframe and a gantry is what it reads as.
 *
 * **THEY PAY WHOEVER HOLDS THEM 300 CREDITS A MINUTE EACH, AND THIS BLOCK USED
 * TO SAY THE OPPOSITE.** It read *"THEY GIVE THE WORKS NOTHING. No weapon, no
 * power, no `producesTab`, no role `AiBrain.census` counts"* — every clause of
 * which is true and which adds up to a false conclusion, because `civOreMine` is
 * `CIVILIAN_MINE_INCOME` in `src/data/Civilians.ts`: **5 credits every 30 ticks**,
 * paid by `payHolders` in `src/sim/civilian.system.ts` to ANY owner whose faction
 * is not `Faction.Neutral`. That module is a `*.system.ts` under `src/sim/`, so
 * `Systems.ts` registers it in a campaign boot exactly as in a skirmish.
 *
 * Measured by building this operation headless with the def tables bound and its
 * own roster installed — the `tests/campaign-roster-ground.spec.ts` harness — and
 * then restating `payHolders`' own predicate over the store: mine `defId` 57,
 * **3 alive, all owner 1**, 0 derricks. That is **15 cr/s = 900 cr/min**, or
 * **17 100 credits over `parSec` 1140** — nineteen Anvil Tanks at 900 each — on
 * top of the 2 000 opening bank and the two harvesters `buildBaseFor` seats.
 *
 * **THAT IS BETTER CONTENT THAN THE CLAIM IT REPLACES, WHICH IS WHY THE DEF DID
 * NOT CHANGE.** The alternative was to swap in `civApartments`/`civHospital`,
 * which are the same silhouette family and are in no `CIVILIAN_INCOME_SOURCES`
 * row — inert goods, and a slower clock costs the player nothing. Paid goods make
 * the operation's central decision economic as well as tactical: **every minute
 * the entry stands unpaid funds the workings that stop you collecting it**, and
 * the primary is satisfied by BREAKING a gantry, so the impatient answer is also
 * the one that shuts the tap. It cuts the other way too — a captured gantry pays
 * SEAT 0 at the same 5 cr/s against a `capFloor` of `STORAGE_BASE` 10 000, which
 * is where the repair wrench's money comes from on a seat with no refinery.
 *
 * **AND THEY ARE OWNED BY THE WORKS RATHER THAN BY GAIA, WHICH IS THE WHOLE
 * CAPTURE ARITHMETIC.** `Capture.resolve` takes a NEUTRAL structure outright at
 * any health with one engineer and no gate; an ENEMY structure is captured only
 * at or below `CAPTURE.captureHpFrac` 0.50, and each engineer spent above it
 * lands `maxHp * CAPTURE.softenFrac` 0.25 through
 * `ARMOR_MATRIX[HighExplosive][Concrete]` 1.00 and `COMBAT_DAMAGE.globalMul`
 * 0.80 = 0.20 of max. On Gaia these would be one right-click each and the
 * operation would have no decision in it at all.
 *
 * ============================================================================
 * THE RECEIVING OFFICE, AND WHY IT STANDS BESIDE THE WEIGHBRIDGE
 * ============================================================================
 * `civApartments` — 800 hp, Concrete, 2x3 — owned by SEAT 1, the same def
 * `reclamation.04.served-notice` puts the district's record blocks in and
 * `reclamation.05.closing-entry` uses for the counting house. R4 sent a crew to
 * DESTROY that building. This operation's second primary is to leave it
 * standing, and the reversal is the chapter's hinge stated as a verb.
 *
 * It stands on the weighbridge ROAD rather than out at the siding because that
 * is where counterfoils actually live: a delivery is signed for at receiving,
 * and receiving is the compound on the road. The pair of them is also why the
 * notice is served THERE — a notice read out on an empty road is not served on
 * anybody.
 *
 * **"BESIDE" IS THE FICTION AND 86.02 m IS THE GROUND, AND THE BLOCK BELOW IS
 * WHY.** It is the same compound at the same end of the same road; what the
 * safety derivation buys is bought entirely in metres, and this heading is the
 * one thing in the file the geometry cost. It is not near enough to read as a
 * yard gatehouse and it is not far enough to read as somewhere else.
 *
 * ============================================================================
 * WHAT THE RESTRAINT COSTS, RE-DERIVED AGAINST THE STANDS RATHER THAN THE LINE,
 * AND THEN AGAINST THE ARMY RATHER THAN THE PARTY
 * ============================================================================
 * **THE FIRST VERSION OF THIS BLOCK MEASURED A PATH AND MADE A CLAIM ABOUT A
 * SET OF STANDS, WHICH IS TRAP 18 EXACTLY.** It measured 38.97 m to the straight
 * line the party marches in on and 43.60 m to a Grinder's standoff at the
 * weighbridge post, concluded *"nothing in the party can mark it by accident
 * from anywhere it has a reason to stand"*, and never measured the one stand the
 * operation ORDERS the player to occupy — the reading disc, held for forty
 * seconds. The standoff figure reproduces exactly; the march-line figure is
 * 39.89 under the definition given with the table below, not 38.97. Either way
 * the conclusion did not survive.
 *
 * **AND THE SECOND VERSION MEASURED THE RIGHT SET OF STANDS AGAINST THE WRONG
 * HULL, WHICH IS TRAP 28.** An envelope is `reach + the TARGET's hitRadius`, so
 * it is per-hull, and the hull it must be quoted against is the
 * longest-reaching one that CAN be in play rather than the longest-reaching one
 * currently staged. It derived `lane(0.40, -86)` from `grinderArc` at 18 m, the
 * best gun in the eighteen hulls section 6 lays down, while
 * `tests/campaign-zone-safety.spec.ts` holds the geometry to `rclSlaghurler` at
 * 42 m, the best gun in the Reclamation. Every cell count it published is
 * correct about the party and 0 of them were the number the rule reads.
 *
 * **THE THREE ENVELOPES, PER HULL.** `Combat.engage`
 * gates firing on `max(0, flat - hitRadius(target))`, and the office's own is
 * the half-diagonal of an 8 x 12 m footprint = `hypot(4, 6)` = **7.211 m**. So
 * an envelope is `reach + 7.211` of CENTRE distance, and `reach` is PER-HULL:
 *
 *     FIRE      range                                      + 7.211 of centre
 *     CHASE     `holdPost`: chase 18 + range x 0.80        centre to centre
 *                 (`holdPost` subtracts no hit radius)
 *     ACQUIRE   `reachOf`: range x APPROACH_STOP_FRAC 0.80
 *                 + STANCE_CHASE_METRES[Aggressive] 18, of SURFACE
 *                                                          + 7.211 of centre
 *
 *     hull             range   FIRE     CHASE    ACQUIRE   -> d >= 20 + ACQUIRE
 *     rclGrinder          18   25.211   32.400    39.611          59.611
 *     rclHulk             38   45.211   48.400    55.611          75.611
 *     rclSlaghurler       42   49.211   51.600    58.811          78.811
 *
 * **THE ROW THAT BINDS IS THE LAST ONE, AND THE FIRST ONE IS WHAT THIS FILE USED
 * TO DERIVE FROM.** `grinderArc` at 18 m is the longest reach in the PARTY —
 * `opening` is `'force'`, seat 0 has no yard and no queue, so the eighteen hulls
 * section 6 stages are the only hulls the player will ever own on this map, and
 * an argument that stops there is an argument about today's composition.
 * `rclHulk` at 38 m is the longest reach this operation's ROSTER admits: the
 * list is `player: ['unit.raider']`, and `rclHulk` carries no `UNLOCK_TAGS` id
 * at all, so no allow-list can refuse it. `rclSlaghurler` at 42 m is the longest
 * reach in the ARMY; it is `unit.specialist`, which this roster does not list,
 * so the roster does refuse it — and `tests/campaign-zone-safety.spec.ts`
 * measures the ARMY figure anyway, deliberately and by its own header, because
 * a roster is an allow-list over TAGGED defs and a roster-aware bar is narrower
 * than the truth. That is the bar this geometry is held to: a one-line edit to
 * `roster.player` is a content change, and the office's safety must not quietly
 * depend on one.
 *
 * `ScenarioBuilder.spawnUnit` writes `options.stance ?? Stance.Aggressive` and
 * `b.formation` passes no stance, so all fourteen guns in the party are
 * Aggressive — and `reachOf` returns non-zero for an Idle or Guarding drivable
 * hull, which is what a hull escorting a clerk through a forty-second hold is.
 * A hull that ACQUIRES will then CHASE, and `approach()` drives it to firing
 * range, so acquisition and not range is the bound the geometry has to clear.
 *
 * Measured on the built world, `SCALE_AREA` = {208.92, 271.96, r 20},
 * standability from the real `FlowFieldCache.hardGridFor(MoveClass.Wheel)`
 * (identical for `Foot`), cell CENTRES throughout, all three columns taken with
 * ONE instrument in one run so they are comparable:
 *
 *                                              at -58    at -86   at -103
 *     office lands at                        188, 238  172, 214  160, 202
 *     office to SCALE_AREA's centre            39.89 m   68.72 m   85.37 m
 *     nearest point of the disc                19.89     48.72     65.37
 *     nearest standable cell in the disc       21.26     50.00     66.84
 *     standable cells of 74 inside FIRE
 *       (Grinder / Hulk / Slaghurler)         5/45/54    0/0/0     0/0/0
 *     ...inside CHASE                        17/52/60    0/0/2     0/0/0
 *     ...inside ACQUIRE                      33/69/73   0/9/14     0/0/0
 *     office to the party's march line         39.89     68.72     85.37
 *     office to the Works' own march line      39.24     67.78     84.73
 *     office to the nearest gantry            114.14    128.02    140.36
 *     office to the post the player must clear 60.83     89.38    106.30
 *       ...less a Grinder's standoff there     43.60     72.15     89.07
 *         (17.23)
 *     office to the weigh house                40.50     69.34     86.02
 *
 * **TWO PUBLISHED FIGURES DID NOT REPRODUCE AND ARE CORRECTED ABOVE RATHER THAN
 * CARRIED FORWARD.** "nearest point of any standable cell" read 47.20 at -86
 * against 50.00 here, while the -58 entry (21.26) reproduces exactly — the two
 * columns of one row had been taken with two conventions, cell CORNER and cell
 * CENTRE, which is a 2.83 m difference and the whole reason this row is now
 * labelled with its convention. And "office to the party's march line" read
 * 38.97 at -58 against 39.89 for the segment INSERT -> SCALE with its endpoints
 * clamped; the Works' row (39.24) reproduces to the digit under the twin
 * definition, so the disagreement is in the line, not the instrument.
 *
 * **THE -86 COLUMN IS WHY THIS FILE MOVED TWICE.** Against the party it is
 * clean — 0 cells in any envelope, which is what the previous version measured
 * and reported truthfully. Against the bar the gate actually holds, 14 of the
 * 74 standable cells acquire the office and 2 chase it. A clerk held on the
 * apron for forty seconds with a Slaghurler beside him loses the second primary
 * to a hull nobody ordered to do anything.
 *
 * — at -103, against `rclSlaghurler`'s 58.811 m of centre reach: **6.56 m of
 * margin at the disc's nearest point** (which is the same number the gate
 * compares, since both sides subtract the same radius) and **8.03 m at the
 * nearest cell a hull can physically stand on**, the gap between the two being
 * the 1.47 m of disc edge no hull can occupy.
 * **What CAN reach it is a right-click, and what can TAKE it is
 * an engineer**, which is why `OperationDef.captureProof` names `office` and why
 * the operation spends its one `cameraMove` on the first mark rather than on a
 * warning nobody could act on.
 *
 * **DO NOT REST THIS ON THE WEIGH HOUSE.** Mirroring `Targeting.acquire`'s
 * scoring over seat 1, the weigh house outscored the office from every cell of
 * the disc even at -58 (`civHospital` is 8-12 m away against the office's 21-26,
 * and `distanceSoftness` dominates) — so the shipped -58 geometry was defended
 * by a 1 100 hp structure the operation explicitly invites the player to level,
 * tagged `scale` and named by no trigger. A shield the design tells you to
 * destroy is not a shield.
 *
 * ============================================================================
 * THE WEIGHBRIDGE
 * ============================================================================
 * `civHospital` — 1100 hp, Concrete, 3x2 — owned by seat 1, tagged `scale`, and
 * named by NO trigger. It is there so the reading disc has something in it that
 * a player can see from the fog line, and it is a THIRD silhouette on purpose:
 * the operation asks the player to tell an office they must leave standing from
 * a weigh house they may do as they like with, and two `civApartments` on one
 * map would have made that a guessing game.
 *
 * The disc the operation actually reads is `SCALE_AREA`, radius 20 m, which is
 * the apron rather than the building — a clerk has to stand ON the weighbridge,
 * not inside the office beside it. The weigh house lands at (210, 272), i.e.
 * **1.08 m from that centre**, so the disc is an annulus around it: of the 80
 * cells whose centres fall inside the radius, exactly the weigh house's own six
 * are closed and **74 are standable**, for `Foot` and `Wheel` alike.
 *
 * ============================================================================
 * WHERE THE WORKINGS FORM UP
 * ============================================================================
 * `ROAD` = `lane(0.82, -24)` -> (335.3, 158.2): **73.53 m out of the Works'
 * gate**, comfortably past `BUILD_RADIUS` 56, 58.83 m short of the far gantry
 * and 169.99 m short of the weighbridge.
 *
 * **`EffectSink.spawnUnits` DOES NOT SEARCH FOR STANDABLE GROUND**, and it lays
 * a wave on an exact RING of radius `spread` rather than scattering inside one:
 * unit `i` of `count` lands at `angle = i / count * 2pi` and
 * `ProductionService.spawnUnit` writes the point VERBATIM — no
 * `connectedGround`, no egress search. So every drop of every wave is checked
 * against `ITerrain.isPassable` for that wave's own move class on the built
 * world. Four distinct rings, thirteen drops; the measurements are in the
 * operation's header and `tests/campaign-spawn-ground.spec.ts` is the standing
 * gate. **A change to any `count` or `spread` invalidates the check**, because
 * a wave of three does not stand where a wave of four does.
 *
 * ============================================================================
 * NO `addStartOre`, AND NO ORE FOR THE PLAYER AT ALL
 * ============================================================================
 * `addStartOre` lays its contested patch on the CENTROID of the openings, which
 * for two armies is the map centre — and on this pair the map centre is
 * `lane(0.50, 0)` EXACTLY, i.e. the middle of the approach road the party walks
 * up. A radius-22 field there would put Works harvesters on the player's line of
 * march and nothing else. The Works' two fields are laid by hand instead, on
 * their own corner's bearing, exactly as `reclamation-served-notice` does.
 *
 * The player gets none, and that is not an omission: `opening` is `'force'`,
 * there is no refinery and no harvester on seat 0, and ore nobody can lift is a
 * decoration that reads as a missed opportunity.
 *
 * ============================================================================
 * NO TRIGONOMETRY, NO `rotateStarts`
 * ============================================================================
 * Every offset here is an authored number and the one bearing that is not — the
 * lane's unit vector — is a difference over a `Math.sqrt`. ECMA-262 pins
 * `+ - * /` and `Math.sqrt` and pins neither `sin` nor `cos`; a layout runs
 * independently on both machines of a lockstep match, so a table rotated by an
 * angle is a tick-zero desync waiting for two engines to disagree in the last
 * mantissa bit. `Math.atan2` appears once, in `yawTo`, and its result is the
 * rotation of a model that nothing reads back.
 *
 * `rotateStarts` is not called, for `reclamation-held-paper`'s reason: an
 * operation pins its seed, so the rotation is a moving part with exactly one
 * value. Seat `i` takes slot `i`.
 *
 * ============================================================================
 * TAGS
 * ============================================================================
 * `levy`   — the three transfer gantries, on SEAT 1. Read as
 *   `ownerCount(1, 'building', 'levy', max: N)` for the primary and
 *   `ownerCount(0, ...)` for the secondary, and NEVER as `entityDead`: a
 *   captured structure is still alive, and taking these is half the operation.
 * `office` — the receiving office, on SEAT 1. The one `entityDead` in the trigger
 *   table, and correct there BECAUSE capture keeps it alive — which is exactly
 *   the state `OperationDef.captureProof` exists to keep it out of.
 * `scale`  — the weigh house, on SEAT 1. Named by no trigger; declared so that
 *   `campaign-maps.spec.ts` verifies it actually landed, which is the only
 *   automatic check the reading disc has.
 * `post`   — the three emplacements. Named by no trigger, declared for the same
 *   reason.
 * `clerk`  — the party's four Tinkers, on SEAT 0. Read as
 *   `unitsInArea(0, SCALE_AREA, min: 1, tag: 'clerk')`. A PLAYER-owned tagged
 *   hull is exempt from `campaign-maps.spec.ts`'s building rule and must stay
 *   exempt: nothing re-tasks it, unlike an AI-owned one, which
 *   `AiBrain.regroupSquads` files into a squad on the first brain pass.
 * `column` — produced by `spawnUnits` in the trigger table, never by this file,
 *   and declared anyway so a reader asking where the pressure comes from finds
 *   the answer in the file that owns the ground.
 *
 * **IT READS NO CLOCK, NO PROFILE AND NO DOM.** It runs inside the world build,
 * which is where the tick-zero desync lives: `Scenarios.ts` calls `isBuildable`
 * while spawning, and that answers from the LOCAL profile unless the operation's
 * roster is installed first. `campaign-install.ts` installs it BEFORE the boot,
 * so this gets the same world on every machine by construction.
 * ========================================================================== */

import { MAP_SIZE } from '../../core/config';
import { NONE, Stance } from '../../core/types';
import {
  SKIRMISH_START_OFFSETS, buildBaseFor, seatedSlots, startSpots, wrapDeg,
} from '../../game/Scenarios';
import type { EntityId, PlayerId } from '../../core/types';
import type { Area, Point } from '../types';
import { layout } from '../layout';

/* ==========================================================================
 * 1. THE SEED, AND EVERYTHING ARITHMETIC THAT FALLS OUT OF IT
 * ========================================================================== */

/**
 * `?seed=` — the scenario layout roll, and the ONE input every exported point
 * below is computed from. `07-payment-in-kind.ts` imports it into `map.simSeed`
 * rather than restating it.
 *
 * Chosen for the LAYOUT it draws rather than for the number: with two armies
 * and no sea, `seatedSlots` picks one of four pairs off `startPairFor(seed)`,
 * and 22 461 draws **[0, 1]** — the diagonal, 386.16 m of lane instead of an
 * edge pair's 296.00. The whole composition is three stations strung along that
 * line, and 296 m does not hold them at legible spacing.
 */
export const SIM_SEED = 22_461;

/** The map centre. Every authored slot is an offset from it. */
const CENTRE = MAP_SIZE * 0.5;

/** An authored slot as a world point. `?? { dx: 0, dz: 0 }` is unreachable. */
function slotPoint(slot: number): Point {
  const o = SKIRMISH_START_OFFSETS[slot] ?? { dx: 0, dz: 0 };
  return { x: CENTRE + o.dx, z: CENTRE + o.dz };
}

const SLOTS = seatedSlots(2, SIM_SEED, null);
/** The party's corner. (108, 380) on the shipped pair. */
const HOME = slotPoint(SLOTS[0] ?? 0);
/** The Works establishment. (404, 132), 386.16 m up the lane. */
const FOE = slotPoint(SLOTS[1] ?? 1);

/** Unit vector down the lane, and its left-hand perpendicular. */
const LANE = (() => {
  const dx = FOE.x - HOME.x;
  const dz = FOE.z - HOME.z;
  const len = Math.max(1e-3, Math.sqrt(dx * dx + dz * dz));
  const nx = dx / len;
  const nz = dz / len;
  return { nx, nz, px: -nz, pz: nx, len };
})();

/** A point on the lane: `along` is a fraction of it, `off` is metres across. */
function lane(along: number, off: number): Point {
  return {
    x: HOME.x + LANE.nx * LANE.len * along + LANE.px * off,
    z: HOME.z + LANE.nz * LANE.len * along + LANE.pz * off,
  };
}

/**
 * Where the distraint party forms up. (134.6, 357.7), 34.7 m off the player's
 * own reserved shelf, so it stands on ground the generator levelled.
 */
export const INSERT: Point = lane(0.09, 0);

/**
 * The weighbridge apron. Authored at (208.9, 272.0) and landing at (210, 272) —
 * 114.11 m from the party and 90.80 m short of the near gantry on the built
 * world, so serving the notice is a station ON the way in rather than a detour
 * off it.
 */
export const SCALE: Point = lane(0.38, -18);

/**
 * The reading disc.
 *
 * TWENTY METRES, WHICH IS THE APRON AND NOT THE BUILDING. A clerk stands on the
 * weighbridge; the weigh house lands 1.08 m from this centre with a 12 x 8 m
 * footprint, so the disc is an annulus around it plus a little of the road —
 * **74 standable cells of the 80 whose centres fall inside**, measured on the
 * built world. (This said the weigh house was 12.5 m off centre, which was never
 * true: `place(them, 'civHospital', SCALE)` puts it on the disc's own point.)
 */
export const SCALE_AREA: Area = { x: SCALE.x, z: SCALE.z, r: 20 };

/** Number One gantry, nearest the road. (299.0, 259.2). */
export const GANTRY_ONE: Point = lane(0.58, 30);
/** Number Two, the middle of the siding. (299.5, 211.7). */
export const GANTRY_TWO: Point = lane(0.66, -6);
/** Number Three, deepest and 103.71 m from the Works' own gate. (343.7, 216.4). */
export const GANTRY_THREE: Point = lane(0.74, 26);

/**
 * The siding as a disc, for the briefing's `revealArea`.
 *
 * Centred on `lane(0.66, 10)` rather than on any one gantry, and 42 m, because
 * the three land 37.31 / 15.47 / 35.14 m from that point on the built world — so
 * one reveal frames the whole line and nothing else. `revealArea` EXPLORES
 * ground rather than showing live units, so this is the map being drawn and not
 * an intelligence report.
 */
export const SIDING_AREA: Area = (() => {
  const c = lane(0.66, 10);
  return { x: c.x, z: c.z, r: 42 };
})();

/**
 * The receiving office, on the weighbridge road and well back off it.
 *
 * **THIS HAS MOVED TWICE AND THE SECOND MOVE IS THE INSTRUCTIVE ONE.** At -58
 * it landed at (188, 238), 39.89 m from `SCALE_AREA`'s centre against that
 * disc's radius of 20 — so the nearest point of the apron the `served`
 * objective ORDERS the player to hold was **19.89 m** from the office, inside a
 * Grinder's own firing envelope of 25.211 m, with 5 of the disc's 74 standable
 * cells able to open fire without moving and 33 inside `reachOf`.
 *
 * -86 fixed that against the PARTY and left it broken against the ARMY.
 * `tests/campaign-zone-safety.spec.ts` computes the bar from the longest reach
 * in the player's whole faction — `rclSlaghurler`, 42 m — and at -86 the office
 * sat 68.72 m out against a required 78.811, with **14 of the 74 standable
 * cells inside a Slaghurler's acquisition radius and 2 inside its chase cap**.
 * The derivation the -86 move rested on quoted `grinderArc` at 18 m, which is
 * the longest reach in the party the layout stages and NOT the hull the rule is
 * about. See the header's exposure block for the three envelopes side by side
 * and for why the bar is the army's and not the roster's.
 *
 * **THE OFFSET IS DERIVED, AND THE DERIVATION HAS THREE STEPS BECAUSE THE FIRST
 * TWO ARE NOT SUFFICIENT.**
 *
 *   1. **The requirement.** `reachOf` for `rclSlaghurler` is
 *      `range 42 x APPROACH_STOP_FRAC 0.80 + GUARD_LEASH 18` = 51.6 m of
 *      SURFACE, which against the office's own `hitRadius(2, 3)` = 7.211 is
 *      **58.811 m of centre distance**. The disc's nearest point is
 *      `d - SCALE_AREA.r`, so the requirement is **`d >= 78.811`**.
 *   2. **The authored offset that satisfies it.** `OFFICE` is `lane(0.40, off)`
 *      and `SCALE` is `lane(0.38, -18)`, so the along-lane separation is fixed
 *      at `0.02 x LANE.len` = **7.723 m** and the authored distance is
 *      `hypot(7.723, off + 18)`. Solving gives
 *      `|off + 18| >= sqrt(78.811^2 - 7.723^2)` = **78.432**, i.e.
 *      `off <= -96.43`; and `spawnBuilding` quantises x to a multiple of 4 and
 *      z to `4k + 2` for a 2 x 3 footprint, so a snap of up to `hypot(2, 2)` =
 *      2.828 m can point AT the disc: `off <= -99.26`.
 *   3. **AND THAT IS STILL NOT ENOUGH, WHICH IS THE WHOLE REASON THIS IS
 *      MEASURED.** `place()` ring-searches when the authored footprint is
 *      refused, nearest ring first and `[1, 0]`/`[0, 1]` before `[-1, 0]`, and
 *      the disc lies on `+x, +z` from here, so a refused point lands the office
 *      BACK TOWARDS THE ROAD. Swept at EVERY integer offset from -86 to -120 on
 *      the built world, the landing sites are a short discrete list — twelve
 *      cells for thirty-five offsets:
 *
 *          -86..-87  (172,214)  68.72     -101..-105 (160,202)  85.37
 *          -88..-89  (168,214)  70.95     -106       (160,198)  88.68
 *          -90..-94  (168,210)  74.26     -107..-110 (156,198)  90.95
 *          -95..-97  (172,206)  75.59     -111..-112 (156,194)  94.23
 *          -98..-100 (164,210)  76.53     -113..-115 (152,194)  96.53
 *                                         -116..-118 (152,190)  99.79
 *                                         -119..-120 (148,190) 102.12
 *
 *      -98 and -100 are AUTHORED at 80.37 m and 82.36 m — both over the bar —
 *      and both LAND at (164, 210), **76.53 m, short of it**. -95..-97 are the
 *      same failure one step earlier: authored at 77.39-79.38, they land at
 *      75.59 on **6.90 to 7.91 m** of ring search. Step 2's arithmetic is right
 *      about the authored point and says nothing about the built one, which is
 *      the whole reason this is measured rather than solved. There is no landing
 *      site between 76.53 and 85.37, so the nearest legal one is
 *      **(160, 202) at 85.37 m** and the offsets that reach it are -101 … -105.
 *
 * **-103 RATHER THAN -104, AND THE TIE-BREAK IS NOT COSMETIC.** All five land
 * on the same cell, so all five build the identical world; what differs is how
 * far the authored point sits from the quantisation boundary. Snaps across the
 * band are 2.07 / 1.08 / **0.29** / 1.00 / 1.98 m, so -103's authored
 * (160.25, 201.85) has 1.75 m of x-room and 1.85 m of z-room before the snap
 * would pick a neighbouring cell — the most interior point in the band, and the
 * one at which every authored-arithmetic figure in this file is also true of the
 * built ground to within a third of a metre. -104 is what a sweep for the first
 * offset that goes green returns; it is 1.00 m off its own landing.
 *
 * **AND NO FURTHER OUT THAN THAT.** (156, 198) at 90.95 m would buy 5.58 m more
 * margin and cost 5.58 m more of the single relationship this building exists
 * for. The restraint is CONTENT — the second primary is "do not break the thing
 * standing beside your road" — and every metre it retreats makes not breaking it
 * less of a decision. Nearest legal site, and stop.
 *
 * **6.56 m OF MARGIN IS ENOUGH BECAUSE THE MARGIN IS NOT THE MECHANISM.**
 * `campaign-zone-safety.spec.ts` recomputes the bar from `UNITS`, `WEAPONS`,
 * `GUARD_LEASH` and `hitRadius` on every run, so the three things that could eat
 * it — 8.2 m of extra `slagLob` range, 6.56 m of `GUARD_LEASH`, 6.56 m of
 * `SCALE_AREA.r` — each fail that spec by name rather than shipping.
 *
 * Authored at (160.25, 201.85) and landing at (160, 202): **85.37 m** from
 * `SCALE_AREA`'s centre — the disc's nearest point is 65.37 m from the office
 * and the nearest STANDABLE cell 66.84 m, so the margins are 6.56 m and 8.03 m,
 * and **0 of the 74 standable cells are inside the firing, chase or acquisition
 * envelope of ANY of the three hulls in the header's table**. 86.02 m from the
 * weigh house, 106.30 m from the post the player has to clear, and 140.36 m from
 * the nearest gantry.
 *
 * It also moves the office 45.49 m further off the Works' OWN line of march than
 * -58 did — the `ROAD` -> `SCALE` segment the first working attack-moves down
 * goes from 39.24 m to 84.73 m — which matters because `t.notesLost` reads
 * `entityDead` and does not care who fired.
 */
export const OFFICE: Point = lane(0.40, -103);

/** The office as a disc, so the briefing can show the player what to leave alone. */
export const OFFICE_AREA: Area = { x: OFFICE.x, z: OFFICE.z, r: 24 };

/**
 * Where the Works' workings form up: 73.53 m out of their gate, past
 * `BUILD_RADIUS` 56, and 58.83 m short of Number Three.
 *
 * All thirteen drops of the four rings fired here are standable. See the
 * operation's header for the sweep and for why a change to any `count` or
 * `spread` invalidates the check.
 */
export const ROAD: Point = lane(0.82, -24);

/* ==========================================================================
 * 2. THE COMPOSITION
 * ========================================================================== */

/**
 * Metres searched outward for a legal footprint. Nearest first, integer rings.
 *
 * `findClearFootprint` ALONE IS NOT ENOUGH: it asks `footprintClear` (is
 * anything already there) and `connectedGround` (can an army reach it) and
 * NOTHING about grade, so `spawnBuilding` will plant a structure on a slope
 * `isBuildable` refuses and report success. Both questions are asked here and
 * the shipped search is only the fallback — the same helper
 * `reclamation-closing-entry`, `reclamation-sold-twice` and
 * `reclamation-held-paper` all carry, for the same reason.
 */
const PLACE_RINGS: readonly number[] = [0, 6, 12, 18, 26, 34];
/** Eight exact bearings. Integers only, so every candidate is bit-identical. */
const PLACE_BEARINGS: readonly (readonly [number, number])[] = [
  [1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
];
/** Ring zero is the nominal spot itself; the bearings would test it eight times. */
const ORIGIN_ONLY: readonly (readonly [number, number])[] = [[0, 0]];

/** Metres reserved around a gantry, so its capture stands stay walkable. */
const GANTRY_CLEAR = 24;
/** Metres reserved around the receiving office, so nothing of `scatter` overhangs it. */
const OFFICE_CLEAR = 26;
/** Metres reserved around the weigh house, so the reading disc stays open. */
const SCALE_CLEAR = 26;
/** Metres reserved around the party's forming-up ground. */
const INSERT_CLEAR = 30;

export default layout({
  id: 'reclamation-payment-in-kind',
  tags: ['levy', 'office', 'scale', 'post', 'clerk', 'column'],

  build(b, cx, cz, start, c) {
    /*
     * THE EXPORTED POINTS ARE ABSOLUTE AND THIS BUILD IS SHELF-ANCHORED, SO THE
     * TWO HAVE TO AGREE. `buildScenario` passes `startShelf()`, which is
     * `startLocations()[0]`, which `startPointsFor` puts at the map centre on
     * every continent. If that ever stops being true the trigger table is naming
     * ground this file never dressed — and it would be invisible, because every
     * tag would still land and every test would still pass.
     */
    if (Math.abs(cx - CENTRE) > 1 || Math.abs(cz - CENTRE) > 1) {
      console.error(
        `[campaign] reclamation-payment-in-kind built on (${cx}, ${cz}), not the map centre `
        + `(${CENTRE}, ${CENTRE}) — every station is authored in absolute coordinates and will `
        + 'not line up with the ground this build lays down.',
      );
    }

    const spots = startSpots(cx, cz, b.armies, b.sea, b.seed);
    const home = spots[0];
    const foeSpot = spots[1] ?? spots[0];
    const us: PlayerId = c.seat(0);
    const them: PlayerId = c.seat(1);

    /*
     * THE ONE MEASUREMENT THE DERIVED POINTS REST ON, RE-CHECKED EVERY BUILD.
     *
     * `startSpots` runs `nudgeToBuildable`, so the corner it hands back is not
     * the raw slot in general — and every exported point above is computed from
     * the RAW slot. Measured at these seeds the two agree to 0.00 m on both
     * corners; a generator change that moves either one silently offsets the
     * whole composition from the establishment it was authored against, and
     * nothing downstream would notice.
     */
    if (Math.abs(home.x - HOME.x) > 2 || Math.abs(home.z - HOME.z) > 2
      || Math.abs(foeSpot.x - FOE.x) > 2 || Math.abs(foeSpot.z - FOE.z) > 2) {
      console.error(
        `[campaign] reclamation-payment-in-kind: startSpots gave (${home.x}, ${home.z}) and `
        + `(${foeSpot.x}, ${foeSpot.z}) against the raw corners (${HOME.x}, ${HOME.z}) and `
        + `(${FOE.x}, ${FOE.z}) — every exported point is derived from the RAW corners, so the `
        + 'composition and the establishment are no longer on the same map.',
      );
    }

    /* -- placement helper ------------------------------------------------- */
    const scratch = new Float32Array(2);
    const place = (owner: PlayerId, key: string, p: Point): Point => {
      const f = b.footprintOf(b.keyFor(owner, key));
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

    /**
     * Bearing from one point toward another, for the yaw of a model.
     *
     * The one `Math.atan2` in the file and it is cosmetic — nothing reads it
     * back, and no offset in this layout is derived from an angle.
     */
    const yawTo = (from: Point, to: Point): number => wrapDeg(
      Math.atan2(to.x - from.x, to.z - from.z) * (180 / Math.PI),
    );

    /* ==================================================================
     * 1. THE WORKS ESTABLISHMENT
     *
     * `buildBaseFor` for SEAT 1 and for nobody else — `opening` is `'force'`
     * and the player's half of that is this file simply not calling it.
     * Garrison on, so the establishment opens with harvesters and an economy:
     * this operation runs nineteen minutes and an opponent that never mines is
     * a backdrop rather than a threat.
     * ================================================================== */
    buildBaseFor(b, them, foeSpot.x, foeSpot.z, {
      facingDeg: wrapDeg(foeSpot.facingDeg + 180),
    });

    /* ==================================================================
     * 2. THE THREE GANTRIES
     *
     * PLACED FIRST of this file's own structures, because they are the
     * operation and everything else gives way to them. `civOreMine` carries
     * no `UNLOCK_TAGS` id, so the empty `roster.ai` cannot refuse one —
     * which matters more here than anywhere else in the file: a refused
     * `spawnBuilding` returns `NONE`, `c.tag` ignores `NONE`, and
     * `ownerCount(1, 'building', 'levy', max: 0)` would then read TRUE the
     * moment the settle guard expires and hand the player a win for taking
     * nothing.
     * ================================================================== */
    for (const at of [GANTRY_ONE, GANTRY_TWO, GANTRY_THREE]) {
      const p = place(them, 'civOreMine', at);
      const id: EntityId = b.spawnBuilding('civOreMine', them, p.x, p.z, {
        yawDeg: yawTo(p, HOME),
      });
      c.tag('levy', id);
      if (id !== NONE) b.block(p.x, p.z, GANTRY_CLEAR);
    }

    /* ==================================================================
     * 3. THE RECEIVING OFFICE
     *
     * The counterfoils, and the second primary. Owned by the WORKS, so
     * `Targeting.isValidTarget` — which refuses only ALLIES — will accept it
     * as a target for the player's own guns. That is the point: the rule is
     * that they must not, not that they cannot.
     * ================================================================== */
    const officeAt = place(them, 'civApartments', OFFICE);
    const officeId = b.spawnBuilding('civApartments', them, officeAt.x, officeAt.z, {
      yawDeg: yawTo(officeAt, HOME),
    });
    c.tag('office', officeId);
    if (officeId !== NONE) b.block(officeAt.x, officeAt.z, OFFICE_CLEAR);

    /* ==================================================================
     * 4. THE WEIGH HOUSE
     *
     * A THIRD SILHOUETTE, deliberately: the operation asks the player to tell
     * an office they must leave standing from a weigh house they may do as
     * they like with, and two `civApartments` on one map would have made that
     * a guessing game.
     * ================================================================== */
    const scaleAt = place(them, 'civHospital', SCALE);
    const scaleId = b.spawnBuilding('civHospital', them, scaleAt.x, scaleAt.z, {
      yawDeg: yawTo(scaleAt, HOME),
    });
    c.tag('scale', scaleId);
    if (scaleId !== NONE) b.block(scaleAt.x, scaleAt.z, SCALE_CLEAR);

    /* ==================================================================
     * 5. THE THREE POSTS
     *
     * `pillbox` is a ROLE key, so a change of `op.foe` still gets that army's
     * cheap emplacement — on a Soviet seat that is the SENTRY GUN,
     * `pillboxMg`, 22 m, `chainCount` 0, and `power: 0` so no brownout opens
     * it. It is untagged in `UNLOCK_TAGS`, so the empty `roster.ai` cannot
     * refuse one; what that empty list DOES keep off this ground is
     * `teslaCoil` — 30 m, `chainCount` 2, 153.6 then 92.2 against an 85 hp
     * Scrap Picker and an 85 hp Tinker — which is
     * `tests/campaign-emplacement-reach.spec.ts`'s whole subject and would put
     * two of the player's four engineers on the ground per trigger pull.
     *
     * An emplacement rather than a hull because `AiBrain.census` files every
     * AI-owned mobile hull into `armyIds` and `regroupSquads` marches it to
     * the rally point inside four seconds. A layout cannot opt out of that.
     * Concrete can.
     * ================================================================== */
    const posts: readonly Point[] = [
      // On the weighbridge apron, so the reading is contested rather than a
      // stop on an empty road.
      lane(0.40, 4),
      // The siding's road end, covering Number One.
      lane(0.575, 12),
      // Between Number Two and Number Three.
      lane(0.705, 6),
    ];
    for (const at of posts) {
      const p = place(them, 'pillbox', at);
      const id = b.spawnBuilding('pillbox', them, p.x, p.z, { yawDeg: yawTo(p, HOME) });
      c.tag('post', id);
      if (id !== NONE) b.block(p.x, p.z, 10);
    }

    /* ==================================================================
     * 6. THE DISTRAINT PARTY
     *
     * Eighteen hulls, 7 380 credits of them, and no way to make a nineteenth.
     *
     * FOUR TINKERS, AND THAT IS THE ARITHMETIC THE WHOLE OPERATION TURNS ON.
     * A capture spends one; the reading needs one standing on the
     * weighbridge; and there are three gantries. Every Tinker is either a
     * deed or the notice.
     *
     * SPAWNED ONE AT A TIME, because `ScenarioBuilder.formation` returns a
     * COUNT and `c.tag` needs a handle, and `t.served` reads that tag. The
     * hulls go through `formation` precisely because they must NOT carry it:
     * a Grinder parked on the weighbridge is not a clerk reading an entry.
     *
     * TWO SLAGGERS, NOT FOUR, AND THAT IS THE FILE'S OPINION IN THE
     * COMPOSITION. `slagCharge` is 21.93 delivered dps against Concrete
     * against a Grinder's 17.68, and the operation's secondary is about NOT
     * breaking the goods up. `reclamation.04.served-notice` sends four
     * because its objective is two buildings it wants flat.
     * ================================================================== */
    const face = yawTo(INSERT, GANTRY_TWO);
    for (let i = 0; i < 4; i++) {
      const off = (i - 1.5) * 5;
      c.tag('clerk', b.spawnUnit('rclTinker', us,
        INSERT.x + LANE.px * off - LANE.nx * 6,
        INSERT.z + LANE.pz * off - LANE.nz * 6,
        { yawDeg: face, stance: Stance.Defensive }));
    }
    b.formation('rclGrinder', us, INSERT.x + LANE.nx * 14, INSERT.z + LANE.nz * 14, 5,
      { yawDeg: face, spacing: 9, columns: 3 });
    b.formation('rclPicker', us, INSERT.x + LANE.px * 18, INSERT.z + LANE.pz * 18, 4,
      { yawDeg: face, spacing: 5, columns: 2 });
    b.formation('rclSlagger', us, INSERT.x - LANE.px * 18, INSERT.z - LANE.pz * 18, 2,
      { yawDeg: face, spacing: 5, columns: 2 });
    b.formation('rclSpitter', us, INSERT.x - LANE.nx * 14, INSERT.z - LANE.nz * 14, 3,
      { yawDeg: face, spacing: 9, columns: 3 });
    b.block(INSERT.x, INSERT.z, INSERT_CLEAR);

    /* ==================================================================
     * 7. ORE, DRESSING AND THE OPENING FRAME
     *
     * NOT `addStartOre`. See the header: on this pair the map centre is
     * `lane(0.50, 0)` exactly, so its contested patch would sit in the middle
     * of the road the party walks up. Both fields are the Works', taken on
     * their own corner's bearing toward the centre — the same geometry
     * `addStartOre` uses, as a normalised difference rather than off
     * `facingDeg` through `Math.sin`/`Math.cos`, which is exact under
     * IEEE-754.
     * ================================================================== */
    {
      const dx = cx - foeSpot.x;
      const dz = cz - foeSpot.z;
      const l = Math.max(1e-3, Math.sqrt(dx * dx + dz * dz));
      const nx = dx / l;
      const nz = dz / l;
      b.addOre(foeSpot.x + nx * 18 - nz * 44, foeSpot.z + nz * 18 + nx * 44, 30);
      b.addOre(foeSpot.x + nx * 58 + nz * 40, foeSpot.z + nz * 58 - nx * 40, 24);
    }

    // The opening frame: the party on the approach with the weighbridge beyond
    // them, so the first thing on screen is the direction the operation goes.
    // `Shell.applyCameraPostBoot` re-poses on `findHome`, which finds nothing on
    // a seat with no buildings; this is what the product, the headless path and
    // `?shot=` all read.
    b.setCameraFocus(
      INSERT.x + (SCALE.x - INSERT.x) * 0.22,
      INSERT.z + (SCALE.z - INSERT.z) * 0.22,
    );
    b.scatter({ minX: cx - 180, minZ: cz - 180, maxX: cx + 180, maxZ: cz + 180 }, 150);
    void start;
  },
});
