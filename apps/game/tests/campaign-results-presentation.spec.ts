import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  campaignDebrief,
  campaignFinale,
  campaignMedalStandard,
  campaignTheme,
} from '../src/shell/CampaignPresentation';
import {
  campaignGradeLabel,
  campaignMedalPresentation,
  campaignObjectiveRewardLabel,
  campaignObjectiveStatusLabel,
} from '../src/shell/EndScreen';
import { campaignHint } from '../src/shell/MainMenu';

describe('campaign result presentation', () => {
  it('routes Next Operation through its briefing instead of silently deploying', () => {
    const source = readFileSync(join(import.meta.dirname, '..', 'src', 'shell', 'EndScreen.ts'), 'utf8');
    const start = source.indexOf("button('Next Operation'");
    const branch = source.slice(start, source.indexOf("button('Retry'", start));
    expect(start).toBeGreaterThan(-1);
    expect(branch).toContain('quitToMenu().then(() => this.shell.openBriefing(next))');
    expect(branch).not.toContain('startOperation(next)');
  });

  it('grades Gold visual fixtures on Hard instead of publishing an impossible Normal award', () => {
    const source = readFileSync(join(import.meta.dirname, '..', '..', '..', 'tools', 'campaign-shoot.mjs'), 'utf8');
    expect(source).toContain('window.__vmShell.setCampaignDifficulty(2)');
    expect(source).toContain('medal: 3');
  });

  it('keeps the twelve campaign statistics in a balanced six-by-two ledger', () => {
    const css = readFileSync(join(import.meta.dirname, '..', 'src', 'shell', 'shell.css'), 'utf8');
    const selector = '.vm-shell .vm-end-panel.has-campaign > .vm-stats {';
    const at = css.indexOf(selector);
    const rule = css.slice(at, css.indexOf('\n}', at));
    expect(at).toBeGreaterThan(-1);
    expect(rule).toContain('grid-template-columns: repeat(6, minmax(0, 1fr))');
  });

  it('shows truthful campaign progress on the title screen without counting stale rows', () => {
    expect(campaignHint(null)).toBe('37 operations');
    expect(campaignHint({ campaign: {} })).toBe('0 / 37 complete');
    expect(campaignHint({ campaign: {
      'soviets.01.first-tap': 1,
      'allies.01.sounding-line': 3,
      'removed.operation': 3,
    } })).toBe('2 / 37 complete');
  });

  it('resolves the four faction presentation themes without guessing unknown ids', () => {
    expect(campaignTheme('soviets.01.first-tap')).toBe('soviets');
    expect(campaignTheme('allies.01.sounding-line')).toBe('allies');
    expect(campaignTheme('pact.01.shallow-road')).toBe('pact');
    expect(campaignTheme('reclamation.01.held-paper')).toBe('reclamation');
    expect(campaignTheme('unknown.01.nope')).toBeNull();
  });

  it('authors a distinct campaign epilogue for every faction finale', () => {
    const finales = [
      campaignFinale('soviets.09.nil-return'),
      campaignFinale('allies.09.made-good'),
      campaignFinale('pact.09.vacant-possession'),
      campaignFinale('reclamation.10.without-recourse'),
    ];
    expect(finales.every((finale) => finale !== null)).toBe(true);
    expect(new Set(finales.map((finale) => finale?.title)).size).toBe(finales.length);
    expect(new Set(finales.map((finale) => finale?.message)).size).toBe(finales.length);
    expect(campaignFinale('soviets.08.carriage-forward')).toBeNull();
    expect(campaignFinale('unknown.99.nope')).toBeNull();
  });

  it('translates every persisted medal tier into a visible award', () => {
    expect([0, 1, 2, 3].map((tier) => campaignMedalPresentation(tier).label))
      .toEqual(['No Medal', 'Bronze Medal', 'Silver Medal', 'Gold Medal']);
  });

  it('uses the same medal requirements before and after an operation', () => {
    for (const tier of [0, 1, 2, 3]) {
      expect(campaignMedalPresentation(tier).detail)
        .toBe(campaignMedalStandard(tier).requirement);
    }
    expect(campaignMedalStandard(3).requirement).toContain('Hard or Brutal');
  });

  it('distinguishes a paid bonus from a missed payout in after action', () => {
    expect(campaignObjectiveRewardLabel(500, true)).toBe('Paid +500 cr');
    expect(campaignObjectiveRewardLabel(500, false)).toBe('+500 cr reward');
    expect(campaignObjectiveRewardLabel(undefined, true)).toBe('');
    expect(campaignObjectiveRewardLabel(0, true)).toBe('');
  });

  it('names every objective outcome instead of relying on a glyph alone', () => {
    expect(campaignObjectiveStatusLabel('complete')).toBe('Complete');
    expect(campaignObjectiveStatusLabel('failed')).toBe('Failed');
    expect(campaignObjectiveStatusLabel('active')).toBe('Not met');
    expect(campaignObjectiveStatusLabel('hidden')).toBe('Undisclosed');
  });

  it('clamps malformed persisted tiers instead of inventing a fifth award', () => {
    expect(campaignMedalPresentation(-9).tier).toBe(0);
    expect(campaignMedalPresentation(99).tier).toBe(3);
    expect(campaignMedalPresentation(Number.NaN).tier).toBe(0);
  });

  it('names and clamps the combat grade carried from briefing to after action', () => {
    expect([0, 1, 2, 3].map(campaignGradeLabel)).toEqual(['Easy', 'Normal', 'Hard', 'Brutal']);
    expect(campaignGradeLabel(-9)).toBe('Easy');
    expect(campaignGradeLabel(99)).toBe('Brutal');
    expect(campaignGradeLabel(Number.NaN)).toBe('Normal');
  });

  it('gives both sides of First Tap a Directorate assessment', () => {
    const win = campaignDebrief('soviets.01.first-tap', true);
    const loss = campaignDebrief('soviets.01.first-tap', false);
    expect(win?.commander.name).toBe('Rakhalt');
    expect(win?.message).toContain('Tap is off them');
    expect(loss?.commander.name).toBe('Rakhalt');
    expect(loss?.message).toContain('still Allied');
  });

  it('uses Vosk for Common Standard and Tallow for the Reclamation opening', () => {
    expect(campaignDebrief('soviets.02.common-standard', true)?.commander.name).toBe('Vosk');
    expect(campaignDebrief('soviets.02.common-standard', false)?.message)
      .toContain('Survey 40 stays theirs');
    expect(campaignDebrief('reclamation.01.held-paper', true)?.commander.name).toBe('Tallow');
    expect(campaignDebrief('reclamation.01.held-paper', true)?.message).toContain('four yards remain earning');
  });

  it('carries Vosk through both Deep Sector outcomes', () => {
    expect(campaignDebrief('soviets.03.deep-sector', true)?.message)
      .toContain('Tap is ours');
    expect(campaignDebrief('soviets.03.deep-sector', false)?.commander.name).toBe('Vosk');
  });

  it('voices medal quality through each faction instead of repeating one generic success', () => {
    expect(campaignDebrief('allies.09.made-good', true, { medal: 3 })?.message)
      .toContain('gold standard');
    expect(campaignDebrief('pact.09.vacant-possession', true, { medal: 2 })?.message)
      .toContain('every concession');
    expect(campaignDebrief('reclamation.10.without-recourse', true, { medal: 1 })?.message)
      .toContain('on our books');
    expect(campaignDebrief('soviets.09.nil-return', true, { medal: 3 })?.message)
      .toContain('Ground, entry and timing');
  });

  it('names the objective that ended a failed operation', () => {
    const out = campaignDebrief('allies.09.made-good', false, {
      failedObjective: 'Put a landing party on Bench Nine',
    });
    expect(out?.message).toContain('Put a landing party on Bench Nine');
    expect(out?.message).toContain('not supportable');
  });

  it('returns a distinct authored assessment for every Allied operation', () => {
    const ids = [
      'allies.01.sounding-line',
      'allies.02.instrument-room',
      'allies.03.ground-truth',
      'allies.04.misclosure',
      'allies.05.forced-closure',
      'allies.06.machine-time',
      'allies.07.fair-copy',
      'allies.08.standing-order',
      'allies.09.made-good',
    ];
    const wins = ids.map((id) => campaignDebrief(id, true)?.message);
    const losses = ids.map((id) => campaignDebrief(id, false)?.message);
    expect(new Set(wins).size).toBe(ids.length);
    expect(new Set(losses).size).toBe(ids.length);
    expect(wins.every((message) => message !== undefined && !message.startsWith('Complete '))).toBe(true);
  });

  it('returns a distinct authored finding for every Pact operation', () => {
    const ids = [
      'pact.01.shallow-road',
      'pact.02.long-count',
      'pact.03.concession',
      'pact.04.in-the-clear',
      'pact.05.open-count',
      'pact.06.common-ground',
      'pact.07.thin-place',
      'pact.08.struck-off',
      'pact.09.vacant-possession',
    ];
    const wins = ids.map((id) => campaignDebrief(id, true)?.message);
    const losses = ids.map((id) => campaignDebrief(id, false)?.message);
    expect(new Set(wins).size).toBe(ids.length);
    expect(new Set(losses).size).toBe(ids.length);
    expect(campaignDebrief(ids[8], true, { medal: 3 })?.message).toContain('gold measure');
  });

  it('returns a distinct authored account for every Reclamation operation', () => {
    const ids = [
      'reclamation.01.held-paper',
      'reclamation.02.written-off',
      'reclamation.03.sold-twice',
      'reclamation.04.served-notice',
      'reclamation.05.closing-entry',
      'reclamation.06.in-duplicate',
      'reclamation.07.payment-in-kind',
      'reclamation.08.contra-entry',
      'reclamation.09.book-value',
      'reclamation.10.without-recourse',
    ];
    const wins = ids.map((id) => campaignDebrief(id, true)?.message);
    const losses = ids.map((id) => campaignDebrief(id, false)?.message);
    expect(new Set(wins).size).toBe(ids.length);
    expect(new Set(losses).size).toBe(ids.length);
    expect(campaignDebrief(ids[9], true, { medal: 3 })?.message).toContain('gold value');
  });

  it('returns a distinct authored assessment for the complete Soviet campaign', () => {
    const ids = [
      'soviets.01.first-tap',
      'soviets.02.common-standard',
      'soviets.03.deep-sector',
      'soviets.04.company-town',
      'soviets.05.short-allocation',
      'soviets.06.demolition-order',
      'soviets.07.right-of-entry',
      'soviets.08.carriage-forward',
      'soviets.09.nil-return',
    ];
    const wins = ids.map((id) => campaignDebrief(id, true)?.message);
    const losses = ids.map((id) => campaignDebrief(id, false)?.message);
    expect(new Set(wins).size).toBe(ids.length);
    expect(new Set(losses).size).toBe(ids.length);
    expect(campaignDebrief(ids[8], true, { medal: 3 })?.message)
      .toContain('Ground, entry and timing');
  });
});
