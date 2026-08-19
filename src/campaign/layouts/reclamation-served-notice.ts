/**
 * ============================================================================
 * VOLTMARCH — src/campaign/layouts/reclamation-served-notice.ts
 * ============================================================================
 * R4 — THE GROUND. One Works freight halt in the snow with a wire round it,
 * two record blocks inside, four concrete boxes outside, an Allied depot two
 * hundred metres up the lane, and — for the player — NO BASE AT ALL.
 *
 * ============================================================================
 * EVERY POINT THE TRIGGER TABLE NAMES IS DERIVED, NOT MEASURED
 * ============================================================================
 * **ELEVEN OPERATIONS IMPORT POINTS FROM THEIR LAYOUT AND THIS IS THE ELEVENTH,
 * SO THE IMPORT IS NOT THE NEW THING — THE SEED IS.** Counted 2026-08-19:
 * `allies.01`, `.03`, `.04`, `reclamation.02`, `.03`, `.04`,
 * `soviets.02`..`.06`. Each of the other ten exports LITERAL coordinates with a
 * header telling the next author to re-measure them if the seed moves. That
 * works and it has already gone wrong once (`reclamation.03`'s biome), so this
 * file does the same job one step earlier. (This block named
 * `allies-instrument-room` as one of the three precedents; that layout exports
 * NOTHING and its operation imports nothing from it. `reclamation-sold-twice`
 * and `reclamation-written-off` are real precedents.)
 *
 * `SIM_SEED` LIVES HERE, AND EVERY EXPORTED POINT IS COMPUTED FROM IT AT MODULE
 * LOAD. `seatedSlots(2, SIM_SEED, null)` is a pure function of the seed;
 * `SKIRMISH_START_OFFSETS` is a table of four integer offsets from the map
 * centre; `MAP_SIZE` is a constant. So `HALT`, `INSERT`, `PICKUP`, `ROAD` and
 * `WATCH_OUT` are arithmetic rather than readings, the build below uses the
 * SAME constants to dress the ground, and there is no channel through which the
 * trigger table and the layout can come to disagree. Re-seeding moves both
 * together or neither.
 *
 * **THE OPERATION FILE OWNS `mapSeed` AND THIS FILE OWNS `simSeed`, AND THE
 * SPLIT IS PRINCIPLED RATHER THAN TIDY.** `simSeed` decides WHICH TWO CORNERS
 * the match is played in, which is the only input the geometry below has;
 * `mapSeed` decides the landform, is the survey designation the briefing says
 * out loud, and is read by nothing in this file. Each seed lives where the
 * thing that depends on it lives.
 *
 * WHAT IS STILL MEASURED, BECAUSE IT CANNOT BE DERIVED: where each structure
 * ACTUALLY LANDS after `spawnBuilding` snaps its footprint to the placement
 * grid, and whether the ground under a scripted spawn ring is standable. Both
 * are in the tables below and in `04-served-notice.ts`.
 *
 * ============================================================================
 * WHY A DIAGONAL PAIR, AND WHY THE HALT IS THE MAP CENTRE
 * ============================================================================
 * Two armies seat through `seatedSlots(2, seed, null)`, which draws a pair out
 * of `START_PAIRS` — [0,1] and [2,3] are the two DIAGONAL layouts, 386.16 m
 * apart; [0,2] and [1,3] are edge layouts 296.00 m apart. `simSeed` 4 103 draws
 * **[0, 1]**: the player's corner at (108, 380), the depot at (404, 132).
 *
 * The halt stands on the MAP CENTRE, and that is the whole reason a diagonal
 * pair is required rather than preferred. `startPointsFor` reserves a levelled
 * shelf at `(MAP_SIZE/2, MAP_SIZE/2)` FIRST on every continent, so the centre
 * is guaranteed flat, connected ground — measured on the shipped roll at
 * **100.0% of the cells within 46 m passable for foot AND for tracks.** A
 * fifty-two-metre walled yard needs exactly that. On an edge pair the lane
 * midpoint is (256, 380) or (256, 132), which is reserved by nothing.
 *
 * The two ends of the operation sit on the PERPENDICULAR BISECTOR of the lane,
 * 150.00 m either side of the halt — the one locus on a two-army map where a
 * point is exactly as far from one opening as from the other. Measured:
 *
 *     halt            (256.00, 256.00)   193.08 m from EACH opening
 *     insertion       (159.67, 141.02)   244.50 m from EACH opening
 *     pickup          (352.33, 370.98)   244.50 m from EACH opening
 *     insertion -> pickup                300.00 m, the halt exactly between
 *
 * So neither end of the operation is nearer the depot than the other, and the
 * player's own corner is not a factor: **they never go there and nothing of
 * theirs stands on it.**
 *
 * ============================================================================
 * THE PLAYER HAS NO BASE, AND `opening: 'force'` IS ONLY HALF OF THAT
 * ============================================================================
 * `buildBaseFor` is called for the DEPOT and for nobody else. Seat 0 opens with
 * twelve hulls, no structure, no build radius and therefore no production of
 * any kind — `Placement.withinBuildRadius` reads finished structures the player
 * owns, and there are none, so every placement anywhere on the map is
 * `PlacementFault.OutOfRange`.
 *
 * `reclamation.01.held-paper` is the other `'force'` operation in this chapter
 * and it is NOT this: it hands the player four working lots, one of them a
 * Foundry, precisely so the 1900-credit decision exists. Here there is nothing
 * to decide with money, which is why the operation pays its secondary in a
 * medal rather than in credits — see `04-served-notice.ts`.
 *
 * **THE ROSTER IS THEREFORE A PERMISSION THE LAYOUT NEEDS, NOT A RESTRICTION
 * THE PLAYER FEELS**, and that is worth writing down because it inverts what
 * `OperationRoster` is for everywhere else. `ScenarioBuilder.spawnUnit` asks
 * `isBuildable` before it places anything, so `roster.player` decides what THIS
 * FILE may hand out and nothing else: `rclSpitter` carries `unit.raider`, so
 * without that grant the two Arcspitters below would silently not exist. The
 * `ai` half is an ordinary restriction and does real work — measured, the
 * depot's base loses two structures and two hulls when the empty AI list is in
 * force (81 buildings / 14 units unbound, **79 / 12** bound and gated).
 *
 * ============================================================================
 * THE YARD, AND WHY IT IS AXIS-ALIGNED
 * ============================================================================
 * A 52 x 52 m square of `wall` segments at 4 m spacing — 50 of them — with a
 * gate in the face that looks at the depot: **TWO** segments omitted, so the
 * flanking pair stands 12 m apart centre to centre and the CLEAR opening is
 * **8 m**, two cells wide, measured off `occupant` on the built world. (This
 * said "a 12 m gate", which is the centre span rather than the gap.)
 *
 * It is authored in WORLD AXES rather than in the lane frame, and that is a nav
 * constraint rather than a preference: a wall run laid on a 40-degree bearing
 * puts consecutive 1x1
 * footprints on DIAGONAL neighbours, and a diagonal chain of cells is not a
 * barrier — infantry walk through the corners. Axis-aligned, each face is a
 * continuous run of edge-adjacent cells and the yard is sealed but for the gate.
 * MEASURED rather than argued: a 4-neighbour flood for `Locomotor.Foot` started
 * inside the yard reaches the whole 12 428-cell passable region through the
 * mouth, and reaches **132 cells and nothing past r = 60 m** with the two mouth
 * cells treated as closed. There is no second hole.
 *
 * Which face carries the gate is derived with two comparisons and no
 * trigonometry: the world axis with the larger component toward the depot, on
 * the side the depot is. On the shipped seed that is the **+x face**, and the
 * gate mouth lands at (282, 256).
 *
 * `spawnBuilding` relocates a placement only when `connectedGround` finds it cut
 * off, and `connectedGround` reads a connectivity snapshot taken BEFORE the
 * first spawn (`primeConnectivity`) — so the walls this file lays cannot push
 * each other around, and the audit below reports 0 relocations.
 *
 * ============================================================================
 * WHAT THE WIRE ACTUALLY DOES, MEASURED — IT CATCHES THE SLAGGER'S SHELL AND
 * NOTHING ELSE THE PARTY FIRES
 * ============================================================================
 * The obvious reading is "a fence you have to get through", and that is only
 * the second thing it does. `Projectiles.sweep` **hits whatever it meets
 * first** — its own header says so, in those words — and a wall segment is an
 * enemy building with a 2.83 m hit radius. So a SHELL fired at a record block
 * from outside the wire detonates on the wire. `Targeting.isValidTarget` has no
 * line-of-sight test at all (and `hasLineOfSight`, which only auto-acquisition
 * consults, is a TERRAIN walk that units and buildings never block), so the
 * party will happily aim through it; the shell will not arrive.
 *
 * **AND THAT IS TRUE OF ONE OF THE FOUR WEAPONS THE PARTY CARRIES. THIS BLOCK
 * SAID "A ROUND", AND ONLY `slagCharge` IS A ROUND.** Measured on the shipped
 * rows: `slagCharge` is `ProjectileKind.Shell`, so it travels and `sweep` tests
 * it. `arcProd`, `spitCoil` and `grinderArc` are all `ProjectileKind.TeslaBolt`,
 * and `Combat.resolveTesla` pushes the damage record straight at the victim —
 * no projectile is spawned, so there is nothing for the wire to be in the way
 * of. Measured on the built world, the closest legal standing cell OUTSIDE the
 * wall square is **6.79 m of surface** from the deep block at (240, 258), which
 * is inside every one of the four ranges: four Scrap Pickers, two Grinders and
 * two Arcspitters are 113.2 dps of Tesla against concrete and take that block's
 * 800 hp down in **7.1 s without opening the fence**.
 *
 * What that does NOT reach is the second block. (256, 258) is 20.86 m of
 * surface from the nearest legal stand outside the wire, against a longest reach
 * of 18 m — so the counterpart still costs the wire or the gate, the operation
 * still has two documents in two sheds, and everything above happens INSIDE the
 * 52 m counted disc, where the dwell clock is running either way. The design
 * survives; the sentence "the wire has to come down whether or not anybody walks
 * through the hole" did not, and it is corrected below.
 *
 * What DOES make the Slagger's own blurb — *"the only thing that hurts a
 * wall"* — a mechanic rather than a joke is the rate, not the sweep. Through `ARMOR_MATRIX` at
 * `COMBAT_DAMAGE.globalMul` 0.80, against `wall`'s 300 hp of `ArmorClass
 * .Concrete`:
 *
 *     slagCharge   74 / 2.70 s   HighExplosive x1.00   21.93 delivered dps
 *     grinderArc   70 / 1.90 s   Tesla         x0.60   17.68
 *     spitCoil     30 / 0.95 s   Tesla         x0.60   15.16
 *     arcProd      26 / 1.05 s   Tesla         x0.60   11.89
 *
 * Four Slaggers open a segment in 3.4 s; four Scrap Pickers need 6.3 s and are
 * the army's line infantry. The whole roster is bad at concrete and one man is
 * merely less bad, which is the Reclamation as `Defs.ts` describes it.
 *
 * ============================================================================
 * THE FOUR BOXES, AND THE ONE READING THAT DECIDES THE ROUTE
 * ============================================================================
 * `pillbox` role keys — the Allied Pillbox, 500 hp, `power: 0`, `pillboxMg` at
 * 22 m. Two flank the gate 14 m outside its face; two sit 14 m outside the
 * middle of each long side. Nothing at the halt draws power (`pillbox` is 0 and
 * `civApartments` is 0), so **there is no grid to cut** — the answer
 * `reclamation.01.held-paper` sells cannot be bought twice.
 *
 * Emplacements rather than a garrison, for the rule `campaign-maps.spec.ts`
 * pins: `AiBrain.census` files every AI-owned mobile hull into `armyIds` and
 * `regroupSquads` marches it to the rally point inside four seconds. A layout
 * cannot opt out of that. Concrete can.
 *
 * **EVERY CLEARANCE BELOW IS A SURFACE DISTANCE.** `Combat.engage` gates firing
 * on `max(0, flat - hitRadius(target))` and `Targeting` acquires at
 * `range * COMBAT_TARGETING.acquireRangeMul` = 22 x 1.08 = **23.76 m**, both
 * measured to the TARGET's hull; the target here is a man, whose `hitRadius` is
 * his 0.234 m radius. Measured on the built world:
 *
 *     post                     (298,246) (298,270)   the gate pair
 *                              (258,218) (258,298)   the long sides
 *     the nearest point of each register's 8 x 12 m footprint is 36.77 m and
 *       34.00 m from the nearest box's CENTRE, so a man standing against that
 *       hull is 36.54 and 33.77 m of SURFACE distance from it — clear of the
 *       22 m firing arc by 14.54 and 11.77 m and of the 23.76 m acquisition
 *       radius by 12.78 and 10.01 m.
 *
 * So a crew can stand on either block and take no fire from the halt's own
 * guns. That is the same property `allies.02.instrument-room` rests on and it
 * is the reason a quiet route exists at all.
 *
 * The gate is the opposite case, and it is why there is no second route:
 *
 *     gate mouth (282,256), two boxes bearing on it at 18.87 and 21.26 m
 *     the gate axis is inside a 22 m arc for 35.86 m of approach
 *
 * 35.86 m at a Slagger's 3.0 m/s is 11.95 s under two boxes at 65.82 delivered
 * dps each — **about 1 520 points of damage against a foot party that carries
 * 800**, and both boxes bear for 33.28 m of it. Measured by Dijkstra on the 4 m
 * grid with every cell inside a 22 m arc removed, the arc-free route from the
 * insertion point to the gate mouth is **UNREACHABLE**. There is no quiet way in
 * through the gate and the briefing says so out loud.
 *
 * **THIS READ "35.5 m ... 59.77 dps each ... 1 414 points", AND THE dps FIGURE
 * WAS TAKEN WITH THE WRONG BURST INTERVAL.** `pillboxMg` is
 * `wpn('pillboxMg', …, 13, SmallArms, 22, 0.55, …, { burstCount: 5, burstDelay:
 * 0.06 })`, and `burstDelay` is spelled on the ROW; using `wpn`'s DEFAULT 0.08
 * gives a cycle of 0.87 s instead of 0.79 and lands on 59.77 exactly. Read the
 * row's own `burstDelay` — the shipped delivered rate against `ArmorClass
 * .Infantry` is `5 x 13 / 0.79 x 1.00 x 0.80` = **65.82**, and the mistake was in
 * the direction that makes the gate look survivable. It is not: 800 hp of foot
 * dies about two thirds of the way up the approach either way.
 *
 * The back of the yard is the answer, and it costs nothing in guns:
 *
 *     insertion -> the stand outside the back wire   174.5 m of ground,
 *                                                    174.5 m arc-free, detour 0.0
 *     that stand (215,256)                           57.15 m of surface from
 *                                                    the nearest box
 *
 * **THE WAY OUT IS WHERE THE BOXES BITE.** The pickup is on the far side of the
 * halt from the insertion, so the withdrawal passes the yard rather than
 * retracing:
 *
 *     back stand -> pickup    317.1 m of ground, 347.4 m arc-free
 *                             -> a 30.2 m detour, 10.1 s at 3.0 m/s
 *     the straight line is 179.1 m and 43.5 m of it is inside the south box's
 *     arc — the yard is in the way, which is why the ground figure is longer
 *
 * **THE DETOURS REPRODUCE EXACTLY AND THE ABSOLUTE LENGTHS DO NOT, WHICH IS
 * WHAT A GRID DISTANCE IS WORTH.** Re-measured 2026-08-19 on an independent
 * 8-neighbour Dijkstra over `ITerrain.isPassable(_, _, Locomotor.Foot)` on the
 * built world, no corner-cutting, edges of 4 and 4·sqrt2: insertion -> back
 * stand **176.85 m, detour 0.00**; back stand -> pickup **321.82 m ground,
 * 352.05 m arc-free, detour 30.23**; straight line 179.11 m with **43.50 m**
 * inside an arc; insertion -> gate mouth 196.45 m of ground and **arc-free
 * UNREACHABLE**. Every claim this file rests on — the free way in, the 30 m
 * exit tax, the absent gate route — is reproduced to two decimals. The absolute
 * ground lengths run 2 to 5 m longer than the figures above, which is endpoint
 * snapping between two implementations of the same walk and is the reason no
 * conclusion here is written against an absolute metre count.
 *
 * ============================================================================
 * THE TWO RECORD BLOCKS
 * ============================================================================
 * Two `civApartments` — 800 hp each, `ArmorClass.Concrete`, an 8 x 12 m
 * footprint — owned by the DEPOT and standing in a line down the middle of the
 * yard at (240, 258) and (256, 258), 16.00 m apart.
 *
 * DEPOT-OWNED RATHER THAN GAIA, AND THE VERB IS THE REASON. Gaia is allied to
 * everybody, so `Targeting.isValidTarget` refuses a neutral structure as a
 * target outright and the only thing that could touch one is splash. This
 * operation asks the player to DESTROY the books, so they have to belong to
 * somebody the player is at war with. It is also the third operation in this
 * chapter and the first that does not turn on a capture: R2 takes a sorting
 * station, R3 takes six capped taps, and doing it a third time would be one
 * trick three times.
 *
 * `civApartments` carries no `UNLOCK_TAGS` id, so no roster can refuse one — it
 * matters more here than anywhere else, because a refused `spawnBuilding`
 * returns `NONE`, the tag lands on nothing, and `entityDead: 'register'` reads
 * TRUE on tick one and hands the player a win before they have moved.
 * `campaign-maps.spec.ts` checks the declaration in both directions.
 *
 * **NOTHING IN THE PARTY CAN REACH EITHER BLOCK FROM OUTSIDE THE COUNTED
 * DISC.** The bound is the block FURTHEST from the halt centre, because that is
 * the one a shooter can stand furthest out to reach. Measured on the built
 * world the two land at 16.12 m and 2.00 m from the centre; each carries a
 * 7.21 m hull radius, and the longest reach the operation's roster permits is
 * `grinderArc`'s 18 m. So the furthest a shot at a record block can be taken
 * from is `16.12 + 7.21 + 18` = **41.34 m** — against a counted disc of 52 m,
 * i.e. 10.66 m of margin. The nearest wire segment is 26.08 m out, so shooting
 * THAT at maximum standoff is 46.91 m and still inside; the four corner segments
 * are 36.77 m out and reach 57.60 m, so a corner of the fence is the one thing
 * on the map that can be shot from outside the disc, and it is worth nothing.
 * The dwell clock in `04-served-notice.ts` cannot be dodged by standing off, and
 * that is measured rather than assumed.
 *
 * **THIS SAID "the deeper block sits 2.00 m from the halt centre … 27.21 m",
 * WHICH IS THE RIGHT ARITHMETIC ON THE WRONG BLOCK.** 2.00 m is the SHALLOW
 * block — the one nearer the gate — and using it understates the standoff by
 * 14.13 m. The conclusion is unchanged and the margin is not: 10.66 m, not
 * 24.79. If either `REG_BACK` or the roster's longest reach ever grows by more
 * than ten metres, `WIRE.r` has to move with it.
 *
 * ============================================================================
 * NO ORE FOR THE PLAYER, AND TWO FIELDS FOR THE DEPOT
 * ============================================================================
 * `addStartOre` is not called. It lays a home field at every opening and a
 * contested patch on the centroid — which here is the map centre, i.e. INSIDE
 * THE YARD. A radius-22 ore field under the two record blocks would put
 * harvesters on the objective, and a field at the player's corner would be a
 * field nobody can mine, because the player owns no refinery and never will.
 *
 * So the ore is laid by hand and all of it is the depot's: a radius-30 home
 * field on `addStartOre`'s own bearing (18 m along the line to the centre, 44 m
 * across it) and a radius-24 expansion 60 m out. Two fields rather than one
 * because a sixteen-minute operation against a seat that cannot be starved is
 * an operation whose opponent should still be growing at minute ten. (This said
 * FOURTEEN, in three places across the two files; `parSec` is 960 and `CLOSING`
 * is `minutes(16)`. Fourteen is when `t.closing` gives the two-minute warning.)
 *
 * ============================================================================
 * TAGS
 * ============================================================================
 * `register` — the two record blocks. Read by `entityDead`, and they are
 *   BUILDINGS on an AI seat, which is what `campaign-maps.spec.ts` requires of
 *   any tag an `entity*` condition reads on a seat with a brain.
 * `post` — the four boxes. Named by no trigger; declared so that
 *   `campaign-maps.spec.ts` verifies all four actually landed, which is the
 *   only automatic check the route measurements above have.
 * `wire` — the 50 wall segments, for the same reason. A wire that silently
 *   placed 34 segments would leave a hole nobody authored.
 * `crew` — the eight foot the party opens with, plus the second crew the
 *   trigger table sends. The exfiltration counts these and nothing else, so a
 *   player cannot finish the operation by parking an Arcspitter at the pickup.
 * `watch` / `column` — produced by `spawnUnits` in the trigger table, never by
 *   this file, and declared anyway so a reader asking where the pressure comes
 *   from finds the answer in the file that owns the ground.
 *
 * ============================================================================
 * WHAT THE BUILD ACTUALLY PUT DOWN
 * ============================================================================
 * Built headless at `mapSeed` 58 273 / `simSeed` 4 103 on `biome: 'snow'`, the
 * same build `tests/campaign-maps.spec.ts` performs, WITH the def tables bound
 * and this operation's roster installed — the only state in which the allow
 * list is in force:
 *
 *     seat 0  the party     0 buildings   12 units
 *     seat 1  the district  79 buildings  12 units   (23 base + 50 wire
 *                                                     + 4 boxes + 2 blocks)
 *     Gaia                   0 buildings   0 units
 *
 * `auditConnectivity`: one passable region holding 12 553 of 12 553 cells
 * (100.0%), **0 placements relocated, 0 entities stranded, 0 structures on
 * ground `isBuildable` refuses.** Every structure lands on its nominal point
 * put through `snapFootprintToGrid`; the worst drift is **2.83 m**, which is
 * one 2 m snap on each axis and not a search.
 *
 * **THE SEED WAS CHOSEN BY SWEEP, NOT BY TASTE.** 300 rolls were built headless
 * from 58 000 and scored on eight properties; **17 cleared them all and 58 273
 * is the best of those** — it is the only one that is simultaneously 0
 * relocations, 1.000 open ground at the pickup and 0.977 at the insertion.
 * **BOTH DISCS ARE r = 26, `PICKUP_AREA`'s RADIUS, NOT `INSERT_CLEAR`'s 30** —
 * reproduced 2026-08-19 on the bare terrain at exactly 1.000 and 0.977, where
 * r = 30 reads 0.971 and 0.960. The radius was not stated and the two answers
 * are three points apart, so it is stated now. What
 * the other 283 failed on, counted once per property:
 *
 *     a scripted spawn ring on unstandable ground   266   <- the binding one
 *     insertion disc under 60% open                 159
 *     pickup disc under 60% open                    143
 *     terrain split into more than one region        40
 *     the depot's column forming on closed ground    38
 *
 * **THE HALT ITSELF WAS NEVER THE CONSTRAINT, AND THAT IS THE SHELF DOING
 * EXACTLY WHAT `startPointsFor` RESERVES IT FOR.** Not one of the 300 rolls
 * failed on the map centre, for foot or for tracks; on the shipped roll it
 * reads **1.000 open on both**. (The sweep's bar was 0.94 and 0.90 rather than
 * 1.000, so what the 300 establish is that the shelf always cleared it — the
 * exact figure is a fact about 58 273 and is quoted as one.)
 * ========================================================================== */

import { MAP_SIZE } from '../../core/config';
import { NONE } from '../../core/types';
import { SKIRMISH_START_OFFSETS, buildBaseFor, seatedSlots, startSpots, wrapDeg } from '../../game/Scenarios';
import type { EntityId, PlayerId } from '../../core/types';
import type { Area, Point } from '../types';
import { layout } from '../layout';

/* ==========================================================================
 * 1. THE SEED, AND EVERYTHING ARITHMETIC THAT FALLS OUT OF IT
 * ========================================================================== */

/**
 * `?seed=` — the scenario layout roll, and the ONE input every exported point
 * below is computed from.
 *
 * `04-served-notice.ts` imports this into `map.simSeed` rather than restating
 * it. A number written in two files is a number that will disagree the first
 * time either is tuned, and the failure — a reveal framing empty ground, a
 * column landing where nobody authored one — is invisible to every gate.
 *
 * **4 103 IS CHOSEN FOR THE PAIR AND NOTHING ELSE.** `seatedSlots(2, 4103,
 * null)` draws [0, 1], the diagonal layout, which is what puts the lane
 * midpoint on the map centre and therefore the yard on the one shelf the
 * terrain generator guarantees. 96 of the 200 seeds in 4 000..4 199 draw a
 * diagonal pair; any of them would do, and re-seeding to one of the other 95
 * moves nothing in this file, because every point is derived rather than read.
 */
export const SIM_SEED = 4_103;

/** The map centre. `startPointsFor` reserves a levelled shelf here first. */
const CENTRE = MAP_SIZE * 0.5;

/** An authored slot as a world point. `?? { dx: 0, dz: 0 }` is unreachable. */
function slotPoint(slot: number): Point {
  const o = SKIRMISH_START_OFFSETS[slot] ?? { dx: 0, dz: 0 };
  return { x: CENTRE + o.dx, z: CENTRE + o.dz };
}

const SLOTS = seatedSlots(2, SIM_SEED, null);
/** The player's authored corner. They never go there and own nothing on it. */
const HOME = slotPoint(SLOTS[0] ?? 0);
/** The district depot's corner. 386.16 m from HOME on the shipped pair. */
const FOE = slotPoint(SLOTS[1] ?? 1);

/** Unit vector along the lane, and its left-hand perpendicular. */
const LANE = (() => {
  const dx = FOE.x - HOME.x;
  const dz = FOE.z - HOME.z;
  const len = Math.max(1e-3, Math.sqrt(dx * dx + dz * dz));
  const nx = dx / len;
  const nz = dz / len;
  return { nx, nz, px: -nz, pz: nx, len };
})();

/**
 * Metres from the halt to the insertion and to the pickup, along the
 * perpendicular bisector of the lane.
 *
 * 150 puts both of them 244.50 m from EACH opening — the bisector is the locus
 * where that is true, so neither end of the operation favours either army by
 * construction. It is also 50.0 s of walking at a Slagger's `maxSpeed` 3.0,
 * which is the number the operation's clock is written against.
 */
const REACH = 150;

/** The Works freight halt. The map centre, and the reserved shelf. */
export const HALT: Point = { x: CENTRE, z: CENTRE };

/**
 * Where Tallow's party is put down, and where the second crew arrives.
 *
 * MEASURED STANDABLE: the four points of the two scripted rings this receives
 * (2 at 10 m, 2 at 14 m) are all passable for `Locomotor.Foot`, and the WORST
 * of the four is 25.2 m from the nearest cell a man could not enter — the
 * widest margin of any spawn point in the operation, because this is open snow
 * rather than a road cutting.
 */
export const INSERT: Point = {
  x: CENTRE - LANE.px * REACH,
  z: CENTRE - LANE.pz * REACH,
};

/**
 * Where the lorries wait. 300.00 m from the insertion, with the halt exactly
 * between them.
 *
 * ON THE FAR SIDE ON PURPOSE. A pickup at the insertion point would let a
 * player satisfy the exfiltration by leaving two men where they started and
 * never moving them, which is the whole objective satisfied by doing nothing.
 * Here the crew has to cross the halt, and the withdrawal is the half of the
 * operation the boxes are actually placed for.
 */
export const PICKUP: Point = {
  x: CENTRE + LANE.px * REACH,
  z: CENTRE + LANE.pz * REACH,
};

/** The pickup as a disc. 26 m, wide enough for a squad `Movement.relax` has separated. */
export const PICKUP_AREA: Area = { x: PICKUP.x, z: PICKUP.z, r: 26 };

/**
 * THE COUNTED GROUND. 52 m, and the number is derived rather than framed.
 *
 * It has to cover the yard (half-diagonal 36.77 m) and all four boxes (38.05 to
 * 44.27 m from the halt), and it has to be wider than the furthest point any
 * weapon the party owns can hurt the objective from. Measured, that second bound
 * is `16.12 + 7.21 + 18` = **41.34 m** — the block further from the centre, its
 * hull radius, and `grinderArc`'s reach — so 52 m clears the standoff by
 * 10.66 m and clears the outermost box by 7.73 m.
 *
 * **THE BOX BOUND IS THE BINDING ONE AND THIS SAID THE STANDOFF WAS.** It read
 * "that second bound is the binding one: the deeper record block is 2.00 m from
 * the halt centre … so 27.21 m is the whole of the standoff available. 52 m is
 * 24.79 m past it" — two errors that cancel into a right answer. 2.00 m is the
 * SHALLOW block (the standoff bound wants the far one, 16.12 m), and 41.34 m is
 * BELOW the 44.27 m of the outermost box, so it never binds. The radius is set
 * by the emplacements. It is still the standoff number that must be re-derived
 * if `REG_BACK` or the roster's longest reach moves, because that is the bound
 * with only 10.66 m of room in it.
 */
export const WIRE: Area = { x: HALT.x, z: HALT.z, r: 52 };

/** The reveal. 68 m: the yard, its wire, all four boxes and the gate road. */
export const HALT_AREA: Area = { x: HALT.x, z: HALT.z, r: 68 };

/**
 * Where the depot's column forms up: 74.00 m out of its own gate along the
 * lane, 119.08 m short of the halt.
 *
 * OUTSIDE `BUILD_RADIUS` 56 SO IT IS NOT INSIDE THE BASE, and far enough short
 * of the halt that it reads as a column that has formed and is about to leave
 * rather than as an army materialising inside a working party.
 *
 * `EffectSink.spawnUnits` does NOT search for standable ground —
 * `ProductionService.spawnUnit` clamps to the map, reads `heightAt` and
 * allocates — and it lays a wave on an exact RING of radius `spread` rather
 * than scattering inside one. Both rings the trigger table fires here (4 at
 * 12 m for the infantry, 2 at 18 m for the armour) were checked against
 * `ITerrain.isPassable` for their own locomotor on the built world: all six
 * standable, worst clearance 3.7 m. **THE SAME TWO RINGS ARE FIRED THREE
 * TIMES** — the working at minute three, the second at minute nine, and the
 * answering column the moment the books go down — so one check of this point
 * covers all three waves. A fourth with different radii would need its own, and
 * that is the reason there is not one.
 */
export const ROAD: Point = (() => {
  const dx = HALT.x - FOE.x;
  const dz = HALT.z - FOE.z;
  const len = Math.max(1e-3, Math.sqrt(dx * dx + dz * dz));
  return { x: FOE.x + (dx / len) * 74, z: FOE.z + (dz / len) * 74 };
})();

/* ==========================================================================
 * 2. THE YARD
 * ========================================================================== */

/** Half-extent of the walled yard. 52 x 52 m on the ground. */
const HALF = 26;
/**
 * Half-width of the gate gap. `Math.abs(t) <= GATE_HALF` over a 4 m step from
 * -26 catches t = -2 and t = 2, so **TWO** segments are omitted, the flanking
 * pair stands at z 250 and 262 — 12 m centre to centre — and the passable mouth
 * is the two cells between them, **8 m**. (This read "three segments, a 12 m
 * mouth": the count was never right and 12 m is the centre span, not the gap.)
 */
const GATE_HALF = 4;
/** Metres a box stands outside the face it watches. */
const POST_OUT = 14;
/** The two gate boxes, either side of the mouth. */
const GATE_SPAN = 12;
/** The deeper record block, metres back from the yard centre away from the gate. */
const REG_BACK = 16;
/** The shallower one, that far further forward again. */
const REG_STEP = 14;
/** Metres reserved around the halt, so `scatter` leaves the ground legible. */
const HALT_CLEAR = 58;
/** Metres reserved around the insertion, so the party does not form in a wood. */
const INSERT_CLEAR = 30;

/**
 * WHICH FACE CARRIES THE GATE, and it is two comparisons rather than an angle.
 *
 * The world axis with the larger component toward the depot, on the side the
 * depot is. ECMA-262 pins `+ - * /` and `Math.sqrt` and pins neither `sin` nor
 * `cos`; a layout runs independently on both machines of a lockstep match, so
 * a table rotated by an angle is a tick-zero desync waiting for two engines to
 * disagree in the last mantissa bit. A comparison is exact everywhere.
 *
 * On the shipped seed the depot is at (404, 132) and the halt at (256, 256):
 * `|dx|` 148 against `|dz|` 124, so the gate is the **+x** face.
 */
const GATE_ON_X = Math.abs(FOE.x - HALT.x) >= Math.abs(FOE.z - HALT.z);
const GATE_SIGN = (GATE_ON_X ? FOE.x - HALT.x : FOE.z - HALT.z) >= 0 ? 1 : -1;

/** Yard frame to world. `g` runs toward the gate, `f` across it. */
function yard(g: number, f: number): Point {
  return GATE_ON_X
    ? { x: HALT.x + GATE_SIGN * g, z: HALT.z + f }
    : { x: HALT.x + f, z: HALT.z + GATE_SIGN * g };
}

/**
 * Where the halt's own watch comes out when the shift telephones the depot:
 * 48.00 m from the halt on the gate side, 22.00 m outside the gate face and
 * behind its own two boxes.
 *
 * ALMOST INSIDE THE MAP-CENTRE SHELF, AND THE "ALMOST" IS THE HONEST WORD.
 * `TERRAIN_START_FLAT_RADIUS` is 58, so the point itself is on levelled ground
 * but its two rings reach 60 m and 64 m from the centre — just past it. What is
 * measured rather than reasoned: all six drops standable for their own
 * locomotor, worst clearance 6.3 m to a cell that locomotor could not enter,
 * and no roll of the 300 swept failed here at all.
 */
export const WATCH_OUT: Point = yard(HALF + 22, 0);

/** The four boxes, in the yard frame. */
const POSTS: readonly Point[] = [
  yard(HALF + POST_OUT, -GATE_SPAN),
  yard(HALF + POST_OUT, GATE_SPAN),
  yard(0, -(HALF + POST_OUT)),
  yard(0, HALF + POST_OUT),
];

/** The two record blocks, in a line down the middle of the yard. */
const BLOCKS: readonly Point[] = [
  yard(-REG_BACK, 0),
  yard(-REG_BACK + REG_STEP, 0),
];

/** Foot the party opens with. Four satchel men and four riflemen. */
const CREW_SLAGGERS = 4;
const CREW_PICKERS = 4;

export default layout({
  id: 'reclamation-served-notice',
  tags: ['register', 'post', 'wire', 'crew', 'watch', 'column'],

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
        `[campaign] reclamation-served-notice built on (${cx}, ${cz}), not the map centre `
        + `(${CENTRE}, ${CENTRE}) — the halt is authored in absolute coordinates and will not `
        + 'line up with the ground this build lays down.',
      );
    }

    const spots = startSpots(cx, cz, b.armies, b.sea, b.seed);
    const foeSpot = spots[1] ?? spots[0];
    const us: PlayerId = c.seat(0);
    const them: PlayerId = c.seat(1);

    /*
     * THE DEPOT. `buildBaseFor` for seat 1 and for nobody else — `opening` is
     * `'force'` and the player's half of that is this file simply not calling
     * it. Garrison on, so the depot opens with harvesters and an economy; the
     * operation is sixteen minutes long and an opponent that never mines is a
     * backdrop rather than a threat.
     *
     * **THE SHELF AND THE DERIVED CORNER AGREE TO 0.00 m ON THE SHIPPED SEED.**
     * `startSpots` runs `nudgeToBuildable` over the authored offsets, so the
     * spot it returns and the raw slot every exported point above is computed
     * from are not the same quantity in general. Measured here they are
     * identical, which is what makes `ROAD` — derived from the RAW corner —
     * land 74.00 m from the base that was actually built.
     */
    if (foeSpot !== undefined) {
      buildBaseFor(b, them, foeSpot.x, foeSpot.z, {
        facingDeg: wrapDeg(foeSpot.facingDeg + 180),
      });
    }

    // Bearing from the yard out through the gate, for the yaw of everything
    // that stands in it. The one angle in the file and it is cosmetic — it is
    // the rotation of a model and nothing reads it back.
    const outward = wrapDeg(
      Math.atan2(GATE_ON_X ? GATE_SIGN : 0, GATE_ON_X ? 0 : GATE_SIGN) * (180 / Math.PI),
    );

    /* ==================================================================
     * 1. THE TWO RECORD BLOCKS
     *
     * PLACED FIRST, before anything can be in the way, and owned by the
     * DEPOT so that `Targeting.isValidTarget` will accept them — a Gaia
     * structure is allied to everybody and cannot be shot at on purpose.
     * ================================================================== */
    for (const p of BLOCKS) {
      const id: EntityId = b.spawnBuilding('civApartments', them, p.x, p.z, { yawDeg: outward });
      c.tag('register', id);
      if (id !== NONE) b.block(p.x, p.z, 12);
    }

    /* ==================================================================
     * 2. THE FOUR BOXES
     *
     * `pillbox` is a ROLE key, so a change of `op.foe` still gets that
     * army's cheap emplacement — and it is untagged in `UNLOCK_TAGS`, so
     * the empty `roster.ai` cannot refuse one. A Meridian district would
     * put a `needsPower` Glaive Post here instead, which is a reason to
     * re-read the header before moving `foe` rather than a reason to name
     * a def.
     * ================================================================== */
    for (const p of POSTS) {
      const id = b.spawnBuilding('pillbox', them, p.x, p.z, { yawDeg: outward });
      c.tag('post', id);
      if (id !== NONE) b.block(p.x, p.z, 10);
    }

    /* ==================================================================
     * 3. THE WIRE
     *
     * 50 segments at 4 m spacing round a 52 x 52 m square, with two
     * omitted from the gate face — 12 m between the flanking segments and 8 m
     * of passable mouth; see `GATE_HALF`. Corners belong to the
     * two faces perpendicular to the gate axis; the other two faces stop
     * one step short of them, so nothing is placed twice.
     *
     * NO SEARCH. `spawnBuilding` de-overlaps internally and
     * `connectedGround` moves nothing that is not cut off, and a segment
     * that relocated two cells to find flatter ground would open a gap an
     * infantry squad walks through — which is `reclamation-held-paper`'s
     * lesson about a wall being a CONTINUOUS BARRIER rather than a row of
     * buildings.
     * ================================================================== */
    for (let t = -HALF; t <= HALF; t += 4) {
      for (const s of [-1, 1]) {
        if (s === 1 && Math.abs(t) <= GATE_HALF) continue;
        const p = yard(s * HALF, t);
        c.tag('wire', b.spawnBuilding('wall', them, p.x, p.z, { yawDeg: outward }));
      }
      if (Math.abs(t) < HALF) {
        for (const s of [-1, 1]) {
          const p = yard(t, s * HALF);
          c.tag('wire', b.spawnBuilding('wall', them, p.x, p.z, { yawDeg: outward }));
        }
      }
    }

    /* ==================================================================
     * 4. THE PARTY
     *
     * Twelve hulls, 3 920 credits of them, and no way to make a
     * thirteenth. Four Slaggers because the satchel is the only thing in
     * this army that hurts concrete at a rate worth measuring, four Scrap
     * Pickers as the screen, and four wheels — two Grinders and two
     * Arcspitters — which exist for the withdrawal rather than for the
     * yard.
     *
     * SPAWNED ONE AT A TIME FOR THE FOOT, because `ScenarioBuilder
     * .formation` returns a COUNT and `c.tag` needs a handle, and the
     * exfiltration reads that tag. The wheels go through `formation`
     * precisely because they must NOT carry it: two Arcspitters parked on
     * the pickup are not a crew coming home.
     * ================================================================== */
    const face = wrapDeg(
      Math.atan2(HALT.x - INSERT.x, HALT.z - INSERT.z) * (180 / Math.PI),
    );
    for (let i = 0; i < CREW_SLAGGERS; i++) {
      const off = (i - (CREW_SLAGGERS - 1) * 0.5) * 5;
      c.tag('crew', b.spawnUnit('rclSlagger', us,
        INSERT.x + LANE.px * off - LANE.nx * 4,
        INSERT.z + LANE.pz * off - LANE.nz * 4,
        { yawDeg: face }));
    }
    for (let i = 0; i < CREW_PICKERS; i++) {
      const off = (i - (CREW_PICKERS - 1) * 0.5) * 5;
      c.tag('crew', b.spawnUnit('rclPicker', us,
        INSERT.x + LANE.px * off + LANE.nx * 6,
        INSERT.z + LANE.pz * off + LANE.nz * 6,
        { yawDeg: face }));
    }
    b.formation('rclGrinder', us, INSERT.x + LANE.nx * 16, INSERT.z + LANE.nz * 16, 2,
      { yawDeg: face, spacing: 9, columns: 2 });
    b.formation('rclSpitter', us, INSERT.x - LANE.nx * 14, INSERT.z - LANE.nz * 14, 2,
      { yawDeg: face, spacing: 9, columns: 2 });
    b.block(INSERT.x, INSERT.z, INSERT_CLEAR);

    /* ==================================================================
     * 5. ORE, DRESSING AND THE OPENING FRAME
     *
     * Both fields are the depot's. See the header: `addStartOre` would put
     * its contested patch on the map centre, which is the inside of the
     * yard, and a home field at the player's corner would be ore nobody on
     * this map can lift.
     * ================================================================== */
    if (foeSpot !== undefined) {
      const ux = HALT.x - foeSpot.x;
      const uz = HALT.z - foeSpot.z;
      const ul = Math.max(1e-3, Math.sqrt(ux * ux + uz * uz));
      const nx = ux / ul;
      const nz = uz / ul;
      b.addOre(foeSpot.x + nx * 18 - nz * 44, foeSpot.z + nz * 18 + nx * 44, 30);
      b.addOre(foeSpot.x + nx * 60 + nz * 34, foeSpot.z + nz * 60 - nx * 34, 24);
    }

    // Reserved LAST, so every structure above could still find its own
    // footprint, and wide enough that `scatter` cannot drop a 4 m pine whose
    // canopy overhangs the wire.
    b.block(HALT.x, HALT.z, HALT_CLEAR);
    b.block(PICKUP.x, PICKUP.z, 22);

    // The opening frame: the party in the snow with the halt beyond them.
    // Biased 12% toward the objective, the same bias `allies-sounding-line`
    // uses, so the first thing on screen is the direction the operation goes.
    b.setCameraFocus(
      INSERT.x + (HALT.x - INSERT.x) * 0.12,
      INSERT.z + (HALT.z - INSERT.z) * 0.12,
    );
    b.scatter({ minX: cx - 180, minZ: cz - 180, maxX: cx + 180, maxZ: cz + 180 }, 150);
    void start;
  },
});
