# Reclamation Scrap Picker animation POC

This folder is the canonical runtime source for the Reclamation infantry proof
used by Asset Lab. It is not yet wired into gameplay army rendering.

- Character: `reclaim_picker` / Scrap Picker
- Height: 2.2 m
- Gameplay LOD0: 8,501 triangles, one skinned material, 24-bone Meshy humanoid
- Textures: 512 px base/normal and 256 px metallic-roughness
- Clips: animation-only walk, run, and run-and-shoot GLBs
- Geometry task: `01a04833-2966-735d-8f84-6499a93e784a`
- Rigging task: `01a0483a-05ad-7b50-83f4-499d3c626580`
- Run-and-shoot task: `01a0483d-481e-7c26-a163-fbea86c36874`
- PBR task: `01a0483d-49ea-7c27-adca-b9b811bc6430`
- Texture/skin transfer maximum positional delta: 0.000395 mm

Open `apps/asset-lab/infantry.html?faction=reclamation` through the Asset Lab
Vite server, or use the Faction selector in the tester. Its asymmetric coil and
pauldron set the faction silhouette; the weapon remains a shared runtime socket
proof rather than duplicated character geometry.

## Shared-body roles

Scrap Picker, Slagger and Tinker all load this one body and animation set. Slagger identity comes
from an instanced hopper/slag-projector pair; tinker identity comes from a rolled tool pack and
salvage cutter. Each code-native attachment is independently hard-capped at 200 triangles. The paid
unique Slagger body was rejected as redundant and archived outside the shipping package.
