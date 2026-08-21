/**
 * ============================================================================
 * VOLTMARCH — src/campaign/layouts/soviets-nil-return.ts
 * ============================================================================
 * S9 — THE GROUND. Four seam heads the sector is already working, in two pairs
 * at two distances, and one Continental field office planted on the seam to
 * certify that none of them exists.
 *
 * Every figure below is read off a headless build with the def tables BOUND
 * (`buildScenario(..., { defs })`) and `setCampaignRoster` INSTALLED, which is
 * the only state in which this operation's allow-list is actually in force —
 * `spawnBuilding` hands `isBuildable` the RESOLVED def and `rosterAllows`
 * answers TRUE for an undefined one, so a build missing either half is
 * measuring a different game in a way that looks like a pass.
 * `mapSeed` **20261120**, `simSeed` **3203**.
 *
 * ============================================================================
 * THE OPERATION IS A NUMBER IN A BANK, SO THE GROUND IS WHAT PAYS INTO IT
 * ============================================================================
 * Four `civOreMine` heads, owned by the PLAYER from tick zero, because the
 * hinge out of S8 is that the seam is being worked openly by now — an output,
 * not a survey. `CIVILIAN_MINE_INCOME` pays its holder **5 credits a second,
 * 300 a minute** — by `Economy.deposit`, so it honours the ceiling and wastes
 * the overflow exactly as a harvester load does — and
 * `civilian.system.ts#payHolders` pays whichever real army holds the deed,
 * skipping Gaia. Four heads is **1200 a minute**, which over the
 * twenty-two-minute file is **26 400 credits**, from structures the player never
 * has to build and only has to keep.
 *
 * **THAT FIGURE IS THE TOP OF A BAND AND NOT THE OPERATION'S INCOME.** The win
 * floor is two heads of four, and the block below derives the clock on which an
 * undefended far pair goes: at t+5:03, which puts head income at **16 230**.
 * `09-nil-return.ts` carries both rows and derives the army budget from the
 * lower one; quoting 26 400 as the operation's civilian income is quoting its
 * best case, which is what the first draft of both files did.
 *
 *     HEAD_ONE    (212, 332)   110.02 m from the player's yard, 274.42 from theirs
 *     HEAD_TWO    (188, 296)   113.45 m                         268.40
 *     HEAD_THREE  (320, 244)   247.95 m                         137.20
 *     HEAD_FOUR   (284, 196)   251.98 m                         133.30
 *
 *     near pair apart   43.27 m       far pair apart   60.00 m
 *
 * **TWO POSITIONS, NOT FOUR, AND THAT IS THE WHOLE GEOMETRY.** `soviets.05`'s
 * three workings were authored so that no two could be covered at once; this
 * one is authored the other way, because the question here is not WHICH ground
 * to stand on but HOW MUCH of the return to spend standing on it. The Soviet
 * cheap emplacement is `sentryGun` — 400 credits, 480 hp, **zero power draw**,
 * firing `pillboxMg` at **range 22** — and:
 *
 *   - the near pair is **43.267 m** apart, so its midpoint is 21.633 m from
 *     each head. **THE MIDPOINT IS NOT A PLACE A GUN CAN STAND, AND AN EARLIER
 *     DRAFT OF THIS BLOCK CONCLUDED A DESIGN POINT FROM IT.** A `sentryGun`
 *     carries `B.pillbox`, a **1x1** footprint, and `footprintOriginCell` is
 *     `round(x / CELL - w / 2)` — so its centre snaps to the lattice
 *     (4k + 2, 4j + 2), and x = 200 is not on it. Scanning every lattice cell
 *     in a 96 m box that is `footprintBuildable`, `footprintClear` AND inside
 *     `withinBuildRadius` for seat 0 — **130 of them** — the best worst-case
 *     distance to the two heads is **22.804 m**, at three cells:
 *
 *         (198, 314)   20.591 / 22.804      (202, 314)   22.804 / 20.591
 *         (206, 310)   22.804 / 22.804      <- the symmetric one
 *
 *     **Zero cells are within 22 m of both centres.** So the "one gun covers
 *     both by 0.365 m" this file used to claim is measured at **0.804 m
 *     OUTSIDE** range of the far head instead — the sign is reversed — and the
 *     conclusion drawn from it, that a `pillboxMg` retune would silently change
 *     the operation's cheapest answer, is unsupported: **the binding constraint
 *     is the 4 m placement lattice, not the gun's range.** The lattice is also
 *     what quantises the sensitivity — the three best cells sit at 22.804 and
 *     the next ring at 24.166, so the answer changes in steps of 1.36 m and
 *     there is no 0.365 m knife-edge for a retune to fall off.
 *
 *     **AND THE ENGINE DOES NOT USE CENTRE DISTANCE.** `Targeting.isValidTarget`
 *     tests `surface = centreDist - hitRadius(target)`, and `hitRadius` of a 2x2
 *     `civOreMine` is the footprint half-diagonal, `sqrt(4^2 + 4^2)` =
 *     **5.657 m** — so all three cells above sit 4.85 m INSIDE range of both
 *     heads by the rule the sim actually applies, and eight of the 130 do. That
 *     is the reach against the HEADS. A gun defends a head by shooting
 *     ATTACKERS, which carry their own tiny hit radius (`gi` 0.234), so its
 *     useful disc is 22.234 m. From (206, 310), against each head's own 8x8
 *     footprint:
 *
 *                        near corner   centre   far corner
 *         HEAD_ONE          18.111     22.804     27.857
 *         HEAD_TWO          17.205     22.804     28.425
 *
 *     So the gun reaches an attacker on the near face of either head and not one
 *     on the far face, by 5.6 and 6.2 m respectively. **One gun is a real answer
 *     and it is a partial one**; the answer that needs no arithmetic is two
 *     guns, one per head, 800 credits;
 *   - the far pair is **60.00 m** apart, so its midpoint is 30.00 m from each
 *     head and no emplacement covers both at any price or on any lattice cell.
 *     The far pair is a mobile force or it is nothing.
 *
 * **AND EACH HEAD PROJECTS ITS OWN BUILD SPACE, WHICH IS WHY THE PLAYER CAN PUT
 * A GUN THERE AT ALL.** `soviets-short-allocation` derives it: `withinBuildRadius`
 * walks every finished structure the player owns and asks nothing about what
 * kind it is, so a 2x2 `civOreMine` carries `PLACEMENT.adjacencyRadius` 20 plus
 * its own 4 m radius — **24 m** of legal ground around itself. `BUILD_RADIUS` is
 * 56 and the near pair stands at 112 m, so the base's own space does not reach
 * them and their own does. None of that is scripted; it is the placement rule
 * the player already knows, pointed at four buildings they did not build.
 *
 * ============================================================================
 * A HEAD IS 700 HP OF CONCRETE AND THE FIRST WAVE TAKES ONE IN ELEVEN SECONDS
 * ============================================================================
 * `civOreMine` is **700 hp, `ArmorClass.Concrete`**, 2x2. Through
 * `ARMOR_MATRIX` and `COMBAT_DAMAGE.globalMul` 0.80, off the shipped rows:
 *
 *     gi        3 x 18 SmallArms  x0.18  cycle 2x0.09 + 0.85 = 1.03 s   7.55 dps
 *     grizzly   55 ArmorPiercing  x0.55  cooldown 1.5 s                16.13 dps
 *     prismTank 92 Prism          x0.80  cooldown 2.6 s                22.65 dps
 *
 * So the minute-four wave — four G.I.s and two Grizzlies — is **62.46 dps
 * against a head, which is 11.21 seconds**. An unattended far head does not
 * survive the first thing that reaches it, and that is deliberate: the operation
 * asks for two of four at the close, so the player may lose the far pair and
 * still file, at a price of 600 credits a minute for the rest of the shift.
 *
 * **AND THE CLOCK ON WHICH IT HAPPENS IS DERIVABLE, WHICH IS WHAT LETS THE
 * OPERATION PUBLISH A BAND INSTEAD OF A BEST CASE.** `t.survey` forms at ROAD_A
 * and attack-moves to SEAM_FAR. That leg is **120.93 m** and its closest
 * approach to HEAD_FOUR is **17.66 m, at 70.06 m along** — so the infantry
 * (`gi` maxSpeed 3.2) is in contact at +21.9 s and the Grizzlies (6.6) at
 * +10.6 s. Then 11.21 s a head, and 60.00 m between the far heads at the
 * infantry's pace:
 *
 *     21.9 + 11.21 + 18.75 + 11.21 = 63.07 s   ->   far pair down at t+5:03
 *
 * Head income over the file is therefore **26 400 with all four held and 16 230
 * with the far pair lost on that clock** (4 x 300 x 5.05 + 2 x 300 x 16.95).
 *
 * **NOTHING THE LAYOUT PLACES SHOOTS A HEAD, AND THAT WAS CHECKED RATHER THAN
 * INTENDED.** The office's guns are the only emplacements within reach of the
 * seam, and measured on the built world the nearest pairing is the office
 * pillbox at **31.6 m from HEAD_THREE against a 22 m reach** (clear by 9.6 m)
 * and the office tower at **53.1 m against 34** (clear by 19.1 m). A gun that
 * covered a head would delete it in the first minute with nobody deciding
 * anything, which is the failure `tests/campaign-emplacement-reach.spec.ts`
 * exists for one step along from where it looks.
 *
 * ============================================================================
 * THE OFFICE IS A RADAR DOME AND IT IS PLANTED ON THE SEAM ON PURPOSE
 * ============================================================================
 *     FILING   radar   (352, 212)   700 hp   292.48 m from the player, 92.65 from theirs
 *     guns     pillbox (366, 202)   pillbox (346, 226)   prismTower (370, 226)
 *
 * A Radar Dome because the thing being protected is a TRANSMISSION: the
 * establishment's own return goes up the branch line from here, and an office
 * that cannot send is an office with nothing to file. It stands **45.25 m from
 * HEAD_THREE and 69.86 m from HEAD_FOUR** — on the seam, in sight of the two
 * heads whose output it is certifying as nil, which is the joke the operation
 * is built on and also why the hidden secondary is next to ground the player
 * already has to hold rather than 300 m away behind a base.
 *
 * It is **seat 1's, not Gaia's**, so `ownerCount(1, 'building', 'filing',
 * max: 0)` reads it correctly whether the player levels it or walks four
 * engineers into it. `radar` carries no `UNLOCK_TAGS` row, so no roster can
 * refuse it — unlike `weatherControl` in S6, this office cannot silently fail to
 * land.
 *
 * **THE TWO ANSWERS ARE NOT THE SAME PRICE.** `radar.power` is **-40** and
 * `PowerGrid.recompute` sums draw by `store.owner[i]`, so a CAPTURED office
 * joins the captor's grid on the next rescan while a levelled one costs nothing.
 * Against seat 0's measured +105 that is a real number, and it is priced in
 * `09-nil-return.ts` rather than here because the trade is against that file's
 * silo bill. The layout's part of it is only that this is a `radar` on purpose —
 * see above — and that seat 0 already stands one of its own (measured,
 * `radar x1` in the opening census), so the capture buys no tech.
 *
 * **A REBUILT RADAR CARRIES NO TAG AND THAT IS THE RIGHT ANSWER HERE.** `c.tag`
 * runs once, inside this file, so the Ninth-style objection
 * `soviets-short-allocation` raises — an objective a player can defeat by
 * replacing the structure the objective does not recognise — runs the other way
 * for a TAKE rather than a HOLD: the AI rebuilding a radar somewhere else does
 * not un-complete a secondary that has already resolved, and it cannot
 * re-complete one either.
 *
 * ============================================================================
 * THE TWO ROADS OUT OF THEIR CAMP, MEASURED THE WAY `spawnUnits` PLACES
 * ============================================================================
 * `EffectSink.spawnUnits` lays a DETERMINISTIC RING: unit `i` of `count` at
 * `angle = i / count * 2pi`, radius `spread`, written verbatim by
 * `ProductionService.spawnUnit` with no egress search and no `connectedGround`.
 * The guarantee below is a RADIUS rather than a list of ring points, because the
 * exact points move whenever a count moves: **every 2 m sample within the radius
 * is passable to Foot AND to Track on the built world with both bases standing**,
 * so any spread inside it is safe at any count.
 *
 *     ROAD_A   (338, 148)   clear 40 m    65.5 m from their yard, lane offset +30.3
 *     ROAD_B   (460, 112)   clear 38 m    62.0 m from their yard, lane offset -20.3
 *     apart                127.20 m
 *
 * Both sit past `BUILD_RADIUS` (56) from their own yard: a column that has formed
 * up and is about to leave, which is a schedule the opponent gets stronger on,
 * rather than an army materialising inside a defender's formation.
 *
 * **THE TWO BEARINGS ARE THE PAN AND THE BRANCH LINE, AND THE SECOND ONE WAS
 * FOUND RATHER THAN CHOSEN.** A sweep of every 2 m point 62 to 145 m from their
 * yard with a clear radius of 26 or better returns exactly two families: the
 * shoulder of the pan at x ~ 338, and the ground BEHIND their camp at x ~ 460.
 * There is no third. So ROAD_B is the rail head at their back, which is where a
 * force that arrives with the schedule already decided would come off the train,
 * and the operation's opening reveal frames it for that reason.
 *
 * The order points are authored OFF the heads rather than on them, which is
 * `soviets.07.right-of-entry`'s rule with the sign reversed. There it was to
 * keep splash out of a record block; here it is because a heading aimed at one
 * building's own cell is a wave that ignores the other three:
 *
 *     SEAM_FAR    (270, 248)   clear 48 m   50.16 m from HEAD_THREE, 53.85 from HEAD_FOUR
 *     SEAM_NEAR   (230, 290)   clear 38 m   45.69 m from HEAD_ONE,   42.43 from HEAD_TWO
 *     PUSH        (256, 256)   clear 48 m   the contested patch, and the map centre exactly
 *
 * ============================================================================
 * THE ORE, MEASURED THROUGH THE REAL `seedField`
 * ============================================================================
 * `addStartOre` lays one home field per opening plus one contested patch on the
 * midpoint of the two, which for slots 0 and 1 is (256, 256) — the map centre,
 * and the point `PUSH` names. Seeded through the real `OreField.seedField` with
 * the real accept predicate (`!isWater && isPassable(Track)`; `getRoads()` is
 * null here and the road clause degrades to true):
 *
 *     player's home field   (150.1, 402.2)  r 30   132 cells   29 260 credits
 *     theirs                (361.9, 109.8)  r 30   140 cells   28 910
 *     contested             (256.0, 256.0)  r 22    81 cells   15 959
 *                                                    TOTAL     74 129
 *
 * So **45 219 credits of ore are inside the player's reach** and the seam heads
 * are worth 16 230 to 26 400 more, which is the ratio the operation rests on:
 * the heads are not a supplement to the fields, they are a quarter to a third of
 * everything on this map even after the far pair goes. Ore also regrows — CLAUDE.md's measured curve puts a stripped
 * field at 57.6% after five minutes — so the field figure is a floor on a
 * twenty-two-minute file rather than a ceiling.
 *
 * ============================================================================
 * THE OPENING, AND THE ONE NUMBER THE WHOLE OPERATION HANGS ON
 * ============================================================================
 *     seat 0  the sector       32 structures (9 of them wall, 4 of them heads)   13 units
 *     seat 1  the Continental  29 structures (9 of them wall)                    14 units
 *
 *     seat 0 net power                      +105
 *     seat 0 structural storage             5000   (refinery 2000 + two opening silos)
 *     STORAGE_BASE                         10 000
 *     seat 0 credit ceiling at tick zero   15 000
 *
 * The last line is measured through a real `Economy` with the real
 * `storageForSlot` resolver installed, not summed by hand — `recomputeStorage`
 * is the authority on `storageMax` and it overwrites the field outright six
 * times a second, which is why a silo was worth nothing for twenty-odd releases
 * before that resolver existed. The operation asks for a bank of thirty
 * thousand against a ceiling of fifteen, and `deposit` WASTES the overflow. See
 * `09-nil-return.ts`; the whole file is about that gap.
 *
 * ============================================================================
 * NO TRIGONOMETRY IN THE PLACEMENT
 * ============================================================================
 * Every authored point is an integer literal and the search rings are integer
 * offsets. ECMA-262 pins `+ - * /` and `Math.sqrt` and pins neither `sin` nor
 * `cos`; a layout runs independently on both machines of a lockstep match, so a
 * table rotated by trig is a tick-zero desync waiting for two engines to
 * disagree in the last mantissa bit. `rotateStarts` is not called either, for
 * `reclamation-held-paper`'s reason: an operation pins its seed, so the rotation
 * is a moving part with exactly one value.
 *
 * **THE POINTS ARE AUTHORED WHERE THEY LAND, NOT WHERE THEY WERE AIMED.**
 * `place` returning a point is not the same as a structure standing on it —
 * `spawnBuilding` snaps to the footprint grid a second time — and the first
 * draft of this file aimed HEAD_ONE at (204, 332), HEAD_TWO at (168, 296) and
 * the office at (352, 210), which came back displaced by 8.00, 20.00 and 2.00 m.
 * The literals below are the built world's own coordinates, which makes the ring
 * search a CHECK rather than a mechanism: it finds all five at ring zero today
 * and would report if the ground under one ever moved.
 *
 * `simSeed` **3203** draws the start pair **[0, 1]** — the 386.16 m diagonal
 * (that is the SPOT separation; the yards it raises stand 380.06 m apart),
 * the widest of the four layouts on the table and the one this operation needs,
 * because it is the only lane with room for two defended positions and 250 m
 * between them. `soviets.05.short-allocation` is the chapter's other [0, 1]
 * operation and it is on temperate ground at a different roll.
 * `mapSeed` **20261120** was chosen on a measured sweep of ten weekly dates:
 * **95.90%** of the 80 m corridor joining the two openings is open to a tracked
 * hull, the best of the ten against a band of 83.44% to 95.90%, and 73.67% of
 * the whole map is track-passable. **Change either seed and every distance in
 * this file is a different distance.**
 *
 * ============================================================================
 * TAGS
 * ============================================================================
 * `heads`  — the four `civOreMine`, on SEAT 0. Every threshold in the trigger
 *            table counts what seat 0 owns, so a head lost and a head taken read
 *            the same, which is correct and is also unreachable: `Capture.ts`
 *            rule 2 refuses an army-owned structure above `captureHpFrac`,
 *            `GarrisonService.enter` returns `'hostile'` for a structure its
 *            player is not allied to, and `OrderKind.Capture` has zero
 *            occurrences in `src/sim/AI.ts`. The brain has never issued the verb.
 * `filing` — the establishment's Radar Dome, on seat 1, so the hidden secondary
 *            can be answered by a gun or by four engineers.
 * `survey` / `lane` / `pan` / `establishment` / `last` — produced by `spawnUnits`
 *            in the trigger table, never by this file, and declared anyway so a
 *            reader asking where the pressure comes from finds the answer in the
 *            file that owns the ground.
 *
 * NO `addCivilians`: it hangs capturable `civOilDerrick`s off the bisector and
 * walks a `civOreMine` out from the midpoint — a fifth mine silhouette on an
 * operation whose objective counts exactly four of them, and a second income
 * structure competing with the four that are the economy. A player told to work
 * four heads and able to see five is a player the layout has lied to.
 * `soviets-company-town`, `soviets-short-allocation` and `allies-sounding-line`
 * skip it for the same family of reason.
 *
 * **IT READS NO CLOCK, NO PROFILE AND NO DOM.** It runs inside the world build,
 * which is where the tick-zero desync lives: `Scenarios.ts` calls `isBuildable`
 * while spawning, and that answers from the LOCAL profile unless the operation's
 * roster is installed first. `campaign-install.ts` installs it BEFORE the boot.
 * ========================================================================== */

import { MAP_SIZE } from '../../core/config';
import { NONE } from '../../core/types';
import { addStartOre, buildBaseFor, startSpots, wrapDeg } from '../../game/Scenarios';
import type { EntityId, PlayerId } from '../../core/types';
import type { Area, Point } from '../types';
import { layout } from '../layout';

/* ==========================================================================
 * 1. THE PLACES THE TRIGGER TABLE ALSO READS
 *
 * World metres, absolute, on a 512 m map. A trigger table is STATIC DATA frozen
 * at module load, so an `Area` or an order point cannot be derived from a start
 * spot the generator has not chosen yet — the coordinates have to be literals
 * somewhere. This module owns them and `operations/soviets/09-nil-return.ts`
 * imports them; the dependency runs operation -> layout and never back. A number
 * written in two files is a number that will disagree the first time either is
 * tuned, and the failure — a reveal that frames empty ground, a column that
 * lands somewhere nobody authored — is invisible to every gate.
 * ========================================================================== */

/** The map centre. `startPointsFor` reserves a shelf here first, on a continent. */
const CENTRE = MAP_SIZE * 0.5;

/** The near pair. 110.02 m and 113.45 m from the player's yard, 43.27 m apart. */
export const HEAD_ONE: Point = { x: 212, z: 332 };
export const HEAD_TWO: Point = { x: 188, z: 296 };
/** The far pair. 247.95 m and 251.98 m out, 137.20 m and 133.30 m from theirs. */
export const HEAD_THREE: Point = { x: 320, z: 244 };
export const HEAD_FOUR: Point = { x: 284, z: 196 };

/**
 * Where a wave is pointed at each pair, and it is NOT a head's own cell.
 *
 * `soviets.07.right-of-entry` moved its order points 26 m off the record blocks
 * because `Damage.applySplash` clamps `surface` to zero and the wall of a
 * building IS the building. The reason here is different and the answer is the
 * same: a heading aimed at one head's cell is a wave that walks past the other
 * one. Both points are the pair's own ground, 42 to 54 m off either head, on
 * clear footing.
 */
export const SEAM_NEAR: Point = { x: 230, z: 290 };
export const SEAM_FAR: Point = { x: 270, z: 248 };

/** The establishment's field office. 92.65 m from their yard, on the seam. */
const FILING: Point = { x: 352, z: 212 };
/**
 * The office, as a disc, for the reveal that discloses the hidden secondary.
 *
 * r = 34 covers the office and its three guns and stops **11.25 m short** of
 * HEAD_THREE.
 *
 * **`revealArea` IS `Vision.exploreCircle` AND IT IS PERMANENT, SO A DISC THAT
 * ALREADY COVERS ITS SUBJECT MAKES A BEAT INTO A REVEAL OF GROUND THE PLAYER
 * HAS BEEN LOOKING AT.** `soviets-demolition-order` and
 * `soviets-short-allocation` both record paying for that. Measured here rather
 * than argued: the opening reveal at ROAD_B is **147.19 m** from this office and
 * its r 44 stops 103 m short; the minute-four reveal at ROAD_A is **65.51 m**
 * away and its r 42 stops 23.5 m short; and the nearest thing the player owns at
 * tick zero is HEAD_THREE, whose `sight` is **12** against 45.25 m. So all three
 * discs are disjoint from the office, nothing of the player's can see it, and
 * the disclosure is a real reveal whatever order the beats fire in.
 */
export const FILING_AREA: Area = { x: FILING.x, z: FILING.z, r: 34 };

/** The road onto the pan. 65.5 m from their yard, clear to 40 m. */
export const ROAD_A: Point = { x: 338, z: 148 };
/** The branch line behind their camp. 62.0 m from their yard, clear to 38 m. */
export const ROAD_B: Point = { x: 460, z: 112 };
/** The rail head, as a disc, for the opening reveal. */
export const ROAD_B_AREA: Area = { x: ROAD_B.x, z: ROAD_B.z, r: 44 };
/** The road onto the pan, as a disc, for the first wave. */
export const ROAD_A_AREA: Area = { x: ROAD_A.x, z: ROAD_A.z, r: 42 };

/**
 * The contested patch `addStartOre` lays on the midpoint of the two openings,
 * which for slots 0 and 1 is the map centre exactly. 15 959 credits of ore and
 * the ground a player working the far pair has to cross and then leave behind.
 */
export const PUSH: Point = { x: 256, z: 256 };

/* ==========================================================================
 * 2. PLACEMENT
 * ========================================================================== */

/** Metres searched outward for a legal footprint. Nearest first, integer rings. */
const PLACE_RINGS: readonly number[] = [0, 6, 12, 18, 26, 34];
/** Eight exact bearings. Integers only, so every candidate is bit-identical. */
const PLACE_BEARINGS: readonly (readonly [number, number])[] = [
  [1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
];
/** Ring zero is the nominal spot itself; the bearings would test it eight times. */
const ORIGIN_ONLY: readonly (readonly [number, number])[] = [[0, 0]];

/** Metres reserved around a head, so `scatter` leaves it approachable. */
const HEAD_CLEAR = 14;

/**
 * The office's guns, as offsets from the office, and they are STRUCTURES for the
 * reason every other campaign guard is: `AiBrain.regroupSquads` files every
 * untagged hull the seat owns into a squad on its next pass — measured on
 * `02-common-standard`, two parked Wardens were 116-129 m away inside twenty
 * seconds — and an emplacement cannot be re-filed. Measured where they land:
 *
 *     pillbox     (366, 202)   pillboxMg  range 22, power 0
 *     pillbox     (346, 226)   pillboxMg  range 22, power 0
 *     prismTower  (370, 226)   prismTowerBeam range 34, power -50
 *
 * `prismTower` needs `struct.defence.specialist` on `roster.ai` or
 * `spawnBuilding` returns NONE and the office stands behind two machine guns.
 * The operation lists it; the tower is also why taking the office is a decision
 * rather than a walk. And `op.foe` is `Faction.Allies`, so `keyFor` resolves
 * `prismTower` to ITSELF — on a Soviet seat the same key is a **Tesla Coil**,
 * which chains twice and would delete two conscripts per trigger pull. That is
 * `reclamation.01.held-paper`'s defect and the reason
 * `tests/campaign-emplacement-reach.spec.ts` exists; the resolved weapon was
 * read off the built world rather than inferred from the key.
 */
const FILING_GUNS: readonly { readonly key: string; readonly x: number; readonly z: number }[] = [
  { key: 'pillbox', x: 14, z: -10 },
  { key: 'pillbox', x: -6, z: 14 },
  { key: 'prismTower', x: 18, z: 14 },
];

export default layout({
  id: 'soviets-nil-return',
  tags: ['heads', 'filing', 'survey', 'lane', 'pan', 'establishment', 'last'],

  build(b, cx, cz, start, c) {
    /*
     * THE EXPORTED POINTS ARE ABSOLUTE AND THE START SPOTS ARE DERIVED FROM
     * (cx, cz), SO THE TWO HAVE TO AGREE. `buildScenario` passes `startShelf()`,
     * which `startPointsFor` puts at the map centre on every continent. If that
     * ever stops being true this file is dressing ground the trigger table is
     * not naming — and it would be invisible, because every tag would still land
     * and every test would still pass.
     */
    if (Math.abs(cx - CENTRE) > 1 || Math.abs(cz - CENTRE) > 1) {
      console.error(
        `[campaign] soviets-nil-return built on (${cx}, ${cz}), not the map centre `
        + `(${CENTRE}, ${CENTRE}) — the seam is authored in absolute coordinates and will not `
        + 'line up with the openings this build lays down.',
      );
    }

    const spots = startSpots(cx, cz, b.armies, b.sea, b.seed);

    /*
     * SLOT ORDER, NOT `rotateStarts`. See the header: the seed is a constant for
     * an operation, so the rotation has exactly one value and taking it would
     * make every measured coordinate in this file depend on `startOffset`.
     */
    for (let i = 0; i < spots.length; i++) {
      buildBaseFor(b, c.seat(i), spots[i].x, spots[i].z, {
        facingDeg: wrapDeg(spots[i].facingDeg + 180),
      });
    }

    // `c.seat` is `b.armySlot`, which CREATES a slot rather than returning
    // undefined, so neither of these needs a fallback — and a `?? us` here would
    // be a dead branch that reads as a guard.
    const us: PlayerId = c.seat(0);
    const them: PlayerId = c.seat(1);
    const home = spots[0];

    /* -- placement helper -------------------------------------------------
     * `findClearFootprint` ALONE IS NOT ENOUGH and the build says so out loud.
     * It asks `footprintClear` (is anything already there) and `connectedGround`
     * (can an army reach it) and NOTHING about slope, so `spawnBuilding` will
     * plant a structure on a grade `isBuildable` refuses and report success —
     * the split `footprintBuildable`'s own header draws. `snow` carries the
     * HIGHEST `relief` in `MAP_PRESETS` at 0.50 on `cliffs` 0.40 — not the
     * steepest overall, since `arid` is `cliffs` 0.55 — which is why both
     * questions are asked and the shipped search is only the fallback.
     */
    const scratch = new Float32Array(2);
    const place = (key: string, p: Point): Point => {
      const f = b.footprintOf(key);
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

    /* -- the four seam heads ----------------------------------------------
     * PLACED FIRST, because they are the operation's economy and everything else
     * gives way to them. Owned by the PLAYER from tick zero: the hinge out of S8
     * is a seam being worked openly, so `ownerCount(0, 'building', 'heads')`
     * reads 4 on the first tick and only ever falls.
     *
     * `civOreMine` carries no `UNLOCK_TAGS` row, so this operation's allow-list
     * cannot refuse one — which matters more here than anywhere else, because a
     * refused `spawnBuilding` returns NONE, the tag lands on nothing, and
     * `ownerCount(max: 1)` would end the operation in defeat twenty seconds in
     * with every test still green. `campaign-maps.spec.ts` checks the
     * declaration both ways and `campaign-roster-ground.spec.ts` checks it again
     * with the roster actually armed.
     *
     * It is also a CIVILIAN key, which is the load-bearing half: no sidebar in
     * the game builds one, so a head the player loses is gone. An `oreSilo` — 150
     * credits, five seconds — would otherwise let a player rebuild the thing on
     * the same spot and find the count still reading it as lost, because a
     * rebuilt structure carries no tag.
     */
    for (const nominal of [HEAD_ONE, HEAD_TWO, HEAD_THREE, HEAD_FOUR]) {
      const at = place('civOreMine', nominal);
      const id: EntityId = b.spawnBuilding('civOreMine', us, at.x, at.z, { yawDeg: 0 });
      c.tag('heads', id);
      if (id !== NONE) b.block(at.x, at.z, HEAD_CLEAR);
    }

    /* -- the establishment's field office ---------------------------------
     * ON SEAT 1, NOT GAIA, so the hidden secondary can read `ownerCount(1, ...,
     * max: 0)` and be answered by a gun or by four engineers. A Gaia office
     * would be allied to both armies, unshootable by targeting scan, and
     * capturable for free — which is the opposite of every word in the briefing.
     */
    {
      const at = place('radar', FILING);
      const id: EntityId = b.spawnBuilding('radar', them, at.x, at.z, { yawDeg: 300 });
      c.tag('filing', id);
      if (id !== NONE) b.block(at.x, at.z, 14);
      for (const g of FILING_GUNS) {
        const gun = place(g.key, { x: at.x + g.x, z: at.z + g.z });
        const gid = b.spawnBuilding(g.key, them, gun.x, gun.z, { yawDeg: 300 });
        if (gid !== NONE) b.block(gun.x, gun.z, 8);
      }
    }

    /* -- economy and dressing ---------------------------------------------
     * See the header for the seeded figures. `addStartOre` puts the contested
     * patch on the midpoint of the two openings, which for slots 0 and 1 is
     * (256, 256) exactly — the point `PUSH` names.
     */
    addStartOre(b, spots, b.sea);

    // The opening frame: the yard with the lane behind it. Biased 13% toward
    // the centre, the same bias `allies-sounding-line` uses, so the first thing
    // on screen is the direction the operation goes.
    b.setCameraFocus(home.x + (cx - home.x) * 0.13, home.z + (cz - home.z) * 0.13);
    b.scatter({ minX: cx - 170, minZ: cz - 170, maxX: cx + 170, maxZ: cz + 170 }, 150);
    void start;
  },
});
