import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { isPathInScope, isProjectDirInScope, isSessionInScope } from '../project-scope.js';
import type { HiveConfig } from '../types.js';

const root = path.resolve('/work/generic');
const cfg = (extra: Partial<HiveConfig> = {}) =>
  ({ projects: [], projectsRoot: root, projectRoots: [], ...extra }) as unknown as HiveConfig;
const enc = (p: string) => p.replace(/[^a-zA-Z0-9]/g, '-');

describe('project scope', () => {
  it('accepts the root and anything inside it, rejects siblings', () => {
    expect(isPathInScope(cfg(), root)).toBe(true);
    expect(isPathInScope(cfg(), path.join(root, 'app', 'src'))).toBe(true);
    expect(isPathInScope(cfg(), path.resolve('/work/generic-other'))).toBe(false);
    expect(isPathInScope(cfg(), path.resolve('/work/classic/app'))).toBe(false);
  });

  it('includes extra project roots and explicit projects', () => {
    const c = cfg({ projectRoots: [path.resolve('/src/extra')], projects: [{ name: 'x', path: path.resolve('/one/off') }] });
    expect(isPathInScope(c, path.resolve('/src/extra/repo'))).toBe(true);
    expect(isPathInScope(c, path.resolve('/one/off'))).toBe(true);
    expect(isPathInScope(c, path.resolve('/elsewhere'))).toBe(false);
  });

  it('matches encoded history folder names', () => {
    expect(isProjectDirInScope(cfg(), enc(path.join(root, 'app')))).toBe(true);
    expect(isProjectDirInScope(cfg(), enc(path.resolve('/work/classic')))).toBe(false);
  });

  it('prefers the session cwd over the folder name', () => {
    expect(isSessionInScope(cfg(), path.join(root, 'app'), 'unrelated-dir')).toBe(true);
    expect(isSessionInScope(cfg(), path.resolve('/work/classic'), enc(root))).toBe(false);
  });

  it('does not filter when no folder is configured yet', () => {
    const none = cfg({ projectsRoot: '' });
    expect(isPathInScope(none, '/anything')).toBe(true);
    expect(isSessionInScope(none, undefined, 'x')).toBe(true);
  });
});
