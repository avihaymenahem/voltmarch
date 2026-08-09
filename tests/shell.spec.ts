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
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { defaultCameraCodes } from '../src/input/ActionCatalogue';

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
    expect(s.controls.bindings['cam.panUp'].code).toBe('ArrowUp');
  });

  it('migrates an untouched v1 WASD pan scheme onto the arrows', () => {
    const v1 = {
      version: 1,
      controls: {
        bindings: {
          'cam.panUp': { code: 'KeyW', ctrl: false, shift: false, alt: false },
          'cam.panDown': { code: 'KeyS', ctrl: false, shift: false, alt: false },
          'cam.panLeft': { code: 'KeyA', ctrl: false, shift: false, alt: false },
          'cam.panRight': { code: 'KeyD', ctrl: false, shift: false, alt: false },
        },
      },
    };
    const s = normalizeSettings(v1);
    expect(s.controls.bindings['cam.panUp'].code).toBe('ArrowUp');
    expect(s.controls.bindings['cam.panRight'].code).toBe('ArrowRight');
    expect(s.version).toBe(2);
  });

  it('leaves a v1 pan scheme alone once the player has touched it', () => {
    // One row changed means the group is the player's, not the old default.
    const s = normalizeSettings({
      version: 1,
      controls: {
        bindings: {
          'cam.panUp': { code: 'KeyW', ctrl: false, shift: false, alt: false },
          'cam.panDown': { code: 'KeyS', ctrl: false, shift: false, alt: false },
          'cam.panLeft': { code: 'KeyA', ctrl: false, shift: false, alt: false },
          'cam.panRight': { code: 'KeyL', ctrl: false, shift: false, alt: false },
        },
      },
    });
    expect(s.controls.bindings['cam.panUp'].code).toBe('KeyW');
    expect(s.controls.bindings['cam.panRight'].code).toBe('KeyL');
  });

  it('does not re-run the v2 migration on an already-migrated blob', () => {
    // A v2 player who deliberately chose WASD keeps it across every later load.
    const chosen = {
      version: 2,
      controls: {
        bindings: {
          'cam.panUp': { code: 'KeyW', ctrl: false, shift: false, alt: false },
          'cam.panDown': { code: 'KeyS', ctrl: false, shift: false, alt: false },
          'cam.panLeft': { code: 'KeyA', ctrl: false, shift: false, alt: false },
          'cam.panRight': { code: 'KeyD', ctrl: false, shift: false, alt: false },
        },
      },
    };
    const once = normalizeSettings(chosen);
    expect(once.controls.bindings['cam.panUp'].code).toBe('KeyW');
    expect(normalizeSettings(once).controls.bindings['cam.panUp'].code).toBe('KeyW');
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
    // The SHIPPED scheme no longer overlaps — pan is on the arrows precisely so
    // that holding a pan key cannot also arm an order (see KEYBINDS). But a
    // player is still allowed to put pan-left back on KeyA, and when they do it
    // must not be reported as a conflict: two keyboard surfaces, one physical
    // key, and that is deliberate.
    expect(b['cam.panLeft'].code).toBe('ArrowLeft');
    expect(b['ord.attackMove'].code).toBe('KeyA');

    b['cam.panLeft'] = { code: 'KeyA', ctrl: false, shift: false, alt: false };
    expect(conflictingIds(b).size).toBe(0);
  });

  it('the shipped camera pan scheme is what the engine actually polls', () => {
    // This used to grep `input.system.ts` for a hard-coded DEFAULT_CAMERA_KEYS
    // literal, because that file could not import the shell (a `?shot=` boot
    // never loads that chunk) and therefore kept a second copy of these codes.
    // The copy is gone: the engine now derives its table from
    // `src/input/ActionCatalogue.ts`, which has no imports at all, so the
    // agreement can be asserted on real values instead of on source text.
    // `tests/action-catalogue.spec.ts` owns the rest of that contract.
    const b = defaultBindings();
    const codes = defaultCameraCodes();
    for (const id of ['cam.panUp', 'cam.panDown', 'cam.panLeft', 'cam.panRight',
      'cam.rotateLeft', 'cam.rotateRight']) {
      expect(codes[id], id).toBe(b[id].code);
    }
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

/* -------------------------------------------------------------------------- */
/* The page-layout gate.                                                      */
/* -------------------------------------------------------------------------- */

/**
 * EVERY FULL-PAGE SCREEN MUST CLAIM `.vm-page` ON ITS HOST.
 *
 * `.vm-screen` — the layer `Shell.show` builds for a screen — is a bare flex
 * container with no alignment of its own. `.vm-page` is what supplies
 * `align-items: center`, `justify-content: center` and the outer padding, and
 * a screen that forgets it does not fail: it renders perfectly, pinned to the
 * top-left corner of the viewport and stretched to the full height.
 *
 * That is exactly how the multiplayer lobby shipped, and it is a defect no
 * amount of type checking can see — the class is a string, the layout is CSS,
 * and the only witness is a human looking at the screen. The `?shot=` harness
 * cannot catch it either: those fixtures never load the shell chunk, which is
 * the same blind spot `tests/shell-scope.spec.ts` was written for.
 *
 * So: read the source, find every `implements Screen` that builds a `pageFrame`,
 * and require the class. Both `add('vm-page')` and the multi-argument
 * `add('vm-page', 'is-modal')` count — `Missions` legitimately uses the latter.
 */
describe('page layout gate', () => {
  const SHELL_DIR = join(process.cwd(), 'src', 'shell');

  it('every Screen that builds a pageFrame centres itself', () => {
    const offenders: string[] = [];
    for (const name of readdirSync(SHELL_DIR)) {
      if (!name.endsWith('.ts')) continue;
      const src = readFileSync(join(SHELL_DIR, name), 'utf8');
      // Only Screens. `HelpPanel` builds a pageFrame too, but it is not a
      // Screen — it mounts its own `.vm-help` root with its own layout.
      if (!/implements Screen\b/.test(src)) continue;
      // `pageFrame('` — a CALL, which always passes a string title. Matching
      // `pageFrame(` alone also matches the DECLARATION in Shell.ts, which
      // happens to sit in the same file as `LoadingScreen implements Screen`
      // and made this gate report a screen that renders its own `.vm-load`
      // layer and never touches a page frame.
      if (!/pageFrame\('/.test(src)) continue;
      if (/classList\.add\((?:[^)]*,\s*)?'vm-page'|classList\.add\('vm-page'/.test(src)) continue;
      offenders.push(name);
    }
    expect(offenders, 'these screens will render pinned to the top-left corner').toEqual([]);
  });

  it('would actually catch one', () => {
    // A gate nobody has seen fail is a gate nobody knows works. This is the
    // exact shape MultiplayerSetup.ts had when the lobby rendered off-centre.
    const broken = `class X implements Screen {\n  mount(host: HTMLElement) {\n    const f = pageFrame('X', () => {});\n  }\n}`;
    const centred = `class X implements Screen {\n  mount(host: HTMLElement) {\n    host.classList.add('vm-page');\n    const f = pageFrame('X', () => {});\n  }\n}`;
    const passes = (s: string): boolean =>
      !/implements Screen\b/.test(s) || !/pageFrame\('/.test(s)
      || /classList\.add\((?:[^)]*,\s*)?'vm-page'|classList\.add\('vm-page'/.test(s);
    expect(passes(broken)).toBe(false);
    expect(passes(centred)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* The re-enable trap.                                                        */
/* -------------------------------------------------------------------------- */

/**
 * A BUTTON BUILT DISABLED MUST STILL WORK ONCE IT IS ENABLED.
 *
 * `button()` used to attach `onClick` only on the enabled branch, so a button
 * created disabled never got a handler. Nothing noticed for the life of the
 * function because every disabled button in the product was disabled
 * PERMANENTLY — Load Game with no saves, and nothing else.
 *
 * The Multiplayer entry is the first that starts disabled and enables itself
 * when the relay answers. It came up enabled, correctly labelled, and
 * completely dead to the touch, and it took a browser and a confused minute to
 * work out why. Asserted here so it cannot come back.
 */
describe('a button built disabled', () => {
  /*
   * ASSERTED FROM THE SOURCE, because this suite runs under `environment:
   * 'node'` and there is no DOM to click — see this file's header. Adding jsdom
   * for one assertion would be a dependency for a behaviour a five-line read
   * can pin exactly.
   */
  const shellSrc = readFileSync(join(process.cwd(), 'src', 'shell', 'Shell.ts'), 'utf8');
  const body = shellSrc.slice(
    shellSrc.indexOf('export function button('),
    shellSrc.indexOf('export function setButtonEnabled('),
  );

  it('gets its click handler unconditionally, not on the enabled branch', () => {
    expect(body.length, 'button() must be findable').toBeGreaterThan(100);
    const attach = body.indexOf("addEventListener('click'");
    const apply = body.indexOf('setButtonEnabled(b,');
    expect(attach, 'button() must attach onClick').toBeGreaterThan(-1);
    expect(apply, 'button() must route its disabled state through setButtonEnabled').toBeGreaterThan(-1);
    // Attached BEFORE the enabled state is applied, and therefore outside any
    // branch on it. The old shape put the listener inside `else { ... }`, so a
    // button created disabled never got one and stayed inert forever once
    // something re-enabled it — which is exactly how the Multiplayer entry
    // shipped: enabled, correctly labelled, and dead to the touch.
    expect(attach).toBeLessThan(apply);
    expect(body).not.toMatch(/else\s*\{[\s\S]*addEventListener\('click'/);
    // And the listener checks `disabled` ITSELF rather than trusting the DOM to
    // suppress the event. `savegame-ux.spec.ts` drives a stub that does not
    // model the suppression, and it caught the first version of this that did.
    expect(body).toMatch(/if\s*\(!b\.disabled\)/);
  });

  it('has one place that knows enabling also means the focus ring', () => {
    // `focusable()` only assigns a tabindex when there is none, so flipping
    // `disabled` by hand leaves a re-enabled button at -1: mouse-reachable and
    // keyboard-invisible. `setButtonEnabled` is the one place that does both.
    const setter = shellSrc.slice(shellSrc.indexOf('export function setButtonEnabled('));
    expect(setter).toContain('removeAttribute');
    expect(setter).toContain('tabindex');
    expect(setter).toContain('focusable(b)');
  });

  it('is what the Multiplayer entry actually uses', () => {
    const menu = readFileSync(join(process.cwd(), 'src', 'shell', 'MainMenu.ts'), 'utf8');
    expect(menu).toContain('setButtonEnabled(b, ok)');
    // COMMENTS STRIPPED FIRST. The line explaining why not to write
    // `b.disabled = ...` contains `b.disabled = ...`, so a naive search over the
    // whole file fails on its own documentation — which it duly did.
    const code = menu.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    expect(code, 'the probe must not flip `disabled` by hand').not.toMatch(/b\.disabled\s*=/);
  });
});
