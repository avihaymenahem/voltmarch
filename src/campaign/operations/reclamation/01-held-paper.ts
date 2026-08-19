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
 * THE HIDDEN SECONDARY TEACHES A SHIPPED RULE MOST PLAYERS NEVER MEET
 * ============================================================================
 * A structure that DRAWS power and is dark cannot fire. The office's two
 * specialist towers draw; its two concrete boxes are `power: 0` and fire
 * through a blackout. So cutting the transformer is a real tactical answer that
 * is neither free nor total — and it is worth a medal rather than being
 * required, because an operation that fails a player for not knowing an
 * unwritten rule is a quiz.
 *
 * `t.dark` requires the transformer dead **while the mast still stands**. Kill
 * them in the other order and the objective simply never completes; that is the
 * honest reading of "before the mast falls" and it needs no extra condition.
 *
 * ============================================================================
 * WHAT THE THREE FIXED NUMBERS ARE DOING
 * ============================================================================
 * **`credits: 3000` binds BOTH seats.** `Shell.applyEconomyPostBoot` writes
 * `setup.startingCredits` into every non-Neutral slot, so this is not a handicap
 * — it is one number doing two jobs. It makes the Breaker Yard a commitment for
 * the player, and it slows the garrison's opening for exactly the reason the
 * measured 10 000-credit block in CLAUDE.md gives: a brain with a full bank
 * builds a seven-building base and eleven troops before it has mined an ore.
 * A district that has not noticed anything should not be doing that.
 *
 * **`roster` is asymmetric and both halves are load-bearing.** The garrison has
 * `struct.defence.specialist`, which is what puts the two power-drawing towers
 * in the compound — remove that line and `spawnBuilding` refuses them and the
 * hidden secondary has nothing to switch off. The player has `unit.raider` and
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
import type { OperationDef } from '../../types';

/* -- the measured points -------------------------------------------------- */

/** The district office mast. `revealArea` and the scouting trigger. */
const OFFICE = { x: 296, z: 200 };
/** The Foundry lot — where the player builds, and where a lost yard is repaid. */
const FOUNDRY = { x: 190, z: 378 };
/** The Sorter lot — the money, and where Tallow's column is pointed. */
const SORTER = { x: 166, z: 252 };
/** The Rookery lot — the deepest yard, and what the watch is sent to break. */
const ROOKERY = { x: 284, z: 292 };

const op: OperationDef = {
  id: 'reclamation.01.held-paper',
  chapter: 'reclamation',
  faction: Faction.Reclaim,
  /*
   * THE ONE OF THE FIVE THAT IS NOT READ OFF ITS OWN DIALOGUE, AND SAYING SO
   * IS THE POINT.
   *
   * The other four name their enemy out loud — S1 "the Allies got there
   * first", S2 "two Allied tanks are sitting on it", S3 "the Allies sitting on
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
    { id: 'mast', kind: 'primary', title: 'Destroy the district office mast' },
    {
      id: 'yards',
      kind: 'secondary',
      title: 'Finish with all four yards standing',
      credits: 600,
    },
    {
      id: 'dark',
      kind: 'secondary',
      hidden: true,
      title: 'Cut the office transformer before the mast falls',
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
          do: 'dialogue',
          speaker: 'Tallow',
          text: 'The mast on the district office is the only way left to check. Take it '
            + 'down. Do not lose me a yard doing it — standing, they are worth more than '
            + 'that office is worth flat.',
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
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'Two towers on that compound and one transformer feeding both. Kill the '
            + 'transformer and the towers are ornaments. The concrete boxes draw nothing '
            + 'and will keep firing — those you do the hard way.',
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
          at: FOUNDRY,
          // The ring has to clear the Foundry's own footprint: `spawnUnits`
          // places on a fixed ring at `at` and `Production.spawnUnit` does no
          // egress search, so a spread inside the building puts four hulls in
          // the walls. 16 m against a 3x3 yard's 6 m radius.
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
    {
      id: 't.dark',
      when: {
        on: 'all',
        of: [
          { on: 'entityDead', tag: 'transformer' },
          { on: 'entityAlive', tag: 'office' },
        ],
      },
      then: [
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'Transformer is out. Both towers are cold. The boxes are not. Go.',
        },
        { do: 'completeObjective', id: 'dark' },
      ],
    },
    {
      id: 't.yardsKept',
      when: {
        on: 'all',
        of: [
          { on: 'entityDead', tag: 'office' },
          { on: 'ownerCount', player: 0, role: 'building', tag: 'yard', min: 4 },
        ],
      },
      then: [{ do: 'completeObjective', id: 'yards' }],
    },

    /* -- the win ---------------------------------------------------------- */
    {
      id: 't.win',
      when: { on: 'entityDead', tag: 'office' },
      then: [
        { do: 'completeObjective', id: 'mast' },
        {
          do: 'dialogue',
          speaker: 'Tallow',
          text: 'Mast is down. Nobody in that district can ask a question now, and the '
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
