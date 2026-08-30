/**
 * A compact decision modal opened from the title screen.
 *
 * It is a real Shell screen rather than a DOM layer inside MainMenu: only its
 * actions enter the shared focus ring, Escape/gamepad B has one owner, and the
 * title screen is rebuilt cleanly when the player cancels.
 */

import {
  button,
  el,
  panel,
  type ButtonOptions,
  type Screen,
} from './Shell';

export interface MenuDecisionAction {
  readonly label: string;
  readonly iconName: string;
  readonly hint?: string;
  readonly variant?: ButtonOptions['variant'];
  readonly run: () => void;
}

export interface MenuDecisionOptions {
  readonly eyebrow: string;
  readonly title: string;
  readonly body: string;
  readonly actions: readonly MenuDecisionAction[];
  readonly cancel: () => void;
}

export class MenuDecisionScreen implements Screen {
  readonly id = 'menu-decision';
  private host: HTMLElement | null = null;

  constructor(private readonly options: MenuDecisionOptions) {}

  mount(host: HTMLElement): void {
    this.host = host;
    host.classList.add('vm-menu-decision', 'is-modal');

    const card = panel('vm-menu-decision-panel');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-labelledby', 'vm-menu-decision-title');
    card.setAttribute('aria-describedby', 'vm-menu-decision-body');

    const head = el('header', 'vm-menu-decision-head');
    head.appendChild(el('span', 'vm-menu-decision-eyebrow', this.options.eyebrow));
    const title = el('h2', 'vm-menu-decision-title', this.options.title);
    title.id = 'vm-menu-decision-title';
    head.appendChild(title);
    card.appendChild(head);

    const body = el('p', 'vm-menu-decision-body', this.options.body);
    body.id = 'vm-menu-decision-body';
    card.appendChild(body);

    const actions = el('nav', 'vm-menu-decision-actions');
    actions.setAttribute('aria-label', `${this.options.title} actions`);
    for (const action of this.options.actions) {
      actions.appendChild(button(action.label, {
        iconName: action.iconName,
        hint: action.hint,
        variant: action.variant,
        onClick: action.run,
      }));
    }
    card.appendChild(actions);
    host.appendChild(card);
  }

  unmount(): void {
    this.host?.classList.remove('vm-menu-decision', 'is-modal');
    this.host = null;
  }

  onBack(): boolean {
    this.options.cancel();
    return true;
  }
}
