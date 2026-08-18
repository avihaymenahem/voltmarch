/**
 * ============================================================================
 * src/shell/LoadGame.ts — the save system's player-facing half
 * ============================================================================
 * Four things live here, in this order:
 *
 *   1. THE CONTRACT with the save service (`SaveService`) and the duck-typed
 *      probe that finds it, or does not.
 *   2. THE AUTOSAVE POLICY — `AutosaveScheduler`, a pure state machine driven
 *      by the SIM TICK COUNTER and nothing else.
 *   3. The load screen (`LoadGameScreen`), reached from the title.
 *   4. The manual-save panel (`SavePanel`), hosted as an overlay by the pause
 *      menu, matching the `HelpPanel` / `MissionsPanel` shape exactly.
 *
 * WHY THE CONTRACT IS RESTATED HERE RATHER THAN IMPORTED
 * -----------------------------------------------------
 * `src/save/**` is a system: it registers by existing and publishes
 * `globalThis.__vmSave` at `init`. This file is the shell's one door onto it,
 * exactly as `progression-link.ts` is the shell's one door onto
 * `src/progression/**`, and for the same three reasons — the shell must compile
 * and boot with the save system deleted, the `?shot=` harness must never load
 * it, and every call site has to answer "is it there?" identically or a screen
 * nobody thought about starts throwing on the title screen.
 *
 * The absent service is therefore a SUPPORTED CONFIGURATION. `saveSlots()`
 * returns an empty list, the Load Game button stays disabled and still says
 * "No saves", and the pause menu does not grow a Save entry. That is the same
 * truth `MainMenu.ts` has always told; only the reason changed.
 *
 * WHY AUTOSAVE COUNTS TICKS AND NOT MILLISECONDS
 * ----------------------------------------------
 * Two independent reasons and both matter:
 *
 *   - `Date.now()` and `performance.now()` are banned inside `simTick` and a
 *     test asserts it. The scheduler never reads a clock at all — every input
 *     arrives in the sample — so it cannot violate that rule even if it were
 *     moved into a system tomorrow.
 *   - Game speed. At 2x, five wall-clock minutes is ten minutes of match. What
 *     bounds a player's loss is SIMULATED progress, not elapsed real time, so
 *     the interval is denominated in the only unit that measures it.
 *
 * WHY THE INTERVAL IS THREE SIMULATED MINUTES
 * -------------------------------------------
 * 5400 ticks at 30 Hz. With three rotating slots that is a bounded loss of at
 * most three minutes of play and nine minutes of rollback depth. Five minutes
 * would buy fifteen minutes of depth at the cost of a five-minute loss, and
 * losing five minutes of an RTS match is losing a push; losing three is losing
 * a build cycle.
 *
 * WHY THERE IS A SECOND TRIGGER, AND ONLY ONE
 * -------------------------------------------
 * "Objective completed" is the moment a player most wants to come back to, it
 * is already read at 2 Hz by the pause menu, and it is RARE. The obvious third
 * candidate — "entering combat" — is deliberately absent: in an RTS a unit is
 * in contact somewhere almost continuously, so that trigger would fire against
 * the cooldown forever and reduce three rotating slots to three snapshots of
 * the last ninety seconds, which is strictly worse than the interval alone.
 *
 * WHY AUTOSAVES CARRY NO THUMBNAIL AND MANUAL SAVES DO
 * ---------------------------------------------------
 * A thumbnail is a `drawImage` of the WebGL canvas plus an encode, and both
 * halves force a GPU->CPU sync. This game is GPU-bound (77.9 ms median at
 * native), so paying that mid-fight is exactly the hitch autosave must not
 * cause. A MANUAL save is taken from the pause menu, where `Shell.pause()` has
 * already called `setPaused(true)` and the frame is frozen — the stall costs a
 * player nothing there. So the request asks for a thumbnail only when it is
 * free, and the load screen draws a generated plate for the rest.
 * ============================================================================
 */

import './savegame.css';

import { SIM_HZ } from '../core/config';
import { DIFFICULTIES, mapById } from './settings-store';
import { formatClock } from './PauseMenu';
import {
  button,
  el,
  focusable,
  icon,
  pageFrame,
  playableFactions,
  type Screen,
  type Shell,
} from './Shell';

/* ==========================================================================
 * 1. THE CONTRACT
 *
 * Everything below is what this file ASSUMES of `src/save/**`. It is stated as
 * an interface rather than described in prose so that the assumption is
 * type-checked at every call site, and so the owning module can assert its own
 * implementation is assignable to it from a test.
 * ========================================================================== */

/**
 * The match parameters a restore has to reproduce BEFORE the snapshot is
 * applied over the top.
 *
 * Opaque to the save service: it stores this verbatim in its index and hands it
 * back on `list()`, never interpreting a field. That is what keeps the shell's
 * lobby vocabulary (`MapChoice.id`, `FactionDef.key`, an index into
 * `DIFFICULTIES`) out of a module that has no business knowing it, and it is
 * what lets the load screen render a slot without opening the blob store.
 */
export interface SaveContext {
  /** `MapChoice.id`, as in `settings-store.MAPS`. */
  readonly mapId: string;
  /** `FactionDef.key` of the local player. */
  readonly playerFaction: string;
  /** `FactionDef.key` of the opponent. */
  readonly aiFaction: string;
  /** Index into `DIFFICULTIES`. */
  readonly difficulty: number;
  /** Index into `SPEEDS`. */
  readonly speed: number;
  /** The RESOLVED sim seed — never 0, never "roll one". */
  readonly seed: number;
  /**
   * SEATS THE GROUND WAS LEVELLED FOR, human included. `armyCount(setup)`.
   *
   * Terrain, roads and scatter are regenerated on load rather than stored, and
   * `Shell.bootGame` calls `setPlannedArmies(armyCount(this.setup))` — so the
   * generator reserves one levelled shelf per army IN THE SETUP THAT BOOTED. A
   * four-way save restored through a boot that planned two comes back with its
   * bases on ground levelled for two, and `requireMatchingWorld` cannot catch
   * it: it compares scenario, map and seed, and all three match.
   *
   * This was masked until the army-count wire landed, because every boot
   * planned two and the capture and the restore agreed by accident.
   */
  readonly armies: number;
  /**
   * The campaign operation this match is, or absent for a skirmish.
   *
   * `requireMatchingWorld` compares scenario, map and seed — and two operations
   * sharing a `MAP_PRESET` and a seed compare EQUAL on all three, so a save from
   * operation 3 would restore into operation 7's world with no refusal.
   * `restoreSnapshot` refuses on this instead.
   *
   * ABSENT RATHER THAN `''`, matching `ServiceContext` and `SaveMeta`, and
   * optional so every row already on disk degrades through `contextOf`'s
   * per-field fallback instead of failing.
   */
  readonly campaignOperationId?: string;
}

/**
 * One row of the save index.
 *
 * Small enough to live in `localStorage` alongside every other row, which is
 * the entire point: the load screen paints from this and touches no database.
 */
export interface SaveSlotMeta {
  /** Opaque slot key. Autosaves are `auto.<n>`; manual saves are anything else. */
  readonly id: string;
  readonly kind: SaveKind;
  /** Player-facing name. Autosaves get a generated one. */
  readonly label: string;
  /** `Date.now()` at write time — captured OUTSIDE the sim tick. */
  readonly savedAtMs: number;
  /** `GameLoop.tick` when the snapshot was taken. */
  readonly tick: number;
  /** In-game clock, seconds. */
  readonly simSeconds: number;
  /** The local player's bank at capture. */
  readonly credits: number;
  /** Snapshot size in bytes, before any base64 expansion. */
  readonly bytes: number;
  /** A `data:` URI, or null when none was captured. */
  readonly thumbnail: string | null;
  readonly context: SaveContext;
}

export type SaveKind = 'auto' | 'manual';

export interface SaveRequest {
  readonly kind: SaveKind;
  readonly label: string;
  readonly context: SaveContext;
  /** Slot to overwrite. Omit to allocate a fresh one. */
  readonly slotId?: string;
  /** Ask for a downscaled frame. The service may decline; see the header. */
  readonly thumbnail?: boolean;
}

/**
 * A refusal, as a VALUE rather than a thrown error.
 *
 * `src/game/SaveGame.ts` reports every failure this way (`SaveResult<T>` =
 * `{ok:true,value} | {ok:false,code,reason}`), and a store built on top of it
 * will naturally hand the same shape outwards. The front end therefore accepts
 * BOTH conventions — a rejected promise and a resolved refusal — because the
 * one outcome that must be impossible here is a failed save that the UI reads
 * as a success. `unwrap` collapses the two into one.
 */
export interface SaveRefusalLike {
  readonly ok: false;
  /** One sentence, addressed to the player. */
  readonly reason: string;
  readonly code?: string;
}

export function isRefusal(v: unknown): v is SaveRefusalLike {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as { ok?: unknown; reason?: unknown };
  return r.ok === false && typeof r.reason === 'string';
}

/** The value, or a throw carrying the refusal's own sentence. */
export function unwrap<T>(value: T | SaveRefusalLike): T {
  if (isRefusal(value)) {
    throw new Error(value.reason === '' ? 'The save system refused the request.' : value.reason);
  }
  return value;
}

/**
 * The five members the front end calls.
 *
 * `list()` is SYNCHRONOUS on purpose and the store is expected to keep its
 * index in `localStorage` for exactly that reason — the title screen has to
 * decide whether the Load button is enabled while it is building its own DOM,
 * and an async probe there means either a button that changes state under the
 * player's cursor or a title screen that waits on a database.
 *
 * `load(id)` assumes a live engine ALREADY BOOTED on the slot's map and seed —
 * see `Shell.loadGame`, which does that boot first. Restoring is replacing the
 * contents of a world, not creating one, because several engine modules read
 * their configuration off the URL at `init()` and nothing but a re-bootstrap
 * can change that.
 *
 * HOW `SaveSlotMeta` MAPS ONTO THE BLOB HEADER. The store composes an index row
 * from the `SaveMeta` that `captureSnapshot` already returns, plus the
 * `context` this file handed it:
 *
 *     SaveSlotMeta.label      <- SaveMeta.label
 *     SaveSlotMeta.savedAtMs  <- SaveMeta.savedAtMs
 *     SaveSlotMeta.tick       <- SaveMeta.tick
 *     SaveSlotMeta.simSeconds <- SaveMeta.simTimeSec
 *     SaveSlotMeta.credits    <- SaveMeta.credits
 *     SaveSlotMeta.bytes      <- SaveMeta.byteLength
 *     SaveSlotMeta.context    <- SaveRequest.context, stored verbatim
 *
 * so nothing here asks for a field the codec does not already produce.
 */
export interface SaveService {
  /** Every slot. Order is not assumed; `saveSlots()` sorts. */
  list(): readonly SaveSlotMeta[];
  /** True when a snapshot can be taken right now. */
  canSave(): boolean;
  /** Capture and persist. Refuses by value or by rejection; both are shown. */
  save(request: SaveRequest): Promise<SaveSlotMeta | SaveRefusalLike>;
  /** Restore over the live world. Refuses on a missing or corrupt blob. */
  load(id: string): Promise<SaveRefusalLike | void>;
  /** Delete one slot. Succeeds even when the id is already gone. */
  remove(id: string): Promise<SaveRefusalLike | void>;
}

declare global {
  // eslint-disable-next-line no-var
  var __vmSave: SaveService | undefined;
}

/**
 * The live service, or null.
 *
 * Null covers four real states and treats them identically: the save system is
 * not registered, it has not run `init` yet, the `?shot=` harness suppressed
 * it, or a partially constructed handle was published during init ordering.
 */
export function saveService(): SaveService | null {
  const g = globalThis as { __vmSave?: unknown };
  const s = g.__vmSave;
  if (typeof s !== 'object' || s === null) return null;
  const v = s as Partial<SaveService>;
  if (typeof v.list !== 'function') return null;
  if (typeof v.canSave !== 'function') return null;
  if (typeof v.save !== 'function') return null;
  if (typeof v.load !== 'function') return null;
  if (typeof v.remove !== 'function') return null;
  return s as SaveService;
}

/**
 * Every slot, newest first. Total: an absent service, a service whose `list`
 * throws, and a service that returns junk all read as "no saves".
 */
export function saveSlots(): readonly SaveSlotMeta[] {
  const svc = saveService();
  if (svc === null) return [];
  let rows: readonly SaveSlotMeta[];
  try {
    rows = svc.list();
  } catch {
    return [];
  }
  if (!Array.isArray(rows)) return [];
  const out = rows.filter(isSlotMeta);
  out.sort((a, b) => b.savedAtMs - a.savedAtMs);
  return out;
}

/** Structural check, because a stale index written by an older build is real. */
function isSlotMeta(v: unknown): v is SaveSlotMeta {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Partial<SaveSlotMeta>;
  if (typeof r.id !== 'string' || r.id === '') return false;
  if (r.kind !== 'auto' && r.kind !== 'manual') return false;
  if (typeof r.label !== 'string') return false;
  if (typeof r.savedAtMs !== 'number' || !Number.isFinite(r.savedAtMs)) return false;
  const c = r.context as Partial<SaveContext> | undefined;
  if (typeof c !== 'object' || c === null) return false;
  if (typeof c.mapId !== 'string') return false;
  if (typeof c.playerFaction !== 'string') return false;
  return true;
}

/** The manual slots alone — the only ones a manual save may overwrite. */
export function manualSlots(): readonly SaveSlotMeta[] {
  return saveSlots().filter((s) => s.kind === 'manual');
}

/* ==========================================================================
 * 2. THE AUTOSAVE POLICY
 *
 * A pure state machine. It reads no clock, touches no DOM, and imports nothing
 * from the engine but the sim rate, so `tests/savegame-ux.spec.ts` drives it a
 * hundred thousand ticks in a millisecond.
 * ========================================================================== */

/** Rotating autosave slots. Three is the classic answer and it costs nothing. */
export const AUTOSAVE_SLOTS = 3;

/** 5400 ticks = three simulated minutes at 30 Hz. See the file header. */
export const AUTOSAVE_INTERVAL_TICKS = SIM_HZ * 60 * 3;

/**
 * No two autosaves closer than thirty simulated seconds.
 *
 * This exists ENTIRELY for the event trigger. Without it a mission that pays
 * out three objectives in one breath would burn all three rotating slots on the
 * same ten seconds of match, and the rollback depth the slots exist to provide
 * would be gone at the moment it was most needed.
 */
export const AUTOSAVE_MIN_GAP_TICKS = SIM_HZ * 30;

/**
 * Nothing is autosaved in the first thirty simulated seconds.
 *
 * A match that has not finished deploying has nothing in it worth restoring,
 * and writing a slot there costs a real slot out of three.
 */
export const AUTOSAVE_GRACE_TICKS = SIM_HZ * 30;

/**
 * How long a due autosave will wait for a cheap frame before giving up and
 * taking an expensive one. Ten simulated seconds.
 *
 * The deferral is the whole anti-hitch mechanism: when the loop reports it ran
 * catch-up steps this frame, the machine is already behind and adding a
 * snapshot to that frame is how one hitch becomes two. The deadline is what
 * stops a permanently overloaded machine from never autosaving at all — on that
 * machine the player is already dropping frames, and a save is worth one more.
 */
export const AUTOSAVE_DEFER_LIMIT_TICKS = SIM_HZ * 10;

export type AutosaveTrigger = 'interval' | 'objective';

/** Everything the scheduler is allowed to know. Note the absence of a clock. */
export interface AutosaveSample {
  /** `GameLoop.tick` — monotonic, reset per match. */
  tick: number;
  /** `GameLoop.lastSteps > 1`: the loop ran catch-up steps this frame. */
  catchingUp: boolean;
  paused: boolean;
  /** `SaveService.canSave()`. */
  canSave: boolean;
  /** How many active objectives report complete. */
  objectivesComplete: number;
}

export type AutosaveDecision =
  | { readonly act: 'idle' }
  | { readonly act: 'defer'; readonly trigger: AutosaveTrigger }
  | { readonly act: 'save'; readonly slotId: string; readonly trigger: AutosaveTrigger };

const IDLE: AutosaveDecision = { act: 'idle' };

/** `auto.0` .. `auto.2`. Never collides with a manual id — see `newManualId`. */
export function autosaveSlotId(index: number): string {
  return `auto.${((index % AUTOSAVE_SLOTS) + AUTOSAVE_SLOTS) % AUTOSAVE_SLOTS}`;
}

/** A fresh manual slot id. Namespaced so rotation can never reach it. */
export function newManualId(savedAtMs: number, salt: number): string {
  return `manual.${savedAtMs.toString(36)}.${(salt >>> 0).toString(36)}`;
}

/** The generated name on an autosave row. */
export function autosaveLabel(trigger: AutosaveTrigger, simSeconds: number): string {
  const when = formatClock(simSeconds);
  return trigger === 'objective' ? `Autosave · Objective · ${when}` : `Autosave · ${when}`;
}

/**
 * The policy, as a machine.
 *
 * Call `evaluate` as often as you like — it is idempotent for a given tick, so
 * polling it at 2 Hz and polling it every frame produce the same saves. The
 * caller commits the outcome with `committed` or `failed`, because only the
 * caller knows whether the write actually landed.
 */
export class AutosaveScheduler {
  /**
   * Tick of the last COMMITTED autosave, or of the match start.
   *
   * Seeded to the START of the match rather than to minus-one-interval, so the
   * FIRST autosave lands a full three minutes in. Seeding it the other way made
   * the first slot fire the instant the grace window closed — thirty seconds
   * into a match that has one power plant in it — and burned one of the three
   * rotating slots on a position nobody would ever restore.
   */
  private lastSaveTick = 0;
  /** Tick at which the pending save became due, or -1. */
  private pendingSince = -1;
  private pendingTrigger: AutosaveTrigger = 'interval';
  private slot = 0;
  /** High-water mark of completed objectives, so a rise is detected once. */
  private objectivesDone = 0;

  /** Forget everything. Call on a new match and after a restore. */
  reset(tick = 0): void {
    this.lastSaveTick = tick;
    this.pendingSince = -1;
    this.pendingTrigger = 'interval';
    this.objectivesDone = 0;
    // The slot cursor deliberately SURVIVES a reset within a session: a player
    // who restarts twice in five minutes should still be rotating, not
    // overwriting `auto.0` every time.
  }

  /** The slot the next autosave would claim. */
  nextSlotId(): string {
    return autosaveSlotId(this.slot);
  }

  /** Ticks until the interval trigger, from `tick`. Clamped at 0. */
  ticksUntilDue(tick: number): number {
    const left = this.lastSaveTick + AUTOSAVE_INTERVAL_TICKS - tick;
    return left > 0 ? left : 0;
  }

  evaluate(s: AutosaveSample): AutosaveDecision {
    // A paused match, a match with no service, and a match too young to be
    // worth a slot are all "nothing happens" — and none of them may bank a
    // trigger for later, or unpausing would fire an autosave instantly.
    if (!s.canSave || s.paused) {
      this.objectivesDone = Math.max(this.objectivesDone, s.objectivesComplete);
      return IDLE;
    }

    const rose = s.objectivesComplete > this.objectivesDone;
    this.objectivesDone = Math.max(this.objectivesDone, s.objectivesComplete);

    if (s.tick < AUTOSAVE_GRACE_TICKS) return IDLE;

    if (this.pendingSince < 0) {
      const sinceLast = s.tick - this.lastSaveTick;
      if (rose && sinceLast >= AUTOSAVE_MIN_GAP_TICKS) {
        this.pendingSince = s.tick;
        this.pendingTrigger = 'objective';
      } else if (sinceLast >= AUTOSAVE_INTERVAL_TICKS) {
        this.pendingSince = s.tick;
        this.pendingTrigger = 'interval';
      } else {
        return IDLE;
      }
    }

    // Due. Take it on the first frame that is not already behind, or when the
    // deferral deadline runs out, whichever comes first.
    if (s.catchingUp && s.tick - this.pendingSince < AUTOSAVE_DEFER_LIMIT_TICKS) {
      return { act: 'defer', trigger: this.pendingTrigger };
    }
    return { act: 'save', slotId: this.nextSlotId(), trigger: this.pendingTrigger };
  }

  /** The write landed. Advance the rotation. */
  committed(tick: number): void {
    this.lastSaveTick = tick;
    this.pendingSince = -1;
    this.slot = (this.slot + 1) % AUTOSAVE_SLOTS;
  }

  /**
   * The write failed. Back off a FULL interval rather than retrying next frame.
   *
   * A store that is out of quota fails every time, and a retry loop against it
   * would turn one surfaced error into an error every 33 ms. The rotation does
   * NOT advance: a failed write left the previous contents of that slot intact,
   * and stepping past it would throw away a good save to protect a bad one.
   */
  failed(tick: number): void {
    this.lastSaveTick = tick;
    this.pendingSince = -1;
  }
}

/* ==========================================================================
 * 3. FORMATTING
 * ========================================================================== */

/** `2.4 MB`, `812 kB`, `640 B`. SI, because storage quotas are quoted in SI. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  if (bytes < 1000) return `${Math.round(bytes)} B`;
  if (bytes < 1e6) return `${(bytes / 1e3).toFixed(bytes < 1e4 ? 1 : 0)} kB`;
  return `${(bytes / 1e6).toFixed(1)} MB`;
}

/**
 * How long ago, in words. `nowMs` is injected so this is testable without
 * mocking the clock.
 */
export function formatWhen(savedAtMs: number, nowMs: number): string {
  const sec = Math.floor((nowMs - savedAtMs) / 1000);
  if (!Number.isFinite(sec)) return '—';
  if (sec < 0) return 'just now';
  if (sec < 45) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${Math.max(1, min)} min ago`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(savedAtMs).toISOString().slice(0, 10);
}

/** `12,480`. Grouped, because a six-digit bank is unreadable otherwise. */
export function formatCredits(credits: number): string {
  const n = Math.max(0, Math.round(Number.isFinite(credits) ? credits : 0));
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Display name for a faction key, falling back to the key itself. */
export function factionName(key: string): string {
  return playableFactions().find((f) => f.key === key)?.name ?? key;
}

/** The suggested name in the manual-save field. */
export function suggestedSaveName(mapId: string, simSeconds: number): string {
  return `${mapById(mapId).name} · ${formatClock(simSeconds)}`;
}

/**
 * A save name the store can round-trip. Trimmed, collapsed and capped.
 *
 * An empty result is legal and means "the caller should use the suggestion" —
 * it is never written, because a row labelled "" is a row a player cannot tell
 * from the row above it.
 */
export function sanitizeSaveName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, 48);
}

/* ==========================================================================
 * 4. THE SLOT CARD
 *
 * Shared by the load screen and the save panel, so a slot looks the same
 * wherever it is shown and there is one place to change what a slot says.
 * ========================================================================== */

interface SlotCardOptions {
  readonly slot: SaveSlotMeta;
  readonly nowMs: number;
  /** Rendered into the card's action strip. */
  readonly actions?: readonly HTMLElement[];
  /** Marks the card as the current overwrite target. */
  readonly selected?: boolean;
}

/**
 * Enough to choose between two saves at a glance: map, faction, in-game clock,
 * credits, real timestamp, and a plate.
 */
export function slotCard(options: SlotCardOptions): HTMLDivElement {
  const s = options.slot;
  const card = el('div', `vm-save-row${options.selected === true ? ' is-selected' : ''}`);
  card.dataset.slotId = s.id;

  /* -- plate ------------------------------------------------------------- */
  const thumb = el('div', 'vm-save-thumb');
  if (s.thumbnail !== null && s.thumbnail !== '') {
    const img = document.createElement('img');
    img.src = s.thumbnail;
    img.alt = '';
    img.decoding = 'async';
    thumb.appendChild(img);
  } else {
    // No frame was captured — see the header for why autosaves never carry
    // one. A generated plate is honest about that; a grey box is not.
    thumb.classList.add('is-generated');
    thumb.appendChild(el('span', 'vm-save-thumb-clock vm-num', formatClock(s.simSeconds)));
    thumb.appendChild(el('span', 'vm-save-thumb-map', mapById(s.context.mapId).name));
  }
  const badge = el('span', `vm-save-kind is-${s.kind}`, s.kind === 'auto' ? 'Auto' : 'Manual');
  thumb.appendChild(badge);
  card.appendChild(thumb);

  /* -- text -------------------------------------------------------------- */
  const body = el('div', 'vm-save-body');
  body.appendChild(el('h3', 'vm-save-name', s.label === '' ? mapById(s.context.mapId).name : s.label));

  const meta = el('div', 'vm-save-meta');
  meta.appendChild(chip('map', mapById(s.context.mapId).name));
  meta.appendChild(chip('flag', factionName(s.context.playerFaction)));
  meta.appendChild(chip('clock', formatClock(s.simSeconds)));
  meta.appendChild(chip('coins', formatCredits(s.credits)));
  body.appendChild(meta);

  const sub = el('div', 'vm-save-sub');
  sub.appendChild(el('span', undefined, formatWhen(s.savedAtMs, options.nowMs)));
  sub.appendChild(el('span', 'vm-save-dot', '·'));
  sub.appendChild(el('span', undefined, DIFFICULTIES[s.context.difficulty] ?? 'Normal'));
  sub.appendChild(el('span', 'vm-save-dot', '·'));
  sub.appendChild(el('span', 'vm-num', formatBytes(s.bytes)));
  body.appendChild(sub);
  card.appendChild(body);

  /* -- actions ----------------------------------------------------------- */
  const acts = el('div', 'vm-save-actions');
  for (const a of options.actions ?? []) acts.appendChild(a);
  card.appendChild(acts);

  return card;
}

function chip(iconName: string, text: string): HTMLSpanElement {
  const c = el('span', 'vm-save-chip');
  c.appendChild(icon(iconName, 13));
  c.appendChild(el('span', undefined, text));
  return c;
}

/**
 * The arm-then-confirm pattern, as one helper.
 *
 * A destructive control that acts on the first click is a control that deletes
 * a forty-minute match on a mis-aimed cursor. The window is deliberately short:
 * an armed button that stays armed for a minute is a trap of its own.
 */
export const CONFIRM_WINDOW_MS = 4000;

export class ConfirmButton {
  readonly root: HTMLButtonElement;
  private armed = false;
  private timer = 0;

  constructor(
    private readonly idleLabel: string,
    private readonly armedLabel: string,
    private readonly onConfirm: () => void,
    options: { iconName?: string; variant?: 'default' | 'primary' | 'danger' } = {},
  ) {
    this.root = button(idleLabel, {
      iconName: options.iconName,
      variant: options.variant,
      onClick: () => this.click(),
    });
  }

  /** True while the next click will actually do the thing. */
  isArmed(): boolean {
    return this.armed;
  }

  private click(): void {
    if (this.armed) {
      this.disarm();
      this.onConfirm();
      return;
    }
    this.armed = true;
    this.setLabel(this.armedLabel);
    this.root.classList.add('is-armed');
    this.timer = window.setTimeout(() => this.disarm(), CONFIRM_WINDOW_MS);
  }

  disarm(): void {
    if (this.timer !== 0) {
      window.clearTimeout(this.timer);
      this.timer = 0;
    }
    if (!this.armed) return;
    this.armed = false;
    this.setLabel(this.idleLabel);
    this.root.classList.remove('is-armed');
  }

  dispose(): void {
    if (this.timer !== 0) {
      window.clearTimeout(this.timer);
      this.timer = 0;
    }
    this.armed = false;
  }

  private setLabel(text: string): void {
    const node = this.root.querySelector('.vm-btn-label');
    if (node !== null) node.textContent = text;
  }
}

/* ==========================================================================
 * 5. THE LOAD SCREEN
 * ========================================================================== */

export class LoadGameScreen implements Screen {
  readonly id = 'load';
  private host: HTMLElement | null = null;
  private body: HTMLElement | null = null;
  private status: HTMLElement | null = null;
  private readonly confirms: ConfirmButton[] = [];
  private busy = false;

  constructor(private readonly shell: Shell) {}

  mount(host: HTMLElement): void {
    this.host = host;
    host.classList.add('vm-page');

    const frame = pageFrame('Load Game', () => this.shell.showMenu());
    frame.root.classList.add('vm-saves-panel');
    this.body = frame.body;
    this.body.classList.add('vm-saves-body');

    this.status = el('p', 'vm-saves-status', '');
    frame.foot.appendChild(this.status);
    frame.foot.appendChild(el('div', 'vm-spacer'));
    frame.foot.appendChild(button('Back', {
      variant: 'primary',
      onClick: () => this.shell.showMenu(),
    }));

    host.appendChild(frame.root);
    this.render();
  }

  unmount(): void {
    this.disposeConfirms();
    this.host?.classList.remove('vm-page');
    this.host = null;
    this.body = null;
    this.status = null;
  }

  onBack(): boolean {
    this.shell.showMenu();
    return true;
  }

  /* -------------------------------------------------------------------- */

  private disposeConfirms(): void {
    for (const c of this.confirms) c.dispose();
    this.confirms.length = 0;
  }

  private render(): void {
    const body = this.body;
    if (body === null) return;
    this.disposeConfirms();
    body.replaceChildren();

    const slots = saveSlots();
    if (slots.length === 0) {
      // Reachable: the player deleted the last slot without leaving. The screen
      // says so rather than showing an empty frame, and the title screen's
      // button will be disabled again the moment they go back.
      const empty = el('div', 'vm-saves-empty');
      empty.appendChild(icon('folder', 28));
      empty.appendChild(el('p', undefined, 'No saved battles.'));
      empty.appendChild(el('p', 'vm-saves-empty-sub', 'Autosaves are written every three minutes of a live match, and the pause menu can name one at any time.'));
      body.appendChild(empty);
      return;
    }

    const nowMs = Date.now();
    for (const slot of slots) {
      const load = button('Load', {
        iconName: 'restore',
        variant: 'primary',
        onClick: () => { void this.load(slot); },
      });
      const del = new ConfirmButton('Delete', 'Confirm?', () => { void this.remove(slot); }, {
        iconName: 'cross',
        variant: 'danger',
      });
      this.confirms.push(del);
      body.appendChild(slotCard({ slot, nowMs, actions: [load, del.root] }));
    }
  }

  private setStatus(text: string, bad: boolean): void {
    const node = this.status;
    if (node === null) return;
    node.textContent = text;
    node.classList.toggle('is-bad', bad);
  }

  private async load(slot: SaveSlotMeta): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.setStatus(`Restoring ${slot.label}…`, false);
    try {
      await this.shell.loadGame(slot);
    } catch (err) {
      // A restore that cannot complete must SAY so. The screen is still here,
      // the other slots are still listed, and the player can pick another one.
      this.busy = false;
      this.setStatus(errorText(err), true);
      return;
    }
    this.busy = false;
  }

  private async remove(slot: SaveSlotMeta): Promise<void> {
    const svc = saveService();
    if (svc === null) return;
    try {
      unwrap(await svc.remove(slot.id));
    } catch (err) {
      this.setStatus(errorText(err), true);
      return;
    }
    this.setStatus(`Deleted ${slot.label}.`, false);
    this.render();
  }
}

/** Whatever a rejected promise carried, as a sentence. */
export function errorText(err: unknown): string {
  if (err instanceof Error && err.message !== '') return err.message;
  if (typeof err === 'string' && err !== '') return err;
  return 'The save system reported an unknown failure.';
}

/* ==========================================================================
 * 6. THE MANUAL-SAVE PANEL
 *
 * Satisfies the pause menu's three-member `Overlay` shape (`root`, `dispose`,
 * `onKeyDown`) so it costs that screen one button and no new state.
 * ========================================================================== */

export interface SavePanelOptions {
  readonly shell: Shell;
  readonly onClose: () => void;
}

export class SavePanel {
  readonly root: HTMLElement;

  private readonly shell: Shell;
  private readonly onClose: () => void;
  private readonly name: HTMLInputElement;
  private readonly list: HTMLElement;
  private readonly status: HTMLElement;
  private readonly saveButton: HTMLButtonElement;
  /** The manual slot the next write overwrites, or null for a fresh one. */
  private target: SaveSlotMeta | null = null;
  private armed = false;
  private busy = false;

  constructor(options: SavePanelOptions) {
    this.shell = options.shell;
    this.onClose = options.onClose;

    this.root = el('div', 'vm-saves');
    const frame = pageFrame('Save Game', options.onClose);
    frame.root.classList.add('vm-saves-panel');

    /* -- name ------------------------------------------------------------ */
    const nameRow = el('div', 'vm-save-name-row');
    const label = el('label', 'vm-save-name-label', 'Name');
    label.htmlFor = 'vm-save-name';
    const input = el('input');
    input.type = 'text';
    input.id = 'vm-save-name';
    input.className = 'vm-save-name-input';
    input.maxLength = 48;
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.value = suggestedSaveName(
      this.shell.getSetup().map,
      this.shell.matchSeconds(),
    );
    input.addEventListener('input', () => this.onNameEdited());
    focusable(input);
    this.name = input;
    nameRow.appendChild(label);
    nameRow.appendChild(input);
    frame.body.appendChild(nameRow);

    /* -- existing manual slots ------------------------------------------- */
    frame.body.appendChild(el('p', 'vm-subtitle', 'Overwrite'));
    this.list = el('div', 'vm-saves-body');
    frame.body.appendChild(this.list);
    frame.body.appendChild(el('p', 'vm-saves-note',
      'Autosaves rotate through three of their own slots and are never written over by a manual save.'));

    /* -- foot ------------------------------------------------------------ */
    this.status = el('p', 'vm-saves-status', '');
    frame.foot.appendChild(this.status);
    frame.foot.appendChild(el('div', 'vm-spacer'));
    this.saveButton = button('Save', {
      iconName: 'folder',
      variant: 'primary',
      onClick: () => { void this.commit(); },
    });
    frame.foot.appendChild(this.saveButton);
    frame.foot.appendChild(button('Close', { onClick: options.onClose }));

    this.root.appendChild(frame.root);
    this.renderList();
    this.syncSaveButton();
  }

  dispose(): void {
    this.busy = false;
  }

  /**
   * Enter commits, Escape closes — and NOTHING else is claimed.
   *
   * Returning true makes the shell call `preventDefault`, so claiming a key the
   * text field needs would break typing in it. The arrow keys in particular are
   * left alone; `Shell.onKeyDown` skips its own ring navigation while a text
   * field has focus, which is what makes the caret work here.
   */
  onKeyDown(e: KeyboardEvent): boolean {
    if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      void this.commit();
      return true;
    }
    return false;
  }

  /* -------------------------------------------------------------------- */

  private renderList(): void {
    this.list.replaceChildren();
    const rows = manualSlots();
    if (rows.length === 0) {
      this.list.appendChild(el('p', 'vm-saves-note', 'No manual saves yet — this will create the first.'));
      return;
    }
    const nowMs = Date.now();
    for (const slot of rows) {
      const pick = button(this.target?.id === slot.id ? 'Selected' : 'Select', {
        iconName: this.target?.id === slot.id ? 'check' : 'folder',
        onClick: () => this.selectTarget(slot),
      });
      this.list.appendChild(slotCard({
        slot,
        nowMs,
        actions: [pick],
        selected: this.target?.id === slot.id,
      }));
    }
  }

  /** Picking a row is also picking its name — and it re-arms the confirm. */
  private selectTarget(slot: SaveSlotMeta): void {
    this.target = this.target?.id === slot.id ? null : slot;
    this.armed = false;
    if (this.target !== null) this.name.value = this.target.label;
    this.renderList();
    this.syncSaveButton();
  }

  /**
   * Typing a name that already exists selects that slot.
   *
   * Without this, "save as the same name" would silently create a second row
   * with an identical label and the player would have no way to tell them
   * apart. Matching it to the existing slot means the overwrite confirmation
   * fires — which is the requirement.
   */
  private onNameEdited(): void {
    const typed = sanitizeSaveName(this.name.value).toLowerCase();
    const hit = manualSlots().find((s) => sanitizeSaveName(s.label).toLowerCase() === typed) ?? null;
    if (hit?.id !== this.target?.id) {
      this.target = hit;
      this.renderList();
    }
    this.armed = false;
    this.syncSaveButton();
  }

  private syncSaveButton(): void {
    const node = this.saveButton.querySelector('.vm-btn-label');
    const overwriting = this.target !== null;
    const text = this.armed
      ? 'Confirm Overwrite'
      : overwriting ? 'Overwrite' : 'Save';
    if (node !== null) node.textContent = text;
    this.saveButton.classList.toggle('is-armed', this.armed);
    this.saveButton.classList.toggle('is-danger', overwriting && !this.armed);
  }

  private setStatus(text: string, bad: boolean): void {
    this.status.textContent = text;
    this.status.classList.toggle('is-bad', bad);
  }

  private async commit(): Promise<void> {
    if (this.busy) return;

    // Overwriting is destructive and takes two clicks. Creating is not.
    if (this.target !== null && !this.armed) {
      this.armed = true;
      this.syncSaveButton();
      this.setStatus(`This replaces “${this.target.label}”.`, false);
      return;
    }

    const typed = sanitizeSaveName(this.name.value);
    const label = typed === ''
      ? suggestedSaveName(this.shell.getSetup().map, this.shell.matchSeconds())
      : typed;

    this.busy = true;
    this.setStatus('Saving…', false);
    try {
      await this.shell.saveGame(label, this.target?.id);
    } catch (err) {
      this.busy = false;
      this.armed = false;
      this.syncSaveButton();
      this.setStatus(errorText(err), true);
      return;
    }
    this.busy = false;
    this.armed = false;
    this.target = null;
    this.setStatus(`Saved “${label}”.`, false);
    this.renderList();
    this.syncSaveButton();
    // The player came here to save, and they have. Leaving the panel open over
    // a frozen match just asks them to press a second button to get back.
    window.setTimeout(() => this.onClose(), 650);
  }
}
