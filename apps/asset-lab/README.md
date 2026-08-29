# VOLTMARCH Asset Lab

Asset Lab is a standalone desktop development app for reviewing every checked-in VOLTMARCH GLB,
its delivery variants and runtime cost. It is WebGPU-first and includes the character animation and
bounded 1–512 unit stress surface. The character surface exposes both faction and unit selectors;
all four factions include rifle, specialist and engineer roles while sharing one canonical rigged
body and animation set per faction. Soviet units additionally include the eight-joint Attack Dog
quadruped with shared Idle, Walk, Run and Bite clips.

```powershell
npm run asset:lab
npm run asset:lab:test
npm run asset:lab:smoke
```

The focused infantry launcher accepts the same choices without opening the complete catalog:

```powershell
node tools/infantry-animation-viewer.mjs --faction=allies --unit=javelin --count=512
```

Available specialist unit keys are `javelin`, `flak-trooper`, `sunlancer` and `slagger`; engineer
keys are `engineer`, `combat-engineer`, `artificer` and `tinker`. Every role-specific weapon and
backpack is a code-native blockout below a hard 200-triangle ceiling. None is duplicated into a
character GLB, and no role adds another skeleton or animation bake. Back-mounted attachments follow
the canonical rig's CPU-baked `Spine02` delta, while held tools follow the existing hand sockets, so
both remain locked to every walk, run and action pose without per-soldier mixers.

The app owns its UI and rendering code under `src/`, but it does not own model files. Models,
terrain inputs, brand images and fonts live once under `packages/assets/` and are consumed through
the `@voltmarch/assets` workspace dependency. A second app must not import this app's private source;
move genuinely shared code into a package first. `npm run lint` reports source-boundary violations
at the import line, while `npm run check:ownership` catches exact file duplication and non-code drift.

The catalog uses a lazy Vite glob: paths are available immediately for grouping and filtering, while
only the selected model URL is resolved and fetched. This keeps cold startup bounded as the library
grows. Its taxonomy uses explicit gameplay roles for ambiguous names: the Attack Dog appears with
Soviet infantry, construction vehicles stay under Vehicles, and only actual naval production
structures enter Naval structures. The desktop launchers in `tools/` own their temporary Vite process and do not borrow another
checkout's server. They also opt into the desktop shell's developer-tool window policy, so Asset Lab
always opens windowed with native minimize, maximize and close controls regardless of the player's
saved fullscreen or always-on-top settings.
