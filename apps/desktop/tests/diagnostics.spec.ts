import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

import { DesktopDiagnosticStore } from '../src/diagnostics';

function rendererEvent(sequence: number, detail?: unknown): Record<string, unknown> {
  return {
    schema: 1,
    sessionId: 'renderer-test',
    sequence,
    wallTime: '2026-09-01T00:00:00.000Z',
    monotonicMs: sequence,
    process: 'renderer',
    level: 'error',
    subsystem: 'test',
    code: `event-${sequence}`,
    message: `event ${sequence}`,
    detail,
  };
}

describe('desktop diagnostic store', () => {
  it('persists renderer and host failures across store instances', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'voltmarch-diagnostics-'));
    try {
      const store = new DesktopDiagnosticStore(root);
      expect(store.recordRenderer(rendererEvent(1))).toBe(true);
      expect(store.recordHost('fatal', 'electron', 'renderer-gone', 'Renderer exited', { exitCode: 9 })).toBe(true);
      const restored = new DesktopDiagnosticStore(root).readRecent(10) as Array<Record<string, unknown>>;
      expect(restored.map((row) => row.code)).toEqual(['event-1', 'renderer-gone']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects malformed renderer input and redacts secrets and user paths', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'voltmarch-diagnostics-'));
    try {
      const store = new DesktopDiagnosticStore(root);
      expect(store.recordRenderer({ level: 'error' })).toBe(false);
      store.recordRenderer(rendererEvent(2, {
        apiToken: 'private',
        url: 'https://example.invalid/?relay=private',
        path: 'C:\\Users\\Administrator\\project\\file.ts',
      }));
      const text = JSON.stringify(store.readRecent(10));
      expect(text).not.toContain('private');
      expect(text).not.toContain('Administrator');
      expect(text).toContain('[redacted]');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rotates bounded JSONL files while preserving newest ordering', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'voltmarch-diagnostics-'));
    try {
      const store = new DesktopDiagnosticStore(root, { maxFileBytes: 4_096, retainedFiles: 3 });
      for (let i = 0; i < 80; i++) store.recordRenderer(rendererEvent(i, 'x'.repeat(180)));
      const recent = store.readRecent(8) as Array<Record<string, unknown>>;
      expect(recent.map((row) => row.sequence)).toEqual([72, 73, 74, 75, 76, 77, 78, 79]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
