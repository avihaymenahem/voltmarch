/// <reference types="vite/client" />
/**
 * ============================================================================
 * tests/ore-crisis.spec.ts
 * ============================================================================
 * THE BUG: "if my ore harvester being smashed and i dont have any money left..
 * how can i make a progress? we need to allow the user to redeem some
 * buildings".
 *
 * Two separate defects sit under that sentence and this file pins both.
 *
 *  1. DISCOVERABILITY. Selling already existed — `Production.applySell`, armed
 *     from the sidebar's modal sell tool — and nothing in the running game ever
 *     mentioned it to a player whose economy had stopped. Section 3 asserts the
 *     chip fires and that its text NAMES THE TOOL, because a warning that does
 *     not say what to press is the same silence in a different font.
 *
 *  2. A REAL DEAD END, which the report did not know it had found. Section 1 is
 *     an exhaustive subset search over the REAL bound catalog, and it is the
 *     load-bearing part of this file: for eight realistic base states across
 *     four armies it enumerates every set of structures the player could sell
 *     and asks whether any of them reaches a harvester or a fresh refinery. The
 *     answer for the ordinary second-building state — yard + power + refinery —
 *     is NO, for every army. That is not a hint problem and no amount of UI
 *     fixes it.
 *
 * The search is written against `catalog.byKey(...).cost` and `SELL_REFUND`
 * rather than against hardcoded numbers, so a rebalance moves the expectations
 * with it and only a CHANGE OF SHAPE — a route opening or closing — fails.
 * That is the point: this file should go red when the deadlock stops existing,
 * so whoever removes the rescue is told the rescue is load-bearing.
 *
 * All headless. No renderer, no clock, no RNG outside the seeded one.
 * ============================================================================
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { World } from '../src/core/world';
import { Channels } from '../src/core/events';
import { Rng } from '../src/core/math';
import { BuildTab, EntityFlag, EntityKind, EvaLine, Faction } from '../src/core/types';
import type { EntityId, PlayerId, SimContext } from '../src/core/types';
import { SELL_REFUND, SIM_DT } from '../src/core/config';

import { resolveDefBinding } from '../src/game/Scenarios';
import { BuildKind, ProductionCatalog, ProductionService, setProduction } from '../src/sim/Production';
import type { BuildEntry } from '../src/sim/Production';
import { bindDeployTables } from '../src/sim/Deploy';
import { setGameContext } from '../src/game/context';
import type { GameContext } from '../src/game/Bootstrap';

import {
  OreCrisisState, makeOreCrisisSurvey, oreCrisisSaleCandidate, refineryEntryFor, refundOf,
  surveyOreCrisis,
} from '../src/sim/OreCrisis';
import crisisSystem, {
  CRISIS_SURVEY_INTERVAL, RESCUE_DELAY_TICKS, localCrisis, rescuesGranted,
} from '../src/sim/orecrisis.system';

const P0 = 0 as PlayerId;

/** The four armies, and the keys their opening base is made of. */
interface Army {
  faction: Faction;
  name: string;
  yard: string; power: string; refinery: string; factory: string;
  barracks: string; radar: string; lab: string;
}

const ARMIES: readonly Army[] = [
  {
    faction: Faction.Allies, name: 'Allies',
    yard: 'conyard', power: 'powerPlant', refinery: 'refinery', factory: 'warFactory',
    barracks: 'barracks', radar: 'radar', lab: 'battleLab',
  },
  {
    faction: Faction.Soviets, name: 'Soviets',
    yard: 'conyard', power: 'powerPlant', refinery: 'refinery', factory: 'warFactory',
    barracks: 'barracks', radar: 'radar', lab: 'battleLab',
  },
  {
    faction: Faction.Meridian, name: 'Meridian Pact',
    yard: 'mrdConclave', power: 'mrdSolarArray', refinery: 'mrdCistern', factory: 'mrdForgeyard',
    barracks: 'mrdChapterhouse', radar: 'mrdOculus', lab: 'mrdReliquary',
  },
  {
    faction: Faction.Reclaim, name: 'Reclamation',
    yard: 'rclFoundry', power: 'rclFurnace', refinery: 'rclSorter', factory: 'rclBreakerYard',
    barracks: 'rclRookery', radar: 'rclSpotter', lab: 'rclCrucible',
  },
];

/* ==========================================================================
 * SECTION 1 — THE ARITHMETIC. Is the deadlock real?
 * ========================================================================== */

/**
 * Every set of structures `base` could sell, and whether any of them buys a
 * way back into the economy.
 *
 * Deliberately MORE permissive than the running game, so a "no escape" here is
 * a strong claim: order is ignored (refunds are additive), the only rule
 * enforced is `applySell`'s own — never sell your last producer — and prereqs
 * are read off the real entries. If even this cannot find a route, the player
 * genuinely has none.
 */
function escapes(cat: ProductionCatalog, army: Army, base: readonly string[]): boolean {
  const e = (k: string): BuildEntry => {
    const hit = cat.byKey(k);
    if (hit === null) throw new Error(`no catalog entry for ${k}`);
    return hit;
  };
  const refinery = e(army.refinery);
  const harvester = e(refinery.shipsWith);

  for (let mask = 0; mask < (1 << base.length); mask++) {
    const left: string[] = [];
    let credits = 0;
    for (let i = 0; i < base.length; i++) {
      if ((mask >> i) & 1) credits += refundOf(e(base[i]));
      else left.push(base[i]);
    }
    if (left.every((k) => e(k).producesTabs.length === 0)) continue;

    const standing = (need: readonly string[]): boolean => need.every((n) => left.includes(n));
    const makes = (tab: BuildTab): boolean => left.some((k) => e(k).producesTabs.includes(tab));

    // Route V — buy a replacement miner.
    if (standing(harvester.prereqs) && makes(harvester.tab) && credits >= harvester.cost) return true;
    // Route S — build a fresh refinery and take the one it ships with.
    if (standing(refinery.prereqs) && makes(BuildTab.Structures) && credits >= refinery.cost) return true;
  }
  return false;
}

describe('the refund arithmetic: can a broke, harvesterless player sell their way out?', () => {
  it('SELL_REFUND is the 50% that makes both routes lossy', () => {
    // The whole deadlock is downstream of this number. If it ever rises to 1.0
    // the dead end below evaporates and this file should be revisited, not
    // silently kept green.
    expect(SELL_REFUND).toBe(0.5);
  });

  it('THE DEAD END: yard + power + refinery is unrecoverable for every army', async () => {
    const cat = new ProductionCatalog(await resolveDefBinding());
    expect(cat.bound, 'must measure against the real def costs').toBe(true);

    const stuck: string[] = [];
    for (const a of ARMIES) {
      const base = [a.yard, a.power, a.refinery];
      if (!escapes(cat, a, base)) stuck.push(a.name);
    }
    expect(
      stuck,
      'This is the state the bug report describes and it must stay documented: '
      + 'no vehicle factory means no miner at any price, and the refinery pays '
      + 'half of what a replacement refinery costs.',
    ).toEqual(ARMIES.map((a) => a.name));
  });

  it('THE DEAD END, second shape: refinery + factory + power with the yard bombed', async () => {
    const cat = new ProductionCatalog(await resolveDefBinding());
    const stuck: string[] = [];
    for (const a of ARMIES) {
      if (!escapes(cat, a, [a.power, a.refinery, a.factory])) stuck.push(a.name);
    }
    // Both prereqs of the miner are standing and must STAY standing, so the
    // only sellable thing is the power plant. 150 credits against 1000-1400.
    expect(stuck).toEqual(ARMIES.map((a) => a.name));
  });

  it('a fuller base DOES escape — the guard must not be "always stuck"', async () => {
    const cat = new ProductionCatalog(await resolveDefBinding());
    for (const a of ARMIES) {
      const base = [a.yard, a.power, a.power, a.refinery, a.factory, a.barracks, a.radar, a.lab];
      expect(escapes(cat, a, base), `${a.name} should have a route out of a full base`).toBe(true);
    }
  });

  it('the escape from a mid-game base costs the Construction Yard or both economy buildings', async () => {
    const cat = new ProductionCatalog(await resolveDefBinding());
    for (const a of ARMIES) {
      // Yard, two power, refinery, factory, barracks, radar. No proving ground.
      const full = [a.yard, a.power, a.power, a.refinery, a.factory, a.barracks, a.radar];
      expect(escapes(cat, a, full)).toBe(true);
      // Take away permission to touch the yard, the refinery and the factory —
      // the three a player would never think to sell — and it is stuck again.
      // That is why the chip has to name the tool AND the shortfall.
      const timid = [a.power, a.power, a.barracks, a.radar];
      expect(
        escapes(cat, a, [...timid, a.yard, a.refinery, a.factory].slice(0, 4)),
        `${a.name}: selling only the obviously-spare buildings is not enough`,
      ).toBe(false);
    }
  });
});

/* ==========================================================================
 * SECTION 2 — THE SURVEY
 * ========================================================================== */

interface Rig {
  world: World;
  channels: Channels;
  production: ProductionService;
  tick: number;
  eva: EvaLine[];
}

async function makeRig(faction = Faction.Allies): Promise<Rig> {
  const world = new World();
  world.addPlayer(faction, 'Commander', true, true);
  world.addPlayer(Faction.Soviets, 'Opponent', false, false);
  const channels = new Channels();
  const catalog = new ProductionCatalog(await resolveDefBinding());
  const production = new ProductionService(world, channels, catalog);
  production.bindingTables = (await resolveDefBinding()).tables;
  setProduction(production);
  bindDeployTables(null);

  const eva: EvaLine[] = [];
  world.audio.eva = (_p: PlayerId, line: EvaLine): void => { eva.push(line); };

  return { world, channels, production, tick: 0, eva };
}

function step(rig: Rig, steps = 1): void {
  const rng = new Rng(99);
  for (let n = 0; n < steps; n++) {
    rig.tick++;
    rig.world.tick = rig.tick;
    rig.world.time = rig.tick * SIM_DT;
    const s: SimContext = { dt: SIM_DT, tick: rig.tick, time: rig.world.time, rng };
    rig.production.tick(s);
    rig.world.spatial.rebuild();
    crisisSystem.simTick?.(s);
  }
}

function building(rig: Rig, key: string, cx: number, cz: number, player: PlayerId = P0): EntityId {
  const entry = rig.production.catalog.byKey(key);
  expect(entry, `no catalog entry for "${key}"`).not.toBeNull();
  return rig.production.spawnBuilding(rig.world.player(player), entry!, cx, cz, 1);
}

function unit(rig: Rig, key: string, x: number, z: number, player: PlayerId = P0): EntityId {
  const entry = rig.production.catalog.byKey(key);
  expect(entry, `no catalog entry for "${key}"`).not.toBeNull();
  return rig.production.spawnUnit(rig.world.player(player), entry!, x, z, 0);
}

/**
 * Blow up every harvester `player` owns.
 *
 * Every fixture below needs this, and that is worth noticing rather than
 * hiding: `spawnBuilding` of a refinery FINISHES it, which fires
 * `building:completed`, which honours `shipsWith` and hands over a miner. So a
 * test that builds the reported base and forgets this one line is testing a
 * player who has a harvester — which is to say, testing nothing. It is also
 * exactly the reported sequence: the refinery gave you one, and then it died.
 */
function killHarvesters(rig: Rig, player: PlayerId = P0): number {
  const st = rig.world.store;
  const list = st.byKind[EntityKind.Vehicle];
  const doomed: EntityId[] = [];
  for (let a = 0; a < st.byKindCount[EntityKind.Vehicle]; a++) {
    const i = list[a];
    if (st.owner[i] !== (player as number)) continue;
    if ((st.flags[i] & EntityFlag.IsHarvester) === 0) continue;
    doomed.push(st.handleOf(i));
  }
  for (const id of doomed) st.markDead(id);
  st.flushDestroyed();
  return doomed.length;
}

/** Alive harvesters owned by `player`. */
function harvesters(rig: Rig, player: PlayerId = P0): number {
  const st = rig.world.store;
  const list = st.byKind[EntityKind.Vehicle];
  let n = 0;
  for (let a = 0; a < st.byKindCount[EntityKind.Vehicle]; a++) {
    const i = list[a];
    if (st.owner[i] !== (player as number)) continue;
    const f = st.flags[i];
    if ((f & EntityFlag.Alive) === 0 || (f & EntityFlag.PendingDestroy) !== 0) continue;
    if ((f & EntityFlag.IsHarvester) !== 0) n++;
  }
  return n;
}

function captureToasts(): string[] {
  const out: string[] = [];
  (globalThis as unknown as Record<string, unknown>).__vmHud = {
    toast(kind: string, key: string, title: string, detail = '') {
      out.push(`${kind}|${key}|${title}|${detail}`);
    },
  };
  return out;
}

function clearHud(): void {
  delete (globalThis as unknown as Record<string, unknown>).__vmHud;
}

describe('surveyOreCrisis', () => {
  afterEach(() => { clearHud(); setProduction(null); });

  it('picks the PACT refinery for a Pact player, not the shared Neutral one', async () => {
    const rig = await makeRig(Faction.Meridian);
    const entry = refineryEntryFor(rig.production, P0);
    expect(entry?.key).toBe('mrdCistern');
    expect(entry?.shipsWith).toBe('mrdCollector');
    // The trap: `refinery` is Faction.Neutral, ships a harvester, and comes
    // first in `catalog.entries`. Scanning that list surveys the Pact against
    // a 1400-credit Allied miner it can never build.
    expect(rig.production.catalog.byKey('refinery')?.faction).toBe(Faction.Neutral);
  });

  it('says nothing while a harvester is alive', async () => {
    const rig = await makeRig();
    building(rig, 'conyard', 40, 40);
    building(rig, 'powerPlant', 52, 40);
    building(rig, 'refinery', 64, 40);
    killHarvesters(rig);
    unit(rig, 'harvester', 200, 200);
    rig.world.player(P0).credits = 0;
    step(rig, 1);

    const s = surveyOreCrisis(rig.world, rig.production, P0, makeOreCrisisSurvey());
    expect(s.harvesters).toBe(1);
    expect(s.state).toBe(OreCrisisState.None);
  });

  it('says nothing while the player can simply afford one', async () => {
    const rig = await makeRig();
    building(rig, 'conyard', 40, 40);
    building(rig, 'powerPlant', 52, 40);
    building(rig, 'refinery', 64, 40);
    building(rig, 'warFactory', 76, 40);
    killHarvesters(rig);
    rig.world.player(P0).credits = 5000;
    step(rig, 1);

    const s = surveyOreCrisis(rig.world, rig.production, P0, makeOreCrisisSurvey());
    expect(s.harvesters).toBe(0);
    expect(s.harvesterBuildable).toBe(true);
    expect(s.state).toBe(OreCrisisState.None);
  });

  it('THE REPORTED STATE is Stranded: yard + power + refinery, no miner, no money', async () => {
    const rig = await makeRig();
    building(rig, 'conyard', 40, 40);
    building(rig, 'powerPlant', 52, 40);
    building(rig, 'refinery', 64, 40);
    killHarvesters(rig);
    rig.world.player(P0).credits = 0;
    step(rig, 1);

    const s = surveyOreCrisis(rig.world, rig.production, P0, makeOreCrisisSurvey());
    expect(s.harvesters).toBe(0);
    expect(s.refineries).toBe(1);
    // No vehicle factory: route V is not even open.
    expect(s.harvesterBuildable).toBe(false);
    // Route S is open but the pot does not reach 2000.
    expect(s.refineryBuildable).toBe(true);
    expect(s.raisableForRefinery).toBeLessThan(s.refineryCost);
    expect(s.state).toBe(OreCrisisState.Stranded);
  });

  it('is SellOut, not Stranded, when the spare buildings really do cover it', async () => {
    const rig = await makeRig();
    building(rig, 'conyard', 40, 40);
    building(rig, 'powerPlant', 52, 40);
    building(rig, 'refinery', 64, 40);
    building(rig, 'warFactory', 76, 40);
    building(rig, 'battleLab', 88, 40);
    building(rig, 'radar', 100, 40);
    building(rig, 'barracks', 112, 40);
    killHarvesters(rig);
    rig.world.player(P0).credits = 0;
    step(rig, 1);

    const s = surveyOreCrisis(rig.world, rig.production, P0, makeOreCrisisSurvey());
    expect(s.harvesterBuildable).toBe(true);
    // Proving ground 1000 + radar 500 + barracks 250 + power 150 = 1900 >= 1400.
    expect(s.raisableForHarvester).toBeGreaterThanOrEqual(s.harvesterCost);
    expect(s.state).toBe(OreCrisisState.SellOut);
  });

  it('names one conservative sale at a time and preserves the recovery route', async () => {
    const rig = await makeRig();
    building(rig, 'conyard', 40, 40);
    building(rig, 'powerPlant', 52, 40);
    building(rig, 'refinery', 64, 40);
    building(rig, 'warFactory', 76, 40);
    building(rig, 'battleLab', 88, 40);
    building(rig, 'radar', 100, 40);
    building(rig, 'barracks', 112, 40);
    killHarvesters(rig);
    rig.world.player(P0).credits = 0;
    step(rig, 1);

    const survey = makeOreCrisisSurvey();
    const first = oreCrisisSaleCandidate(rig.world, rig.production, P0, survey);
    expect(rig.production.entryOf(first)?.key).toBe('battleLab');
    // The 1000-credit refund does not quite buy the 1400-credit Allied miner,
    // so the planner must observe this sale before naming another one.
    rig.production.sell(P0, first);
    step(rig, 1);
    expect(rig.world.player(P0).credits).toBe(1000);

    const second = oreCrisisSaleCandidate(rig.world, rig.production, P0, survey);
    expect(rig.production.entryOf(second)?.key).toBe('radar');
    rig.production.sell(P0, second);
    step(rig, 1);
    expect(rig.world.player(P0).credits).toBeGreaterThanOrEqual(survey.harvesterCost);
    expect(surveyOreCrisis(rig.world, rig.production, P0, survey).state)
      .toBe(OreCrisisState.None);

    const survivors: string[] = [];
    const st = rig.world.store;
    const list = st.byKind[EntityKind.Building];
    for (let a = 0; a < st.byKindCount[EntityKind.Building]; a++) {
      const i = list[a];
      if (st.owner[i] !== (P0 as number)) continue;
      const key = rig.production.entryOf(st.handleOf(i))?.key;
      if (key !== undefined) survivors.push(key);
    }
    expect(survivors).toEqual(expect.arrayContaining(['conyard', 'refinery', 'warFactory']));
  });

  it('offers no sale when the position is genuinely stranded', async () => {
    const rig = await makeRig();
    building(rig, 'conyard', 40, 40);
    building(rig, 'powerPlant', 52, 40);
    building(rig, 'refinery', 64, 40);
    killHarvesters(rig);
    rig.world.player(P0).credits = 0;
    step(rig, 1);

    const survey = makeOreCrisisSurvey();
    expect(surveyOreCrisis(rig.world, rig.production, P0, survey).state)
      .toBe(OreCrisisState.Stranded);
    expect(oreCrisisSaleCandidate(rig.world, rig.production, P0, survey)).toBe(0);
  });

  it('a queued harvester ends the crisis — income is already on its way', async () => {
    const rig = await makeRig();
    building(rig, 'conyard', 40, 40);
    building(rig, 'powerPlant', 52, 40);
    building(rig, 'refinery', 64, 40);
    building(rig, 'warFactory', 76, 40);
    killHarvesters(rig);
    rig.world.player(P0).credits = 0;
    step(rig, 2);

    const before = surveyOreCrisis(rig.world, rig.production, P0, makeOreCrisisSurvey());
    expect(before.state).not.toBe(OreCrisisState.None);

    rig.world.player(P0).credits = 5000;
    rig.production.enqueueByKey(P0, 'harvester', 1);
    step(rig, 2);
    rig.world.player(P0).credits = 0;

    const s = surveyOreCrisis(rig.world, rig.production, P0, makeOreCrisisSurvey());
    expect(s.queued).toBe(1);
    expect(s.state).toBe(OreCrisisState.None);
  });

  it('a half-built refinery is not a refinery — under construction counts nowhere', async () => {
    const rig = await makeRig();
    building(rig, 'conyard', 40, 40);
    building(rig, 'powerPlant', 52, 40);
    const half = building(rig, 'refinery', 64, 40);
    killHarvesters(rig);
    rig.world.player(P0).credits = 0;
    step(rig, 1);
    // AFTER the tick, not before: `production.tick` finishes a spawned
    // structure and would clear the flag straight back off again.
    const i = rig.world.store.index(half);
    rig.world.store.flags[i] |= EntityFlag.UnderConstruction;

    const s = surveyOreCrisis(rig.world, rig.production, P0, makeOreCrisisSurvey());
    expect(s.refineries).toBe(0);
    // And with no finished refinery there is nothing to redeem from, so the
    // rescue cannot fire off a building that is still going up.
    expect(s.state).toBe(OreCrisisState.Stranded);
  });
});

/* ==========================================================================
 * SECTION 3 — WHAT THE PLAYER IS TOLD, AND WHAT ARRIVES
 * ========================================================================== */

describe('orecrisis.system', () => {
  let rig: Rig;
  let toasts: string[];

  beforeEach(async () => {
    rig = await makeRig();
    setGameContext({ world: rig.world, channels: rig.channels } as unknown as GameContext);
    toasts = captureToasts();
    crisisSystem.init?.();
  });

  afterEach(() => {
    crisisSystem.dispose?.();
    setGameContext(null);
    setProduction(null);
    clearHud();
  });

  it('TELLS THE PLAYER TO SELL, by name, when selling would work', () => {
    building(rig, 'conyard', 40, 40);
    building(rig, 'powerPlant', 52, 40);
    building(rig, 'refinery', 64, 40);
    building(rig, 'warFactory', 76, 40);
    building(rig, 'battleLab', 88, 40);
    building(rig, 'radar', 100, 40);
    building(rig, 'barracks', 112, 40);
    killHarvesters(rig);
    rig.world.player(P0).credits = 0;
    step(rig, CRISIS_SURVEY_INTERVAL * 2);

    expect(localCrisis).toBe(OreCrisisState.SellOut);
    const said = toasts.join('\n');
    // The entire defect was that nothing said this. Both halves matter: the
    // verb, and the number that makes it feel possible.
    expect(said).toContain('No ore miner');
    expect(said).toMatch(/SELL tool/);
    expect(said).toMatch(/\d+ short/);
    expect(rig.eva).toContain(EvaLine.NoOreMiner);
    // THE DETAIL LINE MUST SURVIVE THE CHIP. `.vm-toast-detail` is nowrap +
    // ellipsis at roughly 45 characters, and the first version of this string
    // put the instruction past the cut — a live capture showed the player
    // "Mining has stopped and you are 1400 credits s…" and nothing else.
    const detail = said.split('|')[3] ?? '';
    expect(detail.length, `chip detail "${detail}" will be ellipsised`).toBeLessThanOrEqual(45);
  });

  it('does NOT rescue a player who could sell their way out', () => {
    building(rig, 'conyard', 40, 40);
    building(rig, 'powerPlant', 52, 40);
    building(rig, 'refinery', 64, 40);
    building(rig, 'warFactory', 76, 40);
    building(rig, 'battleLab', 88, 40);
    building(rig, 'radar', 100, 40);
    building(rig, 'barracks', 112, 40);
    killHarvesters(rig);
    rig.world.player(P0).credits = 0;
    step(rig, RESCUE_DELAY_TICKS * 2);

    expect(harvesters(rig)).toBe(0);
    expect(rescuesGranted).toBe(0);
  });

  it('THE RESCUE: a standing refinery redeems its promise once the state is proven hopeless', () => {
    building(rig, 'conyard', 40, 40);
    building(rig, 'powerPlant', 52, 40);
    building(rig, 'refinery', 64, 40);
    killHarvesters(rig);
    rig.world.player(P0).credits = 0;

    // Nothing arrives during the grace: the player still gets their chance.
    step(rig, RESCUE_DELAY_TICKS - CRISIS_SURVEY_INTERVAL * 2);
    expect(harvesters(rig)).toBe(0);

    step(rig, CRISIS_SURVEY_INTERVAL * 4);
    expect(harvesters(rig)).toBe(1);
    expect(rescuesGranted).toBe(1);
    expect(rig.eva).toContain(EvaLine.Reinforcements);
    expect(toasts.join('\n')).toContain('Ore miner dispatched');
  });

  it('THE COUNTER-PLAY: no refinery standing, no rescue', () => {
    // Same hopeless state, but the attacker took the economic target. This is
    // the clause that keeps starving an opponent out a real strategy.
    building(rig, 'conyard', 40, 40);
    building(rig, 'powerPlant', 52, 40);
    building(rig, 'warFactory', 76, 40);
    rig.world.player(P0).credits = 0;
    step(rig, RESCUE_DELAY_TICKS * 2);

    expect(harvesters(rig)).toBe(0);
    expect(rescuesGranted).toBe(0);
  });

  it('delivers ONE, not one per survey tick', () => {
    building(rig, 'conyard', 40, 40);
    building(rig, 'powerPlant', 52, 40);
    building(rig, 'refinery', 64, 40);
    killHarvesters(rig);
    rig.world.player(P0).credits = 0;
    // Three full delay windows: sixty survey passes, any one of which could
    // have fired again if the delivery did not end the state.
    step(rig, RESCUE_DELAY_TICKS * 3);

    expect(harvesters(rig)).toBe(1);
    expect(rescuesGranted).toBe(1);
  });

  it('TWO refineries is SellOut, not Stranded — selling both really does pay for one', () => {
    // Worth pinning because it is the survey being RIGHT where a cruder "no
    // miner and no money" rule would hand out a free hull: two refineries
    // refund 2000, which is exactly a fresh refinery, which ships a miner.
    building(rig, 'conyard', 40, 40);
    building(rig, 'powerPlant', 52, 40);
    building(rig, 'refinery', 64, 40);
    building(rig, 'refinery', 90, 40);
    killHarvesters(rig);
    rig.world.player(P0).credits = 0;
    step(rig, RESCUE_DELAY_TICKS * 2);

    expect(localCrisis).toBe(OreCrisisState.SellOut);
    expect(rescuesGranted).toBe(0);
    expect(harvesters(rig)).toBe(0);
  });

  it('binds the AI too — the rule is sim state, not a HUD courtesy', () => {
    const P1 = 1 as PlayerId;
    building(rig, 'conyard', 90, 100, P1);
    building(rig, 'powerPlant', 102, 100, P1);
    building(rig, 'refinery', 114, 100, P1);
    // Assert the fixture, not just the outcome: if the refinery never shipped
    // its miner there is nothing to kill, the player is in crisis for the
    // wrong reason, and the test below would pass on a rescue that was really
    // the ordinary `shipsWith` delivery arriving late.
    expect(killHarvesters(rig, P1)).toBe(1);
    rig.world.player(P1).credits = 0;
    // Keep the local player out of the crisis so nothing else fires.
    building(rig, 'conyard', 40, 40);
    unit(rig, 'harvester', 60, 60);
    step(rig, RESCUE_DELAY_TICKS * 2);

    expect(harvesters(rig, P1)).toBe(1);
    // A lockstep client must not be able to tell the human's rescue from the
    // AI's: both go through the same survey and the same delivery.
    expect(rescuesGranted).toBe(1);
  });
});

/* ==========================================================================
 * SECTION 4 — THE CONTENT PROMISE
 * ========================================================================== */

describe('the shipsWith promise the rescue redeems', () => {
  afterEach(() => { setProduction(null); });

  it('every army has exactly one refinery, and it ships a miner that exists', async () => {
    const cat = new ProductionCatalog(await resolveDefBinding());
    for (const a of ARMIES) {
      const ships = cat.roster(a.faction, BuildTab.Structures)
        .filter((e) => e.kind === BuildKind.Building && e.shipsWith !== '');
      expect(ships.map((e) => e.key), `${a.name} refineries`).toEqual([a.refinery]);
      const miner = cat.byKey(ships[0].shipsWith);
      expect(miner, `${a.name}: ${ships[0].shipsWith} must exist`).not.toBeNull();
      expect(miner!.kind).toBe(BuildKind.Unit);
    }
  });

  it('refundOf is exactly what applySell pays', async () => {
    const cat = new ProductionCatalog(await resolveDefBinding());
    const refinery = cat.byKey('refinery')!;
    expect(refundOf(refinery)).toBe(Math.round(refinery.cost * SELL_REFUND));
    // And the number the deadlock turns on: half a refinery does not buy one.
    expect(refundOf(refinery) * 2).toBe(refinery.cost);
  });
});
