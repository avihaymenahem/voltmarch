# Batch 8 WebGPU foliage compute pilot

**Decision:** keep the tree/bush compute controller as an explicit WebGPU lab path; retain CPU
compaction as the shipping default. The local compaction gate passes, but static and moving
whole-frame gates do not justify promotion or catalogue expansion.

This report records final same-host evidence from 2026-08-31 on native WebGPU (`nvidia ampere`).
Timing cells use fresh Chrome processes, 1920x1080 canvas output, the fixed Allied-base scene, seed
7, a 116 m camera and 120 discarded warmup frames. Each aggregate has two CPU and two compute runs
in ABBA order, 20 blocks per run and 60 submitted frames per block. The 200,000-resample bootstrap
uses seed `0x5ca77e`. These figures are regression evidence for this host, not target-hardware
promises. Raw JSON, logs and captures are retained locally under ignored
`.turbo/batch8-evidence/`.

## What was built

The dynamically loaded node bundle now exposes one world-level controller for the bounded `tree`
and `bush` pilot. It packs 1,648 chunk-sorted source records into storage buffers. Their transforms,
positions, colours, phases and stable IDs are immutable; only the live words can change. The pilot
creates six indexed-indirect commands: tree LOD0/1/2/shadow and bush LOD0/shadow. One reset dispatch
zeros the six indirect instance counts; one 512-invocation compaction dispatch walks two type/chunk
tables, applies live flags and the existing stable stochastic LOD policy, atomically appends complete
matrix/colour/phase/stable-ID records and writes colour/shadow counts. Three r185 still submits six
fixed draw objects; this is indexed indirect, not multi-draw indirect.

The CPU remains authoritative for placement order, 256 chunk AABB broad-phase tests, clearing,
crushing, save fingerprints and felled masks. The pilot uploads the resulting 256 visibility words
on a compaction event, so it proves GPU per-instance selection/LOD/stream compaction but does **not**
claim to remove the CPU chunk tests. Clearing changes one stable GPU live word before the existing
CPU chunk-local swap; the immutable source slot never follows that swap.

The steady frame path has no GPU readback. Exact counts and stable IDs are read only through the
explicit async `foliageComputeAudit()` harness seam. WebGL, WebGPU WebGL2 fallback, `?aa=traa`,
`?aa=taau`, the retired `?scatterbatch=legacy` arm and ordinary WebGPU URLs all remain on CPU.
`?gpu=webgpu&foliagecompute=gpu` is the only opt-in. The elevated 16-storage-buffer device limit is
requested only for that non-temporal, non-legacy lab URL, so ordinary WebGPU boot retains its
baseline device contract. The controller also refuses adapters without `indirect-first-instance`
before it allocates resources. Any construction, dispatch or live-flag error
disposes compute resources, rebuilds the existing CPU meshes and invalidates the next CPU repack.
An adapter below the lab's 16-buffer requirement can reject renderer initialization before Scatter
exists; that limitation affects the explicit experiment only and is intentionally documented rather
than presented as automatic rollback.

The pilot uses 587,624 logical typed-array bytes (0.560 MiB) against a hard 4 MiB ceiling; this is not
a physical VRAM-allocation measurement. Its initial source and command payload is 190,424 bytes:
183,712 immutable bytes plus 6,592 mutable live bytes and 120 mutable indirect-command bytes.
Teardown disposes compute nodes, meshes and geometries and uses
the same guarded Three r185 attribute-manager seam already isolated by the node bundle, because
compute-node disposal alone does not release the backing storage attributes.

## Correctness and visual evidence

The audit compares sorted GPU stable-ID streams against a fresh CPU reference for the last dispatched
view. Atomic output order is deliberately not treated as identity.

| Camera sequence | Visible colour IDs | Tree LOD0/1/2 | Result |
| --- | ---: | ---: | --- |
| 24 m approach | 82 | 62 / 20 / 0 | exact CPU match |
| 62 m approach | 133 | 93 / 27 / 13 | exact CPU match |
| 116 m | 320 | 191 / 22 / 107 | exact CPU match |
| 62 m recede | 133 | 93 / 27 / 13 | exact CPU match |
| 24 m recede | 82 | 62 / 20 / 0 | exact CPU match |

All five samples report zero duplicate IDs and zero invalid/dead IDs. A live clearing probe removed
one visible pilot prop, reduced the CPU live total by one, retained the placement fingerprint and
both storage byte totals, then again matched the CPU reference with zero duplicate/invalid IDs.

Fresh-process CPU captures reproduce byte-for-byte at 24/62/116 m. Compute captures preserve the
same silhouettes, LOD membership and scene composition, but atomic append order is not pixel exact:

| WebGPU capture | Changed pixels | Mean absolute channel delta |
| --- | ---: | ---: |
| noon 24 / 62 / 116 m | 1.783% / 1.771% / 2.581% | 0.271 / 0.132 / 0.157 of 255 |
| dusk 24 / 62 / 116 m | 1.553% / 1.484% / 2.153% | 0.141 / 0.067 / 0.074 of 255 |

The difference is bounded and visually subtle in this non-temporal path, but it is another reason
not to feed atomic-order output into temporal history. A future temporal-compatible controller needs
stable output slots or a double-buffered previous-record mapping, plus motion/reactive-mask evidence.
The unchanged WebGL CPU path was captured at the same three distances as a fallback control.

## Performance result

The deterministic moving fixture is a 30 m triangle-wave pan at 0.5 m per submitted frame. It crosses
8 m LOD bands and 32 m chunk edges. Ordinary Three instance/triangle telemetry is not used for the
indirect commands because it reports mesh capacity; the explicit audit above owns those counts.

| 40-block aggregate | CPU default | Compute pilot | Change / 95% interval |
| --- | ---: | ---: | ---: |
| Static wall/frame median | 2.038 ms | 2.594 ms | +27.27%; [+9.27%, +67.65%] |
| Moving wall/frame median | 1.730 ms | 1.928 ms | +11.42%; [+4.22%, +19.22%] |
| Moving compaction-event p95 | 0.20 ms | 0.30 ms | +50.0% |
| CPU upload/event p95 | 110,628 B | 61,036 B | -49,592 B (-44.83%) |

The earlier draft compared all-family CPU upload time against compute-submit time alone. Independent
review rejected that mismatched scope. The final harness adds the candidate's residual CPU
compaction/upload time for its 30 non-pilot families, and the fresh rerun reverses the conclusion:
event p95 regresses 50% even though bytes fall 44.83%. Whole-frame performance also regresses with
both confidence intervals entirely above zero and well above the +3% ceiling. Render timestamp
samples ranged from zero to 0.393216 ms and compute timestamps remained unavailable, so this report
makes no combined GPU-time claim. Storage, readback and correctness gates pass; every performance
promotion gate fails.

## Independent review

The anonymous review initially rejected the change as merge-ready. It found the renderer bundle
naming violation, the unconditional 16-buffer device requirement, the missing
`indirect-first-instance` capability check and the mismatched event-timing scope. All four were fixed:
bundle isolation, TypeScript and focused tests then passed the bounded re-review. The final repository
gate found and removed a type-only dependency cycle without weakening the frozen policy.

The retained risks are explicit. The lab URL cannot boot on an adapter below its 16-buffer request;
physical buffer retention still needs a 10-20 match same-process RSS/storage plateau; and clearing is
live-proven while a native-WebGPU felled-mask save/apply roundtrip is not. Those are blockers for
promotion, not for retaining an off-by-default diagnostic path.

## Industry mapping

This is the narrow web adaptation of the GPU Scene pattern used by native engines, not an attempt to
clone their renderers. Unreal's instance-culling context allocates indirect arguments, clears their
instance counts and compacts instance runs into draw commands; it also exposes explicit instance-order
preservation. Three r185's official WebGPU draw-indirect example establishes the five-word indexed
command/storage/atomic path used here. Khronos indirect drawing likewise defines draw parameters as
device-read buffer records. VOLTMARCH keeps the parts that fit its scale—immutable render records,
GPU-owned instance selection and indirect counts—and retains the proven CPU broad phase and rollback.

- Unreal `FInstanceCullingContext`:
  <https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/Renderer/FInstanceCullingContext>
- Three.js WebGPU draw-indirect example:
  <https://threejs.org/examples/webgpu_struct_drawindirect.html>
- Khronos indexed-indirect command semantics:
  <https://registry.khronos.org/VulkanSC/specs/1.0-extensions/man/html/vkCmdDrawIndexedIndirect.html>

The native-engine lesson is also the reason for the rejection: GPU-driven infrastructure is valuable
only when the scene is CPU submission-bound enough to repay dispatch, storage and fixed-command cost.
This fixture is not.

## Decision and next work

- Shipping/default behavior: CPU chunk culling and CPU instance compaction on both renderers.
- Retained lab arm: `?gpu=webgpu&foliagecompute=gpu`, limited to `tree` and `bush`.
- Rejected: default promotion, neutral-prop expansion and temporal-mode use.
- Next ordered roadmap batch: Batch 9 timestamp-led GPU/frame-graph optimization. Measure full
  render-pass cost at shipping resolutions before changing post, shadows or environment work.
- Revisit compute only if a denser scene, wider family pilot or lower-dispatch/prefix-sum design can
  move the whole-frame confidence interval below zero while retaining the current correctness gates.
