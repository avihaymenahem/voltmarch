/**
 * ============================================================================
 * VOLTMARCH — src/campaign/layouts/pact-open-count.ts
 * ============================================================================
 * THE GROUND FOR `pact.05.open-count`: a Pact yard town on the seam with the
 * Conclave's Oculus standing in the middle of it, two Sept Glaive Posts on the
 * side the player has to come from, the assessors' station sixty-five metres
 * back, and the Sept's forward chapterhouse two thirds of the way to their
 * opening.
 *
 * **THIS FILE OWNS EVERY NUMBER THE OPERATION HEADER ARGUES.** That header
 * quotes OUTPUTS — 65.12 m between the hall and the witnesses, 31.11 and
 * 34.06 m to the two posts, 19.70 m from the chapterhouse to the drop point,
 * 174.63 m from the player's opening to the hall, 60.00 m of clearance between
 * the reading floor and the opening-to-opening axis — and all of them are
 * consequences of the nine constants declared below.
 *
 * **AND EVERY DISTANCE HERE HAS TO BE READ AGAINST TWO BARS, NOT ONE.** A unit
 * STOPS CLOSING at `range * APPROACH_STOP_FRAC (0.80) + hitRadius`; it FIRES out
 * to `range + hitRadius`. The second is the larger, `Combat.engage` is the one
 * that decides whether the archive takes damage, and this file's first version
 * placed its gun line against the first alone. See §3.
 *
 * Everything is measured on a headless build at `mapSeed` 18 355 /
 * `simSeed` 3 571 with the def tables BOUND and this operation's roster
 * INSTALLED — `tests/campaign-roster-ground.spec.ts`'s build, not
 * `tests/campaign-maps.spec.ts`'s, which passes no `defs` and installs no
 * roster. Ground truth is the real `Terrain`, the real
 * `FlowFieldCache.costGridFor`, and the entity store AFTER `spawnBuilding`
 * snapped every footprint. **RE-MEASURE, DO NOT RE-QUOTE**, if either seed moves.
 *
 * ============================================================================
 * 0. IT IS A MIRROR, SO `keyFor` RESOLVES BOTH SEATS THE SAME WAY
 * ============================================================================
 * `OperationDef.foe` is `Faction.Meridian`, which no other shipped operation
 * declares. `ScenarioBuilder.keyFor` remaps a role key by the OWNER's faction,
 * so every role key in this file resolves to the same def on both seats:
 * `radar` -> `mrdOculus`, `pillbox` -> `mrdGlaive`, `barracks` ->
 * `mrdChapterhouse`, and inside `buildBaseFor` the whole opening — `grizzly` ->
 * `mrdSolarch`, `gi` -> `mrdWayfarer`, `engineer` -> `mrdArtificer`,
 * `harvester` -> `mrdCollector`.
 *
 * **THAT LAST ONE IS LOAD-BEARING FOR THE OPERATION'S OPENING DECISION.** Both
 * seats therefore open with exactly ONE Artificer, which is why the capture bill
 * in `05-open-count.ts` is three more at 500 rather than four at 500. And the
 * Sept's copy is now tactically meaningful: a disciplined brain can use it for
 * one visible legal capture and move an escort with it.
 *
 * The `civOilDerrick` is the one key that is NOT remapped, because
 * `FACTION_KEY_MAP` holds role keys only and the civilian block is faction-blind
 * by construction (`Faction.Neutral` in `Defs.ts`). It is spawned on the
 * PLAYER's seat here, deliberately — see §4.
 *
 * ============================================================================
 * 1. THE FRAME
 * ============================================================================
 * `simSeed` 3 571 draws an EDGE pair:
 *
 *     home (Pact,  seat 0)   404, 132
 *     foe  (Sept,  seat 1)   108, 132
 *     axis                   296.000 m
 *
 * Every point in this file is `at(n, p)`: `n` metres along the unit vector from
 * home to foe, `p` metres along its LEFT perpendicular. Two consequences worth
 * knowing before changing anything. Positive `n` is toward the enemy, so
 * `GUN_BACK` puts the Sept's posts BEHIND the hall from their point of view and
 * IN FRONT of it from the player's, which is the side the fight comes from. And
 * `urban` has no `MAP_SEAS` row, so `islandSeats` hands back the raw start
 * spots; `foe = seats[1] ?? seats[0]` is the one-army guard and nothing else in
 * the file branches on the seat count.
 *
 * **THE EDGE PAIR RATHER THAN THE 386.16 m DIAGONAL IS A CHOICE, AND THE ORE IS
 * WHY.** `addStartOre` puts the contested patch on the centroid of the openings,
 * and the reading floor has to clear it (§2). Measured on both pairs at
 * `OCULUS_ALONG` 0.56, at the offset that buys the same ore clearance:
 *
 *     pair                       ore edge   nominal home -> hall
 *     3 529, diagonal 386.161      42.3 m         224.42 m
 *     3 571, edge     296.000      40.6           176.28   <- shipped
 *
 * Forty-eight metres of extra approach, on foot, four times over: the diagonal
 * turns a capture-and-hold into a march, and the ore is what forbids buying the
 * distance back with a smaller offset.
 *
 * ============================================================================
 * 2. THE HALL — `OCULUS_ALONG` 0.56, `OCULUS_OFFSET` 60
 * ============================================================================
 *     anchor requested   238.24, 72.00      placed   240, 72   (moved 1.76 m)
 *
 *     home -> hall   174.63 m straight   199.7 m of walked path   (+14.4%)
 *     foe  -> hall   145.00 m straight   176.7 m on Foot          (+21.9%)
 *     ROAD -> hall    85.91 m straight    98.7 m                  (+14.9%)
 *
 * `foe -> hall` is the ONE row where Foot and Hover disagree — 176.7 against
 * 177.7 — and this table used to quote the Hover figure while `05-open-count.ts`
 * claimed the two classes agree to 0.1 m everywhere. Measured both before and
 * after the `GUN_SPREAD` widening and identical on both, so it is a property of
 * the ground rather than of the gun line.
 *
 * **0.56 PUTS IT IN THE SEPT'S HALF, WHICH IS WHAT MAKES IT A CAPTURE.** The
 * player's base garrison walks 199.7 m to reach it — 26.3 s for a Solarch at
 * 7.6 m/s, 55.5 s for an Artificer at 3.6 — and the Sept's walks 176.7 m, so
 * every exchange over the hall is one the player is further from resupplying.
 * `pact.04.in-the-clear` sits its objective at 0.34 for the opposite reason: it
 * is defending its own ground there and taking somebody else's here.
 *
 * **`OCULUS_OFFSET` 60 IS DERIVED FROM THE ORE, AND THE ORE IS THE HAZARD
 * NOBODY WOULD HAVE SEEN.** `unitsInArea` counts Infantry and Vehicles, and a
 * harvester is a Vehicle, so a field inside the operation's 24 m reading floor
 * would mean the economy stopping the primary on its own, in silence, for both
 * armies. `addStartOre` declares three on this map — r 30 at 386,88 and r 30 at
 * 126,176 beside the two openings, and the contested r 22 on the centroid at
 * 256,132. Swept through the real frame at `OCULUS_ALONG` 0.56, nearest ore EDGE
 * to the hall:
 *
 *     OCULUS_OFFSET   nearest ore edge   clear of the 24 m floor by
 *        40                21.8 m            INSIDE the floor by 2.2 m
 *        50                31.1               7.1 m
 *        60                40.6              16.6 m   <- shipped
 *        70                50.2              26.2
 *
 * Those four are the NOMINAL point, before `spawnBuilding` snaps the footprint;
 * the shipped row measures **40.1 m** once placed, i.e. 16.1 m of rim clearance,
 * and that placed figure is the one the operation header quotes. Below about 45
 * the contested patch is under the reading floor and a harvester of either army
 * pauses the count every time it crosses. 60 also buys the second
 * property the operation turns on: the hall stands **exactly 60.00 m off the
 * opening-to-opening axis** (placed z 72 against an axis at z 132), so the
 * straight line between the two bases clears the floor rim by **36.00 m** and
 * traffic between the openings cannot stop the primary.
 *
 * **THAT IS THE DELIBERATE INVERSION OF `pact.04`'s PAIRING.** There
 * `TAP_OFFSET` 26 is paired with `LOT_R` 28 precisely so the axis CUTS the disc,
 * because its hidden bonus must not be winnable by standing aside and waving a
 * column through. A bonus may be hostage to traffic; a primary may not.
 * `05-open-count.ts` states the same pair from its side. Change one and change
 * both notes.
 *
 * On the built ground, **108 of the 112 cells whose centre falls inside 24 m of
 * the placed hall are open — the same 108 for Foot, Track and Hover**, so "the
 * floor" is one number rather than three.
 *
 * ============================================================================
 * 3. THE GUN LINE — `GUN_BACK` 22, `GUN_SPREAD` 24
 * ============================================================================
 *     requested   262.00, 96.00   and   262.00, 48.00
 *     placed      262, 98 (moved 2.00)  262, 50 (moved 2.00)
 *
 * `keyFor` resolves `pillbox` on a Meridian seat to `mrdGlaive`, so these are
 * Glaive Posts: 480 hp of Concrete, 24 m of `glaiveRepeater`, 60.76 dps into
 * `ArmorClass.Infantry` and 33.42 into `ArmorClass.Light`. They stand **34.06 m
 * and 31.11 m** from the hall on the home side. FOUR consequences, and the first
 * of them is why `GUN_SPREAD` is 24 rather than the 16 this file shipped with.
 *
 *   - **NEITHER POST CAN FIRE ON THE HALL, AND AT `GUN_SPREAD` 16 BOTH COULD.**
 *     `Combat.engage` gates firing on SURFACE distance —
 *     `surfaceDist = max(0, flat - hitRadius(target))`, `return` when
 *     `surfaceDist > w.range` (`src/sim/Combat.ts`) — so against the hall's
 *     `hitRadius(2, 2)` of 5.6569 a Glaive Post reaches **29.657 m of centre**,
 *     which is FURTHER than the 26.457 m at which `Targeting.approach` would
 *     stop it if it could move. The old line stood at 26.08 and 28.43 m: inside
 *     that bar, outside the operation's 24 m reading floor, and therefore able
 *     to kill the CAPTURED archive from ground the player had been told to
 *     ignore. `t.hallLost` does not care who fired.
 *
 *     Measured, not argued. Headless run at these seeds with a real Sept brain
 *     on seat 1 and the hall handed to the player at t = 0:
 *
 *         GUN_SPREAD 16   650 hp -> 425 at 10 s -> 201 at 20 s -> DEAD at 28.1 s
 *                         from FULL health, nothing in range but the two posts
 *                         (22.4 dps observed against 2 x 10.937 = 21.87 derived)
 *         GUN_SPREAD 24   650 hp UNCHANGED at 30, 60, 90, 120, 150 and 180 s
 *
 *     Surface clearance now: 28.402 m and 25.456 m against a 24 m reach, i.e.
 *     4.402 and 1.456 m past the gate. **The narrow one is the near post and it
 *     is the number to re-check after any `glaiveRepeater` retune** — a range of
 *     26 would put it back inside.
 *
 *     The floor could not absorb this instead. `FLOOR_R` would have to reach
 *     29.657 to cover the posts, which is past the 26.457 m armour stand-off, so
 *     hulls and men would both stop on the floor and the operation's whole
 *     doctrine would go with it.
 *
 *   - **an Artificer walked at an unbroken post still dies in 1.56 s** (95 hp
 *     against 60.76 dps) on the approach the player actually walks, and ONE of
 *     the two posts still covers the capture step itself. `Capture.withinReach`
 *     is a box test — the hall's 8x8 m footprint grown by `CAPTURE.reachMetres`
 *     2.2 plus the engineer's `radius` 0.234 — so a legal capture point is at
 *     most 8.091 m from the hall's centre, and the nearest such point is
 *     **22.79 m of surface distance** from the post at 262,50 (inside its 24)
 *     and **25.76 m** from the post at 262,98 (outside it). That asymmetry is
 *     the honest price of the widening: an engineer that reaches the west face
 *     has one gun to break instead of two.
 *
 *   - **the posts still cover the hall's approach, WITH NO LANE BETWEEN THEM.**
 *     Their 24 m discs at z 50 and z 98 meet at exactly z 74, so the corridor at
 *     x 262 is covered continuously from z 26 to z 122 and there is no gap on
 *     the axis. `GUN_SPREAD` 26 was measured and rejected for exactly this: it
 *     puts both posts at 34.06 m (a wider margin on the hall) and opens a
 *     **4 m unwatched lane at z 70..74**, which is the hall's own z and the line
 *     a column would walk straight down.
 *
 *   - **and they can never reach the assessors' station.** An emplacement cannot
 *     chase — `Targeting.reachOf` returns 0 for anything failing `canDrive` — so
 *     its bar against a 2x2 is `24 * 1.08 + 5.6569` = **31.577 m**, and the
 *     NEARER post is **44.27 m** from the station. Clear by 12.70 m, which is
 *     BETTER than the 10.85 m the narrow line left. **That is the safety
 *     property `GUN_BACK`, `GUN_SPREAD`, `POST_BACK` and `POST_SIDE` exist to
 *     hold together**, because a post is the one gun in the match nobody orders:
 *     it fires on whatever `Targeting` hands it, and a station inside its bar
 *     would die at t = 0, silently, taking a 400-credit secondary with it.
 *
 * ============================================================================
 * 4. THE ASSESSORS' STATION — `POST_BACK` 64, `POST_SIDE` -12
 * ============================================================================
 *     requested   304.00, 84.00      placed   304, 84   (moved 0.00 m)
 *
 *     hall -> station    65.12 m        home -> station  110.92 m (130.8 walked)
 *     nearest Glaive Post 44.27 m       nearest Sept rifleman 47.76 m
 *
 * A `civOilDerrick` — 900 hp, `ArmorClass.Concrete`, 2x2 — **on the PLAYER's
 * seat**, and that ownership is the whole design of the secondary it carries.
 *
 * **IT PAYS THE PLAYER FIFTEEN CREDITS A SECOND, AND BOTH FILES USED TO SAY IT
 * PAID NOTHING.** `src/sim/civilian.system.ts#payHolders` matches a building on
 * `st.defId[i] === binding.buildingId.civOilDerrick` and skips only owners whose
 * faction is `Faction.Neutral`. Measured on the built world, the station's
 * `defId` is **51**, the binding's `civOilDerrick` is **51**, and the owner is
 * seat 0 (Meridian). `CIVILIAN_INCOME` is `credits: 15, intervalTicks: 30` —
 * **900 a minute, 15 300 over the operation's 1 020 s par**. So this structure
 * is a second economy rather than a decorative objective, and
 * `05-open-count.ts` argues the secondary around the drip rather than around its
 * 400-credit payout.
 *
 * **A GAIA STATION WAS THE OBVIOUS CHOICE AND IT IS THE WRONG ONE.**
 * `ScenarioBuilder.gaia` allies the Neutral slot to everybody in both
 * directions and `Targeting.isValidTarget` refuses ALLIES, so a Gaia derrick is
 * a building nothing in the match will ever fire on: the secondary could not
 * fail, and a secondary that cannot fail is decoration. `payHolders` also skips
 * a Neutral owner, so it would not have paid anybody either — the player's seat
 * buys BOTH properties with one decision. Owned by the player it is an ordinary
 * enemy structure to the Sept and dies in 5.92 s to the fourth column's 152.10
 * dps into Concrete.
 *
 * **64 m BACK IS SET BY THE GUN LINE, NOT BY TASTE.** The station has to sit
 * outside every Sept bar on the board at t = 0, and the binding one is the
 * nearer Glaive Post's 31.577 m. That post lands at 262, 98 and the station at
 * 240 + `POST_BACK`, 84, so the gap is `hypot(POST_BACK - 22, 14)` — arithmetic
 * from the PLACED post rather than a build sweep, which is what the dz of 14
 * records:
 *
 *     POST_BACK   nearest post -> station   against the 31.577 m bar
 *        40             22.80 m              INSIDE — the station burns down
 *                                            in 82.3 s at 10.94 dps, from t = 0
 *        52             33.11                clear by 1.53
 *        56             36.77                clear by 5.19
 *        64             44.27                clear by 12.70   <- shipped
 *
 * The three Sept riflemen open on `Stance.Defensive`, whose
 * `STANCE_CHASE_METRES` entry is **0**, so they take the same non-chasing bar:
 * `20 * 1.08 + 5.6569` = 27.257 m against 47.76, 51.91 and 55.76 m. Clear by
 * 20.50 m at the nearest.
 *
 * So the station comes under fire only when a column is past the hall, which is
 * exactly the state the secondary exists to price — and until then it is the
 * natural place for the player to form up, because it is forty-four metres
 * outside the nearest Sept gun and 130.8 m of walked path from home.
 *
 * ============================================================================
 * 5. THE SEPT'S DETACHMENT, AND WHAT IT IS HONESTLY FOR
 * ============================================================================
 * Three `mrdWayfarer` on `Stance.Defensive`, placed at 248.24,84 / 252.24,88 /
 * 256.24,84 — **14.56, 20.15 and 20.19 m from the hall**, so ALL THREE are
 * inside the operation's 24 m reading floor.
 *
 * **THAT USED TO BE ONE OF THREE, UNDER A HEADER THAT CLAIMED ALL THREE.** The
 * spawn offsets were `(12 + 5i)` along and `(-14 - 5(i%2))` across, which placed
 * them at 17.345, 24.357 and 24.610 m: the header stated those three numbers
 * correctly and then concluded *"at 17 to 25 m they are inside the reading
 * floor"*, which is false for two of them by 0.357 and 0.610 m. `FLOOR_R` is 24
 * and `unitsInArea` tests `dx*dx + dz*dz <= r*r` against the unit's own centre,
 * so 24.357 is outside — and 24.357 is also INSIDE `pulseCarbine`'s 25.657 m
 * firing bar against a 2x2, which meant two riflemen could shoot the captured
 * archive from ground the reading-floor clause could not see. The offsets are
 * `(10 + 4i)` / `(-12 - 4(i%2))` now and the nearest margin is 3.81 m.
 *
 * **THEY ARE AN OPENING PICTURE, NOT A GARRISON, AND THIS FILE WILL NOT CLAIM
 * OTHERWISE.** `tests/campaign-maps.spec.ts` records the measurement:
 * `AiBrain.census` files every non-harvester Infantry/Vehicle on an AI seat into
 * `armyIds` and `regroupSquads` marches it to the brain's rally, within
 * `AI_CADENCE.squad` = 6 ticks, and a layout has no way to opt out.
 * `soviets.02.common-standard` hung a secondary on two hulls that were 116.6 and
 * 129.2 m from the ground they were placed to guard by t+20 s.
 *
 * So the hall's standing defence is the two Glaive Posts and nothing else, which
 * is what the operation's capture arithmetic is written against. The three men
 * exist because a building this operation is named after should not open
 * unattended, and because standing them ON the floor is the one free lesson the
 * ground can teach: the player will not notice at t = 0 and will notice at the
 * moment they take the hall, which is the right time to learn what the floor is.
 * Their distance to the assessors' station — 47.76, 51.91, 55.76 m against a
 * 27.257 m non-chasing bar — moved OUTWARD with them, so §4's clearance improved
 * rather than tightened.
 *
 * ============================================================================
 * 6. THE CHAPTERHOUSE — `HOUSE_ALONG` 0.70, `HOUSE_OFFSET` -34
 * ============================================================================
 *     requested   196.80, 166.00      placed   196, 168   (moved 2.15 m)
 *
 *     house -> ROAD    19.70 m      house -> hall   105.60 m (117.0 walked)
 *     house -> foe     95.08 m      house -> station 136.82 m
 *
 * 0.70 puts it two thirds of the way to the Sept's opening and -34 puts it on
 * the OTHER side of the axis from the hall, which does two things. It makes
 * `ROAD` — the drop point every wave forms on, 19.70 m away — read as coming out
 * of the chapterhouse rather than out of nowhere; and it holds the drop 105.60 m
 * from the hall, so the armour half of each column takes 13.0 s to arrive and
 * the infantry half 26.0 to 30.8 s, which is the split the operation's floor
 * clause is paced by. Pushing it further along the axis shortens the walk to the
 * hall AND puts the 500-credit secondary inside the Sept base's own defence
 * ring; 95.08 m from their opening is the compromise.
 *
 * It brings a Glaive Post 20 m from it on the hall side — `-n` is toward home,
 * so the post faces the player rather than sitting behind the chapterhouse.
 *
 * ============================================================================
 * 7. `PLACE_RINGS` 7 — A FALLBACK WITH A 28 m BOUND
 * ============================================================================
 * `place` walks outward ring by ring for ground the footprint can legally stand
 * on, testing `footprintClear` AND `footprintBuildable`. Seven rings at `CELL` 4
 * is **28 m of silent displacement per structure** — numerically the same as
 * this operation's floor radius plus four metres, which is a coincidence and a
 * useful one to hold in mind: a hall that used the whole search could end up
 * further from where this file put it than the floor is wide, and every distance
 * in this header would be wrong with nothing failing.
 *
 * **NOTHING ON THIS SEED NEEDS IT.** Measured requested-to-placed displacement
 * for all five structures: hall 1.76 m, station 0.00, chapterhouse 2.15, and
 * 2.00 m for each Glaive Post — half a cell at worst, most of which is
 * `spawnBuilding`'s own footprint snapping rather than the ring search. The
 * three Sept riflemen move 1.76 m each, which is `spawnUnit`'s own nudge and not
 * this function.
 *
 * **THE SNAP IS A 4 m STAIRCASE AND THAT IS WHY §3's SWEEP IS COARSE.** Swept
 * through the real build at `GUN_SPREAD` 16, `GUN_BACK` 26 and 28 place
 * identically, as do 30/32 and 34/36 — and `GUN_BACK` 30 lands the near post at
 * 29.530 m of the hall, which misses the 29.657 m firing bar by **0.127 m**.
 * That near miss is why the fix moved `GUN_SPREAD` rather than `GUN_BACK`:
 * pushing the line back far enough to clear the bar (34) also brought the far
 * post to 34.06 m of the assessors' station against a 31.577 m acquisition bar,
 * clear by only 2.48 m, where widening it clears the station by 12.70 m
 * instead. **Do not derive a placed position arithmetically from these
 * constants** — sweep and read it back.
 *
 * **THE FAILURE MODE IS A TAG THAT NEVER STAMPS.** If the rings find nothing,
 * `place` tries `findClearFootprint` and, failing that, returns the RAW point;
 * `spawnBuilding` then runs the SAME `findClearFootprint` from it and returns
 * `NONE` when that fails too. `LayoutContext.tag` silently ignores `NONE`, so
 * the structure is simply absent — and `entityDead` on an absent tag reads TRUE
 * from tick one, which fails the player at t = 0 with no message. Two gates
 * catch it: `tests/campaign-maps.spec.ts` builds every operation headless and
 * compares the declared tag list against what actually landed, and
 * `tests/campaign-roster-ground.spec.ts` does the same with the roster
 * installed, which is the path where `isBuildable` can refuse a def outright.
 *
 * ============================================================================
 * 8. THE GROUND, AND WHAT IT COSTS TO RE-SEED
 * ============================================================================
 *     the floor: 112 cells whose centre is inside 24 m of the placed hall,
 *       108 of them open — and the same 108 for Foot, Track and Hover
 *     ore: three declared fields (r 30 at 386,88; r 30 at 126,176; the
 *       contested r 22 at 256,132) and the nearest edge is 40.1 m from the
 *       hall, i.e. 16.1 m OUTSIDE the floor rim, and 45.9 m from the station
 *     233 entities alive with the roster installed, 241 without it — unchanged
 *       by the `GUN_SPREAD` widening, and the eight withheld are still
 *       `mrdReliquary` x1, `mrdHelios` x1 and `mrdSkiff` x2 on EACH seat
 *
 * `b.block` clearances — 18 on the hall, 16 on the station, 10 on each Glaive
 * Post, 22 on the chapterhouse — keep `b.scatter`'s 150 props out of the fight
 * rather than out of the frame; the scatter box is the five named points
 * expanded by 80 m.
 *
 * **WHAT A RE-SEED HAS TO RE-CHECK, IN ORDER.** The gun line against the HALL
 * (are both Glaive Posts still past 29.657 m of the placed hall, and are all
 * three riflemen still inside 24 — this is the one that shipped a defeat and it
 * goes first); the ore clearance (is the nearest field edge still outside 24 m
 * of the placed hall); the gun line against the station (is the nearer Glaive
 * Post still past 31.577 m, and are the three riflemen past 27.257); the axis
 * clearance (`OCULUS_OFFSET` >
 * `FLOOR_R`); the ring points of all four waves at `ROAD`, which
 * `tests/campaign-spawn-ground.spec.ts` fails by name; and the walked path
 * lengths, which the operation header paces its four waves from and which
 * nothing checks at all.
 * ========================================================================== */

import { NONE, Stance } from '../../core/types';
import { CELL } from '../../core/config';
import {
  addStartOre, buildBaseFor, islandSeats, startSpots, wrapDeg,
} from '../../game/Scenarios';
import type { EntityId, PlayerId } from '../../core/types';
import { layout } from '../layout';

/**
 * The hall. Fraction of the opening-to-opening line — 165.76 m of a 296.000 m
 * axis, which is 199.7 m of walked path from the player's opening and 176.7 m
 * from the Sept's. Header §2.
 */
const OCULUS_ALONG = 0.56;
/**
 * Metres off that axis, on the left-hand perpendicular of home -> foe.
 *
 * DERIVED FROM THE ORE, AND PAIRED WITH `FLOOR_R` = 24 IN
 * `operations/pact/05-open-count.ts`. Below about 50 the contested patch on the
 * centroid sits under the reading floor and a harvester of either army pauses
 * the primary every time it crosses; at 60 the nearest ore edge is 16.1 m
 * outside the rim. It also holds the hall exactly 60.00 m off the axis against a
 * 24 m floor, so traffic between the two openings clears the rim by 36.00 m.
 * Change one and change the other. Header §2.
 */
const OCULUS_OFFSET = 60;

/**
 * Metres the Sept's gun line stands on the HOME side of the hall. With
 * `GUN_SPREAD` it puts the two Glaive Posts 31.11 and 34.06 m from it, covering
 * the approach to roughly 55 m out — and, with `POST_BACK`, 44.27 m from the
 * assessors' station against an emplacement's own 31.577 m bar. Header §3.
 */
const GUN_BACK = 22;
/**
 * Metres between the two posts, across the axis.
 *
 * **IT WAS 16 AND THE ARCHIVE DIED IN 28.1 SECONDS.** At 16 the posts placed at
 * 26.08 and 28.43 m of the hall, which is inside `glaiveRepeater`'s FIRING bar
 * of `24 + hitRadius(2,2) 5.6569` = 29.657 m and outside the operation's 24 m
 * reading floor — so both could kill the CAPTURED Oculus from ground the player
 * had been told to clear, and `t.hallLost` ends the match in defeat. 24 places
 * them at 31.11 and 34.06 m, past the bar by 1.46 and 4.40 m of surface
 * distance, and their 24 m discs still meet on the axis with no lane between
 * them. **PAIRED WITH `FLOOR_R` = 24 IN `operations/pact/05-open-count.ts`, and
 * the pairing is a firing bar rather than a stand-off.** Header §3.
 */
const GUN_SPREAD = 24;

/**
 * Metres the assessors' station stands back toward home from the hall.
 *
 * DERIVED, AND THE FLOOR IS ABOUT 52: below it the station sits inside the
 * nearer Glaive Post's 31.577 m bar and burns down in 82.3 s starting at t = 0,
 * taking a 400-credit secondary — and the 900 credits a minute it pays — with it
 * and telling the player nothing. 64 clears it by 12.70 m. Header §4.
 */
const POST_BACK = 64;
/** Metres across the axis from the hall, on the same side as `OCULUS_OFFSET`. */
const POST_SIDE = -12;

/**
 * The Sept's forward chapterhouse: two thirds of the way to their opening and
 * across the axis from the hall, so the drop point is 19.70 m from it and
 * 105.60 m from the hall. Header §6.
 */
const HOUSE_ALONG = 0.70;
const HOUSE_OFFSET = -34;

/**
 * Cells searched outward for ground a footprint can legally stand on. Seven at
 * `CELL` 4 bounds silent displacement at 28 m per structure; nothing on this
 * seed moves more than 2.15 m, and the failure mode past the search is a tag
 * that never stamps. Header §7.
 */
const PLACE_RINGS = 7;

export default layout({
  id: 'pact-open-count',

  // `column` is produced by the operation's `spawnUnits`, not stamped here. It
  // is declared anyway so a reader looking for "where does this come from" finds
  // the answer in the file that owns the ground; `validateCampaign` and
  // `campaign-maps.spec.ts` both skip a tag a trigger spawns.
  tags: ['oculus', 'post', 'house', 'column'],

  build(b, cx, cz, start, c) {
    const spots = startSpots(cx, cz, b.armies, b.sea, b.seed);
    const seats = islandSeats(spots, b.sea);

    const pact: PlayerId = c.seat(0);
    const sept: PlayerId = c.seat(1);
    const home = seats[0];
    const foe = seats[1] ?? seats[0];

    /* -- the frame -------------------------------------------------------- */
    const dx = foe.x - home.x;
    const dz = foe.z - home.z;
    const len = Math.max(1e-3, Math.sqrt(dx * dx + dz * dz));
    const nx = dx / len;
    const nz = dz / len;
    const px = -nz;
    const pz = nx;

    /** Metres along the axis, metres along its left perpendicular. */
    const at = (n: number, p: number): { x: number; z: number } => ({
      x: home.x + nx * n + px * p,
      z: home.z + nz * n + pz * p,
    });

    const inward = wrapDeg(Math.atan2(nx, nz) * (180 / Math.PI));
    const outward = wrapDeg(inward + 180);

    const scratch = new Float32Array(2);
    const place = (
      owner: PlayerId, key: string, p: { x: number; z: number },
    ): { x: number; z: number } => {
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

    const raise = (
      owner: PlayerId, key: string, p: { x: number; z: number },
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
    buildBaseFor(b, sept, foe.x, foe.z, { facingDeg: wrapDeg(foe.facingDeg + 180) });

    /* -- the hall --------------------------------------------------------- */
    const anchor = at(len * OCULUS_ALONG, OCULUS_OFFSET);
    const hall = raise(sept, 'radar', anchor, 'oculus', outward, 18);

    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? -1 : 1;
      raise(
        sept, 'pillbox',
        {
          x: hall.x - nx * GUN_BACK + px * (s * GUN_SPREAD),
          z: hall.z - nz * GUN_BACK + pz * (s * GUN_SPREAD),
        },
        null, inward, 10,
      );
    }

    // The opening picture, not a garrison — see header §5. ALL THREE stand
    // inside the reading floor on purpose (14.56, 20.15, 20.19 m of the placed
    // hall against `FLOOR_R` 24): the player meets the rule at the moment the
    // hall becomes theirs rather than in a briefing line they have already
    // scrolled. The offsets were `(12 + 5i)` / `(-14 - 5(i%2))` and put two of
    // the three at 24.36 and 24.61 m — OUTSIDE the floor and INSIDE
    // `pulseCarbine`'s 25.657 m firing bar, which is the annulus §3 exists to
    // close. Re-measure if either number moves.
    for (let i = 0; i < 3; i++) {
      const q = {
        x: hall.x - nx * (10 + i * 4) + px * (-12 - (i % 2) * 4),
        z: hall.z - nz * (10 + i * 4) + pz * (-12 - (i % 2) * 4),
      };
      b.spawnUnit('mrdWayfarer', sept, q.x, q.z, { yawDeg: inward, stance: Stance.Defensive });
    }

    /* -- the assessors' station ------------------------------------------- */
    const station = raise(
      pact, 'civOilDerrick',
      {
        x: hall.x - nx * POST_BACK + px * POST_SIDE,
        z: hall.z - nz * POST_BACK + pz * POST_SIDE,
      },
      'post', outward, 16,
    );

    /* -- the Sept's forward chapterhouse ---------------------------------- */
    const house = raise(
      sept, 'barracks', at(len * HOUSE_ALONG, HOUSE_OFFSET), 'house', outward, 22,
    );
    raise(
      sept, 'pillbox',
      { x: house.x - nx * 20, z: house.z - nz * 20 }, null, outward, 10,
    );

    /* -- ore and dressing -------------------------------------------------- */
    addStartOre(b, spots, b.sea);

    const minX = Math.min(home.x, foe.x, hall.x, house.x, station.x) - 80;
    const maxX = Math.max(home.x, foe.x, hall.x, house.x, station.x) + 80;
    const minZ = Math.min(home.z, foe.z, hall.z, house.z, station.z) - 80;
    const maxZ = Math.max(home.z, foe.z, hall.z, house.z, station.z) + 80;
    b.scatter({ minX, minZ, maxX, maxZ }, 150);

    b.setCameraFocus(hall.x, hall.z);
    void start;
  },
});
