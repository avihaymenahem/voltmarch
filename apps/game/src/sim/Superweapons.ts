/**
 * ============================================================================
 * src/sim/Superweapons.ts — THE SIX BUTTONS THAT END GAMES
 * ============================================================================
 *
 * Everything around superweapons already shipped and pointed at nothing:
 * `Hud.setSuperweapon(id, label, remaining, total)`, the countdown row spec in
 * config, the MM:SS formatter, a cameo category, and a camera-shake comment
 * that says "nukes 1.0". This is the gameplay behind them.
 *
 * This header opened "THE FOUR BUTTONS THAT END GAMES" and listed four, two per
 * army, for two releases after the fifth and sixth shipped — the count was the
 * original two armies' and nothing updated it when the Pact and the
 * Reclamation got theirs. `SUPERWEAPON_COUNT` is 6 and always was the honest
 * number; the paragraph below it has said so all along.
 *
 * FOUR EFFECTS, GENUINELY DIFFERENT:
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
 * SIX ENTRIES, FOUR EFFECTS. The two armies that landed after this file was
 * written need a button of their own, and neither one needed a fifth effect to
 * get it: the Pact's Solar Lance is the nuke's single warned annihilation and
 * the Reclamation's Arc Storm is the storm's scattered area denial. So a def
 * carries an `effect` as well as an `id`, and every effect below reads its
 * radius and its FX colour off the ROW THAT FIRED rather than off a hard-coded
 * `SUPERWEAPONS[SuperweaponId.Nuke]`. For the original four the two are the
 * same value, which is why nothing about them changed.
 *
 * AND SINCE v2.3 THEY ARE GATED ON A MISSION AS WELL AS ON A STRUCTURE. All six
 * defs shipped without `unlockedBy`, so a fresh profile could build a Nuclear
 * Missile Silo in its first match while the five `struct.superweapon.*` rewards
 * at the end of the longest chains in `src/data/Missions.ts` paid into nothing.
 * `UNLOCK_TAGS` in `src/data/Defs.ts` tags them, grouped by the `effect` column
 * below — so the unlock id and `structureKeys` can never disagree about what a
 * weapon is. Nothing in THIS file reads that; the gate is upstream, in the
 * production catalogue.
 *
 * CHARGING is gated on a live, finished, POWERED structure, and `structureKeys`
 * names it. This used to end every chain at `battleLab` because no superweapon
 * structure existed — which meant a Proving Ground, the prerequisite for half the
 * roster, silently armed BOTH of its army's superweapons. The six structures
 * exist now (`nuclearSilo`, `ironCurtain`, `chronosphere`, `weatherControl`,
 * `mrdHeliograph`, `rclStormworks`), so the chains name them and nothing else.
 * A player who loses the structure does not lose the charge — the timer PAUSES.
 * Resetting it punishes the wrong thing (being bombed) and reads as a bug.
 *
 * DETERMINISM, AND THE BUS. `fireAt` only queues an intent; every effect
 * resolves inside `simTick` off `s.rng` and `s.dt`. And `fireAt` itself is now
 * only ever reached FROM `simTick`: a click on the ground does not call it, it
 * issues `OrderKind.UseAbility` on the gating structure through
 * `channels.commands`, exactly as `Hud.useSelectedAbility` does for a
 * commander. `consumeOrders` picks that off the structure at Phase.Production
 * and fires. Read the comment on `CommandKind.Relocate` in core/types.ts for
 * why: a verb that reaches the simulation without passing the bus is invisible
 * to the replay recorder, to a spectator and to the multiplayer link, and the
 * AI's every move is visible. It also makes the two-click Displacement Ring staging
 * deterministic — it advances on a tick rather than on a pointer event.
 *
 * The order rides on a BUILDING, which is why `sim/Abilities.ts` cannot eat it:
 * that module's `consumeOrders` walks `MOBILE_KINDS` only.
 *
 * WHY THE IRONCLAD FIELD INFLATES maxHp INSTEAD OF FILTERING DAMAGE. `Damage.ts` is
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
  DecalKind, EntityFlag, EntityKind, EvaLine, Faction, FxKind, NONE, OrderKind,
  UnitState, WarheadClass,
} from '../core/types';
import type { EntityId, PlayerId, SimContext } from '../core/types';
import { CELL, MAX_PLAYERS } from '../core/config';
import { clampWorld } from '../core/math';

import { production } from './Production';
import { canRelocateTo } from './Movement';

/* ==========================================================================
 * 1. CONTENT
 * ========================================================================== */

/**
 * Index into `SUPERWEAPONS`. Stable; used as an array stride.
 *
 * APPENDED, NEVER INSERTED. `stats.fired` is indexed by it and every save and
 * every test below names a row by its position.
 */
export const enum SuperweaponId {
  Nuke = 0,
  IronCurtain = 1,
  Chronosphere = 2,
  LightningStorm = 3,
  /** Meridian Pact. Runs the nuke's effect at the Pact's own radius. */
  SolarLance = 4,
  /** Reclamation. Runs the lightning storm's effect. */
  ArcStorm = 5,
}
export const SUPERWEAPON_COUNT = 6;

export interface SuperweaponDef {
  readonly id: SuperweaponId;
  /**
   * Which of the four resolved effects this row runs. For the original four it
   * is the row's own id; the two later armies point at an existing one rather
   * than adding a fifth, because "a single warned annihilation" and "nine
   * seconds of scattered bolts" were already the two shapes they needed.
   */
  readonly effect: SuperweaponId;
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
    effect: SuperweaponId.Nuke,
    key: 'nuke',
    label: 'Nuclear Missile',
    faction: Faction.Soviets,
    chargeSeconds: 420,
    structureKeys: ['nuclearSilo'],
    targetMode: 'point',
    radius: 26,
  },
  {
    id: SuperweaponId.IronCurtain,
    effect: SuperweaponId.IronCurtain,
    key: 'ironCurtain',
    label: 'Ironclad Field',
    faction: Faction.Soviets,
    chargeSeconds: 300,
    structureKeys: ['ironCurtain'],
    targetMode: 'point',
    radius: 13,
  },
  {
    id: SuperweaponId.Chronosphere,
    effect: SuperweaponId.Chronosphere,
    key: 'chronosphere',
    label: 'Displacement Ring',
    faction: Faction.Allies,
    chargeSeconds: 300,
    structureKeys: ['chronosphere'],
    targetMode: 'pointPair',
    radius: 11,
  },
  {
    id: SuperweaponId.LightningStorm,
    effect: SuperweaponId.LightningStorm,
    key: 'lightningStorm',
    label: 'Lightning Storm',
    faction: Faction.Allies,
    chargeSeconds: 400,
    structureKeys: ['weatherControl'],
    targetMode: 'point',
    radius: 16,
  },
  {
    // The Pact aims a sky mirror. Same shape as the missile — one warned,
    // annihilating strike — at a slightly tighter radius, because the Pact
    // pays for its tempo everywhere else and a wider blast would be a third
    // advantage on top of the two the faction already has.
    id: SuperweaponId.SolarLance,
    effect: SuperweaponId.Nuke,
    key: 'solarLance',
    label: 'Solar Lance',
    faction: Faction.Meridian,
    chargeSeconds: 420,
    structureKeys: ['mrdHeliograph'],
    targetMode: 'point',
    radius: 24,
  },
  {
    // The Reclamation's whole armoury is chained arcs, so its superweapon is
    // the storm: nothing lands where you aimed, and the total exceeds a nuke.
    id: SuperweaponId.ArcStorm,
    effect: SuperweaponId.LightningStorm,
    key: 'arcStorm',
    label: 'Arc Storm',
    faction: Faction.Reclaim,
    chargeSeconds: 400,
    structureKeys: ['rclStormworks'],
    targetMode: 'point',
    radius: 17,
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
  /** Edge latch: one ready announcement per completed charge. */
  private readonly readyAnnounced = new Uint8Array(MAX_PLAYERS * SUPERWEAPON_COUNT);
  /**
   * The entity that gates each (player, superweapon), or `NONE`.
   *
   * This is what the fire command is ADDRESSED to. Routing through the bus
   * needs an entity — `CommandKind.Order` carries a selection, not a string —
   * and the structure is the honest subject: it is the thing the player built,
   * the thing an enemy can bomb to stop the strike, and the thing whose
   * ownership `input/Commands.ts` already checks before it writes the order.
   */
  private readonly structureId = new Int32Array(MAX_PLAYERS * SUPERWEAPON_COUNT);

  private readonly intents: FireIntent[] = [];
  private intentCount = 0;
  private readonly strikes: Strike[] = [];

  /* -- ironclad field registry --------------------------------------------- */
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
  /** Clicks banked toward a `pointPair` weapon. Cursor state, not sim state. */
  private pairClicks = 0;
  private readonly groundScratch = new Float32Array(2);
  private readonly onPointerDown = (ev: PointerEvent): void => this.handlePointer(ev);
  private readonly onKeyDown = (ev: KeyboardEvent): void => {
    if (ev.key === 'Escape' && this.armed >= 0) { this.cancelArm(); ev.preventDefault(); }
  };

  private readonly statePool: SuperweaponState[] = [];
  private readonly scratch = new Int32Array(256);
  /** One-entity selection for `issueFire`. Reused; the bus copies it out. */
  private readonly fireScratch = new Int32Array(1);
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
    this.readyAnnounced.fill(0);
    this.structureId.fill(NONE as number);
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
    const b = pi * SUPERWEAPON_COUNT + s;
    if (this.available[b] !== 0 && this.readyAnnounced[b] === 0) {
      this.readyAnnounced[b] = 1;
      this.world.audio.eva(player, EvaLine.SuperweaponReady);
    }
    return true;
  }

  /**
   * Put a charge back to `seconds`. The SAVE entry point, and the only one.
   *
   * `src/game/SaveGame.ts` has carried the seconds in every file it has ever
   * written and has had `SuperweaponChargeSetter` declared, duck-typed, waiting
   * for this method — "the day the owning module adds it the fidelity arrives
   * with no change here and no schema bump". This is that day. Without it a
   * silo forty seconds from launch reloaded at three hundred, which is the same
   * defect the ore-depletion chunk exists to prevent: a snapshot that restores
   * a number other than the one that was there.
   *
   * It does NOT touch `available`, exactly as `grantReady` does not.
   * Availability is re-derived from the standing structures by
   * `rescanAvailability` within `AVAILABILITY_INTERVAL` ticks of the load, and
   * writing it here would mean a save could hand a player a weapon whose silo
   * is rubble.
   *
   * CLAMPED TO THIS BUILD'S OWN CHARGE, so a save from a build that priced the
   * weapon at 600 s cannot hold a 300 s one hostage for twice as long.
   */
  setRemaining(player: PlayerId, key: string, seconds: number): boolean {
    const s = this.indexOf(key);
    if (s < 0) return false;
    const pi = player as number;
    if (pi < 0 || pi >= MAX_PLAYERS) return false;
    if (!Number.isFinite(seconds)) return false;
    this.remaining[pi * SUPERWEAPON_COUNT + s] =
      Math.min(SUPERWEAPONS[s].chargeSeconds, Math.max(0, seconds));
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
   * The structure that currently gates this weapon for this player, or `NONE`.
   *
   * Refreshed by `rescanAvailability`, so it is at most `AVAILABILITY_INTERVAL`
   * ticks stale — which cannot matter, because the command it addresses is
   * re-validated against ownership by `input/Commands.ts` and against
   * availability by `fireAt`.
   */
  structureFor(player: PlayerId, key: string): EntityId {
    const s = this.indexOf(key);
    if (s < 0) return NONE;
    const pi = player as number;
    if (pi < 0 || pi >= MAX_PLAYERS) return NONE;
    return this.structureId[pi * SUPERWEAPON_COUNT + s] as EntityId;
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

  /** True while this entity is inside an Ironclad Field. */
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
   *
   * `stage` SAYS WHICH HALF OF A TWO-CLICK WEAPON THIS IS, AND IT COMES OFF THE
   * COMMAND. It has to, and the reason is a bug this had: staging used to
   * alternate purely on `stagedSw`, which the CURSOR then had to reset when the
   * player cancelled — so `cancelArm()` wrote simulation state from a DOM event.
   * That is a lockstep divergence on its own, and it also raced itself: the
   * second click issued its command and cancelled the arm in the same
   * statement, `cancelArm` cleared `stagedSw` before the command reached
   * `simTick`, and the Displacement Ring re-staged on its destination instead of
   * firing. Every click looked like a first click and the weapon never fired.
   *
   * Omitting it — the console, the tests, `__vmFeatures.fire` — keeps the old
   * alternating behaviour, which is what a caller with no cursor wants.
   */
  fireAt(player: PlayerId, key: string, x: number, z: number, stage?: boolean): FireResult {
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

    // A commit with nothing staged stages instead of firing at itself — an
    // abandoned gesture must never turn the next click into a chronoshift from
    // wherever the cursor happened to be five minutes ago.
    const armedSource = this.stagedSw[pi] === s;
    if (def.targetMode === 'pointPair' && (!armedSource || stage === true)) {
      this.stagedSw[pi] = s;
      this.stagedX[pi] = tx;
      this.stagedZ[pi] = tz;
      this.channels.fx.push(FxKind.PrismBeam, tx, 1.5, tz, 0, 1, 0, 1.4, NONE, p.faction);
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

    // Spend the charge here rather than in the sim step so two commands landing
    // in the same drain cannot queue the same strike twice.
    //
    // It does NOT `cancelArm()`. Arming is cursor state and this now runs a
    // phase after the click that armed it: a player who fires a nuke and
    // immediately arms an Ironclad Field would have had the second arming torn
    // down by the first one's command arriving.
    this.remaining[b] = def.chargeSeconds;
    this.readyAnnounced[b] = 0;
    if (def.effect === SuperweaponId.Nuke) {
      this.world.audio.eva(player, EvaLine.NuclearMissileLaunched);
    }
    return 'fired';
  }

  /* ======================================================================
   * 4c. THE TICK
   * ====================================================================== */

  simTick(s: SimContext): void {
    if ((s.tick % AVAILABILITY_INTERVAL) === 0) this.rescanAvailability();
    this.consumeOrders();
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
        const before = this.remaining[b];
        this.remaining[b] = Math.max(0, before - s.dt);
        if (before > 0 && this.remaining[b] <= 0 && this.readyAnnounced[b] === 0) {
          this.readyAnnounced[b] = 1;
          this.world.audio.eva(p as PlayerId, EvaLine.SuperweaponReady);
        }
      }
    }
  }

  /**
   * One pass over the building list per rescan. A superweapon is available when
   * the player owns a finished, powered structure whose catalog key appears in
   * the weapon's fallback chain — first match wins, so a real Nuclear Silo
   * supersedes the Proving Ground stand-in the moment one exists.
   */
  rescanAvailability(): void {
    const w = this.world;
    const st = w.store;
    const svc = production();
    this.available.fill(0);
    this.structureId.fill(NONE as number);

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
        // First one found wins. A second silo is a spare, not a second charge.
        if (this.structureId[owner * SUPERWEAPON_COUNT + s] === (NONE as number)) {
          this.structureId[owner * SUPERWEAPON_COUNT + s] = st.handleOf(i) as number;
        }
      }
    }
  }

  /**
   * Take every fire order standing on a superweapon structure and fire it.
   *
   * This is the ONLY route a player or an AI reaches `fireAt` by, and the whole
   * point of it is the bus: `Hud`/`handlePointer` issue an ordinary
   * `CommandKind.Order`, `input/Commands.ts` writes it onto the structure at
   * Phase.Command having already refused anything the issuer does not own, and
   * this reads it back one phase later. Nothing about a superweapon reaches the
   * simulation off a click handler.
   *
   * The order is cleared whether or not it fired — same rule as
   * `sim/Abilities.ts`: a refusal that left it set would re-fire the instant the
   * charge completed, which is not what the player pressed.
   */
  private consumeOrders(): void {
    const st = this.world.store;
    const svc = production();
    const list = st.byKind[EntityKind.Building];
    const count = st.byKindCount[EntityKind.Building];

    for (let a = 0; a < count; a++) {
      const i = list[a];
      if (st.orderKind[i] !== OrderKind.UseAbility) continue;
      // THE ORDER'S TARGET IS THE STAGE FLAG, and it is read before it is
      // cleared. `NONE` means "this click is a Displacement Ring's SOURCE"; the
      // structure's own id means "commit". The alternative was for the service
      // to alternate on its own staging state and for the cursor to reset it,
      // which is simulation state written from a DOM event — see `fireAt`.
      const stage = st.orderTarget[i] === (NONE as number);
      st.orderKind[i] = OrderKind.None;
      st.orderTarget[i] = 0;
      // `input/Commands.ts#write` falls through to `state = Idle` for an order
      // it has no case for, which is wrong for a structure still going up.
      // Put it back rather than leave a half-built silo claiming to be idle.
      if ((st.flags[i] & EntityFlag.UnderConstruction) !== 0) {
        st.state[i] = UnitState.UnderConstruction;
        continue;
      }
      const key = svc?.entryOf(st.handleOf(i))?.key;
      if (key === undefined) continue;
      for (let s = 0; s < SUPERWEAPON_COUNT; s++) {
        if (SUPERWEAPONS[s].structureKeys.indexOf(key) < 0) continue;
        this.fireAt(st.owner[i] as PlayerId, SUPERWEAPONS[s].key, st.orderX[i], st.orderZ[i], stage);
        break;
      }
    }
  }

  /**
   * Put a fire order on the bus. Presentation calls THIS; nothing calls
   * `fireAt` from outside a sim tick.
   *
   * False means there was nothing to address the command to — no gating
   * structure, or a weapon this player cannot field. It is deliberately NOT a
   * readiness check: the charge is the simulation's business and re-testing it
   * here would be a second copy of a rule that has to live in one place.
   *
   * `stage` rides on the order's TARGET: `NONE` for a Displacement Ring's source
   * click, the structure's own id to commit. See `consumeOrders`.
   */
  issueFire(player: PlayerId, key: string, x: number, z: number, stage = false): boolean {
    const structure = this.structureFor(player, key);
    if (structure === NONE) return false;
    this.fireScratch[0] = structure as number;
    this.channels.commands.issueOrder(
      player, OrderKind.UseAbility, this.fireScratch, 1,
      clampWorld(x, 1), clampWorld(z, 1), stage ? NONE : structure,
    );
    return true;
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

      switch (def.effect) {
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

      const effect = SUPERWEAPONS[k.sw].effect;

      if (k.delay > 0) {
        k.delay -= s.dt;
        if (effect === SuperweaponId.Nuke) this.nukeWarningBeat(k, s);
        if (k.delay > 0) continue;
      }

      if (!k.detonated) {
        k.detonated = true;
        switch (effect) {
          case SuperweaponId.Nuke: this.detonateNuke(k); break;
          case SuperweaponId.IronCurtain: this.applyCurtain(k); break;
          case SuperweaponId.Chronosphere: this.applyChrono(k, s); break;
          default: break;
        }
        this.stats.strikesResolved++;
      }

      if (k.life <= 0) { k.active = false; continue; }

      k.life -= s.dt;
      if (effect === SuperweaponId.LightningStorm) this.stormBeat(k, s);
      if (k.life <= 0) k.active = false;
    }
  }

  /* ======================================================================
   * 4d. THE FOUR EFFECTS
   * ====================================================================== */

  private announceNuke(k: Strike): void {
    const y = this.world.terrain.heightAt(k.x, k.z);
    const tint = SUPERWEAPONS[k.sw].faction;
    // A marker beam standing on the target for three and a half seconds is the
    // warning. It is deliberately visible to BOTH sides.
    this.channels.fx.push(FxKind.PrismBeam, k.x, y + 18, k.z, 0, -1, 0, 2.2, NONE, tint);
    this.world.vfx.decal(DecalKind.Scorch, k.x, k.z, 0, 6);
  }

  private nukeWarningBeat(k: Strike, s: SimContext): void {
    k.beat -= s.dt;
    if (k.beat > 0) return;
    k.beat = 0.5;
    const y = this.world.terrain.heightAt(k.x, k.z);
    this.channels.fx.push(
      FxKind.Sparks, k.x, y + 1.0, k.z, 0, 1, 0, 1.6, NONE, SUPERWEAPONS[k.sw].faction,
    );
  }

  private detonateNuke(k: Strike): void {
    const w = this.world;
    // THE ROW THAT FIRED, not `SUPERWEAPONS[SuperweaponId.Nuke]`. The Solar
    // Lance runs this effect at its own 24 m and in its own colours; reading
    // the nuke's row here would give the Pact a Soviet-red blast at 26 m.
    const def = SUPERWEAPONS[k.sw];
    const tint = def.faction;
    const y = w.terrain.heightAt(k.x, k.z);

    this.channels.damage.push(
      NONE, NONE, SUPERWEAPON_FX.nukeDamage, WarheadClass.HighExplosive,
      k.x, y + 2, k.z, def.radius, SUPERWEAPON_FX.nukeSplashFalloff,
    );

    this.channels.fx.push(FxKind.ExplosionLarge, k.x, y + 6, k.z, 0, 1, 0, 6, NONE, tint);
    this.channels.fx.push(FxKind.SmokePlumeLarge, k.x, y + 14, k.z, 0, 1, 0, 8, NONE, tint);
    this.channels.fx.push(FxKind.Debris, k.x, y + 3, k.z, 0, 1, 0, 5, NONE, tint);
    // A ring of secondaries: one blast sprite at this scale reads as a bug,
    // eight reads as a mushroom cloud sitting on a burning circle.
    for (let a = 0; a < 8; a++) {
      const ang = (a / 8) * Math.PI * 2;
      const rx = k.x + Math.sin(ang) * def.radius * 0.6;
      const rz = k.z + Math.cos(ang) * def.radius * 0.6;
      this.channels.fx.push(
        FxKind.ExplosionMedium, rx, w.terrain.heightAt(rx, rz) + 1.5, rz,
        0, 1, 0, 2.4, NONE, tint,
      );
    }
    w.vfx.decal(DecalKind.Crater, k.x, k.z, 0, def.radius * 1.4);
    w.vfx.shake(SUPERWEAPON_FX.nukeShake);
    w.audio.play(FxKind.ExplosionLarge, k.x, k.z, 1);
  }

  private applyCurtain(k: Strike): void {
    const w = this.world;
    const st = w.store;
    const def = SUPERWEAPONS[k.sw];
    const tint = def.faction;
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
    this.channels.fx.push(FxKind.TeslaArc, k.x, y + 3, k.z, 0, 1, 0, 3.2, NONE, tint);
    this.channels.fx.push(FxKind.Sparks, k.x, y + 1.5, k.z, 0, 1, 0, 2.6, NONE, tint);
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
    const def = SUPERWEAPONS[k.sw];
    const tint = def.faction;
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

      // Displacement writes the destination directly, outside the pathing
      // pipeline. Reject only this arrival slot when the unit's own movement
      // class cannot occupy it; amphibious hovercraft, ships and aircraft keep
      // their distinct rules through `canRelocateTo`.
      if (!canRelocateTo(w, e, nx, nz)) continue;

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
    this.channels.fx.push(FxKind.PrismBeam, k.sx, sy + 8, k.sz, 0, -1, 0, 3, NONE, tint);
    this.channels.fx.push(FxKind.PrismBeam, k.x, dy + 8, k.z, 0, -1, 0, 3, NONE, tint);
    w.vfx.shake(0.2);
    void s;
  }

  private stormBeat(k: Strike, s: SimContext): void {
    k.beat -= s.dt;
    if (k.beat > 0) return;
    k.beat = SUPERWEAPON_FX.stormBoltSeconds;

    const w = this.world;
    const def = SUPERWEAPONS[k.sw];
    const tint = def.faction;
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
    this.channels.fx.push(FxKind.TeslaArc, bx, by + 14, bz, 0, -1, 0, 3.4, NONE, tint);
    this.channels.fx.push(FxKind.ExplosionSmall, bx, by + 0.8, bz, 0, 1, 0, 1.5, NONE, tint);
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
   * without it, `arm()` is a no-op and there is no way to aim at all — which is
   * the correct headless answer, because there is no cursor either. The listener
   * is only installed WHILE a weapon is armed, so this can never interfere with
   * normal selection and ordering.
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
   * Displacement Ring, stages then fires). Returns false when the weapon is not
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
    this.pairClicks = 0;
    this.attachListeners();
    this.host.onArmedChanged?.(SUPERWEAPONS[s].key, 0, 0);
    return true;
  }

  /**
   * Leave targeting mode without firing.
   *
   * IT TOUCHES NO SIMULATION STATE. It used to clear `stagedSw`, which is two
   * bugs in one line: writing sim state from a DOM event is a lockstep
   * divergence, and it raced the very command the click had just issued (see
   * `fireAt`). An abandoned Displacement Ring source is harmless because the next
   * source click carries `stage` and overwrites it.
   */
  cancelArm(): void {
    if (this.armed < 0) return;
    this.armed = -1;
    this.pairClicks = 0;
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

  /**
   * A click on the ground while armed.
   *
   * It ISSUES A COMMAND and nothing else. It does not fire, it does not spend
   * the charge, and it does not read a result — all three happen a phase later
   * in `consumeOrders`, on a tick, on every machine in a lockstep match.
   *
   * `pairClicks` is the one piece of state that stays here, because it is the
   * CURSOR's business rather than the simulation's: after the first click of a
   * Displacement Ring the reticle has to stay up for the second. The sim keeps its
   * own staging in `stagedSw` and the two agree because they count the same
   * clicks; if they ever disagreed the sim's copy is the one that fires.
   */
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

    const def = SUPERWEAPONS[this.armed];
    const x = this.groundScratch[0];
    const z = this.groundScratch[1];
    const staging = def.targetMode === 'pointPair' && this.pairClicks === 0;
    if (!this.issueFire(this.armedPlayer, def.key, x, z, staging)) {
      this.cancelArm();
      return;
    }

    if (staging) {
      this.pairClicks = 1;
      this.host.onArmedChanged?.(def.key, x, z);
      return;
    }
    this.cancelArm();
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
