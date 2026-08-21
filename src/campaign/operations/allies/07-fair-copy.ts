/**
 * ============================================================================
 * A7 — FAIR COPY
 * ============================================================================
 * A6 ends with the corrected schedule in existence and unpublished, and the
 * reason is the sentence A5 already put on the record: *"whoever publishes first
 * is what the continent sites from"*. The continent does not site from what is
 * true. It sites from what is DISTRIBUTED, and the distribution is not the
 * Allies'.
 *
 * It is not anybody's. The Works circular has gone down the trunk every evening
 * since before the Split — a numbered amendment slip, lodged at a relay head by
 * whoever brings one, repeated to every siting office on the eastern arc, and
 * pasted into every yard's book by a clerk who has never once asked who filed
 * it. Nobody took the chain at the Split, because the chain is not property. It
 * is a line of relay blocks and the people who sit in them, and it sends what is
 * lodged with it at six.
 *
 * **THE MERIDIAN PACT ARE ALREADY THERE, AND THEY ARE NOT WRONG.** A3 is where
 * this chapter first met an army whose own reading of the March already agreed
 * with Bramm's appendix — its own `foe` block says so — and `pact.05.open-count`
 * ends with the Conclave holding a corroborated four-hundred-year count that it
 * has no way to PRESENT, because *"an argument has to be PRESENTED"*. The Order
 * lodged its own slip at both heads eleven days ago. Two true schedules, one
 * amendment number, and a continent that can only paste in one of them.
 *
 * That is the chapter's spine turned over. A1 through A6 argued that a number is
 * only worth what the instrument behind it is worth. This is the operation where
 * the Allies find out that a number is also only worth the counter it was
 * lodged at, and that the man on the other side of the counter has better
 * instruments than they do.
 *
 * ============================================================================
 * WHY `primaryType: 'fixed-force'`
 * ============================================================================
 * `soviets.02.common-standard` is the other one, and its header states the
 * thesis: **a skirmish answers every problem by queueing something, and
 * `opening: 'force'` deletes the answer.** No Construction Yard, no factory, no
 * harvester, and `credits: 0` on top so there is not even a bank to look at.
 *
 * What is different here — and it is the whole reason this is not S2 again — is
 * that **five of the nineteen hulls are UNARMED and are the DEARER half of a
 * two-item price list.** S2's fixed budget is eight tanks and the question is
 * what they are worth; this one's is thirteen men, two doors and one signal
 * house, and the two doors and the house take different men:
 *
 *   - A relay block is GAIA. `Capture.resolve` forks on
 *     `ownerFactionOf(t) === Faction.Neutral` and the neutral branch has **no
 *     health gate at all** — one engineer, at any health, and
 *     `Capture.ts#consume` writes `UnitState.Selling` and `markDead`.
 *   - **AND A RIFLEMAN LODGES ONE TOO, WHICH THIS FILE ONCE DENIED IN THE
 *     BRIEFING.** `civApartments` passes every gate in
 *     `GarrisonService.refusalFor` — measured, it returns the empty string for
 *     seat 0 — and `GarrisonService.enter` calls `captureBuilding()` directly, so
 *     one G.I. flips the deed, the objective LATCHES, and he walks out again.
 *     `OperationDef.captureProof` cannot refuse it (it is a `CaptureService`
 *     veto and `captureBuilding` consults none) and no condition in the frozen
 *     vocabulary can tell the two apart. It is PRICED instead — the layout header
 *     carries the table — and the price is real because a 120-hp rifleman
 *     survives two `glaiveRepeater` bursts on the way in and a 90-hp engineer
 *     survives one.
 *   - **THE REGISTER IS IMMUNE TO ALL OF THAT.** `mrdOculus` carries `IsRadar`,
 *     so `refusalFor` answers `"production structure"` and no rifleman is
 *     walking into it. Four engineers, or the guns. That is what makes the
 *     section scarce: spending one on a door is spending a quarter of the
 *     secondary.
 *   - There is no barracks anywhere on the player's side of this map, so
 *     thirteen is thirteen. `t.mercy` below is the one exception and it is a
 *     dead-end rescue rather than a supply.
 *
 * S2's own counts are UNTAGGED on the stated grounds that under `'force'` the
 * player owns exactly the column forever, so "units owned" and "hulls left" are
 * the same number. **That reasoning does not survive here** — this operation
 * spawns for seat 0 twice — so the section carries a `section` tag, the screen
 * carries a `screen` tag, and `t.mercy` reads BOTH, which is the expensive
 * spelling and is the correct one.
 *
 * ============================================================================
 * THE ARITHMETIC THAT IS THE OPERATION: ONE MAN A HEAD, FOUR MEN A REGISTER
 * ============================================================================
 * The same verb, twice, against two owners, and the two prices are two hundred
 * credits and two thousand:
 *
 *   - **A GAIA HEAD IS ONE MAN — AND HE DOES NOT HAVE TO BE AN ENGINEER.**
 *     Rule 1 above for the clerk, `GarrisonService.enter` for the rifleman. Two
 *     hundred credits and a walk is the floor; five hundred and a man you do not
 *     get back is what you pay when you want the deed to stay put or when the
 *     rifleman is not there.
 *   - **THE ORDER'S FIELD REGISTER IS FOUR ENGINEERS AND NOTHING ELSE.**
 *     `mrdOculus` is seat 1's, so it
 *     takes the ENEMY branch: above `CAPTURE.captureHpFrac` (0.5) the engineer
 *     is spent knocking `maxHp * CAPTURE.softenFrac` (0.25) off through
 *     `ARMOR_MATRIX[HighExplosive][Concrete]` (1.00) **and
 *     `COMBAT_DAMAGE.globalMul` (0.80)** — a flat 130 of a 650-hp register, 20%
 *     of max and not 25%. 650 -> 520 -> 390 -> 260, and the FOURTH engineer
 *     captures. Quoting `softenFrac` without `globalMul` understates that by one
 *     engineer, and two headers in this repo shipped that way.
 *
 * **SO THE SECONDARY IS THE ONE STRUCTURE ON THIS MAP THE PLAYER SHOULD SHOOT,
 * AND THE TWO PRIMARIES ARE THE TWO THEY MUST NOT.** Six Wardens put 96.80 dps
 * of `lightCannon` on Concrete and break the register in **6.71 s**; taking it
 * with engineers costs four of the five men, and the two doors want men too. A
 * player who reaches for the same verb twice has lost the operation to
 * arithmetic rather than to the Order.
 *
 * **AND "MUST NOT SHOOT" IS NOW A LIVE HAZARD RATHER THAN A RULE THE PLAYER CAN
 * SIMPLY OBEY.** `Damage.applySplash` has no ally filter of any kind — it
 * halves through `COMBAT_DAMAGE.friendlyFireMul` and nothing more — and a 2x3
 * block's `hitRadius` is 7.211 m, so a `lightCannon` shell landing on a man at
 * a lodging cell puts **5.23 to 12.10 hp** into the block behind him and a
 * Meridian `focusLance` puts **5.03 to 13.20**. Nothing mends it: `Regen` is
 * mobile units only and `RepairSell` needs an owner with a bank. Sixty-one to a
 * hundred and fifty-nine shells is a long fight fought on the doorstep, and it
 * is the fight both keyed troops and all four timed ones are ordered into.
 *
 * **AND THE ORDER MENDS IT, SO A LONE ENGINEER IS WORSE THAN NOTHING.**
 * `AiBrain.repairBase` walks every building the seat owns with no proximity
 * filter and takes the worst STRICTLY below `AI_REPAIR.startFraction` 0.75.
 * 520/650 is 0.800 and is not a candidate; 390/650 is 0.600 and is. At
 * `REPAIR_RATE` 30 hp/s and `REPAIR_COST_PER_HP` 0.25 a register left at 260 is
 * back to full in **13.0 seconds for 97.5 credits**.
 * `allies.05.forced-closure` and `reclamation.02.written-off` record the same
 * finding about their own targets and draw the same conclusion.
 *
 * ============================================================================
 * THE DECISION THIS OPERATION OWNS: WHICH HEAD YOU ANNOUNCE YOURSELF AT
 * ============================================================================
 * The two heads are not the same problem and neither is the harder one.
 *
 *     arc head     246.0 m of Foot route out, TWO Glaive Posts on it, 152.7 m of
 *                  Track route from the Order's Conclave.
 *     yards head   289.5 m out, and **no structure of any kind within 199.53 m**
 *                  — 250.5 m of Track route from where their troops form.
 *
 * The layout's measurement is that `CaptureService.withinReach` accepts **TEN**
 * Foot cells at the arc head — it is a rounded rectangle, not four stands — that
 * **exactly one post bears on each of them and none is under both**, and, by
 * exclusion control, that **no route from the column reaches any of them without
 * entering a firing circle**. So a player does not have to break a gun LINE:
 * six Wardens break ONE post in 4.96 s and five of the ten cells go quiet.
 * Against that, the yards head can be lodged by an engineer nobody escorted at
 * all.
 *
 * **THAT WAS FALSE UNTIL THE POSTS WERE MOVED, AND THE FALSE VERSION IS THE
 * REASON THE GROUND CHANGED.** At the authored offsets two of the ten cells sat
 * between the two arcs — inside a post's ACQUIRE circle and outside its FIRE
 * circle, so it slewed and never pulled the trigger — and `glaiveRepeater`
 * carries `splashRadius: 0`. The head could be lodged for a **12.2 m detour**
 * without a shot being fired, which deletes the decision this whole section is
 * about. The offsets are `(+-22, -+8)` now and the exclusion control comes back
 * UNREACHABLE.
 *
 * **THE GATE IS A PRICE, NOT A WALL: 4.00 m OF WALKING UNDER ONE GUN.** That is
 * 1.18 s at an engineer's 3.4 m/s against a 0.79 s cycle, so it is one burst or
 * two, and a burst is 48.0 — an engineer arrives at 42 of 90 hp or does not
 * arrive, a rifleman at 24 of 120. Which is exactly where the garrison route
 * stops being a free lunch and becomes a CHOICE: the rifleman survives the dash
 * the engineer might not, and the engineer is the only one who can go on to the
 * register.
 *
 * **AND THE FIRST LODGING IS WHAT PUTS A TROOP ON THE OTHER ONE.** `t.noticedArc`
 * and `t.noticedYards` are keyed on `objectiveComplete` rather than on the clock
 * — the shape `soviets.02.common-standard` and `reclamation.02.written-off` both
 * use, for the stated reason that the hinge should sit in the same place for a
 * fast commander and a careful one. So the decision is not "which one first" in
 * the abstract; it is **which of the two you would rather meet with concrete on
 * it and which with five Wayfarers and a Solarch walking at it**, and it is
 * taken before a hull has moved.
 *
 * A COSTED THIRD ANSWER, WRITTEN DOWN SO NOBODY RE-DERIVES IT. `glaiveRepeater`
 * carries `needsPower` and `Combat.ts`'s second tier refuses to fire it during
 * ANY grid deficit. The Order runs **640 produced against 260 consumed** off
 * four Solar Arrays, so killing THREE of them (two leaves +60) puts both posts
 * on the arc head dark. It is four Wardens of driving into their base to save
 * 4.96 seconds of shooting, with a force that cannot replace a hull. The layout
 * header carries the table; this file does not recommend it.
 *
 * ============================================================================
 * HOW THIS DIFFERS FROM THE SIX OPERATIONS BEFORE IT
 * ============================================================================
 * A1 escort, A2 infiltrate, A3 race, A4 defend, A5 assault, A6 capture-hold —
 * and every one of them was fought with a base behind it. Three reversals worth
 * naming:
 *
 *   - **THE PLAYER CANNOT BUY THEIR WAY OUT OF A MISTAKE, FOR THE FIRST TIME IN
 *     THIS CHAPTER.** A3's bank is explicitly "the second window"; A5's five
 *     thousand is explicitly two fifths of an engineer section. Here the bank is
 *     nought and the sidebar is empty.
 *   - **THE OBJECTIVE IS TWO PLACES AND BOTH ARE REQUIRED.** A3 offered three
 *     places and any ONE of them won; this asks for both, on foot, two hundred
 *     and twenty-one metres apart.
 *   - **THE ENEMY IS RIGHT.** A2, A4 and A5 are fought against an administration
 *     defending a number it knows is wrong, and A6 against a house selling the
 *     current the correction was computed on. Calvane is defending a MEASUREMENT,
 *     and `t.bramm` says on the player's own net, before a shot is fired, that it
 *     agrees with ours to the fourth decimal.
 *
 * `allies.03.ground-truth` is the other Meridian operation in this chapter and
 * its `foe` block is the argument for having one at all: an army the Allies are
 * ARGUING with is more useful than a fourth Soviet operation. This is that
 * argument's bill.
 *
 * ============================================================================
 * WHAT ENDS THE MATCH, IN BOTH DIRECTIONS
 * ============================================================================
 * Both shipped outcome rules are off, so all five routes are authored:
 *
 *     t.win        both primaries complete                        WIN
 *     t.arcLost    the arc head is DEAD and was never lodged at   LOSS  'arc'
 *     t.yardsLost  the yards head, likewise                       LOSS  'yards'
 *     t.send       19:00 AND not both on the wire                 LOSS  (no id)
 *     t.beaten     20 s AND no units at all AND not both on the
 *                  wire                                          LOSS  (no id)
 *
 * **THE `reason` COLUMN IS A FIX AND NOT DECORATION.** All three losses used to
 * carry `reason: 'arc'`, and `EndScreen.campaignLine` resolves that id FIRST —
 * `objectives.find(o => o.id === c.reason)` — falling back to "the first failed
 * primary" only when it matches nothing. This is the chapter's first operation
 * with TWO primaries, so a fixed id was wrong in half the branches by
 * construction: a commander who lodged the arc head and then ran out of clock on
 * the walk to the yards head read *"Lodge the fair copy at the arc head — not
 * achieved"* directly above a green tick on that same row. Measured on the real
 * table: the two head-loss triggers are split so each names its own head, and
 * `t.send` and `t.beaten` carry NO reason so the existing fallback picks
 * whichever primary is actually `failed`.
 *
 * `annihilationWin` is off because razing the Conclave does not put a slip on a
 * counter, and `Shell.pollOutcome` would declare victory the tick the last
 * Meridian asset died with nothing lodged anywhere.
 *
 * **`assetLossDefeat` IS OFF BECAUSE THE AUTHORED LOSS IS WIDER THAN IT, WHICH
 * IS THE REVERSE OF THE USUAL REASON.** `Shell.countLivingAssets` walks
 * Building, Vehicle AND Infantry, so it fires only at zero of all three — and
 * the moment the player lodges their first head they OWN A BUILDING. A commander
 * with one relay block and no men left cannot lodge the second and cannot lose
 * under the shipped rule. `t.beaten` counts UNITS ONLY and ignores the block, so
 * it ends that match.
 *
 * **AND `t.beaten` READS `ownerCount(role 'unit', max: 0)` RATHER THAN
 * `playerBeaten`, BECAUSE `playerBeaten` IS NOT "NO UNITS LEFT".** This header
 * asserted that it was. `Viability.surveyViability` §HELD deliberately books an
 * `EntityFlag.Garrisoned` occupant into `heldUnits` instead of
 * `contestingUnits`, so with `canRebuild` false from tick one under
 * `opening: 'force'`, `isBeaten` reduces to *"no units OUTSIDE a building"* —
 * and this operation puts two garrisonable strongpoints on its two objectives
 * and issues eight riflemen. Staged on the real world: two men indoors,
 * `q.isBeaten(0)` TRUE, `q.ownerCount(0, 'unit')` 2, and the old trigger ends
 * the match with those men alive, unhurt and standing on the objective. S2
 * argues the opposite way about the same flag and both are right — its authored
 * loss at four hulls is TIGHTER than the shipped rule and this one is looser.
 *
 * **`t.arcLost` AND `t.yardsLost` GUARD A LIVE HAZARD, NOT THE PLAYER'S OWN
 * TRIGGER FINGER, AND THIS FILE HAD IT BACKWARDS.** It argued that Gaia is
 * allied to every seat and `Targeting.isValidTarget` refuses only ALLIES, so no
 * Meridian gun could ever level a relay block. That is true of ACQUISITION and
 * says nothing about DAMAGE: `Damage.applySplash` filters on
 * `Alive | PendingDestroy | Garrisoned` and nothing else, and an alliance buys
 * only `COMBAT_DAMAGE.friendlyFireMul` 0.5. Every lodging cell is inside the
 * block's splash catchment (`hitRadius` 7.211 m plus 1.4-1.6 m of blast), and
 * both armies carry a splash gun into exactly that fight. **How often it fires
 * in a played match is NOT MEASURED** — the mechanism and the per-shell
 * arithmetic are derived, the frequency needs a real game.
 *
 * It is authored because the alternative is an operation that becomes unwinnable
 * in silence and runs to nineteen minutes anyway, which is the failure
 * `t.infirmaryLost` in `soviets.06.demolition-order` argues against. **Each is
 * conjoined with `not(objectiveComplete)` on its own head**, because after a
 * head is lodged the slip is on the wire and the block can be levelled without
 * costing anything — and it WILL be, since a captured block is Allied and a
 * legal target for every gun the Order owns.
 *
 * **THE 20-SECOND SETTLE IS ABOUT A BUILD THAT FAILED, NOT A RACE.**
 * `entityDead` reads TRUE before the layout has stamped the tag, and so does
 * `ownerCount(max: 0)` on either branch — all of them would fire on tick one
 * against a build that placed nothing, in silence, before a word of the briefing
 * had played. (The untagged branch `t.beaten` uses reads the real alive list and
 * answers 19 on this ground, so it is only the empty-build case that needs
 * closing — which is exactly the failure worth reporting loudly rather than
 * losing to.) The world is finished before tick one, so any value above zero
 * closes it; twenty seconds is unmistakably past the build and unmistakably
 * short of anything being lost, since the earliest hostile order is `t.wave1` at
 * two minutes. The real gate on that failure is
 * `tests/campaign-roster-ground.spec.ts`, which builds this operation with the
 * roster armed AND the def tables bound — the only state in which a refused
 * structure is visible at all.
 *
 * ============================================================================
 * TWO PRIMARIES, WHICH IS A FIRST, AND WHY IT IS NOT ONE
 * ============================================================================
 * `validateCampaign` requires at least one primary and says nothing about the
 * count; `MAX_VISIBLE_OBJECTIVES` in `ui/Objectives.ts` is 3 and this operation
 * declares exactly three rows. The alternative was one primary reading
 * `ownerCount(player 0, role 'building', tag 'head', min: 2)` over a shared tag,
 * and it is **measurably wrong**: that condition is SIMULTANEOUS ownership, and a
 * captured relay block stops being Gaia's the instant it is taken — it becomes
 * an Allied building standing alone in Meridian ground, which under
 * `opening: 'force'` is the player's ONLY building and therefore the brain's
 * obvious target. Lose the first block before the second is lodged and the
 * count can never reach two again, because there are only two blocks and
 * `civApartments` has no route back into anybody's sidebar. The operation would
 * become unwinnable, silently, with every gate green.
 *
 * Two `structureCaptured` triggers writing two objectives is a LATCH instead:
 * `state.fired` retires a non-repeating trigger and
 * `CampaignSession.setObjective` refuses to un-resolve a resolved row, so a slip
 * that is lodged stays lodged whatever happens to the building afterwards. That
 * is also the truth of the fiction — the amendment is on the wire — and the two
 * agreeing is the reason this shape was chosen rather than tolerated.
 *
 * ============================================================================
 * THE PRESSURE, PRICED
 * ============================================================================
 * Four troops on the clock and two keyed to the player:
 *
 *     2:00    4 Wayfarers, 1 Solarch    1 500 credits   at ROAD, 87.2 m out
 *     6:30    4 Wayfarers, 2 Solarchs   2 300
 *     11:00   5 Wayfarers, 2 Solarchs   2 475
 *     15:30   5 Wayfarers, 3 Solarchs   3 275
 *     keyed   4 Wayfarers, 1 Solarch    1 500  x2, on the first lodging at
 *                                              each head
 *
 * **9 550 credits of hull as a floor and 12 550 if the player earns both keyed
 * troops**, against `allies.04.misclosure`'s 12 800 over sixteen minutes and
 * `soviets.05.short-allocation`'s 13 100 over seventeen. The floor is
 * deliberately below the band and the ceiling deliberately inside it, because
 * every credit in a defend arrives at ground the player is already standing on
 * and every credit here has to WALK to wherever the player has chosen to be —
 * 87.2 m of Track route to the arc head and **250.5 m to the yards head**, which
 * is 33.0 s at a Solarch's 7.6 m/s and 65.9 s at a Wayfarer's 3.8.
 *
 * The troops are a FLOOR on the pressure rather than the whole of it: the Order
 * has a base, a brain and nineteen minutes of mining, and
 * `orderTagged ... attackMove` is a heading rather than a leash —
 * `AiBrain.census` files every hull the seat owns into `armyIds` and
 * `regroupSquads` re-files it on the next pass, and a campaign tag lives in
 * `TagRegistry`, which the brain has never heard of.
 *
 * ============================================================================
 * `t.mercy` IS THE `OreCrisis` SHAPE AND IT IS NOT GENEROSITY
 * ============================================================================
 * With no man who can reach a door alive and a head still unlodged, this
 * operation cannot be won and cannot end until nineteen minutes — the dead end
 * `src/sim/OreCrisis.ts` was written for, in another costume. The answer is that
 * file's answer: a NARROW multi-clause predicate that redeems a standing
 * promise, and all of it must hold at once —
 *
 *     elapsed >= 6:00                       past the build, past `t.wave1`
 *     ownerCount(0, 'unit', 'section', 0)   every clerk is dead
 *     ownerCount(0, 'unit', 'screen', 0)    and every rifleman with him
 *     NOT (both heads lodged)               there is still something to lodge
 *
 * — and it fires ONCE, for two men, at `MUSTER`. `max: 0` with no `min` is
 * deliberate and is not the tick-one trap `soviets.02.common-standard` names: the
 * empty case is exactly the case being served, and `elapsed` is what closes the
 * hole. A build that placed no engineers at all would be rescued here rather
 * than failing in silence, which is the right direction for a rescue and the
 * wrong one for a gate — the gate is `campaign-roster-ground`.
 *
 * **THE SECOND CLAUSE IS THE GARRISON FIX AND WITHOUT IT THE RESCUE FIRED INTO A
 * DEAD END THAT NO LONGER EXISTS.** A rifleman lodges a head as surely as a
 * clerk does, so "the section is gone" is not a state that cannot finish the
 * list — measured on the real table, the old two-clause predicate fired at
 * 6:00 with all eight of the screen alive and both heads still open. What
 * genuinely cannot finish is a column down to ARMOUR: a hull cannot walk into a
 * relay block at any price, so the Wardens are deliberately untagged and the
 * rescue is keyed on the two tags that can. Staged both ways: section dead and
 * screen alive fires NOTHING; section and screen both dead fires `t.mercy` at
 * 6:00 with the Wardens still on the map.
 *
 * Two men against a list of two, with no escort and no third pair, is a
 * consolation and not a supply. That is the intent.
 *
 * ============================================================================
 * WHAT `parSec` 1140 IS AND WHAT IT IS NOT
 * ============================================================================
 * The authored par IS the deadline, to the second — the rule
 * `allies.03.ground-truth`, `allies.05.forced-closure`,
 * `soviets.05.short-allocation` and `soviets.06.demolition-order` all state about
 * their own, and the only way the field is falsifiable from inside the operation.
 * The chapter's ramp reaches 1140 here.
 *
 * **THE MOVEMENT FLOOR IS 137.4 SECONDS AND THE FIGHT IS UNMEASURED, AND THIS
 * FILE WILL NOT PRETEND OTHERWISE.** 246.0 m to the arc head plus 221.0 m on to
 * the yards head is 467.0 m at an engineer's 3.4 m/s — **12.1% of par**.
 * Everything else is the fight, and no harness in this repo can put a number on
 * that: `campaign-maps.spec.ts` builds the ground and does not fight on it, and
 * `op-harness` drives a brain that has never read a briefing.
 * `allies.03.ground-truth` says the same thing about its own three-minute window
 * and it is the honest thing to say.
 *
 * So a fast, correct line finishes well inside nineteen minutes, exactly as
 * A5's column can take the hall at minute nine. That is not a defect: **the
 * failure mode a force with no production actually has is hoarding**, and a
 * clock is the only thing that charges for it.
 *
 * ============================================================================
 * WHAT WAS CONSIDERED AND CUT
 * ============================================================================
 *   - **`primaryType: 'capture-hold'`.** It is the obvious shape for
 *     publication — hold the counter until the send — and it was cut on two
 *     grounds. A hold makes the operation about standing still, which is the one
 *     thing a fixed force is already forced into by `sim/Regen.ts` (2.5% of max
 *     per second after an 8 s idle delay), so the two would be the same idea
 *     twice; and it would make the block's survival decide the match, which
 *     hands the outcome to whether the Order's brain happened to shell an Allied
 *     building — see the two-primaries block above.
 *   - **A THIRD HEAD.** Three entries on the list reads better and costs a
 *     fourth objective row past `MAX_VISIBLE_OBJECTIVES`, plus another 200-odd
 *     metres of walking on a par that is already 88% fight. Two is the smallest
 *     number that is a LIST.
 *   - **PAYING THE SECONDARY IN CREDITS.** `ObjectiveDef.credits` is the shipped
 *     reward and it is worth exactly nothing to a player with no sidebar —
 *     `soviets.02.common-standard` reached the same answer and paid in hulls.
 *     This pays in hulls and in the one thing that is actually scarce: a man.
 *   - **A HIDDEN SECONDARY.** `briefingObjectives` filters hidden rows out, and
 *     the register has to be visible BEFORE the player decides which head to
 *     announce themselves at, because it stands 49.9 m of Foot route from the arc
 *     head and is therefore a decision about the same walk.
 *   - **`ignoreSeats`.** Two seats, both real, and the operation ends on its own
 *     triggers in every direction. A list would be inert.
 * ========================================================================== */

import { Faction } from '../../../core/types';
import { minutes, seconds } from '../../types';
import type { Condition, OperationDef } from '../../types';
import {
  ARC, ARC_AREA, MUSTER, REGISTER_AREA, ROAD, YARDS, YARDS_AREA,
} from '../../layouts/allies-fair-copy';

/**
 * THE GEOMETRY IS IMPORTED, NOT RESTATED.
 *
 * The trunk is placed by the layout and the troops are ordered at it by this
 * file, so the two modules have to agree about five points. A number written in
 * both is a number that will disagree the first time either is tuned, and the
 * failure — a troop attack-moving at empty ground, a reveal framing nothing — is
 * invisible to every gate. `layouts/allies-fair-copy.ts` owns the geometry; the
 * dependency runs operation -> layout and never back.
 */

/**
 * The guard on a build that failed rather than on a race. See the header:
 * `entityDead`, `ownerCount(max: 0)` and `playerBeaten` all read TRUE before the
 * layout has stamped anything.
 */
const SETTLE = seconds(20);

/** The book closes. `parSec` 1140 to the second — see the note on `parSec`. */
const CLOSE = minutes(19);

/** When the dead-end rescue may fire at the earliest. Past `t.wave1`. */
const RESCUE = minutes(6);

/**
 * Both slips are on the wire.
 *
 * `objectiveComplete` rather than a live count of what seat 0 owns, and the
 * header's two-primaries block is the argument: a lodged slip cannot be
 * un-lodged, and an owned building can be shot. Defined once because two
 * triggers must agree on it — `t.registerStanding` has to resolve on the same
 * tick as `t.win` and cannot be allowed to drift from it.
 */
const BOTH_LODGED: Condition = {
  on: 'all',
  of: [
    { on: 'objectiveComplete', id: 'arc' },
    { on: 'objectiveComplete', id: 'yards' },
  ],
};

/**
 * The same fact, ONE TICK EARLIER, and the three losses read this one.
 *
 * **`BOTH_LODGED` IS INVISIBLE ON THE TICK THE SECOND HEAD GOES OVER, AND THAT
 * COST THE PLAYER THE MATCH.** `CampaignSession.simTick` runs `runDirector` over
 * the WHOLE table and only then applies the effects it collected, so
 * `objectiveComplete` — which reads `state.objectives` — cannot become true
 * until the tick AFTER a `completeObjective` fires. `t.win` is two
 * `objectiveComplete` reads; `t.beaten` and `t.send` read the LIVE WORLD. So the
 * win and the losses were never true on the same tick and the file order the
 * header used to rest on could not arbitrate between them.
 *
 * Measured on the real built world with the real `WorldQuery`, seat 0 reduced to
 * one engineer who then turns the second door:
 *
 *     before   t701 fired [t.yards, t.beaten]  outcome=lost  reason "arc"
 *              objectives [arc complete, yards complete]
 *     after    t701 fired [t.yards]  then  t702 [t.noticedYards,
 *              t.registerStanding, t.win]  outcome=won
 *
 * `structureCaptured` is a world read and is therefore true on the SAME tick as
 * the lodging, which is what makes this work. The `objectiveComplete` half of
 * each pair is not redundant: a lodged block that is later LEVELLED loses its
 * tag, `structureCaptured` goes false again, and without the union a commander
 * who lost their first relay house to a shell would be beaten out of a match
 * they had already half won.
 */
const BOTH_ON_THE_WIRE: Condition = {
  on: 'all',
  of: [
    {
      on: 'any',
      of: [
        { on: 'structureCaptured', tag: 'arc', player: 0 },
        { on: 'objectiveComplete', id: 'arc' },
      ],
    },
    {
      on: 'any',
      of: [
        { on: 'structureCaptured', tag: 'yards', player: 0 },
        { on: 'objectiveComplete', id: 'yards' },
      ],
    },
  ],
};

const op: OperationDef = {
  id: 'allies.07.fair-copy',
  chapter: 'allies',
  faction: Faction.Allies,
  /*
   * THE MERIDIAN PACT, FOR THE SECOND TIME IN THIS CHAPTER, AND IT IS THE TURN
   * RATHER THAN A CHANGE OF SCENERY. (The chapter has now fought the Soviets
   * four times, the Reclamation once — `allies.06.machine-time` — and the Pact
   * twice. It varies its enemy where the Soviet chapter does not, and this is
   * the second time that has been the CONTENT rather than the variety.)
   *
   * `allies.03.ground-truth` established the Order as the one army whose reading
   * of the March already agrees with Bramm's appendix, and `pact.05.open-count`
   * ends with the Conclave holding a corroborated count it cannot PRESENT. An
   * operation about publication is exactly where those two facts collide, and
   * the collision is the content: the enemy here is not defending a wrong
   * number, they are defending their claim to a right one.
   *
   * It also pins the mechanics. Both keyed troops and all four timed ones spawn
   * literal `mrdWayfarer` and `mrdSolarch`, which `validateCampaign` refuses on
   * any seat that is not Meridian; the layout's `pillbox` resolves through
   * `ScenarioBuilder.keyFor` to the **Glaive Post**, whose `glaiveRepeater` has
   * 24 m of reach and carries `needsPower` — so the whole stand table in the
   * layout header, and the three-Solar-Array alternative above, are statements
   * about the Meridian column of that table. On a Soviet seat the same key is a
   * Sentry Gun at 22 m with `power: 0` and neither survives.
   *
   * `validateCampaign` refuses two adjacent operations that share a
   * `primaryType` and says nothing at all about `foe`. That asymmetry is right —
   * a chapter with one antagonist is a chapter and a chapter with one VERB is a
   * grind — but it means nothing mechanical is checking this line, so it is
   * argued here instead.
   */
  foe: Faction.Meridian,
  index: 7,
  title: 'Fair Copy',
  beat: 'The correction is finished and the continent has never read a model in its life — '
    + 'it reads what comes down the trunk at six, and somebody else lodged theirs first.',
  primaryType: 'fixed-force',
  /*
   * BESPOKE. Objective state, spawns, orders, reveals, dialogue, a camera move
   * and an announcer line — `types.ts` defines the archetype as "multiple effect
   * kinds", and this is nine of the eleven. The two it does not use are
   * `grantCredits` (a bank with no sidebar behind it is not a reward) and
   * `setObjective` (nothing here is hidden — see the cut list in the header).
   */
  archetype: 'bespoke',
  parSec: 1140,
  requires: ['allies.06.machine-time'],

  map: {
    /*
     * `temperate`, AND THE BIOME AGREES WITH IT — which they do NOT for
     * `arid`/`desert`, the one place the two vocabularies disagree. `getBiome`
     * answers an unknown name with a `console.warn` and TEMPERATE, so a mismatch
     * ships a different landform in silence and `reclamation.03.sold-twice` has
     * already paid for that. `MAP_PRESETS.temperate` and `BiomeName` share the
     * spelling, so this pairing is the safe one and is stated rather than
     * assumed.
     *
     * IT IS THE CHAPTER'S SECOND TEMPERATE GROUND AFTER A1, AND THAT IS A
     * CLOSING GESTURE RATHER THAN AN OMISSION. A1 took the first reading of this
     * schedule in a valley; six operations later the corrected one is carried
     * back across the same kind of ground to be posted. `relief` 0.42 against
     * `cliffs` 0.35 is the mildest combination in `MAP_PRESETS`, which is also
     * what a nineteen-minute walk with unarmed men wants: the layout's route
     * table is 246.0 / 289.5 / 221.0 m against straight-line 233.2 / 266.8 /
     * 214.0, so the ground costs between 3.3% and 8.5% and never traps. (The
     * third straight line is column-to-block and moved when the arc block did;
     * the route beside it was not re-measured. See the layout header.)
     */
    preset: 'temperate',
    biome: 'temperate',
    /*
     * CHOSEN BY SURVEY RATHER THAN BY DATE, exactly as A3, A4 and A5 chose
     * theirs.
     *
     * A5 pins 20 260 935 and each operation is a week on, so the convention
     * gives 20 260 949 for this one. Five rolls were built headless with THIS
     * operation's finished layout on them and scored on four things: whether all
     * five structures take their authored literal, how much of a 24 m disc is
     * passable at each of the two spawn points, whether every point of every
     * authored spawn ring is clear, and the Foot routes to the two heads.
     *
     *     20 260 949   the register takes its literal, but the yards head slides
     *                  6 m and the Foot route to it is 349.4 m — 60 m longer
     *                  than any other roll, on the one leg that is walked unarmed
     *     20 260 956   the register slides 6 m; `MUSTER` 302/317
     *     20 260 963   the register slides **26 m** and a post slides 12 m, which
     *                  walks the whole stand table; `MUSTER` 243/317
     *     20 260 970   **every literal taken at ring zero, ROAD 441/441, MUSTER
     *                  317/317, every authored ring clear**
     *     20 260 977   every literal taken, but `MUSTER` is 172/317 — 54% — and
     *                  the Foot route to the arc head is 271.8 m
     *
     * FIVE IS A SMALL SWEEP AND IT IS QUOTED AS ONE. A3 sampled eleven rolls and
     * A4 forty. This composition sits mostly between the two reserved start
     * shelves on the mildest preset in the game, so the spread between rolls is
     * narrow and the sweep was stopped when a clean one appeared. Anyone moving a
     * point in the layout should re-run it rather than assume the margin.
     *
     * Pinned by `tests/campaign-maps.spec.ts` as a terrain fingerprint: a
     * generator change that re-rolls this ground moves every distance above.
     */
    mapSeed: 20_260_970,
    /*
     * THE CHAPTER'S COUNTER IS +7 AN OPERATION (7 014, 7 021, 7 028, 7 035,
     * 7 042, and `allies.06.machine-time` takes 7 049), SO THE CONVENTION GIVES
     * 7 056 — AND IT IS SKIPPED, FOR THE PAIR IT DRAWS.
     *
     * `seatedSlots(2, 7056, null)` draws **[0, 2]**: an EDGE pair, 296.00 m
     * apart, both openings on the same short side with the whole northern half
     * of the map empty. That is the shape `allies.05.forced-closure` measured
     * and wanted for an assault, and it is the wrong one here — a force that
     * cannot replace a hull spends its entire clock deciding where its men are,
     * and it needs the map to be a distance. **7 063 is the next value on the
     * same counter that draws [0, 1]**, the antipodal pair at 386.16 m, which is
     * the diagonal A2 and A3 sit on.
     *
     * Verified rather than assumed: the whole layout was built headless on 7 049
     * and on 7 063 and every measured figure is IDENTICAL — same pair, same five
     * ring-zero landings, same 246.0 / 289.5 / 221.0 m of Foot route — because
     * `seatedSlots` is pure and this composition is placed by literals rather
     * than by `rng`. Sharing a simSeed with A6 would therefore have been
     * harmless; skipping to 7 063 is bookkeeping, not physics. Change this and
     * re-measure; do not re-read.
     */
    simSeed: 7_063,
    armies: 2,
    /*
     * `'force'`. The player has no Construction Yard, no factory, no harvester
     * and no bank; the layout builds a base for seat 1 only. See the
     * `fixed-force` block in the header — and note that `'force'` is NOT a
     * member of `START_CONDITIONS`, which is `['mcv','base']` and pinned by
     * `tests/match-start.spec.ts`. Adding a third member would put a "Fixed
     * force" row in the SKIRMISH lobby, where nothing calls `buildBaseFor` and
     * the player would get an army with no way to build. A layout honours it by
     * not making the call.
     */
    opening: 'force',
    /*
     * 0, AND IT BINDS BOTH SEATS — `Shell.applySimPostBoot` writes
     * `setup.startingCredits` into every non-Neutral slot.
     *
     * The player cannot spend a credit at any value, so the number is entirely a
     * statement about the ORDER: at zero their base is what `buildBaseFor`
     * placed and everything after it is mined. CLAUDE.md names the 10 000-credit
     * opening bank as the single measured cause of "the AI has a ready base" —
     * seven buildings and eleven troops by t+90 s having mined nothing — and an
     * operation whose player cannot produce at all must not be racing that.
     * `soviets.02.common-standard` reaches the same number by the same argument.
     *
     * **A KNOWN AND UNFIXABLE-FROM-HERE WART, INHERITED WITH THE OPENING.**
     * `sim/orecrisis.system.ts` carries no `scriptedRunning()` guard, so a player
     * who owns no refinery surveys as `Stranded` and gets one
     * `EvaLine.NoOreMiner` and one chip a few seconds in. It cannot rescue — the
     * rescue needs a finished refinery standing — so it is one wrong sentence
     * from the announcer and nothing else. Reported rather than dodged; the dodge
     * (hand the column a harvester so `harvesters > 0`) would put an unusable
     * vehicle in a fixed force to silence a chip.
     */
    credits: 0,
  },
  layout: 'allies-fair-copy',

  // NEITHER SHIPPED RULE MAY END THIS. See the header: annihilation would
  // declare a win with nothing lodged, and `assetLossDefeat` is STRICTLY WEAKER
  // than `t.beaten` here because a captured relay block is an asset.
  outcome: { annihilationWin: false, assetLossDefeat: false, ignoreSeats: [] },

  /*
   * AN ALLOW-LIST, SO TAGGED-AND-UNLISTED IS REFUSED FOR BOTH SEATS. Measured
   * against a control build with the roster cleared, two empty lists cost the
   * Order **two Sandskiffs, a Reliquary and a Helios Spire** — 14 units and 28
   * structures become 12 and 26 — and cost the player NOTHING, because there is
   * no base to withhold from and every key in the column is day-one open.
   *
   * THE SPIRE IS THE LOAD-BEARING ONE. `mrdHelios` reaches **33 m**; every
   * structure at the arc head is placed by the layout, and
   * `Placement.withinBuildRadius` gives a finished non-builder structure
   * `PLACEMENT.adjacencyRadius` 20 m plus its own radius, so the Order could
   * found one within about 26 m of the register — 21.7 m from the arc head, so
   * its 33 m covers all TEN lodging cells at once (the furthest is 8.25 m from
   * the head, i.e. 29.7 m of surface distance from such a tower) and shuts the
   * door this operation is made of, on a decision no author can see and no test
   * can read. Withheld, the longest structure weapon either army can put on that
   * ground is `glaiveRepeater` at 24 m, which is the two posts the layout already
   * placed, and the lodging-cell table stays true.
   *
   * The Sandskiff is the second reason and it is about the section: 9.2 m/s
   * against a Warden's 6.6, and a fixed force with five unarmed men in it has no
   * answer to a hull that can outrun every escort it owns.
   *
   * PROFILE-INDEPENDENT, so the ground is the same on a finished account as on a
   * fresh one — which a deny-list could not promise. `setCampaignRoster` is
   * consulted AHEAD of both the PvP suppression flag and the installed gate.
   */
  roster: { player: [], ai: [] },

  objectives: [
    /*
     * TWO PRIMARIES. See the header: the alternative is one row reading
     * `ownerCount(min: 2)` over a shared tag, which is SIMULTANEOUS ownership of
     * two buildings the Order is free to shell once they are Allied — an
     * operation that can become unwinnable in silence. Two rows plus the
     * secondary is exactly `MAX_VISIBLE_OBJECTIVES`.
     */
    {
      id: 'arc',
      kind: 'primary',
      title: 'Lodge the fair copy at the arc head',
    },
    {
      id: 'yards',
      kind: 'primary',
      title: 'Lodge the fair copy at the yards head',
    },
    /*
     * NO `credits` ON THIS ROW, AND IT IS DELIBERATE RATHER THAN AN OMISSION.
     * `ObjectiveDef.credits` pays through `Economy.grant` into a bank this
     * operation's player can never open — no yard, no factory, no sidebar. It is
     * paid in hulls and in a man instead, which is the only currency here;
     * `soviets.02.common-standard` refuses the same reward for the same reason.
     */
    {
      id: 'register',
      kind: 'secondary',
      title: 'Take the Order\'s field register off the wire',
    },
  ],

  triggers: [
    /* -- the brief, in five beats -----------------------------------------
     * Split across sixty-four seconds because the shell renders dialogue as
     * toasts and a stack of five at once is a stack nobody reads — and because
     * `Shell.campaignBeatSeq` no longer lets two lines from one speaker inside
     * six seconds eat each other, so every one of these really does appear. The
     * mechanic is in the third beat, in numbers this table can be checked
     * against: five men, two entries, one man an entry.
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
          text: 'You asked who sends them. Nobody does — the Works circular has gone down this '
            + 'trunk every evening since before the Split, and a clerk at a relay head puts on the '
            + 'wire whatever was lodged with him by six. The correction is written out fair and it '
            + 'is one sheet in one satchel until one of those clerks has it.',
        },
        { do: 'revealArea', player: 0, area: ARC_AREA },
        { do: 'cameraMove', at: ARC },
      ],
    },
    {
      id: 't.brief',
      when: { on: 'elapsed', ticks: seconds(18) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Wend',
          text: 'Two heads on this ground and the trunk repeats off both, so it has to be both. '
            + 'The arc head is two hundred and forty-six metres out with a pair of Glaive Posts sat '
            + 'on it. The yards head is two hundred and eighty-nine the other way, up the west '
            + 'side, and there is not a gun within a hundred and ninety metres of it — and two '
            + 'hundred and twenty-one between the pair of them, whichever order you take them '
            + 'in. Books close at nineteen minutes.',
        },
        { do: 'revealArea', player: 0, area: YARDS_AREA },
      ],
    },
    {
      id: 't.orders',
      when: { on: 'elapsed', ticks: seconds(32) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Aubray',
          text: 'A relay block is Works property and nobody\'s army. One man gets to the door and '
            + 'the slip is lodged — a clerk of ours who does not walk out again, or a rifleman who '
            + 'holds the room and hands it back when he leaves. Either way it is on the wire. The '
            + 'section is five men and there is no yard behind us, no factory and no money.',
        },
        { do: 'revealArea', player: 0, area: REGISTER_AREA },
        {
          do: 'dialogue',
          speaker: 'Wend',
          text: 'Their field register is fifty metres past the arc head — that is the copy they '
            + 'lodge from. Shoot it. It is a signal house with the Order sat in it, so no rifleman '
            + 'is walking into that one and no single clerk is either: four of ours, or the guns.',
        },
      ],
    },
    /* -- the enemy states his case ----------------------------------------
     * IN CLEAR, WHICH IS THE POINT OF HIM. An operation about publication whose
     * antagonist works in secret would be arguing with itself.
     */
    {
      id: 't.calvane',
      when: { on: 'elapsed', ticks: seconds(48) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Calvane, on the open net',
          text: 'Field Marshal. The Order lodged its own count at both heads eleven days ago and it '
            + 'goes down the trunk at six whether you are standing there or not. I am not disputing '
            + 'your arithmetic. I am disputing that it is yours.',
        },
      ],
    },
    /* -- and she agrees with him -------------------------------------------
     * The line this operation cannot work without, and the chapter's own
     * argument turned over: six operations of "a number is only worth its
     * instrument", answered by an instrument that is better than ours.
     */
    {
      id: 't.bramm',
      when: { on: 'elapsed', ticks: seconds(64) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Bramm, on the survey net',
          text: 'His series agrees with mine to the fourth decimal and it is four hundred years '
            + 'longer. That is not the argument. The argument is that a continent cannot paste two '
            + 'slips carrying one number, so this afternoon decides which of two right answers a '
            + 'refinery gets sited from. Log my objection, Field Marshal, and then go and post it.',
        },
      ],
    },

    /* -- the Order screens the near head -----------------------------------
     * Minute two, unconditional. A troop that fires only when the player is
     * elsewhere reads as the map cheating; a schedule the world keeps whatever
     * the player is doing reads as an opponent.
     *
     * LITERAL MERIDIAN KEYS. `EffectSink.spawnUnits` resolves through
     * `ProductionCatalog.byKey` and remaps nothing, unlike the layout's
     * `ScenarioBuilder.spawnUnit`; `validateCampaign` checks every key against
     * the army of the seat it lands on, so an Allied key here is a build error.
     */
    {
      id: 't.wave1',
      when: { on: 'elapsed', ticks: minutes(2) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Wend',
          text: 'First troop off their Conclave and onto the works road — five of them, eighty-seven '
            + 'metres from the arc head. Eleven seconds for the Solarch and twenty-three for the '
            + 'men.',
        },
        { do: 'spawnUnits', player: 1, key: 'mrdWayfarer', count: 4, at: ROAD, spread: 18, tag: 'wave1' },
        { do: 'spawnUnits', player: 1, key: 'mrdSolarch', count: 1, at: ROAD, spread: 12, tag: 'wave1' },
        { do: 'orderTagged', tag: 'wave1', order: 'attackMove', at: ARC },
      ],
    },

    /* -- the dead end, redeemed -------------------------------------------
     * See the header. Three clauses, all of which must hold, and it fires once.
     * `reinforcements` is the scripted `eva` `types.ts` names as earning its
     * place: `audio.system.ts` has no event for a scripted wave, so this is a
     * beat the announcer would otherwise have nothing to say about.
     * (`orecrisis.system.ts` does emit `EvaLine.Reinforcements` for the stranded
     * economy rescue and reaches the announcer through `EVA_LINE_ID`; the two
     * moments are minutes apart and `EVA_LINES.reinforcements` carries a
     * ten-second cooldown, so the overlap is harmless — recorded because
     * `soviets.06.demolition-order` had to correct the shorter claim.)
     *
     * `engineer` is a `Faction.Neutral` row in `FALLBACK_UNITS`, which is what
     * makes it legal on seat 0 under `validateCampaign`'s faction check.
     */
    {
      id: 't.mercy',
      when: {
        on: 'all',
        of: [
          { on: 'elapsed', ticks: RESCUE },
          { on: 'ownerCount', player: 0, role: 'unit', tag: 'section', max: 0 },
          { on: 'ownerCount', player: 0, role: 'unit', tag: 'screen', max: 0 },
          { on: 'not', of: BOTH_LODGED },
        ],
      },
      then: [
        { do: 'eva', line: 'reinforcements' },
        {
          do: 'dialogue',
          speaker: 'Aubray',
          text: 'The section is gone and the list is not finished. The Works found two more clerks '
            + 'and a boat and they are behind you at the ford. There is not a third pair, and '
            + 'nobody is coming after them.',
        },
        { do: 'spawnUnits', player: 0, key: 'engineer', count: 2, at: MUSTER, spread: 8, tag: 'relief' },
      ],
    },

    {
      id: 't.wave2',
      when: { on: 'elapsed', ticks: minutes(6.5) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Wend',
          text: 'Second troop, six of them, same road. They are feeding the head rather than '
            + 'defending the Conclave, which tells you what the wire is worth to them.',
        },
        { do: 'spawnUnits', player: 1, key: 'mrdWayfarer', count: 4, at: ROAD, spread: 18, tag: 'wave2' },
        { do: 'spawnUnits', player: 1, key: 'mrdSolarch', count: 2, at: ROAD, spread: 12, tag: 'wave2' },
        { do: 'orderTagged', tag: 'wave2', order: 'attackMove', at: ARC },
      ],
    },

    {
      id: 't.wave3',
      when: { on: 'elapsed', ticks: minutes(11) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Wend',
          text: 'Third troop, seven. Count what we have left against that and then tell me which '
            + 'head we are still going to.',
        },
        { do: 'spawnUnits', player: 1, key: 'mrdWayfarer', count: 5, at: ROAD, spread: 20, tag: 'wave3' },
        { do: 'spawnUnits', player: 1, key: 'mrdSolarch', count: 2, at: ROAD, spread: 12, tag: 'wave3' },
        { do: 'orderTagged', tag: 'wave3', order: 'attackMove', at: ARC },
      ],
    },

    {
      id: 't.wave4',
      when: { on: 'elapsed', ticks: minutes(15.5) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Wend',
          text: 'Everything the Conclave has spare, eight of them, and three and a half minutes on '
            + 'the books.',
        },
        { do: 'spawnUnits', player: 1, key: 'mrdWayfarer', count: 5, at: ROAD, spread: 20, tag: 'wave4' },
        { do: 'spawnUnits', player: 1, key: 'mrdSolarch', count: 3, at: ROAD, spread: 14, tag: 'wave4' },
        { do: 'orderTagged', tag: 'wave4', order: 'attackMove', at: ARC },
      ],
    },

    /* -- the register ------------------------------------------------------
     * `ownerCount ... max: 0` rather than `entityDead`, and the difference is
     * capture: an engineer who walks into the register satisfies this exactly as
     * levelling it does, which is what the title promises. It is four engineers
     * against 6.71 seconds of six Wardens and the file says so out loud at
     * thirty-two seconds, but the objective does not care which the player chose.
     *
     * ABOVE `t.win`, which is this file's ordering rule: `runDirector` returns
     * early once an outcome is set, so a secondary written below the win can
     * never resolve on the winning tick and the medal never counts it.
     *
     * IT PAYS IN HULLS AND IN A MAN, at `MUSTER`, 164.5 m of Foot route from the
     * arc head. That is a real walk and it is the honest price of a reward
     * arriving from behind: `soviets.02.common-standard` pays its secondary the
     * same way and for the same reason — there is nothing else to pay in.
     */
    {
      id: 't.registerTaken',
      when: {
        on: 'all',
        of: [
          { on: 'elapsed', ticks: SETTLE },
          { on: 'ownerCount', player: 1, role: 'building', tag: 'register', max: 0 },
        ],
      },
      then: [
        { do: 'completeObjective', id: 'register' },
        {
          do: 'dialogue',
          speaker: 'Wend',
          text: 'Field register is off them. Whatever the Order lodges after today, it will not be '
            + 'lodging it off the copy they had this morning.',
        },
        {
          do: 'dialogue',
          speaker: 'Aubray',
          text: 'Two Wardens and a clerk released against it, at the ford. Walk them up behind you '
            + '— they are the last thing that is coming.',
        },
        { do: 'spawnUnits', player: 0, key: 'grizzly', count: 2, at: MUSTER, spread: 12, tag: 'relief' },
        { do: 'spawnUnits', player: 0, key: 'engineer', count: 1, at: MUSTER, spread: 0, tag: 'relief' },
      ],
    },

    /* -- the cost of announcing yourself -----------------------------------
     * KEYED TO THE PLAYER RATHER THAN TO THE CLOCK, so the hinge sits in the
     * same place for a fast commander and a careful one — the shape
     * `soviets.02.common-standard` and `reclamation.02.written-off` both use.
     *
     * `objectiveComplete` is read against the state the Director sees at the
     * START of the tick, and `completeObjective` is applied by the sink after
     * every trigger has been evaluated — so these fire one tick AFTER the
     * lodging they answer, which is the correct ordering and not a race.
     *
     * ONE EACH WAY. Whichever head the player lodges first, the Order puts a
     * troop on the other one; a player who lodges both inside a tick of each
     * other earns both and has already won. Neither is a punishment for choosing
     * badly, because there is no badly — it is the fee for having chosen at all.
     */
    {
      id: 't.noticedArc',
      when: { on: 'objectiveComplete', id: 'arc' },
      then: [
        {
          do: 'dialogue',
          speaker: 'Calvane, on the open net',
          text: 'The arc head has gone over. Put a troop on the yards head and leave it there — he '
            + 'cannot lodge what he cannot walk to, and he has nothing left to make more men with.',
        },
        {
          do: 'spawnUnits', player: 1, key: 'mrdWayfarer',
          count: 4, at: ROAD, spread: 18, tag: 'watchYards',
        },
        {
          do: 'spawnUnits', player: 1, key: 'mrdSolarch',
          count: 1, at: ROAD, spread: 12, tag: 'watchYards',
        },
        { do: 'orderTagged', tag: 'watchYards', order: 'attackMove', at: YARDS },
      ],
    },
    {
      id: 't.noticedYards',
      when: { on: 'objectiveComplete', id: 'yards' },
      then: [
        {
          do: 'dialogue',
          speaker: 'Calvane, on the open net',
          text: 'The yards head is his, and the yards are half the argument. Then it is the arc head '
            + 'or nothing, and the arc head has two guns on it.',
        },
        {
          do: 'spawnUnits', player: 1, key: 'mrdWayfarer', count: 4, at: ROAD, spread: 18, tag: 'watchArc',
        },
        {
          do: 'spawnUnits', player: 1, key: 'mrdSolarch', count: 1, at: ROAD, spread: 12, tag: 'watchArc',
        },
        { do: 'orderTagged', tag: 'watchArc', order: 'attackMove', at: ARC },
      ],
    },

    /* -- the two lodgings --------------------------------------------------
     * `structureCaptured` is `ownerOfTag(tag) === player`, and for a GAIA
     * structure that means one engineer arrived and was spent — `Capture.ts`
     * rule 1, no health gate. These are LATCHES: a non-repeating trigger is
     * retired by `state.fired` and `CampaignSession.setObjective` refuses to
     * un-resolve a resolved row, so a slip that is lodged stays lodged even when
     * the block is levelled afterwards. That is the whole reason there are two
     * primaries rather than one count — see the header.
     *
     * BOTH ABOVE `t.win`, which fires on the tick after the second of them.
     */
    {
      id: 't.arc',
      when: { on: 'structureCaptured', tag: 'arc', player: 0 },
      then: [
        { do: 'completeObjective', id: 'arc' },
        {
          do: 'dialogue',
          speaker: 'Aubray',
          text: 'Arc head is lodged. Every siting office east of the mills opens its book tomorrow '
            + 'to our amendment and not to theirs.',
        },
      ],
    },
    {
      id: 't.yards',
      when: { on: 'structureCaptured', tag: 'yards', player: 0 },
      then: [
        { do: 'completeObjective', id: 'yards' },
        {
          do: 'dialogue',
          speaker: 'Aubray',
          text: 'Yards head is lodged. That is the plate yards and everything that sites off them.',
        },
      ],
    },

    /* -- the register, unresolved at the finish ---------------------------
     * The same shape as `allies.05.forced-closure`'s `t.storeStanding`: a row
     * left `active` when the operation ends reads on the debrief as unfinished
     * rather than as missed. It cannot wrongly fire on a register already taken —
     * that row is `complete` by then and `CampaignSession.setObjective` refuses
     * to un-resolve a resolved row.
     */
    {
      id: 't.registerStanding',
      when: {
        on: 'all',
        of: [BOTH_LODGED, { on: 'ownerCount', player: 1, role: 'building', tag: 'register', min: 1 }],
      },
      then: [{ do: 'failObjective', id: 'register' }],
    },

    /* -- the close, telegraphed -------------------------------------------- */
    {
      id: 't.closing',
      when: { on: 'elapsed', ticks: minutes(18) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Aubray',
          text: 'One minute. Whatever is on those two counters at six is what the continent pastes '
            + 'into its books, and nothing after that is an argument any of us get to have.',
        },
      ],
    },

    /* -- both slips are on the wire ---------------------------------------
     * **ABOVE THE FOUR LOSSES, AND FILE ORDER IS NOT WHAT SAVES IT.** This
     * comment used to say it was: *"a commander whose LAST unit is the engineer
     * who turns the second door … both of those are wins and the file order is
     * what says so."* It is not, because `t.win` and the losses are never true on
     * the same tick. `runDirector` walks the WHOLE table and `CampaignSession`
     * applies the effects afterwards, so `objectiveComplete` — which `t.win` is
     * two of — cannot be true until the tick AFTER `completeObjective` fires,
     * while `playerBeaten` and `elapsed` read the live world NOW. Measured: the
     * last engineer turns the second door, `Capture.ts#consume` spends him, and
     * tick N fired `[t.yards, t.beaten] -> lost` with both primaries showing
     * `complete` on the debrief.
     *
     * The fix is `BOTH_ON_THE_WIRE` on `t.send` and `t.beaten` — a WORLD read
     * that is true on the same tick — and the same staging now reads
     * `t701 [t.yards]` then `t702 [t.noticedYards, t.registerStanding, t.win]
     * -> won`. File order still decides between the two head-loss triggers and
     * the win, and there it is real; `allies.05.forced-closure` inverts the
     * house convention for the same reason and records it.
     *
     * AND IT DOES NOT END THE CHAPTER. Two of nine are still to come, and
     * Bramm's second line is the reason: the chain is not the Allies', it sends
     * what is lodged with it, and the Ninth can lodge again on Monday. One
     * edition is not a standard.
     */
    {
      id: 't.win',
      when: BOTH_LODGED,
      then: [
        {
          do: 'dialogue',
          speaker: 'Aubray',
          text: 'Both heads carry it. Every yard on the continent opens tomorrow to a number '
            + 'somebody closed, with the misclosure printed under it where anybody can check the '
            + 'working.',
        },
        {
          do: 'dialogue',
          speaker: 'Bramm, on the survey net',
          text: 'For one edition. That chain is not ours and never was — it sends what is lodged '
            + 'with it, by whoever walks in, and the Ninth can walk in on Monday. Get me something '
            + 'they will still be checking it against in a year.',
        },
        { do: 'endOperation', result: 'win' },
      ],
    },

    /* -- a way of publishing, shot -----------------------------------------
     * A LIVE HAZARD FROM ORDINARY COMBAT, WHICH IS NOT WHAT THIS FILE USED TO
     * SAY. Both headers claimed that nobody but the player could damage a relay
     * block, because Gaia is allied to every seat and `Targeting.isValidTarget`
     * refuses only ALLIES. That is true of ACQUISITION and false of DAMAGE:
     * `Damage.applySplash` filters its victims on `Alive | PendingDestroy |
     * Garrisoned` and nothing else, and the only thing an alliance buys is
     * `COMBAT_DAMAGE.friendlyFireMul` 0.5. Every splash weapon on this map
     * therefore damages the heads, the Order's `focusLance` included. The layout
     * header carries the per-shell arithmetic and the catchment.
     *
     * TWO TRIGGERS RATHER THAN ONE, AND THE REASON IS THE DEBRIEF.
     * `EndScreen.campaignLine` resolves `reason` by ID and only falls back to
     * "the first failed primary" when the id matches nothing — so a single
     * trigger carrying `reason: 'arc'` printed *"Lodge the fair copy at the arc
     * head — not achieved"* over a green tick on that same row whenever the
     * YARDS block was the one that died. The condition tree already had the
     * split; the effects did not.
     *
     * `not(objectiveComplete)` on each head is the load-bearing half. After a
     * head is lodged the slip is on the wire, the block is an ordinary Allied
     * building standing alone in Meridian ground, and it will be shelled — which
     * must cost nothing at all. `entityDead` also reads TRUE before the layout
     * has stamped the tag, which is what `SETTLE` closes.
     */
    {
      id: 't.arcLost',
      when: {
        on: 'all',
        of: [
          { on: 'elapsed', ticks: SETTLE },
          { on: 'entityDead', tag: 'arc' },
          { on: 'not', of: { on: 'objectiveComplete', id: 'arc' } },
        ],
      },
      then: [
        { do: 'failObjective', id: 'arc' },
        { do: 'failObjective', id: 'yards' },
        {
          do: 'dialogue',
          speaker: 'Aubray',
          text: 'The arc head is rubble. There is not a second counter this side of the mills and '
            + 'no army in the field builds relay houses — ours or theirs, whoever put the shell '
            + 'through it. The correction stays in the satchel.',
        },
        { do: 'endOperation', result: 'loss', reason: 'arc' },
      ],
    },
    {
      id: 't.yardsLost',
      when: {
        on: 'all',
        of: [
          { on: 'elapsed', ticks: SETTLE },
          { on: 'entityDead', tag: 'yards' },
          { on: 'not', of: { on: 'objectiveComplete', id: 'yards' } },
        ],
      },
      then: [
        { do: 'failObjective', id: 'arc' },
        { do: 'failObjective', id: 'yards' },
        {
          do: 'dialogue',
          speaker: 'Aubray',
          text: 'The yards head is rubble, and the yards are half the argument. There is not a '
            + 'second counter this side of the mills and no army in the field builds relay houses. '
            + 'The correction stays in the satchel.',
        },
        { do: 'endOperation', result: 'loss', reason: 'yards' },
      ],
    },

    /* -- the books close ---------------------------------------------------
     * The hard deadline, at `parSec` to the second. It fails all three rows: the
     * secondary cannot be collected after the operation is over, and failing one
     * that is already complete is a no-op because a resolved row does not
     * un-resolve.
     *
     * NO `reason`, AND THAT IS THE FIX RATHER THAN AN OMISSION. This operation
     * has TWO primaries and cannot know statically which one is outstanding, so
     * a fixed id was wrong in half the branches by construction — a player who
     * lodged the arc head and ran out of clock on the walk to the yards head read
     * *"Lodge the fair copy at the arc head — not achieved"* on the debrief,
     * directly above a tick on that row. `EndScreen.campaignLine` falls back to
     * `objectives.find(status === 'failed' && kind === 'primary')` when the
     * reason matches no row, and the two `failObjective` calls immediately above
     * are what make that fallback correct: a lodged head stays `complete`, the
     * outstanding one becomes `failed`, and the fallback names it.
     *
     * `not(BOTH_ON_THE_WIRE)` for the reason given at that constant: a section
     * that turns the second door on the closing tick has published, and
     * `objectiveComplete` cannot see it until the tick after.
     */
    {
      id: 't.send',
      when: {
        on: 'all',
        of: [
          { on: 'elapsed', ticks: CLOSE },
          { on: 'not', of: BOTH_ON_THE_WIRE },
        ],
      },
      then: [
        { do: 'failObjective', id: 'arc' },
        { do: 'failObjective', id: 'yards' },
        { do: 'failObjective', id: 'register' },
        {
          do: 'dialogue',
          speaker: 'Aubray',
          text: 'Six o\'clock. The counters are shut and the Order\'s slip is going down the trunk — '
            + 'a true number, published by somebody else, and every refinery on the continent sited '
            + 'off a schedule we are now only allowed to agree with.',
        },
        { do: 'endOperation', result: 'loss' },
      ],
    },

    /* -- the ordinary loss --------------------------------------------------
     * **`playerBeaten` IS NOT "NO UNITS LEFT", AND THIS TRIGGER USED TO SAY IT
     * WAS.** `Viability.surveyViability` §HELD deliberately books an
     * `EntityFlag.Garrisoned` occupant into `heldUnits` rather than
     * `contestingUnits`, under a comment naming the reasoning — *"a garrison is
     * an emplacement whose firepower happens to be stored in five entities"*.
     * With `canRebuild` permanently false under `opening: 'force'`, `isBeaten`
     * therefore reduces to **"no units OUTSIDE a building"** — and this
     * operation puts two garrisonable strongpoints on its two objectives and
     * issues eight riflemen. A commander who parked their last two men inside a
     * relay head lost the match on the next tick with those men alive, unhurt
     * and standing on the objective.
     *
     * `ownerCount(role 'unit', max: 0)` is the honest spelling of the sentence
     * the header always wanted: `runtime.ts`'s untagged branch walks
     * `store.alive`, filters `PendingDestroy` and `UnderConstruction` and asks
     * nothing about `Garrisoned`, so a man indoors still counts. It is also
     * STRICTLY STRONGER than `playerBeaten` here — no units at all implies
     * nothing to contest with, and a captured `civApartments` carries no
     * producer flag so there was never anything to rebuild with — which is why
     * the two are not conjoined.
     *
     * A BARE `max: 0` IS THE TICK-ONE TRAP ONLY ON THE TAGGED BRANCH. This is
     * the untagged one and reads the real alive list, so it answers 19 on tick
     * one; `SETTLE` is still conjoined because a build that placed NOTHING would
     * answer 0, and that failure has to be reported by
     * `campaign-roster-ground.spec.ts` rather than by a silent defeat.
     *
     * It stays deliberately WIDER than `assetLossDefeat`, which counts Building,
     * Vehicle AND Infantry and would keep a commander with a captured relay
     * block and no men at all alive in a match they cannot finish.
     *
     * No `reason`, and `not(BOTH_ON_THE_WIRE)` — both for the reasons written
     * over `t.send` and over `BOTH_ON_THE_WIRE` itself.
     */
    {
      id: 't.beaten',
      when: {
        on: 'all',
        of: [
          { on: 'elapsed', ticks: SETTLE },
          { on: 'ownerCount', player: 0, role: 'unit', max: 0 },
          { on: 'not', of: BOTH_ON_THE_WIRE },
        ],
      },
      then: [
        { do: 'failObjective', id: 'arc' },
        { do: 'failObjective', id: 'yards' },
        {
          do: 'dialogue',
          speaker: 'Wend',
          text: 'Nothing answering anywhere on the seam. The section is gone and the fair copy is a '
            + 'satchel lying in open country.',
        },
        { do: 'endOperation', result: 'loss' },
      ],
    },
  ],
};

export default op;
