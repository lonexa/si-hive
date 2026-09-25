import type http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { sendJson, readBody } from '../../../../packages/shared/src/server/http-utils.js';
import {
  insertChatConversation,
  getChatConversations,
  getChatConversation,
  updateChatConversation,
  deleteChatConversation,
  getChatMessages,
  insertChatMessage,
  searchChatConversations,
} from '../db.js';
import { spawnChatPty, getChatPtyStatus, destroyChatPty, sendMessageToPty, abortChatPty, getChatPtyTerminalId } from './chat-pty-manager.js';
import { notifyChatSessionId } from './chat-ws.js';
import type { AuthenticatedRequest } from '../auth/types.js';
import { encodeWindowsPath } from '../parsers/process-discovery-windows.js';

export function handleChatRoutes(
  url: URL,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): boolean {
  const authReq = req as AuthenticatedRequest;
  const userEmail = authReq.user?.email;

  // GET /api/chat/conversations — list all conversations
  if (url.pathname === '/api/chat/conversations' && req.method === 'GET') {
    const conversations = getChatConversations(userEmail);
    sendJson(res, 200, { conversations });
    return true;
  }

  // POST /api/chat/conversations — create a new conversation
  if (url.pathname === '/api/chat/conversations' && req.method === 'POST') {
    void (async () => {
      try {
        const body = JSON.parse(await readBody(req)) as {
          title?: string;
          projectPath?: string;
          permissionMode?: string;
          model?: string;
        };

        const id = randomUUID();
        const title = body.title || 'New Chat';
        // project:N is a grouping key for Lite projects without filesystem paths — don't use as cwd
        const isGroupingKey = body.projectPath?.startsWith('project:');
        const cwd = (body.projectPath && !isGroupingKey) ? body.projectPath : os.homedir();

        console.log(`[chat] Creating conversation: ${id}, cwd: ${cwd}, title: ${title}`);
        insertChatConversation(id, title, body.projectPath, userEmail);

        // Spawn hidden PTY
        console.log(`[chat] Spawning Claude Code PTY for conversation: ${id}`);
        const chatPty = await spawnChatPty(id, cwd, 'claude', {
          permissionMode: body.permissionMode,
          model: body.model,
        });
        console.log(`[chat] PTY spawned: terminal=${chatPty.terminalId}, status=${chatPty.status}`);

        updateChatConversation(id, { ptyTerminalId: chatPty.terminalId });

        // Watch filesystem for new JSONL session file
        watchForSessionFile(id, cwd);

        // If trust approval happens, restart the file watcher with a fresh timeout
        chatPty.onTrustResolved = () => {
          console.log(`[chat] Trust resolved, restarting file watcher for conversation: ${id}`);
          watchForSessionFile(id, cwd);
        };

        sendJson(res, 201, {
          id,
          title,
          status: chatPty.status,
          terminalId: chatPty.terminalId,
        });
      } catch (err) {
        console.error('[chat] Error creating conversation:', err);
        sendJson(res, 500, { error: 'Failed to create conversation' });
      }
    })();
    return true;
  }

  // GET /api/chat/conversations/:id — get single conversation
  const singleMatch = url.pathname.match(/^\/api\/chat\/conversations\/([^/]+)$/);
  if (singleMatch && req.method === 'GET') {
    const conv = getChatConversation(singleMatch[1]);
    if (!conv) {
      sendJson(res, 404, { error: 'Conversation not found' });
      return true;
    }
    const ptyStatus = getChatPtyStatus(conv.id);
    sendJson(res, 200, { ...conv, ptyStatus: ptyStatus?.status ?? conv.status });
    return true;
  }

  // PATCH /api/chat/conversations/:id — update conversation
  const patchMatch = url.pathname.match(/^\/api\/chat\/conversations\/([^/]+)$/);
  if (patchMatch && req.method === 'PATCH') {
    void (async () => {
      try {
        const body = JSON.parse(await readBody(req)) as { title?: string; isStarred?: boolean; projectPath?: string | null };
        updateChatConversation(patchMatch[1], { title: body.title, isStarred: body.isStarred, projectPath: body.projectPath });
        sendJson(res, 200, { ok: true });
      } catch {
        sendJson(res, 500, { error: 'Failed to update conversation' });
      }
    })();
    return true;
  }

  // DELETE /api/chat/conversations/:id — delete conversation
  const deleteMatch = url.pathname.match(/^\/api\/chat\/conversations\/([^/]+)$/);
  if (deleteMatch && req.method === 'DELETE') {
    destroyChatPty(deleteMatch[1]);
    deleteChatConversation(deleteMatch[1]);
    sendJson(res, 200, { ok: true });
    return true;
  }

  // GET /api/chat/conversations/:id/messages — get messages
  const messagesMatch = url.pathname.match(/^\/api\/chat\/conversations\/([^/]+)\/messages$/);
  if (messagesMatch && req.method === 'GET') {
    const messages = getChatMessages(messagesMatch[1]);
    sendJson(res, 200, { messages });
    return true;
  }

  // POST /api/chat/conversations/:id/send — send a message
  const sendMatch = url.pathname.match(/^\/api\/chat\/conversations\/([^/]+)\/send$/);
  if (sendMatch && req.method === 'POST') {
    void (async () => {
      try {
        const body = JSON.parse(await readBody(req)) as { message: string };
        if (!body.message?.trim()) {
          sendJson(res, 400, { error: 'Message is required' });
          return;
        }

        // Persist user message
        insertChatMessage({
          id: randomUUID(),
          conversationId: sendMatch[1],
          role: 'user',
          type: 'text',
          content: body.message,
        });

        const ok = sendMessageToPty(sendMatch[1], body.message);
        if (!ok) {
          sendJson(res, 400, { error: 'Chat session not active' });
          return;
        }
        sendJson(res, 200, { ok: true });
      } catch {
        sendJson(res, 500, { error: 'Failed to send message' });
      }
    })();
    return true;
  }

  // POST /api/chat/conversations/:id/abort — abort current operation
  const abortMatch = url.pathname.match(/^\/api\/chat\/conversations\/([^/]+)\/abort$/);
  if (abortMatch && req.method === 'POST') {
    abortChatPty(abortMatch[1]);
    sendJson(res, 200, { ok: true });
    return true;
  }

  // GET /api/chat/conversations/:id/status — get PTY status
  const statusMatch = url.pathname.match(/^\/api\/chat\/conversations\/([^/]+)\/status$/);
  if (statusMatch && req.method === 'GET') {
    const ptyStatus = getChatPtyStatus(statusMatch[1]);
    sendJson(res, 200, { status: ptyStatus?.status ?? 'unknown', terminalId: ptyStatus?.terminalId });
    return true;
  }

  // GET /api/chat/conversations/search?q=... — search conversations by message content
  if (url.pathname === '/api/chat/conversations/search' && req.method === 'GET') {
    const query = url.searchParams.get('q') ?? '';
    if (query.length < 2) {
      sendJson(res, 200, { results: [] });
      return true;
    }
    const results = searchChatConversations(query, userEmail);
    sendJson(res, 200, { results });
    return true;
  }

  // GET /api/chat/conversations/:id/terminal-id — get terminal ID for Advanced mode
  const termIdMatch = url.pathname.match(/^\/api\/chat\/conversations\/([^/]+)\/terminal-id$/);
  if (termIdMatch && req.method === 'GET') {
    const terminalId = getChatPtyTerminalId(termIdMatch[1]);
    sendJson(res, 200, { terminalId });
    return true;
  }

  return false;
}

/**
 * Encode a project path to Claude's directory name format.
 * Uses encodeWindowsPath on Windows, similar encoding on other platforms.
 */
function encodeProjectDir(projectPath: string): string {
  if (process.platform === 'win32') {
    return encodeWindowsPath(projectPath);
  }
  // Mac/Linux: /Users/foo/bar → -Users-foo-bar
  return projectPath.replace(/\//g, '-');
}

/**
 * Watch the filesystem for a new JSONL session file created by Claude Code.
 * This replaces the old approach of parsing PTY terminal output for session IDs,
 * which doesn't work because Claude Code doesn't output session IDs to the terminal.
 *
 * Instead, we encode the CWD path and poll ~/.claude/projects/{encoded-cwd}/ for
 * new .jsonl files — the same approach used by process-discovery-windows.ts.
 */
function getRealUserHome(): string {
  try {
    const userHomePath = path.join(path.dirname(process.execPath), '..', 'user-home.txt');
    if (fs.existsSync(userHomePath)) {
      return fs.readFileSync(userHomePath, 'utf-8').trim();
    }
  } catch { /* ignore */ }
  return os.homedir();
}

// Track active watchers to prevent duplicates
const activeWatchers = new Map<string, ReturnType<typeof setInterval>>();

export function watchForSessionFile(conversationId: string, cwd: string): void {
  // Stop any existing watcher for this conversation
  const existing = activeWatchers.get(conversationId);
  if (existing) {
    clearInterval(existing);
    activeWatchers.delete(conversationId);
  }
  const realHome = getRealUserHome();
  const claudeHome = process.env['CLAUDE_HOME'] ?? path.join(realHome, '.claude');
  const encodedDir = encodeProjectDir(cwd);
  const sessionsDir = path.join(claudeHome, 'projects', encodedDir);
  let found = false;
  let attempts = 0;
  const maxAttempts = 120; // 2 minute timeout (poll every 500ms)
  // Track files that existed before spawn so we can detect NEW ones
  let preExistingFiles: Set<string> | null = null;

  console.log(`[chat] Watching for session file in: ${sessionsDir} (conversation: ${conversationId})`);

  // Snapshot existing files before Claude Code creates a new one
  try {
    if (fs.existsSync(sessionsDir)) {
      preExistingFiles = new Set(
        fs.readdirSync(sessionsDir).filter(f => f.endsWith('.jsonl'))
      );
      console.log(`[chat] Pre-existing JSONL files: ${preExistingFiles.size}`);
    }
  } catch { /* dir may not exist yet */ }

  const timer = setInterval(() => {
    if (found) {
      clearInterval(timer);
      activeWatchers.delete(conversationId);
      return;
    }

    attempts++;
    if (attempts > maxAttempts) {
      console.log(`[chat] Timed out waiting for session file after ${maxAttempts * 500}ms (conversation: ${conversationId})`);
      clearInterval(timer);
      activeWatchers.delete(conversationId);
      return;
    }

    try {
      if (!fs.existsSync(sessionsDir)) {
        if (attempts % 10 === 0) console.log(`[chat] Dir not found yet: ${sessionsDir} (attempt ${attempts})`);
        return;
      }

      const files = fs.readdirSync(sessionsDir)
        .filter(f => f.endsWith('.jsonl') && !f.includes(':'));

      // Strategy 1: Find a NEW file that didn't exist before spawn
      if (preExistingFiles) {
        for (const f of files) {
          if (!preExistingFiles.has(f)) {
            found = true;
            clearInterval(timer);
            const sessionId = f.replace('.jsonl', '');
            const fullPath = path.join(sessionsDir, f);
            console.log(`[chat] Found NEW session file: ${f} (conversation: ${conversationId})`);
            notifyChatSessionId(conversationId, sessionId, fullPath);
            return;
          }
        }
      }

      // Strategy 2: Find the most recently modified file (within last 60s)
      let bestFile = '';
      let bestMtime = 0;
      const now = Date.now();

      for (const f of files) {
        try {
          const stat = fs.statSync(path.join(sessionsDir, f));
          if (now - stat.mtimeMs < 60_000 && stat.mtimeMs > bestMtime) {
            bestMtime = stat.mtimeMs;
            bestFile = f;
          }
        } catch { /* skip */ }
      }

      if (bestFile) {
        found = true;
        clearInterval(timer);
        const sessionId = bestFile.replace('.jsonl', '');
        const fullPath = path.join(sessionsDir, bestFile);
        console.log(`[chat] Found recently modified session file: ${bestFile} (age: ${Math.round((now - bestMtime) / 1000)}s, conversation: ${conversationId})`);
        notifyChatSessionId(conversationId, sessionId, fullPath);
      }

      // Log progress every 10 attempts
      if (!found && attempts % 10 === 0) {
        console.log(`[chat] Still searching... ${files.length} files in dir, none new/recent (attempt ${attempts}, conversation: ${conversationId})`);
      }
    } catch (err) {
      if (attempts <= 3) {
        console.log(`[chat] Poll error (attempt ${attempts}): ${err instanceof Error ? err.message : err}`);
      }
    }
  }, 500); // Poll every 500ms instead of 1s for faster detection

  activeWatchers.set(conversationId, timer);
}
