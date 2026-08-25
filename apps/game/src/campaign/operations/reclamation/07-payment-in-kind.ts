/**
 * ============================================================================
 * R7 — PAYMENT IN KIND
 * ============================================================================
 * R6 made a second copy of the account, and making one cost the Reclamation the
 * only thing the original had going for it: it is no longer the only one. That
 * is a worse commercial position and a better argumentative one, and this is the
 * week the difference gets tested — because the first thing a checkable book can
 * do that an unchecked one cannot is COLLECT.
 *
 * Eleven months of delivery notes. Three transfer gantries, rebuilt in
 * Reclamation shops and delivered to Continental Works Survey 52-130 between the
 * March and the autumn, signed for at the weighbridge and never once paid for.
 * Tallow has sent that account to the Works four times and had it back four
 * times marked *unsupported* — which was a fair word while one book in one hand
 * said whatever the hand wanted. It is not a fair word any more.
 *
 * The Works' answer is not that the notes are wrong. It is that the receiving
 * office which countersigned them was wound up in the spring, and the
 * Reclamation may take the matter up with an establishment that no longer
 * exists. So the Reclamation takes the matter up with the goods.
 *
 * ============================================================================
 * A DISTRAINT IS NOT A RAID, AND EVERY RULE IN THIS FILE IS THAT SENTENCE
 * ============================================================================
 * Three things follow from levying rather than raiding, and all three are
 * mechanical rather than atmospheric:
 *
 *   1. **You take what the entry names.** Three gantries, and the primary is
 *      `ownerCount(1, 'building', 'levy', max: 0)` — off the Works' books, by
 *      either verb. Broken or taken, the line is discharged.
 *   2. **What it is worth depends on how you take it.** The secondary is
 *      `ownerCount(0, 'building', 'levy', min: 2)` **conjoined with the
 *      discharge itself**, so it is read on the winning tick rather than
 *      latched the moment a second gantry changes hands — two of the three on
 *      OUR books, standing, WHEN THE ACCOUNT CLOSES. A gantry broken up
 *      discharges its line at scrap; a gantry taken discharges it at what the
 *      entry says. That difference is
 *      FICTION and is stated as such in Tallow's line — there is no in-match
 *      payout and there could not usefully be one, because seat 0 has nothing to
 *      spend it on. What it pays is the medal: `medalFor` gives silver only when
 *      every secondary is complete.
 *   3. **You do not touch their records.** The second primary is that the
 *      receiving office is still standing at the end, because their counterfoils
 *      are the half of this the Reclamation does not own — and a levy executed
 *      against a debtor whose proof of delivery you have burned is a theft with
 *      good handwriting.
 *
 * **RULE 3 IS R4 REVERSED AND THAT IS THE CHAPTER'S HINGE STATED AS A VERB.**
 * `reclamation.04.served-notice` sent a crew to DESTROY the district register
 * and its counterpart, in the same `civApartments` def this operation stands up,
 * and it was the right answer that week: a record nobody else holds is a threat.
 * A record two parties hold is EVIDENCE, and evidence you destroy is evidence
 * you destroyed. The player has been trained by this chapter to burn the other
 * side's paper. The duplicate is what expired that reflex, and the operation
 * says so out loud on an unconditional trigger rather than letting a defeat say
 * it.
 *
 * ============================================================================
 * THE CAPTURE ARITHMETIC, AND WHY THE PARTY IS EXACTLY FOUR TINKERS
 * ============================================================================
 * `Capture.resolve` flips an ENEMY structure only at or below
 * `CAPTURE.captureHpFrac` 0.50. Above it the engineer is spent and the structure
 * takes `maxHp * CAPTURE.softenFrac` 0.25 through
 * `ARMOR_MATRIX[HighExplosive][Concrete]` 1.00 and `COMBAT_DAMAGE.globalMul`
 * 0.80 = **0.20 of max**. Both are fractions of max, so `maxHp` cancels and the
 * ladder is the same for every structure in the game: 1.00 -> 0.80 -> 0.60 ->
 * 0.40, and the FOURTH engineer captures.
 *
 * **SO THE LADDER IS NOT A ROUTE ON THIS MAP, AND THE COMPOSITION SAYS SO.** The
 * layout stages FOUR `rclTinker` and there are THREE gantries. Four men laddered
 * into one gantry buy one gantry, no second, and nobody left to read the notice.
 * The affordable route is the other one:
 *
 *     shoot a gantry to at or under half, then ONE engineer takes it.
 *
 * Three gantries at one man each is three Tinkers, and the fourth is the clerk
 * on the weighbridge. **Every Tinker in the party is either a deed or the
 * notice**, and a player who walks one into a gantry at full health has spent a
 * quarter of the operation's paperwork on twenty percent of one machine.
 *
 * **AND SHOOTING IT TO THE GATE IS STRICTLY BETTER THAN LADDERING IT, WHICH IS
 * NOT THE INTUITIVE ANSWER.** The ladder arrives at exactly 0.40 of max; shot to
 * the gate and taken with one man it arrives at 0.50. The cheap route delivers
 * the goods in BETTER condition than the careful one. `Capture.resolve` writes
 * `st.hp` on its FRIENDLY (repair) branch only, so whatever the gantry is at
 * when it changes hands is what the Reclamation is left holding — at most half a
 * gantry, either way. That is the operation's own title, priced.
 *
 * ============================================================================
 * THE WINDOW, WHICH IS THE ONLY REAL SKILL TEST IN THE FILE
 * ============================================================================
 * A gantry is a `civOreMine`: **700 hp of `ArmorClass.Concrete`**, so the gate is
 * 350 and the ground between "capturable" and "gone" is 350 hp wide. Every
 * figure below is `damage * burstCount * ARMOR_MATRIX[warhead][Concrete] *
 * COMBAT_DAMAGE.globalMul / cycle`, derived from the shipped weapon rows:
 *
 *     rclGrinder   grinderArc  70 / 1.90 s  Tesla x0.60   17.68 dps
 *     rclSlagger   slagCharge  74 / 2.70 s  HighExpl x1.00 21.93
 *     rclSpitter   spitCoil    30 / 0.95 s  Tesla x0.60   15.16
 *     rclPicker    arcProd     26 / 1.05 s  Tesla x0.60   11.89
 *
 *     guns committed              dps      full -> gate    gate -> gone
 *     the whole party (18)      225.29        1.55 s          1.55 s
 *     five Grinders + two Slaggers 132.27     2.65            2.65
 *     five Grinders               88.42       3.96            3.96
 *     two Grinders                35.37       9.90            9.90
 *     one Grinder                 17.68      19.79           19.79
 *     one Slagger                 21.93      15.96           15.96
 *
 * **HOW MANY GUNS YOU POINT AT THE GOODS DECIDES HOW LONG YOUR WINDOW IS, AND
 * NOTHING ELSE DOES.** Committed in full the whole thing is over in three
 * seconds and the player is holding scrap; two Grinders give ten. That is the
 * decision the secondary is made of, and it costs nothing to get wrong — the
 * primary is satisfied by a broken gantry, so this is a WINDOW rather than a
 * trap. `reclamation.05.closing-entry` refused to make its bank threshold a
 * knife edge for the same reason; this refuses to make the goods one.
 *
 * **AND A BOLT AIMED AT ONE GANTRY CANNOT REACH THE NEXT.** `grinderArc`,
 * `spitCoil` and `arcProd` all carry a chain, and `COMBAT_WEAPONS
 * .teslaChainRange` is 9.0 m. Measured on the built world the three stand
 * **48.00, 44.18 and 62.23 m** apart, so the chain has nowhere to hop and a
 * player working one gantry down to its gate cannot break the one beside it by
 * accident. That is a property of the siding's spacing and it is why the spacing
 * is authored rather than convenient.
 *
 * ============================================================================
 * THE READING, AND WHERE A CLERK MAY STAND WHILE HE DOES IT
 * ============================================================================
 * A levy served is a levy nobody argues about afterwards, so `served` is
 * `unitsInArea(0, SCALE_AREA, min: 1, tag: 'clerk')` plus
 * `elapsedSinceArmed(seconds(40))` — a Tinker on the weighbridge apron for forty
 * seconds, where the Works' duty man can hear it. `elapsedSinceArmed` is a HOLD
 * timer and the Director evaluates the trigger twice for it, so a clerk who
 * steps off, dies, or is walked into a gantry instead **restarts the clock**.
 * Cregg says so on `t.terms`, which is UNCONDITIONAL at thirty-two seconds; it
 * used to be on an arrival trigger with a ninety-second backstop, and a
 * destroy-only rush reaches the win in a measured 53.1 s, so the rule that
 * decides one of the two secondaries was explained by a beat the ending could
 * outrun. A rule a player can only learn by losing it is a rule badly told, and
 * a rule told by a trigger that never fires is not told at all.
 *
 * **THE APRON IS CONTESTED AND THE FRACTION IS MEASURED.** The Works keeps a
 * post on the weighbridge — `pillbox` resolves through `keyFor` on a Soviet seat
 * to the SENTRY GUN, `pillboxMg`, 22 m, `chainCount` 0 — and it stands 23.35 m
 * from `SCALE_AREA`'s centre against that disc's radius of 20. Circle-on-circle,
 * **36.4% of the reading disc is inside the gun and 63.6% is not** — corroborated
 * cell by cell on the built world, 27 of the disc's 74 standable cells (36.5%)
 * inside 22 m of the post. Inside it a
 * clerk lasts 1.29 seconds: one pull is `5 x 13 x
 * ARMOR_MATRIX[SmallArms][Infantry] 1.00 x 0.80` = 52.0 on a
 * `(5-1) x 0.06 + 0.55` = 0.79 s cycle, which is 65.82 delivered dps against 85
 * hit points. So the forty seconds are available on the far arc, or after the
 * post is down, and not otherwise.
 *
 * ============================================================================
 * THE RECEIVING OFFICE: WHAT THE RESTRAINT COSTS, MEASURED RATHER THAN CLAIMED
 * ============================================================================
 * **IT COSTS A DISCIPLINED PLAYER NOTHING — AND THIS BLOCK HAS NOW BEEN WRONG
 * TWICE, ABOUT TWO DIFFERENT THINGS.** The first version proved it about a LINE
 * instead of about the STANDS, which is trap 18: it measured the office against
 * the straight line the party marches in on and against a Grinder's standoff at
 * the weighbridge post, declared *"nothing in the party can mark it from any
 * stand it has a reason to occupy"*, and did not measure the ONE stand this
 * operation ORDERS the player to occupy — the reading disc, for forty seconds.
 *
 * The second version fixed the SHAPE of that argument and got the HULL wrong,
 * which is trap 28: an acquisition envelope is `reach + the TARGET's hitRadius`,
 * so it is per-hull, and it has to be quoted against the longest-reaching hull
 * that can be in play rather than the longest-reaching one currently staged.
 * It derived `lane(0.40, -86)` from **`grinderArc` at 18 m**, the best gun in
 * the eighteen-hull party, and the rule is measured against
 * **`rclSlaghurler` at 42 m**, the best gun in the Reclamation.
 *
 * **THE BOUND IS NOT THE GUN, AND THE HULL IS NOT THE PARTY'S.**
 * `Combat.engage` gates firing on `max(0, flat - hitRadius(target))` and the
 * office's own hit radius is `hypot(4, 6)` = 7.211 m. `ScenarioBuilder
 * .spawnUnit` writes `options.stance ?? Stance.Aggressive` and `b.formation`
 * passes no stance, so every gun in the party is Aggressive — and for an Idle or
 * Guarding drivable hull `Targeting.reachOf` returns
 * `range x APPROACH_STOP_FRAC 0.80 + STANCE_CHASE_METRES[Aggressive] 18` of
 * SURFACE, which `acquire` uses as its radius and which `holdPost` then turns
 * into an `approach()` that closes to firing range on its own. Acquisition, not
 * range, is what the geometry has to clear — and per hull:
 *
 *     hull            range   reachOf (surface)   of centre   -> d >= 20 + that
 *     rclGrinder         18         32.4            39.611          59.611
 *     rclHulk            38         48.4            55.611          75.611
 *     rclSlaghurler      42         51.6            58.811          78.811
 *
 * **AND THE ROW THAT BINDS IS THE ARMY'S, NOT THE ROSTER'S.**
 * `tests/campaign-zone-safety.spec.ts` reads the longest range in the player's
 * whole faction and says in its own header why: `OperationRoster` is an
 * allow-list over UNLOCK-TAGGED defs only, so a roster-aware bar is narrower
 * than the truth. Here that distinction is live in both directions and worth
 * stating rather than inheriting. `rclSlaghurler` is `unit.specialist` and this
 * operation's `roster.player` is `['unit.raider']`, so the roster genuinely does
 * refuse it — the note further down about the Slaghurler being denied is
 * correct. But `rclHulk` at 38 m carries **no `UNLOCK_TAGS` id at all**, so no
 * allow-list can refuse it and the roster-aware bar is still 75.611, not 59.611.
 * The 3.2 m between the two is not worth an argument; what is worth stating is
 * that `roster.player` is one line in this file, and the office's safety must
 * not quietly depend on nobody ever adding to it.
 *
 * At `lane(0.40, -58)` the geometry cleared none of the three. At -86 it cleared
 * the Grinder and NOT the other two: measured on the built world against the
 * real `FlowFieldCache.hardGridFor(MoveClass.Wheel)`, of the 74 standable cells
 * in the reading disc, 0 were inside a Grinder's acquisition radius and **14
 * were inside a Slaghurler's, with 2 inside its chase cap**. `OFFICE` is
 * `lane(0.40, -103)` now and the layout carries the derivation — including why
 * -98 and -100 fail while being authored FURTHER OUT than the bar; the
 * requirement is `d(office, SCALE_AREA) >= 20 + 58.811` and the built distance
 * is 85.37 m.
 *
 *                                              at -58    at -86   at -103
 *     the office lands at                    188, 238  172, 214  160, 202
 *     ...to the nearest gantry                 114.14 m  128.02 m  140.36 m
 *     ...to the weighbridge post to clear       60.83     89.38    106.30
 *        minus a Grinder's own standoff there   17.23     17.23     17.23
 *                                            ->  43.60     72.15     89.07
 *     ...to the line the party marches in on    39.89     68.72     85.37
 *     ...to the nearest point of the disc       19.89     48.72     65.37
 *     ...to the nearest STANDABLE cell in it    21.26     50.00     66.84
 *     standable cells of 74 inside ANY of the
 *       three envelopes, vs the Grinder            33         0         0
 *       ...vs the Hulk                             69         9         0
 *       ...vs the Slaghurler                       73        14         0
 *
 * So nothing the player's ARMY can field marks it from any stand this operation
 * gives them a reason to occupy, and that sentence is now a measurement over a
 * set of stands and over a set of hulls rather than a distance to a path.
 * **WHAT CAN REACH IT IS A RIGHT-CLICK, AND WHAT CAN TAKE IT IS AN ENGINEER** —
 * which is why the restraint is worth a primary at all, and why it needs
 * `captureProof`.
 *
 * **`captureProof: ['office']`, AND IT IS AIMED AT THE PLAYER'S OWN FOUR
 * TINKERS.** `Targeting.isValidTarget` refuses only ALLIES, so an office the
 * player has captured stops being the Works' and becomes a legal target for
 * every gun the Works owns — while `t.notesLost` reads `entityDead` and does not
 * care who fired. That is `types.ts`'s protect-target case exactly: migrating
 * the trigger to `ownerCount` would not fix it, it would make the LOSS reachable
 * on the tick the player took the building into protective custody. The other
 * shipped shapes of this field protect a structure from an AI that has no
 * `OrderKind.Capture` call site at all; this one protects it from four engineers
 * the operation hands the player, on a map where capturing enemy buildings is
 * the whole verb. Moving the office out to `-103` does not weaken that argument
 * and was never meant to: a Tinker walks, and the office is one right-click from
 * the apron whatever the distance. What it costs is the walk — 85.37 m from the
 * apron at a Tinker's 3.5 m/s, 24.4 s each way against 19.6 s at -86 — and that
 * is a cost a player only pays if they CHOOSE to take the office, because the
 * primary is that it stands, not that it changes hands.
 *
 * **AND `entityDead` IS THE RIGHT CONDITION HERE FOR THE REASON IT IS USUALLY
 * THE WRONG ONE.** Trap 9 is that a captured structure is still alive, so
 * `entityDead` on an enemy building is capture-blind. On a PROTECT target that
 * blindness is the correct behaviour — a captured office is standing, and
 * standing is what the objective asks for — and `captureProof` is what stops
 * "standing on the player's books, inside the Works' fire" from being a state
 * the operation can reach.
 *
 * ============================================================================
 * WHY THIS IS `fixed-force` AND WHAT THE PARTY COSTS
 * ============================================================================
 * `opening: 'force'`, so the layout does not call `buildBaseFor` for seat 0 and
 * there is no yard, no queue and no nineteenth hull. Eighteen of them, **7 380
 * credits**: five Grinders (3 000), three Arcspitters (1 260), four Scrap
 * Pickers (360), two Slaggers (760) and four Tinkers (2 000).
 *
 * **TWO SLAGGERS AND NOT FOUR, WHICH IS THE FILE'S OPINION EXPRESSED IN THE
 * COMPOSITION.** `slagCharge` is the best anti-concrete row this army has — 21.93
 * delivered dps against a Grinder's 17.68 — and this operation's secondary is
 * about NOT breaking the goods up. `reclamation.04.served-notice` sends four
 * because its objective is two buildings it wants flat.
 *
 * The bank is 2 000 and **the only thing on this map to spend it on is the
 * repair wrench**, which is the same honest position `reclamation.04.served-notice`
 * is in at 2 500: no refinery, no producer, no queue. Mending the levy after you
 * have taken it — a gantry changes hands at or under half health, `Capture.resolve`
 * writes `st.hp` on its friendly branch only — is the most on-brand credit sink
 * this chapter has ever had and is still optional.
 *
 * **AND IT IS NOT A FIXED BANK, WHICH THIS BLOCK USED TO IMPLY.** A gantry is a
 * `civOreMine`, `CIVILIAN_MINE_INCOME` pays its holder 5 credits every 30 ticks,
 * and `payHolders` pays ANY owner whose faction is not Neutral. So a captured
 * gantry pays SEAT 0 at 5 cr/s against a `capFloor` of `STORAGE_BASE` 10 000 —
 * which is exactly where the wrench's money comes from on a seat with no
 * refinery, and is the reason the sink and the source are the same three
 * buildings. The layout's section 2 carries the derivation and the other half of
 * it, which is what those three pay the Works while they are still the Works'.
 *
 * ============================================================================
 * WHAT THE WORKS DOES ABOUT IT
 * ============================================================================
 * Three workings off `ROAD`, at minutes four, nine and fourteen, and the
 * escalation is in the TARGET rather than in the composition:
 *
 *     minute four    conscript x4, rhino x2   -> attack-move the WEIGHBRIDGE
 *     minute nine    conscript x4, rhino x3   -> attack-move NUMBER TWO
 *     minute fourteen conscript x4, rhino x3  -> attack-move NUMBER ONE
 *
 * The first goes for the reading, the second for the machine the player is most
 * likely to be standing on, and the third goes BEHIND them to the near gantry
 * and the road home. Three rings and nine drops rather than four rings and
 * thirteen, deliberately: the bearings are `i / count * 2pi` and every distinct
 * ring is a separate ground check that can rot, so waves two and three share
 * one.
 *
 * **THE RINGS ARE CHECKED, NOT SAMPLED.** `EffectSink.spawnUnits` writes the
 * computed point VERBATIM — no `connectedGround`, no egress search — so a drop
 * on closed ground is a hull that starts the fight wedged. Every drop of every
 * ring against its own locomotor on the built world:
 *
 *     conscript x4  r=12  Foot    clearances 99.0 / 28.1 / 13.3 / 25.6 m
 *     rhino     x2  r=18  Track              34.6 /  7.3
 *     rhino     x3  r=18  Track              34.6 / 22.7 / 17.9
 *
 * — nine drops, all open, worst clearance 7.3 m. `tests/campaign-spawn-ground.spec.ts`
 * is the standing gate and **a change to any `count` or `spread` invalidates
 * this**, because a wave of three does not stand where a wave of two does.
 *
 * **THE SCRIPTED WAVES ARE NOT THE WHOLE OF WHAT THE WORKS DOES, BECAUSE THE
 * GOODS PAY IT.** Three `civOreMine` on seat 1 at `CIVILIAN_MINE_INCOME`'s 5
 * credits per 30 ticks is **15 cr/s = 900 cr/min = 17 100 credits over `parSec`
 * 1140**, measured over the built store rather than assumed, and `AiBrain` spends
 * it through the same queue a player does. That is nineteen Anvil Tanks of
 * unscripted pressure ON TOP of the thirteen hulls above — and it is the levy's
 * own clock: every minute the entry stands unpaid funds the workings that stop
 * you collecting it. The layout's section 2 has the derivation and used to claim
 * the exact opposite.
 *
 * `ROAD` is 73.54 m out of the Works' gate, past `BUILD_RADIUS` 56, and
 * 169.24 m from the weighbridge. A conscript walks that in 49.8 s and a rhino
 * drives it in 31.3 s, which is why `t.first` carries the one `eva` in the
 * file — `forcesUnderAttack`, fired BEFORE the event rather than on it, since
 * `audio.system.ts` already speaks that line on any attack and nothing is
 * attacking yet.
 *
 * ============================================================================
 * NEITHER SHIPPED OUTCOME RULE MAY END THIS
 * ============================================================================
 * `assetLossDefeat` because the player owns **zero buildings at t = 0** and
 * `Shell.pollOutcome` would end the operation in a generic defeat at the
 * ten-second grace. `annihilationWin` because flattening a Continental Works
 * establishment is not the order and would end the week with a levy nobody
 * served and an entry nobody discharged — and because the player is denied
 * `unit.specialist`, so the Slaghurler, whose own blurb is "The only thing in
 * the army that can break a base", is not in the party at all.
 *
 * The authored ending is total by construction, in three parts rather than two:
 * `t.notesLost` takes every state in which the office is down, `t.win` takes
 * `LEVY_DONE` with it standing (`DISCHARGED`), and `t.close` takes
 * `not(LEVY_DONE)` at exactly `parSec`. `t.rout` is the floor under all three.
 * It was a two-way partition on `LEVY_DONE` alone, which relied on trigger ORDER
 * to keep the win off a tick where the office had just burned — and order does
 * not do that: see `DISCHARGED`.
 *
 * ============================================================================
 * THE ROSTER
 * ============================================================================
 * `player: ['unit.raider']`, `ai: []`.
 *
 * The Arcspitter is carried forward from every operation in this chapter and is
 * what makes eighteen hulls able to cross 252.79 m of open valley at all
 * (8.8 m/s against a Grinder's 5.8). Everything else the layout stages is
 * untagged and day-one open.
 *
 * **THE EMPTY `ai` LIST IS THE HALF THAT BITES, AND IT IS MEASURED.** Built
 * twice with the def tables bound — once with this roster installed and once
 * without — the roster removes **`teslaCoil` x3, `apocalypse` x1, `attackDog` x2
 * and `battleLab` x1** from seat 1. The three Tesla Coils are the load-bearing
 * ones: `teslaBolt` is 30 m with `chainCount` 2, one pull is 153.6 then 92.2
 * against Infantry, and every man who matters in this party — four Tinkers and
 * four Scrap Pickers — is **85 hit points**. Two die per trigger. That is
 * `tests/campaign-emplacement-reach.spec.ts`'s whole subject, and deleting the
 * empty list puts three of them on a map whose entire objective is walking
 * engineers up to buildings.
 *
 * ============================================================================
 * WHAT WAS CONSIDERED AND CUT
 * ============================================================================
 *   - **DESTROYING A GANTRY AS A LOSS.** The first shape of this operation made
 *     the primary a capture and breaking the goods a defeat. It is a trap rather
 *     than a rule: `Targeting`'s automatic acquisition does not know the player
 *     wants a structure kept, the whole party committed clears the 350 hp gate to
 *     zero in 1.55 s, and an RTS objective that punishes an auto-acquired shot is
 *     a fiddliness tax. Moving the condition to the SECONDARY keeps every
 *     measurement above and costs the player money instead of the match.
 *   - **A SCRIPTED FRIENDLY WAVE.** `reclamation.01.held-paper` pays four
 *     Grinders for a lost yard and R4 sends a second crew at minute four. Here
 *     the party is four Tinkers against three gantries and a notice, and the
 *     arithmetic being exactly tight is the operation. A fifth engineer is a hole
 *     in it.
 *   - **A THIRD SECONDARY ON THE OFFICE'S CONDITION** — "take the levy without a
 *     mark on the office", `not(entityHpBelow('office', 1))`. Expressible, and
 *     measurably free at `lane(0.40, -103)`: 0 of the 74 standable cells in the
 *     reading disc are inside the firing, chase or acquisition envelope of any
 *     of `rclGrinder`, `rclHulk` or `rclSlaghurler`, so the row would pay a medal
 *     for not doing something no player was going to do. The restraint stays a
 *     primary, where its teeth are `captureProof` and its cost is a habit.
 *     **This bullet has been the file's defence of two geometries now and it was
 *     reasoning rather than measurement in the first, and measurement of the
 *     wrong hull in the second** — cut as free at -58 while 33 of those 74 cells
 *     were inside a Grinder's acquisition radius, and restated as free at -86
 *     while 14 were inside a Slaghurler's. It is a real measurement at -103 and
 *     the sweep behind it is in the layout, which is exactly the argument for
 *     measuring a cut instead of arguing one — twice over.
 *   - **THREE DIFFERENT DEFS FOR THE THREE ITEMS.** A refinery and a war factory
 *     would have read as more interesting plant and would have handed the Works
 *     a second economy and a second production line for the duration. The entry
 *     names one machine three times; the ground says so.
 *
 * ============================================================================
 * EVERY ENDING WAS DRIVEN THROUGH THE REAL `runDirector`, AND IT FOUND THREE
 * ============================================================================
 * Nine scripted worlds fed to the shipped Director at 30 Hz against a stub
 * `WorldQuery` whose objective map IS `state.objectives` — the same map
 * `CampaignSession.setObjective` writes and `objectiveComplete` reads back, and
 * the first version of this harness kept its own copy, which silently made
 * `t.oneOff` unreachable and `t.unserved` fire on top of a completed `served`.
 * A harness that duplicates a piece of engine state measures a different game.
 *
 *     clean       served 110 s, `whole` + win 400 s, SILVER
 *     rush        all three broken at 56 s: served FAILED, `whole` failed,
 *                   win, BRONZE — `whole` REVEALED at 32 s
 *     latch       capture two at 200 s, Works levels both at 500 s, third
 *                   broken at 600 s -> `whole` FAILED, BRONZE
 *     burned      office down at 320 s -> loss (notes), `whole` unresolved
 *     collision   last gantry and the office on ONE tick -> one beat, loss
 *     whistle     `notes` complete, `levy` failed, loss at exactly 1140 s
 *     rout        `notes` complete, `levy` failed
 *     one tick    all three off together, served done -> Cregg then Tallow
 *     worst tick  all three off together, two captured, never served ->
 *                   Cregg, Cregg, Tallow
 *     steps off   reading completes 40 s after RE-ENTRY, not after arrival
 *
 * **THE `steps off` ROW IS THE HOLD TIMER PROVED RATHER THAN ASSERTED.** The
 * three defects the harness found are `t.oneOff`'s (an ending that fired it,
 * `t.whole` and `t.win` together with Tallow answering herself — fixed by
 * `not(LEVY_DONE)`, trap 26 verbatim), the `latch` row, and the `collision` row.
 * The last two are the ones the shipped file had:
 *
 *   - **`latch` banked SILVER for holding nothing.** `t.whole` was a bare
 *     `ownerCount(0, ..., min: 2)`, `setObjective` refuses to un-resolve, and
 *     `t.notWhole`'s fail was swallowed 400 seconds later. See `t.whole`.
 *   - **`collision` produced FOUR beats and a contradiction.** Tallow reported
 *     the counterfoils burned and then, one beat later on the same tick, *"their
 *     office still standing behind it"*, plus a second `endOperation` the
 *     outcome latch swallowed. See `DISCHARGED`.
 *
 * **THE HONEST BOUND IS NOW THREE BEATS FROM TWO SPEAKERS**, not two — the
 * `worst tick` row, where all three gantries come off at once with two of them
 * captured and the notice never served, so `t.unserved` and `t.whole` both put a
 * Cregg line in front of Tallow's close. Measured rather than claimed, and the
 * alternative was a condition that made one of the two silent in a corner where
 * both are true.
 *
 * ============================================================================
 * THE MEASURED POINTS
 * ============================================================================
 * Every coordinate the trigger table names is IMPORTED from the layout and
 * computed there from `SIM_SEED` at module load — `reclamation-served-notice` is
 * the precedent and its header carries the argument. What is measured rather
 * than derived is where each structure LANDS after `spawnBuilding` snaps its
 * footprint to the placement grid.
 *
 * Built headless at `mapSeed` 52 130 / `simSeed` 22 461 on `biome: 'temperate'`
 * with the def tables bound and this operation's roster installed — the same
 * build `tests/campaign-roster-ground.spec.ts` performs:
 *
 *     party form-up      134.6, 357.7      weighbridge        210, 272
 *     Number One         300, 260          Number Two         300, 212
 *     Number Three       344, 216          receiving office   160, 202
 *     the three posts    230,282  286,246  322,210
 *     Works gate         404, 132          ROAD              335.3, 158.2
 *
 *     seat 0    0 buildings   18 units
 *     seat 1   32 buildings   13 units
 *
 * Every tagged structure lands within **2.13 m** of its authored point — the
 * weighbridge post, at `lane(0.40, 4)` -> (228.97, 283.87) -> (230, 282) — which
 * is one grid snap on each axis and not a search. (This read 2.08 m, which was
 * never any structure's snap; re-measured over all eight tagged placements.
 * Still 2.13 m after the office moved to `lane(0.40, -103)`: that placement's
 * own snap fell from 2.02 m at -58 and 1.21 m at -86 to **0.29 m**, which is the
 * tie-break the layout's `OFFICE` block spends its last paragraph on.)
 * `auditConnectivity`: **1 passable
 * region for a tracked hull holding 12 775 of 12 775 cells (100.0%); 0
 * placements relocated; 0 entities stranded; 0 structures on ground
 * `isBuildable` refuses.**
 *
 * **EVERY GANTRY HAS A CLEAR FACE AND A COVERED ONE.** Sampling the capture
 * stand — `CAPTURE.reachMetres` 2.2 beyond an 8 x 8 m footprint edge — at one
 * degree against all three posts' 22 m reach:
 *
 *     Number One    163 of 360 degrees outside every post
 *     Number Two    198 of 360
 *     Number Three  211 of 360
 *
 * So taking a gantry is a choice of which face to walk the engineer in on, and
 * the wrong face is 1.29 seconds for an 85 hp man. That is the second decision
 * in the operation and the layout owns it.
 * ========================================================================== */

import { Faction } from '../../../core/types';
import { minutes, seconds } from '../../types';
import type { Condition, OperationDef } from '../../types';
import {
  GANTRY_ONE, GANTRY_TWO, OFFICE, OFFICE_AREA, ROAD, SCALE, SCALE_AREA, SIDING_AREA, SIM_SEED,
} from '../../layouts/reclamation-payment-in-kind';

/**
 * How long the layout is given to have placed the composition before a zero
 * threshold over it is believed.
 *
 * **EVERY `max:` THRESHOLD IN THIS FILE IS CONJOINED WITH IT.**
 * `ownerCount(..., max: 0)` reads TRUE against an empty tag registry, exactly as
 * `entityDead` does — the spelling changed and the hazard did not. Unguarded,
 * `t.win` would hand the player the operation on the first tick the Director
 * runs and `t.notesLost` would end it in a defeat on the same one.
 *
 * **IT GUARDS A LAYOUT THAT PLACED NOTHING, NOT A TICK-ONE READ THAT HAPPENS
 * TODAY.** `scenarios.system.ts` builds the world inside `async init()` and
 * `SystemRegistry.init` awaits every module's init before a tick is taken, so
 * the registry is never empty when the Director first runs. What IS reachable is
 * a roster typo or a footprint that will not fit, which
 * `tests/campaign-roster-ground.spec.ts` and `tests/campaign-maps.spec.ts` catch
 * at their causes; this stops the symptom being instant.
 *
 * Twenty seconds is past the build and short of anything happening. Measured on
 * the built world, the nearest hostile thing to the party at t = 0 is the
 * weighbridge post 121.80 m away and it does not move; the Works' establishment
 * is 351.42 m off and the fastest hull on that seat is a 5.4 m/s Anvil — 108 m
 * of straight line in twenty seconds, with 243 m still to go.
 */
const SETTLE: Condition = { on: 'elapsed', ticks: seconds(20) };

/**
 * How long a notice takes to read.
 *
 * FORTY SECONDS, AND IT IS A HOLD RATHER THAN A VISIT. The clerk walks 114.11 m
 * to get there at a Tinker's 3.5 m/s — 32.6 s — so the reading is available from
 * about t+1:15 and the first working does not leave the Works' gate until minute
 * four. A player who goes straight there is never contested for it; a player who
 * takes the siding first is reading a notice with Anvils on the road.
 */
const READING = seconds(40);

/**
 * The end of the shift. EXACTLY `parSec`, to the second.
 *
 * The authored par IS the deadline rather than a description of one, which is
 * the only way that field is falsifiable from inside the operation —
 * `reclamation.03.sold-twice` sets the same relationship at 900,
 * `reclamation.04.served-notice` at 960 and `reclamation.05.closing-entry` at
 * 1020.
 */
const CLOSE = minutes(19);

/**
 * The levy is discharged: the Works owns none of the three.
 *
 * `ownerCount` on SEAT 1, never `entityDead` — a captured gantry is still alive
 * and taking them is half the operation, so a corpse-counting condition would
 * make the win unreachable by the route the file is built around. Trap 9, and
 * `soviets.06.demolition-order` is the worked example.
 */
const LEVY_DONE: Condition = {
  on: 'all',
  of: [SETTLE, { on: 'ownerCount', player: 1, role: 'building', tag: 'levy', max: 0 }],
};

/** At least one gantry is off their books, by either verb. */
const FIRST_GONE: Condition = {
  on: 'all',
  of: [SETTLE, { on: 'ownerCount', player: 1, role: 'building', tag: 'levy', max: 2 }],
};

/**
 * THE ACCOUNT IS CLOSED: the levy is discharged AND the counterfoils survived
 * it. The win, and the moment `whole` is finally worth something.
 *
 * **`entityAlive` IS CONJOINED HERE RATHER THAN LEFT TO TRIGGER ORDER, AND
 * DRIVING THE REAL `runDirector` IS WHAT FOUND THAT IT HAD TO BE.** `t.notesLost`
 * sits above `t.win` and the first version of this file took that to mean the
 * win could not fire on a tick where the office was down. It does not:
 * `runDirector` collects the effects of EVERY trigger whose condition holds and
 * `CampaignSession.apply` runs the whole list, so trigger order decides BEAT
 * ORDER and nothing else. What order does buy is the next tick —
 * `runDirector`'s first statement is `if (state.outcome !== null) return 0`.
 *
 * Driven at 30 Hz against the real Director, a world in which the last gantry
 * comes off the Works' books on the SAME TICK a stray round finishes the office
 * emitted, in this order: Tallow *"The receiving office is down and their
 * counterfoils went with it"*, `endOperation` loss — and then Tallow again,
 * *"Three lines off the entry and their office still standing behind it"*, plus
 * a second `endOperation` the outcome latch swallowed. **Four beats on the
 * ending tick with one speaker contradicting herself back to back**, against
 * this file's own claimed bound of two beats from two speakers.
 *
 * `entityAlive` needs no settle guard and is the OPPOSITE polarity to
 * `entityDead`: it reads FALSE against an empty tag registry, which withholds
 * the win rather than granting it. `LEVY_DONE` carries `SETTLE` in any case.
 */
const DISCHARGED: Condition = {
  on: 'all',
  of: [LEVY_DONE, { on: 'entityAlive', tag: 'office' }],
};

const op: OperationDef = {
  id: 'reclamation.07.payment-in-kind',
  chapter: 'reclamation',
  faction: Faction.Reclaim,
  /*
   * CONTINENTAL WORKS, AND IT CLOSES THE CHAPTER'S OWN LOOP.
   *
   * "Nine breaking yards, every faction as a customer, and the only complete
   * account." R1 and R2 are fought against the Soviets, R3 and R4 against the
   * Allies, R5 against the Pact and R6 against the Allies again. Coming back to
   * the Works is the rhyme the chapter opened on: R1's beat is *"The yards are
   * already yours. Nobody has read the paperwork."* Somebody has read it now,
   * and it is the Reclamation, and this time the paperwork is the weapon rather
   * than the excuse.
   *
   * Every scripted key on seat 1 is a literal Soviet `conscript` or `rhino`,
   * which `validateCampaign` checks against the army of the seat it lands on.
   */
  foe: Faction.Soviets,
  index: 7,
  title: 'Payment in Kind',
  beat: 'Eleven months of delivery notes, and a book somebody else can now check. That makes it a debt.',
  /*
   * FIXED-FORCE. The chapter has not used it — R1 assault, R2 economy, R3
   * capture-hold, R4 infiltrate, R5 defend, R6 escort — and `validateCampaign`
   * refuses two adjacent operations in one chapter that share a `primaryType`
   * in any case. It is honest rather than convenient: `opening: 'force'`, no
   * base, no queue, and eighteen hulls of which four are the whole of the
   * operation's paperwork.
   */
  primaryType: 'fixed-force',
  // Objective state in all three directions, spawns, orders, reveals, dialogue,
  // EVA, a camera move and an outcome — the definition in `types.ts` is
  // "multiple effect kinds", and this is TEN of the eleven. Only `grantCredits`
  // is unused, for the reason the bank is 2 000: there is nothing to buy.
  archetype: 'bespoke',
  parSec: 1140,
  requires: ['reclamation.06.in-duplicate'],

  map: {
    /*
     * TEMPERATE ON BOTH LINES, WHICH IS THE ONE PAIRING THAT CANNOT MAKE R3's
     * MISTAKE. `MAP_PRESETS` and `BiomeName` overlap on `temperate`, `snow` and
     * `urban` and disagree on exactly one name — the preset is `arid`, the biome
     * is `desert` — and `reclamation.03.sold-twice` shipped on the wrong side of
     * that and measured two headers' worth of numbers against ground it had not
     * declared. This pair is the same word twice.
     */
    preset: 'temperate',
    /**
     * The survey designation. 52-130 is the number in the briefing and it is the
     * seed the layout swept for: of eight rolls scored against the seven
     * stations this composition needs, it is the only one whose approach
     * corridor is unbroken for a wheeled hull at every sample. See the layout's
     * header for the table.
     *
     * Pinned by `tests/campaign-maps.spec.ts` as a terrain fingerprint: a
     * generator change that re-rolls this ground moves every measured placement
     * in both headers.
     */
    mapSeed: 52_130,
    /*
     * IMPORTED FROM THE LAYOUT, WHICH OWNS IT.
     *
     * `simSeed` decides which two corners the match is played in, and every
     * point the trigger table below names is computed from exactly that in
     * `reclamation-payment-in-kind.ts` — out of `seatedSlots`,
     * `SKIRMISH_START_OFFSETS` and `MAP_SIZE`, at module load, arithmetic rather
     * than measurement. Writing the number here as well would be the same fact
     * in two files, and the failure mode — a reading disc framing open country,
     * a working forming up where nobody authored one — is invisible to every
     * gate.
     */
    simSeed: SIM_SEED,
    armies: 2,
    biome: 'temperate',
    /*
     * `force`. A distraint is executed by a party that arrives, takes and
     * leaves; it does not found a yard on the debtor's ground first. The layout
     * simply does not call `buildBaseFor` for seat 0, which is the whole of what
     * this value means — `'force'` is the campaign's own opening and is
     * deliberately NOT in `START_CONDITIONS`.
     */
    opening: 'force',
    /*
     * 2 000, AND THE ONLY THING ON THIS MAP TO SPEND IT ON IS THE WRENCH.
     *
     * Stated rather than dressed up: seat 0 owns no refinery, no producer and no
     * queue, so the only consumer is the repair wrench at `REPAIR_COST_PER_HP`,
     * on a gantry that has just changed hands at or under half health.
     * `reclamation.04.served-notice` is in the same position at 2 500 and
     * `reclamation.01.held-paper` at 3 000, where the difference is that R1's
     * layout hands the player a Rookery. This one does not.
     *
     * **IT IS AN OPENING BANK RATHER THAN A BUDGET, THOUGH, BECAUSE THE GOODS
     * PAY.** `civOreMine` is `CIVILIAN_MINE_INCOME` — 5 credits per 30 ticks to
     * any non-Neutral holder — so a captured gantry earns seat 0 5 cr/s and the
     * three of them earn the WORKS 900 cr/min for as long as it keeps them. The
     * layout's section 2 measures both halves.
     *
     * `applySimPostBoot` writes `startingCredits` into every non-Neutral slot,
     * so the number binds the Works too — and half the skirmish default for
     * CLAUDE.md's measured reason: a brain with a 10 000 opening puts up a
     * seven-building base and eleven troops by t+90 s having mined nothing. That
     * argument is now doing LESS work than it reads as doing: 900 cr/min off the
     * gantries is 17 100 credits over `parSec`, which dwarfs the 8 000 the
     * halved opening withheld.
     */
    credits: 2_000,
  },
  layout: 'reclamation-payment-in-kind',

  // NEITHER SHIPPED RULE MAY END THIS. See the header — `assetLossDefeat` in
  // particular, because seat 0 opens with zero buildings.
  outcome: { annihilationWin: false, assetLossDefeat: false, ignoreSeats: [] },

  roster: {
    player: ['unit.raider'],
    ai: [],
  },

  /*
   * THE RECEIVING OFFICE, AND THE GANTRIES ARE DELIBERATELY NOT HERE. See the
   * header: the operation wants those taken, by either verb, and a blanket
   * `'all'` would make its own primary unreachable by the route the composition
   * is built around.
   */
  captureProof: ['office'],

  objectives: [
    {
      id: 'levy',
      kind: 'primary',
      /*
       * "OFF THE WORKS' BOOKS", NOT "DESTROY". `t.win` counts what seat 1 still
       * owns, so an engineer walked into a gantry finishes it exactly as
       * levelling it does — and a title saying "destroy" would name the one
       * route the rule does not require, on an operation whose whole point is
       * that the other route is worth more. Trap 9's wording, inverted.
       */
      title: 'Take the three gantries off the Works\' books',
    },
    {
      id: 'notes',
      kind: 'primary',
      /*
       * THE ONLY SENTENCE THE PLAYER GETS. `ObjectiveRow` is
       * `{ id, title, kind, status }` — there is no description and no tooltip —
       * so a bar that is not in the title is a bar nobody was told about.
       * `t.brief` says WHY on an unconditional trigger for the same reason.
       */
      title: 'Leave the receiving office standing',
    },
    {
      id: 'served',
      kind: 'secondary',
      title: 'Read the entry out at the weighbridge before the first gantry goes',
    },
    {
      id: 'whole',
      kind: 'secondary',
      hidden: true,
      /*
       * NO `credits` FIELD, AND NOT BECAUSE THE VALIDATOR WOULD REFUSE ONE — it
       * would not, this is a secondary. Seat 0 has no producer and no queue, so
       * the only consumer on the map is the repair wrench, and a grant on the
       * WINNING TICK reaches it after the last thing it could mend has stopped
       * mattering. It would be a number that moves and changes nothing, which is
       * worse than no reward at all.
       * `reclamation.04.served-notice`'s `quiet` is unpaid for the same reason.
       * What both pay is the medal: `medalFor` gives silver only when every
       * secondary is complete.
       *
       * **"STANDING" IS AN END STATE AND THE RULE FINALLY AGREES WITH IT.** The
       * title is unchanged and the mechanism moved to meet it — see `t.whole`,
       * which used to latch COMPLETE at the second capture and could not
       * un-resolve, so this row paid silver to a player holding none. A title is
       * the only sentence `ObjectiveRow` gives the player; when the title and
       * the trigger disagree it is the trigger that is wrong.
       */
      title: 'Put two of the three gantries on our books standing',
    },
  ],

  triggers: [
    /* -- the account, in two beats ----------------------------------------
     * Split across fourteen seconds because the shell renders dialogue as
     * toasts and four at once is a stack nobody reads — and because two
     * speakers inside six seconds is exactly the case `Shell.campaignBeatSeq`
     * was written for, so both halves of each beat really do arrive.
     *
     * Tallow opens because it is her account and she is the one who has sent it
     * four times. Cregg carries the ground, as he has for six operations.
     */
    {
      id: 't.open',
      when: { on: 'elapsed', ticks: seconds(4) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Tallow',
          text: 'Continental Works, Survey 52-130. Three transfer gantries, rebuilt in our '
            + 'shops and delivered onto that siding between the March and the autumn, signed '
            + 'for on their own weighbridge. Eleven months, four accounts sent, four accounts '
            + 'returned marked unsupported.',
        },
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'And it was a fair word while we were the only ones holding a book. One hand, '
            + 'one ledger, whatever the hand wants. It is not a fair word since the duplicate. '
            + 'Two parties can produce that account now, and an account two parties can produce '
            + 'is a debt.',
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
          text: 'So we levy. The three gantries come off their books today, whole if you can '
            + 'manage it and as scrap if you cannot — the line is discharged either way and the '
            + 'only difference is what we are left holding at the end of it.',
        },
        { do: 'revealArea', player: 0, area: SIDING_AREA },
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'And the receiving office on the weighbridge road stays exactly where it is. '
            + 'Their counterfoils are in it, and their counterfoils are the half of this we do '
            + 'not own. We burned a register at the halt on 58-273 and it was the right answer '
            + 'that week. That was a month ago and one book ago.',
        },
        { do: 'revealArea', player: 0, area: OFFICE_AREA },
      ],
    },

    /* -- the terms ---------------------------------------------------------
     * UNCONDITIONAL, AT THIRTY-TWO SECONDS, AND IT USED TO BE A CONDITIONAL
     * TRIGGER WITH A NINETY-SECOND BACKSTOP THAT A RUSH BEATS.
     *
     * This is the only thing in the file that calls `setObjective('whole')`, so
     * whatever fires it decides whether the hidden secondary is ever on the
     * panel at all — and `runDirector` evaluates nothing once an outcome is set,
     * so a win before it fires means the row is never revealed and the medal is
     * for something the player was never shown.
     *
     * **THE OLD ARGUMENT FOR NINETY SECONDS WAS WRONG BY ITS OWN TWO NUMBERS.**
     * It read: *"Five Grinders take a gantry from full to nothing in 7.92 s and
     * the walk is 43.6 s, so a win inside ninety seconds is not reachable"* —
     * 43.6 + 3 x 7.92 is 67.4, which is inside ninety before any of the other
     * corrections. Measured properly, with an 8-connected metric Dijkstra over
     * the real `FlowFieldCache.costGridFor(MoveClass.Wheel)` on the built world,
     * destination-cell weights, corner-cut refused, `COST_BLOCKED` imported from
     * `src/world/terrain-gen.ts` and a control confirming the grid refuses
     * **3 795 of 16 384 cells (23.2%)** and reads 255 at the Works' own start:
     *
     *     nearest seat-0 hull -> a Grinder's firing stand at Number One   160.8 m
     *     Number One -> Number Two                                         34.8 m
     *     Number Two -> Number Three                                       21.6 m
     *     ------------------------------------------------------------ 217.2 m
     *     at a Grinder's 5.8 m/s                                          37.4 s
     *     3 x 700 hp Concrete at five Grinders + three Arcspitters
     *       (88.42 + 45.48 = 133.90 dps)                                  15.7 s
     *     ------------------------------- destroy-only LOWER BOUND        53.1 s
     *
     * A bound rather than a time: it ignores turning, acquisition, the three
     * posts and the fact that a party spread over thirty metres arrives spread.
     * Thirty-two seconds is 21.1 s clear of it, and no condition can outrun an
     * `elapsed`.
     *
     * **THE INSTRUCTION MOVED WITH THE REVEAL, DELIBERATELY.** Cregg's apron
     * rule used to fire on ARRIVAL, which reads better and is trap 23's
     * failure: the hold, the restart and the ordering are the mechanism the
     * `served` row is made of, and a mechanism explained by a trigger the win
     * can outrun is a mechanism explained to nobody. It costs almost nothing in
     * pacing either: a Tinker's straight-line walk to the apron is 114.11 m at
     * 3.5 m/s = 32.6 s, so a player who sends one straight there still hears the
     * rule within a second of arriving, and a player who does not hears it
     * early rather than never.
     *
     * `hidden` still earns its place: the opening panel is three rows and
     * Tallow's terms are what put the fourth on it.
     */
    {
      id: 't.terms',
      when: { on: 'elapsed', ticks: seconds(32) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'The weighbridge on the near road is where every one of those notes was signed. '
            + 'Stand one of the Tinkers on the apron for forty seconds and read the entry out '
            + 'where their duty man can hear it — a levy served is a levy nobody argues about '
            + 'afterwards. '
            + 'Come off the apron and the reading starts again from the top.',
        },
        {
          do: 'dialogue',
          speaker: 'Tallow',
          text: 'One more thing the entry says. Those gantries are booked at what they are worth '
            + 'standing. Break one up and we discharge that line at scrap value, which is about '
            + 'a fifth of it and no further claim. Two of the three on our books upright and I '
            + 'will sign the account closed.',
        },
        { do: 'setObjective', id: 'whole' },
      ],
    },

    /* -- the first working -------------------------------------------------
     * Minute four, unconditional. A wave that fires only when the player is
     * elsewhere reads as the map cheating; a schedule the world keeps regardless
     * reads as an opponent, which is `soviets.03.deep-sector`'s argument about
     * scripted waves on an AI seat.
     *
     * Pointed at the WEIGHBRIDGE, because the reading is the thing the Works can
     * least afford to have happen. `AiBrain.regroupSquads` files every untagged
     * hull the seat owns into a squad on its next pass, so the attack-move is
     * the first thing these six do and the brain owns them afterwards — the
     * honest limit of what a scripted wave buys.
     *
     * LITERAL SOVIET KEYS. `EffectSink.spawnUnits` resolves through
     * `ProductionCatalog.byKey` and remaps nothing, unlike the layout's
     * `ScenarioBuilder.spawnUnit`; `validateCampaign` checks each key against
     * the army of the seat it lands on, so a Reclamation key here is a build
     * error.
     *
     * The `eva` lands BEFORE the event rather than on it, which is the only way
     * a scripted one earns its place: `audio.system.ts` already speaks
     * `forcesUnderAttack` on any attack, and this column is 169.24 m and 31 to
     * 50 seconds from touching anything.
     */
    {
      id: 't.first',
      when: { on: 'elapsed', ticks: minutes(4) },
      then: [
        { do: 'eva', line: 'forcesUnderAttack' },
        {
          do: 'dialogue',
          speaker: 'Skell, Works receiving',
          text: 'Reclamation party on the weighbridge road with an account we have already '
            + 'answered. The office that countersigned those notes was wound up in the spring. '
            + 'There is nobody standing here who owes them anything. Put a working on the '
            + 'weighbridge and log the time.',
        },
        {
          do: 'spawnUnits', player: 1, key: 'conscript', count: 4, at: ROAD, spread: 12, tag: 'column',
        },
        {
          do: 'spawnUnits', player: 1, key: 'rhino', count: 2, at: ROAD, spread: 18, tag: 'column',
        },
        { do: 'orderTagged', tag: 'column', order: 'attackMove', at: SCALE },
      ],
    },

    /* -- the second --------------------------------------------------------
     * Pointed at Number Two, which is the machine a player working the siding is
     * most likely to be standing on. It joins the `column` tag rather than
     * taking its own, so one `orderTagged` re-points the survivors of both —
     * `EffectSink.orderTagged` issues ONE command per owner and every one of
     * them is seat 1.
     */
    {
      id: 't.second',
      when: { on: 'elapsed', ticks: minutes(9) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Skell, Works receiving',
          text: 'Second working. They are not reading that out for our benefit, they are '
            + 'reading it out so somebody else can check it later, and that is the part I am '
            + 'not prepared to sign for. Clear the siding.',
        },
        {
          do: 'spawnUnits', player: 1, key: 'conscript', count: 4, at: ROAD, spread: 12, tag: 'column',
        },
        {
          do: 'spawnUnits', player: 1, key: 'rhino', count: 3, at: ROAD, spread: 18, tag: 'column',
        },
        { do: 'orderTagged', tag: 'column', order: 'attackMove', at: GANTRY_TWO },
      ],
    },

    /* -- the third ---------------------------------------------------------
     * Same composition as the second and a different place: BEHIND the party, at
     * the near gantry and the road home. The escalation in this operation is in
     * the target rather than in the weight, which is also why waves two and
     * three share their two rings — every distinct ring is a separate ground
     * check that can rot.
     */
    {
      id: 't.third',
      when: { on: 'elapsed', ticks: minutes(14) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Skell, Works receiving',
          text: 'Third, and take the road end this time. Whatever is standing on that siding at '
            + 'the whistle is Works plant and has been Works plant since the spring, and I will '
            + 'write that as often as they write theirs.',
        },
        {
          do: 'spawnUnits', player: 1, key: 'conscript', count: 4, at: ROAD, spread: 12, tag: 'column',
        },
        {
          do: 'spawnUnits', player: 1, key: 'rhino', count: 3, at: ROAD, spread: 18, tag: 'column',
        },
        { do: 'orderTagged', tag: 'column', order: 'attackMove', at: GANTRY_ONE },
      ],
    },

    /* -- somebody is shooting the counterfoils ------------------------------
     * `entityHpBelow` with `frac: 1` — ANY damage at all. It is the one
     * condition in the vocabulary that is SAFE against an empty registry:
     * `weakestHpFrac` answers -1 when nothing carries the tag and the Director
     * refuses a negative, so this needs no settle guard where every `max:`
     * threshold in the file does.
     *
     * **THE ONE `cameraMove` IN THE OPERATION, AND IT IS HERE BECAUSE THIS IS
     * THE ONE MOMENT THE OPERATION NEEDS THE PLAYER TO LOOK.** `types.ts` says
     * the camera is for an arrival, a loss or a reveal and not for punctuation;
     * a player who has just started dismantling their own evidence, eighty-five
     * metres off the road they are fighting down, is a loss in progress. Nothing
     * else on this map can put a round into that building — the office is
     * 140.36 m from the nearest gantry and 65.37 m from the nearest point of the
     * reading disc, against an ACQUISITION envelope of 58.811 m for the
     * longest-reaching hull in the Reclamation — so this cannot fire on an
     * accident of positioning. **That sentence has now shipped false twice, for
     * two different reasons, and both are worth keeping.** At `lane(0.40, -58)`
     * the disc's nearest point was 19.89 m away, so the beat was the whole
     * warning between a Grinder's first round and an 800 hp building's death,
     * which five of them manage in 9.05 s. At `lane(0.40, -86)` the distance was
     * 48.72 m and this comment quoted an envelope of 39.611 m, which is
     * `grinderArc`'s — the best gun in the staged party rather than the best gun
     * the player's army has. Against `rclSlaghurler`'s 58.811 the 48.72 was
     * inside, not outside.
     */
    {
      id: 't.mark',
      when: { on: 'entityHpBelow', tag: 'office', frac: 1 },
      then: [
        { do: 'cameraMove', at: OFFICE },
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'Stop. That is the receiving office and somebody is putting rounds into it. '
            + 'Every counterfoil that says we ever delivered anything to this yard is in that '
            + 'building. Burn it and we have taken plant we can no longer prove we were owed, '
            + 'which is the word they have been using about us for eleven months.',
        },
      ],
    },

    /* -- the reading -------------------------------------------------------
     * `not(FIRST_GONE)` is what makes the title true: the notice has to be
     * served BEFORE the levy, so a reading that completes on the same tick a
     * gantry comes off their books is not a reading, it is an alibi. Both
     * triggers below evaluate against the SAME world state — the sink applies
     * afterwards — so the negation here and `t.unserved`'s
     * `objectiveComplete` test are what make the two deterministic rather than
     * order-dependent.
     *
     * `elapsedSinceArmed` is the hold and the Director evaluates this trigger
     * twice for it: pass one forces it true to decide whether the clerk is
     * standing there at all, which sets or clears the arm tick; pass two
     * compares against that tick. A clerk who steps off the apron at second
     * thirty-nine starts again at zero, which is what Cregg says on `t.terms`
     * — unconditionally, at thirty-two seconds, because the rush floor is 53.1 s
     * and a beat on an arrival trigger is a beat some endings never reach.
     */
    {
      id: 't.served',
      when: {
        on: 'all',
        of: [
          { on: 'unitsInArea', player: 0, area: SCALE_AREA, min: 1, tag: 'clerk' },
          { on: 'not', of: FIRST_GONE },
          { on: 'elapsedSinceArmed', ticks: READING },
        ],
      },
      then: [
        { do: 'completeObjective', id: 'served' },
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'Entry read out, their duty man wrote the time down, and there is a Works hand '
            + 'on a Reclamation notice for the first time in eleven months. Whatever we lift off '
            + 'that siding now, we lifted it against a served account. Go and get it.',
        },
      ],
    },
    {
      id: 't.unserved',
      when: {
        on: 'all',
        of: [FIRST_GONE, { on: 'not', of: { on: 'objectiveComplete', id: 'served' } }],
      },
      then: [
        { do: 'failObjective', id: 'served' },
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'That is a gantry off their books with nothing served against it. It is a levy '
            + 'in our account and a theft in theirs, and the only thing that decides which is '
            + 'the paper — which this morning is all ours and none of it any use.',
        },
      ],
    },
    /*
     * `not(LEVY_DONE)` IS TRAP 26, FOUND BY DRIVING THE REAL `runDirector`
     * RATHER THAN BY READING.
     *
     * Without it, an ending in which all three gantries come off the Works'
     * books on ONE tick fires three beats at once — this one, `t.whole` and
     * `t.win` — with Tallow answering herself across the first and the third.
     * Driven through the real Director at 30 Hz, that is exactly what came out.
     * It is also semantically right: "one line discharged" is a beat about
     * PROGRESS, and there is no progress left to report on the tick the account
     * closes.
     */
    {
      id: 't.oneOff',
      when: {
        on: 'all',
        of: [FIRST_GONE, { on: 'objectiveComplete', id: 'served' }, { on: 'not', of: LEVY_DONE }],
      },
      then: [
        {
          do: 'dialogue',
          speaker: 'Tallow',
          text: 'One line discharged. Enter it against the account this evening and copy the '
            + 'entry to their receiving office, because the whole value of doing this properly '
            + 'is that they can check it.',
        },
      ],
    },

    /* -- what the levy is worth ---------------------------------------------
     * **READ AT THE DISCHARGE, NEVER LATCHED AT THE CAPTURE, AND THE LATCHED
     * VERSION SHIPPED A SILVER MEDAL FOR HOLDING NOTHING.**
     *
     * This was a bare `ownerCount(0, 'building', 'levy', min: 2)`, which fires
     * the moment the second gantry changes hands — and
     * `CampaignSession.setObjective` returns early on `was === 'complete'`, so
     * nothing can un-resolve it afterwards. Driven through the real
     * `runDirector` at 30 Hz: capture Number One and Number Two at t = 200 s,
     * let the Works level both at t = 500 s, break Number Three at t = 600 s.
     * `t.notWhole`'s `failObjective` was SWALLOWED and the run ended
     * `whole = complete`, `ownerCount(0, 'building', 'levy') = 0`, medal 2.
     *
     * It is reached by this file's own content rather than by bad luck:
     * `t.second` attack-moves the `column` at `GANTRY_TWO` and `t.third` at
     * `GANTRY_ONE`, which are the two machines a capturing player is standing
     * on. A captured gantry arrives at AT MOST `0.50 x 700` = 350 hp — trap 22,
     * `Capture.resolve` writes `st.hp` on its friendly branch only — and three
     * `rhino` deliver `3 x (78 x ARMOR_MATRIX[ArmorPiercing][Concrete] 0.55 x
     * COMBAT_DAMAGE.globalMul 0.80 / 2.00)` = 51.48 dps, i.e. 350 hp in 6.80 s.
     *
     * The title says *"Put two of the three gantries on our books standing"* and
     * Tallow's terms say *"the only difference is what we are left holding at
     * the end of it"*. Both describe an END STATE, so the rule is now the end
     * state: `DISCHARGED` and two on our books on the same tick.
     *
     * `min: 2` still needs no settle guard — a `min` threshold reads FALSE
     * against an empty registry, which withholds the secondary rather than
     * granting it — and `DISCHARGED` carries one anyway.
     *
     * **BOTH ARMS CARRY `DISCHARGED` RATHER THAN `LEVY_DONE` SO NEITHER LANDS ON
     * A DEFEAT.** With `LEVY_DONE` alone, a tick that takes the last gantry and
     * the office together fires Cregg's *"Two of them upright and on our books"*
     * one beat before Tallow reports the counterfoils burned. On that tick
     * `whole` simply does not resolve, which costs nothing: `medalFor` returns 0
     * for any outcome that is not a win.
     */
    {
      id: 't.whole',
      when: {
        on: 'all',
        of: [DISCHARGED, { on: 'ownerCount', player: 0, role: 'building', tag: 'levy', min: 2 }],
      },
      then: [
        { do: 'completeObjective', id: 'whole' },
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'Two of them upright and on our books. That discharges the entry at standing '
            + 'value instead of scrap, which is the difference between being paid and being '
            + 'compensated, and eleven months is long enough to care which.',
        },
      ],
    },
    {
      id: 't.notWhole',
      when: {
        on: 'all',
        of: [DISCHARGED, { on: 'ownerCount', player: 0, role: 'building', tag: 'levy', max: 1 }],
      },
      then: [{ do: 'failObjective', id: 'whole' }],
    },

    /* -- the counterfoils ---------------------------------------------------
     * THE PAPERWORK BEATS THE GROUND, AND IT IS THE OPPOSITE CALL TO
     * `reclamation.05.closing-entry`'s — that operation puts its win above its
     * asset loss so the ground beats the paperwork on the closing tick. Here the
     * premise is that a levy you cannot prove you were entitled to is not a
     * levy: a player who takes the last gantry on the same tick the office comes
     * down has taken three machines and destroyed the only evidence they were
     * owed them, and the operation is entitled to call that what it is.
     *
     * **BEING ABOVE `t.win` IS NOT WHAT ACHIEVES THAT AND THIS COMMENT USED TO
     * SAY IT WAS.** Trigger order decides which beats reach the toast stack
     * FIRST; it does not stop `t.win` from evaluating on the same tick, because
     * `runDirector` collects every matching trigger's effects before
     * `CampaignSession.apply` runs any of them. The `entityAlive` clause inside
     * `DISCHARGED` is what makes the two exclusive. This trigger stays first so
     * that the defeat is the beat the player reads first.
     *
     * `entityDead` rather than `ownerCount`, and correct here for the reason it
     * is usually wrong: a CAPTURED office is still alive and still standing,
     * which is exactly what this objective asks for. `captureProof` is what
     * keeps the player from reaching the state where it is standing on their
     * books inside the Works' own fire. See the header.
     */
    {
      id: 't.notesLost',
      when: { on: 'all', of: [SETTLE, { on: 'entityDead', tag: 'office' }] },
      then: [
        { do: 'failObjective', id: 'notes' },
        { do: 'failObjective', id: 'levy' },
        {
          do: 'dialogue',
          speaker: 'Tallow',
          text: 'The receiving office is down and their counterfoils went with it. Every note we '
            + 'hold is back to being a thing one party can produce, and the Works will spend the '
            + 'rest of the year explaining that we came for their plant with hulls and an '
            + 'account nobody can check. They will be believed. We wrote the objection ourselves '
            + 'in the spring.',
        },
        { do: 'endOperation', result: 'loss', reason: 'notes' },
      ],
    },

    /* -- the discharge ------------------------------------------------------
     * Both primaries on one tick: the Works owns none of the three AND the
     * office is still there.
     *
     * **THE SECOND HALF IS IN THE CONDITION, NOT IN THE TRIGGER ORDER.** This
     * read a bare `LEVY_DONE` under a comment claiming `t.notesLost` sitting
     * above it "would have taken any tick on which it was not", and that is
     * measurably untrue on the tick where both are true at once — see
     * `DISCHARGED`, and the four-beat ending the real Director produced.
     */
    {
      id: 't.win',
      when: DISCHARGED,
      then: [
        { do: 'completeObjective', id: 'levy' },
        { do: 'completeObjective', id: 'notes' },
        {
          do: 'dialogue',
          speaker: 'Tallow',
          text: 'Three lines off the entry and their office still standing behind it. Copy the '
            + 'discharge and the weighbridge sheet to every establishment on the continent, '
            + 'including the ones that will read it back to us one day. We are poorer than we '
            + 'were this morning and a great deal harder to argue with, and since the duplicate '
            + 'that is the only trade this company has left.',
        },
        { do: 'endOperation', result: 'win' },
      ],
    },

    /* -- the whistle ---------------------------------------------------------
     * **THE ENDING IS STILL TOTAL, AND THE PARTITION IS NOW THREE-WAY RATHER
     * THAN TWO.** `t.win` is `LEVY_DONE and office alive`, and at `parSec` every
     * remaining state is covered: office dead is `t.notesLost` (which fires the
     * tick it becomes true, long before this); office alive with `LEVY_DONE` is
     * `t.win`; and `not(LEVY_DONE)` is this. `t.rout` sits under all three as
     * the floor. No world state at `CLOSE` escapes an `endOperation`.
     *
     * `notes` is COMPLETED rather than failed or left hanging, and it is true:
     * `t.notesLost` sits above this and would have taken any tick on which the
     * office was not standing. A player who lost the levy on the clock did in
     * fact leave their records alone, and an end screen that said otherwise
     * would be the file lying about its own condition.
     */
    {
      id: 't.close',
      when: { on: 'all', of: [{ on: 'elapsed', ticks: CLOSE }, { on: 'not', of: LEVY_DONE }] },
      then: [
        { do: 'completeObjective', id: 'notes' },
        { do: 'failObjective', id: 'levy' },
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'Whistle. The gantries are Works plant, the entry stands unpaid, and the next '
            + 'time we send it they will have a shift log saying we came for it and could not '
            + 'take it. That is a worse account than the one we started the morning with.',
        },
        { do: 'endOperation', result: 'loss', reason: 'levy' },
      ],
    },

    /* -- the party is gone ---------------------------------------------------
     * `playerBeaten` is `Viability.isBeaten` — nothing to build with and nothing
     * to fight with — and on a `'force'` opening with no structures at all that
     * is simply the last hull. It is the honest floor rather than a count of
     * buildings, which on this seat is zero from the first tick.
     */
    {
      id: 't.rout',
      when: { on: 'playerBeaten', player: 0 },
      then: [
        { do: 'completeObjective', id: 'notes' },
        { do: 'failObjective', id: 'levy' },
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'Nothing answering on the siding. Skell will write it up as an attempted seizure '
            + 'repelled, the account goes down as disputed, and disputed is the one thing it was '
            + 'not when we set out this morning.',
        },
        { do: 'endOperation', result: 'loss', reason: 'levy' },
      ],
    },
  ],
};

export default op;
