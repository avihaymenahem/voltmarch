/**
 * Opt-in wall-clock boot telemetry for the built browser and desktop game.
 *
 * This module is deliberately dependency-free and inert unless
 * `?bootprofile=1` is present. It observes presentation work only: no value it
 * records is read by simulation, no callbacks are delayed, and it emits no
 * console or user-facing output. The boot profiler reads the bounded snapshot
 * through the existing `__VM.hooks` diagnostic seam.
 */

export type BootPhaseCategory =
  | 'app'
  | 'network'
  | 'gltf'
  | 'conditioning'
  | 'texture'
  | 'gpu'
  | 'registry';

export type BootDetailValue = string | number | boolean | null;
export type BootDetails = Readonly<Record<string, BootDetailValue>>;

export interface BootMark {
  readonly runId: number | null;
  readonly category: BootPhaseCategory;
  readonly name: string;
  readonly atMs: number;
  readonly detail?: BootDetails;
}

export interface BootSpan extends BootMark {
  readonly durationMs: number;
  readonly status: 'ok' | 'error';
}

export interface BootLongTask {
  readonly runId: number | null;
  readonly startMs: number;
  readonly durationMs: number;
}

export interface BootResourceTiming {
  /** Same-origin path only; origins and credentials are intentionally omitted. */
  readonly path: string;
  readonly protocol: string;
  readonly initiatorType: string;
  readonly startMs: number;
  readonly durationMs: number;
  readonly fetchStartMs: number;
  readonly requestStartMs: number;
  readonly responseStartMs: number;
  readonly responseEndMs: number;
  readonly transferSize: number;
  readonly encodedBodySize: number;
  readonly decodedBodySize: number;
  readonly serverTiming: readonly { name: string; durationMs: number }[];
}

export interface BootNavigationTiming {
  readonly durationMs: number;
  readonly domInteractiveMs: number;
  readonly domContentLoadedMs: number;
  readonly loadEventMs: number;
  readonly transferSize: number;
  readonly encodedBodySize: number;
  readonly decodedBodySize: number;
}

export interface BootRun {
  readonly id: number;
  readonly startedAtMs: number;
  readonly context: BootDetails;
}

export interface BootTelemetryReport {
  readonly schema: 1;
  readonly enabled: boolean;
  readonly timeOrigin: number;
  readonly capturedAtMs: number;
  readonly runs: readonly BootRun[];
  readonly marks: readonly BootMark[];
  readonly spans: readonly BootSpan[];
  readonly resources: readonly BootResourceTiming[];
  readonly navigation: BootNavigationTiming | null;
  readonly longTasks: {
    readonly supported: boolean;
    readonly entries: readonly BootLongTask[];
  };
  readonly truncated: {
    readonly marks: boolean;
    readonly spans: boolean;
    readonly longTasks: boolean;
    readonly resources: boolean;
    readonly runs: boolean;
  };
}

interface PerformanceLike {
  readonly timeOrigin?: number;
  now(): number;
  getEntriesByType?(type: string): PerformanceEntry[];
  setResourceTimingBufferSize?(size: number): void;
}

const MARK_LIMIT = 256;
const RUN_LIMIT = 64;
const SPAN_LIMIT = 1_024;
const LONG_TASK_LIMIT = 512;
const RESOURCE_LIMIT = 2_000;
const NOOP_FINISH = (): void => undefined;

function cloneDetails(detail: BootDetails | undefined): BootDetails | undefined {
  return detail === undefined ? undefined : { ...detail };
}

function assetPath(raw: string, baseUrl: string): { path: string; protocol: string } {
  try {
    const url = new URL(raw, baseUrl);
    return {
      // Query parameters can contain signed URLs or session tokens. Asset
      // identity is the path; profiling must not export credentials.
      path: url.pathname,
      protocol: url.protocol.replace(/:$/, ''),
    };
  } catch {
    const colon = raw.indexOf(':');
    return {
      path: raw.split(/[?#]/, 1)[0].slice(0, 240),
      protocol: colon > 0 ? raw.slice(0, colon) : 'unknown',
    };
  }
}

export class BootTelemetryRecorder {
  private readonly runs: BootRun[] = [];
  private currentRunId: number | null = null;
  private readonly marks: BootMark[] = [];
  private readonly spans: BootSpan[] = [];
  private readonly longTasks: BootLongTask[] = [];
  private marksTruncated = false;
  private runsTruncated = false;
  private spansTruncated = false;
  private longTasksTruncated = false;
  private longTaskSupported = false;

  constructor(
    readonly enabled: boolean,
    private readonly perf: PerformanceLike,
    private readonly baseUrl = 'http://voltmarch.invalid/',
  ) {
    if (enabled) perf.setResourceTimingBufferSize?.(RESOURCE_LIMIT);
  }

  mark(category: BootPhaseCategory, name: string, detail?: BootDetails): void {
    if (!this.enabled) return;
    if (this.marks.length >= MARK_LIMIT) {
      this.marksTruncated = true;
      return;
    }
    this.marks.push({
      runId: this.currentRunId,
      category,
      name,
      atMs: this.perf.now(),
      detail: cloneDetails(detail),
    });
  }

  beginRun(context: BootDetails): number {
    if (!this.enabled) return 0;
    if (this.runs.length >= RUN_LIMIT) {
      this.runsTruncated = true;
      this.currentRunId = null;
      return 0;
    }
    const id = this.runs.length + 1;
    this.currentRunId = id;
    this.runs.push({
      id,
      startedAtMs: this.perf.now(),
      context: {
        pageBootIndex: id,
        processState: id === 1 ? 'fresh-page' : 'same-page-rebootstrap',
        ...cloneDetails(context),
      },
    });
    return id;
  }

  annotateRun(detail: BootDetails): void {
    if (!this.enabled || this.currentRunId === null) return;
    const index = this.currentRunId - 1;
    const run = this.runs[index];
    if (run === undefined) return;
    this.runs[index] = { ...run, context: { ...run.context, ...detail } };
  }

  beginSpan(
    category: BootPhaseCategory,
    name: string,
    detail?: BootDetails,
  ): (status?: 'ok' | 'error', completionDetail?: BootDetails) => void {
    if (!this.enabled) return NOOP_FINISH;
    const started = this.perf.now();
    const runId = this.currentRunId;
    let ended = false;
    return (status = 'ok', completionDetail) => {
      if (ended) return;
      ended = true;
      if (this.spans.length >= SPAN_LIMIT) {
        this.spansTruncated = true;
        return;
      }
      this.spans.push({
        runId,
        category,
        name,
        atMs: started,
        durationMs: Math.max(0, this.perf.now() - started),
        status,
        detail: cloneDetails({ ...detail, ...completionDetail }),
      });
    };
  }

  setLongTaskSupported(supported: boolean): void {
    if (this.enabled) this.longTaskSupported = supported;
  }

  recordLongTask(entry: Pick<PerformanceEntry, 'startTime' | 'duration'>): void {
    if (!this.enabled) return;
    if (this.longTasks.length >= LONG_TASK_LIMIT) {
      this.longTasksTruncated = true;
      return;
    }
    this.longTasks.push({
      runId: this.currentRunId,
      startMs: entry.startTime,
      durationMs: entry.duration,
    });
  }

  report(): BootTelemetryReport {
    const resourceEntries = this.enabled
      ? (this.perf.getEntriesByType?.('resource') ?? []).slice(0, RESOURCE_LIMIT)
      : [];
    const resources = resourceEntries.map((entry) => this.resource(entry));
    const navigationEntry = this.enabled
      ? this.perf.getEntriesByType?.('navigation')?.[0]
      : undefined;
    return {
      schema: 1,
      enabled: this.enabled,
      timeOrigin: this.perf.timeOrigin ?? 0,
      capturedAtMs: this.perf.now(),
      runs: this.runs.map((run) => ({ ...run, context: cloneDetails(run.context) ?? {} })),
      marks: this.marks.map((mark) => ({ ...mark, detail: cloneDetails(mark.detail) })),
      spans: this.spans.map((span) => ({ ...span, detail: cloneDetails(span.detail) })),
      resources,
      navigation: navigationEntry === undefined ? null : this.navigation(navigationEntry),
      longTasks: {
        supported: this.longTaskSupported,
        entries: this.longTasks.map((entry) => ({ ...entry })),
      },
      truncated: {
        marks: this.marksTruncated,
        spans: this.spansTruncated,
        longTasks: this.longTasksTruncated,
        resources: resourceEntries.length >= RESOURCE_LIMIT,
        runs: this.runsTruncated,
      },
    };
  }

  private resource(entry: PerformanceEntry): BootResourceTiming {
    const resource = entry as PerformanceResourceTiming;
    const location = assetPath(entry.name, this.baseUrl);
    const serverTiming = Array.from(resource.serverTiming ?? []).map((timing) => ({
      name: timing.name,
      durationMs: timing.duration,
    }));
    return {
      path: location.path,
      protocol: location.protocol,
      initiatorType: resource.initiatorType ?? '',
      startMs: entry.startTime,
      durationMs: entry.duration,
      fetchStartMs: resource.fetchStart ?? 0,
      requestStartMs: resource.requestStart ?? 0,
      responseStartMs: resource.responseStart ?? 0,
      responseEndMs: resource.responseEnd ?? 0,
      transferSize: resource.transferSize ?? 0,
      encodedBodySize: resource.encodedBodySize ?? 0,
      decodedBodySize: resource.decodedBodySize ?? 0,
      serverTiming,
    };
  }

  private navigation(entry: PerformanceEntry): BootNavigationTiming {
    const navigation = entry as PerformanceNavigationTiming;
    return {
      durationMs: entry.duration,
      domInteractiveMs: navigation.domInteractive ?? 0,
      domContentLoadedMs: navigation.domContentLoadedEventEnd ?? 0,
      loadEventMs: navigation.loadEventEnd ?? 0,
      transferSize: navigation.transferSize ?? 0,
      encodedBodySize: navigation.encodedBodySize ?? 0,
      decodedBodySize: navigation.decodedBodySize ?? 0,
    };
  }
}

function profilingRequested(): boolean {
  if (typeof location === 'undefined') return false;
  const query = new URLSearchParams(location.search);
  if (!query.has('bootprofile')) return false;
  const value = query.get('bootprofile');
  return value === null || value === '' || value === '1' || value === 'true';
}

const fallbackPerformance: PerformanceLike = {
  timeOrigin: 0,
  now: () => 0,
  getEntriesByType: () => [],
};
const runtimePerformance: PerformanceLike =
  typeof performance === 'undefined' ? fallbackPerformance : performance;
const recorder = new BootTelemetryRecorder(
  profilingRequested(),
  runtimePerformance,
  typeof location === 'undefined' ? 'http://voltmarch.invalid/' : location.href,
);

let longTaskObserver: PerformanceObserver | null = null;
if (recorder.enabled && typeof PerformanceObserver === 'function') {
  try {
    longTaskObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) recorder.recordLongTask(entry);
    });
    longTaskObserver.observe({ type: 'longtask', buffered: true });
    recorder.setLongTaskSupported(true);
  } catch {
    try {
      longTaskObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) recorder.recordLongTask(entry);
      });
      longTaskObserver.observe({ entryTypes: ['longtask'] });
      recorder.setLongTaskSupported(true);
    } catch {
      longTaskObserver = null;
    }
  }
}

recorder.mark('app', 'entry-module');

export const bootTelemetryEnabled = (): boolean => recorder.enabled;
export const bootAssetLabel = (raw: string): string => assetPath(
  raw,
  typeof location === 'undefined' ? 'http://voltmarch.invalid/' : location.href,
).path;
export const beginBootRun = (context: BootDetails): number => recorder.beginRun(context);
export const annotateBootRun = (detail: BootDetails): void => recorder.annotateRun(detail);
export const markBootPhase = (
  category: BootPhaseCategory,
  name: string,
  detail?: BootDetails,
): void => recorder.mark(category, name, detail);
export const beginBootSpan = (
  category: BootPhaseCategory,
  name: string,
  detail?: BootDetails,
): ((status?: 'ok' | 'error', completionDetail?: BootDetails) => void) =>
  recorder.beginSpan(category, name, detail);
export const bootTelemetryReport = (): BootTelemetryReport => recorder.report();
