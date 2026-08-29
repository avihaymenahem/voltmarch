# Reclamation Slag Hauler v1

Content key: `reclaim_hauler`
Display name: Slag Hauler
Faction: The Reclamation
Class: eight-slot heavy salvage landing ship
Frozen gameplay dimensions: 13.0 x 6.2 x 3.6 m
Forward / ramp direction: +Z

## Art brief

Non-negotiable silhouette cues:

1. A broad asymmetric slab hull carries one clear vehicle deck and a large forward ramp.
2. One exposed load-bearing side truss frames an integrated buoyancy drum.
3. A tall offset stern exhaust/winch cage creates deliberate, functional asymmetry.

Reclamation cues are mismatched structural armour, open load-bearing frames, reused cylindrical tanks and
visible braces with a purpose. Random junk, greeble carpets and melted scrap blobs are rejected.

## Gameplay contracts

- Preserve water-only hover locomotion, eight cargo slots, the 13.0 x 6.2 x 3.6 m fit and +Z heading.
- Preserve dock-entry, ramp, selection, collision, damage and wreck hooks.
- Keep the cargo deck clear, the bow ramp mechanically separable and open frames closed on their backsides.
- Keep the procedural `reclaim_hauler` model as the automatic loading/failure fallback.

## Geometry references

`orthographic-sheet.png` and the four deterministic `views/` crops are the neutral-clay reconstruction
authority. Reject inconsistent ramp angles, loose junk, fused machinery, open one-sided trusses, random
extra tanks, decorative weapons or lost asymmetry.

## Staged Meshy plan

Geometry-only multi-image generation is 20 credits. A 10-credit PBR retexture remains blocked until the
geometry gate passes. Paid remesh is exceptional. Maximum planned spend: 30 credits.

Shipping targets are 18k-28k triangles, one or two materials, a dedicated shadow proxy, safe LODs, KTX2
PBR, ramp/waterline verification and WebGL/WebGPU gameplay validation.

## Production record

- Geometry: `01a04e95-5aa7-763a-a1b2-bbd9807f9069` (20 credits)
- PBR retexture: `01a04ecd-9c0c-70aa-85d9-00b3e9fe3af9` (10 credits), using the canonical graphite/violet `material-reference-v3.png`
- Rejected palette pass: `01a04ec9-b8dc-72a9-b86c-95c63ea34d85` (10 credits); generic rust/orange was not integrated
- Shipping: 24,135 triangles, 3.13 MiB KTX2 LOD0 and 1,512-triangle shadow proxy
- Colour LODs were withheld because the simplifier failed the ratio gate.
