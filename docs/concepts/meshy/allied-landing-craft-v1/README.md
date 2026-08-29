# Allied Landing Craft v1

Content key: `allied_lighter`
Display name: Landing Craft
Faction: Allies
Class: four-slot naval landing ship
Frozen gameplay dimensions: 11.0 x 5.0 x 3.0 m
Forward / ramp direction: +Z

## Art brief

Non-negotiable silhouette cues:

1. A broad triple-keel planform holds one long unobstructed vehicle deck.
2. Manta-like bow shoulders frame a large separate ceramic ramp.
3. A low swept stern control module keeps the vessel below the Assault Destroyer silhouette.

Allied cues are continuous ceramic shell geometry, smooth barrel-vault transitions, hidden mechanicals and
exact symmetry. The craft must not collapse into the narrow four-pad Hydrofoil family.

## Gameplay contracts

- Preserve water-only hover locomotion, four cargo slots, the 11.0 x 5.0 x 3.0 m fit and +Z heading.
- Preserve dock-entry, ramp, selection, collision, damage and wreck hooks.
- Keep the tank deck clear and the bow ramp mechanically separable.
- Keep the procedural `allied_lighter` model as the automatic loading/failure fallback.

## Geometry references

`orthographic-sheet.png` and the four deterministic `views/` crops are the neutral-clay reconstruction
authority. Reject a sealed cargo well, fused ramp, submerged third keel, inconsistent stern module,
decorative weapons or Soviet-style panel clutter.

## Staged Meshy plan

Geometry-only multi-image generation is 20 credits. A 10-credit PBR retexture remains blocked until the
geometry gate passes. Paid remesh is exceptional. Maximum planned spend: 30 credits.

Shipping targets are 18k-28k triangles, one or two materials, a dedicated shadow proxy, safe LODs, KTX2
PBR, ramp/waterline verification and WebGL/WebGPU gameplay validation.

## Production record

- Geometry: `01a04e95-5700-74a5-82a0-06bb8f531b84` (20 credits)
- PBR retexture: `01a04ec9-8d48-77da-8745-75c3e3beb621` (10 credits), using `material-reference-v2.png`
- Shipping: 24,341 triangles, 2.99 MiB KTX2 LOD0, 10,953/4,378-triangle LODs and 1,152-triangle shadow proxy
