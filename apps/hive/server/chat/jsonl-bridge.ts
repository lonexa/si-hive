import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: string;
  type: string;
  content: string;
  toolName?: string;
  toolId?: string;
  model?: string;
  timestamp: string;
}

interface JsonlBridge {
  conversationId: string;
  sessionId: string;
  filePath: string;
  lastOffset: number;
  timer: ReturnType<typeof setInterval> | null;
  onMessage: (msg: ChatMessage) => void;
  onStatusChange?: (status: string) => void;
}

const activeBridges = new Map<string, JsonlBridge>();

/**
 * Get the Claude home directory, handling Windows service mode where os.homedir()
 * returns the service account's home instead of the real user's.
 * Mirrors the logic in routes.ts getRealUserHome().
 */
function getClaudeHome(): string {
  if (process.env['CLAUDE_HOME']) return process.env['CLAUDE_HOME'];
  try {
    const userHomePath = path.join(path.dirname(process.execPath), '..', 'user-home.txt');
    if (fs.existsSync(userHomePath)) {
      const realHome = fs.readFileSync(userHomePath, 'utf-8').trim();
      return path.join(realHome, '.claude');
    }
  } catch { /* ignore */ }
  return path.join(os.homedir(), '.claude');
}

/**
 * Generate a deterministic message ID from content.
 * Same JSONL entry always produces the same ID, enabling proper deduplication
 * in both SQLite (INSERT OR IGNORE) and the client store (addMessage).
 */
function deterministicId(conversationId: string, role: string, content: string, timestamp: string, index: number): string {
  return createHash('sha256')
    .update(`${conversationId}:${role}:${timestamp}:${index}:${content.substring(0, 200)}`)
    .digest('hex')
    .substring(0, 32);
}

/**
 * Find the JSONL file for a Claude session.
 * If encodedProjectDir is provided, look directly in that directory (fast path).
 * Otherwise, scan all project directories (slow fallback).
 */
function findSessionFile(sessionId: string, encodedProjectDir?: string): string | null {
  const claudeHome = getClaudeHome();
  const projectsDir = path.join(claudeHome, 'projects');

  // Fast path: look directly in the known project directory
  if (encodedProjectDir) {
    const dirPath = path.join(projectsDir, encodedProjectDir);
    try {
      if (fs.existsSync(dirPath)) {
        const targetFile = `${sessionId}.jsonl`;
        const filePath = path.join(dirPath, targetFile);
        if (fs.existsSync(filePath)) return filePath;
        // Also try partial match in case filename has extra parts
        for (const file of fs.readdirSync(dirPath)) {
          if (file.endsWith('.jsonl') && file.includes(sessionId)) {
            return path.join(dirPath, file);
          }
        }
      }
    } catch { /* fall through to full scan */ }
  }

  if (!fs.existsSync(projectsDir)) return null;

  // Slow fallback: search all project directories
  try {
    for (const projectDir of fs.readdirSync(projectsDir, { withFileTypes: true })) {
      if (!projectDir.isDirectory()) continue;
      const projPath = path.join(projectsDir, projectDir.name);
      try {
        for (const file of fs.readdirSync(projPath)) {
          if (file.endsWith('.jsonl') && file.includes(sessionId)) {
            return path.join(projPath, file);
          }
        }
      } catch { /* skip inaccessible dirs */ }
    }
  } catch { /* skip */ }

  return null;
}

/**
 * Parse a JSONL file from a given offset, returning new messages.
 * Uses the same parsing logic as handleGetTranscript in index.ts.
 */
function parseNewEntries(filePath: string, offset: number, conversationId: string): { messages: ChatMessage[]; newOffset: number } {
  const messages: ChatMessage[] = [];

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return { messages, newOffset: offset };
  }

  const newOffset = raw.length;
  if (newOffset <= offset) return { messages, newOffset: offset };

  const newContent = raw.slice(offset);
  for (const line of newContent.split('\n')) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (!entry.type || !entry.message) continue;
      const msg = entry.message;

      // Skip user messages — they are already persisted by the 'send' WebSocket
      // handler and shown optimistically on the client. Parsing them here would
      // create duplicates with different IDs.
      if (entry.type === 'user') continue;

      if (entry.type === 'assistant' && msg.role === 'assistant') {
        if (!Array.isArray(msg.content)) continue;
        const ts = entry.timestamp ?? new Date().toISOString();
        let blockIndex = 0;
        for (const block of msg.content) {
          if (block.type === 'text' && block.text) {
            messages.push({
              id: deterministicId(conversationId, 'assistant', block.text, ts, blockIndex),
              conversationId,
              role: 'assistant',
              type: 'text',
              content: block.text,
              timestamp: ts,
              model: msg.model,
            });
            blockIndex++;
          } else if (block.type === 'tool_use') {
            const content = typeof block.input === 'string' ? block.input : JSON.stringify(block.input);
            messages.push({
              id: deterministicId(conversationId, 'tool_use', content, ts, blockIndex),
              conversationId,
              role: 'assistant',
              type: 'tool_use',
              content,
              timestamp: ts,
              toolName: block.name,
              toolId: block.id,
            });
            blockIndex++;
          } else if (block.type === 'tool_result') {
            let resultText = '';
            if (typeof block.content === 'string') {
              resultText = block.content;
            } else if (Array.isArray(block.content)) {
              resultText = block.content
                .filter((b: { type: string }) => b.type === 'text')
                .map((b: { text: string }) => b.text)
                .join('\n');
            }
            messages.push({
              id: deterministicId(conversationId, 'tool_result', resultText, ts, blockIndex),
              conversationId,
              role: 'tool',
              type: 'tool_result',
              content: resultText,
              timestamp: ts,
              toolId: block.tool_use_id,
            });
            blockIndex++;
          }
        }
      }
    } catch { /* skip malformed lines */ }
  }

  return { messages, newOffset };
}

/**
 * Start watching a JSONL file for a chat conversation.
 * Polls every 500ms for new entries and calls onMessage for each.
 */
export function startJsonlBridge(
  conversationId: string,
  sessionId: string,
  onMessage: (msg: ChatMessage) => void,
  onStatusChange?: (status: string) => void,
  knownFilePath?: string,
): boolean {
  // Stop any existing bridge for this conversation
  stopJsonlBridge(conversationId);

  // Use the known file path if provided (avoids re-discovery path mismatch),
  // otherwise fall back to scanning for the file.
  const filePath = knownFilePath ?? findSessionFile(sessionId);
  if (!filePath) {
    console.log(`[jsonl-bridge] Session file not found for ${sessionId}, will retry (claudeHome=${getClaudeHome()})`);
  } else {
    console.log(`[jsonl-bridge] Starting bridge for ${conversationId}, file: ${filePath}`);
  }

  const bridge: JsonlBridge = {
    conversationId,
    sessionId,
    filePath: filePath ?? '',
    lastOffset: 0,
    timer: null,
    onMessage,
    onStatusChange,
  };

  // If we found the file, parse existing content first
  if (filePath) {
    const { messages, newOffset } = parseNewEntries(filePath, 0, conversationId);
    bridge.lastOffset = newOffset;
    for (const msg of messages) {
      onMessage(msg);
    }
  }

  // Start polling
  bridge.timer = setInterval(() => {
    // If we don't have a file path yet, try to find it
    if (!bridge.filePath) {
      const found = findSessionFile(sessionId);
      if (found) {
        bridge.filePath = found;
        console.log(`[jsonl-bridge] Found session file: ${found}`);
      } else {
        return;
      }
    }

    const { messages, newOffset } = parseNewEntries(bridge.filePath, bridge.lastOffset, conversationId);
    bridge.lastOffset = newOffset;

    for (const msg of messages) {
      onMessage(msg);
    }
  }, 500);

  activeBridges.set(conversationId, bridge);
  return true;
}

/**
 * Stop watching a JSONL file for a conversation.
 */
export function stopJsonlBridge(conversationId: string): void {
  const bridge = activeBridges.get(conversationId);
  if (bridge?.timer) {
    clearInterval(bridge.timer);
  }
  activeBridges.delete(conversationId);
}

/**
 * Stop all active JSONL bridges.
 */
export function stopAllBridges(): void {
  for (const [id] of activeBridges) {
    stopJsonlBridge(id);
  }
}
