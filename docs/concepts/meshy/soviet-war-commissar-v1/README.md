# Soviet War Commissar v1

Status: Accepted, conditioned, PBR-textured, rigged and integrated.

- Content key: `soviet_commissar`
- Gameplay unit: `commissar`
- Character: War Commissar Zoya Rakhalt
- Runtime height: 2.2 m
- Forward axis: `+Z`
- Hero budget: at most 50,000 triangles at gameplay LOD0; one instance per player
- Rig contract: compatible with the Soviet humanoid proportions and locomotion clips
- Weapon contract: separate runtime rifle; no weapon fused into the body

## Locked cues

- Broad grounded greatcoat, round-brim helmet and sealed gas-mask face.
- Heavy command cape, oversized forged left pauldron and short blade-like crest.
- Field olive cloth and armour, dark gunmetal, restrained deep crimson and one furnace-orange status light.
- Former plate-mill foreman: practical industrial authority, never parade-uniform glamour.

`orthographic-sheet.png` is the original OpenAI ImageGen concept. `views/` contains deterministic front/right/back/left crops used for reconstruction.

## Paid ceiling

- Meshy-6 multi-image geometry-only gate: 20 credits.
- Reference-led PBR retexture after geometry acceptance: 10 credits.
- Auto-rig after topology acceptance: 5 credits.
- Maximum: 35 credits.

## Accepted delivery

- Geometry: `01a04f42-bdd7-7295-864b-b16ca4fa90ab`.
- Reference-led PBR: `01a04f47-2e9c-7667-b516-8ca101fd6383`.
- Humanoid rig: `01a04f4a-69e9-7019-9162-ae3da242f5e6`.
- Spend: 35 credits.
- Gameplay LOD0: 47,883 triangles, 5.22 MiB, one 24-joint skin and one material with 1024 base/normal plus 512 metallic-roughness maps.
- Animation deliveries: mesh-free 72-channel walk and run clips. Gameplay bakes the walk pose at load and discards the live rig.
