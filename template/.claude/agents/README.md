# The agent org — layout and conventions

One folder per agent. Claude Code loads `.claude/agents/**/*.md` **recursively**,
so the nesting is free; a file is only treated as an agent definition if its
frontmatter carries a `name:`. Everything else in the folder is a co-located doc.

```
.claude/agents/
  _lib/learn.sh            # the self-improvement loop, executable
  <agent>/
    AGENT.md               # the definition — has `name:` frontmatter, IS the agent
    LEARNINGS.md           # no frontmatter → a doc, not an agent. Append-only.
```

## Why `AGENT.md` and not `<agent>.md`

Two files in the **same directory** whose frontmatter `name` matches collide —
the loser is discarded silently and the winner follows unsorted `readdir` order,
so which definition is live can differ between machines. One agent per folder
makes that collision structurally impossible.

It also means a single glob — `**/.claude/agents/**/AGENT.md` — names every
mandate in the org, which is what a deny rule needs to protect them all at once.

## The definitions are RUN PROCEDURES, not prompts

Each `AGENT.md` is a numbered sequence of steps, each with a **DONE WHEN** line,
bookended by a RECALL step and a LEARN step, and closed by a **HARD STOPS**
block. This is deliberate:

- A prose prompt is obeyed when remembered. A numbered step with a completion
  condition is checkable — by the agent, and by whoever reads the hand-back.
- It matches the doctrine the rest of this repo already runs on: *prefer a guard
  that executes over a guard that is written down* .
  Where a step can be a command, it is written as a command.

When you edit a definition, keep the shape: steps in execution order, one
**DONE WHEN** each, commands as commands.

## Load in proportion to the task

An agent that loads everything it *might* need, every time, is not being thorough
— it is being expensive, and whoever is waiting pays for it. Measured in a live
run of one org's designer: **~121k tokens consumed before it had looked at a
single screen**, against a ~13k floor. The cause was two steps marked MANDATORY
that never said *how much*.

Two rules that keep it bounded, and both belong in any step that reads something
large:

1. **Size the task first.** A fix, a surface, and a system are different jobs.
   Say which one this is, and load for that. Naming the lane costs a sentence and
   saves the difference between 17k and 121k.
2. **Name the bound where the load happens.** "Read the vault" and "load the
   skill" are unbounded instructions. "Read the one or two notes that match" and
   "load the entry point and the references it names, never the directory" are
   not. Put the size of the thing next to the instruction, so the cost is visible
   at the point of decision.

When you write a new step that reads a directory, a vault, or a skill, write the
bound into the step. It is the same reasoning as bounded recall below: an
instruction that can grow without limit eventually will.

## The self-improvement loop

```
run N   step 1  →  learn.sh --list <agent>     reads LEARNINGS.md into context
run N   step Z  →  learn.sh <agent> ...        appends what this run discovered
run N+1 step 1  →  reads it back
```

`.claude/agents/_lib/learn.sh` writes a fixed schema — **Trigger / Lesson /
Guard / Promoted** — and dedupes on trigger+lesson, so a recurring lesson is one
entry rather than forty. It refuses any agent name containing a path separator,
so the loop can only ever write to `.claude/agents/<agent>/LEARNINGS.md`.

```bash
.claude/agents/_lib/learn.sh --list builder
.claude/agents/_lib/learn.sh builder "<trigger>" "<lesson>" "<guard>"
```

### Learning ≠ editing your own mandate

Agents append to `LEARNINGS.md`. **Agents never edit `AGENT.md`** — theirs or
anyone's. That separation is the whole safety property of this design: an agent
that can rewrite its own instructions can quietly delete the constraint that is
blocking it, which is exactly what CLAUDE.md's *"never edit your own guards"* invariant exists to prevent.

Note the **`Guard:` field is the point of the schema.** A lesson recorded as
prose is re-read by every future run forever and obeyed only when noticed. A
lesson promoted into a script, a lint rule, or a test is enforced whether or not
anyone remembers it. Always ask which one a lesson could be.

### Promotion

At **12 entries** `learn.sh` prints a promotion notice. Promotion is the
**orchestrator's** job, not the agent's:

1. Read the agent's `LEARNINGS.md` and group the recurring entries.
2. Turn each group into the cheapest thing that enforces it — an executable
   guard beats a `.claude/rules/` line beats a line in `AGENT.md`.
3. Mark the entry `**Promoted:** yes → <where>`. Entries are not deleted; the
   record of what was learned and where it went is the point.

## Adding an agent

1. `mkdir .claude/agents/<name>/`
2. Write `AGENT.md` with `name`, `description`, `model`, `tools` frontmatter,
   then the RUN PROCEDURE — copy the step shape from an existing one.
3. Give it a RECALL step 1 and a LEARN final step wired to `learn.sh <name>`.
4. Register it in the delegation table in `CLAUDE.md`, and add it to
   `ALLOWED_ROLES` in `.claude/hooks/role-based-dispatch.py`.
5. `tools:` **is** the role boundary. Grant only what the role needs. Only the
   orchestrator holds `Agent` and git.

`LEARNINGS.md` is created on first use — do not seed it by hand. A fabricated
learning is worse than an empty file, because it is indistinguishable from one
that was actually paid for.
