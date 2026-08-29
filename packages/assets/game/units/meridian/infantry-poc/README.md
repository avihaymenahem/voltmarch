# Meridian Wayfarer animation POC

This folder is the canonical runtime source for the Meridian infantry proof used
by Asset Lab. It is not yet wired into gameplay army rendering.

- Character: `meridian_wayfarer` / Wayfarer
- Height: 2.2 m
- Gameplay LOD0: 5,937 triangles, one skinned material, 24-bone Meshy humanoid
- Textures: 512 px base/normal and 256 px metallic-roughness
- Clips: animation-only walk, run, and run-and-shoot GLBs
- Geometry task: `01a04833-28c3-7bc4-b85d-4029a83e830d`
- Rigging task: `01a0483a-04dd-7b4f-9820-922d257469c2`
- Run-and-shoot task: `01a0483d-4756-765a-97ef-bc67aa717b0d`
- PBR task: `01a0483d-48fd-765b-be64-0090dd179751`
- Texture/skin transfer maximum positional delta: 0.000369 mm

Open `apps/asset-lab/infantry.html?faction=meridian` through the Asset Lab Vite
server, or use the Faction selector in the tester. The weapon remains a shared
runtime socket proof and is deliberately not baked into the character GLB.

## Shared-body roles

Wayfarer, Sunlancer and Artificer all load this one body and animation set. Sunlancer identity comes
from an instanced cell pack/lance pair; artificer identity comes from an instrument case and compact
calibrator. Each code-native attachment is independently hard-capped at 200 triangles. The paid
unique Sunlancer body was rejected as redundant and archived outside the shipping package.
