#!/usr/bin/env python3
"""Generate one shared xatlas UV0 while preserving a multi-mesh GLB scene.

This is the articulated companion to ``unwrap-glb-uv.py``.  The static tool
intentionally accepts one mesh; vehicles and defences need their named runtime
parts to survive UV authoring so their pivots can still animate.
"""

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
        description="Unwrap every named GLB mesh into one atlas without flattening the scene."
    )
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--resolution", type=int, default=2048)
    parser.add_argument("--padding", type=int, default=8)
    return parser.parse_args()


def mesh_data(mesh: trimesh.Trimesh) -> tuple[np.ndarray, np.ndarray]:
    vertices = np.asarray(mesh.vertices, dtype=np.float32)
    faces = np.asarray(mesh.faces, dtype=np.uint32)
    if len(faces) == 0 or faces.ndim != 2 or faces.shape[1] != 3:
        raise SystemExit("Every source mesh must contain indexed triangles")
    return vertices, faces


def main() -> None:
    args = parse_args()
    if args.resolution < 64:
        raise SystemExit("--resolution must be at least 64")
    if args.padding < 0:
        raise SystemExit("--padding cannot be negative")

    loaded = trimesh.load(args.input, process=False, maintain_order=True)
    scene = loaded if isinstance(loaded, trimesh.Scene) else trimesh.Scene(loaded)
    geometry_names = list(scene.geometry.keys())
    if not geometry_names:
        raise SystemExit("Source scene contains no geometry")

    atlas = xatlas.Atlas()
    source_data: list[tuple[str, np.ndarray, np.ndarray, np.ndarray]] = []
    for name in geometry_names:
        vertices, faces = mesh_data(scene.geometry[name])
        bounds = np.asarray(scene.geometry[name].bounds, dtype=np.float64)
        atlas.add_mesh(vertices, faces)
        source_data.append((name, vertices, faces, bounds))

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

    output_geometry: dict[str, trimesh.Trimesh] = {}
    reports: list[dict[str, object]] = []
    for index, (name, vertices, faces, source_bounds) in enumerate(source_data):
        vertex_map, unwrapped_faces, uv = atlas[index]
        vertex_map = np.asarray(vertex_map, dtype=np.uint32)
        unwrapped_faces = np.asarray(unwrapped_faces, dtype=np.uint32)
        mapped_faces = vertex_map[unwrapped_faces]
        if not np.array_equal(mapped_faces, faces):
            raise SystemExit(f"xatlas changed triangle indices or winding for {name}")

        uv = np.asarray(uv, dtype=np.float32)
        if not np.isfinite(uv).all() or float(uv.min()) < -1e-6 or float(uv.max()) > 1.000001:
            raise SystemExit(f"xatlas returned invalid UV coordinates for {name}")

        output_mesh = trimesh.Trimesh(
            vertices=vertices[vertex_map],
            faces=unwrapped_faces,
            process=False,
            maintain_order=True,
        )
        output_mesh.visual = trimesh.visual.texture.TextureVisuals(uv=uv)
        output_bounds = np.asarray(output_mesh.bounds, dtype=np.float64)
        bounds_error = float(np.max(np.abs(output_bounds - source_bounds)))
        if len(output_mesh.faces) != len(faces) or bounds_error > 1e-6:
            raise SystemExit(
                f"Geometry changed during UV unwrap for {name}: faces {len(faces)} -> "
                f"{len(output_mesh.faces)}, bounds error {bounds_error:.9g}"
            )
        output_geometry[name] = output_mesh
        reports.append(
            {
                "name": name,
                "triangles": int(len(output_mesh.faces)),
                "source_vertices": int(len(vertices)),
                "uv_vertices": int(len(output_mesh.vertices)),
                "bounds_error": bounds_error,
            }
        )

    output_scene = trimesh.Scene()
    for node_name in scene.graph.nodes_geometry:
        transform, geometry_name = scene.graph[node_name]
        output_scene.add_geometry(
            output_geometry[geometry_name],
            node_name=node_name,
            geom_name=geometry_name,
            transform=np.asarray(transform, dtype=np.float64),
        )

    args.output.parent.mkdir(parents=True, exist_ok=True)
    output_scene.export(args.output, file_type="glb")
    report = {
        "input": str(args.input),
        "output": str(args.output),
        "meshes": reports,
        "triangles": int(sum(item["triangles"] for item in reports)),
        "resolution": args.resolution,
        "padding": args.padding,
        "output_bytes": args.output.stat().st_size,
    }
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
