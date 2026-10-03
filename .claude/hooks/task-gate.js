#!/usr/bin/env node
'use strict';
/*
 * task-gate.js  (Claude Code hook: TaskCompleted)
 *
 * Runs when any task in the shared task list is being marked complete.
 * Exit 2 blocks the completion and hands stderr back to the agent as feedback.
 * Exit 0 lets it through. Exit 1 does NOT block, so every failure path here is an explicit exit 2.
 *
 * Only active while .claude/.forge exists (the /forge skill creates it at phase 0
 * and deletes it at the end). Outside a forge run this script exits 0 immediately.
 *
 * What it runs, in order, stopping at the first failure:
 *   1. commands listed in .claude/forge.json  ->  { "gates": ["npm run build", "npm test"] }
 *   2. otherwise: <pm> run build, <pm> run test, <pm> run lint for whichever scripts exist in
 *      package.json, using pnpm / yarn / bun / npm based on the lockfile present.
 *
 * Task subjects carry a phase prefix. plan: review: docs: research: tasks skip the gate.
 * build: ship: and unprefixed tasks are gated.
 *
 * Every result is appended to .claude/forge.log as one line.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const claudeDir = path.join(projectDir, '.claude');
const marker = path.join(claudeDir, '.forge');
const stateDir = path.join(claudeDir, '.forge-state');
const logFile = path.join(claudeDir, 'forge.log');
const configFile = path.join(claudeDir, 'forge.json');
const SKIP_PHASES = ['plan', 'review', 'docs', 'research'];
const TAIL_CHARS = 4000;
const perCommandTimeoutMs = Number(process.env.FORGE_GATE_TIMEOUT_MS) || 20 * 60 * 1000;

function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch (_) { return ''; }
}
function log(line) {
  try {
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.appendFileSync(logFile, `${new Date().toISOString()} task-gate ${line}\n`);
  } catch (_) { /* logging must never break the gate */ }
}
function tail(s, n) {
  s = String(s || '');
  return s.length > n ? '...\n' + s.slice(-n) : s;
}
function detectPm() {
  const has = (f) => fs.existsSync(path.join(projectDir, f));
  if (has('pnpm-lock.yaml')) return 'pnpm';
  if (has('yarn.lock')) return 'yarn';
  if (has('bun.lockb') || has('bun.lock')) return 'bun';
  return 'npm';
}
function gateCommands() {
  let cmds = [];
  if (fs.existsSync(configFile)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(configFile, 'utf8'));
      if (Array.isArray(cfg.gates)) cmds = cfg.gates.filter((c) => typeof c === 'string' && c.trim());
    } catch (e) { log(`warn bad .claude/forge.json: ${e.message}`); }
  }
  if (cmds.length) return cmds;
  const pkgPath = path.join(projectDir, 'package.json');
  if (!fs.existsSync(pkgPath)) return cmds;
  try {
    const scripts = (JSON.parse(fs.readFileSync(pkgPath, 'utf8')).scripts) || {};
    const pm = detectPm();
    for (const name of ['build', 'test', 'lint']) {
      if (scripts[name]) cmds.push(`${pm} run ${name}`);
    }
  } catch (e) { log(`warn bad package.json: ${e.message}`); }
  return cmds;
}

// 1. Not a forge run: stay out of the way.
if (!fs.existsSync(marker)) process.exit(0);

let input = {};
try { input = JSON.parse(readStdin() || '{}'); } catch (_) { input = {}; }
const subject = String(input.task_subject || '').trim();
const who = input.teammate_name || 'lead';
const m = subject.match(/^([a-z]+):/i);
const phase = m ? m[1].toLowerCase() : 'build';

// 2. Phases that produce no code skip the gate.
if (SKIP_PHASES.includes(phase)) {
  log(`skip ${who} [${phase}] ${subject}`);
  process.exit(0);
}

// 3. Resolve what to run.
const commands = gateCommands();
if (commands.length === 0) {
  // Block once per run so the team sets gates up early; after that, pass but log loudly.
  fs.mkdirSync(stateDir, { recursive: true });
  const onceFile = path.join(stateDir, 'no-gates-warned');
  if (!fs.existsSync(onceFile)) {
    fs.writeFileSync(onceFile, new Date().toISOString());
    log(`block ${who} [${phase}] ${subject} (no gate commands configured)`);
    process.stderr.write(
      'forge gate: no build/test/lint commands found. ' +
      'Add "build", "test" and "lint" scripts to package.json, or create .claude/forge.json ' +
      'as {"gates": ["<command>", ...]}. Then mark this task complete again.\n'
    );
    process.exit(2);
  }
  log(`pass ${who} [${phase}] ${subject} (no gate commands configured; passing unverified)`);
  process.exit(0);
}

// 4. Run them.
for (const cmd of commands) {
  const t0 = Date.now();
  const r = spawnSync(cmd, {
    cwd: projectDir,
    shell: true,                 // cmd.exe on Windows so npm/pnpm .cmd shims resolve; sh elsewhere
    encoding: 'utf8',
    timeout: perCommandTimeoutMs,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, CI: '1', FORCE_COLOR: '0' }, // CI=1 keeps vitest/jest out of watch mode
  });
  const ms = Date.now() - t0;
  const failed = r.error || r.status !== 0;
  if (!failed) {
    log(`ok   ${who} [${phase}] ${subject} :: ${cmd} (${ms} ms)`);
    continue;
  }
  const reason = r.error
    ? (r.error.code === 'ETIMEDOUT' ? `timed out after ${perCommandTimeoutMs} ms` : r.error.message)
    : `exit ${r.status}`;
  log(`FAIL ${who} [${phase}] ${subject} :: ${cmd} (${reason}, ${ms} ms)`);
  process.stderr.write(
    `forge gate FAILED: ${cmd} (${reason}). This task stays open until it passes.\n` +
    `Fix the cause inside your own slice, rerun "${cmd}" yourself, then mark the task complete again.\n` +
    `--- output tail ---\n${tail((r.stdout || '') + (r.stderr || ''), TAIL_CHARS)}\n`
  );
  process.exit(2);
}

log(`pass ${who} [${phase}] ${subject}`);
process.exit(0);
