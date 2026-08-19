/**
 * ============================================================================
 * A5 — FORCED CLOSURE
 * ============================================================================
 * A traverse that does not close can be corrected two ways. You can find the
 * blunder, or you can spread the misclosure back along the line until every
 * station is inside tolerance and no single bench is out by enough to argue
 * with. The second one is a FORCED CLOSURE, and it is what the Ninth filed in
 * reply to A4.
 *
 * They are not disputing the eleven millimetres. They are re-running the model
 * with the residual distributed, so the published schedule moves by about nine
 * days — which the yards can absorb — and every refinery on the continent stays
 * exactly where it was sited. Whoever publishes first is what the continent
 * sites from, and the model is a ROOM: a Works computing hall that went to the
 * Soviets with the plate mills at the Split, and has not moved since.
 *
 * A1 took the first reading. A2 recovered eleven years of field returns. A3
 * reached the woman with the only complete rate series. A4 closed the loop and
 * filed the correction. **This is the first operation in the chapter where the
 * Allies attack something**, and the reason it took five is the reason it is
 * worth doing: the chapter has spent four operations insisting that a number is
 * only worth what the instrument behind it is worth, and the instrument is now
 * on the other side of a gun line.
 *
 * ============================================================================
 * WHY `assault` AND WHAT KEEPS IT FROM BEING "LEVEL THEIR BUILDING"
 * ============================================================================
 * The primary is `ownerCount(player 1, role 'building', tag 'hall', max: 0)` —
 * the hall off the Ninth's books. **`ownerCount` counts OWNERSHIP, so a capture
 * satisfies it exactly as a demolition does**, which is the property
 * `soviets.06.demolition-order` names about its own primary and does nothing
 * with. Here it is the whole operation, because the two routes cost completely
 * different things and only one of them leaves the Allies an instrument:
 *
 *   - **BREAK IT.** The hall is 1100 hp of `ArmorClass.Concrete`. A Warden's
 *     `lightCannon` is 55 AP on a 1.5 s cooldown = 36.67 raw, and AP against
 *     Concrete is 0.55, so through `COMBAT_DAMAGE.globalMul` 0.80 it delivers
 *     **16.13 dps**; a G.I.'s `rifle` is 3x18 over a 1.03 s cycle = 52.43 raw at
 *     SmallArms-against-Concrete 0.18, which is **7.55**. The opening garrison —
 *     4 Wardens and 5 G.I.s, counted on a bound, rostered build — is therefore
 *     **102.28 dps on the hall**, and one attack-move takes it from full to
 *     rubble in **10.8 seconds**.
 *   - **TAKE IT.** `Capture.ts` rule 2: an enemy structure flips at or below
 *     `CAPTURE.captureHpFrac` (0.5), and above it the engineer is spent knocking
 *     `CAPTURE.softenFrac` (0.25 of max) off. That soften goes through
 *     `channels.damage`, so it lands through `ARMOR_MATRIX[HighExplosive]
 *     [Concrete]` (1.00) **and `globalMul` 0.80** — 220 points, 20% of max and
 *     not 25%. 1100 -> 880 -> 660 -> 440, and the FOURTH engineer captures.
 *     **Four engineers, 2000 credits, not a shot fired** — the arithmetic
 *     `allies.02.instrument-room`'s layout worked out in order to keep A2 off
 *     this path, paid here on purpose.
 *
 * **AND THE TWO ROUTES MEET IN A WINDOW 5.4 SECONDS WIDE.** Shoot the hall to
 * 550 and one engineer turns it; shoot it 550 further and there is nothing to
 * turn. At the opening garrison's 102.28 dps those two thresholds are **5.38
 * seconds apart** (8.52 s if the infantry are left at home). So the medal is not
 * bought by aiming carefully — it is bought by NOT attack-moving the hall at
 * all: break the gun line, walk the section to the wall, and let four softens do
 * the last forty per cent.
 *
 * **AND THE CURSOR WILL OFFER THE PLAYER THE CAPTURE IT IS ABOUT TO REFUSE.
 * DECLARED, BECAUSE THIS IS A FOURTH INSTANCE OF THE CAPTURE FAMILY.**
 * `pact.03.concession` records the Gaia version (a capture consumes the unit);
 * there is no Gaia structure here and this one is different in shape. Three
 * facts, none of them changeable from a layout or from the frozen vocabulary:
 *
 *   - `CaptureService.isCapturable` has **no health gate**. Kind, Alive,
 *     PendingDestroy, UnderConstruction, ownership, veto list — that is all. The
 *     half-health rule lives in `resolve`, which a cursor never reaches.
 *   - `resolveContextOrder` paints `CursorKind.Capture` on `caps.canCapture`,
 *     which is an **OR over the whole selection**.
 *   - The player owns an engineer at t=0. Measured on the rostered build: 4
 *     Wardens, 5 G.I.s, **1 engineer**, 2 harvesters.
 *
 * So Ctrl+A, right-click the full-health hall, and the green capture glyph
 * appears — while the per-unit demotion in `Commands.ts` rewrites every
 * non-engineer in that selection to `OrderKind.Attack` on the same building.
 * 102.28 dps, **10.8 seconds, and the medal is gone irreversibly** (a rebuilt
 * structure carries no tag and `civHospital` has no sidebar route), with `t.win`
 * firing inside the same window — so the player takes bronze and, until this
 * change, was never told which click cost them silver.
 *
 * `t.bramm` at 0:46 says levelling the hall is a loss; it does not say that the
 * ordinary select-all-and-point is what levels it. **`t.cursor` at 0:58 is the
 * fix and it is the only fix available** — the vocabulary has no effect that
 * touches a cursor, and a Gaia hall (which would make the capture legal at any
 * health) is already costed and cut below. It is placed seven minutes ahead of
 * the engineers so the warning lands while the player is still deciding what to
 * build, not while they are watching four men walk.
 *
 * **THE NINTH MENDS IT, AND THE FIRST SOFTEN DOES NOT ARM THE WRENCH.**
 * `AiBrain.repairBase` walks every building the seat owns with no proximity
 * filter and takes the worst STRICTLY below `AI_REPAIR.startFraction` 0.75.
 * 880/1100 is 0.80 and is not a candidate; 660/1100 is 0.60 and is. At
 * `REPAIR_RATE` 30 hp/s and `REPAIR_COST_PER_HP` 0.25 a hall left at 440 is back
 * to full in **22.0 seconds for 165 credits**, so an engineer sent alone is 500
 * credits of nothing. `reclamation.02.written-off` records the same finding
 * about its sorting station and draws the same conclusion: the engineers travel
 * WITH the attack, and no trigger here enforces it because the brain already
 * does.
 *
 * ============================================================================
 * WHAT THE GUN LINE IS FOR, WHICH IS NOT THE TANKS
 * ============================================================================
 * Three Sentry Guns, 1200 credits, `pillboxMg` at 22 m and `power: 0`. Through
 * the same tables the emplacement delivers **65.83 dps against Infantry** and
 * **18.43 against Medium** — a 90-hp engineer dies in 1.37 s and a 340-hp Warden
 * lasts 18.4 s. So the line is a toll on armour and an absolute wall to an
 * unarmed man, and the layout sites it accordingly: measured on the built world,
 * the east, north and south capture stands are 19.57 to 20.94 m from a gun and
 * **all three western ones are 23.56 to 27.33 m, against an engineer's firing
 * circle of 22.234 m — outside every arc.** One face of four, and it is the one
 * that turns your back on the hall and looks at their yard.
 *
 * **THE TANKS' HALF WAS MEASURED AGAINST THE WRONG REACH AND IS EIGHT TIMES
 * WHAT THIS PARAGRAPH USED TO CLAIM.** It said the arc-free tracked route cost
 * *"223.6 m against 215.4 m — 8.2 m, 1.2 s at 6.6 m/s"* and concluded that "a
 * player who wants rubble pays the gun line almost nothing". `Combat.engage`
 * fires at `max(0, flat - hitRadius(target)) <= w.range`, so a gun reaches 22 m
 * PAST THE HULL: a Warden's `radius` is 2.79, the circle it must stay out of is
 * **24.79 m**, and acquisition begins at 22 x 1.08 + 2.79 = 26.55 m. Re-derived
 * on the layout's named instrument (octile Dijkstra, `Terrain.passGrid` and
 * `FlowFieldCache.costGridFor(MoveClass.Track)`, identical both ways):
 *
 *     any firing position on the 31.211 m standoff ring     223.4 m
 *     never inside 24.00 m of a gun (the old figure)        236.3 m   +13.0
 *     never inside 24.79 m of a gun (the engine's test)     291.8 m   +68.4
 *
 * **+68.4 m is 10.4 s at 6.6 m/s**, and the cost jumps 5.3x between 24.0 and
 * 24.4 m — a knife edge four tenths of a metre wide, which is why reading it off
 * the gun's printed range was wrong by so much. A player who wants rubble and
 * will not trade with the line pays ten and a half seconds of driving; one who
 * trades pays hulls. 11 of 16 bearings on the standoff ring are inside 24.79 m
 * of a gun, which is the one number here the correction did not move.
 *
 * The fourth gun that was built and measured to check this is cut, and its
 * reason had to be rewritten too: at the engine's threshold a fourth on the
 * south-east shoulder leaves the arc-free route at **291.8 m, unchanged to the
 * decimetre**, and buys one bearing of standoff coverage. It does nothing rather
 * than the wrong thing. The gun that WOULD do something is a west one, which
 * covers all six capture stands and leaves no arc-free firing position at all.
 * The layout header carries both measurements.
 *
 * ============================================================================
 * HOW THIS DIFFERS FROM THE FOUR OPERATIONS BEFORE IT
 * ============================================================================
 * A1 escort, A2 infiltrate, A3 race, A4 defend — and three of those four end in
 * a HOLD: ninety seconds on the deep head, three and a half minutes in the
 * office, sixteen minutes with the reduction standing. A fourth would be the
 * chapter's entire vocabulary. There is no hold here at all: the primary
 * resolves on the tick the deed moves or the wall comes down, and the length of
 * the operation comes from the works being hard rather than from a timer.
 *
 * Two other reversals worth naming:
 *
 *   - **THE OBJECTIVE IS SOMETHING THE PLAYER MUST NOT DESTROY WHILE
 *     DESTROYING IT IS ALSO ALLOWED.** A2's office was NEUTRAL precisely so the
 *     player never had to shoot the thing they were sent to recover, and its
 *     layout says in as many words that a Soviet-owned office *"would have to be
 *     SHOT to half before it could be taken, which is the opposite of
 *     recovering it"*. That is exactly the position this operation puts the
 *     player in, three operations later, on purpose.
 *   - **THE CHAPTER'S CLOCK STOPS BEING THE PLAYER'S.** A1's five-minute window,
 *     A3's three moving ones and A4's sixteen minutes all measure the Allies.
 *     Seventeen minutes here is the OPPONENT'S run finishing, and nothing the
 *     player does moves it — `soviets.03.deep-sector`'s movable fuse is the
 *     trick this deliberately does not reuse, and `allies.03.ground-truth`
 *     already spent the "the deadline cannot be bought" variant on a moving
 *     place. Here the place is fixed and so is the clock.
 *
 * ============================================================================
 * WHAT ENDS THE MATCH, IN BOTH DIRECTIONS
 * ============================================================================
 * Both shipped outcome rules are off, so all three routes are authored:
 *
 *     t.win        elapsed >= 20 s AND the Ninth owns no 'hall'      WIN
 *     t.deadline   elapsed >= 17:00                                  LOSS
 *     t.beaten     elapsed >= 20 s AND playerBeaten seat 0           LOSS
 *
 * `annihilationWin` is off and the argument is arithmetic rather than taste:
 * `Shell.pollOutcome` declares victory when every non-Neutral non-allied seat
 * holds zero living assets, and the hall is one of those assets — so the shipped
 * rule is STRICTLY WEAKER than `t.win` and could only ever fire into a match
 * this table has already ended. A second writer that can only ever be late is a
 * second writer to delete; `soviets.02.common-standard` makes the same argument
 * about `assetLossDefeat` and reaches the same answer.
 *
 * `assetLossDefeat` is off because the last act this operation would most like
 * to keep is a commander whose base is gone and whose four engineers are still
 * walking, and `pollOutcome` would end that at 2 Hz. `t.beaten` reads
 * `Viability.isBeaten` — nothing to build with AND nothing to fight with —
 * which is the honest threshold. **It is not conjoined with an `ownerCount`
 * clause the way `allies.04.misclosure`'s is**, and the reason is that A4's case
 * cannot arise here: §HELD files garrisoned occupants out of `contestingUnits`,
 * and that only matters to an operation whose objective is a building the player
 * can put five men inside. Until the hall changes hands the player owns nothing
 * on that ground to garrison, and the tick it changes hands the operation is
 * over.
 *
 * **THE 20-SECOND SETTLE IS ABOUT A BUILD THAT FAILED, NOT ABOUT A RACE.**
 * `ownerCount(player 1, tag 'hall', max: 0)` reads TRUE before the layout has
 * stamped the tag — the `entityDead`-before-the-tag trap wearing a different
 * condition — so a hall `spawnBuilding` had refused would WIN this operation on
 * tick one, in silence, before a word of the briefing had played. The world is
 * finished before tick one, so any value above zero closes it; twenty seconds is
 * unmistakably past the build and unmistakably short of anything being lost. The
 * earliest anything hostile can be ordered is `t.watch`, which needs three of
 * the player's hulls inside 40 m of a hall that is 213.7 m of tracked route from
 * their yard — 32.4 s at a Warden's 6.6 m/s before a shot is fired at them, so
 * the settle cannot swallow it either. (That read 254.0 m / 38.5 s; the margin
 * shrank by six seconds and is still twelve past the settle.)
 * `soviets.05.short-allocation` and `soviets.06.demolition-order` guard their
 * own thresholds the same way. The real gate on that failure is
 * `tests/campaign-roster-ground.spec.ts`, which builds this operation with the
 * roster armed AND the def tables bound — the only state in which a refused
 * structure is visible at all.
 *
 * ============================================================================
 * TRIGGER ORDER, AND WHY THE WIN SITS ABOVE BOTH LOSSES
 * ============================================================================
 * `runDirector` evaluates EVERY trigger and appends every firing trigger's
 * effects BEFORE the sink applies any of them, so file order decides exactly
 * two things: which `endOperation` counts (`CampaignSession.end` returns early
 * once an outcome is set), and which of two conflicting objective writes lands
 * (`setObjective` refuses to un-resolve a resolved row).
 *
 * The house convention is losses above wins. **This file inverts it, twice, and
 * both are deliberate:**
 *
 *   - **`t.win` ABOVE `t.deadline`.** A column that takes the hall on the
 *     closing tick has stopped the run. `allies.03.ground-truth` puts `t.closed`
 *     below all three of its win triggers for the same reason and says so.
 *   - **`t.win` ABOVE `t.beaten`.** Capture CONSUMES the engineer
 *     (`Capture.ts#consume` writes `UnitState.Selling` and `markDead`), so a
 *     commander whose last unit is the engineer that turns the door becomes
 *     `Viability.isBeaten` ON THE TICK THEY CAPTURE. That player has won the
 *     operation and the table must say so.
 *
 * Everything that resolves an objective sits above `t.win` for the ordinary
 * reason: a secondary written below the win never fires on the winning tick and
 * the medal never counts it. `t.intactLost` sits above `t.intact` by convention
 * — they cannot actually collide, because `structureCaptured` is
 * `ownerOfTag(tag) === player` and `ownerOfTag` answers -1 for a tag with no
 * live carrier.
 *
 * ============================================================================
 * THE PRESSURE, PRICED
 * ============================================================================
 * Four waves, and one of them is keyed to the player rather than to the clock:
 *
 *     on arrival   4 Conscripts, 2 Anvils   2 200 credits   at SPUR, 64.3 m out
 *     5:30         5 Conscripts, 2 Anvils   2 300           at ROAD, 82.2 m out
 *     10:00        5 Conscripts, 3 Anvils   3 200           at ROAD
 *     14:00        6 Conscripts, 4 Anvils   4 200           at ROAD
 *
 * 11 900 credits of hull against `allies.04.misclosure`'s 12 800 over sixteen
 * minutes and `soviets.05.short-allocation`'s 13 100 over seventeen — the same
 * band and deliberately at the bottom of it, because in a defend every credit
 * arrives at the ground the player is already standing on, and here the player
 * chooses when to be at the works. The waves are a FLOOR on the pressure rather
 * than the whole of it: the Ninth has a base, a 5000 bank, seventeen minutes of
 * income and a brain, and `orderTagged ... attackMove` is a heading rather than
 * a leash — `AiBrain.census` files every hull the seat owns into `armyIds` and
 * `regroupSquads` re-files it on the next pass, and a campaign tag lives in
 * `TagRegistry`, which the brain has never heard of.
 *
 * **THE ARRIVAL-KEYED WAVE COMES THROUGH THE DOOR.** `SPUR` is off the card
 * store, which is to say off the WEST face — the one the gun line does not cover
 * and the only one an engineer can use. So committing to the works is what
 * turns the watch out, and the watch arrives on the bearing the medal needs.
 * `soviets.02.common-standard` and `reclamation.02.written-off` both key a wave
 * to the player's own commitment for the stated reason that the hinge should sit
 * in the same place for a fast player and a careful one.
 *
 * **AND THE ONE THING THE PLAYER IS GIVEN IS THE ARITHMETIC ITSELF.** At minute
 * eight the Works send four engineers to `MUSTER`, 64.12 m behind the player's
 * own yard: exactly the four that take a full-health hall, 2000 credits, and a
 * **219.2 m walk to the WEST wall — 64.5 seconds at 3.4 m/s** before anything
 * shoots at them. (The nearest face is 212.9 m and it is the one the guns cover;
 * both figures are the layout's re-derived instrument, which moved this from the
 * 228.2 m / 67.1 s it used to read.) Three would have been three quarters of a
 * price nobody quoted; the fourth is what turns the door, and Aubray says so on
 * the tick they land.
 *
 * ============================================================================
 * THE ROSTER IS EMPTY ON BOTH SIDES, AND THE ARGUMENT IS THE DOOR
 * ============================================================================
 * `roster` is an ALLOW-LIST over tagged content, so two empty lists withhold
 * every `UNLOCK_TAGS` def from both seats. Measured against a control build with
 * the roster cleared, that is exactly:
 *
 *     the player loses   2 Sabre IFVs, a Proving Ground and a Refractor Tower
 *     the Soviets lose   1 Sledge Tank, 2 Attack Dogs, a Proving Ground
 *                        and THREE Tesla Coils
 *
 * This is the chapter's fourth empty roster and it is not inertia. `teslaCoil`
 * is `struct.defence.specialist` and reaches **30 m**; every structure at the
 * works is the Ninth's, and a finished non-builder structure projects
 * `PLACEMENT.adjacencyRadius` 20 m plus its own radius, so the brain can found
 * one within about 26 m of the hall — which covers all four capture stands
 * INCLUDING the western one. Granted, the Ninth could shut the door this
 * operation is made of, on a decision no author can see and no test can read.
 * Withheld, the longest structure weapon either army can put on that ground is
 * `pillboxMg` at 22 m, which is the three guns the layout already placed.
 *
 * ============================================================================
 * WHAT WAS CONSIDERED AND CUT
 * ============================================================================
 *   - **`primaryType: 'economy'`.** The chapter blurb names refineries and the
 *     temptation is real. `reclamation.02.written-off` already owns the only
 *     shape the frozen vocabulary has for it — `credits: { min: 16000 }`, the
 *     bank read at one instant — and doing it again is one trick twice.
 *   - **`capture-hold`.** Three of the four operations before this one end in a
 *     hold and a fourth would be the chapter's whole vocabulary. It would also
 *     make the medal unreachable: a hold needs the building alive, so
 *     "destroying it is also a win" could not be said.
 *   - **A HIDDEN SECONDARY.** `briefingObjectives` filters hidden rows out, and
 *     both secondaries here have to be visible BEFORE the player decides what to
 *     build — a card store nobody mentioned is a detour nobody planned, and
 *     `allies.02.instrument-room` refuses a bonus the player cannot act on in as
 *     many words. Neither excludes the other, which `allies.03.ground-truth`
 *     records as the rule: `medalFor` awards silver only for a win with EVERY
 *     secondary complete, so two that compete are a medal nobody can earn.
 *   - **A GAIA HALL.** One engineer takes a neutral structure at any health
 *     (`Capture.ts` rule 1), so the fork evaporates and the operation becomes a
 *     walk. It would also make the hall untargetable by the Ninth, which is
 *     harmless here and pointless.
 *   - **PAYING `intact` IN CREDITS.** It resolves on the tick the operation
 *     ends, so the payout would land in a bank with no match left to spend it
 *     in. `allies.03.ground-truth` and `allies.04.misclosure` both refuse a
 *     payout on an end-of-match secondary for the same reason. `store` pays,
 *     because it resolves mid-match and the money has somewhere to go.
 * ========================================================================== */

import { Faction } from '../../../core/types';
import { minutes, seconds } from '../../types';
import type { Condition, OperationDef } from '../../types';
import {
  HALL, MUSTER, ROAD, SPUR, STORE_AREA, WORKS, WORKS_AREA,
} from '../../layouts/allies-forced-closure';

/**
 * THE GEOMETRY IS IMPORTED, NOT RESTATED.
 *
 * The works is placed by the layout and the columns are ordered at it by this
 * file, so the two modules have to agree about five points. A number written in
 * both is a number that will disagree the first time either is tuned, and the
 * failure — a column attack-moving at empty ground, a reveal framing nothing —
 * is invisible to every gate. `layouts/allies-forced-closure.ts` owns the
 * geometry; the dependency runs operation -> layout and never back.
 */

/**
 * The guard on a build that failed rather than on a race. See the header:
 * `ownerCount(max: 0)` reads TRUE before the layout has stamped the tag, so
 * without this a hall `spawnBuilding` refused would win the operation on tick
 * one, in silence.
 */
const SETTLE = seconds(20);

/**
 * The forced run publishes, and it is `parSec` 1020 to the second.
 *
 * An assault whose clock is a description of itself is not falsifiable from
 * inside the operation. The authored par IS the deadline — the rule
 * `soviets.03.deep-sector`, `soviets.05.short-allocation`,
 * `soviets.06.demolition-order`, `allies.03.ground-truth` and
 * `allies.04.misclosure` all state about their own — and the chapter's ramp is
 * 780 / 840 / 900 / 960 / 1020.
 */
const CLOSE = minutes(17);

/**
 * The model is off the Ninth's books.
 *
 * `ownerCount` counts what SEAT 1 OWNS, so an engineer walking into the hall at
 * or below `CAPTURE.captureHpFrac` satisfies this exactly as levelling it does.
 * That is the operation, and it is why the objective title says "take off" and
 * not "destroy".
 *
 * Defined once because three triggers must agree on it: `t.storeStanding` and
 * `t.win` have to resolve on the same tick and cannot be allowed to drift apart.
 */
const HALL_GONE: Condition = {
  on: 'all',
  of: [
    { on: 'elapsed', ticks: SETTLE },
    { on: 'ownerCount', player: 1, role: 'building', tag: 'hall', max: 0 },
  ],
};

const op: OperationDef = {
  id: 'allies.05.forced-closure',
  chapter: 'allies',
  faction: Faction.Allies,
  /*
   * THE SOVIETS, FOR THE FOURTH TIME IN FIVE OPERATIONS, AND IT IS THE PREMISE
   * RATHER THAN A HABIT.
   *
   * The chapter is about one schedule, and one administration hangs its quotas
   * off it — `allies.04.misclosure` says so in its own `foe` block, and
   * `soviets.05.short-allocation` and `soviets.06.demolition-order` are the same
   * argument seen from their side. The model went to them with the plate mills
   * at the Split, which is `CAMPAIGN_BUILD_SPEC.md` §2.1's division quoted the
   * other way round from A2's. All four waves are literal `conscript` and
   * `rhino`, which `validateCampaign` refuses on any seat that is not Soviet,
   * and the layout puts a Soviet `civHospital`, `civApartments` and three
   * `sentryGun`s on seat 1.
   *
   * `validateCampaign` refuses two adjacent operations that share a
   * `primaryType` and says nothing at all about `foe`. That asymmetry is right —
   * a chapter with one antagonist is a chapter, and a chapter with one VERB is a
   * grind — but it means nothing mechanical is checking this line, so it is
   * argued here instead.
   */
  foe: Faction.Soviets,
  index: 5,
  title: 'Forced Closure',
  beat: 'The correction cannot be argued with, so the model is being made to agree with it — '
    + 'and the model is a room on their side of the seam.',
  primaryType: 'assault',
  /*
   * BESPOKE. Objective state, spawns, orders, reveals, dialogue, a camera move
   * and an announcer line — `types.ts` defines the archetype as "multiple effect
   * kinds", and this is nine of the eleven. The two it does not use are
   * `grantCredits` (the paying secondary pays through `ObjectiveDef.credits`,
   * which the save chunk's `paid` set keeps from paying twice across a reload)
   * and `setObjective` (nothing here is hidden — see the cut list in the
   * header).
   */
  archetype: 'bespoke',
  parSec: 1020,
  requires: ['allies.04.misclosure'],

  map: {
    /*
     * `arid` — AND THE BIOME BELOW IS `desert`, WHICH IS THE ONE PLACE THE TWO
     * VOCABULARIES DISAGREE.
     *
     * `MAP_PRESETS` is keyed `arid`; `BiomeName` is `desert`. `getBiome` answers
     * an unknown name with a `console.warn` and TEMPERATE, so
     * `biome: 'arid'` would not throw, would not fail a gate, and would silently
     * ship a different landform — which is exactly what happened to
     * `reclamation.03.sold-twice`, whose two headers are full of numbers about
     * ground it was never built on. `biome` is typed `BiomeName` now and tsc
     * names the file and the line; this comment exists because the FIELD being
     * typed does not stop an author reaching for the preset's name first.
     *
     * It is also the chapter's fifth distinct ground after a temperate valley,
     * an urban district, a tropical shore and snow. `arid` carries the highest
     * `cliffs` fraction of any preset at **0.55** on a low `relief` of 0.28 —
     * flat country cut by hard edges — which is a real constraint rather than a
     * palette: the layout's first choice of spawn point for the works' own watch
     * had 25.2% of a 24 m disc passable and every authored ring point on a
     * closed cell. Every distance in this file and in the layout is read off
     * where things actually landed.
     */
    preset: 'arid',
    biome: 'desert',
    /*
     * CHOSEN BY SURVEY RATHER THAN BY DATE, exactly as A3 and A4 chose theirs.
     *
     * A4 pins 20 260 928 and each operation is a week on, so the convention
     * gives 20 260 935 — and on this preset the convention's own roll is also
     * the one the composition wants, which is worth stating because it is luck
     * rather than a method. Four rolls were built headless with THIS operation's
     * finished layout on them and scored on three things: whether all five
     * structures take their authored literal, how many of the trigger table's
     * thirty-five scripted drops land on ground their own locomotor can enter,
     * and the tracked route from `ROAD` to the works.
     *
     *     20 260 935   every literal taken, **0 of 35 drops on rock**,
     *                  709/709 samples clear around `ROAD`, 317/317 at `MUSTER`
     *     20 260 936   the card store slides 20 m off its literal, **4 drops on
     *                  rock** across four rings, `ROAD` route 82.2 -> 150.2 m
     *     20 260 940   0 drops on rock, but 93.1% around `MUSTER` and the
     *                  engineer walk to the west wall 219.2 -> 225.8 m
     *     20 260 942   **1 drop on rock** (the watch's fourth Conscript),
     *                  95.5% around `ROAD`
     *
     * FOUR IS A SMALL SWEEP AND IT IS QUOTED AS ONE. A3 sampled eleven rolls and
     * A4 forty; this operation's composition sits on a reserved start shelf and
     * on ground `arid`'s low relief keeps mostly flat, so the spread between
     * rolls is narrow and the sweep was stopped when a clean one appeared. Anyone
     * moving a point in the layout should re-run it rather than assume the
     * margin.
     *
     * Pinned by `tests/campaign-maps.spec.ts` as a terrain fingerprint: a
     * generator change that re-rolls this ground moves every distance above.
     */
    mapSeed: 20_260_935,
    /*
     * A4 + 7 ON THE CHAPTER'S OWN COUNTER (7 014, 7 021, 7 028, 7 035), AND
     * HERE IT DRAWS A PAIR THE CHAPTER HAS NOT USED.
     *
     * `seatedSlots(2, 7042, null)` returns **[1, 3]** — an EDGE pair, 296.00 m
     * of start separation, against the 386.16 m diagonals A1, A2, A3 and A4 all
     * sit on ([2, 3] for A1 and A4, [0, 1] for A2 and A3; both are diagonals).
     * The pair index read [0, 2] here and in the layout, which is not a pair
     * `dryPairs(null)` can draw for these seeds; the SPOTS and the 296.00 m were
     * measured on the built world and are unchanged.
     * Both openings are on the same short side of the map and the whole
     * southern half is ground nobody starts on. That is the shape an assault
     * wants: ninety metres less approach, and the length of the operation coming
     * from the works rather than from the drive. Change this and re-measure; do
     * not re-read.
     */
    simSeed: 7_042,
    armies: 2,
    /*
     * `base`. The player has to BUY an assault here — the opening garrison is 4
     * Wardens and 5 G.I.s against three emplacements and a district — so they
     * need the thing that produces one, and an `mcv` opening would spend the
     * first ninety seconds unfolding against a seventeen-minute clock.
     */
    opening: 'base',
    /*
     * 5 000, AND IT BINDS BOTH SEATS — `Shell.applySimPostBoot` writes
     * `setup.startingCredits` into every non-Neutral slot.
     *
     * The chapter's ramp is 2 500 / 3 000 / 4 000 / 5 000 and this HOLDS at the
     * top rather than climbing past it, because the pressure this operation adds
     * over A4 is ground and not money: a sixth thousand buys a second army, and
     * an assault that can be bought outright at t=0 is a march. Two of the
     * numbers in the header are priced against it — an engineer is 500 and the
     * section the Works send at minute eight is 2000, so a player who wants to
     * take the hall whole without waiting is spending two fifths of the opening
     * bank on four unarmed men.
     *
     * It is still half the skirmish 10 000, which is the lever CLAUDE.md names
     * for the opening bank twice reported as a prebuilt AI base — a district
     * that has not been hit yet should not be raising seven buildings in ninety
     * seconds either.
     */
    credits: 5_000,
  },
  layout: 'allies-forced-closure',

  // NEITHER SHIPPED RULE MAY END THIS. See the header: `annihilationWin` is
  // strictly weaker than `t.win` and could only fire late, and `assetLossDefeat`
  // would end this operation's best last act at 2 Hz.
  outcome: { annihilationWin: false, assetLossDefeat: false, ignoreSeats: [] },

  // See the header. Empty on both sides — and the Soviet half is the one that
  // matters, because a Tesla Coil beside the hall would close the west face this
  // operation's medal is walked through.
  roster: { player: [], ai: [] },

  objectives: [
    {
      id: 'stop',
      kind: 'primary',
      title: 'Take the Works computing hall off the Ninth before the run is published',
    },
    /*
     * NO `credits` ON THIS ROW, AND IT IS DELIBERATE RATHER THAN AN OMISSION.
     * It resolves on the tick the operation ends, so a payout would be credited
     * to a player with no match left to spend it in — a reward that exists only
     * on a debrief screen is not one. `allies.03.ground-truth` and
     * `allies.04.misclosure` both refuse a payout on an end-of-match secondary
     * for the same reason. The medal is the payment.
     */
    {
      id: 'intact',
      kind: 'secondary',
      title: 'Take the hall whole rather than level it',
    },
    /*
     * THIS ONE PAYS, BECAUSE IT RESOLVES MID-MATCH AND THE MONEY HAS SOMEWHERE
     * TO GO. Five hundred credits is one engineer with a hundred left over, and
     * it arrives at the moment the player has just spent a detour on a building
     * no objective required them to reach.
     */
    {
      id: 'store',
      kind: 'secondary',
      title: 'Take the card store off them as well',
      credits: 500,
    },
  ],

  triggers: [
    /* -- the brief, in five beats -----------------------------------------
     * Split across fifty-eight seconds because the shell renders dialogue as
     * toasts and a stack of five at once is a stack nobody reads — and because
     * `Shell.campaignBeatSeq` no longer lets two lines from one speaker inside
     * six seconds eat each other, so every one of these really does appear. The
     * mechanic is in the third beat, in numbers this table can be checked
     * against: four engineers, or five hundred and fifty points and one.
     *
     * THE ONE `cameraMove` IN THIS FILE, AND IT IS THE REVEAL. `types.ts`
     * reserves it for an arrival, a loss or a reveal and forbids it as
     * punctuation; this is the thing the operation is about, shown once, at four
     * seconds, before the player has begun anything.
     */
    {
      id: 't.open',
      when: { on: 'elapsed', ticks: seconds(4) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Aubray',
          text: 'It went out at midnight and the Ninth answered it by six. They are not disputing '
            + 'the misclosure. They are running it back through the model with the residual spread '
            + 'along the line, so the published schedule moves about nine days — which the yards '
            + 'can absorb — and every refinery already sited stays exactly where it is.',
        },
        { do: 'revealArea', player: 0, area: WORKS_AREA },
        { do: 'cameraMove', at: HALL },
      ],
    },
    {
      id: 't.brief',
      when: { on: 'elapsed', ticks: seconds(18) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Wend',
          text: 'The model is a room, and it went to them with the plate mills at the Split. A hall '
            + 'of integrators two hundred and thirty-six metres off our own yard, three guns sitting '
            + 'on it, and the card store forty-four metres west of that with eleven years of the arc '
            + 'in it. The run publishes at seventeen minutes.',
        },
        { do: 'revealArea', player: 0, area: STORE_AREA },
      ],
    },
    {
      id: 't.orders',
      when: { on: 'elapsed', ticks: seconds(32) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Aubray',
          text: 'Two ways to take it off them. Four engineers walk in and it is ours whole — a '
            + 'fifth of that wall each, and the fourth one turns the door. Or put five hundred and '
            + 'fifty points of shell into her first and one engineer is enough. Both stop the run. '
            + 'Only one of them leaves us something to run a corrected series on.',
        },
      ],
    },
    /* -- and she says what the cheap answer costs -------------------------
     * The one line this operation cannot work without. Levelling the hall is a
     * WIN, and a player has to understand before they take it that stopping a
     * wrong number is not the same as being able to publish a right one — which
     * is the argument this chapter has been making since A1.
     */
    {
      id: 't.bramm',
      when: { on: 'elapsed', ticks: seconds(46) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Bramm, on the survey net',
          text: 'That hall is the only apparatus on the continent that will take my series. Level '
            + 'it and you have won the argument by burning the thing that would have settled it, '
            + 'and every schedule after this one is a guess with better manners. I would rather you '
            + 'took it.',
        },
      ],
    },

    /* -- and the one warning the interface cannot give ---------------------
     * THE CURSOR OFFERS A CAPTURE IT WILL NOT PERFORM. See the header:
     * `isCapturable` has no health gate, `caps.canCapture` is an OR over the
     * whole selection, and the player owns an engineer from t=0 — so a
     * select-all right-click on the full-health hall paints the green capture
     * glyph and issues `OrderKind.Attack` to everything that is not the
     * engineer. Ten point eight seconds later the medal is gone and the primary
     * is satisfied, which is the worst possible pairing: the mistake wins.
     *
     * TWELVE SECONDS AFTER `t.bramm` AND A DIFFERENT SPEAKER, deliberately.
     * Bramm has just said what levelling the hall costs; this says what levels
     * it. `Shell.campaignBeatSeq` only collapses two lines from ONE speaker
     * inside six seconds, so both land — but the gap is there for reading time
     * rather than for the queue.
     *
     * IT NAMES THE CONTROL, NOT THE CODE. "Point everything at her" is what the
     * player does; `caps.canCapture` is not a thing the fiction can say. The
     * instruction has to be actionable at the moment it is heard, which is
     * before a single hull has been ordered anywhere.
     */
    {
      id: 't.cursor',
      when: { on: 'elapsed', ticks: seconds(58) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Aubray',
          text: 'One thing about the order you give. Point the whole column at that hall and the '
            + 'cursor will show you a capture, because we have an engineer in the line — but the '
            + 'tanks cannot take a building, so they shoot it, and she is rubble in eleven seconds. '
            + 'Engineers go in on their own. Everything else stands off the wall.',
        },
      ],
    },

    /* -- the works notices, and it answers through its own open face -------
     * KEYED TO THE PLAYER RATHER THAN TO THE CLOCK, so the hinge sits in the
     * same place for a fast commander and a careful one — the shape
     * `soviets.02.common-standard` and `reclamation.02.written-off` both use.
     *
     * `unitsInArea` is UNTAGGED deliberately: the question is whether the player
     * has committed anything to the works, and the answer must not depend on
     * which hulls an author remembered to name. It cannot fire on tick one — the
     * player's nearest structure is 208.47 m from the hall and their home ore
     * field is 251.87 m from it, so no harvester's route passes through this
     * disc either. That is the expensive spelling (`runtime.ts` walks the alive
     * list twice a tick for it, once for the arming pass) and `state.fired`
     * retires the trigger the moment it goes off.
     *
     * LITERAL SOVIET KEYS. `EffectSink.spawnUnits` resolves through
     * `ProductionCatalog.byKey` and remaps nothing, unlike the layout's
     * `ScenarioBuilder.spawnUnit`; `validateCampaign` checks every key against
     * the army of the seat it lands on, so an Allied key here is a build error.
     */
    {
      id: 't.watch',
      when: { on: 'unitsInArea', player: 0, area: WORKS, min: 3 },
      then: [
        {
          do: 'dialogue',
          speaker: 'Rakhalt, intercepted',
          text: 'They are on the works. Turn the store watch out and stand on the hall — the run '
            + 'has hours on it and I am not the one explaining a stoppage to the branch.',
        },
        { do: 'spawnUnits', player: 1, key: 'conscript', count: 4, at: SPUR, spread: 16, tag: 'watch' },
        { do: 'spawnUnits', player: 1, key: 'rhino', count: 2, at: SPUR, spread: 11, tag: 'watch' },
        { do: 'orderTagged', tag: 'watch', order: 'attackMove', at: HALL },
      ],
    },

    /* -- the first column, on the clock ------------------------------------ */
    {
      id: 't.col1',
      when: { on: 'elapsed', ticks: minutes(5.5) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Wend',
          text: 'First column off their yard, seven of them on the works road. Eighty-two metres, '
            + 'so fifteen seconds for the armour and twenty-four for the men.',
        },
        { do: 'spawnUnits', player: 1, key: 'conscript', count: 5, at: ROAD, spread: 20, tag: 'col1' },
        { do: 'spawnUnits', player: 1, key: 'rhino', count: 2, at: ROAD, spread: 14, tag: 'col1' },
        { do: 'orderTagged', tag: 'col1', order: 'attackMove', at: HALL },
      ],
    },

    /* -- the section --------------------------------------------------------
     * THE ONE SCRIPTED `eva` IN THIS FILE, AND IT IS THE CASE `types.ts` NAMES
     * AS EARNING ITS PLACE: `audio.system.ts` has no event for a scripted wave,
     * so `reinforcements` is the line no other caller in a match will speak at
     * this moment. (It is no longer true that NOTHING says it —
     * `orecrisis.system.ts` emits `EvaLine.Reinforcements` for the stranded
     * economy rescue and reaches the announcer through `EVA_LINE_ID`. The two
     * moments are minutes apart and `EVA_LINES.reinforcements` carries a
     * ten-second cooldown, so the overlap is harmless; it is recorded because
     * `soviets.06.demolition-order` had to correct the shorter claim.)
     *
     * `engineer` is a `Faction.Neutral` row in `FALLBACK_UNITS`, which is what
     * makes it legal on seat 0 under `validateCampaign`'s faction check — the
     * same property that lets `harvester` and `mcv` spawn on any seat.
     */
    {
      id: 't.section',
      when: { on: 'elapsed', ticks: minutes(8) },
      then: [
        { do: 'eva', line: 'reinforcements' },
        {
          do: 'dialogue',
          speaker: 'Aubray',
          text: 'The Works emptied the depot for us. Four engineers, behind our own yard, and they '
            + 'are the whole of the arithmetic — a fifth of that wall each and the fourth one turns '
            + 'the door. Two hundred and nineteen metres to the west wall, and they are worth '
            + 'nothing at all to anybody with a rifle.',
        },
        { do: 'spawnUnits', player: 0, key: 'engineer', count: 4, at: MUSTER, spread: 12, tag: 'section' },
      ],
    },

    {
      id: 't.col2',
      when: { on: 'elapsed', ticks: minutes(10) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Wend',
          text: 'Second column, eight, same road. They are feeding the works rather than defending '
            + 'the district, which tells you what the run is worth to them.',
        },
        { do: 'spawnUnits', player: 1, key: 'conscript', count: 5, at: ROAD, spread: 20, tag: 'col2' },
        { do: 'spawnUnits', player: 1, key: 'rhino', count: 3, at: ROAD, spread: 14, tag: 'col2' },
        { do: 'orderTagged', tag: 'col2', order: 'attackMove', at: HALL },
      ],
    },

    /* -- the interim, which is the whole trick said out loud ---------------- */
    {
      id: 't.interim',
      when: { on: 'elapsed', ticks: minutes(11.5) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Wend',
          text: 'They have published an interim off the forced run. The arc moves nine days, and '
            + 'the misclosure is spread over four hundred and ten kilometres of line a millimetre '
            + 'at a time.',
        },
        {
          do: 'dialogue',
          speaker: 'Bramm, on the survey net',
          text: 'That is the trick, and it is a very old one. Distribute an error finely enough and '
            + 'every station is inside tolerance while the whole line is wrong. Nobody can point at '
            + 'a bench and say this one. Take the hall.',
        },
      ],
    },

    {
      id: 't.col3',
      when: { on: 'elapsed', ticks: minutes(14) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Wend',
          text: 'Everything the district has left, ten of them, and three minutes on the run.',
        },
        { do: 'spawnUnits', player: 1, key: 'conscript', count: 6, at: ROAD, spread: 20, tag: 'col3' },
        { do: 'spawnUnits', player: 1, key: 'rhino', count: 4, at: ROAD, spread: 14, tag: 'col3' },
        { do: 'orderTagged', tag: 'col3', order: 'attackMove', at: HALL },
      ],
    },

    /* -- the two edges of the capture window -------------------------------
     * `entityHpBelow` is `f >= 0 && f < frac` and answers -1 when nothing alive
     * carries the tag, so neither of these can fire on a rubble field — which is
     * the whole reason it is a different condition from `entityDead`.
     *
     * **0.75 IS `AI_REPAIR.startFraction` EXACTLY, AND THE COINCIDENCE IS
     * REAL.** `AiBrain.repairBase` seeds its search at that fraction and takes
     * the worst STRICTLY below it, and this condition is likewise a strict `<`,
     * so this line lands on the same tick the Ninth's wrench becomes able to see
     * the hall. Thirty hit points a second out of their bank; a hall left at
     * four tenths is back to full in twenty-two seconds for a hundred and
     * sixty-five credits.
     */
    {
      id: 't.wrench',
      when: { on: 'entityHpBelow', tag: 'hall', frac: 0.75 },
      then: [
        {
          do: 'dialogue',
          speaker: 'Wend',
          text: 'We are a quarter into her and their wrench has just gone on — thirty hit points a '
            + 'second out of their own bank. Anything we stop shooting at is back to full inside '
            + 'half a minute.',
        },
      ],
    },
    /*
     * AND THE OTHER EDGE. `Capture.resolve` refuses at `frac > captureHpFrac`,
     * so the hall is takeable AT exactly 0.5 while this condition is a strict
     * `<` — the line therefore lands one hit point past the threshold rather
     * than on it. One shell late, which is the right direction for a line whose
     * whole content is "now".
     */
    {
      id: 't.half',
      when: { on: 'entityHpBelow', tag: 'hall', frac: 0.5 },
      then: [
        {
          do: 'dialogue',
          speaker: 'Aubray',
          text: 'She is under half. One engineer turns her from here — send him now, and take the '
            + 'guns off her before you take anything else off her.',
        },
      ],
    },

    /* -- the close, telegraphed -------------------------------------------- */
    {
      id: 't.closing',
      when: { on: 'elapsed', ticks: minutes(16) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Aubray',
          text: 'One minute. Whatever is on their books at seventeen is what the continent sites '
            + 'from.',
        },
      ],
    },

    /* -- the card store -----------------------------------------------------
     * `ownerCount ... max: 0` rather than `entityDead`, and the difference is
     * capture: an engineer that walks into the store satisfies this exactly as
     * levelling it does, which is what the title promises. The `SETTLE` guard is
     * the same one the primary carries and for the same reason — a count of zero
     * reads TRUE before the layout has stamped the tag.
     *
     * ABOVE `t.win`, which is this file's ordering rule: `runDirector` returns
     * early once an outcome is set, so a secondary written below the win can
     * never resolve on the winning tick and the medal never counts it.
     */
    {
      id: 't.storeTaken',
      when: {
        on: 'all',
        of: [
          { on: 'elapsed', ticks: SETTLE },
          { on: 'ownerCount', player: 1, role: 'building', tag: 'store', max: 0 },
        ],
      },
      then: [
        { do: 'completeObjective', id: 'store' },
        {
          do: 'dialogue',
          speaker: 'Wend',
          text: 'Card store is off their books. Whatever that model runs next, it will not be '
            + 'running it against eleven years of ours.',
        },
        {
          do: 'dialogue',
          speaker: 'Aubray',
          text: 'Five hundred released against it. Spend it on the hall, not on the store.',
        },
      ],
    },

    /* -- the medal, lost --------------------------------------------------
     * FAILS AT THE MOMENT IT BECOMES UNREACHABLE rather than at the close. A
     * REBUILT STRUCTURE CARRIES NO TAG — `c.tag` runs once, inside the layout —
     * and `civHospital` has no route back into anybody's sidebar in any case, so
     * nothing a player can do restores this objective once the hall is rubble.
     * An objective that stays lit after it is impossible is a lie the player
     * plays against for the rest of the match; `soviets.06.demolition-order`
     * argues the same about its infirmary.
     */
    {
      id: 't.intactLost',
      when: {
        on: 'all',
        of: [{ on: 'elapsed', ticks: SETTLE }, { on: 'entityDead', tag: 'hall' }],
      },
      then: [
        { do: 'failObjective', id: 'intact' },
        {
          do: 'dialogue',
          speaker: 'Bramm, on the survey net',
          text: 'So it is rubble. The forced closure is dead and so is the only apparatus that '
            + 'could have replaced it. We have stopped a wrong number and we cannot produce a right '
            + 'one. Log that exactly as I said it.',
        },
      ],
    },

    /* -- the store, unresolved at the finish ------------------------------
     * The same shape as `allies.04.misclosure`'s `t.musterStanding`: a row left
     * `active` when the operation ends reads on the debrief as unfinished rather
     * than as missed. It cannot wrongly fire on a store already taken — that row
     * is `complete` by then and `CampaignSession.setObjective` refuses to
     * un-resolve a resolved row.
     */
    {
      id: 't.storeStanding',
      when: {
        on: 'all',
        of: [HALL_GONE, { on: 'ownerCount', player: 1, role: 'building', tag: 'store', min: 1 }],
      },
      then: [{ do: 'failObjective', id: 'store' }],
    },

    /* -- the medal, taken ---------------------------------------------------
     * `structureCaptured` is `ownerOfTag(tag) === player`, which for an ENEMY
     * structure means an engineer arrived at or below half health — see the
     * header for the four-engineer ladder and for why the Ninth's wrench makes
     * the walk a convoy problem rather than a pathing one.
     *
     * ABOVE `t.win`, which fires on the same tick: the capture is what satisfies
     * the primary, so a completion written below it would never be applied.
     */
    {
      id: 't.intact',
      when: { on: 'structureCaptured', tag: 'hall', player: 0 },
      then: [
        { do: 'completeObjective', id: 'intact' },
        {
          do: 'dialogue',
          speaker: 'Bramm, on the survey net',
          text: 'The frames are whole and the integrators are cold, not broken. Give me the closed '
            + 'series and a week in that room and the continent gets a schedule somebody can check.',
        },
      ],
    },

    /* -- the run stops ------------------------------------------------------
     * ABOVE BOTH LOSSES, WHICH INVERTS THE HOUSE CONVENTION TWICE ON PURPOSE.
     * See the header: a column that takes the hall on the closing tick has
     * stopped the run, and a commander whose LAST unit is the engineer that
     * turns the door reads `Viability.isBeaten` on the tick they capture,
     * because `Capture.ts#consume` spends the engineer. Both of those are wins
     * and the file order is what says so.
     */
    {
      id: 't.win',
      when: HALL_GONE,
      then: [
        { do: 'completeObjective', id: 'stop' },
        {
          do: 'dialogue',
          speaker: 'Aubray',
          text: 'The model is off their books and the run stopped where it stood. Whatever the '
            + 'continent sites from after today, it will not be a number that was made to agree '
            + 'with itself.',
        },
        { do: 'endOperation', result: 'win' },
      ],
    },

    /* -- the run publishes -------------------------------------------------
     * The hard deadline, at `parSec` to the second. It fails all three rows: the
     * two secondaries cannot be collected after the operation is over, and
     * failing one that is already complete is a no-op because a resolved row
     * does not un-resolve.
     */
    {
      id: 't.deadline',
      when: { on: 'elapsed', ticks: CLOSE },
      then: [
        { do: 'failObjective', id: 'stop' },
        { do: 'failObjective', id: 'intact' },
        { do: 'failObjective', id: 'store' },
        {
          do: 'dialogue',
          speaker: 'Aubray',
          text: 'Seventeen minutes. The forced closure is published and it is the schedule now — '
            + 'nine days of correction against a loop that shut eleven millimetres out, and every '
            + 'refinery on the continent stays exactly where it was put.',
        },
        { do: 'endOperation', result: 'loss', reason: 'stop' },
      ],
    },

    /* -- the ordinary loss --------------------------------------------------
     * `playerBeaten` is `Viability.isBeaten` — nothing to build with AND nothing
     * to fight with — not "you have no buildings". This operation deliberately
     * asks a commander to send everything 236 m from home, and one with an empty
     * base and a live column is not beaten.
     */
    {
      id: 't.beaten',
      when: {
        on: 'all',
        of: [{ on: 'elapsed', ticks: SETTLE }, { on: 'playerBeaten', player: 0 }],
      },
      then: [
        { do: 'failObjective', id: 'stop' },
        {
          do: 'dialogue',
          speaker: 'Wend',
          text: 'Nothing answering anywhere. They will finish the run at their leisure and file it '
            + 'as uncontested, which is the one thing it has never been.',
        },
        { do: 'endOperation', result: 'loss', reason: 'stop' },
      ],
    },
  ],
};

export default op;
