/**
 * ============================================================================
 * R8 — CONTRA ENTRY
 * ============================================================================
 * R6 lodged a counterpart of the delivery book in a bonded store, and the
 * bond's rule is that anything lodged may be read by anybody who asks for it.
 * R7 was the first thing a checkable book can do that an unchecked one cannot:
 * COLLECT. This is the second, and it runs the other way.
 *
 * A contra entry is a bookkeeping term and it is the whole operation. It is an
 * entry on the opposite side of the same account — the one you post when the
 * party you are billing turns out to be owed something by you. Eleven months of
 * Reclamation delivery notes record what Tallow's yards TOOK exactly as
 * carefully as what they were owed, because that is what makes them worth
 * anything, and the Meridian have now read them. Among the entries is a
 * consignment of Pact plant lifted off a stranded convoy in the March, written
 * into our own book as received, valued in our own hand, and never paid for.
 *
 * **THE CLAIM IS CORRECT AND THAT IS THE POINT.** Tallow does not dispute it
 * and could not: the account's entire commercial value is that it can be
 * checked, and a firm that honours a checkable book only when the arithmetic
 * runs its way has an unchecked book with extra steps. So the answer is to pay
 * it, on their entry, at their count, before their whistle — and the price is
 * the four Slaghurlers standing in the lot pen, which are the only four this
 * yard will ever have.
 *
 * ============================================================================
 * WHAT THE ENTRY IS SETTLED IN, AND WHY IT IS THE ARTILLERY
 * ============================================================================
 * `roster.player` is `['unit.raider', 'unit.specialist']` and both halves are
 * load-bearing in opposite directions. `unit.specialist` is what lets the four
 * `rclSlaghurler` the layout stages STAND AT ALL — `ScenarioBuilder.spawnUnit`
 * asks `isBuildable`, a campaign roster is an ALLOW-LIST over tagged defs, and
 * tagged-and-unlisted is refused in silence, so omitting it would delete the
 * operation's own currency and leave `unitsInArea(..., tag: 'lot')` counting an
 * empty tag forever. What is NOT on the list is `struct.tech`, so `rclCrucible`
 * does not stand and cannot be raised — and `rclSlaghurler`'s prereqs are
 * `['rclBreakerYard', 'rclCrucible']`.
 *
 * **THERE ARE FOUR HURLERS AND THERE WILL NEVER BE A FIFTH.** Measured by
 * building this operation twice with the def tables bound, once with the roster
 * installed and once without: the roster removes `rclCrucible`
 * (`struct.tech`) and `rclPylon` (`struct.defence.specialist`) from seat 0, and
 * `mrdReliquary`, `mrdHelios` and `mrdSkiff` x2 from seat 1. The player keeps
 * their Arcspitters, their Spitposts and their whole economy; what they lose is
 * the ability to mint the thing they are paying with.
 *
 * The entry names THREE. The fourth is the margin, and it is the only slack in
 * the operation: `t.short` ends it the moment fewer than three are alive,
 * because at that point the account cannot be settled in the coin the entry
 * names and there is nothing left to play for.
 *
 * ============================================================================
 * A SLAGHURLER CANNOT DEFEND ITSELF AND THE NUMBER IS ELEVEN METRES
 * ============================================================================
 * `slagMortar` is 124 damage of `WarheadClass.HighExplosive` on a 4.3 s
 * cooldown, range 42, splash 5.8 — and **`minRange` 11**, with `requiresStop`.
 * So the lots outrange every gun on the map and cannot answer anything that
 * closes inside eleven metres, which is what makes walking them across the
 * district a decision rather than a drive. Delivered damage, derived from the
 * shipped rows as `damage x burstCount x ARMOR_MATRIX[warhead][class] x
 * COMBAT_DAMAGE.globalMul / cycle`:
 *
 *     the lot's own gun   vs Concrete  124 x 1.00 x 0.80 / 4.3    23.07 dps
 *                         vs Infantry  124 x 0.90 x 0.80          89.28 a shell
 *     mrdSolarch          vs Light      60 x 0.85 x 0.80 / 1.6    25.50 dps
 *     mrdWayfarer         vs Light   3 x 15 x 0.55 x 0.80 / 0.96  20.63 dps
 *
 * A `rclSlaghurler` is **230 hp of `ArmorClass.Light`**, so a full working —
 * four Wayfarers and three Solarchs — delivers 159.00 dps and takes one off the
 * board in **1.45 s**; the opening working of four and two manages it in 1.72 s.
 * A lot that meets a working alone is not damaged, it is gone. Cregg says so on
 * `t.screen`, which is UNCONDITIONAL at forty-six seconds, because
 * `ObjectiveRow` is `{ id, title, kind, status }` and a mechanism that is not in
 * the title has to be in a beat the ending cannot outrun.
 *
 * ============================================================================
 * THE COUNT HAS HOURS, AND THAT IS WHERE THE CLOCK COMES FROM
 * ============================================================================
 * The walk is not the clock and it was never going to be. Measured on the built
 * world with the engine's own two rules rather than a reconstructed chain: a
 * field rooted on the 75 routable apron cells over the real
 * `FlowFieldCache.costGridFor(MoveClass.Wheel)` — 8-connected, corner-cut
 * refused, destination-cell weights, diagonals at `(nc * DIAG) | 0`, exactly as
 * `Expander.step` does — and then `FlowFieldCache.buildFlow`'s own descent rule,
 * which points each cell at whichever 8-neighbour holds the LOWEST field value.
 * The four lots reach the counting apron in **141.5 to 189.5 m** (engine-weighted
 * 141.5 to 188.8 m-equivalent), which at a Slaghurler's 4.6 m/s is **30.8 to
 * 41.2 seconds**. Delivery is well under a minute of driving. If the operation's
 * clock were the distance it would be over at minute one.
 *
 * **THE DESCENT RULE IS NOT THE CHEAPEST CHAIN AND THE TWO DISAGREE HERE.**
 * `buildFlow` takes the steepest neighbour, which is a valid descent of the
 * field but is not always a minimum-cost path. Measured by re-costing the
 * descent chain against the same grid, it is **0.9% to 3.0% dearer** than the
 * field value it descends — 3568 against 3537 for lot 2, 3911 against 3797 for
 * lot 3, 4697 against 4580 for lot 0. A Dijkstra reconstruction therefore picks
 * a DIFFERENT chain with a different metre count, which is where the previous
 * version of this table (136.6 to 180.4 m) came from and why three separate
 * measurements of "the route" disagreed by up to 7 m. The **cost** column is the
 * chain-independent one, and it is what the exclusion control below is quoted
 * in; the metres are the route the game actually drives.
 *
 * So the clock is the office's own: **the assessor's count sits from the ninth
 * minute to the whistle at twenty**, and there is nobody to sign before it
 * opens. That splits the operation in two and both halves have their own
 * question. Minutes nought to nine are the yard's — keep four hurlers alive and
 * three ore stacks standing while a recovery party takes security in kind.
 * Minutes nine to twenty are the road's.
 *
 * **THE WINDOW IS SIX MINUTES WIDE AND THE OPERATION SAYS SO IN THE WAVE
 * TIMES.** Their third working lands at minute ten and a half and their fourth
 * at fifteen, pointed at the counter itself, so a player who settles between
 * nine and ten and a half is counted in peace and one who dawdles is counted
 * under fire. That is the race, and it is the only thing in the file that
 * rewards reading a clock rather than a map.
 *
 * ============================================================================
 * THE COUNT TAKES A MINUTE, AND THE HOLD IS NOT TRAP 26
 * ============================================================================
 * `t.settle` is `all: [elapsed(minutes(9)), unitsInArea(0, COUNTER_AREA, min: 3,
 * tag: 'lot'), elapsedSinceArmed(seconds(45))]` — three lots standing on the
 * apron together while the assessor weighs and signs. `elapsedSinceArmed` is a
 * HOLD and the Director evaluates the trigger twice for it, so a lot walked off
 * the apron at second forty restarts the weighing from the top.
 *
 * **P06 COSTED AN `elapsedSinceArmed` HOLD ON A WIN AND REJECTED IT, AND THE
 * REASON DOES NOT APPLY HERE.** Its hazard is that `CampaignSession.setObjective`
 * refuses to un-resolve a resolved row, so an objective completed on ARRIVAL and
 * a win gated on the HOLD leaves a player who steps out mid-hold losing with the
 * objective showing COMPLETE. Nothing in this file completes `entry` before the
 * win: the completion and the `endOperation` are effects of the same trigger, on
 * the same tick, and no other trigger names that objective except the two that
 * fail it. `t.weighing` exists to say the count has started, and it says it in
 * dialogue rather than in objective state for exactly this reason.
 *
 * ============================================================================
 * THE APRON IS QUIET IN BOTH DIRECTIONS, AND BOTH DIRECTIONS ARE MEASURED
 * ============================================================================
 * A forty-five second hold on ground a static gun covers is not a hold, it is a
 * countdown. Measured over the 75 routable cells of `COUNTER_AREA` on the built
 * world, against every armed structure either side owns:
 *
 *     the nearest Meridian post is 59.06 m from the nearest routable apron cell
 *     a Glaive Post acquires at 24 x 1.08 = 25.92 m of surface -> 28.80 m of
 *       centre against a Slaghurler's 2.880 m radius      margin 30.26 m
 *     a Slaghurler acquires at 42 x 1.08 = 45.36 m of surface -> 48.19 m of
 *       centre against a post's hitRadius(1,1) 2.828      margin 10.87 m
 *
 * **THE SECOND ROW IS THE ONE THAT IS EASY TO FORGET.** The apron has to be
 * outside the PLAYER's acquisition envelope as well, or the plant being weighed
 * opens fire on a picket it outranges by eighteen metres and the count becomes a
 * gunfight nobody ordered. `COMBAT_TARGETING.acquireRangeMul` is 1.08 and
 * `Combat.engage` gates on `max(0, flat - hitRadius(target))`, so the envelope
 * is per-hull and per-target and neither figure is a weapon range. Both posts
 * land at the same 59.06 m, which is the same constraint solved twice on a 4 m
 * cell grid rather than a designed symmetry: they are authored at
 * `lane(0.38, -2)` and `lane(0.78, -38)`, either side of the count, and the
 * layout's `POST_ONE` block lists the three offsets that failed the bound first
 * — including one that cleared the post's own envelope by 15.92 m and sat
 * 3.47 m INSIDE the lot's.
 *
 * The lots are also spawned `Stance.Defensive`, and that is load-bearing rather
 * than tidy: `STANCE_CHASE_METRES[Defensive]` is **0**, so a lot standing on the
 * apron will not walk off it to fight. Aggressive is `GUARD_LEASH` 18 and would
 * hand `Targeting.holdPost` a reason to leave the disc mid-count.
 *
 * ============================================================================
 * WHAT THE RECOVERY PARTY DOES WHILE THE ACCOUNT IS BEING ASSEMBLED
 * ============================================================================
 * A claimant with a correct entry is entitled to take SECURITY for it, and the
 * Meridian read that as the yard's three ore stacks. Four workings off `ROAD`,
 * and the escalation is in the TARGET rather than in the weight:
 *
 *     2:30   mrdWayfarer x4, mrdSolarch x2  -> attack-move STACK_TWO
 *     6:00   mrdWayfarer x4, mrdSolarch x3  -> attack-move STACK_THREE
 *    10:30   mrdWayfarer x4, mrdSolarch x3  -> attack-move the LOT PEN
 *    15:00   mrdWayfarer x4, mrdSolarch x3  -> attack-move the COUNTER
 *
 * Three distinct rings and thirteen drops rather than four rings and eighteen:
 * `EffectSink.spawnUnits` lands unit `i` of `count` at exactly
 * `angle = i / count * 2pi`, radius `spread`, and writes the point VERBATIM —
 * no `connectedGround`, no egress search — so every distinct ring is a separate
 * ground check that can rot, and waves two, three and four share theirs. Every
 * drop against its own locomotor on the built world:
 *
 *     mrdWayfarer x4  r=12  Foot   clearances 9.0 / 16.6 / 19.9 / 16.4 m
 *     mrdSolarch  x2  r=18  Hover              4.5 / 17.1
 *     mrdSolarch  x3  r=18  Hover              4.5 / 13.7 / 25.4
 *
 * — thirteen drops, all open, worst clearance 4.5 m against a Solarch's 2.9 m
 * hull. `tests/campaign-spawn-ground.spec.ts` is the standing gate and **a
 * change to any `count` or `spread` invalidates this**, because a wave of three
 * does not stand where a wave of two does.
 *
 * A stack is a `civOreMine` — **700 hp of `ArmorClass.Concrete`** — and an
 * unopposed working levels one in **11.67 s** (four and two: 4 x 6.75 + 2 x
 * 16.50 = 60.00 dps) or **9.15 s** (four and three: 76.50 dps). They are worth
 * defending for a reason that is not sentiment: `CIVILIAN_MINE_INCOME` pays
 * their holder 5 credits every 30 ticks, so three stacks are **900 credits a
 * minute**, which `src/data/Civilians.ts` prices at 1.71 harvesters against the
 * measured 525/min a real one returns. Over `parSec` 1200 that is 18 000
 * credits, and it is the difference between a yard that can replace what the
 * workings break and one that cannot.
 *
 * ============================================================================
 * THE PICKETS PRICE THE ROAD IN METRES AND CHARGE FOR IT IN PLANT
 * ============================================================================
 * A claim about a route is not evidence unless it is an EXCLUSION CONTROL:
 * re-run the field with the guns' discs impassable and see whether the cheapest
 * route costs more. **THE RADIUS OF THAT DISC IS NOT A FREE CHOICE, AND THE
 * FIRST VERSION OF THIS TABLE USED ONE THIS FILE DERIVES NOWHERE** — `range 24 +
 * 3.2` = 27.2 m, which is 1.6 m inside the acquisition envelope the section
 * above computes and 0.3 m outside the firing one. Re-run at both figures this
 * file actually derives, in COST (chain-independent) and in metres of the
 * `buildFlow` descent:
 *
 *                    open      firing envelope 26.88     acquisition 28.80
 *     lot 0   cost   4580      4580  (+0)   +0.00 m      4580  (+0)   +0.00 m
 *     lot 1          4721      4721  (+0)   +0.00        4721  (+0)   +0.00
 *     lot 2          3537      3922  (+385) +14.06       4022  (+485) +18.06
 *     lot 3          3797      4182  (+385) +14.06       4282  (+485) +18.06
 *
 * where 26.88 is `range 24 + a Slaghurler's 2.880 hull` and 28.80 is
 * `24 x COMBAT_TARGETING.acquireRangeMul 1.08 + 2.880`. So the pickets cost a
 * lot **up to 18.06 m of detour**, not the 18.9 the first table claimed — and
 * **lots 0 and 1 pay nothing at all, in cost or in metres**. The earlier +7.6 on
 * lot 1 was an artefact: its cheapest route costs 4721 with the discs open and
 * 4721 with them closed, and only the reconstructed CHAIN moved. A metre count
 * taken off a chain is not a detour; the cost is.
 *
 * **AND THE DETOUR IS NOT WHAT THE ROAD COSTS. THE EXPOSURE IS, AND THE FIRST
 * VERSION OF THIS FILE NEVER MEASURED IT.** An exclusion control answers *can
 * they still get through*; it says nothing about what happens to a player who
 * does not detour. Measured along the route `buildFlow` actually produces, in
 * metres of the polyline lying inside the disc (exact segment/circle clipping,
 * so it does not depend on which end of a cell edge the mask is attributed to):
 *
 *                       sight 26      firing 26.88     acquisition 28.80
 *     lot 0                0.00 m         0.00 m            0.00 m
 *     lot 1                0.00           0.00              0.00
 *     lot 2               47.62          50.76             56.81
 *     lot 3               47.62          50.76             56.81
 *
 * **`POST_TWO` COVERS 0.00 m OF EVERY ROUTE AT EVERY RADIUS.** All of this is
 * `POST_ONE`, on the near bend, and it is only ever the two lots whose route is
 * the SHORT one. Over the whole cost-OPTIMAL set rather than the one chain — a
 * lexicographic (cost, ±exposed metres) field, so the pair brackets the family —
 * the same quantity is **54.28 to 62.83 m** at the firing envelope.
 *
 * **THE DESCENT'S 50.76 SITS BELOW THAT BRACKET AND THAT IS NOT A
 * CONTRADICTION.** The bracket is over minimum-cost chains and the descent is
 * 0.9-3.0% dearer than one, so the engine walks a route that is slightly
 * longer and slightly LESS exposed than the cheapest. Every figure in the whole
 * family is over the 31.66 m the gun needs, which is the point: the exposure is
 * a property of the corridor, not of a chain somebody reconstructed.
 *
 * **WHAT THAT IS WORTH IN PLANT, AND IT IS ONE LOT RATHER THAN TWO.**
 * `glaiveRepeater` is 5 x 12 on `(5-1) x 0.06 + 0.55` = 0.79 s, so against a
 * Slaghurler's `ArmorClass.Light` one pull is `5 x 12 x
 * ARMOR_MATRIX[SmallArms][Light] 0.55 x COMBAT_DAMAGE.globalMul 0.80` = 26.40
 * and the gun delivers **33.42 dps** — 230 hp in **6.88 s**, which at 4.6 m/s is
 * **31.66 m of travel**. Both exposed lots walk 50.76 m of it, so the naive
 * right-click is 1.60x lethal per hull *if the gun could fire at both at once*.
 * It cannot: `glaiveRepeater` carries no `splashRadius` and one post is one
 * target at a time. Lot 2 is inside the firing envelope from **8.76 s to 19.79 s**
 * of the walk and lot 3 from **9.48 s to 20.51 s**, so the post holds a legal
 * target for **11.75 s** end to end and delivers **392.7 damage** — one lot dead
 * at 6.88 s of fire and 162.7 onto the next, leaving it at **67 of 230 hp**.
 *
 * `t.short` reads TWO lots gone. **So the intuitive right-click costs the
 * operation's declared slack and does not end it**, which is the decision this
 * file is publishing rather than an accident it is hiding: pay one lot, or spend
 * 18.06 m going round, or stop one short and shell the post flat. That third
 * answer is real and it is measured — see the block below — and because a
 * mechanism that is not in a title has to be in a beat, `t.road` says all three
 * at twenty-five seconds, unconditionally.
 *
 * **THE INSTRUMENT IS PROVED RATHER THAN TRUSTED**: the grid refuses **4118 of
 * 16 384 cells (25.1%)** for a wheeled hull, reads `COST_BLOCKED` at the
 * Meridian construction yard, and a 60 m disc laid across the near lots' route
 * takes lot 2 from cost 3537 / 141.54 m to **6384 / 238.51 m**. `COST_BLOCKED`
 * is imported from `src/world/terrain-gen.ts`; imported from `core/config.ts` it
 * is `undefined`, every comparison is false, the flood walks through buildings,
 * and the answer is plausible, slightly short and green.
 *
 * ============================================================================
 * A HURLER OUT-RANGES A GLAIVE POST BY EIGHTEEN METRES, AND THE ORDER HAS A
 * NAME
 * ============================================================================
 * `slagMortar` is range 42 and `glaiveRepeater` is 24, so the third answer to
 * the near bend is to stop a lot short of the post and shell it. **THAT DEPENDS
 * ON THE HULL STOPPING, WHICH DEPENDS ON WHICH ORDER IS ISSUED.**
 * `Targeting.managesGoal` accepts `UnitState.Attacking` and refuses
 * `AttackMoving`, so `OrderKind.Attack` — a right-click ON the post — parks and
 * `OrderKind.AttackMove` drives the whole way in.
 *
 * With the order named, `approach()` parks at `42 x APPROACH_RESUME_FRAC 0.95`
 * of SURFACE on the first approach and holds to `42 x APPROACH_STOP_FRAC 0.80`
 * thereafter — **42.73 m and 36.43 m of centre distance** against a 1x1
 * emplacement's `hitRadius(1, 1)` 2.828 — while the post reaches 26.88 m. So the
 * lot trades from 9.55 to 15.85 m outside the gun that is shooting back at
 * nothing. Measured on the built world, **231 open `MoveClass.Wheel` cells** lie
 * inside a lot's 44.83 m firing envelope of `POST_ONE` and outside the post's
 * own 26.88 m, so the standoff is ground that exists rather than a bearing.
 * `mrdGlaive` is 480 hp of `ArmorClass.Concrete` against `slagMortar`'s
 * `124 x ARMOR_MATRIX[HighExplosive][Concrete] 1.00 x 0.80 / 4.3` = 23.07 dps,
 * so one lot levels one post in **20.8 s** and takes nothing back.
 *
 * ============================================================================
 * NEITHER SHIPPED OUTCOME RULE MAY END THIS
 * ============================================================================
 * `annihilationWin` is off because levelling a Meridian establishment settles
 * nothing: the entry is correct, and an operation that let the player answer a
 * correct invoice by flattening the party holding it would be arguing the
 * opposite of everything the chapter has spent six operations establishing.
 * `assetLossDefeat` is off because the yard is a real base and a player who
 * loses the pen and holds the yard has lost the operation for a reason the file
 * should name — `t.short` does, by objective, rather than by a generic defeat.
 *
 * **THE ENDING IS TOTAL AND THE PARTITION IS THREE-WAY.** `t.settle` takes the
 * weighing completing; `t.short` takes fewer than three lots alive; `t.close` is
 * `all: [elapsed(minutes(20)), not(ON_COUNTER)]`, which is armed forever after
 * the whistle and fires the first tick the three are not standing on the apron.
 * There is no state after the whistle that escapes an `endOperation`: either
 * three lots are on the apron — in which case the hold is running and completes
 * within forty-five seconds, because the only thing that can break it also makes
 * `t.close` true — or they are not, and `t.close` has already fired. `t.rout` is
 * the floor under all three.
 *
 * `not(ON_COUNTER)` rather than `not(WEIGHED)` because `validateCampaign`
 * refuses an `elapsedSinceArmed` under a `not`: it reads TRUE during the arming
 * pass, so the negation reads false, so the trigger could never fire. That
 * refusal is why the deadline is stated as *"on the apron at the whistle"* — and
 * that is the better rule anyway, because it is the one a player can see.
 *
 * ============================================================================
 * WHAT WAS CONSIDERED AND CUT
 * ============================================================================
 *   - **`captureProof`.** Nothing in the trigger table reads `entityDead` or
 *     `entityAlive` at all, so there is no protect-target for a capture to
 *     invert. The one threshold a capture could touch is the SECONDARY
 *     `ownerCount(0, 'building', 'stack', min: 3)`, and the seat that would have
 *     to do it cannot: `src/sim/AI.ts` issues no `OrderKind.Capture` anywhere —
 *     CLAUDE.md's verb audit lists it under NEVER, and the brain owns no
 *     engineer because `buildUnits` filters `weight <= 0`. Seat 1 does open
 *     holding one `mrdArtificer` off `buildAlliedGarrison`, which is exactly
 *     `reclamation.05.closing-entry`'s case — but that operation's thresholds
 *     are its PRIMARIES, and a belt-and-braces field on a secondary that no code
 *     path can reach is a claim in the source that nothing tests.
 *   - **PAYING IN CREDITS.** The obvious mercantile shape is `credits(0, min: N)`
 *     at the counter, and it is a fiction the engine cannot honour: no effect
 *     removes credits, so "the money on the table" would be a threshold the
 *     player never spends and the operation would be lying about the one thing
 *     it is about. Plant can actually change hands. Credits cannot.
 *   - **A FIFTH LOT.** Four against a threshold of three is one loss of slack,
 *     and the arithmetic being exactly that tight is the operation. Five makes
 *     `t.short` unreachable in practice and the escort question academic.
 *   - **THE ASSESSOR AS AN ENTITY.** A Meridian clerk standing on the apron
 *     would be a hostile unit inside the disc the player is ordered to occupy,
 *     so the delivery would open with a firefight and the count would be decided
 *     by `Targeting`. The assessor is dialogue; the counter is a disc and a
 *     weigh house, and the weigh house is GAIA precisely so that three parked
 *     hurlers do not shoot the office they are reporting to.
 *
 * ============================================================================
 * EVERY ENDING WAS DRIVEN THROUGH THE REAL `runDirector`, AND IT FOUND THREE
 * ============================================================================
 * Eight scripted worlds fed to the shipped Director at 30 Hz against a stub
 * `WorldQuery` whose objective map IS `state.objectives` — the same map
 * `CampaignSession.setObjective` writes and `objectiveComplete` reads back — with
 * that method's own refusal rule applied to every transition, because a harness
 * that lets a resolved row un-resolve measures a different game.
 *
 *     clean        waiting at 9:00, three on the apron 9:10, win 9:55, SILVER
 *     late         three on the apron at 19:50: `t.close` never fires, the
 *                    weighing completes at 20:35 and the win lands, BRONZE
 *     stepped out  one lot off the apron at second forty-nine: the weighing
 *                    restarts and the win lands 45 s after the RE-ENTRY
 *     whistle      nothing on the apron at 20:00 -> loss, reason `entry`
 *     broke two    two lots dead at 12:00 -> loss on the tick, reason `entry`
 *     stacks lost  all three levelled by 5:00, entry still settled -> win,
 *                    BRONZE, and `t.stackLost` speaks once, at the first
 *     rout         seat 0 beaten at 5:00 -> loss
 *     worst tick   three arrive EXACTLY at 9:00 with the stacks already gone
 *
 * **THE WINNING TICK IS THREE BEATS FROM THREE SPEAKERS** — Cregg on the
 * stacks, then Calvane, then Tallow — and two from two when `stacks` fails,
 * because `t.notStacks` is deliberately silent. That is the bound this file
 * claims and the thing trap 26 exists to make somebody check.
 *
 * **THE THREE DEFECTS IT FOUND ARE ALL BEAT ORDER AND ALL THREE WERE IN THE
 * FIRST DRAFT.**
 *
 *   - **`t.waiting` STAYED ARMED FOREVER AND CONTRADICTED ITS OWN TWIN.** Its
 *     condition is `elapsed(minutes(9))` and a lot on the apron, which is as
 *     true at minute nineteen as at minute nine — and a non-repeat trigger that
 *     did not fire is still armed. So in the `late` row Cregg announced *"he has
 *     opened and there is Reclamation plant already standing on his apron"* at
 *     19:50, ten minutes after saying the opposite, with the `completeObjective`
 *     REFUSED by the session and the DIALOGUE landing anyway.
 *     `not(objectiveFailed('waiting'))` is the fix and it is the mirror of the
 *     guard `t.notWaiting` already carried. **A session that refuses a
 *     transition does not refuse the beat that came with it.**
 *   - **THE OPENING TICK WAS WORSE THAN THE ENDING.** All three terms were one
 *     trigger at thirty-two seconds and it emitted three beats with two Cregg
 *     lines back to back — trap 26's shape at the front of the operation rather
 *     than at its close. They are `t.terms`, `t.screen` and `t.security` now, at
 *     32, 46 and 60 seconds.
 *   - **`t.waiting` AND `t.weighing` COLLIDE WHEN THE PLAYER IS PUNCTUAL.** The
 *     `worst tick` row is a player holding three lots on the apron at the moment
 *     the count opens — the BEST line in the operation, and therefore the one to
 *     check — and both triggers fire on that tick. `t.weighing` is Tallow's line
 *     rather than Cregg's for that reason alone.
 *
 * ============================================================================
 * THE MEASURED POINTS
 * ============================================================================
 * Every coordinate the trigger table names is IMPORTED from the layout and
 * computed there from `SIM_SEED` at module load. Built headless at `mapSeed`
 * 27 884 / `simSeed` 12 907 on `biome: 'urban'` with the def tables bound and
 * this operation's roster installed — the same build
 * `tests/campaign-roster-ground.spec.ts` performs:
 *
 *     the yard          404, 380        the establishment  108, 132
 *     lot pen          334.5, 342.7     counting apron    219.5, 251.5
 *     stack one         380, 332        stack two          360, 344
 *     stack three       344, 300        weigh house        218, 252
 *     the two pickets   290, 286        150, 214
 *     their forming-up ground          153.6, 185.8
 *
 *     seat 0   26 buildings   18 units
 *     seat 1   25 buildings   12 units
 *
 * Every tagged structure lands within **2.12 m** of its authored point, which is
 * one grid snap on each axis and not a search — `place()` ring-searches a
 * refused footprint and it moved nothing here. The weigh house lands 1.56 m off
 * `COUNTER_AREA`'s centre, so the disc is an annulus around it: **75 of the 81
 * cells whose centres fall inside are routable**, for `Foot` and `Wheel` alike.
 * ========================================================================== */

import { Faction } from '../../../core/types';
import { minutes, seconds } from '../../types';
import type { Condition, OperationDef } from '../../types';
import {
  COUNTER, COUNTER_AREA, PEN, ROAD, SIM_SEED, STACK_THREE, STACK_TWO,
} from '../../layouts/reclamation-contra-entry';

/**
 * How long the layout is given to have placed the composition before a zero
 * threshold over it is believed.
 *
 * **EVERY `max:` THRESHOLD IN THIS FILE IS CONJOINED WITH IT.**
 * `ownerCount(..., max: N)` reads TRUE against an empty tag registry exactly as
 * `entityDead` does — the spelling changed and the hazard did not. Unguarded,
 * `t.short` would end the operation in a defeat on the first tick the Director
 * runs, and `t.stackLost` would announce a loss nobody had taken.
 *
 * It guards a layout that placed NOTHING rather than a tick-one read that
 * happens today: `game.scenario` builds the world inside `async init()` and
 * `SystemRegistry.init` awaits every module before a tick is taken, so the
 * registry is never empty when the Director first runs. What IS reachable is a
 * roster typo or a footprint that will not fit, and on this operation the roster
 * really does decide whether four Slaghurlers exist.
 *
 * Twenty seconds is past the build and short of anything happening: the nearest
 * hostile thing to the pen at t = 0 is a Glaive Post 72.06 m away that does not
 * move, and the first working does not leave `ROAD` until minute two and a half.
 */
const SETTLE: Condition = { on: 'elapsed', ticks: seconds(20) };

/**
 * The hour the assessor's count opens.
 *
 * THE OPERATION'S CLOCK, AND IT IS AN OFFICE HOUR RATHER THAN A TIMER. The walk
 * to the apron is 30.8 to 41.2 seconds; without a stated hour the whole
 * operation is over at minute one. `t.hour` announces it at minute eight,
 * unconditionally, which is the only reason a player can plan against it —
 * nothing in the HUD shows the match clock.
 */
const COUNT_OPENS = minutes(9);

/** The whistle. EXACTLY `parSec`, to the second. */
const CLOSE = minutes(20);

/** How long the weighing takes once the three are standing on the apron. */
const WEIGHING = seconds(45);

/**
 * Three lots standing together on the counting apron.
 *
 * `unitsInArea` reads FALSE against an empty registry, which withholds the win
 * rather than granting it, so this needs no settle guard. Three rather than four
 * because the entry names three and the fourth is the operation's only slack.
 */
const ON_COUNTER: Condition = {
  on: 'unitsInArea', player: 0, area: COUNTER_AREA, min: 3, tag: 'lot',
};

/**
 * The count is open and the plant is on the apron and the assessor has had his
 * minute.
 *
 * `elapsedSinceArmed` is the hold: the Director evaluates this trigger twice,
 * once with the timer forced true to decide whether the other two conditions
 * hold — which sets or clears the arm tick — and then once for real. So a lot
 * walked off at second forty starts the weighing again from the top, which is
 * what Cregg says on `t.terms` and what the `stepped out` row of the Director
 * run in the header measures.
 */
const WEIGHED: Condition = {
  on: 'all',
  of: [{ on: 'elapsed', ticks: COUNT_OPENS }, ON_COUNTER, { on: 'elapsedSinceArmed', ticks: WEIGHING }],
};

const op: OperationDef = {
  id: 'reclamation.08.contra-entry',
  chapter: 'reclamation',
  faction: Faction.Reclaim,
  /*
   * THE MERIDIAN, AND THEY ARE THE ONLY CLAIMANT THE CHAPTER HAS EARNED.
   *
   * `reclamation.05.closing-entry` is where Calvane bids for the account and is
   * refused; his objection — one book in one hand with no second copy anywhere
   * is not a record, it is an assertion — is what `reclamation.06.in-duplicate`
   * concedes, and the bond's rule is that anything lodged may be read by
   * anybody who asks. The party that asked for the copy is the party that reads
   * it back, and they are entitled to what they find. Any other claimant would
   * have to be handed the book by coincidence.
   *
   * Every scripted key on seat 1 is a literal Meridian `mrdWayfarer` or
   * `mrdSolarch`, which `validateCampaign` checks against the army of the seat
   * it lands on.
   */
  foe: Faction.Meridian,
  index: 8,
  title: 'Contra Entry',
  beat: 'Eleven months of notes say what we took as carefully as what we were owed, and they have read the copy.',
  /*
   * RACE. The chapter has spent assault, economy, capture-hold, infiltrate,
   * defend, escort and fixed-force, and `validateCampaign` refuses two adjacent
   * operations in one chapter that share a `primaryType` in any case. It is
   * honest rather than convenient: the primary is a delivery against a stated
   * hour with a stated whistle, and the only two things the player controls are
   * WHEN they cross and what they still own when they do.
   */
  primaryType: 'race',
  /*
   * Objective state in all three directions, spawns, orders, a reveal,
   * dialogue, EVA, a camera move and an outcome — `types.ts` calls that
   * "multiple effect kinds", and this is TEN of the eleven.
   *
   * The one that goes unused is `grantCredits`, and that is not an oversight:
   * the `waiting` secondary pays a thousand through `ObjectiveDef.credits`, so
   * `CampaignSession.setObjective` grants it on the completion — which is what
   * puts it in the `paid` set, which is the anti-save-scum rule. An effect would
   * pay it again on every reload.
   */
  archetype: 'bespoke',
  parSec: 1200,
  requires: ['reclamation.07.payment-in-kind'],

  map: {
    /*
     * URBAN ON BOTH LINES, WHICH IS THE PAIRING THAT CANNOT MAKE R3's MISTAKE.
     * `MAP_PRESETS` and `BiomeName` overlap on `temperate`, `snow` and `urban`
     * and disagree on exactly one name — the preset is `arid`, the biome is
     * `desert` — and `reclamation.03.sold-twice` shipped on the wrong side of
     * that and measured two headers' worth of numbers against ground it had not
     * declared. This pair is the same word twice.
     *
     * A breaking yard is a yard district, and the district operations of this
     * chapter (R5, R6) are on this preset. R7 is temperate, so this is not a
     * third in a row — the run the layout of `reclamation-payment-in-kind`
     * refused.
     */
    preset: 'urban',
    /**
     * The district lot number in the briefing, and the seed the layout swept
     * for: of twelve rolls scored on the approach band a wheeled hull has to
     * walk, it is the least broken — 56 blocked samples of 1100 against a
     * next-best 72 — and that is a screen on the LANDFORM rather than a claim
     * about the route. See the layout's header for the table and for what the
     * built road actually costs.
     *
     * Pinned by `tests/campaign-maps.spec.ts` as a terrain fingerprint: a
     * generator change that re-rolls this ground moves every measured placement
     * in both headers.
     */
    mapSeed: 27_884,
    /*
     * IMPORTED FROM THE LAYOUT, WHICH OWNS IT. `simSeed` decides which two
     * corners the match is played in, and every point the trigger table below
     * names is computed from exactly that at module load, out of `seatedSlots`,
     * `SKIRMISH_START_OFFSETS` and `MAP_SIZE`. Writing the number here as well
     * would be the same fact in two files, and the failure — a counting apron
     * framing open country — is invisible to every gate.
     */
    simSeed: SIM_SEED,
    armies: 2,
    biome: 'urban',
    /*
     * `base`. The yard is a working breaking yard and the operation is about
     * what it can afford to hand over, so it has a refinery, a queue and an
     * economy. `'force'` is what R7 needed and would be wrong here: a party that
     * cannot replace a Grinder cannot be asked to give up its artillery.
     */
    opening: 'base',
    /*
     * 5 000, matching `reclamation.05.closing-entry` and
     * `reclamation.06.in-duplicate`, and `Shell.applySimPostBoot` writes it into
     * every non-Neutral slot, so it binds the Meridian too. Half the skirmish
     * default for CLAUDE.md's measured reason: a brain with a 10 000 opening
     * puts up a seven-building base and eleven troops by t+90 s having mined
     * nothing.
     *
     * The three stacks are worth 900 credits a minute on top of it, to whoever
     * still holds them.
     */
    credits: 5_000,
  },
  layout: 'reclamation-contra-entry',

  // NEITHER SHIPPED RULE MAY END THIS. See the header.
  outcome: { annihilationWin: false, assetLossDefeat: false, ignoreSeats: [] },

  roster: {
    /*
     * `unit.specialist` IS WHAT LETS THE OPERATION'S OWN CURRENCY EXIST, and
     * `struct.tech` being absent is what stops the player minting more of it.
     * See the header: measured against an unrostered control build, this list
     * withholds `rclCrucible` and `rclPylon` from seat 0.
     */
    player: ['unit.raider', 'unit.specialist'],
    /*
     * EMPTY, and measured against an unrostered control build it removes
     * `mrdReliquary`, `mrdHelios` and two `mrdSkiff` from the Meridian opening.
     *
     * **THE RELIQUARY IS THE ONE THAT MATTERS AND THE SPIRE IS NOT, WHICH IS
     * THE OPPOSITE OF WHAT THIS COMMENT SAID BEFORE IT WAS CHECKED.** The first
     * version argued that a Helios Spire would reach the counting apron; it
     * would not, and the arithmetic says so in one line. A Spire only ever
     * stands where `ALLIED_DEFENCE`'s `prismTower` slot puts it, which is the
     * Meridian opening — 121.92 m from the nearest routable apron cell, against
     * an acquisition envelope of `33 x 1.08 + 2.880` = 38.52 m of centre
     * distance. It is 83 m short. (Two corrections. The draft had subtracted the
     * envelope from the distance and called the REMAINDER "inside the disc",
     * which is the same number with the sign of the conclusion reversed. And
     * 127.56 m was measured from (126, 138) — the requested point MINUS the
     * placement snap rather than plus it. `prismTower` is 1x1 like the three
     * `mrdGlaive` that share `ALLIED_DEFENCE` with it, and on this build all
     * three of those land at requested + (2, 2): (128, 108) -> (130, 110),
     * (128, 124) -> (130, 126), (128, 156) -> (130, 158). A Spire would stand
     * at (130, 142). 75 cells of `COUNTER_AREA` are Wheel-open and the nearest
     * of them is 121.92 m away. Counterfactual either way, and the conclusion
     * is robust; the provenance of the number is now known.)
     *
     * What the empty list actually buys is the TECH BUILDING. `mrdZenith` is
     * `unit.specialist` and its prereqs are `['mrdForgeyard', 'mrdReliquary']`,
     * so with no Reliquary on the ground the brain cannot field one at all —
     * and a Zenith is the only hull on that seat that answers a Slaghurler in
     * kind: `zenithBeam` is 94 of `WarheadClass.Prism` on a 2.9 s cooldown,
     * which is `94 x ARMOR_MATRIX[Prism][Light] 0.95 x 0.80 / 2.9` = 24.63 dps
     * against a 230 hp lot. Against an opponent earning through a twenty-minute
     * match that is a siege line the four lots cannot walk past. The two Skiffs
     * are the smaller half of the same point: 9.2 m/s raiders on a map whose
     * primary is four 4.6 m/s hulls crossing 146.80 m of open road.
     */
    ai: [],
  },

  objectives: [
    {
      id: 'entry',
      kind: 'primary',
      /*
       * THE ONLY SENTENCE THE PLAYER GETS. `ObjectiveRow` is
       * `{ id, title, kind, status }` — no description, no tooltip — so the bar
       * has to be in it: which plant, where it goes, and that there is a
       * deadline. What is NOT in it is the near bend, the opening hour, the
       * forty-five second weighing and the eleven metres, and those are
       * `t.road`, `t.terms`, `t.screen` and `t.security` — unconditional, at
       * twenty-five, thirty-two, forty-six and sixty seconds.
       */
      title: 'Put three of the lots on the assessor\'s counter before the count closes',
    },
    {
      id: 'waiting',
      kind: 'secondary',
      /*
       * PAID, AND PAID EARLY ENOUGH TO SPEND. `validateCampaign` refuses credits
       * on a primary and allows them here; a thousand at minute nine is eleven
       * minutes of Grinders, which is the whole reason this row is the one that
       * pays and `stacks` is not. `reclamation.07.payment-in-kind` left both of
       * its secondaries unpaid because seat 0 had no queue to spend a grant on.
       * This yard has one.
       */
      title: 'Have a lot standing on the counter when the count opens',
      credits: 1_000,
    },
    {
      id: 'stacks',
      kind: 'secondary',
      hidden: true,
      /*
       * NO `credits`, AND NOT BECAUSE THE VALIDATOR WOULD REFUSE THEM. This row
       * resolves on the WINNING TICK — it is conjoined with `WEIGHED`, exactly as
       * `reclamation.07.payment-in-kind`'s `whole` is conjoined with its
       * discharge — so a grant would arrive after the last thing it could buy
       * has stopped mattering. What it pays is the medal: `medalFor` gives
       * silver only when every secondary is complete.
       *
       * READ AT THE END RATHER THAN LATCHED, for R7's measured reason: a bare
       * `ownerCount(0, ..., min: 3)` would complete the moment the operation
       * began, and `setObjective` refuses to un-resolve a resolved row, so the
       * medal would be paid to a player who lost all three at minute eleven.
       */
      title: 'Finish with all three ore stacks still on our books',
    },
  ],

  triggers: [
    /* -- the claim, in two beats -------------------------------------------
     * Split across fourteen seconds because the shell renders dialogue as
     * toasts and four at once is a stack nobody reads — and because two
     * speakers inside six seconds is exactly the case `Shell.campaignBeatSeq`
     * was written for, so both halves of each beat really do arrive.
     */
    {
      id: 't.open',
      when: { on: 'elapsed', ticks: seconds(4) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Calvane, intercepted',
          text: 'To the Reclamation, Survey 27-884. A contra entry against your delivery '
            + 'account: one consignment of Pact plant lifted off a stranded convoy in the March '
            + 'and entered in your own book as received. Your figures, your hand, your bond '
            + 'store. We are content to settle it in kind at your own valuation.',
        },
        {
          do: 'dialogue',
          speaker: 'Tallow',
          text: 'He is right, and he is right out of our own ledger. That is what we bought when '
            + 'we made the copy — a book anybody can check, checked. We pay this one on their '
            + 'entry and we pay it today, because a firm that honours a checkable account only '
            + 'when the arithmetic runs its way has an unchecked account with extra steps.',
        },
      ],
    },
    {
      id: 't.brief',
      when: { on: 'elapsed', ticks: seconds(18) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Tallow',
          text: 'It comes out of the lot pen. Four Slaghurlers standing in the yard and the '
            + 'entry takes three of them, valued as they stand. The Crucible is at Depot Two and '
            + 'this yard cannot build another, so what is in the pen is the whole of the money.',
        },
        { do: 'revealArea', player: 0, area: COUNTER_AREA },
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'Their assessor sits at the district weighbridge, half way up the road. He signs '
            + 'for what is standing on his apron and nothing else — not what we say we sent, not '
            + 'what we left in the yard meaning to send.',
        },
      ],
    },

    /* -- the near bend -----------------------------------------------------
     * UNCONDITIONAL, AND IT IS THE ONLY THING THAT MAKES THE ROAD LEGIBLE.
     * `ObjectiveRow` is `{ id, title, kind, status }` and the primary's title
     * is about the counter, so a player who right-clicks the apron and watches
     * has no way of knowing that the SHORT route for two of the four lots spends
     * 50.76 m inside `POST_ONE`'s firing envelope, which is 1.60x what the gun
     * needs to kill one. That is the operation's declared slack, spent silently,
     * on the most natural input in the game.
     *
     * **ALL THREE ANSWERS ARE IN THE LINE AND THE THIRD ONE NAMES ITS ORDER.**
     * Pay the lot; go round for 18.06 m; or stop one short and shell the post,
     * which is `OrderKind.Attack` and NOT `AttackMove` — `Targeting.managesGoal`
     * refuses `AttackMoving`, so `approach()` early-returns and the hull drives
     * the whole way in. The header's standoff block is the arithmetic.
     *
     * **TWENTY-FIVE SECONDS, WHICH IS NOT AS EARLY AS IT COULD BE, AND THE COST
     * OF THAT IS MEASURED.** On the descent the engine builds, the first lot
     * enters the post's envelope 8.76 s after it is ordered and the first one
     * dies 15.6 s after — so a player who right-clicks on the opening tick meets
     * the post before this beat. What that costs is ONE lot: the post is a
     * single-target gun with no `splashRadius`, it holds a legal target for
     * 11.75 s end to end, and 392.7 damage is one 230 hp hull dead and 67 hp
     * left on the next. `t.short` reads two gone. Crowding it into `t.open` or
     * `t.brief` would put a third beat on a tick that already carries two, for a
     * case that costs the slack rather than the operation.
     *
     * Tallow rather than Cregg because `t.brief` ends in Cregg's voice and
     * `t.terms` opens in it, and because pricing a road is the thing this
     * character does. `Shell.campaignBeatSeq` means the beat either side of it
     * really does arrive, which is exactly why the gaps are 7 s and not 2.
     */
    {
      id: 't.road',
      when: { on: 'elapsed', ticks: seconds(25) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Tallow',
          text: 'And they have left a repeater post on the near bend of that road, which is them '
            + 'pricing the trip rather than closing it. It reaches twenty-four metres and a '
            + 'hurler reaches forty, so stop one short and shell it flat. Take the near lots '
            + 'straight past instead and it has one off us; the way round costs under twenty '
            + 'metres.',
        },
      ],
    },

    /* -- the terms, in three beats rather than one -------------------------
     * UNCONDITIONAL, AND THE SPLIT IS A MEASUREMENT RATHER THAN TASTE. All
     * three lines were one trigger at thirty-two seconds until the real
     * `runDirector` was driven through this file: the tick emitted three beats
     * with two Cregg lines back to back, which is trap 26's shape at the
     * opening instead of at the ending. `Shell.campaignBeatSeq` means they all
     * arrive now, which is exactly why they have to be paced.
     *
     * `t.security` is the only thing in the file that calls
     * `setObjective('stacks')`, so whatever fires it decides whether the hidden
     * secondary is ever on the panel at all — and `runDirector` evaluates
     * nothing once an outcome is set. An `elapsed` at fifty seconds is reached
     * by every ending this operation has: the earliest authored one is the
     * count opening at minute nine, and the earliest reachable one is `t.short`,
     * which needs a player to lose two Slaghurlers to a picket they were told
     * about.
     *
     * The three mechanisms a player cannot see anywhere else are here: the
     * opening hour, the forty-five second weighing, and the eleven metres a
     * Slaghurler cannot shoot inside. Trap 23 is a beat on a conditional trigger
     * that some endings never reach.
     */
    {
      id: 't.terms',
      when: { on: 'elapsed', ticks: seconds(32) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'Their count sits from the ninth hour to the whistle, and there is nobody to '
            + 'sign before it opens. Three lots on the apron together, and leave them there — '
            + 'the weighing takes a minute, and if one walks off it starts again from the top.',
        },
      ],
    },
    {
      id: 't.screen',
      when: { on: 'elapsed', ticks: seconds(46) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'Walk them across with a screen. A hurler throws forty metres and cannot answer '
            + 'anything inside eleven, so a lot on its own with Pact infantry on it is not '
            + 'damaged, it is gone, and we only have one spare.',
        },
      ],
    },
    {
      id: 't.security',
      when: { on: 'elapsed', ticks: seconds(60) },
      then: [
        { do: 'setObjective', id: 'stacks' },
        {
          do: 'dialogue',
          speaker: 'Tallow',
          text: 'And they will take security in the meantime, which is their right and is why '
            + 'their working is already on the road. The three stacks on the apron are the '
            + 'yard\'s income and they are not part of this entry. Finish the day still holding '
            + 'them.',
        },
      ],
    },

    /* -- the first working -------------------------------------------------
     * Minute two and a half, unconditional. A wave that fires only when the
     * player is elsewhere reads as the map cheating; a schedule the world keeps
     * regardless reads as an opponent, which is `soviets.03.deep-sector`'s
     * argument about scripted waves on an AI seat.
     *
     * `AiBrain.regroupSquads` files every untagged hull the seat owns into a
     * squad on its next pass, so the attack-move is the first thing these six do
     * and the brain owns them afterwards — the honest limit of what a scripted
     * wave buys.
     *
     * LITERAL MERIDIAN KEYS. `EffectSink.spawnUnits` resolves through
     * `ProductionCatalog.byKey` and remaps nothing, unlike the layout's
     * `ScenarioBuilder.spawnUnit`; `validateCampaign` checks each key against the
     * army of the seat it lands on, so a Reclamation key here is a build error.
     *
     * The `eva` lands BEFORE the event rather than on it, which is the only way a
     * scripted one earns its place: `audio.system.ts` already speaks
     * `forcesUnderAttack` on any attack, and this column has 259.01 m to walk.
     */
    {
      id: 't.first',
      when: { on: 'elapsed', ticks: minutes(2.5) },
      then: [
        { do: 'eva', line: 'forcesUnderAttack' },
        {
          do: 'dialogue',
          speaker: 'Calvane, intercepted',
          text: 'A recovery party to the yard, please, and tell them to be civil about it. We '
            + 'are entitled to security while the account is outstanding and their ore stacks '
            + 'are the nearest thing to it. If the plant reaches the weighbridge they can have '
            + 'the stacks back.',
        },
        {
          do: 'spawnUnits', player: 1, key: 'mrdWayfarer', count: 4, at: ROAD, spread: 12, tag: 'party',
        },
        {
          do: 'spawnUnits', player: 1, key: 'mrdSolarch', count: 2, at: ROAD, spread: 18, tag: 'party',
        },
        { do: 'orderTagged', tag: 'party', order: 'attackMove', at: STACK_TWO },
      ],
    },

    /* -- the first stack ---------------------------------------------------
     * `SETTLE`-guarded because `max: 2` reads TRUE against an empty registry.
     * A beat rather than an objective transition: `stacks` resolves at the end,
     * for the reason its own block gives.
     */
    {
      id: 't.stackLost',
      when: {
        on: 'all',
        of: [SETTLE, { on: 'ownerCount', player: 0, role: 'building', tag: 'stack', max: 2 }],
      },
      then: [
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'They have had one of the stacks. That is three hundred a minute off the yard '
            + 'and it is legally taken, which is the part I cannot do anything about. Keep the '
            + 'other two and get the plant moving.',
        },
      ],
    },

    /* -- the second --------------------------------------------------------
     * Pointed at the forward stack, which is the one 133.64 m out and the
     * cheapest for them to reach. It joins the `party` tag rather than taking
     * its own, so one `orderTagged` re-points the survivors of both —
     * `EffectSink.orderTagged` issues ONE command per owner and every one of
     * them is seat 1.
     */
    {
      id: 't.second',
      when: { on: 'elapsed', ticks: minutes(6) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Calvane, intercepted',
          text: 'Second party to the forward stand. I would rather have the plant than the ore, '
            + 'and I would rather have the ore than an argument about whether we were owed '
            + 'anything, so we will keep taking security until somebody signs.',
        },
        {
          do: 'spawnUnits', player: 1, key: 'mrdWayfarer', count: 4, at: ROAD, spread: 12, tag: 'party',
        },
        {
          do: 'spawnUnits', player: 1, key: 'mrdSolarch', count: 3, at: ROAD, spread: 18, tag: 'party',
        },
        { do: 'orderTagged', tag: 'party', order: 'attackMove', at: STACK_THREE },
      ],
    },

    /* -- the hour ----------------------------------------------------------
     * UNCONDITIONAL AT MINUTE EIGHT, and it carries the file's one
     * `cameraMove`. `types.ts` says the camera is for an arrival, a loss or a
     * reveal and not for punctuation; the count opening is the moment the
     * operation's second half begins and the only moment it needs the player
     * looking at the apron rather than at the yard. It costs them a beat of
     * whatever they were doing, which is the honest price and the reason there
     * is exactly one.
     *
     * A minute of warning is enough by measurement rather than by feel: the walk
     * from the pen to the apron is 30.8 to 41.2 s down the field `buildFlow`
     * builds, so a lot sent on this line arrives before the count opens — and it
     * still does on the 18.06 m detour round `POST_ONE`, which is 3.9 s more.
     */
    {
      id: 't.hour',
      when: { on: 'elapsed', ticks: minutes(8) },
      then: [
        { do: 'cameraMove', at: COUNTER },
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'Weighbridge opens in a minute. If there is a lot standing on that apron when he '
            + 'sits down he will take it first and credit us the demurrage, and demurrage on '
            + 'this account is a thousand.',
        },
      ],
    },

    /* -- the door ----------------------------------------------------------
     * BOTH ARMS EVALUATE ON THE SAME TICK AND EXACTLY ONE FIRES, because they
     * are a predicate and its negation over one world state — the Director
     * collects every matching trigger's effects before `CampaignSession.apply`
     * runs any of them, so this is deterministic rather than order-dependent.
     *
     * **EACH ARM CARRIES THE OTHER'S OUTCOME AS A GUARD, AND THAT IS NOT BELT
     * AND BRACES — IT IS THE FIX FOR A DEFECT THE DIRECTOR RUN FOUND.**
     * `elapsed` stays true forever and a non-repeat trigger that has not fired
     * is still armed, so the arm that lost at minute nine fires the moment its
     * own condition first holds afterwards. Measured: `t.waiting` announced
     * *"he has opened and there is Reclamation plant already standing on his
     * apron"* at 19:50 in the `late` row, ten minutes after `t.notWaiting` had
     * said the opposite. The session REFUSED the objective transition and the
     * DIALOGUE landed anyway, which is the general lesson — **a resolved row
     * protects the objective and nothing else.** `not(objectiveFailed(...))`
     * and `not(objectiveComplete(...))` are what actually close it.
     */
    {
      id: 't.waiting',
      when: {
        on: 'all',
        of: [
          { on: 'elapsed', ticks: COUNT_OPENS },
          { on: 'unitsInArea', player: 0, area: COUNTER_AREA, min: 1, tag: 'lot' },
          { on: 'not', of: { on: 'objectiveFailed', id: 'waiting' } },
        ],
      },
      then: [
        { do: 'completeObjective', id: 'waiting' },
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'He has opened and there is Reclamation plant already standing on his apron. '
            + 'That is the demurrage credited and the queue behind us, which on a district road '
            + 'is worth more than the money.',
        },
      ],
    },
    {
      id: 't.notWaiting',
      when: {
        on: 'all',
        of: [
          { on: 'elapsed', ticks: COUNT_OPENS },
          { on: 'not', of: { on: 'unitsInArea', player: 0, area: COUNTER_AREA, min: 1, tag: 'lot' } },
          { on: 'not', of: { on: 'objectiveComplete', id: 'waiting' } },
        ],
      },
      then: [
        { do: 'failObjective', id: 'waiting' },
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'He is sitting and we have nothing in front of him. The demurrage stands, and '
            + 'the count is open until the whistle — the entry can still be settled, it just '
            + 'costs us the thousand.',
        },
      ],
    },

    /* -- the third ---------------------------------------------------------
     * Same composition as the second and a different place: the LOT PEN. They
     * have stopped taking security and come for the goods themselves, which is
     * the escalation this operation has instead of a heavier wave — and it is
     * the one that can cost the player the operation, because `t.short` reads
     * three.
     */
    {
      id: 't.third',
      when: { on: 'elapsed', ticks: minutes(10.5) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Calvane, intercepted',
          text: 'Third party, and go to the pen rather than the stacks. If they will not walk '
            + 'the plant down to the weighbridge we are entitled to collect it where it stands, '
            + 'and I will enter whatever we break as settled at scrap.',
        },
        {
          do: 'spawnUnits', player: 1, key: 'mrdWayfarer', count: 4, at: ROAD, spread: 12, tag: 'party',
        },
        {
          do: 'spawnUnits', player: 1, key: 'mrdSolarch', count: 3, at: ROAD, spread: 18, tag: 'party',
        },
        { do: 'orderTagged', tag: 'party', order: 'attackMove', at: PEN },
      ],
    },

    /* -- the weighing ------------------------------------------------------
     * The count has started. A BEAT AND NOT AN OBJECTIVE TRANSITION: completing
     * `entry` here and winning on the hold is precisely the shape P06 costed and
     * rejected — `setObjective` refuses to un-resolve, so a player who stepped
     * off the apron would lose with the objective showing COMPLETE.
     *
     * **TALLOW RATHER THAN CREGG, AND THE REASON IS A MEASURED COLLISION.** A
     * player holding three lots on the apron at the moment the count opens fires
     * this and `t.waiting` on the SAME TICK — that is the best line in the
     * operation, so it is the one to check — and with both in Cregg's voice it
     * was one man answering himself two lines running. Driven through the real
     * `runDirector`, the `worst tick` row now reads Cregg, then Tallow.
     */
    {
      id: 't.weighing',
      when: { on: 'all', of: [{ on: 'elapsed', ticks: COUNT_OPENS }, ON_COUNTER] },
      then: [
        {
          do: 'dialogue',
          speaker: 'Tallow',
          text: 'Three on the apron and his man is weighing. Hold them there for the minute. He '
            + 'signs for what is standing in front of him at the end of it, not for what was '
            + 'standing there when he started, and I would like this one signed.',
        },
      ],
    },

    /* -- the fourth --------------------------------------------------------
     * MINUTE FIFTEEN, POINTED AT THE COUNTER, and it is the whole reason the
     * window has a shape. The count opens at nine; a player who crosses between
     * nine and ten and a half is weighed in peace, and this is what a player who
     * dawdles is weighed under. `ROAD` is 93.02 m from the apron, which is thirty
     * seconds for a Solarch and closer to a minute for the infantry.
     */
    {
      id: 't.fourth',
      when: { on: 'elapsed', ticks: minutes(15) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Calvane, intercepted',
          text: 'Put the last party on the weighbridge road. Not on the assessor — on the road. '
            + 'If they are going to settle this at the last hour of the count they can do it '
            + 'with our people watching, which is no worse than what they did to the Works.',
        },
        {
          do: 'spawnUnits', player: 1, key: 'mrdWayfarer', count: 4, at: ROAD, spread: 12, tag: 'party',
        },
        {
          do: 'spawnUnits', player: 1, key: 'mrdSolarch', count: 3, at: ROAD, spread: 18, tag: 'party',
        },
        { do: 'orderTagged', tag: 'party', order: 'attackMove', at: COUNTER },
      ],
    },

    /* -- what the yard kept ------------------------------------------------
     * Both arms carry `WEIGHED`, so they resolve on the winning tick and only
     * there. `min: 3` needs no settle guard — a `min` threshold reads FALSE
     * against an empty registry, which withholds the secondary rather than
     * granting it — and `max: 2` is guarded by `WEIGHED`'s own `elapsed`.
     *
     * This trigger sits ABOVE `t.settle` so Cregg's line lands before Calvane's
     * and Tallow's. Order decides beat order and nothing else.
     */
    {
      id: 't.stacks',
      when: {
        on: 'all',
        of: [WEIGHED, { on: 'ownerCount', player: 0, role: 'building', tag: 'stack', min: 3 }],
      },
      then: [
        { do: 'completeObjective', id: 'stacks' },
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'Three lots signed away and all three stacks still ours. We have paid an account '
            + 'in full and kept the income that pays the next one, which is the first time this '
            + 'company has managed both in the same week.',
        },
      ],
    },
    {
      id: 't.notStacks',
      when: {
        on: 'all',
        of: [WEIGHED, { on: 'ownerCount', player: 0, role: 'building', tag: 'stack', max: 2 }],
      },
      then: [{ do: 'failObjective', id: 'stacks' }],
    },

    /* -- the settlement ----------------------------------------------------
     * The win. Both beats are on this trigger and the completion is on it too:
     * nothing else in the file touches `entry` except the two triggers that fail
     * it, which is what keeps the hold out of trap 26's way.
     */
    {
      id: 't.settle',
      when: WEIGHED,
      then: [
        { do: 'completeObjective', id: 'entry' },
        {
          do: 'dialogue',
          speaker: 'Calvane, intercepted',
          text: 'Weighed, signed and the contra entry discharged in full. For the record, and it '
            + 'will be on the record: they did not argue it. They read their own account back to '
            + 'them and paid what it said.',
        },
        {
          do: 'dialogue',
          speaker: 'Tallow',
          text: 'That is the first time the book has been used against us and it will not be the '
            + 'last, and I would sign the copy again tomorrow. An account nobody can check is '
            + 'worth what one party says. An account everybody can check is worth what it says — '
            + 'in both directions, and the second direction is what we are paying for today.',
        },
        { do: 'endOperation', result: 'win' },
      ],
    },

    /* -- the money is broken up --------------------------------------------
     * `SETTLE`-guarded, because `max: 2` reads TRUE against an empty registry.
     * It ends the operation the moment the entry can no longer be settled in the
     * coin it names, which is the `reclamation.06.in-duplicate` rule: a
     * threshold that has become unreachable must end the match rather than leave
     * the player eleven minutes of not being told.
     *
     * **IT CANNOT COLLIDE WITH `t.settle`, AND THAT IS ARITHMETIC RATHER THAN
     * TRIGGER ORDER.** The win needs three lots INSIDE the disc, which needs
     * three alive; this needs two or fewer alive. With exactly four on the map
     * the two conditions have no world state in common, so the ending tick
     * cannot carry both a win and a defeat — which is the failure
     * `reclamation.07.payment-in-kind` measured on its own ending and had to fix
     * with a conjoined `entityAlive`.
     */
    {
      id: 't.short',
      when: {
        on: 'all',
        of: [SETTLE, { on: 'ownerCount', player: 0, role: 'unit', tag: 'lot', max: 2 }],
      },
      then: [
        { do: 'failObjective', id: 'entry' },
        {
          do: 'dialogue',
          speaker: 'Tallow',
          text: 'Two hurlers left in the yard and an entry that names three. We cannot settle '
            + 'this in the coin their claim is written in, and a debtor who offers something '
            + 'else is a debtor who is arguing. Everything the copy bought us this month goes '
            + 'back on the argument.',
        },
        { do: 'endOperation', result: 'loss', reason: 'entry' },
      ],
    },

    /* -- the whistle -------------------------------------------------------
     * `not(ON_COUNTER)` rather than `not(WEIGHED)` because `validateCampaign`
     * refuses an `elapsedSinceArmed` under a `not` — it reads TRUE during the
     * arming pass, so the negation reads false and the trigger could never fire.
     *
     * THE PARTITION IS TOTAL AND THIS IS THE HALF THAT MAKES IT SO. After the
     * whistle this trigger stays armed: if three lots are standing on the apron
     * the weighing is running and completes within forty-five seconds, and the
     * only thing that can interrupt it — a lot leaving or dying — is the same
     * thing that makes this condition true. So every world state at or after
     * `CLOSE` reaches an `endOperation`, and the count genuinely finishes a
     * weighing it had already started, which is what an assessor does.
     */
    {
      id: 't.close',
      when: {
        on: 'all',
        of: [{ on: 'elapsed', ticks: CLOSE }, { on: 'not', of: ON_COUNTER }],
      },
      then: [
        { do: 'failObjective', id: 'entry' },
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'Whistle, and nothing of ours on his apron. The entry stands open, they will '
            + 'take the security they are holding against it, and the next firm that reads our '
            + 'book will read the line where we would not pay one.',
        },
        { do: 'endOperation', result: 'loss', reason: 'entry' },
      ],
    },

    /* -- the yard is gone ---------------------------------------------------
     * `playerBeaten` is `Viability.isBeaten` — nothing to build with and nothing
     * to fight with — which on a seat with a real base is the honest floor and
     * is not reachable by losing the pen alone. `t.short` is what covers that.
     */
    {
      id: 't.rout',
      when: { on: 'playerBeaten', player: 0 },
      then: [
        { do: 'failObjective', id: 'entry' },
        {
          do: 'dialogue',
          speaker: 'Tallow',
          text: 'The yard is finished and the entry is unpaid, which are two losses and only '
            + 'one of them is the plant. Write it up honestly. If we start keeping the account '
            + 'the way it suits us we have thrown away the only thing this company sells.',
        },
        { do: 'endOperation', result: 'loss', reason: 'entry' },
      ],
    },
  ],
};

export default op;
