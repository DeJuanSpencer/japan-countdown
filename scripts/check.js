const fs = require("fs");
const path = require("path");

const file = path.join(__dirname, "..", "index.html");
let failed = 0;

function report(ok, name, detail) {
  if (!ok) failed++;
  console.log((ok ? "PASS" : "FAIL") + " " + name + (!ok && detail ? " (" + detail + ")" : ""));
}

if (!fs.existsSync(file)) {
  report(false, "index.html exists");
  process.exit(1);
}
report(true, "index.html exists");

const html = fs.readFileSync(file, "utf8");

report(!/https?:\/\//i.test(html), "no http:// or https:// anywhere");

const hasSrc = /<script[^>]*\ssrc\s*=/i.test(html) || /<script\s+src/i.test(html);
const hasLink = /<link\b[^>]*\bhref\b/i.test(html);
report(!hasSrc && !hasLink, "no <script src> or <link href>");

const head = html.split(/\r?\n/).slice(0, 40).join("\n");
const trip = head.match(/const\s+TRIP_DATE\s*=\s*"([^"]*)"/);
const saved = /const\s+SAVED\s*=\s*[\d.]+/.test(head);
report(!!trip && saved && trip[1] === "2027-03-27", "TRIP_DATE and SAVED in first 40 lines, TRIP_DATE is 2027-03-27");

let daysUntil = null;
let progress = null;
try {
  const m = html.match(/\/\/ BEGIN LOGIC([\s\S]*?)\/\/ END LOGIC/);
  const fns = new Function(m[1] + "\nreturn { daysUntil: daysUntil, progress: progress };")();
  daysUntil = fns.daysUntil;
  progress = fns.progress;
} catch (e) {
  report(false, "day-count logic extracted", e.message);
}

if (daysUntil) {
  const today = new Date(2027, 2, 20);
  const r1 = daysUntil("2027-03-27", today);
  const r2 = daysUntil("2027-03-27", new Date(2027, 2, 27, 15, 30));
  const r3 = daysUntil("2027-03-27", new Date(2027, 2, 28));
  const r4 = daysUntil("2027-03-27", new Date(2026, 9, 2));
  report(r1 === 7, "2027-03-20 -> 7 days", "got " + r1);
  report(r2 === 0, "2027-03-27 -> 0 days", "got " + r2);
  report(r3 <= 0, "2027-03-28 -> <= 0 days", "got " + r3);
  report(r4 === 176, "2026-10-02 -> 176 days", "got " + r4);
}

if (progress) {
  const p = progress(2000);
  report(p.pct === 50 && p.label === "50%" && p.money === "$2,000 of $4,000", "SAVED=2000 -> 50% and $2,000 of $4,000", JSON.stringify(p));
  const pn = progress(NaN);
  report(pn.label === "0%" && pn.money === "$0 of $4,000", "progress(NaN) -> 0% and $0 of $4,000", JSON.stringify(pn));
  report(progress(9999).pct === 100 && progress(-5).pct === 0, "progress clamps to 0-100");
}

// Timezone sweep: the day count must follow the viewer's local calendar date, not the UTC date.
// Each zone is applied at runtime and its January and July offsets are asserted first, so a
// silent fallback to UTC (missing tzdata) fails the zone instead of making the sweep vacuous.
if (daysUntil) {
  const zones = [
    // zone, January offset, July offset, in minutes as Date#getTimezoneOffset reports them
    ["UTC", 0, 0],
    ["America/Los_Angeles", 480, 420],
    ["America/New_York", 300, 240],
    ["Asia/Tokyo", -540, -540],
    ["Pacific/Auckland", -780, -720],
  ];
  const stamps = [
    // day of March 2027, hour, minute, required count, whether a smaller count is also accepted
    [20, 0, 5, 7, false],
    [20, 23, 55, 7, false],
    [27, 0, 5, 0, false],
    [27, 23, 55, 0, false],
    [28, 0, 5, 0, true],
  ];
  const pad = (n) => String(n).padStart(2, "0");
  const hadTZ = Object.prototype.hasOwnProperty.call(process.env, "TZ");
  const origTZ = process.env.TZ;
  try {
    for (const [zone, wantJan, wantJul] of zones) {
      process.env.TZ = zone;
      const gotJan = new Date(2027, 0, 15, 12).getTimezoneOffset();
      const gotJul = new Date(2027, 6, 15, 12).getTimezoneOffset();
      const label = "timezone " + zone + ": offsets " + gotJan + "/" + gotJul;
      if (gotJan !== wantJan || gotJul !== wantJul) {
        report(false, label, "zone not applied, want " + wantJan + "/" + wantJul);
        continue;
      }
      try {
        const got = [];
        const bad = [];
        for (const [day, hh, mm, want, orLess] of stamps) {
          const n = daysUntil("2027-03-27", new Date(2027, 2, day, hh, mm));
          got.push(n);
          if (orLess ? !(n <= want) : n !== want) {
            bad.push("03-" + day + " " + pad(hh) + ":" + pad(mm) + " got " + n + ", want " + (orLess ? "<= " : "") + want);
          }
        }
        report(bad.length === 0, label + ", days " + got.join(" "), bad.join("; "));
      } catch (e) {
        report(false, label, "day-count logic threw: " + e.message);
      }
    }
  } finally {
    if (hadTZ) process.env.TZ = origTZ;
    else delete process.env.TZ;
  }
} else {
  report(false, "timezone sweep ran", "day-count logic was not extracted");
}

process.exit(failed ? 1 : 0);
