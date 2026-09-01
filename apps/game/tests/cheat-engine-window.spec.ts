import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const source = readFileSync(
  path.join(process.cwd(), 'apps/game/src/dev/CheatEngine.ts'),
  'utf8',
);

describe('Cheat Engine window controls', () => {
  it('closes completely and reopens through Ctrl+Shift+C without a mini launcher', () => {
    expect(source).toContain("event.code !== 'KeyC' || !event.ctrlKey || !event.shiftKey");
    expect(source).toContain("close.addEventListener('click', () => setOpen(false))");
    expect(source).not.toContain('vm-cheat-launcher');
  });

  it('uses header double-click only for collapse and restore', () => {
    expect(source).toContain("headElement.addEventListener('dblclick', toggleCollapsed)");
  });

  it('falls back to window dragging when Chromium rejects pointer capture', () => {
    expect(source).toContain('headElement.setPointerCapture(event.pointerId)');
    expect(source).toContain('catch { /* window listeners retain ownership */ }');
    expect(source).toContain("window.addEventListener('pointermove', dragMove, true)");
    expect(source).toContain("window.addEventListener('pointerup', dragEnd, true)");
    expect(source).toContain("window.addEventListener('pointercancel', dragEnd, true)");
    expect(source).toContain('headElement.hasPointerCapture(event.pointerId)');
    expect(source).toContain('headElement.releasePointerCapture(event.pointerId)');
  });

  it('computes the drag grab point from the rendered panel position', () => {
    expect(source).toContain('const bounds = panel.getBoundingClientRect()');
    expect(source).toContain('dragDX = event.clientX - bounds.left');
    expect(source).toContain('dragDY = event.clientY - bounds.top');
  });
});
