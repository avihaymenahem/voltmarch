/* ==========================================================================
 * VOLTMARCH — tests/campaign-citations.spec.ts
 * ==========================================================================
 * A COMMENT THAT NAMES A SYMBOL OR A SPEC IS MAKING A CHECKABLE CLAIM.
 *
 * `src/campaign/**` is the densest prose in the repo, and on 2026-08-19 an
 * audit of its three contract files checked 124 factual claims and found 24
 * false. Most of those needed a headless build to catch. **Two kinds did not**,
 * and both had propagated by copy-paste through most of a chapter:
 *
 *   - `Shell.applyEconomyPostBoot` was cited by SEVEN operation files, eight
 *     times, as the method that writes `startingCredits` into every non-Neutral
 *     slot. There is no such method. It is `applySimPostBoot`, and the first
 *     file to get it wrong was copied by every file after it.
 *   - `tests/campaign-wiring.spec.ts`, `tests/campaign-reachability.spec.ts`
 *     and `tests/campaign-data.spec.ts` were all cited as shipped mechanisms.
 *     None existed. The third was the expensive one: `UnlockGate.ts` names it
 *     as the thing that catches a defect CLAUDE.md calls "not fixable by
 *     changing the default", and nothing was catching it at all.
 *
 * Both are mechanically checkable, so from here they are checked.
 *
 * ── WHY ONLY THESE TWO SHAPES ───────────────────────────────────────────────
 * The campaign's prose cites dozens of symbols — `Combat.engage`,
 * `Targeting.reachOf`, `EffectSink.spawnUnits`, `ARMOR_MATRIX[Tesla][Infantry]`.
 * A general "every `Foo.bar` must exist" lint would be mostly noise: half of
 * those are types, half are described rather than named, and the false-positive
 * rate would get the file disabled. `Shell.<x>` and `tests/<x>.spec.ts` are
 * unambiguous, are the two that actually rotted, and can be checked without a
 * judgement call. Widen it when a third shape burns somebody, not before.
 *
 * ── THE ALLOW-LIST FAILS IN BOTH DIRECTIONS, WHICH IS THE POINT ─────────────
 * Prose that names a missing file IN ORDER TO SAY IT IS MISSING is honest and
 * must stay legal — `types.ts` carries exactly one. So `KNOWN_ABSENT` is an
 * `OVER_BAND`-shaped exception table: an entry that starts existing FAILS, so
 * nobody can write the spec and leave the comment saying it does not exist.
 * ========================================================================== */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO = join(__dirname, '..', '..', '..');
const CAMPAIGN = join(REPO, 'apps/game/src', 'campaign');

/**
 * Specs named in campaign prose that deliberately do NOT exist.
 *
 * Each entry must be a citation whose own sentence says the file is absent. An
 * entry that starts existing fails the second assertion below — so creating
 * `campaign-wiring.spec.ts` forces somebody to come back here and to the
 * comment that describes it as missing. Empty today: every cited spec exists.
 */
const KNOWN_ABSENT: Readonly<Record<string, string>> = {};

/** Every `.ts` under `src/campaign/`, recursively. */
function campaignFiles(dir = CAMPAIGN): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...campaignFiles(p));
    else if (name.endsWith('.ts')) out.push(p);
  }
  return out;
}

const FILES = campaignFiles();
const rel = (p: string): string => p.slice(REPO.length + 1).replace(/\\/g, '/');

/* ==========================================================================
 * 1. EVERY `Shell.<x>` NAMES A REAL MEMBER
 * ========================================================================== */

describe('campaign prose cites Shell members that exist', () => {
  const shell = readFileSync(join(REPO, 'apps/game/src', 'shell', 'Shell.ts'), 'utf8');
  const cited: { file: string; name: string }[] = [];
  for (const f of FILES) {
    // Backtick-delimited, because that is how this repo writes a code
    // reference in prose. A bare `Shell.foo` in a sentence is rare and the
    // backtick form is what every real offender used.
    for (const m of readFileSync(f, 'utf8').matchAll(/`Shell\.(\w+)/g)) {
      cited.push({ file: rel(f), name: m[1] ?? '' });
    }
  }

  it('found campaign files and Shell citations at all', () => {
    expect(FILES.length, 'no .ts files under src/campaign').toBeGreaterThan(20);
    expect(cited.length, 'no `Shell.x` citation found — the regex or the house style changed')
      .toBeGreaterThan(3);
  });

  it('every cited member appears in Shell.ts', () => {
    const missing = cited.filter((c) => !new RegExp(`\\b${c.name}\\b`).test(shell));
    expect([...new Set(missing.map((c) => `${c.file}: Shell.${c.name}`))],
      'these name a method Shell.ts does not have. `Shell.applyEconomyPostBoot` was cited by '
      + 'seven operation files, eight times, and never existed — the real name is '
      + '`applySimPostBoot`, and every file after the first inherited the mistake by copy.')
      .toEqual([]);
  });
});

/* ==========================================================================
 * 2. EVERY CITED SPEC EXISTS, OR IS DECLARED ABSENT
 * ========================================================================== */

describe('campaign prose cites specs that exist', () => {
  const cited: { file: string; spec: string }[] = [];
  for (const f of FILES) {
    for (const m of readFileSync(f, 'utf8').matchAll(/tests\/([\w.-]+\.spec\.ts)/g)) {
      cited.push({ file: rel(f), spec: m[1] ?? '' });
    }
  }

  it('found spec citations at all', () => {
    expect(cited.length, 'no `tests/x.spec.ts` citation found — the scan is broken')
      .toBeGreaterThan(5);
  });

  it('every cited spec exists, unless it is declared absent', () => {
    const missing = cited.filter(
      (c) => !existsSync(join(REPO, 'apps/game/tests', c.spec)) && KNOWN_ABSENT[c.spec] === undefined,
    );
    expect([...new Set(missing.map((c) => `${c.file}: tests/${c.spec}`))],
      'these cite a spec that does not exist. `UnlockGate.ts` cited '
      + '`tests/campaign-data.spec.ts` as the mechanism catching a defect CLAUDE.md calls "not '
      + 'fixable by changing the default", and nothing was catching it at all. Either write the '
      + 'spec, or rewrite the comment and add the name to KNOWN_ABSENT with the reason.')
      .toEqual([]);
  });

  it('and nothing in KNOWN_ABSENT has quietly started existing', () => {
    // THE OTHER DIRECTION, and it is what stops this table from becoming a
    // place to hide citations. Writing `campaign-wiring.spec.ts` must force
    // somebody back to the comment that says it does not exist.
    const arrived = Object.keys(KNOWN_ABSENT).filter(
      (s) => existsSync(join(REPO, 'apps/game/tests', s)),
    );
    expect(arrived, `${arrived.join(', ')} now exists. Remove it from KNOWN_ABSENT and rewrite `
      + 'the comment that describes it as a planned deliverable.').toEqual([]);
  });

  it('and every KNOWN_ABSENT entry is still cited by something', () => {
    // A third direction, cheap: an exception for a citation nobody makes any
    // more is dead weight that reads as a live caveat.
    const orphan = Object.keys(KNOWN_ABSENT).filter((s) => !cited.some((c) => c.spec === s));
    expect(orphan, `${orphan.join(', ')} is exempted but no longer cited anywhere — drop it`)
      .toEqual([]);
  });
});
