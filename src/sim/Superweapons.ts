/**
 * ============================================================================
 * src/sim/Superweapons.ts — THE FOUR BUTTONS THAT END GAMES
 * ============================================================================
 *
 * Everything around superweapons already shipped and pointed at nothing:
 * `Hud.setSuperweapon(id, label, remaining, total)`, the countdown row spec in
 * config, the MM:SS formatter, a cameo category, and a camera-shake comment
 * that says "nukes 1.0". This is the gameplay behind them.
 *
 * FOUR, TWO PER ARMY, GENUINELY DIFFERENT:
 *
 *   nuke            (Soviet)  A single annihilating blast, announced three and
 *                             a half seconds before it lands so the target has
 *                             time to be afraid and to scatter.
 *   ironCurtain     (Soviet)  Twenty seconds of true invulnerability for every
 *                             friendly unit in the radius. Not damage
 *                             reduction — invulnerability.
 *   chronosphere    (Allied)  TWO clicks: a source and a destination. Up to
 *                             nine friendly ground units are lifted out of one
 *                             and set down in the other.
 *   lightningStorm  (Allied)  Nine seconds of area denial: a bolt roughly
 *                             twice a second, scattered inside the radius,
 *                             Tesla warhead. Total damage exceeds the nuke's;
 *                             none of it lands where you thought it would.
 *
 * CHARGING is gated on a live, finished, POWERED structure. There are no
 * superweapon structures in the roster yet, so each entry carries a
 * `structureKeys` fallback chain and every one of them ends at `battleLab`.
 * The moment `nuclearSilo` / `ironCurtain` / `chronosphere` / `weatherControl`
 * exist as building defs, they take over with no code change. A player who
 * loses the structure does not lose the charge — the timer PAUSES. Resetting it
 * punishes the wrong thing (being bombed) and reads as a bug.
 *
 * DETERMINISM. `fireAt` only queues an intent; every effect resolves inside
 * `simTick` off `s.rng` and `s.dt`. The pointer flow is presentation: it turns
 * a click into a world position and calls `fireAt`, exactly as the HUD would.
 *
 * WHY IRON CURTAIN INFLATES maxHp INSTEAD OF FILTERING DAMAGE. `Damage.ts` is
 * owned elsewhere and there is no invulnerability hook. Splash damage is
 * resolved from a single queue record against everything in the blast, so a
 * per-record veto cannot protect a unit standing next to the target. Raising
 * `maxHp` to 1e7 for the duration is exact, cheap, needs no hook, and cannot be
 * defeated by any damage the game can produce. On expiry the ORIGINAL hp is
 * restored (so it is invulnerability, not a heal), scaled by any promotion the
 * unit earned while protected.
 *
 * PHASE. `Phase.Production` — before Economy, AI, movement and combat, so a
 * strike queued this tick is resolved before anything reacts to it.
 * ============================================================================
 */

import type { Channels } from '../core/events';
import type { World } from '../core/world';
import {
  DecalKind, EntityFlag, EntityKind, Faction, FxKind, NONE, OrderKind,
  UnitState, WarheadClass,
} from '../core/types';
import type { EntityId, PlayerId, SimContext } from '../core/types';
import { CELL, MAX_PLAYERS } from '../core/config';
import { clampWorld } from '../core/math';

import { production } from './Production';

/* ==========================================================================
 * 1. CONTENT
 * ========================================================================== */

/** Index into `SUPERWEAPONS`. Stable; used as an array stride. */
export const enum SuperweaponId {
  Nuke = 0,
  IronCurtain = 1,
  Chronosphere = 2,
  LightningStorm = 3,
}
export const SUPERWEAPON_COUNT = 4;

export interface SuperweaponDef {
  readonly id: SuperweaponId;
  /** Stable string id. This is the id the HUD countdown row is keyed on. */
  readonly key: string;
  readonly label: string;
  /** Neutral means both armies may field it. */
  readonly faction: Faction;
  readonly chargeSeconds: number;
  /**
   * Structure content keys that gate the charge, in preference order. The
   * first one the player owns, finished and powered, enables the weapon.
   */
  readonly structureKeys: readonly string[];
  /** 'point' fires on one click. 'pointPair' needs a source then a target. */
  readonly targetMode: 'point' | 'pointPair';
  /** Effect radius in metres. Also the targeting reticle's radius. */
  readonly radius: number;
}

export const SUPERWEAPONS: readonly SuperweaponDef[] = [
  {
    id: SuperweaponId.Nuke,
    key: 'nuke',
    label: 'Nuclear Missile',
    faction: Faction.Soviets,
    chargeSeconds: 420,
    structureKeys: ['nuclearSilo', 'battleLab'],
    targetMode: 'point',
    radius: 26,
  },
  {
    id: SuperweaponId.IronCurtain,
    key: 'ironCurtain',
    label: 'Iron Curtain',
    faction: Faction.Soviets,
    chargeSeconds: 300,
    structureKeys: ['ironCurtain', 'battleLab'],
    targetMode: 'point',
    radius: 13,
  },
  {
    id: SuperweaponId.Chronosphere,
    key: 'chronosphere',
    label: 'Chronosphere',
    faction: Faction.Allies,
    chargeSeconds: 300,
    structureKeys: ['chronosphere', 'battleLab'],
    targetMode: 'pointPair',
    radius: 11,
  },
  {
    id: SuperweaponId.LightningStorm,
    key: 'lightningStorm',
    label: 'Lightning Storm',
    faction: Faction.Allies,
    chargeSeconds: 400,
    structureKeys: ['weatherControl', 'battleLab'],
    targetMode: 'point',
    radius: 16,
  },
];

/** Effect tuning. One object so it can be lifted into config.ts wholesale. */
export const SUPERWEAPON_FX = {
  /** Seconds between "missile away" and impact. */
  nukeWarnSeconds: 3.5,
  nukeDamage: 1400,
  nukeSplashFalloff: 0.22,
  nukeShake: 1.0,

  curtainSeconds: 20,
  /** Max HP a protected unit is temporarily given. Nothing in the game reaches it. */
  curtainHp: 1e7,
  /** Seconds between the shimmer sparks on a protected unit. */
  curtainSparkSeconds: 0.6,

  /** Units one chronoshift can lift. */
  chronoMaxUnits: 9,
  /** Metres between arrival slots at the destination. */
  chronoSpacing: 3.2,

  stormDelaySeconds: 1.2,
  stormDurationSeconds: 9,
  stormBoltSeconds: 0.42,
  stormBoltDamage: 190,
  stormBoltSplash: 4.5,
  stormShake: 0.22,
} as const;

/* ==========================================================================
 * 2. PUBLIC SHAPES
 * ========================================================================== */

/** One superweapon's state for one player. Pooled by `states()`. */
export interface SuperweaponState {
  key: string;
  label: string;
  /** True when the player has the gating structure powered. */
  available: boolean;
  /** Seconds left, 0 when ready. */
  remaining: number;
  total: number;
  ready: boolean;
}

export type FireResult = 'fired' | 'staged' | 'rejected';

export interface SuperweaponStats {
  fired: Int32Array;
  strikesResolved: number;
  unitsProtected: number;
  unitsTeleported: number;
  boltsThrown: number;
}

/** What `attachTargeting` needs from the render layer. Keeps this file DOM-lite. */
export interface TargetingHost {
  element: HTMLElement;
  /** Screen -> ground plane. Writes [x, z]. False when the ray misses. */
  groundAt(clientX: number, clientY: number, out: Float32Array): boolean;
  /** Notified whenever the armed weapon changes, for cursor / reticle. */
  onArmedChanged?(key: string | null, stagedX: number, stagedZ: number): void;
}

/** The two Hud methods this module drives. Duck-typed so ui/ stays unowned. */
interface HudSuperweaponSink {
  setSuperweapon(id: string, label: string, remaining: number, total: number): void;
  clearSuperweapon(id: string): void;
}

/* ==========================================================================
 * 3. INTERNAL RECORDS
 * ========================================================================== */

/** A queued fire order, applied at the next simTick. */
interface FireIntent {
  player: number;
  sw: number;
  x: number;
  z: number;
  /** Source point for pointPair weapons. */
  sx: number;
  sz: number;
}

/** A strike in flight. */
interface Strike {
  active: boolean;
  sw: number;
  player: number;
  x: number;
  z: number;
  sx: number;
  sz: number;
  /** Seconds until the effect starts. */
  delay: number;
  /** Seconds of effect remaining after the delay. 0 for one-shots. */
  life: number;
  /** Sub-timer for repeating effects. */
  beat: number;
  /** Set once the one-shot part has run. */
  detonated: boolean;
}

const INTENT_CAPACITY = 16;
const STRIKE_CAPACITY = 16;
const PROTECT_CAPACITY = 128;
/** Ticks between availability rescans. Twice a second is plenty. */
const AVAILABILITY_INTERVAL = 15;

/* ==========================================================================
 * 4. THE SERVICE
 * ========================================================================== */

export class SuperweaponService {
  readonly stats: SuperweaponStats = {
    fired: new Int32Array(SUPERWEAPON_COUNT),
    strikesResolved: 0,
    unitsProtected: 0,
    unitsTeleported: 0,
    boltsThrown: 0,
  };

  /** Seconds left per (player, superweapon). */
  private readonly remaining = new Float64Array(MAX_PLAYERS * SUPERWEAPON_COUNT);
  /** 1 when the gating structure is up. */
  private readonly available = new Uint8Array(MAX_PLAYERS * SUPERWEAPON_COUNT);

  private readonly intents: FireIntent[] = [];
  private intentCount = 0;
  private readonly strikes: Strike[] = [];

  /* -- iron curtain registry --------------------------------------------- */
  private readonly protectedId = new Int32Array(PROTECT_CAPACITY);
  private readonly protectUntil = new Float64Array(PROTECT_CAPACITY);
  private readonly protectMaxHp = new Float32Array(PROTECT_CAPACITY);
  private readonly protectHp = new Float32Array(PROTECT_CAPACITY);
  private protectCount = 0;
  private curtainSpark = 0;

  /* -- pointPair staging (per player) ------------------------------------ */
  private readonly stagedSw = new Int32Array(MAX_PLAYERS).fill(-1);
  private readonly stagedX = new Float64Array(MAX_PLAYERS);
  private readonly stagedZ = new Float64Array(MAX_PLAYERS);

  /* -- targeting mode ---------------------------------------------------- */
  private host: TargetingHost | null = null;
  private armed = -1;
  private armedPlayer = 0 as PlayerId;
  private readonly groundScratch = new Float32Array(2);
  private readonly onPointerDown = (ev: PointerEvent): void => this.handlePointer(ev);
  private readonly onKeyDown = (ev: KeyboardEvent): void => {
    if (ev.key === 'Escape' && this.armed >= 0) { this.cancelArm(); ev.preventDefault(); }
  };

  private readonly statePool: SuperweaponState[] = [];
  private readonly scratch = new Int32Array(256);
  private hudTick = 0;

  constructor(
    private readonly world: World,
    private readonly channels: Channels,
  ) {
    for (let i = 0; i < INTENT_CAPACITY; i++) {
      this.intents.push({ player: 0, sw: 0, x: 0, z: 0, sx: 0, sz: 0 });
    }
    for (let i = 0; i < STRIKE_CAPACITY; i++) {
      this.strikes.push({
        active: false, sw: 0, player: 0, x: 0, z: 0, sx: 0, sz: 0,
        delay: 0, life: 0, beat: 0, detonated: false,
      });
    }
    for (let i = 0; i < SUPERWEAPON_COUNT; i++) {
      this.statePool.push({
        key: SUPERWEAPONS[i].key, label: SUPERWEAPONS[i].label,
        available: false, remaining: 0, total: 1, ready: false,
      });
    }
    this.resetCharges();
  }

  /** Put every timer back to a full charge. Called at construction and on reset. */
  resetCharges(): void {
    for (let p = 0; p < MAX_PLAYERS; p++) {
      for (let s = 0; s < SUPERWEAPON_COUNT; s++) {
        this.remaining[p * SUPERWEAPON_COUNT + s] = SUPERWEAPONS[s].chargeSeconds;
      }
    }
    this.available.fill(0);
  }

  /**
   * Finish a charge immediately. This is the scripted-mission / cheat / test
   * entry point; it does NOT bypass the availability gate, so a player with no
   * structure still cannot fire.
   */
  grantReady(player: PlayerId, key: string): boolean {
    const s = this.indexOf(key);
    if (s < 0) return false;
    const pi = player as number;
    if (pi < 0 || pi >= MAX_PLAYERS) return false;
    this.remaining[pi * SUPERWEAPON_COUNT + s] = 0;
    return true;
  }

  /* ======================================================================
   * 4a. QUERIES
   * ====================================================================== */

  /** Superweapon index for a key, or -1. */
  indexOf(key: string): number {
    for (let i = 0; i < SUPERWEAPON_COUNT; i++) if (SUPERWEAPONS[i].key === key) return i;
    return -1;
  }

  /** Seconds left on a charge. -1 when the player cannot field it at all. */
  remainingFor(player: PlayerId, key: string): number {
    const s = this.indexOf(key);
    if (s < 0) return -1;
    const b = (player as number) * SUPERWEAPON_COUNT + s;
    return this.available[b] === 0 ? -1 : this.remaining[b];
  }

  isReady(player: PlayerId, key: string): boolean {
    const s = this.indexOf(key);
    if (s < 0) return false;
    const b = (player as number) * SUPERWEAPON_COUNT + s;
    return this.available[b] !== 0 && this.remaining[b] <= 0;
  }

  /**
   * Every superweapon this player could ever field, with live state. The array
   * is pooled — read it, do not retain it.
   */
  states(player: PlayerId): readonly SuperweaponState[] {
    const p = this.world.players[player as number];
    const out = this.statePool;
    for (let s = 0; s < SUPERWEAPON_COUNT; s++) {
      const def = SUPERWEAPONS[s];
      const b = (player as number) * SUPERWEAPON_COUNT + s;
      const st = out[s];
      st.key = def.key;
      st.label = def.label;
      st.total = def.chargeSeconds;
      st.available = this.available[b] !== 0
        && (def.faction === Faction.Neutral || p === undefined || p.faction === def.faction);
      st.remaining = Math.max(0, this.remaining[b]);
      st.ready = st.available && st.remaining <= 0;
    }
    return out;
  }

  /** True while this entity is inside an Iron Curtain. */
  isProtected(id: EntityId): boolean {
    const st = this.world.store;
    const i = st.index(id);
    if (i < 0) return false;
    for (let k = 0; k < this.protectCount; k++) {
      if (st.index(this.protectedId[k] as EntityId) === i) return true;
    }
    return false;
  }

  /* ======================================================================
   * 4b. FIRING
   * ====================================================================== */

  /**
   * Fire, or stage the first half of a two-click weapon.
   *
   * Returns 'staged' when a `pointPair` weapon has recorded its source and is
   * waiting for the destination, 'fired' when a strike was queued, and
   * 'rejected' when the weapon is not ready, not available, or not this
   * player's faction. Nothing happens until the next `simTick`.
   */
  fireAt(player: PlayerId, key: string, x: number, z: number): FireResult {
    const s = this.indexOf(key);
    if (s < 0) return 'rejected';
    const def = SUPERWEAPONS[s];
    const pi = player as number;
    if (pi < 0 || pi >= MAX_PLAYERS) return 'rejected';
    const p = this.world.players[pi];
    if (p === undefined) return 'rejected';
    if (def.faction !== Faction.Neutral && p.faction !== def.faction) return 'rejected';
    const b = pi * SUPERWEAPON_COUNT + s;
    if (this.available[b] === 0 || this.remaining[b] > 0) return 'rejected';

    const tx = clampWorld(x, 1);
    const tz = clampWorld(z, 1);

    if (def.targetMode === 'pointPair' && this.stagedSw[pi] !== s) {
      this.stagedSw[pi] = s;
      this.stagedX[pi] = tx;
      this.stagedZ[pi] = tz;
      this.channels.fx.push(FxKind.PrismBeam, tx, 1.5, tz, 0, 1, 0, 1.4, NONE, p.faction);
      this.host?.onArmedChanged?.(def.key, tx, tz);
      return 'staged';
    }

    const sx = def.targetMode === 'pointPair' ? this.stagedX[pi] : tx;
    const sz = def.targetMode === 'pointPair' ? this.stagedZ[pi] : tz;
    this.stagedSw[pi] = -1;

    if (this.intentCount >= INTENT_CAPACITY) return 'rejected';
    const it = this.intents[this.intentCount++];
    it.player = pi;
    it.sw = s;
    it.x = tx;
    it.z = tz;
    it.sx = sx;
    it.sz = sz;

    // Spend the charge here rather than in the sim step so a double-click on a
    // ready cameo cannot queue the same strike twice.
    this.remaining[b] = def.chargeSeconds;
    this.cancelArm();
    return 'fired';
  }

  /* ======================================================================
   * 4c. THE TICK
   * ====================================================================== */

  simTick(s: SimContext): void {
    if ((s.tick % AVAILABILITY_INTERVAL) === 0) this.rescanAvailability();
    this.chargeTick(s);
    this.drainIntents(s);
    this.strikeTick(s);
    this.protectionTick(s);
    this.pushHud(s);
  }

  /** Charges only advance while the gating structure is standing and lit. */
  private chargeTick(s: SimContext): void {
    const n = this.world.players.length;
    for (let p = 0; p < n; p++) {
      for (let w = 0; w < SUPERWEAPON_COUNT; w++) {
        const b = p * SUPERWEAPON_COUNT + w;
        if (this.available[b] === 0) continue;
        if (this.remaining[b] <= 0) continue;
        this.remaining[b] = Math.max(0, this.remaining[b] - s.dt);
      }
    }
  }

  /**
   * One pass over the building list per rescan. A superweapon is available when
   * the player owns a finished, powered structure whose catalog key appears in
   * the weapon's fallback chain — first match wins, so a real Nuclear Silo
   * supersedes the Battle Lab stand-in the moment one exists.
   */
  rescanAvailability(): void {
    const w = this.world;
    const st = w.store;
    const svc = production();
    this.available.fill(0);

    const list = st.byKind[EntityKind.Building];
    const count = st.byKindCount[EntityKind.Building];
    for (let a = 0; a < count; a++) {
      const i = list[a];
      const f = st.flags[i];
      if ((f & EntityFlag.Alive) === 0) continue;
      if ((f & (EntityFlag.PendingDestroy | EntityFlag.UnderConstruction)) !== 0) continue;
      // A dark structure charges nothing. Structures that MAKE power are never
      // unpowered, and Power.ts maintains the bit for everything else.
      if ((f & EntityFlag.NeedsPower) !== 0 && (f & EntityFlag.Powered) === 0) continue;

      const key = svc?.entryOf(st.handleOf(i))?.key;
      if (key === undefined) continue;
      const owner = st.owner[i];
      const p = w.players[owner];
      if (p === undefined || p.faction === Faction.Neutral) continue;

      for (let s = 0; s < SUPERWEAPON_COUNT; s++) {
        const def = SUPERWEAPONS[s];
        if (def.faction !== Faction.Neutral && def.faction !== p.faction) continue;
        if (def.structureKeys.indexOf(key) < 0) continue;
        this.available[owner * SUPERWEAPON_COUNT + s] = 1;
      }
    }
  }

  private drainIntents(s: SimContext): void {
    const n = this.intentCount;
    this.intentCount = 0;
    for (let k = 0; k < n; k++) {
      const it = this.intents[k];
      const strike = this.claimStrike();
      if (strike === null) continue;
      const def = SUPERWEAPONS[it.sw];
      strike.active = true;
      strike.sw = it.sw;
      strike.player = it.player;
      strike.x = it.x;
      strike.z = it.z;
      strike.sx = it.sx;
      strike.sz = it.sz;
      strike.detonated = false;
      strike.beat = 0;

      switch (it.sw as SuperweaponId) {
        case SuperweaponId.Nuke:
          strike.delay = SUPERWEAPON_FX.nukeWarnSeconds;
          strike.life = 0;
          this.announceNuke(strike);
          break;
        case SuperweaponId.LightningStorm:
          strike.delay = SUPERWEAPON_FX.stormDelaySeconds;
          strike.life = SUPERWEAPON_FX.stormDurationSeconds;
          break;
        default:
          strike.delay = 0;
          strike.life = 0;
          break;
      }
      this.stats.fired[it.sw]++;
      void def;
      void s;
    }
  }

  private claimStrike(): Strike | null {
    for (let i = 0; i < STRIKE_CAPACITY; i++) if (!this.strikes[i].active) return this.strikes[i];
    return null;
  }

  private strikeTick(s: SimContext): void {
    for (let i = 0; i < STRIKE_CAPACITY; i++) {
      const k = this.strikes[i];
      if (!k.active) continue;

      if (k.delay > 0) {
        k.delay -= s.dt;
        if (k.sw === SuperweaponId.Nuke) this.nukeWarningBeat(k, s);
        if (k.delay > 0) continue;
      }

      if (!k.detonated) {
        k.detonated = true;
        switch (k.sw as SuperweaponId) {
          case SuperweaponId.Nuke: this.detonateNuke(k); break;
          case SuperweaponId.IronCurtain: this.applyCurtain(k); break;
          case SuperweaponId.Chronosphere: this.applyChrono(k, s); break;
          default: break;
        }
        this.stats.strikesResolved++;
      }

      if (k.life <= 0) { k.active = false; continue; }

      k.life -= s.dt;
      if (k.sw === SuperweaponId.LightningStorm) this.stormBeat(k, s);
      if (k.life <= 0) k.active = false;
    }
  }

  /* ======================================================================
   * 4d. THE FOUR EFFECTS
   * ====================================================================== */

  private announceNuke(k: Strike): void {
    const y = this.world.terrain.heightAt(k.x, k.z);
    // A marker beam standing on the target for three and a half seconds is the
    // warning. It is deliberately visible to BOTH sides.
    this.channels.fx.push(FxKind.PrismBeam, k.x, y + 18, k.z, 0, -1, 0, 2.2, NONE, Faction.Soviets);
    this.world.vfx.decal(DecalKind.Scorch, k.x, k.z, 0, 6);
  }

  private nukeWarningBeat(k: Strike, s: SimContext): void {
    k.beat -= s.dt;
    if (k.beat > 0) return;
    k.beat = 0.5;
    const y = this.world.terrain.heightAt(k.x, k.z);
    this.channels.fx.push(FxKind.Sparks, k.x, y + 1.0, k.z, 0, 1, 0, 1.6, NONE, Faction.Soviets);
  }

  private detonateNuke(k: Strike): void {
    const w = this.world;
    const def = SUPERWEAPONS[SuperweaponId.Nuke];
    const y = w.terrain.heightAt(k.x, k.z);

    this.channels.damage.push(
      NONE, NONE, SUPERWEAPON_FX.nukeDamage, WarheadClass.HighExplosive,
      k.x, y + 2, k.z, def.radius, SUPERWEAPON_FX.nukeSplashFalloff,
    );

    this.channels.fx.push(FxKind.ExplosionLarge, k.x, y + 6, k.z, 0, 1, 0, 6, NONE, Faction.Soviets);
    this.channels.fx.push(FxKind.SmokePlumeLarge, k.x, y + 14, k.z, 0, 1, 0, 8, NONE, Faction.Soviets);
    this.channels.fx.push(FxKind.Debris, k.x, y + 3, k.z, 0, 1, 0, 5, NONE, Faction.Soviets);
    // A ring of secondaries: one blast sprite at this scale reads as a bug,
    // eight reads as a mushroom cloud sitting on a burning circle.
    for (let a = 0; a < 8; a++) {
      const ang = (a / 8) * Math.PI * 2;
      const rx = k.x + Math.sin(ang) * def.radius * 0.6;
      const rz = k.z + Math.cos(ang) * def.radius * 0.6;
      this.channels.fx.push(
        FxKind.ExplosionMedium, rx, w.terrain.heightAt(rx, rz) + 1.5, rz,
        0, 1, 0, 2.4, NONE, Faction.Soviets,
      );
    }
    w.vfx.decal(DecalKind.Crater, k.x, k.z, 0, def.radius * 1.4);
    w.vfx.shake(SUPERWEAPON_FX.nukeShake);
    w.audio.play(FxKind.ExplosionLarge, k.x, k.z, 1);
  }

  private applyCurtain(k: Strike): void {
    const w = this.world;
    const st = w.store;
    const def = SUPERWEAPONS[SuperweaponId.IronCurtain];
    const owner = k.player as PlayerId;
    const until = w.time + SUPERWEAPON_FX.curtainSeconds;

    const n = w.spatial.queryCircleFat(k.x, k.z, def.radius, this.scratch);
    for (let i = 0; i < n; i++) {
      const e = this.scratch[i];
      const f = st.flags[e];
      if ((f & EntityFlag.Alive) === 0) continue;
      if ((f & (EntityFlag.PendingDestroy | EntityFlag.Garrisoned)) !== 0) continue;
      const kind = st.kind[e];
      if (kind !== EntityKind.Infantry && kind !== EntityKind.Vehicle) continue;
      if (!w.areAllied(owner, st.owner[e] as PlayerId)) continue;
      this.protect(e, until);
    }

    const y = w.terrain.heightAt(k.x, k.z);
    this.channels.fx.push(FxKind.TeslaArc, k.x, y + 3, k.z, 0, 1, 0, 3.2, NONE, Faction.Soviets);
    this.channels.fx.push(FxKind.Sparks, k.x, y + 1.5, k.z, 0, 1, 0, 2.6, NONE, Faction.Soviets);
    w.vfx.shake(0.25);
  }

  /** Add or extend protection on one slot. */
  private protect(e: number, until: number): void {
    const st = this.world.store;
    const id = st.handleOf(e) as number;
    for (let k = 0; k < this.protectCount; k++) {
      if (this.protectedId[k] === id) {
        if (until > this.protectUntil[k]) this.protectUntil[k] = until;
        return;
      }
    }
    if (this.protectCount >= PROTECT_CAPACITY) return;
    const k = this.protectCount++;
    this.protectedId[k] = id;
    this.protectUntil[k] = until;
    this.protectMaxHp[k] = st.maxHp[e];
    this.protectHp[k] = st.hp[e];
    st.maxHp[e] = SUPERWEAPON_FX.curtainHp;
    st.hp[e] = SUPERWEAPON_FX.curtainHp;
    this.stats.unitsProtected++;
  }

  private protectionTick(s: SimContext): void {
    if (this.protectCount === 0) return;
    const w = this.world;
    const st = w.store;
    this.curtainSpark -= s.dt;
    const spark = this.curtainSpark <= 0;
    if (spark) this.curtainSpark = SUPERWEAPON_FX.curtainSparkSeconds;

    for (let k = this.protectCount - 1; k >= 0; k--) {
      const i = st.index(this.protectedId[k] as EntityId);
      const expired = i < 0 || w.time >= this.protectUntil[k]
        || (st.flags[i] & EntityFlag.PendingDestroy) !== 0;

      if (expired) {
        if (i >= 0) {
          // Preserve any promotion earned while protected: the rescale is a
          // pure multiplier on maxHp, so carry the ratio across the restore.
          const scale = st.maxHp[i] / SUPERWEAPON_FX.curtainHp;
          const restoredMax = this.protectMaxHp[k] * (scale > 0 ? scale : 1);
          st.maxHp[i] = restoredMax;
          st.hp[i] = Math.min(restoredMax, Math.max(1, this.protectHp[k] * (scale > 0 ? scale : 1)));
          this.channels.fx.push(
            FxKind.Sparks, st.posX[i], st.posY[i] + 1.4, st.posZ[i],
            0, 1, 0, 1.1, st.handleOf(i), st.faction[i] as Faction,
          );
        }
        const last = --this.protectCount;
        this.protectedId[k] = this.protectedId[last];
        this.protectUntil[k] = this.protectUntil[last];
        this.protectMaxHp[k] = this.protectMaxHp[last];
        this.protectHp[k] = this.protectHp[last];
        continue;
      }

      if (spark) {
        this.channels.fx.push(
          FxKind.TeslaArc, st.posX[i], st.posY[i] + 1.6, st.posZ[i],
          0, 1, 0, 0.7, st.handleOf(i), st.faction[i] as Faction,
        );
      }
    }
  }

  private applyChrono(k: Strike, s: SimContext): void {
    const w = this.world;
    const st = w.store;
    const def = SUPERWEAPONS[SuperweaponId.Chronosphere];
    const owner = k.player as PlayerId;

    const n = w.spatial.queryCircleFat(k.sx, k.sz, def.radius, this.scratch);
    let moved = 0;
    for (let i = 0; i < n && moved < SUPERWEAPON_FX.chronoMaxUnits; i++) {
      const e = this.scratch[i];
      const f = st.flags[e];
      if ((f & EntityFlag.Alive) === 0) continue;
      if ((f & (EntityFlag.PendingDestroy | EntityFlag.Garrisoned)) !== 0) continue;
      if ((f & EntityFlag.CanMove) === 0) continue;
      const kind = st.kind[e];
      if (kind !== EntityKind.Infantry && kind !== EntityKind.Vehicle) continue;
      if (!w.areAllied(owner, st.owner[e] as PlayerId)) continue;

      // Spiral the arrivals so nine tanks do not land inside each other and
      // spend the next two seconds shoving their way apart.
      const ring = Math.floor(moved / 6);
      const slot = moved % 6;
      const ang = (slot / 6) * Math.PI * 2 + ring * 0.5;
      const r = (ring + 1) * SUPERWEAPON_FX.chronoSpacing;
      const nx = clampWorld(k.x + Math.sin(ang) * r, 2);
      const nz = clampWorld(k.z + Math.cos(ang) * r, 2);

      this.channels.fx.push(
        FxKind.PrismBeam, st.posX[e], st.posY[e] + 2, st.posZ[e],
        0, 1, 0, 1.3, st.handleOf(e), st.faction[e] as Faction,
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
        0, 1, 0, 1.3, st.handleOf(e), st.faction[e] as Faction,
      );
      moved++;
    }

    this.stats.unitsTeleported += moved;
    const sy = w.terrain.heightAt(k.sx, k.sz);
    const dy = w.terrain.heightAt(k.x, k.z);
    this.channels.fx.push(FxKind.PrismBeam, k.sx, sy + 8, k.sz, 0, -1, 0, 3, NONE, Faction.Allies);
    this.channels.fx.push(FxKind.PrismBeam, k.x, dy + 8, k.z, 0, -1, 0, 3, NONE, Faction.Allies);
    w.vfx.shake(0.2);
    void s;
  }

  private stormBeat(k: Strike, s: SimContext): void {
    k.beat -= s.dt;
    if (k.beat > 0) return;
    k.beat = SUPERWEAPON_FX.stormBoltSeconds;

    const w = this.world;
    const def = SUPERWEAPONS[SuperweaponId.LightningStorm];
    // Uniform in the disc: sqrt keeps bolts from clustering at the centre.
    const ang = s.rng.next() * Math.PI * 2;
    const r = Math.sqrt(s.rng.next()) * def.radius;
    const bx = clampWorld(k.x + Math.sin(ang) * r, 1);
    const bz = clampWorld(k.z + Math.cos(ang) * r, 1);
    const by = w.terrain.heightAt(bx, bz);

    this.channels.damage.push(
      NONE, NONE, SUPERWEAPON_FX.stormBoltDamage, WarheadClass.Tesla,
      bx, by + 1, bz, SUPERWEAPON_FX.stormBoltSplash, 0.3,
    );
    this.channels.fx.push(FxKind.TeslaArc, bx, by + 14, bz, 0, -1, 0, 3.4, NONE, Faction.Allies);
    this.channels.fx.push(FxKind.ExplosionSmall, bx, by + 0.8, bz, 0, 1, 0, 1.5, NONE, Faction.Allies);
    w.vfx.decal(DecalKind.Scorch, bx, bz, ang, 3.2);
    w.vfx.shake(SUPERWEAPON_FX.stormShake);
    this.stats.boltsThrown++;
  }

  /* ======================================================================
   * 4e. HUD
   * ====================================================================== */

  /**
   * Drive the countdown rows for the LOCAL player only. Duck-typed against
   * `globalThis.__vmHud` so this module never imports src/ui — the HUD may not
   * exist at all (headless, screenshot harness, tests) and that is fine.
   */
  private pushHud(s: SimContext): void {
    if (++this.hudTick < 3) return;
    this.hudTick = 0;
    const hud = hudSink();
    if (hud === null) return;
    const states = this.states(this.world.localPlayer);
    for (let i = 0; i < states.length; i++) {
      const st = states[i];
      if (st.available) hud.setSuperweapon(st.key, st.label, st.remaining, st.total);
      else hud.clearSuperweapon(st.key);
    }
    void s;
  }

  /* ======================================================================
   * 4f. TARGETING MODE
   * ====================================================================== */

  /**
   * Give the service a way to turn a click into a world position. Optional:
   * without it, `arm()` is a no-op and the HUD is expected to call `fireAt`
   * itself. The listener is only installed WHILE a weapon is armed, so this can
   * never interfere with normal selection and ordering.
   */
  attachTargeting(host: TargetingHost | null): void {
    if (this.armed >= 0) this.cancelArm();
    this.host = host;
  }

  /** The armed weapon's key, or null. */
  get armedKey(): string | null {
    return this.armed >= 0 ? SUPERWEAPONS[this.armed].key : null;
  }

  /**
   * Enter targeting mode. The next click on the canvas fires (or, for the
   * Chronosphere, stages then fires). Returns false when the weapon is not
   * ready or no targeting host was attached.
   */
  arm(player: PlayerId, key: string): boolean {
    const s = this.indexOf(key);
    if (s < 0 || this.host === null) return false;
    if (!this.isReady(player, key)) return false;
    if (this.armed === s && (this.armedPlayer as number) === (player as number)) return true;
    if (this.armed >= 0) this.detachListeners();
    this.armed = s;
    this.armedPlayer = player;
    this.attachListeners();
    this.host.onArmedChanged?.(SUPERWEAPONS[s].key, 0, 0);
    return true;
  }

  /** Leave targeting mode without firing. */
  cancelArm(): void {
    if (this.armed < 0) return;
    this.armed = -1;
    this.stagedSw[this.armedPlayer as number] = -1;
    this.detachListeners();
    this.host?.onArmedChanged?.(null, 0, 0);
  }

  private attachListeners(): void {
    const host = this.host;
    if (host === null || typeof host.element?.addEventListener !== 'function') return;
    host.element.addEventListener('pointerdown', this.onPointerDown, true);
    if (typeof globalThis.addEventListener === 'function') {
      globalThis.addEventListener('keydown', this.onKeyDown, true);
    }
  }

  private detachListeners(): void {
    const host = this.host;
    if (host !== null && typeof host.element?.removeEventListener === 'function') {
      host.element.removeEventListener('pointerdown', this.onPointerDown, true);
    }
    if (typeof globalThis.removeEventListener === 'function') {
      globalThis.removeEventListener('keydown', this.onKeyDown, true);
    }
  }

  private handlePointer(ev: PointerEvent): void {
    if (this.armed < 0 || this.host === null) return;
    // Right-click cancels, exactly like abandoning a building placement.
    if (ev.button === 2) {
      ev.preventDefault();
      ev.stopPropagation();
      this.cancelArm();
      return;
    }
    if (ev.button !== 0) return;
    if (!this.host.groundAt(ev.clientX, ev.clientY, this.groundScratch)) return;
    ev.preventDefault();
    ev.stopPropagation();

    const key = SUPERWEAPONS[this.armed].key;
    const result = this.fireAt(this.armedPlayer, key, this.groundScratch[0], this.groundScratch[1]);
    if (result === 'staged') this.host.onArmedChanged?.(key, this.groundScratch[0], this.groundScratch[1]);
  }

  /* ====================================================================== */

  dispose(): void {
    this.cancelArm();
    this.host = null;
    // Never leave a unit with 1e7 max HP behind.
    const st = this.world.store;
    for (let k = 0; k < this.protectCount; k++) {
      const i = st.index(this.protectedId[k] as EntityId);
      if (i < 0) continue;
      st.maxHp[i] = this.protectMaxHp[k];
      st.hp[i] = Math.min(this.protectMaxHp[k], this.protectHp[k]);
    }
    this.protectCount = 0;
    this.intentCount = 0;
    for (let i = 0; i < STRIKE_CAPACITY; i++) this.strikes[i].active = false;
    const hud = hudSink();
    if (hud !== null) for (const d of SUPERWEAPONS) hud.clearSuperweapon(d.key);
  }
}

function hudSink(): HudSuperweaponSink | null {
  const g = globalThis as unknown as Record<string, unknown>;
  const h = g.__vmHud as Partial<HudSuperweaponSink> | undefined;
  if (h === undefined || h === null) return null;
  if (typeof h.setSuperweapon !== 'function' || typeof h.clearSuperweapon !== 'function') return null;
  return h as HudSuperweaponSink;
}

/* ==========================================================================
 * 5. MODULE ACCESSOR
 * ========================================================================== */

let active: SuperweaponService | null = null;

export function setSuperweaponService(next: SuperweaponService | null): void {
  active = next;
}

export function superweapons(): SuperweaponService | null {
  return active;
}
