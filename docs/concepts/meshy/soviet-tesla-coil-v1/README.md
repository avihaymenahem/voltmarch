# Soviet Tesla Coil v1

## Gameplay contract

- Content/build key: `teslaCoil` / `soviet_tesla`
- Footprint: 1 x 1 cells (`4 x 4 m`)
- Gameplay target height: `9 m`
- Static silhouette; existing runtime `CoilTip` and `Emitter` sockets remain authoritative.
- No foundation card, terrain, cables, lattice, floating pieces, text or baked effects.

## Shape hierarchy

1. Low, broad octagonal armored transformer bunker with four grounded feet.
2. Tapered solid induction mast, visibly narrower than the bunker.
3. Three separated conductor collars with clean air gaps.
4. A compact faceted crown electrode that reads clearly at RTS distance.
5. Side capacitor boxes and heavy ceramic insulators as secondary detail only.

The tower must not become a smooth cone, a giant sphere on a stick, or an exposed wire/lattice sculpture.

## Shipping budget

- Geometry: `8k-14k` triangles after local simplification
- One mesh / one material / one draw
- Base color: `1024 x 1024`
- Normal: `1024 x 1024`
- Packed metal/roughness: `512 x 512`
- GLB: `<= 3 MiB`

## Material contract

- Medium-dark Soviet olive painted armor with lighter bevel response
- Charcoal/gunmetal mast recesses and conductor rings
- Warm brass/copper collars and electrical fittings
- Saturated red recognition panels limited to roughly 3-5 percent
- Tiny cool cyan-white energy read only at the crown/insulator gaps
- No random red speckles, camouflage, heavy rust wash or baked lighting

## Delivery

- Geometry task: `01a02c3a-4dbf-7cec-b09f-046426b20f95`
- Retexture task: `01a02c3d-2eb0-7d6b-ab7b-9bc3d41d323f`
- Shipping geometry: `7,449` triangles, one mesh/material
- Shipping GLB: `1.34 MiB`, 1K base/normal and 512 packed metal-roughness
- Runtime: generated visual body only; existing nonvisual coil/emitter sockets and VFX retained
