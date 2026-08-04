/**
 * SHELL — the falsifiable half.
 *
 * Everything in `src/shell/**` that does not need a DOM: settings migration and
 * clamping, the keybind conflict detector, the match-query builder and the
 * store's persistence and diffing. The suite runs under `environment: 'node'`
 * like the rest of the repo, so `settings-store.ts` deliberately imports
 * nothing from the engine and nothing from the document — these tests are the
 * reason that constraint exists.
 *
 * The classes that DO build DOM (Shell, the five screens) are not exercised
 * here; they are covered by booting the page, which is the screenshot
 * harness's job.
 */

import { describe, expect, it } from 'vitest';

import {
  CREDIT_OPTIONS,
  DIFFICULTIES,
  KEYBINDS,
  MANAGED_FLAGS,
  MAPS,
  PERSONALITIES,
  SETTINGS_STORAGE_KEY,
  SETUP_STORAGE_KEY,
  SPEEDS,
  SettingsStore,
  buildMatchQuery,
  chordEquals,
  chordLabel,
  codeLabel,
  conflictingIds,
  defaultBindings,
  defaultSettings,
  defaultSetup,
  diffSettings,
  findConflicts,
  isBindableCode,
  keybindCategories,
  mapById,
  memoryStorage,
  normalizeSettings,
  normalizeSetup,
  rollSeed,
  touched,
  type Chord,
  type StorageLike,
} from '../src/shell/settings-store';

/* ========================================================================== */

describe('settings — normalisation is total', () => {
  it('returns a complete settings object for any garbage', () => {
    for (const junk of [null, undefined, 0, 'nope', [], true, { graphics: 7 }]) {
      const s = normalizeSettings(junk);
      expect(s.graphics.tier).toBe('auto');
      expect(s.audio.master).toBeGreaterThan(0);
      expect(Object.keys(s.controls.bindings).length).toBe(KEYBINDS.length);
    }
  });

  it('clamps out-of-range numbers instead of accepting them', () => {
    const s = normalizeSettings({
      audio: { master: 4000, music: -12 },
      graphics: { resolutionScale: 99, fov: 1 },
      gameplay: { panSpeed: -5, zoomToCursor: 8 },
    });
    expect(s.audio.master).toBe(100);
    expect(s.audio.music).toBe(0);
    expect(s.graphics.resolutionScale).toBe(2);
    expect(s.graphics.fov).toBe(24);
    expect(s.gameplay.panSpeed).toBe(10);
    expect(s.gameplay.zoomToCursor).toBe(1);
  });

  it('replaces NaN with the default rather than storing it', () => {
    const s = normalizeSettings({ audio: { sfx: NaN }, graphics: { fov: Number.POSITIVE_INFINITY } });
    expect(s.audio.sfx).toBe(defaultSettings().audio.sfx);
    expect(s.graphics.fov).toBe(defaultSettings().graphics.fov);
  });

  it('keeps the zoom limits ordered whatever it is handed', () => {
    const s = normalizeSettings({ graphics: { minZoom: 200, maxZoom: 40 } });
    expect(s.graphics.minZoom).toBeLessThan(s.graphics.maxZoom);
  });

  it('drops unknown keybind ids and fills missing ones from the defaults', () => {
    const s = normalizeSettings({
      controls: { bindings: { 'ord.stop': { code: 'KeyK', ctrl: false, shift: false, alt: false }, 'gone.away': { code: 'KeyP' } } },
    });
    expect(s.controls.bindings['ord.stop'].code).toBe('KeyK');
    expect(s.controls.bindings['gone.away']).toBeUndefined();
    expect(s.controls.bindings['cam.panUp'].code).toBe('KeyW');
  });

  it('refuses a binding on a key the browser owns', () => {
    const s = normalizeSettings({ controls: { bindings: { 'ord.stop': { code: 'F5' } } } });
    expect(s.controls.bindings['ord.stop'].code).toBe('KeyS');
    expect(isBindableCode('F5')).toBe(false);
    expect(isBindableCode('ShiftLeft')).toBe(false);
    expect(isBindableCode('KeyS')).toBe(true);
  });
});

/* ========================================================================== */

describe('keybinds', () => {
  it('ships with no conflicts', () => {
    expect(findConflicts(defaultBindings())).toEqual([]);
  });

  it('does not flag a key shared between the camera and order surfaces', () => {
    const b = defaultBindings();
    // KeyA is genuinely pan-left AND attack-move today — two different
    // keyboard surfaces, one physical key, and that is not a bug.
    expect(b['cam.panLeft'].code).toBe('KeyA');
    expect(b['ord.attackMove'].code).toBe('KeyA');
    expect(conflictingIds(b).size).toBe(0);
  });

  it('flags both sides of a real conflict', () => {
    const b = defaultBindings();
    b['ord.guard'] = { ...b['ord.stop'] };
    const ids = conflictingIds(b);
    expect(ids.has('ord.guard')).toBe(true);
    expect(ids.has('ord.stop')).toBe(true);
  });

  it('treats a global binding as conflicting with every surface', () => {
    const b = defaultBindings();
    b['sys.perf'] = { code: 'KeyG', ctrl: false, shift: false, alt: false };
    const ids = conflictingIds(b);
    expect(ids.has('sys.perf')).toBe(true);
    expect(ids.has('ord.guard')).toBe(true);
  });

  it('ignores unbound commands', () => {
    const b = defaultBindings();
    b['ord.guard'] = { code: '', ctrl: false, shift: false, alt: false };
    b['ord.scatter'] = { code: '', ctrl: false, shift: false, alt: false };
    // Two commands sharing "no key" is not two commands sharing a key.
    expect(findConflicts(b)).toEqual([]);
  });

  it('does not offer a command the engine cannot reach', () => {
    // The shell claims Escape for the pause menu in the capture phase, so the
    // engine's own Escape handling never fires during a match. See KEYBINDS.
    expect(KEYBINDS.some((k) => k.id === 'sel.clear')).toBe(false);
    expect(KEYBINDS.find((k) => k.id === 'sys.menu')?.def.code).toBe('Escape');
  });

  it('distinguishes chords by modifier', () => {
    const plain: Chord = { code: 'KeyA', ctrl: false, shift: false, alt: false };
    const withCtrl: Chord = { code: 'KeyA', ctrl: true, shift: false, alt: false };
    expect(chordEquals(plain, withCtrl)).toBe(false);
    expect(chordEquals(plain, { ...plain })).toBe(true);
  });

  it('labels codes by physical key, not by layout', () => {
    expect(codeLabel('KeyW')).toBe('W');
    expect(codeLabel('Digit4')).toBe('4');
    expect(codeLabel('ArrowLeft')).toBe('Left Arrow');
    expect(codeLabel('Escape')).toBe('Esc');
    expect(chordLabel({ code: 'KeyA', ctrl: true, shift: true, alt: false })).toBe('CTRL + SHIFT + A');
    expect(chordLabel({ code: '', ctrl: false, shift: false, alt: false })).toBe('UNBOUND');
  });

  it('groups every binding under a declared category', () => {
    const categories = keybindCategories();
    for (const k of KEYBINDS) expect(categories).toContain(k.category);
  });
});

/* ========================================================================== */

describe('match setup', () => {
  it('never lets the opponent mirror the player', () => {
    const setup = normalizeSetup({ playerFaction: 'soviets', aiFaction: 'soviets' }, ['allies', 'soviets']);
    expect(setup.playerFaction).toBe('soviets');
    expect(setup.aiFaction).not.toBe('soviets');
  });

  it('accepts a faction it has never heard of only if the roster names it', () => {
    const known = normalizeSetup({ playerFaction: 'empire' }, ['allies', 'soviets', 'empire']);
    expect(known.playerFaction).toBe('empire');
    const unknown = normalizeSetup({ playerFaction: 'empire' }, ['allies', 'soviets']);
    expect(unknown.playerFaction).toBe('allies');
  });

  it('clamps every index into its table', () => {
    const s = normalizeSetup({ difficulty: 99, personality: -50, speed: 12 }, ['allies', 'soviets']);
    expect(s.difficulty).toBe(DIFFICULTIES.length - 1);
    expect(s.personality).toBe(-1);
    expect(s.speed).toBe(SPEEDS.length - 1);
  });

  it('falls back to the first map for an unknown id', () => {
    expect(mapById('does-not-exist').id).toBe(MAPS[0].id);
    expect(mapById(MAPS[2].id).id).toBe(MAPS[2].id);
  });

  it('offers only credit amounts the lobby lists', () => {
    expect(CREDIT_OPTIONS).toContain(defaultSetup().startingCredits);
  });

  it('rolls a non-zero seed', () => {
    expect(rollSeed(() => 0)).toBe(1);
    expect(rollSeed(() => 0.5)).toBeGreaterThan(0);
    expect(Number.isInteger(rollSeed(() => 0.25))).toBe(true);
  });
});

/* ========================================================================== */

describe('boot flags', () => {
  const settings = defaultSettings();

  it('writes every flag the engine modules read', () => {
    const q = buildMatchQuery(defaultSetup(), settings, '', 1234);
    expect(q.get('map')).toBe(mapById(defaultSetup().map).preset);
    expect(q.get('biome')).toBe(mapById(defaultSetup().map).biome);
    expect(q.get('seed')).toBe('1234');
    expect(q.get('mapseed')).toBeTruthy();
    expect(q.get('ai')).toBe('normal');
  });

  it('NEVER writes ?shot= — that flag belongs to the screenshot harness', () => {
    const q = buildMatchQuery(defaultSetup(), settings, 'shot=allied-base');
    expect(MANAGED_FLAGS).not.toContain('shot');
    // buildMatchQuery preserves unmanaged flags; the Shell deletes `shot`
    // explicitly. What matters here is that it never ADDS one.
    expect(q.getAll('shot').length).toBeLessThanOrEqual(1);
  });

  it('preserves developer flags it does not own', () => {
    const q = buildMatchQuery(defaultSetup(), settings, 'perf=1&audio=off&keepPlaceholder=1');
    expect(q.get('perf')).toBe('1');
    expect(q.get('audio')).toBe('off');
    expect(q.get('keepPlaceholder')).toBe('1');
  });

  it('replaces stale values of the flags it does own', () => {
    const q = buildMatchQuery(defaultSetup(), settings, 'map=urban&seed=7&ai=brutal', 99);
    expect(q.getAll('map').length).toBe(1);
    expect(q.get('seed')).toBe('99');
    expect(q.get('ai')).toBe('normal');
  });

  it('only pins ?tier= when the player chose one', () => {
    expect(buildMatchQuery(defaultSetup(), settings, '').has('tier')).toBe(false);
    const pinned = normalizeSettings({ ...settings, graphics: { ...settings.graphics, tier: 'ultra' } });
    expect(buildMatchQuery(defaultSetup(), pinned, '').get('tier')).toBe('ultra');
  });

  it('writes a personality only when one was chosen', () => {
    const setup = { ...defaultSetup(), personality: 1 };
    expect(buildMatchQuery(setup, settings, '').get('aip')).toBe(PERSONALITIES[1].toLowerCase());
    expect(buildMatchQuery(defaultSetup(), settings, '').has('aip')).toBe(false);
  });
});

/* ========================================================================== */

describe('SettingsStore', () => {
  function store(seed?: Record<string, string>): { s: SettingsStore; storage: StorageLike } {
    const storage = memoryStorage();
    for (const k of Object.keys(seed ?? {})) storage.setItem(k, seed![k]);
    return { s: new SettingsStore(storage), storage };
  }

  it('starts from the defaults with empty storage', () => {
    const { s } = store();
    expect(s.get()).toEqual(defaultSettings());
  });

  it('survives corrupt JSON', () => {
    const { s } = store({ [SETTINGS_STORAGE_KEY]: '{not json', [SETUP_STORAGE_KEY]: '][' });
    expect(s.get().graphics.tier).toBe('auto');
    expect(s.setup().map).toBe(defaultSetup().map);
  });

  it('persists a patch and reports the changed paths', () => {
    const { s, storage } = store();
    const changed = s.patch({ audio: { music: 12 } });
    expect(changed).toEqual(['audio.music']);
    expect(s.get().audio.music).toBe(12);
    expect(JSON.parse(storage.getItem(SETTINGS_STORAGE_KEY)!).audio.music).toBe(12);
  });

  it('reports nothing for a no-op patch', () => {
    const { s } = store();
    expect(s.patch({ audio: { music: s.get().audio.music } })).toEqual([]);
  });

  it('notifies subscribers exactly once per real change', () => {
    const { s } = store();
    let calls = 0;
    let lastChanged: readonly string[] = [];
    const off = s.subscribe((_settings, changed) => { calls++; lastChanged = changed; });
    s.patch({ graphics: { bloom: false } });
    s.patch({ graphics: { bloom: false } });
    expect(calls).toBe(1);
    expect(lastChanged).toEqual(['graphics.bloom']);
    off();
    s.patch({ graphics: { bloom: true } });
    expect(calls).toBe(1);
  });

  it('resets one section without touching the others', () => {
    const { s } = store();
    s.patch({ audio: { music: 3 }, graphics: { bloom: false } });
    s.reset('audio');
    expect(s.get().audio.music).toBe(defaultSettings().audio.music);
    expect(s.get().graphics.bloom).toBe(false);
  });

  it('round-trips the match setup', () => {
    const { s, storage } = store();
    s.setSetup({ ...defaultSetup(), map: MAPS[3].id, difficulty: 3 }, ['allies', 'soviets']);
    expect(s.setup().map).toBe(MAPS[3].id);
    const reloaded = new SettingsStore(storage);
    expect(reloaded.setup().difficulty).toBe(3);
  });

  it('diffs keybinds by chord, not by identity', () => {
    const a = defaultSettings();
    const b = normalizeSettings(a);
    expect(diffSettings(a, b)).toEqual([]);
    b.controls.bindings['ord.stop'] = { code: 'KeyK', ctrl: false, shift: false, alt: false };
    expect(diffSettings(a, b)).toEqual(['controls.ord.stop']);
  });
});

/* ========================================================================== */

describe('touched', () => {
  it('matches a path and its children, and nothing else', () => {
    const changed = ['graphics.bloom', 'audio.master'];
    expect(touched(changed, 'graphics')).toBe(true);
    expect(touched(changed, 'graphics.bloom')).toBe(true);
    expect(touched(changed, 'graphics.bloomier')).toBe(false);
    expect(touched(changed, 'gameplay')).toBe(false);
  });
});
