/**
 * ============================================================================
 * VOLTMARCH — src/sim/CommanderPowers.ts
 * ============================================================================
 * The five commander powers a Command Post sells.
 *
 * These are PLAYER-level support powers: no unit carries them, they are BOUGHT
 * once per match and then charge on their own clock, and they land on a point
 * the caller names. That is a different mechanism from `src/sim/Abilities.ts` —
 * the four faction abilities are self-centred on a hero and are keyed to
 * `UnitDef.ability` — and `src/progression/powers.ts` explains why the two are
 * not one thing.
 *
 *
 * OWNERSHIP IS WORLD STATE NOW, AND THIS FILE IS THE REASON THAT MATTERED
 * -----------------------------------------------------------------------
 * `use()` checks the CHARGE and `PlayerState.commanderPowerMask`. Forty lines
 * used to stand here arguing that it could check only the first, and the
 * argument was correct for the design it described:
 *
 *   Ownership was PROFILE state. `power.airstrike` was a string in this
 *   browser's localStorage, paid out by a mission. A simulation that refused a
 *   power on those grounds would refuse it on ONE MACHINE, mid-match, at the
 *   exact tick a player pressed a button — with no checksum that catches it
 *   earlier and no way to explain it afterwards. So the refusal was pushed out
 *   to the UI that draws the button, and `use()` was made deliberately
 *   credulous.
 *
 * A BUILDING IS NOT THE PROFILE. `commanderPowerMask` grows in exactly one
 * place (`ProductionService.installPower`), inside `simTick`, at a fixed point
 * in a fixed order, off a command that crossed the bus — so both clients set the
 * bit on the same tick or neither does. It is hashed by `Checksum.hashPlayers`,
 * so a divergence in it is caught where it happens rather than as a mystery
 * several seconds later. It is in the save file, by key. The AI reads the same
 * bit the human's sidebar greys the cameo on.
 *
 * The tightrope is therefore gone, and with it the reason the simulation had to
 * be lied to. What is left is the ordinary rule every other purchase in this
 * game already follows: you own it because you bought it, in this match, and
 * everyone watching agrees.
 *
 * WHAT THIS BUYS THAT THE OLD ARRANGEMENT COULD NOT:
 *
 *   Single player   the powers are earned in the match rather than owned from
 *                   the start. A fresh account and a veteran open identically.
 *   PvP             no `suppressUnlockGate` special case is needed and none
 *                   exists here: both sides buy from a structure both sides can
 *                   see and shoot at.
 *   Replay          the purchase is in the command stream, so it replays.
 *   Cheating        a client hacked to issue an unbought power is now REFUSED by
 *                   its own simulation, which is the first time that sentence
 *                   has been true.
 *
 *
 * DETERMINISM
 * -----------
 * Charges are integer TICKS, decremented once per `simTick`, for the reason
 * `Abilities.ts` gives: `world.time` accumulates a float `dt` and drifts by a
 * different amount on every machine. Nothing here reads `Math.random`,
 * `Date.now` or `performance.now`. Every target set is a spatial query walked in
 * store order, and every arrival slot is computed from an integer counter.
 *
 *
 * THE THREE GAPS THIS BLOCK USED TO LIST ARE ALL CLOSED
 * ------------------------------------------------------
 * It read "1. NO HUD BUTTON. 2. THE AI NEVER CALLS ONE. 3. CHARGES ARE NOT IN
 * THE SAVE." All three were true when written and none of them is now, which is
 * the exact shape of rot `docs/SPEC_DRIFT_AUDIT.md` catalogues — a file
 * describing itself as unfinished long after it was finished sends the next
 * reader off to build something that exists.
 *
 *   1. `CommanderPowerBar` in `src/ui/Sidebar.ts` draws the buttons and the
 *      arm-then-click that aims them, off `powersOwnedBy` (v2.3.0).
 *   2. `AI.callPower` issues all five through `channels.command`, gated by
 *      `powerMask` AND by the purchase (v2.3.0, v2.6.0).
 *   3. CHARGES ARE IN THE SAVE, through `chargeStates`/`setChargeTicks` below.
 *
 * ON (3), BECAUSE THE BOUNDARY IS THE INTERESTING PART, and because v2.6.0
 * moved it. There are two per-match facts here now and the save carries both:
 *
 *   OWNERSHIP is `PlayerState.commanderPowerMask`, sim state, saved by KEY
 *     alongside `upgradeKeys` in the players chunk. It used to be profile state
 *     and was deliberately excluded from every save — "a save that carried
 *     unlocks would be a way to hand a fresh account content it had not earned".
 *     That sentence is still true of the PROFILE and no longer describes this:
 *     a bought power is a thing that happened in one match, so a snapshot of
 *     that match must carry it, and a reload that handed the powers back or took
 *     them away would be the same defect the charge omission was.
 *   CHARGE is per-MATCH SIMULATION state. It is seeded full at match start —
 *     that is correct and unchanged — but a LOAD is not a match start. It is
 *     the resumption of one match, and `SaveGame.ts`'s whole thesis is that a
 *     snapshot "restores the numbers that were there".
 *
 * The old note called the charge omission "the safe direction to be wrong in —
 * you never load into a free strike". That was only half the ledger.
 * `Shell.loadGame` boots a fresh engine before restoring, so a load ran
 * `resetCharges()` over EVERY SLOT, the AI's included: reloading during a hard
 * fight put the enemy brain's Emergency Repair and Airstrike back to 150 s of
 * charge, every time. Save-scumming a fight disarmed the opponent's entire
 * late-game layer, which is not a safe direction to be wrong in at all.
 *
 *
 * THE CHARGE TABLE STILL TICKS FOR POWERS NOBODY OWNS, DELIBERATELY
 * -----------------------------------------------------------------
 * `tick()` decrements every slot for every player whether the bit is set or not,
 * and `resetCharges()` seeds all of them at construction. That is one branchless
 * loop over 8 x 6 int32s rather than a mask test per slot, and it means a power
 * bought at minute twelve is callable the moment it is paid for rather than
 * starting a fresh 240-second silence on top of the 2500 credits and the thirty
 * seconds of build time. `installPower` says the same thing from the other side.
 *
 *
 * PHASE.COMMAND, ORDER 9700
 * --------------------------
 * `CommandKind.UsePower` is delivered by the ONE Phase.Command drainer
 * (`src/input/Commands.ts`, order 9000) through the seam at the bottom of this
 * file, exactly as `CommandKind.Relocate` is. A second drainer in this phase
 * would eat every command `reissueParked` had just put back for
 * Phase.Production — see the trap written up in `OrderExecutor.applyRelocate`.
 *
 * The seam calls `use()` synchronously from inside that drain, so the effect
 * lands in the same tick the button was pressed. 9700 is where this module's
 * `simTick` runs, and all it does there is age the charges: it is behind
 * `sim.abilities` (9600) so that a tick which fires both resolves the hero's
 * ability first, which is the order they were pressed in.
 * ============================================================================
 */

import { CELL, MAX_PLAYERS, SIM_HZ } from '../core/config';
import {
  CreditReason, DecalKind, EntityFlag, EntityKind, Faction, FxKind, NONE, OrderKind, UnitState,
  WarheadClass,
} from '../core/types';
import type { Channels } from '../core/events';
import type { EntityId, PlayerId, SimContext } from '../core/types';
import { clampWorld, isInMap, worldToCell } from '../core/math';
import type { World } from '../core/world';
import { locomotorForMoveClass } from './Flowfield';
import { moveClassAt } from './Movement';
import {
  COMMANDER_POWERS, COMMANDER_POWER_FX, CommanderPowerId, isCommanderPowerId,
  ownsCommanderPower,
} from '../progression/powers';
import { getEconomy } from './Economy';

/* ==========================================================================
 * 1. RESULTS AND STATE
 * ========================================================================== */

/**
 * Why a call did or did not land. A closed set, because the HUD has to say
 * something and prose invented at the call site drifts from what happened.
 */
export type PowerResult =
  /** It fired. */
  | 'fired'
  /** Still charging. */
  | 'charging'
  /** `power` is not a `CommanderPowerId`. A caller bug, not a player one. */
  | 'unknown'
  /** This player has not bought it from a Command Post. */
  | 'notOwned'
  /** Not a plausible player slot. */
  | 'noPlayer'
  /** It fired the transaction and there was simply nothing there to affect. */
  | 'noTargets';

/**
 * One power's charge, by content KEY.
 *
 * The key and not the `CommanderPowerId`, for the reason `SaveGame.ts` stores
 * def keys rather than table indices: an index is only meaningful against the
 * table that produced it, and a save outlives that table. `CommanderPowerId`
 * happens to be append-only because it rides the multiplayer wire — but the
 * save format does not get to depend on a promise another file made.
 */
export interface CommanderPowerCharge {
  readonly key: string;
  /** Ticks until callable. 0 means ready. */
  readonly ticks: number;
}

export interface CommanderPowerStats {
  /** Calls that landed, per `CommanderPowerId`. */
  fired: Int32Array;
  /** Calls refused because the power had not finished charging. */
  refusedCharging: number;
  /**
   * Calls refused because the player never bought the power.
   *
   * A COUNTER AND NOT A CONSOLE WARNING. On an honest client this is zero
   * forever — the HUD only draws bought powers and the AI only calls bought
   * powers — so a non-zero value means either a hacked client, a replay from a
   * build whose purchase rules differed, or a bug in the gate. All three are
   * worth being able to see after the fact, and none is worth a log line inside
   * `simTick`.
   */
  refusedUnowned: number;
  unitsBombed: number;
  /**
   * Hostile units and structures exposed by Orbital Scan, summed over casts.
   * Was `cellsCharted` while the power charted a circle; it exposes assets now,
   * and a stat that kept counting cells would be measuring the deleted design.
   */
  assetsExposed: number;
  entitiesRepaired: number;
  creditsGranted: number;
  unitsShifted: number;
}

/** Seconds -> whole ticks, rounded up so a charge is never SHORTER than stated. */
function toTicks(seconds: number): number {
  return Math.ceil(seconds * SIM_HZ);
}

/* ==========================================================================
 * 2. THE SERVICE
 * ========================================================================== */

export class CommanderPowerService {
  readonly stats: CommanderPowerStats = {
    fired: new Int32Array(COMMANDER_POWERS.length),
    refusedCharging: 0,
    refusedUnowned: 0,
    unitsBombed: 0,
    assetsExposed: 0,
    entitiesRepaired: 0,
    creditsGranted: 0,
    unitsShifted: 0,
  };

  /**
   * Ticks of charge remaining, `[player * POWER_COUNT + power]`. 0 means ready.
   *
   * A flat Int32Array rather than a Map keyed on anything, because it is walked
   * in full once per tick and the whole thing is 8 x 6 x 4 bytes. Seeded to a
   * FULL charge at construction: "callable once charged" means the first call
   * of a match waits, exactly as a superweapon does.
   */
  private readonly charge = new Int32Array(MAX_PLAYERS * COMMANDER_POWERS.length);

  /** Query scratch. Sized to the store's capacity by the world it is given. */
  private readonly scratch: Int32Array;

  constructor(
    readonly world: World,
    private readonly channels: Channels,
  ) {
    this.scratch = new Int32Array(world.store.capacity);
    this.resetCharges();
  }

  /** Put every power back to a full charge. Called at construction. */
  resetCharges(): void {
    for (let p = 0; p < MAX_PLAYERS; p++) {
      for (let k = 1; k < COMMANDER_POWERS.length; k++) {
        this.charge[p * COMMANDER_POWERS.length + k] = toTicks(COMMANDER_POWERS[k].chargeSeconds);
      }
    }
  }

  /* ======================================================================
   * 2a. PUBLIC READS — what a HUD button asks
   * ====================================================================== */

  /** Seconds of charge left for one player's power. 0 when ready. */
  chargeSecondsOf(player: PlayerId, power: number): number {
    const slot = this.slotOf(player, power);
    if (slot < 0) return 0;
    const ticks = this.charge[slot];
    return ticks <= 0 ? 0 : ticks / SIM_HZ;
  }

  /**
   * True when this player may call this power right now — BOUGHT and charged.
   *
   * Both halves, because both halves are what `use()` enforces and a HUD button
   * that lit up for a power the simulation would refuse is the bug this whole
   * arrangement exists to make impossible. The AI asks the same question.
   */
  isReady(player: PlayerId, power: number): boolean {
    const slot = this.slotOf(player, power);
    if (slot < 0 || this.charge[slot] > 0) return false;
    const p = this.world.players[player as number];
    return p !== undefined && ownsCommanderPower(p, power);
  }

  /** Has this player bought this power in this match? */
  owns(player: PlayerId, power: number): boolean {
    const p = this.world.players[player as number];
    return p !== undefined && ownsCommanderPower(p, power);
  }

  /* ======================================================================
   * 2a-bis. THE SAVE PORT — charges in TICKS, which is what they are
   *
   * `src/game/SaveGame.ts` reads and writes the charge table through these two,
   * structurally, the way it reaches `SuperweaponService.states/grantReady`. It
   * never imports this module, and this module never learns that saving exists.
   *
   * TICKS, NOT SECONDS, and that is the whole reason `chargeSecondsOf` is not
   * the port. The table IS integer ticks (see the field, and the determinism
   * note in the header), so seconds are a lossy view of it: `chargeStates` ->
   * JSON -> `setChargeTicks` in ticks is exact by construction, where a
   * seconds round-trip has to be rounded back and the rounding rule becomes a
   * thing to get wrong. It is also the unit the file already keeps time in —
   * `tick` and `spawnTick` are both raw ticks.
   * ====================================================================== */

  /**
   * Every real power's charge for one player, in ticks. Table order.
   *
   * `out` is caller-supplied so a capture allocates nothing it does not have
   * to; omit it and you get a fresh array, which is what the one caller wants.
   */
  chargeStates(player: PlayerId, out?: CommanderPowerCharge[]): CommanderPowerCharge[] {
    const dst = out ?? [];
    dst.length = 0;
    for (let k = 1; k < COMMANDER_POWERS.length; k++) {
      const slot = this.slotOf(player, k);
      if (slot < 0) continue;
      dst.push({ key: COMMANDER_POWERS[k].key, ticks: Math.max(0, this.charge[slot]) });
    }
    return dst;
  }

  /**
   * Put one power's charge back to `ticks`. False when the key or the player is
   * not one this build has.
   *
   * An unknown key is DROPPED rather than guessed at: a save written by a build
   * with a sixth power, loaded here, must leave the five this build has alone
   * rather than land a stranger's countdown on one of them.
   */
  setChargeTicks(player: PlayerId, key: string, ticks: number): boolean {
    if (!Number.isFinite(ticks)) return false;
    for (let k = 1; k < COMMANDER_POWERS.length; k++) {
      if (COMMANDER_POWERS[k].key !== key) continue;
      const slot = this.slotOf(player, k);
      if (slot < 0) return false;
      // Clamped to this build's charge, not the file's: a save from a build
      // whose Chronoshift cost 400 s must not hold this one hostage for longer
      // than its own table says it can be.
      const full = toTicks(COMMANDER_POWERS[k].chargeSeconds);
      this.charge[slot] = Math.min(full, Math.max(0, Math.floor(ticks)));
      return true;
    }
    return false;
  }

  /* ======================================================================
   * 2b. THE TICK
   * ====================================================================== */

  tick(_s: SimContext): void {
    const c = this.charge;
    for (let i = 0; i < c.length; i++) if (c[i] > 0) c[i]--;
  }

  /* ======================================================================
   * 2c. THE ONE ENTRY POINT
   * ====================================================================== */

  /**
   * Call `power` for `player`, aimed at `(x, z)`.
   *
   * The only way in. `src/input/Commands.ts` reaches it through the seam at the
   * bottom of this file when it drains a `CommandKind.UsePower`, so the human
   * and the AI travel the identical path and a replay reproduces both.
   */
  use(player: PlayerId, power: number, x: number, z: number): PowerResult {
    if (!isCommanderPowerId(power)) return 'unknown';
    const slot = this.slotOf(player, power);
    if (slot < 0) return 'noPlayer';
    // THE PURCHASE, AND THE SIMULATION IS ALLOWED TO ASK. `commanderPowerMask`
    // is written by `ProductionService.installPower` inside `simTick` off a
    // command that crossed the bus, so both clients answer this identically on
    // the same tick — which is the whole reason the header stopped being an
    // argument for NOT asking. Before the charge, because "you never bought it"
    // is final and "still charging" is not.
    const p = this.world.players[player as number];
    if (p === undefined || !ownsCommanderPower(p, power)) {
      this.stats.refusedUnowned++;
      return 'notOwned';
    }
    if (this.charge[slot] > 0) { this.stats.refusedCharging++; return 'charging'; }

    const spec = COMMANDER_POWERS[power];
    const px = clampWorld(x, 2);
    const pz = clampWorld(z, 2);

    let landed: boolean;
    switch (power) {
      case CommanderPowerId.Airstrike: landed = this.applyAirstrike(player, px, pz, spec.radius); break;
      case CommanderPowerId.OrbitalScan: landed = this.applyOrbitalScan(player, px, pz, spec.radius); break;
      case CommanderPowerId.EmergencyRepair: landed = this.applyRepair(player, px, pz, spec.radius); break;
      case CommanderPowerId.OreBoost: landed = this.applyOreBoost(player, px, pz); break;
      case CommanderPowerId.Chronoshift: landed = this.applyChronoshift(player, px, pz); break;
      default: return 'unknown';
    }

    // THE CHARGE IS SPENT EITHER WAY. A power that refunded itself when it
    // caught nothing would be a free map probe: call it, watch the result, and
    // learn whether anything was standing there. It also has to be spent
    // identically on every machine, and "was anything in the circle" is exactly
    // the kind of answer that differs by one entity between two clients that
    // have not yet resolved the same tick.
    this.charge[slot] = toTicks(spec.chargeSeconds);
    this.stats.fired[power]++;
    return landed ? 'fired' : 'noTargets';
  }

  /* ======================================================================
   * 2d. THE FIVE EFFECTS
   * ====================================================================== */

  /**
   * AIRSTRIKE — one bombing run on the marker.
   *
   * Goes through the damage channel rather than writing hp, for the reason
   * `applyPrismFocus` gives: it is ordinary damage, so armour class applies, the
   * bounty pays out, and a unit already at 1 hp dies to it the way it dies to a
   * rifle. ONE splash record, not one per victim — `Damage.ts` already resolves
   * falloff across everything in the radius.
   *
   * `attacker` is an entity the CALLER owns rather than `NONE`, and that is not
   * cosmetic: `Damage.ts` reads the killer's player off the attacker slot and
   * writes `killerPlayer = victim.player` when there is no attacker, so a strike
   * credited to nobody pays no bounty, scores no kill, and advances no mission.
   * It also means the strike friendly-fires your own units in the blast, which
   * is correct for a bombing run and is what makes aiming it a decision.
   */
  private applyAirstrike(owner: PlayerId, x: number, z: number, radius: number): boolean {
    const w = this.world;
    const st = w.store;
    const y = w.terrain.heightAt(x, z);
    const attacker = this.anchorOf(owner);

    this.channels.damage.push(
      NONE, attacker, COMMANDER_POWER_FX.airstrikeDamage, WarheadClass.HighExplosive,
      x, y + 1.5, z, radius, COMMANDER_POWER_FX.airstrikeFalloff,
    );

    // Counted for the stats line only. The damage itself is the channel's job
    // and this loop must not duplicate it.
    let caught = 0;
    const n = w.spatial.queryCircleFat(x, z, radius, this.scratch);
    for (let k = 0; k < n; k++) {
      const e = this.scratch[k];
      const f = st.flags[e];
      if ((f & EntityFlag.Alive) === 0) continue;
      if ((f & EntityFlag.PendingDestroy) !== 0) continue;
      if (w.areAllied(owner, st.owner[e] as PlayerId)) continue;
      caught++;
    }
    this.stats.unitsBombed += caught;

    this.channels.fx.push(FxKind.ExplosionLarge, x, y + 2, z, 0, 1, 0, 3.0, NONE, Faction.Neutral);
    this.channels.fx.push(FxKind.SmokePlumeLarge, x, y + 3, z, 0, 1, 0, 2.4, NONE, Faction.Neutral);
    w.vfx.decal(DecalKind.Crater, x, z, 0, radius * 0.6);
    w.vfx.shake(0.35);
    return caught > 0;
  }

  /**
   * ORBITAL SCAN — exposes every hostile unit and structure for a few seconds.
   *
   * IT USED TO CHART A CIRCLE, AND THAT IS WHY IT FELT DEAD. `exploreCircle`
   * sets VIS_EXPLORED — permanent terrain memory, and nothing about units. So
   * the first cast over a patch of map told you what was built there, and every
   * later cast over the same patch did NOTHING AT ALL, because the bit was
   * already set. Reported as "orbital scan feels useless after 1 scan". It was
   * not a feeling; a repeat cast was a genuine no-op.
   *
   * The old comment argued this was "the honest version of a scan … the one
   * reveal primitive that cannot leak live information into targeting". That
   * concern is real and it is now a deliberate trade rather than an accident:
   * the sweep DOES hand live positions to the caster, which is the whole point
   * of a five-second window, and the window is what keeps it from being a
   * permanent targeting aid. `Vision.sweepEnemies` carries the rest.
   *
   * `x`/`z` no longer bound the effect — the sweep is global over hostile
   * assets. The point is kept because it is where the beam plays, so the cast
   * still has a place on the field rather than being a HUD-only event.
   *
   * Reached through a structural probe rather than `IVision`, which does not
   * carry the manual reveals. The same duck-typed seam idiom as `abilitySeam()`
   * and `readProgression()`, and it degrades the way they do: a boot with no
   * vision service (the `?shot=` harness runs one, a headless test may not)
   * sweeps nothing rather than throwing.
   */
  private applyOrbitalScan(owner: PlayerId, x: number, z: number, radius: number): boolean {
    const w = this.world;
    const v = w.vision as Partial<ExploreCapable>;
    const y = w.terrain.heightAt(x, z);

    this.channels.fx.push(FxKind.PrismBeam, x, y + 40, z, 0, -1, 0, 4.0, NONE, Faction.Meridian);

    if (typeof v.sweepEnemies !== 'function') return false;
    v.sweepEnemies(owner, ORBITAL_SCAN_SECONDS, radius);

    // Counted here rather than read back out of the grid, for the reason the
    // old cell count gave: the grid belongs to the vision module and nothing
    // here may read it. Assets, not cells — the sweep is sized by how much the
    // enemy owns, not by how much dirt it covered.
    const st = w.store;
    let assets = 0;
    for (let k = 0; k < ANCHOR_KINDS.length; k++) {
      const list = st.byKind[ANCHOR_KINDS[k]];
      const cnt = st.byKindCount[ANCHOR_KINDS[k]];
      for (let j = 0; j < cnt; j++) {
        const i = list[j];
        if ((st.flags[i] & EntityFlag.PendingDestroy) !== 0) continue;
        if (w.areAllied(owner, st.owner[i] as PlayerId)) continue;
        if (w.players[st.owner[i]]?.faction === Faction.Neutral) continue;
        assets++;
      }
    }
    this.stats.assetsExposed += assets;
    return assets > 0;
  }

  /**
   * EMERGENCY REPAIR — patches your units AND your structures under the marker.
   *
   * Structures included deliberately: this is the only mend in the game that
   * reaches a building without the drip-cost repair toggle and without an
   * engineer walking there, and a base under a siege line is exactly the moment
   * it is for. Capped at `repairMaxTargets` so one call on a packed base is not
   * a full heal of everything the player owns.
   *
   * Writes `hp` directly, which the write-ownership table assigns to Damage.
   * That is not a violation invented here: `AbilityService.applySalvageCall`
   * and `SuperweaponService.applyCurtain` do the same from Command and
   * Production respectively, and this file is modelled on them so there is ONE
   * way an area effect mutates the field.
   */
  private applyRepair(owner: PlayerId, x: number, z: number, radius: number): boolean {
    const w = this.world;
    const st = w.store;
    const n = w.spatial.queryCircleFat(x, z, radius, this.scratch);

    let mended = 0;
    for (let k = 0; k < n && mended < COMMANDER_POWER_FX.repairMaxTargets; k++) {
      const e = this.scratch[k];
      const f = st.flags[e];
      if ((f & EntityFlag.Alive) === 0) continue;
      if ((f & (EntityFlag.PendingDestroy | EntityFlag.UnderConstruction)) !== 0) continue;
      const kind = st.kind[e];
      if (kind !== EntityKind.Infantry && kind !== EntityKind.Vehicle && kind !== EntityKind.Building) {
        continue;
      }
      if (!w.areAllied(owner, st.owner[e] as PlayerId)) continue;
      const max = st.maxHp[e];
      if (max <= 0 || st.hp[e] >= max) continue;

      st.hp[e] = Math.min(max, st.hp[e] + max * COMMANDER_POWER_FX.repairFraction);
      mended++;
      this.channels.fx.push(
        FxKind.RepairSpark, st.posX[e], st.posY[e] + 1.4, st.posZ[e],
        0, 1, 0, 1.1, st.handleOf(e), st.faction[e] as Faction,
      );
    }

    this.stats.entitiesRepaired += mended;
    const y = w.terrain.heightAt(x, z);
    this.channels.fx.push(FxKind.RepairSpark, x, y + 2, z, 0, 1, 0, 2.2, NONE, Faction.Allies);
    return mended > 0;
  }

  /**
   * ORE BOOST — cash, immediately.
   *
   * The one power with no position; `(x, z)` is accepted and ignored so that
   * every power has the identical command shape and the caller never has to
   * know which ones aim. Paid as a Bounty rather than a Harvest: it is not ore,
   * and it must not inflate the mining figure the results screen prints or the
   * "mine N credits" missions, both of which key on `CreditReason.Harvest`.
   */
  private applyOreBoost(owner: PlayerId, x: number, z: number): boolean {
    const economy = getEconomy();
    if (economy === null) return false;
    const amount = COMMANDER_POWER_FX.oreBoostCredits;
    economy.grant(owner, amount, CreditReason.Bounty);
    this.stats.creditsGranted += amount;

    const w = this.world;
    const y = w.terrain.heightAt(x, z);
    this.channels.fx.push(FxKind.OreSparkle, x, y + 1.5, z, 0, 1, 0, 2.0, NONE, Faction.Reclaim);
    return true;
  }

  /**
   * CHRONOSHIFT — lifts the units standing around your base to the marker.
   *
   * A one-click chronosphere. The Chronosphere proper takes a source AND a
   * destination and needs a reticle, a staged-target state machine and a second
   * click that can be misread as a move order; this takes the destination only
   * and derives the source, so it fires from the same one-click command every
   * other power uses.
   *
   * THE SOURCE IS THE CENTROID OF YOUR OWN LIVING BUILDINGS, which is a
   * deterministic function of the store — no seed, no clock, no profile — and is
   * the definition of "home" that survives losing any particular structure. A
   * player with no buildings has no home to lift from and the call catches
   * nothing.
   *
   * `prev*` is written alongside `pos*` for the reason `applyChronoRally` gives:
   * without it the renderer interpolates the unit ACROSS the map for one frame
   * and draws a streak through everything in between.
   */
  private applyChronoshift(owner: PlayerId, x: number, z: number): boolean {
    const w = this.world;
    const st = w.store;
    const y = w.terrain.heightAt(x, z);

    this.channels.fx.push(FxKind.PrismBeam, x, y + 9, z, 0, -1, 0, 3.0, NONE, Faction.Allies);

    if (!this.baseCentroid(owner, CENTROID)) return false;
    const n = w.spatial.queryCircleFat(
      CENTROID[0], CENTROID[1], COMMANDER_POWER_FX.chronoshiftPickupRadius, this.scratch,
    );

    let moved = 0;
    for (let k = 0; k < n && moved < COMMANDER_POWER_FX.chronoshiftMaxUnits; k++) {
      const e = this.scratch[k];
      if (!this.isFriendlyMover(e, owner)) continue;

      const ring = Math.floor(moved / 6);
      const slotIdx = moved % 6;
      const ang = (slotIdx / 6) * Math.PI * 2 + ring * 0.5;
      const r = (ring + 1) * COMMANDER_POWER_FX.chronoshiftSpacing;
      const nx = clampWorld(x + Math.sin(ang) * r, 2);
      const nz = clampWorld(z + Math.cos(ang) * r, 2);

      // THE DESTINATION MUST BE GROUND THIS UNIT CAN STAND ON.
      //
      // `clampWorld` bounds the point to the MAP, not to passable terrain, so
      // this used to teleport a tank into the sea and leave it there: position
      // written directly, `Idle`, no order, on a cell its own `MoveClass`
      // cannot traverse. `Flowfield` cannot pull a unit off an impassable cell,
      // so it never moves again, and `Shell.pollOutcome` counts it forever
      // through `countLivingAssets` — the same unwinnable match `Transport
      // .strand` produced by the other route, and the same class of bug: a
      // position written without asking whether the unit can be there.
      //
      // A refused unit is SKIPPED, not drowned. Chronoshift is a player-aimed
      // power and the right failure is "that one did not come with you" —
      // unlike `strand`, where the unit is already in the water and standing
      // still is not an option. `moved` is not incremented, so the next
      // candidate takes this slot and a bad aim costs placement, not an army.
      if (!this.canStandAt(e, nx, nz)) continue;

      this.channels.fx.push(
        FxKind.PrismBeam, st.posX[e], st.posY[e] + 2, st.posZ[e],
        0, 1, 0, 1.2, st.handleOf(e), st.faction[e] as Faction,
      );

      st.posX[e] = nx;
      st.posZ[e] = nz;
      st.posY[e] = w.terrain.heightAt(nx, nz);
      st.prevX[e] = nx;
      st.prevZ[e] = nz;
      st.prevY[e] = st.posY[e];
      st.velX[e] = 0; st.velZ[e] = 0; st.speed[e] = 0;
      st.cellX[e] = Math.floor(nx / CELL);
      st.cellZ[e] = Math.floor(nz / CELL);
      st.orderKind[e] = OrderKind.None;
      st.orderTarget[e] = 0;
      st.orderX[e] = nx;
      st.orderZ[e] = nz;
      st.guardX[e] = nx;
      st.guardZ[e] = nz;
      st.state[e] = UnitState.Idle;

      this.channels.fx.push(
        FxKind.PrismBeam, nx, st.posY[e] + 2, nz,
        0, 1, 0, 1.2, st.handleOf(e), st.faction[e] as Faction,
      );
      moved++;
    }

    this.stats.unitsShifted += moved;
    if (moved > 0) w.vfx.shake(0.2);
    return moved > 0;
  }

  /* ======================================================================
   * 2e. HELPERS
   * ====================================================================== */

  /** Flat index into `charge`, or -1 when either half is out of range. */
  private slotOf(player: PlayerId, power: number): number {
    const p = player as number;
    if (!Number.isInteger(p) || p < 0 || p >= MAX_PLAYERS) return -1;
    if (!isCommanderPowerId(power)) return -1;
    return p * COMMANDER_POWERS.length + power;
  }

  /**
   * An entity `owner` owns, to credit an area effect to. Buildings first — a
   * construction yard outlives the army that called the strike — then anything
   * mobile. `NONE` when the player owns nothing, which is a player who has
   * already lost.
   */
  private anchorOf(owner: PlayerId): EntityId {
    const st = this.world.store;
    for (let k = 0; k < ANCHOR_KINDS.length; k++) {
      const list = st.byKind[ANCHOR_KINDS[k]];
      const n = st.byKindCount[ANCHOR_KINDS[k]];
      for (let j = 0; j < n; j++) {
        const i = list[j];
        if (st.owner[i] !== (owner as number)) continue;
        const f = st.flags[i];
        if ((f & EntityFlag.Alive) === 0) continue;
        if ((f & EntityFlag.PendingDestroy) !== 0) continue;
        return st.handleOf(i);
      }
    }
    return NONE;
  }

  /** Centroid of `owner`'s living buildings into `out`. False when there are none. */
  private baseCentroid(owner: PlayerId, out: Float64Array): boolean {
    const st = this.world.store;
    const list = st.byKind[EntityKind.Building];
    const n = st.byKindCount[EntityKind.Building];
    let sx = 0;
    let sz = 0;
    let count = 0;
    for (let j = 0; j < n; j++) {
      const i = list[j];
      if (st.owner[i] !== (owner as number)) continue;
      const f = st.flags[i];
      if ((f & EntityFlag.Alive) === 0) continue;
      if ((f & EntityFlag.PendingDestroy) !== 0) continue;
      sx += st.posX[i];
      sz += st.posZ[i];
      count++;
    }
    if (count === 0) return false;
    out[0] = sx / count;
    out[1] = sz / count;
    return true;
  }

  /**
   * Can entity `e` stand at this world point?
   *
   * Resolved through the unit's OWN move class, exactly as `Transport.place`
   * does, so a hovercraft and an amphibious swimmer are judged by what they can
   * actually cross rather than by a hardcoded foot rule. Occupancy is NOT
   * tested: Chronoshift lands a formation on a spacing ring and the units are
   * allowed to settle against each other, which `Movement.relax` resolves in a
   * few ticks. Passability is the part that is permanent.
   */
  private canStandAt(e: number, x: number, z: number): boolean {
    const cx = worldToCell(x);
    const cz = worldToCell(z);
    if (!isInMap(cx, cz)) return false;
    const loco = locomotorForMoveClass(moveClassAt(this.world.store, e));
    return this.world.terrain.isPassable(cx, cz, loco);
  }

  /** An allied, living, mobile unit — the set Chronoshift lifts. */
  private isFriendlyMover(e: number, owner: PlayerId): boolean {
    const st = this.world.store;
    const f = st.flags[e];
    if ((f & EntityFlag.Alive) === 0) return false;
    if ((f & (EntityFlag.PendingDestroy | EntityFlag.Garrisoned | EntityFlag.UnderConstruction)) !== 0) {
      return false;
    }
    const kind = st.kind[e];
    if (kind !== EntityKind.Infantry && kind !== EntityKind.Vehicle) return false;
    return this.world.areAllied(owner, st.owner[e] as PlayerId);
  }

  dispose(): void {
    this.resetCharges();
  }
}

/** What `applyOrbitalScan` needs of the vision service, and nothing more. */
interface ExploreCapable {
  exploreCircle(player: PlayerId, x: number, z: number, r: number): void;
  /** See `Vision.sweepEnemies`. Optional so a stub vision still boots. */
  sweepEnemies(player: PlayerId, seconds: number, radius: number): void;
}

/**
 * How long an Orbital Scan holds the enemy lit, in seconds.
 *
 * Lives here rather than in `core/config.ts` because it is the power's own
 * behaviour and not an art or balance table knob, and beside `chargeSeconds`
 * in `progression/powers.ts` it would read as a cooldown. Five seconds is long
 * enough to read a base layout and a convoy heading and short enough that it
 * cannot be leaned on as a permanent targeting aid — which is the trade
 * `applyOrbitalScan` documents.
 */
const ORBITAL_SCAN_SECONDS = 5;

/** Kinds an area effect may be credited to, in preference order. */
const ANCHOR_KINDS: readonly EntityKind[] = [
  EntityKind.Building, EntityKind.Vehicle, EntityKind.Infantry,
];

/** Chronoshift pickup point. Module scope: one per process, never per call. */
const CENTROID = new Float64Array(2);

/* ==========================================================================
 * 3. THE SEAM AND THE SINGLETON
 *
 * Two handles, deliberately, and they are not the same thing:
 *
 *   `commanderPowerSeamOf()` is the narrow one `src/input/Commands.ts` calls
 *     from inside the ONE Phase.Command drain. It sees `use` and nothing else,
 *     and it is null on a boot with no power system, so the drainer's branch is
 *     a no-op rather than a throw. Same shape as `relocateSeamOf()`.
 *
 *   `commanderPowers()` is the full service, for the HUD, the console handle
 *     and tests. Same shape as `production()` / `abilities()`.
 * ========================================================================== */

/** The one call `src/input/Commands.ts` makes. Kept narrow on purpose. */
export interface CommanderPowerSeam {
  use(player: PlayerId, power: number, x: number, z: number): PowerResult;
}

let seam: CommanderPowerSeam | null = null;
let active: CommanderPowerService | null = null;

export function setCommanderPowerSeam(next: CommanderPowerSeam | null): void {
  seam = next;
}

export function commanderPowerSeamOf(): CommanderPowerSeam | null {
  return seam;
}

export function setCommanderPowerService(next: CommanderPowerService | null): void {
  active = next;
}

export function commanderPowers(): CommanderPowerService | null {
  return active;
}
