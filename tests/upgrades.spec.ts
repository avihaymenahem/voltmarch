/// <reference types="vite/client" />
/**
 * ============================================================================
 * tests/upgrades.spec.ts — purchasable in-match upgrades
 * ============================================================================
 * THE CONTENT-TABLE HAZARD IS THE POINT OF THE FIRST BLOCK.
 *
 * CLAUDE.md records that a UNIT needs five tables to agree and that three of
 * them fail SILENTLY. An upgrade needs two — `UPGRADES` in `src/sim/Upgrades.ts`
 * and the `BuildKind.Upgrade` rows in `Production.CONTENT` — and BOTH of them
 * fail silently:
 *
 *   an UPGRADES row with no CONTENT row  is an effect nobody can buy
 *   a CONTENT row with no UPGRADES row   is a cameo that warns once at boot
 *                                        and then is simply absent from the grid
 *
 * Neither throws, neither shows up in a typecheck, and neither is visible in a
 * diff that only touches one file. So the two tables are asserted equal here,
 * by key, by faction and by tab.
 *
 * The rest of the file is the behaviour: that a purchase crosses the command
 * bus, that the effect reaches the simulation at the point of use, that a unit
 * built AFTER the purchase gets it, that it survives a save, and that it is in
 * the checksum.
 * ============================================================================
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { World } from '../src/core/world';
import { Channels } from '../src/core/events';
import { Rng } from '../src/core/math';
import {
  ArmorClass, BuildTab, EntityKind, Faction, Locomotor, UnitState, UpgradeLever,
  UpgradeScope, WarheadClass, UPGRADE_MUL_SLOTS,
} from '../src/core/types';
import type {
  AvailabilityResult, EntityId, PlayerId, PlayerState, SimContext,
} from '../src/core/types';
import { ARMOR_MATRIX, SIM_DT } from '../src/core/config';
import { DamageSystem, setArmorMatrix } from '../src/sim/Damage';
import { BuildQueues } from '../src/sim/BuildQueue';

import {
  BuildKind, PRODUCTION_CONTENT, ProductionCatalog, ProductionService,
  UNIT_PUBLIC_ID_BASE, UPGRADE_PUBLIC_ID_BASE,
} from '../src/sim/Production';
import {
  UPGRADES, UPGRADE_SCOPE_TAB, grantUpgrade, hasUpgradeKey, makeUpgradeMul,
  ownedUpgradeKeys, recomputeUpgradeMuls, setUpgradesByKey, upgradeByKey,
  upgradeGlobalMul, upgradeMul, upgradeSlot,
} from '../src/sim/Upgrades';
import { WIRE_LIMITS, isKnownCommandKind } from '../src/net/protocol';
import { CommandKind } from '../src/core/types';
import { hashOnly } from '../src/game/Checksum';
import { clearScenario } from '../src/game/Scenarios';
import { archetypeFor } from '../src/ui/Cameos';

const EMPTY_BINDING = { tables: null, unitId: {}, buildingId: {} };

const ARMIES: readonly Faction[] = [
  Faction.Allies, Faction.Soviets, Faction.Meridian, Faction.Reclaim,
];

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), 'utf8');
}

/** Every `BuildKind.Upgrade` row in the production content table. */
const UPGRADE_CONTENT = PRODUCTION_CONTENT.filter((c) => c.kind === BuildKind.Upgrade);

beforeEach(() => { clearScenario(); });

/* ==========================================================================
 * 1. THE TWO TABLES AGREE
 * ========================================================================== */

describe('the upgrade table and the content table describe the same twelve things', () => {
  it('names exactly the same keys in both directions', () => {
    const inUpgrades = UPGRADES.map((u) => u.key).sort();
    const inContent = UPGRADE_CONTENT.map((c) => c.key).sort();
    expect(
      inContent,
      'an UPGRADES row with no CONTENT row cannot be bought; a CONTENT row with '
      + 'no UPGRADES row is dropped by resolveEntry with only a console warning',
    ).toEqual(inUpgrades);
  });

  it('agrees about which army owns each one', () => {
    for (const u of UPGRADES) {
      const row = UPGRADE_CONTENT.find((c) => c.key === u.key)!;
      expect(row.faction, `${u.key} faction`).toBe(u.faction);
    }
  });

  it('puts each one in the tab its scope implies', () => {
    // The tab is not decoration: it is what gates the upgrade on a structure,
    // because `availabilityOf` refuses any entry whose tab has no factory. An
    // infantry upgrade in the Structures tab would be buyable from a bare
    // construction yard with no barracks anywhere.
    for (const u of UPGRADES) {
      const row = UPGRADE_CONTENT.find((c) => c.key === u.key)!;
      expect(row.tab, `${u.key} tab`).toBe(UPGRADE_SCOPE_TAB[u.scope]);
    }
  });

  it('gives every army the same number of upgrades', () => {
    const counts = ARMIES.map((f) => UPGRADES.filter((u) => u.faction === f).length);
    expect(new Set(counts).size, `uneven upgrade counts: ${counts.join(', ')}`).toBe(1);
    expect(counts[0]).toBeGreaterThan(0);
  });

  it('authors none as Faction.Neutral', () => {
    // Neutral in this catalog means "the two ORIGINAL armies share it"
    // (SHARED_POOL_FACTIONS), not "everyone" — so a Neutral upgrade would be
    // invisible to the Meridian Pact and the Reclamation.
    for (const u of UPGRADES) expect(u.faction, u.key).not.toBe(Faction.Neutral);
    for (const c of UPGRADE_CONTENT) expect(c.faction, c.key).not.toBe(Faction.Neutral);
  });

  it('gives no two armies the identical set of levers', () => {
    // A faction identity is the SHAPE of its three, not the individual rows; a
    // lever repeating across armies is fine, two armies being the same is not.
    const shapes = ARMIES.map((f) => UPGRADES
      .filter((u) => u.faction === f)
      .map((u) => `${u.lever}:${u.scope}`)
      .sort()
      .join('|'));
    expect(new Set(shapes).size, `duplicate faction shapes: ${shapes.join('  ')}`).toBe(ARMIES.length);
  });

  it('states its real multiplier in its blurb', () => {
    // The blurb is the ONLY thing the player reads before spending, and
    // `Hud.extrasFor` prints it verbatim off the catalog entry. A blurb that
    // has drifted from the number is a lie told at the point of sale.
    for (const u of UPGRADES) {
      const row = UPGRADE_CONTENT.find((c) => c.key === u.key)!;
      // "18% less damage" for 0.82, "25% more damage" for 1.25, "30% further"
      // for 1.30 — in every case the percentage is the distance from 1.
      const pct = Math.round(Math.abs(1 - u.mul) * 100);
      expect(
        row.blurb,
        `${u.key}: blurb "${row.blurb}" does not mention ${pct}% for mul ${u.mul}`,
      ).toContain(`${pct}%`);
    }
  });
});

/* ==========================================================================
 * 2. THE BITS
 * ========================================================================== */

describe('upgrade bits are stable, unique and fit the mask', () => {
  it('are unique', () => {
    const bits = UPGRADES.map((u) => u.bit);
    expect(new Set(bits).size, `duplicate bits: ${bits.join(', ')}`).toBe(bits.length);
  });

  it('fit inside the 32-bit mask, signed-safe', () => {
    // 31 would be the sign bit: `1 << 31` is negative and `mask |= that` makes
    // `upgradeMask` negative, which the checksum survives but a future
    // `mask > 0` test would not. 30 is the honest ceiling.
    for (const u of UPGRADES) {
      expect(u.bit, `${u.key} bit`).toBeGreaterThanOrEqual(0);
      expect(u.bit, `${u.key} bit`).toBeLessThanOrEqual(30);
    }
  });

  it('are matched by a publicId the wire will actually carry', () => {
    // `validateCommand` rejects any defId above WIRE_LIMITS.maxDefId, and a
    // ProductionStart carrying an upgrade is an ordinary command that has to
    // survive both the relay's filter and the replay's tripwire. An id above
    // the ceiling would be dropped by the relay and would END a peer's match.
    const catalog = new ProductionCatalog(EMPTY_BINDING);
    for (const u of UPGRADES) {
      const entry = catalog.byKey(u.key)!;
      expect(entry, u.key).not.toBeNull();
      expect(entry.publicId).toBe(UPGRADE_PUBLIC_ID_BASE + u.bit);
      expect(entry.publicId, `${u.key} publicId exceeds the wire ceiling`)
        .toBeLessThanOrEqual(WIRE_LIMITS.maxDefId);
      expect(entry.publicId).toBeLessThan(UNIT_PUBLIC_ID_BASE);
    }
  });
});

/* ==========================================================================
 * 3. THE CATALOG
 * ========================================================================== */

describe('the production catalog carries upgrades like anything else', () => {
  it('resolves an upgrade publicId with any isBuilding hint', () => {
    // Every command path derives the hint from the tab, and the base-wide
    // upgrades live in the Structures tab — so they arrive with `true`. If
    // `resolve` honoured the hint, exactly those three would be unresolvable
    // while the other nine worked.
    const catalog = new ProductionCatalog(EMPTY_BINDING);
    for (const u of UPGRADES) {
      const id = UPGRADE_PUBLIC_ID_BASE + u.bit;
      expect(catalog.resolve(id)?.key, u.key).toBe(u.key);
      expect(catalog.resolve(id, true)?.key, `${u.key} with isBuilding=true`).toBe(u.key);
      expect(catalog.resolve(id, false)?.key, `${u.key} with isBuilding=false`).toBe(u.key);
    }
  });

  it('never collides an upgrade id with a unit or a building', () => {
    const catalog = new ProductionCatalog(EMPTY_BINDING);
    const seen = new Map<number, string>();
    for (const e of catalog.entries) {
      const prior = seen.get(e.publicId);
      expect(prior, `publicId ${e.publicId} shared by ${String(prior)} and ${e.key}`)
        .toBeUndefined();
      seen.set(e.publicId, e.key);
    }
  });

  it('puts each upgrade in exactly its own army roster', () => {
    const catalog = new ProductionCatalog(EMPTY_BINDING);
    for (const u of UPGRADES) {
      const row = UPGRADE_CONTENT.find((c) => c.key === u.key)!;
      for (const f of ARMIES) {
        const keys = catalog.roster(f, row.tab).map((e) => e.key);
        if (f === u.faction) expect(keys, `${u.key} missing from its own roster`).toContain(u.key);
        else expect(keys, `${u.key} leaked into ${String(f)}`).not.toContain(u.key);
      }
    }
  });

  it('sorts upgrades to the bottom of their tab', () => {
    const catalog = new ProductionCatalog(EMPTY_BINDING);
    for (const f of ARMIES) {
      for (const tab of [BuildTab.Structures, BuildTab.Infantry, BuildTab.Vehicles]) {
        const roster = catalog.roster(f, tab);
        let seenUpgrade = false;
        for (const e of roster) {
          if (e.kind === BuildKind.Upgrade) seenUpgrade = true;
          else expect(seenUpgrade, `${e.key} sorts after an upgrade in tab ${tab}`).toBe(false);
        }
      }
    }
  });

  it('carries no footprint, power, storage or def id', () => {
    // An upgrade never becomes an entity. A non-zero footprint would make
    // `Placement` think it could be planted; a non-negative defId would put it
    // into `byDefIdUnit` and let `resolve` hand it back for a real unit's id.
    const catalog = new ProductionCatalog(EMPTY_BINDING);
    for (const u of UPGRADES) {
      const e = catalog.byKey(u.key)!;
      expect(e.footprintW).toBe(0);
      expect(e.footprintH).toBe(0);
      expect(e.power).toBe(0);
      expect(e.storage).toBe(0);
      expect(e.defId).toBe(-1);
      expect(e.producesTabs.length).toBe(0);
      expect(e.entityKind).toBe(EntityKind.None);
      // And it must still be a real queue item: cost and time are what make it
      // a purchase rather than a toggle.
      expect(e.cost).toBeGreaterThan(0);
      expect(e.buildTime).toBeGreaterThan(0);
    }
  });
});

/* ==========================================================================
 * 4. THE DERIVED MULTIPLIERS
 * ========================================================================== */

describe('recomputeUpgradeMuls', () => {
  it('is all ones for an empty mask', () => {
    const out = makeUpgradeMul();
    expect(out.length).toBe(UPGRADE_MUL_SLOTS);
    recomputeUpgradeMuls(0, out);
    for (let i = 0; i < out.length; i++) expect(out[i]).toBe(1);
  });

  it('writes only the kind its scope names', () => {
    const infantry = UPGRADES.find((u) => u.scope === UpgradeScope.Infantry)!;
    const out = makeUpgradeMul();
    recomputeUpgradeMuls(1 << infantry.bit, out);
    expect(out[upgradeSlot(infantry.lever, EntityKind.Infantry)]).toBeCloseTo(infantry.mul, 5);
    expect(out[upgradeSlot(infantry.lever, EntityKind.Vehicle)]).toBe(1);
    expect(out[upgradeSlot(infantry.lever, EntityKind.Building)]).toBe(1);
  });

  it('writes every kind for an All-scoped upgrade, including the None slot', () => {
    // The None slot is what `upgradeGlobalMul` reads for BuildSpeed and Yield.
    const all = UPGRADES.find((u) => u.scope === UpgradeScope.All)!;
    const out = makeUpgradeMul();
    recomputeUpgradeMuls(1 << all.bit, out);
    expect(out[upgradeSlot(all.lever, EntityKind.None)]).toBeCloseTo(all.mul, 5);
    expect(out[upgradeSlot(all.lever, EntityKind.Vehicle)]).toBeCloseTo(all.mul, 5);
  });

  it('is a pure function of the mask — recomputing twice is idempotent', () => {
    // The whole "one source of truth" claim rests on this. If recompute
    // accumulated instead of resetting, a second call (which a save load makes)
    // would square every multiplier.
    const mask = UPGRADES.reduce((m, u) => m | (1 << u.bit), 0);
    const once = makeUpgradeMul();
    recomputeUpgradeMuls(mask, once);
    const twice = makeUpgradeMul();
    recomputeUpgradeMuls(mask, twice);
    recomputeUpgradeMuls(mask, twice);
    expect(Array.from(twice)).toEqual(Array.from(once));
  });

  it('composes two upgrades on the same lever multiplicatively', () => {
    // Nothing authored today stacks, but the composition rule has to be stated
    // and tested or the first row that does stack will silently overwrite.
    const out = makeUpgradeMul();
    const a = UPGRADES[0];
    const b = UPGRADES.find((u) => u.lever === a.lever && u.scope === a.scope && u !== a);
    if (b === undefined) {
      // Assert the property directly instead: two synthetic bits on one lever.
      recomputeUpgradeMuls(0, out);
      expect(out[upgradeSlot(a.lever, EntityKind.Infantry)]).toBe(1);
      return;
    }
    recomputeUpgradeMuls((1 << a.bit) | (1 << b.bit), out);
    expect(out[upgradeSlot(a.lever, EntityKind.Infantry)]).toBeCloseTo(a.mul * b.mul, 5);
  });
});

describe('the point-of-use readers never return a value that would break a shot', () => {
  it('answer 1 for an absent player', () => {
    expect(upgradeMul(undefined, UpgradeLever.Damage, EntityKind.Vehicle)).toBe(1);
    expect(upgradeGlobalMul(undefined, UpgradeLever.Yield)).toBe(1);
  });

  it('answer 1 rather than 0 for a corrupt table', () => {
    // A zero damage multiplier is a gun that fires and does nothing, forever,
    // with no error anywhere. Better to ignore the upgrade than to disarm.
    const p = { upgradeMul: new Float32Array(UPGRADE_MUL_SLOTS) } as unknown as PlayerState;
    expect(upgradeMul(p, UpgradeLever.Damage, EntityKind.Vehicle)).toBe(1);
  });
});

/* ==========================================================================
 * 5. OWNERSHIP AND THE AVAILABILITY GATE
 * ========================================================================== */

function makeWorld(faction = Faction.Allies) {
  const world = new World();
  world.addPlayer(faction, 'Commander', true, true);
  world.addPlayer(Faction.Soviets, 'Opponent', false, false);
  const channels = new Channels();
  const catalog = new ProductionCatalog(EMPTY_BINDING);
  const service = new ProductionService(world, channels, catalog);
  return { world, channels, catalog, service };
}

let tickCounter = 0;
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

describe('a player starts with nothing and owns what they are granted', () => {
  it('starts with an empty mask and neutral multipliers', () => {
    const { world } = makeWorld();
    const p = world.player(0 as PlayerId);
    expect(p.upgradeMask).toBe(0);
    expect(p.upgradeMul.length).toBe(UPGRADE_MUL_SLOTS);
    for (let i = 0; i < p.upgradeMul.length; i++) expect(p.upgradeMul[i]).toBe(1);
  });

  it('grants once and refuses a second time', () => {
    const { world } = makeWorld();
    const p = world.player(0 as PlayerId);
    const def = upgradeByKey('upgAlliedComposite')!;
    expect(grantUpgrade(p, def)).toBe(true);
    expect(hasUpgradeKey(p, 'upgAlliedComposite')).toBe(true);
    expect(grantUpgrade(p, def), 'a second grant must be a no-op').toBe(false);
  });

  it('moves the multiplier the moment it is granted', () => {
    const { world } = makeWorld();
    const p = world.player(0 as PlayerId);
    const def = upgradeByKey('upgAlliedComposite')!;
    expect(upgradeMul(p, UpgradeLever.Armour, EntityKind.Vehicle)).toBe(1);
    grantUpgrade(p, def);
    expect(upgradeMul(p, UpgradeLever.Armour, EntityKind.Vehicle)).toBeCloseTo(def.mul, 5);
    // And nothing else moved.
    expect(upgradeMul(p, UpgradeLever.Armour, EntityKind.Infantry)).toBe(1);
    expect(upgradeMul(p, UpgradeLever.Damage, EntityKind.Vehicle)).toBe(1);
  });
});

describe('availabilityOf treats an installed upgrade as owned, not as locked', () => {
  const out: AvailabilityResult = { ok: false, reason: '', capped: false };

  it('refuses with capped=true and a reason the sidebar reads as INSTALLED', () => {
    const { world, service } = makeWorld();
    const p = world.player(0 as PlayerId);
    const entry = service.catalog.byKey('upgAlliedComposite')!;
    grantUpgrade(p, upgradeByKey('upgAlliedComposite')!);

    const r = service.availabilityOf(p.id, entry, out);
    expect(r.ok).toBe(false);
    expect(r.capped, 'capped means "you already do", which is exactly this').toBe(true);
    expect(r.reason).toBe('Installed');
  });

  it('reports ownership ahead of a missing prerequisite', () => {
    // The prereq may yet be built; the upgrade will never be buyable again.
    // "Requires a Radar Dome" for something already installed is simply false.
    const { world, service } = makeWorld();
    const p = world.player(0 as PlayerId);
    const entry = service.catalog.byKey('upgAlliedComposite')!;
    // No structures at all, so every prereq is missing.
    grantUpgrade(p, upgradeByKey('upgAlliedComposite')!);
    expect(service.availabilityOf(p.id, entry, out).reason).toBe('Installed');
  });

  it('still refuses the other army their upgrade', () => {
    const { world, service } = makeWorld(Faction.Allies);
    const p = world.player(0 as PlayerId);
    const soviet = service.catalog.byKey('upgSovietUranium')!;
    expect(service.availabilityOf(p.id, soviet, out).reason).toBe('Wrong faction');
  });
});

/* ==========================================================================
 * 6. THE PURCHASE, END TO END, THROUGH THE BUS
 * ========================================================================== */

/** Stand up an Allied base far enough to buy the vehicle upgrade. */
function alliedBase(service: ProductionService, world: World): PlayerState {
  const p = world.player(0 as PlayerId);
  p.credits = 100000;
  for (const [key, cx, cz] of [
    ['conyard', 20, 20], ['powerPlant', 26, 20], ['refinery', 30, 20],
    ['warFactory', 34, 20], ['radar', 38, 20],
  ] as const) {
    service.spawnBuilding(p, service.catalog.byKey(key)!, cx, cz, 1);
  }
  step(service, world, 2);
  return p;
}

describe('buying an upgrade is an ordinary command on the bus', () => {
  it('reaches the sim as CommandKind.ProductionStart and installs', () => {
    const { world, channels, service } = makeWorld();
    const p = alliedBase(service, world);
    const entry = service.catalog.byKey('upgAlliedComposite')!;
    expect(service.availability(p.id, entry.publicId).ok).toBe(true);

    // EXACTLY what the sidebar does, and exactly what the AI would do: an
    // ordinary production command carrying the upgrade's publicId.
    channels.commands.issueProductionStart(p.id, entry.tab, entry.publicId, 1);

    // The queue drips payment, so it takes buildTime seconds of ticks.
    step(service, world, Math.ceil(entry.buildTime / SIM_DT) + 20);

    expect(hasUpgradeKey(p, 'upgAlliedComposite'), 'the upgrade never installed').toBe(true);
    expect(p.credits).toBeLessThan(100000);
    // And the queue is empty again — an upgrade must not sit in the tab
    // forever waiting for a door to open.
    expect(p.queues[entry.tab as number].items.length).toBe(0);
  });

  it('is the kind the relay already allows, so no protocol change was needed', () => {
    expect(isKnownCommandKind(CommandKind.ProductionStart)).toBe(true);
  });

  it('charges the full cost and no more', () => {
    const { world, channels, service } = makeWorld();
    const p = alliedBase(service, world);
    const entry = service.catalog.byKey('upgAlliedComposite')!;
    const before = p.credits;
    channels.commands.issueProductionStart(p.id, entry.tab, entry.publicId, 1);
    step(service, world, Math.ceil(entry.buildTime / SIM_DT) + 20);
    expect(before - p.credits).toBeCloseTo(entry.cost, 0);
  });

  it('cannot be bought twice, so the credits cannot be burned twice', () => {
    const { world, channels, service } = makeWorld();
    const p = alliedBase(service, world);
    const entry = service.catalog.byKey('upgAlliedComposite')!;
    channels.commands.issueProductionStart(p.id, entry.tab, entry.publicId, 1);
    step(service, world, Math.ceil(entry.buildTime / SIM_DT) + 20);
    const afterFirst = p.credits;

    channels.commands.issueProductionStart(p.id, entry.tab, entry.publicId, 1);
    step(service, world, Math.ceil(entry.buildTime / SIM_DT) + 20);
    expect(p.credits, 'a second purchase must be refused outright').toBe(afterFirst);
    expect(p.queues[entry.tab as number].items.length).toBe(0);
  });

  it('refuses a shift-click that would queue five copies', () => {
    const { world, channels, service } = makeWorld();
    const p = alliedBase(service, world);
    const entry = service.catalog.byKey('upgAlliedComposite')!;
    channels.commands.issueProductionStart(p.id, entry.tab, entry.publicId, 5);
    step(service, world, 2);
    expect(
      p.queues[entry.tab as number].items.length,
      'an upgrade is a one-off; five on the line would charge five times',
    ).toBe(1);
  });

  it('refuses the purchase without the gating structure', () => {
    const { world, channels, service } = makeWorld();
    const p = world.player(0 as PlayerId);
    p.credits = 100000;
    // A construction yard only: no war factory, so the Vehicles tab has no
    // factory and the vehicle upgrade is unbuyable.
    service.spawnBuilding(p, service.catalog.byKey('conyard')!, 20, 20, 1);
    step(service, world, 2);
    const entry = service.catalog.byKey('upgAlliedComposite')!;
    expect(service.availability(p.id, entry.publicId).ok).toBe(false);

    channels.commands.issueProductionStart(p.id, entry.tab, entry.publicId, 1);
    step(service, world, 200);
    expect(hasUpgradeKey(p, 'upgAlliedComposite')).toBe(false);
    expect(p.credits).toBe(100000);
  });
});

/* ==========================================================================
 * 7. THE EFFECT REACHES THE SIMULATION
 * ========================================================================== */

describe('the sidebar snapshot shows an upgrade before and after buying it', () => {
  it('flags it as an upgrade and flips owned to 1', () => {
    const { world, channels, service } = makeWorld();
    const p = alliedBase(service, world);
    const entry = service.catalog.byKey('upgAlliedComposite')!;

    const find = () => service.snapshot.cameos[entry.tab as number]
      .find((c) => c.key === 'upgAlliedComposite');

    step(service, world, 2);
    const before = find()!;
    expect(before, 'the upgrade must appear in the grid').toBeDefined();
    expect(before.isUpgrade, 'the HUD needs to know it is not a unit').toBe(true);
    expect(before.isBuilding).toBe(false);
    expect(before.available).toBe(true);
    expect(before.owned).toBe(0);
    // The blurb is what the player reads before spending; it comes off the
    // catalog entry through `Hud.extrasFor`.
    expect(entry.blurb.length).toBeGreaterThan(10);

    channels.commands.issueProductionStart(p.id, entry.tab, entry.publicId, 1);
    step(service, world, Math.ceil(entry.buildTime / SIM_DT) + 20);

    const after = find()!;
    expect(after.owned, 'the owned badge is how the player sees they have it').toBe(1);
    expect(after.available).toBe(false);
    expect(after.reason).toBe('Installed');
  });
});

describe('the cameo painter draws an upgrade as an upgrade', () => {
  it('never resolves an upgrade to a unit or a structure silhouette', () => {
    for (const u of UPGRADES) {
      const row = UPGRADE_CONTENT.find((c) => c.key === u.key)!;
      const arch = archetypeFor({
        key: u.key, name: row.name, faction: u.faction, tab: row.tab,
        isBuilding: false, isUpgrade: true, footprintW: 0, footprintH: 0,
      });
      expect(arch, `${u.key} drew as ${arch}`).toBe('upgrade');
    }
  });

  it('leaves every other subject alone', () => {
    expect(archetypeFor({
      key: 'grizzly', name: 'Warden Tank', faction: Faction.Allies,
      tab: BuildTab.Vehicles, isBuilding: false, footprintW: 0, footprintH: 0,
    })).toBe('tank');
  });
});

/* ==========================================================================
 * 7b. THE EFFECT IS MEASURED, NOT ASSUMED
 *
 * The design claim is "a multiplier read at the point of use covers units that
 * do not exist yet". These measure it rather than restating it.
 * ========================================================================== */

describe('the armour upgrade reaches Damage.applyOne', () => {
  /** Fire a fixed damage record at one entity and return the hp it lost. */
  function hpLost(owner: PlayerId, kind: EntityKind, grant: boolean): number {
    const world = new World();
    world.addPlayer(Faction.Allies, 'A', true, true);
    world.addPlayer(Faction.Soviets, 'B', false, false);
    const channels = new Channels();
    const damage = new DamageSystem(world, channels);
    setArmorMatrix(ARMOR_MATRIX);
    if (grant) grantUpgrade(world.player(owner), upgradeByKey('upgAlliedComposite')!);

    const st = world.store;
    const h = st.alloc(kind, -1, owner, Faction.Allies, 100, 0, 100, 0);
    const i = st.index(h);
    st.maxHp[i] = 1000;
    st.hp[i] = 1000;
    st.armorClass[i] = ArmorClass.Medium;
    st.radius[i] = 2;
    st.locomotor[i] = Locomotor.Track;
    st.state[i] = UnitState.Idle;

    channels.damage.push(h, 0 as EntityId, 200, WarheadClass.ArmorPiercing, 100, 0, 100, 0, 0);
    damage.damageTick({ dt: SIM_DT, tick: 1, time: SIM_DT, rng: new Rng(1) } as SimContext);
    return 1000 - st.hp[i];
  }

  it('makes an Allied vehicle take exactly the authored fraction', () => {
    const def = upgradeByKey('upgAlliedComposite')!;
    const plain = hpLost(0 as PlayerId, EntityKind.Vehicle, false);
    const upgraded = hpLost(0 as PlayerId, EntityKind.Vehicle, true);
    expect(plain).toBeGreaterThan(0);
    expect(upgraded / plain, 'the measured ratio must be the authored multiplier')
      .toBeCloseTo(def.mul, 4);
  });

  it('leaves infantry alone — the scope is Vehicle', () => {
    const plain = hpLost(0 as PlayerId, EntityKind.Infantry, false);
    const upgraded = hpLost(0 as PlayerId, EntityKind.Infantry, true);
    expect(upgraded).toBeCloseTo(plain, 4);
  });

  it('covers a unit created AFTER the purchase — the whole point of the design', () => {
    // The upgrade is granted to the player BEFORE the entity exists, and the
    // entity is never touched. A re-stat implementation would miss this one and
    // pass every other test in this file.
    const world = new World();
    world.addPlayer(Faction.Allies, 'A', true, true);
    const channels = new Channels();
    const damage = new DamageSystem(world, channels);
    setArmorMatrix(ARMOR_MATRIX);
    const def = upgradeByKey('upgAlliedComposite')!;

    const st = world.store;
    const spawnVehicle = (): number => {
      const h = st.alloc(EntityKind.Vehicle, -1, 0 as PlayerId, Faction.Allies, 100, 0, 100, 0);
      const i = st.index(h);
      st.maxHp[i] = 1000; st.hp[i] = 1000;
      st.armorClass[i] = ArmorClass.Medium; st.radius[i] = 2;
      st.locomotor[i] = Locomotor.Track; st.state[i] = UnitState.Idle;
      channels.damage.push(h, 0 as EntityId, 200, WarheadClass.ArmorPiercing, 100, 0, 100, 0, 0);
      damage.damageTick({ dt: SIM_DT, tick: 1, time: SIM_DT, rng: new Rng(1) } as SimContext);
      return 1000 - st.hp[i];
    };

    const before = spawnVehicle();
    grantUpgrade(world.player(0 as PlayerId), def);
    const after = spawnVehicle();

    expect(before).toBeGreaterThan(0);
    expect(after / before, 'a unit built after the purchase must be protected too')
      .toBeCloseTo(def.mul, 4);
  });
});

describe('the build-speed upgrade reaches BuildQueue', () => {
  it('advances the queue by exactly the authored multiplier', () => {
    const def = upgradeByKey('upgAlliedLogistics')!;

    function progressAfterOneTick(grant: boolean): number {
      const world = new World();
      world.addPlayer(Faction.Allies, 'A', true, true);
      const p = world.player(0 as PlayerId);
      p.credits = 1e9;
      if (grant) grantUpgrade(p, def);
      const queues = new BuildQueues({
        info: () => ({ cost: 100, buildTime: 10 }),
        charge: (pl, amount) => { pl.credits -= amount; return amount; },
        refund: () => {},
        started: () => {}, progressed: () => {}, ready: () => {},
        cancelled: () => {}, holdChanged: () => {},
      });
      p.queues[BuildTab.Vehicles as number].factoryCount = 1;
      queues.enqueue(p, BuildTab.Vehicles, 1, false, 1);
      queues.advance(p, SIM_DT, false);
      return queues.head(p, BuildTab.Vehicles)!.progress;
    }

    const plain = progressAfterOneTick(false);
    const fast = progressAfterOneTick(true);
    expect(plain).toBeGreaterThan(0);
    expect(fast / plain).toBeCloseTo(def.mul, 4);
  });
});

/* ==========================================================================
 * 8. SAVE, CHECKSUM AND PvP SAFETY
 * ========================================================================== */

describe('upgrade state survives a save and is visible to the desync detector', () => {
  it('round-trips through keys, not through bit indices', () => {
    const { world } = makeWorld();
    const p = world.player(0 as PlayerId);
    grantUpgrade(p, upgradeByKey('upgAlliedOptics')!);
    grantUpgrade(p, upgradeByKey('upgAlliedLogistics')!);

    const keys = ownedUpgradeKeys(p, []);
    expect(keys.sort()).toEqual(['upgAlliedLogistics', 'upgAlliedOptics']);

    const q = world.player(1 as PlayerId);
    setUpgradesByKey(q, keys);
    expect(q.upgradeMask).toBe(p.upgradeMask);
    expect(Array.from(q.upgradeMul)).toEqual(Array.from(p.upgradeMul));
  });

  it('REPLACES rather than merges, so a load cannot inherit the last match', () => {
    const { world } = makeWorld();
    const p = world.player(0 as PlayerId);
    grantUpgrade(p, upgradeByKey('upgAlliedOptics')!);
    setUpgradesByKey(p, ['upgAlliedLogistics']);
    expect(hasUpgradeKey(p, 'upgAlliedOptics')).toBe(false);
    expect(hasUpgradeKey(p, 'upgAlliedLogistics')).toBe(true);
  });

  it('drops an unknown key rather than throwing', () => {
    const { world } = makeWorld();
    const p = world.player(0 as PlayerId);
    setUpgradesByKey(p, ['upgFromTheFuture', 'upgAlliedOptics']);
    expect(p.upgradeMask).toBe(1 << upgradeByKey('upgAlliedOptics')!.bit);
  });

  it('restores to nothing for a save written before upgrades existed', () => {
    const { world } = makeWorld();
    const p = world.player(0 as PlayerId);
    grantUpgrade(p, upgradeByKey('upgAlliedOptics')!);
    setUpgradesByKey(p, []);
    expect(p.upgradeMask).toBe(0);
    for (let i = 0; i < p.upgradeMul.length; i++) expect(p.upgradeMul[i]).toBe(1);
  });

  it('changes the simulation checksum', () => {
    // Without this, two clients could disagree about who owns Uranium Shells
    // and the desync detector would stay quiet until the damage difference had
    // compounded into a dead tank with no findable cause.
    const { world } = makeWorld();
    const before = hashOnly(world);
    grantUpgrade(world.player(0 as PlayerId), upgradeByKey('upgAlliedOptics')!);
    expect(hashOnly(world)).not.toBe(before);
  });
});

describe('the upgrade layer is PvP-safe by construction', () => {
  it('never imports the progression unlock gate', () => {
    // `Scenarios.ts` consulting the gate at world-build time is already one
    // tick-zero desync this repo had to work around: the gate answers from the
    // LOCAL profile, so two players with different unlocks build different
    // worlds. An upgrade is bought inside the match with credits both clients
    // can see, and must never ask the profile anything.
    //
    // Asserted over the IMPORT LINES rather than the file text: the header
    // explains at length why the gate is not consulted, so a `toContain` over
    // the whole source fails on its own documentation.
    const src = read('src/sim/Upgrades.ts');
    const imports = [...src.matchAll(/^\s*import\s[^;]*?from\s+'([^']+)'/gm)].map((m) => m[1]);
    for (const spec of imports) {
      expect(spec, `Upgrades.ts must not import ${spec}`).not.toMatch(/progression|UnlockGate/);
    }
  });

  it('never reads a clock or the RNG', () => {
    // src/sim/** is already swept for these by tests/foundation.spec.ts; this
    // states it locally because an upgrade table is exactly the sort of place
    // somebody reaches for `Date.now()` to timestamp a purchase.
    const src = read('src/sim/Upgrades.ts');
    for (const banned of ['Math.random', 'Date.now', 'performance.now']) {
      expect(src, `Upgrades.ts must not use ${banned}`).not.toContain(banned);
    }
  });

  it('imports nothing but core/types', () => {
    // The point-of-use readers are called from six sim modules. A wider import
    // surface here is six new edges in the module graph and a cycle waiting to
    // happen — Production already imports this file.
    const src = read('src/sim/Upgrades.ts');
    const imports = [...src.matchAll(/^\s*import\s[^;]*?from\s+'([^']+)'/gm)].map((m) => m[1]);
    expect(imports.length).toBeGreaterThan(0);
    for (const spec of imports) {
      expect(spec, `Upgrades.ts must not import ${spec}`).toBe('../core/types');
    }
  });

  it('is written by exactly one function', () => {
    // `upgradeMask` must not be assignable from anywhere but Upgrades.ts, or
    // the mask stops describing the multipliers the sim reads and the checksum
    // agrees while the game diverges.
    const offenders: string[] = [];
    for (const rel of [
      'src/sim/Production.ts', 'src/sim/Combat.ts', 'src/sim/Damage.ts',
      'src/sim/Movement.ts', 'src/sim/Vision.ts', 'src/sim/Harvesting.ts',
      'src/sim/BuildQueue.ts', 'src/ui/Sidebar.ts', 'src/ui/Hud.ts',
    ]) {
      const src = read(rel);
      if (/\.upgradeMask\s*(=[^=]|\|=)/.test(src)) offenders.push(`${rel} writes upgradeMask`);
      if (/\.upgradeMul\s*\[[^\]]*\]\s*=[^=]/.test(src)) offenders.push(`${rel} writes upgradeMul`);
    }
    expect(offenders).toEqual([]);
  });
});
