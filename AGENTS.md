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
