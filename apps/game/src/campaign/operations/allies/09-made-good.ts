/**
 * ============================================================================
 * A9 — MADE GOOD
 * ============================================================================
 * A7 put the amendment on the wire for one evening. A8 bought the year: the
 * arrears are on the counter, the standing amendment is entered over the Works'
 * own signature, and every siting office on the eastern arc opens its book to
 * the Allies' figure until somebody pays to change it back. The administrative
 * fight is won completely — the continent's schedule is now their number,
 * closed by their loop, off their series, with the misclosure printed
 * underneath where anybody can check the working.
 *
 * **AND NOT ONE PEG HAS MOVED.** Every refinery on the continent still stands
 * exactly where the old schedule sited it, because a schedule is a claim about
 * where the March WILL BE and a refinery is four thousand tonnes of concrete
 * that is already somewhere. Being right on paper turns out to be the cheapest
 * part of being right — it cost the Ninth an argument and the Works a satchel,
 * and it costs the continent nothing at all until somebody is willing to pay
 * the first bill.
 *
 * *Made good* is what a traverse leg is when the distance actually achieved is
 * entered against the distance intended, and it is what a defect is when
 * somebody has paid to put it right. This is the operation where the chapter
 * finds out those are the same word.
 *
 * ============================================================================
 * WHO ACTUALLY READ IT FIRST, AND WHY IT WAS NEVER GOING TO BE A REFINERY
 * ============================================================================
 * A siting office reads the circular, files it, and does nothing, because the
 * plant it would have to move is running. A BREAKING YARD reads the circular
 * the way a bank reads an interest rate. **The correction went down the trunk
 * at six like everything else, and Cregg's house was on the distribution list**
 * — the chain *"sends what is lodged with it, by whoever walks in"*, and A7's
 * own closing line says the Ninth can walk in on Monday. So can a salvage
 * broker, and so can everybody the broker sells to.
 *
 * Eleven days after the amendment was pasted in, the Reclamation had a sorting
 * floor, a breaking yard, two posts and a bore head on Bench Nine — the shoal
 * the corrected series puts the next surfacing under, which appears on no
 * siting map anywhere because the OLD schedule had it as open water and nothing
 * has ever been sited off open water. They are not disputing the number. They
 * agree with it more energetically than anyone. They are charging for it.
 *
 * That is the chapter's spine paid off on the ground:
 *
 *     A1-A6   a number is only worth what the instrument behind it is worth
 *     A7      and only worth the counter it was lodged at
 *     A9      and worth nothing at all until somebody has stood on it
 *
 * ============================================================================
 * WHY `primaryType: 'landing'`
 * ============================================================================
 * **IT IS THE ONE TYPE NO OPERATION IN THIS GAME HAS EVER SPENT.** Twenty-seven
 * shipped operations across four chapters have spent assault, infiltrate, race,
 * defend, capture-hold, economy, escort, fixed-force, superweapon and
 * assassination. `landing` is the eleventh member of `PrimaryType` and it has
 * been sitting unused since the union was written, for a reason that is
 * geometric rather than editorial: **there is exactly one map in the game with
 * land on the far side of water, and it is `MAP_PRESETS.atoll`.**
 * `MAP_SEAS.coast` and `.tropical` are HALF-PLANES — one land region, one water
 * region, by construction — so an objective across their water is an objective
 * in the sea. A landing needs an archipelago and the archipelago has never been
 * used by an operation. The chapter's own premise is the only one in the table
 * that requires ground the published schedule did not know about, and the only
 * such ground the engine has is an unseated island. The type, the preset and
 * the fiction are one requirement wearing three names.
 *
 * **AND THE SOVIET NINE IS WHY IT IS NOT AN OUTPUT PROBLEM.**
 * `soviets.09.nil-return` closes Hold the Seam with `economy`: a Continental
 * office has the sector down as nil and only a delivered quarter answers it.
 * That is the right answer to *"the record is ours and the ground has not
 * moved"* when the thing in dispute is a FIGURE. It is the wrong answer here,
 * because the Allies' figure is not in dispute — everybody agrees with it,
 * including the enemy, out loud, on the open net — and producing more of a
 * number nobody disbelieves proves nothing at all. What is in dispute is
 * whether anybody will ever act on it, and the only thing that answers that is
 * a party standing on the ground the number points at.
 *
 * ============================================================================
 * THE ONE MECHANIC THIS OPERATION OWNS: THE LIFT ONLY COMES IN IF THE BEACH IS
 * HELD
 * ============================================================================
 * Four scripted lifts, at five, nine, thirteen and seventeen minutes, and every
 * one of them is
 *
 *     all: [ elapsed(T), unitsInArea(player 0, SHINGLE_AREA, min: 1) ]
 *
 * — the clock AND at least one of the player's own units standing on the strand
 * at (314, 390). **That conjunction is the whole difference between a landing
 * and an assault with a boat in it.** A reinforcement wave keyed to a clock
 * alone is a schedule the world keeps for you; this one is a schedule the world
 * keeps IF THERE IS SOMEBODY THERE TO TAKE THE ROPE. Pushed off the strand, the
 * player does not lose the operation and does not lose an objective — they lose
 * their supply, silently, until they are back on it.
 *
 * **AND THE DISC IS DRY GROUND, WHICH IT WAS NOT WHEN THIS SHIPPED.**
 * `SHINGLE_AREA` was r = 26 about (314, 390), derived on the argument that
 * reaching *"8 m PAST the waterline"* covered the sand a landing lands on. It
 * covered 8 m of countable SEA: `runtime.ts#unitsInArea`'s untagged branch
 * filters owner, `IS_UNIT` and `PendingDestroy` and tests neither the ground
 * nor `EntityFlag.Garrisoned`, while `TransportService.carry` parks every
 * passenger's body on its hull. Measured in the engine — two moored craft
 * sailed to the nearest naval cells and four `gi` boarded through a real
 * `OrderKind.Enter` — the old disc read **6** with **0 of the 6 standing on
 * dry land**, so the primary and all four lift gates completed with the ramp
 * still up. It is **r = 17** now, which is the largest integer radius no
 * naval-passable cell overlaps; the derivation, the sweep and the real
 * `Transport.place` set-down points are in the layout header. The same world
 * reads 0 at 17.
 *
 * Two consequences that make it content rather than a rule:
 *
 *   - **THE FIRST CROSSING MUST BE THE PLAYER'S OWN, AND THAT IS TRUE OF THE
 *     ROUTE RATHER THAN OF THE BOATS.** No lift can fire until somebody is
 *     standing on dry ground on the far shore, so the operation cannot be
 *     played from the home island at all and the first thing it asks for is a
 *     crossing. What it does NOT ask for is a boat: `frogman` is `amphibious`,
 *     carries no `unlockedBy`, needs only the barracks seat 0 opens with, and
 *     walks the channel for 350 credits a man. The layout header measures that
 *     leg and prices it against the boats — **and the 272.1 m / ninety-four
 *     seconds it used to quote here is stale**: the player's barracks moved
 *     16.5 m when the procedural bases were rebuilt on the placement grid, so
 *     the start cell that route was taken from is not the one a produced man
 *     egresses onto any more. See the layout header; this file used to claim
 *     *"nothing puts anybody ashore except the two landing craft"*, which is
 *     false and was false in every shipped build.
 *   - **ONE MAN HOLDS THE SUPPLY LINE AND SIX WIN THE OBJECTIVE.** `min: 1` on
 *     the lift against `min: 6` on the primary is deliberate: the cheapest way
 *     to keep the lift coming is a rifleman nobody is using, which is exactly
 *     the decision a beachhead is about — how much of the party stays on the
 *     sand and how much goes up the island.
 *
 * **WHAT WAS CONSIDERED AND CUT HERE: A LIFT THAT MISSES IS GONE.** The first
 * shape had each lift as a NON-repeating trigger, so being off the beach at
 * 9:00 forfeited that wave permanently. It is a `repeat: false` trigger whose
 * condition is a conjunction, which means it fires on the first tick BOTH halves
 * hold and then retires — so a player who retakes the strand at 9:40 gets the
 * nine-minute lift late rather than not at all. That is the kinder reading and
 * it is also the truer one: a ship that cannot put in stands off and waits.
 *
 * ============================================================================
 * WHAT THE CROSSING COSTS, IN MEASURED METRES AND SECONDS
 * ============================================================================
 * Every distance below is on the built world at `mapSeed` 20 261 005; the
 * layout header carries the instrument and the six-roll survey behind that seed.
 *
 *     the water at z = 390        x 222..294        74 m — the narrowest on the map
 *     MOOR (206, 386) -> SHINGLE  108.1 m           16.4 s at a landingCraft's 6.6 m/s
 *     SHINGLE -> FLOOR             58.0 m
 *     SHINGLE -> YARD              78.1 m
 *     SHINGLE -> HEAD              63.8 m
 *     CROSS -> YARD                82.1 m           Cregg's own reinforcement leg
 *
 * The FLOOR and YARD rows are to the structures AS THEY STAND. Both are
 * non-square footprints raised at yawDeg 270 and `spawnBuilding` snaps on the
 * FACED extent, so both sit 2.83 m off their literals: the sorting floor at
 * (372, 390) and the breaking yard at (392, 394). SHINGLE -> HEAD is the
 * control — a 2x2 that cannot move — and it reproduces exactly.
 *
 * **THE SHORTEST WATER IS STILL WATER AND THERE IS NO FORD.**
 * `ARCHIPELAGO_SEA.shoals` lays a channel bar at (256, 390) at `depth` 1.1,
 * squarely across the shortest crossing — and the water at z = 390 scans
 * UNBROKEN from x = 222 to x = 294, so the shallowest cell of the shortest
 * crossing is wet and impassable to every GROUND locomotor in the game.
 * Falsified rather than asserted: an 8-connected Dijkstra over the real
 * `FlowFieldCache.costGridFor(MoveClass.Foot)` on the built world returns
 * UNREACHABLE from the player's island to the strand, on a grid that blocks
 * 1 443 of 16 384 cells to Hover and 8 599 to Naval and is therefore refusing
 * things rather than answering yes to everything.
 *
 * **A SWIMMER IS NOT A GROUND LOCOMOTOR AND THIS BLOCK USED TO FORGET IT.** It
 * read *"everything that reaches Bench Nine under the player's flag was either
 * carried there in a landing craft or set down by a lift"*, and a barracks the
 * player already owns sells the bypass. `frogman` — 350 credits, `amphibious`,
 * no `unlockedBy`, `prereqs: ['barracks']` — resolves to `MoveClass.Hover`, and
 * the same Dijkstra over `costGridFor(MoveClass.Hover)` walks it from the
 * barracks' own egress ground to the strand. **The 272.1 m and ninety-four
 * seconds this sentence used to carry are stale and are not replaced here** —
 * the barracks moved 16.5 m and the published start cell is no longer the
 * nearest open one; the layout header says what has to be re-taken and why. The
 * qualitative point is untouched, and it is the one that matters: the route
 * EXISTS, and six swimmers is 2 100 credits of the 6 000 bank and completes
 * the `ashore` primary with no boat at all. Cregg owns the twin — `rclDredger`,
 * 300 credits off the `rclRookery` in his opening base — so the route is
 * symmetric, which is the same fairness argument the north strait makes.
 *
 * It is left OPEN on purpose. The swimmers carry no unlock tag anywhere in the
 * game and the roster is an allow-list over TAGGED defs, so withholding them
 * is not something this operation can express; and CLAUDE.md's standing rule is
 * that content required to reach the enemy is never progression-gated. What the
 * operation owes the player is the PRICE, not the denial: ninety-four seconds
 * on open water, one man at a time, with a rifle that cannot answer a
 * `postCoil`, against eight slots that cross in sixteen seconds and can carry a
 * Warden. Nothing in the layout creates a causeway and nothing in the trigger
 * table spawns a hull on the far side for the player.
 *
 * **THE ROUND TRIP IS THE REAL BUDGET, AND IT IS NOT MEASURED HERE.** 16.4 s of
 * open water each way is the floor; loading, `Transport.place`'s widening ring
 * search for a cell the passenger can stand on, and the walk from the strand to
 * the crew are on top of it, and no harness in this repo can put a number on a
 * fight — `campaign-maps.spec.ts` builds the ground and does not fight on it.
 * `allies.03.ground-truth` and `allies.07.fair-copy` both say exactly this about
 * their own clocks and it is the honest thing to say.
 *
 * ============================================================================
 * THE CARGO ARITHMETIC, WHICH IS THE OPERATION'S SCARCITY
 * ============================================================================
 * `SLOT_COST_BY_KIND` in `src/sim/Transport.ts` charges **one slot for
 * infantry and two for a vehicle**, and `landingCraft` is the four-slot tier
 * (`FACTION_KEY_MAP.landingCraft`, `NU.lighter`). So one craft is
 *
 *     four riflemen, or two Wardens, or a Warden and two riflemen,
 *     or three riflemen and nothing else useful
 *
 * and the layout moors TWO. **Eight slots is the entire first wave**, and the
 * primary wants SIX UNITS on the strand, so the arithmetic decides the opening
 * before a shot is fired:
 *
 *     six riflemen                    6 slots   one trip, two slots spare
 *     four riflemen and two Wardens   8 slots   one trip, exactly full
 *     three riflemen and three Wardens 9 slots  TWO TRIPS
 *
 * — and the engineer who is the only route to the secondary is a seventh unit
 * and a ninth slot however it is cut. Seat 0 opens holding ONE, which
 * `buildBaseFor` spawns, so the player already owns him and the question is
 * only whether he goes in the first boat or waits for the second.
 *
 * A third craft is **700 credits and ten seconds** off the landing yard the
 * layout stands at `MOOR`; the eight-slot `transport` is **1 200 and fifteen**.
 * Both are ordinary queue items and the operation neither grants nor withholds
 * them. **The navy is
 * not progression-gated anywhere in this game and that is deliberate** — the
 * `struct.naval`, `unit.naval` and `unit.naval.capital` tags were DELETED rather
 * than left unreferenced, precisely so a partially progressed profile is not
 * handed a map whose content it cannot reach. A fresh account can queue every
 * hull named in this block.
 *
 * ============================================================================
 * WHY THE ENGINEER IS THE EXPENSIVE PASSENGER
 * ============================================================================
 * The bore head is a `civOreMine` **on seat 1**, and `CaptureService.isCapturable`
 * answers yes to an engineer and no to every hull in the game — no vehicle in
 * any army carries `canCapture`, which `pact.01.shallow-road` establishes about
 * the same def. So the secondary has exactly one route, it costs a slot on a
 * four-slot boat, and the man it costs is a 90-hp non-combatant walked
 * sixty-four metres up a beach that has a factory behind it.
 *
 * **IT IS ONE ENGINEER AND NOT FOUR, AND THE DIFFERENCE IS WHOSE SEAT IT IS
 * ON.** `Capture.resolve` forks on health only for a structure whose owner is
 * a real player: above `CAPTURE.captureHpFrac` 0.50 the engineer is spent
 * knocking `maxHp * CAPTURE.softenFrac` 0.25 off through
 * `ARMOR_MATRIX[HighExplosive][Concrete]` 1.00 **and `COMBAT_DAMAGE.globalMul`
 * 0.80** = 0.20 of max, so 700 -> 560 -> 420 -> 280 and the FOURTH man
 * captures. Quoting `softenFrac` without `globalMul` understates that by one
 * engineer and two headers in this repo shipped that way.
 *
 * **SO THE HEAD COSTS FOUR SLOTS OF A FOUR-SLOT BOAT, OR IT COSTS 280 POINTS OF
 * SHELL AND THEN ONE.** A Warden's `lightCannon` is 55 AP on a 1.5 s cooldown =
 * 36.67 raw, and AP against Concrete is 0.55, so through `globalMul` 0.80 it
 * delivers **16.13 dps**; two Wardens take a 700-hp head from full to 280 in
 * **13.0 seconds** and then one engineer turns it. Shoot 280 further and there
 * is nothing to capture and the secondary is failed rather than missed —
 * `t.headBroken` says so on the tick it happens rather than at the debrief.
 *
 * **AND CREGG MENDS IT.** `AiBrain.repairBase` walks every building the seat
 * owns with no proximity filter and takes the worst STRICTLY below
 * `AI_REPAIR.startFraction` 0.75. 560/700 is 0.800 and is not a candidate;
 * 420/700 is 0.600 and is. At `REPAIR_RATE` 30 hp/s and `REPAIR_COST_PER_HP`
 * 0.25 a head left at 280 is back to full in **14.0 seconds for 105 credits**.
 * A lone engineer sent at it is therefore worse than nothing, exactly as
 * `allies.05.forced-closure`, `allies.07.fair-copy` and
 * `reclamation.02.written-off` all record about their own targets. Deliver them
 * together or shoot it down first.
 *
 * `CIVILIAN_MINE_INCOME` is 5 credits a second, so the head pays **300 a
 * minute** to whoever holds it, and taken at minute ten of twenty-two it is
 * worth 3 600. That is the operation's own sentence in an income line: the
 * Reclamation is not wrong, they are simply already being paid, and the only
 * way to stop paying them is to go and stand there.
 *
 * ============================================================================
 * WHAT ENDS THE MATCH, IN BOTH DIRECTIONS
 * ============================================================================
 * Both shipped outcome rules are off, so every route is authored:
 *
 *     t.win      both primaries complete                         WIN
 *     t.close    22:00 AND not both standing                     LOSS  (no id)
 *     t.beaten   settle AND `playerBeaten(0)` AND not both       LOSS  (no id)
 *
 * `annihilationWin` is off because levelling Cregg's island does not put a
 * party on the bench, and `Shell.pollOutcome` would declare victory the tick
 * his last asset died with the objective untouched. `assetLossDefeat` is off
 * because the authored `t.beaten` is the same question asked better:
 * `Shell.countLivingAssets` fires at zero of Building, Vehicle AND Infantry,
 * while `Viability.isBeaten` is *"nothing to build with and nothing to fight
 * with"* and is the honest end of a base-opening operation.
 *
 * **AND `playerBeaten` IS THE RIGHT READ HERE WHERE IT IS THE WRONG ONE IN A7,
 * WHICH IS WORTH SAYING BECAUSE THE TWO FILES DISAGREE ON PURPOSE.**
 * `Viability.surveyViability` §HELD books a `Garrisoned` occupant into
 * `heldUnits` rather than `contestingUnits`, so under `opening: 'force'`, where
 * `canRebuild` is false from tick one, `isBeaten` collapses to "no units
 * OUTSIDE a building" — which is why A7 spells its loss as
 * `ownerCount(role 'unit', max: 0)` instead. This operation opens with a
 * Construction Yard, so `canRebuild` is TRUE for as long as the player holds
 * one and the collapse cannot happen. There are also no garrisonable
 * strongpoints anywhere in this layout.
 *
 * **NEITHER LOSS CARRIES A `reason`, AND THAT IS THE FIX RATHER THAN AN
 * OMISSION.** This operation has TWO primaries and cannot know statically which
 * one is outstanding. `EndScreen.campaignLine` resolves `reason` BY ID first
 * and only falls back to "the first failed primary" when it matches nothing, so
 * a fixed id is wrong in half the branches by construction — A7 shipped
 * *"Lodge the fair copy at the arc head — not achieved"* directly above a green
 * tick on that row and had to be split. The `failObjective` calls in both
 * losing triggers are what make the fallback correct: a completed row stays
 * complete because `CampaignSession.setObjective` refuses to un-resolve a
 * resolved row, and the outstanding one becomes `failed` and gets named.
 *
 * **`BOTH_ON_THE_GROUND` IS A WORLD READ AND `BOTH_DONE` IS A STATE READ, ONE
 * TICK APART.** `CampaignSession.simTick` runs `runDirector` over the WHOLE
 * table and applies the collected effects afterwards, so `objectiveComplete` —
 * which `t.win` is two of — cannot be true until the tick AFTER
 * `completeObjective` fires, while `elapsed` and `playerBeaten` read the live
 * world NOW. A commander who lands their sixth man on the closing tick would
 * otherwise be beaten out of a match they had just won. A7 measured that
 * failure on a real world and this is its fix copied deliberately.
 *
 * ============================================================================
 * WHAT WAS CONSIDERED AND CUT
 * ============================================================================
 *   - **A DEAD-END RESCUE.** `allies.07.fair-copy` authors one and
 *     `src/sim/OreCrisis.ts` is the shape. There is no dead end here to redeem:
 *     the player keeps a Construction Yard, a refinery and a landing yard on an
 *     island Cregg's brain has to cross seventy-two metres of water to reach,
 *     so a commander who loses both landing craft buys another for 460 credits
 *     off a structure they already own — and if they lose the yard too, 1 000
 *     buys that. `orecrisis.system.ts` already covers the only genuinely
 *     unrecoverable state, a dead economy, and it works properly here because
 *     seat 0 opens with a real refinery standing. A second rescue on top of a
 *     position that can always buy its way back is a handout.
 *   - **A THIRD SEAT.** Three armies on this map is three islands and a fourth
 *     one empty, and `applySetupToWorld` re-asserts the SINGULAR `aiFaction`
 *     onto entry 0 — so a third seat is a genuinely independent hostile with no
 *     way to declare it anything else. A salvage broker and a siting office
 *     arguing about a shoal do not need a third army on it, and the operation's
 *     fairness argument is a symmetry between exactly two.
 *   - **PUTTING THE PLAYER'S OPENING ON BENCH NINE.** The landing would then
 *     have already happened, which makes this a defend (A4) with a boat in it.
 *     The crossing IS the type.
 *   - **A HOLD ON THE BENCH.** `elapsedSinceArmed` is A6's whole operation one
 *     chapter-slot earlier and it would make this one about standing still.
 *     What a siting needs is a party ON the ground at the close, and `t.win`
 *     fires the tick both primaries are in — which is the same statement
 *     without asking the player to wait out a clock they cannot influence.
 *   - **PAYING THE PRIMARY.** `validateCampaign` refuses `credits` on a primary
 *     at import and it would be wrong anyway. The secondary pays 1 000, which
 *     is two more landing craft and a slot to put in them.
 *   - **`ignoreSeats`.** Two seats, both real, and the operation ends on its own
 *     triggers in every direction. A list would be inert.
 * ========================================================================== */

import { Faction } from '../../../core/types';
import { minutes, seconds } from '../../types';
import type { Condition, OperationDef } from '../../types';
import {
  BENCH_AREA, BERTH_AREA, CROSS, SHINGLE, SHINGLE_AREA,
} from '../../layouts/allies-made-good';

/**
 * THE GEOMETRY IS IMPORTED, NOT RESTATED.
 *
 * The bench is placed by the layout and the lifts are ordered onto it by this
 * file, so the two modules have to agree about two points and three discs. A
 * number written in both is a number that will disagree the first time either
 * is tuned, and the failure — a lift unloading into the sea, a reveal framing
 * nothing — is invisible to every gate. `layouts/allies-made-good.ts` owns the
 * geometry; the dependency runs operation -> layout and never back, and the
 * five points this file does NOT import — `MOOR`, `BERTH`, `FLOOR`, `YARD`
 * and `HEAD` — are the layout's alone.
 */

/**
 * The guard on a build that failed rather than on a race.
 *
 * `ownerCount(..., max: 0)` on the TAGGED branch reads TRUE before the layout
 * has stamped anything, and so would `entityDead`. **This is defence against a
 * layout that placed NOTHING and not a fix for a failure anyone has observed:**
 * `game.scenario` builds the world inside `async init()` and
 * `SystemRegistry.init` awaits every module's init IN SEQUENCE, so a correctly
 * spelled tag is never empty when the Director first runs. The reachable
 * failure it closes is a roster typo — `ScenarioBuilder.spawnBuilding` asks
 * `isBuildable` and SKIPS a refused def with no throw and no log — and the real
 * gate on that is `tests/campaign-roster-ground.spec.ts`, which builds this
 * operation with the tables bound and the roster armed. Twenty seconds is
 * unmistakably past the build and unmistakably short of anything being lost:
 * the earliest hostile order is `t.crew1` at four minutes.
 */
const SETTLE = seconds(20);

/** The quarter's list closes. `parSec` 1320 to the second — see the note there. */
const CLOSE = minutes(22);

/**
 * Both primaries resolved, read off the Director's own state.
 *
 * Defined once because two triggers must agree on it — `t.headStanding` has to
 * resolve on the same tick as `t.win` and cannot be allowed to drift from it.
 */
const BOTH_DONE: Condition = {
  on: 'all',
  of: [
    { on: 'objectiveComplete', id: 'ashore' },
    { on: 'objectiveComplete', id: 'bench' },
  ],
};

/**
 * The same two facts ONE TICK EARLIER, read off the world, and the two losses
 * read this one.
 *
 * `objectiveComplete` cannot be true until the tick after `completeObjective`
 * fires; `elapsed` and `playerBeaten` are true NOW. Without this a commander
 * whose last act is landing their sixth man, or clearing the last of the crew,
 * loses on the tick they win. The `objectiveComplete` half of each pair is not
 * redundant: a party that lands, completes the row and then walks inland stops
 * satisfying `unitsInArea`, and without the union the clock at 22:00 would fail
 * a primary the player finished at minute nine.
 */
const BOTH_ON_THE_GROUND: Condition = {
  on: 'all',
  of: [
    {
      on: 'any',
      of: [
        { on: 'unitsInArea', player: 0, area: SHINGLE_AREA, min: 6 },
        { on: 'objectiveComplete', id: 'ashore' },
      ],
    },
    {
      on: 'any',
      of: [
        { on: 'ownerCount', player: 1, role: 'building', tag: 'crew', max: 0 },
        { on: 'objectiveComplete', id: 'bench' },
      ],
    },
  ],
};

/**
 * The strand is held. One unit, which is the supply line and not the objective.
 *
 * **ONE UNIT ON DRY GROUND.** `SHINGLE_AREA` is a land disc — no cell a naval
 * hull may occupy overlaps it, swept against the real
 * `costGridFor(MoveClass.Naval)` — which is what stops `min: 1` being held by
 * an empty boat bobbing offshore. It was, at the r = 26 this shipped with: all
 * four lifts arrived with nobody ashore. See the block at `SHINGLE_AREA`.
 */
const BEACH_HELD: Condition = {
  on: 'unitsInArea', player: 0, area: SHINGLE_AREA, min: 1,
};

const op: OperationDef = {
  id: 'allies.09.made-good',
  chapter: 'allies',
  faction: Faction.Allies,
  /*
   * THE RECLAMATION, AND IT IS THE STING RATHER THAN A CHANGE OF SCENERY.
   *
   * `validateCampaign` refuses two ADJACENT operations that share a
   * `primaryType` — A8 is `economy` and this is `landing`, so that rule is
   * satisfied — and it says nothing at all about `foe`, which is why the block
   * below is an argument rather than a note.
   *
   * **THE CHAPTER RESOLVES INTO ONE ANTAGONIST, AND THIS IS THE THIRD
   * OPERATION AGAINST HIM AND THE SECOND IN A ROW.** The Soviets four times,
   * the Meridian Pact twice, and then Cregg. A6 sold the Allies the current
   * their correction was computed on and closed the line at shift change; A8 —
   * whose own `foe` block makes the argument better than this one can — was
   * fought against him because *"every refinery sited from the old one is a
   * customer"*, so he spent that operation being PAID to keep the arc's
   * standing block occupied against the very amendment the Allies were buying.
   *
   * **HE IS ON THE OTHER SIDE OF IT HERE WITHOUT HAVING CHANGED HIS MIND ABOUT
   * ANYTHING, AND THAT IS WHY THE REPEAT IS THE CONTENT.** A8 describes him as
   * the one party on the continent for whom *"everything has a price and none
   * of it is personal"*. The moment the amendment stopped being an evening's
   * slip and became the standing entry, the ground it points at became the
   * thing to own — and he was on it in eleven days, off the Allies' own
   * arithmetic, having lost the previous argument and immediately re-priced
   * himself on the winning side of it. A siting office reads a circular and
   * files it; his house reads it the way a bank reads an interest rate. Any
   * other army here would be a fresh opponent for a finale whose whole subject
   * is who ACTS on a published number, and there is exactly one on the
   * continent whose business that is.
   *
   * `Salvage Rights` is a chapter about *"nine breaking yards, every faction as
   * a customer, and the only complete account"*; `reclamation.02.written-off`'s
   * own beat is *"The Soviets wrote this field off in week two. Cregg has read
   * the same survey."* This is that sentence turned on the people who wrote the
   * survey.
   *
   * It also pins the mechanics, and one of them is load-bearing. Both keyed
   * troops and all five timed ones spawn literal `rclPicker`, `rclSlagger` and
   * `rclGrinder`, which `validateCampaign` refuses on any seat that is not
   * Reclamation. The layout's `pillbox` resolves through
   * `ScenarioBuilder.keyFor` to the **Arcspitter Post** — `rclSpitpost`,
   * `postCoil`, 20 m, `power: 0` so a brownout does not silence it, and it
   * CHAINS at `chainCount: 1`. One pull is 43.52 and the second link 26.11
   * against a G.I.'s 120 hp and an engineer's 90, so it kills nobody outright
   * and `tests/campaign-emplacement-reach.spec.ts` §2 is satisfied with room
   * rather than by the row not chaining. On a Soviet seat the same key is a
   * Sentry Gun at 22 m with no chain, and on an Allied seat a Pillbox; the
   * whole beach arithmetic in the layout header is a statement about the
   * Reclamation column of that table.
   *
   * That asymmetry — the verb checked, the enemy not — is right. A chapter with
   * one antagonist is a chapter and a chapter with one VERB is a grind. But it
   * does mean nothing mechanical is checking this line, which is why it is
   * argued at length above rather than asserted.
   */
  foe: Faction.Reclaim,
  /*
   * **9, AND IT WAS 8 UNTIL `allies.08.standing-order` LANDED.**
   *
   * `validateCampaign` checks `op.index !== i + 1` against the operation's
   * POSITION in its chapter, and `collectOperations` sorts by module path — so
   * while the eighth operation's module was absent, `09-made-good.ts` was the
   * eighth file `allies/` held and the validator refused any other number. Its
   * LAYOUT arrived first and its operation module second, which is the
   * half-landed state that number was provisional for; both halves are here now
   * and the provisional pair (this and `requires` below) has been closed.
   *
   * The `id` deliberately did NOT move — nothing validates the id against the
   * index, `OperationState` and the campaign save are keyed by the id STRING,
   * and renaming it would strand every completion record that already says
   * `allies.09.made-good`.
   */
  index: 9,
  title: 'Made Good',
  beat: 'The correction is pasted into every book on the continent and not one peg has moved — '
    + 'and the only people who acted on it were the ones who read circulars for a living.',
  primaryType: 'landing',
  /*
   * BESPOKE. Objective state, spawns, orders, reveals, dialogue, an announcer
   * line, a camera move and an outcome — `types.ts` defines the archetype as
   * "multiple effect kinds", and this is nine of the eleven. The two it does
   * not use are `grantCredits` (the one payment here is an `ObjectiveDef.credits`
   * on the secondary, which is the shipped reward and reaches the same
   * `Economy.grant`) and `setObjective` (nothing here is hidden — all three
   * rows have to be visible before the player decides what goes in the first
   * boat, and that decision is taken in the first ninety seconds).
   */
  archetype: 'bespoke',
  /*
   * TWENTY-TWO MINUTES, AND THE AUTHORED PAR IS THE DEADLINE TO THE SECOND —
   * the rule `allies.03.ground-truth`, `allies.05.forced-closure` and
   * `allies.07.fair-copy` all state about their own, and the only way the field
   * is falsifiable from inside the operation. The chapter's ramp is
   * 780 / 840 / 900 / 960 / 1020 / 1080 / 1140 and reaches 1320 here, which is
   * the longest in the chapter and inside `tests/campaign-length.spec.ts`'s
   * 10-30 minute band with eight minutes to spare at the top.
   *
   * **THE MOVEMENT FLOOR IS 32.8 SECONDS AND THE FIGHT IS UNMEASURED, AND THIS
   * FILE WILL NOT PRETEND OTHERWISE.** One loaded round trip is 108.1 m of open
   * water each way at a `landingCraft`'s 6.6 m/s — **2.5% of par** — plus 78.1 m
   * up the island at a Warden's 6.6 or a rifleman's 3.2. Everything else is the
   * fight, the loading and the build, and no harness in this repo can put a
   * number on any of them.
   */
  parSec: 1320,
  /*
   * **THIS EDGE WAS PROVISIONAL AND NAMED A7 UNTIL THE EIGHTH LANDED.** The
   * chapter is nine operations and this is the ninth; at the time this file was
   * written the eighth was being authored in parallel, its LAYOUT was in the
   * tree and its OPERATION MODULE was not, and `validateCampaign` checks
   * `requires` for RESOLUTION — so an edge to a module nobody had committed
   * would have been a build error rather than a note. It names the eighth now:
   * the chapter is a chain, and A8's own hinge — the correction going down the
   * chain and being pasted in — is the premise the first paragraph of this
   * header opens from.
   */
  requires: ['allies.08.standing-order'],

  map: {
    /*
     * `atoll`, WHICH NO OPERATION IN ANY CHAPTER HAS EVER USED, AND THE CHOICE
     * IS FORCED RATHER THAN DECORATIVE.
     *
     * `MAP_SEAS` has three entries. `coast` and `tropical` are half-planes
     * placed by `seaOffMapCentre` — one land region and one water region, which
     * `config.ts` states as a structural property and not a tuning outcome — so
     * an objective across their water is an objective in the sea. `atoll` is
     * `ARCHIPELAGO_SEA`: four ellipses, no land route between any two, and
     * `mapForcesSeaCrossing` true of it and of nothing else in the game. An
     * operation whose premise is ground the published schedule had as open
     * water has exactly one map it can be fought on.
     *
     * **AND IT SEATS TWO ARMIES ON FOUR ISLANDS, WHICH IS WHAT MAKES THE
     * OBJECTIVE POSSIBLE.** `startPointsFor` reads `sea.islands` and returns
     * `islands.slice(0, n)` — table order, seed ignored — so at `armies: 2`
     * islands 2 and 3 are unseated: no levelled shelf, no `addIslandOre` field,
     * no `buildBaseFor`. Bench Nine is island 2, and it is the only ground in
     * the shipped game that is real, reachable and entirely unfurnished.
     *
     * The atoll's own lobby number is four players and this operation declares
     * two. That is legal — `validateCampaign` bounds `armies` by
     * `SKIRMISH_ARMIES_MAX` and nothing else — and it is the point.
     */
    preset: 'atoll',
    /*
     * `temperate`, AND THE PAIRING IS STATED RATHER THAN ASSUMED. A preset is
     * not a biome: the two vocabularies overlap on three names and disagree on
     * exactly one — the preset is `arid`, the `BiomeName` is `desert` — and
     * `getBiome` answers an unknown name with a `console.warn` and TEMPERATE,
     * so a mismatch ships a different LANDFORM in silence.
     * `reclamation.03.sold-twice` has already paid for that. `atoll` is not a
     * `BiomeName` at all, so this field must name one of the four and
     * `temperate` is the one the shipped Sunder Atoll is generated with.
     *
     * It also closes the chapter where it opened. A1 took the first reading of
     * this schedule on temperate ground in a valley; A7 carried the fair copy
     * back across the same kind of ground to post it; this stands on it.
     */
    biome: 'temperate',
    /*
     * SURVEYED, NOT DATED. The chapter's counter runs +7 a week from A5's
     * 20 260 935, so the convention gives 20 260 963. Six rolls were built
     * headless with this operation's finished layout on them and scored on the
     * four things it rests on — island 2's passable fraction, island 2's
     * buildable fraction, the width of the crossing at z = 390, and whether the
     * west shore offers a beachhead. 20 261 005 wins every column at once,
     * though the margin is narrower than this note once claimed: 1.9 points
     * clear of the next best on the one that matters most and 5.5 clear of the
     * convention's own roll. The table is in the layout header, and both of its
     * island columns were re-measured after the first version of them failed to
     * reproduce on the instrument the header names.
     *
     * Pinned by `tests/campaign-maps.spec.ts` as a terrain fingerprint: a
     * generator change that re-rolls this ground moves every distance in both
     * files.
     */
    mapSeed: 20_261_005,
    /*
     * THE CHAPTER'S COUNTER IS +7 AN OPERATION (7 014 … 7 049 for A6, 7 063 for
     * A7), so A8 takes 7 070 and this takes 7 077.
     *
     * **AND ON AN ARCHIPELAGO IT IS BOOKKEEPING RATHER THAN PHYSICS, WHICH IS
     * WORTH STATING BECAUSE IT IS THE OPPOSITE OF A7's SITUATION.** A7 had to
     * SKIP a value because `seatedSlots` drew an edge pair from it. Here
     * `startPointsFor` and `startSpots` both take the island branch, which
     * ignores the seed entirely and hands back island centres in table order —
     * verified, not assumed: the seat pair is (118, 390) and (394, 122) at
     * every seed tried. What this number still drives is `s.rng`: scatter,
     * ore-cell jitter and every draw the scenario makes. Change it and
     * re-measure the ore; do not re-measure the geometry.
     */
    simSeed: 7_077,
    armies: 2,
    /*
     * `'base'`. Both seats open with a full base — the layout calls
     * `buildBaseFor` twice — and this is the chapter's LAST operation with an
     * economy, after A7 took the sidebar away entirely.
     *
     * That is deliberate sequencing rather than a return to the mean: A7's
     * `'force'` is the chapter at its narrowest, thirteen men and no way to
     * make a fourteenth, and this is the widest thing the chapter does. A
     * landing is about logistics, and logistics is a thing you can only have
     * when you have a yard behind you.
     */
    opening: 'base',
    /*
     * 6 000, AND IT BINDS BOTH SEATS — `Shell.applySimPostBoot` writes
     * `setup.startingCredits` into every non-Neutral slot.
     *
     * The lever is what it does to CREGG rather than what it does to the
     * player. CLAUDE.md names the 10 000-credit default as the single measured
     * cause of "the AI has a ready base": nobody touching the controls, seed 7,
     * Normal, the brain spends it into a seven-building base with a defence
     * tower and eleven troops by t+90 s having mined nothing. Against an
     * operation whose first ninety seconds are a load and a crossing, that is
     * an opponent who has already won the part the player is not playing.
     *
     * 6 000 is above `MCV_MIN_CREDITS` 5 000 — the smallest bank documented as
     * reaching a refinery — and it buys the player, on top of the yard and the
     * two craft the layout gives them, either a third landing craft and a
     * Warden section, or an eight-slot `transport` and a rifle section, without
     * touching their first minute of mining. `allies.05.forced-closure` reaches
     * 5 000 by the same kind of argument and calls it two fifths of an engineer
     * section; this is that plus a boat.
     */
    credits: 6000,
  },
  layout: 'allies-made-good',

  // NEITHER SHIPPED RULE MAY END THIS. See the header: annihilation would
  // declare a win with nobody on the bench, and `assetLossDefeat` asks a worse
  // version of the question `t.beaten` asks.
  outcome: { annihilationWin: false, assetLossDefeat: false, ignoreSeats: [] },

  /*
   * AN ALLOW-LIST, SO TAGGED-AND-UNLISTED IS REFUSED FOR BOTH SEATS.
   *
   * **THE AI's EMPTY LIST IS THE ONE LINE KEEPING THE SECONDARY REACHABLE.**
   * **MEASURED AGAINST A CONTROL BUILD WITH THE ROSTER CLEARED, and the whole
   * cost is eight entities, four a side.** Cregg loses an `rclPylon`, an
   * `rclCrucible` and two `rclSpitter` that `buildBaseFor` would otherwise have
   * stood up on his island; the player loses a `battleLab`, a `prismTower` and
   * two `ifv` from theirs. 289 entities become 281. The load-bearing one is the
   * Pylon, and it is in the CONTROL BUILD — so the empty list really does take
   * that structure off the board rather than merely forbidding one nobody was
   * going to found: 28 m of reach,
   * `chainCount: 3`, and 120.32 on the first link — against a 90 hp engineer
   * that is a kill on the first link and another on the second, and the bore
   * head is the one objective on this map with exactly one route to it and no
   * hull that can take it. `Placement.withinBuildRadius` gives a finished
   * non-builder structure `PLACEMENT.adjacencyRadius` 20 m plus its own radius,
   * so a Pylon founded anywhere near the breaking yard covers the head and the
   * secondary becomes unreachable on a decision no author can see and no test
   * can read. Withheld, the longest structure weapon either army can put on
   * Bench Nine is `postCoil` at 20 m, which is the two posts the layout stands
   * at 18.4 and 13.4 m of their own structures, and the beach arithmetic in the
   * layout header stays true.
   *
   * **THE PLAYER'S EMPTY LIST COSTS THEM THE TOP OF THEIR OWN TREE AND THAT IS
   * THE TRADE.** The control build names it exactly: a `battleLab`, a
   * `prismTower` and two `ifv` that would otherwise be standing on the home
   * island at t = 0, and everything behind them — no Refractor Tank, no
   * Chronosphere, no repair depot, so a hull that comes home hurt stays hurt.
   * The island keeps the three Pillboxes `buildBaseFor` leaves. What is left
   * is the whole of the naval line — **the navy carries no `unlockedBy` at
   * all**, deliberately, and that is what this operation is made of — plus
   * riflemen, engineers, Wardens and the yard that launches them.
   *
   * PROFILE-INDEPENDENT, so the ground is the same on a finished account as on
   * a fresh one, which a deny-list could not promise. `setCampaignRoster` is
   * consulted AHEAD of both the PvP suppression flag and the installed gate.
   */
  roster: { player: [], ai: [] },

  objectives: [
    /*
     * TWO PRIMARIES AND A SECONDARY, which is exactly `MAX_VISIBLE_OBJECTIVES`.
     *
     * **NOTHING ON THIS BENCH CAN BE CLEARED FROM THE SEA, AND THAT WAS
     * MEASURED RATHER THAN ASSUMED — THE FIRST VERSION OF THIS BLOCK ASSERTED
     * THE OPPOSITE.** It argued the two primaries were independent because a
     * player could stand a destroyer off the shore and shell the crew without
     * landing. The longest naval gun in the game is `navalGun` at **34 m** (the
     * `destroyer`; `hydrofoil` carries `ifvChaingun` at 22), and the nearest wet
     * cell on the whole map to each objective is
     *
     *     rclSorter        75.0 m
     *     rclBreakerYard   93.7 m
     *     civOreMine       51.0 m
     *
     * — sampled at 4 m cell centres against `heightAt < WATER_LEVEL`, to the
     * structures AS THEY STAND. The bore head is a 2x2 that cannot move under
     * the faced-footprint snap and reproduces its published 51.0 at 50.99,
     * which is the control; the two 3x2 structures moved 2.83 m each and took
     * their rows with them (they measured 72.7 and 92.2 at the positions this
     * block used to name, so about 0.4 m of the old figures was a finer
     * sampling than cell centres and the rest is the move).
     *
     * — so the closest a hull can get to the nearest of the three is
     * **seventeen metres short of its own reach**. There is no bombardment
     * route, there is no fire support from the water, and every single thing
     * this operation asks for has to be carried ashore and walked. That is a
     * better fact than the one it replaces and it is the reason the type is
     * `landing` rather than `assault`.
     *
     * **SO WHY TWO ROWS.** `ashore` is a SIMULTANEOUS count — `unitsInArea` asks
     * how many of yours are standing in the disc at this instant, not how many
     * have ever been — so it is genuinely possible to clear the crew without
     * satisfying it: ferry four at a time, walk each pair inland, and there are
     * never six on the strand at once. It is also possible, and normal, to
     * satisfy it at minute two and spend the other twenty on the bench. Both
     * orders happen and the HUD says which half of the operation the player is
     * in, which is exactly the argument `allies.06.machine-time` makes for its
     * own two-stage primary: say stage one out loud rather than hiding it
     * inside stage two.
     *
     * **AND IT IS ALLOWED TO BE EARLY.** `allies.03.ground-truth`'s primary is
     * three units on a disc for one tick, and its header defends that at
     * length: when the ROUTE is the difficulty, arriving is the achievement and
     * being pushed off afterwards costs nothing. The route here is eight slots
     * and seventy-four metres of water.
     */
    /*
     * **THE TITLE IS KEPT AND THE ARGUMENT FOR IT IS A MEASUREMENT.** The disc
     * is 908 m² against island 2's **29 760 m² of dry ground** — 3.1% of Bench
     * Nine, measured cell by cell inside the 98 m ellipse on the built world —
     * so "on Bench Nine" is a fiction-level name for a specific beachhead
     * rather than for the island. That was the right reading to challenge while
     * the disc was 7.1% of the island AND a tenth of it open water, because
     * then the row could be closed from the sea and the title was the only
     * thing claiming otherwise. It is dry ground on Bench Nine's west shore
     * now, the objective cannot be satisfied anywhere else, and the player is
     * told exactly where in words: `t.orders` says *"Get six onto the strand"*
     * and `t.brief` names the shore it is on. A title that read "six units
     * inside a seventeen-metre circle at three-one-four, three-nine-zero" would
     * be truer to the predicate and worse at every other job a title has.
     */
    {
      id: 'ashore',
      kind: 'primary',
      title: 'Put a landing party on Bench Nine',
    },
    {
      id: 'bench',
      kind: 'primary',
      title: 'Take the bench off the breaking crew',
    },
    /*
     * ONE THOUSAND, ON THE SECONDARY ONLY. `validateCampaign` refuses `credits`
     * on a primary at import — paying for the primary is paying for playing —
     * and it is paid through `Economy.grant` rather than `deposit` so a
     * scripted reward never evaporates at a full silo.
     *
     * A thousand is one more landing craft and change, which is the only
     * currency this operation has: the head is taken by a man in a boat, and
     * what it buys is another boat.
     */
    {
      id: 'head',
      kind: 'secondary',
      title: 'Take the bore head off them whole',
      credits: 1000,
    },
  ],

  triggers: [
    /* -- the brief, in five beats -----------------------------------------
     * Split across sixty-four seconds because the shell renders dialogue as
     * toasts and a stack of five at once is a stack nobody reads — and because
     * `Shell.campaignBeatSeq` no longer lets two lines from one speaker inside
     * six seconds eat each other, so every one of these really does appear.
     *
     * THE ONE `cameraMove` IN THIS FILE, AND IT IS THE REVEAL. `types.ts`
     * reserves it for an arrival, a loss or a reveal and forbids it as
     * punctuation. The layout opens the camera on the landing yard; this moves
     * it across the water to the thing the operation is about, once, at four
     * seconds, before the player has begun anything.
     */
    {
      id: 't.open',
      when: { on: 'elapsed', ticks: seconds(4) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Aubray',
          text: 'The amendment is pasted into every book from the mills to the coast and I have '
            + 'the acknowledgements in front of me. Ninety-one siting offices agree with us. Not '
            + 'one of them has moved a peg, and none of them will, because being told your plant '
            + 'is in the wrong place is not the same as being shown the right one.',
        },
        { do: 'revealArea', player: 0, area: BENCH_AREA },
        { do: 'cameraMove', at: SHINGLE },
      ],
    },
    {
      id: 't.brief',
      when: { on: 'elapsed', ticks: seconds(18) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Wend',
          text: 'Bench Nine. Corrected series puts the next surfacing under it, and it is on no '
            + 'siting map anywhere because the old schedule had this whole shoal as open water. '
            + 'Seventy-four metres of it between our east shore and their west, and there is no '
            + 'ford — the bar in the middle is still a metre under. Anything with wheels or tracks '
            + 'goes in a boat. Frogmen can swim it, and it will take them the better part of two '
            + 'minutes in the open to find that out.',
        },
        { do: 'revealArea', player: 0, area: BERTH_AREA },
      ],
    },
    {
      id: 't.orders',
      when: { on: 'elapsed', ticks: seconds(32) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Aubray',
          text: 'One landing yard and two craft, moored east. Four slots each — a man is one and a '
            + 'hull is two — so eight slots is everything that crosses on the first trip. Get six '
            + 'onto the strand and the Works can enter a station against it. Keep somebody on that '
            + 'strand and the lift keeps coming; come off it and the boats stand off and wait.',
        },
      ],
    },
    /* -- the enemy states his case ----------------------------------------
     * IN CLEAR, and agreeing with us, which is the chapter's house rule for an
     * antagonist. A7's Calvane disputes whose number it is; Cregg disputes
     * nothing whatever.
     */
    {
      id: 't.cregg',
      when: { on: 'elapsed', ticks: seconds(48) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Cregg, on an open channel',
          text: 'Field Marshal. Lovely piece of work, that amendment — came down the trunk at six '
            + 'on the fourteenth and I had a crew on this bench by the twenty-fifth. I am not '
            + 'arguing with a word of it. I sank the bore on your figures. You want the ground '
            + 'your own arithmetic found, and you are very welcome to talk to me about the price.',
        },
      ],
    },
    {
      id: 't.bramm',
      when: { on: 'elapsed', ticks: seconds(64) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Bramm, on the survey net',
          text: 'He is the only man on the continent who behaved as though the number meant '
            + 'anything, and I cannot even say he is wrong to charge for it. Ninety-one offices '
            + 'read the same sheet and filed it. Put a party on that bench, Field Marshal, and the '
            + 'quarter\'s list carries a station on corrected ground — and then it costs the '
            + 'continent nothing to follow us.',
        },
      ],
    },

    /* -- Cregg feeds the bench --------------------------------------------
     * Five troops on the clock, all of them crossing the NORTH strait from his
     * own island and landing at `CROSS` on the bench's north shore — 82.1 m
     * from the breaking yard and 113.2 m from the strand. That geography is the
     * operation's fairness argument made mechanical: his reinforcement has to
     * cross seventy-two metres of water exactly as the player's does, and it
     * arrives on the far side of his own holding rather than in the player's
     * lap.
     *
     * UNCONDITIONAL AND ON A CLOCK. A troop that fires only when the player is
     * elsewhere reads as the map cheating; a schedule the world keeps whatever
     * the player is doing reads as an opponent.
     *
     * LITERAL RECLAMATION KEYS. `EffectSink.spawnUnits` resolves through
     * `ProductionCatalog.byKey` and remaps nothing, unlike the layout's
     * `ScenarioBuilder.spawnUnit`; `validateCampaign` checks every key against
     * the army of the seat it lands on, so an Allied key here is a build error.
     *
     * AND THE ORDER IS A HEADING RATHER THAN A LEASH. `AiBrain.census` files
     * every hull the seat owns into `armyIds` and `regroupSquads` re-files it
     * on the next pass; a campaign tag lives in `TagRegistry`, which the brain
     * has never heard of. These troops start pointed at the strand and then
     * belong to Cregg.
     */
    {
      id: 't.crew1',
      when: { on: 'elapsed', ticks: minutes(4) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Wend',
          text: 'Hauler off his south shore, four aboard, putting them down on the bench\'s north '
            + 'side. He is feeding it rather than defending his own yard, which tells you what the '
            + 'bench is worth to him.',
        },
        { do: 'spawnUnits', player: 1, key: 'rclPicker', count: 4, at: CROSS, spread: 12, tag: 'crew1' },
        { do: 'orderTagged', tag: 'crew1', order: 'attackMove', at: SHINGLE },
      ],
    },

    /* -- the lift ----------------------------------------------------------
     * THE MECHANIC THIS OPERATION OWNS. Every one of the four is the clock AND
     * `BEACH_HELD` — one of the player's own units inside the strand disc — and
     * neither half is sufficient. See the header: the first crossing must be
     * the player's own, because nothing else can put the man there who lets the
     * first lift in.
     *
     * `reinforcements` is the scripted `eva` `types.ts` names as earning its
     * place: `audio.system.ts` has no event for a scripted wave, so this is a
     * beat the announcer would otherwise have nothing to say about.
     * `EVA_LINES.reinforcements` carries a ten-second cooldown and the four
     * lifts are four minutes apart, so nothing swallows anything.
     *
     * NOT `repeat`, so each fires once, on the first tick both halves hold. A
     * player off the strand at nine minutes gets the nine-minute lift LATE
     * rather than not at all, which is the kinder reading and the truer one.
     */
    {
      id: 't.lift1',
      when: { on: 'all', of: [{ on: 'elapsed', ticks: minutes(5) }, BEACH_HELD] },
      then: [
        { do: 'eva', line: 'reinforcements' },
        {
          do: 'dialogue',
          speaker: 'Aubray',
          text: 'You are on it, so the lift is coming in. Four of the Ninety-First onto the sand.',
        },
        { do: 'spawnUnits', player: 0, key: 'gi', count: 4, at: SHINGLE, spread: 10, tag: 'lift1' },
      ],
    },

    {
      id: 't.crew2',
      when: { on: 'elapsed', ticks: minutes(8) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Wend',
          text: 'Second crew off his island — six, and two of them are hulls. Same beach.',
        },
        { do: 'spawnUnits', player: 1, key: 'rclPicker', count: 4, at: CROSS, spread: 12, tag: 'crew2' },
        { do: 'spawnUnits', player: 1, key: 'rclGrinder', count: 2, at: CROSS, spread: 18, tag: 'crew2' },
        { do: 'orderTagged', tag: 'crew2', order: 'attackMove', at: SHINGLE },
      ],
    },

    {
      id: 't.lift2',
      when: { on: 'all', of: [{ on: 'elapsed', ticks: minutes(9) }, BEACH_HELD] },
      then: [
        { do: 'eva', line: 'reinforcements' },
        {
          do: 'dialogue',
          speaker: 'Aubray',
          text: 'Second lift, and two Wardens with it. That is the last of what the yard had '
            + 'standing by — everything after this comes off your own factory floor.',
        },
        { do: 'spawnUnits', player: 0, key: 'gi', count: 4, at: SHINGLE, spread: 10, tag: 'lift2' },
        { do: 'spawnUnits', player: 0, key: 'grizzly', count: 2, at: SHINGLE, spread: 16, tag: 'lift2' },
      ],
    },

    {
      id: 't.crew3',
      when: { on: 'elapsed', ticks: minutes(12) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Cregg, on an open channel',
          text: 'Still here, then. I have a standing offer and it has not moved: walk off the '
            + 'shoal and I will cut you a rate on everything the bore brings up, indexed to your '
            + 'own schedule. You would be buying your own arithmetic back, but you would be warm.',
        },
        { do: 'spawnUnits', player: 1, key: 'rclSlagger', count: 4, at: CROSS, spread: 12, tag: 'crew3' },
        { do: 'spawnUnits', player: 1, key: 'rclGrinder', count: 2, at: CROSS, spread: 18, tag: 'crew3' },
        { do: 'orderTagged', tag: 'crew3', order: 'attackMove', at: SHINGLE },
      ],
    },

    {
      id: 't.lift3',
      when: { on: 'all', of: [{ on: 'elapsed', ticks: minutes(13) }, BEACH_HELD] },
      then: [
        { do: 'eva', line: 'reinforcements' },
        {
          do: 'dialogue',
          speaker: 'Aubray',
          text: 'Third lift is on the sand. Nine minutes on the quarter\'s list after this one.',
        },
        { do: 'spawnUnits', player: 0, key: 'gi', count: 4, at: SHINGLE, spread: 10, tag: 'lift3' },
        { do: 'spawnUnits', player: 0, key: 'grizzly', count: 2, at: SHINGLE, spread: 16, tag: 'lift3' },
      ],
    },

    {
      id: 't.crew4',
      when: { on: 'elapsed', ticks: minutes(16) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Wend',
          text: 'Fourth crew, seven of them. He is emptying the yard on his own island to hold '
            + 'this one, which is either confidence or a man who has read the same list we have.',
        },
        { do: 'spawnUnits', player: 1, key: 'rclSlagger', count: 4, at: CROSS, spread: 12, tag: 'crew4' },
        { do: 'spawnUnits', player: 1, key: 'rclGrinder', count: 3, at: CROSS, spread: 18, tag: 'crew4' },
        { do: 'orderTagged', tag: 'crew4', order: 'attackMove', at: SHINGLE },
      ],
    },

    {
      id: 't.lift4',
      when: { on: 'all', of: [{ on: 'elapsed', ticks: minutes(17) }, BEACH_HELD] },
      then: [
        { do: 'eva', line: 'reinforcements' },
        {
          do: 'dialogue',
          speaker: 'Aubray',
          text: 'Last lift. Whatever is standing on that bench at the close is what goes on the '
            + 'list, and nothing you land after five o\'clock counts as anything but a man on a '
            + 'beach.',
        },
        { do: 'spawnUnits', player: 0, key: 'gi', count: 5, at: SHINGLE, spread: 12, tag: 'lift4' },
        { do: 'spawnUnits', player: 0, key: 'grizzly', count: 2, at: SHINGLE, spread: 16, tag: 'lift4' },
      ],
    },

    {
      id: 't.crew5',
      when: { on: 'elapsed', ticks: minutes(19.5) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Wend',
          text: 'Everything he has spare, and two and a half minutes on the books.',
        },
        { do: 'spawnUnits', player: 1, key: 'rclSlagger', count: 5, at: CROSS, spread: 14, tag: 'crew5' },
        { do: 'spawnUnits', player: 1, key: 'rclGrinder', count: 3, at: CROSS, spread: 18, tag: 'crew5' },
        { do: 'orderTagged', tag: 'crew5', order: 'attackMove', at: SHINGLE },
      ],
    },

    /* -- the cost of being seen ashore -------------------------------------
     * KEYED TO THE PLAYER RATHER THAN TO THE CLOCK, so the hinge sits in the
     * same place for a fast commander and a careful one — the shape
     * `soviets.02.common-standard`, `reclamation.02.written-off` and
     * `allies.07.fair-copy` all use.
     *
     * `objectiveComplete` is read against the state the Director sees at the
     * START of the tick and `completeObjective` is applied by the sink after
     * every trigger has been evaluated, so this fires one tick AFTER the
     * landing it answers. That is the correct ordering and not a race.
     */
    {
      id: 't.noticed',
      when: { on: 'objectiveComplete', id: 'ashore' },
      then: [
        {
          do: 'dialogue',
          speaker: 'Cregg, on an open channel',
          text: 'That is a party on my shoal, and a party is a station, and a station goes on the '
            + 'list. Put everything on the west beach and keep it there — he cannot enter what he '
            + 'is not standing on, and he has seventy-four metres of water behind him.',
        },
        { do: 'spawnUnits', player: 1, key: 'rclPicker', count: 4, at: CROSS, spread: 12, tag: 'watch' },
        { do: 'spawnUnits', player: 1, key: 'rclGrinder', count: 2, at: CROSS, spread: 18, tag: 'watch' },
        { do: 'orderTagged', tag: 'watch', order: 'attackMove', at: SHINGLE },
      ],
    },

    /* -- the two primaries -------------------------------------------------
     * BOTH ABOVE `t.win`, which is this file's ordering rule: `runDirector`
     * returns early once an outcome is set, so a row written below the win can
     * never resolve on the winning tick and the medal never counts it.
     *
     * `ashore` is SIX UNITS, untagged, inside a **17 m** disc. Untagged because
     * the question is "how many of yours are standing here" and the answer must
     * include a hull the player carried, a rifleman a lift put down and an
     * engineer who has just walked back from the bore head — three different
     * provenances and one fact.
     *
     * **UNTAGGED IS WHY THE DISC HAS TO BE DRY.** The untagged branch of
     * `unitsInArea` counts any `IS_UNIT` of the player's that is not
     * `PendingDestroy`, which includes a landing craft (a Vehicle) and every
     * `Garrisoned` passenger whose body `Transport.carry` has parked on it. At
     * the r = 26 this shipped with, a tenth of the disc was navigable water —
     * 225 of 2 121 one-metre samples under `WATER_LEVEL`, and twenty-one
     * naval-passable cells overlapping it — and a loaded boat standing off the
     * beach read as six ashore. The
     * radius is the fix, not a tag: tagging would have to reach the player's
     * OWN units, which this file does not spawn.
     *
     * It is a LATCH: a non-repeating trigger is
     * retired by `state.fired` and `CampaignSession.setObjective` refuses to
     * un-resolve a resolved row, so a party that lands and then pushes inland
     * keeps its station.
     */
    {
      id: 't.ashore',
      when: { on: 'unitsInArea', player: 0, area: SHINGLE_AREA, min: 6 },
      then: [
        { do: 'completeObjective', id: 'ashore' },
        {
          do: 'dialogue',
          speaker: 'Bramm, on the survey net',
          text: 'Six ashore on corrected ground. That is a station and it goes in this quarter\'s '
            + 'list under its own number, which means the next office that reads the amendment is '
            + 'reading it with somewhere to put a plant.',
        },
      ],
    },
    /*
     * `ownerCount ... max: 0` rather than `entityDead`, and the difference is
     * CAPTURE: an engineer who walks into the sorting floor satisfies this
     * exactly as levelling it does, which is what the title promises and what
     * `allies.05.forced-closure` makes its whole operation out of. It is also
     * the trap this repo has shipped six times in the other direction — six
     * operations read `entityDead` on an ENEMY structure and were capture-blind
     * — so the spelling is deliberate rather than incidental.
     *
     * `SETTLE` for the reason written at that constant: a build that placed
     * nothing would read TRUE on tick one, in silence, before a word of the
     * briefing had played.
     */
    {
      id: 't.bench',
      when: {
        on: 'all',
        of: [
          { on: 'elapsed', ticks: SETTLE },
          { on: 'ownerCount', player: 1, role: 'building', tag: 'crew', max: 0 },
        ],
      },
      then: [
        { do: 'completeObjective', id: 'bench' },
        {
          do: 'dialogue',
          speaker: 'Wend',
          text: 'Sorting floor and breaking yard both off him. There is nothing left on this bench '
            + 'with his name on it.',
        },
      ],
    },

    /* -- the bore head, both ways ------------------------------------------
     * `structureCaptured` is `ownerOfTag(tag) === player`, which for a seat-1
     * structure means an engineer arrived, the head was at or under half, and
     * he was spent. See the header for the four-men-or-two-Wardens arithmetic
     * and for why a lone engineer is worse than nothing against a repair drip.
     */
    {
      id: 't.headTaken',
      when: { on: 'structureCaptured', tag: 'head', player: 0 },
      then: [
        { do: 'completeObjective', id: 'head' },
        {
          do: 'dialogue',
          speaker: 'Aubray',
          text: 'Bore head is ours, working, with his crew\'s own casing on it. Whatever this seam '
            + 'is worth, we are no longer buying it back a tonne at a time.',
        },
      ],
    },
    /*
     * THE CHEAP ANSWER, PRICED ON THE TICK IT HAPPENS RATHER THAN AT THE
     * DEBRIEF. A player who shells the head past 280 has not missed the
     * secondary, they have spent it, and being told so while there is still
     * time to change how the rest of the operation is played is the difference
     * between a rule and a punishment.
     *
     * **TWO GUARDS, AND THE STATE ONE ALONE WAS A TICK TOO LATE — MEASURED
     * THROUGH THE REAL `runDirector`, WHICH RETURNED THE FAILURE AND THE REWARD
     * IN ONE EFFECT LIST.** On the capture tick the head is the PLAYER's, so
     * `ownerCount(player 1, ..., max: 0)` is already true; but `runDirector`
     * evaluates the WHOLE table against `state.objectives` as of the START of
     * the tick and `CampaignSession.simTick` applies the collected effects
     * afterwards, so `objectiveComplete 'head'` still reads FALSE. Warmed to
     * minute ten and flipped `ownerOfTag('head')` from 1 to 0, the single
     * collected list was
     *
     *     completeObjective(head), dialogue<Aubray>,
     *     failObjective(head),     dialogue<Bramm>
     *
     * — Bramm accusing the player of breaking a thing they had just captured,
     * as the LAST toast on the tick of their reward, on every successful
     * capture of the operation's only secondary. The outcome was always right
     * (`CampaignSession.setObjective` refuses to un-resolve, so the row stays
     * complete and the thousand is paid); the damage was entirely the beat, and
     * because this trigger does not `repeat` it retired there, so the guard
     * suppressed nothing ever.
     *
     * **THE SECOND GUARD IS A WORLD READ, WHICH IS WHAT MAKES IT SAME-TICK.**
     * `structureCaptured` is `ownerOfTag(tag) === player`, read off the live
     * world, so it flips on exactly the tick `ownerCount` does. `not` of it is
     * therefore false precisely when the disappearance from seat 1 is a capture
     * rather than a demolition — and it stays inside the frozen vocabulary.
     * Re-measured after the change: `[captured]` returns two effects,
     * `completeObjective(head)` and Aubray's line, and nothing else.
     *
     * **THE `objectiveComplete` GUARD IS KEPT, NOT REPLACED, AND IT ONLY BECAME
     * LOAD-BEARING WHEN THE OTHER ONE LANDED.** The two cover different ticks.
     * `structureCaptured` answers on the capture tick and goes FALSE again the
     * moment the captured head is later shot down — at which point `ownerOfTag`
     * is -1, the `ownerCount` clause is still true, and only the resolved-state
     * read stops this row failing a secondary that was earned and then lost.
     * Driven through `runDirector`, capture at minute ten and the head shelled
     * flat ten seconds later:
     *
     *     as shipped now                    (none)
     *     objectiveComplete guard removed   failObjective(head), Bramm's line
     *
     * Before this change that branch was unreachable — the row had already
     * fired and retired on the capture tick — so the guard the previous comment
     * called load-bearing suppressed nothing in any state the operation could
     * be in. It does now. A resolved row does not un-resolve, so the
     * `failObjective` would still be a no-op; the dialogue would not, which is
     * the whole reason either guard exists.
     */
    {
      id: 't.headBroken',
      when: {
        on: 'all',
        of: [
          { on: 'elapsed', ticks: SETTLE },
          { on: 'ownerCount', player: 1, role: 'building', tag: 'head', max: 0 },
          { on: 'not', of: { on: 'structureCaptured', tag: 'head', player: 0 } },
          { on: 'not', of: { on: 'objectiveComplete', id: 'head' } },
        ],
      },
      then: [
        { do: 'failObjective', id: 'head' },
        {
          do: 'dialogue',
          speaker: 'Bramm, on the survey net',
          text: 'That was the only hole anybody has ever put in this seam and it is now a hole '
            + 'nobody can read. We will re-sink it in the spring and pay for the privilege of '
            + 'finding out what he already knew.',
        },
      ],
    },
    /*
     * The same shape as `allies.05.forced-closure`'s `t.storeStanding` and
     * `allies.07.fair-copy`'s `t.registerStanding`: a row left `active` when the
     * operation ends reads on the debrief as unfinished rather than as missed.
     * It cannot wrongly fire on a head already taken or already broken — both
     * of those rows are resolved by then and a resolved objective does not
     * un-resolve.
     */
    {
      id: 't.headStanding',
      when: {
        on: 'all',
        of: [BOTH_DONE, { on: 'ownerCount', player: 1, role: 'building', tag: 'head', min: 1 }],
      },
      then: [{ do: 'failObjective', id: 'head' }],
    },

    /* -- the close, telegraphed -------------------------------------------- */
    {
      id: 't.closing',
      when: { on: 'elapsed', ticks: minutes(21) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Aubray',
          text: 'One minute. The quarter\'s list is drawn from what is occupied at the close and '
            + 'not from what anybody intends, which is the whole complaint we have been making '
            + 'since the valley.',
        },
      ],
    },

    /* -- the bench is sited ------------------------------------------------
     * ABOVE THE TWO LOSSES, and file order is not what saves it — `t.win` and
     * the losses are never true on the same tick, which is why the losses read
     * `BOTH_ON_THE_GROUND` and not `BOTH_DONE`. See the block at that constant.
     *
     * AND IT CLOSES THE CHAPTER, which is a thing this file is allowed to do
     * and A7's `t.win` explicitly was not. Nine operations that began with two
     * points on a seam and a string end with a party standing on ground the
     * string found, on a shoal that was open water on every map in print.
     */
    {
      id: 't.win',
      when: BOTH_DONE,
      then: [
        {
          do: 'dialogue',
          speaker: 'Bramm, on the survey net',
          text: 'Station Nine, occupied, on the quarter\'s list, on corrected ground. Nobody has '
            + 'to believe the amendment now. They only have to look at where the ore is coming '
            + 'out of, and it is coming out of exactly where the working said it would.',
        },
        {
          do: 'dialogue',
          speaker: 'Aubray',
          text: 'Nine offices have already wired asking what it cost. Tell them the truth — a '
            + 'levelling loop, eleven years of somebody else\'s field returns, a room, an '
            + 'afternoon\'s machine time, two slips at a counter and an afternoon in a boat. Then '
            + 'send them the schedule and let them do their own arithmetic.',
        },
        { do: 'endOperation', result: 'win' },
      ],
    },

    /* -- the list closes ---------------------------------------------------
     * The hard deadline, at `parSec` to the second. It fails all three rows:
     * the secondary cannot be collected after the operation is over, and
     * failing one that is already complete is a no-op because a resolved row
     * does not un-resolve.
     *
     * NO `reason`, for the reason written in the header: two primaries, and
     * `EndScreen.campaignLine` falls back to the first FAILED primary when the
     * id matches no row, which the two `failObjective` calls immediately above
     * are what make correct.
     */
    {
      id: 't.close',
      when: {
        on: 'all',
        of: [
          { on: 'elapsed', ticks: CLOSE },
          { on: 'not', of: BOTH_ON_THE_GROUND },
        ],
      },
      then: [
        { do: 'failObjective', id: 'ashore' },
        { do: 'failObjective', id: 'bench' },
        { do: 'failObjective', id: 'head' },
        {
          do: 'dialogue',
          speaker: 'Cregg, on an open channel',
          text: 'Five o\'clock, and the quarter\'s list goes out with this shoal on it under my '
            + 'name, sited off your schedule, which I shall of course credit. Every office on the '
            + 'continent gets a correct number and one place to buy from. You were right, Field '
            + 'Marshal. That was never the expensive part.',
        },
        { do: 'endOperation', result: 'loss' },
      ],
    },

    /* -- the ordinary loss --------------------------------------------------
     * `playerBeaten` is `Viability.isBeaten` for one seat: nothing to build
     * with and nothing to fight with. It is the right read HERE and the wrong
     * one in `allies.07.fair-copy`, and the two files disagree on purpose — see
     * the header. `SETTLE` is conjoined because a build that placed nothing
     * would satisfy it on tick one, and that failure has to be reported by
     * `tests/campaign-roster-ground.spec.ts` rather than by a silent defeat.
     */
    {
      id: 't.beaten',
      when: {
        on: 'all',
        of: [
          { on: 'elapsed', ticks: SETTLE },
          { on: 'playerBeaten', player: 0 },
          { on: 'not', of: BOTH_ON_THE_GROUND },
        ],
      },
      then: [
        { do: 'failObjective', id: 'ashore' },
        { do: 'failObjective', id: 'bench' },
        {
          do: 'dialogue',
          speaker: 'Wend',
          text: 'Nothing answering on either island. The corrected schedule is the best number '
            + 'anybody on this continent has ever had and there is no longer anyone in the field '
            + 'to stand on it.',
        },
        { do: 'endOperation', result: 'loss' },
      ],
    },
  ],
};

export default op;
