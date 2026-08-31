# Universal terrain detail mask

The ground material applies the mask at `0.418` peak-to-peak luminance strength.
That is an exact 5% relative reduction from the original `0.44`; the parameter
is shader modulation strength rather than alpha opacity. Asphalt and sidewalk
passes use independent values and were deliberately left unchanged.

`universal-terrain-mask-4k.png` is the canonical lossless control derived from an original fully tileable
8192 × 8192 grayscale master supplied by the VOLTMARCH project owner on 2026-08-27.
The master remains outside the repository; this checked-in 4096 × 4096 derivative was resized with
Lanczos filtering and losslessly encoded as PNG. `tools/promote-terrain-mask.mjs` deterministically
derives `universal-terrain-mask-4k.ktx2`, a linear ETC1S delivery with 13 explicit mips. The KTX2 is
the shipping default; `VM_TERRAIN_MASK_ARM=png` selects the PNG only for a build-time control, and
Vite emits exactly one arm.

The runtime delivery is deliberate. An 8192 × 8192 browser texture would occupy roughly 256 MiB
after RGBA8 upload and over 340 MiB with mipmaps, before the rest of the battlefield is counted. The
4096 texture preserves more source detail than the RTS camera resolves. Its PNG is 11,489,212 bytes;
the KTX2 is 3,297,082 bytes (-71.30%). Full-mip residency depends on the adapter-selected transcode
target: BC1/ETC is estimated at 11,184,824 bytes versus 89,478,484 bytes for RGBA8, but an adapter
without supported block compression may still require an RGBA8 fallback. Do not present the
compressed estimate as a universal allocation guarantee.

Runtime KTX2 loading reuses the shared renderer-configured two-worker transcoder pool and awaits the
texture before terrain materials are constructed. The synchronously uploadable neutral 1 x 1 canvas
remains the failure fallback and seeds the PNG control before decoded-image replacement; a pending
`HTMLImageElement` is not itself a safe WebGPU texture.

The terrain shaders sample this image in world space as luminance and roughness variation. Their
strength is multiplied by the normalized ownership of the natural splat layers only: ground, dirt,
sand and rock, so the terrain pass cannot bleed onto hard surfaces. The separate road material pass
reuses the same GPU texture at lower colour strength for asphalt and sidewalk paving, with a much
wider roughness response so the high-roughness road base can develop visible worn patches. Lane and
kerb paint is applied afterwards; raised kerbs stay untouched and markings remain crisp.
