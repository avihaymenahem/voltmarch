/**
 * Always-on, bounded diagnostics for the browser renderer.
 *
 * This is deliberately dependency-free so it can be installed before the
 * shell, renderer, workers, or simulation exist. It records events only when
 * something noteworthy happens; there is no per-frame work.
 */

export type DiagnosticLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface DiagnosticRecord {
  readonly schema: 1;
  readonly sessionId: string;
  readonly sequence: number;
  readonly wallTime: string;
  readonly monotonicMs: number;
  readonly process: 'renderer' | 'main' | 'gpu' | 'utility';
  readonly level: DiagnosticLevel;
  readonly subsystem: string;
  readonly code: string;
  readonly message: string;
  readonly context?: Readonly<Record<string, unknown>>;
  readonly detail?: unknown;
}

type ContextProvider = () => Readonly<Record<string, unknown>> | null;
type DiagnosticSink = (record: DiagnosticRecord) => void;

const DEFAULT_CAPACITY = 512;
const MAX_STRING = 4_096;
const MAX_STACK = 16_384;
const MAX_KEYS = 48;
const MAX_ARRAY = 48;
const MAX_DEPTH = 5;
const SECRET_KEY = /(?:authorization|cookie|password|passwd|secret|token|api[-_]?key|webhook|relay)/i;
const URL_SECRET = /([?&](?:authorization|password|secret|token|api[-_]?key|webhook|relay)=)[^&#\s]*/gi;
const WINDOWS_HOME = /[A-Za-z]:\\Users\\[^\\\s]+/gi;
const UNIX_HOME = /\/(?:home|Users)\/[^/\s]+/g;

function bounded(text: string, max = MAX_STRING): string {
  const clean = text.replace(URL_SECRET, '$1[redacted]')
    .replace(WINDOWS_HOME, '[user-home]')
    .replace(UNIX_HOME, '[user-home]');
  return clean.length <= max ? clean : `${clean.slice(0, max)}…[truncated]`;
}

function errorValue(
  error: Error,
  depth: number,
  seen: WeakSet<object>,
): Readonly<Record<string, unknown>> {
  return {
    name: bounded(error.name, 160),
    message: bounded(error.message),
    ...(typeof error.stack === 'string' ? { stack: bounded(error.stack, MAX_STACK) } : {}),
    ...('cause' in error && error.cause !== undefined
      ? { cause: sanitiseDiagnostic(error.cause, depth + 1, seen) }
      : {}),
  };
}

/** Convert arbitrary thrown/console values to bounded, secret-free plain data. */
export function sanitiseDiagnostic(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined || typeof value === 'boolean') return value ?? null;
  if (typeof value === 'string') return bounded(value);
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value === 'bigint') return `${value.toString()}n`;
  if (typeof value === 'symbol' || typeof value === 'function') return bounded(String(value));
  if (depth >= MAX_DEPTH) return '[depth-limit]';
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  if (value instanceof Error) return errorValue(value, depth, seen);

  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY).map((item) => sanitiseDiagnostic(item, depth + 1, seen));
  }

  const output: Record<string, unknown> = {};
  let count = 0;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (count++ >= MAX_KEYS) {
      output.__truncated = true;
      break;
    }
    output[bounded(key, 160)] = SECRET_KEY.test(key)
      ? '[redacted]'
      : sanitiseDiagnostic(item, depth + 1, seen);
  }
  return output;
}

function newSessionId(): string {
  const cryptoObject = globalThis.crypto;
  if (cryptoObject && typeof cryptoObject.randomUUID === 'function') return cryptoObject.randomUUID();
  return `renderer-${Date.now().toString(36)}-${Math.floor(Math.random() * 0x1000000).toString(36)}`;
}

export class DiagnosticJournal {
  private readonly records: Array<DiagnosticRecord | undefined>;
  private head = 0;
  private size = 0;
  private sequence = 0;
  private contextProvider: ContextProvider | null = null;
  private sink: DiagnosticSink | null = null;

  constructor(
    private readonly capacity = DEFAULT_CAPACITY,
    private readonly sessionId = newSessionId(),
    private readonly wallNow: () => Date = () => new Date(),
    private readonly monotonicNow: () => number = () => globalThis.performance?.now?.() ?? 0,
  ) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError('Diagnostic capacity must be positive.');
    this.records = new Array<DiagnosticRecord | undefined>(capacity);
  }

  setContextProvider(provider: ContextProvider | null): void { this.contextProvider = provider; }
  setSink(sink: DiagnosticSink | null): void { this.sink = sink; }

  emit(
    level: DiagnosticLevel,
    subsystem: string,
    code: string,
    message: string,
    detail?: unknown,
  ): DiagnosticRecord {
    let context: Readonly<Record<string, unknown>> | null = null;
    try { context = this.contextProvider?.() ?? null; } catch { /* diagnostics must never crash the game */ }
    const record: DiagnosticRecord = {
      schema: 1,
      sessionId: bounded(this.sessionId, 160),
      sequence: ++this.sequence,
      wallTime: this.wallNow().toISOString(),
      monotonicMs: Math.max(0, Math.round(this.monotonicNow() * 10) / 10),
      process: 'renderer',
      level,
      subsystem: bounded(subsystem, 160),
      code: bounded(code, 160),
      message: bounded(message),
      ...(context === null ? {} : { context: sanitiseDiagnostic(context) as Readonly<Record<string, unknown>> }),
      ...(detail === undefined ? {} : { detail: sanitiseDiagnostic(detail) }),
    };
    this.records[this.head] = record;
    this.head = (this.head + 1) % this.capacity;
    this.size = Math.min(this.size + 1, this.capacity);
    try { this.sink?.(record); } catch { /* a broken host bridge is not a second failure */ }
    return record;
  }

  snapshot(limit = this.size): readonly DiagnosticRecord[] {
    const take = Math.max(0, Math.min(this.size, Math.floor(limit)));
    const result: DiagnosticRecord[] = [];
    const start = (this.head - take + this.capacity) % this.capacity;
    for (let i = 0; i < take; i++) {
      const record = this.records[(start + i) % this.capacity];
      if (record !== undefined) result.push(record);
    }
    return result;
  }
}

interface GlobalDiagnosticState {
  readonly journal: DiagnosticJournal;
  persistedRecords: DiagnosticRecord[];
  installed: boolean;
}

const diagnosticHost = globalThis as typeof globalThis & { __vmDiagnosticState?: GlobalDiagnosticState };
const diagnosticState = diagnosticHost.__vmDiagnosticState ?? {
  journal: new DiagnosticJournal(),
  persistedRecords: [],
  installed: false,
};
diagnosticHost.__vmDiagnosticState = diagnosticState;
const journal = diagnosticState.journal;

export function logDiagnostic(
  level: DiagnosticLevel,
  subsystem: string,
  code: string,
  message: string,
  detail?: unknown,
): DiagnosticRecord {
  return journal.emit(level, subsystem, code, message, detail);
}

export function diagnosticSnapshot(limit = DEFAULT_CAPACITY): readonly DiagnosticRecord[] {
  const wanted = Math.max(0, Math.floor(limit));
  if (wanted === 0) return [];
  return [...diagnosticState.persistedRecords, ...journal.snapshot()].slice(-wanted);
}

export function setDiagnosticContextProvider(provider: ContextProvider | null): void {
  journal.setContextProvider(provider);
}

function consoleMessage(args: readonly unknown[]): string {
  return args.map((value) => {
    if (typeof value === 'string') return value;
    if (value instanceof Error) return `${value.name}: ${value.message}`;
    try { return JSON.stringify(sanitiseDiagnostic(value)); } catch { return String(value); }
  }).join(' ');
}

/** Install global browser capture once. Safe to call from Vite HMR. */
export function installGlobalDiagnostics(): void {
  if (diagnosticState.installed) return;
  diagnosticState.installed = true;

  const bridge = (globalThis as {
    voltmarch?: {
      diagnosticWrite?: (record: DiagnosticRecord) => void;
      diagnosticRead?: (limit?: number) => Promise<readonly unknown[]>;
    };
  }).voltmarch;
  if (typeof bridge?.diagnosticWrite === 'function') {
    journal.setSink((record) => bridge.diagnosticWrite?.(record));
  }
  if (typeof bridge?.diagnosticRead === 'function') {
    const hydrate = (): void => { void bridge.diagnosticRead?.(256).then((records) => {
      const restored: DiagnosticRecord[] = [];
      for (const value of records.slice(-256)) {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) continue;
        const row = sanitiseDiagnostic(value) as Record<string, unknown>;
        const level = row.level;
        const processName = row.process;
        if (row.schema !== 1
          || typeof row.sessionId !== 'string'
          || typeof row.sequence !== 'number'
          || typeof row.wallTime !== 'string'
          || typeof level !== 'string'
          || !['debug', 'info', 'warn', 'error', 'fatal'].includes(level)
          || typeof processName !== 'string'
          || !['renderer', 'main', 'gpu', 'utility'].includes(processName)
          || typeof row.subsystem !== 'string'
          || typeof row.code !== 'string'
          || typeof row.message !== 'string') continue;
        restored.push(row as unknown as DiagnosticRecord);
      }
      diagnosticState.persistedRecords = restored;
    }).catch(() => { /* current-session capture still works without history */ }); };
    // Previous-session history is support data, never a first-paint dependency.
    // Let asset/shader boot have the disk and main process first.
    if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(hydrate, { timeout: 10_000 });
    } else if (typeof window !== 'undefined') {
      window.setTimeout(hydrate, 5_000);
    }
  }

  const originalWarn = console.warn.bind(console);
  const originalError = console.error.bind(console);
  console.warn = (...args: unknown[]): void => {
    journal.emit('warn', 'console', 'console.warn', consoleMessage(args), {
      arguments: args,
      callsite: new Error('console.warn callsite').stack,
    });
    originalWarn(...args);
  };
  console.error = (...args: unknown[]): void => {
    journal.emit('error', 'console', 'console.error', consoleMessage(args), {
      arguments: args,
      callsite: new Error('console.error callsite').stack,
    });
    originalError(...args);
  };

  if (typeof window === 'undefined') return;
  window.addEventListener('error', (event) => {
    journal.emit('fatal', 'browser', 'window.error', event.message || 'Uncaught browser error', {
      filename: event.filename,
      line: event.lineno,
      column: event.colno,
      error: event.error,
    });
  });
  window.addEventListener('unhandledrejection', (event) => {
    journal.emit('fatal', 'browser', 'unhandled-rejection', 'Unhandled promise rejection', event.reason);
  });
  window.addEventListener('securitypolicyviolation', (event) => {
    journal.emit('warn', 'browser', 'csp-violation', `Blocked ${event.violatedDirective}`, {
      blockedURI: event.blockedURI,
      sourceFile: event.sourceFile,
      line: event.lineNumber,
    });
  });
  journal.emit('info', 'boot', 'diagnostics-ready', 'Renderer diagnostics installed');
}
