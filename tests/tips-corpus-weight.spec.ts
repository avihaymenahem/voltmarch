/**
 * ============================================================================
 * tests/tips-corpus-weight.spec.ts — THE TIP CORPUS RIDES IN THE ENTRY CHUNK,
 * AND THIS IS THE PRICE OF THAT DECISION
 * ============================================================================
 * `src/game/Systems.ts` globs `'../**\/*.system.ts'` with `eager: true` FROM
 * THE ENTRY CHUNK. So everything `src/sim/tips.system.ts` statically imports is
 * fetched, parsed and executed before the first paint — by a player who opens a
 * skirmish, by a player who opens the main menu and quits, and by
 * `npm run shots`, thirteen times. `src/sim/tip-rows.ts` is on that edge, ON
 * PURPOSE, and this file is what makes the purpose enforceable.
 *
 * ── WHY EAGER AT ALL, GIVEN THE OBVIOUS ALTERNATIVE ────────────────────────
 * `postTip` runs inside `simTick`, where a dynamic `import()` cannot be
 * awaited. A lazily chunked corpus therefore arrives one or more TICKS after
 * the tip was decided, and the warmed-chunk design that papers over it — the
 * shell fetches the chunk before the match, `postTip` reads a module-level
 * table that may still be empty — buys a SILENT NO-TIP as its failure mode. No
 * exception, no console line, no pixel; exactly the class of defect
 * `docs/SPEC_DRIFT_AUDIT.md` catalogues. Paying for that to save well under a
 * kilobyte against a 2 734 234-byte entry chunk is a bad trade.
 *
 * IT IS A BAD TRADE AT THIS SIZE AND A GOOD ONE AT SOME OTHER SIZE, AND
 * NOTHING IN THE TREE COULD TELL THE DIFFERENCE. This file's weight contract
 * checked: `tests/campaign-bundle-isolation.spec.ts` §1 is scoped to
 * `CAMPAIGN_SYSTEM` alone and its §2 fires only on `*.system.ts -> src/shell/**`,
 * so `src/sim/tips.system.ts -> src/sim/tip-rows.ts` is caught by nothing. The
 * precedent for what happens then is `src/shell/tutorial-steps.ts`, a DECLARED
 * leak: measured 2026-08-19 it is 33 122 raw bytes, **17 162 of comment-stripped
 * code carrying 5 511 bytes of authored prose**, and it is in `index-*.js`
 * today.
 *
 * (Both this file's earlier draft and the spec quoted the RAW 33 kB as the
 * leak. It is not — comments do not survive the bundler. The stripped figure is
 * the honest one and it is what the caps below are set against.)
 *
 * ── TWO CAPS, BECAUSE TWO DIFFERENT THINGS LEAK ────────────────────────────
 *   §2  PROSE — every authored character in `TIP_ROWS`. This is what a corpus
 *       grows: rows, not machinery.
 *   §3  CODE — the module with its comments stripped and its lines trimmed.
 *       This bounds the PREDICATES, which is the half a prose cap cannot see;
 *       a row is a pair of closures and those are real bytes too.
 *
 * A corpus that trips either one has outgrown the eager decision. **MOVE IT.
 * DO NOT RAISE THE NUMBER** — `OVER_BUDGET` below says so in the failure the
 * next author will actually read, and §5 asserts that it does.
 *
 * ── THE FALSIFIERS ─────────────────────────────────────────────────────────
 * Every cap here is an assertion that a number is SMALL, and a number is small
 * for two reasons: the thing is small, or the thing is gone. So §4 runs the
 * identical measuring functions over a synthetic hundred-row corpus and
 * requires both caps to FAIL, and §1 runs the import detector over sources that
 * do and do not contain the edge. A rule nobody has seen fire is a rule nobody
 * knows works.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { TIP_ROWS } from '../src/sim/tip-rows';

const ROOT = process.cwd();

/**
 * THE ONE DECLARED MODULE. `src/sim/tips.system.ts` may import authored tip
 * prose from here and from nowhere else, and §1 is what says so.
 */
const CORPUS = 'src/sim/tip-rows.ts';
const DIRECTOR = 'src/sim/tips.system.ts';

const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

/* ==========================================================================
 * 0. THE INSTRUMENTS
 *
 * `stripComments` is a fourth copy of a shape `tests/campaign-bundle-isolation
 * .spec.ts` already carries, and that is deliberate rather than lazy: importing
 * it would mean one spec file importing another, which vitest supports and this
 * repo does nowhere, and the two want different outputs anyway (that one wants
 * import statements, this one wants a byte count). It is small enough to be
 * checked by eye and §0 checks it by test instead.
 * ========================================================================== */

const BACKSLASH = String.fromCharCode(92);

/**
 * Drop `//` and block comments, keep every string and template literal intact.
 *
 * STRINGS MUST SURVIVE, because the prose IS strings — a stripper that ate them
 * would report a corpus of a thousand rows as weightless. Comments must NOT,
 * because the bundler drops them and a rule that counted them would fail this
 * project's own house style rather than its bundle.
 */
function stripComments(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      out += c;
      i++;
      while (i < src.length) {
        const d = src[i];
        out += d;
        i++;
        if (d === BACKSLASH) { out += src[i] ?? ''; i++; continue; }
        if (d === quote) break;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** Comment-free, line-trimmed, blank-line-free. The bytes the bundler keeps. */
function codeBytes(src: string): number {
  return stripComments(src)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n')
    .length;
}

/** Every authored character in a corpus. Keys count: they ship as strings too. */
function proseBytes(rows: readonly { key: string; title: string; detail: string }[]): number {
  let total = 0;
  for (const r of rows) total += r.key.length + r.title.length + r.detail.length;
  return total;
}

/** Does `src` STATICALLY import `spec`? Comments are not imports. */
function importsStatically(src: string, spec: string): boolean {
  const code = stripComments(src);
  const quoted = `'${spec}'`;
  const dquoted = `"${spec}"`;
  for (const form of [quoted, dquoted]) {
    const at = code.indexOf(form);
    if (at < 0) continue;
    const before = code.slice(0, at);
    // The last `import` or `export ... from` before the specifier, and no
    // `import(` between them — that would be the dynamic form.
    const kw = Math.max(before.lastIndexOf('import'), before.lastIndexOf('export'));
    if (kw < 0) continue;
    if (code.slice(kw, at).includes('import(')) continue;
    return true;
  }
  return false;
}

describe('the instruments can be trusted with the rest of this file', () => {
  it('strips comments and keeps strings', () => {
    expect(codeBytes('/* a very long banner comment */\nconst x = 1;')).toBe('const x = 1;'.length);
    expect(codeBytes("const s = 'kept';")).toBe("const s = 'kept';".length);
    // A comment character INSIDE a string is not a comment.
    expect(codeBytes("const s = 'a // b';")).toBe("const s = 'a // b';".length);
  });

  it('does not read a specifier in a comment as an import', () => {
    expect(importsStatically(`// see './tip-rows'\nconst x = 1;`, './tip-rows')).toBe(false);
    expect(importsStatically(`import { A } from './tip-rows';`, './tip-rows')).toBe(true);
  });

  it('tells the static form from the dynamic one', () => {
    expect(importsStatically(`const m = await import('./tip-rows');`, './tip-rows')).toBe(false);
  });
});

/* ==========================================================================
 * 1. ONE MODULE, ONE IMPORTER
 *
 * The eager decision is only defensible while the corpus is ONE file with ONE
 * consumer. Two files is two things to weigh and nobody would weigh the second;
 * two consumers is a second eager root reaching in from somewhere this file
 * never looks.
 * ========================================================================== */

describe('the corpus is one declared module behind one static edge', () => {
  it('the director imports it statically, which is what makes it eager', () => {
    expect(importsStatically(read(DIRECTOR), './tip-rows')).toBe(true);
  });

  /**
   * COMMENTS ARE STRIPPED FIRST, AND THAT IS NOT A DETAIL. The first draft of
   * this case grepped the raw source and named `src/sim/RepairSell.ts`, which
   * imports nothing — it MENTIONS this corpus, in the banner over `DEPOT_KEYS`,
   * explaining why that constant is exported. A rule that reads prose as code
   * fails on the file that documented the boundary correctly, which is the
   * lesson `tests/campaign-bundle-isolation.spec.ts` §0 already paid for.
   */
  it('nothing else under src/ imports it', () => {
    const others: string[] = [];
    for (const rel of walkSrc()) {
      if (rel === CORPUS || rel === DIRECTOR) continue;
      if (stripComments(read(rel)).includes('tip-rows')) others.push(rel);
    }
    expect(others, 'a second importer is a second eager root nothing here weighs').toEqual([]);
  });

  /**
   * The sim may not reach into the front end, and a corpus is exactly the file
   * somebody would be tempted to give a `Hud` import to. `tips.system.ts`
   * duck-types every host seam off `globalThis` for this reason; the rows
   * inherit the rule rather than restating it.
   */
  it('reaches neither the shell nor the UI', () => {
    const code = stripComments(read(CORPUS));
    expect(code).not.toContain('../shell/');
    expect(code).not.toContain('../ui/');
  });

  /**
   * `tips.system.ts` deliberately keeps tips ON in PvP, and the property that
   * makes that safe is that nothing in this feature reads a fact a peer does
   * not have. `tests/tips-brownout.spec.ts` §6 asserts it on the director's
   * source; the corpus is the other half and would be the easier place to
   * break it, because a row is where somebody would reach for a session.
   */
  it('consults no multiplayer predicate', () => {
    const code = stripComments(read(CORPUS));
    expect(code).not.toContain('activeSession');
    expect(code).not.toContain('net.system');
  });
});

function walkSrc(): string[] {
  const out: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name);
      if (statSync(abs).isDirectory()) walk(abs, `${prefix}${name}/`);
      else if (name.endsWith('.ts')) out.push(`${prefix}${name}`);
    }
  };
  walk(join(ROOT, 'src'), 'src/');
  return out;
}

/* ==========================================================================
 * 2. THE PROSE CAP
 *
 * ── THE ARITHMETIC ─────────────────────────────────────────────────────────
 * A row's authored copy is bounded by the chip: 26 characters of title, 44 of
 * detail (measured in Chromium, `tests/tips-brownout.spec.ts` §4), plus a key
 * of about ten. So the WORST a row can weigh is ~80 bytes and the shipped
 * average is ~68.
 *
 *   this commit, 7 rows           477 bytes   (measured; 68 a row)
 *   the cap                      1024 bytes   -> 2.15x headroom, ~15 rows
 *   a hundred-row corpus         6814 bytes   -> 6.7x over. Trips. §4.
 *   tutorial-steps.ts prose      measured live -> the leak not to repeat
 *
 * 1024 is chosen so the NEXT author can add two or three rows without
 * ceremony, and the sixteenth forces the conversation. The entry-budget contract
 * scoped this corpus at six to twelve rows; a cap at fifteen sits one step
 * outside the design and five steps inside the leak.
 * ========================================================================== */

/** Authored characters across the whole corpus. */
const TIP_PROSE_CAP = 1024;
/** Comment-stripped bytes of the corpus module. */
const TIP_CODE_CAP = 10240;

/**
 * The failure the next author reads. It has to name the way OUT, or they will
 * do the one thing this rule exists to prevent and raise the number.
 */
function overBudget(what: string, got: number, cap: number): string {
  return `${what}: ${got} bytes against a cap of ${cap}. DO NOT RAISE THIS NUMBER. `
    + 'The corpus has outgrown riding in the entry chunk. Move the rows behind a '
    + 'lazy `await import()` warmed by the shell before the match, have `postTip` '
    + 'read a module-level table that may still be empty, and write the test for '
    + 'the silent no-tip that design introduces. See the header of '
    + '`src/sim/tip-rows.ts`.';
}

describe('the authored copy stays under a kilobyte', () => {
  it('is inside the prose cap', () => {
    const got = proseBytes(TIP_ROWS);
    expect(got, overBudget('tip corpus prose', got, TIP_PROSE_CAP))
      .toBeLessThanOrEqual(TIP_PROSE_CAP);
  });

  /**
   * THE HEADROOM IS PART OF THE CLAIM. A cap the shipped corpus sits against is
   * not a cap, it is a tripwire under the current commit — the next honest row
   * would fail a rule that was never about it. This pins that the number was
   * chosen with room in it.
   */
  it('leaves room for several more rows', () => {
    const got = proseBytes(TIP_ROWS);
    expect(got * 2, 'the cap must be comfortably above what ships')
      .toBeLessThanOrEqual(TIP_PROSE_CAP);
  });

  /** And below the leak it is set against. */
  it('is set below the declared leak it exists to prevent repeating', () => {
    // `src/shell/tutorial-steps.ts`, measured live rather than quoted.
    const tutorialProse = stringLiteralBytes(read('src/shell/tutorial-steps.ts'));
    expect(tutorialProse).toBeGreaterThan(TIP_PROSE_CAP * 4);
  });
});

/** Bytes of string-literal CONTENT outside comments. The prose of a module. */
function stringLiteralBytes(src: string): number {
  const code = stripComments(src);
  let total = 0;
  let i = 0;
  while (i < code.length) {
    const c = code[i];
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      i++;
      while (i < code.length) {
        const d = code[i];
        i++;
        if (d === BACKSLASH) { i++; continue; }
        if (d === quote) break;
        total++;
      }
      continue;
    }
    i++;
  }
  return total;
}

/* ==========================================================================
 * 3. THE CODE CAP
 *
 * ── THE ARITHMETIC ─────────────────────────────────────────────────────────
 * A prose cap alone would let a corpus grow without limit in the half that is
 * actually expensive: every row is a pair of closures, and this file's three
 * shared walks are what stop them being written out seven times.
 *
 *   this module, stripped         6 777 bytes  (measured)
 *   the cap                      10 240 bytes  -> 1.51x headroom
 *   a hundred-row corpus         ~15 kB of table ALONE. Trips. §4.
 *   tutorial-steps.ts stripped   measured live -> the leak not to repeat
 *
 * THE TWO CAPS ARE SET TO BITE IN THE SAME PLACE, at about fifteen rows. The
 * fixed machinery here — three shared walks, six named matches, two world
 * reads — is ~4.3 kB of the 6.8, and a row costs roughly 350 stripped bytes on
 * top of its 68 of prose. So 10 240 buys about nine more rows and 1 024 buys
 * about eight, which is the point: whichever way a corpus grows, it runs into
 * the same conversation at the same size rather than sneaking past one rule by
 * being shaped like the other.
 * ========================================================================== */

describe('the corpus module stays small enough to be worth shipping eagerly', () => {
  it('is inside the code cap', () => {
    const got = codeBytes(read(CORPUS));
    expect(got, overBudget('tip corpus code', got, TIP_CODE_CAP))
      .toBeLessThanOrEqual(TIP_CODE_CAP);
  });

  it('is set below the declared leak it exists to prevent repeating', () => {
    const leak = codeBytes(read('src/shell/tutorial-steps.ts'));
    expect(TIP_CODE_CAP, 'a cap above the thing it forbids forbids nothing').toBeLessThan(leak);
  });

  /**
   * The DIRECTOR is not capped, and that is on purpose: it is machinery with a
   * fixed size, not a corpus, and every byte of it is load-bearing whatever the
   * rows do. What must stay true is that it holds no rows — the corpus is one
   * module, and a row smuggled back into `tips.system.ts` would weigh nothing
   * here and everything in the entry chunk.
   */
  it('the director declares no tip prose of its own', () => {
    const code = stripComments(read(DIRECTOR));
    expect(code).not.toMatch(/title:\s*['"]/);
    expect(code).not.toMatch(/detail:\s*['"]/);
  });
});

/* ==========================================================================
 * 4. THE FALSIFIER — A HUNDRED ROWS TRIPS BOTH CAPS
 *
 * Built from the SHIPPED rows so the synthetic corpus is not a straw man: it
 * is this commit's own copy, at this commit's own average length, a hundred
 * times. If the real corpus ever reached that size the caps must fire, and
 * this is the only way to know they would without shipping it.
 * ========================================================================== */

describe('a hundred-row corpus is refused by both caps', () => {
  const hundred = Array.from({ length: 100 }, (_, i) => {
    const src = TIP_ROWS[i % TIP_ROWS.length];
    return { key: `${src.key}${i}`, title: src.title, detail: src.detail };
  });

  it('trips the prose cap', () => {
    expect(proseBytes(hundred)).toBeGreaterThan(TIP_PROSE_CAP);
  });

  it('trips the code cap', () => {
    // The table alone, MINIFIED — no comments, no helpers, no header, no
    // indentation, and every predicate a stub. A real hundred-row module is
    // strictly larger than this, so a synthetic that trips is a real one that
    // trips harder.
    const synthetic = hundred
      .map((r) => `{key:'${r.key}',title:'${r.title}',detail:'${r.detail}',`
        + `holdTicks:450,situation:(c)=>false,answered:(c)=>false},`)
      .join('\n');
    expect(codeBytes(synthetic)).toBeGreaterThan(TIP_CODE_CAP);
  });

  /**
   * AND THE MARGIN IS NOT A ROUNDING ERROR. A cap a hundred rows only just
   * exceeds would be a cap that lets ninety through, which is not the rule this
   * file claims to be.
   */
  it('by a margin, not by a byte', () => {
    expect(proseBytes(hundred)).toBeGreaterThan(TIP_PROSE_CAP * 4);
  });
});

/* ==========================================================================
 * 5. THE MESSAGE IS THE RULE
 *
 * A cap whose failure says only "expected 9000 to be <= 8192" gets raised to
 * 9216 by the next person in a hurry, and they will be right to, because
 * nothing told them there was an argument behind it. The argument travels in
 * the message or it does not travel.
 * ========================================================================== */

describe('the failure names the way out', () => {
  const msg = overBudget('x', 2, 1);

  it('forbids the obvious fix', () => {
    expect(msg).toContain('DO NOT RAISE THIS NUMBER');
  });

  it('names the lazy route and the cost it carries', () => {
    expect(msg).toContain('await import()');
    expect(msg).toContain('silent no-tip');
  });

  it('points at the file that holds the argument', () => {
    expect(msg).toContain('src/sim/tip-rows.ts');
  });
});
