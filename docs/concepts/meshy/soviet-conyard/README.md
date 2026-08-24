# Soviet Construction Yard generation brief

- Runtime key: `soviet_conyard`
- Gameplay definition: neutral `conyard`, resolved to Soviet art by builder faction
- Footprint: 3×3 cells / 15×15 metres
- Frozen roofline: 11 metres
- Facade and production exit: +Z
- Current fallback: procedural `sovietConYard()` in `src/art/BuildingDefs.ts`

## Non-negotiable silhouette

1. A low, broad, chamfered command bunker that completely owns its square footprint.
2. One dominant offset yellow lattice crane with a long readable jib.
3. One tall tapered industrial stack counterbalancing the crane.

## Faction reads

1. Olive riveted armour plate and warm concrete/ochre structural feet.
2. Controlled deep-red slabs and door panels, never an all-red building.
3. Yellow lattice plus exposed heavy piping; no generic sci-fi neon language.

## Gameplay hierarchy

- Preserve a wide central recessed dozer bay/door on the +Z facade.
- Keep the crane as a separable node if Meshy produces a clean hierarchy; the initial integration may keep it static.
- Preserve sockets for `Door`, `Crane`, `FlagPole`, `Stack`, and `ExitPoint` from the procedural model.
- The procedural pad, construction state, selection/collision footprint, and fallback remain authoritative.

## Generated references

`turnaround.png` was generated with OpenAI image generation as a single coherent three-panel sheet. `front-left.png`, `left.png`, and `rear-right.png` are deterministic crops prepared for Meshy multi-image-to-3D. The reference intentionally excludes terrain, signage, characters, and detached props.

## Meshy geometry gate

- Multi-image task: `01a02947-f2b4-743b-a444-e43dba0d6a7e`
- Consumed credits: 20
- Remeshed source: 39,396 triangles, 66,502 vertices, one mesh/primitive, 2.48 MiB
- Preserved recovery source: 1,970,160 triangles, 983,790 vertices, 33.81 MiB
- Geometry verdict: **rejected after in-game review**. The bunker mass is swollen and fused,
  the roof machinery lacks deliberate hard-surface planes, and the crane/body junction does not
  match the concept. A local 88,636-triangle probe made from the preserved recovery source showed
  the same defects, proving they exist in Meshy's reconstruction rather than the 40K remesh.
- Limitation: Meshy emitted one static node, so the crane is not an independently animated hierarchy in this source

## Rejected texture experiments

- Superseded PBR task: `01a0294c-e353-75b5-96a1-0b245d4e06f3` (10 credits)
- Clean PBR task: `01a029a8-37d9-76d2-a853-4b68760c9734` (10 credits)
- Local palette pass: `soviet-field`; no additional Meshy credits
- Rejected conditioned output: 32,355 triangles, one body draw, 6.67 MiB
- Texture envelope: 2K base colour, 2K normal, 1K packed metal/roughness
- Final verdict: the cleaner material improved colour separation but could not repair the failed
  macro geometry. Both generated candidates were removed from the shipping asset directory and
  retained only as rejected source evidence under `meshy_output/`. The procedural Construction
  Yard is live again. A replacement generation must pass untextured front/back/left/right and
  in-game silhouette reviews before any more texturing credits are spent.
