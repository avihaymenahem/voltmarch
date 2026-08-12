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
 * the first `simTick`, and re-checked whenever the player count changes. That
 * is also what makes a mid-match "add an AI" work without touching Bootstrap.
 * ============================================================================
 */

import { defineSystem } from '../core/loop';
import { Faction, Phase } from '../core/types';
import type { AvailabilityResult, EntityId, PlayerId, SimContext } from '../core/types';
import { DEFAULT_SEED } from '../core/config';
import { ctx } from '../game/context';
import { AiDirector } from './AI';
import type { AiIntent } from './AI';
import { difficultyByName, personalityByName } from './AIStrategy';
import type { DefLookup, ProductionFacts, ProductionOracle } from './AIStrategy';
import { BuildKind, production } from './Production';
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

/* -------------------------------------------------------------------------- */

let director: AiDirector | null = null;
/** Player count the brain list was last built against. */
let knownPlayers = -1;
/** Set true once `?ai=off` is seen; the module then does nothing at all. */
let disabled = false;
let announced = false;

export default defineSystem({
  id: 'sim.ai',
  // The AI is the fourth phase: it has seen this tick's economy and production,
  // and its commands land in the bus in time for the NEXT tick's Phase.Command.
  // That one-tick latency is correct and is the same latency a human gets.
  phase: Phase.AI,
  order: 0,

  async init(): Promise<void> {
    const { world, channels, debug } = ctx();

    const aiFlag = flag('ai');
    if (aiFlag !== null && aiFlag.toLowerCase() === 'off') {
      disabled = true;
      console.info('[ai] disabled by ?ai=off');
      return;
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

    // Players are created by Bootstrap and by the scenario, both of which run
    // after this module's init. Rebuilding on a count change is cheap and is
    // what makes "add an AI mid-match" work.
    if (world.players.length !== knownPlayers) {
      knownPlayers = world.players.length;
      director.rebuild(seedFlag());
      // Hand the difficulty handicap to the module that owns `credits`. The AI
      // computes `resourceBonus` but may not write the column from Phase.AI, so
      // without this the whole difficulty ladder was economically flat — Easy
      // and Brutal mined at exactly the same rate. Re-applied on every rebuild
      // because a brain added mid-match needs it too.
      const econ = getEconomy();
      if (econ !== null) for (const b of director.brains) econ.setResourceBonus(b.player, b.resourceBonus);
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

    // Publish intent. Counters are numeric only, so the posture is an enum
    // index — `__VM.hooks.ai()` is the readable form.
    const c = debug.counters;
    c.aiBrains = director.brains.length;
    c.aiCommands = director.commandsIssued;
    const b0 = director.brains[0];
    if (b0 !== undefined) {
      c.aiPosture = b0.postureCode;
      c.aiArmy = b0.armySize;
      c.aiStrike = b0.strikeSize;
      c.aiReserve = b0.reserveSize;
      c.aiHarvesters = b0.harvesterSize;
      c.aiRefineries = b0.refineryCount;
      c.aiWave = b0.wave;
      c.aiPressure = Math.round(b0.pressure * 100) / 100;
      c.aiMemory = b0.memorySize;
      c.aiObjectiveX = Math.round(b0.objectiveXPos);
      c.aiObjectiveZ = Math.round(b0.objectiveZPos);
      // The late game. Published because none of it is visible any other way:
      // a superweapon strike leaves a crater and no counter, a commander power
      // leaves nothing at all, and an upgrade never becomes an entity — so
      // "the AI never used any of this" and "the AI used it and it did not
      // help" look identical from outside without these four.
      c.aiSuperweapons = b0.superweaponCount;
      c.aiSuperweaponsFired = b0.superweaponFireCount;
      c.aiPowersCalled = b0.commanderPowerCount;
      c.aiUpgrades = b0.upgradeRequestCount;
    }
  },

  dispose(): void {
    director?.dispose();
    director = null;
    knownPlayers = -1;
    disabled = false;
    announced = false;
  },
});
