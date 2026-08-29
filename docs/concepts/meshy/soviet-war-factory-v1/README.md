# Soviet War Factory v1

Content key: `soviet_warfactory`  
Display name: War Factory  
Faction: Soviet Union  
Class: 3x2 landmark vehicle-production building  
Frozen gameplay dimensions: 18 x 12 x 8.5 m (`BUILDING_DIMENSIONS.warFactory`)  
Facade / vehicle exit: +Z  

## Art brief

The War Factory is a broad armoured casting hall, deliberately lower and wider than the
Construction Yard. It must read as the source of heavy vehicles before surface detail is visible.

Non-negotiable silhouette cues:

1. One enormous, deeply recessed vehicle portal occupying roughly half the front width, with a
   thick segmented shutter and a short broad ramp.
2. Two separated longitudinal roof casting drums with clean negative space between them.
3. A low planar bunker shell with heavy corner buttresses and one compact offset exhaust block.

Soviet faction cues:

1. Olive-drab riveted plate is the dominant shell material.
2. Crimson armour slabs frame the portal and break the outer silhouette, never the entire roof.
3. Thick exposed pipework and restrained brass collars support the industrial read.

Reject cranes, lattice, thin railings, cable webs, antenna farms, random roof clutter, rounded
blob forms, fused machinery, painted fake openings, loose props and ornamental micro-geometry.

## Gameplay contracts

- Preserve the 3x2 footprint, selection and collision contract.
- Keep the +Z vehicle door, six-metre exit clearance, apron and rally point unobstructed.
- Preserve the door construction/production feature and its socket. The imported body may remain
  static initially, but the shutter must be separable or replaceable without cutting the shell.
- Keep the procedural model as an automatic loading-failure fallback until all acceptance gates pass.

## Geometry references

`orthographic-sheet.png` is the source sheet. `front.png`, `right.png`, `back.png`, and `left.png`
are exact 768x512 quadrants supplied to Meshy in that order. All four show the same untextured
building at identical scale and baseline.

Generation prompt:

> Create one coherent 2x2 true-orthographic turnaround sheet of a broad 3x2 Soviet armoured
> vehicle-production hall. The same object appears front, right, back and left. Use a squat
> rectangular foundry bunker, an enormous centred deep vehicle portal with a recessed segmented
> shutter and short wide ramp, two separated longitudinal roof casting drums with an open slot,
> one compact offset exhaust block, strong corner buttresses, planar riveted armour and a few thick
> exposed pipes. Keep verticals straight, walls planar, openings real, components separate, ground
> contact level and the full silhouette visible. Neutral matte clay on white; no perspective,
> colour, texture, terrain, props, text, logos, crane, lattice, cables, railings, antennae, tiny
> ornament, rounded blob forms, melted surfaces, floating pieces or cropped parts.

## Material reference

`material-sheet.png` and the four `material-*.png` crops preserve the approved geometry and apply
the intended family palette: clean olive-drab plate, charcoal portal/shutter, contiguous crimson
portal and corner armour, narrow drum bands, muted brass collars, cool steel ramp edges and a small
warm practical light inside the portal. They explicitly reject rust, scratches, dirt, random red
speckles, camouflage, baked shadows and geometry changes.

The material sheet is a retexture reference only. Geometry approval comes from the neutral cardinal
views and an untextured in-game capture.

## Staged Meshy plan

1. Multi-image geometry only (`latest`, no texture, no automatic remesh) — 20 credits.
2. Stop and audit cardinal views, components, door opening, footprint, bounds and raw triangle count.
3. Remesh the approved source toward the 25k-40k landmark envelope — 5 credits.
4. Stop and repeat the geometry gate on the final topology.
5. Retexture that final topology from `material-sheet.png`, PBR enabled, no HD texture — 10 credits.

Maximum planned spend: 35 credits. Downstream steps are skipped if either geometry gate fails.

## Geometry delivery

- Meshy task: `01a02b1e-16f5-7d22-936e-15e29b305a1d`
- Consumed credits: 20
- Source: `meshy_output/20260822_231639_soviet-war-factory-v1-geometry_01a02b1e/raw.glb`
- Dense-source metrics: 1,966,666 triangles, 983,311 vertices, 33.76 MiB, one mesh,
  one primitive, no materials or textures.
- Audited normalized bounds: 1.901 x 0.973 x 1.175; width:depth is 1.62 and can be fitted
  cleanly to the frozen 18 x 12 x 8.5 m gameplay envelope.
- Connected components: one coherent shell, with no detached fragments.
- Geometry review: passed front/right/back/left neutral-clay review. The facade and rear remain
  planar; the vehicle ramp, recessed segmented shutter, two separated roof drums, corner
  buttresses, offset exhaust and pipe run survive without melted or floating geometry.

## Topology recovery

- Meshy remesh task: `01a02b24-f357-77b8-892f-bf9cd25b2ce9`
- Consumed credits: 5
- Requested topology: quad, 18,000 target polygons
- Result: 34,004 triangles, 22,217 vertices, 0.87 MiB, UV0 present.
- Verdict: rejected. The service remesh warped the shutter, softened the portal and buttresses,
  and inflated the front shell. It must never be textured or integrated.

The accepted candidate is instead a deterministic local reduction of the approved dense source:

- Candidate: `meshy_output/20260822_231639_soviet-war-factory-v1-geometry_01a02b1e/local-36k-probe.glb`
- Preparation profile: building, 0.018 ratio, 0.001 simplification error, static merge.
- Result: 35,396 triangles, 17,679 indexed vertices, 0.41 MiB, one coherent mesh.
- Attributes: position-only; production crease normals are regenerated at 38 degrees. UV0 is absent.
- Geometry review: passed the neutral hero/cardinal gate with crease normals and passed an
  untextured WebGPU capture at the frozen 3x2 RTS scale. The shutter, ramp, portal, buttresses,
  drums and exhaust remain distinct with no faceting or melted planes.

## UV delivery

- Meshy UV task: `01a02b35-9211-7e30-92a3-1bf2a05004f6`
- Result: failed at 90% after the service timeout; no model was returned. The temporary 5-credit
  debit was refunded automatically, leaving the account balance unchanged at 970.
- Retry policy: rejected. Do not submit the same paid utility again.

The accepted UV candidate is generated locally with the checked-in xatlas conditioning tool:

- Candidate: `meshy_output/20260822_231639_soviet-war-factory-v1-geometry_01a02b1e/local-36k-uv.glb`
- Command: `npm run asset:unwrap -- <input.glb> <output.glb> --resolution 2048 --padding 8`
- Result: 35,396 triangles, 31,258 UV-split vertices, 1.05 MiB, one mesh, one material, UV0.
- Integrity: exact source triangle indices and winding, zero bounds drift, finite normalized UVs,
  and eight-pixel chart padding at the intended 2048 texture resolution.
- Geometry review: passed a second untextured WebGPU gate with no holes, winding faults or shape
  changes. This is the source approved for retexture.

Retexture is now the next and only paid step: 10 credits, PBR enabled, existing UVs preserved,
HD texture disabled, GLB only.

## Texture delivery

- Material reference: `material-sheet-v2.png`, generated from the approved four-view sheet with
  stronger roster-matched separation: olive shell, contiguous crimson portal/buttress/drum armor,
  charcoal shutter, steel ramp, brass collars and restrained warm practical lights.
- Meshy retexture task: `01a02b62-ca73-70d4-9cc8-cdcef20dfeec`
- Consumed credits: 10
- Raw result: 35,378 triangles, 31,206 vertices, one coherent mesh, one PBR material, 8.80 MiB.
- Textures: 2048 base color, 2048 normal, 2048 packed metal/roughness.
- Conditioned shipping result: `packages/assets/game/buildings/soviets/war-factory.glb`, 4.28 MiB. Base color
  and normal remain 2048; packed metal/roughness is reduced to 1024. Geometry and visible shape
  are unchanged; Meshy removed 18 degenerate source triangles while generating tangents.
- Runtime: front-side PBR, 38-degree crease normals, restrained ambient lift and roster-matched
  painted-metal response. The temporary one-color geometry probe is no longer referenced.
