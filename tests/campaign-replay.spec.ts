/**
 * ============================================================================
 * tests/campaign-replay.spec.ts — a campaign operation records and replays
 * ============================================================================
 * A CAMPAIGN OPERATION'S EFFECTS ARE NOT IN THE COMMAND STREAM, AND THAT IS
 * THE DESIGN THIS FILE GUARDS. The Director spawns reinforcements, pays a
 * secondary's bounty and reveals ground INSIDE `simTick`, through
 * `EffectSink` — never through `channels.commands`. Making every effect a wire
 * `Command` was considered and rejected: it grows the most dangerous file in
 * `src/net`, and the simulation has no authority test that would refuse a PvP
 * client conjuring an army.
 *
 * So a recording of an operation carries the operation's NAME and re-runs the
 * Director on playback — the same trade the format already makes for the
 * largest piece of state in the game, where the heightfield is absent and
 * `mapSeed` is present.
 *
 * Three things have to hold for that to be true rather than merely intended,
 * and each has a section below:
 *
 *   1. the name survives the round trip, and its ABSENCE survives too — a v2
 *      file recorded before any operation existed still parses;
 *   2. `REPLAY_FORMAT_VERSION` does NOT move for it, and the version gate is
 *      still live for the things that do move it;
 *   3. an order the Director issues at `Phase.Cleanup` 9000 applies EXACTLY
 *      ONCE under playback — which is a claim about two phase numbers, and is
 *      tested here by running the real recorder and the real `playbackIssue`
 *      through a stub tick pipeline that has those numbers in it.
 *
 * Every section carries a falsifier. Section 3's is the important one: it
 * re-runs the identical scenario with the Director moved between the harvest
 * and the drain and requires the order to apply TWICE, so this file cannot
 * pass against a playback that harvests nothing.
 * ============================================================================
 */

import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Channels } from '../src/core/events';
import { World } from '../src/core/world';
import { EntityFlag, EntityKind, Faction, OrderKind } from '../src/core/types';
import type { Command, EntityId, PlayerId } from '../src/core/types';
import { MAP_SIZE } from '../src/core/config';
import { isKnownCommandKind } from '../src/net/protocol';
import {
  REPLAY_FORMAT_VERSION, REPLAY_FORMAT_VERSIONS, REPLAY_FORMAT_VERSION_CAMPAIGN,
  ReplayPlayer, ReplayRecorder, formatVersionFor, parseReplay,
} from '../src/game/Replay';
import type { ReplayCampaign, ReplayFile, ReplayHeader } from '../src/game/Replay';
import {
  adoptPreparedPlayback, playbackCampaignFault, playbackIssue, preparePlayback,
} from '../src/game/Playback';
import { replaySummary } from '../src/shell/Replays';

const P0 = 0 as PlayerId;
const CX = MAP_SIZE * 0.5;

/** The operation the vertical slice is built on. */
const S1: ReplayCampaign = { chapter: 'soviets', operation: 'soviets.01.first-tap' };

const HEADER: ReplayHeader = {
  formatVersion: REPLAY_FORMAT_VERSION,
  buildVersion: 'test',
  mapSeed: 20_260_819,
  simSeed: 5_101,
  mapPreset: 'arid',
  biome: 'desert',
  art: 'noon',
  start: 'base',
  scenario: 'campaign',
  localPlayer: 0,
  // A REAL PAIR, not `[]`. `missingHeaderField` refuses an empty player list,
  // so a header stub without one would make every refusal below pass for the
  // wrong reason — the parser would be rejecting the seats, not the campaign.
  players: [
    { faction: Faction.Soviets, isHuman: true, aiDifficulty: 0, aiPersonality: 0, credits: 10000 },
    { faction: Faction.Allies, isHuman: false, aiDifficulty: 1, aiPersonality: 0, credits: 10000 },
  ],
};

function makeWorld(): World {
  const w = new World();
  w.addPlayer(Faction.Soviets, 'Commander', true, true);
  w.addPlayer(Faction.Allies, 'Opponent', false, false);
  return w;
}

function spawn(w: World, x: number, z: number): EntityId {
  const s = w.store;
  const h = s.alloc(EntityKind.Vehicle, 3, P0, Faction.Soviets, x, 0, z, 0);
  const i = s.index(h);
  s.hp[i] = 300; s.maxHp[i] = 300; s.radius[i] = 2;
  s.flags[i] |= EntityFlag.CanMove;
  return h;
}

/**
 * Module state in `Playback.ts` outlives a test; nothing here may leak.
 *
 * `preparePlayback(null)` is the full stop — it clears the armed file AND the
 * live player. It is what `Shell.clearReplay` calls, so the reset here is the
 * product's own exit path rather than a test-only affordance.
 */
afterEach(() => { preparePlayback(null); });

/**
 * Arm a recording exactly as the product does: `Shell.startReplay` calls
 * `preparePlayback` BEFORE the boot, and `playback.system.ts#init` adopts it
 * during `registry.init()`, before the first tick. Doing it in one step here
 * would skip the split that `detachPlayback`'s header exists to protect.
 */
function arm(file: ReplayFile): void {
  preparePlayback(null);
  preparePlayback(file);
  adoptPreparedPlayback();
}

/* ==========================================================================
 * 1. THE NAME SURVIVES, AND SO DOES ITS ABSENCE
 * ========================================================================== */

describe('the header carries which operation was played', () => {
  it('takes the chapter and the operation on the first tick, beside the factions and the bank', () => {
    // THE SAME TICK AND THE SAME REASON. `init()` runs inside `registry.init()`
    // and cannot see the armed operation, because `campaign.system.ts` adopts
    // it in that same pass. Tick one is the earliest moment it is knowable and
    // the latest moment nothing has moved.
    const world = makeWorld();
    const rec = new ReplayRecorder({ ...HEADER });
    world.tick = 1;
    rec.captureStart(world, S1);

    const h = rec.build().header;
    expect(h.campaign).toEqual(S1);
    expect(h.players).toHaveLength(2);
  });

  it('survives serialise, parseReplay and ReplayPlayer without losing a field', () => {
    const world = makeWorld();
    const rec = new ReplayRecorder({ ...HEADER });
    world.tick = 1;
    rec.captureStart(world, S1);

    const parsed = parseReplay(rec.serialise());
    if (!parsed.ok) throw new Error(`the recorder produced an unreadable file: ${parsed.reason}`);
    expect(parsed.value.header.campaign).toEqual(S1);
    // The viewer reads the header off the player, not off the file it was
    // handed — `Replays.ts` labels a card from exactly this.
    expect(new ReplayPlayer(parsed.value).replay.header.campaign?.operation)
      .toBe('soviets.01.first-tap');
  });

  it('takes the operation that was running, and a later one cannot rewrite it', () => {
    // The idempotence that protects the opening bank protects this too. A
    // second call is what `Shell.startOperation` would produce if it armed
    // another operation mid-match, and the recording is of the first.
    const world = makeWorld();
    const rec = new ReplayRecorder({ ...HEADER });
    world.tick = 1;
    rec.captureStart(world, S1);
    rec.captureStart(world, { chapter: 'allies', operation: 'allies.04.the-timetable' });
    expect(rec.build().header.campaign).toEqual(S1);
  });

  it('writes NO campaign key for a skirmish, so an older reader sees a fact and not a default', () => {
    /*
     * THE WHOLE VERSION ARGUMENT RESTS ON THIS LINE. `JSON.stringify` drops an
     * `undefined` property and writes `"campaign":null` for the other spelling,
     * so a skirmish file that stored `null` would be a file SAYING something
     * about an operation in a shape no reader was written for. Absent means
     * absent.
     */
    const world = makeWorld();
    const rec = new ReplayRecorder({ ...HEADER });
    world.tick = 1;
    rec.captureStart(world);

    const raw = JSON.parse(rec.serialise()) as { header: Record<string, unknown> };
    expect(Object.prototype.hasOwnProperty.call(raw.header, 'campaign')).toBe(false);
  });
});

describe('the replay library names campaign recordings as operations', () => {
  it('keeps chapter, operation and battlefield together in the summary', () => {
    const file: ReplayFile = {
      header: { ...HEADER, formatVersion: REPLAY_FORMAT_VERSION_CAMPAIGN, campaign: S1 },
      commands: [],
      checks: [],
    };
    const summary = replaySummary(file);
    expect(summary).toContain('Hold the Seam');
    expect(summary).toContain('First Tap');
    expect(summary).toContain('Airbase Flats');
    expect(summary).toContain('Soviet Union vs Allied Forces');
  });

  it('leaves an ordinary skirmish summary operation-free', () => {
    const file: ReplayFile = { header: { ...HEADER }, commands: [], checks: [] };
    const summary = replaySummary(file);
    expect(summary).toContain('Airbase Flats');
    expect(summary).not.toContain('Hold the Seam');
    expect(summary).not.toContain('First Tap');
  });
});

/* ==========================================================================
 * 2. THE FORMAT VERSION DOES NOT MOVE FOR THIS
 * ========================================================================== */

describe('the format version stays 2, because an absent campaign is a fact and not a guess', () => {
  it('is 2, by value', () => {
    /*
     * PINNED BY VALUE ON PURPOSE, AND BUMPING IT HERE WOULD BE WRONG.
     *
     * `Replay.ts`'s bump criterion is stated in `parseReplay`: a version moves
     * when a file "describes a match this build would have to GUESS at". v1
     * met it — it had no `simSeed`, and there is no honest value for a seed
     * that was never written down. `campaign` does not: every v2 file on disk
     * was recorded before an operation existed, so `campaign: undefined` on one
     * of them is TRUE of that match rather than missing from it.
     *
     * That is the identical argument `SaveSlotInfo.extra` / `extraOf` runs on
     * for the save index, which CLAUDE.md endorses as "additive rather than a
     * schema break… rows already on disk degrade instead of failing". Bumping
     * would refuse every replay a player owns and buy nothing.
     */
    expect(REPLAY_FORMAT_VERSION).toBe(2);
  });

  it('parses a genuinely v2-era file that has no campaign field at all', () => {
    // Built by hand rather than by deleting a key from a fresh recording: the
    // point is a file this build never wrote, which is what is actually on
    // players' disks.
    const preCampaign = JSON.stringify({
      header: {
        formatVersion: 2,
        buildVersion: 'v2.16.0',
        mapSeed: 0x51c0de,
        simSeed: 4242,
        mapPreset: 'temperate',
        biome: 'temperate',
        art: 'noon',
        start: 'mcv',
        scenario: 'skirmish',
        localPlayer: 0,
        players: [
          { faction: 0, isHuman: true, aiDifficulty: 0, aiPersonality: 0, credits: 10000 },
          { faction: 1, isHuman: false, aiDifficulty: 1, aiPersonality: 0, credits: 10000 },
        ],
      },
      commands: [],
      checks: [],
    });
    const r = parseReplay(preCampaign);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.header.campaign).toBeUndefined();
  });

  it('still refuses a v1 file, so the gate is live rather than merely lenient', () => {
    // THE FALSIFIER FOR THE CLAIM ABOVE. "A missing field is tolerated" would
    // also be produced by a parser that stopped checking anything, and that
    // parser would happily accept the one file this format exists to refuse.
    const v1 = JSON.stringify({
      header: { ...HEADER, formatVersion: 1, campaign: S1 },
      commands: [], checks: [],
    });
    const r = parseReplay(v1);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain('format version 1');
  });

  it('still refuses a v2 file missing a required boot field, and names it', () => {
    // The second falsifier: `missingHeaderField` is doing its job on everything
    // it lists, and `campaign` is absent from that list deliberately rather
    // than because the list stopped being consulted.
    const noSeed: Partial<ReplayHeader> = { ...HEADER, campaign: S1 };
    delete (noSeed as unknown as Record<string, unknown>).simSeed;
    const r = parseReplay(JSON.stringify({ header: noSeed, commands: [], checks: [] }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('header has no simSeed');
  });
});

describe('a campaign field that is present and unusable is refused', () => {
  const parse = (campaign: unknown): ReturnType<typeof parseReplay> => parseReplay(
    JSON.stringify({ header: { ...HEADER, campaign }, commands: [], checks: [] }),
  );

  it('refuses a campaign that does not say which operation', () => {
    // ABSENT AND MALFORMED ARE DIFFERENT QUESTIONS. This file claims to be a
    // recording of scripted content while withholding the script, so the boot
    // would arm nothing and the viewer would get a skirmish on the operation's
    // seed — the failure `Playback.ts` calls the one this feature exists to
    // make impossible.
    const r = parse({ chapter: 'soviets' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain('does not say which');
  });

  it('refuses an operation with no chapter, because the Replays list reads that field', () => {
    const r = parse({ operation: 'soviets.01.first-tap', chapter: '' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain('soviets.01.first-tap');
  });

  it('refuses a campaign that is not an object', () => {
    expect(parse('soviets.01.first-tap').ok).toBe(false);
    expect(parse(null).ok).toBe(false);
  });

  it('accepts the well-formed one, so the three refusals above are about shape', () => {
    // Without this the section could pass against a parser that refused every
    // campaign header, which would break the feature completely.
    expect(parse(S1).ok).toBe(true);
  });
});

/* ==========================================================================
 * 3. THE DIRECTOR RE-RUNS, AND THE PHASE NUMBERS ARE WHY IT APPLIES ONCE
 *
 * The pipeline below is the shipped one, with the four orders that matter:
 *
 *   Phase.Command  1     `playback.system`  harvest the ring, re-issue the file
 *   Phase.Command  9000  `OrderExecutor`    drain — the ONLY drain
 *   Phase.Command  9500  `replay.system`    checkpoint / verify
 *   Phase.Cleanup  9000  `campaign.system`  the Director, which may issue
 *
 * `campaign.system.ts`'s header states the consequence: an order issued at
 * Cleanup of tick N lands on the bus AFTER that tick's drain, so it is drained
 * on N+1. Recording puts it in the file at N+1. Playback re-derives it at
 * Cleanup of N, and the harvest at Command order 1 of N+1 throws that copy away
 * before feeding the recorded one. Once, at the same tick, either way.
 * ========================================================================== */

type DirectorSlot = 'cleanup' | 'between-harvest-and-drain';

interface Applied { tick: number; x: number }

/**
 * One tick of the pipeline above.
 *
 * `director` is called at `where`; `playback` decides whether Command order 1
 * runs. Everything else is fixed, because everything else is what is being
 * asserted.
 */
function runTick(
  world: World, ch: Channels, tick: number,
  opts: {
    playback: boolean;
    applied: Applied[];
    director?: (() => void) | null;
    where?: DirectorSlot;
  },
): void {
  world.tick = tick;
  ch.commands.tick = tick;

  if (opts.playback) playbackIssue(world, ch);                       // Command 1
  if ((opts.where ?? 'cleanup') === 'between-harvest-and-drain') opts.director?.();
  ch.commands.drain((cmd: Command) => {                              // Command 9000
    opts.applied.push({ tick, x: cmd.x });
  });
  if ((opts.where ?? 'cleanup') === 'cleanup') opts.director?.();    // Cleanup 9000
}

/** The Director's one bus-touching effect: `orderTagged`. */
function orderTagged(ch: Channels, id: EntityId, x: number): void {
  ch.commands.issueOrder(P0, OrderKind.AttackMove, [id as number], 1, x, CX, 0 as EntityId, false);
}

/** Record five ticks in which the Director issues one order at Cleanup of 3. */
function record(): { file: ReplayFile; applied: Applied[] } {
  const world = makeWorld();
  const ch = new Channels();
  const rec = new ReplayRecorder({ ...HEADER });
  rec.attach(ch);
  const unit = spawn(world, CX, CX);
  const applied: Applied[] = [];

  for (let t = 1; t <= 5; t++) {
    rec.captureStart(world, S1);
    runTick(world, ch, t, {
      playback: false,
      applied,
      director: t === 3 ? () => { orderTagged(ch, unit, 200); } : null,
    });
    rec.maybeCheckpoint(world);
  }
  rec.detach();

  const parsed = parseReplay(rec.serialise());
  if (!parsed.ok) throw new Error(`the recorder produced an unreadable file: ${parsed.reason}`);
  return { file: parsed.value, applied };
}

describe('an order the Director issues at Cleanup 9000 applies exactly once under playback', () => {
  it('is recorded on the tick AFTER the Director issued it, which is when the drain sees it', () => {
    // Trap 4 of `Replay.ts` in its campaign clothes: the recorder stamps the
    // APPLY tick. Cleanup is past this tick's drain, so the apply tick is 4.
    const { file, applied } = record();
    expect(file.commands).toHaveLength(1);
    expect(file.commands[0]!.tick).toBe(4);
    expect(applied).toEqual([{ tick: 4, x: 200 }]);
  });

  it('drops the re-derived copy and applies the recorded one, once', () => {
    /*
     * The Director re-derives at Cleanup of tick 3 exactly as it did while
     * recording. It is given a DIFFERENT destination here so the assertion can
     * name which copy survived — in a real playback the two are identical, and
     * a test that could not tell them apart would pass against a playback that
     * ignored the file entirely.
     */
    const { file } = record();
    const world = makeWorld();
    const ch = new Channels();
    const unit = spawn(world, CX, CX);
    const applied: Applied[] = [];

    arm(file);

    for (let t = 1; t <= 5; t++) {
      runTick(world, ch, t, {
        playback: true,
        applied,
        director: t === 3 ? () => { orderTagged(ch, unit, 999); } : null,
      });
    }

    expect(applied).toHaveLength(1);
    expect(applied[0]).toEqual({ tick: 4, x: 200 });
  });

  it('would apply it TWICE if the Director ran between the harvest and the drain', () => {
    /*
     * THE FALSIFIER, AND IT IS THE REASON THE PHASE NUMBER IS LOAD-BEARING
     * RATHER THAN INCIDENTAL. `campaign.system.ts` says: "Move this system
     * ahead of the drain and every scripted order applies twice under
     * playback." This is that move, and the count says so.
     *
     * It also proves the case above is not vacuous — the harvest really is
     * what removes the re-derived copy, rather than the copy never having been
     * issued.
     */
    const { file } = record();
    const world = makeWorld();
    const ch = new Channels();
    const unit = spawn(world, CX, CX);
    const applied: Applied[] = [];

    arm(file);

    for (let t = 1; t <= 5; t++) {
      runTick(world, ch, t, {
        playback: true,
        applied,
        where: 'between-harvest-and-drain',
        director: t === 3 ? () => { orderTagged(ch, unit, 999); } : null,
      });
    }

    expect(applied).toHaveLength(2);
    expect(applied.map((a) => a.x).sort((a, b) => a - b)).toEqual([200, 999]);
  });

  it('has no wire verb that creates an entity, which is why an effect is not a command', () => {
    /*
     * A TRIPWIRE ON THE DESIGN DECISION, NOT A RESTATEMENT OF THE ENUM.
     * `CommandKind` ends at `UsePower = 13` and holds nothing that puts an
     * entity on the ground; that is why `spawnUnits` goes through
     * `ProductionService.spawnUnit` inside `simTick` and why `src/net/protocol.ts`
     * was not touched. The relay's whole contract is "stamps identity; the
     * simulation enforces authority", and the simulation has no authority test
     * that would refuse a PvP client conjuring an army.
     *
     * `CommandKind` is a `const enum`, so its names do not exist at runtime and
     * cannot be scanned — the allowlist the relay actually enforces is what is
     * pinned instead. Adding a fourteenth kind fails here, which is the point:
     * whoever adds it has to come and read this.
     */
    expect(isKnownCommandKind(0)).toBe(false); // None is legal in the enum, meaningless on the wire
    for (let k = 1; k <= 13; k++) expect(isKnownCommandKind(k)).toBe(true);
    expect(isKnownCommandKind(14)).toBe(false);
  });
});

/* ==========================================================================
 * 4. A RECORDING THAT NAMES AN OPERATION SAYS SO WHEN NOTHING IS ARMED
 * ========================================================================== */

describe('playback names the mismatch instead of letting the checksum blame the engine', () => {
  const armed = (campaign: ReplayCampaign | undefined): void => {
    const header: ReplayHeader = { ...HEADER };
    if (campaign === undefined) delete (header as unknown as Record<string, unknown>).campaign;
    else header.campaign = campaign;
    arm({ header, commands: [], checks: [] });
  };

  it('says which operation the recording is when no operation is armed', () => {
    /*
     * THE FAILURE THIS EXISTS FOR. Nothing throws: the layout never builds, no
     * tag is stamped, no trigger fires, and the viewer watches an ordinary
     * skirmish on the operation's seed with the AI switched off. The
     * checkpoints do diverge — at tick zero, in the entity block, naming no
     * cause — which reads like a broken simulation rather than a missing boot
     * argument.
     */
    armed(S1);
    const fault = playbackCampaignFault(null);
    expect(fault).toContain('soviets.01.first-tap');
    expect(fault).toContain('no operation is armed');
  });

  it('is silent when the armed operation is the recorded one', () => {
    armed(S1);
    expect(playbackCampaignFault('soviets.01.first-tap')).toBe('');
  });

  it('reports the other direction too — a skirmish recording under an armed operation', () => {
    // Reachable by pressing Retry and then opening a recording without leaving
    // to the menu, which is the route `disarmOperation` exists to close.
    armed(undefined);
    expect(playbackCampaignFault('soviets.01.first-tap'))
      .toContain('this recording is a skirmish');
  });

  it('names both when two different operations are involved', () => {
    armed(S1);
    const fault = playbackCampaignFault('allies.04.the-timetable');
    expect(fault).toContain('soviets.01.first-tap');
    expect(fault).toContain('allies.04.the-timetable');
  });

  it('is silent in an ordinary match, where there is no recording to disagree with', () => {
    // THE FALSIFIER AGAINST A FUNCTION THAT SIMPLY ALWAYS COMPLAINS. Every
    // skirmish in the game runs with an operation armed exactly never and a
    // playback armed exactly never, and this must say nothing about either.
    preparePlayback(null);
    expect(playbackCampaignFault(null)).toBe('');
    expect(playbackCampaignFault('soviets.01.first-tap')).toBe('');
  });
});

/* ==========================================================================
 * 5. THE WIRING IN `replay.system.ts`, WHICH NO UNIT TEST CAN REACH
 *
 * Sections 1-4 prove three PURE things — the header round trip, the parser's
 * refusals and `playbackCampaignFault` — and every one of them is reached from
 * exactly one place: `src/game/replay.system.ts`. That module needs `ctx()` and
 * a booted engine, so nothing here can call it. Delete the three call sites and
 * all eighteen tests above stay green while the feature does nothing at all.
 *
 * So it is checked the way `replay.spec.ts` and `replay-playback.spec.ts`
 * already check the same module: by reading the source. That is weak on its own
 * — which is why every claim below is a string that would have to be DELETED to
 * break the property, and why the section opens by proving it is reading the
 * right file rather than an empty one.
 * ========================================================================== */

describe('the recorder takes the operation once, and the verifier refuses the wrong one', () => {
  const src = readFileSync(join(__dirname, '..', 'src/game/replay.system.ts'), 'utf8');

  it('is reading replay.system.ts rather than an empty string', () => {
    // THE FALSIFIER FOR THE REST OF THE SECTION. A path slip, a renamed module,
    // a scan of the wrong file — every claim below would go green against
    // nothing whatever. Both markers here predate the campaign and are pinned
    // independently by `replay.spec.ts` and `replay-playback.spec.ts`, so this
    // cannot rot into agreeing with itself.
    expect(src).toContain('boot the same seed first');
    expect(src).toContain('playbackVerify(world)');
  });

  it('hands the armed operation to `captureStart` instead of Replay.ts looking one up', () => {
    // `Replay.ts` is pure and stays pure: it is GIVEN the operation. If this
    // argument is dropped, every recording of every operation is written as a
    // skirmish and section 1 goes on passing, because section 1 calls
    // `captureStart` itself.
    expect(src).toContain('r.captureStart(world, campaignIdentity())');
  });

  it('derives it inside the first-tick latch, because deriving it allocates', () => {
    /*
     * `captureStart` is idempotent and returns at its own `opened` flag — but
     * AN ARGUMENT IS EVALUATED BEFORE THE CALL. Written outside the latch, this
     * minted one throwaway `{ chapter, operation }` per tick — thirty a second,
     * for the whole of an operation, inside the fixed step, for a value the
     * recorder discarded on tick one. It shipped that way; CLAUDE.md's rule is
     * zero allocation on the hot path and the sim tick is the hot path.
     *
     * ONE `captureStart` CALL, and it is between the latch and the checkpoint.
     * A second, unguarded one anywhere in the file would restore the cost while
     * the assertion above went on passing.
     */
    expect(src.match(/r\.captureStart\(/g) ?? []).toHaveLength(1);
    const latch = /if \(!r\.started\) \{/.exec(src);
    expect(latch, 'the first-tick latch is no longer a block').not.toBeNull();
    const checkpoint = src.indexOf('r.maybeCheckpoint(');
    expect(checkpoint).toBeGreaterThan(latch!.index);
    expect(src.slice(latch!.index, checkpoint)).toContain('r.captureStart(');
  });

  it('says so on tick one when the recording names an operation nothing armed', () => {
    // `playbackCampaignFault` is dead code without this call. Section 4 proves
    // the sentence is right; this proves anybody ever reads it.
    expect(src).toContain('playbackCampaignFault(');
    expect(src).toContain('reportPlaybackOperation()');
  });

  it('refuses to verify a live match against a recording of a different operation', () => {
    // THE `mapSeed` GUARD CANNOT SEE THIS. An operation declares its own
    // `mapSeed`, so a skirmish booted with that `?mapseed=` passes the seed
    // check one line above and then diverges on tick one, because the layout,
    // the tags and every trigger exist in only one of the two matches.
    expect(src).toContain('boot the same one first');
  });
});

/* ==========================================================================
 * THE VERSION IS PER-FILE, AND THE DANGEROUS DIRECTION IS NEW-FILE/OLD-BUILD
 *
 * The first draft of `ReplayHeader.campaign`'s comment argued only that an OLD
 * file is safe against a NEW build — true, and not the risk. A campaign
 * recording stamped `formatVersion: 2` is accepted IN FULL by a build that
 * predates the campaign: it takes the header's seeds, arms no operation, and
 * plays a plausible skirmish on the operation's ground while saying nothing.
 * That build genuinely has to GUESS, which is this file's own bump criterion.
 *
 * So a skirmish is written 2 and a campaign is written 3, and this build reads
 * both. Nothing already on disk is affected in either direction.
 * ========================================================================== */

describe('the format version is decided by what the file contains', () => {
  it('a skirmish recording is still version 2, so every old build reads it', () => {
    const rec = new ReplayRecorder({ ...HEADER });
    rec.captureStart(makeWorld(), null);
    expect(rec.build().header.formatVersion).toBe(REPLAY_FORMAT_VERSION);
    expect(REPLAY_FORMAT_VERSION).toBe(2);
  });

  it('a campaign recording is version 3, so an old build refuses it by name', () => {
    const rec = new ReplayRecorder({ ...HEADER });
    rec.captureStart(makeWorld(), S1);
    expect(rec.build().header.formatVersion).toBe(REPLAY_FORMAT_VERSION_CAMPAIGN);
    expect(REPLAY_FORMAT_VERSION_CAMPAIGN).toBe(3);
  });

  it('this build reads both, and nothing else', () => {
    expect([...REPLAY_FORMAT_VERSIONS].sort((a, b) => a - b)).toEqual([2, 3]);

    const skirmish = { header: { ...HEADER, formatVersion: 2 }, commands: [], checks: [] };
    const campaign = {
      header: { ...HEADER, formatVersion: 3, campaign: S1 }, commands: [], checks: [],
    };
    expect(parseReplay(JSON.stringify(skirmish)).ok).toBe(true);
    expect(parseReplay(JSON.stringify(campaign)).ok).toBe(true);

    // THE FALSIFIER. Without it this passes against a parser that accepts
    // anything, which is the failure `formatVersion` exists to prevent.
    for (const bad of [1, 4, 0, -1]) {
      const r = parseReplay(JSON.stringify({ header: { ...HEADER, formatVersion: bad }, commands: [], checks: [] }));
      expect(r.ok, `version ${bad} was accepted`).toBe(false);
      if (!r.ok) expect(r.reason).toContain('format version');
    }
  });

  it('formatVersionFor is the one definition, and both call sites use it', () => {
    expect(formatVersionFor(undefined)).toBe(2);
    expect(formatVersionFor(S1)).toBe(3);
  });
});
