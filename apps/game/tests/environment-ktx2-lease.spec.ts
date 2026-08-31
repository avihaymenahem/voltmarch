import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => {
  let consumers = 0;
  let disposed = false;
  const loader = {
    loadAsync: vi.fn(async () => {
      if (disposed) throw new Error('worker pool disposed');
      return {};
    }),
  };
  return {
    loader,
    acquire: vi.fn(() => {
      consumers++;
      disposed = false;
      return loader;
    }),
    release: vi.fn(() => {
      consumers = Math.max(0, consumers - 1);
      if (consumers === 0) disposed = true;
    }),
    reset(): void {
      consumers = 0;
      disposed = false;
      loader.loadAsync.mockClear();
    },
    consumers: (): number => consumers,
    disposed: (): boolean => disposed,
  };
});

vi.mock('../src/art/RuntimeKTX2Loader', () => ({
  acquireRuntimeKTX2Loader: runtime.acquire,
  releaseRuntimeKTX2Loader: runtime.release,
}));

import { acquireEnvironmentKTX2Loader } from '../src/world/EnvironmentAssetLoader';

describe('environment KTX2 promotion leases', () => {
  beforeEach(() => {
    runtime.acquire.mockClear();
    runtime.release.mockClear();
    runtime.reset();
  });

  it('keeps replacement-world workers alive when a stale generation releases', async () => {
    const staleGeneration = acquireEnvironmentKTX2Loader({});
    const replacementGeneration = acquireEnvironmentKTX2Loader({});

    expect(runtime.acquire).toHaveBeenCalledTimes(2);
    expect(staleGeneration.loader).toBe(replacementGeneration.loader);
    expect(runtime.consumers()).toBe(2);

    staleGeneration.release();
    expect(runtime.release).toHaveBeenCalledOnce();
    expect(runtime.consumers()).toBe(1);
    expect(runtime.disposed()).toBe(false);
    await expect(replacementGeneration.loader.loadAsync('replacement.ktx2')).resolves.toEqual({});

    // Generation-finally paths may be reached twice during fault cleanup; a
    // lease releases exactly once and the live replacement remains protected.
    staleGeneration.release();
    expect(runtime.release).toHaveBeenCalledOnce();
    expect(runtime.consumers()).toBe(1);

    replacementGeneration.release();
    expect(runtime.release).toHaveBeenCalledTimes(2);
    expect(runtime.consumers()).toBe(0);
    expect(runtime.disposed()).toBe(true);
  });
});
