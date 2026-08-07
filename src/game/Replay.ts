/**
 * ============================================================================
 * src/game/Replay.ts — record a match as commands, play it back as a match
 * ============================================================================
 * "Every action, every click, every movement should be in a game log, so that
 *  if we want a replay right after, I'm just playing a series of event logs
 *  from a file, and I can see the exact replica of what happened."
 *
 * Standard RTS lockstep. A replay is a header plus an ordered command stream,
 * and playback RE-RUNS THE REAL SIMULATION rather than replaying recorded
 * state. That is the whole design decision and everything else follows from it:
 * the file is kilobytes instead of gigabytes, it stays valid when the art
 * changes, and it is the same mechanism that would carry a multiplayer game.
 *
 * IT LOGS COMMANDS, NOT CLICKS. Replaying raw mouse input would mean
 * reproducing camera pose, selection state and hit-testing exactly, and would
 * break on any UI change. A command already carries the resolved intent — these
 * entities, this order, this point — and the AI issues the identical struct,
 * so one stream covers both players.
 *
 * WHAT IS NOT IN HERE, DELIBERATELY. The camera. It is cosmetic, it is not
 * simulation state, and baking it in would stop a viewer from looking wherever
 * they like during playback. A camera track can be added later as a separate,
 * ignorable section.
 *
 * ── THE FOUR TRAPS THIS FILE EXISTS TO AVOID ─────────────────────────────
 *
 * All four were found by reading the code before writing any of it, and each
 * would have produced a log that looked right and replayed wrong.
 *
 * 1. `CommandBus.drain` IS DESTRUCTIVE and has no non-destructive read. So the
 *    recorder does not poll — `CommandBus.observe` taps the drain itself.
 * 2. TWO CONSUMERS PARK AND RE-ISSUE COMMANDS (`Commands.ts#reissueParked`,
 *    `features.system.ts`). The first version of this file put the tap on the
 *    drain and claimed that was "where a command passes exactly once". IT IS
 *    NOT, and a live match proved it: a re-issue is a genuinely NEW command
 *    object that passes the drain AGAIN, so one human click was logged THREE
 *    times and a replay would have built three power plants for it.
 *    Both re-issue sites now run inside `CommandBus.markReissue`, which stamps
 *    `Command.reissued`, and `record()` skips those. The tap stays on the drain
 *    — it is still the only place all four drainers are covered — but it now
 *    records INTENTS rather than deliveries.
 * 3. `cmd.entities` IS A SUBARRAY VIEW into a shared arena and is invalid the
 *    moment the drain returns. `record()` copies it immediately.
 * 4. `cmd.tick` IS THE ISSUE TICK, NOT THE APPLY TICK. A command issued from a
 *    DOM handler between ticks carries N-1 and applies on N. The recorder
 *    stamps the APPLY tick — the bus's own `tick` at drain time — because that
 *    is the one playback can reproduce.
 * ============================================================================
 */

import { CommandKind } from '../core/types';
import type { Command, EntityId, PlayerId } from '../core/types';
import type { Channels } from '../core/events';
import type { World } from '../core/world';
import { checksum, describeDivergence, type SimChecksum } from './Checksum';

/**
 * Bumped when the on-disk shape changes in a way an older reader cannot
 * survive. A replay whose `formatVersion` this build does not know is REFUSED
 * rather than half-read — a replay that silently drops a field it did not
 * recognise is a desync with extra steps.
 */
export const REPLAY_FORMAT_VERSION = 1;

/** How often a checksum is stamped into the stream, in ticks. */
export const REPLAY_CHECKSUM_INTERVAL = 30;

/** Everything needed to reconstruct the starting world. */
export interface ReplayHeader {
  formatVersion: number;
  /** The build that recorded it. Advisory: a mismatch warns, it does not refuse. */
  buildVersion: string;
  mapSeed: number;
  scenario: string;
  /** Per-slot faction and difficulty, index === PlayerId. */
  players: { faction: number; isHuman: boolean; aiDifficulty: number; aiPersonality: number }[];
}

/**
 * One recorded command.
 *
 * A FLAT OBJECT, not the pooled struct. Every field is copied, including a
 * fresh `entities` array — see trap 3.
 */
export interface ReplayCommand {
  tick: number;
  kind: number;
  player: number;
  order: number;
  target: number;
  x: number;
  z: number;
  defId: number;
  tab: number;
  cx: number;
  cz: number;
  stance: number;
  queued: boolean;
  arg: number;
  entities: number[];
}

/** A checkpoint, so a divergence reports a TICK rather than a shrug. */
export interface ReplayCheck {
  tick: number;
  hash: number;
  entities: number;
}

export interface ReplayFile {
  header: ReplayHeader;
  commands: ReplayCommand[];
  checks: ReplayCheck[];
}

/* ==========================================================================
 * 1. RECORDING
 * ========================================================================== */

export class ReplayRecorder {
  private readonly commands: ReplayCommand[] = [];
  private readonly checks: ReplayCheck[] = [];
  private attached: Channels | null = null;
  private lastCheckTick = -1;

  constructor(readonly header: ReplayHeader) {}

  /**
   * Start recording. Idempotent, and it REPLACES any previous observer — the
   * bus holds exactly one, which is deliberate: two recorders on one match is
   * a mistake, not a feature, and silently dropping the older one is worse than
   * making the single slot obvious.
   */
  attach(channels: Channels): void {
    this.attached = channels;
    channels.commands.observe((cmd) => { this.record(cmd, channels.commands.tick); });
  }

  detach(): void {
    this.attached?.commands.observe(null);
    this.attached = null;
  }

  /**
   * Copy one command out of the pool.
   *
   * `applyTick` is the bus's tick at drain time, NOT `cmd.tick`. See trap 4:
   * `cmd.tick` is stamped when the command was ISSUED, which for anything that
   * came from a DOM handler is the tick before the one it applies on. Playback
   * re-issues by apply tick, so that is what is stored.
   */
  private record(cmd: Command, applyTick: number): void {
    // A consumer putting a parked command back for a later phase. The player
    // action it stands for was already recorded on its first pass; logging it
    // again replays the same click two or three times. See trap 2.
    if (cmd.reissued) return;

    // `cmd.entities` is a view into the bus's shared arena and dies with this
    // drain. Copying is not an optimisation to skip.
    const entities: number[] = new Array(cmd.entityCount);
    for (let i = 0; i < cmd.entityCount; i++) entities[i] = cmd.entities[i];

    this.commands.push({
      tick: applyTick,
      kind: cmd.kind as number,
      player: cmd.player as number,
      order: cmd.order as number,
      target: cmd.target as number,
      x: cmd.x,
      z: cmd.z,
      defId: cmd.defId,
      tab: cmd.tab as number,
      cx: cmd.cx,
      cz: cmd.cz,
      stance: cmd.stance as number,
      queued: cmd.queued,
      arg: cmd.arg,
      entities,
    });
  }

  /**
   * Stamp a checkpoint if one is due. Call once per tick, from the sim.
   *
   * Cheap by construction: the hash runs once every `REPLAY_CHECKSUM_INTERVAL`
   * ticks, i.e. once a second at 30 Hz, and the rest of the time this is one
   * integer compare.
   */
  maybeCheckpoint(world: World): void {
    const tick = world.tick;
    if (tick === this.lastCheckTick) return;
    if (tick % REPLAY_CHECKSUM_INTERVAL !== 0) return;
    this.lastCheckTick = tick;
    const c = checksum(world);
    this.checks.push({ tick: c.tick, hash: c.hash, entities: c.entities });
  }

  get commandCount(): number { return this.commands.length; }
  get checkCount(): number { return this.checks.length; }

  /** The finished replay. Safe to call mid-match; it snapshots what exists. */
  build(): ReplayFile {
    return {
      header: this.header,
      commands: this.commands.slice(),
      checks: this.checks.slice(),
    };
  }

  /** The finished replay as text, for a download or a file. */
  serialise(): string {
    return JSON.stringify(this.build());
  }
}

/* ==========================================================================
 * 2. READING
 * ========================================================================== */

export type ParseResult =
  | { ok: true; value: ReplayFile }
  | { ok: false; reason: string };

/**
 * Parse and VALIDATE a replay.
 *
 * Refuses rather than repairs. A replay is only useful if it reproduces the
 * match exactly, so a file this build cannot read completely is worthless and
 * saying so immediately is the whole value — "it played back slightly wrong"
 * is the outcome this function exists to prevent.
 */
export function parseReplay(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'not valid JSON' };
  }
  if (typeof raw !== 'object' || raw === null) return { ok: false, reason: 'not an object' };
  const o = raw as Partial<ReplayFile>;
  const h = o.header;
  if (h === undefined || typeof h !== 'object') return { ok: false, reason: 'no header' };
  if (h.formatVersion !== REPLAY_FORMAT_VERSION) {
    return {
      ok: false,
      reason: `format version ${String(h.formatVersion)}, this build reads ${REPLAY_FORMAT_VERSION}`,
    };
  }
  if (!Array.isArray(o.commands)) return { ok: false, reason: 'no command stream' };
  if (!Array.isArray(o.checks)) return { ok: false, reason: 'no checkpoints' };

  // The stream MUST be ordered. Playback walks it with a cursor and never
  // rewinds, so an out-of-order entry would be silently skipped — a command
  // that never applies, and a desync with no visible cause.
  let last = -1;
  for (const c of o.commands) {
    if (typeof c.tick !== 'number' || !Number.isFinite(c.tick)) {
      return { ok: false, reason: 'a command has no tick' };
    }
    if (c.tick < last) return { ok: false, reason: `command stream is out of order at tick ${c.tick}` };
    last = c.tick;
    if (!Array.isArray(c.entities)) return { ok: false, reason: `command at tick ${c.tick} has no entity list` };
  }
  return { ok: true, value: o as ReplayFile };
}

/* ==========================================================================
 * 3. PLAYBACK
 * ========================================================================== */

/** What a playback run found. */
export interface PlaybackStatus {
  /** Commands re-issued so far. */
  issued: number;
  /** Checkpoints compared so far. */
  verified: number;
  /** Empty while in sync; otherwise the first divergence, with its tick. */
  desync: string;
}

/**
 * Re-issues a recorded stream into a live bus, tick by tick, and verifies the
 * checkpoints as it goes.
 *
 * THE CALLER OWNS THE WORLD. This does not boot a match, does not touch the
 * shell and does not run the loop — it is handed a world that was already
 * started from the replay's own header, and it feeds it. That keeps it usable
 * from a test with no shell, which is the only way any of this gets verified.
 */
export class ReplayPlayer {
  private cursor = 0;
  private checkCursor = 0;
  private issuedCount = 0;
  private verifiedCount = 0;
  private firstDesync = '';

  constructor(private readonly file: ReplayFile) {}

  get status(): PlaybackStatus {
    return { issued: this.issuedCount, verified: this.verifiedCount, desync: this.firstDesync };
  }

  /** True once every recorded command has been re-issued. */
  get finished(): boolean { return this.cursor >= this.file.commands.length; }

  /** The last tick the recording has anything to say about. */
  get lastTick(): number {
    const cmds = this.file.commands;
    const checks = this.file.checks;
    const a = cmds.length === 0 ? 0 : cmds[cmds.length - 1]!.tick;
    const b = checks.length === 0 ? 0 : checks[checks.length - 1]!.tick;
    return Math.max(a, b);
  }

  /**
   * Re-issue everything recorded for `tick`. Call BEFORE the sim runs that
   * tick, from the same place a player's input would have arrived.
   */
  issueFor(tick: number, channels: Channels): void {
    const cmds = this.file.commands;
    while (this.cursor < cmds.length && cmds[this.cursor]!.tick <= tick) {
      const c = cmds[this.cursor]!;
      this.cursor++;
      // A command recorded for a tick already past is re-issued anyway rather
      // than dropped: dropping it would silently change the match, and the
      // checkpoint will report the divergence honestly if the shift matters.
      this.issue(c, channels);
      this.issuedCount++;
    }
  }

  /**
   * Compare the live world against the checkpoint for this tick, if there is
   * one. Call AFTER the sim has run the tick.
   *
   * Records only the FIRST divergence. Everything after a desync is noise —
   * the two simulations are different games by then, and a hundred lines of
   * "still different" buries the one line that says where it started.
   */
  verify(world: World): void {
    const checks = this.file.checks;
    while (this.checkCursor < checks.length && checks[this.checkCursor]!.tick < world.tick) {
      // A checkpoint we ran past without comparing. That is itself a fault: it
      // means the tick numbering diverged, which is worse than a state
      // mismatch because nothing downstream can be trusted.
      const missed = checks[this.checkCursor]!;
      this.checkCursor++;
      if (this.firstDesync === '') {
        this.firstDesync = `checkpoint at tick ${missed.tick} was never reached `
          + `(playback is at ${world.tick})`;
      }
    }
    if (this.checkCursor >= checks.length) return;
    const want = checks[this.checkCursor]!;
    if (want.tick !== world.tick) return;
    this.checkCursor++;
    this.verifiedCount++;

    const got = checksum(world);
    if (got.hash === want.hash) return;
    if (this.firstDesync !== '') return;
    const expected: SimChecksum = {
      tick: want.tick, hash: want.hash, blocks: [], entities: want.entities,
    };
    this.firstDesync = describeDivergence(got, expected)
      + ` (recorded ${want.entities} entities, replay has ${got.entities})`;
  }

  private issue(c: ReplayCommand, channels: Channels): void {
    const bus = channels.commands;
    const player = c.player as PlayerId;
    switch (c.kind) {
      case CommandKind.Order: {
        const ids = new Int32Array(c.entities.length);
        for (let i = 0; i < c.entities.length; i++) ids[i] = c.entities[i]!;
        bus.issueOrder(
          player, c.order, ids, ids.length, c.x, c.z, c.target as EntityId, c.queued,
        );
        return;
      }
      case CommandKind.ProductionStart:
        bus.issueProductionStart(player, c.tab, c.defId, c.arg);
        return;
      case CommandKind.ProductionPause:
        bus.issueProductionPause(player, c.tab, c.arg !== 0);
        return;
      case CommandKind.ProductionCancel:
        bus.issueProductionCancel(player, c.tab, c.defId, c.arg);
        return;
      case CommandKind.PlaceBuilding:
        bus.issuePlaceBuilding(player, c.defId, c.cx, c.cz, c.arg);
        return;
      case CommandKind.SetRally:
        bus.issueSetRally(player, c.target as EntityId, c.x, c.z);
        return;
      case CommandKind.SellBuilding:
        bus.issueSell(player, c.target as EntityId);
        return;
      case CommandKind.RepairToggle:
        bus.issueRepairToggle(player, c.target as EntityId);
        return;
      case CommandKind.SetStance: {
        const ids = new Int32Array(c.entities.length);
        for (let i = 0; i < c.entities.length; i++) ids[i] = c.entities[i]!;
        bus.issueSetStance(player, ids, ids.length, c.stance);
        return;
      }
      case CommandKind.SetPrimary:
        bus.issueSetPrimary(player, c.target as EntityId);
        return;
      case CommandKind.SelfDestruct:
        bus.issueSelfDestruct(player, c.target as EntityId);
        return;
      case CommandKind.Relocate:
        bus.issueRelocate(player, c.target as EntityId, c.cx, c.cz, c.arg);
        return;
      default:
        // An unknown kind in a file whose formatVersion we accepted means the
        // enum gained a row without a version bump. Loud, because the replay
        // is now wrong and silence would hide it.
        this.firstDesync = this.firstDesync !== '' ? this.firstDesync
          : `unknown command kind ${c.kind} at tick ${c.tick} — the format version `
            + 'was not bumped when CommandKind changed';
    }
  }
}
