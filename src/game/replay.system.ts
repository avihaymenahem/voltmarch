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
 * and `play()` to verify a stream against a fresh run. Same pattern as
 * `__vmVfx` and `__vmProduction`, and the same warning applies — the shot
 * harness and the probes read these handles, so changing the shape breaks them.
 */

import { defineSystem } from '../core/loop';
import { Phase } from '../core/types';
import type { SimContext } from '../core/types';
import { ctx } from './context';
import { checksum, describeDivergence } from './Checksum';
import {
  REPLAY_FORMAT_VERSION, ReplayPlayer, ReplayRecorder, parseReplay,
} from './Replay';
import type { ReplayFile, ReplayHeader } from './Replay';

declare const __APP_VERSION__: string;

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

function headerFor(): ReplayHeader {
  const { world } = ctx();
  return {
    formatVersion: REPLAY_FORMAT_VERSION,
    buildVersion: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev',
    // The seed the terrain was actually generated from, not the lobby's intent
    // — `?mapseed=` overrides the setup and a replay must reproduce what ran.
    mapSeed: terrainSeed(),
    scenario: 'skirmish',
    players: world.players.map((p) => ({
      faction: p.faction as number,
      isHuman: p.isHuman,
      aiDifficulty: p.aiDifficulty,
      aiPersonality: p.aiPersonality,
    })),
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
    r.maybeCheckpoint(world);

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
      verifier = new ReplayPlayer(file);
      return '';
    },

    stopVerify(): void { verifier = null; },
  };
}

/** Exported for tests: compare two live worlds and describe the difference. */
export { checksum, describeDivergence };
