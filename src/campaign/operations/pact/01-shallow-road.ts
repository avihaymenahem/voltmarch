/**
 * ============================================================================
 * P1 — THE SHALLOW ROAD
 * ============================================================================
 * The Allies have sunk a bore through Pact crust and been reading it for nine
 * weeks. It stands on a beach behind a fortified cut. Calvane wants the
 * instrument down and the hole capped, and those are two different jobs.
 *
 * ============================================================================
 * THE DECISION THIS OPERATION OWNS
 * ============================================================================
 * **Every Meridian vehicle is `Locomotor.Hover` and every Meridian infantryman
 * is `Locomotor.Foot`.** That is one line of `Flowfield.rebuildCost` — a wet
 * cell is blocked for every ground class except `MoveClass.Hover` — and it is
 * the entire operation:
 *
 *     the hulls   Solarch, Sandskiff, Collector, Carryall     cross water
 *     the men     Wayfarer, Sunlancer, ARTIFICER              do not
 *     the exception  Tidewalker, `Foot` + `amphibious`        walks on it
 *
 * The Allies have run a cut — sixty-eight wall segments, counted on the built
 * world; this said "fifty" and that number no longer reproduces — from the surf
 * to 58 m inland of the opening axis, 156 m of frontage with one gap at the
 * landward end and a Refractor Tower sited on it. So there are two ways past,
 * and the operation is deciding which one you send what down.
 *
 * **BOTH ROUTES ARE MEASURED, ON A HEADLESS BUILD AT THIS OPERATION'S SEEDS**,
 * as a real 8-connected shortest path over the real `passGrid` and the real
 * structure occupancy, from the player's opening at (108, 380).
 *
 * **RE-MEASURED 2026-08-19 AND ALL FOUR LENGTHS MOVED.** The figures this block
 * used to carry — 427.6 / 333.4 on foot and hovering to the compound, 460.9 /
 * 329.4 to the landing — do not reproduce on the shipped build, and nothing
 * recorded what they were taken against. What DOES reproduce, to the tenth, is
 * every closest-approach figure, so the corridors are the ones this header
 * always described and only the lengths were wrong. Quote the table, not the
 * paragraph somebody remembers.
 *
 *                                        on foot        hovering
 *       to the bore compound              463.9 m        373.0 m
 *       to the wade zone                  NO ROUTE       345.8 m
 *       closest it ever comes to the
 *         Refractor Tower                   4.0 m        192.0 m
 *         Pillbox                          16.0 m        208.0 m
 *
 * "NO ROUTE" is literal rather than rhetorical: every one of the 112 cells
 * inside `APRON`'s radius is water, so `MoveClass.Foot` cannot stand anywhere
 * in the wade zone at all. See the hidden-secondary block below.
 *
 * The straight line to the compound is 316.6 m, so the foot route runs 147 m
 * over it — **and that overhead is the WALL rather than the ground**, which is
 * a control worth taking rather than assuming. Walked at the compound's own
 * seaward offset, ten metres SHORT of the cut's line, the foot route is 271.1 m
 * against a 241.0 m straight line: 12.5% over, which is what this ground costs.
 * Ten metres PAST it the same walk is 433.2 m against 260.1 straight, 66.6%
 * over. **Twenty metres of beach costs 162 m of walking.** Apply the 12.4%
 * beach overhead to the 316.6 m straight line and an unwalled foot route to the
 * compound would be about 356 m against the real 463.9 — so the cut is worth
 * roughly 108 m, and it is spent four metres from the tower.
 *
 * `prismTowerBeam` reaches 34 m. The Pact's `focusLance` reaches 26 and its
 * `arcRepeater` 23, so a hull that takes the gap gives away eight metres before
 * it can answer, with 22 m of `pillboxMg` on top. A hull that takes the water
 * never comes inside 192 m of either.
 *
 * **AND THE PATHFINDER ROUNDS THE WALL ON ITS OWN — BUT IT DOES NOT PUT TO SEA,
 * AND THIS BLOCK USED TO SAY IT DID.** Right-click the compound with a Solarch
 * and the route is 81 cells of which exactly **three are wet**: it slips round
 * the seaward end of the cut through the surf and then runs up the beach. The
 * old claim here was "30 of the 73 cells in the hover route are wet", and the
 * hover route to the COMPOUND has never looked like that. Right-click the same
 * point with a Wayfarer and he walks 91 m further, in front of the gun. That
 * divergence is the teaching and it is real; going to sea is a separate thing,
 * it is what the wade zone pays for, and THAT route is 80 cells with 37 wet.
 *
 * **AND THE WATER CANNOT CARRY THE THING YOU CAME FOR.** The bore head is a
 * `civOreMine` on the Allied seat, so `CaptureService.isCapturable` says yes to
 * an Artificer and no to every hull in the game — no vehicle in any army
 * carries `canCapture`. The Pact's whole position is that a cut is what makes
 * the March move, so the head has to be TAKEN and capped rather than broken.
 * The Artificer is `Locomotor.Foot`. He walks the road, in front of the tower,
 * or he rides: `mrdSkiff` is `unit.raider` on `roster.player` and holds two.
 *
 * That is the shape. **The hulls can go where the men cannot, and the men can
 * do what the hulls cannot.** Nothing in the trigger table asserts either half;
 * both are properties of the shipped simulation, which is why they are the
 * right thing to build an operation out of.
 *
 * And the player already owns both halves on the first frame. Counted on the
 * built world, the opening is **6 infantry and 8 vehicles**: five Wayfarers and
 * one Artificer who cannot enter the water, four Solarchs, two Sandskiffs and
 * two Collectors that can. Nothing has to be bought before the operation's
 * question can be asked.
 *
 * ============================================================================
 * WHY THE PRIMARY IS THE MAST AND NOT THE BORE
 * ============================================================================
 * A primary that could ONLY be finished by one 500-credit man with 95 hit
 * points would be an escort wearing an assault's label, and `primaryType` is a
 * field precisely so that it can be checked rather than felt. So the primary is
 * the instrument — the mast comes off them, the readings stop, and the hulls
 * can do all of it — and the head is a SECONDARY worth 500 credits.
 *
 * **THAT ARGUMENT SURVIVES THE MAST BECOMING CAPTURABLE, AND IT IS WORTH
 * SAYING WHY.** `t.win` counts deeds now (see the block below), so an Artificer
 * IS one way to finish the primary. The word doing the work above is ONLY: the
 * mast has a hull route and an engineer route, while the head has exactly one —
 * no vehicle in any army carries `canCapture`, and shooting the head is the
 * thing that FAILS its objective. One route is an escort; two is a choice.
 *
 * The layout then puts the two in the order each route meets them: the mast
 * lands 34.4 m INLAND of the head, so the road arrives at the primary first and
 * the water arrives at the secondary first. 34.4 rather than the 18 m the first
 * draft measured, because 18 m is inside `focusLance`'s own 26 — a hull that
 * stopped to kill the mast auto-acquired the head the instant the mast fell,
 * and the secondary failed for doing the primary.
 *
 * The failure is the interesting half. `t.boreLost` fires on `entityDead
 * 'bore'`, which is a thing the player's own hulls do to it by accident while
 * shooting at everything else standing on the same beach. An operation about an
 * army that will not crush anything (`crushLevel: 0` on every Pact hull, by
 * doctrine) ought to be able to fail on carelessness, and this is the cheapest
 * honest way to say so.
 *
 * It carries a `not objectiveComplete 'bore'` guard, AND THE OBVIOUS REASON FOR
 * IT IS WRONG. The medal is safe without it: `Session.setObjective` opens with
 * "A RESOLVED OBJECTIVE DOES NOT UN-RESOLVE" and returns early on anything
 * already `complete` or `failed`, so a `failObjective` after a capture is a
 * no-op at the session. What is NOT a no-op is the rest of the trigger — the
 * effect list runs whole, so Calvane says "the head is broken" over a head the
 * player capped ten minutes earlier. **The guard is on the DIALOGUE, not on the
 * objective**, and a version of this comment claiming otherwise was written
 * before anybody read the setter.
 *
 * ============================================================================
 * THE MAST IS A DEED NOW, AND IT USED TO BE A CORPSE
 * ============================================================================
 * `t.win` was `entityDead 'mast'`, and **a captured structure is still alive**
 * — `aliveWithTag` counts it — so that condition is false forever once an
 * engineer walks in. The mast is `radar` on the ALLIED seat: an enemy building,
 * 700 hp, with the capture cursor over it (`input/Commands.ts` §5, the
 * `hoverEnemy` arm). `annihilationWin` is false and nothing else in the table
 * ends this operation in a win. So one right-click produced a match that could
 * not be won, with nothing on screen saying so.
 *
 * **AND EVERY PLAYER CAN MAKE IT.** `mrdArtificer` carries no `UNLOCK_TAGS`
 * row, so no roster can withhold it, and its two prereqs — `mrdChapterhouse`
 * and `mrdCistern` — both stand on the player's seat at t = 0 under this
 * operation's `opening: 'base'`, counted on the built world. The player also
 * OPENS with one, and half this file is about him: `bore` is a secondary only
 * he can collect, and `t.cut` tells the player in as many words to put him in
 * a Sandskiff. The operation spends its whole running time teaching capture
 * and then lost itself to the lesson.
 *
 * **THE PRICE IS FOUR OF HIM, NOT ONE, AND IT WAS MEASURED RATHER THAN
 * REASONED.** `CaptureService.isCapturable` carries no health test, but
 * `resolve` does: above `CAPTURE.captureHpFrac` (0.5) an ENEMY structure takes
 * the SOFTEN branch instead — `maxHp * CAPTURE.softenFrac` (0.25) pushed as a
 * HighExplosive damage record, through `ARMOR_MATRIX[HighExplosive][Concrete]`
 * (1.00) and `COMBAT_DAMAGE.globalMul` (0.80), so **0.20 of max lands and the
 * engineer is consumed**. Driven through the real `CaptureService` and the real
 * `DamageSystem` on 2026-08-19, a 700 hp mast walks 700 -> 560 -> 420 -> 280
 * and the FOURTH Artificer takes it: **four engineers, 2000 credits**, half
 * this operation's opening bank. Any gun the player already owns shortens that
 * to one.
 *
 * **IT WAS SURVIVABLE, BY A TOOL THIS OPERATION NEVER MENTIONS.** `radar` is an
 * army key and keeps `EntityFlag.Sellable`, unlike `bore` — whose `civOreMine`
 * row goes through `Scenarios.civilian()`, which clears the bit — so a player
 * who took the mast could sell the structure they had just paid for and
 * satisfy `entityDead` after all. Selling the objective in order to win it is
 * not a route; it is a rules accident that happened not to be fatal, and it is
 * recorded here so nobody mistakes it for the design.
 *
 * So `t.win` counts DEEDS now — `ownerCount` on seat 1 — and **capture
 * satisfies the primary exactly as demolition does.** That is a change in what
 * the objective MEANS, so its title and Calvane's two lines about putting the
 * mast down were rewritten rather than left implying a rule the table no longer
 * enforces. `soviets.01.first-tap` and `soviets.03.deep-sector` made the same
 * migration for the same reason.
 *
 * **AND IT IS THE BETTER RULE HERE, WHICH IS NOT TRUE OF EVERY MIGRATION.**
 * This operation's own secondary is *"Take the bore head intact"*: Calvane
 * wants the instrument in Pact hands rather than in pieces and says so out
 * loud. An instrument mast walked off the Allies stops the readings as
 * completely as a broken one does and leaves the Pact holding the thing that
 * took them — which is the operation's argument, not a concession to it.
 *
 * **`t.boreLost` DELIBERATELY KEEPS `entityDead 'bore'`.** It is the FAILURE
 * half of a pair whose completion half is already `structureCaptured`, so the
 * two partition the head's fates between them and neither is guessing: taken is
 * `t.boreTaken`, broken is `t.boreLost`, and a head still standing on the
 * Allied seat is neither. Migrating it would fire "the head is broken" at a
 * player who capped it.
 *
 * ============================================================================
 * THE HIDDEN SECONDARY IS THE TEACHING, AND IT EXPIRES
 * ============================================================================
 * `wade` is hidden, so it is not in the briefing — `briefingObjectives` filters
 * hidden rows, which is what makes a hidden objective a surprise rather than a
 * spoiler. It is revealed by ARRIVING at the cut: the player comes up the road,
 * sees a wall running into the sea with a tower on the only gap, and Nael names
 * the answer in the same breath.
 *
 * It completes on `all: [entityAlive 'gun', unitsInArea(apron, 3)]` — three
 * units in the open water past the cut, off the compound's beach, **while the
 * cut is still standing**.
 * Breaking the cut retires it rather than completing it, which is the whole
 * point: it pays for going ROUND, not for going through. Only the two
 * emplacements at the cut carry the `gun` tag; the compound's own Pillbox
 * deliberately does not, or a player who had already flattened the cut could
 * satisfy it from the road.
 *
 * **THE ZONE IS A DISC AND THIS BLOCK USED TO MEASURE ITS CENTRE. THAT IS THE
 * SECOND TIME THIS EXACT ERROR WAS MADE IN THIS OPERATION** — the mast/head
 * separation below records catching it once already, at 18 m, and the fix moved
 * one objective and left the other one measured the same wrong way. The
 * sentence that shipped read *"36.9 m is also outside `focusLance`, so parking
 * three Solarchs on the objective does not put them in range of the head they
 * are supposed to leave standing"*, and the radius is simply missing from that
 * arithmetic: a unit anywhere in an `r = 24` disc whose CENTRE is 36.9 m away
 * can be 12.9 m away. **Measured on the built world, the nearest hover-passable
 * cell in the old disc was 14.14 m from the head, and 73 of the disc's 112
 * hover-passable cells were inside a parked Solarch's engagement envelope.** A
 * player doing the hidden bonus destroyed the paying one, and being hidden it
 * gave no warning.
 *
 * **THE ENVELOPE IS NOT THE WEAPON RANGE, WHICH IS WHY 26 WAS THE WRONG BAR
 * EVEN FOR THE CENTRE.** `Targeting.isValidTarget` compares a SURFACE distance
 * — centre to centre minus the target's `hitRadius`, and the head's 2x2
 * footprint is worth 5.66 m of that — against `max(reachOf, range * 1.08)`.
 * `reachOf` for an Idle Aggressive hull that can drive is
 * `range * APPROACH_STOP_FRAC + STANCE_CHASE_METRES[Aggressive]`, and every
 * unit in the game spawns Aggressive. So the real reach on the head is:
 *
 *       Solarch    focusLance   26   ->  26*0.8 + 18 = 38.8 m of surface
 *       Sandskiff  arcRepeater  23   ->  23*0.8 + 18 = 36.4
 *       Zenith     zenithBeam   33   ->  33*0.8 + 18 = 44.4   (buildable here)
 *       Monitor    monitorLance 40   ->  40*0.8 + 18 = 50.0   (waterOnly, and
 *                                                              the wade zone is
 *                                                              water)
 *
 * — and a hull that acquires does not merely fire, it DRIVES, so it leaves the
 * disc as well as killing the head. The bar is therefore 50.0 m of surface,
 * i.e. 55.7 m centre to centre, and it has to clear the whole disc rather than
 * its centre.
 *
 * **`APRON` IS (420, 320) AND THE MEASUREMENT IS OF EVERY CELL IN IT.** At
 * `r = 24`, on the built world:
 *
 *       centre to the bore head                      84.76 m
 *       nearest hover-passable cell to the head      62.03 m centre to centre
 *                                                    56.38 m of surface
 *       margin over the widest envelope (50.0)        6.4 m
 *       margin over a Solarch's (38.8)               17.6 m
 *       hover-passable cells in the disc            112
 *       of those, water                             112
 *       foot-passable cells anywhere in the disc      0
 *
 * So no unit the Pact can field can engage the head from anywhere inside the
 * wade zone, and no unit that walks can stand in it at all — which is the
 * objective restated as a property of the ground rather than as an instruction,
 * and is STRONGER than what shipped: 20 of the old disc's 112 cells were dry
 * and foot-passable, so three Wayfarers could have collected this from the
 * beach without a hull ever leaving the sand.
 *
 * Shrinking the radius was the other way to close it and it is the wrong one.
 * The whole disc clears `focusLance` alone only at `r <= 10.9`, and
 * `allies-sounding-line` already records why a disc a squad cannot all fit in
 * is "a hold that restarts on its own". Its own head uses `r = 20` for three
 * men; this asks for three hulls and keeps 24.
 *
 * `tests/campaign-zone-safety.spec.ts` is the general form of this, so the
 * third occurrence fails a gate instead of a player's bonus.
 *
 * **AND IT EXPIRES BY BEING REVEALED LATE, WHICH IS WHY `t.cut` HAS A CEILING.**
 * The hover route to the wade zone never comes within 192 m of the cut, so a
 * player who sends only hulls could satisfy this before anything had revealed
 * it. `t.cut` is `any: [arrival, elapsed 4 min]` for that reason and no other.
 *
 * ============================================================================
 * THE THREE FIXED NUMBERS
 * ============================================================================
 * **`credits: 4000` binds BOTH seats.** `Shell.applySimPostBoot` writes
 * `setup.startingCredits` into every non-Neutral slot. It buys the player a
 * Sandskiff (550) with room to spare and does not buy a Zenith; and it slows
 * the Allied opening for the reason CLAUDE.md's measured block gives — a brain
 * with a 10 000 bank raises a seven-building base and eleven troops before it
 * has mined a single ore, which has been reported as a prebuilt base twice.
 *
 * **The roster is asymmetric and both halves are load-bearing.**
 * `roster.ai: ['struct.defence.specialist']` is what puts the Refractor Tower
 * on the cut's gap — remove that line and `spawnBuilding` refuses it and the
 * road costs nothing. `roster.player: ['unit.raider']` is the Sandskiff, and it
 * is the ONLY way an Artificer crosses water in this army. The player therefore
 * has no tower of their own and the Allies do, which is `OperationRoster`'s own
 * stated reason for having two lists.
 *
 * **`mapSeed` is the survey designation.** 12 880 is the number in the
 * briefing. `tests/campaign-maps.spec.ts` pins it as a terrain fingerprint, and
 * a generator change that re-rolls this ground moves the coast the whole
 * composition is laid against.
 *
 * ============================================================================
 * THE COORDINATES ARE READ OFF A BUILT WORLD, NOT RECOMPUTED
 * ============================================================================
 * The layout derives every position from the start spots — which move with the
 * seed — and then walks each structure outward in rings to ground `isBuildable`
 * accepts. The trigger table can see none of that and has to name world points.
 *
 * So the points below are taken from the same headless build
 * `tests/campaign-maps.spec.ts` performs, at these exact seeds, reading
 * `store.posX/posZ` of the tagged entities AFTER `spawnBuilding` has snapped
 * each footprint to the placement grid. At `mapSeed` 12 880 / `simSeed` 3 101
 * the openings are 386.2 m apart at (108, 380) and (404, 132), the waterline
 * runs +98..+104 m off that axis, and the composition lands at:
 *
 *     bore   392, 240      mast    364, 220      tower   270, 178
 *     apron  420, 320      pillbox 254, 162      road    336, 135
 *
 *     the cut   68 segments, p = -58.2 (inland) to +98.0 (the surf)
 *
 * `apron` is the only one of these that is not a structure: it is the point on
 * the water 84.8 m off the bore head that `wade` counts hulls in, and EVERY
 * cell inside its 24 m radius is water — `passGrid` has `PASS_FOOT` on none of
 * them — which is what makes "come round by water" a statement about the ground
 * rather than about intent. It was (416, 268), 36.9 m off the head, until the
 * disc was measured rather than its centre; see the hidden-secondary block.
 *
 * **RE-MEASURE IF `mapSeed`, `simSeed` OR THE LAYOUT'S FRACTIONS MOVE.**
 * Nothing fails loudly if they drift: `unitsInArea` simply stops firing, the
 * hidden objective never reveals, and the operation is still winnable, so no
 * test and no player reports it. The radii below are wider than any wobble the
 * ring search can produce (28 m) for exactly that reason.
 * ========================================================================== */

import { Faction } from '../../../core/types';
import { minutes, seconds } from '../../types';
import type { Condition, OperationDef } from '../../types';

/* -- the measured points -------------------------------------------------- */

/** The player's opening. `t.tide`'s column is pointed at it. */
const HOME = { x: 108, z: 380 };
/** The gap at the cut's landward end, and the Refractor Tower sited on it. */
const GAP = { x: 270, z: 178 };
/**
 * The open water past the cut, off the bore compound's beach. 84.8 m from the
 * head, and every cell within `r = 24` of it is water with no `PASS_FOOT`.
 *
 * **THE DISTANCE IS SET BY THE DISC, NOT BY THIS POINT.** Moving it back toward
 * the head is how the operation shipped a hidden bonus that destroyed the
 * paying one; the block in the header headed "THE ZONE IS A DISC" has the
 * arithmetic and `tests/campaign-zone-safety.spec.ts` has the gate.
 */
const APRON = { x: 420, z: 320 };
/** Where the Allied road column forms up. Dry, unoccupied, 57 m off their base. */
const ROAD = { x: 336, z: 135 };

/* -- the thresholds ------------------------------------------------------- */

/**
 * How long the layout is given to have placed the ground before a zero
 * threshold over it is believed.
 *
 * **`ownerCount(1, 'building', 'mast', max: 0)` READS TRUE AGAINST AN EMPTY TAG
 * REGISTRY**, exactly as `entityDead` does — the spelling changed and the
 * hazard did not. Unguarded, `t.win` fires on the first tick the Director runs,
 * and a win nobody played is the one failure that reaches the end screen
 * looking like a feature.
 *
 * **IT IS DEFENCE AGAINST A LAYOUT THAT PLACED NOTHING, NOT AGAINST A TICK-ONE
 * READ THAT HAPPENS TODAY, AND SAYING WHICH MATTERS.** `scenarios.system.ts`
 * builds the world inside `async init()` and `SystemRegistry.init` awaits every
 * module's init in sequence before a tick is taken, so the tag registry is
 * never empty when the Director first runs and the empty-registry read is not
 * reachable in the product. What IS reachable is a layout that stamped nothing
 * — a wrong def key, a footprint that will not fit, a roster that refused the
 * structure — and there twenty seconds is the difference between an operation
 * that ends before the camera settles and one that at least shows the player
 * the ground it is lying about. `tests/campaign-maps.spec.ts` and
 * `tests/campaign-roster-ground.spec.ts` are the gates that catch the two
 * causes; this is the guard that stops the symptom being instant.
 *
 * Twenty seconds is unmistakably past the build and unmistakably short of
 * anything happening. Measured on the built world, the mast is **263.7 m** from
 * the nearest player unit (an `mrdSolarch` of the opening escort at
 * (144.1, 365.5); it read 289.0 m before `bb83ffb` moved the garrison anchor),
 * and the fastest thing on the player's seat is a 9.2 m/s Sandskiff — **184 m
 * of straight line in twenty seconds** — against 700 hp that has to be taken
 * to zero, or to 350 and then walked into.
 * `soviets.01.first-tap` and `soviets.03.deep-sector` guard their own primaries
 * with the same constant for the same reason.
 */
const SETTLE: Condition = { on: 'elapsed', ticks: seconds(20) };

/**
 * The Allies no longer hold the instrument mast — levelled or taken, and the
 * operation does not care which. See the header for why capture counts and for
 * the four-Artificer price of making it happen.
 *
 * ONE READER TODAY (`t.win`), AND IT IS A NAMED CONSTANT ANYWAY, because the
 * whole operation is this line: an edit that widens the primary has to be made
 * here, once, where the argument for it is written down.
 */
const MAST_OFF: Condition = {
  on: 'all',
  of: [SETTLE, { on: 'ownerCount', player: 1, role: 'building', tag: 'mast', max: 0 }],
};

const op: OperationDef = {
  id: 'pact.01.shallow-road',
  chapter: 'pact',
  faction: Faction.Meridian,
  /*
   * THE ALLIES, AND THE LINE THAT DECIDES IT IS THE FIRST ONE CALVANE SPEAKS:
   * *"The Allies sank a bore through our crust nine weeks ago and have been
   * reading it ever since."*
   *
   * It is a reading bore, not a working one, and `CAMPAIGN_BUILD_SPEC.md` §2.1
   * divides the Continental Works at the Split exactly there — "The Allies took
   * the survey office and the instruments; the Soviets took the yards and the
   * plate mills." An instrument mast on a beach is the Allied half on the nose.
   * `soviets.01.first-tap` has already established that a tap on somebody
   * else's ground is an Allied habit, and this is the same habit from the other
   * side of it.
   *
   * It is also the answer that leaves the chapter room. §3.3 puts "Bramm
   * confirms it" at P7 and the convergence at P9; an army the Pact is arguing
   * WITH is more useful in operation one than an army it is merely fighting,
   * and of the four the Allies are the only one that would change its mind if
   * shown the numbers. That is Aubray's whole arc, and it is what makes P1's
   * closing line land.
   *
   * MECHANICALLY IT PINS TWO THINGS. `t.tide` spawns `grizzly` — an Allied
   * hull, literal and unremapped, which `validateCampaign` now checks against
   * the seat's declared army — and the layout's `prismTower` resolves through
   * `keyFor` to the Refractor Tower whose 34 m of reach the header measures
   * against the Pact's 26. On a Soviet seat that becomes a Tesla Coil at 30 m
   * and the whole road/water trade moves.
   */
  foe: Faction.Allies,
  index: 1,
  title: 'The Shallow Road',
  beat: 'A bore sunk through Pact crust, and a wall run from the surf to the road.',
  primaryType: 'assault',
  // Multiple effect kinds — objective state, a reveal, a wave and an order — so
  // 'bespoke' by the definition in `types.ts`. The label is about MECHANISM:
  // what makes this operation what it is is the ground, and the ground is built
  // before tick one.
  archetype: 'bespoke',
  parSec: 780,
  requires: [],

  map: {
    preset: 'tropical',
    // Fixed, and pinned by `tests/campaign-maps.spec.ts` as a terrain
    // fingerprint. CHOSEN BY SURVEY RATHER THAN BY TASTE: five rolls were
    // sampled at nine nominal points of this composition. 12 880 and 88 401
    // returned dry, non-cliff, passable ground at all nine; 41 207 puts a cliff
    // on the bore lot and 12 881 and 30 311 each foul one. Nothing is buildable
    // within a few metres of the surf on ANY roll — the beach cone is not
    // `buildGrid` ground — which is why the built world reports 9 structures on
    // ground `isBuildable` refuses. THE COUNT IS RIGHT AND THE ATTRIBUTION WAS
    // NOT: this said "all nine are wall segments" and, counted on the built
    // world, SEVEN are — the last of the cut before the surf, which is the
    // expected case above. The other two are Gaia civilians `addCivilians`
    // places off the composition entirely, `civApartments` at 296,326 and
    // `civOilDerrick` at 216,208, and they have nothing to do with the beach.
    mapSeed: 12_880,
    // The PAIR is chosen by this seed and not by the map roll. `seatedSlots`
    // filters `START_PAIRS` against the water, and on `tropical` exactly two
    // survive: [0,1] at 386.2 m with both openings 100 m off the waterline, and
    // [1,3] at 296.0 m with one opening 100 m off it and the other 290 m.
    // This operation needs the symmetric one, because its whole composition is
    // a lane running PARALLEL to the coast — the cut, the compound and the
    // water route are all authored as offsets off the opening-to-opening axis,
    // and that only means anything while both ends of the axis are the same
    // distance from the sea. Move this number to one that draws [1,3] and the
    // coast slides out from under every measurement in this header.
    simSeed: 3_101,
    armies: 2,
    // `tropical` is not a `BiomeName`; `BIOMES` has four members and the
    // generator falls back to temperate with a console warning if asked for a
    // fifth. This is the same pairing `MAPS.coral-shore` ships.
    biome: 'temperate',
    opening: 'base',
    // Both seats. See the header — it is one number doing two jobs.
    credits: 4_000,
  },
  layout: 'pact-shallow-road',

  /*
   * NEITHER SHIPPED RULE MAY END THIS.
   *
   * `annihilationWin` would hand the player a victory for flattening the Allied
   * base while the mast, which stands 72.3 m outside it, went untouched — and
   * the mast is the operation. `assetLossDefeat` is off for symmetry rather
   * than for a measured failure: the player opens with a full base and could
   * not plausibly hit zero assets before the authored loss reads, but a rule
   * that can only end a scripted match by accident should not be armed at all.
   */
  outcome: { annihilationWin: false, assetLossDefeat: false, ignoreSeats: [] },

  roster: {
    // The Sandskiff. Two cargo slots, `Locomotor.Hover`, and the only way an
    // Artificer crosses water in this army.
    player: ['unit.raider'],
    // The Refractor Tower on the cut's gap. Remove this and the road is free.
    ai: ['struct.defence.specialist'],
  },

  objectives: [
    // "TAKE … OFF THEM", NOT "DESTROY", AND THE WORDS ARE LOAD-BEARING. `t.win`
    // counts what seat 1 still owns, so walking an Artificer into the mast ends
    // the operation exactly as levelling it does. A title that said "destroy"
    // would be naming the one route the rule does not require — and naming it
    // in an operation whose other secondary is "take the head INTACT". See the
    // header.
    { id: 'mast', kind: 'primary', title: 'Take the Allied instrument mast off them' },
    {
      id: 'bore',
      kind: 'secondary',
      title: 'Take the bore head intact',
      credits: 500,
    },
    {
      id: 'wade',
      kind: 'secondary',
      hidden: true,
      title: 'Come round the cut by water',
      credits: 400,
    },
  ],

  triggers: [
    /* -- the opening word -------------------------------------------------
     * Two lines: the premise, then the order. A player who reads only the
     * first should still know where they are, and a player who reads only the
     * second should still know what to do. Calvane states the doctrine out
     * loud in the second one because it is a fact about the army rather than
     * a trick, and an operation that hides its own mechanism is a quiz.
     */
    {
      id: 't.open',
      when: { on: 'elapsed', ticks: seconds(4) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Calvane',
          text: 'Survey 12-880. The Allies sank a bore through our crust nine weeks ago and '
            + 'have been reading it ever since. A bore is a cut, and a cut is why the '
            + 'March moves at all.',
        },
        {
          // "Take the mast off them" rather than "Take the mast down": `t.win`
          // counts deeds, so breaking it and walking into it are one order, and
          // the sentence has to be the one that covers both. The contrast the
          // line is built on survives it and gets sharper — the mast may be
          // taken however you like, the HEAD has to come off whole.
          do: 'dialogue',
          speaker: 'Calvane',
          text: 'Take the mast off them. Take the head off whole, so the hole can be capped — '
            + 'and only an Artificer can do that. Nothing we drive touches the ground and '
            + 'nothing we field on foot leaves it. Use both.',
        },
      ],
    },

    /* -- the cut, seen ----------------------------------------------------
     * THE TEACHING TRIGGER, AND ARRIVING IS WHAT FIRES IT. 56 m is more than
     * twice a Wayfarer's 26 m sight, so it reveals the wall a moment before the
     * player would otherwise have driven into the tower's 34.
     *
     * AN UNTAGGED `unitsInArea` IS THE EXPENSIVE SPELLING and it is the right
     * one: the question is whether ANY player unit has come up the road, and
     * tagging would mean naming in advance which of them counted. It walks
     * `store.alive` twice a tick — the arming pass and the real pass — until it
     * fires, and `state.fired` then retires it for the rest of the match.
     *
     * **56 m IS BOUNDED BY THE NEAREST PLAYER UNIT AT t = 0, WHICH IS 225.9 m
     * AWAY** — read off the built world rather than off the opening, because
     * `buildAlliedGarrison` parks the escort forward of the yard and it is the
     * escort that this counts. Move `CUT_ALONG` toward the player's opening and
     * this fires on tick one, revealing the objective before anybody has left
     * home.
     *
     * **THE FOUR-MINUTE CEILING IS NOT BELT AND BRACES.** The hover route to
     * the wade zone never comes within 192.0 m of the cut and the one to the
     * compound never within 138.6 m, so a player who sent hulls and nothing
     * else could satisfy `wade` on a run where the trigger that reveals it had
     * never fired.
     *
     * The player is still PAID — `Session.setObjective` only refuses to
     * un-resolve, and `'hidden'` is not a resolved state, so the credits and
     * the medal land. What is lost is everything else: the objective appears on
     * the panel already ticked, four hundred credits arrive with no explanation
     * attached, and the two lines that are the entire point of the operation
     * are never spoken. `reclamation-held-paper` needed the same ceiling for
     * the same shape of reason and it is the same four minutes.
     */
    {
      id: 't.cut',
      when: {
        on: 'any',
        of: [
          { on: 'unitsInArea', player: 0, area: { x: GAP.x, z: GAP.z, r: 56 }, min: 1 },
          { on: 'elapsed', ticks: minutes(4) },
        ],
      },
      then: [
        { do: 'revealArea', player: 0, area: { x: GAP.x, z: GAP.z, r: 70 } },
        {
          do: 'dialogue',
          speaker: 'Nael',
          text: 'They have run a wall from the surf to the road and put a refractor on the '
            + 'one gap. Thirty-four metres of reach on it. Our lance is twenty-six.',
        },
        {
          do: 'dialogue',
          speaker: 'Nael',
          text: 'The wall stops at the water, because that is where they think walls stop. '
            + 'Point the hulls at the bore and they go round the end of it on their own — '
            + 'nothing we drive touches the ground. The men will walk into the gun. Put the '
            + 'Artificer in a Sandskiff; it holds two.',
        },
        { do: 'setObjective', id: 'wade' },
      ],
    },

    /* -- the two secondaries, resolved before the win ---------------------
     * ALL THREE OF THESE SIT ABOVE `t.win` AND THAT IS LOAD-BEARING.
     * `runDirector` returns immediately once an outcome is set, so a
     * completion written below the win trigger never fires and the medal never
     * counts it.
     */
    {
      id: 't.wade',
      when: {
        on: 'all',
        of: [
          // WHILE THE CUT STILL STANDS. Breaking it retires this rather than
          // completing it: the objective pays for going round, not through.
          { on: 'entityAlive', tag: 'gun' },
          { on: 'unitsInArea', player: 0, area: { x: APRON.x, z: APRON.z, r: 24 }, min: 3 },
        ],
      },
      then: [
        {
          do: 'dialogue',
          speaker: 'Nael',
          text: 'Standing off, past the end of their wall. Their gun line is pointed at an '
            + 'empty road.',
        },
        { do: 'completeObjective', id: 'wade' },
      ],
    },
    {
      id: 't.boreTaken',
      when: { on: 'structureCaptured', tag: 'bore', player: 0 },
      then: [
        { do: 'eva', line: 'buildingCaptured' },
        {
          do: 'dialogue',
          speaker: 'Calvane',
          text: 'Whole, and ours. Cap it and log the depth. That is the part of this I would '
            + 'have come for myself.',
        },
        { do: 'completeObjective', id: 'bore' },
      ],
    },
    /*
     * THE LAST `entityDead` IN THIS FILE, AND IT IS NOT AN OVERSIGHT. Every
     * threshold over `mast` counts deeds because capture had to satisfy them;
     * this one counts a corpse because its completion half above is already
     * `structureCaptured`, so the pair partitions the head's fates between them
     * — taken is `t.boreTaken`, broken is this, and standing on the Allied seat
     * is neither. Migrating it to `ownerCount` would fire "the head is broken"
     * at a player who capped it, which is the sentence this trigger exists to
     * keep away from them.
     */
    {
      id: 't.boreLost',
      when: {
        on: 'all',
        of: [
          { on: 'entityDead', tag: 'bore' },
          // THE GUARD IS ON THE DIALOGUE, NOT ON THE OBJECTIVE.
          // `Session.setObjective` already refuses to un-resolve a completed
          // one, so the medal is safe either way — but the effect list runs
          // whole, and without this Calvane reports a broken head over one the
          // player capped ten minutes ago. See the header.
          { on: 'not', of: { on: 'objectiveComplete', id: 'bore' } },
        ],
      },
      then: [
        { do: 'failObjective', id: 'bore' },
        {
          do: 'dialogue',
          speaker: 'Calvane',
          text: 'The head is broken. The hole stays open, and it will go on being open long '
            + 'after everyone who argued about it is gone. Note the depth and finish the mast.',
        },
      ],
    },

    /* -- the road column --------------------------------------------------
     * Six minutes, which is late enough that the player has committed to a
     * route and early enough that it changes the answer. It comes down the
     * ROAD and attack-moves the player's opening, so a player who has taken
     * every hull out to sea has to decide whether to bring them back.
     *
     * `grizzly` is the Allied main battle tank, literal and unremapped —
     * `EffectSink.spawnUnits` resolves through `ProductionCatalog.byKey` with
     * no `keyFor`, so an authored key means that hull and `validateCampaign`
     * checks it against `foe`. `spread` is a deterministic ring drawn from
     * `s.rng`, not a scatter: the same wave has to land in the same shape in
     * the recording, in the playback and in a designer's third run.
     */
    {
      id: 't.tide',
      when: { on: 'elapsed', ticks: minutes(6) },
      then: [
        { do: 'eva', line: 'forcesUnderAttack' },
        {
          do: 'dialogue',
          speaker: 'Nael',
          text: 'Column off the survey camp. They are not coming for the bore — they are '
            + 'coming to keep the road open.',
        },
        {
          do: 'spawnUnits',
          player: 1,
          key: 'grizzly',
          count: 4,
          at: ROAD,
          spread: 14,
          tag: 'column',
        },
        { do: 'orderTagged', tag: 'column', order: 'attackMove', at: HOME },
      ],
    },

    /* -- the win ----------------------------------------------------------
     * `MAST_OFF`, WHICH COUNTS DEEDS AND NOT CORPSES. This was
     * `entityDead 'mast'`, and a captured mast is alive — so an Artificer put
     * into the one structure the whole operation is named after made this
     * condition false forever, and with `annihilationWin` off there was no
     * other win path in the table. See the header block.
     *
     * `SETTLE` is inside `MAST_OFF` rather than conjoined here, because the
     * threshold and its guard are one claim about one count and splitting them
     * is how a second reader comes to take the count without the guard.
     */
    {
      id: 't.win',
      when: MAST_OFF,
      then: [
        { do: 'completeObjective', id: 'mast' },
        {
          // "off them" rather than "down". A mast an Artificer walked into is
          // very much still standing, and the second sentence — they will sink
          // another — is the one that carries the operation's argument and is
          // true of both endings.
          do: 'dialogue',
          speaker: 'Calvane',
          text: 'The mast is off them. They will sink another and we will come again. One day '
            + 'somebody will ask how we are so certain about what a cut does, and I would '
            + 'rather it were not today.',
        },
        { do: 'endOperation', result: 'win' },
      ],
    },

    /* -- the loss ---------------------------------------------------------
     * `playerBeaten` is `Viability.isBeaten` — nothing to build with and
     * nothing to fight with — not "you have no buildings". The player opens
     * with a full base here, so the two readings would agree for most of the
     * match; they stop agreeing at exactly the moment it matters, which is a
     * player down to one Chapterhouse and six Wayfarers who can still finish.
     */
    {
      id: 't.lose',
      when: { on: 'playerBeaten', player: 0 },
      then: [{ do: 'endOperation', result: 'loss', reason: 'mast' }],
    },
  ],
};

export default op;
