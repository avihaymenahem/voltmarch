/**
 * ============================================================================
 * VOLTMARCH — src/campaign/layouts/reclamation-in-duplicate.ts
 * ============================================================================
 * R6 — THE GROUND. Survey 25-777: an industrial district the Reclamation has a
 * yard on, a counting house on the lot in front of it, a bonded store two
 * hundred metres down the sidings road, and an Allied works at the far end of
 * the same road. Everything this operation is about happens on the line between
 * the second and the third of those.
 *
 * ============================================================================
 * EVERY EXPORTED POINT IS ARITHMETIC, AND THE ONE MEASUREMENT THAT MAKES THAT
 * SAFE IS AT THE TOP OF `build`
 * ============================================================================
 * `reclamation-served-notice` is the precedent and `reclamation-closing-entry`
 * repeats it: `SIM_SEED` lives HERE, `06-in-duplicate.ts` imports it into
 * `map.simSeed` rather than restating it, and every point below is computed
 * from it at module load out of `seatedSlots`, `SKIRMISH_START_OFFSETS` and
 * `MAP_SIZE`. A number written in two files is a number that will disagree the
 * first time either is tuned, and the failure — a reveal framing empty ground,
 * a column landing where nobody authored one — is invisible to every gate.
 *
 * **THE HAZARD IS THAT THE RAW CORNER AND THE BUILT CORNER ARE NOT THE SAME
 * QUANTITY, AND IT IS MEASURED RATHER THAN ASSUMED.** `startSpots` runs
 * `nudgeToBuildable` over the authored offsets, so what the layout is handed
 * can differ from `CENTRE + SKIRMISH_START_OFFSETS[slot]` — and every point
 * here is derived from the RAW corner. Measured INSIDE the build, before a
 * single footprint is marked, at this operation's seeds:
 *
 *     startSpots  (404.00, 380.00) f=-129.96    (108.00, 132.00) f=50.04
 *     raw slots   (404, 380)                    (108, 132)
 *
 * — identical, to two decimals, on both corners. `build` re-checks it every
 * time and `console.error`s if it ever stops being true, because the
 * alternative is a silent offset between the composition and the ground. And
 * the check has to be taken INSIDE the build: `nudgeToBuildable` scores
 * `terrain.isBuildable`, which is FALSE on a cell a structure already occupies,
 * so calling `startSpots` after the world is built reports openings that were
 * never used — the trap `reclamation-sold-twice` paid for.
 *
 * `seatedSlots(2, 7717, null)` draws **[2, 3]**, which is the OTHER 386.16 m
 * diagonal — the one `reclamation-closing-entry`'s [0, 1] does not use. The
 * player is in the (404, 380) corner and the Allies in (108, 132), and every
 * lot below is `lane(along, off)`: a fraction of that line from the player's
 * corner, plus metres along its left-hand perpendicular.
 *
 * ============================================================================
 * WHAT THE BUILD ACTUALLY PUT DOWN
 * ============================================================================
 * Built headless at `mapSeed` 25 777 / `simSeed` 7 717 on `biome: 'urban'`,
 * with the def tables BOUND and the operation's roster INSTALLED — the only
 * state in which the allow-list is in force, and the state
 * `tests/campaign-roster-ground.spec.ts` builds in:
 *
 *     seat 0  the yard        24 buildings  20 units  power 320/170  net +150
 *     seat 1  the works       25 buildings  12 units  power 400/170  net +230
 *
 *     Foundry     404, 380     counting house  316, 350
 *     Allied yard 108, 132     bonded store    220, 186
 *     stop posts  226, 230  and  250, 202
 *     forming up  ROAD 141.9, 217.8 (the works end, for the counting-house
 *                 workings) and SIDING 218.7, 279.5 (below the notice, for the
 *                 store-bound ones — the ridge makes them two points, see below)
 *
 * Seat 0's opening, by key: `rclFoundry` x1, `rclBreakerYard` x1, `rclRookery`
 * x1, `rclSorter` x1, `rclFurnace` x4, `rclHeap` x2, `rclSpotter` x1,
 * `rclSpitpost` x3, `rclBarricade` x9, `civApartments` x1; `rclGrinder` x4,
 * `rclSpitter` x2, `rclPicker` x5, `rclScrapper` x2, `rclTinker` x7. Seat 1's:
 * `conyard`, `powerPlant` x4, `refinery`, `warFactory`, `barracks`, `radar`,
 * `oreSilo` x2, `pillbox` x5, `wall` x9; `grizzly` x4, `gi` x5, `harvester` x2,
 * `engineer` x1.
 *
 * **THE SEVENTH `rclTinker` AND THE SINGLE `engineer` ARE BOTH LOAD-BEARING
 * AND NEITHER IS THIS FILE'S.** Six of the seven Tinkers are the clerks below;
 * the seventh and the Allied engineer are `buildAlliedGarrison`'s, one per
 * side. The Allied one is the reason `OperationDef.captureProof` names `house`
 * and is not a well-spelled no-op, and both are argued in `06-in-duplicate.ts`.
 *
 * `auditConnectivity`: 3 passable regions for a tracked hull, the main one
 * holding **12 408 of 12 579 cells (98.6%)**; **0 placements relocated, 0
 * entities stranded, 0 structures on ground `isBuildable` refuses.** Zero
 * relocations is worth stating rather than assuming: `spawnBuilding` walks a
 * placement onto connected ground when it has to, and here it never had to.
 *
 * **THE TWO SMALL REGIONS ARE PRE-EXISTING GROUND AND NOT THIS FILE'S.** They
 * are 171 cells between them, 1.4% of the walkable map, and no lot, no spawn
 * ring, no ore field and no part of the clerks' route is in either.
 *
 * ============================================================================
 * THE AUTHORED POINTS LAND WHERE THEY ARE AUTHORED, AND THAT WAS AN ITERATION
 * ============================================================================
 * Everything the trigger table reads is a DISC centred on an authored point,
 * and the structure inside it is placed by a ring search. If the two drift the
 * disc stops meaning what its name says. Measured:
 *
 *     counting house   authored (317.04, 351.50)  landed (316, 350)   1.83 m
 *     bonded store     authored (219.03, 185.88)  landed (220, 186)   0.98 m
 *
 * — one grid snap on each axis, which is what `snapFootprintToGrid` does and
 * not a search. **THE FIRST DRAFT WAS 17.42 m AND 13.05 m OUT**, at
 * `lane(0.18, -34)` and `lane(0.66, 38)`: both authored points refused a 2x3
 * footprint, `place` walked out through its rings to find one, and both discs
 * ended up carrying their structure 17.42 m into a 26 m radius and 13.05 m into
 * a 24 m one. Nothing would have failed —
 * the discs are large enough to hold an off-centre building — and every
 * distance in both headers would have been a distance to a point nothing stood
 * on. The fix was to move the authored points onto ground the footprint
 * accepts, not to widen the discs.
 *
 * The six clerks stand 10.00 to 15.81 m from the counting house disc's centre,
 * so all six are inside `HOUSE_AREA` at t = 0 and the engrossment's arming pass
 * is true on the first tick.
 *
 * ============================================================================
 * THE COUNTING HOUSE AND THE BONDED STORE ARE THE SAME DEF, AND THAT IS THE
 * CHAPTER'S CONVENTION RATHER THAN A SHORTCUT
 * ============================================================================
 * Both are `civApartments` — 800 hp, `ArmorClass.Concrete`, an 8 x 12 m
 * footprint. `reclamation-served-notice` uses it for the Allied district's
 * record blocks and `reclamation-closing-entry` for the counting house at
 * Survey 41-207; in this chapter a brick building full of paper IS a
 * `civApartments`, and a third use is the convention rather than a coincidence.
 *
 * The two differ in exactly one field and it decides the operation:
 *
 *   - **The counting house is SEAT 0's.** `ownerCount(0, 'building', 'house')`
 *     therefore reads 1 at t = 0 and 0 when it is lost, which is what
 *     `t.houseLost` and `t.houseGoneLate` partition on.
 *   - **The bonded store is GAIA's.** Nobody owns it, which is the whole point
 *     of a bonded store and the whole point of this operation: a depository the
 *     Reclamation owns is not a second copy. `06-in-duplicate.ts` names it in
 *     `captureProof` so it cannot become theirs by one right-click, and the
 *     trigger table reads GROUND (`unitsInArea` over `BOND_AREA`) rather than
 *     ownership, so who holds the deed never enters the win condition at all.
 *
 * **NEITHER CAN BE SOLD.** `Scenarios.civilian()` composes its flag set as
 * `STRUCTURE & ~EntityFlag.Sellable` and the `civApartments` DEF row sets no
 * flags of its own, so `spawnBuilding`'s `fb.flags | (def?.flags ?? 0)` never
 * puts the bit back. For the counting house that matters: this operation's
 * primary stands on a lot the player would otherwise be able to liquidate.
 *
 * ============================================================================
 * THE CLERKS ARE ENGINEERS, AND THEY ARE THE ONLY UNITS THIS FILE TAGS
 * ============================================================================
 * Six `rclTinker` — the `engineer` ROLE key, so `keyFor` gives this army its
 * own and no roster can refuse it (the three `canCapture` defs carry no
 * `unlockedBy`). 85 hp, 3.5 m/s, 500 credits each, unarmed. Three thousand
 * credits of labour standing in a yard against an opening bank of five
 * thousand, which is the operation's cost in one line.
 *
 * They are laid in two ranks of three, 10 m and 15 m back from the counting
 * house on the lane's own bearing, at `Stance.Defensive` — the stance that
 * means "on post" and, for an unarmed unit, means "do not wander". A PLAYER-
 * owned tagged unit is exempt from the rule `campaign-maps.spec.ts` enforces
 * about tagged hulls on an AI seat: nothing re-tasks seat 0's units, so unlike
 * an enemy hull they are still where the layout put them when the Director
 * first runs.
 *
 * ============================================================================
 * THE STOP NOTICE IS TWO POSTS ON A ROAD, AND ITS POSITION IS AN EXCLUSION
 * MEASUREMENT
 * ============================================================================
 * Two `pillbox` — the cheap-defence ROLE key, which resolves to `pillbox`
 * itself on an Allied seat — at `NOTICE` plus and minus 19 m along the lane's
 * perpendicular, landing at (226, 230) and (250, 202). They are 44.41 m and
 * 34.00 m short of the bonded store and 150.00 m and 162.05 m from the counting
 * house, so they cover the ROAD rather than either building.
 *
 * **THE POSITION WAS CHOSEN BY MEASURING WHAT CLOSING THEM COSTS, NOT BY
 * PUTTING THEM SOMEWHERE THAT LOOKED RIGHT.** For each candidate the two gun
 * discs were made impassable and the cost-optimal Foot route re-run; the
 * shipped pair takes the cheapest route from **4784 to 5695 (+19.0%)** and its
 * chain from **191.8 m to 225.4 m**. `06-in-duplicate.ts`'s header carries the
 * sweep and the reason the higher-scoring positions were rejected. **Re-run
 * that control if either post moves** — a picket whose exclusion delta is zero
 * is scenery, and three earlier operations in this campaign shipped one.
 *
 * **AND THE DELTA IS THE PRICE OF THE ROUTE NOBODY IS TOLD TO TAKE.** What the
 * DEFAULT click costs — one right-click on the store with the clerks selected —
 * is measured in `06-in-duplicate.ts` under "what leaving it standing really
 * costs": every cost-optimal chain spends between 28.3 m and 46.6 m inside a
 * post's envelope, which is 533 to 876 delivered damage against a four-clerk
 * party carrying 340 hp between them. The posts are a toll on a hand-routed
 * party and a GATE on a clicked one, and both halves are the operation's.
 *
 * They are emplacements and not hulls for the rule `campaign-maps.spec.ts`
 * pins: `AiBrain.census` files every AI-owned mobile hull into `armyIds` and
 * `regroupSquads` marches it to the rally point inside four seconds. A layout
 * cannot opt out of that. Concrete can.
 *
 * **`pillbox` CARRIES NO `unlockedBy`, WHICH IS WHY THE EMPTY `roster.ai` DOES
 * NOT DELETE THE PICKET** — and it is also why the picket is a `pillbox` rather
 * than the specialist tower: `prismTower` is `struct.defence.specialist`, the
 * operation withholds it from both seats, and a refused `spawnBuilding` returns
 * `NONE`, `c.tag` ignores `NONE`, and `ownerCount(1, …, 'notice', max: 0)`
 * would then read TRUE the moment the settle guard expired and pay 600 credits
 * for a structure nobody touched.
 *
 * ============================================================================
 * WHERE THE WORKINGS FORM UP, AND WHY THERE ARE TWO POINTS RATHER THAN ONE
 * ============================================================================
 * **A SPOIL RIDGE CUTS THE ALLIED WORKS OFF FROM THE BONDED STORE, AND NOTHING
 * ABOUT IT IS VISIBLE FROM THE STRAIGHT LINE.** This file shipped with one
 * forming-up point and an operation header that costed the store-bound workings
 * at 74.9 m of road. `ROAD` is 84.33 m from the store in a STRAIGHT LINE and
 * **715.1 m from it by the route a tracked hull actually takes**.
 *
 * The instrument is a Dijkstra whose relaxation mirrors `Expander.step` exactly
 * — 8-connected, destination-cell weight out of
 * `FlowFieldCache.costGridFor(MoveClass.Track)`, diagonals at `(nc * DIAG) | 0`,
 * corner cutting refused, **`COST_BLOCKED` imported from
 * `src/world/terrain-gen.ts`** (trap 21: imported from `config.ts` it is
 * `undefined`, every `nc >= undefined` is false, and the fill walks through
 * buildings and reports plausible short routes). It has teeth: **4042 of 16 384
 * Track cells and 3937 Foot cells read `COST_BLOCKED`**, and ringing the store
 * at 30..46 m makes the same query report UNREACHABLE. On Foot the same walk is
 * 703.1 m and on the HARD grid (`hardGridFor`, the clearance rule left out) it
 * is 703.1 m, so it is ground and not a planner artefact.
 *
 * The chain leaves ROAD northward, crosses the top of the map at z ~ 78 and
 * comes back down the far side: (138,214) (138,150) (170,86) (234,78) (298,82)
 * (350,146) (366,210) (382,274) (322,274) (226,206). It is the same loop
 * `ROAD -> counting house` takes, one leg longer.
 *
 * **AND THERE IS NO FORMING-UP POINT BEYOND THE STORE AT ALL.** Sweeping the
 * lane frame at 0.005 of the lane and 2 m across it and keeping only points
 * where all eleven distinct drops of the store-bound waves stand on ground
 * their own locomotor may enter with 8 m of clearance leaves 2217 candidates —
 * and **zero** of them lie past the store (`along > 0.72`) with a tracked route
 * to it under 200 m. So the workings ordered onto the store cannot come out of
 * the Allied gate. They are the notice party's own reinforcement and they form
 * up on the sidings below the posts, which is `SIDING`.
 *
 * **`EffectSink.spawnUnits` DOES NOT SEARCH FOR STANDABLE GROUND**, and it lays
 * a wave on an exact RING of radius `spread` rather than scattering inside one:
 * `ProductionService.spawnUnit` clamps to the map, reads `heightAt` and
 * allocates, and asks nothing. So every drop of every wave is checked against
 * `ITerrain.isPassable` for that wave's own move class on the built world.
 * Eight calls, twenty-six drops, five distinct rings, all open — clearance here
 * is metres to the nearest cell CENTRE that wave's locomotor may not enter, and
 * `>24` means none inside six rings:
 *
 *     at ROAD    gi       x4  r=12  Foot   clearances 7.9 / 7.8 / 9.1 / 12.2
 *                grizzly  x2  r=18  Track              7.2 / 12.6
 *     at SIDING  gi       x5  r=14  Foot              >24 / 25.0 / 11.2 / 17.6 / >24
 *                grizzly  x3  r=18  Track             >24 / 11.7 / 22.1
 *                javelin  x3  r=15  Foot              >24 / 13.3 / 22.4
 *
 * (An earlier draft of this table read 8 / 8 / 8 / 12 for the first row and
 * called 8.0 m the worst clearance anywhere. Those are CELL-RING distances
 * quantised to `CELL` 4 m; on the continuous measure the worst at ROAD is
 * 7.2 m. Same conclusion, and the convention is written down now so the two
 * cannot be compared as though they were one number.)
 *
 * `tests/campaign-spawn-ground.spec.ts` is the standing gate, and **a change to
 * any count or spread needs a fresh sweep**, because the bearings are
 * `i / count * 2pi` and a wave of three does not stand where a wave of four
 * does.
 *
 * ============================================================================
 * `addStartOre`, AND WHY THIS ONE DOES NOT HAND-PLACE ITS FIELDS
 * ============================================================================
 * `reclamation-closing-entry` refuses the helper because its contested patch
 * would land 53.9 m from an objective lot on a map whose second primary is a
 * bank threshold. Neither is true here. The helper puts one radius-30 home
 * field per seat on the bearing perpendicular to the approach lane and one
 * radius-22 contested patch on the centroid of the openings, which for two
 * armies is the map centre (256, 256) — **78.71 m from the bonded store and
 * 111.51 m from the counting house**, so it touches no lot and no spawn ring.
 *
 * It sits ON the clerks' corridor, which is the reason to keep it rather than
 * to work around it: the road the counterpart walks down is the road the
 * harvesters work, so an escort is competing for the same ground the economy
 * is, and the player's own miners are the first thing that meets a column
 * ordered at the store. Nothing in the trigger table reads ore.
 *
 * `addCivilians` is refused for `reclamation-closing-entry`'s reason exactly:
 * it places `civApartments` in two hamlets on the lane's bisector, and this
 * operation's primary and its destination are both `civApartments`. A player
 * told to walk a counterpart to a records building and shown four more
 * identical ones is a player the layout has lied to.
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
 * value — a coin flipped once at authoring time deciding whether every measured
 * coordinate here belongs to the player or to the Allies. Seat `i` takes
 * slot `i`.
 *
 * ============================================================================
 * TAGS
 * ============================================================================
 * `house`  — the counting house, SEAT 0's. Read as `ownerCount(0, 'building',
 *   …)` so it is 1 at t = 0 and 0 when it is lost, and as the disc `HOUSE_AREA`
 *   for the engrossment and the receipt. Named by `captureProof`.
 * `bond`   — the bonded store, GAIA's. Named by `captureProof` and by NO
 *   trigger: every threshold about it is `unitsInArea` over `BOND_AREA`, which
 *   is ground, so the operation never asks who owns it. Declared here so a
 *   reader looking for the store finds it, and so `campaign-maps.spec.ts`
 *   verifies it landed at all — which is the only automatic check the raid and
 *   route measurements above have.
 * `notice` — the two stop posts, SEAT 1's. `ownerCount(1, …, max: 0)` and NEVER
 *   `entityDead`, because a captured post is still alive.
 * `clerk`  — the six `rclTinker`. Read as `unitsInArea` over three different
 *   discs and never as an `entity*` condition.
 * `column` — produced by `spawnUnits` in the trigger table, never by this file,
 *   and declared anyway so a reader asking where the pressure comes from finds
 *   the answer in the file that owns the ground.
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
  SKIRMISH_START_OFFSETS, addStartOre, buildBaseFor, seatedSlots, startSpots, wrapDeg,
} from '../../game/Scenarios';
import type { EntityId, PlayerId } from '../../core/types';
import type { Area, Point } from '../types';
import { layout } from '../layout';

/* ==========================================================================
 * 1. THE SEED, AND EVERYTHING ARITHMETIC THAT FALLS OUT OF IT
 * ========================================================================== */

/**
 * `?seed=` — the scenario layout roll, and the ONE input every exported point
 * below is computed from. `06-in-duplicate.ts` imports it into `map.simSeed`
 * rather than restating it.
 *
 * `seatedSlots(2, 7717, null)` draws **[2, 3]** — the diagonal
 * `reclamation-closing-entry`'s [0, 1] does not use — which puts the two
 * openings 386.16 m apart and the player in the (404, 380) corner. A diagonal
 * rather than an edge pair because this operation needs room for three lots
 * between the two bases: an edge pair is 296.00 m and the bonded store would
 * stand inside somebody's build radius.
 */
export const SIM_SEED = 7_717;

/** The map centre. Every authored slot is an offset from it. */
const CENTRE = MAP_SIZE * 0.5;

/** An authored slot as a world point. `?? { dx: 0, dz: 0 }` is unreachable. */
function slotPoint(slot: number): Point {
  const o = SKIRMISH_START_OFFSETS[slot] ?? { dx: 0, dz: 0 };
  return { x: CENTRE + o.dx, z: CENTRE + o.dz };
}

const SLOTS = seatedSlots(2, SIM_SEED, null);
/** The Reclamation yard. (404, 380) on the shipped pair. */
const HOME = slotPoint(SLOTS[0] ?? 0);
/** The Allied works. (108, 132), 386.16 m up the lane. */
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
 * The counting house: where the account is kept and where the counterpart is
 * written.
 *
 * Landed at (316, 350) — **1.83 m from the authored point**, which is one grid
 * snap and not a search — 92.97 m from the Foundry, and 301.30 m from the Allied
 * yard. `lane(0.18, -34)` was tried first and landed 17.42 m out; see the
 * header.
 */
export const HOUSE: Point = lane(0.22, -34);

/**
 * The lot the clerks write on, and the lot the receipt is entered on.
 *
 * 26 m, which holds the building, all six clerks at t = 0 (10.00 to 15.81 m
 * from this centre) and the ground immediately around them. It is read TWICE by
 * the trigger table — as the engrossment hold and as the win — and it is read
 * as GROUND rather than as the structure, which is what lets a player who has
 * lost the counting house after the counterpart is written still finish the
 * week standing in its yard.
 */
export const HOUSE_AREA: Area = { x: HOUSE.x, z: HOUSE.z, r: 26 };

/**
 * The district's bonded store, and it belongs to nobody.
 *
 * Landed at (220, 186) — 0.98 m from the authored point — 124.34 m from the
 * Allied yard, 267.38 m from the Reclamation's, and 190.03 m in a straight line
 * from the counting house.
 *
 * **THE CLERKS' LEG IS MEASURED FROM WHERE THEY STAND TO THE DISC, NOT FROM
 * BUILDING TO BUILDING** — trap 27, and the two are different quantities. From
 * each of the six spawned positions to the nearest cell inside `BOND_AREA` the
 * cost-optimal Foot route runs **187.8 to 199.8 m** (53.6 to 57.1 s at
 * `rclTinker`'s 3.5 m/s); the middle of the front rank is 191.8 m at cost 4784,
 * which is the figure `06-in-duplicate.ts` quotes. The return, from the arrival
 * cell to the nearest cell inside `HOUSE_AREA`, is **155.5 m** (44.4 s) — the
 * two discs are 26 m and 24 m, so the walk back is genuinely the shorter one
 * and the operation's floor is not two identical legs.
 */
export const BOND: Point = lane(0.69, 30);

/** The lodgement lot. 24 m: the store, its apron and no more. */
export const BOND_AREA: Area = { x: BOND.x, z: BOND.z, r: 24 };

/**
 * The reveal disc, fired once when the counterpart is written.
 *
 * 46 m rather than the store's own footprint, so it covers the store, both stop
 * posts (44.41 m and 34.00 m off it) and the road between them. `revealArea`
 * EXPLORES rather than showing live units, so this is the map being drawn and
 * not an intelligence report.
 */
export const BOND_REVEAL: Area = { x: BOND.x, z: BOND.z, r: 46 };

/**
 * The centre of the Allied stop notice, on the sidings road.
 *
 * Two `pillbox` at `NOTICE_SEP` either side of it. Chosen by exclusion control
 * rather than by eye — closing both gun discs takes the cheapest Foot route
 * from 4784 to 5695 and its chain from 191.8 m to 225.4 m. See the header, and
 * re-run that control if this moves.
 */
export const NOTICE: Point = lane(0.60, 18);

/**
 * The whole district, as a disc.
 *
 * NOT A PLACE — a HEAD COUNT. `06-in-duplicate.ts` reads
 * `not unitsInArea(0, DISTRICT, min: N, tag: 'clerk')` because the frozen
 * vocabulary has no comparable "how many carry this tag": `entityDead` is
 * boolean and `WorldQuery.aliveWithTag` is not exposed as a condition. Radius
 * `MAP_SIZE` centred on the map covers every cell — the far corner is 362.04 m
 * from the centre — and the read is cheap because `unitsInArea` walks the TAG
 * when one is given rather than `store.alive`.
 */
export const DISTRICT: Area = { x: CENTRE, z: CENTRE, r: MAP_SIZE };

/**
 * Where the workings ORDERED ONTO THE COUNTING HOUSE form up: (141.9, 217.8),
 * 92.26 m out of the Allied gate and comfortably past `BUILD_RADIUS` 56.
 *
 * **614.3 m OF TRACKED ROUTE FROM THE COUNTING HOUSE against a 218.60 m
 * straight line, AND THE CAUSE IS THE RIDGE RATHER THAN THE PLAYER'S BASE.**
 * This file and `06-in-duplicate.ts` both used to say the detour was the
 * player's yard and its nine `rclBarricade` standing in the way. Reconstructed,
 * the chain never goes near them: from the lot it runs (322,346) (382,310)
 * (382,278) (366,214) (350,150) (334,118) (270,78) (206,78) (174,86) (150,114)
 * (138,178) (138,210) — north-east out of the district, west along the top of
 * the map at z ~ 78, and back down. It is the ridge described in the header,
 * and it costs 15 550 against a straight line of 218.60 m.
 *
 * That is what strings the first working out rather than a base: armour is on
 * the lot **93.1 s** after it forms and its infantry **192.0 s**.
 *
 * Six distinct drops fire here — `gi` x4 on a 12 m ring and `grizzly` x2 on an
 * 18 m one, twice each — and all six are standable; see the header's table for
 * the clearances and the convention they are measured in.
 */
export const ROAD: Point = lane(0.79, -44);

/**
 * Where the workings ORDERED ONTO THE BONDED STORE form up: (218.7, 279.5), on
 * the sidings below the stop notice.
 *
 * **IT IS A SECOND POINT BECAUSE THE FIRST ONE CANNOT REACH THE STORE.** `ROAD`
 * is 84.33 m from the store in a straight line and 715.1 m from it by tracked
 * route, and the sweep in the header finds NO candidate past the store with a
 * route under 200 m — the ridge is not something a spawn point on the Allied
 * side can be moved around. So the store-bound waves are the notice party's own
 * reinforcement, forming up on the ground the posts already stand on, and the
 * operation's dialogue says so.
 *
 * Measured on the built world:
 *
 *     tracked route to the store        89.7 m   (cost 2341)
 *     armour on the store               13.6 s   at `grizzly`'s 6.6 m/s
 *     riflemen                          28.0 s   at `gi`'s 3.2
 *     javelins                          29.9 s   at 3.0
 *     straight lines                    93.5 m to the store, 120.2 m to the
 *                                       counting house, 210.8 m to the Foundry,
 *                                       50.1 m to the nearer stop post
 *
 * **THE KEEP-OFF IS THE OTHER HALF OF THE CHOICE AND IT IS WHY THIS IS NOT THE
 * SHORTEST CANDIDATE.** A wave dropped ON the clerks is an ambush rather than
 * an escort, so every one of the eleven drops was measured against the SET of
 * cells lying on some cost-optimal Foot route from the clerks to `BOND_AREA` —
 * a forward Dijkstra plus a REVERSE one whose relaxation pays the cost of the
 * cell it LEAVES, so that `fwd + bwd === best` picks out the set rather than
 * one reconstructed chain. The nearest drop of any ring stands **30.3 m** off
 * that corridor, against `lightCannon`'s envelope of 24 + a clerk's `hitRadius`
 * 0.2340 = **24.234 m** and `rifle`'s 18.234 m. So nothing in the wave can open
 * fire on the party on the tick it lands.
 *
 * Candidates at 71-76 m of route exist and were rejected for exactly that: the
 * best of them puts a `grizzly` **25.6 m** off the corridor, 1.4 m outside its
 * own gun, which is a margin no reader could check and one cell of generator
 * drift from being an ambush.
 */
export const SIDING: Point = lane(0.535, -42);

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
 * `reclamation-held-paper` all carry.
 *
 * On the shipped seeds it never leaves ring zero for any of the four
 * placements: `auditConnectivity` reports 0 relocations and both tagged
 * structures land within 1.83 m of their authored points.
 */
const PLACE_RINGS: readonly number[] = [0, 6, 12, 18, 26, 34];
/** Eight exact bearings. Integers only, so every candidate is bit-identical. */
const PLACE_BEARINGS: readonly (readonly [number, number])[] = [
  [1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
];
/** Ring zero is the nominal spot itself; the bearings would test it eight times. */
const ORIGIN_ONLY: readonly (readonly [number, number])[] = [[0, 0]];

/**
 * Six clerks, and the number is set by the trigger table's arithmetic.
 *
 * The lodgement wants four hands and the receipt three, and `4 + 3 = 7 > 6` is
 * what stops a party that never left the lot from collecting its own receipt.
 * **Change this and that closure goes with it** — at eight clerks the same two
 * thresholds are satisfiable by leaving four men at home.
 */
const CLERKS = 6;
/** Metres either side of the road the two stop posts stand. */
const NOTICE_SEP = 19;
/** Metres reserved around the counting house so `scatter` leaves the lot legible. */
const HOUSE_CLEAR = 30;
/** Metres reserved around the bonded store, so its apron stays walkable. */
const BOND_CLEAR = 26;
/** Metres reserved around each stop post. */
const NOTICE_CLEAR = 10;

export default layout({
  id: 'reclamation-in-duplicate',
  tags: ['house', 'bond', 'notice', 'clerk', 'column'],

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
        `[campaign] reclamation-in-duplicate built on (${cx}, ${cz}), not the map centre `
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
        `[campaign] reclamation-in-duplicate: startSpots gave (${home.x}, ${home.z}) and `
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
     * back, and no offset in this layout is derived from an angle.
     */
    const yawTo = (from: Point, to: Point): number => wrapDeg(
      Math.atan2(to.x - from.x, to.z - from.z) * (180 / Math.PI),
    );

    /* ==================================================================
     * 1. THE TWO BASES
     *
     * `opening: 'base'` on both seats, garrison included. The clerks cannot
     * be bought and the escort can, so the player needs the thing that buys
     * it; and an eighteen-minute operation against an opponent that never
     * mines is a backdrop rather than a threat.
     * ================================================================== */
    buildBaseFor(b, us, home.x, home.z, { facingDeg: wrapDeg(home.facingDeg + 180) });
    buildBaseFor(b, them, foeSpot.x, foeSpot.z, {
      facingDeg: wrapDeg(foeSpot.facingDeg + 180),
    });

    /* ==================================================================
     * 2. THE COUNTING HOUSE
     *
     * PLACED FIRST of this file's own structures, because everything else
     * gives way to it. `civApartments` carries no `UNLOCK_TAGS` id, so no
     * roster can refuse it — which matters more here than anywhere else: a
     * refused `spawnBuilding` returns `NONE`, `c.tag` ignores `NONE`, and
     * `t.houseLost` would end the operation in a defeat the moment its
     * settle guard expired.
     * ================================================================== */
    const houseAt = place(us, 'civApartments', HOUSE);
    const houseId: EntityId = b.spawnBuilding('civApartments', us, houseAt.x, houseAt.z, {
      yawDeg: yawTo(houseAt, FOE),
    });
    c.tag('house', houseId);
    if (houseId !== NONE) b.block(houseAt.x, houseAt.z, HOUSE_CLEAR);

    /* ==================================================================
     * 3. THE CLERKS
     *
     * Two ranks of three, 10 m and 15 m back from the counting house on the
     * lane's own bearing, so all six sit inside `HOUSE_AREA` and the
     * engrossment's arming pass is true on the first tick. `Stance
     * .Defensive` is the only stance that means "on post"; for an unarmed
     * unit it means "do not wander".
     *
     * `engineer` is a ROLE key, so `keyFor` resolves it to `rclTinker` for
     * this army. That is deliberate and it is what makes
     * `OperationDef.captureProof` load-bearing on the bonded store: the
     * carriers can spend themselves on a door, and rule 1 of
     * `Capture.resolve` takes a NEUTRAL structure outright at any health.
     * ================================================================== */
    for (let i = 0; i < CLERKS; i++) {
      const col = i % 3;
      const row = (i / 3) | 0;
      const across = (col - 1) * 5;
      const back = row * 5 + 10;
      const id = b.spawnUnit('engineer', us,
        houseAt.x - LANE.nx * back + LANE.px * across,
        houseAt.z - LANE.nz * back + LANE.pz * across,
        { yawDeg: yawTo(houseAt, FOE), stance: Stance.Defensive });
      c.tag('clerk', id);
    }

    /* ==================================================================
     * 4. THE BONDED STORE
     *
     * GAIA'S, and that single argument is the operation. A depository the
     * Reclamation owns is not a second copy of anything. The trigger table
     * reads the GROUND around it rather than its owner, so a garrison flip —
     * which `GarrisonService.enter` performs without consulting any
     * `CaptureService` veto — changes nothing; and `captureProof` stops an
     * engineer taking the deed permanently.
     * ================================================================== */
    const bondAt = place(b.gaia, 'civApartments', BOND);
    const bondId = b.spawnBuilding('civApartments', b.gaia, bondAt.x, bondAt.z, {
      yawDeg: yawTo(bondAt, HOME),
    });
    c.tag('bond', bondId);
    if (bondId !== NONE) b.block(bondAt.x, bondAt.z, BOND_CLEAR);

    /* ==================================================================
     * 5. THE STOP NOTICE
     *
     * Two posts astride the sidings road, 19 m either side of `NOTICE`.
     * `pillbox` is a ROLE key and `op.foe` is Allied, so `keyFor` resolves
     * it to `pillbox` itself — 22 m of `pillboxMg`, `chainCount` 0, one pull
     * 52.00 delivered against `ArmorClass.Infantry`. That is one clerk in
     * 0.97 s and it is NOT two per trigger, which is the rule
     * `tests/campaign-emplacement-reach.spec.ts` enforces over any
     * emplacement covering ground a trigger names.
     * ================================================================== */
    for (const side of [-1, 1]) {
      const g = place(them, 'pillbox', {
        x: NOTICE.x + LANE.px * side * NOTICE_SEP,
        z: NOTICE.z + LANE.pz * side * NOTICE_SEP,
      });
      const gid = b.spawnBuilding('pillbox', them, g.x, g.z, { yawDeg: yawTo(g, HOME) });
      c.tag('notice', gid);
      if (gid !== NONE) b.block(g.x, g.z, NOTICE_CLEAR);
    }

    /* ==================================================================
     * 6. ORE, DRESSING AND THE OPENING FRAME
     *
     * `addStartOre` rather than a hand-placed set, which is the opposite
     * choice to `reclamation-closing-entry` and is argued in the header: its
     * contested patch lands on the map centre, 78.71 m from the bonded store
     * and 111.51 m from the counting house, so it touches no lot — and it
     * sits ON the clerks' corridor, which is what makes the escort compete
     * with the economy for the same road.
     *
     * The opening frame looks down the lane from the yard toward the
     * counting house, so the first thing on screen is the direction the
     * operation goes. `Shell.applyCameraPostBoot` re-poses on `findHome`,
     * which finds the Foundry; this is what the headless and `?shot=` paths
     * read.
     * ================================================================== */
    addStartOre(b, spots, b.sea);

    b.setCameraFocus(
      home.x + (HOUSE.x - home.x) * 0.6,
      home.z + (HOUSE.z - home.z) * 0.6,
    );
    b.scatter({ minX: cx - 180, minZ: cz - 180, maxX: cx + 180, maxZ: cz + 180 }, 150);
    void start;
  },
});
