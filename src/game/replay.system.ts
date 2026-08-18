/**
 * VOLTMARCH — the replay recorder. `Phase.Command`, order 9500.
 *
 * ORDER 9500 IS LOAD-BEARING and is the only subtle thing in this file.
 * `OrderExecutor.tick()` runs at the very END of Phase.Command and is what
 * drains the bus — the drain is where `CommandBus.observe` fires, so the
 * recorder must be ATTACHED before it and must stamp its checkpoint AFTER the
 * whole tick has run. Attaching is done once in `init()`; the checkpoint is
 * taken here, one phase later than the commands it accompanies, which is
 * exactly right: a checkpoint describes the world the commands produced.
 *
 * IT RECORDS EVERY MATCH, ALWAYS. There is no toggle, because the one thing a
 * player never has when they want a replay is foresight — "if we want a replay
 * right after" is the whole request. The cost is a flat object per command,
 * which for a busy twenty-minute match is a few thousand small objects and
 * roughly a megabyte of JSON. That is cheaper than one texture.
 *
 * `__vmReplay` is the surface: `save()` for the JSON, `download()` for a file,
 * `stats()` for the running counts, and `verify()` / `stopVerify()` to check a
 * stream against a fresh run of the same seed. PLAYBACK NOW EXISTS and is
 * reachable from the product — `src/shell/Replays.ts` loads a file and
 * `src/game/Playback.ts` feeds it into the world — but it is still not driven
 * from here: this file RECORDS, and the only thing it does for playback is the
 * one job that must happen at THIS order, comparing the checkpoints. The shot
 * harness and the probes read this handle, so changing its shape breaks them.
 *
 * THE HEADER IS TAKEN IN TWO PARTS, and that is a fix rather than a wrinkle.
 * `init()` can see the boot flags (they are on the URL) but NOT the lobby: the
 * shell writes the chosen factions after `bootstrap()` returns and the starting
 * bank after `await game.ready`, and the scenario — which adds the Gaia slot —
 * has not run either. A v1 header therefore recorded Bootstrap's two
 * placeholder players and called it the match. `ReplayRecorder.captureStart`
 * takes the rest on the first sim tick, which is the earliest moment all of it
 * is true and the latest moment none of it has changed.
 *
 * THE CAMPAIGN OPERATION IS TAKEN ON THAT SAME TICK AND FOR THAT SAME REASON.
 * `Shell.startOperation` arms an operation and then boots, and
 * `campaign.system.ts#init` adopts it during `registry.init()` — so `init()`
 * here cannot see it and tick 1 can. It is written into the header because an
 * operation's EFFECTS ARE NOT COMMANDS: the Director spawns, pays and reveals
 * inside `simTick`, so a recording of an operation replays only if the same
 * operation is armed for the playback boot and the Director re-runs. Same
 * trade the file already makes for the heightfield, which is not in the replay
 * either — `mapSeed` is.
 */

import { defineSystem } from '../core/loop';
import { Phase } from '../core/types';
import type { SimContext } from '../core/types';
import { ctx } from './context';
import { checksum, describeDivergence } from './Checksum';
import { plannedScenario } from './Scenarios';
import { playbackActive, playbackCampaignFault, playbackVerify } from './Playback';
import {
  REPLAY_FORMAT_VERSION, ReplayPlayer, ReplayRecorder, parseReplay,
} from './Replay';
import type { ReplayCampaign, ReplayFile, ReplayHeader } from './Replay';
// A MODULE-LEVEL SLOT WITH NO RUNTIME WEIGHT. `src/campaign/session.ts`
// imports nothing but types, and `campaign.system.ts` already puts it in the
// entry chunk — `Systems.ts` globs `*.system.ts` eagerly — so reaching it from
// here adds zero bytes to a player who never opens the campaign. The Director,
// the operation table and the layouts are behind `campaign-install` and stay
// there; do not reach past this module.
import { campaignSession } from '../campaign/session';

declare const __APP_VERSION__: string;

/** The build string this bundle was compiled with. */
export function buildVersion(): string {
  return typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
}

/**
 * The seed the terrain was actually generated from.
 *
 * DUCK-TYPED, not added to `ITerrain`. `src/core/**` is frozen infrastructure
 * and a replay's need for an identity string is not a reason to widen a port
 * every null object and every test double then has to satisfy. This is the
 * same pattern `src/game/outcome.system.ts` uses for its shell host, and it
 * degrades correctly: a terrain with no seed reports 0, and `verify()` then
 * refuses to compare rather than pretending the maps match.
 */
function terrainSeed(): number {
  const t = ctx().world.terrain as Partial<{ seed: number }>;
  return typeof t.seed === 'number' ? t.seed : 0;
}

/** One query flag, or '' outside a browser. */
function flag(name: string): string {
  if (typeof location === 'undefined') return '';
  return new URLSearchParams(location.search).get(name) ?? '';
}

/**
 * The operation this match is running, or null for a skirmish.
 *
 * READ ON THE FIRST SIM TICK, never at `init()`: `campaign.system.ts#init`
 * adopts the armed session during the same `registry.init()` pass and system
 * order within that pass is not something this file gets to depend on.
 */
function campaignIdentity(): ReplayCampaign | null {
  const s = campaignSession();
  return s === null ? null : { chapter: s.op.chapter, operation: s.op.id };
}

/**
 * Say so, ONCE, if the recording being watched is not the match that booted.
 *
 * An operation's effects are not in the command stream, so a campaign recording
 * booted without its operation armed plays as an ordinary skirmish on the
 * operation's seed. It diverges — at tick zero, in the entity block, naming no
 * cause. LOUD for the same reason `campaign-install.ts` shouts a short spawn
 * wave: the alternative is a feature that is quietly and completely wrong while
 * every instrument reports a simulation fault.
 */
function reportPlaybackOperation(): void {
  if (!playbackActive()) return;
  const fault = playbackCampaignFault(campaignSession()?.op.id ?? null);
  if (fault === '') return;
  console.error(`%c[replay]%c ${fault}`, 'color:#f66', 'color:inherit');
}

let recorder: ReplayRecorder | null = null;
/** Set when a replay is being verified against the live run. */
let verifier: ReplayPlayer | null = null;

interface ReplayGlobal {
  __vmReplay?: {
    /** The recording so far, as JSON. */
    save(): string;
    /** Command count, checkpoint count and the current sim hash. */
    stats(): { commands: number; checks: number; tick: number; hash: number };
    /** Drop the file into the page as a download. */
    download(name?: string): void;
    /**
     * Verify a recorded stream against THIS running match, tick by tick.
     * Returns the first divergence, or '' while in sync. Only meaningful when
     * the match was booted from the same header.
     */
    verify(json: string): string;
    /** Stop verifying. */
    stopVerify(): void;
  };
}

/**
 * The half of the header that is knowable at `init()`: the boot flags.
 *
 * Everything here comes from the URL or from `plannedScenario()`, which reads
 * the same URL and memoises it — deliberately, because those flags are what the
 * engine modules themselves parsed, so recording anything else would record an
 * intention rather than what ran.
 */
function headerFor(): ReplayHeader {
  const plan = plannedScenario();
  return {
    formatVersion: REPLAY_FORMAT_VERSION,
    buildVersion: buildVersion(),
    // The seed the terrain was actually generated from, not the lobby's intent
    // — `?mapseed=` overrides the setup and a replay must reproduce what ran.
    mapSeed: terrainSeed(),
    // `?seed=` — the scenario layout and every draw of `s.rng`. NOT the same
    // number as `mapSeed`, and its absence is what made a v1 file unplayable.
    simSeed: plan.seed,
    mapPreset: plan.map,
    biome: flag('biome'),
    art: flag('art'),
    start: plan.start,
    scenario: plan.name,
    // Both filled in properly by `captureStart` on the first tick; these are
    // only what the file would say if a recorder were serialised before the
    // match ever ran.
    localPlayer: 0,
    players: [],
  };
}

export default defineSystem({
  id: 'game.replay',
  phase: Phase.Command,
  // AFTER OrderExecutor (9000), so the checkpoint describes a completed tick's
  // commands rather than racing them.
  order: 9500,

  init(): void {
    const { channels } = ctx();
    recorder = new ReplayRecorder(headerFor());
    recorder.attach(channels);
    installGlobal();
  },

  simTick(_s: SimContext): void {
    const r = recorder;
    if (r === null) return;
    const { world } = ctx();
    // ON THE FIRST TICK ONLY, and keyed off the recorder's own latch rather
    // than a second flag, so the two cannot drift apart. This is the one moment
    // at which the armed operation and the armed recording are both knowable
    // and neither has done anything yet.
    //
    // THE OPENING CAPTURE IS INSIDE THAT LATCH RATHER THAN BESIDE IT, BECAUSE
    // `campaignIdentity()` ALLOCATES. `captureStart` is idempotent and returns
    // at its own `opened` flag — but an argument is evaluated before the call,
    // so writing it unconditionally minted one throwaway `{chapter, operation}`
    // per tick, thirty a second, for the whole of an operation, inside the
    // fixed step, for a value the recorder had already discarded. Skipping the
    // call once `started` is set is behaviourally identical to letting it
    // early-return. It takes the lobby's factions, the opening bank, the full
    // player table and the campaign operation — none of which existed when
    // `init()` ran — and on that tick Production (200) and Economy (300) have
    // not run.
    if (!r.started) {
      reportPlaybackOperation();
      r.captureStart(world, campaignIdentity());
    }
    r.maybeCheckpoint(world);

    // PLAYBACK'S CHECKPOINT COMPARE, and it has to happen HERE rather than in
    // `playback.system.ts` — at this order and no other, because this is the
    // point in the tick at which the number being compared was stamped.
    if (playbackActive()) playbackVerify(world);

    const v = verifier;
    if (v !== null) {
      v.verify(world);
      if (v.status.desync !== '') {
        console.error(`%c[replay]%c ${v.status.desync}`, 'color:#f66', 'color:inherit');
        verifier = null;
      }
    }
  },

  dispose(): void {
    recorder?.detach();
    recorder = null;
    verifier = null;
    delete (globalThis as unknown as ReplayGlobal).__vmReplay;
  },
});

/**
 * The recording of the match running right now, or null.
 *
 * Exported so the shell can hand the player their own last match without a
 * download-and-reopen round trip. A SNAPSHOT — `ReplayRecorder.build` copies
 * both arrays — so the caller may hold it across the teardown that is about to
 * happen, which is the entire reason it exists.
 */
export function currentReplay(): ReplayFile | null {
  return recorder === null ? null : recorder.build();
}

function installGlobal(): void {
  (globalThis as unknown as ReplayGlobal).__vmReplay = {
    save(): string {
      return recorder === null ? '' : recorder.serialise();
    },

    stats() {
      const { world } = ctx();
      const c = checksum(world);
      return {
        commands: recorder?.commandCount ?? 0,
        checks: recorder?.checkCount ?? 0,
        tick: world.tick,
        hash: c.hash,
      };
    },

    download(name = `voltmarch-replay-${Date.now()}.json`): void {
      if (recorder === null || typeof document === 'undefined') return;
      const blob = new Blob([recorder.serialise()], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      // Revoked on the next turn: revoking synchronously can race the click on
      // some browsers and download an empty file.
      setTimeout(() => { URL.revokeObjectURL(url); }, 0);
    },

    verify(json: string): string {
      const parsed = parseReplay(json);
      if (!parsed.ok) return `unreadable replay: ${parsed.reason}`;
      const file: ReplayFile = parsed.value;
      if (file.header.mapSeed !== terrainSeed()) {
        // Refused rather than attempted. Verifying against a different map
        // would report a desync on tick zero and teach nobody anything.
        return `this match is seed ${terrainSeed()}, the replay is `
          + `${file.header.mapSeed} — boot the same seed first`;
      }
      // THE SECOND WAY THIS CAN BE THE WRONG MATCH, AND THE SEED TEST CANNOT
      // SEE IT. An operation declares its own `mapSeed`, so a skirmish booted
      // with that `?mapseed=` passes the check above and then diverges on tick
      // one — because the layout, the tags and every trigger only exist in one
      // of the two. Refused rather than attempted, same as above.
      const recordedOp = file.header.campaign?.operation ?? '';
      const runningOp = campaignSession()?.op.id ?? '';
      if (recordedOp !== runningOp) {
        const name = (id: string): string => (id === '' ? 'a skirmish' : `operation ${id}`);
        return `this match is ${name(runningOp)}, the replay is ${name(recordedOp)} `
          + '— boot the same one first';
      }
      verifier = new ReplayPlayer(file);
      return '';
    },

    stopVerify(): void { verifier = null; },
  };
}

/** Exported for tests: compare two live worlds and describe the difference. */
export { checksum, describeDivergence };
