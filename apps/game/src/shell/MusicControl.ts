import { audio, type MusicTrackSnapshot } from '../audio/AudioEngine';
import { MUSIC_TRACK_EVENT } from '../audio/TrackMusic';
import { el, focusable, icon } from './Shell';

/** Compact, shared soundtrack control for the title and pause surfaces. */
export class MusicControl {
  readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly position: HTMLElement;
  private listening = false;

  private readonly onTrack = (event: Event): void => {
    const detail = event instanceof CustomEvent
      ? event.detail as MusicTrackSnapshot | null
      : null;
    this.render(detail);
  };

  constructor(context: 'menu' | 'pause') {
    const root = el('section', `vm-music-control is-${context}`);
    root.setAttribute('aria-label', 'Soundtrack controls');

    const mark = el('span', 'vm-music-mark');
    mark.appendChild(icon('volume', 16));
    root.appendChild(mark);

    const copy = el('div', 'vm-music-copy');
    copy.appendChild(el('span', 'vm-music-label', 'Original soundtrack'));
    this.title = el('strong', 'vm-music-title', 'Soundtrack loading');
    copy.appendChild(this.title);
    root.appendChild(copy);

    this.position = el('span', 'vm-music-position vm-num', '— / 03');
    root.appendChild(this.position);

    const controls = el('div', 'vm-music-buttons');
    controls.appendChild(this.step('Previous soundtrack cue', 'chevronLeft', () => {
      audio()?.previousMusicTrack();
    }));
    controls.appendChild(this.step('Next soundtrack cue', 'chevronRight', () => {
      audio()?.nextMusicTrack();
    }));
    root.appendChild(controls);

    this.root = root;
    this.render(audio()?.musicTrack ?? null);
    if (typeof globalThis.addEventListener === 'function') {
      globalThis.addEventListener(MUSIC_TRACK_EVENT, this.onTrack);
      this.listening = true;
    }
  }

  dispose(): void {
    if (!this.listening || typeof globalThis.removeEventListener !== 'function') return;
    globalThis.removeEventListener(MUSIC_TRACK_EVENT, this.onTrack);
    this.listening = false;
  }

  private step(label: string, iconName: string, onClick: () => void): HTMLButtonElement {
    const button = focusable(el('button', 'vm-music-step'));
    button.type = 'button';
    button.setAttribute('aria-label', label);
    button.title = label;
    button.appendChild(icon(iconName, 15));
    button.addEventListener('click', onClick);
    return button;
  }

  private render(track: MusicTrackSnapshot | null): void {
    if (track === null) {
      this.title.textContent = 'Soundtrack loading';
      this.position.textContent = '— / 03';
      return;
    }
    this.title.textContent = track.title;
    this.position.textContent = `${String(track.index + 1).padStart(2, '0')} / ${String(track.total).padStart(2, '0')}`;
  }
}
