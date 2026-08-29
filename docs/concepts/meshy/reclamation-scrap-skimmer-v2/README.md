# Reclamation Scrap Skimmer v2

Content key: `reclaim_skimmer`  
Display name: Scrap Skimmer  
Faction: Reclamation Pact  
Class: cheap armed naval reconnaissance craft  
Frozen gameplay dimensions: 9.0 x 3.4 x 2.8 m  
Forward direction: +Z

## Rebuild decision

The integrated candidate was rejected by the user during the live Asset Lab art gate. V2 is a
from-scratch geometry and material pipeline; no previous mesh or texture is an input. V2 is now the
checked-in runtime asset.

## Art brief

Non-negotiable silhouette cues:

1. A narrow shallow dart hull with a sharply raked wedge bow and visible underside water/hover gap.
2. Exactly one short fixed centreline bow cannon with exactly one barrel.
3. A low offset pilot blister, one enclosed side turbine and a sparse opposite-side salvage frame.

Reclamation cues are graphite armour, warm bare metal, torch-cut seams, violet team slabs on 8-14% of
visible area, one restrained amber recognition mark and limited violet emissive. It must read as fast,
cheap and expendable—not as a transport, a miniature Slag Hauler, or a generic speedboat.

## Gameplay contracts

- Preserve water-only locomotion, sight/recon role, the 9.0 x 3.4 x 2.8 m fit and +Z heading.
- Preserve the fixed muzzle socket, selection, collision, damage and wreck hooks.
- Keep exactly one cannon; there is no turret, cargo deck, bow ramp or passenger space.
- Keep the procedural `reclaim_skimmer` model as the automatic loading/failure fallback.

## Geometry references

`orthographic-sheet.png` and the four `views/` crops are the new neutral-clay reconstruction authority.
Reject extra barrels, turret geometry, a transport-like beam, random junk, loose exhausts, floating frames,
or softened/melted planar surfaces.

## Production record

- Geometry: `01a04eec-a69c-745c-a276-543f75676203` (20 credits).
- Reference-led PBR: `01a04ef3-f304-7168-91b3-e119f99eaa55` (10 credits).
- Shipping LOD0: 21,888 triangles, one material, exactly one fixed bow barrel and three authored 2K
  PBR maps in the canonical graphite/violet Reclamation palette.
- Runtime delivery: 3.55 MiB KTX2 GLB, 9,849-triangle LOD1 and 984-triangle shadow proxy. LOD2 is
  withheld because its 37.0% simplifier floor exceeds the 30% ceiling.
