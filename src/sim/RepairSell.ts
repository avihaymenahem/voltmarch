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
  CommandKind, CreditReason, EntityFlag, EntityKind, Faction, FACTION_COUNT, FxKind,
  NONE, OrderKind, Stance, UnitState, WarheadClass,
} from '../core/types';
import type { Command, EntityId, PlayerId, SimContext } from '../core/types';
import { CELL, REPAIR_COST_PER_HP, REPAIR_DEPOT, REPAIR_RATE } from '../core/config';

import { BuildKind, production } from './Production';
import { getEconomy } from './Economy';

/* ==========================================================================
 * 1. TUNING
 * ========================================================================== */

/**
 * The line infantry that walks out of a sold structure, keyed by `Faction`.
 * A Pact building selling into a squad of G.I.s would hand the player free
 * units of an army they are not playing.
 *
 * WHICH IS EXACTLY WHAT THE RECLAMATION GOT, FROM v1.25.0 UNTIL THIS COMMIT.
 * The declared type was `readonly string[]` — an array has no opinion about its
 * own length — so the table sat at FOUR entries against `FACTION_COUNT` 5 while
 * a fifth army landed, and `SURVIVOR_KEY[Faction.Reclaim]` was `undefined`. The
 * `?? 'gi'` at the read site turned that into a plausible wrong answer: a
 * Reclamation Foundry sold G.I.s. `tsc` cannot see a hole in an array type, so
 * nothing anywhere reported it.
 *
 * Keyed by the enum with no optional members, an army left out is
 * `TS2741: Property '[Faction.Reclaim]' is missing`, and a sixth faction breaks
 * this literal on the commit that adds it. Same idiom as `FACTION_NAMES` in
 * `src/shell/Diagnostics.ts`, and it is what `FACTION_KEY_MAP` in
 * `src/game/Scenarios.ts` asks for in prose ("EVERY ROW MUST BE `FACTION_COUNT`
 * LONG") and has no way to enforce.
 *
 * The five values ARE `FACTION_KEY_MAP.gi`, entry for entry — that table maps a
 * shared layout's `gi` onto each army's line infantryman and was authored
 * independently of this one, so it is a second witness rather than a copy.
 * `Faction.Neutral` reads the Allied answer, which is what shipped and what
 * `GAIA_SLOT` in `src/art/faction-models.ts` chooses for the same reason.
 */
export const SURVIVOR_KEY: Readonly<Record<Faction, string>> = {
  [Faction.Neutral]: 'gi',
  [Faction.Allies]: 'gi',
  [Faction.Soviets]: 'conscript',
  [Faction.Meridian]: 'mrdWayfarer',
  [Faction.Reclaim]: 'rclPicker',
};

/**
 * The key one army reads — and the one thing the table's type cannot promise.
 *
 * `Record<Faction, …>` makes a MISSING ROW a compile error. It does NOT make the
 * INDEX safe, and the two are different guards. `PlayerState.faction` is a
 * runtime value with two sources, and only one of them is checked:
 *
 *   wire   BOUNDED. `src/net/Session.ts` and `server/src/index.ts` both refuse a
 *          seated faction outside `WIRE_LIMITS.factions` before it is relayed,
 *          and both say why.
 *   save   NOT BOUNDED. `src/game/SaveGame.ts` reads the player chunk with
 *          `JSON.parse(...) as PlayerSection[]` and hands it straight to
 *          `world.addPlayer(ps.faction as Faction, …)` with no range test, so a
 *          corrupt or hand-edited slot really can present a faction of 9 here.
 *
 * So the clamp stays and it is reachable. What it is NOT is the `?? 'gi'` it
 * replaces: that one covered a missing ROW, which is exactly the `rclPicker`
 * hole above and is now unrepresentable. Left in place over a total table it
 * would have been dead code that reads like a guard — which is how the hole
 * survived being looked at.
 */
export function survivorKeyFor(faction: Faction): string {
  const f = faction as number;
  return SURVIVOR_KEY[f >= 0 && f < FACTION_COUNT ? (f as Faction) : Faction.Neutral];
}

/**
 * Content keys that service vehicles. Three, not four: `repairDepot` is a
 * `Faction.Neutral` def, which in this codebase means "both original armies"
 * — the Allied and Soviet architectures are two MASS LISTS behind one def, the
 * way `radar` and `battleLab` already work.
 *
 * Resolved to def ids once, against the live catalog. There is deliberately no
 * fallback list: a depot is content, and a boot with no content module has no
 * depots to find.
 *
 * EXPORTED SO THERE IS ONE DEFINITION. `src/sim/tip-rows.ts` names a depot to
 * the player and has to select the same three entries this class services
 * vehicles from; a private copy over there is how a fourth army's depot would
 * come to exist on one side of the pair and not the other.
 */
export const DEPOT_KEYS: readonly string[] = ['repairDepot', 'mrdDepot', 'rclDepot'];

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
   *
   * SETTING A STANCE ALSO SETS THE POST, FOR ALL FOUR OF THEM.
   *
   * The line here used to stamp `guardX/guardZ` for `Defensive` and
   * `HoldGround` only, under a comment saying those two "both mean here is
   * where you belong" and that this is what points "the leash Steering already
   * implements" at a spot the player chose. Every clause of that was wrong.
   * There was no leash when it was written — `GUARD_LEASH` was read nowhere and
   * `guardX/guardZ` were written by six modules and consumed by none, which is
   * the defect v2.3.0's §LEASH section exists to record. It is `sim/Targeting.ts`
   * and not `Steering` that reads the post. And the two stances it named are not
   * the two that need it.
   *
   * Read `Targeting.holdPost` for who actually consumes the post, and the answer
   * is nearly the opposite of the old pair:
   *
   *   Aggressive  the post anchors BOTH halves of the excursion — the chase
   *               envelope is measured post-to-target, and the walk home ends
   *               at the post. It reads it hardest and was not stamped.
   *   Defensive   `STANCE_CHASE_METRES` 0, `STANCE_RETURNS` true: it never
   *               leaves, but it does walk back. Reads the post. Stamped.
   *   HoldFire    identical to Defensive for movement — 0 and true — and
   *               differs only in never pulling the trigger. Reads the post
   *               exactly as much as Defensive does, and was not stamped.
   *   HoldGround  `STANCE_RETURNS` false, so every branch of `holdPost` ends in
   *               `settle()` and the unit stands still whatever the post says.
   *               It is the ONE stance whose behaviour the post cannot change,
   *               and it was stamped.
   *
   * So the old pair covered one stance that ignores the post and missed two
   * that obey it. The fix is not a better pair, because there isn't one: the
   * post is a property of the UNIT, not of the stance, and clicking a stance
   * button is the player pointing at where the selection is standing right now.
   * Stamping unconditionally is also what stops the gesture meaning two
   * different things — before this, switching a displaced unit to Defensive
   * settled it where it stood while switching it to Aggressive sent it walking
   * back to a post it may have left minutes ago.
   *
   * HoldGround keeps the stamp for the same reason: it is inert while the
   * stance stands, and it is the post the unit inherits the moment the player
   * switches it to something that moves.
   *
   * THE ONE EXCEPTION IS AN EXPLICIT GUARD ORDER. `OrderKind.Guard` is the
   * player having already named the post, by name, at a point of their
   * choosing — and a unit is usually still DRIVING there when the order is
   * young. Overwriting it with the unit's current position cancels the order in
   * everything but the `orderKind` column: `holdPost` finds itself already at
   * its post, `settle()` pins the goal where it stands, and the guard point the
   * player clicked is gone with nothing logged. `Steering` refuses to re-take
   * the post under the same condition and says so; this now matches it. Stance
   * and orders are orthogonal (see the `Stance` docstring: "NONE OF THIS
   * APPLIES TO AN EXPLICIT ORDER"), so a stance click must not quietly consume
   * one.
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
      // AND NOT A HARVESTER, WHOSE GUARD POST IS NOT A POST. `guardX/guardZ` is
      // the ore ANCHOR for a harvester (§ANCHOR in sim/Harvesting.ts) — the
      // centre of the leash disc that decides which patch it works. A mining
      // harvester carries `orderKind = Harvest`, stamped every tick by
      // `setDest`, so the Guard test above lets it straight through and a
      // stance click on any selection containing a miner silently moved its
      // patch to wherever the hull happened to be standing — the refinery
      // apron, as often as not. Both of `Steering`'s guard-post stamp sites
      // already skip harvesters and say why; this was the third one, and it
      // was missed because stance is not an order.
      if (st.orderKind[i] !== OrderKind.Guard
        && (st.flags[i] & EntityFlag.IsHarvester) === 0) {
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
      const key = survivorKeyFor(p.faction);
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
