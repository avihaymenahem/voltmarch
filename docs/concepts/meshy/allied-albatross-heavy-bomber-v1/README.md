# Allied Albatross Heavy Bomber v1

Meshy source brief for the Allied Strategic Airbase proof of concept. This is a precision penetrator with a broad, unmistakable top silhouette; it must not read as a fighter or a recolored existing aircraft.

- Approved ImageGen source: `albatross-meshy-reference.png`
- Rejected text-only preview: `01a05424-b9ed-730f-a2e9-288b107d8ae6` (fighter-like, melted silhouette)
- Accepted PBR reconstruction: `01a0542b-6770-70ba-a9d5-dc3a05042ecf`
- Shipping source: 49,025 triangles; KTX2 runtime: 4.49 MiB; LOD1: 22,061; shadow: 1,320

- Gameplay envelope: 15 m long × 16 m span × 4.2 m high
- Runtime forward axis: +Z, origin centered at ground contact
- Silhouette: broad cranked swept wing, deep blended center fuselage, two separated nacelles with visible negative space
- Gameplay read: one ventral heavy-bomb bay; no turret, missiles, or external weapon clutter
- Materials: white ceramic armor, blue-black structure, cobalt canopy/sensors, restrained Allied-blue edge panels
- Runtime hierarchy: connected imported `Hull`; the deterministic gameplay `Bomb` remains separate
- LOD0 shipping target: 35–55k triangles after optimization; 2K PBR master, compressed runtime family
- Avoid: cartoon proportions, low-poly faceting, pedestal/terrain, text/logos, giant canopy, fighter silhouette, fused bomb

## Meshy preview prompt

Realistic game-ready Allied heavy strategic bomber, top-down RTS readability, broad cranked swept wing, deep blended center fuselage, exactly two separated engine nacelles with clear negative space, visible ventral single heavy-bomb bay and one separable heavy bomb, landing gear, clean white ceramic armor over blue-black structure, cobalt canopy and sensors, restrained blue panels on silhouette edges, symmetrical hard-surface aircraft, isolated asset, no base or environment, no turret, no missiles, no text or logo, not cartoon or low-poly.
