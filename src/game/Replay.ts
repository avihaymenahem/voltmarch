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
 *
 * ── AND A FIFTH, FOUND WHEN PLAYBACK WAS FINALLY BUILT ─────────────────────
 *
 * 5. THE v1 HEADER COULD NOT REBUILD THE WORLD IT DESCRIBED. It carried
 *    `mapSeed` — the TERRAIN landform roll, `?mapseed=` — and called it "the
 *    seed", while `?seed=` (the scenario layout and every draw of `s.rng`) was
 *    never written down at all. Nor was the map preset, the biome, the opening
 *    (`?start=`, a per-client PREFERENCE), or the starting bank (a per-client
 *    LOBBY ROW). Any one of those differing means a different world on tick
 *    zero, and four of the five differ routinely between two players.
 *
 *    So v2 records the whole boot, and `REPLAY_FORMAT_VERSION` is bumped rather
 *    than the fields being made optional: a v1 file genuinely cannot be
 *    replayed by this build, and `parseReplay` refusing it with a sentence is
 *    the entire point of having a version at all.
 * ============================================================================
 */

import type { Command } from '../core/types';
import type { Channels } from '../core/events';
import type { World } from '../core/world';
import { applyCommand } from '../net/applyCommand';
import type { WireCommand } from '../net/protocol';
import {
  checksum, describeDivergence, type ChecksumBlock, type SimChecksum,
} from './Checksum';

/**
 * Bumped when the on-disk shape changes in a way an older reader cannot
 * survive. A replay whose `formatVersion` this build does not know is REFUSED
 * rather than half-read — a replay that silently drops a field it did not
 * recognise is a desync with extra steps.
 */
/**
 * The version a SKIRMISH recording is written at. Unchanged since v2 and it
 * must stay that way — every replay a player owns is stamped with it, and
 * every build that ever shipped reads it.
 */
export const REPLAY_FORMAT_VERSION = 2;

/**
 * The version a CAMPAIGN recording is written at.
 *
 * A campaign file is not readable by a build that predates the campaign — not
 * because a field is missing, but because that build would boot the header's
 * seeds, arm no operation, and play a plausible skirmish on the operation's
 * ground while saying nothing. It has to guess, which is this file's own bump
 * criterion. So it is stamped 3 and an old build refuses it by name.
 */
export const REPLAY_FORMAT_VERSION_CAMPAIGN = 3;

/** Every version this build can read. */
export const REPLAY_FORMAT_VERSIONS: readonly number[] = [
  REPLAY_FORMAT_VERSION,
  REPLAY_FORMAT_VERSION_CAMPAIGN,
];

/** The version a header with these contents should be written at. */
export function formatVersionFor(campaign: ReplayCampaign | undefined): number {
  return campaign === undefined ? REPLAY_FORMAT_VERSION : REPLAY_FORMAT_VERSION_CAMPAIGN;
}

/** How often a checksum is stamped into the stream, in ticks. */
export const REPLAY_CHECKSUM_INTERVAL = 30;

/**
 * The campaign operation a recording was played in.
 *
 * TWO STRINGS, NOT ONE, EVEN THOUGH `operationById` RESOLVES THE SECOND FROM
 * THE FIRST. A header is read by things that have deliberately not loaded the
 * operation table — the Replays list labels a card before anything has fetched
 * `campaign-install`, which is the whole point of that lazy boundary — so
 * re-deriving the chapter there would drag 37 operations into the entry chunk
 * to write one word on a tile.
 */
export interface ReplayCampaign {
  /** `ChapterDef.id` — `soviets` | `allies` | `pact` | `reclamation`. */
  readonly chapter: string;
  /** `OperationDef.id` — `chapter.NN.slug`. */
  readonly operation: string;
}

/** One slot of the starting world, index === PlayerId. */
export interface ReplaySlot {
  faction: number;
  isHuman: boolean;
  aiDifficulty: number;
  aiPersonality: number;
  /**
   * The bank this slot opened on.
   *
   * RECORDED BECAUSE IT IS A LOBBY ROW, not a property of the seed. The shell
   * writes `MatchSetup.startingCredits` into every slot after the world is
   * built and before the first tick, and it is a PER-CLIENT preference — the
   * same trap multiplayer hit with `PVP_CREDITS`. A replay watched on an
   * account whose lobby says 5000 would give the recorded 20000-credit opening
   * a different economy and diverge on the very first production decision.
   */
  credits: number;
  /**
   * `PlayerState.allyMask` at the opening tick — who this slot was allied to.
   *
   * SAME ARGUMENT AS `credits`, ONE FIELD ALONG. It is sim state written into
   * the world from a LOBBY ROW (`MatchSetup.opponents[].team`), it is hashed by
   * `Checksum.hashPlayers`, and `Targeting` reads it every tick — so a 2v2
   * replayed on a browser whose lobby last held a free-for-all has both teams
   * shooting their own allies and diverges immediately.
   *
   * OPTIONAL, AND `REPLAY_FORMAT_VERSION` DOES NOT MOVE FOR IT. Old file, new
   * build: absence is a fact, that match WAS a free-for-all, and the default
   * mask reproduces it exactly — nothing is guessed. New file, old build IS the
   * dangerous direction the `campaign` note above names, and it is answered
   * differently here because the failure is different: a campaign recording
   * played back by a build that predates campaigns looks like a PLAUSIBLE
   * skirmish and says nothing, whereas a team recording played back without its
   * masks is announced by the checkpoint compare the replay bar already shows,
   * within 30 ticks, in the product. A fourth version number crossed with the
   * campaign's third buys a louder signal than the one already on screen; that
   * is not enough to refuse every file a player owns.
   */
  allyMask?: number;
}

/**
 * Everything needed to reconstruct the starting world.
 *
 * EVERY FIELD HERE IS SOMETHING THE WORLD IS BUILT FROM, and the list is long
 * because the boot really does read that many things. `mapSeed`, `simSeed`,
 * `mapPreset` and `biome` are the four query flags the engine modules parse for
 * themselves (`world/terrain.system.ts` takes the first and the last,
 * `game/Scenarios.ts` takes the middle two); `start` is a per-client stored
 * PREFERENCE that decides whether the match opens with a base or a
 * construction vehicle; `credits` on each slot is a lobby row. Leave any one of
 * them out and two machines build different worlds from the same file.
 *
 * `art` is the exception and is recorded anyway: it is the mood preset, it
 * cannot touch the simulation, and reproducing it costs one string and makes a
 * replay LOOK like the match it came from.
 */
export interface ReplayHeader {
  formatVersion: number;
  /** The build that recorded it. Advisory: a mismatch warns, it does not refuse. */
  buildVersion: string;
  /** `?mapseed=` — the landform roll. Fixed per map, so this identifies terrain. */
  mapSeed: number;
  /** `?seed=` — the scenario layout AND the seed of every `s.rng` draw. */
  simSeed: number;
  /** `?map=` — the MAP_PRESETS key: ore, props, mood. */
  mapPreset: string;
  /** `?biome=` — temperate | desert | snow | urban. */
  biome: string;
  /** `?art=` — the mood preset. Cosmetic; recorded so playback looks the same. */
  art: string;
  /** `?start=` — 'mcv' or 'base'. A STORED PER-CLIENT PREFERENCE otherwise. */
  start: string;
  scenario: string;
  /**
   * The slot the recording was watched through.
   *
   * PRESENTATION ONLY — camera framing and which side of the fog you see. It is
   * deliberately not part of the simulation and `Checksum.hashPlayers` does not
   * hash it, which is exactly why a PvP match produces one file both clients
   * can watch.
   */
  localPlayer: number;
  /** Per-slot faction, difficulty and opening bank, index === PlayerId. */
  players: ReplaySlot[];
  /**
   * The campaign operation this match was, ABSENT for a skirmish.
   *
   * ── THE VERSION IS PER-FILE: 2 FOR A SKIRMISH, 3 WHEN THIS IS PRESENT ───
   *
   * The bump criterion this file runs on is stated in `parseReplay`: a version
   * moves when a file "describes a match this build would have to GUESS at".
   * **THAT TEST HAS TWO DIRECTIONS AND THE FIRST DRAFT OF THIS COMMENT ONLY
   * ARGUED ONE OF THEM.**
   *
   * Old file, new build: `campaign: undefined` on a v2 file is A FACT — that
   * match really was a skirmish. Nothing is inferred. So a blanket bump would
   * refuse every replay a player owns to buy nothing, and that half of the
   * argument was right.
   *
   * **New file, OLD build is the dangerous direction, and it was missed.** A
   * campaign recording stamped `formatVersion: 2` is accepted IN FULL by a
   * build that predates the campaign: `parseReplay` passes it, the boot takes
   * the header's seeds and preset, no operation is armed, and the viewer
   * watches a plausible skirmish on the operation's ground — `detachPlayback`'s
   * failure exactly, in a build that has no `campaignFault` to name it. That
   * build genuinely DOES have to guess, which is the bump criterion, met.
   * It is reachable: `Replays.ts#onFileChosen` imports files from disk, and
   * CLAUDE.md documents `buildVersion` as warn-not-refuse *because* cross-build
   * files are expected.
   *
   * So the version is written PER FILE and read as a SET. A skirmish is still
   * written `2` and every old build still plays it; a campaign recording is
   * written `3` and an old build refuses it with an honest sentence instead of
   * silently substituting a different match. Nothing on disk today is affected
   * either way — which is the property the `SaveSlotInfo.extra` argument was
   * really about.
   *
   * `missingHeaderField` therefore does NOT list it. `campaignFault` below
   * does the other half: absent is fine, PRESENT AND UNUSABLE is refused.
   */
  campaign?: ReplayCampaign;
}

/**
 * One recorded command.
 *
 * A FLAT OBJECT, not the pooled struct. Every field is copied, including a
 * fresh `entities` array — see trap 3.
 *
 * IT IS A `WireCommand` PLUS A TICK, and that is structural rather than
 * incidental: a replay command and a command arriving from a multiplayer peer
 * are the same thing from two different places, and both are re-issued by the
 * same `applyCommand`. Declaring the relationship in the type means a field
 * added to one cannot be forgotten in the other.
 */
export interface ReplayCommand extends WireCommand {
  tick: number;
}

/**
 * A checkpoint, so a divergence reports a TICK rather than a shrug.
 *
 * `blocks` IS THE PER-BLOCK SPLIT, in `Checksum.checksum`'s own order, and it
 * is here because without it a divergence could only ever say "the folded hash
 * differs". `Checksum.ts` opens by contrasting "the replay diverged somewhere"
 * — a week of bisecting — with "diverged at tick 4812, in the entity block,
 * and the player block still agreed" — an afternoon. The second sentence was
 * unreachable from a replay for as long as the file stored one number: the
 * comparison had nothing to put on the other side, so `describeDivergence`
 * printed `folded hash only` every time, which READS like "no block differs"
 * and means "no block was recorded".
 *
 * Three extra integers a second, and it buys the sentence the instrument was
 * built to produce.
 *
 * OPTIONAL ON READ. A file without it still verifies exactly as before and
 * still reports the tick — the report is simply back to naming no block.
 */
export interface ReplayCheck {
  tick: number;
  hash: number;
  entities: number;
  blocks?: number[];
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
  /** True once `captureStart` has taken the opening state. */
  private opened = false;

  constructor(readonly header: ReplayHeader) {}

  /**
   * Take the half of the header that does not exist yet at `init()`.
   *
   * WHY THIS IS A SECOND CALL AND NOT CONSTRUCTOR ARGUMENTS. `init()` runs
   * inside `registry.init()`, and at that moment the shell has written NEITHER
   * the lobby's factions (`applySetupToWorld` runs after `bootstrap()` returns)
   * NOR the starting bank (`applySimPostBoot` runs after `await game.ready`)
   * NOR built the scenario, which is what adds the Gaia slot. A header taken
   * there records the two placeholder players Bootstrap seeded and calls them
   * the match — which is exactly what v1 did, and why every recorded header
   * said Allies vs Soviets no matter what the player picked.
   *
   * The FIRST sim tick is the earliest moment all three are true and the latest
   * moment nothing has changed: `game.replay` is `Phase.Command` order 9500 and
   * Production (200) and Economy (300) are later phases, so on the opening tick
   * not one credit has been spent or earned.
   *
   * Idempotent — only the first call is taken.
   *
   * `campaign` IS A PARAMETER RATHER THAN A LOOKUP, and that is the same rule
   * `ReplayPlayer` states for the world: this file is pure, and the module that
   * knows what a campaign session is is `replay.system.ts`. It is optional
   * because a skirmish is the ordinary case and passing `null` for it at every
   * call site in a test file is noise — and because the resulting header key is
   * then genuinely absent from the JSON, which is what makes an older reader's
   * `undefined` a fact rather than a default.
   */
  captureStart(world: World, campaign: ReplayCampaign | null = null): void {
    if (this.opened) return;
    this.opened = true;
    // `undefined`, never `null`: `JSON.stringify` DROPS an undefined property
    // and writes `"campaign":null` for the other one, so this is the difference
    // between a skirmish file that says nothing and one that says "no
    // operation" in a shape no reader was written for.
    this.header.campaign = campaign ?? undefined;
    // THE VERSION IS DECIDED HERE, WHERE THE CONTENTS ARE KNOWN, and not in
    // `headerFor()` — the recorder is constructed before the first tick and
    // cannot know yet whether an operation is armed. A skirmish stays 2 so
    // every build that ever shipped still reads it.
    this.header.formatVersion = formatVersionFor(this.header.campaign);
    this.header.localPlayer = world.localPlayer as number;
    this.header.players = world.players.map((p) => ({
      faction: p.faction as number,
      isHuman: p.isHuman,
      aiDifficulty: p.aiDifficulty,
      aiPersonality: p.aiPersonality,
      credits: p.credits,
      // Taken on the FIRST SIM TICK, which is the only moment it is complete:
      // `Shell.applySetupToWorld` writes the teams and the scenario adds Gaia's
      // bit afterwards, so a mask read at `init()` would be missing both.
      allyMask: p.allyMask,
    }));
  }

  /** True once the opening state has been captured. */
  get started(): boolean { return this.opened; }

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
    const blocks: number[] = new Array(c.blocks.length);
    for (let i = 0; i < c.blocks.length; i++) blocks[i] = c.blocks[i]!.hash;
    this.checks.push({ tick: c.tick, hash: c.hash, entities: c.entities, blocks });
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

const NUMBER_FIELDS: readonly (keyof ReplayHeader)[] = ['mapSeed', 'simSeed', 'localPlayer'];
const STRING_FIELDS: readonly (keyof ReplayHeader)[] = ['mapPreset', 'biome', 'start', 'scenario'];

/**
 * The name of the first boot field this header is missing, or ''.
 *
 * `art` and `buildVersion` are deliberately NOT required. Neither can change
 * the simulation — one is a mood preset, the other is a string — so refusing a
 * file for their absence would reject a replay that plays back perfectly.
 *
 * `campaign` IS NOT LISTED EITHER, for a different reason: its absence is not
 * a gap, it is the recording saying "this was a skirmish". Every v2 file
 * written before the campaign existed says exactly that, truthfully. See the
 * field's own comment, and `campaignFault` for the half that IS checked.
 */
function missingHeaderField(h: Partial<ReplayHeader>): string {
  for (const key of NUMBER_FIELDS) {
    const v = h[key];
    if (typeof v !== 'number' || !Number.isFinite(v)) return String(key);
  }
  for (const key of STRING_FIELDS) {
    if (typeof h[key] !== 'string') return String(key);
  }
  if (!Array.isArray(h.players) || h.players.length === 0) return 'player list';
  for (let i = 0; i < h.players.length; i++) {
    const p = h.players[i] as Partial<ReplaySlot> | undefined;
    if (p === undefined || typeof p !== 'object') return `player ${i}`;
    if (typeof p.faction !== 'number') return `faction for player ${i}`;
    if (typeof p.credits !== 'number' || !Number.isFinite(p.credits)) {
      return `opening bank for player ${i}`;
    }
  }
  return '';
}

/**
 * A reason to refuse a header whose `campaign` is present and unusable, or ''.
 *
 * ABSENT AND MALFORMED ARE DIFFERENT QUESTIONS AND ONLY THE SECOND IS A FAULT.
 * Absence is every pre-campaign v2 file telling the truth about itself. A
 * `campaign` that is present but names no operation is a file claiming to be a
 * recording of scripted content while withholding which script — the boot would
 * arm nothing, the layout would never build, no tag would ever be stamped, and
 * the viewer would get a plausible skirmish on the operation's seed. That is
 * the failure `Playback.ts`'s header calls "the exact failure this whole
 * feature is built to make impossible", so it is refused here rather than
 * survived.
 */
function campaignFault(h: Partial<ReplayHeader>): string {
  const c = h.campaign as Partial<ReplayCampaign> | null | undefined;
  if (c === undefined) return '';
  if (c === null || typeof c !== 'object') {
    return 'header carries a campaign that is not an object';
  }
  if (typeof c.operation !== 'string' || c.operation === '') {
    return 'header names a campaign operation but does not say which';
  }
  if (typeof c.chapter !== 'string' || c.chapter === '') {
    return `header names campaign operation '${c.operation}' with no chapter`;
  }
  return '';
}

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
  // A SET, NOT A NUMBER. 2 is a skirmish and 3 carries a campaign operation;
  // this build reads both. See `ReplayHeader.campaign` for why the version is
  // per-file rather than per-build.
  if (!REPLAY_FORMAT_VERSIONS.includes(h.formatVersion as number)) {
    return {
      ok: false,
      reason: `format version ${String(h.formatVersion)}, `
        + `this build reads ${REPLAY_FORMAT_VERSIONS.join(' or ')}`,
    };
  }
  // EVERY BOOT FIELD IS REQUIRED, and each one is checked by name so a refusal
  // says which. These are not decoration: they are the arguments the world is
  // built from, and a file missing one describes a match this build would have
  // to GUESS at. Guessing produces a playback that looks plausible and is a
  // different game, which is the single outcome this whole file exists to
  // prevent.
  const missing = missingHeaderField(h);
  if (missing !== '') return { ok: false, reason: `header has no ${missing}` };
  // The campaign field is OPTIONAL and its absence is a fact, so it is checked
  // here rather than by name above — and checked at all, because a present-but-
  // empty one is the one shape that would boot a scripted match as a skirmish.
  const badCampaign = campaignFault(h);
  if (badCampaign !== '') return { ok: false, reason: badCampaign };

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

  /** The file being played, for a viewer that wants to read the header. */
  get replay(): ReplayFile { return this.file; }

  /** True once every recorded command has been re-issued. */
  get finished(): boolean { return this.cursor >= this.file.commands.length; }

  /** How many commands the recording holds in total. */
  get commandTotal(): number { return this.file.commands.length; }

  /** How many checkpoints the recording holds in total. */
  get checkTotal(): number { return this.file.checks.length; }

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

    // The recorded block hashes, paired with the LIVE block NAMES — a
    // checkpoint stores numbers, and `describeDivergence` reports names. They
    // are in the same order because they came out of the same function. A file
    // that predates `ReplayCheck.blocks` leaves this empty, which is exactly
    // the old behaviour: the tick, and no block.
    const recordedBlocks = want.blocks ?? [];
    const blocks: ChecksumBlock[] = [];
    for (let i = 0; i < got.blocks.length && i < recordedBlocks.length; i++) {
      blocks.push({ name: got.blocks[i]!.name, hash: recordedBlocks[i]! });
    }
    const expected: SimChecksum = {
      tick: want.tick, hash: want.hash, blocks, entities: want.entities,
    };
    this.firstDesync = describeDivergence(got, expected)
      + ` (recorded ${want.entities} entities, replay has ${got.entities})`;
  }

  /**
   * Re-issue one recorded command.
   *
   * The `switch` over `CommandKind` used to live here. It is now
   * `src/net/applyCommand.ts`, shared with the multiplayer client, because
   * re-issuing a command from a file and re-issuing one from a peer are the
   * same operation and two copies of it would drift — a new command kind added
   * to one and not the other produces a replay that plays a different match, or
   * a lockstep game that desyncs only when somebody uses the new verb.
   */
  private issue(c: ReplayCommand, channels: Channels): void {
    if (applyCommand(channels.commands, c as WireCommand)) return;
    // An unknown kind in a file whose formatVersion we accepted means the enum
    // gained a row without a version bump. Loud, because the replay is now
    // wrong and silence would hide it.
    this.firstDesync = this.firstDesync !== '' ? this.firstDesync
      : `unknown command kind ${c.kind} at tick ${c.tick} — the format version `
        + 'was not bumped when CommandKind changed';
  }
}

/* ==========================================================================
 * 4. THE BUILD VERSION
 * ========================================================================== */

/**
 * A one-line advisory when a replay was recorded on a different build, or ''.
 *
 * THE DECISION, STATED RATHER THAN INHERITED: `buildVersion` WARNS AND DOES NOT
 * REFUSE, AND THAT IS STILL RIGHT FOR PLAYBACK. Three reasons, in order of how
 * much they matter.
 *
 * 1. IT IS A CORRELATION, NOT A CAUSE. Most releases in this repository change
 *    art, audio, shaders and UI, none of which the simulation can observe. A
 *    version compare would expire every replay a player owns on the next patch
 *    — and a replay feature whose files stop working every Tuesday is a replay
 *    feature nobody uses, which is the exact failure `parseReplay`'s refusal
 *    policy is trying to avoid at the other end.
 *
 * 2. THE REAL QUESTION IS MEASURED, NOT GUESSED. "Did THIS build reproduce THAT
 *    match" is answered every `REPLAY_CHECKSUM_INTERVAL` ticks by a full sim
 *    fingerprint compared against the recorded one, with the diverging block
 *    named — see `ReplayPlayer.verify` and `Checksum.describeDivergence`. That
 *    evidence arrives a second into playback and is strictly better than a
 *    string compare, which cannot tell a shader tweak from a rebalanced tank.
 *
 * 3. THE CONVERSE IS ALSO TRUE AND IS THE PART A VERSION GATE MISSES. A replay
 *    recorded on the SAME build can still diverge — the unlock gate answering
 *    from a different local profile is precisely that case. A build check would
 *    have passed it, said nothing, and let the viewer watch a different match.
 *
 * So `formatVersion` refuses (the file cannot be READ) and `buildVersion`
 * warns (the file may not REPLAY, and the checksum will say). The caller is
 * expected to put this string in front of the viewer before playback starts.
 */
export function buildWarning(header: ReplayHeader, thisBuild: string): string {
  const recorded = header.buildVersion;
  if (recorded === '' || recorded === thisBuild) return '';
  return `Recorded on build ${recorded}; this is ${thisBuild}. `
    + 'Playback checks itself against the recording and will report any divergence.';
}
