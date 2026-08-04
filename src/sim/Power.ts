/**
 * ============================================================================
 * VOLTMARCH — src/sim/Power.ts
 * ============================================================================
 * THE POWER GRID. Plants supply, structures draw, and a deficit BROWNS OUT.
 *
 * WHY A DEFICIT MUST NOT SWITCH ANYTHING OFF FOR FREE
 * ---------------------------------------------------
 * The obvious implementation — shed load until supply covers demand — is
 * wrong, and it is wrong in a way that quietly deletes the Power Plant from
 * the build order. If darkening a Tesla Coil also removed its 100-point draw,
 * the grid would heal itself the instant it broke and a player would never
 * need another reactor. So:
 *
 *   - `consumed` is the draw of EVERY completed structure, dark or not.
 *     Shedding changes who is powered, never what is drawn.
 *   - The deficit picks its victims by SHED PRIORITY (defences, then radar,
 *     then tech, then factories) and darkens exactly enough of them that their
 *     combined draw covers the shortfall. A 20-point deficit kills one pillbox.
 *     A 300-point deficit kills the whole defensive line and the radar.
 *   - The Construction Yard is never shed. A base that cannot build its way out
 *     of a brownout is a base in an unrecoverable state, and an RTS that can
 *     lose to a mistake it will not let you fix is not fun, it is a puzzle.
 *
 * AND SEPARATELY, PRODUCTION SLOWS
 * --------------------------------
 * `buildSpeedMul` is a continuous function of the raw supply ratio, from
 * POWER_FULL_MUL at parity down to POWER_BLACKOUT_MUL at zero supply. Never to
 * zero — a build queue that stops dead while your only power plant is on fire
 * is the same soft-lock as above wearing a different hat.
 *
 * So a deficit costs you two things at once: your defences go dark, and
 * everything you build to fix it arrives slower. That double bind is the whole
 * reason power is interesting, and it is why this file is 300 lines instead of
 * a one-line subtraction.
 *
 * COST
 * ----
 * A full rescan of every building, every POWER_RECOMPUTE_INTERVAL ticks, plus
 * an immediate rescan whenever a structure completes, dies, is sold or changes
 * hands. At a couple of hundred structures that is a few microseconds at 6 Hz.
 * Incremental accounting would be faster and would be wrong the first time a
 * module forgot to emit an event.
 * ============================================================================
 */

import {
  MAX_PLAYERS, POWER_BLACKOUT_MUL, POWER_EVA_COOLDOWN, POWER_FULL_MUL,
  POWER_RECOMPUTE_INTERVAL, POWER_SHED_ORDER,
} from '../core/config';
import { EntityFlag, EntityKind, EvaLine } from '../core/types';
import type { EntityId, PlayerId } from '../core/types';
import type { World } from '../core/world';
import type { Channels } from '../core/events';
import { clamp } from '../core/math';

/** One player's grid, as the HUD power bar and the AI both want to read it. */
export interface PowerState {
  /** Sum of every completed plant's output. */
  produced: number;
  /** Sum of every completed consumer's draw, INCLUDING structures gone dark. */
  consumed: number;
  /** produced / consumed, clamped to 0..4. 1.0 (or better) is healthy. */
  ratio: number;
  /** 1.0 at parity, falling to POWER_BLACKOUT_MUL with no supply at all. */
  buildSpeedMul: number;
  /** True whenever consumption exceeds production. */
  brownout: boolean;
  /** Credits of draw currently switched off to cover the shortfall. */
  shedDraw: number;
  /** How many structures are dark. */
  shedCount: number;
  /** False while any defensive structure is dark. */
  defencesOnline: boolean;
  /** A powered, completed Radar Dome exists. */
  radarOnline: boolean;
  /** Live completed plants / consumers, for the debug overlay. */
  plants: number;
  consumers: number;
}

/** Shed classification for one structure. Lower goes dark first. */
function shedPriority(flags: number): number {
  // A Construction Yard is load-bearing for the whole recovery path.
  if ((flags & EntityFlag.IsBuilder) !== 0) return POWER_SHED_ORDER.never;
  // Something that makes power obviously cannot be switched off by a shortage
  // of power. Neither can a structure that never asked for any.
  if ((flags & EntityFlag.NeedsPower) === 0) return POWER_SHED_ORDER.never;
  if ((flags & EntityFlag.CanAttack) !== 0) return POWER_SHED_ORDER.defence;
  if ((flags & EntityFlag.IsRadar) !== 0) return POWER_SHED_ORDER.radar;
  if ((flags & EntityFlag.IsRefinery) !== 0) return POWER_SHED_ORDER.refinery;
  if ((flags & EntityFlag.IsFactory) !== 0) return POWER_SHED_ORDER.factory;
  return POWER_SHED_ORDER.tech;
}

function emptyState(): PowerState {
  return {
    produced: 0, consumed: 0, ratio: 1, buildSpeedMul: POWER_FULL_MUL,
    brownout: false, shedDraw: 0, shedCount: 0,
    defencesOnline: true, radarOnline: false, plants: 0, consumers: 0,
  };
}

/** Max structures one player can have in the shed candidate list. */
const SHED_CAPACITY = 512;

export class PowerGrid {
  private readonly states: PowerState[] = [];

  /** Set by any event that can change supply or demand. */
  private dirty = true;
  private ticksSinceScan = 0;

  private readonly lastEva = new Float64Array(MAX_PLAYERS);
  /** Previous frame's brownout flag, so the EVA line fires on the EDGE. */
  private readonly wasBrownout = new Uint8Array(MAX_PLAYERS);
  private readonly wasRadar = new Uint8Array(MAX_PLAYERS);

  /* Shed working set. Parallel arrays, allocated once, reused per player. */
  private readonly shedSlot = new Int32Array(SHED_CAPACITY);
  private readonly shedKey = new Float64Array(SHED_CAPACITY);
  private readonly shedOrder = new Int32Array(SHED_CAPACITY);
  private shedCount = 0;

  private readonly unsubscribes: (() => void)[] = [];
  private time = 0;

  constructor(private readonly world: World, private readonly channels: Channels) {
    for (let i = 0; i < MAX_PLAYERS; i++) this.states.push(emptyState());
    this.lastEva.fill(-1e9);

    const bus = channels.events;
    const touch = (): void => { this.dirty = true; };
    this.unsubscribes.push(
      bus.on('building:completed', touch),
      bus.on('building:sold', touch),
      bus.on('building:captured', touch),
      bus.on('building:placed', touch),
      bus.on('entity:killed', touch),
      bus.on('entity:spawned', touch),
    );
  }

  /** Force a rescan on the next tick. */
  markDirty(): void {
    this.dirty = true;
  }

  /** Read-only view of a player's grid. Valid until the next recompute. */
  state(player: PlayerId): Readonly<PowerState> {
    const s = this.states[player as number];
    return s ?? this.states[0];
  }

  /** 1.0 when healthy; production multiplies its progress by this. */
  buildSpeedMul(player: PlayerId): number {
    const s = this.states[player as number];
    return s === undefined ? POWER_FULL_MUL : s.buildSpeedMul;
  }

  /** True while a structure is dark. Weapons must refuse to fire when so. */
  isDark(id: EntityId): boolean {
    const s = this.world.store;
    const i = s.index(id);
    if (i < 0) return true;
    if ((s.flags[i] & EntityFlag.NeedsPower) === 0) return false;
    return (s.flags[i] & EntityFlag.Powered) === 0;
  }

  simTick(time: number): void {
    this.time = time;
    this.ticksSinceScan++;
    if (!this.dirty && this.ticksSinceScan < POWER_RECOMPUTE_INTERVAL) return;
    this.dirty = false;
    this.ticksSinceScan = 0;
    this.recompute();
  }

  /**
   * The whole grid, from scratch, for every player.
   *
   * Pass 1 sums supply and demand and marks every completed structure Powered.
   * Pass 2 walks the shed list per player and clears Powered on the victims.
   * Doing it in that order means a structure's Powered bit is written exactly
   * once per scan and there is no window where a half-updated grid is visible.
   */
  recompute(): void {
    const w = this.world;
    const s = w.store;
    const playerCount = w.players.length;

    for (let p = 0; p < playerCount; p++) {
      const st = this.states[p];
      st.produced = 0;
      st.consumed = 0;
      st.shedDraw = 0;
      st.shedCount = 0;
      st.plants = 0;
      st.consumers = 0;
      st.defencesOnline = true;
      st.radarOnline = false;
    }

    /* -- pass 1: sum, and provisionally power everything ------------------ */
    const list = s.byKind[EntityKind.Building];
    const count = s.byKindCount[EntityKind.Building];
    for (let k = 0; k < count; k++) {
      const i = list[k];
      const f = s.flags[i];
      if ((f & EntityFlag.PendingDestroy) !== 0) continue;

      // A structure under construction neither supplies nor draws. Building a
      // reactor must not power your base until the last frame of the rise.
      if ((f & EntityFlag.UnderConstruction) !== 0 || s.buildProgress[i] < 1) {
        s.flags[i] = f & ~EntityFlag.Powered;
        continue;
      }
      const owner = s.owner[i];
      if (owner >= playerCount) continue;
      const st = this.states[owner];

      const draw = s.powerDraw[i];
      if (draw > 0) { st.produced += draw; st.plants++; }
      else if (draw < 0) { st.consumed += -draw; st.consumers++; }

      s.flags[i] = f | EntityFlag.Powered;
    }

    /* -- pass 2: shed, per player ----------------------------------------- */
    for (let p = 0; p < playerCount; p++) {
      const st = this.states[p];
      // No consumers at all is a healthy grid, not an infinitely rich one:
      // reporting ratio 4 to a HUD bar that has never seen a structure would
      // draw a full bar on an empty map.
      const ratio = st.consumed <= 0 ? 1 : st.produced / st.consumed;
      st.ratio = clamp(ratio, 0, 4);
      st.brownout = st.consumed > st.produced;
      st.buildSpeedMul = clamp(
        POWER_BLACKOUT_MUL + (POWER_FULL_MUL - POWER_BLACKOUT_MUL) * Math.min(1, ratio),
        POWER_BLACKOUT_MUL,
        POWER_FULL_MUL,
      );
      if (st.brownout) this.shed(p as PlayerId, st, st.consumed - st.produced);
    }

    /* -- pass 3: derived per-player facts and notifications ---------------- */
    for (let k = 0; k < count; k++) {
      const i = list[k];
      const f = s.flags[i];
      if ((f & (EntityFlag.PendingDestroy | EntityFlag.Powered)) !== EntityFlag.Powered) continue;
      if ((f & EntityFlag.IsRadar) === 0) continue;
      const owner = s.owner[i];
      if (owner < playerCount) this.states[owner].radarOnline = true;
    }

    for (let p = 0; p < playerCount; p++) {
      const st = this.states[p];
      const pl = w.players[p];
      pl.powerProduced = st.produced;
      pl.powerConsumed = st.consumed;
      pl.buildSpeedMul = st.buildSpeedMul;

      if (pl.hasRadar !== st.radarOnline) {
        pl.hasRadar = st.radarOnline;
      }
      if (this.wasRadar[p] !== (st.radarOnline ? 1 : 0)) {
        this.wasRadar[p] = st.radarOnline ? 1 : 0;
        const ev = this.channels.events.payload('radar:changed');
        ev.player = p as PlayerId;
        ev.online = st.radarOnline;
        this.channels.events.emitPooled('radar:changed');
        this.eva(p, st.radarOnline ? EvaLine.RadarOnline : EvaLine.RadarOffline, true);
      }

      const nowBrown = st.brownout ? 1 : 0;
      const changed = this.wasBrownout[p] !== nowBrown;
      this.wasBrownout[p] = nowBrown;

      const ev = this.channels.events.payload('economy:power');
      ev.player = p as PlayerId;
      ev.produced = st.produced;
      ev.consumed = st.consumed;
      ev.buildSpeedMul = st.buildSpeedMul;
      // The event's `brownout` field is documented as "true the tick the player
      // crosses into deficit", i.e. the EDGE, not the level. The level is on
      // PowerState for anyone who wants it.
      ev.brownout = changed && st.brownout;
      this.channels.events.emitPooled('economy:power');

      if (changed && st.brownout) this.eva(p, EvaLine.LowPower, false);
    }
  }

  /**
   * Darken structures until their combined draw covers `deficit`.
   *
   * Ordering is (priority, draw descending, slot ascending): within a class the
   * biggest consumer goes first, because darkening one Tesla Coil reads as a
   * decision while darkening six pillboxes reads as a bug. The slot tie-break
   * is what makes the choice identical on every machine.
   */
  private shed(player: PlayerId, st: PowerState, deficit: number): void {
    const s = this.world.store;
    const list = s.byKind[EntityKind.Building];
    const count = s.byKindCount[EntityKind.Building];
    const p = player as number;

    this.shedCount = 0;
    for (let k = 0; k < count && this.shedCount < SHED_CAPACITY; k++) {
      const i = list[k];
      if (s.owner[i] !== p) continue;
      const f = s.flags[i];
      if ((f & EntityFlag.Powered) === 0) continue;
      const prio = shedPriority(f);
      if (prio === POWER_SHED_ORDER.never) continue;
      const draw = -s.powerDraw[i];
      if (draw <= 0) continue;

      const n = this.shedCount++;
      this.shedSlot[n] = i;
      // Pack (priority, -draw) into one sortable float. Draw is bounded well
      // under 10 000, so the classes never overlap.
      this.shedKey[n] = prio * 1e6 - draw;
      this.shedOrder[n] = n;
    }
    if (this.shedCount === 0) return;

    // Insertion sort on the index permutation: the list is short (a base rarely
    // has 30 shed-eligible structures) and insertion sort neither allocates nor
    // calls a comparator closure.
    for (let a = 1; a < this.shedCount; a++) {
      const v = this.shedOrder[a];
      const key = this.shedKey[v];
      let b = a - 1;
      while (b >= 0 && (this.shedKey[this.shedOrder[b]] > key ||
             (this.shedKey[this.shedOrder[b]] === key && this.shedSlot[this.shedOrder[b]] > this.shedSlot[v]))) {
        this.shedOrder[b + 1] = this.shedOrder[b];
        b--;
      }
      this.shedOrder[b + 1] = v;
    }

    let covered = 0;
    for (let a = 0; a < this.shedCount && covered < deficit; a++) {
      const i = this.shedSlot[this.shedOrder[a]];
      const draw = -s.powerDraw[i];
      s.flags[i] &= ~EntityFlag.Powered;
      covered += draw;
      st.shedDraw += draw;
      st.shedCount++;
      if ((s.flags[i] & EntityFlag.CanAttack) !== 0) st.defencesOnline = false;
    }
  }

  private eva(player: number, line: EvaLine, ignoreCooldown: boolean): void {
    if (!ignoreCooldown) {
      if (this.time - this.lastEva[player] < POWER_EVA_COOLDOWN) return;
      this.lastEva[player] = this.time;
    }
    const ev = this.channels.events.payload('eva:line');
    ev.player = player as PlayerId;
    ev.line = line;
    this.channels.events.emitPooled('eva:line');
  }

  dispose(): void {
    for (let i = 0; i < this.unsubscribes.length; i++) this.unsubscribes[i]();
    this.unsubscribes.length = 0;
  }
}
