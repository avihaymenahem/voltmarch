/**
 * ============================================================================
 * R1 — HELD PAPER
 * ============================================================================
 * Survey 41-207 is a working industrial district with a garrison sitting on it.
 * Four of its breaking yards are already Tallow's — on paper, in the delivery
 * notes the garrison has been countersigning for eleven months, and in world
 * state from tick one. Nobody has read one.
 *
 * ============================================================================
 * THE BEAT IS DELIVERED BY THE STARTING POSITION, NOT BY THE TRIGGER TABLE
 * ============================================================================
 * "The yards are already yours, nobody has noticed" is the hardest premise in
 * chapter one because it is not a fight, and the failure mode is obvious: two
 * even armies facing each other with a line of dialogue over the top. So the
 * script here is deliberately thin and the LAYOUT does the work.
 *
 * The player opens with **no base**. Four lots, one structure each, one
 * FUNCTION each, strung 180 m through an enemy city and none of them within
 * sight of another:
 *
 *     Furnace   80 power, and the only 80 there is
 *     Foundry   the only builder, and the only 56 m build radius
 *     Sorter    the only income, with its Scrapjaw and its field
 *     Rookery   the only producer of any kind — infantry, and nothing else
 *
 * Every one of those projects its own build space, so the player can build in
 * four places at once and hold none of them. **That is a position a skirmish
 * cannot produce**, and it is what makes minute three a decision rather than a
 * build order: the bank is 3000 and a Breaker Yard is 1900, so the player
 * either commits 63% of everything they have to owning hulls, or spends it on
 * Slaggers out of a Rookery they already hold and fights this city on foot.
 *
 * There is no reinforcement wave on a timer, no scripted ambush and no camera
 * tour. The one spawn in the file fires only if the player has already lost a
 * yard, and it is a consolation rather than a beat.
 *
 * ============================================================================
 * THE ALARM IS A LEVER THE PLAYER PULLS
 * ============================================================================
 * `t.noticed` fires on the FIRST DAMAGE to either the office mast or its
 * transformer — `entityHpBelow` at 0.99, which is the cheapest possible reading
 * of "somebody took a shot" — or at six minutes, whichever comes first. Its
 * effect is to walk the office's watch detachment off its post and send it at
 * the player's deepest yard.
 *
 * So opening fire makes the objective EASIER and the player's economy HARDER,
 * at the same instant, at a moment the player chooses. Nothing else in the
 * operation is timed, because a timer would take that choice back.
 *
 * The six-minute ceiling exists so a player who never fires still meets the
 * garrison; without it the arming predicate would never hold and the trigger
 * would be dead content on a passive run.
 *
 * ============================================================================
 * THE HIDDEN SECONDARY WAS A BLACKOUT. IT IS A CAPTURE, AND THE BLACKOUT IS
 * MEASURED DEAD RATHER THAN QUIETLY DROPPED
 * ============================================================================
 * **THE REFUTED CLAIM, KEPT BECAUSE IT SHIPPED AND BECAUSE IT IS THE OBVIOUS
 * ONE TO RE-DERIVE.** This block used to read: a structure that DRAWS power and
 * is dark cannot fire, the office's two specialist towers draw and its two
 * concrete boxes are `power: 0`, so cutting the transformer silences the good
 * half of the compound and leaves the cheap half firing. Every sentence of that
 * is true about `src/sim/Power.ts` and `src/sim/Combat.ts`. **None of it
 * happens here**, and TWO INDEPENDENT WALLS stop it — one of which no layout
 * can move.
 *
 * The instrument for everything below is `tests/campaign-maps.spec.ts`'s
 * builder with the def tables bound and this operation's own roster installed,
 * driven first through the real `PowerGrid.recompute`/`shed` and then through
 * the real `AiDirector` for fourteen sim-minutes at `aiDifficulty` 1 (Normal,
 * the lobby default), at this operation's own seeds.
 *
 * **WALL 1 — THE DEFICIT IS TOO SMALL, AND ITS CEILING IS THE OPPONENT'S OWN
 * DOCTRINE.** `PowerGrid` is PER PLAYER, not per lot: there is no such thing as
 * "one transformer feeding both towers", only one seat's supply against that
 * seat's draw. Seat 1 opens at **supply 700 against draw 585** — seven
 * `powerPlant` (six in `buildSovietBase`'s core, one tagged `transformer` in the
 * compound) against five `teslaCoil` at -75, two `flameTower`, a `radar`, a
 * refinery, a war factory, a barracks, two silos and the yard. Taking the
 * transformer leaves **600 against 585**, and `shed` runs only when
 * `consumed > produced`, so nothing sheds and the objective completes anyway,
 * because `t.dark` reads the transformer and not the towers.
 *
 * Lowering that opening margin does not help, and the reason is the opponent
 * rather than the arithmetic. `shed` walks `POWER_SHED_ORDER.defence` while
 * `covered < deficit`, so darkening BOTH towers needs a deficit ABOVE one
 * tower's own draw — 75 — which needs the margin under 25 at the moment of the
 * cut. `AI_ECONOMY.powerHeadroom` is **40**, and the power interrupt is the
 * first thing `AiBrain.chooseBuild` considers — ahead of the scripted opening
 * and every scored candidate, with no difficulty gate on it. So a margin under
 * 25 is a state the garrison actively repairs, and it does:
 *
 *     lever                      margin t=0   margin t+1 min   seat-1 plants
 *     shipped layout                 115          165          7 -> 8
 *     one base plant removed          15          195          6 -> 8
 *     two base plants removed        -85          195          5 -> 8
 *
 * Both of the levers that look available are in that table, and both are
 * **undone inside the first minute** — long before a player whose nearest unit
 * is 104.8 m from the compound can reach it. The second one also opens the
 * garrison browned out, which is a different mission.
 *
 * Over the full fourteen minutes the shipped trace never falls below **65**
 * (115, 165 x5, 135, 215, 135 x3, 95 x3, 65), so **the deepest deficit this cut
 * can ever produce is 35 — under half of one tower's draw** — and it is
 * NEGATIVE at eleven of the fifteen samples, i.e. most of the match produces no
 * deficit at all. A `powerPlant` is also **300 credits
 * and eight seconds** against a garrison that mined 26 600 ore in that window,
 * so the denial is not a beat either.
 *
 * **WALL 2 — THE WRONG TOWERS GO DARK ANYWAY.** Seat 1 owns FIVE `teslaCoil`,
 * not two: `SOVIET_DEFENCE` puts three on the line at the garrison base. All
 * five draw 75, and `shed` sorts by (priority, draw descending, slot ascending)
 * — so the base's three, spawned first, are permanently ahead of the compound's
 * two. Driven at an induced deficit of 85, the real `shed` darkened the coils at
 * (402, 154) and (390, 142) — **at the base, 116 m and 110 m from the office
 * mast** — and left both compound towers lit. The garrison never builds a sixth
 * over fourteen minutes, so that ordering is fixed for the whole match.
 *
 * **WHAT WOULD ACTUALLY WORK, AND WHY IT WAS REFUSED.** Beating the measured
 * margin CEILING of 215 needs three tagged plants (300 of supply), and clearing
 * wall 2 needs `buildBaseFor(..., { defended: false })`. That prices the
 * secondary at three 800-hp structures instead of one — 6000 credits of Tinker
 * at the four-per-structure rate measured below — against a garrison base
 * stripped of three Tesla Coils, two Flame Towers and nine wall segments; and
 * the deep end of the resulting shed (deficit up to 235) walks past the two
 * towers into the mast, both silos and the war factory, which halts the
 * opponent's Vehicles tab. That last figure is DERIVED rather than measured,
 * because the configuration was refused before it was built. It is a large
 * change to the fight in both directions to buy a hidden 400-credit secondary.
 *
 * **NO LAYOUT CHANGE THAT ONLY MOVES POWER CAN REACH THIS, BECAUSE NEITHER
 * BOUND IS A LAYOUT VARIABLE**: 100 is a `powerPlant`, 75 is the `teslaCoil`
 * these two towers resolve to, and 40 is doctrine in `src/core/config.ts`. The
 * layout is therefore UNCHANGED, and what changed is the two lines that
 * described a mechanism the world does not have.
 *
 * **SO THE SECONDARY PAYS IN THE ONE CURRENCY THIS OPERATION IS SHORT OF, AND
 * IT ALREADY DID.** A captured `powerPlant` is **100 power on a seat whose whole
 * supply is the Furnace's 80** — measured 80 -> 180, more than doubling it — on
 * the operation whose minute-three decision is a 1900-credit Breaker Yard
 * drawing 40 against an opening margin of 10. See THE TRANSFORMER IS THE ONE
 * ANYBODY WOULD ACTUALLY WANT below: the lure was already there and already
 * true, and it is what the reveal names now instead of a blackout.
 *
 * **THE `dark` IDS STAY.** `t.dark` and the objective row keep the name the
 * blackout gave them, because they are identifiers rather than claims and the
 * trigger itself is correct — it counts what seat 1 still owns, which is
 * exactly the deed the objective is named after. Renaming them would edit two
 * effects and a trigger to buy nothing.
 *
 * `t.dark` requires the transformer off the garrison's books **while the mast
 * is still theirs**. Take them in the other order and the objective simply
 * never completes; that is the honest reading of "before the mast falls" and it
 * needs no extra condition — the two halves are exact complements over one
 * count, so nothing can hold both.
 *
 * ============================================================================
 * EVERY THRESHOLD OVER THE COMPOUND COUNTS DEEDS, AND THEY COUNTED CORPSES
 * ============================================================================
 * `t.win` and `t.yardsKept` were `entityDead 'office'` and `t.dark` was
 * `entityDead 'transformer'`, and **a captured structure is still alive** —
 * `aliveWithTag` counts it. Both are garrison-owned buildings with the capture
 * cursor over them (`input/Commands.ts` §5, the `hoverEnemy` arm): the office
 * mast is a `radar` at 700 hp and the transformer a `powerPlant` at 800.
 * `annihilationWin` is false and nothing else in the table ends this operation
 * in a win, so an engineer walked into the mast produced a match that could not
 * be won — and one walked into the transformer produced a 400-credit secondary
 * that could no longer be collected.
 *
 * **AND THE PLAYER CAN DO IT FROM TICK ZERO, WHICH IS NOT OBVIOUS ON AN
 * OPERATION WITH NO BASE.** `rclTinker` carries no `UNLOCK_TAGS` row, so
 * `roster.player: ['unit.raider']` cannot withhold it, and its two prereqs are
 * `rclRookery` and `rclSorter` — which are two of the four lots the player
 * opens holding. The Rookery is `producesTab: BuildTab.Infantry` and lists
 * `rclTinker` among its `produces`, and the four lots draw 70 against the
 * Furnace's 80, so nothing is dark and nothing stalls. A Tinker is 500 credits
 * of a 3000 bank: six of them, or one plus the nine Scrap Pickers the player
 * already owns.
 *
 * **THE ENGINEER-ONLY PRICE IS FOUR, NOT ONE, AND IT WAS MEASURED RATHER THAN
 * REASONED.** `CaptureService.isCapturable` carries no health test, but
 * `resolve` does: above `CAPTURE.captureHpFrac` (0.5) an ENEMY structure takes
 * the SOFTEN branch — `maxHp * CAPTURE.softenFrac` (0.25) as a HighExplosive
 * damage record, through `ARMOR_MATRIX[HighExplosive][Concrete]` (1.00) and
 * `COMBAT_DAMAGE.globalMul` (0.80), so **0.20 of max lands and the Tinker is
 * consumed**. Driven through the real `CaptureService` and the real
 * `DamageSystem`, the 700 hp office walks 700 -> 560 -> 420 -> 280 and the
 * 800 hp transformer 800 -> 640 -> 480 -> 320; the fourth Tinker takes either.
 * **2000 credits, two thirds of the opening bank** — or one Tinker behind any
 * gun that has already halved it.
 *
 * **THE TRANSFORMER IS THE ONE ANYBODY WOULD ACTUALLY WANT.** This operation's
 * opening line is that the Furnace is *"the only 80 there is"*, and a captured
 * `powerPlant` is 100 more — more than doubling the player's supply, on the
 * operation whose minute-three decision is whether to spend 63% of the bank on
 * a Breaker Yard. The lure is not hypothetical; it is the thing the position is
 * built to make the player want.
 *
 * So every threshold over the compound counts DEEDS now — `ownerCount` on
 * seat 1 — and **capture satisfies both objectives exactly as demolition does.**
 * That changes what they MEAN, so the primary's title, the hidden secondary's
 * title and four of Tallow's and Cregg's lines were rewritten rather than left
 * implying a rule the table no longer enforces. `soviets.01.first-tap` and
 * `soviets.03.deep-sector` made the same migration for the same reason.
 *
 * **`t.noticed` KEEPS `entityHpBelow` AND NEEDS NO MIGRATION AT ALL**, which is
 * worth stating because it is the one trigger here that looks like it should
 * move. It reads DAMAGE — "somebody has taken a shot at it" — and a capture is
 * damage: the soften branch is the only door onto an enemy structure at full
 * health, so an engineer walking into the office trips the alarm on the tick he
 * arrives, exactly as a rifle round would. The lever the player pulls is the
 * same lever.
 *
 * ============================================================================
 * WHAT THE THREE FIXED NUMBERS ARE DOING
 * ============================================================================
 * **`credits: 3000` binds BOTH seats.** `Shell.applySimPostBoot` writes
 * `setup.startingCredits` into every non-Neutral slot, so this is not a handicap
 * — it is one number doing two jobs. It makes the Breaker Yard a commitment for
 * the player, and it slows the garrison's opening for exactly the reason the
 * measured 10 000-credit block in CLAUDE.md gives: a brain with a full bank
 * builds a seven-building base and eleven troops before it has mined an ore.
 * A district that has not noticed anything should not be doing that.
 *
 * **`roster` is asymmetric and both halves are load-bearing.** The garrison has
 * `struct.defence.specialist`, which is what puts the two specialist towers in
 * the compound — remove that line and `spawnBuilding` refuses them and the
 * compound's approach face is two concrete boxes and a wall. That reason USED
 * to be "the hidden secondary has nothing to switch off"; the secondary
 * switches nothing off, and the towers are load-bearing as the compound's teeth
 * rather than as its fuse. The player has `unit.raider` and
 * nothing else, which is a Reclamation Arcspitter: fast, sixteen metres of
 * reach, no armour, and **only reachable by building the Breaker Yard**. The
 * grant is therefore an argument for the expensive branch rather than a gift.
 *
 * **`mapSeed` is the survey designation.** 41 207 is the number in the
 * briefing. It is pinned by `tests/campaign-maps.spec.ts` as a terrain
 * fingerprint, and a generator change that re-rolls this ground moves both the
 * road lattice the composition is laid across and the four measured points
 * below.
 *
 * ============================================================================
 * THE THREE COORDINATES ARE MEASURED, NOT REASONED
 * ============================================================================
 * The layout derives every position from the start spots, which move with the
 * seed, and then walks each structure outward in rings to buildable ground. The
 * trigger table can see none of that and has to name world points.
 *
 * So the points below are READ OFF A BUILT WORLD rather than recomputed from
 * the lot fractions — the same headless build `tests/campaign-maps.spec.ts`
 * performs, at these exact seeds, taking `store.posX/posZ` of the tagged
 * entities AFTER `spawnBuilding` has snapped each footprint to the placement
 * grid. Reading the layout's own pre-snap point instead is wrong by up to 2 m,
 * which does not matter at these radii and would matter at a tighter one.
 * At `mapSeed` 41 207 / `simSeed` 6 412 the openings are 386.2 m apart and the
 * composition lands at:
 *
 *     Furnace  100, 328      Sorter   166, 252      office   296, 200
 *     Foundry  190, 378      Rookery  284, 292      garrison 404, 132
 *
 * The Foundry moved 14.5 m and the Sorter 9.0 m from their nominal lot points
 * to find ground `isBuildable` accepts, which is why the nominal fractions are
 * not what is written here.
 *
 * **RE-MEASURE IF `mapSeed`, `simSeed` OR THE LAYOUT'S LOT FRACTIONS MOVE.**
 * Nothing fails loudly if they drift — `unitsInArea` would simply stop firing
 * and the hidden objective would never reveal, which is invisible in exactly
 * the way this whole file is written to avoid. The radii below are wider than
 * any placement wobble the ring search can produce (28 m) for that reason.
 * ========================================================================== */

import { Faction } from '../../../core/types';
import { minutes, seconds } from '../../types';
import type { Condition, OperationDef } from '../../types';

/* -- the measured points -------------------------------------------------- */

/** The district office mast. `revealArea` and the scouting trigger. */
const OFFICE = { x: 296, z: 200 };
/**
 * Where a lost yard is repaid: 31.6 m north of the Foundry lot (190, 378), on
 * the open ground between it and the Sorter — the direction the column is
 * ordered to move the moment it lands.
 *
 * **IT IS NOT THE FOUNDRY LOT ITSELF, AND THE REASON IS THE GROUND RATHER THAN
 * THE FOOTPRINT.** The wave used to be `at: FOUNDRY` with a 16 m spread, under
 * a comment reasoning correctly about the building's 6 m radius and not at all
 * about what the ring stands on. Measured on the built world, **the Foundry
 * backs onto relief that no wheeled hull can cross: of the four cardinal
 * bearings `spawnUnits` uses for a wave of four, only the westward one is open,
 * at every radius from 8 m to 44 m.** Three of the four Grinders were therefore
 * put down on rock, 8.0–17.0 m from the nearest cell they could enter, and no
 * spread could have fixed it — the ring has four fixed bearings and three of
 * them point into the hillside.
 *
 * Here, all four drops are passable with **6.32 m** of clearance each, which is
 * uniform because this point is in open ground rather than against an edge.
 * `tests/campaign-spawn-ground.spec.ts` is the gate.
 */
const RELIEF = { x: 180, z: 348 };
/** The Sorter lot — the money, and where Tallow's column is pointed. */
const SORTER = { x: 166, z: 252 };
/** The Rookery lot — the deepest yard, and what the watch is sent to break. */
const ROOKERY = { x: 284, z: 292 };

/* -- the thresholds ------------------------------------------------------- */

/**
 * How long the layout is given to have placed the compound before a zero
 * threshold over it is believed.
 *
 * **`ownerCount(1, 'building', 'office', max: 0)` READS TRUE AGAINST AN EMPTY
 * TAG REGISTRY**, exactly as `entityDead` does — the spelling changed and the
 * hazard did not. Unguarded, `t.win` fires on the first tick the Director runs
 * and hands the player a victory they did not play, and `t.dark` pays 400
 * credits for a transformer nobody touched.
 *
 * **IT IS DEFENCE AGAINST A LAYOUT THAT PLACED NOTHING, NOT AGAINST A TICK-ONE
 * READ THAT HAPPENS TODAY, AND SAYING WHICH MATTERS.** `scenarios.system.ts`
 * builds the world inside `async init()` and `SystemRegistry.init` awaits every
 * module's init in sequence before a tick is taken, so the registry is never
 * empty when the Director first runs and the empty read is unreachable in the
 * product. What IS reachable is a layout that stamped nothing — and this
 * operation is the one most exposed to it, because BOTH compound tags sit
 * behind `roster.ai: ['struct.defence.specialist']` company: a wrong def key, a
 * footprint that will not fit on urban ground, or a roster that refuses the
 * structure all end the same way. `tests/campaign-maps.spec.ts` and
 * `tests/campaign-roster-ground.spec.ts` are the gates that catch the causes;
 * this is the guard that stops the symptom being instant.
 *
 * Twenty seconds is unmistakably past the build and unmistakably short of
 * anything happening. Measured on the built world the office is **104.8 m** from
 * the nearest player unit, and the fastest thing on the player's seat is a
 * 5.6 m/s Scrapjaw — 112 m of straight line in twenty seconds, and it is the
 * harvester. What has to happen in that window is 700 hp taken to zero, or to
 * 350 and then walked into by a Tinker that has to be bought first, by a player
 * whose army at t = 0 is nine Scrap Pickers.
 */
const SETTLE: Condition = { on: 'elapsed', ticks: seconds(20) };

/**
 * The garrison no longer holds the district office mast — levelled or taken,
 * and the operation does not care which. See the header for why capture counts.
 *
 * **DEFINED ONCE BECAUSE TWO TRIGGERS MUST AGREE ON IT.** `t.yardsKept` has to
 * resolve on the same tick as `t.win` or the medal loses a secondary that was
 * earned — `runDirector` returns early once an outcome is set, so a completion
 * one tick late is a completion that never happens.
 */
const OFFICE_OFF: Condition = {
  on: 'all',
  of: [SETTLE, { on: 'ownerCount', player: 1, role: 'building', tag: 'office', max: 0 }],
};

/**
 * The garrison still holds the mast. `OFFICE_OFF`'s inner count, inverted.
 *
 * **THE EXACT COMPLEMENT, AND IT CARRIES NO `SETTLE` ON PURPOSE.** `max: 0` and
 * `min: 1` over one count partition every world state, so `t.dark` and `t.win`
 * cannot both be true and cannot both be false — which is what "before the mast
 * falls" has to mean once the mast can also change hands. And `min: 1` reads
 * FALSE against an empty registry, which is the safe direction: a layout that
 * placed nothing simply never completes the secondary, rather than paying for
 * it. Guarding it would be a second constant to keep in step for nothing.
 */
const OFFICE_HELD: Condition = {
  on: 'ownerCount', player: 1, role: 'building', tag: 'office', min: 1,
};

/**
 * The garrison no longer holds the transformer — levelled or taken.
 *
 * `SETTLE` is conjoined because this one PAYS: 400 credits and a medal off a
 * `max: 0` that an empty registry satisfies. `OFFICE_HELD` is not enough on its
 * own to make that safe, because a world where the office placed and the
 * transformer did not is exactly the mixed case that would collect it.
 */
const TRANSFORMER_OFF: Condition = {
  on: 'all',
  of: [SETTLE, { on: 'ownerCount', player: 1, role: 'building', tag: 'transformer', max: 0 }],
};

const op: OperationDef = {
  id: 'reclamation.01.held-paper',
  chapter: 'reclamation',
  faction: Faction.Reclaim,
  /*
   * THE ONE OF THE FIVE THAT IS NOT READ OFF ITS OWN DIALOGUE, AND SAYING SO
   * IS THE POINT.
   *
   * The other four name their enemy out loud — S1 "the Allies got there
   * first", S2 "Three Allied guns are sitting on it", S3 "the Allies sitting on
   * it", A1's own spawn comment "Soviet keys because the antagonist of this
   * chapter is". Nothing in this file's prose or its layout's names an army:
   * it is "a garrison", "the district office", "the watch". The layout is
   * role-keyed throughout and the one `spawnUnits` here is `rclGrinder` on the
   * PLAYER'S seat, so no key constrains the answer either. The field is
   * required, so it has to be decided rather than deferred, and it is decided
   * from the chapter grid rather than from a line of text that does not exist.
   *
   * Soviets, for two reasons out of `CAMPAIGN_BUILD_SPEC.md`:
   *
   *   - §2.1 divides the Works at the Split — "The Allies took the survey
   *     office and the instruments… the Soviets took the yards and the plate
   *     mills." This operation is four breaking yards in an industrial belt
   *     with a district office administering them. That is the Soviet half of
   *     the split, on the nose.
   *   - §3.4's grid puts "Pull the field the Soviets left in week 2" at R2 and
   *     "The Allies want your yard" at R4. R1 is week 1. An Allied garrison
   *     here spends R4's beat three operations early and leaves the Soviets
   *     unintroduced in a chapter that names them next.
   *
   * MECHANICALLY IT IS FREE, WHICH IS WHY THE ARGUMENT IS ALLOWED TO BE
   * LITERARY. `keyFor` gives the compound `teslaCoil` for
   * `struct.defence.specialist` and `sentryGun` for the two `pillbox`-role
   * boxes, and the hidden secondary needs exactly that split — a tower that
   * draws power and a box at `power: 0`. Both hold in every army's column.
   * **A briefing author who writes this chapter's prose may overturn this;
   * they should change the field, not work around it.**
   */
  foe: Faction.Soviets,
  index: 1,
  title: 'Held Paper',
  beat: 'The yards are already yours. Nobody has read the paperwork.',
  primaryType: 'assault',
  // MULTIPLE EFFECT KINDS, so 'bespoke' by the definition in `types.ts` — but
  // the label is about MECHANISM and not about where the drama comes from.
  // Everything that makes this operation what it is happens before tick one.
  archetype: 'bespoke',
  parSec: 780,
  requires: [],

  map: {
    preset: 'urban',
    mapSeed: 41_207,
    simSeed: 6_412,
    armies: 2,
    biome: 'urban',
    // NOT 'base'. `buildBaseFor` is never called for seat 0 — see the layout.
    opening: 'force',
    credits: 3_000,
  },
  layout: 'reclamation-held-paper',

  // NEITHER SHIPPED RULE MAY END THIS. The office stands 131 m outside the
  // garrison's base, so `Shell.pollOutcome` would otherwise hand the player a
  // win for flattening a base while the objective was untouched — and the
  // player's four lots hold no army at all for the first minute, which is what
  // `assetLossDefeat` would read as a defeat.
  outcome: { annihilationWin: false, assetLossDefeat: false, ignoreSeats: [] },

  roster: {
    // The Arcspitter, and it is behind the 1900-credit branch. See the header.
    player: ['unit.raider'],
    // The two towers in the office compound. Remove this and they do not exist.
    ai: ['struct.defence.specialist'],
  },

  objectives: [
    // "TAKE … OFF THEM", NOT "DESTROY". `t.win` counts what seat 1 still owns,
    // so walking a Tinker into the mast ends the operation exactly as levelling
    // it does, and a title that said "destroy" would name the one route the
    // rule does not require. See the header.
    { id: 'mast', kind: 'primary', title: 'Take the district office mast off them' },
    {
      id: 'yards',
      kind: 'secondary',
      // UNCHANGED. This one counts the PLAYER's own holdings and always has —
      // `t.yardLost` is `ownerCount(0, 'building', 'yard', max: 3)` — so the
      // capture migration does not reach it. Nothing on the map can take a yard
      // off the player either: the brain owns no engineer, which `src/sim/AI.ts`
      // records as a capability gap rather than a choice.
      title: 'Finish with all four yards standing',
      credits: 600,
    },
    {
      id: 'dark',
      kind: 'secondary',
      hidden: true,
      // "OFF THEIR GRID", NOT "CUT", AND "STILL THEIRS", NOT "FALLS". Both
      // halves of `t.dark` count deeds now: the transformer is off the
      // garrison's books however it got there, and the mast is measured by who
      // holds it rather than by whether it is standing. The title names both
      // because a hidden objective the player is judged against has to be
      // readable the moment it is revealed.
      title: 'Take the office transformer off their grid while the mast is still theirs',
      credits: 400,
    },
  ],

  triggers: [
    /* -- the brief -------------------------------------------------------
     * Two lines, four seconds in, because the first is the premise and the
     * second is the objective and a player who reads only one should still
     * know what to do. Tallow prices the secondary out loud rather than
     * letting the objective list carry it: she is the kind of employer who
     * tells you what a thing is worth before you break it.
     */
    {
      id: 't.open',
      when: { on: 'elapsed', ticks: seconds(4) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Tallow',
          text: 'Survey 41-207. Four breaking yards in the industrial belt, all four on '
            + 'my paper, all four running this morning. The garrison has been '
            + 'countersigning the delivery notes for eleven months and reading none.',
        },
        {
          // "Take it off them" rather than "Take it down": `t.win` counts
          // deeds, so breaking the mast and walking into it are one order. The
          // tail moved with it — "worth more than that office is worth flat"
          // priced an outcome the rule no longer requires.
          do: 'dialogue',
          speaker: 'Tallow',
          text: 'The mast on the district office is the only way left to check. Take it off '
            + 'them. Do not lose me a yard doing it — standing, they are worth more than '
            + 'that office will ever be.',
        },
      ],
    },

    /* -- the compound, seen ----------------------------------------------
     * The scouting payoff, and the only reveal in the file. 74 m is more than
     * three times a Scrap Picker's 22 m sight, so this fires while the compound
     * is still under shroud — which is exactly why the same trigger carries the
     * `revealArea`. ARRIVING is what shows it to you; the trigger is not
     * reacting to the player having seen something.
     *
     * Cregg names the mechanism outright. A hidden objective whose method the
     * player has to guess is a quiz, and the medal is the reward for using it
     * rather than for knowing it.
     *
     * AN UNTAGGED `unitsInArea` IS THE EXPENSIVE SPELLING and it is the right
     * one here: the question is whether ANY player unit has come up the road,
     * and tagging would mean naming in advance which of them counts. It walks
     * `store.alive` twice a tick — the arming pass and the real pass — until it
     * fires, and then `state.fired` retires it for the rest of the match.
     *
     * **74 m IS BOUNDED BY THE NEAREST PLAYER UNIT AT t = 0, WHICH IS 104 m
     * AWAY.** `unitsInArea` counts units and not buildings, so the constraint is
     * not the Rookery at 92.8 m but its crew at 104.3 m — a 30 m margin. Move
     * the Rookery lot forward and this fires on tick one, revealing the compound
     * before the player has left home.
     */
    {
      id: 't.scouted',
      when: { on: 'unitsInArea', player: 0, area: { x: OFFICE.x, z: OFFICE.z, r: 74 }, min: 1 },
      then: [
        { do: 'revealArea', player: 0, area: { x: OFFICE.x, z: OFFICE.z, r: 66 } },
        {
          /*
           * THIS LINE OPENED WITH "one transformer feeding both" AND THAT IS
           * NOT A THING THIS ENGINE HAS. `PowerGrid` is per PLAYER: one seat's
           * supply against that seat's draw, with no wire between a plant and
           * anything in particular. It went on to promise the towers would
           * become ornaments, which the header measures as false in two
           * independent ways. It says the opposite now, explicitly, because a
           * player who has been told the towers go cold will walk into them.
           *
           * What replaces it is the thing that IS true and IS worth 400
           * credits: `t.dark` counts deeds, so a Tinker answers it, and a
           * captured `powerPlant` is 100 power on a seat whose entire supply is
           * the Furnace's 80 (measured 80 -> 180). "Take it whole" is the
           * method named outright — a hidden objective whose route the player
           * has to guess is a quiz.
           */
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'Two towers on that compound, and that box behind the mast is the district '
            + 'transformer. It does not feed them — one district, one pool, and they keep '
            + 'spares — so breaking it costs them a morning and nothing more. Walk a Tinker '
            + 'into it and it is a hundred power standing on your paper, against the eighty '
            + 'your Furnace makes. Take it whole.',
        },
        { do: 'setObjective', id: 'dark' },
      ],
    },

    /* -- the alarm --------------------------------------------------------
     * FIRST DAMAGE, OR SIX MINUTES. `entityHpBelow` at 0.99 is the cheapest
     * available reading of "somebody has taken a shot at it" — the vocabulary
     * has no damage event and does not need one.
     *
     * `orderTagged` is what makes this the operation's turning point rather
     * than a notification: the watch detachment is REAL, it has been standing
     * in the compound since tick one facing the wrong way, and it walks off its
     * post at the moment the player chooses. One command, one owner — every
     * `watch` entity is seat 1, which `orderTagged` requires.
     *
     * Sent to the Rookery because it is the deepest yard and the one that makes
     * the answer to the compound's wall. Breaking it is the correct move and
     * the garrison is not being stupid.
     *
     * **THE TWO `entityHpBelow` READS DID NOT MIGRATE WITH THE REST, AND THAT
     * IS NOT AN OVERSIGHT.** They read DAMAGE, not ownership, and a capture IS
     * damage: `CaptureService.resolve` sends an ENEMY structure through the
     * SOFTEN branch at anything above `CAPTURE.captureHpFrac`, so the only door
     * onto a full-health office is 0.20 of its max hp arriving as a
     * HighExplosive record. A Tinker sent at the mast therefore trips the alarm
     * on the tick he arrives, exactly as a rifle round would, and the lever the
     * player pulls is the same lever whichever route they take.
     */
    {
      id: 't.noticed',
      when: {
        on: 'any',
        of: [
          { on: 'entityHpBelow', tag: 'office', frac: 0.99 },
          { on: 'entityHpBelow', tag: 'transformer', frac: 0.99 },
          { on: 'elapsed', ticks: minutes(6) },
        ],
      },
      then: [
        { do: 'eva', line: 'baseUnderAttack' },
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'District office just went on the net. Their watch is off the wall and it '
            + 'is not coming at us. It is going for the yards.',
        },
        { do: 'orderTagged', tag: 'watch', order: 'attackMove', at: ROOKERY },
      ],
    },

    /* -- a yard lost ------------------------------------------------------
     * THE FAILURE AND THE CONSOLATION ARE ONE EVENT AND ONE TRIGGER, so they
     * cannot fire apart. Two triggers on one condition would be two ways for a
     * later edit to hand out the column without costing the medal, or the
     * reverse.
     *
     * Four Grinders is 2400 credits of hull against a 3000 opening bank — more
     * than the player could have bought — and that is the character rather than
     * a balance slip. Tallow replaces the yard's output because she prices
     * everything, and she says the price out loud so the gift reads as a bill.
     *
     * Pointed at the Sorter: with a yard already gone, the money is the thing
     * that must not go next.
     */
    {
      id: 't.yardLost',
      when: { on: 'ownerCount', player: 0, role: 'building', tag: 'yard', max: 3 },
      then: [
        { do: 'failObjective', id: 'yards' },
        { do: 'eva', line: 'reinforcements' },
        {
          do: 'dialogue',
          speaker: 'Tallow',
          text: 'One yard down. Four hundred a day, gone. Here is what four hundred a day '
            + 'buys — do not make a habit of it.',
        },
        {
          do: 'spawnUnits',
          player: 0,
          key: 'rclGrinder',
          count: 4,
          at: RELIEF,
          // 16 m of ring, and BOTH things it has to clear are measured rather
          // than reasoned: the Foundry's own 3x3 footprint (6 m radius), and
          // the ground under all four bearings. See `RELIEF` — clearing the
          // footprint was the only test this used to pass, and the ring was on
          // rock.
          spread: 16,
          tag: 'column',
        },
        { do: 'orderTagged', tag: 'column', order: 'move', at: SORTER },
      ],
    },

    /* -- the two secondaries, resolved before the win ---------------------
     * BOTH OF THESE SIT ABOVE `t.win` AND THAT IS LOAD-BEARING. `runDirector`
     * returns immediately once an outcome is set, so a completion written below
     * the win trigger never fires and the medal never counts it.
     */
    /*
     * BOTH HALVES COUNT DEEDS. This was `entityDead 'transformer'` conjoined
     * with `entityAlive 'office'`, and a captured structure is alive on both
     * counts. A Tinker in the TRANSFORMER therefore made a 400-credit secondary
     * permanently uncollectable; a Tinker in the MAST left this trigger armed
     * forever, because `entityAlive` cannot tell "the mast still stands" from
     * "the mast is mine now". Only the second was harmless, and only because
     * the same capture had already made the operation unwinnable — which is not
     * a defence. `TRANSFORMER_OFF` and `OFFICE_HELD` are exact complements of
     * `OFFICE_OFF`'s inner count, so this and `t.win` partition every world
     * state between them and "before the mast goes" is enforced rather than
     * implied.
     */
    {
      id: 't.dark',
      when: { on: 'all', of: [TRANSFORMER_OFF, OFFICE_HELD] },
      then: [
        {
          /*
           * "Both towers are cold" WAS THE WORST SHAPE A FALSE LINE CAN TAKE:
           * the game told the player the towers were out on the same tick they
           * went on shooting. It fires on the TRIGGER, so whatever it says has
           * to be true at that instant and not eventually — and the towers are
           * lit at that instant, measured, every time.
           *
           * It is now true on both routes, which is what the trigger requires:
           * `t.dark` counts a deed, so the transformer is off seat 1's books
           * whether it was levelled or walked into, and "off their books" is
           * exactly the state the count reports. "off their board" is kept from
           * the old line for the same reason it was written — a transformer a
           * Tinker walked into is running, for the player.
           */
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'Transformer is off their board. Their towers are still lit — one district, '
            + 'one pool — so that is a hundred power off their books rather than a blackout. '
            + 'It was the best thing in that compound anyway. Go.',
        },
        { do: 'completeObjective', id: 'dark' },
      ],
    },
    {
      id: 't.yardsKept',
      when: {
        on: 'all',
        of: [
          // `OFFICE_OFF`, THE SAME OBJECT `t.win` READS. Two spellings of one
          // threshold are two spellings that drift, and the drift here is a
          // 600-credit secondary resolving one tick after the operation has
          // already ended — i.e. never, because `runDirector` returns early
          // once an outcome is set.
          OFFICE_OFF,
          { on: 'ownerCount', player: 0, role: 'building', tag: 'yard', min: 4 },
        ],
      },
      then: [{ do: 'completeObjective', id: 'yards' }],
    },

    /* -- the win ----------------------------------------------------------
     * `OFFICE_OFF`, WHICH COUNTS DEEDS AND NOT CORPSES. This was
     * `entityDead 'office'`, and a captured mast is alive — so a Tinker put
     * into the one structure this operation is named after made the only win
     * condition in the table false forever, with `annihilationWin` off. See the
     * header block.
     */
    {
      id: 't.win',
      when: OFFICE_OFF,
      then: [
        { do: 'completeObjective', id: 'mast' },
        {
          // "off them" rather than "down". A mast a Tinker walked into is still
          // standing — and on this operation it is standing on Tallow's paper,
          // which is the joke the whole premise is built on.
          do: 'dialogue',
          speaker: 'Tallow',
          text: 'Mast is off them. Nobody in that district can ask a question now, and the '
            + 'yards never stopped for a minute of it. Bill them for the morning.',
        },
        { do: 'endOperation', result: 'win' },
      ],
    },

    /* -- the loss ---------------------------------------------------------
     * `playerBeaten` is `Viability.isBeaten` — nothing to build with and
     * nothing to fight with — and it is the only honest test here. "You have no
     * buildings" would be wrong in both directions on this operation: the
     * player opens with four scattered structures and no army, and a player
     * down to one Rookery and six Slaggers can still finish it.
     */
    {
      id: 't.lose',
      when: { on: 'playerBeaten', player: 0 },
      then: [{ do: 'endOperation', result: 'loss', reason: 'mast' }],
    },
  ],
};

export default op;
