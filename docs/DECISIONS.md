# Decisions

date | who | decision | why | reversible
--- | --- | --- | --- | ---
2026-10-02 | lead | Run with Agent-tool subagents instead of an agent team with a shared task list | This session exposes no team or task-list tools, so the TaskCompleted gate cannot fire. The brief has one slice and one file, and the forge skill says to run a sequential job as a normal session | yes
2026-10-02 | lead | Lead runs `node scripts/check.js` by hand after every build step and appends the result to .claude/forge.log | Stands in for the TaskCompleted gate, which needs a shared task list | yes
2026-10-02 | lead | Skip the architect spawn; lead writes docs/PLAN.md from the brief | The brief already fixes the file, constants, ownership and checks; nothing is left to plan | yes
2026-10-02 | lead | check.js and index.html are one build step | The gate fails while index.html is missing, so check.js cannot pass on its own | yes
2026-10-02 | builder-ui | ASSUMED: the dollar figure clamps to $0–$4,000, so over-saving shows "$4,000 of $4,000" | The brief does not say what to do past the target. Clamping keeps the label in step with the bar | yes
2026-10-02 | builder-ui | Added a "Japan fund" heading and 25/50/75% labels under the milestone ticks | Ticks without labels are hard to read on a phone | yes
2026-10-02 | builder-ui | Hero line reads "days until Japan." ("day" when 1 is left) | One declarative line, as the brief asks | yes
2026-10-02 | lead | Re-render on visibilitychange so a tab left open past midnight refreshes the count | QA minor finding; no timers or animation, so it stays within scope | yes
2026-10-02 | builder-ui | Guard the listener with `if (document.addEventListener)` | QA's fake document in acceptance.js has no addEventListener; the guard is a no-op in browsers | yes
2026-10-02 | lead | Overrode reviewer's "NaN handled" claim and took QA's NaN fix | Math.min/max pass NaN through; verified by reading progress() | yes
2026-10-02 | lead | No favicon link (devops's optional suggestion) | A <link href> fails check.js rule 3; the /favicon.ico 404 is cosmetic | yes
