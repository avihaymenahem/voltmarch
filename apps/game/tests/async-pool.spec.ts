import { describe, expect, it } from 'vitest';
import { mapConcurrent } from '../src/core/async-pool';

describe('bounded async asset loading', () => {
  it('preserves input order while respecting the concurrency ceiling', async () => {
    let active = 0;
    let peak = 0;
    const result = await mapConcurrent([4, 3, 2, 1], 2, async (value) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, value));
      active--;
      return value * 10;
    });
    expect(result).toEqual([40, 30, 20, 10]);
    expect(peak).toBe(2);
  });

  it('rejects invalid concurrency instead of silently stalling', async () => {
    await expect(mapConcurrent([1], 0, async (value) => value)).rejects.toThrow(RangeError);
  });
});
