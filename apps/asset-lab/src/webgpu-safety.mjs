/** Shared fail-closed rendering boundaries for every Asset Lab surface. */
export function boundedPixelRatio(width, height) {
  const maxPixels = 3840 * 2160;
  const cssPixels = Math.max(1, width * height);
  return Math.max(0.5, Math.min(globalThis.devicePixelRatio || 1, 2, Math.sqrt(maxPixels / cssPixels)));
}

export function disableThreeWebGlFallback(nodeRenderer) {
  // Three installs a private WebGL fallback. Reusing a canvas after WebGPU
  // claimed it is invalid, so fail with the real device error instead.
  if (!('_getFallback' in nodeRenderer)) {
    throw new Error('Three.js WebGPU fallback boundary is unavailable; refusing unsafe renderer startup.');
  }
  nodeRenderer._getFallback = null;
}

export async function withTimeout(promise, timeoutMs, label) {
  let timeout = 0;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = globalThis.setTimeout(() => reject(new Error(`${label} exceeded ${timeoutMs / 1000} seconds and was stopped.`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

export function installGpuFailureBoundary(device, onFailure) {
  if (!device) return { heartbeat() {}, settleFirstFrame() {} };
  let stopped = false;
  let frame = 0;
  let pendingHeartbeat = false;
  let scopesOpen = false;
  let scopesSettled = false;
  const fail = (reason) => {
    if (stopped) return;
    stopped = true;
    onFailure(reason instanceof Error ? reason : new Error(String(reason)));
  };
  device.addEventListener?.('uncapturederror', (event) => {
    event.preventDefault?.();
    fail(event.error ?? 'Uncaptured WebGPU error.');
  });
  if (typeof device.pushErrorScope === 'function') {
    try {
      device.pushErrorScope('validation');
      device.pushErrorScope('out-of-memory');
      device.pushErrorScope('internal');
      scopesOpen = true;
    } catch (error) {
      fail(error);
    }
  }
  return {
    settleFirstFrame() {
      if (!scopesOpen || scopesSettled || stopped || typeof device.popErrorScope !== 'function') return;
      scopesSettled = true;
      void Promise.all([device.popErrorScope(), device.popErrorScope(), device.popErrorScope()]).then((errors) => {
        const error = errors.find(Boolean);
        if (error) fail(error);
      }, fail);
    },
    heartbeat() {
      if (stopped || pendingHeartbeat || ++frame % 120 !== 0 || !device.queue?.onSubmittedWorkDone) return;
      pendingHeartbeat = true;
      let timeout = 0;
      const timer = new Promise((_, reject) => {
        timeout = globalThis.setTimeout(() => reject(new Error('WebGPU queue stalled for more than 5 seconds; rendering stopped.')), 5_000);
      });
      void Promise.race([device.queue.onSubmittedWorkDone(), timer]).then(
        () => { clearTimeout(timeout); pendingHeartbeat = false; },
        fail,
      );
    },
  };
}
