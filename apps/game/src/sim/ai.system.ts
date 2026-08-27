/**
 * ============================================================================
 * VOLTMARCH — src/sim/ai.system.ts
 * ============================================================================
 * The AI's registration surface. Three jobs and nothing else:
 *
 *   1. Build one `AiBrain` per non-human player and keep the list in sync.
 *   2. Hand the brains a def table when one exists. This is the ONE place the
 *      sim layer is allowed to look at `src/game/**` — `resolveDefBinding()`
 *      lives there because def discovery is a boot concern, and pulling it into
 *      `AI.ts` would make `src/sim/**` depend on `src/game/**` forever. The
 *      binding crosses the boundary as a structural `DefLookup`.
 *   3. Publish what the AI thinks it is doing, both as numeric debug counters
 *      and as `__VM.hooks.ai()` for the console.
 *
 * WHY IT INITS AT Phase.AI WITH A LATE ORDER
 * ------------------------------------------
 * `SystemRegistry.init()` runs in phase order, and `src/game/scenarios.system.ts`
 * sits at `Phase.Cleanup` with `order: 10000` so it inits dead last. That means
 * the players and the starting base do not exist when this module's `init()`
 * runs. So `init()` only wires plumbing; the brain list is (re)built lazily on
 * the first `simTick`, and re-checked whenever player control changes. That is
 * also what makes a disconnected human become an AI without touching Bootstrap.
 * ============================================================================
 */

import { defineSystem } from '../core/loop';
import { Faction, Phase } from '../core/types';
import type { AvailabilityResult, EntityId, PlayerId, SimContext } from '../core/types';
import { DEFAULT_SEED } from '../core/config';
import { ctx } from '../game/context';
import { activeScenario } from '../game/Scenarios';
import type { DebugCounters } from '../render/debug';
import { AiDirector } from './AI';
import type { AiBrain, AiIntent } from './AI';
import { difficultyByName, difficultyProfile, personalityByName } from './AIStrategy';
import type { DefLookup, ProductionFacts, ProductionOracle } from './AIStrategy';
import { BuildKind, production } from './Production';
import { makeOreCrisisSurvey, oreCrisisSaleCandidate } from './OreCrisis';
import { evaluatePlacement, makePlacementReport } from './Placement';
import { getEconomy } from './Economy';

/* -------------------------------------------------------------------------- */
/* Boot flags                                                                 */
/* -------------------------------------------------------------------------- */

/** Read a URL flag. Returns null outside a browser so this stays node-safe. */
function flag(name: string): string | null {
  if (typeof location === 'undefined') return null;
  const v = new URLSearchParams(location.search).get(name);
  return v === null || v === '' ? null : v;
}

function seedFlag(): number {
  const raw = flag('seed');
  if (raw === null) return DEFAULT_SEED;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : DEFAULT_SEED;
}

/* -------------------------------------------------------------------------- */
/* The production seam                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Wrap the live `ProductionService` in the structural `ProductionOracle` the
 * brain consumes. This function is the ONLY place `src/sim/AI.ts` and
 * `src/sim/Production.ts` meet, which is what keeps the brain testable with no
 * production module in the process.
 *
 * Returns null when production has not landed (or is a different build), in
 * which case the AI falls back to its own authored catalog.
 */
function buildOracle(): ProductionOracle | null {
  const svc = production();
  if (svc === null) return null;

  // Both scratch objects are reused: `available` and `placeable` are called
  // dozens of times inside one placement search.
  const avail: AvailabilityResult = { ok: false, reason: '', capped: false };
  const report = makePlacementReport();
  const facts: Record<string, ProductionFacts | null> = {};
  const crisis = makeOreCrisisSurvey();

  return {
    factsFor(key: string): ProductionFacts | null {
      // Memoised: the catalog is immutable once built, and `bindOracle` asks
      // for every key at once.
      const cached = facts[key];
      if (cached !== undefined) return cached;
      const e = svc.catalog.byKey(key);
      const value: ProductionFacts | null = e === null ? null : {
        publicId: e.publicId,
        isBuilding: e.kind === BuildKind.Building,
        tab: e.tab,
        cost: e.cost,
        buildTimeSec: e.buildTime,
        power: e.power,
        footprintW: e.footprintW,
        footprintH: e.footprintH,
        prereqs: e.prereqs,
        faction: e.faction,
        buildable: e.buildable,
      };
      facts[key] = value;
      return value;
    },

    available(player: number, publicId: number): boolean {
      return svc.availability(player as PlayerId, publicId, avail).ok;
    },

    // The service's own spawn-time stamp. See `ProductionOracle.entityKey` for
    // why the brain cannot derive this from `store.defId` itself.
    entityKey(id: number): string {
      return svc.entryOf(id as EntityId)?.key ?? '';
    },

    recoverySale(player: number): number {
      // Campaign layouts are authored around fixed AI-owned objective guards.
      // Several operations deliberately use buildings because the brain cannot
      // re-task them; letting a generic economy recovery sell those pieces
      // would rewrite the mission. Skirmish and multiplayer AI get the full
      // recovery tool, while campaign economy remains under its director.
      if (activeScenario()?.name === 'campaign') return 0;
      return oreCrisisSaleCandidate(svc.world, svc, player as PlayerId, crisis) as number;
    },

    reason(player: number, publicId: number): string {
      const r = svc.availability(player as PlayerId, publicId, avail);
      return r.ok ? '' : r.reason;
    },

    atCap(player: number, publicId: number): boolean {
      return svc.availability(player as PlayerId, publicId, avail).capped;
    },

    placeable(player: number, publicId: number, cx: number, cz: number): boolean {
      const entry = svc.catalog.resolve(publicId, true);
      if (entry === null) return false;
      return evaluatePlacement(svc.world, player as PlayerId, entry, cx, cz, report).ok;
    },
  };
}

/* --------------------------------------------------------------------------
 * DEBUG COUNTERS — ONE ROW PER SEAT, NEVER ONE ROW PER MATCH
 *
 * This published `brains[0]` and called it "the AI". That was the whole truth
 * in a duel and a lie the moment the lobby could seat four armies: `aiPosture`
 * named one opponent of three and the other two were invisible, so "the AI
 * never expanded" could not be told from "the ONE AI I happened to be reading
 * never expanded". Nothing warned, because a first element always exists.
 *
 * EVERY FIELD IS SUFFIXED WITH THE SEAT — the `PlayerId`, not the brain index.
 * `AiDirector.rebuild` sorts its brain list by player so the RNG streams are
 * machine-independent, which means a brain removed mid-match renumbers every
 * index after it and would silently re-point a row at a different army. The
 * seat is the stable name; `ai1Posture` is player 1's posture for the whole
 * match or it is absent.
 *
 * AND THE ROWS ARE RETIRED, because `DebugCounters` OUTLIVES THE MATCH. It is
 * created once in `createDebug` and nothing clears it between boots, so a
 * four-way followed by a duel would leave `ai2Posture` and `ai3Posture` frozen
 * at whatever the last match ended on — two dead armies reading as live ones on
 * the overlay and in `shots/_report.json`. `publishedSeats` is what makes the
 * delete possible; `dispose` does the same sweep for the same reason.
 * ------------------------------------------------------------------------ */

/**
 * The per-seat rows, as `[suffix, reader]`. A table rather than fifteen
 * assignments so the retire path cannot go out of step with the publish path —
 * they walk the same list.
 *
 * The four late-game rows are here because none of it is visible any other way:
 * a superweapon strike leaves a crater and no counter, a commander power leaves
 * nothing at all, and an upgrade never becomes an entity — so "the AI never
 * used any of this" and "the AI used it and it did not help" look identical
 * from outside without them.
 */
const BRAIN_ROWS: readonly (readonly [string, (b: AiBrain) => number])[] = [
  ['Posture', (b) => b.postureCode],
  ['Army', (b) => b.armySize],
  ['Strike', (b) => b.strikeSize],
  ['Reserve', (b) => b.reserveSize],
  ['Harvesters', (b) => b.harvesterSize],
  ['Refineries', (b) => b.refineryCount],
  ['Wave', (b) => b.wave],
  ['Pressure', (b) => Math.round(b.pressure * 100) / 100],
  ['Memory', (b) => b.memorySize],
  ['ObjectiveX', (b) => Math.round(b.objectiveXPos)],
  ['ObjectiveZ', (b) => Math.round(b.objectiveZPos)],
  ['Superweapons', (b) => b.superweaponCount],
  ['SuperweaponsFired', (b) => b.superweaponFireCount],
  ['PowersCalled', (b) => b.commanderPowerCount],
  ['Upgrades', (b) => b.upgradeRequestCount],
];

/**
 * `ai3Posture` built once per seat rather than fifteen times a sim tick.
 *
 * `simTick` runs at 30 Hz and this is the only place in the module that would
 * otherwise concatenate strings, so the cache is the difference between zero
 * steady-state allocation and a couple of thousand short-lived strings a
 * second for a debug read almost nobody has open.
 */
const KEY_CACHE = new Map<number, readonly string[]>();

function keysForSeat(seat: number): readonly string[] {
  let keys = KEY_CACHE.get(seat);
  if (keys === undefined) {
    keys = BRAIN_ROWS.map((row) => `ai${seat}${row[0]}`);
    KEY_CACHE.set(seat, keys);
  }
  return keys;
}

/** Seats whose rows are currently ON the counters object. Reused in place. */
const publishedSeats: number[] = [];

/**
 * Write one row set per live brain and delete the rows of any seat that has
 * gone. Exported so a test can drive it against a real brain list without
 * standing up a whole engine — the defect this replaces was a subscript, and a
 * subscript is exactly what a system-level test cannot see.
 */
export function publishAiCounters(
  c: DebugCounters, brains: readonly AiBrain[], commandsIssued: number,
): void {
  c.aiBrains = brains.length;
  c.aiCommands = commandsIssued;

  for (let i = 0; i < publishedSeats.length; i++) {
    const seat = publishedSeats[i];
    let live = false;
    for (let j = 0; j < brains.length; j++) {
      if ((brains[j].player as number) === seat) { live = true; break; }
    }
    if (live) continue;
    const keys = keysForSeat(seat);
    for (let k = 0; k < keys.length; k++) delete c[keys[k]];
  }

  publishedSeats.length = brains.length;
  for (let i = 0; i < brains.length; i++) {
    const b = brains[i];
    const seat = b.player as number;
    publishedSeats[i] = seat;
    const keys = keysForSeat(seat);
    for (let k = 0; k < keys.length; k++) c[keys[k]] = BRAIN_ROWS[k][1](b);
  }
}

/** Take every row this module owns back off the counters object. */
export function clearAiCounters(c: DebugCounters): void {
  for (let i = 0; i < publishedSeats.length; i++) {
    const keys = keysForSeat(publishedSeats[i]);
    for (let k = 0; k < keys.length; k++) delete c[keys[k]];
  }
  publishedSeats.length = 0;
  c.aiBrains = 0;
  c.aiCommands = 0;
}

/* -------------------------------------------------------------------------- */

let director: AiDirector | null = null;
/** The counters object, kept so `dispose` can retire its rows without `ctx()`. */
let counters: DebugCounters | null = null;
/** Player count the brain list was last built against. */
let knownPlayers = -1;
/** Eligible AI seats last seen. Player control can change without count changing. */
let knownAiMask = -1;
/** Set by `?ai=off`; a live multiplayer takeover may explicitly clear it. */
let disabled = false;
let announced = false;
/** Null in single player; otherwise the AI logical seats hosted by this socket. */
let hostedAi: Set<number> | null = null;
/** A next-boot assignment survives disposal of the title-screen engine. */
let pendingHostedAi: Set<number> | null | undefined;

/**
 * Restrict brain creation for a mixed network match. Called before bootstrap,
 * so the first AI tick already has the server-authored ownership split.
 */
export function configureHostedAi(players: readonly number[] | null): void {
  pendingHostedAi = players === null ? null : new Set(players);
}

/**
 * A relay-authorised disconnect handoff outranks the developer `?ai=off` flag.
 * The flag is useful for art shots, but it must not turn a live multiplayer
 * delegation into a permanently idle army.
 */
export function enableAiTakeover(player?: number): void {
  disabled = false;
  if (hostedAi !== null && player !== undefined) hostedAi.add(player);
  knownAiMask = -1;
}

export default defineSystem({
  id: 'sim.ai',
  // The AI is the fourth phase: it has seen this tick's economy and production,
  // and its commands land in the bus in time for the NEXT tick's Phase.Command.
  // That one-tick latency is correct and is the same latency a human gets.
  phase: Phase.AI,
  order: 0,

  async init(): Promise<void> {
    const { world, channels, debug } = ctx();
    if (pendingHostedAi !== undefined) {
      hostedAi = pendingHostedAi;
      pendingHostedAi = undefined;
    }
    // Kept so `dispose` can retire the per-seat rows. `ctx()` is valid from
    // `init` onward and a disposing module must not assume it still is.
    counters = debug.counters;

    const aiFlag = flag('ai');
    if (aiFlag !== null && aiFlag.toLowerCase() === 'off') {
      disabled = true;
      console.info('[ai] disabled by ?ai=off (a multiplayer takeover may re-enable it)');
    }

    director = new AiDirector(world, channels);

    // Difficulty / personality overrides. These write PlayerState.aiDifficulty
    // and .aiPersonality, which are documented as "AI-only knobs; ignored for
    // humans" and are owned by nothing else — this is the only writer.
    const wantDiff = aiFlag === null ? -1 : difficultyByName(aiFlag);
    const persFlag = flag('aip');
    const wantPers = persFlag === null ? -1 : personalityByName(persFlag);
    if (aiFlag !== null && wantDiff < 0) console.warn(`[ai] unknown ?ai=${aiFlag} — keeping the default`);
    if (persFlag !== null && wantPers < 0) console.warn(`[ai] unknown ?aip=${persFlag} — keeping the default`);
    for (let i = 0; i < world.players.length; i++) {
      const p = world.players[i];
      if (p.isHuman || p.isLocal) continue;
      if (wantDiff >= 0) p.aiDifficulty = wantDiff;
      if (wantPers >= 0) p.aiPersonality = wantPers;
    }

    // PREFERRED BINDING: the production module's own tech tree and rule engine.
    // `sim.production` sits at Phase.Production (200), so it has already run
    // its init by the time we get here at Phase.AI (400).
    let bound = 0;
    const oracle = buildOracle();
    if (oracle !== null) {
      bound = director.bindProduction(oracle);
      console.info(
        `%c[ai]%c bound ${bound}/${director.catalog.all.length} buildables to the ` +
        'production catalog — availability and placement now use the same rules as the sidebar',
        'color:#f97', 'color:inherit',
      );
    }

    // FALLBACK: no production module in the process. Resolve def ids straight
    // off the def-table glob so the AI can at least name what it wants. A
    // failure here is not fatal — the brain keeps its authored catalog, knows
    // every def id is -1, and reports `blocked` instead of silently idling.
    if (bound === 0) {
      try {
        const mod = await import('../game/Scenarios');
        director.bind((await mod.resolveDefBinding()) as DefLookup);
        const n = director.catalog.resolvedCount;
        console.info(
          n > 0
            ? `[ai] no production module; bound ${n} buildables to def-table ids`
            : '[ai] no production catalog and no def table — the AI will run its economy, ' +
              'scouting and army layers but cannot name a buildable in a ProductionStart yet',
        );
      } catch (err) {
        console.warn('[ai] def binding failed; using the fallback catalog', err);
      }
    }

    // Readable intent for the console and the shot report.
    debug.api.registerHook('ai', (): AiIntent[] => (director === null ? [] : director.snapshot()));
  },

  /**
   * The AI's whole per-tick cost is this function plus whichever layers are due.
   * Every brain is internally slow-ticked and phase-offset, so eight opponents
   * never all run their census on the same tick.
   */
  simTick(s: SimContext): void {
    if (disabled || director === null) return;
    const { world, debug } = ctx();

    // Players are created after this module's init, and a multiplayer human can
    // become AI after a socket loss without changing the table length. Eight
    // bit checks per tick are negligible and make that control handoff visible
    // on the very next simulation step.
    let aiMask = 0;
    for (let seat = 0; seat < world.players.length; seat++) {
      const p = world.players[seat];
      if (!p.isHuman && !p.isLocal && p.faction !== Faction.Neutral
        && (hostedAi === null || hostedAi.has(seat))) aiMask |= 1 << seat;
    }
    if (world.players.length !== knownPlayers || aiMask !== knownAiMask) {
      knownPlayers = world.players.length;
      knownAiMask = aiMask;
      director.rebuild(seedFlag(), hostedAi);
      // Hand the difficulty handicap to the module that owns `credits`. The AI
      // computes `resourceBonus` but may not write the column from Phase.AI, so
      // without this the whole difficulty ladder was economically flat — Easy
      // and Brutal mined at exactly the same rate. Re-applied on every rebuild
      // because a brain added mid-match needs it too.
      const econ = getEconomy();
      if (econ !== null) {
        // ECONOMY IS SIMULATION STATE, so every client applies the handicap for
        // every AI logical seat, including brains hosted by the other socket.
        // Brain ownership is local CPU policy; mining income may never inherit
        // that asymmetry.
        for (let seat = 0; seat < world.players.length; seat++) {
          const player = world.players[seat];
          if (player.isHuman || player.isLocal || player.faction === Faction.Neutral) continue;
          econ.setResourceBonus(player.id, difficultyProfile(player.aiDifficulty).resourceBonus);
        }
      }
      if (!announced && director.brains.length > 0) {
        announced = true;
        for (const b of director.brains) {
          const p = world.player(b.player);
          console.info(
            `%c[ai]%c player ${b.player} "${p === undefined ? '?' : p.name}" — ` +
            `${b.diff.name} / ${b.pers.name}, ` +
            `reaction ${(b.diff.reactionTicks / 30).toFixed(2)}s, ` +
            `${Math.round(b.diff.actionsPerTick * 30 * 60)} apm, ` +
            `composition ${b.diff.composition.toFixed(2)}`,
            'color:#f97', 'color:inherit',
          );
        }
      }
    }

    director.tick(s);

    // Publish intent, ONE ROW SET PER SEAT. Counters are numeric only, so the
    // posture is an enum index — `__VM.hooks.ai()` is the readable form, and it
    // has always answered for every brain.
    publishAiCounters(debug.counters, director.brains, director.commandsIssued);
  },

  dispose(): void {
    if (counters !== null) clearAiCounters(counters);
    counters = null;
    director?.dispose();
    director = null;
    knownPlayers = -1;
    knownAiMask = -1;
    disabled = false;
    announced = false;
    hostedAi = null;
  },
});
