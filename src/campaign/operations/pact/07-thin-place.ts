/**
 * ============================================================================
 * P7 — THE THIN PLACE
 * ============================================================================
 * P6 ended the argument. The count was presented, the Works sat on the crust
 * and read it themselves, and the price of being believed was the crust: the
 * Conclave signed the ground away so that the number would belong to somebody
 * who is not the Order. It worked. Every yard on this coast now knows the depth
 * at which Pact crust stops being crust, which is also the depth at which a cut
 * works best.
 *
 * **THIS IS THE FIRST OPERATION IN THE CHAPTER WHERE THE PACT IS NOT ARGUING.**
 * The argument is over and it was won. What arrived four days later is the
 * Ninth, with an allocation, lawfully, to sink two heads over the thinnest
 * crust on the coast — which is the ground the count was taken from, which is
 * the ground eleven families have been taking it on, one entry a day, for four
 * hundred years. Nobody asked them. Nobody had to: the concession made the
 * crust common, and common ground has no tenants.
 *
 * The Pact cannot take the parcel back. Taking it back is the one move that
 * unmakes the concession, and the concession is the only reason the count is
 * true for anybody outside the Order. So what is left is to stop the cut
 * without setting foot on the ground.
 *
 * **THIS SENTENCE USED TO END "which in this engine is one instrument and no
 * other", AND IT WAS FALSE THREE WAYS OVER.** There are four ways to reach that
 * parcel without failing the concession — a mirror, a Glaive Post belt off a
 * yard on the rim, a raid that goes in and comes out inside the ten-second
 * grace, and a Pharos plus an Airstrike that never approaches the ground at all.
 * All four are priced in the parcel block below. What is TRUE, and is narrower
 * and better than the claim it replaces, is that exactly one of them cannot be
 * answered by the Ninth's own wrench: **the Solar Lance puts 1 120 on a 700 hp
 * collar IN ONE INSTANT**, and every other route is a RATE — which is the one
 * thing 30 hp/s of `REPAIR_RATE` knows how to beat. The mirror announces itself
 * before it burns and does not care what is standing underneath; that is the
 * price of being the only instrument the Ninth cannot mend its way out of.
 *
 * ============================================================================
 * WHY `primaryType: 'superweapon'`, AND HOW IT DIFFERS FROM S6
 * ============================================================================
 * `soviets.06.demolition-order` is the other one and its test is the right one
 * to apply: *"The shape of the primary is 'level three enemy buildings', which
 * on its own is an assault. What makes it a superweapon operation is that BOTH
 * of the numbers deciding it are superweapon numbers."* Both of the numbers
 * deciding this one are `SUPERWEAPONS[SuperweaponId.SolarLance]`'s, and neither
 * is authored here:
 *
 *   - **`chargeSeconds` is 420 and the notice is 1 140, so the operation holds
 *     exactly TWO turns of the mirror against exactly TWO heads.** A Heliograph
 *     queued at five seconds finishes at 0:39 (`buildTime` 32 plus
 *     `CONSTRUCTION_RISE_SECONDS` 2.0), is READY at **7:39** and burns at
 *     **7:42**; ready again at **14:39** and burns at **14:43**. A third turn
 *     would land at 21:43, past the close. So the second charge is committed
 *     before the fourth column is on the board, and every minute of the second
 *     half asks the player to spend it anyway. **The three seconds between
 *     ready and burnt are `SUPERWEAPON_FX.nukeWarnSeconds` and they are part of
 *     the deadline** — see THE PAR IS THE NOTICE below, which is where the
 *     round trip is stated exactly and where an earlier draft of this file was
 *     four seconds wrong in the losing direction.
 *   - **`radius` is 24 and the hamlet is inside it.** The two heads stand
 *     40.00 m apart with three occupied buildings between them at 18.87 to
 *     28.00 m, so the blast that kills a head reaches the people the operation
 *     is about. The table below is that arithmetic and it is the whole of the
 *     second decision.
 *
 * **AND IT INVERTS S6 RATHER THAN REPEATING IT.** S6 authors its works so that
 * no two of its three targets fit inside one blast — 49.82 m of surface against
 * a 26 m radius — and its decision is WHICH of three the ground has to take,
 * because two warheads do not cover three buildings. Here the count is two and
 * two: nothing is left over, the button is not the cheap answer among several,
 * and what the radius decides is not which target but WHERE INSIDE the target
 * to put the blast. S6's own honesty applies unchanged and is restated below:
 * nobody is required to build the mirror, the ground routes are priced, and
 * this file does not claim the button is compulsory.
 *
 * Every number below is derived from the shipped `SUPERWEAPONS`,
 * `SUPERWEAPON_FX`, `Damage.applySplash`, `ARMOR_MATRIX`, `COMBAT_DAMAGE`,
 * `DEFAULT_WEAPONS`/`MERIDIAN_WEAPONS` and `Targeting`, or read off a headless
 * build at this operation's seeds with the def tables BOUND and the roster
 * INSTALLED. **RE-DERIVE, DO NOT RE-QUOTE**, after any retune.
 *
 * ============================================================================
 * ONE CHARGE, IN NUMBERS
 * ============================================================================
 * `SuperweaponService.detonateNuke` pushes ONE splash record —
 * `SUPERWEAPON_FX.nukeDamage` 1400, `WarheadClass.HighExplosive`, radius
 * `def.radius` (24 for the Lance, not the missile's 26), falloff
 * `SUPERWEAPON_FX.nukeSplashFalloff` 0.22 — and `Damage.applySplash` resolves it
 * as
 *
 *     surface  = max(0, centreDistance - hitRadius(fw, fh, radius))
 *     t        = 1 - surface / 24                       (nothing past 24)
 *     falloff  = 0.22 + 0.78 * t ^ COMBAT_DAMAGE.splashExponent   (1.6)
 *     damage   = 1400 * falloff * ARMOR_MATRIX[HighExplosive][armor] * 0.80
 *
 * **THE ATTACKER IS `NONE`, SO THERE IS NO FRIENDLY-FIRE HALVING.** Every other
 * blast in the game is attributed, and `applySplash` halves an allied victim by
 * `COMBAT_DAMAGE.friendlyFireMul` 0.5. `detonateNuke` passes `NONE`, `st.index`
 * answers -1, `attackerPlayer` stays -1, and the halving branch is never taken.
 * The Lance is therefore the ONLY thing in this match that hits a Gaia building
 * at full effect, which is the section after next.
 *
 * A cutting head is a `civOreMine`: **700 hp, `ArmorClass.Concrete`, 2x2**, so
 * `ARMOR_MATRIX[HighExplosive][Concrete]` is 1.00 and `hitRadius(2, 2, …)` is
 * `hypot(4, 4)` = 5.6569. Against it:
 *
 *     blast placed        damage    head
 *     on the collar       1 120.0   dies with 60% to spare
 *     8 m off              987.6    dies
 *     10 m off             881.1    dies with 26% to spare   <- the shipped advice
 *     12 m off             781.0    dies
 *     13.72 m off          700.2    dies by two tenths of a hit point
 *     13.73 m off          --       LIVES
 *
 * **DRIVEN, NOT ONLY DERIVED.** Bisected against the real `DamageSystem` on the
 * built ground — the record pushed onto `channels.damage` and `damageTick`
 * resolving it — a collar dies out to **13.7257 m** and lives past it. The 40 m
 * of head separation in `pact-thin-place.ts` is bounded by twice that number and
 * the layout says so from its side.
 *
 * **AND `nukeSplashFalloff` 0.22 IS A FLOOR RATHER THAN A TAPER, WHICH IS THE
 * SINGLE MOST IMPORTANT FACT IN THIS FILE.** `t` clamps to zero past 24 m of
 * SURFACE distance, so the falloff term never falls below 0.22 anywhere inside
 * the ring: the least a Concrete victim in the blast can take is
 * `1400 * 0.22 * 1.00 * 0.80` = **246.40**, and one centimetre further out it
 * takes **zero**. There is no gradient at the edge; it is a cliff. Every aim-off
 * number in the hamlet section below is a consequence of that one sentence, and
 * so is the threshold on `t.singed`.
 *
 * ============================================================================
 * THE HAMLET, AND THE ONLY THING IN THE MATCH THAT CAN TOUCH IT
 * ============================================================================
 * Three Gaia buildings stand between the two heads, and they are the answer to
 * *what does the Pact owe them*: nothing the Pact can give them is the ground,
 * so what is left is not to kill them on the way past.
 *
 *     placed        def              hp     footprint  hitRadius   to head A / B
 *     terrace       civApartments     800     2x3        7.2111     21.26 / 18.87
 *     well          civOilDerrick     900     2x2        5.6569     28.00 / 24.33
 *     infirmary     civHospital     1 100     3x2        7.2111     24.74 / 26.00
 *
 * **NOTHING ON THE BOARD CAN AIM AT THEM AT ALL, AND ONE THING CAN HIT THEM.**
 * `ScenarioBuilder.gaia` sets both directions of `allyMask`, so
 * `Targeting.isValidTarget` — which refuses ALLIES — hands no gun in the match a
 * Gaia building as a target: not the Ninth's, not the player's, not a Sentry Gun
 * acquiring on its own. Nothing in this operation will ever choose to shoot a
 * house. What is left is SPLASH, and it is three facts and TWO priced residuals
 * — the second of them added when the Pharos route below was found:
 *
 *   - **The Ninth's own rounds do not land there.** Its only splash row is
 *     `heavyCannon` at `splashRadius` 2.1, so a shell must land within
 *     `2.1 + hitRadius` — 9.31 m of the terrace's centre — and there is nothing
 *     inside the parcel for a Soviet gun to be shooting at. `conscriptRifle`
 *     carries no splash at all.
 *   - **Even if one did, it is halved.** `applySplash` scales an allied victim by
 *     `COMBAT_DAMAGE.friendlyFireMul` 0.5, and the Ninth IS allied to Gaia.
 *   - **The Lance is NOT halved**, for the reason in the section above: its
 *     record carries `attacker: NONE`, so `attackerPlayer` is -1 and the branch
 *     is never taken. It lands at full effect.
 *   - **AND THE PLAYER'S OWN GUNS ARE A RESIDUAL RATHER THAN A ZERO, BECAUSE THE
 *     PARCEL IS A BONUS AND NOT A WALL.** A commander who raids the parcel fires
 *     inside it, and `focusLance` carries `splashRadius` 1.4 — so a shell landing
 *     within 8.61 m of the terrace's centre delivers
 *     `60 * ARMOR_MATRIX[ArmorPiercing][Concrete] 0.55 * 0.80 * 0.5` = **13.2 a
 *     round**, i.e. sixty-one rounds for the terrace. It is reachable only by
 *     fighting inside the hamlet itself, which is not where a raid stops: an
 *     attack order parks a Solarch 26.457 m from the collar it is shooting, which
 *     on the near bearing is 47 m from the terrace and forty metres outside its
 *     own splash. Stated rather than claimed away.
 *   - **AND AN AIRSTRIKE REACHES THE ROOFS, HALVED.** `applyAirstrike` pushes a
 *     20 m record with `attacker` = an entity the CALLER owns, so unlike the
 *     Lance it IS halved against Gaia. Centred on head A the terrace is at
 *     21.26 m, i.e. 14.0492 m of surface inside a 20 m radius:
 *     `260 * (0.3 + 0.7 * (1 - 14.0492/20)^1.6) * 1.00 * 0.80 * 0.5` = **41.67 a
 *     call**. The bound worth stating is the WORST case rather than that one:
 *     a call centred on the terrace itself delivers `260 * 1.00 * 0.80 * 0.5` =
 *     **104.0**, and **all seven calls the notice allows, every one placed
 *     directly on the roofs, total 728 of 800 and the terrace lives.** So the
 *     Airstrike cannot end this operation from either end — not the collars and
 *     not the hamlet — which is worth knowing rather than assuming, because the
 *     Pharos route is real and this file missed both halves of it.
 *
 * So the thing that kills a house here is **the Solar Lance**, and the arithmetic
 * of that is the next table.
 *
 * That is what the primary is for, and this is what it costs:
 *
 *                      blast on head A   on head B   BOTH CENTRED    outcome
 *     terrace   800          460.0         547.9      1 007.9        DIES
 *     well      900          258.5         325.0        583.5        lives, 35%
 *     infirmary 1 100        353.7         322.3        676.0        lives, 38%
 *
 * **THIS BLOCK USED TO CLAIM THE OPERATION WAS "LOST BY DOING THE OBVIOUS THING
 * TWICE, AND ONLY TWICE". IT IS MEASURABLY FALSE.** Driven against the real
 * `DamageSystem` on the built ground — the record pushed onto `channels.damage`
 * and `damageTick` resolving it, hp read off the store either side — **eleven of
 * sixty-four sampled aim pairs kill the terrace.** Rows are metres out on head
 * A, columns metres out on head B, each on its own bearing away from the
 * terrace; the figure is the terrace's TOTAL bill against its 800, `*` means it
 * dies, and every cell in the table kills its own head:
 *
 *               B@0     B@2     B@4     B@6     B@8    B@10    B@12  B@13.5
 *     A@0    1007.9* 933.6*  867.5*  810.3*   763.1   727.5   707.4   460.0
 *     A@2     943.4*  869.2*  803.1*  745.9    698.6   663.1   642.9   395.6
 *     A@4     888.1*  813.8*  747.7   690.5    643.3   607.7   587.6   340.2
 *     A@6     843.0*  768.7   702.6   645.4    598.2   562.6   542.5   295.1
 *     A@8     810.0*  735.8   669.7   612.5    565.2   529.7   509.5   262.2
 *     A@10    547.9   473.6   407.5   350.3    303.1   267.5   247.4     0.0
 *     A@12    547.9   473.6   407.5   350.3    303.1   267.5   247.4     0.0
 *     A@13.5  547.9   473.6   407.5   350.3    303.1   267.5   247.4     0.0
 *
 * Bisected on the same rig, the lethal set is exactly: **head B centred and head
 * A inside 8.915 m; head A centred and head B inside 6.400 m; or both blasts
 * inside 3.102 m of their own collars.** Three of those cells use an offset this
 * file used to call safe.
 *
 * **AND IT IS ORDER-DEPENDENT, WHICH IS WHAT MADE THE FAIRNESS CLAIM WRONG
 * RATHER THAN MERELY INCOMPLETE.** `t.singed` reads `entityHpBelow`, i.e. the
 * WEAKEST of the tagged set, so all it can ever see is the state after ONE
 * blast. At the shipped threshold of 0.5 the four openings A@4, A@6, A@8 and
 * B@6 — each followed by the other collar CENTRED — reach the instant defeat
 * with no warning BEFOREHAND, because a first blast at those offsets leaves the
 * terrace at 0.5747 / 0.6311 / 0.6723 / 0.5621. Fire the same two shots in the
 * other order and the warning does fire. A discipline that depends on which
 * collar the player happened to take first is a coin, not a rule.
 *
 * **DRIVEN THROUGH THE REAL `runDirector`, BEFORE AND AFTER**, with the world
 * facts taken from the real `DamageSystem` runs above and the timed beats
 * pre-fired. `[frac]` is the terrace after that shot; the list is what the
 * Director appended:
 *
 *     BEFORE                shot one                shot two
 *     A@8 then B@0    [0.6723]  --            done:heads, Calvane, loss
 *     A@6 then B@0    [0.6311]  --            Hesk, done:heads, Calvane, loss
 *     B@6 then A@0    [0.5621]  --            Hesk, done:heads, Calvane, loss
 *     B@0 then A@0    [0.3152]  Hesk          done:heads, Calvane, loss
 *     A@10 then B@10  [1.0000]  --            done:heads, Calvane
 *
 *     AFTER
 *     A@8 then B@0    [0.6723]  Hesk          loss
 *     A@6 then B@0    [0.6311]  Hesk          loss
 *     B@6 then A@0    [0.5621]  Hesk          loss
 *     B@0 then A@0    [0.3152]  Hesk          loss
 *     A@10 then B@10  [1.0000]  --            done:heads, Calvane
 *     A@10 then B@13  [1.0000]  --            done:heads, Calvane
 *
 * Three things move. The warning arrives on shot ONE in every fatal ordering
 * rather than not at all or on the death tick itself; the defeat tick no longer
 * carries `completeObjective('heads')` and Calvane's *"Both collars are glass"*
 * ahead of *"you put it on the roofs"*; and the correct two-shot line is silent
 * exactly as it was before. **`B@10 then A@10` is the one new line**: it fires
 * the warning on shot one, at 0.6656, which is honest — a third of the terrace
 * is gone and a turn remains — and is why the copy no longer predicts what the
 * second shot will do.
 *
 * **THE FIX IS THE RIM FLOOR, WHICH MAKES THE NEW THRESHOLD DERIVED RATHER THAN
 * CHOSEN.** Because 0.22 is a floor rather than a taper, ANY blast that touches
 * the terrace takes at least 246.40 off it and leaves it at at most
 * `(800 - 246.40) / 800` = **0.6920**; a blast that misses the ring leaves it at
 * exactly 1.0, and there is no state in between. So `frac` = **0.70** fires when
 * and only when a blast has reached the roofs — every offset in the table above
 * that costs the terrace anything, and nothing else. The other two holdings
 * cannot make it fire on their own: their own rim floors are 653.60 of 900
 * (0.7262) and 853.60 of 1 100 (0.7760), both above 0.70, and the terrace is
 * nearer to both collars than either of them, so nothing reaches them without
 * reaching it first.
 *
 * **THE SECOND HALF OF THE FIX IS `HEADS_STAND` ON THE SAME TRIGGER.** A warning
 * about the next turn is a lie once there is no next turn: two blasts placed ten
 * metres out end the terrace at 0.6656, which is under 0.70, and the old
 * threshold was set at 0.5 precisely to stay quiet in that case. Asking whether
 * a collar is still theirs says it properly — the line fires while a turn
 * remains and cannot fire once both heads are off — and that is what lets the
 * threshold be set by the rim floor instead of by the correct line's residue.
 * `t.hamletLost` sits ABOVE it in the table for the third case: a blast aimed at
 * the hamlet itself kills the 800 hp terrace inside **13.17 m** of its centre
 * (`falloff >= 800/1120`), and being told the roofs are singed one line before
 * being told they are gone is worse than silence.
 *
 * **THE REMEDY IS STILL TEN METRES, OUTWARD, AND IT IS NO LONGER THE BEST
 * LINE.** Put each blast ten metres beyond its own head on the bearing away from
 * the hamlet and the head still takes 881.1 against 700, while the hamlet's
 * whole bill for both shots is
 *
 *     terrace   267.5 of 800      well   0.0 of 900      infirmary   0.0 of 1 100
 *
 * — the well and the infirmary pass outside 24 m of surface and take LITERALLY
 * NOTHING, and the terrace ends the operation at two thirds.
 *
 * **THE PERFECT LINE EXISTS AND IS DELIBERATELY NOT ADVERTISED.** Bisected, the
 * terrace is outside the blast entirely past **9.951 m** on head A and past
 * **12.343 m** on head B, and a collar dies out to **13.726** — so A at ten
 * metres and B at thirteen takes both heads and costs the hamlet **nothing at
 * all**, which the rig confirms at 0.00 on all three holdings. The window on
 * head A is 3.77 m wide; the window on head B is **1.38 m**, a third of a
 * `CELL`, which is not something a player aims at with a mouse at gameplay zoom.
 * So the brief says ten metres, the operation expects to pay the 267.5, and the
 * zero-cost line is written down here so that nobody re-derives it and so that a
 * re-seed has something to check against.
 *
 * **THE ASYMMETRY BETWEEN THE TWO SAFE RADII IS THE LAYOUT'S.** Head B stands
 * 18.87 m from the terrace and head A 21.26, so the same ten metres of offset
 * buys 2.39 m less clearance on B. That is `HAMLET_SPREAD` doing its job — see
 * `pact-thin-place.ts` §4 — and the operation used to quote one number for both.
 *
 * **WHAT IS STILL NOT SAID ON SCREEN, AND WHY THE BRIEF NOW CARRIES THE NUMBER.**
 * `ObjectiveRow` is `{ id, title, kind, status }`, and a
 * `VisionLevel.Remembered` structure carries no health bar (`Vision.levelAt`),
 * so once the reveal has run the player can SEE the terrace and can never READ
 * its hit points. The reticle is `SUPERWEAPONS[SolarLance].radius` — 24 m, the
 * BLAST rather than the safe distance. Everything a player learns about this
 * geometry, they learn in words, which is why `t.brief` now names the ten metres
 * instead of saying "away from the roofs" and leaving the number in a header.
 *
 * **AND THIS IS WHY THE SECOND CHARGE IS NOT FOR THE FIGHT.** A Lance dropped
 * on a column is worth measuring before it is spent, because `ARMOR_MATRIX`
 * makes it a worse weapon against the Ninth than against the Order:
 *
 *     victim              armour       epicentre   killed out to (centre)
 *     conscript   100 hp  Infantry      1 008.0    24.2 m — every man in the disc
 *     mrdWayfarer 110 hp  Infantry      1 008.0    24.2 m — every man in the disc
 *     mrdSolarch  330 hp  Light           896.0    18.29 m
 *     rhino       420 hp  Heavy           560.0     7.94 m
 *
 * `ARMOR_MATRIX[HighExplosive]` is 0.90 against Infantry, 0.80 against Light and
 * **0.50 against Heavy**, and a Rhino is Heavy while a Solarch is Light. So a
 * Lance dropped into a melee kills the player's own armour out to eighteen
 * metres and the Ninth's out to eight. **It is a better weapon against your own
 * army than against theirs**, which is not a balance complaint — it is the
 * counter-triangle working — and it is the honest reason the fight is not what
 * the charge is for.
 *
 * ============================================================================
 * THE PARCEL: WHAT IT FORBIDS, AND THE THREE THINGS IT CANNOT
 * ============================================================================
 * `PARCEL` is a 62 m disc on the midpoint of the two heads, and `concession`
 * fails when a Pact unit has stood inside it for ten seconds. It is a SECONDARY
 * and that is a decision rather than a shortage of nerve: a rule the engine
 * enforces is a rule the player never has to choose to keep, and this chapter is
 * about a concession the Order chose. **The Pact CAN take its ground back. Every
 * reason not to is a reason it gave itself.**
 *
 * **62 IS DERIVED, NOT CHOSEN.** `Combat.engage` fires at `range + hitRadius` of
 * centre distance, and the longest reach this roster leaves the player on this
 * map is **26 m** — `focusLance` on a Solarch and `sunLance` on a Lancer, equal
 * to the metre. Against a 2x2 that is a firing bar of `26 + 5.6569` = **31.657 m
 * of centre distance**. Each head stands 20.00 m from the parcel centre, so the
 * nearest a hull outside the rim can ever be to a head is `62 - 20` = **42.00 m**
 * — clear of the bar by **10.34 m**. Nothing the player owns can shoot a head
 * from legal ground, and that is a property of the roster and the map together:
 * `mrdZenith` (33 m) is `unit.specialist` and refused; `mrdHelios` (33 m) is
 * `struct.defence.specialist` and refused; `mrdKestrel` is `unit.air` and
 * refused; and `mrdCutter` (33 m), `mrdCorvette` (33) and `mrdMonitor` (40) are
 * all built by an `mrdSlipway`, which wants a coast that `arid` does not have —
 * `MAP_SEAS` has no row for this preset.
 *
 * **AND BEFORE ANY OF THE THREE: THE NINTH MENDS ITS OWN CUTTING HEADS AT
 * 30 hp/s, AND NO NUMBER IN EITHER HEADER USED TO ACCOUNT FOR IT.**
 * A cutting head is seat 1's PROPERTY rather than scenery, and
 * `AiBrain.repairBase` (`src/sim/AI.ts`) walks every alive, finished building
 * the AI owns — filtering on owner, kind, `Alive`, `!PendingDestroy`,
 * `!UnderConstruction` and `maxHp > 0`, and on nothing else. A `civOreMine`
 * passes all six. Below `AI_REPAIR.startFraction` 0.75 the worst-hurt candidate
 * gets `issueRepairToggle`, which is the PLAYER'S OWN WRENCH:
 * `RepairSell.setRepairing` refuses only on kind, owner, aliveness, unfinished
 * and undamaged, so it accepts.
 *
 * **DRIVEN, NOT ASSUMED.** On the built world, `setRepairing(seat 1, head A,
 * true)` returns **true**, and thirty ticks of `RepairSellService.simTick`
 * restore **30.000 hp for 7.500 credits** — `REPAIR_RATE` 30 at
 * `REPAIR_COST_PER_HP` 0.25, exactly. `repairBase` runs at
 * `t % AI_CADENCE.build === 6`, i.e. twice a second, so the arm latency is under
 * half a second and is ignored in the tables below.
 *
 * Three details narrow it, and all three are in the attacker's favour:
 *
 *   - **The first 175 hp are free.** The drip does not arm until the collar is
 *     under 0.75 of 700, so the clock is `175 / dps` and only then
 *     `525 / (dps - 30)`. Both tables below are computed that way.
 *   - **`AI_SKILL[].maxRepairs` is 1 / 3 / 5 / 8.** On Easy exactly one
 *     structure mends at a time, so a commander working both collars at once has
 *     one healing and one on the undripped clock; from Normal up both mend
 *     together. Every rung mends — `AI_REPAIR`'s own doctrine block says a base
 *     that never heals is a broken opponent rather than a gentle one.
 *   - **It is not free for the Ninth.** Two collars mending is 15 credits a
 *     second against `AI_REPAIR.minCredits` 400, and `src/data/Civilians.ts`
 *     prices a harvester at 429-700 credits a MINUTE, so a sustained double
 *     repair is roughly the whole output of `buildBaseFor`'s two collectors. The
 *     drip is paid out of the army the brain would otherwise field.
 *
 * **AND THE LANCE IS UNTOUCHED BY ALL OF IT**, which is why this discovery
 * strengthens the operation rather than undermining it: 1 120 lands in ONE
 * `Damage.applySplash` call against 700 hp, so there is no interval for a drip
 * to occupy. That is the entire content of the corrected thesis at the top of
 * this file.
 *
 * **THE FIRST THING THE RULE CANNOT DO IS SEE A BUILDING.**
 * `runtime.ts#unitsInArea` counts `EntityKind.Infantry` and `EntityKind.Vehicle`
 * and nothing else, so a STRUCTURE inside the parcel is invisible to it, and no
 * condition in the frozen vocabulary can ask the question a different way —
 * `ownerCount` takes no area. That is not a hole to be plugged, it is the
 * lawyer's route and it is in character for this chapter: the concession forbids
 * Pact hulls, not Pact property. Priced, it is `mrdCarryall` 3 000 to found a
 * yard on the rim, plus `mrdGlaive` 450 a post, and `glaiveRepeater` delivers
 * **10.9367 dps into Concrete** — 5 x 12 over a `(5-1)*0.06 + 0.55` = 0.79 s
 * cycle, through `ARMOR_MATRIX[SmallArms][Concrete]` 0.18 and `globalMul` 0.80,
 * read off the bound weapon table.
 *
 * **THIS BLOCK USED TO READ "one post takes 700 hp in 64.0 s and two take 32.0",
 * AND BOTH OF THOSE ROWS ARE ACTUALLY NEVER.** Against 30 hp/s of drip:
 *
 *     posts   dps      net      time to level one collar   (undripped)
 *       1    10.94   -19.06     NEVER — it parks at 525 hp     64.0 s
 *       2    21.87    -8.13     NEVER — it parks at 525 hp     32.0 s
 *       3    32.81    +2.81     192.2 s                        21.3 s
 *       4    43.75   +13.75      42.2 s                        16.0 s
 *       5    54.68   +24.68      24.5 s                        12.8 s
 *       6    65.62   +35.62      17.4 s                        10.7 s
 *
 * So the belt is not 3 900 credits for both collars. Four posts a collar is
 * **3 000 + 8 x 450 = 6 600 credits** and 42.2 s of firing, against the mirror's
 * 2 500 for both; three posts a collar is 5 700 and takes over three minutes,
 * which is a decision nobody makes twice. **Two posts on a collar is not a slow
 * answer, it is no answer** — the head sits at 525 hp for as long as the player
 * cares to watch, for 7.5 credits a second to the Ninth.
 *
 * `BUILD_RADIUS` is 56 and both collars are just inside it, which is the part
 * worth doing rather than assuming. A post has to stand within `24 + 5.6569` =
 * 29.657 m of a head. The NEAR collar is 42.00 m from the rim, so its posts go
 * **12.34 m** inside — trivially covered. The two heads are collinear with the
 * parcel centre, so the FAR collar is `62 + 20` = 82.00 m from the same rim
 * point and its posts have to stand **52.34 m** from the yard, which clears
 * `BUILD_RADIUS` by **3.66 m** and only while the yard is sited ON the rim
 * rather than comfortably outside it. Four posts in a 3.66 m band rather than
 * one is a siting problem and not a reach problem — the annulus at that radius
 * is 300-odd metres of arc — but it is four exact placements instead of one, and
 * a miss buys a second `mrdCarryall`. Add a construction vehicle parked 175.86 m
 * from the Ninth's opening and 256.78 m from yours for the whole of it.
 *
 * **THE SECOND THING IT CANNOT DO IS OUTRUN A BIG ENOUGH RAID, AND THE BAR IS
 * NINE HULLS.** `Targeting.approach` parks an attacker at
 * `range * APPROACH_STOP_FRAC` (0.80) of SURFACE distance, i.e. `20.8 + 5.6569`
 * = 26.457 m of centre, which is **15.54 m inside the rim**; at a Solarch's
 * 7.6 m/s that is 2.04 s in and 2.04 s out. `focusLance` is **16.50 dps into
 * Concrete** — 60 damage, `burstCount` 1, 1.6 s cooldown, through
 * `ARMOR_MATRIX[ArmorPiercing][Concrete]` 0.55 and `globalMul` 0.80.
 *
 * **THIS TABLE USED TO READ `700 / (16.5 n)` AND THE BAR USED TO SAY EIGHT.**
 * With the drip it is `175 / (16.5 n)` free and then `525 / (16.5 n - 30)`:
 *
 *     Solarchs   credits   seconds inside the disc     vs the ten-second grace
 *        4        3 200        4.09 + 17.23 = 21.32    the bonus is gone
 *        6        4 800        4.09 +  9.38 = 13.47    the bonus is gone
 *        8        6 400        4.09 +  6.47 = 10.56    gone by half a second
 *        9        7 200        4.09 +  5.61 =  9.70    KEPT, by three tenths
 *       10        8 000        4.09 +  4.95 =  9.04    KEPT
 *
 * So the concession survives a four-hull raid and does not survive a
 * seven-thousand-two-hundred-credit one, twice, on ground 81 m closer to the
 * Ninth's opening than to the player's. That is the shape this operation wants:
 * **a rule you can afford to break, priced.**
 *
 * **THAT TABLE IS DERIVED AND NOT DRIVEN, AND ONE OMISSION MOVES THE BAR BY
 * THREE HULLS.** The seconds are `distance / maxSpeed` plus the two damage
 * terms, with no acceleration in them: `mrdSolarch` carries `accel`
 * `max(2.4, 7.6 * 1.15)` = 8.74 m/s², so reaching 7.6 m/s costs about 0.87 s at
 * each end of the trip and the real figures are roughly 1.7 s longer than the
 * ones above. At that correction nine hulls (11.4 s), ten (10.7) and eleven
 * (10.2) are all refused and **twelve Solarchs at 9 600 credits** (9.8 s) is the
 * first row that keeps the bonus. The table is left as the LOWER BOUND on
 * purpose — it is the number that makes the rule look weakest — and the honest
 * statement is that the raid is affordable and much dearer than it reads here.
 *
 * **THE THIRD THING IT CANNOT DO IS STOP A PHAROS, AND THIS FILE MISSED IT
 * ENTIRELY.** The roster is an allow-list over TAGGED defs only — `refusedBy`
 * answers false for a def with no `unlockedBy` — and `mrdPharos` carries none.
 * Measured on the bound tables: `mrdPharos` `unlockedBy` **undefined**,
 * `prereqs: ['mrdOculus']`, 1 500 credits, -80 power; `power.airstrike`
 * `prereqs: []`, no tag, 1 500 credits. An `mrdOculus` is standing in the
 * player's opening base at **104, 396** on the built world, so the prereq is
 * already met at t = 0, and the power ledger has room: 24 structures at
 * produced 640 / consumed 260, the Heliograph's -150 leaves +230 and the
 * Pharos's -80 leaves **+150**. Both can stand at once.
 *
 * `CommanderPowerService.tick` decrements every charge slot from match start
 * whether the power is owned or not — its own header and
 * `ProductionService.installPower` both say so — so a power bought at t ~ 46 s
 * is callable at **t = 150 s** and every 150 s after, i.e. **seven calls inside
 * the notice**. `applyAirstrike` pushes ONE splash record: 260 damage,
 * `WarheadClass.HighExplosive`, radius 20, falloff 0.3. Through the same
 * arithmetic as the Lance against a 2x2 Concrete collar that is **208.00**
 * centred and **81.70** at twenty metres, so three calls on each head plus one
 * on the midpoint is 705.71 a head for 3 000 credits and no hull on the ground
 * at all.
 *
 * **AND IT IS THE REPAIR LAYER, NOT THIS FILE'S GEOMETRY, THAT REFUSES IT.**
 * 208 every 150 s is **1.39 hp/s** against a 30 hp/s drip, and one call leaves a
 * collar at `492/700` = 0.703 — under `AI_REPAIR.startFraction` 0.75, so the
 * brain arms the wrench and has it whole again 6.9 seconds later, seven times
 * over, for 52 credits. The Airstrike is a real reach onto forbidden ground and
 * it is not a route to a head unless the Ninth is broke. Stated rather than
 * claimed away, because the reach is genuine and the parcel rule cannot touch
 * it.
 *
 * The warning fires at three seconds and the failure at ten, so a stray hull
 * that wandered has seven seconds to be recalled. `elapsedSinceArmed` disarms
 * the moment the last Pact unit leaves the disc, which is the hold timer working
 * exactly as `types.ts` describes it.
 *
 * ============================================================================
 * THE GROUND, AND WHY THE PARCEL IS OFF EVERY ROAD
 * ============================================================================
 * Dijkstra over the REAL `FlowFieldCache.costGridFor` — so `rebuildCost` itself
 * rather than a mirror of it — 8-connected, edge weight
 * `step * (cost[a] + cost[b]) / 2 / COST_UNIT`, diagonals refused at a cut
 * corner, endpoints snapped to the nearest open cell:
 *
 *                             path      straight   detour
 *     ROAD -> the openings   325.1 m    303.8 m     +7.0%
 *     home -> the office     312.4      286.8       +8.9%
 *     home -> the parcel     289.1      256.8      +12.6%
 *
 * **THE GRID REALLY REFUSES THINGS, WHICH WAS CHECKED RATHER THAN ASSUMED.**
 * `COST_BLOCKED` is exported from `src/world/terrain-gen.ts` and NOT from
 * `src/core/config.ts`; imported from the wrong module it is `undefined`, every
 * `nc >= undefined` is false, and a Dijkstra that walks through buildings
 * returns plausible, slightly-short routes and a green test. The control here is
 * the count: **3 431 of 16 384 cells are `COST_BLOCKED` on the Track grid**, so
 * the instrument can see walls.
 *
 * Foot and Track agree to a tenth of a metre on the ROAD row, because a headless
 * build has no road: `roads.system.ts` builds the network in `init()` at
 * `Phase.Command` order 60, DURING `bootstrap()`, so `getRoads()` is null inside
 * `buildScenario` and `rebuildCost` skips its road branch. `NAV_COST_ROAD` is
 * 0.88 for Foot against 1.0 for Track, so a real match's carriageway shortens the
 * INFANTRY half of each column and not the armour half — which pushes the two
 * halves closer together than the table says, i.e. in the direction that makes
 * the operation harder. Recorded rather than corrected.
 *
 * At the shipped speeds, from the moment a column lands at `ROAD`: a Rhino at
 * 5.4 m/s is on the player's line in **60.2 s** and a Conscript at 3.4 m/s in
 * **95.6 s**, so every wave arrives in two parts thirty-five seconds apart.
 *
 * **THE PARCEL IS 95.38 m OFF THE OPENING-TO-OPENING AXIS AND THE RIM CLEARS IT
 * BY 33.38 m.** That is the deliberate INVERSION of `pact.04.in-the-clear`,
 * which pairs `TAP_OFFSET` 26 with `LOT_R` 28 precisely so that the axis CUTS
 * its disc and a column cannot avoid the bonus by marching straight. Here the
 * same construction would fail the player's own bonus for taking the direct road
 * between the two bases, which is a bonus about traffic rather than about a
 * decision. `pact.05.open-count` made the same inversion for the same reason and
 * this inherits it. `pact-thin-place.ts` states the pair from its side; change
 * one and change both notes.
 *
 * **AND NO ORE IS INSIDE IT**, which is the hazard nobody would have seen: a
 * harvester is an `EntityKind.Vehicle`, so a field inside the disc would fail the
 * concession on its own, in silence, at whatever minute the economy chose. This
 * map declares three — r 30 at 150,402; r 30 at 362,110; and the contested r 22
 * on the centroid at 256,256 — and the nearest edge to the parcel centre is
 * **83.6 m, i.e. 21.6 m outside the rim**.
 *
 * ============================================================================
 * WHAT THE ROSTER DOES, MEASURED IN BOTH DIRECTIONS
 * ============================================================================
 *     player: ['struct.tech', 'struct.superweapon.solarlance']
 *     ai:     []
 *
 * An allow-list, so tagged-and-unlisted is refused on both seats. The player
 * keeps exactly two ids and they are the two the operation is: `struct.tech`
 * puts an `mrdReliquary` in the opening base — counted on the built world, one —
 * which is `mrdHeliograph`'s only prereq, and `struct.superweapon.solarlance` is
 * the Heliograph itself.
 *
 * Built twice at these seeds, rostered against an unrostered control, **236
 * entities alive against 246**, and the ten are:
 *
 *     seat 0   mrdHelios x1   mrdSkiff x2
 *     seat 1   teslaCoil x3   apocalypse x1   attackDog x2   battleLab x1
 *
 * **THE ASYMMETRY IS THE POINT AND IT IS ONE ID WIDE.** `struct.tech` is the
 * only thing the two lists disagree about, and it is the whole operation: the
 * player opens with a Reliquary and can raise a Heliograph, the Ninth opens
 * without a Battle Lab and can raise nothing above the middle tier. Everything
 * else is refused from BOTH sides, which is `pact.04.in-the-clear`'s argument for
 * an empty pair — profile-independent, the same ground on a finished account as
 * on a fresh one — held everywhere except at the one door this file is about.
 *
 * **AND `teslaCoil x3` IS THE ROW THAT DECIDES THE SECOND SECONDARY.**
 * `src/game/scenarios/SovietBase.ts` seeds three at the start spot, 30 m of
 * `teslaBolt` with `chainCount` 2; refused, the guns this operation stands up
 * are `flameTower x2, sentryGun x1` and the allocation office is a fight rather
 * than a wall. `tests/campaign-roster-ground.spec.ts` is what makes the ten a
 * measurement rather than a hope, and `tests/campaign-emplacement-reach.spec.ts`
 * §1 pins the gun roster by def key and count in both directions.
 *
 * **AND THE POWER IS THE HALF THAT MAKES IT WORK.** Measured on a bound,
 * roster-installed build, the player's opening base is 24 structures at
 * **produced 640 / consumed 260, +380 of net power**. `mrdHeliograph` draws
 * **-150** — the heaviest single load in the game — so the mirror leaves
 * **+230** and no reactor has to be bought before the clock can start. That is
 * not decoration: `SuperweaponService.chargeTick` skips any weapon whose gating
 * structure is not standing AND LIT, so a base in deficit is a mirror that does
 * not charge, and a player who spends the +230 on twenty-three Glaive Posts has
 * stopped the operation without being told.
 *
 * ============================================================================
 * NEITHER SHIPPED OUTCOME RULE MAY END THIS
 * ============================================================================
 * `annihilationWin` would hand the player a victory for flattening the Ninth at
 * minute nine with both heads still turning, and — worse — one for a match in
 * which the hamlet had already been burned, since `Viability` counts assets and
 * knows nothing about which buildings this operation is named after.
 * `assetLossDefeat` is off for `pact.01.shallow-road`'s reason: the player opens
 * with a full base and could not plausibly reach zero assets before `t.lose`
 * reads, and a rule that can only end a scripted match by accident should not be
 * armed.
 *
 * `SETTLE` guards every zero threshold. `ownerCount(1, 'building', 'head',
 * max: 0)` reads TRUE against an empty tag registry exactly as `entityDead`
 * does — the spelling changes and the trap does not — and so does every
 * `entityDead` clause in `t.hamletLost`. It is defence against a layout that
 * placed NOTHING rather than against a tick-one read that happens today:
 * `scenarios.system.ts` builds the world inside `async init()` and
 * `SystemRegistry.init` awaits every module's init in sequence before a tick is
 * taken, so the registry is never empty when the Director first runs. What IS
 * reachable is a wrong def key or a footprint that will not fit, and
 * `tests/campaign-roster-ground.spec.ts` is the gate that catches the cause.
 *
 * **`ownerCount` RATHER THAN `entityDead` ON THE HEADS, AND THE HEADS ARE THE
 * ONE THING ON THAT PARCEL NOT UNDER A VETO.** A captured head is not cutting,
 * so ownership is the honest question — and it is a live question rather than a
 * spelling preference, because taking one is a real play: four `mrdArtificer`,
 * of which the opening garrison provides one, so 1 500 credits for the first
 * collar and 2 000 for the second. Three of the four are spent SOFTENING —
 * `maxHp * CAPTURE.softenFrac` 0.25 through
 * `ARMOR_MATRIX[HighExplosive][Concrete]` 1.00 and `COMBAT_DAMAGE.globalMul`
 * 0.80 = 0.20 of max, against a `CAPTURE.captureHpFrac` gate of 0.50, and both
 * are fractions of max so `maxHp` cancels. It is the one route to a head that
 * needs no mirror at all, and it costs the concession outright rather than
 * narrowly: a head stands 42.00 m inside the rim and an Artificer walks at
 * 3.6 m/s, so the walk in alone is **11.7 s** against a ten-second grace before
 * a single deed has changed. `entityDead` would refuse to see the capture,
 * complete nothing, and leave the player holding a collar the operation still
 * called a threat.
 *
 * **THE DRIP FIGHTS THE SOFTEN, AND THE FOUR HAVE TO ARRIVE TOGETHER.** Three
 * Artificers take 0.60 of 700 = 420 hp off, leaving 280 = 0.40 against the 0.50
 * gate — a margin of exactly 70 hp, which the Ninth's wrench replaces in
 * **2.33 seconds**. Sent as a group they land on consecutive ticks and the
 * margin holds; walked in one at a time they do not, and the fourth arrives at a
 * collar the brain has already lifted back over the gate. `Capture.resolve`
 * writes `st.hp` on its FRIENDLY branch only, so the collar the player ends up
 * owning arrives on their books at whatever the ladder left it — **at or under
 * half of 700** — and is then the player's to repair or to lose.
 *
 * `max: 0` and `min: 1` are also exact complements over an INTEGER count, which
 * is what lets `t.win` and `t.late` partition every tick — the float trap
 * `reclamation.05.closing-entry` records for `credits` does not exist here.
 *
 * ============================================================================
 * THE PAR IS THE NOTICE, EXACTLY
 * ============================================================================
 * `NOTICE` is nineteen minutes and it is an absolute clock: the win reads at it
 * and not before, so **1 140 s is what every run of this operation takes** and
 * `parSec` is 1 140 rather than a guess above a modal band. That is a different
 * relationship from `pact.04.in-the-clear`, whose par sits 120 s above its
 * fourteen-minute floor because its win needs a second thing after the clock;
 * here the clock is the last thing.
 *
 * **AND THE MIRROR HAS TO FINISH BY 4:56, WHICH IS FOUR SECONDS EARLIER THAN
 * THIS BLOCK USED TO SAY.** It read *"Two turns need `finish + 840 <= 1140`, so
 * the Heliograph must FINISH by 5:00 and therefore be PLACED by 4:26"*, and
 * `finish + 840` is not the round trip. The round trip is
 * `2 * chargeSeconds + nukeWarnSeconds + AVAILABILITY_INTERVAL`, in ticks:
 *
 *     14      `rescanAvailability` runs at `s.tick % AVAILABILITY_INTERVAL === 0`
 *             (15), and `available[b]` is 0 until it has SEEN the structure, so
 *             a mirror that finishes just after a rescan waits for the next one.
 *             The ready tick is `firstRescan + 12 599`; worst case that is 14
 *             ticks over the pure charge.
 *     12 600  `chargeSeconds` 420 at 30 Hz, one `chargeTick` decrement per tick.
 *          1  `consumeOrders` runs BEFORE `chargeTick`, so on the tick
 *             `remaining` reaches zero the weapon is not yet firable. The
 *             earliest legal fire is the tick after READY.
 *     12 600  `fireAt` writes `remaining = chargeSeconds` on the spot, so the
 *             second charge starts immediately and needs no second rescan.
 *        105  `SUPERWEAPON_FX.nukeWarnSeconds` 3.5 — `drainIntents` sets it and
 *             `strikeTick` counts it down. The mirror announces itself; that
 *             announcement is inside the deadline.
 *     ------
 *     25 320  = **844.000 s**
 *
 * `NOTICE` is 34 200 ticks and `t.win` reads AT it, so the second detonation has
 * to land on or before that tick: the Heliograph must FINISH by tick
 * `34 200 - 25 320` = 8 880 = **296.00 s = 4:56**, and therefore be QUEUED by
 * 8 880 - 1 020 = 7 860 = **262.00 s = 4:22** (`buildTime` 32 plus
 * `CONSTRUCTION_RISE_SECONDS` 2.0 = 1 020 ticks). **That is a FLOOR**: it
 * assumes the first lance is fired on the first tick it is legal, with no human
 * reaction time at all, and every second of hesitation on the first fire moves
 * the second detonation by the same second.
 *
 * Nothing in the frozen vocabulary can see a structure the player built, so this
 * cannot be a trigger on the mirror's existence; it is stated in the objective
 * title, said in the brief at sixteen seconds, and said again by `t.clock` at
 * two and a half minutes on an UNCONDITIONAL trigger — which is
 * `soviets.08.carriage-forward`'s lesson about a mechanism explained only behind
 * an optional row. **`t.clock` says "before the fourth minute is out", not the
 * true 4:22**, and the twenty-two seconds of slack are deliberate: a line that
 * quotes the floor to the second is a line that is wrong the moment a player
 * takes a breath before clicking. The earlier draft said "on the ground by half
 * past four", which was eight seconds PAST the deadline on its own reading of
 * "on the ground" — a margin in the losing direction, which is the one direction
 * a player-facing clock must never be wrong in.
 *
 * The chapter runs 780 / 840 / 900 / 960 / 1 020 / 1 080 / 1 140, which
 * `tests/campaign-length.spec.ts` checks for monotonicity.
 *
 * ============================================================================
 * NO `eva` EXCEPT ONE
 * ============================================================================
 * `types.ts` says most scripted announcer lines are punctuation, because
 * `audio.system.ts` already speaks the ordinary events. It covers nothing here:
 * `structureLost` fires for LOCAL buildings and the hamlet is GAIA's, so nobody
 * says anything at all when the terrace goes down. That is exactly the case the
 * field exists for and it is the one line this file scripts, on `t.hamletLost`.
 * `reinforcements` would be a lie on a Soviet column, and `buildingCaptured` —
 * which `audio.system.ts` speaks on any capture involving the local seat — is
 * already the announcer's job on the two plays that produce one, the heads and
 * the allocation office.
 *
 * ============================================================================
 * THE MEASURED POINTS, AT `mapSeed` 20 130 / `simSeed` 3 733
 * ============================================================================
 * Read off a headless build AFTER `spawnBuilding` snapped every footprint, with
 * the def tables BOUND and the roster INSTALLED — which is
 * `tests/campaign-roster-ground.spec.ts`'s build and NOT
 * `tests/campaign-maps.spec.ts`'s, whose `buildOperation` passes no `defs` and
 * never calls `setCampaignRoster`, so every refusal counted above is inert there.
 *
 *     home 108, 380     foe 404, 132     axis 386.161     the diagonal pair
 *     head A 336, 312   head B 368, 288  separation 40.000
 *     terrace 352, 298  well 364, 312    infirmary 342, 288
 *     parcel centre 352, 300             office 328, 196    ROAD 344.69, 189.52
 *
 *     parcel -> home 256.78   parcel -> foe 175.86   office -> foe  99.36
 *     office -> home 286.80   office -> ROAD  17.90  office -> parcel 106.73
 *
 * The parcel holds **740 cells whose centre is inside 62 m, 702 of them open —
 * and open to Foot, Track and Hover alike, 702 / 702 / 703** — so "the parcel"
 * is one number rather than three.
 *
 * `ROAD` is the only one of these that is not a structure, and it was SEARCHED
 * rather than chosen: 999 candidates on a 2 m grid around the office were scored
 * on whether EVERY ring point of all four columns is open to that unit's own
 * locomotor, and 102 of them cleared it. This one is the nearest to the office
 * of the 102, at 17.90 m, which is what makes a column read as coming OUT of the
 * building the secondary is about.
 *
 * **RE-MEASURE IF EITHER SEED MOVES.** Almost nothing fails loudly if these
 * drift: the parcel stops covering the heads, the terrace creeps out of the
 * blast and the primary stops asking anything, the ore creeps inside the rim and
 * fails the concession on its own. `tests/campaign-spawn-ground.spec.ts` is the
 * one exception — it re-derives every ring point of all four columns and fails by
 * name if a drop lands on ground the wave's own locomotor cannot enter.
 * ========================================================================== */

import { Faction } from '../../../core/types';
import { minutes, seconds } from '../../types';
import type { Area, Condition, OperationDef, Point } from '../../types';

/* -- the measured points -------------------------------------------------- */

/**
 * The bought parcel, as PLACED: the midpoint of the two cutting heads.
 *
 * `PARCEL.r` 62 is DERIVED. Each head stands 20.00 m from this point, so the
 * nearest a hull outside the rim can be to a head is 42.00 m against a 31.657 m
 * firing bar — clear by 10.34 m, and that is what makes the mirror the only
 * thing the player owns that reaches the ground they signed away. See the parcel
 * block in the header before moving either number.
 *
 * **PAIRED WITH `WORKS_OFFSET` = 96 IN `pact-thin-place.ts`**: the parcel centre
 * is 95.38 m off the opening-to-opening axis, so the rim clears the direct road
 * between the two bases by 33.38 m and ordinary traffic can never fail the
 * concession. Change one and change both notes.
 */
const PARCEL: Area = { x: 352, z: 300, r: 62 };

/** The Ninth's allocation office, as PLACED. 17.90 m from the drop point. */
const OFFICE: Point = { x: 328, z: 196 };

/**
 * Where every Soviet column forms up.
 *
 * SEARCHED, NOT CHOSEN. `ProductionService.spawnUnit` writes the ring point
 * VERBATIM — no `connectedGround`, no egress search — so the points that have to
 * be standable are the ring points themselves. The seven `spawnUnits` effects
 * below author **34 drops across 20 distinct points**: waves A and B share the
 * (4, 14) armour ring and waves B and C share the (5, 22) infantry ring, so
 * fourteen of the drops land where another wave has already dropped. All 34 are
 * open to the locomotor of the unit that lands on them — Track for `rhino`, Foot
 * for `conscript`, resolved through the same three tables `spawnUnit` reads.
 */
const ROAD: Point = { x: 344.69, z: 189.52 };

/** The player's opening, as PLACED. Every column is pointed at it. */
const HOME: Point = { x: 108, z: 380 };

/* -- the clocks ----------------------------------------------------------- */

/**
 * The hour the allocation says the works break ground. An absolute clock and
 * the whole of the par: nineteen minutes, every run.
 */
const NOTICE = minutes(19);

/**
 * The four columns. Three minutes of quiet first — long enough to raise the
 * mirror out of half the opening bank and walk the base garrison onto a line —
 * then gaps of 4:30, 4:00 and 4:00. Wave B lands at 7:30, nine seconds before
 * the first charge is READY on a mirror queued at five seconds and twelve and a
 * half before it BURNS — the extra three and a half are
 * `SUPERWEAPON_FX.nukeWarnSeconds`, which the header's par block now counts and
 * an earlier draft of this file did not.
 */
const WAVE_A = minutes(3);
const WAVE_B = seconds(450);
const WAVE_C = seconds(690);
const WAVE_D = seconds(930);

/**
 * How long the layout is given to have placed the ground before any zero
 * threshold over it is believed. See the outcome block in the header: it is
 * defence against a layout that placed nothing, not against a tick-one read that
 * happens today.
 */
const SETTLE: Condition = { on: 'elapsed', ticks: seconds(20) };

/** Both cutting heads are off the Ninth's books — burned, or taken. */
const HEADS_OFF: Condition = {
  on: 'all',
  of: [SETTLE, { on: 'ownerCount', player: 1, role: 'building', tag: 'head', max: 0 }],
};

/**
 * At least one head is still theirs. The exact complement of `HEADS_OFF`.
 *
 * TWO READERS. `t.late` uses it as the losing half of the pair that partitions
 * the notice tick; `t.singed` uses it to mean "there is still a turn to come",
 * which is what lets that warning's threshold be set by the blast's rim floor
 * rather than by how much the correct two-shot line costs the terrace. See the
 * hamlet block in the header.
 *
 * `min: 1` alone reads FALSE against an empty tag registry, which is the safe
 * direction for both readers — the warning stays quiet and the late loss does
 * not fire — so it needs no `SETTLE` of its own, unlike `HEADS_OFF`.
 */
const HEADS_STAND: Condition = {
  on: 'ownerCount', player: 1, role: 'building', tag: 'head', min: 1,
};

/** A Pact unit is standing on the bought parcel. */
const TRESPASS: Condition = { on: 'unitsInArea', player: 0, area: PARCEL, min: 1 };

/**
 * Any one of the three holdings is gone.
 *
 * THREE CLAUSES RATHER THAN `entityDead: 'hamlet'`, AND THE DIFFERENCE IS THE
 * WHOLE OBJECTIVE. `entityDead` is `aliveWithTag === 0`, so a shared tag would
 * only fire once ALL THREE were down — an objective that survives losing two
 * thirds of the people it is about. The shared `hamlet` tag exists for
 * `entityHpBelow`, which reads the WEAKEST of the set and is the right shape
 * there.
 *
 * TWO READERS, and the second is negated: `t.hamletLost` ends the operation on
 * it, and `t.heads` carries `not` of it so that the tick which both completes
 * the primary and kills the terrace does not congratulate the player inside the
 * same effect list that defeats them. See that trigger's own block — file order
 * cannot do that job, because `CampaignSession.simTick` applies the whole list
 * with no early exit.
 */
const HAMLET_LOST: Condition = {
  on: 'any',
  of: [
    { on: 'entityDead', tag: 'terrace' },
    { on: 'entityDead', tag: 'well' },
    { on: 'entityDead', tag: 'infirmary' },
  ],
};

const op: OperationDef = {
  id: 'pact.07.thin-place',
  chapter: 'pact',
  faction: Faction.Meridian,
  /*
   * THE SOVIETS, AND THE CONCESSION IS WHY IT IS THEM RATHER THAN ANYBODY ELSE.
   *
   * The chapter has fought all four armies and the question this operation asks
   * is who turns up on ground that has just stopped belonging to anyone. Not the
   * Allies: `allies.08.standing-order` has them entering the amendment in every
   * siting office on the eastern arc and `allies.09.made-good` has the whole
   * chapter discover that not one refinery moves for it — that army answers a
   * number with paper, and `pact.04.in-the-clear` already put an Allied
   * instrument on Pact crust anyway. Not
   * the Reclamation: `pact.06.common-ground` has just fought their breaking crew
   * on the cut, and running the same army twice would make the concession look
   * like one company's opportunism rather than a fact about the ground. Not the
   * Sept: `pact.05.open-count` spent the mirror match and the Conclave lost it.
   *
   * The Ninth arrives because the count told the continent where a cut works
   * best and the Soviets are the army that answers a number with an ALLOCATION —
   * `soviets.05.short-allocation` and `soviets.09.nil-return` are both about a
   * sector and a figure it has been handed. They do not buy the parcel and they
   * do not argue about it. They are entitled to it, which is worse.
   *
   * MECHANICALLY IT PINS THREE THINGS. All four columns spawn `rhino` and
   * `conscript` — authored SOVIET hulls, literal and unremapped, which
   * `validateCampaign` checks against this field. The layout's `barracks` stays
   * a Barracks and its `pillbox` resolves through `keyFor` to a **Sentry Gun**:
   * 22 m of `pillboxMg`, `chainCount` 0, 52.00 delivered on one trigger pull
   * against a 110 hp Wayfarer, so it takes three pulls to kill the player's line
   * infantryman and `tests/campaign-emplacement-reach.spec.ts` §2 is satisfied by
   * the row not chaining at all. And `heavyCannon` is 26 m — EQUAL to
   * `focusLance` — so against this army the Pact's two metres of doctrinal reach
   * do not exist, which is a deliberate contrast with `pact.05.open-count`,
   * where they were the only asymmetry left.
   */
  foe: Faction.Soviets,
  index: 7,
  title: 'The Thin Place',
  beat: 'The crust belongs to everybody now, and the first allocation on it is a cut over the '
    + 'one hamlet the count was ever taken from.',
  primaryType: 'superweapon',
  // Objective state, two reveals, a camera move, four columns and four orders —
  // so 'bespoke' by the definition in `types.ts`. The label is about MECHANISM:
  // what makes this operation what it is is 40 m of ground between two holes with
  // three occupied buildings in it, and that ground exists before tick one.
  archetype: 'bespoke',
  parSec: 1_140,
  requires: ['pact.06.common-ground'],

  map: {
    /*
     * `arid` THE PRESET, `desert` THE BIOME, AND THEY ARE THE ONE PAIR THE TWO
     * VOCABULARIES DISAGREE ON.
     *
     * `MAP_PRESETS` is keyed `temperate | arid | tropical | snow | coast | urban
     * | archipelago`; `BiomeName` is `temperate | desert | snow | urban`. They
     * overlap on three names and disagree on exactly this one, and
     * `reclamation.03.sold-twice` shipped `biome: 'arid'` — which `getBiome`
     * answers with a `console.warn` and TEMPERATE — so every number in its two
     * headers was a number about the wrong landform. `pact.03.concession` is the
     * other operation in this chapter on this pair and it is spelled out here
     * for the same reason it is spelled out there: the safety is a property of
     * the two strings and not of anybody's memory.
     *
     * It is also the ground the fiction wants. A pan with the crust close under
     * it is where wells are shallow enough for eleven families to have taken a
     * reading a day for four hundred years, and it is where a cut vents.
     *
     * Measured on the ground this pair actually builds: 13 034 of 16 384 cells
     * are foot-passable (79.6%) and 3 350 are closed, and 13 034 + 3 350 =
     * 16 384 — a census whose rows do not sum to `MAP_CELL_COUNT` is wrong on its
     * face, which `pact-concession.ts` records paying for.
     */
    preset: 'arid',
    /*
     * Fixed, and pinned by `tests/campaign-maps.spec.ts` as a terrain
     * fingerprint. CHOSEN BY SURVEY: sixty rolls were built headless at this
     * `simSeed`, with the roster installed, and scored on five criteria at once —
     * the placed head separation inside [34, 46] m, the terrace 17 to 22 m from
     * BOTH heads (which is what makes two centred blasts lethal and one
     * survivable), the well and the infirmary past 24 m from both, no ore inside
     * the rim, and the axis clearing the rim by more than 25 m.
     *
     * NINE of the sixty cleared all five. 20 130 is the one that also has the
     * most open parcel — **702 of 740 cells against 477 to 662 for the other
     * eight** — and whose five parcel structures all placed within 2.2 m of the
     * point the layout asked for. It wins on every criterion rather than on one,
     * which is the only kind of survey worth writing down.
     */
    mapSeed: 20_130,
    /*
     * The PAIR is chosen by this seed and not by the map roll. `seatedSlots`
     * filters `START_PAIRS` against the water and `arid` has no `MAP_SEAS` row,
     * so all four survive; 3 733 draws the DIAGONAL at **386.161 m** with home at
     * 108, 380 and the Ninth at 404, 132. The diagonal is what puts the parcel
     * 256.78 m from the player and 175.86 m from the Ninth — far enough that a
     * raid is a journey and not a sortie, which is the arithmetic the concession
     * block is priced against.
     */
    simSeed: 3_733,
    armies: 2,
    biome: 'desert',
    opening: 'base',
    /*
     * BOTH SEATS. `Shell.applySimPostBoot` writes `setup.startingCredits` into
     * every non-Neutral slot, so this is one number doing two jobs.
     *
     * IT IS SIZED AS ONE PURCHASE. `mrdHeliograph` is 2 500 — exactly half the
     * bank — and it is the first thing a player should place, which makes the
     * opening decision a single unmissable one rather than a shopping list. What
     * is left buys three Solarchs, or two and four more Glaive Posts, against a
     * first column at three minutes.
     *
     * The rest of the war is mined rather than banked. `buildBaseFor` ships two
     * `mrdCollector`, and `src/data/Civilians.ts` prices a harvester at 429 to
     * 700 credits a minute against `tests/harvester-soak.spec.ts`, so the
     * nineteen minutes are worth **16 302 to 26 600 credits** — the budget the
     * office assault and the four columns are both paid out of.
     *
     * IT IS A PLATEAU AND NOT A RISE. The chapter runs 4 000 / 5 000 / 5 000 /
     * 5 000 / 5 000 / 5 000 / 5 000; what escalates is the clock and the
     * columns, not the purse.
     */
    credits: 5_000,
  },
  layout: 'pact-thin-place',

  outcome: { annihilationWin: false, assetLossDefeat: false, ignoreSeats: [] },

  /*
   * TWO IDS AND THEY ARE THE OPERATION. `struct.tech` is `mrdReliquary`, which is
   * `mrdHeliograph`'s only prereq and which `buildBaseFor` therefore stands up at
   * t = 0; `struct.superweapon.solarlance` is the Heliograph. Everything else
   * tagged is refused on BOTH seats, which is measured in the header's roster
   * block — and the id that matters most on the Ninth's side is the one that is
   * NOT here: `struct.defence.specialist` would put Tesla Coils on their line,
   * 30 m of `teslaBolt` with `chainCount` 2, and the office assault this
   * operation's second secondary is about would stop being a decision.
   */
  roster: { player: ['struct.tech', 'struct.superweapon.solarlance'], ai: [] },

  /*
   * THE HAMLET CANNOT CHANGE HANDS, AND THE VETO CLOSES EXACTLY ONE OF THE TWO
   * DOORS.
   *
   * These are GAIA structures, which is `Capture.resolve` rule 1: a neutral
   * structure is taken outright, at ANY health, by one engineer. The player opens
   * with an `mrdArtificer` and the parcel's ten-second grace is long enough to
   * walk one in and out. A captured holding is on SEAT 0 — and
   * `Targeting.isValidTarget` refuses only ALLIES, so the moment it changes hands
   * it becomes a legal target for every gun the Ninth owns, standing in the
   * middle of the Ninth's own parcel, while `t.hamletLost` does not care who
   * fired. That is trap 9's second half exactly, and it is what this field is
   * for.
   *
   * **IT DOES NOT CLOSE THE GARRISON DOOR AND THIS FILE DOES NOT PRETEND IT
   * DOES.** `GarrisonService.enter` calls `captureBuilding()` directly and
   * consults no `CaptureService` veto, so a rifleman walking into the terrace
   * flips the deed as surely as an engineer does — `allies.07.fair-copy` found
   * that and priced it rather than closing it. Two things make the residual
   * survivable here and both are measured. It is REVERSIBLE:
   * `GarrisonService.releaseEmptied` flips a neutral structure back the moment
   * the last man leaves, where a captured deed is permanent. And it is
   * SELF-PUNISHING: `runtime.ts#unitsInArea` filters owner, `IS_UNIT` and
   * `PendingDestroy` and tests NEITHER the ground nor `EntityFlag.Garrisoned`, so
   * a man sitting inside a holding on the parcel is still counted by `TRESPASS`
   * and the concession bonus runs out at ten seconds while he sits there.
   *
   * `head` is deliberately NOT on this list even though the primary reads
   * ownership — see the outcome block. A head the player has taken is a head that
   * is not cutting, and the objective title says "off them" for that reason.
   */
  captureProof: ['terrace', 'well', 'infirmary'],

  objectives: [
    {
      /*
       * THE TITLE NAMES THE INSTRUMENT, WHICH IS THE ONE THING NO OTHER SURFACE
       * CAN SAY.
       *
       * `ObjectiveRow` is `{ id, title, kind, status }` — no description, no
       * tooltip — so the title is the only sentence a player is guaranteed to
       * read, and `soviets.08.carriage-forward` shipped a primary whose mechanism
       * was explained in a beat behind an optional secondary. Here the mechanism
       * is a 2 500-credit structure that has to be QUEUED by 4:22, and a title
       * reading only "bring down both cutting heads" would leave a player to
       * discover at minute fifteen that a ground answer was never available.
       * "Turn the mirror on" is what the row has to say.
       */
      id: 'heads',
      kind: 'primary',
      title: 'Turn the mirror on both cutting heads before the works break ground',
    },
    {
      /*
       * NO DIGITS AND NO RADIUS. `tests/build-descriptions.spec.ts` §4 bans
       * numerals in `BUILD_DESCRIPTIONS` and does NOT reach objective titles, so
       * nothing in the suite would fail if one were written here. The convention
       * is honoured anyway: a second copy of a measured number in prose is
       * exactly the drift the header above spends four hundred lines refusing.
       */
      id: 'hamlet',
      kind: 'primary',
      title: 'Leave the hamlet on the parcel standing',
    },
    {
      /*
       * A SECONDARY RATHER THAN A PRIMARY, DELIBERATELY. A rule the engine
       * enforces is a rule the player never has to choose to keep, and the
       * chapter's whole subject is a concession the Order chose to make. The
       * price of breaking it is measured in the header: eight Solarchs and 6 400
       * credits buys one head inside the grace, twice, and costs this row and the
       * silver medal.
       */
      id: 'concession',
      kind: 'secondary',
      title: 'Keep every Pact hull off the ground the Order signed away',
      credits: 500,
    },
    {
      /*
       * HIDDEN UNTIL THE FIRST COLUMN, which is `pact.04.in-the-clear`'s
       * argument for its own hidden row: the office is unreadable as an objective
       * until the player has seen a column come out of it. It also keeps the
       * panel at three active rows, which is `MAX_VISIBLE_OBJECTIVES`.
       *
       * "Take off them" rather than "Level", because `ownerCount(1, …, max: 0)`
       * counts a capture exactly as it counts a demolition and the title has to
       * mean what the trigger tests. `soviets.06.demolition-order` renamed its own
       * objective for the same reason on the same migration.
       */
      id: 'register',
      kind: 'secondary',
      hidden: true,
      title: 'Take the Ninth\'s allocation office off them',
      credits: 400,
    },
  ],

  triggers: [
    /* -- the opening word -------------------------------------------------
     * THREE BEATS, ONE SPEAKER EACH, TWELVE SECONDS APART, AND THE SPACING IS
     * FOR READING RATHER THAN AGAINST A MERGE. `Shell.playCampaignBeat` keys its
     * toast `campaign-${speaker}-${this.campaignBeatSeq}` with a monotonic
     * counter that is never reused, so nothing here would be destroyed by landing
     * on one tick — three paragraphs on adjacent ticks would simply be three
     * paragraphs nobody reads.
     *
     * The two reveals are `allies.01.sounding-line`'s shape: the whole problem
     * before any of it is a problem. **AND THE FIRST OF THEM IS THE ONLY
     * RENDERING OF THE PARCEL BOUNDARY THIS ENGINE CAN PRODUCE.** There is no UI
     * for a `Condition`'s disc; `revealArea` EXPLORES ground permanently, so a
     * reveal at exactly `PARCEL.r` draws the rim as a circle in the fog on the
     * first frame. It blurs as the player's own vision spreads, and that is
     * stated rather than hidden — the rim is legible when it is first explained
     * and remembered afterwards.
     */
    {
      id: 't.open',
      when: { on: 'elapsed', ticks: seconds(4) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Calvane',
          text: 'We were believed. That is the whole of the good news and I would sign for it '
            + 'again tomorrow. The rest of it is that the crust is common ground now, common '
            + 'ground has no tenants, and the Ninth has an allocation to sink two heads through '
            + 'the thinnest place on this coast — which is the place eleven families have been '
            + 'reading for us since before there was an Order to read for.',
        },
        { do: 'revealArea', player: 0, area: PARCEL },
        { do: 'revealArea', player: 0, area: { x: OFFICE.x, z: OFFICE.z, r: 30 } },
      ],
    },
    {
      id: 't.brief',
      when: { on: 'elapsed', ticks: seconds(16) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Nael',
          /*
           * THE TEN METRES ARE IN THE COPY BECAUSE THERE IS NOWHERE ELSE FOR
           * THEM. `ObjectiveRow` has no description field, a `Remembered`
           * structure carries no health bar, and the reticle draws the BLAST
           * radius rather than the safe one — so a player who is not told the
           * distance in words is never told it. Spelled, not a numeral, per
           * `tests/build-descriptions.spec.ts`'s convention.
           */
          text: 'Two heads, forty metres apart, with the hamlet sitting between them. We may not '
            + 'put a hull on that ground and we cannot reach it from off it, so the answer is the '
            + 'Heliograph and nothing else. Raise it now — it wants seven minutes a turn and we '
            + 'have time for exactly two. And when you aim, put the mark ten metres past the '
            + 'collar on the far side from the roofs. The mirror does not care what is standing '
            + 'under it.',
        },
      ],
    },
    {
      id: 't.tenant',
      when: { on: 'elapsed', ticks: seconds(28) },
      then: [
        {
          do: 'cameraMove', at: { x: PARCEL.x, z: PARCEL.z },
        },
        {
          do: 'dialogue',
          speaker: 'Hesk, of the pan',
          text: 'Hesk, for the pan. Eleven houses, a well and an infirmary, and one entry a day '
            + 'in your book for four hundred years. Nobody came out to ask us whether the ground '
            + 'we live on should stop being yours. I am not saying you were wrong. I am saying we '
            + 'are the ones standing in the middle of it.',
        },
      ],
    },
    /*
     * THE ONE THING A TRIGGER CANNOT SEE, SAID ON AN UNCONDITIONAL ONE.
     *
     * Nothing in the frozen vocabulary can ask whether the player has built a
     * structure, so the queue deadline cannot be a condition and must not be a
     * beat behind an optional row — `soviets.08.carriage-forward` shipped
     * exactly that mistake. This fires at two and a half minutes whatever the
     * player has done, which costs a line to somebody who already raised it and
     * saves the operation for somebody who did not.
     *
     * **THE HOUR AND THE WORDING BOTH MOVED, AND THE OLD PAIR WAS WRONG IN THE
     * LOSING DIRECTION.** It fired at four minutes and said "on the ground by
     * half past four"; the real queue deadline is 4:22, so the line was eight
     * seconds past it. See THE PAR IS THE NOTICE in the header for the round
     * trip. "Before the fourth minute is out" is twenty-two seconds inside the
     * floor, and the beat now lands ninety seconds ahead of that so the player
     * has room to act on it rather than to read it. **Two and a half minutes,
     * not three**: `t.first` is `WAVE_A` = three minutes and Nael speaks there
     * too, and two paragraphs from one speaker on one tick is a pacing fault
     * even now that `Shell.campaignBeatSeq` stops them destroying each other.
     */
    {
      id: 't.clock',
      when: { on: 'elapsed', ticks: seconds(150) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Nael',
          text: 'Mirror check. Seven minutes a turn and two heads down there, so it wants to be '
            + 'on the ground before the fourth minute is out. After that it only turns once '
            + 'before the hour and one of those collars keeps cutting.',
        },
      ],
    },

    /* -- the four columns -------------------------------------------------
     * ONE TAG FOR ALL FOUR, WHICH IS A CHOICE AND NOT A SHORTCUT. `orderTagged`
     * re-points the survivors of every earlier wave as well, which is what a
     * commander does — and it is the honest spelling, because the order does NOT
     * survive the first brain pass: `AI_CADENCE.squad` is `round(30 / 5)` = 6
     * ticks and `AiBrain.regroupSquads` re-files every ungrouped hull into the
     * strike group and attack-moves it at the brain's OWN objective. The columns
     * still tend to arrive, because the brain's standing objective is the
     * player's base and that is where they are pointed. **Do not build a timing
     * argument on an order an AI seat holds.**
     *
     * The camera move is spent on the PARCEL at twenty-eight seconds rather than
     * here, which is the opposite call from `pact.04.in-the-clear` and
     * `pact.05.open-count`. Both of those spend it on the first column because
     * their hidden secondary is unreadable until the player has seen where the
     * columns form. This operation's subject is three occupied buildings the
     * player will be firing a superweapon next to, and a player who has not
     * looked at them cannot make the only decision the file is built around.
     */
    {
      id: 't.first',
      when: { on: 'elapsed', ticks: WAVE_A },
      then: [
        {
          do: 'dialogue',
          speaker: 'Nael',
          text: 'Armour off their allocation office, and it is not coming to the parcel. It is '
            + 'coming to us — they know what we are building and they know how long it takes.',
        },
        { do: 'revealArea', player: 0, area: { x: ROAD.x, z: ROAD.z, r: 40 } },
        { do: 'spawnUnits', player: 1, key: 'rhino', count: 4, at: ROAD, spread: 14, tag: 'column' },
        { do: 'orderTagged', tag: 'column', order: 'attackMove', at: HOME },
        { do: 'setObjective', id: 'register' },
      ],
    },
    {
      id: 't.second',
      when: { on: 'elapsed', ticks: WAVE_B },
      then: [
        {
          do: 'dialogue',
          speaker: 'Tolvar, Ninth Allocation',
          text: 'Tolvar, Ninth. I have read your count, Calvane, and I believe it — that is why '
            + 'I am here. You published the depth at which a cut works best and then acted '
            + 'surprised that somebody sank one. The parcel is allocated. Your quarrel is with '
            + 'the register, not with me.',
        },
        { do: 'spawnUnits', player: 1, key: 'rhino', count: 4, at: ROAD, spread: 14, tag: 'column' },
        { do: 'spawnUnits', player: 1, key: 'conscript', count: 5, at: ROAD, spread: 22, tag: 'column' },
        { do: 'orderTagged', tag: 'column', order: 'attackMove', at: HOME },
      ],
    },
    {
      id: 't.third',
      when: { on: 'elapsed', ticks: WAVE_C },
      then: [
        {
          do: 'dialogue',
          speaker: 'Nael',
          text: 'Armour first and the men half a minute behind it, same as the last one. '
            + 'The tanks are what you answer; the men are what walks into whatever you have left '
            + 'standing afterwards.',
        },
        { do: 'spawnUnits', player: 1, key: 'rhino', count: 5, at: ROAD, spread: 18, tag: 'column' },
        { do: 'spawnUnits', player: 1, key: 'conscript', count: 5, at: ROAD, spread: 22, tag: 'column' },
        { do: 'orderTagged', tag: 'column', order: 'attackMove', at: HOME },
      ],
    },
    {
      /*
       * GATED ON THE OFFICE STILL STANDING, which is what gives the 400-credit
       * secondary teeth beyond its payout: taking it off them deletes eleven
       * hulls three and a half minutes before the hour. It cannot collide with
       * `t.register` below — that trigger requires `ownerCount(1, …, max: 0)` and
       * this one requires `min: 1`, so the two are disjoint on every tick.
       */
      id: 't.fourth',
      when: {
        on: 'all',
        of: [
          { on: 'elapsed', ticks: WAVE_D },
          { on: 'ownerCount', player: 1, role: 'building', tag: 'register', min: 1 },
        ],
      },
      then: [
        {
          do: 'dialogue',
          speaker: 'Tolvar, Ninth Allocation',
          text: 'Everything the office had on its books. If the heads are going to come down I '
            + 'would rather they came down with your mirror already melted, so that the record '
            + 'reads weather and not policy.',
        },
        { do: 'spawnUnits', player: 1, key: 'rhino', count: 5, at: ROAD, spread: 18, tag: 'column' },
        { do: 'spawnUnits', player: 1, key: 'conscript', count: 6, at: ROAD, spread: 26, tag: 'column' },
        { do: 'orderTagged', tag: 'column', order: 'attackMove', at: HOME },
      ],
    },

    /* -- the parcel, taught before it is charged for -----------------------
     * THE WARNING AT THREE SECONDS AND THE FAILURE AT TEN, SO A STRAY HULL HAS
     * SEVEN SECONDS TO BE RECALLED. `elapsedSinceArmed` is the hold timer and the
     * Director evaluates both of these twice for it: pass one forces the timer
     * true and asks whether a Pact unit is inside, which sets or clears the arm
     * tick; pass two compares against that tick. So the clock restarts the moment
     * the last hull leaves, which is what makes a crossing free and an OCCUPATION
     * expensive — and it is what a raid has to beat. See the parcel block in the
     * header for what beating it costs.
     */
    {
      id: 't.trespass',
      when: { on: 'all', of: [TRESPASS, { on: 'elapsedSinceArmed', ticks: seconds(3) }] },
      then: [
        {
          do: 'dialogue',
          speaker: 'Nael',
          text: 'We have somebody on the parcel. Off it — that ground stopped being ours the day '
            + 'the count went out, and the count is only true because it did.',
        },
      ],
    },
    {
      id: 't.concessionLost',
      when: { on: 'all', of: [TRESPASS, { on: 'elapsedSinceArmed', ticks: seconds(10) }] },
      then: [
        { do: 'failObjective', id: 'concession' },
        {
          do: 'dialogue',
          speaker: 'Calvane',
          text: 'Then we are standing on it, and every yard on this coast can say the Order gave '
            + 'the crust away and took it back the week the paperwork dried. Finish the job. We '
            + 'will pay for this part later and we will pay for it properly.',
        },
      ],
    },

    /* -- the mirror, and what it costs -------------------------------------
     * THE LOSS SITS ABOVE THE WARNING ON PURPOSE. `runDirector` returns the
     * moment an outcome is set, so putting `t.hamletLost` first means a tick
     * that both singes and kills the terrace reports only the death — and,
     * equally, that a tick on which the second collar dies and the terrace dies
     * together does not first tell the player "both collars are glass" and then
     * that they lost. That inversion was reachable: `t.heads` used to sit above
     * `t.hamletLost` in this table, so the two centred blasts that complete the
     * primary and end the hamlet landed a congratulation one line before a
     * defeat.
     */
    {
      id: 't.hamletLost',
      when: { on: 'all', of: [SETTLE, HAMLET_LOST] },
      then: [
        { do: 'eva', line: 'structureLost' },
        { do: 'failObjective', id: 'hamlet' },
        {
          do: 'dialogue',
          speaker: 'Hesk, of the pan',
          text: 'You put it on the roofs. Four hundred years of our readings are in your book '
            + 'and the people who took them are under ours.',
        },
        {
          do: 'dialogue',
          speaker: 'Calvane',
          text: 'Stop the mirror. Whatever is left of that allocation, the Ninth can have it — '
            + 'there is nothing down there now that the count was ever for.',
        },
        { do: 'endOperation', result: 'loss', reason: 'hamlet' },
      ],
    },
    /*
     * `entityHpBelow` READS THE WEAKEST OF THE TAGGED SET, which is why the three
     * holdings carry a shared `hamlet` tag as well as their own.
     *
     * **0.70 IS THE RIM FLOOR AND NOT A JUDGEMENT, AND THE 0.5 THIS SHIPPED WITH
     * LET FOUR FATAL OPENINGS PAST IN SILENCE.** `nukeSplashFalloff` 0.22 is a
     * FLOOR rather than a taper, so any blast that touches the terrace takes at
     * least `1400 * 0.22 * 1.00 * 0.80` = 246.40 off it and leaves it at at most
     * 0.6920, while a blast that misses the ring leaves it at exactly 1.0. There
     * is no state in between, so 0.70 fires when and only when a blast has
     * reached the roofs. At 0.5 the four openings A@4, A@6, A@8 and B@6 — each
     * followed by the other collar centred — reached the instant defeat with this
     * line never firing, because one blast at those offsets leaves the terrace at
     * 0.5747 / 0.6311 / 0.6723 / 0.5621. The header's hamlet block carries the
     * whole measured table.
     *
     * **`HEADS_STAND` IS WHAT LETS THE THRESHOLD BE THE RIM FLOOR.** The old 0.5
     * was set below the correct play's residue — two blasts ten metres out end
     * the terrace at 0.6656 — so that Hesk would not warn about a second turn
     * that no longer existed. Asking whether a collar is still theirs says that
     * properly and says it in the vocabulary: the line can fire while a turn
     * remains and cannot fire once both heads are off. A first shot placed
     * correctly on head A costs the terrace nothing at all (0.00 damage past
     * 9.951 m), so the ideal line is silent from both ends.
     *
     * It fires ONCE — the teaching moment, not a running commentary — and the
     * copy states the GEOMETRY rather than predicting the outcome, because it can
     * now fire after a first shot that was placed correctly on head B (267.5,
     * 0.6656) where a second centred shot would in fact leave the terrace
     * standing. "The roofs are inside your circle" is true in every case that
     * reaches this trigger; "the second one is what finishes them" was not.
     */
    {
      id: 't.singed',
      when: {
        on: 'all',
        of: [SETTLE, HEADS_STAND, { on: 'entityHpBelow', tag: 'hamlet', frac: 0.70 }],
      },
      then: [
        {
          do: 'dialogue',
          speaker: 'Hesk, of the pan',
          text: 'That one reached the terrace. I am not going to tell you not to turn it again — '
            + 'I have seen what the heads do. I am telling you the roofs are inside your circle, '
            + 'and there is one more turn to come.',
        },
      ],
    },
    {
      /*
       * `not HAMLET_LOST` IS NOT DECORATION, AND SITTING BELOW `t.hamletLost`
       * WOULD NOT HAVE DONE IT.
       *
       * `runDirector` returns early only on a tick that STARTS resolved;
       * `CampaignSession.simTick` then applies the whole effect list with no
       * exit, so within ONE tick file order settles only which `endOperation`
       * lands first — `allies.08.standing-order` states this and corrects
       * `allies.07.fair-copy` for getting it wrong. The two centred blasts that
       * end the hamlet also take the second collar, so without this clause the
       * defeat tick still pushed `completeObjective('heads')` and Calvane's
       * "Both collars are glass" onto the same list as "you put it on the
       * roofs". Driven through the real `runDirector`, the old table emitted
       * `done:heads` FIRST and the loss after it; moving `t.hamletLost` up
       * reversed the pair and this clause deletes the second half.
       */
      id: 't.heads',
      when: { on: 'all', of: [HEADS_OFF, { on: 'not', of: HAMLET_LOST }] },
      then: [
        { do: 'completeObjective', id: 'heads' },
        {
          do: 'dialogue',
          speaker: 'Calvane',
          text: 'Both collars are glass. The allocation is for a working cut and there is no cut '
            + 'to work, so at the hour it lapses and the parcel goes back on the register for '
            + 'somebody to survey again. That is all we bought. It is enough.',
        },
      ],
    },

    /* -- the paid secondaries, resolved above the win ----------------------
     * `runDirector` returns immediately once an outcome is set, so a completion
     * written below `t.win` never fires and the medal never counts it —
     * `medalFor` gives silver only when EVERY secondary is complete.
     */
    {
      id: 't.register',
      when: {
        on: 'all',
        of: [SETTLE, { on: 'ownerCount', player: 1, role: 'building', tag: 'register', max: 0 }],
      },
      then: [
        { do: 'completeObjective', id: 'register' },
        {
          do: 'dialogue',
          speaker: 'Calvane',
          text: 'The allocation book is ours. Enter the eleven houses on it before you hand it '
            + 'back — whoever ends up holding this parcel is going to find they owe rent on it, '
            + 'and that is the only thing we can still give the pan.',
        },
      ],
    },
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
        of: [
          { on: 'elapsed', ticks: NOTICE },
          { on: 'not', of: { on: 'objectiveFailed', id: 'concession' } },
        ],
      },
      then: [
        { do: 'completeObjective', id: 'concession' },
        {
          do: 'dialogue',
          speaker: 'Nael',
          text: 'Nineteen minutes and not one boot of ours on their ground. Whatever anybody '
            + 'says about today, they cannot say the Order took it back.',
        },
      ],
    },

    /* -- the late loss, above the win ---------------------------------------
     * `t.late` and `t.win` are disjoint by construction rather than by ordering:
     * one requires `ownerCount(1, 'building', 'head', min: 1)` and the other
     * `max: 0`, over an integer count, so no tick can satisfy both. The ordering
     * still matters for the reader — an author is meant to mean which of two
     * outcomes a coinciding tick reports.
     *
     * The OTHER loss, `t.hamletLost`, is deliberately far above this, ahead of
     * `t.heads` and `t.singed`; its own block says why.
     */
    {
      id: 't.late',
      when: { on: 'all', of: [{ on: 'elapsed', ticks: NOTICE }, HEADS_STAND] },
      then: [
        { do: 'failObjective', id: 'heads' },
        {
          do: 'dialogue',
          speaker: 'Tolvar, Ninth Allocation',
          text: 'The hour is up and both heads are turning, so the allocation stands and the '
            + 'parcel is worked ground. I did not want the pan cleared, Calvane. I wanted the '
            + 'cut. The pan is what a cut through crust that thin does.',
        },
        { do: 'endOperation', result: 'loss', reason: 'heads' },
      ],
    },

    /* -- the hour ---------------------------------------------------------- */
    {
      id: 't.win',
      when: { on: 'all', of: [{ on: 'elapsed', ticks: NOTICE }, HEADS_OFF] },
      then: [
        { do: 'completeObjective', id: 'hamlet' },
        {
          do: 'dialogue',
          speaker: 'Calvane',
          text: 'The hour has gone and there is nothing on that parcel to work, so the '
            + 'allocation lapses and the ground goes back to being everybody\'s. Which is what we '
            + 'asked for. Log it exactly like that, and log underneath it that everybody does not '
            + 'yet include the eleven houses standing in the middle of it.',
        },
        {
          do: 'dialogue',
          speaker: 'Hesk, of the pan',
          text: 'We will take the roofs. Send somebody out next time before you sign, and we '
            + 'will keep taking your reading.',
        },
        { do: 'endOperation', result: 'win' },
      ],
    },

    /* -- the other loss ----------------------------------------------------
     * `playerBeaten` is `Viability.isBeaten` — nothing to build with and nothing
     * to fight with — not "you have no buildings". The player opens with a full
     * base, so the two readings agree for most of the match; they stop agreeing
     * at exactly the moment it matters, which is a commander down to a
     * Chapterhouse and a Heliograph who can still let the clock run to the hour.
     */
    {
      id: 't.lose',
      when: { on: 'playerBeaten', player: 0 },
      then: [{ do: 'endOperation', result: 'loss', reason: 'heads' }],
    },
  ],
};

export default op;
