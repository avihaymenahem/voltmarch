# Settings and Accessibility

Settings is available from the title screen and from the pause menu. Changes are applied as you
make them and persisted for the next session. The screen is split into eight tabs so ordinary
player controls, support information and developer diagnostics do not compete for the same panel.

---

## Graphics

**Presets** choose Auto, Low, Medium, High or Ultra and establish a coherent starting point.
Resolution Scale can then be adjusted from 50–200%. Target FPS is a calibration target, not a hard
frame limiter: **Hardware Calibration** measures a real battle for a few seconds and chooses a
resolution that can hold the selected target on the current GPU.

**Adaptive Resolution** is off by default. When enabled it can trade sharpness for frame rate during
the match, down to 55% of native resolution. With it off, the scale stays where you put it.

The tab also controls:

- shadows and cascade detail;
- ambient occlusion;
- the post-processing master switch, bloom, SMAA, 4× MSAA and vignette;
- automatic, forced-on or forced-off panel blur;
- field of view, closest zoom and furthest zoom;
- desktop display selection when more than one monitor is available.

MSAA is valuable for thin pipes, rails and panel lines, but it is one of the expensive choices on an
integrated GPU. The Performance Overlay and Diagnostics report are better judges than the preset
name.

---

## Audio

The mixer has independent Master, Music, Effects, Voice, Interface and Ambience levels plus a global
mute. **Strategic Announcer** controls EVA without muting unit responses. **Unit Responses** offers
Full, Selection Only and Off; Selection Only keeps selection acknowledgement while silencing order
chatter.

The original score contains **Silent Horizon**, **Disciplined Ostinato**, **Echoes of the Siege**
and **Endless Warfront**. The title screen begins from a locally chosen cue and rotates through all
four tracks without letting its decorative battle sounds lower the music. A match chooses a cue
locally and loops it; the compact music control on the title and pause screens can pause or change
it. Music streams instead of decoding an entire track into memory.

Voice Subtitles live on Gameplay because they are a presentation choice. They caption both EVA and
unit responses without consuming alert toasts.

---

## Gameplay

**Training** reports the Field School state. Completed training disappears from the title screen;
**Restore Tutorial** makes the menu item available again without resetting missions, medals or
career statistics.

**Accessibility** includes:

- Text Size from 90–150%, with a 115% default;
- High Contrast, which strengthens secondary text and panel edges without replacing faction colour;
- Reduce Interface Motion, which suppresses non-essential menu and HUD animation while leaving the
  battlefield and camera functional.

In a match, the Objectives and Construction panels have height-only resize grips and remember the
chosen sizes. The optional Performance panel can be dragged anywhere on-screen; its position is
saved and clamped back into view after a resolution or window-size change.

The top-centre command node identifies the current mode, difficulty and map. Objectives remain in
their own panel, where the Main, Side or Global tier and progress occupy a metadata line above the
objective title so long names can wrap without colliding with either badge.

The Interface section controls tooltips, floating damage numbers, voice subtitles, battlefield tips
and screen shake. Pointer, camera and keyboard navigation belong on Controls instead.

The Profile section exports, imports or resets progression. Installed desktop builds use the app-data
folder; browser data is not imported automatically. Export before resetting if the record matters.

---

## Controls

Controls contains pointer and camera behaviour followed by every keyboard action. Select a command
and press a key or chord; Backspace clears it and Escape cancels capture. Fixed actions are shown as
flat chips rather than pretend rebind buttons. The full gesture and order reference is in
[Controls](/avihaymenahem/voltmarch/wiki/Controls).

---

## Updates

Updates reports the running version, edition and release status and links to the latest release and
the complete GitHub archive.

- A browser build is updated by reloading the deployed game.
- An installed desktop build checks shortly after launch and every four hours. It can download in
  the background, then asks before restarting into the new version; an update never interrupts a
  battle.
- A portable desktop build opens the matching manual download because it has no installer-managed
  installation to replace safely.
- Development builds do not run automatic release checks.

---

## Diagnostics

Diagnostics is a live support surface: renderer, adapter, quality, timing and match state are
assembled into a report that can be copied or saved. The Performance Overlay toggle exposes the
same frame data in battle.

**Unlock Everything** is also here because it is a development/testing override, not progression.
It persists until switched off, opens skirmish content and campaign operations, and does not invent
earned mission counters or honours for the Service Record.

---

## Manual and Credits

Manual renders these wiki pages inside the game and loads them only when opened, keeping hundreds of
kilobytes of prose out of the startup bundle. Credits records project, audio, font and third-party
licences. It is the authoritative player-facing attribution surface, not decorative end copy.

**See also:** [Service Record](/avihaymenahem/voltmarch/wiki/Service-Record) ·
[Controls](/avihaymenahem/voltmarch/wiki/Controls) ·
[How to Play](/avihaymenahem/voltmarch/wiki/How-to-Play)
