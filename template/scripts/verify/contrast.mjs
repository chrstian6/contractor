#!/usr/bin/env node
// contrast.mjs — WCAG contrast for this repo's design tokens, per scope.
//
// WHY THIS EXISTS. Re-deriving contrast by hand goes wrong in both directions,
// and a table written into a document goes stale the moment a ground moves.
// Tokens are read live and alpha inks are composited onto their real ground, so
// this cannot drift the way a written ratio does.
//
// Expects HSL-triple custom properties (`--card: 0 0% 100%;`) — the Tailwind /
// shadcn convention. Set TOKENS_CSS to point at your stylesheet.
//
// It also answers the alpha question that has bitten twice: a translucent token's
// ratio is a function of the ground beneath it, so any `--background` change
// silently retunes every alpha over it.
//
// Usage:
//   node scripts/verify/contrast.mjs                          # the standing table
//   node scripts/verify/contrast.mjs --scope .dark            # one scope
//   node scripts/verify/contrast.mjs --pair muted-foreground card
//   node scripts/verify/contrast.mjs --pair primary card --alpha 0.05
//   node scripts/verify/contrast.mjs --self-test              # verify the math
//
// Exit codes: 0 ok, 1 a --pair fell below its stated threshold, 2 usage/parse.

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
// The stylesheet holding the design tokens. Set TOKENS_CSS to point at yours;
// otherwise the first of these that exists wins.
const CSS_CANDIDATES = (process.env.TOKENS_CSS ? [process.env.TOKENS_CSS] : [
  "app/globals.css", "src/app/globals.css", "styles/globals.css",
  "src/styles/globals.css", "app/tokens.css", "styles/tokens.css",
  "src/index.css", "src/styles.css",
]).map((c) => path.isAbsolute(c) ? c : path.join(ROOT, c));
const CSS = CSS_CANDIDATES.find((c) => fs.existsSync(c)) ?? CSS_CANDIDATES[0];

// ── colour math (WCAG 2.1) ───────────────────────────────────────────────────
function hslToRgb(h, s, l) {
  s /= 100; l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r1, g1, b1] =
    hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x]
    : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  const m = l - c / 2;
  return [(r1 + m) * 255, (g1 + m) * 255, (b1 + m) * 255];
}

const lin = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const luminance = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
// Source-over compositing: what an alpha ink actually becomes on its ground.
const composite = (fg, bg, alpha) => fg.map((c, i) => c * alpha + bg[i] * (1 - alpha));

// ── parse the token blocks out of globals.css ────────────────────────────────
// Tokens are HSL triples without the function wrapper: `--card: 0 0% 100%;`
function parseScopes(raw) {
  // Strip comments FIRST. globals.css carries long owner-ruling comments inside
  // the token blocks, and several of them contain braces and colons — without
  // this, comment prose is matched as a selector and real scope blocks are missed
  // entirely while nonsense scopes appear. (Same class of bug as the source-walk
  // that failed on a header comment; strip, don't weaken the pattern.)
  const css = raw.replace(/\/\*[\s\S]*?\*\//g, "");
  const scopes = new Map();
  // Match `selector { ... }` at top level. Token blocks are flat once comments go.
  const re = /(^|\n)([^{}\n][^{}]*?)\{([^{}]*)\}/g;
  for (const m of css.matchAll(re)) {
    const selector = m[2].trim().replace(/\s+/g, " ");
    const body = m[3];
    const tokens = new Map();
    for (const t of body.matchAll(/--([a-z0-9-]+)\s*:\s*([0-9.]+)\s+([0-9.]+)%\s+([0-9.]+)%\s*;/gi)) {
      tokens.set(t[1], [parseFloat(t[2]), parseFloat(t[3]), parseFloat(t[4])]);
    }
    if (!tokens.size) continue;
    if (!scopes.has(selector)) scopes.set(selector, new Map());
    const dst = scopes.get(selector);
    for (const [k, v] of tokens) dst.set(k, v); // later block wins, as in CSS
  }
  return scopes;
}

if (!fs.existsSync(CSS)) {
  console.error("contrast: no token stylesheet found. Looked for:");
  for (const c of CSS_CANDIDATES) console.error(`  ${path.relative(ROOT, c)}`);
  console.error("Set TOKENS_CSS=path/to/your.css to point at it.");
  process.exit(2);
}
const scopes = parseScopes(fs.readFileSync(CSS, "utf8"));

// Scopes inherit from :root — a scope that doesn't redefine a token uses :root's.
function resolve(scopeName, token) {
  const own = scopes.get(scopeName)?.get(token);
  if (own) return own;
  return scopes.get(":root")?.get(token) ?? null;
}
const rgbOf = (scopeName, token) => {
  const hsl = resolve(scopeName, token);
  return hsl ? hslToRgb(...hsl) : null;
};

// Which scopes to show by default: :root and the theme/scope blocks the
// stylesheet actually defines. Discovered, so this works in any project rather
// than assuming one repo's class names.
function defaultScopes() {
  const found = [...scopes.keys()].filter((s) => {
    if (s === ":root") return true;
    if (/^(html|body|\*|@)/.test(s)) return false;
    // a single class/attribute selector that redefines tokens is a theme scope
    return /^[.:\[][^ ,>]*$/.test(s);
  });
  // :root first, then the rest in file order, capped so output stays readable.
  return [":root", ...found.filter((s) => s !== ":root")].filter((s) => scopes.has(s)).slice(0, 8);
}

// ── self-test: the math must reproduce a measurement we already trust ─────────
const args = process.argv.slice(2);
if (args.includes("--self-test")) {
  // Recorded by a frontend-designer run and independently hand-checked:
  // text-muted-foreground on --card measures 5.80:1 in the light theme.
  const got = ratio(hslToRgb(220, 15, 42), hslToRgb(0, 0, 100));
  const ok = Math.abs(got - 5.8) < 0.02;
  console.log(`self-test: muted-foreground(220 15% 42%) on white = ${got.toFixed(2)}:1  expected 5.80  ${ok ? "PASS" : "FAIL"}`);
  // Black on white is exactly 21:1 by definition.
  const max = ratio([0, 0, 0], [255, 255, 255]);
  const ok2 = Math.abs(max - 21) < 0.001;
  console.log(`self-test: black on white = ${max.toFixed(3)}:1  expected 21  ${ok2 ? "PASS" : "FAIL"}`);
  process.exit(ok && ok2 ? 0 : 1);
}

const grade = (r) => (r >= 4.5 ? "AA body" : r >= 3 ? "AA large/UI" : "fails");
const fmt = (r) => `${r.toFixed(2)}:1`;

// ── --pair mode ──────────────────────────────────────────────────────────────
const pairIdx = args.indexOf("--pair");
if (pairIdx !== -1) {
  const ink = args[pairIdx + 1], ground = args[pairIdx + 2];
  if (!ink || !ground) { console.error("usage: --pair <ink-token> <ground-token> [--alpha N] [--scope S]"); process.exit(2); }
  const aIdx = args.indexOf("--alpha");
  const alpha = aIdx !== -1 ? parseFloat(args[aIdx + 1]) : 1;
  const sIdx = args.indexOf("--scope");
  const scopeList = sIdx !== -1 ? [args[sIdx + 1]] : defaultScopes();

  let worst = Infinity;
  console.log(`\ncontrast: --${ink} on --${ground}${alpha < 1 ? ` at alpha ${alpha}` : ""}\n`);
  for (const s of scopeList) {
    if (!scopes.has(s)) continue;
    const fg = rgbOf(s, ink), bg = rgbOf(s, ground);
    if (!fg || !bg) { console.log(`  ${s.padEnd(14)} — token missing in this scope`); continue; }
    const eff = alpha < 1 ? composite(fg, bg, alpha) : fg;
    const r = ratio(eff, bg);
    worst = Math.min(worst, r);
    console.log(`  ${s.padEnd(14)} ${fmt(r).padStart(8)}   ${grade(r)}`);
  }
  console.log("");
  process.exit(worst >= 3 ? 0 : 1);
}

// ── standing table ───────────────────────────────────────────────────────────
// The pairs that have actually been argued about. Add a row when you measure a
// new one — that is what turns the next derivation into a lookup.
const PAIRS = [
  ["foreground", "background", 1, "body text on the page ground"],
  ["foreground", "card", 1, "body text on a card"],
  ["muted-foreground", "card", 1, "muted body on a card"],
  ["muted-foreground", "background", 1, "muted body on the page ground"],
  ["border", "card", 1, "hairline on a card — decorative, never load-bearing alone"],
  ["border", "background", 1, "hairline on the page ground — NOT a control edge"],
  ["card-border", "card", 1, "card hairline (owner exemption: container edges only)"],
  ["primary", "background", 1, "primary ink on the page ground"],
  ["primary", "background", 0.05, "primary at 5% — a hover/active fill"],
];

const scopeArgIdx = args.indexOf("--scope");
const showScopes = scopeArgIdx !== -1 ? [args[scopeArgIdx + 1]] : defaultScopes();

console.log("\ncontrast — measured token pairs by scope");
console.log("AA: body text >= 4.5:1, large text and UI components >= 3:1\n");

for (const s of showScopes) {
  console.log(`  ${s}`);
  for (const [ink, ground, alpha, note] of PAIRS) {
    const fg = rgbOf(s, ink), bg = rgbOf(s, ground);
    if (!fg || !bg) continue;
    const eff = alpha < 1 ? composite(fg, bg, alpha) : fg;
    const r = ratio(eff, bg);
    const label = `--${ink}${alpha < 1 ? `/${alpha}` : ""} on --${ground}`;
    console.log(`    ${label.padEnd(42)} ${fmt(r).padStart(8)}  ${grade(r).padEnd(12)} ${note}`);
  }
  console.log("");
}

console.log("  Alpha inks are composited onto their ground before measuring, so any");
console.log("  --background change retunes every alpha above. Re-run after moving one.\n");
