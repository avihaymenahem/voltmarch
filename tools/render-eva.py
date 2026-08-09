"""
Render every EVA announcer line with Piper, straight to Ogg Vorbis.

Reads the line keys and texts out of src/audio/Eva.ts rather than duplicating
them here, so the audio can never drift from the table the game dispatches
against. A key present in one and missing from the other is the whole defect
class this project keeps tripping over, and re-typing 32 strings is how it
starts.

No ffmpeg on this machine and none needed: soundfile (libsndfile, BSD-3) writes
Vorbis directly.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path("C:/Users/Administrator/projects/voltmarch")
SCRATCH = Path(sys.argv[1])
VOICES = SCRATCH / "tts-voices"
OUT = ROOT / "public" / "audio" / "eva"
VOICE = "en_GB-cori-high"

# Piper voices are trained on flowing audiobook prose, so a two-word imperative
# lands with a trailing narrative lilt at default pacing. Tightening the length
# scale reads as an announcement rather than a sentence from a novel.
LENGTH_SCALE = "0.92"

src = (ROOT / "src" / "audio" / "Eva.ts").read_text(encoding="utf-8")
block = src[src.index("export const EVA_LINES"):]
block = block[: block.index("\n};")]

# `key: {` followed, within the same object, by `text: '...'` or "..."
#
# BOTH quote styles, because one line is double-quoted for containing an
# apostrophe ("Warning: our ally's base is under attack."). Matching only
# single quotes silently skipped it, and 30 rendered lines against 31
# dispatchable ones is a line that falls back to the formant synth in the
# middle of a game. tests/audio-samples.spec.ts caught it; this parser should
# not have needed catching.
lines = {}
for m in re.finditer(r"^  (\w+):\s*\{(.*?)^  \},", block + "\n  },", re.S | re.M):
    key, body = m.group(1), m.group(2)
    t = re.search(r"""text:\s*(['"])((?:(?!\1)[^\\]|\\.)*)\1""", body)
    if t:
        lines[key] = t.group(2).replace("\\'", "'").replace('\\"', '"')

if not lines:
    sys.exit("parsed no EVA lines - the table shape changed")

# The count is load-bearing: this file exists to keep the audio and the
# dispatch table in lockstep, so a parse that quietly finds fewer entries than
# the table has is the one failure it must not ship.
declared = len(re.findall(r"^  \w+:\s*\{", block, re.M))
if len(lines) != declared:
    sys.exit(f"parsed {len(lines)} lines but the table declares {declared} - "
             f"missing: {set(re.findall(r'^  (\\w+):\\s*\\{', block, re.M)) - set(lines)}")

OUT.mkdir(parents=True, exist_ok=True)
for old in OUT.glob("*.ogg"):
    old.unlink()

import soundfile as sf  # noqa: E402

manifest = {}
total = 0
for key, text in sorted(lines.items()):
    wav = SCRATCH / f"_eva_{key}.wav"
    subprocess.run(
        [sys.executable, "-m", "piper", "-m", VOICE, "--data-dir", str(VOICES),
         "--length-scale", LENGTH_SCALE, "-f", str(wav)],
        input=text, text=True, check=True, capture_output=True,
    )
    data, rate = sf.read(wav)
    dest = OUT / f"{key}.ogg"
    sf.write(dest, data, rate, format="OGG", subtype="VORBIS")
    wav.unlink()
    dur = len(data) / rate
    manifest[key] = round(dur, 3)
    total += dest.stat().st_size
    print(f"  {key:26} {dur:5.2f}s  {dest.stat().st_size / 1024:6.1f} kB  \"{text}\"")

print(f"\n{len(manifest)} lines, {total / 1024:.0f} kB total, "
      f"longest {max(manifest.values()):.2f}s")
print(json.dumps(manifest, indent=0))
