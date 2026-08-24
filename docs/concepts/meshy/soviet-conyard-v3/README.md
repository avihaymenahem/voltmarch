# Soviet Construction Yard v3 — clean restart

V3 does not reuse v1/v2 geometry, textures, UVs, crane parts, or trimmed meshes. The four geometry
inputs were generated together as one coherent neutral-clay orthographic sheet and then cropped with
identical boundaries. The material sheet is a style reference only; it must not be used to bypass the
geometry-only approval gate.

## Geometry inputs

1. `front.png` — authoritative +Z production facade
2. `right.png`
3. `back.png`
4. `left.png`

`orthographic-sheet.png` is the preserved ImageGen source. Every view uses the same baseline, scale,
camera height, roof machinery state, and neutral studio treatment.

Non-negotiable form:

- Low, broad 15m-square fabrication bunker with four external corner buttresses.
- A genuine deep vehicle bay occupying roughly 40% of the front facade.
- A thick inverted-U fabrication portal—two armoured pylons and one box girder—is the hero silhouette.
- One offset tapered exhaust stack, two horizontal pressure vessels, three protected pipe runs, and one
  boxy ventilation block remain mechanically separated.
- Four raised vertical edge plates are reserved for later team colour.
- No crane, boom, jib, hook, hoist, cable, lattice, truss, gantry, or scaffolding.

Geometry prompt:

> Game-ready AAA stylized hard-surface RTS Soviet Construction Yard landmark, exact 15 metre square
> footprint, Y-up, front facade facing +Z. A low broad grounded cast-and-forged industrial fabrication
> bunker with crisp planar armour volumes, straight chamfered corners and four massive external
> load-bearing corner buttresses. The dominant feature is a thick inverted-U fabrication portal
> integrated into the front facade: two armoured pylons and one solid rectangular box girder framing a
> truly deep rectangular vehicle construction bay, 40 percent of facade width, with visible recessed
> shutter, dark interior depth and a short flat exit ramp. Roof machinery is mechanically legible and
> separated: one offset tall tapered exhaust stack, two large horizontal pressure vessels, three simple
> protected pipe runs, one furnace ventilation block. Four smooth raised vertical edge armour plates
> are reserved for colour accents. Large clean bevels, watertight closed shell, flat ground contact,
> crisp hard edges, deliberate negative spaces, mechanically plausible intersections, quiet macro
> surfaces, one static building, no terrain.

Negative prompt:

> tower crane, crane, boom, jib, hook, hoist, cable, lattice tower, lattice gantry, truss, thin railings,
> antenna farm, scaffolding, organic, blob, swollen, melted, pillow bevels, rounded armour planes, warped
> walls, fused machinery, intersecting tanks, floating pipes, filled doorway, fake painted recess,
> shallow door, sealed negative spaces, generic sci-fi, stacked boxes, excessive greebles, micro panels,
> bolts everywhere, ruins, damage, rubble, terrain, vegetation, characters, vehicles, text, logo,
> insignia, material texture, rust noise, scratches, baked lighting.

## Material reference

`material-sheet.png` and its four crops preserve the approved geometry while assigning the VOLTMARCH
Soviet material hierarchy:

- 65–70% quiet olive-drab painted armour.
- 12–15% dark gunmetal machinery and pipework.
- 6–8% warm ochre footing and buttress caps.
- 3–4% contiguous crimson only on raised vertical edge plates and the front lintel.
- Furnace orange only inside narrow functional vent slots.

Texture prompt:

> AAA stylized PBR Soviet industrial material for an RTS landmark. Quiet medium olive-drab painted
> armour in broad clean value blocks; dark gunmetal machinery and protected pipework; warm ochre
> concrete or ceramic footing and buttress caps; deliberate solid crimson only on the four raised
> vertical edge plates and the front bay lintel, with clean hard paint boundaries; furnace orange only
> inside narrow functional vent slots. Crisp riveted seams on major plate borders, restrained edge wear
> only at corners, joints, ramp, exhaust and service contact points. Mid-rough painted steel, darker rough
> cast iron machinery, subtle directional grime below vents. Preserve large readable shapes at RTS
> distance; no baked light or shadow.

Texture negative:

> random red spots, red scratches, red rust, scattered red islands, camouflage, mottled paint, red roof
> wash, full-surface grime, uniform noise, photoreal grey, crushed black albedo, glossy plastic, chrome
> body, neon sci-fi, graffiti, text, logo, star, decals, blood, mud splatter, edge wear everywhere,
> emissive panel wash, baked highlights, baked shadows, ambient occlusion baked into base colour.

## Paid pipeline and stop gates

1. Meshy multi-image geometry only, no texture and no source remesh: 20 credits.
2. Audit raw cardinal views, deep portal, component separation, crane absence, and neutral in-game read.
   Failure stops the pipeline.
3. Remesh the approved geometry to a 34–38K triangle delivery: 5 credits.
4. Repeat geometry, normals, closed-shell, bounds, and WebGL/WebGPU gates. Failure stops the pipeline.
5. Retexture the final topology with `material-sheet.png`, PBR enabled and lighting removal: 10 credits.
6. Audit UV overlap, map roles, red placement, texture memory, and noon/dusk captures before integration.

Maximum paid cost is 35 credits. The geometry, remesh, and texture tasks are separate approvals/stopping
points; a later task is never created just because an earlier task succeeded technically.
