/**
 * ============================================================================
 * src/shell/Help.ts — every command in the game, with the keys you actually have
 * ============================================================================
 * WHAT MAKES THIS DIFFERENT FROM A CONTROLS SCREENSHOT
 * ---------------------------------------------------
 * Nothing on this screen is typed out. Every row comes from
 * `src/input/ActionCatalogue.ts`, and every rebindable row resolves its chord
 * against the LIVE settings store — the same store `input.system.ts` reads on
 * each keystroke. Move Attack Move onto `V` and this screen says `V` before you
 * have left the options screen, because it subscribes to the store and
 * re-renders on a `controls.*` change.
 *
 * A row that has drifted from the stock scheme is marked REBOUND, and a row the
 * player has cleared is marked UNBOUND rather than silently showing the
 * default. That is the whole point: a help screen that lies costs a match.
 *
 * FIXED IS NOT THE SAME AS BOUND
 * ------------------------------
 * Three kinds of row, and the screen never blurs them:
 *
 *   rebindable  resolved from the store, changeable in Options
 *   fixed       hard-coded in the engine — the control-group digits, F3,
 *               F5-F8 camera bookmarks, and the Shift / Ctrl / Alt order
 *               modifiers. Marked FIXED.
 *   gesture     mouse or trackpad. Written as plain words, because a drawing of
 *               a two-finger swipe is worse than the sentence "two-finger
 *               swipe".
 *
 * WHERE IT LIVES
 * --------------
 * `HelpPanel` is a plain DOM component, not a `Screen`, so it can be hosted
 * inside whatever is already open:
 *
 *   PauseMenu.ts  hides its own panel and mounts this over the same frozen
 *                 frame, so Help is one keystroke from the match and Escape
 *                 comes straight back.
 *   Settings.ts   the Controls tab opens the same component, which is how the
 *                 screen is reachable from the TITLE menu without the shell
 *                 growing another state.
 *
 * STYLING
 * -------
 * The stylesheet is injected from here rather than added to `shell.css`,
 * because this module owns the markup and nothing else in the product uses
 * these classes. It is scoped to `.vm-help`, reads the `--vm-*` tokens, and
 * declares NO `backdrop-filter` of its own: the glass and its macOS gate belong
 * to `.vm-panel`, and a second, ungated blur over the WebGL canvas is exactly
 * the bug that gate exists to prevent.
 * ============================================================================
 */

import {
  ACTIONS,
  ACTION_CATEGORIES,
  buildHotkeyBlockedBy,
  buildHotkeyConflicts,
  isApplePlatform,
  isModifierName,
  modifierChips,
  modifierLabel,
  sameChord,
  type ActionCategoryDef,
  type ActionDef,
  type StoredBindings,
} from '../input/ActionCatalogue';

import { codeLabel, type Chord, type SettingsStore } from './settings-store';
import { button, el, focusable, icon, pageFrame } from './Shell';

/* ==========================================================================
 * 1. STYLE
 * ========================================================================== */

const STYLE_ID = 'vm-help-style';

const HELP_CSS = `
.vm-help {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: clamp(16px, 3vh, 40px) clamp(16px, 4vw, 56px);
}

.vm-help .vm-help-panel {
  width: min(1180px, 96vw);
  max-height: 94vh;
}

/* The head carries one extra element: a live count of what has been changed. */
.vm-help-scheme {
  font-size: calc(11px * var(--vm-text-scale, 1));
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--vm-text-faint);
  white-space: nowrap;
}

.vm-help-scheme.is-changed { color: var(--vm-accent); }

/* -- the category rail ---------------------------------------------------- */

.vm-help-rail {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 12px 18px;
  border-bottom: 1px solid var(--vm-line);
}

.vm-help-jump {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 5px 12px;
  border: 1px solid var(--vm-line);
  background: rgba(255, 255, 255, 0.03);
  color: var(--vm-text-dim);
  font: inherit;
  font-size: calc(11px * var(--vm-text-scale, 1));
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  cursor: pointer;
  clip-path: polygon(5px 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%, 0 5px);
  transition: border-color 140ms linear, color 140ms linear;
}

.vm-help-jump:hover,
.vm-help-jump.is-focus {
  border-color: var(--vm-accent-dim);
  color: var(--vm-text);
}

.vm-help-jump .vm-icon { flex: 0 0 auto; }

/* -- sections ------------------------------------------------------------- */

.vm-help-body { scroll-behavior: smooth; }

.vm-help-section { padding: 18px 0 4px; }

.vm-help-section > .vm-h3 { padding: 0 18px 4px; }

.vm-help-blurb { padding: 0 18px 10px; }

/* -- one action ----------------------------------------------------------- */

.vm-help-row {
  display: grid;
  grid-template-columns: minmax(200px, 260px) 1fr auto;
  align-items: baseline;
  gap: 16px;
  padding: 8px 18px;
  border-bottom: 1px solid var(--vm-line-soft);
}

.vm-help-row:last-child { border-bottom: 0; }

.vm-help-keys {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px;
}

/* A key cap. Hairline, notched, tabular — never a bevel and never a gradient. */
.vm-key {
  display: inline-block;
  min-width: 26px;
  padding: 3px 8px;
  border: 1px solid var(--vm-line);
  background: rgba(255, 255, 255, 0.05);
  color: var(--vm-text);
  font-size: calc(12px * var(--vm-text-scale, 1));
  font-weight: 700;
  letter-spacing: 0.1em;
  font-variant-numeric: tabular-nums;
  text-align: center;
  text-transform: uppercase;
  clip-path: polygon(4px 0, 100% 0, 100% calc(100% - 4px), calc(100% - 4px) 100%, 0 100%, 0 4px);
}

.vm-key.is-plus {
  min-width: 0;
  padding: 0 1px;
  border: 0;
  background: none;
  color: var(--vm-text-faint);
  clip-path: none;
}

.vm-key.is-unbound {
  border-color: rgba(240, 85, 58, 0.5);
  color: var(--vm-danger);
  background: none;
}

/* A fixed key a rebind has taken. Struck through, not hidden — the player needs
   to see that the letter exists AND that it no longer reaches the sidebar. */
.vm-key.is-taken {
  border-color: rgba(240, 85, 58, 0.45);
  color: var(--vm-danger);
  background: none;
  text-decoration: line-through;
  text-decoration-thickness: 1px;
}

/* A set of alternatives, not a chord: no `+`, so tighten the gap to keep the
   run reading as one group. */
.vm-help-keys.is-list { gap: 4px; }

/* -- the build-key clash banner ------------------------------------------- */

.vm-help-clash {
  margin: 0;
  padding: 9px 18px;
  border-bottom: 1px solid var(--vm-line);
  border-left: 2px solid var(--vm-danger);
  font-size: calc(12px * var(--vm-text-scale, 1));
  line-height: 1.5;
  letter-spacing: 0.03em;
  color: var(--vm-text-dim);
}

.vm-help-clash strong {
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--vm-danger);
}

.vm-help-gesture {
  font-size: calc(12px * var(--vm-text-scale, 1));
  letter-spacing: 0.06em;
  color: var(--vm-accent);
}

.vm-help-text { min-width: 0; }

.vm-help-name {
  display: block;
  font-size: calc(13px * var(--vm-text-scale, 1));
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--vm-text);
}

.vm-help-desc {
  display: block;
  margin-top: 2px;
  font-size: calc(12px * var(--vm-text-scale, 1));
  line-height: 1.45;
  letter-spacing: 0.02em;
  color: var(--vm-text-dim);
}

/* -- the honesty tags ----------------------------------------------------- */

.vm-help-tag {
  align-self: center;
  padding: 2px 7px;
  border: 1px solid var(--vm-line);
  font-size: calc(10px * var(--vm-text-scale, 1));
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--vm-text-faint);
  white-space: nowrap;
}

.vm-help-tag.is-rebound {
  border-color: var(--vm-accent-dim);
  color: var(--vm-accent);
}

.vm-help-tag.is-unbound {
  border-color: rgba(240, 85, 58, 0.5);
  color: var(--vm-danger);
}

/* -- foot ----------------------------------------------------------------- */

.vm-help-foot-note {
  flex: 1 1 auto;
  min-width: 0;
  font-size: calc(11px * var(--vm-text-scale, 1));
  line-height: 1.5;
  letter-spacing: 0.04em;
  color: var(--vm-text-faint);
}

@media (max-width: 860px) {
  .vm-help-row {
    grid-template-columns: 1fr auto;
  }
  .vm-help-keys {
    grid-column: 1 / -1;
  }
}
`;

/** Inject the stylesheet once per document. */
function ensureStyle(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID) !== null) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = HELP_CSS;
  document.head.appendChild(style);
}

/* ==========================================================================
 * 2. KEY RENDERING
 * ========================================================================== */

function keyCap(text: string, modifier = false): HTMLElement {
  const node = el('span', 'vm-key', text);
  if (modifier) node.classList.add('is-mod');
  return node;
}

function plus(): HTMLElement {
  return el('span', 'vm-key is-plus', '+');
}

/** Push `chips` into `host` with `+` separators. */
function fillCaps(host: HTMLElement, chips: readonly string[]): void {
  for (let i = 0; i < chips.length; i++) {
    if (i > 0) host.appendChild(plus());
    host.appendChild(keyCap(chips[i]));
  }
}

/**
 * Push `chips` into `host` as a SET of alternatives — no `+`, because these are
 * four keys you may press, not four keys you hold.
 *
 * `codes` is index-aligned when the caller has them, and a chip whose code a
 * rebind has taken is struck through and titled with the order that took it.
 * The alternative is printing a letter that does nothing, which is the exact
 * failure this whole catalogue exists to prevent.
 */
function fillCapList(
  host: HTMLElement,
  chips: readonly string[],
  codes: readonly string[] | undefined,
  bindings: StoredBindings,
): void {
  for (let i = 0; i < chips.length; i++) {
    const cap = keyCap(chips[i]);
    const code = codes?.[i];
    const takenBy = code === undefined ? undefined : buildHotkeyBlockedBy(code, bindings);
    if (takenBy !== undefined) {
      cap.classList.add('is-taken');
      cap.title = `Taken by ${takenBy.label}`;
    }
    host.appendChild(cap);
  }
}

/**
 * The key column for one action.
 *
 * `current` is the chord the store holds for a rebindable action — undefined
 * for everything else. An empty `code` is a real answer ("the player cleared
 * this"), not a missing one, and is rendered as such.
 */
function renderKeys(
  def: ActionDef,
  current: Chord | undefined,
  mac: boolean,
  bindings: StoredBindings,
): HTMLElement {
  const keys = el('div', 'vm-help-keys');

  if (def.binding === 'rebindable') {
    if (current === undefined || current.code === '') {
      const cap = keyCap('Unbound');
      cap.classList.add('is-unbound');
      keys.appendChild(cap);
      return keys;
    }
    fillCaps(keys, [...modifierChips(current, mac), codeLabel(current.code)]);
    return keys;
  }

  if (def.fixedChips !== undefined) {
    const chips = def.fixedChips.map((c) => (isModifierName(c) ? modifierLabel(c, mac) : c));
    if (def.chipJoin === 'list') {
      keys.classList.add('is-list');
      fillCapList(keys, chips, def.fixedCodes, bindings);
    } else {
      fillCaps(keys, chips);
    }
    return keys;
  }

  if (def.defaultChord !== null) {
    fillCaps(keys, [...modifierChips(def.defaultChord, mac), codeLabel(def.defaultChord.code)]);
    return keys;
  }

  keys.appendChild(el('span', 'vm-help-gesture', def.gesture ?? '—'));
  return keys;
}

/** The honesty tag, or null when the row needs none. */
function renderTag(def: ActionDef, current: Chord | undefined): HTMLElement | null {
  if (def.live === false) return el('span', 'vm-help-tag', 'Reserved');

  if (def.binding === 'rebindable') {
    if (current === undefined || current.code === '') {
      const t = el('span', 'vm-help-tag', 'Unbound');
      t.classList.add('is-unbound');
      return t;
    }
    if (!sameChord(def.defaultChord, current)) {
      const t = el('span', 'vm-help-tag', 'Rebound');
      t.classList.add('is-rebound');
      return t;
    }
    return null;
  }

  if (def.binding === 'fixed') return el('span', 'vm-help-tag', 'Fixed');
  return null;
}

/* ==========================================================================
 * 3. THE PANEL
 * ========================================================================== */

export interface HelpPanelOptions {
  /** Live bindings. The panel re-renders whenever a `controls.*` value moves. */
  settings: SettingsStore;
  /** Back / Escape. */
  onClose: () => void;
  /** Offered as a footer button when the host can reach the options screen. */
  onRebind?: () => void;
}

/**
 * The help component. Owns its DOM and its subscription; the host owns where it
 * is mounted and when it goes away.
 */
export class HelpPanel {
  readonly root: HTMLElement;

  private readonly body: HTMLElement;
  private readonly scheme: HTMLElement;
  private readonly clash: HTMLElement;
  private readonly mac = isApplePlatform();
  private readonly sections = new Map<string, HTMLElement>();
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly options: HelpPanelOptions) {
    ensureStyle();

    this.root = el('div', 'vm-help');
    const frame = pageFrame('Commands & Controls', options.onClose);
    frame.root.classList.add('vm-help-panel');

    this.scheme = el('span', 'vm-help-scheme', '');
    frame.head.appendChild(this.scheme);

    /* -- jump rail ------------------------------------------------------ */
    const rail = el('nav', 'vm-help-rail');
    rail.setAttribute('aria-label', 'Jump to a section');
    for (const cat of ACTION_CATEGORIES) {
      rail.appendChild(this.railButton(cat));
    }
    frame.root.insertBefore(rail, frame.body);

    this.body = frame.body;
    this.body.classList.add('vm-help-body');

    /* -- the clash banner, above the rows so it cannot be scrolled past -- */
    this.clash = el('p', 'vm-help-clash');
    this.clash.hidden = true;
    frame.root.insertBefore(this.clash, frame.body);

    /* -- foot ----------------------------------------------------------- */
    const note = el('p', 'vm-help-foot-note');
    note.textContent = this.footNote();
    frame.foot.appendChild(note);
    if (options.onRebind !== undefined) {
      frame.foot.appendChild(button('Rebind Keys', {
        iconName: 'keyboard',
        onClick: options.onRebind,
      }));
    }
    frame.foot.appendChild(button('Close', { variant: 'primary', onClick: options.onClose }));

    this.root.appendChild(frame.root);

    this.render();
    this.unsubscribe = options.settings.subscribe((_s, changed) => {
      for (const path of changed) {
        if (path.startsWith('controls.')) { this.render(); return; }
      }
    });
  }

  /** Drop the store subscription. The host removes the DOM. */
  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  /**
   * Keys the panel wants for itself. Up/Down and Enter belong to the shell's
   * focus ring; this only claims the page-scroll keys, because the rows are not
   * focusable and a 60-row document needs a way down that is not forty presses.
   *
   * @returns true when the key was consumed.
   */
  onKeyDown(e: KeyboardEvent): boolean {
    const page = Math.max(120, this.body.clientHeight - 60);
    switch (e.code) {
      case 'PageDown': this.body.scrollTop += page; return true;
      case 'PageUp': this.body.scrollTop -= page; return true;
      case 'Home': this.body.scrollTop = 0; return true;
      case 'End': this.body.scrollTop = this.body.scrollHeight; return true;
      default: return false;
    }
  }

  /* -------------------------------------------------------------------- */

  private railButton(cat: ActionCategoryDef): HTMLElement {
    const b = el('button', 'vm-help-jump');
    b.type = 'button';
    b.appendChild(icon(cat.icon, 14));
    b.appendChild(el('span', undefined, cat.label));
    focusable(b);
    b.addEventListener('click', () => {
      const section = this.sections.get(cat.id);
      if (section === undefined) return;
      // Offset arithmetic rather than `scrollIntoView`, which would also scroll
      // the shell layer behind us on browsers that treat it as the scroll root.
      this.body.scrollTop = section.offsetTop - this.body.offsetTop;
    });
    return b;
  }

  /** Rebuild every row from the catalogue and the live bindings. */
  private render(): void {
    const bindings = this.options.settings.get().controls.bindings;
    this.body.replaceChildren();
    this.sections.clear();

    let changed = 0;

    for (const cat of ACTION_CATEGORIES) {
      const section = el('section', 'vm-help-section');
      section.appendChild(el('h3', 'vm-h3', cat.label));
      section.appendChild(el('p', 'vm-body vm-help-blurb', cat.blurb));

      for (const def of ACTIONS) {
        if (def.category !== cat.id) continue;
        const current = def.binding === 'rebindable' ? bindings[def.id] : undefined;
        if (def.binding === 'rebindable' && def.live !== false) {
          if (current === undefined || current.code === '' || !sameChord(def.defaultChord, current)) {
            changed++;
          }
        }
        section.appendChild(this.renderRow(def, current, bindings));
      }

      this.sections.set(cat.id, section);
      this.body.appendChild(section);
    }

    this.scheme.textContent = changed === 0
      ? 'Stock scheme'
      : `${changed} custom binding${changed === 1 ? '' : 's'}`;
    this.scheme.classList.toggle('is-changed', changed > 0);

    this.renderClash(bindings);
  }

  /**
   * The one thing a rebind can break that Options cannot warn about.
   *
   * `findConflicts` in the settings store compares rebindable rows against each
   * other; it has never known about the build keyboard, because the build
   * keyboard is fixed. So the collision only becomes visible here, and it is
   * stated as a fact with the cost attached rather than left for the player to
   * discover mid-match.
   */
  private renderClash(bindings: StoredBindings): void {
    const clashes = buildHotkeyConflicts(bindings);
    this.clash.replaceChildren();
    this.clash.hidden = clashes.length === 0;
    if (clashes.length === 0) return;

    this.clash.appendChild(el('strong', undefined, 'Build keys taken:'));
    const list = clashes
      .map((c) => `${c.label} → ${c.takenBy.label}`)
      .join(' · ');
    this.clash.appendChild(el('span', undefined, ` ${list}. `));
    this.clash.appendChild(el(
      'span',
      undefined,
      clashes.length === 1
        ? 'That order keeps the key; the build cameo it used to fire no longer answers to it.'
        : 'Those orders keep the keys; the build cameos they used to fire no longer answer to them.',
    ));
  }

  private renderRow(def: ActionDef, current: Chord | undefined, bindings: StoredBindings): HTMLElement {
    const row = el('div', 'vm-help-row');
    row.appendChild(renderKeys(def, current, this.mac, bindings));

    const text = el('div', 'vm-help-text');
    text.appendChild(el('span', 'vm-help-name', def.label));
    text.appendChild(el('span', 'vm-help-desc', def.description));
    row.appendChild(text);

    const tag = renderTag(def, current);
    if (tag !== null) row.appendChild(tag);
    return row;
  }

  private footNote(): string {
    const base =
      'Keys shown are the ones you have bound right now. Page Up and Page Down scroll; ' +
      'Escape closes.';
    return this.mac
      ? `${base} On this Mac ⌃ is Control and ⌥ is Option — the order modifiers are Control ` +
        'and Option, never Command.'
      : base;
  }
}
