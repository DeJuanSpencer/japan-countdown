#!/usr/bin/env node
'use strict';
/*
 * idle-gate.js  (Claude Code hook: TeammateIdle)
 *
 * Runs when a teammate is about to go idle. Exit 2 keeps it working and hands stderr back
 * as feedback. Exit 0 lets it idle. Exit 1 does NOT block.
 *
 * Only active while .claude/.forge exists. Outside a forge run: exit 0 immediately.
 *
 * Logic: read the shared task list at <config dir>/tasks/<team_name>/*.json and look for
 * tasks this teammate owns that are neither completed nor blocked on another task.
 * If any exist, push the teammate back with the list. At most PUSHBACK_CAP pushbacks per
 * teammate per run, so a teammate that is stuck cannot be trapped; after the cap it is
 * allowed to idle and the log says so, which the lead reads.
 *
 * The task JSON field names are read defensively (status/state, owner/assignee/...). If the
 * schema is not recognisable the gate passes and logs the keys it saw, never blocks blindly.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const claudeDir = path.join(projectDir, '.claude');
const marker = path.join(claudeDir, '.forge');
const stateDir = path.join(claudeDir, '.forge-state');
const logFile = path.join(claudeDir, 'forge.log');
const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const PUSHBACK_CAP = 3;

const STATUS_KEYS = ['status', 'state'];
const OWNER_KEYS = ['owner', 'assignee', 'assigned_to', 'assignedTo', 'claimed_by', 'claimedBy', 'ownerName'];
const SUBJECT_KEYS = ['subject', 'title', 'name', 'description'];
const DEP_KEYS = ['blockedBy', 'blocked_by', 'dependsOn', 'depends_on', 'dependencies'];
const DONE_STATES = ['completed', 'complete', 'done', 'cancelled', 'canceled', 'closed'];

function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch (_) { return ''; }
}
function log(line) {
  try {
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.appendFileSync(logFile, `${new Date().toISOString()} idle-gate ${line}\n`);
  } catch (_) { /* never break the gate over logging */ }
}
function pick(obj, keys) {
  for (const k of keys) if (obj && obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
  return undefined;
}
function norm(v) { return String(v === undefined ? '' : v).trim().toLowerCase(); }

if (!fs.existsSync(marker)) process.exit(0);

let input = {};
try { input = JSON.parse(readStdin() || '{}'); } catch (_) { input = {}; }
const me = input.teammate_name;
const team = input.team_name;

if (!me || !team) {
  log(`pass (no teammate_name/team_name in hook input; keys=${Object.keys(input).join(',')})`);
  process.exit(0);
}

const tasksDir = path.join(configDir, 'tasks', team);
if (!fs.existsSync(tasksDir)) {
  log(`pass ${me} (no task dir at ${tasksDir})`);
  process.exit(0);
}

const tasks = [];
for (const f of fs.readdirSync(tasksDir)) {
  if (!f.endsWith('.json')) continue;
  try { tasks.push(JSON.parse(fs.readFileSync(path.join(tasksDir, f), 'utf8'))); } catch (_) { /* skip unreadable */ }
}
if (tasks.length === 0) { log(`pass ${me} (no tasks)`); process.exit(0); }

const recognisable = tasks.some((t) => pick(t, STATUS_KEYS) !== undefined);
if (!recognisable) {
  log(`pass ${me} (task schema not recognised; keys=${Object.keys(tasks[0]).join(',')})`);
  process.exit(0);
}

const open = tasks.filter((t) => {
  const status = norm(pick(t, STATUS_KEYS));
  if (DONE_STATES.includes(status)) return false;
  const owner = norm(pick(t, OWNER_KEYS));
  if (owner !== norm(me)) return false;
  const deps = pick(t, DEP_KEYS);
  if (Array.isArray(deps) && deps.length > 0) return false; // blocked on someone else, let it idle
  return true;
});

if (open.length === 0) { log(`pass ${me} (no open owned tasks)`); process.exit(0); }

fs.mkdirSync(stateDir, { recursive: true });
const countFile = path.join(stateDir, `idle-${me.replace(/[^\w.-]/g, '_')}.count`);
let count = 0;
try { count = Number(fs.readFileSync(countFile, 'utf8')) || 0; } catch (_) { count = 0; }

if (count >= PUSHBACK_CAP) {
  log(`cap  ${me} still owns ${open.length} open task(s) but hit the ${PUSHBACK_CAP} pushback cap; letting it idle. LEAD: check this teammate.`);
  process.exit(0);
}
fs.writeFileSync(countFile, String(count + 1));

const list = open
  .map((t) => ` - ${pick(t, ['id']) !== undefined ? '#' + pick(t, ['id']) + ' ' : ''}${pick(t, SUBJECT_KEYS) || '(no subject)'}`)
  .join('\n');
log(`push ${me} (${count + 1}/${PUSHBACK_CAP}) open owned tasks: ${open.length}`);
process.stderr.write(
  `forge gate: you still own ${open.length} open task(s):\n${list}\n` +
  'Finish them and mark each complete, or if you are truly blocked, message the lead with what blocks you ' +
  'and update the task with the blocker before going idle.\n'
);
process.exit(2);
