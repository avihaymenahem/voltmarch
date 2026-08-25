/**
 * ============================================================================
 * LAYOUT — allies.09.made-good
 * ============================================================================
 * THE GROUND IS THE OPERATION HERE MORE LITERALLY THAN ANYWHERE ELSE IN THIS
 * CHAPTER, because the operation's whole claim is that the corrected schedule
 * points at ground the published one had as open water. So the map is not a
 * backdrop the fiction is draped over: it is the one preset in the game where
 * *there is land the schedule does not know about*, and there is exactly one.
 *
 * `MAP_PRESETS.atoll` -> `MAP_SEAS.atoll` -> `ARCHIPELAGO_SEA`. Four
 * axis-aligned ellipses of semi-axis 98 m at the corners of a 276 x 268 m
 * rectangle on the map's diagonal, and **no land route between any two of
 * them** — the property `mapForcesSeaCrossing` is true of this map and of
 * nowhere else. `startPointsFor` reads `sea.islands` and hands back ONE START
 * PER ISLAND, `islands.slice(0, n)`, IN TABLE ORDER AND WITHOUT CONSULTING THE
 * SEED. At `armies: 2` that is islands 0 and 1 and only those:
 *
 *     island 0   (118, 390)   the Works           SEATED — seat 0
 *     island 1   (394, 122)   Cregg's yard        SEATED — seat 1
 *     island 2   (394, 390)   BENCH NINE          NOT SEATED — the operation
 *     island 3   (118, 122)   unnamed             NOT SEATED — and unused
 *
 * **THAT `slice` IS WHY THIS OPERATION IS POSSIBLE AT ALL.** Two of the four
 * islands are not anybody's start, which means the terrain generator levels no
 * shelf on them, `addStartOre` seeds no field on them (`addIslandOre` iterates
 * SPOTS, not islands), and `buildBaseFor` never runs there. They are the only
 * ground in the shipped game that is real, reachable and entirely unfurnished —
 * which is precisely what "ground nobody ever sited anything on" has to be.
 *
 * ============================================================================
 * EVERY NUMBER BELOW IS MEASURED ON THE BUILT WORLD, AND HERE IS THE
 * INSTRUMENT
 * ============================================================================
 * A `Terrain` constructed exactly as `tests/campaign-maps.spec.ts` constructs
 * it — `seed: 20_261_005`, `biome: 'temperate'`, `sea: MAP_SEAS.atoll`,
 * `starts: startPointsFor(2, sea, 7_077)` — then read directly:
 *
 *     wet(x, z)        `terrain.heightAt(x, z) < WATER_LEVEL` (2.0)
 *     buildable(x, z)  `terrain.isBuildable(worldToCell(x), worldToCell(z))`
 *     passable(x, z)   `terrain.isPassable(worldToCell(x), worldToCell(z), loco)`
 *
 * **`isBuildable` AND `isPassable` TAKE CELLS AND `heightAt` TAKES METRES**, and
 * the first version of this survey passed world metres to `isBuildable`. It did
 * not throw. It reported 0.0% buildable ground on all four islands including the
 * two the generator had just levelled a shelf on, and only the island at the LOW
 * corner — (118, 122), where a metre value happens to be a legal cell index —
 * came back non-zero. A confident, self-consistent, entirely wrong table. It is
 * recorded because the failure has no symptom: the numbers look like numbers.
 *
 * ============================================================================
 * 1. THE SURVEY: SIX ROLLS, AND WHAT EACH LOST ON
 * ============================================================================
 * The chapter's `mapSeed` counter runs +7 a week from `allies.05.forced-closure`'s
 * 20 260 935, so the convention gives 20 260 963 here. Six rolls were built and
 * scored on the four things this operation actually rests on: how much of
 * ISLAND 2 a tank can stand on, how much of it a structure can stand on, the
 * width of the water on the crossing, and whether the west shore offers a
 * beachhead a lift can put men onto.
 *
 *     roll          island2 pass   island2 build   crossing at z=390
 *     20 260 963       88.2%          60.2%           82 m
 *     20 260 970       89.8%          58.6%           80 m     (taken by A7)
 *     20 260 977       86.0%          52.6%           84 m
 *     20 261 005       93.7%          61.9%           74 m     <- taken
 *     20 261 019       91.8%          60.3%           82 m
 *     20 261 026       86.6%          57.2%           80 m
 *
 * 20 261 005 is the best roll on BOTH island-2 columns and the narrowest water.
 * The margin is real but it is NARROW, and the arithmetic is taken off the
 * table above rather than by eye: 93.7% passable is **1.9 points** clear of the
 * next best (20 261 019 at 91.8) and **5.5** clear of the convention's own roll
 * (20 260 963 at 88.2). Island 0, the player's own, comes out 98.6% / 68.1% on
 * the same roll, so nothing was traded for it.
 *
 * **BOTH ISLAND COLUMNS AND THE ISLAND-0 LINE WERE RE-MEASURED AND ALL THREE
 * MOVED, AND THE SUMMARY SENTENCE ABOVE THEM USED TO CONTRADICT THE TABLE IT
 * SAT UNDER.** The first version of this survey read 85.3 / 58.2 … 92.0 / 61.2
 * and claimed "4.6 points clear of the next best and 7.8 clear of the
 * convention's own roll" — figures that do not follow from the numbers printed
 * three lines above them in EITHER the old table (which gives 2.0 and 6.7) or
 * this one. Re-run on the instrument named at the head of this block the
 * passable and buildable fractions come out **0.6 to 3.2 points higher on every
 * one of the twelve island cells**, while the six crossing widths reproduce to
 * the metre and so do all five rows of §2's own scan — so the defect was in the
 * two island columns and the sentence beneath them and nowhere else, and the
 * seed CHOICE it produced is untouched: 20 261 005 still wins every column on
 * both instruments. A number quoted from a survey nobody re-ran is the defect
 * `docs/SPEC_DRIFT_AUDIT.md` catalogues, and a summary sentence that disagrees
 * with its own table is that defect with the evidence sitting next to it.
 *
 * **THE SWEEP IS SIX AND IT IS QUOTED AS SIX.** A3 sampled eleven and A4 forty.
 * An archipelago's variance is narrower than a continent's by construction —
 * the island ellipses are fixed geometry that `mapSeed` cannot move, and only
 * the relief inside them rolls — so the spread above is the whole spread, and
 * the sweep was stopped when a roll won every column at once.
 *
 * ============================================================================
 * 2. THE CROSSING, MEASURED ACROSS FIVE LINES
 * ============================================================================
 * Water is scanned along `x` at fixed `z`, between island 0's east shore and
 * island 2's west shore, on the taken roll:
 *
 *     z = 360    water x 208..300    94 m
 *     z = 375    water x 214..294    82 m
 *     z = 390    water x 222..294    74 m    <- the lane the lift uses
 *     z = 405    water x 214..298    86 m
 *     z = 420    water x 210..300    92 m
 *
 * **SEVENTY-FOUR METRES IS THE NARROWEST WATER ON THE MAP AND IT IS STILL
 * WATER, WHICH IS MEASURED AND NOT INFERRED.** `ARCHIPELAGO_SEA.shoals` lays a
 * channel bar at (256, 390), 44 x 28 m at `depth` 1.1, squarely across the
 * shortest crossing — and the scan above finds the water at z = 390 UNBROKEN
 * from x = 222 to x = 294, so the bar is submerged and every cell of it is wet.
 * There is no ford anywhere on this map and nothing in this layout creates one.
 *
 * **BUT "A HULL THAT CROSSES IS CARRIED" IS FALSE AS A STATEMENT ABOUT THE
 * GAME, AND THIS PARAGRAPH ASSERTED IT.** No GROUND locomotor may enter a wet
 * cell — that much is measured, and the falsifier is in the file: an
 * 8-connected Dijkstra over the real `FlowFieldCache.costGridFor(MoveClass.Foot)`
 * on the built world returns UNREACHABLE from the player's island to Bench
 * Nine, on a grid that is demonstrably refusing something (it blocks 8 599 of
 * 16 384 cells for Naval and 1 443 for Hover). **The swimmers are a different
 * class and both armies own one, ungated.** `frogman` is `Locomotor.Foot` plus
 * an `amphibious` def bit, which resolves to `MoveClass.Hover`; it costs 350,
 * its only prereq is `barracks`, it carries no `unlockedBy` at all, and seat 0
 * opens holding a barracks. The same Dijkstra over `costGridFor(MoveClass.Hover)`
 * walks to the strand cell in **272.1 m**, which is **94 seconds** at that
 * hull's 2.9 m/s. **THE START CELL IS PART OF THE MEASUREMENT AND IS QUOTED
 * RATHER THAN LEFT TO THE READER**: (70, 358), the nearest hover-open cell to
 * the player's barracks, which is the ground a produced man egresses onto — a
 * route quoted from some other point on the island is a different number, and
 * trap 20 in this repo's authoring guidance is exactly that mistake in the
 * other direction.
 *
 * **AND THAT START CELL IS NOW WRONG, WHICH IS EASIER TO SEE THAN THE METRES
 * ARE.** The barracks stood at (72, 364) when this was written and stands at
 * **(76, 344)** — `bb83ffb` rebuilt the procedural bases on the placement grid.
 * (70, 362) was inside the OLD barracks' 2x2 footprint and therefore blocked,
 * which is exactly why (70, 358) was the nearest open cell then; today (70, 362)
 * is open. **The 272.1 m and the ninety-four seconds have NOT been re-measured**
 * and are a fact about the old ground: an independent Dijkstra on this tree
 * returns neither the published figure from the published start cell nor from
 * the landed barracks, which means the goal convention was never named either.
 * Re-take the route and the start cell together, and name the goal, before
 * quoting any of it again. Cregg's
 * `rclDredger` (300 credits, `prereqs: ['rclRookery']`, also ungated, also
 * `amphibious`) has the identical route from his own island.
 *
 * That is a real alternative to the boats and it is priced rather than denied:
 * six swimmers is 2 100 credits of a 6 000 bank, ninety-four seconds a man on
 * open water with no cover and no way to shoot back at anything on the beach,
 * against eight slots that cross in sixteen seconds and can carry a Warden. It
 * is deliberately NOT closed by the roster — `THE NAVY IS NOT PROGRESSION-GATED,
 * ANYWHERE` is a standing policy in CLAUDE.md and the swimmers are the infantry
 * half of it — so the honest thing is to say what it costs, which the operation
 * header and `t.brief` now both do.
 *
 * Island 2's west shore is walkable where it is wet-adjacent, which is what a
 * landing needs and is not automatic: sampled every 15 degrees round the island,
 * land begins at r = 92..100 m and the first dry cell is passable to Foot AND to
 * Track on **19 of the 24 bearings**. The five that are not are (394, 488),
 * (323, 461), (346, 307), (369, 295) and (465, 319) — scattered round the south
 * and north rather than clustered, and none of them on the lane: the west shore
 * at (296, 390) is passable to both.
 *
 * ============================================================================
 * 3. THE POINTS
 * ============================================================================
 * Seven points and three discs. The operation imports the five it names —
 * `SHINGLE`, `CROSS`, `SHINGLE_AREA`, `BERTH_AREA`, `BENCH_AREA` — rather than
 * restating any of them; the other five are this file's alone and are exported
 * so that a reader chasing a distance finds it defined once. A number written
 * in two modules is a number that disagrees the first time either is tuned, and
 * the failure — a lift unloading into the sea, a reveal framing nothing — is
 * invisible to every gate.
 * ========================================================================== */

import { NONE } from '../../core/types';
import {
  addStartOre, buildBaseFor, islandSeats, startSpots, wrapDeg,
} from '../../game/Scenarios';
import type { EntityId, PlayerId } from '../../core/types';
import type { Area, Point } from '../types';
import { layout } from '../layout';

/* ==========================================================================
 * 1. GEOMETRY
 * ========================================================================== */

/**
 * The Works landing yard, on island 0's EAST shore — the side facing Bench
 * Nine.
 *
 * **IT IS PLACED BY THE LAYOUT BECAUSE THE PLAYER COULD NOT BUILD IT HERE, AND
 * THAT IS A MEASUREMENT RATHER THAN A KINDNESS.** `islandSeats` seats an
 * archipelago opening 30 m off its island centre TANGENTIALLY — `outward`
 * turned a quarter turn, a swap and a sign flip, so no `sin`/`cos` enters the
 * generator — which puts seat 0 at about (97.1, 368.5), on the island's
 * SOUTH-WEST side. `Placement.withinBuildRadius` gives a Construction Yard
 * `BUILD_RADIUS` 56 m plus its own radius; the yard lands at **(102, 370)** on
 * the built world, and the east shore at z = 384 begins at x = 210 — **108.9 m**
 * from it. So the one coast that faces the objective is very nearly twice the
 * build envelope away — 108.9 m against 2 x 56 = 112, where it used to be
 * 113.4 m and therefore over it — and a player who wanted
 * a dock there would have to creep a chain of power plants to it — the
 * 800-credits-a-step workaround `Scenarios.ts` calls "a workaround for a start
 * position, not a strategy".
 *
 * The fiction is the measurement: the Works have ONE landing yard and they have
 * already put it where it has to be. The player is not being handed a shortcut;
 * they are being handed the only berth on the correct side of their own island.
 *
 * `spawnBuilding` applies no coastal test of any kind — it snaps the footprint
 * to the grid and consults `connectedGround` for `Locomotor.Track` only — so
 * this point is chosen against the water rather than against the placement
 * rules, **and whether it can LAUNCH is therefore a separate measurement that
 * had to be taken.** The yard lands at (206, 386) after the footprint snap, it
 * is 3 x 3 cells, and the nearest wet cell to its centre is **12.8 m**. That is
 * 3.2 cells against `PRODUCTION.navalEgressRings` 15, which is what
 * `Production.findEgressSpot` is allowed to spend looking for a launch cell —
 * so a hull queued here comes out with forty-seven metres of margin. It also
 * clears `PRODUCTION.shoreWaterCells` 8, the test `evaluatePlacement` applies
 * before it will let a player found one, so this is a site the ordinary rules
 * would have accepted and not a privileged placement. Those two constants are
 * ONE RULE — `config.ts` says so in capitals — and a berth that satisfied the
 * first and not the second is a paid-for queue that never produces anything.
 */
export const MOOR: Point = { x: 206, z: 384 };

/**
 * Where the two landing craft lie at t = 0.
 *
 * The two craft are placed at `BERTH.z` -/+ 8, which is 26.7 and 27.9 m from
 * where the yard landed, and **both come to rest on the authored points
 * exactly** — read off the entity store after the build. That is the PROOF they
 * are afloat rather than an assertion that they are: `spawnUnit` resolves
 * `connectedGround` against the CHASSIS, `landingCraft` carries `waterOnly` so
 * the chassis is `MoveClass.Naval`, and a point that was not already a legal
 * naval cell would have been MOVED. Nothing moved.
 */
export const BERTH: Point = { x: 232, z: 384 };

/**
 * THE STRAND. The beachhead on Bench Nine's west shore, and the single most
 * load-bearing point in the operation: **seven of the trigger table's twenty-four
 * rows read a disc around it** — the four lifts through `BEACH_HELD`, `t.ashore`
 * itself, and `t.close` and `t.beaten` through `BOTH_ON_THE_GROUND` — four
 * scripted lifts unload on the point, and the primary objective is a headcount
 * inside the disc. (This block said "three triggers", which counted the two
 * losses and the primary and forgot that every lift gate reads it too.)
 *
 * (314, 390) sits 18 m inland of the waterline at (296, 390) and inside the
 * broad buildable shelf the west shore carries on this roll — sampled at 4 m in
 * x and 6 m in z, every cell in x 318..330 by z 366..414 is BUILDABLE, and
 * x 302..314 is a mixture of buildable and merely passable. The three ring
 * shapes the lifts draw around it — four at r = 10 and five at r = 12 on Foot,
 * two at r = 16 on Track — are checked point by point against each wave's own
 * locomotor by `tests/campaign-spawn-ground.spec.ts`, which is the gate rather
 * than this paragraph.
 *
 * **IT IS DELIBERATELY NOT ON THE WATERLINE.** `Transport.place` walks a
 * widening ring for a cell the PASSENGER can stand on and unloads from open
 * water, so the player's own crossing does not need a point at all; what needs
 * one is `spawnUnits`, which writes its computed ring point VERBATIM with no
 * `connectedGround` and no egress search. Eighteen metres is the margin that
 * keeps a four-man ring off the sea.
 */
export const SHINGLE: Point = { x: 314, z: 390 };

/**
 * The Reclamation's sorting floor — `refinery`, which `keyFor` resolves on a
 * Reclamation seat to `rclSorter`. Tagged `crew`.
 *
 * The literal is accepted at ring zero and `spawnBuilding`'s footprint snap
 * moves it 2 m to **(372, 390)**, which is 58.0 m inland of `SHINGLE`. It is
 * the near half of the objective and the one a player meets first.
 *
 * (It landed at (370, 392) until `bb83ffb` made the snap read the FACED
 * footprint: `refinery` is 3x2 and this is raised at yawDeg 270, so the swapped
 * 2x3 lattice moves it the other way. The two other points in this block are
 * the control — SHINGLE-to-HEAD 63.8 m and CROSS-to-SHINGLE 113.2 m both still
 * reproduce exactly.)
 */
export const FLOOR: Point = { x: 370, z: 390 };

/**
 * The breaking yard itself — `warFactory` -> `rclBreakerYard`. Tagged `crew`.
 *
 * **THE LITERAL WAS THE LANDED POSITION AND IT WAS AUTHORED THAT WAY ROUND ON
 * PURPOSE. IT IS NOT ANY MORE.** It read (396, 390) — the island centre — and
 * the `place()` ring search rejected ring zero and took it 6 m west, after
 * which the footprint snap moved it 2 m south. That is a six-metre difference
 * nothing would ever have reported: every tag lands, every gate passes, and
 * only the distances in these two headers are wrong. So the literal was
 * corrected to the measured landing.
 *
 * **`bb83ffb` HAS SINCE UN-CORRECTED IT.** `warFactory` is 3x2 and this is
 * raised at yawDeg 270, and `spawnBuilding` now snaps on the FACED footprint,
 * so the structure stands at **(392, 394)** — 2.83 m off this literal again,
 * in the opposite direction from the original slip. Every figure below is
 * measured from where it stands.
 *
 * 78.1 m from `SHINGLE` and 20.4 m beyond the sorting floor.
 * **A REAL FACTORY AND NOT A PROP:**
 * `EntityFlag.IsFactory | PrimaryFactory`, so the seat produces hulls on the
 * bench for as long as it stands, which is what makes clearing the crew a
 * decision about WHEN rather than only about damage.
 */
export const YARD: Point = { x: 390, z: 392 };

/**
 * The bore head Cregg's crew sank into the new seam — `civOreMine`, on SEAT 1
 * rather than on Gaia, and the operation's secondary. Tagged `head`.
 *
 * SEAT 1 IS THE WHOLE POINT OF IT. A Gaia structure is allied to every seat and
 * cannot be shot at; this one can be, which is what makes "take it whole"
 * a decision rather than a formality. `CaptureService.isCapturable` answers yes
 * to an engineer and no to every hull in the game — no vehicle in any army
 * carries `canCapture` — so the only route to the secondary is a man walked
 * sixty-four metres up a defended beach — 63.8 m from `SHINGLE`, on a literal
 * taken at ring zero — and the only route past it is a gun.
 * `pact.01.shallow-road` establishes the same reading of the same def.
 *
 * `CIVILIAN_MINE_INCOME` is 5 credits a second, so from the moment it changes
 * hands it pays 300 a minute to whoever holds it. Taken at minute ten of
 * twenty-two it is worth 3 600 credits; broken, it is worth nothing to anybody,
 * which is the honest price of the cheap answer.
 */
export const HEAD: Point = { x: 368, z: 356 };

/**
 * Where Cregg's own lifts put men on the bench: the north shore, facing his
 * island across the north strait.
 *
 * **(396, 312) IS A SEARCHED POINT AND THE FIRST ONE AUTHORED WAS IN THE SEA.**
 * `spawnUnits` lands unit `i` of `count` at exactly `angle = i / count * 2 PI`,
 * radius `spread`, and writes that point VERBATIM — no `connectedGround`, no
 * egress search. This operation drops five different wave shapes here
 * (4 at r=12, 5 at r=14, 2 and 3 at r=18, all of them Foot or Wheel), so the
 * point has to be dry at seventeen exact bearings and not merely "on the north
 * shore". (394, 302) was authored by eye at 10 m inland of the waterline and
 * `tests/campaign-spawn-ground.spec.ts` refused it with NINE drops in the water
 * and one on relief — the north bearing of an 18 m ring is 8 m out to sea, and
 * a rock shelf at x = 380 takes the 144-degree bearing of the 14 m one.
 *
 * The replacement is not a nudge: every 2 m point inside island 2 was tested
 * against all five ring shapes through the real `Terrain.isPassable` for each
 * wave's own locomotor, which returned **973 clean candidates**, and this is the
 * one of them that sits due north of the breaking yard on the shore facing
 * Cregg's island. 82.1 m from the breaking yard as it stands and 113.2 m from
 * `SHINGLE`: his
 * reinforcement lands on the far side of his own holding from the player's,
 * which is what makes the bench a fight along an axis rather than a mêlée on a
 * beach.
 *
 * **THE SYMMETRY IS REAL AND IT IS THE OPERATION'S FAIRNESS ARGUMENT.** Island
 * 1's south shore to island 2's north shore is 72 m of water; island 0's east
 * shore to island 2's west shore is 74 m. Neither side is closer to the bench
 * and neither side can walk to it. The Allies are not being asked to do
 * something the Reclamation did not already do.
 */
export const CROSS: Point = { x: 396, z: 312 };

/* -- the discs ------------------------------------------------------------ */

/**
 * THE BEACHHEAD. **IT IS A LAND DISC, AND THE RADIUS IS WHAT MAKES IT ONE.**
 *
 * ============================================================================
 * THE r = 26 THIS SHIPPED WITH PUT A TENTH OF THE PRIMARY OBJECTIVE OUT TO SEA
 * ============================================================================
 * The derivation it carried was *"26 m from (314, 390) reaches back to x = 288,
 * which is 8 m PAST the waterline at 296 — so a man who has just been set down
 * on the sand by `Transport.place` is already inside it"*. Eight metres past
 * the waterline is eight metres of COUNTABLE SEA, and
 * `runtime.ts#unitsInArea`'s untagged branch filters on owner, `IS_UNIT`
 * (Infantry OR Vehicle) and `PendingDestroy` and NOTHING ELSE — no ground test,
 * and no `EntityFlag.Garrisoned` test — while `TransportService.carry` parks
 * every passenger's `posX`/`posZ` on the hull carrying them. So ONE loaded
 * landing craft standing off the beach read as **five** units ashore — its own
 * hull and the four men in it — and the operation's primary and its lift gate
 * both completed with the ramp still up.
 *
 * Measured in the engine on the built world (real `TransportService`, real
 * `makeWorldQuery`, `mapSeed` 20 261 005): the two moored craft sailed to the
 * two nearest naval cells read `unitsInArea(0, r26, null) = 2` empty; four
 * `gi` boarded through a real `OrderKind.Enter` and one `transport.simTick`
 * take it to **6**, against a primary that wants 6 — and **0 of those 6 bodies
 * stand on dry land**. At r = 17 the same world reads **0**.
 *
 * **AND THE WHOLE CHAIN WAS RUN END TO END THROUGH THE REAL `runDirector`
 * AGAINST A REAL `makeWorldQuery`, WHICH IS THE READING THAT SETTLES IT.** One
 * loaded craft at (294, 390) and one empty one at (298, 402), warmed to minute
 * six:
 *
 *     boats afloat, four aboard    r26 reads 6, r17 reads 0
 *                                  t.ashore fired FALSE, t.lift1 fired FALSE
 *     after a real unload          r17 reads 4, t.lift1 fired TRUE
 *     six walked onto the strand   r17 reads 6, t.ashore fired TRUE
 *
 * The middle row is the falsifier: the fix does not merely stop the boats
 * counting, it leaves the mechanic working — the lift opens on a landing and
 * the primary closes on a headcount, both from the same disc, one radius later.
 *
 * ============================================================================
 * 17 IS DERIVED, AND IT IS THE LARGEST INTEGER THAT WORKS
 * ============================================================================
 * A hull's centre may sit ANYWHERE inside a cell its class may occupy, so the
 * test is not "is the cell centre in the disc" but "does any naval-passable
 * cell OVERLAP the disc at all". Swept over the built world against the real
 * `FlowFieldCache.costGridFor(MoveClass.Naval)` — which blocks 8 599 of 16 384
 * cells, so it is refusing something rather than answering yes to everything:
 *
 *     r    wet 1 m samples    naval cells overlapping    dry foot cells inside
 *     16        0 / 797                 0                        49
 *     17        0 / 901                 0                        61
 *     18        0 / 1009                2                        69
 *     26      225 / 2121               21                       121
 *
 * **18 IS WHERE IT BREAKS AND THE CELL THAT BREAKS IT IS NOT THE OBVIOUS ONE.**
 * The nearest naval-passable cell CENTRE is (294, 390) at 20.00 m — the reading
 * that makes r = 19 look safe — but the nearest naval-passable cell EDGE is
 * (298, 402)'s corner at **17.20 m**, and a hull centred there is inside an 18 m
 * disc. Quoting the centre distance is the same class of error as the sentence
 * this block replaces.
 *
 * ============================================================================
 * AND IT STILL COVERS EVERY MAN THE OPERATION PUTS ON THE SAND
 * ============================================================================
 * The three lift ring shapes are r = 10, r = 12 and r = 16 about this same
 * point, so every scripted drop is inside 17 by construction — the tightest is
 * the two-Warden ring at exactly 16.0 m, since `count: 2` puts them on the +x
 * and -x bearings and `spawnUnits` writes the ring point verbatim.
 *
 * The player's own crossing was measured rather than assumed. Driving the real
 * `TransportService.unload` from each of the three nearest naval cells, a
 * four-man stick is set down at
 *
 *     hull (294, 390)   16.0  16.0  13.4  16.0     4 of 4 inside r = 17
 *     hull (294, 394)   17.6  17.6  14.0  15.4     2 of 4
 *     hull (298, 402)   20.2  20.2  15.3  13.5     2 of 4
 *
 * — because `Transport.place` searches OUTWARD from a hull that is itself 20 m
 * out, so part of a stick lands on the disc and part lands just short of it and
 * walks the rest. That is enough for `BEACH_HELD`, which wants ONE, and the
 * six-man primary is a headcount the player assembles rather than one the ramp
 * delivers. Under the old radius the ramp delivered it without opening.
 */
export const SHINGLE_AREA: Area = { x: SHINGLE.x, z: SHINGLE.z, r: 17 };

/** 34 m over the berth: the two craft and the yard's own frontage. */
export const BERTH_AREA: Area = { x: BERTH.x, z: BERTH.z, r: 34 };

/**
 * The whole of what the player is being sent at, shown once, and the radius is
 * derived rather than chosen. (378, 379) WAS the centroid of the crew's three
 * structures and is now 1.0 m off it — the two non-square ones moved 2.83 m
 * each under the faced-footprint snap, and the true centroid is (377.33, 380.0)
 * — so this stays as the authored point and the six distances below are
 * measured from it. 70 m from it reaches the sorting floor at 12.5 m, the
 * breaking yard at 20.5, the bore head at 25.1, the two posts at 30.5 and 20.2,
 * AND the strand at 64.9 — so one reveal frames the objective and the beach it
 * is reached from in the same rectangle. At 62 m the strand falls outside it
 * and the player is shown a fight with no way in.
 */
export const BENCH_AREA: Area = { x: 378, z: 379, r: 70 };

/* ==========================================================================
 * 2. PLACEMENT
 * ========================================================================== */

/**
 * The crew's two guns, as world offsets from where each structure LANDED.
 *
 * **`pillbox` RESOLVES THROUGH `keyFor` ON A RECLAMATION SEAT TO `rclSpitpost`,
 * AND THAT RESOLUTION WAS CHECKED RATHER THAN ASSUMED.** `postCoil` reaches
 * 20 m and it CHAINS (`chainCount: 1`), so one trigger pull is
 * 34 x `ARMOR_MATRIX[Tesla][Infantry]` 1.60 x `COMBAT_DAMAGE.globalMul` 0.80 =
 * **43.52**, and the second link is 43.52 x `teslaChainFalloff` 0.6 = **26.11**.
 * Against a G.I.'s 120 hp that is ZERO killed per pull and against a 90 hp
 * engineer it is also zero — three pulls to kill the first man, and he is being
 * escorted. `allies.06.machine-time` records the same arithmetic about the same
 * def one operation earlier.
 *
 * **THE POST IS NOT THE HAZARD; THE PYLON WOULD HAVE BEEN.** `roster.ai` is
 * empty, so `struct.defence.specialist` is withheld and `rclPylon` — 28 m,
 * `chainCount: 3`, 120.32 on the first link — cannot be founded anywhere on
 * this map by either seat. That is the one line in the operation file keeping
 * the bore head capturable at all: a Pylon founded within 28 m of it kills a
 * 90 hp engineer on the first link and the second, and the secondary would be
 * unreachable with every gate green.
 *
 * **BOTH OFFSETS ARE MEASURED AGAINST THE GUN'S OWN REACH AND THE FIRST PAIR
 * WERE NOT.** They were [-18, 14] and [10, -16], which put the posts 21.3 m and
 * 21.6 m from the structures they are there to cover — **past `postCoil`'s
 * 20 m**, so neither gun bore on its own building and neither was inside the
 * scope `tests/campaign-emplacement-reach.spec.ts` §2 measures. The suite was
 * green and the operation contributed nothing to it. At [-12, 10] and [8, -12]
 * the posts land at (358, 402) and (398, 382) — **18.4 m from the sorting floor
 * and 13.4 m from the breaking yard** — so an engineer walked at either
 * structure is under a gun, which is the content, and §2 is now measuring
 * something.
 *
 * TWO RATHER THAN FOUR. The bench is 76 m deep from the strand to the yard and
 * the crew is a crew, not a garrison; four posts turns the push into a gun line
 * and the operation is about the water, not about the wall.
 */
type Offset = readonly [dx: number, dz: number];
const FLOOR_GUN: Offset = [-12, 10];
const YARD_GUN: Offset = [8, -12];

/** Rings searched outward for a legal footprint, in metres. Nearest first. */
const PLACE_RINGS: readonly number[] = [0, 6, 12, 18, 26, 34];
/** Eight exact bearings. Integers only, so every candidate is bit-identical. */
const PLACE_BEARINGS: readonly (readonly [number, number])[] = [
  [1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
];
/** Ring zero is the nominal spot itself; the bearings would test it eight times. */
const ORIGIN_ONLY: readonly (readonly [number, number])[] = [[0, 0]];

/** Metres reserved around each placement so `scatter` leaves it clear. */
const FLOOR_CLEAR = 20;
const YARD_CLEAR = 20;
const HEAD_CLEAR = 16;
const GUN_CLEAR = 10;
const MOOR_CLEAR = 18;

/**
 * The seam under Bench Nine, which is the operation's own evidence.
 *
 * TWO FIELDS, AND THEY ARE THE REASON THE ISLAND IS WORTH ANYTHING. `addStartOre`
 * takes the archipelago branch and calls `addIslandOre`, which iterates the
 * SEATED SPOTS — so islands 2 and 3 get no ore from the shipped helper and
 * every other layout in this repo would leave this ground bare. Seeding it here
 * is not dressing: the corrected schedule's entire claim is that the March
 * surfaces under this bench, and a player who lands and finds nothing has been
 * told the chapter was wrong.
 *
 * They are placed so that the near field is inside the beachhead's own reach —
 * (348, 404) is 36.8 m from `SHINGLE` — and the far one is behind the crew, at
 * 107.5 m, so holding the strand pays and taking the bench pays more.
 */
const BENCH_ORE: readonly (readonly [number, number, number])[] = [
  [348, 404, 26],
  [420, 372, 24],
];

/* ==========================================================================
 * 3. THE BUILD
 * ========================================================================== */

export default layout({
  id: 'allies-made-good',
  /*
   * THREE THIS FILE STAMPS AND ELEVEN THE TRIGGER TABLE PRODUCES.
   *
   * `validateCampaign` refuses a trigger naming a tag its layout does not
   * DECLARE, whether or not the layout is the thing that stamps it — so the
   * five Reclamation troops, the keyed one and the four lifts are declared
   * here, in the file that owns the ground, which is where a reader looking for
   * "where does this come from" goes first. `campaign-maps.spec.ts` knows the
   * difference: it skips a declared tag that some `spawnUnits` produces and
   * requires every other one to have landed on a real entity.
   */
  tags: [
    'crew', 'head', 'lift',
    'crew1', 'crew2', 'crew3', 'crew4', 'crew5', 'watch',
    'lift1', 'lift2', 'lift3', 'lift4',
  ],

  build(b, cx, cz, start, c) {
    const spots = startSpots(cx, cz, b.armies, b.sea, b.seed);
    const seats = islandSeats(spots, b.sea);
    const us: PlayerId = c.seat(0);
    const them: PlayerId = c.seat(1);
    const home = seats[0];
    const foe = seats[1] ?? seats[0];

    /*
     * THE ONE GUARD THIS LAYOUT NEEDS, AND IT IS NOT THE ONE THE CONTINENTAL
     * LAYOUTS CARRY.
     *
     * `allies-misclosure` and friends check `(cx, cz)` against the map centre,
     * because `startSpots` derives a continental opening from it. An
     * archipelago ignores `cx`/`cz` entirely — `startSpots`'s island branch
     * says so in its own header — and takes its positions from the island list,
     * which is fixed geometry `mapSeed` cannot move. So the thing that could
     * actually go wrong here is the opposite one: this operation being built on
     * a preset with NO islands at all, in which case every literal below is a
     * point in the middle of a continent and the whole file is dressing ground
     * nobody is fighting over. `b.archipelago` is the exact predicate.
     */
    if (!b.archipelago) {
      console.error(
        '[allies-made-good] built on a preset with no islands. Every point in this layout is '
        + 'authored against ARCHIPELAGO_SEA\'s four ellipses and none of them means anything '
        + 'here — the operation must declare `preset: \'atoll\'`.',
      );
    }

    /* -- placement --------------------------------------------------------
     * `footprintBuildable` AND `footprintClear`, searched in rings with a fixed
     * traversal order so two runs of one seed build the same world.
     *
     * `findClearFootprint` ALONE ANSWERS THE WRONG QUESTION — it tests
     * occupancy and connectivity and nothing about grade — so it is the
     * fallback and nothing on this ground reaches it.
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

    const raise = (
      owner: PlayerId, key: string, where: Point, tag: string | null, yawDeg: number, clear: number,
    ): EntityId => {
      const id = b.spawnBuilding(key, owner, where.x, where.z, { yawDeg });
      if (tag !== null) c.tag(tag, id);
      if (id !== NONE) b.block(where.x, where.z, clear);
      return id;
    };

    /* -- the two openings -------------------------------------------------
     * `islandSeats` rather than the raw spots, and the 30 m tangential offset
     * it applies is what puts a coastal dock site inside each opening's build
     * radius at all — `Scenarios.ts` measures 532 coastal 3x3 sites on this map
     * against ZERO inside the envelope of a yard seated on the island centre.
     */
    buildBaseFor(b, us, home.x, home.z, { facingDeg: wrapDeg(home.facingDeg + 180) });
    buildBaseFor(b, them, foe.x, foe.z, { facingDeg: wrapDeg(foe.facingDeg + 180) });

    /* -- the Works landing yard and the lift ------------------------------
     * The yard is UNTAGGED and the two craft are tagged `lift`. Nothing in the
     * trigger table reads the yard: it is a building the player owns like any
     * other, it can be shelled like any other, and the operation deliberately
     * does not end when it goes — a Construction Yard and 1 000 credits buys
     * another one, which is the reason this file authors no rescue.
     */
    raise(us, 'navalYard', place(us, 'navalYard', MOOR), null, 90, MOOR_CLEAR);
    for (const dz of [-8, 8]) {
      c.tag('lift', b.spawnUnit('landingCraft', us, BERTH.x, BERTH.z + dz, { yawDeg: 90 }));
    }

    /* -- the breaking crew on Bench Nine -----------------------------------
     * Both structures carry `crew`, and the primary is
     * `ownerCount(player 1, role 'building', tag 'crew', max: 0)` — OWNERSHIP,
     * so a capture satisfies it exactly as a demolition does. That is
     * deliberate and the objective title says so: the bench comes off them
     * either way, and an engineer walked up the beach is a legitimate answer to
     * a factory.
     */
    {
      const floor = place(them, 'refinery', FLOOR);
      raise(them, 'refinery', floor, 'crew', 270, FLOOR_CLEAR);
      const g = { x: floor.x + FLOOR_GUN[0], z: floor.z + FLOOR_GUN[1] };
      raise(them, 'pillbox', place(them, 'pillbox', g), null, 0, GUN_CLEAR);
    }
    {
      const yard = place(them, 'warFactory', YARD);
      raise(them, 'warFactory', yard, 'crew', 270, YARD_CLEAR);
      const g = { x: yard.x + YARD_GUN[0], z: yard.z + YARD_GUN[1] };
      raise(them, 'pillbox', place(them, 'pillbox', g), null, 0, GUN_CLEAR);
    }

    /* -- the bore head ------------------------------------------------------
     * SEAT 1, not Gaia. See the block above `HEAD`.
     */
    raise(them, 'civOreMine', place(them, 'civOreMine', HEAD), 'head', 180, HEAD_CLEAR);

    /* -- economy ------------------------------------------------------------
     * `addStartOre` takes the archipelago branch: a home field and an expansion
     * for each of the two SEATED islands and nothing anywhere else. The bench's
     * own seam is seeded here because nothing else will seed it.
     */
    addStartOre(b, spots, b.sea);
    for (const [ox, oz, r] of BENCH_ORE) b.addOre(ox, oz, r);

    /*
     * OPEN ON THE BERTH RATHER THAN ON THE YARD. Every other layout in this
     * chapter opens on the player's own base biased toward the map centre;
     * this one opens on two moored landing craft, because the first thing a
     * player has to understand here is that the operation is on the other side
     * of some water and those are how they get there. `t.open` moves the camera
     * on to the strand four seconds later.
     */
    b.setCameraFocus(MOOR.x - 24, MOOR.z);
    b.scatter({ minX: 20, minZ: 20, maxX: 492, maxZ: 492 }, 220);
    void start;
    void cx;
    void cz;
  },
});
