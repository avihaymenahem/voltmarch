# TIPS — BUILD SPEC

A situational in-match tips system: show a strategy tip suited to what is happening, let the player
hide them.

**DELETE THIS FILE when the last row of §6 is struck.** Commits 1 and 2 are struck; 3 remains. It is a plan, and a plan that outlives its
execution becomes the most misleading document in the repository — `TODO.md` has done that twice.
Anything here that outlives the work belongs in `CLAUDE.md` or in the file it describes.

Surveyed and adversarially reviewed 2026-08-19 against `308d41f`. Every claim below was checked
against the tree; where a number is quoted, its source is named.

---

## 1. THE FINDING THAT REORDERS THE WORK: A TIPS SYSTEM ALREADY SHIPS, AND IT IS BROKEN

`Shell.TIPS` (`src/shell/Shell.ts:727-737`) is ten strings, one drawn at random per loading screen
(`:3335`). It is `docs/SPEC_DRIFT_AUDIT.md:734-740` entry #27, **still live**.

Three of the ten name keys that are rebindable: `cam.rotateLeft` / `cam.rotateRight` are KeyQ / KeyE
and `ord.attackMove` is KeyA, all `rebindable: true` (`settings-store.ts:332-337`). A player who
remaps them is told the wrong key by their own loading screen.

`grep -rln TIPS tests/` returns **nothing**. It costs the entry chunk **zero bytes** — `main.ts:198`
is `await import('./shell/Shell')` and Shell is its own ~189 kB chunk.

**So the first commit is not new machinery. It is fixing the tips that already ship**, and it
establishes the content rules the corpus inherits before anybody writes a hundred rows.

---

## 2. FOUR WALLS, EACH MEASURED

### 2.1 THE TOAST CANNOT HOLD A TIP

Two surveys proposed reusing `Hud.toast`; one mandated it. **The two refusals are right.**
`src/ui/hud.css:2588-2603` — *both* lines are clipped, not just the detail:

```css
.vm-hud .vm-toast-title  { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.vm-hud .vm-toast-detail { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
```

inside `.vm-toasts { max-width: calc(250 * var(--vm-u)) }`. Not one of the 100 candidate tips fits;
the shortest is 44 + 34 characters. `src/sim/orecrisis.system.ts:313-321` already records a live
capture where the entire instruction fell past the ellipsis.

**MEASURED IN COMMIT 2, AND IT IS WORSE THAN THIS PARAGRAPH'S ARITHMETIC SAYS — THE TWO LINES HAVE
DIFFERENT BUDGETS.** Deriving from the CSS (250u less 22 padding, 13 icon, 8 gap = 207u) gives one
number, about 43 characters, for both. The title inherits `text-transform: uppercase`, weight 600
and `letter-spacing: 0.18em`; the detail is as authored at weight 400 and 0.02em. Chromium,
1280x720, `--vm-u: 1px`, Rajdhani loaded, 203 px box: **title 26 characters, detail 44.** So the
44 + 34 shortest candidate does not merely fail — its FIRST line is 44 characters against a
26-character title. The "about 45" in `orecrisis.system.ts` is a DETAIL-line figure, which is why
nothing caught this until a sentence was put in a title.

The stack is also **already contended**: `TOAST_MAX` is 5, and `EVA_TOASTS` (`Hud.ts:264-285`) turns
15 announcer lines into chips. A tips module posting here competes with *"base under attack"*.

### 2.2 THE HUD FRAME-SHARE BUDGET IS ALREADY OVER

`Hud.hudFrameShare()` measures **15.83%** at 1280x720 against `RA3_LOOK_BIBLE.md` §38's 12–16%
ceiling — *"even the collapsed panel puts the interface over §38's 16% ceiling"*. A tip card is a
**fourth** claimant (HUD + objectives + toasts + card) on a budget with no headroom. Any card lands
with a frame-share number and a `tools/shot-compare.mjs` control capture, or it does not land.

### 2.3 IN-GAME PLAYER COPY MAY NOT CONTAIN DIGITS

`tests/build-descriptions.spec.ts` §4 fails on `/\d/` in any build description, arguing at `:206-216`
that *"a figure retyped here is a second copy nothing compares… comparisons are the supported form
and cost nothing"*.

There are exactly two shipped content models: the **wiki** (digits allowed, `wiki-numbers.spec.ts`
re-derives every one) and **in-game panel copy** (digits banned, mechanically). An in-match tip is
panel copy. There is **no build-time codegen step in this repo**, so "read the tables at build time"
is not available.

**This is load-bearing, not stylistic.** Six candidate tips were spot-checked and three were wrong:

| tip | claim | truth |
|---|---|---|
| 82 | "one in eight is ammunition that goes off" | `WEIGHTS` sum to 100, dud is 8 — **one in twelve and a half** |
| 93 | "nine thousand credits buys the Post and all five powers" | 1500 + 800 + 1200 + 1500 + 2000 + 2500 = **9500** |
| 61 | "an elite does about seventy percent more damage" | `VETERANCY_DAMAGE[2]` is **1.35**. The 1.69 only appears once `vetCooldownMul[2] = 0.8` folds in — a **DPS** claim wearing the word *damage* |

Roughly 50 of 100 candidate rows carry a digit. Banning them deletes the entire re-derivation burden
and kills this class of error by construction.

### 2.4 THE CORPUS WOULD LEAK INTO THE ENTRY CHUNK AND NOTHING WOULD CATCH IT

Both proposed layouts (`src/ui/tips.ts`, `src/ui/tips/tip-rows.ts`) are static edges from an eagerly
globbed `*.system.ts`. Checked against the just-rewritten `tests/campaign-bundle-isolation.spec.ts`:
§1's allow-list (`:508-522`) is scoped to `CAMPAIGN_SYSTEM` **alone**, and §2 (`:745-757`) fires only
on `*.system.ts -> src/shell/**`.

**`src/ui/tips.system.ts -> src/ui/tips/rows.ts` is caught by nothing in the tree.** The precedent is
`src/shell/tutorial-steps.ts` — **33,174 bytes** of prose sitting in `index-*.js` today, a *declared*
leak. No rule in the tree is total over "no authored corpus in the entry chunk"; **writing one is the
work, not citing one.**

---

## 3. TWO TRAPS THAT WOULD HAVE SHIPPED

**`?shot=` runs 10 seconds of presentation with the sim frozen.** `GameLoop.advanceFrames`
(`src/core/loop.ts:858-861`) runs N `renderPass(SIM_DT, …)` with `world.tick` pinned at 0, and
`tools/shoot.mjs` drives 300 of them. **A `dt`-driven tip card fires in all three HUD fixtures,
deterministically and permanently.** A tick-sliced trigger inside `simTick` is structurally immune;
a frame-timer is not.

**Absence of the shell handle must mean OFF, not default-on.** The established idiom is the
opposite — `Hud.ts:149-158` and `input.system.ts:1168-1172` both read `globalThis.__vmSettings` and
**fall back to defaults**, so `gameplay.tips` would default `true` under the harness.
`objectives.system.ts:36-45` gets inertness deliberately and says so. Nobody had written the
inversion down.

---

## 4. THE DECISION NOBODY ARGUED: PvP

Three reports, three different suppression lists. Campaign, replay and tutorial are agreed and all
four predicates are verified entry-chunk-reachable (`campaignRunning()` `policy.ts:85`,
`playbackActive()` `Playback.ts:140`, `activeSession()` `net.system.ts:142`).

**PvP was cut by one report silently and asserted by another silently.** A tip is local-only DOM, it
cannot desync, and a PvP player is arguably the one who most wants ore-crisis-shaped advice.

**DECIDED 2026-08-19: TIPS ARE ON IN PvP.** So the suppression set is campaign, replay and tutorial —
three predicates, not four. Each of those suppresses for a reason a PvP match does not share: a
campaign operation authors its own guidance, a replay is not the viewer's match to advise on, and the
tutorial is already saying something. None of that is true of a skirmish against a person.

**A tip must therefore never read anything a peer does not have**, which is already guaranteed by the
`pi === local` gate the `orecrisis.system.ts` shape uses — but it is now load-bearing rather than
incidental, and the spec covering it should say so.

Note also: `scriptedRunning()` lives in `outcome.system.ts`, a *system module*. A system-to-system
import is a new edge shape — compose `campaignRunning()` and the `__vmTutorial` probe directly.

---

## 5. WHAT IS CUT, AND WHY

Plans here are graded on what they refuse.

- **The digits — ~50 of 100 rows.** §2.3. Keep the comparison form `build-descriptions.spec.ts`
  recommends.
- **The generic-RTS half.** A player who needs *"your army leaves power plants for last"* is being
  taught the genre, not this game. Keep the rows where **this build is surprising and
  wrong-guessable**: the harvester ore-anchor, `Stop` as the park marker, the heaviest draw shedding
  first, the three guns that fire through a blackout (and that the Pact has none), fog not being
  checked, directly-overhead being the safe spot for an aircraft, splash having a vertical term now,
  richest-cell-first mining, terrain not blocking vision.
- **~20 rows that restate wiki prose.** `wiki/` is a build input and the manual is one lazy chunk
  away in Options. A second copy of `Base-Building.md` is exactly the defect
  `docs/SPEC_DRIFT_AUDIT.md` catalogues. Link, do not duplicate.
- **The monotonic fact substrate.** It is the only condition needing `GameEvents` subscriptions and a
  `TutorialFacts`-shaped counter bag, and it buys "you have never used a rally point" — the one class
  of tip that duplicates the tutorial. Dropping it makes the director a **pure function of
  `(HudSnapshot, PlayerState, tick)` with no subscriptions at all**, which is most of what makes the
  rest cheap.
- **Selection-triggered tips.** That is a tooltip, and `gameplay.tooltips` is already a settings row
  with no consumer. Wire that or don't; do not build a second one under another name.
- **A tip that can act.** No button, no queued order. This is the line the whole determinism story
  rests on.
- **An EVA line per tip.** `tests/audio-samples.spec.ts:219-257` requires a manifest entry, a
  committed Ogg and a 0.4–3.0 s render per line, with hand-authored phonemes. Viable for one alert;
  not for a corpus.
- **A frequency slider, a `matchesPlayed` taper, a `minMatches` gate.** An automatic taper is a
  decision made on the player's behalf.

**The tutorial director is ~35% of this, not 80%.** Its `TutorialFacts` are **monotonic counters** —
*"that single shape is why there is not one timer anywhere in this feature"* (`tutorial-steps.ts:59`).
A tip fires on a **state that can become false again**. The counter bag cannot express "no longer
true". Reuse the three-file *split* (pure rules / DOM in the lazy chunk / thin system module) and the
`actionKeyRow` helper; do not reuse the fact model.

---

## 6. THE WORK

### Commit 1 — DONE 2026-08-19 (`570e780`). Fix the tips that already ship.

Route the three key-naming entries in `Shell.TIPS` through `ActionCatalogue`. Add the digit ban. Add
a key lint **written against these four strings as its own falsifier** — the tutorial's existing
`IMPERATIVE_THEN_KEY` / `NAMED_KEY_NOUN` regexes were run against them and **all four pass**, because
those regexes are tuned for imperative voice (*"press A"*) and tips are declarative (*"Q and E rotate
the camera"*). Ported verbatim it would ship a green test over the exact defect it was cited to
close. Retires `SPEC_DRIFT_AUDIT` #27 — which the survey claimed happened as a side effect, and
does not.

### Commit 2 — DONE 2026-08-19. One situation, end to end. The brownout.

`src/sim/tips.system.ts` (`Phase.Economy` order 950, `orecrisis.system.ts`'s shape),
`gameplay.tips` plus its reader plus its Options row, `tests/tips-brownout.spec.ts` (33 cases),
and §7 of `tests/loading-tips.spec.ts` so the new prose is linted by the rules Commit 1 wrote
rather than sitting outside their reach. Entry chunk **+1.78 kB**, measured by an A/B build.

**THE ACCEPTANCE TEST AT THE BOTTOM OF THIS ROW WAS THE POINT, AND ITS ANSWER IS YES.** The tip
DOES fire while the player is already dragging a Power Plant onto the ground, and the arithmetic is
not close. `powerPlant` is `buildTime: 8`; `BuildQueue.advanceTab` divides that by
`player.buildSpeedMul`, which `PowerGrid` drives toward `POWER_BLACKOUT_MUL` 0.25 as the deficit
deepens — *the shortage that caused the brownout is what slows the cure* — and then placement, and
then `CONSTRUCTION_RISE_SECONDS`. Measured in the engine on the ordinary six-building opening
(150 drawn against 100 made, `buildSpeedMul` 0.75): a player who reacts on the FIRST tick of the
brownout is, at fifteen seconds, holding a **finished, unplaced plant with `awaitingPlacement`
true**. The deep case is worse — 32 s of drip against a 15 s hold.

So the hold timer is necessary and not sufficient, and `answeringPower` is the other half: no tip
while a positive-`power` entry sits in the Structures queue or stands `UnderConstruction`. It
deliberately does not reset the hold, so cancelling the plant lets the tip through on the next
survey. **This generalises and it is the main thing Commit 3 inherits** — see §7.

Everything else landed as specified. Two corrections worth carrying:

- **THE TOAST HAS TWO BUDGETS, NOT ONE, AND §2.1's ARITHMETIC GIVES THE WRONG ANSWER FOR THE
  TITLE.** Deriving from the CSS (250u less 22 padding, 13 icon, 8 gap = 207u ≈ 43 characters)
  produces one number for both lines. `.vm-toast-title` inherits `text-transform: uppercase`,
  weight 600 and `letter-spacing: 0.18em`; `.vm-toast-detail` is as authored at weight 400 and
  0.02em. Measured in Chromium at 1280x720, `--vm-u: 1px`, Rajdhani loaded, 203 px box, by growing
  a sentence until `scrollWidth > clientWidth`: **title 26 characters, detail 44.** The 44 is the
  "about 45" `orecrisis.system.ts` records finding live — that chip's long line is its DETAIL,
  which is why the error survived until a sentence went in a TITLE. This commit's own first title
  was 36 characters / 300 px and passed a shared 43-character budget, so the derivation shipped a
  clipped title past a green test before the browser was asked.
- **The tip is therefore two lines, not the one sentence quoted above:** title *"Defences go dark
  first"*, detail *"Build a power plant to bring them back"* — verb first, which is
  `orecrisis.system.ts`'s own hard-won instruction. Both halves still check out against
  `POWER_SHED_ORDER` (defence 0, refinery 4) and `shedPriority`'s `never` for `IsBuilder`, and
  §1 of the spec re-derives them.

`?shot=` immunity is structural and now stated rather than assumed: `GameLoop.advanceFrames` runs
`renderPass` alone and never `stepSim`, so `simTick` does not run under the harness at all; a
fixture's `settleTicks` tops out at 120 against a 450-tick hold; and a `?shot=` boot has no shell,
so `tipsEnabled()` is false. Three independent reasons, which is why no capture moved.

### Commit 3+ — deferred, each with what it unblocks

- **EVERY ROW NEEDS A SECOND PREDICATE, AND COMMIT 2 IS WHY.** A trigger says *the player is in
  this situation*; it does not say *the player has not already dealt with it*. The brownout tip
  fires on a player mid-answer without `answeringPower`, and that is not special to power — "your
  harvester is dead" against a harvester on the line, "you have no radar" against a radar going up,
  "you are at the credit cap" against a silo queued. **A `TipRow` is a pair of predicates, not
  one**, and the second is the expensive half to author because it is the half nobody thinks of.
  Where the row cannot answer it, the tip is wrong content rather than a missing gate.
- **The card.** Answers "where on screen" — the corner is the objectives panel, top-left is the
  toast stack, `#hud-root` centre is the tutorial coach card, and the bible wants the centre and
  lower-left third clear. Needs a frame-share number and a control capture. It now also has a
  measured content argument behind it: the chip holds **26 characters of title and 44 of detail**
  (Commit 2), so the corpus is being written to two hard, unequal and invisible limits.
- **The corpus and its lazy chunk.** **The moment a second tip lands, the bundle rule in §2.4 must be
  written first** — nothing in the tree catches that leak today. Commit 2 kept its single row inside
  `tips.system.ts` for exactly that reason and says so in the file.
- **The mute list.** Needs a `PROFILE_VERSION` bump; belongs to this commit, not earlier.
- **The install path — PARTLY ANSWERED, AND THE REMAINING HALF IS HARDER THAN THE SURVEY THOUGHT.**
  The TRIGGER needs no install path at all: a module joins the game by existing, `tips.system.ts`
  is discovered by glob, and `Shell.startMatch` is untouched. So the `goFullscreen()` /
  transient-activation worry does not apply to Commit 2 and will not apply to the director either.
  The CORPUS is the real problem and it is not a shell question: `postTip` runs inside `simTick`,
  where a dynamic `import()` cannot be awaited, so a lazily chunked corpus arrives one or more
  ticks after the tip was decided. Either the rows load eagerly with a size rule over them, or the
  shell warms the chunk before the match and `postTip` reads a module-level table that may be
  empty — in which case "the corpus had not arrived" is a silent no-tip and needs its own test.

---

## 7. OPEN

- **Who writes the corpus, and against what gate?** The gate is settled: the digit ban and the key
  lint, both in `tests/loading-tips.spec.ts`, which lints §7's situational corpus with the same two
  rules it lints `Shell.TIPS` with. **One lint, one file** — a second copy beside the second corpus
  is how the two would come to disagree. What is NOT settled is the second predicate above: a row
  without an "already answering" clause is a row that talks over the player.
- **THE KEY RULE IS STRICTER FOR AN IN-MATCH TIP THAN FOR A LOADING TIP, AND NOBODY HAD NOTICED.**
  Commit 1 fixed `Shell.TIPS` by routing keys through `{action.id}` placeholders and `resolveTip`.
  **There is no such machinery on the in-match side** — `tips.system.ts` posts strings straight to
  the chip — so a key written into a situational tip cannot be repaired the way those three were.
  It can only be a lie or be deleted. A corpus that wants to name a key has to bring the
  placeholder machinery with it, and that means the sim reaching the live bindings, which is a
  fourth host seam.
- **Tip versus EVA.** `EVA_TOASTS` already converts 15 announcer lines into chips. Nothing
  arbitrates a tip against *"base under attack"* — and Commit 2 adds a live instance of the
  problem rather than a hypothetical one: `Hud.ts` already toasts *"Low power"* with both figures
  on the brownout's crossing edge, and `PowerGrid` fires `EvaLine.LowPower` beside it. The tip is
  the same subject fifteen seconds later. It is deliberately NOT a repeat of the alarm — it names
  the shed order and the cure, which the alarm does not — but two chips about one event is exactly
  what an arbiter would be for.
- **The first skirmish after the tutorial** is the loudest, most redundant moment for the corpus.
  Cheap answer nobody proposed: seed the muted set from the tutorial's completed steps.
- **`postTip` is the seam every later surface has to come through, and it is currently hard-wired
  to `hud.toast`.** The card in Commit 3 replaces the body of one function; the gates above it —
  settings, suppression, host presence — do not move. That is the shape to preserve.

---

## 8. FOUND IN PASSING, NOT PART OF THIS FEATURE

- **`Shell.playCampaignBeat` (`Shell.ts:1429-1441`) silently drops every campaign `eva:` effect.** It
  handles `kind === 'dialogue'` only, while its own doc says *"Dialogue and EVA for now"*. Live.
- **`tests/build-descriptions.spec.ts:62` reads `TABS = [Structures, Defense, Infantry, Vehicles]`** —
  omitting `BuildTab.Powers`. The hard-coded-four trap, reproduced *inside the coverage test built to
  catch gaps*.
- **`rclBarricade` (`Defs.ts:2496`) is a third wall** that blocks ground movement via
  `Flowfield.ts:1067`, alongside `wall` and `mrdRampart`.
