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
existing file is replaced unless --force is given.`);
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
    THINKING_MODEL: 'opus', BUILDER_MODEL: 'sonnet',
  };
  const val = (k) => (cfg[k] && cfg[k].length ? cfg[k] : defaults[k]);

  const targets = ['CLAUDE.md'];
  const agentsDir = path.join(DEST, '.claude', 'agents');
  if (fs.existsSync(agentsDir)) for (const f of fs.readdirSync(agentsDir)) if (f.endsWith('.md')) targets.push(path.join('.claude', 'agents', f));

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
    if (rel.startsWith('.claude/hooks/') && rel.endsWith('.sh')) fs.chmodSync(dst, 0o755);

    console.log(`  ${exists ? 'replace' : 'add    '} ${rel}${exists && !NO_BACKUP ? '  (backup → ' + rel + '.bak)' : ''}`);
    exists ? replaced++ : added++;
  }

  rl.close();
  if (DRY) { console.log(`\nDry run: ${added} to add, ${replaced} to replace, ${skipped} skipped.`); return; }

  console.log(`\n✓ Contractor installed — ${added} added, ${replaced} replaced, ${skipped} skipped.`);
  console.log(`\nNext:`);
  console.log(`  1. cp contractor.config.example contractor.config   # edit owner, vault, spec/design source`);
  console.log(`  2. npx contractor-kit fill                          # fills placeholders + creates the vault`);
  console.log(`  3. Set the orchestrator model in your client:  /model claude-fable-5`);
  console.log(`  4. Work on a branch — Contractor is now driving.\n`);
}

main().catch((e) => { rl.close(); console.error('✗', e.message); process.exit(1); });
