# Allied Hover Transport v1

Content key: `allied_transport`
Display name: Hover Transport
Faction: Allies
Class: eight-slot amphibious hover transport
Frozen gameplay dimensions: 9.6 x 5.0 x 3.4 m
Forward / ramp direction: +Z

## Art brief

Non-negotiable silhouette cues:

1. A continuous swept troop capsule terminates in one broad forward ceramic ramp.
2. Twin enclosed lift pods read as supported machinery beneath a closed hull, never floating feet.
3. A low faceted canopy and protected rear propulsion block preserve a readable front and rear.

Allied cues are interlocking precision shell panels, smooth controlled curves, hidden running hardware and
exact bilateral alignment. Rivets, exposed pipes, scrap asymmetry and random greebles are rejected.

## Gameplay contracts

- Preserve water-only hover locomotion, eight cargo slots, the 9.6 x 5.0 x 3.4 m fit and +Z heading.
- Preserve dock-entry, door/ramp, exhaust, selection, collision, damage and wreck hooks.
- Keep the front ramp mechanically separable and make every lift pod structurally connected to the hull.
- Keep the procedural `allied_transport` model as the automatic loading/failure fallback.

## Geometry references

`orthographic-sheet.png` and the four deterministic `views/` crops are the neutral-clay reconstruction
authority. The apparent lift-pod gaps in the sheet are a reconstruction risk, not permission for detached
parts: reject floating pods, fused ramps, inconsistent canopy geometry or swollen ceramic forms.

## Staged Meshy plan

Geometry-only multi-image generation is 20 credits. A 10-credit PBR retexture remains blocked until the
geometry gate passes. Paid remesh is exceptional. Maximum planned spend: 30 credits.

Shipping targets are 18k-28k triangles, one or two materials, a dedicated shadow proxy, safe LODs, KTX2
PBR, ramp/waterline verification and WebGL/WebGPU gameplay validation.

## Production record

- Geometry: `01a04e95-55cb-71f3-8cc7-237b15111d83` (20 credits)
- PBR retexture: `01a04e99-302a-750f-8ddb-ea55fe887d90` (10 credits)
- Shipping: 24,954 triangles, 2.44 MiB KTX2 LOD0, 11,224/4,490-triangle LODs and 1,656-triangle shadow proxy
