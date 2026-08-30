/**
 * ============================================================================
 * VOLTMARCH — src/core/workers/texture-warm.system.ts
 * ============================================================================
 * THE SEAM THAT MAKES THE TEXTURE WORKER SAFE TO USE.
 *
 * Two jobs, at two different moments, and the gap between them is the point.
 *
 * AT BOOTSTRAP TIME it installs the worker pool on the shared factory, before
 * `registry.init()` gives any system a chance to ask for a texture. Installing
 * it inside this system's own `init()` would be too late:
 * `world.terrain` (order 40) and `world.roads` (order 60) both build their
 * materials in theirs. `roads.system.ts` binds its scorch sink at module scope
 * for the same reason, and this is the same category of work — a function
 * reference stored on an object. No `ctx()`, no GL, no allocation.
 *
 * It cannot be a module-scope call: modules are evaluated once, but the shell
 * builds many worlds per page and `settleWorkers()` disposes the pool after
 * each one. Module scope accelerated the title theatre and silently left every
 * later match generating uncached textures and greebles on the main thread.
 *
 * AT INIT TIME — dead last — it waits for every dispatched job to land.
 * `SystemRegistry.init()` awaits each module's `init` in `(phase, order, seq)`
 * order, and `Bootstrap.ready` (which is what `src/main.ts` waits on before it
 * drops the loading curtain) resolves after that. So sitting at the highest
 * phase with the highest order means: every texture the game asked for during
 * boot holds its real pixels before anything is drawn, and no placeholder is
 * ever on screen. `settleWorkers()` then disposes the pool, because a texture
 * requested mid-match must not pop in three frames after it appears.
 *
 * IF ANY OF THIS FAILS, IT FAILS INTO THE OLD BEHAVIOUR. No `Worker`, a script
 * that will not load, a worker that stops answering — `TexturePool` disables
 * itself, `TextureFactory` generates the outstanding textures on this thread
 * before `settleWorkers()` resolves, and boot is exactly as slow as it was
 * before the worker existed. It cannot be slower by more than one job deadline.
 * ============================================================================
 */

import { defineSystem } from '../loop';
import { Phase } from '../types';
import { textures } from '../assets';
import { spawnTextureWorker } from './spawn';
import { installGreebleWorkers } from './greeble-warm';

/**
 * And point the art layer's greeble prewarm at that same pool, in the same
 * window and for the same reason: `art.buildings` and `art.units` build their
 * atlases inside their own `init()`, so the generator has to be installed
 * before ANY init runs, not inside one.
 *
 * It shares the pool rather than starting a second one — see the header of
 * `greeble-warm.ts`.
 */
export function prepareTextureWorkers(): void {
  textures.useWorkers(spawnTextureWorker);
  installGreebleWorkers();
}

/**
 * Last in the queue. `Phase.Cleanup` is the highest phase in the enum and this
 * order is past anything a gameplay module would plausibly choose, so this
 * module's `init` runs after every other one — which is the entire contract it
 * exists to provide.
 */
const LAST = Number.MAX_SAFE_INTEGER;

export default defineSystem({
  id: 'core.textureWarm',
  phase: Phase.Cleanup,
  order: LAST,

  async init(): Promise<void> {
    await textures.settleWorkers();
    const s = textures.workerStats();
    if (s.dispatched === 0) return;
    console.info(
      `%c[textures]%c ${s.adopted} channels off-thread, ${s.fellBack} on the main thread`
      + `${s.reason !== '' ? ` (worker off: ${s.reason})` : ''}`,
      'color:#7fb', 'color:inherit',
    );
  },
});
