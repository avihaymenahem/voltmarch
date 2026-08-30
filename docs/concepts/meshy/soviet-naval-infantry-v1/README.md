# Soviet Naval Infantry V1

Status: integrated · content key: `soviet_diver` · created 2026-08-30

This unique aquatic body retains the Soviet greatcoat while adding a sealed mask, twin rebreather
tanks, hoses and weighted boots. Meshy geometry task `01a05039-cf05-71ee-b0aa-94348c904b12`
consumed 20 credits. Remesh task `01a05043-851a-707a-81b7-db2fbea2cd59` consumed 5 credits and
produced the accepted 10,347-triangle topology. PBR task
`01a05045-a84e-7100-92ec-26640c5a8ccf` consumed 10 credits; rig task
`01a05045-a89d-718c-bd1d-181c08c37caf` consumed 5 credits.

The tracked body uses 512 px base/normal and 256 px metallic-roughness maps. Its authored walk clip
is animation-only, and runtime bakes the rig once before handing ordinary geometry to RenderBridge.
The procedural Naval Infantry remains the fail-closed fallback.
