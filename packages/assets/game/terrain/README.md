# Universal terrain detail mask

The ground material applies the mask at `0.418` peak-to-peak luminance strength.
That is an exact 5% relative reduction from the original `0.44`; the parameter
is shader modulation strength rather than alpha opacity. Asphalt and sidewalk
passes use independent values and were deliberately left unchanged.

`universal-terrain-mask-4k.png` is the runtime derivative of an original fully tileable
8192 × 8192 grayscale master supplied by the VOLTMARCH project owner on 2026-08-27.
The master remains outside the repository; this checked-in 4096 × 4096 derivative was resized with
Lanczos filtering and losslessly encoded as PNG.

The runtime derivative is deliberate. An 8192 × 8192 browser texture would occupy roughly 256 MiB
after RGB/RGBA upload and over 340 MiB with mipmaps, before the rest of the battlefield is counted.
The 4096 texture preserves more source detail than the RTS camera resolves while reducing that GPU
footprint by 75%.

The terrain shaders sample this image in world space as luminance and roughness variation. Their
strength is multiplied by the normalized ownership of the natural splat layers only: ground, dirt,
sand and rock, so the terrain pass cannot bleed onto hard surfaces. The separate road material pass
reuses the same GPU texture at lower colour strength for asphalt and sidewalk paving, with a much
wider roughness response so the high-roughness road base can develop visible worn patches. Lane and
kerb paint is applied afterwards; raised kerbs stay untouched and markings remain crisp.
