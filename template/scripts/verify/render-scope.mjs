#!/usr/bin/env node
// render-scope.mjs — which entry points actually reach this file, and which
// test files an edit to it will tax. Framework-agnostic; see SCAN_DIRS/ENTRY_RE.
//
// WHY THIS EXISTS. Three separate agent runs independently proposed this exact
// script before it was written, which is the signal that it should be a command
// rather than a paragraph:
//
//   * A design brief named several files as "the shared primitives". Some did
//     not exist, and the directory name did not match the real scope —
//     a directory name is not a render scope.
//   * A copy-unification brief listed the files to touch, but the surface's real
//     output came from a delegate component the list never mentioned.
//   * Adding a `useRouter()` to a LEAF component reddened 7 tests in a file
//     owned by a parallel slice, because every ancestor's test now needed an
//     app-router mock.
//
// The first two waste a wave building in the wrong place. The third breaks a
// slice you were forbidden to touch. All three are answerable by walking the
// importer graph, which is what this does.
//
// Usage:
//   node scripts/verify/render-scope.mjs components/jeweler/inbox/UnifiedRow.tsx
//   node scripts/verify/render-scope.mjs <file> --json
//
// Exit codes: 0 always (this is an informational probe, not a gate). It prints
// to stderr and still exits 0 when a file has no route — an unrendered
// component is a finding for a human, not a build failure.

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
// Scanned source roots. Every common JS/TS layout is covered; missing ones are
// skipped silently, so this works whether the repo uses app/, src/, pages/ or
// a flat lib/. Override with SCAN_DIRS=a,b in the environment.
const SCAN_DIRS = (process.env.SCAN_DIRS || "app,src,pages,components,lib,server,routes,features")
  .split(",").map((s) => s.trim()).filter(Boolean);
const EXTS = [".tsx", ".ts", ".jsx", ".js"];

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const target = args.find((a) => !a.startsWith("--"));

if (!target) {
  console.error("usage: node scripts/verify/render-scope.mjs <file> [--json]");
  process.exit(64);
}

const targetAbs = path.resolve(ROOT, target);
if (!fs.existsSync(targetAbs)) {
  console.error(`render-scope: no such file: ${target}`);
  process.exit(66);
}

// ── collect every source file once ───────────────────────────────────────────
function walk(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name === ".next" || e.name.startsWith(".")) continue;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) walk(abs, out);
    else if (EXTS.includes(path.extname(e.name))) out.push(abs);
  }
  return out;
}

const files = SCAN_DIRS.flatMap((d) => walk(path.join(ROOT, d)));

// ── resolve an import specifier to a real file ───────────────────────────────
// Handles the `@/` alias and extensionless / index-directory imports, which is
// all this repo uses. A specifier that resolves to nothing is a package.
function resolveSpec(spec, fromFile) {
  let base;
  if (spec.startsWith("@/")) base = path.join(ROOT, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(fromFile), spec);
  else return null;

  const candidates = [
    base,
    ...EXTS.map((e) => base + e),
    ...EXTS.map((e) => path.join(base, "index" + e)),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
}

// ── build the reverse graph: file -> files that import it ────────────────────
const IMPORT_RE = /(?:^|\n)\s*(?:import[\s\S]*?from|export[\s\S]*?from|import)\s*["']([^"']+)["']/g;
const DYNAMIC_RE = /import\(\s*["']([^"']+)["']\s*\)/g;

const importers = new Map(); // absolute path -> Set of absolute paths

for (const file of files) {
  let src;
  try {
    src = fs.readFileSync(file, "utf8");
  } catch {
    continue;
  }
  const specs = new Set();
  for (const m of src.matchAll(IMPORT_RE)) specs.add(m[1]);
  for (const m of src.matchAll(DYNAMIC_RE)) specs.add(m[1]);

  for (const spec of specs) {
    const dep = resolveSpec(spec, file);
    if (!dep) continue;
    if (!importers.has(dep)) importers.set(dep, new Set());
    importers.get(dep).add(file);
  }
}

// ── BFS up the importer graph ────────────────────────────────────────────────
const seen = new Set([targetAbs]);
const queue = [targetAbs];
const routeFiles = new Set();
const testFiles = new Set();

// What counts as an "entry point" — the thing a user or a caller actually reaches.
// Covers Next app router, Next pages router, and the common generic conventions.
// Override with ENTRY_RE in the environment for anything unusual.
const ENTRY_RE = process.env.ENTRY_RE
  ? new RegExp(process.env.ENTRY_RE)
  : /(^|\/)(page|layout|route|template|default|error|loading|not-found|index|main|server|app|handler|entry)\.(tsx|ts|jsx|js)$/;
const isRoute = (rel) =>
  ENTRY_RE.test(rel) && !/(^|\/)(node_modules|dist|build)(\/|$)/.test(rel);
const isTest = (rel) => /\.(test|spec)\.(tsx|ts|jsx|js)$/.test(rel);

while (queue.length) {
  const cur = queue.shift();
  for (const imp of importers.get(cur) ?? []) {
    const rel = path.relative(ROOT, imp);
    if (isTest(rel)) {
      testFiles.add(rel); // a test is a leaf: it renders nothing further up
      continue;
    }
    if (seen.has(imp)) continue;
    seen.add(imp);
    if (isRoute(rel)) routeFiles.add(rel);
    queue.push(imp);
  }
}

// ── route group: the (parenthesised) segment that decides the visual scope ───
function routeGroup(rel) {
  const groups = [...rel.matchAll(/\(([^)/]+)\)/g)].map((m) => m[1]);
  return groups.length ? groups.join(" > ") : "—";
}

const routes = [...routeFiles].sort();
const tests = [...testFiles].sort();
const byGroup = new Map();
for (const r of routes) {
  const g = routeGroup(r);
  if (!byGroup.has(g)) byGroup.set(g, []);
  byGroup.get(g).push(r);
}

if (asJson) {
  console.log(JSON.stringify({
    target: path.relative(ROOT, targetAbs),
    routeGroups: Object.fromEntries(byGroup),
    routes,
    tests,
    transitiveImporters: seen.size - 1,
  }, null, 2));
  process.exit(0);
}

const rel = path.relative(ROOT, targetAbs);
console.log(`\nrender-scope: ${rel}`);
console.log(`  reached by ${seen.size - 1} file(s); ${routes.length} route file(s); ${tests.length} test file(s)\n`);

if (!routes.length) {
  console.log("  ENTRY POINTS: none found — nothing scanned reaches this file.");
  console.log("  Either it is dead, or it is reached only through a dynamic import this");
  console.log("  scan cannot see. Confirm before assuming a change here is user-visible.\n");
} else {
  console.log("  ENTRY POINTS (grouped — this is the real scope, not the directory name):");
  for (const [g, rs] of [...byGroup].sort()) {
    console.log(`    ${g}  (${rs.length})`);
    for (const r of rs.slice(0, 8)) console.log(`      ${r}`);
    if (rs.length > 8) console.log(`      … and ${rs.length - 8} more`);
  }
  console.log("");
  if (byGroup.size > 1) {
    console.log("  ⚠ MORE THAN ONE GROUP. A token or primitive change here crosses");
    console.log("    scopes — verify the effect in each before treating it as local.\n");
  }
}

if (tests.length) {
  console.log("  TEST FILES AN EDIT HERE WILL TAX:");
  for (const t of tests.slice(0, 20)) console.log(`    ${t}`);
  if (tests.length > 20) console.log(`    … and ${tests.length - 20} more`);
  console.log("");
  console.log("  Adding a hook or context dependency to this file makes every one of these");
  console.log("  files need the matching provider mock — including any owned by a parallel");
  console.log("  slice you must not edit. Check ownership before adding one.\n");
}
