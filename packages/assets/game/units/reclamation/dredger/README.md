# Reclamation Dredger runtime assets

`dredger-lod0.glb` is the approved 20,916-triangle Meshy aquatic body with 512 px base/normal and
256 px metallic-roughness maps. `dredger-walk.glb` contains animation channels only; runtime samples
the authored pose, derives its gait mask from skin weights, then discards the live rig. The
procedural Dredger remains the fail-closed fallback.
