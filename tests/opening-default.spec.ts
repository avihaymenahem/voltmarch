/**
 * ============================================================================
 * tests/opening-default.spec.ts — THE OPENING A REAL LAUNCH ACTUALLY GETS
 * ============================================================================
 * Reported, for the second time: "i still see AI has ready base and troops when
 * game barely started ... AI should progress with game, not have anything ready
 * upfront. it should collect ore, build stuff with the money."
 *
 * `tests/match-start.spec.ts` already proves the MCV opening seeds no
 * structures — but every one of its scenario cases passes `{ start: 'mcv' }`
 * EXPLICITLY. That is the same shape as the archipelago bug this repo has
 * already paid for once (`tests/archipelago.spec.ts` passed `{ armies: 4 }`
 * explicitly and so proved four bases while stepping straight over the channel
 * a player goes through). A test can be entirely right about the thing it tests
 * and still leave the feature disconnected.
 *
 * So this file asserts the DEFAULT — the value a launch gets when nothing asks
 * for anything — end to end: the stored preference, the lobby bank, and the
 * scenario resolved with no options at all.
 *
 * ── WHAT WAS MEASURED, so nobody re-runs it ────────────────────────────────
 * Fresh profile, real menu, Skirmish -> Start Battle, 1280x720, seed as rolled
 * (2026-08-18, on the shipping build):
 *
 *   - the lobby's Starting Condition row reads CONSTRUCTION VEHICLE;
 *   - the boot URL is `?start=mcv`;
 *   - tick 0: p0 (human) 0 buildings / 6 units, p1 (Soviet AI) 0 buildings /
 *     7 units. The 6-vs-7 is `START_FORCE` talking per FACTION — Allies 3+2,
 *     Soviets 4+2, plus one construction vehicle each — and not per slot.
 *
 * And, seed 7, nobody touching the controls:
 *
 *   - the AI's Construction Yard is finished at t+2.43 s. A human who presses
 *     Deploy on tick ZERO has theirs at t+1.60 s, so the AI's structural head
 *     start is NEGATIVE 0.83 s. Everything a player experiences as a head start
 *     is their own drive-and-orient time, not a rule.
 *   - what actually reads as "a ready base" is the OPENING BANK. From
 *     `defaultSetup().startingCredits` the Normal AI is at 7 buildings and 11
 *     units by t+90 s and 10 buildings / 17 units by t+120 s, paid almost
 *     entirely out of the opening bank — its first refinery only finishes at
 *     t+90.4 s. The human holds the identical bank and could spend it the same
 *     way. That is a BALANCE question about the default bank, and it is
 *     deliberately not decided here; case 3 below only pins that the default is
 *     legal for the opening it is paired with.
 * ============================================================================
 */

import { afterEach, describe, expect, it } from 'vitest';

import { World } from '../src/core/world';
import { EntityKind, Faction } from '../src/core/types';
import type { EntityId, PlayerId } from '../src/core/types';

import {
  START_CONDITION_DEFAULT,
  buildScenario, clearScenario, planScenario, setPlannedStart, startForceFor,
} from '../src/game/Scenarios';

import {
  MCV_MIN_CREDITS, START_STORAGE_KEY, clampCreditsFor, creditOptionsFor, readStartCondition,
} from '../src/shell/SkirmishSetup';

import { CREDIT_OPTIONS, MANAGED_FLAGS, defaultSetup } from '../src/shell/settings-store';

const SEED = 4242;

/* ==========================================================================
 * A localStorage that exists only for the length of one case.
 *
 * `readStartCondition` reads `globalThis.localStorage?.getItem`, and under
 * vitest's node environment there is no such global — which is itself the
 * VIRGIN case and is tested as one below. Everything else installs this.
 * ========================================================================== */

function installStorage(seed: Record<string, string> = {}): void {
  const map = new Map<string, string>(Object.entries(seed));
  const fake: Storage = {
    get length(): number { return map.size; },
    clear(): void { map.clear(); },
    getItem(k: string): string | null { return map.get(k) ?? null; },
    key(i: number): string | null { return [...map.keys()][i] ?? null; },
    removeItem(k: string): void { map.delete(k); },
    setItem(k: string, v: string): void { map.set(k, v); },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: fake, configurable: true });
}

function removeStorage(): void {
  Reflect.deleteProperty(globalThis, 'localStorage');
}

/** Count what one slot owns, by EntityKind. */
function ownedByKind(world: World, owner: PlayerId): Map<EntityKind, number> {
  const out = new Map<EntityKind, number>();
  const st = world.store;
  for (let a = 0; a < st.aliveCount; a++) {
    const i = st.alive[a];
    if (st.owner[i] !== (owner as number)) continue;
    const k = st.kind[i] as EntityKind;
    out.set(k, (out.get(k) ?? 0) + 1);
  }
  return out;
}

/** `kind -> count` as a plain object, so two slots compare as one value. */
function inventory(world: World, owner: PlayerId): Record<string, number> {
  const kinds = ownedByKind(world, owner);
  return {
    buildings: kinds.get(EntityKind.Building) ?? 0,
    infantry: kinds.get(EntityKind.Infantry) ?? 0,
    vehicles: kinds.get(EntityKind.Vehicle) ?? 0,
  };
}

afterEach(() => {
  removeStorage();
  setPlannedStart(null);
  clearScenario();
});

/* ==========================================================================
 * 1. THE STORED PREFERENCE
 *
 * The word in the report is "STILL", so the returning player is the case that
 * matters: a profile written before the opening was a choice at all has no
 * such key, and must not read as the old behaviour.
 * ========================================================================== */

describe('the opening a profile gets when it has never chosen one', () => {
  it('is the construction vehicle when there is no storage at all', () => {
    removeStorage();
    expect(START_CONDITION_DEFAULT).toBe('mcv');
    expect(readStartCondition()).toBe('mcv');
  });

  it('is the construction vehicle when storage exists and the key does not', () => {
    // A profile written by any build that predates the Starting Condition row:
    // `voltmarch.setup.v1` is there, `voltmarch.setup.start.v1` is not.
    installStorage({ 'voltmarch.setup.v1': JSON.stringify(defaultSetup()) });
    expect(readStartCondition()).toBe('mcv');
  });

  it('degrades a corrupt value to the construction vehicle, never to a base', () => {
    for (const junk of ['', ' ', 'banana', '{"start":"base"}', 'null', '0']) {
      installStorage({ [START_STORAGE_KEY]: junk });
      expect(readStartCondition(), `stored ${JSON.stringify(junk)}`).toBe('mcv');
    }
  });

  it('honours a deliberate choice, which is the only way a base start happens', () => {
    // Stated as the mechanism it is: the pre-built opening is reachable, and
    // the ONLY thing that reaches it is a player pressing the lobby's chooser.
    installStorage({ [START_STORAGE_KEY]: 'base' });
    expect(readStartCondition()).toBe('base');
  });
});

/* ==========================================================================
 * 2. THE STICKY CHANNEL
 *
 * `?start=` outranks the stored preference (`chooseStart` in Scenarios.ts) and
 * is deliberately NOT one of the flags `buildMatchQuery` clears. That is by
 * design — it is what carries the choice through `Shell.hardLaunch` and a
 * `?skipmenu=1` boot, neither of which runs the lobby — and it is also the one
 * way a stale `start=base` can outlive the click that set it, on a bookmark or
 * a pinned tab. Pinned so the next investigation reads it instead of deriving
 * it again.
 * ========================================================================== */

describe('the URL flag is the persistent channel, on purpose', () => {
  it('is not a managed flag, so a boot never clears it', () => {
    expect(MANAGED_FLAGS).not.toContain('start');
    // The flags that ARE rewritten every boot, for contrast — `ai` is in here,
    // which is why the title backdrop's `?ai=off` cannot leak into a match.
    expect(MANAGED_FLAGS).toContain('ai');
    expect(MANAGED_FLAGS).toContain('map');
  });

  it('outranks a stored preference in both directions', () => {
    expect(planScenario('skirmish', null, null, 'base').start).toBe('base');
    expect(planScenario('skirmish', null, null, 'mcv').start).toBe('mcv');
  });
});

/* ==========================================================================
 * 3. THE LOBBY DEFAULTS AGREE WITH EACH OTHER
 * ========================================================================== */

describe('the shipped lobby defaults', () => {
  it('pair the default bank with an opening it can actually survive', () => {
    const bank = defaultSetup().startingCredits;
    expect(CREDIT_OPTIONS).toContain(bank);
    expect(bank).toBeGreaterThanOrEqual(MCV_MIN_CREDITS);
    // The clamp is a no-op on the default, so nothing is silently raised under
    // a player who never opened the Rules section.
    expect(clampCreditsFor('mcv', bank)).toBe(bank);
    expect(creditOptionsFor('mcv')).toContain(bank);
  });
});

/* ==========================================================================
 * 4. THE SCENARIO, RESOLVED THE WAY A LAUNCH RESOLVES IT
 *
 * No `{ start }` anywhere below. This is the clause `match-start.spec.ts`
 * cannot make, because every one of its cases names the opening explicitly.
 * ========================================================================== */

describe('a default launch', () => {
  it('plans the construction-vehicle opening with nothing asked for', () => {
    expect(planScenario().start).toBe('mcv');
    expect(planScenario('skirmish').start).toBe('mcv');
  });

  it('seeds NO structures for any seat', () => {
    const world = new World();
    world.addPlayer(Faction.Allies, 'Commander', true, true);
    world.addPlayer(Faction.Soviets, 'Opponent', false, false);
    const spec = buildScenario(world, 'skirmish', SEED);
    expect(spec.start).toBe('mcv');
    for (const p of [0, 1] as PlayerId[]) {
      expect(inventory(world, p).buildings, `slot ${p} structures`).toBe(0);
    }
  });

  it('gives every seat its own faction\'s escort and nothing more', () => {
    const world = new World();
    world.addPlayer(Faction.Allies, 'Commander', true, true);
    world.addPlayer(Faction.Soviets, 'Opponent', false, false);
    buildScenario(world, 'skirmish', SEED);
    for (const [slot, faction] of [[0, Faction.Allies], [1, Faction.Soviets]] as const) {
      const force = startForceFor(faction);
      const inv = inventory(world, slot as PlayerId);
      expect(inv.infantry, `slot ${slot} infantry`).toBe(force.infantry);
      // The construction vehicle is a vehicle too, hence the +1.
      expect(inv.vehicles, `slot ${slot} vehicles`).toBe(force.vehicles + 1);
    }
  });
});

/* ==========================================================================
 * 5. NOTHING IN THE SEEDING LOOP LOOKS AT WHO IS PLAYING
 *
 * The report is that the AI opens with more than the player does. The loop in
 * `Scenarios.skirmish.build` has no `isHuman`, no difficulty and no slot test —
 * and the way to keep that true is to seat the human in the OTHER chair and
 * require the same world out the other side.
 * ========================================================================== */

describe('the opening does not know which chair the human is in', () => {
  function seat(humanSlot: 0 | 1): World {
    const world = new World();
    world.addPlayer(Faction.Allies, humanSlot === 0 ? 'Commander' : 'Opponent',
      humanSlot === 0, humanSlot === 0);
    world.addPlayer(Faction.Soviets, humanSlot === 1 ? 'Commander' : 'Opponent',
      humanSlot === 1, humanSlot === 1);
    return world;
  }

  it('seeds identical inventories whichever slot is human', () => {
    const a = seat(0);
    let invA: Record<string, number>[] = [];
    try {
      buildScenario(a, 'skirmish', SEED);
      invA = [inventory(a, 0 as PlayerId), inventory(a, 1 as PlayerId)];
    } finally { clearScenario(); }

    const b = seat(1);
    let invB: Record<string, number>[] = [];
    try {
      buildScenario(b, 'skirmish', SEED);
      invB = [inventory(b, 0 as PlayerId), inventory(b, 1 as PlayerId)];
    } finally { clearScenario(); }

    expect(invB).toEqual(invA);
  });

  it('hands the construction vehicle to whoever is actually local', () => {
    // The ONE thing `isLocal` is allowed to change in the opening, and it is a
    // selection rather than an entity. `buildScenario` reads `world.localPlayer`,
    // which `addPlayer(..., isLocal)` sets.
    for (const humanSlot of [0, 1] as const) {
      const world = seat(humanSlot);
      try {
        buildScenario(world, 'skirmish', SEED);
        expect(world.localPlayer as number, `local slot ${humanSlot}`).toBe(humanSlot);
        expect(world.selection.count, `slot ${humanSlot} selection`).toBe(1);
        const i = world.store.index(world.selection.ids[0] as EntityId);
        expect(i).toBeGreaterThanOrEqual(0);
        expect(world.store.owner[i], 'the selected vehicle belongs to the human')
          .toBe(humanSlot);
        expect(world.store.kind[i]).toBe(EntityKind.Vehicle);
      } finally { clearScenario(); }
    }
  });
});
