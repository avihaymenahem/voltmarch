/**
 * The skirmish AI — doctrine, honesty and determinism.
 *
 * Everything here runs headless. `AI.ts` and `AIStrategy.ts` touch no GL, no
 * DOM and no `ctx()`, which is the point of keeping `ai.system.ts` as a thin
 * registration shim: the whole opponent is testable in Node.
 *
 * The two load-bearing assertions in this file are:
 *   - the AI mutates NOTHING (§ "commands are the only exit"), and
 *   - the AI learns nothing it cannot see (§ "no cheating vision").
 * Those are the two properties that make the opponent fair, and they are both
 * the kind of property that quietly rots the first time someone adds a
 * convenience write.
 */

import { describe, expect, it } from 'vitest';

import { Channels } from '../src/core/events';
import { World } from '../src/core/world';
import {
  ArmorClass, EntityFlag, EntityKind, Faction, CommandKind, OrderKind, VisionLevel,
} from '../src/core/types';
import type {
  AvailabilityResult, Command, EntityId, IRng, IVision, PlayerId, SimContext,
} from '../src/core/types';
import { AI_DIFFICULTY, AI_MILITARY, AI_SQUAD_MIN, CELL, SIM_DT, SIM_HZ } from '../src/core/config';

/**
 * Ticks before a brain of this difficulty is allowed to launch its FIRST
 * offensive. Mirrors the arithmetic in `AiBrain`'s constructor; the pacing
 * itself is asserted in tests/ai-pacing.spec.ts, and cases here just need to
 * get past it.
 */
function offensiveGateTicks(difficulty: number): number {
  const agg = Math.max(0.1, AI_DIFFICULTY[difficulty]!.aggression);
  return Math.round((AI_MILITARY.firstStrikeSeconds * SIM_HZ) / agg);
}
import { Rng } from '../src/core/math';

import { AiBrain, AiDirector, AiPosture } from '../src/sim/AI';
import {
  BuildCatalog, BuildRole, ThreatClass, classifyThreat, difficultyProfile,
  openingFor, personalityByName, pickUnit, prereqsMet, scoreComposition,
} from '../src/sim/AIStrategy';
import type { CatalogEntry, DefLookup, ProductionOracle } from '../src/sim/AIStrategy';

/* ========================================================================== */
/* Harness                                                                    */
/* ========================================================================== */

const P_HUMAN = 0 as PlayerId;
const P_AI = 1 as PlayerId;

/**
 * A binding with no `DefTables` but every content key resolved to a synthetic
 * def id. That is exactly the state the AI must cope with while `src/data/**`
 * is still being written, and it lets the catalog keep its authored costs while
 * still producing production commands that name something.
 */
function syntheticBinding(): DefLookup {
  const catalog = new BuildCatalog();
  const unitId: Record<string, number> = {};
  const buildingId: Record<string, number> = {};
  let u = 0;
  let b = 0;
  for (const e of catalog.all) {
    if (e.isBuilding) buildingId[e.key] = b++;
    else unitId[e.key] = u++;
  }
  return { tables: null, unitId, buildingId };
}

interface Harness {
  world: World;
  channels: Channels;
  brain: AiBrain;
  catalog: BuildCatalog;
  /** Every command the brain has issued, flattened for comparison. */
  log: string[];
  step(ticks: number): void;
}

function simCtx(tick: number, rng: IRng): SimContext {
  return { dt: SIM_DT, tick, time: tick * SIM_DT, rng };
}

function describeCommand(c: Command): string {
  const ids: number[] = [];
  for (let i = 0; i < c.entityCount; i++) ids.push(c.entities[i]);
  return [
    c.kind, c.player, c.order, c.defId, c.tab,
    Math.round(c.x), Math.round(c.z), c.cx, c.cz, c.stance, ids.join('.'),
  ].join('|');
}

function spawnBuilding(
  world: World, owner: PlayerId, faction: Faction,
  x: number, z: number, w: number, h: number, flags: number, power: number,
): EntityId {
  const st = world.store;
  const id = st.alloc(EntityKind.Building, -1, owner, faction, x, 0, z, 0);
  const i = st.index(id);
  st.flags[i] |= flags;
  st.footprintW[i] = w;
  st.footprintH[i] = h;
  st.powerDraw[i] = power;
  st.hp[i] = 2000;
  st.maxHp[i] = 2000;
  st.armorClass[i] = ArmorClass.Concrete;
  st.buildProgress[i] = 1;
  world.terrain.markOccupied(
    Math.floor(x / CELL) - ((w / 2) | 0), Math.floor(z / CELL) - ((h / 2) | 0), w, h, id,
  );
  return id;
}

function spawnUnit(
  world: World, owner: PlayerId, faction: Faction,
  x: number, z: number, flags: number, kind = EntityKind.Vehicle,
): EntityId {
  const st = world.store;
  const id = st.alloc(kind, -1, owner, faction, x, 0, z, 0);
  const i = st.index(id);
  st.flags[i] |= EntityFlag.CanMove | EntityFlag.ProvidesVision | flags;
  st.hp[i] = 300;
  st.maxHp[i] = 300;
  st.maxSpeed[i] = 6;
  st.armorClass[i] = ArmorClass.Medium;
  st.radius[i] = 2;
  return id;
}

/** EntityFlags a completed structure of each role would carry. */
function flagsForRole(role: BuildRole): number {
  switch (role) {
    case BuildRole.Builder: return EntityFlag.IsBuilder | EntityFlag.IsFactory;
    case BuildRole.Refinery: return EntityFlag.IsRefinery;
    case BuildRole.Radar: return EntityFlag.IsRadar;
    case BuildRole.Barracks:
    case BuildRole.WarFactory: return EntityFlag.IsFactory;
    case BuildRole.Defense: return EntityFlag.CanAttack;
    case BuildRole.AntiAir: return EntityFlag.CanAttack | EntityFlag.HasTurret;
    default: return 0;
  }
}

interface HarnessOptions {
  seed?: number;
  difficulty?: number;
  personality?: number;
  /**
   * Run a minimal stand-in for the production + economy modules, so the AI's
   * requests actually turn into buildings and units. Without this the AI is
   * exercised against the boot state of the repo (a bus with nothing on the
   * other end), which is also worth testing — hence the flag.
   */
  production?: boolean;
  factories?: boolean;
  /**
   * Bind the catalog through the production oracle instead of the def-table
   * path, and give the brain the same oracle. This is the shape the real game
   * runs in once `sim.production` is in the process.
   */
  oracle?: ProductionOracle;
}

/** A world with a human at (100,100) and an AI base at (400,400). */
function makeHarness(options: HarnessOptions = {}): Harness {
  const world = new World();
  const channels = new Channels();
  world.addPlayer(Faction.Allies, 'Commander', true, true);
  world.addPlayer(Faction.Soviets, 'Opponent', false, false);
  const ai = world.player(P_AI);
  ai.aiDifficulty = options.difficulty ?? 1;
  ai.aiPersonality = options.personality ?? 0;

  // The AI's starting base: a Construction Yard, a power plant and one
  // harvester. Enough for every layer to have something to reason about.
  spawnBuilding(world, P_AI, Faction.Soviets, 400, 400, 3, 3,
    EntityFlag.IsBuilder | EntityFlag.IsFactory | EntityFlag.BlocksNav, -20);
  spawnBuilding(world, P_AI, Faction.Soviets, 380, 400, 2, 2, EntityFlag.BlocksNav, 100);
  spawnUnit(world, P_AI, Faction.Soviets, 410, 410, EntityFlag.IsHarvester);
  if (options.factories) {
    spawnBuilding(world, P_AI, Faction.Soviets, 424, 388, 2, 2,
      EntityFlag.IsFactory | EntityFlag.BlocksNav, -20);
    spawnBuilding(world, P_AI, Faction.Soviets, 424, 412, 3, 2,
      EntityFlag.IsFactory | EntityFlag.BlocksNav, -40);
    spawnBuilding(world, P_AI, Faction.Soviets, 376, 424, 3, 2,
      EntityFlag.IsRefinery | EntityFlag.BlocksNav, -30);
  }
  ai.powerProduced = 400;
  ai.powerConsumed = 20;

  const catalog = new BuildCatalog();
  if (options.oracle !== undefined) catalog.bindOracle(options.oracle);
  else catalog.bind(syntheticBinding());
  const brain = new AiBrain(world, channels.commands, catalog, P_AI, options.seed ?? 12345);
  if (options.oracle !== undefined) brain.setOracle(options.oracle);
  brain.attach(channels.events);

  const log: string[] = [];
  const rng = new Rng(7);
  let tick = 0;

  /* -- the stand-in production module ---------------------------------- */
  interface FakeItem { defId: number; isBuilding: boolean; ticks: number; ready: boolean }
  const queues: FakeItem[][] = [[], [], [], []];

  function onProductionStart(tab: number, defId: number): void {
    if (!options.production) return;
    if (queues[tab].length >= 2) return;
    const entry = defId < 0 ? undefined : (
      tab === 0 || tab === 1 ? catalog.entryForBuilding(defId) : catalog.entryForUnit(defId));
    if (entry === undefined) return;
    queues[tab].push({ defId, isBuilding: entry.isBuilding, ticks: 30, ready: false });
    ai.queues[tab].items.push({
      defId, isBuilding: entry.isBuilding, progress: 0, spent: 0,
      cost: entry.cost, ready: false, onHold: false,
    });
    channels.events.emit('production:started', {
      player: P_AI, tab, defId, isBuilding: entry.isBuilding, cost: entry.cost,
    } as never);
  }

  function onPlaceBuilding(defId: number, cx: number, cz: number): void {
    if (!options.production) return;
    for (let tab = 0; tab < 4; tab++) {
      const i = queues[tab].findIndex((q) => q.defId === defId && q.ready);
      if (i < 0) continue;
      const entry = catalog.entryForBuilding(defId)!;
      const x = (cx + entry.footprintW * 0.5) * CELL;
      const z = (cz + entry.footprintH * 0.5) * CELL;
      const st = world.store;
      const id = st.alloc(EntityKind.Building, defId, P_AI, Faction.Soviets, x, 0, z, 0);
      const si = st.index(id);
      st.flags[si] |= EntityFlag.BlocksNav | flagsForRole(entry.role);
      st.footprintW[si] = entry.footprintW;
      st.footprintH[si] = entry.footprintH;
      st.powerDraw[si] = entry.power;
      st.hp[si] = 1000; st.maxHp[si] = 1000;
      world.terrain.markOccupied(cx, cz, entry.footprintW, entry.footprintH, id);
      queues[tab].splice(i, 1);
      ai.queues[tab].items.shift();
      channels.events.emit('building:completed', { id, defId, player: P_AI, x, z } as never);
      return;
    }
  }

  function advanceProduction(): void {
    if (!options.production) return;
    for (let tab = 0; tab < 4; tab++) {
      const head = queues[tab][0];
      if (head === undefined || head.ready) continue;
      if (--head.ticks > 0) continue;
      head.ready = true;
      const entry = head.isBuilding
        ? catalog.entryForBuilding(head.defId)! : catalog.entryForUnit(head.defId)!;
      channels.events.emit('production:ready', {
        player: P_AI, tab, defId: head.defId, isBuilding: head.isBuilding,
      } as never);
      if (head.isBuilding) continue;
      // Units just appear at the factory door, like a real one would.
      const flags = entry.role === BuildRole.Harvester ? EntityFlag.IsHarvester : EntityFlag.CanAttack;
      spawnUnit(world, P_AI, Faction.Soviets, 404 + queues[tab].length * 3, 418, flags);
      queues[tab].shift();
      ai.queues[tab].items.shift();
    }
  }

  return {
    world, channels, brain, catalog, log,
    step(ticks: number): void {
      for (let n = 0; n < ticks; n++) {
        tick++;
        world.tick = tick;
        world.time = tick * SIM_DT;
        channels.setTick(tick);
        brain.tick(simCtx(tick, rng));
        // Stand in for Phase.Command: drain, record, and optionally execute.
        // The AI must never depend on anything actually executing its orders.
        channels.commands.drain((c) => {
          log.push(describeCommand(c));
          if (c.kind === CommandKind.ProductionStart) onProductionStart(c.tab as number, c.defId);
          else if (c.kind === CommandKind.PlaceBuilding) onPlaceBuilding(c.defId, c.cx, c.cz);
        });
        advanceProduction();
      }
    },
  };
}

/* ========================================================================== */
/* AIStrategy — the content model                                             */
/* ========================================================================== */

describe('AIStrategy — the catalog', () => {
  it('is fully usable with no def table at all', () => {
    const c = new BuildCatalog();
    expect(c.all.length).toBeGreaterThan(15);
    expect(c.get('powerPlant')?.cost).toBeGreaterThan(0);
    expect(c.get('refinery')?.footprintW).toBe(3);
    // Nothing is buildable, and the catalog says so rather than pretending.
    expect(c.resolvedCount).toBe(0);
    expect(c.resolved('powerPlant')).toBe(false);
  });

  it('binds def ids without a DefTables and keeps its authored numbers', () => {
    const c = new BuildCatalog();
    const costBefore = c.get('warFactory')!.cost;
    c.bind(syntheticBinding());
    expect(c.resolvedCount).toBe(c.all.length);
    expect(c.get('warFactory')!.defId).toBeGreaterThanOrEqual(0);
    expect(c.get('warFactory')!.cost).toBe(costBefore);
    expect(c.entryForBuilding(c.get('warFactory')!.defId)!.key).toBe('warFactory');
  });

  it('adopts a real DefTables when one exists', () => {
    const c = new BuildCatalog();
    const buildings = [{
      key: 'powerPlant', name: 'Reactor', blurb: '', faction: Faction.Soviets,
      cost: 1234, buildTime: 9, tab: 0, prereqs: [], sortOrder: 0, model: '',
      maxHp: 800, armor: ArmorClass.Concrete, footprintW: 4, footprintH: 4,
      power: 250, sight: 10, weapons: [], hasTurret: false, produces: [],
      producesTab: -1, exitOffsetX: 0, exitOffsetZ: 0, dockOffsetX: 0,
      dockOffsetZ: 0, storage: 0, buildRadius: 0, flags: 0,
    }];
    c.bind({
      tables: {
        units: [], buildings, weapons: [], factions: [], armorMatrix: [],
        unitByKey: new Map(), buildingByKey: new Map([['powerPlant', 0]]),
      } as never,
      unitId: {},
      buildingId: { powerPlant: 0 },
    });
    const e = c.get('powerPlant')!;
    expect(e.cost).toBe(1234);
    expect(e.power).toBe(250);
    expect(e.footprintW).toBe(4);
    // Role and doctrine stay authored — content does not publish those.
    expect(e.role).toBe(BuildRole.Power);
  });

  it('resolves prerequisites by ROLE, so an unbound def id still gates', () => {
    const c = new BuildCatalog();
    const warFactory = c.get('warFactory')!;
    expect(prereqsMet(warFactory, () => false)).toBe(false);
    expect(prereqsMet(warFactory, (r) => r === BuildRole.Refinery)).toBe(true);
    // An unrecognised prereq must NOT freeze the build layer.
    const alien: CatalogEntry = { ...warFactory, prereqs: ['sovietTimeMachine'] };
    expect(prereqsMet(alien, () => false)).toBe(true);
  });
});

describe('AIStrategy — the production oracle', () => {
  /** A tech tree that only knows power plants, and only permits one cell. */
  const ONLY_CX = 104;
  const ONLY_CZ = 96;

  function fakeOracle(seen: string[]): ProductionOracle {
    return {
      factsFor(key) {
        seen.push(key);
        if (key !== 'powerPlant') return null;
        return {
          publicId: 77, isBuilding: true, tab: 0, cost: 42, buildTimeSec: 3,
          power: 300, footprintW: 2, footprintH: 2, prereqs: [],
          faction: Faction.Neutral, buildable: true,
        };
      },
      available: () => true,
      placeable: (_p, _id, cx, cz) => cx === ONLY_CX && cz === ONLY_CZ,
    };
  }

  it('takes ids, cost and power from production and keeps doctrine authored', () => {
    const c = new BuildCatalog();
    const seen: string[] = [];
    expect(c.bindOracle(fakeOracle(seen))).toBe(1);
    expect(seen.length).toBe(c.all.length);

    const power = c.get('powerPlant')!;
    expect(power.defId).toBe(77);
    expect(power.cost).toBe(42);
    expect(power.power).toBe(300);
    // Doctrine survives: production has no opinion about what a role is.
    expect(power.role).toBe(BuildRole.Power);
    expect(c.entryForBuilding(77)!.key).toBe('powerPlant');

    // Everything the tech tree does not carry stays unbuildable rather than
    // pretending to an id that would be rejected.
    expect(c.get('warFactory')!.defId).toBe(-1);
    expect(c.resolved('warFactory')).toBe(false);
  });

  it('makes the brain defer to production for availability and placement', () => {
    const seen: string[] = [];
    const h = makeHarness({ production: true, oracle: fakeOracle(seen) });

    h.step(400);

    const production = h.log.filter((l) => l.startsWith(`${CommandKind.ProductionStart}|`));
    expect(production.length).toBeGreaterThan(0);
    // The ONLY thing the fake tech tree offers is publicId 77.
    for (const line of production) expect(line.split('|')[3]).toBe('77');

    // And every placement went where the oracle said it could, not where the
    // AI's own geometry would have put it.
    const places = h.log.filter((l) => l.startsWith(`${CommandKind.PlaceBuilding}|`));
    expect(places.length).toBeGreaterThan(0);
    for (const line of places) {
      const f = line.split('|');
      expect([f[7], f[8]]).toEqual([String(ONLY_CX), String(ONLY_CZ)]);
    }
  });
});

describe('AIStrategy — openings', () => {
  it('differ per faction', () => {
    const allies = openingFor(Faction.Allies, 0).map((s) => s.key);
    const soviets = openingFor(Faction.Soviets, 0).map((s) => s.key);
    expect(allies).not.toEqual(soviets);
    // Soviets get the barracks before the second refinery; Allies do not.
    expect(soviets.indexOf('barracks')).toBeLessThan(soviets.lastIndexOf('refinery'));
    expect(allies.indexOf('refinery')).toBeLessThan(allies.indexOf('barracks'));
  });

  it('bend with personality without forking into a different game', () => {
    const turtle = openingFor(Faction.Soviets, personalityByName('Turtle')).map((s) => s.key);
    const rusher = openingFor(Faction.Soviets, personalityByName('Rusher')).map((s) => s.key);
    const boomer = openingFor(Faction.Soviets, personalityByName('Boomer')).map((s) => s.key);

    expect(rusher[0]).toBe('barracks');
    expect(turtle).toContain('flameTower');
    expect(boomer.filter((k) => k === 'refinery').length)
      .toBeGreaterThan(rusher.filter((k) => k === 'refinery').length);
    // All three still open on the same economic spine.
    for (const o of [turtle, rusher, boomer]) expect(o).toContain('warFactory');
  });
});

describe('AIStrategy — composition is the difficulty axis', () => {
  const c = new BuildCatalog();
  const conscript = c.get('conscript')!;   // answers infantry
  const rhino = c.get('rhino')!;           // answers heavy

  function allInfantry(): Float32Array {
    const t = new Float32Array(5);
    t[ThreatClass.Infantry] = 1;
    return t;
  }

  it('ignores the observed threat at composition 0', () => {
    const t = allInfantry();
    // At 0 the score is purely the authored weight: rhino (5) beats conscript (4)
    // even though the enemy army is entirely infantry. That is the Easy AI.
    expect(scoreComposition(rhino, t, 0)).toBeGreaterThan(scoreComposition(conscript, t, 0));
  });

  it('answers the observed threat at composition 1', () => {
    const t = allInfantry();
    expect(scoreComposition(conscript, t, 1)).toBeGreaterThan(scoreComposition(rhino, t, 1));
  });

  it('rolls a MIXED army rather than nine of the best unit', () => {
    const cands = [conscript, rhino, c.get('apocalypse')!];
    const threat = allInfantry();
    const scratch = new Float32Array(8);
    const rng = new Rng(99);
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      seen.add(pickUnit(cands, threat, 1, rng, scratch)!.key);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('returns null rather than guessing when nothing scores', () => {
    expect(pickUnit([], new Float32Array(5), 1, new Rng(1), new Float32Array(4))).toBeNull();
  });
});

describe('AIStrategy — threat classification', () => {
  it('separates the five classes from columns that exist without a def table', () => {
    expect(classifyThreat(EntityKind.Infantry, ArmorClass.Infantry, false)).toBe(ThreatClass.Infantry);
    expect(classifyThreat(EntityKind.Vehicle, ArmorClass.Light, false)).toBe(ThreatClass.Light);
    expect(classifyThreat(EntityKind.Vehicle, ArmorClass.Heavy, false)).toBe(ThreatClass.Heavy);
    expect(classifyThreat(EntityKind.Building, ArmorClass.Concrete, false)).toBe(ThreatClass.Structure);
    // Altitude wins over everything: there is no EntityKind.Air in the contract.
    expect(classifyThreat(EntityKind.Vehicle, ArmorClass.Heavy, true)).toBe(ThreatClass.Air);
  });
});

describe('AIStrategy — difficulty', () => {
  it('scales reaction and action rate, and clamps out-of-range indices', () => {
    const easy = difficultyProfile(0);
    const brutal = difficultyProfile(3);
    expect(easy.reactionTicks).toBeGreaterThan(brutal.reactionTicks);
    expect(brutal.actionsPerTick).toBeGreaterThan(easy.actionsPerTick);
    expect(brutal.composition).toBeGreaterThan(easy.composition);
    expect(easy.creditFloor).toBeGreaterThan(brutal.creditFloor);
    expect(difficultyProfile(99).index).toBe(3);
    expect(difficultyProfile(-4).index).toBe(0);
  });
});

/* ========================================================================== */
/* AI.ts — the brain                                                          */
/* ========================================================================== */

describe('AiBrain — commands are the only exit', () => {
  it('issues real commands through the bus', () => {
    const h = makeHarness();
    h.step(200);
    expect(h.log.length).toBeGreaterThan(0);
    // Something was queued for production.
    expect(h.log.some((l) => l.startsWith(`${CommandKind.ProductionStart}|`))).toBe(true);
  });

  it('mutates NOTHING in the entity store or the player state', () => {
    const h = makeHarness();
    const st = h.world.store;
    const before = {
      flags: Uint32Array.from(st.flags),
      state: Uint8Array.from(st.state),
      orderKind: Uint8Array.from(st.orderKind),
      orderX: Float32Array.from(st.orderX),
      targetId: Int32Array.from(st.targetId),
      posX: Float32Array.from(st.posX),
      hp: Float32Array.from(st.hp),
      stance: Uint8Array.from(st.stance),
    };
    const p = h.world.player(P_AI);
    const credits = p.credits;
    const queued = p.queues.map((q) => q.items.length);

    h.step(400);

    expect(Array.from(st.flags)).toEqual(Array.from(before.flags));
    expect(Array.from(st.state)).toEqual(Array.from(before.state));
    expect(Array.from(st.orderKind)).toEqual(Array.from(before.orderKind));
    expect(Array.from(st.orderX)).toEqual(Array.from(before.orderX));
    expect(Array.from(st.targetId)).toEqual(Array.from(before.targetId));
    expect(Array.from(st.posX)).toEqual(Array.from(before.posX));
    expect(Array.from(st.hp)).toEqual(Array.from(before.hp));
    expect(Array.from(st.stance)).toEqual(Array.from(before.stance));
    // Credits and queues belong to Production/Economy. The AI asks; it never takes.
    expect(p.credits).toBe(credits);
    expect(p.queues.map((q) => q.items.length)).toEqual(queued);
  });

  it('stays inside its action budget', () => {
    // Brutal is 260 apm = 4.33 commands/sec. Over 600 ticks (20 s) that is at
    // most ~87 commands plus the small burst bank.
    const h = makeHarness({ difficulty: 3 });
    h.step(600);
    const brutal = h.log.length;
    expect(brutal).toBeLessThanOrEqual(Math.ceil(260 / 60 * 20) + 8);

    const easy = makeHarness({ difficulty: 0 });
    easy.step(600);
    expect(easy.log.length).toBeLessThanOrEqual(Math.ceil(40 / 60 * 20) + 8);
  });

  it('never orders another player around', () => {
    const h = makeHarness();
    h.step(400);
    for (const line of h.log) {
      expect(line.split('|')[1]).toBe(String(P_AI as number));
    }
  });
});

describe('AiBrain — no cheating vision', () => {
  /** A vision port that is blind: nothing is ever visible or explored. */
  const blind: IVision = {
    isVisibleAt: () => false,
    isExplored: () => false,
    canSee: () => false,
    hasRadar: () => false,
    gridFor: () => new Uint8Array(1),
    visibilityOf: () => VisionLevel.Hidden,
  };

  it('remembers nothing it cannot see', () => {
    const h = makeHarness();
    h.world.vision = blind;
    spawnBuilding(h.world, P_HUMAN, Faction.Allies, 100, 100, 3, 3, EntityFlag.IsBuilder, -20);
    h.step(200);
    const i = h.brain.intent();
    expect(i.rememberedStructures).toBe(0);
    expect(i.enemyBaseKnown).toBe(false);
  });

  it('remembers what it does see, and keeps remembering it afterwards', () => {
    const h = makeHarness();
    spawnBuilding(h.world, P_HUMAN, Faction.Allies, 100, 100, 3, 3, EntityFlag.IsRefinery, -30);
    // World's default port is fully open, which is the foundation's stub. That
    // is the "scouted everything" case, and memory must be populated from it.
    h.step(120);
    expect(h.brain.intent().rememberedStructures).toBeGreaterThan(0);
    expect(h.brain.intent().enemyBaseKnown).toBe(true);

    // Now go blind. The AI must NOT forget: it cannot see the cell, so it has
    // no evidence the refinery is gone.
    h.world.vision = blind;
    h.step(200);
    expect(h.brain.intent().rememberedStructures).toBeGreaterThan(0);
  });

  it('forgets a structure it can see is no longer there', () => {
    const h = makeHarness();
    const enemy = spawnBuilding(h.world, P_HUMAN, Faction.Allies, 100, 100, 3, 3, EntityFlag.IsRefinery, -30);
    h.step(120);
    expect(h.brain.intent().rememberedStructures).toBeGreaterThan(0);

    h.world.store.markDead(enemy);
    h.world.store.flushDestroyed();
    h.step(120);
    expect(h.brain.intent().rememberedStructures).toBe(0);
  });

  it('difficulty does not change what is visible — only how fast it reacts', () => {
    const easy = difficultyProfile(0);
    const brutal = difficultyProfile(3);
    // There is deliberately no vision term on the profile at all. If one ever
    // appears, this test is the place it has to be justified.
    expect(Object.keys(easy).join(',')).toBe(Object.keys(brutal).join(','));
    expect(Object.keys(easy).some((k) => /vision|sight|reveal|fog/i.test(k))).toBe(false);
  });
});

describe('AiBrain — economy layer', () => {
  it('puts an idle harvester onto ore', () => {
    const h = makeHarness();
    let asked = 0;
    h.world.ore = {
      oreAt: () => 500,
      takeOre: () => 0,
      oreValue: () => 1,
      findOre: (_cx, _cz, _max, out) => { asked++; out[0] = 90; out[1] = 90; return true; },
      totalOre: () => 100000,
    };
    h.step(120);
    expect(asked).toBeGreaterThan(0);
    const harvestOrders = h.log.filter(
      (l) => l.startsWith(`${CommandKind.Order}|`) && l.split('|')[2] === String(OrderKind.Harvest),
    );
    expect(harvestOrders.length).toBeGreaterThan(0);
  });

  it('reports being cut off from ore instead of buying more harvesters', () => {
    const h = makeHarness();
    h.world.ore = {
      oreAt: () => 0, takeOre: () => 0, oreValue: () => 1,
      findOre: () => false, totalOre: () => 0,
    };
    h.step(200);
    // No Harvest order can be issued, and the AI must not have queued a
    // harvester it has nothing to mine with.
    expect(h.log.some(
      (l) => l.startsWith(`${CommandKind.Order}|`) && l.split('|')[2] === String(OrderKind.Harvest),
    )).toBe(false);
  });
});

describe('AiBrain — military layer', () => {
  it('holds a home reserve and only attacks at threshold', () => {
    const h = makeHarness();
    // Two units is below any wave threshold.
    for (let i = 0; i < 2; i++) {
      spawnUnit(h.world, P_AI, Faction.Soviets, 400 + i * 4, 420, EntityFlag.CanAttack);
    }
    h.step(120);
    expect(h.brain.intent().posture).not.toBe('attacking');
    expect(h.brain.intent().reserve).toBeGreaterThan(0);

    // Now field a real army. The step has to clear the OFFENSIVE GATE as well
    // as the headcount threshold: since v1.15.x the brain also waits
    // `AI_MILITARY.firstStrikeSeconds / aggression` before its first push (see
    // tests/ai-pacing.spec.ts). This case is about the threshold, so it steps
    // past the clock rather than restating it.
    for (let i = 0; i < AI_SQUAD_MIN * 4; i++) {
      spawnUnit(h.world, P_AI, Faction.Soviets, 400 + i * 4, 430, EntityFlag.CanAttack);
    }
    h.step(offensiveGateTicks(1) + 240);
    const after = h.brain.intent();
    expect(after.army).toBeGreaterThan(AI_SQUAD_MIN);
    expect(after.strike).toBeGreaterThan(0);
    expect(after.reserve).toBeGreaterThan(0);
    expect(after.posture).toBe('attacking');
    expect(h.log.some(
      (l) => l.startsWith(`${CommandKind.Order}|`) && l.split('|')[2] === String(OrderKind.AttackMove),
    )).toBe(true);
  });

  it('answers a base attack, and only after its reaction delay', () => {
    const h = makeHarness({ difficulty: 0 });   // Easy: 2.4 s reaction
    for (let i = 0; i < 6; i++) {
      spawnUnit(h.world, P_AI, Faction.Soviets, 400 + i * 4, 420, EntityFlag.CanAttack);
    }
    h.step(60);
    h.channels.events.emit('combat:underAttack', { player: P_AI, x: 360, z: 360, isBuilding: true });

    h.step(10);   // well inside the 72-tick reaction window
    expect(h.brain.intent().posture).not.toBe('defending');

    h.step(120);
    expect(h.brain.intent().posture).toBe('defending');
  });

  it('goes all-in when the Construction Yard is gone', () => {
    const h = makeHarness();
    for (let i = 0; i < 5; i++) {
      spawnUnit(h.world, P_AI, Faction.Soviets, 400 + i * 4, 420, EntityFlag.CanAttack);
    }
    h.step(120);
    expect(h.brain.postureCode).not.toBe(AiPosture.Crippled);

    // Raze the yard.
    const st = h.world.store;
    for (let a = 0; a < st.aliveCount; a++) {
      const i = st.alive[a];
      if ((st.flags[i] & EntityFlag.IsBuilder) !== 0) st.markDead(st.handleOf(i));
    }
    st.flushDestroyed();

    h.step(120);
    const i = h.brain.intent();
    expect(i.posture).toBe('crippled');
    // Everything is in the strike group; nothing is held back for a base that
    // no longer exists.
    expect(i.reserve).toBe(0);
    expect(i.strike).toBe(i.army);
  });
});

describe('AiBrain — it actually plays a game', () => {
  it('builds a base out of nothing but ProductionStart and PlaceBuilding', () => {
    const h = makeHarness({ production: true });
    const structuresBefore = h.brain.intent().structures;
    h.step(1800);   // one minute of simulated time

    const after = h.brain.intent();
    const roles = Object.keys(after.structures);
    // It followed its opening: power, then the economy, then producers.
    expect(roles.length).toBeGreaterThan(Object.keys(structuresBefore).length);
    expect(roles).toContain('power');
    expect(after.structures.power).toBeGreaterThan(1);
    expect(roles).toContain('barracks');

    // And it placed them legally: no two footprints may overlap.
    const st = h.world.store;
    const cells = new Set<number>();
    for (let a = 0; a < st.aliveCount; a++) {
      const i = st.alive[a];
      if (st.kind[i] !== EntityKind.Building) continue;
      const ox = Math.round(st.posX[i] / CELL - st.footprintW[i] * 0.5);
      const oz = Math.round(st.posZ[i] / CELL - st.footprintH[i] * 0.5);
      for (let z = oz; z < oz + st.footprintH[i]; z++) {
        for (let x = ox; x < ox + st.footprintW[i]; x++) {
          const key = z * 1000 + x;
          expect(cells.has(key)).toBe(false);
          cells.add(key);
        }
      }
    }
  });

  it('builds an army once it has factories', () => {
    const h = makeHarness({ production: true, factories: true });
    const before = h.brain.intent().army;
    h.step(2400);
    expect(h.brain.intent().army).toBeGreaterThan(before);
  });
});

describe('AiBrain — regressions found by playing it', () => {
  it('never lets the home reserve make the wave threshold unreachable', () => {
    // A Turtle takes a 30% * 1.6 cut for its reserve. Uncapped, that leaves
    // ~52% of the army in the strike group, so a threshold above half the army
    // can never be met and the AI sits at home forever with a winning force.
    const h = makeHarness({ difficulty: 2, personality: personalityByName('Turtle') });
    for (let i = 0; i < 40; i++) {
      spawnUnit(h.world, P_AI, Faction.Soviets, 340 + (i % 10) * 4, 420 + ((i / 10) | 0) * 4,
        EntityFlag.CanAttack);
    }
    h.step(offensiveGateTicks(2) + 240);
    const i = h.brain.intent();
    expect(i.army).toBeGreaterThanOrEqual(i.waveThreshold + 2);
    expect(i.strike).toBeGreaterThanOrEqual(i.waveThreshold);
    expect(i.reserve).toBeGreaterThanOrEqual(2);
    expect(i.posture).toBe('attacking');
  });

  it('spends its surplus while saving for the next opening step', () => {
    // The opening wants a 2000-credit refinery. With 10000 banked the AI must
    // still be putting cheap units out, not sitting on the pile.
    const h = makeHarness({ production: true, factories: true, difficulty: 3 });
    h.step(900);
    const bought = h.log.filter((l) => {
      const f = l.split('|');
      return f[0] === String(CommandKind.ProductionStart) && (f[4] === '2' || f[4] === '3');
    });
    expect(bought.length).toBeGreaterThan(0);
  });

  it('rate-limits the rally nudge instead of burning its whole budget on it', () => {
    // Nothing moves in this harness, so every striker stays idle forever. An
    // un-cooled gather would re-order them on every squad tick (5 Hz).
    const h = makeHarness({ difficulty: 3 });
    for (let i = 0; i < 8; i++) {
      spawnUnit(h.world, P_AI, Faction.Soviets, 300 + i * 4, 300, EntityFlag.CanAttack);
    }
    h.step(600);
    const moves = h.log.filter((l) => {
      const f = l.split('|');
      return f[0] === String(CommandKind.Order) && f[2] === String(OrderKind.Move);
    });
    // 600 ticks / reissueTicks(45) is 13 opportunities, plus scouting nudges.
    expect(moves.length).toBeLessThan(25);
  });
});

describe('AiBrain — determinism', () => {
  it('produces an identical command stream from the same seed', () => {
    const a = makeHarness({ seed: 4242, production: true, factories: true });
    const b = makeHarness({ seed: 4242, production: true, factories: true });
    a.step(1800);
    b.step(1800);
    expect(a.log.length).toBeGreaterThan(10);
    expect(a.log).toEqual(b.log);
  });

  it('gives different seeds different play', () => {
    const a = makeHarness({ seed: 1, production: true, factories: true });
    const b = makeHarness({ seed: 999983, production: true, factories: true });
    a.step(1800);
    b.step(1800);
    expect(a.log).not.toEqual(b.log);
  });
});

describe('AiDirector', () => {
  it('creates exactly one brain per non-human player and is idempotent', () => {
    const world = new World();
    const channels = new Channels();
    world.addPlayer(Faction.Allies, 'Commander', true, true);
    world.addPlayer(Faction.Soviets, 'Opponent', false, false);

    const d = new AiDirector(world, channels);
    d.rebuild(1);
    expect(d.brains.length).toBe(1);
    expect(d.brains[0].player).toBe(P_AI);

    d.rebuild(1);
    expect(d.brains.length).toBe(1);

    // Gaia is created non-human and non-local by ScenarioBuilder. It must NOT
    // get a brain: it owns the trees.
    world.addPlayer(Faction.Neutral, 'Gaia', false, false);
    d.rebuild(1);
    expect(d.brains.length).toBe(1);

    world.addPlayer(Faction.Allies, 'Second AI', false, false);
    d.rebuild(1);
    expect(d.brains.length).toBe(2);
    // Sorted, so RNG stream assignment is machine-independent.
    expect(d.brains.map((b) => b.player as number)).toEqual([1, 3]);

    d.dispose();
    expect(channels.events.totalListeners()).toBe(0);
  });

  it('publishes the economic handicap rather than applying it', () => {
    const h = makeHarness({ difficulty: 3 });
    const before = h.world.player(P_AI).credits;
    expect(h.brain.resourceBonus).toBeGreaterThan(1);
    h.step(300);
    expect(h.world.player(P_AI).credits).toBe(before);
  });
});

/* ========================================================================== */
/* Integration — the real scenario, the real production module, the real AI    */
/*                                                                            */
/* Everything above stubs the world around the brain. This block does not: it  */
/* boots the actual skirmish fixture, the actual ProductionCatalog and the     */
/* actual ProductionService, and then asks whether the opponent plays. It is   */
/* the test that catches an integration break between three modules that are   */
/* being written in parallel, which no amount of unit testing can.             */
/* ========================================================================== */

describe('AI integration — real scenario + real production', () => {
  it('plays a real opening: queues, places, and grows its base', async () => {
    const { buildScenario, clearScenario } = await import('../src/game/Scenarios');
    const { ProductionService, createCatalog, BuildKind } = await import('../src/sim/Production');
    const { evaluatePlacement, makePlacementReport } = await import('../src/sim/Placement');

    const world = new World();
    const channels = new Channels();
    world.addPlayer(Faction.Allies, 'Commander', true, true);
    world.addPlayer(Faction.Soviets, 'Opponent', false, false);

    // START CONDITION `base`, explicitly. This block is about the seam between
    // the AI, the production module and the scenario, and it drives exactly two
    // systems — production and the AI. The default `mcv` opening needs a THIRD
    // (whatever executes `OrderKind.Deploy`), so under it the brain would
    // correctly issue a Deploy order that nothing in this test can carry out,
    // and "the AI grew its base" would fail for a reason that is not about the
    // AI at all. The MCV opening has its own coverage in
    // `tests/match-start.spec.ts`.
    const spec = buildScenario(world, 'skirmish', 4242, { start: 'base' });
    expect(spec.entityCount).toBeGreaterThan(0);

    const { catalog } = await createCatalog();
    const service = new ProductionService(world, channels, catalog);

    // The same oracle `ai.system.ts` builds, assembled by hand so this test
    // does not need `ctx()` or a GL context.
    const avail: AvailabilityResult = { ok: false, reason: '', capped: false };
    const report = makePlacementReport();
    const oracle: ProductionOracle = {
      factsFor(key) {
        const e = catalog.byKey(key);
        return e === null ? null : {
          publicId: e.publicId, isBuilding: e.kind === BuildKind.Building, tab: e.tab,
          cost: e.cost, buildTimeSec: e.buildTime, power: e.power,
          footprintW: e.footprintW, footprintH: e.footprintH,
          prereqs: e.prereqs, faction: e.faction, buildable: e.buildable,
        };
      },
      available: (p, id) => service.availability(p as PlayerId, id, avail).ok,
      reason: (p, id) => {
        const r = service.availability(p as PlayerId, id, avail);
        return r.ok ? '' : r.reason;
      },
      // The oracle this test hand-assembles must mirror `ai.system.ts` exactly,
      // including this: without it the brain reports "You already have a War
      // Commissar" as the reason it is stuck, forever, from the moment its
      // commander walks out of the barracks.
      atCap: (p, id) => service.availability(p as PlayerId, id, avail).capped,
      placeable: (p, id, cx, cz) => {
        const entry = catalog.resolve(id, true);
        return entry === null
          ? false
          : evaluatePlacement(world, p as PlayerId, entry, cx, cz, report).ok;
      },
    };

    const director = new AiDirector(world, channels);
    expect(director.bindProduction(oracle)).toBeGreaterThan(15);
    director.rebuild(4242);
    // Gaia is a player by now (the scenario owns trees through it) and must
    // still not have a brain.
    expect(world.players.length).toBeGreaterThan(2);
    expect(director.brains.length).toBe(1);

    const brain = director.brains[0];
    const before = brain.intent();
    const rng = new Rng(11);

    // Two minutes of simulated time, production and AI on their real phases.
    for (let tick = 1; tick <= 3600; tick++) {
      world.tick = tick;
      world.time = tick * SIM_DT;
      channels.setTick(tick);
      const s = simCtx(tick, rng);
      service.tick(s);      // Phase.Production (200) — drains the command bus
      director.tick(s);     // Phase.AI (400)
    }

    const after = brain.intent();
    // The diagnostic exists precisely so a failure here is readable.
    expect(after.blocked, `AI reported: ${after.blocked}`).toBe('');
    expect(after.commandsIssued).toBeGreaterThan(0);

    const structuresBefore = Object.values(before.structures).reduce((a, b) => a + b, 0);
    const structuresAfter = Object.values(after.structures).reduce((a, b) => a + b, 0);
    expect(structuresAfter).toBeGreaterThan(structuresBefore);
    // It spent money doing it.
    expect(after.credits).toBeLessThan(before.credits);

    clearScenario();
  });
});
