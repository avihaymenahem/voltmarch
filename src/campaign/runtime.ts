/**
 * ============================================================================
 * VOLTMARCH — src/campaign/runtime.ts
 * ============================================================================
 * THE TWO PORTS, IMPLEMENTED AGAINST THE REAL WORLD, PLUS THE TAG REGISTRY.
 *
 * `Director.ts` is a pure evaluator over `WorldQuery` and `EffectSink`. This is
 * where those become the entity store, the economy and the production service.
 * Nothing in here is imported by `campaign.system.ts` statically — it arrives
 * through `campaign-install.ts`, which is the only bundle boundary that matters.
 *
 * ============================================================================
 * TAGS, AND WHY THEY ARE HANDLES RATHER THAN A COLUMN
 * ============================================================================
 * A trigger names ground truth by a string: `entityDead: 'tap'`. Three shapes
 * were possible and two are wrong here:
 *
 *   - **An `EntityStore` column.** The store's own header says the column list
 *     is FROZEN and a module needing per-entity data allocates its own side
 *     table. Also a tag is a string, and the store is typed arrays.
 *   - **A `PerEntityObj<string>` plus a scan.** Correct storage, but answering
 *     "how many entities carry 'derrick'" would walk `store.alive` — up to 4096
 *     slots, per condition, per trigger, every tick.
 *   - **A `Map<string, EntityId[]>`,** which is what this is. Tagged sets are
 *     tiny (three derricks, one convoy, a wave of six) and every read prunes
 *     dead handles as it goes, so the cost is proportional to the tag rather
 *     than to the world.
 *
 * **A HANDLE CARRIES ITS GENERATION, AND THAT IS THE ENTIRE SAFETY ARGUMENT.**
 * `flushDestroyed` bumps `store.gen[i]` and returns the slot to the free list,
 * so a stale handle fails `isAlive` rather than resolving against whatever
 * recycled the slot. That is the `carrierId` defect — a squad reappearing
 * inside a stranger's building — and it is avoided here by construction rather
 * than by remembering to check.
 *
 * **A SAVE CANNOT STORE THESE HANDLES RAW.** A restore re-allocates every
 * entity and every generation moves, so `CHUNK_CMPN` stores save-local INDICES
 * and remaps them exactly as `REF_COLUMNS` does. `snapshot()` and `restore()`
 * below take the mapping functions as parameters for that reason; they do not
 * know what a save is.
 * ========================================================================== */

import { CreditReason, EntityFlag, EntityKind, NONE, OrderKind } from '../core/types';
import type { EntityId, PlayerId } from '../core/types';
import type { World } from '../core/world';
import { getEconomy } from '../sim/Economy';
import { production } from '../sim/Production';
import { isBeaten, makeViabilitySurvey, surveyViability } from '../sim/Viability';
import type { Channels } from '../core/events';
import type {
  Area, CountRole, EffectSink, Point, SpawnReport, TaggedOrder, WorldQuery,
} from './types';

/* ==========================================================================
 * 1. THE TAG REGISTRY
 * ========================================================================== */

export class TagRegistry {
  private readonly byTag = new Map<string, EntityId[]>();

  /** Every tag that has ever been stamped, whether or not anything survives. */
  get tags(): readonly string[] {
    return [...this.byTag.keys()];
  }

  add(tag: string, id: EntityId): void {
    if (id === NONE) return;
    const list = this.byTag.get(tag);
    if (list === undefined) this.byTag.set(tag, [id]);
    else list.push(id);
  }

  /**
   * Live handles for a tag, pruned in place.
   *
   * Returns the INTERNAL array. No caller in this file retains it past its own
   * call, and none calls `live` twice with a first result still in hand — which
   * is the property that matters and is weaker than "reads it within the same
   * statement", which this used to claim and which `orderTagged` does not do:
   * it holds the array across a loop. That is deliberate — the alternative is
   * an allocation per condition per tick.
   */
  live(store: World['store'], tag: string): readonly EntityId[] {
    const list = this.byTag.get(tag);
    if (list === undefined) return EMPTY;
    let w = 0;
    for (let i = 0; i < list.length; i++) {
      const id = list[i];
      if (!store.isAlive(id)) continue;
      const idx = store.index(id);
      // PendingDestroy is "already gone" to every system that reads it, and
      // `campaign.system` runs at Cleanup order 9000 — after the flush at
      // order 0 — so this is belt and braces for anything killed later in the
      // same tick than the flush.
      if ((store.flags[idx] & EntityFlag.PendingDestroy) !== 0) continue;
      list[w++] = id;
    }
    list.length = w;
    return list;
  }

  /** Drop every tag. Between operations. */
  clear(): void {
    this.byTag.clear();
  }

  /**
   * `tag -> save-local indices`, for `CHUNK_CMPN`.
   *
   * `localOf` is the same slot-to-save-index map `writeEntities` builds. A
   * handle it does not know about is dropped rather than written as a
   * sentinel: an entity absent from the entity chunk is an entity that will not
   * exist after the restore, so a tag pointing at it is meaningless.
   */
  snapshot(
    store: World['store'], localOf: (id: EntityId) => number,
  ): readonly { tag: string; ids: readonly number[] }[] {
    const out: { tag: string; ids: number[] }[] = [];
    for (const tag of this.byTag.keys()) {
      const ids: number[] = [];
      for (const id of this.live(store, tag)) {
        const local = localOf(id);
        if (local >= 0) ids.push(local);
      }
      out.push({ tag, ids });
    }
    return out;
  }

  /** The inverse. `handleOf` maps a save-local index to a fresh handle. */
  restore(
    rows: readonly { tag: string; ids: readonly number[] }[],
    handleOf: (local: number) => EntityId,
  ): void {
    this.byTag.clear();
    for (const row of rows) {
      const list: EntityId[] = [];
      for (const local of row.ids) {
        const id = handleOf(local);
        if (id !== NONE) list.push(id);
      }
      this.byTag.set(row.tag, list);
    }
  }
}

const EMPTY: readonly EntityId[] = [];

/* ==========================================================================
 * 2. THE WORLD QUERY
 * ========================================================================== */

const IS_UNIT = (kind: number): boolean => kind === EntityKind.Infantry || kind === EntityKind.Vehicle;

export function makeWorldQuery(world: World, tags: TagRegistry): WorldQuery {
  const store = world.store;
  // One reusable survey. `Viability`'s own header says never to allocate one
  // per frame, and this is called once per `playerBeaten` condition per tick.
  const survey = makeViabilitySurvey();

  const countRole = (slot: number, role: CountRole): boolean => {
    const kind = store.kind[slot];
    switch (role) {
      case 'any': return true;
      case 'unit': return IS_UNIT(kind);
      case 'building': return kind === EntityKind.Building;
      case 'producer':
        return (store.flags[slot] & (EntityFlag.IsBuilder | EntityFlag.IsFactory)) !== 0;
      case 'harvester':
        return (store.flags[slot] & EntityFlag.IsHarvester) !== 0;
      default: return false;
    }
  };

  const taggedSlots = (tag: string, out: number[]): number[] => {
    out.length = 0;
    for (const id of tags.live(store, tag)) out.push(store.index(id));
    return out;
  };

  const scratch: number[] = [];

  return {
    aliveWithTag(tag) {
      return tags.live(store, tag).length;
    },

    weakestHpFrac(tag) {
      let worst = -1;
      for (const id of tags.live(store, tag)) {
        const i = store.index(id);
        const max = store.maxHp[i];
        if (max <= 0) continue;
        const f = store.hp[i] / max;
        if (worst < 0 || f < worst) worst = f;
      }
      return worst;
    },

    ownerOfTag(tag) {
      const list = tags.live(store, tag);
      return list.length === 0 ? -1 : store.owner[store.index(list[0])];
    },

    unitsInArea(player, area, tag) {
      const r2 = area.r * area.r;
      let n = 0;
      if (tag !== null) {
        for (const slot of taggedSlots(tag, scratch)) {
          if (store.owner[slot] !== player) continue;
          if (!IS_UNIT(store.kind[slot])) continue;
          if (inside(store.posX[slot], store.posZ[slot], area, r2)) n++;
        }
        return n;
      }
      // No tag: walk the alive list. Bounded by the world rather than by the
      // tag, which is why an untagged `unitsInArea` is the expensive spelling
      // and the authoring guidance is to tag the thing you mean.
      const alive = store.alive;
      const count = store.aliveCount;
      for (let a = 0; a < count; a++) {
        const slot = alive[a];
        if (store.owner[slot] !== player) continue;
        if (!IS_UNIT(store.kind[slot])) continue;
        if ((store.flags[slot] & EntityFlag.PendingDestroy) !== 0) continue;
        if (inside(store.posX[slot], store.posZ[slot], area, r2)) n++;
      }
      return n;
    },

    ownerCount(player, role, tag) {
      let n = 0;
      if (tag !== null) {
        for (const slot of taggedSlots(tag, scratch)) {
          if (store.owner[slot] !== player) continue;
          if (countRole(slot, role)) n++;
        }
        return n;
      }
      const alive = store.alive;
      const count = store.aliveCount;
      for (let a = 0; a < count; a++) {
        const slot = alive[a];
        if (store.owner[slot] !== player) continue;
        if ((store.flags[slot] & EntityFlag.PendingDestroy) !== 0) continue;
        // UNDER CONSTRUCTION IS NOT BUILT. A hold objective that counted a
        // foundation would complete before the derrick existed.
        if ((store.flags[slot] & EntityFlag.UnderConstruction) !== 0) continue;
        if (countRole(slot, role)) n++;
      }
      return n;
    },

    creditsOf(player) {
      return world.players[player]?.credits ?? 0;
    },

    isBeaten(player) {
      const p = world.players[player];
      if (p === undefined) return false;
      surveyViability(world, p.id, survey);
      return isBeaten(survey);
    },
  };
}

function inside(x: number, z: number, area: Area, r2: number): boolean {
  const dx = x - area.x;
  const dz = z - area.z;
  return dx * dx + dz * dz <= r2;
}

/* ==========================================================================
 * 3. PRESENTATION, QUEUED RATHER THAN DONE
 * ========================================================================== */

/**
 * What the sim half hands the shell half.
 *
 * Dialogue, EVA and the camera are presentation and the sim may not touch
 * them — `outcome.system.ts`'s header states the property this borrows: it
 * "writes nothing the sim reads, so `npm run soak`'s AI-vs-AI replays are
 * byte-identical with it loaded". A queue keeps that true and keeps the shell
 * half free to drop everything on a fast-forward without the world noticing.
 *
 * **IT IS DECLARED TWICE AND NOTHING IMPORTS THIS COPY.** `session.ts` carries
 * a structurally identical `PresentationEvent`, and that is the one every
 * consumer names — `campaign-install.ts`, `campaign.system.ts` and
 * `Shell.playCampaignBeat`. `makeEffectSink`'s `present` parameter is typed
 * against THIS one and the call site passes the OTHER one, which compiles only
 * because the two shapes agree structurally. The duplication is the price of
 * the bundle boundary: `session.ts` is entry-chunk reachable and may not import
 * this file, and it declares `TagRegistry` structurally for the same reason and
 * says so. **Add a field to one and you must add it to the other**, or the seam
 * fails at `makeEffectSink`'s argument rather than anywhere near the change.
 */
export interface PresentationEvent {
  readonly kind: 'dialogue' | 'eva' | 'camera' | 'objectives' | 'ended';
  readonly speaker?: string;
  readonly text?: string;
  readonly line?: string;
  readonly at?: Point;
}

/* ==========================================================================
 * 4. THE EFFECT SINK
 * ========================================================================== */

export interface SinkHooks {
  /** Called for every objective transition, so the shell can republish. */
  onObjective(id: string, status: 'active' | 'complete' | 'failed'): void;
  onEnd(result: 'win' | 'loss', reason: string): void;
  /** A spawn that could not place everything it was asked for. */
  onSpawnFault(key: string, asked: number, placed: number, why: string): void;
}

export function makeEffectSink(
  world: World,
  channels: Channels,
  tags: TagRegistry,
  present: PresentationEvent[],
  hooks: SinkHooks,
): EffectSink {
  const store = world.store;
  const orderScratch = new Int32Array(256);

  return {
    setObjective(id) { hooks.onObjective(id, 'active'); },
    completeObjective(id) { hooks.onObjective(id, 'complete'); },
    failObjective(id) { hooks.onObjective(id, 'failed'); },

    /**
     * REINFORCEMENTS, AND THE FAULT PATH IS THE POINT.
     *
     * `Production.spawnUnit` returns `NONE` on a missing `FALLBACK_UNITS` row
     * and on an exhausted entity budget, and FOUR of its five other sim callers
     * throw that away in silence: `Crates.ts` continues, `RepairSell.ts` breaks,
     * and both sites in `Production.ts` return false, none of them logging. A
     * wave that quietly arrives empty is the most plausible way an operation
     * becomes unwinnable with every test green, so every miss is counted and
     * raised.
     *
     * **THIS SAID "BOTH existing sim callers" AND THERE ARE FIVE** — `Crates`,
     * `Deploy`, `RepairSell` and two in `Production` — and the fifth is the
     * counterexample rather than a fourth instance of the rule: `Deploy.ts` says
     * `EvaLine.CannotDeployHere` and increments `counters.refused`, which is a
     * refusal the player HEARS. Recount the callers before quoting them; the
     * pair was true when the sink was written and nothing re-read it since.
     *
     * ======================================================================
     * `byKey` IS LITERAL AND DOES NOT GO THROUGH `keyFor`. THAT IS DECIDED,
     * NOT MISSED.
     * ======================================================================
     * `ScenarioBuilder.spawnUnit` remaps every key through
     * `ScenarioBuilder.keyFor`, so a LAYOUT's `grizzly` becomes the seated
     * army's own main battle tank. This path does not, and the two used to
     * disagree in a way nothing could see: `store.alloc` takes the DEF from
     * the key and the COLOUR from the seat, so a wave authored `grizzly` on a
     * Reclamation seat was an Allied tank in Reclamation paint, silently.
     *
     * The disagreement is not fixed by remapping here. Three reasons, in
     * ascending order:
     *
     *   1. **A layout is geometry reused across armies; an operation is
     *      content written for one.** `keyFor` exists because
     *      `buildAlliedBase` has to work for a Meridian player. A trigger
     *      table is authored against ONE foe, which `OperationDef.foe` now
     *      declares, so the remap has nothing left to resolve.
     *   2. **A remap could not do the job anyway.** `FACTION_KEY_MAP` covers
     *      45 ROLE keys (counted 2026-08-19; this said "~30", and the fourteen
     *      naval and dock rows in that table are almost exactly the difference)
     *      and returns everything else unchanged, so `rclGrinder` on an Allied
     *      seat would remap to itself.
     *      Half a rule is worse than none, because it reads as coverage — and
     *      the count moving is the point: a coverage table that grows is one
     *      nobody can quote a completeness argument from.
     *   3. **It would rewrite an authoring mistake into a working wave.** The
     *      dialogue would still name the wrong army and nothing would say so —
     *      the exact class of quiet falsehood `docs/SPEC_DRIFT_AUDIT.md`
     *      catalogues.
     *
     * `validateCampaign` refuses a key whose `FallbackUnit.faction` is neither
     * `Neutral` nor the army of the seat it lands on, AT IMPORT. So the two
     * paths no longer disagree — not because they were made the same, but
     * because the case in which they differ is a build error.
     */
    spawnUnits(player, key, count, at, spread, facingDeg, tag): SpawnReport {
      const svc = production();
      const p = world.players[player];
      if (svc === null || p === undefined) {
        hooks.onSpawnFault(key, count, 0, svc === null ? 'no production service' : `no seat ${player}`);
        return { asked: count, placed: 0 };
      }
      const entry = svc.catalog.byKey(key);
      if (entry === null) {
        hooks.onSpawnFault(key, count, 0, 'no catalog entry');
        return { asked: count, placed: 0 };
      }

      let placed = 0;
      for (let i = 0; i < count; i++) {
        // A DETERMINISTIC RING, NOT A RANDOM SCATTER. `s.rng` would work and is
        // legal here, but a fixed ring means the same wave lands in the same
        // shape in the recording, in the playback and in a designer's third
        // run — which is what makes an operation tunable at all.
        const angle = (i / Math.max(1, count)) * Math.PI * 2;
        const x = at.x + Math.cos(angle) * spread;
        const z = at.z + Math.sin(angle) * spread;
        const id = svc.spawnUnit(p, entry, x, z, facingDeg);
        if (id === NONE) continue;
        placed++;
        if (tag !== '') tags.add(tag, id);
      }
      if (placed < count) {
        hooks.onSpawnFault(key, count, placed, placed === 0 ? 'every spawn refused' : 'partial wave');
      }
      return { asked: count, placed };
    },

    /**
     * ORDERS GO ON THE BUS, AND THE PHASE PLACEMENT IS WHAT MAKES THAT SAFE
     * UNDER PLAYBACK.
     *
     * `campaign.system.ts` is `Phase.Cleanup` order 9000, so an order issued
     * here lands on the bus AFTER this tick's Command phase and is drained on
     * tick N+1. During recording it is therefore recorded at N+1 and applied at
     * N+1. During playback the Director re-derives the same order at Cleanup of
     * tick N — and `playback.system.ts` (Phase.Command order 1) HARVESTS the
     * bus at the start of tick N+1, throwing the re-derived copy away, before
     * feeding the recorded one. So it applies exactly once, at the same tick,
     * either way.
     *
     * That is trap 2 in `Replay.ts` — a command that crosses the bus twice —
     * avoided by the phase rather than by a flag. **Move this system earlier
     * than the Command-phase drain and the order applies twice on playback.**
     */
    orderTagged(tag, order, at) {
      const live = tags.live(store, tag);
      if (live.length === 0) return;
      const kind = ORDER_OF[order];
      let n = 0;
      let owner = -1;
      for (const id of live) {
        if (n >= orderScratch.length) break;
        const slot = store.index(id);
        if ((store.flags[slot] & EntityFlag.CanMove) === 0) continue;
        // ONE COMMAND PER OWNER. `Command.player` is a single seat and the
        // simulation refuses anything a seat does not own, so a tag spanning
        // two owners would silently drop half its units.
        if (owner < 0) owner = store.owner[slot];
        else if (store.owner[slot] !== owner) continue;
        orderScratch[n++] = id as number;
      }
      if (n === 0 || owner < 0) return;
      channels.commands.issueOrder(
        owner as PlayerId, kind, orderScratch, n, at?.x ?? 0, at?.z ?? 0, NONE, false,
      );
    },

    grantCredits(player, amount) {
      const eco = getEconomy();
      const p = world.players[player];
      if (eco === null || p === undefined) return;
      // `grant`, NOT `deposit`. A scripted reward must never evaporate at a
      // full silo; the permanent `capFloor` lift is its accepted cost, and
      // `oreWasted` is untouched because `Economy` only adds to it under
      // `CreditReason.Harvest` — so the end screen's "Ore Wasted" row stays a
      // statement about mining and needs no re-derivation.
      //
      // THIS NAMED A MISSION CALLED "Zero Waste" AND THERE IS NO SUCH MISSION.
      // `oreWasted` has exactly one reader in the product, `EndScreen.ts`'s
      // stat row; no `MissionRule` reads it and none ever did. The consequence
      // is unchanged and the citation was invented.
      eco.grant(p.id, amount, CreditReason.Bounty);
    },

    endOperation(result, reason) { hooks.onEnd(result, reason); },

    revealArea(player, area) {
      // `IVision` declares no reveal — `exploreCircle` lives on the concrete
      // `Vision` service. Duck-typed rather than imported, because the port is
      // the contract and a null-object vision (`OpenVision`) has nothing to
      // reveal and correctly does nothing here.
      const v = world.vision as { exploreCircle?: (p: PlayerId, x: number, z: number, r: number) => void };
      const p = world.players[player];
      if (p === undefined || typeof v.exploreCircle !== 'function') return;
      v.exploreCircle(p.id, area.x, area.z, area.r);
    },

    dialogue(speaker, text) { present.push({ kind: 'dialogue', speaker, text }); },
    eva(line) { present.push({ kind: 'eva', line }); },
    cameraMove(at) { present.push({ kind: 'camera', at }); },
  };
}

const ORDER_OF: Readonly<Record<TaggedOrder, OrderKind>> = {
  move: OrderKind.Move,
  attackMove: OrderKind.AttackMove,
  stop: OrderKind.Stop,
  guard: OrderKind.Guard,
};
