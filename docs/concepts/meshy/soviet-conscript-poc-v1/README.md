# Soviet Conscript infantry POC v1

Status: textured rig + cheap LOD0 + bounded army-rendering POC / WebGPU gate passed.

## Asset contract

- Content key: `soviet_conscript`
- Gameplay unit: `conscript`
- Faction: Soviet
- Runtime height: 2.2 m
- Forward axis: `+Z`
- Intended use: RTS infantry viewed mostly at distant camera ranges
- Weapon: separate runtime rifle; do not fuse a weapon into the character mesh

## Locked silhouette and faction cues

- A flared knee-length greatcoat is the dominant body mass.
- Broad round-brimmed steel helmet, gas-mask face, heavy gauntlets and square-toed field boots.
- Compact radio backpack with a short antenna.
- Field olive cloth, warm-black rubber/leather, riveted gunmetal and restrained brass.
- Deep-red armour remains in broad contiguous upper-chest, shoulder and helmet-band regions.
- Elbows, wrists, knees, coat hem and boots must remain cleanly separated for rigging.

## Production gates

- Geometry target: approximately 2,500-3,500 triangles for the game LOD0 when the silhouette survives reduction.
- Hard Meshy generation ceiling: 300,000 faces before local optimization.
- One skinned material preferred; 512 px base/normal and 256 px metallic-roughness/auxiliary textures.
- Required motions for the POC: idle/T-pose inspection, walk, run and run-and-shoot.
- Geometry must pass cardinal-view inspection before paid rigging, animation or texturing continues.

## Source reference

`turnaround.png` is the production geometry reference. The four files in `views/` are padded to a common canvas without rescaling the character, preserving consistent proportions between views.

Generated with OpenAI ImageGen on 2026-08-28 from the VOLTMARCH Soviet infantry visual contract: strict orthographic T-pose, front/right/back/left views, identical scale and baseline, clean studio background, no weapon, text, logo or perspective distortion.

## POC result

- Geometry task: `01a047c5-3b92-7b76-a835-5b28d84e1e3f`
- Shipping remesh task: `01a047da-196f-7a33-af83-7f14fac5f480`
- Shipping rig task: `01a047dc-de86-74d8-9f7d-d5d2ad426b5c`
- Run-and-shoot animation task: `01a047d0-4061-71d2-99e6-fbe7a16e637e` (action 98)
- Shipping PBR task: `01a047db-02b9-7a7e-9bf3-1b1709949fe9`
- Paid cost: 83 credits. Meshy's newly enforced rig limit required exploratory 300k/30k branches before the accepted 10k topology branch; those rejected intermediates are retained only in `meshy_output`.
- Accepted gameplay LOD0: 4,500 triangles, one material, 24 bones, 1.56 MiB.
- Texture budget: 512 px base/normal and 256 px metallic-roughness.
- Texture-to-rig projection: maximum positional delta 3.442 mm, below the fail-closed 0.5%-of-height transfer ceiling.
- Clip assets: animation-only walk, run and run-and-shoot GLBs (28-32 KiB each).

The standalone tester is `apps/asset-lab/infantry.html?faction=soviets`. Its faction selector switches between the Allied and Soviet POCs while preserving the requested stress count. The safe rendering path bakes finite bounded CPU pose frames and renders four ordinary `InstancedMesh` buckets; it does not submit the known-bad live WebGPU skinning path.

Fresh Electron/WebGPU validation passes T-pose, walk, run and run-and-shoot in both army and single-soldier modes. The 512-soldier Soviet run submits 12 draw calls and 4,665,441 triangles at the VSync-limited 60 fps control on the development host. These files remain a pipeline POC; gameplay integration and an offline build-time pose pack are still pending.
