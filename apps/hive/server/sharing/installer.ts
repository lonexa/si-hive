import fs from 'node:fs';
import path from 'node:path';
import type { SharedItemWithFiles } from './types.js';
import { resolveSettingsPath, upsertHook, type HookObject } from '../hooks/settings-hooks.js';

export function installSkill(claudeHome: string, item: SharedItemWithFiles): void {
  const skillDir = path.join(claudeHome, 'skills', item.name);
  fs.mkdirSync(skillDir, { recursive: true });

  for (const file of item.files) {
    const filePath = path.join(skillDir, file.file_path);
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, file.content, 'utf-8');
  }
}

export function installAgent(claudeHome: string, item: SharedItemWithFiles): void {
  const agentDir = path.join(claudeHome, 'agents');
  fs.mkdirSync(agentDir, { recursive: true });

  const primaryFile = item.files.find(f => f.is_primary) || item.files[0];
  if (primaryFile) {
    fs.writeFileSync(path.join(agentDir, `${item.name}.md`), primaryFile.content, 'utf-8');
  }
}

export function installPlan(claudeHome: string, item: SharedItemWithFiles): void {
  const plansDir = path.join(claudeHome, 'plans');
  fs.mkdirSync(plansDir, { recursive: true });

  const primaryFile = item.files.find(f => f.is_primary) || item.files[0];
  if (primaryFile) {
    fs.writeFileSync(path.join(plansDir, `${item.name}.md`), primaryFile.content, 'utf-8');
  }
}

export function installPluginConfig(claudeHome: string, item: SharedItemWithFiles): void {
  const primaryFile = item.files.find(f => f.is_primary) || item.files[0];
  if (!primaryFile) return;

  const config = JSON.parse(primaryFile.content) as {
    enabledPlugins?: Record<string, boolean>;
    mcpServers?: Record<string, unknown>;
  };

  // Merge enabledPlugins into settings.json
  if (config.enabledPlugins) {
    const settingsPath = path.join(claudeHome, 'settings.json');
    let settings: Record<string, unknown> = {};
    if (fs.existsSync(settingsPath)) {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as Record<string, unknown>;
    }
    const existing = (settings['enabledPlugins'] ?? {}) as Record<string, boolean>;
    settings['enabledPlugins'] = { ...existing, ...config.enabledPlugins };
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
  }

  // Merge mcpServers into .mcp.json
  if (config.mcpServers) {
    const mcpPath = path.join(claudeHome, '.mcp.json');
    let mcpConfig: Record<string, unknown> = {};
    if (fs.existsSync(mcpPath)) {
      mcpConfig = JSON.parse(fs.readFileSync(mcpPath, 'utf-8')) as Record<string, unknown>;
    }
    const existingServers = (mcpConfig['mcpServers'] ?? {}) as Record<string, unknown>;
    mcpConfig['mcpServers'] = { ...existingServers, ...config.mcpServers };
    fs.writeFileSync(mcpPath, JSON.stringify(mcpConfig, null, 2), 'utf-8');
  }
}

export function installHook(claudeHome: string, item: SharedItemWithFiles): void {
  const primaryFile = item.files.find(f => f.is_primary) || item.files[0];
  if (!primaryFile) return;

  // A shared hook stores a single hook.json: { event, matcher, hook }
  const parsed = JSON.parse(primaryFile.content) as {
    event: string;
    matcher?: string;
    hook: HookObject;
  };
  if (!parsed.event || !parsed.hook) return;

  // Installing a team hook always targets the user-level settings.json.
  const settingsPath = resolveSettingsPath('user', undefined, claudeHome);
  upsertHook(settingsPath, { event: parsed.event, matcher: parsed.matcher, hookObj: parsed.hook });
}

export function installSettingsTemplate(claudeHome: string, item: SharedItemWithFiles): void {
  const primaryFile = item.files.find(f => f.is_primary) || item.files[0];
  if (!primaryFile) return;

  const template = JSON.parse(primaryFile.content) as Record<string, unknown>;
  const settingsPath = path.join(claudeHome, 'settings.json');

  let settings: Record<string, unknown> = {};
  if (fs.existsSync(settingsPath)) {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as Record<string, unknown>;
  }

  // Shallow merge of top-level keys
  settings = { ...settings, ...template };
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
}
