# Allied Peacekeeper animation POC v1

Status: textured rig + cheap LOD0 + bounded army-rendering POC / WebGPU gate passed

Content key: `allied_rifle`  
Gameplay def: `gi`  
Class: humanoid infantry  
Faction: Allied Forces  
Height contract: 2.2 m  
Forward: +Z  

## Purpose

This is the first imported-infantry animation proof. It must prove that a Meshy-generated humanoid
can preserve VOLTMARCH's large-army batching, walk at the simulation's real speed, blend an upper-body
firing action over locomotion, and keep the gameplay muzzle attached to the weapon barrel.

## Locked silhouette cues

1. Broad, high-shouldered convex plated chest rig over a narrow protected waist.
2. Domed helmet with blue glass visor and one compact aerial.
3. Straight armoured legs and compact articulated boots that remain readable at normal RTS zoom.

## Locked faction cues

1. Cool grey-white ceramic armour with blue-black recesses.
2. One contiguous cobalt accent family across chest, shoulders, helmet and thighs.
3. Restrained chrome joints and a small cyan-blue visor rather than broad emissive surfaces.

## Geometry and rig gate

- Strict T-pose, arms and legs separated, no weapon fused to the body.
- One humanoid component; the bullpup rifle is a separate rigid asset attached at runtime.
- Shipping gameplay LOD0 target: 2,500-3,500 triangles, one material, 512 base/normal and 256 packed MR.
- Shared Allied humanoid skeleton; walking/running clips must retarget to later Allied infantry.
- Required sockets: right hand, left support hand, weapon root and muzzle.
- Reject fused limbs, swollen armour, crossed joint geometry, floating parts, asymmetric cardinal views,
  or deformation that collapses shoulders, elbows, hips or knees.

## Paid-task ceiling

- Multi-image geometry: 20 Meshy credits.
- Auto-rig with bundled walk/run: 5 Meshy credits.
- One custom firing/recoil clip: 3 Meshy credits.
- PBR texture is a separate 10-credit gate after geometry and deformation approval.

Task IDs, audited triangle counts, source hashes and accepted/rejected outputs are recorded below as
the pipeline advances.

## Provenance

The four-view source sheet is original OpenAI ImageGen-assisted concept art commissioned for
VOLTMARCH on 2026-08-28. `turnaround.png` is the retained source; `views/` contains deterministic
crops used for reconstruction.

## POC result

- Geometry task: `01a0471b-1222-73ac-abfa-782f719cd83a`
- Rig task: `01a04721-cdb4-7e5a-976b-64e8227fcabb`
- Run-and-shoot animation task: `01a04726-44a9-75d9-857b-7ed395b0710f`
- PBR retexture task: `01a04741-88a8-7374-9978-8d26ebc0c83b`
- Paid cost: 38 credits total (20 geometry + 5 rig + 3 animation + 10 texture)
- Review source: 23,754 triangles, one skinned mesh, 24-joint humanoid rig
- Conditioned gameplay LOD0: 2,888 triangles, one material, 0.58 MiB GLB,
  512 base/normal and 256 packed metallic/roughness
- Included clips: walk, run, and run-and-shoot
- Texture/skin transplant: accepted; maximum mapped positional delta 1.559e-6 m

The standalone review surface is `apps/asset-lab/infantry.html`. It defaults to WebGPU;
`?gpu=webgl` is retained only as an explicit comparison. The GLBs used by that lab live under
`packages/assets/game/units/allies/infantry-poc/`; they remain a pipeline POC, not an approved
shipping infantry replacement.

`tools/infantry-animation-viewer.mjs` opens the lab in an isolated visible Electron/WebGPU process
when an existing browser GPU process is still recovering from a reset. The lab disables Three
r185's same-canvas WebGL fallback before initialisation; a missing WebGPU adapter is reported
directly and never converted into the misleading null-context `getSupportedExtensions` failure.

Direct Three r185 `SkinnedMesh` and custom animation-texture WebGPU probes both lost the device with
`DXGI_ERROR_DEVICE_HUNG` on the current Windows/Dawn host, even at one unit. A fail-closed source
audit ruled out invalid joint indices, malformed weights, non-finite matrices and clip data, and
budget overflow. The common failing operation was GPU-side variable indexing into animation
transform tables, so both live-GPU animation paths are explicitly rejected rather than retried.

The accepted POC bakes the rig to shared CPU position/normal frames and renders the army through
four ordinary `InstancedMesh` phase buckets. The single-soldier authoring view uses the same safe
path. Focused skinning/audit tests pass, and fresh Electron processes pass all T-pose, walk, run,
and run-and-shoot states in both army and single mode under WebGPU and the explicit WebGL
comparison. The 48-unit WebGPU formation is 14 calls including scene/shadow work and uses a bounded
7.2 MiB animation bake. The clean-reload stress control accepts 1-512 soldiers and reports frame
time/FPS; its 512-soldier WebGPU sweep passes all eight modes at 12 calls and 3,014,753 submitted
triangles in run-and-shoot. That ceiling is a lab circuit breaker rather than a gameplay promise.
Game integration and an offline build-time frame pack remain the next gate; runtime baking must not
be added to match startup.
