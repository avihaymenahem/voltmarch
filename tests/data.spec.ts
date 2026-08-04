/**
 * The content layer and the id spaces around it.
 *
 * These are integration tests, not unit tests: every one of them guards a seam
 * that was actually broken when `src/data/Defs.ts` landed, and would silently
 * re-break the moment someone appends a row to the wrong table.
 */

import { describe, it, expect } from 'vitest';

import { DEF_TABLES, UNITS, BUILDINGS, WEAPONS } from '../src/data/Defs';
import {
  FALLBACK_BUILDINGS, FALLBACK_PROPS, FALLBACK_UNITS, PROP_DEF_BASE, PROP_DEF_ID,
  resolveDefBinding,
} from '../src/game/Scenarios';
import { DEFAULT_WEAPONS, weaponIndexOf } from '../src/sim/Combat';
import { ARMOR_MATRIX } from '../src/core/config';
import { BuildKind, ProductionCatalog, UNIT_PUBLIC_ID_BASE } from '../src/sim/Production';

describe('DefTables shape', () => {
  it('satisfies the duck-type resolveDefBinding() looks for', () => {
    expect(Array.isArray(DEF_TABLES.units)).toBe(true);
    expect(Array.isArray(DEF_TABLES.buildings)).toBe(true);
    expect(DEF_TABLES.unitByKey).toBeInstanceOf(Map);
    expect(DEF_TABLES.buildingByKey).toBeInstanceOf(Map);
    expect(DEF_TABLES.armorMatrix).toBe(ARMOR_MATRIX);
  });

  it('keeps the sim armoury as its prefix, by identity, not by value', () => {
    // The third faction appends its guns, so the tables are no longer the same
    // array — but the PREFIX PROPERTY is the invariant that actually mattered.
    // `store.weaponIndex` is a bare integer, and every unit spawned before
    // `setWeaponTable(WEAPONS)` runs indexes DEFAULT_WEAPONS; if a row were
    // ever INSERTED rather than appended, the two tables would disagree from
    // that row on and every unit in the game would fire its neighbour's gun
    // with no error message at all.
    expect(DEF_TABLES.weapons).toBe(WEAPONS);
    expect(WEAPONS.length).toBeGreaterThanOrEqual(DEFAULT_WEAPONS.length);
    for (let i = 0; i < DEFAULT_WEAPONS.length; i++) {
      expect(WEAPONS[i], `weapon row ${i}`).toBe(DEFAULT_WEAPONS[i]);
    }
    // Appended rows must be new keys, never shadowed spellings of old ones.
    const keys = WEAPONS.map((w) => w.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('has no duplicate keys and indexes them all', () => {
    expect(DEF_TABLES.unitByKey.size).toBe(UNITS.length);
    expect(DEF_TABLES.buildingByKey.size).toBe(BUILDINGS.length);
    for (let i = 0; i < UNITS.length; i++) expect(DEF_TABLES.unitByKey.get(UNITS[i].key)).toBe(i);
    for (let i = 0; i < BUILDINGS.length; i++) {
      expect(DEF_TABLES.buildingByKey.get(BUILDINGS[i].key)).toBe(i);
    }
  });
});

describe('content vocabulary', () => {
  it('covers every key a scenario can spawn', async () => {
    const binding = await resolveDefBinding();
    expect(binding.tables).not.toBeNull();

    const missingUnits = Object.keys(FALLBACK_UNITS).filter((k) => (binding.unitId[k] ?? -1) < 0);
    const missingBuildings = Object.keys(FALLBACK_BUILDINGS)
      .filter((k) => (binding.buildingId[k] ?? -1) < 0);

    // An unbound key is not a crash — it is an entity that silently draws its
    // faction's default model, which is exactly the defect this file exists to
    // stop from coming back.
    expect(missingUnits, `unbound unit keys: ${missingUnits.join(', ')}`).toEqual([]);
    expect(missingBuildings, `unbound building keys: ${missingBuildings.join(', ')}`).toEqual([]);
  });

  it('arms the units that should be armed and leaves the rest alone', async () => {
    const byKey = DEF_TABLES.unitByKey;
    const weaponOf = (key: string): number => UNITS[byKey.get(key)!].weapons[0] ?? -1;

    expect(weaponOf('grizzly')).toBe(weaponIndexOf('lightCannon'));
    expect(weaponOf('rhino')).toBe(weaponIndexOf('heavyCannon'));
    expect(weaponOf('prismTank')).toBe(weaponIndexOf('prismBeam'));
    expect(weaponOf('conscript')).toBe(weaponIndexOf('conscriptRifle'));

    for (const key of ['harvester', 'mcv', 'engineer', 'transport']) {
      expect(UNITS[byKey.get(key)!].weapons.length, `${key} must be unarmed`).toBe(0);
    }
  });

  it('gives every defence a weapon and no other structure one', () => {
    const armed = BUILDINGS.filter((b) => b.weapons.length > 0).map((b) => b.key).sort();
    expect(armed).toEqual([
      'aaTurret', 'flameTower', 'mrdGlaive', 'mrdHelios', 'pillbox', 'prismTower',
      'rclPylon', 'rclSpitpost', 'sentryGun', 'teslaCoil',
    ]);
    // Walls are never armed, in any army. A wall with a gun is a defence that
    // costs 100 credits and the placement rules of fencing.
    for (const key of ['wall', 'mrdRampart', 'rclBarricade']) {
      const b = BUILDINGS[DEF_TABLES.buildingByKey.get(key)!];
      expect(b.weapons.length, `${key} must be unarmed`).toBe(0);
    }
  });
});

describe('id spaces do not collide', () => {
  it('separates unit and building publicIds', async () => {
    const catalog = new ProductionCatalog(await resolveDefBinding());
    expect(catalog.bound).toBe(true);

    const seen = new Map<number, string>();
    for (const e of catalog.entries) {
      const clash = seen.get(e.publicId);
      expect(clash, `publicId ${e.publicId} claimed by both "${clash}" and "${e.key}"`)
        .toBeUndefined();
      seen.set(e.publicId, e.key);
    }
  });

  it('round-trips every publicId back to its own entry with no hint', async () => {
    // THE REGRESSION. `units[7]` is the Rhino and `buildings[7]` is the Naval
    // Yard; `resolve()` with no isBuilding hint used to answer with the
    // building, so a Soviet AI asking "can I build a Rhino" was told "Wrong
    // faction" about an Allied structure, forever.
    const catalog = new ProductionCatalog(await resolveDefBinding());
    for (const e of catalog.entries) {
      expect(catalog.resolve(e.publicId)?.key, `publicId ${e.publicId} (${e.key})`).toBe(e.key);
    }
  });

  it('still accepts a bare def index when the caller supplies the hint', async () => {
    // This is the command path: `handleCommand` derives isBuilding from the tab
    // and the HUD may hand over a raw table index.
    const catalog = new ProductionCatalog(await resolveDefBinding());
    for (const e of catalog.entries) {
      if (e.defId < 0) continue;
      const isBuilding = e.kind === BuildKind.Building;
      expect(catalog.resolve(e.defId, isBuilding)?.key).toBe(e.key);
      expect(catalog.resolve(e.publicId, isBuilding)?.key).toBe(e.key);
    }
  });

  it('keeps prop defIds clear of both def tables', () => {
    expect(PROP_DEF_BASE).toBeGreaterThan(UNITS.length);
    expect(PROP_DEF_BASE).toBeGreaterThan(BUILDINGS.length);
    expect(PROP_DEF_BASE).toBeLessThan(UNIT_PUBLIC_ID_BASE);

    const ids = Object.keys(FALLBACK_PROPS).map((k) => PROP_DEF_ID[k]);
    expect(new Set(ids).size, 'prop defIds must be unique').toBe(ids.length);
    for (const id of ids) {
      expect(id).toBeGreaterThanOrEqual(PROP_DEF_BASE);
      // Int16Array column, so the whole namespace must fit.
      expect(id).toBeLessThan(32767);
    }
  });
});

describe('the def table does not silently re-balance the game', () => {
  it('matches the fallback stats a scenario used before content existed', () => {
    // `spawnUnit` prefers the def for every field it carries, so a disagreement
    // here changes unit behaviour as a side effect of fixing the ART binding.
    for (const def of UNITS) {
      const fb = FALLBACK_UNITS[def.key];
      if (fb === undefined) {
        // Every content key must carry a fallback row. The Meridian rows landed
        // in Scenarios.ts, so nothing should reach here any more — this arm is
        // kept as the escape hatch for the NEXT faction, and it is deliberately
        // narrow so a typo'd key cannot use it.
        expect(def.key.startsWith('mrd'), `no fallback for ${def.key}`).toBe(true);
        continue;
      }
      expect(def.maxHp, def.key).toBe(fb.maxHp);
      expect(def.armor, def.key).toBe(fb.armor);
      expect(def.maxSpeed, def.key).toBe(fb.maxSpeed);
      expect(def.sight, def.key).toBe(fb.sight);
      expect(def.locomotor, def.key).toBe(fb.locomotor);
      expect(def.cargoMax, def.key).toBe(fb.cargoMax);
      expect(def.crushLevel, def.key).toBe(fb.crushLevel);
      expect(def.crushableBy, def.key).toBe(fb.crushableBy);
      // The radius spawnUnit derived when there was no def.
      expect(def.radius, def.key).toBeCloseTo(Math.max(fb.width, fb.length) * 0.45, 6);
    }

    for (const def of BUILDINGS) {
      const fb = FALLBACK_BUILDINGS[def.key];
      if (fb === undefined) {
        expect(def.key.startsWith('mrd'), `no fallback for ${def.key}`).toBe(true);
        continue;
      }
      expect(def.maxHp, def.key).toBe(fb.maxHp);
      expect(def.footprintW, def.key).toBe(fb.footprintW);
      expect(def.footprintH, def.key).toBe(fb.footprintH);
      expect(def.power, def.key).toBe(fb.power);
      expect(def.sight, def.key).toBe(fb.sight);
      expect(def.storage, def.key).toBe(fb.storage);
    }
  });

  it('spawns vehicles clear of the factory that built them', () => {
    // A 7 m Rhino leaving a 3x2 War Factory nose-first needs the exit outside
    // the blocked footprint or it spawns inside its own parent.
    const wf = BUILDINGS[DEF_TABLES.buildingByKey.get('warFactory')!];
    expect(wf.exitOffsetZ).toBeGreaterThan(wf.footprintH * 4 * 0.5 + 3);
  });
});
