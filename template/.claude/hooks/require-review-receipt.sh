#!/usr/bin/env bash
# Enforces the review gate: no merge into a protected branch without a review
# receipt proving >=2 independent reviewers ran against the CURRENT head commit.
# PreToolUse hook for Bash. Exit 2 = block. Exit 0 = allow.
#
# CLAUDE.md states the review gate as a rule; a rule in prose is skippable.
# This turns it into a gate. The orchestrator writes the receipt after the
# review tier reports; nothing else can merge without one.
#
# Receipt path:  .claude/receipts/<branch with / and other non-alnum -> ->.json
# Receipt shape:
#   {
#     "branch":   "feature/foo",
#     "head_sha": "<full sha of the branch tip the reviewers actually read>",
#     "reviews": [
#       {"agent": "code-reviewer",  "verdict": "pass",   "notes": "..."},
#       {"agent": "qa-tester",      "verdict": "waived", "notes": "why waived"}
#     ]
#   }
#
# Accepted verdicts: pass | approved | waived. Anything else counts as failing
# and blocks the merge.
#
# What is gated:
#   gh pr merge [N]          -> always (a PR merges into its base)
#   git merge <ref>          -> only while ON a protected branch (merging INTO it).
#                               Syncing main into a feature branch is untouched.
#
# Escape hatch (audited, announce it): CLAUDE_SKIP_REVIEW_RECEIPT=1
# Protected branches: CLAUDE_PROTECTED_BRANCHES (default: main,master + init.defaultBranch)

set -uo pipefail

emit_deny() {
  local reason="${1//\"/\\\"}"
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}\n' "$reason"
  exit 2
}

[ "${CLAUDE_SKIP_REVIEW_RECEIPT:-0}" = "1" ] && exit 0

command -v jq >/dev/null 2>&1 || emit_deny "jq is required for the review-receipt hook but is not installed."

INPUT=$(cat)
COMMAND=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null || true)
[ -z "$COMMAND" ] && exit 0

CMD=$(printf '%s' "$COMMAND" | tr -d "'\"")
has() { printf '%s' "$CMD" | grep -qE "$1"; }

# ── Protected branch list ───────────────────────────────────────────────
DEFAULT_BRANCHES="main,master"
if GIT_DEFAULT=$(git config --get init.defaultBranch 2>/dev/null) && [ -n "$GIT_DEFAULT" ]; then
  DEFAULT_BRANCHES="$DEFAULT_BRANCHES,$GIT_DEFAULT"
fi
PROTECTED_BRANCHES="${CLAUDE_PROTECTED_BRANCHES:-$DEFAULT_BRANCHES}"
is_protected() { printf '%s' ",$PROTECTED_BRANCHES," | grep -q ",$1,"; }

CURRENT=$(git branch --show-current 2>/dev/null || true)

# ── Which merge is this, and what branch is being merged? ───────────────
BRANCH=""

if has '(^|[;&|(]|&&)[[:space:]]*gh[[:space:]]+pr[[:space:]]+merge([[:space:]]|$)'; then
  # `gh pr merge [N] [flags]` — first bare non-flag token after `merge` is the PR number.
  PR_NUM=$(printf '%s' "$CMD" \
    | sed -nE 's/.*gh[[:space:]]+pr[[:space:]]+merge[[:space:]]+([0-9]+)([[:space:]]|$).*/\1/p' | head -1)
  if [ -n "$PR_NUM" ]; then
    BRANCH=$(gh pr view "$PR_NUM" --json headRefName -q .headRefName 2>/dev/null || true)
    [ -z "$BRANCH" ] && emit_deny "Blocked: cannot resolve the head branch of PR #${PR_NUM} to check its review receipt. Run 'gh pr view ${PR_NUM}' and retry, or merge from the branch checkout."
  else
    BRANCH="$CURRENT"
    [ -z "$BRANCH" ] && emit_deny "Blocked: 'gh pr merge' with no PR number outside a branch checkout — cannot identify which review receipt to check."
  fi

elif has '(^|[;&|(]|&&)[[:space:]]*git[[:space:]]+merge([[:space:]]|$)'; then
  # In-progress merge control flags are not a new merge.
  has 'git[[:space:]]+merge[[:space:]]+--(abort|continue|quit)([[:space:]]|$)' && exit 0
  # Only gate merges INTO a protected branch; syncing main -> feature is fine.
  [ -z "$CURRENT" ] && exit 0
  is_protected "$CURRENT" || exit 0
  BRANCH=$(printf '%s' "$CMD" \
    | sed -nE 's/.*git[[:space:]]+merge[[:space:]]+(-[^[:space:]]+[[:space:]]+)*([^-][^[:space:]]*).*/\2/p' | head -1)
  BRANCH="${BRANCH#origin/}"
  [ -z "$BRANCH" ] && emit_deny "Blocked: 'git merge' into protected branch '$CURRENT' without an identifiable source branch. Name the branch explicitly so its review receipt can be checked."

else
  exit 0
fi

# ── Locate the receipt ──────────────────────────────────────────────────
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
SLUG=$(printf '%s' "$BRANCH" | tr -c '[:alnum:]._-' '-')
RECEIPT="$PROJECT_DIR/.claude/receipts/${SLUG}.json"

GATE="The review gate in CLAUDE.md requires >=2 independent reviewers on the diff before merge. Run the review tier, then write the receipt to .claude/receipts/${SLUG}.json with the branch head_sha the reviewers read and one entry per reviewer (verdict: pass | approved | waived)."

[ -f "$RECEIPT" ] || emit_deny "Blocked: no review receipt for branch '${BRANCH}'. ${GATE}"

jq -e . "$RECEIPT" >/dev/null 2>&1 || emit_deny "Blocked: review receipt for '${BRANCH}' is not valid JSON (${RECEIPT}). ${GATE}"

# ── Staleness: the receipt must cover the commit actually being merged ──
RECEIPT_SHA=$(jq -r '.head_sha // empty' "$RECEIPT" 2>/dev/null || true)
[ -z "$RECEIPT_SHA" ] && emit_deny "Blocked: review receipt for '${BRANCH}' has no head_sha, so it cannot prove the reviewers read the commit being merged. ${GATE}"

ACTUAL_SHA=$(git rev-parse --verify --quiet "refs/heads/${BRANCH}" 2>/dev/null || true)
[ -z "$ACTUAL_SHA" ] && ACTUAL_SHA=$(git rev-parse --verify --quiet "refs/remotes/origin/${BRANCH}" 2>/dev/null || true)

if [ -n "$ACTUAL_SHA" ] && [ "$RECEIPT_SHA" != "$ACTUAL_SHA" ]; then
  emit_deny "Blocked: review receipt for '${BRANCH}' is STALE — it covers ${RECEIPT_SHA:0:8} but the branch tip is ${ACTUAL_SHA:0:8}. Commits landed after review. Re-run the review tier on the current head and rewrite the receipt."
fi
if [ -z "$ACTUAL_SHA" ]; then
  emit_deny "Blocked: cannot resolve branch '${BRANCH}' locally or on origin, so the review receipt's head_sha cannot be verified as current. Fetch the branch and retry."
fi

# ── Reviewer count and verdicts ─────────────────────────────────────────
TOTAL=$(jq -r '(.reviews // []) | length' "$RECEIPT" 2>/dev/null || echo 0)
if [ "$TOTAL" -eq 0 ]; then
  emit_deny "Blocked: review receipt for '${BRANCH}' lists no reviews. ${GATE}"
fi

FAILING=$(jq -r '
  [ (.reviews // [])[]
    | select(((.verdict // "") | ascii_downcase) as $v
             | ($v | test("^(pass|approved|waived)$")) | not)
    | ((.agent // "unnamed") + "=" + (.verdict // "missing")) ]
  | join(", ")' "$RECEIPT" 2>/dev/null || true)
if [ -n "$FAILING" ]; then
  emit_deny "Blocked: review receipt for '${BRANCH}' has unresolved reviewer verdicts (${FAILING}). Fix the finding or record an explicit 'waived' verdict with a reason, then merge."
fi

PASSING=$(jq -r '
  [ (.reviews // [])[]
    | select((.agent // "") != "")
    | select(((.verdict // "") | ascii_downcase) | test("^(pass|approved|waived)$"))
    | (.agent | ascii_downcase) ]
  | unique | length' "$RECEIPT" 2>/dev/null || echo 0)

if [ "$PASSING" -lt 2 ]; then
  emit_deny "Blocked: review receipt for '${BRANCH}' shows only ${PASSING} distinct reviewer(s); the gate requires >=2 independent reviewers. ${GATE}"
fi

exit 0
