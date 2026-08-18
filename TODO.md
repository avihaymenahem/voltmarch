# TODO

**Rewritten 2026-08-19 at v2.16.0.** The previous version was written on 2026-08-07 at v1.25.0 and
never touched again. Its own opening paragraph is about the version before *that* having rotted for
twenty releases — so this file has now been the most misleading document in the repository twice,
for the same reason both times.

## How to keep it from happening a third time

**THE TASK LIST IS AUTHORITATIVE. THIS FILE IS A VIEW OF IT.** Every entry below carries its task
number, so the two cannot silently disagree — if a row here has no `#n`, it is not tracked anywhere
and that is itself the bug. Close a task, and this file is stale until somebody deletes the row.

That is the whole discipline. The previous two versions rotted because they were the *only* record,
so nothing else moved when the work did.

---

## What shipped since the last rewrite

The v1.25.0 sweep produced thirteen items. Checked against the tree on 2026-08-19:

| # | Item | State |
|---|---|---|
| 2 | Film grain and chromatic aberration ship ON against an explicit ban | **FIXED** — `Settings.ts:200-201` writes `grain: 0` and `chromaticAberration: 0` in both branches |
| 5 | Superweapons reachable only from the browser console | **SHIPPED** — built, gated, and the AI builds and fires them |
| 8 | Replay records but cannot play back | **SHIPPED** v1.32.0 — `src/game/Playback.ts`, `src/shell/Replays.ts`, and `npm run replay-probe` with a negative control |
| 11 | A quality governor documented in the present tense that does not exist | **FIXED** — `shadowCascades`, `lodDistances`, `lensDirt` and the rest are deleted; the only mentions left are the comment recording it |
| — | `tools/_*.mjs`, 8 untracked files | **GONE** |

Items 3, 4, 6, 7, 9, 10, 12 and 13 were **not** re-verified in this pass. Some are certainly
part-done — mission `map` unlocks are wired now (`SkirmishSetup#mapAvailable`), and `credits` and
`cosmetic` are *declared* gaps with a test naming them rather than silent ones. **Do not read their
absence below as "fixed".** They need a sweep, which is #37.

---

## Campaign — in flight

The campaign engine is built, played, saved, reloaded and replayed. What is left is content.

- **#64 — Gate M.** Every mechanical clause is done and verified live. **One clause remains and it
  cannot be delegated: nobody has played S1 through at par.** The 13-minute figure is authored, not
  measured, and #65's re-derivation gate is defined against it.
- **#65 — Phase 5.** Chapter 1 (S2, S3, A1, R1) plus `tools/op-harness`. Then **RE-DERIVE**: with
  five operations timed, if the mean actual is under 16.2 min the 37-operation table does not clear
  ten hours, and the choice between more operations and longer ones has to be made *before* the
  other 32 are authored.
- **#66 — Phases 6-7.** The remaining operations, four agents in parallel, then close-out. This is
  **180-320 person-hours and roughly 3-5× the engine**, of which ~35 hours is human play that no
  agent can do. That ratio is the single most important fact about the campaign.

### Campaign gaps that are real but small

- **#69 — `campaignProgress` counts rows the build does not have.** Measured at 512/512 from a
  hostile import. No caller yet, so it is cheap now.
- The objectives panel renders `0 / 1` under each campaign objective; it has no notion of a boolean
  objective. Cosmetic. The honest fix is a flag the panel reads, not a special case.
- `wiki/Campaign.md` still opens "VOLTMARCH has no story campaign". True until this week. Phase 7.

---

## Multiplayer — the largest gap, and the most interconnected

- **#51 — 3-4 player PvP.** The merge layer is free; the drop rules and the removal signal are not.
  PvP seats exactly two today.
- **#52 — Teams (2v2, 1v3).** `allyMask` is fully wired end to end. What is missing is a *writer*
  and a setup field. **Best value-per-effort on this list.**
- **#55 — LAN and self-hosted multiplayer.** The desktop shell makes it possible and it did not ship.

---

## Desktop

- **#54 — GPU enforcement refuses in a console log nobody reads.** The switch itself works and is
  measured: `--vm-safe-mode` moves both renderers between the RTX 3080 and the integrated AMD. The
  failure path is invisible.
- **#56 — desktop players start with an empty profile.** Partly closed: verified on a real Electron
  launch that export/import *works* under `app://` — the profile serialises, a blob download reaches
  the shell, and it imports back. What remains is that nothing migrates automatically, the buttons
  live on the Missions screen rather than Options where somebody looking for their data will look,
  and an empty profile also disarms the AI (`UnlockGate.mirrorAI` resolves it against the human's
  profile).
- **#57 — distribution and signing.** Research only.

---

## Gameplay

- **#50 — ship the aerial rework.** All the measurement is done and lives in CLAUDE.md: a line
  infantryman out-shoots the army's own dedicated AA per credit (Reclamation 3.49×, Soviets 2.55×),
  five candidate fixes are costed and rejected with reasons, and there is an **8 m overhead blind
  cone** in which a projectile weapon cannot hit an aircraft above it at all. The *work* is unstarted.
  Two traps recorded: a per-credit anchor flatters the cheapest unit in the game, and the Multigunner
  AA turret must be re-measured after any such nerf — never in the same commit.
- **#27 — the AI owns no engineer**, so `Capture` is unreachable for it. The def exists with weight 0
  and `buildUnits` filters `weight <= 0`. Giving the brain the verb alone would hand it to a unit that
  never exists; buying one, escorting it and choosing a building is a feature.
- **#48 — per-map spawn geometry.** A `StartTable` keyed like `MAP_SEAS`, plus `seaOffMapCentre`
  taking the normal as a parameter. **It must not be authored by rotating the table** — ECMA-262 does
  not pin `sin`/`cos` to bit precision, terrain generates independently on both machines of a
  lockstep match, and that is a tick-zero desync. Permutation and power-of-two scaling are exact.

---

## Correctness

- **#53 — four small N-army gaps** the four-army lobby made reachable: the debug overlay reports one
  AI of three; the anti-mirror rule should be **deleted** rather than extended (and
  `tests/shell.spec.ts` currently *pins the obsolete behaviour*); the end screen shows one difficulty
  chip for N armies; minimap pings are binary hostile/own while blips are already per-seat. Plus an
  undecided balance question — ore per army falls 1.5 → 1.25 from two armies to four, and nobody has
  decided whether that is intended tightening or an accident of the formula.
- **#67 — `CommandBus` silently loses any command issued during a drain.** `overflowBuffer` is
  declared, cleared in two places, and never written to, while the comment above it promises a
  re-issue. `claim()` is not guarded by `draining`, so the command lands in the ring and is discarded
  by `count = 0` — without incrementing `droppedCommands`, the one counter that would have shown it.
- **#68 — `endPlayback` is dead code** whose comment calls it "the shell's exit path". The shell uses
  `preparePlayback(null)`. It sits next to `detachPlayback`, whose header is a careful essay about
  exactly this distinction, so a reader comparing the two is misled.
- **#70 — `displayFrequency` and `graphics.fpsCap` are plumbed and read by nobody.** A 144 Hz desktop
  player is still calibrated against a 60 Hz target with the one capability that could fix it already
  delivered across the bridge. Not a one-liner: the target is what the fitted line is solved for.
- **#71 — a Reclamation crate and a Reclamation building sale both hand out Allied G.I.s.** Carried
  from the v1.25.0 sweep and **re-verified live today**: `FREE_UNITS` (`src/sim/Crates.ts:97`) has no
  `reclaim` key, and `SURVIVOR_KEY` (`src/sim/RepairSell.ts:59`) is four entries against
  `FACTION_COUNT = 5`. Both read sites have `??` fallbacks, which is precisely why `tsc` never caught
  either — a `Readonly<Record<string, …>>` cannot express "one per faction", so the hole becomes a
  plausible wrong answer instead of an error. **The only player-visible defect on this whole list.**

---

## Renderer and docs

- **#39 — real GPU time on WebGPU** via timestamp-query. `drawCallsByPass` is WebGL-only and the node
  renderer has no seam between the shadow and colour passes to meter, so it reports zeros with a true
  total. Do not invent a split.
- **#37 — docs overhaul.** Partly done in passing (five plan documents deleted with their
  measurements extracted, `MISSIONS_DESIGN.md`'s content-model row rewritten, the wiki counts
  corrected). The remainder is unswept, and it now includes re-verifying items 3, 4, 6, 7, 9, 10, 12
  and 13 of the v1.25.0 list above.

---

## Cleanup: calls that were left for a human, and still are

These are decisions, not work. Nobody should sweep them without an answer.

- **`src/art/Wrecks.ts`** — still present. 743 lines, 13 exports, completely unreachable. Decide
  whether wrecks are a feature that was never wired or a direction that was abandoned; the file is
  the only record either way.
- **`docs/surface-refs/ours-*.png`** — 4 files, 4.6 MB, tracked and unreferenced. They are reference
  captures of our own output. If the look bible still wants them they should be cited from it; if not
  they are 4.6 MB of history.
- **The selection-card portrait API** — `kindMeshFor`, `kindMeshVersion`, `HUD_PORTRAIT`.
- **Dead exports** — 177 of them, each individually proven at the time of the sweep. The number is
  from 2026-08-07 and has certainly moved.

---

## Not on this list, deliberately

The campaign plan's undecided items (`CAMPAIGN_BUILD_SPEC.md` §9) are author decisions rather than
work, and that document names its own deletion condition. The largest is **UNDECIDED-1**: whether to
rename the ~20 Westwood/EA proper nouns in `Defs.ts` — Grizzly, Rhino, Apocalypse, Prism Tank, Iron
Curtain, Chronosphere, and **MiG**, which is a live mark of a real aircraft manufacturer. Today those
names live in a build rail read silently; a campaign puts them in narrated prose, character dialogue,
a published wiki page and a store description. **The decision has to be made before a word of
briefing prose is authored** — renaming after 37 briefings exist is the expensive version of the
same job.
