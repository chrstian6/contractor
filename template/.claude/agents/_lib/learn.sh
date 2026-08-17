#!/usr/bin/env bash
# learn.sh — the executable half of the self-improvement loop.
#
# Every agent's RUN procedure ends with a call to this script. It appends one
# structured entry to `.claude/agents/<agent>/LEARNINGS.md`, which that agent
# reads back as step 1 of its NEXT run. That is the whole loop: what an agent
# discovers the hard way on run N is in its context on run N+1.
#
# Why a script and not "remember to write down what you learned":
#   - prose guards are obeyed only when noticed; a command is not optional
#   - a fixed schema is greppable and promotable; free-form notes are not
#   - it dedupes, so the same lesson does not accumulate 40 times
#   - it refuses to write outside `.claude/agents/<agent>/LEARNINGS.md`, so the
#     "self-improvement" channel cannot become "the agent edits its own mandate"
#
# Usage:
#   .claude/agents/_lib/learn.sh <agent> <trigger> <lesson> <guard>
#   .claude/agents/_lib/learn.sh --list <agent>
#
#   <agent>    folder name under .claude/agents/ (e.g. builder)
#   <trigger>  the observable situation that should make a future run act
#   <lesson>   what to do differently, concretely
#   <guard>    the script/lint/test that could enforce it, or NONE-YET
#
# Exit codes: 0 recorded (or duplicate, already known), 2 usage/unknown agent.

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
AGENTS_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"

# Learnings always land in the PRIMARY checkout, never in an agent worktree.
#
# Builders run in throwaway worktrees that the orchestrator removes after
# harvest. A learning written to the worktree's own .claude/agents/ copy would
# be deleted along with it — the loop would silently learn nothing, which is
# the worst failure mode available to a memory system.
#
# `git rev-parse --git-common-dir` points at the primary .git even from inside
# a worktree; its parent is the primary checkout. Read-only, and invoked by
# this sanctioned script rather than by the agent, so it does not breach
# "nobody below the orchestrator runs git".
if COMMON_DIR="$(git rev-parse --git-common-dir 2>/dev/null)"; then
  PRIMARY="$(cd -- "$(dirname -- "$COMMON_DIR")" 2>/dev/null && pwd)" || PRIMARY=""
  if [ -n "$PRIMARY" ] && [ -d "$PRIMARY/.claude/agents" ]; then
    AGENTS_DIR="$PRIMARY/.claude/agents"
  fi
fi

# Cap before a file stops being a memory and starts being noise. At this point
# the recurring entries have earned promotion into AGENT.md, a `.claude/rules/`
# file, or — best — an executable guard.
PROMOTE_AT=12

die() { printf 'learn.sh: %s\n' "$1" >&2; exit 2; }

usage() {
  cat >&2 <<'EOF'
usage: learn.sh <agent> <trigger> <lesson> <guard>
       learn.sh --list <agent>
EOF
  exit 2
}

[ $# -ge 1 ] || usage

if [ "$1" = "--list" ]; then
  [ $# -eq 2 ] || usage
  case "$2" in
    */*|..|.|"") die "invalid agent name: '$2'" ;;
  esac
  FILE="$AGENTS_DIR/$2/LEARNINGS.md"
  # Exits 0 when empty: this runs as step 1 of every agent's procedure, and a
  # first run with nothing learned yet is the normal case, not an error.
  if [ -f "$FILE" ]; then cat "$FILE"; else
    printf 'No learnings recorded for %s yet — this is the first run.\n' "$2"
  fi
  exit 0
fi

[ $# -eq 4 ] || usage

AGENT="$1"
TRIGGER="$2"
LESSON="$3"
GUARD="$4"

# The agent name is a directory name, never a path. This is what keeps the
# script from being a general-purpose file writer.
case "$AGENT" in
  */*|..|.|"") die "invalid agent name: '$AGENT'" ;;
esac
[ -d "$AGENTS_DIR/$AGENT" ] || die "unknown agent: '$AGENT' (no .claude/agents/$AGENT/)"

for field in "$TRIGGER" "$LESSON" "$GUARD"; do
  [ -n "${field// /}" ] || die "trigger, lesson and guard must all be non-empty"
done

FILE="$AGENTS_DIR/$AGENT/LEARNINGS.md"
DATE="$(date +%Y-%m-%d)"

if [ ! -f "$FILE" ]; then
  cat > "$FILE" <<EOF
# Learnings — \`$AGENT\`

Append-only. Written by \`.claude/agents/_lib/learn.sh\`, read by this agent as
step 1 of every run. This file has no \`name:\` frontmatter, so Claude Code
treats it as a co-located doc and never loads it as an agent definition.

Do not hand-edit to delete an entry. An entry leaves this file exactly one way:
it gets **promoted** — into \`AGENT.md\`, a \`.claude/rules/\` file, or (best) an
executable guard — and the promotion is recorded in the entry.

EOF
fi

# Dedupe on trigger+lesson so a recurring lesson is one entry, not forty.
KEY="$(printf '%s|%s' "$TRIGGER" "$LESSON")"
KEY_HASH="$(printf '%s' "$KEY" | shasum -a 256 | cut -c1-12)"

if grep -qF "<!-- key:$KEY_HASH -->" "$FILE" 2>/dev/null; then
  printf 'learn.sh: already known by %s (key %s) — not duplicated\n' "$AGENT" "$KEY_HASH"
  exit 0
fi

cat >> "$FILE" <<EOF
## $DATE — $TRIGGER
<!-- key:$KEY_HASH -->

- **Trigger:** $TRIGGER
- **Lesson:** $LESSON
- **Guard:** $GUARD
- **Promoted:** no

EOF

COUNT="$(grep -c '^<!-- key:' "$FILE" || true)"
printf 'learn.sh: recorded for %s (%s entries)\n' "$AGENT" "$COUNT"

if [ "$COUNT" -ge "$PROMOTE_AT" ]; then
  cat >&2 <<EOF

learn.sh: $AGENT has $COUNT learnings (threshold $PROMOTE_AT).
Report to the orchestrator that this agent is due a PROMOTION PASS: fold the
recurring entries into AGENT.md or a rule, and prefer an executable guard over
prose. Agents do not edit their own AGENT.md — promotion is the orchestrator's.
EOF
fi
