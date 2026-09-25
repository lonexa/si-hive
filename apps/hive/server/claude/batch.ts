/**
 * Shared helper for one-shot ("batch") AI CLI invocations.
 *
 * Several features ask the user's primary AI CLI (Claude Code, Codex, Gemini
 * — see providers/registry.ts) a single question and parse the answer: the AI
 * to-do generator and the `cli` LLM backend (ai/llm.ts). They all need the
 * same fiddly spawn logic: on Windows a `.cmd`/`.bat` shim can't be spawned
 * directly and special characters get mangled if the prompt is passed as an
 * argv element, so the prompt is piped via stdin instead.
 */

import { spawn } from 'node:child_process';
import os from 'node:os';
import { loadConfig } from '../config.js';
import { getPrimaryProvider, getProvider } from '../providers/registry.js';
import type { ProviderId } from '../types.js';

export interface BatchOptions {
  /** Defaults to the configured primary provider. */
  providerId?: ProviderId;
  /** Working directory (defaults to the OS temp dir so the CLI sees no project). */
  cwd?: string;
  /** Allow tool use without prompting. Off by default for pure text answers. */
  skipPermissions?: boolean;
  timeoutMs?: number;
}

/**
 * Run the AI CLI once in print mode with `prompt` and resolve with its stdout
 * text. Rejects if the process exits non-zero. Output is capped to avoid
 * unbounded memory if the CLI misbehaves.
 */
export function spawnProviderBatch(prompt: string, logPrefix = 'ai-batch', opts: BatchOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const config = loadConfig();
    const provider = opts.providerId ? getProvider(opts.providerId) : getPrimaryProvider(config);
    const customPath = config.aiProviders?.providers?.[provider.id]?.customPath;
    let cmd = provider.exePath(customPath);
    const fullArgs = provider.batchArgs(prompt, { skipPermissions: opts.skipPermissions });
    const promptViaStdin = process.platform === 'win32';
    // batchArgs puts the prompt last; on Windows it goes through stdin instead.
    let args = promptViaStdin && fullArgs[fullArgs.length - 1] === prompt ? fullArgs.slice(0, -1) : fullArgs;

    // .cmd/.bat shims can't be spawned directly on Windows — wrap with cmd.exe /c.
    if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(cmd)) {
      args = ['/c', cmd, ...args];
      cmd = 'cmd.exe';
    }

    console.log(`[${logPrefix}] Spawning ${provider.displayName}: ${cmd} (${args.length} args)`);

    const proc = spawn(cmd, args, {
      shell: false,
      cwd: opts.cwd ?? os.tmpdir(),
      stdio: ['pipe', 'pipe', 'pipe'],
      env: provider.cleanEnv({ ...process.env }),
    });

    if (promptViaStdin) {
      proc.stdin?.write(prompt);
    }
    proc.stdin?.end();

    let output = '';
    const MAX_BYTES = 2 * 1024 * 1024;
    let bytes = 0;

    const append = (chunk: Buffer) => {
      if (bytes >= MAX_BYTES) return;
      const text = chunk.toString('utf-8');
      output += text;
      bytes += text.length;
    };

    proc.stdout?.on('data', append);
    proc.stderr?.on('data', append);

    const timer = opts.timeoutMs ? setTimeout(() => proc.kill(), opts.timeoutMs) : null;
    proc.on('close', (code) => {
      if (timer) clearTimeout(timer);
      console.log(`[${logPrefix}] ${provider.displayName} exited with code ${code}, output length: ${output.length}`);
      if (code === 0) resolve(output);
      else reject(new Error(`${provider.displayName} exited with code ${code}: ${output.slice(0, 500)}`));
    });

    proc.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * Back-compat wrapper: the to-do generator relies on tool use (reading the
 * user's mail/calendar context via skills), so it keeps permissions skipped.
 */
export function spawnClaudeBatch(prompt: string, logPrefix = 'claude-batch'): Promise<string> {
  return spawnProviderBatch(prompt, logPrefix, { skipPermissions: true });
}

/**
 * Pull a JSON value out of Claude's free-text output. Handles a ```json fenced
 * block, a bare array, or a bare object. Returns null if nothing parses.
 */
export function parseJsonFromOutput<T>(output: string): T | null {
  const jsonMatch = output.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  const toParse = jsonMatch ? jsonMatch[1] : output;
  try {
    // Prefer an array if one is present (the common case for list answers).
    const start = toParse.indexOf('[');
    const end = toParse.lastIndexOf(']');
    if (start !== -1 && end !== -1 && end > start) {
      return JSON.parse(toParse.slice(start, end + 1));
    }
    return JSON.parse(toParse);
  } catch {
    return null;
  }
}
