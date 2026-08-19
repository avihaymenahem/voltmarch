/**
 * THE UNLOCK GATE, WIRED.
 *
 * `tests/progression.spec.ts` proves the gate is a correct predicate in
 * isolation. This file proves the predicate is actually CONNECTED, and that
 * what it disconnects still leaves a game worth playing. Five seams:
 *
 *   1. `Defs.ts` tags real def keys with real unlock ids, both directions.
 *   2. `BuildEntry` carries the tag out of the def table and into the sim —
 *      `resolveEntry` had no such field, so this is the one that silently
 *      returns "everything is unlocked" if it regresses.
 *   3. `ProductionService.availabilityOf` refuses a gated entry with a reason,
 *      for the HUD, for the AI, and identically for both.
 *   4. THE AI MIRRORS THE HUMAN. An opponent fielding something the player
 *      cannot build is the failure this design exists to prevent.
 *   5. A BRAND-NEW PROFILE CAN STILL PLAY AND WIN. Base, economy, army,
 *      defence, for all four factions, derived from the shipped tables rather
 *      than asserted against a hand-written list.
 *
 * Everything runs under `environment: 'node'`. The gate is module-level state
 * (`setUnlockGate`), so every test that installs one tears it down — a leaked
 * gate would gate the OTHER 30 spec files, which is the sort of failure that
 * gets blamed on whatever ran next.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { BuildTab, EntityKind, Faction } from '../src/core/types';
import type { BuildingDef, UnitDef } from '../src/core/types';
import { BUILDINGS, DEF_TABLES, FACTIONS, UNITS, UNLOCK_TAGS } from '../src/data/Defs';
import { MISSION_UNLOCK_IDS, UNLOCKS } from '../src/data/Missions';
import { MAPS } from '../src/shell/settings-store';
import {
  LOCKED_REASON, UnlockGate, isBuildable, setUnlockGate, unlockGate,
} from '../src/progression/UnlockGate';
import { isUnlockAll } from '../src/progression/progression.system';
import type { ProgressionControl } from '../src/progression/types';
import { BuildKind, ProductionCatalog, ProductionService } from '../src/sim/Production';
import { buildScenario, resolveDefBinding, clearScenario } from '../src/game/Scenarios';
import { Channels } from '../src/core/events';
import { World } from '../src/core/world';
import type { AvailabilityResult, PlayerId } from '../src/core/types';
import type { MatchStartInfo, ProgressionControl as ShellControl } from '../src/shell/progression-link';

/* ==========================================================================
 * FIXTURES
 * ========================================================================== */

afterEach(() => {
  setUnlockGate(null);
  clearScenario();
});

/** A gate that owns exactly `owned`. */
function gateOwning(...owned: string[]): UnlockGate {
  return new UnlockGate(() => owned, { knownUnlockIds: MISSION_UNLOCK_IDS });
}

async function boundCatalog(): Promise<ProductionCatalog> {
  const catalog = new ProductionCatalog(await resolveDefBinding());
  expect(catalog.bound, 'the def tables must bind or nothing below is testing the real content')
    .toBe(true);
  return catalog;
}

/** A two-player world with a real, def-bound catalog. Player 0 is the human. */
async function makeService(
  human: Faction, ai: Faction,
): Promise<{ world: World; service: ProductionService }> {
  const world = new World();
  world.addPlayer(human, 'Commander', true, true);
  world.addPlayer(ai, 'Opponent', false, false);
  const service = new ProductionService(world, new Channels(), await boundCatalog());
  return { world, service };
}

const SCRATCH: AvailabilityResult = { ok: false, reason: '', capped: false };

/** Why `key` is unavailable to `player`, or '' when it IS available. */
function refusal(service: ProductionService, player: number, key: string): string {
  const entry = service.catalog.byKey(key);
  expect(entry, `no catalog entry for "${key}"`).not.toBeNull();
  const r = service.availabilityOf(player as PlayerId, entry!, SCRATCH);
  return r.ok ? '' : r.reason;
}

const PLAYABLE = FACTIONS.filter((f) => (f.id as number) !== (Faction.Neutral as number));

/* ==========================================================================
 * 1. THE TAGS THEMSELVES
 * ========================================================================== */

describe('UNLOCK_TAGS', () => {
  it('names only def keys that exist', () => {
    const keys = new Set<string>([...UNITS.map((u) => u.key), ...BUILDINGS.map((b) => b.key)]);
    for (const k of Object.keys(UNLOCK_TAGS)) {
      expect(keys.has(k), `UNLOCK_TAGS gates "${k}", which is not a def`).toBe(true);
    }
  });

  it('names only unlock ids some mission actually grants', () => {
    // The expensive content bug: a def gated behind an id nothing pays out is
    // permanently unbuildable and reads exactly like a balance decision.
    for (const [key, id] of Object.entries(UNLOCK_TAGS)) {
      expect(MISSION_UNLOCK_IDS, `"${key}" is gated behind "${id}"`).toContain(id);
    }
  });

  it('lands on the def objects themselves, not just in the table', () => {
    for (const [key, id] of Object.entries(UNLOCK_TAGS)) {
      const u = DEF_TABLES.unitByKey.get(key);
      const b = DEF_TABLES.buildingByKey.get(key);
      const def: UnitDef | BuildingDef = u !== undefined ? UNITS[u] : BUILDINGS[b!];
      expect(def.unlockedBy, `def "${key}"`).toBe(id);
    }
  });

  it('leaves every def not in the table open', () => {
    for (const d of [...UNITS, ...BUILDINGS] as readonly { key: string; unlockedBy?: string }[]) {
      if (UNLOCK_TAGS[d.key] !== undefined) continue;
      expect(d.unlockedBy, `"${d.key}" is gated but not in UNLOCK_TAGS`).toBeUndefined();
    }
  });

  it('gates each of the four armies symmetrically', () => {
    // One mission grants "unit.raider" and EVERY army gets its raider. Without
    // this a player who switches faction is sent back to the start of a curve
    // they already paid for.
    // `Faction.Neutral` is not "everyone": it is the pool Allies and Soviets
    // share, and the two parallel trees (Pact, Reclamation) draw nothing from
    // it. `battleLab` is Neutral and covers exactly those two armies.
    const SHARED_POOL: readonly number[] = [Faction.Allies as number, Faction.Soviets as number];
    const forGroup = (id: string): Set<number> => {
      const out = new Set<number>();
      for (const d of [...UNITS, ...BUILDINGS]) {
        if (d.unlockedBy !== id) continue;
        if ((d.faction as number) === (Faction.Neutral as number)) {
          for (const n of SHARED_POOL) out.add(n);
        } else {
          out.add(d.faction as number);
        }
      }
      return out;
    };
    for (const id of [UNLOCKS.unitRaider, UNLOCKS.unitSpecialist, UNLOCKS.structTech]) {
      const armies = forGroup(id);
      for (const f of PLAYABLE) {
        expect(armies.has(f.id as number), `"${f.key}" has nothing behind "${id}"`).toBe(true);
      }
    }
  });
});

/* ==========================================================================
 * 2. THE TAG REACHES THE SIM
 * ========================================================================== */

describe('BuildEntry.unlockedBy', () => {
  it('is copied off the def for every tagged key', async () => {
    const catalog = await boundCatalog();
    for (const [key, id] of Object.entries(UNLOCK_TAGS)) {
      const entry = catalog.byKey(key);
      if (entry === null) continue; // authored in Defs.ts ahead of the tech tree
      expect(entry.unlockedBy, `entry "${key}"`).toBe(id);
    }
  });

  it("is '' and not undefined for everything else", async () => {
    const catalog = await boundCatalog();
    for (const e of catalog.entries) {
      if (UNLOCK_TAGS[e.key] !== undefined) continue;
      expect(e.unlockedBy, `entry "${e.key}"`).toBe('');
    }
  });

  it('is empty for every entry when no def table binds', () => {
    // The `?shot=` harness and most unit tests run on the fallback tables. An
    // unbound catalog must gate NOTHING, or the harness starts screenshotting
    // a sidebar full of padlocks.
    const catalog = new ProductionCatalog({ tables: null, unitId: {}, buildingId: {} });
    for (const e of catalog.entries) expect(e.unlockedBy).toBe('');
  });
});

/* ==========================================================================
 * 3. availabilityOf REFUSES
 * ========================================================================== */

describe('ProductionService.availabilityOf', () => {
  it('gates nothing when no gate is installed', async () => {
    const { service } = await makeService(Faction.Allies, Faction.Soviets);
    expect(unlockGate()).toBeNull();
    // Not "available" — the prereqs are unmet in an empty world — but the
    // refusal must never be the progression one.
    expect(refusal(service, 0, 'prismTank')).not.toBe(LOCKED_REASON);
  });

  it('refuses a gated entry with the tooltip reason', async () => {
    setUnlockGate(gateOwning());
    const { service } = await makeService(Faction.Allies, Faction.Soviets);
    expect(refusal(service, 0, 'battleLab')).toBe(LOCKED_REASON);
    expect(refusal(service, 0, 'prismTank')).toBe(LOCKED_REASON);
  });

  it('stops refusing the moment the profile owns the id', async () => {
    const owned: string[] = [];
    setUnlockGate(new UnlockGate(() => owned, { knownUnlockIds: MISSION_UNLOCK_IDS }));
    const { service } = await makeService(Faction.Allies, Faction.Soviets);
    expect(refusal(service, 0, 'battleLab')).toBe(LOCKED_REASON);
    // The gate holds a READER, not a snapshot: a mission completing mid-match
    // must open the sidebar without rebuilding the catalogue.
    owned.push(UNLOCKS.structTech);
    expect(refusal(service, 0, 'battleLab')).not.toBe(LOCKED_REASON);
  });

  it('reports the faction refusal before the progression one', async () => {
    // "Locked" on a Sledge would promise an Allied player a Soviet tank.
    setUnlockGate(gateOwning());
    const { service } = await makeService(Faction.Allies, Faction.Soviets);
    expect(refusal(service, 0, 'apocalypse')).toBe('Wrong faction');
  });
});

/* ==========================================================================
 * 4. THE AI RESOLVES AGAINST THE HUMAN
 * ========================================================================== */

describe('the AI mirrors the human tier', () => {
  it('refuses the AI what the human has not unlocked', async () => {
    setUnlockGate(gateOwning());
    const { service } = await makeService(Faction.Allies, Faction.Soviets);
    // Player 1 is the AI, fielding Soviets. `teslaCoil` is its own faction's
    // and its prereqs are irrelevant here: the gate answers first.
    expect(refusal(service, 1, 'teslaCoil')).toBe(LOCKED_REASON);
    expect(refusal(service, 1, 'apocalypse')).toBe(LOCKED_REASON);
  });

  it('opens the AI the moment the human earns it', async () => {
    setUnlockGate(gateOwning(UNLOCKS.unitSpecialist));
    const { service } = await makeService(Faction.Allies, Faction.Soviets);
    expect(refusal(service, 1, 'apocalypse')).not.toBe(LOCKED_REASON);
  });

  it('lifts the AI entirely when the mirror is turned off', async () => {
    // Off means UNRESTRICTED, not "restricted differently". It is the toggle
    // for a player who wants the harder game rather than the reveal.
    const gate = gateOwning();
    gate.setMirrorAI(false);
    setUnlockGate(gate);
    const { service } = await makeService(Faction.Allies, Faction.Soviets);
    expect(refusal(service, 1, 'apocalypse')).not.toBe(LOCKED_REASON);
    // ...and the human is still gated.
    expect(refusal(service, 0, 'prismTank')).toBe(LOCKED_REASON);
  });

  it('never lets the AI outrank the human on any gated entry', async () => {
    // The property, not three examples. For every faction pairing and every
    // gated catalogue entry, "the AI may build it" implies "the human may".
    const gate = gateOwning(UNLOCKS.unitRaider, UNLOCKS.structTech);
    setUnlockGate(gate);
    for (const f of PLAYABLE) {
      const { service } = await makeService(f.id, f.id);
      for (const e of service.catalog.entries) {
        if (e.unlockedBy === '') continue;
        const aiLocked = refusal(service, 1, e.key) === LOCKED_REASON;
        const humanLocked = refusal(service, 0, e.key) === LOCKED_REASON;
        expect(aiLocked, `"${e.key}" for ${f.key}`).toBe(humanLocked);
      }
    }
  });
});

/* ==========================================================================
 * 5. A FRESH PROFILE CAN STILL PLAY — AND WIN
 *
 * The single most important check in this file. Everything is derived from the
 * shipped tables: nothing here would keep passing if a def were retagged.
 * ========================================================================== */

describe('a profile with nothing unlocked', () => {
  /** Entries `faction` can build with an empty profile, prereq chain included. */
  async function dayOne(faction: Faction): Promise<Map<string, ReturnType<ProductionCatalog['byKey']>>> {
    setUnlockGate(gateOwning());
    const catalog = await boundCatalog();
    const open = new Map<string, ReturnType<ProductionCatalog['byKey']>>();

    // A gated TECH BUILDING strands everything hanging off it, so reachability
    // is resolved transitively rather than per row.
    let grew = true;
    while (grew) {
      grew = false;
      for (const e of catalog.entries) {
        if (open.has(e.key)) continue;
        if (e.faction !== Faction.Neutral && e.faction !== faction) continue;
        if (!isBuildable(e)) continue;
        if (!e.prereqs.every((p) => open.has(p) || catalog.byKey(p)?.buildable === false)) continue;
        open.set(e.key, e);
        grew = true;
      }
    }
    return open;
  }

  for (const f of PLAYABLE) {
    describe(f.name, () => {
      it('can build a complete base', async () => {
        const open = await dayOne(f.id);
        const structs = [...open.values()].filter((e) => e!.kind === BuildKind.Building);
        const defs = structs.map((e) => BUILDINGS[DEF_TABLES.buildingByKey.get(e!.key)!]);

        expect(defs.some((b) => b.power > 0), 'a power plant').toBe(true);
        expect(defs.some((b) => b.storage > 0), 'ore storage').toBe(true);
        expect(defs.some((b) => b.producesTab === BuildTab.Infantry), 'a barracks').toBe(true);
        expect(defs.some((b) => b.producesTab === BuildTab.Vehicles), 'a war factory').toBe(true);
        expect(defs.some((b) => b.tab === BuildTab.Defense && b.weapons.length > 0), 'a defence')
          .toBe(true);
      });

      it('can build a complete army', async () => {
        const open = await dayOne(f.id);
        const units = [...open.values()]
          .filter((e) => e!.kind === BuildKind.Unit)
          .map((e) => UNITS[DEF_TABLES.unitByKey.get(e!.key)!]);

        expect(units.some((u) => u.cargoMax > 0), 'a harvester').toBe(true);
        expect(units.some((u) => u.canCapture), 'an engineer').toBe(true);
        expect(
          units.some((u) => u.kind === EntityKind.Infantry && u.weapons.length > 0),
          'armed infantry',
        ).toBe(true);
        expect(
          units.some((u) => u.kind === EntityKind.Vehicle && u.weapons.length > 0),
          'an armed vehicle',
        ).toBe(true);
      });

      it('keeps a building that can destroy a base', async () => {
        // "Winnable" is not "has units". Somebody has to be able to shoot a
        // Construction Yard down, and structures are Concrete armour.
        const open = await dayOne(f.id);
        const armed = [...open.values()]
          .filter((e) => e!.kind === BuildKind.Unit)
          .map((e) => UNITS[DEF_TABLES.unitByKey.get(e!.key)!])
          .filter((u) => u.weapons.length > 0);
        expect(armed.length, 'nothing armed at all').toBeGreaterThan(1);
      });

      it('leaves the AI a working opening', async () => {
        // Every non-optional scripted step must be reachable, or the opponent
        // stalls at a padlock and the "winnable" match is winnable because the
        // enemy never built anything.
        const open = await dayOne(f.id);
        const { openingFor } = await import('../src/sim/AIStrategy');
        for (let personality = 0; personality < 3; personality++) {
          for (const s of openingFor(f.id, personality)) {
            if (s.optional) continue;
            expect(open.has(s.key), `${f.key} p${personality} stalls at "${s.key}"`).toBe(true);
          }
        }
      });
    });
  }

  it('gates strictly less than half of every army roster', async () => {
    // A curve where most of the game is behind a mission is not a curve, it is
    // a demo. Measured per faction against the roster the sidebar shows.
    const catalog = await boundCatalog();
    for (const f of PLAYABLE) {
      let total = 0;
      let gated = 0;
      for (const e of catalog.entries) {
        if (!e.buildable) continue;
        if (e.faction !== Faction.Neutral && e.faction !== f.id) continue;
        total++;
        if (e.unlockedBy !== '') gated++;
      }
      expect(gated / total, `${f.key}: ${gated}/${total} gated`).toBeLessThan(0.5);
    }
  });
});

/* ==========================================================================
 * 6. THE OPENING BASE
 *
 * The PRE-BUILT opening (`start: 'base'`) puts a whole base on the map before
 * the player has touched anything, authored in ROLE keys that `keyFor` remaps
 * per faction. Two of those roles ('battleLab', 'prismTower') and two unit roles
 * ('ifv', 'apocalypse') land on tagged defs — so before the gate reached
 * `ScenarioBuilder`, a brand-new profile started the match next to a free Battle
 * Lab and across the valley from three Tesla Coils it could not build. Found by
 * playing it.
 *
 * `start: 'base'` is passed explicitly because it is the subject: the default
 * opening hands out one construction vehicle and an escort, which has nothing
 * for a gate to leak. That opening's own gate coverage — that NOTHING on the
 * path from the vehicle to a working economy is tagged — is in
 * `tests/match-start.spec.ts`.
 * ========================================================================== */

describe('the opening base respects the gate', () => {
  async function skirmish(human: Faction, ai: Faction, gate: UnlockGate | null) {
    setUnlockGate(gate);
    const world = new World();
    world.addPlayer(human, 'Commander', true, true);
    world.addPlayer(ai, 'Opponent', false, false);
    const defs = await resolveDefBinding();
    buildScenario(world, 'skirmish', 4242, { map: 'temperate', defs, start: 'base' });

    const st = world.store;
    const owned: [string[], string[]] = [[], []];
    for (let i = 0; i < st.capacity; i++) {
      if (st.hp[i] <= 0) continue;
      const p = st.owner[i] as number;
      if (p !== 0 && p !== 1) continue;
      const id = st.defId[i];
      if (id < 0) continue;
      const key = st.kind[i] === EntityKind.Building
        ? BUILDINGS[id]?.key
        : UNITS[id]?.key;
      if (key !== undefined) owned[p].push(key);
    }
    return owned;
  }

  it('hands out gated structures and units when nothing gates them', async () => {
    // The control. Without this the test below passes trivially on a scenario
    // that never placed a Proving Ground in the first place.
    const [human, ai] = await skirmish(Faction.Allies, Faction.Soviets, null);
    expect(human).toContain('battleLab');
    expect(ai).toContain('apocalypse');
  });

  it('hands out none of them on an empty profile', async () => {
    const [human, ai] = await skirmish(Faction.Allies, Faction.Soviets, gateOwning());
    for (const side of [human, ai]) {
      for (const key of side) {
        expect(UNLOCK_TAGS[key], `"${key}" is in an opening base but gated`).toBeUndefined();
      }
    }
  });

  it('still leaves both sides a working base', async () => {
    // Skipping is only safe because nothing structural is tagged. If a future
    // tag lands on a refinery this fails instead of shipping an economy-less
    // opening that looks like a pathing bug.
    const [human, ai] = await skirmish(Faction.Allies, Faction.Soviets, gateOwning());
    for (const side of [human, ai]) {
      const has = (k: string): boolean => side.includes(k);
      expect(has('conyard'), 'a construction yard').toBe(true);
      expect(has('powerPlant'), 'power').toBe(true);
      expect(has('refinery'), 'a refinery').toBe(true);
      expect(has('warFactory'), 'a war factory').toBe(true);
      expect(has('barracks'), 'a barracks').toBe(true);
      expect(has('harvester'), 'a harvester').toBe(true);
    }
  });

  it('opens the structure again once the profile owns the id', async () => {
    const [human] = await skirmish(Faction.Allies, Faction.Soviets, gateOwning(UNLOCKS.structTech));
    expect(human).toContain('battleLab');
  });
});

/* ==========================================================================
 * 7. THE `?shot=` HARNESS
 *
 * The harness runs a memory profile so no shot depends on whoever last played
 * on that machine. An EMPTY profile is deterministic but it is also the most
 * RESTRICTIVE profile there is, so with the gate live the harness started
 * deleting the Proving Ground from 02-hud-full and the Tesla Coils from
 * 07-soviet-base — authored compositions scored against the look bible. The
 * grade fell a point. The gate is therefore constructed `unrestricted` under
 * the harness, which is equally deterministic and shows the content.
 * ========================================================================== */

describe('the harness gate', () => {
  it('is unrestricted, so a shot scenario keeps its authored content', async () => {
    const gate = new UnlockGate(() => [], {
      knownUnlockIds: MISSION_UNLOCK_IDS,
      unrestricted: true,
    });
    expect(gate.isUnrestricted).toBe(true);
    setUnlockGate(gate);

    const world = new World();
    world.addPlayer(Faction.Allies, 'Commander', true, true);
    world.addPlayer(Faction.Soviets, 'Opponent', false, false);
    const defs = await resolveDefBinding();
    buildScenario(world, 'skirmish', 4242, { map: 'temperate', defs, start: 'base' });

    const st = world.store;
    const keys = new Set<string>();
    for (let i = 0; i < st.capacity; i++) {
      if (st.hp[i] <= 0 || st.defId[i] < 0) continue;
      const k = st.kind[i] === EntityKind.Building
        ? BUILDINGS[st.defId[i]]?.key
        : UNITS[st.defId[i]]?.key;
      if (k !== undefined) keys.add(k);
    }
    // The exact three the harness lost.
    expect(keys.has('battleLab')).toBe(true);
    expect(keys.has('teslaCoil')).toBe(true);
    expect(keys.has('apocalypse')).toBe(true);
  });

  it('mirrors that decision in the system module itself', async () => {
    // The assertion above is about `UnlockGate`. This one is about the ONE call
    // site that has to pass the flag, read out of the source so a future edit
    // to `progression.system.ts` that drops it fails here rather than in a
    // screenshot diff nobody runs.
    const src = await readFile(
      fileURLToPath(new URL('../src/progression/progression.system.ts', import.meta.url)),
      'utf8',
    );
    expect(src).toMatch(/unrestricted:\s*harness/);
  });
});

/* ==========================================================================
 * 8. THE MAP LIST
 * ========================================================================== */

describe('map unlocks', () => {
  /*
   * THE STARTER SET, RESTATED. `SkirmishSetup.STARTER_MAPS` is module-private,
   * so this is a duplicate on purpose and the duplication is the test: if the
   * two ever disagree, a map is either offered with no mission paying for it or
   * gated with no way to earn it.
   *
   * `sunder-atoll` is the third and it is open for a different reason from the
   * two originals — every naval structure and hull in the game needs water,
   * four of the seven maps are landlocked, and both half-plane sea maps are
   * mission-gated. Without an open sea map the entire naval arm is unreachable
   * on a fresh profile.
   */
  const STARTERS = ['temperate-valley', 'airbase-flats', 'sunder-atoll'];

  it('pays out an id for every map that is not a starter', () => {
    const starters = new Set(STARTERS);
    for (const m of MAPS) {
      if (starters.has(m.id)) continue;
      expect(MISSION_UNLOCK_IDS, `map "${m.id}" is neither a starter nor a reward`)
        .toContain(`map.${m.id}`);
    }
  });

  it('does not gate the starters', () => {
    for (const id of STARTERS) {
      expect(MISSION_UNLOCK_IDS).not.toContain(`map.${id}`);
    }
  });

  it('grants a map id that names a real map', () => {
    for (const id of MISSION_UNLOCK_IDS) {
      if (!id.startsWith('map.')) continue;
      const mapId = id.slice(4);
      expect(MAPS.some((m) => m.id === mapId), `no map "${mapId}"`).toBe(true);
    }
  });
});

/* ==========================================================================
 * 7. THE SHELL SEAM
 *
 * `src/shell/progression-link.ts` restates the control contract structurally so
 * the front end compiles against a duck-typed handle. These two assignments are
 * the only thing stopping the restatement from drifting away from the real one.
 * ========================================================================== */

describe('the shell control seam', () => {
  it('is assignable from the real ProgressionControl', () => {
    // EVERY MEMBER, DELIBERATELY, WITH NO SPREAD AND NO `as`. This literal is
    // the only thing stopping the shell's restatement drifting from the real
    // contract, and it can only do that job by failing to compile when a member
    // is added to one side and not the other. It did exactly that when
    // `recordCampaignOperation` landed.
    const real: ProgressionControl = {
      beginMatch: () => {},
      endMatch: () => {},
      abandonMatch: () => {},
      inMatch: () => false,
      flush: () => {},
      recordCampaignOperation: () => false,
    };
    const asShell: ShellControl = real;
    expect(typeof asShell.beginMatch).toBe('function');

    const info: MatchStartInfo = { seed: 1, localPlayer: 0, faction: 1, difficulty: 1 };
    expect(info.seed).toBe(1);
  });
});

/* ==========================================================================
 * ?unlockall — THE DEVELOPER BYPASS
 * ==========================================================================
 * Added 2026-08-06 at the user's request: a URL flag that opens every gated
 * unit and structure for one page load.
 *
 * The property that makes it safe to ship in a production bundle is that it is
 * READ-ONLY. `UnlockGate.unrestricted` changes what `isUnlocked` ANSWERS and
 * touches nothing else — `MissionTracker` grants rewards on its own path, so a
 * bypassed session cannot award itself anything and a reload without the flag
 * restores the real profile byte for byte. These tests pin both halves: the
 * parsing, and the read-only-ness.
 * ========================================================================== */

describe('?unlockall', () => {
  it('accepts both spellings, and nothing else', () => {
    expect(isUnlockAll('?unlockall')).toBe(true);
    expect(isUnlockAll('?unlockall=1')).toBe(true);
    expect(isUnlockAll('?unlock=all')).toBe(true);
    expect(isUnlockAll('?seed=3&unlockall&fog=off')).toBe(true);

    expect(isUnlockAll('')).toBe(false);
    expect(isUnlockAll('?seed=3')).toBe(false);
    expect(isUnlockAll('?unlock=some')).toBe(false);
    // Near-misses must NOT open the gate — a typo that silently unlocks
    // everything would be indistinguishable from the bug you are chasing.
    expect(isUnlockAll('?unlockAll')).toBe(false);
    expect(isUnlockAll('?unlock')).toBe(false);
  });

  it('opens every gated def while it is on, and closes them again when it is off', () => {
    const gated = { key: 'test.gated', unlockedBy: 'unit.prism' };
    const owned: string[] = [];
    const gate = new UnlockGate(() => owned, { unrestricted: true });

    expect(gate.allows(gated)).toBe(true);
    expect(gate.isUnlocked('unit.prism')).toBe(true);
    // The profile it read from is still empty — the bypass answered, it did
    // not grant. This is the assertion the whole design rests on.
    expect(owned).toEqual([]);

    gate.setUnrestricted(false);
    expect(gate.allows(gated)).toBe(false);
    expect(gate.isUnlocked('unit.prism')).toBe(false);
    expect(owned).toEqual([]);
  });
});
