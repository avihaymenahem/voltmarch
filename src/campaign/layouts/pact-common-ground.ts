/**
 * ============================================================================
 * VOLTMARCH — src/campaign/layouts/pact-common-ground.ts
 * ============================================================================
 * THE GROUND FOR `pact.06.common-ground`: a cut in Pact seam country with a
 * salvage crew's sorter and furnace standing on it, their heap out on the haul
 * road, two Spitposts on the side the Order has to come from, two tenement
 * blocks belonging to the people who live on the crust, and the crew's field
 * office two thirds of the way to their own yard.
 *
 * **THIS FILE OWNS THE GEOMETRY AND THE OPERATION IMPORTS IT.** The dependency
 * runs operation -> layout and never back. A number written in two files is a
 * number that will disagree the first time either is tuned, and the failure — a
 * column attack-moving at empty ground, a reveal framing nothing, a disc drawn
 * off the thing it is about — is invisible to every gate.
 * `soviets-demolition-order.ts` states the same rule and this file follows it,
 * which is why the points below are ABSOLUTE and not fractions of the axis.
 *
 * Everything is measured on a headless build at `mapSeed` 41 213 /
 * `simSeed` 3 719 with the def tables BOUND and this operation's roster
 * INSTALLED — `tests/campaign-roster-ground.spec.ts`'s build, not
 * `tests/campaign-maps.spec.ts`'s, which passes no `defs` and installs no
 * roster. Ground truth is the real `Terrain`, the real
 * `FlowFieldCache.costGridFor`, and the entity store AFTER `spawnBuilding`
 * snapped every footprint. **RE-MEASURE, DO NOT RE-QUOTE**, if either seed moves.
 *
 * ============================================================================
 * 0. `keyFor` RESOLVES EVERY ROLE KEY AGAINST THE SEATED ARMY
 * ============================================================================
 * `OperationDef.foe` is `Faction.Reclaim`, so on the crew's seat
 * `ScenarioBuilder.keyFor` gives `refinery` -> `rclSorter`, `powerPlant` ->
 * `rclFurnace`, `oreSilo` -> `rclHeap`, `radar` -> `rclSpotter`, `pillbox` ->
 * `rclSpitpost`; and inside `buildBaseFor` the whole opening —
 * `grizzly` -> `rclGrinder`, `gi` -> `rclPicker`, `harvester` -> `rclScrapper`,
 * `engineer` -> `rclTinker`. On the Order's seat it gives
 * `grizzly` -> `mrdSolarch`, `gi` -> `mrdWayfarer`, `engineer` ->
 * `mrdArtificer`, `harvester` -> `mrdCollector`.
 *
 * **THE `pillbox` ROW IS THE ONE THAT HAS ALREADY COST AN OPERATION.**
 * `reclamation.01.held-paper` wrote `prismTower` against a Soviet seat and got
 * two Tesla Coils, and its own comment concluded the choice was "mechanically
 * free" from a true statement about the wrong property. So the picket was
 * resolved and its WEAPON read before either post was placed: `postCoil`, 20 m,
 * `chainCount` 1, 43.52 on the first link and 26.11 on the second against a
 * `mrdWayfarer`'s 110 hp — one pull cannot take two men.
 * `tests/campaign-emplacement-reach.spec.ts` §2 is the gate.
 *
 * The `civApartments` are the one key that is NOT remapped: `FACTION_KEY_MAP`
 * holds role keys only and the civilian block is faction-blind by construction
 * (`Faction.Neutral` in `Defs.ts`). They are raised on the PLAYER's seat here,
 * deliberately — see §5.
 *
 * ============================================================================
 * 1. THE FRAME
 * ============================================================================
 *     home (Order,   seat 0)   spot 108, 380   yard 114, 382
 *     foe  (salvage, seat 1)   spot 404, 380   yard 402, 382
 *
 * The FOE row is right and the HOME row was not, which is worth a sentence
 * because the asymmetry looks like a typo and is not: seat 1's `facingDeg` is
 * exactly -90 so its base facing is exactly 90, where the old raw-facing snap
 * and the new cardinalised one land on the same cell; seat 0 takes yaw 270,
 * where they do not.
 *     axis                     296.000 m, along +x at z 380
 *
 * `simSeed` 3 719 draws the EDGE pair. `seatedSlots` filters `START_PAIRS`
 * against the water and `temperate` has no `MAP_SEAS` row, so all four survive;
 * the four neighbouring seeds tried (3 651, 3 673, 3 701, 3 733) all draw the
 * 386.161 m diagonal instead. The edge is chosen for `pact.05.open-count`'s
 * reason: forty-eight metres of extra approach, on foot, four times over, turns
 * a race into a march.
 *
 * The cut is 58 m off the OPENING-TO-OPENING axis (the two start spots, at
 * z 380), which is what keeps traffic between the openings out of the standing
 * disc: that line clears the 26 m rim by **32 m**, and the yard-to-yard line two
 * metres further out clears it by 34.
 *
 * ============================================================================
 * 2. THE CUT — `SECTION` 274, 322
 * ============================================================================
 *     home -> the cut   170.88 m straight   195.2..206.0 foot   202.2..208.3 hover
 *     foe  -> the cut   141.36              146.0               146.0
 *     road -> the cut    87.21               96.4                96.4
 *
 * **THE `home` ROW IS A BAND BECAUSE ITS ANCHOR IS A UNIT.** Every walked figure
 * in this file is a Dijkstra over the real `FlowFieldCache.costGridFor` under the
 * engine's own expander rules — 8-connected, destination-cell weight,
 * `(nc * DIAG) | 0` on a diagonal, corner-cut refused — from the open cell
 * nearest the start to the open cell nearest the goal, and read in COST metres
 * (`dist / COST_UNIT * CELL`), which is what the planner actually minimises. The
 * band is every one of the five `mrdWayfarer` the layout spawns (Foot) and every
 * one of the four `mrdSolarch` (Hover), each snapped to its own cell.
 *
 * **A YARD CENTRE IS THE WRONG ANCHOR AND THIS ROW USED TO USE ONE.** It read
 * `210.1 m foot / 218.2 m hover/wheel`, and the two figures did not come from one
 * anchor: 218.2 is the cell nearest the Chapterhouse on the Hover grid, and 210.1
 * is the same Hover answer from the Conclave's cell (110, 374) wearing the FOOT
 * label — the real foot answer from that cell is 200.2. The foot grid forks at
 * z ~= 364 (§4), so a foot figure taken from a building centre can be either side
 * of the picket. Name the anchor or the number means nothing.
 *
 * 0.56 of the way along the axis and 58 m off it, which puts it in the crew's
 * half: the Order's garrison walks 202.2..208.3 m to reach it and the crew's
 * walks 146.0, so every exchange over the cut is one the player is further from
 * resupplying. `pact.04.in-the-clear` sits its objective at 0.34 for the
 * opposite reason — it is defending its own ground there and taking somebody
 * else's here.
 *
 * **THE STANDING DISC IS `SECTION_AREA`, r = 26, AND IT IS WHY THIS `mapSeed`
 * WAS CHOSEN.** The operation's second primary is four of the player's units
 * inside it at one instant, so the question a re-seed has to answer is how much
 * of it is ground anybody can stand on. Ten rolls swept at this `simSeed`, on
 * the bare heightfield before anything is placed — `open` counts a cell passable
 * to Foot AND Track AND Hover, so it is one number rather than three:
 *
 *     mapSeed   cut open   cut buildable   office buildable   road open   heap
 *     41 213     137/137      137/137           48/48          130/130    22/26
 *     30 907     137/137      130/137           47/48          130/130    26/26
 *     48 091     137/137      133/137           43/48          113/130    21/26
 *     61 519     137/137      132/137           38/48          127/130    15/26
 *     52 147     137/137      133/137           16/48           91/130     5/26
 *     26 113     117/137      109/137           41/48           79/130    19/26
 *     22 417     118/137       63/137           17/48           38/130    15/26
 *     11 021     111/137       57/137           44/48           77/130    26/26
 *     58 321     108/137      106/137           32/48          118/130    21/26
 *     17 389      95/137       67/137           35/48           98/130    16/26
 *
 * **41 213 is at maximum on four of the five columns and within four cells on
 * the fifth**, which is the only kind of survey worth writing down: it wins on
 * every criterion rather than on one. 30 907 is the runner-up and gives up seven
 * cells of buildable ground under the cut, which is exactly where the ring
 * search in §7 would start spending its margin.
 *
 * Once the plant, the picket and the row are ON it, the same disc reads
 * **126 of 137 open, the same 126 for Foot, Track and Hover** — eleven cells
 * eaten by the sorter's 3x2 and the furnace's 2x2 — so the ground the player has
 * to put four hulls on is still nine tenths of the disc.
 *
 * **THE ORE IS THE HAZARD NOBODY WOULD HAVE SEEN.** `runtime.ts#unitsInArea`
 * counts Infantry and Vehicles and a harvester is a Vehicle, so a field inside
 * the standing disc would let the economy answer the primary on its own, in
 * silence. `addStartOre` declares three here — r 30 at 126, 424 and r 30 at
 * 386, 336 beside the two openings, and the contested r 22 on the centroid at
 * 256, 380. Nearest EDGE to the cut is **38.73 m**, i.e. **12.73 m outside the
 * rim**; the home-to-contested haul runs along z 380, fifty-eight metres off it.
 * It is the first thing to re-check on a re-seed after the picket.
 *
 * ============================================================================
 * 3. THE PLANT — `SORTER` AND `FURNACE` ON THE CUT, `HEAP` ON THE HAUL ROAD
 * ============================================================================
 *     requested 288, 318   placed 288, 318   rclSorter   1 250 hp   14.56 m out
 *     requested 276, 304   placed 276, 304   rclFurnace    950 hp   18.11 m out
 *     requested 334, 344   placed 334, 346   rclHeap       550 hp   64.62 m out
 *
 * Two of the three stand ON the cut and the third is out on the crew's haul
 * road, 64.2 m of walked path away and 22.95 m outside the edge of the crew's
 * own home ore field. That split is the point: the primary is
 * `ownerCount(1, 'building', 'plant', max: 0)`, so a player who levels the two in
 * front of them and stops has not finished, and the trip is made while the crew's
 * columns are forming 66.6 m from the heap.
 *
 * **NO PRODUCER AND NO GUN IS TAGGED `plant`, DELIBERATELY.** A `warFactory` or
 * a `barracks` here would hand the crew a forward production building 146 m from
 * the player's objective and change the operation in a way nothing in either
 * header measures. A sorter, a furnace and a heap are economy: 2 750 hp of
 * demolition and nothing that shoots back.
 *
 * **AND KILLING THE FURNACE DOES NOT BLACK THE CREW OUT.** Measured on the built
 * world, seat 1 is produced 400 / consumed 250; without the plant's `rclFurnace`
 * it is 320 / 250, still positive. `rclSpitpost` is `power: 0` in any case, with
 * a shipped blurb reading *"Fires through a blackout"*. The claim is not made.
 *
 * ============================================================================
 * 4. THE PICKET — `POST_A` 246, 326 AND `POST_B` 248, 308
 * ============================================================================
 *     requested 246, 326   placed 246, 326   28.28 m from the cut
 *     requested 248, 308   placed 250, 310   26.83 m from the cut
 *
 * **THAT THEY COVER THE APPROACH IS MEASURED BY EXCLUSION, NOT BY A DISTANCE.**
 * `soviets.08.carriage-forward` published a picket that "covered the corridor at
 * 4.00 m" and the real closest approach over the whole optimal set was 42.5 m
 * against a 22 m gun. The instrument that settles it is to re-cost the cheapest
 * route with every cell whose CENTRE lies inside the gun's envelope AGAINST THAT
 * MOVER made impassable — the same envelope the exposure figures below
 * integrate, so the two measurements agree by construction.
 *
 * **ONE NUMBER IS NOT ENOUGH: THE ENVELOPE IS PER-MOVER.** This block published
 * a single `218.2 -> 252.0 (+33.8)` and left the class it belonged to unsaid.
 * Re-measured from the units the layout actually spawns:
 *
 *     Hover  envelope 22.790   146 cells   202.2..208.3 -> 236.0..242.1   +33.8
 *     Foot   envelope 20.234   122 cells   195.2..206.0 -> 224.2..235.0   +29.0
 *
 * The delta is identical for all four hulls and all five men, so it is a
 * property of the ground and not of a start. A route that lengthens by a sixth
 * when two guns are switched off is a route those two guns are on — and it is on
 * for the infantry too.
 *
 * **THE FOOT GRID FORKS AT z ~= 364, AND THAT IS THE TRAP IN THIS SECTION.**
 * Run the same control from the Conclave's own centre cell (110, 374), where
 * nothing stands, and the Foot delta reads +10.8 — a third of the real figure,
 * because that cell is already on the free side. The fork decides more than a
 * control: the cheapest foot route to the sorter from the Chapterhouse door —
 * `findEgressSpot` puts it at (89, 359.999 999 694), not at a round 360 —
 * spends **41.7 m inside a post's 20.234 m envelope**, and from the
 * opening `mrdArtificer` at (101, 370) it spends **zero**. Twelve starts swept;
 * every one at z <= 360 is exposed and every one at z >= 366 is not, and the
 * split is the cell boundary at z = 364. The operation's ENGINEER FORK block has
 * the table and what it costs a capture.
 *
 * **WHAT IS NOT CLAIMED: they do not command the cut.** Of the 126 open cells
 * inside the 26 m standing disc, **47 are inside a post's reach and 79 are
 * not** — so a player can put four hulls in the eastern lee with both posts
 * alive, and one who parks in the western third loses them. They are a picket.
 *
 * **AND THE ORDER'S DOCTRINE BEATS THEM BY 0.838 m — UNDER AN EXPLICIT ATTACK
 * ORDER AND UNDER NOTHING ELSE.** `Targeting.approach` stops an attacker at
 * `range * APPROACH_STOP_FRAC` (0.80) of SURFACE distance and `Combat.engage`
 * gates firing on the same quantity, both against `hitRadius`, which for a unit
 * is its own `radius` and for a building is the footprint half-diagonal. Read
 * off the built world:
 *
 *     mrdSolarch radius 2.7900     rclSpitpost 1x1, hitRadius 2.8284
 *     a Solarch ORDERED TO ATTACK parks at 20.80 + 2.8284 = 23.628 m of a post
 *     a post fires to              20.00 + 2.7900 = 22.790 m of a Solarch
 *
 * **THIS BLOCK SAID "on attack-move" AND THAT IS THE ONE ORDER UNDER WHICH IT IS
 * FALSE.** `Targeting.managesGoal` returns false unless the state is `Attacking`
 * or `Guarding`, and both `approach()` and `holdPost()` early-return on it;
 * `UnitState.Attacking` is written in exactly one place in the tree, under
 * `OrderKind.Attack` / `ForceAttack` in `input/Commands.ts`. An attack-moving
 * Solarch therefore drives its route and spends **45.7 m inside a post's
 * envelope** on the way to the cut — 6.01 s at 7.6 m/s under 30.40 dps. Ordered
 * onto a post instead, it has **36 legal stands** against post A with post B
 * alive, the cheapest 146.2 m of walked path away with zero metres of the route
 * exposed. **A `postCoil` range of 21 closes the 0.838 m and this paragraph
 * stops being true.**
 *
 * The men get the opposite deal under either order: a `mrdWayfarer` parks at
 * 16.00 + 2.8284 = 18.828 and the post reaches 20.00 + 0.234 = 20.234, so a
 * rifleman that stops to shoot one is 1.406 m inside it and dies on the third
 * pull at 1.70 s.
 *
 * ============================================================================
 * 5. THE TENANTS' ROW — `ROW_A` 272, 356 AND `ROW_B` 290, 296
 * ============================================================================
 *     requested 272, 356   placed 270, 352   30.27 m from the cut
 *     requested 290, 296   placed 290, 296   30.53 m from the cut
 *
 * Two `civApartments` — 800 hp, `power: 0`, 2x3 — **on the PLAYER's seat**, and
 * that ownership is the whole design of the secondary they carry. A Gaia block
 * is allied to everybody and `Targeting.isValidTarget` refuses ALLIES, so a
 * neutral row is a secondary that cannot fail, which `pact.05.open-count` calls
 * decoration in its own words. Owned by the Order they are ordinary enemy
 * structures to the crew.
 *
 * **THE EXPOSURE IS DELIBERATE AND ASYMMETRIC.** The near block sits **16.99 m**
 * off the straight line from the crew's forming-up road to the cut and the far
 * one **30.53 m**, against a Grinder's 26 m sight and 18 m reach — so a column
 * that walks straight in passes one of them and not the other. Three Grinders
 * deliver 53.05 dps into Concrete and level 800 hp in **15.1 s**; the player's
 * own wrench is `REPAIR_RATE` 30 hp/s and therefore loses to three of them, so
 * the row is defended by meeting the column rather than by mending under it.
 *
 * **AND THE PICKET CANNOT REACH THEM, WHICH IS WHAT `POST_A` IS PLACED
 * AGAINST.** An emplacement cannot chase — `Targeting.reachOf` returns 0 for
 * anything that fails `canDrive` — so its bar against a 2x3 is
 * `20 * COMBAT_TARGETING.acquireRangeMul (1.08) + hitRadius(2,3) (7.2111)` =
 * **28.81 m**. Measured on the placed world:
 *
 *     post 246, 326  ->  row 270, 352   35.38 m    clear by  6.57
 *     post 246, 326  ->  row 290, 296   53.25               24.44
 *     post 250, 310  ->  row 270, 352   46.52               17.71
 *     post 250, 310  ->  row 290, 296   42.38               13.57
 *
 * Both pickets are 1x1 and are unchanged at (246, 326) and (250, 310) — I
 * re-measured them at 28.28 and 26.83 m from the cut, which is what makes this
 * a drift in the two tenements rather than a re-seed. `bb83ffb` made
 * `spawnBuilding` snap on the FACED footprint, and a 2x3 at a yaw that
 * quantises to 90 or 270 moves exactly 2.83 m.
 *
 * **6.57 m is the tightest number in this file and it is the one a re-seed has
 * to re-check first**, because a post inside that bar burns a tenement down from
 * tick one, silently, and takes a 400-credit secondary with it before the player
 * has seen the ground. That is `pact.05.open-count`'s assessors'-station hazard
 * in a different costume.
 *
 * **BOTH BLOCKS ARE OUTSIDE THE 26 m STANDING DISC, AND THAT WAS CHECKED FOR A
 * REASON.** `civApartments` passes every gate in `GarrisonService.refusalFor`
 * for its own owner — unarmed, non-production, both footprint axes at or above
 * `GARRISON.minFootprint` — so the player really can man them; a strongpoint
 * INSIDE the disc would let the primary be answered by riflemen sitting in
 * somebody's front room. At 30.27 and 30.53 m the question does not arise —
 * and note that the two are now within 0.26 m of each other, where the table
 * this paragraph used to sit under had them 2.6 m apart in the other order.
 *
 * The crew cannot take them through the garrison route: `refusalFor` answers
 * `'hostile'` for a building whose owner is not allied to the entrant. The AI
 * can use an engineer capture, and the operation's ownership predicates already
 * count that outcome; it therefore declares no `captureProof`. They are also NOT sellable —
 * `Scenarios.civilian` clears `EntityFlag.Sellable`, measured on the built world
 * rather than read out of `FALLBACK_BUILDINGS` — so the player cannot cash in
 * the thing they are being paid to protect.
 *
 * ============================================================================
 * 6. THE FIELD OFFICE AND THE FORMING-UP ROAD
 * ============================================================================
 *     requested 327, 414   placed 328, 416   rclSpotter 700 hp
 *     ROAD 313, 400        11.3 m of walked path from the office
 *
 *     office -> the cut   108.41 m straight   107.7 m walked
 *     road   -> the cut    87.21               96.4
 *     road   -> the heap   57.94               66.6
 *     home   -> office    216.68              244.6
 *
 * `radar` rather than `barracks`, which is the same decision §3 records: a
 * forward `rclRookery` would hand the crew infantry production 107.7 m from the
 * objective. A Spotter Mast makes nothing, and "the office where the bill of
 * sale is" is what the operation's hidden secondary is about.
 *
 * `ROAD` is the only point in this file that is not a structure, and the twenty-six
 * drops the four columns author from it (3 + 7 + 8 + 8) were checked against the locomotor each
 * unit resolves to — Wheel for `rclGrinder`, Foot for `rclPicker` and
 * `rclSlagger` — because `ProductionService.spawnUnit` writes the ring point
 * VERBATIM: no `connectedGround`, no egress search. All of them are open, and
 * `tests/campaign-spawn-ground.spec.ts` fails by name if that stops being true.
 *
 * The three `rclPicker` at the office are AN OPENING PICTURE, NOT A GARRISON,
 * and this file will not claim otherwise: `AiBrain.census` files every
 * non-harvester Infantry/Vehicle on an AI seat into `armyIds` and
 * `regroupSquads` marches it to the brain's rally within `AI_CADENCE.squad` = 6
 * ticks, and a layout has no way to opt out. `soviets.02.common-standard` hung a
 * secondary on two hulls that were 116.6 and 129.2 m from their post by t+20 s;
 * nothing here does.
 *
 * ============================================================================
 * 7. `PLACE_RINGS` 7 — A FALLBACK WITH A 28 m BOUND
 * ============================================================================
 * `place` walks outward ring by ring for ground the footprint can legally stand
 * on, testing `footprintClear` AND `footprintBuildable` — the second because
 * `findClearFootprint` asks nothing about slope and will happily seat a
 * structure on ground `Terrain.isBuildable` refuses. Seven rings at `CELL` 4 is
 * **28 m of silent displacement per structure**, which is larger than the
 * standing disc is wide: a plant that used the whole search would put every
 * distance in these two headers wrong with nothing failing.
 *
 * **NOTHING ON THIS SEED NEEDS IT.** Measured requested-to-placed displacement
 * for all eight structures: furnace 0.00 m, post A 0.00, heap 2.00, office 2.24,
 * sorter 2.83, post B 2.83, row B 2.83, row A 4.47 — one cell at worst, most of
 * which is `spawnBuilding`'s own footprint snapping rather than this search.
 * **Do not derive a placed position arithmetically from these anchors**; the
 * snap is a 4 m staircase. Sweep and read it back.
 *
 * **THE FAILURE MODE IS A TAG THAT NEVER STAMPS.** If the rings find nothing,
 * `place` tries `findClearFootprint` and, failing that, returns the RAW point;
 * `spawnBuilding` then runs the SAME `findClearFootprint` from it and returns
 * `NONE` when that fails too. `LayoutContext.tag` silently ignores `NONE`, so the
 * structure is simply absent — and a zero threshold over an absent tag reads
 * TRUE from tick one. `tests/campaign-maps.spec.ts` compares the declared tag
 * list against what actually landed, and `tests/campaign-roster-ground.spec.ts`
 * does it again with the roster installed, which is the path where `isBuildable`
 * can refuse a def outright.
 *
 * ============================================================================
 * 8. WHAT A RE-SEED HAS TO RE-CHECK, IN ORDER
 * ============================================================================
 *   1. **the picket against the row** — is the nearest post still past 28.81 m?
 *      It is 35.38 today, clear by 6.57, and this is the one that fails silently;
 *   2. **the ore against the standing disc** — is the nearest field edge still
 *      outside 26 m of the cut? It is 38.73, clear by 12.73;
 *   3. **the exclusion control on the approach, ON BOTH LOCOMOTORS and from real
 *      unit starts** — does closing the picket's envelopes still cost the route
 *      real metres? +33.8 hover and +29.0 foot today;
 *   4. **the foot fork at z ~= 364** — is the Chapterhouse door still on the
 *      exposed side of it and the opening `mrdArtificer` still on the free one?
 *      41.7 m and 0.0 m of exposure today, and nothing in the tree checks it;
 *   5. **the standing disc itself** — 126 of 137 cells open after placement, the
 *      same 126 for all three move classes;
 *   6. **the ring points of all four columns**, which
 *      `tests/campaign-spawn-ground.spec.ts` fails by name;
 *   7. **the walked lengths the four waves are paced by**, which nothing checks
 *      at all.
 *
 * `b.block` clearances — 20 on the sorter, 16 on the furnace and each tenement,
 * 12 on the heap, 10 on each post, 22 on the office — keep `b.scatter`'s 150
 * props out of the fight rather than out of the frame; the scatter box is five
 * named points expanded by 80 m.
 * ========================================================================== */

import { NONE, Stance } from '../../core/types';
import { CELL } from '../../core/config';
import {
  addStartOre, buildBaseFor, islandSeats, startSpots, wrapDeg,
} from '../../game/Scenarios';
import type { EntityId, PlayerId } from '../../core/types';
import type { Area, Point } from '../types';
import { layout } from '../layout';

/* -- the measured points -------------------------------------------------- */

/**
 * The cut. Every disc in the operation is drawn on this point.
 *
 * 0.56 along a 296.000 m axis and 58 m off it, which puts it 202.2..208.3 m of
 * walked path from the Order's opening armour and 146.0 from the crew's yard.
 * Header §2 — and read the anchor note there before quoting either figure.
 */
export const SECTION: Point = { x: 274, z: 322 };

/**
 * The ground the Works look at, and the disc the operation's second primary
 * counts four of the player's units inside.
 *
 * 26 m: 137 of 137 cells open on the bare heightfield at this `mapSeed`, 126 of
 * 137 once the plant, the picket and the row are on it, and the same 126 for
 * Foot, Track and Hover. **PAIRED WITH THE 58 m OFF-AXIS OFFSET** — the
 * opening-to-opening axis clears this rim by 32 m, so traffic between the two
 * bases cannot answer the primary. Header §1 and §2.
 */
export const SECTION_AREA: Area = { x: SECTION.x, z: SECTION.z, r: 26 };

/**
 * The opening reveal: the cut, the plant on it and the picket in front of it.
 *
 * 56 m covers the two posts at 28.28 and 26.83 m and the two tenements at 30.27
 * and 30.53, and stops **52.4 m short of the field office**, which is what keeps
 * the operation's `t.disclose` a reveal rather than a beat over ground the
 * player has been looking at since four seconds. `revealArea` is
 * `Vision.exploreCircle` and it is PERMANENT.
 */
export const CUT_AREA: Area = { x: SECTION.x, z: SECTION.z, r: 56 };

/** The crew's field office, 107.7 m of walked path from the cut. Header §6. */
export const OFFICE: Point = { x: 327, z: 414 };
export const OFFICE_AREA: Area = { x: OFFICE.x, z: OFFICE.z, r: 40 };

/**
 * Where every Reclamation column forms up. 96.4 m of walked path from the cut,
 * 66.6 from the heap and 11.3 from the office it comes out of. Header §6.
 */
export const ROAD: Point = { x: 313, z: 400 };
export const ROAD_AREA: Area = { x: ROAD.x, z: ROAD.z, r: 46 };

/* -- the plant, the picket, the row --------------------------------------- */

/** `rclSorter`, 1 250 hp, on the cut. The one worth capturing. Header §3. */
const SORTER: Point = { x: 288, z: 318 };
/** `rclFurnace`, 950 hp, on the cut. Header §3. */
const FURNACE: Point = { x: 276, z: 304 };
/** `rclHeap`, 550 hp, out on the crew's haul road. The second trip. Header §3. */
const HEAP: Point = { x: 334, z: 344 };

/**
 * The two `rclSpitpost`. Closing both 20 m discs costs the cheapest approach
 * 33.8 m, and the nearer of them is 35.38 m from the nearest tenement against a
 * 28.81 m acquisition bar. **Move either and re-check both.** Header §4 and §5.
 */
const POST_A: Point = { x: 246, z: 326 };
const POST_B: Point = { x: 248, z: 308 };

/**
 * The two `civApartments`, on the PLAYER's seat. 16.99 m and 30.53 m off the
 * crew's road to the cut, and both outside the 26 m standing disc. Header §5.
 */
const ROW_A: Point = { x: 272, z: 356 };
const ROW_B: Point = { x: 290, z: 296 };

/**
 * Cells searched outward for ground a footprint can legally stand on. Seven at
 * `CELL` 4 bounds silent displacement at 28 m per structure; nothing on this
 * seed moves more than 4.47 m, and the failure mode past the search is a tag
 * that never stamps. Header §7.
 */
const PLACE_RINGS = 7;

export default layout({
  id: 'pact-common-ground',

  // `column` is produced by the operation's `spawnUnits`, not stamped here. It
  // is declared anyway so a reader looking for "where does this come from" finds
  // the answer in the file that owns the ground; `validateCampaign` and
  // `campaign-maps.spec.ts` both skip a tag a trigger spawns.
  tags: ['plant', 'office', 'row', 'column'],

  build(b, cx, cz, start, c) {
    const spots = startSpots(cx, cz, b.armies, b.sea, b.seed);
    const seats = islandSeats(spots, b.sea);

    const pact: PlayerId = c.seat(0);
    const crew: PlayerId = c.seat(1);
    const home = seats[0];
    // `temperate` has no `MAP_SEAS` row, so `islandSeats` hands back the raw
    // start spots; `seats[0]` is the one-army guard and nothing else in this
    // file branches on the seat count.
    const foe = seats[1] ?? seats[0];

    const dx = foe.x - home.x;
    const dz = foe.z - home.z;
    const len = Math.max(1e-3, Math.sqrt(dx * dx + dz * dz));
    const nx = dx / len;
    const nz = dz / len;

    const inward = wrapDeg(Math.atan2(nx, nz) * (180 / Math.PI));
    const outward = wrapDeg(inward + 180);

    const scratch = new Float32Array(2);
    const place = (owner: PlayerId, key: string, p: Point): Point => {
      const f = b.footprintOf(b.keyFor(owner, key));
      for (let ring = 0; ring <= PLACE_RINGS; ring++) {
        for (let oz = -ring; oz <= ring; oz++) {
          for (let ox = -ring; ox <= ring; ox++) {
            if (ring > 0 && Math.abs(ox) !== ring && Math.abs(oz) !== ring) continue;
            const tx = p.x + ox * CELL;
            const tz = p.z + oz * CELL;
            if (!b.footprintClear(tx, tz, f.w, f.h)) continue;
            // `findClearFootprint` asks nothing about slope. Header §7.
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

    const raise = (
      owner: PlayerId, key: string, p: Point,
      tag: string | null, yawDeg: number, clear: number,
    ): { id: EntityId; x: number; z: number } => {
      const where = place(owner, key, p);
      const id = b.spawnBuilding(key, owner, where.x, where.z, { yawDeg });
      if (tag !== null) c.tag(tag, id);
      if (id !== NONE) b.block(where.x, where.z, clear);
      return { id, x: where.x, z: where.z };
    };

    /* -- the two openings ------------------------------------------------- */
    buildBaseFor(b, pact, home.x, home.z, { facingDeg: wrapDeg(home.facingDeg + 180) });
    buildBaseFor(b, crew, foe.x, foe.z, { facingDeg: wrapDeg(foe.facingDeg + 180) });

    /* -- the crew's cutting plant ----------------------------------------- */
    raise(crew, 'refinery', SORTER, 'plant', outward, 20);
    raise(crew, 'powerPlant', FURNACE, 'plant', outward, 16);
    raise(crew, 'oreSilo', HEAP, 'plant', outward, 12);

    /* -- their picket, on the side the Order has to come from -------------- */
    raise(crew, 'pillbox', POST_A, null, inward, 10);
    raise(crew, 'pillbox', POST_B, null, inward, 10);

    /* -- the tenants' row, on the Order's own books ------------------------ */
    raise(pact, 'civApartments', ROW_A, 'row', outward, 16);
    raise(pact, 'civApartments', ROW_B, 'row', outward, 16);

    /* -- the crew's field office ------------------------------------------ */
    const office = raise(crew, 'radar', OFFICE, 'office', outward, 22);
    // An opening picture and not a garrison — header §6. `AiBrain.census` files
    // these three into the strike group within six ticks and they walk off.
    for (let i = 0; i < 3; i++) {
      b.spawnUnit(
        'rclPicker', crew,
        office.x - nx * (12 + i * 5), office.z - nz * (12 + i * 5),
        { yawDeg: inward, stance: Stance.Defensive },
      );
    }

    /* -- ore and dressing -------------------------------------------------- */
    addStartOre(b, spots, b.sea);

    const pts = [home, foe, SECTION, OFFICE, ROW_B];
    const minX = Math.min(...pts.map((p) => p.x)) - 80;
    const maxX = Math.max(...pts.map((p) => p.x)) + 80;
    const minZ = Math.min(...pts.map((p) => p.z)) - 80;
    const maxZ = Math.max(...pts.map((p) => p.z)) + 80;
    b.scatter({ minX, minZ, maxX, maxZ }, 150);

    b.setCameraFocus(SECTION.x, SECTION.z);
    void start;
  },
});
