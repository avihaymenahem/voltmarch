# TIPS — BUILD SPEC

A situational in-match tips system: show a strategy tip suited to what is happening, let the player
hide them.

**Commits 1, 2 and 3 are struck. ONE ROW OF §6 REMAINS — the surface.** It is a plan, and a plan that
outlives its execution becomes the most misleading document in the repository — `TODO.md` has done
that twice. Anything here that outlived the work has been moved into the file it describes:
`src/sim/tip-rows.ts` (the content rules, the pair-of-predicates argument, the rows that were cut),
`src/sim/tips.system.ts` (the gate stack, the arbiter, the surface decision) and
`tests/tips-corpus-weight.spec.ts` (the entry-chunk bargain and its arithmetic).

**IT IS NOT DELETED YET AND THE REASON IS MECHANICAL, NOT SENTIMENTAL.** Nineteen citations across
six files point at §2.1, §2.3, §2.4, §3, §4, §6 and §7 by section number — five of them inside
`tests/tips-brownout.spec.ts`, which Commit 3 was required to leave byte-identical. §1 to §5 and §7
are the SURVEY, not the plan; they are what those citations resolve to. Delete this file on the
commit that closes §6's last row, and rewrite those citations in the same commit.

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
`src/shell/tutorial-steps.ts`, a *declared* leak sitting in `index-*.js` today. No rule in the tree
is total over "no authored corpus in the entry chunk"; **writing one is the work, not citing one.**

**CLOSED BY COMMIT 3, AND ONE NUMBER IN THIS PARAGRAPH WAS WRONG.** The rule is
`tests/tips-corpus-weight.spec.ts` and the corpus lives at `src/sim/tip-rows.ts`, eagerly imported
on purpose (see §6, decision 2). The figure this paragraph quoted for the precedent — "33,174 bytes
of prose" — is the RAW FILE SIZE and is not what leaks: comments do not survive the bundler.
Re-measured 2026-08-19 with a string-preserving comment stripper, `tutorial-steps.ts` is **33 122
raw bytes, 17 162 of comment-stripped code, carrying 5 511 bytes of authored prose**. The caps are
set against the last two, not the first.

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

### Commit 3 — DONE 2026-08-19. The table, the corpus, the arbiter and the mute.

`src/sim/tip-rows.ts` (seven rows and three shared walks), `tips.system.ts` generalised from one
hard-coded trigger to a table, `tests/tips-corpus-weight.spec.ts` (the entry-chunk rule §2.4 said had
to be written FIRST), `tests/tips-corpus.spec.ts` (72 cases), §7 of `tests/loading-tips.spec.ts`
widened from two hand-written entries to the whole table, `ToastStack.alerts()` / `.crowded()` plus
their `Hud` seam, and `PROFILE_VERSION` 3 -> 4 for the mute list. **Entry chunk 2 734 234 -> 2 738 528
bytes, +4 294**, measured by an A/B build. `tests/tips-brownout.spec.ts` passes UNCHANGED.

**FIVE DECISIONS, ALL OF THEM AUTHORED RATHER THAN DERIVED, RECORDED HERE WITH WHAT THEY COST.**

1. **THE SURFACE STAYS THE TOAST.** §2.2 stands: a card is a fourth claimant on a frame-share budget
   already at 15.83% against a 12-16% ceiling, and it cannot be photographed — no `?shot=` fixture
   shows a tip, because `simTick` does not run under `advanceFrames`. **The costed next option is a
   WIDER CHIP, not a card**: an `is-tip` variant letting the DETAIL wrap fixes §2.1's actual cause
   (`white-space: nowrap`) inside a claimant already paid for. It was not taken because the evidence
   said it was not needed — see the measurement below. The argument lives in `tips.system.ts`'s
   header, where the next person to open that question will be standing.
2. **THE ROWS LOAD EAGERLY, AND A NEW GATE IS THE PRICE.** `tips.system.ts`'s own header had said
   the rows must move to a lazy module the moment a second one landed; that is OVERRULED, because
   §6's own analysis of the lazy route names its failure mode — `postTip` runs inside `simTick`
   where a dynamic `import()` cannot be awaited, so a warmed-chunk design buys a SILENT NO-TIP.
   `tests/tips-corpus-weight.spec.ts` caps the authored copy at 1024 bytes (this commit: 477) and
   the module's comment-stripped code at 10 240 (this commit: 6 777); both bite at about fifteen
   rows, and the failure message names the lazy route so nobody re-derives this.
3. **EVERY ROW IS A PAIR OF PREDICATES**, and `answeringPower` generalised into `answering()` — the
   tab's queue plus the structures still rising. Three candidates were CUT because the pair
   collapses (there is no in-flight cure to detect): the parked harvester, ore regrowth, and the
   radar. A fourth was cut for reading enemy state. All four are named in `tip-rows.ts`'s header.
4. **A TIP YIELDS TO AN ALERT**, which is §7's arbiter. Two reads on the HUD seam and both are
   refusals: a live `alert` chip, and a full stack — `ToastStack.push` RETIRES THE OLDEST when it is
   full, so a tip arriving at capacity does not queue behind an alert, it deletes one. Plus
   `TIP_SPACING_TICKS`, thirty seconds, because seven rows means two can mature together.
5. **THE MUTE IS PER ROW, PERSISTED, AND AUTOMATIC ON FIRST SHOWING.** Not on an act by the player,
   and the surface decides that: `.vm-toasts` is `pointer-events: none`, so a chip cannot be clicked
   and "dismiss" is not something the player can do. A mute waiting for an act would never fire. The
   only route back is `resetProfile()`, which is stated in `Profile.tipsSeen`'s own doc comment.

**THE MEASUREMENT THAT DECIDED DECISION 1: SEVEN OF SEVEN ROWS FIT 26 AND 44, not fewer than half.**
Titles came out 22-25 against 26 and details 27-40 against 44, with the longest detail two characters
under the limit. Terse is also the right register for something that interrupts a player mid-match.
The widening question is therefore OPEN AND UNTRIGGERED rather than closed: the evidence that would
trigger it is a row that cannot say something true and useful inside those two numbers.

**THE SEVEN ROWS, AND THE SHIPPED CODE EACH CLAIM WAS CHECKED AGAINST.** Every one is re-derived in
`tests/tips-corpus.spec.ts` §1 rather than proof-read.

| key | title / detail | checked against |
|---|---|---|
| `brownout` | Defences go dark first / Build a power plant to bring them back | `POWER_SHED_ORDER.defence` 0, `.refinery` 4; `shedPriority` -> `never` for `IsBuilder` |
| `oreCap` | Ore over the cap is lost / Build a silo to raise your storage | `Economy.deposit` wastes the overflow into `stats.oreWasted`; `oreSilo.storage > 0` |
| `oneFactory` | Two factories, one queue / Build a second one to speed the line | one `ProductionQueue` per `BuildTab`; `factorySpeed(2) > factorySpeed(1)`, capped |
| `repairTool` | Buildings can be mended / Use the repair tool — it costs credits | `RepairSell.tickRepairs` charges `REPAIR_COST_PER_HP` and cancels when broke |
| `repairDepot` | Armour mends at a depot / Build one and park hulls beside it | `DEPOT_KEYS` (imported, not restated); `REPAIR_DEPOT.radius`, `fractionPerSec` |
| `commandPost` | Support powers are bought / Build the structure that opens their tab | the only `producesTabs: [Powers]` rows; every power refused without one |
| `powersIdle` | Powers cost credits too / Buy one from the Powers tab | every Powers entry is `BuildKind.Power` with a positive `cost` |

**THE INSTALL PATH IS ANSWERED IN FULL.** The trigger never needed one — a module joins the game by
existing. The corpus is answered by decision 2: eager, capped, no dynamic import anywhere.

### Commit 4 — THE SURFACE. The only row of §6 still open.

**Not "the card". The question.** A tip has one surface today and two candidate replacements, and
they are not equal in price:

- **A wider chip** (`is-tip` on `.vm-toast`, detail wraps to two or three lines). Cheapest, fixes
  §2.1's cause inside an existing claimant, needs no new frame-share number. **Trigger: a row that
  cannot say something true and useful in 26 and 44 characters.** Seven of seven can today.
- **A card.** Answers "where on screen" — the corner is the objectives panel, top-left is the toast
  stack, `#hud-root` centre is the tutorial coach card, and the bible wants the centre and lower-left
  third clear. Lands with a frame-share number and a `tools/shot-compare.mjs` control capture, or it
  does not land. **And it cannot be photographed**: `simTick` does not run under `advanceFrames`, so
  a fixture would need a new harness affordance before the control capture is even possible.

`postTip` is the seam either one comes through: it replaces the body of one function and the six
gates above it do not move. That is the shape to preserve.

---

## 7. OPEN

Four of this section's five items were closed by Commit 3 and are struck below with what closed
them, because a list of open questions that quietly stops being open is the defect this whole
document is written against.

- ~~**Who writes the corpus, and against what gate?**~~ **CLOSED.** Seven rows in
  `src/sim/tip-rows.ts`, linted by §7 of `tests/loading-tips.spec.ts` — which now iterates
  `TIP_ROWS` rather than naming two strings by hand, so a row that joins the game is linted by
  existing. The second predicate is closed by the same commit: `TipRow.answered` is required by the
  type and by `tests/tips-corpus.spec.ts` §2, and three candidate rows were CUT rather than shipped
  without one.
- **THE KEY RULE IS STRICTER FOR AN IN-MATCH TIP THAN FOR A LOADING TIP, AND NOBODY HAD NOTICED.**
  **STILL OPEN, AND STILL UNTRIGGERED.** Commit 1 fixed `Shell.TIPS` by routing keys through
  `{action.id}` placeholders and `resolveTip`. **There is no such machinery on the in-match side** —
  the rows go straight to the chip — so a key written into a situational tip cannot be repaired the
  way those three were. It can only be a lie or be deleted. No row in the shipped corpus names a
  key, and the lint refuses one that tries. A corpus that genuinely wants to name a key has to bring
  the placeholder machinery with it, and that means the sim reaching the live bindings — a fourth
  host seam, for prose nobody has yet needed to write.
- ~~**Tip versus EVA.**~~ **CLOSED by Commit 3's arbiter.** `postTip` refuses while any live `alert`
  chip stands and while the stack is at `TOAST_MAX`, because `ToastStack.push` retires the oldest
  chip to make room — a tip arriving at capacity deletes somebody's alert rather than queuing behind
  it. The two facts are published by `ToastStack.alerts()` / `.crowded()` and read through `Hud`;
  the VERDICT lives in `postTip`, so the class that owns the chips does not also own the policy.
  The specific instance this bullet named is unchanged and remains deliberate: the brownout tip is
  not a repeat of `EvaLine.LowPower`, it names the shed order and the cure, and by fifteen seconds
  the alarm's 6.5-second chip is long gone.
- **The first skirmish after the tutorial** is still the loudest, most redundant moment for the
  corpus. The cheap answer nobody proposed — seed the muted set from the tutorial's completed steps
  — is now CHEAPER than it was, because `Profile.tipsSeen` exists and `markTipSeen` is on the
  progression handle. It is still not done, and it is a content judgement rather than a mechanism:
  the tutorial teaches placement and orders, and no row of this corpus is about either.
- ~~**`postTip` is the seam every later surface has to come through.**~~ **CONFIRMED, and the shape
  held.** Commit 3 added three gates to it (mute, spacing, arbiter) and moved none of the existing
  ones, and the body is still one `hud.toast` call. §6's last row replaces exactly that call.

---

## 8. FOUND IN PASSING, NOT PART OF THIS FEATURE

- **`Shell.playCampaignBeat` (`Shell.ts:1429-1441`) silently drops every campaign `eva:` effect.** It
  handles `kind === 'dialogue'` only, while its own doc says *"Dialogue and EVA for now"*. Live.
- **`tests/build-descriptions.spec.ts:62` reads `TABS = [Structures, Defense, Infantry, Vehicles]`** —
  omitting `BuildTab.Powers`. The hard-coded-four trap, reproduced *inside the coverage test built to
  catch gaps*.
- **`rclBarricade` (`Defs.ts:2496`) is a third wall** that blocks ground movement via
  `Flowfield.ts:1067`, alongside `wall` and `mrdRampart`.
