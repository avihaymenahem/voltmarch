"""Offline studio-profile consistency gate. Python 3.11+, standard library only.

This checks our deliberately small config subset, not Codex runtime enforcement.
No network, model calls, file writes or game execution. --self-test uses in-memory
negative controls so a green result cannot merely mean every input was accepted.
"""

from __future__ import annotations

import argparse
from collections import Counter
from copy import deepcopy
from pathlib import Path
import re
import sys
import tomllib


ROOT = Path(__file__).resolve().parents[1]
REQUIRED = {
    "name", "description", "developer_instructions", "model",
    "model_reasoning_effort", "sandbox_mode", "approval_policy", "web_search",
    "agents", "sandbox_workspace_write",
}
MODELS = {"gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol"}
DEFAULTS = {
    "enabled": True,
    "max_concurrent_threads_per_session": 3,
    "default_subagent_model": "gpt-5.6-luna",
    "default_subagent_reasoning_effort": "medium",
    "interrupt_message": True,
}


def profile_errors(profile: dict, stem: str, names: set[str]) -> list[str]:
    errors = []
    if set(profile) != REQUIRED:
        errors.append("missing or unsupported profile keys")
    if profile.get("name") != stem or not re.fullmatch(r"[a-z][a-z0-9_]*", stem):
        errors.append("name must match a snake_case filename")
    if profile.get("model") not in MODELS:
        errors.append("model is outside the verified studio selection")
    if profile.get("model_reasoning_effort") not in {"medium", "high"}:
        errors.append("effort is outside the reviewed medium/high defaults")
    if profile.get("sandbox_mode") not in {"read-only", "workspace-write"}:
        errors.append("unsafe or unknown sandbox default")
    if profile.get("approval_policy") != "on-request":
        errors.append("approval default must remain on-request")
    if profile.get("web_search") not in {"cached", "live"}:
        errors.append("search default must be cached or live")
    if profile.get("agents") != {"enabled": False}:
        errors.append("specialists must disable subdelegation")
    if profile.get("sandbox_workspace_write") != {"network_access": False}:
        errors.append("workspace shell networking must default off")
    description = profile.get("description")
    if not isinstance(description, str) or len(description.strip()) < 30:
        errors.append("missing useful routing description")
    instructions = profile.get("developer_instructions")
    if not isinstance(instructions, str):
        return errors + ["developer_instructions must be a string"]
    for marker in (
        ".codex/STUDIO_POLICY.md", "AGENTS.md", "Missing write scope means no edits",
        "No subdelegation", "Never expose secrets", "Deliver:",
        "Suggested independent review:", "State what was not tested",
    ):
        if marker not in instructions:
            errors.append(f"missing policy/delivery marker: {marker}")
    reviewers = re.findall(r"Suggested independent review: ([a-z_]+),", instructions)
    if len(reviewers) != 1 or reviewers[0] not in names or reviewers[0] == stem:
        errors.append("independent reviewer must name another existing role")
    # Check literal Markdown document references, not prose mentions or invented globs.
    for reference in re.findall(r"(?:docs|apps|packages)/[A-Za-z0-9_./-]+\.md", instructions):
        if not (ROOT / reference).is_file():
            errors.append(f"missing document reference: {reference}")
    return errors


def validate() -> tuple[list[str], dict[str, dict]]:
    errors: list[str] = []
    profiles = {}
    for path in sorted((ROOT / ".codex/agents").glob("*.toml")):
        try:
            profiles[path.stem] = tomllib.loads(path.read_text(encoding="utf-8"))
        except (OSError, tomllib.TOMLDecodeError) as error:
            errors.append(f"{path.name}: cannot parse TOML ({type(error).__name__})")
    if len(profiles) != 28:
        errors.append(f"expected the reviewed 28-role roster, found {len(profiles)}")
    names = set(profiles)
    for stem, profile in profiles.items():
        errors.extend(f"{stem}: {error}" for error in profile_errors(profile, stem, names))
    try:
        config = tomllib.loads((ROOT / ".codex/config.toml").read_text(encoding="utf-8"))
        if config != {"agents": DEFAULTS}:
            errors.append("project config differs from reviewed agent-only defaults")
    except (OSError, tomllib.TOMLDecodeError) as error:
        errors.append(f"cannot parse project config ({type(error).__name__})")
    workflow = (ROOT / "docs/STUDIO_WORKFLOW.md").read_text(encoding="utf-8")
    rows = re.findall(
        r"^\| \[([a-z_]+)\]\(\.\./\.codex/agents/([a-z_]+)\.toml\) \|"
        r" [^|]+ \| (luna|terra|sol) / (medium|high) \| (Read|Write) \| ([a-z_]+) \|$",
        workflow, re.MULTILINE,
    )
    if Counter(row[0] for row in rows) != Counter(names):
        errors.append("workflow role table must cover each profile exactly once")
    for name, target, model, effort, permission, reviewer in rows:
        profile = profiles.get(name, {})
        expected = "read-only" if permission == "Read" else "workspace-write"
        if (name != target or profile.get("model") != f"gpt-5.6-{model}"
                or profile.get("model_reasoning_effort") != effort
                or profile.get("sandbox_mode") != expected
                or f"Suggested independent review: {reviewer}," not in profile.get("developer_instructions", "")):
            errors.append(f"{name}: workflow table differs from profile")
    for document in ("AGENTS.md", "docs/CODEX_HANDOFF.md", ".codex/STUDIO_POLICY.md"):
        if "docs/STUDIO_WORKFLOW.md" not in (ROOT / document).read_text(encoding="utf-8"):
            errors.append(f"{document}: missing workflow discovery link")
    return errors, profiles


def self_test(profiles: dict[str, dict]) -> int:
    baseline = profiles["producer"]
    names = set(profiles)
    controls = {
        "unsafe sandbox": ("sandbox_mode", "danger-full-access"),
        "silent approvals": ("approval_policy", "never"),
        "network enabled": ("sandbox_workspace_write", {"network_access": True}),
        "recursive agents": ("agents", {"enabled": True}),
        "unknown model": ("model", "invented-model"),
        "unreviewed effort": ("model_reasoning_effort", "ultra"),
        "bad search": ("web_search", "sometimes"),
        "wrong name": ("name", "other"),
        "wrong instructions type": ("developer_instructions", 42),
        "empty description": ("description", ""),
        "missing policy": ("developer_instructions", "Do anything."),
        "missing reviewer": ("developer_instructions", baseline["developer_instructions"].replace(
            "Suggested independent review: technical_director,", "Suggested independent review: missing_role,")),
    }
    for label, (key, value) in controls.items():
        candidate = deepcopy(baseline)
        candidate[key] = value
        if not profile_errors(candidate, "producer", names):
            raise ValueError(f"negative control accepted: {label}")
    for candidate in ({key: value for key, value in baseline.items() if key != "model"},
                      {**baseline, "permissions": "invented schema"}):
        if not profile_errors(candidate, "producer", names):
            raise ValueError("missing/unknown key negative control accepted")
    try:
        tomllib.loads('name = "duplicate"\nname = "again"')
    except tomllib.TOMLDecodeError:
        pass
    else:
        raise ValueError("duplicate TOML key accepted")
    return len(controls) + 3


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--self-test", action="store_true", help="run in-memory negative controls")
    args = parser.parse_args()
    try:
        errors, profiles = validate()
        if errors:
            for error in errors:
                print(f"FAIL: {error}", file=sys.stderr)
            return 1
        if args.self_test:
            print(f"PASS: {self_test(profiles)} negative controls rejected")
        models = Counter(profile["model"] for profile in profiles.values())
        modes = Counter(profile["sandbox_mode"] for profile in profiles.values())
        print(f"PASS: {len(profiles)} profiles; project defaults, references and role table agree")
        print(f"Models: {dict(sorted(models.items()))}")
        print(f"Permission defaults: {dict(sorted(modes.items()))}")
        print("Offline consistency only; native discovery and effective permissions need separate verification.")
        return 0
    except (OSError, ValueError) as error:
        print(f"FAIL: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
