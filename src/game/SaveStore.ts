/**
 * ============================================================================
 * VOLTMARCH — src/game/SaveStore.ts
 * ============================================================================
 * WHERE THE BYTES LIVE.
 *
 * ----------------------------------------------------------------------------
 * DESIGN CALL 2 — INDEXEDDB FOR THE BLOB, localStorage FOR THE INDEX
 * ----------------------------------------------------------------------------
 * The request said "localStorage or something". The measured numbers say the
 * split below, and the reasoning is worth keeping because the obvious answer is
 * wrong for a non-obvious reason.
 *
 * `localStorage` is a STRING store. A snapshot is binary, so it has to be
 * base64'd on the way in — a flat +33% — and both the encode and the write are
 * SYNCHRONOUS ON THE MAIN THREAD. At 60 fps the whole frame budget is 16.7 ms,
 * and a synchronous multi-hundred-kilobyte string write is a visible hitch in a
 * game that is otherwise allocation-free in its frame loop. The quota is also
 * ~5 MB for the WHOLE ORIGIN — shared with the settings store and the
 * progression profile — so a rotating autosave ring plus a handful of manual
 * saves is a meaningful fraction of it.
 *
 * `IndexedDB` stores an `ArrayBuffer` natively (no base64, no +33%), is
 * asynchronous (the write does not block the frame), and its quota is a large
 * fraction of free disk rather than five megabytes.
 *
 * But IndexedDB is asynchronous, and a load screen that has to open a database
 * before it can draw a list of saves is a load screen that flashes empty. So the
 * INDEX — slot id, label, timestamp, map, tick, credits, byte size — is a small
 * JSON document in `localStorage`, read synchronously, and `list()` is a plain
 * function that returns immediately. Only opening a save touches the database.
 *
 * Both halves degrade. No IndexedDB (private browsing, an old WebView) falls
 * back to base64 in `localStorage`; no `localStorage` either (the Node test
 * environment) falls back to memory. `backendName` reports which, and the game
 * says so in the boot log rather than silently losing saves.
 *
 * ----------------------------------------------------------------------------
 * WHAT THIS FILE IS NOT
 * ----------------------------------------------------------------------------
 * It knows nothing about the game. It moves opaque bytes and the metadata block
 * that `SaveGame.ts` produced, and it never parses a snapshot. That is what lets
 * the format change without the storage layer changing, and what lets the tests
 * drive the storage layer with three bytes of nonsense.
 * ============================================================================
 */

import type { SaveMeta, SaveResult } from './SaveGame';

/* ==========================================================================
 * 1. SLOT NAMING
 * ========================================================================== */

/**
 * Autosave slots rotate. Three is the smallest number that survives the
 * failure this feature exists to prevent: an autosave fires, THEN the thing
 * that ruins the match happens, and the player wants the one before it. One
 * slot gives them nothing to go back to; two gives them one chance; three
 * covers "I did not notice for a while" without turning the load screen into a
 * list of near-identical rows.
 */
export const AUTOSAVE_SLOT_COUNT = 3;

const AUTOSAVE_PREFIX = 'auto-';
export const MANUAL_SLOT_PREFIX = 'manual-';

export function autosaveSlotId(n: number): string {
  return `${AUTOSAVE_PREFIX}${((n % AUTOSAVE_SLOT_COUNT) + AUTOSAVE_SLOT_COUNT) % AUTOSAVE_SLOT_COUNT}`;
}

export function isAutosaveSlot(slot: string): boolean {
  return slot.startsWith(AUTOSAVE_PREFIX);
}

/** Every autosave slot id, in ring order. */
export function autosaveSlots(): string[] {
  const out: string[] = [];
  for (let i = 0; i < AUTOSAVE_SLOT_COUNT; i++) out.push(autosaveSlotId(i));
  return out;
}

/**
 * The autosave slot to write next: the first one never used, otherwise the
 * oldest. Deterministic given the index, which is what makes it testable.
 */
export function nextAutosaveSlot(existing: readonly SaveSlotInfo[]): string {
  const byId = new Map<string, SaveSlotInfo>();
  for (const info of existing) byId.set(info.slot, info);

  let oldest = autosaveSlotId(0);
  let oldestAt = Infinity;
  for (let i = 0; i < AUTOSAVE_SLOT_COUNT; i++) {
    const slot = autosaveSlotId(i);
    const info = byId.get(slot);
    if (info === undefined) return slot;
    if (info.meta.savedAtMs < oldestAt) { oldestAt = info.meta.savedAtMs; oldest = slot; }
  }
  return oldest;
}

/* ==========================================================================
 * 2. SHAPES
 * ========================================================================== */

export interface SaveSlotInfo {
  slot: string;
  meta: SaveMeta;
  /**
   * An opaque payload the caller asked to be stored alongside the row, handed
   * back verbatim by `list()` and never interpreted here.
   *
   * The front end's load screen needs things this layer has no business
   * knowing — which lobby map id, which faction keys, which difficulty index,
   * a thumbnail — and it needs them WITHOUT opening the blob. Storing them as
   * an opaque blob in the index is what keeps the shell's vocabulary out of the
   * storage layer while still letting a slot render in one synchronous call.
   */
  extra: unknown;
}

export type SaveBackendName = 'indexeddb' | 'localstorage' | 'memory';

/** The blob half. Async because the good implementation is. */
export interface SaveBackend {
  readonly name: SaveBackendName;
  write(slot: string, bytes: Uint8Array): Promise<void>;
  read(slot: string): Promise<Uint8Array | null>;
  remove(slot: string): Promise<void>;
}

/** The index half. Synchronous, because the load screen must render at once. */
export interface IndexStorage {
  readonly name: 'localstorage' | 'memory';
  load(): string | null;
  store(json: string): void;
}

/* ==========================================================================
 * 3. BASE64 — hand-rolled so it works in Node, a worker and a browser alike
 * ========================================================================== */

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_INV = (() => {
  const t = new Int16Array(128).fill(-1);
  for (let i = 0; i < B64.length; i++) t[B64.charCodeAt(i)] = i;
  return t;
})();

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  // Chunked so the intermediate string does not become one enormous rope.
  const parts: string[] = [];
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64[(n >>> 18) & 63] + B64[(n >>> 12) & 63] + B64[(n >>> 6) & 63] + B64[n & 63];
    if (out.length >= 8192) { parts.push(out); out = ''; }
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i] << 16;
    out += B64[(n >>> 18) & 63] + B64[(n >>> 12) & 63] + '==';
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += B64[(n >>> 18) & 63] + B64[(n >>> 12) & 63] + B64[(n >>> 6) & 63] + '=';
  }
  parts.push(out);
  return parts.join('');
}

export function base64ToBytes(text: string): Uint8Array {
  let clean = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 128 && B64_INV[c] >= 0) clean++;
  }
  const out = new Uint8Array((clean * 3) >> 2);
  let acc = 0;
  let bits = 0;
  let o = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 128) continue;
    const v = B64_INV[c];
    if (v < 0) continue;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >>> bits) & 0xff;
    }
  }
  return o === out.length ? out : out.subarray(0, o);
}

/* ==========================================================================
 * 4. BACKENDS
 * ========================================================================== */

const DB_NAME = 'voltmarch-saves';
const DB_STORE = 'snapshots';
const DB_VERSION = 1;
const LS_BLOB_PREFIX = 'vm.save.blob.';
const LS_INDEX_KEY = 'vm.save.index';

/** In-memory. The Node test environment, and the last-resort fallback. */
export class MemoryBackend implements SaveBackend {
  readonly name: SaveBackendName = 'memory';
  private readonly blobs = new Map<string, Uint8Array>();

  async write(slot: string, bytes: Uint8Array): Promise<void> {
    this.blobs.set(slot, bytes.slice());
  }
  async read(slot: string): Promise<Uint8Array | null> {
    const v = this.blobs.get(slot);
    return v === undefined ? null : v.slice();
  }
  async remove(slot: string): Promise<void> {
    this.blobs.delete(slot);
  }
}

/** base64 into `localStorage`. Costs +33% and blocks; used only as a fallback. */
export class LocalStorageBackend implements SaveBackend {
  readonly name: SaveBackendName = 'localstorage';

  constructor(private readonly ls: Storage) {}

  async write(slot: string, bytes: Uint8Array): Promise<void> {
    this.ls.setItem(LS_BLOB_PREFIX + slot, bytesToBase64(bytes));
  }
  async read(slot: string): Promise<Uint8Array | null> {
    const text = this.ls.getItem(LS_BLOB_PREFIX + slot);
    return text === null ? null : base64ToBytes(text);
  }
  async remove(slot: string): Promise<void> {
    this.ls.removeItem(LS_BLOB_PREFIX + slot);
  }
}

/** The real one. Stores the `ArrayBuffer` as it is. */
export class IndexedDbBackend implements SaveBackend {
  readonly name: SaveBackendName = 'indexeddb';
  private db: IDBDatabase | null = null;
  private opening: Promise<IDBDatabase> | null = null;

  constructor(private readonly factory: IDBFactory) {}

  private open(): Promise<IDBDatabase> {
    if (this.db !== null) return Promise.resolve(this.db);
    this.opening ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = this.factory.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (): void => {
        const db = req.result;
        if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
      };
      req.onsuccess = (): void => { this.db = req.result; resolve(req.result); };
      req.onerror = (): void => reject(req.error ?? new Error('indexedDB open failed'));
      req.onblocked = (): void => reject(new Error('indexedDB is blocked by another tab'));
    });
    return this.opening;
  }

  private run<T>(mode: IDBTransactionMode, body: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    return this.open().then((db) => new Promise<T>((resolve, reject) => {
      const tx = db.transaction(DB_STORE, mode);
      const req = body(tx.objectStore(DB_STORE));
      req.onsuccess = (): void => resolve(req.result);
      req.onerror = (): void => reject(req.error ?? new Error('indexedDB request failed'));
      tx.onabort = (): void => reject(tx.error ?? new Error('indexedDB transaction aborted'));
    }));
  }

  async write(slot: string, bytes: Uint8Array): Promise<void> {
    // A copy, because the caller's view may be a window into a larger buffer and
    // structured clone would carry the whole thing.
    const copy = bytes.slice();
    await this.run('readwrite', (s) => s.put(copy.buffer, slot));
  }

  async read(slot: string): Promise<Uint8Array | null> {
    const v = await this.run<unknown>('readonly', (s) => s.get(slot));
    if (v === undefined || v === null) return null;
    if (v instanceof ArrayBuffer) return new Uint8Array(v);
    if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength).slice();
    return null;
  }

  async remove(slot: string): Promise<void> {
    await this.run('readwrite', (s) => s.delete(slot));
  }
}

class LocalStorageIndex implements IndexStorage {
  readonly name = 'localstorage' as const;
  constructor(private readonly ls: Storage) {}
  load(): string | null { return this.ls.getItem(LS_INDEX_KEY); }
  store(json: string): void { this.ls.setItem(LS_INDEX_KEY, json); }
}

class MemoryIndex implements IndexStorage {
  readonly name = 'memory' as const;
  private json: string | null = null;
  load(): string | null { return this.json; }
  store(json: string): void { this.json = json; }
}

/* -- capability detection --------------------------------------------------- */

function localStorageOrNull(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    // Safari in private mode has the object and throws on write.
    const probe = 'vm.save.probe';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return null;
  }
}

function indexedDbOrNull(): IDBFactory | null {
  try {
    return typeof indexedDB === 'undefined' ? null : indexedDB;
  } catch {
    return null;
  }
}

/** Pick the best available blob backend. */
export function detectBackend(): SaveBackend {
  const idb = indexedDbOrNull();
  if (idb !== null) return new IndexedDbBackend(idb);
  const ls = localStorageOrNull();
  if (ls !== null) return new LocalStorageBackend(ls);
  return new MemoryBackend();
}

/** Pick the best available index storage. */
export function detectIndexStorage(): IndexStorage {
  const ls = localStorageOrNull();
  return ls !== null ? new LocalStorageIndex(ls) : new MemoryIndex();
}

/* ==========================================================================
 * 5. THE STORE
 * ========================================================================== */

interface IndexFile {
  version: number;
  entries: SaveSlotInfo[];
}

const INDEX_VERSION = 1;

export class SaveStore {
  private entries: SaveSlotInfo[] = [];
  private loaded = false;

  constructor(
    private readonly backend: SaveBackend = detectBackend(),
    private readonly index: IndexStorage = detectIndexStorage(),
  ) {}

  private static instance: SaveStore | null = null;

  /** The process-wide store. Tests construct their own instead. */
  static shared(): SaveStore {
    SaveStore.instance ??= new SaveStore();
    return SaveStore.instance;
  }

  /** Drop the shared instance. Tests only. */
  static resetShared(): void {
    SaveStore.instance = null;
  }

  get backendName(): SaveBackendName { return this.backend.name; }
  get indexName(): string { return this.index.name; }

  private ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;
    const raw = this.index.load();
    if (raw === null) return;
    try {
      const parsed = JSON.parse(raw) as IndexFile;
      if (parsed.version !== INDEX_VERSION || !Array.isArray(parsed.entries)) return;
      this.entries = parsed.entries
        .filter((e) => typeof e?.slot === 'string' && typeof e?.meta?.savedAtMs === 'number')
        .map((e) => ({ slot: e.slot, meta: e.meta, extra: e.extra ?? null }));
    } catch {
      // A corrupt index costs the LIST, not the saves. The blobs are still
      // there under their slot keys, and rewriting one repairs the index.
      console.warn('[save] the save index was unreadable and has been reset');
      this.entries = [];
    }
  }

  private flushIndex(): void {
    const file: IndexFile = { version: INDEX_VERSION, entries: this.entries };
    try {
      this.index.store(JSON.stringify(file));
    } catch (err) {
      console.warn('[save] could not write the save index:', err);
    }
  }

  /**
   * Every known save, newest first. Synchronous — this is the whole reason the
   * index is separate from the blobs.
   */
  list(): readonly SaveSlotInfo[] {
    this.ensureLoaded();
    return this.entries.slice().sort((a, b) => b.meta.savedAtMs - a.meta.savedAtMs);
  }

  /** The metadata for one slot, without opening the blob. */
  peek(slot: string): SaveMeta | null {
    this.ensureLoaded();
    for (const e of this.entries) if (e.slot === slot) return e.meta;
    return null;
  }

  has(slot: string): boolean {
    return this.peek(slot) !== null;
  }

  /**
   * Store a snapshot. The blob is written FIRST and the index only after it
   * lands: an index entry pointing at a blob that was never written is a save
   * the player can see and cannot open, which is worse than one they never knew
   * about.
   */
  async write(
    slot: string, bytes: Uint8Array, meta: SaveMeta, extra: unknown = null,
  ): Promise<SaveResult<SaveSlotInfo>> {
    this.ensureLoaded();
    try {
      await this.backend.write(slot, bytes);
    } catch (err) {
      return {
        ok: false,
        code: 'storage',
        reason: quotaLike(err)
          ? 'There is no room left to save. Delete a save and try again.'
          : `The game could not write the save (${describe(err)}).`,
      };
    }

    const info: SaveSlotInfo = { slot, meta: { ...meta, byteLength: bytes.length }, extra };
    const at = this.entries.findIndex((e) => e.slot === slot);
    if (at >= 0) this.entries[at] = info;
    else this.entries.push(info);
    this.flushIndex();
    return { ok: true, value: info };
  }

  async read(slot: string): Promise<SaveResult<Uint8Array>> {
    this.ensureLoaded();
    let bytes: Uint8Array | null;
    try {
      bytes = await this.backend.read(slot);
    } catch (err) {
      return { ok: false, code: 'storage', reason: `The save could not be read (${describe(err)}).` };
    }
    if (bytes === null) {
      // The index promised something the blob store does not have. Repair the
      // index so the load screen stops offering it.
      const at = this.entries.findIndex((e) => e.slot === slot);
      if (at >= 0) { this.entries.splice(at, 1); this.flushIndex(); }
      return { ok: false, code: 'storage', reason: 'That save is no longer on this device.' };
    }
    return { ok: true, value: bytes };
  }

  async remove(slot: string): Promise<void> {
    this.ensureLoaded();
    try {
      await this.backend.remove(slot);
    } catch (err) {
      console.warn(`[save] could not delete "${slot}":`, err);
    }
    const at = this.entries.findIndex((e) => e.slot === slot);
    if (at >= 0) { this.entries.splice(at, 1); this.flushIndex(); }
  }

  /** Delete everything this store knows about. */
  async clear(): Promise<void> {
    this.ensureLoaded();
    for (const e of this.entries.slice()) await this.remove(e.slot);
    this.entries = [];
    this.flushIndex();
  }

  /** Total bytes across every known save. Drives an "out of room" warning. */
  totalBytes(): number {
    this.ensureLoaded();
    let n = 0;
    for (const e of this.entries) n += e.meta.byteLength;
    return n;
  }
}

function quotaLike(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const name = (err as { name?: unknown }).name;
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED';
}

function describe(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
