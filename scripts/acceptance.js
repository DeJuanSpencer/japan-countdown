"use strict";
// Acceptance checks for index.html, owned by qa. Plain Node, no dependencies. One PASS or FAIL line
// per check, exit code 1 if any check fails.
//
// The build machine has no browser and none may be installed, so this file stands in for the brief's
// manual devtools check:
//   - Both page scripts run in a Node VM against a fake document that models only what the page uses.
//     An element id that is not in the static markup returns null, as in a browser, so the page throws
//     where a browser would. Any other missing API throws too. Every console call and every uncaught
//     error is recorded in every render and asserted empty at the end.
//   - The 390px and 320px layout is arithmetic over the page's own CSS, not a render.
//   - "Zero network requests" is a set of static scans. Every scan pattern carries a positive control,
//     so a broken pattern fails loudly instead of passing vacuously.
// No browser rendered the page. A check on a real phone is still open.
//
// Nothing here writes to disk: only readFileSync is imported from fs.

const { readFileSync } = require("fs");
const path = require("path");
const vm = require("vm");

// ---- reporting -----------------------------------------------------------------------------------
let passed = 0;
let failed = 0;
const clip = (s, n) => (s.length > (n || 340) ? s.slice(0, n || 340) + "..." : s);
function t(ok, name, detail) {
  if (ok) passed++; else failed++;
  const d = detail === undefined || detail === null || detail === "" ? "" : "  [" + clip(String(detail)) + "]";
  console.log((ok ? "PASS " : "FAIL ") + name + d);
}
function rows(list) { for (const r of list) t(r[0], r[1], r[2]); } // each row is [ok, name, detail]
function section(name, fn) {
  try { fn(); } catch (e) {
    t(false, name, "check crashed: " + (e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : e));
  }
}
const listBad = (bad, n) => bad.slice(0, n || 5).join("; ") + (bad.length > (n || 5) ? "; +" + (bad.length - (n || 5)) + " more" : "");
const pad2 = (n) => String(n).padStart(2, "0");

let SRC = "";
try { SRC = readFileSync(path.join(__dirname, "..", "index.html"), "utf8"); }
catch (e) { t(false, "index.html is readable", e.message); console.log("SUMMARY 1 checks, 0 PASS, 1 FAIL"); process.exit(1); }
const f1 = (n) => n.toFixed(1);
const f2 = (n) => n.toFixed(2);

// ---- comment stripping ---------------------------------------------------------------------------
const stripCss = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "");
function stripJs(code) {
  let out = "";
  let i = 0;
  let q = null;
  while (i < code.length) {
    const c = code[i];
    const n = code[i + 1];
    if (q) {
      out += c;
      if (c === "\\") { out += n || ""; i += 2; continue; }
      if (c === q) q = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { q = c; out += c; i++; continue; }
    if (c === "/" && n === "/") { while (i < code.length && code[i] !== "\n") i++; continue; }
    if (c === "/" && n === "*") { const e = code.indexOf("*/", i + 2); i = e < 0 ? code.length : e + 2; out += " "; continue; }
    out += c;
    i++;
  }
  return out;
}

// ---- markup: a small tree builder that also reports malformed nesting -----------------------------
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
function parseAttrs(s) {
  const attrs = {};
  const re = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m;
  while ((m = re.exec(s))) {
    attrs[m[1].toLowerCase()] = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : "";
  }
  return attrs;
}
function parseHtml(html) {
  const root = { tag: "#root", attrs: {}, kids: [], parent: null };
  const out = { root, problems: [], scripts: [], styles: [], ids: [], byId: new Map(), nodes: [] };
  const tagRe = /<!--[\s\S]*?-->|<![^>]*>|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^'">])*?)\/?>/y;
  let cur = root;
  let i = 0;
  const addText = (s) => { if (s) cur.kids.push(s); };
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt < 0) { addText(html.slice(i)); break; }
    addText(html.slice(i, lt));
    tagRe.lastIndex = lt;
    const m = tagRe.exec(html);
    if (!m) { out.problems.push("unparseable '<' at offset " + lt); addText("<"); i = lt + 1; continue; }
    i = tagRe.lastIndex;
    if (m[0][1] === "!") continue; // comment or doctype
    const tag = m[2].toLowerCase();
    if (m[1] === "/") {
      if (VOID.has(tag)) { out.problems.push("end tag </" + tag + "> for a void element"); continue; }
      let n = cur;
      while (n !== root && n.tag !== tag) n = n.parent;
      if (n === root) { out.problems.push("stray </" + tag + ">"); continue; }
      if (n !== cur) out.problems.push("</" + tag + "> closes <" + cur.tag + "> first");
      cur = n.parent;
      continue;
    }
    const node = { tag, attrs: parseAttrs(m[3]), kids: [], parent: cur };
    cur.kids.push(node);
    out.nodes.push(node);
    if (node.attrs.id !== undefined) {
      out.ids.push(node.attrs.id);
      if (!out.byId.has(node.attrs.id)) out.byId.set(node.attrs.id, []);
      out.byId.get(node.attrs.id).push(node);
    }
    if (tag === "script" || tag === "style") {
      const end = html.toLowerCase().indexOf("</" + tag, i);
      if (end < 0) { out.problems.push("unclosed <" + tag + ">"); break; }
      const code = html.slice(i, end);
      node.kids.push(code);
      (tag === "script" ? out.scripts : out.styles).push({ node, code, idsBefore: out.ids.slice() });
      const gt = html.indexOf(">", end);
      i = gt < 0 ? html.length : gt + 1;
      continue;
    }
    if (!VOID.has(tag)) cur = node;
  }
  if (cur !== root) out.problems.push("unclosed <" + cur.tag + ">");
  return out;
}
function textOf(node) {
  return node.kids.map((k) => (typeof k === "string" ? k : k.tag === "script" || k.tag === "style" ? "" : textOf(k))).join("");
}
function descendantIds(node) {
  const out = [];
  (function walk(n) {
    for (const k of n.kids) {
      if (typeof k === "string") continue;
      if (k.attrs.id !== undefined) out.push(k.attrs.id);
      walk(k);
    }
  })(node);
  return out;
}
// True when the hero holds exactly one paragraph reading "Japan." and nothing else.
function japanOnly(inner) {
  const f = parseHtml(inner);
  const els = f.root.kids.filter((k) => typeof k !== "string");
  const strs = f.root.kids.filter((k) => typeof k === "string" && k.trim());
  return f.problems.length === 0 && strs.length === 0 && els.length === 1 && els[0].tag === "p" &&
    els[0].kids.length === 1 && els[0].kids[0] === "Japan.";
}

// ---- css: a rule list with comments already stripped ---------------------------------------------
function splitTop(s, sep) {
  const out = [];
  let depth = 0;
  let q = null;
  let cur = "";
  for (const ch of s) {
    if (q) { cur += ch; if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === sep && depth === 0) { out.push(cur); cur = ""; } else cur += ch;
  }
  out.push(cur);
  return out;
}
function parseDecls(body) {
  const d = [];
  for (const part of splitTop(body, ";")) {
    const i = part.indexOf(":");
    if (i < 0) continue;
    const p = part.slice(0, i).trim().toLowerCase();
    const v = part.slice(i + 1).trim().replace(/\s*!important$/i, "");
    if (p) d.push([p, v]);
  }
  return d;
}
function parseCss(css) {
  const rules = [];
  const atRules = [];
  (function walk(text, media) {
    let i = 0;
    while (i < text.length) {
      const open = text.indexOf("{", i);
      if (open < 0) { if (text.slice(i).trim()) atRules.push(text.slice(i).trim()); break; }
      let head = text.slice(i, open);
      const semi = head.lastIndexOf(";");
      if (semi >= 0) { atRules.push(head.slice(0, semi).trim()); head = head.slice(semi + 1); }
      head = head.trim();
      let depth = 1;
      let j = open + 1;
      while (j < text.length && depth) { depth += text[j] === "{" ? 1 : text[j] === "}" ? -1 : 0; j++; }
      const body = text.slice(open + 1, j - 1);
      if (head[0] === "@") {
        atRules.push(head);
        if (/^@media/i.test(head)) walk(body, head.replace(/^@media\s*/i, ""));
      } else rules.push({ sel: head, decls: parseDecls(body), media });
      i = j;
    }
  })(css, null);
  return { rules, atRules };
}
function cssFacts(css) {
  const { rules, atRules } = parseCss(css);
  const sels = (r) => r.sel.split(",").map((s) => s.trim().replace(/\s+/g, " "));
  const f = { css, rules, atRules, sels };
  f.all = (sel, prop) => {
    const out = [];
    for (const r of rules) if (!r.media && sels(r).includes(sel)) for (const [p, v] of r.decls) if (p === prop) out.push(v);
    return out;
  };
  f.get = (sel, prop) => { const a = f.all(sel, prop); return a.length ? a[a.length - 1] : undefined; };
  f.tokens = new Map();
  f.rootProblems = [];
  const root = rules.find((r) => r.sel.trim() === ":root");
  if (!root) f.rootProblems.push("no :root rule");
  else {
    for (const [p, v] of root.decls) {
      if (!p.startsWith("--")) f.rootProblems.push("non-token declaration in :root: " + p);
      if (f.tokens.has(p)) f.rootProblems.push("duplicate token " + p);
      f.tokens.set(p, v);
    }
  }
  f.resolve = (v) => {
    const m = /^var\(\s*(--[\w-]+)\s*\)$/.exec(v || "");
    return m ? (f.tokens.has(m[1]) ? f.tokens.get(m[1]) : null) : v;
  };
  return f;
}

// ---- the page under test -------------------------------------------------------------------------
function pageFacts(html) {
  const doc = parseHtml(html);
  const css = doc.styles.map((s) => stripCss(s.code)).join("\n");
  const js = doc.scripts.map((s) => stripJs(s.code)).join("\n");
  const markup = html.replace(/<!--[\s\S]*?-->/g, "").replace(/(<(script|style)\b[^>]*>)[\s\S]*?(<\/\2>)/gi, "$1$3");
  return { html, doc, css, js, markup, clean: markup + "\n" + css + "\n" + js, f: cssFacts(css) };
}
const PAGE = pageFacts(SRC);
const DOC_CACHE = new Map([[SRC, PAGE.doc]]);

// ---- page harness: both scripts in a VM against a fake document ----------------------------------
// Every render is recorded in AUDIT (unless it is a harness control) so the final check covers all of
// them, including errors thrown later from an event listener.
const AUDIT = [];
let ZONE = "zone-independent";
const SCRIPT_CACHE = new Map();
function compiled(code, name) {
  let s = SCRIPT_CACHE.get(code);
  if (!s) { s = new vm.Script(code, { filename: name }); SCRIPT_CACHE.set(code, s); }
  return s;
}
const describe = (e) => (e && e.message !== undefined ? String(e.name || "Error") + ": " + e.message : String(e));

function render(html, now, opts) {
  opts = opts || {};
  if (!DOC_CACHE.has(html)) DOC_CACHE.set(html, parseHtml(html));
  const parsed = DOC_CACHE.get(html);
  const errors = [];
  const calls = [];
  const misses = [];
  const requested = [];
  const written = [];
  const listeners = {};
  const reg = new Map();
  const seen = new Set();
  const known = new Set(); // ids that have existed at some point in this page's life
  let nowMs = now.getTime();

  function drop(el) { for (const k of el.kids) reg.delete(k); el.kids = []; }
  function mk(id, kids) {
    known.add(id);
    const el = {
      id, style: {}, attrs: {}, kids: kids || [], _t: "", _h: "", writes: 0,
      setAttribute(k, v) { this.attrs[String(k)] = String(v); },
      getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
    };
    Object.defineProperty(el, "textContent", {
      enumerable: true,
      get() { return el._t; },
      set(v) { el._t = String(v); el.writes++; written.push(el._t); drop(el); },
    });
    Object.defineProperty(el, "innerHTML", {
      enumerable: true,
      get() { return el._h; },
      set(v) {
        el._h = String(v);
        el.writes++;
        drop(el);
        const frag = parseHtml(el._h);
        written.push(textOf(frag.root));
        for (const id2 of frag.ids) { reg.set(id2, mk(id2, [])); el.kids.push(id2); }
      },
    });
    return el;
  }
  const fakeConsole = new Proxy({}, { get: (_, k) => (...a) => { calls.push(String(k) + "(" + a.map(String).join(" ") + ")"); } });
  const document = {
    visibilityState: "visible",
    getElementById(id) {
      // null for anything not in the live document, as in a browser. Only an id that never existed is a
      // miss: probing for an element the page itself removed (hero.innerHTML) is legitimate.
      const k = String(id);
      const el = reg.get(k) || null;
      requested.push(k);
      if (!el && !known.has(k)) misses.push(k);
      return el;
    },
    addEventListener(type, fn) { (listeners[type] || (listeners[type] = [])).push(fn); },
  };
  class MockDate extends Date {
    constructor(...a) { if (a.length === 0) super(nowMs); else super(...a); }
    static now() { return nowMs; }
  }
  const ctx = vm.createContext({ document, Date: MockDate, console: fakeConsole });
  parsed.scripts.forEach((s, k) => {
    // An element exists for a script only if it was parsed before that script, as in a browser.
    for (const id of s.idsBefore) {
      if (seen.has(id)) continue;
      seen.add(id);
      const n = (parsed.byId.get(id) || [])[0];
      reg.set(id, mk(id, n ? descendantIds(n) : []));
    }
    try { compiled(s.code, "inline-script-" + (k + 1)).runInContext(ctx); }
    catch (e) { errors.push("script " + (k + 1) + " threw " + describe(e)); }
  });
  const page = {
    errors, calls, misses, requested, written, listeners,
    el: (id) => reg.get(id) || null,
    text: (id) => (reg.has(id) ? reg.get(id)._t : null),
    setNow: (d) => { nowMs = d.getTime(); },
    fire(type, state) {
      if (state) document.visibilityState = state;
      for (const fn of (listeners[type] || []).slice()) {
        try { fn.call(document, { type }); } catch (e) { errors.push(type + " listener threw " + describe(e)); }
      }
    },
  };
  if (!opts.control) AUDIT.push({ zone: ZONE, label: opts.label || "", errors, calls, misses, written });
  return page;
}

// Replace a hand-edited constant in memory. Throws if the declaration is not found.
function withConst(html, name, literal) {
  const re = new RegExp("(const\\s+" + name + "\\s*=\\s*)[^;]*;");
  if (!re.test(html)) throw new Error("const " + name + " not found in the form 'const " + name + " = ...;'");
  return html.replace(re, (_, a) => a + literal + ";");
}

// ---- date oracle and per-zone cases --------------------------------------------------------------
// Calendar arithmetic on UTC midnights, independent of how the page computes the count.
const daysBetween = (y, m, d) => Math.round((Date.UTC(2027, 2, 27) - Date.UTC(y, m, d)) / 864e5);

// year, month (0-based), day, hour, minute, second, expected whole days left
const FIXED = [
  [2026, 9, 2, 0, 0, 0, 176],
  [2026, 9, 2, 23, 59, 59, 176],
  [2026, 10, 1, 0, 30, 0, 146], // US fall back
  [2026, 10, 1, 23, 30, 0, 146],
  [2026, 10, 2, 0, 5, 0, 145],
  [2027, 2, 13, 23, 59, 0, 14],
  [2027, 2, 14, 0, 0, 0, 13], // US spring forward
  [2027, 2, 14, 12, 0, 0, 13],
  [2027, 2, 14, 23, 59, 0, 13],
  [2027, 2, 15, 0, 0, 0, 12],
  [2027, 2, 20, 0, 5, 0, 7], // the done-contract case, at both ends of the local day
  [2027, 2, 20, 23, 55, 0, 7],
  [2027, 2, 26, 0, 0, 0, 1],
  [2027, 2, 26, 23, 59, 59, 1],
];
const TRIP_STATES = [
  [2027, 2, 27, 0, 0, 0],
  [2027, 2, 27, 15, 30, 0],
  [2027, 2, 27, 23, 59, 59],
  [2027, 2, 28, 0, 0, 0],
  [2027, 3, 6, 12, 0, 0],
  [2030, 0, 1, 0, 0, 0],
  [2099, 11, 31, 23, 59, 59],
];
const BOUNDARY_TIMES = [[0, 0, 0], [0, 30, 0], [1, 30, 0], [2, 30, 0], [3, 30, 0], [12, 0, 0], [23, 30, 0], [23, 59, 59]];
const SWEEP_TIMES = [[0, 0, 0], [12, 0, 0], [23, 59, 59]];
function* windowDays() { // 2026-10-01 to 2027-04-06 inclusive, stepped on UTC midnights
  for (let ms = Date.UTC(2026, 9, 1); ms <= Date.UTC(2027, 3, 6); ms += 864e5) {
    const x = new Date(ms);
    yield [x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()];
  }
}
const ymdText = (a) => a[0] + "-" + pad2(a[1] + 1) + "-" + pad2(a[2]);

// Render the page at a local time and return a problem string, or null when the hero is right.
function dayProblem(html, ymd, hms, ropts) {
  const [y, m, d] = ymd;
  const want = daysBetween(y, m, d);
  const at = ymdText(ymd) + " " + pad2(hms[0]) + ":" + pad2(hms[1]) + ":" + pad2(hms[2]);
  const p = render(html, new Date(y, m, d, hms[0], hms[1], hms[2]), Object.assign({ label: at }, ropts));
  if (want > 0) {
    const n = p.text("num");
    const line = p.text("line");
    const wantLine = want === 1 ? "day until Japan." : "days until Japan.";
    if (n !== String(want)) return at + " shows '" + n + "', want " + want;
    if (line !== wantLine) return at + " line is '" + line + "', want '" + wantLine + "'";
    return null;
  }
  const hero = p.el("hero");
  if (!hero || !japanOnly(hero.innerHTML) || p.el("num") || p.el("line")) {
    return at + " hero is '" + (hero && hero.innerHTML) + "', want only a Japan. paragraph";
  }
  return null;
}
function fixedProblems(html, ropts) {
  const bad = [];
  for (const c of FIXED) { const m = dayProblem(html, c.slice(0, 3), c.slice(3, 6), ropts); if (m) bad.push(m); }
  return bad;
}
function transitionDays() { // days whose noon UTC offset differs from the previous day's noon
  const out = [];
  let prev = null;
  for (const ymd of windowDays()) {
    const off = new Date(ymd[0], ymd[1], ymd[2], 12).getTimezoneOffset();
    if (prev && off !== prev.off) out.push({ ymd, prevYmd: prev.ymd });
    prev = { off, ymd };
  }
  return out;
}
// Cross local midnight with the tab open: the visibilitychange listener must refresh the count.
function midnightProblems(html, ropts) {
  const bad = [];
  const p = render(html, new Date(2027, 2, 20, 23, 59, 30), Object.assign({ label: "midnight crossing" }, ropts));
  if (p.text("num") !== "7") bad.push("start shows " + p.text("num") + ", want 7");
  if ((p.listeners.visibilitychange || []).length !== 1) bad.push("expected one visibilitychange listener, found " + (p.listeners.visibilitychange || []).length);
  p.setNow(new Date(2027, 2, 21, 0, 0, 30));
  p.fire("visibilitychange", "visible");
  if (p.text("num") !== "6") bad.push("after midnight shows " + p.text("num") + ", want 6");
  p.fire("visibilitychange", "visible");
  p.fire("visibilitychange", "visible");
  if (p.text("num") !== "6" || p.text("line") !== "days until Japan.") bad.push("repeated events changed the hero to " + p.text("num"));
  p.setNow(new Date(2027, 2, 26, 23, 59, 59));
  p.fire("visibilitychange", "visible");
  if (p.text("num") !== "1" || p.text("line") !== "day until Japan.") bad.push("day before the trip shows " + p.text("num") + " / " + p.text("line"));
  p.setNow(new Date(2027, 2, 27, 0, 0, 1));
  p.fire("visibilitychange", "visible");
  if (!japanOnly(p.el("hero").innerHTML) || p.el("num") || p.el("line")) bad.push("trip day after midnight is not only Japan.");
  p.setNow(new Date(2027, 2, 28, 12));
  p.fire("visibilitychange", "visible");
  if (!japanOnly(p.el("hero").innerHTML) || p.el("num") || p.el("line")) bad.push("day after the trip is not only Japan.");
  p.fire("visibilitychange", "hidden");
  return bad;
}

// A re-show on the same day has nothing new to say. The hero is an aria-live region, so replacing its
// nodes or rewriting identical text can make a screen reader read the count out again. Node identity
// catches a rebuild, and the write count also catches rewriting the same text into the same node.
function sameDayProblems(html, ropts) {
  const bad = [];
  const ids = ["hero", "num", "line"];
  const reshow = (p, tag) => {
    const nodes = ids.map((id) => p.el(id));
    const writes = nodes.map((e) => (e ? e.writes : -1));
    p.fire("visibilitychange", "hidden");
    p.fire("visibilitychange", "visible");
    p.fire("visibilitychange", "visible");
    ids.forEach((id, i) => {
      if (!nodes[i]) return; // absent in this state, such as the number on the trip day
      const e = p.el(id);
      if (e !== nodes[i]) bad.push(tag + ": #" + id + " was replaced");
      else if (e.writes !== writes[i]) bad.push(tag + ": #" + id + " was written " + (e.writes - writes[i]) + " times with nothing new to show");
    });
  };
  reshow(render(html, new Date(2026, 9, 7, 10), Object.assign({ label: "same-day re-show" }, ropts)), "counting day");
  reshow(render(html, new Date(2027, 2, 27, 9), Object.assign({ label: "same-day re-show, trip day" }, ropts)), "trip day");
  return bad;
}

// ---- time zones ----------------------------------------------------------------------------------
// Zone, January offset, July offset (minutes, as Date#getTimezoneOffset reports them), and the fewest
// offset changes expected in the window, so the DST cases cannot be vacuous.
const ZONES = [
  ["UTC", 0, 0, 0],
  ["America/Los_Angeles", 480, 420, 2],
  ["America/New_York", 300, 240, 2],
  ["Asia/Tokyo", -540, -540, 0],
  ["Pacific/Auckland", -780, -720, 1],
];
const TZ0 = {
  had: Object.prototype.hasOwnProperty.call(process.env, "TZ"),
  val: process.env.TZ,
  jan: new Date(2027, 0, 15, 12).getTimezoneOffset(),
  jul: new Date(2027, 6, 15, 12).getTimezoneOffset(),
};
function restoreZone() { if (TZ0.had) process.env.TZ = TZ0.val; else delete process.env.TZ; }
function withZone(zone, jan, jul, fn) {
  process.env.TZ = zone;
  ZONE = zone;
  const got = { jan: new Date(2027, 0, 15, 12).getTimezoneOffset(), jul: new Date(2027, 6, 15, 12).getTimezoneOffset() };
  got.ok = got.jan === jan && got.jul === jul;
  try { fn(got); } finally { restoreZone(); ZONE = "zone-independent"; }
}

// ---- colour maths --------------------------------------------------------------------------------
function parseColor(v) {
  v = String(v || "").trim();
  let m = /^#([0-9a-f]{6})$/i.exec(v);
  if (m) return { r: parseInt(m[1].slice(0, 2), 16), g: parseInt(m[1].slice(2, 4), 16), b: parseInt(m[1].slice(4, 6), 16), a: 1 };
  m = /^#([0-9a-f]{3})$/i.exec(v);
  if (m) return { r: parseInt(m[1][0] + m[1][0], 16), g: parseInt(m[1][1] + m[1][1], 16), b: parseInt(m[1][2] + m[1][2], 16), a: 1 };
  m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(v);
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
  return null;
}
function over(fg, bg) {
  const mix = (a, b) => Math.round(a * fg.a + b * (1 - fg.a));
  return { r: mix(fg.r, bg.r), g: mix(fg.g, bg.g), b: mix(fg.b, bg.b), a: 1 };
}
function lum(c) {
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}
function ratio(a, b) {
  const x = lum(a);
  const y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
const hexOf = (c) => "#" + [c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();

// ---- tokens --------------------------------------------------------------------------------------
const BRIEF_HEX = { "--paper": "#FAFAF7", "--ink": "#111413", "--copper": "#C2542A", "--muted": "#6B6E6C" };
const FONT_SANS = "'Inter Tight',ui-sans-serif,system-ui,sans-serif";
const FONT_MONO = "'JetBrains Mono',ui-monospace,Menlo,Consolas,monospace";
const TOKEN_NAMES = ["--paper", "--ink", "--copper", "--muted", "--hairline", "--font-sans", "--font-mono"];
const normFont = (v) => String(v || "").replace(/\s*,\s*/g, ",").replace(/"/g, "'").trim();
const isVar = (v, re) => new RegExp("^var\\(\\s*--" + re + "\\s*\\)$").test(v || "");

function tokenRows(f) {
  const out = [];
  const first = f.rules[0];
  const names = [...f.tokens.keys()].sort();
  const exact = JSON.stringify(names) === JSON.stringify(TOKEN_NAMES.slice().sort());
  const firstOk = !!first && first.sel.trim() === ":root";
  const why = f.rootProblems.slice();
  if (!exact) why.push("tokens found: " + names.join(" "));
  if (!firstOk) why.push("first rule is " + (first && first.sel));
  out.push([firstOk && exact && f.rootProblems.length === 0, ":root is the first rule and defines exactly the seven tokens, each once", why.join("; ")]);
  const badHex = Object.keys(BRIEF_HEX).filter((k) => String(f.tokens.get(k) || "").toUpperCase() !== BRIEF_HEX[k]);
  out.push([badHex.length === 0, "brief colours verbatim: paper #FAFAF7, ink #111413, copper #C2542A, muted #6B6E6C",
    badHex.map((k) => k + "=" + f.tokens.get(k)).join(" ")]);
  const hl = parseColor(f.tokens.get("--hairline"));
  out.push([!!hl && hl.r === 17 && hl.g === 20 && hl.b === 19 && Math.abs(hl.a - 0.12) < 1e-9, "hairline token is rgba(17,20,19,0.12)", f.tokens.get("--hairline")]);
  const sansOk = normFont(f.tokens.get("--font-sans")) === FONT_SANS;
  const monoOk = normFont(f.tokens.get("--font-mono")) === FONT_MONO;
  out.push([sansOk && monoOk, "font stacks verbatim: sans starts 'Inter Tight', mono starts 'JetBrains Mono', family names only",
    sansOk && monoOk ? "" : "sans=" + f.tokens.get("--font-sans") + " mono=" + f.tokens.get("--font-mono")]);
  const fam = [];
  const unknown = [];
  for (const r of f.rules) {
    if (r.sel.trim() === ":root") continue;
    for (const [p, v] of r.decls) {
      if (p === "font-family" && !isVar(v, "font-(sans|mono)")) fam.push(r.sel + " { " + v + " }");
      for (const m of v.matchAll(/var\(\s*(--[\w-]+)/g)) if (!f.tokens.has(m[1])) unknown.push(r.sel + " uses " + m[1]);
    }
  }
  out.push([fam.length === 0 && isVar(f.get("body", "font-family"), "font-sans") && unknown.length === 0,
    "outside :root every var() resolves, every font-family is a font token, body uses the sans token", fam.concat(unknown).join("; ")]);
  return out;
}

// ---- colour literals -----------------------------------------------------------------------------
const NAMED = ("aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood " +
  "cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen " +
  "darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray " +
  "darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia " +
  "gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender " +
  "lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink " +
  "lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta " +
  "maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise " +
  "mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid " +
  "palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red " +
  "rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow " +
  "springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen").split(" ");
const LITERAL_RE = /(?<![\w&-])#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix)\s*\(/gi;
const NAMED_RE = new RegExp("(?<![\\w-])(?:transparent|" + NAMED.join("|") + ")(?![\\w-])", "i");

// Every colour written anywhere except the :root rule: css text, inline style attributes, other
// attributes (theme-color), and script text.
function colorLiterals(f, doc, jsText) {
  const found = [];
  const outside = f.css.replace(/:root\s*\{[^}]*\}/, "");
  for (const m of outside.matchAll(LITERAL_RE)) found.push("css " + m[0]);
  for (const r of f.rules) {
    if (r.sel.trim() === ":root") continue;
    for (const [p, v] of r.decls) if (NAMED_RE.test(v)) found.push("css " + r.sel + " { " + p + ": " + v + " }");
  }
  for (const n of doc.nodes) {
    for (const [k, v] of Object.entries(n.attrs)) for (const m of v.matchAll(LITERAL_RE)) found.push(k + " attribute " + m[0]);
    if (n.attrs.style) for (const [p, v] of parseDecls(n.attrs.style)) if (NAMED_RE.test(v)) found.push("style attribute " + p + ": " + v);
  }
  for (const m of jsText.matchAll(LITERAL_RE)) found.push("script " + m[0]);
  return found;
}
const COLOR_PROPS = new Set(["color", "background", "background-color", "border-color", "border-top-color", "border-right-color",
  "border-bottom-color", "border-left-color", "outline-color", "fill", "stroke", "caret-color", "accent-color", "text-decoration-color"]);
function literalRows(f, doc, jsText) {
  const found = colorLiterals(f, doc, jsText);
  const notVar = [];
  for (const r of f.rules) {
    if (r.sel.trim() === ":root") continue;
    for (const [p, v] of r.decls) if (COLOR_PROPS.has(p) && !isVar(v, "[a-z][\\w-]*")) notVar.push(r.sel + " { " + p + ": " + v + " }");
  }
  return [
    [found.length === 0, "no colour literal (#hex, rgb, rgba, hsl, named, transparent) outside :root, in css, style attributes or script", found.join("; ")],
    [notVar.length === 0, "every colour-bearing declaration outside :root is a single var() reference", notVar.join("; ")],
  ];
}

// ---- copper, backdrops, contrast -----------------------------------------------------------------
function copperRows(f) {
  const users = [];
  for (const r of f.rules) {
    if (r.sel.trim() === ":root") continue;
    for (const [p, v] of r.decls) if (/var\(\s*--copper\s*\)/.test(v)) users.push(f.sels(r).join(",") + " {" + p + "}");
  }
  const ok = users.length === 2 && users.includes(".fill {background}") && users.includes(".pct {color}");
  return [[ok, "copper is used only on .fill (background) and .pct (colour)", users.join("; ")]];
}
const pxOf = (v) => { const m = /^(\d+(?:\.\d+)?)px$/.exec(v || ""); return m ? +m[1] : null; };
function textSize(f, sel) {
  const v = f.get(sel, "font-size") || "";
  const m = /^(\d+(?:\.\d+)?)px$/.exec(v) || /^clamp\(\s*(\d+(?:\.\d+)?)px/i.exec(v);
  return m ? +m[1] : 16; // the browser default when a rule sets none
}
function textWeight(f, sel) {
  const v = f.get(sel, "font-weight");
  return v === "bold" ? 700 : /^\d+$/.test(v || "") ? +v : 400;
}
function contrastRows(f) {
  const out = [];
  const col = (sel, prop) => { const v = f.resolve(f.get(sel, prop)); return v ? parseColor(v) : null; };
  const tok = (name) => parseColor(f.tokens.get(name));
  const paper = col("body", "background");
  const muted = tok("--muted");
  const copper = tok("--copper");
  const bar = col(".bar", "background");
  const tick = col(".tick", "background");
  const fill = col(".fill", "background");
  const track = paper && bar ? over(bar, paper) : null;
  const R = (a, b) => (a && b ? ratio(a, b) : NaN);
  const show = (n) => (Number.isNaN(n) ? "unresolved" : f2(n) + ":1");

  const mp = R(muted, paper);
  out.push([mp >= 4.5, "contrast: muted on paper is at least 4.5:1 (small labels)", show(mp)]);

  const cp = R(copper, paper);
  const pctLarge = textSize(f, ".pct") >= 24 || (textSize(f, ".pct") >= 18.66 && textWeight(f, ".pct") >= 700);
  out.push([cp >= 3 && pctLarge, "contrast: copper on paper is at least 3:1 and the copper text (.pct) is large text",
    show(cp) + ", .pct " + textSize(f, ".pct") + "px weight " + textWeight(f, ".pct")]);

  const eff = track ? hexOf(track) : "unresolved";
  const near = track && Math.abs(track.r - 222) <= 1 && Math.abs(track.g - 222) <= 1 && Math.abs(track.b - 220) <= 1;
  out.push([f.get(".bar", "background") === "var(--hairline)" && !!near, "bar track is the hairline token composited over paper, about #DEDEDC", "effective " + eff]);

  const tp = R(tick, track);
  out.push([f.get(".tick", "background") === "var(--ink)" && tp >= 3, "contrast: ink ticks on the track are at least 3:1", show(tp)]);
  const tf = R(tick, fill);
  out.push([tf >= 3, "contrast: ink ticks on the copper fill are at least 3:1", show(tf)]);
  const ft = R(fill, track);
  out.push([f.get(".fill", "background") === "var(--copper)" && ft >= 3, "contrast: copper fill on the track is at least 3:1 (non-text)", show(ft)]);

  const bad = [];
  let n = 0;
  for (const r of f.rules) {
    if (r.media || r.sel.trim() === ":root") continue;
    for (const [p, v] of r.decls) {
      if (p !== "color") continue;
      const c = parseColor(f.resolve(v) || "");
      const sel = f.sels(r)[0];
      const size = textSize(f, sel);
      const large = size >= 24 || (size >= 18.66 && textWeight(f, sel) >= 700);
      const need = large ? 3 : 4.5;
      const got = R(c, paper);
      n++;
      if (!(got >= need)) bad.push(sel + " " + size + "px needs " + need + ", got " + show(got));
    }
  }
  out.push([bad.length === 0 && n > 0, "contrast: every text colour meets its WCAG threshold on paper (" + n + " rules)", bad.join("; ")]);

  const bgOwners = [];
  for (const r of f.rules) {
    if (r.media || r.sel.trim() === ":root") continue;
    for (const [p] of r.decls) if (p === "background" || p === "background-color") bgOwners.push(r.sel.trim());
  }
  const allowed = ["body", ".bar", ".fill", ".tick"];
  const extra = bgOwners.filter((s) => !allowed.includes(s));
  out.push([extra.length === 0, "text always sits on paper: only body, .bar, .fill and .tick set a background", extra.join("; ")]);
  return out;
}

// ---- motion --------------------------------------------------------------------------------------
function motionRows(f) {
  const bad = [];
  for (const a of f.atRules) if (!/^@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)$/i.test(a)) bad.push("at-rule " + a);
  for (const r of f.rules) {
    for (const [p, v] of r.decls) {
      if (/^(-webkit-)?animation/.test(p)) bad.push(r.sel + " " + p);
      if (p === "transition" && !r.media && !(r.sel.trim() === ".fill" && /^width\s/.test(v))) bad.push(r.sel + " transition " + v);
    }
  }
  const off = f.rules.some((r) => r.media && /prefers-reduced-motion/.test(r.media) && r.sel.trim() === ".fill" && r.decls.some(([p, v]) => p === "transition" && v === "none"));
  if (!off) bad.push("no prefers-reduced-motion rule turning the fill transition off");
  return [[bad.length === 0, "motion: the only transition is .fill width, reduced motion turns it off, no keyframes, no animation, no width media query", bad.join("; ")]];
}

// ---- layout arithmetic ---------------------------------------------------------------------------
// Glyph advances, in em, used as worst cases. The brief's digit figure is 0.66em with the 0.04em
// negative letter-spacing applied on top. The "Japan." table is a heavy grotesque, glyph by glyph
// (J a p a n .). Mono advance is 0.6em, a percent sign 1.0em.
const ADV = { digit: 0.66, mono: 0.6, percent: 1.0, japan: [0.60, 0.62, 0.66, 0.62, 0.66, 0.34] };
function layoutRows(f, doc) {
  const out = [];
  const bad = [];
  const need = (v, what, re) => { const m = re.exec(v || ""); if (!m) bad.push("cannot parse " + what + " from '" + v + "'"); return m; };
  const clampRe = /^clamp\(\s*(\d+(?:\.\d+)?)px\s*,\s*(\d+(?:\.\d+)?)vw\s*,\s*(\d+(?:\.\d+)?)px\s*\)$/i;
  const emRe = /^(-?(?:\d+\.?\d*|\.\d+))em$/i;
  const spacing = (v, what) => { // letter-spacing as a one-element match array holding a number of em
    if (/^(?:0(?:px)?|normal)$/i.test(v || "")) return [v, "0"];
    return need(v, what, emRe);
  };
  const numFs = need(f.get(".num", "font-size"), ".num font-size", clampRe);
  const numLs = spacing(f.get(".num", "letter-spacing"), ".num letter-spacing");
  const goFs = need(f.get(".go", "font-size"), ".go font-size", clampRe);
  const goLs = spacing(f.get(".go", "letter-spacing"), ".go letter-spacing");
  const maxW = need(f.get("main", "max-width"), "main max-width", /^(\d+)px$/);
  const padM = need(f.get("main", "padding"), "main padding", /^(\d+)(?:px)?(?:\s+(\d+)(?:px)?)?(?:\s+(\d+)(?:px)?)?(?:\s+(\d+)(?:px)?)?$/);
  if (f.get("main", "padding-left") !== undefined || f.get("main", "padding-right") !== undefined) bad.push("main sets padding-left or padding-right, which this arithmetic does not model");
  if (bad.length) return [[false, "layout arithmetic can read the page's CSS", bad.join("; ")]];

  const padv = padM.slice(1).filter((x) => x !== undefined).map(Number);
  const padX = padv.length === 1 ? 2 * padv[0] : padv.length === 4 ? padv[1] + padv[3] : 2 * padv[1];
  const content = (vw) => Math.min(vw, +maxW[1]) - padX;
  const fs = (c, vw) => Math.min(+c[3], Math.max(+c[1], (+c[2] * vw) / 100));
  const numW = (vw, digits) => digits * (ADV.digit + +numLs[1]) * fs(numFs, vw);
  const japanEm = ADV.japan.reduce((a, b) => a + b, 0) + ADV.japan.length * +goLs[1];
  const goW = (vw) => japanEm * fs(goFs, vw);

  // structure the arithmetic depends on
  const structure = [];
  if (f.get("*", "box-sizing") !== "border-box") structure.push("box-sizing is not border-box on *, padding would add to the width");
  if (!/^0(px)?$/.test(f.get("body", "margin") || "")) structure.push("body margin is not 0");
  if (f.get("main", "width") !== "100%") structure.push("main width is not 100%");
  const fixed = [];
  const sizes = [];
  for (const r of f.rules) {
    for (const [p, v] of r.decls) {
      if ((p === "width" || p === "min-width") && pxOf(v) !== null && pxOf(v) > content(320)) fixed.push(r.sel + " " + p + " " + v);
      if (p === "font-size") {
        const m = /^(\d+(?:\.\d+)?)px$/.exec(v) || /^clamp\(\s*(\d+(?:\.\d+)?)px/i.exec(v);
        if (m) sizes.push(+m[1]); else structure.push(r.sel + " font-size '" + v + "' is not px or clamp(px)");
      }
    }
  }
  if (fixed.length) structure.push("fixed width wider than the 320px content width: " + fixed.join(", "));
  const minSize = Math.min(...sizes);
  if (!(minSize >= 12)) structure.push("smallest font-size is " + minSize + "px");
  if (+maxW[1] !== 480) structure.push("main max-width is " + maxW[1] + "px, the page keeps 480px");
  out.push([structure.length === 0, "layout: border-box, zero body margin, no fixed width over " + content(320) + "px, smallest text " + minSize + "px, main max-width 480px", structure.join("; ")]);

  for (const vw of [390, 320]) {
    const c = content(vw);
    const n3 = numW(vw, 3);
    const n4 = numW(vw, 4);
    const jp = goW(vw);
    out.push([n3 <= c, "layout " + vw + "px: hero number, 3 digits, fits the content width", f1(n3) + " of " + c + " px, font " + f1(fs(numFs, vw)) + " px"]);
    out.push([n4 <= c, "layout " + vw + "px: hero number, 4 digits, fits the content width", f1(n4) + " of " + c + " px, " + f1(c - n4) + " px spare" + (c - n4 < 5 ? " (tight)" : "")]);
    out.push([jp <= c, "layout " + vw + "px: Japan. line fits the content width", f1(jp) + " of " + c + " px, font " + f1(fs(goFs, vw)) + " px"]);
  }

  // stats row, fund heading and the tick labels
  const pctFs = pxOf(f.get(".pct", "font-size"));
  const moneyFs = pxOf(f.get(".money", "font-size"));
  const h2Fs = pxOf(f.get(".fund h2", "font-size"));
  const h2Ls = emRe.exec(f.get(".fund h2", "letter-spacing") || "");
  const labelFs = pxOf(f.get(".ticks", "font-size"));
  const gap = pxOf(f.get(".stats", "gap"));
  const wraps = f.get(".stats", "flex-wrap") === "wrap";
  const lefts = doc.nodes.filter((n) => n.tag === "span" && n.parent && /(^|\s)ticks(\s|$)/.test(n.parent.attrs.class || ""))
    .map((n) => { const m = /left\s*:\s*(\d+(?:\.\d+)?)%/.exec(n.attrs.style || ""); return m ? +m[1] : NaN; });
  if ([pctFs, moneyFs, h2Fs, labelFs, gap].some((x) => x === null) || !h2Ls || !lefts.length || lefts.some(Number.isNaN)) {
    out.push([false, "layout: stats row, heading and tick labels can be read from the CSS and markup", "pct " + pctFs + " money " + moneyFs + " h2 " + h2Fs + " labels " + labelFs + " gap " + gap + " lefts " + lefts.join(",")]);
  } else {
    for (const vw of [390, 320]) {
      const c = content(vw);
      const pctW = (3 * ADV.digit + ADV.percent) * pctFs;
      const moneyW = 16 * ADV.mono * moneyFs;
      const row = pctW + gap + moneyW;
      const h2W = "JAPAN FUND".length * (ADV.mono + +h2Ls[1]) * h2Fs;
      const labelW = 3 * ADV.mono * labelFs;
      const problems = [];
      if (pctW > c || moneyW > c) problems.push("a stats item is wider than the row");
      if (row > c && !wraps) problems.push("stats row is " + f1(row) + " of " + c + " px and flex-wrap is not wrap");
      if (h2W > c) problems.push("heading is " + f1(h2W) + " px");
      lefts.forEach((p, i) => {
        const left = (p / 100) * c - labelW / 2;
        if (left < 0 || left + labelW > c) problems.push(p + "% label leaves the bar");
        if (i > 0 && ((p - lefts[i - 1]) / 100) * c < labelW) problems.push(lefts[i - 1] + "% and " + p + "% labels overlap");
      });
      out.push([problems.length === 0, "layout " + vw + "px: stats row, fund heading and 25/50/75% labels fit",
        "'100%' " + f1(pctW) + " px, '$4,000 of $4,000' " + f1(moneyW) + " px, " + (row <= c ? "one row of " + f1(row) : "wraps at " + f1(row)) + " of " + c + " px; heading " + f1(h2W) + " px; label " + f1(labelW) + " px" + (problems.length ? "; " + problems.join("; ") : "")]);
    }
  }

  // every viewport from 320 to 1920
  const worst = { n3: [1e9, 0], n4: [1e9, 0], jp: [1e9, 0] };
  const over0 = [];
  for (let vw = 320; vw <= 1920; vw++) {
    const c = content(vw);
    const s = { n3: c - numW(vw, 3), n4: c - numW(vw, 4), jp: c - goW(vw) };
    for (const k of Object.keys(s)) {
      if (s[k] < worst[k][0]) worst[k] = [s[k], vw];
      if (s[k] < 0) over0.push(k + " at " + vw);
    }
  }
  let narrowest = 320;
  while (narrowest > 200 && numW(narrowest - 1, 4) <= content(narrowest - 1)) narrowest--;
  out.push([over0.length === 0, "layout 320 to 1920px: 3 digits, 4 digits and Japan. fit at every width, nothing relies on overflow-x",
    "tightest spare: 4 digits " + f1(worst.n4[0]) + " px at " + worst.n4[1] + "px, 3 digits " + f1(worst.n3[0]) + " px at " + worst.n3[1] + "px, Japan. " + f1(worst.jp[0]) + " px at " + worst.jp[1] + "px; 4 digits fit down to " + narrowest + "px" + (over0.length ? "; overflow: " + listBad(over0) : "")]);
  return out;
}

// =================================================================================================
// CHECKS
// =================================================================================================
console.log("acceptance.js: index.html " + SRC.length + " bytes, node " + process.version + ", system UTC offset in January " + TZ0.jan + " min");

// ---- 1. static structure -------------------------------------------------------------------------
section("static structure", () => {
  const doc = PAGE.doc;
  const odd = doc.scripts.concat(doc.styles).filter((s) => Object.keys(s.node.attrs).length);
  t(doc.scripts.length >= 1 && doc.styles.length >= 1 && odd.length === 0,
    "script and style blocks are plain: no src, type, module, async or defer (so they run from file://)",
    doc.scripts.length + " script, " + doc.styles.length + " style" + (odd.length ? "; attributes on " + odd.map((s) => s.node.tag).join(",") : ""));
  t(doc.problems.length === 0, "markup is well formed: every element closes in order, no stray tags", doc.problems.join("; "));

  const dups = [...doc.byId].filter(([, n]) => n.length > 1).map(([id, n]) => id + " x" + n.length);
  t(dups.length === 0, "no duplicate id in the static markup", dups.join(", "));

  const asked = [];
  let calls = 0;
  doc.scripts.forEach((s, k) => {
    const code = stripJs(s.code);
    calls += (code.match(/getElementById\s*\(/g) || []).length;
    for (const m of code.matchAll(/getElementById\s*\(\s*(["'])([^"']*)\1\s*\)/g)) asked.push([k, m[2]]);
  });
  const problems = [];
  if (calls !== asked.length) problems.push("a getElementById call has a non-literal argument");
  for (const [k, id] of asked) {
    const n = doc.ids.filter((x) => x === id).length;
    if (n !== 1) problems.push(id + " appears " + n + " times in the static markup");
    else if (!doc.scripts[k].idsBefore.includes(id)) problems.push(id + " is defined after the script that asks for it");
  }
  const uniq = [...new Set(asked.map((a) => a[1]))];
  t(problems.length === 0 && uniq.length > 0,
    "every id the page asks for appears exactly once in the static markup, above the script that asks (" + uniq.join(" ") + ")", problems.join("; "));
  const need = ["hero", "num", "line", "bar", "fill", "pct", "money"];
  const missing = need.filter((id) => doc.ids.filter((x) => x === id).length !== 1);
  t(missing.length === 0, "the seven ids the gate and tests rely on are each present once: " + need.join(" "), missing.join(" "));

  const meta = doc.nodes.filter((n) => n.tag === "meta");
  const vp = meta.find((n) => (n.attrs.name || "").toLowerCase() === "viewport");
  const vpc = vp ? vp.attrs.content || "" : "";
  const lock = /user-scalable\s*=\s*(?:no|0)/i.test(vpc) || /maximum-scale\s*=\s*(?:0*\.\d+|1(?:\.0+)?)(?![\d.])/i.test(vpc);
  t(!!vp && /width\s*=\s*device-width/i.test(vpc) && /initial-scale\s*=\s*1(?![\d.])/.test(vpc) && !lock,
    "viewport meta is device-width, initial-scale 1, and pinch zoom is not disabled", vpc);
  const cs = meta.find((n) => n.attrs.charset !== undefined);
  const html = doc.nodes.find((n) => n.tag === "html");
  const title = doc.nodes.find((n) => n.tag === "title");
  t(!!cs && /^utf-8$/i.test(cs.attrs.charset) && SRC.slice(0, 1024).toLowerCase().includes("<meta charset") && !!html && !!(html.attrs.lang || "").trim() && !!title && textOf(title).trim() !== "",
    "charset utf-8 within the first 1024 bytes, html lang set, non-empty title", "lang=" + (html && html.attrs.lang) + " title=" + (title && textOf(title)));

  const cls = (n, c) => new RegExp("(^|\\s)" + c + "(\\s|$)").test(n.attrs.class || "");
  const leftOf = (n) => { const m = /left\s*:\s*(\d+(?:\.\d+)?)%/.exec(n.attrs.style || ""); return m ? +m[1] : NaN; };
  const ticks = doc.nodes.filter((n) => cls(n, "tick"));
  const labels = doc.nodes.filter((n) => n.tag === "span" && n.parent && cls(n.parent, "ticks"));
  const J = JSON.stringify;
  t(J(ticks.map(leftOf)) === "[25,50,75]" && J(labels.map(leftOf)) === "[25,50,75]" && J(labels.map((n) => textOf(n).trim())) === '["25%","50%","75%"]',
    "milestone ticks sit at 25, 50 and 75 percent, each with a matching label", "ticks " + ticks.map(leftOf).join(",") + " labels " + labels.map((n) => textOf(n).trim()).join(","));

  const bar = (doc.byId.get("bar") || [])[0];
  const a = bar ? bar.attrs : {};
  t(!!bar && a.role === "progressbar" && (a["aria-label"] || "").trim() !== "" && a["aria-valuemin"] === "0" && a["aria-valuemax"] === "100",
    "progress bar has role progressbar, an aria-label, aria-valuemin 0 and aria-valuemax 100", bar ? J(a) : "no #bar");
});

// ---- 2. day count in five time zones, through the DOM --------------------------------------------
section("date oracle", () => {
  const anchored = FIXED.every((c) => daysBetween(c[0], c[1], c[2]) === c[6]);
  t(anchored && daysBetween(2027, 2, 20) === 7 && daysBetween(2026, 9, 2) === 176 && daysBetween(2027, 2, 27) === 0,
    "date oracle agrees with the hand-checked counts: 7 on 2027-03-20, 176 on 2026-10-02, 0 on 2027-03-27");
});
for (const [zone, jan, jul, minTrans] of ZONES) {
  section("zone " + zone, () => withZone(zone, jan, jul, (z) => {
    t(z.ok, "zone " + zone + " applied, offsets Jan/Jul " + z.jan + "/" + z.jul, z.ok ? "" : "wanted " + jan + "/" + jul + ", so TZ was ignored or tz data is missing");
    if (!z.ok) return;
    const bad = [];
    for (const c of FIXED) { const m = dayProblem(SRC, c.slice(0, 3), c.slice(3, 6)); if (m) bad.push(m); }
    const trans = transitionDays();
    let dst = 0;
    for (const tr of trans) for (const ymd of [tr.prevYmd, tr.ymd]) for (const hms of BOUNDARY_TIMES) { dst++; const m = dayProblem(SRC, ymd, hms); if (m) bad.push(m); }
    let sweep = 0;
    for (const ymd of windowDays()) for (const hms of SWEEP_TIMES) { sweep++; const m = dayProblem(SRC, ymd, hms); if (m) bad.push(m); }
    t(bad.length === 0, "zone " + zone + ": whole days to 2027-03-27 follow the local calendar date in " + (FIXED.length + dst + sweep) + " cases",
      bad.length ? listBad(bad) : "fixed " + FIXED.length + ", offset-change days " + dst + ", every day 2026-10-01 to 2027-04-06 at 00:00, 12:00 and 23:59:59 " + sweep);
    t(trans.length >= minTrans, "zone " + zone + ": offset changes inside the window" + (minTrans ? ", so the DST cases are not vacuous" : ", none required"),
      trans.length ? trans.map((x) => ymdText(x.ymd)).join(" ") : "none");
    const tb = [];
    for (const c of TRIP_STATES) { const m = dayProblem(SRC, c.slice(0, 3), c.slice(3, 6)); if (m) tb.push(m); }
    t(tb.length === 0, "zone " + zone + ": trip day and every later date show only a Japan. line, no number, no count line", tb.length ? listBad(tb) : TRIP_STATES.length + " dates");
    const mb = midnightProblems(SRC);
    t(mb.length === 0, "zone " + zone + ": visibilitychange across local midnight refreshes the count, then Japan. on the trip day", listBad(mb));
  }));
}

// ---- 3. constants, singular line, hand edits, SAVED ---------------------------------------------
section("constants and copy lines", () => {
  const first = PAGE.doc.scripts[0] ? PAGE.doc.scripts[0].code : "";
  const trip = /const\s+TRIP_DATE\s*=\s*"([^"]*)"/.exec(first);
  const saved = /const\s+SAVED\s*=\s*([^;]*);/.exec(first);
  t(!!trip && trip[1] === "2027-03-27" && !!saved && saved[1].trim() === "0", "shipped constants are TRIP_DATE 2027-03-27 and SAVED 0",
    "TRIP_DATE " + (trip && trip[1]) + ", SAVED " + (saved && saved[1]));

  const many = render(SRC, new Date(2026, 9, 7, 10), { label: "171 days" });
  const two = render(SRC, new Date(2027, 2, 25, 10), { label: "2 days" });
  const one = render(SRC, new Date(2027, 2, 26, 10), { label: "1 day" });
  t(many.text("num") === "171" && many.text("line") === "days until Japan." && two.text("num") === "2" && two.text("line") === "days until Japan." &&
    one.text("num") === "1" && one.text("line") === "day until Japan.",
    "hero reads '171 days until Japan.' and '2 days until Japan.', and singular '1 day until Japan.' at one day",
    many.text("num") + " " + many.text("line") + " | " + two.text("num") + " " + two.text("line") + " | " + one.text("num") + " " + one.text("line"));

  const nowD = new Date();
  const todayMsg = dayProblem(SRC, [nowD.getFullYear(), nowD.getMonth(), nowD.getDate()], [nowD.getHours(), nowD.getMinutes(), nowD.getSeconds()], { label: "real clock" });
  t(todayMsg === null, "countdown for the real clock's local date matches the calendar (" + nowD.getFullYear() + "-" + pad2(nowD.getMonth() + 1) + "-" + pad2(nowD.getDate()) + ")", todayMsg);

  const ed = render(withConst(SRC, "TRIP_DATE", '"2027-04-10"'), new Date(2027, 2, 20, 12), { label: "TRIP_DATE edit" });
  const ed0 = render(withConst(SRC, "TRIP_DATE", '"2027-03-20"'), new Date(2027, 2, 20, 12), { label: "TRIP_DATE today" });
  t(ed.text("num") === "21" && japanOnly(ed0.el("hero").innerHTML),
    "editing TRIP_DATE by hand drives the page: 2027-04-10 gives 21 days on 2027-03-20, and the date itself gives Japan.", "got " + ed.text("num") + " and '" + ed0.el("hero").innerHTML + "'");

  const trip0 = render(withConst(SRC, "SAVED", "2000"), new Date(2027, 2, 27, 9), { label: "trip day with SAVED=2000" });
  t(japanOnly(trip0.el("hero").innerHTML) && trip0.text("pct") === "50%" && trip0.text("money") === "$2,000 of $4,000",
    "on the trip day only the hero changes: the fund bar still renders", trip0.text("pct") + " " + trip0.text("money"));
});

section("same-day re-render", () => {
  const bad = sameDayProblems(SRC);
  t(bad.length === 0, "a same-day visibilitychange leaves the aria-live hero alone: same nodes, no writes, on a counting day and on the trip day",
    bad.length ? listBad(bad) : "three events on 2026-10-07 and on 2027-03-27, checked on #hero #num #line");
});

section("SAVED and progress bar", () => {
  const at = new Date(2026, 9, 2, 12);
  const p0 = render(SRC, at, { label: "shipped SAVED" });
  t(p0.text("pct") === "0%" && p0.text("money") === "$0 of $4,000" && p0.el("fill").style.width === "0%" && p0.el("bar").attrs["aria-valuenow"] === "0",
    'shipped SAVED = 0 renders "0%", "$0 of $4,000", an empty fill and aria-valuenow 0', p0.text("pct") + " " + p0.text("money") + " " + p0.el("fill").style.width);
  const p2 = render(withConst(SRC, "SAVED", "2000"), at, { label: "SAVED=2000" });
  t(p2.text("pct") === "50%" && p2.text("money") === "$2,000 of $4,000" && p2.el("fill").style.width === "50%" && p2.el("bar").attrs["aria-valuenow"] === "50",
    'SAVED = 2000 renders "50%", "$2,000 of $4,000", a fill 50% wide and aria-valuenow 50', p2.text("pct") + " " + p2.text("money") + " " + p2.el("fill").style.width + " " + p2.el("bar").attrs["aria-valuenow"]);

  // literal in the page, pct label, money line, fill width in percent, aria-valuenow
  const table = [
    ["0", "0%", "$0 of $4,000", 0, "0"], ["1", "0%", "$1 of $4,000", 0.025, "0"], ["400", "10%", "$400 of $4,000", 10, "10"],
    ["1000", "25%", "$1,000 of $4,000", 25, "25"], ["1234", "31%", "$1,234 of $4,000", 30.85, "31"], ["3000", "75%", "$3,000 of $4,000", 75, "75"],
    ["4000", "100%", "$4,000 of $4,000", 100, "100"], ["5000", "100%", "$4,000 of $4,000", 100, "100"], ["-5", "0%", "$0 of $4,000", 0, "0"],
    ["NaN", "0%", "$0 of $4,000", 0, "0"], ["Infinity", "100%", "$4,000 of $4,000", 100, "100"], ["-Infinity", "0%", "$0 of $4,000", 0, "0"],
  ];
  const bad = [];
  for (const [lit, pct, money, width, now] of table) {
    const p = render(withConst(SRC, "SAVED", lit), at, { label: "SAVED=" + lit });
    const w = p.el("fill").style.width;
    const wn = parseFloat(w);
    const aria = p.el("bar").attrs["aria-valuenow"];
    if (p.text("pct") !== pct) bad.push("SAVED " + lit + " label '" + p.text("pct") + "', want " + pct);
    if (p.text("money") !== money) bad.push("SAVED " + lit + " money '" + p.text("money") + "', want " + money);
    if (!/^[\d.e+-]+%$/.test(w) || Math.abs(wn - width) > 1e-9) bad.push("SAVED " + lit + " fill width '" + w + "', want " + width + "%");
    if (aria !== now) bad.push("SAVED " + lit + " aria-valuenow '" + aria + "', want " + now);
  }
  t(bad.length === 0, "SAVED edge values clamp and format: 0, 1, 400, 1000, 1234, 3000, 4000, 5000, -5, NaN, Infinity, -Infinity",
    bad.length ? listBad(bad) : table.length + " values, label, money, fill width and aria-valuenow each checked");

  const m = /\/\/ BEGIN LOGIC([\s\S]*?)\/\/ END LOGIC/.exec(SRC);
  const progress = new Function(m[1] + "\nreturn progress;")();
  const sweep = [];
  let prev = -1;
  for (let v = 0; v <= 4100; v++) {
    const r = progress(v);
    const label = /^(\d{1,3})%$/.exec(r.label);
    const dollars = /^\$([\d,]+) of \$4,000$/.exec(r.money);
    const amount = dollars ? Number(dollars[1].replace(/,/g, "")) : NaN;
    if (!label || +label[1] > 100) sweep.push(v + " label " + r.label);
    else if (!dollars || amount > 4000 || (/,/.test(dollars[1]) && !/^\d{1,3}(,\d{3})+$/.test(dollars[1]))) sweep.push(v + " money " + r.money);
    else if (r.pct < prev || r.pct < 0 || r.pct > 100) sweep.push(v + " pct " + r.pct);
    prev = r.pct;
  }
  t(sweep.length === 0, "progress() for every whole dollar from 0 to 4100: label 0-100%, money well formed and never above $4,000, pct never decreases", listBad(sweep));
});

// ---- 4. tokens, colour literals, contrast, motion, layout ----------------------------------------
section("tokens", () => rows(tokenRows(PAGE.f)));
section("colour literals", () => rows(literalRows(PAGE.f, PAGE.doc, PAGE.js)));
section("copper", () => rows(copperRows(PAGE.f)));
section("contrast", () => rows(contrastRows(PAGE.f)));
section("motion", () => rows(motionRows(PAGE.f)));
section("layout", () => rows(layoutRows(PAGE.f, PAGE.doc)));

// ---- 5. static scans, each rule proven by a positive control -------------------------------------
// A rule is [label, regex, samples that must match, text to scan]. The scan passes only if every
// sample matches its regex (the pattern is alive) and the page text matches none of the regexes.
const TAGS = ["img", "iframe", "audio", "video", "source", "object", "embed", "form", "picture", "track", "link", "base"];
const ATTRS = "src|srcset|href|xlink:href|action|formaction|poster|ping|data|manifest|background|srcdoc";
// Properties that start a fetch or navigation when assigned. style.background and Text#data are left out on purpose.
const PROPS = "src|srcset|href|action|formaction|poster|ping|srcdoc";
const SCANS = [
  ["scan: no http or https URL anywhere, comments included, no protocol-relative URL, no other scheme", [
    ["http(s) URL", /https?:\/\//i, ['x = "http://a.test/"', "see https://a.test"], SRC],
    ["protocol-relative URL", /(?:^|[\s"'(=,])\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)+/i, ['src="//cdn.test/x.js"', "url(//cdn.test/a.png)"]],
    ["other scheme", /(?:^|[\s"'(=,])(?:ftp|wss?|file|blob|data|javascript|mailto|tel):/i, ['href="data:,"', "ws://x", 'src="blob:x"', "href='javascript:void(0)'"]],
  ]],
  ["scan: no fetch, XMLHttpRequest, WebSocket, EventSource, sendBeacon, importScripts", [
    ["network API", /\b(?:fetch|XMLHttpRequest|WebSocket|WebTransport|EventSource|sendBeacon|importScripts)\b/,
      ["fetch('x')", "new XMLHttpRequest()", "new WebSocket('x')", "new EventSource('x')", "navigator.sendBeacon('x')", "importScripts('x')"]],
  ]],
  ["scan: no new Image, Audio, Worker, serviceWorker, import(), createElement, document.write, eval, new Function", [
    ["Image constructor", /\bnew\s+Image\b|\bImage\s*\(/, ["new Image()", "new  Image", "Image()"]],
    ["Audio constructor", /\bnew\s+Audio\b/, ["new Audio('x')"]],
    ["Worker", /\b(?:Shared)?Worker\b|Worklet\b/, ["new Worker('w.js')", "new SharedWorker('w.js')", "CSS.paintWorklet.addModule()", "audioWorklet.addModule('a.js')"]],
    ["serviceWorker", /\bserviceWorker\b/, ["navigator.serviceWorker.register('sw.js')"]],
    ["import and require", /\bimport\s*[({'"*]|\bimport\s+[\w$]+|\bimport\.meta\b|\brequire\s*\(/, ["import('x')", "import x from 'y'", "import {a} from 'y'", "import 'y'", "import.meta.url", "require('x')"]],
    ["dynamic code and elements", /\bcreateElement(?:NS)?\s*\(|\bdocument\s*\.\s*write(?:ln)?\s*\(|\beval\s*\(|\bnew\s+Function\b|\bFunction\s*\(/,
      ["document.createElement('img')", "document.write('x')", "eval('x')", "new Function('x')"]],
  ]],
  ["scan: no @font-face, @import, url(), image-set()", [
    ["@font-face", /@font-face/i, ["@font-face{font-family:a}"]],
    ["@import", /@import\b/i, ["@import 'a.css';"]],
    ["url()", /\burl\s*\(/i, ["a{background:url(x.png)}", "a{cursor:url('x'),auto}"]],
    ["image-set()", /image-set\s*\(/i, ["a{background:image-set(x 1x)}", "a{background:-webkit-image-set(x 1x)}"]],
  ]],
  ["scan: no img, iframe, audio, video, source, object, embed, form, picture, track, link or base tag, no meta refresh, no script src", [
    ["loading tag", new RegExp("<\\s*(?:" + TAGS.join("|") + ")\\b", "i"), TAGS.map((x) => "<" + x + " x>")],
    ["meta refresh", /<meta\b[^>]*http-equiv\s*=\s*["']?\s*refresh/i, ['<meta http-equiv="refresh" content="5">', "<meta http-equiv=refresh content=5>"]],
    ["meta url", /<meta\b[^>]*\burl\s*=/i, ['<meta content="0;url=x">']],
    ["script src", /<script\b[^>]*\bsrc\b/i, ['<script src="a.js"></script>']],
  ]],
  ["scan: no src, href or action attribute, no assignment to src, href or location, no window.open", [
    ["fetching attribute", new RegExp("<[a-z][^<>]*?\\s(?:" + ATTRS + ")\\s*=", "i"),
      ['<a href="x">', "<img src=x>", '<form action="x">', '<video poster="x">', '<object data="x">', '<iframe srcdoc="x">']],
    ["property assignment", new RegExp("\\.\\s*(?:" + PROPS + ")\\s*=(?!=)"), ["img.src = 'x'", "a.href='x'", "f.action = 'x'"]],
    ["setAttribute", new RegExp("\\bsetAttribute(?:NS)?\\s*\\(\\s*[\"'](?:" + ATTRS + ")[\"']"), ["el.setAttribute('src', 'x')", 'a.setAttribute("href","x")']],
    ["location", /\blocation\b/, ["location = 'x'", "window.location.href = 'x'", "location.assign('x')", "document.location.replace('x')"]],
    ["window.open and history", /\bwindow\s*\.\s*open\s*\(|\bhistory\s*\.\s*(?:pushState|replaceState)\b/, ["window.open('x')", "history.pushState(0,'','x')"]],
  ]],
  ["scan: no setInterval, setTimeout, requestAnimationFrame, requestIdleCallback, setImmediate, queueMicrotask", [
    ["timer", /\b(?:setInterval|setTimeout|requestAnimationFrame|requestIdleCallback|setImmediate|queueMicrotask)\b/,
      ["setInterval(f, 1)", "setTimeout(f, 1)", "requestAnimationFrame(f)", "requestIdleCallback(f)", "setImmediate(f)", "queueMicrotask(f)"]],
  ]],
];
function runScan(rules, text) {
  const dead = [];
  const hits = [];
  for (const [label, re, samples, own] of rules) {
    for (const s of samples) if (!re.test(s)) dead.push(label + " pattern does not match its own sample " + JSON.stringify(s));
    const m = re.exec(own === undefined ? text : own);
    if (m) hits.push(label + " found: " + JSON.stringify(m[0]));
  }
  return { dead, hits };
}
section("scans", () => {
  for (const [name, rules] of SCANS) {
    const r = runScan(rules, PAGE.clean);
    t(r.dead.length === 0 && r.hits.length === 0, name, r.dead.concat(r.hits).join("; ") || rules.length + " pattern" + (rules.length > 1 ? "s" : "") + ", each proven by a sample, none found in the page");
  }
});

// ---- 6. copy: non-ASCII, emoji -------------------------------------------------------------------
const EMOJI_RE = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Emoji_Modifier}|\p{Emoji_Presentation}|[\u{FE0F}\u{20E3}\u{200D}\u{E0020}-\u{E007F}]/u;
const NON_ASCII_RE = /[^\x00-\x7F]/;
const CONTROL_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;
const EMOJI_SAMPLES = ["\u{1F5FE}", "\u{1F1EF}\u{1F1F5}", "\u{2764}\u{FE0F}", "1\u{FE0F}\u{20E3}", "\u{26E9}", "\u{2708}", "\u{1F3FB}", "\u{1F468}\u{200D}\u{1F469}", "\u{1F3F4}\u{E0067}\u{E007F}"];
function firstNonAscii(s) {
  const lines = s.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = NON_ASCII_RE.exec(lines[i]);
    if (m) return "U+" + lines[i].codePointAt(m.index).toString(16).toUpperCase().padStart(4, "0") + " on line " + (i + 1);
  }
  return null;
}
section("copy", () => {
  const na = firstNonAscii(SRC);
  t(na === null && !CONTROL_RE.test(SRC), "source is plain ASCII: no non-ASCII character, no BOM, no control character", na || "");
});

// ---- 7. controls: prove the checks above can fail ------------------------------------------------
// Each control feeds a deliberately broken input to the same code the real checks use. The css
// controls run on a frozen, known-good copy of the stylesheet, so they keep working however the live
// page changes. Control renders are kept out of the audit below.
const J = JSON.stringify;
const GOOD_CSS = [
  ":root{--paper:#FAFAF7;--ink:#111413;--copper:#C2542A;/* 4.37:1 on paper: large text and non-text only */--muted:#6B6E6C;--hairline:rgba(17,20,19,0.12);--font-sans:'Inter Tight',ui-sans-serif,system-ui,sans-serif;--font-mono:'JetBrains Mono',ui-monospace,Menlo,Consolas,monospace}",
  "*{box-sizing:border-box}",
  "html,body{margin:0;padding:0}",
  "body{background:var(--paper);color:var(--ink);font-family:var(--font-sans);min-height:100vh;min-height:100dvh;display:flex;justify-content:center;overflow-x:hidden}",
  "main{width:100%;max-width:480px;padding:48px 24px;display:flex;flex-direction:column;justify-content:center;gap:64px}",
  ".hero{text-align:left}",
  ".num{font-size:clamp(96px,34vw,168px);line-height:.9;font-weight:800;letter-spacing:-.04em;color:var(--ink);font-variant-numeric:tabular-nums}",
  ".line{margin:16px 0 0;font-size:20px;font-weight:600;color:var(--ink)}",
  ".go{font-size:clamp(64px,24vw,120px);font-weight:800;letter-spacing:-.03em;margin:0}",
  ".fund h2{margin:0 0 12px;font-family:var(--font-mono);font-size:14px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}",
  ".bar{position:relative;height:16px;background:var(--hairline);border-radius:8px;overflow:hidden}",
  ".fill{height:100%;width:0;background:var(--copper);transition:width .6s ease}",
  ".tick{position:absolute;top:0;bottom:0;width:2px;margin-left:-1px;background:var(--ink)}",
  ".ticks{position:relative;height:20px;margin-top:6px;font-family:var(--font-mono);font-size:13px;color:var(--muted)}",
  ".ticks span{position:absolute;transform:translateX(-50%)}",
  ".stats{display:flex;justify-content:space-between;align-items:baseline;margin-top:8px;gap:12px;flex-wrap:wrap}",
  ".pct{font-size:32px;font-weight:800;color:var(--copper)}",
  ".money{font-family:var(--font-mono);font-size:18px;color:var(--muted)}",
  "@media (prefers-reduced-motion:reduce){.fill{transition:none}}",
].join("\n");
const GOOD_DOC = parseHtml('<div class="ticks"><span style="left:25%">25%</span><span style="left:50%">50%</span><span style="left:75%">75%</span></div>');
const goodFacts = (css) => cssFacts(stripCss(css));

section("control: harness", () => {
  const now = new Date(2026, 9, 2, 12);
  const mini = (body) => '<!DOCTYPE html><html><head></head><body><p id="a"></p><script>' + body + "</script></body></html>";
  const c1 = render(mini('document.getElementById("zz").textContent = "x";'), now, { control: true });
  const c2 = render('<html><head><script>document.getElementById("a").textContent = "x";</script></head><body><p id="a"></p></body></html>', now, { control: true });
  const c3 = render(mini('console.warn("w"); throw new Error("boom");'), now, { control: true });
  const c4 = render(mini('document.getElementById("a").textContent = "ok";'), now, { control: true });
  const c5 = render(mini('document.getElementById("a").innerHTML = "<b id=\\"k\\"></b>"; document.getElementById("k").textContent = "kid";'), now, { control: true });
  t(c1.misses.join() === "zz" && c1.errors.length === 1 && /null/.test(c1.errors[0]) && c2.misses.join() === "a" && c2.errors.length === 1 &&
    c3.calls.length === 1 && c3.errors.length === 1 && /boom/.test(c3.errors[0]) &&
    c4.misses.length === 0 && c4.errors.length === 0 && c4.calls.length === 0 && c4.text("a") === "ok" &&
    c5.errors.length === 0 && c5.text("k") === "kid",
    "control: the fake document returns null for an unknown id and for an element below the script, records console calls and uncaught errors, and serves ids created by innerHTML",
    "unknown id " + J([c1.misses, c1.errors]) + "; script above element " + J(c2.misses) + "; console and throw " + J([c3.calls, c3.errors]));
});

section("control: same-day re-render", () => {
  const ctl = { control: true };
  const live = (fn) => '<!DOCTYPE html><html><head></head><body><section id="hero"><div id="num"></div><p id="line"></p></section><script>' + fn +
    ' document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") render(); }); render();</script></body></html>';
  const rebuild = live('function render() { var h = document.getElementById("hero"); h.innerHTML = "<div id=\\"num\\"></div><p id=\\"line\\"></p>"; ' +
    'document.getElementById("num").textContent = "171"; document.getElementById("line").textContent = "days until Japan."; }');
  const rewrite = live('function render() { document.getElementById("num").textContent = "171"; document.getElementById("line").textContent = "days until Japan."; }');
  const onChange = live('function render() { var n = document.getElementById("num"); var l = document.getElementById("line"); ' +
    'if (n.textContent !== "171") n.textContent = "171"; if (l.textContent !== "days until Japan.") l.textContent = "days until Japan."; }');
  const a = sameDayProblems(rebuild, ctl);
  const b = sameDayProblems(rewrite, ctl);
  const c = sameDayProblems(onChange, ctl);
  t(a.some((m) => /replaced/.test(m)) && b.length > 0 && b.every((m) => /written/.test(m)) && c.length === 0,
    "control: the same-day check flags a hero that rebuilds its nodes, flags one that rewrites identical text into the same nodes, and passes one that writes only on change",
    "rebuild " + a.length + " problems, rewrite " + b.length + " problems, write on change " + c.length + " problems");
});

section("control: day count", () => {
  const block = /\/\/ BEGIN LOGIC[\s\S]*?\/\/ END LOGIC/.exec(SRC)[0];
  const mutated = SRC.replace(block, () => block.replace(/\.get(FullYear|Month|Date)\(\)/g, ".getUTC$1()"));
  if (mutated === SRC) throw new Error("the UTC-getter mutation changed nothing, so daysUntil no longer uses local getters; update this control");
  const caught = {};
  for (const [zone, jan, jul] of ZONES) withZone(zone, jan, jul, (z) => { caught[zone] = z.ok ? fixedProblems(mutated, { control: true }).length : -1; });
  t(caught.UTC === 0 && caught["America/Los_Angeles"] > 0 && caught["Asia/Tokyo"] > 0,
    "control: a daysUntil that reads UTC getters passes under UTC and is caught in Los Angeles and Tokyo", "failing fixed cases per zone " + J(caught));
});

section("control: css checks", () => {
  const f = goodFacts(GOOD_CSS);
  const all = [].concat(tokenRows(f), literalRows(f, GOOD_DOC, ""), copperRows(f), contrastRows(f), motionRows(f), layoutRows(f, GOOD_DOC));
  const failing = all.filter((r) => !r[0]).map((r) => r[1].slice(0, 60));
  const mutate = (re, rep) => {
    const c = GOOD_CSS.replace(re, rep);
    if (c === GOOD_CSS) throw new Error("css mutation " + re + " changed nothing");
    return goodFacts(c);
  };
  const tickInk = /(\.tick\{[^}]*?)background:var\(--ink\)/;
  const fails = (list) => list.some((r) => !r[0]);
  const cases = [
    ["literal colour", fails(literalRows(goodFacts(GOOD_CSS + "\n.x{color:#DEDEDC}"), GOOD_DOC, ""))],
    ["copper on a tick", fails(copperRows(mutate(tickInk, "$1background:var(--copper)")))],
    ["paper tick", fails(contrastRows(mutate(tickInk, "$1background:var(--paper)")))],
    ["pale muted text", fails(contrastRows(mutate(/--muted:#6B6E6C/, "--muted:#999999")))],
    ["small copper text", fails(contrastRows(mutate(/\.pct\{font-size:32px/, ".pct{font-size:16px")))],
    ["40vw hero", fails(layoutRows(mutate(/34vw/, "40vw"), GOOD_DOC))],
    ["35vw hero at 320", fails(layoutRows(mutate(/34vw/, "35vw"), GOOD_DOC))],
    ["48px side padding", fails(layoutRows(mutate(/padding:48px 24px/, "padding:48px 48px"), GOOD_DOC))],
    ["zero letter-spacing", fails(layoutRows(mutate(/letter-spacing:-\.04em/, "letter-spacing:0"), GOOD_DOC))],
    ["content-box", fails(layoutRows(mutate(/\*\{box-sizing:border-box\}\n/, ""), GOOD_DOC))],
    ["drifted ink token", fails(tokenRows(mutate(/--ink:#111413/, "--ink:#000000")))],
    ["keyframes", fails(motionRows(goodFacts(GOOD_CSS + "\n@keyframes a{from{opacity:0}to{opacity:1}}")))],
  ];
  t(failing.length === 0 && cases.every((c) => c[1]),
    "control: a known-good copy of the stylesheet passes every css check, and each of twelve breakages is flagged",
    (failing.length ? "good copy fails: " + failing.join(", ") + "; " : "") + cases.map((c) => c[0] + " " + (c[1] ? "caught" : "MISSED")).join(", "));
});

section("control: colour literals", () => {
  const lit = ["a{color:#abc}", "a{color:#C2542A}", "a{background:rgb(0,0,0)}", "a{background:rgba(0,0,0,.1)}", "a{color:hsl(0 0% 0%)}",
    "a{color:red}", "a{border:1px solid Transparent}", "a{color:LightGoldenrodYellow}"];
  const miss = lit.filter((s) => colorLiterals(cssFacts(s), { nodes: [] }, "").length === 0);
  const inline = colorLiterals(cssFacts(""), parseHtml('<p style="color:red"></p><meta name="theme-color" content="#FAFAF7">'), "var c = '#fff';").length;
  const clean = colorLiterals(cssFacts(":root{--a:#fff}a{color:var(--ink);margin:0 auto;white-space:nowrap;transform:translateX(-50%)}"), { nodes: [] }, "").length;
  t(miss.length === 0 && inline === 3 && clean === 0,
    "control: the colour literal finder sees hex, rgb, rgba, hsl, named and transparent colours in css, style attributes, meta and script, and ignores :root and var()",
    "missed " + J(miss) + ", inline found " + inline + " of 3, false alarms " + clean);
});

section("control: contrast maths", () => {
  const white = { r: 255, g: 255, b: 255, a: 1 };
  const g = (v) => ({ r: v, g: v, b: v, a: 1 });
  const got = [f2(ratio(g(0), white)), f2(ratio(g(0x76), white)), f2(ratio(g(0x77), white))];
  t(got.join() === "21.00,4.54,4.48" && hexOf(over({ r: 0, g: 0, b: 0, a: 0.5 }, white)) === "#808080",
    "control: contrast maths reads black on white as 21:1, #767676 as 4.54:1, #777777 as 4.48:1, and composites 50% black over white to #808080", got.join(" "));
});

section("control: markup", () => {
  const bad = parseHtml('<div id="a"></div><div id="a"><p></div>');
  t(bad.problems.length > 0 && bad.byId.get("a").length === 2 && japanOnly('<p class="go">Japan.</p>') && !japanOnly('<p class="go">Japan.</p><p>x</p>') &&
    !japanOnly('<div class="num" id="num"></div>') && !japanOnly('<p>Japan</p>'),
    "control: the markup parser reports a duplicate id and a mis-nested element, and the Japan.-only test rejects extra elements and wrong text", bad.problems.join("; "));
});

section("control: text detectors", () => {
  const emojiMiss = EMOJI_SAMPLES.filter((s) => !EMOJI_RE.test(s));
  const plain = "Japan. 171 days until Japan. $4,000 of $4,000 100% # * 0123456789";
  const asciiMiss = ["\u{E9}", "\u{2014}", "\u{FEFF}"].filter((s) => !NON_ASCII_RE.test(s));
  t(emojiMiss.length === 0 && asciiMiss.length === 0 && !EMOJI_RE.test(plain) && !NON_ASCII_RE.test(plain) && !CONTROL_RE.test(plain) &&
    CONTROL_RE.test("a\u{0}b") && firstNonAscii("ab\ncd\u{E9}") === "U+00E9 on line 2",
    "control: the emoji test catches a map of Japan, a flag, a heart with U+FE0F, a keycap, a shrine, a plane, a skin tone, a ZWJ sequence and a tag sequence; the ASCII test catches an accent, a dash and a BOM; plain copy passes",
    "emoji missed " + J(emojiMiss.map((s) => s.codePointAt(0).toString(16))) + ", non-ASCII missed " + asciiMiss.length);
});

// ---- 8. audit of every render: console, uncaught errors, unknown ids, emoji, exclamation marks ----
section("audit", () => {
  const zones = [...new Set(AUDIT.map((a) => a.zone))];
  for (const z of zones) {
    const rs = AUDIT.filter((a) => a.zone === z);
    const bad = [];
    for (const a of rs) {
      for (const c of a.calls) bad.push(a.label + ": console." + c);
      for (const e of a.errors) bad.push(a.label + ": " + e);
      for (const m of a.misses) bad.push(a.label + ": getElementById('" + m + "') returned null");
    }
    t(bad.length === 0, "render audit, " + z + ": " + rs.length + " renders with no console call, no uncaught error and no unknown element id", listBad(bad));
  }
  const uniq = [...new Set([].concat(...AUDIT.map((a) => a.written)))];
  const emoji = uniq.filter((s) => EMOJI_RE.test(s) || NON_ASCII_RE.test(s));
  t(!EMOJI_RE.test(SRC) && emoji.length === 0, "no emoji: no extended pictograph, regional indicator, emoji modifier, U+FE0F, U+20E3 or ZWJ in the source or in any rendered text",
    EMOJI_RE.test(SRC) ? "found in source" : uniq.length + " distinct rendered strings checked");
  const staticText = textOf(PAGE.doc.root);
  const bang = uniq.concat([staticText]).filter((s) => s.includes("!"));
  t(bang.length === 0, "no exclamation mark in visible copy, static or rendered", bang.length ? bang.join(" | ") : "static text and " + uniq.length + " distinct rendered strings");
  const hasTZ = Object.prototype.hasOwnProperty.call(process.env, "TZ");
  t(hasTZ === TZ0.had && process.env.TZ === TZ0.val && new Date(2027, 0, 15, 12).getTimezoneOffset() === TZ0.jan && new Date(2027, 6, 15, 12).getTimezoneOffset() === TZ0.jul,
    "TZ restored after the zone runs", "TZ " + (hasTZ ? process.env.TZ : "unset") + ", January offset " + new Date(2027, 0, 15, 12).getTimezoneOffset());
});

console.log("SUMMARY " + (passed + failed) + " checks, " + passed + " PASS, " + failed + " FAIL");
process.exitCode = failed ? 1 : 0;
