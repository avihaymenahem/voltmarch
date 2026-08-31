# Allied Strategic Airbase v1

Meshy source brief for the four-slot Allied heavy-bomber production structure. The visual system is a compact operations core surrounded by four repeated service pads, not a conventional full-length runway.

- Approved ImageGen source: `strategic-airbase-meshy-reference.png`
- Rejected text-only preview: `01a05424-c311-7049-aaae-45a899da2a9e` (featureless slab, missing four-bay read)
- Accepted PBR reconstruction: `01a0542b-7158-7514-b446-00c8870f2948`
- Shipping source: 88,608 triangles; KTX2 runtime: 6.99 MiB; LOD1: 44,031; shadow: 3,072

- Gameplay envelope: 40 m × 40 m footprint, 11 m maximum height
- Runtime forward axis: +Z, origin centered at ground contact
- Silhouette: low square deck, compact central operations core, four open landing/service pads in a 2×2 arrangement
- Gameplay read: four noses-out bays, unobstructed approach lanes, flush arrestor cradles and blue bay-ready lights
- Materials: white ceramic armor, blue-black deck structure, polished metal service hardware, blue runway glass
- Runtime hierarchy: one connected `Body`; the four pads and core remain visually separable, while bay sockets and state stay authoritative in simulation
- LOD0 shipping target: 70–100k triangles after optimization; 2K–4K shared PBR master atlas, compressed runtime family
- Avoid: aircraft in model, long runway, giant roof/hangar, fused pad mass, terrain/plinth, text/logos, toy proportions

## Meshy preview prompt

Realistic modular Allied strategic airbase kit on a square deck, compact central operations core and four identical clearly separated landing and service pad modules arranged 2x2, open approach lanes with aircraft noses facing outward, flush arrestor cradles, service arms and fuel terminals, blue runway-glass strips and edge lights, white ceramic armor, blue-black structure and polished metal, flat readable deck planes, isolated asset with no aircraft or terrain, no long runway, no giant roof, no text or logo, not cartoon or low-poly.
