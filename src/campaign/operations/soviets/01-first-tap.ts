/**
 * ============================================================================
 * S1 — FIRST TAP
 * ============================================================================
 * The March surfaces in a new place and the Allies get there first. Rakhalt's
 * orders are to take the seam and leave the town working.
 *
 * THE VERTICAL SLICE. This is the operation Gate M is measured on, so it is
 * shaped to exercise every seam rather than to be the simplest thing that
 * boots: a win condition that is NOT annihilation, a secondary that can be
 * failed by carelessness rather than by losing, a reinforcement wave on a
 * timer, and a loss path that is not "you have no buildings".
 *
 * **WIPING THE ENEMY DOES NOT WIN IT.** `outcome.annihilationWin` is false, so
 * killing every Allied unit and structure while leaving the tap standing leaves
 * the match running — which is the property the whole outcome-policy mechanism
 * exists for, and the one clause of Gate M that cannot be checked by reading.
 * ========================================================================== */

import { Faction } from '../../../core/types';
import { minutes, seconds } from '../../types';
import type { OperationDef } from '../../types';

const op: OperationDef = {
  id: 'soviets.01.first-tap',
  chapter: 'soviets',
  faction: Faction.Soviets,
  index: 1,
  title: 'First Tap',
  beat: 'The March surfaces in a new place. The Allies got there first.',
  primaryType: 'assault',
  archetype: 'reinforced',
  parSec: 780,
  requires: [],

  map: {
    preset: 'arid',
    // Fixed, and pinned by `tests/campaign-maps.spec.ts` as a terrain
    // fingerprint. A generator change that re-rolls this ground moves the
    // chokepoint the operation was authored around, and the fingerprint is what
    // makes that loud — it does not make it cheap.
    mapSeed: 20_260_819,
    simSeed: 5_101,
    armies: 2,
    biome: 'desert',
    opening: 'base',
    credits: 10_000,
  },
  layout: 'soviets-first-tap',

  // NEITHER SHIPPED RULE MAY END THIS. `Shell.pollOutcome` would otherwise
  // declare victory the moment the Allied base falls, with the tap untouched.
  outcome: { annihilationWin: false, assetLossDefeat: false, ignoreSeats: [] },

  // Nothing withheld and nothing granted. An opening operation restricting the
  // roster would be teaching the player that the sidebar lies.
  roster: { player: [], ai: [] },

  objectives: [
    { id: 'sink', kind: 'primary', title: 'Destroy the Allied survey tap' },
    {
      id: 'derricks',
      kind: 'secondary',
      title: 'Take the seam with all three derricks standing',
      credits: 500,
    },
  ],

  triggers: [
    /* -- the opening word ------------------------------------------------ */
    {
      id: 't.open',
      when: { on: 'elapsed', ticks: seconds(4) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Rakhalt',
          text: 'The survey says the seam runs under that town. The Allies sank a tap on it '
            + 'nine days ago. Take it off them. The derricks are the town’s — leave them.',
        },
      ],
    },

    /* -- the relief column ------------------------------------------------
     * Five minutes in, so it lands while the player is committed rather than
     * while they are still building. `spread` is a deterministic ring rather
     * than an RNG scatter: the same wave has to land in the same shape in the
     * recording, in the playback and in a designer's third run, or the
     * operation cannot be tuned at all.
     */
    {
      id: 't.relief',
      when: { on: 'elapsed', ticks: minutes(5) },
      then: [
        { do: 'eva', line: 'reinforcements' },
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'Column on the west road. They are not coming for us — they are '
            + 'covering the tap.',
        },
        {
          do: 'spawnUnits',
          player: 1,
          key: 'grizzly',
          count: 4,
          at: { x: 256, z: 256 },
          spread: 14,
          tag: 'relief',
        },
        { do: 'orderTagged', tag: 'relief', order: 'attackMove', at: { x: 256, z: 256 } },
      ],
    },

    /* -- the secondary, both directions -----------------------------------
     * The FAIL is checked continuously; the COMPLETE is checked on the tick the
     * tap dies. Order matters and it is the file's order: this trigger sits
     * ABOVE `t.win`, so on the winning tick the secondary resolves before the
     * operation ends and the medal counts it. Below `t.win` it would never fire
     * — `runDirector` returns early once an outcome is set.
     */
    {
      id: 't.derricksLost',
      when: { on: 'ownerCount', player: 1, role: 'building', tag: 'derrick', max: 2 },
      then: [
        { do: 'failObjective', id: 'derricks' },
        {
          do: 'dialogue',
          speaker: 'Rakhalt',
          text: 'That derrick fed four hundred people. Note it in the log and keep going.',
        },
      ],
    },
    {
      id: 't.derricksKept',
      when: {
        on: 'all',
        of: [
          { on: 'entityDead', tag: 'tap' },
          { on: 'ownerCount', player: 1, role: 'building', tag: 'derrick', min: 3 },
        ],
      },
      then: [{ do: 'completeObjective', id: 'derricks' }],
    },

    /* -- the win ---------------------------------------------------------- */
    {
      id: 't.win',
      when: { on: 'entityDead', tag: 'tap' },
      then: [
        { do: 'completeObjective', id: 'sink' },
        {
          do: 'dialogue',
          speaker: 'Rakhalt',
          text: 'Tap is down. Get a survey team on that seam before the Works do.',
        },
        { do: 'endOperation', result: 'win' },
      ],
    },

    /* -- the loss ---------------------------------------------------------
     * `playerBeaten` is `Viability.isBeaten` — nothing to build with and
     * nothing to fight with — not "you have no buildings". An operation that
     * ended on the second reading would end at t+10 s for a squad that has not
     * landed yet, which is one of the four shipped failures the outcome policy
     * exists to disarm.
     */
    {
      id: 't.lose',
      when: { on: 'playerBeaten', player: 0 },
      then: [{ do: 'endOperation', result: 'loss', reason: 'sink' }],
    },
  ],
};

export default op;
