/* ==========================================================================
 * VOLTMARCH — tests/campaign-presentation.spec.ts
 * ==========================================================================
 * EVERY PRESENTATION BEAT THE CAMPAIGN PRODUCES MUST HAVE A CONSUMER.
 *
 * `EffectSink` pushes a `PresentationEvent` for three of the eleven frozen
 * effects. `campaign.system.ts` drains the queue every frame and hands each one
 * to `Shell.playCampaignBeat`, which is the ONLY consumer in the tree. Until
 * 2026-08-19 that method's body was a single `if` on `dialogue` — so **every
 * scripted `eva` line and every scripted `cameraMove` in all thirteen shipped
 * operations was authored, validated, evaluated, buffered, drained and
 * dropped.**
 *
 * NOTHING COULD HAVE CAUGHT IT, WHICH IS THE ONLY INTERESTING PART.
 *
 *   - The producing half is provably correct and has its own tests.
 *   - `validateCampaign` refuses an `eva` naming a line outside `EVA_LINES`, on
 *     the stated grounds that "the announcer would say nothing" — a guard on
 *     the NAME, sitting upstream of a consumer that ignored the name entirely.
 *   - Both effects are silent by nature. A dropped beat leaves no exception, no
 *     console line and no pixel.
 *   - `npm run shots` never boots an operation, so no capture could regress it.
 *   - The method's own doc comment said "Dialogue and EVA for now", so a
 *     reader was told the opposite of what the code did.
 *
 * So this spec is deliberately in TWO PARTS, and neither substitutes for the
 * other. Section 1 proves BEHAVIOURALLY which kinds the real sink emits — it
 * calls `makeEffectSink` rather than reading a literal, so a renamed kind is
 * caught. Section 2 compares that set against the kinds the shell's switch
 * NAMES, in BOTH directions: a produced kind with no case is a beat on the
 * floor, and a case for a kind nothing pushes is dead code that will rot into a
 * false comfort.
 *
 * Section 4 is the same rule at the OTHER end of the vocabulary. `EFFECT_KINDS`
 * freezes eleven effects and `CampaignSession.apply` dispatches them through a
 * `switch` whose `default` is `break` — the identical shape to the defect
 * above, one level up. `validateCampaign` refuses an UNKNOWN effect; nothing
 * asserted that every KNOWN one has an arm. All eleven do today, and that is
 * now a fact a test holds rather than a fact somebody checked once.
 *
 * Section 3 is the anti-stub clause. Section 2 alone passes against
 * `case 'eva': return;`, which is the defect wearing a case label — so each arm
 * is pinned to the seam it actually has to reach. THOSE THREE ASSERTIONS ARE
 * THE BRITTLE ONES BY DESIGN: if a seam legitimately moves, update the expected
 * token here in the same commit, and do not delete the assertion to make the
 * move quiet.
 * ========================================================================== */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { World } from '../src/core/world';
import { Channels } from '../src/core/events';
import { makeEffectSink, TagRegistry } from '../src/campaign/runtime';
import { EFFECT_KINDS } from '../src/campaign/types';
import { adoptPreparedOperation, detachOperation, prepareOperation } from '../src/campaign/session';
import type { CampaignSession, ObjectiveRow } from '../src/campaign/session';
import { CAMPAIGNS } from '../src/campaign/index';
import { newOperationState } from '../src/campaign/Director';
import { currentObjectives, objectiveCreditReward } from '../src/shell/PauseMenu';
import {
  CAMPAIGN_OPERATION_IDS,
  campaignOperationIdentity,
} from '../src/shell/CampaignPresentation';
import { curtainLabels } from '../src/shell/Shell';
import type { PresentationEvent } from '../src/campaign/runtime';

const src = (rel: string): string => readFileSync(join(__dirname, '..', rel), 'utf8');

/* ==========================================================================
 * 1. WHAT THE REAL SINK ACTUALLY EMITS
 * ========================================================================== */

/**
 * The three presentation-producing methods, called through the real factory.
 *
 * `makeEffectSink` reads `world.store` at construction and the three methods
 * below touch neither the world nor the channels — they push and return — so a
 * bare `World` is the honest fixture rather than a shortcut. Every OTHER effect
 * needs a built scenario, which is what `campaign-runtime.spec.ts` is for.
 */
function emit(): readonly PresentationEvent[] {
  const world = new World();
  const present: PresentationEvent[] = [];
  const sink = makeEffectSink(world, new Channels(), new TagRegistry(), present, {
    onObjective() { /* unused here */ },
    onEnd() { /* unused here */ },
    onSpawnFault() { /* unused here */ },
  });

  sink.dialogue('Wend', 'The seam is short.');
  sink.eva('missionAccomplished');
  sink.cameraMove({ x: 128, z: 384 });
  return present;
}

describe('the sink emits three presentation kinds, and they are these', () => {
  it('pushes one event per call, in call order', () => {
    const out = emit();
    expect(out.map((e) => e.kind), 'the three presentation effects, in the order called')
      .toEqual(['dialogue', 'eva', 'camera']);
  });

  it('carries the payload each kind needs, and the shell reads exactly these fields', () => {
    const [d, e, c] = emit();
    // `dialogue` is the only kind with two fields, and `speaker` is optional in
    // the type while `text` is what the toast body shows.
    expect(d.speaker).toBe('Wend');
    expect(d.text).toBe('The seam is short.');
    // `eva` carries a KEY OF `EVA_LINES`, not a sentence. `validate.ts` refuses
    // anything else at build time; this pins that the sink passes it through
    // unmodified, because the shell hands it straight to `Eva.say`.
    expect(e.line).toBe('missionAccomplished');
    // `camera` carries a ground point in WORLD metres — x/z, never x/y. The rig
    // takes them in that order and a transposed pair looks like a working
    // camera move to the wrong place.
    expect(c.at).toEqual({ x: 128, z: 384 });
  });
});

/* ==========================================================================
 * 2. EVERY EMITTED KIND HAS A CONSUMER, AND EVERY CONSUMER HAS A PRODUCER
 * ========================================================================== */

/**
 * Source with every comment removed.
 *
 * **THIS EXISTS BECAUSE THE FIRST VERSION OF THIS FILE WAS VACUOUS AND THE
 * CONTROL RUN CAUGHT IT.** Commenting out the one line that reaches the
 * announcer — turning the arm into the exact stub section 3 was written to
 * refuse — left the suite 9/9 GREEN, because `// sayEva(event.line);` still
 * contains the token `sayEva(`. An assertion that a commented-out call
 * satisfies is not an assertion. Every structural read below goes through
 * here; the two negative controls in the header of this section are what
 * proved it necessary and what will prove it again.
 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*/g, ' ');
}

/** The body of `Shell.playCampaignBeat`, from its signature onward, decommented. */
function beatBody(): string {
  const shell = src('src/shell/Shell.ts');
  const at = shell.indexOf('playCampaignBeat(event: {');
  expect(at, 'Shell.playCampaignBeat was renamed or resignatured — this spec reads its body')
    .toBeGreaterThan(-1);
  // The switch is the first thing in the body. The slice is taken BEFORE
  // stripping and is generous, because the arms carry long comments and
  // removing them shortens the body a great deal.
  return stripComments(shell.slice(at, at + 9000));
}

describe('the shell handles every kind the campaign produces', () => {
  const produced = new Set<string>(emit().map((e) => e.kind));
  const body = beatBody();
  const handled = new Set([...body.matchAll(/case '([a-z]+)':/g)].map((m) => m[1]));

  it('is not vacuous in either direction', () => {
    // BOTH SETS, because an empty `handled` would make the subset assertion
    // below fail loudly while an empty `produced` would make it PASS.
    expect(produced.size, 'the sink emitted nothing — section 1 is broken, not the shell').toBe(3);
    expect(handled.size, 'no case was found in playCampaignBeat — the regex or the switch '
      + 'changed shape').toBeGreaterThan(0);
  });

  it('drops nothing: every produced kind is named by a case', () => {
    const dropped = [...produced].filter((k) => !handled.has(k));
    expect(dropped, `playCampaignBeat has no case for ${dropped.join(', ')} — the campaign `
      + 'produces those beats every match and the shell is the only consumer, so they land on '
      + 'the floor exactly as eva and camera did before 2026-08-19').toEqual([]);
  });

  it('carries nothing dead: every case is a kind something pushes', () => {
    const orphan = [...handled].filter((k) => !produced.has(k));
    expect(orphan, `playCampaignBeat handles ${orphan.join(', ')}, which no present.push in `
      + 'runtime.ts produces. Either the sink stopped emitting it — in which case the arm is '
      + 'dead and misleading — or it was never emitted at all.').toEqual([]);
  });

  it('has a total default arm, so a future kind is silent rather than fatal', () => {
    // `PresentationEvent.kind` declares two more names than anything pushes.
    // The arm must exist and must NOT throw: a producer added later would
    // otherwise crash a match mid-operation, and the two assertions above are
    // what turn that case into a red build instead.
    expect(body, 'playCampaignBeat needs a default arm').toMatch(/default:/);
    const tail = body.slice(body.indexOf('default:'));
    expect(tail.slice(0, 400), 'the default arm must not throw — see the comment on it')
      .not.toMatch(/throw /);
  });
});

/* ==========================================================================
 * 3. THE ANTI-STUB CLAUSE
 * ========================================================================== */

describe('each arm reaches the seam it is supposed to reach', () => {
  /*
   * SECTION 2 IS SATISFIED BY `case 'eva': return;`, WHICH IS THE ORIGINAL
   * DEFECT WITH A LABEL ON IT. These three pin the actual destination. They are
   * the most brittle assertions in the file and that is accepted: a seam that
   * moves should cost one line here, in the commit that moves it.
   */
  const body = beatBody();

  const arm = (kind: string): string => {
    const at = body.indexOf(`case '${kind}':`);
    expect(at, `no arm for ${kind}`).toBeGreaterThan(-1);
    const next = body.indexOf('case ', at + 8);
    return body.slice(at, next === -1 ? body.indexOf('default:') : next);
  };

  it('dialogue reaches the HUD toast, duck-typed because the shell may not import the HUD', () => {
    expect(arm('dialogue')).toContain('__vmHud');
  });

  it('eva reaches the announcer', () => {
    // The free function from `AudioEngine`, not `world.audio.eva` — a campaign
    // beat is addressed to the person at the keyboard by construction, so the
    // port's `PlayerId` filter would need a player id invented to satisfy it.
    expect(arm('eva')).toContain('sayEva(');
    expect(stripComments(src('src/shell/Shell.ts')),
      'the announcer accessor must be imported by name')
      .toContain("import { eva as sayEva } from '../audio/AudioEngine';");
  });

  it('camera reaches the rig, and does not snap', () => {
    const a = arm('camera');
    expect(a).toContain('cameraRig.setFocus(');
    // `setFocus`'s third argument is `immediate`. Passing `true` is right for
    // "centre on my base" off a hotkey and wrong for a scripted beat: the
    // player has to be able to tell the camera moved rather than that the map
    // cut. Two arguments means the default, which eases.
    expect(a, 'a scripted cameraMove must not snap — pass x and z only')
      .not.toMatch(/setFocus\([^)]*,[^)]*,[^)]*\)/);
  });
});

/* ==========================================================================
 * 4. THE SAME RULE, ONE LEVEL UP: EVERY FROZEN EFFECT HAS A DISPATCH ARM
 * ========================================================================== */

describe('every effect the vocabulary declares is dispatched', () => {
  /*
   * `CampaignSession.apply` ends in `default: break;`. That is correct — an
   * effect table is data and a malformed one must not crash a match — but it
   * means an effect with no arm is applied by doing nothing at all, which is
   * `playCampaignBeat`'s defect at the layer above.
   *
   * `validateCampaign` does NOT cover this. It refuses an effect whose `do` is
   * not in `EFFECT_KINDS`, which is the opposite direction: it protects the
   * dispatcher from unknown names and leaves known names free to go unhandled.
   */
  const install = stripComments(src('src/campaign/campaign-install.ts'));
  const at = install.indexOf('private apply(e: Effect, sink: EffectSink)');
  const body = install.slice(at, install.indexOf('private setObjective', at));
  const dispatched = new Set([...body.matchAll(/case '([A-Za-z]+)':/g)].map((m) => m[1]));

  it('found the dispatcher at all', () => {
    expect(at, 'CampaignSession.apply was renamed — this spec reads its body').toBeGreaterThan(-1);
    expect(dispatched.size, 'no case found in the dispatcher').toBeGreaterThan(0);
    expect(EFFECT_KINDS.length, 'the frozen vocabulary is eleven effects').toBe(11);
  });

  it('dispatches all eleven, and nothing outside the eleven', () => {
    const missing = EFFECT_KINDS.filter((k) => !dispatched.has(k));
    expect(missing, `${missing.join(', ')} is in EFFECT_KINDS with no arm in `
      + 'CampaignSession.apply, so an operation authoring it would validate, run, and do '
      + 'nothing — the shell beat defect one level up').toEqual([]);

    const extra = [...dispatched].filter((k) => !EFFECT_KINDS.includes(k));
    expect(extra, `${extra.join(', ')} is dispatched but is not in EFFECT_KINDS, so no `
      + 'operation can ever author it and no validator would accept one').toEqual([]);
  });
});

/* ==========================================================================
 * 5. THE PAUSE MENU ASKS THE OPERATION, NOT THE PROFILE
 * ========================================================================== */

/**
 * A session that answers `rows()` and nothing else.
 *
 * `campaignObjectiveView` reads `session.rows()` and no other member, so every
 * other member here is a stub — and the cast is confined to this one function
 * with the read set named, rather than sprayed through the assertions. If the
 * view starts reading a second member this fake will return a stub for it and
 * the test will say something false, which is the honest risk of a fake and
 * the reason the read set is written down.
 */
function installSession(rows: readonly ObjectiveRow[]): void {
  const op = CAMPAIGNS[0].operations[0];
  const fake = {
    op,
    state: newOperationState(op, 0),
    tags: { snapshot: () => [], restore: () => { /* stub */ } },
    simTick: () => { /* stub */ },
    drainPresentation: () => 0,
    rows: () => rows,
    outcome: null,
    reason: '',
    medal: () => 0,
    dispose: () => { /* stub */ },
  } as unknown as CampaignSession;
  prepareOperation(fake);
  adoptPreparedOperation();
}

describe('the pause menu lists the operation, not the skirmish mission chain', () => {
  afterEach(() => { detachOperation(); prepareOperation(null); });

  it('falls through to the profile when no operation is armed', () => {
    // THE FALLBACK IS THE HALF THAT MUST NOT REGRESS. With no session and no
    // `__vmProgression` installed, `readProgression()` is null and the answer
    // is the empty list — which is exactly what a headless skirmish gives, so
    // this pins that a skirmish is unchanged by the campaign branch.
    detachOperation();
    expect(currentObjectives()).toEqual([]);
  });

  it('answers with the operation objectives while one is armed', () => {
    installSession([
      { id: 'tap', title: 'Silence the survey tap', kind: 'primary', status: 'active' },
      { id: 'town', title: 'Leave the derricks standing', kind: 'secondary', status: 'complete' },
    ]);
    const out = currentObjectives();
    expect(out.map((o) => o.title), 'the pause menu read the profile instead of the operation')
      .toEqual(['Silence the survey tap', 'Leave the derricks standing']);
    // The completion flag is what `completedObjectiveCount` — and therefore the
    // autosave scheduler's event trigger — reads. It was permanently 0 during
    // an operation before this.
    expect(out.filter((o) => o.progress.complete).length, 'one objective is complete').toBe(1);
  });

  it('never shows a hidden objective, because that is the point of hiding it', () => {
    // A hidden objective is one the briefing deliberately does not mention.
    // Listing it on the pause screen would disclose it, which is the defect
    // `briefingObjectives()` already exists to prevent on the briefing screen.
    installSession([
      { id: 'seen', title: 'Hold the seam', kind: 'primary', status: 'active' },
      { id: 'secret', title: 'The thing nobody told you', kind: 'secondary', status: 'hidden' },
    ]);
    expect(currentObjectives().map((o) => o.id)).toEqual(['seen']);
  });

  it('shows only a campaign bounty that the runtime actually pays', () => {
    installSession([{
      id: 'paid', title: 'Hold the depot', kind: 'secondary', status: 'active', credits: 700,
    }]);
    const paid = currentObjectives()[0];
    expect(objectiveCreditReward(paid)).toBe('+700 cr');

    const unpaidProfileObjective = { ...paid, creditRewardPaid: undefined };
    expect(objectiveCreditReward(unpaidProfileObjective)).toBe('');
  });
});

/* ==========================================================================
 * 6. THE LOADING CURTAIN NAMES THE OPERATION, NOT A BATTLEFIELD
 * ========================================================================== */

describe('the loading curtain names what the player chose', () => {
  /*
   * `startOperation` sets `setup.map` to the lobby row whose PRESET matches the
   * operation's — deliberately, so that everything reading `setup.map` at least
   * describes the right ground. But the curtain was reading that row's NAME, so
   * a player who clicked "First Tap" on the briefing screen got a full-screen
   * heading reading AIRBASE FLATS. Found by booting an operation and looking;
   * nothing in the suite read the string.
   */
  it('shows the operation and its chapter while one is armed', () => {
    expect(curtainLabels({ title: 'First Tap', chapterTitle: 'Hold the Seam' }, 'Airbase Flats'))
      .toEqual({ kicker: 'Hold the Seam', heading: 'First Tap' });
  });

  it('is unchanged for a skirmish, which is the half that must not regress', () => {
    // The battlefield IS the right answer here — there is nothing else the
    // player named — and 'Loading' is the word the curtain has always shown.
    expect(curtainLabels(null, 'Airbase Flats'))
      .toEqual({ kicker: 'Loading', heading: 'Airbase Flats' });
  });

  it('quotes a real chapter and operation title from the shipped table', () => {
    // THE FALSIFIER. The two cases above would pass against any pair of
    // strings, including a pair no operation carries. This pins that the
    // fields exist on the real table and are non-empty, so the curtain cannot
    // be armed with a blank heading by an operation that forgot a title.
    for (const chapter of CAMPAIGNS) {
      expect(chapter.title.length, `chapter ${chapter.id} has no title`).toBeGreaterThan(0);
      for (const op of chapter.operations) {
        expect(op.title.length, `${op.id} has no title`).toBeGreaterThan(0);
        expect(curtainLabels({ title: op.title, chapterTitle: chapter.title }, 'x').heading)
          .toBe(op.title);
      }
    }
  });
});

describe('shell chrome can identify every campaign operation without loading the campaign chunk', () => {
  it('resolves every shipped operation to its authored title, chapter and faction theme', () => {
    const authored = new Map(CAMPAIGNS.flatMap((chapter) => chapter.operations.map((operation) => [
      operation.id,
      { title: operation.title, chapterTitle: chapter.title, theme: chapter.id },
    ] as const)));

    expect(CAMPAIGN_OPERATION_IDS.length).toBe(authored.size);
    for (const id of CAMPAIGN_OPERATION_IDS) {
      const expected = authored.get(id);
      const identity = campaignOperationIdentity(id);
      expect(identity, `${id} has no lightweight identity for save/load and pause chrome`)
        .not.toBeNull();
      expect(identity?.title).toBe(expected?.title);
      expect(identity?.chapterTitle).toBe(expected?.chapterTitle);
      expect(identity?.theme).toBe(expected?.theme);
    }
  });

  it('returns null for a stale save instead of inventing a campaign name', () => {
    expect(campaignOperationIdentity('allies.99.deleted-operation')).toBeNull();
  });
});

/* ==========================================================================
 * 7. THE TYPE IS DECLARED TWICE, AND NOTHING MADE THE COPIES AGREE
 * ========================================================================== */

describe('both declarations of PresentationEvent stay in step', () => {
  /*
   * `session.ts` and `runtime.ts` each declare `PresentationEvent`, and the
   * duplication is FORCED rather than sloppy: `session.ts` is reachable from
   * the entry chunk and may not import `runtime.ts`, which is the same
   * constraint it already documents for `TagRegistry`. Nothing imports the
   * `runtime.ts` copy at all.
   *
   * What made that dangerous is that the two are kept in step ONLY by
   * structural typing, at `makeEffectSink`'s `present` parameter. Add a field
   * to one and the mismatch surfaces — if it surfaces — as an argument-type
   * error at a call site nowhere near the change, and an OPTIONAL field would
   * not surface at all: `{ kind, at }` is assignable to a type with one more
   * `readonly foo?: string`, in both directions. A `camera` beat carrying a
   * duration the shell never receives would typecheck cleanly.
   *
   * A text comparison is crude and it is the right crude: it is the only thing
   * that sees an optional field. If the two ever legitimately need to differ,
   * this test is where that gets argued.
   */
  const body = (file: string): string => {
    const text = src(file);
    const at = text.indexOf('export interface PresentationEvent {');
    expect(at, `${file} no longer declares PresentationEvent`).toBeGreaterThan(-1);
    const end = text.indexOf(String.fromCharCode(10) + '}', at);
    return stripComments(text.slice(at, end))
      .replace(/\s+/g, ' ')
      .trim();
  };

  it('declare the same fields, field for field', () => {
    const a = body('src/campaign/session.ts');
    const b = body('src/campaign/runtime.ts');
    expect(a, 'the two PresentationEvent declarations have drifted. They cannot be merged — '
      + 'session.ts is entry-chunk reachable and may not import runtime.ts — so the copies have '
      + 'to be edited together').toBe(b);
  });

  it('and the declaration is not empty, which both halves of the above would satisfy', () => {
    // THE VACUITY GUARD. Two failed extractions produce two empty strings and
    // a green comparison.
    const a = body('src/campaign/session.ts');
    expect(a).toContain('kind');
    expect(a).toContain("'dialogue'");
    expect(a.length, 'the extraction collapsed').toBeGreaterThan(80);
  });

  it('covers every kind the sink emits, in both copies', () => {
    // Ties the declarations to section 1's measurement rather than to each
    // other: a union that drops `camera` would still match its twin.
    for (const kind of emit().map((e) => e.kind)) {
      for (const f of ['src/campaign/session.ts', 'src/campaign/runtime.ts']) {
        expect(body(f), `${f} declares no '${kind}' kind`).toContain(`'${kind}'`);
      }
    }
  });
});

/* ==========================================================================
 * 8. TWO LINES FROM ONE SPEAKER ARE QUEUED, NOT OVERWRITTEN
 * ========================================================================== */

describe('a dialogue beat cannot overwrite the line before it', () => {
  /*
   * `ToastStack.push` coalesces on `key` within `TOAST_MERGE` and OVERWRITES
   * the detail node. That is right for its designed use — a repeat of one
   * event, badged "x3" — and its own doc says to pass "whatever makes two of
   * them the same thing". Two different lines of dialogue are not the same
   * thing, and `playCampaignBeat` used to pass `campaign-${speaker}`, so a
   * speaker with two lines inside six seconds lost the first one silently.
   * Nearly every shipped operation opens that way.
   *
   * The campaign communications surface is now the primary consumer. It has
   * to queue while a line is active; the toast key remains unique because the
   * shell deliberately keeps a fallback for headless and older HUD builds.
   */
  const body = beatBody();

  it('the campaign surface receives the line before the toast fallback', () => {
    const arm = body.slice(body.indexOf("case 'dialogue':"), body.indexOf("case 'eva':"));
    expect(arm, 'the dialogue arm no longer reaches the campaign HUD').toContain('campaignDialogue');
    expect(arm, 'headless and older HUD builds still need a readable fallback').toContain('.toast?.(');
  });

  it('the campaign surface queues a second active line', () => {
    const comms = stripComments(src('src/ui/CampaignComms.ts'));
    expect(comms, 'CampaignComms no longer distinguishes idle from active').toContain('this.active === null');
    expect(comms, 'every page arriving while another is active must enter the queue')
      .toContain('this.enqueue(page)');
    expect(comms, 'the queued line must later become the presented line')
      .toContain('this.present(this.queue.shift() as CampaignCommsPage)');
  });

  it('the fallback toast key carries something per-beat, not just the speaker', () => {
    const arm = body.slice(body.indexOf("case 'dialogue':"), body.indexOf("case 'eva':"));
    // The literal that broke it, by name: a template ending right after the
    // speaker. Anything appended to it is enough to stop the merge.
    expect(arm, "keying on `campaign-${speaker}` alone merges two lines of dialogue into one "
      + 'chip and destroys the first — see the comment on the arm')
      .not.toMatch(/`campaign-\$\{event\.speaker \?\? 'line'\}`/);
  });

  it('and the per-beat part is monotonic rather than reset', () => {
    // A counter reset between matches would let two beats collide again, which
    // is the one thing that could bring the defect back.
    const shell = stripComments(src('src/shell/Shell.ts'));
    expect(shell, 'Shell no longer declares the beat sequence').toContain('campaignBeatSeq');
    expect(shell.match(/campaignBeatSeq\s*=\s*0/g) ?? [],
      'campaignBeatSeq is assigned 0 more than once — a reset can make two beats collide')
      .toHaveLength(1);
    expect(shell, 'the sequence must advance on every beat').toContain('this.campaignBeatSeq++');
  });
});
