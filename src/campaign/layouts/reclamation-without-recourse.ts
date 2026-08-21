/**
 * ============================================================================
 * VOLTMARCH — src/campaign/layouts/reclamation-without-recourse.ts
 * ============================================================================
 * R10 — THE GROUND. Survey 13-627, the district works: the company yard on the
 * near corner, the last breaking yard the firm works on this road, the district
 * exchange standing on the map centre with a Continental Allocation
 * establishment sitting in it, four bonded stores strung round the district —
 * one for each house's papers — and the establishment's compound on the far
 * corner.
 *
 * `reclamation.10.without-recourse` is the afternoon the delivery book stops
 * being the Reclamation's. Every structure this file places is either the
 * counter the endorsement is entered at, one of the four stores a copy is
 * lodged in, the yard the firm is trying not to pay for it with, or the thing
 * standing between them.
 *
 * ============================================================================
 * EVERY EXPORTED POINT IS ARITHMETIC, AND THE ONE MEASUREMENT THAT MAKES THAT
 * SAFE IS AT THE TOP OF `build`
 * ============================================================================
 * `reclamation-served-notice`, `reclamation-closing-entry`,
 * `reclamation-payment-in-kind` and `reclamation-book-value` are the precedents
 * and they carry the argument: `SIM_SEED` lives HERE, `10-without-recourse.ts`
 * imports it into `map.simSeed` rather than restating it, and every point below
 * is computed from it at module load out of `seatedSlots`,
 * `SKIRMISH_START_OFFSETS` and `MAP_SIZE`. A number written in two files is a
 * number that will disagree the first time either is tuned, and the failure — a
 * counter disc sitting where no store stands, a picket forming up on open
 * ground — is invisible to every gate.
 *
 * `seatedSlots(2, 22014, null)` draws **[0, 1]**, the diagonal pair, so the two
 * openings are `hypot(296, 248)` = **386.16 m** apart rather than an edge pair's
 * 296.00. Four bonded stores that a player has to hold AT ONCE do not sit at
 * legible spacing on 296 m: the whole operation is that the four counters are
 * far enough apart to need four separate hands.
 *
 * Every point below is `lane(along, off)`: a fraction of that line from the
 * company's corner, plus metres along its left-hand perpendicular.
 *
 * ============================================================================
 * THE SEED WAS SWEPT FOR EIGHT STATIONS, AND THE FORMING-UP POINT IS THE ONE
 * THAT COULD NOT BE FIXED AFTERWARDS
 * ============================================================================
 * This operation needs EIGHT stations at once — the exchange, four bonded
 * stores, the outlying yard, and the ground the pickets form up on — plus an
 * unbroken corridor for a wheeled hull from one opening to the other.
 *
 * Thirty rolls were scored on EACH of `urban`, `snow` and `temperate` at a fixed
 * `simSeed` — ninety in all — each station by the Chebyshev ring distance at
 * which a 3x3 block that is `isBuildable` AND both `Foot`- and `Track`-passable
 * first appears (ring 0 = the authored point itself), and the corridor by an
 * 8-connected flood fill of the real `Locomotor.Wheel` pass grid from the
 * company's opening:
 *
 *     preset     seed      sum of rings   ROAD's ring
 *     temperate  60 009          1             0
 *     snow      103 078          4             1
 *     urban      13 627          5             0
 *     urban      69 948          5             1
 *     urban      76 574          5             1
 *     ...eighty-five more at sum 6 to 21
 *
 * **EVERY ONE OF THE NINETY PUT ALL EIGHT STATIONS INSIDE ONE WHEELED REGION**,
 * which is worth saying rather than implying: connectivity did not decide this
 * and the ring totals did.
 *
 * **`temperate` 60 009 IS THE BEST GROUND IN THE NINETY AND IT IS NOT WHAT
 * SHIPPED.** `reclamation.09.book-value` sits immediately before this operation
 * on `temperate`, and it made the opposite call for its own good reason — its
 * seven stations were strictly better on temperate ground and it says so. Here
 * the two presets are one ring apart per station at worst, `urban`'s
 * `MAP_PRESETS` name is *Industrial Grid*, which is what a district of bonded
 * stores and an exchange is, and the offsets were then swept until the
 * difference was zero. The table is here so the next person can re-take the
 * trade rather than re-run the sweep.
 *
 * **THE OFFSETS WERE SWEPT ON THE CHOSEN ROLL UNTIL EVERY STATION SAT AT RING
 * ZERO.** The sweep above scores an authored guess; `place()` walks rings of
 * [0, 6, 12, ...] metres and takes the first legal footprint, so a station at
 * ring 2 is a structure twelve metres from where it was authored and a disc
 * centred on a point the landmark is not standing at. Sweeping five
 * along-fractions against five perpendicular offsets per station on
 * `urban` 13 627 and keeping only ring-0 candidates moved STORE_OURS from
 * `lane(0.30, -70)` to `lane(0.34, -72)`, STORE_MERIDIAN from `lane(0.62, -78)`
 * to `lane(0.60, -78)`, STORE_THEIRS from `lane(0.70, 70)` to `lane(0.70, 78)`
 * and the yard from `lane(0.14, -34)` — which had NO ring-0 option at ANY offset
 * in its whole band — to `lane(0.22, 32)`. **All eight stations are ring 0 as
 * shipped, so `place()` returns every authored point untouched.**
 *
 * **THE ONE TO TWO METRES IN THE TABLE BELOW IS NOT A RING SEARCH, AND SAYING
 * SO IS THE DIFFERENCE BETWEEN A MEASUREMENT AND A GUESS.** `place()` hands back
 * the authored point and `spawnBuilding` then seats the FOOTPRINT on the 4 m
 * cell grid, so every landed centre is a multiple of two metres: the exchange
 * moves 2.00 m, the four stores 0.63, 1.50, 1.49 and 1.94, and the yard 2.00.
 * That is alignment rather than search — a ring-2 station would have moved
 * twelve — and it is why the counter discs stay centred on the authored points
 * while the landmarks stand a metre or two off them.
 *
 * `urban` AND `biome: 'urban'` ARE THE SAME WORD, which is the one pairing that
 * cannot make `reclamation.03.sold-twice`'s mistake: `MAP_PRESETS` and
 * `BiomeName` overlap on `temperate`, `snow` and `urban` and disagree on
 * exactly one name — the preset is `arid`, the biome is `desert` — and R3
 * shipped on the wrong side of that and measured two headers' worth of numbers
 * against ground it had not declared.
 *
 * ============================================================================
 * THE DISTRICT EXCHANGE STANDS ON THE MAP CENTRE, AND THAT IS WHY
 * `addStartOre` IS NOT CALLED
 * ============================================================================
 * `EXCHANGE` is `lane(0.50, 0)`, which on this diagonal pair is the map centre
 * to the metre — (256.00, 256.00) — and `addStartOre` lays its contested patch
 * on the CENTROID of the openings, which for two armies is exactly that point.
 * A radius-22 ore field on the counter would put both armies' haulers inside
 * the ground the operation's first primary is fought over. Every field here is
 * laid by hand instead, exactly as `reclamation-served-notice`,
 * `reclamation-payment-in-kind` and `reclamation-book-value` do.
 *
 * The two corner fields use `addStartOre`'s own geometry — 18 m along the line
 * to the centre, 44 m across it, radius 30 — taken as a normalised difference
 * rather than off `facingDeg` through `Math.sin`/`Math.cos`, which lands in the
 * same place for the same reason a start faces the middle of the map and is
 * exact under IEEE-754.
 *
 * ============================================================================
 * THE EXCHANGE IS SEAT 1's AND THE FOUR STORES ARE NOBODY'S, AND THAT
 * ASYMMETRY IS THE WHOLE COMPOSITION
 * ============================================================================
 * `civApartments` for all five — 800 hp, `ArmorClass.Concrete`, a 2 x 3 cell
 * footprint, so `hitRadius` is the half-diagonal `sqrt(4^2 + 6^2)` =
 * **7.211 m** — which is the def `reclamation.04.served-notice` puts the
 * district's record blocks in, `.05.closing-entry` uses for the counting house,
 * `.06.in-duplicate` for the bonded store and `.09.book-value` for the
 * valuation desk. It is this chapter's institutional building and this
 * operation places five of them.
 *
 * **THE EXCHANGE IS ON SEAT 1, so it can be shot at and it can be taken.**
 * `Targeting.isValidTarget` refuses only ALLIES, so an establishment-held
 * counter is a legal target for every gun the player owns — which is the
 * operation's central hazard rather than an oversight, because
 * `Capture.resolve` flips an enemy structure only at or below
 * `CAPTURE.captureHpFrac` 0.50 and a player who softens it with gunfire is
 * halfway to destroying the thing the endorsement has to be entered in. The
 * operation's own header prices both routes.
 *
 * **THE FOUR STORES ARE ON GAIA, AND THAT MAKES THEM UNTOUCHABLE WHILE THEY
 * BELONG TO NOBODY.** `ScenarioBuilder.gaia` sets both directions of `allyMask`
 * for the Neutral slot — *"Everyone is friends with the scenery, in both
 * directions"* — and `Targeting.isValidTarget` refuses ALLIES, so no gun on this
 * map can acquire a bonded store, the establishment's included. Measured on the
 * built world: a seat-1 `rhino` at 18 m of an unoccupied store acquires NOTHING
 * over three hundred ticks and leaves it at 800 hp.
 *
 * **THIS BLOCK USED TO READ "AND THAT MAKES THEM INDESTRUCTIBLE" AND THAT WAS
 * FALSE UNDER THE DEFAULT RIGHT-CLICK.** `GarrisonService.enter` calls
 * `captureService().captureBuilding()` directly for any Neutral-owned host —
 * bypassing `CaptureService.resolve` and therefore the operation's
 * `captureProof` veto — so one `rclPicker` walked into a store moves its owner
 * **2 -> 0** and its faction **Neutral -> Reclaim**, `areAllied(1, owner)` goes
 * **true -> false**, and the same rhino on the same cell takes it to **658.79 hp
 * in ten seconds**. `releaseEmptied` hands the deed back when the last man
 * leaves, so the exposure is exactly the occupancy. The operation prices that in
 * its `captureProof` block and Tallow says it out loud at fifty-eight seconds;
 * what the LAYOUT owes is not asserting the opposite.
 *
 * So it remains true that **the operation never asks the player to defend the
 * stores** — there is no such objective and there must not be one — and it is
 * true because a store nobody is standing inside cannot be hurt, not because
 * nothing can hurt one. What the establishment can do, and the only thing it
 * does, is make sure one of the four counters has nobody standing at it when the
 * endorsement is read. Its pickets attack-move ONTO the stores and never at
 * them.
 *
 * The stores are `captureProof` in the operation, for
 * `reclamation.06.in-duplicate`'s measured reason rather than for tidiness: a
 * neutral structure is taken OUTRIGHT at any health by one engineer
 * (`Capture.resolve` rule 1), and `resolveContextOrder`'s neutral branch is
 * guarded by `capturableNow` — so without the veto the single most natural
 * click in this operation, select a Tinker and right-click the store you were
 * told to stand in, spends the clerk and does not put him in the disc. With it,
 * the cursor never offers Capture and the order resolves to Move, which is
 * exactly what the `unitsInArea` threshold is waiting for.
 *
 * ============================================================================
 * WHERE THE FOUR STORES SIT, AND WHY THE NUMBERS ARE THE OPERATION
 * ============================================================================
 * Landed on the built world at (162, 240), (272, 346), (236, 170) and
 * (366, 268) — two on the company's side of the exchange and two on the
 * establishment's. Both `from` columns are measured from the DISC CENTRES, which
 * are the authored points and are what every threshold and every gate reads:
 *
 *     store              authored        from our corner   from the exchange
 *     ours       lane(0.34, -72)             149.7 m            96.85 m
 *     Allied     lane(0.38,  78)             166.2 m            90.43 m
 *     Meridian   lane(0.60, -78)             244.5 m            87.53 m
 *     theirs     lane(0.70,  78)             281.3 m           107.78 m
 *
 * and, between the discs themselves, **100.6 m at the closest pair (ours to the
 * Meridian's) and 204.5 m at the widest (ours to theirs)**. At an `rclTinker`'s
 * 3.5 m/s the closest pair is 28.7 seconds of straight-line walking apart, so
 * **no single hand can cover two counters**: the operation's second primary is
 * four bodies or nothing, and the four numbers above are what makes that true.
 *
 * **THE THIRD COLUMN IS A GATE RATHER THAN A NOTE.**
 * `tests/campaign-zone-safety.spec.ts` requires every player-seat
 * `unitsInArea` disc to sit further from a protected tag than
 * `r + envelope + hitRadius`, where the envelope is the longest reach the
 * PLAYER'S WHOLE ARMY can bring — not what the roster permits, because
 * `OperationRoster` is an allow-list over TAGGED defs and an untagged
 * long-range hull is buildable in every operation (trap 32). For the
 * Reclamation that is `rclSlaghurler` at range 42, so the envelope is
 * `42 x APPROACH_STOP_FRAC 0.80 + GUARD_LEASH 18` = **51.60 m of surface**, and
 * against the exchange's 7.211 m `hitRadius` the bar for a 20 m disc is
 * **78.81 m**, and the four measured distances are the third column above. The
 * Meridian counter clears by **8.72 m, which is one and a half `place()` ring
 * steps**. Anyone moving that offset is spending it.
 *
 * ============================================================================
 * WHERE THE PICKETS FORM UP
 * ============================================================================
 * `ROAD` = `lane(0.84, -14)`, landing at (347.65, 160.95) — **63.35 m out of
 * the establishment's gate**, past `BUILD_RADIUS` 56, and at ring 0 on this
 * roll, which is the one column `place()` cannot fix afterwards:
 * `EffectSink.spawnUnits` writes its computed ring points VERBATIM, with no
 * `connectedGround` and no egress search, so a `ROAD` at ring 3 is a picket
 * that starts the fight wedged.
 *
 * Straight-line distances from it to the authored stations: **106.7 m** to their
 * own store, **112.6 m** to the Meridian's, **132.0 m** to the exchange and
 * **243.8 m** to the company's yard. Over the real
 * `FlowFieldCache.costGridFor(MoveClass.Track)` those become **118.1, 157.7,
 * 155.8 and 271.6 m**, which SWAPS the exchange and the Meridian store — the
 * operation's header carries that correction, and its four pickets are ordered
 * by what is at stake rather than by distance.
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
 * `exchange` — the district exchange, on SEAT 1. Read as
 *   `structureCaptured('exchange', 0)` by both primaries, as `entityDead` by the
 *   loss that says the counter is gone and as `entityAlive` by the rout. Never
 *   as `ownerCount`, because the question is *whose is it* rather than *how many
 *   are there*.
 * `guard`   — the two posts the establishment put beside the exchange, on
 *   SEAT 1. Read as `ownerCount(1, 'building', 'guard', max: 0)` by `t.posts`,
 *   the beat that fires when the establishment has no post left on the counter
 *   — a COUNT rather than `entityDead`, because a captured post is not a dead
 *   one and capturing is a route the player has (trap 9). Declaring it also
 *   makes `tests/campaign-maps.spec.ts` verify the pair actually landed.
 * `store`   — the four bonded stores, on GAIA. Named by no `when` clause — the
 *   four discs read GROUND, not deeds — and named by `captureProof`, which
 *   `validateCampaign` checks against this list.
 * `yard`    — the last breaking yard the firm works on this road, on SEAT 0.
 *   Read as `ownerCount(0, 'building', 'yard', min: 1)` and its `max: 0`
 *   complement, which catches a sale and a demolition with one condition.
 * `picket`  — produced by `spawnUnits` in the trigger table, never by this file,
 *   and declared anyway so a reader asking where the pressure comes from finds
 *   the answer in the file that owns the ground.
 *
 * ============================================================================
 * WHAT THE BUILD ACTUALLY PRODUCES
 * ============================================================================
 * Built headless at `mapSeed` 13 627 / `simSeed` 22 014 on `biome: 'urban'` with
 * the def tables BOUND and this operation's roster INSTALLED — the same build
 * `tests/campaign-roster-ground.spec.ts` performs, and both halves are load
 * bearing: `spawnBuilding` hands `isBuildable` the RESOLVED def, and
 * `rosterAllows` answers TRUE for an undefined one, so a build without the
 * binding measures a different game in a way that looks like a pass.
 *
 *     seat 0   26 buildings   18 units      seat 1   28 buildings   13 units
 *
 *     seat 0   rclFoundry 1, rclBreakerYard 1, rclSorter 2, rclHeap 2,
 *              rclFurnace 5, rclRookery 1, rclSpotter 1, rclSpitpost 3,
 *              rclBarricade 10; rclGrinder 4, rclPicker 8, rclScrapper 3,
 *              rclSpitter 2, rclTinker 1
 *     seat 1   conyard, warFactory, refinery, barracks, radar, oreSilo 2,
 *              powerPlant 6, wall 10, flameTower 2, sentryGun 2,
 *              civApartments 1; conscript 6, rhino 5, harvester 2
 *     Gaia     civApartments 4 — the bonded stores
 *
 * **THE TWO `rclSpitter` ARE WHY `roster.player` NAMES `unit.raider`**, and the
 * single `rclTinker` is the seed of the capture ladder rather than the whole of
 * it: the operation's header prices four.
 *
 * `auditConnectivity`: **2 passable regions for a tracked hull; the main one
 * holds 12 532 of 12 598 cells (99.5%); 0 placements relocated; 0 entities
 * stranded; 0 structures on ground `isBuildable` refuses.** A separate flood of
 * the same grid taken after the build puts all NINE authored points — both
 * openings, the exchange, the four stores, the yard and the forming-up point —
 * in the SAME region, which is the statement that matters and which the
 * two-region line on its own does not make.
 *
 * **NO ORE FIGURE IS QUOTED, AND THAT IS DELIBERATE.** Nothing in this operation
 * is priced in credits — there is no `credits` condition and no `grantCredits`
 * anywhere in its trigger table — so an economy measurement would need a
 * twenty-two minute rig with a real `HarvesterController` and real
 * `OreField.regrow` behind it (trap 36) to answer a question the operation never
 * asks. Four fields are laid: one on each corner using `addStartOre`'s own
 * geometry at radius 30, one of radius 26 beside the outlying yard, and a second
 * of radius 24 for the establishment.
 *
 * **IT READS NO CLOCK, NO PROFILE AND NO DOM.** It runs inside the world build,
 * which is where the tick-zero desync lives: `Scenarios.ts` calls `isBuildable`
 * while spawning, and that answers from the LOCAL profile unless the
 * operation's roster is installed first. `campaign-install.ts` installs it
 * BEFORE the boot, so this gets the same world on every machine by
 * construction.
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
 * below is computed from. `10-without-recourse.ts` imports it into
 * `map.simSeed` rather than restating it.
 *
 * Chosen for the LAYOUT it draws rather than for the number: with two armies
 * and no sea, `seatedSlots` picks one of four pairs off `startPairFor(seed)`,
 * and 22 014 draws **[0, 1]** — the diagonal, 386.16 m of lane instead of an
 * edge pair's 296.00. Four counters a player must hold at one moment do not sit
 * at legible spacing on 296 m.
 */
export const SIM_SEED = 22_014;

/** The map centre. Every authored slot is an offset from it. */
const CENTRE = MAP_SIZE * 0.5;

/** An authored slot as a world point. `?? { dx: 0, dz: 0 }` is unreachable. */
function slotPoint(slot: number): Point {
  const o = SKIRMISH_START_OFFSETS[slot] ?? { dx: 0, dz: 0 };
  return { x: CENTRE + o.dx, z: CENTRE + o.dz };
}

const SLOTS = seatedSlots(2, SIM_SEED, null);
/** The company yard's corner. (108, 380) on the shipped pair. */
const HOME = slotPoint(SLOTS[0] ?? 0);
/** The establishment's compound. (404, 132), 386.16 m up the lane. */
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
 * The district exchange, on the map centre to the metre.
 *
 * Authored (256.00, 256.00) — ring 0 on the shipped roll, so `place()` returns
 * it untouched — and landed at **(258.00, 256.00)**, which is `spawnBuilding`
 * seating a 3 x 2 footprint on the 4 m cell grid rather than a ring search.
 *
 * **193.08 m from either authored opening**, which is the same number twice
 * because the exchange is the midpoint of the lane: neither house is nearer to
 * the counter than the other, which is the one property a district exchange has
 * to have and one more reason this operation is fought on a diagonal pair. (From
 * the LANDED centre it is 194.60 and 191.55 — the two-metre alignment spending
 * itself on one side of the lane, which is worth stating rather than rounding
 * away, because the symmetry is an argument and not a coincidence.)
 */
export const EXCHANGE: Point = lane(0.50, 0);

/**
 * The disc the briefing reveals, and nothing else reads it.
 *
 * 30 m, because the two posts land 18.44 and 17.09 m of centre distance from
 * the building on the built world, so one reveal frames the counter, both guns
 * and the ground a party would form up on to clear them. `revealArea` EXPLORES ground rather than
 * showing live units, so this draws the map and not an intelligence report.
 */
export const EXCHANGE_AREA: Area = { x: EXCHANGE.x, z: EXCHANGE.z, r: 30 };

/** The company's own bonded store. Authored `lane(0.34, -72)`, ring 0. */
export const STORE_OURS: Point = lane(0.34, -72);
/** The Allied house's. Authored `lane(0.38, 78)`, ring 0. */
export const STORE_ALLIED: Point = lane(0.38, 78);
/**
 * The Meridian house's, and the nearest of the four to the exchange at 87.53 m.
 *
 * That figure is the operation's tightest geometric margin — see the header's
 * zone-safety block, where 87.53 is measured against a bar of 78.81 — and it is
 * the reason this offset is `lane(0.60, -78)` rather than the `lane(0.62, -78)`
 * the first draft carried: 0.62 was not a ring-0 candidate on this roll and
 * would have cost twelve metres of `place()` search on the disc with the least
 * room to give.
 */
export const STORE_MERIDIAN: Point = lane(0.60, -78);
/**
 * The establishment's own, 139.7 m out of their own gate.
 *
 * The fourth copy is lodged in the store belonging to the house that does not
 * want it, in their own district, which is the operation's argument stated as a
 * coordinate. Authored `lane(0.70, 78)`, ring 0.
 */
export const STORE_THEIRS: Point = lane(0.70, 78);

/**
 * The four counters, as the discs the second primary is read over.
 *
 * **20 m, AND THE NUMBER IS BOUNDED FROM BOTH SIDES.** Below about 12 m a disc
 * is smaller than the store standing in it plus the spacing `Steering` gives a
 * squad, so a section ordered onto the counter would have men outside the
 * threshold while looking as though they were on it. Above 28.72 m it fails
 * `tests/campaign-zone-safety.spec.ts` against the exchange — the bar is
 * `r + 51.60 + 7.211` against the Meridian counter's measured 87.53 m. 20 sits
 * between them with 8.72 m of margin on the tight side.
 *
 * They double as the briefing's reveals. There is no fifth disc over the
 * company's own yard and there must not be: it is the player's own structure
 * with the sight radius of a refinery, and a reveal over ground the player
 * already holds shows nothing and reads as the briefing padding itself.
 */
export const COUNTER_OURS: Area = { x: STORE_OURS.x, z: STORE_OURS.z, r: 20 };
export const COUNTER_ALLIED: Area = { x: STORE_ALLIED.x, z: STORE_ALLIED.z, r: 20 };
export const COUNTER_MERIDIAN: Area = { x: STORE_MERIDIAN.x, z: STORE_MERIDIAN.z, r: 20 };
export const COUNTER_THEIRS: Area = { x: STORE_THEIRS.x, z: STORE_THEIRS.z, r: 20 };

/**
 * The last breaking yard the firm works on this road.
 *
 * `lane(0.22, 32)`, authored (193.67, 349.97) and landed at **(194, 348)** —
 * 91.8 m from the company's opening and 112.1 m from the landed exchange, so it
 * sits on the road between the two, and a picket sent at it walks **271.6 m**
 * over the real Track cost grid to get there.
 *
 * **THE WHOLE -OFF SIDE OF THIS BAND HAS NO RING-0 CELL ON THIS ROLL.** The
 * first draft put the yard at `lane(0.14, -34)`; sweeping four along-fractions
 * against five offsets from -56 to -32 returned NOTHING at ring 0, which is
 * exactly the case trap 33 is about — an authored coordinate is a request, and
 * `place()` answers a refused one by jumping to the next ring that has a legal
 * footprint rather than by moving a little. The yard is on the +off side
 * because that is where the ground is.
 */
export const YARD: Point = lane(0.22, 32);

/**
 * Where the establishment's pickets form up: **63.35 m out of their own gate**,
 * past `BUILD_RADIUS` 56, at ring 0.
 *
 * Straight-line 106.7 m to their own store, 112.6 to the Meridian's, 132.0 to
 * the exchange and 243.8 to the company's yard, which is the order the trigger
 * table sends the four pickets in. See the operation's header for the ring
 * check on every drop point, and note that **a change to any `count` or
 * `spread` invalidates it** — a wave of three does not stand where a wave of
 * two does.
 */
export const ROAD: Point = lane(0.84, -14);

/* ==========================================================================
 * 2. THE COMPOSITION
 * ========================================================================== */

/**
 * Metres searched outward for a legal footprint. Nearest first, integer rings.
 *
 * `findClearFootprint` ALONE IS NOT ENOUGH: it asks `footprintClear` (is
 * anything already there) and `connectedGround` (can an army reach it) and
 * NOTHING about grade, so `spawnBuilding` will plant a structure on a slope
 * `isBuildable` refuses and report success (trap 19). Both questions are asked
 * here and the shipped search is only the fallback — the same helper
 * `reclamation-book-value`, `reclamation-closing-entry`,
 * `reclamation-sold-twice`, `reclamation-held-paper` and
 * `reclamation-payment-in-kind` all carry, for the same reason.
 */
const PLACE_RINGS: readonly number[] = [0, 6, 12, 18, 26, 34];
/** Eight exact bearings. Integers only, so every candidate is bit-identical. */
const PLACE_BEARINGS: readonly (readonly [number, number])[] = [
  [1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
];
/** Ring zero is the nominal spot itself; the bearings would test it eight times. */
const ORIGIN_ONLY: readonly (readonly [number, number])[] = [[0, 0]];

/** Metres reserved around a bonded store, so its counter stays walkable. */
const STORE_CLEAR = 22;
/** Metres reserved around the district exchange. */
const EXCHANGE_CLEAR = 26;
/** Metres reserved around the outlying yard, so its apron and dock stay clear. */
const YARD_CLEAR = 30;
/** Radius of the ore field beside the outlying yard. */
const YARD_ORE = 26;
/** Metres from the yard to its own field, along the perpendicular. */
const YARD_ORE_OUT = 30;

export default layout({
  id: 'reclamation-without-recourse',
  tags: ['exchange', 'guard', 'store', 'yard', 'picket'],

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
        `[campaign] reclamation-without-recourse built on (${cx}, ${cz}), not the map centre `
        + `(${CENTRE}, ${CENTRE}) — every counter is authored in absolute coordinates and will `
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
     * whole district from the compound it was authored against, and nothing
     * downstream would notice.
     */
    if (Math.abs(home.x - HOME.x) > 2 || Math.abs(home.z - HOME.z) > 2
      || Math.abs(foeSpot.x - FOE.x) > 2 || Math.abs(foeSpot.z - FOE.z) > 2) {
      console.error(
        `[campaign] reclamation-without-recourse: startSpots gave (${home.x}, ${home.z}) and `
        + `(${foeSpot.x}, ${foeSpot.z}) against the raw corners (${HOME.x}, ${HOME.z}) and `
        + `(${FOE.x}, ${FOE.z}) — every exported point is derived from the RAW corners, so the `
        + 'district and the compound are no longer on the same map.',
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
     * 1. THE TWO BASES
     *
     * `opening: 'base'` on both seats, garrison included. The player has to
     * be able to MAKE the four hands the second primary counts — an
     * `rclTinker` is 500 credits out of a Rookery and a Sorter, both of
     * which this opening stands up — and a twenty-two minute operation
     * against an establishment that never mines is a backdrop rather than
     * an opponent.
     * ================================================================== */
    buildBaseFor(b, us, home.x, home.z, { facingDeg: wrapDeg(home.facingDeg + 180) });
    buildBaseFor(b, them, foeSpot.x, foeSpot.z, {
      facingDeg: wrapDeg(foeSpot.facingDeg + 180),
    });

    /* ==================================================================
     * 2. THE FOUR BONDED STORES
     *
     * PLACED FIRST of this file's own structures, because the four discs
     * are the operation and everything else gives way to them.
     *
     * `b.gaia` rather than a seat, and it is the reason the operation never
     * asks the player to defend one: `ScenarioBuilder.gaia` allies the
     * Neutral slot to everybody in both directions, and
     * `Targeting.isValidTarget` refuses allies, so no gun on this map can
     * acquire a store that is still nobody's. The establishment cannot burn
     * the register; it can only make sure nobody is standing at a counter
     * when the endorsement is read.
     *
     * WHAT GAIA DOES NOT BUY IS IMMUNITY TO THE PLAYER'S OWN CHOICES:
     * `Garrison.enter` flips a Neutral host's deed to whoever walks in, past
     * the `captureProof` veto, and a store with the company's flag on it is a
     * legal Soviet target. See the header — it is measured there, with its
     * control.
     * ================================================================== */
    for (const at of [STORE_OURS, STORE_ALLIED, STORE_MERIDIAN, STORE_THEIRS]) {
      const p = place(b.gaia, 'civApartments', at);
      const id: EntityId = b.spawnBuilding('civApartments', b.gaia, p.x, p.z, {
        yawDeg: yawTo(p, EXCHANGE),
      });
      c.tag('store', id);
      if (id !== NONE) b.block(p.x, p.z, STORE_CLEAR);
    }

    /* ==================================================================
     * 3. THE DISTRICT EXCHANGE, AND THE TWO POSTS ON IT
     *
     * SEAT 1, so it is a legal target for the player's own guns and a legal
     * capture for the player's own engineers, and both of those are the
     * operation. See the header.
     * ================================================================== */
    const exAt = place(them, 'civApartments', EXCHANGE);
    const exId = b.spawnBuilding('civApartments', them, exAt.x, exAt.z, {
      yawDeg: yawTo(exAt, HOME),
    });
    c.tag('exchange', exId);
    if (exId !== NONE) b.block(exAt.x, exAt.z, EXCHANGE_CLEAR);

    /*
     * `pillbox` is a ROLE key, so a change of `op.foe` still gets that army's
     * cheap emplacement — on a Soviet seat `keyFor` resolves it to the SENTRY
     * GUN, whose weapon is `pillboxMg`: 22 m, `power: 0` so no brownout opens
     * it, and `chainCount` 0, which is why
     * `tests/campaign-emplacement-reach.spec.ts` §2 is satisfied by the row
     * not chaining at all rather than by distance. They are in that spec's
     * scope on purpose: they cover the `exchange` tag they stand beside, and
     * covering the objective is what an emplacement is for.
     *
     * An emplacement rather than a hull because `AiBrain.census` files every
     * AI-owned mobile hull into `armyIds` and `regroupSquads` marches it to
     * the rally point inside four seconds. A layout cannot opt out of that.
     * Concrete can.
     */
    for (const side of [-1, 1]) {
      const g = place(them, 'pillbox', {
        x: exAt.x + LANE.px * side * 16 + LANE.nx * 10,
        z: exAt.z + LANE.pz * side * 16 + LANE.nz * 10,
      });
      const gid = b.spawnBuilding('pillbox', them, g.x, g.z, { yawDeg: yawTo(g, HOME) });
      c.tag('guard', gid);
      if (gid !== NONE) b.block(g.x, g.z, 10);
    }

    /* ==================================================================
     * 4. THE LAST YARD ON THIS ROAD
     *
     * `refinery` is a ROLE key, so `keyFor` gives this army its own —
     * `rclSorter`, 2 000 credits, `REFINERY_STORAGE` 2 000, -30 of grid —
     * and neither it nor `rclFurnace` carries an `UNLOCK_TAGS` id, so the
     * roster cannot refuse one. That matters here more than anywhere else
     * in the file: a refused `spawnBuilding` returns `NONE`, `c.tag`
     * ignores `NONE`, and the secondary would then be failed on tick one
     * over a yard that was never on the ground.
     *
     * `shipsWith` pays a free hauler when a refinery FINISHES BUILDING and a
     * scenario-placed structure arrives complete, so without the explicit
     * hauler the yard is a dock with nothing to dock at it.
     * ================================================================== */
    const yardAt = place(us, 'refinery', YARD);
    const yardYaw = yawTo(yardAt, EXCHANGE);
    const yardId: EntityId = b.spawnBuilding('refinery', us, yardAt.x, yardAt.z, {
      yawDeg: yardYaw,
    });
    c.tag('yard', yardId);
    if (yardId !== NONE) {
      b.block(yardAt.x, yardAt.z, YARD_CLEAR);

      const furnaceAt = place(us, 'powerPlant', {
        x: yardAt.x - LANE.nx * 18 + LANE.px * 14,
        z: yardAt.z - LANE.nz * 18 + LANE.pz * 14,
      });
      b.spawnBuilding('powerPlant', us, furnaceAt.x, furnaceAt.z, { yawDeg: yardYaw });

      b.spawnUnit('harvester', us, yardAt.x + LANE.px * 16, yardAt.z + LANE.pz * 16, {
        yawDeg: yardYaw, cargoFrac: 0.3,
      });

      b.addOre(
        yardAt.x - LANE.px * YARD_ORE_OUT,
        yardAt.z - LANE.pz * YARD_ORE_OUT,
        YARD_ORE,
      );
    }

    /* ==================================================================
     * 5. THE CLERKS ON THE COMPANY YARD
     *
     * Three Scrap Pickers facing the road, so the corner reads as staffed
     * rather than as a shed with a marker over it. `Stance.Defensive` is the
     * only stance that means "on post" — fire at anything in range, never
     * leave position to start a fight — and they are UNTAGGED, because the
     * four discs count GROUND rather than a named set and the trigger table
     * asks nothing else about this seat's units.
     * ================================================================== */
    b.formation('rclPicker', us, home.x + LANE.nx * 26, home.z + LANE.nz * 26, 3, {
      yawDeg: yawTo(home, FOE), spacing: 4.5, columns: 3, stance: Stance.Defensive,
    });

    /* ==================================================================
     * 6. ORE, DRESSING AND THE OPENING FRAME
     *
     * NOT `addStartOre`. See the header: on this pair the map centre is
     * `lane(0.50, 0)` exactly, which is where the exchange stands, so its
     * contested patch would sit on the counter both primaries are about.
     * Both corner fields use `addStartOre`'s own geometry, taken as a
     * normalised difference rather than off `facingDeg` through
     * `Math.sin`/`Math.cos`.
     * ================================================================== */
    for (const s of [home, foeSpot]) {
      const dx = cx - s.x;
      const dz = cz - s.z;
      const l = Math.max(1e-3, Math.sqrt(dx * dx + dz * dz));
      const nx = dx / l;
      const nz = dz / l;
      b.addOre(s.x + nx * 18 - nz * 44, s.z + nz * 18 + nx * 44, 30);
    }
    // A second field for the establishment, so their compound is not the only
    // thing between them and a stalled economy over twenty-two minutes.
    {
      const dx = cx - foeSpot.x;
      const dz = cz - foeSpot.z;
      const l = Math.max(1e-3, Math.sqrt(dx * dx + dz * dz));
      const nx = dx / l;
      const nz = dz / l;
      b.addOre(foeSpot.x + nx * 58 + nz * 40, foeSpot.z + nz * 58 - nx * 40, 24);
    }

    // The opening frame: the company corner with the haul road and the first
    // store beyond it, so the first thing on screen is the district the
    // afternoon is about. `Shell.applyCameraPostBoot` re-poses on `findHome`,
    // which finds the Foundry; this is what the headless and `?shot=` paths
    // read.
    b.setCameraFocus(
      home.x + (STORE_OURS.x - home.x) * 0.40,
      home.z + (STORE_OURS.z - home.z) * 0.40,
    );
    b.scatter({ minX: cx - 180, minZ: cz - 180, maxX: cx + 180, maxZ: cz + 180 }, 150);
    void start;
  },
});
