/**
 * ============================================================================
 * RED ALERT — src/sim/Damage.ts
 * ============================================================================
 * THE ARMOUR MATRIX, SPLASH, DEATH, AND EVERYTHING THAT OUTLIVES IT.
 *
 * Damage is never applied inline. Weapons and projectiles PUSH into
 * `channels.damage`; this file is the single place that drains that queue and
 * mutates `hp`. That is what guarantees no system in phases 100..1300 can ever
 * observe a half-dead entity, and it is why `targetId` can be trusted for a
 * whole tick.
 *
 * TWO ENTRY POINTS, TWO PHASES
 * ----------------------------
 *   `damageTick()`   Phase.Damage (1200) — burn DoT, drain the queue through
 *                    the 7x6 matrix, resolve splash, promote veterans, mark
 *                    the dead.
 *   `cleanupTick()`  Phase.Cleanup (1400) — emit `entity:killed` for EVERY
 *                    death this tick (whoever caused it), build the wreck, run
 *                    the structure cook-off, age hulks out, then
 *                    `flushDestroyed()`.
 *
 * The split matters: death effects need to read the corpse's position, owner
 * and def, and those are only readable between `markDead()` and
 * `flushDestroyed()`. Doing the work inside `flushDestroyed`'s own callback
 * would mean allocating entities while the store is mid-swap-remove.
 *
 * SPLASH IS NOT "EVERYTHING IN A CIRCLE"
 * --------------------------------------
 * It is `queryCircleFat`, which includes each victim's own radius, so a
 * Construction Yard whose CENTRE is 20 m from a shell still eats the blast that
 * lands against its wall. Falloff is `pow(1 - d/r, splashExponent)` remapped
 * into [splashFalloff, 1] so a weapon's own `splashFalloff` still means "damage
 * at the rim".
 *
 * DETERMINISM: no wall clock, no Math.random. Splash victim ORDER comes from
 * the spatial index, which is rebuilt by a counting sort from the dense alive
 * list, so it is stable for a given world state.
 * ============================================================================
 */

import {
  ARMOR_MATRIX, COMBAT_DAMAGE, MAX_PLAYERS, MAX_QUERY_RESULTS,
  BURN_DPS, BURN_HP_THRESHOLD, SMOKE_HP_THRESHOLD,
  UNDER_ATTACK_COOLDOWN, VETERANCY_DAMAGE, VETERANCY_HP, VETERANCY_KILLS,
  CELL, WATER_LEVEL,
} from '../core/config';
import {
  ArmorClass, DecalKind, EntityFlag, EntityKind, EvaLine, Faction, FxKind, NONE,
  UnitState, WarheadClass,
} from '../core/types';
import type {
  EntityId, PlayerId, SimContext,
} from '../core/types';
import type { World } from '../core/world';
import type { Channels } from '../core/events';
import { PerEntityF32, PerEntityU32 } from '../core/world';
import { clamp, clamp01 } from '../core/math';

/* ==========================================================================
 * 1. THE MATRIX
 * ========================================================================== */

/**
 * Live matrix. Starts as the authored table in config.ts and is replaced
 * wholesale when a real `DefTables` lands.
 */
let matrix: readonly (readonly number[])[] = ARMOR_MATRIX;

/**
 * Install a content-authored armour matrix. Silently ignores a table that is
 * not 7 x 6 — a half-sized matrix would read `undefined` as a multiplier and
 * turn every shot into NaN, which is far worse than the wrong balance.
 */
export function setArmorMatrix(m: readonly (readonly number[])[]): boolean {
  if (m.length !== 7) return false;
  for (let i = 0; i < 7; i++) if (m[i].length !== 6) return false;
  matrix = m;
  return true;
}

/** The multiplier a warhead scores against an armour class. */
export function armorMultiplier(warhead: WarheadClass, armor: ArmorClass): number {
  const row = matrix[warhead as number];
  if (row === undefined) return 1;
  const v = row[armor as number];
  return v === undefined ? 1 : v;
}

/** Damage multiplier for a veterancy rank (0 rookie, 1 veteran, 2 elite). */
export function veterancyDamageMul(rank: number): number {
  return VETERANCY_DAMAGE[rank < 0 ? 0 : rank > 2 ? 2 : rank];
}

/* ==========================================================================
 * 2. SHARED GEOMETRY HELPERS
 *
 * Projectiles and Weapons both need "how tall is that thing" and "how wide is
 * its hit disc". There is no height column in the EntityStore (models own
 * height, and the sim must not import the render layer), so both are DERIVED
 * from the collision radius / footprint. One derivation, used everywhere, so a
 * shell that clears a tank in the swept test also clears it when aiming.
 * ========================================================================== */

/** Estimated world height in metres of the entity in slot `i`. */
export function estimatedHeight(
  footprintW: number, radius: number, kind: EntityKind,
): number {
  if (footprintW > 0) return footprintW * CELL * COMBAT_DAMAGE_HEIGHT.buildingMul;
  if (kind === EntityKind.Infantry) return 2.2;
  return radius * COMBAT_DAMAGE_HEIGHT.unitMul;
}

/** Horizontal hit radius: buildings use their footprint half-diagonal. */
export function hitRadius(footprintW: number, footprintH: number, radius: number): number {
  if (footprintW > 0) {
    const halfW = footprintW * CELL * 0.5;
    const halfH = footprintH * CELL * 0.5;
    // Half-diagonal, so a corner shot still connects with a rectangular base.
    return Math.sqrt(halfW * halfW + halfH * halfH);
  }
  return radius;
}

/** Height derivation constants, kept next to their one consumer. */
const COMBAT_DAMAGE_HEIGHT = { buildingMul: 1.15, unitMul: 1.7 } as const;

/**
 * Metres the splash CANDIDATE query is widened by. Half-diagonal of the widest
 * structure we build (a 4x4 footprint at CELL=4 reaches 11.3 m), so no blast
 * can miss a building whose `radius` column under-reports its real extent.
 */
const SPLASH_QUERY_PAD = 12;

/* ==========================================================================
 * 3. THE DAMAGE SYSTEM
 * ========================================================================== */

/** One entry in the delayed-FX ring: a cook-off blast waiting for its moment. */
const FX_RING = COMBAT_DAMAGE.scheduledFxCapacity;

export interface DamageStats {
  /** Damage records drained this tick. */
  applied: number;
  /** Entities killed this tick. */
  kills: number;
  /** Live wrecks. */
  wrecks: number;
  /** Total damage dealt since boot. */
  totalDamage: number;
}

export class DamageSystem {
  /** Scratch for splash queries. Owned, never the world's shared buffer — a
   *  splash resolution runs inside a loop that itself came from a query. */
  private readonly splashScratch = new Int32Array(MAX_QUERY_RESULTS);

  /** Seconds of sim time when each player last heard "base under attack". */
  private readonly lastUnderAttack = new Float32Array(MAX_PLAYERS).fill(-1e9);

  /** Tick on which a slot's death was already turned into events + wreckage. */
  private readonly deathProcessed: PerEntityU32;
  /** Seconds a wreck has existed. */
  private readonly wreckAge: PerEntityF32;
  /** Sim time of the last smoke puff, per burning entity. */
  private readonly lastSmoke: PerEntityF32;

  /* -- delayed FX ring (structure cook-off) ------------------------------- */
  private readonly fxTime = new Float32Array(FX_RING);
  private readonly fxKind = new Uint8Array(FX_RING);
  private readonly fxX = new Float32Array(FX_RING);
  private readonly fxY = new Float32Array(FX_RING);
  private readonly fxZ = new Float32Array(FX_RING);
  private readonly fxScale = new Float32Array(FX_RING);
  private readonly fxFaction = new Uint8Array(FX_RING);
  private readonly fxLive = new Uint8Array(FX_RING);
  private fxCursor = 0;

  readonly stats: DamageStats = { applied: 0, kills: 0, wrecks: 0, totalDamage: 0 };

  constructor(
    private readonly world: World,
    private readonly channels: Channels,
  ) {
    this.deathProcessed = new PerEntityU32(world.store, 0);
    this.wreckAge = new PerEntityF32(world.store, 0);
    this.lastSmoke = new PerEntityF32(world.store, -1e9);
  }

  /* ======================================================================
   * PHASE.DAMAGE
   * ====================================================================== */

  /**
   * Burn damage-over-time, then the whole queue through the matrix.
   *
   * Burn is pushed BEFORE the drain so it lands in the same tick — the loop
   * clears the queue after every sim step, so anything pushed at Phase.Damage
   * after the drain would simply be discarded.
   */
  damageTick(s: SimContext): void {
    this.pushBurnDamage(s);
    this.drain(s);
    this.emitDamageSmoke(s);
    this.flushScheduledFx(s);
  }

  /** Fire damage on anything flagged Burning. */
  private pushBurnDamage(s: SimContext): void {
    const st = this.world.store;
    const q = this.channels.damage;
    const n = st.aliveCount;
    const dmg = BURN_DPS * s.dt;
    for (let a = 0; a < n; a++) {
      const i = st.alive[a];
      const f = st.flags[i];
      if ((f & EntityFlag.Burning) === 0) continue;
      if ((f & EntityFlag.PendingDestroy) !== 0) continue;
      // A wreck burns for show, not for damage — it is already dead, and
      // ticking it down would just churn the damage queue for 26 seconds.
      if (st.kind[i] === EntityKind.Wreck) continue;
      q.push(
        st.handleOf(i), NONE, dmg, WarheadClass.HighExplosive,
        st.posX[i], st.posY[i], st.posZ[i], 0, 0,
      );
    }
  }

  /** Drain every queued record. */
  private drain(s: SimContext): void {
    const q = this.channels.damage;
    const n = q.count;
    this.stats.applied = n;
    for (let r = 0; r < n; r++) {
      const splash = q.splashRadius[r];
      const attacker = q.attacker[r] as EntityId;
      const warhead = q.warhead[r] as WarheadClass;
      if (splash > 0) {
        this.applySplash(
          s, q.x[r], q.y[r], q.z[r], splash, q.splashFalloff[r],
          q.amount[r], warhead, attacker,
        );
      } else {
        const idx = this.world.store.index(q.target[r] as EntityId);
        if (idx < 0) continue;
        this.applyOne(s, idx, attacker, q.amount[r], warhead, 1);
      }
    }
    q.clear();
  }

  /**
   * Resolve one splash event. `queryCircleFat` is the correct query: it
   * includes each candidate's own radius, so a blast that lands against a
   * building's wall damages the building even though its centre is far away.
   */
  private applySplash(
    s: SimContext,
    x: number, y: number, z: number,
    radius: number, rimFalloff: number,
    amount: number, warhead: WarheadClass, attacker: EntityId,
  ): void {
    const w = this.world;
    const st = w.store;
    const out = this.splashScratch;
    // `queryCircleFat` accepts a candidate when `dist <= r + entityRadius`, and
    // a structure's `radius` column is its collision disc, not its footprint —
    // a 3x3 Construction Yard reaches 8.5 m from its centre but may only carry
    // radius 3. Widen the query by the largest plausible half-diagonal and let
    // the precise `hitRadius` test below do the actual accepting.
    const count = w.spatial.queryCircleFat(x, z, radius + SPLASH_QUERY_PAD, out);
    const attackerIdx = st.index(attacker);
    const attackerPlayer = attackerIdx >= 0 ? (st.owner[attackerIdx] as PlayerId) : -1 as PlayerId;
    const invR = radius > 0 ? 1 / radius : 0;
    const rim = clamp01(rimFalloff);
    let victims = 0;

    for (let c = 0; c < count; c++) {
      if (victims >= COMBAT_DAMAGE.maxSplashVictims) break;
      const i = out[c];
      const f = st.flags[i];
      if ((f & EntityFlag.Alive) === 0) continue;
      if ((f & EntityFlag.PendingDestroy) !== 0) continue;
      if ((f & EntityFlag.Garrisoned) !== 0) continue;

      // Surface distance: the blast reaches the hull, not the origin point.
      const dx = st.posX[i] - x, dz = st.posZ[i] - z;
      const surface = Math.max(0, Math.sqrt(dx * dx + dz * dz) - hitRadius(
        st.footprintW[i], st.footprintH[i], st.radius[i],
      ));
      if (surface >= radius) continue;
      victims++;
      const t = clamp01(1 - surface * invR);
      // pow(t, exponent) concentrates the damage near the crater. Remapped into
      // [rim, 1] so a weapon author's `splashFalloff` still means what it says.
      const falloff = rim + (1 - rim) * Math.pow(t, COMBAT_DAMAGE.splashExponent);
      if (falloff <= 0.001) continue;

      let scale = falloff;
      // Friendly fire is REAL — that is the whole reason artillery has a
      // minimum range and infantry scatter — but it is halved so a stray
      // rocket does not delete your own push.
      if (attackerPlayer >= 0) {
        const victimPlayer = st.owner[i] as PlayerId;
        if (w.areAllied(attackerPlayer, victimPlayer)) scale *= COMBAT_DAMAGE.friendlyFireMul;
      }
      this.applyOne(s, i, attacker, amount * scale, warhead, falloff);
    }

    // The crater itself, once, regardless of how many victims it found.
    if (amount >= COMBAT_DAMAGE.scorchMinDamage) {
      w.vfx.decal(DecalKind.Scorch, x, z, (st.seed[Math.max(0, attackerIdx)] ?? 0) * 6.283, radius * COMBAT_DAMAGE.scorchSizeMul);
    }
  }

  /**
   * The ONLY function in the game that writes `hp`.
   *
   * `amount` arrives already scaled by the attacker's veterancy (applied at
   * fire time, because the attacker may be dead by the time a shell lands) and
   * by splash falloff. What happens here is the armour matrix, the flags, the
   * events and — when hp crosses zero — the kill.
   */
  private applyOne(
    s: SimContext,
    i: number, attacker: EntityId, amount: number, warhead: WarheadClass,
    intensity: number,
  ): void {
    const w = this.world;
    const st = w.store;
    const f = st.flags[i];
    if ((f & EntityFlag.Alive) === 0 || (f & EntityFlag.PendingDestroy) !== 0) return;
    // A structure still rising cannot be shot down out from under its owner —
    // it has no HP curve yet and would die to a single stray splash.
    if ((f & EntityFlag.UnderConstruction) !== 0 && st.kind[i] === EntityKind.Building) return;

    const mult = armorMultiplier(warhead, st.armorClass[i] as ArmorClass);
    const dealt = amount * mult;
    if (!(dealt > 0)) return;

    const hpBefore = st.hp[i];
    const hp = hpBefore - dealt;
    st.hp[i] = hp;
    st.lastHitTime[i] = s.time;
    if (attacker !== NONE) st.lastAttackerId[i] = attacker as number;
    this.stats.totalDamage += dealt;

    const maxHp = st.maxHp[i] > 0 ? st.maxHp[i] : 1;
    const frac = hp / maxHp;

    // Burning is a FLAG, not a timer: it is recomputed from health every hit,
    // so a repaired unit stops burning without anyone having to remember.
    if (frac <= BURN_HP_THRESHOLD && hp > 0) st.flags[i] |= EntityFlag.Burning;

    const victimPlayer = st.owner[i] as PlayerId;
    const attackerIdx = st.index(attacker);
    const attackerPlayer = attackerIdx >= 0 ? (st.owner[attackerIdx] as PlayerId) : victimPlayer;

    const ev = this.channels.events.payload('entity:damaged');
    ev.id = st.handleOf(i);
    ev.player = victimPlayer;
    ev.attacker = attacker;
    ev.attackerPlayer = attackerPlayer;
    ev.amount = dealt;
    ev.hpAfter = hp;
    ev.hpFrac = frac;
    ev.warhead = warhead;
    ev.x = st.posX[i];
    ev.z = st.posZ[i];
    this.channels.events.emitPooled('entity:damaged');

    // "Base under attack", throttled per player. Only real hostiles count —
    // your own artillery clipping your own tank is not an invasion.
    if (attackerIdx >= 0 && !w.areAllied(attackerPlayer, victimPlayer)) {
      if (s.time - this.lastUnderAttack[victimPlayer as number] > UNDER_ATTACK_COOLDOWN) {
        this.lastUnderAttack[victimPlayer as number] = s.time;
        const ua = this.channels.events.payload('combat:underAttack');
        ua.player = victimPlayer;
        ua.x = st.posX[i];
        ua.z = st.posZ[i];
        ua.isBuilding = st.kind[i] === EntityKind.Building;
        this.channels.events.emitPooled('combat:underAttack');
        w.audio.eva(
          victimPlayer,
          (st.flags[i] & EntityFlag.IsHarvester) !== 0
            ? EvaLine.OreMinerUnderAttack
            : EvaLine.BaseUnderAttack,
        );
      }
    }

    // Impact FX. Scaled by how hard the hit landed so a grazing splash does not
    // throw the same shower of sparks as a direct AP round.
    this.pushImpactFx(i, warhead, intensity);

    if (hp <= 0) this.kill(i, attacker);
  }

  /** Armour-impact sparks / dirt / concrete chips. Bible 8.5. */
  private pushImpactFx(i: number, warhead: WarheadClass, intensity: number): void {
    const st = this.world.store;
    const armor = st.armorClass[i] as ArmorClass;
    let kind: FxKind;
    if (armor === ArmorClass.Concrete) kind = FxKind.ImpactConcrete;
    else if (armor === ArmorClass.Infantry) kind = FxKind.ImpactDirt;
    else kind = FxKind.ImpactMetal;
    const h = estimatedHeight(st.footprintW[i], st.radius[i], st.kind[i] as EntityKind);
    this.channels.fx.push(
      kind,
      st.posX[i], st.posY[i] + h * 0.5, st.posZ[i],
      0, 1, 0,
      clamp(0.5 + intensity, 0.5, 1.6),
      st.handleOf(i),
      st.faction[i] as Faction,
    );
    if (warhead === WarheadClass.Tesla) {
      this.channels.fx.push(
        FxKind.Sparks, st.posX[i], st.posY[i] + h * 0.6, st.posZ[i],
        0, 1, 0, 1.2, st.handleOf(i), st.faction[i] as Faction,
      );
    }
  }

  /* ======================================================================
   * KILLING
   * ====================================================================== */

  /** Mark dead and give the killer credit. Effects happen at Cleanup. */
  private kill(i: number, attacker: EntityId): void {
    const w = this.world;
    const st = w.store;
    const handle = st.handleOf(i);
    if (!st.markDead(handle)) return;
    st.hp[i] = 0;
    this.stats.kills++;

    const attackerIdx = st.index(attacker);
    if (attackerIdx < 0) return;
    const attackerPlayer = st.owner[attackerIdx] as PlayerId;
    const victimPlayer = st.owner[i] as PlayerId;
    if (w.areAllied(attackerPlayer, victimPlayer)) return;

    // Kill credit and promotion. Veterancy is stored as a rank in `veterancy`
    // AND as two flags, because the flags are what the render bridge and the
    // selection HUD can test for free.
    const kills = st.killCount[attackerIdx] + 1;
    st.killCount[attackerIdx] = kills;
    let rank = st.veterancy[attackerIdx];
    let promoted = false;
    while (rank < 2 && kills >= VETERANCY_KILLS[rank]) { rank++; promoted = true; }
    if (promoted) {
      st.veterancy[attackerIdx] = rank;
      st.flags[attackerIdx] |= rank >= 1 ? EntityFlag.Veteran1 : 0;
      st.flags[attackerIdx] |= rank >= 2 ? EntityFlag.Veteran2 : 0;
      // Promotion RAISES max HP and heals by exactly the amount gained, so a
      // promotion is never a free full heal and never a stealth nerf.
      const oldMax = st.maxHp[attackerIdx];
      const base = oldMax / VETERANCY_HP[rank - 1];
      const newMax = base * VETERANCY_HP[rank];
      st.maxHp[attackerIdx] = newMax;
      st.hp[attackerIdx] = Math.min(newMax, st.hp[attackerIdx] + (newMax - oldMax));

      const vev = this.channels.events.payload('entity:veterancy');
      vev.id = st.handleOf(attackerIdx);
      vev.player = attackerPlayer;
      vev.rank = rank;
      this.channels.events.emitPooled('entity:veterancy');
      this.channels.fx.push(
        FxKind.BuildComplete,
        st.posX[attackerIdx], st.posY[attackerIdx] + 2.4, st.posZ[attackerIdx],
        0, 1, 0, 1, st.handleOf(attackerIdx), st.faction[attackerIdx] as Faction,
      );
    }
  }

  /* ======================================================================
   * PHASE.CLEANUP
   * ====================================================================== */

  /**
   * Turn every death this tick into events, explosions and wreckage, age the
   * existing hulks out, then actually free the slots.
   *
   * This scans the alive list rather than trusting a list built by `kill()`,
   * because entities also die by self-destruct, selling, crushing and map
   * scripting. One place handles all of them, so `entity:killed` is emitted
   * exactly once per death no matter the cause.
   */
  cleanupTick(s: SimContext): void {
    const st = this.world.store;
    // Age first: a hulk that times out this tick is then picked up by the same
    // death scan as everything else, so it gets its final smoke puff.
    this.ageWrecks(s);
    const n = st.aliveCount;
    const stamp = (s.tick + 1) >>> 0;
    for (let a = 0; a < n; a++) {
      const i = st.alive[a];
      if ((st.flags[i] & EntityFlag.PendingDestroy) === 0) continue;
      if (this.deathProcessed.getAt(i) !== 0) continue;
      this.deathProcessed.setAt(i, stamp);
      this.onDeath(s, i);
    }
    st.flushDestroyed();
  }

  /** Everything one corpse produces. */
  private onDeath(s: SimContext, i: number): void {
    const w = this.world;
    const st = w.store;
    const kind = st.kind[i] as EntityKind;
    const x = st.posX[i], y = st.posY[i], z = st.posZ[i];
    const player = st.owner[i] as PlayerId;
    const faction = st.faction[i] as Faction;
    const killer = st.lastAttackerId[i] as EntityId;
    const killerIdx = st.index(killer);
    const killerPlayer = killerIdx >= 0 ? (st.owner[killerIdx] as PlayerId) : player;

    // --- the event -------------------------------------------------------
    const ev = this.channels.events.payload('entity:killed');
    ev.id = st.handleOf(i);
    ev.kind = kind;
    ev.defId = st.defId[i];
    ev.player = player;
    ev.killer = killerIdx >= 0 ? killer : NONE;
    ev.killerPlayer = killerPlayer;
    ev.x = x;
    ev.z = z;
    // No def table here on purpose: the sim must not import content. maxHp is
    // a good proxy for build value and it is never wrong by an order of
    // magnitude. A data module can recompute the real figure from `defId`.
    ev.value = Math.round(st.maxHp[i] * 0.6);
    this.channels.events.emitPooled('entity:killed');

    // --- a sale is not a death -------------------------------------------
    // The economy module sells a structure by setting UnitState.Selling and
    // marking it dead. It still needs `entity:killed` (production, tech and
    // victory all listen), but it must NOT explode, must not leave a wreck, and
    // must not count as a loss or trip the "building lost" announcer.
    if (st.state[i] === UnitState.Selling) {
      this.channels.fx.push(FxKind.SellPuff, x, y + 1.5, z, 0, 1, 0, 1.4, NONE, faction);
      if (st.footprintW[i] > 0) {
        const scx = Math.round(x / CELL - st.footprintW[i] * 0.5);
        const scz = Math.round(z / CELL - st.footprintH[i] * 0.5);
        w.terrain.clearOccupied(scx, scz, st.footprintW[i], st.footprintH[i]);
      }
      return;
    }

    // --- player statistics ----------------------------------------------
    const victim = w.players[player as number];
    if (victim !== undefined) {
      if (kind === EntityKind.Building) victim.stats.buildingsLost++;
      else if (kind === EntityKind.Infantry || kind === EntityKind.Vehicle) victim.stats.unitsLost++;
    }
    const scorer = w.players[killerPlayer as number];
    if (scorer !== undefined && killerIdx >= 0 && !w.areAllied(killerPlayer, player)) {
      if (kind === EntityKind.Building) scorer.stats.buildingsKilled++;
      else if (kind === EntityKind.Infantry || kind === EntityKind.Vehicle) scorer.stats.unitsKilled++;
    }

    // --- the boom --------------------------------------------------------
    switch (kind) {
      case EntityKind.Building:
        this.buildingDeath(s, i, x, y, z, faction);
        w.audio.eva(player, EvaLine.BuildingLost);
        break;
      case EntityKind.Infantry:
        this.infantryDeath(x, y, z, faction, st.handleOf(i));
        w.audio.eva(player, EvaLine.UnitLost);
        break;
      case EntityKind.Vehicle:
        this.vehicleDeath(s, i, x, y, z, faction);
        w.audio.eva(player, EvaLine.UnitLost);
        break;
      case EntityKind.Wreck:
        // A hulk that timed out just stops smoking. No second explosion.
        this.channels.fx.push(FxKind.SmokePlumeSmall, x, y + 1, z, 0, 1, 0, 1, NONE, faction);
        break;
      case EntityKind.Crate:
        // A crate is collected, not destroyed.
        this.channels.fx.push(FxKind.Sparks, x, y + 0.8, z, 0, 1, 0, 1.0, NONE, faction);
        break;
      default:
        // Props: a splinter shower and a puff, nothing more.
        this.channels.fx.push(FxKind.Debris, x, y + 0.6, z, 0, 1, 0, 0.8, NONE, faction);
        this.channels.fx.push(FxKind.DustPuff, x, y + 0.3, z, 0, 1, 0, 1.0, NONE, faction);
        break;
    }
  }

  /** Infantry: no wreck, no crater. A body, a puff, a stain. */
  private infantryDeath(x: number, y: number, z: number, faction: Faction, id: EntityId): void {
    this.channels.fx.push(FxKind.UnitDeathInfantry, x, y + 0.9, z, 0, 1, 0, 1, id, faction);
    this.channels.fx.push(FxKind.DustPuff, x, y + 0.2, z, 0, 1, 0, 0.7, NONE, faction);
  }

  /**
   * Vehicle: a 2.2 m fireball (bible 8.2), debris, a permanent scorch, and a
   * burning hulk that persists. The hulk is what turns a battlefield into a
   * PLACE — an empty field after a fight reads as a bug.
   */
  private vehicleDeath(
    s: SimContext, i: number, x: number, y: number, z: number, faction: Faction,
  ): void {
    const w = this.world;
    const st = w.store;
    const scale = COMBAT_DAMAGE.unitBlastMetres * clamp(st.radius[i] / 2.4, 0.7, 1.8);

    this.channels.fx.push(FxKind.ExplosionMedium, x, y + 1.0, z, 0, 1, 0, scale, NONE, faction);
    this.channels.fx.push(FxKind.Debris, x, y + 1.0, z, 0, 1, 0, scale * 0.8, NONE, faction);
    this.channels.fx.push(FxKind.SmokePlumeLarge, x, y + 1.4, z, 0, 1, 0, scale * 0.7, NONE, faction);
    w.vfx.decal(DecalKind.Scorch, x, z, st.seed[i] * 6.283185, scale * COMBAT_DAMAGE.scorchSizeMul);
    w.vfx.shake(clamp01(scale * COMBAT_DAMAGE.shakePerScale));
    w.audio.play(FxKind.ExplosionMedium, x, z, 1);

    // A hover craft or a ship dies at sea: it sinks, it does not leave a hulk
    // sitting on the waves. Ask the terrain, not the height — WATER_LEVEL is a
    // constant and the flat null-object terrain sits below it everywhere.
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    if (w.terrain.isWater(cx, cz)) {
      this.channels.fx.push(FxKind.Splash, x, Math.max(y, WATER_LEVEL), z, 0, 1, 0, scale, NONE, faction);
      return;
    }
    this.spawnWreck(s, i, x, y, z);
  }

  /**
   * Structure: a big flash, then a 3-5 s cook-off of smaller blasts, then
   * rubble. The cook-off is what sells the SIZE of the thing that just died.
   */
  private buildingDeath(
    s: SimContext, i: number, x: number, y: number, z: number, faction: Faction,
  ): void {
    const w = this.world;
    const st = w.store;
    const fw = st.footprintW[i] || 2;
    const fh = st.footprintH[i] || 2;
    const scale = COMBAT_DAMAGE.buildingBlastMetres * clamp(Math.sqrt(fw * fh) / 2.4, 0.7, 1.8);

    this.channels.fx.push(FxKind.ExplosionBuilding, x, y + 2.0, z, 0, 1, 0, scale, NONE, faction);
    this.channels.fx.push(FxKind.Debris, x, y + 2.0, z, 0, 1, 0, scale, NONE, faction);
    this.channels.fx.push(FxKind.SmokePlumeLarge, x, y + 2.4, z, 0, 1, 0, scale * 0.9, NONE, faction);
    w.vfx.shake(clamp01(scale * COMBAT_DAMAGE.shakePerScale));
    w.audio.play(FxKind.ExplosionBuilding, x, z, 1);

    // Cook-off: N smaller fireballs scattered over the footprint. Offsets come
    // from the entity seed, NOT from the RNG — a death must not consume sim
    // random state, or two replays that differ only in FX would desync.
    const seed = st.seed[i];
    const half = fw * CELL * 0.35;
    for (let k = 0; k < COMBAT_DAMAGE.cookOffCount; k++) {
      const a = (seed * 6.283185 + k * 2.399963);
      this.scheduleFx(
        s.time + COMBAT_DAMAGE.cookOffInterval * (k + 1),
        FxKind.ExplosionSmall,
        x + Math.cos(a) * half, y + 1.4 + (k & 1) * 1.2, z + Math.sin(a) * half,
        scale * COMBAT_DAMAGE.cookOffScale, faction,
      );
    }

    // Rubble + scorch over the whole footprint, permanently.
    w.vfx.decal(DecalKind.Rubble, x, z, 0, Math.max(fw, fh) * CELL * 0.95);
    w.vfx.decal(DecalKind.Scorch, x, z, seed * 6.283185, Math.max(fw, fh) * CELL * 0.8);
    // The nav grid must be released or the ruin blocks pathing forever.
    if (fw > 0) {
      const cx = Math.round(x / CELL - fw * 0.5);
      const cz = Math.round(z / CELL - fh * 0.5);
      w.terrain.clearOccupied(cx, cz, fw, fh);
    }
  }

  /** Build the burning hulk a dead vehicle leaves behind. */
  private spawnWreck(s: SimContext, i: number, x: number, y: number, z: number): void {
    const st = this.world.store;
    const h = st.alloc(
      EntityKind.Wreck, -1,
      st.owner[i] as PlayerId, st.faction[i] as Faction,
      x, y, z, st.yaw[i],
    );
    if (h === NONE) return;
    const j = st.index(h);
    if (j < 0) return;
    st.spawnTick[j] = s.tick;
    st.radius[j] = st.radius[i];
    st.maxHp[j] = 1;
    st.hp[j] = 1;
    st.armorClass[j] = ArmorClass.Wood;
    st.turretYaw[j] = st.turretYaw[i];
    st.prevTurretYaw[j] = st.turretYaw[i];
    st.hullPitch[j] = st.hullPitch[i];
    st.hullRoll[j] = st.hullRoll[i];
    // A hulk is scenery: never targeted, never selected, never in the way.
    st.flags[j] |= EntityFlag.NotATarget | EntityFlag.NotSelectable | EntityFlag.Burning;
    this.wreckAge.setAt(j, 0);
    this.stats.wrecks++;
  }

  /** Burn, smoke, then remove. */
  private ageWrecks(s: SimContext): void {
    const st = this.world.store;
    const list = st.byKind[EntityKind.Wreck];
    const n = st.byKindCount[EntityKind.Wreck];
    this.stats.wrecks = n;
    for (let a = 0; a < n; a++) {
      const i = list[a];
      if ((st.flags[i] & EntityFlag.PendingDestroy) !== 0) continue;
      const age = this.wreckAge.getAt(i) + s.dt;
      this.wreckAge.setAt(i, age);

      if (age > COMBAT_DAMAGE.wreckBurnSeconds) st.flags[i] &= ~EntityFlag.Burning;
      if (age >= COMBAT_DAMAGE.wreckSeconds) { st.markDead(st.handleOf(i)); continue; }

      if (s.time - this.lastSmoke.getAt(i) >= COMBAT_DAMAGE.wreckSmokeInterval) {
        this.lastSmoke.setAt(i, s.time);
        const burning = age <= COMBAT_DAMAGE.wreckBurnSeconds;
        this.channels.fx.push(
          burning ? FxKind.Embers : FxKind.SmokePlumeSmall,
          st.posX[i], st.posY[i] + 1.2, st.posZ[i],
          0, 1, 0,
          // The plume thins as the fire dies, so a battlefield ages visibly.
          clamp(1.2 - age / COMBAT_DAMAGE.wreckSeconds, 0.35, 1.2),
          st.handleOf(i), st.faction[i] as Faction,
        );
      }
    }
  }

  /**
   * Damage smoke on LIVING units (bible 8.8): a wisp below 65% health, a black
   * column below 32%. Throttled per entity so a 200-unit brawl does not fill
   * the 2048-slot FX queue with smoke and starve the muzzle flashes.
   */
  private emitDamageSmoke(s: SimContext): void {
    const st = this.world.store;
    const n = st.aliveCount;
    for (let a = 0; a < n; a++) {
      const i = st.alive[a];
      const f = st.flags[i];
      if ((f & EntityFlag.PendingDestroy) !== 0) continue;
      const kind = st.kind[i] as EntityKind;
      if (kind === EntityKind.Wreck || kind === EntityKind.Prop || kind === EntityKind.Crate) continue;
      const maxHp = st.maxHp[i];
      if (maxHp <= 0) continue;
      const frac = st.hp[i] / maxHp;
      if (frac >= SMOKE_HP_THRESHOLD) continue;
      if (s.time - this.lastSmoke.getAt(i) < COMBAT_DAMAGE.damageSmokeInterval) continue;
      this.lastSmoke.setAt(i, s.time);
      const heavy = frac <= BURN_HP_THRESHOLD;
      const h = estimatedHeight(st.footprintW[i], st.radius[i], kind);
      this.channels.fx.push(
        heavy ? FxKind.SmokePlumeLarge : FxKind.SmokePlumeSmall,
        st.posX[i], st.posY[i] + h * 0.8, st.posZ[i],
        0, 1, 0,
        heavy ? 1.1 : 0.6,
        st.handleOf(i), st.faction[i] as Faction,
      );
    }
  }

  /* -- delayed FX ring ---------------------------------------------------- */

  /** Queue an FX record for a future sim time. Oldest slot is overwritten. */
  private scheduleFx(
    time: number, kind: FxKind, x: number, y: number, z: number,
    scale: number, faction: Faction,
  ): void {
    const k = this.fxCursor;
    this.fxCursor = (k + 1) % FX_RING;
    this.fxTime[k] = time;
    this.fxKind[k] = kind;
    this.fxX[k] = x; this.fxY[k] = y; this.fxZ[k] = z;
    this.fxScale[k] = scale;
    this.fxFaction[k] = faction;
    this.fxLive[k] = 1;
  }

  /** Emit anything whose moment has arrived. */
  private flushScheduledFx(s: SimContext): void {
    for (let k = 0; k < FX_RING; k++) {
      if (this.fxLive[k] === 0) continue;
      if (this.fxTime[k] > s.time) continue;
      this.fxLive[k] = 0;
      this.channels.fx.push(
        this.fxKind[k] as FxKind,
        this.fxX[k], this.fxY[k], this.fxZ[k],
        0, 1, 0, this.fxScale[k], NONE, this.fxFaction[k] as Faction,
      );
      this.world.vfx.shake(clamp01(this.fxScale[k] * COMBAT_DAMAGE.shakePerScale * 0.6));
    }
  }

  /** Between matches. */
  reset(): void {
    this.lastUnderAttack.fill(-1e9);
    this.fxLive.fill(0);
    this.fxCursor = 0;
    this.stats.applied = 0;
    this.stats.kills = 0;
    this.stats.wrecks = 0;
    this.stats.totalDamage = 0;
  }
}
