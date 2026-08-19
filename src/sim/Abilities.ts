/**
 * ============================================================================
 * VOLTMARCH — src/sim/Abilities.ts
 * ============================================================================
 * The four commander abilities.
 *
 * One hero per army, capped at one alive by `UnitDef.maxAlive` (enforced in
 * `Production.availabilityOf`, not here), each carrying one active ability on
 * a cooldown. This file owns the cooldowns and the effects; nothing else does.
 *
 *
 * EVERY ABILITY IS SELF-CENTRED, AND THAT IS THE DESIGN
 * -----------------------------------------------------
 * None of the four takes a target. `OrderKind.UseAbility` carries no point and
 * no entity — the effect always lands on a circle around the commander. Three
 * things fall out of that, and all three are why it was chosen:
 *
 *   1. One HUD button fires any of them. No reticle, no staged-target state
 *      machine, no fifth `ArmedMode`, no second click that can be misread as a
 *      move order. `Superweapons.ts` needs all of that and is 970 lines; this
 *      is a third of it.
 *   2. The AI issues the identical command the player does — a bare Order on
 *      the commander — so the "AI never reaches into entity state" rule costs
 *      nothing to keep here.
 *   3. Positioning becomes the skill. Where you walk the commander IS the aim.
 *
 * The armies are separated by WHAT lands, not by how it is aimed.
 *
 *
 * WHY THE COOLDOWN IS IN TICKS AND NOT SECONDS
 * ---------------------------------------------
 * `world.time` is a float that accumulates `dt` and therefore drifts by a
 * different amount on every machine. A cooldown compared against it is a
 * cross-machine divergence waiting for `#57`'s replay work to expose it. The
 * counters here are integer ticks, decremented once per `simTick`, and the
 * HUD divides by `TICKS_PER_SECOND` only when it prints them.
 *
 *
 * PHASE.COMMAND, ORDER 9600
 * --------------------------
 * `orderKind` is a Command-owned column (see the write-ownership table at the
 * top of `core/loop.ts`), and this module CONSUMES an order, so it has to run
 * in Command. 9600 puts it behind `input/Commands.ts`'s fallback executor
 * (9000) and behind `sim/deploy.system.ts` (9500), which means an ability
 * pressed this tick fires this tick rather than next — the same reasoning, and
 * the same 500-slot spacing, that deploy already uses.
 *
 * The effects themselves write `posX`/`hp`/`maxHp`, which the ownership table
 * assigns to Movement and Damage. That is not a violation invented here:
 * `SuperweaponService.applyChrono` and `.applyCurtain` do exactly the same
 * from Phase.Production, and this file is deliberately modelled on them so
 * there is ONE way an area effect mutates the field, not two.
 * ============================================================================
 */

import { ABILITIES, ABILITY_FX, AbilityId, CELL, MAX_PLAYERS, SIM_HZ } from '../core/config';
import {
  DecalKind, EntityFlag, EntityKind, Faction, FxKind, NONE, OrderKind, UnitState, WarheadClass,
} from '../core/types';
import type { Channels } from '../core/events';
import type { EntityId, PlayerId, SimContext, UnitDef } from '../core/types';
import { clampWorld } from '../core/math';
import type { World } from '../core/world';
import { PerEntityI16 } from '../core/world';
import { getEconomy } from './Economy';
import { CreditReason } from '../core/types';

/* ==========================================================================
 * 1. STATE
 * ========================================================================== */

/**
 * Units one Iron Will can hold protected at once, across all players.
 *
 * 48 is six full squads. The Ironclad Field's own table is 64 for a 20-second
 * effect with a 300-second charge; this is a 5-second effect on a 60-second
 * cooldown, so the standing population is far smaller and the extra slots
 * would only ever be zeroes to walk.
 */
const PROTECT_CAPACITY = 48;

/** Sentinel maxHp given to a protected unit. Nothing in the game reaches it. */
const PROTECTED_HP = 1e7;

/** Seconds -> whole ticks, rounded up so a cooldown is never SHORTER than stated. */
function toTicks(seconds: number): number {
  return Math.ceil(seconds * SIM_HZ);
}

export interface AbilityStats {
  /** Uses that actually fired, per AbilityId. */
  fired: Int32Array;
  /** Uses refused because the ability was still cooling. */
  refusedCooling: number;
  /** Uses refused because the unit has no ability at all. */
  refusedNoAbility: number;
  unitsRecalled: number;
  unitsProtected: number;
  unitsBurned: number;
  wrecksSalvaged: number;
  creditsSalvaged: number;
}

/**
 * One commander's cooldown, in TICKS, keyed by entity.
 *
 * `PerEntityI16` is generation-stamped, so a recycled slot reads 0 rather than
 * the dead commander's remaining cooldown — which is exactly the failure the
 * hero mechanic invites, since the whole point is that you build another one
 * the moment the first dies, and it lands in a freshly recycled slot.
 *
 * Int16 tops out at 32767 ticks — 18 minutes at 30 Hz — against a longest
 * authored cooldown of 60 seconds. There is no overflow path.
 */
type CooldownStore = PerEntityI16;

/* ==========================================================================
 * 2. THE SERVICE
 * ========================================================================== */

export class AbilityService {
  readonly stats: AbilityStats = {
    fired: new Int32Array(ABILITIES.length),
    refusedCooling: 0,
    refusedNoAbility: 0,
    unitsRecalled: 0,
    unitsProtected: 0,
    unitsBurned: 0,
    wrecksSalvaged: 0,
    creditsSalvaged: 0,
  };

  /** Ticks of cooldown left, per commander. 0 means ready. */
  private readonly cooldown: CooldownStore;

  /** Def table, bound once the content glob resolves. Null on a fallback boot. */
  private units: readonly UnitDef[] | null = null;

  /* -- Iron Will bookkeeping, a parallel-array set keyed by handle ---------- */
  private readonly protectedId = new Int32Array(PROTECT_CAPACITY);
  private readonly protectUntilTick = new Int32Array(PROTECT_CAPACITY);
  private readonly protectMaxHp = new Float32Array(PROTECT_CAPACITY);
  private readonly protectHp = new Float32Array(PROTECT_CAPACITY);
  private protectCount = 0;
  private sparkTicks = 0;

  /** Query scratch. Sized to the store's capacity by the world it is given. */
  private readonly scratch: Int32Array;

  /** Ticks elapsed. Integer, so nothing here ever compares against a float. */
  private tickCount = 0;

  constructor(
    readonly world: World,
    private readonly channels: Channels,
  ) {
    this.scratch = new Int32Array(world.store.capacity);
    this.cooldown = new PerEntityI16(world.store);
  }

  /** Hand over the real def table. Without it every unit reads as ability-less. */
  bindTables(units: readonly UnitDef[] | null): void {
    this.units = units;
  }

  /* ======================================================================
   * 2a. PUBLIC READS — what the HUD asks
   * ====================================================================== */

  /** The ability a unit carries, or `AbilityId.None`. */
  abilityOf(id: EntityId): AbilityId {
    const st = this.world.store;
    const i = st.index(id);
    if (i < 0) return AbilityId.None;
    if (st.kind[i] !== EntityKind.Infantry && st.kind[i] !== EntityKind.Vehicle) {
      return AbilityId.None;
    }
    const def = this.defOf(i);
    return (def?.ability ?? AbilityId.None) as AbilityId;
  }

  /** Seconds of cooldown left. 0 when ready. */
  cooldownSecondsOf(id: EntityId): number {
    const ticks = this.cooldown.get(id) ?? 0;
    return ticks <= 0 ? 0 : ticks / SIM_HZ;
  }

  /** True when this unit has an ability and it is off cooldown. */
  isReady(id: EntityId): boolean {
    if (this.abilityOf(id) === AbilityId.None) return false;
    return (this.cooldown.get(id) ?? 0) <= 0;
  }

  /* ======================================================================
   * 2b. THE TICK
   * ====================================================================== */

  tick(_s: SimContext): void {
    this.tickCount++;
    this.decayCooldowns();
    this.consumeOrders();
    this.protectionTick();
  }

  /**
   * Walk the two mobile kind lists and tick down anything still cooling.
   *
   * A full scan rather than a list of live commanders, because there are at
   * most four of them in a match and maintaining a second list would cost more
   * code than the scan costs cycles. `PerEntityI16.get` returns undefined for a
   * stale generation, which is the recycled-slot case handled for free.
   */
  private decayCooldowns(): void {
    const st = this.world.store;
    for (let k = 0; k < MOBILE_KINDS.length; k++) {
      const list = st.byKind[MOBILE_KINDS[k]];
      const n = st.byKindCount[MOBILE_KINDS[k]];
      for (let j = 0; j < n; j++) {
        const i = list[j];
        const id = st.handleOf(i);
        const left = this.cooldown.get(id) ?? 0;
        if (left > 0) this.cooldown.set(id, left - 1);
      }
    }
  }

  /**
   * Find and consume every `OrderKind.UseAbility` standing on the field.
   *
   * The order is cleared back to `None` whether or not the ability fired — a
   * refusal that left the order set would re-fire the instant the cooldown
   * expired, which is not what the player pressed.
   */
  private consumeOrders(): void {
    const st = this.world.store;
    for (let k = 0; k < MOBILE_KINDS.length; k++) {
      const list = st.byKind[MOBILE_KINDS[k]];
      const n = st.byKindCount[MOBILE_KINDS[k]];
      for (let j = 0; j < n; j++) {
        const i = list[j];
        if (st.orderKind[i] !== OrderKind.UseAbility) continue;
        st.orderKind[i] = OrderKind.None;
        st.orderX[i] = st.posX[i];
        st.orderZ[i] = st.posZ[i];
        if (st.state[i] === UnitState.Idle) st.state[i] = UnitState.Idle;
        this.fire(i);
      }
    }
  }

  /**
   * Fire the ability on slot `i`, if it has one and it is ready.
   *
   * Public so a test — and `__vmAbilities` in the console — can drive it
   * without staging an order first.
   */
  fireAt(id: EntityId): boolean {
    const i = this.world.store.index(id);
    return i < 0 ? false : this.fire(i);
  }

  private fire(i: number): boolean {
    const st = this.world.store;
    const flags = st.flags[i];
    if ((flags & EntityFlag.Alive) === 0) return false;
    if ((flags & (EntityFlag.PendingDestroy | EntityFlag.UnderConstruction)) !== 0) return false;

    const def = this.defOf(i);
    const ability = (def?.ability ?? AbilityId.None) as AbilityId;
    if (ability === AbilityId.None) { this.stats.refusedNoAbility++; return false; }

    const id = st.handleOf(i);
    if ((this.cooldown.get(id) ?? 0) > 0) { this.stats.refusedCooling++; return false; }

    const spec = ABILITIES[ability];
    const owner = st.owner[i] as PlayerId;
    const x = st.posX[i];
    const z = st.posZ[i];

    switch (ability) {
      case AbilityId.ChronoRally: this.applyChronoRally(owner, x, z, spec.radius); break;
      case AbilityId.IronWill: this.applyIronWill(owner, x, z, spec.radius); break;
      case AbilityId.PrismFocus: this.applyPrismFocus(owner, i, x, z, spec.radius); break;
      case AbilityId.SalvageCall: this.applySalvageCall(owner, x, z, spec.radius); break;
      default: return false;
    }

    this.cooldown.set(id, toTicks(spec.cooldownSeconds));
    this.stats.fired[ability]++;
    return true;
  }

  /* ======================================================================
   * 2c. THE FOUR EFFECTS
   * ====================================================================== */

  /**
   * ALLIES — Chrono Rally. Friendlies in radius blink to a ring around the
   * commander.
   *
   * The Displacement Ring's spiral, inverted: that one pushes a group somewhere,
   * this one PULLS a scattered group home. Same arrival spacing so nine units
   * do not land inside each other and spend two seconds shoving apart.
   */
  private applyChronoRally(owner: PlayerId, x: number, z: number, radius: number): void {
    const w = this.world;
    const st = w.store;
    const n = w.spatial.queryCircleFat(x, z, radius, this.scratch);
    let moved = 0;

    for (let k = 0; k < n && moved < ABILITY_FX.chronoMaxUnits; k++) {
      const e = this.scratch[k];
      if (!this.isFriendlyMover(e, owner)) continue;
      // The commander does not teleport to itself.
      if (st.posX[e] === x && st.posZ[e] === z) continue;

      const ring = Math.floor(moved / 6);
      const slot = moved % 6;
      const ang = (slot / 6) * Math.PI * 2 + ring * 0.5;
      const r = (ring + 1) * ABILITY_FX.chronoSpacing;
      const nx = clampWorld(x + Math.sin(ang) * r, 2);
      const nz = clampWorld(z + Math.cos(ang) * r, 2);

      this.channels.fx.push(
        FxKind.PrismBeam, st.posX[e], st.posY[e] + 2, st.posZ[e],
        0, 1, 0, 1.2, st.handleOf(e), st.faction[e] as Faction,
      );

      st.posX[e] = nx;
      st.posZ[e] = nz;
      st.posY[e] = w.terrain.heightAt(nx, nz);
      // prev* too, or the renderer interpolates the unit ACROSS the map for one
      // frame and draws a streak through everything between.
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

    this.stats.unitsRecalled += moved;
    const y = w.terrain.heightAt(x, z);
    this.channels.fx.push(FxKind.PrismBeam, x, y + 7, z, 0, -1, 0, 2.6, NONE, Faction.Allies);
    w.vfx.shake(0.18);
  }

  /**
   * SOVIETS — Iron Will. Friendlies in radius cannot be harmed for a few
   * seconds.
   *
   * Implemented the Ironclad Field's way and for its reason: splash damage is
   * resolved from one queue record against everything in the blast, so a
   * per-record veto cannot protect a unit standing next to the target. Raising
   * `maxHp` to 1e7 for the duration is exact, needs no hook in `Damage.ts`, and
   * cannot be defeated by any damage the game can produce. The ORIGINAL hp is
   * restored on expiry, so it is invulnerability and not a heal.
   */
  private applyIronWill(owner: PlayerId, x: number, z: number, radius: number): void {
    const w = this.world;
    const untilTick = this.tickCount + toTicks(ABILITY_FX.ironWillSeconds);
    const n = w.spatial.queryCircleFat(x, z, radius, this.scratch);

    for (let k = 0; k < n; k++) {
      const e = this.scratch[k];
      if (!this.isFriendlyMover(e, owner)) continue;
      this.protect(e, untilTick);
    }

    const y = w.terrain.heightAt(x, z);
    this.channels.fx.push(FxKind.TeslaArc, x, y + 3, z, 0, 1, 0, 2.8, NONE, Faction.Soviets);
    this.channels.fx.push(FxKind.Sparks, x, y + 1.5, z, 0, 1, 0, 2.2, NONE, Faction.Soviets);
    w.vfx.shake(0.2);
  }

  /**
   * MERIDIAN — Prism Focus. One solar burst on everything hostile in radius.
   *
   * The only ability that goes through the damage channel rather than writing
   * hp itself, because it is ordinary damage: armour class applies, the kill is
   * credited, the bounty pays out, and a unit already at 1 hp dies to it the
   * same way it dies to a rifle. `attacker` is the commander, so the kill lands
   * on the right player's stats.
   */
  private applyPrismFocus(owner: PlayerId, i: number, x: number, z: number, radius: number): void {
    const w = this.world;
    const st = w.store;
    const y = w.terrain.heightAt(x, z);
    const attacker = st.handleOf(i);

    // ONE splash record rather than one per victim: `Damage.ts` already applies
    // falloff from the centre across everything in the radius, and N records
    // would each re-resolve the whole circle.
    this.channels.damage.push(
      NONE, attacker, ABILITY_FX.prismDamage, WarheadClass.Prism,
      x, y + 1.5, z, radius, ABILITY_FX.prismFalloff,
    );

    // Count what it will actually catch, for the stats line only — the damage
    // itself is the channel's job and this loop must not duplicate it.
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
    this.stats.unitsBurned += caught;

    this.channels.fx.push(FxKind.PrismBeam, x, y + 12, z, 0, -1, 0, 3.4, NONE, Faction.Meridian);
    this.channels.fx.push(FxKind.ExplosionMedium, x, y + 1.5, z, 0, 1, 0, 2.2, NONE, Faction.Meridian);
    w.vfx.decal(DecalKind.Scorch, x, z, 0, radius * 0.7);
    w.vfx.shake(0.3);
  }

  /**
   * RECLAMATION — Salvage Call. Wrecks in radius become credits; friendlies in
   * radius are patched up.
   *
   * The only ability with an economic half, and it is the faction's whole
   * doctrine in one button: this army is paid for other people's dead. It is
   * deliberately the weakest in a straight fight and the only one that can win
   * a long one.
   */
  private applySalvageCall(owner: PlayerId, x: number, z: number, radius: number): void {
    const w = this.world;
    const st = w.store;
    const n = w.spatial.queryCircleFat(x, z, radius, this.scratch);

    let wrecks = 0;
    let healed = 0;
    for (let k = 0; k < n; k++) {
      const e = this.scratch[k];
      const f = st.flags[e];
      if ((f & EntityFlag.Alive) === 0) continue;
      if ((f & EntityFlag.PendingDestroy) !== 0) continue;

      if (st.kind[e] === EntityKind.Wreck) {
        if (wrecks >= ABILITY_FX.salvageMaxWrecks) continue;
        wrecks++;
        this.channels.fx.push(
          FxKind.Sparks, st.posX[e], st.posY[e] + 1.0, st.posZ[e],
          0, 1, 0, 1.4, NONE, Faction.Reclaim,
        );
        w.store.markDead(st.handleOf(e));
        continue;
      }

      if (!this.isFriendlyMover(e, owner)) continue;
      const max = st.maxHp[e];
      if (st.hp[e] >= max) continue;
      st.hp[e] = Math.min(max, st.hp[e] + max * ABILITY_FX.salvageHealFraction);
      healed++;
      this.channels.fx.push(
        FxKind.Sparks, st.posX[e], st.posY[e] + 1.2, st.posZ[e],
        0, 1, 0, 0.9, st.handleOf(e), st.faction[e] as Faction,
      );
    }

    const credits = wrecks * ABILITY_FX.salvagePerWreck;
    if (credits > 0) {
      // Bounty, not Harvest: this is not ore and must not inflate the mining
      // statistic the results screen prints.
      getEconomy()?.grant(owner, credits, CreditReason.Bounty);
    }
    this.stats.wrecksSalvaged += wrecks;
    this.stats.creditsSalvaged += credits;
    void healed;

    const y = w.terrain.heightAt(x, z);
    this.channels.fx.push(FxKind.Sparks, x, y + 2, z, 0, 1, 0, 2.4, NONE, Faction.Reclaim);
    w.vfx.shake(0.14);
  }

  /* ======================================================================
   * 2d. IRON WILL BOOKKEEPING
   * ====================================================================== */

  /** Add or extend protection on one slot. */
  private protect(e: number, untilTick: number): void {
    const st = this.world.store;
    const id = st.handleOf(e) as number;
    for (let k = 0; k < this.protectCount; k++) {
      if (this.protectedId[k] === id) {
        if (untilTick > this.protectUntilTick[k]) this.protectUntilTick[k] = untilTick;
        return;
      }
    }
    if (this.protectCount >= PROTECT_CAPACITY) return;
    const k = this.protectCount++;
    this.protectedId[k] = id;
    this.protectUntilTick[k] = untilTick;
    this.protectMaxHp[k] = st.maxHp[e];
    this.protectHp[k] = st.hp[e];
    st.maxHp[e] = PROTECTED_HP;
    st.hp[e] = PROTECTED_HP;
    this.stats.unitsProtected++;
  }

  private protectionTick(): void {
    if (this.protectCount === 0) return;
    const w = this.world;
    const st = w.store;
    this.sparkTicks--;
    const spark = this.sparkTicks <= 0;
    if (spark) this.sparkTicks = toTicks(ABILITY_FX.ironWillSparkSeconds);

    for (let k = this.protectCount - 1; k >= 0; k--) {
      const i = st.index(this.protectedId[k] as EntityId);
      const expired = i < 0 || this.tickCount >= this.protectUntilTick[k]
        || (st.flags[i] & EntityFlag.PendingDestroy) !== 0;

      if (expired) {
        if (i >= 0) {
          // Carry across any promotion earned while protected: the rescale is a
          // pure multiplier on maxHp, so apply the ratio to the restore.
          const scale = st.maxHp[i] / PROTECTED_HP;
          const restoredMax = this.protectMaxHp[k] * (scale > 0 ? scale : 1);
          st.maxHp[i] = restoredMax;
          st.hp[i] = Math.min(restoredMax, Math.max(1, this.protectHp[k] * (scale > 0 ? scale : 1)));
          this.channels.fx.push(
            FxKind.Sparks, st.posX[i], st.posY[i] + 1.4, st.posZ[i],
            0, 1, 0, 1.0, st.handleOf(i), st.faction[i] as Faction,
          );
        }
        const last = --this.protectCount;
        this.protectedId[k] = this.protectedId[last];
        this.protectUntilTick[k] = this.protectUntilTick[last];
        this.protectMaxHp[k] = this.protectMaxHp[last];
        this.protectHp[k] = this.protectHp[last];
        continue;
      }

      if (spark) {
        this.channels.fx.push(
          FxKind.TeslaArc, st.posX[i], st.posY[i] + 1.6, st.posZ[i],
          0, 1, 0, 0.6, st.handleOf(i), st.faction[i] as Faction,
        );
      }
    }
  }

  /* ======================================================================
   * 2e. HELPERS
   * ====================================================================== */

  private defOf(i: number): UnitDef | undefined {
    const d = this.world.store.defId[i];
    if (d < 0 || this.units === null) return undefined;
    return this.units[d];
  }

  /** An allied, living, mobile unit — the target set three of the four share. */
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
    this.protectCount = 0;
    this.units = null;
  }
}

/** The two kinds an ability can land on or come from. Module scope: per tick. */
const MOBILE_KINDS: readonly EntityKind[] = [EntityKind.Infantry, EntityKind.Vehicle];

/* ==========================================================================
 * 3. THE SINGLETON
 *
 * Same shape as `production()` / `superweapons()`: a module-level handle the
 * HUD and the input layer reach through, set by the system module's `init`.
 * ========================================================================== */

let active: AbilityService | null = null;

export function setAbilityService(next: AbilityService | null): void {
  active = next;
}

export function abilities(): AbilityService | null {
  return active;
}

/** True when the player count is within what the protection set can serve. */
export function abilityCapacityOk(): boolean {
  return MAX_PLAYERS * 4 <= PROTECT_CAPACITY;
}
