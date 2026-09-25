#!/usr/bin/env node
/**
 * Guardrail: fail if personal or organization-specific identifiers leak into
 * the generic codebase. Runs as part of `npm run lint` and CI.
 *
 * Built-in checks are generic: real-looking user home folders and email
 * addresses outside the reserved example domains.
 *
 * Organization names, internal hosts, tenant GUIDs and the like belong in a
 * local deny-list that is never committed (listing them here would publish
 * exactly what the check is meant to keep out). Put one regex per line in
 * `scripts/check-generic.local.txt` (gitignored) or point
 * `HIVE_GENERIC_DENYLIST` at a file elsewhere. Lines starting with `#` are
 * comments; patterns are case-insensitive.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCAL_DENYLIST = process.env.HIVE_GENERIC_DENYLIST || path.join(ROOT, 'scripts', 'check-generic.local.txt');

/** Placeholder user names that may appear in example paths. */
const PLACEHOLDER_USERS = new Set(['alice', 'bob', 'carol', 'dave', 'foo', 'me', 'you', 'user', 'username', 'name', 'jane.doe', 'runner']);
/** Home folders: C:\Users\x, C--Users-x (Claude's encoded form), /Users/x, /home/x. */
const HOME_PATH = /(?:[A-Za-z]:\\{1,2}Users\\{1,2}|\/Users\/|\/home\/)([A-Za-z0-9][A-Za-z0-9._-]*)|[A-Za-z]--Users-([A-Za-z0-9]+)/g;

/** Domains that are safe in docs, tests and placeholders. */
const ALLOWED_EMAIL_DOMAIN = /(^|\.)(example(\.(com|org|net))?|test|invalid|localhost|github\.com|users\.noreply\.github\.com|dev\.azure\.com|anthropic\.com|corp\.io|other\.org|evil-example\.com)$/i;
const EMAIL = /[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})/g;

function loadLocalDenylist() {
  if (!fs.existsSync(LOCAL_DENYLIST)) return [];
  return fs.readFileSync(LOCAL_DENYLIST, 'utf-8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => new RegExp(l, 'i'));
}

const DENY_PATTERNS = loadLocalDenylist();

const SCAN_DIRS = ['apps', 'packages', 'scripts', 'installer', 'docs', 'sql', 'tests'];
const ROOT_FILES = ['README.md', 'CLAUDE.md', 'AGENTS.md', 'GEMINI.md', 'package.json'];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'dist-server', 'portable', '.update-tmp']);
const TEXT_EXT = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.md', '.sql', '.sh', '.nsi', '.cmd', '.plist', '.html', '.css', '.yml', '.yaml']);
const SELF = path.relative(ROOT, fileURLToPath(import.meta.url));

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (TEXT_EXT.has(path.extname(entry.name).toLowerCase())) yield full;
  }
}

function lineProblem(line) {
  for (const m of line.matchAll(HOME_PATH)) {
    if (!PLACEHOLDER_USERS.has((m[1] ?? m[2]).toLowerCase())) return `user home folder "${m[0]}"`;
  }
  for (const m of line.matchAll(EMAIL)) {
    if (!ALLOWED_EMAIL_DOMAIN.test(m[1])) return `email address "${m[0]}"`;
  }
  for (const re of DENY_PATTERNS) {
    if (re.test(line)) return `local deny-list ${re}`;
  }
  return null;
}

const files = [];
for (const d of SCAN_DIRS) {
  const full = path.join(ROOT, d);
  if (fs.existsSync(full)) files.push(...walk(full));
}
for (const f of ROOT_FILES) {
  const full = path.join(ROOT, f);
  if (fs.existsSync(full)) files.push(full);
}

const hits = [];
for (const file of files) {
  const rel = path.relative(ROOT, file);
  if (rel === SELF) continue;
  const lines = fs.readFileSync(file, 'utf-8').split(/\r?\n/);
  lines.forEach((line, i) => {
    const problem = lineProblem(line);
    if (problem) hits.push(`${rel}:${i + 1}: ${problem} → ${line.trim().slice(0, 120)}`);
  });
}

if (hits.length > 0) {
  console.error(`check-generic: ${hits.length} personal or organization-specific reference(s) found:\n`);
  for (const h of hits) console.error(`  ${h}`);
  process.exit(1);
}
const extra = DENY_PATTERNS.length ? ` + ${DENY_PATTERNS.length} local deny-list pattern(s)` : '';
console.log(`check-generic: OK (${files.length} files scanned${extra})`);
