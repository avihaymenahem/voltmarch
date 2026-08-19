# TODO

**Outstanding work only.** A row here is open. When it closes, the row is deleted — there is no
"done" section, no changelog and no history, because this file has now rotted twice by accumulating
one.

**THE TASK LIST IS AUTHORITATIVE. THIS FILE IS A VIEW OF IT.** Every row carries its `#n`; a row
with no number is untracked, and that is itself the bug.

---

## Campaign

- **#66 — Phases 6-7. 17 of a planned 37 operations are authored; 20 remain.** Chapters run
  6 / 4 / 3 / 4 (Soviets, Allies, Pact, Reclamation) for 251 minutes of authored par against a
  10-hour table. **180-320 person-hours, roughly 3-5x the engine**, of which ~35 hours is human
  play no agent can do. That ratio is the single most important fact about the campaign.

  **The length question is DECIDED and does not need re-deriving before authoring continues:** author
  at 37 and add more if it comes up short, because the cheapest of the three answers is also the one
  that can be taken LAST, after the table is timed. `tests/campaign-length.spec.ts` arms itself at
  the 37th row and will force the question then regardless.

- **NO OPERATION PAST S1 HAS BEEN PLAYED BY A HUMAN.** Sixteen are authored, adversarially verified
  and gate-green; exactly one has a play time. Every par past S1 is an author's estimate, and
  `tools/op-harness.mjs`'s header now records how far a harness figure sits from a play time (11:00
  against 15:09.7 on the one operation where both exist). This is not a defect and it is not
  blocking authoring — it is the debt authoring is taking on, written down.

- **THE CAPTURE HAZARD SWEEP — 7 of 17 operations, audited 2026-08-19.** `Capture.resolve`
  consumes the capturing unit on EVERY non-refused outcome — capture, soften and friendly repair
  alike — and a NEUTRAL structure has no health gate, so the flip is instant. The three
  `canCapture` defs (`engineer`, `mrdArtificer`, `rclTinker`) carry **no `unlockedBy`**, so no
  operation's roster can withhold them, and their prereqs stand at t=0 in every `opening: 'base'`
  operation. `buildAlliedBase` even spawns one; `buildSovietBase` does not.

  Two shapes, two fixes, and they are not interchangeable:

  1. **Enemy-owned structure, trigger keyed on `entityDead`/`entityAlive`.** A captured structure
     is still ALIVE, so the trigger is capture-blind. Fixed by migrating to
     `ownerCount(foeSeat, tag, max: 0 / min: 1)` behind an `elapsed` settle guard — the
     `soviets.06.demolition-order` pattern, which already did this and wrote down why. **It changes
     what the objective MEANS** (captured counts as done), so each migration is an authoring
     decision and the titles usually need rewording. Affects `soviets.01` (`tap`, and a `derrick`
     secondary whose trigger reads ownership while its title says "standing"), `soviets.03`
     (`mast` — capturing a derrick for its 15 cr/s guarantees a DEFEAT at minute 9), `pact.01`
     (`mast`), `pact.02` (`tap`), `reclamation.01` (`office`, `transformer`).
     **ALL FIVE ARE DONE** — `soviets.01`/`soviets.03` in 76b2683, `pact.01`/`pact.02`/
     `reclamation.01` in d3b0b81. Three `entityDead` thresholds are deliberately NOT migrated and
     each says why at its trigger.
  2. **Gaia-owned or protect-target, where the capture must simply not happen.** **THE ONLY HALF
     STILL OPEN.** `ownerCount`
     cannot express it — `validateCampaign`'s seat check refuses a player index outside the seated
     range and Gaia is not a seat. `CaptureService.addVeto` is the hook: consulted inside
     `resolve()` ahead of both branches, and `refuse()` does NOT consume the engineer, so a vetoed
     click costs a walk and nothing else. A per-layout `captureProof: readonly string[]` declared
     beside `tags`, installed from `campaign-install.ts` and validated like trigger tags, is **not**
     a vocabulary change — the freeze covers 12 conditions, 3 combinators and 11 effects and this
     adds none. Affects `soviets.01`'s derricks, `soviets.06`'s `infirmary` (capture strips Gaia's
     universal alliance permanently, and unlike garrison it never reverts), `pact.02`'s `count`
     (a PRIMARY protect-target), and `allies.01`'s three `party` surveyors. **Not started.**

  **One cost left to state before building the veto: it is a hard NO where some cases want a
  COST.** `soviets.06`'s `works` must stay capturable. The other prerequisite is **DONE** — the
  cursor asks `CaptureService.isCapturable` now (300a00c), which also closed a live defect, since
  `Garrison`'s veto had been invisible to it since the day it was written.

  **AND THE PRICE OF A CAPTURE IS FOUR ENGINEERS, NEVER THREE, FOR EVERY STRUCTURE IN THE GAME.**
  The soften lands `maxHp * softenFrac` (0.25) through `ARMOR_MATRIX[HighExplosive][Concrete]`
  (1.00) and `COMBAT_DAMAGE.globalMul` (0.80) = 0.20 of max, against a 0.50 gate. Both are
  fractions of max, so `maxHp` cancels and the count is hp-independent. Quoting `softenFrac`
  without `globalMul` understates it by one engineer, and two headers shipped that way.

  **`pact.02.long-count`'s header documents a route that does not exist.** It says *"there is no
  health threshold on an enemy structure"* — true of `isCapturable`, false of `resolve()`, which
  softens above `captureHpFrac`. One Artificer into the reading post takes 180 hp off it and trips
  `t.graze`, permanently failing the hidden 400-credit `quiet` secondary, before delivering
  nothing. The header spends a block deriving which Pact guns could accidentally graze the post and
  the unit that beats every one of those numbers has no weapon at all.

  **Geometric mitigation is not a mechanism, and `allies.01` proved it** — its "14 m clear of the
  disc" was 7.66 m on the built world, because `findClearFootprint` moved the mast after the number
  was written. Fixed and pinned by `tests/sounding-line-clearance.spec.ts`; the general form wants
  a layout-level declaration and is deliberately not built for one caller.

- ~~**A SINGLE ENGINEER IN A SELECTION TURNS EVERY RIGHT-CLICK ON A BUILDING INTO A CAPTURE.**~~
  **CLOSED 2026-08-19.** Demoted per unit in `OrderExecutor.write`, above the existing
  unarmed-Attack rule so its Attack falls through that one — which is what keeps a harvester a true
  no-op and an empty transport a Move with no second copy of either rule. A hostile target gives
  the escort `Attack` on the same building; a NEUTRAL or allied one gives `Move` with the target
  cleared, so nobody's select-all opens fire on a civilian block. `Repair` rides the same OR
  (`canRepair` IS `canCapture`) and can never produce an Attack, which is asserted rather than left
  to happen not to arise. `tests/capture-selection.spec.ts` drives the REAL executor through
  `issueOrder` + `tick()` — `attack-building.spec.ts` mirrors `write()` in a local helper and could
  not have seen this — and 6 of its 7 go red with the demotion removed. The 7th is the
  engineer-only no-regression control and passes both ways by design. The original text follows.

  **A SINGLE ENGINEER IN A SELECTION TURNS EVERY RIGHT-CLICK ON A BUILDING INTO A CAPTURE.**
  `Commands.ts` computes `caps.canCapture` as an OR over the selection (`:462`) and both capture
  branches (`:752`, `:809`) read it for the whole group, so `resolveOrder` emits `OrderKind.Capture`
  for every selected unit. `Capture.simTick` walks `byKind[Infantry]` ONLY: non-engineer infantry
  gets `clearOrder` and stops where it stands, and a **VEHICLE is never visited at all**, so it
  keeps the order and drives to the building instead of engaging it. An Allied player owns an
  engineer from t=0, so Ctrl+A and a right-click on the enemy base is the ordinary way to hit this.

  This is a skirmish and multiplayer defect, not a campaign one — and it is the mechanism that
  defeats the "capture requires an explicit order" safety argument that `allies-sounding-line`,
  `allies-misclosure` and `soviets-demolition-order` all lean on. **The likely fix is in
  `Capture.simTick`, not in the cursor**: convert a non-engineer's `Capture` order to `Attack` on
  the same target when the target is a valid enemy one, and keep `clearOrder` for a neutral target
  so nobody's tanks open fire on a civilian block. One wire command, resolved per unit by the sim,
  no protocol change. **Measure it before changing it** — the vehicle branch above is read off the
  source and has not been driven.

---

## Tips

- **Situational in-match tips — Commit 3 remains.** *(untracked; the plan is `TIPS_BUILD_SPEC.md`,
  which names its own deletion condition.)* Commits 1 and 2 shipped: the loading-screen tips no
  longer lie about rebound keys, and the brownout tip proves trigger, suppression, settings and the
  `gameplay.tips` toggle end to end. What is left is the CARD (answers "where on screen", needs a
  frame-share number and a control capture), the CORPUS and its lazy chunk (**the bundle rule in
  §2.4 must be written BEFORE a second tip lands — nothing in the tree catches that leak today**),
  the mute list (needs a `PROFILE_VERSION` bump), and the install path.

  Commit 2 taught one thing that changes the rest: **a tip is a PAIR of predicates**, the situation
  and the answer not already being under way. The brownout tip fired while the player was already
  holding a finished Power Plant, because `buildSpeedMul` is driven toward 0.25 by the very deficit
  that caused the brownout. Every future tip needs its `answeringPower` equivalent.

---

## Multiplayer

- **Teams shipped; three follow-ups it deliberately did not do.** *(untracked — the task tool was
  disconnected when these were found)*
  1. ~~**The minimap paints an ally in your own accent**~~ — **CLOSED 2026-08-19.**
     `SEMANTIC.ally` is the third blip class, `Minimap.alliedArmies()` publishes the legend rows,
     and `Sidebar.setArmies` takes two lists. The hue is DERIVED rather than picked: swept 0..359
     against the four faction accents, the four `HOSTILE_COLORS` and `SEMANTIC.ore`, the freest hue
     is 93 degrees at 47 degrees of clearance, and the shipped colour sits at 96.
     `tests/hud-palette.spec.ts` pins that floor at 40 and drives the real class; both mutations —
     dropping the "yours" branch and putting the ally back on the accent — were run and fail it.
     **A duel cannot reach the new branch**, so no `?shot=` fixture and no 1v1 pixel moved.
  2. Start placement does not seat team-mates near each other. **It must not be fixed by rotating
     the start table** — ECMA-262 does not pin `sin`/`cos` to bit precision and terrain generates
     independently on both machines of a lockstep match, so that is a tick-zero desync.
  3. A campaign operation with 3+ seats still makes its extra foes mutually hostile. Nothing is
     wrong today — no shipped operation has more than two armies — but an operation that grows one
     should declare alliances next to `foe`.
- **#51 — 3-4 player PvP.** The merge layer is free; the drop rules and the removal signal are not.
  PvP seats exactly two today.
- **#55 — LAN and self-hosted multiplayer.** The desktop shell makes it possible and it did not ship.

---

## Desktop

- **#56 — desktop players start with an empty profile.** Partly closed: export/import verified
  working under `app://` on a real Electron launch. What remains is that nothing migrates
  automatically, the buttons sit on the Missions screen rather than Options, and an empty profile
  also disarms the AI (`UnlockGate.mirrorAI` resolves it against the human's profile).
- **#57 — distribution and signing.** Research only.

---

## Gameplay

- **#50 — the aerial rework. PARTLY CLOSED 2026-08-19.** The per-credit inversion is fixed:
  `WeaponDef.airMultiplier` is 0.25 on the four line-infantry rifles and 1 on all 38 other rows, and
  every army's dedicated answer now beats its line infantryman against aircraft (3.485× → 0.871×,
  2.550× → 0.637×, 1.184× → 0.296×, 0.927× → 0.232×). The number came out of a three-bound window
  [0.130, 0.287] re-derived from the shipped defs; `tests/air-multiplier.spec.ts` fails in both
  directions. Trap 2 is discharged: the AA Battery was re-measured and its row did not move
  (1.81–2.41 s per airframe, 187–261% of an aircraft's health on a 26 m pass) — but against 800
  credits of line infantry it went from 1.7–1.8× SLOWER in the Soviet and Reclamation cases and a
  bare 1.06–1.08× faster in the other two, to 2.3–4.3× faster in all four. **Whether the
  Battery is now too dominant is the open follow-up, and it is a question about its price and tier,
  not its row.**

  What remains of #50, both behaviour rather than data:

  - **The loiter has no way out.** `Targeting` parks an attacker at `range * 0.80` and it stays
    until one side is dead, so an aircraft still cannot disengage. The multiplier bought it ~4×
    longer to be wrong in; it did not give it a verb. The fix is a way OUT the player and the AI can
    both issue — never a rule forbidding staying.
  - **The 8 m overhead blind cone.** `COMBAT_WEAPONS.maxElevationDeg` is 62, so a projectile weapon
    cannot hit an aircraft directly above it at all; the safest place for an aircraft is over the
    battery. Measured, not derived — quote 8 m, not the 11.70 the centre-line geometry gives.
- **#27 — the AI owns no engineer**, so `Capture` is unreachable for it. The def exists with weight 0
  and `buildUnits` filters `weight <= 0`. Giving the brain the verb alone would hand it to a unit
  that never exists; buying one, escorting it and choosing a building is a feature.
- **#48 — per-map spawn geometry.** A `StartTable` keyed like `MAP_SEAS`, plus `seaOffMapCentre`
  taking the normal as a parameter. **It must not be authored by rotating the table** — ECMA-262 does
  not pin `sin`/`cos` to bit precision, terrain generates independently on both machines of a
  lockstep match, and that is a tick-zero desync. Permutation and power-of-two scaling are exact.

---

## Renderer and docs

- **#39 — real GPU time on WebGPU** via timestamp-query. `drawCallsByPass` is WebGL-only and the node
  renderer has no seam between the shadow and colour passes to meter, so it reports zeros with a true
  total. Do not invent a split.
- **#37 — docs overhaul.** Partly done in passing. The remainder is unswept, and it includes
  re-verifying eight items of the v1.25.0 sweep (mission reward wiring, dead exports, and the rest)
  that were carried forward on this file's word rather than on evidence.

---

## Cleanup: calls that were left for a human, and still are

Decisions, not work. Nobody should sweep them without an answer.

- **`src/art/Wrecks.ts`** — 743 lines, 13 exports, completely unreachable. Decide whether wrecks are a
  feature that was never wired or a direction that was abandoned; the file is the only record either
  way.
- **`docs/surface-refs/ours-*.png`** — 4 files, 4.6 MB, tracked and unreferenced. Reference captures
  of our own output. Cite them from the look bible or delete them.
- **The selection-card portrait API** — `kindMeshFor`, `kindMeshVersion`, `HUD_PORTRAIT`.
- **Dead exports** — 177 at the 2026-08-07 sweep, each individually proven at the time. The number
  has certainly moved.

---

## Not on this list, deliberately

`CAMPAIGN_BUILD_SPEC.md` §9's undecided items are author decisions rather than work. The largest,
**UNDECIDED-1**, is **CLOSED**: on 2026-08-19 the author took option B and twelve `name:` rows were
renamed — tier 1 (MiG, a live mark of a real aircraft manufacturer) and tier 2 (the eleven Westwood/EA
coinages). Tiers 3 and 4 stand: Tesla Coil, Conscript, G.I., War Factory, Barracks and the rest are
real-world terms or genre idiom that nobody owns. No `key:` moved, so no save or replay on disk was
invalidated. It landed before a word of briefing prose existed, which is what made it cost 666 lines
instead of 22,750 words. §2.5 carries the table and the survey that priced it.
