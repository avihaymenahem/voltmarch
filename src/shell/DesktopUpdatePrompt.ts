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
  private readonly card: HTMLElement;
  private readonly eyebrow: HTMLSpanElement;
  private readonly title: HTMLHeadingElement;
  private readonly copy: HTMLParagraphElement;
  private readonly progress: HTMLDivElement;
  private readonly progressFill: HTMLSpanElement;
  private readonly primaryAction: HTMLButtonElement;
  private readonly laterAction: HTMLButtonElement;
  private state: DesktopUpdateState | null = null;
  private shellState = 'boot';
  private dismissedVersion: string | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'vm-update-dock';
    this.root.setAttribute('aria-live', 'polite');
    this.root.hidden = true;

    this.card = document.createElement('section');
    this.card.className = 'vm-update-card';
    this.card.setAttribute('role', 'dialog');
    this.card.setAttribute('aria-label', 'VOLTMARCH update');

    this.eyebrow = document.createElement('span');
    this.eyebrow.className = 'vm-update-eyebrow';
    this.card.appendChild(this.eyebrow);

    this.title = document.createElement('h2');
    this.title.className = 'vm-update-title';
    this.card.appendChild(this.title);

    this.copy = document.createElement('p');
    this.copy.className = 'vm-update-copy';
    this.card.appendChild(this.copy);

    this.progress = document.createElement('div');
    this.progress.className = 'vm-update-progress';
    this.progress.setAttribute('role', 'progressbar');
    this.progress.setAttribute('aria-valuemin', '0');
    this.progress.setAttribute('aria-valuemax', '100');
    this.progress.setAttribute('aria-hidden', 'true');
    this.progressFill = document.createElement('span');
    this.progress.appendChild(this.progressFill);
    this.card.appendChild(this.progress);

    const actions = document.createElement('div');
    actions.className = 'vm-update-actions';
    this.primaryAction = this.action('', true, () => this.runPrimaryAction());
    this.laterAction = this.action('Later', false, () => this.dismiss());
    actions.append(this.primaryAction, this.laterAction);
    this.card.appendChild(actions);
    this.root.appendChild(this.card);
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
    const visible = this.shellState === 'menu'
      && state !== null
      && ['available', 'downloading', 'downloaded'].includes(state.status)
      && !(state.status === 'available' && this.dismissedVersion === state.availableVersion);
    this.root.hidden = !visible;
    if (!visible || state === null) return;

    const downloading = state.status === 'downloading';
    this.card.className = `vm-update-card is-${state.status}`;
    this.eyebrow.textContent = state.status === 'downloaded' ? 'UPDATE READY' : 'COMMAND SOFTWARE';
    this.title.textContent = state.status === 'downloaded'
      ? `VOLTMARCH ${state.availableVersion ?? ''} downloaded`
      : `VOLTMARCH ${state.availableVersion ?? ''} available`;
    this.copy.textContent = downloading
      ? state.message
      : state.releaseNotes || state.message;
    const percent = Math.max(0, Math.min(100, state.progress ?? 0));
    this.progress.classList.toggle('is-active', downloading);
    this.progress.setAttribute('aria-hidden', String(!downloading));
    this.progress.setAttribute('aria-valuenow', String(Math.round(percent)));
    this.progressFill.style.width = `${percent}%`;

    this.primaryAction.hidden = downloading;
    this.laterAction.hidden = downloading;
    if (state.status === 'available') {
      this.primaryAction.textContent = state.canAutoInstall ? 'Download update' : 'Open download page';
    } else if (state.status === 'downloaded') {
      this.primaryAction.textContent = 'Restart & update';
    }
  }

  private runPrimaryAction(): void {
    const state = this.state;
    const bridge = desktopBridge();
    if (state === null || bridge === null) return;
    if (state.status === 'downloaded') {
      bridge.installUpdate();
    } else if (state.status === 'available') {
      if (state.canAutoInstall) void bridge.downloadUpdate();
      else void bridge.openUpdatePage();
    }
  }

  private dismiss(): void {
    this.dismissedVersion = this.state?.availableVersion ?? null;
    this.render();
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
