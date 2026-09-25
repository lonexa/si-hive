/**
 * Bundled-skill installer.
 *
 * Some built-in Hive actions invoke Claude Code with a named skill (e.g. the
 * `claude-daily` action uses the `claude-daily` skill). For Claude to find
 * those skills on whichever dev machine wins the daily claim, they have to
 * exist at `~/.claude/skills/<name>/SKILL.md` on that machine.
 *
 * The source of truth lives in the repo at `apps/hive/skills/<name>/`. On
 * server startup we copy each bundled skill into the user's Claude skills
 * directory, overwriting any prior copy so a `git pull` (or Refresh-from-Repo)
 * propagates updates without manual steps.
 *
 * Users' own custom skills under `~/.claude/skills/` are untouched — we only
 * write the named skills we own.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const BUNDLED_SKILL_NAMES = ['claude-daily', 'hive-extend'] as const;

function bundledSkillsRoot(): string {
  // server/skills/bundled-skills.ts → ../../skills/  (apps/hive/skills)
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '..', '..', 'skills');
}

function userSkillsRoot(): string {
  return path.join(os.homedir(), '.claude', 'skills');
}

function copyDirSync(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(s, d);
    } else if (entry.isFile()) {
      fs.copyFileSync(s, d);
    }
  }
}

/**
 * Sync every bundled skill to ~/.claude/skills/. Safe to call on every server
 * startup — overwrites existing files so updates from git ship without manual
 * intervention.
 */
export function syncBundledSkills(): void {
  // Opt-out for dev/test instances that share a machine with an installed Hive.
  if (process.env.HIVE_SKIP_BUNDLED_SKILLS === '1') {
    console.log('[bundled-skills] HIVE_SKIP_BUNDLED_SKILLS=1 — skipping sync');
    return;
  }
  const srcRoot = bundledSkillsRoot();
  const destRoot = userSkillsRoot();

  if (!fs.existsSync(srcRoot)) {
    console.log(`[bundled-skills] No bundled skills directory at ${srcRoot}, skipping sync`);
    return;
  }

  let synced = 0;
  for (const name of BUNDLED_SKILL_NAMES) {
    const src = path.join(srcRoot, name);
    if (!fs.existsSync(src)) {
      console.warn(`[bundled-skills] Expected skill "${name}" not found at ${src}`);
      continue;
    }
    const dest = path.join(destRoot, name);
    try {
      copyDirSync(src, dest);
      synced++;
    } catch (err) {
      console.error(`[bundled-skills] Failed to sync "${name}":`, err);
    }
  }

  if (synced > 0) {
    console.log(`[bundled-skills] Synced ${synced}/${BUNDLED_SKILL_NAMES.length} bundled skills to ${destRoot}`);
  }
}
