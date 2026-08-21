/**
 * ============================================================================
 * VOLTMARCH — src/campaign/layouts/allies-misclosure.ts
 * ============================================================================
 * A4 — THE GROUND. Three buildings decide this operation and neither army put
 * any of them there: a Works reduction office standing a hundred metres outside
 * the player's wire, a transmitter block sixty metres behind their yard, and a
 * Soviet forward muster on the far ridge that every scripted column forms on.
 *
 * ============================================================================
 * MEASURED, ON THE WORLD THIS FILE ACTUALLY BUILDS
 * ============================================================================
 * Every figure below is read off `store.posX/posZ` after `spawnBuilding` snapped
 * each footprint to the placement grid, on a headless build at `mapSeed`
 * 20 260 928 / `simSeed` 7 035 with the def tables BOUND and this operation's
 * roster INSTALLED through `setCampaignRoster` — the only state in which either
 * is true. Unbound and unrostered the same build is a different game; the
 * control at the end of this header counts what the roster actually withholds.
 *
 *     thing        key             owner    landed        hp    footprint
 *     office       civHospital     PLAYER   (326, 308)   1100     3x2
 *     transmitter  civApartments   Gaia     (448, 418)    800     2x3
 *     muster       barracks        Soviet   (168, 236)    800     2x2
 *     two guns     pillbox->sentryGun       (186, 222) and (182, 254), 480 each
 *
 * **ALL THREE LAND ON THEIR AUTHORED LITERALS AT RING ZERO.** They are written
 * here as the coordinates the built world reports rather than as nominal points
 * the search then walks off — `soviets-short-allocation` records why, and it is
 * the same trap: **`place` returning a point is not the same as a structure
 * standing on it**, because `spawnBuilding` snaps the result to the footprint
 * grid a second time. The ring search below is therefore a CHECK on this ground
 * rather than the mechanism that found it, and it would report if the terrain
 * under any of the three ever moved.
 *
 * The two openings, and they are NOT the Construction Yards:
 *
 *     start spots      (404, 380) facing -129.958   (108, 132) facing 50.042
 *                      386.16 m apart
 *     Construction     player (402, 378)            Soviet (110, 134)
 *     Yards            380.53 m apart
 *
 * That gap is 2.83 m per seat, and it matters because every distance a briefing
 * quotes is a distance to a BUILDING. Each number below names the thing it
 * measures.
 *
 * ============================================================================
 * THE OFFICE IS 103.32 m FROM THE PLAYER'S YARD AND THAT IS THE OPERATION
 * ============================================================================
 * Far enough that the base's own guns and its build space do not reach it, near
 * enough that the whole opening army can be there inside a minute.
 *
 *     office -> the player's Construction Yard    103.32 m   route  99.2 m
 *     office -> the Soviet Construction Yard      277.37 m   route 293.9 m
 *     office -> the nearest PLAYER structure       85.44 m   (a wall segment)
 *     office -> the nearest SOVIET structure      153.79 m   (a muster gun)
 *
 * `route` is 8-connected Dijkstra over the real `Terrain.passGrid` for
 * `Locomotor.Track` with occupancy included, measured between the nearest free
 * cell to each centre — 8.0 m off the yard and 6.0 m off the office — because
 * both centres are under a footprint and no hull ever stands on either.
 *
 * **NOTHING THE PLAYER OWNS AT TICK ZERO MAKES THAT GROUND LEGAL TO BUILD ON,
 * AND THE OFFICE DOES.** `withinBuildRadius` gives an `IsBuilder` structure
 * `BUILD_RADIUS` 56 plus its own `store.radius`, and everything else
 * `PLACEMENT.adjacencyRadius` 20 plus the same — measured at the FOOTPRINT
 * CENTRE of the thing being placed. Taken over every other player structure on
 * the built world:
 *
 *     the Construction Yard   103.32 m away, projects 56 + 6.00 = 62.00
 *                             -> 41.32 m SHORT, and it is the best of them
 *     the nearest wall         85.44 m away, projects 20 + 2.00 = 22.00
 *                             -> 63.44 m short
 *
 * **THE NEAREST STRUCTURE IS NOT THE ONE THAT COMES CLOSEST TO REACHING, AND
 * THIS BLOCK SAID IT WAS.** It quoted the wall's 63.44 m as "the best any of
 * them does", which is the smallest DISTANCE and the largest DEFICIT: the yard
 * is 18 m further away and projects 40 m more. Sort by `d - projection`, never
 * by `d`. The conclusion survives the correction — 41.32 m is still short — and
 * the number to quote is 41.32.
 *
 * The office projects 20 + 6.00 = **26.00 m**, and **102 of the 134 cells inside
 * that ring are ground `isBuildable` accepts (76.1%)**. 134, not the 137 this
 * said: the office centre is a cell centre in x (326 = 81*4+2) and a cell
 * BOUNDARY in z (308 = 77*4), so the ring is sampled on a lattice offset 2 m in
 * one axis and holds three fewer cells than the both-centred count the geometry
 * gives. 137 and 74% were computed rather than read off the built world.
 *
 * So a Pillbox — 400 credits, 500 hp, `pillboxMg` at 22 m, and `power: 0`, so it
 * does not go dark in a brownout — goes up beside the office without the player
 * extending the base to reach it. None of that is scripted; it is the placement
 * rule the player already knows, pointed at a building they did not build.
 *
 * **WHAT IT DOES NOT BUY IS EXCLUSIVITY, AND THIS BLOCK CLAIMED IT DID.** It
 * read "and it goes up ONLY because the office is standing", which is false and
 * measured false: the yard's own radius reaches to **43.86 m** from the office
 * centre, and **one 100-credit Concrete Wall** founded out there projects 22 m,
 * which lands inside the office's ring. One structure, two seconds of build
 * time, a tenth of the Pillbox's price. The office saves the player 100 credits
 * and one click; it is a CONVENIENCE with a facing, not the only key to that
 * ground, and an operation that leaned on the stronger reading would be leaning
 * on nothing.
 *
 * **AND THE ARITHMETIC OF THAT RING IS WORTH DOING ONCE.** An Anvil Tank shells
 * the office from 26 m of `heavyCannon` SURFACE range plus the office's own
 * `hitRadius` — `sqrt((3*4/2)^2 + (2*4/2)^2)` = 7.21 m — so it stands 33.21 m
 * from the office's centre to do it. A Pillbox founded at the far edge of the
 * build ring on the threatened side is 26 m from that centre with 22 m of
 * surface reach of its own, which covers the standoff twice over; one founded
 * on the wrong side is 59 m from the same Anvil and covers nothing. The ring is
 * an affordance with a facing, not a bubble.
 *
 * ============================================================================
 * THE OFFICE IS THE PLAYER'S, NOT GAIA'S, AND THAT IS THE WHOLE DEFEND
 * ============================================================================
 * `ScenarioBuilder.gaia` allies the Neutral slot to everybody in both
 * directions, so a Gaia-owned objective **cannot be shot at by the opponent**.
 * `allies.02.instrument-room` relies on exactly that for its own office and says
 * so in as many words; here it would delete the operation. Player-owned from
 * tick zero, it is a legitimate Soviet target from tick zero.
 *
 * Three consequences, and the second is a hazard rather than a feature:
 *
 *   - **It is garrisonable by its owner.** `GarrisonService.refusalFor` allows
 *     an unarmed, non-production structure at or above `GARRISON.minFootprint`
 *     (2 on BOTH axes) whose owner the entrant is allied to — and a player is
 *     allied to themselves. 3x2 clears it and `GARRISON.capacity` is 5. Five
 *     riflemen inside the building the operation is about is a real firing
 *     position that no trigger here authored.
 *   - **The player's own splash reaches it.** `Damage.applySplash` halves an
 *     allied hit by `COMBAT_DAMAGE.friendlyFireMul` (0.5) and does not refuse
 *     it, so a Warden brawling on the doorstep is chipping the thing it is
 *     defending. That is honest, and it is why the operation carries a line at
 *     four tenths.
 *   - **It cannot be rebuilt and it cannot be taken.** `civHospital` has no
 *     `ContentSpec` in `Production.ts`, so no sidebar in the game makes one and
 *     a lost office is lost — the property `soviets-short-allocation` picks its
 *     own civilian keys for. And `AiBrain` has never issued `OrderKind.Capture`
 *     (zero occurrences in `src/sim/AI.ts`), so the only thing the Soviets can
 *     do to it is knock it down.
 *
 * **`civHospital` RATHER THAN THE OTHER THREE CIVILIAN SILHOUETTES**, and the
 * reason is partly the chapter. It is the widest of them — 12x8 m under a 10 m
 * roofline — which is what a room of desks and a levelling drum reads as rather
 * than a tower or a headframe; and `allies.02.instrument-room` has already spent
 * `civApartments` on a survey office and `civOreMine` on a Works mast, so a
 * third silhouette is what lets a player who has played A2 tell this building
 * from those.
 *
 * ============================================================================
 * THE TRANSMITTER IS GAIA, IT PAYS NOTHING, AND BOTH ARE DELIBERATE
 * ============================================================================
 * `civApartments` at (448, 418), **60.96 m behind the player's Construction
 * Yard** and 164.27 m from the office, on the far side of the base from every
 * approach. The operation's early-out is `structureCaptured` on it, so what this
 * file owes the trigger table is that taking it is always POSSIBLE and never
 * ACCIDENTAL:
 *
 *   - **Always possible.** Gaia is allied to everybody, so no Soviet column can
 *     level the player's way out of a bad match. **72 of the 78 cells** within
 *     20 m of it are foot-passable — this said 75 of 81, which is the count on a
 *     both-axes-centred lattice; the block's own x lands on a cell boundary
 *     (448 = 112*4) so the real disc holds three fewer cells. Six are shut
 *     either way. The walk is 78.9 m of Foot route from the
 *     player's yard — 23.2 s at an engineer's 3.4 m/s — against 175.8 m from the
 *     office, which is 51.7 s and is the honest price of sending the man who is
 *     already forward.
 *   - **Never accidental.** Both routes to `structureCaptured` are explicit
 *     orders: `Capture.ts` rule 1 flips a neutral structure outright for one
 *     engineer, and `GarrisonService.enter` flips it for as long as a squad
 *     stands inside. Neither happens by walking past. It is 60.96 m BEHIND the
 *     yard, on ground no column ever crosses, so it is not a firing position
 *     anybody would take for its own sake either.
 *
 * **IT PAYS NOTHING, WHICH IS WHY IT IS NOT A DERRICK OR A MINE.**
 * `civilian.system.ts` credits the holder of a `civOilDerrick` 900 credits a
 * minute and of a `civOreMine` 300; `civApartments` and `civHospital` are in
 * neither income row. A structure whose capture is a NARRATIVE decision must not
 * also be an economic one, or the player is choosing between a medal and a wage.
 *
 * ============================================================================
 * THE MUSTER, AND THE ONE BUILDING THE WHOLE FORK RESTS ON
 * ============================================================================
 * A Soviet `barracks` at (168, 236) — **117.34 m from their own Construction
 * Yard**, 273.72 m from the player's, 173.63 m from the office — with two
 * `pillbox` keys that `ScenarioBuilder.keyFor` turns into **Sentry Guns** on a
 * Soviet seat (480 hp, `pillboxMg` at 22 m, `power: 0`, so they do not fall
 * silent with the rest of the base). Both stand 22.80 m from the muster.
 *
 * A REAL BARRACKS RATHER THAN A PROP, and it buys three things a scripted flag
 * could not:
 *
 *   - it is a PRODUCER, so `AiBrain.census` counts it and the Soviet infantry
 *     queue runs faster while it stands (`FACTORY_SPEED_BONUS`) — taking it off
 *     them therefore costs them something the trigger table never mentions, and
 *     a player who takes it with ENGINEERS rather than shells gets the same
 *     producer on their own seat, because `ProductionService.census` counts a
 *     `barracks` for whoever holds the deed;
 *   - it is a BUILDING on an AI seat, which is what `campaign-maps.spec.ts`
 *     requires of any tag a world condition reads — and since the migration the
 *     reads are `ownerCount(..., role: 'building')`, so "a building on seat 1"
 *     is now the LITERAL text of the predicate rather than an implication of it.
 *     A parked hull would be
 *     filed into a squad by `regroupSquads` on the first brain pass and driven
 *     off the ridge. That measurement is in `campaign-maps.spec.ts`'s own
 *     header, taken on `soviets.02.common-standard`: two Wardens parked on an
 *     objective were 116.6 m and 129.2 m from it by t+20 s and died 127 m away
 *     having never stood on it;
 *   - it draws only **-20** power against a Soviet grid measured at 600 produced
 *     / 230 consumed on this build, so the watch it stands over cannot brown out
 *     the base that owns it. `allies-ground-truth` had to check the same thing
 *     for fourteen Glaive Posts, and it is cheap to check.
 *
 * **`barracks` CARRIES NO `UNLOCK_TAGS` ROW, WHICH IS LOAD-BEARING UNDER AN
 * EMPTY ROSTER.** `spawnBuilding` consults the progression gate, so a tagged key
 * here would return `NONE`, the tag would land on nothing, and
 * `ownerCount(1, 'building', 'muster', min: 1)` would read FALSE for the whole
 * match — deleting both late columns on tick one, silently, with every gate
 * green. **The other polarity is worse and it is why `t.musterDown` carries a
 * settle guard**: `max: 0` reads TRUE against an empty registry, so the same
 * failed placement would COMPLETE the 500-credit secondary and pay it out.
 * (Both were true of the `entityAlive` / `entityDead` pair this replaced, for
 * the same reason and in the same directions; the migration did not create the
 * hazard, it inherited it.) `sentryGun` and `civHospital` are untagged for the
 * same reason, and `campaign-maps.spec.ts` checks the declaration in both
 * directions.
 *
 * ============================================================================
 * `ROAD` IS WHERE THE COLUMNS LAND, AND IT IS A RING RATHER THAN A POINT
 * ============================================================================
 * `EffectSink.spawnUnits` puts unit `i` of `count` at `angle = i / count * 2pi`
 * and radius `spread`, and `ProductionService.spawnUnit` writes that position
 * VERBATIM — no `connectedGround`, no egress search of any kind, unlike
 * `ScenarioBuilder.spawnUnit`, which this file uses and which does search. So
 * the guarantee this file owes is about GROUND, not about a point:
 *
 *     ROAD (212, 240)   44.18 m from the muster,  132.74 m from the office,
 *                       147.11 m from the Soviet Construction Yard,
 *                       234.83 m from the player's,
 *                       141.8 m of Track route to the office
 *
 * **Every 2 m sample within 30 m of it is passable to Foot AND to Track**, on
 * the built world with both bases, the muster and its two guns standing — so any
 * ring up to 30 m and any count is safe, and the widest the operation authors is
 * 20 m. Measured per drop rather than trusted: all thirty scripted hulls land on
 * passable ground, and the tightest of them has **11.31 m** of clear ground to
 * the nearest cell its own locomotor could not enter — anchored at the CELL
 * CENTRE the drop falls in, which is why it is exactly `8 * sqrt(2)`. From the
 * drop's own float position, which is where the hull actually stands, the same
 * worst case is 11.64 m. The cell figure is the conservative one; say which
 * anchor a clearance is quoted from or the two disagree by a metre and nobody
 * knows which is wrong.
 *
 * It sits OUTSIDE the muster rather than on it — the guns are 31.62 m and
 * 33.11 m away — because a column materialising inside its own emplacements
 * reads as the map having nowhere else to put it, and because the ring has to
 * miss two occupied footprints. It clears the contested ore as well: that patch
 * is 46.8 m away and 22 m in radius, so the widest ring's nearest point is
 * 26.8 m from its centre, **4.8 m outside the rim**.
 *
 * ============================================================================
 * ECONOMY, AND WHY THERE IS NO AUTHORED FIELD
 * ============================================================================
 * `addStartOre` and nothing else. It lays one home field per opening on the
 * flank away from the lane and one contested patch on the centroid of the two,
 * which on this seeded pair is the map centre exactly:
 *
 *     (418.46, 334.71) r30   46.3 m from the player's yard,  96.2 m from the office
 *     ( 93.54, 177.29) r30   46.3 m from the Soviet yard,    94.8 m from the muster
 *     (256.00, 256.00) r22   87.2 m from the office, 90.2 m from the muster,
 *                            190.3 m from each yard
 *
 * **THE CONTESTED PATCH IS 87.2 m FROM THE OFFICE, AND THAT IS THE POINT.**
 * Holding the office does not hold the ore and mining the ore does not defend
 * the office; they are two positions 87 m apart, and sixteen minutes is long
 * enough that ignoring the second one is a real cost. An authored fourth field
 * would have made that choice on the player's behalf.
 *
 * **NO `addCivilians`.** It hangs capturable `civOilDerrick`s off the
 * perpendicular bisector and walks `MINE_BISECTOR_OFFSETS` out for a
 * `civOreMine` — four more neutral structures, two of them paying income, in the
 * middle of a map whose whole subject is which three buildings matter. A player
 * told to hold one civilian building and shown five has been lied to by the
 * ground. `soviets-short-allocation` and `allies-ground-truth` skip it for the
 * same reason.
 *
 * ============================================================================
 * WHAT THE EMPTY ROSTER ACTUALLY WITHHOLDS, MEASURED
 * ============================================================================
 * Two builds, identical except for `setCampaignRoster`:
 *
 *     seat            with the roster                cleared (the control)
 *     player          12 units, 24 structures        14 units, 26 structures
 *     Soviets         13 units, 27 structures        16 units, 31 structures
 *
 *     the player loses   2 Sabre IFVs, a Proving Ground and a Refractor Tower
 *     the Soviets lose   1 Sledge Tank, 2 Attack Dogs, a Proving Ground
 *                        and THREE Tesla Coils
 *
 * With the roster in force the openings are:
 *
 *     player     5 G.I., 4 Warden Tanks, 1 engineer, 2 harvesters
 *                23 structures of base — yard, refinery, war factory, barracks,
 *                radar, 4 power plants, 2 silos, 3 Pillboxes, 9 wall segments —
 *                plus the office
 *     Soviets    6 Conscripts, 5 Anvil Tanks, 2 harvesters
 *                24 structures of base — yard, refinery, war factory, barracks,
 *                radar, 6 power plants, 2 silos, 2 Flame Towers, 9 wall
 *                segments — plus the muster and its two guns
 *
 * 23 against 24. The asymmetry this operation ships is the ground and the
 * schedule, not the size of the opening. Power on the same build: the player at
 * 400 produced against 170 consumed, the Soviets at 600 against 230.
 *
 * The build audit reports **1 passable region for a tracked hull holding 12 331
 * of 12 331 cells (100.0%), 0 placements relocated, 0 entities stranded and 0
 * structures on ground `isBuildable` refuses.**
 *
 * ============================================================================
 * NO TRIGONOMETRY, NO ROTATION, NO PROFILE, NO CLOCK
 * ============================================================================
 * Every authored point here is an integer literal and every search offset is an
 * integer. ECMA-262 pins `+ - * /` and `Math.sqrt` to bit precision and pins
 * `sin`/`cos`/`atan2` to nothing at all; a layout runs independently on both
 * machines of a lockstep match, so a table built by trig is a tick-zero desync
 * waiting for two engines to disagree in the last mantissa bit. `rotateStarts`
 * is not called either — an operation pins its seed, so the rotation is a moving
 * part with exactly one value, and taking it would make every coordinate here
 * depend on `startOffset` for no variety at all.
 *
 * ============================================================================
 * TAGS
 * ============================================================================
 * `office`  — the reduction office, PLAYER-owned. Read by `entityAlive`,
 *             `entityDead` and `entityHpBelow`. It is the whole primary.
 * `mast`    — the transmitter block, Gaia. Read by `structureCaptured`. It is
 *             tagged rather than left as scenery so `campaign-maps.spec.ts`
 *             proves it landed: an early-out over bare ground is a way out the
 *             player is told about and cannot take, and nothing else would
 *             notice.
 * `muster`  — the Soviet forward barracks. Read by `ownerCount` ON SEAT 1 and by
 *             nothing else: `min: 1` gates both late columns, `max: 0` pays the
 *             raid. **It was `entityAlive` / `entityDead`, and those count LIVE
 *             entities**, so neither could see the deed move — a barracks the
 *             player had captured with engineers went on gating Soviet columns
 *             from their own books, and the secondary that pays for removing it
 *             was unreachable and then failed at the close. See
 *             `operations/allies/04-misclosure.ts`'s header for the migration
 *             and `tests/campaign-capture-blind.spec.ts` for the sweep that
 *             found it.
 * `col1`..`col4` — the four columns, produced by `spawnUnits` in the trigger
 *             table and never by this file. Declared anyway, so a reader asking
 *             where the pressure comes from finds the answer in the file that
 *             owns the ground; `validateCampaign` and `campaign-maps.spec.ts`
 *             both know a spawned tag is not the layout's to place.
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
 * somewhere. This module owns them and `operations/allies/04-misclosure.ts`
 * imports them; the dependency runs operation -> layout and never back. A number
 * written in two files is a number that will disagree the first time either is
 * tuned, and the failure — a reveal framing empty ground, a column ordered at a
 * building that is not there — is invisible to every gate.
 * ========================================================================== */

/** The map centre. `startPointsFor` reserves a shelf here first, on a continent. */
const CENTRE = MAP_SIZE * 0.5;

/**
 * The player's START SPOT at `mapSeed` 20 260 928 / `simSeed` 7 035.
 *
 * `seatedSlots(2, 7035, null)` draws the pair **[2, 3]** — the other antipodal
 * diagonal from the one A1, A2 and A3 all sit on, at the same 386.16 m of
 * separation. This is a literal rather than a call to `startSpots` because the
 * OPERATION has to name world points in static data; `build` seats both bases
 * from the real `startSpots` and warns if the two ever stop describing one
 * world. **It is not the Construction Yard** — that lands at (402, 378) — and
 * every distance in the header is quoted against the yard, not against this.
 */
const HOME: Point = { x: 404, z: 380 };
/** The Soviet start spot at the same seeds. Their yard lands at (110, 134). */
const FOE: Point = { x: 108, z: 132 };

/**
 * The Works reduction office. PLAYER-OWNED, 1100 hp, and the primary objective.
 * Lands on this literal at ring zero: 103.32 m from the player's Construction
 * Yard and 277.37 m from the Soviet one.
 */
export const OFFICE: Point = { x: 326, z: 308 };

/**
 * The transmitter block. Gaia, 800 hp, 60.96 m behind the player's yard, and the
 * operation's authored early-out. See the header for why it is neutral, why it
 * pays nothing, and why capturing it cannot happen by accident.
 */
export const MAST: Point = { x: 448, z: 418 };

/**
 * The Soviet forward muster: a real `barracks` on their seat, 117.34 m from
 * their yard. Both late columns are gated on it still being THEIRS — the deed,
 * not the corpse; see the TAGS block above.
 */
export const MUSTER: Point = { x: 168, z: 236 };

/**
 * Where the columns actually land — 44.18 m outside the muster, on the road to
 * the office. Every 2 m sample within 30 m of it is passable to Foot AND to
 * Track on the built world, against a widest authored ring of 20 m.
 */
export const ROAD: Point = { x: 212, z: 240 };

/** The briefing reveal over the office. 56 m covers its whole build ring. */
export const OFFICE_AREA: Area = { x: OFFICE.x, z: OFFICE.z, r: 56 };
/** 56 m over the muster covers both its guns (22.80 m) and `ROAD` (44.18 m). */
export const MUSTER_AREA: Area = { x: MUSTER.x, z: MUSTER.z, r: 56 };
/** 34 m over the transmitter, which is the one thing the player must be told about. */
export const MAST_AREA: Area = { x: MAST.x, z: MAST.z, r: 34 };

/* ==========================================================================
 * 2. PLACEMENT
 * ========================================================================== */

/**
 * The muster's two guns, as plain world offsets from where the barracks landed.
 *
 * BOTH ON THE ROAD SIDE, which is the side a raid arrives from, and both far
 * enough from `ROAD` that no spawn ring can land on their footprints: measured
 * 31.62 m and 33.11 m from it against a 20 m ring. Two rather than three,
 * because the raid is the operation's fork and a third gun makes it a wall
 * rather than a fight — the price of going is already 284.3 m of Track route
 * each way plus whatever the office takes while its army is away.
 */
type Offset = readonly [dx: number, dz: number];
const MUSTER_GUNS: readonly Offset[] = [[16, -14], [14, 16]];

/** Rings searched outward for a legal footprint, in metres. Nearest first. */
const PLACE_RINGS: readonly number[] = [0, 6, 12, 18, 26, 34];
/** Eight exact bearings. Integers only, so every candidate is bit-identical. */
const PLACE_BEARINGS: readonly (readonly [number, number])[] = [
  [1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
];
/** Ring zero is the nominal spot itself; the bearings would test it eight times. */
const ORIGIN_ONLY: readonly (readonly [number, number])[] = [[0, 0]];

/** Metres reserved around the office so `scatter` leaves its build ring clear. */
const OFFICE_CLEAR = 22;
/** The same around the transmitter, which a man has to be able to walk into. */
const MAST_CLEAR = 14;
const MUSTER_CLEAR = 18;
const GUN_CLEAR = 10;

/* ==========================================================================
 * 3. THE BUILD
 * ========================================================================== */

export default layout({
  id: 'allies-misclosure',
  tags: ['office', 'mast', 'muster', 'col1', 'col2', 'col3', 'col4'],

  build(b, cx, cz, start, c) {
    /*
     * THE EXPORTED POINTS ARE ABSOLUTE AND THE START SPOTS ARE DERIVED FROM
     * (cx, cz), SO THE TWO HAVE TO AGREE. `buildScenario` passes `startShelf()`,
     * which `startPointsFor` puts at the map centre on every continent. If that
     * ever stops being true, this file is dressing ground the trigger table is
     * not naming — and it would be invisible, because every tag would still land
     * and every gate would still pass.
     */
    if (Math.abs(cx - CENTRE) > 1 || Math.abs(cz - CENTRE) > 1) {
      console.error(
        `[campaign] allies-misclosure built on (${String(cx)}, ${String(cz)}), not the map centre `
        + `(${String(CENTRE)}, ${String(CENTRE)}) — the three buildings are authored in absolute `
        + 'coordinates and will not line up with the openings this build lays down.',
      );
    }

    const spots = startSpots(cx, cz, b.armies, b.sea, b.seed);
    const us: PlayerId = c.seat(0);
    const them: PlayerId = c.seat(1);
    const home = spots[0];
    const foe = spots[1] ?? spots[0];

    /*
     * AND THE OTHER HALF OF THE SAME GUARD. `HOME` and `FOE` are literals
     * because the trigger table needs world points as static data; `build` seats
     * the bases from the real `startSpots`. A generator change that slid an
     * opening would move the BASES and leave the office, the transmitter and the
     * muster exactly where they are — and the transmitter, 60.96 m behind the
     * yard, is the one with the least room to absorb it. Four metres is one cell.
     */
    if (Math.abs(home.x - HOME.x) > 4 || Math.abs(home.z - HOME.z) > 4
      || Math.abs(foe.x - FOE.x) > 4 || Math.abs(foe.z - FOE.z) > 4) {
      console.warn(
        `[allies-misclosure] openings moved: player (${String(home.x)}, ${String(home.z)}) and `
        + `foe (${String(foe.x)}, ${String(foe.z)}) against the authored (${String(HOME.x)}, `
        + `${String(HOME.z)}) and (${String(FOE.x)}, ${String(FOE.z)}). Every distance in this `
        + 'layout and every reveal in the operation is measured against the authored pair — '
        + 're-measure.',
      );
    }

    /* -- placement --------------------------------------------------------
     * Ground a footprint can legally stand on: `footprintBuildable` AND
     * `footprintClear`, searched in rings with a fixed traversal order so two
     * runs of one seed build the same world.
     *
     * `findClearFootprint` ALONE ANSWERS THE WRONG QUESTION — it tests occupancy
     * and connectivity and nothing about grade, which is how `soviets-first-tap`
     * came to ship seven structures on ground `isBuildable` refuses. It is kept
     * as the fallback and nothing on this ground reaches it: all three buildings
     * are accepted at ring zero.
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

    /* -- the two openings -------------------------------------------------- */
    buildBaseFor(b, us, home.x, home.z, { facingDeg: wrapDeg(home.facingDeg + 180) });
    buildBaseFor(b, them, foe.x, foe.z, { facingDeg: wrapDeg(foe.facingDeg + 180) });

    /* -- the reduction office ---------------------------------------------
     * PLAYER-OWNED, and the header carries the argument: a Gaia structure is
     * allied to everybody and cannot be attacked, which would leave this
     * operation with nothing to defend.
     */
    raise(us, 'civHospital', place(us, 'civHospital', OFFICE), 'office', 40, OFFICE_CLEAR);

    /* -- the transmitter block --------------------------------------------
     * GAIA, so the player's way out cannot be taken from them, and so that
     * `structureCaptured` means an order somebody deliberately gave.
     */
    raise(b.gaia, 'civApartments', place(b.gaia, 'civApartments', MAST), 'mast', 90, MAST_CLEAR);

    /* -- the Soviet forward muster ----------------------------------------
     * A REAL BARRACKS, on their seat, with two emplacements. Emplacements rather
     * than parked hulls because `AiBrain.regroupSquads` files every untagged
     * hull an AI seat owns into a squad on its next pass and drives it to the
     * rally point — measured on `02-common-standard` at 116-129 m inside twenty
     * seconds. A Sentry Gun cannot be re-tasked.
     */
    {
      const seat = place(them, 'barracks', MUSTER);
      raise(them, 'barracks', seat, 'muster', 0, MUSTER_CLEAR);
      for (const [gx, gz] of MUSTER_GUNS) {
        const g = { x: seat.x + gx, z: seat.z + gz };
        raise(them, 'pillbox', place(them, 'pillbox', g), null, 0, GUN_CLEAR);
      }
    }

    /* -- economy and dressing ---------------------------------------------- */
    addStartOre(b, spots, b.sea);

    /*
     * Open on the yard with the office in front of it, biased 13% toward the map
     * centre — the same bias `allies-sounding-line` uses — so the first thing on
     * screen is the building the operation is about and the direction everything
     * will come from.
     */
    b.setCameraFocus(home.x + (cx - home.x) * 0.13, home.z + (cz - home.z) * 0.13);
    b.scatter({ minX: cx - 170, minZ: cz - 170, maxX: cx + 170, maxZ: cz + 170 }, 150);
    void start;
  },
});
