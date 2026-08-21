/**
 * ============================================================================
 * S5 — SHORT ALLOCATION
 * ============================================================================
 * The next quarter's schedule comes off the wire and this sector's allocation
 * is nil. The branch is reassigned; the yards run on what the seam gives them.
 * What the seam gives them is three workings on one lane, three hundred credits
 * a minute each, and the Ninth District has a shift to put them out of the
 * ledger.
 *
 * ============================================================================
 * WHAT THE PLAYER GIVES UP
 * ============================================================================
 * **THREE WORKINGS, TWO REQUIRED, AND NO TWO OF THEM CAN BE COVERED AT ONCE.**
 * Measured on a headless build: they stand 92.48 m, 181.40 m and 252.30 m from
 * the player's Construction Yard along the opening-to-opening lane (93.04,
 * 183.22 and 254.81 from the OPENING, which is 6.32 m short of it and is what
 * the layout's own table quotes). The closest pair is 75.47 m apart, and the
 * longest structure weapon this operation's roster leaves either army is
 * `pillboxMg` at **22 m**. Two of those rings reach 44 m
 * between them against a 75.47 m gap, so an emplacement covers exactly one
 * working and a mobile force covers one at a time and pays 75 to 168 m to
 * change its mind. Holding all three means being weak in three places.
 *
 * The fork is therefore not WHICH two — the near one is nearly free — it is
 * **HOW FAR ALONG THE LANE YOU ARE WILLING TO STAND**, and every rung costs
 * more than the last:
 *
 *   - **near and middle.** The primary, and the ordinary line. The middle
 *     working is 181.40 m out, far enough to need its own answer and near
 *     enough that the answer can fall back. Concede the far working and you
 *     concede 300 credits a minute for the rest of the shift — 4200 by the
 *     close if it goes at minute three, which is more than the opening bank.
 *   - **all three.** 600 credits at the close, and it means holding a position
 *     135.09 m from the Ninth's yard for seventeen minutes with a 700-hp
 *     structure in the middle of it. The ground pays one compensation and only
 *     there: a Gaia `civApartments` 22.36 m from the far working, garrisonable,
 *     which is the only firing position on the map nobody had to build.
 *   - **the tap.** Hidden until minute five. The Ninth's own derrick, 121.85 m
 *     from their opening, paying them 900 a minute behind two pillboxes. It
 *     pays 400 and takes their entire seam income off them — and it is 282.84 m
 *     from the player's yard, so the detachment that goes is not defending
 *     anything for the several minutes it is away.
 *
 * **THE INCOME IS SYMMETRIC AND THE SHAPE IS NOT.** Three workings at 300 a
 * minute is 900; the Ninth's one derrick is 900. Identical seam income,
 * distributed against concentrated — so the player's can be taken a third at a
 * time and the Ninth's can be taken all at once. That is the operation stated
 * in credits rather than in prose, and it is why the raid is worth a
 * detachment.
 *
 * ============================================================================
 * WHY THERE IS NO `elapsedSinceArmed` IN THIS FILE
 * ============================================================================
 * The obvious defend is a hold timer: own three workings for N continuous
 * minutes. **IT IS THE WRONG INSTRUMENT HERE AND IT WOULD SHIP AN OPERATION
 * THAT CANNOT BE WON.** `elapsedSinceArmed` disarms and restarts the moment its
 * other conditions stop holding — which is right for `soviets.04.company-town`,
 * where a lost deed can be retaken by walking another engineer in. A working
 * here is DESTROYED, not contested: no sidebar in the game builds a
 * `civOreMine`, the Ninth cannot capture one (see the layout), and the count
 * therefore only ever falls. A hold timer over a monotonically falling count is
 * a clock that stops forever the first time the player is hurt — `entityDead`
 * reading true before the tag exists, wearing a different hat.
 *
 * So the clock is a plain `elapsed` and the OBJECTIVE is the count. That is not
 * "a timer with scenery" for one reason, and it is the reason to check first if
 * this operation ever plays badly: **the loss is immediate, not deferred.**
 * `t.cut` ends the match on the tick the second working falls, at any minute.
 * A player who is going to lose finds out when it happens rather than at
 * 17:00, and every working is worth defending on the tick it is shot at rather
 * than in aggregate at the end.
 *
 * ============================================================================
 * THE CLOSE IS ONE CONDITION WITH THREE READERS
 * ============================================================================
 * `CLOSE` below is `any: [elapsed 17 min, ROUTED]`, defined once and read by
 * the three triggers that resolve at the end. Seventeen minutes is
 * `parSec` 1020 to the second — the authored par IS the deadline rather than a
 * description of one, which is the only way that field is falsifiable from
 * inside the operation, and this chapter's ramp is 780 / 840 / 900 / 960 /
 * 1020.
 *
 * **THE SECOND ARM IS AN AUTHORED EARLY-OUT AND IT IS DELIBERATELY NOT
 * `annihilationWin`.** A player who razes the district at minute nine has ended
 * the threat, and eight further minutes of an empty map is the failure mode a
 * fixed clock actually has. Expressing it here rather than by flipping the
 * outcome policy keeps it on the Director's tick and inside this table's
 * ordering rules; `Shell.pollOutcome` runs at 2 Hz off the shell, has its own
 * ten-second grace, and would also have an opinion about states this table
 * already handles. `Viability.isBeaten` is "nothing to build with and nothing to
 * fight with", and a derrick is neither — so the Ninth can be beaten with their
 * tap still standing, and in that case `t.tapStanding` fails the secondary. The
 * objective is the tap, not the district.
 *
 * ============================================================================
 * BOTH SHIPPED OUTCOME RULES ARE OFF
 * ============================================================================
 * `annihilationWin` because the early-out above is the authored version of it,
 * on this table's terms. `assetLossDefeat` because a commander whose yard is
 * gone while two workings are still paying him 600 a minute is the most
 * interesting last act this operation has, and `pollOutcome` would end it at
 * 2 Hz instead. The authored ordinary loss is `playerBeaten`, which is the
 * honest threshold.
 * ========================================================================== */

import { Faction } from '../../../core/types';
import { minutes, seconds } from '../../types';
import type { Condition, OperationDef } from '../../types';
import {
  ALLIED_TAP_AREA, ROAD_EAST, ROAD_WEST, WORKING_FAR, WORKING_MID, WORKING_NEAR,
} from '../../layouts/soviets-short-allocation';

/**
 * THE GEOMETRY IS IMPORTED, NOT RESTATED.
 *
 * The workings are placed by the layout and the columns are ordered at them by
 * this file. A number written in both is a number that will disagree the first
 * time either is tuned, and the failure — a column attack-moving at empty
 * ground, a reveal framing nothing — is invisible to every gate.
 * `layouts/soviets-short-allocation.ts` owns the geometry.
 */

/**
 * How long the layout is given to have placed the ground before any threshold
 * over it is believed.
 *
 * **A ZERO THRESHOLD IS TRUE BEFORE THE GROUND EXISTS, IN BOTH DIRECTIONS.**
 * `ownerCount(max: 1)` reads TRUE for a layout that placed no workings, so it
 * would end this operation in defeat on tick one; `playerBeaten` reads TRUE for
 * a seat that has no producer and no hull, so a base that failed to build would
 * end the operation on tick one in whichever direction it belonged to. All three
 * are silent, and all three pass every test. `soviets.04.company-town` guards
 * its `max: 0` crew count the same way and for the same reason; this one is in
 * front of `t.cut`, `t.beaten` and `ROUTED`, so it guards the win as well as
 * both losses.
 *
 * THE THRESHOLD IS ABOUT THE BUILD, NOT ABOUT A RACE WITH THE NINTH. The world
 * is finished before tick one, so any value above zero closes the hole; twenty
 * seconds is chosen to be unmistakably past it and unmistakably short of a
 * working being lost, since nothing hostile is ordered anywhere before minute
 * three and the nearest working to the Ninth's opening is 137.75 m away.
 */
const SETTLE = seconds(20);

/**
 * The Ninth is finished. `Viability.isBeaten` — nothing to build with and
 * nothing to fight with — with the settle above in front of it.
 */
const ROUTED: Condition = {
  on: 'all',
  of: [
    { on: 'elapsed', ticks: SETTLE },
    { on: 'playerBeaten', player: 1 },
  ],
};

/**
 * The end of the shift, defined once because three triggers must agree on it.
 *
 * The early-out is an ARM of this condition rather than a trigger of its own, so
 * there is exactly one definition of "the shift is over" and no second copy to
 * drift. `t.routed` reads `ROUTED` for its line and ends nothing. See the header.
 */
const CLOSE: Condition = {
  on: 'any',
  of: [
    { on: 'elapsed', ticks: minutes(17) },
    ROUTED,
  ],
};

const op: OperationDef = {
  id: 'soviets.05.short-allocation',
  chapter: 'soviets',
  faction: Faction.Soviets,
  /*
   * THE NINTH DISTRICT, WHICH IS WHO LOST THE TOWN IN S4. Wend's traffic names
   * them and the revision is theirs; `t.wave*` spawns literal Allied `gi` and
   * `grizzly`, which `validateCampaign` checks against the army of the seat
   * they land on. Two seats, so `op.foe` fills exactly one of them.
   */
  foe: Faction.Allies,
  index: 5,
  title: 'Short Allocation',
  beat: 'Next quarter\'s schedule is out. This sector\'s allocation is nil.',
  primaryType: 'defend',
  // BESPOKE. Objectives, spawns, orders, reveals, dialogue, an announcer line
  // and an outcome — `types.ts` defines the archetype as "multiple effect
  // kinds", and this is seven of the eleven.
  archetype: 'bespoke',
  parSec: 1020,
  requires: ['soviets.04.company-town'],

  map: {
    /*
     * `temperate` is `relief` 0.42 / `cliffs` 0.35, against
     * `soviets.04.company-town`'s urban 0.14 / 0.10. That is a deliberate
     * contrast after a town fight and it is a real constraint on the layout.
     * (An earlier draft called it "the steepest preset any shipped operation
     * uses" and that is false in both directions: `snow` is 0.50 / 0.40 and
     * `soviets.03.deep-sector` is on it, and `arid` carries `cliffs` 0.55 under
     * `soviets.01.first-tap`. The constraint below is real; the superlative was
     * not.) Every structure goes down through a
     * `footprintBuildable` + `footprintClear` ring search rather than on its
     * nominal literal, and the header's distances are read off where they
     * actually landed.
     */
    preset: 'temperate',
    /*
     * Fixed, and pinned by `tests/campaign-maps.spec.ts` as a terrain
     * fingerprint. A generator change that re-rolls this ground moves the lane
     * the operation is authored along, and the fingerprint is what makes that
     * loud — it does not make it cheap.
     */
    mapSeed: 20_260_911,
    /*
     * **IT CHOOSES THE CORNERS.** `seatedSlots` draws a PAIR out of
     * `START_PAIRS` for a two-army match, and 5521 draws **[0, 1]** — the
     * 386.16 m diagonal, the widest of the four layouts and the only one with
     * room for three separated positions between the openings. Every distance
     * in this file and in the layout is measured against that.
     * **Change this and they are all different distances.**
     */
    simSeed: 5_521,
    armies: 2,
    biome: 'temperate',
    /*
     * `base`. A defence needs a position to defend from at tick zero, and the
     * fiction agrees: S1 through S4 took this seam and this is the yard
     * standing on it.
     */
    opening: 'base',
    /*
     * 3000, AND IT BINDS BOTH SEATS — `Shell.startMatch` writes
     * `startingCredits` into every slot, so this is a statement about the
     * operation's economy rather than a handicap.
     *
     * That is exactly right here, because the premise is that NEITHER side has
     * an allocation this quarter. Both armies open on a third of the skirmish
     * 10 000 and both are then paid 900 credits a minute by the seam — the
     * player across three workings, the Ninth off one derrick. The bank is
     * short so that the seam is the economy; if the opening bank funded a full
     * ramp, the workings would be a bonus rather than the answer to the question
     * the bank poses. It also holds the Ninth to the pace CLAUDE.md names as the
     * single cause of "the AI has a ready base": a 10 000 opening built a
     * seven-building base with eleven troops by t+90 s having mined nothing.
     */
    credits: 3_000,
  },
  layout: 'soviets-short-allocation',

  // NEITHER SHIPPED RULE MAY END THIS. See the header: the early-out is
  // authored on `CLOSE` instead, and `assetLossDefeat` would end the operation's
  // best last act at 2 Hz.
  outcome: { annihilationWin: false, assetLossDefeat: false, ignoreSeats: [] },

  /*
   * EMPTY IS A RESTRICTION, NOT AN ABSENCE. The roster is an ALLOW-LIST over
   * tagged content, so two empty lists hold both seats to the day-one catalogue:
   * no Proving Ground, no Tesla Coil, no Refractor Tower, no AA Battery, no
   * aircraft and no superweapon, in either opening base or either sidebar.
   *
   * IT IS ALSO WHAT MAKES THE 75.47 m CLAIM IN THE HEADER TRUE. `teslaCoil` is
   * `struct.defence.specialist` and its `teslaBolt` reaches 30 m; withheld, the
   * longest structure weapon either army can put beside a working is
   * `pillboxMg` at 22 (`sentryGun`, `pillbox`) with `flameJet` at 18, so one
   * emplacement covers one working and the choice cannot be bought out with
   * range.
   *
   * What the Soviet player keeps is the ungated pair, neither of which carries
   * an `UNLOCK_TAGS` row: `sentryGun` at **400 credits, 480 hp and no power
   * draw**, and `flameTower` at 600 and -20. Three Sentry Guns is 1200 of a
   * 3000 opening bank — a real answer, and not a free one. `civOreMine` carries
   * no tag either, which is what keeps the three workings out of the allow-list
   * entirely; see the layout on why a refused one would be silent.
   *
   * SYMMETRIC AND PROFILE-INDEPENDENT, so the ground is the same on a finished
   * account as on a fresh one, which a deny-list could not promise.
   */
  roster: { player: [], ai: [] },

  objectives: [
    {
      id: 'hold',
      kind: 'primary',
      title: 'Hold two of the three seam workings until the shift closes',
    },
    {
      id: 'all',
      kind: 'secondary',
      title: 'Close the shift with all three workings standing',
      credits: 600,
    },
    {
      id: 'ledger',
      kind: 'secondary',
      hidden: true,
      title: 'Level the Ninth\'s tap',
      credits: 400,
    },
  ],

  triggers: [
    /* -- the orders -------------------------------------------------------
     * Two beats rather than four lines at once: the shell renders dialogue as
     * toasts and a stack of four is a stack nobody reads.
     */
    {
      id: 't.brief',
      when: { on: 'elapsed', ticks: seconds(4) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'Next quarter\'s schedule came off the wire an hour ago. This sector\'s '
            + 'allocation is nil — the branch is reassigned and the yards run on whatever the '
            + 'seam gives them.',
        },
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'Three workings on the lane. Three hundred credits a minute each, and between '
            + 'them they are the entire budget.',
        },
      ],
    },
    {
      id: 't.orders',
      when: { on: 'elapsed', ticks: seconds(16) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'Hold two of the three when the shift closes at seventeen minutes and the '
            + 'sector stays on the books. Lose a second one and there is nothing to allocate — '
            + 'the filing writes itself.',
        },
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'Nothing is coming. No column, no draft, no bank. What is at the gate now is '
            + 'what finishes the shift.',
        },
      ],
    },

    /* -- the first troop --------------------------------------------------
     * Minute three, unconditional. A wave that fires only when the player is
     * elsewhere reads as the map cheating; a schedule the world keeps whatever
     * the player is doing reads as an opponent.
     *
     * IT FORMS AT THE NINTH'S OWN GATE AND THE ORDER IS A HEADING, NOT A LEASH.
     * `AiBrain.regroupSquads` files every untagged hull the seat owns into a
     * squad on its next pass, so the attack-move is the first thing these six
     * do and the brain owns them after that. What the wave buys is that the
     * district's army is 66.00 m from its own yard and pointed down the lane at
     * a known minute — read it as the Ninth building faster than it could, which
     * is what `soviets-deep-sector` established about scripted waves on an AI
     * seat. The workings are on the lane precisely so the pressure does not
     * depend on the order being obeyed: `ROAD_EAST` is 122.26 m from the far
     * working, and an attack-move engages what is in front of it.
     *
     * LITERAL ALLIED KEYS. `EffectSink.spawnUnits` resolves through
     * `ProductionCatalog.byKey` and remaps nothing, unlike the layout's
     * `ScenarioBuilder.spawnUnit`; `validateCampaign` checks each key against the
     * army of the seat it lands on, so a Soviet key here is a build error.
     */
    {
      id: 't.wave1',
      when: { on: 'elapsed', ticks: minutes(3) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Wend, intercepted',
          text: 'Ninth District. The revision is signed and the sector reads nil. Take the head '
            + 'of the lane first — whatever is still turning at seventeen hundred goes in the '
            + 'report as theirs.',
        },
        { do: 'revealArea', player: 0, area: { x: ROAD_EAST.x, z: ROAD_EAST.z, r: 42 } },
        { do: 'spawnUnits', player: 1, key: 'gi', count: 4, at: ROAD_EAST, spread: 20, tag: 'wave1' },
        { do: 'spawnUnits', player: 1, key: 'grizzly', count: 2, at: ROAD_EAST, spread: 14, tag: 'wave1' },
        { do: 'orderTagged', tag: 'wave1', order: 'attackMove', at: WORKING_FAR },
      ],
    },

    /* -- the tap, disclosed ------------------------------------------------
     * Minute five, which is after the first troop has landed and before the
     * second forms. `hidden` objectives are filtered out of the briefing
     * (`briefingObjectives`), so this really is a surprise — and it arrives at
     * the moment it becomes a decision rather than a line the player read before
     * the match started.
     */
    {
      id: 't.disclose',
      when: { on: 'elapsed', ticks: minutes(5) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'Signals pulled a number off their traffic. The revision does not say the seam '
            + 'produced nothing. It says we produced nothing and they produced it, and their '
            + 'number comes off one derrick east of the shift house.',
        },
        { do: 'revealArea', player: 0, area: ALLIED_TAP_AREA },
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'Nine hundred a minute, and it is the only line in their column. Level it and '
            + 'the filing has a hole in it. It costs you whatever you send, for as long as it '
            + 'is gone.',
        },
        { do: 'setObjective', id: 'ledger' },
      ],
    },

    /* -- the second troop -------------------------------------------------- */
    {
      id: 't.wave2',
      when: { on: 'elapsed', ticks: minutes(6.5) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Wend, intercepted',
          text: 'Second troop, west of the lane. Anything still turning is still on their '
            + 'books.',
        },
        { do: 'revealArea', player: 0, area: { x: ROAD_WEST.x, z: ROAD_WEST.z, r: 42 } },
        { do: 'spawnUnits', player: 1, key: 'gi', count: 5, at: ROAD_WEST, spread: 20, tag: 'wave2' },
        { do: 'spawnUnits', player: 1, key: 'grizzly', count: 3, at: ROAD_WEST, spread: 14, tag: 'wave2' },
        { do: 'orderTagged', tag: 'wave2', order: 'attackMove', at: WORKING_MID },
      ],
    },

    /* -- both bearings at once ---------------------------------------------
     * Minute ten, and it is the beat the operation is built around: two columns
     * forming **131.03 m apart** on opposite flanks of the Ninth's yard, aimed
     * at two workings 75.47 m apart. The player cannot be at both, which is the
     * whole premise stated as a fact on the ground rather than as a line of
     * dialogue. The west prong marches 186.17 m and the east one 122.26 m, so
     * they do not land together — the beat is two problems, not one bigger one.
     *
     * TWO TAGS RATHER THAN ONE, AND IT HAS TO BE. `EffectSink.orderTagged`
     * issues one command and a `Command` names one destination, so a shared tag
     * would send both prongs to the same place and delete the beat.
     *
     * NO REVEAL. `revealArea` is `Vision.exploreCircle`, which is PERMANENT, so
     * both staging grounds have been on the player's map since minutes three and
     * six and a half. Re-revealing them would be a no-op wearing the costume of
     * a beat.
     */
    {
      id: 't.wave3',
      when: { on: 'elapsed', ticks: minutes(10) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'Two columns, two bearings, ten minutes gone. You cannot be at both. Decide '
            + 'which one you are not going to.',
        },
        { do: 'spawnUnits', player: 1, key: 'gi', count: 3, at: ROAD_EAST, spread: 20, tag: 'wave3e' },
        { do: 'spawnUnits', player: 1, key: 'grizzly', count: 2, at: ROAD_EAST, spread: 14, tag: 'wave3e' },
        { do: 'orderTagged', tag: 'wave3e', order: 'attackMove', at: WORKING_FAR },
        { do: 'spawnUnits', player: 1, key: 'gi', count: 3, at: ROAD_WEST, spread: 20, tag: 'wave3w' },
        { do: 'spawnUnits', player: 1, key: 'grizzly', count: 2, at: ROAD_WEST, spread: 14, tag: 'wave3w' },
        { do: 'orderTagged', tag: 'wave3w', order: 'attackMove', at: WORKING_MID },
      ],
    },

    /* -- the last troop -----------------------------------------------------
     * Minute thirteen and a half, aimed at the NEAR working, which is the one a
     * player who committed forward has left behind. Three and a half minutes to
     * the close: long enough to lose it in, short enough that pulling everything
     * back concedes whatever is out on the lane.
     *
     * **271.54 m OF ATTACK-MOVE, AND IT IS AIMED PAST EVERYTHING THE PLAYER
     * STILL HOLDS.** The order names the near working; the column has to cross
     * the whole lane to reach it, which is three and a half minutes of ground
     * with the other two workings beside it.
     *
     * **IT DOES NOT SWEEP THEM ON THE WAY, AND AN EARLIER DRAFT SAID IT DID.**
     * That draft quoted `ROAD_EAST -> FAR` 122.26 m and `-> MID` 188.73 m as
     * "what is in front of it" — but those are distances from the STAGING
     * POINT, not clearances from the march. Measured off the straight
     * ROAD_EAST -> WORKING_NEAR segment, WORKING_MID sits **35.82 m** off it
     * and WORKING_FAR **50.61 m**, against the widest acquisition radius in the
     * column: `reachOf` returns 0 for an attack-moving unit, so it is
     * `range * COMBAT_TARGETING.acquireRangeMul` — `lightCannon` 24 x 1.08 =
     * **25.92 m** for a Warden and 19.44 for a G.I. Neither working is acquired
     * from the path. What actually puts this column on a working is the same
     * thing that puts every other one there: `AiBrain.regroupSquads` files it
     * and the brain picks its own target. The order is a heading, and the
     * layout's header says so.
     */
    {
      id: 't.wave4',
      when: { on: 'elapsed', ticks: minutes(13.5) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Wend, intercepted',
          text: 'Everything the district has, down the lane. Seventeen hundred is in three and '
            + 'a half minutes and I am not filing a partial.',
        },
        { do: 'spawnUnits', player: 1, key: 'gi', count: 5, at: ROAD_EAST, spread: 20, tag: 'wave4' },
        { do: 'spawnUnits', player: 1, key: 'grizzly', count: 4, at: ROAD_EAST, spread: 14, tag: 'wave4' },
        { do: 'orderTagged', tag: 'wave4', order: 'attackMove', at: WORKING_NEAR },
      ],
    },

    /* -- the first one goes -------------------------------------------------
     * FAILS THE SECONDARY AT THE MOMENT IT BECOMES UNREACHABLE, rather than at
     * the close. A working cannot be rebuilt — no sidebar in the game makes a
     * `civOreMine` — so "all three standing" is over the instant one is not, and
     * an objective that stays lit after it is impossible is a lie the player
     * plays against for another ten minutes.
     *
     * `structureLost` ALREADY HAS A CALLER AND THIS DRAFT CLAIMED IT DID NOT.
     * `audio.system.ts` says it on `entity:killed` for any building the LOCAL
     * player owned, so the organic line fires on the same tick a working dies —
     * and `allies.02.instrument-room` scripts it too. The scripted one is not a
     * doubled announcement in practice, because `EVA_LINES.structureLost`
     * carries `cooldown: 5` and the two land inside one second of each other;
     * it is mostly redundant rather than harmful. Kept because the trigger also
     * carries the objective failure and the line belongs with it.
     */
    {
      id: 't.lost',
      when: {
        on: 'all',
        of: [
          { on: 'elapsed', ticks: SETTLE },
          { on: 'ownerCount', player: 0, role: 'building', tag: 'working', max: 2 },
        ],
      },
      then: [
        { do: 'eva', line: 'structureLost' },
        { do: 'failObjective', id: 'all' },
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'One working off the books. Three hundred a minute went with it, and the next '
            + 'one ends the shift.',
        },
      ],
    },

    /* -- the raid pays ------------------------------------------------------
     * `entityDead`, which is a destruction and not a capture — and the player CAN
     * capture it instead. `Capture.ts` rule 2 allows an engineer onto an
     * army-owned structure at or below `CAPTURE.captureHpFrac` (0.5), so a
     * commander who would rather have the 900 a minute than the filing can walk
     * one in and take it. That takes the income off the Ninth exactly as levelling
     * it does, and the objective still reads as unmet, because the objective is
     * the FILING: a derrick standing in Soviet hands is still a derrick the
     * revision can point at. The title says level it.
     */
    {
      id: 't.tapDown',
      when: {
        on: 'all',
        of: [
          /*
           * CONJOINED WITH THE DISCLOSURE, AND NOT FOR TIDINESS. `entityDead`
           * reads TRUE before a tag has ever existed, so a tap the layout failed
           * to place would COMPLETE this hidden secondary on tick one — and
           * `t.disclose` would then `setObjective` it back to active at minute
           * five, so the objective would complete, un-complete and finally fail.
           * Sharing one clock with its own disclosure makes the objective's
           * existence and its completion the same event, and it costs a player
           * who kills the tap early nothing but the wait.
           */
          { on: 'elapsed', ticks: minutes(5) },
          { on: 'entityDead', tag: 'alliedTap' },
        ],
      },
      then: [
        { do: 'completeObjective', id: 'ledger' },
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'Their derrick is down. Whatever the Ninth files this quarter, it files with '
            + 'nothing underneath it.',
        },
      ],
    },

    /* -- the close, telegraphed --------------------------------------------- */
    {
      id: 't.closing',
      when: { on: 'elapsed', ticks: minutes(15.5) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'Ninety seconds on the shift. Hold what you are holding.',
        },
      ],
    },

    /* -- the district is finished -------------------------------------------
     * DIALOGUE ONLY. The win itself is `t.close`, whose `CLOSE` carries this
     * same `ROUTED` on its other arm — so this line and the ending land on one
     * tick, in file order, and there is still exactly one place in this table
     * that ends the operation in a win.
     */
    {
      id: 't.routed',
      when: ROUTED,
      then: [
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'Nothing answering from the district. There is nobody left to file it.',
        },
      ],
    },

    /* -- the secondaries resolve FIRST ---------------------------------------
     * ABOVE `t.close`, deliberately: `runDirector` returns early once an outcome
     * is set, so anything that resolves at the close has to resolve before the
     * operation ends or the medal does not count it. Same ordering rule
     * `soviets-deep-sector` states for `t.mastsDown` and `04-company-town` for
     * `t.five`.
     */
    {
      id: 't.all',
      when: {
        on: 'all',
        of: [
          CLOSE,
          { on: 'ownerCount', player: 0, role: 'building', tag: 'working', min: 3 },
        ],
      },
      then: [
        { do: 'completeObjective', id: 'all' },
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'All three still turning. Nine hundred a minute the schedule says does not '
            + 'exist.',
        },
      ],
    },
    {
      id: 't.tapStanding',
      when: {
        on: 'all',
        of: [
          CLOSE,
          { on: 'not', of: { on: 'objectiveComplete', id: 'ledger' } },
        ],
      },
      then: [{ do: 'failObjective', id: 'ledger' }],
    },

    /* -- the shift closes ----------------------------------------------------
     * The count is restated here rather than inherited from `t.cut` firing
     * first. They cannot both hold — one wants at most one working and this
     * wants at least two — so the restatement costs nothing at runtime, and a
     * win that read only the clock would be a win a later edit could detach from
     * the objective entirely.
     */
    {
      id: 't.close',
      when: {
        on: 'all',
        of: [
          CLOSE,
          { on: 'ownerCount', player: 0, role: 'building', tag: 'working', min: 2 },
        ],
      },
      then: [
        { do: 'completeObjective', id: 'hold' },
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'Shift is closed and the sector is still producing. The revision goes back up '
            + 'the line with a correction written on it.',
        },
        { do: 'endOperation', result: 'win' },
      ],
    },

    /* -- the second one goes -------------------------------------------------
     * IMMEDIATE, AT ANY MINUTE. See the header: this is what stops the operation
     * being a countdown with scenery. A player who has lost the sector finds out
     * on the tick it happens.
     */
    {
      id: 't.cut',
      when: {
        on: 'all',
        of: [
          { on: 'elapsed', ticks: SETTLE },
          { on: 'ownerCount', player: 0, role: 'building', tag: 'working', max: 1 },
        ],
      },
      then: [
        { do: 'failObjective', id: 'hold' },
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'Second working gone. The sector reads nil, and the schedule was right the '
            + 'whole time.',
        },
        { do: 'endOperation', result: 'loss', reason: 'hold' },
      ],
    },

    /* -- the ordinary loss ---------------------------------------------------
     * `playerBeaten` is `Viability.isBeaten` — nothing to build with and nothing
     * to fight with — not "you have no buildings". A commander whose yard is gone
     * while two workings are still paying him 600 a minute is not beaten, and
     * this operation would like that to be a position somebody can play from.
     */
    {
      id: 't.beaten',
      when: {
        on: 'all',
        of: [
          { on: 'elapsed', ticks: SETTLE },
          { on: 'playerBeaten', player: 0 },
        ],
      },
      then: [
        { do: 'failObjective', id: 'hold' },
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'Nothing answering. Whatever is left turning on that seam is theirs to count.',
        },
        { do: 'endOperation', result: 'loss', reason: 'hold' },
      ],
    },
  ],
};

export default op;
