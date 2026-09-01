/**
 * Semantic content closure for one battlefield boot.
 *
 * The contract names game content, never files, URLs or bundler chunks. Systems
 * declare the delivery they own before reveal, then publish one of four honest
 * states. Optional authored art can therefore stream later without becoming a
 * false miss when a validated procedural presentation is already drawable.
 */

export type ContentMode = 'skirmish' | 'multiplayer' | 'campaign' | 'replay' | 'fixture';
export type ContentState = 'pending' | 'ready' | 'fallback-ready' | 'failed';

export interface CampaignContentHint {
  readonly operation: string;
  readonly layout: string;
  readonly reinforcementUnits: readonly string[];
  readonly evaLines: readonly string[];
  readonly effectKinds: readonly string[];
}

export interface ContentClosureSeed {
  readonly mode: ContentMode;
  readonly factions: readonly number[];
  readonly scenario: string;
  readonly map: string;
  readonly opening: 'mcv' | 'base' | 'force';
  readonly naval: boolean;
  readonly campaign?: CampaignContentHint | null;
  readonly replayFormat?: number;
}

export interface ContentScope {
  readonly pattern: string;
  readonly reason: string;
}

export interface ContentDeliveryDeclaration {
  /** Stable semantic id such as `art/unit/1/allied_dozer/lod0`. */
  readonly key: string;
  readonly owner: string;
  readonly critical?: boolean;
  /** Approved substitute already usable when the authored delivery is absent. */
  readonly fallback?: string;
}

export interface ContentDeliveryReport extends Required<ContentDeliveryDeclaration> {
  readonly state: ContentState;
  readonly requests: number;
  readonly firstRequestPhase: 'boot' | 'post-reveal' | null;
}

export interface ContentMiss {
  readonly key: string;
  readonly owner: string;
  readonly phase: 'boot' | 'post-reveal' | 'reveal-gate';
  readonly reason: 'outside-plan' | 'undeclared' | 'not-ready';
  readonly state: ContentState | 'missing';
}

export interface ContentClosureReport {
  readonly seed: ContentClosureSeed | null;
  readonly broadFallback: boolean;
  readonly revealed: boolean;
  readonly scopes: readonly ContentScope[];
  readonly deliveries: readonly ContentDeliveryReport[];
  readonly misses: readonly ContentMiss[];
  readonly revealReady: boolean;
}

interface MutableDelivery {
  key: string;
  owner: string;
  critical: boolean;
  fallback: string;
  state: ContentState;
  requests: number;
  firstRequestPhase: 'boot' | 'post-reveal' | null;
}

declare const __DEV__: boolean;
const DEV = typeof __DEV__ !== 'undefined' ? __DEV__ : true;

let seed: ContentClosureSeed | null = null;
let scopes: readonly ContentScope[] = [];
let revealed = false;
let revealRejected = false;
let campaignHint: CampaignContentHint | null = null;
let runtimeEpoch = 0;
const deliveries = new Map<string, MutableDelivery>();
const misses: ContentMiss[] = [];
const missKeys = new Set<string>();

function stable(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort();
}

function copyCampaignHint(hint: CampaignContentHint | null | undefined): CampaignContentHint | null {
  if (hint == null) return null;
  return {
    operation: hint.operation,
    layout: hint.layout,
    reinforcementUnits: stable(hint.reinforcementUnits),
    evaLines: stable(hint.evaLines),
    effectKinds: stable(hint.effectKinds),
  };
}

function copySeed(value: ContentClosureSeed): ContentClosureSeed {
  return {
    ...value,
    factions: [...new Set(value.factions)].sort((a, b) => a - b),
    campaign: copyCampaignHint(value.campaign),
  };
}

function buildScopes(value: ContentClosureSeed): readonly ContentScope[] {
  const out: ContentScope[] = [];
  const factions = [...new Set(value.factions)].sort((a, b) => a - b);
  for (const faction of factions) {
    const opening = value.opening === 'mcv' ? 'MCV, escort and deploy target' : 'opening force/base';
    out.push(
      {
        pattern: `content/opening/${value.opening}/${faction}/units`,
        reason: 'scenario opening unit root',
      },
      {
        pattern: `content/opening/${value.opening}/${faction}/buildings`,
        reason: 'scenario opening/deploy building root',
      },
      {
        pattern: `content/transitive/${faction}/refinery-harvester`,
        reason: 'refinery completion can spawn a free harvester',
      },
      {
        pattern: `content/transitive/${faction}/emergency-mcv`,
        reason: 'recovery systems can restore construction capability',
      },
      { pattern: `art/unit/${faction}/**`, reason: `${opening}; complete reachable faction roster` },
      { pattern: `art/building/${faction}/**`, reason: `${opening}; construction and capture states` },
      { pattern: `art/wreck/${faction}/**`, reason: 'unit deaths and building rubble' },
      { pattern: `audio/bark/${faction}/**`, reason: 'occupied-faction unit responses' },
    );
    if (value.naval) {
      out.push({ pattern: `art/naval/${faction}/**`, reason: 'selected map has reachable sea production' });
    }
  }
  out.push(
    { pattern: 'provider/**', reason: 'required registry/provider participation' },
    { pattern: 'render-binding/**', reason: 'exact entity presentation registry bindings' },
    { pattern: 'art/building/0/**', reason: 'neutral and civilian structures' },
    { pattern: 'art/wreck/0/**', reason: 'neutral and legacy scenario wrecks' },
    { pattern: 'art/neutral-prop/**', reason: 'scenario props, pickups and neutral blockers' },
    { pattern: `art/environment/${value.map}/**`, reason: 'selected map presentation' },
    { pattern: 'pool/vfx/**', reason: 'reachable weapon, construction, death and ability effects' },
    { pattern: 'audio/sfx/**', reason: 'reachable combat, construction and interface cues' },
    { pattern: 'audio/eva/common/**', reason: 'match-state announcer lines' },
  );
  const campaign = value.campaign;
  if (value.mode === 'replay') {
    out.push({
      pattern: `content/replay/header/v${value.replayFormat ?? 0}`,
      reason: 'recorded factions, map and opening own playback closure',
    });
  }
  if (campaign != null) {
    out.push({
      pattern: `content/campaign/${campaign.operation}/layout/${campaign.layout}`,
      reason: 'armed campaign opening layout',
    });
    for (const key of campaign.reinforcementUnits) {
      out.push({
        pattern: `content/campaign/${campaign.operation}/reinforcement/${key}`,
        reason: 'spawnUnits effect in an armed trigger branch',
      });
    }
    for (const line of campaign.evaLines) {
      out.push({ pattern: `audio/eva/campaign/${line}`, reason: 'armed campaign EVA effect' });
    }
    for (const effect of campaign.effectKinds) {
      out.push({
        pattern: `content/campaign/${campaign.operation}/effect/${effect}`,
        reason: 'reachable campaign trigger effect',
      });
    }
  }
  return out.sort((a, b) => a.pattern.localeCompare(b.pattern));
}

function matches(pattern: string, key: string): boolean {
  return pattern.endsWith('/**') ? key.startsWith(pattern.slice(0, -2)) : pattern === key;
}

function inPlan(key: string): boolean {
  return seed === null || scopes.some((scope) => matches(scope.pattern, key));
}

function recordMiss(miss: ContentMiss): void {
  const identity = `${miss.phase}\u0000${miss.reason}\u0000${miss.owner}\u0000${miss.key}`;
  if (missKeys.has(identity)) return;
  missKeys.add(identity);
  misses.push(miss);
  if (!DEV) return;
  const method = miss.phase === 'post-reveal' ? 'error' : 'warn';
  console[method](
    `[content-closure] ${miss.phase} ${miss.reason}: ${miss.key} `
    + `(owner ${miss.owner}, state ${miss.state}); packaged fallback remains enabled`,
  );
}

function revealReadyFor(
  rows: Iterable<Pick<MutableDelivery, 'critical' | 'state'>>,
): boolean {
  if (revealRejected || misses.some((miss) => miss.phase === 'boot')) return false;
  for (const row of rows) {
    if (row.critical && row.state !== 'ready' && row.state !== 'fallback-ready') return false;
  }
  return true;
}

/** Campaign chunk contribution. Cleared whenever that operation is disarmed. */
export function setCampaignContentHint(value: CampaignContentHint | null): void {
  campaignHint = copyCampaignHint(value);
}

export function plannedCampaignContentHint(): CampaignContentHint | null {
  return copyCampaignHint(campaignHint);
}

/** Install the semantic roots for the next boot. Null is a conservative broad plan. */
export function setContentClosureSeed(value: ContentClosureSeed | null): void {
  seed = value === null ? null : copySeed(value);
  scopes = seed === null ? [] : buildScopes(seed);
  resetContentClosureRuntime();
}

/** Install a broad direct-bootstrap plan only when the shell has not supplied one. */
export function ensureContentClosureSeed(value: ContentClosureSeed): void {
  if (seed === null) setContentClosureSeed(value);
}

/**
 * Admit one explicitly requested development-tool content family after reveal.
 *
 * Production systems must never call this: their complete reachable graph is
 * fixed by `ContentClosureSeed`. The Cheat Engine is different by design — it
 * can ask for a faction that has no seat in the running match. Keeping this
 * extension both DEV-gated and pattern-scoped preserves the production closure
 * invariant while letting that local tool prepare real art before it spawns.
 */
export function allowDevRuntimeContentScope(pattern: string, reason: string): void {
  if (!DEV || scopes.some((scope) => scope.pattern === pattern)) return;
  scopes = [...scopes, { pattern, reason }].sort((a, b) => a.pattern.localeCompare(b.pattern));
}

export function contentClosureEpoch(): number {
  return runtimeEpoch;
}

/** A new world lifetime keeps its plan but owns fresh delivery/readiness state. */
export function resetContentClosureRuntime(): void {
  runtimeEpoch++;
  revealed = false;
  revealRejected = false;
  deliveries.clear();
  misses.length = 0;
  missKeys.clear();
  if (seed === null) return;
  const providers = [
    ...seed.factions.flatMap((faction) => [
      `provider/art-unit/${faction}`,
      `provider/art-building/${faction}`,
    ]),
    'provider/art-wrecks',
    'provider/neutral-props',
    'provider/environment',
    'provider/vfx',
    'provider/audio',
    ...(seed.campaign === null || seed.campaign === undefined
      ? []
      : ['provider/campaign-validation']),
    ...(seed.mode === 'replay' ? ['provider/replay-validation'] : []),
  ];
  for (const key of providers) {
    declareContentDelivery({ key, owner: 'content-closure', critical: true });
  }
  // Every exact logical root is an obligation. It becomes ready only when the
  // providers that can fulfil it report in below; listing a root can therefore
  // never make its own readiness proof pass.
  for (const scope of scopes) {
    if (!scope.pattern.startsWith('content/') || scope.pattern.endsWith('/**')) continue;
    declareContentDelivery({ key: scope.pattern, owner: 'content-closure', critical: true });
  }
  resolveLogicalRoots();
}

/** Non-vacuity latch: every planned registry/provider must explicitly arrive. */
export function markContentProviderReady(provider: string, expectedEpoch?: number): void {
  if (seed === null) return;
  if (expectedEpoch !== undefined && expectedEpoch !== runtimeEpoch) return;
  setContentDeliveryState(`provider/${provider}`, 'ready', expectedEpoch);
  resolveLogicalRoots();
}

function providerReady(provider: string): boolean {
  return deliveries.get(`provider/${provider}`)?.state === 'ready';
}

function allFactionProviders(domain: 'art-unit' | 'art-building'): boolean {
  return seed !== null && seed.factions.every((faction) => providerReady(`${domain}/${faction}`));
}

function baselineProvidersReady(): boolean {
  return allFactionProviders('art-unit')
    && allFactionProviders('art-building')
    && ['art-wrecks', 'neutral-props', 'environment', 'vfx', 'audio'].every(providerReady)
    && (seed?.mode !== 'replay' || providerReady('replay-validation'))
    && (seed?.campaign == null || providerReady('campaign-validation'));
}

function resolveLogicalRoots(): void {
  if (seed === null) return;
  for (const delivery of deliveries.values()) {
    if (!delivery.key.startsWith('content/') || delivery.state === 'ready') continue;
    const opening = /^content\/opening\/[^/]+\/(\d+)\/(units|buildings)$/.exec(delivery.key);
    if (opening !== null) {
      const domain = opening[2] === 'units' ? 'art-unit' : 'art-building';
      if (providerReady(`${domain}/${opening[1]}`)) delivery.state = 'ready';
      continue;
    }
    const transitive = /^content\/transitive\/(\d+)\/(.+)$/.exec(delivery.key);
    if (transitive !== null) {
      const faction = transitive[1];
      const unitReady = providerReady(`art-unit/${faction}`);
      const buildingReady = providerReady(`art-building/${faction}`);
      if (unitReady && buildingReady) delivery.state = 'ready';
      continue;
    }
    if (delivery.key.startsWith('content/replay/')) {
      if (baselineProvidersReady()) delivery.state = 'ready';
      continue;
    }
    if (delivery.key.includes('/reinforcement/')) {
      if (allFactionProviders('art-unit')) delivery.state = 'ready';
      continue;
    }
    if (delivery.key.includes('/effect/eva') || delivery.key.includes('/effect/dialogue')) {
      if (providerReady('audio')) delivery.state = 'ready';
      continue;
    }
    if (delivery.key.startsWith('content/campaign/') && baselineProvidersReady()) {
      delivery.state = 'ready';
    }
  }
}

/** Declare one exact semantic delivery before requesting it. */
export function declareContentDelivery(value: ContentDeliveryDeclaration): void {
  if (!inPlan(value.key)) {
    recordMiss({
      key: value.key, owner: value.owner, phase: revealed ? 'post-reveal' : 'boot',
      reason: 'outside-plan', state: 'missing',
    });
  }
  const previous = deliveries.get(value.key);
  if (previous !== undefined) {
    previous.critical ||= value.critical !== false;
    if (previous.fallback === '' && value.fallback !== undefined) previous.fallback = value.fallback;
    return;
  }
  deliveries.set(value.key, {
    key: value.key,
    owner: value.owner,
    critical: value.critical !== false,
    fallback: value.fallback ?? '',
    state: 'pending',
    requests: 0,
    firstRequestPhase: null,
  });
}

export function setContentDeliveryState(
  key: string, state: ContentState, expectedEpoch?: number,
): void {
  if (expectedEpoch !== undefined && expectedEpoch !== runtimeEpoch) return;
  const delivery = deliveries.get(key);
  if (delivery === undefined) {
    recordMiss({
      key, owner: 'unregistered-state-writer', phase: revealed ? 'post-reveal' : 'boot',
      reason: 'undeclared', state: 'missing',
    });
    return;
  }
  if (state === 'fallback-ready' && delivery.fallback === '') {
    delivery.fallback = 'packaged procedural fallback';
  }
  delivery.state = state;
}

/**
 * Record a real loader/registry request. False is diagnostic only: callers keep
 * their packaged fallback rather than turning a manifest mistake into a crash.
 */
export function requestContentDelivery(
  key: string, owner: string, expectedEpoch?: number,
): boolean {
  if (expectedEpoch !== undefined && expectedEpoch !== runtimeEpoch) return false;
  const phase = revealed ? 'post-reveal' : 'boot';
  if (!inPlan(key)) {
    recordMiss({ key, owner, phase, reason: 'outside-plan', state: 'missing' });
    if (DEV && revealed) throw new Error(`[content-closure] undeclared post-reveal request: ${key}`);
    return false;
  }
  const delivery = deliveries.get(key);
  if (delivery === undefined) {
    recordMiss({ key, owner, phase, reason: 'undeclared', state: 'missing' });
    if (DEV && revealed) throw new Error(`[content-closure] undeclared post-reveal request: ${key}`);
    return false;
  }
  delivery.requests++;
  delivery.firstRequestPhase ??= phase;
  if (revealed && delivery.critical
    && delivery.state !== 'ready' && delivery.state !== 'fallback-ready') {
    recordMiss({ key, owner, phase, reason: 'not-ready', state: delivery.state });
    if (DEV) throw new Error(`[content-closure] post-reveal request is not ready: ${key}`);
    return false;
  }
  return true;
}

/** Reveal gate: critical content must be real or have an explicit ready substitute. */
export function markContentClosureRevealed(): boolean {
  // A loader or render lookup that missed during boot remains a failed reveal
  // even if a coarse provider latch subsequently arrived. This is the exact
  // case that used to manufacture a hazard placeholder during renderOnce and
  // then let the loading curtain lift because the art module itself ran.
  const ready = revealReadyFor(deliveries.values());
  for (const delivery of deliveries.values()) {
    if (!delivery.critical || delivery.state === 'ready' || delivery.state === 'fallback-ready') continue;
    recordMiss({
      key: delivery.key, owner: delivery.owner, phase: 'reveal-gate',
      reason: 'not-ready', state: delivery.state,
    });
  }
  if (!ready) revealRejected = true;
  revealed = true;
  return ready;
}

export function contentClosureReport(): ContentClosureReport {
  const rows: ContentDeliveryReport[] = [...deliveries.values()]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((value) => ({ ...value }));
  return {
    seed: seed === null ? null : copySeed(seed),
    broadFallback: seed === null,
    revealed,
    scopes: scopes.map((scope) => ({ ...scope })),
    deliveries: rows,
    misses: misses.map((miss) => ({ ...miss })),
    revealReady: revealReadyFor(rows),
  };
}

export type ArtAssetDomain = 'unit' | 'building' | 'wreck' | 'neutral-prop' | 'environment';
export type ArtAssetPart = 'lod0' | 'lods' | 'shadow-proxy' | 'construction';

/** Declare the LOD0/LOD/shadow family, plus construction state for buildings. */
export function declareArtAssetFamily(options: {
  readonly domain: ArtAssetDomain;
  readonly faction?: number;
  readonly map?: string;
  readonly key: string;
  readonly owner: string;
  readonly fallback: string;
}): readonly string[] {
  const root = options.domain === 'environment'
    ? `art/environment/${options.map ?? 'unknown'}/${options.key}`
    : options.domain === 'neutral-prop'
      ? `art/neutral-prop/${options.key}`
      : `art/${options.domain}/${options.faction ?? 0}/${options.key}`;
  const parts = options.domain === 'building'
    ? ['lod0', 'lods', 'shadow-proxy', 'construction']
    : ['lod0', 'lods', 'shadow-proxy'];
  const keys = parts.map((part) => `${root}/${part}`);
  for (const key of keys) {
    declareContentDelivery({ key, owner: options.owner, fallback: options.fallback });
  }
  return keys;
}

/**
 * Publish an approved substitute only after its mesh/geometry registration has
 * actually succeeded. Merely naming a procedural fallback is not evidence that
 * its generator survived this boot.
 */
export function markArtAssetFamilyFallbackReady(
  keys: readonly string[], expectedEpoch?: number,
): void {
  for (const key of keys) setContentDeliveryState(key, 'fallback-ready', expectedEpoch);
}

export function requestArtAssetFamily(
  keys: readonly string[], owner: string, expectedEpoch?: number,
): void {
  for (const key of keys) requestContentDelivery(key, owner, expectedEpoch);
}

export function markArtAssetFamilyReady(
  keys: readonly string[], expectedEpoch?: number,
  parts: readonly ArtAssetPart[] = ['lod0'],
): void {
  const wanted = new Set(parts);
  for (const key of keys) {
    const part = key.slice(key.lastIndexOf('/') + 1) as ArtAssetPart;
    if (wanted.has(part)) setContentDeliveryState(key, 'ready', expectedEpoch);
  }
}
