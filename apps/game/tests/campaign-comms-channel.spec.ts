import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  CAMPAIGN_COMMS_PAGE_CHARS,
  CAMPAIGN_COMMS_HISTORY_MAX,
  CAMPAIGN_COMMS_QUEUE_MAX,
  campaignCommsAdvanceLabel,
  campaignCommsChannel,
  campaignCommsLife,
  campaignCommsPages,
  campaignCommsSignals,
} from '../src/ui/CampaignComms';
import { CAMPAIGNS } from '../src/campaign/index';

describe('campaign communications channel identity', () => {
  it('labels the advance control with its truthful next action', () => {
    expect(campaignCommsAdvanceLabel(0)).toBe('CLOSE');
    expect(campaignCommsAdvanceLabel(1)).toBe('NEXT (1)');
    expect(campaignCommsAdvanceLabel(7)).toBe('NEXT (7)');
    expect(campaignCommsAdvanceLabel(Number.NaN)).toBe('CLOSE');
  });

  it('wraps commander identities in the log instead of cutting their data', () => {
    const css = readFileSync(join(import.meta.dirname, '..', 'src', 'ui', 'hud-redesign.css'), 'utf8');
    const speakerAt = css.indexOf(".vm-hud[data-layout='perimeter'] .vm-comms-history-speaker {");
    const roleAt = css.indexOf(".vm-hud[data-layout='perimeter'] .vm-comms-history-role {");
    const speakerRule = css.slice(speakerAt, css.indexOf('\n}', speakerAt));
    const roleRule = css.slice(roleAt, css.indexOf('\n}', roleAt));
    expect(speakerAt).toBeGreaterThan(-1);
    expect(roleAt).toBeGreaterThan(-1);
    expect(speakerRule).toContain('overflow-wrap: anywhere');
    expect(roleRule).toContain('overflow-wrap: anywhere');
    expect(`${speakerRule}\n${roleRule}`).not.toContain('text-overflow: ellipsis');
  });

  it('keeps capacity fuses above an authored operation rather than a short toast stack', () => {
    expect(CAMPAIGN_COMMS_HISTORY_MAX).toBeGreaterThanOrEqual(64);
    expect(CAMPAIGN_COMMS_QUEUE_MAX).toBeGreaterThanOrEqual(96);
  });

  it('names each faction network instead of repeating one generic priority label', () => {
    expect(campaignCommsChannel({ role: 'Field Command', theme: 'soviets' }))
      .toBe('Directorate channel');
    expect(campaignCommsChannel({ role: 'Field Command', theme: 'allies' }))
      .toBe('Continental channel');
    expect(campaignCommsChannel({ role: 'Field Reader', theme: 'pact' }))
      .toBe('Conclave channel');
    expect(campaignCommsChannel({ role: 'House Broker', theme: 'reclamation' }))
      .toBe('House channel');
    expect(campaignCommsChannel({ role: 'Unknown', theme: 'neutral' }))
      .toBe('Field transmission');
  });

  it('pages long authored traffic without clipping or losing a word', () => {
    const text = 'First sentence establishes the ground. '
      + 'Second sentence carries the order and is deliberately long enough to cross the live card. '
      + 'Third sentence gives the player the consequence. '.repeat(4).trim();
    const pages = campaignCommsPages(text);

    expect(pages.length).toBeGreaterThan(1);
    expect(pages.every((page) => page.length <= CAMPAIGN_COMMS_PAGE_CHARS)).toBe(true);
    expect(pages.join(' ')).toBe(text);
  });

  it('keeps the densest shipped Tallow order inside the three-page live budget', () => {
    const text = 'Endorsed to the four houses jointly and without recourse. We cannot be paid to '
      + 'read it, leaned on to alter it, or answered to when a house refuses a line. Nine yards '
      + 'became four paying for that book, and today we gave it away. I would do it in the same '
      + 'order again. A record everybody may check is the only property worth more once you stop '
      + 'owning it. Take the company name off the spine on your way out. It was never the name '
      + 'that made it true.';
    const pages = campaignCommsPages(text);
    expect(pages).toHaveLength(3);
    expect(pages.join(' ')).toBe(text);
  });

  it('word-wraps a sentence longer than a page rather than overflowing it', () => {
    const text = Array.from({ length: 80 }, (_, i) => `word${i}`).join(' ');
    const pages = campaignCommsPages(text, 64);
    expect(pages.every((page) => page.length <= 64)).toBe(true);
    expect(pages.join(' ')).toBe(text);
  });

  it('keeps every shipped dialogue beat complete inside live-card pages', () => {
    let lines = 0;
    for (const chapter of CAMPAIGNS) {
      for (const operation of chapter.operations) {
        for (const trigger of operation.triggers) {
          for (const effect of trigger.then) {
            if (effect.do !== 'dialogue') continue;
            lines++;
            const pages = campaignCommsPages(effect.text);
            expect(pages.join(' '), `${operation.id} / ${trigger.id}`).toBe(effect.text);
            expect(
              pages.every((page) => page.length <= CAMPAIGN_COMMS_PAGE_CHARS),
              `${operation.id} / ${trigger.id} overflows a live page`,
            ).toBe(true);
          }
        }
      }
    }
    expect(lines).toBeGreaterThan(500);
  });

  it('identifies an interception before the faction that sent it', () => {
    expect(campaignCommsChannel({ role: 'Intercepted Signal', theme: 'allies' }))
      .toBe('Intercepted signal');
    expect(campaignCommsChannel({ role: 'Intercepted Signal', theme: 'neutral' }))
      .toBe('Intercepted signal');
  });

  it('signals once for a transmission and stays silent on wrapped continuation pages', () => {
    expect(campaignCommsSignals(0)).toBe(true);
    expect(campaignCommsSignals(1)).toBe(false);
    expect(campaignCommsSignals(7)).toBe(false);
  });

  it('holds dense copy to a bounded reading pace', () => {
    expect(campaignCommsLife('Short order.')).toBe(7);
    const full = 'x'.repeat(CAMPAIGN_COMMS_PAGE_CHARS);
    expect(campaignCommsLife(full)).toBe(15);
    expect(full.length / campaignCommsLife(full)).toBeLessThanOrEqual(14);
  });
});
