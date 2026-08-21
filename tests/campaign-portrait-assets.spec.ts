/** The gold-master portrait registry must point at files that actually ship. */

import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { campaignBriefing, campaignSpeaker } from '../src/shell/CampaignPresentation';

const ROOT = join(import.meta.dirname, '..');

function publicPath(url: string): string {
  const relative = url.replace(/^\.\//, '').replace(/^\//, '');
  return join(ROOT, 'public', relative);
}

describe('campaign portrait presentation', () => {
  it('ships every portrait referenced by the opening operation', () => {
    const briefing = campaignBriefing('soviets.01.first-tap');
    expect(briefing).not.toBeNull();

    const speakers = [briefing?.commander, campaignSpeaker('Vosk')].filter((v) => v !== undefined);
    for (const speaker of speakers) {
      const path = publicPath(speaker.portrait);
      expect(existsSync(path), `${speaker.name} points at missing ${path}`).toBe(true);
      expect(statSync(path).size, `${speaker.name}'s portrait is empty`).toBeGreaterThan(10_000);
      expect(statSync(path).size, `${speaker.name}'s HUD portrait is too large`).toBeLessThan(100_000);
    }
  });

  it('uses the portrait identity but marks an intercepted channel honestly', () => {
    const intercepted = campaignSpeaker('Rakhalt, intercepted');
    expect(intercepted.portrait).toMatch(/rakhalt\.webp$/);
    expect(intercepted.role).toBe('Intercepted Signal');
  });

  it('fails soft for an unauthored speaker', () => {
    expect(campaignSpeaker('Unknown Dispatch')).toMatchObject({
      name: 'Unknown Dispatch',
      role: 'Field Transmission',
      portrait: '',
      monogram: 'UD',
    });
  });
});

