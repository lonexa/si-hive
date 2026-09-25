import fs from 'node:fs';
import type { SessionFileState } from './session-state.js';

type MachineState = 'working' | 'needs_input' | 'done';

/**
 * Gemini CLI chat session file format (~/.gemini/tmp/{project}/chats/session-*.json).
 */
interface GeminiMessage {
  id?: string;
  timestamp?: string;
  type: 'user' | 'gemini';
  content?: string | Array<{ text?: string }>;
  thoughts?: unknown[];
  tokens?: { input?: number; output?: number; cached?: number; thoughts?: number; tool?: number; total?: number };
  model?: string;
  toolCalls?: Array<{
    id?: string;
    name: string;
    args?: Record<string, unknown>;
    result?: unknown;
  }>;
}

interface GeminiChatSession {
  sessionId?: string;
  projectHash?: string;
  startTime?: string;
  lastUpdated?: string;
  messages?: GeminiMessage[];
}

/**
 * Parse a Gemini chats/*.json session file into SessionFileState.
 */
export function parseGeminiSession(filePath: string): SessionFileState | null {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size === 0) return null;

    const raw = fs.readFileSync(filePath, 'utf-8');
    const session = JSON.parse(raw) as GeminiChatSession;

    const messages = session.messages ?? [];
    if (!Array.isArray(messages) || messages.length === 0) return null;

    let toolUseCount = 0;
    let toolResultCount = 0;
    let messageCount = 0;
    let initialPrompt: string | undefined;
    let latestPrompt: string | undefined;
    let lastToolName: string | undefined;
    let model: string | undefined;

    for (const msg of messages) {
      messageCount++;

      if (msg.type === 'user') {
        // Content can be a string or an array of {text} objects
        let text = '';
        if (typeof msg.content === 'string') {
          text = msg.content;
        } else if (Array.isArray(msg.content)) {
          text = msg.content.map(p => p.text ?? '').filter(Boolean).join('');
        }
        if (text) {
          if (!initialPrompt) initialPrompt = text.slice(0, 500);
          latestPrompt = text.slice(0, 500);
        }
      }

      if (msg.type === 'gemini') {
        if (msg.model) model = msg.model;
        if (msg.toolCalls) {
          for (const tc of msg.toolCalls) {
            toolUseCount++;
            lastToolName = tc.name;
            if (tc.result !== undefined) {
              toolResultCount++;
            }
          }
        }
      }
    }

    // Determine state from last message
    const lastMsg = messages[messages.length - 1];
    let machineState: MachineState = 'done';
    if (lastMsg?.type === 'gemini') {
      const hasToolCalls = lastMsg.toolCalls && lastMsg.toolCalls.length > 0;
      const allToolsHaveResults = hasToolCalls && lastMsg.toolCalls!.every(tc => tc.result !== undefined);
      machineState = (hasToolCalls && !allToolsHaveResults) ? 'working' : 'done';
    } else if (lastMsg?.type === 'user') {
      machineState = 'working';
    }

    // Session ID: prefer the JSON field, fall back to path extraction
    let sessionId = session.sessionId;
    if (!sessionId) {
      // Extract from filename: session-2026-03-24T19-48-bf6933e0.json → bf6933e0
      const basename = filePath.replace(/\\/g, '/').split('/').pop() ?? '';
      const match = basename.match(/session-.*?-([a-f0-9]+)\.json$/i);
      sessionId = match ? match[1] : basename.replace('.json', '');
    }

    // Use lastUpdated/startTime from JSON if available, else fall back to mtime
    const lastActivityAt = session.lastUpdated
      ?? session.startTime
      ?? new Date(stat.mtimeMs).toISOString();

    return {
      byteOffset: stat.size,
      mtimeMs: session.lastUpdated ? new Date(session.lastUpdated).getTime() : stat.mtimeMs,
      fileSize: stat.size,
      machineState,
      toolUseCount,
      toolResultCount,
      pendingInputTool: false,
      lastActivityAt,
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
