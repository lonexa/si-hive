import fs from 'node:fs';
import type { SessionFileState } from './session-state.js';

type MachineState = 'working' | 'needs_input' | 'done';

interface CodexEntry {
  type?: string;
  event?: string;
  role?: string;
  message?: {
    role?: string;
    content?: string | Array<{ type?: string; text?: string; name?: string }>;
  };
  timestamp?: string;
  model?: string;
  sessionId?: string;
}

/**
 * Parse a Codex JSONL session file into SessionFileState.
 * Codex uses a JSONL format similar to Claude, with events like
 * turn.started, turn.completed, item.started, item.completed.
 */
export function parseCodexSession(filePath: string): SessionFileState | null {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size === 0) return null;

    // Read last 64KB for large files (same strategy as Claude parser)
    const TAIL_SIZE = 65536;
    let content: string;
    if (stat.size > TAIL_SIZE) {
      const fd = fs.openSync(filePath, 'r');
      const buffer = Buffer.allocUnsafe(TAIL_SIZE);
      fs.readSync(fd, buffer, 0, TAIL_SIZE, stat.size - TAIL_SIZE);
      fs.closeSync(fd);
      content = buffer.toString('utf-8');
    } else {
      content = fs.readFileSync(filePath, 'utf-8');
    }

    const lines = content.split('\n');
    const startIdx = stat.size > TAIL_SIZE ? 1 : 0; // skip potentially partial first line

    let toolUseCount = 0;
    let toolResultCount = 0;
    let messageCount = 0;
    let initialPrompt: string | undefined;
    let latestPrompt: string | undefined;
    let lastToolName: string | undefined;
    let model: string | undefined;
    let sessionId: string | undefined;
    let machineState: MachineState = 'done';

    for (let i = startIdx; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      try {
        const entry = JSON.parse(line) as CodexEntry;

        if (entry.model) model = entry.model;
        if (entry.sessionId) sessionId = entry.sessionId;

        const eventType = entry.type ?? entry.event;

        switch (eventType) {
          case 'turn.started':
            machineState = 'working';
            break;
          case 'turn.completed':
            machineState = 'done';
            break;
          case 'turn.failed':
            machineState = 'done';
            break;
          case 'item.started':
          case 'item.updated':
            machineState = 'working';
            break;
          case 'item.completed':
            // Could be tool result
            if (entry.message?.content) {
              const contentArr = Array.isArray(entry.message.content) ? entry.message.content : [];
              for (const block of contentArr) {
                if (block.type === 'tool_use' || block.type === 'function_call') {
                  toolUseCount++;
                  lastToolName = block.name;
                }
                if (block.type === 'tool_result' || block.type === 'function_call_output') {
                  toolResultCount++;
                }
              }
            }
            break;
        }

        // Extract prompts from user messages
        const role = entry.role ?? entry.message?.role;
        if (role === 'user') {
          messageCount++;
          const text = typeof entry.message?.content === 'string'
            ? entry.message.content
            : Array.isArray(entry.message?.content)
              ? entry.message.content.map(b => b.text).filter(Boolean).join('')
              : '';
          if (text) {
            if (!initialPrompt) initialPrompt = text.slice(0, 500);
            latestPrompt = text.slice(0, 500);
          }
        } else if (role === 'assistant') {
          messageCount++;
        }
      } catch {
        // skip malformed lines
      }
    }

    // If no sessionId extracted from content, derive from filename
    if (!sessionId) {
      const basename = filePath.replace(/\\/g, '/').split('/').pop() ?? '';
      sessionId = basename.replace(/\.jsonl$/, '');
    }

    return {
      byteOffset: stat.size,
      mtimeMs: stat.mtimeMs,
      fileSize: stat.size,
      machineState,
      toolUseCount,
      toolResultCount,
      pendingInputTool: false,
      lastActivityAt: new Date(stat.mtimeMs).toISOString(),
      messageCount,
      sessionId,
      model,
      initialPrompt,
      latestPrompt,
      lastToolName,
    };
  } catch {
    return null;
  }
}
