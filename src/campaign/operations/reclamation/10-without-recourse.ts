/**
 * ============================================================================
 * R10 — WITHOUT RECOURSE
 * ============================================================================
 * **THE LAST OPERATION OF SALVAGE RIGHTS AND OF THE CAMPAIGN.** Thirty-six
 * operations across four chapters come before it, and the thing it has to close
 * is an argument rather than a battle.
 *
 * R9 ended with the account paid out of three of the company's own breaking
 * yards and Tallow's line over the discharge: *"There are five entries against
 * us in the account now and every one of them is marked settled. That is what I
 * have got left to sell."* This file takes that sentence literally. What the
 * firm has left is a delivery book that every house on the continent now reads
 * and one house keeps — and the chapter has spent nine operations proving that
 * the reading is what makes it valuable while quietly assuming the keeping is
 * what makes it an asset.
 *
 * **THAT ASSUMPTION IS THE LAST THING THE CHAPTER HAS NOT ANSWERED, AND IT IS
 * BACKWARDS.** R5 leaves the book the only complete record and Calvane's
 * objection standing: one book in one hand with no second copy anywhere is not a
 * record, it is an assertion. R6 concedes a counterpart in a bonded store, which
 * makes it CHECKABLE. R7 collects on it. R8 pays a claim made against it out of
 * the lot pen. R9 pays four more out of the plant. Every one of those is the
 * same discovery from a different side: the book is worth what it costs the
 * party who wrote it. Carried to the end, that argument does not stop at
 * honouring a claim. **A record whose keeper can still be paid for reading it,
 * still be leaned on to alter it and still be sued over what it says is a record
 * with a party in it, and every house dealing under it is dealing on the
 * Reclamation's sufferance.** The only way to spend the last of the book's value
 * is to stop owning it.
 *
 * So the instrument is an endorsement WITHOUT RECOURSE — a real commercial form,
 * and the operation's title: the endorser passes the instrument on and disclaims
 * any further interest in it or liability under it. The delivery book is
 * endorsed to the four houses jointly, four fair copies are lodged in the
 * district's four bonded stores at one moment, and from tomorrow the Reclamation
 * is a customer in its own book. **That is the chapter's argument arriving at
 * the people who paid for it, and it requires no sequel: nothing arrives, nobody
 * is coming, and the firm ends the afternoon with four yards and a name.**
 *
 * **IT DOES NOT CONTRADICT THE OTHER THREE ENDINGS AND IT WAS CHECKED AGAINST
 * ALL THREE.** `soviets.09.nil-return` ends with a delivered quarter entered
 * against a record the Ninth no longer holds — a FIGURE made undeniable by
 * output. `allies.09.made-good` ends with Station Nine occupied on corrected
 * ground — a SCHEDULE made undeniable by somebody standing on it.
 * `pact.09.vacant-possession` ends with eleven houses holding the precinct and
 * the Order a tenant — a COUNT made true by conceding the ground it was taken
 * from. None of the three is about a record used BETWEEN parties, which is the
 * one this chapter has, and none of them is touched by a Reclamation delivery
 * book changing hands on a works road.
 *
 * ============================================================================
 * WHY `primaryType: 'capture-hold'`, AND THE FOUR SHAPES THAT WERE COSTED FIRST
 * ============================================================================
 * Salvage Rights has spent assault, economy twice, capture-hold, infiltrate,
 * defend, escort, fixed-force and race. `validateCampaign` refuses only ADJACENT
 * repeats within a chapter and R9 is `economy`, so the only hard exclusion is
 * economy and everything else was on the table. Four candidates were costed and
 * three were rejected on content rather than on the validator:
 *
 *   - **`escort` is `reclamation.06.in-duplicate` EXACTLY.** R6 is a copy of the
 *     book walked to a bonded store under guard. Four copies walked to four
 *     bonded stores is that operation with the count changed, and escort is
 *     already the most-spent type in the campaign at five.
 *   - **`race` is `reclamation.08.contra-entry`'s.** R8 is a window that opens at
 *     minute nine and a whistle at twenty, and its own header says the six-minute
 *     gap is "the only thing in the file that rewards reading a clock rather than
 *     a map". This operation has a window too and it is deliberately NOT the
 *     subject: the clock here is what makes the last eight minutes tense, not
 *     what the player is being tested on.
 *   - **`landing` needs an archipelago and `allies.09.made-good` owns it.** That
 *     file's header derives it: there is exactly one map in the game with land on
 *     the far side of water, and a bookkeeping chapter has no business on it.
 *   - **`superweapon` and `assassination` are both unspent in this chapter and
 *     both are wrong for it.** Salvage Rights' register is mercantile and dry —
 *     paper, lots, invoices, gantries signed for at a weighbridge — and the
 *     closing operation of a chapter whose whole thesis is that violence is a
 *     line item must not be decided by ordnance or by killing a named man.
 *
 * **SO THE REPEAT IS `capture-hold`, AT INDEX 10 AGAINST `reclamation.03`'s
 * INDEX 3, AND THE INVERSION IS THE ARGUMENT FOR IT.** R3 is one lot that two
 * parties both invoiced: take it and keep it, because possession is what decides
 * between two pieces of paper. R10 is the same verb pointed the other way — the
 * thing taken is taken in order to be GIVEN AWAY, and the thing held is held on
 * behalf of the parties it is being held against. Opening the chapter with
 * possession settling an argument and closing it with possession being the
 * problem is worth a repeat; the same shape twice would not be.
 *
 * ============================================================================
 * THE TWO PRIMARIES, AND THE SECOND ONE IS THE OPERATION
 * ============================================================================
 *     `counter`  `structureCaptured('exchange', 0)`             at the close
 *     `endorse`  the exchange still ours AND one of ours standing inside all
 *                FOUR counter discs, held for thirty seconds, any tick in the
 *                window
 *
 * **THE FOUR DISCS READ GROUND AND NOT A NAMED SET, WHICH IS A DECISION AND NOT
 * A SHORTCUT.** `unitsInArea` accepts an optional `tag`, and a tagged spelling
 * is the cheap one — the untagged branch walks `store.alive` rather than the tag.
 * It is refused here anyway, because a layout can only tag what IT places: the
 * player can build `rclTinker` all afternoon, and a tag-restricted disc would
 * silently refuse every clerk made after tick zero. That is an operation that
 * looks unwinnable to the player and green to every gate. The cost is bounded
 * and it is stated below.
 *
 * **`min: 1` PER DISC, AND ALL FOUR ARE CONJOINED.** One hand at each store, and
 * the four discs are **100.6 m apart at the closest pair and 204.5 m at the
 * widest**. At an `rclTinker`'s 3.5 m/s the closest pair is **28.7 seconds apart
 * in a straight line and further along any real route**, so no hand can cover
 * two counters and the primary is four bodies or nothing. That is the whole of
 * what the establishment has to beat, and it is why they never touch the
 * register.
 *
 * ============================================================================
 * A BONDED STORE IS UNTOUCHABLE WHILE IT BELONGS TO NOBODY, AND THE PLAYER CAN
 * STOP THAT BEING TRUE WITH ONE RIGHT-CLICK
 * ============================================================================
 * The four stores stand on the NEUTRAL slot. `ScenarioBuilder.gaia` sets both
 * directions of `allyMask` for that slot — *"Everyone is friends with the
 * scenery, in both directions"* — and `Targeting.isValidTarget` refuses ALLIES,
 * so no gun in this operation can acquire a bonded store, the establishment's
 * included. **Measured on the built world: `areAllied(1, gaia)` is true in both
 * directions, and a seat-1 `rhino` stood at 18 m of an unoccupied store acquires
 * NOTHING over three hundred ticks and takes it from 800 hp to 800 hp.**
 *
 * **AND THE MOMENT ONE OF THE PLAYER'S OWN MEN IS INSIDE, THAT STOPS BEING
 * TRUE.** This block used to end at the paragraph above and the claim was false
 * on the most ordinary click in the operation. `GarrisonService.enter` calls
 * `captureService().captureBuilding(host, owner, unit)` DIRECTLY whenever the
 * host's owner faction is Neutral — it never enters `CaptureService.resolve`, so
 * the `captureProof` veto below cannot see it (`allies.07.fair-copy`'s finding).
 * Driven, same world, same store: `refusalFor` returns `''` (a `civApartments`
 * is 3 x 2 against `GARRISON.minFootprint` 2, unarmed, no role flag), one
 * `rclPicker` walks in, the store's owner goes **2 -> 0 and its faction Neutral
 * -> Reclaim**, `areAllied(1, owner)` goes **true -> false**, and the SAME rhino
 * on the SAME cell acquires it and takes it to **658.79 hp in ten seconds**.
 * That pair is an exclusion control and not an assertion.
 *
 * A garrisoned store is therefore an 800 hp `ArmorClass.Concrete` building on
 * the company's books, in front of a company that was already marching at that
 * ground: **12.67 s to the first picket's 63.12 dps and 9.97 s to the other
 * three at 80.28**, and `Garrison.recover`'s dying branch sinks the occupants
 * with it. `releaseEmptied` hands the deed back the moment the last man leaves,
 * so the exposure lasts exactly as long as the occupancy — which is why this is
 * a PRICE and not a trap, and why `t.hours` now tells the player to stand beside
 * a store rather than inside one.
 *
 * **THE OPERATION IS STILL BUILT ON THE FACT RATHER THAN AROUND IT.** There is
 * no "protect the stores" objective and there must not be one: on the default
 * play it is unfalsifiable, which is the vacuous-metric trap CLAUDE.md records
 * walking into three times, and on the garrisoned play it would be an objective
 * the player arms against themselves. What the establishment can do is make sure
 * a counter is EMPTY at the wrong half minute — so its four scripted pickets
 * attack-move ONTO the stores and never at them, and Bardin says so in as many
 * words on the first one. Three counters manned out of four is not a general
 * register; it is a register with a hostage, which is exactly what an allocation
 * office wants.
 *
 * ============================================================================
 * THE COUNTER IS THE ONE THING IN THE OPERATION THE PLAYER CAN DESTROY BY
 * WINNING TOO HARD
 * ============================================================================
 * The exchange is a SEAT 1 `civApartments` — 800 hp of `ArmorClass.Concrete`, a
 * two-by-three cell footprint whichever way the yaw turns it, so `hitRadius` is
 * the half-diagonal `sqrt(4^2 + 6^2)` = 7.211 m either way round — so it is a
 * legal target for every gun the player owns, and there are two routes to taking
 * it. Both are measured off the shipped tables:
 *
 *     THE LADDER   `Capture.resolve` softens `maxHp x CAPTURE.softenFrac` 0.25
 *                  through `ARMOR_MATRIX[HighExplosive][Concrete]` 1.00 and
 *                  `COMBAT_DAMAGE.globalMul` 0.80 = 0.20 of max per engineer,
 *                  against a `captureHpFrac` gate of 0.50: 1.00 -> 0.80 -> 0.60
 *                  -> 0.40. Three soften and the fourth takes it. Both numbers
 *                  are fractions of max, so the 800 hp cancels and the count is
 *                  four whatever the building is. **Four `rclTinker` at 500
 *                  apiece is 2 000 credits**, and forty seconds of one
 *                  `rclRookery`'s queue at `buildTime` 10.
 *
 *     THE SHORTCUT Shoot it to the gate and spend one engineer. Four
 *                  `rclGrinder` deliver `grinderArc` at **17.68 dps against
 *                  Concrete** apiece, so 800 -> 400 hp is **5.66 seconds** —
 *                  and 400 -> 0 is another 5.66. `Targeting` does not stop at
 *                  the gate; it acquires and fires until the target is dead.
 *                  **The shortcut and the loss are the same five and a half
 *                  seconds**, and `t.broken` ends the operation on the second
 *                  one.
 *
 * ============================================================================
 * **A CAPTURE DOES NOT MEND, SO THE COUNTER ARRIVES AT TWO FIFTHS AND EVERY
 * NUMBER DOWNSTREAM OF IT STARTS THERE**
 * ============================================================================
 * `Capture.resolve` writes `st.hp[t] = st.maxHp[t]` on its FRIENDLY branch and
 * ONLY there; the enemy branch softens, and then `captureBuilding` flips owner,
 * faction and flags and never touches health at all. So the two routes above do
 * NOT hand the player an 800 hp building — they hand back whatever the door
 * cost:
 *
 *     the ladder    0.40 x 800 = **320 hp**, exactly the third soften's residue
 *     the shortcut  at most **400 hp**, because the gate is `frac > 0.50` and a
 *                   capture is only offered at or under it
 *
 * Driven rather than derived: real `CaptureService` and real `DamageSystem`
 * against the exchange **this layout actually places** — headless build,
 * `mapSeed` 13 627 / `simSeed` 22 014, def tables bound, roster installed —
 * four engineers walked in one per tick, reading 800 -> 640 -> 480 -> 320, and
 * the fourth flips it to seat 0 **still at 320**.
 *
 * **THE MEND IS REAL, IT IS CHEAP, AND IT IS TOLD TO THE PLAYER ON THE TICK
 * THEY TAKE THE BUILDING.** Trap 23 again: this cannot live in a title, so
 * `t.taken` — which fires on both routes and on no other condition — says it.
 * Two ways, both measured in the same rig:
 *
 *     a fifth `rclTinker`   `Capture.resolve`'s friendly branch takes anything
 *                           under `repairThresholdFrac` 0.995 and writes maxHp.
 *                           **Instant, 500 credits**, so the whole ladder is
 *                           2 500 rather than 2 000 if the counter is to be
 *                           worth defending.
 *     the wrench            `RepairSell.setRepairing` gates on kind, owner,
 *                           Alive, UnderConstruction and `hp < maxHp` and asks
 *                           NOTHING about `Sellable` or the def key — measured,
 *                           it returns true for a captured `civApartments` and
 *                           mends 320 -> 800 in **480 ticks (16.00 s) for
 *                           120.0 credits** at `REPAIR_RATE` 30 hp/s and
 *                           `REPAIR_COST_PER_HP` 0.25.
 *
 * **THE WRENCH IS A BEFORE-THE-WAVE TOOL AND NOT A DURING-IT ONE**, which is
 * why the beat says to do it now. 30 hp/s against the fourth picket's 80.28 is
 * **-50.28 hp/s** while paying 450 credits a minute; it wins only against
 * nothing.
 *
 * That is a real decision with a real price and it is the reason the losing
 * condition exists at all. It is also the reason `t.counters` is UNCONDITIONAL
 * at forty seconds: `ObjectiveRow` is `{ id, title, kind, status }` — no
 * description, no tooltip (trap 23) — so "do not knock the counter down" cannot
 * live in a title and has to be in a beat nothing can outrun.
 *
 * **AND THE TWO POSTS HAVE TO GO FIRST.** The layout stands two `pillbox` role
 * keys beside the exchange; `op.foe` is Soviet, so `keyFor` resolves them to the
 * SENTRY GUN — `pillboxMg`, range 22, `chainCount` 0, `power: 0`, so no brownout
 * opens them — and they land 18.44 and 17.09 m of centre distance from the
 * building. One pull is `5 x 13 x ARMOR_MATRIX[SmallArms][Infantry] 1.00 x 0.80`
 * = **52.00 against an 85 hp `rclTinker`**, i.e. two pulls, and both posts
 * together are 131.64 dps, so **a clerk walked at that counter under fire lives
 * 0.65 seconds**. The ladder is not available until the posts are down.
 *
 * **AND CLEARING THEM PUTS THE PLAYER'S OWN GUNS INSIDE THE COUNTER'S
 * ACQUISITION ENVELOPE. THERE IS NO CELL THAT DOES NOT, AND THAT IS GEOMETRY
 * RATHER THAN A CHOICE THE PLAYER MAKES.** `Targeting.reachOf` gives an IDLE,
 * AGGRESSIVE hull `range x APPROACH_STOP_FRAC 0.80 + STANCE_CHASE_METRES
 * [Aggressive] 18`, measured against SURFACE distance, i.e. minus the target's
 * `hitRadius` — 7.211 for the exchange, 2.828 for a 1 x 1 sentry gun. Against
 * the FAR post at 18.44 m, the furthest a hull can stand and still fire on it
 * is `18.44 + range + 2.828`:
 *
 *     hull          range   envelope onto the exchange   furthest firing cell
 *     rclGrinder     18            39.61 m                     39.27 m
 *     rclSpitter     16            38.01                       37.27
 *     rclPicker      14            36.41                       35.27
 *     rclHulk        38            55.61                       59.27   <- a band
 *
 * Every hull this roster leaves the player is short by 0.34 to 1.14 m, and in
 * practice by far more, because `approach()` parks at `range x 0.80` of surface
 * rather than at the edge: a Grinder engaging the far post sits **35.67 m from
 * the counter's centre against a 39.61 m envelope**. `rclHulk` is the one
 * exception and it is a 3.66 m annulus a player would have to hold a hull in by
 * hand, since `approach()` drives through it.
 *
 * **MEASURED, WITH THE CONTROL THAT MAKES IT A MEASUREMENT.** Real
 * `TargetingSystem`, real defs, the built world: a Grinder on that park cell
 * with both posts dead acquires the exchange. **The same hull on the same cell
 * with the exchange already SEAT 0 acquires nothing** — so it is the deed and
 * not the rig, which is the control trap 34 exists for — a control that does
 * not isolate the thing it names launders a guess into a measurement. The
 * boundary reproduces `reachOf` to the metre: acquired at 32.0 m of surface and
 * not at 32.5, against a computed 32.40.
 *
 * **THE ANSWER IS DISTANCE AND THE STANCE IS WHAT SETS IT.** `reachOf` returns 0
 * for anything that does not chase, so on that same cell Defensive, Hold Ground
 * and Hold Fire acquire NOTHING — four stances, one cell, driven. That is a
 * SMALLER CIRCLE rather than immunity, and the sweep says how much smaller: a
 * Defensive Grinder still takes the counter from 19.2 m of surface and not from
 * 19.8, i.e. `range x COMBAT_TARGETING.acquireRangeMul 1.08` = **19.44 against
 * the chasing 32.40**. Seat 0 opens with **eleven hulls on Aggressive and seven
 * on Defensive**, so the default is the dangerous one, and `t.posts` is the beat
 * that says so the moment the establishment has no post left on the counter. It
 * is not a hole in the design; it is the reason the losing condition and its
 * warning both exist.
 *
 * ============================================================================
 * THE CLOSE, THE WINDOW AND WHERE 1320 CAME FROM
 * ============================================================================
 * **THE PAR IS DERIVED FROM THE OPERATION AND NOT FROM THE TABLE'S TOTAL, AND
 * THAT IS WORTH SAYING BECAUSE THE TOTAL IS ALREADY MET.**
 * `tests/campaign-length.spec.ts` arms its ten-hour floor at the 37th row, and
 * the 36 authored before this one sum to 36 900 s = 10.25 h — so the floor
 * passes at any legal par and nothing here was stretched to reach it. (With this
 * row the table is 38 220 s = **10.62 h across 37**, which is what the spec's
 * hard floor now holds the product to.) What the spec DOES hold from the first
 * row is a 10..30 minute band and a chapter's par never going backwards, and R9
 * is 21.
 *
 *     the counter sits            minute fourteen
 *     the counter shuts           minute twenty-two, which is `parSec` exactly
 *     the reading                 thirty seconds, and it restarts
 *
 * **FOURTEEN IS THE ESTABLISHMENT'S WHOLE HAND SHOWN BEFORE THE PLAYER COMMITS
 * TO FOUR SEPARATED POSITIONS.** Three pickets land at four, eight and twelve,
 * each pointed at a different piece of the district, and the window opens two
 * minutes after the last of them. Before that the player is doing one thing —
 * getting the counter — and the counter is 199.8 m of Foot walking from the
 * company corner with 2 000 credits of clerks and two sentry guns in front of
 * it.
 *
 * **AND SOMETHING FIRES ON THAT TICK NOW.** Until `t.opens` existed the only
 * trigger that could speak at fourteen was `t.reading`, whose condition is
 * `READY` — so a player already standing on all four counters was told the
 * window had opened and a player who was not got nothing at all, which is the
 * wrong way round: the second one is the one who needs a clock. Driven, capture
 * at 5:00 and four discs manned from 6:00, the old table went eight minutes
 * with two ACTIVE primaries and nothing but the two pickets at eight and twelve
 * between them. `t.opens` is unconditional and speaks in Bardin's voice for a
 * collision reason its own block gives.
 *
 * **EIGHT MINUTES OF WINDOW IS SIXTEEN CONSECUTIVE READINGS.** The reading is
 * thirty seconds and `elapsedSinceArmed` restarts it the moment any one of the
 * four discs empties (see `HELD`), so the window is not a deadline the player
 * meets once — it is how many times they may be interrupted and still finish.
 * Re-manning a cleared counter costs between 28.7 s (the closest pair, straight
 * line, a lower bound on any route) and 58.4 s, so eight minutes is between
 * eight and sixteen recoveries. A shorter window would make one interruption
 * fatal, which is a coin flip rather than a decision.
 *
 * **AND THE PAR IS THE DEADLINE RATHER THAN AN EXPECTED DURATION, WHICH IS A
 * REAL GAP AND IS STATED RATHER THAN GLOSSED.** Driven through the Director, a
 * player already standing on all four counters at the moment the counter sits
 * wins at **14:30** — seven and a half minutes inside par. That is the same
 * relationship `reclamation.03`, `.04`, `.05`, `.07` and `.09` all set (the
 * authored par IS the close, so the field is falsifiable from inside the
 * operation) and the same window shape `reclamation.08.contra-entry` ships. What
 * it costs is that a very fast clear reads shorter than the row says; what it
 * buys is that a slow one is not punished for being slow until four o'clock,
 * which on the operation that closes the campaign is the right way round.
 *
 * The fourth picket lands at minute seventeen, three minutes into the window, at
 * the exchange itself — the establishment coming back for its own counter. Four
 * `conscript` at 7.20 dps against Concrete and three `rhino` at 17.16 is
 * **80.28 dps**, re-derived from the shipped rows.
 *
 * **AND THE COUNTER IS NOT AT 800 WHEN THEY ARRIVE.** See the capture-cost block
 * above: a captured structure comes over at whatever the ladder left it, so the
 * climax is
 *
 *     off the ladder    320 hp  ->  **3.99 s**
 *     off the shortcut  400 hp  ->  4.98 s      (the arithmetic ceiling)
 *     mended            800 hp  ->  9.97 s      (a fifth clerk, or 16.00 s of
 *                                                wrench for 120 credits)
 *
 * An earlier draft of this paragraph quoted the 9.97 without the mend, which
 * overstated the counter's survivability at its own climax by two and a half
 * times, which is the defect trap 22 names. **Four seconds is
 * the honest figure for a player who does nothing after the capture**, and it is
 * why `t.taken` spends four of its six sentences on making the building good
 * rather than on the endorsement.
 *
 * That is the climax and it is the operation's `capture-hold` doing its work:
 * the thing you took at minute eight is the thing you have to still be holding
 * at four o'clock — and holding it starts with paying for the door twice.
 *
 * ============================================================================
 * THE PICKETS, MEASURED WITH THE ENGINE'S OWN EXPANDER
 * ============================================================================
 * Four workings off `ROAD` at (347.65, 160.95), 63.35 m out of the
 * establishment's gate. Twenty-seven hulls, **11 500 credits** (`conscript` 100
 * x16, `rhino` 900 x11), and the escalation is in the TARGET rather than in the
 * weight:
 *
 *     minute four        conscript x4, rhino x2   -> their own store
 *     minute eight       conscript x4, rhino x3   -> the Meridian house's store
 *     minute twelve      conscript x4, rhino x3   -> the company's last yard
 *     minute seventeen   conscript x4, rhino x3   -> the exchange
 *
 * **THAT ORDER IS NOT A DISTANCE ORDER AND THE FILE DOES NOT PRETEND IT IS**
 * (trap 17). Measured by Dijkstra over the real
 * `FlowFieldCache.costGridFor(MoveClass.Track)` on the built world with the
 * engine's own relaxation — 8-connected, destination-cell weight, diagonals at
 * `(nc * DIAG) | 0`, corner cut refused, **4 066 cells refused as
 * `COST_BLOCKED`**, normalised at `COST_UNIT` 100 and converted at `CELL` 4 m —
 * the four targets are **118.1 m, 157.7 m, 271.6 m and 155.8 m** in that order.
 * The third is the longest of the four and the fourth is shorter than the
 * second — and the third is not the longest walk on the map either: the Allied
 * house's store is **274.9 m** from the same point and no picket is ever sent
 * there. The escalation is in what is at stake, which is the honest thing to
 * say about it.
 *
 * (**The blocked-cell count is the instrument's own falsifier**, and it is
 * quoted for trap 21's reason: `COST_BLOCKED` is exported from
 * `src/world/terrain-gen.ts` and not from `src/core/config.ts`, and imported
 * from the wrong one it is `undefined`, every `nc >= undefined` is false, the
 * search walks through buildings and terrain alike, and the numbers come back
 * plausible, uniformly slightly too short, and green.)
 *
 * **THE RINGS ARE CHECKED, NOT SAMPLED.** `EffectSink.spawnUnits` lays a wave on
 * an exact ring at `angle = i / count * 2pi` and `ProductionService.spawnUnit`
 * writes the point VERBATIM — no `connectedGround`, no egress search — so a drop
 * on closed ground is a hull that starts the fight wedged. Every drop of every
 * ring against its own locomotor on the built world, clearance being the
 * distance to the nearest cell that locomotor cannot enter:
 *
 *     conscript x4  r=12  Foot     open, clearances 16 / 4 / 12 / 16 m
 *     rhino     x2  r=18  Track    open, 12 / 8
 *     rhino     x3  r=18  Track    open, 12 / 4 / 8
 *
 * — three distinct rings, nine distinct drop points, twenty-seven drops, all
 * open, worst clearance 4 m. `tests/campaign-spawn-ground.spec.ts` is the
 * standing gate and **a change to any `count` or `spread` invalidates this**,
 * because a wave of three does not stand where a wave of two does.
 *
 * The scripted pickets are not the whole of the pressure. The establishment
 * opens on `map.credits` with a full base — measured, 28 buildings and 13 units,
 * six `conscript`, five `rhino` and two harvesters — and `AiBrain.regroupSquads`
 * files every picket into a squad on its next pass, so the attack-move is the
 * first thing each wave does and the brain owns them afterwards. That is the
 * honest limit of what a scripted wave buys.
 *
 * ============================================================================
 * THE SECONDARY IS R9's LAST LINE PRICED
 * ============================================================================
 * `yard` — one `rclSorter` at (194, 348), 91.8 m from the company corner and
 * 112.1 m from the exchange, tagged and read as
 * `ownerCount(0, 'building', 'yard', min: 1)`. R9 ended with the nine breaking
 * yards the company is named for reduced to four. One of the four is on this
 * road, and the secondary is that the afternoon does not cost a fifth.
 *
 * **IT IS A COUNT ON SEAT 0 RATHER THAN AN `entityDead`, WHICH CATCHES A SALE
 * AND A DEMOLITION WITH ONE CONDITION.** The yard is the player's own and
 * `Sellable`; selling it for 950 credits at a moment when 950 credits would buy
 * two `rclSpitpost` and a clerk is a real move, and the secondary prices it
 * rather than forbidding it. `medalFor` returns silver only when every secondary
 * is complete, so the whole of what it costs is the medal — which is the correct
 * size for a decision the chapter's own ethic has already been paid for four
 * times.
 *
 * **AND IT COMPETES WITH THE PRIMARY FOR THE SAME BODIES, WHICH IS THE POINT.**
 * The third picket is pointed at it: 271.6 m of Track walking, the longest run
 * on the map, arriving at minute twelve — two minutes before the counter sits.
 * Four counters and a yard is five places, and the player does not have five
 * armies.
 *
 * ============================================================================
 * THE ROSTER
 * ============================================================================
 * `player: ['unit.raider']`, `ai: []`.
 *
 * The Arcspitter is carried forward from every operation in this chapter and it
 * is also what the base's own two `ifv` resolve to through `keyFor` — measured,
 * seat 0 opens with two `rclSpitter` — so deleting the id would delete two hulls
 * from the opening as well as the cameo.
 *
 * **WHAT THE PLAYER'S LIST WITHHOLDS IS THE MILITARY ANSWER, AND ON THIS
 * OPERATION THAT IS LOAD-BEARING RATHER THAN THEMATIC.** No `struct.tech`, so no
 * `rclCrucible` and therefore no `rclSlaghurler`, whose own blurb is *"The only
 * thing in the army that can break a base"*. No `struct.defence.specialist`, so
 * no `rclPylon`; the defence of four counters and a yard is `rclSpitpost` at 420
 * credits and `power: 0`. No `struct.support`, no `unit.air`, no
 * `unit.commander`. A player who would rather answer an allocation office by
 * levelling it is denied the tools by the same list that leaves them the
 * engineers, the Spitposts and the road.
 *
 * **THE EMPTY `ai` LIST KEEPS `teslaCoil` OFF THIS GROUND, AND HERE THAT IS THE
 * DIFFERENCE BETWEEN A HARD OPERATION AND AN IMPOSSIBLE ONE.** `SOVIET_DEFENCE`
 * seeds them; `teslaBolt` is range 30 with `chainCount` 2 and one pull is 153.60
 * then 92.16 against `ArmorClass.Infantry`. **Every man who decides this
 * operation is 85 hit points** — the `rclTinker` who take the counter and the
 * `rclPicker` who stand at the stores — so a coil would delete two of them per
 * trigger pull, and `tests/campaign-emplacement-reach.spec.ts` §2 exists because
 * `reclamation.01.held-paper` shipped exactly that. Measured on the built world
 * with this roster installed, the armed enemy structures are **`flameTower x2`
 * from the Soviet opening and `sentryGun x2` the layout stands on the exchange**,
 * and neither `flameJet` nor `pillboxMg` chains at all.
 *
 * ============================================================================
 * NEITHER SHIPPED OUTCOME RULE MAY END THIS
 * ============================================================================
 * `annihilationWin` because flattening a Continental Allocation establishment
 * endorses nothing — the instrument needs a counter and four stores, not a
 * casualty list — and the player is denied the one hull that could do it in any
 * case. `assetLossDefeat` because the operation authors its own three losses and
 * each of them names which objective failed.
 *
 * **THE ENDINGS PARTITION, AND THE PARTITION IS ARITHMETIC RATHER THAN TRIGGER
 * ORDER.** `runDirector` collects the effects of EVERY trigger whose condition
 * holds before `CampaignSession.apply` runs any of them, so ordering cannot make
 * two endings exclusive — only conditions can:
 *
 *     `t.win`        READY and the reading held, and NOT at the close
 *     `t.broken`     the exchange is dead                (=> not READY)
 *     `t.rout`       beaten AND the exchange alive       (=> not `t.broken`)
 *     `t.noCounter`  at the close, the exchange not ours
 *     `t.notRead`    at the close, the exchange ours
 *
 * `t.broken` and `t.win` cannot both hold because `structureCaptured` reads
 * `ownerOfTag`, which answers -1 when nothing carries the tag. The two closing
 * arms are exact complements over one predicate. And `t.win` carries
 * `not(CLOSED)` so that the closing tick belongs to the two arms alone: the cost
 * is a one-tick knife edge for a reading that would have completed on exactly
 * the closing tick, which every deadline has, which the player is warned about
 * at minute nineteen, and which was DRIVEN — case eight of the eleven below
 * ends in `t.notRead` at 1320 s with Tallow's line thirty seconds after the
 * reading's own.
 *
 * **`t.rout` AND `t.win` NEEDED A CONJUNCT TO SEPARATE THEM, AND THE ARGUMENT
 * THAT SAID THEY DID NOT WAS MEASURABLY FALSE.** The first draft reasoned that
 * `Viability.isBeaten` is *nothing to build with and nothing to fight with* and
 * that READY requires a unit inside each of four discs, so a player with four
 * units alive cannot be beaten. **`contestingUnits` excludes anything carrying
 * `EntityFlag.Garrisoned`** — its own header calls a garrison *"an emplacement
 * whose firepower happens to be stored in five entities"* — and this operation
 * tells the player, in its `captureProof` block, that garrisoning a bonded store
 * is a legal way of standing in its disc, because `Garrison.enter` writes the
 * host's position onto the man and `unitsInArea` does not filter the flag. So
 * base gone, four hands indoors at four stores is BEATEN and READY at the same
 * instant. Driven through the real `runDirector` it ended the operation in a
 * defeat ten seconds into the winning reading. `ROUT` carries `not(READY)` now.
 *
 * **EVERY ENDING AND EVERY EDGE WAS DRIVEN, THIRTEEN WORLDS, AND TWO OF THEM
 * CHANGED THE FILE. A LATER PASS DROVE 2 450 AND CHANGED IT THREE TIMES MORE —
 * SEE THE BLOCK AFTER THE TABLE.** Against the shipped Director at 30 Hz, with a stub
 * `WorldQuery` whose objective map IS `state.objectives` — the same map
 * `CampaignSession.setObjective` writes and `objectiveComplete` reads back,
 * because a harness that keeps its own copy measures a different game
 * (`reclamation.07.payment-in-kind` records exactly that mistake):
 *
 *     clean            counter at 8:00, four manned at 14:00 -> WIN at 14:30,
 *                        all three rows complete, SILVER
 *     yard late         the yard lost at 15:00, after a 14:30 win -> WIN, SILVER
 *                        (the loss lands after the operation has ended)
 *     counter levelled  dead at 6:00 -> LOSS naming `endorse`, `counter` FAILED
 *     rout              beaten at 10:00 with the counter ours -> LOSS naming
 *                        `endorse`, `counter` still COMPLETE, which is true
 *     no counter        never taken -> LOSS at 22:00 naming `counter`
 *     three of four     taken, never four manned -> LOSS at 22:00 naming
 *                        `endorse`
 *     interrupted       a disc emptied at reading-second twenty-five and re-
 *                        manned at forty -> the arm cleared and the WIN moved
 *                        from 14:30 to 15:10, which is `elapsedSinceArmed`
 *                        restarting the reading rather than pausing it
 *     knife edge        four manned at exactly 21:30 -> `t.reading` at 21:30 and
 *                        `t.notRead` at 22:00. One tick, one beat, a LOSS
 *     picket collision  the capture landing on the minute-eight picket tick ->
 *                        two beats, TWO speakers (Bardin and Cregg)
 *     picket spanned    a reading live across minute seventeen -> the fourth
 *                        picket is held off and the WIN lands at 17:20
 *     beaten and ready  the case above, before `not(READY)`: a DEFEAT under a
 *                        winning reading. Fixed, and it now wins at 14:30
 *     yard lost early   lost at 10:00 -> `t.yardLost` fires SILENTLY at 10:00
 *                        and the 14:30 win is BRONZE. The falsifier for the
 *                        secondary: without it every driven row reads
 *                        `yard=complete` and the row could not fail at all
 *     call collision    the capture landing on exactly tick 34 200 -> `t.taken`
 *                        at 34 200 and `t.callShort` at 34 201. One Cregg line
 *                        each, on separate ticks, which is what the
 *                        `objectiveComplete` read in that arm buys
 *
 * **EVERY ONE OF THE THIRTEEN ENDS ON EXACTLY ONE `endOperation`, AND THE MOST
 * ANY DECIDING TICK CARRIES IS TWO BEATS FROM TWO SPEAKERS** — the win (Cregg
 * then Tallow) and `t.noCounter` (Bardin then Tallow). The busiest NON-ending
 * tick is the same two: a capture landing on a picket's tick, which the ninth
 * row above is. **No tick in any of the thirteen carries two lines from one
 * speaker**, which is the bound `pact.06.common-ground` failed and the reason
 * `t.rout` speaks in Tallow's voice and `t.callShort` reads a resolved
 * objective rather than the capture itself.
 *
 * ============================================================================
 * AND THEN THE TABLE WAS SWEPT RATHER THAN SAMPLED, WHICH FOUND THREE THINGS
 * THIRTEEN HAND-PICKED WORLDS COULD NOT
 * ============================================================================
 * The thirteen above are the cases somebody THOUGHT OF. A cross product of ten
 * post-death times, seven capture times, seven manning times and five levelling
 * times — **2 450 worlds, each driven through the real `runDirector` at 30 Hz
 * to twenty-three minutes** — is the cases nobody did, and it is what the two
 * beats added below were validated against. Three defects, all invisible from
 * the source:
 *
 *   - **`t.callCounter` ON A DECIDING TICK.** `not(CAPTURED)` is true for a
 *     counter never taken AND for one taken and then levelled, and the trigger
 *     stays eligible for the whole three minutes — so a player-held exchange
 *     destroyed anywhere in 19:00..22:00 got Cregg saying *"the counter is still
 *     theirs"* one beat before Tallow said it was down, under a defeat. Driven
 *     at five levelling times, five of five. `COUNTER_STANDING` closes it, and
 *     the control is the same levelling at 18:50, which ends on Tallow alone.
 *   - **`t.posts` MEETING `t.callCounter`.** Posts falling on tick 34 200 read
 *     **Cregg, Cregg**. `not(CALL)` closes it.
 *   - **A THREE-BEAT TICK.** A capture landing on exactly 25 200 with all four
 *     counters already manned fired `t.taken`, `t.opens` and `t.reading` at
 *     once — three speakers, one more than this file's bound. `not(READY)` on
 *     `t.opens` closes it.
 *
 * After all three: **2 450 worlds, most beats on any one tick TWO, zero ticks
 * with two lines from one speaker, and exactly one `endOperation` in every
 * world.** That last figure is the one worth re-running after any edit to the
 * table, because it is the only property here that a new trigger can break
 * without anybody noticing.
 *
 * ============================================================================
 * WHAT WAS CONSIDERED AND CUT
 * ============================================================================
 *   - **A FOUR-ARMY FINALE.** The chapter's blurb is *"every faction as a
 *     customer"* and four seats is the obvious closing image. It is refused on a
 *     mechanism rather than on taste: `applySetupToWorld` seats through
 *     `effectiveOpponents`, which re-asserts the SINGULAR `aiFaction` onto entry
 *     0, and there is no alliance declaration next to `foe` — so a third and
 *     fourth army would be mutually hostile to each other and to the player, and
 *     an operation whose fiction is four houses acting together would render as
 *     a four-way brawl. The four houses are in this operation as four BONDED
 *     STORES, which is what the fiction actually needs and what the engine can
 *     say.
 *   - **A `credits` THRESHOLD.** Nothing in this file is priced in credits and
 *     that is deliberate: `rclHeap` is 1 500 of storage for 150 credits and
 *     carries no `UNLOCK_TAGS` id, so no roster can defend a credits bar (trap
 *     32) and any such bar reduces to a purchase order. It also means this
 *     header owes no economy measurement, and it does not make one — driving a
 *     twenty-two minute rig without `OreField.regrow` understates delivery by
 *     more than three times (trap 36), and the honest answer to a number you do
 *     not need is not to quote it.
 *   - **A HIDDEN OBJECTIVE.** Three rows is exactly `MAX_VISIBLE_OBJECTIVES`, so
 *     this is the one operation in the chapter whose panel never shows a
 *     "+N more" line. On the operation that closes the campaign, all three of
 *     the player's obligations being readable without expanding a panel is worth
 *     more than a fourth row.
 *   - **PROTECTING THE STORES.** Unfalsifiable — nothing on the map can shoot a
 *     Gaia structure. See the block above.
 *   - **AN `elapsedSinceArmed` HOLD ON `counter` AS WELL.** "Hold the exchange
 *     for N minutes" is the obvious second half of `capture-hold` and it is
 *     redundant here: `t.win` reads `structureCaptured` at the same instant it
 *     reads the four discs, so the exchange has to be ours AT the reading, and
 *     the fourth picket is authored to arrive between the two. A second hold
 *     timer would restate that and add an arming pass to a trigger evaluated
 *     every tick.
 * ========================================================================== */

import { Faction } from '../../../core/types';
import { minutes, seconds } from '../../types';
import type { Area, Condition, OperationDef } from '../../types';
import {
  COUNTER_ALLIED, COUNTER_MERIDIAN, COUNTER_OURS, COUNTER_THEIRS,
  EXCHANGE, EXCHANGE_AREA, ROAD, SIM_SEED, STORE_MERIDIAN, STORE_THEIRS, YARD,
} from '../../layouts/reclamation-without-recourse';

/**
 * How long the layout is given to have placed the district before a zero
 * threshold over it is believed.
 *
 * **EVERY `max:`-SHAPED THRESHOLD THAT CAN FIRE BEFORE THE CLOSE IS CONJOINED
 * WITH IT.** `entityDead` reads TRUE against an empty tag registry and
 * `ownerCount(..., max: 0)` reads TRUE the same way — the spelling changed and
 * the hazard did not. Unguarded, `t.broken` would end the operation in a defeat
 * on the first tick the Director runs and `t.yardLost` would fail the secondary
 * on the same one.
 *
 * **IT GUARDS A LAYOUT THAT PLACED NOTHING, NOT A TICK-ONE READ THAT HAPPENS
 * TODAY.** `scenarios.system.ts` builds the world inside `async init()` and
 * `SystemRegistry.init` awaits every module's init before a tick is taken, so
 * the registry is never empty when the Director first runs. What IS reachable is
 * a roster typo or a footprint that will not fit, which
 * `tests/campaign-roster-ground.spec.ts` and `tests/campaign-maps.spec.ts` catch
 * at their causes; this stops the symptom being instant.
 *
 * `structureCaptured` needs no such guard and carries none: `ownerOfTag` answers
 * -1 for a tag nothing carries, and -1 is not seat 0.
 */
const SETTLE: Condition = { on: 'elapsed', ticks: seconds(20) };

/**
 * When the counter sits. See the header: two minutes after the third picket, so
 * the establishment's whole hand is on the table before the player commits to
 * four separated positions.
 */
const OPEN: Condition = { on: 'elapsed', ticks: minutes(14) };

/**
 * The close of the counter. EXACTLY `parSec`, to the second.
 *
 * The authored par IS the deadline rather than a description of one, which is
 * the only way that field is falsifiable from inside the operation —
 * `reclamation.03.sold-twice` sets the same relationship at 900,
 * `.04.served-notice` at 960, `.05.closing-entry` at 1020,
 * `.07.payment-in-kind` at 1140 and `.09.book-value` at 1260.
 */
const CLOSE = minutes(22);

const CLOSED: Condition = { on: 'elapsed', ticks: CLOSE };

/**
 * How long the endorsement takes to read out with a hand at every store.
 *
 * Thirty seconds, and `elapsedSinceArmed` is what makes it a HOLD rather than an
 * instant: the Director evaluates the trigger twice, once with every arm timer
 * forced true to decide whether the trigger's OTHER conditions hold — which sets
 * or clears the arm tick — and once for real. So a counter that empties at
 * second twenty-five restarts the reading from the top, which is what the
 * establishment is buying with four pickets and what Cregg says out loud at
 * fifty-eight seconds.
 */
const READING = seconds(30);

/** The exchange is on the company's books. Capture only; a corpse reads -1. */
const CAPTURED: Condition = { on: 'structureCaptured', tag: 'exchange', player: 0 };

/** There is no counter left in this district. */
const COUNTER_GONE: Condition = { on: 'entityDead', tag: 'exchange' };

/** There is. `t.rout`'s guard, so a rout and a levelled counter cannot both end it. */
const COUNTER_STANDING: Condition = { on: 'entityAlive', tag: 'exchange' };

/**
 * One of ours inside one counter disc.
 *
 * **UNTAGGED ON PURPOSE, AND IT IS THE EXPENSIVE SPELLING.** `runtime.ts` says
 * so in as many words: the tagged branch walks the tag and the untagged branch
 * walks `store.alive`. It is still right here — a tag can only cover what the
 * LAYOUT placed, and every clerk the player builds after tick zero would be
 * invisible to it. The cost is bounded by trigger ORDER rather than by the tag:
 * every trigger that names `FOUR` puts a cheap `elapsed` first, and `holds`
 * short-circuits an `all` on its first false child, so before minute fourteen
 * the discs are not walked at all.
 */
const at = (area: Area): Condition => ({ on: 'unitsInArea', player: 0, area, min: 1 });

/** All four counters manned at one instant. */
const FOUR: Condition = {
  on: 'all',
  of: [at(COUNTER_OURS), at(COUNTER_ALLIED), at(COUNTER_MERIDIAN), at(COUNTER_THEIRS)],
};

/**
 * The endorsement is readable: the counter sits, it is ours, and there is a hand
 * at every store.
 *
 * **TIMER-FREE ON PURPOSE.** It is the arming predicate of `t.win`, and it is
 * also the guard that keeps every chatty trigger off the winning tick — `t.win`
 * cannot fire unless this has held for `READING`, so a trigger carrying
 * `not(READY)` cannot share a tick with it. Putting an `elapsedSinceArmed` in
 * here would break both jobs at once: under an `any` an arm timer reads TRUE
 * during the arming pass, so the whole branch arms on the first tick anything
 * else in the `any` is true and the timer then measures from the wrong moment.
 */
const READY: Condition = { on: 'all', of: [OPEN, CAPTURED, FOUR] };

/** The reading, held. */
const HELD: Condition = { on: 'elapsedSinceArmed', ticks: READING };

/** The last yard on this road is still on the company's books. */
const YARD_STANDING: Condition = {
  on: 'ownerCount', player: 0, role: 'building', tag: 'yard', min: 1,
};

/**
 * It is not.
 *
 * `max: 0` on SEAT 0 catches a SALE and a DEMOLITION with one condition, which
 * is why the threshold is not `entityDead`: the yard is the player's own and
 * `Sellable`, and `ownerCount` cannot tell the two apart — which for this
 * secondary is correct, because the row is about whether the company still has
 * it and not about how it stopped having it.
 */
const YARD_GONE: Condition = {
  on: 'ownerCount', player: 0, role: 'building', tag: 'yard', max: 0,
};

/**
 * The establishment has no gun post left on the counter — killed OR taken.
 *
 * **`ownerCount(1, ..., max: 0)` AND NOT `entityDead('guard')`, WHICH IS TRAP 9
 * IN ITS OWN RIGHT.** `entityDead` is `aliveWithTag === 0`, so a `sentryGun` the
 * player captured instead of levelling reads ALIVE forever and the beat this
 * arms would never come — on the one route out of the hazard it exists to warn
 * about. A count on SEAT 1 is blind to which way the post stopped being theirs,
 * which is the only property that matters here.
 *
 * `max: 0` reads TRUE against an empty registry exactly as `entityDead` does, so
 * it carries a settle guard like every other `max:`-shaped threshold in this
 * file. `t.posts` uses SIXTY SECONDS rather than `SETTLE`'s twenty, and sixty is
 * the SMALLEST value that works rather than a round number: the three opening
 * beats are at twenty-two, forty and fifty-eight seconds and **every one of them
 * carries a Cregg line**, so anything under 1 740 ticks can put two of his on
 * one tick. Sixty is also as short as it can be made, and that is the direction
 * that matters — the hazard it warns about is four seconds wide.
 *
 * **THE FASTEST CONCEIVABLE CLEAR IS INSIDE IT AND THAT IS STATED RATHER THAN
 * GLOSSED.** 220.0 m of Track from the company corner over the real cost grid
 * to the nearer of the two guards, an `rclGrinder` at `maxSpeed` 5.8, and
 * 2 x 480 hp of `sentryGun` against four of them at 17.68 dps vs Concrete
 * apiece: **37.9 + 13.6 = 51.5 seconds** with no acceleration, no steering and
 * perfect focus. So a player who does nothing
 * else can have this beat land at sixty, eight and a half seconds behind
 * `t.hours`. (198.4 m is not reachable by any route: the STRAIGHT LINE from
 * the corner to either landed `sentryGun` — they stand at (254, 238) and
 * (274, 262) — is 203.67 m, so no grid route between them can be shorter.
 * Measured from the corner's nearest open cell the two Track routes are 228.74
 * and 220.05 m, identical on the descent and cheapest-predecessor chains, and
 * from the Foundry 216.74 and 208.05; the four `rclGrinder` start positions
 * give 176.74 to 204.74. The conclusion is unaffected — 51.5 s is still inside
 * the sixty — so this is a margin claim that was 8% tighter than stated.)
 * That is the case `Shell.campaignBeatSeq` was written for (trap 13) and it is two
 * speakers, not three.
 */
const POSTS_GONE: Condition = {
  on: 'ownerCount', player: 1, role: 'building', tag: 'guard', max: 0,
};

/**
 * Three minutes on the counter — the fairness call `reclamation.05` states and
 * `.09` reuses, and the ONE tick in the operation on which two Cregg lines could
 * meet.
 *
 * Named rather than inlined three times because `t.posts` excludes it by
 * NEGATION and an exclusion that has to agree with two other literals is how the
 * three come to disagree.
 */
const CALL: Condition = { on: 'elapsed', ticks: minutes(19) };

/**
 * The fourth picket's hour. Named for `CALL`'s reason: `t.fourth` fires on it
 * and `t.opens` excludes it, and the two are in the same voice.
 */
const WAVE: Condition = { on: 'elapsed', ticks: minutes(17) };

const BEATEN: Condition = { on: 'playerBeaten', player: 0 };

/** There is no counter left to enter anything in. */
const BROKEN: Condition = { on: 'all', of: [SETTLE, COUNTER_GONE] };

/**
 * Beaten, with a counter still standing and no reading in progress.
 *
 * **`not(READY)` IS NOT DECORATION AND THE FIRST DRAFT DID NOT HAVE IT.** Driving
 * this table through the real `runDirector` — case eleven, `beaten` raised while
 * all four discs were manned — ended the operation in a DEFEAT ten seconds into
 * a reading that was going to win. The argument the first draft rested on was
 * that a player with four units standing in four discs cannot be beaten, and
 * **that argument is measurably false on this operation specifically**:
 * `Viability.isBeaten` is `!canRebuild && !canContest`, and `contestingUnits`
 * EXCLUDES anything carrying `EntityFlag.Garrisoned` — *"a garrison is an
 * emplacement whose firepower happens to be stored in five entities"*. This
 * operation's own `captureProof` block records that garrisoning a bonded store
 * is a legal and rather literal way of standing in its disc, and
 * `WorldQuery.unitsInArea` counts a garrisoned man because `Garrison.enter`
 * writes the host's position onto him. So a commander whose base is gone and
 * whose last four hands are indoors at four separate stores is BEATEN and READY
 * at the same instant, and without this conjunct `t.rout` puts Tallow's defeat
 * line on the tick `t.win` is paying the account.
 *
 * `COUNTER_STANDING` is what keeps it off `BROKEN`'s tick. All three conjuncts
 * are timer-free, so this is safe inside the `any` below — see `READY`.
 */
const ROUT: Condition = {
  on: 'all',
  of: [BEATEN, COUNTER_STANDING, { on: 'not', of: READY }],
};

/**
 * The tick the operation is decided on, minus the win.
 *
 * Three loss shapes, all timer-free, so this may be used inside an `any` without
 * the arming hazard `READY`'s block describes. The WIN is deliberately not in
 * here — it cannot be expressed without `HELD` — and it does not need to be: the
 * only thing this is used for is resolving the secondary silently at an ending,
 * and the win has its own arm for that.
 */
const LOST: Condition = { on: 'any', of: [CLOSED, BROKEN, ROUT] };

const op: OperationDef = {
  id: 'reclamation.10.without-recourse',
  chapter: 'reclamation',
  faction: Faction.Reclaim,
  /*
   * THE SOVIETS, AND IT CLOSES THE CHAPTER ON THE ARMY THAT OPENED IT.
   *
   * `reclamation.01.held-paper` is a Soviet garrison sitting on yards it never
   * read the paper for and `.02.written-off` is a field a Soviet office wrote
   * off in week two. Both are the same institution making the same mistake: a
   * figure decided at height, and the ground told afterwards what it produced.
   * This is that institution nine operations later, having read the book, and
   * understanding it perfectly.
   *
   * **THE MOTIVE IS `soviets.09.nil-return`'s OWN, TURNED AROUND.** That
   * operation's header says what an office at that height is FOR: re-reading a
   * sector's history out of a document it did not write and declining to believe
   * it. A district register four houses may check against delivery notes is the
   * end of that, permanently and for everybody — so Bardin is not here for a
   * yard and not here for the book. He is here to see that a counter is empty
   * for half a minute.
   *
   * It is the chapter's fourth operation against the Soviets, which puts Salvage
   * Rights at four Soviet, four Allied and two Meridian, and it is the only one
   * of the four in which the establishment wants the player to KEEP something.
   *
   * Every scripted key on seat 1 is a literal Soviet `conscript` or `rhino`,
   * which `validateCampaign` checks against the army of the seat it lands on.
   */
  foe: Faction.Soviets,
  index: 10,
  title: 'Without Recourse',
  beat: 'Four bonded stores, four fair copies, one moment. After today the book is nobody\'s, '
    + 'which is the only way it was ever going to be worth anything.',
  /*
   * CAPTURE-HOLD, AND IT IS THE CHAPTER'S SECOND. See the header for the
   * argument and for the four shapes that were costed first: `validateCampaign`
   * refuses only ADJACENT repeats, R9 is `economy`, and R3's possession settling
   * an argument against R10's possession BEING the argument is the difference
   * the repeat is for.
   */
  primaryType: 'capture-hold',
  /*
   * BESPOKE. Objective state in both directions, four spawn waves with orders,
   * five reveals, a camera move, dialogue, EVA and an outcome — the definition
   * in `types.ts` is "multiple effect kinds", and this is NINE of the eleven.
   * `setObjective` is unused because no objective is hidden, and `grantCredits`
   * because nothing in this operation is priced in credits; both absences are
   * argued in the header rather than left to be noticed.
   */
  archetype: 'bespoke',
  parSec: 1320,
  requires: ['reclamation.09.book-value'],

  map: {
    /*
     * URBAN ON BOTH LINES, WHICH IS THE ONE PAIRING THAT CANNOT MAKE R3's
     * MISTAKE. `MAP_PRESETS` and `BiomeName` overlap on `temperate`, `snow` and
     * `urban` and disagree on exactly one name — the preset is `arid`, the biome
     * is `desert` — and `reclamation.03.sold-twice` shipped on the wrong side of
     * that and measured two headers' worth of numbers against ground it had not
     * declared. This pair is the same word twice.
     *
     * `MAP_PRESETS.urban` is *Industrial Grid*, which is what a district of
     * bonded stores and an exchange is, and it breaks the preset R9 is on
     * immediately before this. The layout's header carries the ninety-roll sweep
     * that chose it, including the temperate roll that scored better and why it
     * lost.
     */
    preset: 'urban',
    /**
     * The survey designation. 13-627 is the number in the briefing and it is the
     * seed the layout swept for: of ninety rolls across three presets, scored
     * against the eight stations this composition needs, it is the best urban
     * roll — total ring search five, with the forming-up point on its own
     * authored cell — and the offsets were then swept on it until every station
     * sat at ring zero.
     *
     * Pinned by `tests/campaign-maps.spec.ts` as a terrain fingerprint: a
     * generator change that re-rolls this ground moves every measured placement
     * in both headers.
     */
    mapSeed: 13_627,
    /*
     * IMPORTED FROM THE LAYOUT, WHICH OWNS IT.
     *
     * `simSeed` decides which two corners the match is played in, and every
     * point the trigger table below names is computed from exactly that in
     * `reclamation-without-recourse.ts` — out of `seatedSlots`,
     * `SKIRMISH_START_OFFSETS` and `MAP_SIZE`, at module load, arithmetic rather
     * than measurement. Writing the number here as well would be the same fact
     * in two files, and the failure mode — a disc where no store stands, a
     * picket forming up on open ground — is invisible to every gate.
     */
    simSeed: SIM_SEED,
    armies: 2,
    biome: 'urban',
    /*
     * `base`. The second primary is four bodies at four places and the player
     * has to be able to MAKE them: `rclTinker` is 500 credits out of a Rookery
     * and a Sorter, and the capture ladder alone is four of them. A fixed force
     * would make the whole operation an inventory problem and would make losing
     * one clerk to a sentry gun unrecoverable.
     */
    opening: 'base',
    /*
     * 5 000, the same opening `.05.closing-entry`, `.06.in-duplicate` and
     * `.08.contra-entry` use.
     *
     * The capture ladder is 2 000 of it before anything is defended, and the
     * counter arrives at two fifths of its health because `Capture.resolve`
     * mends nothing on the enemy branch — so the number this bank is really
     * sized around is **2 500: four clerks for the door and a fifth to make the
     * building good**, or 2 000 and 120 credits of wrench over sixteen seconds.
     * What is left buys the Spitposts and the hands that hold four discs.
     *
     * `Shell.applySimPostBoot` writes `startingCredits` into every non-Neutral
     * slot, so it binds the establishment too — half the skirmish default, for
     * CLAUDE.md's measured reason: a brain with a 10 000 opening puts up a
     * seven-building base and eleven troops by t+90 s having mined nothing.
     */
    credits: 5_000,
  },
  layout: 'reclamation-without-recourse',

  // NEITHER SHIPPED RULE MAY END THIS. See the header: the operation authors
  // one win and three losses, and they partition by condition rather than by
  // trigger order.
  outcome: { annihilationWin: false, assetLossDefeat: false, ignoreSeats: [] },

  roster: {
    player: ['unit.raider'],
    ai: [],
  },

  /*
   * THE FOUR BONDED STORES MAY NOT BE TAKEN, AND THIS IS THE OPERATION'S THESIS
   * AS A FLAG BIT.
   *
   * `reclamation.06.in-duplicate` is the precedent and the reason is measured
   * rather than aesthetic. `Capture.resolve` rule 1 takes a NEUTRAL structure
   * outright, at ANY health, for one engineer, and `consume` spends him — so
   * without this the single most natural click in the operation, select a clerk
   * and right-click the store you were just told to stand in, costs 500 credits
   * and does not put anybody in the disc. With it,
   * `resolveContextOrder`'s neutral branch is guarded by `capturableNow`, the
   * cursor never offers Capture, `caps.canCapture` skips the garrison branch
   * below it, and the order resolves to Move — which is exactly what
   * `unitsInArea` is waiting for. It does not merely refuse the click; it
   * corrects it.
   *
   * And it is the fiction as much as the mechanism: a bonded store the
   * Reclamation holds is not bonded, which is R6's whole finding about the
   * counterpart and the argument this operation exists to finish.
   *
   * **THE RESIDUAL IS DECLARED RATHER THAN CLOSED, AND IT IS WORSE THAN THIS
   * BLOCK USED TO SAY.** `GarrisonService.enter` calls `captureBuilding()`
   * directly and consults no `CaptureService` veto — `allies.07.fair-copy`'s
   * finding — so a squad of `rclPicker` walked into a store still flips its
   * deed, and the veto CANNOT be made to cover it. Nothing in this file reads a
   * store's owner: the four discs count GROUND, and a garrisoned man takes the
   * host's position (`Garrison.enter` writes `st.posX[i] = st.posX[t]`), so a
   * garrisoned man does satisfy `endorse`.
   *
   * This block used to stop there — *"the deed moves and no threshold notices"*
   * — and that sentence is true about the THRESHOLDS and false about the
   * TARGETING RULE, which is the one inference that matters.
   * `Targeting.isValidTarget` refuses ALLIES and nothing else, so a store with
   * the company's flag over it is a legal Soviet target, and two of the four
   * scripted pickets are attack-moved onto store ground. See the bonded-store
   * block above for the measured pair. **So garrisoning is legal, it is not
   * recommended, and it is priced**: it buys a body that cannot be shot at
   * individually and costs an 800 hp building that can, plus up to five men when
   * it goes. `t.hours` says so in Tallow's voice at fifty-eight seconds, which
   * is the only place a player can be told.
   *
   * `ROUT`'s block below depends on the state being REACHABLE and not on its
   * being advisable — `contestingUnits` excludes garrisoned men, so base-gone
   * plus four hands indoors is beaten and READY at once whether or not anybody
   * recommends getting there.
   *
   * `exchange` is deliberately NOT in the list. The operation's first primary is
   * that it changes hands.
   */
  captureProof: ['store'],

  /*
   * THREE ROWS, NONE HIDDEN, AND THE PANEL SHOWS ALL THREE.
   *
   * `MAX_VISIBLE_OBJECTIVES` in `ui/Objectives.ts` is 3, so this is the one
   * operation in the chapter with no "+N more" line at any point in the match.
   * On the operation that closes the campaign, every obligation being readable
   * without expanding a panel is worth more than a fourth row — see the cut list
   * in the header.
   */
  objectives: [
    {
      id: 'counter',
      kind: 'primary',
      /*
       * "TAKE ... BACK OFF THEM", NOT "CLEAR". The rule is
       * `structureCaptured('exchange', 0)`, which is satisfied by ONE verb only:
       * a levelled exchange is owned by nobody and `ownerOfTag` answers -1. A
       * title saying "clear" would name a route that loses the operation, and
       * trap 23 says the title is the only sentence the player gets.
       */
      title: 'Take the district exchange back off the establishment, standing',
    },
    {
      id: 'endorse',
      kind: 'primary',
      /*
       * FOUR FACTS IN ONE LINE, BECAUSE THERE IS NO SECOND LINE: all four, at
       * once, there is a reading, and it happens inside a WINDOW.
       *
       * **THE WINDOW USED TO BE MISSING AND THAT WAS HALF THE ROW.** Two of the
       * five conjuncts behind this objective are the clock — `OPEN` at fourteen
       * and `not(CLOSED)` at twenty-two — and a title naming neither told a
       * player who was standing on all four counters from minute six that they
       * were already done. `parSec` is rendered on the campaign selection screen
       * (`Shell/Campaign.ts#parLabel`) and NEVER as an in-match clock, so the
       * title is the only place either end can be stated.
       * `reclamation.08.contra-entry` names both ends in both of its primaries
       * — *"before the count closes"*, *"when the count opens"* — and this is
       * that, in the clock language `t.hours` teaches at fifty-eight seconds.
       * 77 characters against a shipped longest of 78.
       *
       * What it still cannot carry is the length of the reading or that an
       * emptied counter restarts it; those are `t.hours`, and WHEN the hour
       * falls is `t.opens` at minute fourteen, both on unconditional triggers,
       * which is trap 23's own prescription.
       */
      title: 'Hold all four bonded stores at once for the reading, from the hour until four',
    },
    {
      id: 'yard',
      kind: 'secondary',
      /*
       * "STILL ON OUR BOOKS" IS AN OWNERSHIP CLAIM AND THE RULE IS AN OWNERSHIP
       * COUNT, which is the pairing trap 23 exists for: the yard is the player's
       * own and `Sellable`, so the row has to cover a sale and a demolition
       * without naming either mechanism. "On our books" does.
       *
       * NO `credits` FIELD. The row is a restraint, and paying a player for not
       * selling something would be paying them the thing they declined to sell.
       * What it pays is the medal — `medalFor` gives silver only when every
       * secondary is complete.
       */
      title: 'Finish the day with the last yard on this road still on our books',
    },
  ],

  triggers: [
    /* -- the instrument, in two beats --------------------------------------
     * Split across the first minute because the shell renders dialogue as toasts
     * and four at once is a stack nobody reads — and because two speakers inside
     * six seconds is exactly the case `Shell.campaignBeatSeq` was written for,
     * so both halves of each beat really do arrive (trap 13).
     *
     * **NOTHING IN THIS FILE CAN OUTRUN AN OPENING BEAT.** The earliest ending
     * is `t.broken`, which needs the player to have shot their own objective
     * flat, and the win cannot fire before minute fourteen by construction.
     */
    {
      id: 't.open',
      when: { on: 'elapsed', ticks: seconds(4) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Tallow',
          text: 'The account is settled, the yards are four, and every house on this continent '
            + 'now reads a book that one house keeps. I have been told all week that the keeping '
            + 'is the asset. It is the opposite. A record is worth what it costs the party who '
            + 'wrote it, and ours has cost us nothing since the day we lodged the counterpart.',
        },
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'Which is why we are stood on a haul road with four fair copies and a form of '
            + 'words. Endorsed to the four houses jointly, without recourse — we cannot be paid '
            + 'for reading it, we cannot be leaned on to alter it, and we cannot be answered to '
            + 'if a house declines to honour a line in it. By tonight we are a customer in our '
            + 'own book.',
        },
      ],
    },

    /* -- the four stores ----------------------------------------------------
     * The reveals go over the four counters and NOT over the company yard: those
     * are the player's own structures and a reveal on ground they already hold
     * shows nothing and reads as the briefing padding itself. `revealArea`
     * EXPLORES ground rather than showing live units, so what this draws is the
     * map and not an intelligence report.
     */
    {
      id: 't.stores',
      when: { on: 'elapsed', ticks: seconds(22) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Tallow',
          text: 'Four bonded stores in this district, one for each house\'s papers, and the '
            + 'copies go in at the same moment. That is not ceremony. An endorsement read to one '
            + 'house first is an endorsement that house can claim priority under, and the whole '
            + 'of what this thing is worth is that nobody in it is ahead of anybody.',
        },
        { do: 'revealArea', player: 0, area: COUNTER_OURS },
        { do: 'revealArea', player: 0, area: COUNTER_ALLIED },
        { do: 'revealArea', player: 0, area: COUNTER_MERIDIAN },
        { do: 'revealArea', player: 0, area: COUNTER_THEIRS },
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'Ours is on the west side of the road, the Allied house\'s is behind us, the '
            + 'Meridian\'s is past the middle, and the fourth one is inside their own gate. '
            + 'Whoever carries that copy is carrying it to a party that would very much rather '
            + 'it burned.',
        },
      ],
    },

    /* -- the counter, and the one mechanism the player cannot see -----------
     * UNCONDITIONAL, AT FORTY SECONDS. `ObjectiveRow` is `{ id, title, kind,
     * status }` — no description and no tooltip — so "do not knock it down"
     * cannot live in a title, and it is the fastest way to lose this operation.
     * Trap 23, answered the way that trap says to answer it.
     *
     * THE ONE `cameraMove` IN THE OPERATION. `types.ts` says the camera is for
     * an arrival, a loss or a reveal and not for punctuation; this is the one
     * object on the map that everything else in the file depends on and it is
     * 193 m from where the player is standing.
     */
    {
      id: 't.counters',
      when: { on: 'elapsed', ticks: seconds(40) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'And it all has to be entered at one counter — the district exchange, middle of '
            + 'the road, with a Continental Allocation establishment sitting in it that has not '
            + 'opened the doors in nine days. Two gun positions on the front of it.',
        },
        { do: 'revealArea', player: 0, area: EXCHANGE_AREA },
        { do: 'cameraMove', at: EXCHANGE },
        {
          do: 'dialogue',
          speaker: 'Tallow',
          text: 'Take it off them and do not knock it down. There is no second counter in this '
            + 'district, and four copies in four warehouses with nothing entered against them is '
            + 'four sheets of paper. Send men in and take it standing.',
        },
      ],
    },

    /* -- the hours, and the hold -------------------------------------------
     * The second half of trap 23: the reading's LENGTH and the fact that it
     * restarts are the two things `elapsedSinceArmed` does that no title can
     * say. Unconditional, at fifty-eight seconds, thirteen minutes before the
     * counter can sit.
     */
    {
      id: 't.hours',
      when: { on: 'elapsed', ticks: seconds(58) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'The counter sits from the hour and shuts at four. The reading takes half a '
            + 'minute with a hand standing at every store at once, and if any one of the four '
            + 'empties while it is being read, it starts again from the top.',
        },
        {
          do: 'dialogue',
          speaker: 'Tallow',
          text: 'Which is the whole of their afternoon. They will not burn a store while it '
            + 'belongs to nobody — nothing on this road puts a shell into a thing that is not '
            + 'anybody\'s. So stand your hands beside them and not inside them: a man indoors '
            + 'moves the deed to us, and then it is our building on their road. They only have '
            + 'to see one counter of the four empty at the wrong half minute.',
        },
      ],
    },

    /* -- the posts are off the counter --------------------------------------
     * THE HAZARD THIS ANSWERS IS GEOMETRIC AND THE PLAYER CANNOT SEE IT.
     * `Targeting.reachOf` gives an IDLE, AGGRESSIVE hull
     * `range * APPROACH_STOP_FRAC 0.80 + STANCE_CHASE_METRES[Aggressive] 18`, and
     * the exchange's `hitRadius` is 7.211 — so an `rclGrinder` acquires the
     * counter from **39.61 m of centre distance**. The furthest cell a Grinder
     * can stand in and still fire on the FAR post is `18.44 + range 18 +
     * hitRadius(sentryGun) 2.828` = **39.27 m**. There is no such cell: clearing
     * the posts puts the player's own guns inside the objective's envelope by
     * construction, and the moment the last post dies they go Idle and take it.
     *
     * Measured rather than argued — real `TargetingSystem`, real defs, the real
     * built world, a Grinder at the standoff `approach()` drives to (28.46 m of
     * surface): it acquires the exchange. **The exclusion control is the same
     * hull on the same cell with the exchange already SEAT 0**, which acquires
     * nothing, so the acquisition is the deed and not the rig. The boundary
     * reproduces `reachOf` to the metre: acquired at 32.0 m of surface, not at
     * 32.5.
     *
     * **THE ANSWER IS DISTANCE, AND THE STANCE IS WHAT SETS THE DISTANCE.**
     * `reachOf` returns 0 for anything that does not chase, so on that same
     * standoff cell Defensive, Hold Ground and Hold Fire all acquire NOTHING —
     * driven, four stances, one cell. It is a SMALLER CIRCLE and not immunity:
     * swept, a Defensive Grinder still takes the counter from 19.2 m of surface
     * and not from 19.8, which is `range x acquireRangeMul 1.08` = 19.44 to the
     * metre. So the beat says pull back AND stand down, because either alone is
     * only half of it. Seat 0 opens with eleven hulls on Aggressive and seven on
     * Defensive, so the default is the dangerous one.
     *
     * `POSTS_GONE` rather than `entityDead('guard')` — see its block: a captured
     * post is not a dead one, and capturing is a route the player has.
     *
     * **THE OTHER THREE CONJUNCTS ARE ALL SPEAKER EXCLUSIONS AND ONE OF THEM WAS
     * FOUND BY DRIVING RATHER THAN BY READING.** This beat can fire on ANY tick
     * from minute one, so every other trigger in Cregg's voice has to be made
     * unreachable from it. `not(CAPTURED)` retires `t.taken` and `t.win` (whose
     * `READY` conjoins `CAPTURED`), and is right on its own terms besides: a
     * counter on the company's books is an ALLY and `Targeting.isValidTarget`
     * refuses allies, so there is nothing left to warn about. `not(CALL)`
     * retires `t.callCounter` — driven at nine post-death times, the run with
     * the posts falling on tick 34 200 read **Cregg, Cregg**, which is
     * `pact.06.common-ground`'s defect exactly and was invisible from the source.
     * `COUNTER_STANDING` keeps it off `t.broken`'s tick, where the warning would
     * arrive under the line saying the thing it warns about has already
     * happened.
     *
     * Two controls, both driven: posts standing for the whole match fires
     * NOTHING, and posts falling AFTER the capture fires nothing either.
     */
    {
      id: 't.posts',
      when: {
        on: 'all',
        of: [
          { on: 'elapsed', ticks: seconds(60) },
          POSTS_GONE,
          COUNTER_STANDING,
          { on: 'not', of: CAPTURED },
          { on: 'not', of: CALL },
        ],
      },
      then: [
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'Posts are off the front of the exchange — and every gun we brought is now '
            + 'stood close enough to start on the building itself. Pull them back off it and '
            + 'stand them down; anything still hunting for work will have the counter flat '
            + 'before you have walked a clerk to the door, and there is no second one.',
        },
      ],
    },

    /* -- the first picket ---------------------------------------------------
     * Minute four, unconditional. A wave that fires only when the player is
     * elsewhere reads as the map cheating; a schedule the world keeps regardless
     * reads as an opponent, which is `soviets.03.deep-sector`'s argument about
     * scripted waves on an AI seat.
     *
     * Pointed at THEIR OWN STORE — 118.1 m of Track walking, the nearest of the
     * four targets — and it is a picket rather than an attack, which is what an
     * `attackMove` onto a Gaia building's ground actually is: nothing on this map
     * can acquire the store, so the wave marches there and engages whatever of
     * the player's is standing on it.
     *
     * LITERAL SOVIET KEYS. `EffectSink.spawnUnits` resolves through
     * `ProductionCatalog.byKey` and remaps nothing, unlike the layout's
     * `ScenarioBuilder.spawnUnit`; `validateCampaign` checks each key against the
     * army of the seat it lands on, so a Reclamation key here is a build error.
     */
    {
      id: 't.first',
      when: { on: 'elapsed', ticks: minutes(4) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Bardin, intercepted',
          text: 'Put a company on our own store and leave it standing there. We are not going '
            + 'down that road to take anything and we are not going to be seen burning a '
            + 'register. Nobody signs anything at that counter today, and tomorrow the schedule '
            + 'stands where it has always stood.',
        },
        {
          do: 'spawnUnits', player: 1, key: 'conscript', count: 4, at: ROAD, spread: 12, tag: 'picket',
        },
        {
          do: 'spawnUnits', player: 1, key: 'rhino', count: 2, at: ROAD, spread: 18, tag: 'picket',
        },
        { do: 'orderTagged', tag: 'picket', order: 'attackMove', at: STORE_THEIRS },
      ],
    },

    /* -- the second ---------------------------------------------------------
     * It joins the `picket` tag rather than taking its own, so one `orderTagged`
     * re-points the survivors of both — `EffectSink.orderTagged` issues ONE
     * command per owner and every one of them is seat 1.
     */
    {
      id: 't.second',
      when: { on: 'elapsed', ticks: minutes(8) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Bardin, intercepted',
          text: 'Second company, the Meridian house\'s store, past the middle of the road. Three '
            + 'of four is not a general register. Three of four is a register with a hostage in '
            + 'it, and an office that can hold one house\'s copy can hold the figure.',
        },
        {
          do: 'spawnUnits', player: 1, key: 'conscript', count: 4, at: ROAD, spread: 12, tag: 'picket',
        },
        {
          do: 'spawnUnits', player: 1, key: 'rhino', count: 3, at: ROAD, spread: 18, tag: 'picket',
        },
        { do: 'orderTagged', tag: 'picket', order: 'attackMove', at: STORE_MERIDIAN },
      ],
    },

    /* -- the third ----------------------------------------------------------
     * The longest of the four picket runs — 271.6 m of Track over the real cost
     * grid, against 118.1, 157.7 and 155.8 — and the only one of them pointed at
     * something the player OWNS. It is not the longest walk on the map: the
     * Allied house's store is 274.9 m from the same forming-up point, and
     * nothing is ever sent there. It
     * arrives two minutes before the counter sits, which is when the player is
     * deciding how to split for the window.
     */
    {
      id: 't.third',
      when: { on: 'elapsed', ticks: minutes(12) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Bardin, intercepted',
          text: 'Third company, and go at the yard on their own road rather than at a counter. '
            + 'They have four breaking yards left in the world. If this afternoon costs them a '
            + 'fifth, they will find out what it is like to hold an opinion and nothing else.',
        },
        {
          do: 'spawnUnits', player: 1, key: 'conscript', count: 4, at: ROAD, spread: 12, tag: 'picket',
        },
        {
          do: 'spawnUnits', player: 1, key: 'rhino', count: 3, at: ROAD, spread: 18, tag: 'picket',
        },
        { do: 'orderTagged', tag: 'picket', order: 'attackMove', at: YARD },
      ],
    },

    /* -- the fourth ---------------------------------------------------------
     * AT THE EXCHANGE, three minutes into the window. Four `conscript` at 7.20
     * dps against Concrete and three `rhino` at 17.16 is 80.28 — and the counter
     * is NOT at 800 when they arrive. `Capture.resolve` writes health on its
     * friendly branch only, so the ladder hands it over at 0.40 of max: an
     * undefended counter is **320 hp and 3.99 seconds**, 400 and 4.98 off the
     * gunfire shortcut, and 9.97 only if the player spent a fifth clerk or
     * sixteen seconds of wrench on it. Trap 22, and it is what makes this
     * operation `capture-hold` rather than `capture`: the building is not the
     * prize, keeping it standing is.
     *
     * `not(READY)` is trap 26: without it, a reading that began at minute
     * sixteen and a half would put Bardin's line under the winning beat. It
     * costs nothing to evaluate before minute seventeen, because `holds`
     * short-circuits an `all` on the leading `elapsed`.
     *
     * **IT HOLDS THE WAVE OFF WHILE A READING IS LIVE, AND IF THAT READING
     * COMPLETES THE WAVE NEVER COMES AT ALL** — driven, tenth of the eleven
     * worlds in the header: four discs manned from 16:50, the picket held at
     * 17:00, the win at 17:20. That is not a hole. The only way to hold it off
     * is to be standing on all four counters with the exchange in hand, which is
     * the winning position; a player who lets one go gets the wave on the next
     * tick, because the trigger is non-repeat and its condition goes true again
     * the moment a counter empties.
     *
     * The `eva` lands BEFORE contact rather than on it, which is the only way a
     * scripted one earns its place: `audio.system.ts` already speaks
     * `forcesUnderAttack` on any attack, and this column is 155.8 m of Track
     * walking and at least twenty-nine seconds from touching anything.
     */
    {
      id: 't.fourth',
      when: { on: 'all', of: [WAVE, { on: 'not', of: READY }] },
      then: [
        { do: 'eva', line: 'forcesUnderAttack' },
        {
          do: 'dialogue',
          speaker: 'Bardin, intercepted',
          text: 'The counter. All of it, at the exchange. If they are standing in that building '
            + 'at four o\'clock then every figure this office has ever allocated becomes a number '
            + 'somebody can check against a delivery note, and I would rather explain a levelled '
            + 'building than explain that.',
        },
        {
          do: 'spawnUnits', player: 1, key: 'conscript', count: 4, at: ROAD, spread: 12, tag: 'picket',
        },
        {
          do: 'spawnUnits', player: 1, key: 'rhino', count: 3, at: ROAD, spread: 18, tag: 'picket',
        },
        { do: 'orderTagged', tag: 'picket', order: 'attackMove', at: EXCHANGE },
      ],
    },

    /* -- the counter changes hands ------------------------------------------
     * `structureCaptured` needs no settle guard: `ownerOfTag` answers -1 for a
     * tag nothing carries and -1 is not seat 0, so this is false on tick one
     * whether the layout placed the exchange or not.
     *
     * IT CANNOT SHARE A TICK WITH THE WIN, by construction rather than by a
     * guard: `READY` conjoins `CAPTURED`, so the arm tick of `t.win` is at
     * earliest the tick this fires, and `t.win` is `READING` — nine hundred
     * ticks — after that.
     */
    {
      id: 't.taken',
      when: CAPTURED,
      then: [
        { do: 'completeObjective', id: 'counter' },
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'Exchange is ours and still standing — at half a building or worse, because a '
            + 'counter comes over at whatever the door cost and nobody mends it on the way. '
            + 'Another clerk in, or the wrench on it, now: they will come back for it and it '
            + 'will not take them five seconds. Then the copies out on the road — nothing goes '
            + 'into that book until there is a hand at every store.',
        },
      ],
    },

    /* -- the yard goes ------------------------------------------------------
     * SILENT, AND DELIBERATELY. `audio.system.ts` speaks `structureLost` on any
     * local building death, and the objective row turning red is the feedback —
     * `pact.09.vacant-possession` states the same principle. A dialogue beat here
     * would be a third telling of one event AND could share a tick with the win,
     * which is the trap 26 case this file otherwise closes by condition.
     *
     * `SETTLE` because `max: 0` reads TRUE against an empty registry, exactly as
     * `entityDead` does.
     */
    {
      id: 't.yardLost',
      when: { on: 'all', of: [SETTLE, YARD_GONE, { on: 'not', of: CLOSED }] },
      then: [{ do: 'failObjective', id: 'yard' }],
    },

    /* -- the counter sits ---------------------------------------------------
     * UNCONDITIONAL, AT MINUTE FOURTEEN, AND IT IS THE OTHER HALF OF TRAP 23.
     * The `endorse` row now names both ends of the window — "from the hour until
     * four" — but a title cannot say WHEN the hour is, and `parSec` is rendered
     * only on the campaign selection screen (`Shell/Campaign.ts#parLabel`) and
     * never as an in-match clock. Before this, the only trigger that could fire
     * at fourteen was `t.reading`, which needs `READY`: a player already standing
     * on all four counters was told the window had opened and a player who was
     * not got nothing at all, which is exactly the wrong way round.
     * `reclamation.08.contra-entry` fires `t.settle` on its own count opening for
     * the same reason and this is that shape.
     *
     * **BARDIN, AND THE SPEAKER IS A COLLISION ARGUMENT RATHER THAN A TASTE
     * ONE.** A beat at a fixed tick can share it with anything. Cregg is
     * `t.taken`'s voice and a capture landing on 25 200 would put two of his
     * lines on one tick; Tallow is `t.reading`'s, `t.broken`'s and `t.rout`'s,
     * and the first of those fires at exactly this tick whenever the player is
     * in position. Bardin speaks at four, eight, twelve, seventeen and the
     * close — and intercepted traffic noticing the counter has opened is the
     * same device the four pickets already are.
     *
     * **THE TWO NEGATIONS ARE THE REST OF THAT ARGUMENT AND BOTH CAME OUT OF A
     * SWEEP.** `not(READY)` retires the only three-beat tick in the operation:
     * driven over 2 450 worlds, a capture landing on exactly 25 200 with all
     * four counters already manned fired `t.taken`, this, and `t.reading`
     * together — three speakers on one tick, which is one more than this file's
     * own bound and one short of the stack `t.open` was split to avoid. It is
     * also right on its own terms, because `t.reading` tells a player who IS in
     * position the same thing in better words. `not(WAVE)` retires `t.fourth`,
     * which is Bardin's and carries `not(READY)` itself: a player who holds the
     * reading from fourteen to seventeen and drops it on that exact tick would
     * otherwise get two of his lines at once.
     *
     * Both conditions are timer-free, so negating them is safe — see `READY`.
     * The cost is that a player who is READY continuously from fourteen to
     * seventeen never hears this, which is correct: they have had `t.reading`,
     * and at seventeen they get `t.fourth`.
     */
    {
      id: 't.opens',
      when: {
        on: 'all',
        of: [OPEN, { on: 'not', of: READY }, { on: 'not', of: WAVE }],
      },
      then: [
        {
          do: 'dialogue',
          speaker: 'Bardin, intercepted',
          text: 'The counter has sat. It is open until four and not a minute past it, and half '
            + 'a minute of four hands is the whole of what they need — so watch all four stores '
            + 'and do not let them have thirty consecutive seconds anywhere on this road.',
        },
      ],
    },

    /* -- the reading starts -------------------------------------------------
     * Fires the first tick `READY` holds, which is exactly the tick `t.win`
     * arms — so it is always thirty seconds ahead of the win and can never share
     * its tick.
     *
     * IT FIRES ONCE. A reading interrupted at second twenty-five and restarted
     * gets no second line, which is why the mechanism is stated unconditionally
     * at fifty-eight seconds instead of relying on this.
     */
    {
      id: 't.reading',
      when: READY,
      then: [
        {
          do: 'dialogue',
          speaker: 'Tallow',
          text: 'All four manned, and the reading has started. Half a minute with nobody stepping '
            + 'off, and then it is nobody\'s book.',
        },
      ],
    },

    /* -- three minutes on the counter ---------------------------------------
     * THE FAIRNESS MECHANISM A SINGLE-INSTANT THRESHOLD NEEDS.
     * `reclamation.05.closing-entry` states the rule and `.09.book-value` reuses
     * it: a player who finishes one condition short of a threshold must not
     * discover it AT the threshold.
     *
     * TWO ARMS, AND THEY PARTITION THE TWO WAYS TO BE SHORT — no counter, or a
     * counter and not enough hands. Each one is EXCLUSIVE WITH THE WIN by its own
     * condition rather than by a guard: `t.win` needs `CAPTURED` and `FOUR`, and
     * these need `not(CAPTURED)` and `not(FOUR)` respectively. A player who is
     * mid-reading at minute nineteen gets neither, which is correct — they are
     * not short of anything.
     *
     * **AND THE FIRST ARM CARRIES `COUNTER_STANDING`, WHICH IS NOT DECORATION
     * EITHER.** `CAPTURED` is `structureCaptured`, which reads `ownerOfTag` —
     * -1 for a tag nothing carries — so `not(CAPTURED)` is true for a counter
     * that was NEVER taken and equally for one that was taken and then levelled.
     * The trigger is non-repeat and stays eligible for the whole three minutes,
     * so a player-held exchange destroyed at any point in 19:00..22:00 fired it
     * on the DECIDING TICK: Cregg saying *"the counter is still theirs"* beside
     * Tallow saying *"the counter is down"*, one beat apart, under a defeat.
     * Driven at five levelling times across that window, five of five. The
     * control is the same levelling at 18:50, which ends with Tallow's line
     * alone — so the collision was this conjunct's absence and not the ending.
     * `entityAlive` needs no settle guard: it reads FALSE on an empty registry,
     * which is the safe direction.
     *
     * **THE SECOND ARM READS `objectiveComplete('counter')` RATHER THAN
     * `CAPTURED`, AND THAT IS A ONE-TICK EXCLUSION RATHER THAN A SYNONYM.**
     * `t.taken` is Cregg's and so is this, and a capture landing on exactly tick
     * 34 200 would put two Cregg lines on one tick — the one shape trap 26 names.
     * `runDirector` collects every matching trigger's effects BEFORE
     * `CampaignSession.apply` runs any of them, so on the tick `t.taken` fires
     * the row is not complete YET: this arm reads false there and fires one tick
     * later instead. The two are otherwise the same predicate, because the only
     * way to stop holding the exchange is for it to be destroyed, and that ends
     * the operation at `t.broken`.
     */
    {
      id: 't.callCounter',
      when: {
        on: 'all',
        of: [CALL, { on: 'not', of: CAPTURED }, COUNTER_STANDING],
      },
      then: [
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'Three minutes and the counter is still theirs. There is no reading without it '
            + 'and no second exchange in this district — take it standing, or we go home with '
            + 'four copies and nowhere on this continent to enter them.',
        },
      ],
    },
    {
      id: 't.callShort',
      when: {
        on: 'all',
        of: [CALL, { on: 'objectiveComplete', id: 'counter' }, { on: 'not', of: FOUR }],
      },
      then: [
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'Three minutes, the counter is ours, and we are a hand short somewhere on this '
            + 'road. It does not matter which store it is. Four or nothing, and nothing is the '
            + 'same as never having written the thing down.',
        },
      ],
    },

    /* -- the endorsement ----------------------------------------------------
     * `not(CLOSED)` so the closing tick belongs to `t.noCounter` and `t.notRead`
     * alone. The cost is a one-tick knife edge for a reading that would have
     * completed on exactly the closing tick; the alternative is negating an arm
     * timer, which `validateCampaign` refuses and which reads TRUE during the
     * arming pass in any case.
     *
     * **AN `elapsedSinceArmed` ON A WIN WAS COSTED AND REJECTED BY
     * `pact.06.common-ground`, AND ITS REASON DOES NOT APPLY HERE.** The hazard
     * is that `CampaignSession.setObjective` refuses to un-resolve a resolved
     * row, so an objective completed on ARRIVAL and a win gated on the HOLD
     * leaves a player who steps out mid-hold losing with the objective showing
     * COMPLETE. Nothing in this file completes `endorse` before the win: the
     * completion and the `endOperation` are effects of the SAME trigger on the
     * SAME tick, and no other trigger names that objective except the three that
     * fail it. `reclamation.08.contra-entry` records the identical exemption.
     *
     * TWO BEATS FROM TWO SPEAKERS, which is the measured norm for an ending tick
     * and the bound trap 26 exists to hold. `t.yardsRead` shares this tick and
     * says nothing.
     */
    {
      id: 't.win',
      when: { on: 'all', of: [READY, HELD, { on: 'not', of: CLOSED }] },
      then: [
        { do: 'completeObjective', id: 'endorse' },
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'All four signed inside the same half minute, and the copy in their own store '
            + 'went in with the rest of them. There is nothing left on this road that is ours to '
            + 'defend.',
        },
        {
          do: 'dialogue',
          speaker: 'Tallow',
          text: 'Endorsed to the four houses jointly and without recourse. We cannot be paid to '
            + 'read it, leaned on to alter it, or answered to when a house refuses a line. Nine '
            + 'yards became four paying for that book, and today we gave it away. I would do it '
            + 'in the same order again. A record everybody may check is the only property worth '
            + 'more once you stop owning it. Take the company name off the spine on your way '
            + 'out. It was never the name that made it true.',
        },
        { do: 'endOperation', result: 'win' },
      ],
    },
    /*
     * The secondary, resolved silently on the winning tick.
     *
     * ITS ARMING PREDICATE IS `t.win`'s PLUS `YARD_STANDING`, so the two arm
     * together and fire together whenever the yard is standing throughout the
     * reading. If it is not, `t.yardLost` has already failed the row and
     * `CampaignSession.setObjective` refuses to un-resolve it — which is what
     * makes the pair safe to write in either order.
     *
     * **IT SITS AFTER `t.win`'s `endOperation` IN EFFECT ORDER AND STILL LANDS**,
     * which is the one thing that makes silver reachable at all and which was
     * read rather than assumed: `campaign-install.ts` applies the whole batch —
     * `for (const e of this.effects) this.apply(e, sink)` — with no
     * short-circuit after an outcome, `end()` merely refuses a SECOND outcome,
     * and `medal(difficulty)` reads `state.objectives` when the end screen asks
     * rather than when the match ends. Driven: a clean run reports SILVER and one
     * that lost the yard at minute ten reports BRONZE.
     */
    {
      id: 't.yardsRead',
      when: { on: 'all', of: [READY, HELD, { on: 'not', of: CLOSED }, YARD_STANDING] },
      then: [{ do: 'completeObjective', id: 'yard' }],
    },

    /* -- the counter is gone ------------------------------------------------
     * The fastest way to lose this operation, and it is almost always the
     * player's own guns: `Targeting` acquires an enemy structure and fires until
     * it is dead, and four `rclGrinder` take an 800 hp `civApartments` from full
     * to the 0.50 capture gate in 5.66 seconds and from the gate to rubble in
     * 5.66 more. It is also reachable by the fourth picket at 80.28 dps against
     * a counter nobody is defending.
     *
     * `failObjective('counter')` is written first and is REFUSED when the row is
     * already complete — `setObjective` returns early on both terminal states —
     * so a counter that was taken and then levelled ends the operation with
     * `counter` reading COMPLETE, which is true: it WAS taken. What failed is the
     * endorsement, and that is what the reason names.
     */
    {
      id: 't.broken',
      when: { on: 'all', of: [BROKEN, { on: 'not', of: CLOSED }] },
      then: [
        { do: 'failObjective', id: 'counter' },
        { do: 'failObjective', id: 'endorse' },
        {
          do: 'dialogue',
          speaker: 'Tallow',
          text: 'The counter is down. There is no other one in this district, and four fair '
            + 'copies in four warehouses with nothing entered against them are four sheets of '
            + 'paper. Whatever put it down, it was ours to keep standing.',
        },
        { do: 'endOperation', result: 'loss', reason: 'endorse' },
      ],
    },

    /* -- the party is gone --------------------------------------------------
     * `playerBeaten` is `Viability.isBeaten` — nothing to build with and nothing
     * to fight with.
     *
     * **IT NEEDS NO SOLVENCY CLAUSE AND `reclamation.09.book-value` NEEDED ONE**,
     * which is worth stating because the two files sit next to each other. R9
     * lets a beaten commander run to the close because the money is already in
     * the box and its win reads a BANK; being beaten does not stop a bank being
     * read. This win reads four hands on four counters, so once a rout is
     * genuinely a rout there is nothing left to play for.
     *
     * **WHAT MAKES IT "GENUINELY" IS `ROUT`'s `not(READY)`, AND THAT CONJUNCT
     * CAME OUT OF THE DIRECTOR RATHER THAN OUT OF AN ARGUMENT.** See its block:
     * `contestingUnits` excludes garrisoned men, so a commander with no base
     * whose last four hands are inside four bonded stores is beaten and READY at
     * once, and the first draft of this trigger ended that in a defeat ten
     * seconds into the winning reading.
     *
     * The speaker is Tallow rather than Cregg for a second reason found the same
     * way: `t.taken` is Cregg's, and a capture that consumes the player's last
     * contesting unit makes both true on one tick. Two beats from two speakers is
     * the bound; two from one is `pact.06.common-ground`'s defect.
     */
    {
      id: 't.rout',
      when: { on: 'all', of: [ROUT, { on: 'not', of: CLOSED }] },
      then: [
        { do: 'failObjective', id: 'counter' },
        { do: 'failObjective', id: 'endorse' },
        {
          do: 'dialogue',
          speaker: 'Tallow',
          text: 'Nothing answering on the road and the copies still in the satchel. The book '
            + 'stays ours — which is the one outcome every house that signed the bond will read '
            + 'as us having wanted it.',
        },
        { do: 'endOperation', result: 'loss', reason: 'endorse' },
      ],
    },

    /* -- four o'clock: the two closing arms ----------------------------------
     * EXACT COMPLEMENTS OVER ONE PREDICATE, so precisely one of them fires and
     * neither can overlap the win (`t.win` carries `not(CLOSED)`) or `t.broken`
     * (a dead exchange ends the operation at `SETTLE` and the outcome latch
     * makes `runDirector` return 0 on every later tick).
     */
    {
      id: 't.noCounter',
      when: { on: 'all', of: [CLOSED, { on: 'not', of: CAPTURED }] },
      then: [
        { do: 'failObjective', id: 'counter' },
        { do: 'failObjective', id: 'endorse' },
        {
          do: 'dialogue',
          speaker: 'Bardin, intercepted',
          text: 'Four o\'clock. Counter never opened, nothing entered, and the register is '
            + 'exactly where it was this morning — in one house\'s hands, which is where a book '
            + 'anybody could check was never going to stay.',
        },
        {
          do: 'dialogue',
          speaker: 'Tallow',
          text: 'Log it as unpresented. We had the copies and we had the road, and we could not '
            + 'get to a desk.',
        },
        { do: 'endOperation', result: 'loss', reason: 'counter' },
      ],
    },
    {
      id: 't.notRead',
      when: { on: 'all', of: [CLOSED, CAPTURED] },
      then: [
        { do: 'failObjective', id: 'endorse' },
        {
          do: 'dialogue',
          speaker: 'Tallow',
          text: 'Counter shut with the exchange in our hands and a store standing empty. The '
            + 'endorsement is unread, so it is unmade, and every house that sent a clerk down '
            + 'here today goes home able to say that the Reclamation offered to give the book '
            + 'away and then did not.',
        },
        { do: 'endOperation', result: 'loss', reason: 'endorse' },
      ],
    },
    /*
     * The secondary on a losing ending, silently, so no row is left reading
     * ACTIVE on a screen that is not going to change. `reclamation.09.book-value`
     * records finding exactly that by driving the real Director: a rout at minute
     * twelve ended with three undecided rows, one of which was in fact complete.
     */
    {
      id: 't.yardsEnd',
      when: { on: 'all', of: [LOST, YARD_STANDING] },
      then: [{ do: 'completeObjective', id: 'yard' }],
    },
  ],
};

export default op;
