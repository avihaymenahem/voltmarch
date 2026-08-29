#!/usr/bin/env python3
"""Rig one accepted Meshy humanoid task and archive its GLB outputs."""

from __future__ import annotations

import argparse
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
    parser.add_argument("--input-task-id", required=True)
    parser.add_argument("--project-dir", required=True)
    parser.add_argument("--slug", required=True)
    parser.add_argument("--height", type=float, default=2.2)
    args = parser.parse_args()

    project_dir = Path(args.project_dir).resolve()
    project_dir.mkdir(parents=True, exist_ok=True)
    cli = find_skill_dir() / "scripts" / "meshy_task.py"
    payload = json.dumps(
        {"input_task_id": args.input_task_id, "height_meters": args.height},
        separators=(",", ":"),
    )
    with tempfile.TemporaryDirectory(prefix="voltmarch-meshy-rig-") as temp_dir:
        payload_file = Path(temp_dir) / "payload.json"
        payload_file.write_text(payload, encoding="utf-8")
        output = captured(
            cli, "create", "--endpoint", "/openapi/v1/rigging",
            "--payload-file", str(payload_file),
        )
    task_id = output.splitlines()[-1].strip()
    print(f"TASK_ID={task_id}", flush=True)
    streamed(
        cli, "poll", "--endpoint", "/openapi/v1/rigging", "--task-id", task_id,
        "--timeout", "600", "--project-dir", str(project_dir),
    )

    task_json = project_dir / f"task_{task_id}.json"
    result = json.loads(task_json.read_text(encoding="utf-8"))["result"]
    outputs = {
        "rigged.glb": result["rigged_character_glb_url"],
        "walking.glb": result["basic_animations"]["walking_glb_url"],
        "running.glb": result["basic_animations"]["running_glb_url"],
    }
    for filename, url in outputs.items():
        streamed(cli, "download", "--url", url, "--output", str(project_dir / filename))
    streamed(
        cli, "record", "--project-dir", str(project_dir), "--task-id", task_id,
        "--task-type", "rigging", "--stage", "rigged", "--prompt", args.slug,
        "--files", ",".join(outputs),
    )
    print(f"RIGGED_GLB={project_dir / 'rigged.glb'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
