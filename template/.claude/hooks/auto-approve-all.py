#!/usr/bin/env python3
"""Blanket auto-approval for the unattended loop — the in-repo replacement for Omni.

Omni ran as a `matcher: "*"` PreToolUse hook with `~/.omni/policy.json`
`allGlobal: true`, i.e. it approved every tool call. That made an external
binary a hard dependency of every session: if it was not running, the loop
hung on a prompt nobody was watching. This hook does the same job with no
external process.

  emit allow -> suppresses the prompt
  exit 0     -> defer to the normal permission flow (prompt / deny as usual)

DEFENSE IN DEPTH, NOT THE LAST LINE. Verified against the installed Claude Code
(2.1.223): after a hook returns `allow`, the engine STILL evaluates the rule
engine, and a matching `permissions.deny` overrides the hook ("deny rule
overrides"). Hook aggregation is deny-monotonic too, so any guard hook's own
`deny`/`ask` beats this hook's `allow` whatever the ordering. `permissions.deny`
and the guards therefore remain authoritative on their own.

This hook re-implements both checks anyway, so that what it approves is a subset
of what the engine would allow — an approval it emits should never be a surprise.
Do NOT read that as "the deny list is enforced here": it is enforced downstream,
and a gap in this file degrades precision, it does not open a bypass. Before
approving anything it:

  1. re-evaluates every `permissions.deny` AND `permissions.ask` rule from the
     project and user settings, and defers on any match;
  2. re-runs the guard hooks for the tool family (dangerous commands,
     orchestrator-only git, protected files, build artifacts, secret scan) and
     defers if any of them would block or ask.

This hook only removes the *prompt* for what none of them object to. Every uncertainty defers: an
unparseable rule, an unmodelled tool, a target it cannot see, a guard it cannot
execute, or any unexpected exception.

Supersedes `auto-approve-readonly.py`, which is kept on disk (unwired) as the
narrower fallback: swap it back into the Bash matcher in .claude/settings.json
to return to approving only provably read-only commands.

Kill switch: `CLAUDE_AUTO_APPROVE=0` in the environment defers everything.
"""
import copy
import fnmatch
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(HERE)          # .../.claude
REPO_DIR = os.path.dirname(PROJECT_DIR)

# Per-guard ceiling. Kept well under the outer hook timeout in settings.json so
# a hung guard still leaves budget to exit quietly rather than being killed
# mid-write (a killed hook emits no JSON, which reads as "defer" — safe, but
# deferring deliberately is better than deferring by execution).
GUARD_TIMEOUT_S = 6

# Guard hooks re-run before approving, per tool family. Any non-zero exit
# (deny OR ask) means this hook stays silent and the normal flow decides.
EDIT_GUARDS = ("protect-files.sh", "warn-large-files.sh", "scan-secrets.sh")
GUARDS = {
    "Bash": ("block-dangerous-commands.sh", "orchestrator-only-git.sh"),
    "Edit": EDIT_GUARDS,
    "Write": EDIT_GUARDS,
    "MultiEdit": EDIT_GUARDS,
    "NotebookEdit": EDIT_GUARDS,
}

SETTINGS_FILES = (
    os.path.join(PROJECT_DIR, "settings.json"),
    os.path.join(PROJECT_DIR, "settings.local.json"),
    os.path.expanduser("~/.claude/settings.json"),
    os.path.expanduser("~/.claude/settings.local.json"),
)

# Tools whose rule specifier is a file path glob rather than a command prefix.
WRITE_FAMILY = {"Write", "Edit", "MultiEdit", "NotebookEdit"}
PATH_TOOLS = WRITE_FAMILY | {"Read", "Glob", "Grep"}
PATH_KEYS = ("file_path", "notebook_path", "path", "pattern")

SEGMENT_SPLIT = re.compile(r"\|\||&&|[;|&\n]")
ENV_ASSIGN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=\S*$")
RULE = re.compile(r"^(?P<tool>[A-Za-z_][A-Za-z0-9_]*)(?:\((?P<spec>.*)\))?$", re.S)


def defer():
    sys.exit(0)


def allow(reason):
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "allow",
        "permissionDecisionReason": reason,
    }}))
    sys.exit(0)


class CorruptSettings(Exception):
    """A settings file exists but does not parse — its rules are unknowable."""


def load_rules():
    """Every deny + ask rule across project and user settings."""
    rules = []
    for path in SETTINGS_FILES:
        try:
            with open(path) as fh:
                perms = (json.load(fh) or {}).get("permissions") or {}
        except OSError:
            continue                          # absent: nothing to add
        except ValueError:
            # A corrupt file would otherwise read as "carries no deny rules",
            # silently dropping every rule it holds.
            raise CorruptSettings(path)
        for key in ("deny", "ask"):
            for rule in perms.get(key) or []:
                if isinstance(rule, str):
                    rules.append(rule)
    return rules


def glob_to_regex(pat):
    """Gitignore-style glob -> regex. `*` and `?` never cross a path separator."""
    out = ""
    i = 0
    while i < len(pat):
        if pat.startswith("**/", i):
            out += r"(?:.*/)?"
            i += 3
        elif pat.startswith("**", i):
            out += r".*"
            i += 2
        elif pat[i] == "*":
            out += r"[^/]*"
            i += 1
        elif pat[i] == "?":
            out += r"[^/]"
            i += 1
        else:
            out += re.escape(pat[i])
            i += 1
    return re.compile("^" + out + "$")


def glob_matches(pattern, value):
    """Match a rule glob against the absolute and repo-relative forms of a path."""
    value = os.path.normpath(value)
    candidates = {value}
    if os.path.isabs(value):
        if value.startswith(REPO_DIR + os.sep):
            candidates.add(value[len(REPO_DIR) + 1:])
    else:
        candidates.add(os.path.normpath(os.path.join(REPO_DIR, value)))

    # A bare `secrets/**` should also match nested occurrences.
    patterns = {pattern}
    if not pattern.startswith(("/", "*", "~")):
        patterns.add("**/" + pattern)

    for pat in patterns:
        compiled = glob_to_regex(pat)
        for cand in candidates:
            # fnmatch is a deliberately looser second opinion: its `*` crosses
            # `/`, so it catches rules whose author meant "anywhere below here".
            if compiled.match(cand) or fnmatch.fnmatch(cand, pat):
                return True
    return False


def bash_segments(command):
    """Simple commands within a compound command, plus the whole string."""
    out = [command.strip()]
    for raw in SEGMENT_SPLIT.split(command):
        seg = raw.strip().lstrip("({ \t")
        tokens = seg.split()
        while tokens and ENV_ASSIGN.match(tokens[0]):
            tokens = tokens[1:]
        if tokens:
            out.append(" ".join(tokens))
    return out


def spec_matches_command(spec, command):
    """`Bash(git push*)` / `Bash(npm run test:*)` prefix semantics, quote-insensitive.

    Splitting a compound command into segments is not enough on its own: a denied
    verb can reach a shell through `$(...)`, backticks, `eval`, or `bash -c`,
    none of which are segment boundaries. So the denied prefix is ALSO searched
    for anywhere it sits at a command position in the quote-stripped string.
    That over-matches (a denied word inside a quoted message defers too) — which
    is the safe direction: a defer falls through to the normal permission flow.
    """
    if spec in ("*", ":*", ""):
        return True
    prefix = spec[:-1] if spec.endswith("*") else None

    for seg in bash_segments(command):
        for variant in (seg, seg.replace('"', "").replace("'", "")):
            variant = " ".join(variant.split())
            if prefix is not None:
                if variant.startswith(prefix) or variant == prefix.rstrip():
                    return True
            elif variant == spec:
                return True

    if prefix is not None:
        unquoted = " ".join(command.replace('"', "").replace("'", "").split())
        # A command position: start of string, or just after a shell operator,
        # a substitution opener, or a wrapper that takes a command string.
        if re.search(r"(?:^|[\s;|&(`{])" + re.escape(prefix.lstrip()), unquoted):
            return True
    return False


def rule_blocks(rule, tool, tool_input):
    """True when this deny/ask rule could cover the call (fail closed on doubt)."""
    parsed = RULE.match(rule.strip())
    if not parsed:
        return True                           # unparseable rule: do not approve
    rule_tool, spec = parsed.group("tool"), parsed.group("spec")

    if rule_tool != tool:
        # Deny rules are written `Edit(...)`/`Write(...)`; every write-shaped
        # tool must answer to all of them, or MultiEdit walks past rules that
        # exist to protect the very same paths.
        if not (tool in WRITE_FAMILY and rule_tool in WRITE_FAMILY):
            # An MCP rule may name the server: `mcp__notion` covers its tools.
            if tool.startswith("mcp__") and tool.startswith(rule_tool + "__"):
                return True
            return False
    if spec is None:
        return True                           # bare `Bash` denies the whole tool

    if tool == "Bash":
        command = tool_input.get("command")
        if not isinstance(command, str):
            return True                       # can't read the command: fail closed
        return spec_matches_command(spec, command)

    if tool in PATH_TOOLS:
        values = [tool_input.get(k) for k in PATH_KEYS]
        values = [v for v in values if isinstance(v, str) and v]
        if not values:
            return True                       # can't see the target: fail closed
        return any(glob_matches(spec, v) for v in values)

    return True                               # scoped rule on a tool we can't model


def guard_payload(payload):
    """Normalise a write-shaped call so the Edit/Write guards can actually read it.

    protect-files.sh and warn-large-files.sh read `.tool_input.file_path`;
    scan-secrets.sh reads `.tool_input.content` or `.new_string` and only for
    tool_name Write/Edit. A NotebookEdit or MultiEdit call carries none of those
    under those names, so the guards would inspect an empty string and exit 0 —
    coverage that looks installed and enforces nothing.
    """
    tool = payload.get("tool_name")
    # Write and Edit already carry the shape the guards parse; rewriting their
    # tool_name would move `content` out from under scan-secrets.sh's nose.
    if tool not in ("MultiEdit", "NotebookEdit"):
        return payload
    out = copy.deepcopy(payload)
    ti = out.get("tool_input") or {}
    if not isinstance(ti, dict):
        return payload

    if not ti.get("file_path"):
        for key in PATH_KEYS:
            value = ti.get(key)
            if isinstance(value, str) and value:
                ti["file_path"] = value
                break

    if not ti.get("content") and not ti.get("new_string"):
        bodies = []
        for key in ("new_source", "new_str", "source"):
            value = ti.get(key)
            if isinstance(value, str):
                bodies.append(value)
        for edit in ti.get("edits") or []:
            if isinstance(edit, dict):
                for key in ("new_string", "new_str"):
                    if isinstance(edit.get(key), str):
                        bodies.append(edit[key])
        if bodies:
            ti["new_string"] = "\n".join(bodies)

    out["tool_input"] = ti
    out["tool_name"] = "Edit"                 # the shape the guards parse
    return out


def guards_pass(tool, payload):
    raw = json.dumps(guard_payload(payload)).encode()
    for guard in GUARDS.get(tool, ()):
        path = os.path.join(HERE, guard)
        if not (os.path.isfile(path) and os.access(path, os.X_OK)):
            return False                      # missing or unrunnable: fail closed
        try:
            done = subprocess.run(path, input=raw, capture_output=True,
                                  timeout=GUARD_TIMEOUT_S, cwd=REPO_DIR)
        except Exception:
            return False                      # guard unusable: fail closed
        if done.returncode != 0:
            return False
    return True


def main():
    if os.environ.get("CLAUDE_AUTO_APPROVE") == "0":
        defer()
    try:
        payload = json.load(sys.stdin)
    except Exception:
        defer()
    if not isinstance(payload, dict):
        defer()

    tool = payload.get("tool_name")
    tool_input = payload.get("tool_input") or {}
    if not isinstance(tool, str) or not tool or not isinstance(tool_input, dict):
        defer()

    try:
        rules = load_rules()
    except CorruptSettings as exc:
        print("auto-approve-all: %s does not parse; deferring every call until "
              "it is fixed" % exc, file=sys.stderr)
        defer()

    for rule in rules:
        if rule_blocks(rule, tool, tool_input):
            defer()

    if not guards_pass(tool, payload):
        defer()

    allow("auto-approved: no deny/ask rule matches and every guard hook passed "
          "— unattended loop, no human at the prompt")


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception:
        # Never let an unexpected shape crash the hook: a traceback is not valid
        # hook JSON, and the contract is that anything unparseable defers.
        defer()
