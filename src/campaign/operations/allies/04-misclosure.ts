/**
 * ============================================================================
 * A4 — MISCLOSURE
 * ============================================================================
 * A levelling loop that does not close is out by its MISCLOSURE, and the
 * correction is spread back along the line. Ilse Bramm has closed Survey 14-090
 * and is reducing the whole eastern arc against it, in a Works office standing
 * on the seam a hundred metres outside the player's wire. The loop is out by
 * more than the schedule can absorb. The Soviets have read the same traffic and
 * are coming to put the office through the wall before the number is filed.
 *
 * A1 took the first reading. A2 recovered eleven years of field returns. A3
 * reached the woman who had the only complete rate series, and `requires` means
 * that happened — she is in the room. This is the operation where Aubray, who
 * has said *"That matches"* at the end of all three, gets a number that does
 * not.
 *
 * ============================================================================
 * WHAT MAKES THIS A DEFEND AND NOT A COUNTDOWN WITH SCENERY
 * ============================================================================
 * The primary is one building surviving sixteen minutes, and on its own that is
 * a clock. Two authored decisions sit on top of it and both are priced in
 * measured metres:
 *
 *   - **THE MUSTER.** Every scripted column forms at a Soviet forward barracks
 *     117.34 m from their Construction Yard, and the last two columns are gated
 *     on it still being THEIRS. Taking it off them deletes those two outright —
 *     7 400 credits of the 12 800 of hull this operation spends against the
 *     player, 57.8%.
 *     **THE TRAVEL IS MEASURED AND THE FIGHT IS NOT.** It stands 273.72 m from
 *     the player's yard, which is 284.3 m of Track route and **86.2 s of pure
 *     driving there and back at a Warden's 6.6 m/s**; what that buys into is
 *     800 hp of barracks behind two 480-hp Sentry Guns plus whatever the
 *     district sends back. No harness in this repo can put a number on that —
 *     `campaign-maps` builds the ground and does not fight on it — so the
 *     deadline the raid has to beat, minute ten, is authored with the slack
 *     deliberately on the generous side.
 *   - **THE PROVISIONAL.** From minute eight the player may walk an engineer or
 *     a section into the transmitter block 60.96 m behind their own yard and
 *     file what the office has so far. That WINS the operation, immediately,
 *     and fails the secondary that says otherwise. It is a real way out of a
 *     match that has gone wrong, it costs the medal, and it is the thing the
 *     chapter has spent three operations arguing against: a number nobody
 *     closed.
 *
 * **NEITHER SECONDARY EXCLUDES THE OTHER, AND THAT IS CHECKED RATHER THAN
 * HOPED.** `medalFor` awards silver only for a win with EVERY secondary
 * complete, so two secondaries that compete for the same minutes would be a
 * medal nobody can earn — `allies.03.ground-truth` refused a second secondary
 * for exactly that reason and paid its find in credits instead. These two point
 * the same way: taking the muster off them is how a player AFFORDS the last four
 * minutes, and the provisional is what a player takes when they did not.
 *
 * ============================================================================
 * HOW THIS DIFFERS FROM `soviets.05.short-allocation`, THE OTHER `defend`
 * ============================================================================
 * S5 is three income structures on one lane, two required, and the loss is
 * immediate on the second one falling. Its header records why it carries no
 * `elapsedSinceArmed`: a count that only ever falls turns a hold timer into a
 * clock that stops forever the first time the player is hurt.
 *
 * A4 keeps that lesson — there is no hold timer in this file either — and
 * changes the two terms S5 holds fixed:
 *
 *   - **ONE THING, NOT THREE.** S5's fork is which two of three positions you
 *     stand on. Here there is nothing to choose between: the office is the only
 *     objective and it is 103.32 m from the yard. The fork is what you do with
 *     the army that is NOT standing on it.
 *   - **THE PLAYER CAN ELECT TO END IT, AND IT COSTS THEM.** A player who is
 *     losing has a lever here: file the provisional and take a bronze. S5 has an
 *     early-out too — `CLOSE`'s second arm ends the shift the moment the Ninth is
 *     beaten — but that is winning HARDER and it costs nothing. Checked across
 *     the thirteen shipped operations: **not one `endOperation: 'win'` trigger
 *     carries a `failObjective` beside it**, so this is the first win in the
 *     campaign a player buys by giving something up. The whole tension of a
 *     defend is *how long can I hold*, and an authored way to stop asking is a
 *     real answer to it rather than a mercy.
 *
 * S5's raid is a hidden secondary that takes the opponent's INCOME. This one is
 * disclosed in the briefing and takes the opponent's SCHEDULE, because the
 * decision has a deadline — minute ten — and a decision the player cannot see
 * until minute five is a decision they cannot plan.
 *
 * ============================================================================
 * WHAT ENDS THE MATCH, IN BOTH DIRECTIONS
 * ============================================================================
 * Both shipped outcome rules are off, so all four routes are authored here:
 *
 *     t.close        elapsed >= 16:00  AND  entityAlive 'office'      WIN
 *     t.provisional  elapsed >= 8:00  AND  NOT elapsed >= 16:00
 *                    AND entityAlive 'office'
 *                    AND structureCaptured 'mast' by seat 0           WIN
 *     t.razed        elapsed >= 20 s  AND  entityDead 'office'        LOSS
 *     t.beaten       elapsed >= 20 s  AND  playerBeaten seat 0        LOSS
 *                    AND  no living unit on seat 0  (see the trigger)
 *
 * **THE MATCH CANNOT RUN PAST 16:00 AND CANNOT HANG.** `entityAlive` is
 * `aliveWithTag(tag) > 0` and `entityDead` is `=== 0`, so they are exact
 * complements: at tick 16:00 exactly one of `t.close` and `t.razed` holds, and
 * `t.razed` has been able to fire on every tick since 0:20. There is no third
 * state.
 *
 * `annihilationWin` is off because flattening the Soviet base does not close a
 * loop, and because `Shell.pollOutcome` would hand the player a victory at
 * minute nine with seven minutes of arithmetic still to run — the first of the
 * four failures `policy.ts` enumerates. `assetLossDefeat` is off because a
 * defend whose only authored loss is the shipped one is an operation whose
 * ending is not in its own file, and `t.razed` — the office down — is the loss
 * this operation is about. `t.beaten` sits beside it and reads
 * `Viability.isBeaten` — nothing to build with AND nothing to fight with.
 *
 * ============================================================================
 * WHAT THIS BLOCK USED TO SAY ABOUT THAT, WHICH WAS WRONG IN BOTH DIRECTIONS
 * ============================================================================
 * It read: *"`assetLossDefeat` is off because the most interesting last act this
 * operation has is a commander whose base is gone and whose office is still
 * standing with five riflemen in it; the shipped rule would end that at 2 Hz.
 * `t.beaten` is the honest replacement."* Measured against the two consumers,
 * both halves are false and they are false in opposite directions:
 *
 *   - **THE SHIPPED RULE WOULD NOT HAVE ENDED IT.** `Shell.pollOutcome` reads
 *     `countLivingAssets`, which counts Buildings, Vehicles and Infantry, and
 *     declares defeat only at ZERO of them for the local seat. A standing
 *     player-owned office is one, so that branch is unreachable while the
 *     operation's own primary is alive — the method returns at the
 *     `alive > 0` fork. (The OTHER shipped route, `outcome.system.ts`'s
 *     `Viability` poll, is switched off for every armed operation by
 *     `scriptedRunning()` regardless of this flag, so `assetLossDefeat` gates
 *     `Shell.pollOutcome` and nothing else.)
 *   - **`t.beaten` DOES END IT.** `surveyViability` §HELD files anything
 *     carrying `EntityFlag.Garrisoned` into `heldUnits` and NOT into
 *     `contestingUnits`, deliberately and with a header saying why: *"A garrison
 *     is an emplacement whose firepower happens to be stored in five entities."*
 *     So a commander with no producers, no construction vehicle and nothing on
 *     the field but five men indoors has `canRebuild` false and `canContest`
 *     false — `isBeaten` is TRUE and `t.beaten` ends the operation in defeat on
 *     the next Director tick.
 *
 * **THE LAST ACT THE PROSE WANTED IS THE EXACT CASE §HELD EXISTS TO CLOSE**, so
 * it cannot be had by turning a flag off; it needs `t.beaten` to ask a different
 * question. The frozen vocabulary can express one:
 * `all: [playerBeaten 0, ownerCount player 0 role 'unit' max 0]` — because
 * `WorldQuery.ownerCount` walks `store.alive` and filters only `PendingDestroy`
 * and `UnderConstruction`, so a garrisoned rifleman IS counted there while
 * `contestingUnits` refuses him. That is a design decision and it is left to the
 * author. What is fixed here is the claim, not the trigger — the behaviour is
 * defensible on its own terms (a commander with no army and no production has
 * lost), it is merely not the behaviour this file said it had.
 *
 * **THE 20-SECOND SETTLE IS NOT PROTECTING AGAINST A RACE.** The world is
 * finished before tick one, so on a correct build neither loss can hold at 0:00.
 * What it guards is the build that FAILED: `entityDead` reads TRUE before a tag
 * has ever existed, so an office that `spawnBuilding` refused would end the
 * operation in defeat on tick one, in silence, before a word of the briefing had
 * played. **`t.musterDown` is the third consumer and it arrived with the
 * ownership migration**: `ownerCount(..., max: 0)` reads TRUE against an empty
 * tag registry for exactly the same reason, so an unplaced muster would complete
 * a 500-credit secondary on tick one rather than end the match on it. One
 * constant, three triggers, one failure mode.
 * `soviets.05.short-allocation` guards its own thresholds the same way
 * and for the same reason. The real gate on that failure is
 * `campaign-maps.spec.ts`, which builds this operation headless and refuses a
 * declared tag that landed on nothing; the settle only makes the symptom legible
 * if it ever gets past.
 *
 * ============================================================================
 * TRIGGER ORDER, STATED CORRECTLY
 * ============================================================================
 * `runDirector` evaluates EVERY trigger and appends every firing trigger's
 * effects BEFORE the sink applies any of them, so on a tick where two triggers
 * hold, both contribute. File order then decides two things and only two:
 *
 *   - **which `endOperation` counts**, because `CampaignSession.end` returns
 *     early once an outcome is set. `t.close` therefore sits ABOVE
 *     `t.provisional`, so a player holding the transmitter at 16:00 gets the
 *     closed reduction rather than the provisional they never sent;
 *   - **which of two conflicting objective writes lands**, because
 *     `CampaignSession.setObjective` refuses to un-resolve a resolved row. So
 *     `t.musterDown` sits above `t.musterStanding`, and `t.close`'s
 *     `completeObjective('closed')` sits above `t.provisional`'s
 *     `failObjective('closed')`.
 *
 * `t.provisional` also carries `not elapsed(CLOSE)` as an upper bound, which is
 * legal where `elapsedSinceArmed` under a `not` is not: `elapsed` is a pure
 * function of the tick, so negating it is a window rather than a trigger that can
 * never arm. Without it, a player holding the transmitter at 16:00 would get the
 * right ENDING and both endings' dialogue, four toasts deep.
 *
 * ============================================================================
 * THE COLUMNS, AND WHAT TAKING THE MUSTER IS ACTUALLY WORTH
 * ============================================================================
 * Four columns, all forming at `ROAD` — 44.18 m outside the muster, 141.8 m of
 * Track route from the office. An Anvil covers that in 26.3 s at 5.4 m/s and a
 * Conscript in 41.7 s at 3.4, so a column arrives spread rather than as a fist.
 *
 *     3:00    4 Conscripts, 2 Anvils    2 200 credits   unconditional
 *     6:30    5 Conscripts, 3 Anvils    3 200           unconditional
 *     10:00   5 Conscripts, 3 Anvils    3 200           only while it is theirs
 *     13:30   6 Conscripts, 4 Anvils    4 200           only while it is theirs
 *
 * 12 800 credits of hull if the muster stays theirs, against `soviets.05`'s
 * 13 100 over seventeen minutes — the same band, weighted toward armour because
 * `conscript` is 100 credits to a `gi`'s 200 and `rhino` is 900 to a `grizzly`'s
 * 700. **RE-DERIVED off the bound def tables on the built world when the gate
 * moved to ownership, rather than carried forward: 2 200 / 3 200 / 3 200 /
 * 4 200, total 12 800, gated 7 400 = 57.8%.** The migration below changes WHEN
 * the last two are withheld and not what they cost.
 *
 * **THE GATE IS MONOTONE, AND THAT IS THE WHOLE REASON THE FORK IS SAFE.** A
 * one-shot trigger reading a monotone gate either fires at its own minute or can
 * never fire at all. The obvious alternative — two triggers per column, one for
 * each state — has a hole a designer cannot see: the false-arm's condition stays
 * satisfiable for the rest of the match, so taking the muster at 14:00 would
 * summon the column that was already sent at 13:30. One monotone gate, no
 * window, no bound to tune.
 *
 * **BUT THE GATE IS `ownerCount` NOW, AND MONOTONICITY IS NO LONGER FREE.**
 * Death is one-way by construction; a deed is not. See the next section for the
 * migration and for the premise that keeps this paragraph true.
 *
 * **AND THE COLUMNS ARE A FLOOR ON THE PRESSURE RATHER THAN THE WHOLE OF IT.**
 * `AiBrain` has a base, a 5 000 bank, sixteen minutes of income and a brain;
 * `orderTagged ... attackMove` is a heading and not a leash, because
 * `AiBrain.census` files EVERY non-harvester, non-naval hull the seat owns into
 * `armyIds` and `regroupSquads` re-files that into the strike group on its next
 * pass. This said "every UNTAGGED hull", which reads as though `tag: 'col1'`
 * bought the column an exemption. It does not: a campaign tag lives in
 * `TagRegistry` and the brain has never heard of it — the only tags `AI.ts`
 * honours are its own `GROUP_*` state — which is exactly the finding the layout
 * header records for a PARKED hull on an objective, one file away. Read the four
 * columns as the district being stronger at 3:00, 6:30,
 * 10:00 and 13:30 than it could otherwise have been. Taking the muster also
 * costs them a PRODUCER — `AiBrain.census` counts it and the infantry queue runs
 * slower without it — which is a consequence this table never mentions and does
 * not have to.
 *
 * ============================================================================
 * THE MUSTER IS READ BY OWNERSHIP, NOT BY LIFE, AND ALL THREE READS MOVED AT
 * ONCE
 * ============================================================================
 * `Director.holds` answers `entityAlive` with `aliveWithTag(tag) > 0` and
 * `entityDead` with `=== 0`, and **a captured building is still alive**. Seat 0
 * has an `engineer` standing at tick zero and stands both of its prereqs
 * (`barracks` + `refinery`), so the capture ladder is available for the whole
 * sixteen minutes. Read through liveness — which is how this file shipped — a
 * player who took the muster with engineers got a position nobody can defend:
 *
 *   - `t.musterDown` never fired, so the 500-credit secondary was UNREACHABLE;
 *   - `t.musterStanding` affirmatively FAILED it at 16:00;
 *   - and `t.col3` and `t.col4` went on spawning Soviet columns off a barracks
 *     ON THE PLAYER'S OWN BOOKS, with Wend saying "The muster is still forming
 *     them".
 *
 * The third is indefensible under any reading of the secondary, so the two
 * column gates had to move whatever was decided about the objective. All three
 * reads are `ownerCount(1, 'building', 'muster', ...)` now — `min: 1` for the
 * gates, `max: 0` for the payment — which is `soviets.06.demolition-order`'s
 * shape and its `t.spurMissed` argument almost word for word.
 *
 * **THE OBJECTIVE MOVED WITH THEM, AND THAT IS THE AUTHORING DECISION.** A
 * MIXED reading — columns on ownership, secondary on life — hands the player who
 * captures the muster a stopped column flow AND a failed objective at 16:00: the
 * operation would reward the play in the world and punish it on the debrief,
 * which is worse than either pure reading. So the row means *the Soviets no
 * longer hold the ridge* and the title says so rather than saying "Level". That
 * WIDENS what the secondary accepts, and the widening is the honest reading of
 * the operation's own claim: the briefing says every column they send today
 * forms there, and a barracks they do not own forms nothing for them.
 *
 * **WHY NOT `captureProof`, WHICH ELEVEN OPERATIONS DECLARE.** `types.ts` gives
 * the case that field exists for: a structure the player was told to PROTECT,
 * where migrating to `ownerCount` makes a LOSS reachable by capture — defeat on
 * the tick the player took the thing into protective custody. The muster is the
 * opposite of that, an enemy structure the operation PAYS to have removed, so
 * there is no loss to open; and refusing an engineer at an enemy forward
 * barracks would forbid an ordinary play for no reason this fiction can give.
 * The price ordering closes the rest: capture is not a cheap shortcut to the
 * secondary, it is the expensive route to the same place.
 *
 *     the four-engineer ladder   `Capture.resolve` softens an ENEMY structure by
 *                                `maxHp * CAPTURE.softenFrac` (0.25) through
 *                                `ARMOR_MATRIX[HighExplosive][Concrete]` (1.00)
 *                                and `COMBAT_DAMAGE.globalMul` (0.80) = 0.20 of
 *                                max per engineer, against a `captureHpFrac`
 *                                gate of 0.50. The muster is 800 hp of
 *                                `barracks`, so 1.00 -> 0.80 -> 0.60 -> 0.40 and
 *                                the fourth man takes it: 4 x 500 = **2 000
 *                                credits, 40% of the opening bank**.
 *     the same road, slower      Measured on the built world, the 8-connected
 *                                walk from the player's yard to the muster is
 *                                the SAME length for `Locomotor.Foot` as for
 *                                `Locomotor.Track` — the engineer has no
 *                                shortcut the tanks do not — and he covers it at
 *                                3.4 m/s against a Warden's 6.6.
 *     and the guns come first    Both Sentry Guns stand 22.80 m from the muster
 *                                carrying `pillboxMg` at 22 m, so an engineer at
 *                                the barracks wall is inside both arcs. 5 x 13
 *                                over a 0.79 s cycle through
 *                                `ARMOR_MATRIX[SmallArms][Infantry]` (1.00) and
 *                                `globalMul` is 65.8 dps against a 90 hp
 *                                engineer: **1.37 s under one gun, 0.68 s under
 *                                both**. The raid has to happen either way.
 *
 * So the capture costs the whole raid PLUS 2 000 credits, and buys the same
 * secondary and the same two deleted columns. What it buys ON TOP is a
 * `barracks` on the player's own seat — `ProductionService.census` counts it, so
 * their Infantry queue picks up `FACTORY_SPEED_BONUS` while it stands — and the
 * moment it is theirs it is an Allied building alone in a Soviet district that
 * every gun they own may shoot. A prize with a short life, not a second base.
 *
 * **AND MONOTONICITY NOW RESTS ON A PREMISE `entityAlive` DID NOT NEED.** The
 * two gated columns are safe only because seat 1 can never take the muster
 * BACK. It cannot: `AiBrain` issues no `OrderKind.Capture` anywhere in
 * `src/sim/AI.ts` — CLAUDE.md's capability audit, and the layout's own header
 * re-derives it for the parked-hull question — and `GarrisonService.refusalFor`
 * answers `'hostile'` for any structure the entrant is not allied to, so no
 * conscript can walk it back either. **If the brain ever learns the verb, this
 * paragraph is one of the things that breaks**, which is the same exclusion
 * `tests/campaign-capture-blind.spec.ts` names as the first thing to delete on
 * that day.
 *
 * ============================================================================
 * THE ROSTER IS EMPTY ON BOTH SIDES, AND THE ARGUMENT IS THE FORK
 * ============================================================================
 * `roster` is an ALLOW-LIST over tagged content, so two empty lists withhold
 * every `UNLOCK_TAGS` def from both seats. Measured against a control build with
 * the roster cleared, that is exactly:
 *
 *     the player loses   2 Sabre IFVs, a Proving Ground and a Refractor Tower
 *     the Soviets lose   1 Sledge Tank, 2 Attack Dogs, a Proving Ground
 *                        and THREE Tesla Coils
 *
 * The Soviet half is the load-bearing one. `teslaCoil` is
 * `struct.defence.specialist` and reaches 30 m; granted, the brain could raise
 * one beside the muster — which is inside its own build radius, because the
 * muster is a structure they own — and wall off the fork this operation is made
 * of, on a decision no author can see. Withheld, the longest structure weapon
 * either army can put on that ridge is `pillboxMg` at 22 m, which is what the
 * two Sentry Guns already there carry.
 *
 * The player's half follows from the same rule rather than from generosity: a
 * Refractor Tower needs a Proving Ground first, which is two unlock ids, 2 400
 * credits and -110 power inside a sixteen-minute defence. That is a tech rush,
 * and this operation is not about one — the answer to it is the office's own
 * 26 m build ring, a 400-credit Pillbox, and where you put your army. It is also
 * SYMMETRIC and profile-independent, so the ground is the same on a finished
 * account as on a fresh one, which a deny-list could not promise.
 *
 * ============================================================================
 * NO SCRIPTED `eva`, AND THAT IS DELIBERATE
 * ============================================================================
 * `audio.system.ts` already speaks `structureLost` on any local building death
 * and `baseUnderAttack` on any attack on one, which is every moment this
 * operation would want an announcer for — a scripted copy is swallowed by the
 * per-line cooldown and is redundant where it is not. `reinforcements` is the
 * line four shipped operations reach for, and it means the PLAYER'S reinforcements
 * ("Reinforcements have arrived."); nothing in `EVA_LINES` means "the opponent
 * has formed a column". `validateCampaign` can check that a line EXISTS and
 * cannot check that it means what the author meant, so the honest answer is
 * silence rather than the nearest-sounding cue. `allies.03.ground-truth` reached
 * the same place, in the same words.
 *
 * **THIS CREDITED CLAUDE.md WITH NAMING `reinforcements` AS "THE ONE LINE THAT
 * EARNS ITS PLACE", AND CLAUDE.md HAS NO OCCURRENCE OF THE WORD.** Its campaign
 * section discusses the `eva` EFFECT — that `Shell.playCampaignBeat` dropped
 * every scripted line for thirteen operations — and names no line at all; the
 * only EVA id it names anywhere is `EvaLine.NoOreMiner`, in the ore-crisis
 * block. The provenance for `reinforcements` is `src/audio/Eva.ts`, whose own
 * note records it as a mastered take that had no `EvaLine` to dispatch it until
 * `orecrisis.system.ts` became its first caller. A citation to a file nobody
 * re-reads is the cheapest false claim there is; grep before writing one.
 *
 * There is exactly one `cameraMove`, on the first column. It is an ARRIVAL —
 * the sanctioned use — and it is the operation teaching its own mechanic: the
 * player sees where a column comes from at the moment one does, which is what
 * makes the muster worth attacking four minutes later without a line of
 * dialogue explaining it.
 * ========================================================================== */

import { Faction } from '../../../core/types';
import { minutes, seconds } from '../../types';
import type { Condition, OperationDef } from '../../types';
import {
  MAST_AREA, MUSTER_AREA, OFFICE, OFFICE_AREA, ROAD,
} from '../../layouts/allies-misclosure';

/**
 * THE GEOMETRY IS IMPORTED, NOT RESTATED.
 *
 * The office is placed by the layout and the columns are ordered at it by this
 * file, so the two modules have to agree about four points. A number written in
 * both is a number that will disagree the first time either is tuned, and the
 * failure — a column attack-moving at empty ground, a reveal framing nothing —
 * is invisible to every gate. `layouts/allies-misclosure.ts` owns the geometry;
 * the dependency runs operation -> layout and never back.
 */

/**
 * The guard on a build that failed rather than on a race. See the header: the
 * world is finished before tick one, so on a correct build neither loss can hold
 * at 0:00 — this makes an office that never got placed fail AFTER the briefing
 * rather than before it.
 *
 * THREE CONSUMERS, NOT TWO: `t.razed`, `t.beaten` and — since the muster reads
 * moved to ownership — `t.musterDown`, whose `ownerCount(..., max: 0)` reads
 * TRUE against an empty tag registry for precisely the reason `entityDead` did.
 */
const SETTLE = seconds(20);

/**
 * The first minute at which there is anything to send.
 *
 * **THE TRANSMITTER CAN BE TAKEN BEFORE THIS AND THE FILING STILL WAITS**, which
 * is stated out loud in `t.orders` rather than left as a trap: `structureCaptured`
 * is true from the tick the deed changes hands, so a player who takes the block
 * at minute two ends the operation at minute eight. The briefing says so in the
 * same sentence that offers the choice.
 */
const EARLY = minutes(8);

/**
 * The close, and it is `parSec` 960 to the second.
 *
 * A defend whose clock is a description of itself is not falsifiable from inside
 * the operation. The authored par IS the deadline — the rule
 * `soviets.03.deep-sector`, `soviets.05.short-allocation` and
 * `allies.03.ground-truth` all state about their own — and the chapter's ramp is
 * 780 / 840 / 900 / 960.
 */
const CLOSE = minutes(16);

/**
 * The Soviets still hold the muster, so it is still forming columns FOR THEM.
 *
 * `ownerCount` RATHER THAN `entityAlive`, AND THAT IS NOT A SPELLING CHANGE.
 * `Director.holds` answers `entityAlive` by counting LIVE entities and a
 * captured barracks is still alive, so read through liveness this gate went on
 * spawning Soviet columns off a structure standing on the PLAYER'S books. The
 * header carries the migration, the price of the capture, and the objective
 * that moved with these two gates rather than being left behind them.
 *
 * `min: 1` IS THE SAFE POLARITY AND NEEDS NO SETTLE GUARD. It reads FALSE
 * against a tag registry that is still empty, so a build that placed nothing
 * WITHHOLDS the two late columns rather than asserting anything;
 * `t.musterDown`'s `max: 0` is the other way round and carries `SETTLE` for
 * exactly that reason.
 *
 * STILL MONOTONE, on a premise `entityAlive` did not need: seat 1 cannot take
 * it back, because `AiBrain` issues no `OrderKind.Capture` and
 * `GarrisonService.refusalFor` answers `'hostile'` for a structure the entrant
 * is not allied to. See the header for what breaks if the brain learns it.
 */
const MUSTER_UP: Condition = {
  on: 'ownerCount', player: 1, role: 'building', tag: 'muster', min: 1,
};

/** The office is still standing. Its exact complement is `t.razed`'s condition. */
const OFFICE_UP: Condition = { on: 'entityAlive', tag: 'office' };

const op: OperationDef = {
  id: 'allies.04.misclosure',
  chapter: 'allies',
  faction: Faction.Allies,
  /*
   * THE SOVIETS, AND THE PROSE IS WHERE IT COMES FROM.
   *
   * Wend's briefing line names their muster and their traffic; all four columns
   * are literal `conscript` and `rhino`, which `validateCampaign` refuses on any
   * seat that is not Soviet. It is also the chapter's own grid: A2 is fought
   * against the district that took the Works yards at the Split, A3 goes to the
   * Pact for one operation, and A4 comes back to the army that has the strongest
   * reason to stop a correction being filed — every quota on the eastern arc is
   * hung off the schedule this reduction is about to move.
   * `soviets.05.short-allocation` is the same argument seen from their side, one
   * revision later.
   */
  foe: Faction.Soviets,
  index: 4,
  title: 'Misclosure',
  beat: 'The loop closes out by more than the schedule can absorb, and the office it is being '
    + 'closed in stands a hundred metres outside the wire.',
  primaryType: 'defend',
  /*
   * BESPOKE. `reinforced` is "spawnUnits at a declared tick" and this table also
   * moves objective state, reveals ground, moves the camera and reads the world
   * to decide whether two of the four columns exist at all. The label is about
   * MECHANISM: the drama is one building, a schedule and a ridge, and two of
   * those three are in the layout before tick one.
   */
  archetype: 'bespoke',
  parSec: 960,
  requires: ['allies.03.ground-truth'],

  map: {
    /*
     * `snow` — `relief` 0.50 / `cliffs` 0.40, and the chapter's fourth distinct
     * ground after a temperate valley, an urban district and a tropical shore.
     * It is the HIGHEST RELIEF of the seven presets and the only one whose
     * `mood` is `overcast`; it is **not** the steepest by cliff fraction, where
     * `arid` carries 0.55 and `coast` 0.45 — `soviets-short-allocation` records
     * getting that superlative wrong about its own preset and it is not worth
     * repeating. The relief is a real constraint rather than a mood: every
     * structure here goes down through a `footprintBuildable` +
     * `footprintClear` ring search and every distance quoted in this file and
     * in the layout is read off where things actually landed.
     */
    preset: 'snow',
    /*
     * CHOSEN BY SURVEY RATHER THAN BY DATE, exactly as `allies.03.ground-truth`
     * chose its own.
     *
     * A3 pins 20 260 910 and each operation is a week on, so the convention
     * gives 20 260 917. Forty rolls (20 260 900 .. 20 260 939) were scored on
     * this preset by taking three CANDIDATE lots on the opening-to-opening frame
     * — one 60 m behind the yard, one 110 m up the lane, one 278 m up it — and
     * measuring the buildable fraction of a 7x7 cell block at each plus a
     * tracked route from the player's opening to the far one. The convention's
     * own roll puts the middle lot at **22%** buildable; 20 260 903, 20 260 913,
     * 20 260 930 and 20 260 939 each put one of the three at 4% or less (so do
     * 20 260 912, 20 260 923 and 20 260 931 — the four named are examples, not
     * the whole of the bad end). **20 260 928 scores 59% / 76% / 82%**, and it
     * is the roll this operation is measured on.
     *
     * **IT IS NOT THE BEST OF THE FORTY, AND THIS BLOCK SAID IT WAS.** It read
     * *"came back best of the forty at a worst lot of 76%"*: 76% is 928's MIDDLE
     * lot read as though it were its worst, and the superlative then followed
     * from the misread, because nothing else in the forty has a worst lot above
     * 69.4% and a real 76% would have won outright. Re-measured, 928's worst lot
     * is **59.2%** and it comes JOINT THIRD — 20 260 909 (69.4%) and 20 260 905
     * (67.3%) both beat it, and 20 260 911, 20 260 914 and 20 260 938 tie it. So
     * the "tied with 20 260 938" half is true and undersold; the ranking is not.
     *
     * **THE DECISION SURVIVES THE CORRECTION AND THAT IS WHY IT IS LEFT ALONE.**
     * The convention's own roll is 22.4% at the lot the office stands nearest,
     * against 59.2% here — a 2.6x margin at the binding lot, which is what
     * breaking the date convention was bought with. What is NOT bought is a
     * claim that this is the best ground available; re-run the sweep before
     * making one.
     *
     * **THE SURVEY CHOSE THE GROUND, NOT THE COORDINATES.** The three buildings
     * this layout actually places were sited and measured on the winning roll
     * afterwards, and they are not those candidate lots — the muster in
     * particular moved off the lane onto ground that could carry a spawn ring.
     * The date is a convention and not a mechanism; the ground is the mechanism.
     * Pinned by `tests/campaign-maps.spec.ts` as a terrain fingerprint: a
     * generator change that re-rolls this ground moves every distance above.
     */
    mapSeed: 20_260_928,
    /*
     * A3 + 7 ON THE CHAPTER'S OWN COUNTER (7 014, 7 021, 7 028), AND HERE IT IS
     * LOAD-BEARING GEOMETRY.
     *
     * `seatedSlots(2, 7035, null)` returns **[2, 3]** — an antipodal pair at
     * 386.16 m, the same separation A1, A2 and A3 all measure against and the
     * OTHER diagonal of the same rectangle, which is why the player opens in the
     * south-east here and in the north-west there. The two edge pairs are
     * 296.00 m apart and would pull the muster and the office 60 m closer to
     * everything at once. Change this and re-measure; do not re-read.
     */
    simSeed: 7_035,
    armies: 2,
    biome: 'snow',
    /*
     * `base`. A defence needs a position to defend from at tick zero, and an
     * `mcv` opening would spend the first ninety seconds unfolding while the
     * building the operation is about stood unguarded a hundred metres away.
     */
    opening: 'base',
    /*
     * 5 000, AND IT BINDS BOTH SEATS — `Shell.applySimPostBoot` writes
     * `setup.startingCredits` into every non-Neutral slot.
     *
     * The chapter's ramp is 2 500 / 3 000 / 4 000 / 5 000 and this is the top of
     * it, because this operation asks one bank to pay for two things at once: a
     * forward defence around a building outside the base, and a 284.3 m raid
     * that has to be affordable enough to be a decision rather than a fantasy.
     * It is still half the skirmish 10 000, which is the lever CLAUDE.md names
     * for the opening bank twice reported as a prebuilt AI base — a district
     * that has not been hit yet should not be raising seven buildings in ninety
     * seconds either.
     */
    credits: 5_000,
  },
  layout: 'allies-misclosure',

  // NEITHER SHIPPED RULE MAY END THIS. See the header: all four routes are
  // authored, and `assetLossDefeat` would end this operation's best last act at
  // 2 Hz.
  outcome: { annihilationWin: false, assetLossDefeat: false, ignoreSeats: [] },

  // See the header. Empty on both sides — and the Soviet half is the one that
  // matters, because a Tesla Coil beside the muster would wall off the fork.
  roster: { player: [], ai: [] },

  objectives: [
    {
      id: 'file',
      kind: 'primary',
      title: 'Keep the reduction office standing until the correction is filed',
    },
    /*
     * NO `credits` ON THIS ROW, AND IT IS DELIBERATE RATHER THAN AN OMISSION.
     * It resolves on the tick the operation ends, so a payout would be credited
     * to a player with no match left to spend it in — a reward that exists only
     * on a debrief screen is not one. `allies.03.ground-truth` refused a payout
     * on its own end-of-match secondary for the same reason. The medal is the
     * payment.
     */
    {
      id: 'closed',
      kind: 'secondary',
      title: 'File the closed reduction rather than the provisional',
    },
    /*
     * THIS ONE PAYS, BECAUSE IT RESOLVES MID-MATCH AND THE MONEY HAS SOMEWHERE
     * TO GO. 500 credits is a Pillbox and a quarter, and it arrives at the
     * moment the player has just spent their army on a 284.3 m round trip.
     *
     * **THE TITLE SAID "LEVEL" AND THE ROW COUNTS A DEED.** It resolves on
     * `ownerCount(1, 'building', 'muster', max: 0)` — destroyed and captured
     * alike — so a title naming only the first would be the operation asking
     * for one thing and paying for another, which is precisely what it did
     * while `t.musterDown` read `entityDead`. The header argues the widening;
     * the wording is what a player actually reads, so it moved with it.
     */
    {
      id: 'muster',
      kind: 'secondary',
      title: 'Take the Soviet forward muster off them',
      credits: 500,
    },
  ],

  triggers: [
    /* -- the brief, in three beats ----------------------------------------
     * Split across thirty-six seconds because the shell renders dialogue as
     * toasts and a stack of four at once is a stack nobody reads. The mechanic
     * is in the second and third beats, in numbers this table can be checked
     * against: three minutes, six and a half, ten, and the two ways to finish.
     */
    {
      id: 't.open',
      when: { on: 'elapsed', ticks: seconds(4) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Aubray',
          text: 'Bramm closed Survey 14-090 yesterday and she is reducing the whole eastern arc '
            + 'against it. Sixteen minutes of arithmetic, in the Works office on the seam — a '
            + 'hundred metres past our own yard, and the levelling books are in it, so it does '
            + 'not move.',
        },
        // The office and the transmitter, before either is a problem.
        // `revealArea` EXPLORES ground rather than showing live units, so what
        // it hands over is the shape of the decision and none of the
        // intelligence — the counts arrive in Wend's line because a player
        // cannot count emplacements through fog.
        { do: 'revealArea', player: 0, area: OFFICE_AREA },
        { do: 'revealArea', player: 0, area: MAST_AREA },
      ],
    },
    {
      id: 't.brief',
      when: { on: 'elapsed', ticks: seconds(18) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Wend',
          text: 'Their signals have it too. There is a muster on the far ridge, a hundred and '
            + 'seventeen metres off their own yard, two guns on it, and every column they send '
            + 'today forms there. First at three minutes, second at six and a half. After that '
            + 'only for as long as the ridge is still theirs.',
        },
        { do: 'revealArea', player: 0, area: MUSTER_AREA },
      ],
    },
    {
      id: 't.orders',
      when: { on: 'elapsed', ticks: seconds(30) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Aubray',
          text: 'Two ways to finish. Hold the office to the close and she files the closed '
            + 'reduction. Or put an engineer into the transmitter block behind our yard and we '
            + 'file a provisional with whatever she has — and nothing goes out before eight '
            + 'minutes whichever you choose, so taking the block early only means finishing at '
            + 'eight.',
        },
      ],
    },
    /* -- and she says what the second one costs ---------------------------
     * The one line this operation cannot work without. The provisional is a WIN
     * and a player has to understand before they take it that winning is not the
     * same as being right — which is the argument this chapter has been making
     * since A1 and the reason the medal moves.
     */
    {
      id: 't.bramm',
      when: { on: 'elapsed', ticks: seconds(42) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Bramm, in the office',
          text: 'File a provisional and you will have published a number nobody has checked. '
            + 'That is the thing I have spent three weeks telling your Field Marshal not to do. '
            + 'I would rather you held the building.',
        },
      ],
    },

    /* -- the first column -------------------------------------------------
     * THE ONE `cameraMove` IN THIS FILE, AND IT IS AN ARRIVAL. It takes the
     * camera off whatever the player was doing, which is the cost, and it buys
     * the operation's central mechanic taught by sight rather than by prose: the
     * player watches a column form on the road outside the muster at the moment
     * one does, and four minutes later the briefing's sentence about the muster
     * means something.
     *
     * LITERAL SOVIET KEYS. `EffectSink.spawnUnits` resolves through
     * `ProductionCatalog.byKey` and remaps nothing, unlike the layout's
     * `ScenarioBuilder.spawnUnit`; `validateCampaign` checks every key against
     * the army of the seat it lands on, so an Allied key here is a build error.
     */
    {
      id: 't.col1',
      when: { on: 'elapsed', ticks: minutes(3) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Wend',
          text: 'First column off the muster. Six of them, on the road, a hundred and forty '
            + 'metres out.',
        },
        { do: 'cameraMove', at: ROAD },
        { do: 'spawnUnits', player: 1, key: 'conscript', count: 4, at: ROAD, spread: 20, tag: 'col1' },
        { do: 'spawnUnits', player: 1, key: 'rhino', count: 2, at: ROAD, spread: 14, tag: 'col1' },
        { do: 'orderTagged', tag: 'col1', order: 'attackMove', at: OFFICE },
      ],
    },
    {
      id: 't.col2',
      when: { on: 'elapsed', ticks: minutes(6.5) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Wend',
          text: 'Second column, eight, same road. The two that are already written are coming '
            + 'whatever we do about the ridge.',
        },
        { do: 'spawnUnits', player: 1, key: 'conscript', count: 5, at: ROAD, spread: 20, tag: 'col2' },
        { do: 'spawnUnits', player: 1, key: 'rhino', count: 3, at: ROAD, spread: 14, tag: 'col2' },
        { do: 'orderTagged', tag: 'col2', order: 'attackMove', at: OFFICE },
      ],
    },
    {
      id: 't.col3',
      when: { on: 'all', of: [{ on: 'elapsed', ticks: minutes(10) }, MUSTER_UP] },
      then: [
        {
          do: 'dialogue',
          speaker: 'Wend',
          text: 'Third column. The muster is still forming them, and there is one more after '
            + 'this.',
        },
        { do: 'spawnUnits', player: 1, key: 'conscript', count: 5, at: ROAD, spread: 20, tag: 'col3' },
        { do: 'spawnUnits', player: 1, key: 'rhino', count: 3, at: ROAD, spread: 14, tag: 'col3' },
        { do: 'orderTagged', tag: 'col3', order: 'attackMove', at: OFFICE },
      ],
    },
    {
      id: 't.col4',
      when: { on: 'all', of: [{ on: 'elapsed', ticks: minutes(13.5) }, MUSTER_UP] },
      then: [
        {
          do: 'dialogue',
          speaker: 'Wend',
          text: 'Everything the ridge has left. Ten, four of them Anvils, and two and a half '
            + 'minutes on the reduction.',
        },
        { do: 'spawnUnits', player: 1, key: 'conscript', count: 6, at: ROAD, spread: 20, tag: 'col4' },
        { do: 'spawnUnits', player: 1, key: 'rhino', count: 4, at: ROAD, spread: 14, tag: 'col4' },
        { do: 'orderTagged', tag: 'col4', order: 'attackMove', at: OFFICE },
      ],
    },

    /* -- the raid pays ----------------------------------------------------
     * ABOVE `t.musterStanding`, which is the ordering rule this file states in
     * its header: a resolved objective does not un-resolve, so the completion
     * has to be applied before the failure that shares its tick can be.
     *
     * `ownerCount ... max: 0` ON A TAG THE LAYOUT STAMPS, which
     * `campaign-maps.spec.ts` proves landed. It was `entityDead`, and
     * `Director.holds` answers that by counting LIVE entities — so a player who
     * walked four engineers up the ridge and took the muster could never
     * complete this row at all, and `t.musterStanding` then FAILED it at 16:00.
     * `max: 0` is true when the Soviets no longer own it, which covers
     * destroyed and captured alike and is the same predicate `MUSTER_UP` reads
     * from the other side; the two stay exact complements over seat 1's deed,
     * as they were over the corpse.
     *
     * `SETTLE` IS THE PRICE OF THAT POLARITY AND IT IS NOT OPTIONAL. A count of
     * zero reads TRUE before the layout has stamped the tag, exactly as
     * `entityDead` did — so a build that never placed the muster would complete
     * this row AND PAY THE 500 CREDITS on tick one, before a word of the
     * briefing. The same twenty seconds `t.razed` uses, for the same reason and
     * out of the same constant: it makes a failed build legible after the
     * briefing rather than before it, and `campaign-maps.spec.ts` is the gate
     * that actually catches one.
     *
     * The 500 credits are paid by `ObjectiveDef.credits` through
     * `CampaignSession.setObjective`, once ever — the `paid` set rides in the
     * save chunk beside completion, so reloading before it and taking the
     * muster again does not pay twice.
     */
    {
      id: 't.musterDown',
      when: {
        on: 'all',
        of: [
          { on: 'elapsed', ticks: SETTLE },
          { on: 'ownerCount', player: 1, role: 'building', tag: 'muster', max: 0 },
        ],
      },
      then: [
        { do: 'completeObjective', id: 'muster' },
        {
          do: 'dialogue',
          speaker: 'Wend',
          text: 'The muster is off them. Nothing else forms on that ridge today — whatever they '
            + 'had written for it is written for nowhere.',
        },
        {
          do: 'dialogue',
          speaker: 'Aubray',
          text: 'Five hundred released against it. Spend it on the office, not on the ridge.',
        },
      ],
    },

    /* -- the office takes fire --------------------------------------------
     * `entityHpBelow` reads the WEAKEST live carrier and answers -1 when nothing
     * alive carries the tag, so this cannot fire on a rubble field — which is
     * the whole reason it is a different condition from `entityDead`.
     *
     * NO `eva`. `audio.system.ts` already says `baseUnderAttack` on any attack
     * on a local building, so a scripted copy is swallowed by the line's own
     * cooldown; see the header.
     */
    {
      id: 't.hurt',
      when: { on: 'entityHpBelow', tag: 'office', frac: 0.4 },
      then: [
        {
          do: 'dialogue',
          speaker: 'Wend',
          text: 'Office is down to four tenths and she has not moved off the desk. Some of that '
            + 'is ours — there is a tank fighting on its doorstep.',
        },
      ],
    },

    /* -- the close, telegraphed ------------------------------------------- */
    {
      id: 't.closing',
      when: { on: 'elapsed', ticks: minutes(15) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Aubray',
          text: 'One minute. Whatever is standing at sixteen is what gets filed.',
        },
      ],
    },

    /* -- the two losses ---------------------------------------------------
     * ABOVE THE WINS, AND HERE THAT IS LOAD-BEARING RATHER THAN CONVENTIONAL.
     * This said the two "cannot actually collide here", on the grounds that
     * `t.razed`'s condition is the exact complement of the `entityAlive 'office'`
     * both wins carry. That is true of `t.razed` and FALSE of `t.beaten`, which
     * carries no such complement: a commander who is `Viability.isBeaten` while
     * the office still stands satisfies `t.beaten` AND `t.close` on tick 16:00,
     * and `t.beaten` AND `t.provisional` on any tick from minute eight with the
     * transmitter held. `runDirector` appends both triggers' effects and
     * `CampaignSession.end` takes the first, so FILE ORDER is what decides that
     * a beaten commander loses rather than wins — move these below the wins and
     * the same position becomes a victory. A generalisation from one of two
     * triggers is how a guard comes to be believed about a case it never saw.
     */
    {
      id: 't.razed',
      when: {
        on: 'all',
        of: [{ on: 'elapsed', ticks: SETTLE }, { on: 'entityDead', tag: 'office' }],
      },
      then: [
        { do: 'failObjective', id: 'file' },
        { do: 'failObjective', id: 'closed' },
        {
          do: 'dialogue',
          speaker: 'Aubray',
          text: 'The office is gone and the books were in it. Eleven years of the eastern arc, '
            + 'and the schedule stands — because there is nothing left on the continent to '
            + 'correct it with.',
        },
        { do: 'endOperation', result: 'loss', reason: 'file' },
      ],
    },
    /*
     * `playerBeaten` is `Viability.isBeaten` — nothing to build with AND nothing
     * to fight with — not "you have no buildings". A commander whose base is
     * gone while the office still stands with a squad in it is not beaten, and
     * this operation would very much like that to be a position somebody can
     * play from.
     */
    {
      id: 't.beaten',
      /*
       * THREE CLAUSES, NOT TWO, AND THE THIRD IS WHY THIS OPERATION EXISTS.
       *
       * It was `all: [elapsed SETTLE, playerBeaten 0]`, and that ended THE
       * EXACT POSITION THE HEADER TURNED `assetLossDefeat` OFF TO PRESERVE —
       * a commander with no producers, no MCV and nothing left but riflemen
       * inside the office. `Viability.surveyViability`'s §HELD deliberately
       * files `EntityFlag.Garrisoned` occupants into `heldUnits` and never
       * into `contestingUnits`, so that player reads
       * `canRebuild === false && canContest === false` and `isBeaten` answers
       * true on the next Director tick. The primary objective is literally
       * "Keep the reduction office standing until the correction is filed",
       * and the operation was taking it away from them for standing in it.
       *
       * The header's own justification for the flag was wrong in the other
       * direction too, and is corrected above: `Shell.pollOutcome` declares
       * defeat at ZERO living assets across Buildings, Vehicles and Infantry,
       * so a standing player-owned office is one and the shipped rule could
       * never have fired here either. Two arguments, both false, pointing at
       * a real defect neither of them described.
       *
       * `ownerCount` filters only `PendingDestroy` and `UnderConstruction`, so
       * it DOES count a garrisoned man — which is the whole reason it can say
       * what `playerBeaten` cannot. Beaten AND holding nothing is a loss;
       * beaten while five men hold the office is the last act, and it runs to
       * `t.close` at sixteen minutes like any other.
       */
      when: {
        on: 'all',
        of: [
          { on: 'elapsed', ticks: SETTLE },
          { on: 'playerBeaten', player: 0 },
          { on: 'ownerCount', player: 0, role: 'unit', max: 0 },
        ],
      },
      then: [
        { do: 'failObjective', id: 'file' },
        { do: 'failObjective', id: 'closed' },
        {
          do: 'dialogue',
          speaker: 'Wend',
          text: 'Nothing answering anywhere. They will walk into that office at their leisure, '
            + 'and the reduction goes in a stove.',
        },
        { do: 'endOperation', result: 'loss', reason: 'file' },
      ],
    },

    /* -- the secondary that resolves at the close -------------------------
     * ABOVE `t.close`: `t.close` sets the outcome, and a row left `active` when
     * the operation ends reads on the debrief as unfinished rather than as
     * missed. It cannot wrongly fire on a muster already taken — that row is
     * `complete` by then and a resolved objective does not un-resolve.
     *
     * `MUSTER_UP` IS OWNERSHIP NOW, WHICH IS WHAT MAKES THAT SENTENCE TRUE
     * AGAIN. Through `entityAlive` this trigger failed the secondary at 16:00
     * for a muster the player had CAPTURED — the row was still `active`,
     * because `t.musterDown` could not see a deed move, so there was nothing to
     * refuse the un-resolve. Both reads moved together for that reason; see the
     * header on why a mixed pair is worse than either whole one.
     *
     * THE ID STILL SAYS `Standing` AND THE CONDITION NOW SAYS THEIRS. It is
     * kept: a trigger id is not player-visible, `allies.05.forced-closure`
     * cites this one by name, and `OperationState.fired` is keyed by id and
     * saved. The condition is one line below and cannot be misread for the
     * name.
     */
    {
      id: 't.musterStanding',
      when: { on: 'all', of: [{ on: 'elapsed', ticks: CLOSE }, MUSTER_UP] },
      then: [{ do: 'failObjective', id: 'muster' }],
    },

    /* -- the close --------------------------------------------------------
     * THE CHAPTER'S OWN SENTENCE, INVERTED. Aubray has answered A1, A2 and A3
     * with "That matches." This is the reading that does not, and it is the
     * whole reason the operation is called what it is.
     *
     * ABOVE `t.provisional`, so a player still holding the transmitter at 16:00
     * files the closed reduction rather than the provisional they never sent.
     */
    {
      id: 't.close',
      when: { on: 'all', of: [{ on: 'elapsed', ticks: CLOSE }, OFFICE_UP] },
      then: [
        { do: 'completeObjective', id: 'closed' },
        { do: 'completeObjective', id: 'file' },
        {
          do: 'dialogue',
          speaker: 'Bramm, in the office',
          text: 'Loop closes eleven millimetres out over four hundred and ten kilometres. That '
            + 'is not an observing error. Your schedule is fast, and it has been fast since the '
            + 'year it was written.',
        },
        {
          do: 'dialogue',
          speaker: 'Aubray',
          text: 'That does not match. Get it on the wire before somebody senior decides it '
            + 'should not go.',
        },
        { do: 'endOperation', result: 'win' },
      ],
    },

    /* -- the provisional --------------------------------------------------
     * A WIN, AT A PRICE, AND THE PRICE IS THE POINT. `structureCaptured` is
     * `ownerOfTag(tag) === player`, which an engineer satisfies outright
     * (`Capture.ts` rule 1, a neutral structure flips at any health) and a
     * garrisoning squad satisfies for as long as they stand inside
     * (`GarrisonService.enter`). Both are explicit orders, which is what keeps
     * this from firing on somebody walking past — and the block is 60.96 m
     * BEHIND the player's own yard, where nothing is ever fought over.
     *
     * `not elapsed(CLOSE)` is the upper bound, and it is legal where
     * `elapsedSinceArmed` under a `not` is not: `elapsed` is a pure function of
     * the tick, so negating it is a window rather than a trigger that can never
     * arm. Without it, this trigger's two lines of dialogue would play on top of
     * `t.close`'s at 16:00.
     *
     * It fails `muster` as well, which is a no-op if the raid already paid and
     * is otherwise the truth: the operation is over and the ridge is still
     * there.
     */
    {
      id: 't.provisional',
      when: {
        on: 'all',
        of: [
          { on: 'elapsed', ticks: EARLY },
          { on: 'not', of: { on: 'elapsed', ticks: CLOSE } },
          OFFICE_UP,
          { on: 'structureCaptured', tag: 'mast', player: 0 },
        ],
      },
      then: [
        { do: 'failObjective', id: 'closed' },
        { do: 'failObjective', id: 'muster' },
        { do: 'completeObjective', id: 'file' },
        {
          do: 'dialogue',
          speaker: 'Bramm, in the office',
          text: 'Then send it. It says the arc is out and it does not say by how much, and by '
            + 'tonight four armies will have an opinion about a number nobody closed.',
        },
        {
          do: 'dialogue',
          speaker: 'Aubray',
          text: 'Noted, and logged as provisional. It is the last one we file.',
        },
        { do: 'endOperation', result: 'win' },
      ],
    },
  ],
};

export default op;
