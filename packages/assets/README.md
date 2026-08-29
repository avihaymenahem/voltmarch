# @voltmarch/assets

Canonical binary assets shared by VOLTMARCH applications.

- `game/` contains authored models, derived LODs, shadow proxies, wrecks, and terrain maps.
- `fonts/` contains the self-hosted Rajdhani webfont files.
- `brand/` contains the canonical logo and application-mark exports.

Applications consume these files in place during development and let their build pipeline emit the
needed outputs. Do not copy source assets into an `apps/*` tree. Generated `dist/` copies are build
artifacts, not additional sources of truth.
