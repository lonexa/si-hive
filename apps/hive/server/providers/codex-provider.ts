import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import type { AIProvider } from './types.js';
import { resolveExe } from './resolve-exe.js';

let _resolvedCodexPath: string | null = null;
const DEFAULT_CODEX_MODEL = 'gpt-5.6-sol';
const DEFAULT_CODEX_REASONING_EFFORT = 'medium';

function defaultReasoningEffort(model: string): string {
  return model === 'gpt-5.5' ? 'xhigh' : DEFAULT_CODEX_REASONING_EFFORT;
}

export const codexProvider: AIProvider = {
  id: 'codex',
  displayName: 'Codex CLI',

  processName(): string {
    return 'codex';
  },

  exePath(customPath?: string): string {
    if (customPath) return customPath;
    if (_resolvedCodexPath) return _resolvedCodexPath;
    _resolvedCodexPath = resolveExe('codex');
    return _resolvedCodexPath;
  },

  isInstalled(customPath?: string): boolean {
    try {
      const p = this.exePath(customPath);
      return fs.existsSync(p);
    } catch {
      return false;
    }
  },

  interactiveArgs(opts?: {
    permissionMode?: string;
    model?: string;
    reasoningEffort?: string;
    contextPaths?: string[];
  }): string[] {
    const args: string[] = [];

    if (opts?.permissionMode === 'bypassPermissions') {
      args.push('--dangerously-bypass-approvals-and-sandbox');
    }

    const model = opts?.model && opts.model !== 'default' ? opts.model : DEFAULT_CODEX_MODEL;
    const reasoningEffort = opts?.reasoningEffort || defaultReasoningEffort(model);
    args.push('--model', model);
    args.push('-c', `model_reasoning_effort="${reasoningEffort}"`);

    if (opts?.contextPaths) {
      for (const dir of opts.contextPaths) {
        args.push('--add-dir', dir);
      }
    }

    return args;
  },

  batchArgs(prompt: string, opts?: { skipPermissions?: boolean; model?: string; reasoningEffort?: string }): string[] {
    const args: string[] = [];
    if (opts?.skipPermissions) {
      args.push('--dangerously-bypass-approvals-and-sandbox');
    }
    const model = opts?.model && opts.model !== 'default' ? opts.model : DEFAULT_CODEX_MODEL;
    const reasoningEffort = opts?.reasoningEffort || defaultReasoningEffort(model);
    args.push('--model', model);
    args.push('-c', `model_reasoning_effort="${reasoningEffort}"`);
    args.push('exec', prompt);
    return args;
  },

  cleanEnv(
    env: Record<string, string | undefined>,
    _opts?: { configDir?: string },
  ): Record<string, string | undefined> {
    // Multiple accounts are not wired up for this provider yet; a configDir is
    // accepted for interface parity and ignored.
    return { ...env };
  },

  readyPatterns: ['\u276F', '>'],

  wrapPromptForInput(prompt: string): string {
    return `${prompt}\r`;
  },

  sessionDir(): string | null {
    return path.join(os.homedir(), '.codex', 'sessions');
  },

  sessionFileGlob(): string {
    return '**/*.jsonl';
  },

  homeDir(): string {
    return path.join(os.homedir(), '.codex');
  },

  resumeArgs(sessionId: string): string[] {
    return ['exec', 'resume', sessionId];
  },

  formatModelName(model: string): string {
    return model.replace(/^codex-/, '');
  },

  availableModels() {
    return [
      { id: DEFAULT_CODEX_MODEL, displayName: 'GPT-5.6 Sol', description: 'Latest frontier agentic coding model' },
      { id: 'gpt-5.6-terra', displayName: 'GPT-5.6 Terra', description: 'Balanced agentic coding model' },
      { id: 'gpt-5.6-luna', displayName: 'GPT-5.6 Luna', description: 'Fast affordable agentic coding model' },
      { id: 'gpt-5.5', displayName: 'GPT-5.5', description: 'Previous frontier model' },
      { id: 'gpt-5.4-mini', displayName: 'GPT-5.4 Mini', description: 'Fast cost-efficient model' },
    ];
  },
};
