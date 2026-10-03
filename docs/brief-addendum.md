# Build brief addendum

Add these four sections to the end of a Claude Code Build Brief before handing it to `/forge`. The existing brief format stays as it is. These sections are what let the team run without asking anything.

## Ownership map

| Slice | Directories | Teammate |
| --- | --- | --- |
| data | prisma/**, src/lib/db/** | builder-data |
| api | src/app/api/**, src/server/** | builder-api |
| ui | src/app/(site)/**, src/components/** | builder-ui |

Rules: no directory appears in two rows. Shared files (package.json, config, env example) belong to the lead. A change a builder needs in another slice is a message to that slice's owner, never an edit. Two teammates editing one file overwrite each other.

## Done contract

Machine checks, run by the gate every time a build or ship task is completed:

- `npm run build`
- `npm run test`
- `npm run lint`

(If the project's commands differ, list them here and the lead writes them into `.claude/forge.json` as `{"gates": ["...", "..."]}`.)

Acceptance checks, one test each, written by qa where missing:

1. A visitor can [first thing a user does] and sees [what proves it worked].
2. [Second observable outcome.]
3. [Third observable outcome.]

Deploy check, run by devops:

- Production build succeeds with the env variables listed in `.env.example` and nothing else.
- [Anything hosting-specific: static export, edge runtime, serverless size limit.]

## Decided (do not reopen)

- Stack: [framework, language, package manager]
- Hosting: [where it runs]
- Data: [database, ORM, schema location]
- Auth: [approach, or "none in v1"]
- Design tokens: [fonts, colors, spacing, or "use designer defaults"]
- Out of scope for this run: [list]

## Decide-and-log rule

Anything not covered above: pick the option closest to the decided list, write one line in `docs/DECISIONS.md` (date, who, decision, why, reversible yes/no), and keep going. Do not ask. The only two reasons to stop the run: a secret or credential the build needs, or the done contract cannot be met without changing scope.

## Stale defaults to overwrite at install

The roster ships with placeholder tokens and hosting context. Set them for this project before the first run so nobody reasons from the wrong defaults:

- `.claude/agents/designer.md` and `.claude/agents/design-system-enforcer.md`: replace the default fonts and palette with the design tokens above.
- `.claude/agents/devops.md`: replace the Vercel and Next.js context with this project's hosting.
