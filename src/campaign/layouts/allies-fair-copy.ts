/**
 * ============================================================================
 * VOLTMARCH — src/campaign/layouts/allies-fair-copy.ts
 * ============================================================================
 * A7 — THE GROUND. Two Works relay blocks that belong to nobody, a Meridian
 * field register that belongs to the Order, two Glaive Posts standing on one of
 * the blocks and none at all on the other, and — on the player's side — a
 * column with no yard behind it.
 *
 * ============================================================================
 * MEASURED, ON THE WORLD THIS FILE ACTUALLY BUILDS
 * ============================================================================
 * Every figure below is read off `store.posX/posZ` after `spawnBuilding` snapped
 * each footprint to the placement grid, on a headless build at `mapSeed`
 * 20 260 970 / `simSeed` 7 063 with the def tables BOUND and this operation's
 * roster INSTALLED through `setCampaignRoster` — the only state in which either
 * is true. The control at the end of this header counts what the roster
 * withholds.
 *
 *     thing        key             owner    landed        hp    footprint
 *     arc head     civApartments   GAIA     (296, 242)    800     2x3
 *     yards head   civApartments   GAIA     (128, 114)    800     2x3
 *     register     radar->mrdOculus MERIDIAN (336, 216)   650     2x2
 *     two posts    pillbox->mrdGlaive       (318, 234) (274, 250)
 *                                            480 each, `glaiveRepeater` at 24 m,
 *                                            **23.409 m from the head, both**
 *
 * **ALL FIVE LAND ON THEIR AUTHORED LITERALS AT RING ZERO**, and they are
 * written here as the coordinates the built world reports rather than as nominal
 * points the ring search then walks off — `allies-forced-closure` and
 * `soviets-short-allocation` both record why, and it is the same trap:
 * **`place` returning a point is not the same as a structure standing on it**,
 * because `spawnBuilding` snaps the result to the footprint grid a second time.
 * A 2-wide footprint centres on a cell boundary (296 = 74*4, 128 = 32*4, 336 =
 * 84*4) and a 3-deep one on a cell centre (242 = 60*4 + 2, 114 = 28*4 + 2), so
 * the search below is a CHECK on this ground rather than the mechanism that
 * found it. The two posts are 1x1 and centre on a cell centre, so their offsets
 * from the arc head must satisfy `dx = 2 (mod 4)` and `dz = 0 (mod 4)`: 296 is a
 * cell BOUNDARY in x and 242 a cell CENTRE in z. A first draft used -14/+18 in
 * z, 242 - 14 is 228, that is a boundary, and `spawnBuilding` moved the post two
 * metres from where the arithmetic said it was.
 *
 * The two openings, and one of them is not a base:
 *
 *     start spots      (108, 380) and (404, 132)   —  see below
 *     player           NO BASE. `opening: 'force'`, so `buildBaseFor` is
 *                      called for seat 1 only, and the column is what there is.
 *     Meridian         Conclave at the second spot, 26 structures under the
 *                      roster
 *
 * **`seatedSlots(2, 7063, null)` DRAWS [0, 1]** — the antipodal pair, spots
 * (108, 380) and (404, 132), **386.16 m apart**, the same diagonal A2 and A3 sit
 * on. It is the right pair for this operation and the reason is the opposite of
 * A5's: A5 wanted an assault's approach SHORT so its length came from the works
 * rather than from the drive, and this operation wants the map to be a distance,
 * because a force that cannot replace a hull has to spend its whole nineteen
 * minutes deciding where its men are.
 *
 * ============================================================================
 * THE TWO HEADS ARE GAIA, AND THAT IS THE WHOLE MECHANIC RATHER THAN A MOOD
 * ============================================================================
 * `Capture.resolve` forks on `ownerFactionOf(t) === Faction.Neutral`, and the
 * neutral branch has **no health gate at all** — one engineer, at any health,
 * and the engineer is consumed (`Capture.ts#consume` writes `UnitState.Selling`
 * and `markDead`). So a relay block is taken by walking one 90-hp man to its
 * wall, which is what "lodging a slip" is.
 *
 * **AND SO IS WALKING A RIFLEMAN INTO IT, WHICH THIS FILE DID NOT SAY AND HAD
 * TO.** `civApartments` clears every gate in `GarrisonService.refusalFor` —
 * measured on the built world, `refusalFor(arc, seat 0)` returns the empty
 * string, against `"production structure"` for the register — because it is
 * unarmed (`weaponIndex` -1, no `CanAttack`), carries none of
 * `IsBuilder | IsFactory | IsRefinery | IsRadar`, and is 2x3 against
 * `GARRISON.minFootprint` 2 on both axes. `GarrisonService.enter` then calls
 * `captureService().captureBuilding(...)` DIRECTLY under the comment *"first man
 * into a neutral block raises your flag over it"* — so one G.I. flips the deed,
 * `structureCaptured` reads true on that tick, the objective latches, and
 * `releaseEmptied` hands the block back to Gaia the moment he walks out. The
 * latch survives; `CampaignSession.setObjective` refuses to un-resolve.
 *
 * `allies-misclosure` and `allies-machine-time` both state this property about
 * the same def in the same chapter and this file had to be told twice. **Neither
 * A7 file contained the word "garrison" before the fix.**
 *
 * **`OperationDef.captureProof` CANNOT CLOSE IT** — it installs a
 * `CaptureService.addVeto`, `resolve()` consults the veto list, and
 * `captureBuilding()` does not. There is no condition in the frozen vocabulary
 * that can tell a capture from a garrison either. So it is PRICED rather than
 * refused, and the price is the honest one:
 *
 *     engineer   500 cr, CONSUMED, deed permanent, 90 hp on the walk in,
 *                and he is a quarter of the register
 *     rifleman   200 cr, walks out again, deed reverts behind him, 120 hp
 *
 * **THE RIFLEMAN IS NOT MERELY CHEAPER — HE IS THE ONE WHO SURVIVES THE DASH**,
 * which is what the stand table below makes into a decision rather than a
 * dominant strategy: one `glaiveRepeater` burst is 48.0 delivered damage, so a
 * 90-hp engineer survives one and a 120-hp G.I. survives two. And the register
 * is `IsRadar` and immune to the whole business, so the four-engineer secondary
 * price is real and the section is what pays it.
 *
 * **THE PRICE OF THE SAME ACT AGAINST THE ORDER'S OWN REGISTER IS FOUR MEN, AND
 * THE TWO NUMBERS TOGETHER ARE THE OPERATION.** `mrdOculus` is seat 1's, so it
 * takes the ENEMY branch: above `CAPTURE.captureHpFrac` (0.5) the engineer is
 * spent knocking `maxHp * CAPTURE.softenFrac` (0.25) off through
 * `ARMOR_MATRIX[HighExplosive][Concrete]` (1.00) **and `COMBAT_DAMAGE.globalMul`
 * (0.80)** — a FLAT 130 of a 650-hp register, 20% of max and not 25%.
 * 650 -> 520 -> 390 -> 260, and the FOURTH engineer captures. Four of the five
 * men the operation ships, for a secondary, against **6.71 seconds of the
 * column's own guns** (below). The register is the thing to shoot; the heads
 * are the things not to.
 *
 * **NOBODY CAN ACQUIRE A HEAD. EVERYBODY CAN SPLASH ONE, AND THIS FILE SAID THE
 * OPPOSITE.** It read *"nobody can shoot a head except the player"*, on the
 * argument that Gaia is allied to every seat and `Targeting.isValidTarget`
 * refuses only ALLIES. That argument is sound about ACQUISITION and says nothing
 * about DAMAGE: `Damage.applySplash` filters its victims on
 * `Alive | PendingDestroy | Garrisoned` and NOTHING ELSE, and the only thing an
 * alliance buys on that path is `COMBAT_DAMAGE.friendlyFireMul` 0.5 — which
 * applies to the Order too, because Gaia is allied to them as well.
 *
 * **THE CATCHMENT IS THE WHOLE OF THE GROUND THE OPERATION IS FOUGHT ON.**
 * `hitRadius(2, 3)` is `sqrt(4^2 + 6^2)` = **7.211 m**, so a blast reaches the
 * block from anywhere inside `7.211 + splashRadius` of its centre: **8.811 m for
 * `lightCannon`, 8.611 m for `focusLance`**. Every one of the ten lodging cells
 * below sits 6.000-8.246 m from that centre, i.e. inside both. A shell aimed at
 * a man standing at a door lands on the door.
 *
 * Per shell, derived through the shipped tables
 * (`ARMOR_MATRIX[ArmorPiercing][Concrete]` 0.55, `globalMul` 0.80,
 * `splashExponent` 1.6, `splashFalloff` 0.30 as the rim):
 *
 *     lightCannon  55 AP, splash 1.6    5.23 .. 12.10 hp    67 .. 153 shells
 *     focusLance   60 AP, splash 1.4    5.03 .. 13.20 hp    61 .. 159 shells
 *
 * against 800 hp, and there is no recovery of any kind: `sim/Regen.ts` is
 * `isMobileUnit` only (Infantry and Vehicle), and `RepairSell` needs an owner to
 * flag and a bank to charge, which Gaia has neither of. Every point is permanent
 * for the full nineteen minutes.
 *
 * So the operation's third loss trigger is a **live hazard from ordinary
 * combat**, not a guard against the player's own force-fire, and both files now
 * say so. It is not cheap — sixty-one shells is a long fight standing on the
 * doorstep — and **how often it actually fires in a played match is NOT
 * MEASURED**: the mechanism and the arithmetic are derived, the frequency needs
 * a real game and no harness in this repo fights one.
 *
 * WHAT WAS CONSIDERED AND REJECTED FOR IT. Re-pointing the four timed waves'
 * `attackMove` off the block by fifteen or twenty metres moves NO number:
 * `attackMove` stops where a target is acquired, the player's defenders are at
 * the doors, and `focusLance` reaches 26 m — so the Solarch parks 26 m from a
 * man standing 7 m from the block and the shell still lands inside 8.611 m of
 * its centre. `EntityFlag.NotATarget` would work and is an ENGINE change
 * (`applySplash`'s victim filter does not test it), which an operation may not
 * make.
 *
 * **`civApartments` FOR THE THIRD TIME IN THIS CHAPTER, ON PURPOSE.**
 * `allies-instrument-room` spent it on a survey office and `allies-misclosure`
 * on the transmitter block A4's provisional is filed from — and A4's early-out
 * is `structureCaptured` on that block, which is the identical act this
 * operation asks for twice. A player who filed the provisional in A4 has already
 * been taught what walking an engineer into one of these does. Using a fourth
 * silhouette here would have hidden that.
 *
 * ============================================================================
 * ONE HEAD HAS CONCRETE ON IT AND THE OTHER HAS NOTHING, MEASURED TO THE CELL
 * ============================================================================
 * **THERE ARE TEN LODGING CELLS AT THE ARC HEAD, NOT FOUR, AND THE FOUR-STAND
 * TABLE THIS FILE USED TO CARRY WAS THE DEFECT.** `CaptureService.withinReach`
 * is `max(0, |dx| - halfW)^2 + max(0, |dz| - halfH)^2 <= reach^2` — a ROUNDED
 * RECTANGLE, not four points. `CAPTURE.reachMetres` is 2.2 and the engineer's
 * own `st.radius`, read back off the store, is **0.234**, so the reach is
 * 2.434 m and for a 2x3 footprint (halfW 4, halfH 6) the accepting region is a
 * 2.434 m band all the way round the footprint. The old table enumerated the
 * four FACE MIDPOINTS of that band — the four extreme points, individually
 * correct and not the set.
 *
 * What a man can actually stand on is a cell, and the arc head's grid phase
 * gives ten of them outside the footprint: 296 is a cell boundary in x so
 * `|dx|` is 2 or 6, 242 is a cell centre in z so `|dz|` is 0, 4 or 8, and the
 * four `(6, 8)` corners fail the rounding at `2^2 + 2^2 = 8 > 5.924`. All ten
 * are Foot-passable on this ground. A Glaive Post FIRES when
 * `max(0, flat - hitRadius(target)) <= 24` and an engineer's `hitRadius` is his
 * radius, so the circle is **24.234 m** of centre distance; `Targeting` acquires
 * at `24 * COMBAT_TARGETING.acquireRangeMul` (1.08) + 0.234 = **26.154 m**.
 *
 *     cell           post A (318,234)   post B (274,250)   bears
 *     (294, 234)         23.77              25.38            A
 *     (298, 234)         19.77              28.61            A
 *     (302, 238)         16.26              30.23            A
 *     (302, 242)         17.65              28.89            A
 *     (302, 246)         19.77              28.05            A
 *     (290, 238)         28.05              19.77            B
 *     (290, 242)         28.89              17.65            B
 *     (290, 246)         30.23              16.26            B
 *     (294, 250)         28.61              19.77            B
 *     (298, 250)         25.38              23.77            B
 *
 * **EVERY LODGING CELL IS UNDER EXACTLY ONE POST. NONE IS UNDER BOTH AND NONE
 * IS UNDER NEITHER.** That is what the posts were moved for. At the authored
 * offsets `(+22, -16)` and `(-18, +16)` the same enumeration left **(294, 234)
 * and (302, 246) covered by no gun at all** — 25.06 / 28.61 and 25.38 / 26.60,
 * both inside post A's ACQUIRE circle and outside its FIRE circle, so it slewed,
 * tracked and never shot — and `glaiveRepeater` carries `splashRadius: 0`, so
 * those two cells took literally nothing. The operation's central claim was
 * false as written.
 *
 * **THE INSTRUMENT FOR "THE POSTS GATE THE HEAD" IS AN EXCLUSION CONTROL, NOT A
 * DISTANCE.** Re-run the route search with both firing discs impassable and see
 * whether any lodging cell is still reachable:
 *
 *     posts at (+-22, -+16)   cheapest lodging cell   (290,246) at 237.2 m
 *                             cheapest gun-free cell  (294,234) at 249.4 m
 *                             the gate costs          12.2 m of detour, 3.6 s
 *     posts at (+-22, -+8)    cheapest lodging cell   (290,246) at 237.2 m
 *                             cheapest gun-free cell  **UNREACHABLE**
 *
 * 8-connected Dijkstra over the real `FlowFieldCache.costGridFor(MoveClass.Foot)`
 * from the column's own cell, octile step, corner-cutting refused.
 *
 * **THE GATE IS A PRICE AND NOT A WALL, AND THE PRICE IS FOUR METRES.** Minimum
 * exposure — the metres of the cheapest route that lie inside a firing circle,
 * Dijkstra'd on exposure rather than length — is **4.00 m, at (294, 234)**,
 * whose neighbour (294, 230) sits at 24.10 m surface and is the last cold cell
 * on the approach. Four metres is 1.18 s at an engineer's 3.4 m/s against a
 * 0.79 s weapon cycle, so the dash is **one burst or two**, and a burst is
 * `5 x 12 x ARMOR_MATRIX[SmallArms][Infantry] 1.00 x globalMul 0.80` = **48.0**:
 *
 *     engineer  90 hp   survives ONE burst at 42 hp, dies to the second
 *     G.I.     120 hp   survives TWO at 24 hp, dies to the third
 *
 * Break either post and **five of the ten cells go quiet and the minimum
 * exposure falls to 0.00 m** — measured both ways round. Six Wardens do that in
 * 4.96 s (below). That is the decision the operation owns: spend 4.96 seconds of
 * armour, or send a man who arrives on one burst's worth of health.
 *
 * WHAT WAS CONSIDERED AND REJECTED. The search over every 5/5 disjoint pair on
 * legal grid phase (`dx = 2 mod 4`, `dz = 0 mod 4`, buildable and clear at ring
 * zero) offers **`(+-18, -+12)` at 21.63 m, whose minimum exposure is 9.66 m** —
 * 2.84 s, 172.6 damage, LETHAL to a 90-hp engineer and to a 120-hp rifleman
 * alike. It was rejected because it turns the gate into a wall: `t.mercy` hands
 * a dead-end commander two engineers and no armour, and a wall makes that rescue
 * worth nothing. Four metres is a price the rescue can still pay.
 *
 * The yards head has no structure of any kind within **199.53 m**, and that is
 * the nearer of the two Glaive Posts on the OTHER head; the next thing along is
 * the arc block itself at 211.21 m and the register at 231.66 m. Measured
 * centre-to-centre over every alive Building on the built world, sorted. **This
 * file used to say 202.18 m and that the nearest thing that could shoot was a
 * rampart in the Order's own base — both halves were wrong before the posts
 * moved as well as after**: `mrdRampart` carries no weapon at all
 * (`weaponIndex` -1), and the old post B stood at 207.93 m, nearer than any
 * rampart. Against a 24 m gun the yards head is open ground either way; the
 * number is quoted because the operation's whole decision is that one head has
 * concrete on it and the other has none.
 *
 * **Eight of its ten lodging cells are Foot-passable**; (130, 122) and
 * (134, 118) are not, which is a fact about the ground rather than a design, and
 * a relay block with eight usable cells is not meaningfully easier than one with
 * ten. (The old header said "three of its four stands", from the same
 * four-midpoint enumeration that produced the arc head's defect.)
 *
 * **AND NOTHING BUT THE PLAYER CAN TAKE EITHER OF THEM.** `AiBrain` owns no
 * engineer (its weight is 0 and `buildUnits` filters `weight <= 0`), and its
 * only `OrderKind.Enter` is `amphibHull` — grepped: there is no line in
 * `src/sim/AI.ts` that issues `Enter` against a BUILDING. So the Order cannot
 * garrison a relay head, cannot flip it, and cannot make the two primaries
 * unreachable behind `GarrisonService`'s own capture veto. That is what keeps
 * `entityDead` honest on a Gaia tag here, and it is a fact about the brain
 * rather than about the rules — say so if either changes.
 *
 * ============================================================================
 * WHAT THE GUNS AND THE COLUMN ACTUALLY DO, DERIVED
 * ============================================================================
 * Off the shipped tables (`WEAPONS` in `src/data/Defs.ts`, `DEFAULT_WEAPONS` in
 * `src/sim/Combat.ts`, `ARMOR_MATRIX`, `COMBAT_DAMAGE.globalMul` 0.80).
 * **Re-derive rather than re-quote after any retune.**
 *
 * `glaiveRepeater` is 12 x 5 over a `(5-1)*0.06 + 0.55` = 0.79 s cycle =
 * **75.95 raw**:
 *
 *     vs Infantry  x1.00 -> 60.76 dps   a 90-hp engineer dies in  1.48 s
 *                                       a 120-hp G.I. in          1.97 s
 *     vs Medium    x0.28 -> 17.01 dps   a 340-hp Warden lasts    19.99 s
 *
 * `lightCannon` is 55 AP on a 1.5 s cooldown = 36.67 raw, and AP against
 * Concrete is 0.55, so a Warden puts **16.13 dps** on a post and six put
 * **96.80** — a 480-hp Glaive Post in **4.96 s**, the 650-hp register in
 * **6.71 s**. `rifle` is 3 x 18 over a 1.03 s cycle = 52.43 raw, so eight G.I.s
 * put **335.5 dps** on infantry and take a 110-hp Wayfarer down in 0.33 s of
 * concentrated fire.
 *
 * The Order's line answers: `focusLance` is 60 AP / 1.6 s = 37.50 raw, **30.00
 * dps** against a Warden's Medium, so a Solarch kills one in **11.33 s** — and
 * it does it from **26 m against the Warden's 24**, which is the Pact doctrine
 * rule and the reason this operation's tanks cannot simply trade. `pulseCarbine`
 * is 15 x 3 over 0.96 s = 46.875 raw, **37.50 dps** on infantry, so a Wayfarer
 * kills an engineer in **2.40 s** and needs **32.4 s** for a Warden.
 *
 * ============================================================================
 * THE POSTS RUN ON THE ORDER'S GRID, AND THREE SOLAR ARRAYS IS THE NUMBER
 * ============================================================================
 * `glaiveRepeater` carries `needsPower`, and `Combat.ts`'s second tier refuses
 * to fire it during ANY grid deficit rather than only when the shed picked that
 * tower. Measured on the rostered build by summing `BuildingDef.power` over
 * every seat-1 structure: **produced 640, consumed 260, +380 net**, from four
 * `mrdSolarArray` at 160 each.
 *
 *     arrays killed   produced   net      the two posts on the arc head
 *     none               640     +380     firing
 *     one                480     +220     firing
 *     two                320      +60     firing
 *     three              160     -100     DARK
 *
 * So there is a second way to open every lodging cell on the arc head and it costs
 * three structures inside the Order's own base — whose Conclave stands 154.2 m
 * from the head in a straight line, with the arrays behind it — attacked by a
 * force that cannot replace a hull. It is COSTED AND NOT RECOMMENDED — four Wardens
 * of driving to save 4.96 s of shooting — and it is written down because a
 * player who tries it should find that the file already knew, and because the
 * unrostered control has an extra -115 of draw on it (see below) and would give
 * a different answer.
 *
 * ============================================================================
 * THE COLUMN, AND WHAT `opening: 'force'` MEANS HERE
 * ============================================================================
 * `buildBaseFor` is called for seat 1 and NOT for seat 0. The player opens with
 * nineteen hulls and nothing else — no Construction Yard, no factory, no
 * harvester, and `credits: 0` on top, so there is no bank to look at either.
 * `soviets.02.common-standard` is the other operation shaped this way and its
 * header is the argument; what is different here is that five of the nineteen
 * are UNARMED and are the objective rather than an escort.
 *
 *     5 engineer   2 500 credits   the section. A lodging MAY spend one; the
 *                                  register spends four and can spend nothing
 *                                  else.
 *     8 gi         1 600           the screen — and, since `refusalFor` lets one
 *                                  walk into a relay head, the other way to
 *                                  lodge a slip.
 *     6 grizzly    4 200           the only thing that breaks a post in five
 *                                  seconds.
 *                  8 300 total
 *
 * **THE SECTION AND THE SCREEN ARE BOTH PLACED ONE MAN AT A TIME RATHER THAN BY
 * `formation`**, because `formation` returns a COUNT and the trigger table needs
 * them TAGGED: `t.mercy` reads `ownerCount(player 0, role 'unit', tag ..., max:
 * 0)` on BOTH tags, which is the operation's dead-end guard. A count cannot be
 * tagged.
 *
 * **THE SCREEN'S TAG IS PART OF THE GARRISON FIX.** While a head could only be
 * lodged by an engineer, "the section is gone" was the dead end. It is not: a
 * rifleman lodges one too, so the state that cannot finish the list is *no
 * infantry of any kind left*, and `t.mercy` has to be able to ask that. The
 * Wardens are deliberately NOT tagged — a hull cannot walk into a relay block,
 * so a commander down to armour alone is exactly the case being rescued.
 *
 * `b.block(home, 30)` reserves the muster ground. `spawnUnit` does not call
 * `block()` itself — the `START_CLEAR_RADIUS` finding `soviets-common-standard`
 * records — so without it `scatter` is free to drop props into the one place the
 * operation cannot start without.
 *
 * ============================================================================
 * `ROAD` AND `MUSTER` ARE RINGS, NOT POINTS
 * ============================================================================
 * `EffectSink.spawnUnits` puts unit `i` of `count` at `angle = i / count * 2pi`
 * and radius `spread`, and `ProductionService.spawnUnit` writes that position
 * VERBATIM — no `connectedGround`, no egress search of any kind, unlike
 * `ScenarioBuilder.spawnUnit`, which this file uses and which does search. So
 * what this file owes the trigger table is GROUND rather than a point:
 *
 *     ROAD   (352, 176)   70.2 m of Track route off the Order's Conclave and
 *                         250.5 m of Track route to the yards head. **441 of
 *                         441 two-metre samples within 24 m are passable to
 *                         Foot AND Track**, and every point of all six authored
 *                         rings is clear.
 *     MUSTER (168, 328)   79.4 m behind the column's own muster, 164.5 m of Foot
 *                         route to the arc head and 261.8 m to the yards head.
 *                         **317 of 317 samples within 20 m passable**, and both
 *                         authored rings clear.
 *
 * `tests/campaign-spawn-ground.spec.ts` is the gate, and it checks every point
 * of every wave against that wave's own locomotor — which for `mrdSolarch` is
 * `MoveClass.Hover` and not `Track`, because the whole Pact army hovers.
 *
 * ============================================================================
 * THE ROUTES, ON A NAMED INSTRUMENT
 * ============================================================================
 * 8-connected Dijkstra over `Terrain.passGrid`, octile step (4 m orthogonal,
 * 5.657 m diagonal), corner-cutting refused, run on the built world with the
 * roster in force. A cell depth is not a distance and this is not one:
 *
 *     Foot   column -> arc head        246.0 m    72.4 s at 3.4 m/s
 *     Foot   column -> yards head      289.5 m    85.1 s
 *     Foot   arc head -> yards head    221.0 m    65.0 s
 *     Foot   MUSTER -> arc head        164.5 m    48.4 s
 *     Track  column -> arc head        246.0 m    37.3 s at a Warden's 6.6 m/s
 *     Track  Conclave -> arc head      152.7 m    20.1 s at a Solarch's 7.6 m/s
 *     Track  Conclave -> yards head    287.6 m    37.8 s
 *
 * **THE SERIAL ROUTE IS 467.0 m AND 137.4 SECONDS OF WALKING**, which is 12.1%
 * of a 1140-second par. The rest of the operation is the fight, and no harness
 * in this repo can put a number on that — `campaign-maps.spec.ts` builds the
 * ground and does not fight on it. The operation header says so rather than
 * pretending the clock was derived.
 *
 * ============================================================================
 * ECONOMY, AND WHY THE PLAYER'S OWN ORE FIELD IS A JOKE
 * ============================================================================
 * `addStartOre` and nothing else. It lays one home field per opening and one
 * contested patch on the centroid, which on this antipodal pair is the map
 * centre. **The player cannot mine any of it** — no refinery, no harvester, no
 * bank — so their home field is 30 m of ore nobody will ever lift, and it is
 * left there because it is the Order's collectors that decide whether the middle
 * of this map is trafficked, and it is: their home field is theirs and the
 * contested patch is 152 m from the arc head on the road their columns take.
 *
 * There is no `addCivilians`. It hangs capturable derricks off the perpendicular
 * bisector, and this operation's whole subject is which two capturable
 * structures on the map matter. Four more would make the section a menu.
 *
 * ============================================================================
 * WHAT THE EMPTY ROSTER ACTUALLY WITHHOLDS, MEASURED
 * ============================================================================
 * Two builds, identical except for `setCampaignRoster`:
 *
 *     seat            with the roster            cleared (the control)
 *     player          18 units, 0 structures     18 units, 0 structures
 *     Meridian        12 units, 26 structures    14 units, 28 structures
 *     Meridian power  640 / 260                  640 / 375
 *
 *     the player loses   NOTHING. There is no base to withhold from, and every
 *                        key in the column is day-one open.
 *     the Order loses    2 Sandskiffs (`unit.raider`), a Reliquary
 *                        (`struct.tech`) and a Helios Spire
 *                        (`struct.defence.specialist`).
 *
 * **THE ORDER'S HALF IS THE LOAD-BEARING ONE AND THE SPIRE IS THE REASON.**
 * `mrdHelios` reaches **33 m** and carries `canTargetAir`; every structure at
 * the arc head is placed by this file, and a finished non-builder structure
 * projects `PLACEMENT.adjacencyRadius` 20 m plus its own radius, so the Order's
 * brain could found one inside about 26 m of the register — 21.7 m from the arc
 * head, so its 33 m covers all TEN lodging cells at once and closes the
 * operation's only door. Withheld, the longest structure weapon either army can
 * put on that ground is `glaiveRepeater` at 24 m, which is the two posts this
 * file already placed and the lodging-cell table above stays true.
 *
 * The Sandskiff matters for a second reason worth naming: it is 9.2 m/s with two
 * cargo slots, and a fixed force with five unarmed men in it has no answer to a
 * hull that can outrun every escort it owns.
 *
 * The player's half withholds nothing, and that is not the `REMOVES_NOTHING`
 * case `tests/campaign-roster-ground.spec.ts` names — that check reads the
 * OPERATION's whole build, and this one loses four entities on seat 1.
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
 *
 * ============================================================================
 * TAGS
 * ============================================================================
 * `arc`, `yards` — the two Works relay blocks, GAIA-owned. Read by
 *            `structureCaptured` (the two primaries, and the same-tick half of
 *            the three losses' `BOTH_ON_THE_WIRE` guard) and by `entityDead`
 *            (`t.arcLost` and `t.yardsLost`, one each so the debrief names the
 *            head that actually died).
 * `register` — the Order's field register, MERIDIAN-owned. Read by `ownerCount`
 *            only, so destroying it and taking it satisfy the secondary alike.
 * `section` — the five engineers.
 * `screen`  — the eight riflemen. Both read by `ownerCount` on seat 0, which is
 *            what `t.mercy` uses, and both are needed because either can lodge a
 *            head; a PLAYER-owned tagged hull is exempt from
 *            `campaign-maps.spec.ts`'s "a tag an entity condition reads on an AI
 *            seat is a building" rule, because nothing re-tasks it.
 * `wave1`..`wave4`, `watchArc`, `watchYards`, `relief` — produced by
 *            `spawnUnits` in the trigger table and never by this file. Declared
 *            anyway, so a reader asking where the pressure and the two gifts
 *            come from finds the answer in the file that owns the ground;
 *            `validateCampaign` and `tests/campaign-maps.spec.ts` both know a
 *            spawned tag is not the layout's to place.
 *
 * The two Glaive Posts are deliberately UNTAGGED. No trigger reads them, and a
 * tag nothing reads is a claim `tests/campaign-maps.spec.ts` would have to prove
 * for no purpose.
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
 * somewhere. This module owns them and `operations/allies/07-fair-copy.ts`
 * imports them; the dependency runs operation -> layout and never back. A number
 * written in two files is a number that will disagree the first time either is
 * tuned, and the failure — a reveal framing empty ground, a column ordered at a
 * building that is not there — is invisible to every gate.
 * ========================================================================== */

/** The map centre. `startPointsFor` reserves a shelf here first, on a continent. */
const CENTRE = MAP_SIZE * 0.5;

/**
 * The player's START SPOT at `mapSeed` 20 260 970 / `simSeed` 7 063.
 *
 * `seatedSlots(2, 7063, null)` draws the antipodal pair [0, 1], 386.16 m apart.
 * **THERE IS NO CONSTRUCTION YARD HERE** — this operation is `opening: 'force'`,
 * so this is where the column stands at tick one and nothing else, and every
 * distance in this header is quoted against it rather than against a yard.
 */
const HOME: Point = { x: 108, z: 380 };
/** The Order's start spot at the same seeds. Their Conclave lands beside it. */
const FOE: Point = { x: 404, z: 132 };

/**
 * The arc head — the relay block that repeats down the whole eastern trunk.
 * GAIA, 800 hp, and the primary. Lands on this literal at ring zero: 246.0 m of
 * Foot route from the column and 152.7 m of Track route from the Order's
 * Conclave, with two Glaive Posts on it.
 */
export const ARC: Point = { x: 296, z: 242 };

/**
 * The yards head — the relay block that feeds the plate yards. GAIA, 800 hp, the
 * second primary, and there is **no structure of any kind within 199.53 m of
 * it** — that being a Glaive Post on the OTHER head, against a 24 m gun. 289.5 m
 * of Foot route from the column and 221.0 m from the arc head.
 */
export const YARDS: Point = { x: 128, z: 114 };

/**
 * The Order's field register — the copy their own slip is lodged from.
 * MERIDIAN-owned, 650 hp, 47.71 m from the arc head on the bearing their
 * Conclave is on, and the one structure in this operation that is meant to be
 * SHOT: four engineers to take it against 6.71 seconds of six Wardens.
 */
export const REGISTER: Point = { x: 336, z: 216 };

/**
 * Where the Order's timed troops form. 70.2 m of Track route off their own
 * Conclave and 250.5 m of Track route from the yards head, so a troop sent at
 * the far block arrives spread and late — 32.9 s at a Solarch's 7.6 m/s against
 * 65.9 s at a Wayfarer's 3.8.
 */
export const ROAD: Point = { x: 352, z: 176 };

/**
 * Where anything the Allies push across the seam comes ashore. 79.4 m behind the
 * column's own muster on ground no Meridian column crosses, 164.5 m of Foot
 * route to the arc head and 261.8 m to the yards head.
 */
export const MUSTER: Point = { x: 168, z: 328 };

/**
 * The briefing reveal over the arc head.
 *
 * **30 m, NOT 48**, and the eighteen metres are the point: it covers the head
 * and both posts (23.41 m from the head, both of them) and stops short of the
 * register at 47.71 m, so the later reveal of the register is a reveal rather
 * than a no-op. `revealArea` is `Vision.exploreCircle` and is PERMANENT;
 * `soviets-demolition-order` records the same trap for its two feeder plants.
 */
export const ARC_AREA: Area = { x: ARC.x, z: ARC.z, r: 30 };

/** The yards head, revealed in the same breath. 24 m covers the block and its yard. */
export const YARDS_AREA: Area = { x: YARDS.x, z: YARDS.z, r: 24 };

/**
 * The register, revealed a beat later.
 *
 * 20 m against the 47.71 m that separates the two centres, so the nearest 2.29 m
 * of this disc is ground `ARC_AREA` already showed and the register itself —
 * 47.71 m out — is 17.71 m beyond anything the first reveal reached.
 */
export const REGISTER_AREA: Area = { x: REGISTER.x, z: REGISTER.z, r: 20 };

/* ==========================================================================
 * 2. PLACEMENT
 * ========================================================================== */

/**
 * The two posts, as plain world offsets from the arc head.
 *
 * **ONE INTEGER PAIR AND ITS EXACT NEGATION**, which is a property a reader can
 * check by eye and is why this pair was chosen out of the 313 that satisfy the
 * cover. Both stand 23.409 m from the head, each bears on five of the ten
 * lodging cells, and no cell is under both — the table in the header is the
 * measurement.
 *
 * **THEY WERE (+22, -16) AND (-18, +16) AND THAT LEFT TWO CELLS UNDER NO GUN.**
 * (294, 234) and (302, 246) sat between the two arcs at 25.06 and 25.38 m of
 * surface distance — inside the ACQUIRE circle (26.154 m), outside the FIRE
 * circle (24.234 m) — so a post slewed onto an engineer standing there and never
 * pulled the trigger, and `glaiveRepeater` has `splashRadius: 0`. The operation's
 * central claim ("break a post to open a stand") was defeated by a 12.2 m
 * detour. The header carries the exclusion control that says the new pair has no
 * such route at all.
 *
 * THE GRID PHASE IS A CONSTRAINT, NOT A PREFERENCE. A 1x1 footprint centres on a
 * cell CENTRE (4k + 2); the arc head is x = 296 (a BOUNDARY) and z = 242 (a
 * centre), so a legal offset has `dx = 2 (mod 4)` and `dz = 0 (mod 4)`. An
 * earlier draft used dz = -14, 242 - 14 = 228 is a boundary, and `spawnBuilding`
 * moved the post two metres from where the offset said.
 *
 * TWO RATHER THAN THREE OR FOUR. Two already cover every cell; a third would
 * only make the head unapproachable without breaking a gun, and the arithmetic
 * that makes this operation work is that the column spends 4.96 seconds of six
 * Wardens' fire and then walks a man in. `allies-forced-closure` records the
 * mirror of this: THREE guns there leave one FACE open, and a fourth on the
 * right shoulder would have shut it.
 */
type Offset = readonly [dx: number, dz: number];
const ARC_POSTS: readonly Offset[] = [[22, -8], [-22, 8]];

/** Rings searched outward for a legal footprint, in metres. Nearest first. */
const PLACE_RINGS: readonly number[] = [0, 6, 12, 18, 26, 34];
/** Eight exact bearings. Integers only, so every candidate is bit-identical. */
const PLACE_BEARINGS: readonly (readonly [number, number])[] = [
  [1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
];
/** Ring zero is the nominal spot itself; the bearings would test it eight times. */
const ORIGIN_ONLY: readonly (readonly [number, number])[] = [[0, 0]];

/**
 * Metres reserved around each head so `scatter` leaves every capture stand
 * clear. 20 m, which is 11.6 m past the furthest lodging cell at 8.246 m out — a
 * boulder dropped on the one face an engineer can use would delete a PRIMARY
 * silently, and `Scatter` knows nothing about capture geometry.
 */
const HEAD_CLEAR = 20;
const REGISTER_CLEAR = 16;
const POST_CLEAR = 10;

/**
 * The section, laid out one man at a time so each can be tagged.
 *
 * Six metres apart in a rank across the muster, which is inside the 30 m
 * `block()` below. Integers only.
 */
const SECTION_OFFSETS: readonly Offset[] = [
  [-12, 0], [-6, 0], [0, 0], [6, 0], [12, 0],
];

/**
 * The screen, laid out one man at a time FOR THE SAME REASON THE SECTION IS.
 *
 * It was `b.formation('gi', ..., 8, { columns: 4, spacing: 7, jitter: 0.6 })`,
 * which returns a COUNT, and a count cannot be tagged. `t.mercy` has to be able
 * to ask whether the player still owns a man who can walk into a relay head —
 * and after the garrison finding below, that is EVERY infantryman rather than
 * only an engineer, so the screen needs the same treatment the section already
 * had. Two ranks of four, seven metres apart, fourteen metres ahead of the
 * section, which is what `formation`'s own grid would have produced without the
 * jitter; the jitter is dropped because it draws on `s.rng` and this file is
 * otherwise entirely literals.
 */
const SCREEN_OFFSETS: readonly Offset[] = [
  [-12, -14], [-4, -14], [4, -14], [12, -14],
  [-12, -22], [-4, -22], [4, -22], [12, -22],
];

/* ==========================================================================
 * 3. THE BUILD
 * ========================================================================== */

export default layout({
  id: 'allies-fair-copy',
  tags: [
    'arc', 'yards', 'register', 'section', 'screen',
    'wave1', 'wave2', 'wave3', 'wave4', 'watchArc', 'watchYards', 'relief',
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
        `[campaign] allies-fair-copy built on (${String(cx)}, ${String(cz)}), not the map centre `
        + `(${String(CENTRE)}, ${String(CENTRE)}) — the trunk is authored in absolute coordinates `
        + 'and will not line up with the openings this build lays down.',
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
     * the Order's base from the real `startSpots`. A generator change that slid
     * an opening would move the COLUMN and the Conclave and leave the two heads,
     * the register and the posts exactly where they are — and `MUSTER`, 79.4 m
     * behind the muster, is the one with the least room to absorb it. Four
     * metres is one cell.
     */
    if (Math.abs(home.x - HOME.x) > 4 || Math.abs(home.z - HOME.z) > 4
      || Math.abs(foe.x - FOE.x) > 4 || Math.abs(foe.z - FOE.z) > 4) {
      console.warn(
        `[allies-fair-copy] openings moved: player (${String(home.x)}, ${String(home.z)}) and `
        + `foe (${String(foe.x)}, ${String(foe.z)}) against the authored (${String(HOME.x)}, `
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
     * as the fallback and nothing on this ground reaches it: all five buildings
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

    /* -- the Order's base --------------------------------------------------
     * ONE SEAT GETS A BASE AND THE OTHER DOES NOT. `c.opening` is `'force'`,
     * which `types.ts` defines as honoured by a layout simply not calling
     * `buildBaseFor` — there is no third `START_CONDITIONS` member and there must
     * not be one, because it would put a "Fixed force" row in the SKIRMISH lobby
     * where nothing would ever call `buildBaseFor` at all.
     */
    buildBaseFor(b, them, foe.x, foe.z, { facingDeg: wrapDeg(foe.facingDeg + 180) });

    /* -- the trunk ---------------------------------------------------------
     * BOTH HEADS ARE GAIA, and that is the operation rather than a flavour
     * choice: `ScenarioBuilder.gaia` allies the Neutral slot to everybody in both
     * directions, so `Capture.ts` rule 1 applies — one engineer, at any health,
     * consumed — and no Meridian gun can ever acquire one. On a Meridian seat
     * they would be rule 2, four engineers each, and the operation's whole
     * arithmetic (one man a head, four men for the register) would collapse into
     * one number.
     *
     * NO `unlockedBy` ON EITHER KEY, WHICH IS LOAD-BEARING UNDER AN EMPTY
     * ROSTER. `spawnBuilding` consults the progression gate, so a tagged key here
     * would return `NONE`, the tag would land on nothing, `structureCaptured`
     * would be unreachable and the operation would be unwinnable in silence.
     * `civApartments` is untagged, and `tests/campaign-roster-ground.spec.ts`
     * builds this operation with the roster armed and the def tables bound, which
     * is the only state that can see the difference.
     */
    raise(b.gaia, 'civApartments', place(b.gaia, 'civApartments', ARC), 'arc', 90, HEAD_CLEAR);
    raise(b.gaia, 'civApartments', place(b.gaia, 'civApartments', YARDS), 'yards', 0, HEAD_CLEAR);

    /*
     * The Order's field register. `radar` rather than `mrdOculus` because
     * `ScenarioBuilder.spawnBuilding` runs every key through `keyFor`, which
     * resolves the ROLE against the seated army — so this file stays correct if
     * `op.foe` ever moves, and `tests/campaign-emplacement-reach.spec.ts` §1 pins
     * what it actually resolved to.
     *
     * IT IS A REAL RADAR AND NOT A PROP, which buys the secondary something the
     * trigger table never mentions: `mrdOculus` is the Pact's tier-two opener, so
     * taking it off them shuts the top of their own build tabs for as long as it
     * takes `AiBrain.census` to notice and rebuild.
     */
    raise(them, 'radar', place(them, 'radar', REGISTER), 'register', 180, REGISTER_CLEAR);

    /*
     * The two posts on the arc head. EMPLACEMENTS RATHER THAN PARKED HULLS, and
     * that is structural: `AiBrain.census` files every untagged, non-harvester
     * hull an AI seat owns into `armyIds` and `regroupSquads` drives it to the
     * rally point on the next brain pass — measured on `soviets.02.common-standard`
     * at 116.6 m and 129.2 m off the post inside twenty seconds. A Glaive Post
     * cannot be re-tasked, and `AiBrain` has no `issueSell` either, so the only
     * things that take one off the head are the player shooting it and the
     * Order's own grid going into deficit.
     */
    for (const [dx, dz] of ARC_POSTS) {
      const g = { x: ARC.x + dx, z: ARC.z + dz };
      raise(them, 'pillbox', place(them, 'pillbox', g), null, 0, POST_CLEAR);
    }

    /* -- the column --------------------------------------------------------
     * The section first, one man at a time, because each has to carry the
     * `section` tag — see the header. `c.tag` ignores `NONE`, so a refused spawn
     * simply does not join the set, and `tests/campaign-maps.spec.ts` fails on an
     * empty declared tag rather than the operation failing on tick one.
     */
    let section = 0;
    for (const [dx, dz] of SECTION_OFFSETS) {
      const id = b.spawnUnit('engineer', us, home.x + dx, home.z + dz, { yawDeg: home.facingDeg });
      if (id !== NONE) { c.tag('section', id); section++; }
    }
    let screen = 0;
    for (const [dx, dz] of SCREEN_OFFSETS) {
      const id = b.spawnUnit('gi', us, home.x + dx, home.z + dz, { yawDeg: home.facingDeg });
      if (id !== NONE) { c.tag('screen', id); screen++; }
    }
    const armour = b.formation('grizzly', us, home.x, home.z + 16, 6, {
      yawDeg: home.facingDeg, columns: 3, spacing: 10, jitter: 0.6,
    });
    b.block(home.x, home.z, 30);

    if (section < SECTION_OFFSETS.length || screen < 8 || armour < 6) {
      /*
       * LOUD, for the reason `campaign-install.ts` shouts about a short spawn
       * wave: this operation's player cannot build a replacement for ANY of
       * these, and the section is the objective rather than the escort. A column
       * that quietly arrives one engineer short is an operation with one fewer
       * entry on its list, with every test still green.
       */
      console.error(
        `[campaign] allies-fair-copy placed ${String(section)}/5 engineers, ${String(screen)}/8 `
        + `G.I. and ${String(armour)}/6 Wardens for the player — this operation is `
        + "`opening: 'force'` and none of them can be replaced.",
      );
    }

    /* -- economy and dressing ---------------------------------------------- */
    addStartOre(b, spots, b.sea);

    /*
     * Open on the column looking down the lane, biased 13% toward the map centre
     * — the same bias `allies-sounding-line`, `allies-misclosure` and
     * `allies-forced-closure` use — so the first thing on screen is the ground
     * the operation will be walked across rather than the back of the muster.
     */
    b.setCameraFocus(home.x + (cx - home.x) * 0.13, home.z + (cz - home.z) * 0.13);
    b.scatter({ minX: cx - 180, minZ: cz - 180, maxX: cx + 180, maxZ: cz + 180 }, 150);
    void start;
  },
});
