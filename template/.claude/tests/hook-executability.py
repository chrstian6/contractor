#!/usr/bin/env python3
"""Every wired hook must be executable BY THE KERNEL, not just valid source.

2026-08-28: a patch script rewrote auto-approve-all.py with a leading newline,
so `#!` was at byte 1 instead of byte 0. The kernel then refused the shebang and
fell back to /bin/sh, which parsed the Python module docstring as shell and
failed at the first parenthesis. Every tool call in the session died in the
PreToolUse hook. The file imported fine, compiled fine, and every unit test on
it passed -- because they all ran it as `python3 <file>`. Nothing checked the
one property the engine actually depends on.

Run: python3 .claude/tests/hook-executability.py
"""
import json
import os
import subprocess
import sys

HOOKS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "hooks")
SETTINGS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "settings.json")

failures = 0


def check(label, ok, detail=""):
    global failures
    failures += not ok
    print("%-5s %-52s %s" % ("ok" if ok else "FAIL", label, detail))


wired = set()
with open(SETTINGS) as fh:
    for groups in (json.load(fh).get("hooks") or {}).values():
        for group in groups:
            for hook in group.get("hooks") or []:
                command = str(hook.get("command", ""))
                if "/hooks/" in command:
                    wired.add(command.rsplit("/", 1)[-1].split()[0])

check("settings.json wires at least one hook", bool(wired), "%d wired" % len(wired))

for name in sorted(wired):
    path = os.path.join(HOOKS_DIR, name)
    if not os.path.isfile(path):
        check("%s exists" % name, False, "missing")
        continue
    with open(path, "rb") as fh:
        head = fh.read(2)
    # Byte 0, not "somewhere near the top": the kernel reads exactly these two.
    check("%s has #! at byte 0" % name, head == b"#!", repr(head))
    check("%s is executable" % name, os.access(path, os.X_OK))

    # The property the engine depends on: run it with NO interpreter prefix.
    done = subprocess.run([path], input="{}", capture_output=True, text=True, timeout=30)
    check("%s runs without an interpreter prefix" % name,
          done.returncode in (0, 1, 2) and "syntax error" not in done.stderr,
          (done.stderr.strip().splitlines() or [""])[0][:60])

print("\nFAILURES: %d" % failures)
sys.exit(1 if failures else 0)
