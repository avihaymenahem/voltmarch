/**
 * VOLTMARCH — replay playback. `Phase.Command`, order 1.
 *
 * ORDER 1 IS THE WHOLE FILE, for the same reason `net.lockstep` is order 0:
 * this is the only point in a tick at which commands can be put ON the bus
 * before the single thing that drains it (`OrderExecutor`, order 9000) runs.
 * At any later order the recording's commands would sit in the ring until the
 * NEXT tick's drain, so every command in the file would apply one tick late —
 * a divergence that compounds and whose cause is invisible.
 *
 * It is 1 rather than 0 because `net.lockstep` owns 0. The two are mutually
 * exclusive in practice (a replay is not a live match), and if they ever were
 * not, the network — which has a peer waiting — must go first.
 *
 * INERT UNTIL A REPLAY SAYS OTHERWISE. Discovery registers every `*.system.ts`
 * under `src/`, so this loads in every match. With nothing prepared, `simTick`
 * returns on its first line and a skirmish runs byte-identically to before.
 *
 * The verification half is NOT here — it lives in `replay.system.ts` at order
 * 9500, because a checkpoint has to be compared at the exact point in the tick
 * it was stamped. See the header of `src/game/Playback.ts`.
 */

import { defineSystem } from '../core/loop';
import { Phase } from '../core/types';
import type { SimContext } from '../core/types';
import { ctx } from './context';
import { adoptPreparedPlayback, detachPlayback, playbackActive, playbackIssue } from './Playback';

export default defineSystem({
  id: 'game.playback',
  phase: Phase.Command,
  order: 1,

  /**
   * Adopt a replay the shell armed before the boot.
   *
   * `registry.init()` runs before `loop.start()`, so anything adopted here is
   * feeding the bus from tick 1 — which is the first tick the recording has
   * commands for.
   */
  init(): void {
    adoptPreparedPlayback();
  },

  simTick(_s: SimContext): void {
    if (!playbackActive()) return;
    const { world, channels } = ctx();
    playbackIssue(world, channels);
  },

  /**
   * `detachPlayback`, NOT `endPlayback`, and the difference is the whole
   * feature — see that function's header. `Shell.startReplay` arms a file and
   * then boots, and booting disposes the previous engine: clearing the ARMED
   * file here means the match that is starting never plays the recording, and
   * says nothing about it.
   */
  dispose(): void {
    detachPlayback();
  },
});
