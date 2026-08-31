import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => {
  const gltfLoadAsync = vi.fn();
  const ktx2Load = vi.fn();
  const ktx2Loader = { load: ktx2Load };
  const pool = {
    acquire: vi.fn(() => ktx2Loader),
    release: vi.fn(),
  };
  const finish = vi.fn();
  const beginBootSpan = vi.fn(() => finish);
  const bootAssetLabel = vi.fn((url: string) => `asset:${url}`);
  return { gltfLoadAsync, ktx2Load, ktx2Loader, pool, finish, beginBootSpan, bootAssetLabel };
});

vi.mock('@voltmarch/gltf-runtime/gltf', () => ({
  createGltfLoader: vi.fn(() => ({
    loadAsync: (...args: unknown[]) => runtime.gltfLoadAsync(...args),
  })),
}));
vi.mock('@voltmarch/gltf-runtime/ktx2', () => ({
  createKtx2LoaderPool: vi.fn(() => runtime.pool),
}));
vi.mock('../src/core/boot-telemetry', () => ({
  beginBootSpan: runtime.beginBootSpan,
  bootAssetLabel: runtime.bootAssetLabel,
}));

import { createRuntimeGLTFLoader } from '../src/art/RuntimeGLTFLoader';
import {
  acquireRuntimeKTX2Loader,
  releaseRuntimeKTX2Loader,
} from '../src/art/RuntimeKTX2Loader';

describe('runtime loader telemetry facades', () => {
  beforeEach(() => {
    runtime.gltfLoadAsync.mockReset();
    runtime.ktx2Load.mockReset();
    runtime.pool.acquire.mockClear();
    runtime.pool.release.mockClear();
    runtime.finish.mockClear();
    runtime.beginBootSpan.mockClear();
    runtime.bootAssetLabel.mockClear();
  });

  it('preserves GLTF success and error span boundaries', async () => {
    const success = { scene: {} };
    runtime.gltfLoadAsync.mockResolvedValueOnce(success);
    const successLoader = createRuntimeGLTFLoader();
    await expect(successLoader.loadAsync('/unit.glb')).resolves.toBe(success);

    const failure = new Error('decode failed');
    runtime.gltfLoadAsync.mockRejectedValueOnce(failure);
    const failureLoader = createRuntimeGLTFLoader();
    await expect(failureLoader.loadAsync('/broken.glb')).rejects.toBe(failure);

    expect(runtime.beginBootSpan).toHaveBeenNthCalledWith(
      1,
      'gltf',
      'load-parse-decode',
      { asset: 'asset:/unit.glb' },
    );
    expect(runtime.beginBootSpan).toHaveBeenNthCalledWith(
      2,
      'gltf',
      'load-parse-decode',
      { asset: 'asset:/broken.glb' },
    );
    expect(runtime.finish.mock.calls).toEqual([[], ['error']]);
  });

  it('preserves KTX2 callbacks, errors and final release', () => {
    const texture = {};
    const onLoad = vi.fn();
    runtime.ktx2Load.mockImplementationOnce((_url, load) => {
      load(texture);
      return texture;
    });
    const loader = acquireRuntimeKTX2Loader({});
    expect(loader.load('/mask.ktx2', onLoad)).toBe(texture);
    expect(onLoad).toHaveBeenCalledWith(texture);

    const failure = new Error('transcode failed');
    const onError = vi.fn();
    runtime.ktx2Load.mockImplementationOnce((_url, _load, _progress, error) => {
      error(failure);
      return undefined;
    });
    loader.load('/broken.ktx2', vi.fn(), undefined, onError);
    expect(onError).toHaveBeenCalledWith(failure);

    expect(runtime.beginBootSpan).toHaveBeenNthCalledWith(
      1,
      'texture',
      'ktx2-ready',
      { asset: 'asset:/mask.ktx2' },
    );
    expect(runtime.beginBootSpan).toHaveBeenNthCalledWith(
      2,
      'texture',
      'ktx2-ready',
      { asset: 'asset:/broken.ktx2' },
    );
    expect(runtime.finish.mock.calls).toEqual([[], ['error']]);

    releaseRuntimeKTX2Loader();
    expect(runtime.pool.release).toHaveBeenCalledOnce();
  });
});
