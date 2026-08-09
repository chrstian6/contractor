#!/usr/bin/env bash
# Restricts git/gh WRITE operations to the orchestrator (main thread).
# Subagents (builder, architect, reviewers, ...) keep full Bash for
# tsc/lint/vitest and read-only git, but cannot mutate repo state.
# PreToolUse hook for Bash. Exit 2 = block. Exit 0 = allow.
#
# Detection: the PreToolUse payload carries `agent_id` ONLY when the hook
# fires inside a subagent. Absent => main thread => allowed.

set -uo pipefail

emit_deny() {
  local reason="${1//\"/\\\"}"
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}\n' "$reason"
  exit 2
}

command -v jq >/dev/null 2>&1 || emit_deny "jq is required for the orchestrator-only-git hook but is not installed."

INPUT=$(cat)

# Main thread has no agent_id -> the orchestrator owns git, let it through.
AGENT_ID=$(printf '%s' "$INPUT" | jq -r '.agent_id // empty' 2>/dev/null || true)
[ -z "$AGENT_ID" ] && exit 0

AGENT_TYPE=$(printf '%s' "$INPUT" | jq -r '.agent_type // "subagent"' 2>/dev/null || true)
COMMAND=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null || true)
[ -z "$COMMAND" ] && exit 0

CMD=$(printf '%s' "$COMMAND" | tr -d "'\"")
has() { printf '%s' "$CMD" | grep -qE "$1"; }

HANDOFF="Report the change back to the orchestrator, which owns every git operation (branches, commits, PRs, merges) per CLAUDE.md."

# ── git write subcommands ───────────────────────────────────────────────
# Read-only git (status, log, diff, show, rev-parse, blame, ls-files, describe)
# is deliberately NOT listed: delegates need it to verify their own work.
GIT_WRITE='push|commit|merge|rebase|reset|revert|cherry-pick|stash|clean|tag|worktree|remote|am|apply|restore|rm|mv|add|switch|checkout|init|clone|fetch|pull|submodule|filter-branch|gc|prune|reflog|update-ref|symbolic-ref|notes|replace'

if has "(^|[;&|(]|&&)[[:space:]]*git[[:space:]]+(-[^[:space:]]+[[:space:]]+)*($GIT_WRITE)([[:space:]]|$)"; then
  VERB=$(printf '%s' "$CMD" | grep -oE "git[[:space:]]+(-[^[:space:]]+[[:space:]]+)*($GIT_WRITE)([[:space:]]|$)" | head -1 | awk '{print $NF}')
  emit_deny "Blocked: '${AGENT_TYPE}' is a subagent and may not run 'git ${VERB}'. Read-only git (status/log/diff/show) is allowed. ${HANDOFF}"
fi

# `git branch` is read-only only in its listing forms.
if has '(^|[;&|(]|&&)[[:space:]]*git[[:space:]]+branch([[:space:]]|$)' \
   && ! has 'git[[:space:]]+branch[[:space:]]*($|[;&|])' \
   && ! has 'git[[:space:]]+branch[[:space:]]+(--show-current|--list|--contains|--merged|--no-merged|-l|-a|-r|-v|-vv)([[:space:]]|$)'; then
  emit_deny "Blocked: '${AGENT_TYPE}' is a subagent and may not create, rename, or delete branches. ${HANDOFF}"
fi

# ── the guard scripts and permission config ─────────────────────────────
# Edit/Write into .claude/ is denied by permissions.deny, but a shell command
# is not covered by a path rule: `sed -i`, `cat >`, `chmod -x` would let a
# delegate neuter the very hooks that bound it. The orchestrator (no agent_id)
# is unaffected and reaches this file normally.
if has "(^|[;&|(]|&&|>)[[:space:]]*[^;&|]*\\.claude/(hooks|settings)"; then
  if has "(sed[[:space:]]+-i|>|>>|tee|cp[[:space:]]|mv[[:space:]]|rm[[:space:]]|chmod|truncate|dd[[:space:]]|install[[:space:]])"; then
    emit_deny "Blocked: '${AGENT_TYPE}' is a subagent and may not modify .claude/hooks or .claude/settings — those enforce its own boundaries. ${HANDOFF}"
  fi
fi

# ── gh write operations ─────────────────────────────────────────────────
if has '(^|[;&|(]|&&)[[:space:]]*gh[[:space:]]+(pr|release|repo|issue)[[:space:]]+(create|merge|close|edit|delete|review|ready|reopen|comment)([[:space:]]|$)'; then
  OP=$(printf '%s' "$CMD" | grep -oE 'gh[[:space:]]+(pr|release|repo|issue)[[:space:]]+[a-z]+' | head -1)
  emit_deny "Blocked: '${AGENT_TYPE}' is a subagent and may not run '${OP}'. ${HANDOFF}"
fi

# gh api with a mutating method
if has 'gh[[:space:]]+api[[:space:]].*(-X|--method)[[:space:]]+(POST|PATCH|PUT|DELETE)'; then
  emit_deny "Blocked: '${AGENT_TYPE}' is a subagent and may not issue mutating gh api calls. ${HANDOFF}"
fi

exit 0
