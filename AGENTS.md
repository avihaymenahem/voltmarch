# VOLTMARCH agent entry point

Before changing this repository:

1. Read `CLAUDE.md` completely. Its architecture, hard rules, deployment topology and recorded
   failure modes apply to every coding agent despite the historical filename.
2. Read `docs/CODEX_HANDOFF.md` for the current release snapshot, installed host-level skills and
   plugins, user collaboration preferences, paid-asset workflow and source-of-truth map.
3. Read `TODO.md` for outstanding work only, then open the owning workstream document linked by the
   handoff.
4. Fetch `origin`, inspect the worktree and preserve unrelated changes before editing.

Do not copy credentials, API keys, private SSH material or deployment webhooks into tracked files.

## Persistent collaboration and performance rules

These rules apply to every task and every agent working in this repository:

1. At the start of each task, decide whether delegation is useful and record the decision. If
   sub-agents are used, assign each one a single explicit role (for example researcher, analyzer,
   coder or performance investigator) and keep the scope of that role bounded. Use the smaller
   available model by default for focused sub-agent work; reserve the top-tier model for work that
   genuinely needs it. If delegation tools are unavailable or the task is small/document-only,
   explicitly choose zero sub-agents rather than forcing a split.
2. Before changing code, ask whether CPU work can use WASM, whether worker execution can keep work
   off the main thread, and whether WebGPU compute is appropriate for render-owned work. These are
   performance questions, not automatic prescriptions: preserve lockstep determinism and measure
   dispatch/transfer overhead before moving simulation or small hot paths off-thread.
3. For every code change, assess boot-time and in-game frame-time impact before implementation.
   Prefer bounded, lazy, staged or prewarmed work where it protects first paint and interaction;
   run the proportional performance gate afterward and retain evidence for any tradeoff.
4. Treat a crowded context window as a signal to narrow the current investigation or offload a
   bounded question to a small sub-agent. Do not load large unrelated documents or datasets into
   the main reasoning path when a targeted search or delegated role will answer the question.
