/**
 * ============================================================================
 * A8 — STANDING ORDER
 * ============================================================================
 * A7 put the correction on the wire and Bramm's last line said what that was
 * worth: *"For one edition. That chain is not ours and never was — it sends what
 * is lodged with it, by whoever walks in, and the Ninth can walk in on Monday.
 * Get me something they will still be checking it against in a year."*
 *
 * This is Monday, and the thing that lasts a year has a name and a price. A slip
 * lodged at a relay head goes down the trunk once and a clerk pastes it into one
 * evening's circular. A **standing amendment** is entered in the series itself,
 * repeated every evening, and checked against by every siting office on the
 * continent until it is superseded — and the Works will only enter one over
 * their own signature. Nobody has paid the Works since the Split. The line staff
 * sit at their counters because the salvage house has been paying them a
 * retainer, which is the entire reason the standing block on the eastern arc
 * carries Cregg's price list and not anybody's schedule.
 *
 * So the Allies have drawn the arrears. Twelve thousand credits, a year of wages
 * for every block on the arc, in a chest, on a cart, in a field. Pay it at the
 * counter and the amendment goes into the standing series over the Works' own
 * hand — not as an army's slip, not as anybody's claim.
 *
 * **AND THE ANTAGONIST IS NOT TRYING TO TAKE IT.** Cregg says so in clear at
 * thirty-six seconds: he cannot spend Allied credits at his own counter and the
 * chain is no use to him broken. His whole play is to make the Field Marshal
 * SPEND it — twenty minutes of pressure priced to cost more to answer than it
 * costs to send. That is what makes this the chapter's economy operation rather
 * than a fourth fight over a building, and it is the reason the enemy's ordinary
 * behaviour reads as a plan rather than as an AI: nothing here scripts the
 * Reclamation doing anything unusual, it just says out loud what the pressure is
 * for.
 *
 * **THE CHAPTER'S SPINE, ONE TURN FURTHER.** A1-A6: a number is only worth what
 * the instrument behind it is worth. A7: it is only worth the counter it was
 * lodged at. A8: it is only worth **what you can still afford when the counter
 * opens** — and the drama the chapter has always been about, whether a number
 * can be DEFENDED, is here a bank balance that has to survive twenty minutes of
 * somebody selling you reasons to spend it.
 *
 * ============================================================================
 * WHY `primaryType: 'economy'`, AND WHY THAT OVERTURNS A CUT MADE TWICE
 * ============================================================================
 * **`allies.05.forced-closure` AND `allies.06.machine-time` BOTH CUT `economy`
 * FROM THIS CHAPTER, IN WRITING**, and the second states the reason at its
 * sharpest: *"`reclamation.02.written-off` and `soviets.09.nil-return` between
 * them own both shapes the frozen vocabulary has for it, and a third would be a
 * third `credits` threshold wearing a hat."* That was true of every economy
 * operation anybody had proposed, and it is the correct objection to answer
 * rather than to route around.
 *
 * **THE ANSWER IS THAT THIS ONE IS NOT A THRESHOLD TO REACH. IT IS A BALANCE TO
 * KEEP.** R2 and S9 both start the player poor and ask them to out-earn a
 * number; the whole play is accumulation, and the ceiling is the trap. Here the
 * money is IN THE BANK AT NINE SECONDS and the objective reads the same figure
 * at the end. Every verb in the game is priced against it in the opposite
 * direction:
 *
 *     a Warden               700   the answer to a Grinder, and 6% of the chest
 *     a harvester          1 400   the only purchase that pays itself back
 *     an engineer            500   a quarter of the secondary
 *     a Refractor Tower      ---   WITHHELD — see the roster block below
 *     an Ore Silo            150   pointless here, and the block below says why
 *
 * Three things differ from R2 and S9 and each is a decision rather than a
 * different number:
 *
 *   - **THE BANK IS NOT EARNED, IT IS INHERITED, SO THE PLAY IS EXPENDITURE.**
 *     R2's own reading is the one this inherits and does not restate as a
 *     discovery: `WorldQuery.creditsOf` reads `PlayerState.credits`, what is in
 *     hand at that instant, so *"the objective and the build queue are the same
 *     number counted twice"*. R2 pushes that from below. This pushes it from
 *     above, which turns the HUD's credit readout into a progress bar that only
 *     ever goes the wrong way.
 *   - **THE READ IS AT ONE AUTHORED INSTANT NOBODY CHOOSES.** R2 has no timer
 *     and latches whenever the player first reaches the figure; S9 has a
 *     deadline and latches any time before it. Here the counter opens at the
 *     send and not a tick earlier, so the balance has to be there AT six —
 *     banking it at minute eight buys nothing if it is spent at minute twelve.
 *     That is the property the whole operation rests on and it is what makes
 *     "defend a number" a literal instruction.
 *   - **THE CEILING IS DELIBERATELY NOT THE SUBJECT, BECAUSE BOTH OF THEM OWN
 *     IT.** R2's gap is one silo and S9's is ten, and a third operation about
 *     `Economy.deposit` wasting the overflow would be the same trap a third
 *     time. Measured on this operation's own built base (see the block below),
 *     the ceiling after the chest lands is **22 000 against a 12 000 objective**
 *     — ten thousand of headroom, so a player who never builds a silo never
 *     loses a credit to it.
 *
 * ============================================================================
 * THE ARITHMETIC THAT IS THE OPERATION, AND ONE MEASURED CLIFF
 * ============================================================================
 * `map.credits` is **5 000** and `t.chest` grants **12 000** to seat 0 at nine
 * seconds. So the player opens the fight holding **17 000** against a figure of
 * **12 000**, and the sentence the whole design reduces to is:
 *
 *     FIVE THOUSAND OF YOUR OWN, AND EVERYTHING YOUR HAULERS LIFT.
 *
 * The income is the budget, and it is measured rather than assumed.
 * `src/data/Civilians.ts` prices its own rates against twelve harvesters over
 * three seeds in `tests/harvester-soak.spec.ts` — **429 to 700 credits per
 * harvester per minute** — and `buildBaseFor` ships two. Over the twenty
 * authored minutes that is **17 160 to 28 000 credits**, so the war this
 * operation can afford is between eight hundred and fourteen hundred credits a
 * minute of hulls, and every credit of it has to be earned before it is spent.
 *
 * **A THIRD HAULER IS THE ONLY PURCHASE ON THE LIST THAT PAYS ITSELF BACK**:
 * 1 400 credits against 429-700 a minute is **two to three and a quarter
 * minutes**, which is the arithmetic an economy operation exists to make a
 * player feel. Nothing in the trigger table says so.
 *
 * **THE CLIFF, MEASURED THROUGH A REAL `Economy` ON THE REAL BUILT BASE.**
 * `Economy.grant` is `refund`, which calls `liftFloorFor`, which raises
 * `capFloor` to the whole balance **only when `credits > storageMax`** —
 * strictly greater. The Allied opening base's ceiling is
 * `STORAGE_BASE` 10 000 + refinery 2 000 + two silos at 1 500 = **15 000**,
 * measured here on the real built base through a real `Economy` with the real
 * `storageForSlot` resolver installed. (`tests/economy.spec.ts` records the same
 * figure by faction in prose; it does not assert it — that file builds its own
 * rig and never calls `buildBaseFor`, so this is a second measurement of the
 * same quantity rather than a citation of a gate.) So:
 *
 *     opening bank   after the 12 000 grant   ceiling   headroom
 *         3 000            15 000              15 000       0     <- PINNED AT THE CAP
 *         4 000            16 000              21 000    5 000
 *         5 000            17 000              22 000    5 000
 *
 * At 3 000 — `reclamation.02.written-off`'s own opening bank, and the obvious
 * number to copy — the grant lands exactly ON the ceiling, `liftFloorFor`'s
 * strict comparison declines to fire, and **every credit the player mines from
 * then on is wasted until they spend or build a silo**. The operation would
 * have shipped with its own economy switched off. 5 000 is chosen for the
 * headroom on the far side of that cliff and not for the float; re-measure this
 * table before touching `map.credits`, `SILO_STORAGE` or the chest.
 *
 * ============================================================================
 * THE DECISION THIS OPERATION OWNS: WHEN YOU TAKE THE COUNTER
 * ============================================================================
 * The win reads two things at the send, and the second is a piece of ground:
 *
 *     credits(player 0) >= 12 000        the arrears are whole
 *     ownerCount(player 0, 'building', 'head') >= 1     the counter is ours
 *
 * The block head is GAIA, which by `Capture.ts` rule 1 means **one engineer, at
 * any health, consumed, and the deed is permanent** — and by
 * `GarrisonService.enter` means **one rifleman, who gives it back when he walks
 * out**. Both were established on this same def one operation ago; what is new
 * is that the read happens at ONE INSTANT, so the two verbs stop being
 * interchangeable and start being a schedule:
 *
 *   - **TAKE IT EARLY** and one engineer buys the clause for the rest of the
 *     match — and hands the Reclamation a target. `Targeting.isValidTarget`
 *     refuses only ALLIES and Gaia is allied to everybody, so while the block is
 *     Gaia's nothing can acquire it and only splash reaches it (27 to 90
 *     satchels, per the layout header). The tick it becomes Allied it is a
 *     lone 800 hp building in open country that **five Grinders level in 9.05
 *     seconds — and `t.wave5`, which is ordered onto it, is 4 Grinders and 8
 *     Pickers together, 165.82 dps, 4.82 seconds.** `t.headLost` is an
 *     unconditional loss.
 *   - **TAKE IT LATE** and it costs nothing until it costs everything: it is
 *     226.1 m of Foot route out, `t.wave5` and `t.wave6` are ordered onto it at
 *     fifteen and eighteen minutes, and a rifleman who walks in at 19:59 has to
 *     walk through them.
 *
 * **NEITHER IS RECOMMENDED AND BOTH ARE NOW PRICED WHERE THE PLAYER CAN SEE
 * THEM, WHICH IS A FIX RATHER THAN A DESCRIPTION.** This block used to close
 * *"`t.cregg` says so on the open net before a shot is fired"* and the layout
 * claimed the same thing "at forty-eight seconds". There is no beat at
 * forty-eight seconds — they are at 4, 9, 22, 36 and 50 — and none of the five
 * mentioned it. Worse, two shipped lines pointed the OTHER way: `t.cregg` said
 * *"I would not want the chain broken either"* and `t.wave5` said *"He does not
 * want the counter"* on the tick it attack-moved twelve hulls at it. So the
 * cheapest, most obvious opening in the file — one engineer, minute three, the
 * objective locked in — converted an untargetable building into a single point
 * of instant unrecoverable defeat, unsignposted, with the antagonist explicitly
 * reassuring the player it was safe. **`t.cregg` states the mechanism now**, at
 * thirty-six seconds, in the voice of the one character with a reason to warn
 * about it, and `t.wave5` names the consequence rather than denying it.
 *
 * **AND THE SECONDARY IS THE SAME QUESTION ASKED ABOUT ONE BUILDING.** Cregg's
 * retainer is a `civOilDerrick` on his seat paying him **900 credits a minute**
 * — 64% to 105% of a whole two-hauler economy, and 18 000 credits over the full
 * twenty minutes if nobody touches it. `ownerCount(player 1, ..., max: 0)` is
 * satisfied by destroying it OR by taking it, which is deliberate: destroying it
 * costs 900 hp of Concrete and denies him the income, and taking it costs four
 * engineers at 2 000 credits and CAN pay the same income to the player. One of
 * those two answers is free and earns nothing; the other is the largest
 * investment available on this map. That is the operation's own question, posed
 * once, in miniature.
 *
 * **"CAN PAY", NOT "PAYS", AND THE WORD IS THE WHOLE CORRECTION.** This block
 * and the layout's both sold the capture as buying 900 a minute outright, and
 * that is false while either Spitpost stands. Measured on the built world: both
 * posts sit 17.2047 m from the derrick centre, `hitRadius(2, 2)` is 5.657, so
 * the surface distance is **11.5478 m against `postCoil`'s range of 20** — and
 * `Targeting.isValidTarget` refuses only ALLIES, so a player-owned derrick is a
 * legal target for the two guns standing on top of it. The layout header carries
 * the ladder; the short form is that the capture arrives at 360 hp (three
 * softens of 180, and `Capture.resolve` writes `st.hp` only on its FRIENDLY
 * branch, so taking a building does not mend it), one post levels that in
 * **18.75 s** and two in **9.38 s**, and the wrench beats one post for 288
 * credits a minute and loses to two at any price. **The clean 900 costs both
 * posts, not one.**
 *
 * The layout header carries the price of getting there: eight capture stands,
 * every one inside a Spitpost's fire circle, **9.66 m of minimum exposure with
 * both posts standing — 130 to 174 damage against a 90 hp engineer — and 0.00 m
 * at three stands the moment either post is broken.** Four Wardens break a post
 * in 8.06 s. **But that table is a claim about the GROUND and not about the
 * route the engine walks**: `Capture.simTick` re-aims the order at the derrick
 * CENTRE every tick, whose flow-field goal buckets to cell (50, 58) — world
 * (202, 234), a stand covered by the north-east post ALONE — and the two
 * cheapest stands to reach are both covered by that post alone as well. So a
 * right-click from the player's base spends 15 to 20 m under the north-east post
 * whether or not the other one is standing. **Break the north-east post to open
 * the walk; break the south-west one to keep what you take.** The layout header
 * has the per-stand table and the exclusion control behind that. It is a wall
 * rather than a price, deliberately, and the layout says why that is the right
 * answer here and was the wrong one in A7.
 *
 * ============================================================================
 * WHAT ENDS THE MATCH, IN BOTH DIRECTIONS
 * ============================================================================
 * Both shipped outcome rules are off, so all four routes are authored:
 *
 *     t.pay        the call has come AND both clauses hold        WIN
 *     t.short      the send AND they do not                       LOSS  'book'
 *     t.headLost   the block head is dead                         LOSS  'book'
 *     t.beaten     no units and nothing that can build            LOSS  'book'
 *
 * **`t.pay` AND `t.short` ARE AN EXACT PARTITION OF ONE TICK, AND THAT IS WHY
 * `not` IS USED RATHER THAN A SECOND THRESHOLD.** At tick `SEND` both triggers
 * evaluate; `t.short` is the literal negation of the same `ON_THE_COUNTER`
 * object `t.pay` reads, so exactly one of them fires whatever the world looks
 * like. Writing the loss as `credits(max: 11_999)` instead would be a real bug
 * and `reclamation.05.closing-entry` has already recorded it:
 * **`PlayerState.credits` is a FLOAT** — `deposit` accumulates a harvest in
 * `SIM_DT` steps and nothing pins the running total to an integer — so
 * `min: 12000` and `max: 11999` are not complements, a balance of 11 999.5
 * satisfies neither, and against a deadline that is an operation which cannot
 * end. `t.drawn` negates the same object for the same reason.
 *
 * **THE COUNTER OPENS EARLY IF CREGG STOPS PAYING FOR IT, AND THAT IS THE ONLY
 * REWARD THE SECONDARY GETS.** `THE_CALL` is the afternoon call at fourteen
 * minutes with the retainer off him, OR the send at twenty. `ObjectiveDef.credits`
 * would have been the obvious payment and is refused below; paying a player
 * credits for taking a derrick that already pays 900 a minute is
 * `allies.06.machine-time`'s *"a payout that refunds the engineer it cost is a
 * secondary that is free"* with a bigger number on it. Six minutes off a
 * twenty-minute clock is a reward the operation's own subject can price.
 *
 * `annihilationWin` is OFF because razing the salvage house does not put money
 * on a counter, and `Shell.pollOutcome` would declare victory the tick the last
 * Reclamation asset died with the arrears undrawn and nobody at the head. A
 * player who wins the battle at minute twelve still has to be solvent at six,
 * which is the operation stating its own thesis through the outcome policy.
 *
 * `assetLossDefeat` is OFF because it is both too wide and too narrow.
 * `Shell.countLivingAssets` walks Building, Vehicle AND Infantry and fires only
 * at zero of all three; a commander reduced to a Construction Yard they cannot
 * afford to build from is not beaten by that rule and is beaten in fact, while
 * one who captured the block head OWNS a building and could not lose under it at
 * all. `t.beaten` reads `ownerCount('unit', max: 0)` AND
 * `ownerCount('producer', max: 0)` instead.
 *
 * **`t.beaten` DELIBERATELY DOES NOT USE `playerBeaten`, AND
 * `allies.07.fair-copy` IS THE REASON.** `Viability.surveyViability` §HELD books
 * an `EntityFlag.Garrisoned` occupant into `heldUnits` rather than
 * `contestingUnits`, so a man standing INSIDE a building does not contest — and
 * this operation's ground clause is satisfied precisely by putting men inside a
 * building. A7 staged that on a real world and ended a match with the men alive
 * and standing on the objective. The two `ownerCount` reads are the untagged
 * branch of `runtime.ts`, which walks `store.alive` and asks nothing about
 * `Garrisoned`, so a man indoors still counts.
 *
 * **THE THIRTY-SECOND SETTLE IS ABOUT A BUILD THAT FAILED AND ABOUT THE CHEST,
 * WHICH IS ONE CLAUSE MORE THAN THE USUAL ONE.** `entityDead` reads TRUE before
 * the layout has stamped the tag, and `ownerCount(max: 0)` on both branches of
 * `t.beaten` would fire on tick one against a build that placed nothing. That is
 * the ordinary reason and twenty seconds would cover it. The extra ten are for
 * `t.drawn`: the chest does not land until nine seconds, and before it lands the
 * player holds 5 000 against a 12 000 line, so a guard shorter than the grant
 * would fail the discipline secondary in the first second of every playthrough
 * for a reason no player could see. **`SETTLE` must stay strictly greater than
 * `CHEST_AT`.**
 *
 * ============================================================================
 * THE PRESSURE, PRICED
 * ============================================================================
 * Six troops on the clock and one keyed to the player, all off `ROAD`, 99.9 m of
 * Track route from their own opening:
 *
 *     2:00    6 Pickers, 2 Grinders    1 740 credits   at the contested patch
 *     5:00    6 Pickers, 3 Grinders    2 340           at the contested patch
 *     8:00    8 Pickers, 3 Grinders    2 520           at the player's ore field
 *     11:30   6 Pickers, 4 Grinders,   3 700           at the player's ore field
 *             2 Slaggers
 *     15:00   8 Pickers, 4 Grinders    3 120           at the block head
 *     18:00   6 Pickers, 5 Grinders    3 540           at the block head
 *     keyed   6 Pickers, 3 Grinders    2 340           at the derrick, on the
 *                                                      tick it goes off him
 *
 * **16 960 credits of hull as a floor and 19 300 if the player earns the keyed
 * troop**, against the 12 800 over sixteen minutes and 13 100 over seventeen that
 * `allies.07.fair-copy`'s header quotes for `allies.04.misclosure` and
 * `soviets.05.short-allocation`. It is deliberately
 * above that band and the reason is the opening: those two are fought with the
 * base the player is given, and this one is fought with twenty minutes of two
 * haulers on top of it. The point of the pressure is to be ANSWERED expensively
 * rather than to break the base, which is why it is bodies in front of hulls —
 * a Grinder's pull lands 89.60 on a G.I., who has 120, so the Allied line
 * survives exactly one and dies to the second.
 *
 * **THE HEADING IS THE ESCALATION AND THE COUNTS ARE ALMOST NOT.** Two troops at
 * the contested patch (contest the expansion), two at the ore field (charge him
 * for harvesters), two at the counter (make sure he is somewhere else at six).
 * The credits per troop move by a third across the whole match; the INTENT moves
 * three times, and the dialogue names each turn as it happens.
 *
 * The troops are a FLOOR on the pressure rather than the whole of it: the
 * salvage house has a base, a brain and twenty minutes of mining, and
 * `orderTagged ... attackMove` is a heading rather than a leash —
 * `AiBrain.census` files every hull the seat owns into `armyIds` and
 * `regroupSquads` re-files it on the next pass, and a campaign tag lives in
 * `TagRegistry`, which the brain has never heard of.
 *
 * ============================================================================
 * WHAT `parSec` 1200 IS AND WHAT IT IS NOT
 * ============================================================================
 * The authored par IS the send, to the second — the rule `allies.03.ground-truth`,
 * `allies.05.forced-closure`, `allies.07.fair-copy` and
 * `soviets.06.demolition-order` all state about their own, and the only way the
 * field is falsifiable from inside the operation. The chapter's ramp reaches
 * 1200 here, one step past A7's 1140.
 *
 * **AND IT IS THE ONE PAR IN THIS CHAPTER THAT IS ALSO A FLOOR, WHICH IS WORTH
 * SAYING OUT LOUD.** A7 can be finished at minute nine by a fast commander; this
 * one cannot be finished before fourteen and only then by a commander who has
 * taken the derrick. That is the fiction — the trunk sends at six, and a counter
 * is not open because you arrived early — and it is the mechanical consequence
 * of reading a balance at an instant rather than latching a threshold. It also
 * means the LENGTH of this operation is the least uncertain number in the file:
 * the one walk it asks for is 226.1 m — 34.3 s at a Warden's 6.6 m/s and 70.7 s
 * at a G.I.'s 3.2, i.e. **2.9% to 5.9% of par** — and everything else is twenty
 * minutes of deciding what to buy.
 *
 * ============================================================================
 * WHAT WAS CONSIDERED AND CUT
 * ============================================================================
 *   - **`unitsInArea` AT THE COUNTER INSTEAD OF `ownerCount`.** It was the first
 *     draft: three of your men inside a disc at the send. It is strictly worse
 *     twice over. It cannot tell a man who walked in from a man who was driven
 *     past, so a Grinder parked on the head would satisfy nothing while a
 *     harvester driving by would; and it makes the block itself scenery, which
 *     throws away the whole early-or-late decision above, because a building
 *     nobody owns is a building nobody can be made to defend.
 *   - **A TAGGED PAY PARTY.** Five men carrying the chest, `unitsInArea` with a
 *     tag, and a loss when the last of them dies. It reads better and plays
 *     worse: a protect-target that must survive twenty minutes inside the
 *     player's own base turns a lost skirmish into an instant defeat with no
 *     warning, and the honest fix — a relief clerk once, before some hour — is
 *     not expressible, because two triggers whose conditions hold on the same
 *     tick cannot be ordered without a predicate the frozen vocabulary does not
 *     have. The chest is a balance instead, and the file says so in the fiction:
 *     money is not stamped.
 *   - **PAYING THE SECONDARY IN CREDITS.** It would pay into the objective's own
 *     read, which is either trivial (small) or the operation solving itself
 *     (large), and the derrick already pays 900 a minute. The reward is six
 *     minutes off the clock instead.
 *   - **A HIDDEN SECONDARY.** `briefingObjectives` filters hidden rows out, and
 *     both secondaries here have to be visible before the first purchase: the
 *     discipline row is the whole spending rule, and the derrick is a decision
 *     about the first two thousand credits.
 *   - **`ignoreSeats`.** Two seats, both real, and the operation ends on its own
 *     triggers in every direction. A list would be inert.
 *   - **A FOURTH OBJECTIVE ROW.** `MAX_VISIBLE_OBJECTIVES` in `ui/Objectives.ts`
 *     is 3 and this operation declares exactly three.
 * ========================================================================== */

import { Faction } from '../../../core/types';
import { minutes, seconds } from '../../types';
import type { Condition, OperationDef } from '../../types';
import {
  FIELD, HEAD, HEAD_AREA, MIDDLE, RETAINER, RETAINER_AREA, ROAD,
} from '../../layouts/allies-standing-order';

/**
 * THE GEOMETRY IS IMPORTED, NOT RESTATED.
 *
 * The counter and the derrick are placed by the layout and the troops are
 * ordered at them by this file, so the two modules have to agree about six
 * points. A number written in both is a number that will disagree the first time
 * either is tuned, and the failure — a troop attack-moving at empty ground, a
 * reveal framing nothing — is invisible to every gate.
 * `layouts/allies-standing-order.ts` owns the geometry; the dependency runs
 * operation -> layout and never back.
 */

/** What the Works are owed, and what the objective reads. */
const RATE = 12_000;

/** When the pay chest reaches the bank. See the cliff table in the header. */
const CHEST_AT = seconds(9);

/**
 * The guard on a build that failed AND on the chest not having landed yet.
 *
 * Strictly greater than `CHEST_AT`, and that is load-bearing rather than
 * decorative: before the grant the player holds 5 000 against a 12 000 line, so
 * a shorter guard fails `whole` in the first second of every playthrough.
 */
const SETTLE = seconds(30);

/** The afternoon call. Open only with the retainer off the salvage house. */
const EARLY = minutes(14);

/** Six o'clock. `parSec` 1200 to the second — see the note on `parSec`. */
const SEND = minutes(20);

/**
 * The arrears are whole.
 *
 * ONE OBJECT, READ IN THREE PLACES, and that is what makes the win, the loss and
 * the discipline secondary agree by construction rather than by three authors
 * typing the same figure. `t.short` and `t.drawn` both negate THIS, never a
 * `max` twin: `PlayerState.credits` is a float, so `min` and `max` are not
 * complements and a balance between them would satisfy neither.
 */
const SOLVENT: Condition = { on: 'credits', player: 0, min: RATE };

/**
 * The counter is ours.
 *
 * `ownerCount` rather than `unitsInArea`, and rather than `structureCaptured`.
 * The first is the cut recorded in the header. The second reads
 * `ownerOfTag(tag) === player` and is a LATCH in practice for A7's purposes but
 * a live read here — it would answer the same thing this does, and this spelling
 * is the one that says what it means: a building, owned by seat 0, right now.
 * It is also tick-one safe by construction, because `min` on an empty tag set is
 * false where `max` would be true.
 */
const HOLDING_THE_COUNTER: Condition = {
  on: 'ownerCount', player: 0, role: 'building', tag: 'head', min: 1,
};

/** Both halves of the win, in one object so the loss can negate exactly it. */
const ON_THE_COUNTER: Condition = { on: 'all', of: [SOLVENT, HOLDING_THE_COUNTER] };

/**
 * The clerk is taking bookings.
 *
 * Six o'clock always; the afternoon call as well, but only once the salvage
 * house's retainer is off the wire — `objectiveComplete` rather than a live
 * count, because the reward is for having done it and must not be withdrawn if
 * the Reclamation rebuild a derrick they cannot rebuild.
 */
const THE_CALL: Condition = {
  on: 'any',
  of: [
    {
      on: 'all',
      of: [
        { on: 'elapsed', ticks: EARLY },
        { on: 'objectiveComplete', id: 'retainer' },
      ],
    },
    { on: 'elapsed', ticks: SEND },
  ],
};

const op: OperationDef = {
  id: 'allies.08.standing-order',
  chapter: 'allies',
  faction: Faction.Allies,
  /*
   * THE RECLAMATION, FOR THE SECOND TIME IN THIS CHAPTER, AND CREGG IS THE
   * REASON RATHER THAN THE ARMY.
   *
   * `allies.06.machine-time` introduced him: the man who *"sells current by the
   * hour to anybody with an account"*, whose closing position was that the Ninth
   * *"pays for outcomes"*. An operation about who is PAYING for a distribution
   * channel wants the one party on the continent whose whole character is that
   * everything has a price and none of it is personal — and it wants an
   * antagonist whose interest is served by the schedule staying exactly as it
   * is, because every refinery sited from the old one is a customer.
   *
   * IT IS ALSO THE CHAPTER'S ARGUMENT ARRIVING FROM ITS LAST UNUSED DIRECTION.
   * A2, A4 and A5 are fought against an administration defending a number it
   * knows is wrong. A3 and A7 are fought against an army whose own reading is
   * BETTER than ours. This one is fought against somebody with no opinion about
   * the number at all, which is the coldest of the three and the only one that
   * could not have been staged earlier.
   *
   * The Ninth is still upstream of it — Bramm named them as the ones who can
   * walk in on Monday, and they are who is paying Cregg to keep the arc's
   * standing block occupied — but they are not on this ground, exactly as A6
   * arranged it. Honouring `pact.05.open-count` costs nothing here: the Order
   * hold a corroborated count they cannot PRESENT, and this operation is about
   * buying the means of presentation, so the two agree without either being
   * restated.
   *
   * It pins the mechanics too. Every wave spawns literal `rclPicker`,
   * `rclGrinder` and `rclSlagger`, which `validateCampaign` refuses on any seat
   * that is not Reclamation; the layout's `pillbox` resolves through
   * `ScenarioBuilder.keyFor` to the **Spitpost**, whose `postCoil` has 20 m of
   * reach and `power: 0`, so the stand table in the layout header and the
   * absence of any power-cut route are both statements about the Reclamation
   * column of that table. On a Meridian seat the same key is a Glaive Post at
   * 24 m with `needsPower`, and neither claim survives.
   */
  foe: Faction.Reclaim,
  index: 8,
  title: 'Standing Order',
  beat: 'A slip lodged at a counter lasts one evening; a standing amendment lasts a year and is '
    + 'only entered over the Works\' own signature — and nobody has paid the Works since the Split.',
  primaryType: 'economy',
  /*
   * BESPOKE. Objective state, a grant, spawns, orders, reveals, dialogue, an
   * announcer line and a camera move — `types.ts` defines the archetype as
   * "multiple effect kinds", and this is ten of the eleven. The one it does not
   * use is `setObjective`: nothing here is hidden, and the cut list says why.
   */
  archetype: 'bespoke',
  parSec: 1200,
  requires: ['allies.07.fair-copy'],

  map: {
    /*
     * `snow`, AND THE BIOME AGREES WITH IT — which they do NOT for
     * `arid`/`desert`, the one place the two vocabularies disagree. `getBiome`
     * answers an unknown name with a `console.warn` and TEMPERATE, so a mismatch
     * ships a different landform in silence and `reclamation.03.sold-twice` has
     * already paid for that. `MAP_PRESETS.snow` and `BiomeName` share the
     * spelling, so this pairing is the safe one and is stated rather than
     * assumed.
     *
     * CHOSEN BY SURVEY, AND THE CHAPTER'S SECOND WINTER AFTER A4. Four presets
     * (`temperate`, `arid`, `snow`, `urban`) were built headless with this
     * operation's geometry on them, at five map seeds each, and scored on four
     * things: whether all four structures take
     * their authored literal at ring zero, how much of a 24 m disc at the troop
     * road is passable, the Foot routes to the counter, and the share of the map
     * that refuses Foot at all. `snow` carries `relief` 0.50 against `cliffs`
     * 0.40 — the highest relief in `MAP_PRESETS` — which is exactly why the
     * survey was run rather than assumed, and 20 260 998 came back the cleanest
     * roll of the five on every column.
     */
    preset: 'snow',
    biome: 'snow',
    /*
     * A5 pins 20 260 935 and each operation is a week on, so the convention
     * gives 20 260 977 for this one. Five rolls were built with the finished
     * layout on them:
     *
     *     20 260 977   everything at ring zero, but the troop road is 294 of 441
     *                  samples passable — 67%, on the one point six waves are
     *                  dropped on
     *     20 260 984   everything at ring zero, road 397 of 441 — 90%
     *     20 260 991   the counter AND the derrick both slide 6 m, which walks
     *                  the whole eight-stand table; road 257/441
     *     20 260 998   **every literal taken at ring zero, road 441 of 441 to
     *                  Foot and to Track, every authored ring clear, 23.7% of
     *                  the map blocked to Foot**
     *     20 261 005   the counter and the derrick slide 6 m again; road 322/441
     *
     * FIVE IS A SMALL SWEEP AND IT IS QUOTED AS ONE. `allies.03.ground-truth`
     * sampled eleven and `allies.04.misclosure` forty. Anyone moving a point in
     * the layout should re-run it rather than assume the margin.
     *
     * Pinned by `tests/campaign-maps.spec.ts` as a terrain fingerprint: a
     * generator change that re-rolls this ground moves every distance in the
     * layout header.
     */
    mapSeed: 20_260_998,
    /*
     * THE CHAPTER'S COUNTER IS +7 AN OPERATION (7 014 through 7 049, and
     * `allies.07.fair-copy` takes 7 063 after skipping 7 056 for the pair it
     * drew), SO THE CONVENTION GIVES 7 070 — AND IT IS KEPT, FOR THE PAIR IT
     * DRAWS.
     *
     * `seatedSlots(2, 7070, null)` draws the ANTIPODAL pair at 386.16 m, and it
     * is the other diagonal from A7's. That is the shape this operation needs
     * and the reason is one number: the counter is 201.41 m from the player and
     * 203.54 m from the Reclamation in a straight line. Two point one three
     * metres of asymmetry is as near neutral ground as four authored slots can
     * produce, and an operation about a counter that belongs to nobody should be
     * fought over one nobody is nearer to.
     *
     * Change this and re-measure; do not re-read.
     */
    simSeed: 7_070,
    armies: 2,
    /*
     * `'base'`, AND IT IS THE REVERSAL A7 SETS UP. That operation is
     * `opening: 'force'` with `credits: 0` — no yard, no factory, no bank, and
     * nineteen hulls that cannot be replaced. This one hands the player
     * everything: a Construction Yard, a war factory, a barracks, a refinery and
     * two harvesters. The whole question is what they are willing to spend out
     * of what those two haulers lift, and it cannot be asked of a player with no
     * sidebar.
     */
    opening: 'base',
    /*
     * 5 000, AND IT BINDS BOTH SEATS — `Shell.applySimPostBoot` writes
     * `setup.startingCredits` into every non-Neutral slot, so this is the
     * Reclamation's opening bank as well as the player's.
     *
     * THE NUMBER IS THE FAR SIDE OF A MEASURED CLIFF, not a taste. See the
     * arithmetic block in the header: `Economy.grant` lifts the storage floor
     * only when the resulting balance is STRICTLY GREATER than `storageMax`, the
     * Allied opening base's ceiling is 15 000, and an opening bank of 3 000 puts
     * the 12 000 chest exactly ON it — after which every credit mined is wasted
     * for the whole match. 5 000 lands at 17 000 against a lifted ceiling of
     * 22 000.
     *
     * It is also low enough to be safe on the other side. CLAUDE.md names the
     * 10 000-credit default as the single measured cause of "the AI has a ready
     * base" — seven buildings and eleven troops by t+90 s having mined nothing —
     * and `allies.04.misclosure`, `allies.05.forced-closure` and
     * `allies.06.machine-time` all open at this figure.
     */
    credits: 5_000,
  },
  layout: 'allies-standing-order',

  // NEITHER SHIPPED RULE MAY END THIS. See the header: annihilation would
  // declare a win with the arrears undrawn and nobody at the counter, and
  // `assetLossDefeat` is both wider and narrower than `t.beaten` here, because
  // a captured relay block is an asset.
  outcome: { annihilationWin: false, assetLossDefeat: false, ignoreSeats: [] },

  /*
   * AN ALLOW-LIST, SO TAGGED-AND-UNLISTED IS REFUSED FOR BOTH SEATS, AND IT
   * BITES SYMMETRICALLY ON PURPOSE. Measured against a control build with the
   * roster cleared, two empty lists cost the PLAYER a `battleLab`, a
   * `prismTower` and two `ifv`, and cost the RECLAMATION an `rclCrucible`, an
   * `rclPylon` and two `rclSpitter` — 25 buildings and 8 vehicles become 23 and
   * 6 on each side.
   *
   * This is a twenty-minute fight decided by what a base can afford, so the one
   * thing it must not be decided by is which side reaches tier three first.
   * Both armies keep their entire day-one tree and neither gets a tech
   * structure, a specialist tower or a raider.
   *
   * THE PYLON IS THE LOAD-BEARING ONE. `rclPylon` reaches 28 m with
   * `chainCount` 3, and one pull is `94 x ARMOR_MATRIX[Tesla][Infantry] 1.60 x
   * COMBAT_DAMAGE.globalMul 0.80` = **120.32** — which kills a 120 hp G.I.
   * outright and kills the 90 hp engineer the secondary is bought with.
   * `Placement.withinBuildRadius` gives a finished non-builder structure
   * `PLACEMENT.adjacencyRadius` 20 m plus its own radius, so the brain could
   * found one within about 26 m of the derrick and shut all eight capture stands
   * at once, on a decision no author can see. Withheld, the longest structure
   * weapon either army can put on that ground is `postCoil` at 20 m, which is the
   * two posts the layout already placed, and its stand table stays true. **§1 of
   * `tests/campaign-emplacement-reach.spec.ts` is what would catch a Pylon**, not
   * §2 — it pins this operation's armed-enemy roster by def key and count in both
   * directions, where §2's rule (one line infantryman per pull) a Pylon passes:
   * 120.32 on the first link kills one 120 hp G.I. and 72.19 on the second kills
   * nobody.
   *
   * The rest is symmetry with teeth: no `rclHornet` on a map where the player's
   * own `aaTurret` is withheld by the same rule, and no `rclSlaghurler`, whose
   * prerequisite is the withheld Crucible.
   *
   * PROFILE-INDEPENDENT, so the ground is the same on a finished account as on a
   * fresh one — which a deny-list could not promise. `setCampaignRoster` is
   * consulted AHEAD of both the PvP suppression flag and the installed gate.
   */
  roster: { player: [], ai: [] },

  objectives: [
    /*
     * ONE PRIMARY AND TWO SECONDARIES, WHICH IS EXACTLY
     * `MAX_VISIBLE_OBJECTIVES`. The primary carries both halves of the win
     * because they resolve on the same tick and are one act — a figure and a
     * place — and splitting them would put two rows on the debrief that can
     * never disagree.
     */
    /*
     * THE TITLE NAMES THE TWO THINGS THE TRIGGER READS AND THE INSTANT IT
     * READS THEM, AND AN EARLIER DRAFT DID NEITHER. It said *"Put the year's
     * arrears ON the counter"*, which describes a TRANSFER — and there is no
     * transfer anywhere in this operation: `EffectSink` has no such effect,
     * `WorldQuery.creditsOf` reads `PlayerState.credits` live, and satisfying
     * `book` never takes a credit off the player. It also carried no clock,
     * while `Director.holds` evaluates `elapsed` as `tick - startTick >= ticks`
     * — so the win is readable at ONE instant and `t.short` fires the exact
     * negation on that same tick.
     *
     * `ObjectiveRow` is `{ id, title, kind, status }` and nothing else, so the
     * panel shows no figure and no clock: **the title is the only place the
     * player is ever told what the bar is.** "Hold" rather than "put", both
     * clauses named, and "when the counter opens" for the instant — which is
     * the afternoon call at fourteen minutes with the retainer off him, or the
     * send at twenty, and `t.afternoon` and `t.closing` say which is which.
     */
    {
      id: 'book',
      kind: 'primary',
      title: 'Hold the year\'s arrears and the block head when the counter opens',
    },
    /*
     * NO `credits` ON EITHER ROW. The derrick already pays nine hundred a
     * minute, so paying for taking it is `allies.06.machine-time`'s free
     * secondary with a bigger number on it; and `whole` resolves on the tick the
     * operation ends, which is `allies.05.forced-closure`'s objection — the
     * payout lands in a bank with no match left to spend it in.
     */
    {
      id: 'retainer',
      kind: 'secondary',
      title: 'Take the salvage house\'s retainer off the wire',
    },
    {
      id: 'whole',
      kind: 'secondary',
      title: 'Draw nothing from the Works\' chest',
    },
  ],

  triggers: [
    /* -- the brief, in five beats -----------------------------------------
     * Split across fifty seconds because the shell renders dialogue as toasts
     * and a stack of five at once is a stack nobody reads — and because
     * `Shell.campaignBeatSeq` no longer lets two lines from one speaker inside
     * six seconds eat each other, so every one of these really does appear. The
     * mechanic is in the second and third beats, in numbers this table can be
     * checked against: twelve thousand, one counter, one derrick.
     *
     * **AND THE WIN CONDITION IS IN THE FIRST AND THE TRAP IS IN THE FOURTH, ON
     * PURPOSE.** `t.afternoon` used to be the only line that stated the actual
     * bar — the figure whole AND a man of ours in the block — and its `when` is
     * `all(elapsed 14 min, objectiveComplete 'retainer')`, so a player who
     * skipped the optional derrick never heard it at all. `ObjectiveRow` carries
     * no figure and no clock, so the title and these five beats are the whole of
     * what the player is ever told. Both halves are unconditional now: the bar in
     * `t.open` at four seconds, the early-capture trap in `t.cregg` at
     * thirty-six.
     *
     * THE ONE `cameraMove` IN THIS FILE, AND IT IS THE REVEAL. `types.ts`
     * reserves it for an arrival, a loss or a reveal and forbids it as
     * punctuation; the counter is the thing the operation is about, shown once,
     * at four seconds, before the player has begun anything.
     */
    {
      id: 't.open',
      when: { on: 'elapsed', ticks: seconds(4) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Aubray',
          text: 'Lodged is not published. A slip goes down the trunk once and a clerk pastes it '
            + 'into one evening; a standing amendment is entered in the series itself and checked '
            + 'against every evening for a year — and the Works will only enter one over their own '
            + 'signature. That block head is where the signature is given, and it is given once: '
            + 'the figure whole and a man of ours standing in it on the tick the clerk calls.',
        },
        { do: 'revealArea', player: 0, area: HEAD_AREA },
        { do: 'cameraMove', at: HEAD },
      ],
    },
    /* -- the chest ---------------------------------------------------------
     * `grantCredits` AND NOT `map.credits`, AND THE SEAT IS THE WHOLE REASON.
     * `Shell.applySimPostBoot` writes the opening bank into EVERY non-Neutral
     * slot, so an opening figure large enough to be the chest would hand the
     * salvage house the same money — and CLAUDE.md names the 10 000-credit
     * default as the single measured cause of "the AI has a ready base".
     * `EffectSink.grantCredits` pays one seat.
     *
     * It also lands the money through `Economy.grant` -> `refund` ->
     * `liftFloorFor`, which is what raises the storage ceiling from 15 000 to
     * 22 000 and keeps the player's own harvesters from mining into a full silo
     * for twenty minutes. The header carries the measured table; the ordering —
     * grant at nine seconds, guards at thirty — is load-bearing.
     */
    {
      id: 't.chest',
      when: { on: 'elapsed', ticks: CHEST_AT },
      then: [
        { do: 'grantCredits', player: 0, amount: RATE },
        {
          do: 'dialogue',
          speaker: 'Aubray',
          text: 'Twelve thousand on the cart, drawn against a fund that has not paid a man since '
            + 'the Split — a year of wages for every block on the eastern arc. It is in our hands '
            + 'and it is not ours to spend. Money is not stamped, Field Marshal: nobody at that '
            + 'counter can tell you which twelve thousand you brought.',
        },
      ],
    },
    {
      id: 't.brief',
      when: { on: 'elapsed', ticks: seconds(22) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Wend',
          text: 'And this is why the standing block is theirs. The salvage house has been paying '
            + 'the line a retainer out of that derrick since the Split — nine hundred a minute, '
            + 'eleven clerks, and every one of them at his counter because of it. Two coil posts '
            + 'sat on it, close enough to shell the rig itself. Take it off them and they stop '
            + 'paying. Break both posts and we start.',
        },
        { do: 'revealArea', player: 0, area: RETAINER_AREA },
      ],
    },
    /* -- the enemy states his case ----------------------------------------
     * IN CLEAR, AND IT IS THE OPERATION'S INSTRUCTIONS. Everything the
     * Reclamation does for the next twenty minutes is ordinary — waves, a base,
     * a brain — and this line is what turns it into an argument. An antagonist
     * who explains the price is the only kind this chapter has.
     *
     * **AND IT IS THE ONLY PLACE THE EARLY-CAPTURE TRAP IS SIGNPOSTED, WHICH IT
     * WAS NOT.** Both headers claimed the operation *"says so out loud"*; it did
     * not, and this very line said the opposite — *"I would not want the chain
     * broken either"* — while `t.wave5` went on to call the counter safe on the
     * tick it attack-moved twelve hulls onto it. The mechanism is real,
     * measured, and one click away from the most intuitive play in the file:
     * `civApartments` is Gaia, `Targeting.isValidTarget` refuses only ALLIES and
     * `ScenarioBuilder.gaia` allies the Neutral slot to everybody, so while it
     * belongs to nobody nothing can acquire it; the tick one 500-credit engineer
     * takes it (`Capture.resolve`'s neutral branch, no health gate) it is an
     * 800 hp Allied building in open country, and wave five alone —
     * 4 x `grinderArc` at 17.68 dps plus 8 x `arcProd` at 11.89, all through
     * `ARMOR_MATRIX[Tesla][Concrete]` 0.60 and `globalMul` 0.80 — is 165.82 dps,
     * i.e. **4.82 seconds**, against a `t.headLost` that is an unconditional
     * loss. A trap that costs the match must be stated before the first
     * purchase, and this is the earliest beat that can carry it in the voice of
     * somebody with a reason to say it.
     */
    {
      id: 't.cregg',
      when: { on: 'elapsed', ticks: seconds(36) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Cregg, on an open channel',
          text: 'Field Marshal. I am not going to take that chest off you — I could not spend it '
            + 'at my own counter. And while that block belongs to nobody there is not a gun on '
            + 'this field that can point at it. Put an Allied roof on it and that stops being '
            + 'true, and my columns will not stop to ask me first. I am going to make you spend '
            + 'it. Everything I put on the road today is priced to cost you more to answer than '
            + 'it costs me to send. Nothing personal in it.',
        },
      ],
    },
    {
      id: 't.bramm',
      when: { on: 'elapsed', ticks: seconds(50) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Bramm, on the survey net',
          text: 'A year of being checked against, every evening, by people who have never met us. '
            + 'Twelve thousand for that, against four hundred years of somebody else\'s soundings '
            + 'we have no way to answer — it is the cheapest thing this chapter has asked you for. '
            + 'See that it does not turn into the dearest by six o\'clock.',
        },
      ],
    },

    /* -- the pressure ------------------------------------------------------
     * Unconditional and on the clock. A troop that fires only when the player is
     * elsewhere reads as the map cheating; a schedule the world keeps whatever
     * the player is doing reads as an opponent — and this opponent's schedule is
     * the point, because he is buying the player's attention rather than the
     * ground.
     *
     * LITERAL RECLAMATION KEYS. `EffectSink.spawnUnits` resolves through
     * `ProductionCatalog.byKey` and remaps nothing, unlike the layout's
     * `ScenarioBuilder.spawnUnit`; `validateCampaign` checks every key against
     * the army of the seat it lands on, so an Allied key here is a build error.
     * Every ring below — six and eight at spread 20, two through five at 12, two
     * at 8 — was checked point by point on the built world against Foot, Track
     * and Hover, at `ROAD`, and `tests/campaign-spawn-ground.spec.ts` is the
     * gate that keeps it true.
     */
    {
      id: 't.wave1',
      when: { on: 'elapsed', ticks: minutes(2) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Wend',
          text: 'First troop off their yard and onto the works road, eight of them, heading for '
            + 'the middle patch. That is not an attack on us. That is an invoice.',
        },
        { do: 'spawnUnits', player: 1, key: 'rclPicker', count: 6, at: ROAD, spread: 20, tag: 'wave1' },
        { do: 'spawnUnits', player: 1, key: 'rclGrinder', count: 2, at: ROAD, spread: 12, tag: 'wave1' },
        { do: 'orderTagged', tag: 'wave1', order: 'attackMove', at: MIDDLE },
      ],
    },
    {
      id: 't.wave2',
      when: { on: 'elapsed', ticks: minutes(5) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Wend',
          text: 'Second troop, same road, same heading. Count what answering the first one cost us '
            + 'and then look at the chest, because he is going to ask that question every three '
            + 'minutes until six.',
        },
        { do: 'spawnUnits', player: 1, key: 'rclPicker', count: 6, at: ROAD, spread: 20, tag: 'wave2' },
        { do: 'spawnUnits', player: 1, key: 'rclGrinder', count: 3, at: ROAD, spread: 12, tag: 'wave2' },
        { do: 'orderTagged', tag: 'wave2', order: 'attackMove', at: MIDDLE },
      ],
    },
    {
      id: 't.wave3',
      when: { on: 'elapsed', ticks: minutes(8) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Wend',
          text: 'Third troop, and it has turned — they are going straight past the middle at our '
            + 'own field. He is not after the ore. He is after the haulers, and a hauler is '
            + 'fourteen hundred credits, which is a fortnight of somebody\'s wages.',
        },
        { do: 'spawnUnits', player: 1, key: 'rclPicker', count: 8, at: ROAD, spread: 20, tag: 'wave3' },
        { do: 'spawnUnits', player: 1, key: 'rclGrinder', count: 3, at: ROAD, spread: 12, tag: 'wave3' },
        { do: 'orderTagged', tag: 'wave3', order: 'attackMove', at: FIELD },
      ],
    },
    {
      id: 't.wave4',
      when: { on: 'elapsed', ticks: minutes(11.5) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Wend',
          text: 'Fourth, with slag charges in it. Those are for buildings, and the only building '
            + 'they can reach on that heading is the refinery. He is charging us for a refinery.',
        },
        { do: 'spawnUnits', player: 1, key: 'rclPicker', count: 6, at: ROAD, spread: 20, tag: 'wave4' },
        { do: 'spawnUnits', player: 1, key: 'rclGrinder', count: 4, at: ROAD, spread: 12, tag: 'wave4' },
        { do: 'spawnUnits', player: 1, key: 'rclSlagger', count: 2, at: ROAD, spread: 8, tag: 'wave4' },
        { do: 'orderTagged', tag: 'wave4', order: 'attackMove', at: FIELD },
      ],
    },
    {
      id: 't.wave5',
      when: { on: 'elapsed', ticks: minutes(15) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Wend',
          text: 'Fifth troop, and the heading is the block head. He wants us standing somewhere '
            + 'else at six — and if our flag is already on that roof they will not drive past it, '
            + 'they will have it down inside five seconds.',
        },
        { do: 'spawnUnits', player: 1, key: 'rclPicker', count: 8, at: ROAD, spread: 20, tag: 'wave5' },
        { do: 'spawnUnits', player: 1, key: 'rclGrinder', count: 4, at: ROAD, spread: 12, tag: 'wave5' },
        { do: 'orderTagged', tag: 'wave5', order: 'attackMove', at: HEAD },
      ],
    },
    {
      id: 't.wave6',
      when: { on: 'elapsed', ticks: minutes(18) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Wend',
          text: 'Everything the yard has spare, on the counter, with two minutes on the books.',
        },
        { do: 'spawnUnits', player: 1, key: 'rclPicker', count: 6, at: ROAD, spread: 20, tag: 'wave6' },
        { do: 'spawnUnits', player: 1, key: 'rclGrinder', count: 5, at: ROAD, spread: 12, tag: 'wave6' },
        { do: 'orderTagged', tag: 'wave6', order: 'attackMove', at: HEAD },
      ],
    },

    /* -- the discipline row ------------------------------------------------
     * IT FAILS ON THE FIRST TICK THE BALANCE IS UNDER THE FIGURE AND NEVER
     * RECOVERS, which is the whole content of the secondary: the chest is a
     * balance rather than a seal, nobody can tell which credits were the Works',
     * and the only thing that can be measured is whether the total ever dipped.
     *
     * `not(SOLVENT)` rather than a `max` twin, for the float reason recorded at
     * `SOLVENT`. `SETTLE` is thirty seconds because the chest lands at nine and
     * the player holds 5 000 before it does.
     *
     * `insufficientFunds` IS THE SCRIPTED `eva` `types.ts` ASKS FOR: the
     * announcer says it when a purchase is REFUSED, and nothing anywhere says it
     * when a balance crosses a line somebody drew on paper. This is a beat the
     * game has no event for, which is the stated test.
     */
    {
      id: 't.drawn',
      when: {
        on: 'all',
        of: [
          { on: 'elapsed', ticks: SETTLE },
          { on: 'not', of: SOLVENT },
        ],
      },
      then: [
        { do: 'failObjective', id: 'whole' },
        { do: 'eva', line: 'insufficientFunds' },
        {
          do: 'dialogue',
          speaker: 'Cregg, on an open channel',
          text: 'You have been into the chest. I do not need to know what you bought — I only '
            + 'needed to know that you would.',
        },
        {
          do: 'dialogue',
          speaker: 'Aubray',
          text: 'Below the figure. Every credit we lift from here is a credit going back into a '
            + 'fund that is not ours, and the counter shuts at six whatever is standing on it.',
        },
      ],
    },

    /* -- the retainer ------------------------------------------------------
     * `ownerCount ... max: 0` rather than `entityDead`, and the difference is
     * capture: an engineer section that walks into the derrick satisfies this
     * exactly as levelling it does, which is what the title promises. It is four
     * engineers against 13.95 seconds of four Wardens, and only one of the two
     * can pay 900 credits a minute afterwards — and only once BOTH Spitposts are
     * down, because each of them reaches the derrick at 11.5478 m of surface
     * against 20 m of range and levels a freshly captured 360 hp rig in 18.75 s
     * alone. `t.brief` says so at twenty-two seconds; the objective does not care
     * which the player chose, and latches the tick the deed moves whatever
     * happens to the building afterwards.
     *
     * ABOVE `t.pay`, AND THE RULE IS ABOUT TICKS RATHER THAN ABOUT FILE ORDER.
     * `runDirector` returns 0 at its first statement once `state.outcome` is
     * set, so a secondary whose condition first holds on the tick AFTER the win
     * is never evaluated again and the medal never counts it. Within ONE tick
     * file order does not decide objectives at all — `Session.simTick` collects
     * every effect and then applies all of them in order with no early exit —
     * which is why the only thing file order settles here is which
     * `endOperation` lands first, and `Session.end` refuses the second.
     * (`allies.07.fair-copy` states this as an early return inside the walk. It
     * is not one: the guard is at the top of `runDirector`, and the apply loop
     * in `campaign-install.ts` runs to completion.)
     */
    {
      id: 't.retainerTaken',
      when: {
        on: 'all',
        of: [
          { on: 'elapsed', ticks: SETTLE },
          { on: 'ownerCount', player: 1, role: 'building', tag: 'retainer', max: 0 },
        ],
      },
      then: [
        { do: 'completeObjective', id: 'retainer' },
        {
          do: 'dialogue',
          speaker: 'Cregg, on an open channel',
          text: 'My derrick is off my books. That is nine hundred a minute I am not paying eleven '
            + 'relay clerks, and they will notice it this evening rather than next quarter.',
        },
        {
          do: 'dialogue',
          speaker: 'Aubray',
          text: 'Then there is nothing else standing at the head, and the clerk will make the '
            + 'circular up at the afternoon call instead of waiting for six. Bring him the figure '
            + 'and a man and he will book it early.',
        },
      ],
    },
    /* -- and the answer ----------------------------------------------------
     * KEYED TO THE PLAYER RATHER THAN TO THE CLOCK, so the hinge sits in the
     * same place for a fast commander and a careful one — the shape
     * `soviets.02.common-standard` and `reclamation.02.written-off` both use.
     *
     * `objectiveComplete` is read against the state the Director sees at the
     * START of the tick and `completeObjective` is applied by the sink after
     * every trigger has been evaluated, so this fires one tick after the taking
     * it answers. That is the correct ordering and not a race.
     */
    {
      id: 't.watch',
      when: { on: 'objectiveComplete', id: 'retainer' },
      then: [
        {
          do: 'dialogue',
          speaker: 'Cregg, on an open channel',
          text: 'He is paying my line\'s wages out of my own derrick. Put a troop on it. I would '
            + 'rather have it back, and failing that I would rather it was flat.',
        },
        { do: 'spawnUnits', player: 1, key: 'rclPicker', count: 6, at: ROAD, spread: 20, tag: 'watch' },
        { do: 'spawnUnits', player: 1, key: 'rclGrinder', count: 3, at: ROAD, spread: 12, tag: 'watch' },
        { do: 'orderTagged', tag: 'watch', order: 'attackMove', at: RETAINER },
      ],
    },

    /* -- the two calls, telegraphed --------------------------------------- */
    {
      id: 't.afternoon',
      when: {
        on: 'all',
        of: [
          { on: 'elapsed', ticks: EARLY },
          { on: 'objectiveComplete', id: 'retainer' },
        ],
      },
      then: [
        {
          do: 'dialogue',
          speaker: 'Aubray',
          text: 'Afternoon call. The counter is open early and it will not close again until six — '
            + 'the figure whole and a man of ours standing in the block head, and he enters it.',
        },
      ],
    },
    {
      id: 't.closing',
      when: { on: 'elapsed', ticks: minutes(19) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Aubray',
          text: 'One minute. Whatever is on that counter at six goes into the standing series and '
            + 'gets checked against for a year, and everything that is not on it is an argument we '
            + 'get to have again next spring.',
        },
      ],
    },

    /* -- paid --------------------------------------------------------------
     * ABOVE THE THREE LOSSES, AND THE ORDERING IS REAL HERE RATHER THAN
     * DECORATIVE. `t.pay` and `t.short` are exact complements at tick `SEND` and
     * cannot both fire; `t.headLost` cannot fire on a tick `t.pay` fires,
     * because `t.pay` requires the block STANDING and OURS. `t.beaten` is the
     * one that could genuinely coincide — a commander whose last hull dies on
     * the winning tick — and file order is what decides it, in the player's
     * favour, deliberately. The mechanism is exact: `Session.simTick` applies
     * every effect the whole table collected, in order, and `Session.end`
     * refuses a second outcome (`if (this.state.outcome !== null) return`), so
     * the FIRST `endOperation` in the list is the one that lands.
     *
     * `completeObjective` on `whole` is a no-op if `t.drawn` already failed it:
     * `CampaignSession.setObjective` refuses to un-resolve a resolved row. That
     * is the shape the discipline secondary rests on and it is checked rather
     * than assumed.
     *
     * AND IT DOES NOT CLOSE THE CHAPTER. Bramm's second line is the hinge into
     * the ninth: the books now carry our number and not one refinery on the
     * continent has moved a metre.
     */
    {
      id: 't.pay',
      when: { on: 'all', of: [THE_CALL, ON_THE_COUNTER] },
      then: [
        { do: 'completeObjective', id: 'book' },
        { do: 'completeObjective', id: 'whole' },
        {
          do: 'dialogue',
          speaker: 'Aubray',
          text: 'Counted, signed and entered — standing, over the Works\' own hand, on the series '
            + 'itself. Every siting office on the continent opens its book tomorrow to our number '
            + 'and goes on opening it, and the misclosure is printed underneath where anybody can '
            + 'check the working.',
        },
        {
          do: 'dialogue',
          speaker: 'Bramm, on the survey net',
          text: 'It is on the books. Now go and look at where the books put the refineries, Field '
            + 'Marshal, because not one of them has moved a metre. We have spent seven operations '
            + 'proving a number and the ground has not read a word of it.',
        },
        { do: 'endOperation', result: 'win' },
      ],
    },

    /* -- six o'clock -------------------------------------------------------
     * The hard deadline, at `parSec` to the second, and the exact negation of
     * the win. It fails all three rows: nothing more can be done and a resolved
     * row does not un-resolve, so a secondary already earned keeps its tick.
     *
     * ONE LINE FOR TWO FAILURES, because the trigger cannot know which clause
     * missed and the clerk does not care either.
     */
    {
      id: 't.short',
      when: {
        on: 'all',
        of: [
          { on: 'elapsed', ticks: SEND },
          { on: 'not', of: ON_THE_COUNTER },
        ],
      },
      then: [
        { do: 'failObjective', id: 'book' },
        { do: 'failObjective', id: 'retainer' },
        { do: 'failObjective', id: 'whole' },
        {
          do: 'dialogue',
          speaker: 'Aubray',
          text: 'Six o\'clock, and the counter is shut. We were short of the figure or short of a '
            + 'man to hand it over and the clerk does not care which — the Works enter nothing '
            + 'over a signature they have not been given. One evening\'s slip is all we ever had, '
            + 'and it will be pasted over by Friday.',
        },
        { do: 'endOperation', result: 'loss', reason: 'book' },
      ],
    },

    /* -- the counter, levelled --------------------------------------------
     * A LIVE HAZARD FROM ORDINARY COMBAT AND NOT A GUARD ON THE PLAYER'S OWN
     * TRIGGER FINGER. While the block is Gaia's no gun can acquire it —
     * `Targeting.isValidTarget` refuses only ALLIES and `ScenarioBuilder.gaia`
     * allies the Neutral slot to everybody — but `Damage.applySplash` filters
     * victims on `Alive | PendingDestroy | Garrisoned` and NOTHING ELSE, so
     * every splash weapon on this map reaches it at
     * `COMBAT_DAMAGE.friendlyFireMul` 0.5, the player's own tank guns included.
     * The moment it is captured it is an ordinary Allied building and five
     * Grinders level it in 9.05 seconds — and `t.wave5`, four Grinders and eight
     * Pickers, is 165.82 dps against 800 hp, which is 4.82 seconds. The layout
     * header carries the per-shell arithmetic and the catchment.
     *
     * **THAT IS WHY `t.cregg` NAMES THE MECHANISM AND `t.wave5` NAMES THE
     * CONSEQUENCE.** An unconditional defeat trigger reachable by the most
     * intuitive opening in the operation — one engineer, at any health, on a
     * Gaia building — has to be stated to the player before the first purchase,
     * and for one draft it was stated in two headers and in no beat at all.
     *
     * It is authored because the alternative is an operation that becomes
     * unwinnable in silence and runs to twenty minutes anyway, which is the
     * failure `t.infirmaryLost` in `soviets.06.demolition-order` argues against.
     * There is no `not(objectiveComplete)` clause on it and there does not need
     * to be: the operation ends on the tick `book` completes, and `t.pay` above
     * requires the block alive and owned, so the two cannot both hold.
     *
     * `SETTLE` is what stops it firing on tick one against a build that placed
     * nothing — `entityDead` reads TRUE before the layout has stamped the tag.
     * The real gate on that failure is `tests/campaign-roster-ground.spec.ts`,
     * which builds this operation with the roster armed AND the def tables
     * bound, the only state in which a refused structure is visible at all.
     */
    {
      id: 't.headLost',
      when: {
        on: 'all',
        of: [
          { on: 'elapsed', ticks: SETTLE },
          { on: 'entityDead', tag: 'head' },
        ],
      },
      then: [
        { do: 'failObjective', id: 'book' },
        { do: 'failObjective', id: 'whole' },
        {
          do: 'dialogue',
          speaker: 'Aubray',
          text: 'The block head is rubble. There is no second counter this side of the mills and '
            + 'no army in the field builds relay houses — ours or theirs, whoever put the shell '
            + 'through it. The chest goes home full and the amendment goes nowhere.',
        },
        { do: 'endOperation', result: 'loss', reason: 'book' },
      ],
    },

    /* -- the ordinary loss --------------------------------------------------
     * TWO `ownerCount` READS RATHER THAN `playerBeaten`, and
     * `allies.07.fair-copy` is the reason: `Viability.surveyViability` §HELD
     * books a `Garrisoned` occupant into `heldUnits` rather than
     * `contestingUnits`, and this operation's ground clause is satisfied by
     * putting men INSIDE a building. A7 staged that on a real world and ended a
     * match with the men alive, unhurt and standing on the objective. The
     * untagged branch of `runtime.ts#ownerCount` walks `store.alive`, filters
     * `PendingDestroy` and `UnderConstruction` and asks nothing about
     * `Garrisoned`, so a man indoors still counts here.
     *
     * A BARE `max: 0` IS THE TICK-ONE TRAP ONLY ON THE TAGGED BRANCH. These are
     * untagged and read the real alive list, so the first answers twelve on tick
     * one and the second is non-zero for as long as a Construction Yard, a war
     * factory or a barracks stands; `SETTLE` is still conjoined because a build
     * that placed NOTHING
     * would answer zero, and that failure has to be reported by
     * `tests/campaign-roster-ground.spec.ts` rather than by a silent defeat.
     */
    {
      id: 't.beaten',
      when: {
        on: 'all',
        of: [
          { on: 'elapsed', ticks: SETTLE },
          { on: 'ownerCount', player: 0, role: 'unit', max: 0 },
          { on: 'ownerCount', player: 0, role: 'producer', max: 0 },
        ],
      },
      then: [
        { do: 'failObjective', id: 'book' },
        { do: 'failObjective', id: 'whole' },
        {
          do: 'dialogue',
          speaker: 'Wend',
          text: 'Nothing answering anywhere on the seam and nothing left to build with. The chest '
            + 'is a box in a field.',
        },
        { do: 'endOperation', result: 'loss', reason: 'book' },
      ],
    },
  ],
};

export default op;
