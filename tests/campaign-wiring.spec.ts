/** Campaign credit rewards have one declared, campaign-only route to Economy. */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { CAMPAIGNS } from '../src/campaign/index';
import type { Effect, OperationDef } from '../src/campaign/types';

const REPO = join(import.meta.dirname, '..');
const CAMPAIGN = join(REPO, 'src', 'campaign');

function code(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function campaignFiles(dir = CAMPAIGN): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...campaignFiles(path));
    else if (name.endsWith('.ts')) out.push(path);
  }
  return out;
}

function operations(): readonly OperationDef[] {
  return CAMPAIGNS.flatMap((chapter) => chapter.operations);
}

function effects(operation: OperationDef): readonly Effect[] {
  return operation.triggers.flatMap((trigger) => trigger.then);
}

describe('campaign credit wiring', () => {
  it('pays only positive secondary objectives, and every paid row can complete', () => {
    const paid = operations().flatMap((operation) => operation.objectives
      .filter((objective) => objective.credits !== undefined)
      .map((objective) => ({ operation, objective })));

    expect(paid.length, 'the payout gate is vacuous').toBeGreaterThan(0);
    for (const { operation, objective } of paid) {
      expect(objective.kind, `${operation.id}/${objective.id}`).toBe('secondary');
      expect(Number.isFinite(objective.credits), `${operation.id}/${objective.id}`).toBe(true);
      expect(objective.credits as number, `${operation.id}/${objective.id}`).toBeGreaterThan(0);
      expect(
        effects(operation).some((effect) => (
          effect.do === 'completeObjective' && effect.id === objective.id
        )),
        `${operation.id}/${objective.id} declares credits but has no completion effect`,
      ).toBe(true);
    }
  });

  it('routes objective completion through the paid-once session ledger', () => {
    const install = code(join(CAMPAIGN, 'campaign-install.ts'));
    expect(install).toContain('this.state.paid.has(id)');
    expect(install).toContain('this.state.paid.add(id)');
    expect(install).toContain('this.sink?.grantCredits(this.playerSeat(), def.credits)');
  });

  it('has one Economy.grant call under campaign, inside the runtime sink', () => {
    const callers: string[] = [];
    for (const file of campaignFiles()) {
      const calls = code(file).match(/\.grant\s*\(/g) ?? [];
      for (let i = 0; i < calls.length; i++) callers.push(file.slice(REPO.length + 1));
    }
    expect(callers).toEqual(['src\\campaign\\runtime.ts']);

    const runtime = code(join(CAMPAIGN, 'runtime.ts'));
    expect(runtime.match(/\.grant\s*\(/g)).toHaveLength(1);
    expect(runtime).toContain('eco.grant(p.id, amount, CreditReason.Bounty)');
  });

  it('keeps the intentional scripted grant effect on the same campaign sink', () => {
    const scripted = operations().flatMap((operation) => effects(operation)
      .filter((effect) => effect.do === 'grantCredits')
      .map((effect) => ({ operation: operation.id, effect })));
    expect(scripted.length, 'the explicit-effect half of the sink is no longer exercised')
      .toBeGreaterThan(0);

    const install = code(join(CAMPAIGN, 'campaign-install.ts'));
    expect(install).toContain("case 'grantCredits': sink.grantCredits(e.player, e.amount)");
  });

  it('constructs no profile Reward inside an operation', () => {
    const operationSources = campaignFiles(join(CAMPAIGN, 'operations')).map(code).join('\n');
    expect(operationSources).not.toMatch(/\breward\s*:/);
    expect(operationSources).not.toMatch(/\bReward\b/);
  });
});

