/**
 * ============================================================================
 * R6 — IN DUPLICATE
 * ============================================================================
 * R5 closed the week with the counting house standing and the account still in
 * one hand, and Calvane's objection standing with it: one book in one hand with
 * no second copy anywhere is not a record, it is an assertion. Tallow answered
 * that with a sneer — "send the Pact the index and an invoice for the copying".
 * Cregg took it down as an instruction and priced it.
 *
 * The price is the whole operation, and it is not the clerks' wages. A firm
 * whose product is the only complete account on the continent sells SCARCITY:
 * R3 is literally about one lot invoiced twice, and the reason both invoices
 * were paid is that nobody else could produce the ledger. Making a counterpart
 * and lodging it in a bonded store — where the bond's rule is that anything
 * lodged may be read by anybody who asks for it — destroys that. **The account
 * becomes credible on the exact day it stops being exclusive**, and the
 * Reclamation ends the week holding a receipt for a book somebody else now has.
 *
 * That is the trade Tallow signs, and she signs it because Calvane is right.
 *
 * ============================================================================
 * WHO DOES NOT WANT ONE TO EXIST, AND WHY IT IS NOT THE PACT
 * ============================================================================
 * The Pact ASKED for the second copy; they are not the obstacle. The Allies
 * are, and their reason is commercial rather than military. An unattested
 * ledger in a broker's hand is a CLAIM: it can be bought, disputed, or lost in
 * a fire, and R4's requisition was an attempt at the third. A counterpart
 * lodged in a bonded store is a DEBT — it converts Survey 26-511's twice-sold
 * lot and the whole of the delivery book into things the Allies owe rather than
 * things somebody alleges. So they do not come for the book. They come for the
 * road between the book and the store, and they serve a stop notice on it.
 *
 * `foe: Faction.Allies`, and every scripted key on seat 1 is a literal Allied
 * `gi`, `grizzly` or `javelin`, which `validateCampaign` checks against the
 * army of the seat it lands on. Ardle carries the intercepts, as he does in
 * `reclamation.03.sold-twice` and `reclamation.04.served-notice`.
 *
 * ============================================================================
 * THE THRESHOLDS ARE A CHAIN, AND THE CHAIN IS WHAT MAKES THE LOSS HONEST
 * ============================================================================
 * Six clerks, laid down by the layout, and three numbers:
 *
 *     the writing        FOUR clerks inside the counting house lot, held
 *     the lodgement      FOUR clerks inside the bonded store's lot
 *     the receipt        THREE clerks back at the counting house
 *
 * **THE LOSS FIRES EXACTLY WHEN THE NEXT THRESHOLD BECOMES UNREACHABLE, AND
 * THAT IS THE ONLY REASON THIS SHAPE IS SAFE.** `t.clerksShort` ends the
 * operation the moment fewer than four clerks are alive anywhere in the
 * district and the counterpart is not yet lodged; `t.clerksShortLate` does the
 * same at fewer than three once it is. Without that pairing the third death
 * would leave a player with three surviving clerks, an engrossment that can
 * never complete, and eleven minutes of not being told — the silent-unwinnable
 * failure `validateCampaign` exists to refuse at import and cannot see inside a
 * threshold.
 *
 * **AND `4 + 3 = 7 > 6` IS WHAT STOPS A PARTY THAT NEVER LEFT FROM COLLECTING
 * THE RECEIPT.** With six clerks, four at the store and three at the house
 * cannot both hold at once, so at least one clerk who carried the counterpart
 * down has to walk back up with the docket. That is arithmetic rather than
 * trust, and it is the reason the third primary is a real leg and not a
 * formality — a first draft with four and three over EIGHT clerks was
 * satisfiable by leaving four men at home, and nothing in the trigger table
 * could have told the difference.
 *
 * ============================================================================
 * WHERE SEVEN MINUTES AND EIGHTEEN COME FROM
 * ============================================================================
 * `WRITE` is seven minutes of `elapsedSinceArmed`; `CLOSE` is eighteen and is
 * `parSec` to the second, which is the identification `reclamation.03`, `.04`
 * and `.05` all make. The two are not independent. Measured on the built world,
 * the clerks' walk is the cost-optimal Foot route the engine's own expander
 * produces — 8-connected, destination-cell weights out of
 * `FlowFieldCache.costGridFor(Foot)`, diagonals at `(nc * DIAG) | 0`, corner
 * cutting refused.
 *
 * **IT IS MEASURED FROM WHERE THE CLERKS STAND TO THE DISC THE TRIGGER READS,
 * NOT FROM BUILDING TO BUILDING** — trap 27, and the two are different
 * quantities. Out, from each of the six spawned positions to the nearest cell
 * inside `BOND_AREA`, is **187.8 to 199.8 m**, 53.6 to 57.1 s at `rclTinker`'s
 * 3.5 m/s; the middle of the front rank is 191.8 m at cost 4784. Back, from the
 * arrival cell to the nearest cell inside `HOUSE_AREA`, is **155.5 m** = 44.4 s
 * — genuinely shorter, because the two discs are 24 m and 26 m and the return
 * ends at the near edge of the larger one.
 *
 *     floor, nothing going wrong       7:00 + 0:55 + 0:45  =   8:40
 *     one engrossment lost and redone 14:00 + 0:55 + 0:45  =  15:40
 *     two lost                        21:00 + 1:40         =  22:40
 *
 * **THE CLOSE IS SET SO THAT EXACTLY ONE FAILED ENGROSSMENT IS SURVIVABLE AND
 * TWO ARE NOT.** Eighteen minutes leaves 2:20 of slack on the second attempt
 * and refuses a third by four minutes forty. That is what the deadline is for;
 * it is not a description of how long the operation takes. (An earlier draft
 * costed the return at the outward leg's 55 s and published 8:50 / 15:50 /
 * 22:50 with 2:10 and 4:50; the relationship is unchanged and the numbers were
 * one anchor out.)
 *
 * The floor is a floor and not a par. A player who walks the counterpart down
 * the instant it is written meets the second working on the store's apron —
 * see the schedule below — and one who does not is inside the second attempt's
 * budget. Driven through the real `runDirector` with those measured legs
 * scripted, the clean win in scenario A lands at **8:39**.
 *
 * ============================================================================
 * THE STOP NOTICE IS A TOLL, NOT A WALL, AND THE EXCLUSION CONTROL SAYS SO
 * ============================================================================
 * Two `pillbox` stand astride the sidings road at (226, 230) and (250, 202),
 * 44.41 m and 34.00 m short of the bonded store. The claim that they cover the
 * route is measured rather than asserted, and it is measured over the whole SET
 * of cells lying on SOME optimal path — a forward Dijkstra plus a REVERSE one
 * whose relaxation pays the cost of the cell it LEAVES, so that
 * `fwd + bwd === best` picks out the set rather than one reconstructed chain
 * (trap 29; get the reverse relaxation wrong and the "set" is silently a
 * different set). Goal is the nearest cell inside `BOND_AREA`, which is what
 * `t.lodged` actually reads:
 *
 *     cells on some optimal Foot route            183
 *     inside post (226, 230)'s envelope            31, closest approach  5.66 m
 *     inside post (250, 202)'s envelope             9, closest approach 16.97 m
 *
 * The envelope is `pillboxMg`'s range 22 plus the CLERK's own `hitRadius`
 * 0.2340 — `Combat.engage` subtracts only the victim's extent, so the same gun
 * reaches a different distance against a different hull and there is no single
 * figure to quote.
 *
 * **THE INSTRUMENT THAT SETTLES IT IS THE EXCLUSION CONTROL.** Re-run the fill
 * with both gun discs impassable:
 *
 *     cheapest route            4784  ->  5695   (+911, +19.0%)
 *     that chain, in metres    191.8  ->  225.4  (+33.6 m, +9.6 s each way)
 *
 * So the notice does NOT seal the road: there is a way round and it costs
 * 33.6 m and 9.6 seconds on each leg, **19.2 s over the two**.
 *
 * ============================================================================
 * WHAT LEAVING IT STANDING REALLY COSTS, AND IT IS NOT A HULL
 * ============================================================================
 * **THAT +33.6 m IS THE PRICE OF THE ROUTE NOBODY IS TOLD TO TAKE.** It is what
 * a player pays for hand-routing the party round the guns. **The DEFAULT is one
 * right-click on the store, and the default goes through them**, because the
 * flow field descends the cheapest route and the cheapest route is the one the
 * exclusion control just re-priced.
 *
 * Measured over the same optimal SET, with a DP down the optimal DAG for the
 * least and the most exposed metres rather than one reconstructed chain:
 *
 *     metres inside 22.234 m of a post   28.3 min   46.6 max
 *     seconds at 3.5 m/s                  8.1        13.3
 *     delivered damage at 65.82 dps      533        876
 *
 * against **four clerks carrying 340 hp between them**. `pillboxMg` is 5 x 13
 * on a 0.79 s cycle = 82.28 raw, through `ARMOR_MATRIX[SmallArms][Infantry]`
 * 1.00 and `COMBAT_DAMAGE.globalMul` 0.80 = 65.82 delivered, so ONE post empties
 * the lodging party in **5.17 s** — less than two thirds of the shortest
 * exposure any cost-optimal route has. The return leg is the same ground.
 *
 * **SO THE SECONDARY IS OPTIONAL AND THE DECISION IS NOT.** A player must clear
 * the posts, hand-route round them, or screen the walk with hulls the posts
 * will shoot at instead; clicking the store and watching is a lost party. That
 * is what an escort IS, and it is why `t.toll` prices the notice at the CLERKS
 * rather than at a hull — the beat used to read "through them and it costs you
 * a hull", which is the price of the thing the player is not doing.
 * (Unmeasured, and named rather than assumed: whether a screening Grinder
 * inside the envelope reliably draws the post off the party is a `Targeting`
 * question this file has not staged. The 533-876 figure is the no-screen case.)
 *
 * What it costs to take the notice off is derived below.
 *
 * **THE POSITION WAS CHOSEN BY THAT INSTRUMENT AND NOT BY EYE.** Sweeping the
 * lane frame at 0.02 of the lane and 6 m across it, with both posts closed at
 * every candidate, the exclusion delta runs 601 to 1049 and the shipped point
 * is the best in the half of the corridor that belongs to the store rather than
 * to the player's own yard: the three positions scoring 1049 all stand within
 * 56 m of the counting house, which is a stop notice served on the broker's
 * doorstep and a picket the opening army clears for free.
 *
 * ============================================================================
 * WHAT CLEARING IT COSTS, DERIVED
 * ============================================================================
 * `pillbox` is 500 hp of `ArmorClass.Concrete` at 400 credits. Against it, the
 * player's own opening column, through `ARMOR_MATRIX` at
 * `COMBAT_DAMAGE.globalMul` 0.80:
 *
 *     grinderArc   (rclGrinder)  1x70 / 1.90 s  Tesla  rng 18   17.68 dps
 *     spitCoil     (rclSpitter)  1x30 / 0.95 s  Tesla  rng 16   15.16
 *     four Grinders and two Arcspitters                        101.04 -> 4.95 s
 *
 * and the post answers with `pillboxMg` — 5x13 on a 0.79 s cycle, 18.43 dps
 * against `ArmorClass.Medium`. Both posts on one Grinder for the first 4.95 s
 * and one for the next is **273.7 damage**, which is 1.01 Grinders of the
 * 270 hp they carry. **Clearing the notice costs about one Grinder and ten
 * seconds.**
 *
 * **NOTHING THE PLAYER OWNS OUT-RANGES IT, AND THAT IS THE ROSTER'S DOING.**
 * `grinderArc` reaches 18 m against the post's 22, so a Grinder eats 4 m of
 * free fire on the way in — 0.69 s at 5.8 m/s, per approach. The Reclamation's
 * two long answers are the Arc Pylon (28 m) and the Slaghurler, and both are
 * withheld; see the roster block. A player who wants the posts gone pays for
 * them at close range or walks round.
 *
 * ============================================================================
 * A CLERK IS AN ENGINEER, AND `captureProof` IS THIS OPERATION'S THESIS
 * ============================================================================
 * `captureProof: ['house', 'bond']`, and the second entry is about what this
 * operation MEANS rather than about a hazard.
 *
 * **`bond`.** The bonded store is a Gaia `civApartments`, and `Capture.resolve`
 * rule 1 takes a NEUTRAL structure outright, at ANY health, for one engineer —
 * no soften ladder, no `captureHpFrac` gate. The carriers ARE engineers, so the
 * single most natural click in the operation — select the clerks, right-click
 * the building you were told to reach — spends one of six and puts the
 * depository on the Reclamation's own books. **A counterpart lodged in a
 * warehouse you own is not a second copy; it is the same copy in the same hand,
 * which is the assertion Calvane refused.** The veto is that sentence as a flag
 * bit.
 *
 * It is not a well-spelled no-op, and the mechanism is worth naming because it
 * turns a trap into the correct behaviour rather than merely refusing it.
 * `resolveContextOrder`'s neutral-structure branch is guarded by
 * `capturableNow`, which calls `CaptureService.isCapturable` and therefore
 * consults every installed veto — so with this field set the cursor never
 * offers Capture over the store, that branch falls through, `caps.canCapture`
 * skips the garrison branch below it, and the click resolves to **Move**. The
 * clerks walk to the store and stand there, which is exactly what
 * `unitsInArea` is waiting for.
 *
 * **`house`.** Every threshold in this file counts what SEAT 0 owns, so a
 * captured counting house reads as a lost one and `t.houseLost` would end the
 * operation in a defeat on the tick it changed hands — the protect-target case
 * `types.ts` names, where migrating the trigger to `ownerCount` makes a LOSS
 * reachable by capture instead of fixing anything. Measured on the built world,
 * seat 1 opens holding one `engineer` (`buildAlliedGarrison` places it), so the
 * engineer is on the map; what is not on the map is a call site, because
 * `AiBrain` issues `OrderKind.Capture` nowhere at all. That is a fact about
 * `src/sim/AI.ts` and it can stop being true without anybody touching this
 * file. The veto makes the primaries independent of it.
 *
 * **TWO DOORS IT DOES NOT CLOSE, BOTH DECLARED RATHER THAN DISCOVERED.**
 * `GarrisonService.enter` calls `captureBuilding()` directly and consults no
 * `CaptureService` veto, so a squad of RIFLEMEN garrisoning the Gaia store does
 * flip it to seat 0 for as long as they stand in it — `releaseEmptied` hands it
 * back when the last man leaves, so it is a loan rather than a sale, and
 * nothing in this trigger table reads the store's owner. The clerks cannot do
 * it: `caps.canCapture` is an OR over the selection, so any selection holding
 * one of them skips the garrison branch entirely. That is
 * `allies.07.fair-copy`'s finding and `pact.07.thin-place` records the same
 * residual.
 *
 * The other is `Capture.resolve`'s FRIENDLY branch, which is tested BEFORE the
 * vetoes: `CAPTURE.repairThresholdFrac` is 0.995, so a clerk right-clicked onto
 * a counting house that has taken a single hit repairs it to full and is
 * consumed, under `captureProof` as much as without it. That is left open on
 * purpose. It is the only field repair this lot has, the price is legible (one
 * clerk of six, against thresholds that are on screen), and Tallow names it in
 * `t.orders` — which is an UNCONDITIONAL trigger, because a mechanism explained
 * inside an optional beat is a mechanism half the players never hear.
 *
 * ============================================================================
 * NOT ONE `entity*` CONDITION, AND ONE `not` OVER A COUNT
 * ============================================================================
 * Every threshold here is `unitsInArea`, `ownerCount`, `objectiveComplete`,
 * `elapsed`, `elapsedSinceArmed` or `playerBeaten`. `entityAlive`, `entityDead`
 * and `entityHpBelow` appear nowhere, so the two traps that have cost this
 * campaign the most — a tag read before it exists, and a capture a
 * corpse-counting condition cannot see — are excluded by construction rather
 * than by care. `reclamation.05.closing-entry` holds the same property for the
 * same reason.
 *
 * The clerk count is `not unitsInArea(0, DISTRICT, min: N, tag: 'clerk')` over
 * a disc that covers the whole map, which is a head count wearing an area
 * condition's clothes and is deliberate: `entityDead` is boolean and this
 * operation needs "fewer than four". It is cheap — `WorldQuery.unitsInArea`
 * walks the TAG when one is given, never `store.alive` — and it counts a
 * garrisoned clerk correctly, because `GarrisonService` parks an occupant at
 * its host's centre and leaves it an `EntityKind.Infantry` the tag registry
 * still holds.
 *
 * Both zero-ish thresholds are conjoined with `SETTLE`, which is trap 4: a
 * `max: 0` and a negated `min` both read TRUE against an empty registry on tick
 * one. Unguarded, `t.houseLost` would end the operation in a defeat on the
 * first tick the Director runs.
 *
 * ============================================================================
 * THE SCHEDULE, AND WHY THERE ARE TWO FORMING-UP POINTS
 * ============================================================================
 * Four workings, all `elapsed`, all unconditional — a schedule the world keeps
 * whatever the player is doing reads as an opponent, and a wave that fires only
 * when they are elsewhere reads as the map cheating. Their march is measured
 * with a Dijkstra mirroring `Expander.step` over `costGridFor(Track)`, from the
 * forming-up point to the goal, with `COST_BLOCKED` imported from
 * `world/terrain-gen.ts` and the fill's teeth checked (4057 of 16 384 Track
 * cells blocked; ringing the store makes it report UNREACHABLE):
 *
 *     t.first   3:30  4 gi + 2 grizzly      ROAD   -> counting house  614.3 m
 *                     armour on it at 5:03, infantry at 6:42
 *     t.second  7:30  5 gi + 3 grizzly      SIDING -> bonded store     89.7 m
 *                     armour at 7:44, infantry at 7:58
 *     t.third  11:00  3 javelin + 3 grizzly SIDING -> bonded store     89.7 m
 *                     armour at 11:14, javelins at 11:30
 *     t.fourth 14:30  4 gi + 2 grizzly      ROAD   -> counting house  614.3 m
 *                     armour at 16:03, infantry at 17:42
 *
 * **614 m AGAINST A STRAIGHT LINE OF 218.6 m IS NOT AN ERROR, AND THIS BLOCK
 * BLAMED THE WRONG THING FOR IT.** It said the counting house sits behind the
 * player's own base and its nine `rclBarricade`. Reconstructed, the chain never
 * goes near them — it runs north-east out of the district, west along the top
 * of the map at z ~ 78 and back down — because a spoil ridge at x ~ 164-176
 * closes the middle of the survey to anything on wheels or feet. The
 * consequence stands and is what the write is written to have: the first
 * working arrives STRUNG OUT, armour ninety-nine seconds ahead of its infantry,
 * into the last two minutes of a seven-minute engrossment.
 *
 * **THE SAME RIDGE IS WHY THE STORE-BOUND WAVES FORM UP SOMEWHERE ELSE, AND
 * THIS FILE SHIPPED COSTING THEM AT 74.9 m OF ROAD.** From `ROAD` the store is
 * 84.33 m away in a straight line and **715.1 m by tracked route** — the same
 * northern loop, one leg longer — so `t.second`'s armour would have reached it
 * at 9:18 and `t.third`'s at 12:48, against a party that gets there at 7:55.
 * Every sentence this block used to carry about eleven seconds was a sentence
 * about a road that is not there. There is no fixing it at the Allied end
 * either: of 2217 sweep candidates whose eleven distinct drops all stand on
 * ground their own locomotor may enter, **zero** lie past the store with a
 * tracked route to it under 200 m.
 *
 * So the store-bound workings are the notice party's own reinforcement and form
 * up at `SIDING`, on the sidings below the posts — 89.7 m of tracked route from
 * the store, armour on it 13.6 s after it forms. Against a party that leaves
 * the lot the instant the counterpart is written, that is **11.2 s ahead of the
 * front rank's own 54.8 s leg**, and 10.0 s ahead of the fastest of the six. The floor and the schedule are still
 * tuned against each other; the number that does it moved from the wave's road
 * to the wave's ground. And the `eva` still earns its place for the reason
 * `types.ts` gives — the announcer says `forcesUnderAttack` on contact anyway,
 * so a scripted copy is only worth having ahead of the event, and this is
 * ahead of it in two senses: 13.6 s before the armour is on the store, and on
 * a ring whose nearest drop stands 30.3 m off the clerks' own corridor, outside
 * `lightCannon`'s 24.234 m envelope against a clerk and `rifle`'s 18.234 m. A
 * wave that could open fire on the party as it landed would make the line a
 * report rather than a warning.
 *
 * `AiBrain.regroupSquads` files every untagged hull the seat owns into a squad
 * on its next pass, so the attack-move is the first thing these twenty-six do
 * and the brain owns them afterwards. That is the honest limit of what a
 * scripted wave buys and `reclamation.05.closing-entry` says the same.
 *
 * ============================================================================
 * THE ROSTER
 * ============================================================================
 * `player: ['unit.raider', 'struct.support']`
 * `ai:     []`
 *
 * The Arcspitter is carried forward from every operation in this chapter and
 * here it is the escort: 8.8 m/s against a Grinder's 5.8 over a 170.8 m tracked
 * route means one hull can be in front of the clerks and behind them inside a
 * single leg. `struct.support` buys the Repair Depot, and this is the operation
 * where an 800-credit pad pays for itself — there are two legs with a fight in
 * the middle of each, and a Grinder mended between them is a Grinder not bought
 * twice.
 *
 * The AI list is EMPTY, and it is doing the heaviest work in the file.
 * `ALLIED_DEFENCE` seeds a `prismTower` in the Allied opening: 34 m of
 * `prismTowerBeam` at 101.20 delivered against `ArmorClass.Infantry` per pull,
 * which kills an 85 hp clerk outright at a reach half again the pillbox's. The
 * empty list also takes `battleLab` off seat 1 and both `ifv` out of its
 * garrison. **Measured, both halves bite** — built twice with the def tables
 * bound, once with this roster installed and once without:
 *
 *     seat 0   rclCrucible (struct.tech)                  1 -> 0
 *              rclPylon    (struct.defence.specialist)    1 -> 0
 *     seat 1   battleLab   (struct.tech)                  1 -> 0
 *              prismTower  (struct.defence.specialist)    1 -> 0
 *              ifv         (unit.raider)                  2 -> 0
 *
 * Six entities across five def keys. `struct.tech` is withheld from the player
 * exactly as R2, R3 and R5 withhold it, and `struct.defence.specialist` is
 * withheld from BOTH: from the Allies because a 34 m tower anywhere near the
 * sidings road would make the escort a different operation, and from the
 * Reclamation because an Arc Pylon's 28 m is the one thing the player owns that
 * would out-range the stop notice and turn the second decision into a purchase.
 *
 * ============================================================================
 * NEITHER SHIPPED OUTCOME RULE MAY END THIS
 * ============================================================================
 * `annihilationWin` because levelling the Allied district does not put a
 * counterpart in a bonded store and `Shell.pollOutcome` would declare a victory
 * with the copy still in the counting house. `assetLossDefeat` because a broker
 * who has spent the yard to get four clerks two hundred metres down a road is
 * having the best last act this operation can produce, and the poll would end
 * it at 2 Hz with a generic defeat instead. There are six authored losses and
 * every one names an objective.
 *
 * **EVERY ENDING WAS DRIVEN THROUGH THE REAL `runDirector`**, nine scripted
 * worlds, with the objective effects applied the way `Session.setObjective`
 * applies them (resolved-does-not-unresolve included) and with the clerks'
 * MEASURED legs — 54.8 s out, 44.4 s back — as the script's timings. Every
 * ending emits at most five effects and **exactly one dialogue line**; no
 * ending stacks two speakers. Re-driven after the fixes below:
 *
 *     A  clean win, notice standing          8:39   win
 *     B  win, notice cleared first           8:39   win, secondary paid 7:00.03
 *     C  nothing ever walks                 18:00   loss (lodge)
 *     D  lodged, no receipt                 18:00   loss (receipt)
 *     E  counting house lost at 4:00         4:00   loss (copy)
 *     F  counting house lost at 7:02          --    a beat; the operation goes on
 *     G  the third clerk dies at 5:00        5:00   loss (lodge)
 *     H  the fourth dies after lodging       8:20   loss (receipt)
 *     I  playerBeaten at 6:00                6:00   loss (lodge)
 *
 * (H's tick is the scripted death, not a property of the design. A and B moved
 * from 9:11 because the legs were re-measured, not because anything about the
 * win changed.)
 *
 * F is the one worth reading twice: once the counterpart is written the
 * counting house is a building rather than the operation, so losing it costs a
 * beat and nothing else — which is why `t.win` reads `HOUSE_AREA` as GROUND and
 * not `ownerCount` on the structure. A player who loses the house at minute
 * eight can still finish the week standing in its yard.
 *
 * **ONE DECLARED RESIDUAL, FOUND BY THE SAME DRIVE.** In F exactly as scripted
 * — the house lost two seconds after the write — Cregg speaks `t.engrossed` at
 * 7:00.00 and `t.houseGoneLate` at 7:02.00, which is one speaker two seconds
 * apart. Unlike the `t.engrossed` -> `t.notice` pair that this fix broke up,
 * that adjacency is NOT forced by the trigger table: `t.houseGoneLate` fires
 * whenever the house dies after the copy, and only a world that kills it inside
 * that window puts the two together. It is left alone because the alternative
 * is holding back a "your counting house is gone" beat, and a late loss report
 * is worse than a close one.
 *
 * ============================================================================
 * WHAT WAS CONSIDERED AND CUT
 * ============================================================================
 *   - **A SECOND LODGEMENT.** "In duplicate" invites two stores and two
 *     destinations, and it was costed: three clerks at each of two discs plus a
 *     receipt threshold is four primaries, five objective rows against a
 *     `MAX_VISIBLE_OBJECTIVES` of 3, and a tour rather than an escort. The
 *     title is about the ACCOUNT existing twice, which one lodgement achieves.
 *   - **A `credits` THRESHOLD AT THE CLOSE.** That is
 *     `reclamation.05.closing-entry`'s second primary exactly, one operation
 *     earlier, and repeating it would make the copying a budget rather than a
 *     decision. The money in this file is the six clerks — 3000 credits of
 *     `rclTinker` standing in a yard against an opening bank of 5000 — and the
 *     600 the notice pays back.
 *   - **PAYING THE HIDDEN SECONDARY MORE THAN 600.** It covers one Grinder and
 *     the change; anything larger would let a player answer an escort with a
 *     purchase.
 *   - **`notice` IN `captureProof`.** It closes the Capture cursor over a stop
 *     post and it does NOT close the defeat: the veto sends
 *     `resolveContextOrder`'s enemy branch past `canCapture`, past `canAttack`
 *     (the clerks are `UNARMED`) and out as Move, so the party walks the same
 *     150 m and stands in the same gun. Measured either way, one post empties
 *     four clerks in 5.17 s. The protection is the beat, and it is in
 *     `t.orders`. Argued at length above the field.
 *   - **RE-CUTTING `t.second` AND `t.third`'s TICKS RATHER THAN MOVING THEIR
 *     SPAWN.** The store-bound waves march 715.1 m from `ROAD` and the obvious
 *     repair is to fire them earlier. It is wrong twice: the ARMOUR would be
 *     108 s ahead of its riflemen's 224 s, so the wave arrives over three and a
 *     half minutes rather than as a working; and the route crosses the whole
 *     survey, so `AiBrain.regroupSquads` files them into an ordinary attack
 *     long before they see the store. A wave whose journey is longer than the
 *     leg it is meant to contest is not a wave, whatever tick it fires on.
 *   - **GARRISONING THE CLERKS FOR THE WRITE.** `civApartments` is a legal
 *     strongpoint and the player's own, so five men could shelter in it — and
 *     the clerks cannot be among them, because `resolveContextOrder` skips the
 *     garrison branch for any selection carrying `canCapture`. The engrossment
 *     is therefore six unarmed men standing in a yard for seven minutes, which
 *     is what makes the first working's arrival window matter.
 * ========================================================================== */

import { Faction } from '../../../core/types';
import { minutes, seconds } from '../../types';
import type { Condition, OperationDef } from '../../types';
import {
  BOND, BOND_AREA, BOND_REVEAL, DISTRICT, HOUSE, HOUSE_AREA, ROAD, SIDING, SIM_SEED,
} from '../../layouts/reclamation-in-duplicate';

/**
 * How long the layout is given to have placed the composition before a zero
 * threshold over it is believed.
 *
 * **THREE THRESHOLDS IN THIS FILE READ TRUE AGAINST AN EMPTY REGISTRY** —
 * `ownerCount(0, 'building', 'house', max: 0)` and both negated clerk counts.
 * Unguarded, `t.houseLost` would end the operation in a defeat on the first
 * tick the Director runs and `t.clerksShort` would do it one line later.
 *
 * **IT GUARDS A LAYOUT THAT PLACED NOTHING, NOT A TICK-ONE READ THAT HAPPENS
 * TODAY.** `scenarios.system.ts` builds the world inside `async init()` and
 * `SystemRegistry.init` awaits every module's init before a tick is taken, so
 * the registry is never empty when the Director first runs. What IS reachable
 * is a roster typo or a footprint that will not fit, which
 * `tests/campaign-roster-ground.spec.ts` and `tests/campaign-maps.spec.ts`
 * catch at their causes; this stops the symptom being instant.
 *
 * Twenty seconds is past the build and short of anything happening: the nearest
 * hostile unit at t = 0 is a harvester at (118, 174), **264.92 m** from the
 * counting house — the nearest Warden Tank is 269.71 m — and the fastest thing
 * on that seat is a 6.6 m/s Warden Tank, so 132 m of straight line in twenty
 * seconds leaves **137.7 m** still to go. (This used to read 301.30 m, which is
 * the RAW CORNER's distance to the house used as a proxy for a unit's position;
 * even the Allied Construction Yard, at 295.74 m, is 26 m past the real nearest
 * hull. The guard still holds, by 23% less than it claimed.)
 */
const SETTLE: Condition = { on: 'elapsed', ticks: seconds(20) };

/**
 * How long the counterpart takes to engross, as a hold.
 *
 * SEVEN MINUTES, AND IT IS HALF OF A PAIR WITH `CLOSE`. The header derives it:
 * the floor is `WRITE + 54.8 s out + 44.4 s back` = 8:40, one failed
 * engrossment is `2 x WRITE + 1:40` = 15:40 and fits inside eighteen minutes
 * with 2:20 to spare, and two is 22:40 and does not. **Move this and the
 * deadline stops meaning what the header says it means.**
 *
 * `elapsedSinceArmed` rather than `elapsed`: the Director evaluates every
 * trigger twice, once with this forced true to decide whether the trigger's
 * OTHER conditions hold, so losing the fourth clerk off the lot at minute six
 * restarts the clock. That is the intended reading and the reason the close is
 * set where a second attempt fits.
 */
const WRITE = minutes(7);

/**
 * The bond shuts its books. EXACTLY `parSec`, to the second.
 *
 * The authored par IS the deadline rather than a description of one, which is
 * the only way that field is falsifiable from inside the operation —
 * `reclamation.03.sold-twice` sets the same relationship at 900,
 * `.04.served-notice` at 960 and `.05.closing-entry` at 1020.
 */
const CLOSE = minutes(18);

/**
 * The exact complement of "the counting house is still ours", guarded.
 *
 * `min: 1` and `max: 0` over one count partition every world state, so the beat
 * and the loss cannot overlap and cannot both be false.
 */
const HOUSE_GONE: Condition = {
  on: 'all',
  of: [SETTLE, { on: 'ownerCount', player: 0, role: 'building', tag: 'house', max: 0 }],
};

const COPY_MADE: Condition = { on: 'objectiveComplete', id: 'copy' };
const LODGED: Condition = { on: 'objectiveComplete', id: 'lodge' };

/**
 * Clerks alive anywhere in the district, as a comparable number.
 *
 * `DISTRICT` is a disc that covers the whole map, so this is a head count
 * rather than a question about a place — `entityDead` is boolean and this
 * operation needs "fewer than four". It walks the TAG rather than `store.alive`
 * (`WorldQuery.unitsInArea` branches on the tag being non-null), and it counts
 * a garrisoned clerk, because `GarrisonService` parks an occupant at its host's
 * centre and leaves the tag registry holding it.
 */
const clerksAtLeast = (n: number): Condition => ({
  on: 'unitsInArea', player: 0, area: DISTRICT, min: n, tag: 'clerk',
});

/** Hands enough to write the counterpart, and enough to attest a lodgement. */
const ATTEST = 4;
/** Hands enough to enter the receipt in the book. Three of six. */
const ENTER = 3;

const op: OperationDef = {
  id: 'reclamation.06.in-duplicate',
  chapter: 'reclamation',
  faction: Faction.Reclaim,
  /*
   * THE ALLIES, FOR THE THIRD TIME IN THIS CHAPTER AND FOR A DIFFERENT REASON.
   *
   * R3 and R4 were about a lot they had bought twice and a requisition they
   * never filed. This is about what an ATTESTED copy of the book recording both
   * would do to them: convert an allegation into a debt. Ardle carries the
   * intercepts in all three, which is deliberate — he is the man whose
   * paperwork R3 and R4 are about, and the one with something to lose from it
   * becoming producible by somebody else.
   *
   * The Pact is not the obstacle here and could not be: `pact.03.concession`
   * has already put Tallow across a table from Calvane, and R5 ended with him
   * demanding exactly the copy this operation makes.
   *
   * Every scripted key on seat 1 is a literal Allied `gi`, `grizzly` or
   * `javelin`, which `validateCampaign` checks against the army of the seat it
   * lands on, so a Reclamation key here is a build error.
   */
  foe: Faction.Allies,
  index: 6,
  title: 'In Duplicate',
  beat: 'A record is a thing two parties can produce. Ours is a thing one party can lose.',
  /*
   * ESCORT. The chapter has spent assault, economy, capture-hold, infiltrate
   * and defend, and `validateCampaign` refuses two adjacent operations in one
   * chapter that share a `primaryType` in any case. The subject is six unarmed
   * men carrying an object that cannot be rebuilt, twice across the same two
   * hundred metres; the engrossment is the loading step and the receipt is the
   * return leg.
   */
  primaryType: 'escort',
  /*
   * BESPOKE. Objectives, spawns, orders, a reveal, a camera move, dialogue, an
   * announcer line and an outcome — `types.ts` defines the archetype as
   * "multiple effect kinds", and this is TEN of the eleven. The one it does not
   * use is `grantCredits`: the secondary pays through `ObjectiveDef.credits`,
   * which is the same `Economy.grant` on a rail that `paid` keeps from paying
   * twice across a reload.
   */
  archetype: 'bespoke',
  parSec: 1080,
  requires: ['reclamation.05.closing-entry'],

  map: {
    /*
     * URBAN ON BOTH LINES, WHICH IS THE ONE PAIRING THAT CANNOT MAKE R3's
     * MISTAKE. `MAP_PRESETS` and `BiomeName` overlap on `temperate`, `snow` and
     * `urban` and disagree on exactly one name — the preset is `arid`, the
     * biome is `desert` — and `reclamation.03.sold-twice` shipped on the wrong
     * side of that and measured two headers' worth of numbers against ground it
     * had not declared. This pair is the same word twice.
     *
     * It is also the right ground rather than the safe one. `urban` carries
     * `relief` 0.14 and `cliffs` 0.10, the flattest pair in the roster, and an
     * escort is the operation type whose every claim is a claim about a ROUTE:
     * two of this chapter's four earlier operations lost hundreds of seed rolls
     * to scripted drops on ground their own locomotor could not enter. Flat
     * ground does not make a route free — the tracked march from `ROAD` to the
     * counting house is 614.3 m against a 218.6 m straight line, and from
     * `ROAD` to the bonded store it is 715.1 m against 84.3 m — it makes one
     * findable without moving the map.
     */
    preset: 'urban',
    /**
     * Survey 25-777, and it was chosen on a measured sweep of twenty rolls
     * rather than picked.
     *
     * The quantity swept is the one this operation lives or dies on: the
     * cost-optimal Foot route from the counting house to the bonded store,
     * against the straight line between them. Over twenty candidates the detour
     * ratio runs 0.95x to 2.79x — the worst put a ridge across the middle of
     * the corridor and sent the clerks 552 m round it — and this roll is 0.95x
     * with **93.8% of an 80 m corridor open to a walking man**, the best of the
     * four that scored under 1.0. (Under 1.0 is not an error: `urban` lays
     * roads, road cells cost less than open ground, and a cost-optimal route
     * that uses one is cheaper than the straight line is long.)
     *
     * **THE SWEEP MEASURED ONE CORRIDOR AND THE ROLL HAS TWO.** The quantity
     * above is the CLERKS' route and nothing else, and on this roll it is as
     * good as the sweep says. The same ridge that the worst candidates put
     * across that corridor is present on this one, north of it, where it cuts
     * the Allied works off from the bonded store — 84.33 m in a straight line,
     * **715.1 m by tracked route** — and the sweep could not see it because it
     * never asked. That is what put two forming-up points in the layout instead
     * of one; the ground is right for the operation and the schedule had to be
     * measured against it rather than assumed from it.
     *
     * Pinned by `tests/campaign-maps.spec.ts` as a terrain fingerprint. A
     * generator change that re-rolls this ground moves every measured distance
     * in both headers.
     */
    mapSeed: 25_777,
    /*
     * IMPORTED FROM THE LAYOUT, WHICH OWNS IT.
     *
     * `simSeed` decides which two corners the match is played in, and every
     * point the trigger table below names is computed from exactly that in
     * `reclamation-in-duplicate.ts` — out of `seatedSlots`,
     * `SKIRMISH_START_OFFSETS` and `MAP_SIZE`, at module load, arithmetic
     * rather than measurement. Writing the number here as well would be the
     * same fact in two files, and the failure — a reveal framing empty ground,
     * a column landing where nobody authored one — is invisible to every gate.
     * `reclamation-served-notice.ts` is the precedent.
     */
    simSeed: SIM_SEED,
    armies: 2,
    biome: 'urban',
    /*
     * `base`. The clerks are the subject and they cannot be bought, but the
     * escort can: the operation is about deciding what a two-hundred-metre walk
     * is worth in hulls, and a player with no factory has no decision to make.
     * R1 and R4 open `'force'` and both are about having nothing.
     */
    opening: 'base',
    /*
     * 5000, AND IT BINDS BOTH SEATS — `applySimPostBoot` writes
     * `startingCredits` into every non-Neutral slot, so this is a statement
     * about tempo rather than a handicap. The six clerks standing on the lot
     * are 3000 credits of `rclTinker` at the shipped price, so the bank is
     * deliberately smaller than the labour it is escorting: the copying is
     * already the most expensive thing on the map before a single hull is
     * bought.
     *
     * Half the skirmish default, for the reason CLAUDE.md measures at length: a
     * brain with a 10 000 opening puts up a seven-building base and eleven
     * troops by t+90 s having mined nothing, and a seven-minute hold that
     * starts at t = 0 must not be met by that at minute one.
     */
    credits: 5_000,
  },
  layout: 'reclamation-in-duplicate',

  // NEITHER SHIPPED RULE MAY END THIS. See the header.
  outcome: { annihilationWin: false, assetLossDefeat: false, ignoreSeats: [] },

  /*
   * AN ALLOW-LIST, SO TAGGED-AND-UNLISTED IS REFUSED FOR BOTH SEATS. The
   * argument and the measured diff are in the header; the two things to know
   * before editing it are that the empty `ai` list is what keeps a 34 m
   * `prismTower` off a map where the objective walks, and that withholding
   * `struct.defence.specialist` from the PLAYER is what stops the Arc Pylon's
   * 28 m answering the stop notice from outside its reach.
   */
  roster: {
    player: ['unit.raider', 'struct.support'],
    ai: [],
  },

  /*
   * THE COUNTING HOUSE AND THE BONDED STORE. See the header: the first is the
   * `reclamation.05.closing-entry` shape (a captured protect-target reads as a
   * lost one), and the second is this operation's own thesis — a depository the
   * Reclamation owns is not a second copy, it is the same copy in the same
   * hand.
   *
   * The two stop posts are deliberately NOT here, and the argument was
   * RE-DERIVED rather than carried forward, because the first version of it
   * ("the one thing on this map the operation is happy to see taken by either
   * route") is only half true and the half that is false is a scripted defeat.
   *
   * **THE CAPTURE ROUTE IS OPEN AND IT COSTS FOUR CLERKS OF SIX.** A `pillbox`
   * is 500 hp above `CAPTURE.captureHpFrac` 0.5, so each clerk spends itself
   * for `maxHp * softenFrac` 0.25 through `ARMOR_MATRIX[HighExplosive]
   * [Concrete]` 1.00 and `globalMul` 0.80 = 100 hp: 500 -> 400 -> 300 -> 200
   * (0.40) and the FOURTH takes it. Four of six is below `ATTEST`, so one
   * right-click on a post with the party selected ends the operation — and
   * `resolveContextOrder` offers a Capture CURSOR for it, because
   * `isCapturable` consults `captureProof` and this list does not name
   * `notice`.
   *
   * **ADDING `notice` HERE WAS COSTED AND REJECTED, ON A MEASUREMENT.** The
   * veto removes the CURSOR, not the hazard: with it installed the enemy branch
   * falls past `caps.canCapture`, past `caps.canAttack` (the clerks are
   * `UNARMED`), and out of its own comment — *"unarmed selection: walk there
   * instead of refusing"* — as `OrderKind.Move`. The party then walks the same
   * 150 m and stands inside 22.234 m of a gun that empties four clerks in
   * 5.17 s. Same defeat, one cursor quieter. What actually protects the player
   * is being TOLD, so `t.orders` carries it beside the repair rule on an
   * unconditional trigger, and the secondary's title stays worded for a route
   * the rule genuinely allows.
   */
  captureProof: ['house', 'bond'],

  objectives: [
    {
      id: 'copy',
      kind: 'primary',
      title: 'Engross the counterpart: four clerks in the counting house until it is written',
    },
    {
      id: 'lodge',
      kind: 'primary',
      title: 'Walk the counterpart down to the bonded store on the sidings road',
    },
    {
      /*
       * THE TITLE IS THE ONLY SENTENCE A PLAYER GETS. `ObjectiveRow` is
       * `{ id, title, kind, status }` — no description, no tooltip — so a
       * mechanism that needs explaining goes in an UNCONDITIONAL dialogue beat
       * and never in an optional one. `t.orders` carries this one.
       */
      id: 'receipt',
      kind: 'primary',
      title: 'Bring the bond receipt back to the counting house',
    },
    {
      id: 'notice',
      kind: 'secondary',
      hidden: true,
      /*
       * "TAKE … OFF THE ROAD", NOT "DESTROY". `t.notice` counts what seat 1
       * still owns, so an engineer walked into a post finishes it exactly as
       * levelling it does, and a title saying "destroy" would name the one
       * route the rule does not require. Trap 9, and
       * `soviets.06.demolition-order` is the worked example.
       */
      title: 'Take the stop notice off the sidings road before the counterpart goes down it',
      credits: 600,
    },
  ],

  triggers: [
    /* -- the brief, in two beats ------------------------------------------
     * Split across fourteen seconds because the shell renders dialogue as
     * toasts and four at once is a stack nobody reads, and because two speakers
     * inside six seconds is exactly the case `Shell.campaignBeatSeq` was
     * written for, so both halves of each beat really do arrive.
     *
     * Tallow opens because it is her decision and it is against her own
     * interest. Cregg carries the ground, as he has for five operations.
     */
    {
      id: 't.open',
      when: { on: 'elapsed', ticks: seconds(4) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Tallow',
          text: 'Calvane was right and I have been three days deciding to say so. One book in '
            + 'one hand is not a record. So we copy it, once, by hand, and we lodge the '
            + 'counterpart in the bonded store on the sidings, where anybody who asks may read '
            + 'it.',
        },
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'Which ends the only reason anyone has ever paid this company for a sheet of '
            + 'paper. Put it in the covering note plainly: we are selling the scarcity to keep '
            + 'the account. Six clerks are on the lot and the writing is started.',
        },
      ],
    },
    {
      /*
       * THE MECHANISM, UNCONDITIONALLY. Three numbers a player is judged
       * against and TWO hazards they can walk into, in one beat, on a trigger
       * nothing gates — trap 23. The figures are spelled out because
       * `tests/build-descriptions.spec.ts`'s convention bans digits in
       * player-facing copy where a word will do.
       *
       * **THE SECOND HAZARD IS THE CAPTURE CLICK AND IT WAS NOT HERE.** A clerk
       * is an engineer, so `resolveContextOrder`'s enemy branch answers
       * `OrderKind.Capture` with a Capture CURSOR over either stop post —
       * `isCapturable` is true for them (Building, Alive, not
       * `UnderConstruction`, owner 1, and `captureProof` names only `house` and
       * `bond`). `Capture.resolve` above `CAPTURE.captureHpFrac` 0.5 spends the
       * engineer for `maxHp * CAPTURE.softenFrac` 0.25 through
       * `ARMOR_MATRIX[HighExplosive][Concrete]` 1.00 and
       * `COMBAT_DAMAGE.globalMul` 0.80, i.e. 100 hp of a 500 hp `pillbox` each:
       * 500 -> 400 -> 300 -> 200 (0.40), and the FOURTH captures. Four of six
       * clerks is below `ATTEST` and `t.clerksShort` ends the operation. So one
       * right-click, with the cursor inviting it, is a scripted defeat — and it
       * is the SAME sentence as the repair rule, which is why it goes in the
       * same breath rather than in a beat of its own.
       */
      id: 't.orders',
      when: { on: 'elapsed', ticks: seconds(18) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'Four of the six have to stand on this lot until it is written — pull a fourth '
            + 'man off and the page starts again. Four hands attest the lodgement at the store '
            + 'and three enter the receipt back here, so somebody is making that walk twice.',
        },
        {
          do: 'dialogue',
          speaker: 'Tallow',
          text: 'And they are clerks, not a repair gang and not a demolition party. Send one '
            + 'at a damaged wall and he mends it and is gone; send them at a door the Allies '
            + 'are holding and the cursor will offer you the deed, and they are spent on it '
            + 'four at a time, which is the whole engrossment. There is no advertising for '
            + 'another this week.',
        },
      ],
    },

    /* -- the first working -------------------------------------------------
     * Minute three and a half, unconditional, at the counting house. The march
     * is 614.3 m of tracked route — a spoil ridge closes the middle of the
     * survey, so the column goes north out of the district, west along the top
     * of the map and back down; it is NOT the player's base and its nine
     * barricades, which the reconstructed chain never passes — so the armour
     * lands at 5:03 and the infantry at 6:42, against an engrossment that
     * finishes at 7:00 at the earliest. It arrives strung out, into the one
     * stretch of the operation where six unarmed men are standing still.
     *
     * LITERAL ALLIED KEYS. `EffectSink.spawnUnits` resolves through
     * `ProductionCatalog.byKey` and remaps nothing, unlike the layout's
     * `ScenarioBuilder.spawnUnit`.
     */
    {
      id: 't.first',
      when: { on: 'elapsed', ticks: minutes(3.5) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Ardle, intercepted',
          text: 'They are copying the delivery book. Not moving it, copying it — which means '
            + 'they mean to lodge it somewhere I cannot buy it back from. Put a party on the '
            + 'yard and give them something else to do this afternoon.',
        },
        { do: 'spawnUnits', player: 1, key: 'gi', count: 4, at: ROAD, spread: 12, tag: 'column' },
        { do: 'spawnUnits', player: 1, key: 'grizzly', count: 2, at: ROAD, spread: 18, tag: 'column' },
        { do: 'orderTagged', tag: 'column', order: 'attackMove', at: HOUSE },
      ],
    },

    /* -- the counterpart is written ----------------------------------------
     * The hold. `unitsInArea` on the counting house lot conjoined with
     * `elapsedSinceArmed`, so the Director's two-pass evaluation restarts the
     * clock whenever the fourth clerk leaves the lot or dies — see `WRITE`.
     *
     * THE CAMERA MOVE IS THE REVEAL AND IT IS THE ONLY ONE IN THIS FILE.
     * `cameraMove` takes the camera off whatever the player was doing, so
     * `types.ts` reserves it for an arrival, a loss or a reveal and forbids it
     * as punctuation. This is the moment the operation stops being about a
     * building and starts being about a road the player has not seen the far
     * end of.
     *
     * `revealArea` EXPLORES ground rather than showing live units, so the disc
     * puts the store and both stop posts on the map while there is still an
     * operation left to answer them with.
     */
    {
      id: 't.engrossed',
      when: {
        on: 'all',
        of: [
          { on: 'unitsInArea', player: 0, area: HOUSE_AREA, min: ATTEST, tag: 'clerk' },
          { on: 'elapsedSinceArmed', ticks: WRITE },
        ],
      },
      then: [
        { do: 'completeObjective', id: 'copy' },
        { do: 'setObjective', id: 'notice' },
        { do: 'revealArea', player: 0, area: BOND_REVEAL },
        { do: 'cameraMove', at: BOND },
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'Written and read back. The store is two hundred metres down the sidings — '
            + 'four hands on the attestation when they get there, and the docket comes back '
            + 'up this road afterwards.',
        },
      ],
    },

    /* -- the toll, only while there is a toll ------------------------------
     * **THE NOTICE SENTENCE USED TO RIDE ON `t.engrossed` AND WAS FALSE ON THE
     * PATH THE SECONDARY REWARDS.** Driven through the real `runDirector`, a
     * player who clears both posts before the counterpart is written gets
     * Cregg describing two standing posts at 7:00.00 and Cregg announcing them
     * gone at 7:00.03 — `objectiveComplete` only reads true from the tick after
     * the effect, so `t.notice` CANNOT fire earlier than one tick behind the
     * reveal, and `COPY_MADE` is what puts it there on purpose. One speaker,
     * one tick, and the first line contradicted by the second.
     *
     * The description therefore lives on its own trigger, conjoined with the
     * posts actually being there. `elapsedSinceArmed` of eight seconds is the
     * pacing half: `COPY_MADE` arms this at 7:00.03, so Cregg's two lines land
     * eight seconds apart rather than adjacent, which is past the six-second
     * window `Shell.campaignBeatSeq` was written for. If the player clears the
     * posts inside those eight seconds the trigger DISARMS and `t.notice`
     * answers instead, which is the correct behaviour and is what the hold
     * timer's two-pass evaluation buys for free.
     *
     * **AND IT PRICES THE PARTY RATHER THAN A HULL.** The old line read "round
     * them and it costs you a minute, through them and it costs you a hull",
     * and BOTH halves were wrong. The minute is 33.6 m and 9.6 s per leg —
     * 19.2 s over the two — from the exclusion control, so it overstated the
     * detour six times. The hull was wrong by a whole category: measured over
     * the SET of cost-optimal Foot routes, the DEFAULT click walks the party
     * 28.3 to 46.6 m inside a post's envelope, which is 533 to 876 delivered
     * damage against four clerks carrying 340 hp. See the header.
     *
     * It names the two answers that ARE measured — clear the posts (the
     * secondary, one Grinder and ten seconds) or route wide of them (+33.6 m
     * per leg, from the exclusion control) — and deliberately does NOT tell the
     * player to screen the walk with a hull. Whether a Grinder inside the
     * envelope reliably pulls a post off an unarmed man is a `Targeting`
     * question nobody here has staged, and a beat that promises a mechanism the
     * file has not measured is the defect this campaign spends its time
     * catching.
     */
    {
      id: 't.toll',
      when: {
        on: 'all',
        of: [
          COPY_MADE,
          { on: 'ownerCount', player: 1, role: 'building', tag: 'notice', min: 1 },
          { on: 'elapsedSinceArmed', ticks: seconds(8) },
        ],
      },
      then: [
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'The Allies have put two posts across the sidings road, short of the store — '
            + 'a stop notice, served on gravel. Take them off it, or steer the party wide by '
            + 'hand: thirty-odd metres and a few seconds each way. Send the clerks straight '
            + 'down the middle and it does not cost you a hull, it costs you the clerks, and '
            + 'there is no second copy after that.',
        },
      ],
    },

    /* -- the second working ------------------------------------------------
     * FROM `SIDING`, NOT `ROAD`, AND THAT IS THE WHOLE OF THE FIX. 89.7 m of
     * tracked route: armour on the bonded store 13.6 s after it forms, riflemen
     * at 28.0 s. A player who leaves the instant the counterpart is written
     * arrives at 7:55 into a column that got there at 7:44.
     *
     * From `ROAD` the same order was **715.1 m** — the ridge — so the armour
     * would have arrived at 9:18 and the riflemen at 11:13, three and a half
     * minutes after the party they were sent to meet. See the schedule block.
     *
     * BEFORE THE EVENT RATHER THAN ON IT, WHICH IS THE ONLY WAY A SCRIPTED
     * `eva` EARNS ITS PLACE. `audio.system.ts` already speaks this line on any
     * attack; nothing is attacking yet, the nearest drop stands 30.3 m off the
     * clerks' own corridor and outside every gun in the wave, and the thirteen
     * seconds are the warning.
     */
    {
      id: 't.second',
      when: { on: 'elapsed', ticks: minutes(7.5) },
      then: [
        { do: 'eva', line: 'forcesUnderAttack' },
        {
          do: 'dialogue',
          speaker: 'Ardle, intercepted',
          text: 'The store, then. A book in a bonded warehouse is a debt with my name on it; a '
            + 'book in a broker’s safe is an allegation. Stand on the road and let them carry '
            + 'it back up again.',
        },
        { do: 'spawnUnits', player: 1, key: 'gi', count: 5, at: SIDING, spread: 14, tag: 'column' },
        { do: 'spawnUnits', player: 1, key: 'grizzly', count: 3, at: SIDING, spread: 18, tag: 'column' },
        { do: 'orderTagged', tag: 'column', order: 'attackMove', at: BOND },
      ],
    },

    /* -- the third ----------------------------------------------------------
     * Javelins rather than riflemen, because by minute eleven the player is
     * escorting with hulls and a rifle is not the answer to one. It joins the
     * `column` tag rather than taking its own, so one `orderTagged` re-points
     * the survivors of all four workings — `EffectSink.orderTagged` issues ONE
     * command per owner and every one of them is seat 1.
     *
     * `SIDING` for `t.second`'s reason: armour on the store at 11:14 and the
     * javelins at 11:30, against 12:48 and 14:58 from `ROAD`.
     */
    {
      id: 't.third',
      when: { on: 'elapsed', ticks: minutes(11) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Ardle, intercepted',
          text: 'If it is already lodged, take the receipt off whoever is carrying it. A '
            + 'lodging nobody can produce a docket for is a rumour, and I have beaten rumours '
            + 'before.',
        },
        { do: 'spawnUnits', player: 1, key: 'javelin', count: 3, at: SIDING, spread: 15, tag: 'column' },
        { do: 'spawnUnits', player: 1, key: 'grizzly', count: 3, at: SIDING, spread: 18, tag: 'column' },
        { do: 'orderTagged', tag: 'column', order: 'attackMove', at: BOND },
      ],
    },

    /* -- the fourth ---------------------------------------------------------
     * At the counting house, from `ROAD` and round the ridge, so it lands at
     * 16:03 (armour) to 17:42 (infantry) — inside the last two minutes
     * whichever way the run has gone, and behind `t.closing`'s warning rather
     * than in place of it.
     */
    {
      id: 't.fourth',
      when: { on: 'elapsed', ticks: minutes(14.5) },
      then: [
        { do: 'spawnUnits', player: 1, key: 'gi', count: 4, at: ROAD, spread: 12, tag: 'column' },
        { do: 'spawnUnits', player: 1, key: 'grizzly', count: 2, at: ROAD, spread: 18, tag: 'column' },
        { do: 'orderTagged', tag: 'column', order: 'attackMove', at: HOUSE },
      ],
    },

    /* -- the stop notice ----------------------------------------------------
     * `ownerCount` on SEAT 1, never `entityDead`: a captured post is still
     * alive, so a corpse-counting condition on an enemy structure is
     * capture-blind and would leave a 600-credit secondary permanently
     * uncollectable.
     *
     * `COPY_MADE` IS CONJOINED AND IT IS NOT DECORATION. Driven through the
     * real `runDirector`, a player who clears the posts at minute five without
     * it COMPLETES A HIDDEN OBJECTIVE — the row is not revealed until the
     * counterpart is written, so the completion happens to a line nobody has
     * seen. With the clause, clearing them early resolves the secondary on the
     * tick after the reveal instead, which is what scenario B measures.
     *
     * ABOVE EVERYTHING THAT ENDS THE MATCH, which is this file's ordering rule:
     * `runDirector` evaluates nothing once an outcome is set, so a secondary
     * written below the win can never resolve on the winning tick and the medal
     * never counts it.
     */
    {
      id: 't.notice',
      when: {
        on: 'all',
        of: [
          SETTLE,
          COPY_MADE,
          { on: 'ownerCount', player: 1, role: 'building', tag: 'notice', max: 0 },
          { on: 'not', of: LODGED },
        ],
      },
      then: [
        { do: 'completeObjective', id: 'notice' },
        {
          /*
           * TALLOW, AND THE SPEAKER IS THE FIX RATHER THAN A PREFERENCE. This
           * trigger fires one tick after `t.engrossed` whenever the posts were
           * cleared before the counterpart was written, which is the default on
           * any replay and is exactly the play the secondary rewards. With
           * Cregg on both it was one speaker answering himself 0.03 s later —
           * `t.noticeMissed` below already carries that finding and made the
           * same change; the same reasoning had not been applied here.
           */
          do: 'dialogue',
          speaker: 'Tallow',
          text: 'Notice is off the road. Whatever they meant to serve it on, they will have to '
            + 'serve it on somebody standing still. Bill the powder to the copying.',
        },
      ],
    },
    {
      /*
       * THE OTHER HALF OF THE SAME PARTITION. `max: 0` and `min: 1` over one
       * count, so exactly one of the two can resolve and neither can fire
       * twice. A bare `failObjective` with no line is a silent failure, so this
       * carries one — found by driving the real Director rather than by
       * reading.
       *
       * **AND IT IS TALLOW'S LINE FOR A MEASURED REASON.** This trigger fires
       * on the tick AFTER `t.lodged`, because `runDirector` applies no
       * objective effect itself and `objectiveComplete` therefore only reads
       * true from the next tick — so with Cregg on both it was one speaker
       * answering himself 0.03 s later, which is the stack trap 26 exists for.
       * Two speakers is exactly the case `Shell.campaignBeatSeq` handles.
       */
      id: 't.noticeMissed',
      when: {
        on: 'all',
        of: [LODGED, { on: 'ownerCount', player: 1, role: 'building', tag: 'notice', min: 1 }],
      },
      then: [
        { do: 'failObjective', id: 'notice' },
        {
          do: 'dialogue',
          speaker: 'Tallow',
          text: 'Counterpart is in and their notice is still standing on the road behind it. We '
            + 'went round rather than argue — thirty-odd metres each way, steered by hand, '
            + 'because the straight line goes under their guns. Bill it to the copying and do '
            + 'not pretend it was free.',
        },
      ],
    },

    /* -- the lodgement ------------------------------------------------------
     * `COPY_MADE` first, so four clerks parked on the store at minute one do
     * nothing at all: there is no counterpart to lodge until it is written.
     */
    {
      id: 't.lodged',
      when: {
        on: 'all',
        of: [
          COPY_MADE,
          { on: 'unitsInArea', player: 0, area: BOND_AREA, min: ATTEST, tag: 'clerk' },
        ],
      },
      then: [
        { do: 'completeObjective', id: 'lodge' },
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'Lodged, stamped, and entered in their book as well as ours. As of this minute '
            + 'the account is a record, and as of this minute it is not ours alone. Get the '
            + 'docket back up the road before somebody decides that difference is worth '
            + 'arguing.',
        },
      ],
    },

    /* -- the receipt, and the win -------------------------------------------
     * `unitsInArea` on the counting house LOT rather than `ownerCount` on the
     * building, which is why scenario F is survivable: once the counterpart is
     * written the house is a building rather than the operation, and a broker
     * standing in its yard with a docket has finished the week.
     *
     * `ATTEST` at the store and `ENTER` here are four and three against six
     * clerks, and `4 + 3 = 7 > 6` is what makes this a leg rather than a
     * formality. See the header.
     */
    {
      id: 't.win',
      when: {
        on: 'all',
        of: [LODGED, { on: 'unitsInArea', player: 0, area: HOUSE_AREA, min: ENTER, tag: 'clerk' }],
      },
      then: [
        { do: 'completeObjective', id: 'receipt' },
        {
          do: 'dialogue',
          speaker: 'Tallow',
          text: 'Entered. Nine ledgers, one counterpart, and a docket in a drawer that proves '
            + 'somebody else is holding our book. It is worth less than it was on Monday and '
            + 'it is worth something for the first time. File the invoice for the copying.',
        },
        { do: 'endOperation', result: 'win' },
      ],
    },

    /* -- the counting house -------------------------------------------------
     * BEFORE THE COUNTERPART IS WRITTEN IT IS THE OPERATION; AFTER, IT IS A
     * BUILDING. The two arms are `HOUSE_GONE` conjoined with `COPY_MADE` and
     * its negation, so they partition and cannot both fire.
     *
     * `captureProof` names `house` because otherwise an Allied engineer walking
     * into it would satisfy the loss arm on the tick it changed hands — see the
     * header.
     */
    {
      id: 't.houseLost',
      when: { on: 'all', of: [HOUSE_GONE, { on: 'not', of: COPY_MADE }] },
      then: [
        { do: 'failObjective', id: 'copy' },
        { do: 'failObjective', id: 'lodge' },
        { do: 'failObjective', id: 'receipt' },
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'Counting house is gone with half a counterpart in it. We can copy what we can '
            + 'remember, which is an assertion about an assertion, and neither of us is '
            + 'signing that.',
        },
        { do: 'endOperation', result: 'loss', reason: 'copy' },
      ],
    },
    {
      id: 't.houseGoneLate',
      when: { on: 'all', of: [HOUSE_GONE, COPY_MADE] },
      then: [
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'House is down and the counterpart is out of it and moving. Finish the walk. '
            + 'The receipt gets entered on that lot whether there is a roof over it or not.',
        },
      ],
    },

    /* -- the clerks ---------------------------------------------------------
     * THE LOSS FIRES WHEN THE NEXT THRESHOLD BECOMES UNREACHABLE, NOT WHEN THE
     * LAST CLERK DIES. Below four the lodgement can never be attested; below
     * three, once it has been, the receipt can never be entered. Without this
     * pair a player would keep walking two survivors around for eleven minutes
     * with no way to be told, which is the silent-unwinnable failure the
     * validator refuses at import and cannot see inside a threshold.
     *
     * `SETTLE` is conjoined because a negated `min` reads TRUE against an empty
     * tag registry — trap 4 wearing a `not`.
     */
    {
      id: 't.clerksShort',
      when: {
        on: 'all',
        of: [SETTLE, { on: 'not', of: clerksAtLeast(ATTEST) }, { on: 'not', of: LODGED }],
      },
      then: [
        { do: 'failObjective', id: 'lodge' },
        { do: 'failObjective', id: 'receipt' },
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'Three hands left and the store wants four on the attestation. There is no '
            + 'lodging to be had today at any price, and the book is back to being a thing we '
            + 'say.',
        },
        { do: 'endOperation', result: 'loss', reason: 'lodge' },
      ],
    },
    {
      id: 't.clerksShortLate',
      when: {
        on: 'all',
        of: [SETTLE, { on: 'not', of: clerksAtLeast(ENTER) }, LODGED],
      },
      then: [
        { do: 'failObjective', id: 'receipt' },
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'The counterpart is lodged and the docket is lying on the sidings with the man '
            + 'who was carrying it. We can prove nothing and they can produce everything. That '
            + 'is worse than Monday.',
        },
        { do: 'endOperation', result: 'loss', reason: 'receipt' },
      ],
    },

    /* -- the week closing, telegraphed -------------------------------------
     * **AN EIGHTEEN-MINUTE DEADLINE THAT FAILS TWO PRIMARIES WAS NEVER STATED
     * ANYWHERE, AND THAT SHIPPED.** `ObjectiveRow` is `{ id, title, kind,
     * status }` — the title is the only sentence a player gets (trap 23) — and
     * none of the four titles, the `beat`, or any line in this table named a
     * clock. Grepped: the only strings matching `minute|hour|clock|deadline|
     * close|shut|week|time` were the detour's "costs you a minute" (itself six
     * times the measured figure, and corrected with it), the clerk
     * replacement's "not another this week", and `t.closeShort`'s own LOSS
     * line. Driven through the real `runDirector` in the world where nothing
     * ever walks, the effect log runs 11:00 Ardle, 14:30 (spawns, no dialogue),
     * then **seven minutes of silence and a defeat**.
     *
     * That matters most here of anywhere: `CLOSE` is set so that exactly one
     * failed engrossment is survivable, which is a seven-minute hold budgeted
     * against a clock the player was never shown.
     *
     * ONE LINE, UNCONDITIONAL, at minute sixteen — `reclamation.03.sold-twice`
     * and `.04.served-notice` both carry the same trigger, under the same
     * banner, two minutes out from their own `parSec` close, and
     * `.05.closing-entry` telegraphs its close in two arms. It also fills the
     * only silence in the file.
     */
    {
      id: 't.closing',
      when: { on: 'elapsed', ticks: minutes(16) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'Two minutes. The bond shuts its books at the hour and it does not stay open '
            + 'for a party still on the road — an unlodged counterpart on Monday is a sheet '
            + 'of paper with our own handwriting on it.',
        },
      ],
    },

    /* -- the close ----------------------------------------------------------
     * The bond shuts its books at the hour. Two arms on `LODGED` and its
     * negation, so the close is total: with the win above them, exactly one of
     * the three can resolve on the closing tick.
     */
    {
      id: 't.closeShort',
      when: { on: 'all', of: [{ on: 'elapsed', ticks: CLOSE }, { on: 'not', of: LODGED }] },
      then: [
        { do: 'failObjective', id: 'lodge' },
        { do: 'failObjective', id: 'receipt' },
        {
          do: 'dialogue',
          speaker: 'Tallow',
          text: 'The bond has shut its books, and on Monday the Allies file their objection '
            + 'against a ledger nobody else has ever seen. We had one week in which being '
            + 'right was going to be enough.',
        },
        { do: 'endOperation', result: 'loss', reason: 'lodge' },
      ],
    },
    {
      id: 't.closeUnentered',
      when: { on: 'all', of: [{ on: 'elapsed', ticks: CLOSE }, LODGED] },
      then: [
        { do: 'failObjective', id: 'receipt' },
        {
          do: 'dialogue',
          speaker: 'Tallow',
          text: 'A counterpart in a warehouse and no docket in our hands. We have given the '
            + 'account away and kept no proof that we were the ones who gave it. Book the week '
            + 'as a gift and do not itemise it.',
        },
        { do: 'endOperation', result: 'loss', reason: 'receipt' },
      ],
    },

    /* -- the yard is gone ----------------------------------------------------
     * `playerBeaten` is `Viability.isBeaten` — nothing to build with and
     * nothing to fight with — and it is the honest floor rather than "you have
     * no buildings".
     */
    {
      id: 't.rout',
      when: { on: 'playerBeaten', player: 0 },
      then: [
        { do: 'failObjective', id: 'lodge' },
        { do: 'failObjective', id: 'receipt' },
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'Nothing answering at the yard, and six clerks on a road with nobody in front '
            + 'of them. Whatever is in that book, we are not the ones who will be reading it '
            + 'out.',
        },
        { do: 'endOperation', result: 'loss', reason: 'lodge' },
      ],
    },
  ],
};

export default op;
