/**
 * ============================================================================
 * VOLTMARCH — src/campaign/campaign-install.ts
 * ============================================================================
 * THE DYNAMIC BOUNDARY. The ONLY importer of `Director.ts`, `index.ts`,
 * `runtime.ts` and `layouts/`.
 *
 * It is reached by exactly one `await import('../campaign/campaign-install')`,
 * from `Shell.startOperation`. Everything downstream of this file — the
 * evaluator, the operation table, 37 layouts — lands in its own chunk, so a
 * player who never opens the campaign never fetches a byte of it, and neither
 * does a `?shot=` boot or the title backdrop.
 *
 * `src/game/Systems.ts` globs `'../**\/*.system.ts'` with `eager: true` FROM
 * THE ENTRY CHUNK. That is the whole reason this file exists: without it,
 * `campaign.system.ts` would statically reach the Director, and the campaign
 * would be in front of every player's first paint. `campaign.system.ts` imports
 * `session.ts`, `policy.ts` and `types.ts` and nothing else, and
 * `tests/campaign-bundle-isolation.spec.ts` fails when that stops being true.
 *
 * ============================================================================
 * ARM, THEN BOOT — AND THE ORDER IS NOT NEGOTIABLE
 * ============================================================================
 * `armOperation` installs four things and then returns. `Shell.startOperation`
 * boots afterwards. Every one of the four has to be in place BEFORE the world
 * is built:
 *
 *   - **the scenario plan** (`setPlannedOperation`), because the terrain
 *     generator reserves one levelled shelf per seat and reads that number
 *     before anything stands on it;
 *   - **the layout** (`setCampaignLayout`), because `PLANS.campaign.build` runs
 *     during `bootstrap()`;
 *   - **the roster** (`setCampaignRoster`), because `Scenarios.ts` calls
 *     `isBuildable` WHILE SPAWNING THE STARTING ARMY — this is the tick-zero
 *     desync CLAUDE.md documents twice, and installing the roster afterwards
 *     would give the layout the player's profile instead of the operation's
 *     authored content;
 *   - **the outcome policy** (`setCampaignOutcomePolicy`), because
 *     `Shell.pollOutcome` starts asking at ten seconds of sim time and a
 *     scripted insertion holds zero assets long before that.
 *
 * `disarmOperation` clears all four plus the session and both progression
 * latches' callers. A latch with no clearing branch is a permanent behaviour
 * change wearing a temporary name, and `suppressUnlockGate` has leaked once
 * already.
 * ========================================================================== */

import { setCampaignRoster } from '../progression/UnlockGate';
import { setCampaignLayout, setPlannedOperation } from '../game/Scenarios';
import type { ScenarioBuilder, StartCondition } from '../game/Scenarios';
import { ctx } from '../game/context';
import { NONE } from '../core/types';
import type { EntityId, PlayerId } from '../core/types';

import { medalFor, newOperationState, runDirector } from './Director';
import { LAYOUTS, operationById } from './index';
import { setCampaignOutcomePolicy } from './policy';
import { makeEffectSink, makeWorldQuery, TagRegistry } from './runtime';
import { prepareOperation, endOperationSession } from './session';
import type { CampaignSession, ObjectiveRow, PresentationEvent } from './session';
import type {
  Effect, Medal, ObjectiveStatus, OperationDef, OperationState, EffectSink, WorldQuery,
} from './types';

/* ==========================================================================
 * 1. THE SESSION
 * ========================================================================== */

class Session implements CampaignSession {
  readonly state: OperationState;
  readonly tags = new TagRegistry();

  private readonly present: PresentationEvent[] = [];
  /** Reused every tick. `runDirector` appends; this file clears. */
  private readonly effects: Effect[] = [];
  private q: WorldQuery | null = null;
  private sink: EffectSink | null = null;
  private started = false;
  /** Every spawn that could not place what it was asked for. */
  readonly faults: string[] = [];

  constructor(readonly op: OperationDef, private readonly difficulty: number) {
    // `startTick` is re-stamped on the first real tick. A session armed before
    // the boot cannot know what tick the world will start on, and `elapsed`
    // measuring from the wrong zero is a silent minutes-long error.
    this.state = newOperationState(op, 0);
  }

  get outcome(): 'won' | 'lost' | null { return this.state.outcome; }
  get reason(): string { return this.state.reason; }

  medal(difficulty: number): Medal {
    return medalFor(this.op, this.state, difficulty);
  }

  /**
   * BIND ON THE FIRST TICK, NOT IN THE CONSTRUCTOR.
   *
   * `ctx()` throws outside `init`/`simTick`/`frame`/`dispose` by design, and
   * this object is constructed by the shell before `bootstrap()` has run. The
   * same reasoning `ReplayRecorder.captureStart` uses: the earliest moment all
   * of it is true and the latest moment none of it has changed.
   */
  private bind(): void {
    const { world, channels } = ctx();
    this.q = makeWorldQuery(world, this.tags);
    this.sink = makeEffectSink(world, channels, this.tags, this.present, {
      onObjective: (id, status) => { this.setObjective(id, status); },
      onEnd: (result, reason) => { this.end(result, reason); },
      onSpawnFault: (key, asked, placed, why) => {
        const line = `[campaign] ${this.op.id}: spawn '${key}' placed ${placed}/${asked} — ${why}`;
        this.faults.push(line);
        // LOUD. Both existing sim callers of `spawnUnit` treat a `NONE` return
        // as a silent `continue`, and a reinforcement wave that quietly arrives
        // empty is the most plausible way an operation becomes unwinnable with
        // every test green.
        console.error(line);
      },
    });
  }

  /**
   * A RESTORE BRINGS ITS OWN `startTick`, AND THIS IS WHAT STOPS THE NEXT TICK
   * OVERWRITING IT.
   *
   * `simTick` stamps `startTick` lazily, which is right for a fresh operation —
   * a session is armed before `bootstrap()` and cannot know what tick the world
   * will start on. It is catastrophic for a restored one: a save taken at
   * minute nine, loaded before the session's first tick, would come back with
   * `startTick` set to the tick of the LOAD. Every `elapsed` would restart from
   * zero, and the arming pass on that same tick would disarm every hold timer
   * the restore had just put back. One tick, permanent, and silent.
   *
   * `applyCampaignState` calls this the instant a restore lands.
   */
  adoptRestoredState(): void {
    this.started = true;
  }

  simTick(tick: number): void {
    // BIND IS SEPARATE FROM THE STAMP NOW. They shared a branch, so a restored
    // session — which arrives already `started` — would never have built its
    // `WorldQuery` and would have evaluated nothing for the rest of the match.
    if (this.q === null || this.sink === null) this.bind();
    if (!this.started) {
      this.started = true;
      this.state.startTick = tick;
    }
    const q = this.q;
    const sink = this.sink;
    if (q === null || sink === null) return;

    this.effects.length = 0;
    if (runDirector(this.op, this.state, q, tick, this.effects) === 0) return;
    for (const e of this.effects) this.apply(e, sink);
  }

  private apply(e: Effect, sink: EffectSink): void {
    switch (e.do) {
      case 'setObjective': sink.setObjective(e.id); break;
      case 'completeObjective': sink.completeObjective(e.id); break;
      case 'failObjective': sink.failObjective(e.id); break;
      case 'spawnUnits':
        sink.spawnUnits(
          e.player, e.key, e.count, e.at, e.spread ?? 0, e.facingDeg ?? 0, e.tag ?? '',
        );
        break;
      case 'orderTagged': sink.orderTagged(e.tag, e.order, e.at ?? null); break;
      case 'grantCredits': sink.grantCredits(e.player, e.amount); break;
      case 'endOperation': sink.endOperation(e.result, e.reason ?? ''); break;
      case 'revealArea': sink.revealArea(e.player, e.area); break;
      case 'dialogue': sink.dialogue(e.speaker, e.text); break;
      case 'eva': sink.eva(e.line); break;
      case 'cameraMove': sink.cameraMove(e.at); break;
      default: break;
    }
  }

  private setObjective(id: string, status: 'active' | 'complete' | 'failed'): void {
    const was = this.state.objectives.get(id);
    // A RESOLVED OBJECTIVE DOES NOT UN-RESOLVE. Two triggers can both name one
    // objective — a repeat wave and a final check — and the first answer is the
    // one the player saw.
    if (was === 'complete' || was === 'failed') return;
    this.state.objectives.set(id, status as ObjectiveStatus);
    if (status !== 'complete') return;

    const def = this.op.objectives.find((o) => o.id === id);
    if (def?.credits === undefined) return;
    // PAID ONCE, EVER, AND THE `paid` SET IS WHY. It rides in the save chunk
    // beside completion, so reloading before a paid secondary and completing it
    // again does not pay twice.
    if (this.state.paid.has(id)) return;
    this.state.paid.add(id);
    this.sink?.grantCredits(this.playerSeat(), def.credits);
  }

  private end(result: 'win' | 'loss', reason: string): void {
    if (this.state.outcome !== null) return;
    this.state.outcome = result === 'win' ? 'won' : 'lost';
    this.state.reason = reason;
    this.present.push({ kind: 'ended' });
  }

  /** Seat 0 is always the player. Stated once, here. */
  private playerSeat(): number {
    return 0;
  }

  drainPresentation(out: PresentationEvent[]): number {
    const n = this.present.length;
    for (let i = 0; i < n; i++) out.push(this.present[i]);
    this.present.length = 0;
    return n;
  }

  rows(): readonly ObjectiveRow[] {
    const out: ObjectiveRow[] = [];
    for (const o of this.op.objectives) {
      const status = this.state.objectives.get(o.id) ?? 'active';
      if (status === 'hidden') continue;
      out.push({ id: o.id, title: o.title, kind: o.kind, status });
    }
    return out;
  }

  dispose(): void {
    this.tags.clear();
    this.present.length = 0;
    this.effects.length = 0;
    this.q = null;
    this.sink = null;
  }
}

/* ==========================================================================
 * 2. ARM AND DISARM
 * ========================================================================== */

let armed: Session | null = null;

/**
 * Install everything the boot needs, and return the operation so the caller can
 * read its map and title. Null when the id resolves to nothing.
 */
export function armOperation(operationId: string, difficulty: number): OperationDef | null {
  const op = operationById(operationId);
  if (op === null) {
    console.error(`[campaign] no operation '${operationId}'.`);
    return null;
  }
  const l = LAYOUTS.get(op.layout);
  if (l === undefined) {
    console.error(`[campaign] operation '${op.id}' names layout '${op.layout}', which is not registered.`);
    return null;
  }

  disarmOperation();

  const session = new Session(op, difficulty);
  armed = session;

  setPlannedOperation({
    id: op.id,
    preset: op.map.preset,
    armies: op.map.armies,
    opening: op.map.opening,
  });
  setCampaignRoster({ player: op.roster.player, ai: op.roster.ai });
  setCampaignOutcomePolicy(op.outcome);
  setCampaignLayout((b: ScenarioBuilder, cx: number, cz: number, start: StartCondition) => {
    l.build(b, cx, cz, start, {
      op,
      opening: op.map.opening,
      tag: (name: string, id: EntityId) => {
        if (id !== NONE) session.tags.add(name, id);
      },
      seat: (i: number): PlayerId => b.armySlot(i),
    });
  });
  prepareOperation(session);
  return op;
}

/**
 * Clear every latch this file set. Called on win, loss, retry, abandon and
 * quit — and by `armOperation` itself, so arming twice cannot leave the first
 * operation's roster in force.
 */
export function disarmOperation(): void {
  armed = null;
  endOperationSession();
  setPlannedOperation(null);
  setCampaignLayout(null);
  setCampaignRoster(null);
  setCampaignOutcomePolicy(null);
}

/** The armed session, for the shell's end screen and the save path. */
export function armedSession(): CampaignSession | null {
  return armed;
}

export { CAMPAIGNS, campaignFacts, chapterOf, operationById } from './index';
