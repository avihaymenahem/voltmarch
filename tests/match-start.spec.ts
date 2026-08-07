/**
 * ============================================================================
 * tests/match-start.spec.ts — HOW A MATCH OPENS
 * ============================================================================
 * The reported defect: "why games always start pre seeded? why arent we
 * beginning from scratch?" — and it was real. `skirmish` inherited its premise
 * from the screenshot fixtures around it (`?shot=allied-base` and friends are
 * posed photographs of finished bases, and must stay that way), so both players
 * began every match with twenty-five structures already standing. That deletes
 * the opening of an RTS: build order as a skill, where to site the yard, the
 * economic ramp, scouting before committing.
 *
 * FOUR THINGS ARE PINNED HERE, and each of them is a way the fix could rot:
 *
 *   1. THE OPENING ITSELF. `mcv` is the default, and it spawns exactly one
 *      construction vehicle plus the right escort for each of the four armies,
 *      and NO structures.
 *   2. THE FIXTURES ARE UNTOUCHED. `tools/shoot.mjs` captures 12/12, so every
 *      frozen plan is still pre-built and the option cannot reach it.
 *   3. NOTHING ON THE PATH IS GATED. `ScenarioBuilder.spawnUnit` SKIPS a locked
 *      def rather than substituting one, so a progression tag anywhere on the
 *      route from the vehicle to a working economy would silently produce an
 *      army that never arrives.
 *   4. THE AI ACTUALLY DEPLOYS. This is the one most likely to be quietly
 *      broken: an AI that starts with an MCV and never unfolds it does nothing
 *      for the whole match, and the game looks completely fine right up until
 *      you notice you are unopposed. The last block drives a real brain from a
 *      bare construction vehicle to a working economy on every faction.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';

import { Channels } from '../src/core/events';
import { World } from '../src/core/world';
import {
  CommandKind, EntityFlag, EntityKind, Faction, NONE, OrderKind, UnitState,
} from '../src/core/types';
import type {
  Command, EntityId, IOreField, IRng, PlayerId, SimContext,
} from '../src/core/types';
import { CELL, MAP_CELLS, SIM_DT } from '../src/core/config';
import { Rng, cellToWorld, clampCell, worldToCell } from '../src/core/math';

import {
  SCENARIO_NAMES, START_CONDITIONS, START_CONDITION_DEFAULT,
  buildScenario, clearScenario, planScenario, resolveStartCondition,
  setPlannedStart, startForceFor, startSpots,
  type StartCondition,
} from '../src/game/Scenarios';

import { AiBrain } from '../src/sim/AI';
import {
  AI_DEPLOY, BuildCatalog, BuildRole, openingFor,
} from '../src/sim/AIStrategy';
import type { CatalogEntry, DefLookup } from '../src/sim/AIStrategy';

import { BuildKind, ProductionCatalog } from '../src/sim/Production';
import {
  MCV_MIN_CREDITS, clampCreditsFor, creditOptionsFor,
} from '../src/shell/SkirmishSetup';
import { CREDIT_OPTIONS } from '../src/shell/settings-store';

import { DEF_TABLES, UNLOCK_TAGS } from '../src/data/Defs';

/* ==========================================================================
 * SHARED HELPERS
 * ========================================================================== */

const P_HUMAN = 0 as PlayerId;
const P_AI = 1 as PlayerId;

/** The four playable armies, in faction-id order. */
const ARMIES: readonly Faction[] = [
  Faction.Allies, Faction.Soviets, Faction.Meridian, Faction.Reclaim,
];

const ARMY_NAMES: Readonly<Record<number, string>> = {
  [Faction.Allies]: 'Allies',
  [Faction.Soviets]: 'Soviets',
  [Faction.Meridian]: 'Meridian',
  [Faction.Reclaim]: 'Reclamation',
};

function simCtx(tick: number, rng: IRng): SimContext {
  return { dt: SIM_DT, tick, time: tick * SIM_DT, rng };
}

/** A two-army world with no terrain module: `FlatTerrain`, everything open. */
function makeWorld(human: Faction, ai: Faction): World {
  const world = new World();
  world.addPlayer(human, 'Commander', true, true);
  world.addPlayer(ai, 'Opponent', false, false);
  return world;
}

/** Count what a player owns, by EntityKind. */
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

/** Every def key a player owns, resolved through the real def tables. */
function ownedKeys(world: World, owner: PlayerId): string[] {
  const st = world.store;
  const out: string[] = [];
  for (let a = 0; a < st.aliveCount; a++) {
    const i = st.alive[a];
    if (st.owner[i] !== (owner as number)) continue;
    const id = st.defId[i];
    if (id < 0) continue;
    const key = st.kind[i] === EntityKind.Building
      ? DEF_TABLES.buildings[id]?.key
      : DEF_TABLES.units[id]?.key;
    if (key !== undefined) out.push(key);
  }
  return out;
}

/* ==========================================================================
 * 1. THE START CONDITION AS A VALUE
 * ========================================================================== */

describe('the start condition', () => {
  it('defaults to the construction vehicle — the real game', () => {
    expect(START_CONDITION_DEFAULT).toBe('mcv');
    expect(START_CONDITIONS).toContain('mcv');
    expect(START_CONDITIONS).toContain('base');
  });

  it('parses what a human would plausibly type, and falls back loudly', () => {
    expect(resolveStartCondition('mcv')).toBe('mcv');
    expect(resolveStartCondition('MCV')).toBe('mcv');
    expect(resolveStartCondition('base')).toBe('base');
    expect(resolveStartCondition('Pre-built')).toBe('base');
    expect(resolveStartCondition('vehicle')).toBe('mcv');
    // Nonsense degrades to the caller's fallback rather than throwing.
    expect(resolveStartCondition('banana')).toBe('mcv');
    expect(resolveStartCondition('banana', 'base')).toBe('base');
    expect(resolveStartCondition(null)).toBe('mcv');
    expect(resolveStartCondition('')).toBe('mcv');
  });
});

describe('who gets to choose the opening', () => {
  it('gives skirmish the MCV opening by default', () => {
    setPlannedStart(null);
    expect(planScenario('skirmish').start).toBe('mcv');
    expect(planScenario(null).start).toBe('mcv');
  });

  it('lets ?start= say otherwise', () => {
    setPlannedStart(null);
    expect(planScenario('skirmish', null, null, 'base').start).toBe('base');
    expect(planScenario('skirmish', null, null, 'mcv').start).toBe('mcv');
  });

  it('lets the lobby push a standing choice in', () => {
    setPlannedStart('base');
    expect(planScenario('skirmish').start).toBe('base');
    setPlannedStart('mcv');
    expect(planScenario('skirmish').start).toBe('mcv');
    setPlannedStart(null);
  });

  it('forces a pre-built base for an opponent-less boot, above ?start=', () => {
    // `?ai=off` is written by exactly one thing: the title-screen backdrop.
    // It has to outrank the flag, because the backdrop inherits the query
    // string of the match the player just quit — otherwise quitting an MCV
    // match leaves the menu orbiting an empty field.
    setPlannedStart('mcv');
    expect(planScenario('skirmish', null, null, null, 'off').start).toBe('base');
    expect(planScenario('skirmish', null, null, 'mcv', 'off').start).toBe('base');
    // Any other opponent setting leaves the choice alone.
    expect(planScenario('skirmish', null, null, null, 'brutal').start).toBe('mcv');
    setPlannedStart(null);
  });

  it('never lets anything talk a shot fixture out of being pre-built', () => {
    setPlannedStart('mcv');
    for (const name of SCENARIO_NAMES) {
      if (name === 'skirmish') continue;
      expect(planScenario(name).start, name).toBe('base');
      expect(planScenario(name, null, null, 'mcv').start, name).toBe('base');
    }
    setPlannedStart(null);
  });
});

/* ==========================================================================
 * 2. THE OPENING ON THE MAP
 * ========================================================================== */

describe('the MCV opening', () => {
  for (const faction of ARMIES) {
    it(`spawns one construction vehicle and the ${ARMY_NAMES[faction]} escort`, () => {
      const world = makeWorld(faction, Faction.Soviets);
      try {
        const spec = buildScenario(world, 'skirmish', 4242, { start: 'mcv' });
        expect(spec.start).toBe('mcv');

        const kinds = ownedByKind(world, P_HUMAN);
        // The whole point: no base.
        expect(kinds.get(EntityKind.Building) ?? 0, 'structures').toBe(0);

        const force = startForceFor(faction);
        expect(kinds.get(EntityKind.Infantry) ?? 0, 'infantry').toBe(force.infantry);
        // The MCV is a vehicle too, hence the +1.
        expect(kinds.get(EntityKind.Vehicle) ?? 0, 'vehicles').toBe(force.vehicles + 1);
      } finally {
        clearScenario();
      }
    });
  }

  it('gives the opposing army its own escort too', () => {
    const world = makeWorld(Faction.Allies, Faction.Reclaim);
    try {
      buildScenario(world, 'skirmish', 4242, { start: 'mcv' });
      const ai = ownedByKind(world, P_AI);
      const force = startForceFor(Faction.Reclaim);
      expect(ai.get(EntityKind.Building) ?? 0).toBe(0);
      expect(ai.get(EntityKind.Infantry) ?? 0).toBe(force.infantry);
      expect(ai.get(EntityKind.Vehicle) ?? 0).toBe(force.vehicles + 1);
    } finally {
      clearScenario();
    }
  });

  it('spawns the construction vehicle each army actually fields', async () => {
    const { resolveDefBinding, clearDefBindingCache } = await import('../src/game/Scenarios');
    clearDefBindingCache();
    const defs = await resolveDefBinding();
    const wanted: Readonly<Record<number, string>> = {
      [Faction.Allies]: 'mcv',
      [Faction.Soviets]: 'mcv',
      [Faction.Meridian]: 'mrdCarryall',
      [Faction.Reclaim]: 'rclCrawler',
    };
    for (const faction of ARMIES) {
      const world = makeWorld(faction, Faction.Allies);
      try {
        buildScenario(world, 'skirmish', 99, { start: 'mcv', defs });
        expect(ownedKeys(world, P_HUMAN), ARMY_NAMES[faction])
          .toContain(wanted[faction]);
      } finally {
        clearScenario();
      }
    }
  });

  it('still seeds the ore — the economy is earned, not deleted', () => {
    const world = makeWorld(Faction.Allies, Faction.Soviets);
    try {
      const spec = buildScenario(world, 'skirmish', 4242, { start: 'mcv' });
      expect(spec.ore.length).toBe(3);
      for (const field of spec.ore) expect(field.richness).toBeGreaterThan(0);
    } finally {
      clearScenario();
    }
  });

  it('sites the two armies apart and facing each other', () => {
    const spots = startSpots(256, 256, 2);
    expect(spots.length).toBe(2);
    const apart = Math.hypot(spots[0].x - spots[1].x, spots[0].z - spots[1].z);
    // Far enough that neither opening is inside the other's sight radius (the
    // longest in the game is 46 m) by a wide margin.
    expect(apart).toBeGreaterThan(120);
    // Each bearing points at the other start.
    for (let i = 0; i < 2; i++) {
      const foe = spots[(i + 1) % 2];
      const want = Math.atan2(foe.x - spots[i].x, foe.z - spots[i].z) * 180 / Math.PI;
      const diff = Math.abs(((spots[i].facingDeg - want + 540) % 360) - 180);
      expect(diff, `spot ${i} faces its opponent`).toBeLessThan(1);
    }
  });

  it('puts an ore field within a refinery run of each start', () => {
    const world = makeWorld(Faction.Allies, Faction.Soviets);
    try {
      const spec = buildScenario(world, 'skirmish', 4242, { start: 'mcv' });
      const spots = startSpots(256, 256, 2);
      for (const spot of spots) {
        let nearest = Infinity;
        for (const field of spec.ore) {
          nearest = Math.min(nearest, Math.hypot(field.x - spot.x, field.z - spot.z));
        }
        // Inside the AI's own ore search radius, so a yard deployed on the spot
        // can find and reach a field without relocating across the map.
        expect(nearest).toBeLessThan(AI_DEPLOY.oreSearchCells * CELL);
      }
    } finally {
      clearScenario();
    }
  });

  it('opens the match looking at the local player, not at the map centre', () => {
    const world = makeWorld(Faction.Allies, Faction.Soviets);
    try {
      const spec = buildScenario(world, 'skirmish', 4242, { start: 'mcv' });

      // Against the LOCAL PLAYER'S OWN UNIT, not against `startSpots(...)[0]`.
      // This used to pin spot 0, which encoded the very assumption that made
      // every match open in the same corner: since `rotateStarts`, the human is
      // not always in slot 0, and asserting the index rather than the ownership
      // would fail for exactly the seeds the rotation exists to produce.
      const st = world.store;
      let mine = -1;
      for (let i = 0; i < st.count; i++) {
        if ((st.flags[i] & EntityFlag.Alive) === 0) continue;
        if (st.owner[i] !== (P_HUMAN as number)) continue;
        if (st.kind[i] !== EntityKind.Vehicle) continue;
        mine = i;
        break;
      }
      expect(mine, 'the local player must have a starting vehicle').toBeGreaterThanOrEqual(0);
      expect(
        Math.hypot(spec.camera.x - st.posX[mine], spec.camera.z - st.posZ[mine]),
        'the opening camera must frame the human\'s own start, whichever spot it landed in',
      ).toBeLessThan(20);
    } finally {
      clearScenario();
    }
  });

  it('hands the local player their construction vehicle already selected', () => {
    const world = makeWorld(Faction.Allies, Faction.Soviets);
    try {
      buildScenario(world, 'skirmish', 4242, { start: 'mcv' });
      expect(world.selection.count).toBe(1);
      const i = world.store.index(world.selection.ids[0] as EntityId);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(world.store.owner[i]).toBe(P_HUMAN as number);
      expect(world.store.kind[i]).toBe(EntityKind.Vehicle);
    } finally {
      clearScenario();
    }
  });
});

/* ==========================================================================
 * 3. THE PRE-BUILT OPTION, AND THE FIXTURES
 * ========================================================================== */

describe('the pre-built opening', () => {
  it('still builds two complete bases', () => {
    const world = makeWorld(Faction.Allies, Faction.Soviets);
    try {
      const spec = buildScenario(world, 'skirmish', 4242, { start: 'base' });
      expect(spec.start).toBe('base');
      for (const p of [P_HUMAN, P_AI]) {
        const kinds = ownedByKind(world, p);
        expect(kinds.get(EntityKind.Building) ?? 0, `player ${p} structures`)
          .toBeGreaterThan(5);
      }
      expect(spec.ore.length).toBe(3);
    } finally {
      clearScenario();
    }
  });

  it('is what every frozen fixture gets, whatever the option says', () => {
    for (const name of SCENARIO_NAMES) {
      if (name === 'skirmish') continue;
      const world = makeWorld(Faction.Allies, Faction.Soviets);
      try {
        // Asking for `mcv` must change NOTHING about a posed photograph.
        const spec = buildScenario(world, name, 4242, { start: 'mcv' });
        expect(spec.start, name).toBe('base');
      } finally {
        clearScenario();
      }
    }
  });

  it('leaves the two base fixtures byte-for-byte as `tools/shoot.mjs` framed them', () => {
    // Same seed, same entity count, same camera, with and without the option:
    // the fixture is the shot harness's contract and the option must not exist
    // as far as it is concerned.
    for (const name of ['allied-base', 'soviet-base', 'battle']) {
      const a = makeWorld(Faction.Allies, Faction.Soviets);
      const plain = { count: 0, x: 0, z: 0 };
      try {
        const spec = buildScenario(a, name, 4242);
        plain.count = spec.entityCount;
        plain.x = spec.camera.x;
        plain.z = spec.camera.z;
      } finally {
        clearScenario();
      }

      const b = makeWorld(Faction.Allies, Faction.Soviets);
      try {
        const spec = buildScenario(b, name, 4242, { start: 'mcv' });
        expect(spec.entityCount, `${name} entity count`).toBe(plain.count);
        expect(spec.camera.x, `${name} camera x`).toBe(plain.x);
        expect(spec.camera.z, `${name} camera z`).toBe(plain.z);
      } finally {
        clearScenario();
      }
    }
  });
});

/* ==========================================================================
 * 4. NOTHING ON THE OPENING PATH IS GATED
 *
 * A fresh profile must be able to deploy and build a working economy. The
 * failure mode this guards is silent by construction: `spawnUnit` SKIPS a
 * locked def rather than substituting one, so a tagged escort simply does not
 * arrive and nothing is logged.
 * ========================================================================== */

/** The three construction vehicles, one per tech tree. */
const MCV_KEYS: readonly string[] = ['mcv', 'mrdCarryall', 'rclCrawler'];

/** `DEF_TABLES.unitByKey` maps a key to an INDEX, not to a def. */
function unitDef(key: string) {
  const id = DEF_TABLES.unitByKey.get(key);
  expect(id, `no unit def for ${key}`).toBeDefined();
  return DEF_TABLES.units[id as number];
}

describe('the progression gate never touches the opening', () => {
  /** Everything between "one construction vehicle" and "a working economy". */
  const OPENING_PATH: readonly string[] = [
    // The vehicle, per army.
    'mcv', 'mrdCarryall', 'rclCrawler',
    // What it unfolds into.
    'conyard', 'mrdConclave', 'rclFoundry',
    // Power.
    'powerPlant', 'mrdSolarArray', 'rclFurnace',
    // The economy.
    'refinery', 'mrdCistern', 'rclSorter',
    'harvester', 'mrdCollector', 'rclScrapper',
    // The two producers, needed to replace a vehicle that dies.
    'barracks', 'mrdChapterhouse', 'rclRookery',
    'warFactory', 'mrdForgeyard', 'rclBreakerYard',
    // The escort `START_FORCE` spawns, via the shared role keys.
    'gi', 'conscript', 'mrdWayfarer', 'rclPicker',
    'grizzly', 'rhino', 'mrdSolarch', 'rclGrinder',
  ];

  it('leaves every def on the path ungated', () => {
    for (const key of OPENING_PATH) {
      expect(UNLOCK_TAGS[key], `${key} must be available on a fresh profile`)
        .toBeUndefined();
    }
  });

  it('lets a fresh profile rebuild a construction vehicle it lost', () => {
    // The prereq chain of every MCV must itself be ungated, or losing the yard
    // on a new profile is unrecoverable.
    for (const key of MCV_KEYS) {
      const def = unitDef(key);
      for (const prereq of def.prereqs) {
        expect(UNLOCK_TAGS[prereq], `${key} needs ungated ${prereq}`).toBeUndefined();
      }
    }
  });

  it('has every construction vehicle unfold into a real construction yard', () => {
    for (const key of MCV_KEYS) {
      const def = unitDef(key);
      expect(def.deploysInto, key).toBeTruthy();
      const into = DEF_TABLES.buildingByKey.get(def.deploysInto as string);
      expect(into, `${key} -> ${String(def.deploysInto)}`).toBeDefined();
      const target = DEF_TABLES.buildings[into as number];
      // The def's own `flags` column is deliberately 0 for the shared army —
      // `ScenarioBuilder.spawnBuilding` ORs the fallback row's bits on top, so
      // the authoritative answer to "is this a Construction Yard" is the role
      // the AI's catalog assigns it.
      expect(new BuildCatalog().get(target.key)?.role, `${target.key} is a builder`)
        .toBe(BuildRole.Builder);
      if (def.faction !== Faction.Neutral) {
        expect(target.faction, `${key} unfolds into its own army's yard`).toBe(def.faction);
      }
    }
  });

  it('describes what the vehicle actually does', () => {
    // "Deploys into a SECOND base" was the tell that the model assumed you
    // already had the first one.
    for (const key of MCV_KEYS) {
      expect(unitDef(key).blurb.toLowerCase(), key).not.toContain('second');
    }
  });
});

/* ==========================================================================
 * 5. THE AI DEPLOYS
 *
 * The failure this block exists for: an AI that begins with an MCV and never
 * unfolds it does nothing at all for the whole match, and there is no symptom
 * — the frame rate is fine, the HUD is correct, no error is logged. You find
 * out when you notice nobody attacked you.
 * ========================================================================== */

/** An ore field that is one solid patch of cells around a centre. */
class PatchOre implements IOreField {
  constructor(
    private readonly cx: number,
    private readonly cz: number,
    private readonly r: number,
  ) {}

  private inside(cx: number, cz: number): boolean {
    const dx = cx - this.cx;
    const dz = cz - this.cz;
    return dx * dx + dz * dz <= this.r * this.r;
  }

  oreAt(cx: number, cz: number): number { return this.inside(cx, cz) ? 500 : 0; }
  takeOre(cx: number, cz: number, amount: number): number {
    return this.inside(cx, cz) ? amount : 0;
  }
  oreValue(): number { return 1; }
  findOre(cx: number, cz: number, maxCells: number, out: Int32Array): boolean {
    // Nearest cell of the patch to (cx,cz), which for a disc is a straight
    // clamp along the line to the centre.
    const dx = this.cx - cx;
    const dz = this.cz - cz;
    const len = Math.hypot(dx, dz);
    if (len > maxCells + this.r) return false;
    if (len <= this.r) { out[0] = cx; out[1] = cz; return true; }
    out[0] = clampCell(Math.round(cx + (dx / len) * (len - this.r)));
    out[1] = clampCell(Math.round(cz + (dz / len) * (len - this.r)));
    return true;
  }
  totalOre(): number { return 1e6; }
}

/** Synthetic def ids for every catalog key. The state before `src/data` binds. */
function syntheticBinding(catalog: BuildCatalog): DefLookup {
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

interface OpeningRun {
  world: World;
  brain: AiBrain;
  /** Every command the brain issued, as `kind|order|x|z` strings. */
  log: string[];
  step(ticks: number): void;
}

interface OpeningOptions {
  /**
   * Refuse every Deploy aimed at the first N DISTINCT sites, standing in for
   * ground the order handler rejects. Per-site rather than per-order on
   * purpose: re-issuing at the same blocked spot is the failure being tested,
   * so a counter that a retry could exhaust would pass without the AI ever
   * relocating.
   */
  refuseSites?: number;
  /** Skip the fake deploy handler entirely: nothing ever unfolds. */
  neverDeploy?: boolean;
}

/**
 * A brain that owns exactly one construction vehicle, plus the smallest
 * plausible stand-ins for the three modules it talks to.
 *
 * THE DEPLOY HANDLER IS A STAND-IN, DELIBERATELY. `OrderKind.Deploy` is
 * executed by a sim module outside this workstream, so what is asserted here is
 * the AI's half of the contract — that it issues the order, at a sensible
 * place, and relocates when the ground refuses — plus what follows once
 * SOMETHING honours it. Both halves are needed and only one is ours.
 */
function runOpening(faction: Faction, options: OpeningOptions = {}): OpeningRun {
  const world = makeWorld(Faction.Allies, faction);
  const channels = new Channels();
  const st = world.store;

  // Ore ~48 m north-west of the vehicle, which is roughly what the real
  // skirmish layout puts between a start spot and its field: close enough to
  // drive to, far enough that the AI has to actually choose a spot.
  const startX = 300;
  const startZ = 300;
  world.ore = new PatchOre(clampCell(worldToCell(startX) - 12), clampCell(worldToCell(startZ) - 12), 4);

  const ai = world.player(P_AI);
  ai.credits = 20000;
  ai.storageMax = 40000;
  ai.aiDifficulty = 3;

  // The whole army: one construction vehicle.
  const mcv = st.alloc(EntityKind.Vehicle, -1, P_AI, faction, startX, 0, startZ, 0);
  {
    const i = st.index(mcv);
    st.flags[i] |= EntityFlag.CanMove | EntityFlag.ProvidesVision;
    st.hp[i] = 1000;
    st.maxHp[i] = 1000;
    st.maxSpeed[i] = 4.5;
    st.radius[i] = 2.5;
  }

  const catalog = new BuildCatalog();
  catalog.bind(syntheticBinding(catalog));
  const brain = new AiBrain(world, channels.commands, catalog, P_AI, 991);
  brain.attach(channels.events);

  const log: string[] = [];
  const rng = new Rng(3);
  let tick = 0;

  /* -- fake movement ---------------------------------------------------- */
  const moveX = new Map<number, number>();
  const moveZ = new Map<number, number>();

  /* -- fake production --------------------------------------------------- */
  interface Item { defId: number; isBuilding: boolean; ticks: number; ready: boolean }
  const queues: Item[][] = [[], [], [], []];

  function place(entry: CatalogEntry, cx: number, cz: number): void {
    const x = cellToWorld(cx) + (entry.footprintW - 1) * CELL * 0.5;
    const z = cellToWorld(cz) + (entry.footprintH - 1) * CELL * 0.5;
    const id = st.alloc(EntityKind.Building, entry.defId, P_AI, faction, x, 0, z, 0);
    if (id === NONE) return;
    const i = st.index(id);
    st.flags[i] |= EntityFlag.BlocksNav | flagsFor(entry.role);
    st.footprintW[i] = entry.footprintW;
    st.footprintH[i] = entry.footprintH;
    st.powerDraw[i] = entry.power;
    st.hp[i] = 1000;
    st.maxHp[i] = 1000;
    st.buildProgress[i] = 1;
    if (entry.power > 0) ai.powerProduced += entry.power;
    else ai.powerConsumed += -entry.power;
    world.terrain.markOccupied(cx, cz, entry.footprintW, entry.footprintH, id);
    channels.events.emit('building:completed', { id, defId: entry.defId, player: P_AI, x, z } as never);
  }

  function spawnUnitFor(entry: CatalogEntry): void {
    const i0 = st.index(brainAnchor());
    const ax = i0 >= 0 ? st.posX[i0] + 6 : startX;
    const az = i0 >= 0 ? st.posZ[i0] + 6 : startZ;
    const id = st.alloc(
      entry.tab === 2 ? EntityKind.Infantry : EntityKind.Vehicle,
      entry.defId, P_AI, faction, ax, 0, az, 0,
    );
    if (id === NONE) return;
    const i = st.index(id);
    st.flags[i] |= EntityFlag.CanMove | EntityFlag.ProvidesVision
      | (entry.role === BuildRole.Harvester ? EntityFlag.IsHarvester : EntityFlag.CanAttack);
    st.hp[i] = 200;
    st.maxHp[i] = 200;
    st.maxSpeed[i] = 5;
    st.radius[i] = 1.5;
    st.cargoMax[i] = entry.role === BuildRole.Harvester ? 700 : 0;
  }

  /** Somewhere to drop a produced unit: the yard if there is one. */
  function brainAnchor(): EntityId {
    for (let a = 0; a < st.aliveCount; a++) {
      const i = st.alive[a];
      if (st.owner[i] !== (P_AI as number)) continue;
      if ((st.flags[i] & EntityFlag.IsBuilder) !== 0) return st.handleOf(i);
    }
    return NONE;
  }

  function flagsFor(role: BuildRole): number {
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

  /* -- the stand-in deploy handler --------------------------------------- */
  const refused = new Set<string>();
  function handleDeploy(c: Command): void {
    if (options.neverDeploy === true) return;
    const site = `${Math.round(c.x)}|${Math.round(c.z)}`;
    if (refused.has(site)) return;
    if (refused.size < (options.refuseSites ?? 0)) {
      // The ground refuses, permanently. The real handler would answer
      // `FeedbackKind.CannotDeployHere`; there is no event carrying it, so the
      // AI has to notice by timeout — which is exactly what is under test.
      refused.add(site);
      return;
    }
    for (let k = 0; k < c.entityCount; k++) {
      const i = st.index(c.entities[k] as EntityId);
      if (i < 0) continue;
      const entry = catalog.forRole(BuildRole.Builder, world.player(P_AI).faction);
      if (entry === undefined) return;
      const cx = clampCell(worldToCell(c.x) - ((entry.footprintW / 2) | 0));
      const cz = clampCell(worldToCell(c.z) - ((entry.footprintH / 2) | 0));
      st.markDead(st.handleOf(i));
      place(entry, cx, cz);
    }
  }

  function drain(): void {
    channels.commands.drain((c) => {
      log.push([c.kind, c.order, Math.round(c.x), Math.round(c.z)].join('|'));
      if (c.kind === CommandKind.Order) {
        if (c.order === OrderKind.Deploy) { handleDeploy(c); return; }
        if (c.order === OrderKind.Move || c.order === OrderKind.AttackMove) {
          for (let k = 0; k < c.entityCount; k++) {
            moveX.set(c.entities[k], c.x);
            moveZ.set(c.entities[k], c.z);
          }
        }
        return;
      }
      if (c.kind === CommandKind.ProductionStart) {
        const tab = c.tab as number;
        if (queues[tab].length >= 2) return;
        const entry = tab <= 1 ? catalog.entryForBuilding(c.defId) : catalog.entryForUnit(c.defId);
        if (entry === undefined) return;
        if (ai.credits < entry.cost) return;
        ai.credits -= entry.cost;
        queues[tab].push({ defId: c.defId, isBuilding: entry.isBuilding, ticks: 20, ready: false });
        ai.queues[tab].items.push({
          defId: c.defId, isBuilding: entry.isBuilding, progress: 0, spent: entry.cost,
          cost: entry.cost, ready: false, onHold: false,
        });
        channels.events.emit('production:started', {
          player: P_AI, tab, defId: c.defId, isBuilding: entry.isBuilding, cost: entry.cost,
        } as never);
        return;
      }
      if (c.kind === CommandKind.PlaceBuilding) {
        for (let tab = 0; tab < 4; tab++) {
          const q = queues[tab].findIndex((it) => it.defId === c.defId && it.ready);
          if (q < 0) continue;
          const entry = catalog.entryForBuilding(c.defId);
          if (entry === undefined) return;
          queues[tab].splice(q, 1);
          ai.queues[tab].items.shift();
          place(entry, c.cx, c.cz);
          return;
        }
      }
    });
  }

  function advance(): void {
    // Movement: walk everything that has been ordered somewhere.
    for (const [handle, tx] of moveX) {
      const i = st.index(handle as EntityId);
      if (i < 0) { moveX.delete(handle); moveZ.delete(handle); continue; }
      const tz = moveZ.get(handle) ?? st.posZ[i];
      const dx = tx - st.posX[i];
      const dz = tz - st.posZ[i];
      const len = Math.hypot(dx, dz);
      const step = st.maxSpeed[i] * SIM_DT;
      if (len <= step) {
        st.posX[i] = tx; st.posZ[i] = tz;
        st.state[i] = UnitState.Idle;
        moveX.delete(handle); moveZ.delete(handle);
      } else {
        st.posX[i] += (dx / len) * step;
        st.posZ[i] += (dz / len) * step;
        st.state[i] = UnitState.Moving;
      }
      st.cellX[i] = clampCell(worldToCell(st.posX[i]));
      st.cellZ[i] = clampCell(worldToCell(st.posZ[i]));
    }

    // Production.
    for (let tab = 0; tab < 4; tab++) {
      const head = queues[tab][0];
      if (head === undefined || head.ready) continue;
      if (--head.ticks > 0) continue;
      head.ready = true;
      const entry = head.isBuilding
        ? catalog.entryForBuilding(head.defId)
        : catalog.entryForUnit(head.defId);
      if (entry === undefined) { queues[tab].shift(); ai.queues[tab].items.shift(); continue; }
      if (head.isBuilding) {
        channels.events.emit('production:ready', {
          player: P_AI, tab, defId: head.defId, isBuilding: true,
        } as never);
      } else {
        queues[tab].shift();
        ai.queues[tab].items.shift();
        spawnUnitFor(entry);
      }
    }
  }

  return {
    world,
    brain,
    log,
    step(ticks: number): void {
      for (let n = 0; n < ticks; n++) {
        tick++;
        world.tick = tick;
        world.time = tick * SIM_DT;
        channels.commands.tick = tick;
        brain.tick(simCtx(tick, rng));
        drain();
        advance();
        world.spatial.rebuild();
      }
    },
  };
}

/** Every Deploy command the run logged. */
function deployOrders(run: OpeningRun): string[] {
  const prefix = `${CommandKind.Order}|${OrderKind.Deploy}|`;
  return run.log.filter((l) => l.startsWith(prefix));
}

describe('the AI opens from a construction vehicle', () => {
  it('sees the vehicle it owns', () => {
    const run = runOpening(Faction.Soviets, { neverDeploy: true });
    run.step(60);
    expect(run.brain.mcvSize).toBe(1);
    expect(run.brain.mcvPending).toBe(true);
  });

  it('issues a Deploy order rather than sitting in a field', () => {
    const run = runOpening(Faction.Soviets, { neverDeploy: true });
    run.step(1200);
    expect(deployOrders(run).length, 'the AI never asked to deploy').toBeGreaterThan(0);
  });

  it('never mistakes "not deployed yet" for "my base was destroyed"', () => {
    // The old `builderId === NONE` fork read tick one of the match as the
    // crippled endgame: it would spend the whole bank on units it cannot build
    // and march its escort across the map.
    const run = runOpening(Faction.Soviets, { neverDeploy: true });
    run.step(1200);
    expect(run.brain.intent().posture).not.toBe('crippled');
    expect(run.world.player(P_AI).credits).toBe(20000);
  });

  it('sites the yard against ore, on buildable ground', () => {
    const run = runOpening(Faction.Soviets, { neverDeploy: true });
    run.step(200);
    const x = run.brain.deployTargetX;
    const z = run.brain.deployTargetZ;
    expect(x).toBeGreaterThanOrEqual(0);

    const out = new Int32Array(2);
    const found = run.world.ore.findOre(
      clampCell(worldToCell(x)), clampCell(worldToCell(z)), AI_DEPLOY.oreSearchCells, out,
    );
    expect(found, 'the site can see ore at all').toBe(true);
    const oreDist = Math.hypot(cellToWorld(out[0]) - x, cellToWorld(out[1]) - z);
    // Close enough that the refinery pays for itself, far enough that the yard
    // is not paving over the cells its own harvesters want.
    expect(oreDist).toBeLessThan(AI_DEPLOY.oreStandoff * 2.5);
    expect(oreDist).toBeGreaterThan(CELL);

    for (let cz = clampCell(worldToCell(z) - 1); cz <= worldToCell(z) + 1; cz++) {
      for (let cx = clampCell(worldToCell(x) - 1); cx <= worldToCell(x) + 1; cx++) {
        if (cx < 0 || cz < 0 || cx >= MAP_CELLS || cz >= MAP_CELLS) continue;
        expect(run.world.terrain.isBuildable(cx, cz), `${cx},${cz} buildable`).toBe(true);
      }
    }
  });

  it('relocates and retries when the ground refuses', () => {
    // The first two sites the AI picks are refused outright and stay refused,
    // exactly as blocked ground would refuse them.
    const run = runOpening(Faction.Soviets, { refuseSites: 2 });
    run.step(4000);
    const sites = new Set(deployOrders(run).map((l) => l.split('|').slice(2).join('|')));
    expect(sites.size, 'the AI kept proposing the identical blocked site').toBeGreaterThan(1);
    // And it eventually got one down.
    expect(run.brain.intent().structures.builder ?? 0).toBeGreaterThan(0);
  });

  for (const faction of ARMIES) {
    it(`reaches a working economy from scratch — ${ARMY_NAMES[faction]}`, () => {
      const run = runOpening(faction);
      run.step(5400);   // three minutes of simulated time
      const intent = run.brain.intent();

      expect(intent.structures.builder ?? 0, 'a construction yard').toBeGreaterThan(0);
      expect(intent.structures.power ?? 0, 'power').toBeGreaterThan(0);
      expect(intent.refineries, 'a refinery').toBeGreaterThan(0);
      expect(intent.harvesters, 'a harvester').toBeGreaterThan(0);
      // `blocked` is deliberately NOT asserted empty here: it also carries
      // ordinary refusals like "prismTank: prerequisites not met", which is the
      // AI correctly discovering it has not teched yet. What must never appear
      // is a refusal about the yard itself.
      expect(intent.blocked, `AI reported: ${intent.blocked}`)
        .not.toContain('construction yard');
      // And it did it with the vehicle it was given, not by magic.
      expect(run.brain.mcvSize).toBe(0);
    });
  }

  it('is deterministic: the same seed produces the same command stream', () => {
    const a = runOpening(Faction.Reclaim);
    const b = runOpening(Faction.Reclaim);
    a.step(1200);
    b.step(1200);
    expect(a.log.join('\n')).toBe(b.log.join('\n'));
  });
});

/* ==========================================================================
 * 6. THE OPENING BUILD ORDER STARTS FROM AN EMPTY BASE
 * ========================================================================== */

describe('the scripted opening assumes nothing but a yard', () => {
  for (const faction of ARMIES) {
    it(`is buildable step by step for ${ARMY_NAMES[faction]}`, () => {
      const catalog = new BuildCatalog();
      const script = openingFor(faction, 0);
      expect(script.length).toBeGreaterThan(0);

      // Walk the script the way the build layer does: a step is legal once
      // every prereq role it names is already owned. `builder` is owned from
      // the moment the vehicle unfolds and nothing else is.
      const owned = new Set<BuildRole>([BuildRole.Builder]);
      for (const step of script) {
        const entry = catalog.get(step.key);
        if (entry === undefined) continue;
        for (const prereq of entry.prereqs) {
          const dep = catalog.get(prereq);
          if (dep === undefined) continue;
          expect(
            owned.has(dep.role) || step.optional,
            `${step.key} needs ${prereq} which the script has not built yet`,
          ).toBe(true);
        }
        owned.add(entry.role);
      }
      // The script has to reach an economy on its own.
      expect(owned.has(BuildRole.Refinery), 'the opening reaches a refinery').toBe(true);
      expect(owned.has(BuildRole.WarFactory), 'the opening reaches a war factory').toBe(true);
    });
  }

  it('lets every army rebuild a construction vehicle off its war factory alone', () => {
    const catalog = new BuildCatalog();
    for (const faction of ARMIES) {
      const mcv = catalog.forRole(BuildRole.Mcv, faction);
      expect(mcv, ARMY_NAMES[faction]).toBeDefined();
      for (const prereq of mcv!.prereqs) {
        const dep = catalog.get(prereq);
        expect(dep?.role, `${mcv!.key} may not require ${prereq}`)
          .not.toBe(BuildRole.TechLab);
      }
    }
  });

  it('knows the footprint of every army\'s construction yard', () => {
    // The deploy siter needs it to test the ground; a zero footprint would make
    // every site trivially legal and the yard would land on top of a cliff.
    const catalog = new BuildCatalog();
    for (const faction of ARMIES) {
      const yard = catalog.forRole(BuildRole.Builder, faction);
      expect(yard, ARMY_NAMES[faction]).toBeDefined();
      expect(yard!.footprintW).toBeGreaterThan(0);
      expect(yard!.footprintH).toBeGreaterThan(0);
    }
  });
});

/* -- a compile-time reminder, not a runtime one ---------------------------- */
const _startConditionIsAUnion: StartCondition = START_CONDITION_DEFAULT;
void _startConditionIsAUnion;

/* ==========================================================================
 * 7. END TO END — a real brain, the real deploy service, the real production
 *    module, and one construction vehicle
 *
 * Section 5 asserts the AI's half of the contract against a stand-in handler.
 * This block removes the stand-in: `DeployService` and `ProductionService` are
 * the shipping ones, the placement rules are the shipping ones, and the only
 * thing faked is the order-writing layer (`input/Commands.ts#write`, which
 * copies a drained Command onto `orderKind/orderX/orderZ`) and movement.
 *
 * That is the seam the whole feature lives or dies on: the AI has to speak the
 * order the deploy module actually consumes, at a position the placement rules
 * actually accept.
 * ========================================================================== */

describe('a real AI unfolds a real construction vehicle', () => {
  it('turns one vehicle into a standing Construction Yard', async () => {
    const { DeployService, bindDeployTables } = await import('../src/sim/Deploy');
    const { ProductionCatalog, ProductionService, setProduction } =
      await import('../src/sim/Production');

    const world = makeWorld(Faction.Allies, Faction.Soviets);
    const channels = new Channels();
    const st = world.store;

    const catalog = new ProductionCatalog({ tables: null, unitId: {}, buildingId: {} });
    const production = new ProductionService(world, channels, catalog);
    setProduction(production);
    bindDeployTables(null);
    const deployService = new DeployService(world, channels);

    // Ore near the start, so the siter has something to anchor against.
    world.ore = new PatchOre(clampCell(worldToCell(300) - 10), clampCell(worldToCell(300) - 10), 4);

    const ai = world.player(P_AI);
    ai.credits = 10000;

    // The AI's entire army, spawned the way a factory would spawn it.
    const mcvEntry = catalog.byKey('mcv');
    expect(mcvEntry, 'no production entry for the construction vehicle').not.toBeNull();
    const mcv = production.spawnUnit(ai, mcvEntry!, 300, 300, 0);
    expect(mcv).not.toBe(NONE);

    const brain = new AiBrain(world, channels.commands, new BuildCatalog(), P_AI, 4242);
    brain.attach(channels.events);

    const moveTo = new Map<number, [number, number]>();
    const rng = new Rng(5);

    for (let tick = 1; tick <= 2400; tick++) {
      world.tick = tick;
      world.time = tick * SIM_DT;
      channels.commands.tick = tick;
      world.spatial.rebuild();
      const s = simCtx(tick, rng);

      brain.tick(s);

      // Stand in for `input/Commands.ts#write`: copy the order onto the entity.
      channels.commands.drain((c) => {
        if (c.kind !== CommandKind.Order) return;
        for (let k = 0; k < c.entityCount; k++) {
          const i = st.index(c.entities[k] as EntityId);
          if (i < 0) continue;
          if (c.order === OrderKind.Deploy) {
            st.orderKind[i] = OrderKind.Deploy;
            st.orderX[i] = st.posX[i];
            st.orderZ[i] = st.posZ[i];
            if (st.state[i] !== UnitState.Deploying) st.state[i] = UnitState.Idle;
          } else if (c.order === OrderKind.Move || c.order === OrderKind.AttackMove) {
            moveTo.set(c.entities[k], [c.x, c.z]);
            st.state[i] = UnitState.Moving;
          }
        }
      });

      // Stand in for the movement layer.
      for (const [handle, [tx, tz]] of moveTo) {
        const i = st.index(handle as EntityId);
        if (i < 0 || st.state[i] === UnitState.Deploying) { moveTo.delete(handle); continue; }
        const dx = tx - st.posX[i];
        const dz = tz - st.posZ[i];
        const len = Math.hypot(dx, dz);
        const stepM = st.maxSpeed[i] * SIM_DT;
        if (len <= stepM) {
          st.posX[i] = tx; st.posZ[i] = tz;
          st.state[i] = UnitState.Idle;
          moveTo.delete(handle);
        } else {
          st.posX[i] += (dx / len) * stepM;
          st.posZ[i] += (dz / len) * stepM;
        }
        st.cellX[i] = clampCell(worldToCell(st.posX[i]));
        st.cellZ[i] = clampCell(worldToCell(st.posZ[i]));
      }

      deployService.tick(s);
      production.tick(s);
    }

    setProduction(null);

    // The vehicle is gone and a Construction Yard is standing where it stopped.
    // "Gone" means `PendingDestroy`, not absent: `markDead` defers the actual
    // removal to Phase.Cleanup, which this rig deliberately does not run.
    const mi = st.index(mcv);
    const departed = mi < 0 || (st.flags[mi] & EntityFlag.PendingDestroy) !== 0;
    expect(departed, 'the construction vehicle is still a vehicle').toBe(true);
    let yards = 0;
    for (let a = 0; a < st.aliveCount; a++) {
      const i = st.alive[a];
      if (st.owner[i] !== (P_AI as number)) continue;
      if (st.kind[i] !== EntityKind.Building) continue;
      if ((st.flags[i] & EntityFlag.IsBuilder) !== 0) yards++;
    }
    expect(yards, 'the AI never got a Construction Yard on the ground').toBe(1);
    expect(brain.mcvSize).toBe(0);
  });
});

/* ==========================================================================
 * 8. THE OPENING BANK
 *
 * From a construction vehicle there is NO income until a refinery stands, and
 * the cheapest route to one is a power plant plus a refinery. The lobby's
 * lowest starting-credits option was 2000, which is under that floor for every
 * army — so the option existed and the match it produced could only be lost.
 * That was invisible while a pre-built base was the only opening, because a
 * pre-built base arrives with a refinery and a harvester already earning.
 * ========================================================================== */

describe('the opening bank can actually reach a refinery', () => {
  /** Power plant + refinery, per army, straight off the authored tech tree. */
  function cheapestIncome(faction: Faction): number {
    const catalog = new ProductionCatalog({ tables: null, unitId: {}, buildingId: {} });
    let power = Infinity;
    let refinery = Infinity;
    for (const e of catalog.entries) {
      if (e.kind !== BuildKind.Building) continue;
      if (e.faction !== Faction.Neutral && e.faction !== faction) continue;
      if (e.power > 0) power = Math.min(power, e.cost);
      if (e.shipsWith !== '') refinery = Math.min(refinery, e.cost);
    }
    return power + refinery;
  }

  for (const faction of ARMIES) {
    it(`${ARMY_NAMES[faction]} can afford power + a refinery on the MCV floor`, () => {
      const need = cheapestIncome(faction);
      expect(need).toBeLessThan(Infinity);
      expect(need, `${ARMY_NAMES[faction]} needs ${need} to start earning`)
        .toBeLessThanOrEqual(MCV_MIN_CREDITS);
    });
  }

  it('offers nothing below that floor when the opening is a construction vehicle', () => {
    for (const c of creditOptionsFor('mcv')) expect(c).toBeGreaterThanOrEqual(MCV_MIN_CREDITS);
    expect(creditOptionsFor('mcv').length).toBeGreaterThan(0);
  });

  it('keeps the whole ladder for a pre-built base, which opens with a working economy', () => {
    expect(creditOptionsFor('base')).toEqual(CREDIT_OPTIONS);
    expect(clampCreditsFor('base', 2000)).toBe(2000);
  });

  it('raises a bank restored from an older profile instead of launching an unwinnable match', () => {
    expect(clampCreditsFor('mcv', 2000)).toBe(MCV_MIN_CREDITS);
    expect(clampCreditsFor('mcv', 50000)).toBe(50000);
  });
});

/* ========================================================================== */

describe('the starting bank lands on tick 0, not on a render frame', () => {
  const read = (rel: string): string =>
    (require('node:fs') as typeof import('node:fs'))
      .readFileSync(require('node:path').join(__dirname, '..', rel), 'utf8');

  /**
   * A LIVE DETERMINISM BUG, and the only one found that made two runs of the
   * same seed diverge ON THE SAME MACHINE.
   *
   * `applyPostBoot` wrote the starting credits AND posed the camera, and ran
   * after `await nextFrames(6)` — six requestAnimationFrame callbacks. The tick
   * on which the bank appeared therefore depended on how long those six frames
   * took: measured between roughly 3 and 18. The AI's first spend decision
   * reads that bank, so the two runs part company within a second.
   *
   * The wait is real and had to stay: `game.scenario` re-asserts its authored
   * camera pose up to frame 4, so a pose set earlier is overwritten. But that
   * is presentation. Splitting the sim-visible half out and running it before
   * `game.start()` is the whole fix.
   */
  it('writes credits before the loop starts', () => {
    const src = read('src/shell/Shell.ts');
    const simAt = src.indexOf('this.applySimPostBoot(game, backdrop);');
    const startAt = src.indexOf('game.start();', simAt > 0 ? simAt : 0);
    expect(simAt, 'applySimPostBoot must be called').toBeGreaterThan(0);
    expect(startAt, 'and it must come BEFORE game.start()').toBeGreaterThan(simAt);
  });

  it('poses the camera after the six-frame wait, which is what needed it', () => {
    const src = read('src/shell/Shell.ts');
    const waitAt = src.indexOf('await nextFrames(6);');
    const camAt = src.indexOf('this.applyCameraPostBoot(game, backdrop);');
    expect(waitAt).toBeGreaterThan(0);
    expect(camAt, 'the camera pose must stay after the wait').toBeGreaterThan(waitAt);
  });

  it('keeps the two halves separate — no sim write may drift back into the camera pass', () => {
    // The failure mode is not that someone re-merges the functions; it is that
    // somebody adds a credits/tech/queue write to the camera one because that
    // is where such things used to live.
    const src = read('src/shell/Shell.ts');
    const from = src.indexOf('private applyCameraPostBoot');
    const to = src.indexOf('\n  }', from);
    const body = src.slice(from, to);
    expect(body, 'a sim write is back in the camera pass').not.toMatch(/\.credits\s*=/);
    expect(body).not.toMatch(/loop\.setSpeed/);
  });
});
