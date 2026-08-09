---
description: Turn Contractor's blanket auto-approval on, off, or down to read-only.
argument-hint: "[status|on|readonly|off]"
allowed-tools: Bash(.claude/scripts/auto-approve.py *), Bash(python3 .claude/scripts/auto-approve.py *)
---

Run the toggle with the argument the user gave (default to `status` when they
gave none):

```
python3 .claude/scripts/auto-approve.py ${ARGUMENTS:-status}
```

Then report the result in one or two lines:

- **`status`** — say which mode is wired and stop.
- **`on`** — full auto-approval: every tool call is approved without a prompt
  *unless* a `permissions.deny` rule or a guard hook (dangerous commands,
  orchestrator-only git, protected files, build artifacts, secret scan) objects.
  This is the unattended-loop mode. Tell the user the session must be restarted
  (or `/clear`ed) for the hook change to take effect, and that
  `CLAUDE_AUTO_APPROVE=0` in the environment disables it without editing
  anything.
- **`readonly`** — the narrow mode: only provably read-only calls skip the
  prompt; everything that writes still asks.
- **`off`** — back to normal permission prompts.

Do not edit `.claude/settings.json` by hand to do this — the script is the
supported path, and the settings file is write-protected for agents.
