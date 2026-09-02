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
 * COMMANDER NAMES ARE THE ONLY FREE TEXT. They are normalised and bounded on
 * the client and relay, then rendered through `textContent`; room titles remain
 * deliberately absent. Chat follows the same DOM rule once a match begins.
 *
 * AI DIFFICULTY EXISTS ONLY ON AI ROWS. There is no personality or starting
 * bank control, and quick match remains a human duel. NO SEED FIELD — the
 * relay picks it, or one player would know the map before the other.
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
import { DIFFICULTIES, MAPS, mapById } from './settings-store';
import { CODE_LENGTH_HINT, relayUrl } from './net-link';
import { Session, type LobbyPhase, type MatchStart } from '../net/Session';
import type { RoomSummary, RoomVisibility, SeatPlan } from '../net/protocol';
import { COMMANDER_NAME_MAX, normalizeCommanderName } from '../net/protocol';

/** Where the status line's text comes from, per phase. */
const PHASE_TEXT: Record<LobbyPhase, string> = {
  idle: 'Not connected.',
  connecting: 'Connecting to the match server…',
  ready: 'Connected.',
  hosting: 'Waiting for an opponent to join.',
  queued: 'Looking for an opponent…',
  playing: 'Match starting…',
  ended: 'Connection lost. Reconnecting to the lobby…',
};

/** Sentinel for "no filter". Not a valid map id or faction index. */
const ANY = '*';

export class MultiplayerSetup implements Screen {
  readonly id = 'multiplayer';

  private readonly factions: FactionOption[] = playableFactions();
  private faction: FactionOption;
  private map: string;
  private visibility: RoomVisibility = 'public';
  /** 0 is the unchanged duel; 1/2 are two humans against that many AI. */
  private aiCount = 0;
  private commanderName: string;
  private readonly aiFactions: number[] = [1, 4];
  private readonly aiDifficulty: number[] = [1, 1];

  private session: Session | null = null;
  private phase: LobbyPhase = 'idle';

  /* -- the browser -------------------------------------------------------- */
  private rooms: RoomSummary[] = [];
  private roomTotal = 0;
  private filterMap: string = ANY;
  private filterFaction: string = ANY;
  private workflow: 'find' | 'host' = 'find';

  /* -- live nodes, so an update is a write and not a rebuild -------------- */
  private status: HTMLElement | null = null;
  private codeOut: HTMLElement | null = null;
  private codeIn: HTMLInputElement | null = null;
  private hostBtn: HTMLButtonElement | null = null;
  private joinBtn: HTMLButtonElement | null = null;
  private queueBtn: HTMLButtonElement | null = null;
  private cancelBtn: HTMLButtonElement | null = null;
  private retryBtn: HTMLButtonElement | null = null;
  private visButtons: HTMLButtonElement[] = [];
  private workflowButtons: HTMLButtonElement[] = [];
  private findPanel: HTMLElement | null = null;
  private hostPanel: HTMLElement | null = null;
  private roomList: HTMLElement | null = null;
  private roomCount: HTMLElement | null = null;
  private roomBadge: HTMLElement | null = null;
  private roomsReceived = false;
  private mapFilterSelect: HTMLSelectElement | null = null;
  private factionFilterSelect: HTMLSelectElement | null = null;
  private seatGrid: HTMLElement | null = null;
  private mapSelect: HTMLSelectElement | null = null;
  private formatSelect: HTMLSelectElement | null = null;
  private nameInput: HTMLInputElement | null = null;
  private readonly formatControls: HTMLSelectElement[] = [];
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private disposed = false;

  constructor(private readonly shell: Shell) {
    const setup = this.shell.getSetup();
    this.faction = this.factions.find((f) => f.key === setup.playerFaction) ?? this.factions[0];
    this.map = setup.map;
    this.commanderName = normalizeCommanderName(this.shell.settings.get().gameplay.commanderName)
      ?? 'Commander';
  }

  /* ====================================================================== */

  mount(host: HTMLElement): void {
    // `.vm-screen` is a bare flex container with no alignment of its own —
    // `.vm-page` supplies `align-items: center; justify-content: center` and the
    // outer padding. Without it the panel pins to the top-left corner and
    // stretches, which is exactly how this screen first shipped.
    host.classList.add('vm-page');
    this.disposed = false;

    const frame = pageFrame('Multiplayer', () => { this.back(); });
    frame.root.classList.add('vm-operation-panel', 'vm-mp-panel');

    // Identity is shared by hosting, quick match and room joins. Keeping it in
    // one calm top band avoids asking the player for the same decision in
    // three visually unrelated workflows.
    this.buildIdentity(frame.body);

    // One workflow at a time. Showing create, quick match, invite join and the
    // public browser simultaneously made four different next actions compete
    // for one screen. Public discovery is the default; hosting remains one
    // stable press away and keeps its controls mounted, so focus and choices
    // survive switching routes.
    this.buildWorkflowNav(frame.body);
    const workspace = el('div', 'vm-setup vm-mp-workspace');
    this.findPanel = el('section', 'vm-setup-col vm-mp-workflow is-active');
    this.findPanel.setAttribute('aria-label', 'Find a multiplayer match');
    this.hostPanel = el('section', 'vm-setup-col vm-mp-workflow');
    this.hostPanel.setAttribute('aria-label', 'Host a multiplayer match');
    workspace.append(this.findPanel, this.hostPanel);
    frame.body.appendChild(workspace);

    this.buildFind(this.findPanel);
    this.buildHost(this.hostPanel);
    this.showWorkflow('find');

    /* -- status ------------------------------------------------------------ */
    this.status = el('div', 'vm-mp-status', PHASE_TEXT.idle);
    this.status.setAttribute('role', 'status');
    this.status.setAttribute('aria-live', 'polite');
    this.retryBtn = button('Reconnect Now', { onClick: () => { this.reconnectNow(); } });
    this.retryBtn.classList.add('vm-mp-retry');
    this.retryBtn.hidden = true;
    this.cancelBtn = button('Cancel', { onClick: () => { this.session?.cancel(); } });
    frame.foot.appendChild(this.status);
    frame.foot.appendChild(this.retryBtn);
    frame.foot.appendChild(this.cancelBtn);

    host.appendChild(frame.root);
    this.openSession();
  }

  unmount(): void {
    // Leaving the screen leaves the lobby. A socket that outlives the screen
    // holds a queue slot and an open room nobody is watching, and the player
    // would be paired into a match they have navigated away from.
    this.disposed = true;
    this.clearReconnect();
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

  private buildIdentity(parent: HTMLElement): void {
    const band = el('section', 'vm-mp-identity');
    band.appendChild(el('div', 'vm-mp-legend', 'Commander identity'));
    const commander = el('input') as HTMLInputElement;
    commander.type = 'text';
    commander.className = 'vm-mp-input is-name';
    commander.maxLength = COMMANDER_NAME_MAX;
    commander.autocomplete = 'off';
    commander.spellcheck = false;
    commander.value = this.commanderName;
    commander.setAttribute('aria-label', 'Commander name');
    commander.addEventListener('input', () => {
      this.commanderName = commander.value;
      commander.classList.toggle('is-invalid', normalizeCommanderName(commander.value) === null);
      this.renderSeatGrid();
    });
    commander.addEventListener('change', () => {
      const name = normalizeCommanderName(commander.value);
      if (name === null) return;
      commander.value = name;
      this.commanderName = name;
      this.shell.settings.patch({ gameplay: { commanderName: name } });
    });
    this.nameInput = commander;
    band.appendChild(row('Commander', commander, 'Used for rooms, chat and match records'));

    const cards = el('div', 'vm-mp-cards');
    for (const f of this.factions) {
      const card = el('button', 'vm-mp-card');
      card.type = 'button';
      card.appendChild(el('span', 'vm-mp-card-stripe')).style.background = f.color;
      card.appendChild(el('span', 'vm-mp-card-name', f.name));
      card.appendChild(el('span', 'vm-mp-card-blurb', f.blurb));
      card.setAttribute('aria-label', `${f.name}. ${f.blurb}`);
      card.setAttribute('aria-pressed', String(f.key === this.faction.key));
      if (f.key === this.faction.key) card.classList.add('is-on');
      card.addEventListener('click', () => {
        this.faction = f;
        for (const other of cards.children) {
          other.classList.remove('is-on');
          other.setAttribute('aria-pressed', 'false');
        }
        card.classList.add('is-on');
        card.setAttribute('aria-pressed', 'true');
        this.renderSeatGrid();
      });
      focusable(card);
      cards.appendChild(card);
    }
    band.appendChild(cards);
    parent.appendChild(band);
  }

  /** The two mutually-exclusive lobby jobs, expressed as a real pressed pair. */
  private buildWorkflowNav(parent: HTMLElement): void {
    const nav = el('nav', 'vm-mp-workflow-nav');
    nav.setAttribute('aria-label', 'Multiplayer workflow');
    this.workflowButtons = (['find', 'host'] as const).map((mode) => {
      const control = el('button', 'vm-mp-workflow-btn');
      control.type = 'button';
      control.textContent = mode === 'find' ? 'Find a Match' : 'Host a Match';
      control.setAttribute('aria-pressed', String(mode === this.workflow));
      control.addEventListener('click', () => { this.showWorkflow(mode); });
      focusable(control);
      nav.appendChild(control);
      return control;
    });
    parent.appendChild(nav);
  }

  private showWorkflow(mode: 'find' | 'host'): void {
    this.workflow = mode;
    this.findPanel?.classList.toggle('is-active', mode === 'find');
    this.hostPanel?.classList.toggle('is-active', mode === 'host');
    if (this.findPanel !== null) this.findPanel.hidden = mode !== 'find';
    if (this.hostPanel !== null) this.hostPanel.hidden = mode !== 'host';
    this.workflowButtons.forEach((control, index) => {
      const on = (index === 0) === (mode === 'find');
      control.classList.toggle('is-on', on);
      control.setAttribute('aria-pressed', String(on));
    });
  }

  private buildHost(col: HTMLElement): void {

    /* -- host -------------------------------------------------------------- */
    col.appendChild(el('div', 'vm-mp-legend', 'Create a match'));

    const mapSelect = this.select(MAPS.map((m) => ({ value: m.id, label: m.name })), this.map, (v) => {
      this.map = v;
      const capacity = mapById(v).players;
      if (capacity < this.aiCount + 2) this.aiCount = 0;
      if (this.formatSelect !== null) this.formatSelect.value = String(this.aiCount);
      this.renderSeatGrid();
    });
    this.mapSelect = mapSelect;
    col.appendChild(row('Battlefield', mapSelect));

    const format = this.select([
      { value: '0', label: 'Head-to-head · 1v1' },
      { value: '1', label: 'Co-op · 2v1 AI' },
      { value: '2', label: 'Co-op · 2v2 AI' },
    ], String(this.aiCount), (v) => {
      const count = Number(v);
      if (!Number.isInteger(count) || count < 0 || count > 2) return;
      this.aiCount = count;
      if (mapById(this.map).players < count + 2) {
        const compatible = MAPS.find((candidate) => candidate.players >= count + 2);
        if (compatible !== undefined) {
          this.map = compatible.id;
          if (this.mapSelect !== null) this.mapSelect.value = compatible.id;
        }
      }
      this.renderSeatGrid();
    });
    this.formatControls.push(format);
    this.formatSelect = format;
    col.appendChild(row('Format', format, 'quick match remains 1v1'));

    this.seatGrid = el('div', 'vm-mp-seats');
    col.appendChild(this.seatGrid);
    this.renderSeatGrid();

    // Public / Invite only. A segmented pair rather than a checkbox: "public"
    // and "invite only" are two named things, and a checkbox would make one of
    // them the unlabelled absence of the other.
    const vis = el('div', 'vm-mp-seg');
    this.visButtons = (['public', 'private'] as const).map((mode) => {
      const b = el('button', 'vm-mp-seg-btn');
      b.type = 'button';
      b.textContent = mode === 'public' ? 'Public' : 'Invite only';
      b.setAttribute('aria-pressed', String(mode === this.visibility));
      if (mode === this.visibility) b.classList.add('is-on');
      b.addEventListener('click', () => {
        this.visibility = mode;
        for (const other of this.visButtons) {
          other.classList.remove('is-on');
          other.setAttribute('aria-pressed', 'false');
        }
        b.classList.add('is-on');
        b.setAttribute('aria-pressed', 'true');
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
      onClick: () => {
        const name = this.identity();
        if (name === null) return;
        this.session?.host(
          this.faction.id as number, this.map, this.visibility, this.makeSeatPlan(), name,
        );
      },
    });
    this.codeOut = el('div', 'vm-mp-code', '');
    const hostBlock = el('div', 'vm-mp-block');
    hostBlock.appendChild(this.hostBtn);
    col.appendChild(hostBlock);
    col.appendChild(this.codeOut);

  }

  private buildJoinByCode(col: HTMLElement): void {
    col.appendChild(el('div', 'vm-mp-legend', 'Join with invite code'));

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

  private buildFind(col: HTMLElement): void {
    const browser = el('section', 'vm-mp-browser');
    const browserHead = el('header', 'vm-mp-browser-head');
    const browserTitle = el('div', 'vm-mp-browser-title');
    browserTitle.appendChild(el('div', 'vm-mp-legend', 'Public matches'));
    browserTitle.appendChild(el(
      'p', 'vm-mp-browser-copy',
      'Live games you can join immediately. Select a row to take the open commander seat.',
    ));
    browserHead.appendChild(browserTitle);
    this.roomBadge = el('span', 'vm-mp-live-badge', 'Connecting');
    browserHead.appendChild(this.roomBadge);
    browser.appendChild(browserHead);

    /* -- filters ----------------------------------------------------------- */
    const filters = el('div', 'vm-mp-filters');

    const mapFilter = this.select(
      [{ value: ANY, label: 'Any map' }, ...MAPS.map((m) => ({ value: m.id, label: m.name }))],
      this.filterMap,
      (v) => { this.filterMap = v; this.renderRooms(); },
    );
    mapFilter.setAttribute('aria-label', 'Filter public matches by battlefield');
    this.mapFilterSelect = mapFilter;
    const factionFilter = this.select(
      [
        { value: ANY, label: 'Any side' },
        ...this.factions.map((f) => ({ value: String(f.id as number), label: f.name })),
      ],
      this.filterFaction,
      (v) => { this.filterFaction = v; this.renderRooms(); },
    );
    factionFilter.setAttribute('aria-label', 'Filter public matches by faction');
    this.factionFilterSelect = factionFilter;
    filters.appendChild(mapFilter);
    filters.appendChild(factionFilter);
    browser.appendChild(filters);

    /* -- the list ---------------------------------------------------------- */
    this.roomList = el('div', 'vm-mp-rooms');
    this.roomList.setAttribute('role', 'region');
    this.roomList.setAttribute('aria-label', 'Open public matches');
    this.roomList.setAttribute('aria-live', 'polite');
    browser.appendChild(this.roomList);
    this.roomCount = el('div', 'vm-mp-count', 'Checking for open matches…');
    browser.appendChild(this.roomCount);
    col.appendChild(browser);

    // Secondary routes sit below discovery instead of competing with it in a
    // single dense form. They remain fully visible and need no disclosure.
    const alternates = el('div', 'vm-mp-alternates');
    const quick = el('section', 'vm-mp-alternate');
    quick.appendChild(el('div', 'vm-mp-legend', 'Quick match'));
    quick.appendChild(el('p', 'vm-mp-alternate-copy', 'Enter the 1v1 queue and let the relay find a rival.'));
    this.queueBtn = button('Enter Quick Match', {
      hint: 'automatic pairing',
      variant: 'primary',
      onClick: () => {
        const name = this.identity();
        if (name !== null) this.session?.queue(this.faction.id as number, name);
      },
    });
    const queueBlock = el('div', 'vm-mp-block');
    queueBlock.appendChild(this.queueBtn);
    quick.appendChild(queueBlock);

    const invite = el('section', 'vm-mp-alternate');
    this.buildJoinByCode(invite);
    alternates.append(quick, invite);
    col.appendChild(alternates);

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

    const connected = this.phase === 'ready' || this.phase === 'hosting' || this.phase === 'queued';
    const connecting = this.phase === 'connecting';
    if (this.roomBadge !== null) this.roomBadge.textContent = connected ? 'Live list' : connecting ? 'Connecting' : 'Offline';
    if (!connected || !this.roomsReceived) {
      const waiting = el('div', 'vm-mp-empty');
      waiting.appendChild(el('strong', 'vm-mp-empty-title', connected ? 'Loading public matches'
        : connecting ? 'Connecting to the match server' : 'Match server unavailable'));
      waiting.appendChild(el('span', 'vm-mp-empty-copy', connected
        ? 'Waiting for the current lobby list.' : 'The list will refresh when the connection is restored. You can still configure a match.'));
      list.appendChild(waiting);
      if (this.roomCount !== null) this.roomCount.textContent = connected ? 'Waiting for match list…' : PHASE_TEXT[this.phase];
      return;
    }

    const shown = this.rooms.filter((r) => (
      (this.filterMap === ANY || r.map === this.filterMap)
      && (this.filterFaction === ANY || String(r.faction) === this.filterFaction)
    ));
    list.classList.toggle('is-empty', shown.length === 0);

    if (shown.length === 0) {
      const empty = el('div', 'vm-mp-empty');
      empty.appendChild(el(
        'strong', 'vm-mp-empty-title',
        this.rooms.length === 0 ? 'No public matches are open' : 'No matches fit these filters',
      ));
      empty.appendChild(el(
        'span', 'vm-mp-empty-copy',
        this.rooms.length === 0
          ? 'Be the first host, or use Quick Match for automatic pairing.'
          : 'Clear the filters to return to the complete live list.',
      ));
      const action = button(this.rooms.length === 0 ? 'Host a Public Match' : 'Clear Filters', {
        onClick: () => {
          if (this.rooms.length === 0) {
            this.visibility = 'public';
            for (const [index, control] of this.visButtons.entries()) {
              control.classList.toggle('is-on', index === 0);
              control.setAttribute('aria-pressed', String(index === 0));
            }
            this.showWorkflow('host');
            return;
          }
          this.filterMap = ANY;
          this.filterFaction = ANY;
          if (this.mapFilterSelect !== null) this.mapFilterSelect.value = ANY;
          if (this.factionFilterSelect !== null) this.factionFilterSelect.value = ANY;
          this.renderRooms();
        },
      });
      action.classList.add('vm-mp-empty-action');
      empty.appendChild(action);
      list.appendChild(empty);
    }

    for (const r of shown) {
      const side = this.factions.find((f) => (f.id as number) === r.faction);
      const rowEl = el('button', 'vm-mp-room');
      rowEl.type = 'button';
      rowEl.setAttribute('aria-label', `Join ${mapById(r.map).name} hosted by ${r.hostName}`);
      rowEl.appendChild(el('span', 'vm-mp-room-dot')).style.background = side?.color ?? '#888';
      const text = el('span', 'vm-mp-room-text');
      text.appendChild(el('span', 'vm-mp-room-map', mapById(r.map).name));
      const format = r.aiCount === 0 ? '1v1' : (r.aiCount === 1 ? '2v1 co-op' : '2v2 co-op');
      text.appendChild(el(
        'span', 'vm-mp-room-side',
        `${r.hostName} · ${side?.name ?? 'Unknown side'} · ${format}`,
      ));
      rowEl.appendChild(text);
      rowEl.appendChild(el('span', 'vm-mp-room-age', ago(r.ageSec)));
      rowEl.appendChild(el('span', 'vm-mp-room-action', 'Join'));
      rowEl.addEventListener('click', () => {
        const name = this.identity();
        if (name !== null) this.session?.joinRoom(r.id, this.faction.id as number, name);
      });
      focusable(rowEl);
      list.appendChild(rowEl);
    }

    if (this.roomCount !== null) {
      // The cap is REPORTED. A truncation nobody mentions reads as
      // completeness, which is how a busy server looks like an empty one.
      this.roomCount.textContent = this.roomTotal > this.rooms.length
        ? `Showing ${shown.length} of ${this.roomTotal} open matches`
        : (this.roomTotal === 0 ? 'Live list connected · 0 open matches' : `${shown.length} of ${this.roomTotal} shown`);
    }
  }

  /* ======================================================================
   * SESSION
   * ==================================================================== */

  private openSession(): void {
    const session = new Session(relayUrl(), {
      onPhase: (p) => {
        if (this.session !== session || this.disposed) return;
        this.phase = p;
        if (p === 'connecting' || p === 'ended') this.roomsReceived = false;
        this.renderRooms();
        // Subscribe as soon as the handshake lands, and drop the subscription
        // whenever we are no longer idle — a player sitting in a match does not
        // need the lobby pushed at them.
        if (p === 'ready') {
          this.clearReconnect();
          this.reconnectAttempt = 0;
          session.watchRooms(true);
        }
        this.refresh();
        if (p === 'ended') this.scheduleReconnect();
      },
      onCode: (code, visibility) => {
        if (this.session !== session || this.disposed) return;
        if (this.codeOut !== null) {
          // A public room has no code, and the UI must not invent one.
          this.codeOut.textContent = code ?? '';
          this.codeOut.classList.toggle('is-on', code !== null);
        }
        if (visibility === 'public') this.note('Match opened. It is in the list now.');
        this.refresh();
      },
      onRooms: (rooms, total) => {
        if (this.session !== session || this.disposed) return;
        this.rooms = rooms;
        this.roomTotal = total;
        this.roomsReceived = true;
        this.renderRooms();
      },
      onStart: (info) => {
        if (this.session === session && !this.disposed) this.launch(info);
      },
      onPeerLost: () => { /* only meaningful once playing; the HUD shows it */ },
      onChat: () => { /* the shell takes over these handlers once playing */ },
      onPing: () => { /* the shell takes over these handlers once playing */ },
      onOver: (_reason, _winner, message) => {
        if (this.session === session && !this.disposed) this.note(message);
      },
      onNotice: (message) => {
        if (this.session !== session || this.disposed) return;
        this.note(this.phase === 'ended' ? `${message} Reconnecting to the lobby…` : message);
      },
    });
    this.session = session;
    session.connect();
    this.refresh();
  }

  /** Retry a pre-match socket with bounded backoff. A running match never uses this path. */
  private scheduleReconnect(): void {
    if (this.disposed || this.session === null || this.phase !== 'ended') return;
    this.clearReconnect();
    const delay = Math.min(8_000, 1_000 * (2 ** this.reconnectAttempt));
    this.reconnectAttempt++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.disposed || this.phase !== 'ended') return;
      if (this.session?.reconnectLobby() !== true) return;
      this.refresh();
    }, delay);
    if (this.retryBtn !== null) this.retryBtn.hidden = false;
  }

  private reconnectNow(): void {
    if (this.disposed || this.phase !== 'ended') return;
    this.clearReconnect();
    if (this.session?.reconnectLobby() === true) this.refresh();
  }

  private clearReconnect(): void {
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private back(): void {
    this.shell.showMenu();
  }

  private tryJoin(): void {
    const code = this.codeIn?.value.trim() ?? '';
    if (code.length === 0) return;
    const name = this.identity();
    if (name !== null) this.session?.join(code, this.faction.id as number, name);
  }

  /** Validate and persist the identity every network action is labelled with. */
  private identity(): string | null {
    const name = normalizeCommanderName(this.commanderName);
    if (name === null) {
      this.nameInput?.classList.add('is-invalid');
      this.note('Choose a 2–20 character commander name without reserved words.');
      this.nameInput?.focus();
      return null;
    }
    this.commanderName = name;
    if (this.nameInput !== null) this.nameInput.value = name;
    this.shell.settings.patch({ gameplay: { commanderName: name } });
    return name;
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
    if (this.nameInput !== null) this.nameInput.disabled = !idle;
    if (this.cancelBtn !== null) this.cancelBtn.disabled = !busy;
    if (this.retryBtn !== null) this.retryBtn.hidden = p !== 'ended';
    for (const b of this.visButtons) b.disabled = !idle;
    for (const control of this.formatControls) control.disabled = !idle;
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

  /** Rebuild the fixed, non-free-text logical seat plan shown to the host. */
  private renderSeatGrid(): void {
    const grid = this.seatGrid;
    if (grid === null) return;
    grid.replaceChildren();
    this.formatControls.splice(1);

    const seat = (label: string, role: string, team: string, controls?: HTMLElement): void => {
      const node = el('div', 'vm-mp-seat');
      node.appendChild(el('span', 'vm-mp-seat-role', role));
      node.appendChild(el('span', 'vm-mp-seat-name', label));
      node.appendChild(el('span', 'vm-mp-seat-team', team));
      if (controls !== undefined) node.appendChild(controls);
      grid.appendChild(node);
    };

    seat(
      `${normalizeCommanderName(this.commanderName) ?? 'Invalid name'} · ${this.faction.name}`,
      'You', 'Team A',
    );
    seat(this.aiCount === 0 ? 'Joining commander' : 'Open allied seat',
      this.aiCount === 0 ? 'Rival' : 'Ally', this.aiCount === 0 ? 'Team B' : 'Team A');

    for (let index = 0; index < this.aiCount; index++) {
      const controls = el('span', 'vm-mp-seat-controls');
      const faction = this.select(this.factions.map((option) => ({
        value: String(option.id as number), label: option.name,
      })), String(this.aiFactions[index]), (value) => { this.aiFactions[index] = Number(value); });
      const difficulty = this.select(DIFFICULTIES.map((name, value) => ({
        value: String(value), label: name,
      })), String(this.aiDifficulty[index]), (value) => { this.aiDifficulty[index] = Number(value); });
      faction.classList.add('vm-mp-seat-select');
      difficulty.classList.add('vm-mp-seat-select');
      this.formatControls.push(faction, difficulty);
      controls.append(faction, difficulty);
      seat(`Enemy AI ${index + 1}`, 'AI', 'Team B', controls);
    }
  }

  /** Host-authored shape; the relay validates it without clamping. */
  private makeSeatPlan(): SeatPlan {
    if (this.aiCount === 0) {
      return {
        factions: [this.faction.id as number, this.faction.id as number],
        teams: [0, 1], ai: [], difficulty: [0, 0],
      };
    }
    const ai = Array.from({ length: this.aiCount }, (_, index) => index + 2);
    return {
      factions: [
        this.faction.id as number,
        this.faction.id as number,
        ...this.aiFactions.slice(0, this.aiCount),
      ],
      teams: [0, 0, ...new Array<number>(this.aiCount).fill(1)],
      ai,
      difficulty: [0, 0, ...this.aiDifficulty.slice(0, this.aiCount)],
    };
  }
}

/** "just now" / "2m" / "1h". Short, because it sits at the end of a row. */
function ago(sec: number): string {
  if (sec < 15) return 'new';
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  return `${Math.floor(sec / 3600)}h`;
}
