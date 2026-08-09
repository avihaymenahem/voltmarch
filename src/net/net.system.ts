/**
 * ============================================================================
 * src/net/net.system.ts — where lockstep meets the simulation
 * ============================================================================
 * `Phase.Command`, ORDER 0. That number is the whole file.
 *
 * Every existing consumer of the command bus sits far above it — `OrderExecutor`
 * at 9000, `replay.system` and `deploy.system` at 9500, `abilities` and
 * `relocate` at 9600. Running first means this module sees the ring before
 * anybody drains it, which is the only moment a local command can be taken off
 * the bus and sent to the relay instead of being applied.
 *
 * ── WHAT A TICK LOOKS LIKE ─────────────────────────────────────────────────
 *
 *   1. harvest the bus into the scheduler's outbox   (commands do NOT apply)
 *   2. if this tick opens a turn:
 *        fingerprint the sim, seal the outbox, send it for turn + TURN_DELAY
 *        re-issue the merged frame for THIS turn, via applyCommand
 *   3. return — and everything downstream drains exactly as it always has
 *
 * `src/input/**` is untouched. A click still calls `channels.commands.issue*`
 * and knows nothing about any of this.
 *
 * ── WHY THE RECORDER STILL SEES EACH COMMAND ONCE ──────────────────────────
 *
 * Step 1 uses `CommandBus.harvest`, not `drain`, so the recording tap does not
 * fire. The tap fires in step 2 when the command is re-issued and genuinely
 * applies. So a multiplayer match records a CORRECT replay for free, stamped
 * with execution ticks — which is the only tick a replay can reproduce. Using
 * `drain` in step 1 would log everything twice: trap 2 from `src/game/Replay.ts`
 * arrived at by a different route.
 *
 * ── THE MODULE IS INERT UNTIL A MATCH SAYS OTHERWISE ───────────────────────
 *
 * Discovery registers every `*.system.ts` under `src/`, so this loads in single
 * player too. With no session attached, `simTick` returns on its first line and
 * no step gate is installed — a skirmish runs byte-identically to before. It is
 * `attachSession()` that turns it on, and nothing else can.
 * ============================================================================
 */

import { defineSystem } from '../core/loop';
import { Phase } from '../core/types';
import type { SimContext } from '../core/types';
import { ctx } from '../game/context';
import { hashOnly } from '../game/Checksum';
import { TurnScheduler } from './TurnScheduler';
import { applyCommand, toWire } from './applyCommand';
import type { OutgoingFrame } from './TurnScheduler';
import type { WireCommand } from './protocol';

/* -------------------------------------------------------------------------- */
/* The session                                                                */
/* -------------------------------------------------------------------------- */

/**
 * What a live multiplayer match hands this module.
 *
 * A structural interface rather than an import of `Transport`, for the same
 * reason `Match.ts` on the server takes a `Peer`: the netcode is then testable
 * with a function, and the loop layer never depends on a socket.
 */
export interface NetSession {
  readonly scheduler: TurnScheduler;
  /** Post a sealed frame to the relay. */
  sendFrame(frame: OutgoingFrame): void;
  /**
   * Something arrived that must not be applied. The match is over.
   * See THE TRIPWIRE RULE in `protocol.ts`.
   */
  fatal(detail: string): void;
}

let session: NetSession | null = null;

/**
 * A session waiting for a world to exist.
 *
 * THE GATE MUST BE INSTALLED BEFORE THE FIRST TICK RUNS, and this is the only
 * way to guarantee it. The shell cannot call `attachSession` itself until
 * `startMatch` returns — and by then `Bootstrap` has already called
 * `loop.start()` and the loop has run several ticks. Tick 1 opens turn 0, and a
 * turn that opens without the gate installed never calls `TurnScheduler.open`,
 * so the frame for turn 0 + TURN_DELAY is never sent BY EITHER CLIENT. Both
 * then gate forever on a frame nobody will ever produce, the simulation freezes
 * at around tick 7, and every command the player issues is harvested by nothing
 * and silently lost.
 *
 * That is not a hypothetical: it is how this shipped, and it made multiplayer
 * completely non-functional while every unit test and the whole relay suite
 * stayed green — because they exercised the scheduler and the relay, and never
 * this seam.
 *
 * So the shell hands the session over BEFORE booting, and `init()` — which runs
 * inside `registry.init()`, before `loop.start()` — installs the gate.
 */
let pending: NetSession | null = null;

/** Wall-clock ms at which the gate first refused, or 0 while running. */
let stalledSince = 0;

/**
 * Hand a session to the module before the world exists.
 *
 * The gate goes in during `init()`, which is the last moment before the first
 * tick. See `pending`.
 */
export function prepareSession(s: NetSession | null): void {
  pending = s;
}

/**
 * Turn lockstep on for this match.
 *
 * Installs the step gate, so from here the loop will not advance a
 * turn-opening tick until the frame for that turn is in hand.
 *
 * Prefer `prepareSession` from the shell: calling this after the loop has
 * started leaves every already-run turn unsent. It is exported for tests, which
 * drive their own loop and attach before stepping it.
 */
export function attachSession(s: NetSession): void {
  session = s;
  pending = null;
  stalledSince = 0;
  const { loop } = ctx();
  loop.setStepGate(() => s.scheduler.mayStep(loop.tick + 1));
}

/** Turn it off. The loop steps freely again. */
export function detachSession(): void {
  session = null;
  stalledSince = 0;
  try {
    ctx().loop.setStepGate(null);
  } catch {
    // `ctx()` throws once the match is torn down, which is a legitimate order
    // for this to be called in — the gate died with the loop.
  }
}

export function activeSession(): NetSession | null { return session; }

/**
 * Milliseconds spent waiting on a peer, or 0 when running.
 *
 * Read by the HUD to raise a "waiting for opponent" indicator. Wall clock is
 * fine here and cannot affect determinism: it is never consulted by anything
 * that decides what the simulation does, only by something that decides what to
 * draw. `performance.now()` is banned inside `src/sim/**` and this is not that.
 */
export function stallMs(): number {
  if (session === null || stalledSince === 0) return 0;
  return Math.max(0, performance.now() - stalledSince);
}

/** Note whether the gate is currently refusing. Called from the render side. */
export function sampleStall(): void {
  if (session === null) { stalledSince = 0; return; }
  const { loop } = ctx();
  const blocked = !session.scheduler.mayStep(loop.tick + 1);
  if (!blocked) { stalledSince = 0; return; }
  if (stalledSince === 0) stalledSince = performance.now();
}

/* -------------------------------------------------------------------------- */

export default defineSystem({
  id: 'net.lockstep',
  phase: Phase.Command,
  // BEFORE EVERYTHING. See the header — this is the only order at which a local
  // command can be intercepted before a consumer applies it.
  order: 0,

  /**
   * Adopt a session the shell handed over before the boot.
   *
   * `registry.init()` runs before `loop.start()`, so a gate installed here is in
   * place for tick 1 — which is the tick that opens turn 0 and the only chance
   * to send the first frame. See `pending`.
   */
  init(): void {
    if (pending !== null) attachSession(pending);
  },

  simTick(_s: SimContext): void {
    const live = session;
    // Single player, or a match that has ended. The bus is left completely
    // alone, so a skirmish behaves exactly as it did before this file existed.
    if (live === null) return;

    const { world, channels } = ctx();
    const sched = live.scheduler;

    // 1. INTENTS OFF THE BUS. `harvest`, not `drain`: the recording tap must
    //    not fire until these actually apply. See the header.
    channels.commands.harvest((cmd) => { sched.collect(toWire(cmd)); });

    const tick = world.tick;
    if (!sched.opensTurn(tick)) return;

    // 2. The fingerprint, taken before any system has run — so it describes the
    //    state the PREVIOUS tick produced. Both clients sample at the identical
    //    point, which is what makes the comparison exact rather than a race.
    const hash = hashOnly(world);
    const { execute, send } = sched.open(tick, hash);

    if (send !== null) live.sendFrame(send);

    for (let i = 0; i < execute.length; i++) {
      const c: WireCommand = execute[i]!;
      if (applyCommand(channels.commands, c)) continue;
      // A kind this build cannot apply, inside a frame the relay approved.
      // The peer is on a different build, or the relay is not what we think.
      // Either way the two simulations have already parted company.
      live.fatal(`the relay sent command kind ${c.kind}, which this build cannot apply`);
      return;
    }
  },

  dispose(): void {
    session = null;
    stalledSince = 0;
  },
});
