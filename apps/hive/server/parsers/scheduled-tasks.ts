import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { ScheduledTask } from '../types.js';

export function parseScheduledTasks(): ScheduledTask[] {
  const scheduledDir = path.join(os.homedir(), '.claude', 'scheduled-tasks');
  const tasks: ScheduledTask[] = [];

  if (!fs.existsSync(scheduledDir)) return tasks;

  try {
    const entries = fs.readdirSync(scheduledDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillPath = path.join(scheduledDir, entry.name, 'SKILL.md');
      if (!fs.existsSync(skillPath)) continue;

      try {
        const content = fs.readFileSync(skillPath, 'utf-8');
        const stat = fs.statSync(skillPath);
        tasks.push({
          name: entry.name,
          skillContent: content,
          filePath: skillPath,
          modifiedAt: stat.mtime.toISOString(),
        });
      } catch (err) {
        console.error(`[scheduled-tasks] Error reading ${skillPath}:`, err);
      }
    }
  } catch (err) {
    console.error(`[scheduled-tasks] Error listing ${scheduledDir}:`, err);
  }

  return tasks;
}
