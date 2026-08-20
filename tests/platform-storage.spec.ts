import { afterEach, describe, expect, it, vi } from 'vitest';

import { BRIDGE_VERSION, type DesktopBridge } from '../src/platform/desktop';
import { detectBackend, detectIndexStorage } from '../src/game/SaveStore';
import { persistentStorage } from '../src/platform/storage';

function bridge(): DesktopBridge {
  const values = new Map<string, string>();
  const saves = new Map<string, Uint8Array>();
  return {
    bridge: BRIDGE_VERSION,
    platform: 'win32',
    appVersion: async () => 'test',
    gpuInfo: async () => ({}),
    displayFrequency: async () => 60,
    quit: () => undefined,
    setFullscreen: async () => undefined,
    isFullscreen: async () => false,
    minimize: () => undefined,
    revealUserData: async () => undefined,
    displayState: async () => { throw new Error('unused'); },
    setDisplayState: async () => { throw new Error('unused'); },
    relaunch: () => undefined,
    storageGet: (key) => values.get(key) ?? null,
    storageSet: (key, value) => { values.set(key, value); },
    storageRemove: (key) => { values.delete(key); },
    saveWrite: async (slot, bytes) => { saves.set(slot, bytes.slice()); },
    saveRead: async (slot) => saves.get(slot)?.slice() ?? null,
    saveRemove: async (slot) => { saves.delete(slot); },
  };
}

describe('platform persistence selection', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses Electron userData and filesystem saves before browser storage', async () => {
    const desktop = bridge();
    vi.stubGlobal('voltmarch', desktop);
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('desktop must not read browser storage for native data'); },
      setItem: () => { throw new Error('desktop must not write browser storage'); },
      removeItem: () => { throw new Error('desktop must not remove browser storage'); },
    });
    vi.stubGlobal('indexedDB', { open: () => { throw new Error('desktop must not open IndexedDB'); } });

    const storage = persistentStorage();
    storage.setItem('vm.test', 'native');
    expect(storage.getItem('vm.test')).toBe('native');

    const backend = detectBackend();
    expect(backend.name).toBe('filesystem');
    expect(detectIndexStorage().name).toBe('filesystem');
    await backend.write('manual-1', new Uint8Array([3, 1, 4]));
    expect(Array.from(await backend.read('manual-1') ?? [])).toEqual([3, 1, 4]);
  });
});
