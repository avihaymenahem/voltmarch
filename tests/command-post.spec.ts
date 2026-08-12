/// <reference types="vite/client" />
/**
 * ============================================================================
 * tests/command-post.spec.ts — THE STRUCTURE THAT SELLS THE COMMANDER POWERS
 * ============================================================================
 * Until v2.6.0 the five commander powers were PROFILE state: five missions paid
 * them out, `powersOwnedBy` read this browser's localStorage, and
 * `src/sim/CommanderPowers.ts` carried forty lines explaining why the
 * simulation was FORBIDDEN to ask whether you owned one — a profile-based
 * refusal lands on one machine only, mid-match, at the tick a button is
 * pressed.
 *
 * They are bought in the match now, from a Command Post, and every assertion
 * here is about a link in that chain. Each one fails on the old code in a
 * direct way: there is no `BuildTab.Powers`, no `BuildKind.Power`, no
 * `commanderPowerMask` and no such structure.
 *
 * THE FOUR SILENT FAILURES THIS FILE EXISTS FOR
 * ---------------------------------------------
 *   1. A TAB WITH NO GATE. The whole design rests on the tab being absent until
 *      a completed, POWERED Command Post stands. Nothing about a tab that is
 *      wrongly visible throws — the player just gets buttons they should have
 *      had to earn.
 *   2. A HARD-CODED FOUR. `BuildTab` was four members for the life of the
 *      project and the number is written as a literal in places a typecheck
 *      cannot see. `AI.canQueue` tested `tab > 3` and `AI.inFlight` was
 *      `Int32Array(4)`; the effect was that a Brutal brain built its Command
 *      Post, banked thirty thousand credits and never bought a thing. No throw,
 *      no log, and every unit test in the repo passed. It took booting a match.
 *   3. AN ID SPACE THAT COLLIDES. A power's `publicId` shares a range with the
 *      upgrades and rides the multiplayer wire, where `WIRE_LIMITS.maxDefId` is
 *      4095 and an id above it is dropped by the relay and ends the match on
 *      the peer as a tripwire.
 *   4. A PURCHASE THAT DOES NOT SURVIVE A RELOAD, in either direction — handed
 *      back for free, or taken away.
 * ============================================================================
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { World } from '../src/core/world';
import { Channels } from '../src/core/events';
import { Rng } from '../src/core/math';
import {
  BUILD_TAB_COUNT, BuildTab, CommandKind, EntityFlag, EntityKind, Faction,
} from '../src/core/types';
import type { AvailabilityResult, EntityId, PlayerId, SimContext } from '../src/core/types';
import { BUILD_TAB_ORDER, SIM_DT } from '../src/core/config';
import {
  BuildKind, PRODUCTION_CONTENT, POWER_PUBLIC_ID_BASE, ProductionCatalog, ProductionService,
  UNIT_PUBLIC_ID_BASE, UPGRADE_PUBLIC_ID_BASE,
} from '../src/sim/Production';
import {
  COMMANDER_POWER_LIST, CommanderPowerId, commanderPowerContentKey, grantCommanderPower,
  ownsCommanderPower, powerByContentKey, powersOwnedBy,
} from '../src/progression/powers';
import { WIRE_LIMITS, validateCommand } from '../src/net/protocol';
import { hashOnly } from '../src/game/Checksum';
import { clearScenario } from '../src/game/Scenarios';
import { defaultIsProducer } from '../src/sim/Viability';
import { BUILD_COLUMNS, BUILD_ROWS } from '../src/ui/Sidebar';

const EMPTY_BINDING = { tables: null, unitId: {}, buildingId: {} };

const ARMIES: readonly Faction[] = [
  Faction.Allies, Faction.Soviets, Faction.Meridian, Faction.Reclaim,
];

/** Content key of the Command Post each army builds. Three rows, four armies. */
const POST_KEYS: Readonly<Record<number, string>> = {
  [Faction.Allies]: 'commandPost',
  [Faction.Soviets]: 'commandPost',
  [Faction.Meridian]: 'mrdPharos',
  [Faction.Reclaim]: 'rclSignalRig',
};

const POWER_CONTENT = PRODUCTION_CONTENT.filter((c) => c.kind === BuildKind.Power);

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), 'utf8');
}

beforeEach(() => { clearScenario(); });

/* ==========================================================================
 * 1. THE TABLES AGREE — the same hazard `tests/upgrades.spec.ts` opens with
 *
 * A power needs `COMMANDER_POWERS` and a `BuildKind.Power` row in
 * `Production.CONTENT` to agree, and BOTH directions fail silently: a power
 * with no content row is an effect nobody can buy, and a content row naming no
 * power is dropped at boot with one `console.warn` and is then simply absent
 * from the grid.
 * ========================================================================== */

describe('the power table and the content table describe the same five things', () => {
  it('has exactly one content row per power, joined by the `power.` prefix', () => {
    expect(POWER_CONTENT.length).toBe(COMMANDER_POWER_LIST.length);
    for (const p of COMMANDER_POWER_LIST) {
      const key = commanderPowerContentKey(p);
      const rows = POWER_CONTENT.filter((c) => c.key === key);
      expect(rows.length, `"${p.key}" has ${rows.length} content rows, not 1`).toBe(1);
      expect(powerByContentKey(key)?.id).toBe(p.id);
    }
  });

  it('prices every one of them, and none of them for free', () => {
    for (const c of POWER_CONTENT) {
      expect(c.cost, `${c.key} is free`).toBeGreaterThan(0);
      expect(c.buildTime, `${c.key} is instant`).toBeGreaterThan(0);
      expect(c.tab).toBe(BuildTab.Powers);
      // NO PREREQS, deliberately: the gate is the tab, and a `commandPost`
      // prereq would be a rule the Pact could not satisfy — its building is
      // called something else.
      expect(c.prereqs.length, `${c.key} names a prereq; the tab is the gate`).toBe(0);
    }
  });

  it('offers all five to all four armies, which is what Neutral means here', () => {
    // Everywhere else `Faction.Neutral` means "the two ORIGINAL armies share
    // this". The Powers tab is the exception, argued in `byFactionTab`: there
    // is one Airstrike and every army calls it.
    const catalog = new ProductionCatalog(EMPTY_BINDING);
    for (const f of ARMIES) {
      const keys = catalog.roster(f, BuildTab.Powers).map((e) => e.key);
      expect(keys.sort(), `army ${String(f)} sees the wrong power roster`)
        .toEqual(POWER_CONTENT.map((c) => c.key).sort());
    }
  });

  it('is sold by a Command Post and by nothing else in the game', () => {
    // `producesTabs: [Powers]` IS the gate. Any other structure growing one
    // would stop the Command Post being the commitment the design rests on.
    const catalog = new ProductionCatalog(EMPTY_BINDING);
    const publishers = catalog.entries
      .filter((e) => e.producesTabs.includes(BuildTab.Powers))
      .map((e) => e.key)
      .sort();
    expect(publishers).toEqual(['commandPost', 'mrdPharos', 'rclSignalRig']);
  });

  it('gives every army exactly one Command Post it can build', () => {
    const catalog = new ProductionCatalog(EMPTY_BINDING);
    for (const f of ARMIES) {
      const posts = catalog.roster(f, BuildTab.Structures)
        .filter((e) => e.producesTabs.includes(BuildTab.Powers));
      expect(posts.map((e) => e.key), `army ${String(f)}`).toEqual([POST_KEYS[f]]);
    }
  });

  it('carries no footprint, def id or entity kind on a power row', () => {
    const catalog = new ProductionCatalog(EMPTY_BINDING);
    for (const p of COMMANDER_POWER_LIST) {
      const e = catalog.byKey(commanderPowerContentKey(p))!;
      expect(e.footprintW).toBe(0);
      expect(e.footprintH).toBe(0);
      expect(e.power).toBe(0);
      // -1 keeps it out of `byDefIdUnit`/`byDefIdBuilding` entirely, so
      // `resolve` can never hand it back for a real def's id.
      expect(e.defId).toBe(-1);
      expect(e.entityKind).toBe(EntityKind.None);
      expect(e.producesTabs.length).toBe(0);
      // Never progression-gated: a purchase is in-match state, and hanging it
      // off the local profile is the tick-zero desync all over again.
      expect(e.unlockedBy).toBe('');
    }
  });
});

/* ==========================================================================
 * 2. THE ID SPACE — silent failure #3
 * ========================================================================== */

describe('the power id space', () => {
  it('sits between the upgrades and the units, under the wire limit', () => {
    expect(POWER_PUBLIC_ID_BASE).toBeGreaterThan(UPGRADE_PUBLIC_ID_BASE);
    expect(POWER_PUBLIC_ID_BASE).toBeLessThan(UNIT_PUBLIC_ID_BASE);
    const catalog = new ProductionCatalog(EMPTY_BINDING);
    for (const p of COMMANDER_POWER_LIST) {
      const e = catalog.byKey(commanderPowerContentKey(p))!;
      expect(e.publicId).toBe(POWER_PUBLIC_ID_BASE + (p.id as number));
      // An id above `maxDefId` is DROPPED by the relay and ends the match on
      // the peer as a tripwire — which is why upgrades are at 2048 and not
      // 8192, and the same constraint binds here.
      expect(e.publicId).toBeLessThanOrEqual(WIRE_LIMITS.maxDefId);
    }
  });

  it('never collides with an upgrade, a unit or a building', () => {
    const catalog = new ProductionCatalog(EMPTY_BINDING);
    const seen = new Map<number, string>();
    for (const e of catalog.entries) {
      const prior = seen.get(e.publicId);
      expect(prior, `publicId ${e.publicId} shared by ${String(prior)} and ${e.key}`)
        .toBeUndefined();
      seen.set(e.publicId, e.key);
    }
  });

  it('resolves back to its own entry, and every upgrade id still resolves too', () => {
    // The ORDER of the two range tests in `resolve()` is the whole risk: 3072
    // used to be inside the upgrade range, so testing the wide one first would
    // send every power id into `byUpgradeId` and answer null.
    const catalog = new ProductionCatalog(EMPTY_BINDING);
    for (const p of COMMANDER_POWER_LIST) {
      const id = POWER_PUBLIC_ID_BASE + (p.id as number);
      expect(catalog.resolve(id)?.key).toBe(commanderPowerContentKey(p));
      // The `isBuilding` hint is derived from the tab by every command path and
      // must not be able to make a power unresolvable.
      expect(catalog.resolve(id, true)?.key).toBe(commanderPowerContentKey(p));
      expect(catalog.resolve(id, false)?.key).toBe(commanderPowerContentKey(p));
    }
    for (const e of catalog.entries) {
      if (e.kind !== BuildKind.Upgrade) continue;
      expect(catalog.resolve(e.publicId)?.key, `${e.key} stopped resolving`).toBe(e.key);
    }
  });
});

/* ==========================================================================
 * 3. THE WIRE — the allowlist is an allowlist
 * ========================================================================== */

describe('a power purchase survives the relay', () => {
  function buy(tab: number, defId: number): ReturnType<typeof validateCommand> {
    return validateCommand({
      kind: CommandKind.ProductionStart, player: 0, tab, defId,
      order: 0, stance: 0, x: 0, z: 0, cx: 0, cz: 0, target: 0, arg: 0,
      queued: false, entities: [],
    });
  }

  it('accepts the Powers tab, because it was added to the allowlist', () => {
    // AN ALLOWLIST, NOT A RANGE CHECK. A `tab < BUILD_TAB_COUNT` test on a relay
    // that is deliberately kept ignorant of the game's tables would silently
    // start accepting whatever the next tab turns out to be.
    const catalog = new ProductionCatalog(EMPTY_BINDING);
    for (const p of COMMANDER_POWER_LIST) {
      const e = catalog.byKey(commanderPowerContentKey(p))!;
      expect(buy(BuildTab.Powers, e.publicId).ok, `${p.key} rejected on the wire`).toBe(true);
    }
  });

  it('still refuses a tab that is not one of the five', () => {
    const r = buy(BUILD_TAB_COUNT, 3073);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fault).toBe('tab');
  });
});

/* ==========================================================================
 * 4. THE GATE — silent failure #1
 * ========================================================================== */

let tickCounter = 0;
function makeRig(faction = Faction.Allies) {
  const world = new World();
  world.addPlayer(faction, 'Commander', true, true);
  world.addPlayer(Faction.Soviets, 'Opponent', false, false);
  const channels = new Channels();
  const catalog = new ProductionCatalog(EMPTY_BINDING);
  const service = new ProductionService(world, channels, catalog);
  return { world, channels, catalog, service };
}

function step(service: ProductionService, world: World, steps = 1): void {
  const rng = new Rng(7);
  for (let i = 0; i < steps; i++) {
    tickCounter++;
    world.tick = tickCounter;
    world.time = tickCounter * SIM_DT;
    service.tick({ dt: SIM_DT, tick: tickCounter, time: world.time, rng } as SimContext);
    world.spatial.rebuild();
  }
}

/** Plant a finished, powered structure and return its slot index. */
function plant(
  rig: ReturnType<typeof makeRig>, key: string, cx: number, cz: number,
): { id: EntityId; slot: number } {
  const p = rig.world.player(0 as PlayerId);
  const entry = rig.catalog.byKey(key)!;
  const id = rig.service.spawnBuilding(p, entry, cx, cz, 1);
  const slot = rig.world.store.index(id);
  // `PowerGrid` is not in this rig, so the bit it owns is set by hand — the
  // census reads the flag, not the grid.
  rig.world.store.flags[slot] |= EntityFlag.Powered;
  return { id, slot };
}

describe('the Powers tab is absent until the structure is standing AND powered', () => {
  const out: AvailabilityResult = { ok: false, reason: '', capped: false };

  it('publishes no factory, no tab and no purchase with no Command Post', () => {
    const rig = makeRig();
    plant(rig, 'conyard', 10, 10);
    step(rig.service, rig.world, 2);

    expect(rig.service.snapshot.tabVisible[BuildTab.Powers as number]).toBe(false);
    const entry = rig.catalog.byKey('power.airstrike')!;
    const r = rig.service.availabilityOf(0 as PlayerId, entry, out);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('Requires a production structure');
  });

  it('publishes both the moment a powered post is complete', () => {
    const rig = makeRig();
    plant(rig, 'conyard', 10, 10);
    plant(rig, 'commandPost', 20, 20);
    step(rig.service, rig.world, 2);

    expect(rig.service.snapshot.tabVisible[BuildTab.Powers as number]).toBe(true);
    const entry = rig.catalog.byKey('power.airstrike')!;
    expect(rig.service.availabilityOf(0 as PlayerId, entry, out).ok).toBe(true);
  });

  it('closes again when the post goes dark, and reopens when the lights do', () => {
    // The one place this build gates BUILDABILITY on power, and the exception is
    // argued in `census`: nothing in the Powers tab is a route out of a
    // blackout, so gating it cannot soft-lock the way gating a Power Plant
    // would.
    const rig = makeRig();
    plant(rig, 'conyard', 10, 10);
    const post = plant(rig, 'commandPost', 20, 20);
    step(rig.service, rig.world, 2);
    expect(rig.service.snapshot.tabVisible[BuildTab.Powers as number]).toBe(true);

    rig.world.store.flags[post.slot] &= ~EntityFlag.Powered;
    step(rig.service, rig.world, 2);
    expect(rig.service.snapshot.tabVisible[BuildTab.Powers as number]).toBe(false);

    rig.world.store.flags[post.slot] |= EntityFlag.Powered;
    step(rig.service, rig.world, 2);
    expect(rig.service.snapshot.tabVisible[BuildTab.Powers as number]).toBe(true);
  });

  it('closes when the post dies, which is what makes it worth shooting', () => {
    const rig = makeRig();
    plant(rig, 'conyard', 10, 10);
    const post = plant(rig, 'commandPost', 20, 20);
    step(rig.service, rig.world, 2);
    expect(rig.service.snapshot.tabVisible[BuildTab.Powers as number]).toBe(true);

    rig.world.store.markDead(post.id);
    rig.world.store.flushDestroyed();
    step(rig.service, rig.world, 2);
    expect(rig.service.snapshot.tabVisible[BuildTab.Powers as number]).toBe(false);
  });

  it('never hides one of the four tabs that are always there', () => {
    const rig = makeRig();
    step(rig.service, rig.world, 2);
    for (let t = 0; t < BUILD_TAB_COUNT; t++) {
      if ((t as BuildTab) === BuildTab.Powers) continue;
      expect(rig.service.snapshot.tabVisible[t], `tab ${t} vanished`).toBe(true);
    }
  });
});

/* ==========================================================================
 * 5. THE PURCHASE
 * ========================================================================== */

describe('buying a power', () => {
  const out: AvailabilityResult = { ok: false, reason: '', capped: false };

  function boughtRig(): ReturnType<typeof makeRig> {
    const rig = makeRig();
    plant(rig, 'conyard', 10, 10);
    plant(rig, 'commandPost', 20, 20);
    step(rig.service, rig.world, 2);
    return rig;
  }

  it('crosses the command bus and installs a bit, never anything else', () => {
    const rig = boughtRig();
    const p = rig.world.player(0 as PlayerId);
    const entry = rig.catalog.byKey('power.orbitalScan')!;
    p.credits = 10_000;
    const before = { credits: p.credits, entities: rig.world.store.aliveCount };

    rig.channels.commands.issueProductionStart(p.id, BuildTab.Powers, entry.publicId, 1);
    step(rig.service, rig.world, Math.ceil(entry.buildTime / SIM_DT) + 30);

    expect(ownsCommanderPower(p, CommanderPowerId.OrbitalScan)).toBe(true);
    expect(p.credits).toBeCloseTo(before.credits - entry.cost, 0);
    // A power produces NOTHING. Not a unit, not a structure, not a wreck.
    expect(rig.world.store.aliveCount).toBe(before.entities);
    expect(p.queues[BuildTab.Powers as number].items.length).toBe(0);
  });

  it('installs only the power that was bought', () => {
    const rig = boughtRig();
    const p = rig.world.player(0 as PlayerId);
    p.credits = 10_000;
    const entry = rig.catalog.byKey('power.oreBoost')!;
    rig.channels.commands.issueProductionStart(p.id, BuildTab.Powers, entry.publicId, 1);
    step(rig.service, rig.world, Math.ceil(entry.buildTime / SIM_DT) + 30);

    expect(powersOwnedBy(p).map((x) => x.key)).toEqual(['oreBoost']);
  });

  it('refuses a second copy with capped=true, so the AI does not re-propose it', () => {
    const rig = boughtRig();
    const p = rig.world.player(0 as PlayerId);
    const entry = rig.catalog.byKey('power.airstrike')!;
    grantCommanderPower(p, CommanderPowerId.Airstrike);

    const r = rig.service.availabilityOf(p.id, entry, out);
    expect(r.ok).toBe(false);
    // `capped` means "you already do" rather than "not yet", which is the
    // distinction the AI's stuck-reason diagnostic needs.
    expect(r.capped).toBe(true);
    expect(r.reason).toBe('Requisitioned');
  });

  it('clamps a shift-click to ONE, because `maxAlive` cannot express a one-off', () => {
    // The upgrade layer learned this the expensive way: five Composite Armours
    // on the line charged 1200 credits five times for one effect, because the
    // cap counts ALIVE ENTITIES and an upgrade never becomes one. A power is
    // the same shape.
    const rig = boughtRig();
    const p = rig.world.player(0 as PlayerId);
    p.credits = 30_000;
    const entry = rig.catalog.byKey('power.chronoshift')!;
    rig.channels.commands.issueProductionStart(p.id, BuildTab.Powers, entry.publicId, 5);
    step(rig.service, rig.world, 2);
    expect(p.queues[BuildTab.Powers as number].items.length).toBe(1);

    // And a second command while the first is on the line is dropped too.
    rig.channels.commands.issueProductionStart(p.id, BuildTab.Powers, entry.publicId, 1);
    step(rig.service, rig.world, 2);
    expect(p.queues[BuildTab.Powers as number].items.length).toBe(1);

    step(rig.service, rig.world, Math.ceil(entry.buildTime / SIM_DT) + 30);
    expect(p.credits).toBeCloseTo(30_000 - entry.cost, 0);
  });

  it('is in the checksum, so two clients cannot disagree about who owns what', () => {
    // The line that makes reading the mask inside `simTick` SAFE. Without it a
    // divergence in ownership stays silent until somebody presses the button
    // minutes later.
    const rig = makeRig();
    const p = rig.world.player(0 as PlayerId);
    const before = hashOnly(rig.world);
    grantCommanderPower(p, CommanderPowerId.Chronoshift);
    expect(hashOnly(rig.world)).not.toBe(before);
  });
});

/* ==========================================================================
 * 6. THE COMMAND POST IS NOT A PRODUCER
 * ========================================================================== */

describe('a Command Post cannot rebuild anything, and nothing pretends it can', () => {
  it('is not a producer for the last-way-out guard', () => {
    // `defaultIsProducer` answers "can this player still play". A tab that makes
    // nothing is exactly the Refinery's problem in that function's own header:
    // an asset that cannot rebuild. Counting it would tell a stranded player
    // they are fine.
    const rig = makeRig();
    const yard = plant(rig, 'conyard', 10, 10);
    const post = plant(rig, 'commandPost', 20, 20);
    step(rig.service, rig.world, 2);

    expect(defaultIsProducer(rig.world, yard.slot)).toBe(true);
    expect(defaultIsProducer(rig.world, post.slot)).toBe(false);
  });

  it('carries neither IsBuilder nor IsFactory', () => {
    // The flag half of the same statement, and it also keeps the structure in
    // the power grid's FIRST shed class — which is the class the Powers tab is
    // gated on, so a brownout closes the tab.
    const rig = makeRig();
    const post = plant(rig, 'commandPost', 20, 20);
    const f = rig.world.store.flags[post.slot];
    expect(f & (EntityFlag.IsBuilder | EntityFlag.IsFactory)).toBe(0);
    expect(f & EntityFlag.NeedsPower, 'a dark post must be shed').not.toBe(0);
  });
});

/* ==========================================================================
 * 7. THE HARD-CODED FOUR — silent failure #2
 *
 * `BuildTab` was four members for the life of the project, and the number is
 * written as a literal in places a typecheck cannot see. Each assertion below
 * pins one that was found the expensive way.
 * ========================================================================== */

describe('nothing counts build tabs to four any more', () => {
  it('sizes the per-player queue array from BUILD_TAB_COUNT', () => {
    expect(BUILD_TAB_ORDER.length).toBe(BUILD_TAB_COUNT);
    const rig = makeRig();
    expect(rig.world.player(0 as PlayerId).queues.length).toBe(BUILD_TAB_COUNT);
  });

  it('leaves the AI no literal tab bound to trip over', () => {
    // THE ONE THAT COST A LIVE BOOT. `canQueue` refused `tab > 3` and
    // `inFlight` was `Int32Array(4)`, so a Brutal brain built its Command Post,
    // banked thirty thousand credits and bought nothing — with no throw, no log
    // and a green test suite. Source-read rather than behaviour-driven because
    // reproducing it needs eight minutes of simulated match; what it pins is
    // that the literal is gone.
    // Comment lines stripped first: this file's own prose names the old
    // literal, and a source-reading test that matched its own explanation
    // would be permanently red for the wrong reason.
    const ai = read('src/sim/AI.ts')
      .split('\n')
      .filter((l) => !/^\s*(\*|\/\/)/.test(l))
      .join('\n');
    expect(ai).not.toMatch(/tab\s*[<>]=?\s*3\b/);
    expect(ai).toContain('new Int32Array(BUILD_TAB_COUNT)');
    expect(ai).toMatch(/tab\s*>=\s*BUILD_TAB_COUNT/);
  });

  it('pools enough sidebar slots for the biggest tab any army has', () => {
    // A grid with fewer slots than its tab has entries simply DOES NOT DRAW the
    // overflow: no error, no scrollbar worth noticing, a structure that quietly
    // stops being buildable. The Command Post spent the old margin — the Soviet
    // Structures tab is thirteen rows deep.
    const catalog = new ProductionCatalog(EMPTY_BINDING);
    let worst = 0;
    for (const f of ARMIES) {
      for (let t = 0; t < BUILD_TAB_COUNT; t++) {
        worst = Math.max(worst, catalog.roster(f, t as BuildTab).length);
      }
    }
    expect(BUILD_COLUMNS * BUILD_ROWS).toBeGreaterThanOrEqual(worst);
  });
});
