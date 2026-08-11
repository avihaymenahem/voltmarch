/**
 * ============================================================================
 * tests/commander-powers.spec.ts — the five powers the missions pay for
 * ============================================================================
 * WHAT THIS FILE IS ABOUT
 * -----------------------
 * `power.airstrike`, `power.orbital-scan`, `power.emergency-repair`,
 * `power.ore-boost` and `power.chronoshift` were paid out by five missions,
 * written onto the profile, announced on the end screen as "Commander Power —
 * <name> — Callable once charged, in any match", and read by nothing at all.
 * `UnlockGate` only ever answers about a def carrying `unlockedBy` and no def
 * carries a `power.*` tag, so the five strings sat in `profile.unlocked` where
 * no question was ever asked of them.
 *
 * Every test below fails on that code, because on that code there is nothing to
 * import. The ones that would still have compiled — the wiring assertions in
 * §5 — are the ones that matter most: they assert the COMMAND PATH exists, and
 * a power the player cannot press is the same defect wearing a different hat.
 *
 * WHAT IS DELIBERATELY NOT TESTED HERE
 * ------------------------------------
 * Whether the player OWNS a power. The simulation must never be able to ask, so
 * there is nothing in `CommanderPowerService` to test for it — see §5 and the
 * header of `src/sim/CommanderPowers.ts`.
 * ============================================================================
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { MAX_PLAYERS, SIM_DT, SIM_HZ } from '../src/core/config';
import { Channels } from '../src/core/events';
import { Rng } from '../src/core/math';
import {
  ArmorClass, CreditReason, EntityFlag, EntityKind, Faction, Locomotor, Stance, UnitState,
} from '../src/core/types';
import type { EntityId, PlayerId, SimContext } from '../src/core/types';
import { World } from '../src/core/world';
import { Economy, setActiveEconomy } from '../src/sim/Economy';
import {
  COMMANDER_POWERS, COMMANDER_POWER_FX, COMMANDER_POWER_LIST, CommanderPowerId,
  isCommanderPowerId, powerByKey, powerByUnlockId, powersOwnedBy,
} from '../src/progression/powers';
import {
  CommanderPowerService, commanderPowerSeamOf, setCommanderPowerSeam,
} from '../src/sim/CommanderPowers';

/* ==========================================================================
 * FIXTURES
 * ========================================================================== */

const P0 = 0 as PlayerId;
const P1 = 1 as PlayerId;

interface Rig {
  world: World;
  channels: Channels;
  powers: CommanderPowerService;
  economy: Economy;
}

let simTick = 0;

beforeEach(() => {
  simTick = 0;
  setActiveEconomy(null);
  setCommanderPowerSeam(null);
});

function makeRig(): Rig {
  const world = new World();
  world.addPlayer(Faction.Allies, 'Commander', true, true);
  world.addPlayer(Faction.Soviets, 'Opponent', false, false);
  const channels = new Channels();
  const economy = new Economy(world, channels);
  setActiveEconomy(economy);
  return { world, channels, powers: new CommanderPowerService(world, channels), economy };
}

function step(rig: Rig, steps = 1): void {
  const rng = new Rng(17);
  for (let i = 0; i < steps; i++) {
    simTick++;
    rig.world.tick = simTick;
    rig.world.time = simTick * SIM_DT;
    const s: SimContext = { dt: SIM_DT, tick: simTick, time: rig.world.time, rng };
    rig.powers.tick(s);
    rig.world.spatial.rebuild();
  }
}

interface SpawnOpts {
  kind?: EntityKind;
  hp?: number;
  flags?: number;
}

function spawn(rig: Rig, player: PlayerId, x: number, z: number, o: SpawnOpts = {}): EntityId {
  const st = rig.world.store;
  const kind = o.kind ?? EntityKind.Vehicle;
  const faction = player === P0 ? Faction.Allies : Faction.Soviets;
  const h = st.alloc(kind, -1, player, faction, x, 0, z, 0);
  const i = st.index(h);
  st.maxHp[i] = o.hp ?? 400;
  st.hp[i] = o.hp ?? 400;
  st.armorClass[i] = ArmorClass.Medium;
  st.radius[i] = 2;
  st.sight[i] = 30;
  st.weaponIndex[i] = -1;
  st.locomotor[i] = kind === EntityKind.Building ? Locomotor.Static : Locomotor.Track;
  st.state[i] = UnitState.Idle;
  st.stance[i] = Stance.Aggressive;
  st.flags[i] |= EntityFlag.ProvidesVision | (kind === EntityKind.Building ? 0 : EntityFlag.CanMove)
    | (o.flags ?? 0);
  rig.world.spatial.rebuild();
  return h;
}

/** Run every power's charge out so `use` is testable without a 4-minute wait. */
function charge(rig: Rig): void {
  let longest = 0;
  for (const p of COMMANDER_POWER_LIST) longest = Math.max(longest, p.chargeSeconds);
  step(rig, Math.ceil(longest * SIM_HZ) + 1);
}

/* ==========================================================================
 * 1. THE TABLE
 * ========================================================================== */

describe('the commander power table', () => {
  it('is a direct lookup with a None row at slot 0', () => {
    expect(COMMANDER_POWERS[0].id).toBe(CommanderPowerId.None);
    for (let i = 0; i < COMMANDER_POWERS.length; i++) {
      expect(COMMANDER_POWERS[i].id, `slot ${i} does not index itself`).toBe(i);
    }
  });

  it('gives every power a unique key, a unique unlock id and a real charge', () => {
    const keys = new Set<string>();
    const ids = new Set<string>();
    for (const p of COMMANDER_POWER_LIST) {
      expect(keys.has(p.key), `duplicate key "${p.key}"`).toBe(false);
      expect(ids.has(p.unlockId), `duplicate unlock "${p.unlockId}"`).toBe(false);
      keys.add(p.key);
      ids.add(p.unlockId);
      expect(p.unlockId.startsWith('power.'), `"${p.key}" is not in the power namespace`).toBe(true);
      expect(p.label.length, `"${p.key}" has no label`).toBeGreaterThan(0);
      expect(p.hint.length, `"${p.key}" has no hint`).toBeGreaterThan(0);
      expect(p.chargeSeconds).toBeGreaterThan(0);
    }
  });

  it('resolves a power by unlock id and by key, and refuses a stranger', () => {
    expect(powerByUnlockId('power.airstrike')?.id).toBe(CommanderPowerId.Airstrike);
    expect(powerByKey('chronoshift')?.id).toBe(CommanderPowerId.Chronoshift);
    expect(powerByUnlockId('power.does-not-exist')).toBeUndefined();
    // The None row is not addressable through either lookup.
    expect(powerByUnlockId('')).toBeUndefined();
    expect(powerByKey('none')).toBeUndefined();
    expect(isCommanderPowerId(CommanderPowerId.None)).toBe(false);
    expect(isCommanderPowerId(COMMANDER_POWERS.length)).toBe(false);
    expect(isCommanderPowerId(1.5)).toBe(false);
  });

  it('answers ownership from a predicate and never from the profile itself', () => {
    const owned = powersOwnedBy((id) => id === 'power.ore-boost');
    expect(owned.map((p) => p.key)).toEqual(['oreBoost']);
    // The absent-progression contract: `isUnlocked` answers true with no layer
    // installed, so every power is offered rather than none.
    expect(powersOwnedBy(() => true).length).toBe(COMMANDER_POWER_LIST.length);
    expect(powersOwnedBy(() => false).length).toBe(0);
  });
});

/* ==========================================================================
 * 2. THE CHARGE
 * ========================================================================== */

describe('the charge', () => {
  it('starts full, so nothing is callable on the first tick of a match', () => {
    const rig = makeRig();
    for (const p of COMMANDER_POWER_LIST) {
      expect(rig.powers.isReady(P0, p.id), `"${p.key}" was ready at t=0`).toBe(false);
      expect(rig.powers.chargeSecondsOf(P0, p.id)).toBeGreaterThan(p.chargeSeconds - 1);
      expect(rig.powers.use(P0, p.id, 100, 100)).toBe('charging');
    }
    expect(rig.powers.stats.refusedCharging).toBe(COMMANDER_POWER_LIST.length);
  });

  it('counts down in whole ticks and is spent again on use', () => {
    const rig = makeRig();
    const spec = COMMANDER_POWERS[CommanderPowerId.OreBoost];
    step(rig, Math.ceil(spec.chargeSeconds * SIM_HZ) + 1);

    expect(rig.powers.chargeSecondsOf(P0, spec.id)).toBe(0);
    expect(rig.powers.isReady(P0, spec.id)).toBe(true);
    expect(rig.powers.use(P0, spec.id, 100, 100)).toBe('fired');
    expect(rig.powers.chargeSecondsOf(P0, spec.id)).toBeGreaterThan(spec.chargeSeconds - 1);
    expect(rig.powers.use(P0, spec.id, 100, 100), 'fired twice with no wait').toBe('charging');
  });

  it('charges each player and each power on its own clock', () => {
    const rig = makeRig();
    charge(rig);
    expect(rig.powers.use(P0, CommanderPowerId.OreBoost, 100, 100)).toBe('fired');

    expect(rig.powers.isReady(P0, CommanderPowerId.OreBoost)).toBe(false);
    expect(rig.powers.isReady(P0, CommanderPowerId.Airstrike), 'one use drained another power')
      .toBe(true);
    expect(rig.powers.isReady(P1, CommanderPowerId.OreBoost), 'one use drained another player')
      .toBe(true);
  });

  it('refuses an id that is not a power and a slot that is not a player', () => {
    const rig = makeRig();
    charge(rig);
    expect(rig.powers.use(P0, 0, 100, 100)).toBe('unknown');
    expect(rig.powers.use(P0, 99, 100, 100)).toBe('unknown');
    expect(rig.powers.use(MAX_PLAYERS as PlayerId, CommanderPowerId.OreBoost, 100, 100))
      .toBe('noPlayer');
    expect(rig.powers.use(-1 as PlayerId, CommanderPowerId.OreBoost, 100, 100)).toBe('noPlayer');
  });

  it('spends the charge even when the call catches nothing', () => {
    // Otherwise it is a free map probe: call it, read the result, learn whether
    // anything was standing there. And "was anything in the circle" is exactly
    // the answer two lockstep clients must not be allowed to disagree about.
    const rig = makeRig();
    charge(rig);
    expect(rig.powers.use(P0, CommanderPowerId.Airstrike, 300, 300)).toBe('noTargets');
    expect(rig.powers.isReady(P0, CommanderPowerId.Airstrike)).toBe(false);
    expect(rig.powers.stats.fired[CommanderPowerId.Airstrike]).toBe(1);
  });
});

/* ==========================================================================
 * 3. THE FIVE EFFECTS
 * ========================================================================== */

describe('AIRSTRIKE', () => {
  it('queues one splash record credited to a unit the caller owns', () => {
    const rig = makeRig();
    // A structure to credit the strike to, well away from the target point.
    spawn(rig, P0, 40, 40, { kind: EntityKind.Building });
    const victim = spawn(rig, P1, 200, 200);
    charge(rig);

    rig.channels.damage.count = 0;
    expect(rig.powers.use(P0, CommanderPowerId.Airstrike, 200, 200)).toBe('fired');

    expect(rig.channels.damage.count, 'one splash record, not one per victim').toBe(1);
    expect(rig.channels.damage.amount[0]).toBe(COMMANDER_POWER_FX.airstrikeDamage);
    expect(rig.channels.damage.splashRadius[0])
      .toBe(COMMANDER_POWERS[CommanderPowerId.Airstrike].radius);
    expect(rig.channels.damage.x[0]).toBe(200);
    expect(rig.channels.damage.z[0]).toBe(200);
    expect(rig.powers.stats.unitsBombed).toBe(1);
    void victim;

    // THE ATTACKER IS NOT `NONE`, and it is not decorative: `Damage.ts` writes
    // `killerPlayer = victim.player` when there is no attacker slot, so a
    // strike credited to nobody pays no bounty and advances no kill mission.
    const attacker = rig.channels.damage.attacker[0];
    expect(attacker, 'the strike was credited to nobody').not.toBe(0);
    expect(rig.world.store.owner[rig.world.store.index(attacker as EntityId)]).toBe(P0 as number);
  });

  it('does not count allies as caught, but still bombs the ground they stand on', () => {
    const rig = makeRig();
    spawn(rig, P0, 200, 200);
    charge(rig);
    expect(rig.powers.use(P0, CommanderPowerId.Airstrike, 200, 200)).toBe('noTargets');
    // One record was still queued: friendly fire is `Damage.ts`'s decision to
    // scale, not this module's decision to skip.
    expect(rig.channels.damage.count).toBeGreaterThan(0);
    expect(rig.powers.stats.unitsBombed).toBe(0);
  });
});

describe('ORBITAL SCAN', () => {
  it('charts a circle for the caller through the vision service', () => {
    const rig = makeRig();
    const calls: Array<{ player: number; x: number; z: number; r: number }> = [];
    // The structural probe the effect uses. `IVision` does not carry the manual
    // reveals, so a boot whose vision service has none must chart nothing
    // rather than throw — which is the second half of this test.
    const vision = rig.world.vision as unknown as Record<string, unknown>;
    vision.exploreCircle = (player: number, x: number, z: number, r: number): void => {
      calls.push({ player, x, z, r });
    };
    charge(rig);

    expect(rig.powers.use(P0, CommanderPowerId.OrbitalScan, 250, 180)).toBe('fired');
    expect(calls).toEqual([{
      player: P0 as number,
      x: 250,
      z: 180,
      r: COMMANDER_POWERS[CommanderPowerId.OrbitalScan].radius,
    }]);
    expect(rig.powers.stats.cellsCharted).toBeGreaterThan(0);
  });

  it('degrades to a no-op when the vision service has no manual reveal', () => {
    const rig = makeRig();
    charge(rig);
    expect(() => rig.powers.use(P0, CommanderPowerId.OrbitalScan, 250, 180)).not.toThrow();
    expect(rig.powers.stats.cellsCharted).toBe(0);
  });
});

describe('EMERGENCY REPAIR', () => {
  it('mends the caller units AND structures, and never the enemy', () => {
    const rig = makeRig();
    const st = rig.world.store;
    const tank = spawn(rig, P0, 200, 200, { hp: 400 });
    const depot = spawn(rig, P0, 205, 200, { kind: EntityKind.Building, hp: 1000 });
    const hostile = spawn(rig, P1, 203, 200, { hp: 400 });
    for (const e of [tank, depot, hostile]) {
      const i = st.index(e);
      st.hp[i] = st.maxHp[i] * 0.25;
    }
    charge(rig);

    expect(rig.powers.use(P0, CommanderPowerId.EmergencyRepair, 202, 200)).toBe('fired');

    const frac = COMMANDER_POWER_FX.repairFraction;
    expect(st.hp[st.index(tank)]).toBeCloseTo(400 * (0.25 + frac), 3);
    expect(st.hp[st.index(depot)], 'a structure was not mended').toBeCloseTo(1000 * (0.25 + frac), 3);
    expect(st.hp[st.index(hostile)], 'it healed the enemy').toBeCloseTo(100, 3);
    expect(rig.powers.stats.entitiesRepaired).toBe(2);
  });

  it('never overheals and reports nothing to do when everything is whole', () => {
    const rig = makeRig();
    const st = rig.world.store;
    const tank = spawn(rig, P0, 200, 200, { hp: 400 });
    st.hp[st.index(tank)] = 399;
    charge(rig);

    expect(rig.powers.use(P0, CommanderPowerId.EmergencyRepair, 200, 200)).toBe('fired');
    expect(st.hp[st.index(tank)]).toBe(400);

    step(rig, Math.ceil(COMMANDER_POWERS[CommanderPowerId.EmergencyRepair].chargeSeconds * SIM_HZ) + 1);
    expect(rig.powers.use(P0, CommanderPowerId.EmergencyRepair, 200, 200)).toBe('noTargets');
  });
});

describe('ORE BOOST', () => {
  it('pays credits as a bounty, never as harvested ore', () => {
    const rig = makeRig();
    charge(rig);
    const before = rig.economy.credits(P0);

    const reasons: number[] = [];
    rig.channels.events.on('economy:credits', (e) => {
      if ((e.player as number) === (P0 as number) && e.delta > 0) reasons.push(e.reason);
    });

    expect(rig.powers.use(P0, CommanderPowerId.OreBoost, 0, 0)).toBe('fired');
    // `Economy` coalesces the credit notification to one per player per tick,
    // so the reason only reaches the bus when the ledger next ticks.
    rig.economy.tick(SIM_DT, rig.world.time);

    expect(rig.economy.credits(P0) - before).toBe(COMMANDER_POWER_FX.oreBoostCredits);
    expect(rig.powers.stats.creditsGranted).toBe(COMMANDER_POWER_FX.oreBoostCredits);
    // Harvest would inflate the mining figure on the results screen AND the
    // "mine N credits of ore" missions, which key on exactly that reason.
    expect(reasons).not.toContain(CreditReason.Harvest as number);
    expect(reasons).toContain(CreditReason.Bounty as number);
  });

  it('is a no-op rather than a throw with no economy installed', () => {
    const rig = makeRig();
    setActiveEconomy(null);
    charge(rig);
    expect(rig.powers.use(P0, CommanderPowerId.OreBoost, 0, 0)).toBe('noTargets');
    expect(rig.powers.stats.creditsGranted).toBe(0);
  });
});

describe('CHRONOSHIFT', () => {
  it('lifts the units around the caller base to the marker, prev position and all', () => {
    const rig = makeRig();
    const st = rig.world.store;
    spawn(rig, P0, 100, 100, { kind: EntityKind.Building });
    spawn(rig, P0, 110, 100, { kind: EntityKind.Building });
    const guard = spawn(rig, P0, 108, 104);
    const stranger = spawn(rig, P1, 106, 100);
    charge(rig);

    expect(rig.powers.use(P0, CommanderPowerId.Chronoshift, 400, 400)).toBe('fired');

    const g = st.index(guard);
    expect(Math.hypot(st.posX[g] - 400, st.posZ[g] - 400))
      .toBeLessThanOrEqual(COMMANDER_POWER_FX.chronoshiftSpacing * 3);
    // prev* MUST follow, or the renderer interpolates the unit across the map
    // for one frame and draws a streak through everything in between.
    expect(st.prevX[g]).toBe(st.posX[g]);
    expect(st.prevZ[g]).toBe(st.posZ[g]);
    expect(st.state[g]).toBe(UnitState.Idle);
    expect(st.speed[g]).toBe(0);

    const s = st.index(stranger);
    expect(st.posX[s], 'it teleported the enemy').toBe(106);
    expect(rig.powers.stats.unitsShifted).toBe(1);
  });

  it('lifts nothing when the caller has no buildings to call home', () => {
    const rig = makeRig();
    spawn(rig, P0, 100, 100);
    charge(rig);
    expect(rig.powers.use(P0, CommanderPowerId.Chronoshift, 400, 400)).toBe('noTargets');
    expect(rig.powers.stats.unitsShifted).toBe(0);
  });

  it('never lifts more than the cap, whatever is standing in the pickup circle', () => {
    const rig = makeRig();
    spawn(rig, P0, 100, 100, { kind: EntityKind.Building });
    for (let i = 0; i < COMMANDER_POWER_FX.chronoshiftMaxUnits + 6; i++) {
      spawn(rig, P0, 100 + (i % 6), 100 + Math.floor(i / 6));
    }
    charge(rig);
    expect(rig.powers.use(P0, CommanderPowerId.Chronoshift, 400, 400)).toBe('fired');
    expect(rig.powers.stats.unitsShifted).toBe(COMMANDER_POWER_FX.chronoshiftMaxUnits);
  });
});

/* ==========================================================================
 * 4. DETERMINISM
 * ========================================================================== */

describe('determinism', () => {
  /**
   * Two identical worlds, the same command at the same tick, byte-identical
   * results. This is the property lockstep rests on, and a power is the newest
   * verb that can move a unit across the map.
   */
  it('produces identical state from identical input', () => {
    const run = (): number[] => {
      const rig = makeRig();
      spawn(rig, P0, 100, 100, { kind: EntityKind.Building });
      for (let i = 0; i < 5; i++) spawn(rig, P0, 102 + i, 101);
      charge(rig);
      rig.powers.use(P0, CommanderPowerId.Chronoshift, 380, 260);
      const st = rig.world.store;
      const out: number[] = [];
      const list = st.byKind[EntityKind.Vehicle];
      for (let j = 0; j < st.byKindCount[EntityKind.Vehicle]; j++) {
        out.push(st.posX[list[j]], st.posZ[list[j]]);
      }
      return out;
    };
    expect(run()).toEqual(run());
  });

  it('is banned from the three non-deterministic clocks, like the rest of src/sim', () => {
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'src/sim/CommanderPowers.ts'), 'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(src).not.toMatch(/Math\.random\(/);
    expect(src).not.toMatch(/Date\.now\(/);
    expect(src).not.toMatch(/performance\.now\(/);
  });
});

/* ==========================================================================
 * 5. THE WIRING — the half that makes a power PRESSABLE
 *
 * A perfectly good effect nobody can invoke is the same defect as a reward
 * nobody honours, so these assert the whole path: bus verb -> the one
 * Phase.Command drainer -> the seam -> the service.
 * ========================================================================== */

describe('the command path', () => {
  const raw = (rel: string): string =>
    (require('node:fs') as typeof import('node:fs'))
      .readFileSync(require('node:path').join(__dirname, '..', rel), 'utf8');

  /** Source with comments stripped: prose that DESCRIBES a call is not a call. */
  const read = (rel: string): string => raw(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('carries a power on the bus as its own CommandKind', () => {
    const channels = new Channels();
    channels.commands.issueUsePower(P0, CommanderPowerId.Airstrike, 123.5, 456.25);
    const seen: Array<{ kind: number; arg: number; x: number; z: number; player: number }> = [];
    channels.commands.drain((c) => {
      seen.push({ kind: c.kind as number, arg: c.arg, x: c.x, z: c.z, player: c.player as number });
    });
    expect(seen).toEqual([{
      kind: 13, arg: CommanderPowerId.Airstrike, x: 123.5, z: 456.25, player: 0,
    }]);
  });

  it('reaches the service through the seam the one Phase.Command drainer calls', () => {
    const rig = makeRig();
    setCommanderPowerSeam(rig.powers);
    charge(rig);
    expect(commanderPowerSeamOf()?.use(P0, CommanderPowerId.OreBoost, 10, 10)).toBe('fired');
  });

  it('is handled in the ONE drainer rather than a second one', () => {
    // `CommandBus.drain` is destructive and resets the whole ring. A second
    // drainer inside Phase.Command would eat every command `reissueParked` had
    // just put back for Phase.Production — silently, with no error anywhere.
    expect(read('src/input/Commands.ts')).toContain('case CommandKind.UsePower:');
    expect(
      read('src/sim/commander-powers.system.ts'),
      'sim.commanderPowers must not drain the bus',
    ).not.toMatch(/commands\.drain\(/);
  });

  it('survives a replay and a relay, because both share one switch', () => {
    expect(read('src/net/applyCommand.ts')).toContain('case CommandKind.UsePower:');
    expect(read('src/net/protocol.ts')).toContain('CommandKind.UsePower');
  });

  it('never asks the simulation whether the player owns the power', () => {
    /**
     * THE RULE THIS PROTECTS. The profile is per-browser localStorage. A
     * simulation that refused a power because THIS machine had not earned it
     * would diverge from a peer that had, mid-match, at the exact tick somebody
     * pressed a button — and no checksum catches it earlier.
     *
     * `Scenarios.ts` already reads the gate while BUILDING the world, which is
     * why PvP has to suppress gating entirely; this must not deepen that.
     */
    const src = read('src/sim/CommanderPowers.ts');
    expect(src, 'the sim must not consult the unlock gate').not.toMatch(/isBuildable|unlockGate/);
    expect(src, 'the sim must not read the profile').not.toMatch(/__vmProgression|ProfileStore/);
    // The ownership question has exactly one implementation, and it takes a
    // predicate from its caller rather than reaching for the profile itself.
    expect(read('src/progression/powers.ts')).toContain('export function powersOwnedBy(');
  });
});
