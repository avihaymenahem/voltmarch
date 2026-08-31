# Reclamation Scrapvulture Heavy Bomber v1

Status: rejected and superseded by v2 · updated 2026-08-31

The single perspective reference produced fused wings, repeated aircraft-like masses and an
unreadable underside. None of the v1 geometry or texture output was reused by v2.

## Contract

- Content key: `rclScrapvulture`; model key: `reclaim_scrapvulture`.
- Role: Reclamation four-slot strategic bomber; one slag cask, return, 300-tick rearm.
- Envelope: approximately 17 m long, 19 m span and 5 m high.
- Forward: +Z. Runtime root: `Hull`. The generated cask is visual only.

## Non-negotiable silhouette

1. Composed asymmetry: exactly one oversized left engine and one smaller right booster.
2. Broad patched wing around an open graphite load-bearing spine.
3. One bolted belly cradle with a single readable slag cask and a stable outer flight silhouette.

## Reclamation material language

- Oxide graphite frame, dark armour, mismatched warm metals and hazard amber hardware.
- Contiguous violet arc-system panels cover roughly 7–10% of visible area.
- Dry plate, restrained welds and contextual wear; never orange-rust monochrome.

## Budgets and gates

- Aircraft LOD0 ceiling: 20k triangles; one or two materials; 5 MiB compressed GLB.
- 2K base colour, 1K normal and packed MR; LOD1/LOD2 plus shadow proxy required.
- Reject extra engines, symmetric twin-jet geometry, junk-pile form or a missing slag cask.

`scrapvulture-meshy-reference.png` is retained only as rejection provenance. The authoritative
shipping references live in `../reclamation-scrapvulture-heavy-bomber-v2/`.
