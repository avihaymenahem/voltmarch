/**
 * ============================================================================
 * src/shell/SkirmishSetup.ts — the pre-match lobby
 * ============================================================================
 * Everything the player decides before a match exists, in one screen with no
 * sub-pages: side, opponent, battlefield, difficulty, bank, speed, seed.
 *
 * THE FACTION LIST IS READ AT RUNTIME
 * -----------------------------------
 * `playableFactions()` derives the roster from `DEF_TABLES.factions`, so the
 * third faction being authored in parallel appears here the moment it is
 * published — no edit to this file, no hard-coded pair.
 *
 * WHY THE OPPONENT CANNOT MIRROR YOU
 * ----------------------------------
 * `ScenarioBuilder` resolves the Allied and Soviet bases by SEARCHING the
 * player table for a faction (`b.allies` / `b.soviets`). Two players on the
 * same side means both scripted bases resolve to one of them and the other
 * starts the match with nothing. Until the scenario builder takes an explicit
 * owner, the lobby simply does not offer the illegal choice — which is also
 * why picking a side re-points the opponent instead of showing an error.
 *
 * SEED
 * ----
 * Seed 0 is published as "Random": `Shell.startMatch` rolls a fresh one at
 * launch. Any other value is threaded to `GameLoop.seed` and to every scenario
 * placement, so two players who type the same number get the same battle.
 * ============================================================================
 */

import {
  CREDIT_OPTIONS,
  DIFFICULTIES,
  MAPS,
  PERSONALITIES,
  SPEEDS,
  defaultSetup,
  mapById,
  rollSeed,
  type MatchSetup,
} from './settings-store';

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

export class SkirmishSetupScreen implements Screen {
  readonly id = 'setup';

  private host: HTMLElement | null = null;
  private setup: MatchSetup;
  private factions: FactionOption[] = [];
  private left: HTMLElement | null = null;
  private right: HTMLElement | null = null;

  constructor(private readonly shell: Shell) {
    this.setup = { ...shell.getSetup() };
  }

  mount(host: HTMLElement): void {
    this.host = host;
    host.classList.add('vm-page');
    this.factions = playableFactions();

    const frame = pageFrame('Skirmish', () => this.shell.showMenu());

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
      onClick: () => { void this.shell.startMatch(this.setup); },
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

  /** Sides and battlefield. */
  private renderLeft(): void {
    const col = this.left;
    if (col === null) return;
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

    /* -- opponent --------------------------------------------------------- */
    const enemy = this.section(col, 'Opponent');
    // Mirror matches ARE offered: `ScenarioBuilder` resolves its two scripted
    // bases by player SLOT and remaps each one's content to the owner's army,
    // so Soviets-vs-Soviets builds two Soviet bases rather than handing both to
    // whoever happened to hold `Faction.Soviets` first.
    enemy.appendChild(row(
      'Enemy Faction',
      chooser(
        this.factions.map((f) => ({ value: f.key, label: f.name })),
        this.setup.aiFaction,
        (v) => { this.setup.aiFaction = v; },
      ),
      'Mirror matches are allowed.',
    ));
    enemy.appendChild(row(
      'Difficulty',
      chooser(
        DIFFICULTIES.map((d, i) => ({ value: i, label: d })),
        this.setup.difficulty,
        (v) => { this.setup.difficulty = v; },
      ),
      'Drives reaction time, actions per minute and wave size.',
    ));
    enemy.appendChild(row(
      'Personality',
      chooser(
        [{ value: -1, label: 'Adaptive' }, ...PERSONALITIES.map((p, i) => ({ value: i, label: p }))],
        this.setup.personality,
        (v) => { this.setup.personality = v; },
      ),
      'Biases the AI\'s strategy scoring, not its rules.',
    ));
  }

  /** Battlefield and match rules. */
  private renderRight(): void {
    const col = this.right;
    if (col === null) return;
    col.replaceChildren();

    /* -- map -------------------------------------------------------------- */
    const maps = this.section(col, 'Battlefield');
    const list = el('div', 'vm-maplist');
    for (const m of MAPS) {
      const item = el('button', 'vm-mapitem');
      item.type = 'button';
      item.setAttribute('aria-pressed', this.setup.map === m.id ? 'true' : 'false');
      item.appendChild(icon('map', 18));
      const text = el('div', 'vm-mapitem-text');
      text.appendChild(el('div', 'vm-mapitem-name', m.name));
      text.appendChild(el('div', 'vm-mapitem-blurb', m.blurb));
      item.appendChild(text);
      item.appendChild(el('div', 'vm-mapitem-tag', `${m.players}P`));
      focusable(item);
      item.addEventListener('click', () => {
        this.setup.map = m.id;
        this.renderRight();
      });
      list.appendChild(item);
    }
    maps.appendChild(list);

    /* -- rules ------------------------------------------------------------ */
    const rules = this.section(col, 'Rules');
    rules.appendChild(row(
      'Starting Credits',
      chooser(
        CREDIT_OPTIONS.map((c) => ({ value: c, label: c.toLocaleString() })),
        this.setup.startingCredits,
        (v) => { this.setup.startingCredits = v; },
      ),
    ));
    rules.appendChild(row(
      'Game Speed',
      chooser(
        SPEEDS.map((s, i) => ({ value: i, label: `${s.toFixed(1)}×` })),
        this.setup.speed,
        (v) => { this.setup.speed = v; },
      ),
      'Scales the accumulator, never the fixed timestep.',
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
    rules.appendChild(seed);

    /* -- summary ---------------------------------------------------------- */
    const summary = el('p', 'vm-body');
    summary.style.padding = '10px 18px 4px';
    const m = mapById(this.setup.map);
    summary.textContent =
      `${m.name} · ${m.biome} terrain · ${DIFFICULTIES[this.setup.difficulty]} AI · ` +
      `${SPEEDS[this.setup.speed].toFixed(1)}× speed`;
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
    this.setup = {
      ...d,
      playerFaction: player.key,
      aiFaction: (others.length > 0 ? pick(others).key : player.key),
      map: pick(MAPS).id,
      difficulty: this.setup.difficulty,
      personality: -1,
      startingCredits: this.setup.startingCredits,
      speed: this.setup.speed,
      seed: rollSeed(),
    };
    this.renderLeft();
    this.renderRight();
  }
}
