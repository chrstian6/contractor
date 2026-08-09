#!/usr/bin/env python3
"""Turn Contractor's blanket auto-approval on or off.

Auto-approval wires `.claude/hooks/auto-approve-all.py` as a `matcher: "*"`
PreToolUse hook, which suppresses the permission prompt for anything the deny
rules and the guard hooks don't object to. That is what lets an unattended loop
run without stalling on a prompt nobody is watching — and it is off by default,
because it is a real change in posture.

  auto-approve.py status   what is currently wired (exit 0 = on, 1 = off)
  auto-approve.py on       wire it (full auto-approval)
  auto-approve.py readonly wire the narrower auto-approve-readonly.py instead
  auto-approve.py off      unwire it (back to the normal permission prompts)

What stays true in every mode: `permissions.deny` and the guard hooks
(dangerous commands, orchestrator-only git, protected files, build artifacts,
secret scan) remain authoritative. The engine evaluates deny rules AFTER a hook
returns `allow`, and hook aggregation is deny-monotonic, so a guard's `deny`
always beats an auto-approval's `allow`. Auto-approval removes the prompt; it
does not remove the boundary.

Kill switch without editing anything: `CLAUDE_AUTO_APPROVE=0` in the environment
makes the hook defer every call.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CLAUDE_DIR = os.path.dirname(HERE)
SETTINGS = os.path.join(CLAUDE_DIR, "settings.json")

MODES = {
    "on": ("auto-approve-all.py", "Auto-approving (deny rules + guards enforced)..."),
    "readonly": ("auto-approve-readonly.py", "Auto-approving read-only calls..."),
}
HOOK_FILES = {script for script, _ in MODES.values()}


def load():
    if not os.path.exists(SETTINGS):
        sys.exit(f"✗ No {SETTINGS} — run this from a repo with Contractor installed.")
    with open(SETTINGS) as fh:
        return json.load(fh)


def save(settings):
    with open(SETTINGS, "w") as fh:
        json.dump(settings, fh, indent=2)
        fh.write("\n")


def entries(settings):
    return settings.setdefault("hooks", {}).setdefault("PreToolUse", [])


def current(settings):
    """The auto-approve script currently wired, or None."""
    for entry in entries(settings):
        for hook in entry.get("hooks", []):
            for script in HOOK_FILES:
                if script in hook.get("command", ""):
                    return script
    return None


def strip(settings):
    """Remove every auto-approve hook, and any entry left empty by that."""
    kept = []
    for entry in entries(settings):
        hooks = [
            h for h in entry.get("hooks", [])
            if not any(s in h.get("command", "") for s in HOOK_FILES)
        ]
        if hooks:
            entry["hooks"] = hooks
            kept.append(entry)
        elif not entry.get("hooks"):
            kept.append(entry)
    settings["hooks"]["PreToolUse"] = kept


def wire(settings, mode):
    script, message = MODES[mode]
    strip(settings)
    entries(settings).append({
        "matcher": "*",
        "hooks": [{
            "type": "command",
            "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/" + script,
            "timeout": 60,
            "statusMessage": message,
        }],
    })
    # acceptEdits keeps file edits flowing too; the hook only covers tool calls
    # that reach the permission prompt.
    settings.setdefault("permissions", {})["defaultMode"] = "acceptEdits"


def main():
    action = (sys.argv[1] if len(sys.argv) > 1 else "status").lower()
    settings = load()
    active = current(settings)

    if action == "status":
        if active == "auto-approve-all.py":
            print("auto-approve: ON (full) — every call auto-approved unless a deny rule or guard hook objects.")
        elif active == "auto-approve-readonly.py":
            print("auto-approve: ON (read-only) — only provably read-only calls are auto-approved.")
        else:
            print("auto-approve: OFF — normal permission prompts.")
        sys.exit(0 if active else 1)

    if action == "off":
        strip(settings)
        settings.get("permissions", {}).pop("defaultMode", None)
        save(settings)
        print("✓ auto-approve OFF — normal permission prompts restored.")
        sys.exit(0)

    if action in MODES:
        wire(settings, action)
        save(settings)
        label = "full" if action == "on" else "read-only"
        print(f"✓ auto-approve ON ({label}). Deny rules and guard hooks still apply.")
        print("  Restart the session (or /clear) for the hook change to take effect.")
        sys.exit(0)

    sys.exit(f"usage: {os.path.basename(sys.argv[0])} [status|on|readonly|off]")


if __name__ == "__main__":
    main()
