/**
 * ============================================================================
 * tests/loading-tips.spec.ts — THE LOADING SCREEN MAY NOT LIE ABOUT A KEY
 * ============================================================================
 *
 * `Shell.TIPS` is the oldest player-facing copy in the product and, until this
 * file existed, the least defended: `grep -rln TIPS tests/` returned nothing.
 * It is `docs/SPEC_DRIFT_AUDIT.md` #27 — three of the ten strings hard-coded a
 * REBINDABLE key, so a player who moved Rotate Left or Attack Move was told the
 * wrong key by their own loading screen, before every single match.
 *
 * TWO RULES, BOTH MECHANICAL.
 *
 *   1. NO TIP NAMES A KEY. Keys arrive only through `{action.id}` placeholders
 *      that `resolveTip` resolves against the LIVE bindings. §1 and §2.
 *   2. NO TIP CONTAINS A DIGIT. `tests/build-descriptions.spec.ts` §4's rule,
 *      same class of copy, same argument. §4.
 *
 * WHY THE LINT IS WRITTEN HERE AND NOT IMPORTED FROM `tests/tutorial.spec.ts`
 * --------------------------------------------------------------------------
 * That file already lints prose for key names, with `IMPERATIVE_THEN_KEY` and
 * `NAMED_KEY_NOUN`. Porting them verbatim was the obvious move and it would
 * have shipped a GREEN test over the exact defect it was cited to close: both
 * regexes are tuned for the tutorial's IMPERATIVE voice — "press A", "hold
 * Shift", "the D key" — and every one of these tips is DECLARATIVE — "Q and E
 * rotate the camera", "Attack-move (A) makes a column engage". There is no
 * imperative for `IMPERATIVE_THEN_KEY` to anchor on and no "key" noun for
 * `NAMED_KEY_NOUN` to find. §3 runs both against all three offenders and pins
 * that they pass, so nobody deletes the lint below as a duplicate.
 *
 * THE FALSIFIER IS THE POINT. §2 runs the lint against `PRE_FIX`, the ten
 * strings exactly as they shipped, and requires it to name the four key
 * mentions and nothing else. A lint nobody has seen fail is a lint nobody knows
 * works, and this one had to be written against a corpus that defeats the
 * existing one.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';

import { TIPS, resolveTip, tipActionIds } from '../src/shell/Shell';
import { actionById } from '../src/input/ActionCatalogue';
import { codeLabel, defaultBindings, type Chord } from '../src/shell/settings-store';

/* ==========================================================================
 * 1. THE LINT
 *
 * Three rules over AUTHORED tip prose. Each is global so a string that names
 * two keys reports two offences — "Q and E" is one string and two lies.
 *
 * The rules deliberately do NOT look for an imperative, because tips have
 * none. They look for the shapes a key takes when it is written down.
 * ========================================================================== */

/**
 * A letter standing on its own is a key name. `a` and `i` are the only
 * one-letter words in English and are the only exemption — which is why
 * "**A** war factory with two refineries…" survives while "**Q** and **E**
 * rotate the camera" does not.
 *
 * The exemption is exactly two characters wide on purpose. It is also why §1's
 * second rule exists: "(A)" is the article's spelling too, and only the
 * brackets tell you it is a key.
 */
const LONE_LETTER = /(?<![\p{L}\p{N}'’])[B-HJ-Zb-hj-z](?![\p{L}\p{N}'’])/gu;

/**
 * A token joined by `+`, or a token alone inside brackets or quotes. This is
 * the form the exemption above cannot reach: `Ctrl+number` and `(A)`.
 */
const JOINED_KEY =
  /[\p{L}\p{N}]\s*\+\s*[\p{L}\p{N}]|[([{"'“‘]\s*[\p{L}\p{N}]\s*[)\]}"'”’]/gu;

/**
 * Keyboard nouns. Only tokens that are a key name and nothing else in this
 * product's register — `escort` and `alternative` do not trip `esc` or `alt`
 * because of the trailing word boundary, and both are checked in §2.
 *
 * `shift` and `escape` are here despite being ordinary English verbs. That is
 * a deliberate false-positive risk with a cheap cost: an author who genuinely
 * means the verb rephrases, while an author who means the key gets pointed at
 * the catalogue. The reverse trade ships a lie.
 */
const KEY_NOUN =
  /\b(?:ctrl|control key|alt|shift|esc|escape|spacebar|space bar|backspace|caps ?lock|numpad|f(?:[1-9]|1[0-2])|arrow keys?|hotkeys?|[\p{L}\p{N}] ?[-–—] ?key|key [\p{L}\p{N}](?![\p{L}\p{N}]))\b/giu;

const RULES: readonly (readonly [string, RegExp])[] = [
  ['lone letter', LONE_LETTER],
  ['key noun', KEY_NOUN],
  ['joined key', JOINED_KEY],
];

/** Every key name a string spells out. Empty is the only passing answer. */
function keyOffences(text: string): string[] {
  const out: string[] = [];
  for (const [, re] of RULES) {
    for (const m of text.matchAll(re)) out.push(m[0]);
  }
  return out;
}

/* ==========================================================================
 * 2. THE FALSIFIER — THE LINT IS RED ON THE STRINGS THAT SHIPPED
 *
 * `PRE_FIX` is `Shell.TIPS` verbatim as of `ae8b4ac`, before this commit. It
 * is a FROZEN COPY and must never be updated to match the live table: its only
 * job is to be the corpus the lint was written against.
 * ========================================================================== */

const PRE_FIX: readonly string[] = [
  'Harvesters are your entire economy. Escort them, and rebuild them first.',
  'A war factory with two refineries out-produces two war factories with one.',
  'Right-click cancels a build placement without losing the structure.',
  'Ctrl+number stores a control group. Double-tap the number to jump the camera to it.',
  'Tesla and prism defences go dark in a brownout. Build the power plant first.',
  'Q and E rotate the camera. The silhouette of a base reads differently from every angle.',
  'Engineers capture. One engineer into an enemy war factory is worth a tank column.',
  'Attack-move (A) makes a column engage on the way instead of driving past the fight.',
  'Sell a damaged structure before it dies — you keep half the cost.',
  'Heavy armour shrugs off small arms. Bring cannons to a tank fight.',
];

describe('the key lint fires on the tips that actually shipped', () => {
  it('names every key the pre-fix table spelled out', () => {
    const found = PRE_FIX.flatMap((t, i) => keyOffences(t).map((o) => `${i}: ${o}`));
    // Four key mentions across three strings, grouped by string and then by
    // rule. `l+n` is the `+` in "Ctrl+number" — that rule catches the JOIN,
    // which is what makes it independent of how the modifier was spelled.
    expect(found).toEqual([
      '3: Ctrl',
      '3: l+n',
      '5: Q',
      '5: E',
      '7: (A)',
    ]);
  });

  it('leaves the seven honest strings alone', () => {
    const clean = PRE_FIX.filter((_, i) => i !== 3 && i !== 5 && i !== 7);
    expect(clean).toHaveLength(7);
    for (const t of clean) expect(keyOffences(t), t).toEqual([]);
  });

  /**
   * The two near misses in that corpus, called out because they are what a
   * blunter rule would have destroyed:
   *
   *   - "**A** war factory with two refineries" — the article, one character
   *     from `ord.attackMove`'s default chord.
   *   - "**Esc**ort them" and "**alt**ernative" — substrings of two key nouns.
   */
  it('does not fire on the article, on Escort, or on alternative', () => {
    expect(keyOffences('A war factory with two refineries out-produces two war factories.'))
      .toEqual([]);
    expect(keyOffences('Escort them, and rebuild them first.')).toEqual([]);
    expect(keyOffences('An alternative route is worth the detour.')).toEqual([]);
    expect(keyOffences('I would rebuild the refinery first.')).toEqual([]);
  });

  /** …and it does catch the shapes a future author would reach for. */
  it('catches the ways a key gets written down', () => {
    expect(keyOffences('Q and E rotate the camera.')).toEqual(['Q', 'E']);
    expect(keyOffences('Hold Shift to queue an order.')).toEqual(['Shift']);
    expect(keyOffences('Ctrl + A selects your army.')).not.toEqual([]);
    expect(keyOffences('The F3 overlay shows the frame cost.')).not.toEqual([]);
    expect(keyOffences('Use the D key to deploy.')).not.toEqual([]);
    expect(keyOffences('Escape opens the pause menu.')).toEqual(['Escape']);
  });
});

/* ==========================================================================
 * 3. WHY THE TUTORIAL'S REGEXES WERE NOT PORTED
 *
 * Verbatim from `tests/tutorial.spec.ts` §3. Kept here as a PIN, not as a
 * gate: if a later edit to the tutorial makes these catch declarative prose,
 * this test fails and somebody gets to decide whether §1 is now redundant.
 * ========================================================================== */

const IMPERATIVE_THEN_KEY =
  /\b(?:press|hit|tap|hold|push|strike|type)\s+(?:and\s+hold\s+)?(?:the\s+)?(?:[A-Za-z0-9]\b|ctrl|control|shift|alt|option|cmd|command|space|spacebar|enter|return|escape|esc|tab|arrow|arrows|f\d)\b/i;

const NAMED_KEY_NOUN = /\b(?:[A-Za-z0-9]\s*[-–]\s*key|key\s+[A-Za-z0-9]\b|\b[A-Za-z0-9]\s+key\b)/i;

describe('the tutorial lint would have passed every offender', () => {
  it('is green on all three, which is why it is not the gate here', () => {
    for (const i of [3, 5, 7]) {
      const text = PRE_FIX[i];
      expect(IMPERATIVE_THEN_KEY.test(text), text).toBe(false);
      expect(NAMED_KEY_NOUN.test(text), text).toBe(false);
    }
  });

  /** It is not broken — it is aimed elsewhere. Its own falsifiers still pass. */
  it('still catches the imperative voice it was written for', () => {
    expect(IMPERATIVE_THEN_KEY.test('Press W to pan the camera.')).toBe(true);
    expect(NAMED_KEY_NOUN.test('Use the D key to deploy.')).toBe(true);
  });
});

/* ==========================================================================
 * 4. THE SHIPPED TABLE
 * ========================================================================== */

describe('Shell.TIPS', () => {
  it('names no key', () => {
    const offenders = TIPS.flatMap((t) => keyOffences(t).map((o) => `${o} — in: ${t}`));
    expect(offenders, 'a rebind makes every one of these a lie').toEqual([]);
  });

  /**
   * Same rule and same argument as `tests/build-descriptions.spec.ts` §4: *"a
   * figure retyped here is a second copy nothing compares"*. It binds the
   * AUTHORED text only — `sel.groupSet` resolves to `CTRL + 0 – 9` and those
   * digits are fine, because they come out of `ActionCatalogue` rather than
   * out of somebody's memory of it.
   */
  it('contains no digits at all', () => {
    const offenders = TIPS
      .filter((t) => /\d/.test(t))
      .map((t) => `${t.match(/\S*\d\S*/g)?.join(' ') ?? ''} — in: ${t}`);
    expect(offenders, 'numbers retyped out of a table nothing compares them to').toEqual([]);
  });

  /**
   * No shipped tip has ever carried a digit, so that gate goes in green and
   * has never been seen fail. This is its falsifier. It is worth having:
   * `TIPS_BUILD_SPEC.md` §2.3 spot-checked six candidate tips and three were
   * wrong about their own numbers, which is the class of error the ban
   * deletes by construction rather than by proofreading.
   */
  it('the digit ban would catch a retyped figure', () => {
    expect(/\d/.test('A Command Post and all five powers costs 9500 credits.')).toBe(true);
    expect(/\d/.test('Sell a damaged structure before it dies — you keep half the cost.'))
      .toBe(false);
  });

  it('every placeholder names an action the catalogue knows', () => {
    const unknown: string[] = [];
    for (const t of TIPS) {
      for (const id of tipActionIds(t)) {
        if (actionById(id) === undefined) unknown.push(`${id} — in: ${t}`);
      }
    }
    expect(unknown, 'these would render as an em dash on the loading screen').toEqual([]);
  });

  /**
   * The three rebindable ids are named explicitly because they are the whole
   * finding. If a later edit drops one back into prose, §4's first test fails;
   * if it drops one silently (the tip is deleted, say) this one does.
   */
  it('still defers the three rebindable keys audit #27 named', () => {
    const ids = new Set(TIPS.flatMap(tipActionIds));
    for (const id of ['cam.rotateLeft', 'cam.rotateRight', 'ord.attackMove']) {
      expect(ids.has(id), id).toBe(true);
      expect(actionById(id)?.binding, id).toBe('rebindable');
    }
  });

  it('leaves no unresolved placeholder in the drawn string', () => {
    const bindings = defaultBindings();
    for (const t of TIPS) {
      const out = resolveTip(t, bindings, false, codeLabel);
      expect(out, t).not.toMatch(/[{}]/);
      expect(out.length, t).toBeGreaterThan(0);
    }
  });
});

/* ==========================================================================
 * 5. RESOLUTION — THE ONE BEHAVIOUR THE WHOLE COMMIT IS FOR
 * ========================================================================== */

describe('resolveTip', () => {
  const ROTATE = TIPS.find((t) => t.includes('{cam.rotateLeft}')) ?? '';
  const ATTACK = TIPS.find((t) => t.includes('{ord.attackMove}')) ?? '';

  it('draws the default chords when nothing is rebound', () => {
    const out = resolveTip(ROTATE, defaultBindings(), false, codeLabel);
    expect(out.startsWith('Q and E rotate the camera.')).toBe(true);
  });

  /** THE DEFECT, DIRECTLY. Move the keys; the loading screen moves with them. */
  it('follows a rebind', () => {
    const bindings: Record<string, Chord> = {
      ...defaultBindings(),
      'cam.rotateLeft': { code: 'KeyZ', ctrl: false, shift: false, alt: false },
      'cam.rotateRight': { code: 'KeyX', ctrl: false, shift: false, alt: false },
      'ord.attackMove': { code: 'KeyG', ctrl: true, shift: false, alt: false },
    };
    expect(resolveTip(ROTATE, bindings, false, codeLabel).startsWith('Z and X rotate the camera.'))
      .toBe(true);
    expect(resolveTip(ATTACK, bindings, false, codeLabel))
      .toContain('Attack-move (CTRL + G)');
  });

  /**
   * A cleared row is a real answer, not a missing one — the rule
   * `liveChordFor` states and `actionKeyRow` implements. The tip says so
   * rather than quietly printing the default the player deliberately removed.
   */
  it('says Unbound when the player cleared the row', () => {
    const bindings: Record<string, Chord> = {
      ...defaultBindings(),
      'ord.attackMove': { code: '', ctrl: false, shift: false, alt: false },
    };
    expect(resolveTip(ATTACK, bindings, false, codeLabel)).toContain('Attack-move (Unbound)');
  });

  it('uses the platform glyph for a modifier', () => {
    const bindings: Record<string, Chord> = {
      ...defaultBindings(),
      'ord.attackMove': { code: 'KeyG', ctrl: true, shift: false, alt: false },
    };
    expect(resolveTip(ATTACK, bindings, true, codeLabel)).toContain('Attack-move (⌃ + G)');
  });

  /**
   * A fixed row resolves through the same helper. `sel.groupSet` is
   * `fixedChips: ['Ctrl', '0 – 9']`, so the tip prints the digits the
   * catalogue owns without ever having typed them.
   */
  it('resolves a fixed row from its chips', () => {
    const tip = TIPS.find((t) => t.includes('{sel.groupSet}')) ?? '';
    const out = resolveTip(tip, defaultBindings(), false, codeLabel);
    expect(out.startsWith('CTRL + 0 – 9 stores a control group.')).toBe(true);
    expect(out).toContain('Double-tap 0 – 9');
  });

  it('renders an unknown id as an em dash rather than throwing', () => {
    expect(resolveTip('Try {ord.doesNotExist} for that.', defaultBindings(), false, codeLabel))
      .toBe('Try — for that.');
  });

  it('leaves a string with no placeholder untouched', () => {
    const plain = 'Heavy armour shrugs off small arms. Bring cannons to a tank fight.';
    expect(resolveTip(plain, defaultBindings(), false, codeLabel)).toBe(plain);
  });
});

/* ==========================================================================
 * 6. tipActionIds
 * ========================================================================== */

describe('tipActionIds', () => {
  it('reads the ids in the order the prose names them', () => {
    expect(tipActionIds('{cam.rotateLeft} and {cam.rotateRight} rotate the camera.'))
      .toEqual(['cam.rotateLeft', 'cam.rotateRight']);
  });

  it('answers empty for prose with no placeholder', () => {
    expect(tipActionIds('Harvesters are your entire economy.')).toEqual([]);
  });

  /** The regex is module-level and global; two reads must agree. */
  it('is not stateful across calls', () => {
    const t = '{cam.rotateLeft} and {cam.rotateRight} rotate the camera.';
    expect(tipActionIds(t)).toEqual(tipActionIds(t));
    expect(resolveTip(t, defaultBindings(), false, codeLabel))
      .toBe(resolveTip(t, defaultBindings(), false, codeLabel));
  });
});
