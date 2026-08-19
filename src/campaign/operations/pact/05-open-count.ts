/**
 * ============================================================================
 * P5 — THE OPEN COUNT
 * ============================================================================
 * P1 took an Allied instrument off Pact crust. P2 kept a Soviet blast off a
 * Pact reading post. P3 carried four hundred years of plates three hundred
 * metres through somebody else's concession. P4 sank a cut in Pact crust and
 * handed the Allies the instrument over it, so that the number would be true
 * for somebody who is not us.
 *
 * That is a corroborated reading and it is still not an ARGUMENT, because an
 * argument has to be PRESENTED, and the four hundred years of plates that would
 * corroborate it exist in ONE place: the Conclave's own Oculus, which is an
 * archive as much as it is a dish. The Conclave will not lend it.
 *
 * **THE SCARCITY IS THE ARCHIVE, NOT THE INSTRUMENT, AND THE FIRST DRAFT HAD IT
 * THE OTHER WAY ROUND.** Calvane opened with *"There is one instrument on this
 * coast that reaches every yard at once"* — and the player can see, on their own
 * minimap, that this is not true: `buildAlliedBase` seats an `mrdOculus` for
 * every Meridian seat, so the census of the built world is **seat 0 x1, seat 1
 * x2** (its own, plus the hall). `mrdOculus` is 1 000 credits, 14 s, carries no
 * `UNLOCK_TAGS` entry, and its blurb in the player's own sidebar reads "Reveals
 * the minimap. Opens tier two." Mechanically nothing was ever at risk — every
 * trigger here is tag-scoped (`ownerCount`, `entityDead` and `structureCaptured`
 * all take `tag: 'oculus'`), so building a second satisfies nothing — but the
 * player was being told that a thing on their own screen did not exist. The line
 * names the PLATES now, which really are one of a kind.
 *
 * **The chapter's sentence — an argument that cannot be made without conceding
 * it — arrives here at its literal end: the thing that has to be conceded is the
 * count itself, and the people it has to be conceded to are the Pact.**
 *
 * So the foe is `Faction.Meridian`. Calvane's own Order, holding his own
 * archive, fighting with his own doctrine at his own ranges. Oreth is not
 * wrong about the price and the file does not pretend he is: the depth at which
 * Pact crust stops being crust is the depth at which a cut works best, and
 * publishing it ends the only thing the Conclave has ever been for.
 *
 * ============================================================================
 * THE DECISION THIS OPERATION OWNS
 * ============================================================================
 * **WHAT THE CAPTURE COSTS, AND WHAT IT LEAVES YOU HOLDING.** There are exactly
 * two ways to take a structure off an enemy in this engine and this operation is
 * built to make the player pick one and then live inside the consequence for
 * five minutes.
 *
 * **BOTH ROUTES ARE PRICED AGAINST A REPAIR DRIP, AND THE FIRST DRAFT OF THIS
 * BLOCK WAS NOT.** `AiBrain.repairBase` (`src/sim/AI.ts`) walks EVERY building
 * the seat owns with no distance filter, arms on `AI_REPAIR.startFraction`
 * (0.75), runs on `AI_CADENCE.build` = `round(30 / AI_PRODUCTION_HZ 2)` = 15
 * ticks (0.5 s), needs `AI_REPAIR.minCredits` 400 against a 5 000 opening bank,
 * and `AI_SKILL[].maxRepairs` is >= 1 at every rung. `REPAIR_RATE` is a flat
 * **30 hp/s** and costs the Sept `REPAIR_COST_PER_HP` 0.25 = 7.5 credits a
 * second, which it can pay all day. Every number below runs through that.
 *
 *   - **Four Artificers DELIVERED TOGETHER, two thousand credits, and a
 *     full-health archive.** `Capture.resolve` consumes the engineer on every
 *     non-refused outcome, and an enemy structure above `CAPTURE.captureHpFrac`
 *     (0.50) is SOFTENED instead of taken: `maxHp * CAPTURE.softenFrac` (0.25)
 *     through `ARMOR_MATRIX[HighExplosive][Concrete]` (1.00) and
 *     `COMBAT_DAMAGE.globalMul` (0.80) = **0.20 of max per engineer**. Both are
 *     fractions of max, so `maxHp` cancels and the count is four for anything in
 *     the game. The player opens with ONE — `buildAlliedGarrison` spawns
 *     `engineer` and `FACTION_KEY_MAP` remaps it to `mrdArtificer` on a Meridian
 *     seat — so the bill is three more at 500 = **1 500 credits** and 30 s of one
 *     Chapterhouse queue.
 *
 *     **THE DRIP DECIDES WHETHER FOUR IS ENOUGH.** 650 -> 520 is 0.800, ABOVE
 *     the 0.75 arm threshold, so the first engineer is free of it. 520 -> 390 is
 *     0.600 and the drip arms within 0.5 s. From there the archive climbs 30 hp
 *     a second, so with the second engineer landing at `T2` the fourth needs
 *     `260 + 30 * (T4 - T2 - a) <= 325`, i.e. **`T4 - T2 <= 2.17 s`** (2.67 s if
 *     the brain's own half-second cadence is spent). Break-even for one engineer
 *     is `130 / 30` = **4.33 s**.
 *
 *     **SO THE SERIAL DELIVERY THE QUEUE HANDS YOU MAKES NEGATIVE PROGRESS.**
 *     `mrdArtificer` is a 10 s build and `BuildQueue.advanceTab` only ever
 *     advances `items[0]`, so three ordered at once finish 10 s apart; walked
 *     199.7 m at 3.6 m/s they ARRIVE 10 s apart, and each one nets
 *     `130 - 30 * 10` = **-170 hp**. The archive is back at full before the next
 *     man reaches it, forever. The play is to gather all four short of the hall
 *     and walk them in as one group, at which point the gaps are the width of a
 *     tick and the drip never gets a second. Nael says so in `t.brief`, because
 *     nothing on screen reports a repair drip on an enemy building.
 *
 *   - **Shelling it under the gate — FREE, and ONE Solarch cannot do it at all.**
 *     `focusLance` delivers `60 * ARMOR_MATRIX[ArmorPiercing][Concrete] 0.55 *
 *     0.80` = **26.40 per round** into `mrdOculus`'s 650 hp, i.e. **16.50 dps**
 *     against a 30 hp/s drip. Net -13.50: it shells the archive from 650 to the
 *     0.75 arm threshold at 487.5 in 9.85 s and then LOSES ground, so a lone
 *     Solarch stalls there and never reaches the 325 gate. Two, three and four
 *     do:
 *
 *         Solarchs   dps     650 -> 487.5   487.5 -> 325 net of the drip   total
 *           1        16.50      9.85 s      never (net -13.50)             never
 *           2        33.00      4.92        54.17 s (net +3.00)            59.1 s
 *           3        49.50      3.28         8.33 s (net +19.50)           11.6 s
 *           4        66.00      2.46         4.51 s (net +36.00)            7.0 s
 *
 *     **THE OPENING BASE SHIPS FOUR SOLARCHS AND ONE ARTIFICER**, counted off
 *     the built world (seat 0: `mrdSolarch` x4, `mrdWayfarer` x5,
 *     `mrdArtificer` x1, `mrdCollector` x2, `mrdOculus` x1) — an earlier draft
 *     of this block said three. So the cheap route takes the archive to the gate
 *     in **7.0 s** with hulls the player already owns and finishes it with the
 *     engineer they already own: **it costs nothing at all**, and what it buys
 *     is an archive that starts the hold at half health with a drip that is now
 *     the PLAYER's problem to out-run rather than the Sept's tool. This block
 *     previously quoted 6.4 s and 19.2 s and priced the route at 500 credits;
 *     the seconds were taken with the drip switched off, which is not a state
 *     this operation is ever in, and the 500 was for an Artificer the opening
 *     already hands you.
 *
 * **THE PRICE OF THE CHEAP ROUTE IS MEASURED IN SECONDS OF EVERY WAVE.** Sept
 * fire into a captured hall, at the shipped rows:
 *
 *                                       dps into Concrete   650 hp   325 hp
 *     wave A   3 Solarch                      49.50          13.1 s    6.6 s
 *     wave B   4 Solarch + 4 Wayfarer         93.00           7.0 s    3.5 s
 *     wave C   4 Solarch + 4 Sunlancer       135.60           4.8 s    2.4 s
 *     wave D   5 Solarch + 4 Sunlancer       152.10           4.3 s    2.1 s
 *
 * Fifteen hundred credits buys about two seconds per wave, four times. Whether
 * that is a good trade is the operation's question and the file does not answer
 * it.
 *
 * Every number below is derived from the shipped `MERIDIAN_WEAPONS`,
 * `ARMOR_MATRIX`, `COMBAT_DAMAGE`, `CAPTURE`, `AI_REPAIR` and `Targeting`, or
 * read off a headless build at this operation's seeds with the def tables BOUND
 * and the roster INSTALLED. **RE-DERIVE, DO NOT RE-QUOTE**, after any weapon
 * retune.
 *
 * ============================================================================
 * THE FLOOR IS TWENTY-FOUR METRES, AND IT IS TWO BARS RATHER THAN ONE
 * ============================================================================
 * The count is only read out while nothing is standing on the reading floor —
 * `not unitsInArea(0, …)` AND `not unitsInArea(1, …)`, both under the hold
 * timer, so either army stepping on it restarts the clock.
 *
 * `mrdOculus` is a 2x2 at `CELL` 4, so `hitRadius(2, 2)` is `hypot(4, 4)` =
 * **5.6569 m** and every bar below is centre-to-centre.
 *
 * **BAR ONE, THE STAND-OFF, IS WHAT `FLOOR_R` IS DERIVED FROM.**
 * `Targeting.approach` parks an attacker at `range * APPROACH_STOP_FRAC` (0.80)
 * of SURFACE distance, so the distance at which a Sept unit shooting the hall
 * stops closing is:
 *
 *     Wayfarer     pulseCarbine  20 m   ->  16.00 + 5.6569 = 21.657 m
 *     Solarch      focusLance    26 m   ->  20.80 + 5.6569 = 26.457 m
 *     Sunlancer    sunLance      26 m   ->  20.80 + 5.6569 = 26.457 m
 *
 * The window is (21.657, 26.457) and its midpoint is **24.057**, so 24 sits
 * 2.343 m above the infantry bar and 2.457 m below the armour bar. **A Sept
 * RIFLEMAN THAT HAS STOPPED TO SHOOT THE ARCHIVE IS STANDING ON THE FLOOR; A
 * SEPT HULL THAT HAS STOPPED TO SHOOT IT IS NOT.** That is the whole reason each
 * column arrives in two parts, and Oreth says it out loud at wave B.
 *
 * **BAR TWO IS THE FIRING GATE, AND LEAVING IT OUT SHIPPED A DEFEAT.**
 * `Combat.engage` (`src/sim/Combat.ts`) computes
 * `surfaceDist = max(0, flat - hitRadius(target))` and returns when
 * `surfaceDist > w.range`, so a gun can hit the hall from `range + 5.6569` of
 * centre — 25.657 m for a rifleman and **29.657 m for a Glaive Post** — which is
 * FURTHER OUT than where it would stop if it were closing. Deriving `FLOOR_R`
 * from the stand-off alone therefore leaves an annulus in which a Sept gun kills
 * the archive while satisfying the instruction the player was given, and
 * `t.hallLost` does not care who fired.
 *
 * **IT WAS NOT HYPOTHETICAL. IT WAS MEASURED, LIVE, AS A DEFEAT.** The layout
 * used to stand its two Glaive Posts at 26.077 and 28.425 m of the hall — inside
 * 29.657, outside 24. Booted headless with a real Sept brain on seat 1 and the
 * hall handed to the player at t = 0:
 *
 *     GUN_SPREAD 16 (before)   650 hp -> 425 at 10 s -> 201 at 20 s -> DEAD at
 *                              tick 844 = 28.1 s, from FULL health, with nothing
 *                              in range but the two posts. Observed 22.4 dps
 *                              against a derived 2 x 10.937 = 21.87.
 *     GUN_SPREAD 24 (shipped)  650 hp UNCHANGED at 30, 60, 90, 120, 150 and
 *                              180 s. The first damage of the match arrives with
 *                              the Sept's own produced army at about 200 s.
 *
 * A captured archive was dying twelve to fourteen seconds after a successful
 * capture — 260 hp on the four-engineer route — and ending the match in defeat.
 *
 * **THE FIX IS THE GUN LINE, NOT THE FLOOR, AND THAT IS FORCED.** Raising
 * `FLOOR_R` to cover 29.657 would also cover the 26.457 armour stand-off, at
 * which point hulls and men both stop on the floor and the doctrine this
 * operation is built on stops existing. `pact-open-count.ts`'s `GUN_SPREAD` is
 * 24 instead, which puts the two posts at **31.113 and 34.059 m** of the hall —
 * 1.456 and 4.402 m of SURFACE clearance past their own 24 m reach. So the disc
 * the player is told to clear really is the whole of it, and `t.taken` says so.
 *
 * Measured on the built world, **108 of the 112 cells whose centre falls inside
 * `FLOOR_R` are open — and the same 108 for Foot, Track and Hover**, so "the
 * floor" is one number rather than three.
 *
 * **AND THE AXIS DELIBERATELY MISSES IT, WHICH INVERTS `pact.04`'s PAIRING.**
 * That operation pairs `TAP_OFFSET` 26 with `LOT_R` 28 precisely so the
 * opening-to-opening axis CUTS its disc, because its bonus must not be winnable
 * by standing aside and waving a column through. Here the same construction
 * would let anything walking between the two bases stop the PRIMARY, and a
 * primary must not be hostage to traffic. The hall is placed **60.00 m** off the
 * axis against a 24 m floor, so the straight line between the openings clears
 * the rim by **36.00 m**. `pact-open-count.ts` states the same pair from its
 * side; change one and change both notes.
 *
 * **THE ORE WAS THE HAZARD NOBODY WOULD HAVE SEEN.** `unitsInArea` counts
 * Infantry and Vehicles, and a harvester is a Vehicle — so a field inside the
 * floor would mean the economy stopping the reading on its own, in silence, for
 * both armies. This map declares three: r 30 at 386,88 and r 30 at 126,176, and
 * the contested r 22 on the centroid at 256,132. Nearest edge to the hall
 * **40.1 m**, i.e. **16.1 m outside the rim**; nearest edge to the assessors'
 * station 45.9 m. It is the reason the hall sits where it does and it is the
 * first thing to re-check on a re-seed.
 *
 * ============================================================================
 * THE TWO METRES OF DOCTRINE ARE REAL AND THE ENGINE WILL NOT TAKE THEM FOR YOU
 * ============================================================================
 * *"The Pact main line. Outranges, never brawls."* — `mrdSolarch`'s shipped
 * blurb, and in a mirror match it is the only asymmetry left, because it is the
 * only place the two armies are not the same army. The hall's approach is held
 * by two Glaive Posts and the Solarch's 26 m beats their 24.
 *
 *     Solarch into a Glaive Post   480 hp Concrete    16.50 dps   29.1 s solo
 *     Glaive Post into a Solarch   330 hp Light       33.42 dps    9.9 s
 *
 * **At the post's own range the post very nearly wins.** The opening garrison's
 * FOUR Solarchs — counted off the built world, not assumed — break a post in
 * 7.27 s at 66.00 dps against 9.87 s to lose one of themselves, so they win the
 * trade narrowly; THREE of them do not (9.70 s against 9.87 s). Standing at 25 m
 * instead costs nothing at all and wins it outright at any number.
 *
 * **AND `Targeting.approach` PARKS YOU AT 20.8 m.** The stop is
 * `range * 0.80` of surface distance, which is INSIDE the post's 24 m — so an
 * attack-move hands the trade to the post, every time, and the two metres have
 * to be taken by hand. That is the one piece of micro this operation rewards and
 * it is stated here because nothing on screen says it.
 *
 * The rest of the armoury, by the convention `Defs.ts` uses —
 * `cycle = burstCount > 1 ? (burstCount-1)*burstDelay + cooldown : cooldown`,
 * `raw = burstCount * damage / cycle`, then `ARMOR_MATRIX` and `globalMul` 0.80:
 *
 *                        raw     vs Infantry   vs Light   vs Concrete
 *     pulseCarbine     46.875      37.50         20.63        6.75
 *     focusLance       37.500      10.50         25.50       16.50
 *     sunLance         24.167      10.63         18.37       17.40
 *     glaiveRepeater   75.949      60.76         33.42       10.94
 *
 * Two consequences the fight is made of. A Glaive Post kills an Artificer
 * (95 hp) in **1.56 s** and a Wayfarer in 1.81 s; and the Sunlancer is the
 * wave's real archive-killer at 17.40 dps into Concrete against the Solarch's
 * 16.50, on a hull that walks at 3.2 m/s. The armour is what you answer and the
 * launchers are what takes the roof off, eighteen seconds later.
 *
 * **AND THE FIRST OF THOSE STILL BINDS AT THE WIDER GUN LINE, WHICH WAS
 * CHECKED RATHER THAN ASSUMED.** `Capture.withinReach` is a BOX test — the
 * hall's 8x8 m footprint grown by `CAPTURE.reachMetres` 2.2 plus the engineer's
 * own `radius` 0.234 = 2.434 m, with rounded corners — so the furthest a legal
 * capture step can be from the hall's centre is `hypot(4 + 2.434/sqrt(2), …)` =
 * **8.091 m**. Against the two posts as placed:
 *
 *     post 262,50   nearest capture-legal point 23.02 m centre / 22.79 surface
 *                   -> INSIDE its 24, so it kills the engineer on the step
 *     post 262,98   nearest capture-legal point 25.99 m centre / 25.76 surface
 *                   -> outside, so it does not
 *
 * Widening the line to keep both posts off the ARCHIVE cost one of them its
 * cover of the capture STEP, and that is the honest price of the fix: an
 * engineer coming round to the west face now has one gun to break rather than
 * two. The home-side approach — which is the one the walk from the player's
 * opening actually takes — is still covered by both.
 *
 * ============================================================================
 * THE ROAD IS MEASURED AND EVERY WAVE ARRIVES IN TWO PARTS
 * ============================================================================
 * Dijkstra over the REAL `FlowFieldCache.costGridFor` — 8-connected, edge weight
 * `step * (cost[a] + cost[b]) / 2 / COST_UNIT`, endpoints snapped to the nearest
 * open cell because most of them are occupied by their own footprints:
 *
 *                            Foot     Hover    straight   detour (Foot)
 *     home -> the hall      199.7 m   199.7 m   174.63 m   +14.4%
 *     ROAD -> the hall       98.7      98.7      85.91     +14.9%
 *     foe  -> the hall      176.7     177.7     145.00     +21.9%
 *     home -> the station   130.8     130.8     110.92     +17.9%
 *     the hall -> the house 117.0     117.0     105.60     +10.8%
 *
 * At the shipped speeds, from the moment a wave lands at `ROAD`:
 *
 *     Solarch    7.6 m/s   13.0 s        Wayfarer   3.8 m/s   26.0 s
 *     Sunlancer  3.2 m/s   30.8 s        Artificer  3.6 m/s   55.5 s from home
 *
 * So the armour is on the hall 13.0 s after the drop and the men 26.0 to 30.8 s
 * after it — a split of 13.0 to 17.8 seconds, so each column reaches the floor
 * TWICE rather than once, and wave A is armour-only and correctly says so.
 *
 * **BOTH MOVE CLASSES WALK THE SAME LENGTHS HERE, EXCEPT ONE ROW.** Foot and
 * Hover agree to 0.0 m on four of the five above and differ by **1.0 m** on
 * `foe -> the hall`; an earlier draft of this table claimed agreement to 0.1 m
 * everywhere and quoted the HOVER figure for that row. The reason they agree at
 * all is that a headless build has no road: `roads.system.ts` builds the network
 * in `init()` DURING `bootstrap()`, so `getRoads()` is null inside
 * `buildScenario` and `rebuildCost` skips its road branch. `NAV_COST_ROAD` is
 * 0.88 for Foot against 1.0 for Track, so a real match's carriageway shortens
 * the INFANTRY half of each column and not the armour half — which pushes the
 * two halves of a wave slightly CLOSER together than the table says. That is the
 * direction that makes the operation harder, so it is recorded rather than
 * corrected.
 *
 * ============================================================================
 * "THE MEN ARE FOR THE FLOOR" IS ABOUT WHO STOPS THERE, NOT WHO TOUCHES IT
 * ============================================================================
 * The stand-off table two sections up says `mrdLancer` parks at 26.457 m, which
 * is OUTSIDE `FLOOR_R`, and waves C and D carry `mrdLancer` as their infantry
 * half. Read as "waves C and D cannot stop the reading", that is a real reading
 * of the table and it is **false**, and the difference is transit.
 *
 * Measured on a live 16-minute headless run at these seeds — real brain on seat
 * 1, the hall handed to the player at t = 0 and kept standing by fiat, the four
 * waves fired at their scripted ticks through the same ring formula
 * `runtime.ts#spawnUnits` uses — **28 of the 28 scripted wave units come inside
 * `FLOOR_R` 24 of the hall**, and every one of them also inside the 33.7 m
 * acquisition bar. Closest approach per unit, in metres:
 *
 *     wave A   5 13 5
 *     wave B   5 11 5 7 10 8 8 6
 *     wave C   5 10 11 7 10 8 8 5
 *     wave D   13 16 12 7 5 10 13 8 5
 *
 * So a column does not stop at its stand-off ring on the way in; it walks onto
 * the archive, and `elapsedSinceArmed` does not care whether a unit is parked or
 * passing. What the stand-off table decides is who REMAINS: `pulseCarbine` is
 * the only Sept weapon whose holder settles inside the disc, so wave B is the
 * one column that leaves men standing on the floor after the fighting stops.
 *
 * **AND THE STANDING PRESSURE IS NOT SCRIPTED AT ALL, WHICH THIS FILE CANNOT
 * PACE.** Over that same run, unit-ticks spent inside the floor by key:
 *
 *     mrdWayfarer   383 125       mrdSolarch   221 268       mrdLancer   67 990
 *
 * `mrdWayfarer` is 175 credits and the Sept's cheapest infantry, and most of
 * those ticks belong to hulls the BRAIN bought rather than to the seven
 * `spawnUnits` effects below. Against a passive opponent the floor is never
 * clear from wave A onward (6 300 / 6 300, 6 300 / 6 300, 5 400 / 5 400,
 * 3 600 / 3 600 ticks per wave window); a player who fights back is what makes
 * a reading possible at all, and that is the operation. **Do not read the wave
 * table as the whole of the floor pressure.**
 *
 * ============================================================================
 * THE ASSESSORS' STATION IS A SECOND ECONOMY, AND IT IS THE PLAYER'S OWN
 * ============================================================================
 * `post` is a `civOilDerrick` on SEAT 0 — 900 hp of Concrete, 2x2 — standing
 * 65.12 m behind the hall on the home side. It is the answer to *to whom*: a
 * reading nobody outside the room can hear is not a reading, which is Aubray's
 * own line from `pact.04`, and this is that sentence given a footprint.
 *
 * **IT PAYS 15 CREDITS A SECOND AND THIS FILE USED TO SAY IT PAID NOTHING.**
 * The claim was *"grep finds no reader of it under `src/sim/`, so it pays
 * nothing"*, and the reader is `src/sim/civilian.system.ts#payHolders`: it
 * matches on `st.defId[i] === binding.buildingId.civOilDerrick` and skips only
 * owners whose PLAYER faction is `Faction.Neutral`. Read off the built world,
 * the station's `defId` is **51** and `binding.buildingId.civOilDerrick` is
 * **51**, and its owner is seat 0 (Meridian). `CIVILIAN_INCOME` in
 * `src/data/Civilians.ts` is `credits: 15, intervalTicks: 30` — one payout a
 * second, **900 credits a minute**, which that file itself prices at "1.71
 * harvesters". Over the 1 020 s par that is **15 300 credits**, three times the
 * opening bank.
 *
 * **THAT MAKES THE SECONDARY BETTER, NOT WORSE, AND THE ARGUMENT IS REWRITTEN
 * ROUND IT RATHER THAN AGAINST IT.** The 400-credit payout is a token — it is
 * twenty-seven seconds of the drip it protects — and the real reward for
 * keeping the station is the drip itself. Losing it does not cost a medal line;
 * it costs the second economy that was paying for the capture bill, at the exact
 * moment a Sept column is past the hall and the player is short of hulls. A
 * secondary that cannot fail is decoration; a secondary whose failure takes 900
 * credits a minute with it is a reason to garrison the ground behind you.
 *
 * **IT IS ON THE PLAYER'S SEAT PRECISELY SO IT CAN BE LOST.** A Gaia station
 * was the obvious authoring choice and it is the wrong one:
 * `Targeting.isValidTarget` refuses ALLIES and `ScenarioBuilder.gaia` allies the
 * Neutral slot to everybody in both directions, so a Gaia derrick is a building
 * nothing in the match will ever fire on — and `payHolders` skips a Neutral
 * owner, so it would not have paid either. Owned by the player it is an ordinary
 * enemy structure to the Sept and dies to a column that gets past the hall in
 * **5.92 s** (900 hp against wave D's 152.10 dps into Concrete).
 *
 * **NOTHING ON THE BOARD AT t = 0 CAN REACH IT, AND THAT WAS MEASURED RATHER
 * THAN ASSUMED.** An emplacement cannot chase — `Targeting.reachOf` returns 0
 * for anything that fails `canDrive` — so its bar against a 2x2 is
 * `range * COMBAT_TARGETING.acquireRangeMul (1.08) + 5.6569`:
 *
 *                                    bar        nearest to the station   clear by
 *     Sept Glaive Post   24 m    31.577 m            44.27 m              12.70 m
 *     Sept Wayfarer      20 m    27.257 m            47.76 m              20.50 m
 *
 * Both figures IMPROVED when `GUN_SPREAD` went 16 -> 24 and the Sept riflemen
 * were pulled inside the floor: the post was 42.43 m and the nearest rifleman
 * 43.81 m before. The Wayfarers open on `Stance.Defensive`, whose
 * `STANCE_CHASE_METRES` entry is **0**, so they take the same non-chasing bar.
 * The station therefore comes under fire only when a column is past the hall,
 * which is exactly the state the secondary exists to price — and until then it
 * is the natural place to form up, because it is forty-four metres outside the
 * nearest Sept gun.
 *
 * **AND IT NEEDS NO `captureProof`, WHICH WAS CHECKED RATHER THAN SKIPPED.**
 * Trap 9's second half is a protect-target the ENEMY can take, at which point the
 * previous owner's guns make it a legal target and the trigger that ends the
 * match does not care who fired. It is unreachable here for a measured reason:
 * `src/sim/AI.ts` contains the string `Capture` **zero times**, so the Sept's own
 * opening Artificer — it has one, because the mirror gives both seats the same
 * garrison — never spends it on anything. The field would install a veto against
 * a play no seat in this operation can make. `FALLBACK_BUILDINGS.civilian` also
 * clears `EntityFlag.Sellable`, so the player cannot dispose of the thing they
 * are protecting to bank its refund. Measured off the built world rather than
 * read out of `FALLBACK_BUILDINGS.civilian`, which is the wrong table for an
 * operation: the bound `Defs.ts` row is the one that ships and it carries no
 * `EntityFlag.Sellable` either.
 *
 * ============================================================================
 * EVERY TRIGGER WAS CHECKED FOR CAPTURE-BLINDNESS, WHICH IS TRAP 9's FIRST HALF
 * ============================================================================
 * `entityDead` is `aliveWithTag === 0`, so it cannot see a change of owner.
 * Three tags, three answers, and two of them are `ownerCount` for that reason:
 *
 *   - **`house` — `ownerCount(1, 'building', …, max: 0)`.** The Sept's forward
 *     chapterhouse is an enemy `barracks` and the player opens with an Artificer
 *     and both its prereqs standing, so taking it is a real play. Under
 *     `entityDead` the secondary would be LOST for taking it more thoroughly
 *     than levelling does, and wave D would still spawn nine hulls off a
 *     building the player owned. `pact.04.in-the-clear`'s `CAMP_OFF` is the same
 *     migration and this is its constant. The title says "take off them" rather
 *     than "level", because the trigger counts a capture and a demolition alike.
 *   - **`oculus` in the hold — `ownerCount(0, 'building', …, min: 1)`.** The
 *     reading runs while the PLAYER owns it, which is the whole objective, and
 *     `min: 1` is also the tick-one guard: a bare `max` reads TRUE against an
 *     empty registry.
 *   - **`oculus` in the loss — `entityDead`, and here it is correct.** The
 *     objective is that the archive STANDS. `pact.04`'s `t.mastLost` makes the
 *     opposite call from `CAMP_OFF` twenty lines above it for exactly this
 *     reason, and this file inherits both.
 *
 * ============================================================================
 * WHAT THE ROSTER WITHHOLDS, MEASURED, AND WHY THE MIRROR MAKES IT SYMMETRIC
 * ============================================================================
 * `{ player: [], ai: [] }` is an ALLOW-LIST, so it withholds every tagged def
 * from both seats. Built twice at these seeds, rostered against an unrostered
 * control, **233 entities alive against 241**, and because both seats are
 * Meridian the eight are the same four things twice:
 *
 *     seat 0   mrdReliquary x1   mrdHelios x1   mrdSkiff x2
 *     seat 1   mrdReliquary x1   mrdHelios x1   mrdSkiff x2
 *
 * `pact.04` argues an empty pair as SYMMETRIC and profile-independent; in a
 * mirror match it is more than that — the two armies are removed from
 * identically, so the ground is not merely fair, it is the same ground twice.
 * The one that matters most is `mrdHelios`: a Helios Spire is 33 m of
 * `heliosLance`, and a Sept spire on the hall would out-range every hull the
 * player can bring by seven metres, which would delete the doctrine argument
 * this operation is built on. `tests/campaign-roster-ground.spec.ts` is what
 * makes that paragraph a measurement rather than a hope.
 *
 * ============================================================================
 * NO SCRIPTED `eva`, AND THAT IS A FINDING RATHER THAN AN OMISSION
 * ============================================================================
 * `types.ts` says most scripted announcer lines are punctuation, because
 * `audio.system.ts` already speaks the ordinary events. Here it covers every
 * moment this operation would want:
 *
 *   - the CAPTURE — `buildingCaptured`, on any capture involving the local seat;
 *   - and on the same tick `radarOnline`, because `mrdOculus` carries
 *     `EntityFlag.IsRadar` and `Power` raises the event when the local player
 *     gains a powered one. The player HEARS the hall change hands twice;
 *   - the archive dying and the station dying — `structureLost`, which fires for
 *     LOCAL buildings and both of these are local (the station from t = 0, the
 *     hall from the moment it is taken).
 *
 * `reinforcements` would be a lie on a Sept wave. So the file scripts none.
 *
 * **THE HOLD IS THE ONE THING NOTHING IN THE PRODUCT CAN REPORT, AND IT IS A
 * MEASURED GAP RATHER THAN AN OVERSIGHT.** `runDirector` (`Director.ts`) keeps
 * `state.armedAt` per trigger and hands it to no effect, and
 * `ui/objectives.system.ts` renders a campaign row as
 * `progress: { value: r.status === 'complete' ? 1 : 0 }` — binary, no timer, no
 * hold state, no restart. "The clock went back" is not a world state any of the
 * twelve conditions names, so it cannot be a trigger either. Three things are
 * done about it and none of them is a fix:
 *
 *   - **`READ` is 300 s rather than 360**, so a restart costs five minutes at
 *     worst instead of six, and the hold is 29.4% of par instead of 35.3%;
 *   - **the reading speaks three times, not twice** — `t.thirdOut` at 100 s,
 *     `t.twoThirdsOut` at 200 s, `t.read` at 300 — and all three carry the same
 *     four clauses and their own arm state, so all three restart together. The
 *     only report of a restart the product can make is the line that does not
 *     arrive when the player expected it;
 *   - **`t.ourFloor` and `t.theirFloor` fire ONCE**, the first time each side
 *     stands on the disc, and say plainly what happened.
 *
 * The residual is real: a restart AFTER a stage has already spoken is silent,
 * because a non-repeating trigger cannot fire twice. It is written down rather
 * than papered over.
 *
 * ============================================================================
 * THE PAR, AND WHY THIS ONE HAS NO HARD FLOOR
 * ============================================================================
 * `pact.04`'s `DRILL` is an absolute clock, so 840 s is a floor no play can
 * beat. This operation has none: the reading cannot start until the hall is
 * taken, and how long that takes is the player's problem rather than the file's.
 * The par is therefore two measured components plus a judgement, and it is
 * labelled as one.
 *
 *     three more Artificers          30 s of queue, 1 500 credits
 *     home -> the hall, on foot      199.7 m at 3.6 m/s = 55.5 s
 *     two Glaive Posts, four hulls   7.3 s each at 16.50 dps a hull = 14.5 s
 *     ------------------------------------------------------------------
 *     the capture, uncontested       100.0 s, the walks overlapping the queue
 *     READ                           300 s, restarted by anything on the floor
 *
 * So a perfect run is a little over **6:40** and nothing in the table forbids
 * it. **The modal run is a judgement and is labelled as one: 12:00 to 15:00.**
 * Wave A lands at 4:00 and a player still fighting for the hall then is reading
 * against three more columns, each of which puts riflemen on the floor and
 * restarts the clock. 1 020 s is above that band on purpose, and the chapter
 * ramp is the other constraint: 780 / 840 / 900 / 960 / 1 020, which
 * `tests/campaign-length.spec.ts` checks for monotonicity.
 *
 * ============================================================================
 * THE WIN IS NOT HELD OPEN AND THE LOSS IS GUARDED
 * ============================================================================
 * `annihilationWin` would hand the player a victory for flattening the Sept base
 * at minute six with the archive still in Sept hands, and — worse — one for a
 * match in which the archive had already been shelled, since `Viability` counts
 * assets and knows nothing about which building this operation is named after.
 * `assetLossDefeat` is off for `pact.01`'s reason: the player opens with a full
 * base and could not plausibly hit zero assets before `t.lose` reads.
 *
 * `t.hallLost` carries `not objectiveComplete 'read'` and that is a guard on the
 * WHOLE TRIGGER rather than on the dialogue. `pact.01.shallow-road` records the
 * opposite case — its `not objectiveComplete 'bore'` exists because
 * `Session.setObjective` already refuses to un-resolve, so only the LINE needed
 * guarding. Here the effect being suppressed is `endOperation`, which no setter
 * refuses, and the count is out at the moment `t.read` fires: taking the match
 * away one tick later for losing a building whose contents have already been
 * broadcast would be a defeat the player had no way to act on.
 *
 * The two are disjoint by construction anyway — `t.read` needs
 * `ownerCount(0, …, min: 1)` and `t.hallLost` needs `entityDead`, so no tick can
 * satisfy both — and the ordering is stated because an author is meant to mean
 * which of two outcomes a coinciding tick reports.
 *
 * ============================================================================
 * THE MEASURED POINTS, AT `mapSeed` 18 355 / `simSeed` 3 571
 * ============================================================================
 * Read off a headless build AFTER `spawnBuilding` snapped every footprint, with
 * the def tables BOUND and the roster INSTALLED — which is
 * `tests/campaign-roster-ground.spec.ts`'s build and NOT
 * `tests/campaign-maps.spec.ts`'s, whose `buildOperation` passes no `defs` and
 * never calls `setCampaignRoster`, so every refusal counted above is inert there.
 *
 *     home 404, 132      foe 108, 132      axis 296.000      2 armies
 *     hall 240, 72       station 304, 84   house 196, 168    ROAD 204, 150
 *     Glaive Posts 262, 50  and  262, 98
 *     Sept riflemen 248.24, 84   252.24, 88   256.24, 84
 *
 *     home -> hall 174.63    foe -> hall  145.00    hall -> station  65.12
 *     hall -> house 105.60   ROAD -> hall  85.91    ROAD -> house    19.70
 *     home -> station 110.92 foe -> house  95.08    station -> house 136.82
 *
 *     hall -> post   31.113 and 34.059   (both past the 29.657 m firing bar)
 *     hall -> rifle  14.557, 20.145, 20.193  (all three inside FLOOR_R 24)
 *     post -> station 44.272 and 54.037  (both past the 31.577 m acquisition bar)
 *
 * `ROAD` is the only one of these that is not a structure, and it was SEARCHED
 * rather than chosen — see the `mapSeed` note. **RE-MEASURE IF EITHER SEED
 * MOVES.** Almost nothing fails loudly if these drift: the floor stops covering
 * the hall, the ore creeps inside it, the station falls inside a Glaive Post's
 * bar and dies at t = 0 with no message. `tests/campaign-spawn-ground.spec.ts`
 * is the one exception — it re-derives every ring point of all four waves and
 * fails by name if a drop lands on ground the wave's own locomotor cannot enter.
 * ========================================================================== */

import { Faction } from '../../../core/types';
import { minutes, seconds } from '../../types';
import type { Condition, OperationDef } from '../../types';

/* -- the measured points -------------------------------------------------- */

/**
 * The Conclave's Oculus, as PLACED. Every disc in this file is drawn on it.
 *
 * A `radar` on the SEPT's seat, so `ScenarioBuilder.keyFor` resolves it to
 * `mrdOculus`: 650 hp of `ArmorClass.Concrete`, 2x2, `sight: 46`, and
 * `EntityFlag.IsRadar` — which is why capturing it also puts the announcer's
 * `radarOnline` on the same tick as `buildingCaptured` and why this file scripts
 * no `eva` of its own.
 *
 * It is the same def key `pact.01.shallow-road` tags `mast` and destroys, and
 * `pact.04.in-the-clear` tags `mast` and protects. The chapter's third answer to
 * one building is to take it intact and use it.
 */
const HALL = { x: 240, z: 72 };

/**
 * The assessors' station, as PLACED. A `civOilDerrick` on the PLAYER's seat:
 * 900 hp, `ArmorClass.Concrete`, 2x2.
 *
 * 65.12 m behind the hall on the home side, 44.27 m from the nearest Sept Glaive
 * Post against that post's own 31.577 m bar, and 110.92 m from the player's
 * opening.
 *
 * **ITS BLURB — *"Pays its owner while it is held"* — IS LITERAL, AND THIS
 * COMMENT USED TO CALL IT FLAVOUR.** `src/sim/civilian.system.ts#payHolders`
 * matches on `st.defId[i] === binding.buildingId.civOilDerrick` (measured: both
 * are **51**) and skips only owners whose faction is `Faction.Neutral`, which
 * seat 0 is not. `CIVILIAN_INCOME` is 15 credits every 30 ticks — **900 a
 * minute, 15 300 over the 1 020 s par**. See the station block in the header for
 * what that does to the secondary's argument. It is NOT sellable — measured off
 * the built world, not read out of `FALLBACK_BUILDINGS` — so the player cannot
 * cash in the thing they are protecting either.
 */
const STATION = { x: 304, z: 84 };

/**
 * Where every Sept column forms up. 85.91 m of straight line and 98.7 m of real
 * path from the hall, 19.70 m from the chapterhouse it comes out of.
 *
 * SEARCHED, NOT CHOSEN. `ProductionService.spawnUnit` writes the ring point
 * VERBATIM — no `connectedGround`, no egress search — so the points that have to
 * be standable are the ring points themselves. The seven `spawnUnits` effects
 * below author **28 drops across 20 distinct points** (waves B and C share the
 * (4, 16) and (4, 24) rings, so eight drops land where another wave has already
 * dropped), and all 28 are open to the locomotor of the unit that lands on them
 * — Hover for `mrdSolarch`, Foot for `mrdWayfarer` and `mrdLancer`, resolved
 * through the same three tables `spawnUnit` reads.
 */
const ROAD = { x: 204, z: 150 };

/**
 * The reading floor: the disc that has to be clear of BOTH armies for the count
 * to be read out.
 *
 * DERIVED FROM THE TWO STAND-OFF BARS. A Sept rifleman shooting the hall parks
 * at 21.657 m of centre distance and a Sept hull at 26.457; 24 is the midpoint
 * of that window, 2.343 m above the first and 2.457 m below the second. So the
 * men have to be pushed off the floor and the hulls only have to be killed.
 *
 * **AND THE FIRING BAR IS THE SECOND HALF OF THE DERIVATION, WHICH THE FIRST
 * DRAFT LEFT OUT AND WHICH SHIPPED A DEFEAT.** `Combat.engage` fires at
 * `range + 5.6569` of centre — 25.657 m for a rifleman, **29.657 m for a Glaive
 * Post** — so a floor derived from the stand-off alone leaves an annulus in
 * which a Sept gun kills the archive from OUTSIDE the disc the player was told
 * to clear. Raising `FLOOR_R` past 26.457 would put the hulls on the floor too
 * and delete the doctrine, so the gun line moves instead: `GUN_SPREAD` is 24 in
 * `pact-open-count.ts` and the two posts stand at 31.113 and 34.059 m. **Move
 * either number and re-check the pair.** Measured before and after on a live
 * headless run: a captured hall went from DEAD at 28.1 s to 650 hp untouched
 * through 180 s.
 *
 * **PAIRED WITH `OCULUS_OFFSET` = 60 IN `pact-open-count.ts`, AND THE TWO
 * CONSTANTS LIVE IN DIFFERENT FILES.** The hall stands 60.00 m off the
 * opening-to-opening axis, so the axis clears this rim by 36.00 m and traffic
 * between the two bases cannot stop the primary. That is the deliberate
 * INVERSION of `pact.04.in-the-clear`'s pairing, which exists to make its axis
 * cut its disc. Move either number and check both notes.
 */
const FLOOR_R = 24;

/**
 * Five minutes of plates. Restarted by anything standing on the floor.
 *
 * **IT WAS SIX AND THE HOLD IS THE ONE THING NOTHING IN THE PRODUCT REPORTS.**
 * `runDirector` keeps `state.armedAt` per trigger and exposes it to no effect,
 * and `ui/objectives.system.ts` renders a campaign row as
 * `progress: { value: complete ? 1 : 0 }` — binary, no timer, no hold state. So
 * a restart at minute five of a six-minute hold produces NOTHING on screen: no
 * line, no bar, no announcer. That is not fixable inside the frozen vocabulary
 * and the honest answers are to make the hold shorter and to cut it into stages
 * that each say something. Both are taken. 300 s is 29.4% of the 1 020 s par
 * against 360's 35.3%.
 */
const READ = seconds(300);

/**
 * The two milestones, at a third and two thirds of the reading.
 *
 * Each carries the SAME four clauses as `t.read` and its OWN arm state, so all
 * three restart together — which is the only thing in the product that reports
 * a restart at all, and it reports it by SILENCE: the line the player was
 * expecting does not arrive. A non-repeating trigger cannot fire twice, so a
 * restart after a stage has already spoken is still silent. That residual is
 * real and is written down rather than papered over.
 */
const PLATES_1 = seconds(100);
const PLATES_2 = seconds(200);

/**
 * The four columns.
 *
 * Four minutes of quiet first — long enough to walk the base garrison the
 * 199.7 m up to the hall (26.3 s for a Solarch, 55.5 s for an Artificer), break
 * the two posts and spend the capture bill — then gaps of 3:30, 3:30 and 3:00.
 * The last one lands with the reading typically half run; see the par block.
 *
 * **EVERY ONE OF THE 28 HULLS THESE FOUR SPAWN REACHES THE FLOOR, WHICH WAS
 * MEASURED RATHER THAN READ OFF THE STAND-OFF TABLE.** See the "men are for the
 * floor" section of the header: a stand-off decides where a unit STOPS once it
 * has engaged, not whether it crosses, and a live 16-minute run put all 28
 * inside 24 m of the hall (closest approach 5 to 16 m). What waves C and D lack
 * is anything that REMAINS there — `mrdLancer` settles at 26.457 m — so wave B
 * is the one column that leaves men standing on the disc.
 */
const WAVE_A = minutes(4);
const WAVE_B = seconds(450);
const WAVE_C = minutes(11);
const WAVE_D = minutes(14);

/**
 * How long the layout is given to have placed the ground before any threshold
 * over it is believed.
 *
 * `entityDead` and a bare `ownerCount` max BOTH read TRUE against an empty tag
 * registry; the spelling changes and the trap does not.
 * `soviets.06.demolition-order` guards its own primary this way and
 * `pact.04.in-the-clear` inherits the constant.
 *
 * **IT IS DEFENCE AGAINST A LAYOUT THAT PLACED NOTHING, NOT AGAINST A TICK-ONE
 * READ THAT HAPPENS TODAY.** `scenarios.system.ts` builds the world inside
 * `async init()` and `SystemRegistry.init` awaits every module's init in
 * sequence before a tick is taken, so the registry is never empty when the
 * Director first runs. What IS reachable is a wrong def key or a footprint that
 * will not fit, and there twenty seconds is the difference between an operation
 * that ends before the camera settles and one that at least lets the player see
 * the ground it is lying about.
 */
const SETTLE: Condition = { on: 'elapsed', ticks: seconds(20) };

/**
 * The Sept's forward chapterhouse is off their books — levelled or taken.
 *
 * `ownerCount` rather than `entityDead`, for the reason in the header: the
 * player opens with an Artificer and both a barracks' prereqs standing, so a
 * capture is a real play, and under `entityDead` it would lose the secondary and
 * leave wave D spawning nine hulls off a building the player owned.
 *
 * Defined as ONE object each because the two triggers that read them must
 * partition every world state between them; two copies of a threshold is how
 * two triggers come to disagree about one world.
 */
const HOUSE_OFF: Condition = {
  on: 'all',
  of: [SETTLE, { on: 'ownerCount', player: 1, role: 'building', tag: 'house', max: 0 }],
};

/** The Sept still holds the chapterhouse. The exact complement of `HOUSE_OFF`. */
const HOUSE_HELD: Condition = {
  on: 'ownerCount', player: 1, role: 'building', tag: 'house', min: 1,
};

/** The player owns the hall. The tick-one-safe spelling, and capture-aware. */
const HALL_HELD: Condition = {
  on: 'ownerCount', player: 0, role: 'building', tag: 'oculus', min: 1,
};

/** Nothing of either army is standing on the reading floor. */
const FLOOR_CLEAR: readonly Condition[] = [
  { on: 'not', of: { on: 'unitsInArea', player: 0, area: { x: HALL.x, z: HALL.z, r: FLOOR_R }, min: 1 } },
  { on: 'not', of: { on: 'unitsInArea', player: 1, area: { x: HALL.x, z: HALL.z, r: FLOOR_R }, min: 1 } },
];

const op: OperationDef = {
  id: 'pact.05.open-count',
  chapter: 'pact',
  faction: Faction.Meridian,
  /*
   * A MIRROR MATCH, AND IT IS THE CHAPTER'S OWN SENTENCE FINISHED.
   *
   * `types.ts` says a mirror is legal and nothing in the campaign has taken it
   * yet. It is taken here because the argument's real opponent is not any of the
   * three armies the chapter has already fought. P1 fought the Allies because
   * they are *"the only one that would change its mind if shown the numbers"*;
   * P2 fought the army that WORKS this ground and P3 the army that BUYS it;
   * P4 went back to the Allies for the witness. None of them can stop the count
   * being published, because none of them owns it. **The Conclave does.**
   *
   * MECHANICALLY IT PINS THREE THINGS. All four waves spawn `mrdSolarch`,
   * `mrdWayfarer` and `mrdLancer` — authored Meridian hulls, literal and
   * unremapped, which `validateCampaign` checks against this field. `keyFor`
   * resolves the layout's `radar` to `mrdOculus`, its `pillbox` to `mrdGlaive`
   * and its `barracks` to `mrdChapterhouse` on BOTH seats, so the ground the
   * Sept holds is built out of the same rows the player builds from. And the
   * empty roster removes the same four defs from each side, which is measured in
   * the header and is a property no cross-faction operation can have.
   *
   * The cost of the mirror is that the counter-triangle does no work here — a
   * Solarch trades evenly with a Solarch by construction — so the fight is
   * decided by ground, numbers and the two metres of reach a Solarch has over a
   * Glaive Post. That is the intended shape and it is why the header spends its
   * length on geometry rather than on matchups.
   */
  foe: Faction.Meridian,
  index: 5,
  title: 'The Open Count',
  beat: 'The count read out from the Conclave\'s own instrument, which the Sept is holding and '
    + 'will not lend.',
  primaryType: 'capture-hold',
  // Objective state, one reveal, a camera move, four waves and four orders — so
  // 'bespoke' by the definition in `types.ts`. The label is about MECHANISM: what
  // makes this operation what it is is one building that has to change hands
  // without being broken, and that building exists before tick one.
  archetype: 'bespoke',
  parSec: 1_020,
  requires: ['pact.04.in-the-clear'],

  map: {
    /*
     * `urban` IS THE OTHER NAME BOTH VOCABULARIES SHARE, and the chapter's
     * fifth ground: tropical, temperate, arid/desert, snow, and now urban. It is
     * spelled out here for the reason `pact.04` spells out `snow` — the safety
     * is an accident of which word this preset uses and not a property anybody
     * can rely on for the next operation. `MAP_PRESETS` is keyed
     * `temperate | arid | tropical | snow | coast | urban | archipelago` and
     * `BiomeName` is `temperate | desert | snow | urban`; they overlap on three
     * and disagree on exactly one, and `reclamation.03.sold-twice` shipped on the
     * wrong side of that disagreement with every number in its headers taken on
     * ground it did not declare.
     *
     * It is also the ground the fiction wants: a yard town on the seam, which is
     * where a hearing is held and where an instrument that reaches the coast is
     * sited.
     */
    preset: 'urban',
    /*
     * Fixed, and pinned by `tests/campaign-maps.spec.ts` as a terrain
     * fingerprint. CHOSEN BY SURVEY: fourteen rolls were built headless at this
     * `simSeed`, with the roster installed, and read against three criteria —
     * how much of the reading floor is open ground, whether all 28 scripted
     * drops land on ground their own locomotor can enter, and the walked lengths
     * the four waves are paced by.
     *
     *     seed      floor open   drops closed   walk home->hall   walk ROAD->hall
     *     18 355     108 / 112       0 / 20          199.7 m           98.7 m
     *     51 744      98 / 112       0 / 20          199.7            162.3
     *     12 207     108 / 112      10 / 20          199.7             94.0
     *     47 026     108 / 112       4 / 20          199.7             98.7
     *     33 881     108 / 112      10 / 20          199.7          no route
     *     44 508     108 / 112      10 / 20          211.4            155.9
     *     55 871     101 / 112       6 / 20          199.7            187.7
     *     61 340      99 / 112      11 / 20          205.3            165.3
     *     41 119      92 / 112       1 / 20          202.0            187.2
     *     52 014      92 / 112       6 / 20          204.4            109.5
     *     29 163      94 / 112       7 / 20          202.0            247.9
     *     26 640      95 / 112      10 / 20          199.7            197.8
     *     37 729      82 / 112       3 / 20          199.7             99.4
     *     60 402      77 / 112       5 / 20          202.5            172.7
     *
     * 18 355 is the only roll that ties the best floor, drops all 28 hulls on
     * open ground AND keeps the column's walk close to its straight line
     * (98.7 m against 85.91, +14.9%). It wins on every criterion rather than on
     * one, which is the only kind of survey worth writing down. 51 744 is the
     * runner-up and its ROAD walk is 64% longer, which would push the armour
     * half of every wave from 13.0 s to 21.4 s and quietly change the operation.
     */
    mapSeed: 18_355,
    /*
     * The PAIR is chosen by this seed and not by the map roll. `seatedSlots`
     * filters `START_PAIRS` against the water, and `urban` has no `MAP_SEAS`
     * row, so all four survive; 3 571 draws an EDGE pair at **296.000 m** with
     * home at 404, 132 and the Sept at 108, 132. The edge rather than the
     * 386.16 m diagonal is deliberate: the hall stands 60 m off the axis, and on
     * the diagonal the same offset puts it either inside the contested ore patch
     * or 227 m from the player's opening, which turns a capture-and-hold into a
     * march.
     */
    simSeed: 3_571,
    armies: 2,
    biome: 'urban',
    opening: 'base',
    /*
     * BOTH SEATS. `Shell.applySimPostBoot` writes `setup.startingCredits` into
     * every non-Neutral slot, so this is one number doing two jobs — and in a
     * mirror match it is the same number buying the same things.
     *
     * It is sized against the capture bill. Three more Artificers is 1 500 and
     * leaves 3 500, which is four Solarchs with change or two Solarchs and four
     * more Glaive Posts; the cheap route spends nothing — the four Solarchs and
     * the one Artificer that take an archive to the gate in 7.0 s are all in the
     * opening garrison — and leaves the whole 5 000 against an archive at half
     * health. That is the decision the header opens with, and 5 000 is
     * the bank that makes both sides of it affordable rather than forced.
     *
     * **IT IS NOT THE PLAYER'S ONLY INCOME AND THIS COMMENT USED TO IMPLY IT
     * WAS.** The assessors' station is a live `civOilDerrick` on seat 0 paying
     * **15 credits a second** from tick one — 900 a minute, 15 300 over par —
     * so the opening bank buys the FIRST decision and the drip pays for the
     * consequences of it. That asymmetry is deliberate now that it is known: a
     * player who loses the station has bought the capture and nothing after it.
     * The Sept holds no derrick, so the drip is not mirrored.
     *
     * IT IS A PLATEAU AND NOT A RISE. The chapter runs 4 000 / 5 000 / 5 000 /
     * 5 000 / 5 000; what escalates is the clock and the columns, not the purse.
     */
    credits: 5_000,
  },
  layout: 'pact-open-count',

  outcome: { annihilationWin: false, assetLossDefeat: false, ignoreSeats: [] },

  /*
   * EMPTY ON BOTH SIDES. The header's roster block has the measurement — eight
   * entities removed, 233 against 241, four from each seat, and the one that
   * matters is `mrdHelios`: 33 m of `heliosLance` on the hall would out-range
   * every hull the player can bring by seven metres and delete the doctrine
   * argument this operation is built on.
   */
  roster: { player: [], ai: [] },

  /*
   * NO `captureProof`, AND IT WAS CHECKED RATHER THAN SKIPPED. The hall MUST be
   * capturable — that is the primary. The chapterhouse must stay capturable —
   * `HOUSE_OFF` counts an Artificer exactly as it counts a shell. And the
   * assessors' station is on the player's own seat, where `Capture.resolve`
   * takes the FRIENDLY branch ahead of the veto list anyway, and the only seat
   * that could take it never issues the verb: `src/sim/AI.ts` contains the
   * string `Capture` zero times. A veto here would forbid a play nobody can
   * make, which is the well-spelled no-op `validate.ts` refuses elsewhere.
   */

  objectives: [
    {
      /*
       * THE TITLE CARRIES BOTH HALVES, BECAUSE TWO TRIGGERS DECIDE THIS ROW.
       * `t.taken` completes it on `structureCaptured` and `t.hallLost` fails it
       * on `entityDead`, and a title naming only the capture would leave the
       * player no warning that the obvious way to soften a building is also the
       * way to lose the match. `pact.04.in-the-clear`'s `reading` row is the
       * same shape for the same reason.
       */
      id: 'hall',
      kind: 'primary',
      title: 'Take the Oculus off the Sept without breaking it',
    },
    {
      /*
       * NO DIGITS, AND THE RADIUS IS `FLOOR_R`'s TO OWN.
       * `tests/build-descriptions.spec.ts` bans numerals in `BUILD_DESCRIPTIONS`
       * and does not reach objective titles, so nothing in the suite would fail
       * if one were written here. The convention is honoured anyway: a second
       * copy of a measured number in prose is exactly the drift this file spends
       * three hundred lines refusing.
       */
      id: 'read',
      kind: 'primary',
      title: 'Read the count out with the floor clear of both armies',
    },
    {
      id: 'house',
      kind: 'secondary',
      hidden: true,
      // "Take off them" rather than "Level", because `HOUSE_OFF` counts a
      // capture exactly as it counts a demolition and the title has to mean what
      // the trigger tests.
      title: 'Take the Sept\'s forward chapterhouse off them',
      credits: 500,
    },
    {
      /*
       * 400 CREDITS IS THE TOKEN AND THE DRIP IS THE REWARD. The station pays
       * its owner fifteen credits a second (`civilian.system.ts#payHolders`,
       * `CIVILIAN_INCOME`), so the payout on this row is worth twenty-seven
       * seconds of the thing it is paying you to protect. That is not a badly
       * sized reward — it is a badly sized way of LOOKING at the reward, which
       * is that failing this secondary switches off nine hundred credits a
       * minute at the moment a Sept column is past the hall. The row stays
       * small on purpose, so the medal rather than the money is what it buys.
       */
      id: 'post',
      kind: 'secondary',
      title: 'Leave the assessors\' station standing',
      credits: 400,
    },
  ],

  triggers: [
    /* -- the opening word -------------------------------------------------
     * THREE BEATS, ONE SPEAKER EACH, TWELVE SECONDS APART. `Shell.playCampaignBeat`
     * keys its toast `campaign-${speaker}-${this.campaignBeatSeq}` with a
     * monotonic counter that is never reused, so nothing here would be destroyed
     * by landing on one tick — three paragraphs on adjacent ticks would simply be
     * three paragraphs nobody reads. Calvane states why the hall matters, Nael
     * states the ground and the two rules, Oreth states the Sept's case, which
     * this operation does not treat as wrong.
     *
     * The two reveals are `allies.01.sounding-line`'s shape: the whole problem
     * before any of it is a problem. 56 m on the hall covers both Glaive Posts
     * (31.11 and 34.06 m) and the whole floor; 36 m on the station covers the
     * ground the player will form up on. `revealArea` EXPLORES ground rather than
     * showing live units — `Vision.levelAt` returns `Remembered` for
     * `isStaticKind` only — so it shows the buildings and none of the Sept
     * infantry.
     */
    {
      id: 't.open',
      when: { on: 'elapsed', ticks: seconds(4) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Calvane',
          text: 'Survey 18-355. We have the depth, and we have a witness who is not ours, and '
            + 'we still have four hundred years of readings that nobody outside the Conclave '
            + 'has ever been allowed to look at. There is one set of those plates and one hall '
            + 'built to read them out, and they are the same building. The Sept is sitting on it.',
        },
        { do: 'revealArea', player: 0, area: { x: HALL.x, z: HALL.z, r: 56 } },
        { do: 'revealArea', player: 0, area: { x: STATION.x, z: STATION.z, r: 36 } },
      ],
    },
    {
      id: 't.brief',
      when: { on: 'elapsed', ticks: seconds(16) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Nael',
          text: 'Their Oculus, two Glaive Posts in front of it, and our assessors sixty-five '
            + 'metres back because that is as close as the Sept would let them come. Three rules '
            + 'and I will say them once. We take that building, we do not break it — an archive '
            + 'we have shelled proves nothing to anybody. They have a crew on the wall mending '
            + 'it faster than one engineer can knock it down, so send yours together or do not '
            + 'send them. And once it is ours, everything of ours comes off the floor.',
        },
      ],
    },
    {
      id: 't.sept',
      when: { on: 'elapsed', ticks: seconds(28) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Oreth, Warden of the Count',
          text: 'Oreth, for the Sept. I am not going to pretend I think you are wrong, Calvane. '
            + 'The number is the number. But the number is also where our crust stops being '
            + 'crust, which is where a cut works best, and the day every yard on this coast has '
            + 'it we stop being the only people who know where to dig. You are giving away the '
            + 'thing the Conclave has been for four hundred years. Come through me for it.',
        },
      ],
    },

    /* -- the hall changes hands -------------------------------------------
     * `structureCaptured` is `ownerOfTag(tag) === player`, which for an enemy
     * structure is exactly "the player took it" and cannot be satisfied by
     * anything else — the Sept has no way to hand it over and no way to take it
     * back, because `src/sim/AI.ts` never issues `Capture`.
     *
     * Two speakers on one tick is two chips; see the toast note above.
     */
    {
      id: 't.taken',
      when: { on: 'structureCaptured', tag: 'oculus', player: 0 },
      then: [
        { do: 'completeObjective', id: 'hall' },
        {
          do: 'dialogue',
          speaker: 'Calvane',
          text: 'It is ours and it is whole. Open the shutters and start at the first plate.',
        },
        {
          do: 'dialogue',
          speaker: 'Nael',
          text: 'Then everything off the floor. The hulls, the men, the engineers still standing '
            + 'on the step. Their posts are set too wide to reach the hall itself, so the disc is '
            + 'the whole of it — clear that and the plates run.',
        },
      ],
    },

    /* -- the floor, taught once from each side -----------------------------
     * NEITHER OF THESE REPEATS, AND THAT IS THE POINT. The Director exposes
     * ARMING to no effect, so there is no way to fire a beat every time the
     * reading restarts — "the clock went back" is not a world state any of the
     * twelve conditions names. What is expressible is the state that CAUSES it,
     * and firing once, the first time each side stands on the floor, is the
     * honest substitute: it teaches the rule at the moment it first bites and
     * then gets out of the way.
     *
     * Both are gated on the hall being held, because before the capture the floor
     * means nothing and a line about it would be noise. Both also carry a
     * three-second hold, which does two things: it stops a hull that is merely
     * crossing from earning a lecture, and it keeps the first of them off the
     * tick `t.taken` fires on — that trigger already pushes two chips and the
     * player has just been handed a building.
     */
    {
      id: 't.ourFloor',
      when: {
        on: 'all',
        of: [
          HALL_HELD,
          { on: 'unitsInArea', player: 0, area: { x: HALL.x, z: HALL.z, r: FLOOR_R }, min: 1 },
          { on: 'elapsedSinceArmed', ticks: seconds(3) },
        ],
      },
      then: [
        {
          do: 'dialogue',
          speaker: 'Nael',
          text: 'Ours are on the floor and the plates have stopped where they stopped. Back them '
            + 'off it and the reading picks up on its own — nobody has to be told twice, but '
            + 'somebody has to be told once.',
        },
      ],
    },
    {
      id: 't.theirFloor',
      when: {
        on: 'all',
        of: [
          HALL_HELD,
          { on: 'unitsInArea', player: 1, area: { x: HALL.x, z: HALL.z, r: FLOOR_R }, min: 1 },
          { on: 'elapsedSinceArmed', ticks: seconds(3) },
        ],
      },
      then: [
        {
          do: 'dialogue',
          speaker: 'Nael',
          text: 'Sept riflemen on the floor. Their hulls stop short of it and their men do not — '
            + 'that is the whole of the plan, and it costs us the reading every time it works. '
            + 'Clear them off and it resumes.',
        },
      ],
    },

    /* -- the four columns -------------------------------------------------
     * ONE TAG FOR ALL FOUR, WHICH IS A CHOICE AND NOT A SHORTCUT. `orderTagged`
     * re-points the survivors of every earlier wave as well, which is what a
     * commander does — and it is the honest spelling, because the order does NOT
     * survive the first brain pass: `AI_CADENCE.squad` is `round(30 / 5)` = 6
     * ticks and `AiBrain.regroupSquads` re-files every ungrouped hull into the
     * strike group and attack-moves it at the brain's OWN objective. The waves
     * still tend to arrive, because the brain's standing objective is the
     * player's base and the hall is between the two. **Do not build a timing
     * argument on an order an AI seat holds.**
     *
     * The camera move is the one in this file and it is spent on the FIRST
     * column, because the `house` secondary is unreadable until the player has
     * seen where the columns form. The reveal beside it, 56 m on `ROAD`, covers
     * the chapterhouse at 19.70 m and the widest drop ring at 26 m.
     */
    {
      id: 't.first',
      when: { on: 'elapsed', ticks: WAVE_A },
      then: [
        {
          do: 'dialogue',
          speaker: 'Nael',
          text: 'Column off their forward chapterhouse. Armour only, and they will be on the '
            + 'hall in thirteen seconds — hulls only, and a hull stops short of the floor '
            + 'even when it is shooting. Kill them and the plates keep running.',
        },
        { do: 'cameraMove', at: ROAD },
        { do: 'revealArea', player: 0, area: { x: ROAD.x, z: ROAD.z, r: 56 } },
        { do: 'spawnUnits', player: 1, key: 'mrdSolarch', count: 3, at: ROAD, spread: 14, tag: 'column' },
        { do: 'orderTagged', tag: 'column', order: 'attackMove', at: HALL },
        { do: 'setObjective', id: 'house' },
      ],
    },
    {
      id: 't.second',
      when: { on: 'elapsed', ticks: WAVE_B },
      then: [
        {
          do: 'dialogue',
          speaker: 'Oreth, Warden of the Count',
          text: 'Armour and riflemen this time. The men are not for your hulls, Calvane. The men '
            + 'are for the floor.',
        },
        { do: 'spawnUnits', player: 1, key: 'mrdSolarch', count: 4, at: ROAD, spread: 16, tag: 'column' },
        { do: 'spawnUnits', player: 1, key: 'mrdWayfarer', count: 4, at: ROAD, spread: 24, tag: 'column' },
        { do: 'orderTagged', tag: 'column', order: 'attackMove', at: HALL },
      ],
    },
    {
      id: 't.third',
      when: { on: 'elapsed', ticks: WAVE_C },
      then: [
        {
          do: 'dialogue',
          speaker: 'Nael',
          text: 'Launchers walking behind the armour. The tanks are what you answer and the '
            + 'launchers are what takes the roof off the archive — eighteen seconds apart, and '
            + 'the second eighteen is the one that matters.',
        },
        { do: 'spawnUnits', player: 1, key: 'mrdSolarch', count: 4, at: ROAD, spread: 16, tag: 'column' },
        { do: 'spawnUnits', player: 1, key: 'mrdLancer', count: 4, at: ROAD, spread: 24, tag: 'column' },
        { do: 'orderTagged', tag: 'column', order: 'attackMove', at: HALL },
      ],
    },
    {
      /*
       * GATED ON THE CHAPTERHOUSE STILL STANDING, which is what gives the
       * 500-credit secondary teeth beyond its payout: taking it off them deletes
       * nine hulls and the 152.10 dps that kills a full-health archive in 4.3 s.
       * It cannot collide with `t.house` below — that trigger requires
       * `ownerCount(1, …, max: 0)` and this one requires `min: 1`, so the two are
       * disjoint on every tick.
       */
      id: 't.fourth',
      when: { on: 'all', of: [{ on: 'elapsed', ticks: WAVE_D }, HOUSE_HELD] },
      then: [
        {
          do: 'dialogue',
          speaker: 'Oreth, Warden of the Count',
          text: 'Everything the chapterhouse had left. If the count is going to be common '
            + 'property, Calvane, let it be common property with a hole through it.',
        },
        { do: 'spawnUnits', player: 1, key: 'mrdSolarch', count: 5, at: ROAD, spread: 18, tag: 'column' },
        { do: 'spawnUnits', player: 1, key: 'mrdLancer', count: 4, at: ROAD, spread: 26, tag: 'column' },
        { do: 'orderTagged', tag: 'column', order: 'attackMove', at: HALL },
      ],
    },

    /* -- the paid secondary, resolved above the win ------------------------
     * `runDirector` returns immediately once an outcome is set, so a completion
     * written below `t.win` never fires and the medal never counts it —
     * `medalFor` gives silver only when EVERY secondary is complete.
     */
    {
      id: 't.house',
      when: HOUSE_OFF,
      then: [
        {
          do: 'dialogue',
          speaker: 'Calvane',
          text: 'Their chapterhouse is off the books. The Sept can still come, but it comes from '
            + 'their own line now, and it comes late.',
        },
        { do: 'completeObjective', id: 'house' },
      ],
    },

    /* -- the reading ------------------------------------------------------
     * `elapsedSinceArmed` IS A HOLD TIMER AND THE DIRECTOR EVALUATES THIS
     * TRIGGER TWICE FOR IT. Pass one forces the timer true and asks whether the
     * other three clauses hold, which sets or clears the arm tick; pass two
     * compares against that tick. So losing the hall, or letting either army
     * stand on the floor, at minute four of a five-minute reading RESTARTS the
     * clock. That is deliberate and it is the direction that costs the player
     * rather than the one that hands them a win for holding nothing.
     *
     * **THREE TRIGGERS, ONE CLOCK, AND THAT IS THE ONLY REPORT THE PRODUCT CAN
     * MAKE.** `t.thirdOut` (100 s), `t.twoThirdsOut` (200 s) and `t.read` (300)
     * carry the SAME four clauses and each keeps its own arm state, so all three
     * restart together — and since `runDirector` hands `armedAt` to no effect
     * and `ui/objectives.system.ts` renders a campaign row as a binary
     * complete/incomplete, a stage line that does not arrive when the player
     * expected it is the whole of the feedback. Each fires once; a restart after
     * a stage has already spoken is silent. That residual is real, is not
     * expressible in the frozen vocabulary, and is why `READ` is 300 rather than
     * the 360 this file shipped with.
     */
    {
      id: 't.thirdOut',
      when: { on: 'all', of: [HALL_HELD, ...FLOOR_CLEAR, { on: 'elapsedSinceArmed', ticks: PLATES_1 }] },
      then: [
        {
          do: 'dialogue',
          speaker: 'Nael',
          text: 'First third is out. Anyone with a receiver on this coast has the shallow plates '
            + 'now, and the shallow plates are the ones the yards can check for themselves.',
        },
      ],
    },
    {
      id: 't.twoThirdsOut',
      when: { on: 'all', of: [HALL_HELD, ...FLOOR_CLEAR, { on: 'elapsedSinceArmed', ticks: PLATES_2 }] },
      then: [
        {
          do: 'dialogue',
          speaker: 'Calvane',
          text: 'Two thirds. Two hundred and seventy years of it, in the open, to anybody on this '
            + 'coast with a receiver and a grievance. Keep the floor and it finishes itself.',
        },
      ],
    },

    /* -- the losses -------------------------------------------------------
     * ABOVE `t.read`, and disjoint from it by construction rather than by
     * ordering: `t.read` needs `ownerCount(0, …, min: 1)` and `t.hallLost` needs
     * `entityDead`, so no tick can satisfy both. The ordering still matters for
     * the reader — an author is meant to mean which of two outcomes a coinciding
     * tick reports, and stating it is cheaper than re-deriving it.
     *
     * **`entityDead` IS CORRECT HERE AND `ownerCount` WOULD BE WRONG, WHICH IS
     * THE OPPOSITE CALL FROM `HOUSE_OFF` ABOVE.** The objective is that the
     * archive STANDS, not that anybody in particular holds it. A player who has
     * taken it satisfies this and so does one who has not got there yet;
     * `t.read` is the trigger that cares about ownership.
     */
    {
      id: 't.postLost',
      when: { on: 'all', of: [SETTLE, { on: 'entityDead', tag: 'post' }] },
      then: [
        { do: 'failObjective', id: 'post' },
        {
          do: 'dialogue',
          speaker: 'Nael',
          text: 'The assessors\' station is gone, and with it the standing account it was '
            + 'paying us out of. Whatever we read out now we read out to ourselves, which '
            + 'is the position we have been in for four hundred years.',
        },
      ],
    },
    {
      /*
       * THE GUARD IS ON THE WHOLE TRIGGER, NOT ON THE DIALOGUE, and the
       * difference from `pact.01.shallow-road`'s superficially identical clause
       * is the effect being suppressed. There the setter already refused to
       * un-resolve a completed objective and only the LINE needed guarding; here
       * the line is `endOperation`, which nothing refuses. The count is out at
       * the moment `t.read` fires and the win lands one tick later, so a rule
       * that took the match away in between would be a defeat with nothing left
       * to act on.
       */
      id: 't.hallLost',
      when: {
        on: 'all',
        of: [
          SETTLE,
          { on: 'entityDead', tag: 'oculus' },
          { on: 'not', of: { on: 'objectiveComplete', id: 'read' } },
        ],
      },
      then: [
        { do: 'failObjective', id: 'hall' },
        { do: 'failObjective', id: 'read' },
        {
          do: 'dialogue',
          speaker: 'Oreth, Warden of the Count',
          text: 'You have shelled the archive. Congratulations — you have made the count exactly '
            + 'as secure as I wanted it and exactly as worthless as you were afraid it would be.',
        },
        {
          do: 'dialogue',
          speaker: 'Calvane',
          text: 'Log the hour. Log the plates lost. Log that they were lost by us.',
        },
        { do: 'endOperation', result: 'loss', reason: 'read' },
      ],
    },

    /* -- the count goes out ------------------------------------------------ */
    {
      id: 't.read',
      when: { on: 'all', of: [HALL_HELD, ...FLOOR_CLEAR, { on: 'elapsedSinceArmed', ticks: READ }] },
      then: [
        { do: 'completeObjective', id: 'read' },
        {
          do: 'dialogue',
          speaker: 'Calvane',
          text: 'That is the last plate. Four hundred years, read at the top of our voice, off '
            + 'an instrument the Conclave built to keep it quiet.',
        },
        {
          do: 'dialogue',
          speaker: 'Oreth, Warden of the Count',
          text: 'I logged it with you, for the record. Every yard on this coast now has the '
            + 'depth at which our crust stops being crust. You were right and we are poorer, '
            + 'and neither of those stops being true tomorrow.',
        },
      ],
    },
    {
      /*
       * ABOVE `t.win` AND ON THE SAME TICK AS IT. Objective state is written by
       * the SINK after the whole Director pass, so `objectiveComplete 'read'` is
       * not visible until the tick after `t.read` fires — which is why both of
       * these resolve at READ + 1 and why this one has to be written first.
       *
       * `entityAlive` rather than `not objectiveFailed`, because the question is
       * about the ground: the station is standing at the moment the count goes
       * out. `Session.setObjective`'s refusal to un-resolve is a second layer
       * under it rather than a substitute.
       */
      id: 't.post',
      when: {
        on: 'all',
        of: [{ on: 'objectiveComplete', id: 'read' }, { on: 'entityAlive', tag: 'post' }],
      },
      then: [
        { do: 'completeObjective', id: 'post' },
        {
          do: 'dialogue',
          speaker: 'Nael',
          text: 'The assessors have it whole, and they took it standing on ground we held for '
            + 'them. That is the difference between a reading and a rumour.',
        },
      ],
    },
    {
      id: 't.win',
      when: { on: 'objectiveComplete', id: 'read' },
      then: [
        {
          do: 'dialogue',
          speaker: 'Aubray, on an open channel',
          text: 'Aubray, Continental Works. I have your count and my own instrument agrees with '
            + 'it to the metre, which means I cannot say your people wrote it. The Timetable was '
            + 'drawn against the wrong crust. I will not enjoy saying that out loud, and I am '
            + 'going to say it out loud.',
        },
        { do: 'endOperation', result: 'win' },
      ],
    },

    /* -- the other loss ----------------------------------------------------
     * `playerBeaten` is `Viability.isBeaten` — nothing to build with and nothing
     * to fight with — not "you have no buildings". The player opens with a full
     * base, so the two readings agree for most of the match; they stop agreeing
     * at exactly the moment it matters, which is a commander down to one
     * Chapterhouse and a Glaive Post who can still walk an Artificer up the road.
     */
    {
      id: 't.lose',
      when: { on: 'playerBeaten', player: 0 },
      then: [{ do: 'endOperation', result: 'loss', reason: 'read' }],
    },
  ],
};

export default op;
