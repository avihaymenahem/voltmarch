# Soviet Heavy Aviation Works v1

Status: ImageGen reference accepted for Meshy reconstruction · updated 2026-08-30

## Contract

- Content key: `sovietAviationWorks`; model key: `soviet_aviation_works`.
- Role: one-per-player Soviet strategic bomber producer and four-bay home.
- Footprint: 8 × 8 cells (32 × 32 m). Forward/facade: +Z. Runtime root: `Body`.
- Simulation owns `Bay0..3`, approaches, touchdown points, capacity and selection/collision bounds.

## Non-negotiable silhouette

1. Exactly four outward-open rectangular hardstands in an unmistakable 2 × 2 arrangement.
2. One compact central armoured bunker connected by chunky fuel pipes.
3. Low blast revetments and exactly one robust service gantry per pad; no thin lattice clutter.

## Soviet material language

- Rough ochre concrete, olive riveted armour, warm-charcoal steel and gunmetal machinery.
- Deep red vertical slabs/edge stripes cover roughly 2.5–4% of the visible building.
- Roofs and pads retain broad value variation under the RTS camera instead of collapsing into one dark slab.

## Budgets and gates

- Complete landmark LOD0 envelope: 70k–100k triangles, one material, 9 MiB compressed GLB ceiling.
- 2K base colour, 2K normal, 1K packed metal/roughness; LOD1 plus shadow proxy mandatory.
- Reject an incorrect pad count, filled approach lanes, fused featureless slab, cropped footprint or Allied styling.

The authoritative reconstruction input is `heavy-aviation-works-meshy-reference.png`, generated with
ImageGen. Raw Meshy deliveries and task metadata remain under `meshy_output/`; only conditioned derivatives
enter runtime.
