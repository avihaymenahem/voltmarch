#!/usr/bin/env python3
"""Prepare user-supplied soundtrack masters for streamed in-game playback.

The WAV files are the archival masters and never need to ship. This tool makes
delivery Ogg/Vorbis files with three deliberately small, repeatable operations:

1. remove any sub-audible DC offset;
2. overlap the final four seconds with the opening four seconds so `loop=true`
   crosses a continuous boundary rather than a random pair of samples; and
3. level-match the cues to -17 dBFS stereo RMS, with a -1.5 dBFS peak ceiling.

Write in one-second chunks. libsndfile has previously terminated the Windows
interpreter while writing multi-minute Ogg data in one call; chunking produces
the same stream without that failure mode.

Usage:
    py tools/prepare-music.py \
      "C:/path/Silent Horizon.wav" \
      "C:/path/Disciplined Ostinato.wav" \
      "C:/path/Echoes of the Siege.wav"
"""

from __future__ import annotations

import argparse
import hashlib
import math
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import soundfile as sf


TARGET_RMS_DB = -17.0
PEAK_CEILING_DB = -1.5
CROSSFADE_SECONDS = 4.0
EDGE_FADE_SECONDS = 0.02
OUTPUT_DIR = Path("apps/game/public/audio/music")


@dataclass(frozen=True)
class Cue:
    title: str
    slug: str


CUES = (
    Cue("Silent Horizon", "silent-horizon"),
    Cue("Disciplined Ostinato", "disciplined-ostinato"),
    Cue("Echoes of the Siege", "echoes-of-the-siege"),
)


def db(value: float) -> float:
    return 20.0 * math.log10(max(value, 1e-12))


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def prepare(source: Path, cue: Cue, output_dir: Path) -> None:
    audio, sample_rate = sf.read(source, dtype="float32", always_2d=True)
    if audio.shape[1] != 2:
        raise ValueError(f"{source.name}: expected stereo, found {audio.shape[1]} channels")
    if sample_rate != 48_000:
        raise ValueError(f"{source.name}: expected 48 kHz, found {sample_rate} Hz")

    # Work in float64 while summing and crossfading so the delivery encode is
    # the only meaningful quantisation after the PCM16 master.
    audio = audio.astype(np.float64)
    audio -= np.mean(audio, axis=0, keepdims=True)

    overlap = round(CROSSFADE_SECONDS * sample_rate)
    if len(audio) <= overlap * 3:
        raise ValueError(f"{source.name}: too short for a {CROSSFADE_SECONDS:g}s loop overlap")

    # Constant-power fades are right for unrelated streams but can lift a
    # correlated loop join by 3 dB. A complementary linear pair preserves the
    # programme level and makes both edges sample-continuous.
    fade_in = np.linspace(0.0, 1.0, overlap, endpoint=False, dtype=np.float64)[:, None]
    joined = audio[-overlap:] * (1.0 - fade_in) + audio[:overlap] * fade_in
    loop = np.concatenate((joined, audio[overlap:-overlap]), axis=0)

    # A streaming codec has no samples from the previous iteration available
    # while encoding its first MDCT window. A tiny zero-crossing taper protects
    # the browser loop from that codec boundary without making a perceptible
    # musical fade (20 ms against cues that run for minutes).
    edge = round(EDGE_FADE_SECONDS * sample_rate)
    edge_in = np.sin(np.linspace(0.0, math.pi / 2.0, edge, dtype=np.float64))[:, None]
    loop[:edge] *= edge_in
    loop[-edge:] *= edge_in[::-1]

    stereo_rms = float(np.sqrt(np.mean(np.square(loop))))
    gain_db = TARGET_RMS_DB - db(stereo_rms)
    peak = float(np.max(np.abs(loop)))
    gain_db = min(gain_db, PEAK_CEILING_DB - db(peak))
    loop *= 10.0 ** (gain_db / 20.0)

    output_dir.mkdir(parents=True, exist_ok=True)
    output = output_dir / f"{cue.slug}.ogg"
    with sf.SoundFile(
        output,
        mode="w",
        samplerate=sample_rate,
        channels=2,
        format="OGG",
        subtype="VORBIS",
        compression_level=0.72,
    ) as sink:
        block = sample_rate
        for start in range(0, len(loop), block):
            sink.write(loop[start : start + block].astype(np.float32))

    final = sf.info(output)
    print(
        f"{cue.title}: {len(audio) / sample_rate:.3f}s master -> "
        f"{final.duration:.3f}s loop, gain {gain_db:+.2f} dB, "
        f"{output.stat().st_size / 1_048_576:.2f} MiB, sha256 {sha256(source)}"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("masters", nargs=3, type=Path, help="WAV masters in the documented cue order")
    parser.add_argument("--output", type=Path, default=OUTPUT_DIR)
    args = parser.parse_args()

    for source, cue in zip(args.masters, CUES, strict=True):
        if not source.is_file():
            raise FileNotFoundError(source)
        prepare(source, cue, args.output)


if __name__ == "__main__":
    main()
