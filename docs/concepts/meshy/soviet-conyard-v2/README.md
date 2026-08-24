# Soviet Construction Yard v2 geometry brief

This reference set replaces the rejected perspective-heavy v1 inputs. It is intentionally a
geometry blueprint: four isolated orthographic views with identical baseline, scale, camera height,
proportions, and machinery layout.

## Input order

1. `front.png` — production door and apron side, authoritative facade
2. `right.png` — crane viewed end-on
3. `back.png` — uninterrupted rear armour plane
4. `left.png` — opposing end-on side

`orthographic-sheet.png` is the preserved generated source. The four 1024×1024 inputs are
deterministic crops and pads from that source.

## Required Meshy geometry pass

- Route: multi-image-to-3D, geometry only
- Target: 100K–120K triangles for the review source; local conditioning comes later
- Topology: quad-dominant if the endpoint exposes it
- Symmetry: off; the crane and stack are intentionally asymmetric
- Texture generation: off
- Pose: static
- Commercial use: project paid account

Object prompt:

> Game-ready RTS Soviet industrial Construction Yard: a low broad 15m-square hard-surface command
> bunker with crisp planar riveted armour, straight chamfered corners, four heavy concrete feet, a
> deeply recessed rectangular front construction door, separated box/cylinder/pipe roof machinery,
> one tall tapered smokestack, and one offset mechanically plausible lattice tower crane. Preserve
> the exact proportions and component placement in the four orthographic reference images. Keep
> crane truss negative spaces open and every major component mechanically separated. Static
> watertight hard-surface geometry, clean silhouette, flat base, no terrain.

Negative prompt:

> organic, rounded, swollen, melted, fused components, blob, soft bevels, warped walls, curved armour
> planes, asymmetry not shown in references, floating machinery, collapsed crane truss, filled crane
> openings, decorative sculpture, fantasy, character, vehicle, terrain, rubble, vegetation, text,
> logo, star, material texture, scratches, rust, surface noise, baked lighting

## Mandatory free gate before any PBR task

1. Front/back/left/right previews retain straight walls and the same bunker width/depth.
2. The front door remains a deep rectangular negative space—not a painted or swollen panel.
3. Crane truss openings are open, regular, and readable at RTS distance.
4. Stack, crane, roof tank, pipe runs, railings, and bunker are distinct hard-surface masses.
5. The raw source passes a noon in-game silhouette capture before simplification.
6. Failure at any point rejects the geometry; do not retexture it or wrap it in procedural geometry.

## Geometry result

- Meshy task: `01a02a84-7be6-7f49-90c4-4f181eb5ae8a`
- Cost: 20 credits; geometry only, no PBR or generated texture
- Review GLB: 233,661 triangles / 330,300 vertices / 12.76 MiB
- Preserved reconstruction: 1,277,324 triangles / 637,976 vertices / 21.92 MiB
- Actual-count note: the requested 120K quad topology produced 233,661 audited triangles
- Geometry verdict: cardinal previews and neutral noon WebGL/WebGPU in-game capture pass. The bunker
  has planar walls, a true recessed bay, separated roof machines, and open crane truss negatives.
- PBR task: `01a02aa8-3f92-7caf-a3c8-a2476c05451f`, 10 credits. The source publishes one material
  with 2K base/normal and 2K packed metal-roughness; the local profile keeps 2K base/normal and reduces
  metal-roughness to 1K.
- The corrected shell was submitted to Meshy's remesh endpoint as a local GLB data URI, triangle
  topology, 40K target. Task `01a02acd-1997-7245-87c4-0dc44192e975` cost 5 credits and returned
  41,398 triangles. A conservative local 0.95 simplification brought the shipping result to 39,328.
- Lattice-crane performance decision: the first broad trim removed 31,635 triangles but also cut the
  bunker shell below the crane, producing an apparent transparent wall. That cut is rejected. The
  corrected position-aware trim removes 26,816 triangles (11.48%) while retaining the wall below the
  crane; front and opposite-angle WebGL/WebGPU captures confirm the shell is closed.
- Replacement prop: one authored Soviet field-service hoist, 160 triangles and one shared instanced
  accessory draw using the existing faction material. Net saving versus the raw review candidate is
  26,656 triangles (11.41%) before the future shipping topology pass.
- Local material conditioning restores a medium olive shell and converts only approved object-space
  facade/flank/roof faces into red through their existing UVs (`--accent-preset soviet-conyard`). It
  changes 99,147 of 4,194,304 base-colour texels and adds no facade geometry or draw call.
- Shipping GLB: 39,328 triangles, one primitive/material, 2.96 MiB; 2K base colour and 1K packed
  metal-roughness. Meshy did not transfer the normal map; no neutral substitute is shipped because the
  retopo itself passed close WebGL/WebGPU shading review and the omission saves decoded texture memory.
  The 160-triangle hoist remains a separate shared instanced part.
- Scale contract: runtime fitting uses the remesh's audited normalized bounds. Front and opposing-side
  captures verify the repaired wall remains closed and the removed crane volume does not reappear.
- Final verdict: rejected after live runtime review. The 39,328-triangle delivery remained too soft,
  retained crane-like residue, and its overlapping UV islands turned the object-space accent repaint
  into random red spots. The runtime import and shipping binary were removed; do not reuse this source
  for v3.

All generated sources, cardinal previews, local simplification probes, task JSON, and metadata live in
`meshy_output/20260822_202851_soviet-conyard-v2-orthographic_01a02a84/`.

The repeatable accessory trim is:

```powershell
node tools/trim-glb-region.mjs <input.glb> <output.glb> --remove-above-y 0.68 `
  --remove-box "-0.76,0.22,-0.16,-0.18,0.68,0.16"

npm run asset:prepare -- --input <trimmed.glb> --output <review.glb> --profile building `
  --ratio 0.18 --error 0.012 --palette soviet-field --accent-preset soviet-conyard --static-merge
```
