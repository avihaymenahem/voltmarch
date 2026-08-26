/**
 * ============================================================================
 * P2 — THE LONG COUNT
 * ============================================================================
 * The Soviets have sunk a pump on Pact crust and it is running. Thirty-two
 * metres behind it stands a Pact reading post that has counted this seam since
 * before the Continental Works had a name. Calvane wants the pump off and the
 * count intact, and the second half is the operation.
 *
 * ============================================================================
 * THE DECISION THIS OPERATION OWNS
 * ============================================================================
 * **HOW CLOSE YOU PARK.** Not which units you bring, not which road you take —
 * how far short of the pump your hulls stop. Everything below is read off the
 * shipped `Targeting`, `Damage` and weapon tables at this operation's seeds.
 *
 * `Targeting.approach` parks an attacker where its SURFACE distance to the
 * target is `range * APPROACH_STOP_FRAC` (0.80) and pins it there. When that
 * target dies it goes `Idle` and scans, and `Targeting.reachOf` widens the
 * scan for a chasing stance to
 *
 *     envelope = max(range * 0.80 + GUARD_LEASH, range * 1.08)
 *              = range * 0.80 + 18        for every gun under 64.3 m of reach
 *
 * also on surface distance. **SURFACE, IN BOTH PLACES, IS THE WHOLE
 * DERIVATION** — `approach` and `isValidTarget` each subtract the TARGET's
 * `hitRadius`, and the pump and the post are both 2x2 footprints at `CELL` 4,
 * so both carry `hypot(4, 4)` = **5.6569 m** and the two cancel. The reading
 * post is on the Soviet seat: a legal target for every gun in the Pact's army,
 * and nothing in the trigger table can stop one taking it.
 *
 * **A FIRST DRAFT OF THIS BLOCK MEASURED THE PARK DISTANCE CENTRE-TO-CENTRE
 * AND WAS WRONG BY 5.66 m IN EVERY ROW.** It put the lower bound at 23.657 and
 * the margin at 8.59. `Targeting.approach` says so in its own comment —
 * "Surface distance, exactly the quantity `WeaponSystem` gates firing on" —
 * and the corrected numbers are below. Re-derive; do not re-quote.
 *
 * **THE GAP IS 32.249 m, MEASURED ON A HEADLESS BUILD**, and the whole table
 * falls out of it. `park` is the CENTRE distance a hull actually stops at,
 * `0.80R + 5.6569`:
 *
 *                             R    park    envelope   surface to the post
 *                                                     near side    far side
 *     Wayfarer  pulseCarbine  20   21.66     34.00     48.25 ok     4.94 IN
 *     Solarch   focusLance    26   26.46     38.80     53.05 ok     0.14 IN
 *     Sunlancer sunLance      26   26.46     38.80     53.05 ok     0.14 IN
 *     Sandskiff arcRepeater   23   24.06     36.40     50.65 ok     2.54 IN   (locked)
 *     Zenith    zenithBeam    40   37.66     50.00     64.25 ok     0.00 IN   (locked)
 *
 * Three things in that table are the operation:
 *
 *   1. **THE STANDOFF IS SAFE FOR EVERY GUN, AND THAT IS ARITHMETIC RATHER
 *      THAN LUCK.** A shooter parked on the road side sits `D + 0.80R + 5.6569`
 *      from the post's centre, so its SURFACE distance to the post is
 *      `D + 0.80R`, and it acquires when `D + 0.80R <= 0.80R + 18`. **Both the
 *      `0.80R` and both `hitRadius` terms cancel.** The condition is
 *      **`D <= 18.000`**, full stop — no weapon appears in it. At D = 32.249
 *      every row above clears by exactly **14.25 m**, identical in all five
 *      rows because it is `D - 18`.
 *   2. **14.25 m IS THEREFORE THE WHOLE MARGIN, AND IT IS SPENT BY DRIVING.**
 *      The critical CENTRE distance is `0.80R - 8.592`: 7.41 m for a Wayfarer,
 *      12.21 m for a Solarch, 23.41 m for a Zenith — in each case 14.25 m
 *      inside that hull's own stopping distance. A player who right-clicks the
 *      pump never crosses it. A player who ATTACK-MOVES through the compound
 *      does, because an attack-move keeps walking to its destination — so the
 *      ORDER matters more than the army does. And the overrun really does bite
 *      for everything, because a hull cannot physically sit closer to the pump
 *      than `5.6569 + its own radius`: 8.45 m for a Solarch against a 12.21 m
 *      critical distance, 5.89 m for infantry against 7.41. Margins of 3.76 m
 *      and 1.52 m — small, and on the correct side.
 *   3. **THERE IS NO STANDOFF ON THE FAR SIDE AT ALL.** Come at the pump from
 *      the Soviet end and the post is between you and it: **0.14 m** of surface
 *      distance for a Solarch and 0.00 for a Zenith, against 38.80 and 44.40 m
 *      envelopes. A hull that parks there is effectively touching the post, and
 *      `t.countLost` ends the match.
 *
 * ============================================================================
 * SPLASH IS THE OBVIOUS THREAT AND IT IS NOT THE THREAT. THE AUDIT:
 * ============================================================================
 * `Damage.applySplash` accepts a victim when `surface < radius`, where
 * `surface = sqrt(plan) - hitRadius(victim)` and `plan` gains the vertical term
 * `(|dy| - estimatedHeight * 0.5)^2` only when that is positive. Both
 * structures stand on the ground, so the term clamps to zero and this is the
 * plain horizontal figure. From a blast centred ON the pump the post is at
 * `32.249 - 5.6569` = **26.59 m of surface distance**. Against that:
 *
 *     pulseCarbine  Wayfarer, Tidewalker      no splash
 *     arcRepeater   Sandskiff                 no splash          (locked)
 *     focusLance    Solarch, Hierarch         1.4 m
 *     sunLance      Sunlancer                 2.0 m   <- the roster's largest
 *     kestrelPod    Kestrel Gunship           1.8 m              (locked)
 *     mirrorGun     Kite Corvette             3.4 m   <- unbuildable, see below
 *     monitorLance  Sunmonitor                4.2 m   <- unbuildable, see below
 *
 * **26.59 m is 13.3x the largest blast the army can field.** A Sunlancer would
 * have to put a rocket within `2.0 + 5.6569` = **7.66 m of the post's centre**
 * to mark it — that is, be shooting something standing on its lot.
 *
 * **THE TWO GUNS THAT COULD ARE THE TWO THAT CANNOT BE BUILT HERE.** Both are
 * `waterOnly` hulls off a Slipway, and a Slipway wants a real coast:
 * `MAP_SEAS` has no `temperate` row, and the built world carries **16 water
 * cells out of 16 384**, 0.098%. That is a property of the PRESET and survives
 * a seed change.
 *
 * **THE COMMAND POST CARRIES NO `unlockedBy`, SO `roster.player: []` DOES NOT
 * WITHHOLD THE AIRSTRIKE.** It is 260 HighExplosive at radius 20, delivered
 * through this same `applySplash`. From a marker on the pump the post is at
 * 26.59 m of surface — **outside 20, with 6.59 m to spare, so it takes
 * nothing**. The marker only touches it if it is dropped within `20 + 5.6569` =
 * 25.66 m of the post, i.e. more than **6.59 m PAST the pump**. Of the other
 * four powers, Emergency Repair heals, Ore Boost pays, Orbital Scan reveals,
 * and Chronoshift teleports — that last one can put an army 30 m from a marker,
 * which is a way INTO the envelope rather than a way to break the post. Every
 * superweapon is `struct.superweapon.*` and is refused.
 *
 * **THE SOVIETS CANNOT DO IT EITHER, AND THAT WAS CHECKED RATHER THAN
 * ASSUMED.** Their largest ungated MOBILE blast is `heavyCannon` (Anvil Tank,
 * 2.1 m), which needs to land within 7.76 m of the post's centre; `artillery`
 * — the 6.5 m V4 Launcher — has **no carrier at all**, which `Defs.ts` states
 * in as many words. `isValidTarget` refuses an allied target, so the AI never
 * aims at it; the brain has no `issueSell`, so it cannot remove it; and
 * placement refuses occupied ground, so it cannot build over it. **The only
 * army that can break the reading post is yours** — until you take the deed
 * off them, which is what route B below is really selling.
 *
 * **ONE HALF OF THAT PARAGRAPH WAS WRONG AND THE CONCLUSION SURVIVED IT
 * ANYWAY.** It read *"`flameTower` (3.2 m) and `teslaCoil` are both
 * `struct.defence.specialist` and `roster.ai` is empty"*. `teslaCoil` is and
 * is refused; **`flameTower` carries no `UNLOCK_TAGS` row at all**, and that
 * table's own `struct.defence.specialist` block says *"NOT `flameTower`"* in as
 * many words and gives the reason. So an empty `roster.ai` withholds nothing
 * from it, and counted on the built world **two Flame Towers stand on the
 * Soviet seat**. They do not touch the post: the nearer is **124.4 m** from it
 * and the other 130.4 m, which is 39x and 41x their own 3.2 m blast, and an
 * emplacement cannot close. The argument that holds is the DISTANCE, not the
 * roster — which is the shape of claim to prefer here, because a roster is a
 * list somebody can edit and a hundred and twenty metres is not.
 *
 * ============================================================================
 * THREE ROUTES, AND THE THIRD IS THE ONE NOBODY EXPECTS
 * ============================================================================
 * **A — STAND OFF.** Park where `Targeting` parks you and shoot the pump. The
 * price is paid to the two Sentry Guns, which land 19.0 m and 22.1 m in front
 * of it. `pillboxMg` reaches 22 m of surface, so it engages a Solarch out to
 * **24.79 m** of centre distance (the hull's own radius is 2.79); a Solarch
 * engages the 1x1 emplacement out to **28.83 m**; and `Targeting` parks the
 * Solarch at **23.63 m**, inside the gun's reach by 1.16 m. So the ordinary
 * right-click pays full price — 36.20 dps against Light armour, a 330 hp
 * Solarch every **9.12 s**. Hand-stopping anywhere in the 24.8 to 28.8 m
 * window kills the emplacement for nothing. That is a skill discount on the
 * approach and it is left in, exactly as `soviets-common-standard` leaves its
 * own.
 *
 * **B — TAKE THE DEED. IT IS REFUSED OUTRIGHT NOW, AND EVERYTHING BELOW IS THE
 * PRICE IT USED TO CARRY.** `captureProof: ['count']` installs a
 * `CaptureService` veto for the duration of this operation, so `isCapturable`
 * answers false at the cursor and `resolve` refuses on arrival without
 * consuming the Artificer. The arithmetic is kept rather than deleted because
 * it is what made the case, and because the `tap` and `staging` deeds are
 * priced by the same table. The old text read *"`CaptureService.isCapturable`
 * refuses only an
 * already-owned building; there is no health threshold on an enemy structure.
 * A 500-credit Artificer who walks the 268.5 m makes the reading post PLAYER
 * property"*. The first clause is a true sentence about `isCapturable` and a
 * false one about the capture: **`CaptureService.resolve` tests the health
 * itself.** Above `CAPTURE.captureHpFrac` (0.5) an ENEMY structure takes the
 * SOFTEN branch — `maxHp * CAPTURE.softenFrac` (0.25) pushed as a
 * HighExplosive damage record, through `ARMOR_MATRIX[HighExplosive][Concrete]`
 * (1.00) and `COMBAT_DAMAGE.globalMul` (0.80), so **0.20 of max lands and the
 * Artificer is consumed for it**.
 *
 * Driven through the real `CaptureService` and the real `DamageSystem` on
 * 2026-08-19, the 900 hp post walks **900 -> 720 -> 540 -> 360** — 0.400 of
 * max, the first reading at or under the gate — and the FOURTH Artificer takes
 * it. **Four engineers, 2000 credits**, 40% of the opening bank, delivered on
 * foot across 268.5 m of Soviet ground. Bring a gun and it is one Artificer
 * plus 450 hp of shooting, which at the 16.50 dps derived below is **27.3 s of
 * one parked Solarch**: 500 credits and half a minute.
 *
 * **AND EVERY SPELLING OF IT SPENDS THE HIDDEN SECONDARY BEFORE IT DELIVERS
 * ANYTHING.** `t.graze` is `entityHpBelow 'count' frac 1`, which is any damage
 * at all, and the first soften is 180 of it; `Session.setObjective` opens with
 * "A RESOLVED OBJECTIVE DOES NOT UN-RESOLVE", so `quiet` and its 400 credits
 * are gone permanently on engineer one. The third soften puts the post under
 * half and spends `t.hurt` as well. **There is no undamaged route.** A squad
 * cannot take it instead: `GarrisonService.refusalFor` answers **'hostile'**
 * for a structure whose owner is neither neutral nor allied, so the engineer is
 * the only door and the soften branch is the only way through it.
 *
 * **WHAT IT BOUGHT WAS WORSE THAN WHAT IT COST, WHICH IS WHY IT IS NOW REFUSED
 * RATHER THAN LEFT IN.** `isValidTarget` refuses an allied target, so a
 * captured post is safe from every gun YOU own — and legal for every gun THEY
 * own, because it stops being theirs. The post is 134.2 m from the Soviet
 * OPENING and 131.5 m from the Construction Yard that opening raises, and
 * `t.countLost` does not care who fired. So route B paid 400 credits of
 * secondary plus 500-2000 of engineer to convert *my own gunners might kill it*
 * into *theirs will*. `t.see`'s second line already warns about the envelope;
 * the deed was a third way into the same loss, and the sentence that stood here
 * — *"the honest fix for it is a `CaptureService.addVeto` this operation has no
 * way to install"* — named the right mechanism and the right gap.
 * `OperationDef.captureProof` is that installer. See the block on `count`
 * below.
 *
 * (Two corrections kept from the old paragraph, one of which was itself wrong.
 * **THE YARD FIGURE IS THE RIGHT ONE AND THE OPENING FIGURE WAS THE STALE
 * ONE.** This used to read "94.3 m is the distance to the START SPOT, not to
 * the Construction Yard", which had it exactly backwards: the yard lands at
 * (402, 134) and is 131.5 m from the post, and the start spot is (404, 132) and
 * is 134.2 m from it — 2.68 m apart, not the ~37 m the old correction implied.
 * 94.3 m was measured to a start spot the layout header had wrong; see its
 * `foe ->` column. And the clause *"the nearest Soviet structure of any kind is
 * 106.0 m away"* does not reproduce on the built world in either reading:
 * **the nearest of any kind is the pump itself at 32.2 m**, then the pump's two
 * Sentry Guns at 48.1 and 53.1 m, and the nearest thing in the Soviet base
 * proper is a wall segment at 92.5 m.)
 *
 * **C — THE FAR SIDE.** Never viable. See row 3 of the table above.
 *
 * ============================================================================
 * THE PUMP IS A DEED NOW. THE POST IS STILL A CORPSE, AND THAT IS DELIBERATE
 * ============================================================================
 * `t.win` and `t.quiet` were both `entityDead 'tap'`, and **a captured
 * structure is still alive** — `aliveWithTag` counts it. The pump is
 * `civOreMine` on the SOVIET seat: an enemy building, 700 hp, with the capture
 * cursor over it (`input/Commands.ts` §5, the `hoverEnemy` arm) and a
 * `CIVILIAN_INCOME_SOURCES` row paying its holder 5 cr/s. So walking an
 * Artificer into the one structure this operation is named after made the only
 * win condition in the table false forever, on an operation whose
 * `annihilationWin` is off.
 *
 * **AND THERE WAS NO WAY BACK.** `civOreMine` goes through
 * `Scenarios.civilian()`, which clears `EntityFlag.Sellable`, and
 * `RepairSell.selfDestruct` refuses an `EntityKind.Building` — so unlike
 * `pact.01.shallow-road`'s `radar`, a player who took this could not sell it
 * back off their own books. The only undo was ctrl-force-firing onto a
 * structure they had just paid four Artificers for.
 *
 * **EVERY PLAYER CAN MAKE THAT MISTAKE.** `mrdArtificer` carries no
 * `UNLOCK_TAGS` row, so `roster.player: []` cannot withhold it; its prereqs —
 * `mrdChapterhouse` and `mrdCistern` — both stand on the player's seat at t = 0
 * under `opening: 'base'`, counted on the built world; and the player OPENS
 * with one.
 *
 * So `t.win` and `t.quiet` count DEEDS — `ownerCount` on seat 1, one shared
 * `TAP_OFF` object — and **capture satisfies the primary exactly as demolition
 * does.** The primary's title and Calvane's two lines about taking the head off
 * were rewritten to stop naming the one route the rule no longer requires.
 * `quiet`'s title needed nothing: it has always read *"Take the pump without
 * marking the reading post"*, and it is now true in both senses of "take".
 *
 * ----------------------------------------------------------------------------
 * `count` IS NOT MIGRATED, AND MIGRATING IT WOULD BE THE WORSE BUG
 * ----------------------------------------------------------------------------
 * `t.countLost` stays `entityDead 'count'`, and `t.quiet`'s two guards stay
 * `entityAlive` and `not entityHpBelow`. Spelling `t.countLost` as
 * `ownerCount(1, 'building', 'count', max: 0)` would end the operation in a
 * **LOSS on the tick the player captured the post** — a defeat for taking the
 * four-hundred-year count into protective custody, which is a worse sentence
 * than the one being fixed.
 *
 * **WHAT WAS LEFT STANDING, AND WHAT CLOSED IT.** This block ended
 * *"documented, not closed"* and described the hazard precisely: capturing
 * `count` does not fail the operation by itself, it STRIPS THE POST'S ONLY
 * PROTECTION. `Targeting.isValidTarget` refuses an ALLIED target and nothing
 * else, so a Soviet-owned post is unshootable by the Soviets and a player-owned
 * one is not; every Soviet hull that walks past it then has a legal target
 * 134.2 m from their own opening, and `t.countLost` ends the match in a loss
 * whoever fired.
 *
 * The diagnosis was right and so was the refusal to fix it from a trigger — the
 * twelve conditions are all READS, so no trigger can refuse a capture. What was
 * missing was the installer, and it exists now: **`OperationDef.captureProof`**,
 * which this operation sets to `['count']`. It puts one
 * `CaptureService.addVeto` in front of `resolve()`, ahead of both the neutral
 * and the enemy branch, and `refuse()` does NOT consume the engineer — so route
 * B below costs a walk and nothing else, the Artificer walks home, and
 * `isCapturable` refuses at the CURSOR so the player never starts the walk.
 * `tests/campaign-capture-proof.spec.ts` drives it on this operation's own tag.
 *
 * Two consequences worth stating because they are improvements the fix was not
 * aimed at. The hidden `quiet` secondary is no longer spent by an engineer:
 * `t.graze` is `entityHpBelow frac 1`, i.e. any damage at all, and the first
 * soften was 180 of it, so every spelling of route B used to burn 400 credits
 * on the way in. And `t.hurt` no longer fires from three softens either.
 *
 * ============================================================================
 * THE NUMBERS THE FIGHT IS MADE OF
 * ============================================================================
 * Derived from `DEFAULT_WEAPONS`/`MERIDIAN_WEAPONS`, `ARMOR_MATRIX` and
 * `COMBAT_DAMAGE.globalMul` (0.80), and they must be RE-DERIVED rather than
 * re-quoted after any weapon retune. ArmorPiercing vs Concrete is 0.55, Rocket
 * vs Concrete 0.90, SmallArms vs Concrete 0.18, SmallArms vs Light 0.55.
 *
 *     Solarch    16.50 dps      pump  700 hp   4 Solarchs   10.6 s
 *     Sunlancer  17.40 dps      post  900 hp   4 Solarchs   13.6 s
 *     Wayfarer    6.75 dps      pump  700 hp   8 Wayfarers  13.0 s
 *
 * Two readings worth keeping. The **Sunlancer out-damages the Solarch against
 * concrete at 450 credits against 800**, because Rocket's 0.90 against Concrete
 * beats ArmorPiercing's 0.55 by more than the raw dps gap closes. And **the
 * safest gun in the army is the rifle**, because safety here is a function of
 * REACH: the Wayfarer's 20 m gives the smallest envelope on the map and
 * therefore the shortest critical distance, 7.41 m. Eight of them take the pump
 * in 13.0 s for 1400 credits. The operation says neither thing anywhere; both
 * are true because of the table.
 *
 * The post takes **54.5 s** to fall to a single Solarch that has wandered onto
 * it, which is the reason `t.graze` and `t.hurt` exist: a player who is warned
 * at the first scratch has most of a minute to notice and pull back.
 *
 * ============================================================================
 * THE SECONDARY IS ON THE OTHER SIDE OF THE ROAD, AND THAT IS DELIBERATE
 * ============================================================================
 * P1 shipped two secondaries that fought each other — a hold zone that sat
 * inside a weapon's range of an objective the other secondary needed alive,
 * because the header measured the disc's CENTRE and left the RADIUS out. So:
 *
 *   - `staging` is 145.0 m from the pump and **165.9 m from the reading post**.
 *     Nothing about it can be satisfied from anywhere near the post.
 *   - `quiet` and the primary `count` are the same constraint at two
 *     intensities — do not destroy it, and do not even mark it. They cannot
 *     conflict by construction.
 *   - **The only zone in this file is `t.see`'s, and it is measured below.**
 *
 * The staging post costs a detour of `188.0 + 145.0` = 333.0 m against 236.2 m
 * straight to the seam — **+96.8 m, about 12.7 s at a Solarch's 7.6 m/s** —
 * plus 1280 hp of Barracks and Sentry Gun. It buys 500 credits, the Soviets'
 * second infantry queue, and the four Anvil Tanks `t.tide` would otherwise put
 * on the road at minute seven: 3600 credits of armour that never arrives.
 *
 * **AND IT CAN BE BOUGHT WITH AN ARTIFICER INSTEAD OF A SHELL**, which is the
 * `STAGING_OFF` migration below: an 800 hp Barracks is four engineers on its
 * own, or one behind any gun that has already halved it, and the buyer keeps a
 * working infantry queue rather than a crater. All three of the things this
 * paragraph says the objective buys are denied by the deed and not by the
 * wreckage, so the threshold counts the deed.
 *
 * ============================================================================
 * THE ONE ZONE, AND WHY IT IS NOT CENTRED ON THE OBJECTIVE
 * ============================================================================
 * `t.see` is the only `unitsInArea` in this operation, and the rule it has to
 * clear is `tests/campaign-zone-safety.spec.ts`'s: **the protected entity must
 * be further from the disc's CENTRE than `r + envelope + hitRadius`.** That
 * spec deliberately takes the longest gun the PLAYER'S ARMY owns anywhere
 * rather than what this roster permits, because `OperationRoster` is an
 * allow-list over tagged defs only. For the Pact that is the Sunmonitor's
 * `monitorLance` at 40 m, so the bar is
 * `envelope 50.00 + hitRadius 5.6569` = **55.66 m** of standoff on top of `r`.
 *
 * **CENTRED ON THE PUMP THE DISC IS UNAUTHORABLE, AND THAT IS WORTH SHOWING
 * RATHER THAN ASSERTING.** Its nearest approach to the post would be
 * `32.249 - r`, and `32.249 - r >= 55.66` has no positive solution. Not a
 * small radius — NO radius. So the disc is centred 79.81 m SHORT of the pump,
 * back down the road the player arrives on:
 *
 *     APPROACH   (253, 317)   r = 36      d(centre, pump)  79.81
 *     d(centre, post)  111.83             nearest edge to the post  75.83
 *     bar               91.66             MARGIN                    20.17 m
 *
 * Against the envelope of what this roster actually fields (26 m -> 38.80,
 * + 5.6569 = 44.46) the margin is **31.37 m**. A player satisfies this trigger
 * seventy-five metres further from the reading post than any gun they own could
 * reach it from.
 *
 * **THE RADIUS WAS CUT FROM 40 TO 36 ON A SECOND MEASUREMENT, AND THE REASON IS
 * THE OTHER DIRECTION.** The near edge also has to clear the SOVIET guns, or
 * the line that warns the player arrives simultaneously with the first burst.
 * Measured on the built world, the nearer Sentry Gun sits 62.4 m from this
 * centre and the nearest Conscript 61.2 m — so at r = 40 the edge was **22.4 m**
 * from a 22 m `pillboxMg`, and at 36 it is **26.4 m**. Both constraints wanted
 * the same change, which is the only reason it was free.
 *
 * **AND 22 IS NOT THE NUMBER TO COMPARE 26.4 AGAINST — THAT IS THIS FILE
 * WALKING INTO P1'S OWN DEFECT.** `Combat.engage` gates firing on SURFACE
 * distance exactly as `isValidTarget` does, so a `pillboxMg` reaches
 * `22 + hitRadius(TARGET)` of CENTRE distance, and the target here is the
 * player's hull rather than a 2x2 structure. Ungated Pact ground hulls:
 * **24.79 m** against a Solarch (radius 2.79), 26.05 m against the widest of
 * them, the Carryall (4.05), 22.23 m against infantry (0.234). So:
 *
 *   - r = 40 was NOT "clear by four tenths of a metre" — its 22.4 m edge is
 *     INSIDE the firing envelope of every hull in the army, by 2.39 m for a
 *     Solarch. The cut to 36 was not a tightening, it was a fix.
 *   - r = 36 clears it by **1.61 m** for a Solarch and **0.35 m** for a
 *     Carryall — small, and on the correct side for every hull.
 *   - the Conscript comparison is comfortable either way: `conscriptRifle` 17
 *     reaches 19.79 m of centre against a Solarch, against a 25.2 m edge.
 *
 * ACQUISITION is a wider circle than firing and the edge IS inside it — an
 * emplacement cannot chase, so `reachOf` returns 0 and its acquire radius is
 * `range * 1.08` = 23.76 m of surface, i.e. 26.55 m of centre for a Solarch.
 * It costs nothing: the gun holds a target it has no way to shoot at or close
 * on. What the player is warned before is the first ROUND, not the first lock.
 *
 * It also cannot fire on tick one: the nearest player asset at t = 0 is
 * **132.1 m** from that centre against the 36 m radius, and 211.4 m from the
 * pump itself.
 *
 * ============================================================================
 * THE MEASURED POINTS, AT `mapSeed` 33 017 / `simSeed` 3 203
 * ============================================================================
 * Read off the same headless build `tests/campaign-maps.spec.ts` performs,
 * AFTER `spawnBuilding` snapped each footprint. The layout derives everything
 * from the start spots; the trigger table can see none of that and has to name
 * world points.
 *
 *     home    108, 380      foe  404, 132        seated slots [0, 1], len 386.161
 *     pump    316, 268      post 344, 252         D 32.249     staging 184, 208
 *     APPROACH 253, 317        ROAD 200, 192
 *
 * `ROAD` is where the relief column lands and it was SEARCHED, not chosen.
 * `EffectSink.spawnUnits` goes through `ProductionService.spawnUnit`, which
 * clamps to the map, reads `heightAt` and allocates — it calls no
 * `connectedGround`, so a drop point on a ridge is four Anvils standing on a
 * ridge, permanently. `runtime.spawnUnits` lays them on the exact ring angles
 * `i / count * 2pi` at `spread`, so for `count: 4, spread: 14` the five points
 * that must be standable are the centre and `(+-14, 0)`, `(0, +-14)`. All five
 * are dry, unoccupied and `Locomotor.Track`-passable at (200, 192), which is
 * 22.6 m from the staging post and 209.3 m from the player's opening.
 *
 * **RE-MEASURE IF EITHER SEED MOVES.** `D` is held inside its band by
 * `siteCount` in the layout; nothing else here is. Nothing fails loudly if the
 * rest drifts — `unitsInArea` simply stops firing, the hidden secondary never
 * reveals, and the operation is still winnable, so no test and no player
 * reports it.
 * ========================================================================== */

import { Faction } from '../../../core/types';
import { minutes, seconds } from '../../types';
import type { Condition, OperationDef } from '../../types';

/* -- the measured points -------------------------------------------------- */

/** The player's opening. `t.tide`'s column is pointed at it. */
const HOME = { x: 108, z: 380 };
/** 79.8 m short of the pump, on the road. See the zone block in the header. */
const APPROACH = { x: 253, z: 317 };
/** The pump itself, for the reveal. */
const PUMP = { x: 316, z: 268 };
/** Where the relief column forms up. Standable at the centre and all four ring points. */
const ROAD = { x: 200, z: 192 };

/* -- the thresholds ------------------------------------------------------- */

/**
 * How long the layout is given to have placed the seam before a zero threshold
 * over it is believed.
 *
 * **`ownerCount(1, 'building', 'tap', max: 0)` READS TRUE AGAINST AN EMPTY TAG
 * REGISTRY**, exactly as `entityDead` does — the spelling changed and the
 * hazard did not. Unguarded, `t.win` fires on the first tick the Director runs
 * and the player is handed a victory they did not play, which is the one
 * failure that reaches the end screen looking like a feature. `t.quiet` shares
 * the same object, so it would pay 400 credits for it as well.
 *
 * **IT IS DEFENCE AGAINST A LAYOUT THAT PLACED NOTHING, NOT AGAINST A TICK-ONE
 * READ THAT HAPPENS TODAY, AND SAYING WHICH MATTERS.** `scenarios.system.ts`
 * builds the world inside `async init()` and `SystemRegistry.init` awaits every
 * module's init in sequence before a tick is taken, so the registry is never
 * empty when the Director first runs and the empty read is unreachable in the
 * product. What IS reachable is a layout that stamped nothing — a wrong def
 * key, a footprint that will not fit, a roster that refused the structure — and
 * `tests/campaign-maps.spec.ts` and `tests/campaign-roster-ground.spec.ts` are
 * the gates that catch those two causes. This is the guard that stops the
 * symptom being instant.
 *
 * Twenty seconds is unmistakably past the build and unmistakably short of
 * anything happening. Measured on the built world, the pump is **221.7 m** from
 * the nearest player unit, and the fastest thing on the player's seat is a
 * 7.6 m/s Solarch — **152 m of straight line in twenty seconds** — against
 * 700 hp behind two Sentry Guns. `soviets.01.first-tap` and
 * `soviets.03.deep-sector` guard their own thresholds with the same constant.
 */
const SETTLE: Condition = { on: 'elapsed', ticks: seconds(20) };

/**
 * The Soviets no longer hold the pumping head — levelled or taken, and the
 * operation does not care which. See the header for why capture counts and for
 * why the reading post is deliberately NOT spelled this way.
 *
 * **DEFINED ONCE BECAUSE TWO TRIGGERS MUST AGREE ON IT.** `t.quiet` has to
 * resolve on the same tick as `t.win` or the medal loses a secondary that was
 * earned — `runDirector` returns early once an outcome is set, so a completion
 * that arrives one tick late arrives never. Two copies of one threshold are two
 * copies that will disagree the first time either is tuned; `soviets.01`'s
 * `TAP_TAKEN` is the same shape for the same reason.
 */
const TAP_OFF: Condition = {
  on: 'all',
  of: [SETTLE, { on: 'ownerCount', player: 1, role: 'building', tag: 'tap', max: 0 }],
};

/**
 * The Soviets no longer hold the staging post, and its exact complement.
 *
 * **THE SAME DEFECT AS THE PUMP'S, ONE OBJECTIVE DOWN, AND IT COST THE PLAYER
 * RATHER THAN THE MATCH.** `staging` is a `barracks` on seat 1 — capturable,
 * and worth capturing, because it is a real producer whose second infantry
 * queue is worth up to 35% on the one queue (`FACTORY_SPEED_BONUS`). Keyed on
 * `entityDead`/`entityAlive` it produced two wrong answers at once: the
 * 500-credit secondary did not complete for a post the Soviets had lost, and
 * `t.tide` still put four Anvil Tanks on the road at minute seven **off a
 * building the player owned**. The header prices this secondary by what it
 * DENIES the Soviets — the second queue and the 3600 credits of armour — and
 * capture denies both, so `entityDead` was under-counting its own stated rule.
 *
 * **DEFINED AS A PAIR BECAUSE THEY MUST PARTITION.** `max: 0` and `min: 1` over
 * one count leave no world state in which the column arrives AND the secondary
 * completes, or in which neither happens. `soviets.03.deep-sector`'s
 * `MASTS_OFF`/`MASTS_HELD` is the same shape for the same reason.
 *
 * `STAGING_OFF` carries `SETTLE` because it PAYS. `STAGING_HELD` does not need
 * it — `min: 1` reads FALSE against an empty registry, which withholds a
 * scripted wave rather than granting a reward, and it is conjoined with a
 * seven-minute `elapsed` in the only trigger that reads it.
 */
const STAGING_OFF: Condition = {
  on: 'all',
  of: [SETTLE, { on: 'ownerCount', player: 1, role: 'building', tag: 'staging', max: 0 }],
};
const STAGING_HELD: Condition = {
  on: 'ownerCount', player: 1, role: 'building', tag: 'staging', min: 1,
};

const op: OperationDef = {
  id: 'pact.02.long-count',
  chapter: 'pact',
  faction: Faction.Meridian,
  /*
   * THE SOVIETS, AND THE LINE THAT DECIDES IT IS THE FIRST ONE CALVANE SPEAKS:
   * *"They sank a pump on our crust eleven days ago and it is running."*
   *
   * Sinking taps is the Soviet habit this campaign opens on —
   * `soviets.01.first-tap` is literally "The March surfaces in a new place.
   * Sink the first tap", and `docs/campaign/CAMPAIGN_BUILD_SPEC.md` §2.1 divides the
   * Continental Works at the Split with "the Soviets took the yards and the
   * plate mills". A working extraction rig with a barracks staging post behind
   * it is the Soviet half on the nose, and it is the opposite number to P1's
   * Allied INSTRUMENT — the Allies read this ground, the Soviets work it.
   *
   * MECHANICALLY IT PINS TWO THINGS. `t.tide` spawns `rhino` — the Anvil Tank,
   * an authored Soviet hull, literal and unremapped, which `validateCampaign`
   * checks against the seat's declared army. And the layout's `pillbox`
   * resolves through `keyFor` to the SENTRY GUN, whose `pillboxMg` carries no
   * splash and no power draw; on a Meridian seat the same key becomes a Glaive
   * Post, which carries `needsPower`, and on a Reclamation seat a Spitpost.
   * The splash audit above is written against the Soviet column of that table.
   */
  foe: Faction.Soviets,
  index: 2,
  title: 'The Long Count',
  beat: 'A Soviet pump on the seam, and thirty-two metres behind it four hundred years of readings.',
  primaryType: 'assassination',
  // Multiple effect kinds — objective state, a reveal, a wave and an order — so
  // 'bespoke' by the definition in `types.ts`. The label is about MECHANISM:
  // what makes this operation what it is is 32.249 m of ground, and that ground
  // is built before tick one.
  archetype: 'bespoke',
  parSec: 840,
  requires: ['pact.01.shallow-road'],

  map: {
    preset: 'temperate',
    // Fixed, and pinned by `tests/campaign-maps.spec.ts` as a terrain
    // fingerprint. CHOSEN BY SURVEY: ten roll pairs were built headless and
    // read for the gap the post actually landed at, for a relief drop whose
    // whole spawn ring is standable, and for how nearly the post sits behind
    // the pump. This roll gives the smallest across-axis offset of the ten
    // (4.47 m of 32.249) with a clean drop 4 m off nominal.
    mapSeed: 33_017,
    // The PAIR is chosen by this seed and not by the map roll. `seatedSlots`
    // filters `START_PAIRS` against the water, and with no sea all four
    // survive; this one draws [0, 1] — the diagonal, 386.161 m after
    // `nudgeToBuildable` — which is the pair with room for a compound two
    // thirds of the way across and a staging post 74 m off the axis.
    simSeed: 3_203,
    armies: 2,
    biome: 'temperate',
    opening: 'base',
    /*
     * BOTH SEATS. `Shell.applySimPostBoot` writes `setup.startingCredits`
     * into every non-Neutral slot, so this is one number doing two jobs.
     *
     * It buys the player six Solarchs with change, which is the force the
     * standoff arithmetic above is written about — and it slows the Soviet
     * opening for the reason CLAUDE.md's measured block gives: a brain with a
     * 10 000 bank raises a seven-building base and eleven troops before it has
     * mined a single ore. 5 000 is also `MCV_MIN_CREDITS`, the documented
     * floor for reaching a refinery, so it is the bottom of the band rather
     * than a midpoint.
     */
    credits: 5_000,
  },
  layout: 'pact-long-count',

  /*
   * NEITHER SHIPPED RULE MAY END THIS.
   *
   * `annihilationWin` would hand the player a victory for flattening the
   * Soviet base while the pump, which stands 162.0 m from the Soviet opening
   * and 119.4 m from the nearest structure that opening raises, went
   * untouched — and worse, it would hand them one for a match in which the
   * reading post had already been levelled, since `Viability` counts assets
   * and knows nothing about which building this operation is named after.
   * `assetLossDefeat` is off for symmetry: the player opens with a full base
   * and could not plausibly hit zero assets before `t.lose` reads, but a rule
   * that can only end a scripted match by accident should not be armed.
   */
  outcome: { annihilationWin: false, assetLossDefeat: false, ignoreSeats: [] },

  /*
   * EMPTY ON BOTH SIDES, AND THE REASON IS THE ARITHMETIC RATHER THAN TASTE.
   *
   * Every number in this header is a function of a weapon's RANGE, so the
   * roster is what pins the table. Day-one Meridian reaches 26 m at most —
   * `mrdSkiff` is `unit.raider`, `mrdZenith` is `unit.specialist`, `mrdKestrel`
   * is `unit.air` and `mrdHierarch` is `unit.commander`, so all four are
   * refused and the two locked rows in the table above are quoted only to show
   * the invariant survives them.
   *
   * It survives them because the near-side clause is range-independent: the
   * `0.80R` cancels. Granting `unit.specialist` would widen the Zenith's
   * envelope to 44.40 and make the OVERRUN bite harder, not softer. Nothing
   * here is protected by the roster; the roster is here so that the table
   * printed above is the table that ships.
   *
   * `roster.ai` is empty for the splash audit's sake — `flameTower` (3.2 m)
   * and `teslaCoil` are both `struct.defence.specialist`, and a 3.2 m blast
   * inside a Soviet base is not a risk to a structure 94 m away, but a rule
   * that says "the only army that can break the post is yours" should be true
   * by construction rather than by distance.
   */
  roster: { player: [], ai: [] },

  /*
   * THE READING POST CANNOT BE WALKED INTO. See the header block on `count`,
   * which used to end "documented, not closed" and no longer does.
   *
   * `tap` and `staging` stay capturable and must: both are `ownerCount`
   * thresholds, so an Artificer satisfies them exactly as a shell does, and the
   * two objective titles say "take … off them" because of it. This list is one
   * tag on purpose — a blanket `'all'` here would take the primary's own second
   * route away.
   */
  captureProof: ['count'],

  objectives: [
    // "TAKE … OFF THEM", NOT "DESTROY". `t.win` counts what seat 1 still owns,
    // so walking an Artificer into the pump ends the operation exactly as
    // levelling it does, and a title that said "destroy" would be naming the
    // one route the rule does not require. See the header.
    { id: 'tap', kind: 'primary', title: 'Take the Soviet pumping head off them' },
    // UNCHANGED, AND IT IS THE ONE TITLE IN THIS FILE THAT MUST NOT MOVE.
    // `t.countLost` still reads `entityDead`, deliberately — "standing" is
    // exactly what it tests, and a post the player has CAPTURED is standing and
    // still satisfies this. What that USED to leave open — a captured post is a
    // legal Soviet target 134.2 m from their opening — is closed by
    // `captureProof: ['count']` above rather than by a trigger, because no
    // trigger can refuse a capture. See the block on `count` in the header.
    { id: 'count', kind: 'primary', title: 'Leave the reading post standing' },
    {
      id: 'staging',
      kind: 'secondary',
      // "TAKE … OFF THEM", NOT "LEVEL". `t.staging` counts what seat 1 still
      // owns, so an Artificer answers this exactly as a shell does — and the
      // header prices the objective by what it denies the Soviets, which
      // capture denies more completely than demolition. See `STAGING_OFF`.
      title: 'Take the Soviet staging post off them',
      credits: 500,
    },
    {
      id: 'quiet',
      kind: 'secondary',
      hidden: true,
      title: 'Take the pump without marking the reading post',
      credits: 400,
    },
  ],

  triggers: [
    /* -- the opening word -------------------------------------------------
     * Two lines: the job, then the constraint. A player who reads only the
     * first still knows what to take; a player who reads only the second
     * still knows what to leave. Calvane states the reason out loud because it
     * is the chapter's argument and an operation that hides its own mechanism
     * is a quiz.
     */
    {
      id: 't.open',
      when: { on: 'elapsed', ticks: seconds(4) },
      then: [
        {
          // "Take it off them" rather than "Take the head off it": `t.win`
          // counts deeds, so breaking the pump and walking into it are one
          // order, and the sentence has to be the one that covers both.
          do: 'dialogue',
          speaker: 'Calvane',
          text: 'Survey 33-017. They sank a pump on our crust eleven days ago and it is '
            + 'running. Take it off them.',
        },
        {
          do: 'dialogue',
          speaker: 'Calvane',
          text: 'Thirty-two metres behind that pump there is a reading post. It has counted '
            + 'this seam for four hundred years. It is the only thing that lets anyone be '
            + 'told what a cut does — break it and we lose the argument, not the ground.',
        },
      ],
    },

    /* -- the seam, seen ---------------------------------------------------
     * THE TEACHING TRIGGER, AND ARRIVING IS WHAT FIRES IT. The disc's centre
     * sits 79.81 m short of the pump and its near edge 43.81 m short, so the
     * player is told before anything can FIRE on him: the nearer Sentry Gun is
     * 26.4 m past that edge and the nearest Conscript 25.2 m past it, against
     * firing envelopes of 24.79 m and 19.79 m of centre distance for a Solarch
     * (`range + hitRadius(target)`, because `Combat.engage` gates on surface —
     * comparing 26.4 against the bare 22 is the radius-omission this file
     * catches P1 for, and the zone block in the header now carries the full
     * arithmetic). Both distances are measured rather than derived.
     *
     * AN UNTAGGED `unitsInArea` IS THE EXPENSIVE SPELLING and it is the right
     * one: the question is whether ANY player unit has come up the road, and
     * tagging would mean naming in advance which of them counted. It walks
     * `store.alive` twice a tick — the arming pass and the real pass — until it
     * fires, and `state.fired` then retires it for the rest of the match.
     *
     * **THE FIVE-MINUTE CEILING IS NOT BELT AND BRACES.** A player who swings
     * wide enough to miss a 36 m disc still meets the compound, and `quiet` is
     * a HIDDEN objective — it is filtered out of the briefing by
     * `briefingObjectives`, so if nothing reveals it the player is judged
     * against a rule they were never shown. `pact-shallow-road` needed the same
     * ceiling for the same shape of reason.
     */
    {
      id: 't.see',
      when: {
        on: 'any',
        of: [
          { on: 'unitsInArea', player: 0, area: { x: APPROACH.x, z: APPROACH.z, r: 36 }, min: 1 },
          { on: 'elapsed', ticks: minutes(5) },
        ],
      },
      then: [
        { do: 'revealArea', player: 0, area: { x: PUMP.x, z: PUMP.z, r: 70 } },
        {
          do: 'dialogue',
          speaker: 'Nael',
          text: 'There it is. Pump on the near face, two guns in front of it, and the post '
            + 'thirty-two metres behind. They are standing on four hundred years of readings '
            + 'and they do not know what it is.',
        },
        {
          do: 'dialogue',
          speaker: 'Nael',
          text: 'Stop where the gun stops. Fourteen metres closer than that and the post is '
            + 'inside the same circle — your gunners will not ask. And do not come at it from '
            + 'their side; from behind, the post is the first thing in reach.',
        },
        { do: 'setObjective', id: 'quiet' },
      ],
    },

    /* -- the post, marked -------------------------------------------------
     * `frac: 1` is ANY DAMAGE AT ALL — `Director.holds` reads
     * `weakestHpFrac >= 0 && f < frac`, and a structure at full health is
     * exactly 1.0 because `spawnBuilding` writes `hp = maxHp * 1`.
     *
     * NEITHER THIS NOR `t.hurt` CARRIES AN `eva` LINE. The announcer's
     * vocabulary is 33 fixed ids and not one of them means "you are shooting
     * the wrong building": `structureLost` is false until it is (and `t.countLost`
     * spends it then), and `baseUnderAttack` names a base that is not the
     * player's and is not under attack by anyone but the player. A dialogue
     * line is the honest instrument, and `validateCampaign` would happily have
     * passed either lie.
     *
     * It carries no reveal guard, and the reason it does not need one is
     * geometric: to put a round into the post at all you must be inside 26 m of
     * it, which is inside 58 m of the pump, and every route from the player's
     * opening to there crosses `t.see`'s disc first. `t.see` also sits above
     * this trigger, so on a tick where both hold the reveal is written first.
     */
    {
      id: 't.graze',
      when: { on: 'entityHpBelow', tag: 'count', frac: 1 },
      then: [
        {
          do: 'dialogue',
          speaker: 'Nael',
          text: 'We are marking the post. Four hundred years of it, and the holes are ours.',
        },
        { do: 'failObjective', id: 'quiet' },
      ],
    },
    {
      id: 't.hurt',
      when: { on: 'entityHpBelow', tag: 'count', frac: 0.5 },
      then: [
        {
          do: 'dialogue',
          speaker: 'Calvane',
          text: 'Half of it is gone. Pull off the lot and finish the pump from the road. '
            + 'Whatever is left of that count is worth more than the hour it costs you.',
        },
      ],
    },

    /* -- the staging post --------------------------------------------------
     * `STAGING_OFF`, the exact complement of `t.tide`'s `STAGING_HELD`. See the
     * constants: a captured barracks is a barracks the Soviets have lost, and
     * this objective is priced by what it denies them.
     */
    {
      id: 't.staging',
      when: STAGING_OFF,
      then: [
        {
          // "off them" rather than "flat", because a post an Artificer walked
          // into is not flat — it is turning out Conscripts for you. The second
          // sentence is the objective's real rule and is true either way.
          do: 'dialogue',
          speaker: 'Nael',
          text: 'Staging post is off them. Nothing forms up on that road now.',
        },
        { do: 'completeObjective', id: 'staging' },
      ],
    },

    /* -- the road column --------------------------------------------------
     * Seven minutes, and gated on the Soviets STILL HOLDING the staging post —
     * which is what gives the secondary teeth beyond five hundred credits. It
     * comes off the post and attack-moves the player's opening, so a player who
     * has committed everything to the seam has to decide whether to come back.
     *
     * **`STAGING_HELD`, NOT `entityAlive`.** A captured post is alive, so the
     * old spelling put four Anvils on the road off a building the player owned
     * — punishing them for the exact play the secondary above rewards.
     *
     * `rhino` is the Anvil Tank, literal and unremapped: `EffectSink.spawnUnits`
     * resolves through `ProductionCatalog.byKey` with no `keyFor`, so an
     * authored key means THAT hull and `validateCampaign` checks it against
     * `foe`. `spread` is a deterministic ring drawn by index rather than by
     * `s.rng` — the same wave has to land in the same shape in the recording,
     * in the playback and in a designer's third run.
     */
    {
      id: 't.tide',
      when: {
        on: 'all',
        of: [
          { on: 'elapsed', ticks: minutes(7) },
          STAGING_HELD,
        ],
      },
      then: [
        { do: 'eva', line: 'forcesUnderAttack' },
        {
          do: 'dialogue',
          speaker: 'Nael',
          text: 'Four hulls off the staging post. They are not coming to the seam — they are '
            + 'going for the yard.',
        },
        {
          do: 'spawnUnits',
          player: 1,
          key: 'rhino',
          count: 4,
          at: ROAD,
          spread: 14,
          tag: 'column',
        },
        { do: 'orderTagged', tag: 'column', order: 'attackMove', at: HOME },
      ],
    },

    /* -- the secondaries, resolved before the win -------------------------
     * BOTH OF THESE SIT ABOVE `t.win` AND THAT IS LOAD-BEARING. `runDirector`
     * returns immediately once an outcome is set, so a completion written below
     * the win trigger never fires and the medal never counts it.
     *
     * `t.quiet` carries TWO guards and they cover different failures.
     * `entityAlive` is the one that matters if the post died on the same tick
     * the pump did — `entityDead: 'count'` and this would otherwise both hold.
     * The `not entityHpBelow` is the one that matters if the SOVIET AI repaired
     * a grazed post back to full: `AiBrain.repairBase` really does that, and
     * without this clause a player who had already been told they marked it
     * would silently be paid for it. Belt and braces are both needed, and
     * `Session.setObjective`'s refusal to un-resolve is a third layer under
     * them rather than a substitute.
     */
    {
      id: 't.quiet',
      when: {
        on: 'all',
        of: [
          // `TAP_OFF`, THE SAME OBJECT `t.win` READS. Two spellings of one
          // threshold are two spellings that drift, and the drift here is a
          // paid secondary resolving one tick after the operation has already
          // ended — i.e. never. The pump's two fates are one condition now;
          // the post's two are still the pair below, deliberately.
          TAP_OFF,
          { on: 'entityAlive', tag: 'count' },
          { on: 'not', of: { on: 'entityHpBelow', tag: 'count', frac: 1 } },
        ],
      },
      then: [
        {
          do: 'dialogue',
          speaker: 'Nael',
          text: 'Not a mark on it. The count runs on.',
        },
        { do: 'completeObjective', id: 'quiet' },
      ],
    },

    /* -- the loss that is the operation -----------------------------------
     * ABOVE `t.win`, so a tick on which the pump and the post both die reads as
     * a loss. That is the right answer and it is the only one the file's own
     * ordering can express: `runDirector` walks the triggers in declared order
     * and `Session.end` refuses a second outcome.
     *
     * **IT KEEPS `entityDead` WHILE `t.win` MOVED TO `ownerCount`, AND THE
     * ASYMMETRY IS THE POINT.** The pump's threshold had to migrate because
     * capture made a WIN unreachable; migrating this one would make a LOSS
     * reachable by capture — the operation would end in defeat on the tick a
     * player walked an engineer into the very thing it told them to protect.
     * The objective says "standing", this tests standing, and a captured post
     * is standing. What capture really cost here is documented at length in
     * the header (`count` IS NOT MIGRATED): it stripped the post's only
     * protection, because `isValidTarget` refuses an allied target and nothing
     * else, and this trigger does not care who fires.
     *
     * **THAT IS CLOSED, AND THIS COMMENT USED TO END "Closing that needs a
     * `CaptureService.addVeto` installer that does not exist."** It exists:
     * `OperationDef.captureProof`, set to `['count']` on this operation, which
     * puts exactly that veto in front of `resolve()` for the duration. So this
     * trigger keeps `entityDead` — which is still the right question — and the
     * one route to it that no shell had fired is now refused before the walk.
     */
    {
      id: 't.countLost',
      when: { on: 'entityDead', tag: 'count' },
      then: [
        { do: 'eva', line: 'structureLost' },
        { do: 'failObjective', id: 'count' },
        {
          do: 'dialogue',
          speaker: 'Calvane',
          text: 'Four hundred years, and the last entry is ours. Note the hour. We came here '
            + 'to stop a cut and we made one.',
        },
        { do: 'endOperation', result: 'loss', reason: 'count' },
      ],
    },

    /* -- the win ----------------------------------------------------------
     * `TAP_OFF`, WHICH COUNTS DEEDS AND NOT CORPSES. This was
     * `entityDead 'tap'`, and a captured pump is alive — so an Artificer put
     * into the structure this operation is named after made the only win
     * condition in the table false forever, with `annihilationWin` off, on a
     * key `Scenarios.civilian()` strips `EntityFlag.Sellable` from so there was
     * no way to undo it. See the header block.
     *
     * `SETTLE` lives inside `TAP_OFF` rather than being conjoined here, so the
     * threshold and its guard travel together to `t.quiet` as one object.
     */
    {
      id: 't.win',
      when: TAP_OFF,
      then: [
        { do: 'completeObjective', id: 'tap' },
        { do: 'completeObjective', id: 'count' },
        {
          // "off them" rather than "down": a pump an Artificer walked into is
          // very much still running, and under new management. The second
          // sentence is the operation's whole argument and is true either way.
          do: 'dialogue',
          speaker: 'Calvane',
          text: 'Pump is off them, post standing. Log the depth against the count and send '
            + 'both to the Reliquary. One day somebody will ask us to prove this, and now '
            + 'we can.',
        },
        { do: 'endOperation', result: 'win' },
      ],
    },

    /* -- the other loss ---------------------------------------------------
     * `playerBeaten` is `Viability.isBeaten` — nothing to build with and
     * nothing to fight with — not "you have no buildings". The player opens
     * with a full base here, so the two readings agree for most of the match;
     * they stop agreeing at exactly the moment it matters, which is a player
     * down to one Chapterhouse and six Wayfarers who can still finish this.
     */
    {
      id: 't.lose',
      when: { on: 'playerBeaten', player: 0 },
      then: [{ do: 'endOperation', result: 'loss', reason: 'tap' }],
    },
  ],
};

export default op;
