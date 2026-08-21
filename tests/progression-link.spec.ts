import { afterEach, describe, expect, it, vi } from 'vitest';

import { setUnlockGate } from '../src/progression/UnlockGate';
import { aiMirrorsUnlocks, setAiMirrorsUnlocks } from '../src/shell/progression-link';

function storage(): { values: Map<string, string>; api: Storage } {
  const values = new Map<string, string>();
  const api = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  } satisfies Storage;
  return { values, api };
}

describe('opponent progression policy', () => {
  afterEach(() => {
    setUnlockGate(null);
    vi.unstubAllGlobals();
  });

  it('defaults a fresh profile to an unrestricted AI and persists an explicit mirror choice', () => {
    const state = storage();
    vi.stubGlobal('localStorage', state.api);

    expect(aiMirrorsUnlocks()).toBe(false);
    setAiMirrorsUnlocks(true);
    expect(aiMirrorsUnlocks()).toBe(true);
    expect(state.values.get('vm.ai.mirrorUnlocks')).toBe('1');
  });
});
