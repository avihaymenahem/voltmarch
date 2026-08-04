/**
 * ============================================================================
 * src/sim/Crates.ts — MAP CRATES: THE REASON TO DRIVE SOMEWHERE ELSE
 * ============================================================================
 *
 * `EntityKind.Crate` existed, the render bridge drew it, eight systems
 * correctly refused to shoot at it, and nothing ever picked one up. It was
 * scenery. This turns it into the thing that makes an early scout worth
 * building.
 *
 * FIVE OUTCOMES, weighted:
 *
 *   Credits    — a cash drop, scaled by how long the match has run so a
 *                twelve-minute crate is not a rounding error.
 *   Heal       — the finder and every ally standing near it go to full HP.
 *   Promotion  — the finder gains a veterancy rank, with the exact max-HP
 *                rescale `Damage.ts` uses, and emits the same
 *                `'entity:veterancy'` event so the chevrons appear.
 *   Free unit  — a unit of the finder's faction walks out of the box.
 *   Dud        — it was ammunition. It goes off.
 *
 * DETERMINISM. Every roll, every spawn position and every respawn interval
 * comes from `s.rng`. Two machines running the same seed open the same crates
 * in the same order and get the same answers.
 *
 * SPAWNING. The service keeps `CRATES.maxOnMap` boxes alive, dropping a new one
 * every `CRATES.respawnSeconds` at a passable, unoccupied, dry cell. It counts
 * live crates by scanning `byKind[Crate]`, so crates a scenario placed by hand
 * are part of the budget and are picked up by exactly the same code.
 *
 * PHASE. `Phase.Movement` + a late order: pickups must test THIS tick's
 * positions, and consuming the crate before `Phase.SpatialRebuild` keeps the
 * index honest.
 * ============================================================================
 */

import type { Channels } from '../core/events';
import type { World } from '../core/world';
import {
  ArmorClass, CreditReason, EntityFlag, EntityKind, Faction, FACTION_PALETTE_KEYS,
  FxKind, Locomotor, NONE, UnitState, WarheadClass,
} from '../core/types';
import type { EntityId, PlayerId, SimContext } from '../core/types';
import { CELL, MAP_CELLS, VETERANCY_HP } from '../core/config';
import { clampWorld, isInMap } from '../core/math';

import { FALLBACK_PROPS, PROP_DEF_ID } from '../game/Scenarios';
import { production } from './Production';
import { getEconomy } from './Economy';

/* ==========================================================================
 * 1. TUNING
 * ========================================================================== */

export const CRATES = {
  /** Live crates the service tries to keep on the map. */
  maxOnMap: 6,
  /** Seconds between drops while below the cap. */
  respawnSeconds: 40,
  /** Seconds before the first drop, so a match does not open with a scramble. */
  firstDropSeconds: 25,
  /** Metres a unit's centre must come within to open one. */
  pickupRadius: 2.6,
  /** Credits award, before the match-length scale. */
  creditsMin: 300,
  creditsMax: 900,
  /** Credits award multiplier at `creditsRampSeconds` and beyond. */
  creditsRampMul: 2.5,
  creditsRampSeconds: 600,
  /** Metres around the finder that a heal crate reaches. */
  healRadius: 10,
  /** Dud damage as a fraction of the finder's max HP. */
  dudDamageFrac: 0.45,
  dudSplash: 5.0,
  /** Attempts to find a legal drop cell before giving up this interval. */
  placementTries: 32,
} as const;

/** What was in the box. The order is the roll order; see `WEIGHTS`. */
export const enum CrateReward {
  Credits = 0,
  Heal = 1,
  Promotion = 2,
  FreeUnit = 3,
  Dud = 4,
}
const REWARD_COUNT = 5;

/**
 * Roll weights. Credits dominate because a crate must never feel like a
 * punishment, and the dud is rare enough to be a story rather than a tax.
 */
const WEIGHTS: readonly number[] = [40, 20, 14, 18, 8];
const WEIGHT_TOTAL = WEIGHTS.reduce((a, b) => a + b, 0);

/** Free-unit table per faction, cheapest first. Resolved against the catalog. */
const FREE_UNITS: Readonly<Record<string, readonly string[]>> = {
  allies: ['grizzly', 'ifv', 'gi'],
  soviets: ['rhino', 'attackDog', 'conscript'],
  meridian: ['mrdSolarch', 'mrdSkiff', 'mrdWayfarer'],
  neutral: ['gi', 'conscript'],
};

/* ==========================================================================
 * 2. PUBLIC SHAPES
 * ========================================================================== */

export interface CrateStats {
  live: number;
  dropped: number;
  collected: number;
  /** Collections by reward, indexed by CrateReward. */
  byReward: Int32Array;
  creditsGranted: number;
}

/** One collection, for tests and for a HUD toast. */
export interface CratePickup {
  crate: EntityId;
  finder: EntityId;
  player: PlayerId;
  reward: CrateReward;
  /** Credits for Credits, HP for Heal, rank for Promotion, damage for Dud. */
  amount: number;
}

export type CrateListener = (pickup: Readonly<CratePickup>) => void;

/* ==========================================================================
 * 3. THE SERVICE
 * ========================================================================== */

export class CrateService {
  readonly stats: CrateStats = {
    live: 0, dropped: 0, collected: 0, byReward: new Int32Array(REWARD_COUNT), creditsGranted: 0,
  };

  private dropTimer: number = CRATES.firstDropSeconds;
  private readonly listeners: CrateListener[] = [];
  /** Pooled, because a listener must never cost an allocation per pickup. */
  private readonly pickup: CratePickup = {
    crate: NONE, finder: NONE, player: 0 as PlayerId, reward: CrateReward.Credits, amount: 0,
  };
  private readonly scratch = new Int32Array(64);

  constructor(
    private readonly world: World,
    private readonly channels: Channels,
  ) {}

  /** Subscribe to collections (HUD toast, tutorial, tests). */
  onPickup(fn: CrateListener): () => void {
    this.listeners.push(fn);
    return () => {
      const i = this.listeners.indexOf(fn);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  /* -- the tick ---------------------------------------------------------- */

  simTick(s: SimContext): void {
    const live = this.collect(s);
    this.stats.live = live;

    this.dropTimer -= s.dt;
    if (this.dropTimer > 0) return;
    this.dropTimer = CRATES.respawnSeconds;
    if (live >= CRATES.maxOnMap) return;
    this.dropCrate(s);
  }

  /* -- collection -------------------------------------------------------- */

  /** Walk every live crate; award the closest eligible unit. Returns live count. */
  private collect(s: SimContext): number {
    const w = this.world;
    const st = w.store;
    const list = st.byKind[EntityKind.Crate];
    const n = st.byKindCount[EntityKind.Crate];
    let live = 0;

    for (let a = 0; a < n; a++) {
      const c = list[a];
      const f = st.flags[c];
      if ((f & EntityFlag.Alive) === 0) continue;
      if ((f & EntityFlag.PendingDestroy) !== 0) continue;
      live++;

      const finder = this.finderNear(c);
      if (finder < 0) continue;
      this.award(s, c, finder);
      live--;
    }
    return live;
  }

  /**
   * The lowest-slot mobile unit overlapping the crate. Lowest slot, not
   * nearest: two units arriving on the same tick must resolve identically on
   * every machine, and slot order is the store's only total order.
   */
  private finderNear(c: number): number {
    const w = this.world;
    const st = w.store;
    const n = w.spatial.queryCircleFat(
      st.posX[c], st.posZ[c], CRATES.pickupRadius, this.scratch,
    );
    let best = -1;
    for (let k = 0; k < n; k++) {
      const i = this.scratch[k];
      if (i === c) continue;
      const f = st.flags[i];
      if ((f & EntityFlag.Alive) === 0) continue;
      if ((f & (EntityFlag.PendingDestroy | EntityFlag.Garrisoned)) !== 0) continue;
      if ((f & EntityFlag.CanMove) === 0) continue;
      const kind = st.kind[i];
      if (kind !== EntityKind.Infantry && kind !== EntityKind.Vehicle) continue;
      const p = w.players[st.owner[i]];
      if (p === undefined || p.faction === Faction.Neutral) continue;
      if (best < 0 || i < best) best = i;
    }
    return best;
  }

  /** Roll, apply, announce, and consume the box. */
  private award(s: SimContext, c: number, finder: number): void {
    const st = this.world.store;
    const player = st.owner[finder] as PlayerId;
    const reward = this.roll(s);
    let amount = 0;

    switch (reward) {
      case CrateReward.Credits: amount = this.giveCredits(s, player); break;
      case CrateReward.Heal: amount = this.giveHeal(finder); break;
      case CrateReward.Promotion: amount = this.givePromotion(finder); break;
      case CrateReward.FreeUnit: amount = this.giveFreeUnit(s, c, player); break;
      case CrateReward.Dud: amount = this.giveDud(c, finder); break;
      default: break;
    }

    this.stats.collected++;
    this.stats.byReward[reward]++;

    const pk = this.pickup;
    pk.crate = st.handleOf(c);
    pk.finder = st.handleOf(finder);
    pk.player = player;
    pk.reward = reward;
    pk.amount = amount;
    for (let i = 0; i < this.listeners.length; i++) this.listeners[i](pk);

    // The crate is COLLECTED, not destroyed: Damage.ts already gives
    // EntityKind.Crate a spark instead of a fireball on death.
    st.markDead(st.handleOf(c));
  }

  private roll(s: SimContext): CrateReward {
    let r = s.rng.next() * WEIGHT_TOTAL;
    for (let i = 0; i < REWARD_COUNT; i++) {
      r -= WEIGHTS[i];
      if (r < 0) return i as CrateReward;
    }
    return CrateReward.Credits;
  }

  /* -- the five rewards -------------------------------------------------- */

  private giveCredits(s: SimContext, player: PlayerId): number {
    const ramp = 1 + (CRATES.creditsRampMul - 1)
      * Math.min(1, this.world.time / CRATES.creditsRampSeconds);
    const base = s.rng.range(CRATES.creditsMin, CRATES.creditsMax);
    const amount = Math.round(base * ramp);
    const economy = getEconomy();
    if (economy !== null) economy.deposit(player, amount, CreditReason.Bounty);
    else {
      const p = this.world.players[player as number];
      if (p !== undefined) p.credits = Math.min(p.storageMax, p.credits + amount);
    }
    this.stats.creditsGranted += amount;
    return amount;
  }

  private giveHeal(finder: number): number {
    const w = this.world;
    const st = w.store;
    const owner = st.owner[finder] as PlayerId;
    const n = w.spatial.queryCircle(
      st.posX[finder], st.posZ[finder], CRATES.healRadius, this.scratch,
    );
    let restored = 0;
    for (let k = 0; k < n; k++) {
      const i = this.scratch[k];
      if ((st.flags[i] & EntityFlag.PendingDestroy) !== 0) continue;
      const kind = st.kind[i];
      if (kind !== EntityKind.Infantry && kind !== EntityKind.Vehicle) continue;
      if (!w.areAllied(owner, st.owner[i] as PlayerId)) continue;
      const gain = st.maxHp[i] - st.hp[i];
      if (gain <= 0) continue;
      st.hp[i] = st.maxHp[i];
      restored += gain;
      this.channels.fx.push(
        FxKind.RepairSpark, st.posX[i], st.posY[i] + 1.4, st.posZ[i],
        0, 1, 0, 1, st.handleOf(i), st.faction[i] as Faction,
      );
    }
    return restored;
  }

  /**
   * One rank, using the identical rescale `Damage.ts:443` applies on a kill
   * promotion: max HP goes up and the unit is healed by exactly the amount
   * gained, so a promotion is never a stealth full heal.
   */
  private givePromotion(finder: number): number {
    const st = this.world.store;
    const rank = st.veterancy[finder];
    if (rank >= 2) {
      st.hp[finder] = st.maxHp[finder];
      return rank;
    }
    const next = rank + 1;
    const oldMax = st.maxHp[finder];
    const base = oldMax / VETERANCY_HP[rank];
    const newMax = base * VETERANCY_HP[next];
    st.veterancy[finder] = next;
    st.flags[finder] |= EntityFlag.Veteran1;
    if (next >= 2) st.flags[finder] |= EntityFlag.Veteran2;
    st.maxHp[finder] = newMax;
    st.hp[finder] = Math.min(newMax, st.hp[finder] + (newMax - oldMax));

    const ev = this.channels.events.payload('entity:veterancy');
    ev.id = st.handleOf(finder);
    ev.player = st.owner[finder] as PlayerId;
    ev.rank = next;
    this.channels.events.emitPooled('entity:veterancy');
    this.channels.fx.push(
      FxKind.BuildComplete, st.posX[finder], st.posY[finder] + 2.4, st.posZ[finder],
      0, 1, 0, 1.2, st.handleOf(finder), st.faction[finder] as Faction,
    );
    return next;
  }

  private giveFreeUnit(s: SimContext, c: number, player: PlayerId): number {
    const svc = production();
    const p = this.world.players[player as number];
    if (svc === null || p === undefined) return 0;
    const keys = FREE_UNITS[factionKey(p.faction)] ?? FREE_UNITS.neutral;

    for (let k = 0; k < keys.length; k++) {
      const entry = svc.catalog.byKey(keys[k]);
      if (entry === null) continue;
      const st = this.world.store;
      const angle = s.rng.next() * Math.PI * 2;
      const id = svc.spawnUnit(
        p, entry,
        st.posX[c] + Math.sin(angle) * CELL,
        st.posZ[c] + Math.cos(angle) * CELL,
        angle,
      );
      if (id === NONE) continue;
      const i = st.index(id);
      if (i >= 0) st.state[i] = UnitState.Idle;
      this.channels.fx.push(
        FxKind.BuildComplete, st.posX[c], st.posY[c] + 1.2, st.posZ[c],
        0, 1, 0, 1.4, id, p.faction,
      );
      return entry.cost;
    }
    return 0;
  }

  private giveDud(c: number, finder: number): number {
    const st = this.world.store;
    const damage = st.maxHp[finder] * CRATES.dudDamageFrac;
    this.channels.damage.push(
      NONE, NONE, damage, WarheadClass.HighExplosive,
      st.posX[c], st.posY[c] + 0.8, st.posZ[c],
      CRATES.dudSplash, 0.25,
    );
    this.channels.fx.push(
      FxKind.ExplosionMedium, st.posX[c], st.posY[c] + 0.8, st.posZ[c],
      0, 1, 0, 1.2, NONE, Faction.Neutral,
    );
    this.world.vfx.shake(0.22);
    return damage;
  }

  /* -- dropping ---------------------------------------------------------- */

  /** Drop one crate somewhere legal. Returns NONE if nowhere was found. */
  private dropCrate(s: SimContext): EntityId {
    const w = this.world;
    for (let t = 0; t < CRATES.placementTries; t++) {
      const cx = s.rng.int(1, MAP_CELLS - 2);
      const cz = s.rng.int(1, MAP_CELLS - 2);
      if (!isInMap(cx, cz)) continue;
      if (w.terrain.isWater(cx, cz)) continue;
      if (w.terrain.isOccupied(cx, cz)) continue;
      if (!w.terrain.isPassable(cx, cz, Locomotor.Foot)) continue;
      const x = (cx + 0.5) * CELL;
      const z = (cz + 0.5) * CELL;
      if (this.blocked(x, z)) continue;
      return this.spawnCrate(x, z, s.rng.next() * Math.PI * 2);
    }
    return NONE;
  }

  private blocked(x: number, z: number): boolean {
    const w = this.world;
    const st = w.store;
    const n = w.spatial.queryCircleFat(x, z, CELL, this.scratch);
    for (let k = 0; k < n; k++) {
      if ((st.flags[this.scratch[k]] & EntityFlag.PendingDestroy) === 0) return true;
    }
    return false;
  }

  /**
   * Put a crate on the map. Public so a scenario, a script or a test can place
   * one exactly where it wants; the collection path is identical either way.
   */
  spawnCrate(x: number, z: number, yaw = 0): EntityId {
    const w = this.world;
    const st = w.store;
    const fb = FALLBACK_PROPS.crate;
    const px = clampWorld(x, 1);
    const pz = clampWorld(z, 1);
    const py = w.terrain.heightAt(px, pz);
    const owner = this.gaia();

    const id = st.alloc(
      EntityKind.Crate, PROP_DEF_ID.crate ?? -1, owner, Faction.Neutral, px, py, pz, yaw,
    );
    if (id === NONE) return NONE;
    const i = st.index(id);
    st.maxHp[i] = fb.maxHp;
    st.hp[i] = fb.maxHp;
    st.armorClass[i] = ArmorClass.Wood;
    st.radius[i] = fb.radius;
    st.locomotor[i] = Locomotor.Static;
    st.flags[i] |= fb.flags;
    st.spawnTick[i] = w.tick;

    const ev = this.channels.events.payload('entity:spawned');
    ev.id = id;
    ev.kind = EntityKind.Crate;
    ev.defId = PROP_DEF_ID.crate ?? -1;
    ev.player = owner;
    ev.x = px;
    ev.z = pz;
    this.channels.events.emitPooled('entity:spawned');

    this.channels.fx.push(FxKind.DustPuff, px, py + 0.4, pz, 0, 1, 0, 0.8, id, Faction.Neutral);
    this.stats.dropped++;
    return id;
  }

  /** The neutral caretaker slot, or player 0 when a scenario made none. */
  private gaia(): PlayerId {
    const w = this.world;
    for (let i = 0; i < w.players.length; i++) {
      if (w.players[i].faction === Faction.Neutral) return w.players[i].id;
    }
    return 0 as PlayerId;
  }

  dispose(): void {
    this.listeners.length = 0;
  }
}

function factionKey(f: Faction): string {
  return FACTION_PALETTE_KEYS[f as number] ?? 'neutral';
}

/* ==========================================================================
 * 4. MODULE ACCESSOR
 * ========================================================================== */

let active: CrateService | null = null;

export function setCrateService(next: CrateService | null): void {
  active = next;
}

export function crateService(): CrateService | null {
  return active;
}
