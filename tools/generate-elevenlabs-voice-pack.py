#!/usr/bin/env python3
"""Generate one declared VOLTMARCH voice pack through ElevenLabs.

Dry-run is the default. Add ``--execute`` to spend credits. Existing source
takes are never regenerated unless ``--overwrite`` is explicit, making a
partially completed batch safe to resume.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import sys
import urllib.parse
import urllib.request
from datetime import UTC, datetime
from pathlib import Path


API = "https://api.elevenlabs.io"
CATALOG_PATH = Path(__file__).with_name("prepare-voice-pack.py")
DEFAULT_SECRET = Path.home() / ".voltmarch" / "elevenlabs.env"
DEFAULT_OUTPUT = Path.home() / "Downloads" / "Voltmarch"


def load_catalog():
    spec = importlib.util.spec_from_file_location("voltmarch_voice_catalog", CATALOG_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {CATALOG_PATH}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module.PACKS


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


def request_json(url: str, key: str) -> dict:
    request = urllib.request.Request(url, headers={"xi-api-key": key})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def find_voice(key: str, exact_name: str) -> dict:
    query = urllib.parse.urlencode({
        "search": exact_name,
        "page_size": 100,
        "include_total_count": "true",
    })
    payload = request_json(f"{API}/v2/voices?{query}", key)
    matches = [voice for voice in payload.get("voices", []) if voice.get("name") == exact_name]
    if len(matches) != 1:
        raise RuntimeError(f"expected one exact saved voice named {exact_name!r}; found {len(matches)}")
    return matches[0]


def generate_take(key: str, voice_id: str, text: str, output: Path) -> str | None:
    query = urllib.parse.urlencode({"output_format": "wav_48000"})
    url = f"{API}/v1/text-to-speech/{urllib.parse.quote(voice_id)}?{query}"
    body = json.dumps({"text": text, "model_id": "eleven_v3"}).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={"xi-api-key": key, "Content-Type": "application/json"},
    )
    partial = output.with_suffix(output.suffix + ".part")
    with urllib.request.urlopen(request, timeout=120) as response:
        partial.write_bytes(response.read())
        request_id = response.headers.get("request-id") or response.headers.get("x-request-id")
    os.replace(partial, output)
    return request_id


def main() -> None:
    packs = load_catalog()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pack", required=True, choices=sorted(packs))
    parser.add_argument("--credential", type=Path, default=DEFAULT_SECRET)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--overwrite", action="store_true")
    args = parser.parse_args()

    pack = packs[args.pack]
    key = read_key(args.credential)
    voice = find_voice(key, pack.display_name)
    voice_id = voice.get("voice_id")
    if pack.provider_voice_id and voice_id != pack.provider_voice_id:
        raise RuntimeError("the exact-name voice id differs from the provenance-locked id")

    pending = []
    skipped = []
    for take in pack.takes:
        output = args.output / take.source
        if output.exists() and not args.overwrite:
            skipped.append(take.source)
        else:
            pending.append((take, output))

    prompts = [(take, f"[{take.direction}] {take.transcript}", output) for take, output in pending]
    estimate = {
        "pack": pack.pack_id,
        "voice": pack.display_name,
        "requests": len(prompts),
        "promptCharacters": sum(len(text) for _, text, _ in prompts),
        "skippedExisting": len(skipped),
        "outputFormat": "wav_48000",
        "model": "eleven_v3",
        "execute": args.execute,
    }
    print(json.dumps(estimate, indent=2))
    if not args.execute:
        return

    args.output.mkdir(parents=True, exist_ok=True)
    receipt_takes = []
    for index, (take, text, output) in enumerate(prompts, start=1):
        print(f"[{index}/{len(prompts)}] {take.source}", flush=True)
        request_id = generate_take(key, voice_id, text, output)
        receipt_takes.append({
            "sourceFile": take.source,
            "promptCharacters": len(text),
            "requestId": request_id,
        })

    subscription = request_json(f"{API}/v1/user/subscription", key)
    receipt = {
        "schemaVersion": 1,
        "generatedAt": datetime.now(UTC).isoformat(),
        "packId": pack.pack_id,
        "voiceName": pack.display_name,
        "voiceId": voice_id,
        "model": "eleven_v3",
        "outputFormat": "wav_48000",
        "promptCharacters": estimate["promptCharacters"],
        "requests": len(prompts),
        "accountCharacterCountAfter": subscription.get("character_count"),
        "accountCharacterLimit": subscription.get("character_limit"),
        "takes": receipt_takes,
    }
    receipt_path = args.output / f"{args.pack}.generation-receipt.json"
    receipt_path.write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    print(f"receipt: {receipt_path}")


if __name__ == "__main__":
    main()
