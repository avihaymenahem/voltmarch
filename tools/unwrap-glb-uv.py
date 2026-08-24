#!/usr/bin/env python3
"""Generate deterministic xatlas UV0 data without changing an approved GLB's faces."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

VENDOR_DIR = Path(__file__).resolve().parent / "_python"
if VENDOR_DIR.is_dir():
    sys.path.insert(0, str(VENDOR_DIR))

try:
    import numpy as np
    import trimesh
    import xatlas
except ImportError as error:  # pragma: no cover - actionable setup failure
    raise SystemExit(
        "Missing asset dependencies. Run: "
        "py -m pip install --target tools/_python -r tools/asset-requirements.txt"
    ) from error


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Unwrap one coherent GLB with xatlas while preserving its triangles and bounds."
    )
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--resolution", type=int, default=2048)
    parser.add_argument("--padding", type=int, default=8)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.resolution < 64:
        raise SystemExit("--resolution must be at least 64")
    if args.padding < 0:
        raise SystemExit("--padding cannot be negative")

    loaded = trimesh.load(args.input, process=False, maintain_order=True)
    if not isinstance(loaded, trimesh.Scene):
        scene = trimesh.Scene(loaded)
    else:
        scene = loaded
    if len(scene.geometry) != 1:
        raise SystemExit(f"Expected one source mesh, received {len(scene.geometry)}")

    source = scene.to_geometry()
    vertices = np.asarray(source.vertices, dtype=np.float32)
    faces = np.asarray(source.faces, dtype=np.uint32)
    if len(faces) == 0 or faces.shape[1] != 3:
        raise SystemExit("Source must contain indexed triangles")
    source_bounds = np.asarray(source.bounds, dtype=np.float64)

    atlas = xatlas.Atlas()
    atlas.add_mesh(vertices, faces)
    chart_options = xatlas.ChartOptions()
    chart_options.fix_winding = True
    chart_options.max_iterations = 2
    pack_options = xatlas.PackOptions()
    pack_options.resolution = args.resolution
    pack_options.padding = args.padding
    pack_options.bilinear = True
    pack_options.rotate_charts = True
    pack_options.rotate_charts_to_axis = True
    atlas.generate(chart_options=chart_options, pack_options=pack_options)
    vertex_map, unwrapped_faces, uv = atlas[0]

    mapped_faces = np.asarray(vertex_map, dtype=np.uint32)[
        np.asarray(unwrapped_faces, dtype=np.uint32)
    ]
    if not np.array_equal(mapped_faces, faces):
        raise SystemExit("xatlas changed source triangle indices or winding")

    uv = np.asarray(uv, dtype=np.float32)
    if not np.isfinite(uv).all() or float(uv.min()) < -1e-6 or float(uv.max()) > 1.000001:
        raise SystemExit("xatlas returned invalid UV coordinates")

    output_mesh = trimesh.Trimesh(
        vertices=vertices[np.asarray(vertex_map, dtype=np.uint32)],
        faces=np.asarray(unwrapped_faces, dtype=np.uint32),
        process=False,
        maintain_order=True,
    )
    # Trimesh emits a tiny neutral placeholder so TEXCOORD_0 remains referenced
    # in the GLB. Meshy replaces it during retexture; it never ships.
    output_mesh.visual = trimesh.visual.texture.TextureVisuals(uv=uv)
    output_bounds = np.asarray(output_mesh.bounds, dtype=np.float64)
    bounds_error = float(np.max(np.abs(output_bounds - source_bounds)))
    if len(output_mesh.faces) != len(faces) or bounds_error > 1e-6:
        raise SystemExit(
            f"Geometry changed during UV unwrap: faces {len(faces)} -> {len(output_mesh.faces)}, "
            f"bounds error {bounds_error:.9g}"
        )

    args.output.parent.mkdir(parents=True, exist_ok=True)
    output_mesh.export(args.output, file_type="glb")
    report = {
        "input": str(args.input),
        "output": str(args.output),
        "triangles": int(len(output_mesh.faces)),
        "source_vertices": int(len(vertices)),
        "uv_vertices": int(len(output_mesh.vertices)),
        "resolution": args.resolution,
        "padding": args.padding,
        "uv_min": [float(value) for value in uv.min(axis=0)],
        "uv_max": [float(value) for value in uv.max(axis=0)],
        "bounds_error": bounds_error,
        "output_bytes": args.output.stat().st_size,
    }
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
