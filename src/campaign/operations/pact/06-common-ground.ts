/**
 * ============================================================================
 * P6 — COMMON GROUND
 * ============================================================================
 * P1 took an Allied instrument off Pact crust. P2 kept a Soviet blast off a Pact
 * reading post. P3 carried four hundred years of plates through somebody else's
 * concession. P4 sank a cut in Pact crust and handed the Allies the instrument
 * over it. P5 took the Conclave's own Oculus and read the count out of it in the
 * open, and `allies.07.fair-copy` records what that bought: a four-hundred-year
 * series the Allies' own Field Marshal says *"agrees with mine to the fourth
 * decimal and it is four hundred years longer"*.
 *
 * **A CORROBORATED COUNT THAT NOBODY HAS ACTED ON IS STILL A RUMOUR WITH
 * DECIMALS.** Aubray said the last word of P5 on an open channel — *"The
 * Timetable was drawn against the wrong crust. I will not enjoy saying that out
 * loud, and I am going to say it out loud."* This is her saying it. The
 * Continental Works will re-site a schedule the whole continent is built from
 * only against a SECTION — the count, and the ground it was taken from, open,
 * with anybody who wants to look standing in it. So the sitting is held on the
 * crust rather than in a hall.
 *
 * **AND THE CONCLAVE SOLD THE CUT ELEVEN DAYS AGO.** P5 established that the
 * Order will refuse its own people before it refuses an outsider; this is that
 * sentence with a price on it. Rather than let the ground be read in the open,
 * the Conclave sold a cutting licence over it to the salvage house, in writing,
 * and Tallow's crews have had a sorter, a furnace and a heap working the section
 * since. He is not defending it. He says so at thirty seconds, in clear: he
 * cannot use a hearing and he cannot use a broken chain, so his whole play is to
 * spend the Order's minutes until Aubray notes that the ground was disputed and
 * comes back in a year.
 *
 * **WHAT THE HINGE COSTS, ON THE GROUND.** A schedule the Works enter is a
 * schedule anybody may check, and a section anybody may check is a section
 * anybody may cut. The amendment carries that condition and Calvane signs it.
 * At the end of this operation the reading is everybody's, the crust it was
 * taken from is nobody's, and the two families whose houses stand thirty metres
 * from the cut were not asked. **That is where 07 opens.**
 *
 * ============================================================================
 * WHY `primaryType: 'race'`, AND WHAT TERM IT MOVES THAT THE OTHER TWO DO NOT
 * ============================================================================
 * `allies.03.ground-truth` and `soviets.03.deep-sector` are the other two, and
 * each of them changes exactly one term of the same shape:
 *
 *     A3   the deadline is fixed and unbuyable; the PLACE moves — three change
 *          points, each open for a window, and arriving inside one ends it.
 *     S3   the place is fixed; the CLOCK can be bought — take the tap, or break
 *          the masts and minute nine becomes minute fifteen.
 *     P6   neither moves. **The deadline is an APPOINTMENT rather than a fuse,
 *          and the win is a STATE OF THE GROUND at an hour fixed before the
 *          player touched anything.**
 *
 * A3's race is to ARRIVE and S3's is to FINISH; this one is to still BE THERE.
 * `PRESENTED` is a conjunction over one instant — the crew's plant off the
 * section AND four of the Order's own standing in the cut AND the thirteenth
 * minute past — so **being early banks the assault and banks nothing else**.
 * Nael says that out loud in `t.brief`, because `ObjectiveRow` is
 * `{ id, title, kind, status }` and a title is the only sentence a player gets.
 *
 * **FOUR OTHER TYPES WERE COSTED AND REJECTED. Overturn one by rewriting it.**
 *
 *   - **`landing`.** `allies.09.made-good` owns it and its header states the
 *     geometry: `MAP_SEAS.coast` and `.tropical` are HALF-PLANES, so the only
 *     ground in the game on the far side of water is `MAP_PRESETS.atoll`. A
 *     second landing is the same map twice.
 *   - **`economy`.** Three exist — `reclamation.02.written-off`,
 *     `soviets.09.nil-return`, `allies.08.standing-order` — and
 *     `allies.06.machine-time` cut a fourth in writing as *"a third `credits`
 *     threshold wearing a hat"*. The price here is ground, not a figure, and
 *     `credits` cannot express ground.
 *   - **`fixed-force`.** A delegation with no base is the obvious reading of
 *     "go and be believed", and `allies.07.fair-copy` — the operation this one
 *     touches — is already a fixed force lodging a document. Two chapters
 *     meeting on one premise should not also meet on one mechanism.
 *   - **A SECOND MIRROR MATCH.** P5 is the campaign's only Pact-against-Pact
 *     fight and its header explains what that costs: the counter-triangle does
 *     no work, so the whole fight is decided by ground. Twice in a row is a
 *     chapter with no matchups left.
 *
 * ============================================================================
 * THE TWO METRES OF PACT DOCTRINE ARE WORTH 0.838 m HERE — UNDER AN EXPLICIT
 * ATTACK ORDER, AND UNDER NOTHING ELSE
 * ============================================================================
 * *"The Pact main line. Outranges, never brawls."* — `mrdSolarch`'s shipped
 * blurb. Against the salvage house that is not a preference, it is the entire
 * matchup, because every gun the crew owns is short: `grinderArc` 18 m,
 * `spitCoil` 16, `arcProd` 14, `slagCharge` 12, `postCoil` 20, against
 * `focusLance`'s 26.
 *
 * `Targeting.approach` stops an attacker at `range * APPROACH_STOP_FRAC` (0.80)
 * of SURFACE distance, and `Combat.engage` gates firing on the same quantity
 * (`surfaceDist = max(0, flat - hitRadius(...))`). Both read off the built
 * world rather than derived from a footprint table:
 *
 *     mrdSolarch radius 2.7900   rclSpitpost footprint 1x1, hitRadius 2.8284
 *     a Solarch ORDERED TO ATTACK a post parks at 20.80 + 2.8284 = 23.628 m
 *     a post fires out to                        20.00 + 2.7900 = 22.790 m
 *     ------------------------------------------------------------------
 *     clearance                                            0.838 m
 *
 * **AND `approach` IS NEVER REACHED ON ATTACK-MOVE.** This block said "a Solarch
 * on attack-move parks at 23.628 m" and the arithmetic was right about the wrong
 * order. `Targeting.managesGoal` returns false unless the state is `Attacking`
 * or `Guarding`, and BOTH `approach()` and `holdPost()` early-return on that
 * test; `UnitState.Attacking` is assigned in exactly one place in the tree —
 * `input/Commands.ts`, under `OrderKind.Attack` / `ForceAttack`.
 * `OrderKind.AttackMove` writes `UnitState.AttackMoving`, which nothing in
 * `Targeting` owns, so an attack-moving Solarch shoots what it acquires and
 * DRIVES ON at its ordered goal. **The stand-off is a property of the
 * right-click, not of the hull.**
 *
 * Both halves measured on the built world — Dijkstra over the real
 * `FlowFieldCache.costGridFor(Hover)` under the engine's own expander rules,
 * started from the four `mrdSolarch` the layout actually spawns at
 * (143.2, 373.4), (143.4, 365.3), (144.2, 389.9) and (144.5, 382.5):
 *
 * **THOSE FOUR COORDINATES MOVED 27.00 m ALONG +x AND THE ROUTE FIGURES BELOW
 * HAVE NOT BEEN RE-MEASURED.** `bb83ffb` moved `buildAlliedGarrison`'s armour
 * anchor from `toWorld(cx, cz, -2, -9, ...)` to `toWorld(cx, cz, -2, -36, ...)`.
 * This map is the clean case for reading that: seat 0's `facingDeg` is exactly
 * 90, so the base facing is exactly 270 and cardinalisation is a no-op, leaving
 * the local `dz` change as the only variable — every z above matches to 0.1 m
 * and every x is short by exactly 27.00. The formation's internal jitter is
 * unchanged. Everything downstream of these four points is anchored 27 m nearer
 * the enemy than it was, so re-take the routes together with the exposure
 * metres rather than nudging either:
 *
 *   - **ATTACK-MOVE TO THE CUT.** Route 202.2..208.3 m, of which **45.7 m lies
 *     inside a post's 22.790 m envelope** and 41.7 m of that inside BOTH — the
 *     same 45.7 and 41.7 for every one of the four. At 7.6 m/s that is 6.01 s
 *     under post B and 5.49 under post A, and `postCoil` is 30.40 dps into
 *     Light, so the crossing is worth **349.6 damage of gun output**: enough to
 *     kill a 330 hp hull outright if it all lands on one, 87.4 each if it
 *     spreads across four.
 *   - **AN EXPLICIT ATTACK ORDER ON A POST.** 36 open cells lie inside the
 *     Solarch's own 28.828 m firing envelope of post A, at or beyond the
 *     23.628 m park distance, AND outside post B's 22.790 m reach; 33 for post
 *     B with post A alive. The cheapest is **146.2 m of walked path from the
 *     opening garrison, against 202.2..208.3 m to the cut itself, with 0.0 m of
 *     that route inside either envelope.**
 *
 * **So the free exchange is real and it is one the player has to ASK FOR**, and
 * `t.first` says so in clear rather than leaving it to doctrine — `ObjectiveRow`
 * is `{ id, title, kind, status }` and a briefing beat is the only place a
 * mechanism can be stated. A `postCoil` range of 21 closes the 0.838 m and this
 * whole paragraph stops being true; it is the first number to re-check after any
 * retune of that row.
 *
 * The men do not get the deal at all. A `mrdWayfarer` ordered onto a post parks
 * at 16.00 + 2.8284 = 18.828 m and the post reaches 20.00 + 0.234 = 20.234, so
 * **a rifleman that stops to shoot a post is 1.406 m inside it** — three pulls
 * of 43.52 against 110 hp, dead at 1.70 s. An `mrdArtificer` at 95 hp dies on
 * the same third pull.
 *
 * The armoury, by the convention `Defs.ts` uses —
 * `cycle = burstCount > 1 ? (burstCount-1)*burstDelay + cooldown : cooldown`,
 * `raw = burstCount * damage / cycle`, then `ARMOR_MATRIX` and
 * `COMBAT_DAMAGE.globalMul` 0.80. **RE-DERIVE, DO NOT RE-QUOTE.**
 *
 *                       raw     vs Infantry   vs Light   vs Medium   vs Concrete
 *     focusLance      37.500      10.50        25.50       30.00        16.50
 *     pulseCarbine    46.875      37.50        20.63       10.50         6.75
 *     grinderArc      36.842      47.16        28.00       25.05        17.68
 *     postCoil        40.000      51.20        30.40       27.20        19.20
 *     arcProd         24.762      31.70        18.82       16.84        11.89
 *     slagCharge      27.407      19.73        17.54       14.25        21.93
 *
 * Two consequences the fight is made of. A Solarch takes a Grinder at 30.00 dps
 * (270 hp, 9.0 s) while the Grinder answers at 28.00 (330 hp, 11.8 s) — an even
 * trade at contact and a free one at twenty-six metres. And the Slagger is the
 * only thing in the crew's army built to break a wall: 21.93 into Concrete
 * against the Grinder's 17.68, on a hull that walks at 3.0 m/s. That is why
 * waves C and D carry them and why they arrive last.
 *
 * ============================================================================
 * THE PLANT: WHAT IT COSTS TO LEVEL, AND WHAT IT COSTS TO TAKE
 * ============================================================================
 * Three structures, 2 750 hp of `ArmorClass.Concrete`, read off the built world:
 *
 *     rclSorter    1 250 hp   288, 318    14.56 m from the cut
 *     rclFurnace     950 hp   276, 304    18.11 m from the cut
 *     rclHeap        550 hp   334, 346    64.62 m — out on the haul road
 *
 * **EVERY NUMBER BELOW RUNS THROUGH THE CREW'S REPAIR DRIP.**
 * `AiBrain.repairBase` walks every building the seat owns, arms at
 * `AI_REPAIR.startFraction` 0.75, needs `AI_REPAIR.minCredits` 400 against a
 * 5 000 opening bank, runs on `AI_CADENCE.build` 15 ticks, and `REPAIR_RATE` is
 * a flat **30 hp/s** at `REPAIR_COST_PER_HP` 0.25 — 7.5 credits a second, which
 * the crew can pay all day. `AI_SKILL[].maxRepairs` is >= 1 at every rung, so
 * the structure under fire is always being mended; Easy mends one at a time and
 * Brutal up to eight.
 *
 *   - **SHELLING IT.** One Solarch delivers 16.50 dps into Concrete against a
 *     30 hp/s drip and therefore **loses**, at −13.50. Two are +3.00, three are
 *     +19.50, four are +36.00. The opening garrison is `mrdSolarch` x4 and
 *     `mrdWayfarer` x5 — counted on the built world, not assumed — which is
 *     66.00 + 33.75 = **99.75 gross** and **69.75 net** — and the drip only arms
 *     BELOW `startFraction` 0.75, so every structure is two phases:
 *
 *         rclSorter  1 250 hp   3.13 s to the arm threshold + 13.44 under it = 16.6 s
 *         rclFurnace   950      2.38 + 10.22 = 12.6
 *         rclHeap      550      1.38 +  5.91 =  7.3
 *         rclSpitpost  520      1.97 + 10.83 = 12.8   (four Solarchs alone, 66.00)
 *
 *     36.5 s of fire for the three of the plant, plus 64.2 m of walking out to
 *     the heap. `AI_SKILL[].maxRepairs` is a CONCURRENCY cap rather than a
 *     switch, so on Easy only the structure under fire is mended and on Brutal
 *     up to eight are; the rows above are the one under fire.
 *   - **TAKING IT.** `Capture.resolve` softens an enemy structure by
 *     `CAPTURE.softenFrac` 0.25 through `ARMOR_MATRIX[HighExplosive][Concrete]`
 *     1.00 and `globalMul` 0.80 = **0.20 of max per engineer**, against a
 *     `CAPTURE.captureHpFrac` gate of 0.50. Both are fractions of max, so
 *     `maxHp` cancels and the count is four for anything in the game. The player
 *     opens with ONE `mrdArtificer` (`FACTION_KEY_MAP` remaps
 *     `buildAlliedGarrison`'s `engineer` on a Meridian seat), so three more is
 *     1 500 credits of a 5 000 bank and 30 s of one Chapterhouse queue.
 *
 *     **AND THE DRIP DECIDES WHETHER FOUR IS ENOUGH.** Break-even for ONE
 *     engineer is `0.20 * maxHp / 30`:
 *
 *         rclSorter 1 250 hp   8.33 s        rclFurnace 950 hp   6.33 s
 *         rclHeap     550 hp   3.67 s        rclSpotter 700 hp   4.67 s
 *
 *     `mrdArtificer` is a 10 s build and `BuildQueue.advanceTab` only ever
 *     advances `items[0]`, so three ordered at once finish 10 s apart and, walked
 *     241.2 m at 3.6 m/s — 67.0 s, and see the fork below for where that number
 *     comes from — ARRIVE 10 s apart. **Every one of those deliveries is
 *     negative progress on every structure here.** Gather them and walk them in
 *     as one group. `pact.05.open-count` found the same trap against a 650 hp
 *     archive; the constant is different and the arithmetic is not.
 *
 * ============================================================================
 * THE ENGINEER FORK — TRAP 20, AND IT DECIDES THE CAPTURE
 * ============================================================================
 * A produced Artificer does not start where the player put anything. `tryEgress`
 * rotates the Chapterhouse's own `exitX`/`exitZ` (0, 7) into world space at the
 * building's yaw and hands the point to `findEgressSpot`, whose ring 0 accepts
 * it: **(89, 359.999 999 694)** on this build — three ten-millionths of a metre
 * inside cell z 89 rather than z 90, which is worth writing down because reading
 * it as a round 360 moves the route by 5.4 m. From there the cheapest foot route
 * to the sorter — Dijkstra over the real
 * `FlowFieldCache.costGridFor(Foot)`, same expander rules as everything else in
 * this file — is 241.2 m, and **41.7 m of it lies inside a post's 20.234 m
 * envelope**, 37.7 m of that inside both. At 3.6 m/s that is 11.58 s under
 * `postCoil`'s 51.20 dps into Infantry: **593.1 damage against a 95 hp hull, six
 * times over**, from post B alone and before either post has been touched.
 *
 * **THE ROUTE FORKS ON THE START, AND THE FORK IS A CELL BOUNDARY AT z = 364.**
 * Twelve starts swept, same goal, same grid; every one at z <= 360 is exposed
 * and every one at z >= 366 is not:
 *
 *     (89, ~360)  the Chapterhouse door      241.2 m   41.7 m exposed
 *     (101, 354)  an opening Wayfarer        221.0 m   41.7 m exposed
 *     (96, 352)                              226.4 m   41.7 m exposed
 *     (96, 368)                              226.4 m    0.0 m exposed
 *     (101, 370)  the OPENING Artificer      224.8 m    0.0 m exposed
 *     (110, 374)  the Conclave's own cell    216.6 m    0.0 m exposed
 *
 * So **the one Artificer the player is GIVEN reaches the sorter untouched and
 * the three they BUY do not**, and nothing on screen distinguishes the two. The
 * free side costs 9.4 m of detour and nothing steers anybody onto it —
 * `NavAssigner` takes the cheapest route, and the cheapest route from the door
 * goes through the picket. **Either the picket falls first, or the engineers are
 * walked in two legs.** The operation does not require the capture, which is
 * what keeps this a decision rather than a trap: levelling the plant with the
 * opening garrison meets the same primary and pays the same objective.
 *
 * **THE SORTER IS THE ONE WORTH TAKING RATHER THAN LEVELLING**, and that is the
 * decision this operation hands the player rather than an instruction: it is a
 * REFINERY, it stands 14.56 m from the cut, and the contested ore patch is
 * 38.73 m of edge away — so a captured sorter is a second unloading point on the
 * ground the player has to hold anyway. It arrives at or under half health,
 * because `Capture.resolve` writes `st.hp` on its FRIENDLY branch only: **at
 * most 625 of 1 250**, and the drip that was mending it is now the player's own
 * wrench at 0.25 cr/hp.
 *
 * ============================================================================
 * THE PICKET COVERS THE APPROACH — MEASURED BY EXCLUSION, PER LOCOMOTOR
 * ============================================================================
 * Two `rclSpitpost` at (246, 326) and (250, 310), 28.28 and 26.83 m from the
 * cut. A claim that they "cover the approach" measured on one reconstructed path
 * would be worth nothing — `soviets.08.carriage-forward` published exactly that
 * and it was false by 20 m. The instrument is an **exclusion control**: re-cost
 * the cheapest route with every cell whose CENTRE lies inside the gun's envelope
 * AGAINST THAT MOVER made impassable, and read the delta.
 *
 * **THE ENVELOPE IS PER-MOVER AND SO IS THE ANSWER, WHICH IS WHY ONE NUMBER IS
 * NOT ENOUGH.** This block published a single `218.2 -> 252.0 (+33.8)` and left
 * the class it belonged to unsaid. Re-measured from where the units really are —
 * the four `mrdSolarch` and the five `mrdWayfarer` the layout spawns, never a
 * yard centre:
 *
 *     Hover  envelope 22.790   146 cells   202.2..208.3 -> 236.0..242.1   +33.8
 *     Foot   envelope 20.234   122 cells   195.2..206.0 -> 224.2..235.0   +29.0
 *
 * The delta is **identical for every one of the four hulls and every one of the
 * five men**, so it is a property of the ground rather than of a start. A route
 * that lengthens by a sixth when two guns are switched off is a route those two
 * guns are on, and it is on for the infantry too.
 *
 * **THE ANCHOR IS THE WHOLE MEASUREMENT, AND A YARD CENTRE IS THE WRONG ONE.**
 * Run from the cell `snapToReachable` returns for the Conclave's own centre —
 * (110, 374), where nothing stands — the Foot delta reads **+10.8** and the
 * picket looks like a third of the obstacle it is. That cell is on the far side
 * of a fork in the foot grid at z ~= 364, which is the same fork that decides
 * whether an engineer walks into the picket; see THE ENGINEER FORK above.
 *
 * **What is NOT claimed** is that they command the cut itself: of the 126 open
 * cells inside the 26 m standing disc, **47 are inside a post's reach and 79 are
 * not**, so a player can put four hulls in the eastern lee of the cut with both
 * posts alive. They are a picket, not a wall — but "a speed bump rather than a
 * fight" is a statement about hovering armour under an explicit attack order and
 * about nothing else. The five `mrdWayfarer` walking to the cut on the cheapest
 * foot route spend **41.7 m inside 20.234 m** of a post, which at 3.6 m/s is
 * 11.58 s under 51.20 dps — 593.1 damage against 110 hp apiece. To the infantry
 * and to anything attack-moving past them the picket is a fight, and the two
 * blocks above are what say so.
 *
 * ============================================================================
 * THE TENANTS' ROW, AND WHY IT NEEDS NO `captureProof`
 * ============================================================================
 * Two `civApartments` on **seat 0** — 800 hp each, `power: 0`, 2x3 — at
 * (270, 352) and (290, 296), 30.27 and 30.53 m from the cut. They are the people
 * the concession displaces, they are the only thing on this map that 07 inherits
 * directly, and they are the player's own so that they can be LOST: a Gaia block
 * is allied to everybody and `Targeting.isValidTarget` refuses ALLIES, so a
 * neutral row is a secondary that cannot fail, which `pact.05.open-count` calls
 * decoration in its own words.
 *
 * **THE THREAT IS REAL AND IT IS PRICED.** The near block sits **16.99 m** off
 * the straight line from the crew's forming-up road to the cut and the far one
 * **30.53 m**, against a Grinder's 26 m sight and 18 m reach. Three Grinders
 * deliver 53.05 dps into Concrete and level 800 hp in **15.1 s**; four do it in
 * 11.3. The player's own wrench is 30 hp/s and therefore **loses to three
 * Grinders**, so the row is defended by meeting the column, not by mending under
 * it. It is also not sellable — `Scenarios.civilian` clears
 * `EntityFlag.Sellable` and the built world agrees — so it cannot be cashed in
 * either.
 *
 * **AND TRAP 9 IS CLOSED BY CONSTRUCTION RATHER THAN BY A FIELD.** Three
 * separate routes to a captured protect-target, all shut:
 * `Capture.resolve` takes its FRIENDLY branch for a structure the engineer's own
 * player owns, `src/sim/AI.ts` contains the string `Capture` **zero times**, and
 * `GarrisonService.refusalFor` answers `'hostile'` for a building whose owner is
 * not allied to the entrant — so the crew cannot flip the deed by walking a
 * picker into a tenement the way `allies.07.fair-copy` prices for its own relay
 * blocks. A `captureProof` here would forbid a play no seat can make, which is
 * the well-spelled no-op `validate.ts` refuses elsewhere. `t.rowLost` reads
 * `ownerCount(0, 'building', 'row', max: 1)` anyway, which is capture-aware in
 * the direction that matters: a tenement the player no longer holds is a
 * tenement lost, whatever is standing.
 *
 * Both blocks are OUTSIDE the 26 m standing disc, and that was checked for a
 * reason: a garrisoned man is still a unit at his host's position, and a
 * strongpoint inside the disc would let the primary be answered by five
 * riflemen sitting in somebody's front room.
 *
 * ============================================================================
 * WHAT THIS FILE DOES NOT CLAIM
 * ============================================================================
 *   - **KILLING THE PLANT FURNACE DOES NOT BLACK THE CREW OUT.** Measured on the
 *     built world, seat 1 is produced 400 / consumed 250, and without the plant's
 *     `rclFurnace` it is 320 / 250 — still positive. And `rclSpitpost` is
 *     `power: 0` with a shipped blurb reading *"Fires through a blackout"*, so a
 *     real deficit would not silence the picket either. The furnace is 950 hp of
 *     demolition and nothing else.
 *   - **`STANDING` COUNTS A HARVESTER.** `runtime.ts#unitsInArea` filters owner,
 *     `IS_UNIT` and `PendingDestroy` and asks nothing about the kind, and a
 *     `mrdCollector` is a Vehicle. No harvester reaches the disc by accident —
 *     the nearest ore EDGE is 38.73 m from the cut's centre against a 26 m disc,
 *     and the home-to-contested haul runs along z 380, fifty-eight metres off it
 *     — but a player who deliberately parks four Collectors in the cut has
 *     answered the primary. There is no condition in the frozen vocabulary that
 *     can ask what kind of unit is standing somewhere, so it is priced rather
 *     than closed: it costs them their economy for as long as it takes.
 *   - **THE COLUMN ORDERS ARE HEADINGS, NOT LEASHES.** `AI_CADENCE.squad` is
 *     `round(30 / 5)` = 6 ticks and `AiBrain.regroupSquads` re-files every
 *     ungrouped hull into the strike group on its next pass. The waves tend to
 *     arrive because the cut is between the two openings. **Do not build a timing
 *     argument on an order an AI seat holds.**
 *   - **THE THREE PICKERS AT THE OFFICE ARE AN OPENING PICTURE.** Same
 *     mechanism: `AiBrain.census` files them into `armyIds` within six ticks and
 *     they march off. `soviets.02.common-standard` hung a secondary on two hulls
 *     that were 116.6 and 129.2 m from their post by t+20 s; nothing here does.
 *
 * ============================================================================
 * THE ROSTER, MEASURED
 * ============================================================================
 * `{ player: [], ai: [] }` is an ALLOW-LIST, so it withholds every tagged def
 * from both seats. Built twice at these seeds with the def tables BOUND, once
 * with `setCampaignRoster` installed and once without — which is
 * `tests/campaign-roster-ground.spec.ts`'s build and NOT
 * `tests/campaign-maps.spec.ts`'s, whose `buildOperation` passes no `defs` and
 * installs no roster, so every refusal here is inert there:
 *
 *     243 entities alive without the roster, 235 with it
 *     seat 0   mrdReliquary x1   mrdHelios x1   mrdSkiff x2
 *     seat 1   rclCrucible  x1   rclPylon  x1   rclSpitter x2
 *
 * **`rclPylon` IS THE ONE THAT MATTERS AND IT IS THE ONE THIS OPERATION CANNOT
 * SURVIVE.** An Arc Pylon is 28 m of `pylonArc` — **two metres more than the
 * Solarch's 26** — so a single one anywhere near the cut deletes the entire
 * doctrine argument above, and its first chain link is 120.32 against a
 * `mrdWayfarer`'s 110 hp and an `mrdArtificer`'s 95. Deleting either empty list
 * puts one on the crew's opening. `mrdHelios` comes off the player's side for the
 * mirror of the same reason, which is what makes the pair symmetric rather than
 * a handicap.
 *
 * ============================================================================
 * NEITHER SHIPPED OUTCOME RULE MAY END THIS
 * ============================================================================
 * `annihilationWin` would hand the player a victory for flattening the salvage
 * house at minute six with no sitting held and nobody standing in the cut — the
 * count would be exactly as unpublished as it was at t = 0. `assetLossDefeat` is
 * off for `pact.01.shallow-road`'s reason: the player opens with a full base and
 * cannot plausibly reach zero assets before `t.beaten` reads, and
 * `Shell.pollOutcome` asking at 2 Hz would take the match away from a commander
 * who still has a Chapterhouse and four hulls in the cut.
 *
 * The authored ordinary loss is `playerBeaten`, which is `Viability.isBeaten` —
 * nothing to build with and nothing to fight with — and the authored hard loss is
 * the eighteenth minute, which is `parSec` to the second. It is TWO triggers,
 * `t.risePlant` and `t.riseStand`, partitioned on `PLANT_OFF`, because the two
 * ways to arrive there are different failures and a single line of narration was
 * measurably false of the commoner one. See the block above them.
 *
 * ============================================================================
 * THE PAR
 * ============================================================================
 * `parSec` 1 080 IS the deadline rather than a description of one, which is the
 * only way that field is falsifiable from inside the operation.
 * `soviets.06.demolition-order` makes the same identification. The chapter ramp
 * is 780 / 840 / 900 / 960 / 1 020 / 1 080, which
 * `tests/campaign-length.spec.ts` checks for monotonicity.
 *
 *     home -> the cut, hover        202.2..208.3 m at 7.6    26.6..27.4 s
 *     two Spitposts, four Solarchs  12.8 s each                  25.6 s
 *     the plant, the garrison whole 16.6 + 12.6 + 7.3            36.5 s
 *     the cut -> the heap           64.2 m at 7.6 m/s             8.4 s
 *     -------------------------------------------------------------------
 *     an uncontested clearance                              about 1:37
 *     the appointment                                            13:00
 *
 * **THE PICKET LEG IS COSTED AS A FREE EXCHANGE AND IT IS FREE ONLY UNDER AN
 * EXPLICIT ATTACK ORDER.** The cheapest free stand against post A is 146.2 m
 * from the opening garrison against 202.2..208.3 m to the cut itself — on the
 * way, not a detour — with zero metres of the route inside either post's
 * envelope, so those 25.6 s of firing cost walking that was going to happen
 * anyway. Attack-move past the
 * posts instead and the same leg is worth 349.6 damage of gun output; the
 * doctrine block above has the derivation and `t.first` tells the player.
 *
 * So the assault is not the operation and is not meant to be: it is the price of
 * admission, and the eight minutes after it are a hostile base 146.0 m from the
 * cut, four columns, a tenement row 16.99 m off their road and a field office
 * 107.7 m the other way. **The modal run is a judgement and is labelled as one:
 * 13:00 to 15:30.**
 *
 * ============================================================================
 * NO SCRIPTED `eva`, AND THAT IS A FINDING RATHER THAN AN OMISSION
 * ============================================================================
 * `types.ts` says most scripted announcer lines are punctuation because
 * `audio.system.ts` already speaks the ordinary events, and here it covers
 * every moment this operation would want: `buildingCaptured` for a captured
 * sorter or office, `structureLost` for a tenement (both blocks are LOCAL
 * buildings from tick one), `baseUnderAttack` and `forcesUnderAttack` for the
 * columns. `reinforcements` is the line `types.ts` names as earning its place,
 * and it would be a lie on a crew wave; there is no friendly wave here to spend
 * it on. (It also has a real caller now — `orecrisis.system.ts` emits
 * `EvaLine.Reinforcements` for the stranded-economy rescue — which
 * `soviets.06.demolition-order` had to correct in the other direction.)
 *
 * The one moment with no announcer line is the Works sitting, and `EVA_LINES` has
 * nothing for it. `t.watch` and `t.sit` are dialogue, at 12:24 and 12:42, and the
 * camera move in this file is spent once, at four seconds, on the cut.
 *
 * ============================================================================
 * THE MEASURED POINTS, AT `mapSeed` 41 213 / `simSeed` 3 719
 * ============================================================================
 * Read off a headless build AFTER `spawnBuilding` snapped every footprint, with
 * the def tables BOUND and the roster INSTALLED. Geometry is IMPORTED from
 * `layouts/pact-common-ground.ts` rather than restated — a number written in two
 * files is a number that will disagree the first time either is tuned.
 *
 *     home yard 114, 382    crew yard 402, 382    axis 296.000 (the edge pair)
 *     the cut 274, 322      the office 328, 416   the road 313, 400
 *     sorter 288, 318   furnace 276, 304   heap 334, 346
 *     picket 246, 326   and   250, 310
 *     row 270, 352   and   290, 296
 *
 *     home -> the cut   170.88 straight   195.2..206.0 foot   202.2..208.3 hover
 *     crew -> the cut   141.36            146.0        146.0
 *     road -> the cut    87.21             96.4         96.4
 *     the cut -> the heap 64.62            64.2         64.2
 *     the cut -> the office 108.41        107.7        107.7
 *     home -> the office 216.68           244.6        244.6
 *
 * Measured by flood-filling the REAL `FlowFieldCache.costGridFor` with the
 * engine's own expander rules — 8-connected, destination-cell weight,
 * `(nc * DIAG) | 0` on a diagonal, corner-cut refused — and the grid was
 * checked for teeth first: **4 222 of 16 384 cells read `COST_BLOCKED` on the
 * Foot grid, 4 168 on Hover and 4 329 on Wheel and Track**, which is the control
 * that stops a pathfinder that cannot see walls publishing a confident wrong
 * number. `COST_BLOCKED` is exported from `src/world/terrain-gen.ts`, not from
 * `src/core/config.ts`.
 *
 * **THE `home -> the cut` ROW IS A BAND BECAUSE ITS ANCHOR IS A UNIT, NOT A
 * BUILDING**, and that is the correction the engineer fork forced. The band is
 * every one of the five `mrdWayfarer` (Foot) and four `mrdSolarch` (Hover) the
 * layout spawns, each snapped to its own nearest open cell. For the record of
 * where the retired figures came from: the Conclave's centre cell (110, 374)
 * reads 200.2 foot / 210.2 hover, and the cell nearest the Chapterhouse reads
 * 206.0 / **218.2** — which is the number this file used to publish as "home",
 * beside a foot figure of 210.1 that was the HOVER answer wearing the other
 * label. Name the anchor or the number means nothing.
 *
 * **RE-MEASURE IF EITHER SEED MOVES**, in this order: the picket against the row
 * (is the nearest post still past `20 * COMBAT_TARGETING.acquireRangeMul 1.08 +
 * hitRadius(2,3) 7.211` = 28.81 m — it is 35.38 m today, clear by 6.57); the ore
 * against the standing disc; the exclusion control on the approach, ON BOTH
 * LOCOMOTORS and from real unit starts; the engineer fork — is the Chapterhouse
 * door still on the exposed side of it, and is the opening Artificer still on
 * the free one; the ring points of all four columns, which
 * `tests/campaign-spawn-ground.spec.ts` fails by name; and the walked lengths
 * the four waves are paced by, which nothing checks at all.
 * ========================================================================== */

import { Faction } from '../../../core/types';
import { minutes, seconds } from '../../types';
import type { Condition, OperationDef } from '../../types';
import {
  CUT_AREA, OFFICE_AREA, ROAD, ROAD_AREA, SECTION, SECTION_AREA,
} from '../../layouts/pact-common-ground';

/* -- the clocks ----------------------------------------------------------- */

/**
 * How long the layout is given to have placed the ground before any threshold
 * over it is believed.
 *
 * `ownerCount(..., max: 0)` reads TRUE against an empty tag registry, so a build
 * that placed nothing would complete the primary on tick one and a win would
 * follow at the thirteenth minute with the crew's plant never having existed.
 * The same is true of `ownerCount(0, ..., 'row', max: 1)` and of `playerBeaten`.
 *
 * **IT IS DEFENCE AGAINST A LAYOUT THAT PLACED NOTHING, NOT AGAINST A TICK-ONE
 * READ THAT HAPPENS TODAY.** `game.scenario` builds the world inside
 * `async init()` and `SystemRegistry.init` awaits every module's init in
 * sequence before `initialised` is set, so the registry is never empty when the
 * Director first runs. What IS reachable is a wrong def key or a footprint that
 * will not fit.
 */
const SETTLE: Condition = { on: 'elapsed', ticks: seconds(20) };

/**
 * When the Works sit. The appointment, and the reason this is a race rather
 * than a hold: nothing before this tick can be banked toward the primary.
 */
const OPEN = minutes(13);

/**
 * The Order's last word before the Works walk on, and the last prompt a player
 * gets that they can still act on.
 *
 * IT EXISTS BECAUSE THE WINNING TICK WAS FIVE SPEECHES LONG. Driven through the
 * real `runDirector` over the modal run — plant off at t+100 s, four standing
 * from t+110 s — tick 23 400 fired `t.sit`, `t.rowKept`, `t.stand` and `t.win`
 * together: dialogue<Aubray>, complete<row>, dialogue<Nael>, complete<sitting>,
 * dialogue<Calvane>, dialogue<Aubray>, dialogue<Calvane>, END:win. **Five
 * dialogue beats in one frame against `TOAST_MAX` 5**, with Aubray's *"I will
 * enter what is in front of me at the close"* immediately followed by her
 * *"Entered."*, and two Calvane lines back to back. That is the modal run rather
 * than an edge: an uncontested clearance is about 1:37 against a 13:00
 * appointment, so the player is normally ready nine minutes early.
 *
 * The fix is PACING and not a condition. Moving `t.sit` ahead of `OPEN` was the
 * obvious half; hanging an `elapsedSinceArmed` hold on `t.win` was costed and
 * REJECTED, because `t.stand` completes the `sitting` row at `OPEN` and
 * `campaign-install.ts#setObjective` refuses to un-resolve a resolved row — so a
 * player who stepped out during the hold would lose the match with `sitting`
 * showing complete, which is the contradiction `t.risePlant`/`t.riseStand` were
 * split to remove.
 * Re-measured after the change: the winning tick is Nael, Aubray, Calvane, three
 * beats, three speakers, no repeat.
 */
const WATCH = seconds(744);

/** When Aubray arrives, eighteen seconds before she rules. */
const ARRIVE = seconds(762);

/** When they rise. `parSec` to the second. */
const CLOSE: Condition = { on: 'elapsed', ticks: minutes(18) };

/** When the crew's own office is named. Before the first column lands. */
const DISCLOSE = seconds(210);

/**
 * The four columns.
 *
 * Four minutes of quiet first — long enough to walk the opening garrison the
 * 202.2..208.3 m to the cut (26.6..27.4 s for a Solarch, and 54.2..57.2 s for
 * the Wayfarers over their own 195.2..206.0 m at 3.6 m/s), break the picket and
 * start on the plant — then gaps of 3:00, 3:00 and 2:00.
 * The last lands at twelve and its armour is on the cut 16.6 s later, so the
 * minute before the sitting opens is the crew's last word on it.
 */
const WAVE_A = minutes(4);
const WAVE_B = minutes(7);
const WAVE_C = minutes(10);
const WAVE_D = minutes(12);

/* -- the thresholds, defined once ----------------------------------------- */

/**
 * The crew's cutting plant is off the section — levelled or taken.
 *
 * `ownerCount` rather than `entityDead`, because `entityDead` is
 * `aliveWithTag === 0` and cannot see a change of owner: the sorter is worth
 * capturing, the player opens with an Artificer and both a refinery's prereqs
 * standing, and under `entityDead` taking it more thoroughly than levelling does
 * would leave the primary unmet. The title says "take off" for that reason.
 * `soviets.06.demolition-order`'s `WORKS_GONE` is the same migration.
 *
 * Defined as ONE object because two triggers read it and two copies of a
 * threshold is how two triggers come to disagree about one world.
 */
const PLANT_OFF: Condition = {
  on: 'all',
  of: [SETTLE, { on: 'ownerCount', player: 1, role: 'building', tag: 'plant', max: 0 }],
};

/**
 * The crew still holds their field office. The exact complement of `OFFICE_OFF`,
 * so `t.fourth` and `t.deed` partition every world state between them and no
 * tick can satisfy both.
 *
 * `min: 1` needs no settle: it reads FALSE against an empty registry, which is
 * the safe direction.
 */
const OFFICE_HELD: Condition = {
  on: 'ownerCount', player: 1, role: 'building', tag: 'office', min: 1,
};

const OFFICE_OFF: Condition = {
  on: 'all',
  of: [SETTLE, { on: 'ownerCount', player: 1, role: 'building', tag: 'office', max: 0 }],
};

/** Four of the Order's own, standing in the cut. */
const STANDING: Condition = {
  on: 'unitsInArea', player: 0, area: SECTION_AREA, min: 4,
};

/**
 * Everything the Works are asked to look at, true at ONE INSTANT.
 *
 * This is the operation. `t.rowKept`, `t.stand` and `t.win` all read it, in that
 * order, because `runDirector` returns as soon as an outcome is set — anything
 * that has to resolve on the winning tick must be written above the trigger that
 * ends the match, or `medalFor` never counts it.
 */
const PRESENTED: Condition = {
  on: 'all',
  of: [PLANT_OFF, { on: 'elapsed', ticks: OPEN }, STANDING],
};

/** Both blocks of the row still on the Order's books. */
const ROW_INTACT: Condition = {
  on: 'ownerCount', player: 0, role: 'building', tag: 'row', min: 2,
};

const op: OperationDef = {
  id: 'pact.06.common-ground',
  chapter: 'pact',
  faction: Faction.Meridian,
  /*
   * THE SALVAGE HOUSE, AND THE CHAPTER HAS NOW FOUGHT EVERY ARMY TWICE OVER.
   *
   * `pact.03.concession` established that the Reclamation runs a concession the
   * Pact has to cross and gave Tallow his channel; this is the same outfit
   * holding a piece of paper the Conclave signed. It is the right enemy for the
   * hinge because he is not an obstacle to the argument — he agrees with it, out
   * loud, and it costs him money — which makes the clock rather than the fight
   * the thing in his way.
   *
   * MECHANICALLY IT PINS TWO THINGS. Every wave spawns `rclGrinder`,
   * `rclPicker` and `rclSlagger` — literal Reclamation keys, unremapped, which
   * `validateCampaign` checks against the army of the seat they land on. And
   * `ScenarioBuilder.keyFor` resolves the layout's role keys on a Reclaim seat:
   * `refinery` -> `rclSorter`, `powerPlant` -> `rclFurnace`, `oreSilo` ->
   * `rclHeap`, `radar` -> `rclSpotter`, `pillbox` -> `rclSpitpost`. That last
   * one is the row `reclamation.01.held-paper` paid for: a role key is a promise
   * about the ROLE and not about the GUN, so the picket was resolved and its
   * WEAPON read against the hp of the units this roster lets the player field
   * before either post was placed. `postCoil` chains once, at 43.52 then 26.11
   * against a `mrdWayfarer`'s 110 hp, so one pull cannot take two men.
   */
  foe: Faction.Reclaim,
  index: 6,
  title: 'Common Ground',
  beat: 'The Works will sit on the crust itself, and the Conclave has already sold the cut to '
    + 'the breakers.',
  primaryType: 'race',
  /*
   * BESPOKE. Objective state, two reveals plus a third on the first column, a
   * camera move, four waves with orders, and an outcome — `types.ts` defines the
   * archetype as "multiple effect kinds". The one it does not use is
   * `grantCredits`: both secondaries pay through `ObjectiveDef.credits`, which is
   * the same `Economy.grant` on a rail that `state.paid` keeps from paying twice
   * across a reload.
   */
  archetype: 'bespoke',
  parSec: 1_080,
  requires: ['pact.05.open-count'],

  map: {
    /*
     * `temperate`, AND THE BIOME IS SPELLED OUT BESIDE IT ON PURPOSE. The two
     * vocabularies overlap on three names and disagree on exactly one — the
     * `MAP_PRESETS` key is `arid`, the `BiomeName` is `desert` — and
     * `reclamation.03.sold-twice` shipped on the wrong side of that with every
     * number in its headers taken on ground it had not declared. `getBiome`
     * answers an unknown name with a `console.warn` and TEMPERATE, so the safety
     * here is an accident of which word this preset uses rather than a property
     * anybody may rely on for the next operation.
     *
     * It is also the chapter's own ground rather than the salvage house's:
     * `pact.02.long-count` is the other temperate operation and it is the one
     * where a Pact reading post stands on Pact seam country. This is the first
     * time the Reclamation has plant standing on it.
     */
    preset: 'temperate',
    biome: 'temperate',
    /*
     * CHOSEN ON A SWEEP OF TEN ROLLS at this `simSeed`, read against five
     * columns — how much of the standing disc is open, how much of it is
     * BUILDABLE, how much of the office's ground is buildable, how much of the
     * columns' forming-up ground is open, and the heap's.
     * `layouts/pact-common-ground.ts` §2 carries the whole table. 41 213 is at
     * maximum on four of the five and within four cells on the fifth, which is
     * the only kind of survey worth writing down: it wins on every criterion
     * rather than on one. 52 147 ties the disc and then leaves sixteen of
     * forty-eight cells buildable under the office; 22 417 leaves thirty-eight
     * of a hundred and thirty open where four columns have to be put down.
     */
    mapSeed: 41_213,
    /*
     * **IT CHOOSES THE PAIR, AND THE EDGE PAIR IS THE POINT.** `seatedSlots`
     * draws from `START_PAIRS` for a two-army match and `temperate` has no
     * `MAP_SEAS` row, so all four survive the water filter; 3 719 draws the
     * **edge** pair at 296.000 m, home at (108, 380) and the crew at (404, 380).
     * The neighbouring seeds tried (3 651, 3 673, 3 701, 3 733) all draw the
     * 386.161 m diagonal, which is `pact.05.open-count`'s rejected case for the
     * same reason: forty-eight metres of extra approach, on foot, four times
     * over, turns a race into a march.
     */
    simSeed: 3_719,
    armies: 2,
    opening: 'base',
    /*
     * BOTH SEATS. `Shell.applySimPostBoot` writes `setup.startingCredits` into
     * every non-Neutral slot, so this is a statement about the operation's
     * economy rather than a handicap — and on the crew's side it is what pays
     * `AI_REPAIR.minCredits` 400 for the drip that every number in the plant
     * block above runs through.
     *
     * It is sized against the capture bill. Three more Artificers is 1 500 and
     * leaves 3 500; levelling the plant instead spends nothing but the opening
     * garrison's time. That is the decision, and 5 000 is the bank that makes
     * both sides of it affordable rather than forced.
     *
     * IT IS A PLATEAU AND NOT A RISE. The chapter runs 4 000 / 5 000 / 5 000 /
     * 5 000 / 5 000 / 5 000; what escalates is the clock and the columns.
     */
    credits: 5_000,
  },
  layout: 'pact-common-ground',

  outcome: { annihilationWin: false, assetLossDefeat: false, ignoreSeats: [] },

  /*
   * EMPTY ON BOTH SIDES. The header's roster block has the measurement — 243
   * against 235, four defs off each seat — and the one that decides the
   * operation is `rclPylon`: 28 m of `pylonArc` against the Solarch's 26, with a
   * first chain link of 120.32 against a 110 hp Wayfarer and a 95 hp Artificer.
   * `tests/campaign-roster-ground.spec.ts` is what makes that a measurement
   * rather than a hope.
   */
  roster: { player: [], ai: [] },

  /*
   * NO `captureProof`, AND IT WAS CHECKED RATHER THAN SKIPPED. The plant and the
   * office MUST stay capturable — both objectives count a capture exactly as
   * they count a demolition and both titles say "take off". The row is on the
   * player's own seat, where `Capture.resolve` takes the FRIENDLY branch ahead
   * of the veto list; the only seat that could take it never issues the verb
   * (`src/sim/AI.ts` contains `Capture` zero times); and
   * `GarrisonService.refusalFor` answers `'hostile'` for a non-allied owner, so
   * the `civApartments` deed cannot be flipped by a picker walking in either. A
   * veto here would forbid a play nobody can make.
   */

  objectives: [
    {
      /*
       * "TAKE OFF" RATHER THAN "LEVEL", because `PLANT_OFF` is `ownerCount` and
       * counts a capture. The title also names the three, because the heap is
       * 64.62 m out on the haul road and a player who levels the two on the cut
       * and stops has met neither half of this operation.
       */
      id: 'section',
      kind: 'primary',
      title: 'Take the breaking crew\'s sorter, furnace and heap off the section',
    },
    {
      /*
       * THE TITLE IS THE ONLY SENTENCE A PLAYER GETS — `ObjectiveRow` is
       * `{ id, title, kind, status }`, with no description and no tooltip — so it
       * has to carry the two things that decide it: a force, and a time. The
       * count and the radius live in `t.brief`, which is UNCONDITIONAL for
       * exactly that reason: a mechanism explained behind an optional secondary
       * is a mechanism half the players never hear.
       */
      id: 'sitting',
      kind: 'primary',
      title: 'Stand in the cut in force when the Works sit',
    },
    {
      /*
       * 400 AND NOT MORE. What failing this really costs is not the payout — it
       * is the two families the whole argument is about, and the chapter's next
       * operation opens on the people who live on the crust. The row stays small
       * so the medal rather than the money is what it buys.
       */
      id: 'row',
      kind: 'secondary',
      title: 'Finish with the tenants\' row standing',
      credits: 400,
    },
    {
      id: 'deed',
      kind: 'secondary',
      hidden: true,
      title: 'Take the crew\'s field office off them',
      credits: 500,
    },
  ],

  triggers: [
    /* -- the opening word -------------------------------------------------
     * THREE BEATS, ONE SPEAKER EACH, TWELVE AND FOURTEEN SECONDS APART.
     * `Shell.playCampaignBeat` keys its toast `campaign-${speaker}-${seq}` off a
     * monotonic counter that is never reused, so nothing here would be destroyed
     * by landing on one tick — three paragraphs on adjacent ticks would simply be
     * three paragraphs nobody reads.
     *
     * THE CAMERA MOVE IS THE ONLY ONE IN THIS FILE. `types.ts` reserves
     * `cameraMove` for an arrival, a loss or a reveal and forbids it as
     * punctuation; this is the reveal, once, at four seconds, before the player
     * has begun anything. A second one at the sitting was written and cut: the
     * thirteenth minute is the moment the player most needs the camera they
     * already have.
     */
    {
      id: 't.open',
      when: { on: 'elapsed', ticks: seconds(4) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Calvane',
          text: 'The count is out and the Works will finally act on it. Aubray is bringing the '
            + 'sitting to the ground it was taken from, because a number nobody has stood on is a '
            + 'rumour with decimals. She sits at the thirteenth minute and she rises at the '
            + 'eighteenth, and she will enter what is in front of her at the time.',
        },
        { do: 'revealArea', player: 0, area: CUT_AREA },
        { do: 'cameraMove', at: SECTION },
      ],
    },
    {
      id: 't.brief',
      when: { on: 'elapsed', ticks: seconds(16) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Nael',
          text: 'And the Conclave sold the cut to the breakers eleven days ago rather than let it '
            + 'be read in the open. Two things, and I will say them once. Their plant comes off the '
            + 'section — sorter and furnace on the cut, heap out on their haul road, levelled or '
            + 'taken, it counts the same. And when she walks on there are to be no fewer than four '
            + 'of ours standing in the cut itself. Being early buys us nothing at all.',
        },
      ],
    },
    {
      id: 't.tallow',
      when: { on: 'elapsed', ticks: seconds(30) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Tallow, on the yard net',
          text: 'Tallow, for the salvage house, and I will be straight with you the way I was on '
            + 'the pan. I bought this cut off your own Conclave, in writing, and a hearing that '
            + 'makes the ground common makes my paper waste. So I am not defending it and I am not '
            + 'arguing with your arithmetic. I am spending your minutes. I have more of them.',
        },
      ],
    },

    /* -- the office, disclosed --------------------------------------------
     * Three and a half minutes, before the first column lands. `hidden`
     * objectives are filtered out of the briefing, so this really is a surprise,
     * and it arrives at the moment it becomes a decision rather than a line the
     * player read before the match started.
     *
     * THE REVEAL IS NOT A NO-OP. `revealArea` is `Vision.exploreCircle`, which
     * is PERMANENT, so a disc that had already covered the office would make this
     * beat a reveal of ground the player has been looking at since four seconds.
     * `CUT_AREA` is r = 56 on the cut and the office is 108.41 m away, so the two
     * do not touch.
     */
    {
      id: 't.disclose',
      when: { on: 'elapsed', ticks: DISCLOSE },
      then: [
        {
          do: 'dialogue',
          speaker: 'Nael',
          text: 'Signals has their field office on the far road, and the bill of sale is sitting '
            + 'in it under the Conclave\'s own seal. Take that off them and the Order stops being '
            + 'able to pretend the sale was somebody else\'s idea.',
        },
        { do: 'revealArea', player: 0, area: OFFICE_AREA },
        { do: 'setObjective', id: 'deed' },
      ],
    },

    /* -- the four columns -------------------------------------------------
     * ONE TAG FOR ALL FOUR, which is a choice and not a shortcut: `orderTagged`
     * re-points the survivors of every earlier wave as well, which is what a
     * commander does. It is also the honest spelling, because the order does not
     * survive the first brain pass — see the header's "headings, not leashes".
     *
     * LITERAL RECLAMATION KEYS. `EffectSink.spawnUnits` resolves through
     * `ProductionCatalog.byKey` and remaps nothing, unlike the layout's
     * `ScenarioBuilder.spawnUnit`; `validateCampaign` checks every key against
     * the army of the seat it lands on, so a Meridian key here is a build error.
     *
     * `spread` IS THE RADIUS OF A FIXED RING, NOT A SCATTER. Unit `i` of `count`
     * lands at exactly `angle = i / count * 2pi` and `ProductionService.spawnUnit`
     * writes the point VERBATIM — no `connectedGround`, no egress search. All 26
     * drops these four author (3 + 7 + 8 + 8) were checked against the locomotor each unit
     * resolves to and every one is open; `tests/campaign-spawn-ground.spec.ts`
     * fails by name if that stops being true.
     */
    {
      id: 't.first',
      when: { on: 'elapsed', ticks: WAVE_A },
      then: [
        {
          do: 'dialogue',
          speaker: 'Nael',
          text: 'Grinders off their office road, and they will be on the cut in seventeen seconds. '
            + 'Everything the breakers own is short — eighteen metres on the armour, twenty on '
            + 'those gun posts, against our twenty-six. That reach is only ours if you name the '
            + 'target: a Solarch told to attack a thing stops at the edge of its own range and '
            + 'stays there. Send one past instead and it drives the whole length of theirs.',
        },
        { do: 'revealArea', player: 0, area: ROAD_AREA },
        { do: 'spawnUnits', player: 1, key: 'rclGrinder', count: 3, at: ROAD, spread: 14, tag: 'column' },
        { do: 'orderTagged', tag: 'column', order: 'attackMove', at: SECTION },
      ],
    },
    {
      id: 't.second',
      when: { on: 'elapsed', ticks: WAVE_B },
      then: [
        {
          do: 'dialogue',
          speaker: 'Tallow, on the yard net',
          text: 'Pickers behind the armour, and mind the row on the way past. Those are the people '
            + 'we are doing this for, or so the paperwork says.',
        },
        { do: 'spawnUnits', player: 1, key: 'rclGrinder', count: 3, at: ROAD, spread: 14, tag: 'column' },
        { do: 'spawnUnits', player: 1, key: 'rclPicker', count: 4, at: ROAD, spread: 22, tag: 'column' },
        { do: 'orderTagged', tag: 'column', order: 'attackMove', at: SECTION },
      ],
    },
    {
      id: 't.third',
      when: { on: 'elapsed', ticks: WAVE_C },
      then: [
        {
          do: 'dialogue',
          speaker: 'Nael',
          text: 'Slaggers walking behind the armour this time. A slag satchel is the only thing in '
            + 'their army built to take a wall down, and everything of ours that is standing still '
            + 'is a wall — the tenants\' houses first.',
        },
        { do: 'spawnUnits', player: 1, key: 'rclGrinder', count: 4, at: ROAD, spread: 16, tag: 'column' },
        { do: 'spawnUnits', player: 1, key: 'rclSlagger', count: 4, at: ROAD, spread: 24, tag: 'column' },
        { do: 'orderTagged', tag: 'column', order: 'attackMove', at: SECTION },
      ],
    },
    {
      /*
       * GATED ON THE FIELD OFFICE STILL STANDING, which is what gives the
       * 500-credit secondary teeth beyond its payout: taking it off them deletes
       * eight hulls and 158.4 dps into Concrete one minute before the
       * sitting opens. It cannot collide with `t.deed` below — that trigger needs
       * `ownerCount(1, ..., max: 0)` and this one needs `min: 1`, so the two are
       * disjoint on every tick.
       */
      id: 't.fourth',
      when: { on: 'all', of: [{ on: 'elapsed', ticks: WAVE_D }, OFFICE_HELD] },
      then: [
        {
          do: 'dialogue',
          speaker: 'Tallow, on the yard net',
          text: 'Everything the office has left, onto the cut. She will not enter a number over a '
            + 'firefight, Calvane — she will write down that the ground was disputed, and she will '
            + 'come back in a year, and I will have cut it by then.',
        },
        { do: 'spawnUnits', player: 1, key: 'rclGrinder', count: 4, at: ROAD, spread: 16, tag: 'column' },
        { do: 'spawnUnits', player: 1, key: 'rclSlagger', count: 4, at: ROAD, spread: 24, tag: 'column' },
        { do: 'orderTagged', tag: 'column', order: 'attackMove', at: SECTION },
      ],
    },

    /* -- the plant comes off ---------------------------------------------- */
    {
      id: 't.plant',
      when: PLANT_OFF,
      then: [
        { do: 'completeObjective', id: 'section' },
        {
          do: 'dialogue',
          speaker: 'Calvane',
          text: 'The cut is open and nothing is being carried off it. That is half of it. The other '
            + 'half is who is standing in it when she gets here.',
        },
      ],
    },

    /* -- the paid secondary ------------------------------------------------ */
    {
      id: 't.deed',
      when: OFFICE_OFF,
      then: [
        { do: 'completeObjective', id: 'deed' },
        {
          do: 'dialogue',
          speaker: 'Calvane',
          text: 'We have the sale. Signed by the Conclave, dated eleven days before the count went '
            + 'out, and I would very much rather have been wrong about that.',
        },
      ],
    },

    /* -- the row ----------------------------------------------------------
     * FAILS AT THE MOMENT IT BECOMES UNREACHABLE rather than at the close. A
     * REBUILT STRUCTURE CARRIES NO TAG — `c.tag` runs once, inside the layout —
     * so nothing any player can do restores this objective once a block is gone,
     * and an objective that stays lit after it is impossible is a lie the player
     * plays against for another ten minutes.
     *
     * `ownerCount(0, ..., max: 1)` rather than `entityDead`: `entityDead` is
     * `aliveWithTag === 0` and would need BOTH blocks levelled, and a tenement
     * the Order no longer holds is a tenement lost whatever is standing on the
     * ground. `SETTLE` guards it because a count of one reads true before the
     * layout has stamped the tag.
     */
    {
      id: 't.rowLost',
      when: {
        on: 'all',
        of: [SETTLE, { on: 'ownerCount', player: 0, role: 'building', tag: 'row', max: 1 }],
      },
      then: [
        { do: 'failObjective', id: 'row' },
        {
          do: 'dialogue',
          speaker: 'Nael',
          text: 'The row is down. Whatever the Works enter this afternoon, the people who were '
            + 'living on the ground it is about are not going to be there to hear it read out.',
        },
      ],
    },

    /* -- the Works arrive --------------------------------------------------
     * TWO BEATS AHEAD OF THE APPOINTMENT RATHER THAN ONE ON IT. `WATCH`'s
     * comment has the measurement that forced the split; the short version is
     * that Aubray used to answer herself inside one frame. `t.watch` also
     * carries the last actionable prompt in the operation, which is why it is
     * Calvane rather than a second Aubray line — a beat a player can still do
     * something about is worth more than a second speech.
     */
    {
      id: 't.watch',
      when: { on: 'elapsed', ticks: WATCH },
      then: [
        {
          do: 'dialogue',
          speaker: 'Calvane',
          text: 'Four hundred years of the Order holding this count, and it comes down to whoever '
            + 'of us is standing in a hole at the thirteenth minute with somebody else\'s houses '
            + 'behind them. Get them in there. She writes down what is in front of her.',
        },
      ],
    },
    {
      id: 't.sit',
      when: { on: 'elapsed', ticks: ARRIVE },
      then: [
        {
          do: 'dialogue',
          speaker: 'Aubray, Continental Works',
          text: 'Aubray, Continental Works, sitting on the ground rather than in a hall, which I am '
            + 'told is unprecedented and I am told a great many things. I will enter what is in '
            + 'front of me at the close, and nothing that is not.',
        },
      ],
    },

    /* -- the three that resolve on the winning tick ------------------------
     * IN THIS ORDER, AND THE ORDER IS LOAD-BEARING. `runDirector` returns as soon
     * as an outcome is set, so a completion written below `t.win` never fires and
     * `medalFor` — which gives silver only when EVERY secondary is complete —
     * never counts it. All three read `PRESENTED`, which is one object for the
     * reason two copies of a threshold are two thresholds.
     *
     * **THREE DIALOGUE BEATS LAND HERE AND THAT IS AS FEW AS THE SHAPE ALLOWS.**
     * Measured through the real `runDirector` on the modal run — Nael on the row,
     * Aubray entering, Calvane signing, three speakers with no repeat, plus two
     * `completeObjective` and the end. It was FIVE, all four of these triggers
     * plus `t.sit`, with Aubray answering herself; `WATCH` has the trace and the
     * argument. `t.rowKept` cannot be moved earlier — the row has to be standing
     * at the finish, which is what the objective says — and `t.win`'s two lines
     * are the chapter's hinge, so the beat that moved was `t.stand`'s.
     */
    {
      id: 't.rowKept',
      when: { on: 'all', of: [PRESENTED, ROW_INTACT] },
      then: [
        { do: 'completeObjective', id: 'row' },
        {
          do: 'dialogue',
          speaker: 'Nael',
          text: 'The row is standing and the people in it are watching this from their own '
            + 'doorways. That is the difference between a hearing and a ceremony.',
        },
      ],
    },
    {
      /*
       * NO DIALOGUE, DELIBERATELY. Its line — Calvane on four hundred years
       * coming down to four hulls in a hole — is `t.watch`'s now, thirty-six
       * seconds earlier, where it is a prompt as well as a reflection. Left
       * here it was the second of five speeches on one tick and the first of
       * two consecutive Calvanes; see `WATCH`.
       */
      id: 't.stand',
      when: PRESENTED,
      then: [
        { do: 'completeObjective', id: 'sitting' },
      ],
    },
    {
      id: 't.win',
      when: PRESENTED,
      then: [
        {
          do: 'dialogue',
          speaker: 'Aubray, Continental Works',
          text: 'Entered. The Timetable is amended against this crust and every siting office on '
            + 'the coast will be checking against it by the evening. And it carries the condition '
            + 'it has to carry, Calvane, because a number anybody may check is a section anybody '
            + 'may cut: the ground is open to survey by any party that asks. Nobody\'s crust, from '
            + 'this afternoon. Including yours.',
        },
        {
          do: 'dialogue',
          speaker: 'Calvane',
          text: 'Sign it. Log that I agreed to it, log the hour, and log that I knew exactly what '
            + 'I was giving away when I did. We were right, and being right has cost us the only '
            + 'thing we ever actually owned.',
        },
        { do: 'endOperation', result: 'win' },
      ],
    },

    /* -- the Works rise ----------------------------------------------------
     * THE HARD DEADLINE, at `parSec` to the second, and there is deliberately no
     * early-out arm on it. `Viability.isBeaten` is "nothing to build with and
     * nothing to fight with", and a heap on a haul road is neither — so the crew
     * can be beaten with the plant intact, and an authored early-out would end
     * this operation in a WIN with the section unmet.
     *
     * **TWO TRIGGERS, BECAUSE ONE LINE OF NARRATION CANNOT BE TRUE OF BOTH WAYS
     * TO LOSE, AND THE SHIPPED ONE WAS FALSE OF THE COMMONER.** It read *"There
     * was plant on the cut and there was a fight over it"*, fixed. Driven through
     * the real `runDirector` with the plant cleared at t+100 s and only three
     * hulls in the cut, tick 32 400 read `fail:section, fail:sitting,
     * dialogue<Aubray>"There was plant on the cut...", END:loss` against an
     * objective panel showing **section COMPLETE** — the screen said the plant
     * came off and Aubray said it had not, and the player's real failure was
     * named nowhere in the only prose they get. `ObjectiveRow` is
     * `{ id, title, kind, status }`: there is no description to fall back on.
     *
     * `PLANT_OFF` and `not(PLANT_OFF)` partition every world state, so exactly
     * one of these fires on the closing tick, and file order puts both BELOW
     * `t.win` so a match that was won at `OPEN` never reaches either.
     * `elapsedSinceArmed` is not involved, which is what keeps the negation
     * legal — `validateCampaign` refuses `not` over an arm timer because the
     * arming pass forces it true.
     *
     * The `failObjective` calls are no-ops on anything already complete:
     * `campaign-install.ts#setObjective` refuses to un-resolve a resolved row,
     * which is the same guard that lets `t.rowKept` and `t.rowLost` both name
     * `row` without fighting over it. That guard is exactly why the narration
     * had to be split rather than the failure re-asserted.
     */
    {
      id: 't.risePlant',
      when: { on: 'all', of: [CLOSE, { on: 'not', of: PLANT_OFF }] },
      then: [
        { do: 'failObjective', id: 'section' },
        { do: 'failObjective', id: 'sitting' },
        {
          do: 'dialogue',
          speaker: 'Aubray, Continental Works',
          text: 'The sitting is closed. There was a working plant on the cut and there was a fight '
            + 'over it, so what I have entered is that the crust is disputed, which is the one '
            + 'finding that helps nobody. I am sorry. Bring me something I can stand on.',
        },
        { do: 'endOperation', result: 'loss', reason: 'section' },
      ],
    },
    {
      id: 't.riseStand',
      when: { on: 'all', of: [CLOSE, PLANT_OFF] },
      then: [
        { do: 'failObjective', id: 'sitting' },
        {
          do: 'dialogue',
          speaker: 'Aubray, Continental Works',
          text: 'The sitting is closed. The cut was clear and nobody of yours was standing in it, '
            + 'and I will not enter a section on the word of the people who cleared it. So what I '
            + 'have entered is that the crust is disputed. I am sorry. It is the same finding '
            + 'either way and it helps nobody.',
        },
        { do: 'endOperation', result: 'loss', reason: 'sitting' },
      ],
    },

    /* -- the ordinary loss --------------------------------------------------
     * `playerBeaten` is `Viability.isBeaten` — nothing to build with and nothing
     * to fight with — not "you have no buildings". The player opens with a full
     * base, so the two readings agree for most of the match and stop agreeing at
     * exactly the moment it matters: a commander down to one Chapterhouse can
     * still walk four riflemen into the cut, and this operation would like that
     * to be a position somebody can play from.
     */
    {
      id: 't.beaten',
      when: { on: 'all', of: [SETTLE, { on: 'playerBeaten', player: 0 }] },
      then: [
        { do: 'failObjective', id: 'sitting' },
        {
          do: 'dialogue',
          speaker: 'Nael',
          text: 'Nothing answering from the seam. She will sit at the thirteenth minute and there '
            + 'will be nobody standing there.',
        },
        { do: 'endOperation', result: 'loss', reason: 'sitting' },
      ],
    },
  ],
};

export default op;
