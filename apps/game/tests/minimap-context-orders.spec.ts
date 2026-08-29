/**
 * Minimap right-click is an order surface, not a presentation-only ping.
 *
 * These seam checks protect the integration points that are otherwise difficult
 * to drive without a browser canvas: Minimap offers the world point to gameplay
 * first, and input resolves it through the same contextual order machinery used
 * by the battlefield before allowing the multiplayer-ping fallback.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const minimap = readFileSync(new URL('../src/ui/Minimap.ts', import.meta.url), 'utf8');
const input = readFileSync(new URL('../src/input/input.system.ts', import.meta.url), 'utf8');

describe('minimap contextual right-click orders', () => {
  it('offers right-clicks to the order handler before falling back to a ping', () => {
    const order = minimap.indexOf('this.orderRequestHandler?.(point.x, point.z)');
    const ping = minimap.indexOf('this.pingRequestHandler?.(point.x, point.z)', order);
    expect(order).toBeGreaterThan(-1);
    expect(ping).toBeGreaterThan(order);
    expect(minimap).toContain('if (!ordered)');
  });

  it('uses the battlefield context resolver and executor', () => {
    expect(input).toContain('function issueMinimapOrder(x: number, z: number): boolean');
    expect(input).toContain('resolveContextOrder(world, hover, x, z, true, MODS, mode, caps, resolution)');
    expect(input).toContain('executeResolved(resolution, MODS.shift || waypointLatched())');
    expect(input).toContain('h.minimap?.onOrderRequest?.(issueMinimapOrder)');
  });

  it('rebinds to the concrete HUD after a match recreates it', () => {
    expect(input).toContain('let linkedHud: HudBridge | null = null');
    expect(input).toContain('if (h === linkedHud) return');
    expect(input).toContain('linkedHud?.minimap?.onOrderRequest?.(null)');
    expect(input).not.toContain('let hudLinked = false');
    expect(input).toContain('linkHud();\n\n    updateCamera(r.dt)');
  });
});
