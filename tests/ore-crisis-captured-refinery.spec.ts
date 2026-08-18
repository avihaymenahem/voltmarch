/// <reference types="vite/client" />
/**
 * ============================================================================
 * tests/ore-crisis-captured-refinery.spec.ts
 * ============================================================================
 * THE DEFECT: THE RESCUE HANDED OUT SOMEBODY ELSE'S HARVESTER.
 *
 * `orecrisis.system.ts#redeemFrom` walks the player's structures and redeems
 * the promise of the FIRST one carrying a `shipsWith`. Three structures carry
 * it — `refinery` (shared, Allies + Soviets), `mrdCistern`, `rclSorter` — and
 * `entryForSlot` resolves an entry from `defId`, which capture does not change.
 * So a Meridian Pact player holding a CAPTURED Allied refinery, in the state
 * the rescue exists for, was handed the Allied `harvester`:
 *
 *   - `Locomotor.Track` against the Pact's `Locomotor.Hover`, i.e. a different
 *     passability class from every other hull the player owns;
 *   - `crushLevel: 5` against the Pact doctrine of 0 on every hull;
 *   - 700 cargo against the Sun Collector's 450, which is a +56% economy;
 *   - `model: 'allied_harvester'`, in a Pact base;
 *   - and NOT REPLACEABLE — `harvester` is not in the Pact roster, so when it
 *     dies the player is back in the same hole with no way to buy another.
 *
 * A rescue that un-strands an economy with a hull the army cannot support or
 * rebuild is a worse outcome than the stall it is fixing, so the rule is: the
 * redemption delivers THE PLAYER'S OWN ARMY'S HAULER, whichever owned refinery
 * it drives out of. `ProductionService.bundledUnitFor` is that rule and
 * `redeemBundledUnit` applies it.
 *
 * WHICH STRUCTURE IT COMES OUT OF IS STILL FREE, and deliberately so — that is
 * geometry, not content. A captured foreign refinery is a perfectly good place
 * for your own hauler to appear, and keeping it in the search is what lets the
 * delivery survive a home refinery that is walled in.
 *
 * THE GATE IS NOT WIDENED. `survey.refineries` counts only structures whose
 * entry key is the player's OWN refinery, so clause 4 — a finished refinery
 * standing — still has to be satisfied by a refinery of your own army. Every
 * fixture below asserts that count is 1, off the captor's own building, with
 * the captured one contributing nothing to it.
 *
 * All four armies, both directions across the shared pool. Headless: no
 * renderer, no clock, no RNG outside the seeded one.
 * ============================================================================
 */

import { afterEach, describe, expect, it } from 'vitest';

import { World } from '../src/core/world';
import { Channels } from '../src/core/events';
import { Rng } from '../src/core/math';
import { EntityFlag, EntityKind, Faction } from '../src/core/types';
import type { EntityId, PlayerId, SimContext } from '../src/core/types';
import { SIM_DT } from '../src/core/config';

import { resolveDefBinding } from '../src/game/Scenarios';
import { ProductionCatalog, ProductionService, setProduction } from '../src/sim/Production';
import { CaptureService } from '../src/sim/Capture';
import { bindDeployTables } from '../src/sim/Deploy';
import { setGameContext } from '../src/game/context';
import type { GameContext } from '../src/game/Bootstrap';

import { OreCrisisState, makeOreCrisisSurvey, refineryEntryFor, surveyOreCrisis } from '../src/sim/OreCrisis';
import crisisSystem, { RESCUE_DELAY_TICKS, rescuesGranted } from '../src/sim/orecrisis.system';

const P0 = 0 as PlayerId;
const P1 = 1 as PlayerId;

/* ==========================================================================
 * THE PAIRINGS
 *
 * A donor whose refinery is a DIFFERENT catalog entry from the captor's, which
 * for the two original armies means reaching across the shared pool: Allies
 * and Soviets author one `refinery` between them, so an Allied player who
 * captures a Soviet one has captured the same entry and there is nothing to
 * get wrong. The pairing that bites is a shared-pool army against a parallel
 * tree, in both directions.
 * ========================================================================== */

interface Pairing {
  name: string;
  captor: Faction;
  /** The captor's own refinery, power plant and hauler. */
  refinery: string; power: string; hauler: string;
  donor: Faction;
  /** The donor's refinery and the hauler it ships — the WRONG answer. */
  donorRefinery: string; donorHauler: string;
}

const PAIRINGS: readonly Pairing[] = [
  {
    name: 'Allies capture a Pact Ore Cistern',
    captor: Faction.Allies, refinery: 'refinery', power: 'powerPlant', hauler: 'harvester',
    donor: Faction.Meridian, donorRefinery: 'mrdCistern', donorHauler: 'mrdCollector',
  },
  {
    name: 'Soviets capture a Reclamation Ore Sorter',
    captor: Faction.Soviets, refinery: 'refinery', power: 'powerPlant', hauler: 'harvester',
    donor: Faction.Reclaim, donorRefinery: 'rclSorter', donorHauler: 'rclScrapper',
  },
  {
    name: 'the Pact captures an Allied Ore Refinery',
    captor: Faction.Meridian, refinery: 'mrdCistern', power: 'mrdSolarArray', hauler: 'mrdCollector',
    donor: Faction.Allies, donorRefinery: 'refinery', donorHauler: 'harvester',
  },
  {
    name: 'the Reclamation captures a Soviet Ore Refinery',
    captor: Faction.Reclaim, refinery: 'rclSorter', power: 'rclFurnace', hauler: 'rclScrapper',
    donor: Faction.Soviets, donorRefinery: 'refinery', donorHauler: 'harvester',
  },
];

/* ==========================================================================
 * THE RIG
 * ========================================================================== */

interface Rig {
  world: World;
  channels: Channels;
  production: ProductionService;
  capture: CaptureService;
  tick: number;
}

async function makeRig(captor: Faction, donor: Faction): Promise<Rig> {
  const world = new World();
  world.addPlayer(captor, 'Captor', true, true);
  world.addPlayer(donor, 'Donor', false, false);
  const channels = new Channels();
  const catalog = new ProductionCatalog(await resolveDefBinding());
  const production = new ProductionService(world, channels, catalog);
  production.bindingTables = (await resolveDefBinding()).tables;
  setProduction(production);
  bindDeployTables(null);
  world.audio.eva = (): void => {};

  return { world, channels, production, capture: new CaptureService(world, channels), tick: 0 };
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

function building(rig: Rig, key: string, cx: number, cz: number, player: PlayerId): EntityId {
  const entry = rig.production.catalog.byKey(key);
  expect(entry, `no catalog entry for "${key}"`).not.toBeNull();
  return rig.production.spawnBuilding(rig.world.player(player), entry!, cx, cz, 1);
}

/** Blow up every harvester `player` owns, and say how many there were. */
function killHarvesters(rig: Rig, player: PlayerId): number {
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

/** Catalog keys of every live harvester `player` owns, in store order. */
function haulerKeys(rig: Rig, player: PlayerId): string[] {
  const st = rig.world.store;
  const list = st.byKind[EntityKind.Vehicle];
  const out: string[] = [];
  for (let a = 0; a < st.byKindCount[EntityKind.Vehicle]; a++) {
    const i = list[a];
    if (st.owner[i] !== (player as number)) continue;
    const f = st.flags[i];
    if ((f & EntityFlag.Alive) === 0 || (f & EntityFlag.PendingDestroy) !== 0) continue;
    if ((f & EntityFlag.IsHarvester) === 0) continue;
    out.push(rig.production.entryOf(st.handleOf(i))?.key ?? `defId:${st.defId[i]}`);
  }
  return out;
}

/** Position of a building in the dense per-kind list `redeemFrom` walks. */
function storeOrderOf(rig: Rig, id: EntityId): number {
  const st = rig.world.store;
  const slot = st.index(id);
  const list = st.byKind[EntityKind.Building];
  for (let a = 0; a < st.byKindCount[EntityKind.Building]; a++) {
    if (list[a] === slot) return a;
  }
  return -1;
}

/**
 * The reported position, built in the order that makes the defect visible.
 *
 * THE SPAWN ORDER IS PART OF THE FIXTURE, not incidental. `redeemFrom` walks
 * `byKind[EntityKind.Building]`, which is allocation order with swap-removes —
 * deterministic on every client, but arbitrary with respect to WHOSE refinery
 * comes first. The donor's goes down first so the captured structure precedes
 * the captor's own, and `storeOrderOf` below asserts it rather than trusting
 * it: with the two the other way round the unfixed code delivers the right
 * hull by luck and this file would pin nothing.
 *
 * THE STATE IS `Stranded` BY THE ORDINARY ROUTE, not by anything the capture
 * did. No Construction Yard, so route S has no structures factory; no vehicle
 * factory, so route V is not open at any price; zero credits. Both `raisable`
 * figures are therefore 0 and no sequence of sells reaches anything. It is the
 * second dead-end shape `tests/ore-crisis.spec.ts` enumerates, with the yard
 * bombed, plus an engineer's worth of spoils.
 */
async function strandedHoldingACapturedRefinery(pair: Pairing): Promise<Rig> {
  const rig = await makeRig(pair.captor, pair.donor);
  setGameContext({ world: rig.world, channels: rig.channels } as unknown as GameContext);
  crisisSystem.init?.();

  // 1. the donor's refinery, standing in the donor's base. It ships the donor
  //    a hauler of the donor's army, which is the hull that must NOT arrive.
  const spoils = building(rig, pair.donorRefinery, 100, 100, P1);
  expect(killHarvesters(rig, P1), `${pair.name}: donor refinery must ship its own`).toBe(1);

  // 2. the captor's own base: a power plant and their own refinery, nothing
  //    else. The refinery ships them a hauler; it is the one that died.
  building(rig, pair.power, 40, 40, P0);
  const home = building(rig, pair.refinery, 52, 40, P0);
  expect(killHarvesters(rig, P0), `${pair.name}: home refinery must ship its own`).toBe(1);
  rig.world.player(P0).credits = 0;

  // 3. the engineer walks in.
  expect(rig.capture.captureBuilding(spoils, P0), `${pair.name}: capture`).toBe(true);
  expect(rig.world.store.owner[rig.world.store.index(spoils)]).toBe(P0 as number);

  expect(
    storeOrderOf(rig, spoils),
    `${pair.name}: the captured refinery must come first, or this fixture proves nothing`,
  ).toBeLessThan(storeOrderOf(rig, home));

  return rig;
}

/* ==========================================================================
 * THE TESTS
 * ========================================================================== */

describe('a captured cross-faction refinery redeems the CAPTOR\'s own hauler', () => {
  afterEach(() => {
    crisisSystem.dispose?.();
    setGameContext(null);
    setProduction(null);
  });

  for (const pair of PAIRINGS) {
    it(`${pair.name}`, async () => {
      const rig = await strandedHoldingACapturedRefinery(pair);

      const s = surveyOreCrisis(rig.world, rig.production, P0, makeOreCrisisSurvey());
      expect(s.state, `${pair.name}: fixture must be Stranded`).toBe(OreCrisisState.Stranded);
      expect(s.harvesterKey).toBe(pair.hauler);
      // CLAUSE 4 IS SATISFIED BY THE CAPTOR'S OWN REFINERY AND ONLY BY IT.
      // The captured one is a different catalog entry, so it counts nowhere —
      // the rescue is not being widened by the capture, only misdirected.
      expect(s.refineries, `${pair.name}: only the home refinery counts`).toBe(1);

      step(rig, RESCUE_DELAY_TICKS * 2);

      expect(rescuesGranted, `${pair.name}: exactly one rescue`).toBe(1);
      expect(
        haulerKeys(rig, P0),
        `${pair.name}: the rescue must deliver ${pair.hauler}, never ${pair.donorHauler}`,
      ).toEqual([pair.hauler]);
    });
  }

  it('A CAPTURED FOREIGN REFINERY DOES NOT SATISFY CLAUSE 4 ON ITS OWN', async () => {
    // The gate is not widened by any of this. `survey.refineries` counts
    // entries whose key is the player's OWN refinery, so a Pact player whose
    // last standing structure is a captured Allied one is Stranded with nothing
    // to redeem from and gets no hull. Pinned because the fix above makes a
    // foreign refinery a legal DELIVERY site, and the next reader will
    // reasonably wonder whether it became a legal gate too. It did not.
    const pair = PAIRINGS[2];
    const rig = await makeRig(pair.captor, pair.donor);
    setGameContext({ world: rig.world, channels: rig.channels } as unknown as GameContext);
    crisisSystem.init?.();

    const spoils = building(rig, pair.donorRefinery, 100, 100, P1);
    killHarvesters(rig, P1);
    expect(rig.capture.captureBuilding(spoils, P0)).toBe(true);
    rig.world.player(P0).credits = 0;

    const s = surveyOreCrisis(rig.world, rig.production, P0, makeOreCrisisSurvey());
    expect(s.state).toBe(OreCrisisState.Stranded);
    expect(s.refineries, 'a foreign refinery is not this army\'s refinery').toBe(0);

    step(rig, RESCUE_DELAY_TICKS * 2);
    expect(rescuesGranted).toBe(0);
    expect(haulerKeys(rig, P0)).toEqual([]);
  });

  it('a captured SOVIET refinery does count for an Allied player, because it is the same entry', async () => {
    // THE ADJACENT ASYMMETRY, PINNED AS THE FACT IT IS RATHER THAN FIXED.
    // Allies and Soviets author one `refinery` between them, so clause 4 reads
    // a captured enemy one as this player's own — while the Pact case above
    // reads a captured Allied one as nobody's. The two original armies are
    // therefore rescuable off spoils and the two parallel trees are not.
    //
    // Left alone on purpose. Closing it means counting any owned bundler, which
    // WIDENS the gate that is the entire defence of a free unit; the direction
    // it currently errs in is the safe one (no rescue where one might be
    // arguable). It is also harmless here: the shared entry ships the shared
    // hauler, so the hull that arrives is the right hull either way.
    const rig = await makeRig(Faction.Allies, Faction.Soviets);
    setGameContext({ world: rig.world, channels: rig.channels } as unknown as GameContext);
    crisisSystem.init?.();

    const spoils = building(rig, 'refinery', 100, 100, P1);
    expect(killHarvesters(rig, P1)).toBe(1);
    building(rig, 'powerPlant', 40, 40, P0);
    building(rig, 'refinery', 52, 40, P0);
    expect(killHarvesters(rig, P0)).toBe(1);
    rig.world.player(P0).credits = 0;
    expect(rig.capture.captureBuilding(spoils, P0)).toBe(true);

    const s = surveyOreCrisis(rig.world, rig.production, P0, makeOreCrisisSurvey());
    expect(s.refineries, 'one shared entry, two buildings').toBe(2);
    expect(s.state).toBe(OreCrisisState.Stranded);

    step(rig, RESCUE_DELAY_TICKS * 2);
    expect(rescuesGranted).toBe(1);
    expect(haulerKeys(rig, P0)).toEqual(['harvester']);
  });

  it('the survey still names the captor\'s own refinery, capture or no capture', async () => {
    // `refineryEntryFor` reads the ROSTER, so it was never the defective half —
    // pinned here so a "simplification" that re-points it at the entities on
    // the map fails in the file that explains why that is wrong.
    for (const pair of PAIRINGS) {
      const rig = await strandedHoldingACapturedRefinery(pair);
      expect(refineryEntryFor(rig.production, P0)?.key, pair.name).toBe(pair.refinery);
      crisisSystem.dispose?.();
      setGameContext(null);
      setProduction(null);
    }
  });
});

/* ==========================================================================
 * THE API, DIRECTLY
 *
 * The system test above depends on the survey reaching `Stranded`, which is a
 * lot of machinery standing between the assertion and the rule. These call
 * `redeemBundledUnit` on the captured structure by hand, which is the exact
 * question: given a foreign refinery you own, whose hauler comes out?
 * ========================================================================== */

describe('ProductionService.redeemBundledUnit', () => {
  afterEach(() => { setProduction(null); });

  for (const pair of PAIRINGS) {
    it(`delivers the captor's hauler off a captured ${pair.donorRefinery}`, async () => {
      const rig = await makeRig(pair.captor, pair.donor);
      const spoils = building(rig, pair.donorRefinery, 100, 100, P1);
      killHarvesters(rig, P1);
      expect(rig.capture.captureBuilding(spoils, P0)).toBe(true);

      expect(rig.production.redeemBundledUnit(P0, spoils)).toBe(true);
      expect(haulerKeys(rig, P0)).toEqual([pair.hauler]);
    });
  }

  it('refuses a structure the caller does not own', async () => {
    const pair = PAIRINGS[2];
    const rig = await makeRig(pair.captor, pair.donor);
    const theirs = building(rig, pair.donorRefinery, 100, 100, P1);
    killHarvesters(rig, P1);
    expect(rig.production.redeemBundledUnit(P0, theirs)).toBe(false);
    expect(haulerKeys(rig, P0)).toEqual([]);
  });

  it('refuses a structure that ships nothing', async () => {
    const pair = PAIRINGS[2];
    const rig = await makeRig(pair.captor, pair.donor);
    const plant = building(rig, pair.power, 40, 40, P0);
    expect(rig.production.redeemBundledUnit(P0, plant)).toBe(false);
    expect(haulerKeys(rig, P0)).toEqual([]);
  });
});
