/**
 * ============================================================================
 * R5 — CLOSING ENTRY
 * ============================================================================
 * R4's requisition was never filed, because the register it had to be entered
 * in went off the siding at Survey 58-273. That does not settle anything. It
 * leaves the Reclamation's own book as the only surviving record of what every
 * army on this continent bought, sold and still owes for — the Soviets' written
 * off field, the Allies' twice-sold pan, nine breaking yards and eleven months
 * of delivery notes nobody read. The chapter has been calling that "the only
 * complete account" since its first line. This is the week it becomes literally
 * true, and the week somebody comes for it.
 *
 * The Meridian Pact has bid for the account entire. Tallow has not answered.
 * Calvane's objection is not commercial and he says so: one book in one hand
 * with no second copy anywhere is not a record, it is an assertion. He is right,
 * and being right is what he has instead of a receipt.
 *
 * ============================================================================
 * THE PRIMARY IS TWO NUMBERS, AND THE SECOND ONE IS THE WHOLE OPERATION
 * ============================================================================
 * `defend` is the shape and holding a building for seventeen minutes is not the
 * idea. The idea is the second primary: **`credits: { player: 0, min: 12000 }`,
 * read ONCE, at the close.** Everything spent keeping the account comes off what
 * the account is worth, so the operation is not "survive" — it is "survive
 * without spending more than the thing is worth", which is the one sentence this
 * faction has been saying for four operations.
 *
 * **IT IS NOT `reclamation.02.written-off`'s PRIMARY WITH A DIFFERENT NUMBER,
 * AND THE DIFFERENCE IS TEMPORAL RATHER THAN NUMERIC.** R2's `credits` fires the
 * INSTANT the bar is crossed and ends the match there; a player who touches
 * sixteen thousand for one tick has won. This one is evaluated at exactly one
 * tick — `elapsed(CLOSE)` — and every credit spent before then is gone from it.
 * Same condition, opposite reading: R2 measures a peak, this measures a
 * BALANCE. That is why R2 is `primaryType: 'economy'` and this is `'defend'`.
 *
 * **AND IT IS A PRIMARY RATHER THAN A SECONDARY, WHICH IS THE RISK THIS FILE
 * TAKES.** A player who holds the house and finishes two hundred credits short
 * LOSES a seventeen-minute operation. Three things make that fair and all three
 * are mechanical rather than hoped for: `t.orders` says the number at t+16 s;
 * `t.callShort` and `t.callClear` give a LIVE reading of which side of it the
 * player is on at minute fifteen, so nobody discovers it at the close; and there
 * is an in-game route back that does not depend on the clock — see the sell block
 * below.
 *
 * ============================================================================
 * WHERE TWELVE THOUSAND COMES FROM, DERIVED RATHER THAN PICKED
 * ============================================================================
 * **THE CEILING BOUNDS WHAT YOU CAN HOLD FROM MINING AND NOTHING ELSE, AND AN
 * EARLIER VERSION OF THIS BLOCK SET THE BAR AGAINST THE WRONG QUANTITY.**
 * `Economy`'s cap is `capFloor + structural`; `capFloor` starts at
 * `STORAGE_BASE` = `max(BASE_STORAGE 1000, START_CREDITS 10000)` = **10 000 for
 * every player whatever the opening bank is** (this operation's is 5000).
 * Structural storage, measured off the built world through the bound def rows
 * and the real `Production.storageForSlot`: three `rclSorter` at
 * `REFINERY_STORAGE` 2000 and two `rclHeap` at `SILO_STORAGE` 1500 = **9000**,
 * and `PlayerState.storageMax` reads **19 000** after the first
 * `recomputeStorage`. So:
 *
 *     everything standing                       ceiling 19 000  (measured)
 *     both outlying Ore Sorters gone            ceiling 15 000  (measured)
 *     the bar                                          12 000
 *
 * Those two ARE ceilings on harvested income: `Economy.deposit` wastes
 * everything over the cap and never lifts the floor. **They are not ceilings on
 * the BANK, and this file claimed they were.** `Economy.refund` calls
 * `liftFloorFor`, and `recomputeStorage`'s no-shrink branch does the same job,
 * so any ungated credit arriving above the cap raises `capFloor` to the WHOLE
 * balance. Measured in a real `Economy` driven through the real
 * `Production.applySell`, from the both-yards-gone state filled to its 15 000:
 * **one 240-credit Scrap Furnace sold takes the ceiling to 20 120**, and
 * liquidating every non-storage structure on the lot reaches **20 475 against a
 * 25 135 ceiling**.
 *
 * **SO SIXTEEN THOUSAND WAS NOT REFUSED BY THE ARITHMETIC, AND THIS BLOCK USED
 * TO SAY IT WAS** — *"losing both yards would have made the operation
 * unwinnable rather than expensive … that is the arithmetic that killed the
 * prettier number"*. It is measurably false: 16 000 is reachable in that state,
 * for the price of the cheapest structure on the lot. What is true is narrower,
 * and it is the reason 12 000 stands anyway. At 12 000 a player who has lost
 * both outlying yards can still make the number **by mining**, with 3000 of
 * room under a 15 000 ceiling. At 16 000 they could only make it by breaking up
 * the plant — and an escape hatch that is the ONLY route out of a state the
 * operation deliberately invites is not an escape hatch, it is a second
 * objective nobody was told about. **The bar is set so that the sell block below
 * stays optional.** That is a judgement about what the operation is for, and it
 * is written as one rather than dressed as an impossibility.
 *
 * **THE FIELD IS NOT THE CONSTRAINT, AND THAT IS MEASURED NOW RATHER THAN
 * ASSERTED** — it is the one number `reclamation-closing-entry.ts` declared
 * unmeasured, and this closes it. Seeded through the real `OreField.seedField`
 * with `economy.system.ts`'s own accept function, over a real `RoadNetwork` at
 * this operation's `mapSeed`: five fields, 462 cells, **94 980 credits on the
 * ground** — 19 672 on the player's home field, 14 108 and 18 095 beside Number
 * Two and Number Six, 14 195 on the contested patch and 28 910 on the Pact's.
 * **51 875 of that is private to the player** before the contested patch is
 * touched, against 35 700 of gross income over seventeen minutes at the
 * harvester band `tests/harvester-soak.spec.ts` establishes — 429 to 700 credits
 * per harvester per minute, midpoint 525, four Scrapjaws = 2100 a minute. The
 * ore outlasts the clock by half again on the player's own fields alone. What a
 * player can actually lose here is the difference between that income and what
 * they spent, and the spending is the operation.
 *
 * ============================================================================
 * WHAT THE BAR ACTUALLY REFUSES — A FLOOR, NOT A KNIFE EDGE
 * ============================================================================
 * **THIS FILE CALLED 12 000 "hard, and reachable", AND ITS OWN INCOME FIGURE
 * CONTRADICTS THAT.** 5000 of opening bank plus 35 700 of gross against a
 * 12 000 bar is **28 700 credits of spending** — and only for a player who
 * paces it, because every credit mined into a full box is thrown away by
 * `deposit` and never reaches the bar. (The neighbouring claim that the trade
 * is "the same number twice" is TRUE and stays: every credit spent really is
 * subtracted from the number the player is judged on. What was wrong is the
 * tightness that sentence was being read to imply.)
 *
 * Against that, what the ground demands, derived from the shipped rows rather
 * than estimated. `pylonArc` is 94 Tesla on a 2.2 s cycle carrying `chainCount`
 * 3, against `COMBAT_WEAPONS.teslaChainRange` 9.0 and `teslaChainFalloff` 0.6,
 * all through `COMBAT_DAMAGE.globalMul` 0.80:
 *
 *     vs mrdWayfarer  110 hp Infantry x1.60   120.3 primary, then 72.2 / 43.3
 *                                             / 26.0 = 261.8 into a clump of 4
 *     vs Solarch/Skiff     Light     x0.95     71.4 primary, then 42.9 / 25.7
 *                                             / 15.4 = 155.4 into a clump of 4
 *
 * **ONE BOLT KILLS A WAYFARER OUTRIGHT** (120.3 against 110), and three bolts —
 * 4.4 s of cycle — clear the four-man half of both early workings from a SINGLE
 * Arc Pylon. The minute-eleven working is 1560 hp of Light (3 x 190 + 3 x 330);
 * two more Pylons at 70.7 dps into a clump, plus the three `rclSpitpost` the
 * player already owns (`postCoil` 34 Tesla, `chainCount` 1, 0.85 s = 48.6 dps
 * into a pair, x3), is **287.2 dps and 5.4 s**. That defence costs **4820
 * credits**: two Pylons 2900, the one Scrap Furnace their -180 of grid needs
 * against a measured net of +160 (240), and four more Spitposts (1680).
 *
 * **SO THE SLACK IS ROUGHLY FOUR TO ONE, AND THE FILE SAYS SO RATHER THAN
 * ASSERTING A SQUEEZE ITS OWN NUMBERS DENY.** 12 000 is a FLOOR that refuses
 * gross over-building. What it catches is the player who fortifies all three
 * lots to that standard — six Pylons, six Spitposts, the four Furnaces the grid
 * then needs, a Patch Yard and eight Grinders in reserve is **15 070 before a
 * single replacement** — and then loses the two outlying yards' income on top.
 * A player who prices Number Six and gives it up is never near it. **The
 * decision the primary forces is WHICH LOTS, not whether to spend at all**, and
 * that is the operation either way.
 *
 * ============================================================================
 * WHAT IT COSTS TO KEEP, PRICED PER LOT
 * ============================================================================
 * Three player structures sit forward of the yard at graded distances, and the
 * grading is the decision. Measured on the built world (see THE MEASURED POINTS
 * below); every dps is `WEAPONS` through `ARMOR_MATRIX` at
 * `COMBAT_DAMAGE.globalMul` 0.80, against `ArmorClass.Concrete` (index 4), which
 * is what all three wear:
 *
 *     lot              from your yard   from theirs   what it is
 *     Number Two          76.03 m        324.75 m     rclSorter, 1250 hp
 *     the counting house 112.87 m        276.27 m     civApartments, 800 hp
 *     Number Six         212.01 m        180.28 m     rclSorter, 1250 hp
 *
 * **NUMBER SIX IS NEARER THE PACT THAN IT IS TO YOU AND NOTHING CAN CHANGE
 * THAT** — 31.73 m nearer their Conclave than your Foundry, on a map where both
 * openings are fixed by `SKIRMISH_START_OFFSETS` — so it is the lot the
 * operation exists to let you give up. Number Two is 80 m out and inside the
 * reach of everything you own; the house is the primary and is not negotiable.
 * **One free, one bought, one for sale.**
 *
 * The columns, derived from the shipped rows:
 *
 *     focusLance    (mrdSolarch)  60 / 1.60 s  ArmorPiercing x0.55   16.50 dps
 *     arcRepeater   (mrdSkiff)    4x13 / 0.76 s AutoCannon   x0.35   19.16
 *     pulseCarbine  (mrdWayfarer) 3x15 / 0.96 s SmallArms    x0.18    6.75
 *
 *     minute three   4 Wayfarer + 2 Solarch    60.0 dps -> Number Six's 1250 hp
 *                                                          in 20.8 s
 *     minute seven   4 Wayfarer + 3 Solarch    76.5 dps -> the house's 800 hp
 *                                                          in 10.5 s
 *     minute eleven  3 Skiff    + 3 Solarch   107.0 dps -> the house in 7.5 s
 *
 * **THE COUNTING HOUSE IS NOT A TOUGH BUILDING AND IS NOT MEANT TO BE.** Ten and
 * a half seconds of uninterrupted fire from the minute-seven working takes it,
 * and the working forms 192.0 m away — 25.3 s of driving for a Solarch at
 * 7.6 m/s and 50.5 s of walking for a Wayfarer at 3.8, so it arrives strung out
 * and it arrives on a schedule the player knows. The house survives because
 * money was spent on the lot it stands on, and that money is subtracted from the
 * other primary. **That is the whole trade and it is the same number twice.**
 *
 * What the money buys, at the shipped costs: `rclSpitpost` 420 and `power: 0`,
 * `rclPylon` 1450 and **-90 power**, `rclDepot` 800, `rclGrinder` 600,
 * `rclSpitter` 420, `rclFurnace` 240 for +80. Measured, the player opens at
 * **produced 480 / consumed 320, net +160** — which is one more Arc Pylon and
 * nothing else before a Furnace has to go up first. The two outlying yards carry
 * 100 of that 160 between them (each is a `rclFurnace` +80 against an
 * `rclSorter` -30), so a player who lets both go is at +60 and one Pylon from a
 * brownout. **The grid is a third currency and it moves with the same decision.**
 *
 * ============================================================================
 * THE WAY OUT IS TO BREAK UP THE YARD, AND WHAT IT PAYS DEPENDS ON WHAT YOU ARE
 * ALREADY HOLDING
 * ============================================================================
 * `Production.applySell` refunds `round(cost * SELL_REFUND 0.5)`, so at minute
 * fifteen a player who is short can sell:
 *
 *     rclSorter   2000 -> 1000     rclPylon    1450 -> 725
 *     rclSpotter  1000 ->  500     rclSpitpost  420 -> 210
 *     rclFurnace   240 ->  120     rclHeap      150 ->  75
 *
 * **A SALE THAT CARRIES STORAGE IS WORTH LESS THE FULLER THE BOX IS, NOTHING ON
 * SCREEN SAYS SO, AND THIS FILE PRICED IT AS A FLAT +1000.** `applySell` hands
 * the refund over through `Production.grant`, which is a bare `p.credits +=
 * amount` and does NOT route through `Economy.refund` — so `liftFloorFor` never
 * runs. The next `recomputeStorage` (every `POWER_RECOMPUTE_INTERVAL` = 5 ticks)
 * sees `structural` SHRINK, therefore refuses to raise `capFloor` — that refusal
 * is the whole purpose of the branch and it is correct — and clamps the balance
 * into the new, smaller ceiling, marking the difference `CreditReason.Waste`.
 *
 * Swept in a real `Economy` driven through the real `applySell`, everything
 * standing so the cap is 19 000 in every row:
 *
 *     balance at the sale    11 000  12 000  15 000  16 000  17 000  18 000  19 000
 *     Ore Sorter    -2000     +1000   +1000   +1000   +1000      +0   -1000   -2000
 *     Slag Heap     -1500       +75     +75     +75     +75     +75    -500   -1500
 *     Arc Pylon    no store     +725    +725    +725    +725    +725    +725    +725
 *     Spitpost     no store     +210    +210    +210    +210    +210    +210    +210
 *     Scrap Furnace no store    +120    +120    +120    +120    +120    +120    +120
 *
 * A Sorter pays its full thousand while the balance is at or under
 * `cap - 3000` = **16 000**, breaks even at 17 000 and costs **2000** at the
 * ceiling; a Heap breaks even at 17 500. **Nothing without storage ever
 * inverts** — at the ceiling those three RATCHET it instead (19 000 -> 28 725 on
 * the Pylon), which is `liftFloorFor` doing exactly what it exists for.
 *
 * **`t.callShort` IS GATED ON BEING SHORT AND THAT IS WHAT KEEPS ITS ADVICE
 * TRUE.** It fires only under 12 000 — 4000 credits below the balance at which a
 * Sorter sale loses anything at all — so the line cannot mislead anybody in any
 * state it can reach, measured rather than reasoned. It names the **Pylon** as
 * the sale anyway, because the Pylon is the one that is right at every balance,
 * hands ninety of grid back with the credits, and costs no dock and no haul.
 * `t.callClear` tells a player who is already clear to STOP spending and never
 * tells them to sell, which is the other half of not walking anybody into the
 * inverted end of that table.
 *
 * **AND THE COUNTING HOUSE CANNOT BE SOLD, WHICH IS THE HALF THAT MAKES IT A
 * DESIGN RATHER THAN A HOLE.** `Scenarios.civilian()` composes its flag set as
 * `STRUCTURE & ~EntityFlag.Sellable` and the `civApartments` DEF row sets no
 * flags of its own, so `spawnBuilding`'s `fb.flags | (def?.flags ?? 0)` never
 * puts the bit back. **The plant is for sale and the account is not** — which is
 * the sentence Tallow has been running this company on since R1, expressed in
 * one flag bit rather than in dialogue.
 *
 * **THE WHOLE HATCH IS WORTH 7350 CREDITS, NOT THE 8850 THE COSTS ADD UP TO.**
 * Measured by greedily liquidating seat 0's entire opening from a zero bank in a
 * real `Economy`: 17 700 of sellable plant refunds 8850 on paper, and
 * `sellWouldStrand` refuses **exactly one** structure — the Foundry, the last
 * thing that can build — so the collectable figure is 7350 and what is left
 * standing is the Foundry and the unsellable counting house. That is the honest
 * size of the escape hatch and it is why the bar is set where a player never has
 * to reach for it.
 *
 * Selling an outlying Sorter is therefore a REAL move with a REAL price: +1000
 * in hand at any balance up to 16 000, -2000 of ceiling, one dock and one
 * hauler's short haul gone, and `t.yardLost` fires exactly as it would if the
 * Pact had levelled it — because `ownerCount` cannot tell a sale from a
 * demolition and, for this operation, should not. Cregg's line reads correctly
 * either way and says so on purpose.
 *
 * ============================================================================
 * THE HIDDEN SECONDARY IS THE CHAPTER'S OWN TITLE, AND IT IS TRAP 9 AVOIDED
 * ============================================================================
 * The Pact keeps a second book. `t.bid` reveals the forward assay at minute
 * four — a `mrdOculus` at 650 hp with two `mrdGlaive` on it — and taking it off
 * them makes "the only complete account" true in world state rather than in
 * prose.
 *
 * **IT IS `ownerCount(1, 'building', 'tally', max: 0)` BEHIND A SETTLE GUARD,
 * NEVER `entityDead`.** `entityDead` is `aliveWithTag === 0` and a CAPTURED
 * structure is still alive, so on an enemy-owned building it is capture-blind:
 * a Tinker walked into the assay would leave a 700-credit secondary permanently
 * uncollectable. Six shipped operations had that defect and
 * `soviets.06.demolition-order` is the worked example of the fix. The title
 * moved with the condition — "take off them", not "destroy" — because the rule
 * no longer requires the one route the old wording named.
 *
 * **THE CAPTURE ROUTE IS AVAILABLE, IT IS THE WRONG ANSWER, AND THIS FILE DOES
 * NOT PRETEND OTHERWISE.** `Capture.resolve` sends an enemy structure above
 * `CAPTURE.captureHpFrac` 0.5 through the SOFTEN branch, which lands
 * `maxHp * CAPTURE.softenFrac 0.25` through `ARMOR_MATRIX[HighExplosive]
 * [Concrete]` 1.00 and `globalMul` 0.80 = 0.20 of max and spends the engineer.
 * On 650 hp that is 650 -> 520 -> 390 -> 260 and the FOURTH Tinker takes it:
 * **2000 credits of Tinker against a 700-credit payout, on an operation whose
 * other primary is the bank.** Demolition is the sane route and the arithmetic
 * says so; what `ownerCount` buys is that a player who does it the expensive way
 * anyway is not told the objective has become unreachable.
 *
 * **THE RAID IS THE SECOND DECISION AND IT IS PRICED IN THE SAME CURRENCY AS THE
 * FIRST.** The assay stands 185.44 m from the counting house and 277.95 m from
 * the yard, so a detachment is off the lot for a round trip of 370.88 m —
 * **42.1 s at an Arcspitter's 8.8 m/s, 63.9 s at a Grinder's 5.8** — plus the
 * shooting. Derived against `mrdOculus`'s 650 hp of Concrete:
 *
 *     grinderArc  70 / 1.90 s  Tesla x0.60   17.68 dps   x4 = 70.74 -> 9.19 s
 *     spitCoil    30 / 0.95 s  Tesla x0.60   15.16       x4 = 60.63 -> 10.72 s
 *     the opening escort, 4 Grinders + 2 Arcspitters      101.06 -> 6.43 s
 *
 * **SEND HULLS AND NOT MEN, AND THE GUARDS ARE WHY.** `glaiveRepeater` is
 * 5 x 12 on a `(5-1) * 0.06 + 0.55` = 0.79 s cycle = 75.95 raw. Against
 * `ArmorClass.Infantry` that is x1.00 x 0.80 = 60.76 delivered EACH, so the pair
 * kills an 85 hp Scrap Picker in **0.70 s**; against `ArmorClass.Medium` it is
 * x0.28 x 0.80 = 17.01 each, so the pair needs **7.94 s** for a 270 hp Grinder.
 * `mrdGlaive`'s own blurb is "Anti-infantry repeater", so the operation does not
 * spell the arithmetic out — Cregg says "send hulls" and the cameo says why.
 *
 * ============================================================================
 * `captureProof` ON THE PLAYER'S OWN STRUCTURES, AND THE ENGINEER IS REAL
 * ============================================================================
 * `captureProof: ['house', 'ledger']`. Every threshold in this file counts what
 * SEAT 0 owns, so a captured counting house reads as a lost one and ends the
 * operation in a defeat on the tick it changes hands — the protect-target case
 * `types.ts` names, where migrating the trigger to `ownerCount` makes a LOSS
 * reachable by capture rather than fixing anything.
 *
 * **IT IS NOT A WELL-SPELLED NO-OP, AND THE MEASUREMENT IS THE REASON.** Seat 1
 * opens holding one `mrdArtificer` — counted on the built world — so the
 * engineer exists on this map, and the brain can now issue a real escorted
 * `OrderKind.Capture`. `captureProof` is therefore load-bearing: it keeps the
 * primary independent of AI ownership tactics.
 *
 * The assay is deliberately NOT in the list: it is the one structure this
 * operation wants taken, by either route.
 *
 * ============================================================================
 * NOT ONE `entity*` CONDITION IN THE FILE, AND THAT IS DELIBERATE
 * ============================================================================
 * Every threshold here is `ownerCount`, `credits`, `elapsed` or `playerBeaten`.
 * `entityAlive`/`entityDead`/`entityHpBelow` appear nowhere, so the two traps
 * that cost this campaign the most — a tag read before it exists, and a capture
 * that a corpse-counting condition cannot see — are excluded by construction
 * rather than by care. What that leaves is trap 4, the `max: N` that reads TRUE
 * against an empty registry, and every one of the four is conjoined with
 * `SETTLE`. The two `min:` thresholds need no guard: they read FALSE against an
 * empty registry, which fails the player's WIN rather than granting it.
 *
 * ============================================================================
 * NEITHER SHIPPED OUTCOME RULE MAY END THIS
 * ============================================================================
 * `annihilationWin` because razing the Meridian district is not the order and
 * would end the week with the account unvalued — and because the player is
 * denied `struct.tech` and `unit.specialist`, which is the double lock R2 and R3
 * both put on the Slaghurler, whose own blurb is "The only thing in the army
 * that can break a base". `assetLossDefeat` because a broker who has sold the
 * plant down to a Foundry and a counting house in order to make the number is
 * having the best last act this operation can produce, and `Shell.pollOutcome`
 * would end it at 2 Hz with a generic defeat instead. The authored loss is three
 * triggers and every one of them names an objective.
 *
 * ============================================================================
 * THE SEEDS ARE R1's, TO THE DIGIT, AND THAT IS A DECISION WITH A SECOND REASON
 * ============================================================================
 * `mapSeed` 41 207 and `simSeed` 6 412 are `reclamation.01.held-paper`'s, so the
 * heightfield, the reserved shelves and both corners are the same ground the
 * chapter opened on: Survey 41-207, the industrial belt, one week later. The
 * player held four scattered lots there and no base; they have a yard on it now.
 * **The chapter closes where it opened and the briefing says the survey number
 * out loud, exactly as R1's does.**
 *
 * THE SECOND REASON IS NOT LITERARY AND IT IS THE ONE THAT WOULD HAVE DECIDED
 * IT ANYWAY. `urban` carries `relief` 0.14 and `cliffs` 0.10 — **the flattest
 * pair in the whole `MAP_PRESETS` roster** — and the binding constraint on every
 * operation in this campaign has been scripted spawn ground:
 * `reclamation.04.served-notice` swept 300 snow rolls and **266 of them put at
 * least one drop on ground its own locomotor cannot enter**, and
 * `reclamation.03.sold-twice` swept 200 desert rolls and lost 188 the same way.
 *
 * This operation fires **nineteen drops** — three workings, six `spawnUnits`
 * calls, four distinct rings — at one point, and finding a point where all
 * nineteen are open took a sweep of the LANE rather than a sweep of SEEDS. That
 * is the whole of what the flat ground bought, and it is stated that way because
 * the first `ROAD` authored here failed seven of the nineteen: the ground being
 * a city does not make a spawn point free, it makes one findable without moving
 * the map.
 *
 * Two operations sharing a `mapSeed` is not new — `allies.01`/`soviets.01` share
 * 20 260 819 and `soviets.02`/`.03` share 20 260 903. Sharing BOTH seeds is, and
 * it is the point: the composition, the ownership and the fight are entirely
 * different, and the ground is not.
 *
 * ============================================================================
 * THE ROSTER
 * ============================================================================
 * `player: ['unit.raider', 'struct.defence.specialist', 'struct.support']`
 * `ai:     ['unit.raider', 'struct.defence.specialist']`
 *
 * The Arcspitter is carried forward from every operation in this chapter and it
 * is what makes the assay raid a detachment rather than an expedition (8.8 m/s
 * against a Grinder's 5.8). The Arc Pylon is the answer to a lot 112.87 m from
 * your own yard, and it is a decision about the GRID rather than a purchase —
 * -90 against a measured net of +160. `struct.support` is new to the chapter and
 * is granted for one reason: seventeen minutes of defending three lots is the
 * only place in this chapter where a `rclDepot` at 800 credits pays for itself,
 * and the Reclamation is the salvage arm — mending is what they are.
 *
 * `struct.tech` and `unit.specialist` are withheld from the player exactly as R2
 * and R3 withhold them, for the reason in the outcome block. The Pact keeps the
 * Sandskiff (9.2 m/s of fast light hover is what punishes a player stretched
 * across three lots) and the Helios Spire, and loses the Reliquary, the Zenith,
 * the Kestrel, the Hierarch, the repair pad and the Heliograph.
 *
 * **MEASURED, AND BOTH HALVES BITE.** Built twice with the def tables bound —
 * once with this roster installed and once without — the roster removes
 * `rclCrucible` from seat 0 and `mrdReliquary` from seat 1. Nothing else in
 * either opening carries an `unlockedBy` the two lists do not name, which is why
 * the difference is two structures rather than fifteen: the grants are wide on
 * purpose and the one that matters is the tech building, because everything
 * behind it is what would let either side end this operation the wrong way.
 *
 * ============================================================================
 * WHAT WAS CONSIDERED AND CUT
 * ============================================================================
 *   - **A SCRIPTED FRIENDLY WAVE.** `reclamation.01.held-paper` pays four
 *     Grinders for a lost yard and R4 sends a second crew at minute four. Both
 *     are right for an operation with no economy. Here the player has a Breaker
 *     Yard, a bank and seventeen minutes, and free hulls would be exactly the
 *     one thing that does not come off the twelve thousand. **A gift is a hole
 *     in the primary**, so there is none.
 *   - **A THIRD OUTLYING LEDGER.** `soviets.05.short-allocation` is already
 *     "hold two of three workings until the shift closes", and a count of lots
 *     is that operation. Two lots at graded prices is a different question —
 *     WHICH, not HOW MANY — and it is the question the bank primary is about.
 *   - **PAYING THE HIDDEN SECONDARY MORE THAN 700.** It pays into the number the
 *     other primary reads, which is a real interaction and a deliberate one: the
 *     raid returns 700 against a 420-credit Arcspitter, so it covers the hull it
 *     costs and does not buy the primary. Anything larger would let a player
 *     answer an economic objective with a military one. (This paragraph priced
 *     the Arcspitter at 520 while the paragraph above priced it at 420, which is
 *     the shipped `rclSpitter.cost`; the argument is unchanged and stronger.)
 *   - **`cameraMove`.** All three presentation kinds reach a screen since
 *     2026-08-19 and this operation uses two of them. The camera is refused for
 *     `reclamation.04.served-notice`'s reason inverted: there the player was
 *     watching eight men who could not be replaced; here they are watching three
 *     lots at once and taking the view off any of them is taking it off the
 *     decision. Every beat that would have used one carries a `dialogue`, which
 *     puts a toast on screen without moving anybody's camera.
 *
 * ============================================================================
 * THE MEASURED POINTS
 * ============================================================================
 * Every coordinate the trigger table names is IMPORTED from the layout and is
 * computed there from `SIM_SEED` at module load — `reclamation-served-notice` is
 * the precedent and its header carries the argument. What is measured rather
 * than derived is where each structure LANDS after `spawnBuilding` snaps its
 * footprint to the placement grid, and what the ground under a spawn ring is.
 *
 * Built headless at `mapSeed` 41 207 / `simSeed` 6 412 on `biome: 'urban'` with
 * the def tables bound and this operation's roster installed — the same build
 * `tests/campaign-roster-ground.spec.ts` performs:
 *
 *     Foundry (seat 0)   114, 382        Conclave (seat 1)  402, 134
 *     counting house     170, 284        Number Two         190, 380
 *     Number Six         302, 284        forward assay      348, 232
 *     the two Glaives    334, 226 and 350, 254
 *     ROAD              318.3, 162.0    (192.0 m to the house, 123.1 m to Six)
 *
 *     seat 0   30 buildings   19 units   power 480 / 320   net +160
 *     seat 1   28 buildings   14 units   power 640 / 315   net +325
 *
 * `auditConnectivity`: 2 passable regions for a tracked hull, the main one
 * holding 12 085 of 12 136 cells (99.6%); 5 placements relocated, worst 16.7 m;
 * **0 entities stranded, 0 structures on ground `isBuildable` refuses.** Which
 * five is not attributed here and does not need to be — every one of the four
 * TAGGED
 * placements lands within **2.08 m** of its authored point, which is one grid
 * snap on each axis and not a search. Nothing in the trigger table reads a
 * tagged structure's coordinate in any case; it reads tags.
 *
 * **ALL NINETEEN SCRIPTED DROPS ARE STANDABLE, WORST CLEARANCE 4.0 m.** Four
 * distinct rings are fired at `ROAD` across six calls — `mrdWayfarer` x4 at 12 m
 * (Foot), `mrdSolarch` x2 and x3 at 18 m (Track), and `mrdSkiff` x3 at 14 m
 * (Wheel) — and the Foot ring is the
 * binding one. `ROAD` was chosen by sweeping the lane frame at 2 m and 0.0025 of
 * the lane and keeping only points where every drop of every wave is open; 68
 * candidates cleared it inside 64 to 96 m of the Conclave and this is the one
 * with the best clearance in that band at a round authored pair. **Re-check all
 * four rings if a count, a spread or a seed moves** —
 * `tests/campaign-spawn-ground.spec.ts` is the standing gate.
 * ========================================================================== */

import { Faction } from '../../../core/types';
import { minutes, seconds } from '../../types';
import type { Condition, OperationDef } from '../../types';
import {
  HOUSE, LEDGER_SIX, ROAD, SIM_SEED, TALLY_AREA,
} from '../../layouts/reclamation-closing-entry';

/**
 * How long the layout is given to have placed the composition before a zero
 * threshold over it is believed.
 *
 * **FOUR `max:` THRESHOLDS IN THIS FILE AND EVERY ONE OF THEM IS CONJOINED WITH
 * THIS.** `ownerCount(..., max: 0)` reads TRUE against an empty tag registry,
 * exactly as `entityDead` does — the spelling changed and the hazard did not.
 * Unguarded, `t.houseLost` would end the operation in a defeat on the first tick
 * the Director runs and `t.tally` would pay 700 credits for a structure nobody
 * touched.
 *
 * **IT GUARDS A LAYOUT THAT PLACED NOTHING, NOT A TICK-ONE READ THAT HAPPENS
 * TODAY.** `scenarios.system.ts` builds the world inside `async init()` and
 * `SystemRegistry.init` awaits every module's init before a tick is taken, so
 * the registry is never empty when the Director first runs. What IS reachable is
 * a roster typo or a footprint that will not fit, which
 * `tests/campaign-roster-ground.spec.ts` and `tests/campaign-maps.spec.ts` catch
 * at their causes; this stops the symptom being instant.
 *
 * Twenty seconds is past the build and short of anything happening. Measured,
 * the nearest hostile unit at t = 0 is an `mrdSolarch` at (368.0, 146.8),
 * **240.88 m** from the counting house, and the fastest thing on that seat is a
 * 9.2 m/s Sandskiff — 184 m of straight line in twenty seconds, with 56.9 m
 * still to go. (This read 279.03 m, which is a STRUCTURE distance used as a
 * proxy for a unit, and it is a trap worth naming: the house and the Meridian
 * start spot both shifted by (+2, -2), so the current house-to-spot distance is
 * ALSO exactly 279.03 — the number still measures something and looks live
 * while answering a different question.)
 */
const SETTLE: Condition = { on: 'elapsed', ticks: seconds(20) };

/**
 * What the account is booked at, and the number the second primary reads.
 *
 * Derived in the header: `STORAGE_BASE` 10 000 plus 9000 of measured structural
 * storage is a 19 000 ceiling with everything standing and 15 000 with both
 * outlying Ore Sorters gone, and 12 000 is 80% of the worse of the two — so a
 * player who has lost both yards can still make the number BY MINING rather
 * than by liquidating the plant. **It is not set against an impossibility.** The
 * cap bounds harvested income only; a refund landing above it lifts `capFloor`
 * to the whole balance, and one 240-credit Scrap Furnace sold from the
 * both-yards-gone state measurably takes the ceiling to 20 120. See the header
 * for the sweep and for what was wrong with the argument this comment used to
 * make.
 *
 * It is written in the objective title and in two of Cregg's lines as a spelled
 * word, which is three copies of one number — unavoidable for a figure the
 * player is judged against, and the same trade `reclamation.02.written-off`
 * makes for its sixteen thousand.
 */
const WORTH = 12_000;

/**
 * The week's end. EXACTLY `parSec`, to the second.
 *
 * The authored par IS the deadline rather than a description of one, which is
 * the only way that field is falsifiable from inside the operation —
 * `reclamation.03.sold-twice` sets the same relationship at 900 and
 * `reclamation.04.served-notice` at 960.
 */
const CLOSE = minutes(17);

/** The counting house is still on the player's books. */
const HOUSE_HELD: Condition = {
  on: 'ownerCount', player: 0, role: 'building', tag: 'house', min: 1,
};

/**
 * The exact complement of `HOUSE_HELD`, guarded.
 *
 * `min: 1` and `max: 0` over one count partition every world state, so the win,
 * the shortfall and this cannot overlap and cannot all be false — which is what
 * makes the ending total. `reclamation.01.held-paper` draws the same pair for
 * the same reason.
 */
const HOUSE_GONE: Condition = {
  on: 'all',
  of: [SETTLE, { on: 'ownerCount', player: 0, role: 'building', tag: 'house', max: 0 }],
};

/** The account is worth more than the week cost. */
const IN_CREDIT: Condition = { on: 'credits', player: 0, min: WORTH };

/**
 * ITS NEGATION, SPELLED AS A `not` RATHER THAN AS `max: WORTH - 1`.
 *
 * `PlayerState.credits` is a float: `Economy.deposit` adds `ore * ORE_VALUE` off a
 * harvest that accumulates in `SIM_DT` steps, and nothing anywhere pins the
 * running total to an integer — so
 * `min: 12000` and `max: 11999` are NOT complements: a balance of 11 999.5
 * satisfies neither, and at the close that is an operation that never ends. A
 * `not` over the same condition partitions exactly, at every value, forever.
 */
const SHORT: Condition = { on: 'not', of: IN_CREDIT };

const op: OperationDef = {
  id: 'reclamation.05.closing-entry',
  chapter: 'reclamation',
  faction: Faction.Reclaim,
  /*
   * THE MERIDIAN PACT, AND IT IS THE CHAPTER'S BLURB BEING PAID OFF.
   *
   * "Nine breaking yards, every faction as a customer, and the only complete
   * account." R1 and R2 are fought against the Soviets, R3 and R4 against the
   * Allies. The Pact is the one army THIS CHAPTER has not been across a table
   * from, and closing it without them would leave "every faction as a customer"
   * a sentence rather than a table.
   *
   * It is also the right ANTAGONIST rather than merely the missing one, and the
   * two houses have already met from the other side: `pact.03.concession` is
   * fought against the Reclamation and puts "Tallow, on the yard net" in a Pact
   * operation. Calvane is the Pact chapter's own
   * voice in all four of its operations and his register is exactness about
   * records — "that is the difference between a record and an anecdote", his
   * own line in `pact.03`. An army whose chapter is four hundred years of
   * readings objecting to a single unaudited ledger is that argument arriving
   * from the other side of the table, and it is the only objection to the
   * Reclamation's position that this chapter has not yet had to answer.
   *
   * Every scripted key on seat 1 is a literal Meridian `mrdWayfarer`,
   * `mrdSolarch` or `mrdSkiff`, which `validateCampaign` checks against the
   * army of the seat it lands on.
   */
  foe: Faction.Meridian,
  index: 5,
  title: 'Closing Entry',
  beat: 'The account is the only complete one on the continent. The Pact would rather it were not.',
  /*
   * DEFEND. The chapter has not used it — R1 assault, R2 economy, R3
   * capture-hold, R4 infiltrate — and `validateCampaign` refuses two adjacent
   * operations in one chapter that share a `primaryType` in any case. See the
   * header for what the word is built out of here, and for why it is not
   * `soviets.05.short-allocation`'s count of workings.
   */
  primaryType: 'defend',
  // Objectives, spawns, orders, a reveal, dialogue, EVA and an outcome — the
  // definition in `types.ts` is "multiple effect kinds", and this is seven.
  archetype: 'bespoke',
  parSec: 1020,
  requires: ['reclamation.04.served-notice'],

  map: {
    /*
     * URBAN ON BOTH LINES, WHICH IS THE ONE PAIRING THAT CANNOT MAKE R3's
     * MISTAKE. `MAP_PRESETS` and `BiomeName` overlap on `temperate`, `snow` and
     * `urban` and disagree on exactly one name — the preset is `arid`, the biome
     * is `desert` — and `reclamation.03.sold-twice` shipped on the wrong side of
     * that and measured two headers' worth of numbers against ground it had not
     * declared. This pair is the same word twice.
     */
    preset: 'urban',
    /**
     * The survey designation. 41-207 is the number in the briefing, and it is
     * `reclamation.01.held-paper`'s — the same ground, one week and four
     * operations later. See the header for the second, non-literary reason.
     *
     * Pinned by `tests/campaign-maps.spec.ts` as a terrain fingerprint: a
     * generator change that re-rolls this ground moves every measured placement
     * in both headers, and it moves R1's as well.
     */
    mapSeed: 41_207,
    /*
     * IMPORTED FROM THE LAYOUT, WHICH OWNS IT.
     *
     * `simSeed` decides which two corners the match is played in, and every
     * point the trigger table below names is computed from exactly that in
     * `reclamation-closing-entry.ts` — out of `seatedSlots`,
     * `SKIRMISH_START_OFFSETS` and `MAP_SIZE`, at module load, arithmetic rather
     * than measurement. Writing the number here as well would be the same fact
     * in two files, and the failure mode — a reveal framing empty ground, a
     * column landing where nobody authored one — is invisible to every gate.
     * `reclamation-served-notice.ts` is the precedent and carries the structural
     * argument for why the import is safe.
     */
    simSeed: SIM_SEED,
    armies: 2,
    biome: 'urban',
    /*
     * `base`. The operation is about what a player SPENDS, so they need the
     * thing that spends: a Foundry, a Breaker Yard, a Rookery and four
     * Scrapjaws. `'force'` is R1's and R4's opening and both of those are about
     * having nothing; this one is about having something and deciding what it is
     * worth.
     */
    opening: 'base',
    /*
     * 5000, AND IT BINDS BOTH SEATS — `applySimPostBoot` writes
     * `startingCredits` into every non-Neutral slot, so this is a statement
     * about the operation's tempo rather than a handicap. It is the largest bank
     * in the chapter (3000 / 3000 / 4000 / 2500 before it) and it is deliberate:
     * the second primary is 12 000, so the opening bank is 42% of the order and
     * the first purchase is a real decision rather than a rounding error.
     *
     * Half the skirmish default, for the reason CLAUDE.md measures at length: a
     * brain with a 10 000 opening puts up a seven-building base and eleven
     * troops by t+90 s having mined nothing, and a defend whose first working is
     * scheduled for minute three must not be met by that at minute one.
     */
    credits: 5_000,
  },
  layout: 'reclamation-closing-entry',

  // NEITHER SHIPPED RULE MAY END THIS. See the header.
  outcome: { annihilationWin: false, assetLossDefeat: false, ignoreSeats: [] },

  roster: {
    player: ['unit.raider', 'struct.defence.specialist', 'struct.support'],
    ai: ['unit.raider', 'struct.defence.specialist'],
  },

  /*
   * THE PLAYER'S OWN LOTS, AND THE ASSAY IS DELIBERATELY NOT HERE. See the
   * header: seat 1 opens holding one `mrdArtificer`, so the engineer is on the
   * map and only the missing call site in `AiBrain` keeps it parked.
   */
  captureProof: ['house', 'ledger'],

  objectives: [
    {
      id: 'house',
      kind: 'primary',
      title: 'Keep the counting house on our books until the week closes',
    },
    {
      /*
       * NO `credits` FIELD, AND IT COULD NOT HAVE ONE — this is a primary and
       * `validateCampaign` refuses a paid primary at import. Worth stating
       * anyway, because a reward paid on THIS objective would be paid into the
       * very balance it reads.
       */
      id: 'worth',
      kind: 'primary',
      title: 'Close the week with twelve thousand credits in hand',
    },
    {
      id: 'tally',
      kind: 'secondary',
      hidden: true,
      /*
       * "TAKE … OFF THEM", NOT "DESTROY". `t.tally` counts what seat 1 still
       * owns, so a Tinker walked into the assay finishes it exactly as levelling
       * it does, and a title saying "destroy" would name the one route the rule
       * does not require. Trap 9, and `soviets.06.demolition-order` is the
       * worked example.
       */
      title: 'Take the Meridian forward assay off them',
      credits: 700,
    },
  ],

  triggers: [
    /* -- the brief, in two beats ------------------------------------------
     * Split across twelve seconds because the shell renders dialogue as toasts
     * and four at once is a stack nobody reads — and because two speakers in
     * six seconds is exactly the case `Shell.campaignBeatSeq` was written for,
     * so both halves of each beat really do arrive.
     *
     * Tallow opens because it is her account and she is the one who has not
     * answered the bid. Cregg carries the ground, as he has for four
     * operations.
     */
    {
      id: 't.open',
      when: { on: 'elapsed', ticks: seconds(4) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Tallow',
          text: 'Survey 41-207 again. Nine breaking yards, nine ledgers, and every army on this '
            + 'continent in one of them. The Meridian Pact has bid for the account entire and I '
            + 'have not answered.',
        },
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'Five of the nine are in the counting house on the lot forward of the yard. Two '
            + 'more are still at the yards that keep them — Number Two on the near road, Number '
            + 'Six out past the sidings. Their first working is already on the schedule.',
        },
      ],
    },
    {
      id: 't.orders',
      when: { on: 'elapsed', ticks: seconds(16) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Tallow',
          text: 'The account is booked at twelve thousand. Finish the week with the counting '
            + 'house on our books and twelve thousand in hand and we have kept it. Finish with '
            + 'the house and an empty box and we have bought our own paper back at full price.',
        },
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'So price a lot before you defend it. Everything you spend out there comes off '
            + 'the twelve thousand, and Number Six is nearer their gate than '
            + 'ours by thirty-two metres, and no number of Pylons moves it.',
        },
      ],
    },

    /* -- the first working -------------------------------------------------
     * Minute three, unconditional. A wave that fires only when the player is
     * elsewhere reads as the map cheating; a schedule the world keeps regardless
     * reads as an opponent, which is `soviets.03.deep-sector`'s argument about
     * scripted waves on an AI seat.
     *
     * Pointed at Number Six, which is the lot the operation wants the player to
     * have to think about first. `AiBrain.regroupSquads` files every untagged
     * hull the seat owns into a squad on its next pass, so the attack-move is
     * the first thing these six do and the brain owns them afterwards — the
     * honest limit of what a scripted wave buys.
     *
     * LITERAL MERIDIAN KEYS. `EffectSink.spawnUnits` resolves through
     * `ProductionCatalog.byKey` and remaps nothing, unlike the layout's
     * `ScenarioBuilder.spawnUnit`; `validateCampaign` checks each key against
     * the army of the seat it lands on, so a Reclamation key here is a build
     * error.
     */
    {
      id: 't.first',
      when: { on: 'elapsed', ticks: minutes(3) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Calvane, intercepted',
          text: 'First working, up the sidings road to Number Six. It is on the schedule at '
            + 'recovered valuation and there are Reclamation crews standing on it. Log the time '
            + 'and take delivery of what we have paid for.',
        },
        {
          do: 'spawnUnits', player: 1, key: 'mrdWayfarer', count: 4, at: ROAD, spread: 12, tag: 'column',
        },
        {
          do: 'spawnUnits', player: 1, key: 'mrdSolarch', count: 2, at: ROAD, spread: 18, tag: 'column',
        },
        { do: 'orderTagged', tag: 'column', order: 'attackMove', at: LEDGER_SIX },
      ],
    },

    /* -- the bid, and the second book --------------------------------------
     * The hidden secondary is revealed at the moment it becomes a real choice
     * rather than in the briefing: minute four is after the first working has
     * committed and while the player still has thirteen minutes to answer it.
     * `briefingObjectives` filters hidden rows out of the briefing, so a player
     * who never looks north never learns it existed — the correct reading of a
     * reward for over-delivering, and `reclamation.03.sold-twice`'s.
     *
     * Cregg names the method outright. R1's rule: a hidden objective whose route
     * the player has to guess is a quiz, and the medal is for USING the
     * mechanism rather than for knowing it.
     *
     * `revealArea` EXPLORES ground rather than showing live units, so 46 m puts
     * the assay and both of its posts on the map while the player still has the
     * match to answer them.
     */
    {
      id: 't.bid',
      when: { on: 'elapsed', ticks: minutes(4) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Calvane, intercepted',
          text: 'One account, one hand, and no second copy anywhere on the continent. That is '
            + 'not a record, it is an assertion. We have priced these yards ourselves and the '
            + 'schedule is at the forward assay, where anybody who wants it may read it.',
        },
        { do: 'revealArea', player: 0, area: TALLY_AREA },
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'There it is — their own book, out on the sidings road, disagreeing with ours by '
            + 'their arithmetic rather than ours. Take it off them, broken or whole, and there is '
            + 'one complete account on this continent again. Send hulls. The posts on it are '
            + 'repeaters and they are for men.',
        },
        { do: 'setObjective', id: 'tally' },
      ],
    },

    /* -- the second working ------------------------------------------------
     * BEFORE THE EVENT RATHER THAN ON IT, WHICH IS THE ONLY WAY A SCRIPTED
     * `eva` EARNS ITS PLACE. `audio.system.ts` already speaks this line on any
     * attack; nothing is attacking yet. The column forms 192.0 m from the
     * counting house and a Wayfarer walks at 3.8 m/s, so the line lands 25 to 51
     * seconds ahead of contact rather than on top of it.
     */
    {
      id: 't.second',
      when: { on: 'elapsed', ticks: minutes(7) },
      then: [
        { do: 'eva', line: 'forcesUnderAttack' },
        {
          do: 'dialogue',
          speaker: 'Calvane, intercepted',
          text: 'Second working, and it is not going to Number Six. The counting house is the '
            + 'lot with the paper in it. Everything else out there is a shed with a meter on it.',
        },
        {
          do: 'spawnUnits', player: 1, key: 'mrdWayfarer', count: 4, at: ROAD, spread: 12, tag: 'column',
        },
        {
          do: 'spawnUnits', player: 1, key: 'mrdSolarch', count: 3, at: ROAD, spread: 18, tag: 'column',
        },
        { do: 'orderTagged', tag: 'column', order: 'attackMove', at: HOUSE },
      ],
    },

    /* -- the third -----------------------------------------------------------
     * The heaviest, and the fastest: three Sandskiffs at 9.2 m/s cross the
     * 192.0 m in 20.9 s against a Solarch's 25.3 and a Wayfarer's 50.5, so this
     * one arrives as a whole rather than strung out.
     *
     * It joins the `column` tag rather than taking its own, so one `orderTagged`
     * re-points the survivors of all three workings — `EffectSink.orderTagged`
     * issues ONE command per owner and every one of them is seat 1.
     */
    {
      id: 't.third',
      when: { on: 'elapsed', ticks: minutes(11) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Calvane, intercepted',
          text: 'Third. Whatever is standing on that lot at the close is plant we have paid for '
            + 'and not received, and I have run out of ways to write that down.',
        },
        {
          do: 'spawnUnits', player: 1, key: 'mrdSkiff', count: 3, at: ROAD, spread: 14, tag: 'column',
        },
        {
          do: 'spawnUnits', player: 1, key: 'mrdSolarch', count: 3, at: ROAD, spread: 18, tag: 'column',
        },
        { do: 'orderTagged', tag: 'column', order: 'attackMove', at: HOUSE },
      ],
    },

    /* -- a yard off the books ----------------------------------------------
     * TRUE WHETHER IT WAS LEVELLED OR SOLD, and the line is written to be right
     * either way. `ownerCount` cannot tell a demolition from a sale and, on this
     * operation, should not: `Production.applySell` hands back 1000 of an Ore
     * Sorter's 2000 and takes 2000 of ceiling with it — measured net +1000 at
     * any balance up to 16 000, and net -2000 at the 19 000 ceiling, which is
     * the sweep in the header — a legitimate and deliberate route to the second
     * primary at every balance this operation's own lines offer it in. Cregg
     * prices the loss rather than
     * mourning it.
     *
     * `SETTLE` is conjoined because `max: 1` reads TRUE against an empty tag
     * registry — trap 4, and the only trap this file is exposed to at all.
     */
    {
      id: 't.yardLost',
      when: {
        on: 'all',
        of: [SETTLE, { on: 'ownerCount', player: 0, role: 'building', tag: 'ledger', max: 1 }],
      },
      then: [
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'One yard off the books. That is a Sorter we are not rebuilding, two thousand of '
            + 'ceiling gone with it, and a Furnace with nothing left to feed. It is also one '
            + 'fewer lot you are paying to stand on. Take the credit where you find it.',
        },
      ],
    },
    {
      id: 't.yardsGone',
      when: {
        on: 'all',
        of: [SETTLE, { on: 'ownerCount', player: 0, role: 'building', tag: 'ledger', max: 0 }],
      },
      then: [
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'Both yards gone. Fifteen thousand of room and one dock, and everything the '
            + 'account is still worth is in one shed on one lot. Stop paying for ground and '
            + 'start paying for the house.',
        },
      ],
    },

    /* -- the second book ----------------------------------------------------
     * `ownerCount` on SEAT 1, not `entityDead` — see the header. It counts what
     * the Pact still holds, so demolition and capture finish it identically, and
     * the objective's title says "off them" for exactly that reason.
     *
     * ABOVE EVERYTHING THAT ENDS THE MATCH, which is this file's ordering rule:
     * `runDirector` evaluates nothing once an outcome is set, so a secondary
     * written below the win can never resolve on the winning tick and the medal
     * never counts it.
     */
    {
      id: 't.tally',
      when: {
        on: 'all',
        of: [SETTLE, { on: 'ownerCount', player: 1, role: 'building', tag: 'tally', max: 0 }],
      },
      then: [
        { do: 'completeObjective', id: 'tally' },
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'Their assay is off their books. There is one complete account on this continent '
            + 'and it has our name on the front of it, which is the only reason anybody has ever '
            + 'paid this company for a sheet of paper.',
        },
      ],
    },

    /* -- two minutes, and which side of the number you are on ---------------
     * A PAIR RATHER THAN ONE LINE, because a warning that does not know the
     * player's balance is a warning they have to check for themselves — and the
     * whole fairness of making the bank a PRIMARY rests on nobody discovering it
     * at the close.
     *
     * Both are `elapsed(minutes(15))` conjoined with the credits test and its
     * exact negation, so exactly one of them can fire on the tick the fifteenth
     * minute lands. Either may fire LATER instead, when the balance crosses —
     * and that is deliberate rather than tolerated: a player who was clear at
     * fifteen and has spent themselves short at sixteen is precisely who needs
     * to be told, and both lines read correctly in either order.
     *
     * **THE `SHORT` GATE IS ALSO WHAT KEEPS THE SELL ADVICE ARITHMETICALLY
     * TRUE**, which was not the reason it was written and is now the second
     * reason it stays. A storage structure sold at or near the credit ceiling is
     * a NET LOSS — the refund goes in through `Production.grant`, which does not
     * lift the floor, and the next `recomputeStorage` clamps the balance into
     * the smaller ceiling. This line can only fire under 12 000, and the Ore
     * Sorter's break-even balance is 17 000, so there are 5000 credits between
     * the advice and the state where it would be wrong. Measured, not reasoned;
     * the sweep is in the header. It leads with the Pylon in any case, because
     * a structure carrying no storage never inverts at any balance at all.
     */
    {
      id: 't.callShort',
      when: { on: 'all', of: [{ on: 'elapsed', ticks: minutes(15) }, SHORT] },
      then: [
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'Two minutes and we are short of the twelve thousand. Start with the Pylon — '
            + 'seven hundred and twenty-five back and its ninety of grid with it, and it costs '
            + 'us no dock. A Sorter pays more and takes its own ceiling down on the way out, so '
            + 'sell one only while the box has room for it. We are a salvage company. Breaking '
            + 'up the plant is the trade.',
        },
      ],
    },
    {
      id: 't.callClear',
      when: { on: 'all', of: [{ on: 'elapsed', ticks: minutes(15) }, IN_CREDIT] },
      then: [
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'Twelve thousand is in the box. From here anything you buy is money coming '
            + 'straight back off the valuation — hold what you have got and let the crushers '
            + 'run out the clock.',
        },
      ],
    },

    /* -- the win -------------------------------------------------------------
     * BOTH PRIMARIES ON ONE CONDITION, evaluated once, at the close. The house
     * standing is not enough and the bank alone is not either, which is the
     * operation stated as a conjunction.
     *
     * ABOVE `t.houseLost`, so a counting house that is still ours on the closing
     * tick wins: the ground beats the paperwork, which is the whole chapter.
     */
    {
      id: 't.win',
      when: { on: 'all', of: [{ on: 'elapsed', ticks: CLOSE }, HOUSE_HELD, IN_CREDIT] },
      then: [
        { do: 'completeObjective', id: 'house' },
        { do: 'completeObjective', id: 'worth' },
        {
          do: 'dialogue',
          speaker: 'Tallow',
          text: 'House standing, twelve thousand in the box, and the only complete account on '
            + 'this continent still has one name on the front of it. Send the Pact the index and '
            + 'an invoice for the copying.',
        },
        { do: 'endOperation', result: 'win' },
      ],
    },

    /* -- the shortfall -------------------------------------------------------
     * THE OTHER HALF OF THE SAME TICK. `HOUSE_HELD` on both arms and `SHORT` as
     * a `not` over the win's own `credits` condition, so the two partition every
     * balance exactly — see the note on `SHORT`.
     */
    {
      id: 't.shortfall',
      when: { on: 'all', of: [{ on: 'elapsed', ticks: CLOSE }, HOUSE_HELD, SHORT] },
      then: [
        { do: 'failObjective', id: 'worth' },
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'House is ours and the box is empty. We have spent the account defending the '
            + 'account, which is the one entry Tallow will not sign. Book it as a loss and keep '
            + 'the figure out of the covering note.',
        },
        { do: 'endOperation', result: 'loss', reason: 'worth' },
      ],
    },

    /* -- the house ----------------------------------------------------------
     * `HOUSE_GONE` is `HOUSE_HELD`'s exact complement, guarded, so this and the
     * two triggers above partition every state the close can find and the
     * operation cannot fail to end. It fires at any tick, not only at the close:
     * nine yards of paper on the ground is the operation over.
     */
    {
      id: 't.houseLost',
      when: HOUSE_GONE,
      then: [
        { do: 'failObjective', id: 'house' },
        { do: 'failObjective', id: 'worth' },
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'Counting house is gone and nine yards of paper with it. Whatever we owned this '
            + 'morning we can no longer prove we owned — and neither can anybody else, which is '
            + 'not the same thing and is worth nothing at all.',
        },
        { do: 'endOperation', result: 'loss', reason: 'house' },
      ],
    },

    /* -- the yard is gone ----------------------------------------------------
     * `playerBeaten` is `Viability.isBeaten` — nothing to build with and nothing
     * to fight with — and it is the honest floor rather than "you have no
     * buildings". A broker down to a Foundry and a counting house is exactly the
     * position this operation would like somebody to try to close a week from,
     * and the sell route above is what makes that a real attempt.
     */
    {
      id: 't.rout',
      when: { on: 'playerBeaten', player: 0 },
      then: [
        { do: 'failObjective', id: 'house' },
        { do: 'failObjective', id: 'worth' },
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'Nothing answering at the yard. They will take the account at their own '
            + 'valuation, and their arithmetic has never once come out in our favour.',
        },
        { do: 'endOperation', result: 'loss', reason: 'house' },
      ],
    },
  ],
};

export default op;
