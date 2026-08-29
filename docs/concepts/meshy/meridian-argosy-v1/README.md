# Meridian Argosy v1

Content key: `meridian_argosy`
Display name: Argosy
Faction: Meridian Pact
Class: eight-slot heavy solar landing ship
Frozen gameplay dimensions: 13.2 x 6.0 x 3.6 m
Forward / ramp direction: +Z

## Art brief

Non-negotiable silhouette cues:

1. A wide diamond/manta planform encloses one deep rectangular tank deck.
2. Twin supported folded solar shoulders flank a massive separate forward ramp.
3. A raised rear solar bridge and heavy centre keel establish the fleet's transport capital.

Meridian cues are elegant ivory-like facets, geometric mirror recesses, clean radial ribs and deliberate
symmetry. It must remain distinct from both the Sunmonitor and the smaller Sun Lighter.

## Gameplay contracts

- Preserve water-only hover locomotion, eight cargo slots, the 13.2 x 6.0 x 3.6 m fit and +Z heading.
- Preserve dock-entry, ramp, selection, collision, damage and wreck hooks.
- Keep the tank deck unobstructed, the ramp mechanically separable and both solar shoulders supported.
- Keep the procedural `meridian_argosy` model as the automatic loading/failure fallback.

## Geometry references

`orthographic-sheet.png` and the four deterministic `views/` crops are the neutral-clay reconstruction
authority. Reject fused ramps, blocked cargo space, inconsistent solar shoulders, floating ribs, a narrow
combat-hull silhouette or generic catamaran geometry.

## Staged Meshy plan

Geometry-only multi-image generation is 20 credits. A 10-credit PBR retexture remains blocked until the
geometry gate passes. Paid remesh is exceptional. Maximum planned spend: 30 credits.

Shipping targets are 18k-28k triangles, one or two materials, a dedicated shadow proxy, safe LODs, KTX2
PBR, ramp/waterline verification and WebGL/WebGPU gameplay validation.

## Production record

- Geometry: `01a04e95-5955-774c-b693-c7b054a7960e` (20 credits)
- PBR retexture: `01a04e99-3500-72de-a29f-bd09c18479ea` (10 credits)
- Shipping: 24,409 triangles, 2.59 MiB KTX2 LOD0, 10,966/4,486-triangle LODs and 1,752-triangle shadow proxy
