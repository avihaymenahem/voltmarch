/**
 * ============================================================================
 * src/shell/MultiplayerSetup.ts — the pre-match lobby for two humans
 * ============================================================================
 * Two columns, reusing `.vm-setup` exactly as `SkirmishSetup` does so this
 * reads as the same product: what you bring on the left, who is playing on the
 * right.
 *
 * ── PUBLIC ROOMS AND INVITE CODES ARE DIFFERENT THINGS ─────────────────────
 *
 * The single decision this whole screen is built around. A PUBLIC room is
 * listed in the browser and joined with a click; a PRIVATE room is invisible
 * and joined only with the six-character code its host was given. Conflating
 * them breaks both: if everything were listed the code would be decorative and
 * a friend's game would be joinable by strangers, and if nothing were listed
 * there would be no browser.
 *
 * The relay enforces it — a private room is never in a listing, and its public
 * id is refused by the `joinRoom` path even if somebody learns it.
 *
 * ── THE LIST IS PUSHED, NOT POLLED ─────────────────────────────────────────
 *
 * `watchRooms(true)` subscribes and the relay pushes a new list when one
 * actually changes. A refresh button that re-asked every few seconds would have
 * every idle player in the product waking the server on a timer to be told
 * nothing had happened. Filtering is done HERE, on a list that is already in
 * hand, so changing a filter costs nothing and touches no socket.
 *
 * ── WHAT THIS SCREEN DELIBERATELY DOES NOT OFFER ───────────────────────────
 *
 * NO PLAYER NAMES, and no room titles. Every string in the browser is derived
 * from a map id or a faction index — never from anything a stranger typed. That
 * is a security decision: a name is a string one player controls and another
 * player's browser renders, and the cheapest way to be sure it can never become
 * markup is for it not to exist. When names arrive they need the full
 * treatment, with the markup gate in `tests/foundation.spec.ts` behind them.
 *
 * NO DIFFICULTY, NO PERSONALITY, NO STARTING BANK — there is no AI in a PvP
 * match. NO SEED FIELD — the relay picks it, or one player would know the map
 * before the other.
 *
 * ── WHY MIRRORS ARE LEGAL HERE AND NOT IN SKIRMISH ─────────────────────────
 *
 * `SkirmishSetup` refuses to let the opponent mirror your side because the
 * scenario builder used to resolve its two scripted bases by FACTION. It
 * resolves by SLOT now (`ScenarioBuilder.armySlot`), so two players on the same
 * side is fine and each simply picks their own.
 * ============================================================================
 */

import {
  button, el, focusable, pageFrame, playableFactions, row,
  type FactionOption, type Screen, type Shell,
} from './Shell';
import { MAPS, mapById } from './settings-store';
import { CODE_LENGTH_HINT, relayUrl } from './net-link';
import { Session, type LobbyPhase, type MatchStart } from '../net/Session';
import type { RoomSummary, RoomVisibility } from '../net/protocol';

/** Where the status line's text comes from, per phase. */
const PHASE_TEXT: Record<LobbyPhase, string> = {
  idle: 'Not connected.',
  connecting: 'Connecting to the match server…',
  ready: 'Connected.',
  hosting: 'Waiting for an opponent to join.',
  queued: 'Looking for an opponent…',
  playing: 'Match starting…',
  ended: 'Disconnected.',
};

/** Sentinel for "no filter". Not a valid map id or faction index. */
const ANY = '*';

export class MultiplayerSetup implements Screen {
  readonly id = 'multiplayer';

  private readonly factions: FactionOption[] = playableFactions();
  private faction: FactionOption;
  private map: string;
  private visibility: RoomVisibility = 'public';

  private session: Session | null = null;
  private phase: LobbyPhase = 'idle';

  /* -- the browser -------------------------------------------------------- */
  private rooms: RoomSummary[] = [];
  private roomTotal = 0;
  private filterMap: string = ANY;
  private filterFaction: string = ANY;

  /* -- live nodes, so an update is a write and not a rebuild -------------- */
  private status: HTMLElement | null = null;
  private codeOut: HTMLElement | null = null;
  private codeIn: HTMLInputElement | null = null;
  private hostBtn: HTMLButtonElement | null = null;
  private joinBtn: HTMLButtonElement | null = null;
  private queueBtn: HTMLButtonElement | null = null;
  private cancelBtn: HTMLButtonElement | null = null;
  private visButtons: HTMLButtonElement[] = [];
  private roomList: HTMLElement | null = null;
  private roomCount: HTMLElement | null = null;

  constructor(private readonly shell: Shell) {
    const setup = this.shell.getSetup();
    this.faction = this.factions.find((f) => f.key === setup.playerFaction) ?? this.factions[0];
    this.map = setup.map;
  }

  /* ====================================================================== */

  mount(host: HTMLElement): void {
    // `.vm-screen` is a bare flex container with no alignment of its own —
    // `.vm-page` supplies `align-items: center; justify-content: center` and the
    // outer padding. Without it the panel pins to the top-left corner and
    // stretches, which is exactly how this screen first shipped.
    host.classList.add('vm-page');

    const frame = pageFrame('Multiplayer', () => { this.back(); });

    // The same two-column grid `SkirmishSetup` uses, so the two lobbies read as
    // one product — and it already collapses to a single column under 900px.
    const grid = el('div', 'vm-setup');
    const left = el('div', 'vm-setup-col');
    const right = el('div', 'vm-setup-col');
    grid.appendChild(left);
    grid.appendChild(right);
    frame.body.appendChild(grid);

    this.buildYourSide(left);
    this.buildBrowser(right);

    /* -- status ------------------------------------------------------------ */
    this.status = el('div', 'vm-mp-status', PHASE_TEXT.idle);
    this.cancelBtn = button('Cancel', { onClick: () => { this.session?.cancel(); } });
    frame.foot.appendChild(this.status);
    frame.foot.appendChild(this.cancelBtn);

    host.appendChild(frame.root);
    this.openSession();
  }

  unmount(): void {
    // Leaving the screen leaves the lobby. A socket that outlives the screen
    // holds a queue slot and an open room nobody is watching, and the player
    // would be paired into a match they have navigated away from.
    if (this.phase !== 'playing') this.session?.leave();
    this.session = null;
  }

  onBack(): boolean {
    this.back();
    return true;
  }

  /* ======================================================================
   * LEFT — what you bring
   * ==================================================================== */

  private buildYourSide(col: HTMLElement): void {
    col.appendChild(el('div', 'vm-mp-legend', 'Your side'));

    const cards = el('div', 'vm-mp-cards');
    for (const f of this.factions) {
      const card = el('button', 'vm-mp-card');
      card.type = 'button';
      card.appendChild(el('span', 'vm-mp-card-stripe')).style.background = f.color;
      card.appendChild(el('span', 'vm-mp-card-name', f.name));
      card.appendChild(el('span', 'vm-mp-card-blurb', f.blurb));
      if (f.key === this.faction.key) card.classList.add('is-on');
      card.addEventListener('click', () => {
        this.faction = f;
        for (const other of cards.children) other.classList.remove('is-on');
        card.classList.add('is-on');
      });
      focusable(card);
      cards.appendChild(card);
    }
    col.appendChild(cards);

    /* -- host -------------------------------------------------------------- */
    col.appendChild(el('div', 'vm-mp-legend', 'Host a match'));

    const mapSelect = this.select(MAPS.map((m) => ({ value: m.id, label: m.name })), this.map, (v) => {
      this.map = v;
    });
    col.appendChild(row('Battlefield', mapSelect));

    // Public / Invite only. A segmented pair rather than a checkbox: "public"
    // and "invite only" are two named things, and a checkbox would make one of
    // them the unlabelled absence of the other.
    const vis = el('div', 'vm-mp-seg');
    this.visButtons = (['public', 'private'] as const).map((mode) => {
      const b = el('button', 'vm-mp-seg-btn');
      b.type = 'button';
      b.textContent = mode === 'public' ? 'Public' : 'Invite only';
      if (mode === this.visibility) b.classList.add('is-on');
      b.addEventListener('click', () => {
        this.visibility = mode;
        for (const other of this.visButtons) other.classList.remove('is-on');
        b.classList.add('is-on');
      });
      focusable(b);
      vis.appendChild(b);
      return b;
    });
    col.appendChild(row('Visibility', vis, 'public matches appear in the list'));

    this.hostBtn = button('Open the Match', {
      variant: 'primary',
      // SHORT. `.vm-btn-hint` is `flex: 0 0 auto` and the LABEL is what shrinks,
      // so a long hint wraps the label underneath it.
      hint: 'wait for a rival',
      onClick: () => { this.session?.host(this.faction.id as number, this.map, this.visibility); },
    });
    this.codeOut = el('div', 'vm-mp-code', '');
    const hostBlock = el('div', 'vm-mp-block');
    hostBlock.appendChild(this.hostBtn);
    col.appendChild(hostBlock);
    col.appendChild(this.codeOut);

    /* -- join by code ------------------------------------------------------ */
    col.appendChild(el('div', 'vm-mp-legend', 'Have a code?'));

    const input = el('input') as HTMLInputElement;
    input.type = 'text';
    input.className = 'vm-mp-input';
    input.maxLength = CODE_LENGTH_HINT;
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.placeholder = 'CODE';
    input.setAttribute('aria-label', 'Match code');
    // Upper-cased as it is typed. The code alphabet has no lower case, so
    // anything else is a typo — showing it corrected beats spending one of the
    // player's ten join attempts a minute to be told so.
    input.addEventListener('input', () => {
      const at = input.selectionStart;
      input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
      input.selectionStart = input.selectionEnd = at;
      this.refresh();
    });
    input.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') this.tryJoin();
    });
    focusable(input);
    this.codeIn = input;

    this.joinBtn = button('Join', { onClick: () => { this.tryJoin(); } });
    const joinBlock = el('div', 'vm-mp-block vm-mp-join');
    joinBlock.appendChild(input);
    joinBlock.appendChild(this.joinBtn);
    col.appendChild(joinBlock);
  }

  /* ======================================================================
   * RIGHT — who is playing
   * ==================================================================== */

  private buildBrowser(col: HTMLElement): void {
    col.appendChild(el('div', 'vm-mp-legend', 'Open matches'));

    /* -- filters ----------------------------------------------------------- */
    const filters = el('div', 'vm-mp-filters');

    const mapFilter = this.select(
      [{ value: ANY, label: 'Any map' }, ...MAPS.map((m) => ({ value: m.id, label: m.name }))],
      this.filterMap,
      (v) => { this.filterMap = v; this.renderRooms(); },
    );
    const factionFilter = this.select(
      [
        { value: ANY, label: 'Any side' },
        ...this.factions.map((f) => ({ value: String(f.id as number), label: f.name })),
      ],
      this.filterFaction,
      (v) => { this.filterFaction = v; this.renderRooms(); },
    );
    filters.appendChild(mapFilter);
    filters.appendChild(factionFilter);
    col.appendChild(filters);

    /* -- the list ---------------------------------------------------------- */
    this.roomList = el('div', 'vm-mp-rooms');
    col.appendChild(this.roomList);
    this.roomCount = el('div', 'vm-mp-count', '');
    col.appendChild(this.roomCount);

    /* -- quick match, under the list --------------------------------------- */
    this.queueBtn = button('Quick Match', {
      hint: 'any opponent',
      onClick: () => { this.session?.queue(this.faction.id as number); },
    });
    const queueBlock = el('div', 'vm-mp-block');
    queueBlock.appendChild(this.queueBtn);
    col.appendChild(queueBlock);

    this.renderRooms();
  }

  /**
   * Rebuild the room rows from the list in hand.
   *
   * FILTERED HERE, NOT ON THE RELAY. The list is already capped at
   * `ROOM_LIST_LIMIT` and is a few kilobytes at worst, so filtering locally
   * makes a filter change instant and costs the server nothing.
   */
  private renderRooms(): void {
    const list = this.roomList;
    if (list === null) return;
    list.replaceChildren();

    const shown = this.rooms.filter((r) => (
      (this.filterMap === ANY || r.map === this.filterMap)
      && (this.filterFaction === ANY || String(r.faction) === this.filterFaction)
    ));

    if (shown.length === 0) {
      const why = this.rooms.length === 0
        ? 'No public matches right now. Open one and wait, or take a quick match.'
        : 'No matches fit those filters.';
      list.appendChild(el('div', 'vm-mp-empty', why));
    }

    for (const r of shown) {
      const side = this.factions.find((f) => (f.id as number) === r.faction);
      const rowEl = el('button', 'vm-mp-room');
      rowEl.type = 'button';
      rowEl.appendChild(el('span', 'vm-mp-room-dot')).style.background = side?.color ?? '#888';
      const text = el('span', 'vm-mp-room-text');
      // Every string here comes from a map id or a faction index — never from
      // anything a stranger typed. See the header.
      text.appendChild(el('span', 'vm-mp-room-map', mapById(r.map).name));
      text.appendChild(el('span', 'vm-mp-room-side', side?.name ?? 'Unknown side'));
      rowEl.appendChild(text);
      rowEl.appendChild(el('span', 'vm-mp-room-age', ago(r.ageSec)));
      rowEl.addEventListener('click', () => {
        this.session?.joinRoom(r.id, this.faction.id as number);
      });
      focusable(rowEl);
      list.appendChild(rowEl);
    }

    if (this.roomCount !== null) {
      // The cap is REPORTED. A truncation nobody mentions reads as
      // completeness, which is how a busy server looks like an empty one.
      this.roomCount.textContent = this.roomTotal > this.rooms.length
        ? `Showing ${shown.length} of ${this.roomTotal} open matches`
        : (this.roomTotal === 0 ? '' : `${shown.length} of ${this.roomTotal} shown`);
    }
  }

  /* ======================================================================
   * SESSION
   * ==================================================================== */

  private openSession(): void {
    this.session = new Session(relayUrl(), {
      onPhase: (p) => {
        this.phase = p;
        // Subscribe as soon as the handshake lands, and drop the subscription
        // whenever we are no longer idle — a player sitting in a match does not
        // need the lobby pushed at them.
        if (p === 'ready') this.session?.watchRooms(true);
        this.refresh();
      },
      onCode: (code, visibility) => {
        if (this.codeOut !== null) {
          // A public room has no code, and the UI must not invent one.
          this.codeOut.textContent = code ?? '';
          this.codeOut.classList.toggle('is-on', code !== null);
        }
        if (visibility === 'public') this.note('Match opened. It is in the list now.');
        this.refresh();
      },
      onRooms: (rooms, total) => {
        this.rooms = rooms;
        this.roomTotal = total;
        this.renderRooms();
      },
      onStart: (info) => { this.launch(info); },
      onPeerLost: () => { /* only meaningful once playing; the HUD shows it */ },
      onOver: (_reason, _winner, message) => { this.note(message); },
      onNotice: (message) => { this.note(message); },
    });
    this.session.connect();
    this.refresh();
  }

  private back(): void {
    this.shell.showMenu();
  }

  private tryJoin(): void {
    const code = this.codeIn?.value.trim() ?? '';
    if (code.length === 0) return;
    this.session?.join(code, this.faction.id as number);
  }

  /** A one-line message that replaces the phase text until the phase changes. */
  private note(message: string): void {
    if (this.status !== null) this.status.textContent = message;
  }

  /**
   * Reflect the phase into the controls.
   *
   * Disabled rather than hidden: a control that vanishes moves everything below
   * it, and a lobby that reflows while somebody is reaching for a button is a
   * lobby that gets misclicked.
   */
  private refresh(): void {
    const p = this.phase;
    const idle = p === 'ready';
    const busy = p === 'hosting' || p === 'queued' || p === 'connecting';

    if (this.status !== null) this.status.textContent = PHASE_TEXT[p];
    if (this.hostBtn !== null) this.hostBtn.disabled = !idle;
    if (this.queueBtn !== null) this.queueBtn.disabled = !idle;
    if (this.joinBtn !== null) {
      this.joinBtn.disabled = !idle || (this.codeIn?.value.length ?? 0) === 0;
    }
    if (this.codeIn !== null) this.codeIn.disabled = !idle;
    if (this.cancelBtn !== null) this.cancelBtn.disabled = !busy;
    for (const b of this.visButtons) b.disabled = !idle;
    if (this.roomList !== null) this.roomList.classList.toggle('is-locked', !idle);
  }

  /** The relay has paired us. Hand the whole thing to the shell. */
  private launch(info: MatchStart): void {
    const session = this.session;
    if (session === null) return;
    // The session survives the screen — it IS the match now.
    this.session = null;
    void this.shell.startMultiplayerMatch(session, info);
  }

  /** A styled `<select>`. The shell kit has no picker for a long list. */
  private select(
    options: readonly { value: string; label: string }[],
    value: string,
    onChange: (v: string) => void,
  ): HTMLSelectElement {
    const sel = el('select', 'vm-mp-select') as HTMLSelectElement;
    for (const o of options) {
      const opt = el('option') as HTMLOptionElement;
      opt.value = o.value;
      opt.textContent = o.label;
      if (o.value === value) opt.selected = true;
      sel.appendChild(opt);
    }
    sel.addEventListener('change', () => { onChange(sel.value); });
    focusable(sel);
    return sel;
  }
}

/** "just now" / "2m" / "1h". Short, because it sits at the end of a row. */
function ago(sec: number): string {
  if (sec < 15) return 'new';
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  return `${Math.floor(sec / 3600)}h`;
}
