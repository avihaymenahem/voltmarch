/**
 * ============================================================================
 * P3 — THE CONCESSION
 * ============================================================================
 * The oldest working reading station on this seam stands on ground the
 * Reclamation bought the salvage concession to nine days ago. A breaking crew
 * is on it with torches. Four bearers walk out, take the plates off the wall in
 * order, and walk them home — and the operation is the second half of that
 * sentence.
 *
 * ============================================================================
 * THE DECISION THIS OPERATION OWNS
 * ============================================================================
 * **WHAT YOU LEAVE THE COLUMN.** Not the route — the crust picks that — and not
 * the composition, because the opening is fixed and the bank is small. The
 * question the whole file is built to ask is how much of your army walks home
 * at 3.6 m/s beside four unarmed men while the rest of it is somewhere useful.
 *
 * Every number below is read off the shipped `Defs.ts`, `Combat.ts`,
 * `Crush.ts`, `Targeting.ts` and `config.ts`, or off a headless build at this
 * operation's seeds. **RE-DERIVE, DO NOT RE-QUOTE**, after any weapon retune.
 *
 * ============================================================================
 * THE BEARERS DIE THREE WAYS, AND ONLY ONE OF THEM IS A DAMAGE ROLL
 * ============================================================================
 * This heading read TWO for its first draft and named damage and crush. The
 * third is the one the PLAYER pulls the trigger on and it is written out at the
 * end of this section.
 *
 * `mrdArtificer` is 95 hp of `ArmorClass.Infantry`, unarmed, `Locomotor.Foot`
 * at **3.6 m/s**. Against it the Reclamation carries the worst warhead in the
 * game to meet, and that is one cell: **`ARMOR_MATRIX[Tesla][Infantry]` is
 * 1.60**, the highest number in that column against SmallArms' 1.00 and
 * HighExplosive's 0.90 — and every gun the Reclamation can put on this road is
 * Tesla. **THE ONE EXCEPTION IS THE SLAGGER**, whose `slagCharge` is
 * HighExplosive at 12 m of reach; it is milder per hit and it is the only
 * splash in the ungated roster, which is why it turns up again in the blast
 * audit below rather than in this table.
 *
 *     weapon      carrier          dmg  range  cd     per bolt   bolts   dead in
 *     grinderArc  Grinder          70   18     1.90     89.6       2      1.90 s
 *     postCoil    Spitpost         34   20     0.85     43.5       3      1.70 s
 *     arcProd     Scrap Picker     26   14     1.05     33.3       3      2.10 s
 *
 * `per bolt` is `dmg * 1.60 * COMBAT_DAMAGE.globalMul` (0.80). One Grinder
 * bolt leaves an Artificer on **5.4 hp**; the second one is the whole man.
 *
 * **AND THE SECOND WAY IS NOT DAMAGE AT ALL.** `rclGrinder` carries
 * `EntityFlag.Crusher` and `crushLevel: 5`; the bearers are `EntityKind.Infantry`
 * carrying `EntityFlag.Crushable` with `crushableBy: 1`, so **a Grinder that
 * touches a bearer at walking pace deletes him** — no armour class, no hit roll,
 * no warhead. A 600-credit hull removes a quarter of the operation by driving.
 *
 * **THE PREDICATE IS SPLIT ACROSS THREE FUNCTIONS AND THIS BLOCK USED TO NAME
 * ONE OF THEM.** It said *"`Crush.crushesUnit` asks only `need !== 0 &&
 * need <= level` and `st.speed >= CRUSH.minSpeed` (0.60 m/s)"*, and both halves
 * of that are wrong about where the code lives. `crushesUnit` is the
 * ENTITLEMENT and its own header says it *"deliberately does NOT test speed or
 * distance"* — it asks Vehicle-on-Infantry, alive, not pending-destroy, not
 * garrisoned, `Crusher`, `level !== 0`, `crushableBy !== 0 && <= level`, and
 * not allied, which is nine tests rather than one. The 0.60 m/s gate is
 * `crushPassesThrough` (and again in `CrushResolver.crushUnder`), and
 * `CRUSH.minSpeed` lives in `src/sim/Crush.ts`, not in `config.ts` with the
 * rest of the tunables. The CONCLUSION is unchanged and the value is right;
 * what is worth not repeating is quoting a predicate from the name of the
 * function that reads its answer.
 *
 * **AND THE GRINDER IS NOT THE ONLY CRUSHER ON SEAT 1.** `rclScrapper` — the
 * Scrapjaw, the Reclamation HARVESTER — carries `EntityFlag.Crusher` and
 * `crushLevel: 5` as well, and **two of them stand in the measured opening**.
 * An economy hull that has never been ordered to fight can still drive through
 * the column, which is the least legible way in this operation to lose a bearer.
 *
 * **NOT ONE PACT HULL CAN ANSWER IN KIND.** Every Meridian entry in
 * `FALLBACK_UNITS` is `crushLevel: 0` by doctrine — the Pact never wins a ram —
 * so the Scrap Pickers walking beside those Grinders are in no danger whatever
 * from your armour touching them. The asymmetry is the operation's whole
 * temperature and nothing in the trigger table asserts it.
 *
 * **THE THIRD WAY IS A RIGHT-CLICK ON THE OBJECTIVE, AND IT IS A REAL DEFECT
 * RATHER THAN A TEXTURE.** `mrdArtificer` is `canCapture: true`. The station is
 * a Gaia-owned building, so it is neither `hoverOwn` (`owner === local` is
 * false) nor `hoverEnemy` (Gaia is allied both ways) — which is exactly the
 * civilian branch in `input/Commands.ts`: `isBuilding && !hoverEnemy &&
 * !hoverOwn && caps.canCapture && isNeutralOwned` emits `OrderKind.Capture`
 * with `CursorKind.Capture`. `Capture.resolve` then takes the neutral path
 * (`isFriendlyTarget` returns false for a Neutral owner *by name*), skips the
 * health gate — *"Neutral structures are the prize on the map, not a fortress"*
 * — captures, and calls `consume`, which is `UnitState.Selling` + `markDead`.
 * **The bearer is gone and `TagRegistry.live` prunes him**, so the count drops
 * by one and `t.lift`'s `min: 2` is one loss closer.
 *
 * **THREE CLICKS NOW END THE MATCH RATHER THAN STALLING IT**, which is the one
 * thing about this hazard that `t.stranded` changed: capturing with the third
 * bearer leaves one alive with the plates still up, and that used to be the
 * state no trigger could resolve. It is a legible loss now. Worth knowing in
 * the other direction too — the derrick sits at the shelf's doorway since
 * `STATION_MOUTH_CLEAR` moved it, so the column walks PAST it to reach the far
 * half of the lift disc, and a right-click meant for the ground beyond has more
 * of the building to cross than it did. Marginally easier to trip, and no
 * longer silent when it is.
 *
 * That is the most natural click in the operation: the briefing says *"They take
 * the plates off that wall in order"*, the objective reads *"Lift the count from
 * the reading station"*, and the cursor over the station says CAPTURE.
 *
 * **THIS IS STILL LIVE. NOTHING BELOW FIXES IT AND NOTHING IN EITHER OF THIS
 * OPERATION'S TWO FILES CAN.** It is a rule about what a `canCapture` unit may
 * be pointed at, it binds every operation that puts a Gaia structure in front
 * of a capture-capable player unit, and it belongs wherever that rule can be
 * stated once. Read every sentence in this file about the derrick as holding
 * only until somebody right-clicks it.
 *
 * The second-order half moved, and it moved the wrong way for the paragraph
 * that used to lean on it. Capturing also un-Gaias the derrick —
 * `captureBuilding` writes `st.faction[t] = to.faction` — and this block used
 * to say that is "what actually retires the 'cannot be shot by anybody'
 * guarantee below". It no longer does, because the derrick came off the shelf's
 * doorway: both posts now stand **26.08 m** from it against **22.80** before,
 * and a 2x2's `hitRadius` is `hypot(4, 4)` = 5.657, so the surface distance is
 * **20.42 m against `postCoil`'s 20** and a captured derrick is 42 cm OUTSIDE
 * both posts' reach rather than 2.86 m inside the nearer one. So the capture
 * costs a bearer and does NOT open the derrick to the gun line — a margin, not
 * a property, and one nobody may move a post or the station without
 * re-deriving.
 *
 * **WHY IT IS SURVIVABLE ANYWAY, AND THE REASON IS RANGE.** `Targeting.approach`
 * parks a hull where ITS surface distance to the target is
 * `range * APPROACH_STOP_FRAC` — 0.80 x 26 = 20.80 m for a Solarch — and
 * `Combat.engage` gates the return fire on the OTHER hull's surface distance to
 * IT. Those are two different quantities and they differ by exactly the two
 * `hitRadius` values, so the standoff is
 *
 *     0.80 * R_mine + hitRadius(them) - hitRadius(me) - R_theirs
 *
 *     Solarch on a Grinder    two hulls, hitRadius = radius = 2.790 for both
 *                             20.80 + 2.790 - 2.790 - 18  =  +2.80 m
 *     Solarch on a Spitpost   a 1x1 footprint is hypot(2, 2) = 2.8284
 *                             20.80 + 2.8284 - 2.790 - 20  =  +0.84 m
 *
 * **THE RADII CANCEL IN THE FIRST ROW AND DO NOT IN THE SECOND**, which is why
 * the second is written out in full: a Spitpost is a STRUCTURE and a Solarch is
 * a HULL, and the shorter `0.80 * R - R_theirs` form would put that row at
 * 0.80 m — the right side of the line reached by the wrong arithmetic, and the
 * exact mistake `campaign-zone-safety.spec.ts` exists because of.
 *
 * Both are on the correct side, and the second is the smaller finding dressed
 * as the larger: **your armour outranges the emplacements and your bearers
 * cannot**. The gun line taxes the LIFT and not the assault.
 *
 * **AND THE STANDOFF ONLY EXISTS FOR A HULL THE PLAYER HAS EXPLICITLY POINTED
 * AT SOMETHING.** `Targeting.approach` is reached through `managesGoal`, whose
 * first line is `s !== UnitState.Attacking && s !== UnitState.Guarding ->
 * false`. A MOVING or ATTACK-MOVING Solarch is neither, so nothing publishes
 * the parked goal and it drives to the move order it was given — through
 * `postCoil`'s 20 m if that is where the order points. So the two numbers above
 * are what a right-click ON A TARGET buys, not what an attack-move gives, and
 * 0.84 m is under one steering separation nudge for a 2.79 m hull in a group of
 * three either way. **The WALK is the half that is unconditional and it is the
 * half that matters**: measured over every cell of the homeward corridor below,
 * the two shelf posts stand **25.6 m and 32.0 m** off it against 20.23 m of
 * reach, so the column never walks into a post it did not choose to stand next
 * to. (25.6 / 28.3 before the derrick moved. The posts did not move — the
 * corridor did, by one cell at the station end, and it moved AWAY from the
 * further post.) It is only the LIFT — a disc drawn on the station rather than a route —
 * that puts a bearer under one.
 *
 * The exchange itself is not close. A Solarch delivers 48.0 a shot into a
 * Grinder (focusLance 60, ArmorPiercing vs Medium 1.00, globalMul 0.80) on a
 * 1.6 s cooldown — 30.0 dps, so three of them kill a 270 hp Grinder in
 * **3.00 s** of dps and **1.60 s** in whole trigger pulls, since 270 needs six
 * shots and three hulls fire three at a time. The Grinder answers with 28.0 dps
 * (70, Tesla vs Light 0.95, /1.9 s) and needs **11.79 s** of dps against a
 * 330 hp Solarch — seven bolts, so 11.40 s in whole pulls. The escort wins that
 * trade several times over, as long as it is standing between the Grinder and
 * the column, which is the only thing the player is actually being asked to
 * do.
 *
 * `movesShareSpace(Hover, Wheel)` is `true`, so a Pact hull is a physical
 * obstruction to a Grinder rather than a ghost. Standing in the road is a real
 * move here and it is the only one the doctrine leaves.
 *
 * **THE SPLASH AUDIT IS TRUE AND IT WAS THE WRONG AUDIT.** `slagMortar` — 124
 * damage at 42 m with a **5.8 m** blast — would take the column in one round,
 * and it rides `rclSlaghurler`, which carries `unit.specialist` and is refused
 * by `roster.ai: []`. What is left ungated is `slagCharge` at 2.6 m on the
 * Slagger, and it is correct that `grinderArc`, `postCoil` and `arcProd` carry
 * **no `splashRadius` at all**.
 *
 * **AND EVERY ONE OF THOSE THREE CHAINS, WHICH IS THE SAME PROPERTY REACHED
 * THROUGH A FIELD THIS FILE NEVER LOOKED AT.** This block used to close with
 * *"Four bearers walking as a group are four separate kills, which is what
 * makes attrition a cost rather than a coin flip"*, and that is false.
 * `grinderArc` is `chainCount: 2`, `postCoil` and `arcProd` are `chainCount: 1`;
 * `Combat.resolveTesla` pushes ONE DAMAGE RECORD PER LINK, hopping to the
 * nearest un-hit hostile within `COMBAT_WEAPONS.teslaChainRange` — **9.0 m** —
 * **of the PREVIOUS VICTIM**, at `teslaChainFalloff` 0.6 a link. Its own header
 * says so: *"The chain following the victims (rather than the shooter) is what
 * makes it hop down a column."* The layout spaces the bearers **5.00 m apart,
 * measured**, so every neighbour is inside the hop, and `Defs.ts` says it out
 * loud two hundred lines above the rows quoted here (*"every arc CHAINS"*)
 * while `rclSpitpost`'s own shipped blurb reads **"Cheap chained coil."**
 *
 * One `grinderArc` trigger pull into a four-man column, through the same
 * 1.60 x 0.80 as the table above:
 *
 *     primary  70   -> 89.6    bearer A  95 -> 5.4
 *     link 1   42   -> 53.8    bearer B  95 -> 41.2
 *     link 2   25.2 -> 32.3    bearer C  95 -> 62.7
 *
 * So the SECOND pull off a single Grinder kills A outright and its first hop
 * kills B — **two bearers from one trigger pull** — and the `cutoff` wave is
 * three Grinders. The escort absorbs hops in practice, because `nearestUnhit`
 * takes the nearest un-hit HOSTILE and a Solarch standing between the Grinder
 * and the column is one; that is a mitigation the player buys, not a property
 * of the roster. **`roster.ai: []` still refuses the mortar, and the operation
 * is still winnable — what it does not buy is the sentence it was justified
 * with.** Walk them abreast at 5 m and one bolt is worth three of them.
 *
 * ============================================================================
 * THE ROUTE IS MEASURED, AND THE ONE THING I EXPECTED TO FIND IS NOT THERE
 * ============================================================================
 * Re-measured 2026-08-19 after the derrick came off the shelf's doorway, on a
 * headless build at `mapSeed` 33 310 / `simSeed` 3 393 with the def tables
 * BOUND and the roster INSTALLED. **THE INSTRUMENT IS NAMED BECAUSE THE
 * INSTRUMENT IS PART OF THE READING**: Dijkstra over the REAL
 * `FlowFieldCache.costGridFor(MoveClass.Foot)` — so `rebuildCost` itself rather
 * than a mirror of it — 8-connected, edge weight `step * (cost[a] + cost[b])/2`,
 * endpoints snapped to the nearest open cell, length reported as the geometric
 * metres of one steepest descent. The symmetric edge weight is what makes a
 * CORRIDOR (`dFwd + dRev === total`) well defined; an asymmetric
 * enter-cost variant of the same walk answers identically on this ground, to
 * one decimal, on both builds.
 *
 *                            before      after     straight   detour
 *     bearers -> station     321.0 m    315.4 m     287.0      +9.9%
 *     station -> home        287.1 m    281.4 m     246.7     +14.1%
 *
 * (`before` is a control capture on this tree with `STATION_MOUTH_CLEAR` forced
 * to 0, which reproduces the shipped placement cell for cell — not a figure
 * carried forward.) The narrowest free span the homeward descent crosses,
 * between 12% and 80% of its length, is **12.0 m at (202, 326)** — 55.5% of the
 * way home by cost, 157.5 m of walking and 141.2 m of straight line from the
 * station, 108.4 m of straight line from the home START SPOT. It was the same
 * three cells before the move, at 56.4%.
 *
 * **THE TWO LENGTHS ARE INSTRUMENT-DEPENDENT AND MUST NOT BE "CORRECTED" INTO
 * EACH OTHER.** Four earlier re-derivations of the same two legs — three
 * mirrors of `rebuildCost` and one run against a real `FlowFieldCache` — landed
 * at **287.1 / 288.7 / 289.4 / 292.7 m** home and **332.0 / 333.7 / 337.0 /
 * 340.7 m** out. This instrument's control reads 287.1 home, exactly the bottom
 * of that band, and 321.0 out, **eleven metres BELOW it** — so the spread is
 * wider than the ±2% this block used to claim, and it is one-sided on the
 * outbound leg. The endpoints are cells rather than points (the Conclave
 * occupies the home start spot and the derrick occupies the station, so every
 * instrument seeds a few metres inside both ends) and a least-cost DESCENT is
 * one arbitrary member of a tie set. **The load-bearing figure is the DELTA**,
 * which one instrument measures on both builds: -5.6 m out and -5.7 m home.
 *
 * **THE SPAN WAS 10.0 m AND 10.0 m IS NOT A NUMBER THIS QUANTITY CAN TAKE.**
 * `applyClearance` measures a free span as `min(RUN_X, RUN_Z)` in whole CELLS,
 * which is what the next paragraph compares against `NAV_MIN_CORRIDOR_CELLS`,
 * so every span is a multiple of `CELL` = 4 m. The cell at (202, 326) really is
 * on the route and its span really is the narrowest one on it: **3 cells,
 * 12.0 m**. The wrong version was reached by measuring an open gap in metres
 * and then comparing it to a rule stated in cells — a unit mismatch that reads
 * as precision, and the conclusion below (no one-cell defile) survives it.
 *
 * At the bearers' 3.6 m/s that is **87.6 s out, 78.2 s home**, plus the 60 s
 * lift: **3:46 of pure column time against a 900 s par** (3:49 before the
 * derrick moved). The rest of the budget is the fight, which is the correct
 * ratio for an operation whose subject is what the escort is doing while four
 * men walk.
 *
 * **NO HEADLESS BUILD HAS A ROAD ON IT, AND THAT IS A BIGGER CAVEAT THAN "IT
 * OMITS THE ROAD MULTIPLIER".** This block used to say the numbers were a lower
 * bound because the mirror left out the road term, the clearance pass and the
 * wall-hug dilation. The clearance and wall-hug halves are right. The road half
 * is not a property of the MIRROR: `roads.system.ts` builds the network in
 * `init()`, at `Phase.Command` order 60, DURING `bootstrap()` — so
 * `getRoads()` is null inside `buildScenario` and `rebuildCost` skips its road
 * branch entirely. Every measurement in this file, taken by any instrument, is
 * therefore about ROADLESS ground, while every real match on this map has a
 * carriageway. That is not a bound in one direction; it is a different map.
 *
 * **I EXPECTED THE HULLS AND THE MEN TO TAKE DIFFERENT ROADS. THEY DO NOT.**
 * `NAV_COST_ROUGH` is 1.25 for Foot and **1.0 for Hover**, so on broken ground
 * the Pact's hulls should route straight where its people detour — and on this
 * map there is nothing to detour around: **268 of 11 788 foot-passable cells
 * are rough, 2.3%**. Compared corridor to corridor — every cell on SOME
 * least-cost path, which is the only tie-break-free way to ask — the two are
 * the same road at the same cost: identical total (**7204.5** either way), and
 * the foot corridor is a strict SUBSET of the hover one — 236 cells inside 240
 * — reaching **4.0 m**, one cell, past it at its widest. **THAT NUMBER READ 8.0
 * AND THE CONTROL SAYS IT IS 4.0 ON THIS GROUND TOO.** Re-measured on both
 * builds with the instrument named above, the derrick's move took the corridor
 * from 237 cells to 236 and left the overhang at 4.0 m in BOTH, so 8.0 came
 * from a third instrument rather than from this ground. Name the instrument
 * before calling either number wrong.
 *
 * The idea is recorded here so nobody re-derives it: on a landlocked preset the
 * hover bit buys pathing nothing, and the doctrine that matters is the crush
 * column, not the cost column. **THE ONE COLUMN THAT WOULD SEPARATE THEM IS THE
 * ONE NO HEADLESS BUILD HAS.** `NAV_COST_ROAD` is **0.88 for Foot and 1.0 for
 * Hover** — the carriageway is where the two locomotors diverge MOST, further
 * apart than rough ground puts them — and it is exactly the term missing from
 * every measurement above. So "the same road" is established for the ground the
 * generator lays and is untested against the roads the boot adds. (The other
 * two caveats stand: the mirror does not implement `applyClearance`, and
 * `NAV_MIN_CORRIDOR_CELLS` is 1 for Foot against 2 for Hover, so a genuinely
 * one-cell defile would separate them where this instrument cannot see it. The
 * narrowest span the route crosses is 12.0 m — three cells — so no such defile
 * is on this road.)
 *
 * ============================================================================
 * THE TWO SCRIPTED WAVES, AND THE CLEARANCES ARE MEASURED FROM THE ROUTE
 * ============================================================================
 * `EffectSink.spawnUnits` puts unit `i` of `count` at exactly
 * `angle = i / count * 2pi`, radius `spread`, and `ProductionService.spawnUnit`
 * writes that point VERBATIM — no `connectedGround`, no egress search. So the
 * points that matter are the ring points, and **all fourteen of them are open
 * on their own wave's move class** on the shipped seeds:
 *
 *     WORKS (422, 268)   3x rclGrinder spread 16   (438,268) (414,281.9) (414,254.1)
 *                        4x rclPicker  spread 24   (446,268) (422,292) (398,268) (422,244)
 *     CUT   (234, 306)   3x rclGrinder spread 15   (249,306) (226.5,319) (226.5,293)
 *                        4x rclPicker  spread 22   (256,306) (234,328) (212,306) (234,284)
 *
 * **AND THE TWO POINTS MEAN OPPOSITE THINGS, WHICH IS WHY THEY ARE MEASURED
 * AGAINST DIFFERENT NOUNS.**
 *
 *   - `WORKS` is the yard's relief and it is measured against the STATION:
 *     **86.6 m** behind it, 137.2 m from the Reclamation opening, 333.4 m from
 *     the player's. It is **86.8 m off the homeward corridor** — it is not an
 *     ambush, it is the crew coming back for its own ground, and the column has
 *     the whole lift to see it arrive. (84.3 / 84.1 before the derrick moved.
 *     `WORKS` did not move; the station came 5.66 m toward home, so everything
 *     measured from the station grew by about that much. Its seven ring points
 *     are unchanged and all still open.)
 *
 *     **THAT NUMBER READ 78.0 AND IT COULD NOT HAVE.** `WORKS` sits BEYOND the
 *     station on the far side from home, so the nearest point of any homeward
 *     route to it is the route's own first cell — which bounds the distance at
 *     the straight line to the station, less whatever few metres the instrument
 *     seeds inside it. Every re-derivation lands within a metre or two of that
 *     bound and none can answer 78. A clearance quoted for a point that is off
 *     the END of a route is a restatement of its distance to the endpoint.
 *   - `CUT` is the ambush and it is measured against the ROUTE: the point sits
 *     **0.0 m from the measured homeward corridor** — its cell lies on a
 *     least-cost path on every instrument tried, before the move and after —
 *     and its seven ring points land **1.0 / 1.1 / 9.0 m** (the Grinders) and
 *     **2.0 / 10.0 / 10.0 / 10.0 m** (the Pickers) off the corridor, identical
 *     on both builds. It is the **41.5% point of that road by cost and 41.9% by
 *     arc**, 117.9 m of walking, 106.5 m of straight line from the station and
 *     146.1 m of straight line short of home. (42.6% / 43.1% / 123.6 m / 110.2 m
 *     before; the station moved toward `CUT`, so the same point now sits
 *     slightly earlier on a slightly shorter road.)
 *
 *     **THE RING FIGURES USED TO READ 1.0 / 12.4 / 13.0 AND 2.0 / 22.0 / 7.2 /
 *     22.0, AND THE SPREAD WAS THE INSTRUMENT RATHER THAN THE GROUND.** 236
 *     cells lie on some least-cost path here (237 before the move), so "the
 *     road" is a corridor and a distance FROM it is a range — the old figures
 *     are the distances to ONE arbitrary descent, and a different descent of
 *     the same field answers 8.1 / 3.1 / 26.1. The corridor minimum
 *     (`dFwd[i] + dRev[i] === total`) is the only tie-break-free reading and it
 *     is the one quoted above: **1.0 to 10.0 m, not 1.0 to 22.0**. Same
 *     correction on the `mapSeed` survey note below, which quotes the old
 *     range.
 *
 *     **A clearance measured against the straight line would have been a
 *     different number and a worse one**, and the control was taken rather than
 *     argued. The first candidate for this wave was the 42% point of the
 *     straight CHORD, at (244.9, 333.6); its three Grinder ring points sit
 *     **4.8 / 9.9 / 14.7 m from the chord** and **19.7 / 25.7 / 4.3 m from the
 *     road anybody actually walks** — the chord half reproduces exactly, and the
 *     road half is re-derived here against the corridor because the figures it
 *     used to carry (27.7 / 39.6 / 14.6) came off the same single descent as the
 *     ones above. The point stands either way: sited off the chord it reads as
 *     an ambush and lands in a field, 18.9 m from any road anybody walks.
 *
 * `t.cut` fires **25 s after the lift**, not 50: the column reaches `CUT` after
 * 117.9 m of a 281.4 m walk, which is **32.7 s** at 3.6 m/s, so fifty seconds
 * puts the wave a quarter of a minute behind them and twenty-five puts it
 * **7.7 s in front**. (123.6 m and 34.3 s before the derrick moved; the choice
 * is robust across the whole instrument spread this file records.) It is ordered
 * `attackMove` at the STATION rather than at the column, so a player who has
 * not left yet gets it delivered instead of dodging it by standing still.
 *
 * **AND THE SCRIPTED ORDER DOES NOT SURVIVE THE FIRST BRAIN PASS, WHICH MAKES
 * THAT LAST SENTENCE AN ARGUMENT ABOUT A FIFTH OF A SECOND.** Both waves are
 * spawned onto SEAT 1, which is an ordinary skirmish brain. `AI_CADENCE.squad`
 * is `round(SIM_HZ 30 / AI_SQUAD_HZ 5)` = **6 ticks**, and `AiBrain.squad` runs
 * `regroupSquads`, which re-files every ungrouped hull into the reserve or the
 * strike group and then attack-moves it at the brain's OWN objective. The
 * layout header states this rule correctly about the three untagged Scrap
 * Pickers on the shelf — *"`AiBrain.regroupSquads` will march them off it on the
 * first brain pass whatever this file says"* — and it binds a `spawnUnits` wave
 * exactly as hard. The wave still tends to arrive, because the brain's standing
 * objective is the player's base and the road runs there; it does not arrive
 * because `orderTagged` sent it. **Do not build a timing argument on an order
 * an AI seat holds** — `orderTagged` is dependable only on hulls nothing else
 * re-tasks, and every seat with a brain re-tasks.
 *
 * ============================================================================
 * NO SCRIPTED THREAT EXISTS BEFORE A CHECKPOINT THE PLAYER TRIPS
 * ============================================================================
 * `setInvulnerable` was cut with an argument aimed at exactly this operation —
 * *"an escort whose subject cannot die is not an escort; what a designer wants
 * from it is bought by not spawning the threat until the first checkpoint"* —
 * and that is the shape here. `t.reach` is `unitsInArea`, so the crew comes
 * when the BEARERS ARRIVE and not on a clock; `t.cut` hangs off
 * `objectiveComplete 'lift'`. Nothing scripted moves until the player moves.
 *
 * **THAT IS NOT THE SAME AS "NOTHING CAN KILL THEM EARLY", AND THE DIFFERENCE
 * IS THE AI.** Seat 1 opens with 4 Grinders, 8 Scrap Pickers, 2 Scrapjaws and a
 * Tinker under an ordinary skirmish brain that has never read an objective, and
 * it will attack-move at whatever is nearest on its own schedule. What the
 * design guarantees is narrower and honest: the nearest Reclamation asset to
 * the bearers at t = 0 is **256.7 m** away, the two emplacements at the works
 * never move, and no authored wave exists until the player has walked into one.
 * (261.4 was the FARTHEST of the four — the first bearer's distance quoted for
 * the column's. Per bearer it runs 261.4 / 259.8 / 258.2 / 256.7, and a
 * guarantee has to be stated at the minimum or it is not one.)
 *
 * ============================================================================
 * THE LOT, AND WHY THE GUNS DO NOT TAX THE ASSAULT
 * ============================================================================
 * The station is a `civOilDerrick` on the **Gaia** slot. `ScenarioBuilder.gaia`
 * allies it to every player, so `Targeting.isValidTarget` refuses it to every
 * gun in the match: the landmark this operation is named after cannot be shot
 * by anybody, which deletes the whole class of failure `pact.02` is built out
 * of. Nothing depends on it surviving and no trigger names it. **That holds
 * until somebody CAPTURES it** — see the third way a bearer dies, at the top of
 * this file, which is a LIVE hazard and not fixed anywhere in these two files.
 * `captureBuilding` writes the captor's faction onto the derrick; the shooting
 * half of that no longer follows, because the nearest Spitpost is 26.08 m away
 * and a 2x2's `hitRadius` is 5.657, so a captured derrick sits at 20.42 m of
 * surface against `postCoil`'s 20 and is 42 cm outside it. (It read 22.80 /
 * 17.14 / "starts taking fire" while the derrick stood in the shelf's doorway.)
 * The TRIGGER-TABLE consequence is still nil either way — no trigger names it —
 * which is the part of this paragraph worth keeping, and the bearer is consumed
 * whatever the posts do.
 *
 * Around it, measured after `spawnBuilding` snapped each footprint: a Breaker
 * Yard **32.6 m** behind (1250 hp, a REAL vehicle producer on the AI's seat, so
 * levelling it costs the Reclamation throughput as well as scenery) and two
 * Spitposts **26.1 m each** in front, on the side the column arrives from, 23.3
 * m apart. Those three figures read 26.0 / 27.9 / 22.8 before the derrick came
 * off the shelf's doorway; **none of the three buildings moved** — they are
 * placed off the shelf ANCHOR, and it is the derrick that walked one diagonal
 * cell into the middle of them.
 *
 * **THE SHELF WAS A SEALED POCKET AND THE DERRICK WAS THE PLUG. FIXED.** The
 * full measurement is in `pact-concession.ts`'s header and its
 * `STATION_MOUTH_CLEAR` constant. The number this block has to carry is that of
 * the foot-passable cells inside `t.lift`'s `r = 22`, **39 of which only 26
 * were connected to the rest of the map** — the other 13 were on a 24-cell
 * pocket no unit could ever stand on. It is now **40 cells and all 40 are
 * connected**.
 *
 * So the disc a player can actually use is **40 cells, 640 m2** (was 26 cells,
 * 416 m2), nearest usable cell 6.32 m from the station centre and farthest
 * 20.59 m — of which **12 sit inside a Spitpost's reach** (`postCoil` 20 m of
 * surface, plus an infantryman's 0.234 m `hitRadius`, so 20.23 m of centre
 * distance) and 28 are free of both posts. Per post: A covers 10 of the 40 and
 * B covers 6, with 4 under both — so neither post is scenery.
 *
 * **THAT IS 30% OF THE LOT, AND BOTH HALVES OF THE OLD SENTENCE WERE WRONG.**
 * It read "a third", then was corrected to "half"; the "half" was honest
 * arithmetic on the broken ground (13 covered out of 26 reachable) and the
 * "third" was 13/39, which divided a covered count by a denominator that
 * included 13 cells nobody could reach — two sets that do not overlap the way
 * that sentence assumed. On connected ground the two denominators are the same
 * number and the question stops being ambiguous: **12 of 40**.
 *
 * The design conclusion survives and is stronger at the new number: 28
 * reachable cells are free of both posts, so the lift can be taken with both
 * posts alive with room to stand. **That is a skill discount and it is left in
 * on purpose**, exactly as `pact.02` leaves its hand-stopping window in: the
 * player who works out that most of the lot is uncovered has earned sixty
 * seconds they would otherwise have spent killing them.
 *
 * ============================================================================
 * THE MEASURED POINTS, AT `mapSeed` 33 310 / `simSeed` 3 393
 * ============================================================================
 * Read off a headless build after `spawnBuilding` snapped every footprint, with
 * the def tables BOUND and the roster INSTALLED.
 *
 * **THAT IS NOT THE BUILD `tests/campaign-maps.spec.ts` PERFORMS, AND THIS LINE
 * USED TO SAY IT WAS.** `buildOperation` in that spec calls `buildScenario`
 * with `{ armies }` and no `defs`, and never calls `setCampaignRoster` — so
 * `options.defs ?? EMPTY_BINDING` hands `ScenarioBuilder.spawnUnit` an
 * `undefined` def, `isBuildable(undefined)` is true, and **every roster refusal
 * below is inert in that harness**. Built its way the same seeds give 250 alive,
 * 25 units on seat 0 and 17 on seat 1 — the two `mrdSkiff` and the two
 * `rclSpitter` survive. Built with both installed they give the 242 / 23 / 15
 * this file quotes. The numbers are right; the sentence named a harness that
 * cannot produce them, and anyone re-deriving them from that spec alone will
 * conclude the roster block does nothing.
 *
 *     home spot  108, 380     Conclave 114, 382     foe spot 404, 132
 *     shelf anchor 343.4, 300.2 (nominal — the composition is measured here)
 *     station    340, 296     shed 372, 302         posts 318,310 and 338,322
 *     WORKS      422, 268     CUT  234, 306         axis 386.2
 *
 *     home -> station 246.7      foe -> station 176.1     station -> shed 32.6
 *     station -> posts 26.1 and 26.1                post -> post 23.3
 *     (Conclave -> station is 241.8; 246.7 is measured from the START SPOT,
 *      which is 6.32 m from the Conclave and is what `t.win`'s disc is drawn
 *      on. Nothing stands at (98, 364), which this block used to call a
 *      Forgeyard or a Cistern — those are at (112, 358) and (112, 406). The
 *      error is worth writing down because "Conclave" appears in an objective
 *      TITLE and in Calvane's closing line, so a reader has three reasons to
 *      look for it and this file pointed at the wrong building twice.)
 *     bearers 73,400 / 76,404 / 79,408 / 82,411
 *     bearers -> home spot 40.7 / 40.1 / 40.1 / 40.7   -> station 287 / 285 / 284 / 283
 *
 * **THE STATION ROW IS THE ONLY PLACEMENT THAT MOVED**, from 344, 300, and
 * every row that changed with it is a row measured FROM it. The shed, the two
 * posts, the three untagged Scrap Pickers, both openings, the bearers, the seat
 * counts (23/23 and 15/26, 242 alive) and the terrain census are byte-identical
 * across a control build with `STATION_MOUTH_CLEAR` forced to 0. See that
 * constant in `pact-concession.ts`.
 *
 * **THE BEARERS START OUTSIDE THE HOME DISC AND THAT IS LOAD-BEARING.** `t.win`
 * counts bearers inside `r = 30` of the home spot; all four open **40.1 to
 * 40.7 m** from that centre, 10 m outside the edge. So the win cannot be
 * satisfied by the bearers merely existing where they were left — they have to
 * be walked back in — and the guard on `objectiveComplete 'lift'` is the second
 * lock rather than the only one.
 *
 * **RE-MEASURE IF EITHER SEED MOVES.** Nothing fails loudly if these drift:
 * `unitsInArea` simply stops firing, the hidden secondary never reveals, and
 * the operation is still winnable, so no test and no player reports it.
 * `tests/campaign-spawn-ground.spec.ts` is the one exception — it re-derives
 * every ring point above and fails by name if a drop lands on closed ground.
 * ========================================================================== */

import { Faction } from '../../../core/types';
import { minutes, seconds } from '../../types';
import type { OperationDef } from '../../types';

/* -- the measured points -------------------------------------------------- */

/** The player's opening. `t.win` and `t.hands` count bearers inside r = 30. */
const HOME = { x: 108, z: 380 };
/**
 * The reading station, as PLACED. `t.reach` and `t.lift` count bearers inside
 * r = 22 of it and `t.open` reveals r = 64.
 *
 * IT READ 344, 300 AND THAT SPOT SEALED THE SHELF. The derrick's 2x2 was the
 * only 4-connected doorway onto its own ground; `pact-concession.ts`'s
 * `STATION_MOUTH_CLEAR` moves it one diagonal cell — 5.66 m — and the pocket
 * merges. Re-read off the built world, not adjusted by hand.
 */
const STATION = { x: 340, z: 296 };
/**
 * Where the yard's relief forms up: 86.6 m behind the station and 86.8 m off
 * the homeward corridor. **UNCHANGED WHEN THE STATION MOVED** — it is an
 * absolute point on the far side of the shelf, so those two figures grew by the
 * derrick's own 5.66 m rather than by anything happening here (84.3 and 84.1
 * before). All seven of its ring points are open on their own move class,
 * before and after.
 */
const WORKS = { x: 422, z: 268 };
/**
 * The ambush: ON the measured homeward corridor, 106.5 m of STRAIGHT LINE from
 * the station and 117.9 m of walking back down it. (110.2 and 123.6 before the
 * derrick moved; `CUT` itself did not move.)
 *
 * An older version of this comment read "110.2 m back down it" — that was the
 * straight line labelled as an arc, which is the mistake the header two
 * hundred lines up exists to prevent — *"the two distances are different nouns
 * and only the first one decides the timing"*, where the first noun is the ARC.
 */
const CUT = { x: 234, z: 306 };

/** Sixty seconds of taking plates off a wall in order. */
const LIFT_HOLD = seconds(60);

/**
 * When the torches have taken the top of the wall.
 *
 * CHOSEN AGAINST THE WALK RATHER THAN AGAINST THE PAR. The bearers need 87.6 s
 * of pure movement to reach the station and the lift is another 60, so a player
 * who marches at t = 0 is finished at **2:28** (87.6 + 60 = 147.6 s; this read
 * "about 2:40", then 2:32 at the old route length) and a player who spends one
 * production cycle first is finished at about 4:00. Five minutes is the point
 * at which "I will go in a moment" has already cost them the objective, which
 * is the same bar `allies.01.sounding-line` sets for the same reason.
 *
 * **THE WINDOW AND THE COPY USED TO SIT ONE MINUTE APART, AND THE GAP RAN
 * AGAINST THE PLAYER. CLOSED IN THE COPY, NOT IN THE CLOCK.** `t.window` asks
 * `not objectiveComplete 'lift'`, and the lift is arrival PLUS a sixty-second
 * hold — so the enforced bar is *have the plates off by 5:00*, i.e. *arrive by
 * 4:00*. The objective title read "Reach the station before the crew cuts the
 * plates" and Nael said "Be on that station inside five minutes", so a player
 * standing on the station at 4:30 had done exactly what both sentences asked
 * and lost the 500 credits at 5:00, mid-hold.
 *
 * Both strings name the ACT now — "Lift the count before the crew cuts the
 * plates" and "Have those plates off that wall inside five minutes" — which is
 * `allies.01`'s shape ("Take the control reading inside five minutes") and the
 * one that does not lie. **THE CLOCK WAS THE OTHER CANDIDATE AND IT WAS
 * REJECTED**: pushing `TORCH_WINDOW` to six minutes would have made the old
 * copy true, and it would have bought it by moving a deadline that is already
 * derived — 2:28 for a player who marches, ~4:00 for one production cycle — so
 * six minutes stops being a bar at all. The prose was wrong about the trigger;
 * the trigger was not wrong about the operation.
 *
 * **NO DIGITS IN EITHER STRING.** `tests/build-descriptions.spec.ts` §4 bans
 * them in `BUILD_DESCRIPTIONS` and does NOT reach objective titles or campaign
 * dialogue, so nothing in the suite would have failed a number written into
 * them. The minute count is this constant's to own.
 */
const TORCH_WINDOW = minutes(5);

/**
 * Ticks after the lift before the road is cut.
 *
 * 25 s, and the derivation is in the header: the column covers ~293 m at
 * 3.6 m/s, so it passes `CUT` — the 42–45% point of that path — at t+34 to
 * t+37 s. Fifty seconds would put the wave behind them at either end of the
 * band, so the choice is robust to the instrument spread the header records.
 */
const CUT_DELAY = seconds(25);

const op: OperationDef = {
  id: 'pact.03.concession',
  chapter: 'pact',
  faction: Faction.Meridian,
  /*
   * THE RECLAMATION, AND THE LINE THAT DECIDES IT IS TALLOW'S:
   * *"whatever is on that wall is worth more than the wall."*
   *
   * P1 fought the Allies, who read this ground, and P2 the Soviets, who work
     * it. The third party in `docs/campaign/CAMPAIGN_BUILD_SPEC.md` §2.1's division is the one
   * that BUYS it, and the Reclamation chapter's own blurb — "nine breaking
   * yards, every faction as a customer, and the only complete account" — is the
   * argument this operation hands the Pact and cannot answer. An enemy who
   * wants the count because it is worth something is a different enemy from one
   * who wants it gone, and it is the only foe that makes the chapter's BLURB
   * ("an argument that cannot be made without conceding it") land as a plot
   * rather than as a theme. (The chapter's TITLE is 'The Crust'; the phrase
   * quoted here is the second half of `CHAPTER_META.pact.blurb`, and the whole
   * of its first half — "four hundred years of readings" — also opens this
   * operation's own `beat`, so it appears three times on one screen of
   * `src/shell/Campaign.ts`.)
   *
   * MECHANICALLY IT PINS THREE THINGS. Both waves spawn `rclGrinder` and
   * `rclPicker` — authored Reclamation hulls, literal and unremapped, which
   * `validateCampaign` checks against this field. The layout's `pillbox`
   * resolves through `keyFor` to the SPITPOST, whose `postCoil` reaches 20 m
   * and draws no power, and its `warFactory` to the BREAKER YARD; on a Soviet
   * seat those would be a Sentry Gun and an ordinary War Factory and the
   * standoff arithmetic above would move. And the whole Tesla table — the 1.60
   * against Infantry that makes the bearers so cheap to kill — is a property of
   * THIS army and of no other.
   */
  foe: Faction.Reclaim,
  index: 3,
  title: 'The Concession',
  beat: 'Four hundred years of readings, four bearers, and three hundred metres of somebody '
    + 'else’s ground.',
  primaryType: 'escort',
  // Objective state, a reveal, a camera move, two waves and two orders — so
  // 'bespoke' by the definition in `types.ts`. The label is about MECHANISM:
  // what makes this operation what it is is 281.4 m of road and one armour
  // cell, and both exist before tick one.
  archetype: 'bespoke',
  parSec: 900,
  requires: ['pact.02.long-count'],

  map: {
    // `arid` is the PRESET; `desert` on the next line is the BIOME, and they
    // are the one pair in the two vocabularies that disagree. See the block on
    // `biome` below.
    preset: 'arid',
    // Fixed, and pinned by `tests/campaign-maps.spec.ts` as a terrain
    // fingerprint. CHOSEN BY SURVEY: seventeen rolls were built headless at
    // this `simSeed` and read for the homeward route's length against the
    // straight line, for the narrowest span that route crosses, and for whether
    // a wave could be landed ON the route with every ring point open. The
    // spread was real — detours ran 9% to 56% and four rolls put the narrowest
    // span inside the player's own base, which is an artefact of walking into
    // it rather than a feature of the road. 33 310 gives a 14% detour, a 12.0 m
    // neck at 55.5% of the way home, and a `CUT` ring that lands 1.0 to 10.0 m
    // off the measured path with nothing blocked. (This read "18%", "a 10.0 m
    // neck at 63%" then "59%", and "1.0 to 22.0 m"; every one of those is
    // corrected in the header above, most recently by the derrick's move off
    // the shelf doorway, and the survey's RANKING is unaffected because every
    // roll was read with one instrument.)
    mapSeed: 33_310,
    // The PAIR is chosen by this seed and not by the map roll. `seatedSlots`
    // filters `START_PAIRS` against the water, and with no sea all four
    // survive; this one draws the diagonal at **386.2 m**, which is the longest
    // opening this game produces and the reason a 249 m walk each way fits
    // between two bases that are not on top of each other.
    simSeed: 3_393,
    armies: 2,
    /*
     * `desert`, NOT `arid`, AND THAT IS THE ONE TRAP IN THIS FIELD.
     *
     * `BiomeName` is `temperate | desert | snow | urban` and `MAP_PRESETS` is
     * keyed `temperate | arid | tropical | snow | coast | urban | archipelago`.
     * The two vocabularies overlap on three names and disagree on exactly one:
     * the preset is `arid` and the biome is `desert`. `getBiome` answers an
     * unknown name with a `console.warn` and TEMPERATE, so the wrong spelling
     * does not throw, does not fail a gate, and silently ships a different
     * landform — `reclamation.03.sold-twice` was authored, measured and
     * verified that way, and every number in its headers was about ground it
     * did not declare. tsc catches it now because this field is a real union;
     * the reason it is still worth a comment is that a biome is `tierCount`,
     * `stepHeight`, `basinDepth` and every surface layer, so a corrected
     * spelling means RE-MEASURING rather than re-labelling.
     *
     * Measured on the ground this pair actually builds: 11 788 of 16 384 cells
     * are foot-passable (72%), **4 596 are closed (28%)**, 0 are water and 268
     * (2.3% of the passable ones) are rough. The closed quarter is the terraces,
     * and the terraces are why the road home is 18% longer than the straight
     * line.
     *
     * THE CLOSED FIGURE READ 4 353 AND THE TWO ROWS DID NOT ADD UP. 11 788 +
     * 4 353 = 16 141, which is 243 short of the map, and 243 is exactly the
     * number of cells a HOVER can enter and a man cannot — so the wrong number
     * was `16 384 - hoverPassable` printed under a foot-passable label. The
     * closed count is the complement of the row above it by construction; three
     * independent counts (`costGrid >= 255`, the `passGrid` foot bit clear, and
     * the subtraction) all answer 4 596. **A census whose rows do not sum to
     * `MAP_CELL_COUNT` is wrong on its face and this one shipped past four
     * readings of the file.**
     */
    biome: 'desert',
    opening: 'base',
    /*
     * BOTH SEATS. `Shell.applySimPostBoot` writes `setup.startingCredits` into
     * every non-Neutral slot, so this is one number doing two jobs. (The method
     * was named `applyEconomyPostBoot` here and in four other operation files;
     * no such method exists. The BEHAVIOUR described is right — `Shell.ts`'s
     * `applySimPostBoot` is the loop that skips `Faction.Neutral` — and only
     * the name was invented, which is the kind of error that survives because
     * nothing ever tries to call it.)
     *
     * 5 000 IS NOT THIS OPERATION'S FLOOR AND THIS BLOCK CLAIMED IT WAS. It
     * said *"5 000 is `MCV_MIN_CREDITS`, the documented floor for reaching a
     * refinery, so it is the bottom of the band rather than a midpoint"*.
     * `MCV_MIN_CREDITS` is 5000, but both of its consumers are gated on the
     * MCV opening — `creditOptionsFor` returns the full `CREDIT_OPTIONS` unless
     * `start === 'mcv'`, and `clampCreditsFor` is the identity otherwise. This
     * operation is `opening: 'base'`, so the band is `[2000, 5000, 10 000,
     * 20 000, 50 000]` and its bottom is **2 000**; `SkirmishSetup.ts`'s own
     * header says a base opening at 2000 credits is *"a hard opening, not an
     * impossible one"*. 5 000 is a MIDPOINT chosen for what it buys, and the
     * argument for it has to be made on those terms.
     *
     * IT IS ALSO NOT A DESCENT. The Pact chapter runs P1 4 000, P2 5 000,
     * P3 5 000 — a rise and then a plateau. The sentence read "what the Pact
     * chapter has been walking down" while listing the two figures ascending
     * beside it, which is a claim contradicted by its own parenthesis.
     *
     * What survives, and is the real reason for the number: it buys the player
     * six Solarchs with change and it slows the Reclamation opening for the
     * reason CLAUDE.md's measured block gives — a brain with a 10 000 bank
     * raises a seven-building base and eleven troops before it has mined a
     * single ore.
     */
    credits: 5_000,
  },
  layout: 'pact-concession',

  /*
   * NEITHER SHIPPED RULE MAY END THIS.
   *
   * `annihilationWin` would hand the player a victory for flattening the
   * Reclamation base while the plates were still on the wall 176.1 m away —
   * and, worse, one for a match in which every bearer had already been crushed,
   * since `Viability` counts assets and knows nothing about which four men this
   * operation is named after. `assetLossDefeat` is off for the reason
   * `allies.01.sounding-line` gives and it is the stronger of the two here: an
   * escort whose base is gone is an escort with nothing left to lose but the
   * column, which is the most interesting last act this mission has, and
   * `Shell.pollOutcome` would end it at 2 Hz instead. A commander down to four
   * bearers and a hundred metres of road can still finish this.
   */
  outcome: { annihilationWin: false, assetLossDefeat: false, ignoreSeats: [] },

  /*
   * EMPTY ON BOTH SIDES, AND THE PLAYER'S HALF IS THE LOAD-BEARING ONE.
   *
   * `unit.raider` is the Sandskiff — `cargoSlots: 2`, `Locomotor.Hover`, 9.2 m/s
   * — and two of them carry all four bearers home at two and a half times
   * walking pace, out of reach of everything this file is built around. That is
   * a real solution to a real escort and it deletes the operation, so it is
   * withheld. **`pact.01.shallow-road` GRANTED IT AND TAUGHT THE TRICK**
   * ("Put the Artificer in a Sandskiff; it holds two"), which is exactly why
   * this operation has to take it back rather than rely on nobody thinking of
   * it. An escort you can put in a box is not an escort; the chapter has
   * already sold that lesson once and is not selling it twice.
   *
   * `roster.ai` is empty because of the splash audit in the header. The one
   * Reclamation weapon that could take the whole column with a single round is
   * `slagMortar` at 5.8 m, and it rides `rclSlaghurler` behind
   * `unit.specialist`. It also keeps `rclPylon` (`struct.defence.specialist`,
   * `pylonArc` at 28 m) off the works, which would have out-ranged every gun the
   * Pact owns and turned the approach into P1's road again.
   *
   * **IT DOES NOT BUY "NO ROUND IN THIS MATCH KILLS MORE THAN ONE BEARER", AND
   * THAT IS WHAT THIS BLOCK USED TO CLAIM IT BOUGHT.** Every ungated
   * Reclamation gun on this road CHAINS — see the corrected audit in the
   * header — so the sentence was false with the allow-list on. What an
   * allow-list of nothing really buys is the SPLASH refusal and the Pylon
   * refusal, both real and both worth having; the chain is a property of the
   * ungated roster and no roster edit removes it.
   *
   * **THE BOX IS NOT COMPLETELY SHUT EITHER.** `mrdPharos` carries no
   * `UNLOCK_TAGS` row — the Command Posts are deliberately open, which is the
   * one place this allow-list's default INVERTS in the player's favour — so a
   * 1500-credit Pharos off the `mrdOculus` the opening already has puts
   * Chronoshift on the Powers tab, and `CommanderPowers.applyChronoshift` lifts
   * up to 8 friendly movers from within 40 m of the caster's base centroid onto
   * a marker. That is a way to skip the OUTBOUND leg and the five-minute window
   * with it. It cannot bring them home — the pickup circle is on the base, not
   * on the column — so it is a shortcut rather than a deletion, and it is left
   * in rather than closed: withholding a Command Post would be the first
   * campaign roster in the game to gate one.
   *
   * Both lists being empty is SYMMETRIC and profile-independent: the ground is
   * the same on a finished account as on a fresh one, which a deny-list could
   * not promise.
   */
  roster: { player: [], ai: [] },

  objectives: [
    { id: 'lift', kind: 'primary', title: 'Lift the count from the reading station' },
    { id: 'home', kind: 'primary', title: 'Carry the count home to the Conclave' },
    {
      /*
       * THE TITLE NAMES THE ACT, NOT THE ARRIVAL, AND THAT IS THE WHOLE FIX.
       *
       * It read "Reach the station before the crew cuts the plates" while
       * `t.window` guards on `not objectiveComplete 'lift'` — and the lift is
       * arrival PLUS a sixty-second hold, so the enforced bar was *arrive by
       * four minutes* and the advertised one was *arrive by five*. A player
       * standing on the station at 4:30 had done exactly what the sentence
       * asked and lost the credits at 5:00, mid-hold.
       *
       * `allies.01.sounding-line` is the shape that does not lie — it titles
       * the ACT, "Take the control reading inside five minutes" — and this is
       * that shape. Nael's line in `t.brief` is the other half and moved with
       * it. **NO DIGITS**: `tests/build-descriptions.spec.ts` §4 bans them in
       * `BUILD_DESCRIPTIONS` and does NOT reach objective titles, so nothing
       * would have failed if one were written here; the rule is honoured
       * anyway, because the minute count is `TORCH_WINDOW`'s to own and a
       * second copy in prose is the drift that whole section exists to refuse.
       */
      id: 'record',
      kind: 'secondary',
      title: 'Lift the count before the crew cuts the plates',
      credits: 500,
    },
    {
      id: 'hands',
      kind: 'secondary',
      hidden: true,
      title: 'Bring all four bearers home',
      credits: 400,
    },
  ],

  triggers: [
    /* -- the opening word -------------------------------------------------
     * Two beats ten seconds apart, because the shell renders dialogue as
     * toasts and three at once is a stack nobody reads. Calvane states the
     * premise and the order; Nael reads the ground and the clock. A player who
     * reads only the first still knows what to do, and a player who reads only
     * the second still knows what it costs.
     *
     * **AND THE MECHANISM IS THE OPPOSITE OF WHAT THAT SENTENCE ASSUMES, WHICH
     * COSTS THIS TRIGGER ITS FIRST LINE AND `t.brief` ITS WHOLE TACTICAL
     * BRIEF.** `Shell.playCampaignBeat` raises every dialogue line as
     * `toast('info', 'campaign-' + speaker, speaker, text)`, and
     * `ToastStack.push` COALESCES on that key inside `TOAST_MERGE` = 6.0 s: it
     * bumps `count`, **overwrites `detailNode` with the new text**, and returns.
     * The key is the speaker. So two lines from ONE speaker inside six seconds
     * are not a stack of two — they are one chip showing the SECOND text, with
     * the first destroyed and never rendered. Both beats below are two lines
     * from one speaker on ONE TICK, so both lose their opening sentence: the
     * operation's premise ("Survey 33-310…") and the twenty-metres-versus-
     * twenty-six brief. `t.lift` -> `t.record`, `t.lift` -> `t.short` and
     * `t.hands` -> `t.win` are the same collision one tick apart.
     *
     * **IT IS A SHELL DEFECT AND NOT THIS FILE'S INVENTION** — the same-speaker
     * adjacency is in most shipped operations — so the honest fix is either in
     * the shell (key the toast on something unique per line, or queue rather
     * than merge) or in an authoring rule that two consecutive lines must
     * change speaker or sit >6 s apart. **Neither is a comment's to make**, and
     * splitting these into four triggers here would fix one file and leave the
     * mechanism armed for the next. Recorded rather than worked around.
     *
     * The reveal is 64 m on the station, which shows the two posts (26.1 m out
     * each) and the breaker yard (32.6 m behind) in the same frame. The
     * player is meant to see the whole problem while they still have the match
     * to answer it.
     */
    {
      id: 't.open',
      when: { on: 'elapsed', ticks: seconds(4) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Calvane',
          text: 'Survey 33-310. The station on that shelf has read this seam since before the '
            + 'Works had a name. Nine days ago the Reclamation bought the ground under it and '
            + 'sent a crew with torches.',
        },
        {
          do: 'dialogue',
          speaker: 'Calvane',
          text: 'Four bearers. They take the plates off that wall in order and they walk them '
            + 'home. Everything else you own is there to see that they do.',
        },
        { do: 'revealArea', player: 0, area: { x: STATION.x, z: STATION.z, r: 64 } },
      ],
    },
    {
      id: 't.brief',
      when: { on: 'elapsed', ticks: seconds(14) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Nael',
          text: 'Two coil posts on the shelf and a breaker yard behind them. The posts reach '
            + 'twenty metres and our lance reaches twenty-six, so the hulls take them for '
            + 'nothing. The bearers cannot stand off anything at all.',
        },
        {
          do: 'dialogue',
          speaker: 'Nael',
          text: 'And they are cutting while we talk. Have those plates off that wall inside five '
            + 'minutes or what comes home is a shorter count than the one that went up.',
        },
      ],
    },

    /* -- the deadline, both directions -------------------------------------
     * The pair sits ABOVE everything that ends the match. `runDirector`
     * evaluates NOTHING on any tick after `state.outcome` is set — that is its
     * first line — and within one tick `Session.simTick` applies the effects in
     * the order the triggers are declared. So a completion written below the
     * win is applied after `endOperation` on the tick they coincide, and is
     * never evaluated at all on any later one.
     *
     * **THE TWO GUARDS NAME DIFFERENT OBJECTIVES AND THAT IS THE TIE-BREAK.**
     * `t.window` asks whether the LIFT is done, not whether the reward is
     * banked, because the reward lands a tick late: `t.lift` sits below both of
     * these, so `objectiveComplete 'lift'` first reads true on the tick AFTER
     * the hold finishes, and a `not objectiveComplete 'record'` guard would
     * therefore fire the failure on top of the congratulation on that one tick.
     * That is `allies.01.sounding-line`'s shape exactly — its own header names
     * it, *"without it a party mid-hold at minute five gets the failure line
     * and then the congratulation"* — and the objective would survive it,
     * because `Session.setObjective` refuses to un-resolve, while the DIALOGUE
     * would not.
     *
     * **THIS CITED `pact.01` AND `pact.01` CANNOT PRODUCE IT.** Its
     * `t.boreTaken` / `t.boreLost` pair is `structureCaptured` against
     * `entityDead`, i.e. `ownerOfTag(tag) === player` against
     * `aliveWithTag(tag) === 0`, and `ownerOfTag` returns -1 on an empty list —
     * so the two are mutually exclusive on every tick and no collision is
     * reachable. What pact.01 DOES document is the neighbouring lesson, and it
     * is the one worth carrying: its `not objectiveComplete 'bore'` guard is
     * *"on the DIALOGUE, not on the objective"*, because the effect list runs
     * whole even when the setter no-ops. Same rule, different collision; the
     * one-tick version belongs to allies.01.
     *
     * The residue is a single tick at the boundary: a hold that
     * finishes on the exact tick the window shuts resolves against the player,
     * one thirtieth of a second, and it resolves the same way every run.
     *
     * `t.record`'s own `not objectiveFailed` guard is the other half — without
     * it a lift completed at 5:01 would play the congratulation after the
     * failure line.
     */
    {
      id: 't.record',
      when: {
        on: 'all',
        of: [
          { on: 'objectiveComplete', id: 'lift' },
          { on: 'not', of: { on: 'objectiveFailed', id: 'record' } },
        ],
      },
      then: [
        { do: 'completeObjective', id: 'record' },
        {
          do: 'dialogue',
          speaker: 'Calvane',
          text: 'Ahead of the torches. Whole count, in order, nothing cut out of the middle of '
            + 'it. That is the difference between a record and an anecdote.',
        },
      ],
    },
    {
      id: 't.window',
      when: {
        on: 'all',
        of: [
          { on: 'elapsed', ticks: TORCH_WINDOW },
          { on: 'not', of: { on: 'objectiveComplete', id: 'lift' } },
        ],
      },
      then: [
        { do: 'failObjective', id: 'record' },
        {
          do: 'dialogue',
          speaker: 'Nael',
          text: 'Torches are through the top of the wall. Whatever we lift now starts in the '
            + 'wrong century. Take the rest anyway.',
        },
      ],
    },

    /* -- the bearers arrive, and the yard works out what they came for -----
     * THE FIRST CHECKPOINT, AND IT IS THE PLAYER WHO TRIPS IT. `setInvulnerable`
     * was cut with the instruction to buy an escort's opening grace by NOT
     * SPAWNING THE THREAT UNTIL THE FIRST CHECKPOINT, and this is that
     * checkpoint: no authored wave exists until two bearers are standing inside
     * 22 m of the station.
     *
     * The relief lands at `WORKS`, 86.6 m behind the station and 86.8 m off the
     * homeward corridor (this said 78.0, then 84.3/84.1; see the header — a
     * point beyond the END of a route cannot be nearer to it than its distance
     * to the endpoint, and the last move was the derrick's own 5.66 m toward
     * home), so it arrives from the far side while the column is still loading. Seven
     * hulls on the 3-at-16 and 4-at-24 rings, every point open on its own move
     * class — `spawnUnits` writes the ring point verbatim and
     * `tests/campaign-spawn-ground.spec.ts` re-derives all of them.
     *
     * Tallow's line reads "they have sent people, not hulls", and the trigger
     * tests nothing of the kind — it counts two tagged bearers inside a disc,
     * and the measured opening hands the player seven Solarchs and nine
     * Wayfarers, so it normally plays over a screen full of armour. It is a
     * yard foreman reading the four men who matter rather than a claim about
     * the board, which is defensible; it is written down because the next
     * reader will check it against the condition and find nothing there.
     *
     * Tallow speaks because the Reclamation's own chapter blurb is the argument
     * this operation loses: they are the ones who keep the only complete
     * account, and the moment they price the plates the Pact has already
     * conceded what they are.
     */
    {
      id: 't.reach',
      when: {
        on: 'unitsInArea',
        player: 0,
        area: { x: STATION.x, z: STATION.z, r: 22 },
        min: 2,
        tag: 'bearers',
      },
      then: [
        {
          do: 'dialogue',
          speaker: 'Tallow, on the yard net',
          text: 'Hold the torches. That is not a patrol — they have sent people, not hulls. '
            + 'Whatever is on that wall is worth more than the wall. Everything off the pad.',
        },
        {
          do: 'spawnUnits',
          player: 1,
          key: 'rclGrinder',
          count: 3,
          at: WORKS,
          spread: 16,
          tag: 'crew',
        },
        {
          do: 'spawnUnits',
          player: 1,
          key: 'rclPicker',
          count: 4,
          at: WORKS,
          spread: 24,
          tag: 'crew',
        },
        { do: 'orderTagged', tag: 'crew', order: 'attackMove', at: STATION },
      ],
    },

    /* -- the plates come off ----------------------------------------------
     * `elapsedSinceArmed` is a HOLD, not a delay: the director evaluates this
     * trigger twice, once with the timer forced true to decide whether the arm
     * tick stands. Two bearers stepping off the lot at fifty-nine seconds
     * restarts the whole minute, deliberately — the other way round hands the
     * player a lift for standing somewhere else, which is a failure in their
     * favour and the direction nobody reports.
     *
     * `min: 2` rather than 1 because two people take a plate off a wall, and
     * because a single survivor should not be able to finish the loading half
     * of the job — attrition has to cost something before the walk home.
     *
     * **AND `t.lost` IS THE COMPLEMENT OF 1 AND NOT OF 2, WHICH USED TO LEAVE A
     * STATE THE MATCH COULD NOT LEAVE.** `t.lift` needs TWO bearers standing;
     * `t.lost` needs `entityDead 'bearers'`, i.e. `aliveWithTag === 0`;
     * `outcome` turns both shipped rules off, so `Shell.pollOutcome` returns
     * immediately and `outcome.system.ts` returns on `scriptedRunning()`. With
     * exactly one bearer alive and the lift not yet taken, **no trigger in this
     * table could ever fire again** — the `lift` row sat on the panel as an
     * active objective that had become unreachable, `home` never resolved, and
     * the player's only exits were to walk the last man into a Grinder or quit.
     * `validateCampaign` could not see it: an authored win path and an authored
     * lose path both EXIST, and a vocabulary check cannot ask whether either is
     * still REACHABLE.
     *
     * Nothing recovers it. `mrdArtificer` is ungated and the opening holds a
     * Chapterhouse and a Cistern, so replacements are buildable — but
     * `TagRegistry` holds only what the layout stamped, and every condition
     * that reads the column passes `tag: 'bearers'`, so a newly built Artificer
     * is invisible to all of them.
     *
     * `allies.01.sounding-line` — cited three times in this file — does not
     * have this: its primary path is `min: 1` on both ends, so the win
     * threshold and the loss threshold are complements. **`t.stranded` BELOW IS
     * THE FIX**, and it keeps `min: 2` here rather than dropping to one: the
     * `min: 1` spelling also makes the thresholds complements and it gives up
     * the whole reason two is written above. Its own comment carries the
     * argument and the `ownerCount { min: 1, max: 1 }` tick-one guard.
     *
     * **THE DIALOGUE BELOW ALSO ASSUMES FOUR WHERE THE TRIGGER ASKS FOR TWO.**
     * Nael says "Four loads, in order, and nobody dropped one" and Calvane says
     * "All four of them come home" on a condition two survivors satisfy, and
     * `t.short` fires one tick later with "That is one bearer down" whenever
     * any of them did drop one. It is the same class of fault as the `record`
     * title — a string stating a bar the trigger does not test — and that one
     * WAS fixed, by naming the act instead of the arrival. This one is left,
     * and the difference is worth stating rather than assuming: `record`'s
     * title described a DIFFERENT EVENT from the one it was scored on, so a
     * player could satisfy the sentence and lose the credits. These two lines
     * are a foreman and a commander speaking about the column they can see —
     * Nael counts four because four is what walked out, and Calvane asks for
     * four home because that is the order he is giving — and neither is a
     * statement of a threshold. If it ever reads as one, the honest change is
     * to fire the pair off `t.hands`'s four rather than to reword them.
     */
    {
      id: 't.lift',
      when: {
        on: 'all',
        of: [
          {
            on: 'unitsInArea',
            player: 0,
            area: { x: STATION.x, z: STATION.z, r: 22 },
            min: 2,
            tag: 'bearers',
          },
          { on: 'elapsedSinceArmed', ticks: LIFT_HOLD },
        ],
      },
      then: [
        { do: 'completeObjective', id: 'lift' },
        {
          do: 'dialogue',
          speaker: 'Nael',
          text: 'Plates are off. Four loads, in order, and nobody dropped one.',
        },
        {
          do: 'dialogue',
          speaker: 'Calvane',
          text: 'Then walk. All four of them come home — the order they came off that wall in '
            + 'is half of what they are worth, and it is carried in four heads.',
        },
        { do: 'setObjective', id: 'hands' },
      ],
    },

    /* -- the road is cut ---------------------------------------------------
     * `elapsedSinceArmed` on a condition that never goes false again is a plain
     * delay off the lift, and 25 s is derived rather than felt. `CUT` is the
     * **41.9% point of the 281.4 m road by arc length** — 117.9 m of WALKING,
     * which is 106.5 m of straight line — so a column that leaves at once is on
     * it at **t+32.7 s** and a wave twenty-five seconds after the lift lands
     * 7.7 s in front of them rather than behind. The two distances are
     * different nouns and only the first one decides the timing. (45% / 132 m /
     * 110.2 m / t+37 s before the derrick came off the shelf doorway; `CUT`
     * itself did not move.)
     *
     * THE ONE `cameraMove` IN THIS FILE, AND THIS IS WHAT IT IS FOR. It takes
     * the camera off whatever the player was doing, which is the reason it is
     * not punctuation: the thing they have to look at is seven hulls landing
     * ON the road the column is walking, and the alternative is finding out by
     * losing a bearer to something they never saw arrive.
     *
     * `forcesUnderAttack` is fired A MOMENT BEFORE the contact rather than on
     * top of it, because `audio.system.ts` speaks it on any attack on player
     * units and scripting it at the point of contact would be the redundant
     * spelling the effect's own doc warns about.
     *
     * **"NOTHING HAS FIRED YET WHEN THIS PLAYS" IS NOT TRUE IN THE ORDINARY
     * CASE, AND THE COOLDOWN IS THE REASON NOBODY WOULD NOTICE.** By the time
     * this trigger can fire, `t.reach` has put three Grinders and four Scrap
     * Pickers 86.6 m from the station and attack-moved them at it — a ~15 s
     * approach at 5.8 m/s — the sixty-second lift has run with the column
     * inside 22 m of two live Spitposts, and another 25 s has passed. That is
     * eighty-five-odd seconds of fighting at the station in front of a line
     * whose organic path (`Damage.applyOne` -> `combat:underAttack`, throttled
     * at `UNDER_ATTACK_COOLDOWN` 20 s) will almost always have spoken inside
     * the previous 30, and `EVA_LINES.forcesUnderAttack.cooldown` is **30**, so
     * `Eva.say` drops the scripted copy without a word. It is the exact case
     * `types.ts` describes: *"only inaudible because `EVA_LINES` carries a
     * per-line cooldown that swallows the second copy."*
     *
     * It is harmless and it is not free — a line that is inaudible whenever the
     * fight went normally is a beat the author believes they wrote. The
     * alternative is `reinforcements`, which `types.ts` names as the one line
     * the announcer has no event for and which is what a scripted wave actually
     * is. **Changing the effect is a data change and not a comment's to make**;
     * recorded so the next pass does not re-derive the same audit.
     */
    {
      id: 't.cut',
      when: {
        on: 'all',
        of: [
          { on: 'objectiveComplete', id: 'lift' },
          { on: 'elapsedSinceArmed', ticks: CUT_DELAY },
        ],
      },
      then: [
        { do: 'eva', line: 'forcesUnderAttack' },
        {
          do: 'dialogue',
          speaker: 'Nael',
          text: 'They are ahead of us. Grinders on the road, a hundred metres back down it, '
            + 'and they are not chasing the column — they are standing in it.',
        },
        { do: 'cameraMove', at: CUT },
        {
          do: 'spawnUnits',
          player: 1,
          key: 'rclGrinder',
          count: 3,
          at: CUT,
          spread: 15,
          tag: 'cutoff',
        },
        {
          do: 'spawnUnits',
          player: 1,
          key: 'rclPicker',
          count: 4,
          at: CUT,
          spread: 22,
          tag: 'cutoff',
        },
        { do: 'orderTagged', tag: 'cutoff', order: 'attackMove', at: STATION },
      ],
    },

    /* -- a bearer goes down -----------------------------------------------
     * `ownerCount` with a tag walks the tag's own handle list rather than
     * `store.alive`, so this is four compares a tick and not a world scan.
     * `max: 3` is "fewer than four are still standing", which is exactly when
     * the hidden secondary stops being reachable.
     *
     * GATED ON THE LIFT so it cannot resolve an objective the player has not
     * been shown yet. `Session.setObjective` refuses to un-resolve, so failing
     * `hands` while it was still hidden would make the later reveal a no-op and
     * put a failed row on the panel for a bonus nobody ever mentioned.
     *
     * WHAT THE GATE ACTUALLY BUYS, MEASURED. The mechanism is right — without
     * it `hands` goes `hidden -> failed` and `t.lift`'s `setObjective` returns
     * early — but the gate does not give the player a live bonus row: `t.lift`
     * reveals `hands` on tick T and this trigger fails it on T+1, so a column
     * that already lost a man sees the row appear and turn red one thirtieth of
     * a second later. What is preserved is that Calvane's "All four of them
     * come home" plays FIRST, so the failure is legible as a failure of
     * something rather than as a red row nobody introduced. It also defers
     * Nael's line by the whole outbound walk plus the hold — a bearer lost at
     * t+10 s is narrated at the lift, seventy-odd seconds later — which is the
     * cost of the gate and is worth knowing before anybody "fixes" the delay.
     */
    {
      id: 't.short',
      when: {
        on: 'all',
        of: [
          { on: 'objectiveComplete', id: 'lift' },
          { on: 'ownerCount', player: 0, role: 'unit', tag: 'bearers', max: 3 },
        ],
      },
      then: [
        { do: 'failObjective', id: 'hands' },
        {
          do: 'dialogue',
          speaker: 'Nael',
          text: 'That is one bearer down and his share of the wall with him. Nobody left alive '
            + 'knows what order those plates go back in. Get the rest home.',
        },
      ],
    },

    /* -- the whole column, home -------------------------------------------
     * ABOVE `t.win`, which is the entire reason it is a separate trigger
     * rather than a second condition on the win: the two discs are the same
     * circle at two thresholds — four bearers here, one below — so a full
     * column satisfies both on the same tick, and the effects are applied in
     * declared order, so this completion lands before `endOperation` does.
     */
    {
      id: 't.hands',
      when: {
        on: 'all',
        of: [
          { on: 'objectiveComplete', id: 'lift' },
          { on: 'unitsInArea', player: 0, area: { x: HOME.x, z: HOME.z, r: 30 }, min: 4, tag: 'bearers' },
        ],
      },
      then: [
        { do: 'completeObjective', id: 'hands' },
        {
          do: 'dialogue',
          speaker: 'Calvane',
          text: 'Four out and four back. Log it that way — the count is worth exactly what the '
            + 'people who carried it can still swear to.',
        },
      ],
    },

    /* -- the column cannot lift any more -----------------------------------
     * **THE RUNG THAT USED TO HAVE NOTHING ON IT.** `t.lift` needs TWO bearers
     * standing and `t.lost` needs `aliveWithTag === 0`, so the two thresholds
     * were not complements: at exactly one live bearer with the plates still on
     * the wall, `t.lift` could never fire again and `t.lost` could not fire
     * yet. Both shipped outcome rules are off in `outcome`, so `Shell.pollOutcome`
     * returns immediately and `outcome.system.ts` returns on `scriptedRunning()`
     * — **no trigger in this table could end the match**, and the `lift` row sat
     * on the panel as an active objective that had become unreachable. The only
     * exits were to walk the last man into a Grinder or to quit.
     *
     * `validateCampaign` cannot see it and no gate in the suite can: an
     * authored win path and an authored lose path both EXIST, and neither of
     * them is REACHABLE from that state. A vocabulary check cannot ask about
     * reachability.
     *
     * **WHY THIS SHAPE RATHER THAN `t.lift` AT `min: 1`.** Dropping the lift to
     * one survivor also makes the thresholds complements and is one character
     * shorter, and it gives up the whole reason `BEARERS` is four: two people
     * take a plate off a wall in order, and a lone survivor finishing the
     * loading half of the job is the outcome the layout's constant is argued
     * against. Losing instead keeps the ladder — first loss costs the hidden
     * bonus, second leaves the column on exactly the lifting minimum, third
     * ends it if the plates are still up, fourth ends it whatever happened —
     * and it costs one trigger inside the frozen 12/3/11 vocabulary rather than
     * a new condition.
     *
     * **`min: 1` IS NOT DECORATION AND IT IS THE HALF THAT COULD SHIP BROKEN.**
     * `ownerCount` with a `max` and no `min` reads TRUE at zero, which is
     * `entityDead`'s trap in a different condition: the layout stamps `bearers`
     * during `buildScenario`, but a bare `max: 1` is a bet on that ordering and
     * would fail the player on tick one the day it changed. `min: 1, max: 1` is
     * EXACTLY ONE ALIVE and is false at zero by construction — which also makes
     * it disjoint from `t.lost` on every tick, so the two losses can never
     * collide and their declared order carries no weight.
     *
     * IT CANNOT COLLIDE WITH `t.lift` EITHER. That trigger needs two bearers
     * inside the disc on the same tick, which is two alive, and this one needs
     * exactly one; `runDirector` evaluates every trigger against the state at
     * the START of the tick, so there is no ordering in which both hold.
     *
     * GATED ON THE LIFT, not on `home`, because one bearer AFTER the lift is a
     * winnable position — `t.win` asks for `min: 1` in the home disc — and
     * failing it there would take a match the player can still finish.
     */
    {
      id: 't.stranded',
      when: {
        on: 'all',
        of: [
          { on: 'not', of: { on: 'objectiveComplete', id: 'lift' } },
          { on: 'ownerCount', player: 0, role: 'unit', tag: 'bearers', min: 1, max: 1 },
        ],
      },
      then: [
        { do: 'failObjective', id: 'lift' },
        {
          do: 'dialogue',
          speaker: 'Calvane',
          text: 'One bearer left and the wall still loaded. It takes two of them to take a '
            + 'plate down in order and there is nobody left to hand it to. Whatever is on that '
            + 'shelf stays on it, and the yard will read it for us.',
        },
        { do: 'endOperation', result: 'loss', reason: 'lift' },
      ],
    },

    /* -- the loss ---------------------------------------------------------
     * ABOVE THE WIN, because trigger order decides which of two outcomes on one
     * tick the end screen reports and the author is meant to mean it. The only
     * other thing that ends this operation is `t.stranded` directly above, and
     * the two are disjoint by construction rather than by ordering — this one
     * is zero bearers, that one is exactly one. `playerBeaten` is deliberately
     * not a loss here for `allies.01.sounding-line`'s reason, and the shipped
     * rule that would disagree is switched off in `outcome`.
     */
    {
      id: 't.lost',
      when: { on: 'entityDead', tag: 'bearers' },
      then: [
        { do: 'failObjective', id: 'home' },
        {
          do: 'dialogue',
          speaker: 'Calvane',
          text: 'That is all four. The plates are lying on that road and the yard will have '
            + 'them weighed by morning. We did not lose an argument today — we sold one.',
        },
        { do: 'endOperation', result: 'loss', reason: 'home' },
      ],
    },

    /* -- the win ----------------------------------------------------------- */
    {
      id: 't.win',
      when: {
        on: 'all',
        of: [
          { on: 'objectiveComplete', id: 'lift' },
          { on: 'unitsInArea', player: 0, area: { x: HOME.x, z: HOME.z, r: 30 }, min: 1, tag: 'bearers' },
        ],
      },
      then: [
        { do: 'completeObjective', id: 'home' },
        {
          do: 'dialogue',
          speaker: 'Calvane',
          text: 'The count is inside the Conclave and the crust has not moved a metre. Note '
            + 'what it cost. We carried a record we would not put a price on across ground '
            + 'somebody else had already bought — and the moment a thing can be lifted it has '
            + 'a price. We have just told them ours.',
        },
        { do: 'endOperation', result: 'win' },
      ],
    },
  ],
};

export default op;
