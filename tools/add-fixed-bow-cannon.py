#!/usr/bin/env python3
"""Replace ambiguous forward protrusions with one cheap fixed bow cannon.

The source mesh remains unchanged except for triangles whose centres extend past
the requested bow cut plane.  A single three-piece cannon is then appended as
part of the same static mesh so the result can be UV unwrapped and textured as
one deterministic asset.
"""

from __future__ import annotations

import argparse
import math
import sys
from pathlib import Path

VENDOR_DIR = Path(__file__).resolve().parent / "_python"
if VENDOR_DIR.is_dir():
    sys.path.insert(0, str(VENDOR_DIR))

import numpy as np
import trimesh


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--cut-x", type=float, required=True)
    parser.add_argument("--mount-x", type=float, required=True)
    parser.add_argument("--tip-x", type=float, required=True)
    parser.add_argument("--y", type=float, required=True)
    parser.add_argument("--z", type=float, default=0.0)
    parser.add_argument("--radius", type=float, default=0.035)
    parser.add_argument("--sections", type=int, default=16)
    return parser.parse_args()


def cylinder_x(radius: float, length: float, centre: tuple[float, float, float], sections: int) -> trimesh.Trimesh:
    mesh = trimesh.creation.cylinder(radius=radius, height=length, sections=sections)
    mesh.apply_transform(trimesh.transformations.rotation_matrix(math.pi / 2, [0, 1, 0]))
    mesh.apply_translation(centre)
    return mesh


def main() -> None:
    args = parse_args()
    loaded = trimesh.load(args.input, process=False, maintain_order=True)
    scene = loaded if isinstance(loaded, trimesh.Scene) else trimesh.Scene(loaded)
    if len(scene.geometry) != 1:
        raise SystemExit(f"Expected one source mesh, received {len(scene.geometry)}")
    source = scene.to_geometry()
    centres = np.asarray(source.triangles_center)
    keep = centres[:, 0] >= args.cut_x
    hull = trimesh.Trimesh(
        vertices=np.asarray(source.vertices),
        faces=np.asarray(source.faces)[keep],
        process=False,
        maintain_order=True,
    )
    hull.remove_unreferenced_vertices()

    length = args.mount_x - args.tip_x
    if length <= 0:
        raise SystemExit("--mount-x must be greater than --tip-x")
    barrel = cylinder_x(
        args.radius,
        length,
        ((args.mount_x + args.tip_x) / 2, args.y, args.z),
        args.sections,
    )
    collar = cylinder_x(
        args.radius * 1.55,
        length * 0.24,
        (args.mount_x - length * 0.12, args.y, args.z),
        args.sections,
    )
    muzzle = cylinder_x(
        args.radius * 1.28,
        length * 0.12,
        (args.tip_x + length * 0.06, args.y, args.z),
        args.sections,
    )
    result = trimesh.util.concatenate((hull, barrel, collar, muzzle))
    result.remove_unreferenced_vertices()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    result.export(args.output, file_type="glb")
    print({
        "input_triangles": int(len(source.faces)),
        "removed_triangles": int((~keep).sum()),
        "cannon_triangles": int(len(barrel.faces) + len(collar.faces) + len(muzzle.faces)),
        "output_triangles": int(len(result.faces)),
        "output": str(args.output),
    })


if __name__ == "__main__":
    main()
