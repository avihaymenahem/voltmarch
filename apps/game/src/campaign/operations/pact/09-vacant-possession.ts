/**
 * ============================================================================
 * P9 — VACANT POSSESSION
 * ============================================================================
 * P8 finished it. The parcel carries no title at all now: the Order struck its
 * own tenants' holding off the register so that no works could ever be raised on
 * the pan, and the count stays true because the ground stays nobody's. That was
 * the last thing the Order had to give and it was never the Order's — four
 * hundred years of readings stay in the book, and the eleven families who took
 * them are off the crust.
 *
 * **THE CHAPTER'S ARGUMENT ARRIVES AT THE PEOPLE WHO PAID FOR IT.** The blurb
 * reads *"four hundred years of readings, and an argument that cannot be made
 * without conceding it"*, and every operation since P3 has spent something to
 * make it: the plates, the count, the crust, the parcel, the holding. The last
 * item on the list is not a thing. It is eleven households who have no ground,
 * no standing and no instrument, because the Order conceded all three on their
 * behalf and never once asked them.
 *
 * ============================================================================
 * WHAT THE ORDER OWES THEM, AND WHETHER IT CAN PAY
 * ============================================================================
 * It cannot pay in ground: every parcel it could hand over is common now, and
 * taking any of it back is the one move that unmakes the concession. It cannot
 * pay in credits: `credits: 0`, and the fiction and the field agree — P8's own
 * opening block says the mirror took the Chapterhouse's bank with it, and nine
 * days is not long enough to raise a yard.
 *
 * What is left is the Conclave itself. The precinct — the reading floor and the
 * seat the Order has held since before there was a coast to argue about — is the
 * last titled thing in Pact hands, and the Conclave has resolved to convey it to
 * the eleven houses and to hold from them afterwards as tenant. The INSTRUMENT
 * standing on that floor is not part of the conveyance and is not anybody's for
 * the duration: it is under the assessors' seal, which is the fiction for the
 * layout owning it on the NEUTRAL slot, and the reason for that is measured in
 * the layout's §3b rather than chosen. **The Order stops being a landlord and becomes somebody's lodger,
 * which is the only currency it has left and is worth exactly what four hundred
 * years of standing is worth.**
 *
 * The conveyance is a Pact instrument and it has a Pact form. It is read out
 * from the floor, at the hour, by the people receiving it — and an instrument
 * read under the arms of the party conveying it is a party conveying to itself.
 * The assessors will not enter it. **So the Order's guns come off its own ground
 * before the Conclave sits, and that is not a formality, it is the payment.**
 *
 * **THE SEPT HAS THE PRECINCT AND WILL NOT OPEN IT.** `pact.05.open-count` put
 * Oreth on the record — *"you are giving away the thing the Conclave has been
 * for four hundred years. Come through me for it"* — and he was right about the
 * price then and is right about it now. A Conclave that owns nothing is a
 * building with nobody in it. He is not wrong; he is the last person left with
 * something to concede, and this operation is the concession being taken out of
 * him.
 *
 * ============================================================================
 * WHY `primaryType: 'infiltrate'`, AND IT IS THE FOURTH READING OF A WORD THE
 * ENGINE HAS NO PREDICATE FOR
 * ============================================================================
 * There is no stealth in this game — no cloak, no detection, no vision
 * predicate among the twelve conditions and no thirteenth on offer — so the word
 * has to be built out of something the vocabulary can say, and three operations
 * have already built it three different ways:
 *
 *   - `allies.02.instrument-room` — a **HEADCOUNT**. Five or more of your units
 *     inside the cordon and the district turns its watch out.
 *   - `reclamation.04.served-notice` — a **DWELL CLOCK**. Any of your units on
 *     the counted ground continuously for sixty seconds and the halt telephones
 *     the depot. Its header says doing A2's trick again would be one trick twice.
 *   - `soviets.07.right-of-entry` — the **SOFTEN LADDER**. The operation is
 *     decided by getting one unarmed man through one door.
 *
 * **THIS ONE IS A KIND, NOT A NUMBER OR A DURATION, AND IT IS READ ONCE.** The
 * disc counts only what can shoot; the bar is ZERO; and it is evaluated at a
 * single authored tick rather than as a running tripwire. That makes it the only
 * one of the four that is not a PENALTY: A2 and R4 punish you for being noticed
 * and S7 prices a door, while here the absence of your own army is half of the
 * WIN. The player may bring everything they own to the wall and none of it
 * through the gate, and the thing being spent is neither headcount nor time but
 * the ability to cover four unarmed men at the moment it matters most.
 *
 * **AND IT SHARES `opening: 'force'` AND `credits: 0` WITH P8, WHICH IS STATED
 * RATHER THAN HIDDEN.** Two operations in a row with no yard is a real
 * repetition and the reason is real too: the Order has been broke since P7 spent
 * the mirror twice, and it is fought on different ground (P8 is `arid`, this is
 * `snow`), against a different army, over a different question. What is NOT
 * repeated is the shape of the decision — P8's currency is *where the column is
 * standing* and every trip is a lift the pan walks alone; this one's is *what is
 * standing there*, and the answer at the hour has to be nothing.
 *
 * ============================================================================
 * THE TWO RADII ARE ONE SUBTRACTION, AND IT IS `focusLance`'s RANGE
 * ============================================================================
 * `PRECINCT_R` is **40** and `FLOOR_R` is **14**, both authored in
 * `layouts/pact-vacant-possession.ts` and imported here rather than restated.
 * The number that matters is the DIFFERENCE:
 *
 *     PRECINCT_R - FLOOR_R = 26 = the range of `focusLance` AND of `sunLance`
 *
 * read off the bound weapon table rather than chosen. A `mrdSolarch` or an
 * `mrdLancer` standing on the precinct rim — the closest legal place an Order gun
 * can be once the Conclave sits — bears on the nearest point of the reading floor
 * and on nothing one metre further in. `pulseCarbine` is **20**, so the ten
 * Wayfarers do not reach the floor from the rim at all.
 *
 * Two consequences, and the second is the operation:
 *
 *   - **Across the approach the rim is a good firing line.** A hull on it covers
 *     the whole annulus between the floor and the wall on its own bearing, which
 *     is every metre a Sept hull has to cross to reach the readers.
 *   - **Once something is standing ON the floor, nothing outside the wall can
 *     touch it.** So the withdrawal is not a formality: anything alive inside the
 *     precinct at the hour is a thing the player has given up the ability to
 *     shoot. **The operation is won on the approaches or it is not won.**
 *
 * The two long-range rows in the Meridian army are the 40 m `zenithBeam`
 * (`mrdZenith`, `unit.specialist`) and the 33 m `heliosLance` (`mrdHelios`,
 * `struct.defence.specialist`), and **both sit behind unlock tags this
 * operation's allow-list withholds from both seats.** Either breaks the
 * subtraction from its own side: a Zenith on the rim covers fourteen metres into
 * the floor and makes the withdrawal free, and a Spire founded on the Sept's
 * forward chapterhouse covers the near half of it from outside the wall. The
 * layout's §8 measures both.
 *
 * ============================================================================
 * THE GATE POSTS, AND WHY MASSING IS THE WHOLE FIXED-COLUMN LESSON
 * ============================================================================
 * The Sept holds the Order's own gate with two `mrdGlaive`, **19.799 m from the
 * floor**, one either side. `glaiveRepeater` is range 24, so measured centre to
 * centre the pair covers the floor out to 13.563 m of its middle across the post
 * axis — against `FLOOR_R` 14 — and **through `Combat.engage`'s surface test**,
 * which subtracts an `mrdArtificer`'s 0.234 m radius, the covered half-width is
 * 13.973 m and the two uncovered crescents are **under three centimetres**.
 * There is no standing on the reading floor while a post is up.
 *
 * What that costs, through `ARMOR_MATRIX` and `COMBAT_DAMAGE.globalMul` 0.80 on
 * the bound tables, per trigger pull and per second:
 *
 *     the post shooting                per pull   dps     kills
 *     mrdArtificer   95 hp Infantry       48.00   60.76   2 pulls, 0.79 s
 *     mrdWayfarer   110 hp Infantry       48.00   60.76   3 pulls, 1.58 s
 *     mrdLancer     130 hp Infantry       48.00   60.76   3 pulls, 1.58 s
 *     mrdSolarch    330 hp Light          26.40   33.42   9.87 s
 *
 *     shooting the post (480 hp, Concrete)
 *     focusLance    one Solarch           26.40   16.50   29.09 s
 *     sunLance      one Lancer            41.76   17.40   27.59 s
 *     pulseCarbine  one Wayfarer           6.48    6.75   71.11 s
 *
 * **ONE AT A TIME, A POST EATS THREE SOLARCHS** — 29.09 s to break it against
 * 9.87 s to die, so a column fed in singly loses 2.95 hulls a post and there is
 * no factory to correct it with. Seven Solarchs and four Lancers together are
 * **185.10 dps and the post falls in 2.59 s**, in which it removes 86.6 hp:
 * twenty-six percent of one hull. That difference is the operation's opening
 * problem and it is entirely a question of arriving at once.
 *
 * **THE TABLE ABOVE IS A DERIVATION AND THE ENGINE IS SLOWER THAN IT, BY A
 * FACTOR THAT IS WORTH WRITING DOWN.** Every row is `damage / cycle` through the
 * matrix, which assumes the trigger is pulled the instant it is off cooldown.
 * Driven in a real `Targeting` / `Weapons` / `Projectiles` / `Damage` rig on the
 * bound tables, turret slew and projectile travel cost about a fifth:
 *
 *                                          derived    in the engine
 *     one post vs one reader at 20 m        0.79 s        1.80 s
 *     seven Solarchs + four Lancers
 *       vs one post at 21 m                 2.59 s        3.07 s
 *     one Solarch alone vs one post         it dies       it dies at 10.77 s
 *                                           at 9.87 s     with the post standing
 *
 * The RELATIONSHIP the block is about survives all three — massing still turns a
 * 2.95-hull loss into a quarter of one — but quote the right column for the
 * right question. **A reader inside a post's envelope dies in 1.80 s, not 0.79**,
 * and the four of them are the primary. They do not go in until both posts are
 * down, and `t.hesk` says so in words for the reason recorded there.
 *
 * **NO DOCTRINE IS BUILT ON PARKING, AND `pact.06.common-ground` IS WHY.**
 * `focusLance` outranges `glaiveRepeater` by 2 m, which looks like a free trade
 * and is not: `Targeting.managesGoal` accepts only `Attacking` and `Guarding`,
 * `approach()` closes to `range * APPROACH_STOP_FRAC` (0.80) — **20.8 m, inside
 * the post's 24** — and an `AttackMove` is refused by `managesGoal` outright, so
 * the hull drives the whole way. The two metres exist on paper; the table above
 * is what the fight is decided by.
 *
 * ============================================================================
 * THE READERS ARE FOUR AND THE BAR IS THREE, AND THAT ARITHMETIC IS THE CAPTURE
 * RULE
 * ============================================================================
 * `mrdArtificer` is the Pact's engineer: 95 hp, unarmed, `canCapture`, no
 * `unlockedBy`. Four of them come with the column and, under `opening: 'force'`,
 * they are the only thing on the player's side that can walk into a building and
 * the only four there will ever be.
 *
 * `Capture.resolve` consumes the man on EVERY non-refused outcome, so the whole
 * capture question on this map is one subtraction the player can do:
 *
 *     4 readers - 1 spent on a capture = 3, which is the bar exactly
 *     4 readers - 2 spent             = 2, and the primary is unreachable
 *
 * **ONE CAPTURE IS AFFORDABLE AND CANNOT BOOTSTRAP ANYTHING; TWO COULD AND
 * CANNOT BE AFFORDED.** Taking the Sept's Forgeyard alone buys production with no
 * bank; taking their Cistern alone buys a bank with nothing to spend it on. It
 * takes a Conclave AND a Cistern to open a build queue, that is two readers, and
 * two readers is the operation. **The refusal is priced, not vetoed.**
 *
 * It is priced at the other end too: an enemy structure above
 * `CAPTURE.captureHpFrac` (0.50) costs FOUR engineers, because the soften lands
 * `maxHp * CAPTURE.softenFrac` (0.25) through
 * `ARMOR_MATRIX[HighExplosive][Concrete]` (1.00) and
 * `COMBAT_DAMAGE.globalMul` (0.80) = 0.20 of max. Four readers is all of them.
 * A capture is therefore available exactly when the guns have already done the
 * work — and a captured structure does not mend, so whatever the Order takes, it
 * takes at or under half.
 *
 * ============================================================================
 * `captureProof: ['floor']`, AND IT IS THE OPERATION'S OWN THESIS AS A FIELD
 * ============================================================================
 * One tag, and the reason is not a hazard note. **The Order takes possession of
 * nothing here.** That is the whole content of the win clause, and an engineer
 * walking into the Conclave's own instrument to put the deed back in Pact hands
 * is the exact move the operation exists to refuse. No condition at any
 * vocabulary size can express it: the twelve are READS, and the refusal has to
 * happen inside `CaptureService.resolve`, by which time the man is spent and the
 * deed is flipped.
 *
 * **AND ON A GAIA OWNER IT IS THE STRONGER REFUSAL, NOT THE WEAKER ONE.** The
 * reading floor belongs to the NEUTRAL slot — the layout's §3b has the
 * measurement that forced that and the argument for why no geometry could do it
 * instead — and `Capture.resolve` takes a neutral structure **OUTRIGHT AT ANY
 * HEALTH**: no soften ladder, no `captureHpFrac` gate, one man, done. So without
 * this line the operation's own thesis is a single right-click, at any moment,
 * for the price of one reader out of four. The veto is what refuses it, and
 * `refuse()` is the branch that hands the man back rather than spending him.
 * `pact.02.long-count` argues the same shape at length and `pact.07.thin-place`
 * declares the field for the same reason.
 *
 * **IT USED TO BE JUSTIFIED ON A HAZARD THAT NO LONGER EXISTS, AND THE
 * CORRECTION IS WORTH KEEPING.** The draft argued that a floor taken into
 * protective custody "stops being the Sept's and becomes a legal target for
 * every gun they own". True, and beside the point: while it WAS the Sept's it
 * was already a legal target for every gun the ORDER owns, and the player's own
 * opening column killed it in 4.37 s from a 22 m ring and in 5.07 s from the
 * standoff an attack order on the far gate post parks them at. Ownership is what
 * closes that, and the veto is what stops the player buying their way out of the
 * ownership.
 *
 * **`gate` AND `chapterhouse` ARE DELIBERATELY NOT LISTED**, and a blanket
 * `'all'` would be wrong rather than merely broad: both are read as
 * `ownerCount(1, ..., max: 0)` precisely so that taking them off the Sept counts
 * however it is done, and the shown secondary says "take off them" rather than
 * "destroy" because of it. `soviets.06.demolition-order` refuses `'all'` on the
 * same grounds.
 *
 * ============================================================================
 * THE ROSTER: AN ALLOW-LIST, AND THE 33 m ROWS ARE WHY
 * ============================================================================
 * `{ player: [], ai: [] }` — tagged-and-unlisted is refused on both seats.
 * Measured on two headless builds identical but for `setCampaignRoster`, with
 * the def tables BOUND (both halves are required; `spawnBuilding` hands
 * `isBuildable` the RESOLVED def and `rosterAllows` answers TRUE for an undefined
 * one, so a build missing either measures a different game in a way that looks
 * like a pass):
 *
 *     seat 0  the Order   25 units,  0 structures   unchanged by the roster
 *     seat 1  the Sept    12 units, 27 structures   vs 14 and 29 with it cleared
 *     seat 2  Gaia         0 units,  1 structure    the reading floor, either way
 *
 * The Sept loses two `mrdSkiff` (`unit.raider`), one `mrdReliquary`
 * (`struct.tech`) and one `mrdHelios` (`struct.defence.specialist`) — four
 * entities, which is what `tests/campaign-roster-ground.spec.ts` reads, and the
 * Spire is the load-bearing one. The layout's §8 has the geometry.
 *
 * **THE PLAYER'S HALF WITHHOLDS NOTHING MEASURABLE AND THAT IS DECLARED, NOT
 * OVERLOOKED.** Every key in the column carries no `unlockedBy` and there is no
 * sidebar to withhold FROM; `allies.07.fair-copy` records the identical
 * position. The one thing `roster.player: []` would refuse is a `mrdZenith`
 * (`unit.specialist`), and this file never asks for one — not from the layout,
 * where `ScenarioBuilder.spawnUnit` runs `isBuildable` and would silently drop
 * it, and not from the trigger table, where `EffectSink.spawnUnits` goes through
 * `ProductionService.spawnUnit` and would NOT. A scripted Zenith would land
 * despite the roster and break the two radii. There is none.
 *
 * ============================================================================
 * THE PRESSURE, PRICED, AND WHAT IS NOT MEASURED
 * ============================================================================
 * Five Sept troops on the clock, all forming at `ROAD` — 82.02 m from the floor
 * and 120.83 m from the Sept's own gate, so a wave is a column that has already
 * left rather than an army appearing inside the defender's formation:
 *
 *     3:00    4 mrdWayfarer, 1 mrdSolarch                1 500 credits
 *     7:00    4 mrdWayfarer, 2 mrdSolarch                2 300
 *     11:00   5 mrdWayfarer, 2 mrdSolarch                2 475
 *     15:00   4 mrdWayfarer, 2 mrdLancer, 2 mrdSolarch   3 200
 *     18:30   4 mrdWayfarer, 3 mrdSolarch                3 100
 *                                                       12 575 over 22 minutes
 *
 * **571.6 credits a minute, which is the lowest rate of any comparable operation
 * and deliberately so**: `allies.04.misclosure` runs 800/min and
 * `soviets.05.short-allocation` 770.6/min, and both give the player a factory.
 * `allies.07.fair-copy`'s no-yard band is 502.6-660.5/min over nineteen minutes,
 * and this sits inside it over three more.
 *
 * The Order's whole account is **12 650 credits in two instalments** — 11 150 on
 * the ground at tick zero and the 1 500 that grounds its arms at minute thirteen
 * — and there is no third.
 *
 * **WHAT IS NOT MEASURED: whether twenty-one hulls last twenty-two minutes.**
 * The Sept has a base, opens on the same `credits: 0` and mines with two
 * `mrdCollector`; how much it adds to the five scripted troops is a fact about a
 * played match and no harness in this repo can put a number on it.
 * `tests/campaign-maps.spec.ts` builds the ground and does not fight on it. The
 * scripted half is priced above; the rest is stated as unknown rather than
 * asserted.
 *
 * ============================================================================
 * THE PAR IS THE DEADLINE, AND THERE IS NO EARLY WIN
 * ============================================================================
 * `parSec` 1320 and `CLOSE` is `minutes(22)` — the same 39 600 ticks to the
 * second, which is the only way that field is falsifiable from inside the
 * operation. The chapter's ramp is 780 / 840 / 900 / 960 / 1020 / 1080 / 1140 /
 * 1200 and this is the ninth; `tests/campaign-length.spec.ts` holds the
 * 600-1800 s band.
 *
 * **NOTHING ENDS THIS EARLY IN THE PLAYER'S FAVOUR, INCLUDING BEATING THE
 * SEPT.** The Conclave sits at the hour; a precinct cleared at minute twelve is a
 * precinct that has to be held until twenty-two, and the last two minutes are the
 * hard ones whatever happened before them. Both shipped outcome rules are off for
 * exactly that reason: `annihilationWin` would declare victory the moment the
 * Sept ran out of assets, ten minutes before there is anything to read out, and
 * `assetLossDefeat` would end the operation at 2 Hz on a commander whose last
 * hull died with four readers standing on the floor — which is this operation's
 * best possible last act and is a WIN.
 *
 * ============================================================================
 * THE THREE ENDINGS PARTITION, AND THE WINNING TICK CARRIES TWO LINES
 * ============================================================================
 * At `CLOSE` exactly one of three triggers can fire, because they partition on
 * the product of two independent world reads:
 *
 *     readers on the floor >= 3   no arms inside the wall  ->  t.win
 *     readers on the floor >= 3   an arm inside the wall   ->  t.quitMissed
 *     readers on the floor <  3   either                   ->  t.entryMissed
 *
 * — and all four close triggers carry `FLOOR_STANDS` as well, with
 * `t.entryMissed` carrying `READERS_ALIVE` on top of it, because `t.floorLost`
 * and `t.readersLost` are not gated on the hour and each collides with the close
 * on exactly one tick. See those two constants.
 *
 * `t.quitMissed` COMPLETES `entry` and FAILS `quit`, which is the honest reading
 * of that state rather than a tidy one: the row that asked for readers on the
 * floor got readers on the floor. `t.hands` sits above all three and emits no
 * dialogue at all, so the winning tick carries exactly two lines from two
 * speakers — `pact.06.common-ground` records a winning tick that fired five, and
 * the fix there was to move the earlier beats rather than to hold the win.
 *
 * **AND DRIVING THE ENDINGS ONE AT A TIME IS NOT DRIVING THEM.** The first
 * version of this block claimed every ending emitted at most two beats from two
 * speakers and exactly one `endOperation`, and that was measured trigger by
 * trigger rather than over the product. Driven through the real `runDirector`
 * over the 320-state cross product of (readers alive) x (readers on floor) x
 * (arms in precinct) x (floor alive) x (gate owned) x (house owned), stepped
 * through every trigger boundary in the file, it returned:
 *
 *     before   multiEnd 48   duplicate speaker on the ending tick 84
 *     after    multiEnd  0   duplicate speaker  0   most beats on an end tick 2
 *
 * Three pairs were colliding and none of them was reachable by looking at one
 * trigger: `t.floorLost` with `t.readersLost` (both un-clocked, both Hesk, both
 * ending — fixed by `FLOOR_STANDS` on the second), `t.warn` with `t.quitMissed`
 * (`elapsed` is a `>=`, so an arm arriving ON tick 39 600 arms both — fixed by
 * `{ not: CLOSE }`), and `t.gate` with either un-clocked loss (the disclosure
 * beat is Hesk's too — fixed by conjoining the disclosure, never the loss). The
 * residual, stated rather than hidden: a chapterhouse that changes hands on the
 * exact tick of `CLOSE` puts Nael's forward-house line on the winning tick, for
 * three beats from three speakers. **No speaker can answer themselves on any
 * ending tick, which is the property that matters and the one
 * `pact.06.common-ground` paid for.**
 *
 * It is also what deleted a `t.beaten` that could not fire without
 * `t.readersLost` firing on the same tick — see there.
 * ========================================================================== */

import { Faction } from '../../../core/types';
import { minutes, seconds } from '../../types';
import type { Condition, OperationDef } from '../../types';
import {
  FLOOR, FLOOR_AREA, HOUSE, PRECINCT_AREA, RELIEF, ROAD,
} from '../../layouts/pact-vacant-possession';

/**
 * THE GEOMETRY IS IMPORTED, NOT RESTATED.
 *
 * `layouts/pact-vacant-possession.ts` owns every coordinate and the dependency
 * runs operation -> layout and never back. A number written in both files is a
 * number that will disagree the first time either is tuned, and the failure — a
 * reveal that frames empty ground, a column ordered at a point nobody authored —
 * is invisible to every gate. `soviets.06.demolition-order` states the same rule.
 */

/**
 * How long the layout is given to have placed the ground before any threshold
 * over it is believed.
 *
 * **A ZERO THRESHOLD IS TRUE BEFORE THE GROUND EXISTS, IN BOTH DIRECTIONS.**
 * `entityDead: 'floor'` reads TRUE before that tag has ever been stamped, so a
 * build that placed nothing would LOSE this operation on tick one, silently, in
 * the direction nobody reports; `ownerCount(0, 'unit', 'readers', max: 2)` does
 * the same for a build that issued no readers, and
 * `ownerCount(1, 'building', 'gate', max: 0)` would disclose the hidden
 * secondary against an empty precinct.
 *
 * IT IS ABOUT THE BUILD, NOT ABOUT A RACE. `game.scenario` finishes inside
 * `async init()` and `SystemRegistry.init` awaits every module in sequence, so
 * the world is complete before the Director's first pass and any value above
 * zero closes the hole. Twenty seconds is unmistakably past it and unmistakably
 * short of anything being lost: the first hostile order is at minute three and
 * the floor is 204.6 m of Foot route from the camp. The real gate on a failed
 * build is `tests/campaign-roster-ground.spec.ts`; this is the cheap half.
 */
const SETTLE: Condition = { on: 'elapsed', ticks: seconds(20) };

/**
 * The hour, and it is `parSec` to the second.
 *
 * The authored par IS the deadline rather than a description of one, which is
 * the only way that field is falsifiable from inside the operation. Every
 * operation in this chapter makes the same identification.
 */
const CLOSE: Condition = { on: 'elapsed', ticks: minutes(22) };

/**
 * Three of the four readers standing on the reading floor.
 *
 * `unitsInArea` restricted by TAG, which is the cheap spelling — the untagged
 * branch of `runtime.ts#unitsInArea` walks the whole alive list and this is read
 * by three triggers — and, more importantly, the only spelling that means what
 * it says. It counts a GARRISONED man too (the read filters owner, `IS_UNIT` and
 * `PendingDestroy` and nothing else, which is `allies.09.made-good`'s finding),
 * and that is inert here: the one structure inside this disc is `mrdOculus`,
 * which carries `IsRadar`, so `GarrisonService.refusalFor` answers "production
 * structure" and nobody is standing inside it.
 */
const READERS_ON_FLOOR: Condition = {
  on: 'unitsInArea', player: 0, area: FLOOR_AREA, min: 3, tag: 'readers',
};

/** All four, which is what the hidden secondary is worth. */
const ALL_READERS: Condition = {
  on: 'unitsInArea', player: 0, area: FLOOR_AREA, min: 4, tag: 'readers',
};

/**
 * Any armed hull of the Order's standing inside the precinct wall.
 *
 * **THE TAG IS WHAT MAKES THE RULE MEAN WHAT IT SAYS.** The readers are the
 * player's units too and they are standing in the middle of this disc on
 * purpose. `arms` is stamped by the layout on the twenty-one armed hulls and by
 * `t.stood` on the five that come over at minute thirteen, and on nothing else —
 * and seat 0 owns no other unit at any point of this operation, because
 * `opening: 'force'` gives it no way to make one. **That is the property the
 * whole win clause rests on: give this operation a barracks and a built rifleman
 * carries no tag, so the rule silently stops covering him.**
 */
const ARMS_IN_PRECINCT: Condition = {
  on: 'unitsInArea', player: 0, area: PRECINCT_AREA, min: 1, tag: 'arms',
};

/**
 * The Sept's two posts are off the Order's gate — destroyed or taken.
 *
 * `ownerCount(max: 0)` rather than `entityDead`, and the difference is capture:
 * `Director.holds` answers `entityDead` with `q.aliveWithTag(tag) === 0` and
 * asks nothing about ownership, so a post the player took with a reader would
 * still read as standing. The count asks who OWNS it, which covers both routes —
 * and both are affordable here exactly once.
 */
const GATE_OFF: Condition = {
  on: 'all',
  of: [SETTLE, { on: 'ownerCount', player: 1, role: 'building', tag: 'gate', max: 0 }],
};

/**
 * The reading floor is still standing.
 *
 * **IT IS ON ALL FOUR CLOSE TRIGGERS AND ON `t.readersLost`, AND THE SECOND
 * HALF OF THAT WAS MISSING UNTIL THE ENDINGS WERE DRIVEN JOINTLY.**
 * `t.floorLost` is not gated on the hour — it ends the operation the moment the
 * Oculus dies — so it can collide with the close on the exact tick of `CLOSE`,
 * and `runDirector` returns early only on a tick that STARTS resolved: within
 * ONE tick every matching trigger fires and file order settles nothing but which
 * `endOperation` lands first. Without this clause a floor that died at 39 600
 * would have emitted a win, a loss and three dialogue beats, two of them from
 * Hesk. `allies.08.standing-order` states the same rule and
 * `pact.06.common-ground` paid for it.
 *
 * **AND IT COLLIDES WITH `t.readersLost` ON EVERY TICK, NOT ONLY THE HOUR**,
 * because neither of those two is gated on the clock at all. Driven through the
 * real `runDirector` over the 320-state cross product of (readers alive) x
 * (readers on floor) x (arms in precinct) x (floor alive) x (gate owned) x
 * (house owned), the first draft returned `noEnd = 0` and **`multiEnd = 48`**,
 * and every one of the forty-eight was the same set: floor dead AND three
 * readers gone. The trace was
 * `fail:entry dialogue<Hesk> END:loss:entry fail:entry dialogue<Hesk> END:loss:entry`
 * — `CampaignSession.end` swallows the second `endOperation`, so the RECORDED
 * outcome was always single and only the duplicated speaker reached the player.
 * It is not exotic: the readers stand inside `FLOOR_R` 14 around the Oculus, so
 * anything shelling one is shelling the other, all damage in a tick resolves in
 * one `Damage` phase, and the degenerate no-build case hits it unconditionally
 * at `SETTLE`. With this clause on `t.readersLost` the two partition — the floor
 * takes the tie, which is also the order the file already reads in — and the
 * same sweep returns `multiEnd = 0`, `noEnd = 0`.
 *
 * It costs nothing anywhere else: on every other tick the floor is standing, and
 * if it is not the operation has already ended.
 */
const FLOOR_STANDS: Condition = { on: 'entityAlive', tag: 'floor' };

/**
 * Three of the four readers are still alive, wherever they are standing.
 *
 * **ITS ONE READER IS `t.entryMissed`, FOR `FLOOR_STANDS`'s REASON.**
 * `t.readersLost` ends the operation the moment a third reader dies and is not
 * gated on the hour, so the two can only collide on the exact tick of `CLOSE` —
 * and every matching trigger fires within one tick. Without this, a reader who
 * died at 39 600 produced two losses and two dialogue beats. The other three
 * close triggers need no such clause: all of them already require at least three
 * readers standing ON the floor, which is strictly stronger than three alive.
 */
const READERS_ALIVE: Condition = {
  on: 'ownerCount', player: 0, role: 'unit', tag: 'readers', min: 3,
};

const op: OperationDef = {
  id: 'pact.09.vacant-possession',
  chapter: 'pact',
  faction: Faction.Meridian,
  /*
   * THE SEPT, WHICH IS THE ORDER, AND `pact.05.open-count` PUT ORETH ON THE
   * RECORD SAYING WHY.
   *
   * P5 was this chapter's first mirror and this is its second and last, because
   * the thing being conceded here is the Conclave itself and the only people who
   * can refuse to concede it are the ones who hold it. A mirror is legal
   * (`foe === faction`; the lobby offers one) and `Faction.Neutral` is not —
   * that seat would be Gaia, allied to everybody.
   *
   * **A MIRROR IS THE ONE CASE `validateCampaign`'s FACTION CHECK CANNOT HELP
   * WITH**, because a Meridian key is legal on either seat. So the file has to be
   * careful where the validator cannot be: `t.stood` spawns onto SEAT 0 and says
   * so twice, and every other `spawnUnits` names seat 1.
   */
  foe: Faction.Meridian,
  index: 9,
  title: 'Vacant Possession',
  beat: 'The Conclave is the last titled thing in Pact hands, and an instrument read under the '
    + 'arms of the party conveying it is a party conveying to itself.',
  primaryType: 'infiltrate',
  /*
   * BESPOKE. Objectives, spawns, orders, reveals, dialogue, a camera move, an
   * announcer line and an outcome — `types.ts` defines the archetype as
   * "multiple effect kinds", and this is TEN of the eleven. The one it
   * deliberately does not use is `grantCredits`: there is no bank to pay into,
   * which is also why neither secondary declares `credits`.
   */
  archetype: 'bespoke',
  parSec: 1320,
  requires: ['pact.08.struck-off'],

  map: {
    /*
     * `snow` IS THE PRESET AND `snow` IS THE BIOME, WHICH IS THE SAFE PAIR.
     * The two vocabularies overlap on three names and disagree on exactly one —
     * the preset is `arid`, the biome is `desert` — and `getBiome` answers an
     * unknown name with a `console.warn` and TEMPERATE, so a mismatch ships a
     * different landform in silence. `reclamation.03.sold-twice` has already paid
     * for that. `biome` is typed and tsc names the line; `preset` is a validated
     * string because `MAP_PRESETS` is a `Record<string, MapPreset>` and there is
     * nothing to type it as.
     *
     * `pact.04.in-the-clear` is the chapter's other snow operation, five
     * operations back, and `pact.08.struck-off` is `arid` — so the two
     * `opening: 'force'` operations in this chapter are not fought on the same
     * ground as well as with the same opening.
     */
    preset: 'snow',
    biome: 'snow',
    /*
     * CHOSEN ON A MEASURED SWEEP OF TEN, and the criterion was the precinct.
     * **Six of the ten offered no site at all whose reading floor was wholly
     * passable AND wholly buildable**, and of the four that did, 60 101's is
     * 99.84% open across the whole forty-metre disc against 88.1%, 92.2% and
     * 78.0%. The bare heightfield is 12 350 of 16 384 cells foot-passable
     * (75.38%). `tests/campaign-maps.spec.ts` builds this operation on this seed,
     * so a generator change that re-rolls the ground fails there rather than in a
     * player's match — **and every distance in this file and in the layout is a
     * distance on THIS roll.**
     */
    mapSeed: 60_101,
    /*
     * **IT CHOOSES THE CORNERS.** `seatedSlots` draws a pair out of `START_PAIRS`
     * for a two-army match, and 4 019 draws the DIAGONAL running (404, 380) to
     * (108, 132) — 386.161 m, the longest opening-to-opening distance this game
     * lays down. Change it and the precinct is somewhere else relative to both
     * armies and every route in the layout header is a different route.
     */
    simSeed: 4_019,
    armies: 2,
    /*
     * `'force'`. The layout calls `buildBaseFor` for seat 1 and NOT for seat 0.
     * There is no third `START_CONDITIONS` member and there must not be — it
     * would put a "Fixed force" row in the SKIRMISH lobby, where nothing calls
     * `buildBaseFor` and the player would get an army with no way to build.
     *
     * It is also what makes the `arms` tag total. See `ARMS_IN_PRECINCT`.
     */
    opening: 'force',
    /*
     * ZERO, AND IT BINDS BOTH SEATS. `Shell.applySimPostBoot` writes
     * `startingCredits` into every slot, so this is a statement about the
     * operation's economy rather than a handicap: the Order has no bank to look
     * at, and the Sept opens on nothing and mines its way into whatever it adds
     * to the five scripted troops with two `mrdCollector`.
     */
    credits: 0,
  },
  layout: 'pact-vacant-possession',

  // NEITHER SHIPPED RULE MAY END THIS. See the header: annihilation would
  // declare a win ten minutes before there is anything to read out, and
  // `assetLossDefeat` would end this operation's best last act at 2 Hz.
  outcome: { annihilationWin: false, assetLossDefeat: false, ignoreSeats: [] },

  /*
   * AN ALLOW-LIST. The full argument is in the header and the geometry is in the
   * layout's §8; the one thing to know before editing it is that `roster.ai: []`
   * is what keeps a `mrdHelios` — 33 m of `heliosLance` — off ground 60.13 m from
   * the reading floor, and the two radii this operation is built on stop being
   * true the moment one stands there.
   *
   * PROFILE-INDEPENDENT, so the ground is the same on a finished account as on a
   * fresh one. `UnlockGate.mirrorAI` resolves the AI against the HUMAN's profile
   * when no roster is installed, which on a mirror match means the Sept would
   * inherit whatever the player happened to have earned.
   */
  roster: { player: [], ai: [] },

  /*
   * ONE TAG, AND IT IS THIS OPERATION'S THESIS AS A FIELD RATHER THAN A HAZARD
   * NOTE. The Order takes possession of nothing here. The argument, and the
   * second thing it closes — a floor taken into protective custody becomes a
   * legal target for every gun the Sept owns, and `t.floorLost` does not care who
   * fired — are in the header. `gate` and `chapterhouse` are deliberately not
   * listed.
   */
  captureProof: ['floor'],

  objectives: [
    /*
     * TWO PRIMARIES, BECAUSE THE MECHANIC IS TWO THINGS AT ONCE AND ONE ROW
     * CANNOT SAY BOTH. They are read on the same tick from two independent world
     * queries — see the endings block in the header. Three rows are active from
     * tick one, which is `MAX_VISIBLE_OBJECTIVES` exactly, and the fourth stays
     * hidden until the gate is open.
     *
     * **NO `credits` ON EITHER SECONDARY, AND IT IS DELIBERATE.**
     * `ObjectiveDef.credits` pays through `Economy.grant` into a bank this
     * operation's player can never open — no Conclave, no Forgeyard, no sidebar.
     * `allies.07.fair-copy` and `soviets.02.common-standard` refuse the same
     * reward for the same reason. It is paid in hulls, which is the only currency
     * here.
     */
    {
      id: 'entry',
      kind: 'primary',
      title: 'Have three of the four readers on the reading floor at the hour',
    },
    {
      id: 'quit',
      kind: 'primary',
      title: 'Have every gun of ours outside the precinct when the Conclave sits',
    },
    {
      id: 'house',
      kind: 'secondary',
      title: 'Take the Sept\'s forward chapterhouse off them',
    },
    {
      id: 'hands',
      kind: 'secondary',
      hidden: true,
      title: 'Have all four readers on the floor when the Conclave sits',
    },
  ],

  triggers: [
    /* -- the brief, in four beats -----------------------------------------
     * Four, twelve seconds apart, alternating speakers.
     * `Shell.campaignBeatSeq` keys each toast with a monotonic counter that is
     * never reused, so two lines on adjacent ticks are two toasts rather than one
     * eating the other — but they would still be two paragraphs nobody reads, so
     * they are paced.
     *
     * THE ONE `cameraMove` IN THIS FILE, AND IT IS THE REVEAL. `types.ts`
     * reserves it for an arrival, a loss or a reveal and forbids it as
     * punctuation. This is the thing the operation is about, shown once, at four
     * seconds, before the player has begun anything.
     *
     * THE REVEAL DRAWS THE WALL. There is no UI for a `Condition`'s disc, and
     * `revealArea` is `Vision.exploreCircle`, which explores ground PERMANENTLY —
     * so a reveal at exactly `PRECINCT_AREA.r` draws the boundary as a circle in
     * the fog on the first frame. It blurs as the player's own vision spreads,
     * which is stated rather than hidden: the wall is legible at the moment it is
     * explained and remembered afterwards. `pact.07.thin-place` uses the same
     * trick on its parcel.
     */
    {
      id: 't.open',
      when: { on: 'elapsed', ticks: seconds(4) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Calvane',
          text: 'The holding is struck off, the pan is nobody\'s and no works will ever stand on '
            + 'it. That is what we bought and I would sign for it again. What it cost is eleven '
            + 'households who now have no ground, no standing and no instrument, because we '
            + 'conceded all three on their behalf and never once asked them.',
        },
        { do: 'revealArea', player: 0, area: PRECINCT_AREA },
        { do: 'cameraMove', at: FLOOR },
      ],
    },
    /*
     * THE MECHANIC, ON AN UNCONDITIONAL TRIGGER, IN WORDS.
     *
     * `ObjectiveRow` is `{ id, title, kind, status }` — no description field, no
     * tooltip — so a rule that needs explaining has to be explained here or
     * nowhere. `allies.08.standing-order` shipped a primary whose mechanism was
     * stated only inside a beat gated behind an OPTIONAL secondary, and a player
     * who skipped the secondary was never told what the objective wanted. Both
     * halves of this operation's win are in this one beat.
     *
     * Spelled numbers rather than digits, which is
     * `tests/build-descriptions.spec.ts`'s convention for player-facing copy and
     * what the objective titles follow too.
     *
     * THE SECOND REVEAL IS THE SHOWN SECONDARY'S TARGET, and it is not a no-op:
     * the precinct disc's forty metres stop 20.13 m short of the chapterhouse at
     * 60.13 m, so `t.open` has not already explored this ground. A reveal of
     * ground the player has been looking at since four seconds is the trap
     * `soviets-short-allocation` records for its third wave.
     */
    {
      id: 't.brief',
      when: { on: 'elapsed', ticks: seconds(16) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Nael',
          text: 'At the hour the Conclave conveys the precinct to the eleven houses; afterwards '
            + 'we hold as tenants. Their people must read the instrument from the floor, with '
            + 'every Pact gun outside the wall. A reading made under our arms is a conveyance to '
            + 'ourselves, and the assessors will not enter it. The instrument is sealed and '
            + 'neither side may fire on it. A shell landing beside it still tells, so do not '
            + 'fight across the floor.',
        },
        { do: 'revealArea', player: 0, area: { x: HOUSE.x, z: HOUSE.z, r: 30 } },
      ],
    },
    /*
     * AND THE ONE INSTRUCTION THE PLAYER CANNOT DERIVE: DO NOT POINT THE READERS
     * AT ANYTHING.
     *
     * `caps.canCapture` in `src/input/Commands.ts` is an OR OVER THE WHOLE
     * SELECTION and `resolveContextOrder`'s capture branch reads it for the
     * GROUP — that file's own header says so at length. Armed hulls are demoted
     * to Attack per unit; the four `mrdArtificer` are not, so a Ctrl+A and one
     * right-click on a gate post issues a real `OrderKind.Capture` to all four of
     * them and they walk. Measured in the rig: one `mrdGlaive` against one
     * `mrdArtificer` at 20 m kills the reader in **1.80 s** with the post
     * untouched at 480 hp, and `t.readersLost` fires at two — so the SECOND one
     * to arrive is the defeat. A capture that lands is no cheaper: a 480 hp post
     * at full health needs four softens through
     * `ARMOR_MATRIX[HighExplosive][Concrete]` 1.00 and `globalMul` 0.80, which is
     * all four readers, and `Capture.resolve` consumes the man on every
     * non-refused outcome.
     *
     * Declaring the two posts in `captureProof` was the structural alternative
     * and it is REFUSED: `GATE_OFF` reads `ownerCount(max: 0)` precisely so that
     * taking a post counts, the shown objective says "take off them" because of
     * it, and vetoing them would delete a route the file blesses in order to
     * close a hazard a sentence closes. The player gets roughly a minute of
     * visible walking to press Stop; what they did not get was being told.
     * Hesk speaks it because they are his people.
     */
    {
      id: 't.hesk',
      when: { on: 'elapsed', ticks: seconds(28) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Hesk, of the pan',
          text: 'Hesk, for the eleven houses. You never asked us. You are asking now, and I will '
            + 'not be gracious: we lost a well and you are handing us a roof. They are not the '
            + 'same. But four of us will walk onto that floor and read it out; after that it is '
            + 'ours to be wrong about. Three must live, so do not point us at anything. We carry '
            + 'nothing, and one post drops a man in under two seconds.',
        },
      ],
    },
    /*
     * THE SEPT'S CASE, WHICH THIS OPERATION DOES NOT TREAT AS WRONG.
     * `pact.05.open-count` established Oreth's position and this is its last
     * consequence. He is the only person left in the chapter who still has
     * something to concede.
     */
    {
      id: 't.oreth',
      when: { on: 'elapsed', ticks: seconds(40) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Oreth, Warden of the Count',
          text: 'Oreth, for the Sept. I have two posts on your gate, Calvane, and I will tell you '
            + 'plainly why. A Conclave that holds nothing is a building with nobody in it. You '
            + 'gave away the crust and you were right; you gave away the count and you were right; '
            + 'and now you are standing outside your own wall proposing to give away the wall. '
            + 'Somebody has to be the one who says no, and it is going to be me.',
        },
      ],
    },

    /* -- the gate opens ----------------------------------------------------
     * The hidden secondary is disclosed at the moment it becomes a decision
     * rather than as a line the player read before the match started; hidden rows
     * are filtered out of the briefing entirely.
     *
     * CONJOINED WITH THE SETTLE, AND NOT FOR TIDINESS. `ownerCount(max: 0)` reads
     * TRUE for a build that placed no posts, so a failed build would disclose
     * this on tick one.
     *
     * AND CONJOINED WITH BOTH UN-CLOCKED LOSSES, WHICH IS THE OTHER HALF OF THE
     * SPEAKER RULE. `t.floorLost` and `t.readersLost` can land on any tick, and
     * both of them are Hesk — so a gate broken on the exact tick the third
     * reader falls emitted "Both posts off the gate. We can walk in from here."
     * immediately above "Two of us." Driven, that was 84 of the 320 end states,
     * including the degenerate no-build one at `SETTLE`. Suppressing the
     * DISCLOSURE rather than delaying the loss is the right way round: the way
     * in stops being news the moment the operation is over, and neither clause
     * can hide the row in a match that is still running, because the operation
     * ends on the same tick either of them goes false. `t.handsLost` keeps the
     * bare `GATE_OFF` on purpose — see there.
     */
    {
      id: 't.gate',
      when: { on: 'all', of: [GATE_OFF, FLOOR_STANDS, READERS_ALIVE] },
      then: [
        {
          do: 'dialogue',
          speaker: 'Hesk, of the pan',
          text: 'Both posts off the gate. We can walk in from here. Send all four of us and it is '
            + 'a reading with witnesses; send three and it is a note somebody argues with in fifty '
            + 'years, which is a thing I have some experience of.',
        },
        { do: 'setObjective', id: 'hands' },
      ],
    },
    /*
     * AND IT IS FAILED THE MOMENT IT BECOMES UNREACHABLE, WHICH IS WHY IT READS
     * `GATE_OFF` TOO.
     *
     * An objective that stays lit after it is impossible is a lie the player
     * plays against for another ten minutes — `soviets.06.demolition-order`'s
     * `t.infirmaryLost` argues it at length. But a hidden row cannot be failed
     * before it exists either: `CampaignSession.setObjective` refuses to
     * un-resolve a resolved row, so failing `hands` first would make `t.gate`'s
     * reveal a no-op and the player would never see the row at all.
     *
     * Sharing `GATE_OFF` settles both. If a reader dies before the gate is open,
     * this trigger and `t.gate` fire on the SAME tick and file order decides: the
     * reveal is written above, so the row appears and is then marked failed,
     * which is the honest report. If a reader dies afterwards, the row is already
     * active and this fails it on the spot.
     *
     * **IT KEEPS THE BARE `GATE_OFF` WHILE `t.gate` NO LONGER DOES**, and the
     * asymmetry is deliberate rather than an oversight. `t.gate` gained
     * `FLOOR_STANDS` and `READERS_ALIVE` so its Hesk beat cannot share a tick
     * with a Hesk loss; this trigger emits no dialogue, so it has nothing to
     * collide with. The two still meet where it matters — `READERS_ALIVE` is
     * min 3 and this is max 3, so at exactly three readers both fire and the
     * paragraph above holds unchanged. Below three the operation ENDS on that
     * tick (either `t.readersLost` or, with the floor gone, `t.floorLost`), so
     * a `hands` row that is failed while still hidden is a row nobody was going
     * to be shown anyway.
     */
    {
      id: 't.handsLost',
      when: {
        on: 'all',
        of: [GATE_OFF, { on: 'ownerCount', player: 0, role: 'unit', tag: 'readers', max: 3 }],
      },
      then: [{ do: 'failObjective', id: 'hands' }],
    },

    /* -- the Sept's five troops --------------------------------------------
     * Unconditional, on the clock. A wave that fires only when the player is
     * elsewhere reads as the map cheating; a schedule the world keeps whatever
     * the player is doing reads as an opponent.
     *
     * THEY FORM AT `ROAD` AND THE ORDER IS A HEADING, NOT A LEASH.
     * `AiBrain.regroupSquads` files every untagged hull the seat owns into a
     * squad on its next pass, so the attack-move is the first thing these hulls
     * do and the brain owns them afterwards. What a wave buys is the Sept being
     * stronger at a known minute than it could have built itself — 86.6 m of Foot
     * route from the floor against 216.2 m of Hover route from their own
     * opening, both re-measured with the layout's §7 instrument.
     *
     * EVERY RING POINT WAS CHECKED AGAINST ITS OWN LOCOMOTOR on the built world:
     * `mrdWayfarer` and `mrdLancer` resolve to `MoveClass.Foot`, `mrdSolarch` to
     * `MoveClass.Track`.
     * `spread` is the RADIUS OF A FIXED RING and unit `i` of `count` lands at
     * `angle = i / count * 2pi` exactly; `tests/campaign-spawn-ground.spec.ts` is
     * the gate. All twenty-six drop points of the five troops and all five of
     * `t.stood` are clear AND outside the precinct wall, and `ROAD` carries 509 of
     * 529 two-metre samples clear to both classes within 26 m, so the counts may
     * be retuned without re-measuring as long as the spreads stay inside it.
     */
    {
      id: 't.sept1',
      when: { on: 'elapsed', ticks: minutes(3) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Oreth, Warden of the Count',
          text: 'A section to the gate. Nobody reads anything out today.',
        },
        { do: 'revealArea', player: 0, area: { x: ROAD.x, z: ROAD.z, r: 30 } },
        { do: 'spawnUnits', player: 1, key: 'mrdWayfarer', count: 4, at: ROAD, spread: 20, tag: 'sept1' },
        { do: 'spawnUnits', player: 1, key: 'mrdSolarch', count: 1, at: ROAD, spread: 10, tag: 'sept1' },
        { do: 'orderTagged', tag: 'sept1', order: 'attackMove', at: FLOOR },
      ],
    },
    {
      id: 't.sept2',
      when: { on: 'elapsed', ticks: minutes(7) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Oreth, Warden of the Count',
          text: 'Second troop. Hold inside the wall — they cannot reach the floor from outside it '
            + 'and they will not come in and stay in, because coming in and staying in is the one '
            + 'thing their own instrument forbids them.',
        },
        { do: 'spawnUnits', player: 1, key: 'mrdWayfarer', count: 4, at: ROAD, spread: 20, tag: 'sept2' },
        { do: 'spawnUnits', player: 1, key: 'mrdSolarch', count: 2, at: ROAD, spread: 12, tag: 'sept2' },
        { do: 'orderTagged', tag: 'sept2', order: 'attackMove', at: FLOOR },
      ],
    },
    {
      id: 't.sept3',
      when: { on: 'elapsed', ticks: minutes(11) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Oreth, Warden of the Count',
          text: 'Halfway. He has no yard behind him and no way to make another hull, and he is '
            + 'spending them on a doorway he already owns.',
        },
        { do: 'spawnUnits', player: 1, key: 'mrdWayfarer', count: 5, at: ROAD, spread: 22, tag: 'sept3' },
        { do: 'spawnUnits', player: 1, key: 'mrdSolarch', count: 2, at: ROAD, spread: 12, tag: 'sept3' },
        { do: 'orderTagged', tag: 'sept3', order: 'attackMove', at: FLOOR },
      ],
    },

    /* -- the Sept concedes, which is the chapter's argument arriving --------
     * MINUTE THIRTEEN, AND IT IS NOT A SUPPLY. Five hulls, once, out of the
     * enemy's own picket, in an operation whose premise is that nothing is
     * replaced. The fiction forbids a second: these are men who have grounded
     * their arms, and there is no mechanism anywhere that produces more of them.
     * `allies.07.fair-copy`'s `t.mercy` is the shape — a dead-end rescue rather
     * than a pipeline.
     *
     * **IT SPAWNS ONTO SEAT 0 AND IT IS TAGGED `arms`.** Both halves matter and
     * `validateCampaign` can check neither on a mirror match, where a Meridian
     * key is legal on either seat. `player: 0` is what makes them the Order's;
     * `tag: 'arms'` is what puts them inside the withdrawal rule, so five hulls
     * the player never asked for cannot quietly fail `quit` at the hour. The drop
     * is at `RELIEF`, 62.03 m from the floor — **the nearest point of its
     * sixteen-metre ring is 46.04 m out, 6.04 m clear of the wall** — so they do
     * not arrive already in breach of a rule they are bound by.
     *
     * `reinforcements` is the scripted EVA line `types.ts` names as earning its
     * place, because the announcer has no event for a wave. It is also spoken by
     * `orecrisis.system.ts` now, which cannot collide here: that rescue needs a
     * standing refinery and this seat has none.
     */
    {
      id: 't.stood',
      when: { on: 'elapsed', ticks: minutes(13) },
      then: [
        { do: 'eva', line: 'reinforcements' },
        {
          do: 'dialogue',
          speaker: 'Oreth, Warden of the Count',
          text: 'A section of mine and a hull have grounded their arms on the east side and will '
            + 'not pick them up. They say the Conclave was never a building and I have spent a '
            + 'week defending one. I am not going to shoot them for saying it. Take them, Calvane, '
            + 'and get on with it.',
        },
        { do: 'spawnUnits', player: 0, key: 'mrdWayfarer', count: 4, at: RELIEF, spread: 16, tag: 'arms' },
        { do: 'spawnUnits', player: 0, key: 'mrdSolarch', count: 1, at: RELIEF, spread: 8, tag: 'arms' },
      ],
    },

    {
      id: 't.sept4',
      when: { on: 'elapsed', ticks: minutes(15) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Oreth, Warden of the Count',
          text: 'Lances forward with the fourth. I would rather stand in the doorway than watch it '
            + 'signed away, and I would rather do neither.',
        },
        { do: 'spawnUnits', player: 1, key: 'mrdWayfarer', count: 4, at: ROAD, spread: 20, tag: 'sept4' },
        { do: 'spawnUnits', player: 1, key: 'mrdLancer', count: 2, at: ROAD, spread: 14, tag: 'sept4' },
        { do: 'spawnUnits', player: 1, key: 'mrdSolarch', count: 2, at: ROAD, spread: 12, tag: 'sept4' },
        { do: 'orderTagged', tag: 'sept4', order: 'attackMove', at: FLOOR },
      ],
    },
    {
      id: 't.sept5',
      when: { on: 'elapsed', ticks: minutes(18.5) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Oreth, Warden of the Count',
          text: 'Everything the chapterhouse still has, onto the floor. Three and a half minutes, '
            + 'and after that there is no Conclave to be Warden of.',
        },
        { do: 'spawnUnits', player: 1, key: 'mrdWayfarer', count: 4, at: ROAD, spread: 20, tag: 'sept5' },
        { do: 'spawnUnits', player: 1, key: 'mrdSolarch', count: 3, at: ROAD, spread: 14, tag: 'sept5' },
        { do: 'orderTagged', tag: 'sept5', order: 'attackMove', at: FLOOR },
      ],
    },

    /* -- the withdrawal, told twice ----------------------------------------
     * MINUTE TWENTY, UNCONDITIONAL. The player was told the rule at sixteen
     * seconds and is told the COST here, because the two are different pieces of
     * information and the second only becomes useful now.
     *
     * THE COST IS A RANGE AND THE LAYOUT'S §7 MEASURES IT: swept from every one
     * of the 28 open cells inside `FLOOR_AREA` to the cheapest cell outside the
     * rim, the walk is **30.6 to 36.0 m**, identical on Foot and Hover and on
     * both grids. That is 9.6 to 11.3 s for an `mrdLancer` at 3.2 m/s — the
     * slowest hull the player owns — and 4.0 to 4.7 s for a Solarch at 7.6. **Two
     * minutes is more than ten times what the manoeuvre costs even for the
     * lance**, and the rest of it is the fight.
     *
     * The draft said 65.2 m, seventeen seconds and "seven times", and the line
     * below said "about twenty seconds of driving". 65.2 is above the geometric
     * upper bound — a unit within 14 m of the centre is at most 26 m of straight
     * line from ground outside a 40 m rim — so the beat was quoting the player a
     * number no path on this map can produce. The copy names the slowest hull now
     * rather than a bare figure, because that is the one a player can check.
     */
    {
      id: 't.nudge',
      when: { on: 'elapsed', ticks: minutes(20) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Nael',
          text: 'Two minutes. Readers onto the floor, all four if they are still with us, and then '
            + 'walk everything that can shoot back over the wall and leave it there. It is thirty '
            + 'odd metres to open ground and ten seconds of driving for the slowest lance we have, '
            + 'so there is no version of this where we do it late.',
        },
      ],
    },
    /*
     * AND ONCE MORE, CONDITIONALLY, AT ONE MINUTE.
     *
     * The only trigger in the file that reads the withdrawal rule before the
     * hour, and it fires exactly when the player is about to lose to it. NOT a
     * `repeat`: a running commentary on a rule the player already knows is noise,
     * and `ToastStack.push` retires the oldest chip at `TOAST_MAX`, so a
     * repeating beat would delete somebody's "Base under attack".
     *
     * **`{ not: CLOSE }` IS WHAT KEEPS IT OFF THE CLOSING TICK, AND IT WAS
     * MISSING.** `elapsed` is a `>=`, so an arm that first enters the precinct
     * ON tick 39 600 arms this trigger and `t.quitMissed` in the same pass —
     * driven, the tick read
     * `dialogue<Hesk> complete:hands complete:entry fail:quit dialogue<Hesk> END:loss:quit`,
     * which is two Hesk beats and the thing `pact.06.common-ground` paid for.
     * A minute-twenty-one warning has nothing to say at the hour anyway: the
     * hour is when the loss is DECIDED, and `t.quitMissed` says it in the words
     * that name the row. `validateCampaign` allows the negation because `CLOSE`
     * is `elapsed` rather than `elapsedSinceArmed`.
     */
    {
      id: 't.warn',
      when: {
        on: 'all',
        of: [{ on: 'elapsed', ticks: minutes(21) }, { on: 'not', of: CLOSE }, ARMS_IN_PRECINCT],
      },
      then: [
        {
          do: 'dialogue',
          speaker: 'Hesk, of the pan',
          text: 'There is still a lance of yours inside the wall and the assessors have eyes. '
            + 'Whatever it is standing over, it is worth less than the conveyance.',
        },
      ],
    },

    /* -- the secondaries, resolved ABOVE the win ---------------------------
     * `runDirector` returns immediately once an outcome is set, so a completion
     * written below `t.win` never fires and `medalFor` — which gives silver only
     * when EVERY secondary is complete — never counts it.
     */
    {
      id: 't.house',
      when: {
        on: 'all',
        of: [SETTLE, { on: 'ownerCount', player: 1, role: 'building', tag: 'chapterhouse', max: 0 }],
      },
      then: [
        { do: 'completeObjective', id: 'house' },
        {
          do: 'dialogue',
          speaker: 'Nael',
          text: 'The forward house is off them. Anything that comes at the wall now has walked the '
            + 'whole way from their own gate.',
        },
      ],
    },
    /*
     * NO DIALOGUE, DELIBERATELY. This resolves on the same tick as `t.win`, and
     * `pact.06.common-ground` records a winning tick that emitted five beats with
     * one speaker answering herself. The row turning green IS the feedback, and
     * the winning tick carries exactly two lines from two speakers.
     */
    {
      id: 't.hands',
      when: { on: 'all', of: [CLOSE, FLOOR_STANDS, ALL_READERS] },
      then: [{ do: 'completeObjective', id: 'hands' }],
    },

    /* -- the hour ----------------------------------------------------------
     * THREE TRIGGERS THAT PARTITION EXACTLY, on the product of two independent
     * world reads. See the endings block in the header; `t.win` is written first
     * so that within one tick its `endOperation` is the one that lands.
     */
    {
      id: 't.win',
      when: {
        on: 'all',
        of: [CLOSE, FLOOR_STANDS, READERS_ON_FLOOR, { on: 'not', of: ARMS_IN_PRECINCT }],
      },
      then: [
        { do: 'completeObjective', id: 'entry' },
        { do: 'completeObjective', id: 'quit' },
        {
          do: 'dialogue',
          speaker: 'Hesk, of the pan',
          text: 'Read out on the floor, in front of the assessors, with nothing of the Order\'s '
            + 'inside the wall to read it for us. Eleven houses hold the precinct and the Order '
            + 'holds a lodging from us at a nominal rent. That is the first thing anybody has '
            + 'given us that was ours the moment it was said.',
        },
        {
          do: 'dialogue',
          speaker: 'Calvane',
          text: 'Four hundred years of standing, and it turns out standing was the last thing we '
            + 'had to spend. Take the sign off the gate on your way out. We are tenants now, and '
            + 'the count is true for everybody, and I cannot make those two sentences come apart.',
        },
        { do: 'endOperation', result: 'win' },
      ],
    },
    /*
     * THE READERS WERE THERE AND SO WERE WE.
     *
     * `entry` COMPLETES and `quit` FAILS, which is the honest reading of that
     * state rather than a tidy one: the row that asked for readers on the floor
     * got readers on the floor. The loss names `quit`, the row that actually
     * decided it, and `endOperation`'s `reason` is an OBJECTIVE ID rather than
     * prose so the end screen resolves it to that row's title.
     */
    {
      id: 't.quitMissed',
      when: { on: 'all', of: [CLOSE, FLOOR_STANDS, READERS_ON_FLOOR, ARMS_IN_PRECINCT] },
      then: [
        { do: 'completeObjective', id: 'entry' },
        { do: 'failObjective', id: 'quit' },
        {
          do: 'dialogue',
          speaker: 'Hesk, of the pan',
          text: 'They will not enter it. There is a gun of yours inside the wall, which makes it '
            + 'the Order conveying to itself on the Order\'s own ground — and the Order is the one '
            + 'party this was all supposed to stop needing the word of.',
        },
        { do: 'endOperation', result: 'loss', reason: 'quit' },
      ],
    },
    {
      id: 't.entryMissed',
      when: {
        on: 'all',
        of: [CLOSE, FLOOR_STANDS, READERS_ALIVE, { on: 'not', of: READERS_ON_FLOOR }],
      },
      then: [
        { do: 'failObjective', id: 'entry' },
        {
          do: 'dialogue',
          speaker: 'Calvane',
          text: 'The hour is gone and there was nobody on the floor to receive it. So the precinct '
            + 'is still ours, which is the only outcome of this week I did not want, and eleven '
            + 'households are still owed everything they were owed on Tuesday.',
        },
        { do: 'endOperation', result: 'loss', reason: 'entry' },
      ],
    },

    /* -- the floor ---------------------------------------------------------
     * YOU CANNOT CONVEY A THING YOU HAVE LEVELLED, AND THE FIRST DRAFT OF THIS
     * COMMENT ARGUED THE WRONG MECHANISM ENTIRELY.
     *
     * It measured SPLASH — a blast centred on a gate post is 19.799 m from the
     * floor's centre against the Oculus's `hitRadius` 5.6569, so 14.14 m of
     * surface separation against `sunLance`'s 2 m, 7.07 times over — and
     * concluded "the geometry says it is survivable". The splash arithmetic is
     * correct and it was an answer to a question nobody was asking. What killed
     * the instrument was ORDINARY DIRECT FIRE: `Targeting.isValidTarget` refuses
     * only ALLIES, an unarmed enemy building is a legal target scoring
     * `COMBAT_TARGETING.softBuilding` 0.55, and `stanceAllowsAcquire` refuses
     * only `Stance.HoldFire`. Driven through a real `Targeting` / `Weapons` /
     * `Projectiles` / `Damage` rig on the bound tables, with the floor on the
     * Sept:
     *
     *     the opening column (7 Solarch + 4 Lancer), Defensive, ringed at 22 m
     *                                            floor dead in 4.37 s
     *     the same column parked where an `OrderKind.Attack` on the FAR gate
     *     post from the camp puts it — 3.78 m from the floor's centre
     *                                            floor dead in 5.07 s, and the
     *                                            post it was aimed at untouched
     *     one Solarch alone, swept 20 -> 40 m    kills out to 33 m
     *
     * Two controls say that is the rule and not the rig: the same column around
     * an OWN Oculus, and the same column on `Stance.HoldFire`, both left it at
     * 650/650 after sixty seconds.
     *
     * **SO THE FLOOR IS GAIA'S AND THIS TRIGGER IS FINALLY WHAT IT SAYS IT IS.**
     * `ScenarioBuilder.gaia` allies the Neutral slot to everybody in both
     * directions, so neither army can acquire it — same column, same ring,
     * 650/650 after 120 s — and the only thing that reaches it is the splash the
     * paragraph above was always about. `Damage.applySplash` has no ally filter;
     * it halves an allied victim by `COMBAT_DAMAGE.friendlyFireMul` 0.5 and
     * nothing more. One Sept `mrdLancer` shelling a reader pressed against the
     * instrument's face costs it 58.30 hp in 30 s — 1.94 hp/s, 5 min 35 s for the
     * whole 650. A hazard with a clock on it, which is what a live hazard should
     * look like, rather than a five-second accident on the main line.
     *
     * The layout's §3b holds the measurement and the reason no arrangement of the
     * posts could have fixed it: a post that covers a 14 m floor stands within
     * ~19.8 m of it, a hull that may shoot that post stands 20.8 m from the post,
     * and the instrument's own lethal radius is 33 m.
     *
     * `SETTLE` because `entityDead` reads TRUE before the tag has ever been
     * stamped, `FLOOR_STANDS` on `t.readersLost` so this trigger and that one
     * cannot both fire, and `captureProof: ['floor']` because a NEUTRAL structure
     * is captured outright at any health by one man.
     */
    {
      id: 't.floorLost',
      when: { on: 'all', of: [SETTLE, { on: 'entityDead', tag: 'floor' }] },
      then: [
        { do: 'failObjective', id: 'entry' },
        {
          do: 'dialogue',
          speaker: 'Hesk, of the pan',
          text: 'That was the instrument. Whatever was going to be conveyed to us, what is on '
            + 'that floor now is the ground it stood on and a heap of glass, and I have had one of '
            + 'those this week already.',
        },
        { do: 'endOperation', result: 'loss', reason: 'entry' },
      ],
    },

    /* -- the readers, and the ordinary loss, WHICH ARE ONE TRIGGER ---------
     * FAILS AT THE MOMENT IT BECOMES UNREACHABLE rather than at the hour. Three
     * is the bar, so two alive is an operation that cannot be finished, and an
     * objective that stays lit after it is impossible is a lie the player plays
     * against for another ten minutes.
     *
     * **THERE IS NO SEPARATE `t.beaten`, AND THERE WAS ONE UNTIL IT WAS DRIVEN.**
     * The draft carried the usual second loss — `ownerCount(player 0, role
     * 'unit', max: 0)`, `allies.07.fair-copy`'s shape, chosen over `playerBeaten`
     * because `Viability.surveyViability` books a garrisoned occupant into
     * `heldUnits` and under `opening: 'force'` `isBeaten` therefore reduces to
     * "no units OUTSIDE a building". It is UNREACHABLE AS A DISTINCT CASE: the
     * readers are units, so zero units implies two or fewer readers, so this
     * trigger's condition is strictly weaker and fires on the same tick or
     * earlier. Driven through the real `runDirector` with a world holding
     * nothing, the ending tick emitted **two `failObjective`s, two dialogue beats
     * from two speakers and two `endOperation`s** — which is
     * `pact.06.common-ground`'s five-beat winning tick in miniature, and the only
     * thing the extra trigger bought was noise.
     *
     * So the honest reading is that in an operation with no production, losing
     * the readers IS being beaten, and losing everything is a subset of it. This
     * one line covers both and the debrief names the thing that actually decided
     * it.
     */
    {
      id: 't.readersLost',
      when: {
        on: 'all',
        of: [
          SETTLE,
          // DISJOINT FROM `t.floorLost`, WHICH IS NOT GATED ON THE CLOCK EITHER.
          // Without this the pair fired together in 48 of the 320 driven end
          // states — two `endOperation`s and two Hesk beats. See `FLOOR_STANDS`.
          FLOOR_STANDS,
          { on: 'ownerCount', player: 0, role: 'unit', tag: 'readers', max: 2 },
        ],
      },
      then: [
        { do: 'failObjective', id: 'entry' },
        {
          do: 'dialogue',
          speaker: 'Hesk, of the pan',
          text: 'Two of us. It wants three — one to read it, one to receive it and one to sign '
            + 'that the other two did. That is not a rule the Order made and it is not one I can '
            + 'waive for you.',
        },
        { do: 'endOperation', result: 'loss', reason: 'entry' },
      ],
    },
  ],
};

export default op;
