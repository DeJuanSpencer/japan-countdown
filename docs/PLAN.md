# Plan: Japan Countdown v1.0, run 2 (2026-10-07, Hetzner bench)

Spec: the brief. Start state: run 1's tree at `42e7b72`. Branch: `forge/japan-countdown-run2`. Planned by `architect` (read-only), tasks run by `builder-ui`, verified by `qa` and `pre-commit-reviewer`, shipped by `devops`. The gate (`node scripts/check.js`) runs at every `build:` and `ship:` completion.

## Ownership map

| Slice | Paths | Teammate |
| --- | --- | --- |
| page | `index.html`, `scripts/check.js`, any new file under `scripts/` | builder-ui |
| acceptance | `scripts/acceptance.js` | qa |
| shared | `docs/`, `.claude/`, `.gitignore`, `CLAUDE-AGENT-TEAMS.md` | lead (anyone may append one line to `docs/DECISIONS.md`) |

The brief gives all of `scripts/` to the page slice; `acceptance.js` is carved out because qa writes the acceptance tests and two writers in one file overwrite each other.

## Order and dependencies

Tasks 1, 2, 3 are independent and run in that order. 4 needs 3. 5 needs 3 and 4. 6 needs 1 to 5. 7 needs 6 (so the diff includes qa's edits). 8 needs 6 and 7 closed with no open `build:` task. Every task leaves `node scripts/check.js` passing.

## Interfaces the page must keep (the gate and the tests parse them)

- `TRIP_DATE` and `SAVED` inside the first 40 lines, in the first `<script>`, above the `<style>` block; `const SAVED = <number>;` on one line with single spaces.
- The `// BEGIN LOGIC` and `// END LOGIC` markers, the functions `daysUntil(tripDateStr, today)` and `progress(saved)`, and the result keys `pct`, `label`, `money`.
- Plain `<script>` and `<style>` tags, the viewport meta, the ids `hero`, `num`, `line`, `bar`, `fill`, `pct`, `money`.
- Compact CSS declarations; a test matches `max-width:480px` literally.
- Nothing new that matches `http://`, `https://`, `url(`, `@import`, `@font-face`, `<link`, `src=`, `href=`.

## Tasks

### 1. `build: check.js proves the day count follows the viewer's local date`
Owner builder-ui. File `scripts/check.js` only. Runs first so the stronger gate covers tasks 2 to 5.
- Verify: a PASS line exists for each contract item (file exists; no http/https; no script src or link href; both constants in the first 40 lines with the date pinned; 7 days from 2027-03-20; non-zero exit on any failure).
- Change (additive only): probe `node -e "process.env.TZ='Asia/Tokyo'; console.log(new Date(2027,0,15,12).getTimezoneOffset())"`, which must print -540. Then for UTC, America/Los_Angeles, America/New_York, Asia/Tokyo and Pacific/Auckland, set `process.env.TZ` at runtime; per zone assert the January and July offsets (UTC 0/0; LA 480/420; NY 300/240; Tokyo -540/-540; Auckland -780/-720) or FAIL naming the zone, so a silent fallback to UTC cannot make the sweep vacuous. Then require 7 at 00:05 and 23:55 local on 2027-03-20, 0 at both times on 2027-03-27, and 0 or less at 00:05 on 2027-03-28. One PASS or FAIL line per zone. If the probe fails for a zone, drop that zone and tell the lead; keep at least one zone east and one west of UTC.
- Evidence: exit 0 against the unchanged `index.html`; then a mutation test in a scratch directory outside the repo (same `scripts/` layout, a copy of `index.html` whose `daysUntil` uses UTC getters) exits non-zero naming Tokyo or Los Angeles. Nothing mutated is committed.

### 2. `build: verify hero, trip-day state and progress readout against the brief`
Owner builder-ui. File `index.html`, only if a line fails. An empty diff is a valid completion.
- Verify: constants marked and defined near the top; hero number is whole local days from `daysUntil` with one line beneath it, singular at one day; no emoji, no non-ASCII character, no exclamation mark in visible copy; at 0 days or fewer the hero shows only a `Japan.` paragraph with no number element and no timer in the script; `progress(2000)` gives 50% and "$2,000 of $4,000"; 0, 1234, 5000 and NaN behave as decided (clamp, thousands separator, NaN reads as 0).
- Evidence: both scripts exit 0; a verdict per bullet; `git diff --stat` empty or naming the lines changed.

### 3. `build: define the dejuanspencer.com tokens once and use only them`
Owner builder-ui. File: the `<style>` block of `index.html`.
- Gap: the four brief colors are correct but scattered as literals; the font stack is not the site's; no mono family; no hairline token; `#E7E6E0` on the bar track is not a token.
- Change: `:root` becomes the first rule with exactly `--paper:#FAFAF7; --ink:#111413; --copper:#C2542A; --muted:#6B6E6C; --hairline:rgba(17,20,19,0.12); --font-sans:'Inter Tight',ui-sans-serif,system-ui,sans-serif; --font-mono:'JetBrains Mono',ui-monospace,Menlo,Consolas,monospace`. A comment beside copper: 4.37:1 on paper, so large text and non-text only; never the sibling site's `#BD5228`. Replace every color literal in the style block with `var()`: body background paper, text ink; `.num`, `.line` ink; `.fund h2`, `.ticks`, `.money` muted; `.pct`, `.fill` copper; `.bar` hairline; `.tick` stays paper until task 4. `body` takes `--font-sans`; `.fund h2`, `.ticks`, `.money` take `--font-mono`. No `@font-face`, `url()`, `@import` or `<link>`; a family name in a stack loads nothing. Do not read tokens from `.claude/agents/*.md` (stale values).
- Evidence: both scripts exit 0; hex and rgba literals appear only inside `:root`; copper only on `.fill` and `.pct`; the diff touches only the style block.

### 4. `build: make the milestone ticks visible at every fill level`
Owner builder-ui. File: the `<style>` block. Depends on 3.
- Gap: paper ticks on a near-paper track (1.29:1) cannot be seen at the shipped SAVED of 0.
- Change: `.tick` background becomes `var(--ink)` with `margin-left:-1px` so the 2px line centres on its percentage. Keep width, offsets and label spans. No new element, image or animation.
- Evidence: both scripts exit 0; ink on track 13.8:1 and ink on copper 4.06:1 stated in the report; acceptance.js SAVED=2000 fill width still 50%.

### 5. `build: verify the 390px layout and fix the phone viewport height`
Owner builder-ui. File: the `<style>` block. Depends on 3 and 4.
- Verify: at 390 and 320 wide, compute from the final CSS the widest hero number at four digits, the `Japan.` line, the stats row and the 25% and 75% tick labels against the content width (viewport minus 48). Nothing may rely on `overflow-x:hidden`.
- Change: add `min-height:100dvh` on `body` right after the existing `100vh` declaration. If an element does not fit, lower the vw coefficient in its clamp until it does. No fixed width above 390px, no wider-screen media query.
- Evidence: both scripts exit 0 (including acceptance.js fixed-width and font-size lines); a width table in the report; a one-line diff unless a coefficient changed.

### 6. `review: qa runs the acceptance checks and closes the evidence gaps`
Owner qa. File `scripts/acceptance.js` only. Depends on 1 to 5. Run check.js and acceptance.js; make acceptance.js run its date cases under the five zones from task 1 inside one invocation. Close, in order: (1) replace the always-true hero-width line with arithmetic parsed from the page's CSS at 390 and 320 for three and four digits and for `Japan.`; (2) make the fake `getElementById` throw on an unknown id and assert each requested id appears once in the static markup; (3) record console calls and uncaught errors in every render case and assert none (2 and 3 stand in for the devtools console check); (4) token tests: parse `:root`, assert the four brief hexes, the hairline and both font stacks, no color literal outside `:root`, contrast computed from the parsed values (hairline over paper as the track; ink on track; ink on fill; copper only on `.fill` and `.pct`); (5) emoji test with property escapes for extended pictographs and regional indicators plus U+FE0F and U+20E3; (6) network scan extended to `new Image`, `Worker`, `serviceWorker`, `@font-face`, `image-set`, `base`, meta refresh, the img, iframe, audio, video, source, object, embed and form tags, and assignments to `src`, `href` or `location`; (7) timer scan: no `setInterval`, `setTimeout`, `requestAnimationFrame`; (8) drop the temp-file round trip in `withSaved`. Report SHIP IT or FIX FIRST; each finding becomes a `build:` task for builder-ui. State which checks stand in for the manual devtools check and that a real phone check stays open for Seven.

### 7. `review: pre-commit-reviewer reads the diff against 42e7b72`
Owner pre-commit-reviewer, read-only. Depends on 6. Changed files are only `index.html`, `scripts/check.js`, `scripts/acceptance.js` and lead-owned docs. check.js changes only add checks. No console, debugger, TODO or FIXME in index.html. No http, `url(`, `@import`, `@font-face`, `<link`, `src=`, `href=` added. Hex literals only in `:root`. Both constants within the first 40 lines. No stray untracked files. Report COMMIT or FIX FIRST.

### 8. `ship: devops confirms the page serves with no page requests and the gate passes`
Owner devops. Depends on 6 and 7. Run `node scripts/check.js` (expect 0). Serve the project with `python3 -m http.server --bind 127.0.0.1` (a Node server on 127.0.0.1 if python3 is refused; log the substitution); fetch the page and expect 200, a text/html type, a body hash equal to the file, and exactly one request line in the server log; stop the server and confirm the port is closed. file:// stand-in: acceptance.js exit 0 plus a scan for constructs that break under file:// (module scripts, fetch, root-absolute paths); say plainly that no browser rendered the page. Do not run `npm run build` (no package.json). Report DEPLOY or HOLD; failures return as `ship:` tasks.

## Figures to reproduce (architect's hand arithmetic; digit advance 0.66em less 0.04em letter-spacing)

| Pair or element | Figure | Used by |
| --- | --- | --- |
| Copper on paper | 4.37:1 | task 3 comment, qa token test |
| Muted on paper | 4.93:1 | small labels pass |
| Paper tick on current track #E7E6E0 | 1.20:1 | why ticks vanish at SAVED 0 |
| Paper tick on hairline track | 1.29:1 | same, after task 3 |
| Hairline over paper (effective track) | about #DEDEDC | qa contrast math |
| Ink tick on hairline track | 13.8:1 | task 4 |
| Ink tick on copper fill | 4.06:1 | task 4 |
| Copper fill on hairline track | 3.39:1 | clears 3:1 for non-text |
| Hero number, four digits, 390 wide | 329 px of 342 px | task 5 |
| Hero number, four digits, 320 wide | 270 px of 272 px | task 5, tight |
| Japan. line, 390 and 320 wide | about 290 of 342 and 240 of 272 | task 5 |

## Risks (architect)
- Teammate definitions fit another project: qa has no Write tool (it writes through Bash), devops assumes Vercel and `npm run build`. Spawn prompts override both.
- No browser exists on this VPS, so layout and console claims rest on hand arithmetic and a Node VM. A phone check stays with Seven.
- The architect flagged `.claude/.forge` as missing; it is present at the bench root (the hook's `CLAUDE_PROJECT_DIR`), which the architect was told not to read. The lead's dry run through the real hook passed before planning started.
