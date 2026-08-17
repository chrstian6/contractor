#!/usr/bin/env python3
"""Pins the dispatch guard's two halves.

`role-based-dispatch.py` is what stops a dispatch from silently running as a
catch-all agent holding every tool (Agent included), and what stops a delegate
from spawning its own agents. Both are easy to break with a one-word edit to a
set literal, and neither fails loudly when broken — the wrong thing simply
succeeds. Hence a test.

Run:  python3 .claude/tests/dispatch-role-matrix.py
"""
import json, os, subprocess, sys

HOOK = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                    "hooks", "role-based-dispatch.py")

cases = [
    # (label, payload, expect_denied)
    ("orchestrator -> builder",
     {"tool_name": "Agent", "tool_input": {"subagent_type": "builder", "prompt": "x"}}, False),
    ("orchestrator -> planner",
     {"tool_name": "Agent", "tool_input": {"subagent_type": "planner", "prompt": "x"}}, False),
    ("orchestrator -> security-reviewer",
     {"tool_name": "Agent", "tool_input": {"subagent_type": "security-reviewer", "prompt": "x"}}, False),
    ("orchestrator -> Explore (builtin, allowed)",
     {"tool_name": "Agent", "tool_input": {"subagent_type": "Explore", "prompt": "x"}}, False),

    # The planner plans the wave but never dispatches it. That is what keeps
    # nesting capped and git in one place, so it must be denied Agent.
    ("planner tries to dispatch its own plan",
     {"tool_name": "Agent", "agent_id": "a1", "agent_type": "planner",
      "tool_input": {"subagent_type": "builder", "prompt": "x"}}, True),
    ("builder tries to dispatch",
     {"tool_name": "Agent", "agent_id": "a1", "agent_type": "builder",
      "tool_input": {"subagent_type": "builder", "prompt": "x"}}, True),

    # A dispatch naming no role would run as general-purpose with every tool.
    ("no subagent_type at all",
     {"tool_name": "Agent", "tool_input": {"prompt": "x"}}, True),
    ("general-purpose catch-all",
     {"tool_name": "Agent", "tool_input": {"subagent_type": "general-purpose", "prompt": "x"}}, True),
    ("unknown role name",
     {"tool_name": "Agent", "tool_input": {"subagent_type": "definitely-not-a-role", "prompt": "x"}}, True),
    ("legit role, odd case: Builder",
     {"tool_name": "Agent", "tool_input": {"subagent_type": "Builder", "prompt": "x"}}, False),
    # Fails OPEN on garbage: this catches an orchestrator's slip, it is not a
    # security boundary, and blocking on unparseable input would strand work.
    ("malformed payload fails open",
     "}{not json", False),
]

failures = 0
for label, payload, expect_denied in cases:
    body = payload if isinstance(payload, str) else json.dumps(payload)
    out = subprocess.run([sys.executable, HOOK], input=body, capture_output=True, text=True).stdout
    denied = '"permissionDecision": "deny"' in out.replace("'", '"') or '"deny"' in out
    ok = denied == expect_denied
    failures += 0 if ok else 1
    print(f"{'ok  ' if ok else 'FAIL'}  {label:<42} expected={'DENY' if expect_denied else 'allow':<5} got={'DENY' if denied else 'allow'}")

print(f"\nFAILURES: {failures}")
sys.exit(1 if failures else 0)
