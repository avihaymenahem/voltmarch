import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

describe('selection marquee overlay clip', () => {
  const source = readFileSync(
    fileURLToPath(new URL('../src/ui/Overlay.ts', import.meta.url)),
    'utf8',
  );
  const frameStart = source.indexOf('  frame(dt: number): void {');
  const frameEnd = source.indexOf('\n  /* ------------------------------------------------------------------ */\n  /* the placement hint', frameStart);
  const frame = source.slice(frameStart, frameEnd);

  it('paints the client-space marquee after the playfield clip is restored', () => {
    const clip = frame.indexOf('ctx.clip();');
    const clippedRestore = frame.indexOf('ctx.restore();', clip);
    const marquee = frame.indexOf('this.drawMarquee();');

    expect(frameStart).toBeGreaterThanOrEqual(0);
    expect(frameEnd).toBeGreaterThan(frameStart);
    expect(clip).toBeGreaterThanOrEqual(0);
    expect(clippedRestore).toBeGreaterThan(clip);
    expect(marquee).toBeGreaterThan(clippedRestore);
  });

  it('paints selection and hover rings outside the full-width dock-band clip', () => {
    const clip = frame.indexOf('ctx.clip();');
    const clippedRestore = frame.indexOf('ctx.restore();', clip);
    const rings = frame.indexOf('this.drawSelectionRings();');

    expect(clip).toBeGreaterThanOrEqual(0);
    expect(clippedRestore).toBeGreaterThan(clip);
    expect(rings).toBeGreaterThan(clippedRestore);
  });
});
