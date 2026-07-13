<p align="center">
  <img src="assets/hard-hat.svg" width="128" height="128" alt="Contractor" />
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/contractor-kit"><img src="https://img.shields.io/npm/v/contractor-kit?color=ffd21e&label=npm" alt="npm version" /></a>
  <img src="https://img.shields.io/badge/license-MIT-141414" alt="MIT" />
  <img src="https://img.shields.io/badge/node-%3E%3D16-f5b800" alt="node >=16" />
</p>

<p align="center"><b><code>npx contractor-kit</code></b> — install a senior-contractor workflow into any repo in one command.</p>

# Contractor

**A disciplined, delegation-driven workflow for Claude.**
Drop it into any repo and Claude starts working like a senior engineering
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
  CLAUDE.md                     #   Claude's instructions (Research → Plan → Execute → Review)
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
# Published on npm — the short name just works:
npx contractor-kit

# Or run straight from GitHub (no npm needed):
npx github:chrstian6/contractor
```

Both copy `CLAUDE.md` + `.claude/` in.

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

> No npm install needed — `npx` downloads and runs it on demand. You can also run
> it straight from GitHub: `npx github:chrstian6/contractor`.

## Distribution

Contractor is published two ways — use whichever you prefer:

- **npm:** [`contractor-kit`](https://www.npmjs.com/package/contractor-kit) → `npx contractor-kit`
- **GitHub:** [`chrstian6/contractor`](https://github.com/chrstian6/contractor) → `npx github:chrstian6/contractor`

Licensed **MIT** (see [`LICENSE`](LICENSE)) — free to use, fork, and adapt.

### Cutting a new version

```bash
npm version patch                 # bump version (patch | minor | major)
npm publish --access public       # requires an npm auth token with publish rights
git push --follow-tags
```

> First-publish note: creating a brand-new npm package name needs an auth token
> with write access to **all packages** (a Classic *Automation* token, or a
> granular token scoped to _All packages_ + Read/write). A granular token limited
> to "only select packages" can't create a name that doesn't exist yet.

## Provenance

Distilled from a real, project-specific agent setup into a project-agnostic
template. No personal paths, handles, or one-project references ship in
`template/` — verify before every publish with:

```bash
grep -rIn "/Users/\|/home/" template/   # should return nothing
```
