# Allied Peacekeeper animation POC

These GLBs are the first VOLTMARCH skeletal-infantry pipeline proof. The three
clip-source files remain compact and untextured; the standalone lab renders the
textured bind-pose file and applies their animation clips to its shared rig.

Open `apps/asset-lab/infantry.html` through the Asset Lab server to
inspect the model outside the game. WebGPU is the primary and default backend;
append `?gpu=webgl` only for an explicit comparison. The lab provides T-pose,
walk, run, and combined run-and-shoot clips plus a 48-soldier shared-pose
formation.

If the host browser's shared GPU process is recovering from a driver reset, run
`node tools/infantry-animation-viewer.mjs --count=512` to open the lab in a
fresh visible Electron/WebGPU process. The lab disables Three r185's structurally
invalid same-canvas WebGL fallback, so adapter creation failures stop with the
real reason instead of throwing `getSupportedExtensions` on a null context.

The Soldiers control reloads a clean run at any count from 1 to 512 and reports
smoothed frame time/FPS, draw calls, and submitted triangles. The 512 ceiling is
a stress-lab circuit breaker, not a declared gameplay population limit; raise it
only after measuring a target machine and adjusting the guard deliberately.

- Target height: 2.2 m
- Geometry: 23,754 triangles in the review source; 2,888 triangles in
  `peacekeeper-lod0.glb`
- Rig: one skinned mesh, 24-joint Meshy humanoid skeleton
- Materials/textures: Meshy 2K PBR base color, metallic/roughness, and normal
  maps on `peacekeeper-rigged-textured.glb`
- Gameplay LOD0 textures: 512 base/normal and 256 packed metallic/roughness;
  the conditioned rigged GLB is 0.58 MiB
- Temporary rifle: procedural two-hand socket proof in the lab; anchored to the
  trigger hand and oriented through the support hand, not part of the GLB
- Source generation task: `01a0471b-1222-73ac-abfa-782f719cd83a`
- Rigging task: `01a04721-cdb4-7e5a-976b-64e8227fcabb`
- Run-and-shoot task: `01a04726-44a9-75d9-857b-7ed395b0710f`
- PBR retexture task: `01a04741-88a8-7374-9978-8d26ebc0c83b` (10 credits)

Meshy's retexture result normalized the geometry and removed the rig. The
checked-in textured POC is not that static result: its re-authored UV/tangent
geometry was mapped back onto the original skeleton with a maximum positional
delta of 1.559e-6 m. The skin, 24 joints, and authored bind animation are then
validated after writing. `tools/transplant-meshy-rig-texture.mjs` contains the
repeatable, fail-closed transplant step.

Do not wire these files into army rendering as one `SkinnedMesh` plus
`AnimationMixer` per entity. The lab's current army path samples the rig once,
bakes positions/normals into shared CPU frames, and updates four ordinary
`InstancedMesh` phase buckets. Unit count only grows the instance matrices; it
does not add skeletons or mixers.

The lab is intentionally WebGPU-first. On the current Windows/Dawn test host,
both Three r185's live `SkinnedMesh` path and a custom animation-texture shader
lost the device with `DXGI_ERROR_DEVICE_HUNG`. The asset audit found no invalid
joint index, non-finite transform, unnormalised weight, or out-of-bounds clip;
the common trigger was GPU-side variable indexing into animation transform
tables. Those two GPU-animation paths are rejected.

The replacement samples the trusted rig on the CPU and renders only ordinary
bounded geometry through four `InstancedMesh` pose buckets. Even the lab's
single-soldier view uses this path, so a UI toggle cannot accidentally compile
the rejected skinning shader. A fresh-process WebGPU sweep passes all eight
army/single and clip combinations at 48 units; the explicit WebGL comparison
passes as well. A separate 512-soldier WebGPU sweep also passes at 12 scene and
shadow calls for the run-and-shoot state (3,014,753 submitted triangles). The
WebGPU boundary rejects malformed assets before upload,
caps units/bones/vertices/clips/baked memory/render pixels, captures validation,
out-of-memory and internal errors around the first frame, watches uncaptured
errors and device loss, and stops submission if the queue stalls. It never
automatically retries a failed GPU workload.

The T-pose button plays Meshy's authored one-frame bind-pose clip. Do not
replace it with Three's generic `Skeleton.pose()`: that drops the imported
centimetre-scale bone transforms and collapses the preview to 1/100 scale.

## Shared-body roles

Peacekeeper, Javelin and Engineer all load this one body and animation set. Javelin identity comes
from an instanced missile pack/launcher pair; engineer identity comes from a compact toolcase and
powered wrench. Each code-native attachment is independently hard-capped at 200 triangles. The paid
unique Javelin body was rejected as redundant and archived outside the shipping package.
