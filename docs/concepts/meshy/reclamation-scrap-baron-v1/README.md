# Reclamation Scrap Baron v1

Status: Accepted, conditioned, PBR-textured, rigged and integrated.

- Content key: `reclaim_baron`
- Gameplay unit: `rclBaron`
- Character: Scrap Baron Wren Tallow
- Runtime height: 2.2 m
- Forward axis: `+Z`
- Hero budget: at most 50,000 triangles at gameplay LOD0; one instance per player
- Rig contract: compatible with the Reclamation humanoid proportions and locomotion clips
- Weapon contract: separate runtime arc prod; no weapon fused into the body

## Locked cues

- Broad forward wedge on an open asymmetric salvage frame and canted welder visor.
- Short hide cape on chains, deliberately mismatched large pauldrons and upright salvaged-blade crest.
- Oxide graphite, warm mismatched metals, unmistakable violet armour/arc systems and restrained hazard amber.
- A self-made breaking-yard boss, never beige military armour or polished royalty.

`orthographic-sheet.png` is the original OpenAI ImageGen concept. `views/` contains deterministic front/right/back/left crops used for reconstruction.

## Paid ceiling

- Meshy-6 multi-image geometry-only gate: 20 credits.
- Reference-led PBR retexture after geometry acceptance: 10 credits.
- Auto-rig after topology acceptance: 5 credits.
- Maximum: 35 credits.

## Accepted delivery

- Geometry: `01a04f42-c016-7652-a767-d705aa76fa29`.
- Reference-led PBR: `01a04f47-30e3-7774-8b5e-441ef17e0a15`.
- Humanoid rig: `01a04f4a-6bf7-7084-a4f5-20d5185ee4ca`.
- Spend: 35 credits.
- Gameplay LOD0: 47,655 triangles, 5.92 MiB, one 24-joint skin and one material with 1024 base/normal plus 512 metallic-roughness maps.
- Animation deliveries: mesh-free 72-channel walk and run clips. Gameplay bakes the walk pose at load and discards the live rig.
