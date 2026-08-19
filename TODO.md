# TODO

**Outstanding work only.** A row here is open. When it closes, the row is deleted — there is no
"done" section, no changelog and no history, because this file has now rotted twice by accumulating
one.

**THE TASK LIST IS AUTHORITATIVE. THIS FILE IS A VIEW OF IT.** Every row carries its `#n`; a row
with no number is untracked, and that is itself the bug.

---

## Campaign

- **#64 — Gate M.** Every mechanical clause is done and verified live. **The last one cannot be
  delegated: nobody has played S1 through at par.** The 13-minute figure is authored, not measured.

  `npm run op-harness` does **not** close it and was never going to — it drives the ordinary
  skirmish brain, which has never read an objective. Measured 2026-08-19 on `soviets.01.first-tap`:
  a **loss at 15:09.7** with the tap at **99.3% health**, seat 0 ground from 61 units to 8 while the
  opponent grew to 194. That is a driver that never attacked the objective, not a verdict on the
  operation.
- **#65 — Phase 5.** Chapter one is authored and committed (S1-S3, A1, R1) and `tools/op-harness`
  ships. **What remains is the RE-DERIVATION**, and it needs #64 first: with five operations timed
  against real play, if the mean actual is under 16.2 min the 37-operation table does not clear ten
  hours, and the choice between more operations and longer ones has to be made *before* the other 32
  are authored.
- **#66 — Phases 6-7.** The remaining 32 operations. **180-320 person-hours, roughly 3-5× the
  engine**, of which ~35 hours is human play no agent can do. That ratio is the single most
  important fact about the campaign.
- **#72 — `campaign-bundle-isolation` cannot see an import added inside `src/campaign/`.** Measured:
  a deliberate `CAMPAIGNS` import into the entry-chunk-reachable `campaign-store.ts` left the spec
  green at 26/26. §1 skips anything under `campaign/` and roots its closure at `campaign.system.ts`
  alone; §4 is gated on `distIsCurrent()`.
- **#73 — a layout-placed guard is re-tasked by the AI and walks away.** S2's secondary hangs on two
  tanks parked at the depot; `regroupSquads` files everything it finds, so they leave. Fourth
  instance of the pattern `GROUP_SCOUT` / `GROUP_WITHDRAW` / `GROUP_RAID` each exist for. Preferred
  answer is static content rather than an engine change. **Reasoned, not observed — confirm on a
  real run first.**
- The objectives panel renders `0 / 1` under each campaign objective; it has no notion of a boolean
  objective. Cosmetic. The honest fix is a flag the panel reads, not a special case. *(untracked —
  file it or drop it)*
- `wiki/Campaign.md` still opens "VOLTMARCH has no story campaign". Phase 7.

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
