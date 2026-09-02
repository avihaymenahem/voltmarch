# Command-menu reference audit — 2026-09-02

Implementation, browser and native candidate verification; release checkpoints are recorded below.

## Scope and decisions

Continued the existing dirty menu rebuild against the supplied dark navy/cyan Service Record
reference. Used zero sub-agents: the shared route lifecycle, CSS cascade and browser checks were
one tightly coupled investigation. Existing unrelated changes were preserved; origin was fetched
and the baseline was `e6c49c62503e591108f2c68e4892095865faac86`.

All full-page menus now use one top navigation, one icon rail and one content rectangle. The
reference's invented currencies, rank and military statistics were not copied as player data.
Pause remains a compact dialog over the battlefield. Loading and confirmation dialogs deliberately
omit global navigation so a boot or destructive confirmation cannot be bypassed.

Implementation owners: `apps/game/src/shell/Shell.ts` (routes/focus/lifecycle),
`command-shell.css` (shared frame and responsive overrides), and the existing route components.
`shell/profile-reader.ts` is a lazy, renderer-free adapter for out-of-match records.

## Corrections

- Settings top/left controls use real shared routes; Codex selects Manual and updates active state.
- Page, footer, Save, Help and Missions edges no longer inherit incompatible route-local widths.
- Live-match navigation preserves Settings/Missions returns and confirms title-only destinations.
  Cancelling that confirmation now remounts pause rather than leaving a frozen empty screen.
- Keyboard arrows/Enter follow actual focus after clicking or tabbing; native selects retain their
  own keyboard handling.
- Profile filters work, completed missions are identified correctly, and operation totals use the
  actual catalogue. Dense records scroll instead of hiding identity controls and award details.
- Compact profile panels no longer collapse over one another. Compact result reports retain their
  reward/objective content and accessible footer rather than shrinking the report body to zero.
- Multiplayer distinguishes connecting, waiting for a list, an empty connected list and disconnection.

## Browser coverage

One in-app browser/game instance was used. Screenshots and geometry evidence are in the local,
ignored `.codex-artifacts/menu-audit-2026-09-02/` directory. Geometry entries are chronological;
the latest capture of a filename supersedes an earlier one.

| Menu or state | Verification |
| --- | --- |
| Command centre/title | Shared frame and route controls; original key art/play choices retained |
| Operations/Campaign | Chapter browser and Continue → Briefing |
| Briefing | Content bounds, footer and shared routes |
| Build/Skirmish | Faction/map/rules layout, Advanced disclosure and Start Battle |
| Multiplayer | Find/Host layouts; disconnected state; pushed-room/reconnect workflows in tests |
| Intelligence/Missions | Category navigation, scrolling and title/pause/result contexts |
| Service Record | Real profile data, filters, identity editor and responsive panel flow |
| Settings | All eight categories clicked at 1280px, no body horizontal overflow; footer retained |
| Codex/Manual | Top route selects the lazy manual view |
| Load game/Replays | Archive/empty-state layouts and exits |
| Pause | Actual local WebGPU match; Settings/Controls/Missions return paths |
| Save Game | Actual paused match; name field and footer; no manual save created |
| Help/Controls | Title Settings and live pause contexts |
| Leave-battle confirmation | Cancel returns to pause; confirm cleans up and opens Operations |
| Victory/Defeat/Campaign win/loss | Real screen classes with isolated in-memory result fixtures |
| Loading | Actual deployment plus isolated layout fixture |

Full-page desktop content measured x=82/y=100, right=viewport−20, bottom=viewport−14 at
1280×800 and 1672×943. Compact profile/results measured x=60/y=70, right=632, bottom=786 at
640×800. Profile also checked at 900px. Text-size control exercised at 150%, then restored to
the original 115%; browser viewport override removed. Normal live-match progression events were
not suppressed. Result fixtures used an in-memory profile and did not claim real rewards.

## Gates and performance

- UI gate: 31 files passed; 1,046 tests passed, 3 skipped. Includes shared route, real pause
  cancellation, focus and multiplayer connection-state regressions.
- Typecheck: passed across all seven configured workspace tasks.
- Lint, dependency architecture and workspace ownership checks: passed.
- Production game build: passed. Entry remains separate from Bootstrap, renderer, manual corpus and
  the 1.18 kB lazy profile reader. No new render pass, simulation work, network protocol or per-frame
  menu timer was added. Navigation adds a bounded set of DOM controls only.
- WASM/workers/WebGPU compute were considered and not appropriate for this small event-driven DOM
  change. UI tests include allocation/identity checks for lobby changes. Actual WebGPU boot, pause
  and return-to-title were exercised; this is not a comparative GPU performance benchmark.
- `check:all` was not green: 7,273 tests passed, five failed. The menu failure was an old expectation
  that a connecting lobby should say there were no matches; corrected and covered by the green UI
  rerun. Four failures remain outside the menu change: `config-compatibility.spec.ts` runtime digest,
  `scatter-clear.spec.ts` density ratio, `scatter-trim-order.spec.ts` coverage (0.5097 vs 0.58), and
  `scatter.spec.ts` rich-opening count (7836 vs 7836). No unrelated fixtures or thresholds were changed.

## Limits

Live online matchmaking was unavailable through the local relay connection; its UI was inspected and
socket workflows tested, but no two-player match was claimed. Desktop-native updater/fullscreen/quit
actions and packaged-Electron screenshots still need release validation. This audit does not claim
every setting's hardware effect or every campaign operation was played.

## Follow-up: remove duplicate navigation

At the user's request, the six primary sections now appear only in the top bar, while Multiplayer,
Load Game, Replays and Settings appear only in the left rail. The separate top-right Settings
shortcut was removed as well. The existing brand/home affordance remains. Each of the ten route
destinations is rendered once across the navigation surfaces, with no routes lost.

The real DOM builder now has a regression test for the exact two route lists, uniqueness, focus,
click dispatch and active state. Browser click-through verified all ten routes. UI gate: 1,047
passed, three skipped; typecheck, targeted lint and build passed. This reduces chrome by seven
buttons and adds no timers or render work. These changes remain local and uncommitted with the
existing menu rebuild; the full-suite limitations above remain unchanged.

## Follow-up: restore the opening title composition

The user rejected applying the internal-page layout to the first screen. The opening title now
uses its existing image-led composition without the global header, rail or enclosing narrow panel.
Removed the title-specific command-frame overrides; inner pages, pause and results retain the shared
navigation. The title still paints without a decorative game boot or new runtime work.

Verified first-open and Settings → Done return at 1672×943 and 1280×720, including 150% text;
restored 115% text afterward. Screenshots: `title-image-led-1672.png`, `title-image-led-1280.png`
and `title-image-led-text150-1280.png` in the same local artifact directory. The visibility policy
has regression coverage separating title/loading/decisions from internal screens. UI suite: 1,048
passed, three skipped; targeted lint passed. Prior full-suite limitations are unchanged.

## Patch release preflight

The requested next patch is 3.16.2. A fresh `npm run check:all` completed with 22 successful workspace
tasks out of 23; the game suite had 7,277 passed, four failed and four skipped tests. Remaining failures
are the same config runtime-digest and three scatter assertions listed above. Publication is held:
no version bump, commit, push or tag was made during this preflight. Resolving those non-menu release
blockers requires a separate scoped correction, not weakening the checks to publish.

Both actual tag workflows currently run on `v*.*.*`: desktop publication and relay activation, followed
by their verified Discord receipt. Handoff statements describing a manual-only relay are stale; do not
assume that tagging this patch would leave the relay untouched.

## Authorized release-blocker correction

After the user authorized fixing the four blockers and publishing the patch:

- Audited the runtime config diff from the snapshot's last update (`7e439823`). Only the documented
  grass composition/spacing fields in `config/scatter.ts` changed, in `3c049314`; updated the full
  graph digest, retaining the exact export and referential-identity checks.
- Fixed coverage fill to receive the same urban-blended grass target as the surrounding passes.
  The original urban trim fixture now reaches 68.25% coverage against the unchanged 58% target.
- Replaced the invalid density-dial ratio fixture with identical local placements and a genuinely
  compacted distant population. More than 4× the total props must cost exactly the same local scan.
- Focus-gap coverage now counts actual clump centres within the photographed area: 114 normal versus
  164 rich, with both arms still held to the unchanged scene ceiling.
- Corrected four-file gate: **86 passed**. A first focused invocation used `npm exec` from the wrong
  cwd and failed the fixture-path lookup; the documented workspace `test` script passed all four.
- Paired generation evidence lives locally in `scatter-release-performance.json`. Ten warmed,
  alternating pairs: quarter-urban 92.67 → 90.16 ms; 12-type urban 78.82 → 80.67 ms. The latter spends
  1.85 ms more at map generation to recover 17.28 percentage points of coverage. No frame-loop logic,
  new type, asset, material, render pass or scene ceiling was added. This is not a GPU benchmark.
- Temporary diagnostic source files were removed after recording evidence. No test threshold was
  lowered, and saved-mask fingerprint validation remains intact when corrected placement differs.

The release version and bulletins are prepared as 3.16.2. Publication still depends on the full
release gate, native desktop smoke, and successful coordinated desktop/relay workflows.

Independent QA reviewed the four-file release correction with no blocking findings. One read-only
QA specialist was added after new studio-workflow instructions appeared in the shared worktree;
those unrelated files are excluded from this release's staging. The review confirmed the config
history, local clearing falsifier, clump-centre test, and conservative saved-mask mismatch path.
Old saves can regenerate previously crushed vegetation when fingerprints differ; building
footprints are replayed, and a mask is never applied to the wrong placement list.

The first post-correction full gate had 7,280 passing game tests, four skipped, and one README
length failure introduced by the new release summary. Removed the oldest summary instead of changing
the length limit; the five-test documentation gate passed. A clean full rerun is required below.

Native pre-publication checks exercised app:// on NVIDIA WebGPU, native save/key-value relaunch
persistence, profile export/import, fullscreen minimize/restore, imported foliage and 4K terrain.
Screenshots confirm the title, Settings and Service Record at 1584×861; top/left navigation works
and Settings exposes exactly ten distinct routes. The public relay accepts 3.16.1 and correctly
rejects the not-yet-published 3.16.2 with `build-mismatch`; that check must be repeated after rollout.
The local screenshot extension initially counted the 190 ms inert exit snapshot as live navigation;
it now waits for detachment. Its first battlefield screenshot caught the shader curtain, not gameplay;
the capture now waits for simulation counters and the curtain to leave. Neither was a product fix.

Final pre-tag gate: `npm run check:all` **passed**, all 23 workspace tasks successful. Game tests:
**7,281 passed, four skipped**, 333 files passed and four skipped. Desktop contract tests: 86 passed.
The final run took 3m08s with 21 cached tasks; game tests and game build executed freshly. Lint,
lint-rule/dependency tests, workspace ownership and dependency architecture also passed. Exact local
output is `check-all-final.log`. This supersedes the earlier failed preflight checkpoints.
