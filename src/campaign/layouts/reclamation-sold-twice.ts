/**
 * ============================================================================
 * VOLTMARCH — src/campaign/layouts/reclamation-sold-twice.ts
 * ============================================================================
 * R3 — THE GROUND. One salt pan running down the middle of the map, six Works
 * taps standing on it in two clusters, a receiving post at each end, and THREE
 * bases instead of two.
 *
 * ============================================================================
 * THE MAP IS A MIRROR AND THE PLAYER IS THE THING THAT BREAKS IT
 * ============================================================================
 * A three-army match seats slots 0, 1 and 2 at every seed — `seatedSlots` is
 * `if (n !== 2) return Array.from({ length: n }, (_, i) => i)`, so the pair
 * draw that makes `02-common-standard` and `reclamation-written-off` carry a
 * "change the seed and every distance moves" paragraph does not run here.
 * `startPointsFor` walks the same function to reserve the shelves, so ground
 * and bases agree by construction. Every distance below is SEED-INDEPENDENT;
 * `simSeed` buys only draws of `s.rng` — scatter, ore cells, formation jitter.
 *
 * `SKIRMISH_START_OFFSETS` puts the three slots at `(±148, ±124)` from the map
 * centre:
 *
 *     slot 0   (108, 380)   the player, Tallow's second yard
 *     slot 1   (404, 132)   Depot Four
 *     slot 2   (404, 380)   Depot Nine
 *
 * **SLOTS 1 AND 2 ARE EXACT REFLECTIONS OF EACH OTHER IN z ABOUT THE LINE
 * z = 256.** 256 − 132 = 124 and 380 − 256 = 124, so the two depots are the
 * same map twice. Everything this file authors as a z-mirrored pair is
 * therefore EQUIDISTANT FROM ITS OWN DEPOT BY ARITHMETIC, not by measurement,
 * and no `mapSeed` can move that.
 *
 * **THE PLAYER IS NOT ON THAT MIRROR. THE PLAYER IS ON DEPOT NINE'S SIDE OF
 * IT**, at z = 380, the same z as Depot Nine. That single fact is the whole
 * operation:
 *
 *     lot                    own depot     the player     other depot
 *     LOT_FOUR (258, 194)      158.62 m      238.95 m       236.46 m
 *     LOT_NINE (258, 318)      158.62 m      162.31 m       236.46 m
 *
 * So the south end of the pan is a fair fight — 162.31 m from your yard against
 * 158.62 m from the depot that bought it, a difference of **3.69 m** — and the
 * north end is not: you are **80.33 m further out than Depot Four is**. The
 * third column is the reason neither depot ever has to be in two places at
 * once and the player does: each end is 236.46 m from the depot that did NOT
 * buy it, which is further than either of them will walk while its own end is
 * still in dispute. The operation asks for both ends at once. It does not ask
 * for them at the same price, and the asymmetry is the map rather than a
 * difficulty number.
 *
 * The two lots are **124.0 m apart** and each is **62.03 m from the map
 * centre**, which is where the contested ore goes — see the ore block in
 * `build`.
 *
 * **AND THE SAME THING SAID ABOUT THE STRUCTURES THAT ACTUALLY LANDED**, which
 * is the reading that matters because the placement search moves some of them.
 * Measured on the built world at `mapSeed` 26 511 / `simSeed` 4 027, on
 * `biome: 'desert'`:
 *
 *     Four's end   tap          own depot   the player
 *                  (284, 196)     136.00 m    254.62 m
 *                  (244, 216)     180.71 m    213.05 m
 *                  (244, 172)     164.92 m    248.52 m
 *
 *     Nine's end   (284, 320)     134.16 m    185.95 m
 *                  (244, 328)     168.24 m    145.60 m
 *                  (244, 296)     180.71 m    159.85 m
 *
 * **EVERY TAP AT FOUR'S END IS NEARER DEPOT FOUR THAN IT IS TO YOUR YARD. TWO
 * OF THE THREE AT NINE'S END ARE NEARER YOU.** That is the operation in six
 * numbers, and it is a property of where the three shelves are rather than of
 * anything this file chose.
 *
 * **THE AUTHORED TABLE IS AN EXACT MIRROR AND THE LANDED COMPOSITION IS ONE
 * TAP OFF BEING ONE.** Seven of the eight structures land on their nominal
 * points put through `snapFootprintToGrid` — a 2x2 tap onto a multiple of
 * `CELL`, a 1x1 post onto a cell centre — which is why (284, 194) reads back as
 * (284, 196) and (294.82, 178.37) as (294, 178). The eighth is Nine's second
 * tap: its nominal (244, 340) is **0 of 4 cells buildable**, so `place` walked
 * the ring table out to r = 12 and planted it 12 m north at (244, 328).
 *
 * That one is not a seed accident and re-rolling will not fix it — the same
 * footprint reads 0/4 on the temperate ground this operation was authored on
 * too. What DID change with the biome is Four's third tap: on temperate its
 * nominal (244, 172) was 3/4 buildable and the search moved it 4 m west to
 * (240, 172); on desert it is 4/4 and lands on its literal. So the drift went
 * from two structures to one.
 *
 * Nothing in the trigger table reads a coordinate — every condition is
 * `ownerCount` over a tag — so the drift costs nothing mechanically, and it is
 * written down here rather than smoothed over because the arithmetic above is
 * about the LOT CENTRES and a reader comparing the two tables would otherwise
 * think one of them was wrong.
 *
 * **A WARNING FOR WHOEVER RE-MEASURES THIS, BECAUSE IT COST S4 A CYCLE.**
 * `startSpots` calls `nudgeToBuildable`, which scores `terrain.isBuildable`,
 * which is FALSE on a cell a structure already occupies. Calling `startSpots`
 * AFTER the world is built therefore reports openings that were never used.
 * Measure the spots BEFORE the build, or read the yards off the store.
 *
 * ============================================================================
 * ONE PAN, TWO ENDS, TWO INVOICES
 * ============================================================================
 * Six `civOilDerrick`, GAIA, three at each end. Gaia ownership is the whole
 * capture rule and it is not a detail: `Capture.ts` rule 1 flips a
 * `Faction.Neutral` structure OUTRIGHT, at any health, consuming the engineer.
 * A depot-owned tap would take rule 2 instead — capture only at or below
 * `CAPTURE.captureHpFrac` (0.5) — which is a demolition job wearing a
 * capture's name, and `reclamation-written-off` already spent that verb on its
 * sorting station.
 *
 * Three consequences, and all three are the operation:
 *
 *   1. **Gaia is allied to everybody**, so no targeting scan considers a tap an
 *      enemy while the Works still holds it. The pan is safe until you touch
 *      it. **Taking the deed is what paints it**, 158.62 m from a depot yard.
 *   2. **Neither depot can take one back, by either verb.** There are two ways
 *      to flip a neutral structure (`src/data/Civilians.ts` names both): an
 *      ENGINEER takes the deed permanently, and a SQUAD holds it while it
 *      stands inside (`GarrisonService.enter` calls `captureBuilding`,
 *      `releaseEmptied` hands it back). A brain can do neither, and the reason
 *      is the VERB rather than the unit — a distinction worth drawing here
 *      because `buildAlliedGarrison` hands each depot one engineer at t=0, so
 *      "the AI owns no engineer" is false on this map. What is true is that
 *      **`AiBrain` never issues `OrderKind.Capture` at all**: CLAUDE.md's
 *      capability audit lists it among the verbs the brain has no call site
 *      for, `buildUnits` filters the def's weight-0 row so it never buys
 *      another, and the only `OrderKind.Enter` in `AI.ts` is the amphibious
 *      boarding path on a map with a sea, which this is not.
 *      `GarrisonService.enter` also returns `'hostile'` for a structure its
 *      player is not allied to, which closes the last door. **A tap you hold
 *      stops counting only when it is DESTROYED.**
 *   3. **Three per end against a primary that asks for two is what that
 *      costs.** A levelled tap is gone for the match, so each end can absorb
 *      exactly one loss. It cannot absorb two, and `03-sold-twice.ts` says out
 *      loud that the vocabulary cannot express "fewer than two left standing
 *      at that end" — `ownerCount` names a SEAT and Gaia is not one, because
 *      `validateCampaign`'s `checkSeat` refuses any index outside the three
 *      this operation seats. The answer is the same one `soviets-deep-sector`
 *      and `soviets-company-town` use: a hard deadline.
 *
 * A held tap pays **15 credits a second** (`CIVILIAN_INCOME`) — 900 a minute,
 * 1.71 measured harvesters — and projects `PLACEMENT.adjacencyRadius` (20 m) of
 * build space, because `withinBuildRadius` reads every finished structure the
 * player owns and asks nothing about what kind it is. **Taking an end is what
 * lets you fortify it**, 238.95 m from your own yard, and nothing scripts that.
 *
 * ============================================================================
 * THE POSTS ARE THE ONE THING S4 DELIBERATELY DID NOT PUT ON ITS OBJECTIVE
 * ============================================================================
 * `soviets-company-town` argues at length that nothing should guard its town:
 * the premise there is that two Allied districts both filed for it and NEITHER
 * MOVED IN, so a concrete gun on the ground would assert the opposite.
 *
 * **THIS OPERATION IS THAT PREMISE INVERTED AND THE EMPLACEMENTS FOLLOW.** Both
 * depots PAID. Both posted a man on the end of the pan they think they bought.
 * So each lot carries one `pillbox`-role emplacement, owned by the depot at
 * that end, 40 m out along the line to its own yard. Measured on the built
 * world they land at (294, 178) and (294, 334) — **119.23 m from their own
 * depot each, an exact mirror.**
 *
 * **EACH POST COVERS EXACTLY ONE CAP, AND THE READING IS SURFACE DISTANCE.**
 * `Combat.engage` gates firing on `max(0, flat - hitRadius(target))`, and a tap
 * is a 2x2 footprint, so its `hitRadius` is `hypot(4, 4)` = 5.66 m and
 * `pillboxMg`'s 22 m reaches a tap whose CENTRE is within **27.66 m**:
 *
 *     post          nearest tap               second nearest
 *     Four            20.59 m -> 14.93 surf     50.36 m -> 44.70 surf
 *     Nine            17.20 m -> 11.55 surf     50.36 m -> 44.70 surf
 *
 * Inside its own cap by 7.07 m and 10.45 m of surface reach, outside the next
 * by 22.70 m at both ends, and neither post reaches across the pan at all —
 * the nearest tap on the other end is 128.16 m from either of them.
 *
 * **THIS BLOCK COMPARED 20.59 AND 17.20 STRAIGHT AGAINST 22 BEFORE**, which is
 * a centre distance measured against a surface range: the right answer for the
 * wrong reason, and blind to a post sitting anywhere between 22 and 27.66 m
 * out. It is also how the first desert build was read as putting post Four 8 m
 * past its reach when the real figure is 2.4 m.
 *
 * They are emplacements and not hulls for the reason `campaign-maps.spec.ts`
 * pins as a rule: `AiBrain.census` files every AI-owned mobile hull into
 * `armyIds` and `regroupSquads` marches it to the rally point. Measured
 * 2026-08-19 on `02-common-standard`, two Wardens parked on an objective were
 * re-tasked inside FOUR SECONDS and died 127 m away having never stood on it. A
 * layout cannot opt out. Concrete can.
 *
 * `pillbox` is a ROLE key: `keyFor` gives the Allies their own `pillbox`,
 * `power: 0`, so no brownout in a depot can silence the price of the visible
 * secondary. A Meridian foe would put a `needsPower` Glaive Post here instead —
 * a reason to re-read this block before changing `op.foe`, not a reason to name
 * a def.
 *
 * ============================================================================
 * NO `addStartOre`, AND THE REASON IS ARITHMETIC RATHER THAN TASTE
 * ============================================================================
 * `addStartOre` lays the contested patch on the CENTROID of the openings, which
 * for slots 0/1/2 is exactly `(305.33, 297.33)`. **That point is 31.13 m from
 * the nearest tap at Nine's end and 101.87 m from the nearest at Four's**, so
 * its radius-22 field would sit nine metres off one objective and a hundred
 * metres off the other — on an operation whose entire premise is that the two
 * ends are worth the same. The centroid is where it belongs on a map with one
 * contested middle; this map has two, and they are not equidistant from it.
 *
 * The near half of that is also the hazard `soviets-deep-sector` moved a whole
 * ore field 88 m to avoid: ore on an objective is a harvester parked on the
 * deed, both depots' crushers driving into a hold, and a second unauthored
 * reason to be standing there.
 *
 * So the ore is laid by hand: one radius-30 home field per seat at the bearing
 * `addStartOre` itself uses (18 m along the line to the centre, 44 m across it)
 * and ONE radius-22 contested patch on the MAP CENTRE. The centre is
 * `hypot(148, 124)` = 193.08 m from all three openings — the one point on a
 * rectangle of four corners that is equally far from three of them — and it is
 * **62.03 m from each lot centre**, the same distance to both by the mirror. So
 * the pan's middle is worth holding for a reason that is not the objective, it
 * supports either end equally, and it touches neither: the nearest tap to the
 * centre is 41.76 m out against an ore rim at 22.
 *
 * ============================================================================
 * NO TRIGONOMETRY, AND NO `rotateStarts`
 * ============================================================================
 * Every offset in this file is an authored INTEGER, and the two bearings that
 * are not — the line from a lot to its depot, and from an opening to the centre
 * — are a difference divided by a `Math.sqrt`. ECMA-262 pins `+ - * /` and
 * `Math.sqrt` and pins neither `sin` nor `cos`; a layout runs independently on
 * both machines of a lockstep match, so a table rotated by an angle is a
 * tick-zero desync waiting for two engines to disagree in the last mantissa
 * bit. Yaw is the one exception and it is cosmetic.
 *
 * `rotateStarts` is not called, for `reclamation-held-paper`'s reason: an
 * operation pins its seed, so the rotation is a moving part with exactly one
 * value — a coin flipped once at authoring time deciding whether every measured
 * coordinate here belongs to the player or to a depot. Seat `i` takes slot `i`.
 *
 * ============================================================================
 * WHAT THE BUILD ACTUALLY PUT DOWN
 * ============================================================================
 * Built headless at `mapSeed` 26 511 / `simSeed` 4 027 on `biome: 'desert'`,
 * with the operation's roster INSTALLED, which is the only state in which the
 * allow-list is in force — unbound, the census reads 25 / 26 / 26 and is
 * measuring a different game:
 *
 *     seat 0  the player   24 buildings   23 units   power +60  (320 / 260)
 *     seat 1  Depot Four   24 buildings   14 units   power +230 (400 / 170)
 *     seat 2  Depot Nine   24 buildings   14 units   power +230 (400 / 170)
 *     Gaia                  6 buildings    0 units   <- the six taps
 *
 * `auditConnectivity`: one passable region holding 12 596 of 12 596 cells
 * (100.0%), **0 placements relocated, 0 entities stranded, 0 structures on
 * ground `isBuildable` refuses.** The player's yard holds `rclTinker` x3 — two
 * from this file and one from the garrison — against a primary that needs four
 * deeds, which is the shortfall the operation is written around.
 *
 * **THE CENSUS AND THE POWER SPLIT DID NOT MOVE WHEN THE GROUND DID.** Every
 * figure in this block is identical to the one measured on the temperate roll
 * this operation shipped with; the biome change is visible only in the cell
 * count above and in one tap. See the `biome` block in `03-sold-twice.ts` for
 * the survey that picked 26 511 out of 200 rolls.
 *
 * **THE ROSTER IS VISIBLE IN THAT CENSUS AND BOTH HALVES ARE.** The player's
 * base carries one `rclPylon` (`struct.defence.specialist`, -90) and no
 * `rclCrucible` (`struct.tech`, refused); each depot's carries four `pillbox`
 * — three in `ALLIED_DEFENCE` plus the one this file puts on the pan — and no
 * `prismTower`, because that row is `struct.defence.specialist` and the AI list
 * does not name it. **The Pylon is why the player opens at +60 against +230**:
 * `rclFurnace` makes 80, so a SECOND Pylon anywhere on the map is a brownout
 * until a Furnace goes up first. That is the price of the grant and it is paid
 * at t=0.
 *
 * ============================================================================
 * TAGS
 * ============================================================================
 * `lotFour` / `lotNine` — three Gaia taps each. Read through
 *   `ownerCount(0, 'building', tag)`, which counts what the PLAYER owns and is
 *   therefore zero at t=0 and rises with each deed. TWO TAGS RATHER THAN ONE
 *   BECAUSE THE PRIMARY IS A CONJUNCTION ACROSS THEM — see `03-sold-twice.ts`.
 * `post` — the two receiving emplacements, one per depot seat. Buildings, so
 *   the `campaign-maps.spec.ts` rule about an `entity*` tag on an AI seat is
 *   satisfied rather than dodged.
 * `crew` — the two Tinkers this file hands out. On seat 0, so nothing re-tasks
 *   them.
 * `partyFour` / `partyNine` — the two collection columns. Produced by
 *   `spawnUnits` in the trigger table, never by this file, and declared anyway
 *   so a reader asking "where does the pressure come from" finds the answer in
 *   the file that owns the ground. `validateCampaign` and
 *   `campaign-maps.spec.ts` both know a spawned tag is not the layout's to
 *   place.
 *
 * **IT READS NO CLOCK, NO PROFILE AND NO DOM.** It runs inside the world build,
 * which is where the tick-zero desync lives: `Scenarios.ts` calls `isBuildable`
 * while spawning, and that answers from the LOCAL profile unless the
 * operation's roster is installed first. `campaign-install.ts` installs it
 * BEFORE the boot, so this gets the same world on every machine.
 * ========================================================================== */

import { MAP_SIZE } from '../../core/config';
import { NONE } from '../../core/types';
import { buildBaseFor, startSpots, wrapDeg } from '../../game/Scenarios';
import type { EntityId, PlayerId } from '../../core/types';
import type { Area, Point } from '../types';
import { layout } from '../layout';

/* ==========================================================================
 * 1. THE PLACES THE TRIGGER TABLE ALSO READS
 *
 * World metres, absolute, on a 512 m map. A trigger table is STATIC DATA
 * frozen at module load, so an `Area` cannot be derived from a start spot the
 * generator has not chosen yet — the coordinates have to be literals
 * somewhere. This module owns them and
 * `operations/reclamation/03-sold-twice.ts` imports them; the dependency runs
 * operation -> layout and never back.
 *
 * A number written in two files is a number that will disagree the first time
 * either is tuned, and the failure — a reveal that frames empty ground, a
 * column that lands somewhere nobody authored — is invisible to every gate.
 * ========================================================================== */

/** The map centre. `startPointsFor` reserves a shelf here first, on a continent. */
const CENTRE = MAP_SIZE * 0.5;

/**
 * The two ends of the pan, and the mirror is exact.
 *
 * `256 - 194 = 62` and `318 - 256 = 62`, against depots at `256 - 132 = 124`
 * and `380 - 256 = 124`. Both lots are therefore `hypot(146, 62)` = **158.62 m**
 * from the depot that bought them, by arithmetic rather than by measurement,
 * and both are `hypot(2, 62)` = **62.03 m** from the map centre.
 *
 * x = 258 rather than 256 puts the pan two metres onto the depots' side of the
 * map's centre line, so the two ends are not sitting on the exact axis the
 * contested ore is centred on. **IT IS NOT LOAD-BEARING AND THE HEADER'S CLAIMS
 * DO NOT REST ON IT** — at x = 256 every distance in this file moves by at most
 * 1.85 m (lot to own depot 160.46 instead of 158.62, lot to centre 62.00
 * instead of 62.03). The MIRROR IN z is the load-bearing half; the two metres
 * in x are a placement convenience.
 */
export const LOT_FOUR: Point = { x: 258, z: 194 };
export const LOT_NINE: Point = { x: 258, z: 318 };

/**
 * Each end as a disc, for `revealArea`.
 *
 * 52 m rather than the tap ring's 26, so the reveal covers the three taps, the
 * receiving post 40 m out, and the ground a defender would stand on. **NEITHER
 * IS A HOLD DISC** — the primary is `ownerCount` over a tag, so this operation
 * never asks where anybody is standing. See `03-sold-twice.ts` for why a deed
 * beats a disc here, and `soviets-deep-sector` for the ore field it had to move
 * because `unitsInArea` has no role filter.
 *
 * The two discs are 124.0 m apart centre to centre and 20.0 m apart rim to rim,
 * so they read as two ends of one pan rather than as one blob.
 */
export const LOT_FOUR_AREA: Area = { x: LOT_FOUR.x, z: LOT_FOUR.z, r: 52 };
export const LOT_NINE_AREA: Area = { x: LOT_NINE.x, z: LOT_NINE.z, r: 52 };

/**
 * Where each depot's collection column forms up.
 *
 * **OUT FROM ITS OWN GATE, NOT ON THE PAN.** 70 m along the line from the
 * depot's opening to its own lot — 69.46 m after rounding to the metre — so each
 * is just outside `BUILD_RADIUS` 56 and
 * **89.16 m short of the lot it is coming for**, 67.12 m and 65.00 m from the
 * nearest tap at that end. A column that has formed and is about to leave,
 * which is a schedule an opponent keeps rather than an army that materialises
 * inside a holding player's formation.
 *
 * Mirror-symmetric in z, so the two columns are the same drive.
 *
 * **`EffectSink.spawnUnits` DOES NOT SNAP TO STANDABLE GROUND.** Everything
 * THIS file places goes through `ScenarioBuilder.spawnUnit`, which calls
 * `connectedGround`; the Director's path calls `ProductionService.spawnUnit`,
 * which clamps to the map, reads `heightAt` and allocates, and asks nothing.
 * `soviets-common-standard` shipped a reward hull standing on a knoll that way.
 * It also lays its wave on an exact RING of radius `spread`, not a scatter — so
 * both points AND every ring the trigger table asks for have to be checked. See
 * the operation header for the four rings that were.
 */
export const ROAD_FOUR: Point = { x: 340, z: 159 };
export const ROAD_NINE: Point = { x: 340, z: 353 };

/**
 * Where the crew forms up: 70 m out from the player's yard along the line to
 * the map centre.
 *
 * DERIVED, THEN WRITTEN DOWN. `(148, -124) / 193.08` is the unit vector from
 * slot 0 to the centre; 70 m along it from (108, 380) is (161.65, 335.05), and
 * this is that rounded to the metre. Far enough out that the opening frame
 * reads as a column about to march rather than as two men loitering behind a
 * yard; close enough that the base's own defence line is still between them and
 * both depots.
 *
 * The two Tinkers land at (159.5, 341) and (164.5, 341). MEASURED from the
 * nearer of them: **80.56 m to the closest tap at Nine's end and 148.14 m to
 * the closest at Four's**, which are the two numbers the operation's clock is
 * written against.
 */
export const STAGE: Point = { x: 162, z: 335 };

/* ==========================================================================
 * 2. THE COMPOSITION
 * ========================================================================== */

/**
 * The three taps at each end, as offsets from that end's centre.
 *
 * AUTHORED INTEGERS, AND THE TABLE IS ITSELF SYMMETRIC IN z — so laying it at
 * both lots ASKS FOR a composition that is an exact reflection about z = 256,
 * which is what makes every "same distance from its own depot" claim in the
 * header arithmetic. The apex points at +x, which is the direction of BOTH
 * depots (they share x = 404). What actually LANDS is not a mirror, because
 * `place` walks three of the eight structures onto buildable ground; the header
 * carries both tables and says why the difference costs nothing.
 *
 * Nominal radii 26.00 / 26.08 / 26.08 m from the lot centre. MEASURED after
 * `place` and after `spawnBuilding` snapped each footprint to the grid, the
 * within-end spacings are **44.72 / 46.65 / 44.00 m at Four's end and 40.79 /
 * 46.65 / 32.00 m at Nine's**, and the nearest tap of one end to the nearest
 * tap of the other is **80.00 m**. The largest `splashRadius` in the weapon
 * tables is 6.5 m and the tightest pair on the map is 32.00 m — 4.9 times it —
 * so nothing in the game reaches two taps with one shell and each of the six is
 * a separate decision to defend.
 */
const TAP_OFFSETS: readonly Point[] = [
  { x: 26, z: 0 },
  { x: -14, z: 22 },
  { x: -14, z: -22 },
];

/** Metres out from a lot centre, toward that lot's own depot, for its post. */
const POST_OUT = 40;

/** Metres reserved around each tap, so the next search cannot land on it. */
const TAP_CLEAR = 10;
/** Metres reserved around each lot, so `scatter` leaves the pan walkable. */
const LOT_CLEAR = 46;

/** Metres searched outward for a legal footprint. Nearest first, integer rings. */
const PLACE_RINGS: readonly number[] = [0, 6, 12, 18, 26, 34];
/** Eight exact bearings. Integers only, so every candidate is bit-identical. */
const PLACE_BEARINGS: readonly (readonly [number, number])[] = [
  [1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
];
/** Ring zero is the nominal spot itself; the bearings would test it eight times. */
const ORIGIN_ONLY: readonly (readonly [number, number])[] = [[0, 0]];

/**
 * Tinkers the crew opens with.
 *
 * TWO, AGAINST A PRIMARY THAT NEEDS FOUR DEEDS, AND THE SHORTFALL IS THE
 * OPERATION'S FIRST DECISION. `buildAlliedBase` with `garrison` on spawns one
 * more `engineer` inside the base — `keyFor` turns it into an rclTinker — so
 * the player opens holding THREE deed-takers for four required deeds. The
 * fourth is 500 credits and ten seconds out of the Rookery the opening base
 * already has (`rclTinker`'s prereqs are `rclRookery` and `rclSorter`, and
 * `ALLIED_CORE` places both), plus the walk. See `03-sold-twice.ts`.
 */
const CREW_SIZE = 2;

export default layout({
  id: 'reclamation-sold-twice',
  tags: ['lotFour', 'lotNine', 'post', 'crew', 'partyFour', 'partyNine'],

  build(b, cx, cz, start, c) {
    /*
     * THE EXPORTED POINTS ARE ABSOLUTE AND THIS BUILD IS SHELF-ANCHORED, SO THE
     * TWO HAVE TO AGREE. `buildScenario` passes `startShelf()`, which is
     * `startLocations()[0]`, which `startPointsFor` puts at the map centre on
     * every continent. If that ever stops being true the trigger table is
     * naming ground this file never dressed — and it would be invisible,
     * because every tag would still land and every test would still pass.
     */
    if (Math.abs(cx - CENTRE) > 1 || Math.abs(cz - CENTRE) > 1) {
      console.error(
        `[campaign] reclamation-sold-twice built on (${cx}, ${cz}), not the map centre `
        + `(${CENTRE}, ${CENTRE}) — the pan is authored in absolute coordinates and will not `
        + 'line up with the ground this build lays down.',
      );
    }

    const spots = startSpots(cx, cz, b.armies, b.sea, b.seed);

    /*
     * SLOT ORDER, NOT `rotateStarts`. See the header. Seat 0 is the player's
     * corner by construction, which is what makes every measured coordinate in
     * this file mean the same thing on every boot.
     */
    for (let i = 0; i < spots.length; i++) {
      buildBaseFor(b, c.seat(i), spots[i].x, spots[i].z, {
        facingDeg: wrapDeg(spots[i].facingDeg + 180),
      });
    }

    const us: PlayerId = c.seat(0);
    const four: PlayerId = c.seat(1);
    const nine: PlayerId = c.seat(2);
    const home = spots[0];

    /* -- placement helper -------------------------------------------------
     * `findClearFootprint` ALONE IS NOT ENOUGH and the build says so out loud.
     * It asks `footprintClear` (is anything already there) and `connectedGround`
     * (can an army reach it) and NOTHING about slope, so `spawnBuilding` will
     * plant a structure on a grade `isBuildable` refuses and report success —
     * the split `footprintBuildable`'s own header draws, written after four
     * civilian derricks went down on a 0.45 slope. These taps ARE the objective
     * and the player has to be able to build beside them, so both questions are
     * asked here and the shipped search is only the fallback.
     *
     * NO TRIGONOMETRY. Every candidate is an integer bearing times an integer
     * radius added to the nominal point, in a fixed traversal order, so two
     * runs of one seed place the same pan and two engines agree on it.
     */
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
     * The unit vector from a lot to the depot that bought it, and the bearing a
     * structure standing there should face.
     *
     * A DIFFERENCE OVER A `Math.sqrt`, which ECMA-262 pins. The `atan2` is
     * cosmetic — it is the yaw of a model — and is the one place an angle is
     * taken, exactly as `reclamation-written-off` and `reclamation-held-paper`
     * take theirs.
     */
    const toward = (from: Point, to: Point): { nx: number; nz: number; yaw: number } => {
      const dx = to.x - from.x;
      const dz = to.z - from.z;
      const len = Math.max(1e-3, Math.sqrt(dx * dx + dz * dz));
      const nx = dx / len;
      const nz = dz / len;
      return { nx, nz, yaw: wrapDeg(Math.atan2(nx, nz) * (180 / Math.PI)) };
    };

    /* ==================================================================
     * 1. THE SIX TAPS
     *
     * PLACED FIRST, because they are the operation and everything else on
     * the pan has to give way to them. Blocked after each placement so the
     * next search cannot land on top of it and so `scatter` keeps its
     * distance — `spawnBuilding` marks cells occupied, `block` is what
     * holds props off.
     *
     * GAIA, and the whole capture rule depends on it. See the header.
     *
     * `civOilDerrick` is untagged in `UNLOCK_TAGS`, so this operation's
     * roster cannot refuse one — which matters more here than anywhere
     * else, because a refused `spawnBuilding` returns NONE, the tag lands
     * on nothing, and the primary would be unreachable with every test
     * still green. `campaign-maps.spec.ts` checks the declaration both
     * ways.
     * ================================================================== */
    const lots: readonly { at: Point; tag: string; owner: PlayerId }[] = [
      { at: LOT_FOUR, tag: 'lotFour', owner: four },
      { at: LOT_NINE, tag: 'lotNine', owner: nine },
    ];

    for (const lot of lots) {
      const depot = lot.owner === four ? spots[1] : spots[2];
      const aim = toward(lot.at, { x: depot.x, z: depot.z });

      for (let i = 0; i < TAP_OFFSETS.length; i++) {
        const nominal: Point = {
          x: lot.at.x + TAP_OFFSETS[i].x,
          z: lot.at.z + TAP_OFFSETS[i].z,
        };
        const at = place(b.gaia, 'civOilDerrick', nominal);
        const id: EntityId = b.spawnBuilding('civOilDerrick', b.gaia, at.x, at.z, {
          yawDeg: wrapDeg(aim.yaw + i * 40),
        });
        c.tag(lot.tag, id);
        if (id !== NONE) b.block(at.x, at.z, TAP_CLEAR);
      }

      /*
       * THE RECEIVING POST. Owned by the depot at this end, 40 m out along
       * the line to its own yard, facing back down the pan.
       *
       * A `pillbox` ROLE KEY rather than a def name, so the composition stays
       * legible if `op.foe` ever moves — and untagged in `UNLOCK_TAGS`, so no
       * roster can refuse it whatever it withholds. Measured, it covers
       * exactly ONE tap at its end: 14.93 m and 11.55 m of SURFACE distance
       * against `pillboxMg`'s 22 m, with the next nearest at 44.70 m on both
       * ends. It is what the visible secondary is about.
       */
      const post: Point = {
        x: lot.at.x + aim.nx * POST_OUT,
        z: lot.at.z + aim.nz * POST_OUT,
      };
      const where = place(lot.owner, 'pillbox', post);
      const pid = b.spawnBuilding('pillbox', lot.owner, where.x, where.z, {
        yawDeg: wrapDeg(aim.yaw + 180),
      });
      c.tag('post', pid);
      if (pid !== NONE) b.block(where.x, where.z, 12);
    }

    /* ==================================================================
     * 2. THE CREW AND ITS ESCORT
     *
     * SPAWNED ONE AT A TIME RATHER THAN THROUGH `b.formation`, because
     * `formation` returns a COUNT and `c.tag` needs a handle. The trigger
     * table reads this tag, so the crew has to be tagged, so the
     * convenience helper cannot be used.
     *
     * `engineer` goes through `keyFor`, which maps it per army — a layout's
     * key is a ROLE. The OPERATION file cannot do this:
     * `EffectSink.spawnUnits` resolves through `ProductionCatalog.byKey`
     * and remaps nothing.
     * ================================================================== */
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
     * trigger table's "have you any Tinkers left" and mixing hulls into that
     * tag would make it answer a different question. These are ordinary units
     * of the player's, indistinguishable from anything the Breaker Yard makes
     * afterwards, which is correct: the escort is replaceable and the crew is
     * the thing that is not.
     *
     * ROLE KEYS, so these are the Reclamation's own hulls — `grizzly` resolves
     * to `rclGrinder` and `gi` to `rclPicker`, neither of which carries an
     * `UNLOCK_TAGS` id, so the roster cannot silently refuse them.
     *
     * Units reserve nothing for themselves — see `START_CLEAR_RADIUS` — and
     * `b.scatter` honours the reservation list, so without the `block` below
     * the column forms up in a boulder field.
     */
    b.formation('grizzly', us, STAGE.x, STAGE.z - 10, 3, {
      yawDeg: home.facingDeg, spacing: 9, columns: 3, jitter: 0.5,
    });
    b.formation('gi', us, STAGE.x, STAGE.z - 22, 4, {
      yawDeg: home.facingDeg, spacing: 5, columns: 4, jitter: 0.6,
    });
    b.block(STAGE.x, STAGE.z, 26);

    /* ==================================================================
     * 3. THE ORE
     *
     * NOT `addStartOre`. See the header: its contested patch goes on the
     * centroid, 31.13 m from one end's nearest tap and 101.87 m from the
     * other's, which is a radius-22 field on one objective and nowhere near
     * the other.
     *
     * The home fields use that helper's own geometry — 18 m along the line
     * to the centre and 44 m across it, radius 30 — taken as a normalised
     * difference rather than off `facingDeg` through `Math.sin`/`Math.cos`,
     * which lands in the same place for the same reason a start faces the
     * middle of the map, and is exact under IEEE-754.
     * ================================================================== */
    for (const s of spots) {
      const u = toward({ x: s.x, z: s.z }, { x: cx, z: cz });
      b.addOre(s.x + u.nx * 18 - u.nz * 44, s.z + u.nz * 18 + u.nx * 44, 30);
    }
    // The contested patch: the one point equally far from all three openings
    // and equally far from both ends of the pan. 62.03 m from either lot
    // centre and 41.76 m from the nearest tap, against a rim at 22.
    b.addOre(cx, cz, 22);

    /* ==================================================================
     * 4. DRESSING AND THE OPENING FRAME
     *
     * NO `addCivilians`. It hangs capturable `civOilDerrick`s and two
     * hamlets off the perpendicular bisector of the openings and walks
     * `MINE_BISECTOR_OFFSETS` outward for a `civOreMine` — the same
     * silhouette and the same capture verb this operation has spent on the
     * six taps that ARE the objective. A player told to work two taps at
     * each end and able to see ten is a player the layout has lied to.
     * `allies-sounding-line` skips it for the same reason and
     * `soviets-common-standard` measured its mine landing 4.0 m from that
     * operation's objective.
     * ================================================================== */

    // Reserved LAST, so every structure above could still find its own
    // footprint, and wide enough that `scatter`'s centre test cannot drop a
    // 4 m pine whose canopy overhangs a tap.
    b.block(LOT_FOUR.x, LOT_FOUR.z, LOT_CLEAR);
    b.block(LOT_NINE.x, LOT_NINE.z, LOT_CLEAR);

    // The opening frame: the yard with the crew in front of it and the pan
    // beyond them. Biased 13% toward the centre, the same bias
    // `allies-sounding-line` uses, so the first thing on screen is the
    // direction the operation goes.
    b.setCameraFocus(home.x + (cx - home.x) * 0.13, home.z + (cz - home.z) * 0.13);
    b.scatter({ minX: cx - 170, minZ: cz - 170, maxX: cx + 170, maxZ: cz + 170 }, 150);
    void start;
  },
});
