/**
 * ============================================================================
 * VOLTMARCH — src/campaign/layouts/reclamation-closing-entry.ts
 * ============================================================================
 * R5 — THE GROUND. Survey 41-207 again, which is the industrial belt
 * `reclamation-held-paper` opens the chapter on: same `mapSeed`, same `simSeed`,
 * same heightfield, same two corners. The player held four scattered lots there
 * and no base. A week and four operations later they have a yard on it, a
 * counting house forward of the yard, two working yards further out that keep
 * their own ledgers, and a Meridian forward assay two hundred and seventy-nine
 * metres up the sidings road.
 *
 * ============================================================================
 * EVERY EXPORTED POINT IS ARITHMETIC, AND THE ONE MEASUREMENT THAT MAKES THAT
 * SAFE IS AT THE TOP OF `build`
 * ============================================================================
 * `reclamation-served-notice` is the precedent and its header carries the
 * argument: `SIM_SEED` lives HERE, `05-closing-entry.ts` imports it into
 * `map.simSeed` rather than restating it, and every point below is computed from
 * it at module load out of `seatedSlots`, `SKIRMISH_START_OFFSETS` and
 * `MAP_SIZE`. A number written in two files is a number that will disagree the
 * first time either is tuned, and the failure — a reveal framing empty ground, a
 * column landing where nobody authored one — is invisible to every gate.
 *
 * **THE HAZARD IS THAT THE RAW CORNER AND THE BUILT CORNER ARE NOT THE SAME
 * QUANTITY, AND IT IS MEASURED RATHER THAN ASSUMED.** `startSpots` runs
 * `nudgeToBuildable` over the authored offsets, so what the layout is handed can
 * differ from `CENTRE + SKIRMISH_START_OFFSETS[slot]` — and every point in this
 * file is derived from the RAW corner. Measured INSIDE the build, before a
 * single footprint is marked, at this operation's seeds:
 *
 *     startSpots  (108.00, 380.00) f=129.96     (404.00, 132.00) f=-50.04
 *     raw slots   (108, 380)                    (404, 132)
 *
 * — identical, to two decimals, on both corners. `build` re-checks it every time
 * and `console.error`s if it ever stops being true, because the alternative is a
 * silent offset between the composition and the ground.
 *
 * **AND THE CHECK HAS TO BE TAKEN INSIDE THE BUILD, WHICH IS THE TRAP
 * `reclamation-sold-twice` PAID FOR.** `nudgeToBuildable` scores
 * `terrain.isBuildable`, which is FALSE on a cell a structure already occupies,
 * so calling `startSpots` AFTER the world is built reports openings that were
 * never used. The first pass at this file read (376.29, 148.00) for the Meridian
 * corner that way — 31.6 m of pure artefact — and briefly moved the whole
 * right-hand side of the map to chase it.
 *
 * On the shipped pair the two openings are `hypot(296, 248)` = **386.16 m**
 * apart, and every lot below is `lane(along, off)`: a fraction of that line from
 * the player's corner, plus metres along its left-hand perpendicular.
 *
 * ============================================================================
 * WHAT THE BUILD ACTUALLY PUT DOWN
 * ============================================================================
 * Built headless at `mapSeed` 41 207 / `simSeed` 6 412 on `biome: 'urban'`, with
 * the def tables BOUND and the operation's roster INSTALLED — the only state in
 * which the allow-list is in force, and the state
 * `tests/campaign-roster-ground.spec.ts` builds in:
 *
 *     seat 0  Tallow's yard    29 buildings   19 units   power 480 / 320  +160
 *     seat 1  the district     27 buildings   14 units   power 640 / 315  +325
 *
 *     Foundry     110, 378     counting house  168, 286     Number Two  190, 380
 *     Conclave    402, 134     forward assay   348, 232     Number Six  302, 284
 *     the two Glaive Posts     334, 226  and  350, 254
 *
 * Seat 0's opening, by key: `rclFoundry` x1, `rclBreakerYard` x1, `rclRookery`
 * x1, `rclSorter` x3, `rclFurnace` x6, `rclHeap` x2, `rclSpotter` x1,
 * `rclSpitpost` x3, `rclPylon` x1, `rclBarricade` x9, `civApartments` x1;
 * `rclGrinder` x4, `rclSpitter` x2, `rclPicker` x8, `rclScrapper` x4,
 * `rclTinker` x1. Seat 1's: `mrdConclave`, `mrdForgeyard`, `mrdChapterhouse`,
 * `mrdCistern`, `mrdSolarArray` x4, `mrdVault` x2, `mrdOculus` x2,
 * `mrdGlaive` x5, `mrdHelios` x1, `mrdRampart` x9; `mrdSolarch` x4,
 * `mrdSkiff` x2, `mrdWayfarer` x5, `mrdCollector` x2, `mrdArtificer` x1.
 *
 * **THE SINGLE `rclTinker` AND THE SINGLE `mrdArtificer` ARE BOTH LOAD-BEARING
 * AND NEITHER IS THIS FILE'S** — `buildAlliedGarrison` hands each side one
 * engineer. The player's is a quarter of the price of taking the assay by
 * capture; the Pact's is the reason `OperationDef.captureProof` is not a
 * well-spelled no-op. Both are argued in `05-closing-entry.ts`.
 *
 * `auditConnectivity`: 2 passable regions for a tracked hull, the main one
 * holding **12 085 of 12 136 cells (99.6%)**; 5 placements relocated, worst
 * 16.7 m; **0 entities stranded, 0 structures on ground `isBuildable`
 * refuses.** The same build with the two bases and NOTHING ELSE reports 0
 * relocations, so all five are this file's own eight placements being walked by
 * `spawnBuilding`'s `connectedGround` — and every one of the four TAGGED
 * structures still lands within **2.08 m** of its authored point, which is one
 * grid snap on each axis rather than a search. Nothing in the trigger table
 * reads a structure's coordinate; it reads tags.
 *
 * **THE 51-CELL SECOND REGION IS PRE-EXISTING GROUND AND NOT THIS FILE'S.** It
 * is there with only the two bases standing, it is 0.4% of the walkable map, and
 * no lot, no spawn ring and no ore field is in it.
 *
 * ============================================================================
 * THE COUNTING HOUSE IS A `civApartments`, AND TWO FLAG BITS ARE WHY
 * ============================================================================
 * 800 hp, `ArmorClass.Concrete`, an 8 x 12 m footprint, owned by SEAT 0. It is
 * the same structure `reclamation-served-notice` uses for the district's record
 * blocks, the other way round: R4 sends a party to destroy the Allies' books and
 * R5 defends the Reclamation's. That is deliberate rather than convenient — the
 * chapter's last two operations are the same building and opposite verbs.
 *
 * **IT CANNOT BE SOLD, AND THAT IS THE HALF THE OPERATION RESTS ON.**
 * `Scenarios.civilian()` composes its flags as `STRUCTURE & ~EntityFlag
 * .Sellable` and the `civApartments` DEF row sets no flags of its own, so
 * `spawnBuilding`'s `fb.flags | (def?.flags ?? 0)` never restores the bit. The
 * operation's second primary is a bank threshold at the close and its authored
 * escape hatch is selling plant at `SELL_REFUND` 0.5 — so a counting house that
 * could be sold would be a player liquidating the objective for 300 credits and
 * a defeat. **The plant is for sale and the account is not**, expressed in a
 * flag bit rather than in dialogue.
 *
 * **IT IS ALSO A STRONGPOINT, AND NOTHING HOSTILE CAN GET INTO IT.**
 * `GarrisonService.refusalFor` accepts a structure with no weapons, both
 * footprint axes at two cells or more and none of
 * `IsBuilder|IsFactory|IsRefinery|IsRadar` — which `civApartments` was authored
 * to satisfy — so the PLAYER may garrison their own records block and fire out
 * of it. `GarrisonService.enter` returns `'hostile'` for a structure its player
 * is not allied to, so the Pact cannot; and `OperationDef.captureProof` names
 * `house`, so an engineer cannot either. Three doors, three answers, and only
 * the player's is open.
 *
 * It stands at `lane(0.28, -34)` — **108.76 m from the Foundry** on the built
 * world, i.e. 53 m beyond the yard's own `BUILD_RADIUS` 56, and 279.03 m from
 * the Conclave. Its `store.radius` is `max(2, 3) * CELL * 0.5` = 6 m, so
 * `Placement.withinBuildRadius` gives the lot `PLACEMENT.adjacencyRadius` 20 + 6
 * = **26 m of build space**, which is the whole reason a player can fortify a
 * lot a hundred metres from home. That mechanism is `reclamation-written-off`'s
 * — a captured mine head turning a field into somewhere you may build — pointed
 * at defence instead of at economy.
 *
 * ============================================================================
 * THE TWO OUTLYING YARDS ARE ONE STRUCTURE DOING TWO JOBS
 * ============================================================================
 * A yard's ledger is kept where the work is, so the `ledger` tag is on the Ore
 * Sorter itself rather than on a shed beside it. One structure, two meanings:
 * losing it costs a ledger in the fiction and, in the simulation, costs a dock,
 * a short haul and 2000 of storage ceiling. **The trigger table never has to
 * make a reader believe the two are connected, because they are the same
 * entity.**
 *
 *     Number Two   lane(0.16, 52) -> (190, 380)    80.02 m from the Foundry
 *     Number Six   lane(0.54, 52) -> (302, 284)   213.78 m from the Foundry,
 *                                                 180.28 m from the Conclave
 *
 * **NUMBER SIX IS 33.50 m NEARER THE PACT THAN IT IS TO YOU**, and that is a
 * property of where the two shelves are rather than of anything this file chose:
 * both corners are fixed by `SKIRMISH_START_OFFSETS` and no `mapSeed` moves
 * them. It is the lot the operation exists to let the player give up, and Number
 * Two — inside the reach of everything they own — is what makes the comparison
 * legible.
 *
 * Each yard carries a `rclFurnace` beside it, so it is self-sufficient: +80
 * against the Sorter's -30 is **+50 of net grid each**, and the pair is 100 of
 * the player's measured +160. A player who lets both go is at +60 and one Arc
 * Pylon (-90) from a brownout. Each also carries a `rclScrapper`, because a
 * scenario-placed refinery never FINISHES building and `shipsWith` only pays its
 * free hauler on completion — without it the yard is a dock with nothing to dock
 * at it, which is `reclamation-held-paper`'s note about its own Sorter.
 *
 * ============================================================================
 * THE FORWARD ASSAY, AND WHY IT IS A REAL PACT STRUCTURE
 * ============================================================================
 * `radar` role key — `mrdOculus`, 650 hp, `power: -40` — at `lane(0.72, 40)`,
 * measured 111.89 m from the Conclave and 187.93 m from the counting house. It
 * is the Pact's second book: the operation's hidden secondary is to take it off
 * them, and the chapter's blurb ("the only complete account") is what that makes
 * literally true.
 *
 * A ROLE KEY rather than a def name, so the composition stays legible if
 * `op.foe` ever moves, and untagged in `UNLOCK_TAGS`, so no roster can refuse
 * it — which matters more here than anywhere else in this file: a refused
 * `spawnBuilding` returns `NONE`, `c.tag` ignores `NONE`, and
 * `ownerCount(1, ..., 'tally', max: 0)` would then read TRUE the moment the
 * settle guard expires and pay 700 credits for a structure nobody touched.
 *
 * Two `mrdGlaive` stand on it, 18 m across the lane and 12 m back. They are
 * emplacements and not hulls for the rule `campaign-maps.spec.ts` pins:
 * `AiBrain.census` files every AI-owned mobile hull into `armyIds` and
 * `regroupSquads` marches it to the rally point inside four seconds. A layout
 * cannot opt out of that. Concrete can.
 *
 * **`mrdGlaive` DRAWS POWER AND R4's PILLBOXES DID NOT, AND THAT BUYS NOTHING
 * HERE EITHER.** `reclamation.01.held-paper` measured, at length, why a power
 * raid cannot silence an opponent's defences in this engine: `PowerGrid` is per
 * PLAYER, `shed` runs only when `consumed > produced`, and
 * `AI_ECONOMY.powerHeadroom` 40 is the FIRST thing `AiBrain.chooseBuild`
 * considers. Seat 1 opens at **+325** with four `mrdSolarArray` at 160 apiece
 * for 350 credits — the cheapest power in the game — so the deficit needed to
 * darken two Glaive Posts is not reachable and would be repaired inside a minute
 * if it were. **Nothing in this operation asks the player to try**, and this
 * paragraph exists so nobody re-derives R1's wall in a different army's costume.
 *
 * ============================================================================
 * WHERE THE WORKINGS FORM UP
 * ============================================================================
 * `ROAD` = `lane(0.78, -32)` -> (318.3, 162.0): **88.2 m out of the Conclave's
 * gate**, comfortably past `BUILD_RADIUS` 56, 194.9 m short of the counting
 * house and 123.1 m short of Number Six. A column that has formed and is about
 * to leave, rather than an army materialising inside a defended lot.
 *
 * **`EffectSink.spawnUnits` DOES NOT SEARCH FOR STANDABLE GROUND**, and it lays
 * a wave on an exact RING of radius `spread` rather than scattering inside one:
 * `ProductionService.spawnUnit` clamps to the map, reads `heightAt` and
 * allocates, and asks nothing. So every drop of every wave was checked against
 * `ITerrain.isPassable` for that wave's own move class on the built world. Six
 * calls, nineteen drops, four distinct rings, all open:
 *
 *     mrdWayfarer x4  r=12  Foot    clearances 4.0 / 12.0 / 4.0 / 5.4 m
 *     mrdSolarch  x2  r=18  Hover              20.4 / 10.5
 *     mrdSolarch  x3  r=18  Hover               4.4 / 17.9 / 4.9
 *     mrdSkiff    x3  r=14  Hover               4.4 / 13.9 / 4.3
 *
 * The Foot ring is the binding one — every Pact HULL is `Locomotor.Hover`, which
 * pays no slope cost — and the worst clearance anywhere is 4.0 m. `ROAD` was
 * chosen by sweeping the lane frame at 2 m and 0.0025 of the lane, keeping only
 * points where all nineteen drops are open, and taking the best clearance inside
 * 64 to 96 m of the Conclave: 68 candidates cleared it. **The first `ROAD`
 * authored here — 74 m out of the gate on the line to the counting house, which
 * is `reclamation-served-notice`'s own construction — failed SEVEN of the
 * nineteen**, so the sweep is not ceremony: a point that reads correct in the
 * fiction is not a point the ground accepts.
 * `tests/campaign-spawn-ground.spec.ts` is the standing gate, and **a change to
 * any count or spread needs a fresh check**, because the bearings are
 * `i / count * 2pi` and a wave of three does not stand where a wave of four
 * does.
 *
 * ============================================================================
 * NO `addStartOre`, NO `addCivilians`, AND BOTH REFUSALS ARE ABOUT THIS MAP
 * ============================================================================
 * `addStartOre` lays its contested patch on the CENTROID of the openings, which
 * for two armies is the map centre — 93.0 m from the counting house and 53.9 m
 * from Number Six's lot, so its radius-22 field would sit close enough to put
 * harvesters on an objective and far enough to help neither. The ore is laid by
 * hand instead: one radius-30 home field per seat on that helper's own bearing
 * (18 m along the line to the centre, 44 m across it), one radius-22 contested
 * patch on the centre, and a radius-26 field beside each outlying yard on the
 * side away from the middle, so neither yard's field merges with the contested
 * one.
 *
 * **HOW MUCH ORE AN `urban` ROLL ACTUALLY SEEDS IS MEASURED NOW.** This
 * paragraph used to say it was not, and called it the number `05-closing-entry`
 * was least sure of — which mattered, because that file's whole second primary
 * is an income model. `OreField` seeds at `Phase.Cleanup`, after this build
 * returns, and it skips road carriageway, so on a preset carrying `urban` 0.95
 * — the highest in the roster — the thinning is real rather than a rounding.
 * Driven through the real `OreField.seedField` with `economy.system.ts`'s own
 * accept function (`isWater`, `isPassable(Track)`, `RoadNetwork.isCarriageway`)
 * over a real `RoadNetwork` built on this operation's `mapSeed`:
 *
 *     home field        150, 402   r30    95 cells   19 672 credits
 *     Number Two's      169, 357   r26    68 cells   14 108
 *     Number Six's      321, 309   r26    92 cells   18 095
 *     contested patch   256, 256   r22    67 cells   14 195
 *     the Pact's home   362, 110   r30   140 cells   28 910
 *                                       ---------   ------
 *                                        462 cells   94 980
 *
 * **51 875 of that is private to the player** before the contested patch is
 * touched, against 35 700 of gross income over the operation's seventeen
 * minutes. Every field seeded — none was rejected — so the carriageway
 * exclusion costs cells rather than a field, and the ore outlasts the clock by
 * half again on the player's own ground. `reclamation-held-paper` places three
 * fields on this same heightfield the same way and still does not measure it.
 *
 * `addCivilians` is refused for a sharper reason than usual: it places
 * `civOilDerrick`, `civHospital` and **`civApartments`** in two hamlets on the
 * lane's bisector. This operation's PRIMARY is a `civApartments`. A player told
 * to defend a records block and shown four more identical ones, two of them
 * capturable neutral income, is a player the layout has lied to.
 *
 * ============================================================================
 * NO TRIGONOMETRY, NO `rotateStarts`
 * ============================================================================
 * Every offset here is an authored integer and the one bearing that is not — the
 * lane's unit vector — is a difference over a `Math.sqrt`. ECMA-262 pins
 * `+ - * /` and `Math.sqrt` and pins neither `sin` nor `cos`; a layout runs
 * independently on both machines of a lockstep match, so a table rotated by an
 * angle is a tick-zero desync waiting for two engines to disagree in the last
 * mantissa bit. `Math.atan2` appears once, in `yawTo`, and its result is the
 * rotation of a model that nothing reads back.
 *
 * `rotateStarts` is not called, for `reclamation-held-paper`'s reason: an
 * operation pins its seed, so the rotation is a moving part with exactly one
 * value — a coin flipped once at authoring time deciding whether every measured
 * coordinate here belongs to the player or to the Pact. Seat `i` takes slot `i`.
 *
 * ============================================================================
 * TAGS
 * ============================================================================
 * `house`  — the counting house. `ownerCount(0, 'building', …)`, so it reads 1
 *   at t = 0 and 0 when it is lost. Named by `captureProof`.
 * `ledger` — the two outlying Ore Sorters. Same shape, and the count is what
 *   `t.yardLost` and `t.yardsGone` price. Named by `captureProof`.
 * `tally`  — the Meridian forward assay. Read as `ownerCount(1, …, max: 0)` and
 *   NEVER as `entityDead`, because a captured structure is still alive. It is a
 *   BUILDING on an AI seat, which is what `campaign-maps.spec.ts` requires of
 *   anything a trigger treats as a fixed feature of the ground.
 * `guard`  — the two Glaive Posts. Named by no trigger; declared so that
 *   `campaign-maps.spec.ts` verifies both actually landed, which is the only
 *   automatic check the raid measurements above have.
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
 * below is computed from. `05-closing-entry.ts` imports it into `map.simSeed`
 * rather than restating it.
 *
 * **6 412 IS `reclamation.01.held-paper`'s, AND SO IS THE `mapSeed` THAT FILE
 * OWNS.** Together they make this the same heightfield, the same reserved
 * shelves and the same two corners the chapter opened on — Survey 41-207, one
 * week later. `seatedSlots(2, 6412, null)` draws **[0, 1]**, the diagonal
 * layout, which puts the two openings 386.16 m apart instead of an edge pair's
 * 296.00 and leaves room for three lots between them.
 */
export const SIM_SEED = 6_412;

/** The map centre. Every authored slot is an offset from it. */
const CENTRE = MAP_SIZE * 0.5;

/** An authored slot as a world point. `?? { dx: 0, dz: 0 }` is unreachable. */
function slotPoint(slot: number): Point {
  const o = SKIRMISH_START_OFFSETS[slot] ?? { dx: 0, dz: 0 };
  return { x: CENTRE + o.dx, z: CENTRE + o.dz };
}

const SLOTS = seatedSlots(2, SIM_SEED, null);
/** Tallow's yard. (108, 380) on the shipped pair. */
const HOME = slotPoint(SLOTS[0] ?? 0);
/** The Meridian district. (404, 132), 386.16 m up the lane. */
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
 * The counting house: five of the nine ledgers, and the primary.
 *
 * Landed at (168, 286) — 108.76 m from the Foundry, 53 m past its
 * `BUILD_RADIUS`, and 279.03 m from the Conclave. Read by the trigger table as
 * the `orderTagged` target for the second and third workings.
 */
export const HOUSE: Point = lane(0.28, -34);

/** Number Two's yard. Landed at (190, 380), 80.02 m from the Foundry. */
export const LEDGER_TWO: Point = lane(0.16, 52);

/**
 * Number Six's yard, and the lot the operation is written to let the player let
 * go. Landed at (302, 284): 213.78 m from the Foundry against 180.28 m from the
 * Conclave, so it is **33.50 m nearer the army coming for it**.
 */
export const LEDGER_SIX: Point = lane(0.54, 52);

/** The Meridian forward assay. Landed at (348, 232), 111.89 m from the Conclave. */
export const TALLY: Point = lane(0.72, 40);

/**
 * The assay as a disc, for `revealArea`.
 *
 * 46 m rather than the post's own footprint, so the reveal covers the assay, the
 * two Glaive Posts 15.2 m and 22.1 m off it, and the ground a raid would form up
 * on. `revealArea` EXPLORES rather than showing live units, so this is the map
 * being drawn and not an intelligence report.
 */
export const TALLY_AREA: Area = { x: TALLY.x, z: TALLY.z, r: 46 };

/**
 * Where the district's workings form up: 88.2 m out of the Conclave's gate,
 * 194.9 m short of the counting house, 123.1 m short of Number Six.
 *
 * All nineteen drops of the four rings fired here are standable, worst
 * clearance 4.0 m. See the header for the sweep that chose it and for why a change to any
 * `count` or `spread` invalidates the check.
 */
export const ROAD: Point = lane(0.78, -32);

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
 * `reclamation-sold-twice` and `reclamation-held-paper` both carry, and for the
 * same reason: these lots are what the player has to build defences on.
 */
const PLACE_RINGS: readonly number[] = [0, 6, 12, 18, 26, 34];
/** Eight exact bearings. Integers only, so every candidate is bit-identical. */
const PLACE_BEARINGS: readonly (readonly [number, number])[] = [
  [1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
];
/** Ring zero is the nominal spot itself; the bearings would test it eight times. */
const ORIGIN_ONLY: readonly (readonly [number, number])[] = [[0, 0]];

/** Metres reserved around the counting house so `scatter` leaves the lot legible. */
const HOUSE_CLEAR = 30;
/** Metres reserved around an outlying yard, so the dock apron stays walkable. */
const YARD_CLEAR = 30;
/** Metres reserved around the assay post. */
const ASSAY_CLEAR = 26;
/** Radius of the ore field beside each outlying yard. */
const YARD_ORE = 26;
/** Metres from a yard to its own field, along the perpendicular. */
const YARD_ORE_OUT = 30;

export default layout({
  id: 'reclamation-closing-entry',
  tags: ['house', 'ledger', 'tally', 'guard', 'column'],

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
        `[campaign] reclamation-closing-entry built on (${cx}, ${cz}), not the map centre `
        + `(${CENTRE}, ${CENTRE}) — every lot is authored in absolute coordinates and will not `
        + 'line up with the ground this build lays down.',
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
     * whole composition from the bases it was authored against, and nothing
     * downstream would notice.
     */
    if (Math.abs(home.x - HOME.x) > 2 || Math.abs(home.z - HOME.z) > 2
      || Math.abs(foeSpot.x - FOE.x) > 2 || Math.abs(foeSpot.z - FOE.z) > 2) {
      console.error(
        `[campaign] reclamation-closing-entry: startSpots gave (${home.x}, ${home.z}) and `
        + `(${foeSpot.x}, ${foeSpot.z}) against the raw corners (${HOME.x}, ${HOME.z}) and `
        + `(${FOE.x}, ${FOE.z}) — every exported point is derived from the RAW corners, so the `
        + 'composition and the bases are no longer on the same map.',
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
     * back, and no offset in this layout is derived from an angle. See the
     * header.
     */
    const yawTo = (from: Point, to: Point): number => wrapDeg(
      Math.atan2(to.x - from.x, to.z - from.z) * (180 / Math.PI),
    );

    /* ==================================================================
     * 1. THE TWO BASES
     *
     * `opening: 'base'` on both seats, garrison included — the operation is
     * about what a player SPENDS, so they need the thing that spends, and a
     * seventeen-minute defend against an opponent that never mines is a
     * backdrop rather than a threat.
     * ================================================================== */
    buildBaseFor(b, us, home.x, home.z, { facingDeg: wrapDeg(home.facingDeg + 180) });
    buildBaseFor(b, them, foeSpot.x, foeSpot.z, {
      facingDeg: wrapDeg(foeSpot.facingDeg + 180),
    });

    /* ==================================================================
     * 2. THE COUNTING HOUSE
     *
     * PLACED FIRST of this file's own structures, because it is the primary
     * and everything else gives way to it. `civApartments` carries no
     * `UNLOCK_TAGS` id, so no roster can refuse it — which matters more here
     * than anywhere else: a refused `spawnBuilding` returns `NONE`, `c.tag`
     * ignores `NONE`, and the operation's win condition would read zero from
     * the moment its settle guard expires.
     * ================================================================== */
    const houseAt = place(us, 'civApartments', HOUSE);
    const houseId: EntityId = b.spawnBuilding('civApartments', us, houseAt.x, houseAt.z, {
      yawDeg: yawTo(houseAt, FOE),
    });
    c.tag('house', houseId);
    if (houseId !== NONE) b.block(houseAt.x, houseAt.z, HOUSE_CLEAR);

    /*
     * The clerks. Three Scrap Pickers on the lot facing the lane, so the
     * counting house reads as a staffed office rather than a shed with a
     * marker over it. `Stance.Defensive` is the only stance that means "on
     * post" — fire at anything in range, never leave position to start a
     * fight — and they are UNTAGGED, because the trigger table's only question
     * about this lot is who owns the building.
     */
    b.formation('rclPicker', us, houseAt.x - LANE.nx * 14, houseAt.z - LANE.nz * 14, 3, {
      yawDeg: yawTo(houseAt, FOE), spacing: 4.5, columns: 3, stance: Stance.Defensive,
    });

    /* ==================================================================
     * 3. THE TWO OUTLYING YARDS
     *
     * Sorter, Furnace, Scrapjaw and a field, twice. The `ledger` tag goes on
     * the SORTER — see the header — and the Furnace and the hauler are
     * untagged, so `ownerCount(0, 'building', 'ledger')` answers "how many
     * yards are still ours" and nothing else.
     *
     * `refinery` and `powerPlant` are ROLE keys, so `keyFor` gives this army
     * its own; neither carries an `UNLOCK_TAGS` id, so the roster cannot
     * refuse them.
     * ================================================================== */
    const yards: readonly { at: Point; oreSide: number }[] = [
      // Number Two: its field between the yard and home, clear of the base's own.
      { at: LEDGER_TWO, oreSide: -1 },
      // Number Six: its field on the far side, so it does not merge with the
      // contested patch on the map centre.
      { at: LEDGER_SIX, oreSide: 1 },
    ];
    for (const yard of yards) {
      const sorterAt = place(us, 'refinery', yard.at);
      const yaw = yawTo(sorterAt, FOE);
      const id = b.spawnBuilding('refinery', us, sorterAt.x, sorterAt.z, { yawDeg: yaw });
      c.tag('ledger', id);
      if (id === NONE) continue;
      b.block(sorterAt.x, sorterAt.z, YARD_CLEAR);

      // Its own power. +80 against the Sorter's -30 is +50 of net grid per
      // yard, and the pair is 100 of the player's measured +160.
      const furnaceAt = place(us, 'powerPlant', {
        x: sorterAt.x - LANE.nx * 18 + LANE.px * 14,
        z: sorterAt.z - LANE.nz * 18 + LANE.pz * 14,
      });
      b.spawnBuilding('powerPlant', us, furnaceAt.x, furnaceAt.z, { yawDeg: yaw });

      // `shipsWith` pays a free hauler when a refinery FINISHES BUILDING, and a
      // scenario-placed structure arrives complete — so without this the yard
      // is a dock with nothing to dock at it. Cargo part full, because a yard
      // that has been running all morning has a hauler in the middle of a haul.
      b.spawnUnit('harvester', us, sorterAt.x + LANE.px * 16, sorterAt.z + LANE.pz * 16, {
        yawDeg: yaw, cargoFrac: 0.3,
      });

      b.addOre(
        sorterAt.x + LANE.px * yard.oreSide * YARD_ORE_OUT,
        sorterAt.z + LANE.pz * yard.oreSide * YARD_ORE_OUT,
        YARD_ORE,
      );
    }

    /* ==================================================================
     * 4. THE MERIDIAN FORWARD ASSAY
     *
     * The hidden secondary, and the only thing on this map the operation
     * wants CAPTURED as readily as broken — which is why `captureProof` names
     * `house` and `ledger` and deliberately not `tally`.
     * ================================================================== */
    const assayAt = place(them, 'radar', TALLY);
    const assayYaw = yawTo(assayAt, HOME);
    const assayId = b.spawnBuilding('radar', them, assayAt.x, assayAt.z, { yawDeg: assayYaw });
    c.tag('tally', assayId);
    if (assayId !== NONE) b.block(assayAt.x, assayAt.z, ASSAY_CLEAR);

    for (const side of [-1, 1]) {
      const g = place(them, 'pillbox', {
        x: assayAt.x + LANE.px * side * 18 - LANE.nx * 12,
        z: assayAt.z + LANE.pz * side * 18 - LANE.nz * 12,
      });
      const gid = b.spawnBuilding('pillbox', them, g.x, g.z, { yawDeg: assayYaw });
      c.tag('guard', gid);
      if (gid !== NONE) b.block(g.x, g.z, 10);
    }

    /* ==================================================================
     * 5. ORE, DRESSING AND THE OPENING FRAME
     *
     * NOT `addStartOre` and NOT `addCivilians`. See the header: the first
     * would put its contested patch 53.9 m from Number Six's lot, and the
     * second places `civApartments` — which is this operation's primary.
     *
     * The home fields use `addStartOre`'s own geometry (18 m along the line to
     * the centre, 44 m across it, radius 30), taken as a normalised difference
     * rather than off `facingDeg` through `Math.sin`/`Math.cos`, which lands in
     * the same place for the same reason a start faces the middle of the map
     * and is exact under IEEE-754.
     * ================================================================== */
    for (const s of [home, foeSpot]) {
      const dx = cx - s.x;
      const dz = cz - s.z;
      const l = Math.max(1e-3, Math.sqrt(dx * dx + dz * dz));
      const nx = dx / l;
      const nz = dz / l;
      b.addOre(s.x + nx * 18 - nz * 44, s.z + nz * 18 + nx * 44, 30);
    }
    // The contested patch, on the map centre: 193.08 m from both openings by
    // construction, 93.0 m from the counting house, and touching neither lot.
    b.addOre(cx, cz, 22);

    // The opening frame: the yard with the counting house beyond it and the
    // sidings road past that, so the first thing on screen is the direction the
    // operation goes. `Shell.applyCameraPostBoot` re-poses on `findHome`, which
    // finds the Foundry; this is what the headless and `?shot=` paths read.
    b.setCameraFocus(
      home.x + (HOUSE.x - home.x) * 0.35,
      home.z + (HOUSE.z - home.z) * 0.35,
    );
    b.scatter({ minX: cx - 180, minZ: cz - 180, maxX: cx + 180, maxZ: cz + 180 }, 150);
    void start;
  },
});
