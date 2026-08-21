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
  readonly theme: 'allies' | 'neutral' | 'pact' | 'reclamation' | 'soviets';
  readonly text: string;
}

/** Fuses above the largest shipped operation, guarded by campaign-text.spec. */
export const CAMPAIGN_COMMS_HISTORY_MAX = 64;
export const CAMPAIGN_COMMS_QUEUE_MAX = 96;
const MIN_LIFE = 7;
const MAX_LIFE = 15;
const FADE_SEC = 0.35;
export const CAMPAIGN_COMMS_PAGE_CHARS = 210;

/** Reading hold for one already-paged live-card transmission. */
export function campaignCommsLife(text: string): number {
  return Math.max(MIN_LIFE, Math.min(MAX_LIFE, 4.5 + text.length / 18));
}

/**
 * Break a transmission at sentence/word boundaries before the three-line live
 * card clips it. History keeps the original unbroken message.
 */
export function campaignCommsPages(
  text: string,
  limit = CAMPAIGN_COMMS_PAGE_CHARS,
): readonly string[] {
  const clean = text.trim().replace(/\s+/g, ' ');
  if (clean === '') return [''];
  const cap = Math.max(24, Math.floor(limit));
  const pages: string[] = [];
  let page = '';
  const flush = (): void => {
    if (page !== '') pages.push(page);
    page = '';
  };
  const add = (part: string): void => {
    const next = page === '' ? part : `${page} ${part}`;
    if (next.length <= cap) { page = next; return; }
    flush();
    if (part.length <= cap) { page = part; return; }
    for (const word of part.split(' ')) {
      const wordNext = page === '' ? word : `${page} ${word}`;
      if (wordNext.length > cap && page !== '') flush();
      page = page === '' ? word : `${page} ${word}`;
    }
  };
  for (const sentence of clean.split(/(?<=[.!?])\s+/)) add(sentence);
  flush();
  return pages;
}

interface CampaignCommsPage extends CampaignCommsMessage {
  readonly pageIndex: number;
  readonly pageTotal: number;
}

/** The channel banner describes how the line arrived, not one generic priority. */
export function campaignCommsChannel(message: Pick<CampaignCommsMessage, 'role' | 'theme'>): string {
  if (message.role === 'Intercepted Signal') return 'Intercepted signal';
  switch (message.theme) {
    case 'allies': return 'Continental channel';
    case 'pact': return 'Conclave channel';
    case 'reclamation': return 'House channel';
    case 'soviets': return 'Directorate channel';
    case 'neutral': return 'Field transmission';
  }
}

/** Wrapped continuation pages belong to the same transmission and stay silent. */
export function campaignCommsSignals(pageIndex: number): boolean {
  return pageIndex === 0;
}

/** The advance control always names the action it will actually perform. */
export function campaignCommsAdvanceLabel(pending: number): string {
  const count = Number.isFinite(pending) ? Math.max(0, Math.floor(pending)) : 0;
  return count > 0 ? `NEXT (${count})` : 'CLOSE';
}

export class CampaignComms {
  readonly root: HTMLElement;

  private readonly portrait: HTMLImageElement;
  private readonly monogram: HTMLElement;
  private readonly signal: Text;
  private readonly speaker: Text;
  private readonly role: Text;
  private readonly copy: Text;
  private readonly pageNumber: Text;
  private readonly logButton: HTMLButtonElement;
  private readonly nextButton: HTMLButtonElement;
  private readonly historyRoot: HTMLElement;
  private readonly historyList: HTMLElement;

  private readonly queue: CampaignCommsPage[] = [];
  private readonly history: CampaignCommsMessage[] = [];
  private active: CampaignCommsPage | null = null;
  private age = 0;
  private life = 0;
  private fading = false;
  private historyOpen = false;

  constructor(parent: HTMLElement, private readonly onSignal: (() => void) | null = null) {
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
    this.signal = document.createTextNode('Field transmission');
    signal.appendChild(this.signal);
    const pageNumber = el('span', 'vm-comms-page', signal);
    this.pageNumber = document.createTextNode('');
    pageNumber.appendChild(this.pageNumber);
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

    this.nextButton = document.createElement('button');
    this.nextButton.type = 'button';
    this.nextButton.className = 'vm-comms-action is-next';
    this.nextButton.addEventListener('click', () => this.advance());
    actions.appendChild(this.nextButton);
    this.updateQueueCount();

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
    if (this.history.length > CAMPAIGN_COMMS_HISTORY_MAX) this.history.shift();
    this.rebuildHistory();

    const chunks = campaignCommsPages(message.text);
    const pages = chunks.map((text, pageIndex): CampaignCommsPage => ({
      ...message,
      text,
      pageIndex,
      pageTotal: chunks.length,
    }));
    if (this.active === null) {
      this.present(pages.shift() as CampaignCommsPage);
      for (const page of pages) this.enqueue(page);
      // `present()` ran before the continuation pages existed. Refresh after
      // enqueueing or a two-page first message misleadingly opens with CLOSE.
      this.updateQueueCount();
      return;
    }
    for (const page of pages) this.enqueue(page);
    this.updateQueueCount();
  }

  private enqueue(page: CampaignCommsPage): void {
    if (this.queue.length >= CAMPAIGN_COMMS_QUEUE_MAX) this.queue.shift();
    this.queue.push(page);
  }

  frame(dt: number): void {
    if (this.active === null || this.historyOpen) return;
    this.age += dt;
    if (!this.fading && this.age >= this.life) {
      if (this.queue.length > 0) {
        this.present(this.queue.shift() as CampaignCommsPage);
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

  private present(message: CampaignCommsPage): void {
    this.active = message;
    this.age = 0;
    this.life = campaignCommsLife(message.text);
    this.fading = false;
    this.root.hidden = false;
    this.root.classList.remove(
      'is-exit', 'is-enter', 'is-allies', 'is-neutral', 'is-pact', 'is-reclamation', 'is-soviets',
    );
    this.root.classList.add(`is-${message.theme}`);

    this.speaker.nodeValue = message.speaker;
    this.role.nodeValue = message.role;
    this.signal.nodeValue = campaignCommsChannel(message);
    this.pageNumber.nodeValue = message.pageTotal > 1
      ? `${message.pageIndex + 1} / ${message.pageTotal}`
      : '';
    this.copy.nodeValue = message.text;
    this.monogram.textContent = message.monogram;
    this.portrait.hidden = message.portrait === '';
    this.monogram.hidden = message.portrait !== '';
    if (message.portrait !== '') this.portrait.src = message.portrait;
    this.updateQueueCount();
    if (campaignCommsSignals(message.pageIndex)) this.onSignal?.();

    // Restart the entry beat even when the next queued line reuses a speaker.
    void this.root.offsetWidth;
    this.root.classList.add('is-enter');
  }

  private advance(): void {
    if (this.queue.length > 0) {
      this.present(this.queue.shift() as CampaignCommsPage);
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
    const pending = this.queue.length;
    this.nextButton.textContent = campaignCommsAdvanceLabel(pending);
    this.nextButton.setAttribute(
      'aria-label',
      pending > 0 ? `Next transmission, ${pending} remaining` : 'Close transmission',
    );
  }

  private rebuildHistory(): void {
    const fragment = document.createDocumentFragment();
    for (const line of this.history) {
      const row = el('div', 'vm-comms-history-row');
      row.classList.add(`is-${line.theme}`);
      const identity = el('span', 'vm-comms-history-identity', row);
      const who = el('strong', 'vm-comms-history-speaker', identity);
      who.textContent = line.speaker;
      const role = el('span', 'vm-comms-history-role', identity);
      role.textContent = line.role;
      const copy = el('span', 'vm-comms-history-copy', row);
      copy.textContent = line.text;
      fragment.appendChild(row);
    }
    this.historyList.replaceChildren(fragment);
    this.historyList.scrollTop = this.historyList.scrollHeight;
  }
}
