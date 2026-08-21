import { describe, expect, it } from 'vitest';

import { campaignDebrief } from '../src/shell/CampaignPresentation';
import { campaignMedalPresentation } from '../src/shell/EndScreen';

describe('campaign result presentation', () => {
  it('translates every persisted medal tier into a visible award', () => {
    expect([0, 1, 2, 3].map((tier) => campaignMedalPresentation(tier).label))
      .toEqual(['No Medal', 'Bronze Medal', 'Silver Medal', 'Gold Medal']);
  });

  it('clamps malformed persisted tiers instead of inventing a fifth award', () => {
    expect(campaignMedalPresentation(-9).tier).toBe(0);
    expect(campaignMedalPresentation(99).tier).toBe(3);
    expect(campaignMedalPresentation(Number.NaN).tier).toBe(0);
  });

  it('gives both sides of First Tap a Directorate assessment', () => {
    const win = campaignDebrief('soviets.01.first-tap', true);
    const loss = campaignDebrief('soviets.01.first-tap', false);
    expect(win?.commander.name).toBe('Rakhalt');
    expect(win?.message).toContain('Tap is off them');
    expect(loss?.commander.name).toBe('Rakhalt');
    expect(loss?.message).toContain('still Allied');
  });

  it('uses Vosk for Common Standard and no fabricated speaker elsewhere', () => {
    expect(campaignDebrief('soviets.02.common-standard', true)?.commander.name).toBe('Vosk');
    expect(campaignDebrief('soviets.02.common-standard', false)?.message)
      .toContain('Survey 40 stays theirs');
    expect(campaignDebrief('reclamation.01.held-paper', true)).toBeNull();
  });

  it('carries Vosk through both Deep Sector outcomes', () => {
    expect(campaignDebrief('soviets.03.deep-sector', true)?.message)
      .toContain('Tap is ours');
    expect(campaignDebrief('soviets.03.deep-sector', false)?.commander.name).toBe('Vosk');
  });
});
