# VOLTMARCH: a solo-owner game studio

Created 2026-09-02. Owner document for specialist delegation; not a game-feature backlog.

You remain studio head, product owner and final creative/release authority. The main Codex agent is
your coordinator and integrator. These 28 profiles cover jobs to call on demand, not 28 agents to
launch together. Each has a bounded remit, preferred model, reasoning effort, permission defaults,
delivery contract and suggested independent reviewer.

Platform scope for all 28 roles: **desktop game only; no mobile support or mobile work**. Do not
delegate phone/tablet layouts, touch UX, mobile optimization or mobile QA. Responsive checks mean
desktop windows/resolutions and accessibility text scaling, not a mobile acceptance target.

## Start using it

Ask naturally in this project's task:

> Use the studio workflow to fix this bug. Pick the relevant developer, have QA prepare an
> independent reproduction, and bring in performance only if the hot path changes.

Or name the roles:

> Have art_director review this approved vehicle concept while technical_artist checks its budget.
> Return their findings before any paid generation.

The parent reads [.codex/STUDIO_POLICY.md](../.codex/STUDIO_POLICY.md), chooses a small squad,
assigns non-overlapping work and integrates the result. Root AGENTS.md requests useful delegation
for substantial tasks. Atomic tasks can still be faster and cheaper with no children.

## The role map

Model names below abbreviate `gpt-5.6-luna`, `gpt-5.6-terra` and `gpt-5.6-sol`.
Read means advisory/source inspection by default. Write permits only the assigned local scope;
it does not authorize implementation for a diagnosis-only request, spending or deployment.

| Profile | Job | Model / effort | Local default | Suggested review |
| --- | --- | --- | --- | --- |
| [producer](../.codex/agents/producer.toml) | Studio producer | luna / medium | Read | technical_director |
| [technical_director](../.codex/agents/technical_director.toml) | Technical director / architect | sol / high | Read | security_reviewer |
| [gameplay_engineer](../.codex/agents/gameplay_engineer.toml) | Gameplay / simulation developer | terra / high | Write | qa_engineer |
| [ai_navigation_engineer](../.codex/agents/ai_navigation_engineer.toml) | Game AI / navigation engineer | terra / high | Write | balance_analyst |
| [multiplayer_engineer](../.codex/agents/multiplayer_engineer.toml) | Multiplayer / protocol engineer | terra / high | Write | security_reviewer |
| [rendering_engineer](../.codex/agents/rendering_engineer.toml) | Graphics / rendering engineer | sol / high | Write | performance_engineer |
| [performance_engineer](../.codex/agents/performance_engineer.toml) | Performance optimizer / investigator | sol / high | Write | qa_engineer |
| [tools_engineer](../.codex/agents/tools_engineer.toml) | Tools / pipeline developer | luna / medium | Write | qa_engineer |
| [ui_engineer](../.codex/agents/ui_engineer.toml) | UI / input developer | terra / medium | Write | ux_accessibility |
| [build_release_engineer](../.codex/agents/build_release_engineer.toml) | Build / desktop / release engineer | terra / high | Write | qa_engineer |
| [security_reviewer](../.codex/agents/security_reviewer.toml) | Security / privacy reviewer | terra / high | Read | technical_director |
| [qa_engineer](../.codex/agents/qa_engineer.toml) | QA / automation engineer | terra / high | Write | technical_director |
| [game_designer](../.codex/agents/game_designer.toml) | Game / systems designer | terra / high | Read | balance_analyst |
| [balance_analyst](../.codex/agents/balance_analyst.toml) | Combat / economy balance analyst | terra / high | Read | game_designer |
| [level_designer](../.codex/agents/level_designer.toml) | Level / campaign designer | terra / high | Write | qa_engineer |
| [narrative_localization](../.codex/agents/narrative_localization.toml) | Narrative / localization editor | terra / medium | Write | ux_accessibility |
| [art_director](../.codex/agents/art_director.toml) | Art director / graphics manager | terra / high | Read | technical_artist |
| [concept_artist](../.codex/agents/concept_artist.toml) | Concept / 2D artist | terra / medium | Write | art_director |
| [model_artist](../.codex/agents/model_artist.toml) | 3D model / environment / unit artist | terra / high | Write | art_director |
| [material_artist](../.codex/agents/material_artist.toml) | Materials / texture artist | terra / medium | Write | technical_artist |
| [animator](../.codex/agents/animator.toml) | Rigging / animation specialist | terra / high | Write | technical_artist |
| [technical_artist](../.codex/agents/technical_artist.toml) | Technical artist / asset integration specialist | terra / high | Write | performance_engineer |
| [vfx_artist](../.codex/agents/vfx_artist.toml) | VFX / lighting-effects artist | terra / high | Write | art_director |
| [audio_designer](../.codex/agents/audio_designer.toml) | Audio / voice / music designer | terra / medium | Write | qa_engineer |
| [ux_accessibility](../.codex/agents/ux_accessibility.toml) | UX / accessibility designer | terra / high | Read | player_researcher |
| [player_researcher](../.codex/agents/player_researcher.toml) | Player research / analytics analyst | luna / medium | Read | game_designer |
| [marketing_community](../.codex/agents/marketing_community.toml) | Marketing / community / support specialist | luna / medium | Write | business_operations |
| [business_operations](../.codex/agents/business_operations.toml) | Business / licensing / publishing operations analyst | terra / high | Read | producer |

The division is deliberate:

- Art director/graphics manager judges visual identity; rendering engineer owns GPU code;
  performance engineer measures cost; technical artist makes accepted assets fit the engine.
- Game designer specifies rules; balance analyst tests assumptions; gameplay engineer implements.
  Game AI/navigation has its own specialist.
- Concept artist makes 2D references; model artist makes named 3D objects; material artist and
  animator own distinct deliverables. Environment, vehicle and character modeling share one profile
  but must be separate asset assignments.
- UI engineering is separate from UX/accessibility review. Narrative and localization share an
  editor; human linguistic QA is still required. Audio covers sound, voice, score integration and mix.
- Build/release engineering owns infrastructure and packaging preparation. Marketing/community owns
  draft communication and support triage. Business operations organizes rights, costs, storefront,
  contractor and compliance questions, not autonomous legal/accounting/publishing decisions.
- QA covers regression automation and live verification; player research covers actual user evidence.
  Security review is independent from the engineer who wrote the feature.

## Default staffing and cost policy

Use one or two children normally, up to three concurrently, leaving the parent working on integration.
There are four total slots on this host at creation. A role list is a menu, not a fan-out instruction.
The project default for unspecified children is Luna/medium; every specialist sets its own pair.

These are starting recommendations, not benchmark-proven winners for VOLTMARCH. Luna handles bounded
production, tools, feedback and communication tasks; Terra covers most implementation/creative work;
Sol/high is reserved for architecture, rendering and causal performance investigations. This follows
the official family's efficiency/balanced/flagship positioning; the per-job assignments are our judgment.
[OpenAI model guidance](https://developers.openai.com/api/docs/guides/latest-model)

Do not escalate on job title alone. Narrow an unresolved question, then try higher effort or the next
model only if needed. Log elapsed time, review rework and accepted results on representative jobs before
changing a default. No guessed dollar prices or automatic paid-generation budget is embedded here.
Image, 3D and voice tools have separate availability and cost from the reasoning model.

## A working task cycle

1. Brief: owner outcome, non-goals, authorization, success criteria and target build.
2. Plan: parent chooses specialists and records scopes, dependencies and GPU ownership.
3. Execute: independent work in parallel; dependent production waits for its input.
4. Verify: another role checks the result; parent reconciles findings and runs the integration gate.
5. Accept: owner decides meaningful creative/product tradeoffs; parent records evidence.
6. Release: a separate explicitly authorized step, with actual workflow/artifact verification.

| Task | First wave | Next wave / acceptance |
| --- | --- | --- |
| Gameplay bug | gameplay_engineer + QA reproduction on separate files | QA regression and parent integration |
| Desync / networking | multiplayer_engineer + security_reviewer | QA peer/replay test; no automatic relay deploy |
| Frame-time regression | performance_engineer captures exclusively; tools_engineer inspects offline | relevant engineer fixes; performance reruns paired control |
| Approved 3D unit | art_director + concept_artist with distinct review/write scopes | model/material/animation as needed, then technical_artist and QA |
| HUD/navigation | ui_engineer + ux_accessibility | QA input/scale checks; owner screenshot review |
| Campaign operation | level_designer + narrative_localization on distinct files | QA playthrough, balance/player feedback |
| Release preparation | build_release_engineer + business_operations + marketing drafts | QA candidate validation, owner publish decision |

Do not run benchmarks while another task builds, renders or uses the GPU. A read-only review may run
alongside a writer, but final review must target a stable patch/commit, not a moving file. If two
specialists need the same file, sequence them or let the parent integrate their recommendations.

### Delegation brief template

```text
Role: <exact profile name>; mode: research | diagnose | implement | validate
Objective: <one bounded outcome>
Inputs: <build/branch, files, references, prior decisions>
Allowed writes: <exact paths, or NONE>
Excluded: <adjacent systems, unrelated changes, external actions>
Constraints: <determinism, budget, compatibility, owner preferences>
Tools/skills: <required and available; no implied installation>
Authorization: <none, or exact owner-approved external/paid action and limit>
Validation: <pass/fail criteria, negative control, target environment>
Evidence: <owning document/artifact destination, or return in response>
Dependencies / GPU ownership: <what must finish first; who may run the game>
Return: <policy handoff contract; no subdelegation>
```

## Native profiles and this desktop's fallback

Standalone TOML files live under `.codex/agents/`. Their `name`, `description` and
`developer_instructions` identify the role; model and effort are explicit. Project
`.codex/config.toml` sets three concurrent children and defaults. Each leaf disables further agent
tools. On a compatible client, start a fresh project session and request the role by name.
[Official custom-agent documentation](https://learn.chatgpt.com/docs/agent-configuration/subagents#custom-agents)

The installed CLI at creation was 0.152.1, but this task's desktop collaboration tool exposed only
task name, message, model, effort and context-fork controls: no custom-role/config-file selector.
The parent must use this fallback when no native selector is exposed:

1. Read the selected TOML completely and extract its instructions and model/effort.
2. Spawn a bounded child with those instructions in the message, including the common policy.
3. Select model/effort explicitly when supported. On this host that requires a fresh or partial
   context fork; a full-history fork inherits model/effort instead.
4. Report unavailable settings. Prompt text does not activate sandbox/search/feature controls.
5. Verify behavior/results. A matching child task name does not prove native profile loading.

Do not invent a `/agent <role>` launcher: CLI `/agent` inspects/switches agent threads.
These files do not create sidebar tasks, recurring jobs, credentials or new tool connections.
Existing sessions may need a fresh session to discover changed configuration.

### Permissions: requested defaults versus enforcement

Every profile requests read-only or workspace-write, on-request approvals and a search mode;
workspace shell networking defaults off. Those are supported configuration keys.
[Configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)

Live parent permission overrides may override saved child defaults. The creating desktop task was
unrestricted with approvals disabled, and remains so; these files do not retrofit isolation.
Use and verify a read-only parent/session when enforcement is required. Connectors have their own
permissions, not filesystem sandbox protection.
[Subagent permission inheritance](https://learn.chatgpt.com/docs/agent-configuration/subagents#approvals-and-sandbox-controls)

No blanket tool allowlist is claimed. Skills/plugins are discovered at use time. Local write scope,
no-spend/no-post instructions and leaf rules are behavioral unless the runtime enforces them.
Steps blocked by effective permissions return to the parent for a scoped decision, never a silent
switch to full access.

## Owner-only decisions and external specialists

Keep vision, scope, final art/game-feel acceptance, priority, budget ceilings, pricing, vendor
engagements, public claims, publishing and release timing with the owner. Agents prepare options and
receipts. Human playtesters, native-language reviewers, voice performers and contractors still provide
evidence or craft an AI agent cannot truthfully claim to have supplied.

Use qualified counsel/accountants for legal/tax conclusions, contracts, company structure and filings.
Business operations organizes questions/provenance; it does not certify rights or compliance.
Store/ratings/disclosure work applies only if that platform is explicitly targeted. Steam and Microsoft
sources below informed coverage; this workflow does not assume VOLTMARCH has enrolled in either.

## Research behind the map

This adapts established disciplines to one owner rather than copying an AAA headcount:

- [ScreenSkills games career map](https://www.screenskills.com/media/xskl5wdb/2756-games-career-map-interactive-feb25-final.pdf)
  distinguishes production, design, programming, technical art, art, animation, audio and QA.
- [Unity production-cycle guide](https://learn.unity.com/tutorial/explore-the-production-cycle?version=2022.3)
  describes gameplay/UI, art, level, animation, VFX, technical-art and QA contributions.
- [Epic profiling guide](https://dev.epicgames.com/documentation/en-us/unreal-engine/introduction-to-performance-profiling-and-configuration-in-unreal-engine)
  supports separate CPU/GPU/memory/frame-time investigation. Unreal tools are examples, not an engine
  migration proposal for this Three.js project.
- [Xbox Accessibility Guidelines](https://learn.microsoft.com/en-us/gaming/accessibility/guidelines)
  informs game-specific accessibility coverage; automated checks are not inclusive playtesting.
- [Steam review process](https://partner.steamgames.com/doc/store/review_process)
  separates storefront claims and build readiness, motivating release and commercial checks.
- [Microsoft publishing readiness](https://learn.microsoft.com/en-us/gaming/game-publishing/publishing-processes/managed-creators/publishing-processes-game-publishing-readiness-checklist)
  covers packages, metadata, ratings, localization and accessibility readiness.

## Validation and maintenance

Run from the repository root with Python 3.11 or newer:

```powershell
py -3 tools/check-studio-agents.py
py -3 tools/check-studio-agents.py --self-test
```

The offline gate parses profiles, checks schema/policy consistency, references, roster links,
model/effort choices and project defaults. Negative controls check malformed and unsafe definitions.
It does not call a model, spend credits or prove host enforcement. Native loading is a separate
client check; record exactly what was observed in the validation receipt.

Initial results and explicit limits: [2026-09-02 validation receipt](reviews/STUDIO_AGENTS_VALIDATION_2026-09-02.md).

For a first real task, run a bounded read-only role, confirm selected model/effective permissions,
inspect the receipt and then try one scoped writer with independent QA. Do not launch all roles as
an activation test. Revisit model choices after representative accepted work, not just model launches.

This change adds configuration, instructions and an offline validator only. No game runtime/import,
boot work, asset generation, simulation scheduling or frame-loop work is added. WASM, workers and GPU
compute offer no useful benefit for this tiny offline validation job.
