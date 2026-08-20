/**
 * THE MERIDIAN PACT — the third faction, end to end.
 *
 * Four seams, each of which was either broken or nearly broken while the
 * faction was being built:
 *
 *   1. The content layer. Ids, prereqs, factions and the appended armoury.
 *   2. The balance envelope. Not "is this fun" — that is not testable — but
 *      "is any number here outside the range the other two armies live in",
 *      which catches a fat finger in a stat block instantly.
 *   3. The AI's doctrine. A Pact brain that cannot resolve its own build order
 *      does nothing at all and looks exactly like an idle AI.
 *   4. The art. Both factories REJECT on a band miss, so a mass list that
 *      drifts out of R8 takes the model off the map with one console line.
 */

import { describe, it, expect } from 'vitest';

import {
  BUILDINGS, DEF_TABLES, FACTIONS, FACTION_MERIDIAN, MERIDIAN_LOOK, MERIDIAN_WEAPONS,
  UNITS, WEAPONS,
} from '../src/data/Defs';
import { DEFAULT_WEAPONS } from '../src/sim/Combat';
import { ArmorClass, BuildTab, EntityFlag, EntityKind, Faction, Locomotor } from '../src/core/types';
import {
  BuildCatalog, BuildRole, FACTION_MERIDIAN as AI_FACTION_MERIDIAN, openingFor,
} from '../src/sim/AIStrategy';
import { formatStats, MassRole } from '../src/art/MassList';
import {
  MERIDIAN_UNIT_MASS_LISTS, MERIDIAN_UNIT_MODELS, MERIDIAN_UNIT_PALETTE, meridianUnitLibrary,
} from '../src/art/Faction3Units';
import {
  MERIDIAN_PAD_PALETTE, MERIDIAN_STRUCTURE_MASS_LISTS, MERIDIAN_STRUCTURE_MODELS,
  MERIDIAN_STRUCTURE_PALETTE, meridianBuildingLibrary,
} from '../src/art/Faction3Buildings';

const mrdUnits = UNITS.filter((u) => (u.faction as number) === (FACTION_MERIDIAN as number));
const mrdBuildings = BUILDINGS.filter((b) => (b.faction as number) === (FACTION_MERIDIAN as number));

describe('the Meridian Pact — content', () => {
  it('claims faction slot 3 and nothing else does', () => {
    expect(FACTION_MERIDIAN as number).toBe(3);
    expect(AI_FACTION_MERIDIAN as number).toBe(FACTION_MERIDIAN as number);
    for (const f of [Faction.Neutral, Faction.Allies, Faction.Soviets]) {
      expect(f as number).not.toBe(FACTION_MERIDIAN as number);
    }
    const def = FACTIONS.find((f) => (f.id as number) === (FACTION_MERIDIAN as number));
    expect(def).toBeDefined();
    expect(def!.key).toBe('meridian');
    expect(def!.conYardKey).toBe('mrdConclave');
  });

  it('fields a complete roster', () => {
    const infantry = mrdUnits.filter((u) => u.kind === EntityKind.Infantry);
    const vehicles = mrdUnits.filter((u) => u.kind === EntityKind.Vehicle);
    expect(infantry.length).toBeGreaterThanOrEqual(3);
    expect(vehicles.length).toBeGreaterThanOrEqual(4);
    expect(mrdBuildings.length).toBeGreaterThanOrEqual(11);

    // The build must be reachable: every structure that produces something, and
    // the harvester / MCV / walls / two defences the brief calls for.
    for (const key of [
      'mrdConclave', 'mrdSolarArray', 'mrdChapterhouse', 'mrdCistern', 'mrdForgeyard',
      'mrdOculus', 'mrdReliquary', 'mrdVault', 'mrdSlipway', 'mrdRampart',
      'mrdGlaive', 'mrdHelios',
    ]) {
      expect(DEF_TABLES.buildingByKey.has(key), key).toBe(true);
    }
    for (const key of [
      'mrdWayfarer', 'mrdLancer', 'mrdArtificer', 'mrdCollector', 'mrdSkiff',
      'mrdSolarch', 'mrdZenith', 'mrdCarryall', 'mrdKestrel', 'mrdCorvette', 'mrdMonitor',
    ]) {
      expect(DEF_TABLES.unitByKey.has(key), key).toBe(true);
    }
  });

  it('routes every unit through a producer that can actually build it', () => {
    const producedBy = new Map<string, string>();
    for (const b of mrdBuildings) {
      for (const u of b.produces) producedBy.set(u, b.key);
    }
    for (const u of mrdUnits) {
      const factory = producedBy.get(u.key);
      expect(factory, `${u.key} is buildable by nothing`).toBeDefined();
      // The factory must itself be a prerequisite of the unit, or the unit
      // appears in a sidebar tab the player has no building for.
      expect(u.prereqs, u.key).toContain(factory!);
    }
  });

  it('appends its armoury without disturbing the sim table', () => {
    // The Pact's rows occupy the slice immediately after the sim's table. A
    // fourth faction appends AFTER them, so the length is >= rather than ==;
    // what must not move is where the Meridian block starts.
    expect(WEAPONS.length).toBeGreaterThanOrEqual(
      DEFAULT_WEAPONS.length + MERIDIAN_WEAPONS.length);
    for (let i = 0; i < DEFAULT_WEAPONS.length; i++) expect(WEAPONS[i]).toBe(DEFAULT_WEAPONS[i]);
    for (let i = 0; i < MERIDIAN_WEAPONS.length; i++) {
      expect(WEAPONS[DEFAULT_WEAPONS.length + i], `meridian weapon ${i}`)
        .toBe(MERIDIAN_WEAPONS[i]);
    }
    for (const u of mrdUnits) {
      for (const i of u.weapons) {
        // Every Pact gun must be one of the APPENDED rows — a Pact unit firing
        // a Soviet weapon index is the exact failure the prefix rule protects.
        expect(i, u.key).toBeGreaterThanOrEqual(DEFAULT_WEAPONS.length);
        expect(i, u.key).toBeLessThan(WEAPONS.length);
      }
    }
  });

  it('sets the entity flags nothing else will set for it', () => {
    // The Pact keys have no `FALLBACK_UNITS` row, so `def.flags` is the ONLY
    // source of IsHarvester / CanAttack / CanMove for these units.
    const byKey = (k: string) => UNITS[DEF_TABLES.unitByKey.get(k)!];
    expect(byKey('mrdCollector').flags & EntityFlag.IsHarvester).toBeTruthy();
    expect(byKey('mrdCollector').cargoMax).toBeGreaterThan(0);
    expect(byKey('mrdSolarch').flags & EntityFlag.HasTurret).toBeTruthy();
    expect(byKey('mrdArtificer').flags & EntityFlag.CanAttack).toBeFalsy();
    expect(byKey('mrdArtificer').canCapture).toBe(true);
    for (const u of mrdUnits) {
      expect(u.flags & EntityFlag.CanMove, u.key).toBeTruthy();
      expect(u.flags & EntityFlag.ProvidesVision, u.key).toBeTruthy();
      expect(Boolean(u.flags & EntityFlag.CanAttack), u.key).toBe(u.weapons.length > 0);
    }
    for (const b of mrdBuildings) {
      expect(b.flags & EntityFlag.BlocksNav, b.key).toBeTruthy();
      // A structure that consumes power must go dark in a brownout; one that
      // makes it obviously must not.
      expect(Boolean(b.flags & EntityFlag.NeedsPower), b.key).toBe(b.power < 0);
    }
  });
});

describe('the Meridian Pact — balance envelope', () => {
  it('prices its army inside the range the other two armies live in', () => {
    const others = UNITS.filter((u) => (u.faction as number) !== (FACTION_MERIDIAN as number));
    const lo = Math.min(...others.map((u) => u.cost));
    const hi = Math.max(...others.map((u) => u.cost));
    for (const u of mrdUnits) {
      expect(u.cost, u.key).toBeGreaterThanOrEqual(lo);
      expect(u.cost, u.key).toBeLessThanOrEqual(hi);
      expect(u.buildTime, u.key).toBeGreaterThan(0);
      expect(u.maxHp, u.key).toBeGreaterThan(0);
    }
  });

  it('is amphibious and cannot crush — the two halves of one trade', () => {
    // "Nothing the Pact fields touches the ground" now has exactly one hull
    // that goes further than skimming: the Kestrel is `Locomotor.Air` since the
    // air layer landed. It is named here rather than exempted by a predicate on
    // purpose — a second Pact vehicle quietly leaving the water has to fail
    // this test, because amphibious-everywhere IS the faction.
    const FLIES = new Set(['mrdKestrel']);
    for (const u of mrdUnits) {
      if (u.kind !== EntityKind.Vehicle) continue;
      expect(u.locomotor, `${u.key} must skim, not roll`)
        .toBe(FLIES.has(u.key) ? Locomotor.Air : Locomotor.Hover);
      expect(u.crushLevel, `${u.key} must not crush`).toBe(0);
    }
    // And the exemption list is not a licence: everything on it must actually
    // be an aircraft, so a stale entry cannot hide a hull that just went Wheel.
    for (const key of FLIES) {
      const u = mrdUnits.find((x) => x.key === key);
      expect(u?.locomotor, `${key} is on the flying list but is not flying`)
        .toBe(Locomotor.Air);
    }
  });

  it('trades armour class for a deeper HP pool on the main line', () => {
    const solarch = UNITS[DEF_TABLES.unitByKey.get('mrdSolarch')!];
    const grizzly = UNITS[DEF_TABLES.unitByKey.get('grizzly')!];
    const rhino = UNITS[DEF_TABLES.unitByKey.get('rhino')!];

    // Light armour is the "shield" read: better against AP, far worse against
    // autocannon and small arms. If this ever becomes Medium or Heavy the whole
    // faction loses the counter that makes it beatable.
    expect(solarch.armor).toBe(ArmorClass.Light);
    expect(solarch.maxSpeed).toBeGreaterThan(grizzly.maxSpeed);
    expect(solarch.maxSpeed).toBeGreaterThan(rhino.maxSpeed);
    expect(solarch.cost).toBeGreaterThan(grizzly.cost);
    expect(solarch.cost).toBeLessThan(rhino.cost);
  });

  it('buys cheaper power on a more fragile plant', () => {
    const array = BUILDINGS[DEF_TABLES.buildingByKey.get('mrdSolarArray')!];
    const plant = BUILDINGS[DEF_TABLES.buildingByKey.get('powerPlant')!];
    expect(array.power).toBeGreaterThan(plant.power);
    expect(array.cost / array.power).toBeLessThan(plant.cost / plant.power);
    expect(array.maxHp).toBeLessThan(plant.maxHp);
  });

  it('gates its DEFENCES on the grid it cannot defend', () => {
    // THE SIGNATURE, AND IT IS THE EMPLACEMENTS. Both Pact defences stop
    // working in a brownout, and the Solar Array that feeds them is the softest
    // structure in the game — which is the payoff `src/data/Defs.ts` promises
    // for the cheapest power in the game: "four Sandskiffs behind the lines can
    // silence a whole defensive belt without touching a single Glaive Post".
    for (const key of ['glaiveRepeater', 'heliosLance']) {
      const w = WEAPONS.find((x) => x.key === key);
      expect(w, key).toBeDefined();
      expect(w!.needsPower, key).toBe(true);
    }

    // THIS TEST USED TO ASSERT THE OPPOSITE OF BOTH HALVES, and both were
    // wrong in the same way: it pinned the DATA and the data disagreed with
    // every sentence the player and the author could read.
    //
    //   `glaiveRepeater` had no `needsPower` while the Glaive Post's blurb said
    //   "Needs the grid" and the faction's own doctrine block said both its
    //   defences carry it. The old reason given here — "or a power raid would
    //   leave the base with no answer to a rush at all" — is precisely the
    //   effect the doctrine block describes as the intended payoff, so the two
    //   could not both stand. The doctrine won: it is the more specific
    //   statement, it is what the blurb promises, and `PowerGrid.shed` orders
    //   by draw DESCENDING within the defence class, so a deficit takes the
    //   Spire's 55 before it ever reaches a post's 10. Losing the cheap posts
    //   means the grid is gone entirely, and the Conclave is never shed.
    //
    //   `zenithBeam` HAD `needsPower` and it did nothing at all. `Combat.ts`
    //   also requires `EntityFlag.NeedsPower` on the entity; only structures
    //   ever get it, and `EntityFlag.Powered` is only ever written by
    //   `PowerGrid.recompute`, which walks `byKind[EntityKind.Building]`. A
    //   vehicle carrying the flag would be dark forever and never fire once.
    const zenith = WEAPONS.find((x) => x.key === 'zenithBeam')!;
    expect(
      zenith.needsPower,
      'a HULL cannot brown out — see the MERIDIAN_WEAPONS header in Defs.ts. '
      + 'If this is ever true again, Power.ts must have learned to shed vehicles.',
    ).toBe(false);
  });

  it('keeps the Pact fighting in a blackout with everything that is not a tower', () => {
    // The other side of the decision above, and the reason it is survivable: a
    // darkened belt is not a disarmed army. Nothing the Pact FIELDS is on the
    // grid, so a power raid costs the emplacements and no more.
    const mobile = UNITS.filter(
      (u) => (u.faction as number) === (Faction.Meridian as number) && u.weapons.length > 0,
    );
    expect(mobile.length, 'the Pact should field armed units at all').toBeGreaterThan(3);
    for (const u of mobile) {
      for (const i of u.weapons) {
        expect(WEAPONS[i].needsPower, `${u.key} fires ${WEAPONS[i].key}`).toBe(false);
      }
    }
  });

  it('trades harvester capacity for harvester speed', () => {
    const pact = UNITS[DEF_TABLES.unitByKey.get('mrdCollector')!];
    const shared = UNITS[DEF_TABLES.unitByKey.get('harvester')!];
    expect(pact.cargoMax).toBeLessThan(shared.cargoMax);
    expect(pact.maxSpeed).toBeGreaterThan(shared.maxSpeed);
    expect(pact.cost).toBeLessThan(shared.cost);
    expect(pact.maxHp).toBeLessThan(shared.maxHp);
  });

  it('gives the HUD a distinct accent from both existing armies', () => {
    expect(MERIDIAN_LOOK.hudAccent).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(MERIDIAN_LOOK.team).not.toBe(MERIDIAN_LOOK.armorBase);
    for (const other of ['#3A86E0', '#C0271E']) {
      expect(MERIDIAN_LOOK.hudAccent.toUpperCase()).not.toBe(other);
    }
  });
});

describe('the Meridian Pact — AI doctrine', () => {
  it('can build every step of its own opening', () => {
    const catalog = new BuildCatalog();
    for (const personality of [0, 1, 2, 3]) {
      for (const step of openingFor(FACTION_MERIDIAN, personality)) {
        const entry = catalog.get(step.key);
        expect(entry, `${step.key} is not in the AI catalog`).toBeDefined();
        expect(entry!.faction as number, step.key).toBe(FACTION_MERIDIAN as number);
      }
    }
  });

  it('opens with power, barracks, refinery — an order neither rival uses', () => {
    const pact = openingFor(FACTION_MERIDIAN, 0).map((s) => s.key);
    expect(pact[0]).toBe('mrdSolarArray');
    expect(pact.indexOf('mrdChapterhouse')).toBeLessThan(pact.indexOf('mrdCistern'));
    // The other two armies are untouched by the third faction's arrival.
    expect(openingFor(Faction.Allies, 0)[0].key).toBe('powerPlant');
    expect(openingFor(Faction.Soviets, 0)[0].key).toBe('powerPlant');
    const soviets = openingFor(Faction.Soviets, 0).map((s) => s.key);
    expect(soviets.indexOf('barracks')).toBeLessThan(soviets.indexOf('refinery'));
  });

  it('fills every role a brain asks for without borrowing another army', () => {
    const catalog = new BuildCatalog();
    const roles = [
      BuildRole.Builder, BuildRole.Power, BuildRole.Refinery, BuildRole.Barracks,
      BuildRole.WarFactory, BuildRole.Radar, BuildRole.TechLab, BuildRole.Storage,
      BuildRole.Defense, BuildRole.AntiAir, BuildRole.Harvester, BuildRole.Armor,
      BuildRole.Infantry, BuildRole.Siege, BuildRole.Support, BuildRole.Mcv,
      BuildRole.Skirmisher,
    ];
    for (const r of roles) {
      const e = catalog.forRole(r, FACTION_MERIDIAN);
      expect(e, `no Meridian entry for role ${r}`).toBeDefined();
      expect(e!.faction as number, `role ${r} fell through to ${e!.key}`)
        .toBe(FACTION_MERIDIAN as number);
    }
  });

  it('keeps its army out of the other two armies' + " candidate lists", () => {
    const catalog = new BuildCatalog();
    const out: ReturnType<BuildCatalog['forFaction']> = [];
    for (const f of [Faction.Allies, Faction.Soviets]) {
      for (const e of catalog.forFaction(f, out as never[])) {
        expect(e.key.startsWith('mrd'), `${e.key} leaked into faction ${f}`).toBe(false);
      }
    }
    // ...and the Pact still sees every shared Neutral entry.
    const pact = catalog.forFaction(FACTION_MERIDIAN, out as never[]).map((e) => e.key);
    expect(pact).toContain('mrdSolarch');
    expect(pact).not.toContain('grizzly');
    expect(pact).not.toContain('rhino');
  });
});

describe('the Meridian Pact — art', () => {
  it('builds every hull inside R8 and R12', () => {
    for (const l of MERIDIAN_UNIT_MASS_LISTS) {
      const m = meridianUnitLibrary.build(l, MERIDIAN_UNIT_PALETTE, 256, 0x4d52);
      expect(m.stats.errors, formatStats(m.stats)).toEqual([]);
      expect(m.stats.warnings, formatStats(m.stats)).toEqual([]);
      // Perf: 200+ units at 60 fps means a hull is a few thousand triangles,
      // not tens of thousands.
      expect(m.stats.triangles, l.key).toBeLessThan(4000);
    }
  });

  it('exposes one three-vane rotor above every plenum lift-fan disc', () => {
    let equipped = 0;
    for (const l of MERIDIAN_UNIT_MASS_LISTS) {
      const skirt = l.masses.find((m) => m.name === 'skirt');
      const fans = l.masses.filter((m) => /^fan\d+$/.test(m.name));
      const rotors = l.masses.filter((m) => /^fan\d+\.rotor$/.test(m.name));
      if (fans.length === 0) continue;
      equipped++;
      expect(skirt, `${l.key}: fan discs need a plenum skirt`).toBeDefined();
      expect(rotors.length, `${l.key}: one rotor plate per intake`).toBe(fans.length);
      for (let i = 0; i < fans.length; i++) {
        const fan = fans[i];
        const rotor = rotors[i];
        expect(fan.group).toBe('liftFans');
        expect(rotor.group).toBe('liftFans');
        expect(rotor.slot, `${l.key} fan${i}: vanes read dark against the metal rim`).toBe('grille');
        expect(rotor.primitive, `${l.key} fan${i}: the impeller is real geometry`).toBe('plate');
        expect(rotor.size[0], `${l.key} fan${i}: metal rim remains visible`).toBeLessThan(fan.size[0]);
        expect(rotor.anchor[1] - rotor.size[1] * 0.5,
          `${l.key} fan${i}: rotor must break through the plenum cap`)
          .toBeGreaterThan(skirt!.anchor[1] + skirt!.size[1] * 0.5);
        expect(fan.anchor[0] + fan.size[0] * 0.5,
          `${l.key} fan${i}: intake must stay inside the skirt shoulder`)
          .toBeLessThanOrEqual(skirt!.size[0] * 0.5 + 1e-9);
      }
    }
    expect(equipped, 'the roster has no plenum-equipped vehicles to check').toBeGreaterThan(0);
  });

  it('builds every structure inside its bands', () => {
    const palettes = {
      structure: MERIDIAN_STRUCTURE_PALETTE,
      pad: MERIDIAN_PAD_PALETTE,
      panelDensity: 2.4,
      seed: 0x4d2b,
      padSeed: 0x4d9d,
    };
    for (const l of MERIDIAN_STRUCTURE_MASS_LISTS) {
      const m = meridianBuildingLibrary.build(l, palettes, 256);
      expect(m.stats.errors, l.key).toEqual([]);
      expect(m.stats.warnings, l.key).toEqual([]);
      expect(m.stats.triangles, l.key).toBeLessThan(4000);
    }
  });

  it('builds the Forgeyard aperture as supported machinery, not a flat dish', () => {
    const forge = MERIDIAN_STRUCTURE_MASS_LISTS.find((l) => l.key === 'meridian_forgeyard')!;
    const iris = forge.masses.filter((m) => m.name.startsWith('forge.iris'));
    expect(forge.masses.some((m) => m.name === 'forge.yoke' && m.role === MassRole.Primary)).toBe(true);
    expect(forge.masses.filter((m) => m.name === 'forge.journal')).toHaveLength(1);
    expect(iris).toHaveLength(8);
    expect(new Set(iris.map((m) => m.rot?.[2])).size).toBe(8);
    expect(forge.masses.some((m) => m.name === 'forge.converter')).toBe(true);
  });

  it('has a model for every content key and a content key for every model', () => {
    for (const [contentKey, modelKey] of Object.entries(MERIDIAN_UNIT_MODELS)) {
      expect(DEF_TABLES.unitByKey.has(contentKey), contentKey).toBe(true);
      expect(MERIDIAN_UNIT_MASS_LISTS.some((l) => l.key === modelKey), modelKey).toBe(true);
    }
    for (const [contentKey, modelKey] of Object.entries(MERIDIAN_STRUCTURE_MODELS)) {
      expect(DEF_TABLES.buildingByKey.has(contentKey), contentKey).toBe(true);
      expect(MERIDIAN_STRUCTURE_MASS_LISTS.some((l) => l.key === modelKey), modelKey).toBe(true);
    }
    // Nothing in either roster is built but never drawn.
    expect(Object.keys(MERIDIAN_UNIT_MODELS).length).toBe(MERIDIAN_UNIT_MASS_LISTS.length);
    expect(Object.keys(MERIDIAN_STRUCTURE_MODELS).length).toBe(MERIDIAN_STRUCTURE_MASS_LISTS.length);
    expect(mrdUnits.length).toBe(MERIDIAN_UNIT_MASS_LISTS.length);
    expect(mrdBuildings.length).toBe(MERIDIAN_STRUCTURE_MASS_LISTS.length);
  });

  it('shares one atlas across the whole army', () => {
    // The draw-call argument: 11 hulls cost ONE material, 12 structures cost
    // two (architecture + ground). Anything else is a per-unit atlas.
    expect(meridianUnitLibrary.materialCount()).toBe(1);
    expect(meridianBuildingLibrary.materialCount()).toBe(2);
  });

  it('paints nothing the texture overhaul forbids', () => {
    // Clean painted surfaces: large flat areas, crisp panel lines, zero
    // speckle. `speckleRatio` is a per-pixel local-extremum count — white noise
    // scores ~0.44 and a drawn line scores 0.
    for (const m of meridianUnitLibrary.all()) {
      expect(m.atlas.metrics.speckleRatio, m.key).toBeLessThan(0.010);
    }
    expect(MERIDIAN_UNIT_PALETTE.rivets).toBe(false);
    expect(MERIDIAN_STRUCTURE_PALETTE.rivets).toBe(false);
  });

  it('keeps every defence and wall free of an insignia decal', () => {
    for (const l of MERIDIAN_STRUCTURE_MASS_LISTS) {
      if ((l.cls ?? 'structure') === 'structure') continue;
      const m = meridianBuildingLibrary.get(l.key);
      expect(m?.stats.insigniaCount, l.key).toBe(0);
    }
  });
});

describe('the Meridian Pact — the tab layout the sidebar will read', () => {
  it('puts every buildable in a tab the player can reach', () => {
    for (const u of mrdUnits) {
      expect([BuildTab.Infantry, BuildTab.Vehicles], u.key).toContain(u.tab);
    }
    for (const b of mrdBuildings) {
      expect([BuildTab.Structures, BuildTab.Defense], b.key).toContain(b.tab);
    }
    // Sort order is unique within a (faction, tab) pair, so the sidebar order
    // is deterministic rather than dependent on array order.
    for (const tab of [BuildTab.Structures, BuildTab.Defense]) {
      const orders = mrdBuildings.filter((b) => b.tab === tab).map((b) => b.sortOrder);
      expect(new Set(orders).size, `tab ${tab}`).toBe(orders.length);
    }
    for (const tab of [BuildTab.Infantry, BuildTab.Vehicles]) {
      const orders = mrdUnits.filter((u) => u.tab === tab).map((u) => u.sortOrder);
      expect(new Set(orders).size, `tab ${tab}`).toBe(orders.length);
    }
  });
});
