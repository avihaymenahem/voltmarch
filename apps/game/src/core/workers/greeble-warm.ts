/**
 * ============================================================================
 * VOLTMARCH — src/core/workers/greeble-warm.ts
 * ============================================================================
 * THE ONE LINE THAT LETS THE ART LAYER USE A WORKER.
 *
 * `src/art/**` must not know that workers exist — it is the layer that owns
 * pixels, not threads, and `greeble-gen.ts` was split out of `Greeble.ts`
 * precisely so the generation code could be imported by a worker WITHOUT the
 * art layer importing anything in the other direction. So the wiring is a
 * function reference handed down from here, exactly as `setWakeSink` and
 * `setTreadSink` work in `sim/Movement.ts`, and `setHarvesterDrive` in
 * `sim/Harvesting.ts`.
 *
 * NOT A `*.system.ts`. `texture-warm.system.ts` has to be one because it also
 * needs an `init()` to await outstanding jobs before the curtain lifts. This
 * file has no init half: the prewarm is awaited by the art systems themselves,
 * inside the init that is about to need the atlases, which is both earlier and
 * more precise than a global barrier would be.
 *
 * IT SHARES THE TEXTURE POOL, DELIBERATELY. There are at most four workers and
 * both kinds of job land in the same second of boot; a second pool would double
 * the thread count to halve the queue, which on a 4-core machine is a net loss.
 * `TexturePool.submitGreeble` is the other end.
 * ============================================================================
 */

import { setGreebleGenerator } from '../../art/Greeble';
import { textures } from '../assets';

/**
 * Point the art layer's `prewarm` at the shared texture pool.
 *
 * Safe to call before the pool has started: `TexturePool` brings its workers up
 * lazily on first submit, and answers `null` for everything if it cannot. A
 * `null` means "build it on the main thread", which is what the art layer did
 * before any of this existed — so the failure mode of this whole feature is the
 * old behaviour, at the old speed.
 */
export function installGreebleWorkers(): void {
  if (typeof location !== 'undefined' && location.search.includes('greebleworkers=off')) {
    // An A/B switch, kept because the alternative is editing this file to
    // measure it. The boot log prints "N atlas(es) off-thread" either way, so
    // the two runs are directly comparable and the fallback path stays exercised
    // rather than becoming code nobody ever runs.
    console.info('[greeble] worker offload disabled by ?greebleworkers=off');
    return;
  }
  setGreebleGenerator((spec) => textures.submitGreeble(spec));
}
