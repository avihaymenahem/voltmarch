/**
 * ============================================================================
 * S8 — CARRIAGE FORWARD
 * ============================================================================
 * S7 took the record. Both halves of the lease left the sector in Soviet hands
 * and the Ninth District was wound up around the hole where its paperwork had
 * been. The file went up.
 *
 * **AND CONTINENTAL DID NOT DISPUTE A LINE OF IT.** That is the turn this
 * operation exists for. Seven operations of argument ended with the Soviets
 * holding the only record of the ground, and the office that received it read
 * the record, accepted it, and did the one thing a Continental office does with
 * an accepted record: it put the sector on the schedule. The seam is not a
 * claim any more and it is not a survey. It is a line with a figure against it
 * in a ledger four hundred miles away, and a line in that ledger has to be seen
 * being WORKED.
 *
 * So the yards push the plant out. There is a refinery standing on the seam
 * that was carted out last quarter and never staffed, and there are twelve men
 * on the ramp who have to walk two hundred metres of haul road to reach it.
 *
 * **WHAT ANSWERS IS NOT ANOTHER ADMINISTRATION.** The Ninth lost an allocation,
 * a revision, a demolition order and finally its own record, and every one of
 * those was a thing somebody could be argued out of. What Continental has sent
 * is an establishment: a movement order with dates on it, filed before anybody
 * looked at the ground, and a column that executes those dates whatever is
 * happening on them. It has already put two posts on the haul road and entered
 * them as a road inspection. Nobody is going to discuss it.
 *
 * ============================================================================
 * WHY `primaryType: 'escort'`
 * ============================================================================
 * `types.ts` gives the six verbs a briefing may use and names two of them for
 * this shape: **`reach` is `unitsInArea`** and **`protect` is a loss on the
 * thing that must survive**. This operation is both, three times over, and it
 * is nothing else — the win is nine of the twelve men the yards sent standing
 * on the working with the plant still up, and every other trigger in the file
 * either delivers men, threatens them, or ends the operation.
 *
 * It is deliberately not `capture-hold`: nothing is held against a clock. The
 * win is the instant the ninth man is inside the disc, and `soviets.04.company-town`
 * already spent that verb on five derricks. It is not `assault` either — the
 * player may raze the Continental base and be no closer to the working.
 *
 * ============================================================================
 * TWELVE, NINE AND TWO, AND WHY THOSE THREE NUMBERS
 * ============================================================================
 * Three lifts of four `engineer`s: **twelve men**, at 0:45, 6:00 and 17:00.
 * Nine of them have to be standing inside `WORKING_AREA` at once. So the margin
 * is **three**, and the whole operation is spending it.
 *
 * **AND THE TWELVE ARE THE ONLY TWELVE, WHICH IS A TAG AND NOT A UNIT TYPE.**
 * `WORKING_STAFFED` counts `unitsInArea(0, WORKING_AREA, min: 9, tag: 'shift')`
 * and `t.thin` counts `ownerCount(0, 'unit', 'shift', max: 8)`. Both go through
 * `runtime.ts`'s `taggedSlots`, so the ONLY engineers either one can see are
 * the twelve `EffectSink.spawnUnits` stamped. A bought engineer is the same
 * model, the same name and the same panel row, and it is not the shift — and
 * `src/ui/objectives.system.ts` renders a title and a status and no count, so
 * nothing on screen could ever have shown the difference.
 *
 * **THE FROZEN VOCABULARY CANNOT FIX THAT, SO THE FIX IS TO SAY IT.** There is
 * no condition that tags a unit a trigger did not spawn, and giving `shift` to
 * bought men would need an effect that does not exist. What changed instead is
 * that the primary now reads *"Put nine of the yards' twelve on the seam"*
 * rather than *"Put the shift on the seam"*, Vosk says it in as many words on
 * the first lift, and `t.thin`'s defeat line repeats it. A rule the player
 * cannot see is a trap; a rule they are told twice is a constraint.
 *
 * **NINE IS FORCED FROM BOTH SIDES.**
 *
 *   - **Eight would end the operation at minute seven.** Lift A plus lift B is
 *     exactly eight men, so a threshold of eight is a win the third lift never
 *     has to leave the ramp for — and the third lift is the one the fourth
 *     movement exists to meet. Any number above eight forces all three lifts.
 *   - **Twelve would make one stray shell fatal** and would make the shown
 *     secondary and the primary mutually exclusive rather than a decision: a
 *     tap costs an engineer, so two taps out of the shift leaves ten.
 *   - **Nine leaves a margin of three, which is one man per movement after the
 *     first.** That is the number this file is least sure of and it is named
 *     as such at the bottom.
 *
 * **A TAP COSTS ONE MAN, AND THERE ARE TWO WAYS NOT TO PAY IT.** The taps are
 * Gaia, and `Capture.ts` rule 1 flips a NEUTRAL structure at ANY health, so one
 * engineer takes one tap — no soften ladder, nothing like S7's four men, whose
 * record blocks were on seat 1 precisely so that the ladder existed. Both taps
 * out of the shift is 12 - 2 = 10 and the margin collapses to one. But
 * `engineer` carries no `unlockedBy` and its prereqs are `barracks` and
 * `refinery`, both standing at t = 0, so **two bought engineers are 1000
 * credits out of a 5000 bank** and cost the shift nothing; and a SQUAD is the
 * third route, because `civOilDerrick` clears `GARRISON.minFootprint` on both
 * axes and `GarrisonService.enter` calls `captureBuilding`. Two men, a
 * thousand credits, or two squads standing out on the seam. The operation does
 * not pick.
 *
 * **AND `Capture.ts` RULE 3 IS THE TRAP NOBODY EXPECTS TO PAY.** An engineer
 * walked into a DAMAGED structure its own player owns sets `hp = maxHp` and is
 * consumed (`Capture.ts`'s `this.consume(i, engineer)`), and
 * `input/Commands.ts` turns a right-click on a damaged own building into
 * `OrderKind.Repair` for every `canCapture` unit in the selection. The plant
 * will be damaged — see the next section — so the obvious repair is a
 * right-click, and it can spend the whole margin in one drag-select. That is
 * the second half of the reason the primary names the yards' twelve out loud:
 * a bought engineer repairs the plant for 500 credits and costs the shift
 * nothing, and the player has to know that to make the trade.
 *
 * ============================================================================
 * WHAT KILLS AN ENGINEER, MEASURED
 * ============================================================================
 * `engineer` is 90 hp, `ArmorClass.Infantry`, `Locomotor.Foot` at `maxSpeed`
 * 3.4, unarmed, and `EntityFlag.Crushable` with `crushableBy: 1`. Every figure
 * is the shipped row through `ARMOR_MATRIX` at `COMBAT_DAMAGE.globalMul` 0.80:
 *
 *     pillboxMg   5 x 13 SmallArms x 1.00 = 52.0 a pull, cycle 0.79 s   TWO PULLS
 *     rifle       3 x 18 SmallArms x 1.00 = 43.2 a pull, cycle 1.03 s   THREE
 *     lightCannon 55 ArmorPiercing x 0.35 = 15.4 a shot, cycle 1.50 s   SIX
 *     prismBeam   92 Prism x 1.10        = 80.96 a beam, cycle 2.60 s   TWO
 *
 * **THE `grizzly` DOES NOT NEED SIX SHOTS AND WILL NOT TAKE THEM.**
 * `crushLevel` 3 against `crushableBy` 1, and `src/sim/Crush.ts`'s own header
 * says it in as many words — *"A Warden (3) flattens every rifleman in the game
 * (1)"*, `grizzly` being the Warden Tank (the player's `rhino` is the Anvil and
 * `apocalypse` the Sledge, which is the naming this file uses throughout). The
 * wheels are the threat, not the gun, and `crushesUnit` is a KILL through
 * `Damage.applyOne` rather than a deletion, so a crushed man is a man off the
 * count with a body and an announcer line.
 *
 * **AND `prismBeam` ALL BUT ONE-SHOTS THE CARGO AT THIRTY METRES.** 80.96 of
 * 90, at range 30, from a hull neither sidebar can build. That is the whole
 * escalation and the next section is why it is legitimate.
 *
 * ============================================================================
 * WHAT CONTINENTAL SENDS, AND WHY IT IS NOT IN EITHER SIDEBAR
 * ============================================================================
 * `roster: { player: [], ai: [] }`. Two empty lists are a RESTRICTION rather
 * than an absence: the roster is an ALLOW-LIST over tagged content, so
 * tagged-and-unlisted is refused for BOTH seats. Measured on bound tables with
 * `setCampaignRoster` armed, against an unrostered control build of the same
 * ground, the openings really do lose content:
 *
 *     seat 0   -1 apocalypse   -2 attackDog   -1 battleLab   -3 teslaCoil
 *     seat 1   -1 battleLab    -2 ifv         -1 prismTower
 *
 * `prismTank` carries `unit.specialist`, the same tag as the `apocalypse` the
 * player just lost, so **the Refractor Tank is refused to both sidebars** —
 * and `t.moveD` lands two of them at minute sixteen anyway, because
 * `EffectSink.spawnUnits` resolves through `ProductionCatalog.byKey` and calls
 * `ProductionService.spawnUnit` directly. **A SCRIPTED SPAWN NEVER PASSES
 * THROUGH `isBuildable`**, which is a property of the sink rather than a
 * loophole in the roster, and it is what lets an establishment field something
 * the sector cannot answer in kind.
 *
 * The gap is exact and there is no purchase that closes it: under this roster
 * the longest gun the Soviet player can put on the ground is `heavyCannon` at
 * **range 26**, against `prismBeam`'s **30**. Four metres, two hulls, at minute
 * sixteen, over a column of unarmed men. The answer is numbers and position,
 * not tech, which is the only answer a sector on somebody else's schedule ever
 * gets.
 *
 * **SYMMETRIC AND PROFILE-INDEPENDENT**, so the ground is the same on a
 * finished account as on a fresh one — which a deny-list could not promise, and
 * which matters because `UnlockGate.mirrorAI` would otherwise resolve the AI
 * against the human's profile. `setCampaignRoster` is consulted AHEAD of both
 * the PvP suppression flag and the installed gate.
 *
 * ============================================================================
 * THE TIMETABLE IS THE JOKE AND IT IS ALSO THE MECHANIC
 * ============================================================================
 * Continental moves at **four, eight, twelve and sixteen minutes** — a regular
 * four-minute schedule, filed by an office that has never seen this ground, and
 * kept whatever is happening on it. The yards lift at **0:45, six and
 * seventeen**. Both timetables are read out at minute three, so every wave in
 * this operation is announced before it lands.
 *
 * **THE LAST LIFT IS AFTER THEIR LAST MOVEMENT AND THAT IS THE WHOLE POINT OF
 * THE PAIRING.** It was at fifteen, one minute AHEAD of them, and the arithmetic
 * behind that ordering was wrong in the direction that deletes the ending: see
 * least-sure-number 2 below, where the walk is now measured rather than
 * inferred. Continental's four-minute grid does not move — it is the joke, it is
 * read out, and a player plans against it — so the lever is ours.
 *
 * **AND THE ORDERING IS STRUCTURAL RATHER THAN A MARGIN.** Lifts A and B are
 * four men each, so the ninth tagged `engineer` CANNOT EXIST before `LIFT_C`
 * fires; with `LIFT_C` at 1020 ticks against `t.moveD` at 960 the fourth
 * movement is unavoidable however fast anybody walks, which is not a claim the
 * old fifteen-minute lift could make at any walking speed. On top of that the
 * movement is not merely spawned but ARRIVED: from `ROAD_A` its Refractor Tanks
 * and Warden Tanks reach the working in 11.2-15.5 s, so the seam is held from
 * about 16:12 and the earliest ninth man crosses the disc edge at 17:22.8 —
 * **sixty-six to seventy-two seconds** of it standing there first. That is what
 * "the last lift walks the road while their last movement is on it" was always
 * supposed to mean.
 *
 * That is the opposite of every earlier operation in the chapter, where the
 * Ninth screened in reaction to the player and `soviets-deep-sector` had to
 * argue that a scheduled wave reads as an opponent rather than as the map
 * cheating. An establishment does not react. The reason the schedule is GIVEN
 * to the player is the same reason it is regular: it is the difference between
 * an enemy and an authority, and a player who can read a timetable can plan
 * against it, which is the only advantage this operation hands out.
 *
 * The four destinations are three different places, and the first one is not
 * the plant:
 *
 *     4:00   ROAD_B -> the picket      the road inspection. Six hulls.
 *     8:00   ROAD_A -> the working     eight hulls, 86.14 dps against 1200 hp.
 *    12:00   ROAD_B -> the lane patch  seven, at the economy behind the escort.
 *    16:00   ROAD_A -> the working     nine, two of them Refractor Tanks.
 *
 * **THE FIRST MOVEMENT IS AT THE PICKET ON PURPOSE.** The layout measures the
 * second movement at 86.14 dps against an undefended plant, which is 13.9
 * seconds; putting that at minute four would decide the operation before the
 * player had finished reading the brief. At minute eight they have had the
 * warning twice, the five Anvils of the opening, and eight minutes.
 *
 * ============================================================================
 * THE SHOWN SECONDARY IS THE SEAM PAYING FOR ITS OWN DEFENCE
 * ============================================================================
 * `taps` is `ownerCount(0, 'building', 'taps', min: 2)` — both derricks on our
 * books at once. `ownerCount` rather than `structureCaptured` because the
 * latter answers for the FIRST live entity in stamp order and cannot express
 * "both", and rather than `entityAlive` because that is blind to who owns the
 * thing.
 *
 * `CIVILIAN_INCOME` prices a held derrick at 15 credits a second — **900 a
 * minute**, against a real harvester measured at 429 to 700 a minute in
 * `tests/harvester-soak.spec.ts`. Two taps are therefore worth about four
 * harvesters that cost nothing and need no ore field, and **nothing in this
 * operation's objectives reads credits**: the taps buy the army that keeps the
 * plant standing, and that is the only reason to want them. It is also the only
 * economy lever the operation offers, which is deliberate —
 * `soviets.09.nil-return` is the economy operation and two adjacent operations
 * about a bank would be one idea twice.
 *
 * It fails when it becomes unreachable — a levelled tap can never be opened —
 * and at the win if it is still open, so the row always resolves.
 *
 * ============================================================================
 * AND THE HIDDEN ONE IS WHAT MAKES THE THOUSAND CREDITS WORTH SPENDING
 * ============================================================================
 * `whole` pays 400 for delivering all twelve: `ownerCount(0, 'unit', 'shift',
 * min: 12)` at the moment the primary completes. It is a state at the win
 * rather than a clock, which is a third device after
 * `soviets.06.demolition-order`'s order of operations and
 * `soviets.07.right-of-entry`'s window.
 *
 * **IT IS NOT EXCLUSIVE WITH THE TAPS, AND THAT IS THE ENTIRE DESIGN.** Two
 * taps out of the shift is 12 - 2 = 10 and this row is gone; two BOUGHT
 * engineers are 1000 credits and it survives. So the shown secondary asks
 * "will you open the taps" and the hidden one turns that into "with whose men",
 * which is a decision worth 400 credits rather than a second copy of the first
 * objective. The third route — two squads garrisoning two derricks — satisfies
 * both and costs neither, and it is discoverable rather than told, because
 * `src/data/Civilians.ts` documents it for this def and this operation does
 * not.
 *
 * **A LIFT-SCOPED VERSION WAS WRITTEN FIRST AND IS NOT EXPRESSIBLE.** "Bring
 * the LAST lift in without losing a man" is the better beat — lift C lands at
 * seventeen minutes and the last movement is already on the seam, so those four
 * walk the road under the only two Refractor Tanks in the operation — and it
 * needs the third
 * lift to carry a tag of its own ON TOP of the shared tag the primary counts.
 * **`EffectSink.spawnUnits` takes exactly ONE `tag`**, and the sink stamps it
 * inside the same loop that places the hull, so there is no second call that
 * could add a tag to entities that already exist. Splitting the lift across two
 * `spawnUnits` calls gives four men under two tags and silently breaks the
 * primary's twelve. The vocabulary is frozen and this is one of the things it
 * genuinely cannot say; it is recorded here so the next author does not spend
 * an afternoon on it.
 *
 * ============================================================================
 * FOUR AUTHORED ENDINGS, AND NEITHER SHIPPED RULE MAY DECIDE ANY OF THEM
 * ============================================================================
 * `annihilationWin` is off because razing the Continental base is not the
 * order: `Shell.pollOutcome` asks whether every non-allied seat holds zero
 * assets and has no opinion about whether a plant is staffed, so it would
 * declare victory with the shift still on the ramp. `assetLossDefeat` is off
 * because a commander who has lost the yard and still has nine men on the haul
 * road is the most interesting last act this operation has, and `pollOutcome`
 * would end it at 2 Hz instead.
 *
 * The authored losses are the plant gone (`t.plantLost`), the shift too thin to
 * make nine (`t.thin`), the close (`t.close`) and `playerBeaten`. The first two
 * fire the moment the primary becomes UNREACHABLE rather than at the deadline,
 * which is the rule `soviets.06.demolition-order` states for its infirmary: a
 * tag is stamped once, inside the layout, so a rebuilt refinery carries none
 * and no amount of further play can restore either condition. An objective that
 * stays lit after it is impossible is a lie the player plays against for
 * another ten minutes.
 *
 * ============================================================================
 * NO `captureProof`, AND THE REASON IS A MEASUREMENT PLUS A CAPABILITY AUDIT
 * ============================================================================
 * The plant is SEAT 0's and every threshold in this file counts what seat 0
 * holds, so a capture reads as a loss — the shape
 * `reclamation.05.closing-entry` declares the field for. And the hazard is not
 * hypothetical on the ground: measured on the built world, **seat 1 opens
 * holding one `engineer`**, because `buildAlliedBase` spawns one.
 *
 * It is still not declared, because the verb is unreachable rather than
 * merely unused. CLAUDE.md's capability audit of `src/sim/AI.ts` lists
 * `Capture` among the commands the brain NEVER issues; `engineer`'s build
 * weight is 0 and `buildUnits` filters `weight <= 0`, so the brain neither buys
 * one nor orders the one it was given to do anything but die in a squad. A
 * `captureProof` entry here would be a well-spelled no-op — the
 * `map.coral-shore` shape `validate.ts` refuses for rosters — and it would add
 * a row to `tests/campaign-capture-proof.spec.ts` claiming a protection nothing
 * can test.
 *
 * What IS done is the cheap half: `t.plantLost` reads
 * `ownerCount(0, 'building', 'plant', max: 0)` rather than
 * `entityDead: 'plant'`, so the trigger is already correct on the day somebody
 * teaches the brain the verb. The predicate covers the case; the field is not
 * claimed for a hazard nothing can reach today.
 *
 * ============================================================================
 * WHAT THIS OPERATION DOES NOT CHECK, SAID OUT LOUD
 * ============================================================================
 * Nine men standing in a 38 m disc is a COUNT, not an act. A player who parks
 * the shift there and builds nothing has satisfied it. The twelve conditions
 * cannot see a harvester dock, an ore cell drain or a credit earned by a
 * particular refinery, so "the seam is being worked" is not directly
 * expressible and this file does not pretend it is. What it checks is the two
 * halves that ARE expressible and that together mean it: the plant standing,
 * and the labour on the ground with it, at the same moment, after four
 * movements have tried to remove one or the other.
 *
 * ============================================================================
 * THE THREE NUMBERS I AM LEAST SURE OF
 * ============================================================================
 *   1. **Nine of twelve.** The margin of three is derived from the lift
 *      arithmetic, not from a played match, and nobody has walked this road.
 *   2. **Lift C at seventeen against movement four at sixteen — WHICH IS THE
 *      OTHER WAY ROUND FROM HOW THIS SHIPPED, AND THE OLD ORDERING DELETED
 *      THE ENDING.** The first version put lift C at fifteen and reasoned from
 *      "a 176 m walk at 3.4 m/s (52 s of pure travel)" against a movement at
 *      sixteen. Both halves of that were wrong. 176 m is a 4-CONNECTED fill
 *      depth, which cannot spend a diagonal and overstates the walk by 32%;
 *      the engine's own 8-connected expander over `costGridFor` makes it
 *      **133.82 m**. And the primary does not count at `WORKING`, it counts
 *      inside `WORKING_AREA`, r = 38 — so the boundary a man has to cross is
 *      **93.54 m** from the muster, and lift C's four ring points are
 *      **105.82 / 79.88 / 77.54 / 104.17 m** from it, i.e. **31.1 / 23.5 /
 *      22.8 / 30.6 s** at 3.4. Lifts A and B are eight men, so the NINTH is
 *      lift C's first arrival: at fifteen minutes that is **15:22.8, thirty-
 *      seven seconds before `t.moveD` even spawned**. The two Refractor Tanks,
 *      the four-metre `prismBeam` 30 against `heavyCannon` 26, and the whole
 *      "what Continental sends" section were content no competent player ever
 *      met — and the trigger really was skipped, not merely raced:
 *      `Director.runDirector` returns as soon as `state.outcome` is set, so
 *      `t.moveD` never evaluated on a clean win.
 *
 *      At seventeen the earliest ninth man is **17:22.8**, and the fourth
 *      movement reaches the working long before that: from `ROAD_A` its three
 *      `grizzly` walk 74.2-102.2 m of Track route at `maxSpeed` 6.6 (**11.2-
 *      15.5 s**) and its two `prismTank` 71.3-92.9 m at 6.0 (**11.9-15.5 s**),
 *      so the seam is held from about **16:12**. Sixty-six to seventy-two
 *      seconds of it standing there before the walk can finish, and the walk
 *      has to go through it. What is still NOT measured is whether 2:37 from
 *      that arrival to `CLOSE` is enough to fight nine hulls off a disc — it is
 *      route geometry and arithmetic, with no acceleration, steering, crowding
 *      or combat in it, and this is now the thinnest number in the file.
 *   3. **The second movement at 86.14 dps against a 1200 hp plant.** The
 *      damage is derived exactly; whether eight minutes is enough warning for
 *      a player to have a garrison 171 m from their yard is not.
 * ========================================================================== */

import { Faction } from '../../../core/types';
import { minutes, seconds } from '../../types';
import type { Condition, OperationDef } from '../../types';
import {
  MUSTER, PICKET, PICKET_AREA, PLANT, PUSH, ROAD_A, ROAD_B,
  TAP_EAST_AREA, TAP_WEST_AREA, WORKING, WORKING_AREA,
} from '../../layouts/soviets-carriage-forward';

/**
 * THE GEOMETRY IS IMPORTED, NOT RESTATED.
 *
 * The plant, the taps and the posts are placed by the layout and the columns
 * are ordered at them by this file. A number written in two files is a number
 * that will disagree the first time either is tuned, and the failure — a reveal
 * that frames empty ground, a column that lands somewhere nobody authored — is
 * invisible to every gate. `layouts/soviets-carriage-forward.ts` owns the
 * geometry.
 */

/**
 * How long the layout is given to have placed the ground before any zero
 * threshold over it is believed.
 *
 * **A ZERO THRESHOLD IS TRUE BEFORE THE GROUND EXISTS.**
 * `ownerCount(0, 'building', 'plant', max: 0)` reads TRUE for a build that
 * placed no plant, so it would LOSE this operation on tick one;
 * `ownerCount(1, 'building', 'picket', max: 0)` would congratulate the player
 * on clearing a road nobody was standing on; and `playerBeaten` reads TRUE for
 * a seat with no producer and no hull. All three are silent and all three pass
 * every test. `soviets.05.short-allocation` and `soviets.06.demolition-order`
 * guard their own zero thresholds with the same constant and for the same
 * reason.
 *
 * The threshold is about the BUILD, not about a race: the world is finished
 * before tick one, so any value above zero closes the hole. Twenty seconds is
 * unmistakably past it and unmistakably short of anything being lost — the
 * first lift is at forty-five seconds and nothing hostile is ordered anywhere
 * before minute four.
 */
const SETTLE: Condition = { on: 'elapsed', ticks: seconds(20) };

/** The yards' three lifts. Twelve men, four at a time. */
const LIFT_A = seconds(45);
const LIFT_B = minutes(6);
const LIFT_C = minutes(17);

/** When both timetables are read out and the hidden row is disclosed. */
const DISCLOSE = minutes(3);

/**
 * When the shift is judged too thin to make nine.
 *
 * TWENTY SECONDS AFTER THE LAST LIFT, and the delay is the tick-one guard in a
 * different costume: `ownerCount(0, 'unit', 'shift', max: 8)` is TRUE from tick
 * one — the tag holds nothing until the first lift lands — and stays true
 * through lift A (four men) and lift B (eight). Only once the third lift is on
 * the ground is a count of eight or fewer a statement about losses rather than
 * about the clock. It MOVES WITH `LIFT_C` and its whole argument is the twenty
 * seconds, so the two are a pair: change one without the other and this either
 * fires while a lift is still in flight or stops being a statement about
 * losses at all.
 *
 * **IT IS ALSO WHERE THE TAG SCOPE BITES HARDEST, AND THE FIX IS PROSE.** The
 * count is `tag: 'shift'`, so a player who has lost four of the twelve and
 * bought six replacements still loses here, with twelve engineers standing on
 * the seam. That is CORRECT — the primary counts the same tag, so nine of the
 * yards' twelve really has become unreachable — and it is unreadable unless
 * somebody says so. The primary title, Vosk's line on the first lift and this
 * trigger's own defeat line all name the yards' twelve for that reason.
 *
 * **IT IS ALSO THE ONE THRESHOLD A SILENT SPAWN FAILURE WOULD TRIP.** If
 * `spawnUnits` placed nothing, this reads eight-or-fewer at 17:20 and ends the
 * operation in a defeat that names the right objective for the wrong reason.
 * `EffectSink.spawnUnits` raises `onSpawnFault` on every miss and
 * `tests/campaign-spawn-ground.spec.ts` checks every ring point of every lift
 * against `engineer`'s own locomotor, which is as far as a gate can get.
 */
const THIN = minutes(17) + seconds(20);

/**
 * The shift is on the seam and the plant is still standing.
 *
 * Defined once because three triggers must agree on it — the win and both
 * secondaries resolve on the same tick — and two copies of a condition are two
 * copies that will disagree the first time either is tuned.
 * `soviets.06.demolition-order`'s `WORKS_GONE` and
 * `soviets.07.right-of-entry`'s `ENTRY_MADE` are the same shape for the same
 * reason.
 *
 * **THE PLANT CLAUSE IS NOT REDUNDANT WITH `t.plantLost`.** It could be argued
 * to be: the operation ends in defeat the moment the plant is gone, so no later
 * tick can satisfy the count with the plant down. But `t.plantLost` carries a
 * settle guard and this does not, and a win condition that depends on ANOTHER
 * trigger having fired first is a win condition whose correctness lives in file
 * order. Stated here, the condition is state-complete on its own.
 *
 * It needs no settle of its own: both halves count UP from zero and the tag
 * registry cannot make either true early.
 */
const WORKING_STAFFED: Condition = {
  on: 'all',
  of: [
    { on: 'ownerCount', player: 0, role: 'building', tag: 'plant', min: 1 },
    { on: 'unitsInArea', player: 0, area: WORKING_AREA, min: 9, tag: 'shift' },
  ],
};

/**
 * The shift closes, and it is `parSec` 1200 to the second.
 *
 * The authored par IS the deadline rather than a description of one, which is
 * the only way that field is falsifiable from inside the operation. This
 * chapter's ramp is 780 / 840 / 900 / 960 / 1020 / 1080 / 1140 / 1200 and
 * `soviets.03.deep-sector` through `.07.right-of-entry` all make the same
 * identification.
 */
const CLOSE: Condition = { on: 'elapsed', ticks: minutes(20) };

const op: OperationDef = {
  id: 'soviets.08.carriage-forward',
  chapter: 'soviets',
  faction: Faction.Soviets,
  /*
   * STILL ALLIED, AND THE POINT IS THAT IT IS NO LONGER THE NINTH. The district
   * that filed for the town in S4, signed the revision in S5, filed the
   * demolition order in S6 and was wound up in S7 is gone; what holds seat 1 is
   * a Continental establishment with the same badge and none of the same
   * problems. `t.move*` spawns literal Allied `gi`, `grizzly` and `prismTank`,
   * which `validateCampaign` checks against the army of the seat they land on,
   * and the layout puts two Allied `pillbox`es on the haul road. Two seats, so
   * `op.foe` fills exactly one of them.
   */
  foe: Faction.Allies,
  index: 8,
  title: 'Carriage Forward',
  beat: 'Continental accepted the record and put the sector on the schedule, so the seam has to '
    + 'be seen working.',
  primaryType: 'escort',
  /*
   * BESPOKE. Objectives, spawns, orders, reveals, dialogue, a camera move, an
   * announcer line and an outcome — `types.ts` defines the archetype as
   * "multiple effect kinds", and this is TEN of the eleven. The one it does not
   * use is `grantCredits`: both secondaries pay through `ObjectiveDef.credits`,
   * which is the same `Economy.grant` on a rail that `paid` keeps from paying
   * twice across a reload.
   */
  archetype: 'bespoke',
  parSec: 1200,
  requires: ['soviets.07.right-of-entry'],

  map: {
    /*
     * `temperate` is `relief` 0.42 / `cliffs` 0.35 — behind `snow`'s 0.50 and
     * TIED WITH `atoll` at 0.42, which is stated as the tie rather than as
     * "second highest" because that is the superlative
     * `soviets.05.short-allocation` records getting wrong twice — and that is a
     * requirement rather than a change of scene. The operation is a walk, and a
     * walk needs ground that can pinch: the haul corridor on this roll threads
     * a band of broken relief, and the two Continental posts stand on its two
     * shoulders where it does. Measured through the engine's own 8-connected
     * expander over `FlowFieldCache.costGridFor`, every shortest Foot route
     * from the muster to the working spends at least **38.63 m** inside
     * `pillboxMg`'s 22, and the cheapest route that enters NEITHER gun costs
     * **33.8% more**. On the flattest preset the escort would have no road,
     * only a direction.
     *
     * **THAT CLAIM USED TO READ "4.00 m from the shortest open route" AND WAS
     * FALSE BY AN ORDER OF MAGNITUDE.** It came from a 4-connected fill, which
     * is not the metric the flow field pathes in; under the engine's own
     * neighbour set and corner rule the posts were 45-57 m off every optimal
     * route, and a 22 m exclusion around both of them cost the walk NOTHING.
     * The posts moved; the sentence is an exclusion control now, because a
     * distance from one reconstructed path is not evidence about a corridor
     * that holds 168 cells of equally short route.
     *
     * It is also a change of ground after `soviets.07.right-of-entry`'s urban
     * and before `soviets.09.nil-return`'s snow; `soviets.02.common-standard`
     * and `.05.short-allocation` are the chapter's other temperate rows, three
     * operations back.
     *
     * `biome` is `'temperate'` and so is the preset — they agree here, which
     * they do NOT for `arid`/`desert`. See `OperationMap.biome`: `getBiome`
     * answers an unknown name with a warning and TEMPERATE, so a mismatch ships
     * a different landform in silence, and `reclamation.03.sold-twice` has
     * already paid for that.
     */
    preset: 'temperate',
    biome: 'temperate',
    /*
     * CHOSEN ON A MEASURED SWEEP OF TEN, not picked. Counting 4 m cells through
     * the real `Terrain.isPassable` for Foot AND Track: 73.11% of the map is
     * passable, **96.83%** of the corridor within 40 m of the segment joining
     * the two start spots is — the best lane figure of the ten against a band
     * of 86.30% to 96.83% — 96.15% of the corridor within 30 m of the haul road
     * is, and 91.48% of the disc of radius 60 about the working.
     * `tests/campaign-maps.spec.ts` builds this operation on this seed and
     * checks that every declared tag landed, so a generator change that
     * re-rolls this ground fails there rather than in a player's match — which
     * makes it loud, not cheap: every distance the two headers quote is a
     * distance on THIS roll.
     */
    mapSeed: 20_261_020,
    /*
     * **IT CHOOSES THE CORNERS.** `seatedSlots` draws a PAIR out of
     * `START_PAIRS` for a two-army match, and 5205 draws **[1, 3]** — the
     * fourth and last of the four layouts, and the only one this chapter has
     * not used (`soviets.05.short-allocation` [0, 1],
     * `.06.demolition-order` [2, 3], `.07.right-of-entry` [0, 2]). The layout
     * is handed spots (404, 132) and (108, 132); the CONSTRUCTION YARDS land at
     * (402, 134) and (114, 134), 288.00 m apart, and every distance in this
     * file and in the layout is measured against those yards rather than
     * against the spots. **Change this and they are all different distances.**
     */
    simSeed: 5_205,
    armies: 2,
    /*
     * `base`. The escort has to be defended by something the player already
     * owns — the five Anvils of the opening are what clears the picket in the
     * first four minutes — and the taps want engineers off a barracks that is
     * already standing. An `mcv` opening would spend the first three minutes of
     * a twenty-minute file unfolding, with the first lift already on the ramp.
     */
    opening: 'base',
    /*
     * 5000, AND IT BINDS BOTH SEATS — `Shell.startMatch` writes
     * `startingCredits` into every slot, so this is a statement about the
     * operation's economy rather than a handicap.
     *
     * A thousand of it is the two engineers that take the taps without spending
     * the shift, which is the fork this bank exists to pose. It also holds the
     * establishment to the pace CLAUDE.md names as the single cause of "the AI
     * has a ready base" — a 10 000 opening built a seven-building base with
     * eleven troops by t+90 s having mined nothing.
     */
    credits: 5_000,
  },
  layout: 'soviets-carriage-forward',

  // NEITHER SHIPPED RULE MAY END THIS. See the header: annihilation would
  // declare a win with the shift still on the ramp, and `assetLossDefeat` would
  // end this operation's best last act at 2 Hz.
  outcome: { annihilationWin: false, assetLossDefeat: false, ignoreSeats: [] },

  /*
   * EMPTY IS A RESTRICTION, NOT AN ABSENCE, and here it is the escalation
   * itself: `unit.specialist` withheld from BOTH lists takes the Refractor Tank
   * out of Continental's sidebar as well as the Sledge Tank out of the
   * player's, and `t.moveD` lands two Refractor Tanks anyway because a scripted
   * spawn never passes through `isBuildable`. The measured withholding and the
   * four-metre range gap are in the header.
   */
  roster: { player: [], ai: [] },

  objectives: [
    {
      id: 'carriage',
      kind: 'primary',
      title: "Put nine of the yards' twelve on the seam, plant standing",
    },
    {
      id: 'taps',
      kind: 'secondary',
      title: 'Open both seam taps',
      credits: 500,
    },
    {
      id: 'whole',
      kind: 'secondary',
      hidden: true,
      title: 'Deliver the shift entire',
      credits: 400,
    },
  ],

  triggers: [
    /* -- the orders -------------------------------------------------------
     * Three beats at four, eighteen and thirty-two seconds rather than six
     * lines at once: the shell renders dialogue as toasts, and
     * `Shell.campaignBeatSeq` sequences two lines from one speaker but cannot
     * make a stack of six readable.
     *
     * THE CAMERA MOVE IS THE REVEAL AND IT IS THE ONLY ONE IN THIS FILE.
     * `cameraMove` takes the camera off whatever the player was doing, so
     * `types.ts` reserves it for an arrival, a loss or a reveal and forbids it
     * as punctuation. This is the reveal: the plant, standing on the seam with
     * nobody on it, shown once, before the player has begun anything.
     */
    {
      id: 't.brief',
      when: { on: 'elapsed', ticks: seconds(4) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Rakhalt',
          text: 'The record went up to Continental with our name on every page of it, and they '
            + 'did not dispute a line. They read it, they accepted it, and they put the sector '
            + 'on the schedule.',
        },
        { do: 'revealArea', player: 0, area: WORKING_AREA },
        { do: 'cameraMove', at: PLANT },
      ],
    },
    {
      id: 't.orders',
      when: { on: 'elapsed', ticks: seconds(18) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'A line on a schedule has to be seen being worked. There is a refinery out on '
            + 'the seam that was carted there last quarter and never staffed, and there are '
            + 'twelve men on the ramp. Walk them out to it and keep it standing.',
        },
        { do: 'revealArea', player: 0, area: PICKET_AREA },
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'Their establishment has already put two posts either side of our haul road and '
            + 'entered them as a road inspection. There is a way round and it is a long one. '
            + 'Take them off before you walk anybody down it — a man in front of one of those '
            + 'lasts about as long as it takes to say so.',
        },
      ],
    },
    {
      id: 't.taps',
      when: { on: 'elapsed', ticks: seconds(32) },
      then: [
        { do: 'revealArea', player: 0, area: TAP_EAST_AREA },
        { do: 'revealArea', player: 0, area: TAP_WEST_AREA },
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'The two taps the March sank in the spring are still standing either side of it '
            + 'and still belong to nobody. A man walks into one and it is ours, and it pays '
            + 'while we hold it — which is how the seam is going to pay for its own guard.',
        },
      ],
    },

    /* -- the first lift ------------------------------------------------------
     * Forty-five seconds, at a muster 73.24 m behind the yard, and NOT ordered
     * anywhere. `orderTagged` would fight the player's own orders for a column
     * whose whole content is the decision of when to move it, and the picket is
     * still standing at forty-five seconds. Every lift lands and waits.
     *
     * `reinforcements` IS THE SCRIPTED EVA LINE `types.ts` NAMES AS EARNING ITS
     * PLACE, because no announcer event corresponds to a scripted wave. It is
     * fired ONCE, here, rather than on all three: the second and third lifts
     * are the same event at a place the player now knows, the dialogue names
     * them, and `EVA_LINES.reinforcements` carries a 10 s cooldown that would
     * not have stopped three copies nine minutes apart. One is punctuation;
     * three is a habit.
     */
    {
      id: 't.liftA',
      when: { on: 'elapsed', ticks: LIFT_A },
      then: [
        { do: 'eva', line: 'reinforcements' },
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'First lift is on the ramp behind the yard. Four men. They will stand there all '
            + 'day if you let them — nobody is walking them out but you.',
        },
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'And the shift is the twelve the yards send, not twelve bodies. Raise your own '
            + 'engineers off the barracks by all means, for the taps or for a repair — the '
            + 'branch will not count one of them towards the shift.',
        },
        {
          do: 'spawnUnits', player: 0, key: 'engineer', count: 4, at: MUSTER, spread: 18, tag: 'shift',
        },
      ],
    },

    /* -- both timetables, side by side ---------------------------------------
     * Minute three, before the first movement lands. `hidden` objectives are
     * filtered out of the briefing (`briefingObjectives`), so the bonus really
     * is a surprise — and it arrives at the moment it becomes a plan rather
     * than a line the player read before the match started.
     *
     * THE REVEAL IS NOT A NO-OP, WHICH IS WHY THE OPENING DISC IS r=38 AND THIS
     * ONE IS THE ROADS. `WORKING_AREA` stops 10.66 m short of either tap and
     * `revealArea` is `Vision.exploreCircle`, which is PERMANENT, so a disc
     * that had already covered their forming-up ground would make this beat a
     * reveal of ground the player has been looking at since four seconds.
     * `soviets-short-allocation` records the same trap for its third wave.
     */
    {
      id: 't.disclose',
      when: { on: 'elapsed', ticks: DISCLOSE },
      then: [
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'Signals has their movement order. It is not a plan, it is a timetable: four, '
            + 'eight, twelve and sixteen minutes. Filed before anybody went and looked at the '
            + 'ground, and it will be kept whatever is standing on it.',
        },
        { do: 'revealArea', player: 0, area: { x: ROAD_A.x, z: ROAD_A.z, r: 42 } },
        { do: 'revealArea', player: 0, area: { x: ROAD_B.x, z: ROAD_B.z, r: 42 } },
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'Ours reads six and seventeen for the other two lifts. Put that next to theirs '
            + 'and you can see the one that matters — the last lift walks the road with their '
            + 'last movement already standing on the seam. Bring that one in whole and the '
            + 'branch has nothing to write up.',
        },
        { do: 'setObjective', id: 'whole' },
      ],
    },

    /* -- the road inspection --------------------------------------------------
     * Minute four, at the picket, off the LANE road so the column does not pass
     * the working on its way. Six hulls, and the smallest of the four: the
     * order Continental is executing is about the ROAD, and the establishment
     * executes what the order says.
     *
     * `PICKET` (304, 208) is 122.80 m from the player's yard and 203.90 m from
     * Continental's, and its own cell is passable to Foot — so this is an order
     * at real ground on the corridor the escort walks, which is what makes it a
     * road inspection rather than an early strike near the player's base. The
     * distances used to read 125.54 / 270.17 against posts that covered nothing;
     * see the layout header for the measurement that moved them.
     *
     * LITERAL ALLIED KEYS. `EffectSink.spawnUnits` resolves through
     * `ProductionCatalog.byKey` and remaps nothing, unlike the layout's
     * `ScenarioBuilder.spawnUnit`; `validateCampaign` checks each key against
     * the army of the seat it lands on, so a Soviet key here is a build error.
     */
    {
      id: 't.moveA',
      when: { on: 'elapsed', ticks: minutes(4) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Averill, Continental',
          text: 'First movement, on time. We are not disputing the sector, we are establishing '
            + 'whether it is being worked. Re-post the road and note the condition of it.',
        },
        { do: 'spawnUnits', player: 1, key: 'gi', count: 4, at: ROAD_B, spread: 20, tag: 'moveA' },
        { do: 'spawnUnits', player: 1, key: 'grizzly', count: 2, at: ROAD_B, spread: 14, tag: 'moveA' },
        { do: 'orderTagged', tag: 'moveA', order: 'attackMove', at: PICKET },
      ],
    },

    /* -- the road is clear ----------------------------------------------------
     * `ownerCount ... max: 0`, NOT `entityDead`, AND THE DIFFERENCE IS CAPTURE.
     * A pillbox the player walks an engineer into is still ALIVE and is no
     * longer on the road in any sense that matters, so `entityDead` would leave
     * this beat unspoken for a player who did the more interesting thing.
     * `soviets.06.demolition-order` records migrating two of its own triggers
     * for exactly this and the fix is copied from there.
     *
     * SETTLE, because a count of zero reads TRUE before the layout has stamped
     * the tag — this would otherwise congratulate the player on clearing a road
     * nobody was standing on, on tick one.
     */
    {
      id: 't.roadClear',
      when: {
        on: 'all',
        of: [
          SETTLE,
          { on: 'ownerCount', player: 1, role: 'building', tag: 'picket', max: 0 },
        ],
      },
      then: [
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'Road inspection is off the road. Walk them now — their next movement is on the '
            + 'clock and it will not wait for us to be ready.',
        },
      ],
    },

    /* -- the second lift ------------------------------------------------------ */
    {
      id: 't.liftB',
      when: { on: 'elapsed', ticks: LIFT_B },
      then: [
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'Second lift, four more. That is eight of the twelve, and nine have to be '
            + 'standing on the seam at the same time — so the last four are not spare.',
        },
        {
          do: 'spawnUnits', player: 0, key: 'engineer', count: 4, at: MUSTER, spread: 18, tag: 'shift',
        },
      ],
    },

    /* -- the establishment looks at the seam ----------------------------------
     * Minute eight, off the seam road, ordered at `WORKING` rather than at the
     * plant's own cell. See the layout's collateral section: `applySplash`
     * clamps `surface` to zero inside a victim's `hitRadius`, so an order at the
     * plant would make its wall the designed end state of the wave and every
     * splash shell fired there would land at `falloff` 1.0. The order point is
     * 28.64 m off it and 48.66 m off either tap.
     *
     * Eight hulls is 86.14 dps against `ArmorClass.Concrete` — an undefended
     * 1200 hp plant in 13.9 seconds — which is why this is the second movement
     * and not the first.
     */
    {
      id: 't.moveB',
      when: { on: 'elapsed', ticks: minutes(8) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Averill, Continental',
          text: 'Second movement. There is plant on the seam and no labour anywhere near it, '
            + 'which is a sector claiming an output it is not producing. Remove the plant and '
            + 'the claim goes with it.',
        },
        { do: 'spawnUnits', player: 1, key: 'gi', count: 5, at: ROAD_A, spread: 20, tag: 'moveB' },
        { do: 'spawnUnits', player: 1, key: 'grizzly', count: 3, at: ROAD_A, spread: 14, tag: 'moveB' },
        { do: 'orderTagged', tag: 'moveB', order: 'attackMove', at: WORKING },
      ],
    },

    /* -- and then at the ground behind it -------------------------------------
     * Minute twelve, off the LANE road at `PUSH` — the contested patch
     * `addStartOre` lays on the midpoint of the two openings, 148.00 m from each
     * of those and 146.01 / 142.01 m from the two yards, which is the body a
     * player who has sent everything forward is still living on. A second
     * bearing rather than a second helping of the first:
     * the two roads are 86.83 m apart on opposite sides of their gate.
     */
    {
      id: 't.moveC',
      when: { on: 'elapsed', ticks: minutes(12) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Averill, Continental',
          text: 'Third movement, onto their own haulage. A sector defending a seam is not '
            + 'defending anything else, and the schedule does not care which end we take.',
        },
        { do: 'spawnUnits', player: 1, key: 'gi', count: 4, at: ROAD_B, spread: 20, tag: 'moveC' },
        { do: 'spawnUnits', player: 1, key: 'grizzly', count: 3, at: ROAD_B, spread: 14, tag: 'moveC' },
        { do: 'orderTagged', tag: 'moveC', order: 'attackMove', at: PUSH },
      ],
    },

    /* -- the last lift --------------------------------------------------------
     * Minute seventeen, a minute AFTER their last movement reached the seam, and
     * tagged `shift` like the other two — see the header: `EffectSink.spawnUnits` takes
     * ONE tag, so the third lift cannot also carry a tag of its own and the
     * hidden secondary counts the whole shift instead.
     *
     * `validateCampaign` removes a tag a `spawnUnits` PRODUCES from the set the
     * layout must stamp, which is why `shift` needs no entity on the ground.
     */
    {
      id: 't.liftC',
      when: { on: 'elapsed', ticks: LIFT_C },
      then: [
        {
          do: 'dialogue',
          speaker: 'Rakhalt',
          text: 'Last lift, and their fourth is already out on the seam waiting for it. There is '
            + 'no second ramp — whatever happens to these four happens to the return.',
        },
        {
          do: 'spawnUnits', player: 0, key: 'engineer', count: 4, at: MUSTER, spread: 18, tag: 'shift',
        },
      ],
    },

    /* -- the last movement ----------------------------------------------------
     * Minute sixteen, nine hulls, and the two Refractor Tanks are the whole
     * escalation in one line of data: `unit.specialist` is refused to BOTH
     * sidebars by this operation's roster and a scripted spawn does not pass
     * through `isBuildable`. `prismBeam` is range 30 against `heavyCannon`'s 26,
     * and 92 `Prism` through `ARMOR_MATRIX[Prism][Infantry]` 1.10 and
     * `globalMul` 0.80 is **80.96 of an engineer's 90 hit points, per beam**.
     */
    {
      id: 't.moveD',
      when: { on: 'elapsed', ticks: minutes(16) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Averill, Continental',
          text: 'Fourth and last movement. Refractors forward. If the sector cannot show a '
            + 'working at the end of the shift it will be worked by an establishment that can, '
            + 'and I would rather not have to write that up twice.',
        },
        { do: 'spawnUnits', player: 1, key: 'gi', count: 4, at: ROAD_A, spread: 20, tag: 'moveD' },
        { do: 'spawnUnits', player: 1, key: 'grizzly', count: 3, at: ROAD_A, spread: 14, tag: 'moveD' },
        { do: 'spawnUnits', player: 1, key: 'prismTank', count: 2, at: ROAD_A, spread: 26, tag: 'moveD' },
        { do: 'orderTagged', tag: 'moveD', order: 'attackMove', at: WORKING },
      ],
    },

    /* -- the taps -------------------------------------------------------------
     * `ownerCount(0, 'building', 'taps', min: 2)` — both derricks on our books
     * at the same moment. It counts UP from zero, so it needs no settle, and it
     * is owner-scoped, so a squad that garrisons a tap and then walks out
     * un-completes nothing: the row is already `complete` and
     * `Director.runDirector` never re-fires a non-`repeat` trigger.
     */
    {
      id: 't.tapsOpen',
      when: { on: 'ownerCount', player: 0, role: 'building', tag: 'taps', min: 2 },
      then: [
        { do: 'completeObjective', id: 'taps' },
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'Both taps on our books. That is the seam paying for the men who are walking out '
            + 'to it, which is the first time this quarter anything has paid for itself.',
        },
      ],
    },
    /*
     * FAILS WHEN IT BECOMES UNREACHABLE, OR AT THE WIN. A levelled tap can never
     * be opened — `c.tag` runs once, inside the layout, so a structure is not
     * coming back — and an objective that stays lit after it is impossible is a
     * lie the player plays against. The `WORKING_STAFFED` arm is the other half:
     * the row has to resolve one way or the other before `runDirector` returns
     * early on the outcome, which is why this sits ABOVE `t.win`.
     */
    {
      id: 't.tapsMissed',
      when: {
        on: 'all',
        of: [
          SETTLE,
          { on: 'not', of: { on: 'objectiveComplete', id: 'taps' } },
          /*
           * THE NEGATION OF `t.tapsOpen`, AND IT IS WHAT CLOSES A ONE-TICK
           * RACE. `Director.holds` answers `objectiveComplete` from the state
           * the tick BEGAN with, and `campaign-install.ts` applies the whole
           * effect list afterwards — so a player who opens the second tap on
           * the exact tick the ninth man steps into the disc would fire
           * `t.tapsOpen` AND this trigger, and the sink would complete the row
           * and then fail it. Stated as a live count instead, the two are
           * mutually exclusive by construction and the file order between them
           * decides nothing. The `objectiveComplete` guard above stays for the
           * other case: a row already completed and then broken by a movement
           * must not be failed retroactively.
           */
          { on: 'not', of: { on: 'ownerCount', player: 0, role: 'building', tag: 'taps', min: 2 } },
          {
            on: 'any',
            of: [
              { on: 'entityDead', tag: 'tapEast' },
              { on: 'entityDead', tag: 'tapWest' },
              WORKING_STAFFED,
            ],
          },
        ],
      },
      then: [
        { do: 'failObjective', id: 'taps' },
        {
          do: 'dialogue',
          speaker: 'Rakhalt',
          text: 'The taps stay off the books, then. The seam will still make its figure and we '
            + 'will still be paying for the guard out of the yards.',
        },
      ],
    },

    /* -- a tap is under fire --------------------------------------------------
     * `entityHpBelow` reads the WEAKEST live entity carrying the tag, so this
     * fires the first time either derrick is meaningfully hurt. NO SETTLE:
     * `WorldQuery.weakestHpFrac` returns **-1** when nothing alive carries the
     * tag and `Director.holds` answers `f >= 0 && f < frac`, so this is the one
     * entity condition that is already false on tick one.
     *
     * It can only happen after a capture. While a tap is Gaia's nothing shoots
     * it — `ScenarioBuilder.gaia` sets both directions of `allyMask` and
     * `Targeting.isValidTarget` refuses allies — so the beat is exactly the
     * consequence of the shown secondary and says so.
     */
    {
      id: 't.tapHit',
      when: {
        on: 'all',
        of: [
          { on: 'entityHpBelow', tag: 'taps', frac: 0.6 },
          /*
           * AND ONE OF THEM IS OURS, or the line is not true. Gaia is allied to
           * everybody and `Targeting.isValidTarget` refuses allies, so nothing
           * ACQUIRES a neutral derrick — but `Damage.applySplash` halves
           * friendly fire rather than waiving it, so a fight at a tap can hurt
           * one while it still belongs to nobody. This clause is what stops the
           * beat claiming a deed the player has not taken. It counts UP from
           * zero, so it needs no settle.
           */
          { on: 'ownerCount', player: 0, role: 'building', tag: 'taps', min: 1 },
        ],
      },
      then: [
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'One of the taps is taking fire. It was nobody\'s and nobody shot it; it is ours '
            + 'now, so it is a target. That is what the deed cost.',
        },
      ],
    },

    /* -- the close, telegraphed ----------------------------------------------- */
    {
      id: 't.closing',
      when: { on: 'elapsed', ticks: minutes(18.5) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'Ninety seconds. Anything not standing on that seam at the end of the shift is a '
            + 'sector that could not staff its own plant, and they will write that exactly once.',
        },
      ],
    },

    /* -- the hidden row resolves FIRST ----------------------------------------
     * ABOVE `t.win`, deliberately: `runDirector` returns early once an outcome
     * is set, so anything that resolves at the win has to resolve before the
     * operation ends or the medal does not count it. Same ordering rule
     * `soviets-deep-sector` states for `t.mastsDown`, `04-company-town` for
     * `t.five`, `06-demolition-order` for `t.infirmaryKept` and
     * `07-right-of-entry` for `t.clean`.
     *
     * The two arms are mutually exclusive by construction — one wants all twelve
     * of the shift alive and the other fewer — so no tick satisfies both and the
     * file order between them decides nothing.
     */
    {
      id: 't.whole',
      when: {
        on: 'all',
        of: [
          WORKING_STAFFED,
          { on: 'ownerCount', player: 0, role: 'unit', tag: 'shift', min: 12 },
        ],
      },
      then: [
        { do: 'completeObjective', id: 'whole' },
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'Twelve out and twelve standing. There is no casualty return to file, and '
            + 'therefore no incident for anybody to attach one to.',
        },
      ],
    },
    {
      id: 't.wholeMissed',
      when: {
        on: 'all',
        of: [
          WORKING_STAFFED,
          { on: 'not', of: { on: 'ownerCount', player: 0, role: 'unit', tag: 'shift', min: 12 } },
        ],
      },
      then: [
        { do: 'failObjective', id: 'whole' },
        {
          do: 'dialogue',
          speaker: 'Rakhalt',
          text: 'The shift is short. It is a working either way, and somebody at the branch gets '
            + 'to ask where the rest of them went.',
        },
      ],
    },

    /* -- the working stands ---------------------------------------------------
     * It cannot tie with any loss below: `t.plantLost` needs the plant gone and
     * this needs it standing, `t.thin` needs eight or fewer of the shift alive
     * and this needs nine inside one disc, and `t.close` is a later tick.
     */
    {
      id: 't.win',
      when: WORKING_STAFFED,
      then: [
        { do: 'completeObjective', id: 'carriage' },
        {
          do: 'dialogue',
          speaker: 'Rakhalt',
          text: 'Plant standing, shift on the ground, taps behind us. The seam is being worked '
            + 'in the open now and there is no version of the paperwork that quietly closes it.',
        },
        {
          do: 'dialogue',
          speaker: 'Rakhalt',
          text: 'And Continental has already written next quarter against it. The Ninth argued '
            + 'and lost four times; this office does not argue, it schedules — so whatever comes '
            + 'next is coming with the dates on it before it leaves.',
        },
        { do: 'endOperation', result: 'win' },
      ],
    },

    /* -- the plant goes -------------------------------------------------------
     * THE LOSS THIS OPERATION IS REALLY ABOUT, and it fires the moment the
     * primary becomes unreachable rather than at the deadline. A rebuilt
     * refinery carries no tag — `c.tag` runs once, inside the layout — so
     * nothing any player can do restores this, whatever the sidebar offers.
     *
     * `ownerCount ... max: 0` rather than `entityDead`, so a capture counts
     * exactly as a demolition does. See the header on why `captureProof` is NOT
     * declared: the brain cannot issue `Capture`, but the predicate is written
     * as though it could.
     */
    {
      id: 't.plantLost',
      when: {
        on: 'all',
        of: [
          SETTLE,
          { on: 'ownerCount', player: 0, role: 'building', tag: 'plant', max: 0 },
        ],
      },
      then: [
        { do: 'failObjective', id: 'carriage' },
        {
          do: 'dialogue',
          speaker: 'Rakhalt',
          text: 'The plant is off the seam. There is nothing out there for the shift to stand in '
            + 'now, and a sector with no plant is a sector somebody else gets given.',
        },
        { do: 'endOperation', result: 'loss', reason: 'carriage' },
      ],
    },

    /* -- the shift is too thin ------------------------------------------------
     * Twenty seconds after the last lift, eight or fewer of the twelve alive:
     * nine can never stand on the seam at once and the operation is over. The
     * delay is the tick-one guard — see `THIN` above, where the reason is that
     * this condition is TRUE from tick one and stays true through the first two
     * lifts.
     */
    {
      id: 't.thin',
      when: {
        on: 'all',
        of: [
          { on: 'elapsed', ticks: THIN },
          { on: 'ownerCount', player: 0, role: 'unit', tag: 'shift', max: 8 },
        ],
      },
      then: [
        { do: 'failObjective', id: 'carriage' },
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'We are four men short of a shift and there is no fourth lift. Whatever you have '
            + 'raised yourself is yours and not the yards\' — whatever is out there on the seam, '
            + 'it is not a working.',
        },
        { do: 'endOperation', result: 'loss', reason: 'carriage' },
      ],
    },

    /* -- the shift closes -----------------------------------------------------
     * The hard deadline, at `parSec` to the second, and BELOW `t.win` so a
     * ninth man who steps into the disc on the closing tick wins — which is
     * real rather than decorative, because `campaign-install.ts#end` early
     * returns on a second outcome and the FIRST `endOperation` in the effect
     * list is the one that lands. The ground beats the paperwork:
     * `soviets.03.deep-sector`, `.04.company-town` and `.07.right-of-entry` all
     * say that about their own deadlines. The negated win condition is the
     * second half of the same argument; see the comment on it below.
     *
     * There is deliberately NO early-out arm on it. `Viability.isBeaten` is
     * "nothing to build with and nothing to fight with", and an establishment
     * that has been razed is still not a working on the seam, so an authored
     * early-out would end the operation in a WIN with the plant unstaffed.
     */
    {
      id: 't.close',
      when: {
        on: 'all',
        of: [
          CLOSE,
          /*
           * AND THE SHIFT IS NOT ON THE SEAM. `campaign-install.ts#end` refuses
           * a second outcome, so file order already makes a win on the closing
           * tick beat this — but the `failObjective` beside the
           * `endOperation` is a SEPARATE effect and is applied anyway, which
           * would mark the primary failed on a match the player won. Negating
           * the win condition here makes the two triggers mutually exclusive
           * rather than merely ordered, which is the difference between a rule
           * and a convention.
           */
          { on: 'not', of: WORKING_STAFFED },
        ],
      },
      then: [
        { do: 'failObjective', id: 'carriage' },
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'Shift closed with the plant empty. The sector is on the schedule and it did not '
            + 'produce, and the office that wrote the line gets to decide what that means.',
        },
        { do: 'endOperation', result: 'loss', reason: 'carriage' },
      ],
    },

    /* -- the ordinary loss ----------------------------------------------------
     * `playerBeaten` is `Viability.isBeaten` — nothing to build with and
     * nothing to fight with — not "you have no buildings". A commander whose
     * yard is gone while twelve men are still on the haul road is not beaten,
     * and this operation would like that to be a position somebody can play
     * from.
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
        { do: 'failObjective', id: 'carriage' },
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'Nothing answering from the yards. They will post the sector to somebody else and '
            + 'note that the transfer was uncontested.',
        },
        { do: 'endOperation', result: 'loss', reason: 'carriage' },
      ],
    },
  ],
};

export default op;
