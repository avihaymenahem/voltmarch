# Meridian Sun Lighter v1

Content key: `meridian_lighter`
Display name: Sun Lighter
Faction: Meridian Pact
Class: four-slot solar landing ship
Frozen gameplay dimensions: 11.2 x 5.0 x 3.0 m
Forward / ramp direction: +Z

## Art brief

Non-negotiable silhouette cues:

1. A shallow tapered kite hull terminates in one deep central ramp notch.
2. Supported folded solar fins frame a clear passenger deck without becoming a combat crescent.
3. A low rear solar spine keeps the lighter elegant and visibly smaller than the Argosy.

Meridian cues are clean ivory-like planes, geometric mirror recesses, supported radial ribs and deliberate
symmetry. Floating pieces, unsupported sails and generic speedboat surfacing are rejected.

## Gameplay contracts

- Preserve water-only hover locomotion, four cargo slots, the 11.2 x 5.0 x 3.0 m fit and +Z heading.
- Preserve dock-entry, ramp, selection, collision, damage and wreck hooks.
- Keep the bow ramp mechanically separable; every sail and support must remain attached in closed motion.
- Keep the procedural `meridian_lighter` model as the automatic loading/failure fallback.

## Geometry references

`orthographic-sheet.png` and the four deterministic `views/` crops are the neutral-clay reconstruction
authority. The raised sail and small landing pads are geometry risks: reject unsupported/floating pieces,
fused ramps, inconsistent ribs, a crescent open-jaw warship read or deck obstruction.

## Staged Meshy plan

Geometry-only multi-image generation is 20 credits. A 10-credit PBR retexture remains blocked until the
geometry gate passes. Paid remesh is exceptional. Maximum planned spend: 30 credits.

Shipping targets are 18k-28k triangles, one or two materials, a dedicated shadow proxy, safe LODs, KTX2
PBR, ramp/waterline verification and WebGL/WebGPU gameplay validation.

## Production record

- Geometry: `01a04e95-585b-7197-acc2-64daa85e2a02` (20 credits)
- PBR retexture: `01a04ec9-9b4c-76e9-8bda-72e6accb0c84` (10 credits), using `material-reference-v2.png`
- Shipping: 24,127 triangles, 3.38 MiB KTX2 LOD0, 11,164-triangle LOD1 and 1,104-triangle shadow proxy
- LOD2 was withheld because the simplifier failed the ratio gate.
