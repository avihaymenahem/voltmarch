#!/usr/bin/env python3
"""Design, preview and save a VOLTMARCH ElevenLabs voice.

The user-facing checkpoint is deliberately only candidate selection. ``design``
creates playable previews; ``select`` persists exactly one preview as a named
voice. The API credential stays in the private user profile.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import urllib.parse
import urllib.error
import urllib.request
from datetime import UTC, datetime
from pathlib import Path


API = "https://api.elevenlabs.io"
DEFAULT_SECRET = Path.home() / ".voltmarch" / "elevenlabs.env"


def read_key(path: Path) -> str:
    lines = [
        line for line in path.read_text(encoding="utf-8-sig").splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    ]
    if not lines:
        raise RuntimeError(f"no credential in {path}")
    value = lines[0].split("=", 1)[-1].strip().strip("\"'")
    if not value or value == "PASTE_KEY_HERE":
        raise RuntimeError(f"credential not configured in {path}")
    return value


def post_json(url: str, key: str, payload: dict, timeout: int = 120) -> dict:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={"xi-api-key": key, "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(
            f"ElevenLabs rejected the request ({error.code}): {detail}"
        ) from error


def design(args: argparse.Namespace) -> None:
    if not 20 <= len(args.description) <= 1000:
        raise RuntimeError("voice description must contain 20–1000 characters")
    if not 100 <= len(args.preview_text) <= 1000:
        raise RuntimeError("preview text must contain 100–1000 characters")
    manifest_path = args.output / "candidates.json"
    if manifest_path.exists() and not args.overwrite:
        raise RuntimeError(f"{manifest_path} already exists; use --overwrite to pay for a new audition")
    estimate = {
        "voiceName": args.name,
        "descriptionCharacters": len(args.description),
        "previewCharacters": len(args.preview_text),
        "model": "eleven_ttv_v3",
        "seed": args.seed,
        "execute": args.execute,
    }
    print(json.dumps(estimate, indent=2))
    if not args.execute:
        return

    key = read_key(args.credential)
    query = urllib.parse.urlencode({"output_format": "mp3_44100_128"})
    result = post_json(
        f"{API}/v1/text-to-voice/design?{query}",
        key,
        {
            "voice_description": args.description,
            "text": args.preview_text,
            "auto_generate_text": False,
            "model_id": "eleven_ttv_v3",
            "seed": args.seed,
            "guidance_scale": args.guidance,
            "should_enhance": False,
            "stream_previews": False,
        },
    )
    args.output.mkdir(parents=True, exist_ok=True)
    candidates = []
    for index, preview in enumerate(result.get("previews", []), start=1):
        suffix = ".mp3" if "mpeg" in preview.get("media_type", "") else ".bin"
        filename = f"candidate-{index}{suffix}"
        (args.output / filename).write_bytes(base64.b64decode(preview["audio_base_64"]))
        candidates.append({
            "index": index,
            "file": filename,
            "generatedVoiceId": preview["generated_voice_id"],
            "mediaType": preview.get("media_type"),
            "durationSeconds": preview.get("duration_secs"),
            "language": preview.get("language"),
        })
    if not candidates:
        raise RuntimeError("ElevenLabs returned no voice candidates")
    manifest = {
        "schemaVersion": 1,
        "designedAt": datetime.now(UTC).isoformat(),
        "voiceName": args.name,
        "voiceDescription": args.description,
        "previewText": result.get("text", args.preview_text),
        "model": "eleven_ttv_v3",
        "seed": args.seed,
        "guidanceScale": args.guidance,
        "candidates": candidates,
        "selected": None,
    }
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"manifest: {manifest_path}")


def select(args: argparse.Namespace) -> None:
    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    if manifest.get("selected") is not None:
        raise RuntimeError("this audition already has a selected voice")
    matches = [item for item in manifest["candidates"] if item["index"] == args.candidate]
    if len(matches) != 1:
        raise RuntimeError(f"candidate {args.candidate} is not in {args.manifest}")
    key = read_key(args.credential)
    chosen = matches[0]
    rejected = [item["generatedVoiceId"] for item in manifest["candidates"] if item is not chosen]
    result = post_json(
        f"{API}/v1/text-to-voice",
        key,
        {
            "voice_name": manifest["voiceName"],
            "voice_description": manifest["voiceDescription"],
            "generated_voice_id": chosen["generatedVoiceId"],
            "played_not_selected_voice_ids": rejected,
            "labels": {"project": "VOLTMARCH", "role": manifest["voiceName"]},
        },
    )
    manifest["selected"] = {
        "candidate": args.candidate,
        "voiceId": result["voice_id"],
        "savedAt": datetime.now(UTC).isoformat(),
    }
    temporary = args.manifest.with_suffix(".json.part")
    temporary.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, args.manifest)
    print(json.dumps({"voiceName": manifest["voiceName"], "candidate": args.candidate}, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--credential", type=Path, default=DEFAULT_SECRET)
    subparsers = parser.add_subparsers(dest="command", required=True)

    design_parser = subparsers.add_parser("design")
    design_parser.add_argument("--name", required=True)
    design_parser.add_argument("--description", required=True)
    design_parser.add_argument("--preview-text", required=True)
    design_parser.add_argument("--seed", type=int, required=True)
    design_parser.add_argument("--guidance", type=float, default=4.5)
    design_parser.add_argument("--output", type=Path, required=True)
    design_parser.add_argument("--execute", action="store_true")
    design_parser.add_argument("--overwrite", action="store_true")
    design_parser.set_defaults(handler=design)

    select_parser = subparsers.add_parser("select")
    select_parser.add_argument("--manifest", type=Path, required=True)
    select_parser.add_argument("--candidate", type=int, required=True)
    select_parser.set_defaults(handler=select)

    args = parser.parse_args()
    args.handler(args)


if __name__ == "__main__":
    main()
