# Allied Frogman runtime assets

`frogman-lod0.glb` is the approved 10,443-triangle Meshy body with 512 px base/normal and
256 px metallic-roughness maps. `frogman-walk.glb` contains only the authored animation channels;
runtime samples the pose once, derives the instanced gait mask from skin weights, and discards the
live rig. The built-in procedural Frogman remains the fail-closed fallback.
