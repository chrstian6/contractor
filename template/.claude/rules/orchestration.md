# Orchestration — running a wave

Load when: dispatching a wave, using worktrees, or harvesting a delegate's work.

## Parallel by default (MANDATORY)

The moment direction is set, execution fans out to multiple workers at once —
never one builder grinding serially through a list. Decompose into independent
slices up front and dispatch them **in a single message**; a wave sent as
sequential dispatches is serial execution wearing a swarm's clothes.

**Width is discovered, not targeted.** Five genuinely independent slices → five
builders. A task that is one shared surface → **one** builder. Forcing a second
onto a shared surface produces collisions and stalls, because `builder` correctly
stops and reports. When a task is too small to slice, **batch it with siblings**
so the wave still fans out — never split one file five ways.

Serial is the exception, reserved for slices that share a surface: a common type,
a barrel/index export, a tokens file, a route two slices both need. Do that part
first, in one dedicated slice, then fan out the rest.

## Freeze shared contracts before the wave

When several slices depend on a common type, signature or export, define it
**exactly** and mark it FROZEN, with a single owner slice. Consumers then build in
parallel against the frozen signature instead of serializing.

**Freeze EVERY cross-slice signature, not just the obvious one.** An assumption
written in a comment is not a contract, and assembly is far too late to discover
the disagreement.

## A worktree forks from the default branch, not from your branch

`isolation: "worktree"` branches from the repo's default branch — **not** from
whatever your primary checkout has checked out. So a SERIAL-FIRST slice that
freezes contracts is useless to the wave until it is **merged**. Staging it on a
feature branch and dispatching the wave against that branch gives every builder a
checkout without the contracts.

Before dispatching a wave that depends on a serial-first slice:

1. Merge the serial-first slice.
2. **Verify it landed by reading the file on the default branch** — not by
   trusting the merge command's exit code.
3. Only then dispatch.

If a slice cannot merge alone because it leaves other files broken, fix those in
the same PR. An unmergeable serial-first slice means the boundary was drawn wrong.

## A reviewer that mutates source needs its own worktree

Reviewers are told to mutation-test: break the implementation, confirm a test goes
red, revert. That makes them **writers** for the duration. A reviewer mutating a
shared checkout while another runs the suite against it produces impossible
failures that cost more to diagnose than the review was worth. Any reviewer asked
to mutate gets its own worktree; read-only reviewers can share.

## Harvest before the worktree is gone

Builders do not run git, so their work is **uncommitted** in the worktree. A
`git merge` of the worktree branch harvests nothing.

Copy the files out, or `git -C <worktree> add -A && git -C <worktree> diff HEAD
--binary` and apply the patch. **Confirm the harvest before removing anything** —
cleaning up early has already lost finished work.

## One heavyweight check at a time

Build and test runs saturate a machine. Several delegates doing that concurrently
reproduces a flake where a test fails because another delegate's build stole the
CPU — and diagnosing that costs more than the check was worth. Serialize
heavyweight checks across the primary checkout and every worktree. **Builders run
the lightest check that covers their slice**, never the full suite.
