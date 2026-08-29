/**
 * Development-only load-test controls.
 *
 * This module is reached only through Bootstrap's `__DEV__` dynamic import.
 * It is intentionally not a `*.system.ts`: system discovery is eager and would
 * otherwise pull the whole control surface into release bundles.
 */

import { BuildTab, type EntityId, type PlayerId } from '../core/types';
import type { GameContext } from '../game/Bootstrap';
import {
  BuildKind, production, type BuildEntry, type ProductionDevCheats,
} from '../sim/Production';
import { setVisionDevRevealMap } from '../sim/vision.system';

const STORAGE_KEY = 'voltmarch.dev.cheat-engine.v1';
const SPAWN_CHUNK = 64;

interface StoredState {
  open?: boolean;
  collapsed?: boolean;
  x?: number;
  y?: number;
  count?: number;
  owner?: number;
  category?: string;
  unitKey?: string;
  freeProduction?: boolean;
  instantProduction?: boolean;
  uncappedProduction?: boolean;
  revealMap?: boolean;
}

export interface CheatEngineHandle {
  dispose(): void;
}

export interface CheatEngineOptions {
  readonly ctx: GameContext;
  readonly mount: HTMLElement;
}

const CATEGORY_LABELS: Readonly<Record<number, string>> = {
  [BuildTab.Infantry]: 'Infantry',
  [BuildTab.Vehicles]: 'Vehicles / aircraft',
};

const FACTION_LABELS = ['Neutral', 'Allies', 'Soviets', 'Meridian Pact', 'Reclamation'];

function readState(): StoredState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === null ? {} : JSON.parse(raw) as StoredState;
  } catch {
    return {};
  }
}

function writeState(state: StoredState): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* private mode */ }
}

function element<T extends Element>(root: ParentNode, selector: string): T {
  const hit = root.querySelector<T>(selector);
  if (hit === null) throw new Error(`[cheat-engine] missing ${selector}`);
  return hit;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function node<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text = '',
): HTMLElementTagNameMap[K] {
  const value = document.createElement(tag);
  if (className !== '') value.className = className;
  if (text !== '') value.textContent = text;
  return value;
}

function labelledControl(labelText: string, control: HTMLElement, wide = false): HTMLLabelElement {
  const label = node('label', wide ? 'vm-cheat__wide' : '');
  label.append(node('span', 'vm-cheat__label', labelText), control);
  return label;
}

function actionButton(text: string, action: string, modifier = ''): HTMLButtonElement {
  const button = node('button', `vm-cheat__button${modifier}`, text);
  button.type = 'button';
  button.dataset.action = action;
  return button;
}

function ruleToggle(rule: keyof ProductionDevCheats, title: string, detail: string): HTMLLabelElement {
  const label = node('label', 'vm-cheat__check');
  const input = node('input');
  input.type = 'checkbox';
  input.dataset.rule = rule;
  const copy = node('span', '', title);
  copy.append(node('small', '', detail));
  label.append(input, copy);
  return label;
}

export function mountCheatEngine(options: CheatEngineOptions): CheatEngineHandle {
  const activeService = production();
  if (activeService === null) throw new Error('[cheat-engine] production service is not ready');
  const service = activeService;

  const stored = readState();
  const style = document.createElement('style');
  style.dataset.vmCheatEngine = 'styles';
  style.textContent = `
    .vm-cheat{position:fixed;width:356px;max-height:calc(100vh - 24px);pointer-events:auto;z-index:3;
      color:#e8e1e7;background:linear-gradient(180deg,#150b17f7,#08070df7);border:1px solid #ff3f70;
      box-shadow:0 16px 48px #000b,0 0 26px #ff174425;font:500 13px/1.2 Rajdhani,sans-serif}
    .vm-cheat[hidden]{display:none}.vm-cheat__head{height:42px;display:flex;align-items:center;gap:9px;padding:0 11px;
      background:#260a18;border-bottom:1px solid #7c2440;cursor:move;touch-action:none}
    .vm-cheat--collapsed .vm-cheat__body{display:none}
    .vm-cheat__mark{color:#ff426d;font:800 18px/1 monospace}.vm-cheat__title{flex:1;font-weight:800;letter-spacing:.18em}
    .vm-cheat__dev{border:1px solid #ffb12f;color:#ffca64;padding:2px 5px;font:700 9px/1 monospace}
    .vm-cheat__close{border:0;background:transparent;color:#cf9aad;font-size:20px;cursor:pointer}
    .vm-cheat__body{padding:11px;overflow:auto;max-height:calc(100vh - 66px)}
    .vm-cheat__warning{margin-bottom:10px;padding:7px 8px;border-left:2px solid #ffb12f;background:#241608;
      color:#f8c96d;font:600 10px/1.35 monospace;letter-spacing:.04em}
    .vm-cheat__section{border-top:1px solid #3c2332;padding-top:10px;margin-top:10px}
    .vm-cheat__section:first-of-type{margin-top:0}.vm-cheat__label{display:block;margin:0 0 5px;color:#b698a8;
      font:700 10px/1 monospace;letter-spacing:.13em;text-transform:uppercase}
    .vm-cheat__grid{display:grid;grid-template-columns:1fr 1fr;gap:7px}.vm-cheat__wide{grid-column:1/-1}
    .vm-cheat select,.vm-cheat input[type=number]{width:100%;height:32px;border:1px solid #503044;background:#0b0b12;
      color:#eee4ea;padding:0 8px;font:600 13px Rajdhani,sans-serif;outline:none}
    .vm-cheat select:focus,.vm-cheat input:focus{border-color:#ff3f70}
    .vm-cheat__button{height:34px;border:1px solid #6f2d48;background:#2a0d1a;color:#ffabc0;
      font:800 11px/1 Rajdhani,sans-serif;letter-spacing:.11em;cursor:pointer}
    .vm-cheat__button:hover{background:#431126}.vm-cheat__button--go{border-color:#ff3f70;background:#5c1028;color:#fff}
    .vm-cheat__button--stop{border-color:#c58830;color:#ffd17a}.vm-cheat__button:disabled{opacity:.35;cursor:default}
    .vm-cheat__checks{display:grid;gap:7px}.vm-cheat__check{display:flex;gap:8px;align-items:flex-start;color:#d5c6cf}
    .vm-cheat__check input{accent-color:#ff3f70}.vm-cheat__check small{display:block;color:#8e7886;margin-top:2px}
    .vm-cheat__status{margin-top:9px;min-height:30px;padding:7px 8px;background:#070b0d;border:1px solid #26343a;
      color:#7de1d2;font:600 10px/1.45 monospace;white-space:pre-line}
  `;

  const panel = document.createElement('section');
  panel.className = 'vm-cheat';
  panel.setAttribute('aria-label', 'Development Cheat Engine');

  const head = node('header', 'vm-cheat__head');
  const closeButton = node('button', 'vm-cheat__close', '×');
  closeButton.type = 'button';
  closeButton.setAttribute('aria-label', 'Close');
  head.append(
    node('span', 'vm-cheat__mark', '⚠'),
    node('span', 'vm-cheat__title', 'CHEAT ENGINE'),
    node('span', 'vm-cheat__dev', 'DEV ONLY'),
    closeButton,
  );

  const categorySelect = node('select');
  categorySelect.dataset.field = 'category';
  for (const [value, label] of [
    ['infantry', 'Infantry'],
    ['vehicles', 'Vehicles / aircraft'],
    ['all', 'All units'],
  ] as const) {
    const option = node('option', '', label);
    option.value = value;
    categorySelect.append(option);
  }
  const ownerSelect = node('select');
  ownerSelect.dataset.field = 'owner';
  const unitSelect = node('select');
  unitSelect.dataset.field = 'unit';
  const countInput = node('input');
  countInput.dataset.field = 'count';
  countInput.type = 'number';
  countInput.min = '1';
  countInput.max = '4096';
  countInput.step = '1';
  countInput.value = '100';

  const spawnControls = node('div', 'vm-cheat__grid');
  const stopButton = actionButton('STOP SPAWN', 'stop', ' vm-cheat__button--stop');
  stopButton.disabled = true;
  spawnControls.append(
    labelledControl('Category', categorySelect),
    labelledControl('Owner', ownerSelect),
    labelledControl('Unit', unitSelect, true),
    labelledControl('Count', countInput),
    actionButton('SPAWN AT CAMERA', 'spawn', ' vm-cheat__button--go'),
    stopButton,
    actionButton('CLEAR TEST BATCH', 'clear'),
  );
  const spawnSection = node('div', 'vm-cheat__section');
  spawnSection.append(spawnControls);

  const ruleControls = node('div', 'vm-cheat__checks');
  ruleControls.append(
    ruleToggle('freeProduction', 'Free production', 'Sidebar builds spend no ore.'),
    ruleToggle('instantProduction', 'Instant production', 'Each queued item completes on the next production tick.'),
    ruleToggle('uncappedProduction', 'Uncapped queues and units', '4,096 queue depth; max-alive limits disabled.'),
  );
  const ruleSection = node('div', 'vm-cheat__section');
  ruleSection.append(
    node('span', 'vm-cheat__label', 'Unlimited build mode · local player'),
    ruleControls,
  );

  const revealMap = node('input');
  revealMap.type = 'checkbox';
  revealMap.dataset.field = 'reveal-map';
  const revealMapCopy = node('span', '', 'Reveal entire map');
  revealMapCopy.append(node('small', '', 'Removes unexplored shroud and live fog-of-war.'));
  const revealMapControl = node('label', 'vm-cheat__check');
  revealMapControl.append(revealMap, revealMapCopy);
  const visibilitySection = node('div', 'vm-cheat__section');
  visibilitySection.append(
    node('span', 'vm-cheat__label', 'Map visibility'),
    revealMapControl,
  );

  const utilitySection = node('div', 'vm-cheat__section vm-cheat__grid');
  utilitySection.append(
    actionButton('+50,000 ORE', 'credits'),
    actionButton('HEAL LOCAL ARMY', 'heal'),
  );
  const output = node('output', 'vm-cheat__status');
  output.dataset.output = 'status';
  const body = node('div', 'vm-cheat__body');
  body.append(
    node('div', 'vm-cheat__warning', 'LOCAL TEST TOOL · direct spawning bypasses lockstep, tech, factories, ore and unit caps.'),
    spawnSection,
    ruleSection,
    visibilitySection,
    utilitySection,
    output,
  );
  panel.append(head, body);

  options.mount.append(style, panel);

  const close = element<HTMLButtonElement>(panel, '.vm-cheat__close');
  const headElement = element<HTMLElement>(panel, '.vm-cheat__head');
  const category = element<HTMLSelectElement>(panel, '[data-field="category"]');
  const owner = element<HTMLSelectElement>(panel, '[data-field="owner"]');
  const unit = element<HTMLSelectElement>(panel, '[data-field="unit"]');
  const count = element<HTMLInputElement>(panel, '[data-field="count"]');
  const spawn = element<HTMLButtonElement>(panel, '[data-action="spawn"]');
  const stop = element<HTMLButtonElement>(panel, '[data-action="stop"]');
  const clear = element<HTMLButtonElement>(panel, '[data-action="clear"]');
  const credits = element<HTMLButtonElement>(panel, '[data-action="credits"]');
  const heal = element<HTMLButtonElement>(panel, '[data-action="heal"]');
  const status = element<HTMLOutputElement>(panel, '[data-output="status"]');
  const rules = Array.from(panel.querySelectorAll<HTMLInputElement>('[data-rule]'));
  const revealMapCheckbox = element<HTMLInputElement>(panel, '[data-field="reveal-map"]');

  const state: StoredState = {
    open: stored.open ?? true,
    collapsed: stored.collapsed ?? false,
    x: stored.x,
    y: stored.y,
    count: stored.count ?? 100,
    owner: stored.owner ?? (options.ctx.world.localPlayer as number),
    category: stored.category ?? 'infantry',
    unitKey: stored.unitKey,
    freeProduction: stored.freeProduction ?? false,
    instantProduction: stored.instantProduction ?? false,
    uncappedProduction: stored.uncappedProduction ?? false,
    revealMap: stored.revealMap ?? false,
  };

  let disposed = false;
  let spawnFrame = 0;
  let spawnCancelled = false;
  let spawned: EntityId[] = [];

  function persist(): void { writeState(state); }

  function setOpen(open: boolean): void {
    state.open = open;
    panel.hidden = !open;
    persist();
  }

  function setCollapsed(collapsed: boolean): void {
    state.collapsed = collapsed;
    panel.classList.toggle('vm-cheat--collapsed', collapsed);
    placePanel();
    persist();
  }

  function placePanel(): void {
    const width = panel.offsetWidth || 356;
    const height = panel.offsetHeight || 500;
    const fallbackX = Math.max(12, window.innerWidth - width - 300);
    const x = clamp(state.x ?? fallbackX, 8, Math.max(8, window.innerWidth - width - 8));
    const y = clamp(state.y ?? 88, 8, Math.max(8, window.innerHeight - height - 8));
    state.x = x; state.y = y;
    panel.style.left = `${x}px`;
    panel.style.top = `${y}px`;
  }

  function refreshOwners(): void {
    owner.replaceChildren();
    for (let i = 0; i < options.ctx.world.players.length; i++) {
      const p = options.ctx.world.players[i];
      const option = document.createElement('option');
      option.value = String(i);
      option.textContent = `${i === (options.ctx.world.localPlayer as number) ? 'LOCAL · ' : ''}${FACTION_LABELS[p.faction] ?? `Faction ${p.faction}`} · ${p.name}`;
      owner.append(option);
    }
    owner.value = String(clamp(state.owner ?? 0, 0, Math.max(0, owner.options.length - 1)));
  }

  function filteredEntries(): BuildEntry[] {
    const mode = category.value;
    return service.catalog.entries.filter((entry) => entry.kind === BuildKind.Unit && (
      mode === 'all'
      || (mode === 'infantry' && entry.tab === BuildTab.Infantry)
      || (mode === 'vehicles' && entry.tab === BuildTab.Vehicles)
    ));
  }

  function refreshUnits(): void {
    const previous = state.unitKey ?? unit.value;
    unit.replaceChildren();
    for (const entry of filteredEntries()) {
      const option = document.createElement('option');
      option.value = entry.key;
      option.textContent = `${FACTION_LABELS[entry.faction] ?? 'Shared'} · ${CATEGORY_LABELS[entry.tab] ?? 'Unit'} · ${entry.name}`;
      unit.append(option);
    }
    if (previous && Array.from(unit.options).some((option) => option.value === previous)) unit.value = previous;
    state.unitKey = unit.value;
    persist();
  }

  function applyRules(): void {
    const next = {} as Record<keyof ProductionDevCheats, boolean>;
    for (const checkbox of rules) {
      const key = checkbox.dataset.rule as keyof ProductionDevCheats;
      next[key] = checkbox.checked;
      state[key] = checkbox.checked;
    }
    service.setDevCheats(options.ctx.world.localPlayer, next);
    persist();
  }

  function applyMapVisibility(): void {
    state.revealMap = revealMapCheckbox.checked;
    setVisionDevRevealMap(revealMapCheckbox.checked);
    persist();
    updateStatus(revealMapCheckbox.checked ? 'entire map revealed' : 'fog-of-war restored');
  }

  function updateStatus(message = ''): void {
    const world = options.ctx.world;
    const prefix = message === '' ? '' : `${message}\n`;
    status.textContent = `${prefix}test batch ${spawned.length} · world ${world.store.aliveCount}/${world.store.capacity}`;
  }

  function beginSpawn(): void {
    if (spawnFrame !== 0) return;
    const requested = clamp(Number.parseInt(count.value, 10) || 1, 1, options.ctx.world.store.capacity);
    const ownerId = clamp(Number.parseInt(owner.value, 10) || 0, 0, options.ctx.world.players.length - 1) as PlayerId;
    const key = unit.value;
    const pose = options.ctx.cameraRig.getPose();
    let completed = 0;
    spawnCancelled = false;
    spawn.disabled = true;
    stop.disabled = false;
    state.count = requested;
    state.owner = ownerId as number;
    state.unitKey = key;
    persist();

    const runChunk = (): void => {
      spawnFrame = 0;
      if (disposed || spawnCancelled || completed >= requested) {
        spawn.disabled = false;
        stop.disabled = true;
        updateStatus(spawnCancelled ? `spawn cancelled at ${completed}/${requested}` : `spawned ${completed}`);
        return;
      }
      const ids = service.devSpawnUnits({
        player: ownerId,
        key,
        count: Math.min(SPAWN_CHUNK, requested - completed),
        x: pose.x,
        z: pose.z,
        startIndex: completed,
      });
      spawned.push(...ids);
      completed += ids.length;
      updateStatus(`spawning ${completed}/${requested} · click STOP to abort`);
      if (ids.length === 0) {
        spawn.disabled = false;
        stop.disabled = true;
        updateStatus(`stopped at ${completed}: entity store full or unit unavailable`);
        return;
      }
      spawnFrame = requestAnimationFrame(runChunk);
    };
    spawnFrame = requestAnimationFrame(runChunk);
  }

  function clearSpawned(): void {
    spawnCancelled = true;
    const removed = service.devDestroyUnits(spawned);
    spawned = [];
    updateStatus(`retired ${removed} test units`);
  }

  function grantCredits(): void {
    const p = options.ctx.world.players[options.ctx.world.localPlayer as number];
    if (p === undefined) return;
    p.credits += 50_000;
    updateStatus('+50,000 ore granted');
  }

  function healArmy(): void {
    const world = options.ctx.world;
    const st = world.store;
    const local = world.localPlayer as number;
    let healed = 0;
    for (let a = 0; a < st.aliveCount; a++) {
      const i = st.alive[a];
      if (st.owner[i] !== local || st.maxHp[i] <= 0) continue;
      st.hp[i] = st.maxHp[i];
      healed++;
    }
    updateStatus(`healed ${healed} local entities`);
  }

  function toggleFromKey(event: KeyboardEvent): void {
    if (event.code !== 'KeyC' || !event.ctrlKey || !event.shiftKey) return;
    event.preventDefault();
    setOpen(!state.open);
    if (state.open) placePanel();
  }

  let dragPointer = -1;
  let dragDX = 0;
  let dragDY = 0;
  function dragStart(event: PointerEvent): void {
    if ((event.target as Element).closest('button') !== null) return;
    dragPointer = event.pointerId;
    dragDX = event.clientX - (state.x ?? 0);
    dragDY = event.clientY - (state.y ?? 0);
    headElement.setPointerCapture(event.pointerId);
  }
  function dragMove(event: PointerEvent): void {
    if (event.pointerId !== dragPointer) return;
    state.x = event.clientX - dragDX;
    state.y = event.clientY - dragDY;
    placePanel();
  }
  function dragEnd(event: PointerEvent): void {
    if (event.pointerId !== dragPointer) return;
    dragPointer = -1;
    persist();
  }

  function toggleCollapsed(event: MouseEvent): void {
    if ((event.target as Element).closest('button') !== null) return;
    setCollapsed(state.collapsed !== true);
  }

  category.value = state.category ?? 'infantry';
  count.value = String(state.count ?? 100);
  for (const checkbox of rules) {
    const key = checkbox.dataset.rule as keyof ProductionDevCheats;
    checkbox.checked = state[key] === true;
  }
  revealMapCheckbox.checked = state.revealMap === true;
  refreshOwners();
  refreshUnits();
  applyRules();
  setVisionDevRevealMap(revealMapCheckbox.checked);
  setCollapsed(state.collapsed === true);
  setOpen(state.open === true);
  requestAnimationFrame(placePanel);
  updateStatus('ready · direct spawn is free and uncapped');

  close.addEventListener('click', () => setOpen(false));
  category.addEventListener('change', () => { state.category = category.value; refreshUnits(); });
  owner.addEventListener('change', () => { state.owner = Number(owner.value); persist(); });
  unit.addEventListener('change', () => { state.unitKey = unit.value; persist(); });
  count.addEventListener('change', () => { state.count = clamp(Number(count.value) || 1, 1, 4096); count.value = String(state.count); persist(); });
  for (const checkbox of rules) checkbox.addEventListener('change', applyRules);
  revealMapCheckbox.addEventListener('change', applyMapVisibility);
  spawn.addEventListener('click', beginSpawn);
  stop.addEventListener('click', () => { spawnCancelled = true; });
  clear.addEventListener('click', clearSpawned);
  credits.addEventListener('click', grantCredits);
  heal.addEventListener('click', healArmy);
  headElement.addEventListener('pointerdown', dragStart);
  headElement.addEventListener('pointermove', dragMove);
  headElement.addEventListener('pointerup', dragEnd);
  headElement.addEventListener('pointercancel', dragEnd);
  headElement.addEventListener('dblclick', toggleCollapsed);
  window.addEventListener('keydown', toggleFromKey, true);
  window.addEventListener('resize', placePanel);

  return {
    dispose(): void {
      if (disposed) return;
      disposed = true;
      spawnCancelled = true;
      if (spawnFrame !== 0) cancelAnimationFrame(spawnFrame);
      service.setDevCheats(options.ctx.world.localPlayer, null);
      setVisionDevRevealMap(false);
      window.removeEventListener('keydown', toggleFromKey, true);
      window.removeEventListener('resize', placePanel);
      panel.remove();
      style.remove();
    },
  };
}
