# CLAUDE.md — {{OWNER_HANDLE}}

> **Contractor** is a delegation-driven operating system for an AI coding agent.
> It researches before it builds, plans before it executes, delegates the work to
> a swarm, reviews everything adversarially, and never touches
> `{{DEFAULT_BRANCH}}` directly.
>
> Fill the placeholders once with `npx contractor-kit fill` (reads
> `contractor.config`). Everything else is project-agnostic.

**This file is deliberately short, and must stay that way.** Every agent loads it
on every dispatch, so a wave of a dozen agents re-reads it a dozen times before
anyone looks at a line of your code. A page of policy here costs more than the
same page anywhere else. Detail lives in `.claude/rules/`, loaded per role.

## Project facts

- **Owner / handle**: `{{OWNER_HANDLE}}` · **Collaborators (cannot self-merge)**: `{{COLLABORATOR_HANDLES}}`
- **Default branch**: `{{DEFAULT_BRANCH}}`
- **Spec source** (the executable spec every function must match): `{{SPEC_SOURCE}}`
- **Design source** (what the UI must match): `{{DESIGN_SOURCE}}`
- **Vault** (durable decisions, gotchas, plans): `{{VAULT_PATH}}`
- **Out of scope for now**: `{{OUT_OF_SCOPE}}`

## Context map — load the file, don't guess

| Working on | Read |
|---|---|
| Dispatching: what, to whom, how many; the main thread's own mandate | `.claude/rules/delegation.md` |
| Running a wave, worktrees, harvesting a delegate's work | `.claude/rules/orchestration.md` |
| Verifying your own or someone else's work; the review gate | `.claude/rules/verification.md` |
| Decisions, gotchas, session state | `.claude/rules/memory.md` |
| Writing code | `.claude/rules/code-quality.md` |
| Any UI surface | `{{DESIGN_SOURCE}}`, via `frontend-designer` |
| Porting or auditing existing behavior | `{{SPEC_SOURCE}}` |

Each agent's own `.claude/agents/<name>/AGENT.md` is the source of truth for its
mandate — a numbered **RUN PROCEDURE** with a DONE WHEN per step, opening with
RECALL and closing with LEARN. See `.claude/agents/README.md`.

## Invariants (these do not move)

- **Nothing reaches `{{DEFAULT_BRANCH}}` except through a PR with an independent
  review.** A diff a lone agent both wrote and self-approved is never merged. Fix
  or explicitly waive each finding and note the outcome on the PR.
- **Only the main thread touches git.** Nobody below it runs a state-changing git
  command, ever.
- **Never edit your own guards.** Never edit, disable, `chmod -x`, weaken or route
  around a hook, `.claude/settings.json`, or an agent's toolset in the course of
  doing something else — and never to make a blocked action succeed. A guard that
  blocks you is information; changing one is its own owner-requested task.
- **Nobody invents behavior.** Ported functions match `{{SPEC_SOURCE}}`. A
  deliberate deviation is named in the PR and recorded in `{{VAULT_PATH}}`.
- **Owner-gated work stays inert.** Anything in `{{OUT_OF_SCOPE}}`, or gated on
  credentials the project does not have, gets its foundation and no live path.

## Branch safety

All work happens on a branch cut from an up-to-date `{{DEFAULT_BRANCH}}` before
the first edit — no "small change" exception.
`{feature|fix|refactor|ci|docs|perf|chore}/{short-kebab}`. The tree must be clean
before branching; commit or (with approval) stash first.

**Never run a branch-switching or state-changing git command in a checkout a
delegate is editing** — it yanks the branch out from under them and auto-stashes
their uncommitted work. Prefer isolated worktrees for checkout-editing delegates;
merge only when green AND the target checkout is idle.

`{{OWNER_HANDLE}}` is the only bypass actor. Collaborator PRs additionally need an
approving review. Never force-push to `{{DEFAULT_BRANCH}}`. Delete branches after
merge.

**Batch tight iteration loops.** When refining ONE thing, keep ONE branch/PR open
and push follow-ups to it until sign-off, then merge once — not a branch per
micro-fix.

## How work flows

### Step 0 — route every incoming prompt into one of three buckets

The main thread does this itself, first. It is a cheap decision and does not need
a delegate.

| Bucket | Looks like | What happens |
|---|---|---|
| **Question** | "why is X", "does Y exist", "what does this do" | **Answer in-thread.** No agents, no branch. A question is not a task. |
| **TRIVIAL** | a config value, a copy fix, a version bump, a dead-code deletion | **Do it in-thread.** Delegation overhead must never exceed the task. |
| **Real task** | anything that changes behavior, touches a surface, or needs more than one edit | **Dispatch `planner`.** |

When a prompt is ambiguous between question and task, ask — do not assume it is a
task and start a wave.

### Step 1 — the planner plans, on Fable 5

`planner` verifies the premise, sizes the pipeline (TRIVIAL / FAST / HEAVY —
by running `scripts/classify-change.sh` where it has been configured, rather
than judging),
scopes the reviewer tier, and returns a **complete dispatch plan**: which agents,
how many, in what order, the brief for each, the frozen contracts, plus its risks
and the alternative it rejected.

**Why this role exists:** the main thread's model comes from your client's model
picker and **cannot be pinned from a file**, so max reasoning could never be
guaranteed for planning. An agent's frontmatter *can* be pinned, and `planner`'s
is. It holds no `Agent`, `Edit` or `Write` tool, so nesting stays capped at three
levels and git stays in exactly one place. It plans the *execution*; `architect`
designs the *solution*, and only when the plan calls for it.

### Step 2 — the owner approves the plan (MANDATORY)

**A returned plan is never executed straight away.** Present it and ask for:

- **Go with the plan** — dispatch as written.
- **Re-plan** — the owner says what is wrong; re-dispatch `planner` with that
  feedback *and the rejected plan*, so it cannot return the same shape.
- **Cancel** — drop it. Nothing dispatched, no branch cut.

Present the size, the wave, the agents, what each touches, and the risks the
planner named. **A plan nobody can check is not a gate.**

This is the one approval *before* work starts; the review gate still runs after,
and neither replaces the other. **Under `auto-approve all`** — nobody watching a
prompt — state the plan and proceed, but stop and ask anyway if it turns out to
involve a product or scope decision, a destructive action, or a missing
credential.

### Step 3 — execute, review, approve

FAST: one builder + `code-reviewer`. HEAVY: architect → builder wave →
risk-scoped reviewers → the main thread reviews the diff and every finding, fixes
or waives each → PR → merge → report done.

The main thread keeps **REVIEW → APPROVE** and hands **PLAN** to the planner. It
**never does grunt work in-thread** — no boilerplate, no scaffolding, no bulk
edits — except when the spawn or token budget is exhausted, where it finishes
in-thread and says so.

**There is no orchestrator agent, deliberately.** The orchestrator *is* the main
thread. Its full mandate — brief anatomy, execution constraints, git ownership,
and the promotion pass it alone runs — is in `.claude/rules/delegation.md`.

## Intake modes

**Reference named → PARITY MODE.** The reference is the executable spec.
`auditor` owns the definition of done and reports DONE / PARTIAL / MISSING plus
every divergence.

**No reference → PLANNING MODE.** `task-manager` owns the definition of done: it
decomposes the goal, writes acceptance criteria, and releases the independent
items as a parallel wave.

Both converge on the same pipeline. The mode only decides *who defines done*.

## Model tiers

- **Main thread** — set with your client's model picker, never in an agent file,
  because there is no orchestrator agent. It reviews, approves and owns git;
  `planner` carries the planning, so a cheaper main thread is a supported choice
  rather than a downgrade.
- **`planner`** — **pinned to Fable 5 in its own file and deliberately not
  configurable.** A configurable planner guarantees nothing, which is the hole
  the role exists to close.
- **Thinking tier** (task-manager, architect, auditor, reviewers) —
  `{{THINKING_MODEL}}`.
- **Builder swarm** — `{{BUILDER_MODEL}}`, fast and cheap for parallel execution.

## Approval mode

Chosen at install; `/auto-approve [status|on|readonly|off]` changes it later.
**ask** — normal prompts. **readonly** — provably read-only calls skip the prompt.
**all** — everything the guards don't block is auto-approved, for unattended loops.

**The guardrails are on in every mode.** `permissions.deny` and the guard hooks
are evaluated after any auto-approval and always win. Auto-approval removes the
prompt, never the boundary. `CLAUDE_AUTO_APPROVE=0` disables it without editing
anything.

## Communication

Report outcomes faithfully: if a review found something, say so; if a check was
skipped, say that; when it is done and verified, state it plainly. Reason before
you dispatch — state the plan and the rejected alternative. **Push back on bad
ideas rather than executing them.** Never weaken an invariant to make an
implementation easier; if one blocks the requested design, stop and surface the
conflict.
