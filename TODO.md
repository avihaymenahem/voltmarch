# TODO

**Outstanding work only.** A row here is open. When it closes, the row is deleted — there is no
"done" section, no changelog and no history, because this file has now rotted twice by accumulating
one.

**THE TASK LIST IS AUTHORITATIVE. THIS FILE IS A VIEW OF IT.** Every row carries its `#n`; a row
with no number is untracked, and that is itself the bug.

---

## Campaign

- **#64 — Gate M. CLOSED 2026-08-19.** S1 played through to a win in **11:00 against an authored
  par of 13:00** — 0.846x. The operation is completable, par is achievable and beatable, and the
  qualitative verdict was "feels great".

  The harness's own caveat is vindicated rather than contradicted: it LOST the same operation at
  15:09.7 with the tap untouched at 99.3% health, having driven the skirmish brain, which has never
  read an objective. "An informed player drives straight at the objective and is faster" is exactly
  what the gap shows. **Do not read a harness figure as a play time; do not read this play time as a
  harness bug.**
- **#65 — Phase 5, and the ten-hour claim is now in doubt on ONE data point.** Chapter one is
  authored and `tools/op-harness` ships. The re-derivation gate is: mean ACTUAL must be >= 16.2 min
  for 37 operations to reach ten hours. Projecting S1's 0.846x uniformly:

  ```
    mean authored par across 37     17.4 min
    mean actual at 0.846x           14.7 min      <- under the 16.2 gate
    37-operation total               9.05 h       <- against a claimed 10.7
  ```

  **THIS IS ONE POINT AND IT IS BIASED LOW — DO NOT ACT ON IT YET.** It is the SHORTEST operation in
  the table (13 min against a ramp that ends at 24), played by the person who built the game, which
  is the fastest possible player rather than a median one. It is a FLOOR on play time, not an
  estimate of one. A player who does not know a Tesla Coil dies in a brownout is slower, and going
  for gold is slower again.

  **What would settle it:** two or three more operations timed, ideally including one by somebody who
  did not build this. If the ratio holds at ~0.85 the honest options are the plan's own three — 41
  operations instead of 37, a mean par of 19.2 min instead of 17.4, or saying nine hours out loud.
  `tests/campaign-length.spec.ts` arms itself at the 37th row and will force the choice then anyway.
- **#66 — Phases 6-7.** The remaining 32 operations. **180-320 person-hours, roughly 3-5× the
  engine**, of which ~35 hours is human play no agent can do. That ratio is the single most
  important fact about the campaign.
- **The briefing screen SPOILS hidden objectives.** `BriefingScreen.render` in
  `src/shell/Campaign.ts` lists them, while its own header says it must not — *"a briefing that
  listed a hidden objective would be the operation spoiling its own turn"*. It structurally cannot
  obey: the `OperationView.objectives` type in that file declares `{ id; kind; title }` with no
  `hidden` field to filter on. `reclamation.01.held-paper` ships a hidden secondary, so this is
  LIVE, and `wiki/Campaign.md` currently documents the behaviour rather than the intent — fixing it
  moves two bullets on that page. *(untracked — the task tool was disconnected when this was found;
  needs a number)*

---

## Multiplayer

- **#52 — Teams (2v2, 1v3).** `allyMask` is wired end to end; what is missing is a *writer* and a
  setup field. **Best value-per-effort on this list.**
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

- **#50 — ship the aerial rework.** All the measurement is done and lives in CLAUDE.md: a line
  infantryman out-shoots the army's own dedicated AA per credit (Reclamation 3.49×, Soviets 2.55×),
  five candidate fixes are costed and rejected with reasons, and there is an **8 m overhead blind
  cone** in which a projectile weapon cannot hit an aircraft above it at all. The *work* is
  unstarted. Two traps recorded: a per-credit anchor flatters the cheapest unit in the game, and the
  Multigunner AA turret must be re-measured after any such nerf — never in the same commit.
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

`CAMPAIGN_BUILD_SPEC.md` §9's undecided items are author decisions rather than work. The largest is
**UNDECIDED-1**: whether to rename the ~20 Westwood/EA proper nouns in `Defs.ts` — Grizzly, Rhino,
Apocalypse, Prism Tank, Iron Curtain, Chronosphere, and **MiG**, a live mark of a real aircraft
manufacturer. Today those names sit in a build rail read silently; a campaign puts them in narrated
prose, character dialogue, a published wiki page and a store description. **The decision has to be
made before a word of briefing prose is authored** — renaming after 37 briefings exist is the
expensive version of the same job.
