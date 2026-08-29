# Reclamation Slag Hauler v2

Content key: `reclaim_hauler`  
Display name: Slag Hauler  
Faction: Reclamation Pact  
Class: eight-slot heavy salvage landing ship  
Frozen gameplay dimensions: 13.0 x 6.2 x 3.6 m  
Forward / ramp direction: +Z

## Rebuild decision

V1 was rejected by the user during the live Asset Lab art gate. V2 is a from-scratch geometry and
material pipeline; no V1 mesh or texture is an input. V2 is now the checked-in runtime asset.

## Art brief

Non-negotiable silhouette cues:

1. A broad low ro-ro carrier contains one large clear vehicle well and one huge off-square bow ramp.
2. One starboard load-bearing C-frame and port-side integrated buoyancy drums create functional asymmetry.
3. An offset stern bridge and tall exhaust/winch cage make the transport recognizable from above.

Reclamation cues are graphite structural armour, warm bare metal, torch-cut seams, useful exposed frames,
violet team slabs on 8-14% of visible area, amber hazard/insignia marks and limited violet emissive. Random
junk, orange-rust dominance, melted scrap, decorative weapons and greeble carpets are rejected.

## Gameplay contracts

- Preserve water-only locomotion, eight cargo slots, the 13.0 x 6.2 x 3.6 m fit and +Z heading.
- Preserve dock-entry, ramp, selection, collision, damage and wreck hooks.
- Keep the vehicle path clear and the ramp mechanically separable.
- Every open frame must be physically connected and closed on its back side.

## Geometry references

`orthographic-sheet.png` and the four `views/` crops are the new neutral-clay reconstruction authority.
Reject inconsistent ramp angles, loose tanks, duplicated cage members, blocked cargo space, weapons,
floating braces, lost asymmetry, or softened/melted planar surfaces.

## Production record

- Geometry: `01a04eec-a663-713e-89ec-f1d2a4402526` (20 credits).
- Reference-led PBR: `01a04ef3-f22b-74f3-8ed6-aeb2c7bc583a` (10 credits).
- Shipping LOD0: 27,855 triangles, one material and three authored 2K PBR maps in the canonical
  graphite/violet Reclamation palette.
- Runtime delivery: 4.56 MiB KTX2 GLB and 1,344-triangle shadow proxy. Both colour LODs are withheld:
  their 71.2% and 70.1% simplifier floors exceed the approved ceilings.
