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

## Published 3.16.2 receipt

- Release commit: `682b0771cf4e5f7eeb7a9652e6fdeb811845e3e0`; annotated tag `v3.16.2`.
- [Windows release](https://github.com/avihaymenahem/voltmarch/releases/tag/v3.16.2) published
  2026-09-02 at 19:20:33 UTC. [Desktop workflow](https://github.com/avihaymenahem/voltmarch/actions/runs/33672111912)
  succeeded, including source verification, packaging, checksums and provenance attestations.
- [Relay workflow](https://github.com/avihaymenahem/voltmarch/actions/runs/33672111905) succeeded on
  attempt two, including the verified Discord receipt. Attempt one timed out connecting to SSH before
  upload; it never activated a release. The normal workflow retry recovered it. Local SSH was checked
  read-only as a fallback, but no manual activation or host configuration change was needed.
- Public smoke accepted build **3.16.2**, protocol **5**, with origin `app://voltmarch`.
- All five release assets are present. Installer: 531,758,384 bytes; portable: 531,426,303 bytes.
  The four `SHA256SUMS.txt` entries match GitHub's published asset digests. The downloaded `latest.yml`
  hash also matches and names the 3.16.2 installer with the correct size. Installer binaries were not
  downloaded or installed over the owner's local installation for this check.
- Live `https://voltmarch.com/news.json` serves the 3.16.2 bulletin.
- Final native `app://` smoke **passed all checks** on NVIDIA WebGPU, with isolated disposable user
  data: production relay access, ten unique routes, top/left click-through, title return after its exit
  transition, save/key-value relaunch persistence, profile export/import and fullscreen minimize/restore.
  This exercised the rebuilt release renderer in Electron, not an end-to-end installed auto-update.
  Log: `desktop-release-smoke-final.log` in the local artifact directory.
- Native screenshots: `desktop-title-3.16.2.png`, `desktop-settings-3.16.2.png`,
  `desktop-profile-3.16.2.png`; the gameplay capture waits for the separate `#loading` curtain as well
  as Shell loading and advancing simulation. Its startup counters are not a steady-state benchmark.
- Unrelated studio-workflow changes, including their separate handoff table row, remain uncommitted
  and excluded from the patch. This receipt is a documentation follow-up; the release tag is unchanged.

## Local follow-up: bounded Missions browser

The owner requested the studio workflow to remove the Missions page's long, cluttered scroll.
Fetched origin before editing; baseline was `9592c4b2c3522fbf1a4bb82d3e5d02088b50143e`.
Existing studio configuration changes were preserved.
This follow-up is local only: no commit, version bump, tag, deployment or publication.

Delegation decision: two bounded specialists, with parent integration and one browser owner.
`ux_accessibility` reviewed information structure without writes; `qa_engineer` owned only
`apps/game/tests/missions-browser.spec.ts`. Both used the studio's `gpt-5.6-terra` / high defaults.
The parent performed the UI-engineer implementation and live browser checks. Role instructions
were transferred explicitly because the collaboration API does not select native TOML profiles;
this does not claim that the profiles' sandbox defaults were enforced by this session.

Implemented in `Missions.ts` and `command-shell.css`:

- Category buttons filter results rather than jumping through an expanded catalogue. Scope and
  status are labelled native selects. Five compact mission rows and one selected dossier replace
  all 55 expanded cards and the unbounded earned-unlock strip.
- Pagination exposes the entire catalogue. Chain ordering, named cross-category prerequisites,
  progress, difficulty, visible rewards and completion/earned status remain. Credits are still
  suppressed where no real payout exists. No progression rules or profile writes changed.
- At widths up to 850px, selection opens the dossier with Back to list. At larger widths, list and
  details sit side by side. Long details and enlarged text scroll locally; the shared page does not.
- Provider refreshes preserve selection, focused controls and unchanged-list scroll. Different
  pages reset list scroll. Home/End/Page keys apply only to mission rows; native selects keep their
  keys. A status region announces selection without replacing the filter controls.
- One shared Back exit replaces duplicate Back/Close buttons. Offline, unreadable profile,
  empty catalogue and no-filter-match states remain distinct. Show all missions resets filters.
- The new regression file is registered in `scripts/test-scope.mjs` so the UI gate includes it.

Browser evidence is in this task's screenshots and DOM-geometry tool results. One in-app tab used
the existing local profile; no match, reward claim, import/reset or paid asset operation was run.
The local dev server exited during final checks; restarted it on the same loopback port and
reloaded the current 3.16.2 development build before the final populated measurements.

At 1280×720 / 115% text, the old body contained 1,221 descendants and scrolled 10,348px within
421px. The new body contains 67 descendants (94.5% fewer) and measures 349px content/349px viewport.
Its default list measures 288/288px and default dossier 349/349px: neither needs a scrollbar.
At 900×800 / 115%, the default list and dossier also fit. At 640×800 / 115%, the list fits and
the dossier uses the compact drilldown. All three widths were also exercised at 90% and 150% text;
no Missions-panel horizontal overflow was observed. Larger text and long, multi-reward dossiers
retain contained vertical scrolling. Keyboard Space/Enter, Home/End, pagination, all 55 unique
mission titles, completed/match filters, empty-filter recovery and compact return focus were checked.
Original 115% text was restored after accessibility checks; viewport override removed afterward.

Performance decision before implementation: this is bounded, event-driven DOM work. WASM, workers
and WebGPU compute do not fit it; dispatch/transfer overhead would add complexity to a small menu
filter, and simulation determinism stays untouched. No new per-frame work, timer, renderer import,
asset, render pass or dependency was added. The DOM reduction is measured; frame-time/boot-time
improvements are not claimed without a comparative timing benchmark.

Final proportional gates: UI suite **32 files / 1,065 tests passed**, including **14 new Missions
tests**; game typecheck; targeted ESLint; production build; dependency architecture; workspace
ownership; reward wiring **8 tests**; and fresh campaign/WebGPU bundle-isolation **44 tests**.
The build retains its existing external font/splash and mixed-import warnings. The full release
gate and packaged-Electron/live-pause/result gameplay validation were not rerun for this local UI
follow-up. Panel subscription and wrapper return/cleanup are covered by unit tests; fake DOM tests
do not substitute for native-device layout evidence.

## Local follow-up: focused Service Record

The owner requested the same studio workflow for Service Record / Profile. Origin was fetched
before editing; HEAD and origin/main were both `9592c4b2c3522fbf1a4bb82d3e5d02088b50143e`.
Existing Missions and studio changes were preserved. This follow-up is local and unreleased:
no commit, version bump, tag, deployment or publication.

Delegation decision: two bounded specialists using the studio's `gpt-5.6-terra` / high defaults.
The UX/accessibility reviewer performed source-only analysis without writes; the QA engineer owned
only `apps/game/tests/profile-browser.spec.ts`. The parent implemented and integrated the UI and
was the sole browser owner. Profile instructions were transferred explicitly; this is not a claim
that native TOML role selection or its sandbox defaults were enforced by the collaboration API.

Implemented in `Profile.ts` and `command-shell.css`:

- Three native section buttons: Overview, Honours and Identity. Overview has one copy of six career
  totals and four faction records, plus routes to Missions and Operations. Repeated progression
  panels, mission previews, identity-channel decoration and invented clearance/verification chrome
  are removed. Real progression and settings storage contracts are unchanged.
- Honours retains all 17 reward-derived insignia/decals, six per page. Type and ownership filters
  lead to one selected detail with source mission, description, progress, earned/debrief state and
  award date when available. Completed-but-unclaimed is not presented as owned. No credits or
  gameplay strength are invented. At <=850px, selection opens a detail with Back to honours.
- Identity is available while profile data loads or fails. Its existing normalized, maximum-20
  character callsign field is retained as one DOM instance. Unsaved draft, caret and focused control
  survive provider refreshes and section changes. Home/End/Page keys are not intercepted by Profile.
- Honour selection and focused controls survive provider refreshes; a changed page resets list
  scroll. Empty catalogue and empty filter states are distinct, and Show all honours resets both
  selects. One shared Back replaces duplicated footer exits. Lazy reader disposal remains tied to
  the screen lifetime. The new spec is automatically included by the UI scope's `profile` matcher.

Browser evidence is in the task's screenshots and DOM-geometry results. At 1280×720 / 115% text,
the old body had 530 descendants, with identity content 521px inside 344px, career content 446px
inside 342px, and honours content 695px inside 152px. The new Overview has 69 descendants (87%
fewer), and its 410px content fits its 410px viewport. Honours body/detail measure 349/349px and
the six-award list 288/288px. Identity also fits without scrolling.

All three sections were checked at 1280×720, 900×800 and 640×800 with 90%, 115% and 150% text.
No Profile-panel horizontal overflow was observed. The 640px Overview has a short contained scroll
at 115% and 150%; maximum text and longer details may scroll locally without moving the section
controls. The maximum-text compact honour detail was keyboard-opened with Space, and Enter on
Back to honours restored the selected tile's focus. All 17 unique honours, pagination, type and
ownership filters, empty-filter recovery, an invalid callsign and an unsaved draft were checked in
the browser. Original 115% text was restored; no callsign, reward, progression or profile reset
was committed. View Missions and its Back return, and View Operations opening Campaign without
starting a match, were also checked. The viewport override was removed and Service Record left open.
These are browser checks, not a packaged-Electron or assistive-technology audit.

Performance decision before implementation: small, event-driven DOM filtering does not justify
WASM, worker transfers or WebGPU compute. No new per-frame work, timer, renderer import, dependency,
asset or render pass was added. Identity DOM is reused; only the selected section and six honour
tiles are mounted. The measured DOM reduction is not a boot-time or frame-time benchmark.

Final proportional gates: UI **33 files / 1,074 tests passed**, including **nine new Profile browser
regressions**; game typecheck; targeted ESLint; production build; dependency architecture; workspace
ownership; reward-wiring and fresh campaign/WebGPU bundle isolation **52 tests**; and diff whitespace
validation. Production Shell JavaScript is 327.43 kB, Shell CSS 236.94 kB, and the lazy profile reader
remains a separate 1.18 kB chunk (uncompressed build output). Existing external font/splash and
mixed-import warnings remain. No full release gate, packaged native smoke or live-battle performance
gate was run for this local menu-only follow-up.

## Local follow-up: title facelift and desktop-only scope

The owner requested a main-page facelift, then identified logo clipping and explicitly confirmed
that VOLTMARCH is desktop-only. Mobile is unsupported and must not be a design, optimization or
QA target. The persistent rule is now in `AGENTS.md`, `CLAUDE.md`, the handoff, studio workflow,
common studio policy and all 28 specialist prompts. This policy update used no additional agents
and has no runtime or performance cost. Profile validation passes, including 15 negative controls.

The title task used two bounded studio specialists (`gpt-5.6-terra` / high): source-only UX review
and QA owning only `apps/game/tests/main-menu-browser.spec.ts`. Parent owned implementation and
the sole browser. Prompt-transferred role instructions are not enforced TOML sandbox selection.
Origin was fetched; HEAD/origin were `9592c4b2c3522fbf1a4bb82d3e5d02088b50143e`; earlier
Missions/Profile/studio work was preserved. No commit, version bump, publication or deployment.

`MainMenu.ts` and the existing cinematic section of `shell.css` now provide:

- Larger, readable play rows over the supplied key art, with truthful tutorial, campaign, save,
  replay and relay states. Decorative row numbers and redundant headings are removed.
- One keyboard-registered Service Record identity button, without the duplicate Profile utility.
  Community remains top-right; Load, Settings, Replays and desktop-only confirmed Quit share one
  quiet utility group. Updated `wiki/How-to-Play.md` to describe the single identity entry.
- A separate footer soundtrack group with 44px controls, real track title/index and pause/resume.
  Passive faction/map/build metadata stays separate from those controls.
- The logo is outside the scrolling area. The first candidate clipped its drop-shadow against the
  menu container; the owner's screenshot exposed the defect. The corrected container has visible
  overflow, while the play section alone has bounded scrolling and non-shrinking children. Neither
  the supplied logo nor its pixels were edited. A regression guards that scroll-ownership boundary.

Final desktop checks: 1280×720 at 115% has an unclipped logo and a fitting main layout; 1280×900
shows the full brand/glow. At 1280×720 / 150%, the play section scrolls 105px within 383px while
the brand/header/footer remain clear. Shift+Tab from soundtrack to Replays scrolls that focused
button completely into the visible play area. Earlier 90–150% text and contrast/reduced-motion
checks exercised the new layout; smaller preview checks are not a mobile support commitment.
Campaign and keyboard Skirmish entry/back were checked without starting a match. Soundtrack
pause/resume works at its new location. Original 115% text, high contrast enabled and reduced motion
disabled were restored. Browser captures/DOM results are in the task; no native packaged smoke,
two-player session, save creation, profile mutation or support-link posting was performed.

Final proportional gates: UI **34 files / 1,082 passed**, including **eight title regressions**;
game typecheck and targeted ESLint; fresh production build; **120 tests** covering initial menu
boot, campaign/WebGPU bundle isolation, wiki numbers and truthful credits; ownership/dependency
architecture and diff checks. The test fake was extended for native `insertBefore`; no assertions
or performance thresholds were weakened. Final Shell JS is 326.75 kB and CSS 236.09 kB; the
profile reader remains a lazy 1.18 kB chunk. Existing build warnings remain.

Performance decision: DOM/CSS restructuring has no WASM/worker/WebGPU-compute use case; no new
asset, dependency, renderer import, timer or per-frame allocation was added. The image-first cold
title still does not start a decorative battlefield. Bundle sizes are measured; no comparative
boot-time or frame-time improvement is claimed. The full release gate was not run.

## Release checkpoint: 3.16.3 (2026-09-03 local date)

The local follow-ups above are now included in source commit
`3c71151622cb111f1a5258083df49620c1a2e95f`, tagged `v3.16.3`. The complete
monorepo gate passes 23/23 tasks; a fresh seven-file menu/bundle/news gate passes
100 tests. All five native Electron smoke runs pass against the deployed 3.16.3
relay. Windows publication, relay activation and the coordinated announcement
completed successfully. The detailed receipt and remaining distribution limits
are in `PATCH_RELEASE_3_16_3.md`.
