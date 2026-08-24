# Soviet Anvil Heavy Tank v1

Content key: `soviet_rhino`  
Display name: Anvil Heavy Tank  
Faction: Soviet Union  
Class: tracked main battle tank  
Frozen gameplay envelope: 3.4 m wide x 2.6 m high x 7.0 m hull length  
Forward axis: +Z

## Art brief

The Anvil establishes the reusable Soviet tracked-vehicle family. It is a compact, brutalist main battle
tank whose large shapes must survive the normal isometric camera and a 40-unit formation. It is not a hero
vehicle and must stay substantially smaller and cheaper than the Sledge Tank.

Non-negotiable silhouette cues:

1. A broad, low cast-wedge hull with a thick forged front brow and a narrower engine tail.
2. Two clearly separated track bands with six readable road wheels per side and dark negative gaps under
   the upper side skirts.
3. A separate low hammerhead turret on a distinct armoured collar, offset slightly forward from hull centre.
4. One long narrow cannon with a readable bore evacuator and broad ported muzzle brake. No second barrel.
5. Twin squat rear engine/exhaust drums, an asymmetric armoured searchlight, and chunky trunnion cheeks.

Soviet faction cues:

1. Field-olive riveted/cast armour is the dominant shell material, with charcoal tracks and gunmetal
   running gear.
2. Four large rectangular crimson side-skirt plates occupy 7-10% of the visible vehicle. The turret roof
   never receives the team-colour wash.
3. Restrained warm bare-steel edges, dark warm-red creases, small amber lamps, and sparse grime provide
   material separation without muddy photoreal noise.

Reject antenna forests, cables, lattice, cranes, spikes, external infantry kit, sandbags, floating parts,
camouflage, baked lighting, excessive micro-panels, random red speckles, and inflated or melted forms.

## Gameplay and runtime contracts

- Preserve the current selection/collision envelope and +Z forward convention.
- Deliver separate `Hull` and `Turret` meshes. The turret origin is the yaw pivot and its local +Z points
  down the cannon.
- Keep the barrel on the turret hierarchy and preserve the gameplay muzzle socket at the barrel crown.
- Preserve continuous hull yaw, turret tracking, selection affordances, damage VFX, wreck generation,
  construction spawn behaviour, instancing, and WebGL/WebGPU parity.
- Keep the procedural Anvil registered as the load-failure fallback until the imported model is validated.

## Production route

`orthographic-sheet.png` is the approved geometry-only turnaround. `front.png`, `right.png`, `back.png`
and `left.png` are its exact quadrants and are the only images supplied to the geometry task.

1. Multi-image geometry (`latest`, texture off, automatic remesh off) - 20 credits.
2. Audit all cardinal views, front direction, hull/turret separation, track clearance and component integrity.
3. Split the approved dense source into hull and turret, reduce and unwrap locally; no paid remesh.
4. Retexture the exact approved UV model (`latest`, original UV, PBR, no HD, remove lighting) - 10 credits.
5. Build LOD1, LOD2, shadow proxy and wreck locally; integrate only after both renderer gates pass.

Maximum planned Meshy spend: 30 credits. Geometry is the first stop gate; texture credits are not spent on
a rejected silhouette.

## Shipping budgets

- LOD0: 16,000-20,000 triangles across hull and turret, one shared PBR material.
- LOD1: 6,000-9,000 triangles. LOD2: 2,500-4,000 triangles.
- 2048 base colour, 2048 tangent-space normal, 1024 packed metal-roughness.
- 5 MiB maximum shipping LOD0 GLB; LOD and shadow files share the resident LOD0 material.
- One simplified shadow proxy under 2,000 triangles.
- Strong silhouette and the 5-7 major colour blocks must remain readable at 35-70 screen pixels.

## Reference provenance

The geometry sheet was generated with the built-in image-generation tool from the VOLTMARCH vehicle brief,
then copied into this project and split mechanically into four matching quadrants. It is a reconstruction
reference, not shipping game art.

## Integrated pilot result

- Meshy spend: 20 credits geometry + 10 credits exact-UV PBR texture; no paid remesh.
- LOD0: 18,663 triangles, two articulated meshes, one material, 3.65 MiB conventional source.
- Shipping KTX2 source: 2.89 MiB transfer and approximately 8 MiB conservative 8bpp GPU residency,
  down from approximately 48 MiB decoded RGBA8 residency.
- LOD1: 9,743 triangles (52.2%). It stays below the family manifest's 55% ceiling with negligible
  bounds drift, though it misses the original 6-9k ideal target.
- LOD2: blocked at the simplifier's 46.5% floor; it is not shipped or silently mislabeled.
- The generated one-shell tank was re-split at the actual deck/turret boundary. A low 16-sided armour
  interface is merged into the moving primitive at runtime, sealing the open cut with zero extra draws.
- Runtime material uses a restrained matte-armour response, front faces, stronger tangent normals and
  30-degree crease reconstruction. The procedural Anvil remains the load-failure and current wreck fallback.
