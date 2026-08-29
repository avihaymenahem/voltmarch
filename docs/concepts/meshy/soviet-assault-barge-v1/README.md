# Soviet Assault Barge v1

Content key: `soviet_lighter`
Display name: Assault Barge
Faction: Soviet Union
Class: four-slot naval landing ship
Frozen gameplay dimensions: 11.0 x 5.2 x 3.0 m
Forward / ramp direction: +Z

## Art brief

Non-negotiable silhouette cues:

1. A long slab-sided hull surrounds one broad unobstructed vehicle deck.
2. The blunt high bow gate is a distinct ramp with visible hinge and hydraulic authority.
3. An offset stern exhaust tower makes the working barge directional without adding a weapon.

Soviet cues are riveted armour, raised rectangular slab geometry, protected pipes and angular industrial
bracing. The ship must remain clearly below the Dreadnought and above the Picket Boat in the fleet ladder.

## Gameplay contracts

- Preserve water-only hover locomotion, four cargo slots, the 11.0 x 5.2 x 3.0 m fit and +Z heading.
- Preserve dock-entry, ramp, selection, collision, damage and wreck hooks.
- Keep the cargo deck clear and the bow ramp mechanically separable through its full useful arc.
- Keep the procedural `soviet_lighter` model as the automatic loading/failure fallback.

## Geometry references

`orthographic-sheet.png` and the four deterministic `views/` crops are the neutral-clay reconstruction
authority. Reject a sealed deck, fused gate, decorative weapons, crane clutter, open hull backsides,
inconsistent exhaust geometry or softened armour planes.

## Staged Meshy plan

Geometry-only multi-image generation is 20 credits. A 10-credit PBR retexture remains blocked until the
geometry gate passes. Paid remesh is exceptional. Maximum planned spend: 30 credits.

Shipping targets are 18k-28k triangles, one or two materials, a dedicated shadow proxy, safe LODs, KTX2
PBR, ramp/waterline verification and WebGL/WebGPU gameplay validation.

## Production record

- Geometry: `01a04e95-5440-7519-8362-7f9c8b600073` (20 credits)
- PBR retexture: `01a04ec9-716a-754c-b07d-9a01dd18d472` (10 credits), using `material-reference-v2.png`
- Shipping: 24,462 triangles, 2.49 MiB KTX2 LOD0, 11,002/4,403-triangle LODs and 1,152-triangle shadow proxy
