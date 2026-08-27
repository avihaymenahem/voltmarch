/**
 * ============================================================================
 * VOLTMARCH — src/campaign/layouts/allies-standing-order.ts
 * ============================================================================
 * A8 — THE GROUND. One Works relay block that belongs to nobody, standing in
 * open country almost exactly half way between two bases; one Reclamation oil
 * derrick with two coil posts on it; and, on both sides, an ordinary base.
 *
 * **THIS IS THE FIRST OPERATION IN THE CHAPTER WHOSE GROUND IS NOT THE
 * SUBJECT.** A1 through A7 each own a piece of geometry — a seam, a room, a
 * beach, a lane, a hall, a tramway, two heads on a trunk. This one owns a BANK
 * BALANCE, and the ground exists to price it: a counter far enough out that
 * standing on it costs something, a derrick worth taking, and a road their
 * columns come down. Everything below is measured, and the numbers that matter
 * most are the two in the ECONOMY block rather than any distance.
 *
 * ============================================================================
 * MEASURED, ON THE WORLD THIS FILE ACTUALLY BUILDS
 * ============================================================================
 * Every figure is read off `store.posX/posZ` after `spawnBuilding` snapped each
 * footprint to the placement grid, on a headless build at `mapSeed` 20 260 998
 * / `simSeed` 7 070, `preset` and `biome` both `snow`, with the def tables
 * BOUND and this operation's roster INSTALLED through `setCampaignRoster` —
 * the only state in which either is true. The control at the end of this
 * header counts what the roster withholds.
 *
 *     thing        key             owner    landed        hp    footprint
 *     block head   civApartments   GAIA     (296, 210)    800     2x3
 *     retainer     civOilDerrick   RECLAM   (196, 236)    900     2x2
 *     two posts    pillbox->rclSpitpost     (210, 226) (182, 246)
 *                                           520 each, `postCoil` at 20 m,
 *                                           **17.20 m from the derrick, both**
 *
 * **ALL FOUR LAND ON THEIR AUTHORED LITERALS AT RING ZERO.** They are written
 * here as the coordinates the BUILT WORLD reports rather than as nominal points
 * a ring search then walks off — `allies-fair-copy` records why, and it is the
 * same trap: **`place` returning a point is not
 * the same as a structure standing on it**, because `spawnBuilding` snaps the
 * result to the footprint grid a second time.
 *
 * THE GRID PHASE IS A CONSTRAINT, NOT A PREFERENCE, and it is the reason the
 * three literals look arbitrary. A footprint of EVEN extent centres on a cell
 * BOUNDARY (4k) and one of ODD extent on a cell CENTRE (4k + 2):
 *
 *     civApartments  2 x 3   x = 296 = 74*4      boundary
 *                            z = 210 = 52*4 + 2  centre
 *     civOilDerrick  2 x 2   x = 196 = 49*4, z = 236 = 59*4, both boundaries
 *     pillbox        1 x 1   both centres, so a post offset from the derrick
 *                            must satisfy `dx = 2 (mod 4)` AND `dz = 2 (mod 4)`
 *
 * `POSTS` below is `(+14, -10)` and its exact negation, and both components
 * satisfy that. `allies-fair-copy` records an earlier draft where they did not
 * and `spawnBuilding` moved a post two metres from where the arithmetic said it
 * was; the whole stand table under it was then a table about somewhere else.
 *
 * The two openings, and both are real bases:
 *
 *     start spots   (404, 380) facing -129.9575   and   (108, 132) facing 50.0425
 *     player        `buildBaseFor`, seat 0 — 23 buildings, 6 infantry, 6 vehicles
 *     Reclamation   `buildBaseFor`, seat 1 — 26 buildings, 6 infantry, 6 vehicles
 *
 * **`seatedSlots(2, 7070, null)` DRAWS THE ANTIPODAL PAIR**, 386.16 m apart —
 * the long diagonal, and the OTHER one from `allies-fair-copy`'s. That is the
 * pair this operation wants for a reason it can state in one line: the block
 * head is the only thing on the map worth standing on, and it has to be far
 * from BOTH bases or the decision about when to walk to it is not a decision.
 * Measured straight-line, it is **201.41 m from the player and 203.54 m from
 * the Reclamation** — 2.13 m of asymmetry on a 400 m diagonal, which is as
 * close to neutral ground as a rectangle of four authored slots can produce.
 *
 * ============================================================================
 * THE BLOCK HEAD IS GAIA, AND WHAT THAT BUYS IS A DECISION ABOUT *WHEN*
 * ============================================================================
 * `allies-fair-copy` established both halves of this mechanic on the same def
 * one operation ago, so neither is a discovery here:
 *
 *   - **`Capture.resolve` forks on `ownerFactionOf(t) === Faction.Neutral` and
 *     the neutral branch has no health gate at all** — one engineer, at any
 *     health, consumed (`Capture.ts#consume` writes `UnitState.Selling` and
 *     `markDead`). The deed is then PERMANENT.
 *   - **A rifleman takes it too, and gives it back.** `civApartments` clears
 *     every gate in `GarrisonService.refusalFor` — unarmed (`weaponIndex` -1,
 *     no `CanAttack`), none of `IsBuilder | IsFactory | IsRefinery | IsRadar`,
 *     and 2x3 against `GARRISON.minFootprint` 2 on both axes — and
 *     `GarrisonService.enter` calls `captureBuilding()` directly. `enter` also
 *     parks the body at the structure's centre (`st.posX[i] = st.posX[t]`), and
 *     `releaseEmptied` hands the block back to Gaia the moment the last man
 *     walks out.
 *
 * **WHAT IS NEW HERE IS THAT THE OPERATION READS OWNERSHIP AT ONE INSTANT, SO
 * THE TWO VERBS ARE NO LONGER INTERCHANGEABLE.** A7 asked for a LATCH — lodge
 * a slip and it is on the wire whatever happens next — and both verbs latch it.
 * A8 asks `ownerCount(player 0, role 'building', tag 'head', min: 1)` AT THE
 * SEND, and the two verbs then price differently against one shipped rule:
 *
 * **`Targeting.isValidTarget` REFUSES ONLY ALLIES, AND GAIA IS ALLIED TO
 * EVERYBODY** (`ScenarioBuilder.gaia` sets `allyMask` in both directions). So
 * while the block is Gaia's, no Reclamation gun can ACQUIRE it, and the only
 * thing that reaches it is splash. The moment an engineer takes it, it is an
 * Allied building standing alone in open country and every hull on the map may
 * shoot at it. Derived through the shipped tables, against 800 hp:
 *
 *     while GAIA, splash only, halved by `COMBAT_DAMAGE.friendlyFireMul` 0.5
 *       `slagCharge`  74 HE, splash 2.6   8.88 .. 29.60 per shell   27 .. 90 shells
 *       `lightCannon` 55 AP, splash 1.6   3.63 .. 12.10 per shell   66 .. 220 shells
 *     once ALLIED, acquired and shot outright
 *       `grinderArc`  70 Tesla vs Concrete 0.60 x 0.80 = 33.60 a pull / 1.9 s
 *                     = 17.68 dps, so FIVE Grinders level it in 9.05 s
 *
 * `hitRadius(2, 3)` is `sqrt(4^2 + 6^2)` = 7.211 m, so the splash catchment is
 * 9.811 m for a Slagger's satchel and 8.811 m for the player's own tank gun —
 * which is to say a shell aimed at a man standing at the door lands on the
 * door, exactly as `allies-fair-copy` measured for its two heads. Nothing mends
 * it: `sim/Regen.ts` is mobile units only and `RepairSell` needs an owner with a
 * bank, which Gaia has not got.
 *
 * **SO TAKING THE COUNTER EARLY IS A COMMITMENT AND NOT A FREE ACT**, and that
 * is the decision this ground exists to pose. One engineer at minute three buys
 * the clause for the rest of the match and hands the Reclamation a 9.05-second
 * target to aim seventeen minutes of columns at. Waiting until nineteen buys
 * nothing until it is bought, and buys it while a troop is standing on the
 * ground you have to reach. Neither is wrong and both are priced.
 *
 * **AND FOR ONE DRAFT THE SECOND HALF OF THAT SENTENCE WAS A LIE.** It read
 * *"the operation says so out loud at forty-eight seconds"*. There is no beat at
 * forty-eight seconds — the brief is at 4, 9, 22, 36 and 50 — and not one of the
 * five mentioned that owning the block head makes it shootable. Two of them said
 * the opposite. Read the whole thing rather than trusting a cross-reference: a
 * sentence in THIS file asserting what a beat in ANOTHER file says is exactly
 * the claim no gate can check, and the trap it was covering for is the cheapest
 * opening in the operation. `t.cregg` states the mechanism at **thirty-six
 * seconds** now, and `t.wave5` no longer calls the counter safe on the tick it
 * sends twelve hulls at it. The real number behind the warning is worse than the
 * 9.05 s above, which is five Grinders: **wave five is four Grinders and eight
 * Pickers together — 4 x 17.68 plus 8 x 11.89 = 165.82 dps against 800 hp, so
 * 4.82 s** — and `t.headLost` is an unconditional defeat.
 *
 * **THE AI CAN NOW CONTEST IT.** A disciplined `AiBrain` can buy one engineer
 * for a visible legal structure, issue `OrderKind.Capture`, and send an escort.
 * `OrderKind.Enter` remains the unrelated garrison/transport verb.
 *
 * ============================================================================
 * THE RETAINER IS AN INCOME, A DENIAL AND A PRICE, AND ALL THREE ARE MEASURED
 * ============================================================================
 * A `civOilDerrick` on SEAT 1 — 900 hp, `ArmorClass.Concrete`, 2x2 — which
 * `src/sim/civilian.system.ts` pays its holder `CIVILIAN_INCOME.credits` 15
 * every `intervalTicks` 30, i.e. **900 credits a minute**, for as long as the
 * deed stands in their name.
 *
 * **THAT IS THE LARGEST SINGLE ECONOMIC OBJECT ON THIS MAP AND IT IS NOT
 * CLOSE.** `src/data/Civilians.ts` prices the derrick against the MEASURED
 * harvester rather than the intended one: twelve harvesters over three seeds in
 * `tests/harvester-soak.spec.ts` returned **429-700 credits per harvester per
 * minute**, so the two haulers `buildBaseFor` ships are 858-1400 a minute. The
 * derrick is **64% to 105% of a whole opening economy**, held by whoever holds
 * the deed, and it is running for the Reclamation from tick one.
 *
 * Left alone for the full twenty minutes it pays them **18 000 credits**. So
 * the secondary is not a bonus: it is the largest swing either side can make,
 * and it is worth it in both directions at once — the Reclamation stop being
 * paid it and the player can start.
 *
 * ============================================================================
 * **THE CAPTURED DERRICK IS SHELLED BY ITS OWN GUARD POSTS, AND AN EARLIER
 * DRAFT OF THIS BLOCK SOLD THE CAPTURE AS 900 A MINUTE FULL STOP**
 * ============================================================================
 * `Targeting.isValidTarget` refuses ALLIES and nothing else, so the tick the
 * deed moves to seat 0 the derrick stops being seat 1's building and becomes
 * seat 1's target — and the two guns that gate the capture are standing on it.
 * Measured on the built world with the def tables bound: both posts are
 * **17.2047 m** from the derrick centre, `hitRadius(2, 2)` is
 * `sqrt(4^2 + 4^2)` = **5.657**, so the surface distance `Combat.engage` tests
 * is **11.5478 m against `postCoil`'s range of 20**. Both fire. `canTargetGround`
 * defaults TRUE and `armorMultiplier(Tesla, Concrete)` is 0.60, well clear of
 * `weaponCanHurt`'s 0.02 floor, so acquisition is not in doubt either.
 *
 * **AND IT ARRIVES WOUNDED, WHICH IS THE HALF THAT MAKES IT BITE.**
 * `Capture.resolve` writes `st.hp` on its FRIENDLY branch only — the enemy
 * branch softens and consumes, and the capturing engineer mends nothing. So the
 * soften ladder derived under THE PRICE below is also the health the rig has
 * when it changes hands: it lands on the player's books at **360 hp**, not 900:
 *
 *     34 x ARMOR_MATRIX[Tesla][Concrete] 0.60 x globalMul 0.80 = 16.32 a pull
 *     / 0.85 s = **19.20 dps a post**
 *
 *     posts standing   bare              with the wrench
 *     both             9.38 s to zero    LOSES: net -8.40 hp/s, gone in 42.86 s
 *                                        and 450 cr/min while it lasts
 *     one              18.75 s to zero   HOLDS: net +10.80 hp/s for 288 cr/min,
 *                                        i.e. 612 a minute net of a 900 income
 *     neither          —                 the clean 900
 *
 * The wrench is `REPAIR_RATE` 30 hp/s at `REPAIR_COST_PER_HP` 0.25, so holding
 * against one post costs `19.20 x 0.25` = 4.80 credits a second and against two
 * costs the full `30 x 0.25` = 7.50 and still loses. `RepairSell.tickRepairs`
 * also clears the flag at full health, so this is a toggle the player has to
 * keep re-arming rather than a standing order — the running cost is a click as
 * well as a bill.
 *
 * **SO THE INCOME COSTS BOTH POSTS AND THE OBJECTIVE COSTS NEITHER.**
 * `t.retainerTaken` reads `ownerCount(player 1, 'building', 'retainer', max: 0)`
 * and `completeObjective` latches, so the secondary is banked on the tick of the
 * deed and survives the rig being levelled afterwards — this is a false economic
 * claim in a header, not an unwinnable operation. The three real prices are:
 * destroy it (free in credits, see the standoff note below, and earns nothing);
 * take it with one post still up (2 000 of engineers, a standing 288 a minute
 * and a wrench the player has to keep re-arming, because `tickRepairs` clears
 * the flag at full health); take it clean (both posts, then 900 a minute).
 *
 * **DO NOT "FIX" THIS BY MOVING THE POSTS OUT.** A post would have to stand past
 * 25.66 m of centre distance to lose the derrick's 5.657 m surface at 20 m of
 * range, and at that distance it stops covering the far capture stands — which
 * is the wall the next block exists to build. The asymmetry is the design: one
 * post gates the walk in, the other taxes the holding, and the operation is
 * about what a player is willing to pay.
 *
 * **AND DESTROYING IT REALLY IS FREE, MEASURED RATHER THAN ASSERTED.**
 * `lightCannon` reaches 24 m and `postCoil` 20, and of the **162 Track-passable
 * cells from which a Warden's surface distance to the derrick is inside 24 m,
 * 34 are outside both posts' fire circles** (20 m plus the Warden's own 2.79 m
 * store radius). A force-attack from one of those thirty-four costs nothing at
 * all; a column left to auto-attack parks at `range * APPROACH_STOP_FRAC` and
 * takes whatever bearing it arrives on.
 *
 * **THE PRICE, IN THE TWO CURRENCIES THIS OPERATION IS ABOUT.** `civOilDerrick`
 * is seat 1's, so it takes `Capture.resolve`'s ENEMY branch: above
 * `CAPTURE.captureHpFrac` (0.5) an engineer is spent knocking
 * `maxHp * CAPTURE.softenFrac` (0.25) off through
 * `ARMOR_MATRIX[HighExplosive][Concrete]` (1.00) **and `COMBAT_DAMAGE.globalMul`
 * (0.80)** — a flat 180 of 900, 20% of max and not 25%. 900 -> 720 -> 540 ->
 * 360, and the FOURTH engineer captures. Quoting `softenFrac` without
 * `globalMul` understates that by one engineer and two headers in this repo
 * shipped that way.
 *
 *     capture   4 x `engineer` at 500        2 000 credits, and it can pay
 *                                            900/min — see the block above for
 *                                            what the two posts do to it first
 *     destroy   900 hp of Concrete           free in credits, and it pays nothing
 *               `lightCannon` 55 AP x `ARMOR_MATRIX[ArmorPiercing][Concrete]`
 *               0.55 x 0.80 = 16.13 dps a Warden, so four break it in 13.95 s
 *
 * Both satisfy the objective — it reads `ownerCount(player 1, ..., max: 0)`,
 * which is the capture-aware spelling and is deliberate. Only one of them earns
 * anything, and only when the posts are gone. **That is the operation's own
 * question asked about a single building**, which is why this is the secondary
 * rather than a third wave.
 *
 * ============================================================================
 * THE TWO POSTS, AND WHY THIS GATE IS A WALL WHERE A7's WAS A PRICE
 * ============================================================================
 * `CaptureService.withinReach` is
 * `max(0, |dx| - halfW)^2 + max(0, |dz| - halfH)^2 <= reach^2` — a ROUNDED
 * RECTANGLE, not four stands. `CAPTURE.reachMetres` is 2.2 and an engineer's
 * own `st.radius`, read back off the store on this build, is **0.234**, so the
 * reach is 2.434 m. Enumerated against the derrick's grid phase, that accepts
 * **twelve cells, of which four are inside the 2x2 footprint** and are refused
 * by `passGrid`. **Eight stands, all Foot-passable**, all at 6.325 m from the
 * centre.
 *
 * A Spitpost FIRES when `max(0, flat - hitRadius(target)) <= 20`, and an
 * engineer's `hitRadius` is his radius, so the fire circle is **20.234 m** of
 * centre distance; `Targeting` acquires at `20 * COMBAT_TARGETING.acquireRangeMul`
 * (1.08) + 0.234 = **21.834 m**.
 *
 *     stand        post A (210,226)   post B (182,246)   bears
 *     (202, 234)       11.31              23.32            A
 *     (202, 238)       14.42              21.54            A
 *     (198, 230)       12.65              22.63            A
 *     (198, 242)       20.00              16.49            A and B
 *     (194, 230)       16.49              20.00            A and B
 *     (194, 242)       22.63              12.65            B
 *     (190, 234)       21.54              14.42            B
 *     (190, 238)       23.32              11.31            B
 *
 * **EVERY STAND IS INSIDE SOME POST'S FIRE CIRCLE. NONE IS COLD.** The two at
 * 20.00 m clear the far post's fire circle by exactly 0.234 m, which is the
 * engineer's own radius — the tightest cell on the table and the reason the
 * radius is read off the store rather than assumed. And (202, 238) at 21.54 m
 * from B is inside B's ACQUIRE circle and outside its FIRE circle, so B slews
 * onto a man there and never pulls the trigger; that cell is covered by A at
 * 14.42 m, so it is not the defect `allies-fair-copy` had to move its posts
 * for. Every stand is covered by a gun that will actually shoot.
 *
 * **THE INSTRUMENT FOR "THE POSTS GATE THE DERRICK" IS AN EXPOSURE MEASUREMENT,
 * NOT A DISTANCE.** Minimum exposure — the metres of the cheapest route from
 * the player's opening that lie inside a firing circle, Dijkstra'd on EXPOSURE
 * rather than on length, 8-connected over the real `Terrain.passGrid` with
 * corner-cutting refused:
 *
 *     posts live          best stand   exposure   what it costs an engineer
 *     both                (four of 8)    9.66 m   2.84 s, 3-4 pulls, 130.6-174.1
 *     only A (210,226)    (190,*)        0.00 m   nothing
 *     only B (182,246)    (202,*)        0.00 m   nothing
 *
 * A pull is `34 x ARMOR_MATRIX[Tesla][Infantry] 1.60 x globalMul 0.80` =
 * **43.52** on a 0.85 s cycle, so 9.66 m of walking at an engineer's 3.4 m/s is
 * **more than a 90 hp engineer has**, twice over. **BREAK EITHER POST AND THREE
 * STANDS GO TO ZERO EXPOSURE** — which is true of the GROUND and is qualified by
 * the block after this one, because a capture order does not get to pick its
 * stand. A post is 520 hp of Concrete; four Wardens at
 * 16.13 dps each break one in **8.06 s** while the pair returns
 * `34 x ARMOR_MATRIX[Tesla][Medium] 0.85 x 0.80` = 23.12 a pull, 27.20 dps
 * each — 54.40 on one hull, which is a 340 hp Warden every 6.25 s. So the post
 * costs between one and two hulls.
 *
 * (The return fire is real and it is closer than it looks. `Targeting` closes an
 * attacker to `range * APPROACH_STOP_FRAC` 0.80 and parks it, so a Warden
 * auto-attacking a post comes to rest at `0.80 x 24 + hitRadius(1, 1) 2.828` =
 * **22.028 m** of centre distance, and a post fires on it out to
 * `20 + its store radius 2.79` = **22.790 m**. Inside, by 0.762 m. `lightCannon`
 * out-ranges `postCoil` by four metres and the approach rule spends all but
 * three quarters of one of them.)
 *
 * ============================================================================
 * **"EITHER" IS TRUE OF THE GROUND AND FALSE OF THE ROUTE A RIGHT-CLICK WALKS**
 * ============================================================================
 * The table above minimises EXPOSURE over a free choice of eight stands. The
 * engine gives neither the free choice nor the exposure metric, and both halves
 * of that matter:
 *
 *   - **`Capture.simTick` re-aims the order at the derrick CENTRE every tick**
 *     ("the structure cannot move so this is a pure convergence"), and
 *     `Steering` requests a field at that goal, which
 *     `FlowFieldCache.requestFieldClass` quantises through `bucket()` —
 *     `floor(c / FLOWFIELD_GOAL_BUCKET 4) * 4 + 2`. Cell (49, 59) becomes
 *     (50, 58), i.e. world **(202, 234)**: Foot-passable, so no snap, and it is
 *     a capture stand — **the one 11.31 m from post A.**
 *   - **Even ignoring the bucket, the near side is simply cheaper.** Route cost
 *     from the player's opening to each of the eight stands, same 8-connected
 *     Dijkstra: the three cheapest are (202, 238) at 277.12 m, (202, 234) at
 *     278.76 m and (198, 230) at 284.40 m, and **all three are covered by A
 *     alone**. The three B-only stands are ranked fourth, seventh and eighth.
 *
 * Exposure along the LENGTH-optimal route to each stand, integrated by sampling
 * the polyline rather than by counting whole cell steps (`*` marks a stand
 * inside that post's 20.234 m fire circle):
 *
 *     stand        A       B      both     A alone   B alone
 *     (202,238)  14.42*  21.54    15.12 m   15.12 m    0.00 m
 *     (202,234)  11.31*  23.32    19.53     19.53      0.00     <- the bucket
 *     (198,242)  20.00*  16.49*    9.37      9.37      3.84
 *     (194,242)  22.63   12.65*   11.12      0.00     11.12
 *     (198,230)  12.65*  22.63    25.18     25.18      0.00
 *     (194,230)  16.49*  20.00*   29.18     29.18      0.38
 *     (190,238)  23.32   11.31*   19.53      0.00     19.53
 *     (190,234)  21.54   14.42*   23.53      0.00     23.53
 *
 * **SO A RIGHT-CLICK ON THE DERRICK COSTS 19.53 m WHETHER OR NOT POST B IS
 * STANDING** — 5.74 s at 3.4 m/s, six or seven pulls of 43.52 against 90 hp, so
 * the engineer dies about five and a half metres in. Post B's death changes that
 * route by **0.00 m**. Post A's death takes it to zero. The "three stands at
 * zero exposure" claim survives for BOTH posts, but only for a player who MOVE-
 * orders onto a stand on the dead post's side first and captures from there; a
 * capture order alone always converges on A's cell.
 *
 * **THE EXCLUSION CONTROL, WHICH IS THE LOAD-BEARING HALF** (CLAUDE.md's rule:
 * a distance is not evidence that a gun covers a corridor — re-run the fill with
 * the fire discs impassable and publish the delta). With both discs closed
 * **0 of the 8 stands are reachable at all** and the bucketed goal is
 * unreachable, which is the wall stated as a fact about the grid rather than as
 * a table of radii. With only A's disc closed the three far-side stands open
 * ((190,234), (190,238), (194,242)); with only B's, the three near-side ones
 * ((198,230), (202,234), (202,238)). Perfectly symmetric as GROUND, and the two
 * posts still do different jobs, because the route is not symmetric and neither
 * is what happens after the deed: **A gates the walk in, B taxes the holding**
 * (both reach the captured rig at 11.5478 m of surface — see the block above).
 *
 * **THAT IS DELIBERATELY A WALL WHERE `allies-fair-copy`'s WAS A PRICE, AND THE
 * DIFFERENCE IS WHAT THE OBJECTIVE IS.** A7 tuned its posts down to 4.00 m of
 * exposure — one burst or two — precisely because lodging a head was its
 * PRIMARY and its rescue handed a dead-end commander two engineers and no
 * armour: a wall there makes the rescue worth nothing. Here the derrick is a
 * SECONDARY, the player opens with a war factory and four Wardens, and an
 * objective that can be walked into by one unescorted man is not a decision
 * about money. Do not "fix" this by moving the posts out; it would make the
 * richest object on the map free.
 *
 * **AND THE POSTS DO NOT GO DARK.** `rclSpitpost` is `power: 0` and its own
 * blurb reads *"Fires through a blackout"*, so the three-Solar-Array route
 * `allies-fair-copy` costed against the Meridian's `needsPower` Glaive Posts
 * has no counterpart here. There is no way to open the derrick except to break
 * something.
 *
 * ============================================================================
 * WHAT THE GUNS AND THE COLUMNS ACTUALLY DO, DERIVED
 * ============================================================================
 * Off the shipped tables (`WEAPONS` in `src/data/Defs.ts`, `DEFAULT_WEAPONS` in
 * `src/sim/Combat.ts`, `ARMOR_MATRIX`, `COMBAT_DAMAGE.globalMul` 0.80).
 * **Re-derive rather than re-quote after any retune.**
 *
 *     rifle        3 x 18 over 1.03 s = 52.43 raw   41.94 dps on infantry
 *     lightCannon  55 AP / 1.5 s      = 36.67 raw   16.13 dps on Concrete
 *     pillboxMg    5 x 13 over 0.79 s = 82.28 raw   65.82 dps on infantry
 *     arcProd      26 Tesla / 1.05 s                31.70 dps on infantry
 *     grinderArc   70 Tesla / 1.9 s                 47.16 on infantry, 25.05 on
 *                                                   Medium, 17.68 on Concrete
 *     slagCharge   74 HE / 2.7 s, splash 2.6        21.93 dps on Concrete
 *     postCoil     34 Tesla / 0.85 s                51.20 on infantry, 27.20 on
 *                                                   Medium, **19.20 on Concrete**
 *
 * That last cell is not decoration: it is what a Spitpost does to the derrick it
 * is guarding once the derrick is the player's, and it is the number the capture
 * block above is built on.
 *
 * A Grinder's pull lands **89.60 on a G.I.**, which is 120 hp — so the Allied
 * line survives exactly one and dies to the second. That is the shape of every
 * timed troop in the trigger table: cheap bodies that do not trade with a
 * rifleman, behind a hull that does.
 *
 * ============================================================================
 * THE ROUTES, ON A NAMED INSTRUMENT
 * ============================================================================
 * 8-connected Dijkstra over `FlowFieldCache.costGridFor(MoveClass.X)` — the
 * ROUTING grid, which is terrain passability PLUS occupancy PLUS the
 * per-class clearance rule — octile step (4 m orthogonal, 5.657 m diagonal),
 * corner-cutting refused, run on the built world with the roster in force and
 * every structure standing. A cell depth is not a distance and none of these
 * is one.
 *
 * **THE GRID NAME MATTERS AND THIS PARAGRAPH USED TO NAME THE WRONG ONE.** It
 * said `Terrain.passGrid`, and the sanity figure below is the `costGridFor`
 * count: 3881 of 16 384 cells is 23.69%, while the raw `passGrid` Foot bit
 * refuses 3749, which is 22.9%. The rows are on the cost grid too — Foot
 * player-to-derrick reproduces at 272.33 there and comes back 267.65 on the
 * raw bit. Two grids, 132 cells apart on this map, and enough to move an
 * answer:
 *
 *     Foot    player  -> block head     226.1 m    70.7 s at a G.I.'s 3.2 m/s
 *     Foot    Reclam  -> block head     242.1 m
 *     Foot    player  -> the derrick    272.3 m    80.1 s at an engineer's 3.4
 *     Foot    Reclam  -> the derrick    158.8 m
 *     Foot    map centre -> block head   72.6 m
 *     Track   player  -> block head     226.1 m    34.3 s at a Warden's 6.6 m/s
 *     Track   Reclam  -> player         424.1 m    73.1 s at a Grinder's 5.8
 *     Track   ROAD    -> block head     160.6 m    27.7 s
 *     Track   ROAD    -> map centre     122.5 m    21.1 s
 *     Track   ROAD    -> the ore field  314.0 m    54.1 s
 *     Track   Reclam  -> ROAD            99.9 m
 *
 * Against the straight lines that is a ground cost of **7.6% to 18.9%**, and
 * every one of them resolved — no route came back unreachable. **3881 of the
 * map's 16 384 cells (23.7%) refuse Foot**, which is the sanity check that says the grid
 * this file measured with can see walls at all. A route measured on a grid that refuses
 * nothing is a plausible, uniformly slightly-too-short number and a green test;
 * `COST_BLOCKED` lives in `src/world/terrain-gen.ts` and importing it from
 * `src/core/config.ts` is how that happens.
 *
 * ============================================================================
 * `ROAD` IS A RING, NOT A POINT
 * ============================================================================
 * `EffectSink.spawnUnits` puts unit `i` of `count` at `angle = i / count * 2pi`
 * and radius `spread`, and `ProductionService.spawnUnit` writes that position
 * VERBATIM — no `connectedGround`, no egress search of any kind, unlike
 * `ScenarioBuilder.spawnUnit`, which this file uses and which does search. So
 * what this file owes the trigger table is GROUND rather than a point:
 *
 *     ROAD (176, 176)   99.9 m of Track route off the Reclamation opening.
 *                       **441 of 441 two-metre samples within 24 m are passable
 *                       to Foot AND to Track**, and every point of all thirteen
 *                       authored rings is clear for Foot, Track and Hover
 *                       alike — checked at the exact counts and spreads the
 *                       trigger table uses, not at a sample of a ring.
 *
 * `tests/campaign-spawn-ground.spec.ts` is the gate and it checks every point
 * of every wave against that wave's own locomotor.
 *
 * ============================================================================
 * ECONOMY: `addStartOre` AND NOTHING ELSE, AND THE CONTESTED PATCH IS THE POINT
 * ============================================================================
 * `addStartOre` lays one home field per opening on a bearing taken from
 * `StartSpot.facingDeg` (18 m along the facing, 44 m across it) and ONE
 * contested patch on the centroid. Through the shipped formula with the
 * measured facings:
 *
 *     player home field     (418.46, 334.71)  r 30   47.54 m behind the opening
 *     Reclamation home      ( 93.54, 177.29)  r 30
 *     contested patch       (256.00, 256.00)  r 22   **60.96 m from the head**
 *
 * **THAT LAST NUMBER IS WHY NOTHING ELSE IS PLACED.** The one patch both armies
 * are equally far from and the one building this operation is about are
 * sixty-one metres apart, so expanding onto the middle and standing on the
 * counter are the same walk and the same fight. A second authored field would
 * have given the player somewhere safer to earn the very money the objective
 * reads, which is the operation arguing with itself.
 *
 * **NO `addCivilians`.** It hangs capturable `civOilDerrick`s off the
 * perpendicular bisector and walks a `civOreMine` out from the lane midpoint —
 * three or four more paying structures on a map whose secondary is *one* paying
 * structure and what it is worth. `soviets-carriage-forward` and
 * `reclamation-written-off` both refuse it for the same reason.
 *
 * ============================================================================
 * WHAT THE EMPTY ROSTER ACTUALLY WITHHOLDS, MEASURED
 * ============================================================================
 * Two builds, identical except for `setCampaignRoster`, both with the def
 * tables bound — the only state in which a refused structure is visible at all:
 *
 *     seat            with the roster           cleared (the control)
 *     player          23 bld, 6 inf, 6 veh      25 bld, 6 inf, 8 veh
 *     Reclamation     26 bld, 6 inf, 6 veh      28 bld, 6 inf, 8 veh
 *
 *     the player loses    `battleLab` (`struct.tech`), `prismTower`
 *                         (`struct.defence.specialist`) and two `ifv`
 *                         (`unit.raider`)
 *     the Reclamation     `rclCrucible` (`struct.tech`), `rclPylon`
 *                         (`struct.defence.specialist`) and two `rclSpitter`
 *                         (`unit.raider`)
 *
 * **IT BITES THE SAME WAY ON BOTH SIDES, AND THAT IS THE ARGUMENT.** This is a
 * twenty-minute fight decided by what a base can pay for, so the one thing it
 * must not be decided by is which side happens to reach tier three first. Both
 * armies keep their whole day-one tree — barracks, war factory, refinery, the
 * cheap emplacement — and neither gets a tech structure, a specialist tower or
 * a raider.
 *
 * **THE PYLON IS THE LOAD-BEARING HALF.** `rclPylon` reaches 28 m with
 * `chainCount` 3, and one pull is `94 x ARMOR_MATRIX[Tesla][Infantry] 1.60 x
 * 0.80` = 120.32 — which kills a 120 hp G.I. outright and kills the 90 hp
 * engineer the secondary is bought with. `Placement.withinBuildRadius` gives a
 * finished non-builder structure `PLACEMENT.adjacencyRadius` 20 m plus its own
 * radius, so the Reclamation brain could found one within about 26 m of the
 * derrick and shut all eight stands at once, on a decision no author can see.
 * Withheld, the longest structure weapon either army can put on that ground is
 * `postCoil` at 20 m, which is the two posts this file already placed, and the
 * stand table above stays true. **§1 of `tests/campaign-emplacement-reach.spec.ts`
 * is the gate**, not §2: it pins this operation's armed-enemy roster BY DEF KEY
 * AND COUNT in both directions, so a Pylon appearing on this ground fails there.
 * §2 would NOT catch it — its rule is one line infantryman per pull, and a Pylon
 * pull is 120.32 on the first link and 72.19 on the second, which kills exactly
 * one 120 hp G.I. and passes.
 *
 * The rest is symmetry with teeth: no `rclHornet` (`unit.air`) on a map where
 * the player's own `aaTurret` (`struct.defence.aa`) is withheld by the same
 * rule, and no `rclSlaghurler`, whose prerequisite is the withheld Crucible.
 *
 * PROFILE-INDEPENDENT, so the ground is the same on a finished account as on a
 * fresh one — which a deny-list could not promise. `setCampaignRoster` is
 * consulted AHEAD of both the PvP suppression flag and the installed gate.
 *
 * ============================================================================
 * NO TRIGONOMETRY, NO ROTATION, NO PROFILE, NO CLOCK
 * ============================================================================
 * Every authored point here is an integer literal and every search offset is an
 * integer. ECMA-262 pins `+ - * /` and `Math.sqrt` to bit precision and pins
 * `sin`/`cos`/`atan2` to nothing at all; a layout runs independently on both
 * machines of a lockstep match, so a table built by trig is a tick-zero desync
 * waiting for two engines to disagree in the last mantissa bit. `rotateStarts`
 * is not called either — an operation pins its seed, so the rotation is a moving
 * part with exactly one value, and `spots[0]` is the player by construction.
 * (The two ore-field coordinates quoted above ARE trigonometric; they are read
 * OUT of `addStartOre`, which is the generator's own code and runs identically
 * on both machines because both machines run it.)
 *
 * ============================================================================
 * TAGS
 * ============================================================================
 * `head`     — the Works relay block, GAIA-owned. Read by `ownerCount` on SEAT
 *              0 (the win's ground clause, which is why capture and garrison
 *              both satisfy it and why a block that has been handed back to
 *              Gaia does not) and by `entityDead` (`t.headLost`).
 * `retainer` — the Reclamation's oil derrick, SEAT 1. Read by `ownerCount` with
 *              `max: 0` only, so destroying it and taking it satisfy the
 *              secondary alike.
 * `wave1`..`wave6`, `watch` — produced by `spawnUnits` in the trigger table and
 *              never by this file. Declared anyway, so a reader asking where
 *              the pressure comes from finds the answer in the file that owns
 *              the ground; `validateCampaign` and `tests/campaign-maps.spec.ts`
 *              both know a spawned tag is not the layout's to place.
 *
 * The two Spitposts are deliberately UNTAGGED. No trigger reads them, and a tag
 * nothing reads is a claim `tests/campaign-maps.spec.ts` would have to prove for
 * no purpose. They are still pinned by name and count in
 * `tests/campaign-emplacement-reach.spec.ts` §1, which reads the built world
 * rather than the tag set.
 * ========================================================================== */

import { MAP_SIZE } from '../../core/config';
import { NONE } from '../../core/types';
import { addStartOre, buildBaseFor, startSpots, wrapDeg } from '../../game/Scenarios';
import type { EntityId, PlayerId } from '../../core/types';
import type { Area, Point } from '../types';
import { layout } from '../layout';

/* ==========================================================================
 * 1. THE PLACES THE TRIGGER TABLE ALSO READS
 *
 * World metres, absolute, on a 512 m map. A trigger table is STATIC DATA frozen
 * at module load, so an `Area` or an order point cannot be derived from a start
 * spot the generator has not chosen yet — the coordinates have to be literals
 * somewhere. This module owns them and `operations/allies/08-standing-order.ts`
 * imports them; the dependency runs operation -> layout and never back. A number
 * written in two files is a number that will disagree the first time either is
 * tuned, and the failure — a reveal framing empty ground, a troop ordered at a
 * building that is not there — is invisible to every gate.
 * ========================================================================== */

/** The map centre. `startPointsFor` reserves a shelf here first, on a continent. */
const CENTRE = MAP_SIZE * 0.5;

/**
 * The player's START SPOT at `mapSeed` 20 260 998 / `simSeed` 7 070.
 *
 * `seatedSlots(2, 7070, null)` draws the antipodal pair, 386.16 m apart. Every
 * distance in this header is quoted against this point.
 */
const HOME: Point = { x: 404, z: 380 };
/** The Reclamation's start spot at the same seeds. Their Foundry lands beside it. */
const FOE: Point = { x: 108, z: 132 };

/**
 * The block head — the Works relay counter the amendment has to be lodged and
 * PAID at. GAIA, `civApartments`, 800 hp, and the operation's ground clause.
 *
 * Lands on this literal at ring zero. 201.41 m from the player and 203.54 m
 * from the Reclamation in a straight line — 226.1 m and 242.1 m of real Foot
 * route — and **60.96 m from the contested ore patch `addStartOre` lays on the
 * centroid**, which is the whole reason it is here and not somewhere prettier.
 */
export const HEAD: Point = { x: 296, z: 210 };

/**
 * The Reclamation's retainer — the oil derrick the line's wages are paid out of.
 * SEAT 1, `civOilDerrick`, 900 hp, 900 credits a minute to whoever holds the
 * deed. 158.8 m of Foot route from their opening and 272.3 m from the player's,
 * with two Spitposts 17.20 m off it.
 */
export const RETAINER: Point = { x: 196, z: 236 };

/**
 * Where the Reclamation's timed troops form. 99.9 m of Track route off their own
 * opening, 122.5 m from the contested patch, 160.6 m from the block head and
 * 314.0 m from the player's ore field — so a troop sent at the player's economy
 * arrives a minute after one sent at the middle, which is what makes the
 * escalation read as a change of intent rather than a change of size.
 */
export const ROAD: Point = { x: 176, z: 176 };

/**
 * The contested patch, and the heading the early troops take. This is the
 * centroid of the two openings, which is exactly where `addStartOre` puts its
 * one shared field — so ordering a troop here is ordering it at the ore.
 */
export const MIDDLE: Point = { x: 256, z: 256 };

/**
 * The player's own home field, and the heading the middle troops take.
 *
 * `addStartOre` computes it from `StartSpot.facingDeg`; on this seed that is
 * (418.46, 334.71) with radius 30, i.e. 47.54 m behind the opening. The literal
 * below is that point rounded to the metre, because it is an ORDER POINT rather
 * than a placement — `orderTagged` hands it to the flow field, which snaps to
 * reachable ground, and half a metre either way names the same field.
 */
export const FIELD: Point = { x: 418, z: 335 };

/**
 * The briefing reveal over the block head.
 *
 * 26 m: enough to show the block and the ground a troop would have to be pushed
 * off, and short of the contested patch at 60.96 m, so the player is shown the
 * counter rather than the whole middle. `revealArea` is `Vision.exploreCircle`
 * and is PERMANENT; `soviets-demolition-order` records the same trap.
 */
export const HEAD_AREA: Area = { x: HEAD.x, z: HEAD.z, r: 26 };

/**
 * The retainer, revealed a beat later. 26 m covers the derrick and BOTH posts —
 * they stand 17.20 m off it — because the price of the secondary is the posts
 * and a reveal that hid them would be selling the player a walk.
 */
export const RETAINER_AREA: Area = { x: RETAINER.x, z: RETAINER.z, r: 26 };

/* ==========================================================================
 * 2. PLACEMENT
 * ========================================================================== */

/**
 * The two Spitposts, as plain world offsets from the derrick.
 *
 * **ONE INTEGER PAIR AND ITS EXACT NEGATION**, which is a property a reader can
 * check by eye. Both stand 17.20 m from the derrick, each bears on five of the
 * eight capture stands, three stands are under A alone and three under B alone,
 * and none is cold — the table in the header is the measurement.
 *
 * **THEY ARE SYMMETRIC IN GEOMETRY AND NOT IN JOB, AND THE HEADER SAYS WHY.**
 * A is `(+14, -10)`, the NORTH-EAST post, and it is the one whose fire circle
 * contains (202, 234) — the cell `Capture`'s re-aimed goal buckets to, and the
 * cell every length-optimal approach from the player's opening arrives at. B is
 * the south-west one. Both reach the derrick ITSELF at 11.5478 m of surface
 * against 20 m of range, so both shell it once it is the player's. Breaking A
 * opens the walk; breaking B keeps what the walk brought back.
 *
 * THE GRID PHASE IS A CONSTRAINT, NOT A PREFERENCE. A 1x1 footprint centres on a
 * cell CENTRE (4k + 2) and the derrick is on cell BOUNDARIES in both axes, so a
 * legal offset has `dx = 2 (mod 4)` and `dz = 2 (mod 4)`. 14 and 10 both do.
 * `allies-fair-copy` records what happens when one of them does not:
 * `spawnBuilding` moves the post two metres and the whole stand table becomes a
 * table about somewhere else.
 *
 * TWO RATHER THAN THREE. Two already cover every stand; a third would only
 * lengthen the shooting, and the arithmetic that makes this secondary a decision
 * is that eight seconds of four Wardens opens three stands — the three on the
 * dead post's side.
 */
type Offset = readonly [dx: number, dz: number];
const POSTS: readonly Offset[] = [[14, -10], [-14, 10]];

/** Rings searched outward for a legal footprint, in metres. Nearest first. */
const PLACE_RINGS: readonly number[] = [0, 6, 12, 18, 26, 34];
/** Eight exact bearings. Integers only, so every candidate is bit-identical. */
const PLACE_BEARINGS: readonly (readonly [number, number])[] = [
  [1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
];
/** Ring zero is the nominal spot itself; the bearings would test it eight times. */
const ORIGIN_ONLY: readonly (readonly [number, number])[] = [[0, 0]];

/**
 * Metres reserved around the block head so `scatter` leaves every approach clear.
 *
 * 20 m, which is 12.8 m past the furthest cell an engineer can be standing on
 * when `withinReach` accepts him. A boulder dropped on the one face a man could
 * use would delete the operation's ground clause silently, and `Scatter` knows
 * nothing about capture geometry.
 */
const HEAD_CLEAR = 20;
/** The same argument at the derrick, whose stands are all 6.325 m out. */
const RETAINER_CLEAR = 16;
const POST_CLEAR = 10;

/* ==========================================================================
 * 3. THE BUILD
 * ========================================================================== */

export default layout({
  id: 'allies-standing-order',
  tags: [
    'head', 'retainer',
    'wave1', 'wave2', 'wave3', 'wave4', 'wave5', 'wave6', 'watch',
  ],

  build(b, cx, cz, start, c) {
    /*
     * THE EXPORTED POINTS ARE ABSOLUTE AND THE START SPOTS ARE DERIVED FROM
     * (cx, cz), SO THE TWO HAVE TO AGREE. `buildScenario` passes `startShelf()`,
     * which `startPointsFor` puts at the map centre on every continent. If that
     * ever stops being true, this file is dressing ground the trigger table is
     * not naming — and it would be invisible, because every tag would still land
     * and every gate would still pass.
     */
    if (Math.abs(cx - CENTRE) > 1 || Math.abs(cz - CENTRE) > 1) {
      console.error(
        `[campaign] allies-standing-order built on (${String(cx)}, ${String(cz)}), not the map `
        + `centre (${String(CENTRE)}, ${String(CENTRE)}) — the counter, the derrick and every `
        + 'order point are authored in absolute coordinates and will not line up with the '
        + 'openings this build lays down.',
      );
    }

    const spots = startSpots(cx, cz, b.armies, b.sea, b.seed);
    const us: PlayerId = c.seat(0);
    const them: PlayerId = c.seat(1);
    const home = spots[0];
    const foe = spots[1] ?? spots[0];

    /*
     * AND THE OTHER HALF OF THE SAME GUARD. `HOME` and `FOE` are literals
     * because the trigger table needs world points as static data; `build` seats
     * both bases from the real `startSpots`. A generator change that slid an
     * opening would move both bases and leave the counter, the derrick and the
     * posts exactly where they are — and every route, every exposure figure and
     * the 2.13 m of asymmetry between the two approaches would be about a map
     * that no longer exists. Four metres is one cell.
     */
    if (Math.abs(home.x - HOME.x) > 4 || Math.abs(home.z - HOME.z) > 4
      || Math.abs(foe.x - FOE.x) > 4 || Math.abs(foe.z - FOE.z) > 4) {
      console.warn(
        `[allies-standing-order] openings moved: player (${String(home.x)}, ${String(home.z)}) `
        + `and foe (${String(foe.x)}, ${String(foe.z)}) against the authored (${String(HOME.x)}, `
        + `${String(HOME.z)}) and (${String(FOE.x)}, ${String(FOE.z)}). Every distance in this `
        + 'layout and every reveal in the operation is measured against the authored pair — '
        + 're-measure.',
      );
    }

    /* -- placement --------------------------------------------------------
     * Ground a footprint can legally stand on: `footprintBuildable` AND
     * `footprintClear`, searched in rings with a fixed traversal order so two
     * runs of one seed build the same world.
     *
     * `findClearFootprint` ALONE ANSWERS THE WRONG QUESTION — it tests occupancy
     * and connectivity and NOTHING about grade, which is how `soviets-first-tap`
     * came to ship seven structures on ground `isBuildable` refuses. It is kept
     * as the fallback and nothing on this ground reaches it: all four buildings
     * are accepted at ring zero.
     */
    const scratch = new Float32Array(2);
    const place = (owner: PlayerId, key: string, p: Point): Point => {
      const f = b.footprintOf(b.keyFor(owner, key));
      for (const r of PLACE_RINGS) {
        for (const [ox, oz] of r === 0 ? ORIGIN_ONLY : PLACE_BEARINGS) {
          const px = p.x + ox * r;
          const pz = p.z + oz * r;
          if (b.footprintBuildable(px, pz, f.w, f.h) && b.footprintClear(px, pz, f.w, f.h)) {
            return { x: px, z: pz };
          }
        }
      }
      if (b.findClearFootprint(p.x, p.z, f.w, f.h, scratch)) {
        return { x: scratch[0], z: scratch[1] };
      }
      return p;
    };

    const raise = (
      owner: PlayerId, key: string, where: Point, tag: string | null, yawDeg: number, clear: number,
    ): EntityId => {
      const id = b.spawnBuilding(key, owner, where.x, where.z, { yawDeg });
      if (tag !== null) c.tag(tag, id);
      if (id !== NONE) b.block(where.x, where.z, clear);
      return id;
    };

    /* -- both bases --------------------------------------------------------
     * BOTH SEATS GET ONE, which is the first thing that separates this operation
     * from the one before it. `allies.07.fair-copy` is `opening: 'force'` and
     * builds a base for seat 1 only; this is `opening: 'base'`, the player owns
     * a war factory, a barracks and two harvesters from tick one, and the whole
     * question is what they are willing to spend out of what those two haulers
     * lift.
     */
    buildBaseFor(b, them, foe.x, foe.z, { facingDeg: wrapDeg(foe.facingDeg + 180) });
    buildBaseFor(b, us, home.x, home.z, { facingDeg: wrapDeg(home.facingDeg + 180) });

    /* -- the counter -------------------------------------------------------
     * GAIA, and that is the mechanic rather than a flavour choice.
     * `ScenarioBuilder.gaia` allies the Neutral slot to everybody in BOTH
     * directions, so `Capture.ts` rule 1 applies — one engineer, at any health,
     * consumed — and `Targeting.isValidTarget`, which refuses only allies, can
     * never acquire it while it is Gaia's. On a Reclamation seat it would be
     * rule 2 at four engineers AND a legal target from tick one, and the
     * decision the operation is built on — take it early and make it a target,
     * or take it late and fight your way there — would collapse into one
     * answer.
     *
     * NO `unlockedBy` ON THE KEY, WHICH IS LOAD-BEARING UNDER AN EMPTY ROSTER.
     * `spawnBuilding` consults the progression gate, so a tagged key here would
     * return `NONE`, the tag would land on nothing, `ownerCount(min: 1)` would be
     * unreachable and the operation would be unwinnable in silence.
     * `civApartments` is untagged, and `tests/campaign-roster-ground.spec.ts`
     * builds this operation with the roster armed and the def tables bound,
     * which is the only state that can see the difference.
     *
     * `civApartments` FOR THE FOURTH TIME IN THIS CHAPTER, AND THAT IS THE
     * POINT RATHER THAN A SHORTAGE OF SILHOUETTES. `allies-instrument-room`
     * spent it on a survey office, `allies-misclosure` on the transmitter block
     * A4's provisional is filed from, and `allies-fair-copy` on the two relay
     * heads of this same trunk one operation ago. A relay block on this chain
     * IS this building; giving the last one a different roof to look at would
     * hide the one continuity the player has already been taught to read.
     */
    raise(b.gaia, 'civApartments', place(b.gaia, 'civApartments', HEAD), 'head', 0, HEAD_CLEAR);

    /*
     * The retainer. `civOilDerrick` on SEAT 1 rather than on Gaia, and the two
     * differences are the whole secondary: it pays THEM 900 credits a minute
     * from tick one, and taking it costs four engineers rather than one because
     * `Capture.resolve` sends an enemy-owned structure down the soften branch.
     *
     * NOT run through `keyFor`: `civOilDerrick` is a `Faction.Neutral` row and
     * `FACTION_KEY_MAP` has no entry for it, so the key means itself on every
     * seat. `tests/campaign-emplacement-reach.spec.ts` §1 pins what the two
     * `pillbox` keys below actually resolved to.
     */
    raise(them, 'civOilDerrick', place(them, 'civOilDerrick', RETAINER), 'retainer', 200,
      RETAINER_CLEAR);

    /*
     * The two posts on the derrick. EMPLACEMENTS RATHER THAN PARKED HULLS, and
     * that is structural: `AiBrain.census` files every untagged, non-harvester
     * hull an AI seat owns into `armyIds` and `regroupSquads` drives it to the
     * rally point on the next brain pass — measured on `soviets.02.common-standard`
     * at 116.6 m and 129.2 m off the post inside twenty seconds. A Spitpost
     * cannot be re-tasked, campaign doctrine suppresses generic recovery sales,
     * and `rclSpitpost` draws no power, so only the player can take one off the
     * derrick.
     */
    for (const [dx, dz] of POSTS) {
      const g = { x: RETAINER.x + dx, z: RETAINER.z + dz };
      raise(them, 'pillbox', place(them, 'pillbox', g), null, 0, POST_CLEAR);
    }

    /* -- economy and dressing ---------------------------------------------
     * `addStartOre` AND NOTHING ELSE. See the header: its contested patch lands
     * on the centroid of the two openings, 60.96 m from the counter, so the one
     * field worth expanding to and the one building worth standing on are the
     * same piece of ground. A second authored field would give the player
     * somewhere safer to earn the money the objective reads.
     */
    addStartOre(b, spots, b.sea);

    /*
     * Open on the column looking down the lane, biased 13% toward the map centre
     * — the same bias `allies-sounding-line`, `allies-misclosure`,
     * `allies-forced-closure` and `allies-fair-copy` use — so the first thing on
     * screen is the ground the operation will be walked across rather than the
     * back of the base.
     */
    b.setCameraFocus(home.x + (cx - home.x) * 0.13, home.z + (cz - home.z) * 0.13);
    b.scatter({ minX: cx - 190, minZ: cz - 190, maxX: cx + 190, maxZ: cz + 190 }, 150);
    void start;
  },
});
