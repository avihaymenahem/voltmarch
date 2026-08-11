/**
 * ============================================================================
 * VOLTMARCH — src/sim/CommanderPowers.ts
 * ============================================================================
 * The five commander powers the mission table pays out.
 *
 * These are PLAYER-level support powers: no unit carries them, they charge from
 * the start of the match, and they land on a point the caller names. That is a
 * different mechanism from `src/sim/Abilities.ts` — the four faction abilities
 * are self-centred on a hero and are keyed to `UnitDef.ability` — and
 * `src/progression/powers.ts` explains why the two are not one thing.
 *
 *
 * WHY IT EXISTS AT ALL: FIVE REWARDS THAT GRANTED NOTHING
 * -------------------------------------------------------
 * `power.airstrike`, `power.orbital-scan`, `power.emergency-repair`,
 * `power.ore-boost` and `power.chronoshift` were paid out by five missions,
 * written onto the profile by `MissionTracker`, printed on the end screen as
 * "Commander Power — <name> — Callable once charged, in any match", and read by
 * NOTHING. `UnlockGate` only ever answers about a def carrying `unlockedBy`,
 * and `UNLOCK_TAGS` in `src/data/Defs.ts` has no `power.*` row, so the five ids
 * sat in `profile.unlocked` where no question was ever asked of them. This file
 * is the answer to that question.
 *
 *
 * THE SIMULATION NEVER ASKS WHETHER YOU OWN THE POWER — READ THIS BEFORE
 * "TIGHTENING" ANYTHING
 * ----------------------------------------------------------------------
 * `use()` checks the CHARGE and nothing else. It does not consult
 * `UnlockGate`, `isBuildable`, `__vmProgression`, or any other view of the
 * profile, and it must never learn how.
 *
 * The profile is per-browser localStorage. `src/game/Scenarios.ts` already
 * consults the unlock gate while BUILDING the world, so a veteran and a fresh
 * account produce different starting armies from the same seed and desync on
 * tick zero — which is why PvP has to call `suppressUnlockGate(true)` and lift
 * gating entirely. A power that the simulation REFUSED on profile grounds would
 * be strictly worse than that: the refusal happens mid-match, on one machine
 * only, and the two simulations part company at the exact tick one player
 * pressed a button. There is no checksum that catches it earlier and no way to
 * explain it afterwards.
 *
 * So ownership is resolved exactly once, on the machine that ISSUES the
 * command, by the UI that draws the button — the same place a locked cameo is
 * greyed out. What that means per configuration:
 *
 *   Single player   the HUD offers the powers this profile has earned. The AI
 *                   resolves against the same profile (`UnlockGate.mirrorAI`),
 *                   so it fields what you field.
 *   PvP             `suppressUnlockGate(true)` is already set for the match, so
 *                   every client offers all five to everybody. Both sides have
 *                   the same menu, the command stream is identical, and there
 *                   is nothing for the profile to make asymmetric.
 *   Replay          the command stream is the recording. Ownership never enters
 *                   into it, so a replay plays back on an empty profile.
 *
 * A client hacked to issue a power it has not earned therefore gains nothing in
 * PvP (everyone already has all five) and cheats only itself in single player,
 * which is where `?unlockall` already lives.
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
 *      `AiDifficulty.powerMask` (v2.3.0).
 *   3. CHARGES ARE IN THE SAVE, through `chargeStates`/`setChargeTicks` below.
 *
 * ON (3), BECAUSE THE BOUNDARY IS THE INTERESTING PART. Two different things
 * were being conflated:
 *
 *   OWNERSHIP is PROFILE state. `power.airstrike` lives in `profile.unlocked`,
 *     `src/progression/profile-store.ts` persists it, and it must NEVER enter a
 *     save file: a save that carried unlocks would be a way to hand a fresh
 *     account content it had not earned, and the same file would then describe
 *     a different game on two profiles.
 *   CHARGE is per-MATCH SIMULATION state. It is seeded full at match start —
 *     that is correct and unchanged — but a LOAD is not a match start. It is
 *     the resumption of one match, and `SaveGame.ts`'s whole thesis is that a
 *     snapshot "restores the numbers that were there".
 *
 * The old note called the omission "the safe direction to be wrong in — you
 * never load into a free strike". That was only half the ledger. `Shell.loadGame`
 * boots a fresh engine before restoring, so a load ran `resetCharges()` over
 * EVERY SLOT, the AI's included: reloading during a hard fight put the enemy
 * brain's Emergency Repair and Airstrike back to 150 s of charge, every time.
 * Save-scumming a fight disarmed the opponent's entire late-game layer, which is
 * not a safe direction to be wrong in at all.
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
import { clampWorld } from '../core/math';
import type { World } from '../core/world';
import {
  COMMANDER_POWERS, COMMANDER_POWER_FX, CommanderPowerId, isCommanderPowerId,
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
  unitsBombed: number;
  cellsCharted: number;
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
    unitsBombed: 0,
    cellsCharted: 0,
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

  /** True when this player may call this power right now. */
  isReady(player: PlayerId, power: number): boolean {
    const slot = this.slotOf(player, power);
    return slot >= 0 && this.charge[slot] <= 0;
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
   * ORBITAL SCAN — charts a wide circle permanently.
   *
   * `exploreCircle` marks the cells EXPLORED and not visible: terrain and static
   * objects are remembered, live units are not handed over. That is the honest
   * version of a scan — it tells you what is built there, not where the tanks
   * are standing this second — and it is the one reveal primitive that cannot
   * leak live information into targeting.
   *
   * Reached through a structural probe rather than `IVision`, which does not
   * carry the manual reveals. The same duck-typed seam idiom as `abilitySeam()`
   * and `readProgression()`, and it degrades the way they do: a boot with no
   * vision service (the `?shot=` harness runs one, a headless test may not)
   * charts nothing rather than throwing.
   */
  private applyOrbitalScan(owner: PlayerId, x: number, z: number, radius: number): boolean {
    const w = this.world;
    const v = w.vision as Partial<ExploreCapable>;
    const y = w.terrain.heightAt(x, z);

    this.channels.fx.push(FxKind.PrismBeam, x, y + 40, z, 0, -1, 0, 4.0, NONE, Faction.Meridian);

    if (typeof v.exploreCircle !== 'function') return false;
    v.exploreCircle(owner, x, z, radius);
    // Cells inside the circle, in whole cells. A count rather than a re-walk of
    // the grid: the grid is the vision module's and nothing here may read it.
    const cells = Math.round((Math.PI * radius * radius) / (CELL * CELL));
    this.stats.cellsCharted += cells;
    return cells > 0;
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
}

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
