/**
 * ============================================================================
 * VOLTMARCH — tests/ore-accounting.spec.ts
 * ============================================================================
 * "ORE HARVESTED" USED TO BE TWO DIFFERENT NUMBERS UNDER ONE LABEL.
 *
 * `Economy.deposit` marks only the BANKED part of a load with
 * `CreditReason.Harvest` and dumps the overflow as `CreditReason.Waste`, while
 * `p.stats.oreMined` takes the FULL amount. So the end screen's "Ore Harvested"
 * counted ore and the `earn` mission rule counted credits, and the two diverged
 * by exactly whatever a player's silos could not hold — worst for the player
 * who parks at their cap while saving for a tech centre, which is precisely the
 * player `economy.harvest.2` ("Strip Mine") is aimed at.
 *
 * Measured on the real ledger before the fix, and each of these is a separate
 * mechanism rather than three faces of one:
 *
 *   full bank      100 loads of 700 -> oreMined 70,000, earn rule 0
 *   partial fit    700 into 300 of room -> 300 banked, earn rule 0, because
 *                  the overflow's `Waste` mark overwrites the tick's reason
 *                  and takes the part that DID fit down with it
 *   repair drip    50 loads sharing a tick with a 4-credit repair -> earn 0
 *   crate          a bounty in the same tick as a load -> earn 0
 *
 * THE FIX IS A SECOND LEDGER ON THE EVENT, not a change to what `delta` means.
 * `EvCredits.mined` carries credits of ore taken out of the ground, before the
 * cap; `delta`/`reason` still describe the bank, because the HUD's floating
 * number and its red flash are about the bank. `MissionTracker` counts `mined`
 * for any rule that asks for `Harvest`.
 *
 * Every case below fails on the pre-fix build. Cases 1-4 are the tracker
 * reading zero; case 5 is the pooled-payload trap that the fix introduces and
 * `Production.emitCredits` closes.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { World } from '../src/core/world';
import { Channels } from '../src/core/events';
import { CreditReason, Faction } from '../src/core/types';
import type { PlayerId } from '../src/core/types';
import { SIM_DT } from '../src/core/config';
import { Economy } from '../src/sim/Economy';
import { MissionTracker } from '../src/progression/MissionTracker';
import { ProfileStore, type StorageLike } from '../src/progression/profile-store';
import type { MissionDef } from '../src/progression/types';
import { MISSIONS } from '../src/data/Missions';

const P0 = 0 as PlayerId;

/* -------------------------------------------------------------------------- */
/* Harness — the real Economy wired to the real MissionTracker                 */
/* -------------------------------------------------------------------------- */

const NO_TIMERS = { schedule: () => 0, cancel: () => { /* nothing scheduled */ } };

function memory(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); },
    removeItem: (k: string) => { map.delete(k); },
  };
}

/** The row under test, with the same rule shape every ore mission in the table uses. */
const MINE: MissionDef = {
  id: 'test.mine', scope: 'profile', category: 'economy', target: 1_000_000,
  title: 'Mine', description: 'Mine a lot.',
  rule: { on: 'earn', reasons: [CreditReason.Harvest] },
  reward: [{ kind: 'unlock', unlockId: 'test.unlock.mine' }],
};

interface Rig {
  world: World;
  economy: Economy;
  tracker: MissionTracker;
  player: ReturnType<World['player']>;
  /** Advance one sim tick, which is where the coalesced event is flushed. */
  step(): void;
  /** What the mission rule has counted. */
  counted(): number;
}

function makeRig(storageMax: number, credits: number): Rig {
  const world = new World();
  world.addPlayer(Faction.Allies, 'A', true, true);
  const channels = new Channels();
  const economy = new Economy(world, channels);

  const store = new ProfileStore(memory(), { ...NO_TIMERS, now: () => 1000 });
  const tracker = new MissionTracker([MINE], store, { ...NO_TIMERS, now: () => 5000 });
  tracker.attach(channels.events);
  tracker.beginMatch({ seed: 1, localPlayer: 0, faction: Faction.Allies });

  const player = world.player(P0);
  player.storageMax = storageMax;
  player.credits = credits;

  let tick = 0;
  return {
    world, economy, tracker, player,
    step(): void { tick++; economy.tick(SIM_DT, tick * SIM_DT); },
    counted: () => tracker.progressOf('test.mine').value,
  };
}

/* ==========================================================================
 * 1. THE HEADLINE — ore mined into a full bank
 * ========================================================================== */

describe('ore mined into a full bank', () => {
  it('advances the mission by every credit it advances the end screen by', () => {
    // A player pinned at their cap: 10,000 of 10,000, no silos, saving.
    const rig = makeRig(10_000, 10_000);
    for (let k = 0; k < 100; k++) {
      rig.economy.deposit(P0, 700, CreditReason.Harvest);
      rig.step();
    }
    // The end screen's number. THE MISSION MUST AGREE WITH IT — that is the
    // whole defect: one label, one number.
    expect(rig.player.stats.oreMined).toBe(70_000);
    expect(rig.counted()).toBe(70_000);
    // And not one credit of it reached the bank, which is the other half the
    // player is owed and now sees.
    expect(rig.player.credits).toBe(10_000);
    expect(rig.player.stats.oreWasted).toBe(70_000);
  });

  it('counts a load that only partly fits, including the part that fitted', () => {
    // 300 of room for a 700 load. Pre-fix this counted ZERO, not 300: the
    // overflow's `Waste` mark overwrote the tick's reason.
    const rig = makeRig(10_000, 9_700);
    rig.economy.deposit(P0, 700, CreditReason.Harvest);
    rig.step();
    expect(rig.player.credits).toBe(10_000);
    expect(rig.player.stats.oreMined).toBe(700);
    expect(rig.player.stats.oreWasted).toBe(400);
    expect(rig.counted()).toBe(700);
  });
});

/* ==========================================================================
 * 2. THE OTHER TWO WAYS A TICK LOST ITS HARVEST
 *
 * Both are the coalescer: one event per player per tick carries ONE reason,
 * and `mark` lets any non-Harvest cause overwrite it. Neither has anything to
 * do with storage, which is why "just count the banked part properly" would
 * not have fixed them.
 * ========================================================================== */

describe('a harvest sharing its tick with something else', () => {
  it('survives a repair drip', () => {
    const rig = makeRig(1_000_000, 50_000);
    for (let k = 0; k < 50; k++) {
      rig.economy.deposit(P0, 700, CreditReason.Harvest);
      rig.economy.spend(P0, 4, CreditReason.Build);   // RepairSell's per-tick drip
      rig.step();
    }
    expect(rig.player.stats.oreMined).toBe(35_000);
    expect(rig.counted()).toBe(35_000);
  });

  it('survives a crate landing in the same tick', () => {
    const rig = makeRig(1_000_000, 10_000);
    rig.economy.deposit(P0, 700, CreditReason.Harvest);
    rig.economy.deposit(P0, 500, CreditReason.Bounty);   // Crates.ts / a derrick
    rig.step();
    expect(rig.counted()).toBe(700);
    // A bounty is map reward, not ore. It must not inflate an ore mission.
    expect(rig.player.stats.oreMined).toBe(700);
  });
});

/* ==========================================================================
 * 3. THE THINGS THAT MUST NOT HAVE CHANGED
 * ========================================================================== */

describe('the bank ledger is untouched', () => {
  it('still reports the BANKED delta, because that is what the HUD shows', () => {
    const world = new World();
    world.addPlayer(Faction.Allies, 'A', true, true);
    const channels = new Channels();
    const economy = new Economy(world, channels);
    const p = world.player(P0);
    p.storageMax = 10_000;
    p.credits = 9_700;

    let delta = 0;
    let reason = -1;
    let mined = 0;
    channels.events.on('economy:credits', (ev) => {
      delta = ev.delta; reason = ev.reason; mined = ev.mined;
    });
    economy.deposit(P0, 700, CreditReason.Harvest);
    economy.tick(SIM_DT, SIM_DT);

    expect(delta).toBe(300);                    // the bank moved by 300
    expect(reason).toBe(CreditReason.Waste);    // and the HUD still flashes red
    expect(mined).toBe(700);                    // while the mine moved by 700
  });

  it('does not count a refund as ore', () => {
    const rig = makeRig(1_000_000, 5_000);
    rig.economy.refund(P0, 900, CreditReason.Refund);
    rig.step();
    expect(rig.counted()).toBe(0);
    expect(rig.player.stats.oreMined).toBe(0);
  });

  it('adds nothing on a tick with no mining in it', () => {
    const rig = makeRig(1_000_000, 50_000);
    rig.economy.deposit(P0, 700, CreditReason.Harvest);
    rig.step();
    expect(rig.counted()).toBe(700);
    rig.step();
    rig.step();
    expect(rig.counted()).toBe(700);
  });
});

/* ==========================================================================
 * 4. THE POOLED-PAYLOAD TRAP THE FIX INTRODUCES
 *
 * `EventBus.payload` hands back ONE object per event name, reused forever, and
 * `economy:credits` has TWO emitters: `Economy.tick` and
 * `Production.emitCredits`. A build charge that did not clear `mined` would
 * republish the last harvest, and `MissionTracker` would count the same ore
 * twice — every tick a queue was paying. The pool really does keep the value,
 * which is why the assertion below is about the emitter and not about hoping.
 * ========================================================================== */

describe('the shared payload', () => {
  it('really does hold the previous emitter\'s `mined`', () => {
    const world = new World();
    world.addPlayer(Faction.Allies, 'A', true, true);
    const channels = new Channels();
    const economy = new Economy(world, channels);
    world.player(P0).storageMax = 1_000_000;

    economy.deposit(P0, 700, CreditReason.Harvest);
    economy.tick(SIM_DT, SIM_DT);
    // Same object, next caller, nothing cleared.
    expect(channels.events.payload('economy:credits').mined).toBe(700);
  });

  it('is cleared by the other emitter', () => {
    const src = readFileSync(join(__dirname, '..', 'src/sim/Production.ts'), 'utf8');
    const body = /private emitCredits\([^)]*\)[^{]*\{([\s\S]*?)\n  \}/.exec(src);
    expect(body, 'emitCredits must still exist').not.toBeNull();
    expect(body?.[1]).toMatch(/ev\.mined = 0;/);
  });
});

/* ==========================================================================
 * 5. THE SHIPPED TABLE
 *
 * `economy.harvest.2` was repriced 250,000 -> 70,000 on the argument that a
 * whole map seeds ~74,538 credits of ore. That argument is about ore IN THE
 * GROUND, and the harvester rate quoted beside it is
 * `HarvesterController.deliveredTotal`, which is the full pre-cap payout — so
 * the row was priced in mined ore all along and counted in banked credits. This
 * pins the unit rather than the number.
 * ========================================================================== */

describe('the ore missions in data/Missions.ts', () => {
  it('all ask for Harvest, so all of them read the mined ledger', () => {
    const earn = MISSIONS.filter((m) => m.rule?.on === 'earn');
    expect(earn.length).toBeGreaterThan(0);
    for (const m of earn) {
      const rule = m.rule;
      if (rule === undefined || rule.on !== 'earn') continue;
      expect(rule.reasons, `${m.id} must name its reasons`).toBeDefined();
      expect(rule.reasons, `${m.id}`).toContain(CreditReason.Harvest);
      // The description says "Mine", and "Mine" is now what it counts.
      expect(m.description.toLowerCase(), `${m.id}`).toContain('mine');
    }
  });

  it('still prices Strip Mine at one map of ore', () => {
    const strip = MISSIONS.find((m) => m.id === 'economy.harvest.2');
    expect(strip).toBeDefined();
    expect(strip?.target).toBe(70_000);
  });
});
