/** Campaign lifecycle latches move as one session, including failure paths. */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  armOperation,
  armedSession,
  disarmOperation,
  operationById,
} from '../src/campaign/campaign-install';
import { campaignRunning, outcomePolicy } from '../src/campaign/policy';
import { plannedOperation } from '../src/game/Scenarios';
import { campaignRosterActive } from '../src/progression/UnlockGate';

afterEach(() => {
  disarmOperation();
  vi.restoreAllMocks();
});

function expectArmed(id: string): void {
  expect(armedSession()?.op.id).toBe(id);
  expect(plannedOperation()?.id).toBe(id);
  expect(campaignRosterActive()).toBe(true);
  expect(campaignRunning()).toBe(true);
  expect(outcomePolicy()).toEqual(operationById(id)?.outcome);
}

function expectDisarmed(): void {
  expect(armedSession()).toBeNull();
  expect(plannedOperation()).toBeNull();
  expect(campaignRosterActive()).toBe(false);
  expect(campaignRunning()).toBe(false);
  expect(outcomePolicy()).toEqual({
    annihilationWin: true,
    assetLossDefeat: true,
    ignoreSeats: [],
  });
}

describe('campaign lifecycle isolation', () => {
  it('arms and disarms session, scenario, roster and outcome policy together', () => {
    const id = 'soviets.01.first-tap';
    expect(armOperation(id, 1)?.id).toBe(id);
    expectArmed(id);

    disarmOperation();
    expectDisarmed();
  });

  it('re-arming replaces every latch instead of retaining the first operation', () => {
    expect(armOperation('soviets.01.first-tap', 1)).not.toBeNull();
    expect(armOperation('allies.01.sounding-line', 2)).not.toBeNull();
    expectArmed('allies.01.sounding-line');
  });

  it('an invalid re-arm clears the old operation before returning null', () => {
    expect(armOperation('soviets.01.first-tap', 1)).not.toBeNull();
    expectArmed('soviets.01.first-tap');

    vi.spyOn(console, 'error').mockImplementation(() => { /* expected rejection */ });
    expect(armOperation('removed.operation', 1)).toBeNull();
    expectDisarmed();
  });
});

