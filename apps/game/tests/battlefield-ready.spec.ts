import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  afterBattlefieldReady,
  liveAssetStreamingEnabled,
  markBattlefieldReady,
  resetBattlefieldReady,
  scheduleBattlefieldWork,
  waitForBattlefieldIdle,
} from '../src/core/battlefield-ready';

beforeEach(() => resetBattlefieldReady());
afterEach(() => vi.useRealTimers());

describe('battlefield-ready boundary', () => {
  it('keeps non-preemptible live asset parsing off unless an A/B explicitly enables it', () => {
    expect(liveAssetStreamingEnabled('')).toBe(false);
    expect(liveAssetStreamingEnabled('?liveassetstream=off')).toBe(false);
    expect(liveAssetStreamingEnabled('?liveassetstream=on')).toBe(true);
  });

  it('releases subscribers once after the first battlefield frame', () => {
    const listener = vi.fn();
    afterBattlefieldReady(listener);
    expect(listener).not.toHaveBeenCalled();
    markBattlefieldReady();
    markBattlefieldReady();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('allows a pending subscriber to be cancelled on match teardown', () => {
    const listener = vi.fn();
    const cancel = afterBattlefieldReady(listener);
    cancel();
    cancel();
    markBattlefieldReady();
    expect(listener).not.toHaveBeenCalled();
  });

  it('queues late subscribers and still allows cancellation', async () => {
    markBattlefieldReady();
    const listener = vi.fn();
    const cancel = afterBattlefieldReady(listener);
    cancel();
    await Promise.resolve();
    expect(listener).not.toHaveBeenCalled();
  });

  it('runs deferred catalogues serially by priority after presentation', async () => {
    vi.useFakeTimers();
    const order: string[] = [];
    scheduleBattlefieldWork(30, async () => {
      order.push('private-start');
      await Promise.resolve();
      order.push('private-end');
    });
    scheduleBattlefieldWork(10, () => { order.push('shared'); });
    markBattlefieldReady();
    await vi.advanceTimersByTimeAsync(1_200);
    expect(order).toEqual(['shared', 'private-start', 'private-end']);
  });

  it('crosses a frame-sized task boundary when requestIdleCallback is unavailable', async () => {
    vi.useFakeTimers();
    let released = false;
    const waiting = waitForBattlefieldIdle().then(() => { released = true; });
    await vi.advanceTimersByTimeAsync(15);
    expect(released).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await waiting;
    expect(released).toBe(true);
  });
});
