# Meridian Ecliptic Heavy Bomber v1

Status: ImageGen reference accepted for Meshy reconstruction · updated 2026-08-31

## Contract

- Content key: `mrdEcliptic`; model key: `meridian_ecliptic`.
- Role: Meridian four-slot strategic bomber; one focused sun charge, return, 300-tick rearm.
- Envelope: approximately 17 m long, 19 m span and 4.5 m high.
- Forward: +Z. Runtime root: `Hull`. The generated payload is visual only.

## Non-negotiable silhouette

1. Broad manta/delta planform with two large wing cutouts and no conventional tube fuselage.
2. Exactly two separated solar nacelles, one per side, with jade apertures.
3. One suspended centreline sun-charge payload and a stable symmetric flight silhouette.

## Meridian material language

- Warm bone ceramic, deep jade/blue-black solar glass and brushed antique gold structure.
- Contiguous turquoise team panels cover roughly 7–10% of the visible aircraft.
- Broad material blocks and crisp planar breaks remain readable at RTS distance.

## Budgets and gates

- Aircraft LOD0 ceiling: 20k triangles; one or two materials; 5 MiB compressed GLB.
- 2K base colour, 1K normal and packed MR; LOD1/LOD2 plus shadow proxy required.
- Reject extra nacelles, filled wing cutouts, generic fighter geometry or a missing payload.

The authoritative input is `ecliptic-meshy-reference.png`, generated with ImageGen.
