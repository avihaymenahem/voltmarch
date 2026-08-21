/**
 * Player-facing campaign text is data, and therefore gets a data gate.
 *
 * Screen-mount coverage lives in campaign-chapters / campaign-briefing and the
 * campaign capture harness. This file guards the complete authored corpus that
 * those screens and the in-match comms consume: every operation contributes a
 * real transmission sequence, no internal key leaks into the fiction, and a
 * briefing cannot quietly hard-code a number that is also live tuning data.
 */

import { describe, expect, it } from 'vitest';

import { CAMPAIGNS } from '../src/campaign/index';
import type { Effect, OperationDef } from '../src/campaign/types';
import { campaignBriefing } from '../src/shell/CampaignPresentation';
import {
  CAMPAIGN_COMMS_HISTORY_MAX,
  CAMPAIGN_COMMS_QUEUE_MAX,
  campaignCommsLife,
  campaignCommsPages,
} from '../src/ui/CampaignComms';

type DialogueEffect = Extract<Effect, { readonly do: 'dialogue' }>;

const OPERATIONS: readonly OperationDef[] = CAMPAIGNS.flatMap((chapter) => chapter.operations);

function dialogueOf(operation: OperationDef): readonly DialogueEffect[] {
  return operation.triggers.flatMap((trigger) => trigger.then.filter(
    (effect): effect is DialogueEffect => effect.do === 'dialogue',
  ));
}

interface CopyRow {
  readonly source: string;
  readonly text: string;
}

function copyOf(operation: OperationDef): readonly CopyRow[] {
  const rows: CopyRow[] = [
    { source: `${operation.id} title`, text: operation.title },
    { source: `${operation.id} beat`, text: operation.beat },
    ...operation.objectives.map((objective) => ({
      source: `${operation.id} objective ${objective.id}`,
      text: objective.title,
    })),
    ...dialogueOf(operation).flatMap((effect, index) => [
      { source: `${operation.id} dialogue ${index + 1} speaker`, text: effect.speaker },
      { source: `${operation.id} dialogue ${index + 1}`, text: effect.text },
    ]),
  ];
  const briefing = campaignBriefing(operation.id);
  if (briefing !== null) rows.push({ source: `${operation.id} directive`, text: briefing.directive });
  return rows;
}

/** Every finite numeric value authored anywhere under the operation row. */
function numericFields(value: unknown, out = new Set<number>()): ReadonlySet<number> {
  if (typeof value === 'number' && Number.isFinite(value)) {
    out.add(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) numericFields(item, out);
    return out;
  }
  if (typeof value === 'object' && value !== null) {
    for (const item of Object.values(value)) numericFields(item, out);
  }
  return out;
}

function bareIntegers(text: string): readonly number[] {
  return [...text.matchAll(/\b\d[\d,_]*\b/g)]
    .map((match) => Number(match[0].replace(/[,_]/g, '')))
    .filter(Number.isFinite);
}

describe('campaign text corpus', () => {
  it('covers the complete campaign with a non-vacuous in-match transmission floor', () => {
    expect(OPERATIONS).toHaveLength(37);
    const counts = OPERATIONS.map((operation) => dialogueOf(operation).length);
    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(648);
    for (let index = 0; index < OPERATIONS.length; index++) {
      expect(counts[index], `${OPERATIONS[index].id} has too little authored radio continuity`)
        .toBeGreaterThanOrEqual(4);
      expect(counts[index], `${OPERATIONS[index].id} has an unscannable radio flood`)
        .toBeLessThanOrEqual(30);
    }
  });

  it('fits every operation in the live queue and the full-operation transmission log', () => {
    for (const operation of OPERATIONS) {
      const dialogue = dialogueOf(operation);
      const pages = dialogue.reduce(
        (sum, line) => sum + campaignCommsPages(line.text).length,
        0,
      );
      expect(
        dialogue.length,
        `${operation.id} exceeds the full-operation transmission log`,
      ).toBeLessThanOrEqual(CAMPAIGN_COMMS_HISTORY_MAX);
      // The first page is active immediately; every remaining page can be
      // queued even if the whole authored operation arrives in one tick.
      expect(
        Math.max(0, pages - 1),
        `${operation.id} can evict unread campaign traffic`,
      ).toBeLessThanOrEqual(CAMPAIGN_COMMS_QUEUE_MAX);
    }
  });

  it('keeps every player-facing row trimmed, printable, and free of internal authoring keys', () => {
    const internalKey = /\b(?:t|unit|struct|layout)\.[a-z0-9][a-z0-9._-]*\b/i;
    const control = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
    for (const operation of OPERATIONS) {
      for (const row of copyOf(operation)) {
        expect(row.text.length, `${row.source} is empty`).toBeGreaterThan(0);
        expect(row.text, `${row.source} has outer whitespace`).toBe(row.text.trim());
        expect(row.text, `${row.source} has repeated whitespace`).not.toMatch(/\s{2,}/);
        expect(row.text, `${row.source} has a control character`).not.toMatch(control);
        expect(row.text, `${row.source} leaks an internal key`).not.toMatch(internalKey);
      }
    }
  });

  it('keeps each authored transmission inside three paced live-card pages', () => {
    const longSpeakers: string[] = [];
    const overPaged: string[] = [];
    const rushedPages: string[] = [];
    for (const operation of OPERATIONS) {
      for (const [index, line] of dialogueOf(operation).entries()) {
        if (line.speaker.length > 72) {
          longSpeakers.push(`${operation.id} dialogue ${index + 1}: ${line.speaker.length}`);
        }
        const pages = campaignCommsPages(line.text);
        if (pages.length > 3) {
          overPaged.push(`${operation.id} dialogue ${index + 1}: ${pages.length} pages`);
        }
        for (const [pageIndex, page] of pages.entries()) {
          const charsPerSecond = page.length / campaignCommsLife(page);
          if (charsPerSecond > 14.01) {
            rushedPages.push(
              `${operation.id} dialogue ${index + 1}.${pageIndex + 1}: ${charsPerSecond.toFixed(2)} cps`,
            );
          }
        }
      }
    }
    expect(longSpeakers, 'speaker labels longer than the identity rail').toEqual([]);
    expect(overPaged, 'one transmission monopolises more than three live-card pages').toEqual([]);
    expect(rushedPages, 'a live page advances faster than the reading-time ceiling').toEqual([]);
  });

  it('does not duplicate a live numeric tuning field inside briefing prose', () => {
    const collisions: string[] = [];
    for (const operation of OPERATIONS) {
      const briefing = campaignBriefing(operation.id);
      expect(briefing, `${operation.id} has no briefing presentation`).not.toBeNull();
      if (briefing === null) continue;
      const fields = numericFields(operation);
      const repeated = [...new Set(bareIntegers(briefing.directive).filter((n) => fields.has(n)))];
      if (repeated.length > 0) collisions.push(`${operation.id}: ${repeated.join(', ')}`);
    }
    expect(collisions, 'briefing prose shadows operation tuning').toEqual([]);
  });
});
