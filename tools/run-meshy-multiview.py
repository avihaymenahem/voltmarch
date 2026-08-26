#!/usr/bin/env python3
"""Create and archive one geometry-only Meshy multi-view task.

This wrapper keeps paid task creation idempotent at the operator level: it
prints the task id immediately, then uses that same id for polling, download,
recording and the review thumbnail. It never retries task creation.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile


def find_skill_dir(explicit: str | None) -> Path:
    if explicit:
        candidate = Path(explicit).expanduser().resolve()
        if (candidate / "scripts" / "meshy_task.py").is_file():
            return candidate
        raise SystemExit(f"Meshy skill directory is invalid: {candidate}")

    env_dir = os.environ.get("VM_MESHY_SKILL_DIR")
    if env_dir:
        return find_skill_dir(env_dir)

    cache = (
        Path.home()
        / ".codex"
        / "plugins"
        / "cache"
        / "openai-curated-remote"
        / "meshy-openai-plugin"
    )
    candidates = sorted(cache.glob("*/skills/meshy-3d-generation"), reverse=True)
    for candidate in candidates:
        if (candidate / "scripts" / "meshy_task.py").is_file():
            return candidate
    raise SystemExit("Meshy generation skill was not found; set VM_MESHY_SKILL_DIR")


def data_uri(path: Path) -> str:
    mime = "image/png" if path.suffix.lower() == ".png" else "image/jpeg"
    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:{mime};base64,{encoded}"


def captured(cli: Path, *args: str) -> str:
    result = subprocess.run(
        [sys.executable, str(cli), *args],
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
        env={**os.environ, "PYTHONUTF8": "1"},
    )
    if result.stderr:
        print(result.stderr, file=sys.stderr, end="")
    return result.stdout.strip()


def streamed(cli: Path, *args: str) -> None:
    subprocess.run(
        [sys.executable, str(cli), *args],
        check=True,
        env={**os.environ, "PYTHONUTF8": "1"},
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--concept", required=True, help="folder containing cardinal PNG/JPEG views")
    parser.add_argument("--slug", required=True, help="stable asset slug used in Meshy records")
    parser.add_argument("--meshy-skill")
    parser.add_argument(
        "--views",
        nargs="+",
        default=["front.png", "right.png", "back.png", "left.png"],
    )
    args = parser.parse_args()

    concept = Path(args.concept).resolve()
    views = [concept / name for name in args.views]
    missing = [str(path) for path in views if not path.is_file()]
    if missing:
        raise SystemExit(f"Missing concept views: {', '.join(missing)}")

    skill = find_skill_dir(args.meshy_skill)
    cli = skill / "scripts" / "meshy_task.py"
    payload = json.dumps(
        {
            "image_urls": [data_uri(path) for path in views],
            "should_texture": False,
            "enable_pbr": False,
            "ai_model": "latest",
            "image_enhancement": False,
            "target_formats": ["glb"],
        },
        separators=(",", ":"),
    )

    # Four embedded source views exceed Windows' process command-line limit.
    # The bundled CLI supports a payload file, kept in the OS temp directory
    # and removed immediately after the one create call.
    with tempfile.TemporaryDirectory(prefix="voltmarch-meshy-request-") as temp_dir:
        payload_file = Path(temp_dir) / "payload.json"
        payload_file.write_text(payload, encoding="utf-8")
        create_output = captured(
            cli,
            "create",
            "--endpoint",
            "/openapi/v1/multi-image-to-3d",
            "--payload-file",
            str(payload_file),
        )
    task_id = create_output.splitlines()[-1].strip()
    if not task_id:
        raise SystemExit("Meshy create returned no task id")
    print(f"TASK_ID={task_id}", flush=True)

    project_dir = Path(
        captured(cli, "project-dir", "--task-id", task_id, "--prompt", f"{args.slug} geometry")
    )
    print(f"PROJECT_DIR={project_dir}", flush=True)
    streamed(
        cli,
        "poll",
        "--endpoint",
        "/openapi/v1/multi-image-to-3d",
        "--task-id",
        task_id,
        "--project-dir",
        str(project_dir),
    )
    task_json = project_dir / f"task_{task_id}.json"
    raw_glb = project_dir / "raw.glb"
    streamed(
        cli,
        "download",
        "--task-json",
        str(task_json),
        "--format",
        "glb",
        "--output",
        str(raw_glb),
    )
    streamed(
        cli,
        "record",
        "--project-dir",
        str(project_dir),
        "--task-id",
        task_id,
        "--task-type",
        "multi-image-to-3d",
        "--stage",
        "geometry",
        "--prompt",
        args.slug,
        "--files",
        "raw.glb",
    )
    streamed(cli, "thumbnail", "--project-dir", str(project_dir), "--task-json", str(task_json))
    print(f"RAW_GLB={raw_glb}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
