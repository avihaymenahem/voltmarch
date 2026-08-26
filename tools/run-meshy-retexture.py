#!/usr/bin/env python3
"""Retexture one approved local GLB from an approved material reference."""

from __future__ import annotations

import argparse
import base64
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile


def find_skill_dir() -> Path:
    explicit = os.environ.get("VM_MESHY_SKILL_DIR")
    if explicit:
        candidate = Path(explicit).expanduser().resolve()
        if (candidate / "scripts" / "meshy_task.py").is_file():
            return candidate
    cache = (
        Path.home() / ".codex" / "plugins" / "cache" / "openai-curated-remote"
        / "meshy-openai-plugin"
    )
    for candidate in sorted(cache.glob("*/skills/meshy-3d-generation"), reverse=True):
        if (candidate / "scripts" / "meshy_task.py").is_file():
            return candidate
    raise SystemExit("Meshy generation skill was not found; set VM_MESHY_SKILL_DIR")


def uri(path: Path, mime: str) -> str:
    return f"data:{mime};base64,{base64.b64encode(path.read_bytes()).decode('ascii')}"


def captured(cli: Path, *args: str) -> str:
    result = subprocess.run(
        [sys.executable, str(cli), *args], check=True, capture_output=True,
        text=True, encoding="utf-8", env={**os.environ, "PYTHONUTF8": "1"},
    )
    if result.stderr:
        print(result.stderr, file=sys.stderr, end="")
    return result.stdout.strip()


def streamed(cli: Path, *args: str) -> None:
    subprocess.run(
        [sys.executable, str(cli), *args], check=True,
        env={**os.environ, "PYTHONUTF8": "1"},
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--style", required=True)
    parser.add_argument("--project-dir", required=True)
    parser.add_argument("--slug", required=True)
    args = parser.parse_args()

    model = Path(args.model).resolve()
    style = Path(args.style).resolve()
    project_dir = Path(args.project_dir).resolve()
    if not model.is_file() or not style.is_file():
        raise SystemExit("The approved model and material reference must both exist")
    project_dir.mkdir(parents=True, exist_ok=True)

    cli = find_skill_dir() / "scripts" / "meshy_task.py"
    style_mime = "image/png" if style.suffix.lower() == ".png" else "image/jpeg"
    payload = json.dumps(
        {
            "model_url": uri(model, "model/gltf-binary"),
            "image_style_url": uri(style, style_mime),
            "enable_pbr": True,
            "remove_lighting": True,
            "target_formats": ["glb"],
        },
        separators=(",", ":"),
    )
    with tempfile.TemporaryDirectory(prefix="voltmarch-meshy-retexture-") as temp_dir:
        payload_file = Path(temp_dir) / "payload.json"
        payload_file.write_text(payload, encoding="utf-8")
        output = captured(
            cli, "create", "--endpoint", "/openapi/v1/retexture",
            "--payload-file", str(payload_file),
        )
    task_id = output.splitlines()[-1].strip()
    print(f"TASK_ID={task_id}", flush=True)
    streamed(
        cli, "poll", "--endpoint", "/openapi/v1/retexture", "--task-id", task_id,
        "--project-dir", str(project_dir),
    )
    task_json = project_dir / f"task_{task_id}.json"
    output_glb = project_dir / "retextured.glb"
    streamed(
        cli, "download", "--task-json", str(task_json), "--format", "glb",
        "--output", str(output_glb),
    )
    streamed(
        cli, "record", "--project-dir", str(project_dir), "--task-id", task_id,
        "--task-type", "retexture", "--stage", "textured", "--prompt", args.slug,
        "--files", "retextured.glb",
    )
    streamed(cli, "thumbnail", "--project-dir", str(project_dir), "--task-json", str(task_json))
    print(f"RETEXTURED_GLB={output_glb}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
