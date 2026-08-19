/**
 * ============================================================================
 * A1 — SOUNDING LINE
 * ============================================================================
 * The first reading of the new schedule. Aubray needs two points on the seam
 * and a gradient between them; the survey party is three people and a string.
 *
 * ============================================================================
 * WHAT THE PLAYER GIVES UP, WHICH IS THE ONLY QUESTION AN ESCORT HAS TO ANSWER
 * ============================================================================
 * They give up their half of the map, and the numbers are measured rather than
 * hoped for. The seam runs down the opening lane with a head at each end, 92.2
 * metres apart and symmetric about the map centre; on this seed the seated slot
 * pair is antipodal too, so the two heads land one per half at exactly the same
 * distances reversed:
 *
 *     player yard  (402, 378)   ->  deep head 145.0 m   control head 235.8 m
 *     enemy yard   (110, 134)   ->  deep head 235.8 m   control head 145.0 m
 *
 * That mirror is a property of `simSeed`, not of the construction — two of the
 * four entries in `START_PAIRS` are edge pairs and are not centre-symmetric.
 * The layout's header carries the measurement and the warning.
 *
 * THE READING YOU MUST TAKE IS ON YOUR SIDE; THE READING YOU MAY TAKE IS ON
 * THEIRS. The deep head is bare ore 145 m from the player's yard and it is the
 * primary — ninety seconds standing on it. The control head is the same ore
 * with two guns dug in beside it, 145 m from the ENEMY'S yard, and it is a
 * secondary worth five hundred credits that expires at five minutes.
 *
 * So the decision arrives at about minute two and it is not a build order:
 *
 *   - march now, with the column the layout forms up, cross 279 m, crack a
 *     dug-in post on the enemy's doorstep and stand on it for forty-five
 *     seconds — then walk three unarmed men 92 m back across the lane and
 *     stand still for ninety more, with whatever escort came home; or
 *   - spend three minutes on the war factory and watch the window close while
 *     you are still inside your own build radius.
 *
 * The ore is the third arm of it. Both heads sit on the richest fields on the
 * map, so the harvesters want precisely the ground the escort cannot be in two
 * places to cover. None of that is scripted. It is where the ore is, where the
 * guns are, and one clock.
 *
 * ============================================================================
 * THE THREAT IS NOT ON THE FIELD UNTIL THE STRING IS DOWN
 * ============================================================================
 * `setInvulnerable` was cut and its stated replacement is exactly this: do not
 * spawn the threat until the first checkpoint. The post's relief is a
 * `spawnUnits` on `t.plate`, which cannot fire until the party has been on the
 * deep head for twenty seconds — so the party cannot be killed by a wave the
 * player never had the chance to see coming, and a player who reaches the head
 * slowly is not punished for it by a wall-clock timer that started without them.
 *
 * TWENTY SECONDS RATHER THAN ON ARRIVAL, AND THE REASON IS THE GROUND. Both
 * heads sit on the lane, so the deep head is only **11.0 m** off the straight
 * line from the party's start to the control head — a party going for the
 * secondary walks through the primary's disc on the way. The widest chord of a
 * 20 m disc is 40 m and an engineer crosses it in 11.8 s at 3.4 m/s, so an
 * arrival trigger would call the counter-attack on a squad that was passing
 * through. An arm timer twenty seconds long cannot be tripped in transit, and
 * it says the true thing instead: what the enemy reacts to is the string going
 * down, not three people walking past.
 *
 * The relief forms at the CONTROL head, which is 145 m from the enemy's own
 * yard — its post and its doorstep at once — so a player who went for the
 * secondary and left a detachment there gets the wave in their lap, and a
 * player who did not gets the length of the lane as warning.
 *
 * ============================================================================
 * THE HOLD IS THE OPERATION AND IT RESTARTS
 * ============================================================================
 * `elapsedSinceArmed` disarms the moment the party steps off the head, so the
 * ninety seconds start again. That is the reason this is one long stand rather
 * than a chain of arrival checks: a corridor of `unitsInArea` checkpoints asks
 * the player to walk, and one hold that can be lost at eighty-nine seconds asks
 * them to decide what the escort dies for. Aubray says so out loud on `t.plate`
 * — a rule the player can only learn by losing it is a rule badly told.
 *
 * ============================================================================
 * THE TWO OUTCOME RULES ARE BOTH OFF
 * ============================================================================
 * `annihilationWin` because killing the opponent does not produce a reading,
 * and this operation is emphatically winnable without a second engagement.
 * `assetLossDefeat` because an escort whose base is gone is an escort with
 * nothing left to lose but the party — which is the most interesting last act
 * this mission has, and `Shell.pollOutcome` would end it at 2 Hz instead.
 * ========================================================================== */

import { Faction } from '../../../core/types';
import { CONTROL_HEAD, DEEP_HEAD } from '../../layouts/allies-sounding-line';
import { minutes, seconds } from '../../types';
import type { OperationDef } from '../../types';

/** The post's relief forms on the ground it is the relief for. */
const POST = { x: CONTROL_HEAD.x, z: CONTROL_HEAD.z };

/**
 * Ticks the string takes to reach the plate and read.
 *
 * NINETY SECONDS AGAINST A 780-SECOND PAR, and the rest of the budget is walked
 * rather than waited. The party spawns at (431, 410) — 187.6 m from the deep
 * head and 278.8 m from the control head, both measured on a built world — and
 * an engineer moves at 3.4 m/s, so the two legs are 55 s and 82 s of pure
 * movement before pathing. Reading both heads plus walking the whole route is
 * about four and a half minutes of a thirteen-minute par; the rest is the
 * fight, which is the correct ratio for an operation whose whole subject is
 * what the escort is doing while the party stands still.
 *
 * THE DISTANCES ARE MEASURED AND THE PACING IS NOT. Nothing has played this
 * yet. The arithmetic is here so a real run can be checked against it rather
 * than compared with a feeling.
 */
const DEEP_READING = seconds(90);
/** The control reading is shorter because it is optional and it is under fire. */
const CONTROL_READING = seconds(45);

/**
 * When the control reading stops being worth taking.
 *
 * Chosen against the march rather than against the par. 278.8 m at 3.4 m/s is
 * 82 s of walking, the post has to be broken 145 m from the enemy's own yard,
 * and the reading is another 45 s — call it 187 s of work inside a 300 s
 * window. The ~110 s left over is about one production cycle, which is the
 * whole intent: the player may spend a queue on this, not three. Five minutes
 * is the point at which "I will go in a moment" has already cost them the
 * objective.
 */
const CONTROL_WINDOW = minutes(5);

const op: OperationDef = {
  id: 'allies.01.sounding-line',
  chapter: 'allies',
  faction: Faction.Allies,
  // `t.plate` spawns `conscript` and `rhino` and its own comment says why:
  // "Soviet keys because the antagonist of this chapter is". The rest of that
  // sentence — "even though nothing in `OperationDef` can pin the opposing
  // seat's army" — is what this field retires.
  foe: Faction.Soviets,
  index: 1,
  title: 'Sounding Line',
  beat: 'Two points on the seam and a gradient between them. The party is three people.',
  primaryType: 'escort',
  archetype: 'bespoke',
  parSec: 780,
  requires: [],

  map: {
    preset: 'temperate',
    // Pinned, and `tests/campaign-maps.spec.ts` builds this ground for real on
    // every run. The heads are absolute map coordinates, so a generator change
    // that re-rolls the valley moves the terrain UNDER a fixed objective rather
    // than moving the objective — which is survivable, because the map centre
    // is a reserved shelf on every seed, and loud, because the fingerprint
    // changes.
    mapSeed: 20_260_819,
    simSeed: 7_014,
    armies: 2,
    biome: 'temperate',
    opening: 'base',
    // NOT THE SKIRMISH 10 000. That bank buys a second army inside the control
    // window and deletes the only decision this operation is made of; the
    // column the layout forms up is meant to BE the escort, not a down payment
    // on one. 2500 is a considered purchase, not a build order — and it binds
    // the opposing seat identically, which is the lever CLAUDE.md names for the
    // AI opening that has been reported as a prebuilt base twice.
    credits: 2_500,
  },
  layout: 'allies-sounding-line',

  outcome: { annihilationWin: false, assetLossDefeat: false, ignoreSeats: [] },

  // Nothing granted on either side, which is NOT the same as nothing withheld.
  // Two empty lists make `isBuildable` an allow-list, so every tagged def is
  // refused for both seats — no Proving Ground, no Tesla Coil, no Refractor Tower, no
  // IFV, no Attack Dog, no Sledge, in the opening bases or in the sidebar.
  // That is the right shape for a first operation: what is left is the opening
  // path, which is what the difficulty here is actually made of — a clock, two
  // guns and ninety seconds of standing still. It is also SYMMETRIC and
  // profile-independent, so the ground is the same on a finished account as on
  // a fresh one, which a deny-list could not promise.
  roster: { player: [], ai: [] },

  /*
   * ============================================================================
   * `'all'`, AND IT IS THE ONE OPERATION IN THE TABLE THAT NEEDS THE BLANKET
   * ============================================================================
   * THE SURVEY PARTY IS THE OBJECTIVE AND EVERY CAPTURE SPENDS ONE. `t.lost` is
   * `entityDead 'party'` into `endOperation: 'loss'`, the three surveyors are
   * `engineer`s, and `CaptureService.resolve` consumes the engineer on EVERY
   * non-refused outcome — the capture branch and the SOFTEN branch alike. So
   * three right-clicks on a structure are a stated defeat, with a
   * build-complete burst and a colour change as the only feedback.
   *
   * **A TAG LIST CANNOT DO IT, BECAUSE THE HAZARDS ARE UNTAGGED.** The layout
   * stamps exactly two tags — `party` and `sortie` — and neither is a building.
   * The structures that eat surveyors are the two Works masts and the picket
   * guns, and none of them is tagged, because nothing in this trigger table ever
   * names one. Tagging three structures for the sole purpose of forbidding their
   * capture would be a second, invisible copy of this field, and it would still
   * miss the next structure a layout edit adds.
   *
   * **AND THERE IS NOTHING TO LOSE BY THE BLANKET.** No condition in this file
   * is `structureCaptured` or `ownerCount`; no objective is satisfied by taking
   * anything. `pact.02`, `pact.04` and `soviets.06` all take a LIST instead,
   * precisely because each of them has a deed a player is meant to be able to
   * take.
   *
   * ── WHAT IT DOES NOT COVER, MEASURED ───────────────────────────────────────
   * `resolve` tests the FRIENDLY branch before it consults the vetoes, so a
   * surveyor sent at a DAMAGED structure this player owns still repairs it and
   * is still consumed. `opening: 'base'` means there are such structures.
   * That is unchanged by this field and deliberately not closed here: moving the
   * veto ahead of the friendly branch would change what `GarrisonService`'s veto
   * means as well, and its rule is about taking a building rather than mending
   * one. The reading discs are what this operation is played on and no friendly
   * structure stands in either — `tests/sounding-line-clearance.spec.ts` is the
   * gate on that, and it now measures the ground rather than pinning a caveat.
   */
  captureProof: 'all',

  objectives: [
    { id: 'sound', kind: 'primary', title: 'Sound the seam at the deep head' },
    { id: 'party', kind: 'primary', title: 'Bring the survey party through' },
    {
      id: 'gradient',
      kind: 'secondary',
      title: 'Take the control reading inside five minutes',
      credits: 500,
    },
  ],

  triggers: [
    /* -- the brief, in two beats ------------------------------------------
     * Split across ten seconds because the shell renders dialogue as toasts and
     * three of them at once is a stack nobody reads. The second beat is the one
     * carrying the decision, so it lands last and alone.
     */
    {
      id: 't.open',
      when: { on: 'elapsed', ticks: seconds(4) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Aubray',
          text: 'Three surveyors and a sounding string. The seam runs down this valley — two '
            + 'heads, ninety-two metres apart, one in our half and one in theirs. Ninety '
            + 'seconds standing on the deep one and the Works have their first number since '
            + 'the Split.',
        },
        // Both heads, before either is an objective. The player is meant to see
        // the shape of the problem — including the guns — while they still have
        // the whole match to answer it.
        { do: 'revealArea', player: 0, area: { x: CONTROL_HEAD.x, z: CONTROL_HEAD.z, r: 52 } },
        { do: 'revealArea', player: 0, area: { x: DEEP_HEAD.x, z: DEEP_HEAD.z, r: 52 } },
      ],
    },
    {
      id: 't.brief',
      when: { on: 'elapsed', ticks: seconds(14) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Wend',
          text: 'The control head is a hundred and forty-five metres from their yard and '
            + 'there are two guns on it. They were put there nine days ago and nobody filed '
            + 'a reason.',
        },
        {
          do: 'dialogue',
          speaker: 'Aubray',
          text: 'The control reading closes at five minutes. Decide now, not at four.',
        },
      ],
    },

    /* -- the secondary, both directions -----------------------------------
     * `min: 2` where the primary takes 1, and the asymmetry is the attrition
     * ladder: a control reading is a second observer on known ground, so losing
     * two surveyors costs the secondary and still leaves the operation winnable
     * with one man. Both of these sit ABOVE `t.win` so a secondary resolving on
     * the same tick as the outcome is counted by the medal — `runDirector`
     * returns early once an outcome is set.
     *
     * The `not objectiveFailed` guard is what stops "That matches." playing
     * after the window has already shut. Without it a party mid-hold at minute
     * five gets the failure line and then the congratulation.
     */
    {
      id: 't.control',
      when: {
        on: 'all',
        of: [
          { on: 'unitsInArea', player: 0, area: CONTROL_HEAD, min: 2, tag: 'party' },
          { on: 'not', of: { on: 'objectiveFailed', id: 'gradient' } },
          { on: 'elapsedSinceArmed', ticks: CONTROL_READING },
        ],
      },
      then: [
        { do: 'completeObjective', id: 'gradient' },
        {
          do: 'dialogue',
          speaker: 'Aubray',
          text: 'Control reading logged. Two per cent long, exactly as modelled. That matches.',
        },
      ],
    },
    {
      id: 't.window',
      when: {
        on: 'all',
        of: [
          { on: 'elapsed', ticks: CONTROL_WINDOW },
          { on: 'not', of: { on: 'objectiveComplete', id: 'gradient' } },
        ],
      },
      then: [
        { do: 'failObjective', id: 'gradient' },
        {
          do: 'dialogue',
          speaker: 'Wend',
          text: 'Control window is shut. We can still take the deep reading. We just will '
            + 'not be able to say how wrong it is.',
        },
      ],
    },

    /* -- the string reaches the plate --------------------------------------
     * `t.win`'s predicate with a twenty-second arm on it, for the transit
     * reason in the header: the deep head is 11.0 m off the party's line to the
     * control head, so an arrival trigger fires on a squad walking past. Twenty
     * seconds against an 11.8 s worst-case crossing is the margin.
     *
     * Everything the player is owed arrives here: the rule that the hold
     * restarts, and the warning that the relief is moving. `revealArea` EXPLORES
     * ground rather than showing live units, so Wend's line is the part that
     * actually carries the warning and the reveal is only what makes it legible
     * when they look.
     */
    {
      id: 't.plate',
      when: {
        on: 'all',
        of: [
          { on: 'unitsInArea', player: 0, area: DEEP_HEAD, min: 1, tag: 'party' },
          { on: 'elapsedSinceArmed', ticks: seconds(20) },
        ],
      },
      then: [
        {
          do: 'dialogue',
          speaker: 'Aubray',
          text: 'String is at plate. Seventy seconds left on it, and it starts again from '
            + 'ninety if they step off.',
        },
        { do: 'dialogue', speaker: 'Wend', text: 'Post relief is moving off the control head.' },
        { do: 'revealArea', player: 0, area: { x: POST.x, z: POST.z, r: 44 } },
        // Six and two against a counted opening of seven Wardens and nine
        // G.I.s, minus whatever the control head cost and minus whatever is
        // still standing over the ore. Enough to take the head off an escort
        // that was spent getting there, not enough to be a second mission —
        // and Soviet keys because the antagonist of this chapter is — which
        // `foe: Faction.Soviets` now PINS rather than hopes for. The rest of
        // this sentence used to read "even though nothing in `OperationDef`
        // can pin the opposing seat's army", and `validateCampaign` refuses
        // these two keys on any seat that is not Soviet.
        { do: 'spawnUnits', player: 1, key: 'conscript', count: 6, at: POST, spread: 18, tag: 'sortie' },
        { do: 'spawnUnits', player: 1, key: 'rhino', count: 2, at: POST, spread: 26, tag: 'sortie' },
        { do: 'orderTagged', tag: 'sortie', order: 'attackMove', at: { x: DEEP_HEAD.x, z: DEEP_HEAD.z } },
      ],
    },

    /* -- the wounded line -------------------------------------------------
     * `entityHpBelow` reads the WEAKEST live carrier and answers -1 when
     * nothing carries the tag, so this cannot repeat forever after the party is
     * dead — which is the whole reason it is a different condition from
     * `entityDead`. `forcesUnderAttack` is the one line in `EVA_LINES` that is
     * literally true at this moment; there is no announcer line for "a
     * surveyor is hurt" and inventing one is a schema change.
     */
    {
      id: 't.wounded',
      when: { on: 'entityHpBelow', tag: 'party', frac: 0.5 },
      then: [
        { do: 'eva', line: 'forcesUnderAttack' },
        {
          do: 'dialogue',
          speaker: 'Wend',
          text: 'Surveyor down to half. We have three of them and the reading needs one.',
        },
      ],
    },

    /* -- the loss ---------------------------------------------------------
     * ABOVE THE WIN, because trigger order decides which of two outcomes on one
     * tick the end screen reports, and the author is meant to mean it. Nothing
     * else ends this operation: `playerBeaten` is deliberately not a loss here,
     * because a commander with no base and three surveyors still walking is a
     * commander who can finish, and the shipped rule that disagrees is switched
     * off in `outcome`.
     */
    {
      id: 't.lost',
      when: { on: 'entityDead', tag: 'party' },
      then: [
        { do: 'failObjective', id: 'party' },
        {
          do: 'dialogue',
          speaker: 'Aubray',
          text: 'That is the whole party. There is no reading, and no one left to take it.',
        },
        { do: 'endOperation', result: 'loss', reason: 'party' },
      ],
    },

    /* -- the win ---------------------------------------------------------- */
    {
      id: 't.win',
      when: {
        on: 'all',
        of: [
          { on: 'unitsInArea', player: 0, area: DEEP_HEAD, min: 1, tag: 'party' },
          { on: 'elapsedSinceArmed', ticks: DEEP_READING },
        ],
      },
      then: [
        { do: 'completeObjective', id: 'sound' },
        { do: 'completeObjective', id: 'party' },
        {
          do: 'dialogue',
          speaker: 'Aubray',
          text: 'Reading is in. Two points, ninety-two metres, and a gradient we can hang a '
            + 'timetable on. Walk them home.',
        },
        { do: 'endOperation', result: 'win' },
      ],
    },
  ],
};

export default op;
