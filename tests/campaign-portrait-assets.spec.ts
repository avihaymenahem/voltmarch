/** The gold-master portrait registry must point at files that actually ship. */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { CAMPAIGNS } from '../src/campaign/index';
import {
  CAMPAIGN_OPERATION_IDS,
  CAMPAIGN_OPERATION_COUNT,
  campaignBriefing,
  campaignDebrief,
  campaignSpeaker,
  preloadCampaignPortraits,
} from '../src/shell/CampaignPresentation';

const ROOT = join(import.meta.dirname, '..');

function publicPath(url: string): string {
  const relative = url.replace(/^\.\//, '').replace(/^\//, '');
  return join(ROOT, 'public', relative);
}

describe('campaign portrait presentation', () => {
  it('ships every portrait referenced by the complete campaign command cast', () => {
    const speakers = [
      'Rakhalt', 'Vosk', 'Wend', 'Aubray', 'Calvane', 'Nael', 'Tallow', 'Cregg',
      'Bramm', 'Hesk', 'Oreth', 'Ardle',
      'Averill', 'Merrow', 'Rathe', 'Sennet', 'Bardin', 'Skell', 'Tolvar',
    ].map(campaignSpeaker);
    for (const speaker of speakers) {
      const path = publicPath(speaker.portrait);
      expect(existsSync(path), `${speaker.name} points at missing ${path}`).toBe(true);
      expect(statSync(path).size, `${speaker.name}'s portrait is empty`).toBeGreaterThan(10_000);
      expect(statSync(path).size, `${speaker.name}'s HUD portrait is too large`).toBeLessThan(100_000);
    }
  });

  it('gives every speaker authored in an operation a portrait identity', () => {
    const root = join(ROOT, 'src', 'campaign', 'operations');
    const labels = new Set<string>();
    const visit = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) visit(path);
        else if (entry.name.endsWith('.ts')) {
          const source = readFileSync(path, 'utf8');
          for (const match of source.matchAll(/speaker:\s*'([^']+)'/g)) labels.add(match[1]);
        }
      }
    };
    visit(root);
    expect(labels.size).toBeGreaterThan(20);
    for (const label of labels) {
      expect(campaignSpeaker(label).portrait, `${label} fell back to a monogram`).not.toBe('');
    }
  });

  it('gives every shipped operation a briefing and both debrief outcomes', () => {
    let operations = 0;
    for (const chapter of CAMPAIGNS) {
      for (const op of chapter.operations) {
        operations++;
        const primary = op.objectives.find((o) => o.kind === 'primary' && o.hidden !== true);
        const briefing = campaignBriefing(op.id, primary?.title);
        expect(briefing, `${op.id} has no command briefing`).not.toBeNull();
        expect(briefing?.directive.length, `${op.id} has an empty directive`).toBeGreaterThan(12);
        expect(campaignDebrief(op.id, true), `${op.id} has no victory debrief`).not.toBeNull();
        expect(campaignDebrief(op.id, false), `${op.id} has no defeat debrief`).not.toBeNull();
      }
    }
    expect(operations).toBe(CAMPAIGN_OPERATION_COUNT);
    expect(new Set(CAMPAIGN_OPERATION_IDS).size).toBe(CAMPAIGN_OPERATION_COUNT);
    expect(CAMPAIGN_OPERATION_COUNT).toBe(37);
  });

  it('uses the portrait identity but marks an intercepted channel honestly', () => {
    const intercepted = campaignSpeaker('Rakhalt, intercepted');
    expect(intercepted.portrait).toMatch(/rakhalt\.webp$/);
    expect(intercepted.role).toBe('Intercepted Signal');

    const wend = campaignSpeaker('Wend, intercepted');
    expect(wend.portrait).toMatch(/wend\.webp$/);
    expect(wend.role).toBe('Intercepted Signal');
  });

  it('carries faction identity into the in-match transmission surface', () => {
    expect(campaignSpeaker('Rakhalt').theme).toBe('soviets');
    expect(campaignSpeaker('Aubray').theme).toBe('allies');
    expect(campaignSpeaker('Nael').theme).toBe('pact');
    expect(campaignSpeaker('Cregg').theme).toBe('reclamation');
    // An intercepted known voice keeps its visual identity.
    expect(campaignSpeaker('Calvane, intercepted').theme).toBe('pact');
    expect(campaignSpeaker('Bramm, on the survey net').theme).toBe('allies');
    expect(campaignSpeaker('Hesk, of the pan').theme).toBe('pact');
    expect(campaignSpeaker('Oreth, Warden of the Count').portrait).toMatch(/oreth\.webp$/);
    expect(campaignSpeaker('Ardle, intercepted').portrait).toMatch(/ardle\.webp$/);
  });

  it('fails soft for an unauthored speaker', () => {
    expect(campaignSpeaker('Unknown Dispatch')).toMatchObject({
      name: 'Unknown Dispatch',
      role: 'Field Transmission',
      portrait: '',
      monogram: 'UD',
      theme: 'neutral',
    });
  });

  it('primes the campaign cast once rather than refetching it for every operation', () => {
    const previous = globalThis.Image;
    const sources: string[] = [];
    class StubImage {
      decoding = '';
      set src(value: string) { sources.push(value); }
    }
    globalThis.Image = StubImage as unknown as typeof Image;
    try {
      preloadCampaignPortraits();
      preloadCampaignPortraits();
      expect(sources).toHaveLength(19);
      expect(new Set(sources).size).toBe(19);
      expect(sources.every((src) => src.endsWith('.webp'))).toBe(true);
    } finally {
      globalThis.Image = previous;
    }
  });
});
