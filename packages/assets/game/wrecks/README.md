# Authored vehicle wreck

`vehicle-wreck.glb` is the approved conventional tank hulk used by deferred
Allied/Soviet light, medium and heavy wreck overrides. Meridian, Reclamation,
support and naval deaths deliberately keep their faction/class procedural art.
The complete procedural roster remains the load-failure fallback.

## Provenance

- Meshy text-to-3D preview: `01a042f1-71dc-75b7-94d6-49de14380554` (20 credits).
- Meshy PBR refine: `01a042fd-31ed-704b-b510-09f9aab15725` (10 credits).
- Prompt target: a compact low-poly tracked-vehicle wreck with torn armour,
  exposed running gear and no terrain/plinth.
- Raw downloads and API metadata stay in the ignored
  `meshy_output/20260827_141836_stylized-low-poly-rts-vehicle_01a042f1/` folder.

Meshy fused an unwanted circular presentation pedestal into the only connected
mesh. `trim-glb-region.mjs` removed the full bottom band through `y=-0.28`;
the result was visually checked from four cardinal views before promotion.

## Shipping conditioning

```powershell
npm run asset:prepare -- --input <trimmed.glb> --output packages/assets/game/wrecks/vehicle-wreck.glb --profile vehicle --ratio 0.98 --error 0.002 --static-merge
```

The shipping source is one PBR primitive, 3,544 triangles and 2.60 MiB. Runtime
conditioning rebases it to the terrain, maps source `-X` to model-forward `+Z`,
fits each class envelope, applies a restrained faction tint and preserves fog
shroud response. It loads after interaction begins and replaces the procedural
registration only after the GLB succeeds.
