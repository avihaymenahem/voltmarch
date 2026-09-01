/** Durable, bounded diagnostics owned by the Electron main process. */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import path from 'node:path';

export type DesktopDiagnosticLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

const LEVELS = new Set<DesktopDiagnosticLevel>(['debug', 'info', 'warn', 'error', 'fatal']);
const SECRET_KEY = /(?:authorization|cookie|password|passwd|secret|token|api[-_]?key|webhook|relay)/i;
const URL_SECRET = /([?&](?:authorization|password|secret|token|api[-_]?key|webhook|relay)=)[^&#\s]*/gi;
const WINDOWS_HOME = /[A-Za-z]:\\Users\\[^\\\s]+/gi;
const UNIX_HOME = /\/(?:home|Users)\/[^/\s]+/g;
const MAX_RECORD_BYTES = 32 * 1024;
const MAX_DEPTH = 5;
const MAX_KEYS = 48;
const MAX_ARRAY = 48;

function text(value: unknown, max = 4_096): string {
  const raw = typeof value === 'string' ? value : String(value);
  const clean = raw.replace(URL_SECRET, '$1[redacted]')
    .replace(WINDOWS_HOME, '[user-home]')
    .replace(UNIX_HOME, '[user-home]');
  return clean.length <= max ? clean : `${clean.slice(0, max)}…[truncated]`;
}

export function sanitiseDesktopDiagnostic(
  value: unknown,
  depth = 0,
  seen = new WeakSet<object>(),
): unknown {
  if (value === null || value === undefined || typeof value === 'boolean') return value ?? null;
  if (typeof value === 'string') return text(value);
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value === 'bigint') return `${value.toString()}n`;
  if (typeof value === 'symbol' || typeof value === 'function') return text(value);
  if (depth >= MAX_DEPTH) return '[depth-limit]';
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  if (value instanceof Error) {
    return {
      name: text(value.name, 160),
      message: text(value.message),
      ...(typeof value.stack === 'string' ? { stack: text(value.stack, 16_384) } : {}),
      ...('cause' in value && value.cause !== undefined
        ? { cause: sanitiseDesktopDiagnostic(value.cause, depth + 1, seen) }
        : {}),
    };
  }
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY).map((item) => sanitiseDesktopDiagnostic(item, depth + 1, seen));
  }
  const result: Record<string, unknown> = {};
  let count = 0;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (count++ >= MAX_KEYS) {
      result.__truncated = true;
      break;
    }
    result[text(key, 160)] = SECRET_KEY.test(key)
      ? '[redacted]'
      : sanitiseDesktopDiagnostic(item, depth + 1, seen);
  }
  return result;
}

function safeField(input: Record<string, unknown>, key: string, fallback: string, max = 160): string {
  return typeof input[key] === 'string' ? text(input[key], max) : fallback;
}

function normaliseRendererRecord(input: unknown): Readonly<Record<string, unknown>> | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null;
  const row = input as Record<string, unknown>;
  const level = row.level;
  if (row.schema !== 1 || typeof level !== 'string' || !LEVELS.has(level as DesktopDiagnosticLevel)) return null;
  const sequence = typeof row.sequence === 'number' && Number.isSafeInteger(row.sequence)
    ? Math.max(0, row.sequence)
    : 0;
  const monotonicMs = typeof row.monotonicMs === 'number' && Number.isFinite(row.monotonicMs)
    ? Math.max(0, row.monotonicMs)
    : 0;
  return {
    schema: 1,
    sessionId: safeField(row, 'sessionId', 'renderer-unknown'),
    sequence,
    wallTime: safeField(row, 'wallTime', new Date().toISOString()),
    monotonicMs,
    process: 'renderer',
    level,
    subsystem: safeField(row, 'subsystem', 'renderer'),
    code: safeField(row, 'code', 'unknown'),
    message: safeField(row, 'message', 'Renderer diagnostic event', 4_096),
    receivedAt: new Date().toISOString(),
    ...(row.context === undefined ? {} : { context: sanitiseDesktopDiagnostic(row.context) }),
    ...(row.detail === undefined ? {} : { detail: sanitiseDesktopDiagnostic(row.detail) }),
  };
}

export interface DesktopDiagnosticStoreOptions {
  readonly maxFileBytes?: number;
  readonly retainedFiles?: number;
}

export class DesktopDiagnosticStore {
  private readonly directory: string;
  private readonly currentFile: string;
  private readonly maxFileBytes: number;
  private readonly retainedFiles: number;
  private hostSequence = 0;
  private readonly recentMessages = new Map<string, number>();
  private readonly hostSession = `desktop-${Date.now().toString(36)}-${process.pid}`;

  constructor(userDataDirectory: string, options: DesktopDiagnosticStoreOptions = {}) {
    this.directory = path.join(path.resolve(userDataDirectory), 'diagnostics');
    this.currentFile = path.join(this.directory, 'events.jsonl');
    this.maxFileBytes = Math.max(4_096, options.maxFileBytes ?? 2 * 1024 * 1024);
    this.retainedFiles = Math.max(2, Math.min(10, options.retainedFiles ?? 4));
  }

  recordRenderer(input: unknown): boolean {
    const record = normaliseRendererRecord(input);
    return record !== null && this.append(record);
  }

  recordHost(
    level: DesktopDiagnosticLevel,
    subsystem: string,
    code: string,
    message: string,
    detail?: unknown,
  ): boolean {
    return this.append({
      schema: 1,
      sessionId: this.hostSession,
      sequence: ++this.hostSequence,
      wallTime: new Date().toISOString(),
      monotonicMs: Math.round(performance.now() * 10) / 10,
      process: 'main',
      level,
      subsystem: text(subsystem, 160),
      code: text(code, 160),
      message: text(message),
      ...(detail === undefined ? {} : { detail: sanitiseDesktopDiagnostic(detail) }),
    });
  }

  readRecent(limit = 200): readonly unknown[] {
    const wanted = Math.max(0, Math.min(1_000, Math.floor(limit)));
    if (wanted === 0) return [];
    const rows: unknown[] = [];
    const files: string[] = [];
    for (let i = this.retainedFiles - 1; i >= 1; i--) files.push(this.rotatedFile(i));
    files.push(this.currentFile);
    for (const file of files) {
      if (!existsSync(file)) continue;
      let contents = '';
      try { contents = readFileSync(file, 'utf8'); } catch { continue; }
      for (const line of contents.split('\n')) {
        if (line === '') continue;
        try { rows.push(JSON.parse(line) as unknown); } catch { /* ignore a partial crash-tail line */ }
      }
    }
    return rows.slice(-wanted);
  }

  private append(record: Readonly<Record<string, unknown>>): boolean {
    const fingerprint = `${String(record.level)}|${String(record.message)}`;
    const now = Date.now();
    const previous = this.recentMessages.get(fingerprint);
    if (previous !== undefined && now - previous < 750) return true;
    this.recentMessages.set(fingerprint, now);
    if (this.recentMessages.size > 64) {
      const oldest = this.recentMessages.keys().next().value as string | undefined;
      if (oldest !== undefined) this.recentMessages.delete(oldest);
    }
    let line = `${JSON.stringify(record)}\n`;
    if (Buffer.byteLength(line, 'utf8') > MAX_RECORD_BYTES) {
      const compact = {
        schema: 1,
        sessionId: record.sessionId,
        sequence: record.sequence,
        wallTime: record.wallTime,
        process: record.process,
        level: record.level,
        subsystem: record.subsystem,
        code: record.code,
        message: text(record.message, 8_192),
        detail: '[record-size-limit]',
      };
      line = `${JSON.stringify(compact)}\n`;
    }
    try {
      mkdirSync(this.directory, { recursive: true });
      const size = existsSync(this.currentFile) ? statSync(this.currentFile).size : 0;
      if (size > 0 && size + Buffer.byteLength(line, 'utf8') > this.maxFileBytes) this.rotate();
      appendFileSync(this.currentFile, line, 'utf8');
      return true;
    } catch {
      // Logging is a safety net. A read-only/full disk may remove the net, but
      // it must never become the reason the application fails.
      return false;
    }
  }

  private rotatedFile(index: number): string {
    return path.join(this.directory, `events.${index}.jsonl`);
  }

  private rotate(): void {
    const oldest = this.rotatedFile(this.retainedFiles - 1);
    if (existsSync(oldest)) rmSync(oldest, { force: true });
    for (let i = this.retainedFiles - 1; i > 1; i--) {
      const source = this.rotatedFile(i - 1);
      if (existsSync(source)) renameSync(source, this.rotatedFile(i));
    }
    if (existsSync(this.currentFile)) renameSync(this.currentFile, this.rotatedFile(1));
  }
}
