# Soviet Hover Transport v1

Content key: `soviet_transport`
Display name: Hover Transport
Faction: Soviet Union
Class: eight-slot amphibious hover transport
Frozen gameplay dimensions: 9.6 x 5.0 x 3.4 m
Forward / ramp direction: +Z

## Art brief

Non-negotiable silhouette cues:

1. A blunt armoured wedge and full-width bow ramp make the front readable at RTS zoom.
2. Two deep continuous side skirts frame a central transport throat without becoming detached pods.
3. A low offset cupola and protected rear machinery keep the hull directional and asymmetric.

Soviet cues are riveted layered plate, hard rectangular armour slabs and protected exposed pipes. Rounded
luxury surfacing, ceramic continuity and random greeble carpets are rejected.

## Gameplay contracts

- Preserve the current water-only hover locomotion, eight cargo slots, 9.6 x 5.0 x 3.4 m fit and +Z heading.
- Preserve the dock-entry, door/ramp and exhaust sockets, selection bounds, damage and wreck hooks.
- Keep the bow ramp mechanically separable with a stable lower-edge hinge and a clear cargo aperture.
- Keep the procedural `soviet_transport` model as the automatic loading/failure fallback.

## Geometry references

`orthographic-sheet.png` and the four deterministic `views/` crops are the neutral-clay reconstruction
authority. Reject fused ramps, floating skirts, inconsistent side pipework, open backsides, swollen plate
forms or any result that reads Allied after colour is removed.

## Staged Meshy plan

Geometry-only multi-image generation is 20 credits. A 10-credit PBR retexture remains blocked until the
geometry gate passes. Paid remesh is exceptional. Maximum planned spend: 30 credits.

Shipping targets are 18k-28k triangles, one or two materials, a dedicated shadow proxy, reviewed colour
LODs where safe, KTX2 PBR, waterline/pivot verification and WebGL/WebGPU gameplay validation.

## Production record

- Geometry: `01a04e95-52b6-7545-8d3a-f31577350e72` (20 credits)
- PBR retexture: `01a04e99-2dcb-75aa-9e7e-092cea1b0810` (10 credits)
- Shipping: 24,852 triangles, 2.49 MiB KTX2 LOD0 and 1,920-triangle shadow proxy
- Colour LODs were withheld because the simplifier failed the bounds gate.
