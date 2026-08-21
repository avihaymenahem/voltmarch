/**
 * ============================================================================
 * tests/diagnostics.spec.ts — THE EXPORT HAS TO ANSWER THE QUESTION
 * ============================================================================
 * The Diagnostics tab exists because a match would not end and there was no way
 * to find out why from inside the game. That bug is fixed
 * (`Viability.surveyViability` §HELD) and this file does NOT re-test the fix —
 * `tests/match-unfinishable.spec.ts` owns that. What it tests is the tool: it
 * REBUILDS the reported world, exports it, and requires the export to contain
 * the four things somebody would have needed to diagnose it cold.
 *
 *   1. `heldUnits`, the count that did not exist.
 *   2. `contestingUnits` beside it, so the disagreement is visible.
 *   3. `isBeaten` / `canContest`, so the reader can see WHICH predicate the
 *      match hung on.
 *   4. `EntityFlag.Garrisoned` on the man himself, DECODED TO ITS NAME. A
 *      bitmask in a bug report is a number somebody has to decode by hand,
 *      which means they will not.
 *
 * That is the concrete standard for "is this tool any good", so it is asserted
 * against a real `World` with a real man really garrisoned in a real building,
 * not against source text.
 *
 * THE SECOND STANDARD IS THAT IT CHANGES NOTHING. The tab is reachable over a
 * live PvP match, where a stray write is a lockstep desync with no findable
 * cause. §2 hashes the world with `game/Checksum.ts` either side of a full
 * export, entity list included.
 *
 * All headless. No renderer, no DOM, no clock.
 * ============================================================================
 */


import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { World } from '../src/core/world';
import { Channels } from '../src/core/events';
import { Rng } from '../src/core/math';
import { CELL, SIM_DT } from '../src/core/config';
import {
  EntityFlag, EntityKind, Faction, Locomotor, OrderKind, UnitState,
} from '../src/core/types';
import type { EntityId, PlayerId, SimContext } from '../src/core/types';

import { BUILDINGS, DEF_TABLES } from '../src/data/Defs';
import { FALLBACK_BUILDINGS } from '../src/game/Scenarios';
import { checksum } from '../src/game/Checksum';

import { CaptureService, setCaptureService } from '../src/sim/Capture';
import { GarrisonService, setGarrisonService } from '../src/sim/Garrison';
import { TransportService, setTransportService } from '../src/sim/Transport';
import { ProductionCatalog, ProductionService, setProduction } from '../src/sim/Production';
import type { BuildEntry } from '../src/sim/Production';
import { resetMoveClasses } from '../src/sim/Movement';

import {
  DIAGNOSTICS_FORMAT_VERSION,
  buildDiagnostics,
  decodeFlags,
  formatDiagnostics,
  redactBootFlags,
  viabilityLines,
  type DiagnosticsEnvironment,
  type DiagnosticsMatch,
} from '../src/shell/Diagnostics';

import unlockAllSystem, {
  UNLOCK_ALL_STORAGE_KEY, readPersistedUnlockAll, setSessionUnlockAll,
  unlockAllActive, unlockAllFromBootFlag,
} from '../src/shell/unlockall.system';
import progressionSystem from '../src/progression/progression.system';
import { UnlockGate, isBuildable, setUnlockGate } from '../src/progression/UnlockGate';

const P0 = 0 as PlayerId;   // local, human
const P1 = 1 as PlayerId;   // the opponent
const GAIA = 2 as PlayerId;

/* ==========================================================================
 * Fixture — the same shape `tests/match-unfinishable.spec.ts` uses, because
 * the bug being reproduced is the same bug.
 * ========================================================================== */

interface Rig {
  world: World;
  channels: Channels;
  production: ProductionService;
  garrison: GarrisonService;
  tick: number;
  step(steps?: number): void;
  unit(key: string, owner: PlayerId, x: number, z: number): EntityId;
  building(key: string, owner: PlayerId, cx: number, cz: number): EntityId;
  civilian(key: string, cx: number, cz: number): EntityId;
}

function boundBinding(): {
  tables: typeof DEF_TABLES;
  unitId: Record<string, number>;
  buildingId: Record<string, number>;
} {
  const unitId: Record<string, number> = {};
  DEF_TABLES.unitByKey.forEach((v, k) => { unitId[k] = v; });
  const buildingId: Record<string, number> = {};
  DEF_TABLES.buildingByKey.forEach((v, k) => { buildingId[k] = v; });
  return { tables: DEF_TABLES, unitId, buildingId };
}

function makeRig(): Rig {
  resetMoveClasses();

  const world = new World();
  world.addPlayer(Faction.Allies, 'Commander', true, true);
  world.addPlayer(Faction.Soviets, 'Opponent', false, false);
  world.addPlayer(Faction.Neutral, 'Gaia', false, false);
  for (let i = 0; i < world.players.length; i++) {
    world.players[GAIA as number].allyMask |= 1 << i;
    world.players[i].allyMask |= 1 << (GAIA as number);
  }
  // A Brutal Rusher, so the controller string has something to say.
  world.players[P1 as number].aiDifficulty = 3;
  world.players[P1 as number].aiPersonality = 1;
  world.players[P0 as number].credits = 4321;

  const channels = new Channels();
  const production = new ProductionService(
    world, channels, new ProductionCatalog(boundBinding()),
  );
  production.bindingTables = DEF_TABLES;
  setProduction(production);

  setCaptureService(new CaptureService(world, channels));
  const garrison = new GarrisonService(world, channels);
  setGarrisonService(garrison);
  garrison.attach();
  const transport = new TransportService(world, channels);
  transport.bindDefs(DEF_TABLES);
  setTransportService(transport);
  transport.attach();

  const rng = new Rng(4242);
  const rig: Rig = {
    world, channels, production, garrison, tick: 0,

    step(steps = 1): void {
      for (let n = 0; n < steps; n++) {
        rig.tick++;
        world.tick = rig.tick;
        world.time = rig.tick * SIM_DT;
        world.spatial.rebuild();
        const s: SimContext = { dt: SIM_DT, tick: rig.tick, time: world.time, rng };
        production.tick(s);
        garrison.simTick(s);
        transport.simTick(s);
      }
    },

    unit(key, owner, x, z): EntityId {
      const entry = production.catalog.byKey(key) as BuildEntry | null;
      expect(entry, `catalog is missing unit "${key}"`).not.toBeNull();
      return production.spawnUnit(world.player(owner), entry as BuildEntry, x, z, 0);
    },

    building(key, owner, cx, cz): EntityId {
      const entry = production.catalog.byKey(key) as BuildEntry | null;
      expect(entry, `catalog is missing building "${key}"`).not.toBeNull();
      return production.spawnBuilding(world.player(owner), entry as BuildEntry, cx, cz, 1);
    },

    civilian(key, cx, cz): EntityId {
      const st = world.store;
      const defId = DEF_TABLES.buildingByKey.get(key);
      expect(defId, `no def row for civilian "${key}"`).not.toBeUndefined();
      const def = BUILDINGS[defId as number];
      const fb = FALLBACK_BUILDINGS[key];
      const id = st.alloc(EntityKind.Building, defId as number, GAIA, Faction.Neutral, cx, 0, cz);
      const i = st.index(id);
      st.footprintW[i] = def.footprintW;
      st.footprintH[i] = def.footprintH;
      st.maxHp[i] = def.maxHp;
      st.hp[i] = def.maxHp;
      st.sight[i] = def.sight;
      st.radius[i] = Math.max(def.footprintW, def.footprintH) * CELL * 0.5;
      st.weaponIndex[i] = def.weapons[0] ?? -1;
      st.locomotor[i] = Locomotor.Static;
      st.buildProgress[i] = 1;
      st.flags[i] |= fb.flags | def.flags;
      world.spatial.rebuild();
      return id;
    },
  };
  return rig;
}

/** Walk a unit up to a host and give it the order a right-click produces. */
function sendInto(rig: Rig, mover: EntityId, host: EntityId): void {
  const st = rig.world.store;
  const i = st.index(mover);
  const t = st.index(host);
  st.posX[i] = st.posX[t];
  st.posZ[i] = st.posZ[t] + Math.max(st.footprintH[t], 1) * CELL * 0.5 + 1.0;
  st.orderKind[i] = OrderKind.Enter;
  st.orderTarget[i] = host as number;
  st.orderX[i] = st.posX[t];
  st.orderZ[i] = st.posZ[t];
  st.state[i] = UnitState.Moving;
  rig.world.spatial.rebuild();
}

/* -- the input the shell would supply --------------------------------------- */

const ENV: DiagnosticsEnvironment = {
  buildVersion: '9.9.9-test',
  generatedAt: '2026-08-18T09:00:00.000Z',
  shellState: 'settings',
  platform: 'desktop',
  bridgeVersion: 2,
  userAgent: 'test-agent',
  page: 'app://voltmarch/index.html',
  bootFlags: { seed: '77' },
  viewport: { width: 1920, height: 1080, dpr: 1 },
  unlockAll: false,
  renderer: {
    backend: 'webgpu',
    gpu: 'NVIDIA GeForce RTX 3080 Laptop GPU',
    adapter: 'nvidia ampere',
    drawCalls: 61,
    triangles: 412_000,
  },
  graphics: {
    tier: 'high',
    resolutionScale: 1,
    adaptiveResolution: false,
    calibrated: true,
    shadows: true,
    ao: true,
    bloom: true,
    msaa: false,
    perfOverlay: false,
  },
};

/**
 * `mapSeed` and `simSeed` are DIFFERENT NUMBERS here on purpose. Two distinct
 * literals are the only way an assertion can catch the report handing back one
 * of them under both names, which is the documented defect the seed note in the
 * export exists to prevent.
 */
const MAP_SEED = 0x7e44a1;
const SIM_SEED = 0x00c0ffee;

function matchInput(rig: Rig, over: Partial<DiagnosticsMatch> = {}): DiagnosticsMatch {
  return {
    world: rig.world,
    kind: 'match',
    simTick: rig.tick,
    simSeconds: rig.tick * SIM_DT,
    paused: true,
    speed: 1,
    mapSeed: MAP_SEED,
    simSeed: SIM_SEED,
    mapId: 'temperate-valley',
    mapName: 'Temperate Valley',
    mapPreset: 'temperate',
    biome: 'temperate',
    opening: 'mcv',
    scenario: 'skirmish',
    defs: DEF_TABLES,
    ...over,
  };
}

/* ==========================================================================
 * 1. THE STANDARD — the export answers the question that was asked
 * ========================================================================== */

describe('the export contains what would have diagnosed the unfinishable match', () => {
  let rig: Rig;
  let occupant: EntityId;
  let block: EntityId;

  beforeEach(() => {
    rig = makeRig();

    // The player: a base and an army. Nothing here is a defeat.
    rig.building('conyard', P0, 40, 40);
    rig.unit('grizzly', P0, 60, 60);

    // The opponent, after the sweep the report describes: everything visible
    // is gone and one man is standing inside a civilian block.
    block = rig.civilian('civApartments', 120, 120);
    occupant = rig.unit('conscript', P1, 120, 120);
    sendInto(rig, occupant, block);
    rig.step(2);

    const st = rig.world.store;
    expect(st.flags[st.index(occupant)] & EntityFlag.Garrisoned, 'he is indoors').not.toBe(0);
    expect(st.owner[st.index(block)], 'and the block flipped to him').toBe(P1 as number);
  });

  afterEach(() => {
    setProduction(null);
    setCaptureService(null);
    setGarrisonService(null);
    setTransportService(null);
  });

  it('names heldUnits, contestingUnits and the two predicates, per player', () => {
    const report = buildDiagnostics({ env: ENV, match: matchInput(rig), includeEntities: false });
    const enemy = report.match?.players.find((p) => p.id === (P1 as number));
    expect(enemy, 'the opponent is in the report').toBeDefined();

    const v = enemy!.viability;
    // THE FOUR NUMBERS. Under the old rule the first two were 0 and 1 the other
    // way round, and the last two both said the match could continue.
    expect(v.heldUnits, 'one man, indoors').toBe(1);
    expect(v.contestingUnits, 'and nothing on the field').toBe(0);
    expect(v.canContest).toBe(false);
    expect(v.isBeaten).toBe(true);
    // The rest of the survey, so a reader can see WHY isBeaten is true rather
    // than having to take it on trust.
    expect(v.units).toBe(1);
    expect(v.buildings).toBe(1);          // the block he captured
    expect(v.producers).toBe(0);
    expect(v.constructionVehicles).toBe(0);
    expect(v.canRebuild).toBe(false);
    expect(v.hasAssets).toBe(true);
  });

  it('says which function produced those numbers', () => {
    const report = buildDiagnostics({ env: ENV, match: matchInput(rig), includeEntities: false });
    const v = report.match!.players[0].viability;
    expect(v.source).toContain('surveyViability');
    // `describeViability` verbatim, so the export, the boot log and the
    // on-screen readout are provably the same string.
    expect(v.line).toContain('held ');
    expect(v.line).toContain('contest ');
    expect(viabilityLines(rig.world).join('\n')).toContain(v.line);
  });

  it('explains held units in prose, because a number alone did not help anyone', () => {
    const report = buildDiagnostics({ env: ENV, match: matchInput(rig), includeEntities: false });
    const notes = report.notes.join(' ');
    expect(notes).toContain('heldUnits');
    expect(notes).toContain('Garrisoned');
    expect(notes).toContain('contestingUnits');
  });

  it('reads the outcome rule out loud, and gets it right for this world', () => {
    const report = buildDiagnostics({ env: ENV, match: matchInput(rig), includeEntities: false });
    const o = report.match!.outcome;
    expect(o.hostiles).toBe(1);
    expect(o.hostilesBeaten).toBe(1);
    expect(o.victoryConditionMet).toBe(true);
    expect(o.defeatConditionMet).toBe(false);
    expect(o.reading).toContain('victory');
    // And it does NOT claim to know how long the state has held — that
    // accumulator is private to `game/outcome.system.ts`.
    expect(o.note).toContain('INSTANTANEOUS');
  });

  it('decodes the flag on the man himself, by name, on one greppable line', () => {
    const text = formatDiagnostics(buildDiagnostics({
      env: ENV, match: matchInput(rig), includeEntities: true,
    }));
    const st = rig.world.store;
    const id = st.handleOf(st.index(occupant)) as number;

    const line = text.split('\n').find((l) => l.includes('"Garrisoned"'));
    expect(line, 'a decoded Garrisoned flag appears in the entity list').toBeDefined();
    // ONE LINE, carrying everything needed to act on it: which entity, whose,
    // what it is, and where. That is the whole argument for the columnar row
    // format — `grep Garrisoned` is a complete answer.
    expect(line).toContain(String(id));
    expect(line).toContain('conscript');
    expect(line).toContain('Infantry');
    // The raw bitmask is nowhere in the row.
    expect(line).not.toContain(String(st.flags[st.index(occupant)]));
  });

  it('reports the host, so "inside what?" is answerable', () => {
    const report = buildDiagnostics({ env: ENV, match: matchInput(rig), includeEntities: true });
    const st = rig.world.store;
    const id = st.handleOf(st.index(occupant)) as number;
    const cols = report.match!.entities!.columns;
    const row = report.match!.entities!.rows.find((r) => r[cols.indexOf('id')] === id);
    expect(row, 'the occupant has a row').toBeDefined();
    expect(row![cols.indexOf('garrison')], 'and it names the building holding him')
      .toBe(block as number);
    expect(row![cols.indexOf('carrier')], 'he is not in a hull').toBe(0);
  });
});

/* ==========================================================================
 * 2. IT CHANGES NOTHING
 *
 * A diagnostic that perturbs what it measures is worse than none, and this one
 * is reachable from a screen that opens over a live lockstep match.
 * ========================================================================== */

describe('the export is a read', () => {
  let rig: Rig;

  beforeEach(() => {
    rig = makeRig();
    rig.building('conyard', P0, 40, 40);
    rig.building('warFactory', P0, 52, 40);
    rig.unit('grizzly', P0, 60, 60);
    rig.unit('harvester', P0, 64, 60);
    rig.building('conyard', P1, 160, 160);
    rig.unit('rhino', P1, 152, 150);
    const block = rig.civilian('civApartments', 120, 120);
    const man = rig.unit('conscript', P1, 120, 120);
    sendInto(rig, man, block);
    rig.step(2);
  });

  afterEach(() => {
    setProduction(null);
    setCaptureService(null);
    setGarrisonService(null);
    setTransportService(null);
  });

  it('leaves the simulation checksum untouched, entity list included', () => {
    const before = checksum(rig.world);
    const text = formatDiagnostics(buildDiagnostics({
      env: ENV, match: matchInput(rig), includeEntities: true,
    }));
    expect(text.length).toBeGreaterThan(0);
    const after = checksum(rig.world);
    expect(after.hash).toBe(before.hash);
    expect(after.tick).toBe(before.tick);
    expect(after.entities).toBe(before.entities);
    for (let i = 0; i < before.blocks.length; i++) {
      expect(after.blocks[i], before.blocks[i].name).toEqual(before.blocks[i]);
    }
  });

  it('is deterministic: two exports of one state are byte-identical', () => {
    // Not a nicety. `store.alive` is maintained by swap-remove, so its natural
    // order changes whenever anything dies; the entity list is sorted by id so
    // two dumps can be DIFFED. Without that, every export of an unchanged world
    // would look different for no reason.
    const one = formatDiagnostics(buildDiagnostics({
      env: ENV, match: matchInput(rig), includeEntities: true,
    }));
    const two = formatDiagnostics(buildDiagnostics({
      env: ENV, match: matchInput(rig), includeEntities: true,
    }));
    expect(two).toBe(one);
  });

  it('surveys every player without the caller having to reset anything', () => {
    // `surveyViability` writes into a caller-supplied object and this module
    // reuses two of them. A survey that leaked between players would show up
    // here as two players reporting one player's numbers.
    const report = buildDiagnostics({ env: ENV, match: matchInput(rig), includeEntities: false });
    const p0 = report.match!.players[0].viability;
    const p1 = report.match!.players[1].viability;
    expect(p0.producers, 'the local player has a con yard and a war factory').toBe(2);
    expect(p1.producers, 'the opponent has one con yard').toBe(1);
    expect(p0.contestingUnits, 'a tank; the harvester does not count').toBe(1);
    expect(p1.heldUnits).toBe(1);
    expect(p0.heldUnits).toBe(0);
  });
});

/* ==========================================================================
 * 3. MATCH IDENTITY — two seeds, and they are not one seed
 * ========================================================================== */

describe('match identity', () => {
  let rig: Rig;
  beforeEach(() => { rig = makeRig(); rig.building('conyard', P0, 40, 40); });
  afterEach(() => {
    setProduction(null); setCaptureService(null);
    setGarrisonService(null); setTransportService(null);
  });

  it('carries mapSeed and simSeed separately and labels which is which', () => {
    const report = buildDiagnostics({ env: ENV, match: matchInput(rig), includeEntities: false });
    const m = report.match!;
    expect(m.mapSeed).toBe(MAP_SEED);
    expect(m.simSeed).toBe(SIM_SEED);
    expect(m.mapSeed).not.toBe(m.simSeed);
    expect(m.seedNote).toContain('mapseed');
    expect(m.seedNote).toContain('seed=');
    expect(report.notes.join(' ')).toContain('DIFFERENT SEEDS');
  });

  it('carries the rest of what a reproduction needs', () => {
    const report = buildDiagnostics({ env: ENV, match: matchInput(rig), includeEntities: false });
    const m = report.match!;
    expect(m.mapId).toBe('temperate-valley');
    expect(m.biome).toBe('temperate');
    expect(m.opening).toBe('mcv');
    expect(m.simTick).toBe(rig.tick);
    expect(report.environment.buildVersion).toBe('9.9.9-test');
    expect(report.formatVersion).toBe(DIAGNOSTICS_FORMAT_VERSION);
  });

  it('describes each player as a person would name them', () => {
    const report = buildDiagnostics({ env: ENV, match: matchInput(rig), includeEntities: false });
    const [local, enemy] = report.match!.players;
    expect(local.faction).toBe('Allies');
    expect(local.controller).toBe('human');
    expect(local.isLocal).toBe(true);
    expect(local.credits).toBe(4321);
    expect(enemy.controller).toBe('AI (Brutal / Rusher)');
    // `buildingCount` is an Int32Array of mostly zeroes; only the rows that
    // exist are printed, keyed by content key rather than by def index.
    expect(local.buildingCount.conyard).toBe(1);
    expect(local.buildingCountTotal).toBe(1);
  });

  it('counts entities by kind and by owner', () => {
    rig.unit('grizzly', P0, 60, 60);
    rig.unit('rhino', P1, 150, 150);
    const report = buildDiagnostics({ env: ENV, match: matchInput(rig), includeEntities: false });
    expect(report.match!.entityTotals.total).toBe(rig.world.store.aliveCount);
    expect(report.match!.entityTotals.Vehicle).toBe(2);
    expect(report.match!.players[0].entitiesByKind.Vehicle).toBe(1);
    expect(report.match!.players[1].entitiesByKind.Vehicle).toBe(1);
  });
});

/* ==========================================================================
 * 4. THE STATE MOST PEOPLE WILL SEE
 *
 * The options screen is reachable from the title menu, where there is no world
 * at all. A diagnostic that is blank there is a diagnostic nobody trusts.
 * ========================================================================== */

describe('with no match running', () => {
  it('still produces a complete environment report, and says what is missing', () => {
    const report = buildDiagnostics({ env: ENV, match: null, includeEntities: true });
    expect(report.match).toBeNull();
    expect(report.environment.renderer?.backend).toBe('webgpu');
    expect(report.environment.graphics.tier).toBe('high');
    expect(report.notes.join(' ')).toContain('NO MATCH IS RUNNING');
    // And it is still valid, parseable output rather than a stub.
    expect(JSON.parse(formatDiagnostics(report))).toMatchObject({
      report: 'voltmarch-diagnostics',
      match: null,
    });
  });
});

/* ==========================================================================
 * 5. THE PIECES
 * ========================================================================== */

describe('flag decoding', () => {
  it('names every bit that is set, in bit order', () => {
    const bits = EntityFlag.Alive | EntityFlag.Garrisoned | EntityFlag.CanMove;
    expect(decodeFlags(bits)).toEqual(['Alive', 'Garrisoned', 'CanMove']);
  });

  it('returns an empty list for no flags rather than a placeholder', () => {
    expect(decodeFlags(0)).toEqual([]);
  });

  it('surfaces a bit it has no name for instead of dropping it', () => {
    /*
     * `EntityFlag` uses bits 0..30. A bit appended without a row in
     * `FLAG_NAMES` would be invisible if unknown bits were dropped — the same
     * failure the raw bitmask has, and harder to notice because the output
     * looks complete. Bit 31 stands in for that here.
     */
    const decoded = decodeFlags(EntityFlag.Alive | 0x8000_0000);
    expect(decoded[0]).toBe('Alive');
    expect(decoded[1]).toMatch(/^unnamed:0x/);
  });

  it('accounts for every flag the engine actually sets on a live unit', () => {
    const rig = makeRig();
    rig.unit('harvester', P0, 10, 10);
    const st = rig.world.store;
    const i = st.index(st.handleOf(st.alive[0]));
    expect(decodeFlags(st.flags[i]).some((n) => n.startsWith('unnamed:'))).toBe(false);
    setProduction(null); setCaptureService(null);
    setGarrisonService(null); setTransportService(null);
  });
});

/* ==========================================================================
 * 5b. UNLOCK EVERYTHING
 *
 * `?unlockall` reachable without a URL bar. The interesting properties are all
 * about LIFETIME: it must reach the gate, survive a match boot, and persist as
 * an explicit preference without contaminating earned progression.
 * ========================================================================== */

describe('the unlock-everything toggle', () => {
  afterEach(() => {
    setSessionUnlockAll(false);
    setUnlockGate(null);
  });

  it('is off until somebody asks, so no boot is changed by its existence', () => {
    // Every `?shot=` fixture and every cold boot runs with this module loaded.
    // A default of anything but false would silently ungate the capture set.
    expect(unlockAllActive()).toBe(false);
    expect(unlockAllFromBootFlag()).toBe(false);
  });

  it('pushes at the live gate, both ways', () => {
    const gate = new UnlockGate(() => []);
    setUnlockGate(gate);
    expect(gate.isUnrestricted).toBe(false);

    setSessionUnlockAll(true);
    expect(gate.isUnrestricted).toBe(true);
    expect(unlockAllActive()).toBe(true);
    // The point of the whole feature: a def nothing has unlocked becomes
    // buildable without leaving the match.
    expect(isBuildable({ key: 'battleLab', unlockedBy: 'struct.tech' })).toBe(true);

    setSessionUnlockAll(false);
    expect(gate.isUnrestricted).toBe(false);
    expect(isBuildable({ key: 'battleLab', unlockedBy: 'struct.tech' })).toBe(false);
  });

  it('survives a match boot by re-applying itself after the gate is installed', () => {
    /*
     * `progression.system.ts#init` constructs a FRESH `UnlockGate` on EVERY
     * match boot, so a value written straight onto the live gate is erased by
     * the next match — the trap `src/shell/progression-link.ts` documents for
     * the mirror-AI preference. This is the structural half of the fix: same
     * phase, higher order, so `SystemRegistry.init` (which awaits modules in
     * phase/order/seq) always runs it after the gate exists.
     */
    expect(unlockAllSystem.phase).toBe(progressionSystem.phase);
    expect(unlockAllSystem.order ?? 0)
      .toBeGreaterThan(progressionSystem.order ?? 0);

    // And the behavioural half: a new gate, then the init, and it is on again.
    setSessionUnlockAll(true);
    const rebuilt = new UnlockGate(() => []);
    setUnlockGate(rebuilt);
    expect(rebuilt.isUnrestricted, 'a fresh gate starts gated').toBe(false);
    unlockAllSystem.init?.();
    expect(rebuilt.isUnrestricted, 'and the session flag puts it back').toBe(true);
  });

  it('does nothing at init while it is off, so it cannot ungate an ordinary boot', () => {
    const gate = new UnlockGate(() => []);
    setUnlockGate(gate);
    unlockAllSystem.init?.();
    expect(gate.isUnrestricted).toBe(false);
  });

  it('persists the explicit preference without writing earned progression', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string): string | null => values.get(key) ?? null,
      setItem: (key: string, value: string): void => { values.set(key, value); },
      removeItem: (key: string): void => { values.delete(key); },
    };
    setSessionUnlockAll(true, storage);
    expect(values.get(UNLOCK_ALL_STORAGE_KEY)).toBe('1');
    expect(readPersistedUnlockAll(storage)).toBe(true);
    setSessionUnlockAll(false, storage);
    expect(values.has(UNLOCK_ALL_STORAGE_KEY)).toBe(false);
  });

  it('is reported in the export, because it changes what game is being described', () => {
    const rig = makeRig();
    rig.building('conyard', P0, 40, 40);
    const report = buildDiagnostics({
      env: { ...ENV, unlockAll: true }, match: matchInput(rig), includeEntities: false,
    });
    expect(report.environment.unlockAll).toBe(true);
    const notes = report.notes.join(' ');
    expect(notes).toContain('UNLOCK EVERYTHING IS ON');
    expect(notes, 'and that the AI roster is unaffected').toContain('opponents are unrestricted');
    setProduction(null); setCaptureService(null);
    setGarrisonService(null); setTransportService(null);
  });

  it('stays quiet in the export when it is off', () => {
    const rig = makeRig();
    rig.building('conyard', P0, 40, 40);
    const report = buildDiagnostics({ env: ENV, match: matchInput(rig), includeEntities: false });
    expect(report.notes.join(' ')).not.toContain('UNLOCK EVERYTHING');
    setProduction(null); setCaptureService(null);
    setGarrisonService(null); setTransportService(null);
  });
});

describe('boot flags', () => {
  it('keeps the flags that matter and redacts the one that is not the game\'s', () => {
    // The export is designed to be pasted into a public issue. `?relay=` is the
    // only value in a query string that belongs to the player rather than to
    // the build; whether it was set is diagnostic, its value is not.
    const out = redactBootFlags('?seed=12&relay=wss://someone.example:8443&gpu=webgpu');
    expect(out.seed).toBe('12');
    expect(out.gpu).toBe('webgpu');
    expect(out.relay).toBe('(set)');
    expect(JSON.stringify(out)).not.toContain('someone.example');
  });

  it('tolerates an empty query and a missing leading question mark', () => {
    expect(redactBootFlags('')).toEqual({});
    expect(redactBootFlags('seed=9')).toEqual({ seed: '9' });
  });
});

describe('the text format', () => {
  let rig: Rig;
  beforeEach(() => {
    rig = makeRig();
    rig.building('conyard', P0, 40, 40);
    rig.unit('grizzly', P0, 60, 60);
    rig.unit('rhino', P1, 150, 150);
  });
  afterEach(() => {
    setProduction(null); setCaptureService(null);
    setGarrisonService(null); setTransportService(null);
  });

  it('is valid JSON, so a tool can read what a person pasted', () => {
    const text = formatDiagnostics(buildDiagnostics({
      env: ENV, match: matchInput(rig), includeEntities: true,
    }));
    const parsed = JSON.parse(text) as { match: { entities: { rows: unknown[] } } };
    expect(parsed.match.entities.rows).toHaveLength(rig.world.store.aliveCount);
  });

  it('keeps one entity per line, which is what makes the dump greppable', () => {
    const text = formatDiagnostics(buildDiagnostics({
      env: ENV, match: matchInput(rig), includeEntities: true,
    }));
    // Three entities, three rows, and each row whole on its own line — so the
    // dump is (entities + a fixed header) lines rather than 17x that.
    const rowLines = text.split('\n').filter((l) => l.trim().startsWith('[') && l.includes('"'));
    expect(rowLines).toHaveLength(3);
    for (const l of rowLines) expect(l.trim().endsWith('],') || l.trim().endsWith(']')).toBe(true);
  });

  it('expands objects, because the summary is the tier a person reads', () => {
    const text = formatDiagnostics(buildDiagnostics({
      env: ENV, match: matchInput(rig), includeEntities: false,
    }));
    expect(text).toMatch(/\n\s+"heldUnits": \d+/);
    expect(text).toMatch(/\n\s+"isBeaten": (true|false)/);
  });

  it('states that the entity list is complete rather than implying it', () => {
    const report = buildDiagnostics({
      env: ENV, match: matchInput(rig), includeEntities: true,
    });
    const e = report.match!.entities!;
    expect(e.listed).toBe(rig.world.store.aliveCount);
    expect(e.storeCapacity).toBe(rig.world.store.capacity);
    expect(e.note).toContain('Complete');
  });

  it('says the entity list was left out when it was left out', () => {
    const report = buildDiagnostics({
      env: ENV, match: matchInput(rig), includeEntities: false,
    });
    expect(report.match!.entities).toBeNull();
    expect(report.notes.join(' ')).toContain('per-entity list is not included');
  });
});
