# Studio-agent setup validation

Date: 2026-09-02. Scope: `.codex/`, studio guide, entry-point links and offline validator.

## Result

28 role files created: 4 Luna, 21 Terra and 3 Sol; 9 read-only defaults and 19 workspace-write
defaults. Every role uses medium/high effort, on-request approval defaults, no child delegation
and disabled outbound workspace shell networking. These are requested defaults, not a claim about
the active desktop's enforcement.

## Checks performed

| Check | Observed result |
| --- | --- |
| `py -3 tools/check-studio-agents.py` | PASS: 28 profiles, defaults, document references and role table agree |
| `py -3 tools/check-studio-agents.py --self-test` | PASS: 15 malformed/unsafe in-memory controls rejected |
| Independent configuration review | No concrete scope, role-table or permission-claim defects found |
| Independent validator review and rerun | PASS; no concrete defects found |
| `git diff --check -- AGENTS.md docs/CODEX_HANDOFF.md` | PASS |
| Installed client | `codex-cli 0.152.1` |
| Bundled model catalog | All three selected model IDs support medium/high; no inference call made |
| Native app-server strict startup + `config/read` | PASS: enabled project layer; agents enabled, three children, Luna/medium defaults |
| `codex debug prompt-input` | JSON rendered; four sampled specialist names absent, so this does NOT prove native profile discovery |

The read-only native probe launched `codex app-server --stdio --strict-config`, sent `initialize`
with a validation-client name, then `initialized`, then:

```json
{"id":2,"method":"config/read","params":{"cwd":"C:/Users/Administrator/projects/voltmarch","includeLayers":true}}
```

Only whitelisted agent defaults and enabled/disabled layer status were printed. No raw user config,
credentials, thread, model turn, connector call or publication was involved. The temporary probe
process was stopped after its response. Generated protocol schemas remain in ignored
`.codex-artifacts/studio-schema/`; they are diagnostic output, not a project dependency.

An attempted `codex --strict-config debug models --bundled` was rejected because that subcommand
does not support strict-config. Help output is not parsing evidence. The successful app-server
probe above is the actual native configuration check.

## Limits and handoff

- Actual native selection of each custom profile and effective child sandbox enforcement are not
  verified by these checks. Use the guide's prompt-transfer fallback for the current desktop tool.
- This desktop task was unrestricted with approvals disabled; adding files did not change that mode.
  Use a verified read-only parent/session if a real read-only boundary is required.
- Model choices are reasoned defaults, not per-role performance/cost benchmarks. Evaluate them on
  representative work and record rework/acceptance before tuning the roster.
- No game build, renderer benchmark or gameplay test was needed for these configuration/docs and
  offline-tool changes. There is no new game import, boot work or frame-loop cost. WASM/workers/GPU
  compute are not appropriate for a tiny offline TOML check.
- Origin was fetched; HEAD and origin/main matched `e6c49c62503e591108f2c68e4892095865faac86`
  before editing. Other tasks continued changing game/menu/foliage/release files while this work ran.
  Those changes were not part of this task. The only handoff edit here is the studio source-map row.
- No commit, push, tag, release, paid asset call or host/plugin permission change was performed.

Research and current configuration sources are linked in `docs/STUDIO_WORKFLOW.md`.
