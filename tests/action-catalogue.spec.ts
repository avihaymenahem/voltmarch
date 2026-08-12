/**
 * ============================================================================
 * tests/action-catalogue.spec.ts
 * ============================================================================
 * `src/input/ActionCatalogue.ts` is the one description of what a player can
 * do, and three modules read it. Two things can still rot underneath it, and
 * both are asserted here:
 *
 *   1. THE SETTINGS STORE. Persistence, normalisation and conflict detection
 *      live in `src/shell/settings-store.ts` and are keyed by `KEYBINDS`. A
 *      catalogue action marked `rebindable` whose id is not in that table would
 *      be silently dropped from the saved blob on the next load — the player
 *      would rebind it, the row would revert, and nothing would say why. So the
 *      two tables must agree on ids, defaults and surfaces.
 *
 *   2. THE ENGINE. `input.system.ts` switches on catalogue ids. An id that
 *      exists in the catalogue with no case in that switch is a row on the help
 *      screen that does nothing, which is precisely the failure the catalogue
 *      was written to end.
 *
 * The catalogue has no imports, so everything here runs under `environment:
 * 'node'` like the rest of the suite.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';

import {
  ACTIONS,
  ACTION_CATEGORIES,
  ACTION_CATEGORY_IDS,
  BUILD_SLOT_HOTKEYS,
  BUILD_SLOT_HOTKEY_LABELS,
  BUILD_TAB_HOTKEYS,
  BUILD_TAB_HOTKEY_LABELS,
  CAMERA_KEY_IDS,
  COMMAND_ACTION_IDS,
  actionById,
  actionsIn,
  bareKeyLabel,
  buildHotkeyBlockedBy,
  buildHotkeyConflicts,
  defaultCameraCodes,
  defaultCommandChords,
  isApplePlatform,
  isModifierName,
  liveChordFor,
  modifierChips,
  modifierLabel,
  rebindableActions,
  sameChord,
} from '../src/input/ActionCatalogue';

import { BUILD_TAB_COUNT } from '../src/core/types';
import { KEYBINDS, chordLabel, findConflicts, defaultBindings } from '../src/shell/settings-store';

/* ==========================================================================
 * 1. THE CATALOGUE ITSELF
 * ========================================================================== */

describe('action catalogue', () => {
  it('has a unique id for every action', () => {
    const seen = new Set<string>();
    for (const a of ACTIONS) {
      expect(seen.has(a.id), `duplicate action id ${a.id}`).toBe(false);
      seen.add(a.id);
    }
    expect(seen.size).toBe(ACTIONS.length);
  });

  it('gives every action a label, a description and a known category', () => {
    for (const a of ACTIONS) {
      expect(a.label.length, a.id).toBeGreaterThan(0);
      // A one-word description is a label with a full stop; these rows are the
      // only explanation the player gets.
      expect(a.description.length, a.id).toBeGreaterThan(20);
      expect(ACTION_CATEGORY_IDS, a.id).toContain(a.category);
    }
  });

  it('declares a category def for every category id, and no orphans', () => {
    expect(ACTION_CATEGORIES.map((c) => c.id)).toEqual([...ACTION_CATEGORY_IDS]);
    for (const c of ACTION_CATEGORIES) {
      expect(actionsIn(c.id).length, `${c.id} has no actions`).toBeGreaterThan(0);
    }
  });

  it('makes every binding kind reachable in exactly one way', () => {
    for (const a of ACTIONS) {
      if (a.binding === 'rebindable') {
        expect(a.defaultChord, a.id).not.toBeNull();
        expect(a.fixedChips, a.id).toBeUndefined();
      } else if (a.binding === 'fixed') {
        // Either a single chord, or literal chips — never neither.
        const hasChord = a.defaultChord !== null;
        const hasChips = a.fixedChips !== undefined && a.fixedChips.length > 0;
        expect(hasChord || hasChips, `${a.id} is fixed but names no keys`).toBe(true);
      } else {
        expect(a.defaultChord, a.id).toBeNull();
        expect(a.gesture, `${a.id} is a gesture with no phrasing`).toBeTruthy();
      }
    }
  });

  it('resolves an action by id and misses cleanly', () => {
    expect(actionById('ord.attackMove')?.label).toBe('Attack Move');
    expect(actionById('ord.nonsense')).toBeUndefined();
  });
});

/* ==========================================================================
 * 2. THE DERIVED TABLES THE ENGINE CONSUMES
 * ========================================================================== */

describe('catalogue -> engine tables', () => {
  it('splits the rebindable actions across the two keyboard surfaces', () => {
    const rebindable = rebindableActions().map((a) => a.id).sort();
    const derived = [
      ...COMMAND_ACTION_IDS,
      ...CAMERA_KEY_IDS,
      // The pause chord and the reserved rows are the shell's, not the input
      // system's, so they are rebindable without being on either table.
      ...ACTIONS.filter((a) => a.binding === 'rebindable' && a.surface === 'global').map((a) => a.id),
    ].sort();
    expect(derived).toEqual(rebindable);
  });

  it('derives the dispatch chords the input system used to hard-code', () => {
    const chords = defaultCommandChords();
    expect(chords['ord.attackMove']).toEqual({ code: 'KeyA', ctrl: false, shift: false, alt: false });
    expect(chords['ord.stop'].code).toBe('KeyS');
    expect(chords['ord.guard'].code).toBe('KeyG');
    expect(chords['ord.scatter'].code).toBe('KeyX');
    expect(chords['ord.forceAttack'].code).toBe('KeyF');
    expect(chords['ord.rally'].code).toBe('KeyY');
    expect(chords['ord.stance'].code).toBe('KeyZ');
    expect(chords['cam.home'].code).toBe('KeyH');
    // Select All Army is the row that used to be resolved AHEAD of the binding
    // table, which quietly made rebinding it a no-op.
    expect(chords['sel.allArmy']).toEqual({ code: 'KeyA', ctrl: true, shift: false, alt: false });
  });

  it('never lets Attack Move and Select All Army collide, because the chords differ', () => {
    const chords = defaultCommandChords();
    expect(chords['ord.attackMove'].code).toBe(chords['sel.allArmy'].code);
    expect(sameChord(chords['ord.attackMove'], chords['sel.allArmy'])).toBe(false);
  });

  it('derives the polled camera codes with no modifiers attached', () => {
    const codes = defaultCameraCodes();
    expect(codes).toEqual({
      'cam.panUp': 'ArrowUp',
      'cam.panDown': 'ArrowDown',
      'cam.panLeft': 'ArrowLeft',
      'cam.panRight': 'ArrowRight',
      'cam.rotateLeft': 'KeyQ',
      'cam.rotateRight': 'KeyE',
    });
  });

  it('hands out fresh objects so a caller cannot poison the catalogue', () => {
    const a = defaultCommandChords();
    (a['ord.stop'] as { code: string }).code = 'KeyP';
    expect(defaultCommandChords()['ord.stop'].code).toBe('KeyS');
  });

  it('covers every action id the input system switches on', () => {
    // The literal list is the switch in `src/input/input.system.ts#onKeyDown`.
    // If a case is added there without a catalogue row, or a row is added here
    // with no case, this fails and points at the pair.
    const handled = [
      'sel.allArmy', 'ord.attackMove', 'ord.stop', 'ord.guard', 'ord.scatter',
      'ord.deploy', 'ord.forceAttack', 'ord.rally', 'ord.stance', 'ord.ability',
      'cam.home',
    ].sort();
    expect([...COMMAND_ACTION_IDS].sort()).toEqual(handled);
  });
});

/* ==========================================================================
 * 3. AGREEMENT WITH THE SETTINGS STORE
 *
 * The failure this prevents: an action marked `rebindable` whose id the store
 * does not know. `normalizeSettings` drops unknown ids, so the rebind would
 * survive exactly until the next page load.
 * ========================================================================== */

describe('catalogue vs settings store', () => {
  it('binds every rebindable action to an id the store persists', () => {
    const stored = new Set(KEYBINDS.map((k) => k.id));
    for (const a of rebindableActions()) {
      expect(stored.has(a.id), `${a.id} is rebindable but is not in KEYBINDS`).toBe(true);
    }
  });

  it('accounts for every stored keybind, so nothing is rebindable but undocumented', () => {
    const known = new Set(ACTIONS.map((a) => a.id));
    for (const k of KEYBINDS) {
      expect(known.has(k.id), `${k.id} is in KEYBINDS but has no catalogue row`).toBe(true);
    }
  });

  it('agrees with the store on every default chord', () => {
    for (const k of KEYBINDS) {
      const a = actionById(k.id);
      expect(a, k.id).toBeDefined();
      expect(sameChord(a?.defaultChord, k.def), `${k.id} default drifted`).toBe(true);
    }
  });

  it('agrees with the store on which keyboard surface each action lives on', () => {
    for (const k of KEYBINDS) {
      const a = actionById(k.id);
      if (a === undefined || a.binding !== 'rebindable') continue;
      expect(a.surface, `${k.id} surface drifted`).toBe(k.scope);
    }
  });

  it('marks a row advisory in the store exactly when the catalogue says it is not live', () => {
    for (const k of KEYBINDS) {
      const a = actionById(k.id);
      if (a === undefined) continue;
      // `sys.perf` is the one row the two describe differently ON PURPOSE: the
      // store still normalises and persists a chord for it, and the catalogue
      // records that the debug layer ignores that chord and reads F3 directly.
      if (a.binding === 'fixed') continue;
      expect(a.live === false, `${k.id} liveness drifted`).toBe(k.advisory === true);
    }
  });

  it('ships a default scheme with no conflicts', () => {
    expect(findConflicts(defaultBindings())).toEqual([]);
  });
});

/* ==========================================================================
 * 4. THE BUILD KEYBOARD
 *
 * The seam this closes: the HUD prints a letter on a cameo and the help screen
 * promises that letter does something. They used to be two hand-written lists in
 * two files that happened to agree. Now they are one array, and these are the
 * ways that array can still be wrong.
 * ========================================================================== */

describe('the build keyboard', () => {
  it('badges exactly the codes it binds, and no more', () => {
    expect(BUILD_TAB_HOTKEY_LABELS.length).toBe(BUILD_TAB_HOTKEYS.length);
    expect(BUILD_SLOT_HOTKEY_LABELS.length).toBe(BUILD_SLOT_HOTKEYS.length);
    expect(BUILD_TAB_HOTKEY_LABELS).toEqual(BUILD_TAB_HOTKEYS.map(bareKeyLabel));
    expect(BUILD_SLOT_HOTKEY_LABELS).toEqual(BUILD_SLOT_HOTKEYS.map(bareKeyLabel));
  });

  it('has one slot per build tab, index-aligned with `BuildTab`', () => {
    // ONE SLOT PER TAB, not one KEY per tab, and the difference is v2.6.0's.
    // This read `toBe(4)` with the comment "a fifth tab with no key would ship
    // a badge-less tab and a help row that under-promises". The fifth tab
    // arrived and it does ship without a key, because there is no letter left
    // to give it — the block above this array allocates all twenty-six — and a
    // key that does nothing in every match before a Command Post is standing
    // is worse than no key by this file's own rule. What still has to hold is
    // the ALIGNMENT: the array is indexed by `BuildTab` in `Hud.onKeyDown`
    // and in the strip, so a short array would silently give the last tab the
    // wrong badge. The help row filters the empty slot; `bld.tabKeys` below.
    expect(BUILD_TAB_HOTKEYS.length).toBe(BUILD_TAB_COUNT);
    expect(BUILD_TAB_HOTKEY_LABELS.length).toBe(BUILD_TAB_COUNT);
    // An empty slot is never matched: `KeyboardEvent.code` is never ''.
    expect(BUILD_TAB_HOTKEYS.filter((c) => c === '').length).toBe(1);
  });

  it('uses each letter once across both surfaces', () => {
    const all = [...BUILD_TAB_HOTKEYS, ...BUILD_SLOT_HOTKEYS];
    expect(new Set(all).size, 'a letter is bound twice on the build keyboard').toBe(all.length);
  });

  it('names only bare letter keys, because the HUD returns early on any modifier', () => {
    for (const code of [...BUILD_TAB_HOTKEYS, ...BUILD_SLOT_HOTKEYS]) {
      // The Powers tab's empty slot is not a key and is not asserted to be
      // one; every code that IS a key still has to be a bare letter.
      if (code === '') continue;
      expect(/^Key[A-Z]$/.test(code), `${code} is not a plain letter code`).toBe(true);
    }
  });

  it('dodges every stock binding, so the shipped scheme has no collision', () => {
    // This is the assertion that used to be a comment in Sidebar.ts. With no
    // rebinds in play, every build letter must be free.
    expect(buildHotkeyConflicts(undefined)).toEqual([]);
    for (const code of [...BUILD_TAB_HOTKEYS, ...BUILD_SLOT_HOTKEYS]) {
      expect(buildHotkeyBlockedBy(code, undefined), `${code} collides out of the box`)
        .toBeUndefined();
    }
  });

  it('publishes both build rows on the help screen, as fixed key lists', () => {
    for (const id of ['bld.tabKeys', 'bld.slotKeys']) {
      const a = actionById(id);
      expect(a, id).toBeDefined();
      expect(a?.binding).toBe('fixed');
      expect(a?.surface).toBe('hud');
      // 'list', not 'plus': these are alternatives, and `B + T + I + V` would
      // claim the player has to hold all four.
      expect(a?.chipJoin).toBe('list');
      // Index-aligned, or the help screen strikes through the wrong letter.
      expect(a?.fixedCodes?.length).toBe(a?.fixedChips?.length);
    }
    // FILTERED, because a chip for a key that does not exist would be an
    // empty box on the help screen. The arrays themselves stay index-aligned
    // with `BuildTab`; the row shows the keys a player can press.
    expect(actionById('bld.tabKeys')?.fixedChips)
      .toEqual(BUILD_TAB_HOTKEY_LABELS.filter((c) => c !== ''));
    expect(actionById('bld.tabKeys')?.fixedCodes)
      .toEqual(BUILD_TAB_HOTKEYS.filter((c) => c !== ''));
    expect(actionById('bld.slotKeys')?.fixedChips).toEqual([...BUILD_SLOT_HOTKEY_LABELS]);
    expect(actionById('bld.slotKeys')?.fixedCodes).toEqual([...BUILD_SLOT_HOTKEYS]);
  });

  it('keeps the build rows off the rebindable and dispatch tables', () => {
    expect([...COMMAND_ACTION_IDS]).not.toContain('bld.tabKeys');
    expect([...CAMERA_KEY_IDS]).not.toContain('bld.slotKeys');
    expect(rebindableActions().map((a) => a.id)).not.toContain('bld.tabKeys');
  });

  it('labels the codes it actually uses, and passes anything else through', () => {
    expect(bareKeyLabel('KeyB')).toBe('B');
    expect(bareKeyLabel('Digit7')).toBe('7');
    expect(bareKeyLabel('ArrowUp')).toBe('ArrowUp');
    expect(bareKeyLabel('Escape')).toBe('Escape');
  });
});

describe('a rebind landing on a build key', () => {
  it('hands the key to the order the player chose', () => {
    // Attack Move moved onto B, the structures tab.
    const taken = buildHotkeyBlockedBy('KeyB', {
      'ord.attackMove': { code: 'KeyB', ctrl: false, shift: false, alt: false },
    });
    expect(taken?.id).toBe('ord.attackMove');
    expect(taken?.label).toBe('Attack Move');
  });

  it('reports it once, with the letter and the thief', () => {
    const clashes = buildHotkeyConflicts({
      'ord.stop': { code: 'KeyC' },
      'ord.guard': { code: 'KeyV' },
    });
    expect(clashes.map((c) => `${c.label}:${c.takenBy.id}`)).toEqual(['V:ord.guard', 'C:ord.stop']);
  });

  it('ignores a rebind that carries a modifier, because the HUD never sees one', () => {
    // Ctrl+B cannot reach the structures tab — `onKeyDown` returns on any
    // modifier — so it is not a collision and must not be reported as one.
    expect(buildHotkeyBlockedBy('KeyB', {
      'sel.allArmy': { code: 'KeyB', ctrl: true },
    })).toBeUndefined();
  });

  it('counts a modified CAMERA rebind, because camera keys are polled by code alone', () => {
    expect(buildHotkeyBlockedBy('KeyT', {
      'cam.rotateLeft': { code: 'KeyT', ctrl: true },
    })?.id).toBe('cam.rotateLeft');
  });

  it('frees the letter again when the player clears the order', () => {
    // An empty code is a real answer — deliberately unbound — and must NOT fall
    // back to the default, or clearing a key would look like it did nothing.
    expect(liveChordFor('ord.attackMove', { 'ord.attackMove': { code: '' } })).toBeNull();
    expect(buildHotkeyBlockedBy('KeyA', { 'ord.attackMove': { code: '' } })).toBeUndefined();
    // A MISSING row is the untouched default, which is still on KeyA.
    expect(liveChordFor('ord.attackMove', {})?.code).toBe('KeyA');
  });

  it('leaves every other build letter alone', () => {
    const bindings = { 'ord.stop': { code: 'KeyC' } };
    expect(buildHotkeyConflicts(bindings).length).toBe(1);
    expect(buildHotkeyBlockedBy('KeyR', bindings)).toBeUndefined();
    expect(buildHotkeyBlockedBy('KeyB', bindings)).toBeUndefined();
  });
});

/* ==========================================================================
 * 5. PRESENTATION
 * ========================================================================== */

describe('key presentation', () => {
  it('names modifiers for the platform', () => {
    expect(modifierLabel('Ctrl', false)).toBe('CTRL');
    expect(modifierLabel('Alt', false)).toBe('ALT');
    expect(modifierLabel('Ctrl', true)).toBe('⌃');
    expect(modifierLabel('Alt', true)).toBe('⌥');
    expect(modifierLabel('Shift', true)).toBe('⇧');
    expect(modifierLabel('Meta', true)).toBe('⌘');
  });

  it('emits modifier chips in a fixed order', () => {
    const c = { code: 'KeyA', ctrl: true, shift: true, alt: true };
    expect(modifierChips(c, false)).toEqual(['CTRL', 'SHIFT', 'ALT']);
    expect(modifierChips(c, true)).toEqual(['⌃', '⇧', '⌥']);
    expect(modifierChips({ code: 'KeyA', ctrl: false, shift: false, alt: false }, true)).toEqual([]);
  });

  it('recognises the modifier tokens usable inside fixedChips', () => {
    expect(isModifierName('Ctrl')).toBe(true);
    expect(isModifierName('Shift')).toBe(true);
    expect(isModifierName('0 – 9')).toBe(false);
    for (const a of ACTIONS) {
      for (const chip of a.fixedChips ?? []) {
        // A chip that only LOOKS like a modifier would print verbatim and read
        // as a bug on a Mac.
        expect(/^(ctrl|shift|alt|meta|cmd|command|option)$/i.test(chip) && !isModifierName(chip))
          .toBe(false);
      }
    }
  });

  it('detects Apple platforms from an injected navigator', () => {
    expect(isApplePlatform({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' })).toBe(true);
    expect(isApplePlatform({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)' })).toBe(true);
    expect(isApplePlatform({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })).toBe(false);
    expect(isApplePlatform({ platform: 'MacIntel' })).toBe(true);
    expect(isApplePlatform({})).toBe(false);
  });

  it('renders every default chord to something printable', () => {
    for (const a of ACTIONS) {
      if (a.defaultChord === null) continue;
      const label = chordLabel(a.defaultChord);
      expect(label, a.id).not.toBe('UNBOUND');
      expect(label.length, a.id).toBeGreaterThan(0);
    }
  });

  it('compares chords by every field', () => {
    const base = { code: 'KeyA', ctrl: false, shift: false, alt: false };
    expect(sameChord(base, { ...base })).toBe(true);
    expect(sameChord(base, { ...base, ctrl: true })).toBe(false);
    expect(sameChord(base, { ...base, code: 'KeyB' })).toBe(false);
    expect(sameChord(base, undefined)).toBe(false);
    expect(sameChord(null, null)).toBe(false);
  });
});
