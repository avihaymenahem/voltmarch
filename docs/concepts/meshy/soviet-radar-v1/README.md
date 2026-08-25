# Soviet Radar Tower v1

Content key: `soviet_radar`  
Display name: Radar Tower  
Faction: Soviet Union  
Class: 2x2 command / detection building  
Frozen gameplay dimensions: 8 x 8 x 12 m (`BUILDING_DIMENSIONS.radar`)  
Facade: +Z  
Array pivot: building centreline at approximately 10.2 m

## Art brief

The Radar Tower is a compact armoured command bunker carrying one unmistakable rotating Soviet
scan array. It must read as detection infrastructure at normal RTS distance while staying visually
lighter and narrower than the Construction Yard, War Factory and Ore Refinery.

Non-negotiable silhouette cues:

1. A low octagonal-plan control bunker with deeply chamfered corners and a clear front service door.
2. One battered central drum tower and stout mechanical spindle, visually capable of carrying the
   array without a thin mast or floating connection.
3. A broad asymmetric horizontal scan frame with a solid crimson receiver panel, counterweight and
   thick waveguide. The array must remain readable while rotating about the world-up axis.

Soviet faction cues:

1. Deep olive riveted armour is the dominant shell material.
2. Contiguous crimson vertical armour slabs and one large crimson array panel occupy a controlled
   share of the silhouette; never use a red hull tint or random red speckles.
3. Charcoal vents, gunmetal mechanisms, restrained brass collars and tiny amber status lamps supply
   industrial separation without muddy grunge.

Reject parabolic satellite dishes, giant domes, long lattice towers, wires, cables, thin antennae,
railings, floating pieces, loose props, cranes, random roof clutter, melted panels, rounded blob
forms, baked lighting, camouflage and photoreal-grey materials.

## Gameplay and animation contracts

- Preserve the 2x2 footprint, 12 m silhouette ceiling, selection and collision contract.
- Preserve `PartId.Dish` at the rotating scan assembly and `PartId.Antenna` at the top receiver.
- Preserve the continuous radar sweep at `0.55 rad/s` in WebGL and WebGPU, including the animated
  shadow pass and construction-rise shader.
- The generated bunker and tower body must terminate in a clean circular spindle/socket. The scan
  array is a deliberately authored modular gameplay part, not a hidden copy of the legacy dish.
- Keep the old procedural building as a load-failure fallback until all geometry, material,
  animation, budget and runtime gates pass.

## Production route

The static bunker/tower body is generated from a body-only orthographic sheet. A dedicated
low-triangle scan array is authored locally from the same approved concept around a zero-centred
pivot. It receives the same family material language and a `Feature.Spinner` vertex channel, adding
one intentional instanced draw while retaining zero per-frame CPU animation.

Budgets:

- Static body: 15,000-25,000 LOD0 triangles; one PBR material; 2K base/normal + 1K packed MR.
- Rotating array: 500-2,500 triangles; one material; no thin geometry below the RTS readability
  threshold.
- Shipping GLB: 6 MiB target before later KTX2/LOD work.
- Mandatory shadow proxy and LODs if the final static body remains above 20,000 triangles.

## Approved references

`design-sheet.png` is the complete four-view art-direction sheet. It fixes the bunker silhouette,
stout spindle, asymmetric C-frame array and controlled olive/crimson/charcoal material split.

`body-orthographic-sheet.png` removes the complete rotating assembly and leaves a clean stepped
spindle. `front.png`, `right.png`, `back.png` and `left.png` are its exact 768x768 quadrants and are
the only images supplied to the body generation task. All four use the same object, scale and
baseline in neutral clay. The validated request is stored at
`meshy_output/soviet-radar-v1-geometry-payload.json`: four PNG data URIs, `latest`, texture off,
automatic remesh off and GLB-only output.

## Staged Meshy plan

1. Generate and approve the complete coloured design sheet and body-only neutral geometry sheet.
2. Multi-image body geometry only (`latest`, no texture, no automatic remesh) - 20 credits.
3. Stop and audit all cardinal views, component integrity, spindle, facade, bounds and triangles.
4. Deterministically reduce and unwrap the approved source locally; build the modular array locally.
5. Stop and verify the rotating array, shadow, sockets and construction rise in both renderers.
6. Retexture the exact approved UV model with PBR, original UVs preserved and no HD texture -
   10 credits.
7. Condition textures, integrate and compare beside the four approved Soviet buildings.

Maximum planned Meshy spend: 30 credits. Every paid call remains a separate approval gate.

## Geometry delivery

- Meshy multi-image task: `01a02b95-348f-713b-8fa3-f11855fff704`.
- Consumed credits: 20; account balance after delivery: 910.
- Dense source: 1,975,654 triangles, 987,533 vertices, one primary coherent shell plus one
  deliberately mounted side service pod, 33.91 MiB.
- Approved local body: `local-budget-candidate.glb`, 17,526 triangles, 8,601 vertices and 0.20 MiB.
  Preparation uses the `building` profile, ratio `0.0062`, error `0.002` and static merge.
- Geometry gate: passed neutral front/right/back/left review. Planar walls, front door depth, rear
  service panels, chamfered buttresses, drum tower, flat ground contact and the stepped array spindle
  remain intact without melted forms or generated antenna clutter.
- Final local UV candidate: `local-budget-uv.glb`, exactly 17,526 triangles and zero bounds drift;
  xatlas produces 18,824 seam-split vertices with 8 px padding at 2048 resolution.
- The locally authored asymmetric scan array replaces the old parabolic dish and remains inside the
  pre-existing roster-wide procedural triangle baseline (94/94 building-shape tests pass). It keeps
  `Feature.Spinner`, the 0.55 rad/s sweep, construction rise and animated shadow path.

## Material reference

`material-sheet.png` is the body-only retexture reference. It preserves the approved geometry and
uses the War Factory's successful field-olive armour, coherent crimson buttress plates, charcoal
door/vents, gunmetal spindle, brass collars and tiny amber practical lights. Random red spots,
global tinting, heavy grime and geometry changes are explicitly rejected.

The validated retexture request is `retexture-payload.json` in the Meshy task directory. It embeds
the exact local UV GLB and material sheet, preserves original UVs, enables PBR, disables 4K HD,
removes baked lighting and requests GLB only.

## Material delivery and runtime integration

- Meshy retexture task: `01a02bab-27e5-71e4-bb27-88d10a8016b5`.
- Consumed credits: 10; account balance after the complete Radar Tower: 900.
- Shipping body: 17,420 triangles, 18,538 vertices, one mesh/primitive/material and 3.46 MiB.
- Shipping maps: 2048 base colour, 2048 tangent-space normal and 1024 packed metal-roughness.
- `material-review.png` records the approved front/right/back/left PBR result before runtime grading.
- Runtime asset: `apps/game/src/assets/buildings/soviets/radar-tower.glb`.
- The body replaces the old procedural shell completely. Only the intentionally authored scan array
  is extracted by `STRUCTURE_FEATURE.spin`, retaining the GPU sweep and shadow contract.
