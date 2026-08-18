/**
 * ============================================================================
 * VOLTMARCH — src/campaign/index.ts
 * ============================================================================
 * THE OPERATION TABLE, DISCOVERED BY GLOB AND VALIDATED AT IMPORT.
 *
 * An operation joins the campaign by existing — drop a module under
 * `operations/<chapter>/` that default-exports an `OperationDef`, and a layout
 * under `layouts/` that default-exports a `CampaignLayout`. Nothing is
 * registered by hand. That is the same rule `src/game/Systems.ts` states for
 * systems, and it exists for the same reason: a registration list is a second
 * place to forget something.
 *
 * **`eager: true` IS CORRECT HERE AND WOULD BE WRONG ONE LEVEL UP.** This
 * module is reachable only through `campaign-install.ts`, which is reached only
 * by one `await import()` from `Shell.startOperation` — so everything globbed
 * below lands in the campaign chunk, not the entry chunk, and a player who
 * never opens the campaign never fetches a byte of it. The manual makes the
 * same trade for the same reason (`manual-corpus.ts`).
 *
 * **VALIDATION RUNS AT MODULE LOAD AND THROWS.** An authoring mistake is a
 * build error, not a mission that cannot be finished at minute fourteen of
 * nineteen. `validateCampaign` itself never throws — it returns a fault list,
 * so a spec can feed it a broken campaign and read the messages — and the
 * throwing happens here, once, where the real tables are.
 * ========================================================================== */

import { BUILDINGS, UNITS } from '../data/Defs';
import { UNLOCKS } from '../data/Missions';
import { MAP_PRESETS } from '../core/config';
import { FALLBACK_UNITS, SKIRMISH_ARMIES_MAX } from '../game/Scenarios';
import type { CampaignLayout } from './layout';
import type { ChapterDef, OperationDef } from './types';
import { validateCampaign } from './validate';
import type { CampaignFacts } from './validate';

/* ==========================================================================
 * 1. DISCOVERY
 * ========================================================================== */

interface DefaultExport<T> { readonly default?: T }

const OPERATION_MODULES: Record<string, DefaultExport<OperationDef>> = import.meta.glob(
  './operations/**/*.ts',
  { eager: true },
);

const LAYOUT_MODULES: Record<string, DefaultExport<CampaignLayout>> = import.meta.glob(
  './layouts/*.ts',
  { eager: true },
);

/** Chapter order is the recommended play order, and it is a LIST OF COPY. */
const CHAPTER_ORDER: readonly string[] = ['soviets', 'allies', 'pact', 'reclamation'];

function collectOperations(): readonly OperationDef[] {
  const out: OperationDef[] = [];
  // Sorted by path so the table is stable whatever order the bundler hands
  // the glob back in — an operation list that reorders between builds would
  // move every `requires` forward-reference check with it.
  for (const path of Object.keys(OPERATION_MODULES).sort()) {
    const op = OPERATION_MODULES[path]?.default;
    if (op === undefined) {
      throw new Error(`[campaign] ${path} has no default export — every operation module exports one.`);
    }
    out.push(op);
  }
  return out;
}

export const LAYOUTS: ReadonlyMap<string, CampaignLayout> = (() => {
  const map = new Map<string, CampaignLayout>();
  for (const path of Object.keys(LAYOUT_MODULES).sort()) {
    const l = LAYOUT_MODULES[path]?.default;
    if (l === undefined) {
      throw new Error(`[campaign] ${path} has no default export — every layout module exports one.`);
    }
    if (map.has(l.id)) throw new Error(`[campaign] two layouts both call themselves '${l.id}'.`);
    map.set(l.id, l);
  }
  return map;
})();

/* ==========================================================================
 * 2. THE CHAPTERS
 * ========================================================================== */

const CHAPTER_META: Readonly<Record<string, { title: string; blurb: string }>> = {
  soviets: {
    title: 'Hold the Seam',
    blurb: 'The March surfaces in a new place, and the yards are told it is an output problem.',
  },
  allies: {
    title: 'The Timetable',
    blurb: 'A schedule every refinery on the continent was sited from, and the model behind it.',
  },
  pact: {
    title: 'The Crust',
    blurb: 'Four hundred years of readings, and an argument that cannot be made without conceding it.',
  },
  reclamation: {
    title: 'Salvage Rights',
    blurb: 'Nine breaking yards, every faction as a customer, and the only complete account.',
  },
};

export const CAMPAIGNS: readonly ChapterDef[] = (() => {
  const ops = collectOperations();
  const byChapter = new Map<string, OperationDef[]>();
  for (const op of ops) {
    const list = byChapter.get(op.chapter);
    if (list === undefined) byChapter.set(op.chapter, [op]);
    else list.push(op);
  }

  const out: ChapterDef[] = [];
  for (const id of CHAPTER_ORDER) {
    const list = byChapter.get(id);
    if (list === undefined) continue;
    // BY DECLARED INDEX, NOT BY FILE NAME. The two agree today because the
    // file names carry the index, and `validateCampaign` refuses them if they
    // ever stop agreeing — but sorting by the field means the fault is
    // reported rather than silently absorbed by the sort.
    list.sort((a, b) => a.index - b.index);
    const meta = CHAPTER_META[id];
    if (meta === undefined) throw new Error(`[campaign] chapter '${id}' has no title or blurb.`);
    out.push({ id, faction: list[0].faction, title: meta.title, blurb: meta.blurb, operations: list });
  }

  for (const id of byChapter.keys()) {
    if (!CHAPTER_ORDER.includes(id)) {
      throw new Error(`[campaign] operation declares chapter '${id}', which is not one of ${CHAPTER_ORDER.join(', ')}.`);
    }
  }
  return out;
})();

/* ==========================================================================
 * 3. THE SELF-CHECK
 * ========================================================================== */

/**
 * The world, gathered in ONE place.
 *
 * `validate.ts` deliberately imports none of this — it takes facts — so there
 * is exactly one definition of "what a legal def key is" and no second copy to
 * drift. Exported so `tests/campaign-data.spec.ts` can check the real campaign
 * against the real tables rather than against a fixture.
 */
export function campaignFacts(): CampaignFacts {
  const layoutTags = new Map<string, ReadonlySet<string>>();
  for (const [id, l] of LAYOUTS) layoutTags.set(id, new Set(l.tags));
  return {
    unitKeys: new Set(Object.keys(FALLBACK_UNITS)),
    mapPresets: new Set(Object.keys(MAP_PRESETS)),
    unlockIds: new Set(Object.values(UNLOCKS)),
    layoutTags,
    minArmies: 2,
    maxArmies: SKIRMISH_ARMIES_MAX,
  };
}

/** Every def the game ships, for the roster check below. */
const ALL_TAGGED: ReadonlySet<string> = new Set(
  [...UNITS, ...BUILDINGS]
    .map((d) => d.unlockedBy)
    .filter((u): u is string => typeof u === 'string' && u !== ''),
);

const faults = validateCampaign(CAMPAIGNS, campaignFacts());
if (faults.length > 0) {
  throw new Error(
    `[campaign] ${faults.length} authoring fault(s):\n  ${faults.join('\n  ')}`,
  );
}

/**
 * A TAG THAT EXISTS ON A DEF BUT IN NO `UNLOCKS` ROW WOULD BE REFUSED
 * FOREVER AND EXPLAIN NOTHING.
 *
 * `UnlockGate`'s campaign roster is an ALLOW-LIST, so tagged-and-unlisted means
 * refused. That inverts the default the gate's own header calls central, and
 * the cost is that a def gaining a tag silently narrows every shipped
 * operation. This is the cheap half of catching that: if a def carries an
 * `unlockedBy` no `UNLOCKS` value produces, no roster could ever name it.
 * `tests/campaign-data.spec.ts` carries the expensive half — the id set pinned
 * by value, so a NEW tag fails loudly once instead of narrowing 37 operations
 * quietly.
 */
const KNOWN_UNLOCK_IDS: ReadonlySet<string> = new Set<string>(Object.values(UNLOCKS));

for (const tag of ALL_TAGGED) {
  if (!KNOWN_UNLOCK_IDS.has(tag)) {
    throw new Error(
      `[campaign] a def carries unlockedBy '${tag}', which is in no UNLOCKS row. `
      + 'No operation roster could ever name it, so it would be refused for the whole campaign.',
    );
  }
}

/* ==========================================================================
 * 4. LOOKUP
 * ========================================================================== */

const BY_ID: ReadonlyMap<string, OperationDef> = (() => {
  const map = new Map<string, OperationDef>();
  for (const ch of CAMPAIGNS) for (const op of ch.operations) map.set(op.id, op);
  return map;
})();

export function operationById(id: string): OperationDef | null {
  return BY_ID.get(id) ?? null;
}

export function chapterOf(op: OperationDef): ChapterDef | null {
  return CAMPAIGNS.find((c) => c.id === op.chapter) ?? null;
}
