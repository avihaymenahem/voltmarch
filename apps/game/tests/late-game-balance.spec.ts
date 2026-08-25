/**
 * Late-game balance harness.
 *
 * This is the cheap deterministic layer that runs in CI before the slower
 * terrain/pathing probes. It uses the live unit, weapon, armour, upgrade and
 * prebuilt-defense numbers to grade four 24-unit combined-arms assaults at
 * rookie and late-game strength. Set VM_BALANCE_REPORT=1 to print the matrix.
 */

import { describe, expect, it } from 'vitest';

import {
  ARMOR_MATRIX, COMBAT_DAMAGE, COMBAT_WEAPONS, VETERANCY_DAMAGE, VETERANCY_HP,
} from '../src/core/config';
import {
  ArmorClass, EntityKind, Faction, UpgradeLever, UpgradeScope,
} from '../src/core/types';
import type { BuildingDef, UnitDef, WeaponDef } from '../src/core/types';
import { BUILDINGS, DEF_TABLES, UNITS, WEAPONS } from '../src/data/Defs';
import { UPGRADES } from '../src/sim/Upgrades';

const unit = (key: string): UnitDef => UNITS[DEF_TABLES.unitByKey.get(key)!];
const building = (key: string): BuildingDef => BUILDINGS[DEF_TABLES.buildingByKey.get(key)!];
const weapon = (index: number): WeaponDef => WEAPONS[index];

function factionName(faction: Faction): string {
  switch (faction) {
    case Faction.Allies: return 'Allies';
    case Faction.Soviets: return 'Soviets';
    case Faction.Meridian: return 'Meridian';
    case Faction.Reclaim: return 'Reclaim';
    default: return 'Neutral';
  }
}

function cycle(w: WeaponDef): number {
  return w.cooldown + Math.max(0, w.burstCount - 1) * w.burstDelay;
}

function dps(w: WeaponDef, armour: ArmorClass): number {
  if (!w.canTargetGround) return 0;
  return (w.damage * w.burstCount / cycle(w))
    * ARMOR_MATRIX[w.warhead][armour]
    * COMBAT_DAMAGE.globalMul;
}

function unitDps(u: UnitDef, armour: ArmorClass): number {
  return u.weapons.reduce((sum, index) => sum + dps(weapon(index), armour), 0);
}

function buildingDps(b: BuildingDef, armour: ArmorClass): number {
  return b.weapons.reduce((sum, index) => sum + dps(weapon(index), armour), 0);
}

interface ArmySlot { readonly key: string; readonly count: number }

const ARMIES: Readonly<Record<number, readonly ArmySlot[]>> = {
  [Faction.Allies]: [
    { key: 'gi', count: 8 }, { key: 'javelin', count: 4 },
    { key: 'grizzly', count: 8 }, { key: 'prismTank', count: 4 },
  ],
  [Faction.Soviets]: [
    { key: 'conscript', count: 8 }, { key: 'flakTrooper', count: 4 },
    { key: 'rhino', count: 8 }, { key: 'v4', count: 4 },
  ],
  [Faction.Meridian]: [
    { key: 'mrdWayfarer', count: 8 }, { key: 'mrdLancer', count: 4 },
    { key: 'mrdSolarch', count: 8 }, { key: 'mrdZenith', count: 4 },
  ],
  [Faction.Reclaim]: [
    { key: 'rclPicker', count: 10 }, { key: 'rclSlagger', count: 4 },
    { key: 'rclGrinder', count: 6 }, { key: 'rclSlaghurler', count: 4 },
  ],
};

const BASE_DEFENCES: Readonly<Record<number, readonly string[]>> = {
  [Faction.Allies]: ['pillbox', 'pillbox', 'pillbox', 'prismTower'],
  [Faction.Soviets]: ['sentryGun', 'teslaCoil', 'sentryGun', 'flameTower', 'flameTower'],
  [Faction.Meridian]: ['mrdGlaive', 'mrdGlaive', 'mrdGlaive', 'mrdHelios'],
  [Faction.Reclaim]: ['rclSpitpost', 'rclSpitpost', 'rclSpitpost', 'rclPylon'],
};

const SIEGE: Readonly<Record<number, string>> = {
  [Faction.Allies]: 'prismTank',
  [Faction.Soviets]: 'v4',
  [Faction.Meridian]: 'mrdZenith',
  [Faction.Reclaim]: 'rclSlaghurler',
};

function offensiveUpgradeMul(faction: Faction): number {
  let out = 1;
  for (const upgrade of UPGRADES) {
    if (upgrade.faction !== faction) continue;
    if (upgrade.scope !== UpgradeScope.Vehicle && upgrade.scope !== UpgradeScope.All) continue;
    if (upgrade.lever === UpgradeLever.Damage) out *= upgrade.mul;
    if (upgrade.lever === UpgradeLever.Cooldown) out /= upgrade.mul;
  }
  return out;
}

interface AssaultMetric {
  matchup: string;
  units: number;
  credits: number;
  concreteDps: number;
  firstDefenceSeconds: number;
  defenceHeavyDps: number;
  projectedLossesAt10s: number;
}

function assaultMetric(attacker: Faction, defender: Faction): AssaultMetric {
  const army = ARMIES[attacker];
  const base = BASE_DEFENCES[defender];
  let units = 0;
  let credits = 0;
  let hp = 0;
  let concreteDps = 0;
  for (const slot of army) {
    const def = unit(slot.key);
    units += slot.count;
    credits += def.cost * slot.count;
    hp += def.maxHp * slot.count;
    concreteDps += unitDps(def, ArmorClass.Concrete) * slot.count;
  }
  const defenceHeavyDps = base.reduce(
    (sum, key) => sum + buildingDps(building(key), ArmorClass.Heavy), 0,
  );
  let averageIncomingDps = 0;
  for (const defenceKey of base) {
    const defence = building(defenceKey);
    for (const slot of army) {
      const target = unit(slot.key);
      averageIncomingDps += defence.weapons.reduce(
        (sum, index) => sum + dps(weapon(index), target.armor), 0,
      ) * slot.count / units;
    }
  }
  const firstHp = Math.min(...base.map((key) => building(key).maxHp));
  const averageHp = hp / units;
  return {
    matchup: `${factionName(attacker)} -> ${factionName(defender)}`,
    units,
    credits,
    concreteDps: Number(concreteDps.toFixed(1)),
    firstDefenceSeconds: Number((firstHp / concreteDps).toFixed(2)),
    defenceHeavyDps: Number(defenceHeavyDps.toFixed(1)),
    projectedLossesAt10s: Number(Math.min(units, averageIncomingDps * 10 / averageHp).toFixed(1)),
  };
}

describe('late-game balance envelope', () => {
  it('grades a 24-unit mixed assault for every faction', () => {
    const factions = [Faction.Allies, Faction.Soviets, Faction.Meridian, Faction.Reclaim];
    const report = factions.flatMap(
      (attacker) => factions.map((defender) => assaultMetric(attacker, defender)),
    );
    for (const row of report) {
      expect(row.units, `${row.matchup}: harness composition drifted`).toBe(24);
      expect(row.concreteDps, `${row.matchup}: no base damage`).toBeGreaterThan(0);
      expect(row.firstDefenceSeconds, `${row.matchup}: cannot crack the first emplacement`)
        .toBeLessThan(6);
      expect(row.projectedLossesAt10s).toBeGreaterThan(0);
    }
    if (process.env.VM_BALANCE_REPORT === '1') console.table(report);
  });

  it('gives every faction siege that outranges every emplacement', () => {
    const maxTowerRange = Math.max(...BUILDINGS.flatMap(
      (b) => b.weapons.map((index) => weapon(index).range),
    ));
    for (const faction of [Faction.Allies, Faction.Soviets, Faction.Meridian, Faction.Reclaim]) {
      const siege = unit(SIEGE[faction]);
      const gun = weapon(siege.weapons[0]);
      expect(gun.range, `${siege.name}: is labelled siege but must enter tower range`)
        .toBeGreaterThanOrEqual(maxTowerRange + 4);
      expect(dps(gun, ArmorClass.Concrete), `${siege.name}: range without base damage`)
        .toBeGreaterThan(18);
    }
  });

  it('keeps elite mirrors close to rookie pacing', () => {
    const eliteDps = VETERANCY_DAMAGE[2] / COMBAT_WEAPONS.vetCooldownMul[2];
    const eliteMirrorTtk = VETERANCY_HP[2] / eliteDps;
    expect(eliteDps).toBeLessThanOrEqual(1.40);
    expect(eliteMirrorTtk, 'elite-vs-elite combat became much faster than rookie mirrors')
      .toBeGreaterThanOrEqual(0.90);
  });

  it('caps elite plus offensive-upgrade burst below 1.6x rookie output', () => {
    const eliteDps = VETERANCY_DAMAGE[2] / COMBAT_WEAPONS.vetCooldownMul[2];
    for (const faction of [Faction.Allies, Faction.Soviets, Faction.Meridian, Faction.Reclaim]) {
      expect(eliteDps * offensiveUpgradeMul(faction), factionName(faction)).toBeLessThanOrEqual(1.60);
    }
  });

  it('keeps the Soviet prebuilt line heavy but no longer triple-Tesla lethal', () => {
    const allied = assaultMetric(Faction.Allies, Faction.Allies).defenceHeavyDps;
    const soviet = assaultMetric(Faction.Allies, Faction.Soviets).defenceHeavyDps;
    expect(soviet).toBeGreaterThan(allied);
    expect(soviet / allied).toBeLessThanOrEqual(2.0);
  });

  it('keeps the AA Battery specialized against aircraft', () => {
    const aa = weapon(building('aaTurret').weapons[0]);
    expect(aa.canTargetAir).toBe(true);
    expect(aa.canTargetGround).toBe(false);
  });

  it('does not use a global damage cut to manufacture these results', () => {
    expect(COMBAT_DAMAGE.globalMul).toBe(0.80);
  });

  it('keeps all assault units on the live combat layer', () => {
    for (const slots of Object.values(ARMIES)) {
      for (const slot of slots) {
        expect(unit(slot.key).kind).not.toBe(EntityKind.Building);
        expect(unit(slot.key).weapons.length, slot.key).toBeGreaterThan(0);
      }
    }
  });
});
