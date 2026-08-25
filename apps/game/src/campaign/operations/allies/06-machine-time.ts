/**
 * ============================================================================
 * A6 — MACHINE TIME
 * ============================================================================
 * A5 took the room. This is the operation about what is in it.
 *
 * A hall of integrators is not a filing cabinet: it is the largest single
 * electrical load in the quarter, and a continental adjustment is seven minutes
 * of machine time that cannot be taken in pieces. A reduction that loses its
 * supply does not PAUSE. Every partial in the frames is scrap paper and the run
 * starts again at the first bench. The Allies own the apparatus, the field
 * returns and the rate series. They do not own the current.
 *
 * A2 made the point from the other end — instruments without their field
 * returns are furniture — and this is the third term nobody costed: the returns
 * and the room are both useless without an unbroken seven minutes of somebody
 * else's power station.
 *
 * ============================================================================
 * WHY `capture-hold`, AND WHY THE HOLD TIMER IS THE FICTION RATHER THAN A
 * TIMER BOLTED TO IT
 * ============================================================================
 * `elapsedSinceArmed` is the one condition in the frozen vocabulary that is not
 * a pure function of the world. `types.ts` describes it exactly: the Director
 * evaluates every trigger twice, once with the timer forced true to settle the
 * ARM tick and once for real, so losing the held thing at minute five of a
 * six-minute hold DISARMS AND RESTARTS THE CLOCK. Every other operation that
 * uses it treats that as a rule about ground.
 *
 * Here it is a rule about a machine, and the two are the same sentence: **a
 * computing run that loses its supply restarts from the beginning.** The
 * mechanic did not have to be adapted to the premise and the premise was not
 * written around a mechanic — they are one statement, which is the only reason
 * this operation is worth the type it spends.
 *
 * The chapter has spent escort, infiltrate, race, defend and assault, and A5
 * deliberately ended in no hold at all after three of the first four did. That
 * is what makes a hold fresh again here; `capture-hold` is also the honest name
 * for a primary whose two halves are literally a capture and a hold, and the
 * two-stage objective below says so out loud rather than hiding stage one
 * inside stage two.
 *
 * ============================================================================
 * THE LINE, AND WHAT EACH HOUSE COSTS — ALL OF IT MEASURED
 * ============================================================================
 * Six feeder houses on the quarter tramway, `civApartments` on the GAIA seat,
 * 800 hp of `ArmorClass.Concrete` each, and the hall draws through four of them.
 *
 * **EVERY ROUTE FIGURE IN THIS SECTION IS STALE AND HAS NOT BEEN
 * RE-MEASURED.** Both of the two start points it is taken from moved when
 * `bb83ffb` rebuilt the procedural bases on the placement grid, and they moved
 * a long way: the player's BARRACKS went from (84, 372) to **(88, 356)**, 16.5 m,
 * and `buildAlliedBase`'s free engineer went from (96.21, 376.84) to
 * **(98.00, 362.00)**, because its own local offset in `ALLIED_GARRISON`
 * changed from (-10, +7) to (-18, +10) in the same commit. Both landed
 * positions are read off `store.posX/posZ`; the (80.0, 375.3) door and its
 * (78, 370) cell were derived from the OLD barracks and are not re-derived
 * here. Every metre and every second in the two tables below, and the exclusion
 * control under them, is therefore a fact about a world that no longer exists.
 *
 * **DO NOT PATCH THE NUMBERS ONE AT A TIME.** They have to be re-taken together,
 * with the goal convention named — `FlowFieldCache.snapToReachable` of the house
 * centre, which is NOT the Euclidean-nearest open cell and disagrees with it by
 * about 1.6% on this ground. An instrument that cannot first reproduce one of
 * the surviving figures has no standing to replace the rest.
 *
 * **THE INSTRUMENT IS THE WALK, NOT THE HOUSE, AND THE FIRST VERSION OF THIS
 * TABLE WAS MEASURED FROM THE WRONG PLACE.** An engineer does not start at the
 * opening: the three bought ones come out of the BARRACKS DOOR, which
 * `ProductionService.tryEgress` puts at the barracks' own yaw and `exitOffsetZ`,
 * rotated, and which `findEgressSpot`'s fixed-order ring search then snaps to a
 * cell on the WEST face of the base. The free one `buildAlliedBase` spawns
 * stands about 20 m away, and the two are not interchangeable, because the base
 * is an obstacle and the way round it is not symmetric. Both are measured
 * below — on the pre-`bb83ffb` ground.
 *
 * Route: octile Dijkstra over the real
 * `FlowFieldCache.costGridFor(MoveClass.Foot)` on the world this operation
 * actually builds, minimising the ENGINE'S OWN cost — destination-cell weight,
 * diagonals `(nc * DIAG) | 0`, corner-cut refused — and reported in metres at
 * 4 m orthogonal and 5.657 m diagonal. Goal:
 * `FlowFieldCache.snapToReachable` of the house centre, which is what
 * `NavAssigner` is handed. **Contact: the first cell on that route at which
 * `CaptureService.withinReach` holds**, because `CaptureService.simTick` re-aims
 * at the target's own `posX/posZ` every tick and `resolve` fires the tick reach
 * first holds — wherever on the route that is.
 *
 *     house   landed       lane      free engineer        barracks door
 *       1     (216, 290)  140.6 m   202.9 m   59.7 s    254.1 m   74.7 s
 *       2     (240, 266)  174.4 m   264.6 m   77.8 s    268.2 m   78.9 s
 *       3     (268, 246)  208.7 m   268.5 m   79.0 s    289.1 m   85.0 s
 *       4     (296, 222)  245.6 m   306.4 m   90.1 s    327.1 m   96.2 s
 *       5     (332, 194)  291.2 m   371.1 m  109.1 s    374.7 m  110.2 s
 *       6     (360, 170)  328.0 m   409.0 m  120.3 s    412.6 m  121.4 s
 *
 * `lane` is the projection onto the line between the two openings; seconds are
 * metres over the engineer's `maxSpeed` 3.4, which is a floor because nothing
 * accelerates instantly. **The walk is not the straight line and the gap is the
 * finding**: the door stands 159.51 m from house one and the route is 254.1,
 * **+59.3%**, because `urban` is flat but not open and because the door faces
 * away from the tramway. Quoting the straight line would have every engineer in
 * this file arriving twenty-eight seconds early on the first house alone.
 *
 * **A GAIA STRUCTURE IS `Capture.ts` RULE 1: ONE ENGINEER, AT ANY HEALTH.** Not
 * the four A5 paid for an enemy-owned hall — the soften ladder is rule 2 and
 * does not apply here. So the line's price is arithmetic the briefing can quote:
 * the opening base ships ONE engineer (measured — `buildAlliedBase` spawns
 * exactly one), three more are 500 credits and ten seconds of barracks each, and
 * four houses is therefore **1 500 credits out of a 5 000 bank plus a walk of
 * sixty to ninety-six seconds.** The fifth is another five hundred, another
 * hundred and ten seconds — and a post, which is the next section and which the
 * first draft of this file priced at zero.
 *
 * **AND THERE IS A SECOND ROUTE THE OPERATION DELIBERATELY DOES NOT MENTION IN
 * THE BRIEFING, BECAUSE FINDING IT IS THE REWARD.** `GarrisonService.enter`
 * flips a NEUTRAL structure to the occupier by calling
 * `CaptureService.captureBuilding`, and `civApartments` clears every gate:
 * unarmed, no `IsBuilder`/`IsFactory`/`IsRefinery`/`IsRadar` bit, and a 2x3
 * footprint against `GARRISON.minFootprint` 2 on both axes. Five G.I.s at 200
 * credits hold a house for as long as they stand in it, shooting out of it at
 * `GARRISON.rangeBonus` +6 m and `GARRISON.damageMul` 0.9.
 *
 * The two routes are not interchangeable and the difference is the whole
 * operation:
 *
 *     engineer   500 cr, consumed, deed is PERMANENT
 *     squad     1000 cr, five men, deed reverts the instant the last one dies
 *
 * `releaseEmptied` restores the ORIGINAL owner when the occupant count reaches
 * zero, and it does not care whether the men walked out or were killed inside.
 * So a garrisoned house is a house whose deed can be shot off you, and shooting
 * it off you breaks the line and restarts the reduction. A player who garrisons
 * all four has bought a cheaper line and a worse one.
 *
 * **THE ORDER OF THE TWO ROUTES MATTERS AND GETS IT WRONG SILENTLY.**
 * `Capture.resolve` tests the FRIENDLY branch before anything else, so an
 * engineer sent at a house a squad is already holding is spent on a REPAIR —
 * `types.ts` records that residual under `captureProof` and it is reachable
 * here without any veto being involved. Squad first, then engineer, is five
 * hundred credits thrown away.
 *
 * ============================================================================
 * THE POSTS SHOOT THE HOUSE — AND, ON THE ROUTE THE ENGINE ACTUALLY DRAWS,
 * THE ENGINEER AS WELL
 * ============================================================================
 * Three `pillbox`-role posts, which `ScenarioBuilder.keyFor` resolves to
 * **Arcspitter Posts** on a Reclamation seat: `rclSpitpost`, 520 hp,
 * `postCoil` at range 20, `power: 0` so no brownout silences them. Two of them
 * stand over houses four and five; the third stands over the load meter.
 *
 * **THE FIRST DRAFT OF THIS SECTION MEASURED FOUR POINTS AND CALLED IT A WALK,
 * AND THAT IS THE DEFECT THREE VERIFIERS FOUND.** It tabulated the four CAPTURE
 * STANDS of each house against the posts and concluded that an engineer walks in
 * free. **`CaptureService.simTick` never chooses a stand.** It re-aims at
 * `st.posX/posZ` of the TARGET every tick, `NavAssigner` snaps that to
 * `snapToReachable(centre)`, and `resolve` fires the tick `withinReach` first
 * holds — wherever on the route that is. A stand table is a true statement about
 * four points that says nothing at all about the ground between them.
 *
 * The stand geometry is still worth having and is kept for what it is: a post
 * FIRES at `20 + st.radius` = `20 + 0.234` = **20.234 m** and ACQUIRES at
 * `20 * COMBAT_TARGETING.acquireRangeMul + 0.234` = **21.834 m**, against
 * `CAPTURE.reachMetres` 2.2 plus the same 0.234, so for a 2x3 footprint the four
 * stands sit 6.434 m out in x and 8.434 m out in z. Read off the built world:
 *
 *     house 4    W 17.70  N 15.91  COVERED     E 25.95  S 28.16  open
 *     house 5    W 17.70  N 15.91  COVERED     E 25.95  S 28.16  open
 *     houses 1-3, 6                            nearest post 34.30 m or more
 *     the meter  E 12.54  S 14.45  COVERED     W 22.75  N 21.59  open
 *     house 6    E 22.95  N 26.24  open        W 34.58  S 33.07  open
 *
 * Those are GUN-CENTRE to STAND-CENTRE distances, the quantity the 20.234 and
 * 21.834 circles are thresholds on. The table used to hold the SURFACE distance
 * — each entry 0.234 m smaller — and compare it against circles with that same
 * radius added; no verdict changes, and the arithmetic is now self-consistent.
 * House six has its own row because `bb83ffb` moved the Reclamation's three
 * base `rclSpitpost` and put one of them 22.95 m from its east stand.
 *
 * The meter's north stand at 21.59 m is outside the firing circle and inside
 * acquisition, so a post tracks a man there and never pulls — the behaviour
 * `allies-forced-closure` records for its west-north-west stand, and worth
 * knowing before somebody reads a turret following their engineer as a bug.
 *
 * **NOW THE WALK, MEASURED THE WAY THE ENGINE DRAWS IT.** Metres spent inside a
 * seat-1 firing circle before the capture resolves, minimised and maximised over
 * the shortest routes to the goal `snapToReachable` returns, from both engineer
 * starts:
 *
 *     house 1-3                     0.0 m from either start
 *     house 4    free engineer      0.0 m        barracks door  21.0 - 35.3 m
 *     house 5                      36.0 - 81.9 m from both starts
 *     house 6                      28.0 - 93.3 m from both starts
 *     the meter                    45.7 - 97.3 m from both starts
 *
 * `postCoil` delivers 34 x `ARMOR_MATRIX[Tesla][Infantry]` 1.60 x
 * `globalMul` 0.80 = **43.52 a pull** on an 0.85 s cooldown, so three pulls kill
 * a 90 hp engineer and the third lands **1.70 s** after the first. The BEST case
 * for house five is 36.0 m, which is **10.6 s** at 3.4 m/s — six times over.
 *
 * **HOUSE FOUR IS A NEAR-TIE AND THAT IS THE PART TO KNOW.** From the free
 * engineer's spawn the engine wraps the house on its SOUTH face and the walk is
 * clean; from the barracks door, twenty metres away, it wraps NORTH — where post
 * #1 stands — and spends 21.0 m, 6.2 s, inside a gun that needs 1.70. Nothing in
 * the stand table predicts that and nothing on screen announces it.
 *
 * **THE EXCLUSION CONTROL IS THE INSTRUMENT THAT SETTLES IT** (CLAUDE.md trap
 * 18): re-run the same fill with all **434** cells within 20.234 m of a seat-1
 * gun marked impassable — the three line posts AND the three `rclSpitpost` in
 * the Reclamation's own base, because closing some guns and not others measures
 * a third map — and take the cheapest capture cell either way. From the barracks
 * door:
 *
 *     houses 1-3   239.8 / 253.8 / 280.2 m   unchanged      +0.0 m
 *     house 4      318.1 m                   318.1 m        +0.0 m
 *     house 5      369.0 m                   430.6 m       +61.5 m  (+18.1 s)
 *     house 6      403.6 m                   416.9 m       +13.3 m  (+3.9 s)
 *     the meter    421.3 m                   441.2 m       +19.9 m  (+5.9 s)
 *
 * So **house four is recoverable for nothing** — the safe south face is 318.1 m,
 * which is 9.0 m NEARER than the 327.1 the engine's own route spends getting to
 * its first capture cell, so hand-walking the engineer round the far side is
 * both free and faster. **The two secondaries are not**: a fifth house and the
 * meter cost either a hand-routed detour of +61.5 m / +19.9 m or post #2 and
 * post #3 dead first. That is priced in the two secondaries below, and the
 * briefing says it out loud, because there is no cursor that could.
 *
 * **AND AGAINST THE HOUSE THEY ARE STILL A FORTY-ONE-SECOND CLOCK.**
 * `Combat.engage` fires when `max(0, flat - hitRadius(target)) <= w.range`, and
 * `hitRadius` for a 2x3 footprint is the half-diagonal `sqrt(4^2 + 6^2)` =
 * **7.211 m**. Each post stands 21.260 m from its house's centre, so the surface
 * distance is **14.049 m against a range of 20** — comfortably inside. A Gaia
 * house is allied to everybody and cannot be shot; **the tick the player takes
 * it, it becomes a legal target for the post standing over it**, at
 * `postCoil` 40.00 raw x `ARMOR_MATRIX[Tesla][Concrete]` 0.60 x
 * `COMBAT_DAMAGE.globalMul` 0.80 = **19.20 dps**, which is 800 hp in
 * **41.7 seconds**.
 *
 * So the post denies house four twice — once on the road the engine picks, once
 * on the deed — and both stages are the same 520 hp of Concrete: a Warden's
 * `lightCannon` delivers 16.13 dps against it (36.67 raw x AP-vs-Concrete 0.55 x
 * 0.80), so one Warden needs 32.2 s and the opening four need **8.1 s**.
 *
 * ============================================================================
 * THE WRENCH IS A THIRD ROUTE, AND THIS FILE USED TO SAY THERE WERE TWO
 * ============================================================================
 * The sentence above this section used to read *"cannot be HELD without killing
 * the post first"*, and the word **cannot** is measurably false.
 * `RepairSell.setRepairing` refuses anything that is not the caller's own
 * finished, damaged Building — `kind`, `owner`, `Alive`, not
 * `PendingDestroy | UnderConstruction`, `hp < maxHp` — **and nothing else.**
 * There is no def test, no `Sellable` test and no civilian test, and
 * `input.system.ts#applyArmedTool` gates the wrench click on exactly the same
 * two things. A captured feeder house is the player's own finished Building, so
 * the wrench takes.
 *
 * `REPAIR_RATE` is 30 hp/s at `REPAIR_COST_PER_HP` 0.25 against the post's
 * 19.20, so it wins by **+10.80 hp/s** while the house is hurt and settles at
 * **4.80 credits a second** once the house is pinned at full — **2 016 credits
 * across a seven-minute run**, 40% of the opening bank, to hold one house
 * against one post without firing a shot.
 *
 * **IT IS A ROUTE AND IT IS THE WORST OF THE THREE, AND THE REASON IS A LINE IN
 * `tickRepairs`.** That loop clears the flag the tick a structure reaches full
 * health, and `setRepairing` refuses a structure already at full — so this is
 * not a wrench you leave on. One pull lands 16.32 hp (34 x 0.60 x 0.80); the
 * drip closes that at 1.0 hp a tick, so the deficit is gone in **17 ticks
 * (0.567 s)**, the flag is cleared on the 18th, and the next pull is **0.25 s**
 * later. Holding a house this way is a click every 0.85 s, for ever, per house.
 * Against that the opening ships four Warden Tanks — 2 800 credits of hull
 * nobody bought — that end the argument in 8.1 s.
 *
 * The `capture-hold` framing survives all of it. What does not survive is the
 * word *cannot*, and it is corrected rather than defended.
 *
 * ============================================================================
 * THE FLOOR ON THE ARM, WHICH IS WHAT THE EIGHTEEN MINUTES ARE MEASURED AGAINST
 * ============================================================================
 * `RUN` is seven minutes and `CLOSE` is eighteen, which is `parSec` to the
 * second. The earliest the line can be made is a FLOOR rather than a
 * prediction, and it is worth writing down because it is what the eighteen
 * minutes are measured against: `engineer` is `buildTime` 10 with a barracks
 * AND a refinery standing at t=0 and `BuildQueue.advanceTab` only ever advances
 * `items[0]`, so three leave the door at 0:10, 0:20 and 0:30 while the free one
 * is already standing at (98.0, 362.0). Give the free engineer the longest walk
 * and the bought ones the rest in descending order and the last house lands at
 * **0:30 + 74.7 = 1:44.7**; the earliest possible win is therefore **8:44.7**.
 *
 * **THAT FLOOR ASSUMES HOUSE FOUR IS HAND-ROUTED, WHICH IS WHY IT IS A FLOOR
 * AND NOT AN ESTIMATE.** The free engineer's own route to house four is clean
 * and 306.4 m; the bought ones' is not, so a commander who simply clicks the
 * house with a barracks engineer loses him on the north face. And a line made at
 * 1:44.7 with post #1 still standing expires 41.7 s later. Every real arm is the
 * walk plus however long it takes to put 520 hp of Concrete down.
 *
 * ============================================================================
 * THE BUDGET IS A DEADLINE, NOT A COUNT, AND THIS SECTION SAID THE OPPOSITE
 * ============================================================================
 * It read *"ONE INTERRUPTION IS AFFORDABLE AND TWO ARE NOT"* and offered a table
 * of `A + B + R + 7:00 <= 18:00`. **Measured against the real `runDirector`,
 * count is irrelevant.** `state.armedAt` is SET on the first tick the arming
 * pass holds and DELETED on any tick it does not, so the arm tick is always the
 * LAST re-arm — every earlier break is erased from the arithmetic the moment the
 * line is remade. `t.win` fires at `armTick + RUN` and `t.deadline` at
 * `elapsed >= CLOSE`, so the whole of the tuning is one subtraction:
 *
 *     32 400 - 12 600 = 19 800 ticks = 11:00.000
 *
 * **THE LAST BREAK MUST END BY MINUTE ELEVEN. Nothing else about breaks
 * matters.** Twelve one-tick breaks before 11:00 still win; one break that ends
 * at 11:00 and a thirtieth of a second loses. An arm at exactly 19 800 fires
 * `t.win` on tick 32 400 alongside `t.deadline`, and `t.win` is above it in the
 * table, so `Session.end`'s first-wins rule hands the player the win.
 *
 * **SEVEN MINUTES IS RE-DERIVED FROM THAT RULE RATHER THAN FROM THE OLD ONE.**
 * `CLOSE - RUN` is the wall the last re-arm has to beat, and against a 1:44.7
 * floor that is **9:15.3 of slack**, falling to 5:00 for a commander who does
 * not make the line until minute six. Long enough that a commander who loses the
 * line before minute eleven can remake it — however many times — and short
 * enough that one still fighting for it AT minute eleven has lost the operation
 * whatever happens afterwards. That, and not a count of interruptions, is what
 * makes the `spare` secondary worth five hundred credits and a post: a fifth
 * house is what keeps a lost house from becoming a re-arm, and it is a re-arm
 * after minute eleven that ends the operation.
 *
 * ============================================================================
 * THE FOE IS THE RECLAMATION, AND IT IS THE PREMISE RATHER THAN VARIETY
 * ============================================================================
 * The Ninth is still the antagonist — they bought the quarter's week and they
 * are why nobody will sell the Allies a kilowatt — but they are not on this
 * ground. The plant went to the Reclamation with everything else breakable at
 * the Split, and Cregg sells current by the hour to anybody with an account.
 * That is the chapter's own argument arriving from a direction it has not come
 * from before: **the schedule is decided by whoever owns the plant, not by
 * whoever is right**, and a party that sells access is the only one who can
 * teach that.
 *
 * It is also what sets up the hinge. At the end of this operation the Allies
 * can PRODUCE the corrected schedule and still cannot publish it, because
 * owning a truth and owning the means to move it are two different purchases —
 * which is the lesson this operation charges them for in current and the next
 * one charges them for again in something else.
 *
 * A3 is the chapter's other non-Soviet operation. `validateCampaign` says
 * nothing at all about `foe` — it refuses only an adjacent `primaryType`
 * repeat — so nothing mechanical is checking this line and it is argued here
 * instead. Every scripted wave is a literal `rclPicker`, `rclSlagger` or
 * `rclGrinder`, which the validator refuses on any seat that is not
 * Reclamation, and the layout puts the meter and three posts on seat 1.
 *
 * ============================================================================
 * THE ROSTER, MEASURED AGAINST A CLEARED CONTROL
 * ============================================================================
 * Empty on both sides, which is an ALLOW-LIST refusing every `UNLOCK_TAGS` def
 * to both seats. Two builds, identical but for `setCampaignRoster`:
 *
 *     the player loses      2 Sabre IFVs, a Refractor Tower, a Proving Ground
 *     the Reclamation       2 Arcspitters, an Arc Pylon, a Crucible
 *
 * **THE ARC PYLON IS THE ONE THAT MATTERS AND IT IS THE SAME ARGUMENT
 * `allies-forced-closure` MADE ABOUT A TESLA COIL, RE-DERIVED FOR THIS ROW.**
 * `rclPylon` is `struct.defence.specialist`, reaches **28 m**, and one trigger
 * pull is `pylonArc` 94 damage x `ARMOR_MATRIX[Tesla][Infantry]` 1.60 x
 * `globalMul` 0.80 = **120.32** against an engineer's **90 hp** — a man a pull,
 * with three chain links behind it. `Placement.withinBuildRadius` gives a
 * finished non-builder structure `PLACEMENT.adjacencyRadius` 20 m plus its own
 * radius, so the Reclamation could found one within about 26 m of any house
 * they still stand near and close **every** capture stand on it, including the
 * open ones this operation is walked through. Withheld, the longest structure
 * weapon either army can put on the tramway is `postCoil` at 20 m, which is the
 * three posts the layout already placed.
 *
 * The player's half follows from the same allow-list rather than from
 * generosity, and it is the right shape: the answer this operation wants to the
 * question "how do I hold four points at once" is `pillbox` — untagged, 400
 * credits, `power: 0`, 22 m — and it is still there.
 *
 * ============================================================================
 * TWO PRIMARIES, AND WHY THE SECOND ONE IS HIDDEN
 * ============================================================================
 * `line` completes the moment four houses are on the works; `run` is revealed
 * by the same trigger and is the seven minutes. `medalFor` reads SECONDARIES
 * only, so a second primary costs the medal nothing — what it buys is a HUD
 * that says which half of the operation the player is in, and a readable latch.
 *
 * **THE LATCH IS LOAD-BEARING.** `t.broken` has to say "the run has stopped"
 * and must not say it while the player is still climbing from one house to
 * four — and `ownerCount(max: 3)` is TRUE of an empty world, which is the
 * `entityDead`-before-the-tag trap wearing a third costume. Conjoining
 * `objectiveComplete: 'line'` is the guard, and it is exact rather than a
 * settle timer: the row cannot read `complete` until four houses have actually
 * been held. A `SETTLE` on the clock would have been a guess.
 *
 * ============================================================================
 * WHAT ENDS THE MATCH, IN BOTH DIRECTIONS
 * ============================================================================
 * Both shipped outcome rules are off, so all four routes are authored:
 *
 *     t.win        four houses held for seven minutes together      WIN
 *     t.deadline   elapsed >= 18:00                                 LOSS
 *     t.hallLost   settle + the Allies own no 'hall'                LOSS
 *     t.beaten     settle + playerBeaten seat 0                     LOSS
 *
 * `annihilationWin` is off because it is not merely late here, it is WRONG:
 * razing the Reclamation would satisfy `Shell.pollOutcome` at any point in the
 * run, and the operation would report a victory for the one thing it is not
 * about — the reduction is a clock, and killing the opponent does not advance
 * it by a tick. `assetLossDefeat` is off because a commander
 * whose base is gone and whose four houses are still on the line is not beaten
 * — that is exactly the last act this operation would like to keep, and
 * `pollOutcome` would end it at 2 Hz.
 *
 * **`t.hallLost` READS `ownerCount`, NOT `entityDead`, AND THE DIFFERENCE IS A
 * CAPTURE.** Seat 1 opens holding an `rclTinker` — measured, it is what
 * `buildAlliedBase`'s single engineer resolves to through `keyFor` on a
 * Reclamation seat — so a player-owned hall is capturable in practice now that
 * the brain can issue `OrderKind.Capture`. `entityDead` would read FALSE on a
 * hall that had changed hands and the
 * operation would run on with the machine in somebody else's name.
 * `ownerCount(player 0, ..., max: 0)` covers demolition and capture with one
 * clause, so **no `captureProof` is needed anywhere in this file** — every
 * trigger that could be capture-blind is written as an ownership count instead.
 *
 * **THE 20-SECOND SETTLE IS ABOUT A BUILD THAT FAILED, NOT ABOUT A RACE.**
 * `ownerCount(player 0, tag 'hall', max: 0)` reads TRUE before the layout has
 * stamped the tag, so a hall `spawnBuilding` had refused would DEFEAT the player
 * on tick one, in silence, before a word of the briefing had played. The world
 * is finished before tick one, so any value above zero closes it; twenty seconds
 * is unmistakably past the build and unmistakably short of anything being lost —
 * the nearest hostile hull at t=0 is the Reclamation opening, 446.3 m of wheeled
 * route from the hall (measured to the nearest cell a wheeled hull can stand on,
 * over the real `costGridFor(MoveClass.Wheel)`), which is 76.9 s at a Grinder's
 * 5.8 m/s before a shot could be fired at it.
 * The primary needs no settle of its own: `ownerCount(player 0, 'feeder',
 * min: 4)` is FALSE on an empty registry, which is the same guard from the other
 * side.
 *
 * ============================================================================
 * TRIGGER ORDER, AND A HOUSE CLAIM THAT IS STRONGER THAN THE CODE
 * ============================================================================
 * Everything that resolves a secondary sits ABOVE `t.win` and the three losses
 * sit below it. That is the convention `allies.05.forced-closure` and
 * `soviets.02.common-standard` both state, and both of them give a reason that
 * does not survive reading `campaign-install.ts`: *"a secondary written below
 * the win never fires on the winning tick and the medal never counts it."*
 *
 * **MEASURED, THAT IS NOT WHAT HAPPENS.** `CampaignSession.simTick` calls
 * `runDirector` once, which appends EVERY firing trigger's effects to one list,
 * and then walks that whole list through `apply()` — there is no early return
 * in the loop. `end()` returns early once `state.outcome` is set, and all that
 * refuses is a SECOND `endOperation`; a `completeObjective` written below the
 * win still lands on the winning tick. The next tick evaluates nothing, because
 * `runDirector` returns 0 on a resolved outcome, but that is a tick too late to
 * matter.
 *
 * So what file order ACTUALLY decides is the two things the vocabulary makes it
 * decide: which `endOperation` is honoured, and which of two conflicting
 * objective writes lands first — `setObjective` refuses to un-resolve a resolved
 * row, so the FIRST answer is the one the player keeps. Above the win is
 * therefore never wrong and below it is only accidentally right, and these rows
 * are ordered on the first of those rather than the second. The three losses
 * cannot tie with `t.win` in any case: `t.deadline` needs eighteen minutes, and
 * a player whose line closed on the closing tick has finished the run.
 *
 * ============================================================================
 * THE PRESSURE, PRICED
 * ============================================================================
 *     on the first house   4 Pickers, 2 Grinders   1 560 credits   at PLANT
 *     4:00                 6 Pickers, 2 Grinders   1 740           at PLANT
 *     6:30                 3 Slaggers, 3 Grinders  2 940           at CUT
 *     9:00                 6 Pickers, 3 Grinders   2 340           at PLANT
 *     12:00                3 Slaggers, 3 Grinders  2 940           at CUT
 *
 * **11 520 credits, which is BELOW the band on purpose.**
 * `allies.04.misclosure` spends 12 800 over sixteen minutes and
 * `allies.05.forced-closure` 11 900 over seventeen — but in a defend and in an
 * assault every credit arrives at ONE piece of ground. Here the player is
 * holding four places at once across 105.00 m of line, 254.1 to 327.1 m of Foot
 * route from the barracks door, and the operation's real pressure is that
 * geometry rather than the hull count. The waves are a FLOOR on it: the
 * Reclamation has a base, a 5 000 bank, eighteen minutes of income and a brain,
 * and `orderTagged ... attackMove` is a heading rather than a leash.
 *
 * **THE COMPOSITION IS A WARNING THE PLAYER CAN READ.** `rclSlagger` is 380
 * credits of demolition infantry — `slagCharge` delivers **21.93 dps against
 * Concrete**, more than a Grinder's 17.68 and nearly three times a G.I.'s 7.55 —
 * so a Slagger column is the wave that comes for the HOUSES rather than for the
 * army, and both Slagger waves arrive at `CUT`, across the middle of the line,
 * rather than down the tramway. Three of them take an 800 hp house down in
 * **12.2 seconds**.
 *
 * **THE PLAYER CANNOT FORTIFY THE LINE AND THE ARITHMETIC IS WHY — THOUGH THE
 * FIRST VERSION OF IT WAS 2.3x TOO EXPENSIVE AND ATTACHED TO THE WRONG HOUSE.**
 * `pillbox` is untagged, 400 credits, `power: 0` and reaches 22 m, so it is the
 * obvious answer to "I cannot be in four places" — and `Placement` will not let
 * it get far. A Construction Yard projects `BUILD_RADIUS` 56 m and every other
 * finished structure `PLACEMENT.adjacencyRadius` 20 m plus its own radius.
 * Breadth-first over the real 1x1 build lattice, `Terrain.isBuildable(cx, cz)`
 * per cell (which already refuses an occupied one), seeded from every structure
 * the layout actually builds and expanding one generation per new pillbox:
 *
 *     already legal with nothing new    745 cells
 *     house 1    3 pillboxes   1 200 cr        house 4    8   3 200 cr
 *     house 2    4             1 600           house 5   10   4 000
 *     house 3    6             2 400           house 6   12   4 800
 *                                              the meter 13   5 200
 *
 * **THE HALL IS THE FIRST LINK AND THE OLD FIGURE DID NOT KNOW IT.** It is
 * PLAYER-owned, 69.31 m from the yard, and projects 20 + 6.00 = **26.00 m** of
 * its own — which is why the zero-cost frontier already reaches **96.00 m** of
 * the 137.36 m ray from the yard to house one. (96.00 is a cell-lattice fill
 * result and does not fall out of 69.31 + 26.00 arithmetically; it is not
 * re-derived from the two figures beside it and did not move with them.)
 *
 * So house one is cheap and the
 * argument belongs to house FOUR: **3 200 credits of a 5 000 bank spent on
 * getting permission to build rather than on anything that shoots**, against
 * 1 500 for the four engineers that take the line outright. One or two posts
 * around house one and the hall are a real purchase; a fortified line is not,
 * and the operation is authored on the assumption that the army moves.
 *
 * **AND THE CONTESTED ORE IS ON THE LINE, WHICH IS NOT A COINCIDENCE AND IS
 * NOT AN ACCIDENT EITHER.** `addStartOre` lays one home field per opening and
 * one contested patch on the CENTROID of the two, which on this pair is
 * (256, 256) at r 22 — **15.62 m from house three**, so the patch covers it.
 * Both economies work the middle of the tramway for the whole operation. It is
 * also the third reason every trigger in this file is an `ownerCount` rather
 * than a `unitsInArea`: an untagged area count over the line would be tripped
 * by a harvester on its round trip, which is the check
 * `allies-forced-closure` and `reclamation-written-off` both had to run for
 * their own discs and which this operation passes by not having one.
 *
 * **`CUT` IS A SECOND BEARING AND THAT IS ITS WHOLE JOB.** `AiBrain` sends its
 * own army out of its own yard, so a scripted column arriving from the plant
 * buys the operation nothing it was not already getting. `CUT` is 81.3 m of
 * wheeled route from house three and 215.8 m from the hall, on the flank of the
 * line — which is what makes the twelve-minute turn a genuine second front
 * rather than a bigger version of the first.
 *
 * ============================================================================
 * WHAT WAS CONSIDERED AND CUT
 * ============================================================================
 *   - **`civOilDerrick` AS THE FEEDER HOUSE.** A 13 m lattice headframe is a
 *     better transmission mast than a brick block and it was rejected on
 *     arithmetic: `CIVILIAN_INCOME` pays its holder **15 credits a second**, so
 *     four of them held through a seven-minute run is **25 200 credits** —
 *     five times the opening bank, delivered for standing still. The line has
 *     to cost the player something and an income structure pays them instead.
 *     `civOreMine` at 5 a second was the same objection at a third of the rate;
 *     it survives as the METER, where exactly one of them is the point.
 *   - **A SEVENTH AND EIGHTH HOUSE.** Six is what the ground allows: the lane
 *     carries two bands no 2x3 footprint fits in at all (measured, 110-125 m
 *     and 260-280 m out), and the layout header records both. More houses
 *     inside the same corridor would put them under 30 m apart, which makes
 *     "four of six" a decision about nothing.
 *   - **PAYING `spare` IN CREDITS.** It resolves mid-match and the money would
 *     have somewhere to go, so the usual objection does not apply — but a
 *     payout that refunds the engineer it cost is a secondary that is free, and
 *     a free secondary is not a decision. `meter` pays because taking it is a
 *     detour off the line at a moment when the line is the only thing that
 *     matters.
 *   - **`primaryType: 'economy'`.** The chapter blurb names refineries and the
 *     temptation is permanent. `reclamation.02.written-off` and
 *     `soviets.09.nil-return` between them own both shapes the frozen
 *     vocabulary has for it, and a third would be a third `credits` threshold
 *     wearing a hat.
 *   - **A SCRIPTED ENGINEER GIFT.** `allies.05.forced-closure` hands the player
 *     four at minute eight and the arithmetic IS that operation. Repeating it
 *     here would delete the only purchase this one asks the player to make.
 * ========================================================================== */

import { Faction } from '../../../core/types';
import { minutes, seconds } from '../../types';
import type { Condition, OperationDef } from '../../types';
import {
  CUT, HALL, LINE_FAR, LINE_FOURTH, LINE_MID, LINE_NEAR, PLANT,
} from '../../layouts/allies-machine-time';

/**
 * THE GEOMETRY IS IMPORTED, NOT RESTATED.
 *
 * The tramway is placed by the layout and the columns are ordered at it by this
 * file, so the two modules have to agree about five points. A number written in
 * both is a number that will disagree the first time either is tuned, and the
 * failure — a column attack-moving at empty ground, a reveal framing nothing —
 * is invisible to every gate. `layouts/allies-machine-time.ts` owns the
 * geometry; the dependency runs operation -> layout and never back.
 */

/**
 * The guard on a build that failed rather than on a race. See the header:
 * `ownerCount(max: 0)` reads TRUE before the layout has stamped the tag, so
 * without this a hall `spawnBuilding` had refused would DEFEAT the player on
 * tick one, in silence.
 */
const SETTLE = seconds(20);

/**
 * The reduction, in machine time, and the number the whole file is tuned to.
 *
 * **THE RULE IS A DEADLINE AND NOT A COUNT.** This comment used to say "one
 * interruption is affordable and two are not", which is measurably false:
 * `runDirector` DELETES `state.armedAt` on any tick the arming pass fails and
 * re-sets it on the next tick it holds, so only the LAST re-arm is in the
 * arithmetic. `t.win` fires at `armTick + RUN`, `t.deadline` at `CLOSE`, so the
 * whole tuning is `CLOSE - RUN` = 32 400 - 12 600 = **19 800 ticks, 11:00.000 —
 * the tick by which the last break must have ended**. Twelve breaks before that
 * all win; one break ending a tick later loses. Seven minutes leaves 9:15.3 of
 * that wall over the 1:44.7 floor. See the header.
 */
const RUN = minutes(7);

/** The quarter goes over to the Ninth's account. `parSec` to the second. */
const CLOSE = minutes(18);

/**
 * Four houses on the works is a line; three is not three quarters of a line.
 *
 * Defined once because four triggers must agree on it — `t.line`, the two
 * standing-secondary rows and `t.win` — and because `t.win` and
 * `t.spareStanding` have to arm on the SAME tick or the medal resolves against
 * a different clock from the win.
 *
 * It needs no `SETTLE`: the player owns nothing on tick one, so a count of four
 * is false until four have actually been taken. That is the tick-one guard the
 * `max: 0` rows below have to buy with a timer, arriving for free on a `min`.
 */
const LINE_MADE: Condition = {
  on: 'ownerCount', player: 0, role: 'building', tag: 'feeder', min: 4,
};

/** The run closes. Shared so the two standing rows resolve on the winning tick. */
const RUN_CLOSED: Condition = {
  on: 'all',
  of: [LINE_MADE, { on: 'elapsedSinceArmed', ticks: RUN }],
};

const op: OperationDef = {
  id: 'allies.06.machine-time',
  chapter: 'allies',
  faction: Faction.Allies,
  /*
   * THE RECLAMATION, AND THE CHAPTER'S SECOND NON-SOVIET SEAT. See the header:
   * the Ninth bought the week and the Reclamation owns the plant, so the army
   * on this ground is the one selling access rather than the one that wants the
   * schedule. Every wave below is a literal `rclPicker`, `rclSlagger` or
   * `rclGrinder`, which `validateCampaign` refuses on a seat that is not
   * Reclamation.
   */
  foe: Faction.Reclaim,
  index: 6,
  title: 'Machine Time',
  beat: 'The room is ours and the current is not — and a reduction that loses its supply does '
    + 'not pause, it starts again at the first bench.',
  primaryType: 'capture-hold',
  /*
   * BESPOKE. Objective state — all three verbs, including the `setObjective`
   * that publishes the second primary — plus spawns, orders, reveals, dialogue,
   * an announcer line and two camera moves: TEN of the eleven effect kinds. The
   * one it does not use is `grantCredits`, because the paying secondary pays
   * through `ObjectiveDef.credits`, which the save chunk's `paid` set keeps
   * from paying twice across a reload.
   */
  archetype: 'bespoke',
  parSec: 1080,
  requires: ['allies.05.forced-closure'],

  map: {
    /*
     * `urban` — Industrial Grid, and the biome key is the same word, which is
     * the case where the two vocabularies AGREE. They disagree on exactly one
     * name (`arid` the preset, `desert` the biome) and `getBiome` answers an
     * unknown one with a `console.warn` and temperate, which is how
     * `reclamation.03.sold-twice` came to be measured on ground it was never
     * built on. Typed `BiomeName` here, so tsc names the file and the line.
     *
     * The preset is the chapter's second use of it after `allies.02` and it is
     * the premise rather than a rotation: `urban` carries `relief` 0.14 and
     * `cliffs` 0.10, the flattest ground in the table, which is what lets a
     * tramway of six identical blocks read as one continuous line rather than
     * as six buildings on six different terraces. It also carries the highest
     * `urban` weight in the table at 0.95, which is what puts real road under
     * them.
     */
    preset: 'urban',
    biome: 'urban',
    /*
     * A5 + 7 ON THE CHAPTER'S COUNTER (20 260 928, 935, 942), AND SURVEYED
     * RATHER THAN ASSUMED.
     *
     * Five rolls were built headless against this operation's finished layout
     * and scored on one thing: how many of the eight authored structures take
     * their literal at ring zero, which is what keeps every distance in these
     * two files true.
     *
     *     20 260 942   8 of 8 at ring zero
     *     20 260 949   6 of 8 — the hall slides 17.0 m, house five 8.0 m
     *     20 260 956   8 of 8 at ring zero
     *     20 260 963   6 of 8 — the hall 17.0 m, the meter 8.0 m
     *     20 260 970   5 of 8 — the hall 12.0 m, house five 28.3 m, six 8.0 m
     *
     * **TWO OF THE FIVE ARE CLEAN AND THE CONVENTION'S OWN ROLL IS ONE OF
     * THEM**, which is luck rather than method and is said out loud for that
     * reason; 20 260 956 is the spare if this one ever has to move.
     *
     * FIVE IS A SMALL SWEEP AND IT IS QUOTED AS ONE. The middle of this lane is
     * the map-centre shelf `startPointsFor` reserves on every continent, so the
     * band from 130 to 255 m out is flat on every roll and only the two ENDS
     * move — every slide in the table above is the hall, house five, house six
     * or the meter. Anyone moving a point near either end should re-run the
     * sweep rather than assume the margin; anyone moving one in the middle is
     * standing on the shelf and will not see a difference.
     *
     * Pinned by `tests/campaign-maps.spec.ts` as a terrain fingerprint.
     */
    mapSeed: 20_260_942,
    /*
     * A5 + 7 ON THE CHAPTER'S OWN COUNTER (7 014, 7 021, 7 028, 7 035, 7 042),
     * AND IT DRAWS `seatedSlots(2, 7049, null)` = **[0, 1]** — a DIAGONAL pair
     * at 386.16 m, the longest opening the two-army table offers, against A5's
     * 296.00 m edge pair.
     *
     * That is the shape this operation wants and A5's was the shape that one
     * wanted: an assault's length has to come from the works being hard, so it
     * shortened the drive; a capture-hold's length comes from the LINE, and a
     * long lane is what makes six houses at thirty-four to forty-six metre
     * spacing a line rather than a cluster. Change this and re-measure; do not
     * re-read.
     */
    simSeed: 7_049,
    armies: 2,
    /*
     * `base`. The operation is bought — three engineers, the posts, and
     * whatever holds 105 m of line — so the player needs the thing that
     * produces one, and `engineer` prereqs a barracks AND a refinery, both of
     * which an `mcv` opening would spend the first two minutes raising against
     * an eighteen-minute clock.
     */
    opening: 'base',
    /*
     * 5 000, AND IT BINDS BOTH SEATS — `Shell.applySimPostBoot` writes
     * `setup.startingCredits` into every non-Neutral slot.
     *
     * The chapter's ramp is 2 500 / 3 000 / 4 000 / 5 000 / 5 000 and this
     * holds at the top for the third time, because what this operation adds
     * over A5 is ground rather than money: the four engineers are 1 500 of it
     * and the answer to holding four places is `pillbox` at 400, so a sixth
     * thousand would buy the line outright and delete the decision. It is still
     * half the skirmish 10 000, which CLAUDE.md names twice as the real cause
     * of "the AI has a ready base".
     */
    credits: 5_000,
  },
  layout: 'allies-machine-time',

  // NEITHER SHIPPED RULE MAY END THIS. See the header: `annihilationWin` would
  // report a victory for razing the plant at any point in a run that killing the
  // plant does not advance by a tick, and `assetLossDefeat` would end this
  // operation's best last act — an empty base and a live line — at 2 Hz.
  outcome: { annihilationWin: false, assetLossDefeat: false, ignoreSeats: [] },

  // See the header. Empty on both sides — and the Reclamation half is the one
  // that matters, because an Arc Pylon founded beside any house closes every
  // capture stand on it, including the two this operation is walked through.
  roster: { player: [], ai: [] },

  objectives: [
    {
      id: 'line',
      kind: 'primary',
      title: 'Put four of the quarter’s feeder houses on the works',
    },
    /*
     * HIDDEN, AND REVEALED BY THE TRIGGER THAT COMPLETES `line`. Two primaries
     * cost the medal nothing — `medalFor` reads secondaries only — and what
     * they buy is a HUD row that says which half of the operation the player is
     * in. `briefingObjectives` filters hidden rows, so the brief lists the
     * capture and the two secondaries; the seven minutes arrive when they
     * become real.
     */
    {
      id: 'run',
      kind: 'primary',
      title: 'Hold the line unbroken until the reduction closes',
      hidden: true,
    },
    /*
     * NO `credits`, AND IT IS A DECISION RATHER THAN AN OMISSION. It resolves
     * mid-match so a payout would have somewhere to go — but five hundred is
     * exactly what the fifth engineer cost, and a secondary that refunds its own
     * price is free. The medal is the payment.
     *
     * **AND IT COSTS A POST AS WELL AS AN ENGINEER, WHICH THE FIRST DRAFT OF
     * THIS FILE PRICED AT ZERO.** A fifth house can only be house five or house
     * six, and the engine's own route to either spends 36.0 m and 28.0 m inside
     * a live `postCoil` — ten and eight seconds against a gun that kills a 90 hp
     * engineer in 1.70. The exclusion control says a safe approach exists at
     * +61.5 m and +13.3 m of hand-routing; the cheaper answer is post #2.
     */
    {
      id: 'spare',
      kind: 'secondary',
      title: 'Carry a fifth house on the line',
    },
    /*
     * THIS ONE PAYS, because it is a detour off the line at the moment the line
     * is the only thing that matters, and because the money arrives with the
     * run still running and somewhere to spend it.
     *
     * The detour is 428.6 m of Foot route from the barracks door, 45.7 m of it
     * inside a firing circle across all three line posts, or +19.9 m of
     * hand-routing to a safe capture cell. It is the longest walk on the map and
     * it is meant to be.
     */
    {
      id: 'meter',
      kind: 'secondary',
      title: 'Take the plant’s load meter off the Reclamation',
      credits: 500,
    },
  ],

  triggers: [
    /* -- the brief, in four beats -----------------------------------------
     * Fifty-two seconds and four speakers, because the shell renders dialogue
     * as toasts and a stack of four at once is a stack nobody reads. The
     * mechanic is in the fourth beat in numbers this table can be checked
     * against: four houses, seven minutes, and four minus one is not three.
     *
     * TWO `cameraMove`s IN THIS FILE AND BOTH ARE REVEALS. `types.ts` reserves
     * the effect for an arrival, a loss or a reveal and forbids it as
     * punctuation; the first shows the player the line they have never seen and
     * the second shows them the house the operation is about.
     */
    {
      id: 't.open',
      when: { on: 'elapsed', ticks: seconds(4) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Aubray',
          text: 'The frames have been turning since two this morning and the reduction is seven '
            + 'minutes of machine time from a closed continental loop. It is not seven minutes we '
            + 'can take in pieces. Lose the supply at the sixth minute and every partial in that '
            + 'hall is scrap paper and we start at the first bench.',
        },
        { do: 'cameraMove', at: LINE_MID },
      ],
    },
    {
      id: 't.brief',
      when: { on: 'elapsed', ticks: seconds(20) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Wend',
          text: 'The hall draws off the quarter tramway. Six feeder houses between us and the '
            + 'plant, civil property, nobody’s — and four of them carry the load. One engineer '
            + 'apiece walks in and they are ours for good. We have one; the other three are five '
            + 'hundred each and ten seconds of barracks.',
        },
        { do: 'revealArea', player: 0, area: LINE_NEAR },
      ],
    },
    {
      id: 't.terms',
      when: { on: 'elapsed', ticks: seconds(36) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Cregg, on an open channel',
          text: 'The plant came to us with everything else breakable at the Split and we sell '
            + 'current by the hour to anybody with an account. The Ninth bought the quarter’s '
            + 'week on Tuesday and paid on the nail. I am not going to stop you walking up my '
            + 'line. I am telling you the figure, because nobody ever believes the first one.',
        },
        { do: 'revealArea', player: 0, area: LINE_FAR },
        { do: 'cameraMove', at: LINE_FOURTH },
      ],
    },
    /* -- and the two things the interface will not say ---------------------
     * The posts stand over the fourth and fifth houses at 21.26 m of centre
     * distance, which is 14.05 m of SURFACE against a 20 m gun — so the tick a
     * house becomes ours it becomes a target, at 19.20 dps into 800 hp. A
     * player who takes house four and walks away loses it in forty-one seconds
     * and will not know why.
     *
     * AND THE SECOND HALF IS THE ROAD, WHICH IS THE CORRECTION THIS BEAT NEEDED.
     * The route the engine draws to house five spends 36.0 m inside a live
     * `postCoil` and the one to house six 28.0 m, against a gun that kills a
     * 90 hp engineer in 1.70 s. The player cannot see a firing circle and there
     * is no cursor, no icon and no toast that says any of this; the only place
     * it can be said is here, so it is said in both halves rather than one.
     */
    {
      id: 't.fourth',
      when: { on: 'elapsed', ticks: seconds(52) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Aubray',
          text: 'Three houses are behind the works; they cost only the walk. The fourth is across '
            + 'the quarter under an Arcspitter that also covers its road. Take the house while '
            + 'that post stands and she is rubble in forty seconds. A second post covers the '
            + 'fifth house and its approach. Kill each post first, or send your man around the '
            + 'far side. Then hold four houses together for seven minutes. Four minus one is not '
            + 'three houses of current. It is no run at all.',
        },
      ],
    },

    /* -- the plant notices, and it is keyed to the player ------------------
     * `ownerCount(player 0, 'feeder', min: 1)` rather than a clock, so the
     * hinge sits in the same place for a fast commander and a careful one —
     * the shape `soviets.02.common-standard` and `reclamation.02.written-off`
     * both use, spelled as an ownership count because that is what the
     * operation is actually about and because it costs one tagged read a tick
     * instead of a walk of the alive list.
     *
     * It cannot fire on tick one: the player owns no house until an engineer
     * has walked at least 202.9 m.
     *
     * LITERAL RECLAMATION KEYS. `EffectSink.spawnUnits` resolves through
     * `ProductionCatalog.byKey` and remaps nothing, unlike the layout's
     * `ScenarioBuilder.spawnUnit`; `validateCampaign` checks every key against
     * the army of the seat it lands on, so an Allied key here is a build error.
     */
    {
      id: 't.watch',
      when: { on: 'ownerCount', player: 0, role: 'building', tag: 'feeder', min: 1 },
      then: [
        {
          do: 'dialogue',
          speaker: 'Cregg, on an open channel',
          text: 'There is an Allied engineer standing in my number one house. Put the shift on '
            + 'the line.',
        },
        { do: 'spawnUnits', player: 1, key: 'rclPicker', count: 4, at: PLANT, spread: 16, tag: 'watch' },
        { do: 'spawnUnits', player: 1, key: 'rclGrinder', count: 2, at: PLANT, spread: 10, tag: 'watch' },
        { do: 'orderTagged', tag: 'watch', order: 'attackMove', at: LINE_MID },
      ],
    },

    {
      id: 't.col1',
      when: { on: 'elapsed', ticks: minutes(4) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Wend',
          text: 'Eight off the plant, down the tramway. Pickers and two Grinders — that is a '
            + 'column for our men, not for the houses.',
        },
        { do: 'spawnUnits', player: 1, key: 'rclPicker', count: 6, at: PLANT, spread: 20, tag: 'col1' },
        { do: 'spawnUnits', player: 1, key: 'rclGrinder', count: 2, at: PLANT, spread: 11, tag: 'col1' },
        { do: 'orderTagged', tag: 'col1', order: 'attackMove', at: LINE_FOURTH },
      ],
    },

    /* -- the run starts, and the second half of the operation is published - */
    {
      id: 't.line',
      when: LINE_MADE,
      then: [
        { do: 'completeObjective', id: 'line' },
        { do: 'setObjective', id: 'run' },
        {
          do: 'dialogue',
          speaker: 'Bramm, on the survey net',
          text: 'Four houses and the hall is drawing. The integrators are turning and the first '
            + 'normal equation is forming. Seven minutes from now I have a schedule. Nobody '
            + 'touches that line.',
        },
      ],
    },

    /* -- the Slaggers, across the flank -----------------------------------
     * `slagCharge` delivers 21.93 dps against Concrete, against a Grinder's
     * 17.68 and a G.I.'s 7.55, so three Slaggers take an 800 hp house in
     * 12.2 s. This is
     * the wave that comes for the HOUSES, and it arrives at `CUT` — 81.3 m of
     * wheeled route from house three, across the middle of the line rather than
     * down it.
     */
    {
      id: 't.col2',
      when: { on: 'elapsed', ticks: minutes(6.5) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Wend',
          text: 'Not down the tramway this time. Yard road, across the middle of the line, and '
            + 'they are carrying slag charges. Those are not for us — three of them will have a '
            + 'house down in twelve seconds.',
        },
        { do: 'spawnUnits', player: 1, key: 'rclSlagger', count: 3, at: CUT, spread: 12, tag: 'col2' },
        { do: 'spawnUnits', player: 1, key: 'rclGrinder', count: 3, at: CUT, spread: 18, tag: 'col2' },
        { do: 'orderTagged', tag: 'col2', order: 'attackMove', at: LINE_MID },
      ],
    },

    /* -- the break, said once ----------------------------------------------
     * `objectiveComplete: 'line'` is the exact latch. Without it
     * `ownerCount(max: 3)` is TRUE of an empty world and this fires on tick
     * one, telling the player their run has stopped before it started.
     *
     * THE ONE SCRIPTED `eva` IN THIS FILE. `types.ts` says to script a line for
     * a beat the game has no event for; `audio.system.ts` speaks `structureLost`
     * on any local building death, which is a different thing and often not
     * even true here — a garrisoned house whose squad died is a deed reverting
     * to Gaia with no structure lost at all. `lowPower` is the announcer saying
     * the one thing that IS true in both cases: the hall has stopped drawing.
     */
    {
      id: 't.broken',
      when: {
        on: 'all',
        of: [
          { on: 'objectiveComplete', id: 'line' },
          { on: 'ownerCount', player: 0, role: 'building', tag: 'feeder', max: 3 },
        ],
      },
      then: [
        { do: 'eva', line: 'lowPower' },
        {
          do: 'dialogue',
          speaker: 'Bramm, on the survey net',
          text: 'The frames have stopped. Every partial in that machine is scrap paper — put the '
            + 'fourth house back on and it begins at the first bench, not where it stopped. That '
            + 'is what a reduction is. We have time for this once.',
        },
      ],
    },

    {
      id: 't.col3',
      when: { on: 'elapsed', ticks: minutes(9) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Wend',
          text: 'Nine off the plant. She is spending her own week’s takings to hold a line she '
            + 'has already been paid for.',
        },
        { do: 'spawnUnits', player: 1, key: 'rclPicker', count: 6, at: PLANT, spread: 20, tag: 'col3' },
        { do: 'spawnUnits', player: 1, key: 'rclGrinder', count: 3, at: PLANT, spread: 12, tag: 'col3' },
        { do: 'orderTagged', tag: 'col3', order: 'attackMove', at: LINE_FOURTH },
      ],
    },

    /* -- the second front, and it is at the room ---------------------------
     * The one wave ordered at the hall rather than at the line. `CUT` is 215.8 m
     * of wheeled route from it, so the Grinders are on the hall in 37.2 s at
     * 5.8 m/s and the Slaggers 71.9 s after the order at 3.0 — half a minute of
     * warning rather than a minute, and it has to be taken off a line that is
     * already thin.
     */
    {
      id: 't.turn',
      when: { on: 'elapsed', ticks: minutes(12) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Cregg, on an open channel',
          text: 'I have stopped selling the line and started selling the other thing. Six on the '
            + 'yard road and they are going nowhere near my houses — they are going to the room '
            + 'with the machine in it. Nothing personal in it. The Ninth pays for outcomes.',
        },
        { do: 'spawnUnits', player: 1, key: 'rclSlagger', count: 3, at: CUT, spread: 12, tag: 'works' },
        { do: 'spawnUnits', player: 1, key: 'rclGrinder', count: 3, at: CUT, spread: 18, tag: 'works' },
        { do: 'orderTagged', tag: 'works', order: 'attackMove', at: HALL },
      ],
    },

    {
      id: 't.closing',
      when: { on: 'elapsed', ticks: minutes(17) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Aubray',
          text: 'One minute. At the shift change the quarter goes over to the Ninth’s account '
            + 'and there is no current on that line at any price.',
        },
      ],
    },

    /* -- the two secondaries, both above the win --------------------------
     * ABOVE `t.win` BY CONVENTION, AND THE CONVENTION IS BETTER THAN THE REASON
     * USUALLY GIVEN FOR IT. See the header: `CampaignSession.simTick` applies
     * every effect the tick produced, in order, with no early return, so a row
     * below the win still lands. What ordering really buys is that
     * `setObjective` keeps the FIRST answer, so a completion above a failure
     * wins — which is the property these two rows and their `t.*Standing`
     * partners depend on.
     */
    {
      id: 't.spare',
      when: { on: 'ownerCount', player: 0, role: 'building', tag: 'feeder', min: 5 },
      then: [
        { do: 'completeObjective', id: 'spare' },
        {
          do: 'dialogue',
          speaker: 'Wend',
          text: 'Five houses on the works. We can lose one now and still be turning, which is '
            + 'the only insurance this quarter sells.',
        },
      ],
    },

    /*
     * `ownerCount ... max: 0` rather than `entityDead`, and the difference is
     * capture: an engineer that walks into the meter satisfies this exactly as
     * levelling it does, which is what the title promises. The `SETTLE` guard is
     * the one the `max: 0` rows all carry — a count of zero reads TRUE before
     * the layout has stamped the tag.
     *
     * The meter is `civOreMine`, which pays its holder 5 credits a second
     * (`CIVILIAN_INCOME_SOURCES`), so the two routes are priced differently:
     * shooting it through 700 hp of Concrete ends the Reclamation's drip and
     * pays the objective's 500; capturing it needs four engineers at rule 2
     * prices and pays the drip as well, at 300 a minute for whatever is left of
     * the operation.
     */
    {
      id: 't.meterTaken',
      when: {
        on: 'all',
        of: [
          { on: 'elapsed', ticks: SETTLE },
          { on: 'ownerCount', player: 1, role: 'building', tag: 'meter', max: 0 },
        ],
      },
      then: [
        { do: 'completeObjective', id: 'meter' },
        {
          do: 'dialogue',
          speaker: 'Cregg, on an open channel',
          text: 'My meter is off. Anything you draw up that line from here is unbilled, which '
            + 'means it is not sold, which means the Ninth’s week is a piece of paper with '
            + 'nothing under it. That was the expensive thing on this ground and you took it.',
        },
      ],
    },

    /* -- the two secondaries, unresolved at the finish ---------------------
     * The shape `allies.04.misclosure` and `allies.05.forced-closure` both use:
     * a row left `active` when the operation ends reads on the debrief as
     * unfinished rather than as missed. Neither can wrongly fire on a secondary
     * already taken — that row is `complete` by then and
     * `CampaignSession.setObjective` refuses to un-resolve a resolved row.
     *
     * BOTH ARM ON `RUN_CLOSED`, WHICH IS THE WIN'S OWN CONDITION OBJECT, so the
     * three cannot drift apart. `t.spareStanding` carries an extra `not` clause,
     * which means it DISARMS the moment a fifth house lands and can never fire
     * afterwards — the arming pass deletes its arm tick, and by the time the
     * player drops back to four `t.spare` has already resolved.
     */
    {
      id: 't.spareStanding',
      when: {
        on: 'all',
        of: [
          RUN_CLOSED,
          { on: 'not', of: { on: 'ownerCount', player: 0, role: 'building', tag: 'feeder', min: 5 } },
        ],
      },
      then: [{ do: 'failObjective', id: 'spare' }],
    },

    {
      id: 't.meterStanding',
      when: {
        on: 'all',
        of: [
          RUN_CLOSED,
          { on: 'ownerCount', player: 1, role: 'building', tag: 'meter', min: 1 },
        ],
      },
      then: [{ do: 'failObjective', id: 'meter' }],
    },

    /* -- the run closes ----------------------------------------------------
     * `elapsedSinceArmed` measured from the tick the fourth house landed, and
     * disarmed by any tick on which the player holds three. That is the whole
     * operation in one condition.
     */
    {
      id: 't.win',
      when: RUN_CLOSED,
      then: [
        { do: 'completeObjective', id: 'run' },
        {
          do: 'dialogue',
          speaker: 'Bramm, on the survey net',
          text: 'Closed. Eleven millimetres over four hundred and ten kilometres, distributed '
            + 'nowhere at all, every bench carrying its own residual where it was actually '
            + 'observed. That is a schedule somebody can check.',
        },
        {
          do: 'dialogue',
          speaker: 'Aubray',
          text: 'And it is a sheet of paper in a hall on the wrong side of the Split. Nobody '
            + 'sites a refinery off a number they have not been sent. Find out who sends them.',
        },
        { do: 'endOperation', result: 'win' },
      ],
    },

    /* -- the quarter is sold on ------------------------------------------- */
    {
      id: 't.deadline',
      when: { on: 'elapsed', ticks: CLOSE },
      then: [
        { do: 'failObjective', id: 'line' },
        { do: 'failObjective', id: 'run' },
        { do: 'failObjective', id: 'spare' },
        { do: 'failObjective', id: 'meter' },
        {
          do: 'dialogue',
          speaker: 'Cregg, on an open channel',
          text: 'Shift change. The quarter is on the Ninth’s account and my line is not for '
            + 'sale again until Tuesday. You had the room, the returns and the woman with the '
            + 'series, and you were seven minutes short of a number.',
        },
        { do: 'endOperation', result: 'loss', reason: 'run' },
      ],
    },

    /* -- the room ---------------------------------------------------------
     * `ownerCount(max: 0)` covers demolition AND capture in one clause — seat 1
     * opens holding an `rclTinker`, and `entityDead` would read FALSE on a hall
     * that had changed hands. See the header for why that makes `captureProof`
     * unnecessary anywhere in this file.
     */
    {
      id: 't.hallLost',
      when: {
        on: 'all',
        of: [
          { on: 'elapsed', ticks: SETTLE },
          { on: 'ownerCount', player: 0, role: 'building', tag: 'hall', max: 0 },
        ],
      },
      then: [
        { do: 'failObjective', id: 'line' },
        { do: 'failObjective', id: 'run' },
        {
          do: 'dialogue',
          speaker: 'Bramm, on the survey net',
          text: 'The hall is off us and so is every partial in it. There is no second apparatus '
            + 'on this continent that will take the series. Log it exactly as I said it.',
        },
        { do: 'endOperation', result: 'loss', reason: 'run' },
      ],
    },

    /* -- the ordinary loss -------------------------------------------------
     * `playerBeaten` is `Viability.isBeaten` — nothing to build with AND
     * nothing to fight with — not "you have no buildings". This operation
     * deliberately asks a commander to put four engineers and most of an army
     * 188 to 288 m from home, and one with an empty base and a live line is not
     * beaten.
     */
    {
      id: 't.beaten',
      when: {
        on: 'all',
        of: [{ on: 'elapsed', ticks: SETTLE }, { on: 'playerBeaten', player: 0 }],
      },
      then: [
        { do: 'failObjective', id: 'line' },
        { do: 'failObjective', id: 'run' },
        {
          do: 'dialogue',
          speaker: 'Wend',
          text: 'Nothing answering on the quarter. She will bill the Ninth for the whole week '
            + 'and file us as an interruption to supply.',
        },
        { do: 'endOperation', result: 'loss', reason: 'run' },
      ],
    },
  ],
};

export default op;
