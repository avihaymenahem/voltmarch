# Meridian Argosy v2

Content key: `meridian_argosy`  
Display name: Argosy  
Faction: Meridian Conclave  
Class: eight-slot heavy solar landing ship  
Frozen gameplay dimensions: 13.2 x 6.0 x 3.6 m  
Forward / ramp direction: +Z

## Rebuild decision

V1 was rejected by the user during the live Asset Lab art gate. V2 is a from-scratch geometry and
material pipeline; no V1 mesh or texture is an input. V2 is now the checked-in runtime asset.

## Art brief

Non-negotiable silhouette cues:

1. A wide ceremonial manta/diamond hull surrounds one deep, unobstructed rectangular tank well.
2. A massive separate trapezoidal bow ramp and twin supported solar shoulders read at RTS distance.
3. A tall rear sun-gate gantry and compact bridge establish a heavy-lift capital silhouette.

Meridian cues are fired-bone ceramic planes, supported radial ribs, deliberate symmetry, jade slabs on
8-14% of visible hull area, restrained gold insignia and warm dark mechanical recesses. The Argosy must
not read as a generic hovercraft, catamaran, armed warship, or enlarged Sun Lighter.

## Gameplay contracts

- Preserve water-only locomotion, eight cargo slots, the 13.2 x 6.0 x 3.6 m fit and +Z heading.
- Preserve dock-entry, ramp, selection, collision, damage and wreck hooks.
- Keep the vehicle path clear from the bow ramp through the tank well.
- Keep the ramp mechanically separable and all solar ribs physically supported.

## Geometry references

`orthographic-sheet.png` and the four `views/` crops are the new neutral-clay reconstruction authority.
Reject fused ramps, blocked cargo space, inconsistent gate legs, floating ribs, lost symmetry, guns,
generic catamaran pontoons, or softened/melted planar surfaces.

## Production record

- Geometry: `01a04eec-a51c-70e7-8c79-a8ed0e5fe582` (20 credits).
- Reference-led PBR: `01a04ef3-f19c-7396-8e71-ec44871ee531` (10 credits).
- Shipping LOD0: 27,690 triangles, two materials, three authored 2K PBR maps; a deterministic jade
  shoulder material restores the required Meridian team read without changing the generated geometry.
- Runtime delivery: 4.59 MiB KTX2 GLB, 14,871-triangle LOD1 and 1,620-triangle shadow proxy. LOD2 is
  withheld because its 52.9% simplifier floor exceeds the 30% ceiling.
