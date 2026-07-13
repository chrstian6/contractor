# Contractor

**A disciplined, delegation-driven operating system for AI coding agents.**
Drop it into any repo and your agent starts working like a senior engineering
contractor: it researches before it builds, plans before it executes, delegates
grunt work to a builder swarm, reviews everything adversarially, and never
touches your default branch directly.

Contractor is a **project-agnostic distillation** of a battle-tested `CLAUDE.md`
and `.claude/` setup — the personal paths, names, and one-project specifics
stripped out and replaced with `{{PLACEHOLDERS}}` you fill once.

## What's inside

```
bin/cli.js                      # the npx installer (`contractor` / `contractor fill`)
package.json                    # npm package manifest (bin, files, MIT)
template/                       # the payload copied into a target repo:
  CLAUDE.md                     #   the operating system (Research → Plan → Execute → Review)
  contractor.config.example     #   the placeholders to fill, once per project
  .claude/
    agents/                     #   task-manager, architect, builder, reviewer,
                                #   code-reviewer, performance-reviewer, silent-failure-hunter
    hooks/                      #   secret scan, dangerous-command block, file protection, session context
    rules/code-quality.md       #   naming, markers, anti-defaults
    settings.json               #   wires the hooks + a safe permission allow/deny list
```

**Core ideas** (full detail in `template/CLAUDE.md`):

- **Research → Plan → Execute → Review** — never execute first.
- **Branch Safety** — every change on its own branch, PR + independent review before merge, no direct commits to the default branch.
- **The Delegation Org** — orchestrator (owns strategy + git) → task-manager → architect (design only) → builder swarm (5+, parallel) → independent reviewers. No agent both writes and self-approves.
- **Spec Engine** — a named source of truth is the executable spec; nobody invents behavior.
- **Model tiers** — map orchestrator / thinking / builder to whatever models you run.

## Install into a repo (npx)

From the root of the target repo:

```bash
npx contractor-kit          # copies CLAUDE.md + .claude/ in
```

It **overwrites** an existing `CLAUDE.md` and `.claude/` files **by design** — but
prompts before replacing each one and writes a `.bak` backup of whatever it
replaces. Use `-y`/`--force` to skip the prompts, `--dry-run` to preview, or
`--no-backup` to skip backups.

Then configure once:

```bash
cp contractor.config.example contractor.config   # edit owner, vault, spec/design source
npx contractor-kit fill                           # fills placeholders + creates the vault
# set the orchestrator model in your client:
#   /model claude-fable-5
git checkout -b chore/adopt-contractor && git add -A && git commit -m "chore: adopt Contractor"
```

> No npm install needed — `npx` downloads and runs it on demand. Before publishing
> to npm you can run it straight from GitHub: `npx github:<owner>/contractor`.

## Publish so anyone can use it

1. **Push to a public GitHub repo.**
   ```bash
   cd contractor
   git init && git add -A && git commit -m "feat: Contractor v1"
   gh repo create contractor --public --source=. --push
   ```
   That alone enables `npx github:<owner>/contractor` for anyone.
2. **Publish to npm** so `npx contractor-kit` resolves by name (the name
   `contractor-kit` is registered to this package):
   ```bash
   npm login                         # once, interactive
   npm publish --access public
   ```
3. **(Optional) Mark it a template repo** (Settings → *Template repository*) for a
   click-to-copy path in addition to npx.
4. **(Optional) License** — an MIT `LICENSE` is already declared in package.json;
   add the file so it's unambiguously reusable.

## Provenance

Distilled from a real, project-specific agent setup into a project-agnostic
template. No personal paths, handles, or one-project references ship in
`template/` — verify before every publish with:

```bash
grep -rIn "/Users/\|/home/" template/   # should return nothing
```
