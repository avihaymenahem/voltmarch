/**
 * The in-match campaign communications surface.
 *
 * Dialogue is queued. Several authored triggers emit two or three lines on one
 * tick, and replacing the active line would recreate the exact data-loss bug
 * the old toast sequence counter fixed. The history is event-driven and capped;
 * frame() only advances two numbers and allocates nothing.
 */

import { el } from './Chrome';

export interface CampaignCommsMessage {
  readonly speaker: string;
  readonly role: string;
  readonly portrait: string;
  readonly monogram: string;
  readonly text: string;
}

const HISTORY_MAX = 20;
const QUEUE_MAX = 12;
const MIN_LIFE = 7;
const MAX_LIFE = 15;
const FADE_SEC = 0.35;

export class CampaignComms {
  readonly root: HTMLElement;

  private readonly portrait: HTMLImageElement;
  private readonly monogram: HTMLElement;
  private readonly speaker: Text;
  private readonly role: Text;
  private readonly copy: Text;
  private readonly queueCount: Text;
  private readonly logButton: HTMLButtonElement;
  private readonly historyRoot: HTMLElement;
  private readonly historyList: HTMLElement;

  private readonly queue: CampaignCommsMessage[] = [];
  private readonly history: CampaignCommsMessage[] = [];
  private active: CampaignCommsMessage | null = null;
  private age = 0;
  private life = 0;
  private fading = false;
  private historyOpen = false;

  constructor(parent: HTMLElement) {
    this.root = el('section', 'vm-campaign-comms vm-panel', parent);
    this.root.hidden = true;
    this.root.setAttribute('aria-label', 'Campaign communications');

    const visual = el('div', 'vm-comms-visual', this.root);
    this.portrait = document.createElement('img');
    this.portrait.className = 'vm-comms-portrait';
    this.portrait.alt = '';
    this.portrait.decoding = 'async';
    visual.appendChild(this.portrait);
    this.monogram = el('span', 'vm-comms-monogram', visual);
    el('span', 'vm-comms-scan', visual);

    const body = el('div', 'vm-comms-body', this.root);
    const signal = el('div', 'vm-comms-signal', body);
    signal.appendChild(document.createTextNode('Priority transmission'));
    el('span', 'vm-comms-pulse', signal);

    const head = el('div', 'vm-comms-head', body);
    const identity = el('div', 'vm-comms-identity', head);
    this.speaker = document.createTextNode('');
    const speakerEl = el('strong', 'vm-comms-speaker', identity);
    speakerEl.appendChild(this.speaker);
    this.role = document.createTextNode('');
    const roleEl = el('span', 'vm-comms-role', identity);
    roleEl.appendChild(this.role);

    const actions = el('div', 'vm-comms-actions', head);
    this.logButton = document.createElement('button');
    this.logButton.type = 'button';
    this.logButton.className = 'vm-comms-action';
    this.logButton.textContent = 'LOG';
    this.logButton.setAttribute('aria-expanded', 'false');
    this.logButton.addEventListener('click', () => this.toggleHistory());
    actions.appendChild(this.logButton);

    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'vm-comms-action is-next';
    next.appendChild(document.createTextNode('NEXT '));
    this.queueCount = document.createTextNode('');
    next.appendChild(this.queueCount);
    next.addEventListener('click', () => this.advance());
    actions.appendChild(next);

    const copyEl = el('p', 'vm-comms-copy', body);
    copyEl.setAttribute('aria-live', 'polite');
    this.copy = document.createTextNode('');
    copyEl.appendChild(this.copy);

    this.historyRoot = el('div', 'vm-comms-history', this.root);
    this.historyRoot.hidden = true;
    const historyHead = el('div', 'vm-comms-history-head', this.historyRoot);
    historyHead.appendChild(document.createTextNode('Transmission log'));
    this.historyList = el('div', 'vm-comms-history-list', this.historyRoot);
  }

  push(message: CampaignCommsMessage): void {
    this.history.push(message);
    if (this.history.length > HISTORY_MAX) this.history.shift();
    this.rebuildHistory();

    if (this.active === null) {
      this.present(message);
      return;
    }
    if (this.queue.length >= QUEUE_MAX) this.queue.shift();
    this.queue.push(message);
    this.updateQueueCount();
  }

  frame(dt: number): void {
    if (this.active === null || this.historyOpen) return;
    this.age += dt;
    if (!this.fading && this.age >= this.life) {
      if (this.queue.length > 0) {
        this.present(this.queue.shift() as CampaignCommsMessage);
        return;
      }
      this.fading = true;
      this.age = 0;
      this.root.classList.add('is-exit');
      return;
    }
    if (this.fading && this.age >= FADE_SEC) this.hide();
  }

  clear(): void {
    this.queue.length = 0;
    this.history.length = 0;
    this.historyList.replaceChildren();
    this.historyOpen = false;
    this.historyRoot.hidden = true;
    this.logButton.setAttribute('aria-expanded', 'false');
    this.hide();
  }

  dispose(): void {
    this.clear();
    this.root.remove();
  }

  private present(message: CampaignCommsMessage): void {
    this.active = message;
    this.age = 0;
    this.life = Math.max(MIN_LIFE, Math.min(MAX_LIFE, 4.5 + message.text.length / 18));
    this.fading = false;
    this.root.hidden = false;
    this.root.classList.remove('is-exit', 'is-enter');

    this.speaker.nodeValue = message.speaker;
    this.role.nodeValue = message.role;
    this.copy.nodeValue = message.text;
    this.monogram.textContent = message.monogram;
    this.portrait.hidden = message.portrait === '';
    this.monogram.hidden = message.portrait !== '';
    if (message.portrait !== '') this.portrait.src = message.portrait;
    this.updateQueueCount();

    // Restart the entry beat even when the next queued line reuses a speaker.
    void this.root.offsetWidth;
    this.root.classList.add('is-enter');
  }

  private advance(): void {
    if (this.queue.length > 0) {
      this.present(this.queue.shift() as CampaignCommsMessage);
      return;
    }
    this.hide();
  }

  private hide(): void {
    this.active = null;
    this.age = 0;
    this.life = 0;
    this.fading = false;
    this.root.hidden = true;
    this.root.classList.remove('is-enter', 'is-exit');
    this.updateQueueCount();
  }

  private toggleHistory(): void {
    this.historyOpen = !this.historyOpen;
    this.historyRoot.hidden = !this.historyOpen;
    this.logButton.setAttribute('aria-expanded', this.historyOpen ? 'true' : 'false');
    this.root.classList.toggle('is-log-open', this.historyOpen);
  }

  private updateQueueCount(): void {
    this.queueCount.nodeValue = this.queue.length > 0 ? `(${this.queue.length})` : '';
  }

  private rebuildHistory(): void {
    const fragment = document.createDocumentFragment();
    for (const line of this.history) {
      const row = el('div', 'vm-comms-history-row');
      const who = el('strong', 'vm-comms-history-speaker', row);
      who.textContent = line.speaker;
      const copy = el('span', 'vm-comms-history-copy', row);
      copy.textContent = line.text;
      fragment.appendChild(row);
    }
    this.historyList.replaceChildren(fragment);
    this.historyList.scrollTop = this.historyList.scrollHeight;
  }
}

