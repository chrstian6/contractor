#!/usr/bin/env node
// measure-dom.mjs — measure real geometry in headless Chrome, at real widths.
//
// WHY THIS EXISTS. Three frontend-designer runs proposed a measurement wrapper
// after each burned several attempts on the same two traps:
//
//   1. **Headless Chrome floors innerWidth at 500px.** `--window-size=320,800`
//      silently measures 500 and reports it as 320. Two separate runs designed a
//      responsive ladder against numbers that were never real.
//   2. **A srcdoc iframe mangles class attributes** through double-escaping, so
//      the "measured" element was not styled the way the file says.
//
// This script refuses to lie about either. Below Chrome's floor it switches to
// CONTAINER mode — a fixed-width wrapper at the requested width — and labels the
// result, because media queries cannot fire there. Above the floor it uses a real
// viewport and confirms the width it actually got.
//
// Usage:
//   node scripts/verify/measure-dom.mjs <file.html> --widths 320,375,768,1024 \
//        --select ".mj-row" [--props width,height] [--json]
//
// Reads the file as a real page (no iframe, no srcdoc). Pair it with a compiled
// stylesheet: `@import "tailwindcss" source(none)` plus an explicit `@source`
// pointing at the component, which is the only combination that emits arbitrary
// utilities for files outside the default scan.
//
// Exit codes: 0 measured, 2 usage, 3 no Chrome, 4 selector matched nothing.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

// Chrome's new headless mode clamps the viewport; measured, not assumed.
const CHROME_MIN_WIDTH = 500;

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const flag = (name, dflt = null) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? dflt : args[i + 1];
};
const asJson = args.includes("--json");

if (!file) {
  console.error(`usage: node scripts/verify/measure-dom.mjs <file.html> --select <css> [--widths 320,768] [--props width,height] [--json]`);
  process.exit(2);
}
if (!fs.existsSync(file)) { console.error(`measure-dom: no such file: ${file}`); process.exit(2); }

const selector = flag("select");
if (!selector) { console.error("measure-dom: --select <cssSelector> is required"); process.exit(2); }

const widths = (flag("widths", "320,375,768,1024")).split(",").map((w) => parseInt(w.trim(), 10)).filter(Boolean);
const props = (flag("props", "width,height")).split(",").map((p) => p.trim());

const chrome = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
if (!chrome) {
  console.error("measure-dom: no Chrome/Chromium found. Looked in:");
  for (const c of CHROME_CANDIDATES) console.error(`  ${c}`);
  process.exit(3);
}

const html = fs.readFileSync(file, "utf8");
const results = [];

for (const want of widths) {
  const containerMode = want < CHROME_MIN_WIDTH;
  const viewport = containerMode ? CHROME_MIN_WIDTH : want;

  // In container mode we wrap the body in a fixed-width box. Media queries key
  // off the viewport, so they will NOT reflect `want` — the output says so
  // rather than letting a caller believe otherwise.
  const shim = containerMode
    ? `<style>html,body{margin:0}body>*{max-width:${want}px!important}body{width:${want}px!important;overflow-x:hidden}</style>`
    : "";

  // A probe script that prints one JSON line to stdout via the DOM, then we read
  // it out of the dumped DOM. No CDP client needed, no iframe, no srcdoc.
  const probe = `
<script>
window.addEventListener('load', function () {
  var out = [];
  document.querySelectorAll(${JSON.stringify(selector)}).forEach(function (el, i) {
    var r = el.getBoundingClientRect();
    var cs = getComputedStyle(el);
    out.push({
      i: i,
      width: Math.round(r.width * 100) / 100,
      height: Math.round(r.height * 100) / 100,
      top: Math.round(r.top * 100) / 100,
      left: Math.round(r.left * 100) / 100,
      text: (el.textContent || '').trim().slice(0, 40),
      computed: ${JSON.stringify(props)}.reduce(function (acc, p) { acc[p] = cs.getPropertyValue(p); return acc; }, {})
    });
  });
  var pre = document.createElement('pre');
  pre.id = '__measure__';
  pre.textContent = JSON.stringify({
    requestedWidth: ${want},
    actualInnerWidth: window.innerWidth,
    documentWidth: document.documentElement.clientWidth,
    containerMode: ${containerMode},
    nodes: out
  });
  document.body.appendChild(pre);
});
</script>`;

  const page = html.includes("</body>")
    ? html.replace("</head>", `${shim}</head>`).replace("</body>", `${probe}</body>`)
    : `${shim}${html}${probe}`;

  const tmp = path.join(os.tmpdir(), `measure-dom-${want}-${process.pid}.html`);
  fs.writeFileSync(tmp, page);

  let dom = "";
  try {
    dom = execFileSync(chrome, [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--hide-scrollbars",
      "--virtual-time-budget=2000",
      `--window-size=${viewport},900`,
      "--dump-dom",
      `file://${tmp}`,
    ], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 32 * 1024 * 1024 });
  } catch (e) {
    console.error(`measure-dom: Chrome failed at width ${want}: ${e.message}`);
    fs.unlinkSync(tmp);
    continue;
  }
  fs.unlinkSync(tmp);

  const m = dom.match(/<pre id="__measure__">([\s\S]*?)<\/pre>/);
  if (!m) { console.error(`measure-dom: probe did not run at width ${want}`); continue; }
  const decoded = m[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  try { results.push(JSON.parse(decoded)); }
  catch { console.error(`measure-dom: could not parse probe output at width ${want}`); }
}

if (!results.length) { console.error("measure-dom: nothing measured"); process.exit(4); }
if (asJson) { console.log(JSON.stringify(results, null, 2)); process.exit(0); }

console.log(`\nmeasure-dom: ${path.basename(file)}   selector: ${selector}\n`);
let matchedAnything = false;

for (const r of results) {
  const mode = r.containerMode
    ? `CONTAINER ${r.requestedWidth}px  (viewport is ${r.actualInnerWidth}px — Chrome floors at ${CHROME_MIN_WIDTH}; MEDIA QUERIES REFLECT ${r.actualInnerWidth}px, NOT ${r.requestedWidth}px)`
    : `VIEWPORT ${r.actualInnerWidth}px`;
  console.log(`  ${mode}`);

  if (!r.nodes.length) { console.log(`    (selector matched nothing)\n`); continue; }
  matchedAnything = true;

  for (const n of r.nodes.slice(0, 12)) {
    const extra = props.map((p) => `${p}=${n.computed[p]}`).join("  ");
    console.log(`    [${String(n.i).padStart(2)}] ${String(n.width).padStart(8)} x ${String(n.height).padEnd(7)} ${extra}   ${n.text ? `"${n.text}"` : ""}`);
  }
  if (r.nodes.length > 12) console.log(`    … and ${r.nodes.length - 12} more`);
  console.log("");
}

if (!matchedAnything) {
  console.error("measure-dom: the selector matched nothing at any width.");
  process.exit(4);
}

console.log("  Container mode measures layout at the requested width but cannot fire");
console.log("  media queries — a breakpoint claim below 500px needs a real device, not this.\n");
