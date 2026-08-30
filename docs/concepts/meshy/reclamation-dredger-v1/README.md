# Reclamation Dredger V1

Status: production · content key: `reclaim_dredger` · created 2026-08-30

The ImageGen four-view sheet locks a clean T-pose, asymmetric salvage pauldron and exactly two back
bottles. Meshy geometry task `01a0506d-4681-77a6-b43c-927cff1bcbbe` consumed 20 credits; remesh
task `01a0506e-dd83-72f5-95d5-06ff83f9bce7` consumed 5 credits; reference-led PBR task
`01a05070-abf9-7683-8e85-f0bd5f41b346` consumed 10 credits; rig task
`01a05070-ac44-747e-b47f-297d81359e4f` consumed 5 credits.

Runtime ships the accepted 20,916-triangle body with 512 px base/normal and 256 px
metallic-roughness maps plus an animation-only walk clip. Gameplay bakes one authored pose, derives
gait from skin weights, then discards the live rig; the procedural Dredger remains the fail-closed
fallback.
