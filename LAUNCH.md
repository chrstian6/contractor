# Contractor Kit — Launch Copy

Package: https://www.npmjs.com/package/contractor-kit
Repo: https://github.com/chrstian6/contractor

---

## X / Twitter (thread)

**1/**
Just shipped Contractor 🪖 — a delegation-driven OS for AI coding agents.

One command drops a senior-contractor workflow into any repo:

    npx contractor-kit

Your agent stops freewheeling on your code and starts working like an engineering team. 🧵

**2/**
The core rule: Research → Plan → Execute → Review.

The agent never codes first. It investigates, designs, THEN builds — every change on its own branch behind a PR with independent review. It never touches your default branch directly.

**3/**
It installs a whole org:
• orchestrator owns strategy + git
• task-manager breaks down work
• architect designs (design only)
• builder swarm writes code in parallel
• independent reviewers check it

No agent both writes code and approves its own work.

**4/**
Plus guardrail hooks that run automatically:
🔒 secret scanning
🛑 dangerous-command blocking
🗂️ file protection
⚠️ large-file warnings

MIT, project-agnostic, works with whatever models you run.

    npx contractor-kit

⭐ github.com/chrstian6/contractor

---

## Reddit / Hacker News (Show HN)

**Title:** Show HN: Contractor – a delegation-driven operating system for AI coding agents

**Body:**

I kept hitting the same problem with AI coding agents: give one a task and it dives straight into editing files, invents behavior that isn't in the spec, and happily commits to main. It behaves like a solo hacker, not an engineer on a team.

Contractor is my attempt to fix that with structure instead of hope. It's a `CLAUDE.md` operating system + a `.claude/` folder of agents, hooks, and guardrails that you drop into any repo:

    npx contractor-kit
    # or straight from GitHub:
    npx github:chrstian6/contractor

What it enforces:

- **Research → Plan → Execute → Review.** The agent investigates and designs before writing a line of code.
- **A delegation org.** An orchestrator owns strategy and git; a task-manager decomposes work; an architect designs (design only); a builder swarm implements in parallel; independent reviewers check the output. Critically, no agent both writes code and approves its own work.
- **Branch safety.** Every change lands on its own branch behind a PR with independent review — never a direct commit to the default branch.
- **A spec engine.** A named source of truth is the executable spec, so agents don't invent behavior.
- **Guardrail hooks** that run automatically: secret scanning, dangerous-command blocking, file protection, large-file warnings.
- **Model tiers** you map to whatever models you run (orchestrator / thinking / builder).

It's a project-agnostic distillation of a setup I'd been running on real work — personal paths and one-project specifics stripped out and replaced with placeholders you fill once.

MIT licensed. Feedback and PRs welcome.

npm: https://www.npmjs.com/package/contractor-kit
Repo: https://github.com/chrstian6/contractor

---

## Facebook

🪖 New project: **Contractor Kit**

If you use AI coding assistants, you've probably seen them barrel straight into your code — editing files, making stuff up, committing to your main branch. Contractor makes an AI agent behave like a disciplined engineering team instead.

One command installs it into any repo:

    npx contractor-kit

What you get:
✅ Research → Plan → Execute → Review (never codes first)
✅ A full delegation org — orchestrator, architect, builder swarm, independent reviewers (no agent approves its own work)
✅ Every change on its own branch + PR review — never a direct commit to main
✅ Automatic guardrails: secret scanning, dangerous-command blocking, file protection

Free and open source (MIT).

👉 github.com/chrstian6/contractor
