# Plan: Japan Countdown v1.0

Ownership: one slice, `page`, owned by builder-ui. It covers `index.html` and `scripts/`. Shared files (`.claude/forge.json`, `docs/`) belong to the lead.

Tasks, in dependency order:
1. build: scripts/check.js plus index.html (builder-ui). check.js covers: file exists; no http:// or https://; no `<script src` or `<link href`; TRIP_DATE and SAVED near the top; day-count logic gives 7 for today = 2027-03-20.
2. review: qa runs the acceptance checks (day count, SAVED=2000 gives 50% and "$2,000 of $4,000", 390px layout, trip-day state) and adds test scripts where checks are missing. pre-commit-reviewer reads the diff.
3. build: fixes from step 2 (builder-ui).
4. ship: devops opens the page from file:// and from a static server, confirms zero network requests, and runs check.js.
