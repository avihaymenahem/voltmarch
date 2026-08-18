/**
 * ============================================================================
 * VOLTMARCH — src/shell/Campaign.ts
 * ============================================================================
 * THE CAMPAIGN SCREEN AND THE BRIEFING, AND THE REASON THEY ARE ONE FILE.
 *
 * Four chapter cards, an operation list under whichever is chosen, and a
 * briefing that ends in Deploy. They share a lazily-imported operation table,
 * a completion lookup and a medal renderer, and splitting them would mean two
 * modules each holding half of that and agreeing about the other half.
 *
 * ============================================================================
 * IT IMPORTS THE CAMPAIGN LAZILY, LIKE THE MANUAL DOES
 * ============================================================================
 * `Shell.ts` reaches this file through the shell chunk, and this file reaches
 * the operation table through ONE `await import('../campaign/campaign-install')`
 * — the same boundary `Shell.startOperation` uses and the same one
 * `Manual.ts#loadManual` established for the wiki corpus. A player who opens
 * the main menu and never touches Campaign fetches none of it.
 *
 * The promise is memoised and **a rejection is not cached**: a failed fetch on
 * a bad connection must not permanently disable the screen for the session.
 * That is `loadManual`'s rule, copied deliberately.
 *
 * ============================================================================
 * ALL FOUR CHAPTERS OPEN FROM FIRST LAUNCH
 * ============================================================================
 * `docs/MISSIONS_DESIGN.md` says every faction is available from the start and
 * that the call "is not up for re-litigation". The recommended play order —
 * Soviets, Allies, Pact, Reclamation — is A LINE OF COPY on the screen, not a
 * gate, and it is the order the chapter list is already in.
 *
 * What IS gated is the operation: `requires` is a graph edge validated at
 * import, and an operation whose prerequisites are unfinished renders locked
 * with the reason on it rather than being hidden. A row a player cannot see is
 * a row they cannot plan toward.
 * ========================================================================== */

import { el, button, pageFrame, panel } from './Shell';
import type { Screen, Shell } from './Shell';

/* ==========================================================================
 * 1. THE LAZY TABLE
 *
 * Structural types rather than imports of `src/campaign/types.ts`, so the
 * shell chunk carries no static edge into the campaign at all. The shapes are
 * declared here and the compiler checks each side against its own copy — the
 * `SaveContext` / `ServiceContext` arrangement, for the same reason.
 * ========================================================================== */

interface OperationView {
  readonly id: string;
  readonly index: number;
  readonly title: string;
  readonly beat: string;
  readonly parSec: number;
  readonly requires: readonly string[];
  readonly objectives: readonly { id: string; kind: 'primary' | 'secondary'; title: string }[];
}

interface ChapterView {
  readonly id: string;
  readonly title: string;
  readonly blurb: string;
  readonly operations: readonly OperationView[];
}

interface CampaignModule {
  readonly CAMPAIGNS: readonly ChapterView[];
}

let pending: Promise<CampaignModule> | null = null;

/** The operation table, fetched once. A rejection is NOT cached — see the header. */
export function loadCampaign(): Promise<CampaignModule> {
  if (pending === null) {
    pending = import('../campaign/campaign-install')
      .then((m) => m as unknown as CampaignModule)
      .catch((err: unknown) => {
        pending = null;
        throw err;
      });
  }
  return pending;
}

/* ==========================================================================
 * 2. PROGRESS
 *
 * Read off the profile through the same duck-typed handle the objectives panel
 * uses. **A missing handle means NOTHING IS COMPLETE, never everything** — the
 * failure direction matters: the first opens the campaign at operation one,
 * which is where a player with no profile should be; the second would open all
 * 37 and spoil three campaigns.
 * ========================================================================== */

/**
 * A ROW IS A NUMBER. The store writes `Record<string, number>` and the first
 * draft of this file declared `{ medal?: number }` — so `(3)?.medal` was
 * `undefined`, the `?? 1` beneath it turned every completed operation into
 * bronze, and gold was unreachable. Two shapes for one datum, authored on
 * either side of a boundary neither compiler crossed.
 */
interface ProfileProbe {
  profile(): { campaign?: Readonly<Record<string, number>> };
}

function completionOf(): ReadonlyMap<string, number> {
  const out = new Map<string, number>();
  const g = globalThis as { __vmProgression?: unknown };
  const p = g.__vmProgression as Partial<ProfileProbe> | undefined;
  if (p === undefined || typeof p.profile !== 'function') return out;
  try {
    const rows = p.profile().campaign ?? {};
    for (const [id, medal] of Object.entries(rows)) {
      if (typeof medal === 'number' && medal > 0) out.set(id, medal);
    }
  } catch {
    // A profile that throws is a profile with nothing in it, as far as this
    // screen is concerned. It must not take the campaign down with it.
    return out;
  }
  return out;
}

/** Bronze / silver / gold as pips. Never a number — a medal is a shape. */
function medalPips(medal: number): HTMLElement {
  const wrap = el('span', 'vm-camp-medal');
  wrap.setAttribute('aria-label', MEDAL_NAME[medal] ?? 'not completed');
  for (let i = 1; i <= 3; i++) {
    const pip = el('span', 'vm-camp-pip');
    if (i <= medal) pip.classList.add('is-on');
    wrap.appendChild(pip);
  }
  return wrap;
}

const MEDAL_NAME: Readonly<Record<number, string>> = {
  0: 'not completed', 1: 'bronze', 2: 'silver', 3: 'gold',
};

/** `780` -> `13 min`. Par is authored in seconds and shown in minutes. */
function parLabel(sec: number): string {
  return `${Math.round(sec / 60)} min`;
}

/* ==========================================================================
 * 3. THE CHAPTER SCREEN
 * ========================================================================== */

export class CampaignScreen implements Screen {
  readonly id = 'campaign';

  private host: HTMLElement | null = null;
  private disposed = false;

  constructor(private readonly shell: Shell) {}

  mount(host: HTMLElement): void {
    this.host = host;
    host.classList.add('vm-page');
    const { root, body } = pageFrame('Campaign', () => { this.shell.showMenu(); });
    host.appendChild(root);

    const note = el('p', 'vm-camp-note');
    note.append(
      'Four campaigns, open from the start. ',
      el('strong', undefined, 'Soviets first'),
      ' is the recommended order — it is the only one nothing else spoils, and it is the order the '
      + 'factions are easiest to learn in.',
    );
    body.appendChild(note);

    const list = el('div', 'vm-camp-chapters');
    body.appendChild(list);
    list.appendChild(el('p', 'vm-camp-loading', 'Loading operations…'));

    void loadCampaign().then((m) => {
      if (this.disposed) return;
      list.replaceChildren();
      const done = completionOf();
      if (m.CAMPAIGNS.length === 0) {
        list.appendChild(el('p', 'vm-camp-loading', 'No operations have been authored yet.'));
        return;
      }
      for (const ch of m.CAMPAIGNS) list.appendChild(this.chapterCard(ch, done));
    }).catch((err: unknown) => {
      if (this.disposed) return;
      list.replaceChildren();
      // NAMED, not swallowed. A screen that says "Loading…" forever is the
      // failure a player reports as "the campaign button is broken".
      list.appendChild(el('p', 'vm-camp-loading',
        'The campaign could not be loaded. Check the connection and try again.'));
      console.error('[campaign] the operation table failed to load', err);
    });
  }

  private chapterCard(ch: ChapterView, done: ReadonlyMap<string, number>): HTMLElement {
    const card = panel('vm-camp-chapter');
    const head = el('div', 'vm-camp-chapter-head');
    head.appendChild(el('h3', 'vm-camp-chapter-title', ch.title));

    const complete = ch.operations.filter((o) => done.has(o.id)).length;
    head.appendChild(el('span', 'vm-camp-chapter-count',
      `${complete} / ${ch.operations.length}`));
    card.appendChild(head);
    card.appendChild(el('p', 'vm-camp-chapter-blurb', ch.blurb));

    const ops = el('div', 'vm-camp-ops');
    for (const op of ch.operations) ops.appendChild(this.operationRow(ch, op, done));
    card.appendChild(ops);
    return card;
  }

  private operationRow(
    ch: ChapterView, op: OperationView, done: ReadonlyMap<string, number>,
  ): HTMLElement {
    const missing = op.requires.filter((id) => !done.has(id));
    const locked = missing.length > 0;

    const rowEl = el('div', 'vm-camp-op');
    if (locked) rowEl.classList.add('is-locked');

    const num = el('span', 'vm-camp-op-index', String(op.index).padStart(2, '0'));
    rowEl.appendChild(num);

    const text = el('div', 'vm-camp-op-text');
    text.appendChild(el('span', 'vm-camp-op-title', op.title));
    // LOCKED SAYS WHY. "Complete <the previous operation>" is a sentence a
    // player can act on; a padlock is not.
    const sub = locked
      ? `Locked — complete ${missing.map((id) => titleOf(ch, id)).join(' and ')}`
      : op.beat;
    text.appendChild(el('span', 'vm-camp-op-beat', sub));
    rowEl.appendChild(text);

    rowEl.appendChild(el('span', 'vm-camp-op-par', parLabel(op.parSec)));
    rowEl.appendChild(medalPips(done.get(op.id) ?? 0));

    const go = button(done.has(op.id) ? 'Replay' : 'Brief', {
      variant: locked ? 'default' : 'primary',
      disabled: locked,
      onClick: () => { this.shell.openBriefing(op.id); },
    });
    rowEl.appendChild(go);
    return rowEl;
  }

  unmount(): void {
    this.disposed = true;
    this.host?.classList.remove('vm-page');
    this.host = null;
  }

  onBack(): boolean {
    this.shell.showMenu();
    return true;
  }
}

function titleOf(ch: ChapterView, id: string): string {
  return ch.operations.find((o) => o.id === id)?.title ?? id;
}

/* ==========================================================================
 * 4. THE BRIEFING
 *
 * One operation: what it is, what it wants, and Deploy.
 *
 * THE OBJECTIVE LIST HERE IS THE AUTHORED ONE, NOT THE LIVE ONE. It shows
 * every objective the operation declares INCLUDING none of the hidden ones —
 * a briefing that listed a hidden objective would be the operation spoiling
 * its own turn before the player has pressed anything.
 * ========================================================================== */

export class BriefingScreen implements Screen {
  readonly id = 'briefing';

  private host: HTMLElement | null = null;
  private disposed = false;

  constructor(private readonly shell: Shell, private readonly operationId: string) {}

  mount(host: HTMLElement): void {
    this.host = host;
    host.classList.add('vm-page');
    const { root, body, foot } = pageFrame('Briefing', () => { this.shell.openCampaign(); });
    host.appendChild(root);
    body.appendChild(el('p', 'vm-camp-loading', 'Loading…'));

    void loadCampaign().then((m) => {
      if (this.disposed) return;
      const found = findOperation(m, this.operationId);
      body.replaceChildren();
      if (found === null) {
        body.appendChild(el('p', 'vm-camp-loading',
          `No operation '${this.operationId}'. It may have been renamed.`));
        return;
      }
      const { chapter, op } = found;
      body.appendChild(this.render(chapter, op));

      const deploy = button('Deploy', {
        variant: 'primary',
        iconName: 'swords',
        hint: parLabel(op.parSec),
        onClick: () => { void this.shell.startOperation(op.id); },
      });
      foot.appendChild(deploy);
    }).catch((err: unknown) => {
      if (this.disposed) return;
      body.replaceChildren();
      body.appendChild(el('p', 'vm-camp-loading', 'The briefing could not be loaded.'));
      console.error('[campaign] briefing load failed', err);
    });
  }

  private render(chapter: ChapterView, op: OperationView): HTMLElement {
    const wrap = el('div', 'vm-camp-brief');
    wrap.appendChild(el('span', 'vm-camp-brief-chapter', chapter.title));
    wrap.appendChild(el('h3', 'vm-camp-brief-title',
      `${String(op.index).padStart(2, '0')} · ${op.title}`));
    wrap.appendChild(el('p', 'vm-camp-brief-beat', op.beat));

    const objectives = el('div', 'vm-camp-brief-objectives');
    objectives.appendChild(el('h4', 'vm-camp-brief-h4', 'Objectives'));
    for (const kind of ['primary', 'secondary'] as const) {
      for (const o of op.objectives.filter((x) => x.kind === kind)) {
        const line = el('div', `vm-camp-brief-obj is-${kind}`);
        line.appendChild(el('span', 'vm-camp-brief-tag', kind === 'primary' ? 'Primary' : 'Bonus'));
        line.appendChild(el('span', 'vm-camp-brief-obj-text', o.title));
        objectives.appendChild(line);
      }
    }
    wrap.appendChild(objectives);
    return wrap;
  }

  unmount(): void {
    this.disposed = true;
    this.host?.classList.remove('vm-page');
    this.host = null;
  }

  onBack(): boolean {
    this.shell.openCampaign();
    return true;
  }
}

function findOperation(
  m: CampaignModule, id: string,
): { chapter: ChapterView; op: OperationView } | null {
  for (const chapter of m.CAMPAIGNS) {
    const op = chapter.operations.find((o) => o.id === id);
    if (op !== undefined) return { chapter, op };
  }
  return null;
}
