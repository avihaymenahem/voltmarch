/**
 * ============================================================================
 * VOLTMARCH — src/campaign/validate.ts
 * ============================================================================
 * EVERY AUTHORING MISTAKE THAT CAN BE CAUGHT BY READING, CAUGHT AT IMPORT.
 *
 * `src/data/Missions.ts` and `src/data/Defs.ts` both self-check on load and
 * this is the same mechanism pointed at the campaign, for a stronger reason:
 * an operation's failure mode is not a wrong number on a screen, it is a match
 * a player cannot finish, discovered at minute fourteen of nineteen. A typo in
 * an objective id has to be a build error.
 *
 * ============================================================================
 * IT TAKES THE WORLD AS FACTS RATHER THAN IMPORTING IT
 * ============================================================================
 * `validateCampaign(chapters, facts)`. The caller gathers `FALLBACK_UNITS`
 * keys, `MAP_PRESETS` keys, `UNLOCK_TAGS` ids and the tag set each layout
 * stamps, and hands them over. Three things fall out of that:
 *
 *   - this module imports nothing heavy, so it can run in a node test with no
 *     engine and no DOM;
 *   - a test can feed it a DELIBERATELY BROKEN campaign and assert the exact
 *     message, which is the only way to know a validator can fail at all;
 *   - the facts are gathered in ONE place (`index.ts`), so there is no second
 *     copy of "what a legal def key is" to drift.
 *
 * ============================================================================
 * WHAT IT REFUSES, AND WHY EACH ONE IS HERE
 * ============================================================================
 * Most of these exist because the equivalent mistake has already been made
 * somewhere in this repo and cost a cycle:
 *
 *   - **An operation with no authored win path and no authored lose path that
 *     also opts out of annihilation.** That is a match which cannot end. It is
 *     the single most expensive bug this feature can ship and it is entirely
 *     mechanical to detect.
 *   - **A tag a trigger names that its layout never stamps.** `entityDead` is
 *     TRUE before the tag exists, so a mistyped `protect` fails the player on
 *     tick one, in silence.
 *   - **A def key with no `FALLBACK_UNITS` row.** `Production.spawnUnit` reads
 *     that table BEFORE the def table and returns `NONE` with no warning, so
 *     the wave arrives empty and nothing anywhere says so.
 *   - **A restriction on an untagged def.** `UNLOCK_TAGS` is 33 defs; every
 *     other def is day-one open and the roster mechanism cannot express
 *     withholding one. An operation that tried would silently get everything.
 *   - **`primaryType` repeating adjacently within a chapter.** A chapter of
 *     nine assaults is the failure a beat grid cannot see from inside itself.
 *   - **`elapsedSinceArmed` under a `not`.** It reads true during the arming
 *     pass, so the negation reads false, so the trigger can never arm and can
 *     never fire. Defensible-looking and permanently dead.
 * ========================================================================== */

import { FACTION_COUNT, Faction } from '../core/types';
import { CONDITION_KINDS, COUNT_ROLES, EFFECT_KINDS, PRIMARY_TYPES, TAGGED_ORDERS } from './types';
import type {
  ChapterDef, Condition, Effect, ObjectiveDef, OperationDef, TriggerDef,
} from './types';

/** What the caller knows about the world that this module refuses to import. */
export interface CampaignFacts {
  /**
   * `FALLBACK_UNITS` — the table `Production.spawnUnit` reads first — mapped to
   * the army each row declares, with `Faction.Neutral` for the rows both sides
   * field (engineer, harvester, mcv).
   *
   * **ONE MAP RATHER THAN A KEY SET PLUS A FACTION SIDE-TABLE**, because the
   * membership test and the ownership test are two questions about the SAME
   * row and two facts could disagree. `FallbackUnit.faction` is the source for
   * both, gathered once in `index.ts`.
   */
  readonly unitFactions: ReadonlyMap<string, Faction>;
  /** Keys of `MAP_PRESETS`. */
  readonly mapPresets: ReadonlySet<string>;
  /** Every id in `UNLOCK_TAGS`. A roster may name these and nothing else. */
  readonly unlockIds: ReadonlySet<string>;
  /**
   * Every key of `EVA_LINES`.
   *
   * A `do: 'eva'` naming a line that does not exist is silent at runtime — the
   * announcer looks the id up, finds nothing, and says nothing. That is a beat
   * the designer wrote, heard in their head, and will never hear on the
   * machine. The first draft of S1 said `enemyUnitsApproaching`, which is not
   * an id; this check is why that was caught before it shipped rather than by
   * somebody noticing the silence.
   */
  readonly evaLines: ReadonlySet<string>;
  /** Layout id to the tag set that layout stamps. */
  readonly layoutTags: ReadonlyMap<string, ReadonlySet<string>>;
  /** Legal seat counts, inclusive. */
  readonly minArmies: number;
  readonly maxArmies: number;
}

const CONDITION_SET = new Set(CONDITION_KINDS);
const EFFECT_SET = new Set(EFFECT_KINDS);
const ROLE_SET = new Set<string>(COUNT_ROLES);
const ORDER_SET = new Set<string>(TAGGED_ORDERS);
const TYPE_SET = new Set<string>(PRIMARY_TYPES);

/** Collect, do not throw-on-first. A single run should report every fault. */
class Faults {
  readonly list: string[] = [];

  at(where: string, message: string): void {
    this.list.push(`${where}: ${message}`);
  }
}

/* ==========================================================================
 * 1. WALKERS
 * ========================================================================== */

/** Every tag any condition in this tree names. */
export function tagsUsedByCondition(c: Condition, out: Set<string>): void {
  switch (c.on) {
    case 'entityAlive':
    case 'entityDead':
    case 'entityHpBelow':
    case 'structureCaptured':
      out.add(c.tag);
      break;
    case 'unitsInArea':
    case 'ownerCount':
      if (c.tag !== undefined) out.add(c.tag);
      break;
    case 'all':
    case 'any':
      for (const k of c.of) tagsUsedByCondition(k, out);
      break;
    case 'not':
      tagsUsedByCondition(c.of, out);
      break;
    default:
      break;
  }
}

/** Every objective id any condition in this tree names. */
function objectivesUsedByCondition(c: Condition, out: Set<string>): void {
  switch (c.on) {
    case 'objectiveComplete':
    case 'objectiveFailed':
      out.add(c.id);
      break;
    case 'all':
    case 'any':
      for (const k of c.of) objectivesUsedByCondition(k, out);
      break;
    case 'not':
      objectivesUsedByCondition(c.of, out);
      break;
    default:
      break;
  }
}

/** True when an `elapsedSinceArmed` sits anywhere under a `not`. */
function armTimerUnderNot(c: Condition, negated = false): boolean {
  switch (c.on) {
    case 'elapsedSinceArmed':
      return negated;
    case 'all':
    case 'any':
      for (const k of c.of) if (armTimerUnderNot(k, negated)) return true;
      return false;
    case 'not':
      return armTimerUnderNot(c.of, !negated);
    default:
      return false;
  }
}

function checkCondition(c: Condition, where: string, f: Faults, seats: number): void {
  if (!CONDITION_SET.has(c.on)) {
    f.at(where, `unknown condition '${String(c.on)}'`);
    return;
  }
  switch (c.on) {
    case 'elapsed':
    case 'elapsedSinceArmed':
      if (!Number.isInteger(c.ticks) || c.ticks < 0) {
        f.at(where, `${c.on} wants a whole non-negative tick count, got ${String(c.ticks)}`);
      }
      break;
    case 'entityHpBelow':
      if (!(c.frac > 0) || c.frac > 1) f.at(where, `entityHpBelow frac must be in (0,1], got ${c.frac}`);
      break;
    case 'unitsInArea':
      if (c.min < 1) f.at(where, 'unitsInArea min must be at least 1');
      if (!(c.area.r > 0)) f.at(where, 'unitsInArea area needs a positive radius');
      checkSeat(c.player, where, f, seats);
      break;
    case 'ownerCount':
      if (!ROLE_SET.has(c.role)) f.at(where, `unknown ownerCount role '${c.role}'`);
      if (c.min === undefined && c.max === undefined) {
        // A bound-free `ownerCount` is always true, which is a trigger that
        // fires on tick one and reads as if it were waiting for something.
        f.at(where, 'ownerCount needs at least one of min/max — without one it is always true');
      }
      checkSeat(c.player, where, f, seats);
      break;
    case 'credits':
      if (c.min === undefined && c.max === undefined) {
        f.at(where, 'credits needs at least one of min/max');
      }
      checkSeat(c.player, where, f, seats);
      break;
    case 'structureCaptured':
    case 'playerBeaten':
      checkSeat(c.player, where, f, seats);
      break;
    case 'all':
    case 'any':
      if (c.of.length === 0) f.at(where, `${c.on} with no children is a constant`);
      for (let i = 0; i < c.of.length; i++) checkCondition(c.of[i], `${where}.${c.on}[${i}]`, f, seats);
      break;
    case 'not':
      checkCondition(c.of, `${where}.not`, f, seats);
      break;
    default:
      break;
  }
}

function checkSeat(seat: number, where: string, f: Faults, seats: number): void {
  if (!Number.isInteger(seat) || seat < 0 || seat >= seats) {
    f.at(where, `seat ${String(seat)} is outside the ${seats} this operation seats`);
  }
}

/**
 * The army a seat is fought with.
 *
 * SEAT 0 IS THE PLAYER AND EVERY OTHER SEAT IS THE FOE, and that is not a
 * guess about seating order: `Bootstrap` pins `world.localPlayer` to slot 0,
 * `Shell.applySetupToWorld` writes `setup.playerFaction` onto it, and
 * `Shell.startOperation` fills every remaining slot from `op.foe`.
 */
function armyOfSeat(op: OperationDef, seat: number): Faction {
  return seat === 0 ? op.faction : op.foe;
}

function checkEffect(
  e: Effect, where: string, f: Faults, facts: CampaignFacts, op: OperationDef,
): void {
  const seats = op.map.armies;
  if (!EFFECT_SET.has(e.do)) {
    f.at(where, `unknown effect '${String(e.do)}'`);
    return;
  }
  switch (e.do) {
    case 'spawnUnits': {
      const owns = facts.unitFactions.get(e.key);
      if (owns === undefined) {
        // The silent one. `Production.spawnUnit` reads `FALLBACK_UNITS` before
        // the def table and returns NONE with no console output at all, so the
        // wave simply never arrives.
        f.at(where, `spawnUnits key '${e.key}' has no FALLBACK_UNITS row — it would spawn nothing, silently`);
      } else if (
        owns !== Faction.Neutral
        && Number.isInteger(e.player) && e.player >= 0 && e.player < seats
        && owns !== armyOfSeat(op, e.player)
      ) {
        /*
         * THE HULL AND THE FLAG MUST AGREE, AND NOTHING ELSE MAKES THEM.
         *
         * `EffectSink.spawnUnits` resolves through `ProductionCatalog.byKey`,
         * which is faction-blind, and `ProductionService.spawnUnit` then calls
         * `store.alloc(kind, entry.defId, p.id, p.faction, …)` — the DEF comes
         * from the key and the COLOUR from the seat. So a `grizzly` on a Soviet
         * seat is an Allied tank in Soviet paint, placed with no warning
         * anywhere: not a console line, not a fault, not a `NONE` return.
         *
         * The layout path does not have this problem. `ScenarioBuilder.spawnUnit`
         * runs every key through `keyFor`, so a layout's `grizzly` becomes the
         * seated army's own main battle tank. Two spawn paths, two answers, and
         * the operation files carry comments in BOTH directions about it.
         *
         * THIS RULE IS THE RECONCILIATION AND IT IS DELIBERATELY NOT A REMAP.
         * An authored operation naming a hull means THAT hull — `t.rail` in
         * `03-deep-sector` writes "LITERAL SOVIET KEYS" and means it — and a
         * silent remap would rewrite an author's mistake into a working wave
         * whose dialogue still named the wrong army, which is the same class of
         * quiet falsehood as the defect this whole field exists to delete. It
         * also could not do the job: `FACTION_KEY_MAP` covers ~30 ROLE keys and
         * passes everything else through unchanged, so `rclGrinder` on an
         * Allied seat would remap to itself and the disagreement would survive
         * the fix. A build error covers EVERY key, because it reads the row's
         * own declared army rather than a remap table's coverage.
         *
         * Neutral rows (engineer, harvester, mcv) are legal on any seat, which
         * is exactly what `Faction.Neutral` means in `FallbackUnit.faction`.
         * The seat range is re-tested here rather than assumed because
         * `checkSeat` below only REPORTS an illegal seat, it does not stop this
         * arm — and `armyOfSeat(op, 7)` would otherwise answer `foe` for a seat
         * that does not exist and report a second fault for one mistake.
         */
        f.at(where, `spawnUnits key '${e.key}' is faction ${String(owns)} and seat `
          + `${String(e.player)} fields faction ${String(armyOfSeat(op, e.player))} — `
          + 'the authored hull would spawn flying the seat\'s colours');
      }
      if (!Number.isInteger(e.count) || e.count < 1) f.at(where, 'spawnUnits count must be at least 1');
      if (e.spread !== undefined && e.spread < 0) f.at(where, 'spawnUnits spread cannot be negative');
      checkSeat(e.player, where, f, seats);
      break;
    }
    case 'orderTagged':
      if (!ORDER_SET.has(e.order)) f.at(where, `unknown order '${e.order}'`);
      if ((e.order === 'move' || e.order === 'attackMove') && e.at === undefined) {
        f.at(where, `orderTagged '${e.order}' needs an 'at'`);
      }
      break;
    case 'grantCredits':
      if (!(e.amount > 0)) f.at(where, 'grantCredits wants a positive amount');
      checkSeat(e.player, where, f, seats);
      break;
    case 'revealArea':
      if (!(e.area.r > 0)) f.at(where, 'revealArea needs a positive radius');
      checkSeat(e.player, where, f, seats);
      break;
    case 'dialogue':
      if (e.speaker.trim() === '' || e.text.trim() === '') f.at(where, 'dialogue needs a speaker and a line');
      break;
    case 'eva':
      if (!facts.evaLines.has(e.line)) {
        f.at(where, `eva line '${e.line}' is not a key of EVA_LINES — the announcer would say nothing`);
      }
      break;
    default:
      break;
  }
}

/* ==========================================================================
 * 2. ONE OPERATION
 * ========================================================================== */

function checkOperation(op: OperationDef, f: Faults, facts: CampaignFacts): void {
  const where = op.id;
  const seats = op.map.armies;

  if (!TYPE_SET.has(op.primaryType)) f.at(where, `unknown primaryType '${op.primaryType}'`);
  /*
   * A NEUTRAL FOE IS GAIA, AND GAIA IS ALLIED TO EVERYONE.
   *
   * `ScenarioBuilder.gaia` sets both directions of `allyMask` for the Neutral
   * slot, so an operation seated against it would open with every trigger's
   * `playerBeaten` false forever, nothing hostile to shoot, and
   * `Shell.pollOutcome` — which skips allied seats — declaring victory at the
   * ten-second grace. Refused here rather than discovered there. Everything
   * else in the enum is a real army and a mirror match is a legal operation.
   */
  if (op.foe === Faction.Neutral) {
    f.at(where, 'foe is Faction.Neutral — that seat is Gaia, allied to every player');
  } else if (!Number.isInteger(op.foe as number) || (op.foe as number) < 0 || (op.foe as number) >= FACTION_COUNT) {
    f.at(where, `foe ${String(op.foe)} is not a Faction`);
  }
  if (!facts.mapPresets.has(op.map.preset)) f.at(where, `unknown map preset '${op.map.preset}'`);
  if (!Number.isInteger(seats) || seats < facts.minArmies || seats > facts.maxArmies) {
    f.at(where, `armies ${String(seats)} is outside ${facts.minArmies}..${facts.maxArmies}`);
  }
  if (!(op.parSec > 0)) f.at(where, 'parSec must be positive — it is what makes the length claim falsifiable');
  if (op.title.trim() === '') f.at(where, 'no title');
  if (op.beat.trim() === '') f.at(where, 'no beat line');

  /* -- objectives ------------------------------------------------------- */
  const declared = new Set<string>();
  let primaries = 0;
  for (const o of op.objectives) {
    if (declared.has(o.id)) f.at(where, `duplicate objective id '${o.id}'`);
    declared.add(o.id);
    if (o.kind === 'primary') primaries++;
    if (o.title.trim() === '') f.at(where, `objective '${o.id}' has no title`);
    if (o.credits !== undefined) {
      // PAYING FOR THE PRIMARY IS PAYING FOR PLAYING. The next operation is
      // what a primary pays, and that is an edge in the graph rather than a
      // `Reward` — with zero exposure to the wiring spec that declares
      // `credits` and `cosmetic` as gaps today.
      if (o.kind === 'primary') f.at(where, `objective '${o.id}' is primary and declares credits`);
      if (!(o.credits > 0)) f.at(where, `objective '${o.id}' declares a non-positive credit payout`);
    }
  }
  if (primaries === 0) f.at(where, 'no primary objective');

  /* -- triggers --------------------------------------------------------- */
  const triggerIds = new Set<string>();
  const tagsUsed = new Set<string>();
  const objectivesTouched = new Set<string>();
  let authoredWin = false;
  let authoredLoss = false;

  for (const t of op.triggers) {
    const tw = `${where}#${t.id}`;
    if (triggerIds.has(t.id)) f.at(where, `duplicate trigger id '${t.id}'`);
    triggerIds.add(t.id);
    if (t.then.length === 0) f.at(tw, 'a trigger with no effects');

    checkCondition(t.when, tw, f, seats);
    if (armTimerUnderNot(t.when)) {
      f.at(tw, 'elapsedSinceArmed sits under a not — it reads true while arming, so this can never fire');
    }
    tagsUsedByCondition(t.when, tagsUsed);
    objectivesUsedByCondition(t.when, objectivesTouched);

    for (let i = 0; i < t.then.length; i++) {
      const e = t.then[i];
      checkEffect(e, `${tw}[${i}]`, f, facts, op);
      if (e.do === 'endOperation') {
        if (e.result === 'win') authoredWin = true;
        else authoredLoss = true;
        if (e.reason !== undefined && !declared.has(e.reason)) {
          f.at(`${tw}[${i}]`, `endOperation reason '${e.reason}' is not an objective of this operation`);
        }
      }
      if (e.do === 'setObjective' || e.do === 'completeObjective' || e.do === 'failObjective') {
        objectivesTouched.add(e.id);
        if (!declared.has(e.id)) f.at(`${tw}[${i}]`, `${e.do} names undeclared objective '${e.id}'`);
      }
      if (e.do === 'orderTagged') tagsUsed.add(e.tag);
      if (e.do === 'spawnUnits' && e.tag !== undefined) {
        // A tag a spawn PRODUCES is not one the layout has to stamp.
        tagsUsed.delete(e.tag);
      }
    }
  }

  /* -- the match must be able to end ------------------------------------ */
  const canWin = authoredWin || op.outcome.annihilationWin;
  const canLose = authoredLoss || op.outcome.assetLossDefeat;
  if (!canWin) {
    f.at(where, 'no authored win path and annihilationWin is off — this match cannot be won');
  }
  if (!canLose) {
    f.at(where, 'no authored lose path and assetLossDefeat is off — this match cannot be lost');
  }
  for (const seat of op.outcome.ignoreSeats) checkSeat(seat, `${where}.ignoreSeats`, f, seats);

  /* -- every objective is referenced, every reference is declared -------- */
  for (const o of op.objectives) {
    if (!objectivesTouched.has(o.id)) {
      f.at(where, `objective '${o.id}' is declared and no trigger ever completes, fails or reveals it`);
    }
    if (o.hidden === true) {
      const revealed = op.triggers.some(
        (t: TriggerDef) => t.then.some((e: Effect) => e.do === 'setObjective' && e.id === o.id),
      );
      if (!revealed) f.at(where, `objective '${o.id}' is hidden and nothing reveals it`);
    }
  }

  /* -- tags exist on the ground ----------------------------------------- */
  const stamped = facts.layoutTags.get(op.layout);
  if (stamped === undefined) {
    f.at(where, `layout '${op.layout}' is not registered`);
  } else {
    for (const tag of tagsUsed) {
      if (!stamped.has(tag)) {
        f.at(where, `tag '${tag}' is named by a trigger and stamped by no layout entity — `
          + 'entityDead reads TRUE before a tag exists, so this fails on tick one');
      }
    }
  }

  /* -- roster ----------------------------------------------------------- */
  for (const id of [...op.roster.player, ...op.roster.ai]) {
    if (!facts.unlockIds.has(id)) {
      f.at(where, `roster names '${id}', which is not an UNLOCK_TAGS id — `
        + 'an operation may restrict only tagged content');
    }
  }
}

/* ==========================================================================
 * 3. THE WHOLE CAMPAIGN
 * ========================================================================== */

/**
 * Check every chapter. Returns the fault list; empty means clean.
 *
 * `index.ts` throws on a non-empty result AT IMPORT, which is what makes an
 * authoring mistake a build error. This function itself never throws, so a test
 * can feed it a broken campaign and read the messages.
 */
export function validateCampaign(
  chapters: readonly ChapterDef[],
  facts: CampaignFacts,
): readonly string[] {
  const f = new Faults();
  const byId = new Map<string, OperationDef>();
  const order: string[] = [];

  for (const ch of chapters) {
    if (ch.operations.length === 0) f.at(ch.id, 'a chapter with no operations');
    for (let i = 0; i < ch.operations.length; i++) {
      const op = ch.operations[i];
      if (byId.has(op.id)) f.at(op.id, 'duplicate operation id');
      byId.set(op.id, op);
      order.push(op.id);
      if (op.chapter !== ch.id) f.at(op.id, `declares chapter '${op.chapter}' but sits in '${ch.id}'`);
      if (op.faction !== ch.faction) f.at(op.id, 'faction disagrees with its chapter');
      if (op.index !== i + 1) f.at(op.id, `index ${op.index} but it is operation ${i + 1} of the chapter`);

      // ADJACENCY, INSIDE A CHAPTER ONLY. Two chapters may open with an
      // assault; one chapter may not run two in a row.
      const prev = i > 0 ? ch.operations[i - 1] : null;
      if (prev !== null && prev.primaryType === op.primaryType) {
        f.at(op.id, `primaryType '${op.primaryType}' repeats immediately after ${prev.id}`);
      }

      checkOperation(op, f, facts);
    }
  }

  /* -- the requires graph ------------------------------------------------ */
  const seen = new Set<string>();
  for (const id of order) {
    const op = byId.get(id);
    if (op === undefined) continue;
    for (const need of op.requires) {
      if (!byId.has(need)) {
        f.at(id, `requires '${need}', which is not an operation`);
        continue;
      }
      if (need === id) f.at(id, 'requires itself');
      // NO FORWARD REFERENCE. The table is authored in play order, so a
      // dependency on something later is either a typo or a cycle wearing a
      // disguise, and both are cheaper to refuse than to detect downstream.
      if (!seen.has(need)) f.at(id, `requires '${need}', which is declared later`);
    }
    seen.add(id);
  }

  // Acyclicity falls out of the no-forward-reference rule, but a cycle is the
  // one fault where a wrong answer is unrecoverable at runtime, so it is
  // checked directly rather than argued.
  for (const id of order) {
    const stack = [id];
    const visited = new Set<string>();
    let guard = 0;
    while (stack.length > 0 && guard++ < 10_000) {
      const cur = stack.pop() as string;
      const op = byId.get(cur);
      if (op === undefined) continue;
      for (const need of op.requires) {
        if (need === id) { f.at(id, `is in a requires cycle through '${cur}'`); stack.length = 0; break; }
        if (!visited.has(need)) { visited.add(need); stack.push(need); }
      }
    }
  }

  /* -- every operation is reachable from an opener ----------------------- */
  for (const ch of chapters) {
    const first = ch.operations[0];
    if (first !== undefined && first.requires.length > 0) {
      f.at(first.id, 'the first operation of a chapter requires something — nothing would open it');
    }
  }

  return f.list;
}

/** The sum of every authored par, in seconds. `campaign-length.spec.ts` reads it. */
export function totalParSeconds(chapters: readonly ChapterDef[]): number {
  let total = 0;
  for (const ch of chapters) for (const op of ch.operations) total += op.parSec;
  return total;
}

/** Flatten to one list in declared order. */
export function allOperations(chapters: readonly ChapterDef[]): readonly OperationDef[] {
  const out: OperationDef[] = [];
  for (const ch of chapters) for (const op of ch.operations) out.push(op);
  return out;
}

/** Objectives of one kind, in declared order. */
export function objectivesOfKind(
  op: OperationDef, kind: ObjectiveDef['kind'],
): readonly ObjectiveDef[] {
  return op.objectives.filter((o) => o.kind === kind);
}
