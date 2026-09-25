/**
 * Skill Sync Service
 *
 * Keeps skill/instruction files in sync across all enabled AI providers.
 * Claude Code skills (~/.claude/skills/<name>/skill.md) are the source of truth.
 * This service converts and writes them to:
 *   - Gemini CLI: ~/.gemini/commands/<name>.toml  (TOML custom commands)
 *   - Codex CLI:  ~/.codex/skills/<name>/SKILL.md (Markdown with YAML frontmatter)
 *
 * Sync is triggered after every skill mutation (create, update, delete, install).
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { ProviderId, ProvidersConfig } from './types.js';

// ── Provider home directories ──

function providerHome(providerId: ProviderId): string {
  switch (providerId) {
    case 'claude': return path.join(os.homedir(), '.claude');
    case 'gemini': return path.join(os.homedir(), '.gemini');
    case 'codex':  return path.join(os.homedir(), '.codex');
  }
}

// ── Frontmatter parsing ──

interface SkillMeta {
  name: string;
  description: string;
  content: string;        // Full file content including frontmatter
  bodyContent: string;    // Content after frontmatter
}

function parseClaudeSkill(name: string, content: string): SkillMeta {
  let description = '';
  let bodyContent = content;

  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (fmMatch) {
    const fm = fmMatch[1];
    // Extract description — handle both quoted and unquoted
    const descMatch = fm.match(/description:\s*"([^"]*)"/) || fm.match(/description:\s*'([^']*)'/) || fm.match(/description:\s*(.+)/);
    if (descMatch) description = descMatch[1].trim();
    bodyContent = content.slice(fmMatch[0].length);
  }

  // Fallback description from first paragraph
  if (!description) {
    const firstLine = bodyContent.replace(/^#.+\n+/, '').trim().split('\n')[0];
    description = firstLine?.slice(0, 200) ?? name;
  }

  return { name, description, content, bodyContent };
}

// ── Conversion: Claude → Gemini TOML command ──

function toGeminiToml(skill: SkillMeta): string {
  // Gemini custom commands are TOML with `prompt` and `description` fields.
  // The entire skill content becomes the prompt.
  // We need to escape the content for TOML multi-line string (triple quotes).
  const escapedPrompt = skill.bodyContent
    .replace(/\\/g, '\\\\')
    .replace(/"""/g, '\\"\\"\\"');

  return `# Auto-synced from Claude Code skill: ${skill.name}
# Do not edit — changes will be overwritten on next sync.

description = ${JSON.stringify(skill.description)}

prompt = """
${escapedPrompt}
"""
`;
}

// ── Conversion: Claude → Codex SKILL.md ──

function toCodexSkillMd(skill: SkillMeta): string {
  // Codex skills are Markdown with YAML frontmatter requiring `name` and `description`.
  // If the Claude skill already has frontmatter, we rewrite it in Codex format.
  // The body content stays the same since both use Markdown.
  return `---
name: ${skill.name}
description: "${skill.description.replace(/"/g, '\\"')}"
# Auto-synced from Claude Code skill. Do not edit — changes will be overwritten on next sync.
---

${skill.bodyContent}`;
}

// ── Sync operations ──

/**
 * Sync a single skill to all enabled non-Claude providers.
 * Call after creating or updating a skill.
 */
export function syncSkillToProviders(
  skillName: string,
  claudeHome: string,
  providersConfig: ProvidersConfig,
): void {
  const skillPath = path.join(claudeHome, 'skills', skillName, 'skill.md');
  if (!fs.existsSync(skillPath)) return;

  const content = fs.readFileSync(skillPath, 'utf-8');
  const skill = parseClaudeSkill(skillName, content);

  const enabledProviders = getEnabledNonClaudeProviders(providersConfig);
  for (const providerId of enabledProviders) {
    try {
      writeSkillForProvider(providerId, skill);
    } catch (err) {
      console.error(`[skill-sync] Error syncing "${skillName}" to ${providerId}:`, err);
    }
  }

  if (enabledProviders.length > 0) {
    console.log(`[skill-sync] Synced "${skillName}" to: ${enabledProviders.join(', ')}`);
  }
}

/**
 * Remove a skill from all enabled non-Claude providers.
 * Call after deleting a skill.
 */
export function removeSkillFromProviders(
  skillName: string,
  providersConfig: ProvidersConfig,
): void {
  const enabledProviders = getEnabledNonClaudeProviders(providersConfig);
  for (const providerId of enabledProviders) {
    try {
      deleteSkillForProvider(providerId, skillName);
    } catch (err) {
      console.error(`[skill-sync] Error removing "${skillName}" from ${providerId}:`, err);
    }
  }

  if (enabledProviders.length > 0) {
    console.log(`[skill-sync] Removed "${skillName}" from: ${enabledProviders.join(', ')}`);
  }
}

/**
 * Full sync: read all Claude skills and sync to all enabled providers.
 * Also cleans up orphaned skills in provider directories.
 * Returns summary of actions taken.
 */
export function syncAllSkills(
  claudeHome: string,
  providersConfig: ProvidersConfig,
): { synced: number; removed: number; providers: string[]; errors: string[] } {
  const enabledProviders = getEnabledNonClaudeProviders(providersConfig);
  if (enabledProviders.length === 0) {
    return { synced: 0, removed: 0, providers: [], errors: [] };
  }

  const errors: string[] = [];
  const skillsDir = path.join(claudeHome, 'skills');
  const claudeSkillNames = new Set<string>();

  // Sync all Claude skills to providers
  let synced = 0;
  if (fs.existsSync(skillsDir)) {
    const dirs = fs.readdirSync(skillsDir, { withFileTypes: true }).filter(d => d.isDirectory());
    for (const dir of dirs) {
      const skillPath = path.join(skillsDir, dir.name, 'skill.md');
      if (!fs.existsSync(skillPath)) continue;
      claudeSkillNames.add(dir.name);

      try {
        const content = fs.readFileSync(skillPath, 'utf-8');
        const skill = parseClaudeSkill(dir.name, content);
        for (const providerId of enabledProviders) {
          writeSkillForProvider(providerId, skill);
        }
        synced++;
      } catch (err) {
        errors.push(`Failed to sync "${dir.name}": ${err}`);
      }
    }
  }

  // Clean up orphaned skills in provider directories
  let removed = 0;
  for (const providerId of enabledProviders) {
    const orphaned = getProviderSkillNames(providerId).filter(n => !claudeSkillNames.has(n));
    for (const name of orphaned) {
      try {
        deleteSkillForProvider(providerId, name);
        removed++;
      } catch (err) {
        errors.push(`Failed to remove orphan "${name}" from ${providerId}: ${err}`);
      }
    }
  }

  console.log(`[skill-sync] Full sync complete: ${synced} synced, ${removed} orphans removed across [${enabledProviders.join(', ')}]`);
  return { synced, removed, providers: enabledProviders, errors };
}

// ── Provider-specific write/delete ──

function writeSkillForProvider(providerId: ProviderId, skill: SkillMeta): void {
  switch (providerId) {
    case 'gemini': {
      const cmdDir = path.join(providerHome('gemini'), 'commands');
      fs.mkdirSync(cmdDir, { recursive: true });
      fs.writeFileSync(path.join(cmdDir, `${skill.name}.toml`), toGeminiToml(skill), 'utf-8');
      break;
    }
    case 'codex': {
      const skillDir = path.join(providerHome('codex'), 'skills', skill.name);
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(path.join(skillDir, 'SKILL.md'), toCodexSkillMd(skill), 'utf-8');
      break;
    }
    // claude is source of truth — skip
  }
}

function deleteSkillForProvider(providerId: ProviderId, skillName: string): void {
  switch (providerId) {
    case 'gemini': {
      const tomlPath = path.join(providerHome('gemini'), 'commands', `${skillName}.toml`);
      if (fs.existsSync(tomlPath)) fs.unlinkSync(tomlPath);
      break;
    }
    case 'codex': {
      const skillDir = path.join(providerHome('codex'), 'skills', skillName);
      if (fs.existsSync(skillDir)) fs.rmSync(skillDir, { recursive: true, force: true });
      break;
    }
  }
}

/** List skill names that exist in a provider's directory. */
function getProviderSkillNames(providerId: ProviderId): string[] {
  try {
    switch (providerId) {
      case 'gemini': {
        const cmdDir = path.join(providerHome('gemini'), 'commands');
        if (!fs.existsSync(cmdDir)) return [];
        return fs.readdirSync(cmdDir)
          .filter(f => f.endsWith('.toml'))
          .map(f => f.replace(/\.toml$/, ''));
      }
      case 'codex': {
        const skillsDir = path.join(providerHome('codex'), 'skills');
        if (!fs.existsSync(skillsDir)) return [];
        return fs.readdirSync(skillsDir, { withFileTypes: true })
          .filter(d => d.isDirectory())
          .map(d => d.name);
      }
      default:
        return [];
    }
  } catch {
    return [];
  }
}

// ── Helpers ──

function getEnabledNonClaudeProviders(config: ProvidersConfig): ProviderId[] {
  const providers: ProviderId[] = [];
  for (const [id, cfg] of Object.entries(config.providers)) {
    if (id !== 'claude' && cfg?.enabled) {
      providers.push(id as ProviderId);
    }
  }
  return providers;
}
