#!/usr/bin/env python3
"""Auto-approve provably read-only Bash commands.

An unattended loop stalls on the permission prompt that fires whenever a
command contains shell expansion ("$f", $(...), for-loops) — static allow
rules can never match those. This hook approves the read-only ones so the
swarm keeps moving, and stays silent on everything else.

  emit allow -> suppresses the prompt
  exit 0     -> defer to the normal permission flow (prompt as usual)

SAFE BY CONSTRUCTION: before approving, it re-runs the two deny hooks and
refuses to approve anything they would block. Claude Code runs PreToolUse
hooks in PARALLEL and does not document who wins when one allows and another
exits 2 — so we never create that conflict. `permissions.deny` stays
authoritative regardless (documented behavior).

Fails closed: anything not positively recognised as read-only just prompts.
"""
import json
import os
import shlex
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
GUARDS = ("block-dangerous-commands.sh", "orchestrator-only-git.sh")


def defer():
    sys.exit(0)


def allow(reason):
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "allow",
        "permissionDecisionReason": reason,
    }}))
    sys.exit(0)


# Read-only verbs. Anything absent from this list prompts.
SAFE = {
    "cd", "echo", "printf", "cat", "head", "tail", "ls", "pwd", "grep", "egrep",
    "fgrep", "rg", "find", "wc", "sort", "uniq", "cut", "tr", "jq", "stat",
    "file", "du", "df", "basename", "dirname", "realpath", "readlink", "diff",
    "comm", "date", "env", "which", "type", "command", "test", "true", "false",
    "seq", "awk", "column", "xxd", "shasum", "md5", "sleep", "tree", "nl",
}
GIT_RO = {
    "log", "status", "diff", "show", "rev-parse", "describe", "blame",
    "ls-files", "ls-tree", "cat-file", "shortlog", "merge-base", "name-rev",
    "count-objects", "grep", "branch", "tag", "remote", "config",
}
GH_RO = {"view", "list", "diff", "checks", "status"}
KEYWORDS = {"do", "done", "then", "else", "elif", "fi", "esac", "in", "{", "}",
            "!", "[[", "]]", "time"}

# Python bodies may not touch the filesystem, processes, or network.
PY_UNSAFE = re.compile(
    r"import\s+(os|sys|subprocess|shutil|socket|urllib|requests|http|tempfile|"
    r"ctypes|multiprocessing|pty|signal)\b"
    r"|__import__|\beval\(|\bexec\(|\bcompile\(|\.system\(|\.popen\(|\.run\("
    r"|\.remove\(|\.unlink\(|\.rmtree\(|\.makedirs\(|\.mkdir\(|\.rename\("
    r"|\.chmod\(|\.write\(|\.writelines\(|\.truncate\("
)
PY_WRITE_OPEN = re.compile(r"open\s*\([^)]*,[^)]*['\"][wax+]")

# Build/verify commands the swarm runs constantly. Allowlisted by exact script
# name — NOT a blanket `npm run *`, which would sweep in the db:migrate /
# db:seed / db:reset / backfill scripts most projects also keep in package.json,
# every one of which mutates the database. If this project's read-only scripts
# have different names, add them here by exact name after checking package.json.
NPM_SAFE_SCRIPTS = {
    "lint", "typecheck", "test", "build", "test:e2e", "test:unit",
    "format:check", "lint:fix",
}
# Runners whose binary is fixed and known. `npx <arbitrary-pkg>` downloads and
# executes code from the registry, so only these names qualify.
RUNNER_SAFE_BINS = {"tsc", "eslint", "vitest", "playwright", "prettier", "next"}
NEXT_SAFE_SUBS = {"build", "lint"}          # not dev/start: long-running servers

# `find` is read-only only without an action flag.
FIND_UNSAFE = re.compile(r"^-(delete|exec|execdir|ok|okdir|fprint|fls|fprintf)$")


SUBST_PLACEHOLDER = "__SUBST_OK__"


def _matching_paren(s, open_idx):
    """Index of the ')' matching the '(' at open_idx, or -1."""
    depth = 0
    for i in range(open_idx, len(s)):
        if s[i] == "(":
            depth += 1
        elif s[i] == ")":
            depth -= 1
            if depth == 0:
                return i
    return -1


def strip_substitutions(cmd):
    """Recursively validate $(...), <(...), and `...` bodies.

    Their contents execute, so they must clear the same bar as the outer
    command. Innermost-first; each validated body collapses to a placeholder.
    Returns the cleaned string, or None if any body is not read-only.
    """
    for _ in range(64):                       # cycle guard
        start = max(cmd.rfind("$("), cmd.rfind("<("))
        if start == -1:
            break
        close = _matching_paren(cmd, start + 1)
        if close == -1:
            return None                       # unbalanced: don't guess
        if not command_is_readonly(cmd[start + 2:close]):
            return None
        cmd = cmd[:start] + SUBST_PLACEHOLDER + cmd[close + 1:]

    while "`" in cmd:
        first = cmd.find("`")
        second = cmd.find("`", first + 1)
        if second == -1:
            return None
        if not command_is_readonly(cmd[first + 1:second]):
            return None
        cmd = cmd[:first] + SUBST_PLACEHOLDER + cmd[second + 1:]
    return cmd


def command_is_readonly(cmd):
    """Whole-string check: substitutions, then every simple command."""
    if not cmd.strip():
        return True
    cleaned = strip_substitutions(cmd)
    if cleaned is None:
        return False
    try:
        lexer = shlex.shlex(cleaned, posix=True, punctuation_chars=True)
        lexer.whitespace_split = True
        tokens = list(lexer)
    except ValueError:
        return False                          # unbalanced quotes
    return all(check_command(c) for c in split_commands(tokens))


def split_commands(tokens):
    """Group a token stream into simple commands on ; && || | & newline."""
    cmds, cur = [], []
    for t in tokens:
        if t in (";", "&&", "||", "|", "&", "\n", ";;"):
            cmds.append(cur)
            cur = []
        else:
            cur.append(t)
    cmds.append(cur)
    return [c for c in cmds if c]


def check_python(tokens):
    if len(tokens) < 3 or tokens[1] != "-c":
        return False                       # running a script file, not inline
    body = tokens[2]
    if PY_UNSAFE.search(body) or PY_WRITE_OPEN.search(body):
        return False
    return True


def check_git(tokens):
    sub = next((t for t in tokens[1:] if not t.startswith("-")), None)
    if sub not in GIT_RO:
        return False
    rest = " ".join(tokens)
    if sub == "branch" and re.search(r"\s-(d|D|m|M|c)\b|--delete|--move|--copy", rest):
        return False
    if sub == "tag" and re.search(r"\s-(a|d|f|s)\b|--delete", rest):
        return False
    if sub == "remote" and re.search(r"\b(add|remove|rm|rename|set-url)\b", rest):
        return False
    if sub == "config" and not re.search(r"--get|--list|\s-l\b", rest):
        return False
    return True


def check_gh(tokens):
    rest = tokens[1:]
    if rest and rest[0] == "api":
        return not re.search(r"-X|--method", " ".join(rest)) or not re.search(
            r"\b(POST|PATCH|PUT|DELETE)\b", " ".join(rest))
    return any(t in GH_RO for t in rest[:3])


def _first_positional(tokens):
    return next((t for t in tokens if not t.startswith("-")), None)


def check_runner_bin(tokens):
    """A known build/verify binary, invoked directly or via npx/dlx/bunx."""
    bin_name = os.path.basename(tokens[0])
    if bin_name not in RUNNER_SAFE_BINS:
        return False
    if bin_name == "next":
        return _first_positional(tokens[1:]) in NEXT_SAFE_SUBS
    return True


def check_package_manager(tokens):
    """npm/pnpm/yarn/bun: only `run <allowlisted-script>` and `test`."""
    rest = [t for t in tokens[1:] if not t.startswith("-")]
    if not rest:
        return False
    if rest[0] == "run":
        return len(rest) > 1 and rest[1] in NPM_SAFE_SCRIPTS
    if rest[0] == "test":
        return True
    # `npx tsc`, `pnpm dlx eslint`, `bunx vitest`
    if rest[0] == "dlx":
        rest = rest[1:]
    return bool(rest) and check_runner_bin(rest)


def check_command(tokens):
    # strip keywords, env assignments, and loop headers
    while tokens:
        t = tokens[0]
        if t in KEYWORDS or re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*=.*", t):
            tokens = tokens[1:]
        elif t in ("for", "case", "select"):
            return True                    # remainder is a word list
        elif t in ("if", "while", "until"):
            tokens = tokens[1:]
        else:
            break
    if not tokens:
        return True

    # A validated substitution is fine as an argument, but executing whatever
    # it prints is not: `$(which foo) --flag` runs an unknown binary.
    if tokens[0] == SUBST_PLACEHOLDER:
        return False

    verb = os.path.basename(tokens[0])
    if verb == "git":
        return check_git(tokens)
    if verb == "gh":
        return check_gh(tokens)
    if verb in ("python", "python3"):
        return check_python(tokens)
    if verb == "sed":
        return not any(re.match(r"^-[a-zA-Z]*i", t) for t in tokens[1:])
    if verb == "find":
        return not any(FIND_UNSAFE.match(t) for t in tokens[1:])
    if verb in ("npm", "npx", "pnpm", "yarn", "bun", "bunx"):
        return check_package_manager(tokens)
    if verb in RUNNER_SAFE_BINS:
        return check_runner_bin(tokens)
    return verb in SAFE


def main():
    try:
        payload = json.load(sys.stdin)
    except Exception:
        defer()
    if payload.get("tool_name") != "Bash":
        defer()
    command = (payload.get("tool_input") or {}).get("command") or ""
    if not command.strip():
        defer()

    # Never approve what the deny hooks would block.
    raw = json.dumps(payload).encode()
    for guard in GUARDS:
        path = os.path.join(HERE, guard)
        if os.access(path, os.X_OK):
            try:
                if subprocess.run(path, input=raw, capture_output=True,
                                  timeout=8).returncode != 0:
                    defer()
            except Exception:
                defer()

    # Redirection that writes anywhere other than /dev/null.
    if re.search(r"(?<![0-9&2])>>?\s*(?!/dev/null)(?!&\s*1)\S", command):
        defer()

    if not command_is_readonly(command):
        defer()

    allow("read-only command (verb-allowlisted; no writes, exec, or network) "
          "— auto-approved to keep the unattended loop moving")


if __name__ == "__main__":
    main()
