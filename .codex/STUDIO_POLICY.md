# VOLTMARCH studio operating policy

Applies to the parent coordinator and every specialist. This roster is a set of on-demand roles,
not a company of autonomous employees. The owner sets direction; the parent integrates the work.
Read `docs/STUDIO_WORKFLOW.md` for the roster, dispatch examples and validation procedure.

## Desktop-only scope — every role

VOLTMARCH is a desktop-only game. Mobile is unsupported and out of scope: no phone/tablet UX,
touch-first controls, mobile-specific breakpoints, mobile optimization or mobile QA. Do not add
mobile work to a brief or acceptance matrix. A browser preview is a desktop development surface,
not a mobile product. Validate relevant desktop window sizes/resolutions, keyboard/mouse use and
supported accessibility text scaling. Do not invent a minimum supported resolution or trade away
desktop quality for mobile. Only an explicit owner decision can change this platform scope.

## Authority and onboarding

- Follow root `AGENTS.md`: read `CLAUDE.md` completely, the current handoff, TODO and the owning
  workstream before changing the repository. Already-read inherited context is sufficient unless
  the file changed; a summary is not a substitute for the required complete read.
- Read applicable skills and their required references yourself. Do not delegate skill reading.
  Skill names in a role are routing instructions, not grants of tool access or proof of installation.
- Preserve all pre-existing work. The parent fetches origin and records branch/HEAD/status before
  dispatch; a writing specialist checks its own worktree again before editing. Do not use git stash.
- Resolve conflicting historical claims against current code/tests/workflows and the owning decision
  record. Surface unresolved policy conflicts to the parent; do not silently choose a broader scope.
- A role description does not authorize work. The assignment specifies whether this is research,
  diagnosis, review, implementation or validation, and exactly what may change.
- Do not commit, push, tag, deploy, post, contact players/vendors, moderate accounts, make purchases,
  submit store/ratings forms, change billing, sign contracts or access private player/financial data
  unless the owner explicitly authorized that action and the parent includes the authorization.
- Never put keys, tokens, webhooks, private SSH material or sensitive account data in agent prompts,
  tracked files, terminal output or evidence. Use the approved credential workflow without exposing it.
- Do not change host settings, permissions, installed plugins, models or unrelated tasks as a shortcut.
  If blocked by missing tools/permission, report the smallest needed action and continue safe work.

## Delegation and ownership

1. For a substantial task, delegate a useful independent research, implementation or verification
   slice while the parent advances other work. Small atomic tasks may use zero agents; record why.
2. Select only the needed specialists, normally one or two and at most three simultaneous children
   on this host. The primary is the fourth slot. More roles work in waves, not a larger fan-out.
3. Every child gets one role, a bounded objective, exact writable files/directories (or none),
   exclusions, prerequisite decisions, required tools/skills, acceptance and evidence destination.
4. The parent owns shared contracts and integration. Never give two writers the same files at the
   same time. A role's subject area is not a blanket write permission. Assign narrower scopes.
5. Use a dedicated `codex/` worktree for invasive/long work. Record branch, base SHA and paths.
   Worktrees do not isolate GPU, ports, git refs or external accounts. Do not cherry-pick/reset/move
   someone else's changes without coordinating through the parent.
6. Specialists do not spawn more agents. They return adjacent needs to the parent, which dispatches
   another bounded role if useful. This applies even when runtime settings ignore `[agents] enabled`.
7. Give the cheapest suitable model a bounded job; do not automatically escalate all roles. If a
   role cannot resolve ambiguity, report evidence and the narrower question before escalation.
8. Wait for required results, reconcile contradictions and inspect patches before claiming completion.
   Independent review is required for material code/asset changes; the author is not its only judge.
9. The parent handles GPU/browser ownership. Only one game or GPU-heavy benchmark runs at once unless
   a multiplayer test specifically needs two. Do not stop another task's process. CPU-heavy builds
   must also be scheduled away from timing captures.

## Permission reality

The TOML profiles request either `read-only` or `workspace-write`, `on-request` approvals, and
disabled outbound shell networking in workspace-write. These are defaults, not guarantees:

- Live parent/session permission overrides can take precedence. At creation, this desktop task was
  running unrestricted with approval policy `never`; these files do not change that active mode.
- The currently exposed desktop `collaboration.spawn_agent` has no role-file or sandbox selector.
  Reading a profile into its prompt transfers instructions only. It does not apply TOML permission,
  search-mode or feature settings. See the explicit fallback in the workflow guide.
- Workspace-write does not mean a per-file allowlist. Named write scopes, no-network-tool policies,
  no-spend rules and review boundaries still require agent discipline and parent inspection.
- A filesystem sandbox is not a permission system for connectors, image tools or external accounts.
  Cached/live search choices are separate from shell networking. Available tools remain host-specific.
- For enforced read-only work use a parent/session whose effective mode is read-only and verify it
  before delegating. Do not claim secure separation while the host remains unrestricted.
- No role receives full access as its saved default. A blocked command is not permission to rerun it
  outside the sandbox or weaken settings. Escalate the need to the parent and owner instead.

## Performance and evidence

Before any code change record boot and frame impact (including an explicit no-runtime-impact
assessment for offline tooling). Ask whether WASM, workers or render-owned WebGPU compute fit;
record why they do or do not, including transfer/dispatch overhead and determinism.

Preserve deterministic CPU authority: no wall-clock/random/async-arrival/GPU-dependent simulation
or world generation. Respect zero-allocation hot paths, lazy imports, staged preparation, pools,
instancing and resource disposal. Confirm the current renderer acceptance policy rather than
copying historical parity gates into new work.

Run proportional gates from the owning workstream. Build before bundle tests. Use falsifiers and
negative controls; do not weaken tests to obtain green. For visual work inspect meaningful live
views in addition to fixtures. For performance capture comparable before/after conditions, adapter,
backend, build, seed, camera, quality, resolution, cold/warm state, sample count and uncertainty.
Do not extrapolate one GPU to AMD/Intel or a browser capture to packaged Electron.

Keep evidence beside its owning workstream. Name accepted, rejected and unverified outcomes.
Raw private logs do not belong in tracked files. Update only the relevant decision/provenance
documents; TODO contains genuinely registered open work, not every agent's speculation.

## Art, spend and rights

- VOLTMARCH asset work must use `voltmarch-asset-pipeline`. Read current visual direction and asset
  budgets before generation. Image generation handles bitmap work; Meshy handles approved 3D calls;
  neither replaces local conditioning and live acceptance.
- No new low-poly prop, placeholder or fallback without explicit approval for that specific asset.
- An approved asset batch may already carry standing Meshy authority. The parent must identify that
  batch, named assets, allowed operations and spend ceiling; if no ceiling is known, resolve it before
  a paid call. Do not treat the existence of a model-artist profile as a new purchase authorization.
- One agent owns each paid request and its task ID. Check status before retrying an uncertain call;
  do not submit duplicate generations. Check balance privately and keep a credits ledger.
- Geometry acceptance precedes texture spend. Preserve rejected candidates and reasons in approved
  ignored storage; do not silently revive them. Show milestones at close, RTS and far distances.
- Canonical deliveries stay in `packages/assets/` where that asset family is owned. Keep source/output
  hashes, task IDs, credits, budgets, credits/licensing and conversion-map entries synchronized.
- Owner art acceptance, human playtesting/listening, native-language review and qualified legal/tax
  review cannot be replaced by an agent's self-certification. State missing human evidence plainly.

## Required handoff

Return a compact result with:

1. Outcome: complete, partial or blocked, relative to the assigned objective.
2. Findings/deliverables: exact files, symbols, assets or primary-source links.
3. Changes: files written and why; explicitly state none for advisory roles.
4. Validation: commands/results, negative controls, visual/audio checks and evidence locations.
5. Performance: boot/frame/resource impact or justified not-applicable; measured versus predicted.
6. Risks: untested devices/flows, contradictions, dependencies and next specialist needed.
7. Owner decisions: only choices or new authority genuinely needed to proceed.

The parent verifies and integrates these receipts. A specialist completion is not a release approval.
