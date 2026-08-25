/**
 * Static reachability for the authored campaign trigger graph.
 *
 * This is deliberately a MAY-reach proof, not a claim that an operation is
 * winnable by a person. World predicates (destroy this tag, enter this area,
 * hold these structures) are treated as choices the player can eventually
 * satisfy; objective predicates are not. They must be unlocked by an authored
 * complete/fail effect, and the closure has to reach an endOperation('win').
 *
 * That distinction catches the expensive authoring mistake: a win trigger
 * waiting on an objective no reachable trigger can complete. Terrain,
 * economy, pressure and practical playability remain the headless-map gates
 * and, ultimately, human playtests.
 */

import { describe, expect, it } from 'vitest';

import { CAMPAIGNS } from '../src/campaign/index';
import type { Condition, Effect, OperationDef } from '../src/campaign/types';

type Resolution = 'complete' | 'failed';

function resolutionKey(id: string, resolution: Resolution): string {
  return `${id}:${resolution}`;
}

/** True when the objective-dependent part of a condition can be satisfied. */
function conditionReachable(condition: Condition, resolved: ReadonlySet<string>): boolean {
  switch (condition.on) {
    case 'objectiveComplete':
      return resolved.has(resolutionKey(condition.id, 'complete'));
    case 'objectiveFailed':
      return resolved.has(resolutionKey(condition.id, 'failed'));
    case 'all':
      return condition.of.every((child) => conditionReachable(child, resolved));
    case 'any':
      return condition.of.some((child) => conditionReachable(child, resolved));
    case 'not':
      // A MAY-reach proof may choose world facts and evaluate before an
      // objective resolves. Negation therefore cannot introduce a dependency.
      return true;
    default:
      // Time and world reads are the player's side of the contract. Their
      // numeric/world-domain feasibility is verified by the map and roster
      // suites; this pass proves only the authored objective graph.
      return true;
  }
}

/** Provably true on the operation's first director tick without world facts. */
function constantAtStart(condition: Condition): boolean {
  switch (condition.on) {
    case 'elapsed':
    case 'elapsedSinceArmed':
      return condition.ticks === 0;
    case 'all':
      return condition.of.every(constantAtStart);
    case 'any':
      return condition.of.some(constantAtStart);
    // A negated world read may be true, but it is not a constant. Layout/tag
    // gates own that fact; this test refuses only authored certainty.
    default:
      return false;
  }
}

function applyResolution(effect: Effect, resolved: Set<string>): boolean {
  if (effect.do === 'completeObjective') {
    const before = resolved.size;
    resolved.add(resolutionKey(effect.id, 'complete'));
    return resolved.size !== before;
  }
  if (effect.do === 'failObjective') {
    const before = resolved.size;
    resolved.add(resolutionKey(effect.id, 'failed'));
    return resolved.size !== before;
  }
  return false;
}

interface Reachability {
  readonly triggers: ReadonlySet<string>;
  readonly resolved: ReadonlySet<string>;
  readonly wins: readonly string[];
}

function reachableClosure(operation: OperationDef): Reachability {
  const triggers = new Set<string>();
  const resolved = new Set<string>();
  let changed = true;

  // Each pass either adds a trigger, adds one of at most 2*objectives states,
  // or stops. The explicit ceiling turns a future mutation into a loud test
  // fault rather than an accidental infinite loop.
  const ceiling = operation.triggers.length + operation.objectives.length * 2 + 1;
  for (let pass = 0; changed && pass < ceiling; pass++) {
    changed = false;
    for (const trigger of operation.triggers) {
      if (!conditionReachable(trigger.when, resolved)) continue;
      if (!triggers.has(trigger.id)) {
        triggers.add(trigger.id);
        changed = true;
      }
      for (const effect of trigger.then) {
        if (applyResolution(effect, resolved)) changed = true;
      }
    }
  }

  const wins: string[] = [];
  for (const trigger of operation.triggers) {
    if (!triggers.has(trigger.id)) continue;
    if (trigger.then.some((effect) => effect.do === 'endOperation' && effect.result === 'win')) {
      wins.push(trigger.id);
    }
  }
  return { triggers, resolved, wins };
}

function objectiveDependencies(condition: Condition, out = new Set<string>()): ReadonlySet<string> {
  switch (condition.on) {
    case 'objectiveComplete':
      out.add(resolutionKey(condition.id, 'complete'));
      break;
    case 'objectiveFailed':
      out.add(resolutionKey(condition.id, 'failed'));
      break;
    case 'all':
    case 'any':
      for (const child of condition.of) objectiveDependencies(child, out);
      break;
    case 'not':
      // Negated objective state is not a prerequisite for a MAY-reach proof.
      break;
    default:
      break;
  }
  return out;
}

function everyOperation(): readonly OperationDef[] {
  return CAMPAIGNS.flatMap((chapter) => chapter.operations);
}

describe('campaign trigger-graph reachability', () => {
  it('reaches an authored win in every operation when player-controlled facts are free', () => {
    for (const operation of everyOperation()) {
      const reach = reachableClosure(operation);
      expect(reach.wins, `${operation.id} has no reachable win trigger`).not.toHaveLength(0);
    }
  });

  it('does not leave an objective-gated trigger behind an impossible resolution', () => {
    for (const operation of everyOperation()) {
      const reach = reachableClosure(operation);
      for (const trigger of operation.triggers) {
        const dependencies = objectiveDependencies(trigger.when);
        if (dependencies.size === 0) continue;
        expect(
          reach.triggers.has(trigger.id),
          `${operation.id}/${trigger.id} waits on ${[...dependencies].join(', ')}`,
        ).toBe(true);
      }
    }
  });

  it('gives every primary objective a reachable completion effect', () => {
    for (const operation of everyOperation()) {
      const reach = reachableClosure(operation);
      for (const objective of operation.objectives) {
        if (objective.kind !== 'primary') continue;
        expect(
          reach.resolved.has(resolutionKey(objective.id, 'complete')),
          `${operation.id}/${objective.id} cannot complete`,
        ).toBe(true);
      }
    }
  });

  it('does not author a certain loss on the first director tick', () => {
    for (const operation of everyOperation()) {
      for (const trigger of operation.triggers) {
        const loses = trigger.then.some((effect) => (
          effect.do === 'endOperation' && effect.result === 'loss'
        ));
        if (!loses) continue;
        expect(
          constantAtStart(trigger.when),
          `${operation.id}/${trigger.id} loses before the player receives control`,
        ).toBe(false);
      }
    }
  });
});
