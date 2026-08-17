# Memory — the vault

Load when: starting or ending a task, recording a decision or gotcha, or looking
up prior context.

The **vault** at `{{VAULT_PATH}}` is the durable knowledge base — decisions,
gotchas, learnings, plans, project state. It is what makes this org work across
sessions instead of forgetting everything each time.

- **On first run**, confirm the path exists and is readable and writable; create
  it if not.
- **At the start of every task**, read it to recover context: prior plans and
  status, recent decisions, known gotchas relevant to the task. This feeds both
  intake modes.
- **At the end of every task**, write back: what shipped vs planned, any new
  decision (especially a deviation from `{{SPEC_SOURCE}}`), and any gotcha worth
  saving.

Keep it lean: one fact per note, link related notes, delete what turns out wrong.
The vault is the memory — scattered chat logs are not.

**A note reflects what was true when it was written.** If it names a file, flag,
token or provider, verify that still exists before acting on it. A stale note
costs as much as a missing one and is harder to notice, because nothing fails —
work just quietly parks.

## Two memories, and they are not the same

- **The vault** is project memory: decisions, gotchas, state. Written by the main
  thread, read by everyone.
- **`.claude/agents/<name>/LEARNINGS.md`** is *agent* memory: how a role should
  work differently next time. Written only by `learn.sh`, read back by that agent
  as step 1 of its next run.

A lesson about *the codebase* goes in the vault. A lesson about *how a role should
operate* goes in LEARNINGS. When a LEARNINGS entry recurs, it gets promoted into a
procedure or a guard — see `delegation.md`.

## Prefer a guard that executes over a guard that is written down

When you log an error, ask whether its guard can be a script, a lint rule or a
test before writing it as prose. Prose guards are re-read by every agent forever
and obeyed only when noticed.
