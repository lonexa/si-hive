import { spawnPty, getPtySession, destroyPty, writeToPty, writeToPtyWithActivation, clearPtyBuffer, type PtySession } from '../terminal-pty.js';
import { getProvider } from '../providers/registry.js';
import type { ProviderId } from '../types.js';
import fs from 'node:fs';
import { hivePath } from '../../../../packages/shared/src/server/paths.js';

const DEBUG_LOG = hivePath('chat-pty-debug.log');
function debugLog(msg: string) {
  try { fs.appendFileSync(DEBUG_LOG, `[${new Date().toISOString()}] ${msg}\n`); } catch { /* */ }
}

export interface PendingApproval {
  /** The tool or action Claude wants to perform */
  description: string;
  /** Raw prompt text from the terminal */
  rawText: string;
  /** Whether this is a folder trust prompt (TUI select menu, not y/n) */
  isTrustPrompt?: boolean;
}

export interface ChatPtySession {
  conversationId: string;
  terminalId: string;
  cwd: string;
  status: 'starting' | 'ready' | 'working' | 'needs_input' | 'done' | 'exited';
  /** Whether the initial ready state was detected (Tips:/Welcome back) */
  readyDetected?: boolean;
  /** Timestamp when pendingApproval was set (for grace period before auto-clear) */
  _approvalTimestamp?: number;
  claudeSessionId?: string;
  /** Full path to the JSONL session file once discovered */
  jsonlFilePath?: string;
  lastActivity: string;
  /** Stripped ANSI output for typing indicator */
  typingBuffer: string;
  /** Current pending permission/approval request, if any */
  pendingApproval: PendingApproval | null;
  /** Callback when PTY produces output */
  onOutput?: (data: string) => void;
  /** Callback when PTY exits */
  onExit?: (code: number) => void;
  /** Callback when a permission approval is needed */
  onApprovalNeeded?: (approval: PendingApproval) => void;
  /** Callback when approval is resolved (user responded or Claude moved on) */
  onApprovalResolved?: () => void;
  /** Callback when trust approval is resolved — used to restart file watcher */
  onTrustResolved?: () => void;
  /** Clear the permission detection buffer (called after approval/rejection) */
  clearPermissionBuffer?: () => void;
}

const chatSessions = new Map<string, ChatPtySession>();

/** Strip ALL terminal escape sequences — CSI (with ?/= modifiers), OSC, SS3, and control chars */
const stripAnsi = (s: string) =>
  s
    .replace(/\x1b\[[?=]?[0-9;]*[a-zA-Z~]/g, '')   // CSI sequences including ?25h, =1h, etc.
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')  // OSC sequences
    .replace(/\x1b[()][0-9A-Za-z]/g, '')             // Character set selection
    .replace(/\x1b[78DEHM]/g, '')                     // SS2/SS3 and other 2-char sequences
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');  // Control characters (keep \n, \r, \t)

/**
 * Spawn a hidden Claude Code PTY for a chat conversation.
 */
export async function spawnChatPty(
  conversationId: string,
  cwd: string,
  providerId: ProviderId = 'claude',
  opts?: { permissionMode?: string; model?: string },
): Promise<ChatPtySession> {
  const terminalId = `chat-${conversationId}`;
  const provider = getProvider(providerId);

  const command = provider.processName();
  const args = provider.interactiveArgs?.({
    permissionMode: opts?.permissionMode ?? 'default',
    model: opts?.model,
  }) ?? [];

  const chatSession: ChatPtySession = {
    conversationId,
    terminalId,
    cwd,
    status: 'starting',
    lastActivity: new Date().toISOString(),
    typingBuffer: '',
    pendingApproval: null,
  };

  chatSessions.set(conversationId, chatSession);

  const ptySession = await spawnPty(terminalId, cwd, 120, 30, command, args, providerId);

  // Hook into PTY output for typing indicator, ready detection, and permission detection
  // Patterns include spaceless variants because TUI cursor positioning strips spaces
  // Claude Code v2.1.x no longer prints Tips:/"What can I help" at startup —
  // detect the interactive status bar instead (drawn once the input is live).
  const readyPatterns = [
    '/help', 'Tips:', 'Tipsforgetting', 'WhatcanIhelp', 'Welcomeback',
    '? for shortcuts', '?forshortcuts',
    'shift+tab to cycle', 'shift+tabtocycle',
  ];
  let readyDetected = false;

  // Detect folder trust prompt and surface it as an approval in the chat UI.
  // Claude Code's TUI select menus don't respond to programmatic \r in the PTY,
  // so we let the user accept it through the chat approval mechanism.
  let trustDone = false;
  let trustRawLen = 0;
  const trustListener = ptySession.pty.onData((rawData: string) => {
    if (trustDone) return;
    trustRawLen += rawData.length;

    const clean = stripAnsi(rawData);
    const fullClean = stripAnsi(chatSession.typingBuffer);

    // Match with and without spaces (TUI cursor positioning strips spaces)
    const patterns = [
      'trust this folder', 'trustthisfolder',
      'Trust this folder', 'Trustthisfolder',
      'safety check', 'safetycheck',
    ];
    for (const pat of patterns) {
      if (clean.includes(pat) || fullClean.includes(pat)) {
        trustDone = true;
        console.log(`[chat-pty] Trust prompt detected, surfacing as approval for conversation ${conversationId}`);
        // Surface as a pending approval so the user can accept in the chat UI
        const approval: PendingApproval = {
          description: 'Claude Code needs permission to access this folder',
          rawText: 'Do you trust this folder? Claude Code will be able to read, edit, and execute files here.',
          isTrustPrompt: true,
        };
        chatSession.pendingApproval = approval;
        chatSession.status = 'needs_input';
        chatSession.onApprovalNeeded?.(approval);
        trustListener.dispose();
        return;
      }
    }

    if (trustRawLen > 50000) {
      trustDone = true;
      trustListener.dispose();
    }
  });

  // Permission prompt detection — use simple string includes with spaceless
  // variants, same approach as trust prompt detection. TUI cursor positioning
  // breaks up words with escape sequences so regex on stripped text fails.
  const permissionPhrases = [
    'Do you want to proceed', 'Doyouwanttoproceed',
    'Do you want to allow', 'Doyouwanttoallow',
    'Do you want to continue', 'Doyouwanttocontinue',
    'Do you want to run', 'Doyouwanttorun',
    'Do you want to execute', 'Doyouwanttoexecute',
    'Tab to reject', 'Tabtoreject',
    'Dismiss to analyze', 'Dismisstoanalyze',
    'Yes, let me', 'Yesletme',
    'requires approval', 'requiresapproval',
    'command requires approval', 'commandrequiresapproval',
    'approve this action', 'approvethisaction',
    'Allow once', 'Allowonce',
    'Allow always', 'Allowalways',
    '(Y)es / (N)o', '(Y)es/(N)o',
    '[Y/n]', '[y/N]',
    'Yes / No', 'Yes/No',
    'Press Enter to allow', 'PressEntertoallow',
    'wants to read', 'wantstoread',
    'wants to write', 'wantstowrite',
    'wants to execute', 'wantstoexecute',
    'wants to run', 'wantstorun',
    'wants to create', 'wantstocreate',
    'wants to delete', 'wantstodelete',
    'wants to modify', 'wantstomodify',
  ];

  // Track a sliding window for permission detection
  let permissionBuffer = '';
  let lastPtyDataTime = Date.now();
  chatSession.clearPermissionBuffer = () => { permissionBuffer = ''; };

  ptySession.pty.onData((data: string) => {
    chatSession.lastActivity = new Date().toISOString();
    lastPtyDataTime = Date.now();
    const stripped = stripAnsi(data);
    // Also strip any remaining non-printable chars for matching
    const cleanStripped = stripped.replace(/[^\x20-\x7e\n\r\t]/g, '');
    chatSession.typingBuffer += cleanStripped;
    permissionBuffer += cleanStripped;

    // Keep typing buffer to last 2KB
    if (chatSession.typingBuffer.length > 2048) {
      chatSession.typingBuffer = chatSession.typingBuffer.slice(-2048);
    }
    // Keep permission buffer to last 4KB for multi-line prompts
    if (permissionBuffer.length > 4096) {
      permissionBuffer = permissionBuffer.slice(-4096);
    }

    // Detect ready state
    if (!readyDetected) {
      for (const pattern of readyPatterns) {
        if (chatSession.typingBuffer.includes(pattern)) {
          readyDetected = true;
          chatSession.readyDetected = true;
          chatSession.status = 'ready';
          chatSession.typingBuffer = '';
          debugLog(`READY detected (pattern: "${pattern}") conv=${conversationId}`);
          setTimeout(() => {
            try {
              ptySession.pty.write('\x01\x0b');
            } catch { /* */ }
          }, 500);
          break;
        }
      }
    }

    // Periodically dump buffer for debugging (every 50 chunks after ready)
    if ((readyDetected || chatSession.readyDetected) && cleanStripped.length > 5) {
      debugLog(`CHUNK [${cleanStripped.length} chars]: ${cleanStripped.slice(0, 200).replace(/\n/g, '\\n')}`);
    }

    // Detect permission prompts using simple string includes (same as trust detection)
    if ((readyDetected || chatSession.readyDetected) && !chatSession.pendingApproval) {
      const bufferNoSpaces = permissionBuffer.replace(/\s+/g, '');
      const chunkNoSpaces = cleanStripped.replace(/\s+/g, '');

      for (const phrase of permissionPhrases) {
        if (permissionBuffer.includes(phrase) || bufferNoSpaces.includes(phrase) || chunkNoSpaces.includes(phrase)) {
          debugLog(`PERMISSION DETECTED (phrase: "${phrase}") conv=${conversationId}`);
          const lines = permissionBuffer.trim().split('\n');
          const lastLines = lines.slice(-8).join('\n').trim();

          const approval: PendingApproval = {
            description: 'Claude needs your permission to proceed',
            rawText: lastLines || phrase,
          };
          chatSession.pendingApproval = approval;
          chatSession._approvalTimestamp = Date.now();
          chatSession.status = 'needs_input';
          chatSession.onApprovalNeeded?.(approval);
          permissionBuffer = '';
          break;
        }
      }
    }

    // Only clear pending approval when the user explicitly approves/rejects
    // via the chat UI (handled in approveChatPty/rejectChatPty), or when
    // the user responds in the Advanced terminal tab and Claude moves on.
    // Detect the latter by seeing a checkmark AFTER at least 10 seconds
    // (meaning the user answered in the terminal, not part of the prompt).
    if (chatSession.pendingApproval) {
      const approvalAge = Date.now() - (chatSession._approvalTimestamp ?? Date.now());
      if (approvalAge > 10000 && (stripped.includes('✓') || stripped.includes('✔'))) {
        chatSession.pendingApproval = null;
        chatSession._approvalTimestamp = undefined;
        chatSession.status = 'working';
        chatSession.onApprovalResolved?.();
        permissionBuffer = '';
      }
    }

    chatSession.onOutput?.(data);
  });

  ptySession.pty.onExit(({ exitCode }: { exitCode: number }) => {
    chatSession.status = 'exited';
    chatSession.onExit?.(exitCode);
    if (quiescenceTimer) clearInterval(quiescenceTimer);
  });

  // Fallback: quiescence-based permission detection.
  // Uses lastPtyDataTime tracked directly in the onData handler above (not
  // chatSession.onOutput which gets overwritten by chat-ws.ts).
  // Checks 'ready' status too since chatSession.status stays 'ready' during work.
  const quiescenceTimer = setInterval(() => {
    if (chatSession.status === 'exited') { clearInterval(quiescenceTimer); return; }
    if (chatSession.pendingApproval) return;
    if (!readyDetected && !chatSession.readyDetected) return;

    const silentMs = Date.now() - lastPtyDataTime;
    if (silentMs < 3000) return;

    // PTY has been silent for 3+ seconds — check for prompt hints.
    // Strip the persistent "bypass permissions on (shift+tab to cycle)"
    // status-bar text first — its "permission" substring false-positives
    // every quiescence check in bypassPermissions sessions.
    const buf = permissionBuffer.replace(/\s+/g, '').toLowerCase().replace(/bypasspermissionson/g, '');
    const promptHints = ['proceed', 'approve', 'permission', 'yesno', 'y/n', 'allowdeny',
      'tabtoreject', 'dismisstoanalyze', 'allowonce', 'allowalways', 'wanttoproceed',
      'wanttoallow', 'wanttorun', 'wanttoexecute', 'requiresapproval'];
    const hasHint = promptHints.some((h) => buf.includes(h));
    if (hasHint) {
      console.log(`[chat-pty] Quiescence permission detected for ${conversationId} (silent ${silentMs}ms, buf sample: ${buf.slice(-200)})`);
      const lines = permissionBuffer.trim().split('\n').filter((l) => l.trim());
      const approval: PendingApproval = {
        description: 'Claude needs your permission to proceed',
        rawText: lines.slice(-8).join('\n').trim() || 'A command requires your approval.',
      };
      chatSession.pendingApproval = approval;
      chatSession.status = 'needs_input';
      chatSession.onApprovalNeeded?.(approval);
      permissionBuffer = '';
    } else if (silentMs > 30000) {
      // After 30 seconds of silence with no prompt hints, stop checking
      // to avoid spamming logs. Will resume when new data arrives.
      return;
    }
  }, 2000);

  return chatSession;
}

/**
 * Send a user message to the chat PTY.
 * On Windows ConPTY, the Enter key (\r) must be sent as a SEPARATE write
 * from the message content — sending them together causes ConPTY to
 * deliver the text but swallow the Enter.
 */
export function sendMessageToPty(conversationId: string, message: string): boolean {
  const chatSession = chatSessions.get(conversationId);
  if (!chatSession) return false;

  const terminalId = chatSession.terminalId;
  const ptySession = getPtySession(terminalId);
  if (!ptySession || ptySession.exited) return false;

  console.log(`[chat-pty] Sending message to PTY for ${conversationId}: "${message.substring(0, 50)}..." (status: ${chatSession.status})`);

  // If Claude isn't ready yet, queue the message and send when ready
  if (chatSession.status !== 'ready' && chatSession.status !== 'working') {
    console.log(`[chat-pty] Claude not ready (${chatSession.status}), queueing message`);
    // Wait for ready, checking every 500ms for up to 30 seconds
    let attempts = 0;
    const queueTimer = setInterval(() => {
      attempts++;
      if (chatSession.status === 'ready' || chatSession.status === 'working') {
        clearInterval(queueTimer);
        chatSession.readyDetected = true;
        console.log(`[chat-pty] Claude now ready, sending queued message (readyDetected=true)`);
        doSendMessage(ptySession, chatSession, message);
      } else if (attempts > 60) {
        clearInterval(queueTimer);
        console.log(`[chat-pty] Gave up waiting for ready, sending anyway`);
        doSendMessage(ptySession, chatSession, message);
      }
    }, 500);
  } else {
    doSendMessage(ptySession, chatSession, message);
  }

  chatSession.status = 'working';
  chatSession.lastActivity = new Date().toISOString();

  return true;
}

/**
 * Actually send the message to the PTY.
 * Skip bracket paste mode — ConPTY on Windows doesn't process the trailing
 * \r after bracket paste end marker. Instead, write the text, then WAIT for
 * the TUI to echo the tail of the message back before sending Enter — an
 * Enter that lands while the TUI is still consuming the text submits a
 * PARTIAL message and leaves the rest in the input box (seen in production:
 * a pointer prompt split into two fragments).
 */
function doSendMessage(ptySession: PtySession, chatSession: ChatPtySession, message: string): void {
  // Capture the TUI's echo so we know when the full text has been consumed
  let echoed = '';
  const echoListener = ptySession.pty.onData((d: string) => {
    echoed += stripAnsi(d).replace(/[^\x20-\x7e]/g, '');
    if (echoed.length > 40000) echoed = echoed.slice(-20000);
  });

  // Write message text using direct pty.write (text always works)
  try {
    ptySession.pty.write(message);
    console.log(`[chat-pty] Wrote message text to PTY`);
  } catch (err) {
    console.log(`[chat-pty] Write message failed: ${err}`);
    echoListener.dispose();
    return;
  }

  // Send Enter using activated write (fake WebSocket consumer to wake ConPTY)
  // ConPTY in session 0 drops \r unless a terminal client is consuming output.
  // Wait for the input box to echo the message tail first (spaceless compare —
  // the TUI wraps and re-spaces); fall back after 4s (long/multiline pastes
  // get collapsed to "[Pasted text]" and never echo their tail).
  const termId = chatSession.terminalId;
  const tail = message.slice(-24).replace(/\s+/g, '');
  const startedAt = Date.now();
  const sendEnter = () => {
    echoListener.dispose();
    const ok = writeToPtyWithActivation(termId, '\r');
    console.log(`[chat-pty] Sent Enter via activated write: ${ok} (waited ${Date.now() - startedAt}ms for echo)`);
    // Retry Enter once — if the TUI swallowed the first \r the message sits
    // in the input box forever. A second \r on an empty input is a no-op.
    setTimeout(() => {
      const ok2 = writeToPtyWithActivation(termId, '\r');
      console.log(`[chat-pty] Sent Enter retry via activated write: ${ok2}`);
    }, 1500);
  };
  const waitForEcho = () => {
    const echoNoSpace = echoed.replace(/\s+/g, '');
    if ((tail.length > 0 && echoNoSpace.includes(tail)) || Date.now() - startedAt > 4000) {
      sendEnter();
    } else {
      setTimeout(waitForEcho, 150);
    }
  };
  setTimeout(waitForEcho, 250);

  // Trigger file watcher restart — Claude Code creates the JSONL file
  // when processing the first message, not at startup
  if (!chatSession.claudeSessionId) {
    console.log(`[chat-pty] First message, triggering file watcher for ${chatSession.conversationId}`);
    chatSession.onTrustResolved?.();
  }

  chatSession.status = 'working';
  chatSession.typingBuffer = '';
}

/**
 * Get the chat PTY session status.
 */
export function getChatPtyStatus(conversationId: string): ChatPtySession | undefined {
  return chatSessions.get(conversationId);
}

/**
 * Get the underlying PTY session for attaching xterm.js (Advanced mode).
 */
export function getChatPtyTerminalId(conversationId: string): string | undefined {
  return chatSessions.get(conversationId)?.terminalId;
}

/**
 * Destroy the chat PTY session.
 */
export function destroyChatPty(conversationId: string): void {
  const chatSession = chatSessions.get(conversationId);
  if (chatSession) {
    destroyPty(chatSession.terminalId);
    chatSessions.delete(conversationId);
  }
}

/**
 * Approve a pending permission/trust request.
 * Trust prompts (TUI select menu) need special handling — try multiple input
 * methods since the TUI framework may not respond to simple \r.
 */
export function approveChatPty(conversationId: string): boolean {
  console.log(`[chat-pty] approveChatPty called for ${conversationId}`);
  const chatSession = chatSessions.get(conversationId);
  if (!chatSession) {
    console.log(`[chat-pty] No chat session found for ${conversationId}`);
    return false;
  }
  if (!chatSession.pendingApproval) {
    console.log(`[chat-pty] No pending approval for ${conversationId}`);
    return false;
  }

  const isTrust = chatSession.pendingApproval.isTrustPrompt;
  const ptySession = getPtySession(chatSession.terminalId);
  if (!ptySession || ptySession.exited) {
    console.log(`[chat-pty] PTY not found or exited for ${chatSession.terminalId}`);
    return false;
  }

  console.log(`[chat-pty] Approving ${isTrust ? 'trust' : 'permission'} for conversation ${conversationId}`);

  const termId = chatSession.terminalId;
  console.log(`[chat-pty] Approving ${isTrust ? 'trust' : 'permission'}: termId=${termId}, exited=${ptySession.exited}`);

  // On Windows, ConPTY may not process pty.write() input unless output is
  // actively flowing. Force a resize to flush ConPTY buffers, then write
  // the input on the next tick to ensure the event loop processes pending I/O.
  try { ptySession.pty.resize(ptySession.pty.cols, ptySession.pty.rows); } catch { /* */ }

  if (isTrust) {
    // Trust prompt is a TUI select menu — Enter confirms the pre-selected option.
    // Use activated write to wake ConPTY in session 0.
    setTimeout(() => {
      const ok = writeToPtyWithActivation(chatSession.terminalId, '\r');
      console.log(`[chat-pty] Sent Enter for trust via activated write: ${ok}`);
    }, 300);
    // After trust is accepted, the TUI leaves artifact text in the input
    // (e.g. "es, I trust this folder"). Send Ctrl+U after a delay to clear it.
    setTimeout(() => {
      try {
        ptySession.pty.write('\x15'); // Ctrl+U: kill line
        console.log(`[chat-pty] Sent Ctrl+U to clear input after trust`);
      } catch { /* */ }
    }, 2000);
    // Send another clear after Claude fully starts
    setTimeout(() => {
      try {
        ptySession.pty.write('\x01\x0b'); // Ctrl+A + Ctrl+K: move to start, kill to end
      } catch { /* */ }
    }, 4000);
  } else {
    // Permission prompt is a y/n text input — send 'y' then Enter separately
    try { ptySession.pty.write('y'); } catch { /* */ }
    setTimeout(() => {
      try { ptySession.pty.write('\r'); } catch { /* */ }
    }, 150);
  }

  const wasTrust = chatSession.pendingApproval?.isTrustPrompt;
  chatSession.pendingApproval = null;
  chatSession._approvalTimestamp = undefined;
  // After trust approval, set to 'starting' (not 'working') so the chat UI
  // doesn't show typing dots. Clear ALL buffers to remove trust prompt artifacts
  // like the "1." selection text that leaks into Claude's input.
  chatSession.status = wasTrust ? 'starting' : 'working';
  chatSession.typingBuffer = '';
  chatSession.clearPermissionBuffer?.();
  if (wasTrust) {
    clearPtyBuffer(chatSession.terminalId);
  }
  chatSession.onApprovalResolved?.();
  if (wasTrust) {
    console.log(`[chat-pty] Trust resolved, triggering file watcher restart`);
    chatSession.onTrustResolved?.();
  }
  return true;
}

/**
 * Reject a pending permission/trust request.
 * Trust prompts need Escape; permission prompts need 'n' + Enter.
 */
export function rejectChatPty(conversationId: string): boolean {
  const chatSession = chatSessions.get(conversationId);
  if (!chatSession?.pendingApproval) return false;

  const isTrust = chatSession.pendingApproval.isTrustPrompt;
  const input = isTrust ? '\x1b' : 'n\r'; // Esc for trust, 'n' for permissions
  const ok = writeToPty(chatSession.terminalId, input);
  if (ok) {
    chatSession.pendingApproval = null;
    chatSession._approvalTimestamp = undefined;
    chatSession.status = 'working';
    chatSession.typingBuffer = '';
    chatSession.clearPermissionBuffer?.();
    chatSession.onApprovalResolved?.();
  }
  return ok;
}

/**
 * Send abort (Ctrl+C) to the chat PTY.
 */
export function abortChatPty(conversationId: string): boolean {
  const chatSession = chatSessions.get(conversationId);
  if (!chatSession) return false;
  return writeToPty(chatSession.terminalId, '\x03');
}

/**
 * List all active chat PTY sessions.
 */
export function getAllChatPtySessions(): ChatPtySession[] {
  return Array.from(chatSessions.values());
}
