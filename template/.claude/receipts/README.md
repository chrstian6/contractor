# Review receipts

Evidence for the review gate. `require-review-receipt.sh` reads this directory on
every `gh pr merge` (and every `git merge` into a protected branch) and blocks the
merge unless the branch has a valid receipt here.

**The orchestrator writes these. Nothing else can** — a subagent writing its own
receipt would be self-approval, so both `protect-files.sh` (Edit/Write) and
`orchestrator-only-git.sh` (shell) reject it.

One file per branch, named after the branch with `/` and any other
non-alphanumeric character replaced by `-`:

    feature/add-billing  ->  .claude/receipts/feature-add-billing.json

```json
{
  "branch": "feature/add-billing",
  "head_sha": "9f1c2ab…",
  "reviews": [
    {"agent": "code-reviewer",     "verdict": "pass",   "notes": "no findings"},
    {"agent": "security-reviewer", "verdict": "waived", "notes": "IDOR risk N/A — route is admin-only, see PR thread"}
  ]
}
```

A merge is allowed only when all of these hold:

- the file exists and is valid JSON;
- `head_sha` equals the branch tip **right now** — push another commit and the
  receipt goes stale, so the review tier re-runs against the new head;
- `reviews` names **≥2 distinct** agents;
- every verdict is `pass`, `approved`, or `waived` (a `waived` verdict needs a
  reason in `notes` — that is the record of a deliberate exception).

Write the receipt **last**, after the review fixes are committed and pushed.
A receipt written before the final commit is stale by construction.

These files are local run artifacts, not source — the installer adds
`.claude/receipts/` to your `.gitignore`.

Audited escape hatch: `CLAUDE_SKIP_REVIEW_RECEIPT=1` disables the gate. Announce
it when you use it.
