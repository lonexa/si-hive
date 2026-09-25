import type WebSocket from 'ws';
import { randomUUID } from 'node:crypto';
import { getChatPtyStatus, sendMessageToPty, abortChatPty, approveChatPty, rejectChatPty } from './chat-pty-manager.js';
import { startJsonlBridge, stopJsonlBridge, type ChatMessage } from './jsonl-bridge.js';
import { insertChatMessage, updateChatConversation, getChatConversation, getChatMessages } from '../db.js';

export interface ChatWsConnection {
  conversationId: string;
  ws: WebSocket;
}

const activeConnections = new Map<string, ChatWsConnection>();

const stripAnsi = (s: string) =>
  s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');

/**
 * Handle a new chat WebSocket connection for a conversation.
 */
export function handleChatWsConnection(conversationId: string, ws: WebSocket): void {
  console.log(`[chat-ws] WebSocket connected for conversation: ${conversationId}`);

  // Close any existing connection for this conversation
  const existing = activeConnections.get(conversationId);
  if (existing && existing.ws.readyState === 1) {
    existing.ws.close();
  }

  const conn: ChatWsConnection = { conversationId, ws };
  activeConnections.set(conversationId, conn);

  // Send current status
  const chatPty = getChatPtyStatus(conversationId);
  console.log(`[chat-ws] PTY status: ${chatPty ? chatPty.status : 'NOT FOUND'}, sessionId: ${chatPty?.claudeSessionId ?? 'none'}`);
  if (chatPty) {
    sendToClient(ws, 'status', { status: chatPty.status });

    // Set up PTY output handler for typing indicator.
    // Only send typing events when Claude is actively working — not during
    // startup, trust prompts, or idle state. This prevents typing dots from
    // overriding the 'ready' status after trust approval.
    chatPty.onOutput = (data: string) => {
      const stripped = stripAnsi(data);
      if (stripped.trim() && chatPty.status === 'working') {
        sendToClient(ws, 'typing', { text: stripped });
      }
      // When ready is detected by the PTY manager, notify the client
      if (chatPty.status === 'ready') {
        sendToClient(ws, 'status', { status: 'ready' });
      }
    };

    chatPty.onExit = (code: number) => {
      sendToClient(ws, 'status', { status: 'exited', exitCode: code });
      updateChatConversation(conversationId, { status: 'exited' });
    };

    // Set up approval callbacks
    chatPty.onApprovalNeeded = (approval) => {
      sendToClient(ws, 'needs_approval', {
        description: approval.description,
        rawText: approval.rawText,
      });
      sendToClient(ws, 'status', { status: 'needs_input' });
    };

    chatPty.onApprovalResolved = () => {
      sendToClient(ws, 'approval_resolved', {});
      sendToClient(ws, 'status', { status: 'working' });
    };

    // If there's already a pending approval, send it
    if (chatPty.pendingApproval) {
      sendToClient(ws, 'needs_approval', {
        description: chatPty.pendingApproval.description,
        rawText: chatPty.pendingApproval.rawText,
      });
    }

    // Start JSONL bridge if we have a session ID
    if (chatPty.claudeSessionId) {
      startJsonlBridge(
        conversationId,
        chatPty.claudeSessionId,
        (msg) => handleNewMessage(conversationId, msg),
        undefined,
        chatPty.jsonlFilePath,
      );
    }
  }

  // Handle incoming messages from client
  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(String(raw)) as { type: string; message?: string; toolId?: string };

      switch (msg.type) {
        case 'send': {
          if (!msg.message?.trim()) break;
          const userMsg: ChatMessage = {
            id: randomUUID(),
            conversationId,
            role: 'user',
            type: 'text',
            content: msg.message,
            timestamp: new Date().toISOString(),
          };
          // Persist user message
          insertChatMessage(userMsg);
          // Client already shows user message optimistically — no echo needed
          // Send to PTY
          const sent = sendMessageToPty(conversationId, msg.message);
          console.log(`[chat-ws] sendMessageToPty returned: ${sent}`);
          // Update status
          sendToClient(ws, 'status', { status: 'working' });
          break;
        }

        case 'approve': {
          console.log(`[chat-ws] Approve received for conversation: ${conversationId}`);
          const approved = approveChatPty(conversationId);
          console.log(`[chat-ws] approveChatPty returned: ${approved}`);
          sendToClient(ws, 'approval_resolved', {});
          // Send 'ready' after approval so the UI shows a clean input area
          // (not typing dots). Claude Code will update to 'working' once
          // the user sends a message.
          sendToClient(ws, 'status', { status: 'ready' });
          break;
        }

        case 'reject': {
          rejectChatPty(conversationId);
          sendToClient(ws, 'approval_resolved', {});
          sendToClient(ws, 'status', { status: 'working' });
          break;
        }

        case 'abort': {
          abortChatPty(conversationId);
          sendToClient(ws, 'status', { status: 'ready' });
          break;
        }
      }
    } catch (err) {
      console.error(`[chat-ws] Message error:`, err);
    }
  });

  ws.on('close', () => {
    // Clean up all handlers
    if (chatPty) {
      chatPty.onOutput = undefined;
      chatPty.onExit = undefined;
      chatPty.onApprovalNeeded = undefined;
      chatPty.onApprovalResolved = undefined;
    }
    stopJsonlBridge(conversationId);
    activeConnections.delete(conversationId);
  });

  ws.on('error', (err) => {
    console.error(`[chat-ws] WebSocket error:`, err);
    activeConnections.delete(conversationId);
  });
}

/**
 * Handle a new message from the JSONL bridge.
 */
function handleNewMessage(conversationId: string, msg: ChatMessage): void {
  // Persist to SQLite
  insertChatMessage({
    id: msg.id,
    conversationId: msg.conversationId,
    role: msg.role,
    type: msg.type,
    content: msg.content,
    toolName: msg.toolName,
    toolId: msg.toolId,
    model: msg.model,
  });

  // Send to connected client
  const conn = activeConnections.get(conversationId);
  if (conn && conn.ws.readyState === 1) {
    console.log(`[chat-ws] Delivering ${msg.role}/${msg.type} message to client (id: ${msg.id}, content: ${(msg.content || '').substring(0, 40)})`);
    sendToClient(conn.ws, 'message', msg);

    // Update status based on role
    if (msg.role === 'assistant' && msg.type === 'text') {
      sendToClient(conn.ws, 'status', { status: 'ready' });
      // Also update PTY session so reconnections get correct status
      const chatPty = getChatPtyStatus(conversationId);
      if (chatPty) chatPty.status = 'ready';

      // Auto-generate title from the first user message if still "New Chat"
      tryAutoTitle(conversationId, conn.ws);
    } else if (msg.role === 'assistant' && msg.type === 'tool_use') {
      sendToClient(conn.ws, 'tool_progress', {
        tool: msg.toolName,
        detail: friendlyToolName(msg.toolName ?? ''),
      });
    }
  } else {
    console.log(`[chat-ws] Cannot deliver message — conn: ${!!conn}, readyState: ${conn?.ws?.readyState}`);
  }
}

/**
 * Send a typed message to a WebSocket client.
 */
function sendToClient(ws: WebSocket, type: string, payload: object): void {
  if (ws.readyState !== 1) return;
  try {
    // Use 'event' instead of 'type' for the envelope to avoid collision with
    // ChatMessage.type ('text', 'tool_use', etc.) which would overwrite the
    // envelope type during spread and cause the client to silently drop messages.
    ws.send(JSON.stringify({ event: type, ...payload }));
  } catch { /* ignore */ }
}

/** Track which conversations have already had auto-title applied. */
const autoTitledConversations = new Set<string>();

/**
 * Auto-generate a conversation title from the first user message.
 * Only runs once per conversation when the title is still "New Chat".
 */
function tryAutoTitle(conversationId: string, ws: WebSocket): void {
  if (autoTitledConversations.has(conversationId)) return;
  autoTitledConversations.add(conversationId);

  const conv = getChatConversation(conversationId);
  if (!conv || conv.title !== 'New Chat') return;

  const messages = getChatMessages(conversationId);
  const firstUserMsg = messages.find((m) => m.role === 'user' && m.type === 'text');
  if (!firstUserMsg) return;

  // Generate title: first sentence or first 50 chars, cleaned up
  let title = firstUserMsg.content.trim();
  // Take first sentence (period, question mark, exclamation, or newline)
  const sentenceEnd = title.search(/[.?!\n]/);
  if (sentenceEnd > 0 && sentenceEnd < 60) {
    title = title.slice(0, sentenceEnd);
  } else if (title.length > 50) {
    title = title.slice(0, 50).replace(/\s+\S*$/, '');
  }
  title = title.trim();
  if (!title) return;

  updateChatConversation(conversationId, { title });
  sendToClient(ws, 'title_updated', { conversationId, title });
}

/**
 * Map tool names to user-friendly descriptions.
 */
function friendlyToolName(toolName: string): string {
  const map: Record<string, string> = {
    Read: 'Reading file',
    Write: 'Creating file',
    Edit: 'Editing file',
    Bash: 'Running command',
    Grep: 'Searching code',
    Glob: 'Finding files',
    WebSearch: 'Searching the web',
    WebFetch: 'Fetching web page',
    Agent: 'Delegating to agent',
    TaskCreate: 'Creating task',
    TaskUpdate: 'Updating task',
  };
  return map[toolName] ?? toolName;
}

/**
 * Notify a connected chat client about a session ID discovery.
 */
export function notifyChatSessionId(conversationId: string, sessionId: string, filePath?: string): void {
  console.log(`[chat-ws] Session ID discovered: ${sessionId} for conversation: ${conversationId}, filePath: ${filePath ?? 'none'}`);
  const chatPty = getChatPtyStatus(conversationId);
  if (chatPty) {
    chatPty.claudeSessionId = sessionId;
    if (filePath) chatPty.jsonlFilePath = filePath;
  }

  updateChatConversation(conversationId, { claudeSessionId: sessionId });

  // Start JSONL bridge now that we have a session ID
  const conn = activeConnections.get(conversationId);
  console.log(`[chat-ws] WebSocket connection active: ${!!conn}, starting JSONL bridge`);
  if (conn) {
    startJsonlBridge(
      conversationId,
      sessionId,
      (msg) => {
        console.log(`[chat-ws] JSONL bridge message: role=${msg.role}, type=${msg.type}, content=${msg.content.substring(0, 80)}...`);
        handleNewMessage(conversationId, msg);
      },
      undefined,
      filePath,
    );
  }
}
