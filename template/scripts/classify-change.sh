#!/usr/bin/env bash
# Classify a diff into a pipeline lane — deterministically, from paths.
#
# WHY THIS EXISTS. Asking the planner to judge "is this risky?" costs a model
# turn on every task, and it loses: a sizing rule is one paragraph competing with
# a dozen MANDATORY blocks demanding the full chain, so the safe reading of
# anything ambiguous becomes "run everything" and a one-file copy fix draws a
# migration's pipeline.
#
# Paths are not ambiguous. The surfaces that actually cause incidents in YOUR
# repo are enumerable, so enumerate them once here and let a script decide. The
# planner then reads the answer instead of deriving it.
#
# ─────────────────────────────────────────────────────────────────────────────
# CONFIGURE ME. Until you do, this script refuses to answer — see WHY below.
# ─────────────────────────────────────────────────────────────────────────────
#
# Add one line per risky surface. Left side is a regex matched against changed
# paths (repo-relative); right side is the reason reported to the planner.
#
# Start from whichever of these your repo actually has, then add your own:
#
#   '^(migrations|drizzle|prisma)/'        schema migration
#   '^(lib|src)/auth/'                     auth surface
#   '^(lib|src)/db/(client|scoped)'        raw db client / scoped layer
#   '^middleware\.(ts|js)$'                request middleware
#   '^(lib|src)/billing/'                  billing / money
#   '^(lib|src)/(notifications|webhooks)/' outbound webhook surface
#   '^(lib|src)/ai/'                       model prompt contracts
#   '^\.claude/(hooks|settings|agents)'    the agent guards themselves
#   '^(eslint|tsconfig|next|vite)\.'       build or lint boundary config
#
HEAVY_PATHS=(
  # '^regex/'    'reason reported to the planner'
)
#
# WHY AN EMPTY LIST REFUSES INSTEAD OF ANSWERING "FAST":
# A classifier that silently returns FAST because nobody configured it is worse
# than no classifier at all — it converts "we have not decided yet" into a
# confident green, and the planner has no way to tell the difference. So an
# unconfigured run exits 3 and says so, and the planner falls back to judgment
# and reports that it did.

set -uo pipefail
cd "$(dirname "$0")/.."

EVAL_MODE=0
BASE=""
for arg in "$@"; do
  case "$arg" in
    --eval) EVAL_MODE=1 ;;
    -*) ;;
    *) BASE="$arg" ;;
  esac
done

if [ ${#HEAVY_PATHS[@]} -eq 0 ]; then
  if [ "$EVAL_MODE" = "1" ]; then
    echo "LANE=UNCONFIGURED"
    echo "LANE_REASONS='classify-change.sh has no HEAVY_PATHS configured'"
  else
    echo "▲ UNCONFIGURED — scripts/classify-change.sh has no HEAVY_PATHS set."
    echo
    echo "  Nobody has enumerated this repo's risky surfaces yet, so this script"
    echo "  cannot answer. It refuses rather than returning FAST, because a"
    echo "  confident wrong green is worse than no answer."
    echo
    echo "  Fill in HEAVY_PATHS at the top of this file (one line per surface),"
    echo "  or delete the file if you do not want a classifier."
  fi
  exit 3
fi

if [ -z "$BASE" ]; then
  BASE="$(git merge-base HEAD origin/HEAD 2>/dev/null \
       || git merge-base HEAD origin/main 2>/dev/null \
       || git merge-base HEAD main 2>/dev/null || echo "")"
fi

CHANGED="$( { [ -n "$BASE" ] && git diff --name-only "$BASE"...HEAD 2>/dev/null
              git diff --name-only HEAD 2>/dev/null
              git diff --cached --name-only 2>/dev/null
              git ls-files --others --exclude-standard 2>/dev/null
            } | sed '/^$/d' | sort -u )"
COUNT="$(printf '%s\n' "$CHANGED" | sed '/^$/d' | wc -l | tr -d ' ')"

LANE="FAST"
REASONS=()
matches() { printf '%s\n' "$CHANGED" | grep -qE "$1"; }

i=0
while [ $i -lt ${#HEAVY_PATHS[@]} ]; do
  pattern="${HEAVY_PATHS[$i]}"; reason="${HEAVY_PATHS[$((i+1))]:-$pattern}"
  matches "$pattern" && { LANE="HEAVY"; REASONS+=("$reason"); }
  i=$((i+2))
done

# A large diff is a WEAK signal the planner may waive: a 300-line new component
# with no shared surface is not HEAVY, while a one-line change to a permission
# check is. Reported, never decisive on its own.
[ "$COUNT" -gt 5 ] && REASONS+=("$COUNT files changed (>5) — weak signal, waivable")

JOINED="$(printf '%s; ' "${REASONS[@]:-}" | sed 's/; $//')"

if [ "$EVAL_MODE" = "1" ]; then
  echo "LANE=$LANE"
  echo "CHANGED_COUNT=$COUNT"
  printf "LANE_REASONS='%s'\n" "$JOINED"
  exit 0
fi

if [ "$LANE" = "HEAVY" ]; then printf '\033[33m▲ HEAVY\033[0m — %s file(s) changed\n' "$COUNT"
else printf '\033[32m● FAST\033[0m — %s file(s) changed\n' "$COUNT"; fi
[ ${#REASONS[@]} -gt 0 ] && for r in "${REASONS[@]}"; do echo "    · $r"; done
echo
if [ "$LANE" = "HEAVY" ]; then
  echo "  pipeline: architect → builder wave → code-reviewer + the reviewers the"
  echo "            reasons above name → assemble → PR → review → merge"
else
  echo "  pipeline: one builder → code-reviewer → PR → merge"
fi
exit 0
