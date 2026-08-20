/**
 * ============================================================================
 * tests/campaign-emplacement-reach.spec.ts — WHICH GUN DID THE LAYOUT ACTUALLY
 * PLACE, AND CAN THE PLAYER'S OWN INFANTRY SURVIVE ONE PULL OF IT?
 * ============================================================================
 * THE REPORT: *"Held Paper is almost impossible if we won't balance the
 * gunfighter insane amount of damage"* (2026-08-19).
 *
 * True, and the cause was two characters of authoring. `reclamation-held-paper`
 * raised two `prismTower` in the district office compound.
 * `ScenarioBuilder.keyFor` resolves a role key against the SEATED ARMY, and
 * `op.foe` is `Faction.Soviets`, so what stood on the ground was two **Tesla
 * Coils**. The two are not two skins of one gun:
 *
 *     army       def          weapon           range   per pull   victims
 *     Allies     prismTower   prismTowerBeam     34      101.2        1
 *     Meridian   mrdHelios    heliosLance        33      102.1        1
 *     Soviets    teslaCoil    teslaBolt          30      153.6        3
 *     Reclaim    rclPylon     pylonArc           28      120.3        4
 *
 * `teslaBolt` carries `chainCount: 2`, so one trigger pull writes three damage
 * records at 153.6 / 92.2 / 55.3 (`COMBAT_WEAPONS.teslaChainFalloff` 0.6). A
 * Scrap Picker and a Tinker are **85 hp**, so the SECOND link killed as well as
 * the first — and this operation's entire army is those two units, with 12-16 m
 * of reach against the coil's 30. Staged in the engine against the two towers
 * ALONE, nine Scrap Pickers died in 12.5 s having dealt ZERO damage, and 3040
 * credits of Slaggers died in 13.5 s having taken 27 of 1400 hp.
 *
 * WHY THIS FILE IS ABOUT THE REMAP AND NOT ABOUT ONE OPERATION
 * ------------------------------------------------------------
 * Pinning "the R1 compound holds four `pillbox`" would catch the fix being
 * reverted and nothing else. The reusable hazard is one level up: **a role key
 * is a promise about the ROLE, and for one of the two defence rows it is not a
 * promise about the GUN.** §4 measures exactly that and is the reason the other
 * sections exist.
 *
 * The operation file's own `foe` comment is the artefact worth reading: it
 * argued the choice of enemy was "mechanically free" because every column of
 * the row held the same POWER shape — a true statement that checked the wrong
 * property, sitting three lines above the defect.
 *
 * WHAT IS ASSERTED
 * ----------------
 *   §1  every armed enemy structure each operation actually stands up, by def
 *       key and count, PINNED BY VALUE and failing in both directions;
 *   §2  no emplacement covering ground the operation's TRIGGER TABLE names may
 *       kill more than one of the player's own line infantryman per pull;
 *   §3  §2 can fail — the same predicate over the pre-fix R1 world is refused,
 *       and the table facts it rests on are asserted so a retune that retires
 *       the hazard also retires the falsifier loudly;
 *   §4  the cheap-emplacement row is uniform across the four armies and the
 *       specialist row is not, which is the whole finding.
 *
 * WHY "COVERS A NAMED TAG" IS THE RIGHT SCOPE, AND WHAT IT DELIBERATELY LETS
 * THROUGH
 * -------------------------------------------------------------------------
 * `buildBaseFor` seeds each army's own doctrinal defence at its start spot, and
 * on a Soviet seat that is three Tesla Coils. Those are NOT a campaign
 * authoring decision — a skirmish player meets the same three, with a whole
 * tech tree to answer them — and gating them here would either delete the
 * Soviet base defence or need an exception list per operation. So the scope is
 * the ground the operation ASKS the player to take: an emplacement is in scope
 * when a tag some trigger's `when` clause names is inside that emplacement's
 * own weapon range. No magic radius; the radius is the gun's.
 *
 * Measured 2026-08-19 over all 22 shipped operations, that is not a loose net:
 * R1's three surviving coils are 92.5 m from the nearest named tag and R2's are
 * 128.7 m, against a 30 m gun — while the two the fix removed sat at **26.1 m
 * of the `office` tag**, which is the objective.
 * ========================================================================== */

import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { Terrain, setActiveTerrain } from '../src/world/Terrain';
import { World } from '../src/core/world';
import { ARMOR_MATRIX, COMBAT_DAMAGE, COMBAT_WEAPONS } from '../src/core/config';
import { ArmorClass, BuildTab, EntityKind, Faction, NONE } from '../src/core/types';
import type { BuildingDef, EntityId, UnitDef, WeaponDef } from '../src/core/types';
import {
  MAP_SEAS, buildScenario, clearScenario, resolveDefBinding, setCampaignLayout,
  setPlannedOperation, startPointsFor,
} from '../src/game/Scenarios';
import type { DefBinding } from '../src/game/Scenarios';
import { setCampaignRoster } from '../src/progression/UnlockGate';
import { CAMPAIGNS, LAYOUTS } from '../src/campaign/index';
import { tagsUsedByCondition } from '../src/campaign/validate';
import type { OperationDef } from '../src/campaign/types';

/* ==========================================================================
 * §0. THE HARNESS
 *
 * `campaign-roster-ground.spec.ts`'s builder, minus the control build it does
 * not need: def tables BOUND and the operation's own roster INSTALLED, because
 * `spawnBuilding` hands `isBuildable` the resolved def and `rosterAllows`
 * answers TRUE for an undefined one — so a build without both measures a
 * different game in a way that looks like a pass.
 * ========================================================================== */

const FACTION_OF: Readonly<Record<string, Faction>> = {
  soviets: Faction.Soviets,
  allies: Faction.Allies,
  pact: Faction.Meridian,
  reclamation: Faction.Reclaim,
};

/** One armed structure the operation stands up against the player. */
interface Gun {
  readonly key: string;
  readonly weapon: WeaponDef;
  readonly x: number;
  readonly z: number;
}

interface Built {
  readonly guns: readonly Gun[];
  /** World points of every tag some trigger's `when` clause names. */
  readonly points: readonly { readonly x: number; readonly z: number; readonly tag: string }[];
}

function buildOperation(op: OperationDef, binding: DefBinding): Built {
  const sea = MAP_SEAS[op.map.preset] ?? null;
  const terrain = new Terrain({
    scene: new THREE.Scene(),
    seed: op.map.mapSeed,
    biome: op.map.biome as never,
    anisotropy: 1,
    starts: startPointsFor(op.map.armies, sea, op.map.simSeed).map((p) => ({ x: p.x, z: p.z })),
    sea,
  });
  setActiveTerrain(terrain);

  const world = new World();
  world.addPlayer(FACTION_OF[op.chapter], 'Commander', true, true);
  for (let seat = 1; seat < op.map.armies; seat++) {
    world.addPlayer(op.foe, 'Opponent', false, false);
  }
  world.terrain = terrain;

  const tags = new Map<string, EntityId[]>();
  const l = LAYOUTS.get(op.layout);
  expect(l, `operation ${op.id} names layout '${op.layout}'`).toBeDefined();

  setPlannedOperation({
    id: op.id, preset: op.map.preset, armies: op.map.armies, opening: op.map.opening,
  });
  // ARM, THEN BOOT — `Scenarios.ts` asks `isBuildable` WHILE SPAWNING.
  setCampaignRoster(op.roster);
  setCampaignLayout((b, cx, cz, start) => {
    l!.build(b, cx, cz, start, {
      op,
      opening: op.map.opening,
      tag: (name, id) => {
        if (id === NONE) return;
        const list = tags.get(name);
        if (list === undefined) tags.set(name, [id]);
        else list.push(id);
      },
      seat: (i) => b.armySlot(i),
    });
  });

  try {
    buildScenario(world, 'campaign', op.map.simSeed, { armies: op.map.armies, defs: binding });
  } finally {
    setCampaignLayout(null);
    setPlannedOperation(null);
    // Module-level state, cleared on the failing path too: a roster left armed
    // fails in whatever spec shares this worker's module graph next.
    setCampaignRoster(null);
    clearScenario();
  }

  const st = world.store;
  const t = binding.tables!;
  const guns: Gun[] = [];
  for (let a = 0; a < st.aliveCount; a++) {
    const i = st.alive[a];
    if (st.kind[i] !== EntityKind.Building) continue;
    // Gaia's civilian structures are scenery, and seat 0 is the player's own.
    if (st.faction[i] === Faction.Neutral || st.owner[i] === 0) continue;
    const def: BuildingDef | undefined = t.buildings[st.defId[i]];
    const wi = def?.weapons[0];
    if (def === undefined || wi === undefined) continue;
    const weapon = t.weapons[wi];
    if (weapon === undefined) continue;
    guns.push({ key: def.key, weapon, x: st.posX[i], z: st.posZ[i] });
  }

  const named = new Set<string>();
  for (const tr of op.triggers) tagsUsedByCondition(tr.when, named);
  const points: { x: number; z: number; tag: string }[] = [];
  for (const [name, ids] of tags) {
    if (!named.has(name)) continue;
    for (const id of ids) {
      const i = st.index(id);
      if (i < 0) continue;
      points.push({ x: st.posX[i], z: st.posZ[i], tag: name });
    }
  }

  terrain.dispose?.();
  return { guns, points };
}

const ALL: readonly OperationDef[] = CAMPAIGNS.flatMap((c) => c.operations);

let binding: DefBinding;
let built: Map<string, Built>;

/* -- the two derived facts every section reads ---------------------------- */

/**
 * The army's LINE INFANTRYMAN — its cheapest armed Infantry-tab unit.
 *
 * DERIVED FROM THE TABLE RATHER THAN LISTED, because a second copy of
 * `FACTION_KEY_MAP`'s `gi` row is a second place that has to agree with the
 * first. §4 asserts the derivation lands on the four units it is supposed to,
 * so a new 80-credit conscript variant reports rather than silently moving the
 * anchor.
 */
function lineInfantryByFaction(units: readonly UnitDef[]): Map<Faction, UnitDef> {
  const out = new Map<Faction, UnitDef>();
  for (const u of units) {
    if (u === undefined) continue;
    if (u.kind !== EntityKind.Infantry || u.tab !== BuildTab.Infantry) continue;
    if (u.weapons.length === 0) continue;
    const cur = out.get(u.faction);
    if (cur === undefined || u.cost < cur.cost) out.set(u.faction, u);
  }
  return out;
}

/** Delivered damage of one trigger pull against `ArmorClass.Infantry`. */
function pullVsInfantry(w: WeaponDef): number {
  const burst = w.burstCount > 1 ? w.burstCount : 1;
  return burst * w.damage
    * ARMOR_MATRIX[w.warhead][ArmorClass.Infantry]
    * COMBAT_DAMAGE.globalMul;
}

/**
 * THE RULE, AS ONE PURE FUNCTION, so §2 and §3 run the SAME code over
 * different worlds. A falsifier that re-implements the predicate proves the
 * copy works.
 *
 * A gun is at fault when it CHAINS, its second link alone kills the player's
 * line infantryman, and it covers a point the trigger table names. The second
 * link is the threshold rather than the first because the first killing a man
 * is what an emplacement is FOR — `pillboxMg` at 52.0 against 85 hp is a real
 * gun and a survivable one. Deleting two men with one trigger is the thing an
 * 85 hp roster has no answer to.
 */
function faults(
  guns: readonly Gun[],
  points: readonly { readonly x: number; readonly z: number; readonly tag: string }[],
  line: UnitDef,
): string[] {
  const out: string[] = [];
  for (const g of guns) {
    if (g.weapon.chainCount <= 0) continue;
    const first = pullVsInfantry(g.weapon);
    const second = first * COMBAT_WEAPONS.teslaChainFalloff;
    if (second < line.maxHp) continue;
    for (const p of points) {
      const d = Math.hypot(p.x - g.x, p.z - g.z);
      if (d > g.weapon.range) continue;
      out.push(
        `${g.key} (${g.weapon.key}, range ${String(g.weapon.range)}, chain `
        + `${String(g.weapon.chainCount)}) covers tag '${p.tag}' at ${d.toFixed(1)} m; `
        + `one pull is ${first.toFixed(1)} then ${second.toFixed(1)}, and a `
        + `${line.key} is ${String(line.maxHp)} hp — TWO die per trigger`,
      );
      break;
    }
  }
  return out;
}

beforeAll(async () => {
  binding = await resolveDefBinding();
  expect(binding.tables, 'def binding failed — every number here would be fallback data')
    .not.toBeNull();
  built = new Map(ALL.map((op) => [op.id, buildOperation(op, binding)]));
}, 240_000);

/* ==========================================================================
 * §1. THE GUNS EACH OPERATION STANDS UP, PINNED BY VALUE
 *
 * Def keys and counts, not numbers: a weapon retune must not churn this table,
 * and §2 measures the numbers live. What this catches is a LAYOUT key changing
 * and a `FACTION_KEY_MAP` column changing — the two edits that silently swap
 * one gun for another.
 *
 * It fails in BOTH directions. A new operation with no row here fails, and a
 * row naming an operation that no longer exists fails, so nobody can land half
 * of a pair and walk away.
 * ========================================================================== */

const GUNS: Readonly<Record<string, string>> = {
  'soviets.01.first-tap': 'pillbox x3',
  'soviets.02.common-standard': 'pillbox x6',
  'soviets.03.deep-sector': 'pillbox x10',
  'soviets.04.company-town': 'pillbox x6',
  'soviets.05.short-allocation': 'pillbox x5',
  'soviets.06.demolition-order': 'pillbox x5, prismTower x2',
  'soviets.07.right-of-entry': 'pillbox x7',
  // Three from `buildAlliedBase` plus TWO the layout plants on the shoulders of
  // the haul corridor, 14.14 m either side of `PICKET`, close enough that every
  // shortest Foot route to the working spends 38.63 m inside a 22 m gun. `pillbox`
  // carries no `unlockedBy`, so the empty `roster.ai` cannot refuse them —
  // deliberate: this operation's asymmetry is the Refractor Tanks the fourth
  // movement SPAWNS, which never pass through `isBuildable` and never stand up
  // as structures.
  'soviets.08.carriage-forward': 'pillbox x5',
  // Three from the Allied opening and three on the establishment's field office
  // — two `pillbox` and the `prismTower` that makes taking the office a decision
  // rather than a walk. `op.foe` is Allied, so `keyFor` resolves `prismTower` to
  // ITSELF; on a Soviet seat the same key is a Tesla Coil, which is R1's defect
  // and this file's whole subject. Neither row chains, and the nearest gun to
  // anything the trigger table names is 31.6 m from a seam head against a 22 m
  // reach.
  'soviets.09.nil-return': 'pillbox x5, prismTower x2',
  'allies.01.sounding-line': 'flameTower x2, sentryGun x2',
  'allies.02.instrument-room': 'flameTower x2, sentryGun x5',
  'allies.03.ground-truth': 'mrdGlaive x17',
  'allies.04.misclosure': 'flameTower x2, sentryGun x2',
  'allies.05.forced-closure': 'flameTower x2, sentryGun x3',
  'pact.01.shallow-road': 'pillbox x5, prismTower x2',
  'pact.02.long-count': 'flameTower x2, sentryGun x3',
  'pact.03.concession': 'rclSpitpost x5',
  'pact.04.in-the-clear': 'pillbox x4',
  'pact.05.open-count': 'mrdGlaive x6',
  // WAS `sentryGun x2, teslaCoil x5` UNTIL 2026-08-19. Two of those five were
  // the compound's flank towers, authored as `prismTower` and resolved to a
  // Tesla Coil by `op.foe`; they are `pillbox`-role posts now. The three that
  // remain are `SOVIET_DEFENCE`'s, at the garrison base.
  'reclamation.01.held-paper': 'flameTower x2, sentryGun x4, teslaCoil x3',
  'reclamation.02.written-off': 'flameTower x2, sentryGun x2, teslaCoil x3',
  'reclamation.03.sold-twice': 'pillbox x8',
  'reclamation.04.served-notice': 'pillbox x7',
  'reclamation.05.closing-entry': 'mrdGlaive x5, mrdHelios x1',
};

describe('§1 the guns every operation points at the player', () => {
  it('are exactly the pinned roster, in both directions', () => {
    const actual: Record<string, string> = {};
    for (const op of ALL) {
      const counts = new Map<string, number>();
      for (const g of built.get(op.id)!.guns) {
        counts.set(g.key, (counts.get(g.key) ?? 0) + 1);
      }
      actual[op.id] = [...counts.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([k, n]) => `${k} x${String(n)}`)
        .join(', ');
    }
    // One comparison rather than a loop, so an operation missing from EITHER
    // side is named by the diff instead of being skipped.
    expect(actual).toEqual(GUNS);
  });
});

/* ==========================================================================
 * §2. THE RULE
 * ========================================================================== */

describe('§2 no emplacement over authored ground deletes two of the player per pull', () => {
  it('holds for every shipped operation', () => {
    const line = lineInfantryByFaction(binding.tables!.units);
    const bad: string[] = [];
    for (const op of ALL) {
      const b = built.get(op.id)!;
      const l = line.get(FACTION_OF[op.chapter]);
      expect(l, `no line infantryman derived for ${op.chapter}`).toBeDefined();
      for (const f of faults(b.guns, b.points, l!)) bad.push(`${op.id}: ${f}`);
    }
    expect(
      bad,
      'An emplacement covering ground the trigger table sends the player to kills more\n'
      + 'than one of their own line infantry per trigger pull. A layout writes ROLE keys\n'
      + 'and `keyFor` resolves them against the SEATED ARMY — check the RESOLVED weapon,\n'
      + 'not the key you typed. See this file\'s header.\n\n'
      + bad.join('\n'),
    ).toEqual([]);
  });

  it('and the scope is not vacuous — every operation names at least one tag', () => {
    /*
     * §2 is satisfied for free by an operation whose trigger table names no
     * tag at all, and one such operation exists (`allies.03.ground-truth`,
     * whose triggers are timers and area counts). Naming it here is the
     * difference between a known gap and an unnoticed one: a SECOND entry
     * landing in this list means somebody's objectives stopped being about
     * anything on the ground, and §2 stopped covering them.
     */
    const NO_TAGGED_TRIGGER: ReadonlySet<string> = new Set(['allies.03.ground-truth']);
    const empty = ALL.filter((op) => built.get(op.id)!.points.length === 0).map((o) => o.id);
    expect(empty.filter((id) => !NO_TAGGED_TRIGGER.has(id))).toEqual([]);
    expect([...NO_TAGGED_TRIGGER].filter((id) => !empty.includes(id))).toEqual([]);
  });
});

/* ==========================================================================
 * §3. THE FALSIFIER
 *
 * "Verify a spec CAN fail before believing it" — this project has shipped
 * three separate specs that were green against the broken build. §2 passes
 * today, so on its own it is indistinguishable from a predicate that never
 * fires.
 *
 * The subject is the world R1 ACTUALLY SHIPPED WITH: the same built ground,
 * with the two flank posts put back to the `teslaCoil` they resolved to. It
 * runs the same `faults` function §2 runs.
 * ========================================================================== */

describe('§3 the rule can fail', () => {
  it('refuses the pre-fix R1 compound', () => {
    const t = binding.tables!;
    const coil = t.buildings[t.buildingByKey.get('teslaCoil')!];
    const line = lineInfantryByFaction(t.units).get(Faction.Reclaim)!;
    const b = built.get('reclamation.01.held-paper')!;

    // The office tag is the objective; the two flank posts stood 26.1 m from
    // it, measured on the built world. Substituting the def is what the layout
    // edit undid, so this is that world and not an invented one.
    const office = b.points.find((p) => p.tag === 'office');
    expect(office, 'R1 no longer stamps an `office` tag').toBeDefined();
    const flanks = b.guns
      .filter((g) => Math.hypot(g.x - office!.x, g.z - office!.z) < 30)
      .slice(0, 2);
    expect(flanks.length, 'R1 no longer has two posts inside 30 m of the mast').toBe(2);

    const prefix: Gun[] = b.guns.map((g) => (flanks.includes(g)
      ? { key: coil.key, weapon: t.weapons[coil.weapons[0]], x: g.x, z: g.z }
      : g));
    const found = faults(prefix, b.points, line);
    expect(found.length, `the pre-fix world must be refused, got: ${found.join(' | ')}`)
      .toBe(2);
    expect(found[0]).toContain('teslaCoil');
    expect(found[0]).toContain("covers tag 'office'");

    // AND THE SHIPPED WORLD IS CLEAN AT THE SAME TWO POINTS, which is what
    // makes the line above a measurement of the fix rather than of the rig.
    expect(faults(b.guns, b.points, line)).toEqual([]);
  });

  it('rests on table facts that are asserted rather than assumed', () => {
    /*
     * If a retune drops `teslaBolt` under a Scrap Picker's hp, or takes the
     * chain off it, §3 above stops being a falsifier — it would pass because
     * the hazard is gone rather than because the rule works. These three lines
     * make that RETIRE THE FALSIFIER LOUDLY instead of quietly.
     */
    const t = binding.tables!;
    const bolt = t.weapons[t.buildings[t.buildingByKey.get('teslaCoil')!].weapons[0]];
    const picker = t.units[t.unitByKey.get('rclPicker')!];
    expect(bolt.key).toBe('teslaBolt');
    expect(bolt.chainCount).toBeGreaterThan(0);
    const second = pullVsInfantry(bolt) * COMBAT_WEAPONS.teslaChainFalloff;
    expect(
      second,
      'a tesla bolt no longer kills a second Scrap Picker — §3 is no longer a falsifier '
      + 'and this file needs a new one',
    ).toBeGreaterThanOrEqual(picker.maxHp);
  });
});

/* ==========================================================================
 * §4. THE FINDING ITSELF: ONE DEFENCE ROW IS INTERCHANGEABLE AND THE OTHER IS
 * NOT
 *
 * This is what the layout author needed and did not have. Both rows are
 * derived from the shipped table rather than transcribed out of
 * `FACTION_KEY_MAP`, because a transcription is a second place that has to
 * agree with the first.
 * ========================================================================== */

describe('§4 the two defence rows, resolved per army', () => {
  it('derives the four line infantry the whole file anchors on', () => {
    const line = lineInfantryByFaction(binding.tables!.units);
    expect({
      allies: line.get(Faction.Allies)?.key,
      soviets: line.get(Faction.Soviets)?.key,
      pact: line.get(Faction.Meridian)?.key,
      reclamation: line.get(Faction.Reclaim)?.key,
    }).toEqual({
      allies: 'gi', soviets: 'conscript', pact: 'mrdWayfarer', reclamation: 'rclPicker',
    });
  });

  it('the CHEAP row is one gun wearing four silhouettes', () => {
    const t = binding.tables!;
    const cheap = new Map<Faction, BuildingDef>();
    for (const b of t.buildings) {
      if (b === undefined || b.tab !== BuildTab.Defense || b.weapons.length === 0) continue;
      if (b.faction === Faction.Neutral) continue;
      const cur = cheap.get(b.faction);
      if (cur === undefined || b.cost < cur.cost) cheap.set(b.faction, b);
    }
    expect([...cheap.keys()].length, 'every army has a cheapest armed emplacement').toBe(4);
    const line = lineInfantryByFaction(t.units);
    const softest = Math.min(...[...line.values()].map((u) => u.maxHp));
    for (const [f, b] of cheap) {
      const w = t.weapons[b.weapons[0]];
      // A cheap post may chain (`postCoil` does) — what it may not do is put a
      // SECOND lethal link on the softest infantry in the game.
      const second = pullVsInfantry(w) * COMBAT_WEAPONS.teslaChainFalloff;
      expect(
        w.chainCount > 0 ? second : 0,
        `${b.key}'s second link kills a ${String(softest)} hp man — the cheap row has `
        + 'stopped being the safe one for a layout to place blind',
      ).toBeLessThan(softest);
      expect(w.range, `${b.key} (faction ${String(f)}) reach`).toBeLessThanOrEqual(24);
    }
  });

  it('the SPECIALIST row is four different guns, and that is the hazard', () => {
    const t = binding.tables!;
    const spec = t.buildings.filter(
      (b) => b !== undefined && b.unlockedBy === 'struct.defence.specialist',
    );
    expect(spec.map((b) => b.key).sort())
      .toEqual(['mrdHelios', 'prismTower', 'rclPylon', 'teslaCoil']);

    const shape = spec.map((b) => {
      const w = t.weapons[b.weapons[0]];
      return { key: b.key, range: w.range, chain: w.chainCount };
    }).sort((a, b) => a.key.localeCompare(b.key));

    // PINNED, because the number that matters is how far apart these are. If a
    // future retune makes them agree, this row is the thing to delete — but it
    // must be deleted deliberately.
    expect(shape).toEqual([
      { key: 'mrdHelios', range: 33, chain: 0 },
      { key: 'prismTower', range: 34, chain: 0 },
      { key: 'rclPylon', range: 28, chain: 3 },
      { key: 'teslaCoil', range: 30, chain: 2 },
    ]);

    // The claim in one assertion: the row spans a 6 m range spread AND a
    // chain/no-chain split, so "it is the same role" says nothing about the
    // fight in front of the player.
    const ranges = shape.map((s) => s.range);
    expect(Math.max(...ranges) - Math.min(...ranges)).toBeGreaterThan(0);
    expect(new Set(shape.map((s) => s.chain > 0)).size).toBe(2);
  });
});
