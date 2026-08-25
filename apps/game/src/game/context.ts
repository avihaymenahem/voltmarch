/**
 * The GameContext accessor.
 *
 * `SystemModule.init()` deliberately takes no arguments — the shape is frozen in
 * src/core/types.ts and every parallel module default-exports one. So modules
 * reach the world, the scene and the channels through here instead.
 *
 *     import { ctx } from '../game/context';
 *
 *     export default defineSystem({
 *       id: 'my-module',
 *       phase: Phase.Movement,
 *       init() {
 *         const { world, sceneRig } = ctx();
 *         sceneRig.scene.add(this.mesh);
 *       },
 *     });
 *
 * `ctx()` is only valid from `init()` onwards. Calling it at module top level
 * throws, and it throws with a useful message rather than handing back a
 * half-built object — a module that silently captured `undefined.world` at
 * import time would fail hundreds of frames later somewhere unrelated.
 */

import type { GameContext } from './Bootstrap';

let current: GameContext | null = null;

/** Bootstrap calls this exactly once, before `registry.init()`. */
export function setGameContext(next: GameContext | null): void {
  current = next;
}

/**
 * The live GameContext. Valid inside `init`, `simTick`, `frame` and `dispose`.
 * Never valid at module scope.
 */
export function ctx(): GameContext {
  if (current === null) {
    throw new Error(
      'ctx() called before bootstrap finished wiring. This almost always means it ' +
        'was called at module top level instead of inside init()/simTick()/frame().',
    );
  }
  return current;
}

/** True once the context exists — for optional integrations that must not throw. */
export function hasGameContext(): boolean {
  return current !== null;
}
