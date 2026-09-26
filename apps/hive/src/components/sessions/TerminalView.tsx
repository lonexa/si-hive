import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import type { Terminal } from '@xterm/xterm';
import type { SearchAddon } from '@xterm/addon-search';
import '@xterm/xterm/css/xterm.css';
import { WS_BASE, API_BASE } from '@/lib/api-config';
import { isTouchDevice } from '@/lib/device';
import { extractSessionIdFromArgs } from '@/lib/launch-flags';
import { createTerminal, loadEnhancements, pixelToBufferCell, type ImageLookup } from './terminal-setup';
import { getTheme } from './themes';
import { useTerminalSettings, resolveEffectiveSettings } from '@/stores/terminal-settings-store';
import { Search as SearchIcon, X as CloseIcon, ChevronUp, ChevronDown } from 'lucide-react';
import { attachToolDecorations, type ToolDecorationController } from './tool-decorations';
import TerminalBackdrop from './TerminalBackdrop';
import type { BackdropActivity } from './scenes/types';
import { attachWorkItemDecorations, type WorkItemDecorationController } from './work-item-decorations';
import WorkItemHoverCard from './WorkItemHoverCard';
import { attachFilePathDecorations, buildVsCodeUrl, type FilePathDecorationController } from './file-path-decorations';

export interface TerminalViewHandle {
  /**
   * Write text to the PTY. `raw` skips the bracketed-paste wrapper, which is
   * required for anything that is not the interactive REPL: a plain prompt
   * (e.g. `claude auth login` asking for its code) never enables bracketed
   * paste mode and receives the escape bytes as literal garbage.
   */
  sendInput: (text: string, submit?: boolean, opts?: { raw?: boolean }) => boolean;
  getSelection: () => string;
  /**
   * Kill the PTY server-side. Normal unmount only DETACHES (so navigating away
   * leaves the CLI running), so this is needed when the process itself must be
   * replaced — e.g. relaunching the session under a different account, which
   * changes CLAUDE_CONFIG_DIR and can only take effect on a fresh spawn.
   */
  closePty: () => boolean;
}

// Track which terminal IDs have already had their initial prompt sent.
// Persists across React StrictMode effect re-runs and component re-mounts.
const promptAlreadySent = new Set<string>();
const renameAlreadySent = new Set<string>();

/**
 * Generate a short display name from a prompt string.
 * Takes the first meaningful sentence/phrase, up to 40 chars.
 */
function generateSessionName(prompt: string): string {
  // Strip common prefixes like "Read the file at..." or context paths
  let name = prompt
    .replace(/^Read the file at [^\s]+ for full context on /i, '')
    .replace(/^(Please |Can you |Could you |I need you to )/i, '')
    .replace(/\r?\n.*/s, '') // first line only
    .trim();
  if (name.length > 40) {
    name = name.slice(0, 37) + '...';
  }
  return name;
}

/**
 * Fire-and-forget: send /rename to the Claude session via the server API.
 */
function autoRenameSession(sessionId: string | undefined, prompt: string): void {
  if (!sessionId || renameAlreadySent.has(sessionId)) return;
  // Extract session ID from args (--resume <id>)
  const name = generateSessionName(prompt);
  if (!name) return;
  renameAlreadySent.add(sessionId);
  // Delay to let Claude finish processing the first response
  setTimeout(() => {
    fetch(`${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}/rename`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }).catch(() => { /* non-critical */ });
  }, 15000);
}

type ProviderId = 'claude' | 'gemini' | 'codex';

/** Ready detection patterns and prompt wrapping per provider */
const PROVIDER_CONFIG: Record<ProviderId, { readyPatterns: string[]; useBracketPaste: boolean }> = {
  claude: { readyPatterns: ['/help', 'Tips:', 'tip:'], useBracketPaste: true },
  gemini: { readyPatterns: ['◇', '❯', '✦'], useBracketPaste: true },
  codex: { readyPatterns: ['❯', 'Codex'], useBracketPaste: false },
};

interface TerminalViewProps {
  terminalId: string;
  cwd?: string;
  projectDir?: string;
  command?: string;
  args?: string[];
  /** Prompt to auto-type into the interactive session after it starts */
  initialPrompt?: string;
  /** Which AI provider this terminal is running */
  provider?: ProviderId;
  /**
   * Raw PTY output, as it arrives. Opt-in: used by callers that need to read
   * something out of the stream (the account login reads the OAuth URL, which
   * the PTY hard-wraps and is therefore unsafe to copy by hand).
   */
  onOutput?: (chunk: string) => void;
  /**
   * The account the PTY is ACTUALLY running under, reported by the server when
   * the socket attaches. Ground truth: the identity is fixed in the process
   * environment at spawn time, so this cannot drift from what is really billed.
   */
  onAccountResolved?: (accountId: string) => void;
  /** Which credential identity to run under; omitted = the default account. */
  account?: string;
  /**
   * Called when the server discovers the real Claude session ID for a temp
   * (`new-*`/`handoff-*`) terminal. Lets the parent stabilize the URL so a
   * page reload later resumes the correct session instead of failing with
   * "No conversation found with session ID".
   */
  onSessionIdDiscovered?: (sessionId: string) => void;
}

const TerminalView = forwardRef<TerminalViewHandle, TerminalViewProps>(function TerminalView(
  { terminalId, cwd, projectDir, command, args, initialPrompt, provider = 'claude', account, onOutput, onAccountResolved, onSessionIdDiscovered },
  ref,
) {
  // Latest callback ref so the WS handler always sees the current closure
  // without re-running the effect on every render.
  const onSessionIdDiscoveredRef = useRef(onSessionIdDiscovered);
  onSessionIdDiscoveredRef.current = onSessionIdDiscovered;
  const onOutputRef = useRef(onOutput);
  onOutputRef.current = onOutput;
  const onAccountResolvedRef = useRef(onAccountResolved);
  onAccountResolvedRef.current = onAccountResolved;
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  // Refs the imperative handle reads from. Updated inside the effect once the
  // socket and terminal are alive; cleared on cleanup.
  const wsRef = useRef<WebSocket | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const imageRef = useRef<ImageLookup | null>(null);
  const imagePositionsRef = useRef<Array<{ path: string; lineStart: number; lineEnd: number }>>([]);
  // Image files the CLI read this session (newest first), previewed on hover.
  const hoverImagePathsRef = useRef<string[]>([]);
  const [hoverImage, setHoverImage] = useState<{ path: string; x: number; y: number } | null>(null);
  const toolDecoRef = useRef<ToolDecorationController | null>(null);
  const ambientActivityRef = useRef<BackdropActivity>({ lastOutputAt: 0, lastToolAt: 0, lastToolName: null });
  const webglDisposerRef = useRef<(() => void) | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [expandedImage, setExpandedImage] = useState<string | null>(null);
  const [currentTool, setCurrentTool] = useState<{ name: string; arg: string; startedAt: number } | null>(null);
  const toolTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hoverWi, setHoverWi] = useState<{ id: string; anchor: { x: number; y: number } } | null>(null);
  const hoverDismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wiDecoRef = useRef<WorkItemDecorationController | null>(null);
  const wiScanScheduledRef = useRef(false);
  const filePathDecoRef = useRef<FilePathDecorationController | null>(null);
  // Set when the server had to turn our `--resume` into a fork because a
  // background agent still owns the session (see the spawn handler in
  // server/index.ts). Surfaced so the user knows they're in a copy and not
  // talking to the running agent.
  const [forkedFrom, setForkedFrom] = useState<{ pid: number; name?: string } | null>(null);
  // Snapshot settings once per mount — terminal addon set is fixed for the lifetime of this Terminal instance.
  const settingsSnapshot = useRef(useTerminalSettings.getState());
  // Store props in refs so the effect closure always sees latest values
  // but doesn't re-run when they change (we only connect once per mount)
  const propsRef = useRef({ terminalId, cwd, projectDir, command, args, initialPrompt, provider, account });
  propsRef.current = { terminalId, cwd, projectDir, command, args, initialPrompt, provider, account };

  useImperativeHandle(ref, () => ({
    sendInput: (text: string, submit = false, opts?: { raw?: boolean }) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return false;
      const providerCfg = PROVIDER_CONFIG[propsRef.current.provider ?? 'claude'];
      const useBracket = providerCfg.useBracketPaste && !opts?.raw;
      const data = useBracket ? `\x1b[200~${text}\x1b[201~` : text;
      ws.send(JSON.stringify({ type: 'input', data }));
      if (submit) {
        setTimeout(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'input', data: '\r' }));
          }
        }, 100);
      }
      return true;
    },
    getSelection: () => termRef.current?.getSelection() ?? '',
    closePty: () => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return false;
      ws.send(JSON.stringify({ type: 'close' }));
      return true;
    },
  }), []);

  useEffect(() => {
    if (!containerRef.current) return;

    const { terminalId: id, cwd: cwdVal, projectDir: pdVal, command: cmd, args: cmdArgs, initialPrompt: prompt, provider: prov, account: acct } = propsRef.current;
    const providerCfg = PROVIDER_CONFIG[prov ?? 'claude'];
    // Extract session ID from args for auto-rename, provider-aware
    const claudeSessionId = cmdArgs ? extractSessionIdFromArgs(prov, cmdArgs) : undefined;
    let promptSent = false;
    let outputBuffer = '';
    let promptFallbackTimer: ReturnType<typeof setTimeout> | null = null;
    let isReconnect = false; // Set by 'ready' message from server

    const effSettings = resolveEffectiveSettings(settingsSnapshot.current);
    const themePreset = getTheme(effSettings.theme);
    const { term, fit } = createTerminal({}, themePreset);
    term.open(containerRef.current);
    fit.fit();
    const { search, webglDisposer, image } = loadEnhancements(term, settingsSnapshot.current);
    searchRef.current = search;
    imageRef.current = image;
    webglDisposerRef.current = webglDisposer;
    termRef.current = term;

    // Persistent work-item underline decorations + click-to-card. We scan
    // the buffer after every output chunk; per-line dedup keeps that cheap.
    if (effSettings.workItemCards) {
      wiDecoRef.current = attachWorkItemDecorations(term, {
        onClick: (id, event) => {
          // Anchor the card right above the click.
          setHoverWi({ id, anchor: { x: event.clientX, y: event.clientY } });
        },
      });
      // Schedule an initial scan once the terminal has had a moment to render.
      setTimeout(() => wiDecoRef.current?.scanVisible(), 250);
    }

    if (effSettings.filePathLinks) {
      filePathDecoRef.current = attachFilePathDecorations(term, {
        onClick: (payload) => {
          const url = buildVsCodeUrl(payload);
          // window.location.href would replace the page; a hidden link click
          // launches the registered protocol handler (VS Code) without
          // disturbing the current page.
          const a = document.createElement('a');
          a.href = url;
          a.rel = 'noopener';
          a.style.display = 'none';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        },
      });
      setTimeout(() => filePathDecoRef.current?.scanVisible(), 250);
    }

    if (effSettings.toolDecorations || effSettings.stickyToolBanner || effSettings.toolTimingChips) {
      const wantsBanner = effSettings.stickyToolBanner;
      toolDecoRef.current = attachToolDecorations(term, {
        timingChips: effSettings.toolTimingChips,
        onToolStart: (name, arg) => {
          // Always feed the 3D backdrop so it can flash tool colors even if
          // the sticky banner is off.
          ambientActivityRef.current.lastToolAt = performance.now();
          ambientActivityRef.current.lastToolName = name;
          if (wantsBanner) {
            setCurrentTool({ name, arg, startedAt: performance.now() });
            if (toolTimerRef.current) clearTimeout(toolTimerRef.current);
            // Auto-clear after 15s in case a tool completion line never lands
            // (e.g., interactive tools that don't print a ⎿ result).
            toolTimerRef.current = setTimeout(() => setCurrentTool(null), 15000);
          }
        },
        onToolResult: wantsBanner
          ? () => {
              if (toolTimerRef.current) clearTimeout(toolTimerRef.current);
              toolTimerRef.current = null;
              setCurrentTool(null);
            }
          : undefined,
      });
    }

    const ws = new WebSocket(`${WS_BASE}/ws/terminal/${id}`);
    wsRef.current = ws;

    // Helper to hide the loading overlay
    const hideOverlay = () => {
      if (overlayRef.current) overlayRef.current.style.display = 'none';
    };

    ws.onopen = () => {
      console.log('[terminal] Spawning PTY:', { terminalId: id, provider: prov, command: cmd, cwd: cwdVal });
      const dims = fit.proposeDimensions();
      const enh = settingsSnapshot.current;
      const effective = enh.mode === 'classic'
        ? { inlineImages: false }
        : { inlineImages: enh.inlineImages };
      ws.send(JSON.stringify({
        type: 'spawn',
        cwd: cwdVal ?? undefined,
        projectDir: pdVal ?? undefined,
        cols: dims?.cols ?? 120,
        rows: dims?.rows ?? 30,
        command: cmd ?? undefined,
        args: cmdArgs ?? undefined,
        provider: prov ?? undefined,
        account: acct ?? undefined,
        enhancements: effective,
      }));
      // Show loading overlay while AI CLI starts up
      if (overlayRef.current) overlayRef.current.style.display = 'flex';
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as { type: string; data?: string; code?: number; message?: string; reconnected?: boolean; account?: string; sessionId?: string; terminalId?: string; path?: string; holderPid?: number; holderName?: string };
        switch (msg.type) {
          case 'forked-session': {
            if (msg.holderPid) setForkedFrom({ pid: msg.holderPid, name: msg.holderName });
            break;
          }
          case 'session-id-discovered': {
            if (msg.sessionId) {
              console.log(`[terminal] Session ID discovered: ${msg.sessionId} (was ${id})`);
              onSessionIdDiscoveredRef.current?.(msg.sessionId);
            }
            break;
          }
          case 'inline-image': {
            // Image previews are shown on hover, never written into the
            // terminal: an image drawn only in this browser shifts every row
            // below it out of line with the CLI (duplicate input box, clicks
            // landing off-target). Just remember the file for hover lookup.
            if (msg.path) {
              hoverImagePathsRef.current = [
                msg.path,
                ...hoverImagePathsRef.current.filter((p) => p !== msg.path),
              ].slice(0, 50);
            }
            break;
          }
          case 'output':
            if (msg.data) {
              onOutputRef.current?.(msg.data);
              ambientActivityRef.current.lastOutputAt = performance.now();
              toolDecoRef.current?.noteChunk(msg.data);
              term.write(msg.data, () => {
                if ((wiDecoRef.current || filePathDecoRef.current) && !wiScanScheduledRef.current) {
                  wiScanScheduledRef.current = true;
                  setTimeout(() => {
                    wiScanScheduledRef.current = false;
                    wiDecoRef.current?.scanVisible();
                    filePathDecoRef.current?.scanVisible();
                  }, 120);
                }
              });

              // Detect when the interactive REPL is ready via provider-specific patterns
              // Skip detection on reconnects (server tells us via 'ready' message)
              if (!promptSent && !isReconnect) {
                outputBuffer += msg.data;
                const clean = outputBuffer.replace(/\x1b\[[0-9;?!>]*[a-zA-Z~]|\x1b\][^\x07]*\x07|\x1b[()][0-9A-Z]/g, '');
                const isReady = providerCfg.readyPatterns.some(p => clean.includes(p));
                if (prompt) {
                  console.log(`[terminal] Ready check (${prov}): isReady=${isReady}, patterns=${JSON.stringify(providerCfg.readyPatterns)}, clean=${JSON.stringify(clean.slice(-200))}`);
                }
                if (isReady) {
                  promptSent = true;
                  promptAlreadySent.add(id);
                  outputBuffer = '';
                  hideOverlay();
                  if (promptFallbackTimer) clearTimeout(promptFallbackTimer);
                  // Send prompt if one was provided — use bracket paste for Claude, plain text for others
                  if (prompt) {
                    // Gemini/Codex need more time after ready detection for TUI to initialize
                    const sendDelay = prov === 'claude' ? 300 : 1500;
                    setTimeout(() => {
                      if (ws.readyState === WebSocket.OPEN) {
                        console.log(`[terminal] Sending prompt to ${prov} (delay=${sendDelay}ms, bracketPaste=${providerCfg.useBracketPaste}, promptLen=${prompt.length})`);
                        const data = providerCfg.useBracketPaste
                          ? `\x1b[200~${prompt}\x1b[201~`
                          : prompt;
                        ws.send(JSON.stringify({ type: 'input', data }));
                        setTimeout(() => {
                          if (ws.readyState === WebSocket.OPEN) {
                            ws.send(JSON.stringify({ type: 'input', data: '\r' }));
                          }
                        }, 500);
                        // Auto-rename session based on prompt
                        autoRenameSession(claudeSessionId, prompt);
                      }
                    }, sendDelay);
                  }
                }
              }
            }
            break;
          case 'exit':
            term.write(`\r\n\x1b[90m[Process exited with code ${msg.code}]\x1b[0m\r\n`);
            break;
          case 'error':
            term.write(`\r\n\x1b[31m[Error: ${msg.message}]\x1b[0m\r\n`);
            break;
          case 'ready':
            if (msg.account) onAccountResolvedRef.current?.(msg.account);
            console.log(`[terminal] Ready message (${prov}): reconnected=${msg.reconnected}, promptAlreadySent=${promptAlreadySent.has(id)}, promptSent=${promptSent}, hasPrompt=${!!prompt}`);
            // Server tells us whether this is a reconnect to an existing PTY.
            // React StrictMode double-fires effects: the first mount spawns the PTY,
            // cleanup closes the WebSocket, and the second mount reconnects. We use
            // the module-level `promptAlreadySent` set to distinguish StrictMode
            // re-mounts (prompt not yet sent) from genuine reconnects (prompt already sent).
            if (msg.reconnected) {
              // Server confirmed the PTY was already alive — the AI CLI is
              // running. Always drop the "Starting…" overlay; the user is
              // navigating into an existing session, not bootstrapping a
              // new one. Suppress the prompt-send path too unless we have a
              // fresh `initialPrompt` to deliver from a launch flow.
              isReconnect = true;
              promptSent = true;
              hideOverlay();
              // The PTY may have been started at another size (e.g. from the
              // phone view); claim this terminal's size.
              try {
                const dims = fit.proposeDimensions();
                if (dims && !isTouchDevice()) ws.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }));
              } catch { /* ignore */ }
              if (promptFallbackTimer) {
                clearTimeout(promptFallbackTimer);
                promptFallbackTimer = null;
              }
            } else if (!promptSent) {
              // Fresh spawn or StrictMode re-mount — set up fallback timer
              promptFallbackTimer = setTimeout(() => {
                console.log(`[terminal] Fallback timer fired (${prov}): promptSent=${promptSent}, wsReady=${ws.readyState === WebSocket.OPEN}, hasPrompt=${!!prompt}`);
                if (!promptSent && ws.readyState === WebSocket.OPEN) {
                  promptSent = true;
                  promptAlreadySent.add(id);
                  hideOverlay();
                  if (prompt) {
                    console.log(`[terminal] Fallback sending prompt to ${prov} (bracketPaste=${providerCfg.useBracketPaste}, promptLen=${prompt.length})`);
                    const data = providerCfg.useBracketPaste
                      ? `\x1b[200~${prompt}\x1b[201~`
                      : prompt;
                    ws.send(JSON.stringify({ type: 'input', data }));
                    setTimeout(() => {
                      if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ type: 'input', data: '\r' }));
                      }
                    }, 500);
                    autoRenameSession(claudeSessionId, prompt);
                  }
                }
              }, 8000);
            }
            break;
        }
      } catch { /* ignore */ }
    };

    ws.onclose = () => {
      term.write('\r\n\x1b[90m[Disconnected]\x1b[0m\r\n');
    };

    // Enable Ctrl+C (copy when selected), Ctrl+V (paste), and Ctrl+F (search) browser clipboard behavior
    term.attachCustomKeyEventHandler((event) => {
      // Ctrl+C: if there's a selection, let browser copy it; otherwise send SIGINT
      if (event.ctrlKey && event.key === 'c' && event.type === 'keydown') {
        if (term.hasSelection()) {
          navigator.clipboard.writeText(term.getSelection());
          term.clearSelection();
          return false; // prevent xterm from handling it
        }
        return true; // no selection → send SIGINT as normal
      }
      // Ctrl+V: read the clipboard and hand it to xterm.
      if (event.ctrlKey && event.key === 'v' && event.type === 'keydown') {
        event.preventDefault(); // prevent browser paste so xterm onData does not double-fire
        navigator.clipboard.readText().then((text) => {
          if (!text) return;
          // term.paste() adds the bracketed-paste wrapper ONLY when the running
          // application actually turned that mode on (DECSET 2004). Wrapping it
          // unconditionally, as this used to, silently corrupts input to anything
          // that is not the REPL: `claude auth login` never enables the mode, so it
          // received the escape bytes as literal text and the paste did nothing.
          termRef.current?.paste(text);
        }).catch((err) => {
          // Clipboard reads can be denied by the browser. Say so, rather than
          // leaving the user pressing Ctrl+V at a terminal that ignores them.
          console.warn('[terminal] clipboard read failed:', err);
          termRef.current?.writeln(
            '\r\n\x1b[33m[SI Hive] Clipboard read blocked by the browser - use right-click paste.\x1b[0m',
          );
        });
        return false;
      }
      // Ctrl+F: open search overlay (only when SearchAddon loaded)
      if (event.ctrlKey && event.key === 'f' && event.type === 'keydown' && searchRef.current) {
        event.preventDefault();
        setSearchOpen(true);
        setTimeout(() => searchInputRef.current?.focus(), 0);
        return false;
      }
      return true;
    });

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }));
      }
    });

    const resizeObserver = new ResizeObserver(() => {
      try {
        fit.fit();
        const dims = fit.proposeDimensions();
        // Touch devices never resize the shared PTY: their page height changes
        // whenever the browser bar hides, which squeezed the desktop's session.
        if (dims && ws.readyState === WebSocket.OPEN && !isTouchDevice()) {
          ws.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }));
        }
      } catch { /* ignore */ }
    });

    resizeObserver.observe(containerRef.current);

    return () => {
      if (promptFallbackTimer) clearTimeout(promptFallbackTimer);
      resizeObserver.disconnect();
      ws.close();
      if (webglDisposerRef.current) webglDisposerRef.current();
      webglDisposerRef.current = null;
      term.dispose();
      if (wsRef.current === ws) wsRef.current = null;
      if (termRef.current === term) termRef.current = null;
      searchRef.current = null;
      imageRef.current = null;
      imagePositionsRef.current = [];
      toolDecoRef.current?.dispose();
      toolDecoRef.current = null;
      if (toolTimerRef.current) {
        clearTimeout(toolTimerRef.current);
        toolTimerRef.current = null;
      }
      if (hoverDismissTimerRef.current) {
        clearTimeout(hoverDismissTimerRef.current);
        hoverDismissTimerRef.current = null;
      }
      wiDecoRef.current?.dispose();
      wiDecoRef.current = null;
      filePathDecoRef.current?.dispose();
      filePathDecoRef.current = null;
    };
    // Only re-connect if the terminal ID changes (i.e., navigating to a different session)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminalId]);

  const providerNames: Record<string, string> = { claude: 'Claude Code', gemini: 'Gemini CLI', codex: 'Codex CLI' };
  const displayName = providerNames[provider] ?? provider ?? 'AI';

  function runSearch(direction: 'next' | 'prev', queryOverride?: string) {
    const addon = searchRef.current;
    if (!addon) return;
    const q = queryOverride ?? searchQuery;
    if (!q) return;
    const opts = { regex: false, wholeWord: false, caseSensitive: false };
    if (direction === 'next') addon.findNext(q, opts);
    else addon.findPrevious(q, opts);
  }

  const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;

  function sendToTerminal(text: string) {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    // Bracket-paste wrap so multi-line / special chars stay literal in TUIs.
    const data = `\x1b[200~${text}\x1b[201~`;
    ws.send(JSON.stringify({ type: 'input', data }));
  }

  async function uploadDroppedFile(file: File): Promise<string | null> {
    try {
      const buf = await file.arrayBuffer();
      const res = await fetch(
        `${API_BASE}/api/sessions/${encodeURIComponent(terminalId)}/dropfile?name=${encodeURIComponent(file.name)}`,
        { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: buf },
      );
      if (!res.ok) {
        console.warn('[terminal] dropfile upload failed:', res.status);
        return null;
      }
      const data = await res.json() as { ok?: boolean; path?: string };
      return data.path ?? null;
    } catch (err) {
      console.warn('[terminal] dropfile upload error:', err);
      return null;
    }
  }

  async function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    if (!settingsSnapshot.current.dragDrop || settingsSnapshot.current.mode === 'classic') return;
    e.preventDefault();
    setIsDragOver(false);
    const dt = e.dataTransfer;
    // 1) URL dropped from browser — type it as-is.
    const urlText = dt.getData('text/uri-list') || dt.getData('text/plain');
    if (!dt.files.length && urlText && /^https?:\/\//i.test(urlText.trim())) {
      sendToTerminal(urlText.trim());
      return;
    }
    // 2) Files — upload and type the resulting path(s).
    const shiftHeld = e.shiftKey;
    const files = Array.from(dt.files);
    if (files.length === 0) return;
    const paths: string[] = [];
    for (const file of files) {
      const absPath = await uploadDroppedFile(file);
      if (absPath) paths.push(absPath);
    }
    if (paths.length === 0) return;
    if (shiftHeld && paths.length === 1 && IMAGE_EXT_RE.test(paths[0])) {
      sendToTerminal(`Look at this image: ${paths[0]}`);
    } else {
      sendToTerminal(paths.join(' '));
    }
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    if (!settingsSnapshot.current.dragDrop || settingsSnapshot.current.mode === 'classic') return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!isDragOver) setIsDragOver(true);
  }

  function handleDragLeave(e: React.DragEvent<HTMLDivElement>) {
    if (e.currentTarget === e.target) setIsDragOver(false);
  }

  // Show a floating preview while the mouse is over a line naming an image
  // file the CLI read (e.g. "Read(C:\...\shot.png)").
  function handleHoverMove(e: React.MouseEvent<HTMLDivElement>) {
    const term = termRef.current;
    const paths = hoverImagePathsRef.current;
    const cell = term && paths.length > 0 ? pixelToBufferCell(term, { clientX: e.clientX, clientY: e.clientY }) : null;
    const line = term && cell ? (term.buffer.active.getLine(cell.y)?.translateToString(true) ?? '').toLowerCase() : '';
    const hit = line
      ? paths.find((p) => {
          const name = p.split(/[\\/]/).pop()?.toLowerCase();
          return !!name && line.includes(name);
        })
      : undefined;
    if (!hit) {
      if (hoverImage) setHoverImage(null);
      return;
    }
    setHoverImage({ path: hit, x: e.clientX, y: e.clientY });
  }

  async function handleTerminalClick(e: React.MouseEvent<HTMLDivElement>) {
    const term = termRef.current;
    const imageLookup = imageRef.current;
    if (!term || !imageLookup) return;
    // Don't hijack text-selection clicks — only fire when there's no selection.
    if (term.hasSelection()) return;
    const cell = pixelToBufferCell(term, { clientX: e.clientX, clientY: e.clientY });
    if (!cell) return;
    let canvas: HTMLCanvasElement | undefined;
    try {
      canvas = imageLookup.getImageAtBufferCell(cell.x, cell.y);
    } catch { canvas = undefined; }
    if (!canvas) return;
    // First try the per-image position map (set when each image was injected).
    // This matches the click cell against the actual buffer-line range each
    // injected image occupies, so multi-image sessions resolve to the correct
    // file. Falls back to the server's newest-first list if no entry matches.
    const positionalHit = imagePositionsRef.current.find(
      (entry) => cell.y >= entry.lineStart && cell.y <= entry.lineEnd,
    );
    if (positionalHit) {
      setExpandedImage(`${API_BASE}/api/file-preview?path=${encodeURIComponent(positionalHit.path)}`);
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/api/sessions/${encodeURIComponent(terminalId)}/injected-images`);
      if (res.ok) {
        const data = await res.json() as { paths?: string[] };
        const newest = data.paths?.[0];
        if (newest) {
          setExpandedImage(`${API_BASE}/api/file-preview?path=${encodeURIComponent(newest)}`);
          return;
        }
      }
    } catch { /* fall back to canvas snapshot */ }
    try {
      const dataUrl = canvas.toDataURL('image/png');
      setExpandedImage(dataUrl);
    } catch (err) {
      console.warn('[terminal] Failed to capture inline image:', err);
    }
  }

  useEffect(() => {
    if (!expandedImage) return;
    function onKey(ev: KeyboardEvent) {
      if (ev.key === 'Escape') setExpandedImage(null);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expandedImage]);

  // Subscribe so users can toggle the canvas on/off live without re-spawning
  // the session. Settings store updates → this component re-renders → the
  // <TerminalBackdrop3D> element is added or removed.
  const ambientPref = useTerminalSettings((s) => s.ambientCanvas);
  const modePref = useTerminalSettings((s) => s.mode);
  const themeId = useTerminalSettings((s) => s.theme);
  const sceneId = useTerminalSettings((s) => s.terminalScene);
  const showAmbient = modePref !== 'classic' && ambientPref;
  const themePreset = getTheme(themeId);

  // WebGL renderer doesn't honor `allowTransparency`, so it paints an opaque
  // background over the ambient canvas. When the user toggles ambient ON
  // after the terminal has already mounted with WebGL, dispose the addon —
  // xterm falls back to its DOM renderer which respects transparency, and
  // the existing buffer redraws into it cleanly.
  useEffect(() => {
    if (showAmbient && webglDisposerRef.current) {
      console.log('[ambient] Disposing WebGL renderer so transparency works');
      webglDisposerRef.current();
      webglDisposerRef.current = null;
    }
  }, [showAmbient]);

  return (
    <div
      className={`relative w-full h-full min-h-[200px] ${showAmbient ? 'hive-ambient' : ''} ${themePreset.effect === 'scanlines' ? 'hive-scanlines' : ''}`}
      style={{ backgroundColor: themePreset.backdrop.bg }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={(e) => { void handleDrop(e); }}
      onClick={(e) => { void handleTerminalClick(e); }}
      onMouseMove={handleHoverMove}
      onMouseLeave={() => setHoverImage(null)}
    >
      {/*
        xterm.js paints its own background color; we always want the wrapper
        (which carries the active theme's bg) to show through. The scanline
        overlay sits above the terminal at low opacity for the CRT themes.
      */}
      <style>{`
        .hive-ambient .xterm,
        .hive-ambient .xterm-viewport,
        .hive-ambient .xterm-screen,
        .hive-ambient .xterm-helper-textarea {
          background-color: transparent !important;
          background: transparent !important;
        }
        .hive-ambient .xterm-rows > div {
          background-color: transparent !important;
        }
        .hive-scanlines::after {
          content: '';
          position: absolute;
          inset: 0;
          pointer-events: none;
          z-index: 40;
          background: repeating-linear-gradient(
            to bottom,
            rgba(0, 0, 0, 0) 0px,
            rgba(0, 0, 0, 0) 2px,
            rgba(0, 0, 0, 0.18) 3px,
            rgba(0, 0, 0, 0) 4px
          );
          mix-blend-mode: multiply;
        }
      `}</style>
      {showAmbient && (
        <>
          <TerminalBackdrop activityRef={ambientActivityRef} sceneId={sceneId} themePreset={themePreset} />
          <div
            className="pointer-events-none absolute top-2 left-2 z-20 rounded-md bg-zinc-900/80 px-2 py-0.5 text-[10px] font-medium text-zinc-300 shadow"
            aria-hidden="true"
          >
            ambient &#x25CF;
          </div>
        </>
      )}
      <div ref={containerRef} className="relative z-10 w-full h-full" />
      {currentTool && !searchOpen && <ToolBanner tool={currentTool} />}
      {forkedFrom && !searchOpen && (
        <div className="absolute top-2 right-2 z-30 flex max-w-sm items-start gap-2 rounded-md border border-amber-500/40 bg-amber-950/90 px-3 py-2 text-[11px] leading-snug text-amber-100 shadow-lg">
          <span>
            Still running as a background agent
            {forkedFrom.name ? <> (<span className="font-mono">{forkedFrom.name}</span>, pid {forkedFrom.pid})</> : <> (pid {forkedFrom.pid})</>},
            {' '}so Claude can't attach. Opened a <span className="font-medium">forked copy</span> with the full history —
            the agent keeps running untouched.
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); setForkedFrom(null); }}
            className="shrink-0 rounded p-0.5 text-amber-300/70 hover:bg-amber-500/20 hover:text-amber-100"
            title="Dismiss"
          >
            <CloseIcon className="h-3 w-3" />
          </button>
        </div>
      )}
      {hoverWi && (
        <div
          onMouseEnter={() => {
            if (hoverDismissTimerRef.current) {
              clearTimeout(hoverDismissTimerRef.current);
              hoverDismissTimerRef.current = null;
            }
          }}
          onMouseLeave={() => setHoverWi(null)}
        >
          <WorkItemHoverCard
            id={hoverWi.id}
            anchor={hoverWi.anchor}
            onClose={() => setHoverWi(null)}
          />
        </div>
      )}
      <div
        ref={overlayRef}
        className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3"
        style={{ display: 'none', backgroundColor: 'rgba(10, 10, 10, 0.85)' }}
      >
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-600 border-t-zinc-300" />
        <span className="text-sm text-zinc-400">Starting {displayName}...</span>
      </div>
      {isDragOver && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center border-2 border-dashed border-blue-400/60 bg-blue-500/10">
          <span className="rounded-md bg-zinc-900/90 px-3 py-1.5 text-sm text-zinc-100 shadow-lg">
            Drop file to upload &nbsp;·&nbsp; hold <kbd className="rounded bg-zinc-700 px-1 text-[10px]">Shift</kbd> for image prompt
          </span>
        </div>
      )}
      {hoverImage && (
        <div
          className="pointer-events-none fixed z-50 rounded-md border border-border bg-zinc-900/95 p-1 shadow-2xl"
          style={{
            left: Math.min(hoverImage.x + 16, window.innerWidth - 496),
            top: Math.min(hoverImage.y + 16, window.innerHeight - 376),
          }}
        >
          <img
            src={`${API_BASE}/api/file-preview?path=${encodeURIComponent(hoverImage.path)}`}
            alt=""
            className="block max-h-[360px] max-w-[480px] object-contain"
          />
        </div>
      )}
      {expandedImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-6"
          onClick={() => setExpandedImage(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Image preview"
        >
          <img
            src={expandedImage}
            alt="Expanded inline preview"
            className="max-h-full max-w-full rounded-md shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            type="button"
            aria-label="Close preview"
            onClick={() => setExpandedImage(null)}
            className="absolute top-4 right-4 rounded-md bg-zinc-900/80 px-2 py-1 text-zinc-100 hover:bg-zinc-800"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
          <a
            href={expandedImage}
            download="hive-inline-image.png"
            onClick={(e) => e.stopPropagation()}
            className="absolute bottom-4 right-4 rounded-md bg-zinc-900/80 px-3 py-1.5 text-xs text-zinc-100 hover:bg-zinc-800"
          >
            Download
          </a>
        </div>
      )}
      {searchOpen && (
        <div
          className="absolute top-2 right-2 z-20 flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-900/95 px-2 py-1 shadow-lg"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <SearchIcon className="h-3.5 w-3.5 text-zinc-500" />
          <input
            ref={searchInputRef}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                runSearch(e.shiftKey ? 'prev' : 'next');
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setSearchOpen(false);
                setSearchQuery('');
                try { searchRef.current?.clearDecorations(); } catch { /* ignore */ }
                termRef.current?.focus();
              }
            }}
            placeholder="Find..."
            className="w-40 bg-transparent text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
            aria-label="Search terminal"
          />
          <button
            type="button"
            onClick={() => runSearch('prev')}
            className="text-zinc-400 hover:text-zinc-100"
            aria-label="Previous match"
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => runSearch('next')}
            className="text-zinc-400 hover:text-zinc-100"
            aria-label="Next match"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => {
              setSearchOpen(false);
              setSearchQuery('');
              try { searchRef.current?.clearDecorations(); } catch { /* ignore */ }
              termRef.current?.focus();
            }}
            className="text-zinc-400 hover:text-zinc-100"
            aria-label="Close search"
          >
            <CloseIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
});

export default TerminalView;

const TOOL_BANNER_COLORS: Record<string, { bg: string; ring: string }> = {
  Read:      { bg: 'bg-blue-500/15',     ring: 'ring-blue-400/40' },
  Edit:      { bg: 'bg-green-500/15',    ring: 'ring-green-400/40' },
  Write:     { bg: 'bg-amber-500/15',    ring: 'ring-amber-400/40' },
  Bash:      { bg: 'bg-violet-500/15',   ring: 'ring-violet-400/40' },
  Grep:      { bg: 'bg-cyan-500/15',     ring: 'ring-cyan-400/40' },
  Glob:      { bg: 'bg-cyan-500/15',     ring: 'ring-cyan-400/40' },
  Task:      { bg: 'bg-pink-500/15',     ring: 'ring-pink-400/40' },
  WebFetch:  { bg: 'bg-teal-500/15',     ring: 'ring-teal-400/40' },
  WebSearch: { bg: 'bg-teal-500/15',     ring: 'ring-teal-400/40' },
};

function ToolBanner({ tool }: { tool: { name: string; arg: string; startedAt: number } }) {
  const colors = TOOL_BANNER_COLORS[tool.name] ?? { bg: 'bg-zinc-700/30', ring: 'ring-zinc-500/40' };
  // Truncate long args (e.g., huge prompts in Task(...)) so the banner stays small.
  const shortArg = tool.arg.length > 60 ? tool.arg.slice(0, 57) + '…' : tool.arg;
  return (
    <div
      className={`pointer-events-none absolute top-2 right-2 z-20 flex items-center gap-2 rounded-md px-2 py-1 text-[11px] font-medium text-zinc-100 shadow-lg ring-1 ${colors.bg} ${colors.ring}`}
      aria-live="polite"
      aria-label={`Running ${tool.name}`}
    >
      <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current opacity-80" />
      <span className="font-semibold">{tool.name}</span>
      {shortArg && <span className="text-zinc-300/90 max-w-[40ch] truncate">{shortArg}</span>}
    </div>
  );
}
