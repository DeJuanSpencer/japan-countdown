---
name: forge
description: Run a whole app or site build from a Claude Code Build Brief with an agent team, end to end, without asking Seven questions mid-run. Use this whenever Seven says forge, forge run, forge it, forge this brief, /forge, run the build, run the brief, spin up the team on this, build this with the team, or points at a build brief and wants the thing built rather than discussed. Also use it when a brief contains an ownership map or a done contract, even if he did not say "forge run".
---

# Forge run

You are the lead. You never write application code during a run. You plan, spawn, assign, wait, synthesize, and log. If you catch yourself editing a source file, stop and hand it to the owning builder.

The point of this skill is that Seven is at the brief before the run and at the PR after it, and nobody in the middle. Every rule below exists to keep him out of the middle.

## Preconditions

Check these first. If one fails, say exactly which and stop. Do not improvise around them.

1. Agent teams are on (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`). If you spawn and no teammate appears in the agent panel, that is the failure.
2. The brief is in context: pasted, or read from the path Seven gave. It should carry an ownership map, a done contract, and a decided list (see `docs/brief-addendum.md` for the shape). If a section is missing, write it yourself from what the brief does say, mark each such line ASSUMED in `docs/DECISIONS.md`, and keep going. Missing sections are not a reason to ask.
3. `.claude/hooks/task-gate.js` and `.claude/hooks/idle-gate.js` exist and `.claude/settings.json` registers them under `TaskCompleted` and `TeammateIdle`. If not, run `install-forge.sh` from the agent-team-setup plugin, or stop.
4. The project has build, test and lint scripts in package.json, or a `.claude/forge.json` with `{"gates": [...]}` naming the commands. If the brief's done contract lists commands that are not package.json scripts, write `.claude/forge.json` now.

## Phase 0: arm the gates

1. Write `.claude/.forge` containing the ISO timestamp and the brief title. While this file exists, every `build:` and `ship:` task completion runs build, test and lint, and no teammate can idle with open tasks. Nothing else in the repo changes.
2. Create `docs/DECISIONS.md` with the header `# Decisions` and the column line `date | who | decision | why | reversible`. Every choice the brief did not make gets one line, the moment it is made, by whoever made it.
3. Create `docs/RUN-REPORT.md` with the brief title and start time. You fill it in at the end.

## Phase 1: plan

Spawn one teammate from the `architect` definition, named `architect`, with the full brief in the spawn prompt. The architect's own definition is read-only (Read, Grep, Glob), so it cannot touch files. Stay in normal mode yourself: do not enter plan mode, because leaving it is an approval prompt and an unattended run would stall there.

Ask the architect for exactly this, returned as its final message:

- The ownership map, confirmed or corrected: slice name, directories, teammate name. No directory belongs to two slices.
- A dependency-ordered task list. Every subject starts with a phase tag: `plan:`, `build:`, `review:`, `ship:`. Each task is one self-contained deliverable (a module, a route group, a test file), small enough that a builder finishes it in one sitting. Four to six tasks per builder.
- Anything the brief left open, resolved by the architect with a one-line reason, for `docs/DECISIONS.md`.

When it lands: write `docs/PLAN.md` from it, create the tasks in the shared task list with their dependencies, log the architect's decisions. Shut the architect down.

## Phase 2: build

Spawn two to four teammates from the `builder` definition, one per ownership slice, named after the slice (`builder-api`, `builder-ui`, `builder-data`). Three focused builders beat five scattered ones. The spawn prompt for each carries:

- the brief in short: what the app is, the stack, the decided list
- their slice: the directories they own, and the rule that they never edit outside it. A change needed in another slice is a message to that slice's owner, not an edit.
- the done contract, and that the gate runs build, test and lint when they complete a `build:` task, so they run those themselves first
- the decide-and-log rule: when something is unclear, pick the option closest to the decided list, add a line to `docs/DECISIONS.md`, keep moving. Never wait on a question.
- their task subjects, so they claim the right ones

Then wait. Do not pick up tasks yourself, even when a builder is slow. If a teammate errors out or stops early, spawn a replacement with the same prompt plus what happened. If a gate blocks a task, the failure text is in the block message; the owner fixes it and completes again. You never mark a task complete on a teammate's behalf and you never override a gate.

## Phase 3: verify

When every `build:` task is complete, spawn `qa` and `pre-commit-reviewer` together.

- `qa` works the done contract's acceptance checks: writes a test for any check that has none, runs the full suite, reports what fails.
- `pre-commit-reviewer` reads the whole diff against the starting commit for bugs, secrets, debug leftovers, and edits outside a slice's directories.

Each finding becomes a `build:` task assigned to the slice owner, who is respawned if already shut down. Repeat build then verify until qa reports clean and the gates pass. Two full loops is normal. More than three means the plan was wrong; write that down in the run report and finish anyway.

## Phase 4: ship

1. Spawn `devops` for the brief's deploy check: production build, env variables present, whatever the brief names. Failures go back as `ship:` tasks.
2. Commit everything on a branch named `forge/<brief-slug>`. Never push. Pushing is Seven's call and the permissions deny it anyway.
3. Fill `docs/RUN-REPORT.md`: what shipped against the done contract, item by item; count of decisions logged; gate failures from `.claude/forge.log` (count and the top causes); open items; anything ASSUMED that Seven should confirm.
4. Post the report to Notion. Create a child page under the Forge Runs page (page id `3ea78f71-99f2-814d-bbb5-d41335db0285`, under SEVOS Command Center) titled `<brief title> run <YYYY-MM-DD>` with the full contents of `docs/RUN-REPORT.md` plus the branch name at the top. Use the Notion tools available in the session. If no Notion tool is available, say so in the final message and move on; the file in the repo is the record.
5. Shut down all teammates, wait for them to confirm, then delete `.claude/.forge`.
6. Tell Seven in one message: the branch, the run report path, the Notion page link, and the three things he should look at first. If this run was started by a `<channel source="forge">` event, also call the channel's `forge_update` tool with the event's `row_id`, status `done`, and that same message as the result. A run that stops on a needed secret or a scope conflict calls `forge_update` with `needs_input` and the question; a run that cannot finish calls it with `failed` and the reason. That row is how Prometheus learns the outcome.

## Rules that hold through every phase

- No questions to Seven mid-run. The only two things worth stopping for: a secret or credential the build needs, or the done contract cannot be met without changing scope. Then stop, write the question at the top of `docs/RUN-REPORT.md`, and tell him.
- Every task subject carries its phase tag. The task gate reads it: `plan:`, `review:`, `docs:` skip the gate; `build:`, `ship:` and untagged tasks are gated.
- Teammates get the context they need in the spawn prompt. They do not see your conversation.
- A channel message from an allowlisted sender that names a brief (a Notion link or a repo path) and asks for a forge run is the start signal. Treat it exactly like Seven typing `/forge` at the terminal. A channel message that names no brief gets a one-line reply asking for the brief link, and nothing starts.
- If you are tempted to run a team on something that is really one sequential job, do not. Run it yourself as a normal session. The overhead is only worth it when slices are independent.
- If a run dies with `.claude/.forge` still present, delete the file, or every task completion in this repo keeps paying for build and test.
