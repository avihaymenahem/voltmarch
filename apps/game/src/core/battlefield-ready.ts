/**
 * One-shot boundary between boot-critical work and background presentation work.
 *
 * A wall-clock timeout started by an early art system is not a post-boot gate:
 * on a cold machine it can expire while later systems are still beneath the
 * loading curtain. Bootstrap publishes this signal only after the first fully
 * rendered battlefield frame. Deferred asset catalogues can then start without
 * extending the visible-ready promise.
 */

type ReadyListener = () => void;
type DeferredWork = {
  active: boolean;
  priority: number;
  sequence: number;
  run: () => void | Promise<void>;
};

let presented = false;
const listeners = new Set<ReadyListener>();
const workQueue: DeferredWork[] = [];
let workSequence = 0;
let workEpoch = 0;
let workTimer: ReturnType<typeof setTimeout> | null = null;
let workRunning = false;

/** Minimum idle budget required before beginning one main-thread asset parse. */
const ASSET_IDLE_BUDGET_MS = 8;
/** Do not let a continuously busy frame queue starve cosmetic assets forever. */
const ASSET_IDLE_TIMEOUT_MS = 2_000;

interface IdleDeadlineLike {
  readonly didTimeout: boolean;
  timeRemaining(): number;
}

interface IdleWindow {
  requestIdleCallback?: (
    callback: (deadline: IdleDeadlineLike) => void,
    options?: { timeout: number },
  ) => number;
}

/**
 * Yield deferred catalogue work until the browser has enough spare time for
 * one bounded parse. A timeout fallback keeps the same contract in harnesses
 * and older WebViews, but always crosses a task boundary so completed work can
 * paint before the next asset begins.
 */
export function waitForBattlefieldIdle(): Promise<void> {
  const host = globalThis as typeof globalThis & IdleWindow;
  if (typeof host.requestIdleCallback !== 'function') {
    return new Promise<void>((resolve) => { setTimeout(resolve, 16); });
  }
  return new Promise<void>((resolve) => {
    const probe = (deadline: IdleDeadlineLike): void => {
      if (deadline.didTimeout || deadline.timeRemaining() >= ASSET_IDLE_BUDGET_MS) {
        resolve();
        return;
      }
      host.requestIdleCallback!(probe, { timeout: ASSET_IDLE_TIMEOUT_MS });
    };
    host.requestIdleCallback!(probe, { timeout: ASSET_IDLE_TIMEOUT_MS });
  });
}

/**
 * Runtime GLTF parsing is not preemptible. Keep it behind an explicit A/B flag
 * so production play never trades a shorter curtain for mid-match Long Tasks.
 */
export function liveAssetStreamingEnabled(search?: string): boolean {
  const query = search ?? (typeof location === 'undefined' ? '' : location.search);
  return new URLSearchParams(query).get('liveassetstream') === 'on';
}

function scheduleWorkDrain(): void {
  if (!presented || workRunning || workTimer !== null || workQueue.length === 0) return;
  const epoch = workEpoch;
  // Keep the reveal and its first interactions quiet. Each queued catalogue is
  // already internally bounded; serialising catalogues prevents four separate
  // pools from multiplying their peak decode memory.
  workTimer = setTimeout(() => {
    workTimer = null;
    if (epoch !== workEpoch) return;
    void drainWork(epoch);
  }, 1_000);
}

async function drainWork(epoch: number): Promise<void> {
  if (workRunning || epoch !== workEpoch) return;
  workRunning = true;
  try {
    while (epoch === workEpoch) {
      workQueue.sort((a, b) => (a.priority - b.priority) || (a.sequence - b.sequence));
      const item = workQueue.shift();
      if (item === undefined) return;
      if (!item.active) continue;
      try {
        await item.run();
      } catch (error) {
        console.error('[boot] deferred battlefield work failed', error);
      }
      // Yield one turn between catalogues so a completed promotion can paint
      // before the next parse/conditioning wave begins.
      await new Promise<void>((resolve) => { setTimeout(resolve, 50); });
    }
  } finally {
    workRunning = false;
    scheduleWorkDrain();
  }
}

/** Begin a new renderer/world lifetime. Called before any system init runs. */
export function resetBattlefieldReady(): void {
  presented = false;
  listeners.clear();
  workEpoch++;
  workQueue.length = 0;
  if (workTimer !== null) clearTimeout(workTimer);
  workTimer = null;
}

/**
 * Subscribe to the first presented battlefield frame.
 *
 * Late subscribers are queued instead of called inline so registration never
 * unexpectedly re-enters its caller. The returned function is idempotent.
 */
export function afterBattlefieldReady(listener: ReadyListener): () => void {
  if (presented) {
    let active = true;
    queueMicrotask(() => {
      if (active) listener();
    });
    return () => { active = false; };
  }
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Publish the boundary once, after Bootstrap has painted frame zero. */
export function markBattlefieldReady(): void {
  if (presented) return;
  presented = true;
  const pending = [...listeners];
  listeners.clear();
  for (const listener of pending) {
    try {
      listener();
    } catch (error) {
      console.error('[boot] deferred battlefield-ready listener failed', error);
    }
  }
  scheduleWorkDrain();
}

/**
 * Queue non-critical asset work behind the first battlefield frame.
 * Lower priorities run first; equal priorities retain registration order.
 */
export function scheduleBattlefieldWork(
  priority: number,
  run: () => void | Promise<void>,
): () => void {
  const item: DeferredWork = { active: true, priority, sequence: workSequence++, run };
  workQueue.push(item);
  scheduleWorkDrain();
  return () => { item.active = false; };
}
