# VOLTMARCH 3.16.3 patch release

Owner authorized README changelog removal, commit/push, patch bump, deployment and
monitoring through completion on 2026-09-03 (local date).

## Candidate

- Base: `9592c4b2c3522fbf1a4bb82d3e5d02088b50143e` (post-3.16.2 main).
- Root package and unified lockfile: **3.16.3**; intended tag **v3.16.3**.
- Missions: filters, five-row pages, one focused dossier and bounded scrolling.
- Service Record: separate Overview, Honours and Identity; paged honours and
  draft-preserving callsign editing.
- Title: clearer play choices, a single identity entry, separate soundtrack
  controls, and an unclipped supplied logo.
- README: remove both historical What's new sections; use GitHub release notes
  for release history instead of adding another changelog block.
- Studio profiles and desktop-only instructions are repository tooling/policy.
- Imported-asset placement POC stays tools-only: no shipping worker, utility
  process, asset replacement or claimed game boot/FPS gain.

Existing unrelated work was preserved; all included changes were the preceding
owner-directed work in this task. Generated caches, dependencies, installers,
Meshy originals, private environment files and raw experiment directories are
not committed. Compact POC evidence uses repository-relative run paths.

## Review and performance

One build/release specialist independently reviewed source scope, version
authority, release topology, README removal, credential patterns and deployment
gaps without editing or publishing. Parent owns implementation and GPU execution.
The tag workflow does not replace the local complete game gate: main pushes do
not run workspace CI, and desktop publishing tests only its scoped source.

Existing UI acceptance is recorded in
`MENU_REFERENCE_AUDIT_2026-09-02.md`. Window-width containment remains desktop
window/accessibility behavior, not mobile support. No new mobile work, minimum
resolution, simulation behavior, rendering pass, per-frame callback or runtime
dependency is introduced. WASM, worker dispatch and GPU compute are not relevant
to version metadata, news copy and bounded menu DOM; no offload is promoted.

## Verification receipt

Release validation and deployment receipts are pending; this document does not
claim that a candidate or a successful local build is already public.

- Studio consistency: 28 profiles and 15 negative controls pass.
- POC regressions: 6/6 pass; no POC benchmark rerun required for path-only export.
- Full monorepo gate: **23/23 tasks pass**, uncached; game **7,312 passed / 4
  conditionally skipped**, desktop **86 passed**. Lint, typechecks, builds,
  ownership and dependency architecture all pass.
- Fresh bundle/UI/news checks: **7 files / 100 tests pass**, no skips.
- Pre-deploy native desktop smoke completed all five runs: native storage/save
  persistence, real WebGPU match boot on NVIDIA, 31 authored foliage families,
  4K terrain mask, texture worker, profile import/export and fullscreen/minimise
  checks pass. Its sole failure is the expected production multiplayer probe:
  the not-yet-updated relay explicitly accepts 3.16.2 and rejects 3.16.3 with
  `build-mismatch`. No assertion was weakened; the full smoke must pass again
  against the deployed relay before closing the release.
- Publication and updater asset verification: pending.
- Relay public handshake and coordinated announcement: pending.
- Public news feed: intentionally remains on 3.16.2 until desktop/relay success.

Local gate logs live under `.turbo/release-3.16.3-*`; they are not release assets.
Deployment must use the existing tag-triggered desktop and relay workflows.
The relay activation disconnects existing rooms and owns automatic rollback if
its activation validation fails. Do not rewrite a published tag or substitute a
local installer for the workflow artifacts.
