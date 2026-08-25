/**
 * ============================================================================
 * src/shell/Replays.ts — opening a recording, and watching one
 * ============================================================================
 * Two things live here:
 *
 *   1. `ReplaysScreen` — the title-screen entry. Watch the match that just
 *      finished, save it to a file, or open a file somebody sent you.
 *   2. `ReplayBar` — the strip along the bottom of a match that IS a recording:
 *      the badge that says so, play/pause, speed, how far through it is, and
 *      the one thing that actually matters, whether the playback still agrees
 *      with the recording.
 *
 * WHY THE SYNC READOUT IS ON SCREEN AND NOT IN THE CONSOLE
 * -------------------------------------------------------
 * A replay is a seed plus a command stream. If the simulation it produces is
 * not the one that was recorded, everything on screen is a plausible lie — the
 * units move, the base builds, and it is a DIFFERENT MATCH. That failure is
 * completely invisible by construction, so the only honest thing to do is put
 * the verdict where the viewer is looking. Every `REPLAY_CHECKSUM_INTERVAL`
 * ticks the playback compares a full sim fingerprint against the recorded one;
 * this bar shows how many of those have passed, and the moment one fails it
 * shows the divergence — the tick and the block, from
 * `Checksum.describeDivergence` — and stops claiming anything else.
 *
 * WHY THE BAR IS ON THE SHELL ROOT AND NOT THE HUD
 * ------------------------------------------------
 * `#hud-root` is `src/ui/**`, which this module does not own. The shell root
 * already carries the autosave toast for the same reason. It is
 * `pointer-events: none` while a match is playing, so the bar re-enables them
 * on itself — a child may take pointer events back from a parent that gave
 * them up, and that is exactly the case this relies on.
 * ============================================================================
 */

import './replay.css';

import { SIM_HZ, GAME_SPEEDS } from '../core/config';
import { Faction } from '../core/types';
import {
  REPLAY_FORMAT_VERSION, buildWarning, parseReplay,
  type ReplayFile, type ReplayHeader,
} from '../game/Replay';
import { playbackReport, type PlaybackReport } from '../game/Playback';
import { buildVersion } from '../game/replay.system';
import { campaignOperationIdentity } from './CampaignPresentation';
import { formatClock } from './PauseMenu';
import { MAPS, mapById, type MapChoice } from './settings-store';
import {
  button,
  el,
  focusable,
  icon,
  pageFrame,
  panel,
  playableFactions,
  setAdjust,
  type Screen,
  type Shell,
} from './Shell';

/* ==========================================================================
 * 1. READING A HEADER
 * ========================================================================== */

/**
 * The battlefield a header describes.
 *
 * MATCHED ON `mapSeed` FIRST because that is the landform roll and
 * `settings-store` fixes one per map — "a map IS a map", in its own words — so
 * it identifies the terrain exactly. Preset and biome are the fallback for a
 * recording made from a hand-typed URL, and `MAPS[0]` is the fallback for a
 * recording of something this build has no lobby entry for.
 *
 * NOTHING DEPENDS ON GETTING THIS RIGHT. The boot is driven from the header's
 * own `mapPreset` / `biome` / `mapSeed`, not from the `MapChoice` —
 * `Shell.applyReplayQuery` writes all four flags over `buildMatchQuery`'s
 * lobby-derived output — this is for the NAME on the card, and a wrong guess
 * costs a wrong label and nothing else.
 *
 * THE PRESET+BIOME FALLBACK IS REACHABLE FOR REAL RECORDINGS NOW, not just for
 * hand-typed URLs. `saltpan-reach`, `foundry-line` and `glacier-shelf` were cut
 * from `MAPS`, and each one shared its preset and biome with the map it was a
 * clone of — so a recording made on one of the three misses on seed and lands
 * on its twin: Airbase Flats, Industrial Grid, Frozen Sector respectively. The
 * card is then labelled with a battlefield the recording was not played on
 * while the terrain underneath is still the recorded landform, because
 * `mapSeed` travels in the header and drives the boot.
 *
 * LEFT AS IT IS, deliberately. The alternative — a "battlefield no longer in
 * the roster" branch — needs a table of retired maps that has to be maintained
 * forever to keep three old files' labels honest, and every other consumer
 * (`replaySummary`, the download filename, the setup label the pause menu
 * shows) degrades to a plausible name rather than an error. The playback
 * itself is bit-exact either way.
 */
export function replayMap(header: ReplayHeader): MapChoice {
  for (const m of MAPS) if (m.mapSeed === header.mapSeed) return m;
  for (const m of MAPS) if (m.preset === header.mapPreset && m.biome === header.biome) return m;
  return mapById('');
}

/** `Aster (Allies) vs Rook (Soviets)`, with a faction-only fallback for old files. */
export function replayMatchup(header: ReplayHeader): string {
  const names = playableFactions();
  const sides: string[] = [];
  for (const p of header.players) {
    if (p.faction === (Faction.Neutral as number)) continue;
    const faction = names.find((f) => (f.id as number) === p.faction)?.name ?? `Faction ${p.faction}`;
    const commander = p.name?.trim();
    sides.push(commander === undefined || commander === '' ? faction : `${commander} (${faction})`);
  }
  return sides.length === 0 ? 'Unknown sides' : sides.join(' vs ');
}

/** The recorded match's length, from the last thing the file says anything about. */
export function replayLengthTicks(file: ReplayFile): number {
  const cmds = file.commands;
  const checks = file.checks;
  const a = cmds.length === 0 ? 0 : cmds[cmds.length - 1]!.tick;
  const b = checks.length === 0 ? 0 : checks[checks.length - 1]!.tick;
  return Math.max(a, b);
}

/** One line of provenance for a card: map, sides, length, command count. */
export function replaySummary(file: ReplayFile): string {
  const length = formatClock(replayLengthTicks(file) / SIM_HZ);
  const n = file.commands.length;
  const operation = file.header.campaign === undefined
    ? null
    : campaignOperationIdentity(file.header.campaign.operation);
  const where = operation === null
    ? replayMap(file.header).name
    : `${operation.chapterTitle} · ${operation.title} · ${replayMap(file.header).name}`;
  return `${where} · ${replayMatchup(file.header)} · ${length} · `
    + `${n} ${n === 1 ? 'command' : 'commands'}`;
}

/* ==========================================================================
 * 2. THE SCREEN
 * ========================================================================== */

export class ReplaysScreen implements Screen {
  readonly id = 'replays';
  private host: HTMLElement | null = null;
  private fileInput: HTMLInputElement | null = null;
  private statusLine: HTMLElement | null = null;

  constructor(private readonly shell: Shell) {}

  mount(host: HTMLElement): void {
    this.host = host;
    host.classList.add('vm-page');

    const frame = pageFrame('Replays', () => this.shell.showMenu());
    const wrap = el('div', 'vm-replays');

    wrap.appendChild(el('p', 'vm-replays-lede',
      'Every match records itself: the seed it was built from and every command '
      + 'either side issued. Watching one re-runs the real simulation from that '
      + 'seed, so a recording is kilobytes rather than a video — and it checks '
      + 'itself against the original once a second while it plays.'));

    /* -- the match that just finished ------------------------------------ */
    const last = this.shell.latestReplay();
    const recent = panel('vm-replay-card');
    recent.appendChild(el('h3', 'vm-h3', 'Last Match'));
    if (last === null) {
      recent.appendChild(el('p', 'vm-replays-note',
        'Nothing yet this session. Finish or leave a battle and it will appear here.'));
    } else {
      recent.appendChild(el('p', 'vm-replays-note', replaySummary(last)));
      const actions = el('div', 'vm-replay-actions');
      actions.appendChild(button('Watch', {
        iconName: 'play',
        variant: 'primary',
        onClick: () => { void this.watch(last, 'the last match'); },
      }));
      actions.appendChild(button('Save To File', {
        iconName: 'folder',
        hint: 'JSON',
        onClick: () => this.download(last),
      }));
      recent.appendChild(actions);
    }
    wrap.appendChild(recent);

    /* -- a file ----------------------------------------------------------- */
    const fromFile = panel('vm-replay-card');
    fromFile.appendChild(el('h3', 'vm-h3', 'Open A Recording'));
    fromFile.appendChild(el('p', 'vm-replays-note',
      `Recordings are JSON. This build reads format ${REPLAY_FORMAT_VERSION}; `
      + 'anything else is refused rather than half-read, because a replay that '
      + 'plays back slightly wrong is worse than one that will not open.'));

    const input = el('input');
    input.type = 'file';
    input.accept = 'application/json,.json,.vmrep';
    input.className = 'vm-sr';
    input.addEventListener('change', () => { void this.onFileChosen(); });
    this.fileInput = input;
    fromFile.appendChild(input);

    const actions = el('div', 'vm-replay-actions');
    actions.appendChild(button('Choose File', {
      iconName: 'folder',
      onClick: () => { this.fileInput?.click(); },
    }));
    fromFile.appendChild(actions);
    wrap.appendChild(fromFile);

    this.statusLine = el('p', 'vm-replays-status', '');
    wrap.appendChild(this.statusLine);

    frame.body.appendChild(wrap);
    frame.foot.appendChild(el('div', 'vm-spacer'));
    frame.foot.appendChild(button('Back', {
      variant: 'primary',
      onClick: () => this.shell.showMenu(),
    }));

    host.appendChild(frame.root);
  }

  unmount(): void {
    this.host?.classList.remove('vm-page');
    this.host = null;
    this.fileInput = null;
    this.statusLine = null;
  }

  onBack(): boolean {
    this.shell.showMenu();
    return true;
  }

  /* -------------------------------------------------------------------- */

  private say(text: string, bad = false): void {
    const node = this.statusLine;
    if (node === null) return;
    node.textContent = text;
    node.classList.toggle('is-bad', bad);
  }

  /**
   * Read the chosen file and hand it to the shell.
   *
   * EVERY REFUSAL REACHES THE PLAYER AS A SENTENCE. `parseReplay` already
   * refuses rather than repairs and already says which field it could not
   * accept; the only thing this has to do is not swallow it. A file picker
   * that appears to do nothing is the failure mode being avoided here.
   */
  private async onFileChosen(): Promise<void> {
    const input = this.fileInput;
    if (input === null) return;
    const file = input.files?.[0];
    // Cleared immediately so re-opening the same file fires `change` again.
    input.value = '';
    if (file === undefined) return;

    this.say(`Reading ${file.name}…`);
    let text: string;
    try {
      text = await file.text();
    } catch (err) {
      this.say(`${file.name} could not be read: ${String(err)}`, true);
      return;
    }

    const parsed = parseReplay(text);
    if (!parsed.ok) {
      this.say(`${file.name} is not a replay this build can play — ${parsed.reason}.`, true);
      return;
    }
    await this.watch(parsed.value, file.name);
  }

  private async watch(file: ReplayFile, label: string): Promise<void> {
    try {
      await this.shell.startReplay(file);
    } catch (err) {
      this.say(`${label} could not be started: ${String(err)}`, true);
    }
  }

  /**
   * Write the recording out as a file.
   *
   * A Blob and an anchor, exactly as `__vmReplay.download()` does it — the same
   * two-line dance, kept here rather than reached for through the debug handle
   * so the screen works whether or not a match is currently running.
   */
  private download(file: ReplayFile): void {
    const h = file.header;
    const operation = h.campaign === undefined
      ? null
      : campaignOperationIdentity(h.campaign.operation);
    const subject = operation?.id.replace(/[^a-z0-9.-]+/gi, '-') ?? replayMap(h).id;
    const name = `voltmarch-${subject}-${(h.simSeed >>> 0).toString(16)}.json`;
    const blob = new Blob([JSON.stringify(file)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    // Revoked next turn: revoking synchronously can race the click on some
    // browsers and download an empty file.
    setTimeout(() => { URL.revokeObjectURL(url); }, 0);
    this.say(`Saved ${name}.`);
  }
}

/* ==========================================================================
 * 3. THE IN-MATCH BAR
 * ========================================================================== */

/** Speed choices offered while watching. Mirrors `core/config.GAME_SPEEDS`. */
const SPEED_LABELS: readonly string[] = GAME_SPEEDS.map((s) => `${s.toFixed(1)}×`);
/** `GAME_SPEEDS` index for 1.0×, where every replay starts. */
const NORMAL_SPEED = 1;

export interface ReplayBarHost {
  /** Toggle the simulation. */
  setReplayPaused(paused: boolean): void;
  /** Index into `GAME_SPEEDS`. */
  setReplaySpeed(index: number): void;
  /** Leave the recording and go back to the title screen. */
  exitReplay(): void;
}

/**
 * The control strip. Built once, updated in place — it repaints text and one
 * transform per poll and never rebuilds a node, because it sits over a live
 * frame budget.
 */
export class ReplayBar {
  readonly root: HTMLElement;

  private readonly playBtn: HTMLButtonElement;
  private readonly speedValue: HTMLElement;
  private readonly clock: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly sync: HTMLElement;
  private readonly note: HTMLElement;

  private paused = false;
  private speedIndex: number = NORMAL_SPEED;
  /** Latched so a divergence report can never be overwritten by a later poll. */
  private diverged = false;

  constructor(private readonly host: ReplayBarHost, file: ReplayFile, warning: string) {
    const root = el('div', 'vm-replay-bar');

    const badge = el('div', 'vm-replay-badge');
    const operation = file.header.campaign === undefined
      ? null
      : campaignOperationIdentity(file.header.campaign.operation);
    badge.appendChild(icon('monitor', 14));
    badge.appendChild(el('span', 'vm-replay-badge-label', operation?.title ?? 'Replay'));
    if (operation !== null) {
      badge.title = `Campaign replay · ${operation.chapterTitle} · ${operation.title}`;
      badge.classList.add(`is-${operation.theme}`);
    }
    root.appendChild(badge);

    this.playBtn = button('Pause', {
      iconName: 'play',
      onClick: () => this.togglePaused(),
    });
    this.playBtn.classList.add('vm-replay-play');
    root.appendChild(this.playBtn);

    /* -- speed: the same ‹ value › cycler the options screen uses ---------- */
    const speed = el('div', 'vm-chooser vm-replay-speed');
    const prev = el('button', 'vm-chooser-step');
    prev.type = 'button';
    prev.setAttribute('aria-label', 'Slower');
    prev.appendChild(icon('chevronLeft', 14));
    const value = el('div', 'vm-chooser-value', SPEED_LABELS[this.speedIndex] ?? '1.0×');
    value.setAttribute('role', 'listbox');
    focusable(value);
    const next = el('button', 'vm-chooser-step');
    next.type = 'button';
    next.setAttribute('aria-label', 'Faster');
    next.appendChild(icon('chevronRight', 14));
    const step = (dir: number): void => { this.stepSpeed(dir); };
    prev.addEventListener('click', () => step(-1));
    next.addEventListener('click', () => step(1));
    value.addEventListener('click', () => step(1));
    setAdjust(value, step);
    speed.appendChild(prev);
    speed.appendChild(value);
    speed.appendChild(next);
    this.speedValue = value;
    root.appendChild(speed);

    /* -- progress --------------------------------------------------------- */
    const track = el('div', 'vm-replay-track');
    this.fill = el('div', 'vm-replay-fill');
    track.appendChild(this.fill);
    root.appendChild(track);

    this.clock = el('span', 'vm-replay-clock vm-num', '0:00');
    root.appendChild(this.clock);

    /* -- the verdict ------------------------------------------------------ */
    this.sync = el('span', 'vm-replay-sync', 'Verifying');
    root.appendChild(this.sync);

    root.appendChild(button('Exit', {
      iconName: 'back',
      onClick: () => this.host.exitReplay(),
    }));

    /*
     * The build advisory, if there is one. It sits UNDER the controls rather
     * than replacing anything, because it is not a failure — see
     * `Replay.buildWarning` for why a version mismatch warns instead of
     * refusing, and why the checksum readout above is the real answer.
     */
    this.note = el('div', 'vm-replay-note');
    if (warning !== '') {
      this.note.textContent = warning;
      this.note.classList.add('is-on');
    }

    const wrap = el('div', 'vm-replay-dock');
    wrap.appendChild(root);
    wrap.appendChild(this.note);
    this.root = wrap;

    // A recording with no checkpoints cannot prove anything about itself, and
    // saying "in sync" over it would be the exact false confidence this bar
    // exists to prevent.
    if (file.checks.length === 0) {
      this.sync.textContent = 'No checkpoints';
      this.sync.classList.add('is-warn');
      this.note.textContent =
        'This recording carries no checkpoints, so nothing here can tell you '
        + 'whether the playback matches the match it came from.';
      this.note.classList.add('is-on');
    }
  }

  setVisible(on: boolean): void {
    this.root.classList.toggle('is-hidden', !on);
  }

  dispose(): void {
    this.root.remove();
  }

  /** Repaint from a fresh report. Called a few times a second, never per frame. */
  update(report: PlaybackReport): void {
    const total = Math.max(1, report.lastTick);
    const frac = Math.max(0, Math.min(1, report.tick / total));
    this.fill.style.transform = `scaleX(${frac.toFixed(4)})`;
    this.clock.textContent =
      `${formatClock(report.tick / SIM_HZ)} / ${formatClock(report.lastTick / SIM_HZ)}`;

    if (report.desync !== '') {
      if (!this.diverged) {
        this.diverged = true;
        this.sync.classList.remove('is-warn');
        this.sync.classList.add('is-bad');
        // ONE WORD ON THE STRIP AND THE WHOLE SENTENCE UNDERNEATH. The strip is
        // a single ellipsised row; `describeDivergence` returns the tick AND the
        // block that differs, which is the only part of this that makes a
        // divergence findable, and it is far too long to survive there. The
        // note below wraps.
        this.sync.textContent = 'Diverged';
        this.note.textContent =
          `${report.desync}. This build did not reproduce the recorded match — `
          + 'what is on screen from here is a different game.';
        this.note.classList.add('is-on', 'is-bad');
      }
      return;
    }
    if (this.diverged) return;

    // SHORT, because the strip is one ellipsised row inside a 58vw cap and a
    // sentence here squeezes the progress bar to nothing. The count IS the
    // claim: N checkpoints compared and none of them differed.
    if (report.complete) {
      this.sync.textContent = `Complete · ${report.verified} checks`;
      this.sync.classList.add('is-done');
      return;
    }
    this.sync.textContent = report.verified === 0
      ? 'Verifying'
      : `In sync · ${report.verified}/${report.checkTotal}`;
  }

  /** Reflect a pause the shell made for its own reasons (a menu, a tab switch). */
  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    this.paintPlay();
  }

  private togglePaused(): void {
    this.paused = !this.paused;
    this.paintPlay();
    this.host.setReplayPaused(this.paused);
  }

  private paintPlay(): void {
    const label = this.playBtn.querySelector('.vm-btn-label');
    if (label !== null) label.textContent = this.paused ? 'Play' : 'Pause';
  }

  private stepSpeed(dir: number): void {
    const n = GAME_SPEEDS.length;
    this.speedIndex = (this.speedIndex + dir + n) % n;
    this.speedValue.textContent = SPEED_LABELS[this.speedIndex] ?? '1.0×';
    this.host.setReplaySpeed(this.speedIndex);
  }
}

/**
 * The advisory line for a file, or ''. Re-exported through the shell so no
 * screen has to know where the build string comes from.
 */
export function replayBuildWarning(file: ReplayFile): string {
  return buildWarning(file.header, buildVersion());
}

/** The live playback state, for the shell's poll. */
export function currentPlayback(): PlaybackReport {
  return playbackReport();
}
