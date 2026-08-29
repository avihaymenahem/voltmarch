# Soviet Conscript animation POC

This folder contains the cheap, textured Soviet infantry proof used by the
standalone WebGPU-first infantry tester. It is a pipeline POC, not yet wired
into gameplay army rendering.

- Character: `soviet_conscript` / Conscript
- Height: 2.2 m
- Gameplay LOD0: 4,500 triangles, one skinned material, 24-bone Meshy humanoid
- Textures: 512 px base/normal and 256 px metallic-roughness
- Clips: animation-only walk, run, and run-and-shoot GLBs
- Geometry task: `01a047c5-3b92-7b76-a835-5b28d84e1e3f`
- Shipping remesh task: `01a047da-196f-7a33-af83-7f14fac5f480`
- Shipping rig task: `01a047dc-de86-74d8-9f7d-d5d2ad426b5c`
- Run-and-shoot task: `01a047d0-4061-71d2-99e6-fbe7a16e637e`
- Shipping PBR task: `01a047db-02b9-7a7e-9bf3-1b1709949fe9`
- Texture/skin transfer maximum positional delta: 3.442 mm

Open `apps/asset-lab/infantry.html?faction=soviets` through the Asset Lab
Vite server, or use the Faction selector in the tester.

## Shared-body roles

Conscript, Flak Trooper and Combat Engineer all load this one body and animation set. Flak identity
comes from an instanced drum/flak-gun pair; engineer identity comes from a horizontal gas bottle and
cutting torch. Each code-native attachment is independently hard-capped at 200 triangles. The paid
unique Flak body was rejected as redundant and archived outside the shipping package.
