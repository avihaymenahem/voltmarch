import './desktop-update.css';

import {
  desktopBridge,
  type DesktopUpdateState,
} from '../platform/desktop';

/**
 * A release prompt that deliberately waits for the title screen.
 *
 * Update discovery can complete during a battle, but a software modal has no
 * right to cover tactical controls. The latest state stays in the main process
 * and this card appears the next time the player reaches the menu.
 */
export class DesktopUpdatePrompt {
  private readonly root: HTMLDivElement;
  private state: DesktopUpdateState | null = null;
  private shellState = 'boot';
  private dismissedVersion: string | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'vm-update-dock';
    this.root.setAttribute('aria-live', 'polite');
    parent.appendChild(this.root);

    const bridge = desktopBridge();
    if (bridge === null) return;
    this.unsubscribe = bridge.onUpdateState((state) => {
      this.state = state;
      this.render();
    });
    void bridge.updateState().then((state) => {
      this.state = state;
      this.render();
    }).catch(() => { /* Settings exposes a retry; automatic failures do not nag. */ });
  }

  onShellState(state: string): void {
    this.shellState = state;
    this.render();
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.root.remove();
  }

  private render(): void {
    const state = this.state;
    this.root.replaceChildren();
    if (this.shellState !== 'menu' || state === null) return;
    if (!['available', 'downloading', 'downloaded'].includes(state.status)) return;
    if (state.status === 'available' && this.dismissedVersion === state.availableVersion) return;

    const card = document.createElement('section');
    card.className = `vm-update-card is-${state.status}`;
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', 'VOLTMARCH update');

    const eyebrow = document.createElement('span');
    eyebrow.className = 'vm-update-eyebrow';
    eyebrow.textContent = state.status === 'downloaded' ? 'UPDATE READY' : 'COMMAND SOFTWARE';
    card.appendChild(eyebrow);

    const title = document.createElement('h2');
    title.className = 'vm-update-title';
    title.textContent = state.status === 'downloaded'
      ? `VOLTMARCH ${state.availableVersion ?? ''} downloaded`
      : `VOLTMARCH ${state.availableVersion ?? ''} available`;
    card.appendChild(title);

    const copy = document.createElement('p');
    copy.className = 'vm-update-copy';
    copy.textContent = state.status === 'downloading'
      ? state.message
      : state.releaseNotes || state.message;
    card.appendChild(copy);

    if (state.status === 'downloading') {
      const track = document.createElement('div');
      track.className = 'vm-update-progress';
      track.setAttribute('role', 'progressbar');
      track.setAttribute('aria-valuemin', '0');
      track.setAttribute('aria-valuemax', '100');
      track.setAttribute('aria-valuenow', String(Math.round(state.progress ?? 0)));
      const fill = document.createElement('span');
      fill.style.width = `${Math.max(0, Math.min(100, state.progress ?? 0))}%`;
      track.appendChild(fill);
      card.appendChild(track);
    }

    const actions = document.createElement('div');
    actions.className = 'vm-update-actions';
    if (state.status === 'available') {
      actions.appendChild(this.action(
        state.canAutoInstall ? 'Download update' : 'Open download page',
        true,
        () => {
          const bridge = desktopBridge();
          if (bridge === null) return;
          if (state.canAutoInstall) void bridge.downloadUpdate();
          else void bridge.openUpdatePage();
        },
      ));
    } else if (state.status === 'downloaded') {
      actions.appendChild(this.action('Restart & update', true, () => desktopBridge()?.installUpdate()));
    }
    if (state.status !== 'downloading') {
      actions.appendChild(this.action('Later', false, () => {
        this.dismissedVersion = state.availableVersion;
        this.render();
      }));
    }
    card.appendChild(actions);
    this.root.appendChild(card);
  }

  private action(label: string, primary: boolean, run: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `vm-update-action${primary ? ' is-primary' : ''}`;
    button.textContent = label;
    button.addEventListener('click', run);
    return button;
  }
}
