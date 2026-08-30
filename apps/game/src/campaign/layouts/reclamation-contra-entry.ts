/**
 * ============================================================================
 * VOLTMARCH — src/campaign/layouts/reclamation-contra-entry.ts
 * ============================================================================
 * R8 — THE GROUND. Survey 27-884, a Reclamation breaking yard on the district
 * road: the yard itself at one corner, three ore stacks on its forward apron,
 * four Slaghurlers standing in the lot pen, the district weighbridge half way
 * up the road with two Meridian pickets either side of it, and a Meridian
 * establishment at the far corner.
 *
 * `reclamation.08.contra-entry` is the day a claim comes back the other way
 * along the account, and the whole composition is one sentence: the money is
 * standing in the pen, the counter is 146.80 m up the road, and everything in
 * between belongs to the party being paid.
 *
 * ============================================================================
 * EVERY EXPORTED POINT IS ARITHMETIC, AND THE ONE MEASUREMENT THAT MAKES THAT
 * SAFE IS AT THE TOP OF `build`
 * ============================================================================
 * `reclamation-served-notice`, `reclamation-closing-entry` and
 * `reclamation-payment-in-kind` are the precedents and they carry the argument:
 * `SIM_SEED` lives HERE, `08-contra-entry.ts` imports it into `map.simSeed`
 * rather than restating it, and every point below is computed from it at module
 * load out of `seatedSlots`, `SKIRMISH_START_OFFSETS` and `MAP_SIZE`. A number
 * written in two files is a number that will disagree the first time either is
 * tuned, and the failure — a counting apron framing open country, a working
 * forming up inside the establishment it was meant to leave — is invisible to
 * every gate.
 *
 * **THE RAW CORNER AND THE BUILT CORNER ARE NOT THE SAME QUANTITY, AND IT IS
 * MEASURED RATHER THAN ASSUMED.** `startSpots` runs `nudgeToBuildable` over the
 * authored offsets, so what the layout is handed can differ from
 * `CENTRE + SKIRMISH_START_OFFSETS[slot]` — and every point in this file is
 * derived from the RAW corner. Measured INSIDE the build, before a single
 * footprint is marked, at this operation's seeds:
 *
 *     startSpots  (404.00, 380.00)      (108.00, 132.00)
 *     raw slots   (404, 380)            (108, 132)
 *
 * — identical, to two decimals, on both corners. `build` re-checks it every
 * time and `console.error`s if it ever stops being true, because the
 * alternative is a silent offset between the composition and the ground. Taken
 * INSIDE the build for `reclamation-sold-twice`'s reason: `nudgeToBuildable`
 * scores `terrain.isBuildable`, which is FALSE on a cell a structure already
 * occupies, so calling `startSpots` after the world is built reports openings
 * that were never used.
 *
 * `seatedSlots(2, 12907, null)` draws **[2, 3]** — the diagonal, `hypot(296,
 * 248)` = **386.16 m** of road rather than an edge pair's 296.00, and the OTHER
 * diagonal from `reclamation-payment-in-kind`'s [0, 1], so the yard sits at the
 * corner R7's establishment did. Every point below is `lane(along, off)`: a
 * fraction of that line from the player's corner, plus metres along its
 * left-hand perpendicular.
 *
 * ============================================================================
 * THE SEED WAS SWEPT FOR THE CORRIDOR, BECAUSE THE CORRIDOR IS THE OPERATION
 * ============================================================================
 * Twelve MAP SEEDS, none of them one this chapter already stands on, each
 * scored on bare terrain at the fixed `simSeed` 12 907 by asking
 * `ITerrain.isPassable(_, _, Locomotor.Wheel)` at 1100 points — the whole
 * approach from `lane(0.06)` to `lane(0.94)` in steps of 0.004, five abreast at
 * off −16, −8, 0, +8, +16 — because the primary is four wheeled hulls walking
 * that band under fire:
 *
 *     27 884   56 blocked      8 806   72        63 517   81
 *     61 004   91              44 090  94        16 275   99
 *      3 162   98             21 330  101        12 004  105
 *     47 615  120             55 401  138        30 918  183
 *
 * **27 884 IS THE LEAST BROKEN OF THE TWELVE at 5.1%**, and that is a screen on
 * the LANDFORM rather than a claim about the route: it is taken before a single
 * structure is placed, so it says nothing about what the two bases and the
 * pickets do to it. What the road actually costs is measured further down, on
 * the built world, with the engine's own grid.
 *
 * `urban` because a breaking yard is a yard district and because it is the
 * flattest preset in the roster (`relief` 0.14, `cliffs` 0.10) — this operation
 * needs six hand-placed structures buildable, a lot pen four wheeled hulls can
 * stand in, and a 386 m corridor open, all at once.
 * `reclamation.05.closing-entry` and `reclamation.06.in-duplicate` are on it and
 * `reclamation.07.payment-in-kind` is temperate, so this is the second of a pair
 * rather than the third of a run, which is the thing R7's layout refused.
 *
 * ============================================================================
 * THE FOUR LOTS ARE THE MONEY, AND THE ROSTER IS WHAT MAKES THEM SCARCE
 * ============================================================================
 * Four `rclSlaghurler` on SEAT 0, tagged `lot`, spawned `Stance.Defensive`.
 *
 * **THE STANCE IS LOAD-BEARING RATHER THAN TIDY.**
 * `ScenarioBuilder.spawnUnit` writes `options.stance ?? Stance.Aggressive` and
 * `STANCE_CHASE_METRES` is `[GUARD_LEASH 18, 0, 0, 0]` indexed by `Stance`, so
 * an Aggressive lot standing on the counting apron has eighteen metres of reason
 * to walk off it and `Targeting.holdPost` will take them. Defensive is zero: it
 * fires back and does not move, which is what a forty-five second hold needs.
 *
 * **AND THE ROSTER IS WHY THERE ARE FOUR RATHER THAN AS MANY AS THE PLAYER CAN
 * AFFORD.** `rclSlaghurler` carries `unit.specialist`, so `roster.player` MUST
 * list it or `isBuildable` refuses all four in silence, `c.tag` is handed `NONE`
 * four times, and the operation's own primary counts an empty tag forever. What
 * the list does NOT carry is `struct.tech`: `rclCrucible` does not stand and
 * cannot be raised, and a Slaghurler's prereqs are
 * `['rclBreakerYard', 'rclCrucible']`. Measured against an unrostered control
 * build of this same layout, the roster removes `rclCrucible` and `rclPylon`
 * from seat 0 and `mrdReliquary`, `mrdHelios` and two `mrdSkiff` from seat 1.
 *
 * ============================================================================
 * THE THREE STACKS, AND WHAT THEY ARE WORTH TO WHOEVER HOLDS THEM
 * ============================================================================
 * `civOreMine` — **700 hp, `ArmorClass.Concrete`, a 2x2 footprint, `power: 0`,
 * `Faction.Neutral` in the def table** and therefore carrying no `unlockedBy`,
 * so no roster can refuse one and `keyFor` does not remap it. Owned by SEAT 0,
 * which is the difference between this file and
 * `reclamation-payment-in-kind`'s three: there the same def is the objective and
 * the Works hold it; here it is the yard's income and the player does.
 *
 * `CIVILIAN_MINE_INCOME` pays its holder **5 credits every 30 ticks**, and
 * `src/data/Civilians.ts` prices that against the MEASURED harvester rather than
 * the intended one: 300 credits a minute is 0.57 of a real harvester's 525.
 * Three stacks are **900 a minute, 18 000 over `parSec` 1200**, or 1.71
 * harvesters of unmined income — which is why the secondary is worth a medal and
 * why the Meridian recovery party is pointed at them rather than at the yard.
 *
 * They land at (380, 332), (360, 344) and (344, 300) — 23.32, 46.82 and 48.17 m
 * apart, and 46.71 / 25.51 / 43.70 m from the lot pen. Two on the apron and one
 * on the forward stand, 133.64 m from the counter and the cheapest of the three
 * for a working coming up the road to reach.
 *
 * ============================================================================
 * THE COUNTING APRON IS QUIET IN BOTH DIRECTIONS
 * ============================================================================
 * `COUNTER_AREA` is a 20 m disc on the district weighbridge and the operation
 * asks the player to hold three hulls inside it for forty-five seconds, so the
 * ground has to be standable and it has to be out of everybody's envelope.
 *
 * The weigh house is a `civHospital` — 1100 hp, 3x2 — and it is **GAIA**, which
 * is the one ownership decision in this file that is not decoration.
 * `Targeting.isValidTarget` refuses only ALLIES and `ScenarioBuilder.gaia` sets
 * both directions of `allyMask` for the Neutral slot, so three parked
 * Slaghurlers will not open fire on the office they are reporting to. On seat 1
 * they would; on seat 0 the player would have been handed a building for free.
 * It lands at (218, 252), **1.56 m off the disc centre**, so the disc is an
 * annulus around it: of the 81 cells whose centres fall inside the radius,
 * **75 are routable**, for `Foot` and `Wheel` alike.
 *
 * **BOTH ENVELOPES, AND THE SECOND IS THE ONE AUTHORS FORGET.** `Combat.engage`
 * gates on `max(0, flat - hitRadius(target))` and
 * `COMBAT_TARGETING.acquireRangeMul` is 1.08, so an acquisition envelope is
 * `range x 1.08` of SURFACE and is per-hull AND per-target. Measured over the 75
 * routable apron cells against every armed structure on the map:
 *
 *                                         nearest apron cell   envelope  margin
 *     a Glaive Post reaching a lot              59.06 m         28.80 m   30.26
 *     a lot reaching a Glaive Post              59.06           48.19     10.87
 *     the three posts of the Meridian
 *       opening, worst case                    127.56           28.80     98.76
 *
 * — where 28.80 is `24 x 1.08 + 2.880` (a Slaghurler's own radius) and 48.19 is
 * `42 x 1.08 + 2.828` (a 1x1 emplacement's `hitRadius`). So no gun on the map
 * covers a cell of the apron, and no lot standing on the apron starts a fight
 * with a picket while it is being weighed. Both pickets land at exactly 59.06 m
 * from the nearest routable cell, which is the geometry being solved rather than
 * a coincidence — see `POST_ONE` and `POST_TWO`.
 *
 * ============================================================================
 * THE PICKETS PRICE THE ROAD IN METRES AND CHARGE FOR IT IN PLANT
 * ============================================================================
 * A claim that a gun "covers the corridor" is not evidence; the instrument is to
 * close its disc and see whether the cheapest route costs more. Measured on the
 * built world with the engine's own two rules: a field rooted on the 75 routable
 * apron cells over the real `FlowFieldCache.costGridFor(MoveClass.Wheel)` —
 * 8-connected, corner-cut refused, destination-cell weights, diagonals at
 * `(nc * DIAG) | 0`, exactly as `Expander.step` does — then
 * `FlowFieldCache.buildFlow`'s own descent, which points each cell at whichever
 * 8-neighbour holds the LOWEST field value.
 *
 *                          open road          discs closed at 26.88 / 28.80
 *     lot 0 (326.8, 351.9)  cost 4580  183.88 m   4580 +0.00 m   4580 +0.00 m
 *     lot 1 (332.0, 345.7)       4721  189.54     4721 +0.00     4721 +0.00
 *     lot 2 (334.0, 334.0)       3537  141.54     3922 +14.06    4022 +18.06
 *     lot 3 (342.2, 333.5)       3797  144.85     4182 +14.06    4282 +18.06
 *
 * **THE RADIUS IS DERIVED, NOT CHOSEN.** 26.88 is `range 24 + a Slaghurler's
 * 2.880 hull` (what `Combat.engage` gates firing on) and 28.80 is
 * `24 x COMBAT_TARGETING.acquireRangeMul 1.08 + 2.880`. An earlier version of
 * this table used `range 24 + 3.2` = 27.2, a figure neither file derives
 * anywhere, and read the answer off the reconstructed CHAIN rather than the
 * cost — which is where its +7.6 on lot 1 came from. Lot 1's cheapest route
 * costs 4721 with the discs open and 4721 with them closed: the pickets cost it
 * **nothing**, and only a tie-break moved.
 *
 * So the pickets cost a lot **up to 18.06 m of detour**, not that they hold a
 * line: the near pair thread the road past `POST_ONE` and the far pair are
 * already going round. Engine-weighted the same four routes are 183.20 /
 * 188.84 / 141.48 / 151.88 m-equivalent, which at a Slaghurler's 4.6 m/s is
 * 30.8 to 41.2 seconds either way.
 *
 * **AND THE DETOUR IS NOT WHAT THE ROAD COSTS — THE EXPOSURE IS.** An exclusion
 * control answers *can they still get through*, which is a different question
 * from *what happens to the player who does not detour*, and this file measured
 * only the first. Metres of the `buildFlow` descent lying inside `POST_ONE`,
 * by exact segment/circle clipping so the answer does not depend on which end of
 * a cell edge the disc is attributed to:
 *
 *                     sight 26   firing 26.88   acquisition 28.80
 *     lot 0              0.00 m       0.00 m          0.00 m
 *     lot 1              0.00         0.00            0.00
 *     lot 2             47.62        50.76           56.81
 *     lot 3             47.62        50.76           56.81
 *
 * `POST_TWO` covers **0.00 m of every route at every radius**. Over the whole
 * cost-OPTIMAL set rather than the one descent — a lexicographic (cost,
 * ±exposed metres) field, so the pair brackets the family — the firing figure is
 * **54.28 to 62.83 m**. The descent's 50.76 sits BELOW that bracket, which is
 * not a contradiction: `buildFlow` takes the steepest neighbour rather than the
 * cheapest chain, and re-costing the chain it produces gives 3568 against a
 * field value of 3537 for lot 2 and 3911 against 3797 for lot 3 — 0.9% to 3.0%
 * dearer, and correspondingly a little less exposed. Every figure in the family
 * is over the 31.66 m the gun needs.
 * `glaiveRepeater` delivers 33.42 dps to `ArmorClass.Light` and a lot is 230 hp,
 * so the gun needs 31.66 m of a lot's travel: the short route is 1.60x lethal
 * per hull. It still costs ONE lot rather than two, because one post is one
 * target at a time with no `splashRadius` — the arithmetic is in
 * `08-contra-entry.ts`'s own header, and `t.road` is the beat that says so.
 *
 * **THE INSTRUMENT IS PROVED RATHER THAN TRUSTED**, because a flood that cannot
 * see walls returns plausible, slightly short, uniformly green numbers: a 60 m
 * disc laid across the near lots' route takes lot 2 from cost 3537 / 141.54 m to
 * **6384 / 238.51 m**, the grid refuses **4118 of 16 384 cells (25.1%)** for a
 * wheeled hull, and it reads `COST_BLOCKED` at the Meridian construction yard.
 * `COST_BLOCKED` is exported from `src/world/terrain-gen.ts` and NOT from
 * `core/config.ts`; imported from the wrong one it is `undefined`, every `>=` is
 * false, and the flood walks through buildings.
 *
 * ============================================================================
 * WHERE THE WORKINGS FORM UP
 * ============================================================================
 * `ROAD` = `lane(0.82, -12)` -> (153.57, 185.84): **70.54 m out of the Meridian
 * gate**, past `BUILD_RADIUS` 56, and 93.02 m short of the counting apron —
 * which is the geometry the last working is built on, because the counter sits
 * on the road their party comes down.
 *
 * **`EffectSink.spawnUnits` DOES NOT SEARCH FOR STANDABLE GROUND**, and it lays
 * a wave on an exact RING of radius `spread` rather than scattering inside one:
 * unit `i` of `count` lands at `angle = i / count * 2pi` and
 * `ProductionService.spawnUnit` writes the point VERBATIM. Three distinct rings,
 * thirteen drops, each checked against its own move class on the built world —
 * `mrdWayfarer` is `Locomotor.Foot` and `mrdSolarch` is `Locomotor.Track`:
 *
 *     mrdWayfarer x4  r=12  Foot    clearances 9.0 / 16.6 / 19.9 / 16.4 m
 *     mrdSolarch  x2  r=18  Track               4.5 / 17.1
 *     mrdSolarch  x3  r=18  Track               4.5 / 13.7 / 25.4
 *
 * — all thirteen open, worst clearance 4.5 m against a Solarch's 2.9 m hull.
 * `ROAD` was swept in lane space against exactly these three rings before it was
 * authored: of thirty-five candidates between `lane(0.74)` and `lane(0.86)`,
 * most put at least one Solarch drop on closed ground. **A change to any
 * `count` or `spread` invalidates this**, because a wave of three does not stand
 * where a wave of two does; `tests/campaign-spawn-ground.spec.ts` is the
 * standing gate.
 *
 * ============================================================================
 * ORE, AND WHY `addStartOre` IS NOT CALLED
 * ============================================================================
 * That helper lays a home field per opening and ONE contested patch of radius
 * 22 on the centroid of the openings, which for two armies is the map centre.
 * **The map centre is 36.80 m from `COUNTER_AREA`'s centre**, so the patch's
 * near edge falls 5.2 m INSIDE the twenty-metre disc this operation orders the
 * player to hold for forty-five seconds: the map's one shared field would be
 * the same ground as the count, with every harvester either side owns standing
 * on it and both brains defending them there.
 *
 * So the two home fields are laid by hand on the helper's own geometry — the
 * corner's bearing toward the centre, 18 m along it and 44 m across, radius 30 —
 * as a NORMALISED DIFFERENCE rather than off `facingDeg` through
 * `Math.sin`/`Math.cos`, which is exact under IEEE-754 and is the rule the next
 * section states. Both land 47.54 m from their own opening, inside
 * `BUILD_RADIUS` 56, which is what a home field is for.
 *
 * The contested patch moves ALONG the perpendicular bisector to
 * `lane(0.50, 64)` — (297.10, 206.94) — rather than off it, so it stays exactly
 * as far from one opening as from the other: measured **203.41 m and 203.41 m**,
 * which is the property that makes it worth contesting and the only property of
 * the centroid worth keeping. It lands **89.50 m from the counting apron** and
 * 140.79 m from the lot pen.
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
 * `lot`   — the four Slaghurlers, on SEAT 0. Read as
 *   `unitsInArea(0, COUNTER_AREA, min: 3, tag: 'lot')` for the win and
 *   `ownerCount(0, 'unit', 'lot', max: 2)` for the loss. A PLAYER-owned tagged
 *   hull is exempt from `campaign-maps.spec.ts`'s building rule and must stay
 *   exempt: nothing re-tasks it, unlike an AI-owned one, which
 *   `AiBrain.regroupSquads` files into a squad on the first brain pass.
 * `stack` — the three ore stacks, on SEAT 0. Read as
 *   `ownerCount(0, 'building', 'stack', ...)` and NEVER as `entityDead`: the
 *   question is what the yard still HOLDS, and a `min` threshold reads false
 *   against an empty registry where `entityDead` reads true.
 * `scale` — the weigh house, on GAIA. Named by no trigger; declared so that
 *   `campaign-maps.spec.ts` verifies it actually landed, which is the only
 *   automatic check the counting apron has.
 * `post`  — the two road pickets, on SEAT 1. Named by no trigger, declared for
 *   the same reason, and the row
 *   `tests/campaign-emplacement-reach.spec.ts` pins for this operation.
 * `party` — produced by `spawnUnits` in the trigger table, never by this file,
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

export const SIM_SEED = 12_907;

const CENTRE = MAP_SIZE * 0.5;

function slotPoint(slot: number): Point {
  const o = SKIRMISH_START_OFFSETS[slot] ?? { dx: 0, dz: 0 };
  return { x: CENTRE + o.dx, z: CENTRE + o.dz };
}

const SLOTS = seatedSlots(2, SIM_SEED, null);
/** The breaking yard's corner. */
const HOME = slotPoint(SLOTS[0] ?? 0);
/** The Meridian establishment. */
const FOE = slotPoint(SLOTS[1] ?? 1);

/** Unit vector down the road, and its left-hand perpendicular. */
const LANE = (() => {
  const dx = FOE.x - HOME.x;
  const dz = FOE.z - HOME.z;
  const len = Math.max(1e-3, Math.sqrt(dx * dx + dz * dz));
  const nx = dx / len;
  const nz = dz / len;
  return { nx, nz, px: -nz, pz: nx, len };
})();

/** A point on the road: `along` is a fraction of it, `off` is metres across. */
function lane(along: number, off: number): Point {
  return {
    x: HOME.x + LANE.nx * LANE.len * along + LANE.px * off,
    z: HOME.z + LANE.nz * LANE.len * along + LANE.pz * off,
  };
}

/**
 * The lot pen: where the four Slaghurlers stand at t = 0.
 *
 * (334.52, 342.66), 72.06 m from the nearest Meridian picket and 146.80 m from
 * the counting apron in a straight line — 141.5 to 189.5 m as the ground
 * actually routes. The four hulls are authored across the road's perpendicular
 * on 8 m centres so the wave that comes for them at minute ten and a half
 * arrives on a line rather than a point; measured, they land 8.0, 11.9 and 8.2 m
 * apart, because `ScenarioBuilder.spawnUnit` puts a hull on connected ground and
 * one of the four took the nearest open cell rather than the authored point.
 */
export const PEN: Point = lane(0.20, -16);

/**
 * The three ore stacks, on the yard's apron and its forward stand.
 *
 * **AUTHORED WHERE THEY LAND.** `place()` ring-searches a refused footprint and
 * `spawnBuilding` quantises a 2x2 to even coordinates, so an authored point is a
 * REQUEST; these three land at (380, 332), (360, 344) and (344, 300) on snaps of
 * 1.69, 1.26 and 1.14 m, which is one grid step on each axis and not a search.
 * `STACK_TWO` was authored at `lane(0.19, 2)`, had its footprint refused, and was
 * carried **16.74 m** by the ring search — onto the cell it occupies now, as it
 * happens, so the world was right and every distance quoted in these two files
 * would have been measured from a point nothing stands on. `lane(0.15, 0)` asks
 * for that cell directly. Trap 33 is that an authored coordinate is a request;
 * the fix is not to nudge it, it is to read the landing back.
 *
 * They sit 23.32, 46.82 and 48.17 m apart — two on the apron and one out on the
 * forward stand, 133.64 m from the counter, which is the one a working coming up
 * the road reaches first.
 */
export const STACK_ONE: Point = lane(0.13, 20);
export const STACK_TWO: Point = lane(0.15, 0);
export const STACK_THREE: Point = lane(0.25, 22);

/**
 * The district weighbridge — the assessor's counter, and the disc the operation
 * is decided on.
 *
 * TWENTY METRES, WHICH IS THE APRON RATHER THAN THE BUILDING. The weigh house
 * lands 1.56 m from this centre with a 12 x 8 m footprint, so the disc is an
 * annulus around it plus a stretch of road: **75 of the 81 cells whose centres
 * fall inside are routable**, for `Foot` and `Wheel` alike, which is room for
 * three hulls and their separation. Three lots have to stand in it together for
 * forty-five seconds, so the radius is the one number in this file that is a
 * capacity rather than a distance.
 */
export const COUNTER: Point = lane(0.58, -20);
export const COUNTER_AREA: Area = { x: COUNTER.x, z: COUNTER.z, r: 20 };

/**
 * The two Meridian road pickets, and the offsets are SOLVED rather than placed.
 *
 * The requirement is symmetric and it is stated in the header: no gun may reach
 * a routable apron cell (a Glaive Post acquires at `24 x 1.08 + 2.880` = 28.80 m
 * of centre distance against a Slaghurler), and no lot standing on the apron may
 * reach a gun (`42 x 1.08 + 2.828` = 48.19 m against a 1x1 emplacement). The
 * second is the binding one and it is the one that is easy to miss: a picket
 * inside 48.19 m of the apron turns the count into a gunfight the operation
 * never ordered.
 *
 * `POST_ONE` was `lane(0.42, -2)` and landed 44.72 m from the nearest routable
 * apron cell — clear of its OWN envelope by 15.92 m and 3.47 m INSIDE a
 * Slaghurler's. `POST_TWO` was `lane(0.71, -38)` at 32.98 m, then
 * `lane(0.78, -14)` at 52.15 m — still only 3.97 m of margin — and that one also
 * sat 22.9 m from the ground the recovery party formed up on at the time, which
 * pulled the worst clearance of the r=18 ring down to 7.9 m. At `lane(0.38, -2)`
 * and `lane(0.78, -38)` both land at exactly **59.06 m** from the nearest
 * routable apron cell — the same bound solved twice on a 4 m grid rather than a
 * designed symmetry — for 30.26 m of margin one way and 10.87 m the other.
 *
 * **THE TWO POSTS ARE NOT INTERCHANGEABLE AND ONLY ONE OF THEM DOES ANYTHING.**
 * They land at (290, 286) and (150, 214), and measured against the four routes
 * the engine's own `buildFlow` descent produces, `POST_TWO` covers **0.00 m of
 * every one of them at every radius tried** — it stands past the counter, on the
 * half of the road the recovery party comes down rather than the half the lots
 * walk. Every metre of exposure in this operation is `POST_ONE`, on the near
 * bend, and it falls on the two lots whose route is the SHORT one: 50.76 m each
 * inside its 26.88 m firing envelope, against the 31.66 m of a lot's travel the
 * gun needs to kill one. **That is deliberate and it is published rather than
 * quietly true** — the header's exposure table is the measurement and
 * `08-contra-entry.ts`'s `t.road` is the unconditional beat that tells the
 * player. Moving `POST_ONE` off that corridor was the alternative and it was
 * rejected: an emplacement covering nothing is scenery, and the near bend is the
 * only thing that makes the short route a decision rather than a right-click.
 */
export const POST_ONE: Point = lane(0.38, -2);
export const POST_TWO: Point = lane(0.78, -38);

/**
 * Where the Meridian recovery party forms up.
 *
 * (153.57, 185.84): **70.54 m out of their own gate**, past `BUILD_RADIUS` 56,
 * and 93.02 m short of the counting apron. Swept in lane space against the three
 * rings the trigger table fires here — `lane(0.74)` to `lane(0.86)` by 0.02, off
 * −24 to −4 by 4 — because most candidates put at least one Solarch drop of the
 * r=18 ring on closed ground, and `EffectSink.spawnUnits` writes the ring point
 * VERBATIM. All thirteen drops are open here; the worst clearance is 4.5 m.
 */
export const ROAD: Point = lane(0.82, -12);

/* ==========================================================================
 * 2. THE COMPOSITION
 * ========================================================================== */

const PLACE_RINGS: readonly number[] = [0, 6, 12, 18, 26, 34];
const PLACE_BEARINGS: readonly (readonly [number, number])[] = [
  [1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
];
const ORIGIN_ONLY: readonly (readonly [number, number])[] = [[0, 0]];

/** Metres reserved around a stack, so its yard face stays walkable. */
const STACK_CLEAR = 22;
/** Metres reserved around the weighbridge, so the counting apron stays open. */
const COUNTER_CLEAR = 26;
/** Metres reserved around the lot pen. */
const PEN_CLEAR = 26;

export default layout({
  id: 'reclamation-contra-entry',
  tags: ['lot', 'stack', 'scale', 'post', 'party'],

  build(b, cx, cz, start, c) {
    if (Math.abs(cx - CENTRE) > 1 || Math.abs(cz - CENTRE) > 1) {
      console.error(
        `[campaign] reclamation-contra-entry built on (${cx}, ${cz}), not the map centre `
        + `(${CENTRE}, ${CENTRE}) — every station is authored in absolute coordinates and will `
        + 'not line up with the ground this build lays down.',
      );
    }

    const spots = startSpots(cx, cz, b.armies, b.sea, b.seed);
    const home = spots[0];
    const foeSpot = spots[1] ?? spots[0];
    const us: PlayerId = c.seat(0);
    const them: PlayerId = c.seat(1);

    if (Math.abs(home.x - HOME.x) > 2 || Math.abs(home.z - HOME.z) > 2
      || Math.abs(foeSpot.x - FOE.x) > 2 || Math.abs(foeSpot.z - FOE.z) > 2) {
      console.error(
        `[campaign] reclamation-contra-entry: startSpots gave (${home.x}, ${home.z}) and `
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

    const yawTo = (from: Point, to: Point): number => wrapDeg(
      Math.atan2(to.x - from.x, to.z - from.z) * (180 / Math.PI),
    );

    /* ==================================================================
     * 1. THE TWO ESTABLISHMENTS
     *
     * `buildBaseFor` for BOTH seats, garrison on, because `opening` is `'base'`
     * and both halves of that are this file's job: the yard is a working
     * breaking yard with a refinery and a queue, and the Meridian arrive with
     * an establishment that mines for twenty minutes rather than a backdrop.
     * `reclamation.07.payment-in-kind` calls it for seat 1 only, which is what
     * `'force'` means; this operation is the other case and says so here.
     * ================================================================== */
    buildBaseFor(b, us, home.x, home.z, { facingDeg: wrapDeg(home.facingDeg + 180) });
    buildBaseFor(b, them, foeSpot.x, foeSpot.z, { facingDeg: wrapDeg(foeSpot.facingDeg + 180) });

    /* ==================================================================
     * 2. THE THREE STACKS
     *
     * PLACED FIRST of this file's own structures, and on SEAT 0, which is the
     * one ownership difference from `reclamation-payment-in-kind`'s identical
     * def: there the three `civOreMine` are the objective and the Works hold
     * them; here they are the yard's income and the player does.
     * `CIVILIAN_MINE_INCOME` pays any non-Neutral holder 5 credits every 30
     * ticks, so these three are 900 a minute for as long as they stand.
     *
     * `civOreMine` carries no `UNLOCK_TAGS` id, so neither roster can refuse
     * one — which matters, because a refused `spawnBuilding` returns `NONE`,
     * `c.tag` ignores `NONE`, and `ownerCount(0, 'building', 'stack', min: 3)`
     * would then read FALSE forever and quietly cost the player a medal they
     * were never able to earn.
     * ================================================================== */
    for (const at of [STACK_ONE, STACK_TWO, STACK_THREE]) {
      const p = place(us, 'civOreMine', at);
      const id: EntityId = b.spawnBuilding('civOreMine', us, p.x, p.z, {
        yawDeg: yawTo(p, FOE),
      });
      c.tag('stack', id);
      if (id !== NONE) b.block(p.x, p.z, STACK_CLEAR);
    }

    /* ==================================================================
     * 3. THE WEIGHBRIDGE
     *
     * GAIA, AND THAT IS THE ONE OWNERSHIP DECISION IN THIS FILE THAT IS NOT
     * DECORATION. `Targeting.isValidTarget` refuses only ALLIES and
     * `ScenarioBuilder.gaia` sets both directions of `allyMask` for the Neutral
     * slot, so the three Slaghurlers the operation parks on this apron for
     * forty-five seconds will not open fire on the office they are reporting
     * to. On seat 1 they would; on seat 0 the player would have been handed an
     * 1100 hp building for nothing.
     *
     * It also gives the disc something a player can see from the fog line, and
     * it is a THIRD silhouette after the stacks and the pickets on purpose.
     * ================================================================== */
    const scaleAt = place(b.gaia, 'civHospital', COUNTER);
    const scaleId = b.spawnBuilding('civHospital', b.gaia, scaleAt.x, scaleAt.z, {
      yawDeg: yawTo(scaleAt, HOME),
    });
    c.tag('scale', scaleId);
    if (scaleId !== NONE) b.block(scaleAt.x, scaleAt.z, COUNTER_CLEAR);

    /* ==================================================================
     * 4. THE TWO ROAD PICKETS
     *
     * `pillbox` is a ROLE key, so a change of `op.foe` still gets that army's
     * cheap emplacement — on a Meridian seat that is the GLAIVE POST,
     * `glaiveRepeater`, 24 m, `chainCount` 0, one pull
     * `5 x 12 x ARMOR_MATRIX[SmallArms][Infantry] 1.00 x 0.80` = 48.00 against
     * an 85 hp `rclPicker`. A real gun and a survivable one, which is what
     * `tests/campaign-emplacement-reach.spec.ts` §2 is about: the specialist row
     * is four different guns and the cheap row is one gun wearing four
     * silhouettes.
     *
     * `needsPower: true` on that weapon and `power: -10` on the def, so a
     * Meridian brownout genuinely opens the road — which is a lever the player
     * has and the operation never mentions, because it is a skirmish habit
     * rather than a scripted one.
     *
     * An emplacement rather than a hull because `AiBrain.census` files every
     * AI-owned mobile hull into `armyIds` and `regroupSquads` marches it to the
     * rally point inside four seconds. A layout cannot opt out of that.
     * Concrete can.
     * ================================================================== */
    const posts: readonly Point[] = [POST_ONE, POST_TWO];
    for (const at of posts) {
      const p = place(them, 'pillbox', at);
      const id = b.spawnBuilding('pillbox', them, p.x, p.z, { yawDeg: yawTo(p, HOME) });
      c.tag('post', id);
      if (id !== NONE) b.block(p.x, p.z, 10);
    }

    /* ==================================================================
     * 5. THE FOUR LOTS
     *
     * SPAWNED ONE AT A TIME, because `ScenarioBuilder.formation` returns a
     * COUNT and `c.tag` needs a handle, and every trigger that decides this
     * operation reads that tag.
     *
     * `Stance.Defensive` is load-bearing: `STANCE_CHASE_METRES` is
     * `[GUARD_LEASH 18, 0, 0, 0]` indexed by `Stance` and
     * `ScenarioBuilder.spawnUnit` defaults to Aggressive, so the shipped default
     * would give a lot standing on the counting apron eighteen metres of reason
     * to walk off it mid-count.
     *
     * `rclSlaghurler` carries `unit.specialist` and `spawnUnit` asks
     * `isBuildable`, so all four of these exist only because
     * `roster.player` lists that id. Delete it and the operation's primary
     * counts an empty tag for twenty minutes.
     * ================================================================== */
    const face = yawTo(PEN, COUNTER);
    for (let i = 0; i < 4; i++) {
      const off = (i - 1.5) * 8;
      c.tag('lot', b.spawnUnit('rclSlaghurler', us,
        PEN.x + LANE.px * off, PEN.z + LANE.pz * off,
        { yawDeg: face, stance: Stance.Defensive }));
    }
    b.block(PEN.x, PEN.z, PEN_CLEAR);

    /* ==================================================================
     * 6. ORE, DRESSING AND THE OPENING FRAME
     *
     * NOT `addStartOre`, AND THE REASON IS 36.80 m. That helper lays a home
     * field per opening and ONE contested patch of radius 22 on the centroid,
     * which for two armies is the map centre — and the map centre is 36.80 m
     * from `COUNTER_AREA`'s centre, so the patch's near edge falls 5.2 m
     * INSIDE the disc this operation orders the player to hold for forty-five
     * seconds. The map's one shared field would be the same ground as the
     * count, with every harvester either side owns standing on it and both
     * brains defending them there.
     *
     * The home fields are laid by hand on the same geometry the helper uses —
     * each corner's own bearing toward the centre, as a NORMALISED DIFFERENCE
     * rather than off `facingDeg` through `Math.sin`/`Math.cos`, which is
     * exact under IEEE-754 and is the rule the header states. The contested
     * patch moves ALONG the perpendicular bisector rather than off it, so it
     * stays exactly as far from one opening as from the other — the property
     * that makes it worth contesting — and clears the apron.
     * ================================================================== */
    for (const spot of [home, foeSpot]) {
      const dx = cx - spot.x;
      const dz = cz - spot.z;
      const l = Math.max(1e-3, Math.sqrt(dx * dx + dz * dz));
      const nx = dx / l;
      const nz = dz / l;
      b.addOre(spot.x + nx * 18 - nz * 44, spot.z + nz * 18 + nx * 44, 30);
    }
    {
      const c = lane(0.50, 64);
      b.addOre(c.x, c.z, 22);
    }
    b.setCameraFocus(
      PEN.x + (COUNTER.x - PEN.x) * 0.12,
      PEN.z + (COUNTER.z - PEN.z) * 0.12,
    );
    b.scatter({ minX: cx - 180, minZ: cz - 180, maxX: cx + 180, maxZ: cz + 180 }, 150);
    void start;
  },
});
