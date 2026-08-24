# Soviet Sledge Tank v1

Content key: `soviet_apocalypse`  
Display name: Sledge Tank  
Faction: Soviet Union  
Class: super-heavy tracked assault tank  
Frozen gameplay envelope: 4.1 m wide x 3.2 m high x 8.6 m hull length  
Forward axis: +Z

## Art brief

The Sledge is the Soviet hero armour branch. It must share the Anvil's field-olive, crimson and charcoal
material family while reading immediately as a larger, slower breakthrough vehicle rather than an Anvil
with a second barrel.

Non-negotiable silhouette cues:

1. An exceptionally broad, low brutalist wedge hull with a thick ram-like forged bow and deep track bands.
2. Seven to nine large readable road wheels per side, heavy continuous tracks and hard-edged armour skirts.
3. A separate massive rectangular hammerhead turret on a clean armoured yaw collar.
4. Two parallel equal-length heavy cannons with blocky mantlets, bore evacuators and ported muzzle brakes.
5. Twin rear engine/exhaust drums, armoured deck louvers, a compact cupola and one asymmetric searchlight.

Hard-surface geometry is mandatory: planar facets, crisp plate breaks, thick armour and chunky weld seams.
Reject inflated cast blobs, continuous soft smoothing, melted edges and glossy showroom paint.

## Gameplay and runtime contracts

- Preserve the current selection/collision envelope and +Z forward convention.
- Deliver separate `Hull` and `Turret` meshes. The turret origin is the yaw pivot and local +Z follows both guns.
- The complete static deck stays with `Hull`; no deck triangle may orbit with the turret.
- Seal the hull ring and turret underside. Review FrontSide rendering at yaw 0, 45, 90 and 180 degrees.
- Preserve both muzzle sockets, continuous hull yaw, turret tracking, selection, damage VFX and wreck behaviour.
- Keep the procedural Sledge registered as the load-failure fallback until both renderer gates pass.

## Material language

- Dominant desaturated field-olive rough painted steel.
- Deep charcoal tracks, gunmetal running gear and dark recessed vents.
- Large deliberate crimson side-skirt and turret-cheek slabs, 8-12% of the visible surface.
- Restrained warm bare-steel edge wear and small amber lamps.
- No camouflage, global hue wash, random red speckles, baked lighting or emissive armour.

## Production route

`orthographic-sheet-v3.png` is the current geometry-only turnaround. `front-v3.png`, `right-v3.png`,
`back-v3.png` and `left-v3.png` are mechanically cropped quadrants and are the only images permitted in
the next geometry task. Earlier sheets are retained for provenance but rejected as reconstruction input.

1. Multi-image geometry (`latest`, texture off, automatic remesh off) - 20 Meshy credits.
2. Stop and audit all cardinal views, twin-barrel consistency, track clearance and component integrity.
3. Split hull/turret at the measured ring seam, seal both sides, reduce and unwrap locally.
4. Retexture only the approved final UV model (`latest`, original UV, PBR, no HD, remove lighting) - 10 credits.
5. Build LOD1, LOD2, articulated shadow strategy and wreck locally; then validate WebGL/WebGPU.

Maximum planned Meshy spend: 30 credits. Texture credits are never spent on rejected geometry.

## Shipping budgets

- LOD0: 22,000-28,000 triangles across hull and turret, one shared PBR material.
- LOD1: 10,000-14,000 triangles. LOD2: 4,000-6,000 triangles.
- 2048 base colour, 2048 tangent-space normal, 1024 packed metal-roughness.
- 6 MiB maximum shipping LOD0 GLB; KTX2 textures and shared transcoder path are mandatory.
- Strong silhouette and six to eight major colour blocks must survive at 35-70 screen pixels.

## Reference provenance

The turnaround sheet was generated with the built-in image-generation tool from this brief. It is a
reconstruction reference and is not shipping game art.

## Geometry attempt log

- Task `01a02e6b-00fd-70f7-a591-2639f77f06de` consumed 20 credits and produced a coherent 1,985,650
  triangle hull/track silhouette, but the cardinal audit exposed four generated cannon tubes. The attempt
  is rejected before texture, remesh or integration.
- V2 replaces the slotted multi-hole brakes with exactly two plain circular bores. The repeated road-wheel
  rhythm remains acceptable for this super-heavy hull; runtime bounds, not procedural wheel count, are frozen.
- Task `01a02e77-7248-7419-95d4-9394f4e435ab` consumed 20 credits but also produced four cannon tubes.
  The V2 side projections incorrectly showed two vertically separated lines while the front showed a
  horizontal pair, so the reconstruction resolved both requirements as a 2x2 battery. It is rejected before texture.
- V3 applies correct orthographic projection: the front shows two horizontal bores while each true side
  view shows one overlapping barrel silhouette. This removes the conflicting depth cue rather than asking
  Meshy to guess which pair is real.
- Task `01a02e7c-6a75-7c15-8d82-53a7ecc68e89` consumed 20 credits and passes the geometry gate. The raw
  single shell is 1,915,204 triangles; the approved local condition is 26,773 triangles split into named
  `Hull` (23,221) and `Turret` (3,552) meshes with one shared 2048 atlas UV layout and zero bounds drift.
  A dedicated close fixture validates two guns, the measured yaw collar, off-axis turret rotation,
  front-face closure and shadows in both WebGL and WebGPU before texture spend.

## Texture and shipping pass

- Retexture task `01a02e8f-eb6e-7c8a-b012-969ab9343c6f` consumed 10 credits. It used the approved V3
  turnaround as its style reference, preserved the local atlas, enabled PBR, removed baked lighting and
  requested only GLB output. No remesh or second paid task was used.
- Meshy flattened the scene hierarchy during retexture, so the production pass deterministically restored
  the measured `Hull`/`Turret` split at source Y `0.13` and normalized the closed shell to front-face
  rendering. The textured LOD0 is 26,718 triangles with one shared 2048 base-colour, packed metal-roughness
  and normal set. Its small 55-triangle difference from the UV input is recorded as Meshy output drift.
- The approved faction condition is matte olive armour, restrained crimson recognition slabs and dark
  tracks. A local 1.14 base-colour gain compensates for this atlas being about 11% darker than the Anvil
  family reference without changing the battlefield exposure.
- Shipping KTX2 reduces the LOD0 from 8.18 MiB to 3.32 MiB and the conservative decoded texture estimate
  from 64 MiB to 12 MiB. LOD1 is 12,896 triangles; the 11,151-triangle LOD2 candidate misses its gate and
  remains blocked. The 1,728-triangle shadow proxy passes its budget.
- The deterministic Sledge fixture passes WebGL and WebGPU at noon with two visible cannon tubes, off-axis
  turret rotation, opaque articulation closure, faction-readable colour blocks and cast shadows.
