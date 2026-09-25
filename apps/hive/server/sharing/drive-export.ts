import fs from 'node:fs';
import path from 'node:path';
import type { SharedItemWithFiles } from './types.js';

export function exportToDrive(drivePath: string, item: SharedItemWithFiles): void {
  // Based on item_type, write to appropriate subfolder
  switch (item.item_type) {
    case 'skill': {
      const skillDir = path.join(drivePath, 'skills', item.name);
      fs.mkdirSync(skillDir, { recursive: true });
      for (const file of item.files) {
        const filePath = path.join(skillDir, file.file_path);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, file.content, 'utf-8');
      }
      break;
    }
    case 'agent': {
      const agentDir = path.join(drivePath, 'agents');
      fs.mkdirSync(agentDir, { recursive: true });
      const primaryFile = item.files.find(f => f.is_primary) || item.files[0];
      if (primaryFile) {
        fs.writeFileSync(path.join(agentDir, `${item.name}.md`), primaryFile.content, 'utf-8');
      }
      break;
    }
    case 'hook': {
      const hooksDir = path.join(drivePath, 'hooks');
      fs.mkdirSync(hooksDir, { recursive: true });
      const primaryFile = item.files.find(f => f.is_primary) || item.files[0];
      if (primaryFile) {
        fs.writeFileSync(path.join(hooksDir, `${item.name}.json`), primaryFile.content, 'utf-8');
      }
      break;
    }
    case 'plugin_config':
    case 'settings_template': {
      const configDir = path.join(drivePath, 'configs');
      fs.mkdirSync(configDir, { recursive: true });
      const primaryFile = item.files.find(f => f.is_primary) || item.files[0];
      if (primaryFile) {
        fs.writeFileSync(
          path.join(configDir, `${item.name}.json`),
          primaryFile.content,
          'utf-8'
        );
      }
      break;
    }
  }
}
