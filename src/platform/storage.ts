/** Platform persistence selected once by capability, not by caller. */

import { desktopBridge } from './desktop';

export interface PersistentStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function browserStorage(): PersistentStorage | null {
  try {
    const candidate = (globalThis as { localStorage?: Storage }).localStorage;
    if (candidate === undefined) return null;
    const probe = '__vm_storage_probe__';
    candidate.setItem(probe, '1');
    candidate.removeItem(probe);
    return candidate;
  } catch {
    return null;
  }
}

function memoryStorage(): PersistentStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  };
}

let memory: PersistentStorage | null = null;

/**
 * Native filesystem storage in Electron, browser storage on the web.
 *
 * A native miss checks the old web store once per key and imports a value when
 * present. That is a migration path for existing desktop installs, never the
 * active desktop backend; every subsequent read comes from `userData/storage`.
 */
export function persistentStorage(): PersistentStorage {
  const bridge = desktopBridge();
  if (bridge !== null) {
    return {
      getItem(key: string): string | null {
        const native = bridge.storageGet(key);
        if (native !== null) return native;
        const legacy = browserStorage()?.getItem(key) ?? null;
        if (legacy !== null) bridge.storageSet(key, legacy);
        return legacy;
      },
      setItem: (key, value) => bridge.storageSet(key, value),
      removeItem: (key) => bridge.storageRemove(key),
    };
  }
  return browserStorage() ?? (memory ??= memoryStorage());
}
