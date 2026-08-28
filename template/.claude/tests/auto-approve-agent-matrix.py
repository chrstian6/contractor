#!/usr/bin/env python3
"""Pins auto-approve-all.py's handling of Agent dispatches.

Two defects this file exists to catch, both found on 2026-08-28:

  1. `Agent(general-purpose)` / `Agent(claude)` in permissions.deny name a
     SUBAGENT TYPE. With no branch modelling that, every Agent call fell to the
     unmodelled-tool catch-all and deferred -- so a project in `auto-approve
     all` mode prompted on every delegation, which is the one thing that mode
     exists to prevent.

  2. GUARDS carried no `Agent` entry, so this hook answered `allow` for a role
     role-based-dispatch.py denies. Still blocked downstream (deny is
     monotonic), but the file's contract is that what it approves is a SUBSET
     of what the engine allows.

Run: python3 .claude/tests/auto-approve-agent-matrix.py
"""
import json
import os
import subprocess
import sys

HOOK = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                    "..", "hooks", "auto-approve-all.py")

# (label, subagent_type payload, expect_allow)
CASES = [
    ("real role is approved",        {"subagent_type": "builder", "prompt": "go"}, True),
    ("denied catch-all defers",      {"subagent_type": "general-purpose"},         False),
    ("odd folding still denied",     {"subagent_type": "General_Purpose"},         False),
    ("en-dash spelling denied",      {"subagent_type": "general–purpose"},    False),
    ("unknown role defers",          {"subagent_type": "notarole"},                False),
    ("missing subagent_type defers", {"prompt": "go"},                             False),
]

failures = 0
for label, tool_input, want_allow in CASES:
    payload = {"tool_name": "Agent", "tool_input": tool_input}
    done = subprocess.run([sys.executable, HOOK], input=json.dumps(payload),
                          capture_output=True, text=True)
    got_allow = '"allow"' in done.stdout
    ok = got_allow == want_allow
    failures += not ok
    print("%-5s %-30s expected=%-6s got=%s"
          % ("ok" if ok else "FAIL", label,
             "allow" if want_allow else "defer",
             "allow" if got_allow else "defer"))


# The end-to-end cases above cannot tell the normalizer apart from a plain `==`:
# role-based-dispatch.py's own guard also refuses "General_Purpose", so an exact
# compare here still ends in a defer, via the second layer rather than this one.
# Verified by mutation on 2026-08-28 -- swapping _norm_role for `==` left every
# case above green. Pin the folding at the unit that owns it.
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "hooks"))
import importlib.util
spec_ = importlib.util.spec_from_file_location("aa", HOOK)
aa = importlib.util.module_from_spec(spec_)
spec_.loader.exec_module(aa)

FOLDING = [
    ("rule_blocks folds underscores", "Agent(general-purpose)", "General_Purpose", True),
    ("rule_blocks folds en-dash",     "Agent(general-purpose)", "general\u2013purpose", True),
    ("rule_blocks folds spaces",      "Agent(general-purpose)", "General Purpose", True),
    ("rule_blocks lets a real role by", "Agent(general-purpose)", "builder", False),
]
for label, rule, subagent, want in FOLDING:
    got = aa.rule_blocks(rule, "Agent", {"subagent_type": subagent})
    ok = got == want
    failures += not ok
    print("%-5s %-34s expected=%-6s got=%s"
          % ("ok" if ok else "FAIL", label, want, got))

print("\nFAILURES: %d" % failures)
sys.exit(1 if failures else 0)
