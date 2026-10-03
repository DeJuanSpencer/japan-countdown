# Agent Teams

This project uses custom subagent definitions in `.claude/agents/` as the roster for agent team assembly. When a task calls for parallel work, assemble a team from the configurations below. Reference subagent types by name when spawning teammates.

## Team Configurations

### Build Team
**When to use:** Building a new feature end to end, from design through implementation to ship-ready.
**Teammates (4-5):**
- `architect` — Plans file structure, component boundaries, data flow, and API design before code is written. Produces a spec the builder follows. Require plan approval before implementation begins.
- `designer` — Owns UI/UX decisions: layout, interactions, responsive behavior, accessibility. References the project design system (DM Sans, JetBrains Mono, gold/red/violet palette, 8px spacing scale). Coordinates with architect on component structure.
- `builder` — Writes the actual code. Follows the architect's spec and designer's UI decisions. Owns implementation files. Does not modify files owned by other teammates.
- `qa` — Validates the feature works before shipping. Tests happy path, edge cases, error handling, responsive behavior, and accessibility. Runs after builder completes. Reports SHIP IT, FIX FIRST, or BLOCKED.
- `conversion-copy-writer` (optional) — Reviews all user-facing text in the feature for clarity, conversion, and tone consistency. Joins when the feature has a user-facing surface (gate screens, onboarding, CTAs).

**Task flow:** Architect plans → Designer specs UI → Builder implements → Copy reviews text → QA validates → Ship or fix.

**File ownership:** Architect owns spec/planning docs. Designer owns style decisions. Builder owns implementation files. QA and Copy are read-only reviewers. No two teammates edit the same file.

---

### Research Team
**When to use:** Evaluating product direction, exploring a new space before building, or deciding what to build next.
**Teammates (3):**
- `trend-radar` — Researches what's shipping in the industry, emerging patterns, and what's noise. Returns findings categorized as ADOPT, WATCH, or IGNORE.
- `feature-gap-analyzer` — Reads the current codebase and surfaces missing features ranked by impact-to-effort ratio. Filters by what's buildable with the current stack.
- `strategist` — Synthesizes findings from trend-radar and feature-gap-analyzer. Applies the prioritization filter: Does it compound? Does it demonstrate? Does it close a gap? Two of three means worth doing. All three means urgent. Produces a ranked recommendation.

**Task flow:** Trend-radar and feature-gap-analyzer research in parallel → Share findings with each other → Strategist synthesizes and ranks → Final recommendation to user.

**Rules:** No code is written during a research team session. Output is a decision document, not implementation. If the user approves a recommendation, spin down the research team and spin up a build team.

---

### Ship Team
**When to use:** Auditing, polishing, and preparing existing work for deployment. Use before any production push.
**Teammates (3-5):**
- `pre-commit-reviewer` — Reviews the git diff for security issues, debug artifacts, code quality, and logic problems. Returns COMMIT, FIX FIRST, or DO NOT COMMIT.
- `qa` — Walks through user flows, tests edge cases, validates error handling. Returns SHIP IT, FIX FIRST, or BLOCKED.
- `responsive-stress-tester` — Reads components and flags layout issues across breakpoints. Returns SHIP IT, FIX FIRST, or BROKEN.
- `stack-evolution-advisor` (optional) — Checks dependencies for deprecations, CVEs, and version gaps. Joins when the push includes dependency changes or it's been 30+ days since last audit.
- `devops` (optional) — Validates build output, environment variables, route configs, and bundle size before deploying. Joins for production pushes.

**Task flow:** All teammates audit in parallel → Share findings with each other → Synthesize into a single ship/no-ship decision with a prioritized fix list if needed.

**Rules:** No new features are built during a ship team session. This team only reviews, audits, and validates. If fixes are needed, either fix inline (if small) or spin down and spin up a build team for larger changes.

---

## General Rules for All Teams

- **Team size:** 3-5 teammates per team. More than 5 adds coordination overhead without proportional value.
- **File conflicts:** No two teammates edit the same file. Break work by file ownership before starting.
- **Token awareness:** Each teammate is a full Claude session. Use Haiku for read-only reviewers (pre-commit-reviewer, responsive-stress-tester, design-system-enforcer). Use Sonnet for teammates that need reasoning (architect, strategist, qa, builder).
- **Direct access:** The user can message any teammate directly at any time. Do not gate communication through the lead.
- **Cleanup:** Always clean up the team when the task is complete. Shut down teammates before running cleanup.
- **No nesting:** Teammates cannot spawn their own teams. Only the lead manages the team.
- **Handoff protocol:** When transitioning from Research Team to Build Team (or any team to another), the lead writes a handoff summary documenting decisions made, rationale, and constraints discovered. The next team's lead reads this before spawning teammates.

## Available Subagent Roster

These subagent definitions live in `.claude/agents/` and can be referenced by name when spawning teammates:

| Agent | Model | Purpose |
|---|---|---|
| `architect` | sonnet | Plans file structure, component boundaries, data flow, API design |
| `designer` | sonnet | UI/UX decisions, layout, interactions, responsive behavior |
| `builder` | sonnet | Writes implementation code from architect/designer specs |
| `strategist` | sonnet | Prioritizes what to build, synthesizes research, ranks options |
| `devops` | sonnet | Deploy validation, build debugging, performance, config management |
| `pre-commit-reviewer` | haiku | Reviews git diff for bugs, secrets, debug artifacts |
| `qa` | sonnet | Tests flows, edge cases, error handling, accessibility |
| `conversion-copy-writer` | sonnet | Reviews and rewrites user-facing text for conversion |
| `responsive-stress-tester` | haiku | Flags layout issues across breakpoints |
| `design-system-enforcer` | haiku | Checks components against brand tokens |
| `trend-radar` | sonnet | Researches industry trends and emerging patterns |
| `feature-gap-analyzer` | sonnet | Surfaces missing features ranked by impact |
| `onboarding-flow-designer` | sonnet | Designs user onboarding sequences |
| `stack-evolution-advisor` | sonnet | Audits dependencies and architecture health |
| `ux-friction-auditor` | sonnet | Identifies drop-off points in user flows |
| `micro-interaction-suggester` | haiku | Suggests animations and feedback patterns |
| `ui-pattern-scout` | sonnet | Finds reusable patterns and industry best practices |
