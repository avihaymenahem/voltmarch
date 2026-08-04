/**
 * ============================================================================
 * src/sim/Capture.ts — ENGINEERS: CAPTURE, REPAIR, AND THE LOW-HEALTH RULE
 * ============================================================================
 *
 * `OrderKind.Capture` and `OrderKind.Repair` were plumbed end to end — cursor,
 * order resolution, `UnitState.Capturing`, three listeners on
 * `'building:captured'` — and then nothing consumed them. This is the consumer.
 *
 * THE RULES, in the order they are tested:
 *
 *   1. A NEUTRAL structure (owned by a Faction.Neutral player: oil derricks,
 *      hospitals, civilian blocks) is captured outright, at any health. That is
 *      what makes tech buildings worth walking to.
 *
 *   2. An ENEMY structure is captured only at or below `CAPTURE.captureHpFrac`.
 *      Above it, the engineer is spent "softening" the target: it knocks
 *      `CAPTURE.softenFrac` of max HP off and dies in the attempt. This is the
 *      Tiberian Sun rule and it is the reason engineers are a tactic rather
 *      than a coin flip — a full-health Construction Yard costs exactly three
 *      engineers (100% -> 75% -> 50% -> captured), and a yard your tanks
 *      already chewed on costs one.
 *
 *   3. An ALLIED (or own) structure that is damaged is repaired to full and the
 *      engineer is consumed. An undamaged one turns the engineer away with its
 *      order cleared, because silently eating a 500-credit unit for nothing is
 *      the worst possible answer.
 *
 *   4. A structure still `UnderConstruction`, or one a veto says is busy (an
 *      occupied garrison — see Garrison.ts), is refused without consuming the
 *      engineer.
 *
 * WRITE OWNERSHIP. This module writes `owner`, `faction` and `flags` on
 * BUILDINGS only, and `state`/`orderKind`/`orderX`/`orderZ` on the engineers it
 * is steering — the same columns `input/Commands.ts` writes, one phase later
 * and only for units carrying a capture/repair order. It never touches
 * position, velocity or hp of anything that is not the capture target.
 *
 * PHASE. Registered at `Phase.Cleanup` with a negative order, so it runs after
 * Movement has produced this tick's final positions and before
 * `combat.cleanup` (order 0) flushes the dead — an engineer consumed here is
 * freed in the same tick that consumed it.
 * ============================================================================
 */

import type { Channels } from '../core/events';
import type { World } from '../core/world';
import {
  EntityFlag, EntityKind, Faction, FxKind, NONE, OrderKind, UnitState, WarheadClass,
} from '../core/types';
import type { EntityId, PlayerId, SimContext } from '../core/types';
import { CELL } from '../core/config';

import { production } from './Production';
import { getEconomy } from './Economy';

/* ==========================================================================
 * 1. TUNING
 *
 * Module-private on purpose: src/core/config.ts belongs to the grade agent
 * this round. Every number here is a candidate to move there later; they are
 * gathered in one object so that move is a copy, not an archaeology dig.
 * ========================================================================== */

export const CAPTURE = {
  /** Metres of clearance beyond the target's footprint edge that counts as "inside". */
  reachMetres: 2.2,
  /** Enemy structures flip only at or below this health fraction. */
  captureHpFrac: 0.5,
  /** How much of max HP one engineer knocks off a too-healthy enemy structure. */
  softenFrac: 0.25,
  /** A friendly structure this close to full is not worth an engineer. */
  repairThresholdFrac: 0.995,
  /** Seconds an engineer will chase a capture target before giving up. */
  pursuitSeconds: 90,
} as const;

/* ==========================================================================
 * 2. PUBLIC SHAPES
 * ========================================================================== */

/** Why a capture attempt resolved the way it did. Drives tests and the log. */
export const enum CaptureOutcome {
  /** Still walking. */
  Pending = 0,
  Captured = 1,
  Repaired = 2,
  /** Enemy structure was too healthy: engineer spent, structure damaged. */
  Softened = 3,
  /** Nothing happened and the engineer survives with its order cleared. */
  Refused = 4,
}

export interface CaptureStats {
  /** Engineers currently walking a capture/repair order. */
  pursuing: number;
  captures: number;
  repairs: number;
  softens: number;
  refusals: number;
}

/** A predicate that can forbid a capture (Garrison installs one). */
export type CaptureVeto = (target: EntityId, byPlayer: PlayerId) => boolean;

/* ==========================================================================
 * 3. THE SERVICE
 * ========================================================================== */

export class CaptureService {
  readonly stats: CaptureStats = {
    pursuing: 0, captures: 0, repairs: 0, softens: 0, refusals: 0,
  };

  private readonly vetoes: CaptureVeto[] = [];

  constructor(
    private readonly world: World,
    private readonly channels: Channels,
  ) {}

  /* -- queries ----------------------------------------------------------- */

  /**
   * True when this entity can capture. Prefers the real def table's
   * `canCapture`, falls back to the catalog key, so it is correct both before
   * and after src/data/Defs.ts is bound.
   */
  isEngineer(id: EntityId): boolean {
    const st = this.world.store;
    const i = st.index(id);
    if (i < 0) return false;
    return this.isEngineerSlot(i);
  }

  private isEngineerSlot(i: number): boolean {
    const st = this.world.store;
    if (st.kind[i] !== EntityKind.Infantry) return false;
    const svc = production();
    const defId = st.defId[i];
    const units = svc?.bindingTables?.units;
    if (units !== undefined && defId >= 0 && defId < units.length) {
      return units[defId].canCapture;
    }
    return svc?.entryOf(st.handleOf(i))?.key === 'engineer';
  }

  /** True when `target` is a structure `byPlayer` is allowed to walk into. */
  isCapturable(target: EntityId, byPlayer: PlayerId): boolean {
    const st = this.world.store;
    const i = st.index(target);
    if (i < 0) return false;
    if (st.kind[i] !== EntityKind.Building) return false;
    const f = st.flags[i];
    if ((f & EntityFlag.Alive) === 0) return false;
    if ((f & (EntityFlag.PendingDestroy | EntityFlag.UnderConstruction)) !== 0) return false;
    if (st.owner[i] === (byPlayer as number)) return false;
    for (let v = 0; v < this.vetoes.length; v++) {
      if (this.vetoes[v](target, byPlayer)) return false;
    }
    return true;
  }

  /**
   * Install a predicate that can forbid captures. Returns an unsubscribe.
   * Garrison.ts uses this so an occupied strongpoint has to be emptied before
   * it changes hands.
   */
  addVeto(fn: CaptureVeto): () => void {
    this.vetoes.push(fn);
    return () => {
      const i = this.vetoes.indexOf(fn);
      if (i >= 0) this.vetoes.splice(i, 1);
    };
  }

  /* -- the tick ---------------------------------------------------------- */

  simTick(_s: SimContext): void {
    const st = this.world.store;
    const list = st.byKind[EntityKind.Infantry];
    const count = st.byKindCount[EntityKind.Infantry];
    let pursuing = 0;

    for (let a = 0; a < count; a++) {
      const i = list[a];
      const f = st.flags[i];
      if ((f & EntityFlag.Alive) === 0) continue;
      if ((f & (EntityFlag.PendingDestroy | EntityFlag.Garrisoned)) !== 0) continue;

      const order = st.orderKind[i] as OrderKind;
      if (order !== OrderKind.Capture && order !== OrderKind.Repair) continue;

      if (!this.isEngineerSlot(i)) { this.clearOrder(i); continue; }

      const target = st.orderTarget[i] as EntityId;
      const t = st.index(target);
      if (t < 0 || st.kind[t] !== EntityKind.Building
        || (st.flags[t] & EntityFlag.PendingDestroy) !== 0) {
        this.clearOrder(i);
        continue;
      }

      // Re-aim every tick. The order was issued at a cursor position that may
      // be the corner of the footprint; walking to the centre is what actually
      // gets the engineer inside, and the structure cannot move so this is a
      // pure convergence, never a jitter.
      st.orderX[i] = st.posX[t];
      st.orderZ[i] = st.posZ[t];

      const friendly = this.isFriendlyTarget(i, t);
      st.state[i] = friendly ? UnitState.Repairing : UnitState.Capturing;
      pursuing++;

      if (!this.withinReach(i, t)) continue;
      this.resolve(i, t, friendly);
    }

    this.stats.pursuing = pursuing;
  }

  /* -- resolution -------------------------------------------------------- */

  /**
   * The engineer has arrived. Decide, act, and either consume it or hand it
   * back its freedom.
   */
  private resolve(i: number, t: number, friendly: boolean): CaptureOutcome {
    const st = this.world.store;
    const engineer = st.handleOf(i);
    const target = st.handleOf(t);
    const byPlayer = st.owner[i] as PlayerId;

    if ((st.flags[t] & EntityFlag.UnderConstruction) !== 0) {
      this.refuse(i);
      return CaptureOutcome.Refused;
    }

    if (friendly) {
      const frac = st.maxHp[t] > 0 ? st.hp[t] / st.maxHp[t] : 1;
      if (frac >= CAPTURE.repairThresholdFrac) {
        this.refuse(i);
        return CaptureOutcome.Refused;
      }
      st.hp[t] = st.maxHp[t];
      st.flags[t] |= EntityFlag.BeingRepaired;
      this.burst(FxKind.RepairSpark, t, 1.4);
      this.consume(i, engineer);
      this.stats.repairs++;
      return CaptureOutcome.Repaired;
    }

    for (let v = 0; v < this.vetoes.length; v++) {
      if (this.vetoes[v](target, byPlayer)) {
        this.refuse(i);
        return CaptureOutcome.Refused;
      }
    }

    // Neutral structures are the prize on the map, not a fortress: no health
    // gate. Enemy structures have to be softened first.
    const neutral = this.ownerFactionOf(t) === Faction.Neutral;
    const frac = st.maxHp[t] > 0 ? st.hp[t] / st.maxHp[t] : 1;

    if (!neutral && frac > CAPTURE.captureHpFrac) {
      const damage = st.maxHp[t] * CAPTURE.softenFrac;
      this.channels.damage.push(
        target, engineer, damage, WarheadClass.HighExplosive,
        st.posX[t], st.posY[t] + 1.5, st.posZ[t], 0, 0,
      );
      this.burst(FxKind.ExplosionSmall, t, 1.1);
      this.consume(i, engineer);
      this.stats.softens++;
      return CaptureOutcome.Softened;
    }

    if (this.captureBuilding(target, byPlayer, engineer)) {
      this.consume(i, engineer);
      this.stats.captures++;
      return CaptureOutcome.Captured;
    }
    this.refuse(i);
    return CaptureOutcome.Refused;
  }

  /**
   * Flip a structure's ownership. The public entry point — crates, scripted
   * events and tests all use this, and it is the ONLY place `owner` changes on
   * a building.
   *
   * The three existing `'building:captured'` listeners do the rest: Power
   * rebuilds the grid, Production marks tech dirty, Audio plays the line.
   */
  captureBuilding(target: EntityId, toPlayer: PlayerId, by: EntityId = NONE): boolean {
    const w = this.world;
    const st = w.store;
    const t = st.index(target);
    if (t < 0) return false;
    if (st.kind[t] !== EntityKind.Building) return false;
    if ((st.flags[t] & EntityFlag.Alive) === 0) return false;
    if ((st.flags[t] & EntityFlag.PendingDestroy) !== 0) return false;

    const fromPlayer = st.owner[t] as PlayerId;
    if ((fromPlayer as number) === (toPlayer as number)) return false;
    const from = w.players[fromPlayer as number];
    const to = w.players[toPlayer as number];
    if (to === undefined) return false;

    st.owner[t] = toPlayer as number;
    st.faction[t] = to.faction;
    // A captured factory is never automatically the primary one: the new owner
    // already has a spawn point and having units silently start coming out of
    // the far side of the map is a bug report waiting to happen.
    st.flags[t] &= ~EntityFlag.PrimaryFactory;

    if (from !== undefined) {
      from.rallyX.delete(target as number);
      from.rallyZ.delete(target as number);
      if (EntityKind.Building < from.entityCount.length) {
        from.entityCount[EntityKind.Building] = Math.max(
          0, from.entityCount[EntityKind.Building] - 1,
        );
      }
    }
    if (EntityKind.Building < to.entityCount.length) to.entityCount[EntityKind.Building]++;

    // Storage caps follow the deed. Power is recomputed by Power.ts's own
    // listener on the event we are about to emit.
    getEconomy()?.recomputeStorage();

    const ev = this.channels.events.payload('building:captured');
    ev.id = target;
    ev.defId = production()?.entryOf(target)?.publicId ?? st.defId[t];
    ev.fromPlayer = fromPlayer;
    ev.toPlayer = toPlayer;
    this.channels.events.emitPooled('building:captured');

    this.burst(FxKind.BuildComplete, t, 1.6);
    this.channels.fx.push(
      FxKind.Sparks, st.posX[t], st.posY[t] + 2.2, st.posZ[t],
      0, 1, 0, 1.4, by, to.faction,
    );
    return true;
  }

  /* -- helpers ----------------------------------------------------------- */

  /** Allied-or-own, and NOT a neutral/Gaia structure (Gaia is allied to all). */
  private isFriendlyTarget(i: number, t: number): boolean {
    const st = this.world.store;
    if (this.ownerFactionOf(t) === Faction.Neutral) return false;
    return this.world.areAllied(st.owner[i] as PlayerId, st.owner[t] as PlayerId);
  }

  private ownerFactionOf(t: number): Faction {
    const p = this.world.players[this.world.store.owner[t]];
    return p === undefined ? Faction.Neutral : p.faction;
  }

  /**
   * Footprint-aware proximity. `world.gapBetween` subtracts collision discs,
   * and a 3x3 structure's disc is far smaller than the building it stands for,
   * so an engineer would stand on the roof forever waiting to "arrive".
   */
  private withinReach(i: number, t: number): boolean {
    const st = this.world.store;
    const halfW = Math.max(st.footprintW[t], 1) * CELL * 0.5;
    const halfH = Math.max(st.footprintH[t], 1) * CELL * 0.5;
    const dx = Math.max(0, Math.abs(st.posX[i] - st.posX[t]) - halfW);
    const dz = Math.max(0, Math.abs(st.posZ[i] - st.posZ[t]) - halfH);
    const reach = CAPTURE.reachMetres + st.radius[i];
    return dx * dx + dz * dz <= reach * reach;
  }

  /** Spend the engineer. `Selling` is the store's "quiet removal" state. */
  private consume(i: number, id: EntityId): void {
    const st = this.world.store;
    st.state[i] = UnitState.Selling;
    st.orderKind[i] = OrderKind.None;
    st.orderTarget[i] = 0;
    st.velX[i] = 0; st.velZ[i] = 0; st.speed[i] = 0;
    st.markDead(id);
  }

  private refuse(i: number): void {
    this.clearOrder(i);
    this.stats.refusals++;
  }

  private clearOrder(i: number): void {
    const st = this.world.store;
    st.orderKind[i] = OrderKind.None;
    st.orderTarget[i] = 0;
    st.orderX[i] = st.posX[i];
    st.orderZ[i] = st.posZ[i];
    if (st.state[i] === UnitState.Capturing || st.state[i] === UnitState.Repairing) {
      st.state[i] = UnitState.Idle;
    }
  }

  private burst(kind: FxKind, t: number, scale: number): void {
    const st = this.world.store;
    this.channels.fx.push(
      kind, st.posX[t], st.posY[t] + 2.0, st.posZ[t],
      0, 1, 0, scale, st.handleOf(t), st.faction[t] as Faction,
    );
  }

  dispose(): void {
    this.vetoes.length = 0;
  }
}

/* ==========================================================================
 * 4. MODULE ACCESSOR
 *
 * Same pattern as `production()` / `getEconomy()`: one live instance, reachable
 * without an import edge into the system shim.
 * ========================================================================== */

let active: CaptureService | null = null;

export function setCaptureService(next: CaptureService | null): void {
  active = next;
}

/** The live capture service, or null before init / after dispose. */
export function captureService(): CaptureService | null {
  return active;
}
