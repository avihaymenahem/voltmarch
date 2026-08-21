/**
 * ============================================================================
 * S7 — RIGHT OF ENTRY
 * ============================================================================
 * The demolition order was answered and withdrawn, and the branch closed the
 * file on the Ninth District's whole tenure of this sector. An administration
 * that has lost an allocation, a revision and a demolition order in one quarter
 * does not get a fourth attempt; it gets wound up. So the Ninth is packing.
 *
 * **AND THE SECTOR GOES WITH IT, BECAUSE THE SECTOR IS ITS RECORD.** Six
 * operations of ground have not settled who this seam belongs to, because every
 * one of them was decided on paper afterwards by whoever held the paper. The
 * Ninth holds it. When the wind-up is signed, the district's record leaves on
 * the branch line and the sector's whole history goes up to a Continental
 * office that has never seen it, to be re-read out of the losing side's own
 * books.
 *
 * Rakhalt's order is the shortest one in the chapter: take the record.
 *
 * ============================================================================
 * THE RECORD IS TWO BLOCKS AND NEITHER IS WORTH ANYTHING ALONE
 * ============================================================================
 * A lease is executed in two parts. Each side signs one — the part and the
 * counterpart — and an entry cannot be made from either half. That is the
 * fiction and it is also the primary: `ownerCount(0, 'building', 'books',
 * min: 2)`, both blocks in Soviet hands at once, standing.
 *
 * **AND THAT IS WHY THE OPERATION IS NOT `capture-hold`.** Nothing here is held
 * against a clock: the win resolves on the tick both deeds are in Soviet hands.
 * The AI can now buy an engineer and recapture a legal visible block before that
 * instant, so the route is contestable; destruction still ends the operation.
 * See the loss below.
 *
 * **`infiltrate`, AND IT IS THE THIRD READING OF A WORD THE ENGINE HAS NO
 * PREDICATE FOR.** There is no stealth in this game and no vision condition
 * among the twelve. `allies.02.instrument-room` built the word out of a
 * HEADCOUNT and `reclamation.04.served-notice` out of a DWELL CLOCK, and that
 * file's header says in as many words that doing either again would be one
 * trick twice. This one builds it out of the **soften ladder**: the operation
 * is decided by getting an unarmed man through a door, and every number that
 * decides it is a number about that man rather than about the ground he crossed
 * to reach it.
 *
 * ============================================================================
 * THE LADDER, MEASURED IN THE ENGINE, AND `Capture.ts` HAS IT WRONG BY 25%
 * ============================================================================
 * `Capture.ts` rule 2: an enemy structure flips only at or below
 * `CAPTURE.captureHpFrac` (0.5), and an engineer that arrives above it is spent
 * SOFTENING — it knocks `CAPTURE.softenFrac` (0.25) of max HP off and dies in
 * the attempt. That file's own header then says *"a full-health Construction
 * Yard costs exactly three engineers (100% -> 75% -> 50% -> captured)"*, and
 * `soviets.01.first-tap`'s header restates the same ladder for its 900 hp
 * derricks as *"900 -> 675 -> 450 -> taken"*.
 *
 * **BOTH ARE OFF BY `COMBAT_DAMAGE.globalMul`, AND THE REAL ANSWER IS FOUR.**
 * The soften is not a direct write to `hp`; it is a damage RECORD
 * (`WarheadClass.HighExplosive`, no splash) and it goes through `applyOne`,
 * which is the only function in the game that writes `hp`, and which multiplies
 * by `armorMultiplier(warhead, armour) * upgradeMul(...) * airMul *
 * COMBAT_DAMAGE.globalMul`. For a structure that is
 * `ARMOR_MATRIX[HighExplosive][Concrete]` **1.00** x an Armour upgrade that
 * cannot reach a Building (both rows in `src/sim/Upgrades.ts` are
 * `UpgradeScope.Vehicle` and `.Infantry`) x 1 x **0.80**. So one man takes
 * **0.20 of maximum health**, not 0.25, and the gate at 0.5 is two steps away
 * rather than one and a half.
 *
 * Driven in the real engine — a real `CaptureService` and a real
 * `DamageSystem`, an 800 hp `ArmorClass.Concrete` block on seat 1, engineers
 * released one at a time:
 *
 *     tick 0   800 -> 640   frac 0.8000   soften
 *     tick 2   640 -> 480   frac 0.6000   soften
 *     tick 4   480 -> 320   frac 0.4000   soften
 *     tick 6                frac 0.4000   CAPTURED, owner 0
 *
 * **Four men a book, two thousand credits, and the block ends at 0.40000 of
 * maximum, exactly.** Both blocks is eight men and 4000 credits out of a 6000
 * bank — which is the fork this operation owns, because there is a second way.
 *
 * ============================================================================
 * THE FORK: HOW MUCH OF THE TAKING YOU DO WITH GUNS
 * ============================================================================
 * Shell a block to the gate and ONE man finishes it. Every figure below is the
 * shipped rows through `ARMOR_MATRIX` at `COMBAT_DAMAGE.globalMul` 0.80,
 * against `ArmorClass.Concrete`:
 *
 *     four Anvils      4 x heavyCannon   68.64 dps   400 hp in  5.83 s
 *     one Anvil shell  78 x 0.55 x 0.80  34.32 dmg   4.29% of the block
 *     one Conscript round 16 x 0.18 x 0.80  2.304    0.288%
 *
 *     crew only    4 men x 500 x 2 books = 4000 credits, no risk at all
 *     guns first   1 man x 500 x 2 books = 1000 credits, and every shell is a
 *                  shell that can go one too far
 *
 * **THE 3000-CREDIT DIFFERENCE IS HALF THE OPENING BANK, AND WHAT IT BUYS IS
 * NOT HAVING TO STOP.** Below the gate there are exactly two more thresholds
 * and both are the engine's rather than this file's:
 *
 *     0.50   `CAPTURE.captureHpFrac`   a man can finish it
 *     0.40   the crew's own floor      three softens, measured above
 *     0.25   `BURN_HP_THRESHOLD`       `EntityFlag.Burning` is set
 *     0.00                              the operation is lost
 *
 * From the gate to the fire is 200 hp on an 800 hp block: **5.8 Anvil shells,
 * or 2.9 seconds of four Anvils that nobody told to stop.** From the gate to
 * nothing is 11.7 shells and 5.8 seconds. A burning block loses `BURN_DPS` 4 x
 * 1.00 x 0.80 = **3.2 hp a second** and is gone **62.5 seconds** after it
 * catches, with nobody shooting it.
 *
 * ============================================================================
 * THE ESCORT IS THE THREAT, AND HOLD FIRE IS THE ANSWER
 * ============================================================================
 * **THE MOST LIKELY WAY TO LOSE THIS OPERATION IS YOUR OWN GUNS, IDLE.**
 * `Targeting.acquire` scores an unarmed structure at
 * `COMBAT_TARGETING.softBuilding` **0.55** — "buildings are last" — against
 * `armedTarget` 1.6 and `defenceBuilding` 1.3, so an escort standing at the
 * halt shoots the pillboxes first and every hull second. It then runs out of
 * hulls, and 0.55 of something is more than nothing.
 *
 * The answer is a stance, and it is one the game already ships and the manual
 * already documents as one of the two that do something: **Hold Fire** —
 * *"Move to the target but never fire unless force-fired"* (`Stance.HoldFire`,
 * the third row of `Sidebar.ts`'s stance list). Vosk says so in the brief,
 * because a rule the player can only learn by losing it is a rule badly told —
 * a sentence `allies.01.sounding-line` wrote first and `soviets.04.company-town`
 * says twice about its own hold timer.
 *
 * Two smaller facts in the same direction, both derived from the same scoring
 * function. A CONSCRIPT escort is far safer than an armour one: small arms
 * against Concrete is 0.18, at or under `COMBAT_TARGETING.ineffectiveBelow`
 * 0.35, so its score for a record block is multiplied by
 * `softBuilding` 0.55 x `ineffective` 0.35 = **0.1925** against an Anvil's
 * 0.55. And a block under 0.4 of health picks up `wounded` **1.25**
 * (`woundedFrac` 0.4) — so the block the crew has just softened to its floor
 * is, from that tick on, more attractive to your own tanks than it was before.
 *
 * **THE CONSCRIPT ARGUMENT HAS A SECOND AND STRONGER HALF THAT THE SCORING
 * FUNCTION CANNOT SEE: `conscriptRifle` HAS NO SPLASH AT ALL.** `splashRadius`
 * 0 sends the record down `Damage.drain`'s single-victim branch, which never
 * calls `applySplash`, so a conscript escort cannot touch a block it is not
 * aimed at, at any range, ever. `heavyCannon` carries 2.1 m and `lightCannon`
 * 1.6, and the next section is what that costs.
 *
 * ============================================================================
 * THE ORDER POINT IS NOT THE BLOCK, AND IT USED TO BE
 * ============================================================================
 * **`surface` CLAMPS AT ZERO, SO THE WALL OF A BLOCK IS THE BLOCK.**
 * `Damage.applySplash` computes `surface = max(0, sqrt(planar) -
 * hitRadius(victim))` and `hitRadius(2, 3, 6)` for a `civApartments` is the
 * footprint half-diagonal **7.211 m**. A shell landing anywhere inside that of
 * a block's centre — i.e. against the wall of an 8x12 m footprint — has
 * `falloff` 1.0 and delivers precisely what force-firing the block delivers:
 *
 *     one heavyCannon shell   78 x 0.55 x 1.00 x 0.80   34.32 hp
 *     the five opening Anvils      /2.0 s each          85.80 dps
 *     an 800 hp block                                    9.32 s
 *     from the capture gate (400 hp)                     4.66 s
 *     after capture (friendlyFireMul 0.5)               18.65 s
 *
 * **AND THIS OPERATION USED TO AIM THE DISTRICT AT THAT WALL BY HAND.** All
 * three block-bound `orderTagged` calls named `REGISTER` and `COUNTERPART`, and
 * the rostered headless build puts the two blocks at **exactly (296.00, 338.00)
 * and (380.00, 302.00)** — those literals. So the designed end state of every
 * scripted wave was six to eight hulls standing at the record, and the answering
 * fire the operation exists to invite was 85.80 dps into the primary. The
 * layout's collateral section is about a blast centred on a GUN at 21.26 m of
 * clearance and is true; it simply has nothing to say about this channel, which
 * is the one the trigger table opened.
 *
 * `HALT_STAND` (302, 364) and `OFFICE_STAND` (404, 316) are the order points
 * now: 26.68 m and 27.78 m off their blocks, so `surface` is 19.47 m and
 * 20.57 m and **no gun-mounted weapon the player can field — 3.2 m is the
 * ceiling, see the roster section — reaches a block while firing at a wave
 * standing where the operation told it to stand.** They were searched for on
 * the same lattice the two spawn rings were; the layout owns the derivation.
 *
 * **THE RESIDUAL IS NOT CLOSED AND MUST NOT BE CLAIMED AS CLOSED.**
 * `Targeting` parks an attacker at `range * APPROACH_STOP_FRAC` of whatever it
 * acquires FIRST, so a wave hull that acquires an engineer at the door closes on
 * the door and the wall is a live splash relay again. What moving the points
 * buys is that the wall is no longer the DEFAULT — it is where a fight the
 * player chose to have at the block ends up, rather than where this file put six
 * hulls at minute four. That is also the honest reason the brief leads with hold
 * fire rather than with a stance chart.
 *
 * ============================================================================
 * WHY THE SHOWN SECONDARY CANNOT BE LOST, ONLY PAID FOR
 * ============================================================================
 * `legible` is `not(entityHpBelow('books', 0.25))` at the moment the entry is
 * made, and 0.25 is `BURN_HP_THRESHOLD` rather than a number this file chose:
 * the objective is exactly *"neither part was set alight"*. It is judged at the
 * ENTRY and not at the moment it is breached, which is a deliberate departure
 * from this chapter's own "fail it when it becomes unreachable" rule — because
 * here it does not become unreachable. **`Capture.ts` rule 3: an engineer
 * walked into a damaged structure its own player owns sets `hp = maxHp`
 * instantly and is consumed.** So any block, however badly shelled, goes back
 * to full for 500 credits and a walk, and the player's own wrench does the same
 * at `REPAIR_COST_PER_HP` 0.25 a point.
 *
 * That also covers the clumsy case, which is measured and is not obvious.
 * `CaptureService.simTick` has NO per-target dedupe and a soften lands as a
 * damage record a tick later, so **two engineers that arrive on the same tick
 * both soften against the same read of `hp`**. Measured in the same rig,
 * released in pairs: 800 -> 480 in one tick, then 480 -> 160 in one tick, so
 * the block needs SIX men instead of four and ends at 0.20 — alight, and one
 * step under the shown secondary. The sixth man, arriving after the fifth has
 * flipped it, finds a friendly damaged structure and repairs it to full, which
 * is where the recovery above was found rather than reasoned.
 *
 * **WHAT IS NOT MEASURED IS WHETHER A CREW WALKING AS A GROUP ARRIVES ON ONE
 * TICK IN A REAL MATCH.** The rig has no `Movement` and no `Steering`; the
 * engineers were placed inside the reach ring. `CAPTURE.reachMetres` is 2.2 m
 * past the footprint edge and the block is 8x12 m, so the ring has room for
 * several men at once and the answer is probably "sometimes". Nothing has
 * played this. It is the number in this file I would check first.
 *
 * ============================================================================
 * AND WHY THE HIDDEN ONE IS A WINDOW THE PLAYER OPENS
 * ============================================================================
 * `clean` pays 400 for taking the second block within four minutes of the
 * first. It is `elapsedSinceArmed` used as a WINDOW-CLOSER rather than as a
 * hold — a third reading, after `soviets.02.common-standard`'s hold and
 * `reclamation.04.served-notice`'s penalty dwell — and the arming predicate is
 * `ownerCount(0, 'building', 'books', min: 1, max: 1)`: **the player owns
 * exactly one of the two.** That is order-independent, which `structureCaptured`
 * would not be (`WorldQuery.ownerOfTag` answers for the FIRST live entity in
 * stamp order, not for either), and it disarms itself the instant the second
 * deed lands, so the miss can never fire on the winning tick.
 *
 * `min: 1` alongside `max: 1` is the tick-one guard —
 * `soviets.02.common-standard` puts the same `min: 1` on its own `max: 4` and
 * its header says why: a bare upper bound reads TRUE against a world with
 * nothing in it at all.
 *
 * The interval is authored against the ground rather than chosen: the two
 * blocks stand **91.39 m** apart, which an engineer covers in **26.9 s** at
 * `maxSpeed` 3.4, and the office block sits 82.97 m from the Ninth's own
 * Construction Yard with two guns on it. Four minutes is the walk, the guns and
 * one full ladder — and it is deliberately not enough time to also go home for
 * more men, which is what makes "prepare the office before you take the halt" a
 * plan rather than a preference.
 *
 * ============================================================================
 * THE ONE THING THE DISTRICT DOES ABOUT ANY OF IT
 * ============================================================================
 * **THE NINTH MENDS ITS OWN BUILDINGS, AND THAT IS WHY THE CREW GOES IN AS ONE
 * PARTY.** `AiBrain.repairBase` arms the wrench on the worst structure at or
 * below `AI_REPAIR.startFraction` **0.75**, needs `AI_REPAIR.minCredits` 400 in
 * the bank, runs on `AI_CADENCE.build` (15 ticks, 2 Hz) and is capped by
 * `AI_SKILL[].maxRepairs` — 1 / 3 / 5 / 8 across the rungs. `REPAIR_RATE` is
 * **30 hp a second** at `REPAIR_COST_PER_HP` 0.25, so a block put back from 0.60
 * is whole again in **10.7 s for 80 credits**.
 *
 * The first soften leaves the block at 0.80 and does not arm it. The second
 * leaves it at 0.60 and does. From there the third and fourth men have
 * **2.67 seconds** of margin before 30 hp/s carries it back over the gate at
 * 400 — which is the whole reason the brief says "as one party" and is the
 * second number in this file that has never been played.
 *
 * It cuts the other way too, and honestly: while the Ninth owns a block, their
 * wrench beats the fire 30 to 3.2, so shelling one under `BURN_HP_THRESHOLD`
 * does not usually burn it down for you. The fire is a threat to a block THE
 * PLAYER owns and has stopped looking at.
 *
 * **AND THE WRENCH IS THE SLOW HALF OF BOTH SUMS, WHICH IS WHY `t.alight` NO
 * LONGER QUOTES THE BURN CLOCK AS THE PLAYER'S CLOCK.** 30 hp a second beats
 * 3.2, and loses to a `grizzly`: `lightCannon` is 55 `ArmorPiercing` on a 1.5 s
 * cooldown, so 55 x 0.55 x 0.80 = 24.2 a shot and **16.13 dps** each. The three
 * in `t.press` are 48.40 dps and the four in `t.last` are 64.53, against a
 * `REPAIR_RATE` of 30 — so from `BURN_HP_THRESHOLD` to nothing is **4.13 s and
 * 3.10 s** with the wrench already on it, not the 62.5 s the fire alone takes,
 * and `t.burnt` fires `endOperation('loss')` on the tick it arrives. The
 * remedy is stated at the CAPTURE beats for that reason; see `t.halt`.
 *
 * ============================================================================
 * THE ROSTER IS EMPTY ON BOTH SIDES AND THAT IS WHAT MAKES THE LAYOUT'S
 * CLEARANCE TRUE
 * ============================================================================
 * `{ player: [], ai: [] }` is a RESTRICTION, not an absence: the roster is an
 * ALLOW-LIST over tagged content, so two empty lists hold both seats to the
 * day-one catalogue — no Proving Ground, no Tesla Coil, no Refractor Tower, no
 * AA Battery, no aircraft, no Sledge Tank, no superweapon, in either opening
 * base or either sidebar. Symmetric and profile-independent, so the ground is
 * the same on a finished account as on a fresh one, which a deny-list could not
 * promise.
 *
 * **AND IT IS LOAD-BEARING FOR THE ONE CLAIM THE LAYOUT MAKES ABOUT
 * COLLATERAL — WHICH WAS ENUMERATED OVER THE WRONG SET AND HAS BEEN
 * RE-DERIVED.** This block used to say `unit.specialist` withheld leaves
 * `heavyCannon`'s 2.1 m as the largest blast the Soviet player can put on land,
 * *"every larger figure in the armoury belongs to a hull a shipyard builds"*.
 * That enumerates `WEAPONS` ROWS. Enumerated instead over every def a
 * `Faction.Soviets` or `Faction.Neutral` row makes reachable under
 * `{ player: [], ai: [] }`, off the bound tables of the rostered build:
 * **`flameTower` fires `flameJet` at splashRadius 3.2**, costs 600 credits off
 * `prereqs: ['barracks']`, carries no `UNLOCK_TAGS` row — that table's own
 * comment says *"NOT `flameTower`"* and gives the reason — and the rostered
 * build hands seat 0 **two of them standing in its opening base**. 3.2 + 7.211
 * = 10.41 m against 21.26 m of clearance, so the layout's margin is **10.85 m**
 * rather than 11.95. The withholding claim is unaffected and still measured:
 * `apocalypse` is in the unrostered control's opening force and not in the
 * rostered one.
 *
 * **AND ONE BLAST IS NOT A WEAPON ROW AT ALL.** `commandPost` carries
 * `prereqs: ['radar']` and no `unlockedBy`, the opening base holds a radar, and
 * CLAUDE.md lists the Command Posts among the deliberately ungated content — so
 * an allow-list cannot refuse the Powers tab. 1500 for the Post plus 1500 for
 * `power.airstrike` is **half this operation's bank**, and what it buys is
 * radius 20 / 260 `HighExplosive` / rim 0.3 down the ordinary damage channel.
 * At the tightest gun that is surface 14.05 m, `falloff` 0.4006, **83.33 hp —
 * one tenth of a block, per press, from a strike aimed at the gun.** Nine and a
 * half presses at 150 s of charge is twenty-four minutes against a
 * nineteen-minute file, so it is a PRICE and cannot be a loss. The layout
 * carries the full derivation.
 *
 * **AND IT MEASURABLY WITHHOLDS, WHICH IS WHAT MAKES ANY OF THAT TRUE.** Built
 * twice with the def tables bound, once with `setCampaignRoster` armed and once
 * without: the player's opening goes 28 buildings / 16 units to **24 / 13** —
 * losing `battleLab`, three `teslaCoil`s, an `apocalypse` and two `attackDog`s
 * — and the Ninth's 31 / 14 to **29 / 12**, losing `battleLab`, a `prismTower`
 * and two `ifv`s. The Sledge Tank really is off the map rather than off a list.
 *
 * An operation about a document should not also be about a tech tier, which is
 * why the asymmetry `soviets.06.demolition-order` shipped — the tower against
 * the silo — is deliberately not repeated here.
 *
 * ============================================================================
 * NO SCRIPTED `eva`, AND THAT IS THE FIRST TIME IN THIS CHAPTER
 * ============================================================================
 * `types.ts` says most scripted announcer lines are punctuation rather than the
 * only source, because `audio.system.ts` already speaks four of the five that
 * shipped operations use. This operation's beats are exactly those four:
 * `buildingCaptured` fires on `building:captured` whenever the local player is
 * either side of it — which is the operation's own win condition — and
 * `structureLost` fires on `entity:killed` for any building the local player
 * owned, which is what a lost block after a capture is. Scripting either would
 * be the redundancy that block names, and there is no `EVA_LINES` key for "a
 * record is leaving the sector". So there is none, and this note is here so the
 * absence reads as a decision.
 *
 * ============================================================================
 * BOTH SHIPPED OUTCOME RULES ARE OFF
 * ============================================================================
 * `annihilationWin` because razing the district is not the order and would
 * declare victory with both blocks still on their books — `Shell.pollOutcome`
 * asks whether every non-allied seat holds zero assets and has no opinion about
 * deeds. `assetLossDefeat` because a commander who has lost his yard and still
 * has a crew on the road with two blocks in reach is the most interesting last
 * act this operation has, and `pollOutcome` would end it at 2 Hz instead. The
 * authored ordinary loss is `playerBeaten`, which is `Viability.isBeaten` —
 * nothing to build with and nothing to fight with — and that is the honest
 * threshold.
 * ========================================================================== */

import { Faction } from '../../../core/types';
import { minutes, seconds } from '../../types';
import type { Condition, OperationDef } from '../../types';
import {
  HALT_AREA, HALT_STAND, OFFICE_AREA, OFFICE_STAND, PUSH, REGISTER, ROAD_A, ROAD_B,
} from '../../layouts/soviets-right-of-entry';

/**
 * THE GEOMETRY IS IMPORTED, NOT RESTATED.
 *
 * The two blocks are placed by the layout and the columns are ordered at them
 * by this file. A number written in two files is a number that will disagree
 * the first time either is tuned, and the failure — a reveal that frames empty
 * ground, a column that lands somewhere nobody authored — is invisible to every
 * gate. `layouts/soviets-right-of-entry.ts` owns the geometry.
 */

/**
 * How long the layout is given to have placed the ground before any threshold
 * over it is believed.
 *
 * **`entityDead` READS TRUE BEFORE A TAG HAS EVER EXISTED**, so an unguarded
 * loss on `entityDead: 'register'` would end this operation in defeat on tick
 * one for a layout that placed nothing — silently, in the direction nobody
 * reports. `soviets.05.short-allocation` and `soviets.06.demolition-order`
 * guard their own zero thresholds with the same constant.
 *
 * **`entityHpBelow` IS THE ONE ENTITY CONDITION THAT DOES NOT NEED IT**, and
 * that is worth writing down rather than guarding out of habit:
 * `WorldQuery.weakestHpFrac` returns **-1** when nothing alive carries the tag
 * and `Director.holds` answers `f >= 0 && f < frac`, so it is FALSE against an
 * empty registry in both directions. The two `entityHpBelow` triggers below
 * carry no settle for that reason.
 *
 * Twenty seconds is unmistakably past the build and unmistakably short of
 * anything being lost: the nearer block is 187.24 m from the player's yard
 * against a starting force that has not moved, and nothing hostile is ordered
 * anywhere before minute four.
 */
const SETTLE: Condition = { on: 'elapsed', ticks: seconds(20) };

/** When Signals places the district office and the window is disclosed. */
const DISCLOSE = minutes(3);

/**
 * The window the hidden secondary pays for. See the header: 26.9 s of walking
 * between the blocks, two guns on the second, and one full ladder.
 */
const WINDOW = seconds(240);

/**
 * The entry is made: both blocks on our books at once.
 *
 * Defined once because four triggers must agree on it — the win, both halves of
 * the shown secondary, and the hidden one — and two copies of a condition are
 * two copies that will disagree the first time either is tuned.
 * `soviets.06.demolition-order`'s `WORKS_GONE` is the same shape for the same
 * reason. It needs no settle: it counts UP from zero and the tag registry
 * cannot make it true early.
 */
const ENTRY_MADE: Condition = {
  on: 'ownerCount', player: 0, role: 'building', tag: 'books', min: 2,
};

/**
 * The wind-up is signed, and it is `parSec` 1140 to the second.
 *
 * The authored par IS the deadline rather than a description of one, which is
 * the only way that field is falsifiable from inside the operation. This
 * chapter's ramp is 780 / 840 / 900 / 960 / 1020 / 1080 / 1140 and
 * `soviets.03.deep-sector` through `.06.demolition-order` all make the same
 * identification.
 */
const CLOSE: Condition = { on: 'elapsed', ticks: minutes(19) };

const op: OperationDef = {
  id: 'soviets.07.right-of-entry',
  chapter: 'soviets',
  faction: Faction.Soviets,
  /*
   * THE NINTH DISTRICT, FOR THE FOURTH OPERATION RUNNING — the administration
   * that filed for the town in S4, signed the revision in S5 and filed the
   * demolition order in S6, and is being wound up for all three. `t.screen`,
   * `t.lane`, `t.press` and `t.last` spawn literal Allied `gi` and `grizzly`,
   * which `validateCampaign` checks against the army of the seat they land on,
   * and the layout puts two Allied `pillbox`es on each block. Two seats, so
   * `op.foe` fills exactly one of them.
   */
  foe: Faction.Allies,
  index: 7,
  title: 'Right of Entry',
  beat: 'The Ninth is being wound up, and the sector\'s whole record leaves with it.',
  primaryType: 'infiltrate',
  /*
   * BESPOKE. Objectives, spawns, orders, reveals, dialogue, a camera move and an
   * outcome — `types.ts` defines the archetype as "multiple effect kinds", and
   * this is NINE of the eleven. The two it does not use are `grantCredits` (both
   * secondaries pay through `ObjectiveDef.credits`, which is the same
   * `Economy.grant` on a rail that `paid` keeps from paying twice across a
   * reload) and `eva` (see the header — every beat this operation has is one the
   * announcer already speaks).
   */
  archetype: 'bespoke',
  parSec: 1140,
  requires: ['soviets.06.demolition-order'],

  map: {
    /*
     * `urban` is `relief` 0.14 / `cliffs` 0.10 — the lowest of BOTH across all
     * seven rows of `MAP_PRESETS`, against next-lowest values of 0.28 and
     * 0.30 — and that is a requirement rather than a change of scene: two
     * structures on
     * literal coordinates, four guns hung off them at literal offsets, and two
     * spawn rings that must all land on passable ground. Both blocks are found
     * at ring zero on this seed. It is also a change of ground after
     * `soviets.06.demolition-order`'s snow; `soviets.04.company-town` is the
     * chapter's other urban row and it is three seats on a different seed.
     *
     * `biome` is `'urban'` and so is the preset — they agree here, which they do
     * NOT for `arid`/`desert`. See `OperationMap.biome`: `getBiome` answers an
     * unknown name with a warning and TEMPERATE, so a mismatch ships a different
     * landform in silence, and `reclamation.03.sold-twice` has already paid for
     * that.
     */
    preset: 'urban',
    biome: 'urban',
    /*
     * CHOSEN ON A MEASURED SWEEP OF TEN, not picked. Counting 4 m cells through
     * the real `Terrain.isPassable(Locomotor.Track)`: 76.61% of the map is
     * track-passable and **92.98%** of the corridor within 40 m of the segment
     * joining the two start spots is, the best of ten against a band of 81.18%
     * to 92.98%. `tests/campaign-maps.spec.ts` builds this operation on this
     * seed and checks that every declared tag landed, so a generator change that
     * re-rolls this ground fails there rather than in a player's match — which
     * makes it loud, not cheap: every distance the two headers quote is a
     * distance on THIS roll.
     */
    mapSeed: 20_260_925,
    /*
     * **IT CHOOSES THE CORNERS.** `seatedSlots` draws a PAIR out of
     * `START_PAIRS` for a two-army match, and 7324 draws **[0, 2]** — the
     * EAST-WEST lane, 296.00 m spot to spot and 288.00 m yard to yard, and
     * neither of the two 386.16 m diagonals this chapter has already used
     * (`soviets.05.short-allocation` [0, 1], `soviets.06.demolition-order`
     * [2, 3]). The layout is handed spots (108, 380) and (404, 380); the
     * CONSTRUCTION YARDS land at (114, 382) and (402, 382), and every distance
     * in this file and in the layout is measured against those yards rather than
     * against the spots. **Change this and they are all different distances.**
     *
     * The shorter lane is the point. This is the operation where the player has
     * to stand on the district's doorstep — the counterpart is 82.97 m from
     * their yard — and 288 m of separation is what makes that a push rather than
     * an expedition.
     */
    simSeed: 7_324,
    armies: 2,
    /*
     * `base`. The operation is a purchase — eight engineers is 4000 credits and
     * `engineer`'s prereqs are `barracks` and `refinery` — so an `mcv` opening
     * would spend the first three minutes of a nineteen-minute file unable to
     * buy the thing the operation is about. The fiction agrees: S1 through S6
     * took this seam and this is the yard that has been working it.
     */
    opening: 'base',
    /*
     * 6000, AND IT BINDS BOTH SEATS — `Shell.startMatch` writes
     * `startingCredits` into every slot, so this is a statement about the
     * operation's economy rather than a handicap.
     *
     * The crew route for both blocks is 4000 of it and the gun route is 1000.
     * That is the fork stated as a bank: two thirds of the opening buys the
     * record without a shot fired at it, and the difference buys an army. It
     * also holds the Ninth to the pace CLAUDE.md names as the single cause of
     * "the AI has a ready base" — a 10 000 opening built a seven-building base
     * with eleven troops by t+90 s having mined nothing.
     */
    credits: 6_000,
  },
  layout: 'soviets-right-of-entry',

  // NEITHER SHIPPED RULE MAY END THIS. See the header: annihilation would
  // declare a win with both blocks still on the district's books, and
  // `assetLossDefeat` would end this operation's best last act at 2 Hz.
  outcome: { annihilationWin: false, assetLossDefeat: false, ignoreSeats: [] },

  /*
   * EMPTY IS A RESTRICTION, NOT AN ABSENCE, and here it is also what makes the
   * layout's 10.41 m collateral figure true — `unit.specialist` withheld takes
   * the Sledge Tank's 2.2 m splash off the map, which leaves the UNGATED
   * `flameTower`'s 3.2 m as the largest blast on land. The full argument, and
   * the Airstrike that is the one exception to it, are in the header.
   */
  roster: { player: [], ai: [] },

  objectives: [
    {
      id: 'entry',
      kind: 'primary',
      title: 'Take the district register and its counterpart, both standing',
    },
    {
      id: 'legible',
      kind: 'secondary',
      title: 'Make the entry with neither part burnt',
      credits: 500,
    },
    {
      id: 'clean',
      kind: 'secondary',
      hidden: true,
      title: 'Take the second part before the loss of the first is written up',
      credits: 400,
    },
  ],

  triggers: [
    /* -- the orders -------------------------------------------------------
     * Three beats at four, eighteen and thirty-four seconds rather than six
     * lines at once: the shell renders dialogue as toasts, and
     * `Shell.campaignBeatSeq` sequences two lines from one speaker but cannot
     * make a stack of six readable.
     *
     * THE CAMERA MOVE IS THE REVEAL AND IT IS THE ONLY ONE IN THIS FILE.
     * `cameraMove` takes the camera off whatever the player was doing, so
     * `types.ts` reserves it for an arrival, a loss or a reveal and forbids it
     * as punctuation. This is the reveal: the thing the operation is about,
     * shown once, before the player has begun anything.
     */
    {
      id: 't.brief',
      when: { on: 'elapsed', ticks: seconds(4) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Rakhalt',
          text: 'The demolition order is withdrawn and the branch has closed the file on the '
            + 'Ninth. They are being wound up in this sector — and the sector is whatever their '
            + 'record says it is, so the record is what leaves on the branch line.',
        },
        { do: 'revealArea', player: 0, area: HALT_AREA },
        { do: 'cameraMove', at: REGISTER },
      ],
    },
    {
      id: 't.orders',
      when: { on: 'elapsed', ticks: seconds(18) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'They keep it in two parts, in two blocks, because an administration that keeps '
            + 'both in one building has to explain a fire. The part is in the block at the '
            + 'freight halt. The counterpart is at their district office and Signals has not '
            + 'placed it yet.',
        },
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'Both, standing. A block in rubble is not a record — burn one and the seam goes '
            + 'back to being two claims with no paper on our side of it, which is what the Ninth '
            + 'wanted when it filed to level the ground.',
        },
      ],
    },
    {
      id: 't.crew',
      when: { on: 'elapsed', ticks: seconds(34) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'Four men a book. Three to get the doors off and a fourth to walk the ledger '
            + 'out, and none of them comes back. Walk them in one at a time and keep them '
            + 'close — the district has a maintenance gang and it puts a door back on in ten '
            + 'seconds.',
        },
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'And keep your guns off the blocks. Anything with a barrel will start on one the '
            + 'moment there is nothing else in range. Put the escort on hold fire before it goes '
            + 'in.',
        },
      ],
    },

    /* -- the office, placed --------------------------------------------------
     * Minute three, before the first wave lands and before any realistic
     * capture. `hidden` objectives are filtered out of the briefing
     * (`briefingObjectives`), so the window really is a surprise — and it
     * arrives at the moment it becomes a decision rather than a line the player
     * read before the match started.
     *
     * THE REVEAL IS NOT A NO-OP, WHICH IS WHY `HALT_AREA` IS r=40. That disc
     * stops 51.39 m short of the office block at 91.39 m, and `revealArea` is
     * `Vision.exploreCircle`, which is PERMANENT — a disc that had already
     * covered it would make this beat a reveal of ground the player has been
     * looking at since four seconds. `soviets-short-allocation` records the same
     * trap for its third wave.
     */
    {
      id: 't.disclose',
      when: { on: 'elapsed', ticks: DISCLOSE },
      then: [
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'Signals has the office. The second block is behind the halt, on their own '
            + 'doorstep, and the counterpart does not leave the sector until the wind-up is '
            + 'signed.',
        },
        { do: 'revealArea', player: 0, area: OFFICE_AREA },
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'One more thing off their traffic. A district writes its losses up four minutes '
            + 'after it has them. Take the second part inside that and there is nothing on paper '
            + 'anywhere saying the sector was ever contested.',
        },
        { do: 'setObjective', id: 'clean' },
      ],
    },

    /* -- the screen ---------------------------------------------------------
     * Minute four, unconditional. A wave that fires only when the player is
     * elsewhere reads as the map cheating; a schedule the world keeps whatever
     * the player is doing reads as an opponent.
     *
     * IT FORMS AT THE LANE ROAD AND THE ORDER IS A HEADING, NOT A LEASH.
     * `AiBrain.regroupSquads` files every untagged hull the seat owns into a
     * squad on its next pass, so the attack-move is the first thing these six do
     * and the brain owns them after that. What the wave buys is that the
     * district's army is 99.64 m from its own gate and 62.51 m from the halt at a
     * known minute — read it as the Ninth screening faster than it could build,
     * which is what `soviets-deep-sector` established about scripted waves on an
     * AI seat.
     *
     * `HALT_STAND`, NOT `REGISTER`. See THE ORDER POINT IS NOT THE BLOCK in the
     * header: this order used to name the block's own cell, so the wave's
     * designed end state was the wall of the record, where `applySplash` clamps
     * `surface` to zero. It stands 26.68 m off now, walking 36.06 m from its
     * ring, and both the stand point and the ring are inside the reveal above.
     *
     * LITERAL ALLIED KEYS. `EffectSink.spawnUnits` resolves through
     * `ProductionCatalog.byKey` and remaps nothing, unlike the layout's
     * `ScenarioBuilder.spawnUnit`; `validateCampaign` checks each key against the
     * army of the seat it lands on, so a Soviet key here is a build error.
     */
    {
      id: 't.screen',
      when: { on: 'elapsed', ticks: minutes(4) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Wend, intercepted',
          text: 'Screen the halt. The wind-up is signed on Friday and I am not the one '
            + 'explaining to the branch why the district record left the sector in somebody '
            + 'else\'s hands.',
        },
        { do: 'revealArea', player: 0, area: { x: ROAD_A.x, z: ROAD_A.z, r: 42 } },
        { do: 'spawnUnits', player: 1, key: 'gi', count: 4, at: ROAD_A, spread: 20, tag: 'screen' },
        { do: 'spawnUnits', player: 1, key: 'grizzly', count: 2, at: ROAD_A, spread: 14, tag: 'screen' },
        { do: 'orderTagged', tag: 'screen', order: 'attackMove', at: HALT_STAND },
      ],
    },

    /* -- the gate is reached, said once --------------------------------------
     * `entityHpBelow` reads the WEAKEST live entity carrying the tag, so this
     * fires the first time either block reaches the capture gate — by three
     * softens (which skip 0.50 and land on 0.40) or by gunfire. The player
     * cannot see a health fraction to four decimals and the difference between
     * "capturable" and "burning" is 200 hp, so the operation says it out loud.
     *
     * NO SETTLE. See `SETTLE` above: `weakestHpFrac` answers -1 for an empty tag
     * and `Director.holds` requires `f >= 0`, so this is the one entity
     * condition that is already false on tick one.
     */
    {
      id: 't.gate',
      when: { on: 'entityHpBelow', tag: 'books', frac: 0.5 },
      then: [
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'That one will take a man now. Anything past this is paper you are burning.',
        },
      ],
    },

    /* -- and the fire ---------------------------------------------------------
     * `BURN_HP_THRESHOLD` is 0.25 and `EntityFlag.Burning` is set at or below
     * it, so this is the tick the block catches. It burns at `BURN_DPS` 4
     * through `ARMOR_MATRIX[HighExplosive][Concrete]` 1.00 and
     * `COMBAT_DAMAGE.globalMul` 0.80 — 3.2 hp a second, 62.5 s from here to
     * nothing on an 800 hp block.
     *
     * **THAT MINUTE IS THE FIRE'S CLOCK AND IT IS NOT THE PLAYER'S, AND THE
     * FIRST DRAFT OF THIS LINE QUOTED IT AS THOUGH IT WERE.** A block only
     * reaches 0.25 because something put it there, and the likeliest something
     * is a wave this file scheduled. `lightCannon` is 55 `ArmorPiercing` on a
     * 1.5 s cooldown, so 55 x 0.55 x 0.80 = 24.2 a shot and **16.13 dps a
     * Grizzly**: the three in `t.press` cover the last 200 hp in **4.13 s** and
     * the four in `t.last` in **3.10 s**. `REPAIR_RATE` is 30 hp a second, so
     * the wrench loses to either — the remedy this line used to name does not
     * work while the guns are still on it.
     *
     * So the line states BOTH clocks and puts them in the right order, and the
     * remedy itself has moved up to `t.halt` and `t.office`, which is the moment
     * a player can act on it rather than four seconds from a loss. The two ways
     * out are still real and still exactly two: an engineer walked into a block
     * you own sets `hp = maxHp` instantly (`Capture.ts` rule 3), and the wrench
     * does it at `REPAIR_COST_PER_HP` 0.25 a point.
     *
     * **A SECOND TRIGGER ON "THE BLOCK IS UNDER FIRE" WAS CONSIDERED AND IS NOT
     * WRITABLE.** The twelve conditions are frozen and none of them reads a
     * damage event; `entityHpBelow` is the only one that sees a block's health
     * at all, and it fires on a LEVEL rather than on a rate, so it cannot tell
     * a fire from a Grizzly. Adding one would be a schema change across every
     * operation file for a line of dialogue. The wording carries it instead,
     * which is the same trade `t.gate` already makes for the capture threshold.
     */
    {
      id: 't.alight',
      when: { on: 'entityHpBelow', tag: 'books', frac: 0.25 },
      then: [
        {
          do: 'dialogue',
          speaker: 'Rakhalt',
          text: 'One of the blocks is alight. The fire on its own gives us about a minute — '
            + 'anything still shooting it gives us seconds. Get the guns off it before you put '
            + 'anybody near it. A wrench does not outrun armour.',
        },
      ],
    },

    /* -- the deeds, and the remedy belongs HERE -------------------------------
     * `structureCaptured` is `ownerOfTag(tag) === player`, which is the only
     * condition in the vocabulary that names a change of hands directly, and
     * this is the only operation in the chapter that uses it. Both beats are
     * written so either order reads: the player may take the office first.
     *
     * **THE WARNING USED TO BE HERE AND THE REMEDY FOUR SECONDS FROM DEFEAT.**
     * `t.halt` named the threat — *"the district will shoot it the moment it
     * works out whose it is"* — and no answer to it, while `t.alight` named the
     * wrench and the engineer at `frac` 0.25, which under a scripted wave is
     * 3.10 to 4.13 s from `t.burnt` firing `endOperation('loss')` with no grace
     * and no recovery. A remedy a player first hears with four seconds left is a
     * remedy they cannot use. Both are stated at the moment of CAPTURE now,
     * which is the moment there is something to defend and time to arrange it.
     *
     * BOTH BEATS CARRY IT IN FULL, deliberately, rather than the second one
     * saying "same rule as the halt": the player may take the office first, and
     * a cross-reference to a line they have not heard is worse than a repeat.
     * Two lines from one speaker is what `Shell.campaignBeatSeq` sequences — a
     * third would be the stack it cannot make readable.
     *
     * NO SCRIPTED `eva`. `audio.system.ts` says `buildingCaptured` on
     * `building:captured` whenever the local player is either side of it, so
     * this moment is already announced.
     */
    {
      id: 't.halt',
      when: { on: 'structureCaptured', tag: 'register', player: 0 },
      then: [
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'The halt block is ours, and it is ours to keep standing now — the district will '
            + 'shoot it the moment it works out whose it is.',
        },
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'Put a wrench on it and hold an engineer back. A man walked into a block we own '
            + 'sets it right where it stands. Neither of those beats armour parked on the wall, '
            + 'so keep something between the wall and their road.',
        },
      ],
    },
    {
      id: 't.office',
      when: { on: 'structureCaptured', tag: 'counterpart', player: 0 },
      then: [
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'Office block is ours. Wrench on it, and hold a man back — an engineer walked '
            + 'into a block we own sets it right where it stands.',
        },
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'And it is on their doorstep, so whatever they still have will be on it. Neither '
            + 'the wrench nor the man beats armour parked on the wall. Keep it off the wall.',
        },
      ],
    },

    /* -- down the middle ------------------------------------------------------
     * Minute eight, off the OTHER bearing — `ROAD_B` sits 62.61 m from their yard
     * on the office side and 146.12 m from `ROAD_A` — and aimed at `PUSH`, the
     * contested patch `addStartOre` lays on the midpoint of the two openings.
     * That is the ground a player working at the halt has to cross and then
     * leave behind, so this is a wave at the PLAYER rather than a second helping
     * of the first.
     */
    {
      id: 't.lane',
      when: { on: 'elapsed', ticks: minutes(8) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Wend, intercepted',
          text: 'Second troop, off the office road and straight down the middle. If they are '
            + 'standing on our halt they are not standing on anything of their own.',
        },
        { do: 'revealArea', player: 0, area: { x: ROAD_B.x, z: ROAD_B.z, r: 42 } },
        { do: 'spawnUnits', player: 1, key: 'gi', count: 5, at: ROAD_B, spread: 20, tag: 'lane' },
        { do: 'spawnUnits', player: 1, key: 'grizzly', count: 3, at: ROAD_B, spread: 14, tag: 'lane' },
        { do: 'orderTagged', tag: 'lane', order: 'attackMove', at: PUSH },
      ],
    },

    /* -- back onto the halt --------------------------------------------------- */
    {
      id: 't.press',
      when: { on: 'elapsed', ticks: minutes(12) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Wend, intercepted',
          text: 'Everything that can leave the yard, back onto the halt. Whatever is in that '
            + 'block leaves the sector with me or it does not leave at all.',
        },
        { do: 'spawnUnits', player: 1, key: 'gi', count: 5, at: ROAD_A, spread: 20, tag: 'press' },
        { do: 'spawnUnits', player: 1, key: 'grizzly', count: 3, at: ROAD_A, spread: 14, tag: 'press' },
        { do: 'orderTagged', tag: 'press', order: 'attackMove', at: HALT_STAND },
      ],
    },

    /* -- and onto the office --------------------------------------------------
     * Minute sixteen, three minutes from the close, at the block the player is
     * least likely to have finished with. `OFFICE_STAND` rather than
     * `COUNTERPART`, for the reason under THE ORDER POINT IS NOT THE BLOCK in
     * the header: an order at the block's own cell makes the wall of the record
     * the wave's designed end state, and every splash shell fired at a hull
     * standing there is a splash shell in the block at `falloff` 1.0. The stand
     * point is 27.78 m off, which still puts an engineer at the office door
     * inside `lightCannon`'s 24 m — the column denies the second ladder without
     * being a relay into the thing the operation is about.
     */
    {
      id: 't.last',
      when: { on: 'elapsed', ticks: minutes(16) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Wend, intercepted',
          text: 'Onto the office. Three minutes and the wind-up is signed, and after that they '
            + 'are stealing branch property in front of a witness.',
        },
        { do: 'spawnUnits', player: 1, key: 'gi', count: 4, at: ROAD_B, spread: 20, tag: 'last' },
        { do: 'spawnUnits', player: 1, key: 'grizzly', count: 4, at: ROAD_B, spread: 14, tag: 'last' },
        { do: 'orderTagged', tag: 'last', order: 'attackMove', at: OFFICE_STAND },
      ],
    },

    /* -- the close, telegraphed ----------------------------------------------- */
    {
      id: 't.closing',
      when: { on: 'elapsed', ticks: minutes(17.5) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'Ninety seconds. After the wind-up is signed the record is branch property and '
            + 'we are burglars rather than an administration.',
        },
      ],
    },

    /* -- the window closes ----------------------------------------------------
     * THE ARMING PASS IS DOING THE WORK AND IT IS WORTH READING TWICE. With
     * every `elapsedSinceArmed` forced true this tree reduces to "three minutes
     * have passed and the player owns exactly one block", so the arm tick is set
     * the moment the first deed lands and DELETED the moment the second does —
     * which is why this can never fire on the winning tick and needs no
     * `objectiveComplete` guard to say so.
     *
     * `min: 1` alongside `max: 1` is the tick-one guard verbatim: a bare
     * `max: 1` reads TRUE against a world with no blocks in it at all.
     * `DISCLOSE` is conjoined so the window cannot start before the player has
     * been told it exists — a rush that took a block at two and a half minutes
     * would otherwise be racing a clock nobody had mentioned.
     */
    {
      id: 't.cleanMissed',
      when: {
        on: 'all',
        of: [
          { on: 'elapsed', ticks: DISCLOSE },
          { on: 'ownerCount', player: 0, role: 'building', tag: 'books', min: 1, max: 1 },
          { on: 'elapsedSinceArmed', ticks: WINDOW },
        ],
      },
      then: [
        { do: 'failObjective', id: 'clean' },
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'The first loss is written up. Whatever we take now, the Ninth can point at a '
            + 'gap in it and ask what happened in between.',
        },
      ],
    },

    /* -- the secondaries resolve FIRST ----------------------------------------
     * ABOVE `t.win`, deliberately: `runDirector` returns early once an outcome
     * is set, so anything that resolves at the entry has to resolve before the
     * operation ends or the medal does not count it. Same ordering rule
     * `soviets-deep-sector` states for `t.mastsDown`, `04-company-town` for
     * `t.five` and `06-demolition-order` for `t.infirmaryKept`.
     *
     * `t.clean` cannot fire after `t.cleanMissed` has: the objective is `failed`
     * and `not(objectiveFailed)` reads the state the tick began with, which
     * `Director.runDirector` never mutates mid-pass.
     */
    {
      id: 't.clean',
      when: {
        on: 'all',
        of: [
          ENTRY_MADE,
          { on: 'not', of: { on: 'objectiveFailed', id: 'clean' } },
        ],
      },
      then: [
        { do: 'completeObjective', id: 'clean' },
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'Both halves before either loss was entered. As far as the district\'s own paper '
            + 'goes, nothing happened here this morning.',
        },
      ],
    },
    /*
     * BOTH HALVES OF THE SHOWN SECONDARY, AND THEY ARE MUTUALLY EXCLUSIVE BY
     * CONSTRUCTION — one wants the weakest block at or above 0.25 and the other
     * below it, so no tick satisfies both and the file order between them
     * decides nothing.
     */
    {
      id: 't.legible',
      when: {
        on: 'all',
        of: [
          ENTRY_MADE,
          { on: 'not', of: { on: 'entityHpBelow', tag: 'books', frac: 0.25 } },
        ],
      },
      then: [
        { do: 'completeObjective', id: 'legible' },
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'Both parts readable end to end. The branch can go through it page by page and '
            + 'find nothing to argue with.',
        },
      ],
    },
    {
      id: 't.illegible',
      when: {
        on: 'all',
        of: [
          ENTRY_MADE,
          { on: 'entityHpBelow', tag: 'books', frac: 0.25 },
        ],
      },
      then: [
        { do: 'failObjective', id: 'legible' },
        {
          do: 'dialogue',
          speaker: 'Rakhalt',
          text: 'Half of one of them is ash. The entry stands and somebody at the branch is '
            + 'going to ask what we were doing to it.',
        },
      ],
    },

    /* -- the entry is made ----------------------------------------------------
     * It cannot tie with the loss below: `t.burnt` needs one of the two blocks
     * gone and this needs both of them standing on our books, so no tick
     * satisfies a win and a loss at once.
     */
    {
      id: 't.win',
      when: ENTRY_MADE,
      then: [
        { do: 'completeObjective', id: 'entry' },
        {
          do: 'dialogue',
          speaker: 'Rakhalt',
          text: 'The part and the counterpart, in one pair of hands for the first time since the '
            + 'Split. The sector is ours because the only record of it says so, and nobody has '
            + 'to win an argument about the ground ever again.',
        },
        { do: 'endOperation', result: 'win' },
      ],
    },

    /* -- a block goes ---------------------------------------------------------
     * THE ONE LOSS THIS OPERATION IS REALLY ABOUT. Either block levelled — by
     * the player's guns, by an escort nobody put on hold fire, or by a fire
     * nobody put out — and the entry cannot be made at all. `entityDead` is the
     * right condition rather than `ownerCount`: a block the player has CAPTURED
     * is still alive and still counts, and only its destruction ends this.
     *
     * `SETTLE` is the tick-one guard. `entityDead` reads TRUE before a tag has
     * ever existed, so a layout that placed nothing would lose the operation on
     * the first tick the Director runs, in silence.
     */
    {
      id: 't.burnt',
      when: {
        on: 'all',
        of: [
          SETTLE,
          {
            on: 'any',
            of: [
              { on: 'entityDead', tag: 'register' },
              { on: 'entityDead', tag: 'counterpart' },
            ],
          },
        ],
      },
      then: [
        { do: 'failObjective', id: 'entry' },
        {
          do: 'dialogue',
          speaker: 'Rakhalt',
          text: 'That block is gone and the entry with it. The seam goes back to being two claims '
            + 'and no paper — which is what the Ninth has been trying to buy since the spring.',
        },
        { do: 'endOperation', result: 'loss', reason: 'entry' },
      ],
    },

    /* -- the wind-up is signed ------------------------------------------------
     * The hard deadline, at `parSec` to the second. There is deliberately NO
     * early-out arm on it — `soviets.05.short-allocation` puts one on its close
     * and this operation must not. `Viability.isBeaten` is "nothing to build
     * with and nothing to fight with", and a record block is neither, so the
     * Ninth can be beaten with both blocks still on their books; an authored
     * early-out would end the operation in a WIN with the objective unmet. In
     * that state the player simply walks their crew up and takes them, which is
     * the correct amount of work for a district that has already been destroyed.
     *
     * BELOW `t.win`, so a deed that lands on the closing tick wins. The ground
     * beats the paperwork — `soviets.03.deep-sector` and `.04.company-town` both
     * say that about their own deadlines, and this is the operation where the
     * ground IS paperwork.
     */
    {
      id: 't.signed',
      when: CLOSE,
      then: [
        { do: 'failObjective', id: 'entry' },
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'Wind-up is signed. The record is on the branch line and the sector is whatever a '
            + 'Continental office decides to make of somebody else\'s handwriting.',
        },
        { do: 'endOperation', result: 'loss', reason: 'entry' },
      ],
    },

    /* -- the ordinary loss ----------------------------------------------------
     * `playerBeaten` is `Viability.isBeaten` — nothing to build with and nothing
     * to fight with — not "you have no buildings". A commander whose yard is gone
     * while a crew is still on the road is not beaten, and this operation would
     * like that to be a position somebody can play from.
     */
    {
      id: 't.beaten',
      when: {
        on: 'all',
        of: [
          SETTLE,
          { on: 'playerBeaten', player: 0 },
        ],
      },
      then: [
        { do: 'failObjective', id: 'entry' },
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'Nothing answering from the sector. They will not even have to hurry the train.',
        },
        { do: 'endOperation', result: 'loss', reason: 'entry' },
      ],
    },
  ],
};

export default op;
