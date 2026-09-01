# WebGPU SSGI promotion review

**Date:** 2026-09-01
**Scope:** final bounded local screen-space indirect-light candidate
**Device:** local NVIDIA Ampere adapter, Chrome 152, 2560×1440 D62
**Release authority:** local acceptance; vendor/device closure remains a release gate

## Decision

Accept the corrected candidate for normal WebGPU play. High defaults to low SSGI and Ultra defaults to
medium SSGI. The effect runs at 0.5 resolution with a deterministic non-temporal denoise and requires no
product query flag, runtime asset, worker, WASM module or CPU readback. The retained 64×64 world-space
irradiance field remains authoritative for stable off-screen radiance.

The first candidate was correctly rejected. Live tactical views exposed reduced-resolution horizontal rows,
muddy yellow/brown ground colour bleeding into faction materials, and long-range AO that dulled the whole
scene. The final candidate fixes those failure modes rather than relaxing the visual gate:

- incident radiance is multiplied by the receiving scene colour, preserving faction hue;
- long-range SSGI AO is blended at 0.18 of configured AO, retaining contact without a global grey wash;
- low/medium/high `giIntensity` is 3.4/3.8/4.2;
- the 0.5-resolution denoise is deterministic and non-temporal, so it adds no history swimming or reset.

## Final visual comparison

Both arms used the same built bundle, Allied-base fixture, seed, D62 camera and 2560×1440 output.

| Metric | GTAO control | Final SSGI | Delta |
|---|---:|---:|---:|
| mean luma | 0.34349849 | 0.33946900 | -1.17% |
| mean saturation | 0.45379077 | 0.45375932 | -0.007% |

The saturation delta is effectively zero. Indirect light strengthens local grounding without repainting
purple faction materials with sampled ground colour. The restrained luma change and contact-only AO also
avoid whole-scene dulling.

## Paired frame result

The final paired candidate measurement used the same fixed High-quality setup.

| Metric | GTAO control | Final SSGI | Delta |
|---|---:|---:|---:|
| wall-frame median | 4.336667 ms | 4.536667 ms | +4.61% |
| direct lighting bucket | 0.589824 ms AO | 1.048576 ms GI | +0.458752 ms |

The wall result remains under the 10% promotion gate. Use +0.458752 ms as the conservative marginal
lighting cost. Non-paired total GPU timestamps are clock-sensitive, so the direct replaced-pass and paired
wall deltas are the acceptance evidence. The visual comparison, not timing alone, distinguishes this
accepted candidate from the earlier rejected one.

Commands:

```text
node tools/gpu-frame-ab.mjs --backend webgpu --gi off --size 2560x1440 --frames 40 --blocks 4 --warmup 30 --gpu-passes --no-build --json .codex-artifacts/ssgi/gtao-tuned-control-1440p.json
node tools/gpu-frame-ab.mjs --backend webgpu --gi auto --size 2560x1440 --frames 40 --blocks 4 --warmup 30 --gpu-passes --no-build --json .codex-artifacts/ssgi/v2d-ssgi-1440p.json
```

## Boot and ownership

SSGI adds shader work but no asset fetch, material clone, render-owned CPU buffer, worker pool or WASM
module. Ray marching and denoising stay in GPU memory; a CPU round trip would add copies and boot work.
Earlier three-page measurements found shader preparation and presentation bounded while whole-ready timing
was dominated by unrelated systems/content variance. Representative vendor/device boot closure remains a
release gate rather than being inferred from that noisy total.

## Remaining release gates

- Repeat the accepted 0.5-resolution candidate on representative NVIDIA and AMD WebGPU devices.
- Recheck all-map motion/weather captures for denoise stability and edge loss.
- Keep the 10% wall-frame gate and faction-colour/saturation comparison together; neither alone is enough.
