/**
 * ============================================================================
 * VOLTMARCH — src/campaign/layouts/allies-ground-truth.ts
 * ============================================================================
 * A3 — THE GROUND. A coast, two openings a hundred metres inland of it, and a
 * LEVELLING LINE running up the strand between them: a tide gauge at the
 * water's edge, two change points, and the benchmark the line closes on.
 *
 * ============================================================================
 * THE ONE THING THIS FILE EXISTS TO BUILD: A LINE, NOT A PLACE
 * ============================================================================
 * The operation's objective MOVES — Bramm works from station to station and the
 * win disc moves with her — so the layout's job is not to dress one objective.
 * It is to lay out FOUR lots on one bearing, at increasing distance from the
 * player and decreasing distance from the Pact, and to make each one cost more
 * than the last WITHOUT a wall, a gate or a scripted garrison.
 *
 * ============================================================================
 * MEASURED, ON THE WORLD THIS FILE ACTUALLY BUILDS
 * ============================================================================
 * Read off a headless build at `mapSeed` 20 260 910 / `simSeed` 7 028 — the
 * same build `tests/campaign-maps.spec.ts` performs — with the def tables BOUND
 * and this operation's roster IN FORCE, which is the only state in which either
 * is true. Positions are `store.posX/posZ` after `spawnBuilding` snapped each
 * footprint to the placement grid.
 *
 *     lot                     landed      to our yard  to Pact yard  posts  route
 *     tide gauge         (220.0, 380.0)      106.0 m      306.0 m      2     107 m
 *     first change point (316.0, 272.0)      230.0 m      162.6 m      3     245 m
 *     second change pt   (344.0, 224.0)      279.0 m      107.1 m      4     293 m
 *     the benchmark      (398.0, 212.0)      331.0 m       78.1 m      5     354 m
 *
 * **BOTH DISTANCE COLUMNS ARE TO THE CONSTRUCTION YARDS**, which land at
 * (114, 382) and (402, 134). They used to be to the START SPOTS (108, 380) and
 * (404, 132) under the words "straight" and "to Pact yard" — 112.0 / 234.4 /
 * 282.9 / 335.2 and 308.8 / 165.4 / 109.8 / 80.2, which is the whole of the
 * old table except the benchmark row. The spot and the yard are 6.32 m and
 * 2.83 m apart respectively; this same header already corrects exactly that
 * confusion for `RELIEF` further down, and the correction was applied to three
 * numbers and not to this table.
 *
 * The benchmark row moved for a second, independent reason: see `RELIEF`'s
 * block below on the faced-footprint snap, which put the station at (398, 212)
 * rather than the (400, 214) this table used to name.
 *
 * `route` is 8-connected octile Dijkstra over the real `Terrain.passGrid` for
 * `Locomotor.Track`, refusing any cell a structure occupies, from the nearest
 * free cell to the player's Construction Yard (8.0 m off it) to the nearest
 * free cell to each station (6.3 m off the first three, 6.0 m off the
 * benchmark). Descent and cheapest-predecessor chains agree on all four. It is
 * quoted BESIDE the straight line because the two differ by 1–7 % once the
 * buildings are standing, and a straight line across a coast is a claim about
 * ground nobody checked.
 *
 * **THE ESCALATION IS THE PACT'S OWN BASE, NOT THE POST COUNT.** Five Glaive
 * Posts is a fight; five Glaive Posts with the nearest Pact base structure
 * **45.1 m away** and their Construction Yard at 78.1 m is a different fight,
 * because everything that yard has built since the match began is standing
 * beside them. The post ladder (2/3/4/5) is a legibility device on top of that;
 * the real cost of being late is the last two columns of the table.
 *
 * The two openings, counted on the same build:
 *
 *     player   4 Warden Tanks, 5 G.I.s, 1 engineer, 2 harvesters
 *              24 structures — yard, refinery, war factory, barracks, radar,
 *              4 power plants, 2 silos, 3 Pillboxes, 10 wall segments
 *     Pact     4 Solarchs, 5 Wayfarers, 1 Artificer, 2 Collectors
 *              38 structures — 24 of base, of which 3 are its own Glaive
 *              Posts, plus the 14 this layout plants up the strand
 *
 * Both are two units and two structures lighter than the same build with the
 * roster cleared, which is what an empty allow-list costs and is measured
 * rather than assumed: the control run adds **2 Sabre IFVs, a Proving Ground
 * and a Refractor Tower** to the player and **2 Sandskiffs, a Reliquary and a
 * Helios Spire** to the Pact.
 *
 * ============================================================================
 * FOURTEEN POSTS DRAW 140 POWER, AND THE CHECK CAME BACK CLEAN
 * ============================================================================
 * `mrdGlaive` is `power: -10` and its own blurb reads *"Needs the grid."*
 * Fourteen of them is **-140** on a seat whose whole supply is one opening
 * base, and a structure that draws power and is dark cannot fire — the
 * UNIVERSAL tier of the blackout rule. `glaiveRepeater` ALSO carries
 * `WeaponDef.needsPower`, so these fourteen sit in the stricter tier as well
 * and fall silent on a deficit, not merely on a blackout. A watch line that
 * browns out the base that owns it is fourteen ornaments, and nothing anywhere
 * would say so.
 *
 * **MEASURED ON THE BUILT WORLD RATHER THAN ARGUED: the Pact opens at 640
 * produced against 340 consumed with all fourteen posts standing** — 200 of
 * that draw is its own base and 140 is this layout — so the line is lit off the
 * base's four Solar Arrays with 300 to spare and needs no supply of its own. An
 * earlier draft of this file planted two more `mrdSolarArray` up the coast to
 * guarantee it; they are deleted rather than left in, because a structure that
 * exists for a reason which turned out to be false is exactly the drift
 * `docs/SPEC_DRIFT_AUDIT.md` catalogues.
 *
 * The number is recorded because the failure it rules out is silent, and
 * because the margin is thinner than it looks: the same build with the roster
 * CLEARED draws 455 against the same 640, because a Reliquary and a Helios
 * Spire join the base. A heavier watch line, a cheaper opening base, or a
 * roster that hands the Pact its tech back all walk toward 640 — and the
 * fourteen posts are the part of that sum this file owns.
 *
 * ============================================================================
 * EVERY POINT IS DERIVED FROM TWO LITERALS, AND THE ARITHMETIC IS EXACT
 * ============================================================================
 * `HOME` and `FOE` are the two openings this operation's seeds produce. From
 * them the module builds an orthonormal frame — `along` runs from the player's
 * yard to the Pact's, `sea` runs toward the water — and every lot below is
 * authored in that frame and resolved to world metres at import.
 *
 * **NO `sin`, NO `cos`, NO `atan2` ON ANY POSITION.** ECMA-262 pins `+ - * /`
 * and `Math.sqrt` to bit precision and pins the transcendentals to nothing at
 * all; terrain and layout are built independently on both machines of a
 * lockstep match, so a position that went through a trig call is a tick-zero
 * desync waiting for two engines to round differently. `Math.sqrt`, never
 * `Math.hypot`, for the same reason — `allies-instrument-room` states it first.
 * Yaws are authored as literal degrees rather than computed from a bearing:
 * a yaw is cosmetic, but the cheapest way to keep the rule true is to have no
 * exception to it.
 *
 * **THE SEAWARD SIGN IS MEASURED, NOT ASSUMED.** `p = (-az, ax)` is the
 * left-hand perpendicular of the home-to-foe bearing and on this operation's
 * seeded pair that is seaward — but that is a property of which two slots
 * `seatedSlots` drew, not of the arithmetic. `build` checks it against
 * `ITerrain.isWater` and warns if it ever stops being true — **not
 * `ScenarioBuilder.isWater`, which answers `false` for every point on a map no
 * layout called `setShore` on, the middle of the sea included.**
 * `pact-shallow-road` established both the check and that trap, and paid a
 * whole build for the second one.
 *
 * ============================================================================
 * THE STATIONS ARE GAIA, THE GUNS ARE PACT, AND NOTHING MOBILE IS PLACED
 * ============================================================================
 * `civilian()` in `Scenarios.ts` builds every `civ*` row on the
 * `Faction.Neutral` seat, so the four stations are Gaia — allied to everybody,
 * shot at by nobody. That is the correct owner for a survey line neither army
 * put up and it removes a whole class of accident: no stray shell can delete
 * the objective, and no `ownerCount` anywhere has to exclude it.
 *
 * **NO SQUAD IS PARKED ANYWHERE.** `AiBrain.regroupSquads` files every hull an
 * AI seat owns into the strike group on its first pass and drives it to the
 * rally point; two Wardens parked on an objective in `soviets-common-standard`
 * were measured 127 m away, dead, having never stood on it. Emplacements
 * cannot be re-tasked, so every defence in this operation is a structure and
 * every mobile Pact force arrives from the trigger table at the tick it is
 * meant to.
 *
 * ============================================================================
 * TAGS
 * ============================================================================
 * Four tags, one per station, and **no trigger reads any of them.** They are
 * declared for the GROUND CHECK: `tests/campaign-maps.spec.ts` refuses a
 * declared tag that landed on nothing, so a station whose def key was wrong or
 * whose lot would not take a footprint fails the build rather than leaving a
 * win disc with nothing standing in it. A player told to reach a field station
 * and shown bare sand has been failed silently, and silently is the only way
 * that failure can happen — `unitsInArea` counts ground and does not care
 * whether the layout put anything on it.
 * ========================================================================== */

import { CELL } from '../../core/config';
import { worldToCell } from '../../core/math';
import { NONE } from '../../core/types';
import { addStartOre, buildBaseFor, islandSeats, startSpots, wrapDeg } from '../../game/Scenarios';
import type { EntityId, PlayerId } from '../../core/types';
import type { Area, Point } from '../types';
import { layout } from '../layout';

/* ==========================================================================
 * 1. THE FRAME
 * ========================================================================== */

/**
 * The player's opening at `mapSeed` 20 260 910 / `simSeed` 7 028.
 *
 * `seatedSlots(2, 7028, MAP_SEAS.tropical)` draws the pair **[0, 1]** — the
 * antipodal one, 386.16 m apart, with BOTH openings 100 m off the waterline.
 * On `tropical` only two pairs survive `dryPairs` and the other, [1, 3], puts
 * one opening 290 m inland: the coast would then run diagonally away from the
 * line instead of beside it, and every `sea` offset in this file would mean a
 * different distance at each end. `pact-shallow-road` needs the same pair for
 * the same reason and records the same arithmetic.
 *
 * These are literals rather than a call to `startSpots` because the OPERATION
 * file has to name the same points in static data — a `unitsInArea` disc is
 * authored in a trigger table, which can derive nothing. One module owns the
 * geometry and exports it; `operations/allies/03-ground-truth.ts` imports it.
 * A number written in two files is a number that will disagree the first time
 * either is tuned.
 *
 * **THE EXPOSURE THAT BUYS IS WORTH STATING.** `build` seats the two bases from
 * the real `startSpots`, so a generator change that slid an opening would move
 * the BASES and leave this line exactly where it is. The margins absorb a small
 * slide everywhere except at the far end: the benchmark is only 78.1 m from the
 * Pact's yard, so it is the lot a moved opening reaches first. `build` compares
 * the two and warns rather than letting them drift in silence.
 */
const HOME: Point = { x: 108, z: 380 };
/** The Pact's opening at the same seeds. */
const FOE: Point = { x: 404, z: 132 };

const DX = FOE.x - HOME.x;
const DZ = FOE.z - HOME.z;
/** 386.1606… m. `Math.sqrt` is bit-exact; `Math.hypot` is not specified to be. */
const LEN = Math.sqrt(DX * DX + DZ * DZ);
/** Unit vector, player's opening toward the Pact's. */
const AX = DX / LEN;
const AZ = DZ / LEN;
/** Its left-hand perpendicular, which at these seeds points at the water. */
const NX = -AZ;
const NZ = AX;

/** A lot, authored as (metres up the line, metres toward the water). */
function at(along: number, sea: number): Point {
  return { x: HOME.x + AX * along + NX * sea, z: HOME.z + AZ * along + NZ * sea };
}

/* ==========================================================================
 * 2. THE LINE
 *
 * Four lots on one bearing. The three station discs are 24 m and are centred on
 * the NOMINAL lots below rather than on where a station landed, so the gap that
 * decides overlap is the lot-to-lot one: **56.3 m and 53.7 m** against a 48 m
 * touching distance, so **no two discs overlap** — with 8.3 m and 5.7 m to
 * spare. (The stations themselves landed 55.6 m and 55.3 m apart, which is a
 * different pair of numbers and governs nothing.) A player standing in an
 * overlap would satisfy the next
 * window without moving, which would hand them a station they never walked to,
 * and there is no margin to spend: the second change point already sits at 34 m
 * of seaward offset because moving it further out closes that gap.
 * ========================================================================== */

/**
 * The tide gauge, where a levelling line starts and where the chart drum with
 * the old record still is.
 *
 * Lands at (220.0, 380.0): **106.0 m from the player's yard and 306.0 m from
 * the Pact's** (112.0 and 308.8 from the two START SPOTS, which is what this
 * comment used to quote under the word "yard"). It is on the player's own
 * strand and the only thing between them and it is the two-post picket. It
 * sits 51.6 m off the straight line from the start spot to the first change
 * point — 48.9 m off the line from the yard — and **the route that goes via it
 * is 12.7 m longer** — 1.9 s at a Warden's 6.6 m/s — which is exactly why
 * neither this file nor the
 * operation pretends the drum is a detour. It costs a fight, on the clock, and
 * the clock is all this operation charges for.
 */
export const GAUGE: Point = at(85, 70);

/** The disc the drum trigger counts. Two units, which is a detachment. */
export const GAUGE_YARD: Area = { x: GAUGE.x, z: GAUGE.z, r: 22 };

/** The first change point. Lands 230.0 m from our yard, 162.6 m from the Pact's, 3 posts. */
export const CHANGE_A: Point = at(228, 50);
/** The second. 279.0 m from our yard, 107.1 m from the Pact's, 4 posts. */
export const CHANGE_B: Point = at(282, 34);
/** The benchmark, where the line closes. 331.0 m from our yard, 78.1 m from the Pact's. */
export const BENCH: Point = at(330, 58);

/**
 * The three win discs.
 *
 * **24 m AND THREE UNITS, AND BOTH NUMBERS ARE BOUNDED BY SOMETHING.** 24 m is
 * wide enough that three hulls stand in it without `Movement.relax` pushing one
 * out, and narrow enough to mean "on the station" rather than "in the area".
 * Measured on the built world, with the stations and their posts standing and
 * every occupied cell refused, the three discs hold **109, 94 and 102 free
 * standable Track cells** — counting a cell in when its CENTRE falls inside
 * the disc, which puts 116, 110 and 113 cells in them geometrically, so the
 * discs are 94 %, 85 % and 90 % open. They are ground rather than scenery even
 * after the emplacements have eaten their share. (The geometric counts differ
 * between discs because a 24 m circle lands differently on a 4 m grid at each
 * centre; there is no single "maximum" to quote.) Three units rather than one
 * because a scout parked on a disc is not a
 * meeting, and rather than five because the column that gets there has been
 * shot at.
 *
 * The centres are the NOMINAL lots and the stations landed 1.1–2.3 m off them,
 * because `seat()` in `build` deliberately does not search for flatter ground.
 * See its header: the thing a trigger table names is the thing that must not
 * move.
 */
export const CHANGE_A_HOLD: Area = { x: CHANGE_A.x, z: CHANGE_A.z, r: 24 };
export const CHANGE_B_HOLD: Area = { x: CHANGE_B.x, z: CHANGE_B.z, r: 24 };
export const BENCH_HOLD: Area = { x: BENCH.x, z: BENCH.z, r: 24 };

/**
 * Where the Pact's escort comes up the coast road from.
 *
 * Lands at **(362.2, 169.6)**, abeam the benchmark and 56 m landward of it, on
 * the same lane the line is fought along. Three distances, every one
 * centre-to-centre and every one named for what it actually measures:
 *
 *     57.4 m   to the second change point's STATION AS IT LANDED (344.0, 224.0)
 *              — 57.7 m to its nominal lot, which is the other number and not
 *              this one
 *     55.5 m   to the benchmark's STATION AS IT LANDED (398.0, 212.0)
 *              — 56.0 m to its nominal lot. The station used to land at
 *              (400.0, 214.0) and this line used to read 58.3 m; `bb83ffb`
 *              made `ScenarioBuilder.spawnBuilding` snap on the FACED
 *              footprint, and `civApartments` is a 2x3 raised at a yaw that
 *              quantises to 90, so a non-square block at that yaw snaps on the
 *              swapped lattice and moves 2.83 m. The NOMINAL figure is
 *              untouched, which is the falsifier: the arithmetic was right and
 *              the ground moved under it.
 *     53.4 m   to the Pact's CONSTRUCTION YARD, the 3x3 at (402.0, 134.0)
 *              — the Pact's START SPOT is 56.2 m, and those are two different
 *              points. The previous version of this comment quoted the SEAT
 *              distance under the word "yard".
 *
 * So the wave arrives 57 m from one station and 58 m from the other, which is
 * as near to equidistant as this ground allows.
 *
 * **IT IS NO LONGER OUTSIDE THE BASE'S OWN SPRAWL, AND THAT SENTENCE USED TO
 * SAY IT WAS.** The nearest Pact structure is an `mrdRampart` at (378, 166),
 * **16.2 m** away, with three more of the row at 17.5, 19.6 and 22.2 m — so
 * the widest ring below reaches 5.8 m PAST the nearest of them. It read 37.0 m
 * when it was written and that was true then: `bb83ffb` moved the wall row
 * from local z -20 to -28 and took it from nine segments to ten, which walked
 * the sprawl into the relief point. The drops themselves are still on passable
 * ground — that is a different question and
 * `tests/campaign-spawn-ground.spec.ts` owns it — but a wave now arrives
 * inside the rampart line rather than clear of it. Spawning on the objective
 * reads as a cheat however correct the fiction is;
 * `soviets-deep-sector` says the same about its own approach.
 *
 * ============================================================================
 * THE RING IS THE THING TO MEASURE, AND IT IS NOT A DISC AND NOT A SAMPLE
 * ============================================================================
 * `EffectSink.spawnUnits` puts unit `i` of `count` at `angle = i / count * 2pi`
 * and radius `spread`, and `ProductionService.spawnUnit` writes that position
 * VERBATIM — no `findEgressSpot`, no search of any kind. So this point is not a
 * location, it is the centre of four rings at four fixed radii, and what has to
 * be true is true of **fourteen named points**, not of an average:
 *
 *     t.struck.a  mrdWayfarer x4 @20 m   bearings   0  90 180 270
 *     t.struck.a  mrdSolarch  x2 @14 m   bearings   0 180
 *     t.struck.b  mrdWayfarer x5 @22 m   bearings   0  72 144 216 288
 *     t.struck.b  mrdSolarch  x3 @15 m   bearings   0 120 240
 *
 * Measured on the built world through `ITerrain.isPassable`, with each wave's
 * own move class — `mrdWayfarer` is foot, `mrdSolarch` is HOVER, because the
 * Pact hovers and `spawnUnit` DECLARES that class rather than deriving it —
 * **all fourteen are passable, and the tightest of them has 8.25 m of clear
 * ground to the nearest cell it could not enter** (the Wayfarer at bearing 180
 * on the 20 m ring, (342.2, 169.6)). Two full cells of margin on the worst
 * point, and 9.3 m or better on the other thirteen.
 *
 * The widest ring is 22 m and it clears both win discs: **11.7 m** outside
 * `CHANGE_B_HOLD` and **10.0 m** outside `BENCH_HOLD`, both r=24 on the nominal
 * lots.
 *
 * ============================================================================
 * WHAT THIS REPLACED, BECAUSE THE ARGUMENT IS THE REUSABLE PART
 * ============================================================================
 * The point was `at(306, 6)` = (346.4, 188.1) and it was justified with *"8 of
 * 12 samples on an 18 m ring around it are free, which is the number that
 * matters"*. That sample reproduces exactly and describes nothing the engine
 * does: never 18 m, never twelve bearings. A north-south ridge three to four
 * cells wide ran through the western side of all four real rings, and **five of
 * the fourteen drops landed on it** — rock, not sea (`isWater` false,
 * `isBuildable` false at all five), 4.0–8.0 m from the nearest free cell:
 *
 *     t.struck.a  mrdWayfarer x4 @20   1 of 4 blocked   (326.4, 188.1)
 *     t.struck.a  mrdSolarch  x2 @14   1 of 2 blocked   (332.4, 188.1)
 *     t.struck.b  mrdWayfarer x5 @22   2 of 5 blocked
 *     t.struck.b  mrdSolarch  x3 @15   1 of 3 blocked
 *
 * Not fatal — `Movement` skips its wall slide when the cell a unit is STANDING
 * IN is already closed, naming "a spawn lands on a cliff" as the case, and
 * `Steering`'s pocket rescue is the backstop — but a third of each relief wave
 * started the fight unwedging itself, in an operation whose only currency is
 * seconds.
 *
 * **AND THE SAME SENTENCE'S OTHER CLAIM WAS FALSE FOR THE SAME REASON.** It
 * said the wave landed "outside both 24 m discs". The POINT was 36.9 m from
 * `CHANGE_B_HOLD`'s centre and the 22 m ring was not: its bearing-72 drop
 * landed **17.5 m from that centre, inside the player's own win disc**. A
 * radius measured from a centre is not a claim about a ring drawn around it.
 *
 * `tests/campaign-spawn-ground.spec.ts` is the general gate that now fails on
 * any of this by name, in every operation. **Move this point again and it will
 * tell you which drops broke — but the three distances above are prose, and
 * prose has no gate. Re-derive them in the same commit.**
 */
export const RELIEF: Point = at(330, 2);

/* ==========================================================================
 * 3. THE DEFENCES
 *
 * Offsets from the station they guard, in the same (along, sea) frame, and
 * **applied to where that station ACTUALLY LANDED rather than to its nominal
 * lot.** A gun line laid out around a building that moved to find flat ground
 * is a gun line with a hole in it that nobody authored;
 * `allies-instrument-room` states the rule and this is it applied to four
 * stations instead of one.
 *
 * Every offset is 15–19 m, i.e. inside the 24 m arc of `glaiveRepeater` — the
 * weapon a Glaive Post actually carries, which is what `keyFor` turns every
 * `pillbox` below into on a Meridian seat; `pillboxMg`'s 22 m is the ALLIED
 * post's reach and is not the number that binds here. So a post covers the
 * disc it stands beside rather than watching it from outside. Measured
 * after the placement search, the fourteen posts stand **6.3 to 22.8 m** from
 * their station, so **all fourteen are inside the 24 m arc** and thirteen would
 * still be inside a 22 m one — the exception is the tide gauge's western post,
 * which walked 7.3 m from its authored point to find buildable ground and now
 * covers the landward half of that yard rather than all of it. The largest
 * walk any post made is 12.3 m, at the benchmark. That is the drift a six-ring
 * search can produce and it is quoted rather than designed away; the gauge is
 * the one lot where it does not matter, since nothing there is a win
 * condition.
 * ========================================================================== */

type Offset = readonly [along: number, sea: number];

const GAUGE_GUNS: readonly Offset[] = [[-4, -15], [12, -9]];

const A_GUNS: readonly Offset[] = [[-15, -10], [15, -10], [0, 15]];

const B_GUNS: readonly Offset[] = [[-15, -10], [15, -10], [0, 16], [0, -17]];

const C_GUNS: readonly Offset[] = [[-16, -10], [16, -10], [0, -18], [-17, 6], [17, -2]];

/** Metres reserved around a station so `scatter` leaves its lot walkable. */
const STATION_CLEAR = 26;
/** Metres reserved around an emplacement. */
const GUN_CLEAR = 12;

/**
 * Cells a POST searches outward for ground it can legally stand on. Six is
 * 24 m and the worst drift it actually produced on this roll is 12.3 m; the
 * closest two posts belonging to DIFFERENT stations ended up 29.1 m apart, so
 * no station's gun ring reached into its neighbour's. Overlap is impossible in
 * any case — the search tests `footprintClear` — so what a wider budget would
 * cost is a post that reads as belonging to the wrong station, not a stack.
 *
 * Stations do not use it at all — see `seat` in `build`.
 */
const PLACE_RINGS = 6;

/* ==========================================================================
 * 4. THE BUILD
 * ========================================================================== */

export default layout({
  id: 'allies-ground-truth',
  tags: ['gauge', 'changeA', 'changeB', 'bench'],

  build(b, cx, cz, start, c) {
    const spots = startSpots(cx, cz, b.armies, b.sea, b.seed);
    const seats = islandSeats(spots, b.sea);

    /*
     * NO `rotateStarts`. An operation pins its seed, so the rotation has
     * exactly one value and taking it would make every coordinate in this file
     * depend on `startOffset` for no variety at all — `allies-instrument-room`
     * makes the argument in full. The player opens at `seats[0]`, always, and
     * `HOME` above is where that lands.
     */
    const player: PlayerId = c.seat(0);
    const pact: PlayerId = c.seat(1);
    const home = seats[0];
    const foe = seats[1] ?? seats[0];

    /*
     * TWO CHECKS THAT COST NOTHING AND CATCH THE TWO WAYS THIS FILE GOES WRONG
     * IN SILENCE.
     *
     * FIRST, THE OPENINGS. `HOME` and `FOE` above are literals because the
     * trigger table needs the same points as static data, and `build` seats the
     * bases from the real `startSpots`. If a generator change ever slides an
     * opening the two stop describing one world — the bases move and the
     * levelling line does not — and the benchmark, 78.1 m off the Pact's yard,
     * is the lot with the least room to absorb it. Four metres is one cell.
     *
     * SECOND, THE SEAWARD SIGN. Every `sea` offset in this file is positive and
     * means "toward the water". That is true because `seatedSlots` drew the
     * [0, 1] pair; it is not true of the arithmetic, and a change that swapped
     * the pair would build the whole line inland.
     *
     * **ASKED OF THE TERRAIN, NOT OF THE BUILDER.** `ScenarioBuilder.isWater`
     * reads `this.shore`, which is the `ShoreSpec` a layout DECLARED through
     * `setShore`; a layout that never calls it gets `shore === null` and the
     * method answers `false` for every point on the map, the middle of the sea
     * included. `pact-shallow-road` paid a whole build to find that out. 140 m
     * clears the +98..+104 waterline with margin either side of the coastal
     * wander.
     */
    if (Math.abs(home.x - HOME.x) > 4 || Math.abs(home.z - HOME.z) > 4
      || Math.abs(foe.x - FOE.x) > 4 || Math.abs(foe.z - FOE.z) > 4) {
      console.warn(
        `[allies-ground-truth] openings moved: player (${String(home.x)}, ${String(home.z)}) `
        + `and foe (${String(foe.x)}, ${String(foe.z)}) against the authored (${String(HOME.x)}, `
        + `${String(HOME.z)}) and (${String(FOE.x)}, ${String(FOE.z)}). Every lot in this layout `
        + 'and every disc in the operation is measured against the authored pair — re-measure.',
      );
    }
    if (!b.world.terrain.isWater(
      worldToCell(HOME.x + NX * 140), worldToCell(HOME.z + NZ * 140),
    )) {
      console.warn(
        '[allies-ground-truth] the seaward perpendicular is dry 140 m out — the seated pair '
        + 'has changed and every lot in this layout is now on the wrong side of the line.',
      );
    }

    /* -- placement -------------------------------------------------------- */
    const scratch = new Float32Array(2);
    /**
     * Ground a footprint can legally stand on: clear AND `footprintBuildable`,
     * searched in rings with a fixed traversal order so two runs of one seed
     * build the same coast.
     *
     * `findClearFootprint` alone answers the WRONG QUESTION — it tests
     * occupancy and connectivity and nothing about grade — which is how
     * `soviets-first-tap` came to ship seven structures on ground `isBuildable`
     * refuses. This is `allies-instrument-room`'s repair, copied deliberately
     * rather than re-derived.
     */
    const place = (owner: PlayerId, key: string, p: Point): Point => {
      const f = b.footprintOf(b.keyFor(owner, key));
      for (let ring = 0; ring <= PLACE_RINGS; ring++) {
        for (let oz = -ring; oz <= ring; oz++) {
          for (let ox = -ring; ox <= ring; ox++) {
            if (ring > 0 && Math.abs(ox) !== ring && Math.abs(oz) !== ring) continue;
            const tx = p.x + ox * CELL;
            const tz = p.z + oz * CELL;
            if (!b.footprintClear(tx, tz, f.w, f.h)) continue;
            if (!b.footprintBuildable(tx, tz, f.w, f.h)) continue;
            return { x: tx, z: tz };
          }
        }
      }
      if (b.findClearFootprint(p.x, p.z, f.w, f.h, scratch)) {
        return { x: scratch[0], z: scratch[1] };
      }
      return p;
    };

    /**
     * A STATION IS SEATED ON ITS OWN LOT AND IS NOT SEARCHED FOR FLAT GROUND,
     * AND THAT IS THE OPPOSITE RULE FROM THE ONE ABOVE.
     *
     * The three win conditions are `unitsInArea` discs centred on these four
     * literals, authored in a trigger table that can derive nothing. **AND
     * THIS IS MEASURED RATHER THAN FEARED: an earlier draft ran the stations
     * through `place` above and the benchmark landed 11.2 m from its own disc
     * centre, with the second change point 7.8 m off** — winnable, wrong, and
     * invisible to every gate. Seated on their own lots they land 1.1 to 2.3 m
     * off, which is footprint snapping and nothing else.
     *
     * Occupancy is still respected, because two structures on one cell is a
     * relocation nobody controls; grade is not, because a field station bedded
     * into a slope is only ugly. The build audit reports **2 structures on
     * ground `isBuildable` refuses** and names the second change point's tower
     * first — that is this rule's whole cost, and it is the trade
     * `soviets-deep-sector` makes for its wall, in the other direction and for
     * the same reason: the thing that must not move, does not move.
     */
    const seat = (owner: PlayerId, key: string, p: Point): Point => {
      const f = b.footprintOf(b.keyFor(owner, key));
      if (b.footprintClear(p.x, p.z, f.w, f.h)) return p;
      if (b.findClearFootprint(p.x, p.z, f.w, f.h, scratch)) {
        return { x: scratch[0], z: scratch[1] };
      }
      return p;
    };

    const raise = (
      owner: PlayerId, key: string, where: Point, tag: string | null, yawDeg: number, clear: number,
    ): EntityId => {
      const id = b.spawnBuilding(key, owner, where.x, where.z, { yawDeg });
      if (tag !== null) c.tag(tag, id);
      if (id !== NONE) b.block(where.x, where.z, clear);
      return id;
    };

    /** A station, then the posts around WHERE IT ENDED UP. */
    const station = (
      key: string, nominal: Point, tag: string, yawDeg: number, guns: readonly Offset[],
    ): void => {
      const where = seat(b.gaia, key, nominal);
      raise(b.gaia, key, where, tag, yawDeg, STATION_CLEAR);
      for (const [along, sea] of guns) {
        const p = { x: where.x + AX * along + NX * sea, z: where.z + AZ * along + NZ * sea };
        raise(pact, 'pillbox', place(pact, 'pillbox', p), null, 0, GUN_CLEAR);
      }
    };

    /* ==================================================================
     * 4.1 THE TWO OPENINGS
     *
     * Both garrisoned. The player's opening force is the whole of the first
     * window — there is no staging post in this operation and no scripted
     * column, because the decision it owns is whether to spend the opening
     * force NOW, and a force already parked half way there would have made
     * two thirds of that decision for the player.
     * ================================================================== */
    buildBaseFor(b, player, home.x, home.z, { facingDeg: wrapDeg(home.facingDeg + 180) });
    buildBaseFor(b, pact, foe.x, foe.z, { facingDeg: wrapDeg(foe.facingDeg + 180) });

    /* ==================================================================
     * 4.2 THE TIDE GAUGE
     *
     * `civOreMine` — a headframe over a shaft, which is what a stilling well
     * with a float in it looks like from the gameplay dolly, and the only one
     * of the four civilian silhouettes that reads as a thing sunk into the
     * ground at the water's edge rather than a place people live.
     * ================================================================== */
    station('civOreMine', GAUGE, 'gauge', 30, GAUGE_GUNS);

    /* ==================================================================
     * 4.3 THE LINE
     *
     * `civOilDerrick` for the change points — a 13 m lattice tower is what an
     * instrument stand reads as at this distance — and `civApartments` for the
     * benchmark, because the line CLOSES there and a field station is a
     * building somebody works in. Three silhouettes for three different jobs,
     * so a player told "the benchmark" can pick it out from the two towers.
     *
     * `pillbox` goes through `keyFor`, so on a Meridian seat every one of
     * these is a Glaive Post. The emplacement is a role here, not a model.
     * ================================================================== */
    station('civOilDerrick', CHANGE_A, 'changeA', 0, A_GUNS);
    station('civOilDerrick', CHANGE_B, 'changeB', 120, B_GUNS);
    station('civApartments', BENCH, 'bench', 90, C_GUNS);

    /* ==================================================================
     * 4.4 ECONOMY AND DRESSING
     * ================================================================== */

    /*
     * `addStartOre` AND NOTHING ELSE, WHICH IS A DECISION AND NOT A DEFAULT.
     *
     * It lays a home field beside each opening and ONE contested patch on the
     * midpoint of the lane — which at these seeds is 193.1 m up the line and
     * 0.0 m off it, i.e. squarely on the road the whole operation is fought
     * along. A second authored field would put the player's expansion inside
     * the sector they are supposed to be crossing rather than holding, and the
     * one thing this operation must never reward is stopping.
     */
    addStartOre(b, spots, b.sea);

    /*
     * NO `addCivilians`, AND THE REASON IS THE STATIONS.
     *
     * It hangs capturable `civOilDerrick`s off the perpendicular bisector of
     * the two openings — the same lattice tower this layout has already spent
     * on the two change points, dropped in the middle of the map where the
     * objective is not. A player told to reach a tower and shown five towers
     * has been lied to by the ground.
     */

    // Open on the player's own base. The first question a race asks is whether
    // to leave, and that is not a question anybody can answer looking at the
    // thing they would be leaving for.
    b.setCameraFocus(home.x, home.z - 8);
    b.scatter({ minX: cx - 150, minZ: cz - 150, maxX: cx + 150, maxZ: cz + 150 }, 150);
    void start;
  },
});
