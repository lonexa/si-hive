import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import type { AIProvider } from './types.js';
import { resolveExe } from './resolve-exe.js';

let _resolvedGeminiPath: string | null = null;

export const geminiProvider: AIProvider = {
  id: 'gemini',
  displayName: 'Gemini CLI',

  processName(): string {
    return 'gemini';
  },

  exePath(customPath?: string): string {
    if (customPath) return customPath;
    if (_resolvedGeminiPath) return _resolvedGeminiPath;
    _resolvedGeminiPath = resolveExe('gemini');
    return _resolvedGeminiPath;
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
    contextPaths?: string[];
  }): string[] {
    const args: string[] = [];

    if (opts?.permissionMode === 'bypassPermissions') {
      args.push('--yolo');
    }

    if (opts?.model) {
      args.push('--model', opts.model);
    }

    // Gemini CLI does not support --add-dir; contextPaths ignored

    return args;
  },

  batchArgs(prompt: string, opts?: { skipPermissions?: boolean }): string[] {
    const args: string[] = [];
    if (opts?.skipPermissions) {
      args.push('--yolo');
    }
    args.push('-p', prompt, '--output-format', 'text');
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

  readyPatterns: ['\u25C7', '\u276F'],

  wrapPromptForInput(prompt: string): string {
    return `${prompt}\r`;
  },

  sessionDir(): string | null {
    return path.join(os.homedir(), '.gemini', 'tmp');
  },

  sessionFileGlob(): string {
    return '**/chats/*.json';
  },

  homeDir(): string {
    return path.join(os.homedir(), '.gemini');
  },

  resumeArgs(sessionId: string): string[] {
    return ['--resume', sessionId];
  },

  formatModelName(model: string): string {
    return model.replace(/^models\//, '').replace(/^gemini-/, '');
  },

  availableModels() {
    return [
      { id: 'gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', description: 'Most capable Gemini model' },
      { id: 'gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', description: 'Fast balanced model' },
      { id: 'gemini-2.5-flash-lite', displayName: 'Gemini 2.5 Flash Lite', description: 'Lower latency model' },
    ];
  },
};
