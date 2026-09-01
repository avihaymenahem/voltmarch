# Retained semantic context lighting

The Industrial Grid context-light slice adds bounded local ground/facade response around depot,
civilian and resource anchors on the WebGPU product path. It does not add a render pass, draw call,
runtime asset, worker pool, PMREM rebake, or texture allocation.

## Resource and update lifecycle

- Terrain warmup still creates and transfers the single 64×64 Float32 irradiance field.
- The WebGPU post graph still owns one 64×64 RGBA16F `DataTexture`, one backing `Uint16Array`, and
  one field sample fused into the existing post materialization.
- After the urban semantic sources exist, at most 18 deterministic light descriptors compose into
  the existing Float32 field. The operation retains the array identity and records a bounded texel
  rectangle. Alpha 0–1 remains terrain visibility; alpha 1–2 carries the local-emissive mask.
- The renderer copies the 64 KiB CPU field into its existing 32 KiB half-float backing store and
  performs one retained 32 KiB GPU source reupload. It does not replace the Texture, Source, graph, or
  pipeline. The field is cleared by terrain disposal and the GPU texture is disposed with post.
- Time-of-day changes remain uniform-only. The existing irradiance mood gain is inverted into a
  restrained day floor and stronger dusk/night local lift, so cycling maps never rebake or reupload.

## Cost boundary

The planner caps at 18 anchors. Composition loops only each anchor's 11–28 m footprint against an
8 m texel grid, normally touching hundreds rather than all 4,096 texels. This late job depends on
live semantic structure/resource descriptors; sending it through the world worker would introduce
message cloning and synchronization after the worker's resident terrain job has completed. The
bounded main-thread composition is the smaller boundary and runs once under world initialization.

Runtime cost is one scalar/mask expression on the existing texture sample. There is no additional
texture lookup and no per-anchor shader loop. Diagnostics report anchor count, changed texels,
composition milliseconds, and upload kilobytes.
