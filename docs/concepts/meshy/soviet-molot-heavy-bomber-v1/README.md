# Soviet Molot Heavy Bomber v1

Status: ImageGen reference accepted for Meshy reconstruction · updated 2026-08-30

## Contract

- Content key: `sovietMolot`; model key: `soviet_molot`.
- Role: Soviet four-slot strategic bomber; one demolition bomb, return, 300-tick rearm.
- Envelope: approximately 18 m long, 20 m span and 5 m high.
- Forward: +Z. Runtime root: `Hull`. The generated belly bomb is visual only; gameplay owns the projectile.

## Non-negotiable silhouette

1. Long, deep armoured fuselage with a blunt reinforced nose.
2. High swept wing with exactly four separated exposed engines, two per side.
3. Heavy tail, oversized landing gear and one readable centreline demolition payload.

## Soviet material language

- Olive-drab and warm-charcoal riveted plate, gunmetal engines and ochre structural panels.
- Deep red contiguous slabs/edge markings cover roughly 7–10% of the visible aircraft.
- Broad material blocks and heat-darkened exhausts remain readable at RTS distance; micro-wear stays subordinate.

## Budgets and gates

- Aircraft LOD0 target: 12k–20k triangles; one or two materials; 5 MiB compressed GLB ceiling.
- 2K base colour, 2K normal, 1K packed metal/roughness; LOD1/LOD2 plus shadow proxy required.
- Reject extra engines, fused nacelles, fighter proportions, softened armour planes or a missing belly payload.

The authoritative reconstruction input is `molot-meshy-reference.png`, generated with ImageGen. Raw Meshy
deliveries and task metadata remain under `meshy_output/`; only conditioned derivatives enter runtime.
