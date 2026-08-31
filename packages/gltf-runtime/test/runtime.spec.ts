import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => {
  const meshoptDecoder = { name: 'matching-three-meshopt-decoder' };

  class FakeGltfLoader {
    manager: unknown;
    meshoptDecoder: unknown;
    ktx2Loader: unknown;

    constructor(manager?: unknown) {
      this.manager = manager;
    }

    setMeshoptDecoder(decoder: unknown) {
      this.meshoptDecoder = decoder;
      return this;
    }

    setKTX2Loader(loader: unknown) {
      this.ktx2Loader = loader;
      return this;
    }
  }

  class FakeKtx2Loader {
    static instances: FakeKtx2Loader[] = [];
    static detectError: Error | null = null;
    workerLimit: number | null = null;
    transcoderPath: string | null = null;
    detectedRenderer: unknown;
    disposeCalls = 0;

    constructor() {
      FakeKtx2Loader.instances.push(this);
    }

    setWorkerLimit(limit: number) {
      this.workerLimit = limit;
      return this;
    }

    setTranscoderPath(path: string) {
      this.transcoderPath = path;
      return this;
    }

    detectSupport(renderer: unknown) {
      this.detectedRenderer = renderer;
      if (FakeKtx2Loader.detectError !== null) throw FakeKtx2Loader.detectError;
      return this;
    }

    dispose() {
      this.disposeCalls++;
      return this;
    }
  }

  return { FakeGltfLoader, FakeKtx2Loader, meshoptDecoder };
});

vi.mock('three/examples/jsm/libs/meshopt_decoder.module.js', () => ({
  MeshoptDecoder: fakes.meshoptDecoder,
}));
vi.mock('three/examples/jsm/loaders/GLTFLoader.js', () => ({
  GLTFLoader: fakes.FakeGltfLoader,
}));
vi.mock('three/examples/jsm/loaders/KTX2Loader.js', () => ({
  KTX2Loader: fakes.FakeKtx2Loader,
}));

import { createGltfLoader } from '../src/gltf';
import { createKtx2LoaderPool } from '../src/ktx2';

describe('createGltfLoader', () => {
  it('creates independent loaders with the matching Three Meshopt decoder', () => {
    const first = createGltfLoader() as unknown as InstanceType<typeof fakes.FakeGltfLoader>;
    const second = createGltfLoader() as unknown as InstanceType<typeof fakes.FakeGltfLoader>;

    expect(first).not.toBe(second);
    expect(first.meshoptDecoder).toBe(fakes.meshoptDecoder);
    expect(second.meshoptDecoder).toBe(fakes.meshoptDecoder);
  });

  it('attaches caller-owned manager and KTX2 loader before use', () => {
    const manager = {};
    const ktx2Loader = {};
    const loader = createGltfLoader({
      manager: manager as never,
      ktx2Loader: ktx2Loader as never,
    }) as unknown as InstanceType<typeof fakes.FakeGltfLoader>;

    expect(loader.manager).toBe(manager);
    expect(loader.ktx2Loader).toBe(ktx2Loader);
  });
});

describe('createKtx2LoaderPool', () => {
  beforeEach(() => {
    fakes.FakeKtx2Loader.instances.length = 0;
    fakes.FakeKtx2Loader.detectError = null;
  });

  it('shares one bounded worker pool until the final release', () => {
    const renderer = {};
    const pool = createKtx2LoaderPool({ transcoderPath: '/basis/', workerLimit: 2 });
    const first = pool.acquire(renderer) as unknown as InstanceType<typeof fakes.FakeKtx2Loader>;
    const second = pool.acquire(renderer);

    expect(second).toBe(first);
    expect(first.workerLimit).toBe(2);
    expect(first.transcoderPath).toBe('/basis/');
    expect(first.detectedRenderer).toBe(renderer);
    expect(fakes.FakeKtx2Loader.instances).toHaveLength(1);

    pool.release();
    expect(first.disposeCalls).toBe(0);
    pool.release();
    expect(first.disposeCalls).toBe(1);
  });

  it('preserves one loader across overlapping replacement-renderer generations', () => {
    const firstRenderer = {};
    const secondRenderer = {};
    const pool = createKtx2LoaderPool({ workerLimit: 2 });
    const first = pool.acquire(firstRenderer) as unknown as InstanceType<typeof fakes.FakeKtx2Loader>;
    const replacement = pool.acquire(secondRenderer);

    expect(replacement).toBe(first);
    expect(first.detectedRenderer).toBe(firstRenderer);
    pool.release();
    expect(first.disposeCalls).toBe(0);

    pool.release();
    const second = pool.acquire(secondRenderer) as unknown as InstanceType<typeof fakes.FakeKtx2Loader>;
    expect(second).not.toBe(first);
    expect(second.detectedRenderer).toBe(secondRenderer);
  });

  it('cleans up support-detection failures and remains reusable', () => {
    const pool = createKtx2LoaderPool({ workerLimit: 1 });
    fakes.FakeKtx2Loader.detectError = new Error('unsupported');

    expect(() => pool.acquire({})).toThrow('unsupported');
    expect(fakes.FakeKtx2Loader.instances[0].disposeCalls).toBe(1);

    fakes.FakeKtx2Loader.detectError = null;
    expect(() => pool.acquire({})).not.toThrow();
    expect(fakes.FakeKtx2Loader.instances).toHaveLength(2);
  });

  it('makes over-release and repeated disposal harmless', () => {
    const pool = createKtx2LoaderPool({ transcoderPath: '', workerLimit: 2 });
    const loader = pool.acquire({}) as unknown as InstanceType<typeof fakes.FakeKtx2Loader>;

    expect(loader.transcoderPath).toBeNull();
    pool.release();
    pool.release();
    pool.dispose();
    expect(loader.disposeCalls).toBe(1);
  });

  it('rejects invalid worker limits before allocating a loader', () => {
    expect(() => createKtx2LoaderPool({ workerLimit: 0 })).toThrow(RangeError);
    expect(() => createKtx2LoaderPool({ workerLimit: 1.5 })).toThrow(RangeError);
    expect(fakes.FakeKtx2Loader.instances).toHaveLength(0);
  });
});
