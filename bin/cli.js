#!/usr/bin/env node
'use strict';

// Contractor installer — `npx contractor-kit`
// Copies CLAUDE.md + .claude/ (agents, hooks, rules, settings/permissions) into
// the current repo. Unlike a plain copy, it OVERWRITES existing files — but asks
// permission first and backs up whatever it replaces.
//
// Flags:
//   --force / -y   overwrite everything without prompting (still writes .bak backups)
//   --no-backup    skip .bak backups when overwriting
//   --dry-run      show what would happen, change nothing
//   --help / -h

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const argv = process.argv.slice(2);
const SUBCMD = argv.find((a) => !a.startsWith('-')); // e.g. "fill"
const args = new Set(argv);
const FORCE = args.has('--force') || args.has('-y');
const NO_BACKUP = args.has('--no-backup');
const DRY = args.has('--dry-run');
if (args.has('--help') || args.has('-h')) {
  console.log(`contractor — install the Contractor agent OS into this repo

Usage: npx contractor-kit [options]

Options:
  -y, --force     overwrite existing files without asking (backups still written)
      --no-backup do not write .bak files when overwriting
      --dry-run   preview changes without writing
  -h, --help      show this help

Overwrites CLAUDE.md and .claude/ by design; you are prompted before each
existing file is replaced unless --force is given.

After copying, it asks for an approval mode (ask / readonly / all). --force and
non-interactive installs get "ask". Change it later from inside Claude with
/auto-approve, or with: python3 .claude/scripts/auto-approve.py [status|on|readonly|off]`);
  process.exit(0);
}

const TEMPLATE = path.join(__dirname, '..', 'template');
const DEST = process.cwd();

// ---- `contractor fill` : substitute {{PLACEHOLDERS}} from contractor.config ----
if (SUBCMD === 'fill') {
  const cfgPath = path.join(DEST, 'contractor.config');
  if (!fs.existsSync(cfgPath)) {
    console.error('✗ No contractor.config found. Run: cp contractor.config.example contractor.config');
    process.exit(1);
  }
  const cfg = {};
  for (const line of fs.readFileSync(cfgPath, 'utf8').split('\n')) {
    if (line.trim().startsWith('#')) continue;
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (v[0] === '"' || v[0] === "'") {
      const q = v[0];
      const end = v.indexOf(q, 1);
      v = end > 0 ? v.slice(1, end) : v.slice(1);      // content between quotes
    } else {
      v = v.replace(/\s+#.*$/, '').trim();             // unquoted: drop inline comment
    }
    cfg[m[1]] = v;
  }
  const defaults = {
    OWNER_HANDLE: '', COLLABORATOR_HANDLES: 'none', DEFAULT_BRANCH: 'main',
    SPEC_SOURCE: 'the plan doc', DESIGN_SOURCE: 'the design doc',
    VAULT_PATH: './docs', OUT_OF_SCOPE: 'none',
    ORCHESTRATOR_MODEL: 'claude-fable-5', THINKING_MODEL: 'opus', BUILDER_MODEL: 'sonnet',
  };
  const val = (k) => (cfg[k] && cfg[k].length ? cfg[k] : defaults[k]);

  const targets = ['CLAUDE.md'];
  // Walk ALL of .claude/, not just agents/. Two reasons, both learned the hard
  // way: agents live one folder deep, so a flat readdir fills nothing while
  // still reporting success; and .claude/rules/*.md carry placeholders too —
  // they shipped unfilled in 2.0.0-2.1.0 because this list named only agents/.
  // Walking the whole directory means a future file with placeholders is covered
  // without anyone remembering to extend this.
  const claudeDir = path.join(DEST, '.claude');
  if (fs.existsSync(claudeDir)) {
    for (const rel of walk(claudeDir, '.claude', [])) {
      if (rel.endsWith('.md')) targets.push(rel);
    }
  }

  let filled = 0;
  for (const rel of targets) {
    const p = path.join(DEST, rel);
    if (!fs.existsSync(p)) continue;
    let text = fs.readFileSync(p, 'utf8');
    for (const k of Object.keys(defaults)) text = text.split('{{' + k + '}}').join(val(k));
    fs.writeFileSync(p, text);
    filled++;
  }

  const vault = val('VAULT_PATH');
  const vaultAbs = path.isAbsolute(vault) ? vault : path.join(DEST, vault);
  if (!fs.existsSync(vaultAbs)) { fs.mkdirSync(vaultAbs, { recursive: true }); console.log(`  vault: created ${vault}`); }
  else console.log(`  vault: ${vault} already exists`);

  console.log(`✓ Filled placeholders in ${filled} file(s). Review the diff, then commit on a branch.`);
  process.exit(0);
}

if (!fs.existsSync(TEMPLATE)) {
  console.error('✗ template/ not found next to the CLI. Is the package intact?');
  process.exit(1);
}
if (!fs.existsSync(path.join(DEST, '.git'))) {
  console.error('✗ Run this from the root of a git repository (no .git/ here).');
  process.exit(1);
}

// Collect every file in template/ as a list of repo-relative paths.
function walk(dir, base, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    const rel = path.join(base, entry.name);
    if (entry.isDirectory()) walk(abs, rel, out);
    else out.push(rel);
  }
  return out;
}
const files = walk(TEMPLATE, '', []);

// Hooks and scripts are invoked directly by the engine, so they must land +x.
// `agents/_lib` holds learn.sh, which every agent calls as a shell command at the
// start and end of its run — without +x the self-improvement loop dies on install.
const EXECUTABLE = /^(\.claude\/(hooks|scripts|agents\/_lib)\/.*\.(sh|py)|scripts\/(verify\/.*\.mjs|classify-change\.sh))$/;

// ---- clean up a pre-2.0 install ---------------------------------------------
// 2.0 moved agents from `.claude/agents/<name>.md` to
// `.claude/agents/<name>/AGENT.md`, and removed the `orchestrator` role. The
// copy above adds the new files but cannot know to remove the old ones, so an
// upgraded repo ends up with BOTH — two definitions claiming the same agent
// `name`, and an orchestrator file that the dispatch guard now denies. Telling
// people to delete them in the README is a guard that only works when read.
//
// Nothing is deleted: leftovers move to `.claude/agents-1x-backup/`, which is
// outside the directory the agent loader scans, so a stale `.md` cannot be
// picked up from there either.
function findLegacyAgents() {
  const agentsDir = path.join(DEST, '.claude', 'agents');
  if (!fs.existsSync(agentsDir)) return [];
  const stale = [];
  for (const e of fs.readdirSync(agentsDir, { withFileTypes: true })) {
    const abs = path.join(agentsDir, e.name);
    if (e.isFile() && e.name.endsWith('.md')) {
      // A TOP-LEVEL .md carrying `name:` frontmatter is a pre-2.0 definition.
      // The shipped agents/README.md has no frontmatter, so it never matches —
      // the same test the agent loader itself uses to tell an agent from a doc.
      let head = '';
      try { head = fs.readFileSync(abs, 'utf8').slice(0, 2048); } catch { continue; }
      if (/^---\s*\r?\n[\s\S]*?^name:\s*\S/m.test(head)) stale.push(e.name);
    } else if (e.isDirectory() && e.name === 'orchestrator') {
      // The role was removed in 2.0 — the orchestrator IS the main thread.
      stale.push(e.name);
    }
  }
  return stale;
}

function moveLegacyAgents(names) {
  const agentsDir = path.join(DEST, '.claude', 'agents');
  const backupDir = path.join(DEST, '.claude', 'agents-1x-backup');
  fs.mkdirSync(backupDir, { recursive: true });
  let moved = 0;
  for (const n of names) {
    const from = path.join(agentsDir, n);
    let to = path.join(backupDir, n);
    let i = 1;
    while (fs.existsSync(to)) to = path.join(backupDir, `${n}.${i++}`);
    try { fs.renameSync(from, to); moved++; }
    catch (e) { console.log(`  could not move ${n}: ${e.message}`); }
  }
  return moved;
}

function cleanupLegacyInstall() {
  const stale = findLegacyAgents();
  if (!stale.length) return;

  console.log(`\n  Cleaning up ${stale.length} leftover(s) from a pre-2.0 install:`);
  for (const n of stale) console.log(`    .claude/agents/${n}`);
  console.log(`  These collide with the new .claude/agents/<name>/AGENT.md layout —`);
  console.log(`  two files claiming the same agent name — and 'orchestrator' is denied`);
  console.log(`  by the dispatch guard in 2.0.`);

  if (DRY) { console.log(`  would move them to .claude/agents-1x-backup/ (dry-run)`); return; }

  // Automatic and unprompted, deliberately. Nothing is deleted — these move to
  // .claude/agents-1x-backup/, outside the directory the agent loader scans — so
  // there is nothing to consent to, and a prompt here would be one more thing
  // that can hang or be dismissed on an upgrade that is already non-obvious.
  const moved = moveLegacyAgents(stale);
  console.log(`  ✓ Moved ${moved} to .claude/agents-1x-backup/ (nothing deleted; your`);
  console.log(`    LEARNINGS.md files were not touched). Delete that folder once happy.`);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((res) => rl.question(q, (a) => res(a.trim().toLowerCase())));

async function main() {
  console.log(`\nContractor → installing into ${DEST}`);
  console.log(`This OVERWRITES existing CLAUDE.md and .claude/ files (a .bak backup is kept).\n`);

  let overwriteAll = FORCE;
  let added = 0, replaced = 0, skipped = 0;

  for (const rel of files) {
    const src = path.join(TEMPLATE, rel);
    const dst = path.join(DEST, rel);
    const exists = fs.existsSync(dst);

    if (exists && !overwriteAll) {
      const a = await ask(`  ${rel} exists — overwrite? [y]es / [n]o / [a]ll / [q]uit: `);
      if (a === 'q') { console.log('Aborted.'); break; }
      if (a === 'a') overwriteAll = true;
      else if (a !== 'y') { console.log(`  skip  ${rel}`); skipped++; continue; }
    }

    if (DRY) { console.log(`  ${exists ? 'REPLACE' : 'add    '} ${rel} (dry-run)`); exists ? replaced++ : added++; continue; }

    fs.mkdirSync(path.dirname(dst), { recursive: true });
    if (exists && !NO_BACKUP) fs.copyFileSync(dst, dst + '.bak');
    fs.copyFileSync(src, dst);
    if (EXECUTABLE.test(rel)) fs.chmodSync(dst, 0o755);

    console.log(`  ${exists ? 'replace' : 'add    '} ${rel}${exists && !NO_BACKUP ? '  (backup → ' + rel + '.bak)' : ''}`);
    exists ? replaced++ : added++;
  }

  // Before the dry-run bail-out: a preview that omits the cleanup is not a
  // preview of what the install actually does.
  cleanupLegacyInstall();

  if (DRY) { rl.close(); console.log(`\nDry run: ${added} to add, ${replaced} to replace, ${skipped} skipped.`); return; }

  console.log(`\n✓ Contractor installed — ${added} added, ${replaced} replaced, ${skipped} skipped.`);

  ignoreReceipts();

  const mode = await chooseApprovalMode();
  rl.close();
  applyApprovalMode(mode);

  console.log(`\nNext:`);
  console.log(`  1. cp contractor.config.example contractor.config   # edit owner, vault, spec/design source`);
  console.log(`  2. npx contractor-kit fill                          # fills placeholders + creates the vault`);
  console.log(`  3. Set the orchestrator model in your client:  /model claude-fable-5`);
  console.log(`  4. Work on a branch — Contractor is now driving.`);
  console.log(`\nChange the approval mode any time with  /auto-approve [status|on|readonly|off]\n`);
}

// ---- review receipts are local run artifacts, not source ----

function ignoreReceipts() {
  const RULE = '.claude/receipts/';
  const gi = path.join(DEST, '.gitignore');
  try {
    const current = fs.existsSync(gi) ? fs.readFileSync(gi, 'utf8') : '';
    if (current.split(/\r?\n/).some((l) => l.trim() === RULE)) return;
    const prefix = current === '' ? '' : current.endsWith('\n') ? '\n' : '\n\n';
    fs.appendFileSync(gi, `${prefix}# Contractor review receipts (local run artifacts)\n${RULE}\n`);
    console.log(`  + .gitignore   ${RULE}`);
  } catch (err) {
    console.log(`  ! could not add '${RULE}' to .gitignore (${err.message}) — add it yourself.`);
  }
}

// ---- onboarding: how much should Claude ask before it acts? ----

async function chooseApprovalMode() {
  console.log(`
────────────────────────────────────────────────────────────────
  Approval mode — how much should Claude ask before it acts?
────────────────────────────────────────────────────────────────

  The guardrails are ON in every mode. Secret scanning, dangerous-command
  blocking, file protection, orchestrator-only git, and the deny list are
  always enforced — a guard's "deny" always beats an auto-approval.
  What you're choosing is only whether you get PROMPTED for the rest.

  [1] ask      — normal permission prompts.            (default, recommended)
                 You approve each call the allow-list doesn't already cover.

  [2] readonly — auto-approve provably read-only calls.
                 Reads and searches stop nagging; anything that writes asks.

  [3] all      — auto-approve everything the guards don't block.
                 For unattended loops. Nobody is watching the prompt, so
                 nothing stalls on one. Reversible: /auto-approve off,
                 or CLAUDE_AUTO_APPROVE=0 in the environment.
`);
  if (FORCE || !process.stdin.isTTY) {
    console.log('  → ask (non-interactive install)\n');
    return 'off';
  }
  for (;;) {
    const a = await ask('  Choose [1/2/3] (default 1): ');
    if (a === '' || a === '1' || a === 'ask') return 'off';
    if (a === '2' || a === 'readonly') return 'readonly';
    if (a === '3' || a === 'all' || a === 'on') return 'on';
    console.log('  Enter 1, 2, or 3.');
  }
}

function applyApprovalMode(mode) {
  const script = path.join(DEST, '.claude', 'scripts', 'auto-approve.py');
  if (mode === 'off') { console.log('\n  Approval mode: ask (normal permission prompts).'); return; }
  if (!fs.existsSync(script)) { console.log('\n  ! .claude/scripts/auto-approve.py missing — left in "ask" mode.'); return; }
  const r = require('child_process').spawnSync('python3', [script, mode], { cwd: DEST, encoding: 'utf8' });
  if (r.status === 0) process.stdout.write('\n  ' + (r.stdout || '').trim() + '\n');
  else console.log(`\n  ! Could not set approval mode (${(r.stderr || '').trim() || 'python3 not found'}) — left in "ask" mode.
    Set it later with:  python3 .claude/scripts/auto-approve.py ${mode}`);
}

main().catch((e) => { rl.close(); console.error('✗', e.message); process.exit(1); });
