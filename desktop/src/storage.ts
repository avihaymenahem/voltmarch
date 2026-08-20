/**
 * Native, filesystem-backed persistence for the Electron target.
 *
 * Renderer code sees a narrow key/value and save-blob capability through the
 * preload.  Paths never cross IPC: the main process owns one directory under
 * Electron's `userData`, validates every key/slot, and derives save filenames
 * from base64url rather than accepting path fragments from the renderer.
 */

import path from 'node:path';
import {
  mkdirSync, readFileSync, renameSync, rmSync, writeFileSync,
} from 'node:fs';

const STATE_VERSION = 1;
const MAX_KEY = 256;
const MAX_VALUE_BYTES = 16 * 1024 * 1024;
const MAX_SLOT = 128;
const MAX_SAVE_BYTES = 256 * 1024 * 1024;

interface StateFile {
  version: number;
  values: Record<string, string>;
}

function missing(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'ENOENT';
}

function assertKey(key: unknown): asserts key is string {
  if (typeof key !== 'string' || key.length < 1 || key.length > MAX_KEY) {
    throw new Error('Invalid storage key.');
  }
}

function assertValue(value: unknown): asserts value is string {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > MAX_VALUE_BYTES) {
    throw new Error('Invalid storage value.');
  }
}

function assertSlot(slot: unknown): asserts slot is string {
  if (typeof slot !== 'string' || slot.length < 1 || slot.length > MAX_SLOT) {
    throw new Error('Invalid save slot.');
  }
}

export class NativeStorage {
  private readonly statePath: string;
  private readonly saveDir: string;
  private loaded = false;
  private values: Record<string, string> = Object.create(null) as Record<string, string>;

  constructor(private readonly root: string) {
    this.statePath = path.join(root, 'state.json');
    this.saveDir = path.join(root, 'saves');
  }

  private ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const parsed = JSON.parse(readFileSync(this.statePath, 'utf8')) as Partial<StateFile>;
      if (parsed.version !== STATE_VERSION || typeof parsed.values !== 'object' || parsed.values === null) return;
      for (const [key, value] of Object.entries(parsed.values)) {
        if (typeof value === 'string' && key.length > 0 && key.length <= MAX_KEY) this.values[key] = value;
      }
    } catch (err) {
      if (!missing(err)) console.warn('[vm] native state was unreadable; starting with an empty store');
    }
  }

  private flush(): void {
    mkdirSync(this.root, { recursive: true });
    const tmp = `${this.statePath}.tmp`;
    const file: StateFile = { version: STATE_VERSION, values: this.values };
    writeFileSync(tmp, JSON.stringify(file, null, 2), 'utf8');
    renameSync(tmp, this.statePath);
  }

  getItem(key: unknown): string | null {
    assertKey(key);
    this.ensureLoaded();
    const value = this.values[key];
    return typeof value === 'string' ? value : null;
  }

  setItem(key: unknown, value: unknown): void {
    assertKey(key);
    assertValue(value);
    this.ensureLoaded();
    this.values[key] = value;
    this.flush();
  }

  removeItem(key: unknown): void {
    assertKey(key);
    this.ensureLoaded();
    if (!Object.prototype.hasOwnProperty.call(this.values, key)) return;
    delete this.values[key];
    this.flush();
  }

  private savePath(slot: unknown): string {
    assertSlot(slot);
    const name = Buffer.from(slot, 'utf8').toString('base64url');
    return path.join(this.saveDir, `${name}.vms`);
  }

  writeSave(slot: unknown, bytes: unknown): void {
    const target = this.savePath(slot);
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_SAVE_BYTES) {
      throw new Error('Invalid save payload.');
    }
    mkdirSync(this.saveDir, { recursive: true });
    const tmp = `${target}.tmp`;
    writeFileSync(tmp, bytes);
    renameSync(tmp, target);
  }

  readSave(slot: unknown): Uint8Array | null {
    const target = this.savePath(slot);
    try {
      return new Uint8Array(readFileSync(target));
    } catch (err) {
      if (missing(err)) return null;
      throw err;
    }
  }

  removeSave(slot: unknown): void {
    rmSync(this.savePath(slot), { force: true });
  }
}
