# Soviet imported building assets

## Tesla Reactor

- Runtime asset: `tesla-reactor.glb`
- V2 geometry task: `01a02c02-8084-7cc4-83bc-0afdc39073fe` (20 credits)
- V2 PBR retexture task: `01a02c0c-63bd-7e9a-aa5b-97bfd0969b8f` (10 credits)
- Shipping mesh: 15,025 triangles, one static primitive/material; the 1,945,782-triangle source is
  retained only in ignored provenance
- Material: one PBR material; 2K base/normal and 1K packed metal-roughness
- Shipping GLB: 3.44 MiB; approximately 48 MiB decoded texture VRAM with mipmaps
- Source views and material target: `docs/concepts/meshy/soviet-tesla-reactor-v2/`
- Meshy credits: 20 geometry + 10 retexture = 30 total
- Generated under the project's paid Meshy account for commercial project use.

V2 replaces the old boiler-like pilot completely. The generated body is the entire visual building:
no legacy procedural shell, chimney or accessory is retained. Its paired induction drums, open busbar,
recessed front chamber and broad capacitor fins preserve the 2x2 gameplay footprint while reading as a
power generator from the RTS camera. The locally reduced source was UV-unwrapped before retexturing, so
the authored olive, charcoal, crimson, brass and green zones remain aligned to real panels without a
paid remesh or post-generation palette wash.

The complete task responses, raw preservation mesh, standalone texture maps,
and previews live in the ignored `meshy_output/` working directory. The game
ships only the final GLB. The repeatable local pass is:

```powershell
npm run asset:prepare -- --input <raw.glb> --output <shipping.glb> --profile building --static-merge
```

It performs hierarchy-aware geometry simplification, embedded-texture
resize/repack, and a final GLB audit. `--static-merge` is used only after proving
the source has no gameplay-moving nodes.

## Construction Yard — rejected pilot

- Runtime asset: none; the procedural `sovietConYard()` is live
- Multi-image geometry task: `01a02947-f2b4-743b-a444-e43dba0d6a7e`
- Superseded PBR retexture task: `01a0294c-e353-75b5-96a1-0b245d4e06f3`
- Clean PBR retexture task: `01a029a8-37d9-76d2-a853-4b68760c9734`
- Rejected conditioned mesh: 32,355 triangles, one primitive (39,396-triangle remesh and 1,970,160-triangle recovery source retained)
- Material: one PBR material; 2K base/normal and 1K packed metal-roughness
- Rejected GLB: 6.67 MiB; approximately 48 MiB decoded texture VRAM with mipmaps
- Source views: `docs/concepts/meshy/soviet-conyard/`
- Meshy credits: 20 geometry + 10 superseded retexture + 10 clean retexture = 40 total
- The source is one static node and was rejected for fused, swollen macro geometry.
- Base colour is conditioned with `--palette soviet-field`, preserving saturated red/yellow while
  converting Meshy's clean neutral armour into the faction's olive field paint.
- A 52-degree crease-normal repair and the cleaner material improved surface readability but could
  not restore the missing hard-surface planes. A probe simplified directly from the 1.97M-triangle
  recovery source confirmed the fault predates remeshing.
- The clean PBR task explicitly removes baked lighting, rust, scratches, chipped
  paint and photoreal grain. Runtime normal strength is deliberately restrained
  so the 2K map reads as panel detail rather than sandpaper at the RTS camera.

Raw models, rejected runtime candidates, task responses, cardinal previews, and provenance remain in the
ignored `meshy_output/20260822_144307_soviet-conyard-construction-ya_01a02947/`
directory. No v1 Construction Yard GLB ships or loads at runtime.

The conditioning command used for the rejected experiment was:

```powershell
npm run asset:prepare -- --input <raw.glb> --output <shipping.glb> --profile hero --ratio 0.78 --error 0.002 --palette soviet-field --static-merge
```

## Flame Tower

- Runtime asset: `flame-tower.glb`.
- Geometry task: `01a02c1d-3bef-7f2d-bbb7-73ffafe32646` (20 credits).
- PBR retexture task: `01a02c24-2f20-72c2-9bb6-f67d52c3f4f2` (10 credits).
- Shipping body: 13,613 triangles, one static primitive/material, 1.63 MiB.
- Material: 1K base/normal and 512 packed metal-roughness; authored olive armour, charcoal burner,
  contiguous crimson foot/pod straps, brass valves, gunmetal pipework and restrained orange bore rings.
- The imported shell is the complete visual defence. No old procedural body or directional turret is
  retained; `MuzzleA`, `MuzzleB` and `Emitter` remain nonvisual gameplay sockets.
- Source geometry/material sheets and review captures: `docs/concepts/meshy/soviet-flame-tower-v1/`.
- Meshy credits: 30 total. Balance after delivery: 780.

## Sentry Gun

- Runtime asset: `sentry-gun.glb`.
- Geometry task: `01a02c29-443e-7a45-a226-d6373f21096b` (20 credits).
- PBR retexture task: `01a02c30-6d1a-72bd-8c64-1162ee28ddd8` (10 credits).
- Shipping asset: 8,327 triangles, two named meshes sharing one material, 1.24 MiB.
- Material: 1K base/normal and 512 packed metal-roughness; authored olive armor, coherent crimson
  feet/service plates, charcoal barrels and turntable, and restrained brass mechanical detail.
- The generated bunker and generated head replace the procedural visuals completely. A deterministic
  post-texture split at the authored turntable seam preserves one texture allocation while allowing the
  head to slew on the gameplay turret pivot. The existing muzzle socket is refitted to the new barrel tip.
- Source views and material target: `docs/concepts/meshy/soviet-sentry-gun-v1/`.
- Meshy credits: 30 total. Balance after delivery: 750.

## Tesla Coil

- Runtime asset: `tesla-coil.glb`.
- Geometry task: `01a02c3a-4dbf-7cec-b09f-046426b20f95` (20 credits).
- PBR retexture task: `01a02c3d-2eb0-7d6b-ab7b-9bc3d41d323f` (10 credits).
- Shipping asset: 7,449 triangles, one static primitive/material, 1.34 MiB.
- Material: 1K base/normal and 512 packed metal-roughness; readable olive transformer bunker and
  mast, charcoal conductor collars, contiguous crimson bunker panels and restrained brass fittings.
- The generated model is the complete visual defence. Its three separated collars retain clean air
  gaps and the compact crown leaves the existing `CoilTip` and `Emitter` gameplay/VFX sockets intact.
- Source views and material target: `docs/concepts/meshy/soviet-tesla-coil-v1/`.
- Meshy credits: 30 total. Balance after delivery: 720.

### V2 Construction Yard — rejected after runtime review

- Runtime asset: none; the procedural `sovietConYard()` is live
- Meshy task: `01a02a84-7be6-7f49-90c4-4f181eb5ae8a`
- Source brief: `docs/concepts/meshy/soviet-conyard-v2/`
- Raw review mesh: 233,661 triangles; PBR task `01a02aa8-3f92-7caf-a3c8-a2476c05451f`
- Corrected crane trim: 206,845 triangles before conditioning. The rejected first trim cut into the
  bunker wall; the current narrower cut preserves the wall and is verified from both camera sides.
- Approved remesh task: `01a02acd-1997-7245-87c4-0dc44192e975`, 5 Meshy credits
- Shipping GLB: 39,328 triangles / 2.96 MiB, one primitive/material; 2K base colour and 1K packed
  metal-roughness
- Meshy omitted the source tangent-space normal map during remesh. The result deliberately ships
  without a neutral replacement after noon WebGL/WebGPU captures proved that its retopologized planes
  retain the required RTS-camera read. This avoids roughly 21 MiB of decoded mipmapped texture memory.
- Runtime review accessory: authored 160-triangle compact service hoist; one shared instanced part using
  the existing Soviet material. Net raw geometry saving is 26,656 triangles versus the raw candidate.
- Runtime fitting uses the remesh's audited normalized bounds, keeping the body centred inside the
  authoritative construction footprint.
- Rejection reason: the remesh softened the hard-surface macro form, retained crane-like residue, and
  the overlapping UV layout caused the deterministic accent paint to appear as unrelated red speckles.
- The runtime import, budget-test entry, and shipping GLB were removed. Raw tasks and local candidates
  remain only in ignored `meshy_output/` provenance.
- V3 starts from a new crane-free orthographic source with the 2.5–4% building accent authored as
  contiguous vertical silhouette slabs rather than a post-generation UV repaint.

### V3 Construction Yard — clean replacement, surface v2

- Runtime asset: `construction-yard-surface-v2.glb`; the geometry and UVs are identical to
  `construction-yard.glb`, which remains the preserved pre-conditioning source.
- Source brief and four-view geometry/material sheets: `docs/concepts/meshy/soviet-conyard-v3/`
- Geometry task: `01a02aeb-365e-7a3a-b25c-a8570817bbd9` (20 credits)
- Triangle retopology task: `01a02aee-8a61-7ca9-a0a8-cd87e779d55b` (5 credits)
- PBR retexture task: `01a02af1-7433-7f68-9511-65bada778287` (10 credits)
- Shipping mesh: 34,927 triangles, one closed static primitive; a detached 12-triangle generation sliver
  was removed reproducibly before conditioning, while the 1,985,286-triangle source is retained
  only in ignored provenance.
- Material: one PBR material; 2K base/normal and 1K packed metal-roughness.
- Shipping GLB: 5.24 MiB.
- The production facade is a deep modeled opening framed by a solid inverted-U portal. There is no
  generated or procedural crane, hoist, lattice, cable, or old Construction Yard body mixed into it.
- No legacy procedural Construction Yard visuals are retained: body, star pad, crane, hoist and
  accessories are all filtered out. The imported shell keeps nonvisual gameplay sockets and construction
  behavior, plus a new asset-specific 32-triangle chamfered contact plinth that replaces the old black
  atlas square consistently in WebGL and WebGPU.
- Crimson is authored by the final Meshy material pass on the front lintel and raised edge plates. No UV
  projection, automatic object-space repaint, or global Soviet palette wash is applied afterward.
- The source material delivered substantially less base-colour variation and normal energy than the
  War Factory/Radar family. The deterministic `--surface-profile soviet-family` pass expands only the
  existing base-colour value separation and plate-border sharpness; it does not classify or repaint UVs,
  add wear, or alter tangent-space normal direction. Runtime crease normals plus compensated painted-steel
  roughness/normal strength restore the shared family response in WebGL and WebGPU.

## Radar Tower

- Runtime body: `radar-tower.glb`
- Geometry task: `01a02b95-348f-713b-8fa3-f11855fff704` (20 credits)
- PBR retexture task: `01a02bab-27e5-71e4-bb27-88d10a8016b5` (10 credits)
- Shipping body: 17,420 triangles, one primitive/material, 3.46 MiB.
- Material: authored olive armour, contiguous crimson side plates and charcoal/brass details; 2K base/normal
  and 1K packed metal-roughness. No automatic palette or accent repaint is applied after Meshy.
- Runtime scan array: the old dish is replaced by a compact asymmetric C-frame array extracted from the
  procedural model by its spinner feature channel. It keeps the existing 0.55 rad/s GPU animation,
  construction rise and animated depth shadow without mixing any of the old building shell into the body.
- The generated body and runtime array are deliberately separate modules: the body remains one reusable
  imported draw, while the moving silhouette stays deterministic and identical in WebGL and WebGPU.
- Source views and material review: `docs/concepts/meshy/soviet-radar-v1/`.
- Meshy credits: 30 total. Balance after delivery: 900.

## Barracks

- Runtime body: `barracks.glb`
- Geometry task: `01a02bcc-276b-7e44-82ab-8cdf0ea164fe` (20 credits)
- PBR retexture task: `01a02bd6-082f-7402-852d-88a842fa5db1` (10 credits)
- Shipping body: 24,917 triangles, one primitive/material, 3.67 MiB.
- Material: authored field-olive armour, coherent crimson buttress/edge slabs, charcoal portal and
  vents, gunmetal pipework and restrained brass/amber details; 2K base/normal and 1K packed
  metal-roughness. No automatic palette repaint is applied after Meshy.
- Runtime door: the generated shell deliberately leaves the deep personnel portal open. A compact
  sliding panel extracted from the procedural door feature retains the existing GPU animation,
  construction rise and animated depth shadow without restoring any part of the old Barracks shell.
- Source views and material target: `docs/concepts/meshy/soviet-barracks-v1/`.
- Meshy credits: 30 total. Balance after delivery: 870.

## Ore Silo

- Runtime body: `ore-silo.glb`
- Multi-image geometry task: `01a02be4-b796-7507-bbaf-d6da6c18a5e7` (20 credits)
- PBR retexture task: `01a02bee-5f05-74f6-9a18-9131bb0463e8` (10 credits)
- Shipping body: 13,264 triangles, one primitive/material, 1.58 MiB.
- Material: field-olive armour, a controlled crimson cap band, charcoal lower service plates,
  gunmetal pipework and restrained brass/amber details; 1K base/normal and 512 packed
  metal-roughness. The deterministic Soviet field pass corrects Meshy's pale neutral shell without
  introducing geometry-projected red accents.
- The imported model is the complete static visual body. The procedural fallback remains available
  only for load failure, while `Hopper` and `DockEntry` remain nonvisual gameplay sockets.
- Source views and material target: `docs/concepts/meshy/soviet-ore-silo-v1/`.
- Meshy credits: 30 total. Balance after delivery: 840.

## Proving Ground

- Runtime body: `proving-ground.glb`.
- Multi-image geometry task: `01a02d1a-320b-7a38-b5fd-5d05a9481db4` (20 credits).
- PBR retexture task: `01a02d1f-ef7b-7797-93e1-fd03013db416` (10 credits).
- Shipping body: 14,790 triangles, one static primitive/material, 3.28 MiB.
- Material: field-olive armour, coherent crimson portal/buttress plates and transformer collars,
  charcoal mechanics, gunmetal conduits and restrained brass/amber electrical detail; 2K
  base/normal and 1K packed metal-roughness.
- The broad accelerator crown, paired transformer shoulders and recessed test portal replace the
  procedural visual body completely. The old body remains only as a load-failure fallback, while
  base and coil-tip gameplay/VFX sockets remain nonvisual.
- Source geometry/material sheets and full production record:
  `docs/concepts/meshy/soviet-proving-ground-v1/`.
- Meshy credits: 30 total. Balance after delivery: 690.

## Command Bunker

- Runtime body: `command-bunker.glb`.
- Multi-image geometry task: `01a02d2e-4403-7ce3-a76e-57764b54f19a` (20 credits).
- PBR retexture task: `01a02d31-afcf-7d61-8efb-a2fe6f6b4885` (10 credits).
- Shipping body: 14,883 triangles, one static primitive/material, 3.07 MiB.
- Material: field-olive armour, coherent crimson buttress/door/pylon plates, charcoal door and
  observation recesses, gunmetal signal hardware and restrained brass/amber fittings; 2K
  base/normal and 1K packed metal-roughness.
- The generated low bunker, faceted map room and solid off-centre communications pylon replace every
  old procedural visual mass. Gameplay base and antenna sockets remain nonvisual.
- Source geometry/material sheets and production record:
  `docs/concepts/meshy/soviet-command-bunker-v1/`.
- Meshy credits: 30 total. Balance after delivery: 660.

## Repair Depot

- Runtime body: `repair-depot.glb`.
- Multi-image geometry task: `01a02d39-8889-7f3d-aa97-2301ee14a7a2` (20 credits).
- PBR retexture task: `01a02d3d-764e-7fdb-a7c0-7128338855aa` (10 credits).
- Shipping body: 15,524 triangles, one static primitive/material, 4.00 MiB.
- Material: faction-conditioned olive armour, coherent crimson pylon/arm/rail service panels,
  charcoal deck and tool recess, gunmetal mechanisms and restrained brass/amber details; 2K
  base/normal and 1K packed metal-roughness.
- The open drive-on deck, low rear workshop, twin service pylons and compact articulated welding arm
  replace all procedural visual geometry while retaining the nonvisual repair socket and gameplay
  clearance.
- Source geometry/material sheets and production record:
  `docs/concepts/meshy/soviet-repair-depot-v1/`.
- Meshy credits: 30 total. Balance after delivery: 630.

## Naval Pen

- Runtime body: `naval-pen.glb`.
- Multi-image geometry task: `01a02d45-cd06-709e-b584-afced660a521` (20 credits).
- PBR retexture task: `01a02d49-c6ac-7e21-a779-b050fe6de07b` (10 credits).
- Shipping body: 14,606 triangles, one static primitive/material, 3.91 MiB.
- Material: faction-conditioned olive armored vaults, a coherent crimson berth surround and outer
  shoulder panels, charcoal channel/quay recesses, gunmetal service hardware and restrained
  brass/amber details; 2K base/normal and 1K packed metal-roughness.
- The broad open berth, low quays, heavy vault shoulders and compact solid signal/exhaust modules
  replace all procedural visual geometry while preserving ship exit clearance and nonvisual dock,
  door, base and service sockets.
- Source geometry/material sheets and production record:
  `docs/concepts/meshy/soviet-naval-pen-v1/`.
- Meshy credits: 30 total. Balance after delivery: 600.

## Nuclear Missile Silo

- Runtime body: `nuclear-silo.glb`.
- Multi-image geometry task: `01a02d4f-e9af-7367-bd4c-fe3fbdb3aed5` (20 credits).
- PBR retexture task: `01a02d53-4dad-7fd6-8710-933f822ce8f1` (10 credits).
- Shipping body: 15,923 triangles, one static primitive/material, 3.94 MiB.
- Material: faction-conditioned olive fortress armour, continuous crimson launch-ring/door-bed/portal
  panels, charcoal launch well and recesses, gunmetal missile bands/hardware and restrained
  brass/amber details; 2K base/normal and 1K packed metal-roughness.
- The recessed launch well, visible warhead, parked-open blast-door slabs and low bastions replace all
  procedural visual geometry while preserving the nonvisual launch and antenna sockets.
- Source geometry/material sheets and production record:
  `docs/concepts/meshy/soviet-nuclear-silo-v1/`.
- Meshy credits: 30 total. Balance after delivery: 570.

## Ironclad Field

- Runtime body: `ironclad-field.glb`.
- Multi-image geometry task: `01a02d57-eeaf-70b1-960b-e1b5e4717264` (20 credits).
- PBR retexture task: `01a02d5b-549a-74d2-a6ac-10a2c15685ce` (10 credits).
- Shipping body: 16,437 triangles, one static primitive/material, 4.01 MiB.
- Material: faction-conditioned olive bunker/pylon armour, continuous crimson pylon/emitter/capacitor
  panels, charcoal recesses and bores, gunmetal buswork, pale field-core faces and restrained
  brass/amber details; 2K base/normal and 1K packed metal-roughness.
- The opposing horizontal emitter drums preserve the required clean air gap, with a visually separate
  rear discharge spire. The imported body replaces all procedural visual geometry while retaining the
  nonvisual field and coil-tip sockets.
- Source geometry/material sheets and production record:
  `docs/concepts/meshy/soviet-ironclad-field-v1/`.
- Meshy credits: 30 total. Balance after delivery: 540.

## Concrete Wall and Gate

- Runtime bodies remain code-native modules in `src/art/BuildingDefs.ts`; there are no per-segment
  GLBs and no unique texture uploads.
- The wall uses a cell-edge poured-concrete revetment, olive armoured coping and pilasters, paired
  vertical crimson identity slabs and a compact inset service face. All secondary geometry remains
  inside the one-cell boundary, so repeated segments meet without doubled posts or bright seams.
- The gate continues the same material and silhouette language with battered edge pylons, a heavy
  armoured lintel, a flush road threshold and a 2.48 m clear aperture. Its paired leaf cores, outer
  rails and hazard bands share the same door feature and retract together into the sill.
- Both modules use the existing Soviet structure atlas and merged structure shader. Meshy credits:
  zero; unique texture memory: zero.
