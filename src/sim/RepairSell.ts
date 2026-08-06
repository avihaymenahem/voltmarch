/**
 * ============================================================================
 * src/sim/RepairSell.ts — BASE REPAIR, SELL SURVIVORS, SELF-DESTRUCT, STANCE
 * ============================================================================
 *
 * Four dead command paths, all of them already plumbed from the HUD down to the
 * bus and then dropped on the floor:
 *
 *   CommandKind.RepairToggle  — the wrench button and its cursor exist,
 *                               `REPAIR_RATE` and `REPAIR_COST_PER_HP` exist,
 *                               `EntityFlag.BeingRepaired` exists and
 *                               `FxKind.RepairSpark` exists. Nothing consumed
 *                               the command.
 *   CommandKind.SetStance     — `store.stance[]` was written at spawn and never
 *                               again, so every unit in the game was
 *                               permanently Aggressive despite four read sites.
 *   CommandKind.SelfDestruct  — issued, re-issued, dropped.
 *   'building:sold'           — emitted with a refund and nothing else. In C&C
 *                               a sold structure coughs up its crew.
 *
 * REPAIR IS A DRIP, NOT A BUTTON. A flagged structure heals `REPAIR_RATE` HP a
 * second and charges `REPAIR_COST_PER_HP` per point healed. Running out of
 * money stops the repair and clears the flag rather than healing for free — a
 * silent free repair is the kind of bug that only shows up in a balance
 * complaint three weeks later.
 *
 * SELLING IS OWNED BY Production.ts. This module does not duplicate it; it
 * listens for `'building:sold'` and produces the crew. The spawn is deferred to
 * the next `simTick` so it can use `s.rng` and stay deterministic — an event
 * handler runs at an arbitrary point in the tick and has no RNG of its own.
 *
 * PHASE. `Phase.Economy`, so a repair charge lands in the same tick's credit
 * bookkeeping. The command drain lives in features.system.ts.
 * ============================================================================
 */

import type { Channels } from '../core/events';
import type { World } from '../core/world';
import { PerEntityF32 } from '../core/world';
import {
  CommandKind, CreditReason, EntityFlag, EntityKind, Faction, FxKind,
  NONE, Stance, UnitState, WarheadClass,
} from '../core/types';
import type { Command, EntityId, PlayerId, SimContext } from '../core/types';
import { CELL, REPAIR_COST_PER_HP, REPAIR_DEPOT, REPAIR_RATE } from '../core/config';

import { BuildKind, production } from './Production';
import { getEconomy } from './Economy';

/* ==========================================================================
 * 1. TUNING
 * ========================================================================== */

/**
 * The line infantry that walks out of a sold structure, indexed by `Faction`.
 * A Pact building selling into a squad of G.I.s would hand the player free
 * units of an army they are not playing.
 */
const SURVIVOR_KEY: readonly string[] = ['gi', 'gi', 'conscript', 'mrdWayfarer'];

/**
 * Content keys that service vehicles. Three, not four: `repairDepot` is a
 * `Faction.Neutral` def, which in this codebase means "both original armies"
 * — the Allied and Soviet architectures are two MASS LISTS behind one def, the
 * way `radar` and `battleLab` already work.
 *
 * Resolved to def ids once, against the live catalog. There is deliberately no
 * fallback list: a depot is content, and a boot with no content module has no
 * depots to find.
 */
const DEPOT_KEYS: readonly string[] = ['repairDepot', 'mrdDepot', 'rclDepot'];

export const REPAIR = {
  /** Seconds between repair sparks on a structure being mended. */
  sparkSeconds: 0.55,
  /** Survivors from a sold structure, by footprint area in cells. */
  survivorsPerCell: 0.34,
  /** Never more than this many, however big the building. */
  maxSurvivors: 4,
  /** Metres beyond the footprint edge the crew appears. */
  survivorMargin: 1.6,
  /** Self-destruct blast radius in metres. */
  selfDestructSplash: 5.0,
  /** Self-destruct damage as a fraction of the unit's own max HP. */
  selfDestructDamageFrac: 0.8,
} as const;

/* ==========================================================================
 * 2. PUBLIC SHAPES
 * ========================================================================== */

export interface RepairStats {
  /** Structures currently mending. */
  repairing: number;
  /** Total HP restored since boot. */
  hpRestored: number;
  /** Total credits spent on repairs. */
  creditsSpent: number;
  /** Repairs cancelled because the owner went broke. */
  brokeCancels: number;
  survivorsSpawned: number;
  selfDestructs: number;
  stanceChanges: number;
  /** Vehicles a Repair Depot mended this tick. */
  vehiclesServiced: number;
  /** Total HP a Repair Depot has put back into vehicles since boot. */
  depotHpRestored: number;
  /** Depot repairs cut short because the owner could not pay. */
  depotBrokeCancels: number;
}

/** Depots one player can have working at once before the scan gives up. */
const MAX_DEPOTS = 24;

/** A crew that owes its existence to a sold structure. Drained next tick. */
interface PendingCrew {
  player: number;
  x: number;
  z: number;
  count: number;
}

const CREW_CAPACITY = 32;

/* ==========================================================================
 * 3. THE SERVICE
 * ========================================================================== */

export class RepairSellService {
  readonly stats: RepairStats = {
    repairing: 0, hpRestored: 0, creditsSpent: 0, brokeCancels: 0,
    survivorsSpawned: 0, selfDestructs: 0, stanceChanges: 0,
    vehiclesServiced: 0, depotHpRestored: 0, depotBrokeCancels: 0,
  };

  /** 1 while a structure is drip-repairing. Generation-stamped. */
  private readonly repairing: PerEntityF32;
  /** Seconds until the next repair spark on a structure. */
  private readonly sparkTimer: PerEntityF32;

  /* -- depot scratch, all fixed-size and reused every tick ---------------- */
  /** Def ids that are Repair Depots. Null until the catalog binds. */
  private depotDefs: Int32Array | null = null;
  private depotDefCount = 0;
  /** Store indices of this tick's live depots. */
  private readonly depotIdx = new Int32Array(MAX_DEPOTS);
  /** How many vehicles each of those depots is already servicing. */
  private readonly depotLoad = new Int32Array(MAX_DEPOTS);
  /**
   * Vehicles tagged `BeingRepaired` on the previous tick.
   *
   * The whole reason this exists is the no-depot early-out: without it, a tick
   * with no working pad returns before the clearing pass and any tag set the
   * tick before is stranded. Zero here is what lets the common case — nobody
   * owns a depot — cost one integer compare instead of a walk over the army.
   */
  private taggedLast = 0;

  private readonly crew: PendingCrew[] = [];
  private crewCount = 0;
  private unhookSold: (() => void) | null = null;

  constructor(
    private readonly world: World,
    private readonly channels: Channels,
  ) {
    this.repairing = new PerEntityF32(world.store, 0);
    this.sparkTimer = new PerEntityF32(world.store, 0);
    for (let i = 0; i < CREW_CAPACITY; i++) this.crew.push({ player: 0, x: 0, z: 0, count: 0 });
  }

  attach(): void {
    this.unhookSold = this.channels.events.on('building:sold', (ev) => this.onSold(ev.id, ev.player));
  }

  /* -- commands ---------------------------------------------------------- */

  /**
   * Feed one drained command in. Returns true when it was ours, so the drain
   * owner can pass everything through here and re-issue the rest — exactly the
   * contract `ProductionService.handleCommand` publishes.
   */
  handleCommand(cmd: Command): boolean {
    switch (cmd.kind) {
      case CommandKind.RepairToggle:
        this.toggleRepair(cmd.player, cmd.target);
        return true;
      case CommandKind.SetStance:
        this.applyStance(cmd.player, cmd.entities, cmd.entityCount, cmd.stance);
        return true;
      case CommandKind.SelfDestruct:
        this.selfDestruct(cmd.player, cmd.target);
        return true;
      default:
        return false;
    }
  }

  /* -- repair ------------------------------------------------------------ */

  /** True while this structure is drip-repairing. */
  isRepairing(building: EntityId): boolean {
    return this.repairing.get(building) > 0;
  }

  /** Flip the repair flag. Returns the state it ended up in. */
  toggleRepair(player: PlayerId, building: EntityId): boolean {
    return this.setRepairing(player, building, !this.isRepairing(building));
  }

  /**
   * Turn drip-repair on or off. Refuses on anything that is not the caller's
   * own finished, damaged structure — the HUD lets you click anything.
   */
  setRepairing(player: PlayerId, building: EntityId, on: boolean): boolean {
    const st = this.world.store;
    const i = st.index(building);
    if (i < 0) return false;
    if (!on) {
      this.repairing.setAt(i, 0);
      st.flags[i] &= ~EntityFlag.BeingRepaired;
      return false;
    }
    if (st.kind[i] !== EntityKind.Building) return false;
    if (st.owner[i] !== (player as number)) return false;
    const f = st.flags[i];
    if ((f & EntityFlag.Alive) === 0) return false;
    if ((f & (EntityFlag.PendingDestroy | EntityFlag.UnderConstruction)) !== 0) return false;
    if (st.hp[i] >= st.maxHp[i]) return false;
    this.repairing.setAt(i, 1);
    this.sparkTimer.setAt(i, 0);
    return true;
  }

  /* -- the tick ---------------------------------------------------------- */

  simTick(s: SimContext): void {
    this.drainCrew(s);
    this.tickRepairs(s);
    this.tickDepots(s);
  }

  /* -- the repair depot -------------------------------------------------- *
   * A pad, not a button. Every friendly damaged VEHICLE standing inside a
   * depot's radius is mended, with no order issued and no state on the unit —
   * which is why the AI gets this for free: it already retreats damaged
   * armour toward its base, and a depot in that base services whatever
   * arrives without the strategy layer knowing depots exist.
   * ---------------------------------------------------------------------- */

  /** True once the catalog has been consulted, whatever the answer was. */
  get depotsResolved(): boolean { return this.depotDefs !== null; }

  /**
   * Resolve the depot def ids, once, against the bound catalog.
   *
   * Deliberately NOT cached while the catalog is unbound. `ProductionCatalog`
   * answers `byKey` off fallback content before a data module lands, and every
   * depot key would miss — caching that empty answer would mean a match booted
   * a few ticks early has no depots for its whole life, with nothing logged.
   */
  private resolveDepots(): void {
    if (this.depotDefs !== null) return;
    const svc = production();
    if (svc === null || !svc.catalog.bound) return;

    const ids = new Int32Array(DEPOT_KEYS.length);
    let n = 0;
    for (const key of DEPOT_KEYS) {
      const entry = svc.catalog.byKey(key);
      if (entry === null || entry.kind !== BuildKind.Building) continue;
      ids[n++] = entry.defId;
    }
    this.depotDefs = ids;
    this.depotDefCount = n;
  }

  private isDepotDef(defId: number): boolean {
    const ids = this.depotDefs;
    if (ids === null) return false;
    for (let k = 0; k < this.depotDefCount; k++) if (ids[k] === defId) return true;
    return false;
  }

  private tickDepots(s: SimContext): void {
    this.resolveDepots();
    this.stats.vehiclesServiced = 0;
    if (this.depotDefCount === 0) return;

    const st = this.world.store;

    /* -- 1. gather this tick's working depots --------------------------- */
    const blist = st.byKind[EntityKind.Building];
    const bn = st.byKindCount[EntityKind.Building];
    let depots = 0;
    for (let a = 0; a < bn && depots < MAX_DEPOTS; a++) {
      const b = blist[a];
      if (!this.isDepotDef(st.defId[b])) continue;
      const f = st.flags[b];
      if ((f & EntityFlag.Alive) === 0) continue;
      // A half-built pad services nothing. Neither does one about to be rubble.
      if ((f & (EntityFlag.PendingDestroy | EntityFlag.UnderConstruction)) !== 0) continue;
      // Nor does a dark one. The depot draws 30 power, and a building that
      // kept working through a blackout while the tesla coils went out would
      // be the only one in the game that did. Same test `Superweapons.ts` and
      // `Combat.ts` apply, and the same one `Power.isDark` publishes.
      if ((f & EntityFlag.NeedsPower) !== 0 && (f & EntityFlag.Powered) === 0) continue;
      this.depotIdx[depots] = b;
      this.depotLoad[depots] = 0;
      depots++;
    }
    if (depots === 0) {
      // No working pad this tick — sold, shelled, or blacked out. If anything
      // was being serviced last tick its tag has to come OFF, and this is the
      // path that would quietly skip doing it. Leaving the flag set here is
      // `EntityFlag.Burning` all over again: the selection panel would read
      // REPAIRING on a hull nothing is touching, for the rest of the match.
      if (this.taggedLast > 0) {
        const dead = st.byKind[EntityKind.Vehicle];
        const deadCount = st.byKindCount[EntityKind.Vehicle];
        for (let a = 0; a < deadCount; a++) st.flags[dead[a]] &= ~EntityFlag.BeingRepaired;
        this.taggedLast = 0;
      }
      return;
    }

    /* -- 2. one pass over the vehicles ---------------------------------- *
     * Vehicle-major rather than depot-major, and the damage test comes first:
     * a healthy army is the common case and it costs one float compare per
     * hull. The alternative — a spatial query per depot — would read an index
     * rebuilt at Phase.SpatialRebuild (800) while this runs at Economy (300),
     * so it would be answering with LAST tick's buckets. With at most a couple
     * of dozen depots the exact test is both cheaper and correct.            */
    const economy = getEconomy();
    const r2 = REPAIR_DEPOT.radius * REPAIR_DEPOT.radius;
    const vlist = st.byKind[EntityKind.Vehicle];
    const vn = st.byKindCount[EntityKind.Vehicle];
    let serviced = 0;

    for (let a = 0; a < vn; a++) {
      const i = vlist[a];
      const max = st.maxHp[i];
      if (max <= 0 || st.hp[i] >= max) {
        // Undamaged. Drop the tag if this hull was on a pad last tick, or the
        // selection panel would read REPAIRING at full health forever — the
        // failure mode that made `EntityFlag.Burning` permanent.
        if ((st.flags[i] & EntityFlag.BeingRepaired) !== 0) {
          st.flags[i] &= ~EntityFlag.BeingRepaired;
        }
        continue;
      }
      const vf = st.flags[i];
      if ((vf & EntityFlag.Alive) === 0 || (vf & EntityFlag.PendingDestroy) !== 0) continue;

      const owner = st.owner[i];
      const x = st.posX[i];
      const z = st.posZ[i];

      let pad = -1;
      for (let d = 0; d < depots; d++) {
        if (this.depotLoad[d] >= REPAIR_DEPOT.maxConcurrent) continue;
        const b = this.depotIdx[d];
        if (st.owner[b] !== owner) continue;
        const dx = st.posX[b] - x;
        const dz = st.posZ[b] - z;
        if (dx * dx + dz * dz > r2) continue;
        pad = d;
        break;
      }
      if (pad < 0) {
        if ((vf & EntityFlag.BeingRepaired) !== 0) st.flags[i] &= ~EntityFlag.BeingRepaired;
        continue;
      }

      /* -- 3. mend, and charge for it ----------------------------------- */
      const wanted = Math.min(max * REPAIR_DEPOT.fractionPerSec * s.dt, max - st.hp[i]);
      const cost = wanted * REPAIR_COST_PER_HP;
      let healed = wanted;

      if (cost > 0) {
        const p = owner as PlayerId;
        const paid = economy !== null
          ? economy.spendPartial(p, cost, CreditReason.Build)
          : this.spendDirect(p, cost);
        if (paid <= 0) {
          // Broke. Same rule the wrench follows: stop, do not heal for free.
          st.flags[i] &= ~EntityFlag.BeingRepaired;
          this.stats.depotBrokeCancels++;
          continue;
        }
        healed = wanted * (paid / cost);
        this.stats.creditsSpent += paid;
      }

      st.hp[i] = Math.min(max, st.hp[i] + healed);
      st.flags[i] |= EntityFlag.BeingRepaired;
      this.stats.depotHpRestored += healed;
      this.depotLoad[pad]++;
      serviced++;

      const t = this.sparkTimer.getAt(i) - s.dt;
      if (t <= 0) {
        this.sparkTimer.setAt(i, REPAIR_DEPOT.sparkSeconds);
        this.channels.fx.push(
          FxKind.RepairSpark,
          st.posX[i] + (s.rng.next() - 0.5) * 2.0,
          st.posY[i] + 1.4,
          st.posZ[i] + (s.rng.next() - 0.5) * 2.0,
          0, 1, 0, 0.8, st.handleOf(i), st.faction[i] as Faction,
        );
      } else {
        this.sparkTimer.setAt(i, t);
      }
    }
    this.stats.vehiclesServiced = serviced;
    this.taggedLast = serviced;
  }

  private tickRepairs(s: SimContext): void {
    const st = this.world.store;
    const economy = getEconomy();
    const list = st.byKind[EntityKind.Building];
    const n = st.byKindCount[EntityKind.Building];
    let active = 0;

    for (let a = 0; a < n; a++) {
      const i = list[a];
      if (this.repairing.getAt(i) <= 0) continue;
      const f = st.flags[i];
      if ((f & EntityFlag.PendingDestroy) !== 0 || (f & EntityFlag.Alive) === 0) {
        this.repairing.setAt(i, 0);
        continue;
      }
      if ((f & EntityFlag.UnderConstruction) !== 0) continue;
      if (st.hp[i] >= st.maxHp[i]) {
        this.repairing.setAt(i, 0);
        st.flags[i] &= ~EntityFlag.BeingRepaired;
        continue;
      }

      const owner = st.owner[i] as PlayerId;
      const wanted = Math.min(REPAIR_RATE * s.dt, st.maxHp[i] - st.hp[i]);
      const cost = wanted * REPAIR_COST_PER_HP;
      let healed = wanted;

      if (cost > 0) {
        const paid = economy !== null
          ? economy.spendPartial(owner, cost, CreditReason.Build)
          : this.spendDirect(owner, cost);
        if (paid <= 0) {
          // Broke. Stop rather than heal for free; the player can re-arm the
          // wrench the moment a harvester comes home.
          this.repairing.setAt(i, 0);
          st.flags[i] &= ~EntityFlag.BeingRepaired;
          this.stats.brokeCancels++;
          continue;
        }
        healed = wanted * (paid / cost);
        this.stats.creditsSpent += paid;
      }

      st.hp[i] = Math.min(st.maxHp[i], st.hp[i] + healed);
      st.flags[i] |= EntityFlag.BeingRepaired;
      this.stats.hpRestored += healed;
      active++;

      const t = this.sparkTimer.getAt(i) - s.dt;
      if (t <= 0) {
        this.sparkTimer.setAt(i, REPAIR.sparkSeconds);
        const jitterX = (s.rng.next() - 0.5) * st.footprintW[i] * CELL;
        const jitterZ = (s.rng.next() - 0.5) * st.footprintH[i] * CELL;
        this.channels.fx.push(
          FxKind.RepairSpark,
          st.posX[i] + jitterX, st.posY[i] + 2.4, st.posZ[i] + jitterZ,
          0, 1, 0, 1, st.handleOf(i), st.faction[i] as Faction,
        );
      } else {
        this.sparkTimer.setAt(i, t);
      }
    }
    this.stats.repairing = active;
  }

  /** Fallback when no Economy service is live (tests, early boot). */
  private spendDirect(player: PlayerId, amount: number): number {
    const p = this.world.players[player as number];
    if (p === undefined) return 0;
    const paid = Math.min(amount, Math.max(0, p.credits));
    if (paid <= 0) return 0;
    p.credits -= paid;
    p.stats.creditsSpent += paid;
    return paid;
  }

  /* -- stance ------------------------------------------------------------ */

  /**
   * The one write to `store.stance[]` after spawn. `Combat.ts` (HoldFire) and
   * `Targeting.ts` (`stanceAllowsAcquire`) already read it correctly; they were
   * simply never given anything but Aggressive to read.
   */
  applyStance(player: PlayerId, ids: Int32Array, count: number, stance: Stance): number {
    const st = this.world.store;
    let changed = 0;
    for (let e = 0; e < count; e++) {
      const i = st.index(ids[e] as EntityId);
      if (i < 0) continue;
      if ((st.flags[i] & EntityFlag.PendingDestroy) !== 0) continue;
      if (st.owner[i] !== (player as number)) continue;
      if (st.stance[i] === (stance as number)) continue;
      st.stance[i] = stance;
      // Defensive and HoldGround both mean "here is where you belong". Stamping
      // the guard point at the moment the stance is set is what makes the leash
      // Steering already implements point at somewhere the player chose.
      if (stance === Stance.Defensive || stance === Stance.HoldGround) {
        st.guardX[i] = st.posX[i];
        st.guardZ[i] = st.posZ[i];
      }
      changed++;
    }
    this.stats.stanceChanges += changed;
    return changed;
  }

  /* -- self destruct ----------------------------------------------------- */

  /**
   * Blow up your own unit. Routed through the DamageQueue rather than
   * `markDead` so it explodes, leaves a wreck and splashes whatever is standing
   * next to it — which is the entire reason a player ever presses this.
   */
  selfDestruct(player: PlayerId, target: EntityId): boolean {
    const st = this.world.store;
    const i = st.index(target);
    if (i < 0) return false;
    if (st.owner[i] !== (player as number)) return false;
    const f = st.flags[i];
    if ((f & EntityFlag.Alive) === 0 || (f & EntityFlag.PendingDestroy) !== 0) return false;
    const kind = st.kind[i];
    if (kind !== EntityKind.Infantry && kind !== EntityKind.Vehicle) return false;

    const amount = Math.max(st.hp[i] * 2, st.maxHp[i] * REPAIR.selfDestructDamageFrac);
    this.channels.damage.push(
      NONE, NONE, amount, WarheadClass.HighExplosive,
      st.posX[i], st.posY[i] + 1.0, st.posZ[i],
      REPAIR.selfDestructSplash, 0.3,
    );
    // The splash record above has no direct target, so make sure the volunteer
    // itself is unambiguously lethal-hit too.
    this.channels.damage.push(
      target, NONE, amount, WarheadClass.HighExplosive,
      st.posX[i], st.posY[i] + 1.0, st.posZ[i], 0, 0,
    );
    this.channels.fx.push(
      FxKind.ExplosionMedium, st.posX[i], st.posY[i] + 1.0, st.posZ[i],
      0, 1, 0, 1.4, target, st.faction[i] as Faction,
    );
    this.world.vfx.shake(0.28);
    this.stats.selfDestructs++;
    return true;
  }

  /* -- sell survivors ---------------------------------------------------- */

  private onSold(building: EntityId, player: PlayerId): void {
    const st = this.world.store;
    const i = st.index(building);
    if (i < 0) return;
    if (this.crewCount >= CREW_CAPACITY) return;
    const area = Math.max(1, st.footprintW[i]) * Math.max(1, st.footprintH[i]);
    const count = Math.min(REPAIR.maxSurvivors, Math.max(1, Math.round(area * REPAIR.survivorsPerCell)));
    const rec = this.crew[this.crewCount++];
    rec.player = player as number;
    rec.x = st.posX[i];
    rec.z = st.posZ[i];
    rec.count = count;
    // Stop paying to repair a structure that no longer exists.
    this.repairing.setAt(i, 0);
  }

  /** Spawn everything the sell events queued, deterministically. */
  private drainCrew(s: SimContext): void {
    if (this.crewCount === 0) return;
    const svc = production();
    const n = this.crewCount;
    this.crewCount = 0;
    if (svc === null) return;

    for (let c = 0; c < n; c++) {
      const rec = this.crew[c];
      const p = this.world.players[rec.player];
      if (p === undefined) continue;
      const key = SURVIVOR_KEY[p.faction as number] ?? 'gi';
      const entry = svc.catalog.byKey(key);
      if (entry === null) continue;

      for (let k = 0; k < rec.count; k++) {
        const angle = (k / rec.count) * Math.PI * 2 + s.rng.next() * 0.4;
        const r = CELL + REPAIR.survivorMargin + s.rng.next() * CELL;
        const id = svc.spawnUnit(
          p, entry,
          rec.x + Math.sin(angle) * r,
          rec.z + Math.cos(angle) * r,
          angle,
        );
        if (id === NONE) break;
        const i = this.world.store.index(id);
        // They run. A crew that walks out of a building it just sold and then
        // stands there is the difference between a game and a spreadsheet.
        if (i >= 0) this.world.store.state[i] = UnitState.Idle;
        this.stats.survivorsSpawned++;
      }
    }
  }

  dispose(): void {
    this.unhookSold?.();
    this.unhookSold = null;
    this.crewCount = 0;
  }
}

/* ==========================================================================
 * 4. MODULE ACCESSOR
 * ========================================================================== */

let active: RepairSellService | null = null;

export function setRepairSellService(next: RepairSellService | null): void {
  active = next;
}

export function repairSellService(): RepairSellService | null {
  return active;
}
