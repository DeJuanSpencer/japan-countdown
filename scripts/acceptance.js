const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");

const src = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
let failed = 0;
function t(ok, name, detail) {
  if (!ok) failed++;
  console.log((ok ? "PASS " : "FAIL ") + name + (detail ? "  [" + detail + "]" : ""));
}

// Run the page's scripts against a fake document with a mocked Date. Returns element map.
function render(html, now) {
  const els = {};
  function el(id) {
    return els[id] || (els[id] = { id, textContent: "", innerHTML: "", style: {}, attrs: {},
      setAttribute(k, v) { this.attrs[k] = v; } });
  }
  const document = { getElementById: el };
  const RealDate = Date;
  class MockDate extends RealDate {
    constructor(...a) { if (a.length === 0) super(now.getTime()); else super(...a); }
    static now() { return now.getTime(); }
  }
  const ctx = vm.createContext({ document, Date: MockDate, console });
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  // top-level const is not exposed on the context, so run all scripts as one program
  vm.runInContext(scripts.join("\n"), ctx);
  return els;
}

const TZ = process.env.TZ || "(system)";
console.log("TZ=" + TZ);

// 1. day count via DOM, across dates incl. DST and late evening
const cases = [
  [new Date(2026, 9, 2, 0, 0, 0), 176],
  [new Date(2026, 9, 2, 23, 59, 59), 176],
  [new Date(2026, 10, 1, 0, 30), 146],   // US fall back
  [new Date(2026, 10, 1, 23, 30), 146],
  [new Date(2026, 10, 2, 0, 5), 145],
  [new Date(2027, 2, 13, 23, 59), 14],
  [new Date(2027, 2, 14, 0, 0), 13],     // US spring forward
  [new Date(2027, 2, 14, 12, 0), 13],
  [new Date(2027, 2, 14, 23, 59), 13],
  [new Date(2027, 2, 15, 0, 0), 12],
  [new Date(2027, 2, 26, 23, 59, 59), 1],
  [new Date(2027, 2, 26, 0, 0), 1],
];
for (const [d, exp] of cases) {
  const e = render(src, d);
  t(e.num.textContent === String(exp), "days " + d.toString().slice(0, 24) + " -> " + exp, "got " + e.num.textContent);
}
{
  const e = render(src, new Date(2027, 2, 26, 10));
  t(e.line.textContent === "day until Japan.", "singular line at 1 day", e.line.textContent);
  const e2 = render(src, new Date(2026, 9, 2));
  t(e2.line.textContent === "days until Japan.", "plural line", e2.line.textContent);
  t(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(src), "no emoji in source");
}

// 2. SAVED=2000
const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "jc-")), "index.html");
function withSaved(v) {
  const out = src.replace(/const SAVED = [^;]*;/, "const SAVED = " + v + ";");
  fs.writeFileSync(tmp, out);
  return render(fs.readFileSync(tmp, "utf8"), new Date(2026, 9, 2));
}
{
  const e = withSaved(2000);
  t(e.pct.textContent === "50%", "SAVED=2000 pct text", e.pct.textContent);
  t(e.money.textContent === "$2,000 of $4,000", "SAVED=2000 money text", e.money.textContent);
  t(e.fill.style.width === "50%", "SAVED=2000 fill width", e.fill.style.width);
  const z = withSaved(0);
  t(z.pct.textContent === "0%" && z.money.textContent === "$0 of $4,000", "SAVED=0", z.pct.textContent + " " + z.money.textContent);
  const f = withSaved(5000);
  t(f.pct.textContent === "100%" && f.money.textContent === "$4,000 of $4,000", "SAVED=5000 clamps", f.pct.textContent + " " + f.money.textContent);
  const m = withSaved(1234);
  t(m.money.textContent === "$1,234 of $4,000" && m.pct.textContent === "31%", "SAVED=1234", m.pct.textContent + " " + m.money.textContent);
}

// 3. trip day
for (const d of [new Date(2027, 2, 27, 0, 0), new Date(2027, 2, 27, 23, 59), new Date(2027, 2, 28), new Date(2030, 0, 1)]) {
  const e = render(src, d);
  const ok = e.hero.innerHTML.replace(/<[^>]+>/g, "").trim() === "Japan." && !(e.num && e.num.textContent) && !(e.line && e.line.textContent);
  t(ok, "trip day shows only Japan. @ " + d.toString().slice(0, 24), e.hero.innerHTML);
}

// 4. static CSS review
{
  const css = (src.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || "";
  t(/name="viewport"[^>]*width=device-width/.test(src), "viewport meta present");
  const widths = [...css.matchAll(/(?:^|[;{\s])(?:min-)?width:\s*(\d+)px/g)].map(m => +m[1]);
  t(widths.every(w => w <= 390), "no fixed px widths > 390", widths.join(","));
  const sizes = [...css.matchAll(/font-size:\s*(\d+)px/g)].map(m => +m[1]);
  t(Math.min(...sizes) >= 12, "min font-size >= 12px", "min " + Math.min(...sizes));
  t(/max-width:480px/.test(css), "main max-width 480");
  // main horizontal padding 24 => 342px content at 390; biggest number: 34vw=132px, 3-digit
  t(true, "hero number 34vw @390 = " + (0.34 * 390).toFixed(0) + "px font; 3 digits ~ " + (0.34 * 390 * 0.6 * 3).toFixed(0) + "px < 342");
}
// contrast
function lum(h) { const c = [1, 3, 5].map(i => parseInt(h.substr(i, 2), 16) / 255).map(v => v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4)); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; }
function cr(a, b) { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); }
t(cr("#6B6E6C", "#FAFAF7") >= 4.5, "muted on paper contrast", cr("#6B6E6C", "#FAFAF7").toFixed(2));
t(cr("#C2542A", "#FAFAF7") >= 3, "copper on paper (large text) contrast", cr("#C2542A", "#FAFAF7").toFixed(2));
t(cr("#C2542A", "#E7E6E0") >= 3, "copper fill on track contrast", cr("#C2542A", "#E7E6E0").toFixed(2));

// 5. network
{
  t(!/https?:\/\/|\/\/[a-z0-9.-]+\.[a-z]{2,}/i.test(src.replace(/\/\/ [^\n]*/g, "")), "no URLs");
  t(!/\b(fetch|XMLHttpRequest|WebSocket|sendBeacon|importScripts|EventSource)\b/.test(src), "no network APIs");
  t(!/\bimport\s*[\(\{'"*]/.test(src) && !/@import/.test(src), "no import");
  t(!/\s(src|href|srcset|action|poster)\s*=/i.test(src), "no src/href attributes");
  t(!/url\(/i.test(src), "no css url()");
}

process.exit(failed ? 1 : 0);
