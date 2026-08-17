# Verification and the review gate

Load when: verifying your own work, or reviewing someone else's.

## The review gate (NO PR, NO APPROVAL, NO MERGE)

Every task's output passes **at least two independent reviewers** scoped to its
real risk surface before merge. See `delegation.md` for which reviewers a change
earns.

**A task a lone agent both wrote and self-approved is never merged.** Fix or
explicitly waive each finding, and note the outcome on the PR. Require green
checks.

Where a review-receipt hook is installed, it blocks the merge until ≥2 distinct
reviewers are on record against **the exact commit being merged** — so a receipt
goes stale the moment another commit lands and the review must be re-run. Only the
main thread can write a receipt; a subagent writing its own would be
self-approval.

## Rules paid for in real defects

- **Verify the task's PREMISE before building.** Tasks have been justified by
  "the spec does X" where it did not. If the premise is wrong, STOP and report —
  never build the nearest plausible thing.
- **Mutation-test any test guarding an invariant that has burned this project
  before.** "The tests pass" and "the tests would fail if this were wrong" are
  different claims, and only the second one is worth anything.
- **Verify a push or a merge by inspecting the result, not the exit code.** A
  blocked compound command can leave a commit unmade while the chain still reports
  success.
- **Assemble and run the checks before review.** Slices that each pass in
  isolation routinely disagree at the seams; a per-slice check does not cover it.
- **A metric or control that cannot fail loudly must be assumed broken** until
  proven otherwise. Counters and guards that swallow their own errors ship
  recording nothing while appearing installed.
- **Copy a schema or migration definition forward from the highest-numbered file
  that defines it**, verified by scanning, never from the one you remember.
  Migrations replay in order, so copying from a stale definition silently reverts
  newer work with nothing failing.

## Never report a verdict you had to read out of a log

Piping a check through `tail` and reading the summary reports green while failures
scroll past above the fold. It has reached an owner as a clean gate more than once.

The fix is not "grep harder" — it is to never be in the position of parsing output
to learn a verdict. Run the check, report from its **exit code**, and print the log
only when it is nonzero. If you find yourself piping a check through `tail`, stop.

## Local checks vs CI

**Local agent checks are fast-only**: typecheck, lint, build, and the tests scoped
to what changed. The full/integration/e2e suite, coverage, security audit and
deploys are CI's job.

**A migration ships in two places.** Merging a migration PR lands the files. It
does not change the database. If your host auto-deploys the default branch, the
moment that PR merges production runs code whose schema expects columns the
database does not have. Apply the migration deliberately and **verify the deployed
shape by querying the changed table** — "migrations applied successfully" has been
printed during an outage. The task is not done at merge.
