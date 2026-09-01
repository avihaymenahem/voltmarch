import { describe, expect, it } from 'vitest';

import { DiagnosticJournal, sanitiseDiagnostic } from '../src/core/diagnostic-log';

describe('diagnostic journal', () => {
  it('keeps the newest records in chronological order', () => {
    let mono = 0;
    const journal = new DiagnosticJournal(3, 'test-session', () => new Date('2026-09-01T00:00:00Z'), () => ++mono);
    journal.emit('info', 'boot', 'one', 'one');
    journal.emit('warn', 'worker', 'two', 'two');
    journal.emit('error', 'gpu', 'three', 'three');
    journal.emit('fatal', 'browser', 'four', 'four');

    expect(journal.snapshot().map((record) => record.code)).toEqual(['two', 'three', 'four']);
    expect(journal.snapshot(2).map((record) => record.sequence)).toEqual([3, 4]);
  });

  it('redacts secrets, user paths, cycles, and unbounded payloads', () => {
    const cyclic: Record<string, unknown> = {
      token: 'should-not-leak',
      url: 'https://example.invalid/?relay=abc&mode=play',
      path: 'C:\\Users\\Administrator\\projects\\voltmarch\\file.ts',
      values: Array.from({ length: 100 }, (_, i) => i),
    };
    cyclic.self = cyclic;
    const text = JSON.stringify(sanitiseDiagnostic(cyclic));

    expect(text).not.toContain('should-not-leak');
    expect(text).not.toContain('Administrator');
    expect(text).not.toContain('relay=abc');
    expect(text).toContain('[redacted]');
    expect(text).toContain('[circular]');
    expect((sanitiseDiagnostic(cyclic) as { values: unknown[] }).values).toHaveLength(48);
  });

  it('never lets a context provider or sink failure escape', () => {
    const journal = new DiagnosticJournal(4, 'safe');
    journal.setContextProvider(() => { throw new Error('context failed'); });
    journal.setSink(() => { throw new Error('sink failed'); });
    expect(() => journal.emit('error', 'test', 'failure', 'still recorded')).not.toThrow();
    expect(journal.snapshot()).toHaveLength(1);
  });
});
