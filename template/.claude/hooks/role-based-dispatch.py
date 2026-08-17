#!/usr/bin/env python3
"""Every dispatch names a role, and only the orchestrator dispatches.

Two rules, both of which are easy to violate by hand in a single session:

1. **A dispatch must name a project role.** Omitting `subagent_type` silently
   yields `general-purpose`, which carries `*` — EVERY tool, including `Agent`
   itself. This happens most often as a workaround: `builder` +
   `isolation: "worktree"` sandboxes the agent into a worktree forked from the
   default branch when the code lives on a feature branch, and the quick fix is
   to drop `subagent_type`. That silently trades away the whole least-privilege
   boundary — those agents hold `Agent` and can each spawn their own swarm, and
   none of them receives the `builder` role prompt ("stop and report on
   ambiguity", "never touch git", "verify your own work"), all of which then has
   to be re-specified by hand in every brief.

   The correct dispatch is `subagent_type: "builder"` with NO `isolation`,
   pointing at a pre-staged worktree by absolute path: an un-isolated builder
   can write anywhere, and only the `isolation` flag sandboxes it.

2. **Only the orchestrator holds `Agent`.** `.claude/agents/*` already encodes
   this — no role but `orchestrator` lists the tool — but a built-in type
   (`general-purpose`, `claude`) carries `*` and bypasses those files entirely.
   This closes it at the boundary and caps nesting at the same time.

  emit deny -> block, with the reason shown to the caller
  exit 0    -> allow

Fails OPEN on an unreadable payload: this hook exists to catch an orchestrator's
own slip, not to be a security boundary. `orchestrator-only-git.sh` and
`permissions.deny` remain the actual boundaries, and both key on `agent_id`
rather than on agent type.
"""
import json
import re
import sys
import unicodedata


def norm(value):
    """The ENGINE's own normalizer, transcribed from Claude Code 2.1.224.

    The subagent resolver does an exact `agentType` lookup and, ON MISS, falls
    back to a normalized match:

        Fyr = e => e.normalize("NFKC").toLowerCase()
                    .replace(/[\p{White_Space}\p{Pd}_]+/gu, "")

    So "General-Purpose", "GENERAL_PURPOSE", "general purpose" and an en-dash
    variant all collapse to "generalpurpose" and resolve to the `*`-toolset
    built-in. An exact-string check misses every one of them — verified against
    the real resolver, not inferred.
    """
    folded = unicodedata.normalize("NFKC", value).lower()
    # \p{Pd} is the Unicode dash-punctuation category; enumerate its members
    # rather than relying on `re`'s ASCII-only \W.
    return re.sub(r"[\s\u2010-\u2015\u2212\-_]+", "", folded)


# An ALLOWLIST, not a denylist. A denylist of the two known catch-alls cannot
# cover the next built-in that ships carrying `*`; an allowlist fails closed on
# anything unrecognised. Explore and Plan are included deliberately: both carry
# `disallowedTools: [Agent, ...]`, so they are legitimately roleless AND cannot
# dispatch.
# There is deliberately no "orchestrator" entry: the orchestrator IS the main
# thread. Dispatching one would put a second orchestrator at L2 holding both
# `Agent` and git — spawning its own subagents (breaching the 3-level cap) and
# running git from below the main thread. `orchestrator-only-git.sh` blocks git
# writes from any subagent anyway, so it could never do the job that defines it.
# Omitting it here makes that a denial rather than an unresolvable agent type.
#
# `planner` is the sanctioned way to get the PLAN move onto a pinned
# max-reasoning model without reintroducing that second orchestrator: it is NOT
# in DISPATCHING_ROLES and holds no Agent or write tools, so it returns a plan
# and the main thread executes it.
ALLOWED_TYPES = {norm(t) for t in (
    "architect", "auditor", "builder", "code-reviewer", "frontend-designer",
    "performance-reviewer", "planner", "pr-test-analyzer", "qa-tester",
    "reviewer", "security-reviewer", "silent-failure-hunter", "task-manager",
    "Explore", "Plan",
)}

# The one role designed to fan out. CLAUDE.md caps nesting at 3 levels
# (orchestrator -> subagent -> at most one more), and this is the tier that
# spends the middle level deliberately.
DISPATCHING_ROLES = {"orchestrator"}


def deny(reason):
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "deny",
        "permissionDecisionReason": reason,
    }}))
    sys.exit(2)


def main():
    try:
        payload = json.load(sys.stdin)
    except Exception:
        sys.exit(0)
    if not isinstance(payload, dict) or payload.get("tool_name") != "Agent":
        sys.exit(0)

    tool_input = payload.get("tool_input")
    if not isinstance(tool_input, dict):
        sys.exit(0)

    subagent_type = tool_input.get("subagent_type")
    agent_id = payload.get("agent_id")
    agent_type = payload.get("agent_type") or "a subagent"

    # Rule 2 — only the orchestrator dispatches.
    if agent_id and agent_type not in DISPATCHING_ROLES:
        deny(
            f"Blocked: '{agent_type}' is a subagent and may not dispatch other agents. "
            "Only the orchestrator holds Agent (CLAUDE.md, The Delegation Org), which "
            "also caps nesting at 3 levels. Report what you need back to the "
            "orchestrator and let it dispatch."
        )

    # Rule 1 — name a role.
    if not subagent_type:
        deny(
            "Blocked: this dispatch names no subagent_type, so it would run as "
            "'general-purpose', which carries EVERY tool including Agent itself — "
            "no role boundary at all. Name the role that fits the work: builder "
            "(the only tier that writes code), architect, auditor, task-manager, "
            "code-reviewer, security-reviewer, silent-failure-hunter, "
            "pr-test-analyzer, performance-reviewer, frontend-designer, qa-tester, "
            "reviewer. To let a builder edit a pre-staged worktree, use "
            "subagent_type='builder' with NO isolation and give it the absolute "
            "path — only the isolation flag sandboxes it."
        )

    if not isinstance(subagent_type, str) or not subagent_type.strip():
        deny(
            "Blocked: subagent_type must be a non-empty string naming a project role."
        )

    if norm(subagent_type) not in ALLOWED_TYPES:
        deny(
            f"Blocked: '{subagent_type}' is not a project role. The catch-alls "
            "('general-purpose', 'claude', and every normalization-equivalent "
            "spelling of them) carry every tool including Agent, so they cannot "
            "express a role boundary — and they do not receive the role prompt the "
            "work needs (a builder's 'stop and report on ambiguity', 'never touch "
            "git', 'verify your own work'). Pick the role that matches the task: "
            "builder (the only tier that writes code), architect, auditor, "
            "task-manager, code-reviewer, security-reviewer, silent-failure-hunter, "
            "pr-test-analyzer, performance-reviewer, frontend-designer, qa-tester, "
            "reviewer. If none fits, that is worth saying out loud rather than "
            "reaching for the catch-all."
        )

    sys.exit(0)


if __name__ == "__main__":
    main()
