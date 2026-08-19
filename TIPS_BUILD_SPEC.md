# TIPS — BUILD SPEC

A situational in-match tips system: show a strategy tip suited to what is happening, let the player
hide them.

**DELETE THIS FILE when the last row of §6 is struck.** It is a plan, and a plan that outlives its
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

### Commit 1 — fix the tips that already ship. Zero new machinery.

Route the three key-naming entries in `Shell.TIPS` through `ActionCatalogue`. Add the digit ban. Add
a key lint **written against these four strings as its own falsifier** — the tutorial's existing
`IMPERATIVE_THEN_KEY` / `NAMED_KEY_NOUN` regexes were run against them and **all four pass**, because
those regexes are tuned for imperative voice (*"press A"*) and tips are declarative (*"Q and E rotate
the camera"*). Ported verbatim it would ship a green test over the exact defect it was cited to
close. Retires `SPEC_DRIFT_AUDIT` #27 — which the survey claimed happened as a side effect, and
does not.

### Commit 2 — one situation, end to end. The brownout.

- **Situation:** `HudSnapshot.brownout === true`, held 15 s continuously, local player, once per match.
- **Tip:** *"Your defences go dark before your economy does. A plant is the way out."* No digit, no
  key; checkable against `POWER_SHED_ORDER` and `shedPriority`'s `never` for `IsBuilder`.
- **Surface: the toast — deliberately, and only for this slice.** Not its long-term home (§2.1). It
  proves trigger + suppression + settings with **zero new pixels and therefore zero shot-harness
  exposure**.
- **Placement:** `Phase.Economy`, tick-sliced, in `orecrisis.system.ts`'s exact shape — that path
  already posts a local-only chip from inside `simTick` and is structurally invisible to `?shot=`.
- **Toggle:** `gameplay.tips`, **with its reader in the same commit**, or it is the fifth dead
  settings row. No `SETTINGS_VERSION` bump — `normalizeSettings` is total.
- **Suppression:** inside the post function, **never at a call site** — a guard at a call site cannot
  see a second call site. Tested by emitting on a real `Channels`, in
  `progression-suppress.spec.ts`'s shape.
- **Inertness:** no shell handle → silent, written as the explicit inversion of the `?? default`
  idiom, with the reason.

**If that tip fires while the player is already dragging a Power Plant onto the ground, the feature
has failed for nothing** — and it will have cost one commit to find out.

### Commit 3+ — deferred, each with what it unblocks

- **The card.** Answers "where on screen" — the corner is the objectives panel, top-left is the
  toast stack, `#hud-root` centre is the tutorial coach card, and the bible wants the centre and
  lower-left third clear. Needs a frame-share number and a control capture.
- **The corpus and its lazy chunk.** **The moment a second tip lands, the bundle rule in §2.4 must be
  written first** — nothing in the tree catches that leak today.
- **The mute list.** Needs a `PROFILE_VERSION` bump; belongs to this commit, not earlier.
- **The install path.** Unanswered by every survey: the campaign's boundary is crossed from two
  files on purpose because *"a boundary crossed from four places is a boundary nobody owns"*. Tips
  fire in every skirmish, so `Shell.startMatch` would await it on every launch — the one path that
  deliberately does its work **before the first await**, because `goFullscreen()` needs transient
  user activation.

---

## 7. OPEN

- **Who writes the corpus, and against what gate?** If the digits go (§2.3) the gate is the digit ban
  plus the key lint. If they stay, somebody hand-writes ~50 re-derivations, which becomes the
  majority of the feature's cost — `wiki-numbers.spec.ts`'s header prices that exercise at *"three
  passes of careful human reading, three misses"*.
- **Tip versus EVA.** `EVA_TOASTS` already converts 15 announcer lines into chips. Nothing
  arbitrates a tip against *"base under attack"*.
- **The first skirmish after the tutorial** is the loudest, most redundant moment for the corpus.
  Cheap answer nobody proposed: seed the muted set from the tutorial's completed steps.

---

## 8. FOUND IN PASSING, NOT PART OF THIS FEATURE

- **`Shell.playCampaignBeat` (`Shell.ts:1429-1441`) silently drops every campaign `eva:` effect.** It
  handles `kind === 'dialogue'` only, while its own doc says *"Dialogue and EVA for now"*. Live.
- **`tests/build-descriptions.spec.ts:62` reads `TABS = [Structures, Defense, Infantry, Vehicles]`** —
  omitting `BuildTab.Powers`. The hard-coded-four trap, reproduced *inside the coverage test built to
  catch gaps*.
- **`rclBarricade` (`Defs.ts:2496`) is a third wall** that blocks ground movement via
  `Flowfield.ts:1067`, alongside `wall` and `mrdRampart`.
