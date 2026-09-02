# VOLTMARCH project state

Last refreshed: 2026-09-02

This is the compact record of durable decisions extracted from retired planning documents. It is a
current-state reference, not a backlog and not release authority: code, tests, and the deployment
workflows decide what is actually shipped.

## Current baseline

- Public version: **3.16.1**.
- `voltmarch.com` is the marketing site; `relay.voltmarch.com` is the WebSocket relay; gameplay is
  distributed through the Windows desktop release.
- WebGPU is the desktop product renderer. WebGL remains available for local diagnostics and fallback
  testing; it is not a public gameplay distribution target.
- Deterministic CPU simulation, placement, save identity, and clearing remain authoritative. Use
  workers/WASM for coarse typed-array CPU work only when measured end-to-end; use WebGPU compute for
  render-owned culling, particles, and temporal reconstruction. Dispatch overhead is not a reason to
  move small scalar planners off the main thread.

## Closed realism work

The phases 2–4 implementation is complete across all seven shipped map presets on the local NVIDIA
WebGPU acceptance device. The accepted evidence is:

- 4,096 irradiance probes per map;
- stable simulation hashes through a 40 m camera pan;
- zero post-warmup program growth;
- 47–57 colour draws, below the 130-draw ceiling;
- bounded semantic context grammars, causal shoreline/salt/snow response, damage-to-rubble continuity,
  and shared terrain/road/structure/unit/prop material response.

This closure added no runtime asset, material clone, shader variant, product query flag, render pass,
or draw call. AMD/Intel and packaged-Electron validation remain release gates. The retired planning
document was deleted after these decisions were distilled here.

## Rejected runtime asset cook

The Allied Chrono Miner offline cook proof is not a shipping format. It reduced warm conditioning from
263.65 ms to 0.70 ms, but increased the complete request window by 226.20 ms and family bytes by
71.03%. Do not repeat the Float32 delivery. A future proof must retain compact transport accessors or
use a compact worker-decoded typed-array delivery, and must beat the complete request/decode/scene
construction window before receiving a runtime URL. The retired experiment was deleted after this
decision and its measurements were distilled here.

## Active owner documents

- `docs/AAA_TECHNICAL_ROADMAP.md` — next package-boundary seam and cross-cutting engineering order.
- `docs/ENVIRONMENT_REALISM_PLAN.md` — authored environmental composition and bounded atmosphere.
- `docs/FOLIAGE_ENGINE_PLAN.md` — remaining per-family environment acceptance.
- `docs/STRATEGIC_AIRBASE_PLAN.md` — airbase failure handling and shipping gates.
- `docs/WEBGPU_VISUAL_PERFORMANCE_PLAN.md` — WebGPU, WASM, compute, and measured promotion gates.
- `docs/ASSET_OPTIMIZATION_PIPELINE.md` — asset conditioning, LOD, texture, and shadow budgets.

Do not recreate a retired plan unless new evidence changes its decision. Register actionable backlog in
`TODO.md`; keep detailed acceptance criteria in the owning document above.
