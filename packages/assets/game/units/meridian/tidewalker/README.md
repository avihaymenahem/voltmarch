# Meridian Tidewalker runtime assets

`tidewalker-lod0.glb` is the approved 20,592-triangle Meshy aquatic body with 512 px base/normal
and 256 px metallic-roughness maps. `tidewalker-walk.glb` contains animation channels only; runtime
samples the authored pose, derives its gait mask from skin weights, then discards the live rig.
The procedural Tidewalker remains the fail-closed fallback.
