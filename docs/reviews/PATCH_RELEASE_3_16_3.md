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

Release **v3.16.3** is public from commit
`3c71151622cb111f1a5258083df49620c1a2e95f`, published 2026-09-02 at 22:01:51 UTC
(2026-09-03 local). The annotated tag was independently resolved to that commit.

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
- Post-deploy native smoke: **ALL CHECKS PASSED**, including multiplayer, across
  all five fresh/relaunched Electron runs. Direct public relay smoke also accepts
  build 3.16.3 with protocol 5 and origin `app://voltmarch`.
- [Windows publication](https://github.com/avihaymenahem/voltmarch/actions/runs/33687783461):
  success, including checksum creation and GitHub provenance attestation.
- [Relay deployment and coordinated announcement](https://github.com/avihaymenahem/voltmarch/actions/runs/33687783462):
  both jobs successful, after verifying the public relay and desktop assets.
- [Wiki publication](https://github.com/avihaymenahem/voltmarch/actions/runs/33687781135):
  success. The release commit's Cloudflare Pages check also completed successfully.
- Published installer, portable executable, blockmap, `latest.yml` and
  `SHA256SUMS.txt`: all five downloads streamed and hashed; exact GitHub sizes
  and SHA-256 digests match. Installer and metadata also match the published
  checksum file; updater SHA-512 matches the installer bytes. No extra binary
  copies were retained on disk.
- `gh attestation verify` succeeds on `latest.yml`. All five independently
  streamed asset digests match the verified provenance statement, whose signer
  workflow, tag and source SHA bind this release.
- Public news source is updated to 3.16.3 only after desktop/relay success. Its
  website build passes; five feed tests pass. The news follow-up's Cloudflare
  check and live `https://voltmarch.com/news.json` are monitored before handoff.

Both Windows executables remain **NotSigned**, confirmed by the workflow. GitHub
provenance is not Authenticode or SmartScreen reputation. Native smoke exercised
the real desktop source path and newly deployed relay, not an installed
cross-version updater cycle or a new AMD/Intel validation pass.

Release URL: <https://github.com/avihaymenahem/voltmarch/releases/tag/v3.16.3>.

| Published asset | Bytes | SHA-256 |
| --- | ---: | --- |
| `VOLTMARCH-Setup-3.16.3.exe` | 531760480 | `86c3617c5d124176aecdfe72aca632e850491c2e3f56228e4084b2a459bed736` |
| `VOLTMARCH-3.16.3-portable.exe` | 531428421 | `af4f31cb7214ff0f54ffbf2ede68158f3dad6c17f836b80ac956d39f8e39ce4a` |
| `VOLTMARCH-Setup-3.16.3.exe.blockmap` | 555354 | `f0b1845de28174d425b858f3ca93fe07d8d2ccbd2472f7524a4c468bc4b982bd` |
| `latest.yml` | 350 | `0f4aac45a2c0f5cdfa53efcd922790297283f36f1682b38a60e28d99a28a0a83` |
| `SHA256SUMS.txt` | 372 | `df272e52c72717c6cbf9be92db020e6fb1b8e5a4f386320c41fe747cdb50e12d` |

Local gate logs live under `.turbo/release-3.16.3-*`; they are not release assets.
Deployment must use the existing tag-triggered desktop and relay workflows.
The relay activation disconnects existing rooms and owns automatic rollback if
its activation validation fails. Do not rewrite a published tag or substitute a
local installer for the workflow artifacts. An unrelated
`marketing/medium-build-story/` directory appeared during the release and was
left untouched and outside the release commits.
