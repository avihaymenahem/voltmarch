/**
 * ============================================================================
 * P8 — STRUCK OFF
 * ============================================================================
 * P7's win says exactly what it bought and no more: *"at the hour it lapses and
 * the parcel goes back on the register for somebody to survey again. That is all
 * we bought. It is enough."* It was not enough for nine days. The Ninth's
 * allocation lapsed with its two collars; the salvage house bought the collars
 * as scrap, read the same register the Order made public, and took the parcel
 * out again — with a replacement head already on a cradle on the works road.
 *
 * **THE ORDER CANNOT STOP THIS TWICE.** The mirror is spent: two charges at
 * 2 500 credits and the Chapterhouse's bank went with them, which is why
 * `map.credits` is **0** and `opening: 'force'` — see the opening block. And it
 * cannot take the parcel back, for P7's reason, which has not changed and never
 * will: taking it back is the one move that unmakes the concession, and the
 * concession is the only reason the count is true for anybody outside the Order.
 *
 * So what is left is the thing the Order has been avoiding for seven operations.
 * A works needs a site, and the only titled ground on that parcel is the pan's —
 * eleven houses, a well and an infirmary, entered on the allocation book by the
 * Order's own hand at the end of P7 (*"Enter the eleven houses on it before you
 * hand it back"*). A tenanted holding is what has been stopping a cut all week.
 * Cregg's answer is to clear the tenants. **The Order's answer is to clear them
 * first, and to strike the holding itself** — so that the parcel carries no title
 * at all, no works can ever be raised on it, and the count stays true because the
 * ground stays nobody's.
 *
 * That is the last thing the Order had to give and it was never the Order's:
 * four hundred years of readings stay in the book, and the eleven families who
 * took them come off the crust. **Struck off** is what the register calls it.
 *
 * ============================================================================
 * WHY `primaryType: 'escort'`, AND WHAT IT HAS TO DIFFER FROM
 * ============================================================================
 * `types.ts` gives the six verbs a briefing may use and names two of them for
 * this shape: **`reach` is `unitsInArea`** and **`protect` is a loss on the
 * thing that must survive**. Eleven households have to walk 151 to 168 m of
 * open ground with nothing but the column between them and four columns off a
 * works camp, and the operation is named after whether they get there. Two
 * escorts are shipped, so a third has to say what it is that neither of them is.
 *
 *   - **`pact.03.concession`** carried four hundred years of PLATES off this
 *     crust with three bearers. The subject was the record and the bearers were
 *     its container — *"an escort whose subject cannot die is not an escort"*.
 *   - **`soviets.08.carriage-forward`** is the shape this one is closest to and
 *     the one it has to answer: three lifts of four `engineer`s, nine of twelve
 *     standing inside a disc, `unitsInArea` with a tag. That is the same verb
 *     counted the same way and it would be dishonest to pretend otherwise.
 *
 * **WHAT IS DIFFERENT IS THE DIRECTION, AND THE DIRECTION IS WHAT THE
 * CONCESSION DOES TO IT.** S8's twelve walk TOWARD a working the escort walks
 * onto with them; the whole operation is getting somewhere together. Here the
 * eleven begin at the place that is the problem and walk AWAY from it, and the
 * escort **may not stand where they start**. Measured on the real Foot cost
 * grid, the worst drop of each lift spends 83.3, 93.7 and 69.0 metres inside a
 * disc a Pact hull cannot occupy for forty-five seconds without failing the
 * bonus, and only the remaining 72 to 82 m of the walk is ground the column may
 * cover from. No other escort in this game has a first leg its escort is
 * forbidden to be on.
 *
 * And the chapter has walked this road before, in the other direction and with
 * the other cargo: **P3 carried the readings off the crust and left the people
 * on it.** That rhyme is the argument rather than a repetition, and it is why
 * this is an escort and not something invented to avoid being one.
 *
 * **IT IS DELIBERATELY NOT `assault`**, which is what the second primary looks
 * like on its own: the player may raze the salvage house's entire opening and be
 * no closer to walking a single household off the parcel. It is not
 * `capture-hold` — nothing is held against a clock; the hold timer counts
 * against the player rather than for them, which is the inversion the whole file
 * turns on.
 *
 * **AND `opening: 'force'` IS WHAT MAKES THE ESCORT SCARCE RATHER THAN MERELY
 * LONG.** The three lifts land at authored ticks and the head sits 122.93 m
 * across country from the muster, so the column is asked to be in two places
 * against clocks it does not set — and there is no second column to send and no
 * queue to buy one from. Measured on the built ground, at the shipped speeds.
 * **EVERY `walked` FIGURE IS THE CHEAPEST CHAIN THE RECONSTRUCTOR RETURNS**, and
 * ties in the cost grid move it by about a metre either way; the closest-approach
 * and exposure figures below are taken over the whole cost-optimal SET instead,
 * which is trap 18's rule and does not move:
 *
 *     muster -> an Arcspitter Post, to its own standoff  102.7 m  13.5 s at 7.6
 *     muster -> the head, driven onto the collar         137.5 m  18.1 s
 *     the lift the pan walks                          151-168 m  44.5 to 49.5 s
 *     a Reclamation column, stage -> muster              207.1 m  35.7 s at 5.8
 *
 * `soviets.02.common-standard`'s hulls and `allies.07.fair-copy`'s engineers are
 * both budgets you spend down. This column is one you cannot spend at all — the
 * same eighteen hulls at minute twenty as at minute zero if nothing shoots them
 * — and it is still scarce, because it is only ever in one place. Those two
 * files own `fixed-force` as a TYPE and this one borrows only the opening; see
 * the opening block below.
 *
 * Every number below is derived from the shipped `Defs.ts`, `Combat.ts`,
 * `ARMOR_MATRIX`, `COMBAT_DAMAGE` and `config.ts`, or read off a headless build
 * at this operation's seeds with the def tables BOUND and this operation's
 * roster INSTALLED. **RE-DERIVE, DO NOT RE-QUOTE**, after any retune or re-seed.
 *
 * ============================================================================
 * THE SAME GROUND AS P7, ON PURPOSE, AND IT IS THE SAME GROUND EXACTLY
 * ============================================================================
 * `mapSeed` 20 130 and `simSeed` 3 733 are `pact.07.thin-place`'s, unchanged.
 * That is a claim with teeth rather than a convenience: terrain is a function of
 * `mapSeed` and the reserved start shelves, and `startPointsFor(2, null, 3 733)`
 * is the same call in both files, so **the heightfield, the two openings and the
 * ore are identical to the metre.** Read off both builds:
 *
 *     home 108, 380     foe 404, 132     axis 386.161     the diagonal pair
 *     terrace 354, 300  well 364, 312    infirmary 340, 286
 *
 * — the three holdings land on the same three points P7's header publishes,
 * because the layout asks for the same three points and `spawnBuilding` snaps
 * them the same way against the same relief. Nine days later on the same pan is
 * therefore true of the pixels and not only of the prose.
 *
 * **WHAT IS NOT THE SAME IS SEAT 1.** The foe is the Reclamation here, so
 * `buildBaseFor` raises `rclFoundry` / `rclSorter` / `rclBreakerYard` /
 * `rclRookery` / four `rclFurnace` / two `rclHeap` / `rclSpotter` / nine
 * `rclBarricade` and three `rclSpitpost` where P7 had a Soviet opening, and
 * `keyFor` resolves the layout's `pillbox` to an ARCSPITTER POST rather than to
 * a Sentry Gun. And P7's two `civOreMine` collars are gone from the parcel
 * entirely — the salvage house bought them and hauled them, which is the
 * fiction's reason and is also why the parcel measures **740 cells, 710 open**
 * here against P7's 740 / 702.
 *
 * ============================================================================
 * THE ELEVEN, AND WHY THEY ARE `engineer` AND NOT A PACT KEY
 * ============================================================================
 * Three lifts of four, four and three, spawned by `spawnUnits` on **seat 0**
 * out of the three holdings they live in, on a 16 m ring — and every one of the
 * eleven ring points is open to `Locomotor.Foot`, checked against the real cost
 * grid at radii from 10 to 22 m, so the ring is not sitting on a knife edge.
 *
 * **`engineer` IS `Faction.Neutral`, WHICH IS THE WHOLE POINT OF THE KEY.**
 * `EffectSink.spawnUnits` resolves through `ProductionCatalog.byKey` with no
 * `keyFor`, so what lands is the literal `engineer` def — 90 hp, `Locomotor.Foot`,
 * 3.4 m/s, no `GUNNER` flag, unarmed — wearing seat 0's colours because
 * `store.alloc` takes the DEF from the key and the COLOUR from the seat. The pan
 * are not the Order's army and the def says so; `validateCampaign` passes a
 * Neutral row on any seat for exactly that reason. A `mrdArtificer` would have
 * been a Pact key doing the same job and saying something false.
 *
 * **AND THE MOMENT THEY ARE OURS THEY ARE TRESPASSING.** `runtime.ts#unitsInArea`
 * counts `EntityKind.Infantry` and `EntityKind.Vehicle` owned by the seat it is
 * asked about, and asks nothing else — not the ground, not
 * `EntityFlag.Garrisoned`, not whether the unit is armed. So a household the
 * Order has taken onto its books is a Pact body standing on ground the Order
 * signed away, and `t.concessionLost` is armed by the rescue itself. That is the
 * operation in one sentence and it is not a loophole: **the Order breaks its own
 * rule to get them off, three times, in the open, and it is only allowed to
 * because it leaves.**
 *
 * ============================================================================
 * THE HOLD TIMER IS THE WHOLE MECHANIC, AND THE GRACE IS DERIVED
 * ============================================================================
 * `elapsedSinceArmed` disarms the moment the last seat-0 unit leaves the disc,
 * which is what makes a CROSSING free and an OCCUPATION expensive. So the grace
 * has to be longer than the longest crossing and shorter than a comfortable one.
 * Measured by flood-filling the real `FlowFieldCache.costGridFor(MoveClass.Foot)`
 * — `rebuildCost` itself rather than a mirror of it, 8-connected, edge weight
 * `step * (cost[a] + cost[b]) / 2 / COST_UNIT`, diagonals refused at a cut
 * corner — then walking the reconstructed path and stopping at the first cell
 * outside the 62 m rim. Worst ring point of each lift:
 *
 *     lift        worst drop     inside the rim      to the muster
 *     terrace  4    368, 298      83.3 m  24.5 s     155.7 m  45.8 s
 *     well     4    380, 312      93.7 m  27.6 s     168.2 m  49.5 s
 *     infirmary 3   358, 288      69.0 m  20.3 s     151.4 m  44.5 s
 *
 * **THE GRID REALLY REFUSES THINGS, AND THAT WAS CHECKED RATHER THAN ASSUMED.**
 * `COST_BLOCKED` is exported from `src/world/terrain-gen.ts` and NOT from
 * `src/core/config.ts`; imported from the wrong module it is `undefined`, every
 * `nc >= undefined` is false, and a Dijkstra that walks through buildings
 * returns plausible, uniformly slightly-short routes and a green test. The
 * control is the count: **3 281 of 16 384 cells are `COST_BLOCKED` on the Foot
 * grid, 3 360 on Wheel and 3 293 on Hover** — three different numbers, which a
 * grid that could not see walls could not produce.
 *
 * So the failure is **45 seconds** against a worst crossing of 27.6, which is
 * 17.4 s of slack — and the warning is **18 seconds**, which is under the
 * FASTEST crossing (20.3 s) and therefore fires on the first lift every time. It
 * is the teaching beat rather than an alarm, it is not `repeat`, and it is
 * placed there deliberately: nothing else on any screen can tell a player that
 * their own rescue starts a clock. Add `accel` — `max(2.4, 3.4 * 1.15)` = 3.91
 * m/s², so about 0.87 s of ramp — and the two margins are 16.5 s and 5.6 s.
 *
 * **PARKING A HULL ON THE PARCEL TO COVER THE WALK FAILS THE BONUS**, and that
 * is the cruelty the whole chapter has been building to rather than an
 * oversight. The escort is allowed to shoot from off the rim and nowhere else.
 *
 * ============================================================================
 * WHERE THE ENEMY WALKS, MEASURED ON THE ROUTE AND NOT ON THE CHORD
 * ============================================================================
 * Every scripted column forms at `STAGE` and is pointed at the muster. The
 * question that decides whether the escort is a fight or a helpless watch is
 * whether that road crosses the parcel, and **the straight line answers it
 * wrongly in the dangerous direction**: the chord from `STAGE` to the muster
 * passes 103.1 m from the parcel centre (41.1 m clear of the rim), while the
 * route the engine's own expander actually produces bends inward and passes
 * **90.6 m from the centre — 28.6 m outside the rim**. Twelve and a half metres
 * of clearance that a chord would have credited and the ground does not.
 *
 * **THAT 90.6 IS TAKEN OVER THE WHOLE COST-OPTIMAL SET, NOT OFF ONE CHAIN**,
 * which is trap 18's rule: 263 cells lie on some cheapest `STAGE -> MUSTER`
 * route and 90.6 m is the nearest of them, on Wheel and on Foot alike, at
 * (290, 234). **The first version of this block published 82.0 m and 20.0 m of
 * clearance and the layout's own §5 published 90.6 and 28.6 in the same commit**
 * — one file disagreeing with the other, with the re-seed checklist guarding the
 * wrong one, which is exactly the drift a header full of numbers exists to make
 * findable. The chord it was compared against was also the chord to the STATION
 * (99.6 m) rather than to the muster the columns are actually ordered to.
 *
 * It is still outside, which is what the operation needs: **the Order can meet
 * every column on ground it is allowed to stand on.** 207.1 m of Wheel path is
 * 35.7 s at an `rclGrinder`'s 5.8 m/s and 57.5 s at an `rclPicker`'s 3.6, so a
 * wave arrives in two parts twenty-two seconds apart.
 *
 * **DO NOT BUILD A TIMING ARGUMENT ON THE SCRIPTED ORDER.** `AI_CADENCE.squad`
 * is `round(30 / 5)` = 6 ticks and `AiBrain.regroupSquads` re-files every
 * ungrouped hull into the strike group and attack-moves it at the brain's OWN
 * objective. Here that costs nothing and is worth stating rather than working
 * around: **`opening: 'force'` leaves the Order exactly two buildings and both
 * of them stand at the muster**, so the brain's own objective and the authored
 * one are the same piece of ground.
 *
 * ============================================================================
 * THE HEAD: ONE STRUCTURE, TWO ROUTES, AND A WRENCH ON THE OTHER SIDE
 * ============================================================================
 * The replacement head is a `civOreMine` on seat 1's books — **700 hp,
 * `ArmorClass.Concrete`, 2x2** — standing at 272, 192, which is 134.40 m from
 * the parcel centre and therefore **72.40 m outside the rim**. Nothing about
 * taking it touches the concession, which is the entire reason the objective
 * exists on that spot: *stopping a lawful excavation from off the ground* is a
 * sentence about geometry here and not a figure of speech.
 *
 * `focusLance` is **16.500 delivered dps into Concrete** — 60 damage, one round,
 * 1.6 s, through `ARMOR_MATRIX[ArmorPiercing][Concrete]` 0.55 and
 * `COMBAT_DAMAGE.globalMul` 0.80 — and `sunLance` is 17.400. Against that the
 * salvage house holds the PLAYER'S OWN WRENCH: `AiBrain.repairBase` walks every
 * alive, finished building the seat owns, filtering on owner, kind, `Alive`,
 * `!PendingDestroy`, `!UnderConstruction` and `maxHp > 0` and on nothing else. A
 * `civOreMine` passes all six, which `pact.07.thin-place` measured on this same
 * ground against this same def: `setRepairing(seat 1, head, true)` returns TRUE
 * and thirty ticks of `RepairSellService.simTick` restore **30.000 hp for 7.500
 * credits**, exactly `REPAIR_RATE` 30 at `REPAIR_COST_PER_HP` 0.25. That figure
 * is CITED from P7 rather than re-driven here; the arithmetic below is this
 * file's.
 *
 * The drip does not arm until the collar is under `AI_REPAIR.startFraction`
 * 0.75, so the first 175 hp are free and the clock is `175 / dps` and only then
 * `525 / (dps - 30)`:
 *
 *     shooting it                dps      undripped     with the wrench
 *     one Solarch               16.5       42.4 s       NEVER — it parks at 525
 *     two Solarchs              33.0       21.2 s       180.3 s
 *     three Solarchs            49.5       14.1 s        30.5 s
 *     four Solarchs             66.0       10.6 s        17.2 s
 *     all six                   99.0        7.1 s         9.4 s
 *     six and three Lancers    151.2        4.6 s         5.5 s
 *
 * **AND THE WRENCH HAS A PRICE GATE THAT `credits: 0` MAKES REAL FOR ABOUT A
 * MINUTE.** `AI_REPAIR.minCredits` is 400 and `repairBase` returns above it
 * without doing anything at all, so at a zero opening bank the head is undripped
 * until the salvage house has banked four hundred. `buildBaseFor` ships it two
 * `rclScrapper` and `src/data/Civilians.ts` prices a harvester at 429-700
 * credits a minute against `tests/harvester-soak.spec.ts`, so that is inside the
 * first minute and the honest summary is that the right-hand column is the one
 * that applies. Both are printed because a player who breaks the economy first
 * gets the left one.
 *
 * ============================================================================
 * THE PICKET, AND THE ORDER THAT BEATS IT NAMES THE POST AND NOT THE HEAD
 * ============================================================================
 * **THE CRADLE IS GUARDED BY FIVE THINGS AND AN EARLIER DRAFT OF THIS BLOCK
 * NAMED TWO.** Two Arcspitter Posts stand 17.20 m and 19.80 m from the head on
 * opposite bearings — `postCoil`, 20 m, `power: 0` so no brownout opens them,
 * `chainCount: 1`, one pull 43.52 then 26.11 against a 110 hp `mrdWayfarer`, so
 * `tests/campaign-emplacement-reach.spec.ts` §2 is satisfied with room rather
 * than by the row not chaining at all. **AND THREE `rclPicker` STAND ON THE
 * COLLAR** at 16.03, 19.09 and 27.27 m of it, `Stance.Defensive`, 85 hp each,
 * `arcProd` 14 m — placed by the layout's own loop and missing from both headers
 * until they were measured back off the built world. Against a Solarch's 2.79 m
 * hull radius a Picker reaches **16.79 m** and a post reaches **22.79 m**;
 * against a 0.234 m infantry radius, 14.23 and 20.23. **The envelope is
 * `w.range` plus the TARGET's own `hitRadius` and nothing else** — `Combat.engage`
 * subtracts only the victim's extent — so a single "22.5 m" for both hull classes,
 * which is what the first draft used, is right for neither.
 *
 * **`approach()` DOES NOT ROUTE TO A STANDOFF CELL, AND THE FIRST INSTRUMENT
 * HERE MEASURED A ROUTE THE ENGINE NEVER ISSUES.** `Targeting.managesGoal` is a
 * two-state test and `AttackMove` is not one of them: `OrderKind.Attack` writes
 * `UnitState.Attacking`, and `approach()` then writes **the target's own centre**
 * into `orderX/orderZ` — its header says why, the flow-field cache buckets by
 * goal CELL and a sliding standoff point would evict a field every tick — and
 * parks the hull the tick surface distance first reaches
 * `range * APPROACH_STOP_FRAC` 0.80. So the hull walks the ORDINARY route at the
 * collar and stops on it; it never picks a cell.
 *
 * That distinction is worth up to 8.9 m of margin and it changes the sign of the
 * answer. Against the head (`hitRadius` 5.6569, so a stop circle of
 * 20.8 + 5.6569 = **26.457 m** of centre distance for `focusLance` and
 * `sunLance`, 21.657 for `pulseCarbine`) the two instruments disagree
 * completely:
 *
 *     THE OLD ONE, which still reproduces exactly and means nothing:
 *       open Hover cells at 26.457 +- 2 m of the head              38
 *       of those, outside 22.79 m of BOTH posts                    13   (14 at 22.5)
 *       cheapest Hover route from the muster to one of them   102.9 m
 *       metres of THAT route inside a post's envelope           0.0 m
 *       CONTROL, both 22.79 m discs shut from the muster:
 *         cells inside the 26.457 m stop circle still reachable      11
 *         closest reachable approach to the head                17.20 m
 *
 *     WHAT `approach()` ACTUALLY DOES, over the cost-optimal set:
 *       park cells reachable on a cheapest muster -> head route      5
 *       their bearings off the head                        85.6-114.4 deg
 *       their surface distance to the NEAR post, less 20 m  -8.37..+0.53 m
 *       their surface distance to the nearest Picker             6.0-9.3 m
 *
 * **FOUR OF THE FIVE ARE INSIDE THE NEAR POST, ALL FIVE ARE INSIDE A PICKER AND
 * TWO ARE INSIDE TWO.** Sampling the 26.457 m ring at half a degree, **63.9% of
 * it lies inside a post's envelope** (covered 0-113.0, 168.5-282.0, 356.5-360), and the
 * bearing from the head to the muster is **112.0 degrees — one degree short of
 * the free window**. So the claim was never structural: it was bearing-specific,
 * and the bearing lands on the wrong side of the line.
 *
 * **THE DOCTRINE THAT SURVIVES IS THE ONE THAT NAMES THE POST**, and it is
 * arithmetic rather than ground. A Solarch given `OrderKind.Attack` on an
 * Arcspitter Post parks at `26 x 0.80 + hitRadius(1x1)` = 20.8 + 2.8284 =
 * **23.6284 m** of centre distance, and `postCoil` reaches 20 + 2.79 =
 * **22.7900**. **Margin 0.8384 m, with no terrain in it** — it is `focusLance`'s
 * eight metres of doctrinal reach spent on the one target whose own footprint is
 * small enough to leave a gap. Walked on the real Hover grid it holds: the hull
 * parks at (261.83, 218.17) after **102.7 m**, 20.77 m of surface distance
 * against the post's 20, having spent **0.0 m** of the approach inside either
 * post; the far post is 40.36 m away; the second post is taken the same way from
 * (237.83, 190.17) after 120.7 m, again 0.0 m exposed. An `mrdLancer` has 3.39 m
 * of margin (its radius is 0.234). **An `mrdWayfarer` has -1.41 m and cannot do
 * it at all** — `pulseCarbine` is 20 m, the same as the gun it is standing off.
 *
 * **THE PICKERS ARE NOT BEATEN BY THAT AND THEY ARE NOT MEANT TO BE.** At the
 * near post's standoff two of the three are inside `arcProd` (9.50 and 12.50 m
 * of surface distance against 14), and a hull under an explicit Attack order
 * **will not answer them**: `Targeting.resolveTarget` returns the moment a live
 * ordered target resolves, so the Solarch keeps shooting the post while 19.76
 * lands on it every 1.05 s per Picker, 18.82 delivered dps each into
 * `ArmorClass.Light`. The answer is the half of the column that has no order on
 * it — six `mrdWayfarer` at **37.50 delivered dps into `ArmorClass.Infantry`
 * each**, so an 85 hp Picker is 2.27 s of one rifle — and the ordinary
 * acquisition they are left to. That is the sequence the brief teaches: posts
 * with the lances, Pickers with the carbines, collar last.
 *
 * **AND DRIVING ONTO THE COLLAR IS STILL THE WORST OF THE THREE.** Attack-moved
 * at the ground instead, the walk is **137.5 m with 32.0 m inside at least one
 * post's envelope** (29.2 m for an infantry radius), which at a Solarch's 7.6 m/s
 * is 4.21 s of fire, and it ends with the hull under BOTH posts and all three
 * Pickers. One post bearing is 30.400 delivered dps into `ArmorClass.Light` and
 * both are 60.8, so the transit alone is **128.0 to 256.0 damage on a 330 hp hull
 * — 39% to 78% of it, per hull** — and the bracket is stated rather than
 * collapsed because the two envelopes overlap only in a lens near the collar and
 * the exposure figure counts a metre once for either.
 *
 * So the brief names the order (`t.aim`, unconditional, minute one), which is
 * `pact.06.common-ground`'s lesson about a doctrine that only exists once the
 * order is named — and it names the TARGET, which is the half this file got
 * wrong first time and had to be measured out of.
 *
 * ============================================================================
 * WHAT THE SALVAGE HOUSE DOES TO NINETY HIT POINTS, AND THE MUSTER IS THE
 * KILLING GROUND ON PURPOSE
 * ============================================================================
 * **THIS FILE DERIVED WHAT THE PLAYER SHOOTS AND NOT WHAT THE PLAYER IS SHOT
 * WITH, AND THE OPERATION IS NAMED AFTER THE ELEVEN UNARMED MEN IT LEFT OUT.**
 * `engineer` is 90 hp, `ArmorClass.Infantry`, `Locomotor.Foot`, 3.4 m/s. Both of
 * the Reclamation's weapons on this map are `WarheadClass.Tesla`, whose Infantry
 * cell is **1.60** — the highest number in the whole matrix — and both chain:
 *
 *     grinderArc  70 dmg, cd 1.9, chainCount 2 -> THREE links
 *                 70 x 1.60 x 0.80          = 89.60   (a household lives on 0.40 hp)
 *                 x teslaChainFalloff 0.6   = 53.76
 *                 x 0.36                    = 32.256
 *                 47.16 delivered dps on the primary victim, 5 hulls = 235.8
 *     arcProd     26 dmg, cd 1.05, chainCount 1 -> TWO links
 *                 33.28 then 19.97, 31.70 delivered dps, 6 men = 190.2
 *
 * **ONE TRIGGER PULL IS THREE HOUSEHOLDS AND THE PRIMARY'S MARGIN IS TWO.** The
 * arc jumps to the nearest un-hit hostile within `COMBAT_WEAPONS.teslaChainRange`
 * **9.0 m** of the PREVIOUS victim, and `orderTagged('household', 'move', MUSTER)`
 * sends all eleven to one point — so the chain radius is smaller than the crowd
 * by construction. The second pull, 1.9 s later, kills the first man outright and
 * finishes the two the falloff softened.
 *
 * **AND THERE IS A CHANNEL WITH NO DAMAGE ROLL IN IT AT ALL.** `rclGrinder`
 * carries `EntityFlag.Crusher` and `crushLevel` 5; the household carries
 * `EntityFlag.Crushable` and `crushableBy` 1 — from `FALLBACK_UNITS.engineer`,
 * because the shipped `engineer` def's own `flags` field is **0** and
 * `ProductionService.spawnUnit` ORs the fallback's flags in unconditionally.
 * `CRUSH.minSpeed` is 0.6 against a Grinder's `maxSpeed` 5.8, and
 * `crushPassesThrough` deletes the steering separation for the pair, so an
 * attack-moving Grinder **runs a household down by driving over him**. Nothing
 * about hit points enters it.
 *
 * **SO THE MUSTER IS THE KILLING GROUND, AND THAT IS THE DESIGN RATHER THAN AN
 * OVERSIGHT.** `SHELTER` is r 20 on `MUSTER` and every column is attack-moved at
 * `MUSTER`, so the disc nine households must stand in is the disc four columns
 * are pointed at. Three things make it a fight rather than an execution, and all
 * three are measured elsewhere in this header: `focusLance` is **26 m against
 * `grinderArc`'s 18**, so the Order meets a column eight metres before it can
 * answer; the road is **28.6 m outside the rim**, so the Order may legally stand
 * on the whole of it; and a wave arrives in two parts **21.8 s apart** — 207.1 m
 * is 35.7 s at an `rclGrinder`'s 5.8 and 57.5 s at an `rclPicker`'s 3.6 — so the
 * armour is met before the infantry rather than with it.
 *
 * **THE DISH IS NOT COVER AND IT WOULD BE DISHONEST TO CALL IT THAT.** It stands
 * 11.66 m from the muster and 22 to 41 degrees off the enemy's own inbound
 * bearing (measured 40, 20 and 10 m back along the real Wheel chain), which is
 * about five metres of lateral offset against an 18 m gun. It is where the
 * households are told to stand, not what they stand behind.
 *
 * **MOVING THE SCRIPTED DESTINATION WOULD BUY NOTHING AND WAS REJECTED FOR A
 * MEASURED REASON.** `AiBrain.regroupSquads` re-files every ungrouped hull the
 * brain owns into the strike group and attack-moves it at the BRAIN's objective,
 * and `opening: 'force'` leaves the Order exactly two buildings, both of them at
 * the muster. So pointing `orderTagged` anywhere else changes where the column
 * forms up and not where it goes; the note under WHERE THE ENEMY WALKS says the
 * same thing from the other side. The honest lever is the escort, and the honest
 * statement is this one: **losing three of the eleven loses the primary, and one
 * unanswered Grinder inside the shelter disc is three.**
 *
 * ============================================================================
 * A HEAD CAN BE TAKEN INSTEAD, AND THE COLUMN CARRIES ONE FEWER MAN THAN THAT
 * NEEDS
 * ============================================================================
 * `t.head` reads `ownerCount(1, 'building', 'head', max: 0)`, not `entityDead`,
 * which is trap 9's fix and changes what the objective MEANS: a captured head is
 * not cutting, so ownership is the honest question and the title says "take off
 * them" rather than "level".
 *
 * The soften ladder alone does not reach it. `Capture.resolve` spends an
 * engineer knocking `maxHp * CAPTURE.softenFrac` (0.25) off through
 * `ARMOR_MATRIX[HighExplosive][Concrete]` (1.00) **and `COMBAT_DAMAGE.globalMul`
 * (0.80)** — a flat 0.20 of max, so 700 -> 560 -> 420 -> 280, and the FOURTH
 * `mrdArtificer` captures. **The column carries three.** Quoting `softenFrac`
 * without `globalMul` understates that by one man and two headers in this repo
 * shipped that way.
 *
 * What the three ARE enough for is the mixed line: shoot the collar under
 * `CAPTURE.captureHpFrac` 0.50 — 350 hp — and one Artificer takes it outright,
 * for 500 credits of column and no further shooting. **Keep firing until he is
 * in the doorway**: the wrench puts 30 hp/s back, so a collar stopped at 349
 * crosses back over the gate in 0.033 s. The same three men take an Arcspitter
 * Post the same way (520 hp, under 260) and turn it on the crew that built it,
 * which is the only thing in this operation that pays a hull back.
 *
 * ============================================================================
 * WHAT THE ROSTER DOES, AND IT IS ALL ON ONE SIDE
 * ============================================================================
 *     player: []      ai: []
 *
 * An empty pair, which is `pact.04.in-the-clear`'s argument — profile-
 * independent, the same ground on a finished account as on a fresh one — and
 * here it is load-bearing on the AI's side alone, because `opening: 'force'`
 * means seat 0 places nothing tagged for an allow-list to withhold. Every hull
 * in the column is an UNTAGGED def on purpose (`mrdSolarch`, `mrdLancer`,
 * `mrdWayfarer`, `mrdArtificer` carry no `unlockedBy`), so an empty
 * `roster.player` cannot silently shorten it — `ScenarioBuilder.spawnUnit` asks
 * `isBuildable` and SKIPS a refused def with no throw and no log, which is how a
 * roster typo deletes a fixed force in silence.
 *
 * **WHAT `ai: []` WITHHOLDS IS THE WHOLE BALANCE OF A TWENTY-MINUTE MATCH
 * AGAINST EIGHTEEN HULLS THAT CANNOT BE REPLACED.** The Reclamation rows in
 * `UNLOCK_TAGS` are `rclPylon` (`struct.defence.specialist`), `rclCrucible`
 * (`struct.tech`), `rclSlaghurler` (`unit.specialist`), `rclSpitter`
 * (`unit.raider`), `rclHornet` (`unit.air`), `rclBaron` (`unit.commander`),
 * `rclDepot` (`struct.support`) and `rclStormworks`
 * (`struct.superweapon.siege`) — so the salvage house is capped at Grinders,
 * Pickers, Slaggers and Arcspitter Posts for the duration. The one that matters
 * most is the first: 28 m of `pylonArc` with `chainCount` 3 and 120.32 on the
 * first link would kill the 110 hp Wayfarers AND the 90 hp households outright,
 * and a Pylon founded anywhere near the muster would end the escort. Delete
 * either empty list and one appears.
 *
 * ============================================================================
 * THE OPENING, AND WHY IT IS ZERO
 * ============================================================================
 * `opening: 'force'` and `credits: 0`. The layout calls `buildBaseFor` for seat
 * 1 and not for seat 0 — there is no third `START_CONDITIONS` member and there
 * must not be, since `'force'` in the SKIRMISH lobby would seat a player who
 * cannot build. The Order's whole estate on this map is **an `mrdOculus` at
 * 236, 300 and an `mrdSolarArray` at 248, 312**, and the second one is not
 * decoration: the dish draws -40 and the array produces +160, so the grid runs
 * at **+120** and `EvaLine.lowPower` never fires. Without it the announcer would
 * report a deficit every forty-five seconds for twenty minutes, which is the
 * kind of defect a trigger table cannot see and a boot can.
 *
 * **`credits: 0` BINDS THE SALVAGE HOUSE TOO.** `Shell.applySimPostBoot` writes
 * `setup.startingCredits` into every non-Neutral slot, so one number does two
 * jobs: the Order has nothing left after the mirror, and Cregg opens with
 * nothing banked and has to mine every credit of the twenty minutes out of two
 * `rclScrapper`. It is also what makes the wrench gate above bite for the first
 * minute.
 *
 * **NO SECONDARY PAYS CREDITS, AND THAT IS A DECISION.** `ObjectiveDef.credits`
 * goes through `Economy.grant` into a bank with no build queue, no repair (the
 * wrench needs a bank AND a structure worth mending) and no production behind
 * it, so a payout here is a number on a HUD. `allies.07.fair-copy` and
 * `soviets.02.common-standard` — the two other `credits: 0` operations — pay
 * none either. What a secondary is worth is the silver medal: `medalFor` gives
 * it only when EVERY secondary is complete, so `every` and `concession` together
 * are the price of it.
 *
 * ============================================================================
 * NEITHER SHIPPED OUTCOME RULE MAY END THIS
 * ============================================================================
 * `annihilationWin` would hand the player a victory for razing a base they were
 * never told to touch, at whatever minute the last `rclBarricade` fell, with
 * eleven households still standing on the crust. `assetLossDefeat` is off for
 * `soviets.02.common-standard`'s measured reason rather than the received one:
 * `countLivingAssets` walks `Building`, `Vehicle` AND `Infantry`, so eighteen
 * hulls at t = 0 are eighteen assets and the ten-second grace was never the
 * hazard — the hazard is that the authored losses below are strictly tighter,
 * so the shipped rule could only ever fire into a match this table has already
 * ended.
 *
 * **`playerBeaten` IS A WEAKER READ HERE THAN IT LOOKS AND `t.lose` SAYS SO.**
 * The eleven households are `EntityKind.Infantry` on seat 0, so
 * `Viability.isBeaten` — nothing to build with and nothing to fight with — stays
 * FALSE while a single unarmed civilian is alive. That is not a bug to route
 * around: it is why the operation's real losses are `t.panLost` and the two at
 * the hour, and `t.lose` is the backstop for the state where even they are gone.
 *
 * `SETTLE` guards the one zero threshold in the table. `ownerCount(1, 'building',
 * 'head', max: 0)` reads TRUE against an empty tag registry exactly as
 * `entityDead` does — the spelling changes and the trap does not. It is defence
 * against a layout that placed NOTHING rather than against a tick-one read that
 * happens today: `scenarios.system.ts` builds the world inside `async init()`
 * and `SystemRegistry.init` awaits every module's init in sequence before a tick
 * is taken. What IS reachable is a wrong def key or a footprint that will not
 * fit, and `tests/campaign-roster-ground.spec.ts` is the gate that catches the
 * cause.
 *
 * ============================================================================
 * THE PAR IS A BAND, NOT A CLOCK
 * ============================================================================
 * `NOTICE` is twenty minutes and it is a DEADLINE rather than the win: `t.win`
 * latches once both primaries are complete, whenever that is. That is a
 * different relationship from `pact.07.thin-place`, whose win reads AT its
 * notice so that 1 140 s is what every run takes, and it is deliberate — the
 * chapter should not close with two operations in a row whose whole clock is one
 * absolute tick.
 *
 * **THE FLOOR IS `WIN_EARLIEST` = 14:00 AND IT IS AUTHORED RATHER THAN
 * INCIDENTAL.** The natural floor is the third lift's walk — it lands at 12:00
 * and its worst drop covers 151.4 m at 3.4 m/s, so the ninth household cannot be
 * on station ground before **12:44** however well the operation is played — and
 * a win that fired the tick after it left the tenth and eleventh still walking,
 * which made the `every` secondary unreachable in the ordinary case. Driving the
 * real `runDirector` is what showed that; `WIN_EARLIEST` is 70 s of clearance
 * over the last measured arrival, and it is the honest floor.
 *
 * `parSec` **1 200** sits six minutes above it because the modal run does not go
 * straight from the third lift to the win — it has a column on the road at 13:00
 * and, if the cradle is still standing, another at 17:00. The chapter runs
 * 780 / 840 / 900 / 960 / 1 020 / 1 080 / 1 140 / 1 200, which
 * `tests/campaign-length.spec.ts` checks for monotonicity.
 *
 * ============================================================================
 * NO `eva` AT ALL, AND THAT IS ARGUED RATHER THAN FORGOTTEN
 * ============================================================================
 * `types.ts` says most scripted announcer lines are punctuation, because
 * `audio.system.ts` already speaks the ordinary events, and here it covers every
 * moment this table could want one. `unitLost` is spoken for a household dying
 * and `forcesUnderAttack` for a column arriving on them; `structureLost` is
 * spoken if the dish or the array goes, and `buildingCaptured` if the player
 * takes the head, which is one of the two authored routes. The fifth line —
 * `reinforcements`, the one `types.ts` names as earning its place — is the only
 * candidate the announcer has no event for, and it is a lie over eleven
 * civilians walking out of their houses. So this operation scripts none, and the
 * three lifts are carried by `dialogue` and one `cameraMove` instead.
 *
 * ============================================================================
 * THE MEASURED POINTS, AT `mapSeed` 20 130 / `simSeed` 3 733
 * ============================================================================
 * Read off a headless build AFTER `spawnBuilding` snapped every footprint, with
 * the def tables BOUND and the roster INSTALLED — which is
 * `tests/campaign-roster-ground.spec.ts`'s build and NOT
 * `tests/campaign-maps.spec.ts`'s, whose `buildOperation` passes no `defs` and
 * never calls `setCampaignRoster`.
 *
 *     parcel centre 352, 300 r 62      station 236, 300      muster 226, 306
 *     terrace 354, 300   well 364, 312   infirmary 340, 286
 *     head 272, 192      posts 282, 206 and 258, 178
 *     guards 267.94, 207.51 / 256.91, 203.70 / 245.89, 199.89   (three rclPicker)
 *     stage 331.35, 140.29
 *
 *     station -> parcel 116.00   (54.00 m outside the rim)
 *     muster  -> parcel 126.14   (64.14; the shelter's nearest point is 44.14 out)
 *     head    -> parcel 134.40   (72.40)
 *     home -> station 150.94 straight, 180.6 walked
 *     home -> head    249.48 straight, 263.7 walked
 *     muster -> head  122.93 straight, 137.5 walked onto the collar
 *     muster -> the near post's own standoff             102.7 walked
 *     the Wheel road, stage -> muster   207.1 walked, 90.6 off the parcel centre
 *
 * `STAGE` was SEARCHED rather than chosen, because `ProductionService.spawnUnit`
 * writes the ring point VERBATIM — no `connectedGround`, no egress search — so
 * the points that have to be standable are the ring points themselves. The four
 * `spawnUnits` rings the presses use are (4, 14) and (5, 18) on Wheel for the
 * `rclGrinder` halves and (5, 22) and (6, 26) on Foot for the `rclPicker`
 * halves; **84 of 961 candidates on a 2 m grid in a 60 m box clear all four**,
 * and the authored point is one of them rather than the nearest survivor of a
 * bad guess.
 *
 * **NO ORE CHECK IS NEEDED HERE AND P7 NEEDED ONE.** Its concession block worries
 * that a field inside the rim would fail the bonus in silence, because a
 * harvester is an `EntityKind.Vehicle` and its player owned two. This player
 * owns none and can build none, so the only seat-0 units that can ever stand on
 * that parcel are ones the commander sent or the lifts the table spawns. The
 * geometry is unchanged in any case: `addStartOre` puts the contested patch on
 * the centroid of the two openings, 256, 256 at r 22, which is 105.60 m from the
 * parcel centre and therefore **83.60 m at its nearest edge, 21.60 m outside the
 * rim** — the same figure P7 measured, re-derived here from the same call.
 *
 * **RE-MEASURE IF EITHER SEED MOVES.** Almost nothing fails loudly if these
 * drift: the lifts' crossings creep past the grace and the concession fails
 * itself, the enemy road creeps inside the rim and the escort becomes a
 * spectator sport, the head creeps into the parcel and the primary starts
 * costing the bonus. `tests/campaign-spawn-ground.spec.ts` is the one exception
 * — it re-derives every ring point of every wave and fails by name if a drop
 * lands on ground that wave's own locomotor cannot enter.
 *
 * ============================================================================
 * EVERY ENDING WAS DRIVEN THROUGH THE REAL `runDirector`, AND THREE OF THEM
 * CAME BACK WRONG
 * ============================================================================
 * Ten scripts, each stepping a `WorldQuery` through a plausible match and
 * reading what the Director appended. Trap 26's instruction, and it earned its
 * cost twice. The FIRST pass **won the operation at 7:52** on a threshold of
 * eight, put **four dialogue beats with two from one speaker** on the winning
 * tick, and made `every` unreachable by ending the match while the tenth and
 * eleventh households were still walking. The SECOND pass — the one this table
 * now covers — found that **the eight scripts it had listed never drove the
 * CONJUNCTION**: both primaries open at the hour is the ordinary total failure,
 * and it put two contradicting Cregg paragraphs on one losing tick. See the
 * comment above `t.latePan`. What the table does now, driven, in ticks:
 *
 *     script                                            last tick     beats
 *     head at 5:00, all eleven walk in                  25200 win       2
 *     nine of eleven, head at 13:20                     25200 win       2
 *     concession failed at 2:45, then won               25200 win       2
 *     three of the eleven die                           27000 loss pan  1
 *     BOTH primaries open at the hour                   36000 loss pan  1
 *     the pan never arrives, the head taken at 10:00    36000 loss pan  1
 *     the cradle stands at the hour, the pan in         36000 loss head 1
 *     the head taken ON the hour tick, the pan short    36000 loss pan  2
 *     the ninth arrives ON the hour tick          36000 pan, 36001 win  1 + 2
 *     the ninth arrives ON it and the head stands 36000 pan, 36001 head 1 + 1
 *     `playerBeaten` at 10:00                           18000 loss pan  0
 *
 * **FOUR ROWS ARE FALSIFIERS RATHER THAN CASES.** The total failure is the one
 * this file got wrong. The ninth household stepping into the shelter on the
 * exact tick `NOTICE` lands is the same-tick race `t.latePan`'s `not PAN_IN`
 * clause exists for; with the head down it resolves as a WIN one tick later, and
 * with the head still standing it resolves as the HEAD's defeat one tick later
 * rather than as the pan's — which is what `t.lateHead`'s new
 * `objectiveComplete('pan')` clause is worth, and neither is visible from
 * reading the table. The two-beat row is the mirror image and is fine: Nael
 * reporting the cradle clear and Cregg calling the hour are different speakers
 * saying compatible things. And the `playerBeaten` row ends with no dialogue at
 * all, which is correct for a backstop and is the one ending whose emptiness is
 * deliberate.
 *
 * ============================================================================
 * WHAT WAS TRIED AND CUT, SO NOBODY RE-DERIVES IT
 * ============================================================================
 *   - **A THRESHOLD OF EIGHT.** Cut because lift A plus lift B is exactly
 *     eight, so the third lift never has to leave the terrace — driven, the
 *     operation won at **7:52**. `soviets.08.carriage-forward` states the same
 *     rule about its own twelve and this file walked into it anyway.
 *   - **A WIN THAT READS `HEAD_OFF` AND `PAN_IN` DIRECTLY.** Cut twice over:
 *     the world reads are live, so a household shot after the primary latched
 *     would make the win unreachable, and the tick that completed the head also
 *     satisfied the win and put four dialogue beats on it.
 *   - **AN `elapsedSinceArmed` HOLD ON THE WIN**, which is the obvious way to
 *     pace an ending. Cut for `pact.06.common-ground`'s costed reason:
 *     `Session.setObjective` refuses to un-resolve a resolved row, so a player
 *     who steps out mid-hold LOSES with the objective showing COMPLETE.
 *     `WIN_EARLIEST` is an absolute clock instead, which has no such state.
 *   - **`primaryType: 'fixed-force'`**, which is what the opening is and what
 *     the first draft of this file called it. Cut when `pact.09` claimed the
 *     type and `validateCampaign` refused the adjacency — and `escort` is the
 *     better name anyway, because it names what the operation is ABOUT rather
 *     than what its budget looks like. The opening is still `'force'`.
 *   - **A `revealArea` ON THE PARCEL AT EACH LIFT.** Cut because
 *     `Vision.exploreCircle` is permanent, so the first reveal is the only one
 *     that does anything and the other two would be inert lines in the table.
 *
 * **AND THE THREE NUMBERS THIS FILE IS LEAST SURE OF**, named rather than
 * buried:
 *
 *   1. **NINE OF ELEVEN.** The margin is two households over three lifts, and
 *      whether two is generous or cruel depends on how much of the road the
 *      column can actually cover while the head is 123 m the other way. It is
 *      forced above eight and below eleven; where it sits between them is
 *      judgement.
 *   2. **FORTY-FIVE SECONDS OF GRACE.** Derived as 17.4 s over the worst
 *      measured crossing, but the crossing was measured on an EMPTY road. A
 *      household that stops to be shot at spends longer inside the rim than any
 *      flood fill can predict, and the failure is a bonus rather than the
 *      operation, which is the only reason the number is allowed to be a guess.
 *   3. **EIGHTEEN HULLS AGAINST A MINING ECONOMY FOR TWENTY MINUTES.** The
 *      column cannot be replaced and the salvage house's two `rclScrapper` are
 *      worth 429-700 credits a minute each; `roster.ai` caps what that buys at
 *      Grinders, Pickers, Slaggers and Arcspitter Posts, and `credits: 0` starts
 *      them at nothing. Whether that lands as tense or as hopeless is the one
 *      thing here no headless build can answer.
 * ========================================================================== */

import { Faction } from '../../../core/types';
import { minutes, seconds } from '../../types';
import type { Area, Condition, OperationDef, Point } from '../../types';

/* -- the measured points -------------------------------------------------- */

/**
 * The parcel the Order signed away in P6, as PLACED, and it is P7's disc
 * unchanged — same centre, same radius, same seeds. See the header: the point
 * of reusing the pair is that this really is the same ground.
 */
const PARCEL: Area = { x: 352, z: 300, r: 62 };

/** The three holdings, as PLACED. Each is a lift's drop point. */
const TERRACE: Point = { x: 352, z: 298 };
const WELL: Point = { x: 364, z: 312 };
const INFIRMARY: Point = { x: 342, z: 288 };

/**
 * Where the pan is walked to: the Order's reading station, 116.00 m from the
 * parcel centre and 54.00 m outside the rim.
 *
 * `MUSTER` is the point every lift is ordered to and `SHELTER` is the disc the
 * primary counts in. r 20 puts the disc's nearest point 106.14 m from the
 * parcel centre — **44.14 m outside the rim** — so no household can ever be
 * counted as arrived and trespassing at the same time.
 */
const MUSTER: Point = { x: 226, z: 306 };
const SHELTER: Area = { x: MUSTER.x, z: MUSTER.z, r: 20 };

/** The replacement head on its cradle, as PLACED. 72.40 m outside the rim. */
const HEAD: Point = { x: 272, z: 192 };

/**
 * Where every Reclamation column forms up.
 *
 * SEARCHED, NOT CHOSEN — 84 of 961 candidates on a 2 m grid land all four press
 * rings on ground their own locomotor can enter, and this is one of them. See
 * the header.
 */
const STAGE: Point = { x: 331.35, z: 140.29 };

/* -- the clocks ----------------------------------------------------------- */

/** The hour the works break ground. A DEADLINE; the win latches before it. */
const NOTICE = minutes(20);

/** The three lifts. Four, four and three. */
const LIFT_A = minutes(2);
const LIFT_B = seconds(420);
const LIFT_C = seconds(720);

/** The columns off the works camp. */
const PRESS_A = seconds(240);
const PRESS_B = seconds(510);
const PRESS_C = seconds(780);
const PRESS_D = seconds(1020);

/**
 * The earliest tick the win may read, and it exists so that finishing the job
 * does not cut the last two households off from the `every` secondary.
 *
 * DERIVED FROM THE WALK. Lift C lands at 12:00 and its worst drop walks 151.4 m
 * at 3.4 m/s — 44.5 s — so the last of the eleven cannot still be on the road
 * after **12:50** unless something is shooting at them. 14:00 leaves 70 s over
 * that, which is the slack an escort under fire actually needs. It is also the
 * operation's par FLOOR: no run can end before it.
 */
const WIN_EARLIEST = seconds(840);

/**
 * Long enough after the last lift that every household that is going to arrive
 * has, so a shortfall read here is a real one rather than a walk in progress:
 * `LIFT_C` plus 180 s against a 44.5 s walk.
 */
const COUNTED = seconds(900);

/**
 * How long the layout is given to have placed the ground before the one zero
 * threshold over it is believed. Defence against a layout that placed nothing,
 * not against a tick-one read that happens today. See the outcome block.
 */
const SETTLE: Condition = { on: 'elapsed', ticks: seconds(20) };

/** The head is off the salvage house's books — broken, or taken. */
const HEAD_OFF: Condition = {
  on: 'all',
  of: [SETTLE, { on: 'ownerCount', player: 1, role: 'building', tag: 'head', max: 0 }],
};

/**
 * The head is still theirs. The exact complement of `HEAD_OFF` over an integer
 * count, so no tick can satisfy both.
 *
 * `min: 1` alone reads FALSE against an empty tag registry, which is the safe
 * direction for both of its readers — the late loss does not fire and the
 * fourth column does not spawn — so it needs no `SETTLE` of its own.
 */
const HEAD_STANDS: Condition = {
  on: 'ownerCount', player: 1, role: 'building', tag: 'head', min: 1,
};

/** A Pact unit — including a household the Order has taken in — is on the parcel. */
const TRESPASS: Condition = { on: 'unitsInArea', player: 0, area: PARCEL, min: 1 };

/**
 * Enough of the pan is on the station's ground.
 *
 * **NINE OF ELEVEN, AND EIGHT WAS TRIED AND MEASURED WRONG.**
 * `soviets.08.carriage-forward` states the rule this file had to rediscover:
 * *"Eight would end the operation at minute seven. Lift A plus lift B is exactly
 * eight men, so a threshold of eight is a win the third lift never has to leave
 * the ramp for."* The same arithmetic holds here — four and four is eight — and
 * driving the real `runDirector` with the eight in it won the operation at
 * **7:52**, before the third lift had spawned and with the `every` secondary
 * unreachable for the rest of the match. NINE is forced from both sides: any
 * number above eight makes lift C compulsory, and eleven would collapse this row
 * and `every` into one and make a single stray shell fatal. Nine leaves a margin
 * of **two**, which is one household per lift after the first, and it is the
 * number this file is least sure of.
 */
const PAN_IN: Condition = {
  on: 'unitsInArea', player: 0, area: SHELTER, min: 9, tag: 'household',
};

/**
 * The whole job: the head off them and the pan off the crust.
 *
 * TWO READERS AND THEY MUST NOT DRIFT — `t.concession` completes the paid
 * secondary on it and `t.win` ends the operation on it, one line apart, and a
 * secondary resolved below an outcome is a secondary the medal never counts.
 *
 * **IT READS TWO OBJECTIVE LATCHES AND A CLOCK, AND ALL THREE ARE THERE
 * BECAUSE DRIVING THE REAL `runDirector` FOUND WHAT HAPPENS WITHOUT THEM.**
 *
 *   - `objectiveComplete('pan')` rather than `PAN_IN` a second time, because
 *     `unitsInArea` is a LIVE count: a household shot at the muster after the
 *     primary latched would take it back below nine and make the win unreachable
 *     for the rest of the match. `Session.setObjective` refuses to un-resolve a
 *     resolved row, so the objective is the latch and the world is not.
 *   - `objectiveComplete('head')` rather than `HEAD_OFF`, for a PACING reason
 *     rather than a correctness one. With the world read here, the tick that
 *     completed the head also satisfied the win, and the driven trace put FOUR
 *     dialogue beats on it with two of them from one speaker — which is the
 *     defect `pact.06.common-ground` shipped. Reading the latch guarantees the
 *     win is at least one tick after whichever primary lands last.
 *   - **`WIN_EARLIEST` IS THE ONE THAT WAS A BUG RATHER THAN A BLEMISH.**
 *     Without it the win fires the tick after the ninth household arrives, and
 *     the tenth and eleventh are still walking — so `t.every` never got a chance
 *     to fire, the silver medal was unreachable in the ordinary case, and
 *     nothing anywhere would have said so. `medalFor` gives silver only when
 *     EVERY secondary is complete.
 */
const DONE: Condition = {
  on: 'all',
  of: [
    { on: 'elapsed', ticks: WIN_EARLIEST },
    { on: 'objectiveComplete', id: 'head' },
    { on: 'objectiveComplete', id: 'pan' },
  ],
};

const op: OperationDef = {
  id: 'pact.08.struck-off',
  chapter: 'pact',
  faction: Faction.Meridian,
  /*
   * THE RECLAMATION, AND P7's OWN FOE BLOCK ARGUES AGAINST IT — SO THIS ANSWERS
   * THE ARGUMENT RATHER THAN IGNORING IT.
   *
   * P7 wrote: *"Not the Reclamation: `pact.06.common-ground` has just fought
   * their breaking crew on the cut, and running the same army twice would make
   * the concession look like one company's opportunism rather than a fact about
   * the ground."* That objection is correct about ITS slot, where the fact about
   * the ground had not been established yet: the Ninth turning up with an
   * ALLOCATION is what proves the crust is genuinely common now, and only an
   * army that answers a number with a lawful entitlement could prove it. Once
   * P7 has proved it, opportunism is no longer the confusion — it is the POINT.
   * The second buyer is a salvage house that has never taken a reading in its
   * life, and that is what common ground means nine days on.
   *
   * It is also the only army on the coast whose business is registers. `Cregg`
   * appears in `reclamation.01.held-paper` and `reclamation.02.written-off`
   * talking about deeds, transformers and accounting decisions, and
   * `allies.08.standing-order` has the salvage house paying a retainer to a
   * relay chain nobody else thought to buy. A lapsed allocation with an
   * undischarged tenancy on it is exactly the paper he reads for a living.
   *
   * NOT THE ALLIES: `allies.08.standing-order` and `allies.09.made-good` have
   * that army answering a number with paper and not one refinery moving for it,
   * and `pact.04.in-the-clear` already put an Allied instrument on Pact crust.
   * NOT THE SOVIETS: that is P7, one operation back. NOT THE SEPT:
   * `pact.05.open-count` spent the mirror match on them and the chapter's last
   * word should not be an internal quarrel.
   *
   * MECHANICALLY IT PINS THREE THINGS. Every column spawns `rclGrinder` and
   * `rclPicker` — authored RECLAMATION hulls, literal and unremapped, which
   * `validateCampaign` checks against this field. The layout's `pillbox`
   * resolves through `keyFor` to an ARCSPITTER POST — 20 m of `postCoil`,
   * `power: 0`, `chainCount` 1, one pull 43.52 then 26.11 against a 110 hp
   * `mrdWayfarer`. And `grinderArc` is **18 m against `focusLance`'s 26**, so
   * the Pact's eight metres of doctrinal reach are the largest asymmetry the
   * player has and the only thing that makes eighteen unreplaceable hulls a
   * match for a mining economy.
   */
  foe: Faction.Reclaim,
  index: 8,
  title: 'Struck Off',
  beat: 'The parcel goes back on the register nine days later, and the only titled ground on '
    + 'it belongs to the eleven families the Order has spent four hundred years reading with.',
  primaryType: 'escort',
  // Ten `spawnUnits`, seven `orderTagged`, three reveals, a camera move and
  // objective state on both sides — so 'bespoke' by the definition in
  // `types.ts`. The label is about MECHANISM and not about scale: what makes
  // this operation what it is is a hold timer over a disc the player's own
  // rescue keeps arming.
  archetype: 'bespoke',
  parSec: 1_200,
  requires: ['pact.07.thin-place'],

  map: {
    /*
     * `arid` THE PRESET, `desert` THE BIOME, AND THEY ARE THE ONE PAIR THE TWO
     * VOCABULARIES DISAGREE ON.
     *
     * `MAP_PRESETS` is keyed `temperate | arid | tropical | snow | coast | urban
     * | archipelago`; `BiomeName` is `temperate | desert | snow | urban`.
     * `reclamation.03.sold-twice` shipped `biome: 'arid'` — which `getBiome`
     * answers with a `console.warn` and TEMPERATE — so every number in its two
     * headers was a number about the wrong landform. Spelled out here for the
     * same reason `pact.03.concession` and `pact.07.thin-place` spell it out:
     * the safety is a property of the two strings and not of anybody's memory.
     */
    preset: 'arid',
    /*
     * P7's PAIR, UNCHANGED, AND THAT IS THE OPERATION'S PREMISE RATHER THAN A
     * SHORTCUT. Terrain is a function of `mapSeed` and the reserved shelves, and
     * `startPointsFor(2, null, 3 733)` is the same call in both files, so the
     * heightfield, both openings and the ore are identical to the metre — which
     * is what lets this file say "the same pan, nine days later" about the
     * pixels. The three holdings land on 354, 300 / 364, 312 / 340, 286 in both
     * builds. What differs is seat 1's army and the two collars P7 left behind,
     * which the salvage house has bought and hauled.
     */
    mapSeed: 20_130,
    simSeed: 3_733,
    armies: 2,
    biome: 'desert',
    /*
     * THE ORDER BUILDS NOTHING. The layout calls `buildBaseFor` for seat 1 and
     * not for seat 0; `'force'` is honoured by that omission and is deliberately
     * NOT a third `START_CONDITIONS` member, which would put a "Fixed force" row
     * in the skirmish lobby where nothing calls `buildBaseFor` at all.
     */
    opening: 'force',
    /*
     * BOTH SEATS, and one number doing two jobs. `Shell.applySimPostBoot` writes
     * `setup.startingCredits` into every non-Neutral slot: the Order has nothing
     * left after two charges of the mirror at 2 500 each, and Cregg opens with
     * nothing banked and mines every credit of the twenty minutes out of two
     * `rclScrapper`. It is also what makes `AI_REPAIR.minCredits` 400 bite for
     * the first minute — see the head block in the header.
     */
    credits: 0,
  },
  layout: 'pact-struck-off',

  outcome: { annihilationWin: false, assetLossDefeat: false, ignoreSeats: [] },

  /*
   * AN EMPTY PAIR, AND IT IS LOAD-BEARING ON ONE SIDE ONLY.
   *
   * Under `opening: 'force'` seat 0 places nothing tagged, so `roster.player`
   * has nothing to withhold and every hull in the column is an untagged def on
   * purpose — `spawnUnit` asks `isBuildable` and SKIPS a refused def with no
   * throw and no log, so a roster typo would delete a fixed force in silence.
   * `roster.ai` is what does the work: it keeps `rclPylon`, `rclSlaghurler`,
   * `rclSpitter`, `rclHornet`, `rclCrucible`, `rclBaron`, `rclDepot` and
   * `rclStormworks` off the board for twenty minutes against eighteen hulls that
   * cannot be replaced. The header's roster block measures it.
   */
  roster: { player: [], ai: [] },

  /*
   * THE THREE HOLDINGS CANNOT CHANGE HANDS, AND THE HAZARD IS THE PLAYER'S OWN
   * RESCUE.
   *
   * These are GAIA structures, which is `Capture.resolve` rule 1: a neutral
   * structure is taken outright, at ANY health, by ONE engineer, and
   * `Capture.ts#consume` then writes `UnitState.Selling` and `markDead` on the
   * man. **The eleven households ARE engineers** — that is the point of the
   * `engineer` key, see the header — and they spawn on a 16 m ring around the
   * three doors they came out of. So a commander who box-selects a lift and
   * right-clicks the terrace to "get them inside" spends a household on the
   * spot, silently, and the primary's threshold of nine moves out of reach three
   * clicks later. `refuse()` is the only branch of `Capture.resolve` that hands
   * the engineer back, and this field is what takes it.
   *
   * There is a second reason and it is trap 9's: a captured holding lands on
   * SEAT 0 in the middle of ground the Order is not allowed to occupy, where
   * `Targeting.isValidTarget` — which refuses only ALLIES — makes it a legal
   * target for every gun the salvage house owns.
   *
   * **THERE ARE TWO OTHER EXITS AND THE VETO REACHES NEITHER. THIS BLOCK
   * ENUMERATED ONE.**
   *
   * THE FIRST IS THE FRIENDLY-REPAIR BRANCH, AND IT SITS UPSTREAM OF THE VETO
   * LOOP IN THE SAME FUNCTION. `RoleResolver.canRepair` returns `def.canCapture`,
   * so any selection holding a household reports `canRepair`, and
   * `input/Commands.ts` emits `OrderKind.Repair` with a Repair cursor for
   * `isBuilding && !hoverEnemy && hp < maxHp && caps.canRepair`. `Capture.resolve`
   * then takes its `friendly` branch — `st.hp[t] = st.maxHp[t]`, `consume(i)` —
   * and the veto loop `Session.isCaptureProof` installs runs on the line AFTER
   * it. **`captureProof` structurally cannot see this path.** The exposure is
   * exactly the Order's own two buildings, because `isFriendlyTarget` answers
   * FALSE for `Faction.Neutral` and the three holdings are Gaia: the `mrdOculus`
   * at 236, 300 is **11.66 m from `MUSTER`**, which is the point all three
   * `orderTagged('household', 'move')` effects send the eleven to, and the
   * `mrdSolarArray` is 22.80 m out. `CAPTURE.repairThresholdFrac` is 0.995, so
   * **3.25 hp of damage on a 650 hp dish arms the cursor** — and every column is
   * attack-moved at that dish, so it is damaged for most of the match. A player
   * who box-selects the lift and right-clicks to tidy them up beside it spends a
   * household on a building no `when` clause in this table reads. It is not
   * closable from here and it is not silent — the dish jumps to full health and a
   * `RepairSpark` burst plays — but the man is gone and the margin is two.
   *
   * THE SECOND IS THE GARRISON DOOR, AND THIS FILE DOES NOT PRETEND OTHERWISE.
   * `GarrisonService.enter` calls `captureBuilding()` directly and
   * consults no `CaptureService` veto, so a household walking into the terrace
   * flips the deed as surely as an engineer does — `allies.07.fair-copy` found
   * that and priced it rather than closing it. Two things make that residual
   * survivable and both are properties of this operation rather than hopes.
   * It is REVERSIBLE: `GarrisonService.releaseEmptied` flips a neutral structure
   * back the moment the last man leaves, where a captured deed is permanent. And
   * it is SELF-PUNISHING: `runtime.ts#unitsInArea` tests neither the ground nor
   * `EntityFlag.Garrisoned`, so a household sitting inside a holding on the
   * parcel is still counted by `TRESPASS`, the hold timer never disarms, and the
   * concession runs out at forty-five seconds while he sits there.
   *
   * `head` is deliberately NOT on this list. Taking it is one of the two
   * authored routes to the primary and the title says "take off them" for that
   * reason; see the capture block in the header.
   */
  captureProof: ['terrace', 'well', 'infirmary'],

  objectives: [
    {
      /*
       * `ObjectiveRow` is `{ id, title, kind, status }` — no description field,
       * no tooltip — so this is the only sentence a player is guaranteed to
       * read, and `soviets.08.carriage-forward` shipped a primary whose
       * mechanism was explained in a beat behind an OPTIONAL secondary. Both
       * halves are here: where they come from ("off the crust"), where they go
       * ("the reading station") and — because `soviets.08.carriage-forward`
       * found that a threshold nobody is told is a trap — **the bar itself**.
       * Nine of eleven is stated in the row, in Nael's brief at sixteen seconds
       * and again in Hesk's line on the first lift, which is that file's own
       * remedy applied here rather than rediscovered.
       */
      id: 'pan',
      kind: 'primary',
      title: 'Walk nine of the eleven households off the crust to the reading station',
    },
    {
      /*
       * "Take off them" rather than "Break", because `ownerCount(1, ..., max: 0)`
       * counts a capture exactly as it counts a demolition and the title has to
       * mean what the trigger tests. `soviets.06.demolition-order` renamed its
       * own objective for the same reason on the same migration.
       */
      id: 'head',
      kind: 'primary',
      title: 'Take the salvage house\'s replacement cutting head off them before the hour',
    },
    {
      /*
       * THE MECHANISM, IN THE ONE PLACE IT CAN BE STATED. The rule is not "stay
       * off the parcel" — the operation makes the player go on it three times —
       * it is that a crossing disarms and an occupation does not, and no other
       * surface in the game can say that. It stays a SECONDARY for
       * `pact.07.thin-place`'s reason, which this operation inherits rather than
       * re-argues: a rule the engine enforces is a rule the player never has to
       * choose to keep, and the chapter's whole subject is a concession the
       * Order chose. **The Pact CAN take its ground back. Every reason not to is
       * a reason it gave itself.**
       */
      id: 'concession',
      kind: 'secondary',
      title: 'Set foot on the parcel only long enough to walk off it again',
    },
    {
      /*
       * HIDDEN UNTIL THE FIRST LIFT, which is `pact.04.in-the-clear`'s argument
       * for its own hidden row: the difference between nine and eleven is
       * unreadable until the player has seen a household walk. It
       * also keeps the panel at three active rows until then, which is
       * `MAX_VISIBLE_OBJECTIVES`.
       *
       * `medalFor` gives silver only when EVERY secondary is complete, so this
       * row and the concession together are what silver costs — and they pull
       * against each other exactly once, at the third lift, when covering the
       * road properly means being off the head.
       */
      id: 'every',
      kind: 'secondary',
      hidden: true,
      title: 'Bring out all eleven, and not merely the nine',
    },
  ],

  triggers: [
    /* -- the opening word -------------------------------------------------
     * FIVE BEATS, ONE SPEAKER EACH, AT 4, 16, 30, 60 AND 150 SECONDS.
     * `Shell.playCampaignBeat` keys its toast `campaign-${speaker}-${seq}` with
     * a monotonic counter, so nothing here would be destroyed by landing on one
     * tick — but five paragraphs on adjacent ticks are five paragraphs nobody
     * reads. No two adjacent beats share a speaker, which is trap 13's rule
     * kept by spacing rather than by the counter. The two reveals are `allies.01.sounding-line`'s shape: the whole
     * problem before any of it is a problem.
     *
     * **AND THE FIRST REVEAL IS THE ONLY RENDERING OF THE PARCEL BOUNDARY THIS
     * ENGINE CAN PRODUCE.** There is no UI for a `Condition`'s disc;
     * `revealArea` EXPLORES ground permanently, so a reveal at exactly
     * `PARCEL.r` draws the rim as a circle in the fog on the first frame. It
     * blurs as the player's own vision spreads, which is stated rather than
     * hidden: the rim is legible when it is explained and remembered afterwards.
     */
    {
      id: 't.open',
      when: { on: 'elapsed', ticks: seconds(4) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Calvane',
          text: 'Nine days. The allocation lapsed at the hour exactly as we said it would, the '
            + 'parcel went back on the register exactly as we said it would, and a salvage house '
            + 'read the register on the Tuesday and took it out again. That is not them cheating. '
            + 'That is common ground, working. We asked for it.',
        },
        { do: 'revealArea', player: 0, area: PARCEL },
        { do: 'revealArea', player: 0, area: { x: HEAD.x, z: HEAD.z, r: 40 } },
      ],
    },
    {
      id: 't.brief',
      when: { on: 'elapsed', ticks: seconds(16) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Nael',
          text: 'Two things and they are not in the same place. Their new head is on a cradle on '
            + 'the works road, well off the parcel, and it is ours to take. Eleven households are '
            + 'on the parcel, and the parcel is still theirs by our own hand — so we go on it only '
            + 'to come off it. Nine of the eleven standing at the dish is the whole of what this '
            + 'is for. There is no yard behind us and no bank: what we drove out with is what we '
            + 'have.',
        },
      ],
    },
    {
      id: 't.hesk',
      when: { on: 'elapsed', ticks: seconds(30) },
      then: [
        { do: 'cameraMove', at: { x: PARCEL.x, z: PARCEL.z } },
        {
          do: 'dialogue',
          speaker: 'Hesk, of the pan',
          text: 'You put our eleven houses on their book to make the cut cost something. It '
            + 'worked. It made us the thing standing in the way, and a thing standing in the way '
            + 'gets moved. So do not come out here and tell me you are sorry. Tell me where you '
            + 'want us to walk.',
        },
      ],
    },
    /*
     * THE DOCTRINE, SAID ON AN UNCONDITIONAL TRIGGER, AND IT NAMES A TARGET AND
     * NOT ONLY A BUTTON.
     *
     * The line used to say that marking the HEAD stops a hull outside the posts,
     * and it does not: `approach()` writes the target's own centre as the goal
     * and parks on the ordinary route, which arrives on a bearing 63.9% of the
     * standoff ring is covered on. Marking a POST is what has the margin —
     * 20.8 + 2.8284 against 20 + 2.79, 0.8384 m of it, and 0.0 m of the approach
     * inside either gun. See the picket block in the header.
     *
     * Nothing in the frozen vocabulary can see which order a player issued or
     * what they issued it at, so this cannot be a condition and it must not be a
     * beat behind an optional row — `soviets.08.carriage-forward` shipped exactly
     * that mistake. It fires at one minute whatever the player has done, which
     * costs a line to somebody who already knew and saves six hulls for somebody
     * who did not. The three named layers are the three things that shoot: two
     * posts, three guards on the collar, and the collar itself.
     */
    {
      id: 't.aim',
      when: { on: 'elapsed', ticks: seconds(60) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Nael',
          text: 'Read the cradle before you drive at it. Two coil posts and three of their '
            + 'people on the ground beside it, and all five are shorter guns than ours. Mark a '
            + 'post and the lances stop just outside it and it cannot answer; mark the head and '
            + 'they stop where the posts can reach them; order them at the ground and they drive '
            + 'in under everything. Posts first with the lances, their people with the carbines, '
            + 'the head last.',
        },
      ],
    },
    /*
     * THE CONCESSION CLOCK, ALSO UNCONDITIONAL AND ALSO FOR TRAP 23's REASON.
     * The rule is not "stay off"; it is that leaving disarms the timer. A player
     * who works that out from the failure has already lost the bonus.
     */
    {
      id: 't.rule',
      when: { on: 'elapsed', ticks: seconds(150) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Calvane',
          text: 'Understand the shape of what we signed. Crossing that ground is not occupying '
            + 'it. Standing on it is. So when they come out, walk them out and be gone with them '
            + '— and do not leave a hull on the rim to cover the road, because a hull that stays '
            + 'is the whole argument lost for a minute of shooting.',
        },
      ],
    },

    /* -- the three lifts --------------------------------------------------
     * ONE TAG FOR ALL THREE, AND THE ORDER DOES SURVIVE HERE.
     * `orderTagged` re-points every live household on every lift, which is
     * harmless for the ones already standing at the muster and correct for the
     * ones still walking. **Unlike a scripted order on an AI seat, this one is
     * durable**: `AiBrain.regroupSquads` re-files hulls the BRAIN owns and
     * nothing re-tasks seat 0, so a household ordered to the muster walks to the
     * muster. That is the opposite of the note `pact.07.thin-place` carries
     * about its columns and it is worth saying in both directions.
     *
     * The drop rings are 16 m and every one of the eleven points is open to
     * `Locomotor.Foot` on the real cost grid, checked at radii from 10 to 22 m
     * so the ring is not a knife edge. `tests/campaign-spawn-ground.spec.ts`
     * re-derives all of them.
     */
    {
      id: 't.liftA',
      when: { on: 'elapsed', ticks: LIFT_A },
      then: [
        {
          do: 'dialogue',
          speaker: 'Hesk, of the pan',
          text: 'Four households out of the terrace and they are carrying the book, because the '
            + 'book is the only thing in there that is yours. Everything else stays. Four now, '
            + 'four off the well, three off the infirmary, and your officer wants nine of us at '
            + 'that dish. Walk us there and then get off our ground before your own paperwork '
            + 'catches you.',
        },
        {
          do: 'spawnUnits', player: 0, key: 'engineer', count: 4,
          at: TERRACE, spread: 16, tag: 'household',
        },
        { do: 'orderTagged', tag: 'household', order: 'move', at: MUSTER },
        { do: 'setObjective', id: 'every' },
      ],
    },
    {
      id: 't.liftB',
      when: { on: 'elapsed', ticks: LIFT_B },
      then: [
        {
          do: 'dialogue',
          speaker: 'Hesk, of the pan',
          text: 'Four more, off the well. That is the shallowest sounding on this coast and my '
            + 'grandmother took it every morning of her life. Somebody will sink a head through '
            + 'it inside the year and the reading will be perfect right up until it is gone.',
        },
        {
          do: 'spawnUnits', player: 0, key: 'engineer', count: 4,
          at: WELL, spread: 16, tag: 'household',
        },
        { do: 'orderTagged', tag: 'household', order: 'move', at: MUSTER },
      ],
    },
    {
      id: 't.liftC',
      when: { on: 'elapsed', ticks: LIFT_C },
      then: [
        {
          do: 'dialogue',
          speaker: 'Nael',
          text: 'Last three, out of the infirmary, and they are the slowest of the eleven. '
            + 'Whatever you have standing at the cradle, this is the moment it is not standing '
            + 'on the road.',
        },
        {
          do: 'spawnUnits', player: 0, key: 'engineer', count: 3,
          at: INFIRMARY, spread: 16, tag: 'household',
        },
        { do: 'orderTagged', tag: 'household', order: 'move', at: MUSTER },
      ],
    },

    /* -- the columns off the works camp ----------------------------------- */
    {
      id: 't.pressA',
      when: { on: 'elapsed', ticks: PRESS_A },
      then: [
        {
          do: 'dialogue',
          speaker: 'Cregg, for the salvage house',
          text: 'Cregg. I bought two dead collars, a lapsed allocation and eleven tenancies I '
            + 'did not ask for, and the only line on that page I cannot settle with money is the '
            + 'tenancies. So take your people off, Calvane. I would rather you did it than I did.',
        },
        {
          do: 'spawnUnits', player: 1, key: 'rclGrinder', count: 4,
          at: STAGE, spread: 14, tag: 'column',
        },
        { do: 'orderTagged', tag: 'column', order: 'attackMove', at: MUSTER },
        { do: 'revealArea', player: 0, area: { x: STAGE.x, z: STAGE.z, r: 40 } },
      ],
    },
    {
      id: 't.pressB',
      when: { on: 'elapsed', ticks: PRESS_B },
      then: [
        {
          do: 'dialogue',
          speaker: 'Nael',
          text: 'Armour and men, off their works camp, and they are coming at the dish rather '
            + 'than at the parcel. Of course they are — the dish is the only thing of ours on '
            + 'this map they are allowed to shoot at.',
        },
        {
          do: 'spawnUnits', player: 1, key: 'rclGrinder', count: 4,
          at: STAGE, spread: 14, tag: 'column',
        },
        {
          do: 'spawnUnits', player: 1, key: 'rclPicker', count: 5,
          at: STAGE, spread: 22, tag: 'column',
        },
        { do: 'orderTagged', tag: 'column', order: 'attackMove', at: MUSTER },
      ],
    },
    {
      id: 't.pressC',
      when: { on: 'elapsed', ticks: PRESS_C },
      then: [
        {
          do: 'dialogue',
          speaker: 'Cregg, for the salvage house',
          text: 'The pan is walking, which settles my tenancies for me, so what is left is the '
            + 'dish. Take that off him and the Order has no instrument on this coast and no '
            + 'ground under it, and the next parcel goes out without an argument attached.',
        },
        {
          do: 'spawnUnits', player: 1, key: 'rclGrinder', count: 5,
          at: STAGE, spread: 18, tag: 'column',
        },
        {
          do: 'spawnUnits', player: 1, key: 'rclPicker', count: 6,
          at: STAGE, spread: 26, tag: 'column',
        },
        { do: 'orderTagged', tag: 'column', order: 'attackMove', at: MUSTER },
      ],
    },
    {
      /*
       * GATED ON THE HEAD STILL STANDING, which is what gives the primary teeth
       * beyond its own row: a commander who took the cradle in the first four
       * minutes deletes eleven hulls at minute seventeen and never learns it. It
       * cannot collide with `t.head` — that trigger requires
       * `ownerCount(1, ..., max: 0)` and this one `min: 1`, and the two are
       * exact complements over an integer count, so no tick satisfies both.
       */
      id: 't.pressD',
      when: { on: 'all', of: [{ on: 'elapsed', ticks: PRESS_D }, HEAD_STANDS] },
      then: [
        {
          do: 'dialogue',
          speaker: 'Cregg, for the salvage house',
          text: 'The cradle is still standing, so the works are still worth defending and I am '
            + 'still spending. Everything the camp has. If that head goes down before the hour '
            + 'this was a bad Tuesday; if it does not, it was a purchase.',
        },
        {
          do: 'spawnUnits', player: 1, key: 'rclGrinder', count: 5,
          at: STAGE, spread: 18, tag: 'column',
        },
        {
          do: 'spawnUnits', player: 1, key: 'rclPicker', count: 6,
          at: STAGE, spread: 26, tag: 'column',
        },
        { do: 'orderTagged', tag: 'column', order: 'attackMove', at: MUSTER },
      ],
    },

    /* -- the parcel, taught before it is charged for -----------------------
     * THE WARNING AT EIGHTEEN SECONDS AND THE FAILURE AT FORTY-FIVE, AND THE
     * FIRST OF THOSE IS GUARANTEED TO FIRE ON THE FIRST LIFT. The fastest of the
     * three crossings is 20.3 s of walking and the slowest is 27.6, both
     * measured on the real Foot cost grid — so eighteen seconds is under the
     * floor and the beat is a teaching moment rather than an alarm. It is not
     * `repeat`: it fires once, ever.
     *
     * The Director evaluates both of these twice for the hold timer: pass one
     * forces `elapsedSinceArmed` true and asks whether a Pact unit is inside,
     * which sets or clears the arm tick; pass two compares against that tick. So
     * the clock restarts the moment the last household is over the rim, which is
     * what makes three crossings free and one parked hull expensive.
     */
    {
      id: 't.trespass',
      when: { on: 'all', of: [TRESPASS, { on: 'elapsedSinceArmed', ticks: seconds(18) }] },
      then: [
        {
          do: 'dialogue',
          speaker: 'Nael',
          text: 'That is us on their ground and the clock is on us from the moment the first '
            + 'boot landed. It stops when the last one is over the line and not before. Keep '
            + 'them walking.',
        },
      ],
    },
    {
      id: 't.concessionLost',
      when: { on: 'all', of: [TRESPASS, { on: 'elapsedSinceArmed', ticks: seconds(45) }] },
      then: [
        { do: 'failObjective', id: 'concession' },
        {
          do: 'dialogue',
          speaker: 'Calvane',
          text: 'Then we are standing on it, and every yard on this coast can say the Order gave '
            + 'the crust away and stood on it again the first week somebody bought it. Finish '
            + 'getting them off. We will answer for this part in the open and we will answer for '
            + 'it properly.',
        },
      ],
    },

    /* -- the two jobs, resolved above the win ------------------------------
     * `runDirector` returns the moment an outcome is set, so a completion
     * written below `t.win` never fires and the medal never counts it —
     * `medalFor` gives silver only when EVERY secondary is complete.
     *
     * `t.every` sits above `t.pan` so that the tick on which the eleventh
     * household arrives reports the harder row first. Both are latches; neither
     * is `repeat`.
     */
    {
      id: 't.every',
      when: { on: 'unitsInArea', player: 0, area: SHELTER, min: 11, tag: 'household' },
      then: [
        { do: 'completeObjective', id: 'every' },
        {
          do: 'dialogue',
          speaker: 'Hesk, of the pan',
          text: 'Eleven out of eleven. Write that down in the same book, in the same hand, '
            + 'underneath four hundred years of soundings — and then write down that it is the '
            + 'last entry taken on that ground.',
        },
      ],
    },
    {
      id: 't.pan',
      when: PAN_IN,
      then: [
        { do: 'completeObjective', id: 'pan' },
        {
          do: 'dialogue',
          speaker: 'Nael',
          text: 'The pan is off the crust and standing on ours. The holding is discharged, which '
            + 'means there is no titled ground on that parcel any more and no works can be raised '
            + 'on it by anybody. That is what it cost.',
        },
      ],
    },
    {
      id: 't.head',
      when: HEAD_OFF,
      then: [
        { do: 'completeObjective', id: 'head' },
        {
          do: 'dialogue',
          speaker: 'Nael',
          text: 'Cradle is clear. There is no head on that road and nothing on the parcel to put '
            + 'one in — and they cannot lay a spoil line across ground with no title on it, so '
            + 'the next one has the same problem this one had.',
        },
      ],
    },

    /* -- the early loss, above everything it could contradict --------------
     * A MERCY RATHER THAN A RULE: at fifteen minutes, with the last lift landed
     * three minutes ago and its slowest walk 44.5 s long, a count of eight or
     * fewer means the primary's nine can never be met and the player is told at
     * fifteen rather than at twenty. **THIS COMMENT READ "seven or fewer" AND
     * "the primary's eight" AGAINST A `max: 8` AND A `PAN_IN` OF NINE** — prose
     * left behind by the rejected threshold-of-eight draft, in the same file that
     * spends a section on why eight was cut. The code was right both times.
     *
     * **`min: 1` IS THE TICK-ONE GUARD** — a bare `max: 8` reads TRUE of a world
     * with no households in it at all, which is `entityDead`-before-the-tag
     * wearing a different noun, and this table spawns the tag rather than
     * stamping it in the layout. **`not objectiveComplete('pan')` is the OTHER
     * guard**, and it is the one that matters after the primary has latched: a
     * household shot at the muster at minute sixteen must not retroactively lose
     * an operation whose row already reads complete.
     */
    {
      id: 't.panLost',
      when: {
        on: 'all',
        of: [
          { on: 'elapsed', ticks: COUNTED },
          { on: 'not', of: { on: 'objectiveComplete', id: 'pan' } },
          { on: 'ownerCount', player: 0, role: 'unit', tag: 'household', min: 1, max: 8 },
        ],
      },
      then: [
        { do: 'failObjective', id: 'pan' },
        {
          do: 'dialogue',
          speaker: 'Hesk, of the pan',
          text: 'There are not enough of us left to be a holding. You can stop now. Whatever is '
            + 'still standing out there is eleven houses with nobody in them, and that is exactly '
            + 'what he wanted to buy.',
        },
        { do: 'endOperation', result: 'loss', reason: 'pan' },
      ],
    },

    /* -- the paid secondary, then the hour ---------------------------------- */
    {
      /*
       * `not objectiveFailed` IS THE LOAD-BEARING CLAUSE and it is checked here
       * rather than relied on inside `t.win`. `Session.setObjective` already
       * refuses to un-resolve, so completing a failed row would be a no-op — but
       * a no-op that reads as a bug to the next author. Written out, the two
       * triggers partition the state and the file says which one it means.
       */
      id: 't.concession',
      when: {
        on: 'all',
        of: [DONE, { on: 'not', of: { on: 'objectiveFailed', id: 'concession' } }],
      },
      // IT COMPLETES SILENTLY, WHICH IS DELIBERATE AND IS NOT WHAT
      // `pact.07.thin-place` DOES. Its `t.concession` carries a Nael line and
      // fires on the same tick as its win, so THREE speakers land in one effect
      // list. Driven here, the same shape put four beats on the winning tick
      // with two of them from Nael. The row turning green in the panel is the
      // notification, and Calvane's register entry two lines below already says
      // the Order never took the ground back.
      then: [{ do: 'completeObjective', id: 'concession' }],
    },

    /* -- the losses at the hour, above the win ------------------------------
     * **THESE TWO WERE NOT DISJOINT FROM EACH OTHER AND THE DRIVEN TABLE ABOVE
     * NEVER RAN THE CONJUNCTION.** Each was disjoint from `t.win`, which is what
     * the first version of this comment argued and proved; but the ORDINARY total
     * failure — both primaries still open at the hour — satisfied both, and
     * `runDirector` applies every effect list it collects. Driven, tick 36 000
     * emitted `fail(pan)`, Cregg saying *"there are still people on my parcel"*,
     * `end(loss/pan)`, `fail(head)`, and then Cregg again saying *"You emptied
     * the houses for me and left me the cradle"* — two paragraphs from one
     * speaker on one tick, the second of which describes the opposite run. The
     * outcome was right (`Session.end` is first-wins, so the reason is 'pan');
     * the screen was not. Trap 26 on a LOSING tick.
     *
     * **THE FIX IS `objectiveComplete('pan')` ON `t.lateHead`, WHICH MAKES THE
     * PAIR EXACT COMPLEMENTS OVER ONE LATCH**, and it also makes each beat true
     * of the run it now speaks in: the cradle line is about the run where the
     * houses really were emptied, and the tenancies line is about the run where
     * they were not. `t.latePan` fails BOTH rows for that reason — at the hour
     * with the pan short and the collar standing, the head really is still
     * theirs, and `setObjective` refuses to un-resolve, so the extra
     * `failObjective` is a no-op on a head already taken.
     *
     * The ordering still matters for the reader: on a tick where both are open
     * the pan is what this operation is named after, and it is written first.
     *
     * `t.latePan` carries `not PAN_IN` as well as the objective read, and the
     * second clause is the same-tick guard: if the ninth household steps into
     * the disc on the exact tick the hour lands, `t.pan` above completes the row
     * in the same effect list but `objectiveComplete` still reads the state at
     * tick start. The world read is what stops that ending in a defeat — and
     * with the new clause on `t.lateHead` that race now resolves one tick later
     * rather than on the tick itself, driven and confirmed below.
     */
    {
      id: 't.latePan',
      when: {
        on: 'all',
        of: [
          { on: 'elapsed', ticks: NOTICE },
          { on: 'not', of: { on: 'objectiveComplete', id: 'pan' } },
          { on: 'not', of: PAN_IN },
        ],
      },
      then: [
        { do: 'failObjective', id: 'pan' },
        // The head's row, so a total failure does not leave a primary reading
        // ACTIVE on the end screen. A no-op if the collar was already taken.
        { do: 'failObjective', id: 'head' },
        {
          do: 'dialogue',
          speaker: 'Cregg, for the salvage house',
          text: 'The hour is up and there are still people on my parcel, so the tenancies are '
            + 'live, so I am buying them out at the register rate. They will be off it by Friday '
            + 'and it will not be you that walked them off.',
        },
        { do: 'endOperation', result: 'loss', reason: 'pan' },
      ],
    },
    {
      id: 't.lateHead',
      when: {
        on: 'all',
        of: [
          { on: 'elapsed', ticks: NOTICE },
          HEAD_STANDS,
          { on: 'objectiveComplete', id: 'pan' },
        ],
      },
      then: [
        { do: 'failObjective', id: 'head' },
        {
          do: 'dialogue',
          speaker: 'Cregg, for the salvage house',
          text: 'Head goes down on the hour. You emptied the houses for me and left me the '
            + 'cradle, which is the half of today I would have paid for. Send somebody out to '
            + 'read it in the spring — the sounding will be a good deal shorter.',
        },
        { do: 'endOperation', result: 'loss', reason: 'head' },
      ],
    },

    /* -- the win ------------------------------------------------------------
     * TWO BEATS ON THIS TICK AND NOT FIVE. `pact.06.common-ground` shipped a
     * winning tick that emitted five, with one speaker answering herself, and
     * the fix is to move the earlier beats rather than to hold the win — an
     * `elapsedSinceArmed` on a win was costed and REJECTED, because
     * `setObjective` refuses to un-resolve a resolved row, so a player who steps
     * out mid-hold loses with the objective showing COMPLETE. `t.pan` and
     * `t.head` each carry their own line and fire on their own ticks; what
     * lands here is Calvane closing and Hesk answering, one exchange, which is
     * what the seam into P9 wants.
     */
    {
      id: 't.win',
      when: DONE,
      then: [
        {
          do: 'dialogue',
          speaker: 'Calvane',
          text: 'Enter it in the register exactly as it happened. The holding is struck, the '
            + 'parcel carries no title, the count is still true for everybody who wants it, and '
            + 'the Order has given away the last thing it had — which turns out not to have been '
            + 'ours to give. Eleven households off four hundred years of ground, by our hand, to '
            + 'keep a number honest.',
        },
        {
          do: 'dialogue',
          speaker: 'Hesk, of the pan',
          text: 'We will take the dish and the book and whatever you can spare. And Calvane — the '
            + 'reading does not stop. It just stops being taken there. Somebody is going to have '
            + 'to tell your Conclave where it is being taken instead.',
        },
        { do: 'endOperation', result: 'win' },
      ],
    },

    /* -- the backstop -------------------------------------------------------
     * `playerBeaten` is `Viability.isBeaten` — nothing to build with and nothing
     * to fight with — and under `opening: 'force'` with eleven unarmed civilians
     * on the books it is a LATER read than it looks: it stays false while a
     * single household is alive. That is why it is the backstop rather than the
     * loss, and why `t.panLost` above exists at all.
     */
    {
      id: 't.lose',
      when: { on: 'playerBeaten', player: 0 },
      then: [{ do: 'endOperation', result: 'loss', reason: 'pan' }],
    },
  ],
};

export default op;
