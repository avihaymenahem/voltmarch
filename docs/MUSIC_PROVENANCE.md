# VOLTMARCH original soundtrack provenance

Last updated: 26 August 2026

The four soundtrack masters were supplied by the VOLTMARCH project owner and generated under the
owner's paid Suno Pro account. The owner asserts that the commercial-use rights belong to the
project. They are original VOLTMARCH material governed by the root proprietary `LICENSE`, not
third-party CC-BY tracks. This record documents the exact inputs used to make the shipped files;
it is provenance, not a general legal opinion about AI-generated works in every jurisdiction.

| Cue | WAV master | Master SHA-256 | Master format | Shipped loop | Delivery size |
| --- | --- | --- | --- | --- | --- |
| Silent Horizon | `Silent Horizon.wav` | `a2712d0bd5ab72b33278d730f45bb9e3914a95303bc769a6e3269359c5ec32d6` | 48 kHz stereo PCM16 · 99.960 s | 95.960 s | 1.10 MiB |
| Disciplined Ostinato | `Disciplined Ostinato.wav` | `0d84bf46d5c95a831f63c8a7360b6215b8c3b7a2200edd0207af8e003e962b1a` | 48 kHz stereo PCM16 · 146.040 s | 142.040 s | 1.48 MiB |
| Echoes of the Siege | `Echoes of the Siege.wav` | `7726fa0db6bbb05db1f3e5b2b73f15934cc218d270988a4d95c4d245be7a82b6` | 48 kHz stereo PCM16 · 234.520 s | 230.520 s | 2.61 MiB |
| Endless Warfront | `Endless Warfront.wav` | `de457d06382afcd1be3cd05122f5af281a1c7ad07c47debcb5350a32fa9624ec` | 48 kHz stereo PCM16 · 152.880 s | 148.880 s | 1.72 MiB |

The archival WAV masters do not ship and are intentionally not committed. Delivery derivatives
are generated with:

```powershell
py tools/prepare-music.py `
  "C:/path/Silent Horizon.wav" `
  "C:/path/Disciplined Ostinato.wav" `
  "C:/path/Echoes of the Siege.wav" `
  "C:/path/Endless Warfront.wav"
```

The pipeline removes DC offset, creates a four-second complementary boundary overlap plus a 20 ms
codec-safe edge taper, level-matches the four cues to -17 dBFS stereo RMS (subject to a -1.5 dBFS
peak ceiling), and writes streamed Ogg/Vorbis delivery files. The source masters are never modified.
