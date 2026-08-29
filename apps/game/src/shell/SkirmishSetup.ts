/**
 * ============================================================================
 * src/shell/SkirmishSetup.ts — the pre-match lobby
 * ============================================================================
 * Everything the player decides before a match exists, in one screen with no
 * sub-pages: side, how many armies, each opponent, battlefield, bank, speed,
 * seed.
 *
 * THE FACTION LIST IS READ AT RUNTIME
 * -----------------------------------
 * `playableFactions()` derives the roster from `DEF_TABLES.factions`, so the
 * third faction being authored in parallel appears here the moment it is
 * published — no edit to this file, no hard-coded pair.
 *
 * ARMIES, AND WHY THE SIDES ROW IS FIRST
 * --------------------------------------
 * This screen offered exactly one opponent for the project's whole life, and
 * the reason was upstream of it: `MatchSetup` carried a singular `aiFaction`
 * and `Bootstrap.ts` seated exactly two players. Both are now plural, so the
 * lobby leads with HOW MANY sides there are and then repeats the opponent block
 * once per AI army. The row is only drawn when the chosen battlefield offers
 * more than one answer — `MapChoice.players` is a real ceiling now — and it
 * sits above the opponent blocks because it decides how many of them exist.
 *
 * THERE IS A TEAM CONTROL NOW, AND THIS HEADER USED TO EXPLAIN WHY THERE WAS
 * NOT — "a free-for-all is what `PlayerState.allyMask` already defaults to …
 * teams would [need code]". They did: `src/game/Teams.ts` is the writer that
 * field never had, and `OpponentSetup.team` is the row that feeds it.
 *
 * ONE CHOOSER PER OPPONENT, IN THE OPPONENT'S OWN BLOCK, and not a match-type
 * preset on the Sides row. The Sides row answers HOW MANY armies; which of them
 * is fighting alongside you is a fact about that army, so it sits with its
 * faction and its difficulty, in the block that already owns every other thing
 * that army is. A `2v2 / 1v3 / FFA` preset would additionally have to name
 * WHICH opponent joins you, which is the row it was trying to avoid.
 *
 * THE OPTION LIST IS WHAT KEEPS THE MATCH LEGAL. Putting every army on the
 * player's team is a match with no enemy, which `outcome.system.ts` can never
 * resolve — so `Your Team` is simply not OFFERED to the last opponent who is
 * not already on it. `chooser` cycles the list it is given, so an option that
 * is absent is unreachable; refusing the click afterwards would have been a
 * control that silently ignores you.
 *
 * MIRROR MATCHES ARE LEGAL
 * ------------------------
 * They were not, and this header used to explain why: `ScenarioBuilder` resolved
 * its two scripted bases by SEARCHING the player table for a faction, so two
 * players on the same side meant one of them started with nothing. That was
 * fixed — the bases resolve by SLOT and remap their content to the owner's army
 * — and the row's own note has said "Mirror matches are allowed" ever since,
 * two paragraphs under a header saying they cannot be. One caveat survives and
 * it is in `normalizeSetup`, not here: the FIRST opponent is still re-pointed
 * when it equals the player's side. See the report.
 *
 * SEED
 * ----
 * Seed 0 is published as "Random": `Shell.startMatch` rolls a fresh one at
 * launch. Any other value is threaded to `GameLoop.seed` and to every scenario
 * placement, so two players who type the same number get the same battle.
 *
 * STARTING CONDITION
 * ------------------
 * The one lobby row that changes what the first two minutes of the match ARE.
 * `Construction Vehicle` is the default and the real game: drive somewhere,
 * deploy, build. `Pre-built Base` is the old behaviour, kept because a fast
 * start is a legitimate way to play and because the screenshot fixtures depend
 * on the pre-built layout existing at all.
 *
 * IT IS PERSISTED HERE, NOT IN `MatchSetup`. Every other row on this screen
 * lives in `settings-store.ts#MatchSetup`, and this one belongs there too — but
 * that file is owned by another workstream this cycle, and `normalizeSetup`
 * drops fields it does not know about, so routing the choice through it today
 * would silently lose it on the next load. Instead it gets its own
 * platform-storage key and its own two-line normaliser, both of which are a
 * deletion away once `MatchSetup` grows a `startCondition` field: move the
 * default into `defaultSetup()`, read `this.setup.startCondition`, and drop
 * `readStartCondition` / `writeStartCondition` below.
 *
 * The choice reaches the engine two ways, deliberately: `setPlannedStart()` for
 * the in-page rebuild, and `?start=` on the URL so it also survives the hard
 * reload path (`Shell.hardLaunch`) and a `?skipmenu=1` boot, neither of which
 * runs this screen.
 *
 * ADVANCED IS ONE DISCLOSURE, AND WHAT IS OUTSIDE IT IS THE POINT
 * --------------------------------------------------------------
 * Reported as the lobby reading like a form: every row carried a two- or
 * three-line grey note, and at 1600x1000 the Map Seed row and the summary line
 * were both below the fold with no scrollbar hint that they existed.
 *
 * FIVE ROWS MOVED AND ONE DELIBERATELY DID NOT. `Personality`, `Starting
 * Credits`, `Game Speed`, `Opponent Tech` and `Map Seed` are behind
 * `Advanced`; `Starting Condition` stays in the open because it is the one row
 * on this screen that changes what the match IS rather than how it runs — see
 * its own section above, which has said exactly that since it was written.
 * Burying the most consequential choice in order to tidy the screen is the
 * trade this feature exists to avoid making. `Personality` goes in on its own
 * row note's evidence: it "biases the AI's strategy scoring, not its rules",
 * which is a row admitting it is tuning.
 *
 * PERSONALITY LEAVES THE OPPONENT BLOCK, which the header above argues the
 * Team row must not do. The arguments differ: `Team` is only ever drawn when
 * there is more than one opponent AND it changes the shape of the match, so it
 * belongs with the army it describes. A personality is a dial on one army, it
 * is drawn for every opponent whether or not anything else is, and the label
 * carries the opponent's number when there is more than one — so nothing about
 * WHICH army is being tuned is lost by the move.
 *
 * THE OPEN STATE IS NOT PERSISTED, and the field is on the screen instance
 * rather than in `MatchSetup` or `localStorage` so that it cannot become
 * persisted by accident. A disclosure that remembers is a second piece of
 * state to get wrong — it can disagree with the rows it is hiding after a
 * `normalizeSetup` correction — and nothing has asked for one. Leaving the
 * lobby and coming back re-collapses it, which is the behaviour a player who
 * never opens it should get every time.
 * ============================================================================
 */

import {
  CREDIT_OPTIONS,
  DIFFICULTIES,
  MAPS,
  MAX_ARMIES,
  PERSONALITIES,
  SPEEDS,
  TEAM_PLAYER,
  armyCount,
  cloneSetup,
  defaultSetup,
  defaultTeamFor,
  describeTeams,
  mapById,
  rollSeed,
  teamLabel,
  teamsOf,
  teamsPlayable,
  withArmyCount,
  type MatchSetup,
  type MapChoice,
} from './settings-store';
import { persistentStorage } from '../platform/storage';
import { mapPreview } from './MapPreview';

import {
  button,
  chooser,
  el,
  focusable,
  icon,
  pageFrame,
  playableFactions,
  row,
  setAdjust,
  type FactionOption,
  type Screen,
  type Shell,
} from './Shell';

import {
  aiMirrorsUnlocks, gateInstalled, isMapUnlocked, setAiMirrorsUnlocks,
} from './progression-link';

import {
  START_CONDITION_DEFAULT, resolveStartCondition, setPlannedStart,
  type StartCondition,
} from '../game/Scenarios';

/* --------------------------------------------------------------------------
 * STARTING CONDITION — storage and copy
 *
 * See the module header for why this does not live in `MatchSetup` yet.
 * -------------------------------------------------------------------------- */

/** Its own key, separate from `voltmarch.setup.v1`. See the module header. */
export const START_STORAGE_KEY = 'voltmarch.setup.start.v1';

interface StartOption {
  readonly value: StartCondition;
  readonly label: string;
  readonly note: string;
}

/**
 * One line each, and both lines have to earn their place: a player picking
 * between these is choosing whether the first two minutes of the match exist.
 */
const START_OPTIONS: readonly StartOption[] = [
  {
    value: 'mcv',
    label: 'Construction Vehicle',
    note: 'Both sides start with one construction vehicle and a small escort. '
      + 'Drive it somewhere worth building, deploy it into your Construction Yard, '
      + 'and grow the base from nothing.',
  },
  {
    value: 'base',
    label: 'Pre-built Base',
    note: 'Both sides start with a finished base — yard, power, refinery, '
      + 'factories and defences already standing. A fast start that skips the '
      + 'opening and drops you straight into the fight.',
  },
];

/**
 * The smallest opening bank the MCV start is survivable on.
 *
 * MEASURED, not chosen. From a construction vehicle there is NO income until a
 * refinery stands, and the cheapest path to one is a power plant plus a
 * refinery: 300 + 2000 for the Allies and the Soviets, 350 + 2000 for the
 * Meridian Pact, 240 + 2000 for the Reclamation. The lobby's lowest option was
 * 2000 — under every one of those floors — so picking it handed the player a
 * match they could not build their way out of and could only lose. There is no
 * fallback, because the pre-built base that used to cover this is now an
 * option rather than the only behaviour.
 *
 * `base` keeps the full ladder: a finished refinery and a harvester are already
 * standing, so 2000 credits there is a hard opening, not an impossible one.
 */
export const MCV_MIN_CREDITS = 5000;

/** The credit options offered for a given opening. */
export function creditOptionsFor(start: StartCondition): readonly number[] {
  if (start !== 'mcv') return CREDIT_OPTIONS;
  const open = CREDIT_OPTIONS.filter((c) => c >= MCV_MIN_CREDITS);
  return open.length > 0 ? open : CREDIT_OPTIONS;
}

/** Raise a bank that cannot open a match from a construction vehicle. */
export function clampCreditsFor(start: StartCondition, credits: number): number {
  return start === 'mcv' ? Math.max(credits, MCV_MIN_CREDITS) : credits;
}

/** Read the persisted choice. Total: any failure is the default. */
export function readStartCondition(): StartCondition {
  try {
    const raw = persistentStorage().getItem(START_STORAGE_KEY);
    return resolveStartCondition(raw, START_CONDITION_DEFAULT);
  } catch {
    return START_CONDITION_DEFAULT;
  }
}

/** Persist the choice. Storage being unavailable is not an error worth raising. */
export function writeStartCondition(value: StartCondition): void {
  try {
    persistentStorage().setItem(START_STORAGE_KEY, value);
  } catch {
    /* Private mode, full disk, or a webview with storage off. */
  }
}

/**
 * Publish the choice to the engine: straight in for the in-page rebuild, and
 * onto the URL so it survives a hard reload or a `?skipmenu=1` boot.
 *
 * `?ai=off` outranks `?start=` in `Scenarios.chooseStart`, which is what keeps
 * the title-screen backdrop a finished base no matter what the lobby last said.
 */
export function applyStartCondition(value: StartCondition): void {
  setPlannedStart(value);
  try {
    if (typeof location === 'undefined' || typeof history === 'undefined') return;
    const q = new URLSearchParams(location.search);
    q.set('start', value);
    history.replaceState(null, '', `${location.pathname}?${q.toString()}`);
  } catch {
    /* A document with no history API is still perfectly playable. */
  }
}

/**
 * Maps the lobby offers on a brand-new profile.
 *
 * Two, not one. A single starter map means every early match is the same match
 * and the missions that unlock the others read as a chore; two with genuinely
 * different shapes — a wooded valley and an open flat — means the first hour
 * already has a decision in it. The rest are rewards, and the mission table is
 * the authority on which (`UNLOCKS.map*`); this list only has to agree about
 * the ones that are free, which `tests/progression-gate.spec.ts` checks.
 *
 * THREE NOW, AND THE THIRD IS A DIFFERENT ARGUMENT FROM THE FIRST TWO.
 * `sunder-atoll` is open on request, and the request is right for a reason the
 * other entries make plain: naval yards, pens, slipways, drydocks and
 * eighteen hulls need water, four of the seven maps are landlocked, and BOTH of
 * the two remaining sea maps sit behind mission gates ("win inside 15 minutes",
 * "build 750 units"). So on a fresh profile every one of those was content the
 * player could not reach — the same defect
 * `MAP_SEAS`' own header records for the maps that shipped dry, arriving by a
 * different route. A map that teaches the sea has to be there before the
 * missions that reward it.
 */
const STARTER_MAPS: readonly string[] = ['temperate-valley', 'airbase-flats', 'sunder-atoll'];

/** Is this map playable right now? Starters always are. */
function mapAvailable(id: string): boolean {
  return STARTER_MAPS.includes(id) || isMapUnlocked(id);
}

export class SkirmishSetupScreen implements Screen {
  readonly id = 'setup';

  private host: HTMLElement | null = null;
  private setup: MatchSetup;
  private factions: FactionOption[] = [];
  private left: HTMLElement | null = null;
  private right: HTMLElement | null = null;
  /** The opening. Persisted separately from `MatchSetup` — see the header. */
  private start: StartCondition;
  /**
   * Is the Advanced disclosure open?
   *
   * DELIBERATELY NOT PERSISTED and deliberately an instance field — see the
   * header. It survives a repaint of the right column (the Starting Condition
   * chooser causes one) because it lives on the screen rather than in the DOM,
   * and it does not survive leaving the lobby, because the screen is rebuilt.
   */
  private advancedOpen = false;

  constructor(private readonly shell: Shell) {
    // `cloneSetup`, not a spread. `opponents` is an array, and a shallow copy
    // would have this screen editing the shell's live setup in place — so
    // backing out of the lobby without pressing Start Battle would still have
    // changed the match.
    this.setup = cloneSetup(shell.getSetup());
    this.start = readStartCondition();
  }

  mount(host: HTMLElement): void {
    this.host = host;
    host.classList.add('vm-page');
    this.factions = playableFactions();

    const frame = pageFrame('Skirmish', () => this.shell.showMenu());
    frame.root.classList.add('vm-operation-panel', 'vm-skirmish-panel');

    const grid = el('div', 'vm-setup');
    this.left = el('div', 'vm-setup-col');
    this.right = el('div', 'vm-setup-col');
    grid.appendChild(this.left);
    grid.appendChild(this.right);
    frame.body.appendChild(grid);

    this.renderLeft();
    this.renderRight();

    frame.foot.appendChild(button('Randomise', {
      iconName: 'refresh',
      onClick: () => this.randomise(),
    }));
    frame.foot.appendChild(el('div', 'vm-spacer'));
    frame.foot.appendChild(button('Start Battle', {
      iconName: 'play',
      variant: 'primary',
      onClick: () => {
        // Publish the opening BEFORE the boot: `Shell.startMatch` disposes the
        // running engine and re-bootstraps synchronously from there, and the
        // scenario module reads its plan during that boot.
        applyStartCondition(this.start);
        // Last line of defence for the MCV credit floor: a setup restored from
        // an older profile never passed through the chooser.
        this.setup.startingCredits = clampCreditsFor(this.start, this.setup.startingCredits);
        void this.shell.startMatch(this.setup);
      },
    }));

    host.appendChild(frame.root);
  }

  unmount(): void {
    this.host?.classList.remove('vm-page');
    this.host = null;
    this.left = null;
    this.right = null;
  }

  onBack(): boolean {
    this.shell.showMenu();
    return true;
  }

  /* -------------------------------------------------------------------- */

  private section(parent: HTMLElement, title: string): HTMLElement {
    const s = el('div', 'vm-section');
    s.appendChild(el('h3', 'vm-h3', title));
    parent.appendChild(s);
    return s;
  }

  /**
   * A section whose rows are hidden behind a header the player presses.
   *
   * @returns the body to append rows to. Always populated, open or shut.
   *
   * THE ROWS ARE BUILT EITHER WAY AND THE HEADER TOGGLES `hidden`, rather than
   * the handler calling `renderRight()`. Two reasons, and the second is the
   * one that matters:
   *
   *  - a repaint destroys the header the player just pressed, so focus lands
   *    back on `<body>` and a keyboard or gamepad player is thrown to the top
   *    of the ring. `FocusRing.refresh` skips anything with no client rects,
   *    so hiding the body is already enough to keep the hidden rows out of the
   *    ring — the ring is re-derived on every `move`, `focusFirst` and resize.
   *  - `hidden` is one attribute and one class; a repaint is every chooser on
   *    the column rebuilt, and the seed readout has live state in it.
   */
  private disclosure(parent: HTMLElement, title: string, hint: string): HTMLElement {
    const s = el('div', 'vm-section vm-disclose');
    const body = el('div', 'vm-disclose-body');
    body.id = 'vm-setup-advanced';
    const head = button(title, { iconName: 'chevronRight', hint });
    head.classList.add('vm-disclose-head');
    head.setAttribute('aria-controls', body.id);
    const apply = (): void => {
      body.hidden = !this.advancedOpen;
      head.setAttribute('aria-expanded', this.advancedOpen ? 'true' : 'false');
      s.classList.toggle('is-open', this.advancedOpen);
    };
    head.addEventListener('click', () => {
      this.advancedOpen = !this.advancedOpen;
      apply();
    });
    apply();
    s.appendChild(head);
    s.appendChild(body);
    parent.appendChild(s);
    return body;
  }

  /** Sides and battlefield. */
  private renderLeft(): void {
    const col = this.left;
    if (col === null) return;
    this.reconcile();
    col.replaceChildren();

    /* -- your side -------------------------------------------------------- */
    const you = this.section(col, 'Your Faction');
    const cards = el('div', 'vm-cards');
    for (const f of this.factions) {
      cards.appendChild(this.factionCard(f, this.setup.playerFaction === f.key, () => {
        this.setup.playerFaction = f.key;
        this.renderLeft();
        this.renderRight();
      }));
    }
    you.appendChild(cards);

    /* -- armies ----------------------------------------------------------- */
    // How many sides are on the field, before who they are. Only offered when
    // the chosen battlefield has more than one answer — a row whose only value
    // is the value it already has is a control that does nothing.
    const seats = this.seatOptions();
    if (seats.length > 1) {
      const armies = this.section(col, 'Armies');
      armies.appendChild(row(
        'Sides',
        chooser(
          // THE LABEL IS A COUNT, NOT A SHAPE. It read `4-Way Free-For-All`,
          // which stops being true the moment a Team row is touched — and a
          // control announcing a match nobody is about to play is the exact
          // quiet falsehood this project audits for. The shape belongs to the
          // note below, where it is derived rather than assumed.
          seats.map((n) => ({ value: n, label: n === 2 ? '1 v 1' : `${n} Armies` })),
          armyCount(this.setup),
          (v) => {
            this.setup = withArmyCount(this.setup, v, this.factions.map((f) => f.key));
            this.renderLeft();
            this.renderRight();
          },
        ),
        this.shapeNote(),
      ));
    }

    /* -- opponents -------------------------------------------------------- */
    // ONE BLOCK PER OPPONENT, not one opponent section. Mirror matches ARE
    // offered: `ScenarioBuilder` resolves its scripted bases by player SLOT and
    // remaps each one's content to the owner's army, so Soviets-vs-Soviets
    // builds two Soviet bases rather than handing both to whoever happened to
    // hold `Faction.Soviets` first.
    const many = this.setup.opponents.length > 1;
    for (let i = 0; i < this.setup.opponents.length; i++) {
      const spec = this.setup.opponents[i];
      const enemy = this.section(col, many ? `Opponent ${i + 1}` : 'Opponent');
      enemy.appendChild(row(
        'Enemy Faction',
        chooser(
          this.factions.map((f) => ({ value: f.key, label: f.name })),
          spec.faction,
          (v) => { spec.faction = v; this.mirrorFirst(); },
        ),
        i === 0 ? 'Mirror matches are allowed.' : undefined,
      ));
      enemy.appendChild(row(
        'Difficulty',
        chooser(
          DIFFICULTIES.map((d, n) => ({ value: n, label: d })),
          spec.difficulty,
          (v) => { spec.difficulty = v; this.mirrorFirst(); },
        ),
        i === 0 ? 'Drives reaction time, actions per minute and wave size.' : undefined,
      ));
      // PERSONALITY IS NOT HERE. It lives in the Advanced disclosure in the
      // other column — see the module header for why this one row leaves the
      // block it describes while `Team` stays.
      //
      // ONLY WHERE THERE IS SOMETHING TO DECIDE. With two armies the one legal
      // assignment is "the opponent is not on your team", so the row would be a
      // control whose only value is the value it already has — the same rule
      // the Sides row above is drawn under.
      if (this.setup.opponents.length > 1) {
        enemy.appendChild(row(
          'Team',
          chooser(
            this.teamOptions(i).map((t) => ({ value: t, label: teamLabel(t) })),
            spec.team,
            (v) => {
              spec.team = v;
              this.mirrorFirst();
              // REPAINT, unlike the three rows above. Every other opponent's
              // option list depends on this value — taking the last enemy onto
              // your side has to stop being offered the instant it would end
              // the match — and the shape note under Sides is derived from all
              // of them together.
              this.renderLeft();
              this.renderRight();
            },
          ),
          i === 0
            ? 'Armies on the same team share vision and never fire on each other.'
            : undefined,
        ));
      }
    }
  }

  /**
   * The teams opponent `i` may be moved to.
   *
   * `TEAM_PLAYER` is withheld from the LAST army that is not already on it,
   * because a table where every army is on one team is a match with no enemy:
   * `outcome.system.ts` guards its victory on `hostiles > 0`, so nothing would
   * ever resolve it. The lobby refuses to offer that state and `normalizeSetup`
   * repairs it if it arrives from disk — two independent guards, because this
   * one lives in a click handler and the other one is what a stored blob meets.
   *
   * The current value is always in the list, whatever it is, so a team number
   * off a wider setup renders as itself instead of falling back to whatever
   * happens to sit at index 0.
   */
  private teamOptions(i: number): number[] {
    const list = this.setup.opponents;
    const wouldOrphan = !list.some((o, j) => j !== i && o.team !== TEAM_PLAYER);
    const out = new Set<number>();
    if (!wouldOrphan) out.add(TEAM_PLAYER);
    for (let t = 2; t <= armyCount(this.setup); t++) out.add(t);
    out.add(list[i]?.team ?? defaultTeamFor(i));
    return [...out].sort((a, b) => a - b);
  }

  /** `2 v 2`, `1 v 3`, `1 v 1 v 1 v 1` — plus what sharing a team buys. */
  private shapeNote(): string {
    const teams = teamsOf(this.setup);
    const allied = teams.length !== new Set(teams).size;
    return allied
      ? `${describeTeams(this.setup)}. Armies on the same team share vision and never fire `
        + 'on each other.'
      : `${describeTeams(this.setup)}. Everyone is hostile to everyone; the last army standing `
        + 'wins.';
  }

  /**
   * Copy opponent 1's settings onto `MatchSetup`'s singular mirror fields.
   *
   * REQUIRED AFTER EVERY OPPONENT EDIT, and the direction is not arbitrary:
   * `normalizeSetup` rebuilds `opponents[0]` FROM `aiFaction` / `difficulty` /
   * `personality`, because those are the half a stored blob from an older build,
   * a save-index row and a hand-written literal can all reach. So a lobby that
   * only wrote the array would have every change to the first opponent silently
   * reverted the moment the setup was normalised — which is on the way into
   * `startMatch`, i.e. always. Cheap enough to run on all three rows rather than
   * only the first, and then there is no index to get wrong.
   */
  private mirrorFirst(): void {
    const first = this.setup.opponents[0];
    if (first === undefined) return;
    this.setup.aiFaction = first.faction;
    this.setup.difficulty = first.difficulty;
    this.setup.personality = first.personality;
  }

  /**
   * Army counts the chosen battlefield offers, always including 2.
   *
   * `MapChoice.players` is the ceiling and it is now READ rather than declared
   * and ignored — see the field's own note for why three of the six maps stop
   * at two. Counts step by one, so a map rated for four also offers three: a
   * three-way is a genuinely different game from a four-way (two-on-one is the
   * natural shape) and there is no layout reason to forbid it.
   */
  private seatOptions(): number[] {
    const max = Math.min(MAX_ARMIES, mapById(this.setup.map).players);
    const out: number[] = [];
    for (let n = 2; n <= max; n++) out.push(n);
    return out;
  }

  /**
   * Make the setup legal before it is painted, not at launch.
   *
   * Two corrections, one rule: THE NUMBER ON SCREEN IS THE NUMBER THE PLAYER
   * WILL GET. A stored (or imported) setup can name a map this profile has not
   * earned, and it can hold a four-way on a battlefield with two authored
   * starts. `normalizeSetup` would clamp the second anyway at launch, which is
   * exactly the silent move the locked-map correction and the MCV credit floor
   * already exist to avoid.
   *
   * Idempotent, and called from the top of BOTH columns' render: they run
   * `renderLeft` then `renderRight`, so correcting only in the second one would
   * paint a Sides row the map cannot honour and then quietly disagree with it.
   *
   * Returns true when it actually moved something, so a click handler in one
   * column knows whether the other column needs repainting.
   */
  private reconcile(): boolean {
    let moved = false;
    if (!mapAvailable(this.setup.map)) {
      this.setup.map = STARTER_MAPS[0];
      moved = true;
    }
    const max = Math.min(MAX_ARMIES, mapById(this.setup.map).players);
    if (armyCount(this.setup) > max) {
      this.setup = withArmyCount(this.setup, max, this.factions.map((f) => f.key));
      moved = true;
    }
    /*
     * A THIRD CORRECTION, AND IT IS THE ONE THE TWO ABOVE CAN CAUSE. Shrinking
     * the table drops opponents from the END, so a 1v3 whose two hostile seats
     * were the ones removed comes back as "you and your ally, against nobody" —
     * a match `outcome.system.ts` can never resolve. The option lists in
     * `teamOptions` cannot see it coming, because the seat that made the table
     * legal no longer exists to be asked.
     *
     * Same repair as `normalizeSetup`, and for the same reason: the whole
     * partition goes back to the free-for-all, because nothing here knows which
     * army the player meant to fight and inventing one would paint a match they
     * did not set up.
     */
    if (!teamsPlayable(teamsOf(this.setup))) {
      this.setup.opponents.forEach((o, i) => { o.team = defaultTeamFor(i); });
      moved = true;
    }
    return moved;
  }

  /** Battlefield and match rules. */
  private renderRight(): void {
    const col = this.right;
    if (col === null) return;
    this.reconcile();
    col.replaceChildren();

    /* -- map -------------------------------------------------------------- */
    const maps = this.section(col, 'Battlefield');
    const selectedMap: MapChoice = mapById(this.setup.map);
    maps.appendChild(mapPreview(selectedMap));
    const list = el('div', 'vm-maplist');
    for (const m of MAPS) {
      // A locked map is SHOWN, disabled, with the reason on it — not hidden.
      // A list that silently grows is a list the player never learns is a
      // reward; "Coral Shore — locked" is the advertisement for the mission
      // that grants it.
      const open = mapAvailable(m.id);
      const item = el('button', 'vm-mapitem');
      item.type = 'button';
      item.setAttribute('aria-pressed', this.setup.map === m.id ? 'true' : 'false');
      item.appendChild(icon(open ? 'map' : 'lock', 18));
      const text = el('div', 'vm-mapitem-text');
      text.appendChild(el('div', 'vm-mapitem-name', m.name));
      text.appendChild(el('div', 'vm-mapitem-blurb', open ? m.blurb : 'Locked — complete a mission to unlock.'));
      item.appendChild(text);
      // `2P` / `4P` is the map's SEAT CEILING, and it is now the truth: the
      // lobby's Sides row is bounded by it and `normalizeSetup` clamps to it.
      // Every entry used to say 2P because every entry declared 2 and nothing
      // read the field.
      item.appendChild(el('div', 'vm-mapitem-tag', open ? `${m.players}P` : 'LOCKED'));
      if (open) {
        focusable(item);
        item.addEventListener('click', () => {
          this.setup.map = m.id;
          // The Sides row lives in the OTHER column, and picking a two-army map
          // out of a four-way has to move it. Repaint both.
          if (this.reconcile()) this.renderLeft();
          this.renderRight();
          // The chosen row may have been near the bottom of the scrolling
          // roster. Repainting replaces that focused button, so keeping the
          // old scroll offset would immediately hide the preview that changed.
          // Return the shared setup body to its survey; the selected row stays
          // visibly marked in the compact list underneath.
          const body = this.host?.querySelector<HTMLElement>('.vm-page-body');
          if (body !== null && body !== undefined) body.scrollTop = 0;
        });
      } else {
        item.classList.add('is-locked');
        item.disabled = true;
        item.setAttribute('aria-disabled', 'true');
      }
      list.appendChild(item);
    }
    maps.appendChild(list);

    /* -- rules ------------------------------------------------------------ */
    const rules = this.section(col, 'Rules');

    // FIRST in the section, above credits and speed, because it is the only row
    // here that changes what the match IS rather than how fast it runs.
    rules.appendChild(row(
      'Starting Condition',
      chooser(
        START_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
        this.start,
        (v) => {
          this.start = v;
          writeStartCondition(v);
          // An opening bank that was legal for a pre-built base can be below
          // the MCV floor. Raise it here rather than at launch, so the number
          // the player is looking at is the number they will get.
          this.setup.startingCredits = clampCreditsFor(v, this.setup.startingCredits);
          this.renderRight();
        },
      ),
    ));
    // The explanation is a paragraph rather than a `row` note: two sentences of
    // "what actually changes" is the difference between an option a player
    // understands and one they leave alone forever.
    const startNote = el(
      'p', 'vm-body vm-row-note',
      START_OPTIONS.find((o) => o.value === this.start)?.note ?? '',
    );
    startNote.style.padding = '0 18px 10px';
    rules.appendChild(startNote);

    /* -- advanced --------------------------------------------------------- *
     * Everything below this line is TUNING: how the match runs, not what it
     * is. Collapsed by default and rebuilt with the column, so a Starting
     * Condition change still re-derives the credit ladder underneath it.     */
    const adv = this.disclosure(
      col, 'Advanced', 'Personality · Credits · Speed · Tech · Weather · Seed',
    );

    // ONE ROW PER OPPONENT, LABELLED BY NUMBER when there is more than one.
    // The row was in the opponent's own block; the number is what carries the
    // information that move would otherwise lose.
    for (let i = 0; i < this.setup.opponents.length; i++) {
      const spec = this.setup.opponents[i];
      adv.appendChild(row(
        this.setup.opponents.length > 1 ? `Opponent ${i + 1} Personality` : 'Personality',
        chooser(
          [{ value: -1, label: 'Adaptive' }, ...PERSONALITIES.map((p, n) => ({ value: n, label: p }))],
          spec.personality,
          (v) => { spec.personality = v; this.mirrorFirst(); },
        ),
        i === 0 ? 'Biases the AI\'s strategy scoring, not its rules.' : undefined,
      ));
    }

    this.setup.startingCredits = clampCreditsFor(this.start, this.setup.startingCredits);
    adv.appendChild(row(
      'Starting Credits',
      chooser(
        creditOptionsFor(this.start).map((c) => ({ value: c, label: c.toLocaleString() })),
        this.setup.startingCredits,
        (v) => { this.setup.startingCredits = clampCreditsFor(this.start, v); },
      ),
      this.start === 'mcv'
        ? `From a construction vehicle there is no income until a refinery stands, so `
          + `${MCV_MIN_CREDITS.toLocaleString()} is the smallest bank that can reach one.`
        : undefined,
    ));
    adv.appendChild(row(
      'Game Speed',
      chooser(
        SPEEDS.map((s, i) => ({ value: i, label: `${s.toFixed(1)}×` })),
        this.setup.speed,
        (v) => { this.setup.speed = v; },
      ),
      'Scales the accumulator, never the fixed timestep.',
    ));

    // Only offered when a gate is actually installed. With no progression layer
    // (a stripped build, or the `?shot=` harness) the row would be a control
    // that changes nothing, which is worse than no control.
    if (gateInstalled()) {
      adv.appendChild(row(
        'Opponent Tech',
        chooser(
          [{ value: 1, label: 'Mirror Yours' }, { value: 0, label: 'Unrestricted' }],
          aiMirrorsUnlocks() ? 1 : 0,
          (v) => { setAiMirrorsUnlocks(v === 1); },
        ),
        'Mirrored, the AI fields only what you have unlocked. Unrestricted, it fields everything.',
      ));
    }

    adv.appendChild(row(
      'Dynamic Weather',
      chooser(
        [{ value: 1, label: 'Enabled' }, { value: 0, label: 'Disabled' }],
        this.setup.weather ? 1 : 0,
        (v) => { this.setup.weather = v === 1; },
      ),
      'Randomly brings in light or heavy rain. Visual only; simulation and balance stay unchanged.',
    ));

    /* -- seed ------------------------------------------------------------- */
    const seedRow = el('div', 'vm-row-control');
    const value = el('div', 'vm-chooser-value vm-num', this.seedLabel());
    focusable(value);
    const cycle = (): void => {
      this.setup.seed = this.setup.seed === 0 ? rollSeed() : 0;
      value.textContent = this.seedLabel();
    };
    value.addEventListener('click', cycle);
    setAdjust(value, cycle);
    const reroll = button('Reroll', {
      iconName: 'seed',
      onClick: () => {
        this.setup.seed = rollSeed();
        value.textContent = this.seedLabel();
      },
    });
    reroll.classList.add('is-icon');
    seedRow.appendChild(value);
    seedRow.appendChild(reroll);

    const seed = el('div', 'vm-row');
    const label = el('div', 'vm-row-label', 'Map Seed');
    label.appendChild(el('span', 'vm-row-note', 'Same seed, same battle. Random rolls one at launch.'));
    seed.appendChild(label);
    seed.appendChild(seedRow);
    adv.appendChild(seed);

    /* -- summary ---------------------------------------------------------- */
    const summary = el('p', 'vm-body');
    summary.style.padding = '10px 18px 4px';
    const m = mapById(this.setup.map);
    // The difficulties are listed once when the table agrees and joined with a
    // slash when it does not — "Normal AI" over a Brutal and two Easies would
    // be the summary lying about the match it is summarising.
    const diffs = [...new Set(this.setup.opponents.map((o) => DIFFICULTIES[o.difficulty]))];
    summary.textContent =
      `${m.name} · ${m.biome} terrain · ` +
      `${describeTeams(this.setup)} · ` +
      `${diffs.join(' / ')} AI · ` +
      `${SPEEDS[this.setup.speed].toFixed(1)}× speed · ` +
      `${this.start === 'mcv' ? 'start from a construction vehicle' : 'start with a base'}`;
    col.appendChild(summary);
  }

  private seedLabel(): string {
    return this.setup.seed === 0 ? 'RANDOM' : String(this.setup.seed);
  }

  private factionCard(f: FactionOption, selected: boolean, onPick: () => void): HTMLButtonElement {
    const card = el('button', 'vm-card');
    card.type = 'button';
    card.setAttribute('aria-pressed', selected ? 'true' : 'false');
    card.style.setProperty('--vm-card-color', f.color);
    const stripe = el('div', 'vm-card-stripe');
    card.appendChild(stripe);
    card.appendChild(el('div', 'vm-card-name', f.name));
    card.appendChild(el('div', 'vm-card-blurb', f.blurb));
    focusable(card);
    card.addEventListener('click', onPick);
    return card;
  }

  private randomise(): void {
    const d = defaultSetup();
    const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];
    const player = pick(this.factions);
    const others = this.factions.filter((f) => f.key !== player.key);
    // Randomise only over maps this profile can actually play. `STARTER_MAPS`
    // is the floor, so the pool is never empty even on a brand-new profile.
    const openMaps = MAPS.filter((m) => mapAvailable(m.id));
    const map = openMaps.length > 0 ? pick(openMaps) : mapById(STARTER_MAPS[0]);
    // THE ARMY COUNT IS KEPT, NOT ROLLED. Randomise is for "surprise me with a
    // battle", and a player who set up a four-way and pressed it expects three
    // new opponents, not a duel. It is clamped to the map that was just rolled,
    // which `reconcile` would do anyway on the repaint.
    const seats = Math.min(armyCount(this.setup), MAX_ARMIES, map.players);
    const difficulty = this.setup.opponents[0]?.difficulty ?? this.setup.difficulty;
    // ONE roll, written to both halves of the mirror. Rolling twice would leave
    // `aiFaction` and `opponents[0].faction` naming different sides, and
    // `normalizeSetup` resolves that disagreement in favour of the singular
    // field — so the army the screen painted is not the one that would launch.
    const foe = (others.length > 0 ? pick(others).key : player.key);
    // THE ALLIANCES ARE KEPT, FOR THE ARMY COUNT'S OWN REASON. Randomise rolls
    // the sides, the ground and the seed; a player who set up a 2v2 and pressed
    // it is asking for a new 2v2, exactly as one who set up a four-way is
    // asking for three new opponents rather than a duel.
    const teams = this.setup.opponents.map((o) => o.team);
    this.setup = withArmyCount({
      ...d,
      playerFaction: player.key,
      aiFaction: foe,
      map: map.id,
      difficulty,
      personality: -1,
      startingCredits: this.setup.startingCredits,
      speed: this.setup.speed,
      seed: rollSeed(),
      weather: this.setup.weather,
      opponents: [{ faction: foe, difficulty, personality: -1, team: teams[0] ?? defaultTeamFor(0) }],
    }, seats, this.factions.map((f) => f.key));
    this.setup.opponents.forEach((o, i) => { o.team = teams[i] ?? o.team; });
    // `reconcile` runs at the top of both renders and repairs a partition the
    // rolled seat count left with no enemy in it.
    this.renderLeft();
    this.renderRight();
  }
}
