/**
 * ============================================================================
 * tests/sea-plan-channel.spec.ts — ONE SEA, TWO CHANNELS, AND THEY MUST AGREE
 * ============================================================================
 *
 * The sea a map is generated with reaches the generator by TWO independent
 * routes, and nothing checked that they say the same thing:
 *
 *   `world/terrain-plan.plannedTerrainInput()`  reads `plannedScenario().sea`
 *       directly, because it runs at MODULE SCOPE to prewarm the worker and
 *       `world.sea`'s `init()` has not happened yet.
 *
 *   `Terrain`'s constructor                     reads `plannedSea()`, the
 *       `setPlannedSea()` channel, which `world/sea.system.ts` fills from
 *       `plannedScenario().sea` at `Phase.Command` order 20.
 *
 * `terrain-plan.ts` states they "agree by construction", and adds that if they
 * ever stopped agreeing `terrainGenKey` would miss and the map would generate
 * on the main thread rather than come out wrong. Both claims are probably true.
 * Neither was tested, and a comment asserting agreement is exactly the shape of
 * thing this repository has been bitten by: `setPlannedArmies` shipped with its
 * whole contract written out and ONE reference in the repo, its own definition.
 *
 * WHAT WAS ALREADY CORRECT, and is pinned here so a refactor cannot quietly
 * undo it: `Shell.bootGame` writes the settled query with `history.replaceState`
 * BEFORE it calls `resetScenarioPlan()` / `resetTerrainPlan()`. That order is
 * the whole fix for the bug where a stale `?map=` left `sea: null` in the cached
 * terrain input and both sea maps shipped dry. Reversing those lines would
 * reintroduce it silently.
 *
 * WHAT THIS FILE CANNOT DO is boot the shell. So it tests the pieces the shell
 * wires together: that the memo is a pure function of the URL, that dropping it
 * really does re-derive, and that both channels resolve to the same object for
 * every shipped map.
 *
 * VERDICT ON THE RACE: it is not there. The memo is a pure function of
 * `location.search`, `bootGame` settles the query before dropping it, and the
 * two channels agree on all ten battlefields. What this file is really worth is
 * the vacuity guard — writing the agreement check against the lobby ID instead
 * of the PRESET made every map answer `null`, and two nulls agree. A green
 * "the channels match" over ten silently landlocked maps is precisely the
 * failure that shipped both sea maps dry the first time.
 * ============================================================================
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { MAP_SEAS, plannedScenario, resetScenarioPlan } from '../src/game/Scenarios';
import { plannedTerrainInput, resetTerrainPlan } from '../src/world/terrain-plan';
import { MAPS } from '../src/shell/settings-store';

/*
 * `test.environment` is `node` for every spec in this repo, so there is no
 * `location` and no `history`. Both plan modules guard with
 * `typeof location !== 'undefined'` and answer the defaults without one, which
 * is the honest headless behaviour and useless for this file: the whole
 * question is what they do when the query CHANGES.
 *
 * A two-property stand-in is enough. `plannedScenario` builds a
 * `URLSearchParams` from `location.search`; `seedFromUrl` and `biomeFromUrl`
 * behind `plannedTerrainInput` do the same. Nothing reads anything else.
 */
const g = globalThis as unknown as Record<string, unknown>;
const hadLocation = 'location' in g;
const stubLocation = { pathname: '/', search: '' };

beforeAll(() => {
  if (!hadLocation) {
    g.location = stubLocation;
    g.history = { replaceState: (_s: unknown, _t: unknown, url: string) => {
      const i = url.indexOf('?');
      stubLocation.search = i < 0 ? '' : url.slice(i);
    } };
  }
});

afterAll(() => {
  if (!hadLocation) { delete g.location; delete g.history; }
});

/**
 * Point `location.search` at a map the way `Shell.bootGame` does, then drop
 * both memos — the same order, because the order is the thing being pinned.
 */
function bootWith(query: string): void {
  history.replaceState(null, '', `${location.pathname}${query}`);
  resetScenarioPlan();
  resetTerrainPlan();
}

afterEach(() => {
  bootWith('');
});

describe('the sea reaches the generator the same way twice', () => {
  it('agrees between the two channels for every shipped map', () => {
    // `sea.system.ts` does `setPlannedSea(plannedScenario().sea)` and `Terrain`
    // reads that back, so `plannedScenario().sea` IS the second channel's value.
    // Comparing it against the first channel's is comparing the two routes.
    for (const m of MAPS) {
      bootWith(`?map=${m.preset}`);
      const viaPlan = plannedScenario().sea;
      const viaTerrainInput = plannedTerrainInput().sea;
      expect(viaTerrainInput, `"${m.id}" disagrees between the two sea channels`)
        .toBe(viaPlan);
    }
  });

  it('gives the three sea battlefields a sea and the other seven none', () => {
    // GUARDS THE TEST ABOVE AGAINST PASSING VACUOUSLY. Two nulls agree, and a
    // roster where every answer is null is exactly what a broken `?map=`
    // produces — which is not hypothetical: writing this test with `m.id`
    // instead of `m.preset` produced ten nulls and a green agreement check.
    const wet: string[] = [];
    for (const m of MAPS) {
      bootWith(`?map=${m.preset}`);
      if (plannedTerrainInput().sea !== null) wet.push(m.id);
    }
    expect(wet.sort()).toEqual(['contested-strait', 'coral-shore', 'sunder-atoll']);
  });

  it('is keyed on the PRESET, which is what the query carries', () => {
    // `buildMatchQuery` writes `q.set('map', map.preset)` and `resolveMapName`
    // matches against `MAP_PRESETS` keys, so `MAP_SEAS` must be keyed the same
    // way. Feeding it a lobby ID resolves nothing, warns, and falls back to the
    // plan's default map — silently landlocked, which is the exact shape of the
    // bug where both sea maps shipped dry.
    bootWith('?map=sunder-atoll');   // the lobby ID, deliberately wrong here
    expect(plannedScenario().sea, 'a lobby id must NOT resolve to a sea').toBeNull();
    bootWith('?map=atoll');          // the preset, which is what the shell writes
    expect(plannedScenario().sea, 'the preset must').not.toBeNull();
    for (const key of Object.keys(MAP_SEAS)) {
      expect(MAPS.some((m) => m.preset === key), `MAP_SEAS["${key}"] names no preset`)
        .toBe(true);
    }
  });
});

describe('a sea does not survive into a differently-mapped boot', () => {
  it('re-derives after the memos are dropped', () => {
    // THE RACE THIS FILE WAS OPENED FOR. Boot a sea map, then boot a landlocked
    // one the way the shell does. A memo that outlived the reset would carve a
    // coast into a map that has none, and the only visible symptom is a
    // screenshot — the same class as a stale biome.
    bootWith('?map=atoll');
    expect(plannedTerrainInput().sea, 'the atoll has a sea').not.toBeNull();

    bootWith('?map=temperate');
    expect(plannedTerrainInput().sea, 'a sea survived into a landlocked boot')
      .toBeNull();
    expect(plannedScenario().sea, 'and through the other channel too').toBeNull();
  });

  it('re-derives in the other direction, which is the easier half to break', () => {
    bootWith('?map=temperate');
    expect(plannedTerrainInput().sea).toBeNull();

    bootWith('?map=atoll');
    expect(plannedTerrainInput().sea, 'a landlocked memo outlived a sea boot')
      .not.toBeNull();
  });

  it('is memoised, so the answer cannot move mid-boot', () => {
    // The other half of the contract: WITHIN one boot the plan must not change,
    // because terrain, ore, props and the prewarm all ask at different phases
    // and a moving answer is a world that disagrees with itself.
    bootWith('?map=atoll');
    const first = plannedTerrainInput().sea;
    history.replaceState(null, '', `${location.pathname}?map=temperate`);
    expect(plannedTerrainInput().sea, 'the memo re-read the URL without a reset')
      .toBe(first);
  });
});

describe('the sea comes off the map preset, not off the plan', () => {
  it('reaches every sea map through MAP_SEAS', () => {
    // `plannedScenario` resolves `plan.sea ?? MAP_SEAS[mapKey] ?? null`. It used
    // to read `plan.sea ?? null`, and because only `?shot=` fixtures set
    // `plan.sea`, that left every LOBBY-selected map dry — four naval
    // structures and two unlock chains unreachable in every match anyone
    // played. This pins the fallback that fixed it.
    const wet = Object.keys(MAP_SEAS);
    expect(wet.length, 'MAP_SEAS is empty — the fallback is dead').toBeGreaterThan(0);
    for (const key of wet) {
      expect(MAP_SEAS[key], `MAP_SEAS["${key}"]`).not.toBeNull();
    }
  });
});
