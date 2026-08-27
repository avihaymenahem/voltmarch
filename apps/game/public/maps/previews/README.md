# Skirmish battlefield previews

These seven 1024×576 WebP images are ImageGen-authored terrain layers for the
published skirmish roster. They share a premium stylized near-orthographic RTS
camera and contain no UI, text, units or baked tactical markers.

`MapPreview.ts` draws starts, ore markers, map metadata and the scan/grid grade
as deterministic live overlays. If an image fails to load, it restores the old
seeded canvas survey rather than showing an empty card.

The per-map prompt set is derived from the authoritative `MAPS` fields:

- Temperate Valley — wooded low plateaus and diagonal strategic clearings.
- Airbase Flats — open desert hardpan and abandoned runway traces.
- Frozen Sector — high-relief snow cliffs forming one two-player corridor.
- Industrial Grid — worn roads, yards, rail and container-cover blocks.
- Contested Strait — two temperate coasts divided by navigable deep water.
- Coral Shore — wet tropical land, jungle lanes and coral shallows.
- Sunder Atoll — exactly four separated deployment islands with no land route.

Source PNGs remain in Codex generated-image storage; only reviewed, centre-crop
WebP derivatives are part of the game bundle.
