# Soviet Attack Dog v1

Content key: `soviet_dog`  
Display name: Attack Dog  
Faction: Soviets  
Class: cheap quadruped scout / anti-infantry creature  
Frozen visual envelope: 1.70 x 0.72 x 1.36 m  
Forward direction: +Z

## Art brief

The readable silhouette is a compact black-and-tan military working dog beneath an angular olive
armour saddle, charcoal hardware, two small panniers, a restrained crimson identity band and one
protected sensor pod. The animal must still read as a dog at normal RTS distance: separate legs,
clear head/neck, narrow waist and a grounded stance take priority over small equipment detail.

`orthographic-sheet.png` is the coherent source sheet. `front.jpg`, `right.jpg`, `back.jpg` and
`left.jpg` are its exact cardinal crops supplied to Meshy multi-image reconstruction.

## Gameplay and runtime contracts

- Preserve the existing `attackDog` simulation role, collision, selection radius, muzzle/bite socket,
  damage, death and team presentation.
- Keep `soviet_dog`'s procedural model as the loading and validation fallback.
- Do not allocate a skeleton, animation mixer or draw call per animal. LOD0 and LOD1 remain one
  instanced mesh and receive diagonal-trot metadata consumed by the existing WebGPU/WebGL unit gait.
- The fore and hind limbs rotate around local longitudinal joint centres; body, armour, head, tail,
  panniers and sensor remain welded.
- The geometry-only shadow proxy intentionally stays in the rest pose, matching the existing cheap
  infantry-shadow contract on both renderers.

## Delivered result

- Meshy multi-image geometry task: `01a0494e-4e30-70e5-a170-007164c1d892` (20 credits).
- Meshy exact-topology PBR task: `01a04990-f10a-7be1-a75b-6eea4b18319c` (10 credits).
- Paid remesh skipped; the dense 1,996,680-triangle reconstruction was conditioned locally.
- Shipping geometry: 5,987-triangle LOD0, 2,561-triangle geometry-only LOD1 and 720-triangle
  geometry-only shadow proxy.
- Texture delivery: 1024 px base colour and normal plus 512 px packed metallic/roughness, promoted
  to required KTX2. The runtime GLB is 850,796 bytes versus the 1,078,784-byte conventional source.
- Runtime source: `packages/assets/game/units/soviets/compressed/attack-dog.glb`.
- Derived delivery: `packages/assets/game/units/soviets/derived/attack-dog.lod1.glb` and
  `attack-dog.shadow.glb`.
- Asset Lab catalogue: one family consolidating source, runtime, LOD and shadow delivery files.
- Rigged review delivery: `packages/assets/game/units/soviets/animation/attack-dog-rigged.glb`,
  generated deterministically from the approved source by `npm run asset:rig-quadruped`. It retains
  the 5,987 triangles and one textured primitive, adds eight joints, and embeds Idle, Walk, Run and
  Bite clips in a 1.16 MiB GLB. Meshy's auto-rigger was not used because that endpoint supports
  humanoid bipeds only; no credits were spent on the local rig.
- The rig is the shared-pose/Animation Lab authority. Gameplay continues to use the instanced gait
  delivery until the shared-pose character runtime is promoted, so it still allocates no skeleton
  or mixer per dog.

Final Meshy spend: 30 credits.
