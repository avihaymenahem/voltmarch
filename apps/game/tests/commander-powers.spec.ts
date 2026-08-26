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

import { CELL, MAX_PLAYERS, SIM_DT, SIM_HZ } from '../src/core/config';
import { Channels } from '../src/core/events';
import { Rng } from '../src/core/math';
import {
  ArmorClass, CreditReason, EntityFlag, EntityKind, Faction, Locomotor, Stance, UnitState,
} from '../src/core/types';
import type { EntityId, ITerrain, PlayerId, SimContext } from '../src/core/types';
import { World } from '../src/core/world';
import { Economy, setActiveEconomy } from '../src/sim/Economy';
import {
  COMMANDER_POWERS, COMMANDER_POWER_FX, COMMANDER_POWER_LIST, CommanderPowerId,
  commanderPowerContentKey, grantCommanderPower, isCommanderPowerId, ownedCommanderPowerKeys,
  ownsCommanderPower, powerByContentKey, powerByKey, powersOwnedBy, setCommanderPowersByKey,
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

/**
 * Buy every power for every seated player.
 *
 * The purchase is `ProductionService.installPower`'s job in the running game;
 * these tests build a `CommanderPowerService` over a bare world with no
 * production layer in it, so the mask is set directly through the same pure
 * helper that function calls.
 */
function own(rig: Rig): void {
  for (const pl of rig.world.players) {
    for (const p of COMMANDER_POWER_LIST) grantCommanderPower(pl, p.id as number);
  }
}

/**
 * Buy every power for every seated player, then run every charge out.
 *
 * TWO CONDITIONS SINCE v2.6.0, and folding them into one helper is deliberate:
 * `use()` now checks `commanderPowerMask` BEFORE the charge, so a fixture that
 * only waited would get `notOwned` from every call and the resulting failure
 * would be about the fixture rather than about the effect under test. The
 * ownership gate has its own tests in §2b, where it is the subject.
 */
function charge(rig: Rig): void {
  own(rig);
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

  it('gives every power a unique key, a unique content key and a real charge', () => {
    const keys = new Set<string>();
    const ids = new Set<string>();
    for (const p of COMMANDER_POWER_LIST) {
      const content = commanderPowerContentKey(p);
      expect(keys.has(p.key), `duplicate key "${p.key}"`).toBe(false);
      expect(ids.has(content), `duplicate content key "${content}"`).toBe(false);
      keys.add(p.key);
      ids.add(content);
      expect(content.startsWith('power.'), `"${p.key}" is not in the power namespace`).toBe(true);
      expect(p.label.length, `"${p.key}" has no label`).toBeGreaterThan(0);
      expect(p.hint.length, `"${p.key}" has no hint`).toBeGreaterThan(0);
      expect(p.chargeSeconds).toBeGreaterThan(0);
    }
  });

  it('resolves a power by content key and by key, and refuses a stranger', () => {
    expect(powerByContentKey('power.airstrike')?.id).toBe(CommanderPowerId.Airstrike);
    expect(powerByKey('chronoshift')?.id).toBe(CommanderPowerId.Chronoshift);
    expect(powerByContentKey('power.doesNotExist')).toBeUndefined();
    // A bare power key is NOT a content key: the prefix is the join.
    expect(powerByContentKey('airstrike')).toBeUndefined();
    // The None row is not addressable through either lookup.
    expect(powerByContentKey('')).toBeUndefined();
    expect(powerByKey('none')).toBeUndefined();
    expect(isCommanderPowerId(CommanderPowerId.None)).toBe(false);
    expect(isCommanderPowerId(COMMANDER_POWERS.length)).toBe(false);
    expect(isCommanderPowerId(1.5)).toBe(false);
  });

  it('answers ownership from the MATCH mask, never from a profile', () => {
    // The v2.6.0 change in one assertion. `powersOwnedBy` used to take an
    // `isUnlocked` predicate and read this browser's localStorage; it takes
    // simulation state now, which is the whole reason
    // `CommanderPowerService.use` is allowed to ask the same question.
    const owner = { commanderPowerMask: 0 };
    expect(powersOwnedBy(owner).length).toBe(0);

    expect(grantCommanderPower(owner, CommanderPowerId.OreBoost)).toBe(true);
    expect(powersOwnedBy(owner).map((p) => p.key)).toEqual(['oreBoost']);
    // A second grant is a no-op and says so, exactly as `grantUpgrade` does.
    expect(grantCommanderPower(owner, CommanderPowerId.OreBoost)).toBe(false);

    for (const p of COMMANDER_POWER_LIST) grantCommanderPower(owner, p.id as number);
    expect(powersOwnedBy(owner).length).toBe(COMMANDER_POWER_LIST.length);

    // The None row is not ownable and neither is anything off the end.
    expect(grantCommanderPower(owner, CommanderPowerId.None)).toBe(false);
    expect(grantCommanderPower(owner, COMMANDER_POWERS.length)).toBe(false);
    expect(ownsCommanderPower(owner, CommanderPowerId.None)).toBe(false);
  });

  it('round-trips the bought set through KEYS, which is what the save stores', () => {
    // Keys and not the raw mask, for the reason `SaveGame` stores
    // `upgradeKeys`: a save outlives the table that produced its indices.
    const owner = { commanderPowerMask: 0 };
    grantCommanderPower(owner, CommanderPowerId.Airstrike);
    grantCommanderPower(owner, CommanderPowerId.Chronoshift);
    const keys = ownedCommanderPowerKeys(owner, []);
    expect(keys).toEqual(['airstrike', 'chronoshift']);

    const loaded = { commanderPowerMask: 0 };
    setCommanderPowersByKey(loaded, keys);
    expect(loaded.commanderPowerMask).toBe(owner.commanderPowerMask);

    // REPLACES, never merges — a load must not leave the previous match's
    // purchases behind — and an unknown key from a later build is dropped
    // rather than guessed at.
    setCommanderPowersByKey(loaded, ['oreBoost', 'somethingFromTheFuture']);
    expect(ownedCommanderPowerKeys(loaded, [])).toEqual(['oreBoost']);
  });
});

/* ==========================================================================
 * 1b. OWNERSHIP — the gate the simulation was once forbidden to have
 *
 * The header of `src/sim/CommanderPowers.ts` spent forty lines explaining why
 * `use()` could not consult ownership: it lived in this browser's localStorage,
 * so a refusal would land on one machine only, at the tick a button was
 * pressed. `commanderPowerMask` is written inside `simTick` off a command that
 * crossed the bus, which is what makes these assertions safe to make at all.
 * ========================================================================== */

describe('ownership', () => {
  it('refuses a power that was never bought, however long the charge has run', () => {
    const rig = makeRig();
    // Everything else `use()` needs is true: the charge is out, the player is
    // real, the target is on the map. Only the purchase is missing.
    let longest = 0;
    for (const p of COMMANDER_POWER_LIST) longest = Math.max(longest, p.chargeSeconds);
    step(rig, Math.ceil(longest * SIM_HZ) + 1);

    for (const p of COMMANDER_POWER_LIST) {
      expect(rig.powers.use(P0, p.id, 100, 100), `"${p.key}" fired unbought`).toBe('notOwned');
      expect(rig.powers.isReady(P0, p.id), `"${p.key}" reported ready unbought`).toBe(false);
      expect(rig.powers.owns(P0, p.id)).toBe(false);
    }
    expect(rig.powers.stats.refusedUnowned).toBe(COMMANDER_POWER_LIST.length);
    // The charge was NOT spent by a refusal. A power you do not own must not be
    // a way to reset somebody else's clock.
    expect(rig.powers.stats.fired.reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('fires exactly the power that was bought, and no other', () => {
    const rig = makeRig();
    grantCommanderPower(rig.world.players[0], CommanderPowerId.OreBoost);
    let longest = 0;
    for (const p of COMMANDER_POWER_LIST) longest = Math.max(longest, p.chargeSeconds);
    step(rig, Math.ceil(longest * SIM_HZ) + 1);

    expect(rig.powers.use(P0, CommanderPowerId.OreBoost, 100, 100)).toBe('fired');
    expect(rig.powers.use(P0, CommanderPowerId.Airstrike, 100, 100)).toBe('notOwned');
  });

  it('is per player: one slot buying a power does not arm the other', () => {
    // The PvP-shaped assertion. Ownership is a column of the player block, so
    // it cannot leak sideways the way a module-level set could.
    const rig = makeRig();
    grantCommanderPower(rig.world.players[0], CommanderPowerId.Airstrike);
    let longest = 0;
    for (const p of COMMANDER_POWER_LIST) longest = Math.max(longest, p.chargeSeconds);
    step(rig, Math.ceil(longest * SIM_HZ) + 1);

    expect(rig.powers.isReady(P0, CommanderPowerId.Airstrike)).toBe(true);
    expect(rig.powers.isReady(P1, CommanderPowerId.Airstrike)).toBe(false);
    expect(rig.powers.use(P1, CommanderPowerId.Airstrike, 100, 100)).toBe('notOwned');
  });
});

/* ==========================================================================
 * 2. THE CHARGE
 * ========================================================================== */

describe('the charge', () => {
  it('starts full, so nothing is callable on the first tick of a match', () => {
    const rig = makeRig();
    own(rig);
    for (const p of COMMANDER_POWER_LIST) {
      expect(rig.powers.isReady(P0, p.id), `"${p.key}" was ready at t=0`).toBe(false);
      expect(rig.powers.chargeSecondsOf(P0, p.id)).toBeGreaterThan(p.chargeSeconds - 1);
      expect(rig.powers.use(P0, p.id, 100, 100)).toBe('charging');
    }
    expect(rig.powers.stats.refusedCharging).toBe(COMMANDER_POWER_LIST.length);
  });

  it('counts down in whole ticks and is spent again on use', () => {
    const rig = makeRig();
    own(rig);
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
 * 2b. THE SAVE PORT
 *
 * A save is not a match start; it is the resumption of one match. The charge is
 * per-MATCH simulation state and belongs in the file exactly as the superweapon
 * timers do — OWNERSHIP is per-profile and still must not be, which is why
 * neither method below has any notion of it.
 * ========================================================================== */

describe('the save port', () => {
  it('reports every power for a player, in ticks, and nothing about ownership', () => {
    const rig = makeRig();
    const states = rig.powers.chargeStates(P0);

    expect(states.length).toBe(COMMANDER_POWER_LIST.length);
    for (const p of COMMANDER_POWER_LIST) {
      const row = states.find((s) => s.key === p.key);
      expect(row, `"${p.key}" missing from the charge states`).toBeDefined();
      // TICKS, not seconds, and integer: a full charge is ceil(seconds * SIM_HZ).
      expect(row?.ticks).toBe(Math.ceil(p.chargeSeconds * SIM_HZ));
      expect(Number.isInteger(row?.ticks)).toBe(true);
    }
    // Nothing on the row says whether this profile has earned the power.
    expect(Object.keys(states[0]).sort()).toEqual(['key', 'ticks']);
  });

  it('round-trips a mid-cooldown charge exactly, without going through seconds', () => {
    const rig = makeRig();
    step(rig, 137);

    const before = rig.powers.chargeStates(P0).map((s) => ({ ...s }));
    const fresh = makeRig();
    for (const s of before) expect(fresh.powers.setChargeTicks(P0, s.key, s.ticks)).toBe(true);

    expect(fresh.powers.chargeStates(P0)).toEqual(before);
  });

  it('restores a ready power as ready, and the AI slot alongside the human one', () => {
    const rig = makeRig();
    // `isReady` is BOUGHT AND CHARGED since v2.6.0; this test is about the
    // charge half, so the purchase half is established first.
    own(rig);
    expect(rig.powers.isReady(P0, CommanderPowerId.Airstrike)).toBe(false);

    expect(rig.powers.setChargeTicks(P0, 'airstrike', 0)).toBe(true);
    expect(rig.powers.setChargeTicks(P1, 'emergencyRepair', 60)).toBe(true);

    expect(rig.powers.isReady(P0, CommanderPowerId.Airstrike)).toBe(true);
    expect(rig.powers.isReady(P1, CommanderPowerId.EmergencyRepair)).toBe(false);
    expect(rig.powers.chargeSecondsOf(P1, CommanderPowerId.EmergencyRepair)).toBe(60 / SIM_HZ);
    // The write was per (player, power) and did not spill onto its neighbours.
    expect(rig.powers.isReady(P1, CommanderPowerId.Airstrike)).toBe(false);
  });

  it('refuses a key it does not have and clamps one that is over-full', () => {
    const rig = makeRig();
    own(rig);
    expect(rig.powers.setChargeTicks(P0, 'timeStop', 100)).toBe(false);
    expect(rig.powers.setChargeTicks(P0, '', 100)).toBe(false);
    expect(rig.powers.setChargeTicks(P0, 'none', 100), 'the None row is not a power').toBe(false);
    expect(rig.powers.setChargeTicks(MAX_PLAYERS as PlayerId, 'airstrike', 0)).toBe(false);
    expect(rig.powers.setChargeTicks(P0, 'airstrike', Number.NaN)).toBe(false);

    // A save from a build that priced the power higher must not hold this one
    // hostage past its own table.
    const full = Math.ceil(COMMANDER_POWERS[CommanderPowerId.Chronoshift].chargeSeconds * SIM_HZ);
    expect(rig.powers.setChargeTicks(P0, 'chronoshift', full * 5)).toBe(true);
    expect(rig.powers.chargeStates(P0).find((s) => s.key === 'chronoshift')?.ticks).toBe(full);

    expect(rig.powers.setChargeTicks(P0, 'chronoshift', -50)).toBe(true);
    expect(rig.powers.isReady(P0, CommanderPowerId.Chronoshift)).toBe(true);
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
  it('arms a live sweep over the enemy rather than charting a circle', () => {
    const rig = makeRig();
    const calls: Array<{ player: number; x: number; z: number; seconds: number; radius: number }> = [];
    // The structural probe the effect uses. `IVision` does not carry the manual
    // reveals, so a boot whose vision service has none must sweep nothing
    // rather than throw — which is the last test in this block.
    const vision = rig.world.vision as unknown as Record<string, unknown>;
    vision.sweepArea = (player: number, x: number, z: number, seconds: number, radius: number): void => {
      calls.push({ player, x, z, seconds, radius });
    };
    spawn(rig, P1, 250, 180, { kind: EntityKind.Building });
    charge(rig);

    expect(rig.powers.use(P0, CommanderPowerId.OrbitalScan, 250, 180)).toBe('fired');
    expect(calls).toEqual([{
      player: P0 as number,
      x: 250,
      z: 180,
      seconds: 5,
      radius: COMMANDER_POWERS[CommanderPowerId.OrbitalScan].radius,
    }]);
    // Assets, not cells. THE POINT OF THE CHANGE: the old power charted terrain
    // permanently, so a second cast over the same ground did nothing at all.
    expect(rig.powers.stats.assetsExposed).toBe(1);
  });

  it('counts hostile assets only — not allies, not Gaia, not wrecks', () => {
    const rig = makeRig();
    const vision = rig.world.vision as unknown as Record<string, unknown>;
    vision.sweepArea = (): void => {};
    spawn(rig, P0, 100, 100);                                   // own unit
    spawn(rig, P1, 250, 180);                                   // enemy unit
    spawn(rig, P1, 260, 180, { kind: EntityKind.Building });    // enemy base
    spawn(rig, P1, 270, 180, { kind: EntityKind.Wreck });       // not an asset
    charge(rig);

    expect(rig.powers.use(P0, CommanderPowerId.OrbitalScan, 250, 180)).toBe('fired');
    expect(rig.powers.stats.assetsExposed).toBe(2);
  });

  it('reports noTargets when the enemy owns nothing left to expose', () => {
    const rig = makeRig();
    const vision = rig.world.vision as unknown as Record<string, unknown>;
    vision.sweepArea = (): void => {};
    spawn(rig, P0, 100, 100);
    charge(rig);
    expect(rig.powers.use(P0, CommanderPowerId.OrbitalScan, 250, 180)).toBe('noTargets');
    expect(rig.powers.stats.assetsExposed).toBe(0);
  });

  it('degrades to a no-op when the vision service has no manual reveal', () => {
    const rig = makeRig();
    charge(rig);
    expect(() => rig.powers.use(P0, CommanderPowerId.OrbitalScan, 250, 180)).not.toThrow();
    expect(rig.powers.stats.assetsExposed).toBe(0);
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

  it('leaves a unit where it is when the destination is water it cannot cross', () => {
    // THE OTHER ROUTE TO AN IMMORTAL UNIT AT SEA. `applyChronoshift` wrote
    // `posX`/`posZ` straight from `clampWorld`, which bounds the point to the
    // MAP and says nothing about passability — so aiming the marker over the
    // sea teleported a tank into it, `Idle`, with a `MoveClass` that cannot
    // leave the cell. `Flowfield` cannot recover a unit from an impassable
    // cell, so it never moved again, and `Shell.pollOutcome` counted it
    // forever. Sibling of the `Transport.strand` defect in transport.spec.ts.
    const rig = makeRig();
    const st = rig.world.store;
    spawn(rig, P0, 100, 100, { kind: EntityKind.Building });
    const guard = spawn(rig, P0, 108, 104);
    charge(rig);

    const base = rig.world.terrain;
    rig.world.terrain = {
      ...base,
      // Spread copies OWN properties only, and `terrain`'s methods live on its
      // prototype — so every method this path touches has to be named. Same
      // reason transport.spec.ts re-declares `heightAt` in its own fake.
      heightAt: (x: number, z: number) => base.heightAt(x, z),
      isOccupied: () => false,
      // Everything beyond x = 300 is open sea for a tracked hull.
      isPassable: (cx: number, _cz: number) => cx * CELL < 300,
    } as ITerrain;

    expect(rig.powers.use(P0, CommanderPowerId.Chronoshift, 400, 400)).toBe('noTargets');
    const g = st.index(guard);
    expect(st.posX[g], 'teleported into the sea').toBe(108);
    expect(st.posZ[g]).toBe(104);
    expect(rig.powers.stats.unitsShifted).toBe(0);
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
      .readFileSync(require('node:path').join(__dirname, '..', '..', '..', rel), 'utf8');

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
    expect(read('apps/game/src/input/Commands.ts')).toContain('case CommandKind.UsePower:');
    expect(
      read('apps/game/src/sim/commander-powers.system.ts'),
      'sim.commanderPowers must not drain the bus',
    ).not.toMatch(/commands\.drain\(/);
  });

  it('survives a replay and a relay, because both share one switch', () => {
    expect(read('apps/game/src/net/applyCommand.ts')).toContain('case CommandKind.UsePower:');
    expect(read('packages/protocol/src/index.ts')).toContain('CommandKind.UsePower');
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
    const src = read('apps/game/src/sim/CommanderPowers.ts');
    expect(src, 'the sim must not consult the unlock gate').not.toMatch(/isBuildable|unlockGate/);
    expect(src, 'the sim must not read the profile').not.toMatch(/__vmProgression|ProfileStore/);
    // The ownership question has exactly one implementation, and it takes a
    // predicate from its caller rather than reaching for the profile itself.
    expect(read('apps/game/src/progression/powers.ts')).toContain('export function powersOwnedBy(');
  });
});
