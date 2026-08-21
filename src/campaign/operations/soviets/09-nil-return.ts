/**
 * ============================================================================
 * S9 — NIL RETURN
 * ============================================================================
 * S7 took the record. S8 put the dispute somewhere the record could not follow
 * it: the Ninth is wound up, the file is at a Continental office that has never
 * seen this ground, and what answers a file at that height is not another
 * administration but an establishment — a standing force that arrives with the
 * schedule already decided and a certificate already drafted. The seam is being
 * worked openly by now. It is an output, not a survey, and it cannot be quietly
 * shut off.
 *
 * So they are not here to shut it off. They are here to write that it was never
 * on.
 *
 * **THE WHOLE CHAPTER HAS BEEN DECIDED ON PAPER AFTERWARDS BY WHOEVER HELD THE
 * PAPER, AND WE HOLD THE PAPER NOW.** That is exactly why this operation is not
 * another base fight. Winning one would settle nothing here, because a
 * Continental office re-reading the sector's history out of a document it did
 * not write can simply decline to believe it — which is what an office at that
 * height is FOR. The one thing that survives being re-read by somebody who was not
 * there is a DELIVERED QUARTER — a figure, weighed, banked, and entered against
 * the record the sector already holds. The chapter blurb has said so since S1
 * and nobody meant it literally: *"the yards are told it is an output problem"*.
 * This is the operation where it finally is one, and where answering it is how
 * the ground and the record are made to say the same thing.
 *
 * ============================================================================
 * WHY `primaryType: 'economy'`, AND WHAT IT HAS TO DIFFER FROM
 * ============================================================================
 * Hold the Seam has spent assault, fixed-force, race, capture-hold, defend,
 * superweapon, infiltrate and escort, and `validateCampaign` refuses only
 * ADJACENT repeats — so the constraint is content rather than the validator, and
 * `economy` is the one shape this chapter has never taken.
 *
 * **IT IS NOT NEW TO THE CAMPAIGN, AND THE OPERATION IT HAS TO DIFFER FROM IS
 * `reclamation.02.written-off`.** R2 is `economy`, its primary is
 * `credits: { player: 0, min: 16000 }`, and it establishes the two readings this
 * file INHERITS rather than invents: that a `credits` threshold is a BANK and not
 * an earnings total, so *"the objective and the build queue are the same number
 * counted twice"*; and that `Economy.deposit` clamps a harvest into
 * `storageMax - credits` and wastes the rest, so the ceiling is part of the
 * objective. Restating either as a discovery here would be exactly the drift
 * `docs/SPEC_DRIFT_AUDIT.md` catalogues.
 *
 * Three things differ, and each is a decision rather than a different number:
 *
 *   - **R2's GAP IS ONE SILO AND THIS ONE'S IS TEN.** Its ceiling is 15 000
 *     against a 16 000 objective, so its own header can say the fix "costs 150
 *     credits or one capture" and the ceiling is a trap to notice once. Here the
 *     ceiling is the same 15 000 against 30 000 — ten `oreSilo`, and, measured,
 *     all but five points of the sector's power headroom on the line where no
 *     bounty lands at a ceiling (four silos and +65 on the line where the hidden
 *     one does; the block below measures both). It is not a trap; it is the
 *     build order.
 *   - **R2 HAS DELIBERATELY NO TIMER AND THIS ONE IS A DEADLINE.** Its pressure
 *     is a Soviet base growing across the field for fourteen minutes; this one
 *     closes at twenty-two because a quarter closes, which turns every purchase
 *     into a question about PAYBACK rather than only about price.
 *   - **R2's INCOME IS HAULAGE AND THIS ONE'S IS MAJORITY CIVILIAN.** 16 230 to
 *     26 400 of the thirty thousand comes off four `civOreMine` at five credits
 *     a second — a band, not a figure, because the win floor lets the far pair
 *     go and the block below derives when it does — and those are STRUCTURES, so
 *     this operation defends buildings rather than round trips, and its win
 *     carries a ground clause as well as a figure.
 *
 * **A CREDIT THRESHOLD IS A BANK, NOT AN EARNINGS TOTAL**, which is R2's reading
 * and the reason the shape works at all: `WorldQuery.creditsOf` reads
 * `world.players[p].credits`, what is in hand at that instant, so every tank the
 * player buys is subtracted from the answer and every credit spent has to be
 * earned twice.
 *
 * **AND NOTHING HERE NEEDS THE COMPLEMENT OF A `credits` READ, WHICH IS THE ONE
 * TRAP IN THE CONDITION.** `reclamation.05.closing-entry` records it:
 * `PlayerState.credits` is a FLOAT — `deposit` adds a harvest that accumulates in
 * `SIM_DT` steps and nothing pins the running total to an integer — so
 * `min: 17000` and `max: 16999` are not complements, a balance of 16 999.5
 * satisfies neither, and against a deadline that is an operation that cannot
 * end. Both reads in this file are `min` only, and the interim's miss is
 * partitioned on the CLOCK instead, which is a tick count and partitions exactly.
 *
 * ============================================================================
 * THE RETURN IS THIRTY THOUSAND AND THE YARDS HOLD FIFTEEN
 * ============================================================================
 * **THE OPERATION'S CENTRAL FACT IS A CEILING, AND `reclamation.02.written-off`
 * GOT THERE FIRST.** What is new here is the SIZE of the gap and what closing it
 * costs in POWER rather than in credits. Measured on the built world through a
 * real `Economy` with the real `storageForSlot` resolver installed:
 *
 *     STORAGE_BASE (`capFloor` at tick zero)                    10 000
 *     structural storage of the opening base                     5 000
 *         refinery 2000 + two `oreSilo` at 1500
 *     seat 0 `storageMax` at tick zero                          15 000
 *
 * `Economy.deposit` WASTES the overflow — it banks `min(amount, room)` and
 * counts the rest into `oreWasted` — so a sector sitting at fifteen thousand
 * throws away every credit it mines until somebody builds somewhere to put it.
 * The return is **thirty thousand**, which is 15 000 short of that ceiling, and
 * 15 000 is **exactly ten `oreSilo`**:
 *
 *     ten silos    1500 credits    50 s of queue    -100 power
 *     against the opening base's measured                 +105 net power
 *     leaving                                              +5
 *
 * So the storage the return needs costs five percent of the return in credits
 * and **all but five points of the sector's power headroom**. The next structure
 * of any kind — a barracks, a second refinery, one more silo — puts the yards
 * into deficit, which stops the unit tabs and sheds the coil line, and the
 * answer is a `powerPlant` at 300 credits for +100. The quarter is not short of
 * ore. It is short of headroom, and that is the sentence the operation is built
 * to make a player feel.
 *
 * **BUT TEN IS THE BILL ON ONE LINE OF PLAY AND NOT ON EVERY LINE, AND THE
 * DIFFERENCE IS A RATCHET IN `Economy` THAT THE FIRST DRAFT OF THIS FILE
 * MEASURED AND THEN UNDERSTATED.** `ObjectiveDef.credits` pays through
 * `Economy.grant` -> `refund` -> `liftFloorFor`, and `liftFloorFor` does not add
 * the bounty to the ceiling — it RE-BASES `capFloor` on the whole balance and
 * re-adds structural storage on top, so a payout landing while the bank is full
 * lifts the ceiling by `amount + structural` and `recomputeStorage`
 * (`Economy.ts` §2, `capFloor[p] = pl.credits`) then keeps it. Driven through
 * the shipped `Economy` with the real `storageForSlot` resolver, seat 0's own
 * opening structural of 5000:
 *
 *     extra silos built   0        2        3        4        7
 *     ceiling         15 000   18 000   19 500   21 000   25 500
 *
 *     the hidden 600 collected while the bank is AT that ceiling
 *     new ceiling     20 600   26 600   29 600   32 600   41 600
 *
 * Four extra silos is therefore enough on its own if the office is taken at a
 * full bank — 32 600 clears the thirty thousand outright, and three does not
 * (29 600, four hundred short) — so the real bill is a band and not a number:
 *
 *     no bounty lands at a ceiling   10 silos   1500 cr   -100 power   leaves  +5
 *     the hidden 600 does             4 silos    600 cr    -40 power   leaves +65
 *
 * (+25 rather than +65 if the office is CAPTURED rather than levelled — it is a
 * `radar` and brings its own -40 onto the captor's grid. The hidden-secondary
 * block prices that; the lift itself is the same either way.)
 *
 * **The ten-silo line is the operation's charge and the four-silo line is what
 * the hidden secondary is really worth.** Its face value is 600 credits; taken
 * against a full bank it is also six silos and sixty points of power, which is
 * more than any purchase in the file. That is recorded rather than removed —
 * both payout routes in the vocabulary (`ObjectiveDef.credits` and
 * `grantCredits`) are the same `grant`, so the ratchet cannot be authored away,
 * and a discount a player has to earn by crossing the map is the right shape for
 * one. A sale or a cancelled build refunds through the same `refund` and lifts
 * the same way; nothing here can stop that either.
 *
 * **WHAT THE FIRST DRAFT GOT WRONG IS WORTH KEEPING, BECAUSE IT IS THE SHAPE OF
 * THE MISTAKE AND NOT ONLY A DIGIT.** It quoted "a player sitting at exactly
 * 15 000 who collects the SHOWN secondary's 500 comes out at credits 15 500 and
 * `storageMax` 20 500". The arithmetic is right and the STATE IS UNREACHABLE:
 * the shown secondary asks for a bank a 15 000 ceiling cannot hold, so nobody
 * ever collects it there. The reachable version of that shape is the HIDDEN 600
 * at the bare opening ceiling, measured at **15 600 and `storageMax` 20 600** —
 * and having recorded the lift on a state that cannot happen, the file then
 * concluded the lift did not matter, which is exactly how the shown secondary
 * came to be authored ON a ceiling. The next block is that defect.
 *
 * ============================================================================
 * WHAT THE SECTOR EARNS, AND THEREFORE WHAT IT MAY SPEND
 * ============================================================================
 * Two sources, both measured, neither authored here:
 *
 *   - **the seam heads.** `CIVILIAN_MINE_INCOME` is 5 credits a second per
 *     `civOreMine`, so four is 1200 a minute, from structures the player already
 *     owns and only has to keep. **It is a BAND and not 26 400** — see below.
 *   - **the ore.** `src/data/Civilians.ts` records the MEASURED harvester as
 *     **429 to 700 credits a minute** (`tests/harvester-soak.spec.ts`, twelve
 *     hulls over three seeds) rather than the 1312 the constants imply, and the
 *     opening base ships two. Over twenty-two minutes that is **18 876 to
 *     30 800**, against 45 219 credits of ore inside the player's reach — the
 *     layout seeds and counts both fields.
 *
 * **THE HEAD FIGURE IS NOT FIXED, AND AN EARLIER DRAFT OF THIS BLOCK DERIVED THE
 * WHOLE BUDGET FROM ITS BEST CASE.** 26 400 is four heads alive for all 1320
 * seconds, and the same two files argue at length that losing the far pair is
 * expected and priced in — the win floor is `min: 2` for exactly that reason. So
 * the operation has two income lines, and the low one is the one a player is
 * actually spending against.
 *
 * The far pair's clock is `t.survey`, and it is arithmetic off the layout's own
 * measured geometry rather than a guess: the minute-four column forms at ROAD_A
 * and attack-moves to SEAM_FAR, a 120.93 m leg whose closest approach to
 * HEAD_FOUR is **17.66 m at 70.06 m along** — so the infantry (`gi` maxSpeed
 * 3.2) is in contact at **+21.9 s** and the Grizzlies (6.6) at +10.6 s. At the
 * layout's measured 62.46 dps against 700 hp of Concrete that is 11.21 s a head,
 * plus 60.00 m between the far heads at 3.2 m/s:
 *
 *     21.9 + 11.21 + 18.75 + 11.21 = 63.07 s  ->  the far pair is down at t+5:03
 *
 *     four heads held      4 x 300 x 22.0                        = 26 400
 *     far pair lost 5:03   4 x 300 x 5.05  +  2 x 300 x 16.95    = 16 230
 *
 * Against the ten-silo bill and the thirty thousand held back:
 *
 *     four heads held   gross 50 276 - 62 200   army budget 18 776 - 30 700
 *                                                          853 - 1395 a minute
 *     far pair lost     gross 40 106 - 52 030   army budget  8 606 - 20 530
 *                                                          391 -  933 a minute
 *
 * A Rhino is 900. A Sentry Gun is 400. On the low line that is **one Anvil Tank
 * every two and a third minutes**, which is the rate the operation is actually
 * tight at. (On the four-silo line of the previous block, add 900 to both
 * budgets.)
 *
 * **AND THE TWO ROWS ARE NOT TWO ENDS OF ONE PLAYER'S CHOICE**, which is the
 * other thing the earlier draft got wrong when it attached the high figure to "a
 * player who buys nothing at all". A player who buys nothing buys no defence,
 * loses the far pair on the clock derived above, and therefore does not collect
 * the income the high row is built from. The top row is bought with the bottom
 * row's budget; that circularity IS the operation.
 *
 * **THE STRONGEST PURCHASE IN THE FILE IS A HARVESTER AND IT COMPETES DIRECTLY
 * WITH THE ARMY.** 1400 credits, sixteen seconds, and it returns 429 to 700 a
 * minute — a payback of **two to three and a quarter minutes**, so one bought at
 * minute two is worth 8580 to 14 000 by the close and one bought in the last
 * three returns 1287 to 2100 against a price of 1400, which is a coin flip on the
 * band rather than an investment. Nothing in the trigger table says this.
 * The player either notices that the deadline is also an interest rate or they
 * do not, and both are legitimate ways to play an operation about output.
 *
 * ============================================================================
 * THE SHOWN SECONDARY IS SEVENTEEN THOUSAND, AND IT IS A WINDOW RATHER THAN A
 * POINT — WHICH IS THE HALF THE FIRST DRAFT MISSED
 * ============================================================================
 * The interim exists to make the player build the first two silos before the
 * twelve-minute bell, and it is the only thing in the operation that can: the
 * twelve conditions cannot see a structure the player built, so an objective
 * about storage has to be written as an objective about a bank the storage makes
 * possible. Two silos is **300 credits and ten seconds**, which is the cheapest
 * five hundred credits in this file and the one nobody thinks of.
 *
 * **IT WAS AUTHORED AT 18 000 AND THAT IS EXACTLY THE CEILING TWO SILOS BUY, SO
 * THE OPERATION WAS STEERING THE PLAYER INTO ITS OWN RATCHET.** `deposit` clamps
 * a harvest into `storageMax - credits` and wastes the rest, so a player working
 * toward an 18 000 objective with a two-silo 18 000 ceiling sits at exactly the
 * cap when the threshold is met; the 500 then lands on a full bank and
 * `liftFloorFor` fires by construction. Measured through the shipped `Economy`:
 * the ceiling goes **18 000 -> 26 500**, and the ten-silo bill the operation is
 * built on collapses to five (750 credits, -50 power) with no insight required
 * — it is what happens if you do the thing the objective's own title asks for.
 *
 * So the threshold is a WINDOW, and the two bounds are arithmetic:
 *
 *     above the ONE-silo ceiling   > 16 500   or one silo is enough and the
 *                                             objective stops meaning "two"
 *     clear of the TWO-silo one    < 17 500   so bank + 500 <= 18 000 and
 *                                             `liftFloorFor` returns at its
 *                                             own `credits <= storageMax` guard
 *
 * **17 000 is the round figure inside it**, and the 500 credits of slack under
 * the upper bound is the overshoot budget: the trigger fires on the first tick
 * the bank crosses 17 000 and the sink pays on that same tick (effects are
 * applied where `campaign.system.ts` drains them, at Cleanup of the tick that
 * produced them), so the only thing that can push the payout over 18 000 is one
 * tick of income. One tick at the opening is 41.2 credits — 20 from the four
 * heads on their `intervalTicks` 30 boundary plus 10.606 from each docked hauler
 * (`HARVESTER_CAPACITY / UNLOAD_SECONDS * SIM_DT`) — so it would take
 * forty-five haulers unloading simultaneously to spend the slack. Driven in the
 * rig at 17 000 and again at 17 105 (a full tick of four heads and eight
 * haulers): **credits 17 500 and 17 605, `storageMax` 18 000, unmoved.**
 *
 * It is SHOWN rather than hidden, and the reason is that it is a DEADLINE: a
 * clock nobody has mentioned is a clock nobody can aim at.
 * `soviets.04.company-town`'s `prompt` — "three derricks working inside two and
 * a half minutes" — is shown for the same reason.
 * `soviets.07.right-of-entry`'s `clean` is the counter-example that proves the
 * rule rather than breaking it: it is also a clock, and it is hidden because it
 * is DISCLOSED at minute three, before the window it measures can open.
 *
 * ============================================================================
 * AND THE HIDDEN ONE IS THEIR RETURN, WHICH IS THE CHAPTER'S OWN JOKE
 * ============================================================================
 * `paper` pays 600 for taking the establishment's field office off them —
 * `ownerCount(1, 'building', 'filing', max: 0)`, so a gun answers it and so do
 * four engineers. It is disclosed at three and a half minutes, before the first
 * wave and before any realistic reach, and `hidden` objectives are filtered out
 * of the briefing so it really is a surprise.
 *
 * The office is 92.65 m from their yard, planted ON the seam, 45.25 m from a
 * head — see the layout. Nine operations of this chapter have turned on who held
 * the paper afterwards, and the last piece of paper in the sector is a Radar
 * Dome on a mine field.
 *
 * **THE TWO ANSWERS ARE NOT THE SAME PRICE, AND AN EARLIER DRAFT OF THIS BLOCK
 * SAID "TAKING IT CHANGES NOTHING MECHANICAL".** That is false of exactly one of
 * them. The office is a `radar`, `power: -40` (`src/data/Defs.ts`), and
 * `PowerGrid.recompute` sums draw by `store.owner[i]` — so a CAPTURED office
 * joins the captor's grid on the next rescan while a LEVELLED one leaves it.
 * Both answers complete the objective and both pay the same 600, so the ceiling
 * lift measured two blocks up is common to them; the difference between the two
 * is the forty and nothing else. Against seat 0's measured **+105**, and with
 * Vosk's orders beat telling the player to spend a hundred of it on silos:
 *
 *     never taken       no bounty      silo bill 10   -100          ->  +5
 *     LEVELLED at a ceiling   600 + lift   silo bill  4    -40       -> +65
 *     CAPTURED at a ceiling   600 + lift   silo bill  4    -40 -40   -> +25
 *
 * So the gun is strictly the cheaper answer and the engineers buy nothing back
 * — seat 0 already stands a `radar` of its own (measured, `radar x1` in the
 * opening census), so a second one opens no tech. **What is genuinely dangerous
 * is capturing it EARLY**, before the silo count is decided: a player who takes
 * the office at the bare opening ceiling lifts only to 20 600, still needs seven
 * silos, and lands at **105 - 70 - 40 = -5** — a brownout, where `census` stops
 * the unit tabs and `shedPriority` darkens the three Tesla Coils the roster
 * deliberately kept. Recoverable rather than a soft-lock: `powerPlant` is 300
 * credits for +100, and the Structures and Defense tabs are never power-gated.
 *
 * That price is now IN VOSK'S DISCLOSURE LINE rather than only here. An
 * operation that offers two answers and prices one of them is an operation whose
 * briefing is wrong. **What the capture is really for is the fiction** — nine
 * operations have turned on who held the paper, and walking four engineers into
 * their office rather than shelling it is the ending the chapter is about. It
 * costs a reactor. The briefing says so and the player may decide.
 *
 * **MOVING THE `filing` TAG ONTO A ZERO-POWER STRUCTURE WAS CONSIDERED AND
 * REJECTED.** It would flatten the two answers into one — a gun and four
 * engineers would then cost exactly the same, and the only reason to send
 * engineers across the map is that doing so costs something and says something.
 * The fiction goes with it too: the objective is that their RETURN cannot be
 * sent, and a Radar Dome is the structure in the catalogue whose blurb is about
 * transmission. Budgeting the reactor into Vosk's silo advice was also rejected:
 * it prices a branch most players will not take, which is the shape of advice
 * nobody follows. Disclosing it at the moment the branch is offered is the
 * cheaper place to put it.
 *
 * ============================================================================
 * TWO WAYS TO LOSE, AND THEY ARE EXACT COMPLEMENTS OF THE WIN
 * ============================================================================
 * `RETURN_MADE` is `credits >= 30 000` AND `ownerCount(0, 'building', 'heads',
 * min: 2)`: the figure and a working seam. The second clause is not decoration —
 * a return is output from a sector that is producing, and a bank with nothing
 * turning behind it is the establishment's case rather than an answer to it. Two
 * heads of four is the floor, so the player may lose the whole far pair and still
 * file, at 600 credits a minute for the rest of the shift.
 *
 * `t.stopped` is `max: 1` on the same count, which is the exact negation of the
 * win's ground clause. **IT FIRES THE MOMENT THE PRIMARY BECOMES UNREACHABLE
 * RATHER THAN AT THE CLOSE**, which is `soviets.06.demolition-order`'s rule for
 * `t.infirmaryLost` and `soviets.05.short-allocation`'s for `t.cut`: an objective
 * that stays lit after it is impossible is a lie the player plays against for
 * another ten minutes. It carries `SETTLE` because a count of zero reads TRUE
 * before the layout has stamped anything, and the win's `min: 2` needs no guard
 * because it counts UP from zero.
 *
 * The other loss is the close at twenty-two minutes, which is `parSec` 1320 to
 * the second — the authored par IS the deadline rather than a description of one,
 * and the chapter's ramp is 780 / 840 / 900 / 960 / 1020 / 1080 / 1140 / 1200 /
 * 1320. There is deliberately no early-out arm on it: `Viability.isBeaten` is
 * "nothing to build with and nothing to fight with", so the establishment can be
 * beaten flat with the return unposted, and an authored early-out would end the
 * operation in a WIN with the objective unmet. In that state the player simply
 * finishes mining, which is the correct amount of work for a force that has
 * already been destroyed.
 *
 * ============================================================================
 * THE ROSTER: THE SECTOR BUILDS WHAT A SECTOR BUILDS
 * ============================================================================
 * `player: ['struct.tech', 'struct.defence.specialist']`
 * `ai:     ['struct.tech', 'struct.defence.specialist', 'unit.raider', 'unit.specialist']`
 *
 * An allow-list, so tagged-and-unlisted is refused for BOTH seats: no aircraft,
 * no commander, no repair depot, no AA Battery, and — the one this operation has
 * to say out loud, because S6 shipped one — **no superweapon of any kind on
 * either side**. A finale is exactly where somebody would reach for a second
 * Weather Control Device, and a warhead is an answer to a base rather than to a
 * ceiling.
 *
 * The player keeps the two the yards genuinely have. `struct.tech` because a
 * mining sector has a Proving Ground; `struct.defence.specialist` because a Tesla
 * Coil is a power line with a job, and — measured — because keeping it is what
 * makes the power arithmetic above bite. Withholding the coil line the way
 * `soviets.06.demolition-order` does would hand the sector **+330** of headroom
 * instead of +105 and the ten silos would cost nothing anybody notices.
 *
 * What it withholds from the player is the establishment's tier: `unit.raider`
 * and `unit.specialist`. Measured against an unrostered CONTROL build of the same
 * ground, that is **one `apocalypse` and two `attackDog` gone from the sector's
 * own opening**, and the column keeps both lists — its `ifv` pair stands in the
 * rostered build and its Refractor Tanks arrive in the trigger table. One line of
 * asymmetry, in the direction the fiction says: they came with the schedule and
 * the establishment to enforce it; the sector came with a yard.
 *
 * ============================================================================
 * NO `captureProof`, AND THAT IS A CONCLUSION RATHER THAN AN OMISSION
 * ============================================================================
 * The trap is that `entityDead` is capture-blind, so a protect-target an enemy
 * engineer can walk into ends the operation on somebody else's click. **Nothing
 * in this file reads `entityDead` or `entityAlive` at all.** Every threshold is
 * `ownerCount`, which is what capture is FOR: a head taken and a head levelled
 * both drop seat 0's count, and the office taken and the office levelled both
 * drop seat 1's. The predicate already means what the objective says.
 *
 * And the click is unreachable in the one direction that would matter. The heads
 * are seat 0's, `Capture.ts` rule 2 refuses an army-owned structure above
 * `CAPTURE.captureHpFrac`, `GarrisonService.enter` returns `'hostile'` for a
 * structure its player is not allied to, and `OrderKind.Capture` has **zero
 * occurrences in `src/sim/AI.ts`** — the brain has never issued the verb, which
 * is the gap CLAUDE.md's own capability audit lists. If the brain is ever given
 * it, this operation does not break: a head captured still drops
 * `ownerCount(0, ...)` and still counts against the floor, which is the correct
 * reading of an establishment taking a head off the sector's books.
 *
 * ============================================================================
 * ONE SCRIPTED `eva`, AND IT IS THE CASE `types.ts` LICENSES BY NAME
 * ============================================================================
 * `silosNeeded`, in the orders beat. The announcer already knows this line —
 * `Economy.deposit` calls `evaSiloNeeded` — but ONLY on the `lost > 0` branch,
 * which is to say only AFTER the player has already thrown ore away. `types.ts`
 * asks for a scripted announcer line to be either a beat the game has no event
 * for or **"a moment before the event lands"**, and this is the second case
 * exactly: the whole operation is a ceiling, and the one line in `EVA_LINES`
 * that names it is wired to fire after the ceiling has already cost something.
 *
 * **`reclamation.02.written-off` MADE THE OPPOSITE CALL ON THE SAME PROBLEM AND
 * IT IS WORTH SAYING SO.** Its `t.ceiling` is a `credits`-triggered DIALOGUE four
 * thousand credits short of its own ceiling, and its comment notes that the
 * announcer's `silosNeeded` fires later on its own. That is right for a gap of
 * ONE silo, which a player can close on being told. This gap is ten silos and
 * fifty seconds of queue, so the warning has to arrive before the first load
 * lands rather than four thousand credits before the ceiling — and the announcer
 * is the only channel that reaches a player who is looking at the sidebar.
 * Grepped across `src/campaign/operations/`: this is the only scripted
 * `silosNeeded` in the campaign, and the only scripted `eva` in this file. The
 * other four beats this operation has — a capture, a structure lost, a base under
 * attack, forces under attack — are all spoken by `audio.system.ts` off ordinary
 * events already.
 *
 * ============================================================================
 * TWO SEATS, NOT THREE, IN THE OPERATION MOST LIKELY TO WANT THREE
 * ============================================================================
 * `Shell.startOperation` fills every opponent slot from the single `op.foe`, and
 * nothing in the campaign path allies two opponent seats — `PlayerState.allyMask`
 * defaults to self-only, which is what `soviets.04.company-town` leans on to make
 * the Ninth and the Eleventh hostile to each other. A Continental establishment
 * is ONE command with one schedule, so a second seat would have to be an
 * independent hostile, and there is no third party left in this sector: the
 * Ninth is wound up and the Works is a standard rather than an army. Three seats
 * would also make the finale the operation whose save reloads on differently
 * levelled ground if `SaveContext.armies` ever regresses. Two.
 *
 * ============================================================================
 * BOTH SHIPPED OUTCOME RULES ARE OFF
 * ============================================================================
 * `annihilationWin` because razing the establishment posts no figure, and
 * `Shell.pollOutcome` would declare victory with the quarter unfiled and the
 * yards holding whatever they happened to be holding — which is the certificate
 * standing and the operation congratulating the player for it.
 * `assetLossDefeat` because a commander who has lost his yard while four heads
 * are still paying twelve hundred a minute into a bank that is most of the way
 * to the return is the most interesting last act this operation has, and
 * `pollOutcome` would end it at 2 Hz instead. The authored ordinary loss is
 * `playerBeaten`, which is `Viability.isBeaten`, and that is the honest
 * threshold.
 * ========================================================================== */

import { Faction } from '../../../core/types';
import { minutes, seconds } from '../../types';
import type { Condition, OperationDef } from '../../types';
import {
  FILING_AREA, PUSH, ROAD_A, ROAD_A_AREA, ROAD_B, ROAD_B_AREA, SEAM_FAR, SEAM_NEAR,
} from '../../layouts/soviets-nil-return';

/**
 * THE GEOMETRY IS IMPORTED, NOT RESTATED.
 *
 * The seam is placed by the layout and the columns are ordered at it by this
 * file. A number written in both is a number that will disagree the first time
 * either is tuned, and the failure — a column attack-moving at empty ground, a
 * reveal framing nothing — is invisible to every gate.
 * `layouts/soviets-nil-return.ts` owns the geometry.
 */

/**
 * How long the layout is given to have placed the ground before any threshold
 * over it is believed.
 *
 * **A ZERO-OR-BELOW THRESHOLD IS TRUE BEFORE THE GROUND EXISTS.**
 * `ownerCount(0, 'building', 'heads', max: 1)` reads TRUE for a layout that
 * placed no heads, so it would end this operation in defeat on tick one,
 * silently, in the direction nobody reports; and `playerBeaten` reads TRUE for a
 * seat with no producer and no hull. Both carry this. The WIN's own count is
 * `min: 2`, which counts up from zero and needs no guard — the tag registry
 * cannot make it true early.
 *
 * Twenty seconds is unmistakably past the build and unmistakably short of
 * anything being lost: the nearest thing hostile to a head is the office's own
 * pillbox at 31.6 m against a 22 m reach, and nothing is ordered anywhere before
 * minute four. `soviets.05.short-allocation`, `.06.demolition-order` and
 * `.07.right-of-entry` guard their zero thresholds with the same constant.
 */
const SETTLE: Condition = { on: 'elapsed', ticks: seconds(20) };

/**
 * The quarter's return, in credits held at one moment.
 *
 * 15 000 over the opening ceiling, which is exactly ten `oreSilo`. See the
 * header: the number is chosen for the silo arithmetic and for the power
 * headroom it consumes, not for how it sounds.
 */
const RETURN_CREDITS = 30_000;

/**
 * The interim figure. It is a WINDOW with one round number in it, not a point.
 *
 * **IT MUST SIT ABOVE THE ONE-SILO CEILING AND CLEAR OF THE TWO-SILO ONE**, and
 * both bounds are measured through the shipped `Economy` rather than reasoned:
 * one extra `oreSilo` puts seat 0's ceiling at 16 500 and two put it at 18 000,
 * so anything over 16 500 still forces the second silo, and anything under
 * 17 500 leaves room for this objective's own 500-credit payout to land BELOW
 * the cap — which is what keeps `Economy.liftFloorFor` at its
 * `credits <= pl.storageMax` guard and keeps the ten-silo bill in the header
 * true.
 *
 * **18 000 WAS AUTHORED HERE AND IT IS EXACTLY THE TWO-SILO CEILING**, so the
 * payout landed on a full bank every time, `capFloor` re-based on the whole
 * balance, and the ceiling went 18 000 -> 26 500 — cutting the return's storage
 * bill from ten silos to five without the player doing anything but follow the
 * objective. See the header block. Do not move this back onto a ceiling.
 */
const INTERIM_CREDITS = 17_000;

/** When Signals places the establishment's office. Before the first wave. */
const DISCLOSE = minutes(3.5);

/** The twelve-minute bell. The interim is due BEFORE it, not at it. */
const BELL = minutes(12);

/**
 * The quarter closes, and it is `parSec` 1320 to the second.
 *
 * The authored par IS the deadline rather than a description of one, which is
 * the only way that field is falsifiable from inside the operation.
 * `soviets.03.deep-sector` through `.08.carriage-forward` all make the same
 * identification.
 */
const CLOSE: Condition = { on: 'elapsed', ticks: minutes(22) };

/**
 * The return is posted: the figure, and a seam still working behind it.
 *
 * Defined once because three triggers must agree on it — the win and both halves
 * of the hidden secondary's resolution — and two copies of a condition are two
 * copies that will disagree the first time either is tuned.
 * `soviets.06.demolition-order`'s `WORKS_GONE` and `.07.right-of-entry`'s
 * `ENTRY_MADE` are the same shape for the same reason.
 */
const RETURN_MADE: Condition = {
  on: 'all',
  of: [
    { on: 'credits', player: 0, min: RETURN_CREDITS },
    { on: 'ownerCount', player: 0, role: 'building', tag: 'heads', min: 2 },
  ],
};

const op: OperationDef = {
  id: 'soviets.09.nil-return',
  chapter: 'soviets',
  faction: Faction.Soviets,
  /*
   * THE CONTINENTAL ESTABLISHMENT, WHICH IS ALLIED AND IS NOT A DISTRICT. The
   * Ninth was wound up in S7 and the Eleventh withdrew its filing in S4; what is
   * on the ground here answers to a Continental office and arrives by rail with
   * a certificate already drafted. `t.survey`, `t.lane`, `t.pan`,
   * `t.establishment` and `t.last` spawn literal Allied `gi`, `grizzly` and
   * `prismTank`, which `validateCampaign` checks against the army of the seat
   * they land on, and the layout puts an Allied `radar`, two `pillbox` and a
   * `prismTower` on seat 1. Two seats, so `op.foe` fills exactly one of them.
   */
  foe: Faction.Allies,
  index: 9,
  title: 'Nil Return',
  beat: 'A Continental office has the sector down as nil, and only a delivered quarter says otherwise.',
  primaryType: 'economy',
  /*
   * BESPOKE. Objectives, spawns, orders, reveals, dialogue, an announcer line, a
   * camera move and an outcome — `types.ts` defines the archetype as "multiple
   * effect kinds", and this is TEN of the eleven. The one it does not use is
   * `grantCredits`: both secondaries pay through `ObjectiveDef.credits`, which is
   * the same `Economy.grant` on a rail that `paid` keeps from paying twice across
   * a reload — and in an operation whose primary is a bank balance, a payout that
   * could be collected twice is not a cosmetic problem.
   */
  archetype: 'bespoke',
  parSec: 1320,
  requires: ['soviets.08.carriage-forward'],

  map: {
    /*
     * `snow`, and it is a change of ground from S8's pan as well as a change of
     * season: the quarter closes in the frost with the seam still turning, which
     * is the image the chapter ends on. It is also `relief` 0.50 / `cliffs` 0.40,
     * the highest RELIEF in `MAP_PRESETS` — not the steepest overall, since
     * `arid` carries `cliffs` 0.55 — so every structure here goes down through a
     * `footprintBuildable` + `footprintClear` ring search and the headers'
     * distances are read off where they actually landed.
     * `soviets.03.deep-sector` and `.06.demolition-order` are the chapter's other
     * snow operations, and both are on different seeds and different pairs.
     *
     * `biome` is `'snow'` and so is the preset — they agree here, which they do
     * NOT for `arid`/`desert`. See `OperationMap.biome`: `getBiome` answers an
     * unknown name with a warning and TEMPERATE, so a mismatch ships a different
     * LANDFORM in silence, and `reclamation.03.sold-twice` has already paid for
     * that with every number in two headers.
     */
    preset: 'snow',
    biome: 'snow',
    /*
     * CHOSEN ON A MEASURED SWEEP OF TEN WEEKLY DATES, not picked. Counting 4 m
     * cells through the real `Terrain.isPassable(Locomotor.Track)`: **95.90%** of
     * the corridor within 40 m of the segment joining the two start spots is open
     * to a tracked hull — the best of the ten against a band of 83.44% to
     * 95.90% — and 73.67% of the whole map is track-passable.
     * `tests/campaign-maps.spec.ts` builds this operation on this seed and checks
     * that every declared tag landed, so a generator change that re-rolls this
     * ground fails there rather than in a player's match — which makes it loud,
     * not cheap: every distance the two headers quote is a distance on THIS roll.
     */
    mapSeed: 20_261_120,
    /*
     * **IT CHOOSES THE CORNERS.** `seatedSlots` draws a PAIR out of `START_PAIRS`
     * for a two-army match, and 3203 draws **[0, 1]** — the 386.16 m diagonal,
     * the widest of the four layouts on the table. The layout is handed spots
     * (108, 380) and (404, 132); the CONSTRUCTION YARDS land at (114, 382) and
     * (402, 134), 380.06 m apart, and every distance in this file and in the
     * layout is measured against those yards rather than against the spots.
     *
     * The width is the requirement rather than a preference: this is the only
     * operation in the chapter that asks the player to hold two separated
     * positions AND run an economy between them, and [0, 1] is the only lane with
     * 250 m of room between the near pair and the far one.
     * `soviets.05.short-allocation` is the chapter's other [0, 1] operation, on
     * temperate ground at a different roll. **Change this and every distance is a
     * different distance.**
     */
    simSeed: 3_203,
    armies: 2,
    /*
     * `base`. The operation is a purchase — ten silos, a reactor and whatever
     * harvesters the player is willing to buy — and every one of those wants a
     * Construction Yard and a refinery standing at t=0. An `mcv` opening would
     * spend three minutes of a twenty-two-minute file unable to build the thing
     * the operation is about. The fiction agrees: S1 through S8 took this seam
     * and this is the yard that has been working it.
     */
    opening: 'base',
    /*
     * 5000, AND IT BINDS BOTH SEATS — `Shell.applySimPostBoot` writes
     * `startingCredits` into every non-Neutral slot, so this is a statement about
     * the operation's economy rather than a handicap.
     *
     * **IT IS ALSO THE FIRST FIVE THOUSAND OF THE RETURN, AND THAT IS THE POINT
     * OF THE NUMBER.** Every other operation in the chapter opens with seed
     * money; this one opens with a sixth of the answer already in the bank, so
     * the first purchase a player makes is the first thing they subtract from
     * their own score. It also holds the establishment to the pace CLAUDE.md
     * names as the single cause of "the AI has a ready base" — a 10 000 opening
     * built a seven-building base with eleven troops by t+90 s having mined
     * nothing.
     */
    credits: 5_000,
  },
  layout: 'soviets-nil-return',

  // NEITHER SHIPPED RULE MAY END THIS. See the header: annihilation would declare
  // victory with the quarter unfiled, and `assetLossDefeat` would end this
  // operation's best last act at 2 Hz.
  outcome: { annihilationWin: false, assetLossDefeat: false, ignoreSeats: [] },

  /*
   * AN ALLOW-LIST, SO TAGGED-AND-UNLISTED IS REFUSED FOR BOTH SEATS — including
   * every superweapon, which a finale is exactly where somebody would reach for.
   * The full argument is in the header; the two things to know before editing it
   * are that KEEPING `struct.defence.specialist` on the player is what holds the
   * opening base at +105 of net power (withholding it reads +330, and the ten
   * silos the return needs would then cost nothing anybody notices), and that
   * `struct.defence.specialist` on the AI is what lets the layout stand a
   * Refractor Tower on the field office.
   *
   * PROFILE-INDEPENDENT, so the ground is the same on a finished account as on a
   * fresh one — which a deny-list could not promise. `setCampaignRoster` is
   * consulted AHEAD of both the PvP suppression flag and the installed gate.
   */
  roster: {
    player: ['struct.tech', 'struct.defence.specialist'],
    ai: ['struct.tech', 'struct.defence.specialist', 'unit.raider', 'unit.specialist'],
  },

  objectives: [
    {
      id: 'return',
      kind: 'primary',
      title: 'Post the quarter: thirty thousand banked, with the seam still working',
    },
    {
      id: 'interim',
      kind: 'secondary',
      title: 'Send an interim seventeen thousand before the twelve-minute bell',
      credits: 500,
    },
    {
      id: 'paper',
      kind: 'secondary',
      hidden: true,
      title: 'Take the establishment\'s own return off them',
      credits: 600,
    },
  ],

  triggers: [
    /* -- the orders -------------------------------------------------------
     * Three beats at four, eighteen and thirty-four seconds rather than six
     * lines at once: the shell renders dialogue as toasts, and
     * `Shell.campaignBeatSeq` sequences two lines from one speaker but cannot
     * make a stack of six readable.
     *
     * THE CAMERA MOVE IS THE ARRIVAL AND IT IS THE ONLY ONE IN THIS FILE.
     * `cameraMove` takes the camera off whatever the player was doing, so
     * `types.ts` reserves it for an arrival, a loss or a reveal and forbids it as
     * punctuation. The thing this operation is about is the player's own ground,
     * which they can already see; what they cannot see is the train, so the
     * camera goes to the rail head behind the establishment's camp and the reveal
     * goes with it.
     */
    {
      id: 't.brief',
      when: { on: 'elapsed', ticks: seconds(4) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Rakhalt',
          text: 'The Ninth is wound up and the file went up with it. What is on the sector now '
            + 'is not a district and will not be argued with — a Continental establishment, off '
            + 'the branch line, with the schedule already written and a certificate already '
            + 'drafted.',
        },
        { do: 'revealArea', player: 0, area: ROAD_B_AREA },
        { do: 'cameraMove', at: ROAD_B },
      ],
    },
    {
      id: 't.orders',
      when: { on: 'elapsed', ticks: seconds(18) },
      then: [
        { do: 'eva', line: 'silosNeeded' },
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'Their certificate says this sector returns nil. We cannot argue a return, we '
            + 'can only file one — thirty thousand on the books before the quarter closes at '
            + 'twenty-two minutes, off ground we are standing on.',
        },
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'And the yards hold fifteen. Everything past that goes on the ground and is '
            + 'counted as waste. Put silos up before you put anything else up — ten of them, at a '
            + 'hundred and fifty each, and they cost you all but five points of your power.',
        },
      ],
    },
    {
      id: 't.crew',
      when: { on: 'elapsed', ticks: seconds(34) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'Four heads turning. Three hundred a minute each, and the two out on the pan pay '
            + 'exactly what the two behind the yard pay — which is why the establishment is going '
            + 'to the pan first and why we cannot let it.',
        },
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'Two of the four at the close is the least the standard calls a working sector. '
            + 'Below that there is nothing to file and the certificate writes itself.',
        },
      ],
    },

    /* -- the office, placed --------------------------------------------------
     * Three and a half minutes, before the first wave and before any realistic
     * reach. `hidden` objectives are filtered out of the briefing
     * (`briefingObjectives`), so this really is a surprise.
     *
     * THE REVEAL IS NOT A NO-OP AND THAT WAS MEASURED RATHER THAN ASSUMED —
     * `revealArea` is `Vision.exploreCircle` and it is PERMANENT, so a disc that
     * already covers its subject makes the beat a reveal of ground the player has
     * been looking at. The layout carries the three distances; the shortest is
     * the minute-four reveal at ROAD_A, 65.51 m away against r 42.
     */
    {
      id: 't.disclose',
      when: { on: 'elapsed', ticks: DISCLOSE },
      then: [
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'Signals has their traffic. They have put a field office down on the seam itself '
            + '— they are certifying the ground by standing on it, which is more than any of the '
            + 'districts ever bothered to do.',
        },
        { do: 'revealArea', player: 0, area: FILING_AREA },
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'Their return goes up the branch line from that dome. Take it off them and the '
            + 'only figures reaching the Continental office this quarter are ours. Level it and '
            + 'it costs us nothing; walk engineers in and we inherit forty points of draw on '
            + 'top of the silos, so budget a reactor with it.',
        },
        { do: 'setObjective', id: 'paper' },
      ],
    },

    /* -- the survey party ----------------------------------------------------
     * Minute four, unconditional. A wave that fires only when the player is
     * elsewhere reads as the map cheating; a schedule the world keeps whatever
     * the player is doing reads as an opponent.
     *
     * IT FORMS ON THE PAN ROAD AND THE ORDER IS A HEADING, NOT A LEASH.
     * `AiBrain.regroupSquads` files every untagged hull the seat owns into a
     * squad on its next pass, so the attack-move is the first thing these six do
     * and the brain owns them after that. What the wave buys is that the
     * establishment is 65.5 m from its own gate and on the far pair's ground at a
     * known minute — read it as a force screening faster than it could build,
     * which is what `soviets-deep-sector` established about scripted waves on an
     * AI seat.
     *
     * FOUR G.I.s AND TWO GRIZZLIES IS 62.46 dps AGAINST A HEAD, WHICH IS 11.21
     * SECONDS — the layout derives it. An unattended far head does not survive
     * the first thing that reaches it, and the operation is written so that
     * losing both is a price rather than an ending.
     *
     * LITERAL ALLIED KEYS. `EffectSink.spawnUnits` resolves through
     * `ProductionCatalog.byKey` and remaps nothing, unlike the layout's
     * `ScenarioBuilder.spawnUnit`; `validateCampaign` checks each key against the
     * army of the seat it lands on, so a Soviet key here is a build error.
     */
    {
      id: 't.survey',
      when: { on: 'elapsed', ticks: minutes(4) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Merrow, intercepted',
          text: 'Onto the pan heads first. The schedule has them down as unworked and I would '
            + 'like the ground to agree with the schedule before anybody photographs either.',
        },
        { do: 'revealArea', player: 0, area: ROAD_A_AREA },
        { do: 'spawnUnits', player: 1, key: 'gi', count: 4, at: ROAD_A, spread: 20, tag: 'survey' },
        { do: 'spawnUnits', player: 1, key: 'grizzly', count: 2, at: ROAD_A, spread: 14, tag: 'survey' },
        { do: 'orderTagged', tag: 'survey', order: 'attackMove', at: SEAM_FAR },
      ],
    },

    /* -- down the lane --------------------------------------------------------
     * Minute eight, off the OTHER bearing — the rail head behind their camp,
     * 127.20 m from the pan road — and aimed at `PUSH`, the contested patch
     * `addStartOre` lays on the midpoint of the two openings. That is 15 959
     * credits of ore and the ground a player working the far pair has to cross
     * and then leave behind, so this is a wave at the ECONOMY rather than a
     * second helping of the first.
     */
    {
      id: 't.lane',
      when: { on: 'elapsed', ticks: minutes(8) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Merrow, intercepted',
          text: 'Second troop down the middle, onto the patch. I am not interested in their '
            + 'buildings. I am interested in their haulers, and a hauler that is not moving is a '
            + 'sector that is not producing.',
        },
        { do: 'spawnUnits', player: 1, key: 'gi', count: 5, at: ROAD_B, spread: 20, tag: 'lane' },
        { do: 'spawnUnits', player: 1, key: 'grizzly', count: 3, at: ROAD_B, spread: 14, tag: 'lane' },
        { do: 'orderTagged', tag: 'lane', order: 'attackMove', at: PUSH },
      ],
    },

    /* -- the interim ---------------------------------------------------------
     * `credits` reads the BANK at this instant, so this is a snapshot and not a
     * total: a player who banks seventeen thousand and spends it at eleven minutes
     * has still collected. That is correct — the interim is a figure sent up the
     * line, and a figure sent is sent.
     *
     * ABOVE `t.interimMissed`, and the two cannot tie: this needs
     * `not(elapsed BELL)` and that one needs `elapsed BELL`, so the last tick this
     * can fire on is BELL - 1 and the first tick that one can fire on is BELL.
     * `not` over a plain `elapsed` is legal — the only condition `validateCampaign`
     * refuses under a `not` is `elapsedSinceArmed`, which reads true during the
     * arming pass and would make the trigger permanently dead.
     */
    {
      id: 't.interim',
      when: {
        on: 'all',
        of: [
          { on: 'credits', player: 0, min: INTERIM_CREDITS },
          { on: 'not', of: { on: 'elapsed', ticks: BELL } },
        ],
      },
      then: [
        { do: 'completeObjective', id: 'interim' },
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'Interim figure is away. Seventeen thousand, entered, before the bell — which is '
            + 'seventeen thousand the Continental office has to explain away instead of us.',
        },
      ],
    },
    {
      id: 't.interimMissed',
      when: {
        on: 'all',
        of: [
          { on: 'elapsed', ticks: BELL },
          { on: 'not', of: { on: 'objectiveComplete', id: 'interim' } },
        ],
      },
      then: [
        { do: 'failObjective', id: 'interim' },
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'Bell, and nothing to send. The establishment has ten clear minutes now to file '
            + 'a sector that has returned nothing all quarter, and they are right so far.',
        },
      ],
    },

    /* -- back onto the pan ---------------------------------------------------- */
    {
      id: 't.pan',
      when: { on: 'elapsed', ticks: minutes(12.5) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Merrow, intercepted',
          text: 'They are still working the pan heads. Take the pan heads off the pan. I have a '
            + 'certificate to sign and I would rather sign a true one.',
        },
        { do: 'spawnUnits', player: 1, key: 'gi', count: 5, at: ROAD_A, spread: 20, tag: 'pan' },
        { do: 'spawnUnits', player: 1, key: 'grizzly', count: 3, at: ROAD_A, spread: 14, tag: 'pan' },
        { do: 'orderTagged', tag: 'pan', order: 'attackMove', at: SEAM_FAR },
      ],
    },

    /* -- their office goes ----------------------------------------------------
     * CONJOINED WITH THE DISCLOSURE, AND NOT FOR TIDINESS. `ownerCount(max: 0)`
     * reads TRUE for a layout that placed no office, so a failed build would
     * COMPLETE this hidden secondary on tick one — and `t.disclose` would then
     * `setObjective` it back to active at three and a half minutes, so the
     * objective would complete, un-complete and finally fail. Sharing one clock
     * with its own disclosure makes the objective's existence and its completion
     * the same event. `soviets.06.demolition-order` guards its hidden secondary
     * the same way.
     *
     * BELOW `t.disclose` in file order for the same reason: on the tick they
     * share, the row is revealed and then completed rather than the reverse.
     *
     * `ownerCount` RATHER THAN `entityDead`, so four engineers answer it exactly
     * as a gun does — which is what the title says and what nine operations of
     * this chapter have been about.
     */
    {
      id: 't.paperTaken',
      when: {
        on: 'all',
        of: [
          { on: 'elapsed', ticks: DISCLOSE },
          { on: 'ownerCount', player: 1, role: 'building', tag: 'filing', max: 0 },
        ],
      },
      then: [
        { do: 'completeObjective', id: 'paper' },
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'Their dome is off the seam. Whatever the establishment files this quarter, it '
            + 'files from memory.',
        },
      ],
    },

    /* -- onto the near pair ---------------------------------------------------
     * Minute sixteen, at the heads behind the yard, off the rail-head road so it
     * crosses the whole map to get there. The far pair has had two waves by now;
     * this is the one that says the near pair was never safe, only nearer.
     *
     * `prismTank` IS THE ESTABLISHMENT'S TIER AND THE SECTOR DOES NOT HAVE ONE.
     * `roster.ai` lists `unit.specialist` so the sidebar and the ground agree;
     * `roster.player` does not, so the answer to a Refractor Tank is a Rhino and
     * a Tesla Coil rather than an Apocalypse.
     */
    {
      id: 't.establishment',
      when: { on: 'elapsed', ticks: minutes(16) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Merrow, intercepted',
          text: 'Everything else, onto the two behind their yard. Six minutes. A sector that '
            + 'files nothing is a sector that was never here, and I intend to leave with that in '
            + 'writing.',
        },
        { do: 'spawnUnits', player: 1, key: 'gi', count: 4, at: ROAD_B, spread: 20, tag: 'establishment' },
        { do: 'spawnUnits', player: 1, key: 'grizzly', count: 3, at: ROAD_B, spread: 14, tag: 'establishment' },
        { do: 'spawnUnits', player: 1, key: 'prismTank', count: 2, at: ROAD_B, spread: 22, tag: 'establishment' },
        { do: 'orderTagged', tag: 'establishment', order: 'attackMove', at: SEAM_NEAR },
      ],
    },

    /* -- and the last one ----------------------------------------------------- */
    {
      id: 't.last',
      when: { on: 'elapsed', ticks: minutes(19.5) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Merrow, intercepted',
          text: 'Back onto the pan with the rest. Two and a half minutes, and after that the '
            + 'figure is whatever I write down.',
        },
        { do: 'spawnUnits', player: 1, key: 'gi', count: 5, at: ROAD_A, spread: 20, tag: 'last' },
        { do: 'spawnUnits', player: 1, key: 'grizzly', count: 4, at: ROAD_A, spread: 14, tag: 'last' },
        { do: 'spawnUnits', player: 1, key: 'prismTank', count: 2, at: ROAD_A, spread: 22, tag: 'last' },
        { do: 'orderTagged', tag: 'last', order: 'attackMove', at: SEAM_FAR },
      ],
    },

    /* -- the close, telegraphed ----------------------------------------------- */
    {
      id: 't.closing',
      when: { on: 'elapsed', ticks: minutes(20.5) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'Ninety seconds. Anything still in a hauler at twenty-two minutes is ore we dug '
            + 'and did not return, and the difference between those two words is the whole '
            + 'quarter.',
        },
      ],
    },

    /* -- the secondary resolves FIRST -----------------------------------------
     * ABOVE `t.win`, deliberately: `runDirector` returns early once an outcome is
     * set, so anything that resolves at the posting has to resolve before the
     * operation ends or the medal does not count it. Same ordering rule
     * `soviets-deep-sector` states for `t.mastsDown`, `04-company-town` for
     * `t.five`, `06-demolition-order` for `t.infirmaryKept` and
     * `07-right-of-entry` for `t.clean`.
     */
    {
      id: 't.paperMissed',
      when: {
        on: 'all',
        of: [
          RETURN_MADE,
          /*
           * `min: 1` ON THE SAME COUNT `t.paperTaken` READS `max: 0`, WHICH IS
           * AN EXACT COMPLEMENT AND NOT A `not(objectiveComplete)` GUARD.
           *
           * The obvious spelling is "the return is posted and `paper` is not
           * complete", and it has a one-tick hole: `runDirector` FILLS a
           * caller-supplied effect list and never mutates `state.objectives`
           * mid-pass, so an objective completed earlier in the SAME pass still
           * reads incomplete here — `soviets.07.right-of-entry` says so about
           * `t.clean` — and the sink would then apply `completeObjective` and
           * `failObjective` for one row in that order, with the failure
           * winning. Reachable exactly once: the tick on which the office dies
           * and the bank first touches thirty thousand together.
           *
           * Reading the office instead closes it by construction. It is also
           * the honest predicate: this row fails because the establishment
           * still has its return, not because a flag was not set.
           */
          { on: 'ownerCount', player: 1, role: 'building', tag: 'filing', min: 1 },
        ],
      },
      then: [
        { do: 'failObjective', id: 'paper' },
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'Our figures are away and so are theirs. Two returns for one sector, and a '
            + 'Continental office that has never seen it gets to pick.',
        },
      ],
    },

    /* -- the quarter is posted -------------------------------------------------
     * The last trigger of the chapter, and it cannot tie with either loss:
     * `t.stopped` wants one head or none and this wants two or more, and
     * `t.quarterClosed` is below it so a figure that lands on the closing tick
     * wins. The ground beats the paperwork — `soviets.03.deep-sector`,
     * `.04.company-town` and `.07.right-of-entry` all say that about their own
     * deadlines, and this is the operation where the ground IS the paperwork.
     */
    {
      id: 't.win',
      when: RETURN_MADE,
      then: [
        { do: 'completeObjective', id: 'return' },
        {
          do: 'dialogue',
          speaker: 'Rakhalt',
          text: 'Thirty thousand, weighed, entered against the record we took off the Ninth, and '
            + 'the seam still turning behind it. That is not a claim and it is not an argument. '
            + 'It is a figure, in their own units, on their own standard.',
        },
        {
          do: 'dialogue',
          speaker: 'Rakhalt',
          text: 'Every office on this continent has spent a year deciding what this ground was on '
            + 'paper. It is an output now. Nobody schedules a sector twice — they just allocate '
            + 'it, and next quarter they will allocate it to us.',
        },
        { do: 'endOperation', result: 'win' },
      ],
    },

    /* -- the seam stops --------------------------------------------------------
     * The exact negation of the win's ground clause, and it fires the moment the
     * primary becomes unreachable rather than at the close. See the header.
     */
    {
      id: 't.stopped',
      when: {
        on: 'all',
        of: [
          SETTLE,
          { on: 'ownerCount', player: 0, role: 'building', tag: 'heads', max: 1 },
        ],
      },
      then: [
        { do: 'failObjective', id: 'return' },
        {
          do: 'dialogue',
          speaker: 'Merrow, intercepted',
          text: 'One head turning out there, if that. Nobody\'s standard calls that a working '
            + 'sector, including theirs. Sign it nil and put the establishment back on the '
            + 'train.',
        },
        { do: 'endOperation', result: 'loss', reason: 'return' },
      ],
    },

    /* -- the quarter closes unfiled -------------------------------------------- */
    {
      id: 't.quarterClosed',
      when: CLOSE,
      then: [
        { do: 'failObjective', id: 'return' },
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'Quarter closed. Whatever came out of this ground this year came out of it '
            + 'unreturned, and a Continental office cannot allocate against a figure nobody '
            + 'sent.',
        },
        { do: 'endOperation', result: 'loss', reason: 'return' },
      ],
    },

    /* -- the ordinary loss ------------------------------------------------------
     * `playerBeaten` is `Viability.isBeaten` — nothing to build with and nothing
     * to fight with — not "you have no buildings". A commander whose yard is gone
     * while four heads are still paying twelve hundred a minute is not beaten, and
     * this operation would like that to be a position somebody can play from.
     */
    {
      id: 't.beaten',
      when: {
        on: 'all',
        of: [
          SETTLE,
          { on: 'playerBeaten', player: 0 },
        ],
      },
      then: [
        { do: 'failObjective', id: 'return' },
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'Nothing answering from the yards. They will not even have to write it down '
            + 'carefully.',
        },
        { do: 'endOperation', result: 'loss', reason: 'return' },
      ],
    },
  ],
};

export default op;
