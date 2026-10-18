import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Terminal } from '@xterm/xterm';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowDown, ArrowLeft, ChevronDown, ChevronRight, Monitor, Repeat, Send, Square, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { API_BASE, WS_BASE } from '@/lib/api-config';
import type { ProviderId } from '@/lib/launch-flags';
import { useAutoGrow, useKeyboardViewport } from '@/hooks/useMobileKeyboard';

/**
 * Phone view of a session. The desktop owns the terminal; the phone never
 * renders or resizes it (a shared terminal can only have one size, and every
 * resize made the CLI redraw badly on the desktop). Instead it shows the
 * conversation from the session transcript, a peek at the bottom of the live
 * screen, the menu's options as buttons while the CLI is asking something,
 * and a text box that types into the same running session.
 */

interface TranscriptMessage {
  role: string;
  type: string;
  content: unknown;
  timestamp: string;
  toolName?: string;
}

type Item =
  | { kind: 'text'; key: string; role: string; text: string }
  | { kind: 'question'; key: string; text: string }
  | { kind: 'tools'; key: string; tools: TranscriptMessage[] }
  | { kind: 'note'; key: string; text: string };

interface Props {
  sessionId: string;
  title?: string;
  cwd?: string;
  projectDir?: string;
  command?: string;
  args?: string[];
  provider?: ProviderId;
  account?: string;
}

const NAV_KEYS: { label: string; data: string }[] = [
  { label: '↑', data: '\x1b[A' },
  { label: '↓', data: '\x1b[B' },
  { label: 'Tab', data: '\t' },
  { label: 'Enter', data: '\r' },
];
const FALLBACK_OPTIONS = ['1', '2', '3', '4'].map((n) => ({ num: n, label: n, current: false }));
const ESC = '\x1b';
const SHIFT_TAB = '\x1b[Z';
const PEEK_LINES = 14;
// Tools that put a menu on screen and wait for the person to pick.
const INPUT_TOOLS = new Set(['AskUserQuestion', 'ExitPlanMode']);

interface Menu {
  /** Screen lines from the question down to the footer. */
  lines: string[];
  options: { num: string; label: string; current: boolean }[];
  /** Number of the free-text option ("Type something."), if the menu has one. */
  typeOption?: string;
}

// Optional box border, optional cursor, then "N. label". Claude draws the
// cursor as ❯, Codex as ›.
const OPTION_RE = /^[\s│┃|]*(?:([❯›>])\s*)?(\d+)\.\s+(.*?)[\s│┃|]*$/;

/**
 * Find a choice menu on screen (permission prompt, AskUserQuestion, plan
 * approval): a cursor on a numbered option plus at least one other numbered
 * option. Questions with several described options run 15+ lines, so this
 * scans the whole screen, not just the peek.
 */
function findMenu(screenLines: string[]): Menu | null {
  let cursor = -1;
  for (let i = screenLines.length - 1; i >= Math.max(0, screenLines.length - 30); i--) {
    const m = OPTION_RE.exec(screenLines[i]);
    if (m?.[1]) { cursor = i; break; }
  }
  if (cursor === -1) return null;
  // The menu's options: numbered lines above the cursor, with indented
  // descriptions and blank lines between them. Stop at the question or a rule.
  let start = cursor;
  for (let i = cursor - 1; i >= Math.max(0, cursor - 30); i--) {
    const line = screenLines[i];
    if (OPTION_RE.test(line)) start = i;
    else if (line.trim() && !/^[\s│┃|]{3,}\S/.test(line)) break;
  }
  const byNum = new Map<string, { num: string; label: string; current: boolean }>();
  for (let i = start; i < screenLines.length; i++) {
    const m = OPTION_RE.exec(screenLines[i]);
    if (m) byNum.set(m[2], { num: m[2], label: m[3], current: !!m[1] });
  }
  if (byNum.size < 2) return null;
  // Show the question above the options too, back to the rule that opens the menu.
  let top = start;
  while (top > 0 && start - top < 12 && !/^\s*[─━-]{10,}/.test(screenLines[top - 1])) top--;
  const options = [...byNum.values()];
  const typeOption = options.find((o) => /^(\[.\]\s*)?Type something/i.test(o.label))?.num;
  return { lines: screenLines.slice(top), options, typeOption };
}

// Claude's footer names the mode it's in ("⏸ plan mode on (shift+tab to
// cycle)"); the default mode shows nothing.
const MODE_RE = /(plan mode|accept edits|auto-accept edits|bypass permissions|auto mode) on/i;
const MODE_LABELS: Record<string, string> = {
  'plan mode': 'Plan',
  'accept edits': 'Accept edits',
  'auto-accept edits': 'Accept edits',
  'bypass permissions': 'Bypass',
  'auto mode': 'Auto',
};

function findMode(screenLines: string[]): string {
  for (let i = screenLines.length - 1; i >= Math.max(0, screenLines.length - 8); i--) {
    const m = MODE_RE.exec(screenLines[i]);
    if (m) return MODE_LABELS[m[1].toLowerCase()] ?? m[1];
  }
  return 'Default';
}

/** The question text from an AskUserQuestion call, for the chat list. */
function questionText(m: TranscriptMessage): string {
  const c = (m.content ?? {}) as { questions?: { question?: string; options?: { label?: string }[] }[]; plan?: string };
  if (m.toolName === 'ExitPlanMode') return typeof c.plan === 'string' ? c.plan : 'Plan ready for approval';
  return (c.questions ?? [])
    .map((q) => [`**${q.question ?? ''}**`, ...(q.options ?? []).map((o, i) => `${i + 1}. ${o.label ?? ''}`)].join('\n'))
    .join('\n\n');
}

function toolSummary(m: TranscriptMessage): string {
  const c = (m.content ?? {}) as Record<string, unknown>;
  const detail = [c.description, c.command, c.file_path, c.pattern, c.prompt, c.url]
    .find((v): v is string => typeof v === 'string' && v.length > 0) ?? '';
  const name = m.toolName ?? 'Tool';
  return detail ? `${name}: ${detail.split('\n')[0]}` : name;
}

/** Group runs of tool calls into one collapsible row; drop empty messages. */
function toItems(messages: TranscriptMessage[]): Item[] {
  const items: Item[] = [];
  messages.forEach((m, i) => {
    if (m.type === 'tool_use' && m.toolName && INPUT_TOOLS.has(m.toolName)) {
      const text = questionText(m);
      if (text) items.push({ kind: 'question', key: `q${i}`, text });
    } else if (m.type === 'tool_use') {
      const last = items[items.length - 1];
      if (last?.kind === 'tools') last.tools.push(m);
      else items.push({ kind: 'tools', key: `t${i}`, tools: [m] });
    } else if (typeof m.content === 'string' && m.content.trim()) {
      // Harness-injected "user" turns (reminders, notifications, messages from
      // background agents) aren't something the person typed: show a note.
      const text = m.role === 'user' ? m.content.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim() : m.content;
      if (!text) return;
      if (m.role === 'user' && (/^<[a-z-]+[\s>]/.test(text) || /^Another Claude session sent a message/.test(text) || /^\[Request interrupted/.test(text))) {
        items.push({ kind: 'note', key: `n${i}`, text: text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() });
      } else {
        items.push({ kind: 'text', key: `m${i}`, role: m.role, text });
      }
    }
  });
  return items;
}

const MARKDOWN_CLASSES =
  'prose prose-sm prose-invert max-w-none break-words [&_pre]:bg-black/40 [&_pre]:rounded-md [&_pre]:p-2 [&_pre]:text-xs [&_pre]:overflow-x-auto [&_code]:text-xs [&_code]:bg-black/30 [&_code]:px-1 [&_code]:rounded [&_a]:text-primary [&_a]:underline [&_table]:block [&_table]:overflow-x-auto [&_table]:text-xs [&_th]:px-2 [&_td]:px-2 [&_p]:my-1.5 [&_ul]:my-1.5 [&_ol]:my-1.5 [&_li]:my-0.5 [&_h1]:text-base [&_h2]:text-base [&_h3]:text-sm';

function ToolsRow({ tools }: { tools: TranscriptMessage[] }) {
  const [open, setOpen] = useState(false);
  const last = tools[tools.length - 1];
  return (
    <div className="text-[12px] text-muted-foreground">
      <button type="button" className="flex w-full items-start gap-1.5 py-1 text-left" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
        <Wrench className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 truncate">
          {tools.length === 1 ? toolSummary(last) : `${tools.length} steps · ${toolSummary(last)}`}
        </span>
      </button>
      {open && (
        <div className="ml-5 space-y-1 border-l border-border pl-2">
          {tools.map((t, i) => <div key={i} className="break-all">{toolSummary(t)}</div>)}
        </div>
      )}
    </div>
  );
}

export default function MobileSessionView({ sessionId, title, cwd, projectDir, command, args, provider, account }: Props) {
  useKeyboardViewport();
  const navigate = useNavigate();
  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
  const [connected, setConnected] = useState(false);
  const [peek, setPeek] = useState<string[]>([]);
  const [peekOpen, setPeekOpen] = useState(false);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [text, setText] = useState('');
  const [typing, setTyping] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useAutoGrow(inputRef, text, [typing]);
  const [atBottom, setAtBottom] = useState(true);
  const wsRef = useRef<WebSocket | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  const loadTranscript = useCallback(() => {
    fetch(`${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}/transcript`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : { messages: [] }))
      .then((d: { messages?: TranscriptMessage[] }) => setMessages(d.messages ?? []))
      .catch(() => { /* keep what we have */ });
  }, [sessionId]);

  // Live connection: attach to (or start) the session's terminal. Output feeds
  // an off-screen terminal emulator so we can show the bottom of the screen.
  useEffect(() => {
    loadTranscript();
    const screen = new Terminal({ cols: 120, rows: 40, scrollback: 0, allowProposedApi: true });
    let peekTimer: ReturnType<typeof setTimeout> | null = null;
    let transcriptTimer: ReturnType<typeof setTimeout> | null = null;
    const refreshPeek = () => {
      peekTimer = null;
      const buf = screen.buffer.active;
      const lines: string[] = [];
      for (let y = 0; y < screen.rows; y++) lines.push(buf.getLine(buf.baseY + y)?.translateToString(true) ?? '');
      while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
      setPeek(lines);
      setMenu(findMenu(lines));
    };
    const onActivity = () => {
      if (!peekTimer) peekTimer = setTimeout(refreshPeek, 250);
      if (!transcriptTimer) transcriptTimer = setTimeout(() => { transcriptTimer = null; loadTranscript(); }, 2000);
    };

    let closed = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const connect = () => {
      const ws = new WebSocket(`${WS_BASE}/ws/terminal/${sessionId}`);
      wsRef.current = ws;
      ws.onopen = () => {
        // Spawn is only used if the session isn't running yet; an existing
        // PTY is reattached as-is. The phone never sends resizes.
        ws.send(JSON.stringify({ type: 'spawn', cwd, projectDir, cols: 120, rows: 40, command, args, provider, account }));
      };
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as { type: string; data?: string; cols?: number; rows?: number };
          if (msg.type === 'ready') setConnected(true);
          else if (msg.type === 'size' && msg.cols && msg.rows) { screen.resize(msg.cols, msg.rows); onActivity(); }
          else if (msg.type === 'output' && msg.data) { screen.write(msg.data); onActivity(); }
          else if (msg.type === 'exit') setConnected(false);
        } catch { /* ignore */ }
      };
      ws.onclose = () => {
        setConnected(false);
        if (!closed) retry = setTimeout(connect, 3000);
      };
    };
    connect();

    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      if (peekTimer) clearTimeout(peekTimer);
      if (transcriptTimer) clearTimeout(transcriptTimer);
      wsRef.current?.close();
      wsRef.current = null;
      screen.dispose();
    };
    // Connection params are fixed for the life of the view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const items = useMemo(() => toItems(messages), [messages]);
  // The transcript says Claude is waiting on a question even when the menu
  // couldn't be read off the screen: still offer the keys.
  const pendingQuestion = useMemo(() => {
    const last = messages[messages.length - 1];
    return last?.type === 'tool_use' && !!last.toolName && INPUT_TOOLS.has(last.toolName);
  }, [messages]);
  const asking = !!menu || pendingQuestion;

  const scrollToBottom = () => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    stickToBottom.current = true;
    setAtBottom(true);
  };

  // Keep the list pinned to the newest message unless the user scrolled up.
  useEffect(() => {
    if (stickToBottom.current) scrollToBottom();
  }, [items]);

  const sendRaw = (data: string) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'input', data }));
  };

  const sendMessage = () => {
    const value = text.trim();
    if (!value || !connected) return;
    // Paste as one block so newlines don't submit early, then press Enter.
    const type = () => {
      sendRaw(provider === 'codex' ? value : `\x1b[200~${value}\x1b[201~`);
      setTimeout(() => sendRaw('\r'), 150);
    };
    // A menu ignores typing (and Enter would pick the highlighted option).
    // Answer through its free-text option, or dismiss the menu and say it.
    if (menu?.typeOption) { sendRaw(menu.typeOption); setTimeout(type, 250); }
    else if (menu) { sendRaw(ESC); setTimeout(type, 500); }
    else type();
    setText('');
    scrollToBottom();
  };

  // Shift+Tab cycles Claude's permission modes (default, accept edits, plan, …).
  const canCycleMode = !provider || provider === 'claude';
  const mode = useMemo(() => findMode(peek), [peek]);

  const screenRef = useRef<HTMLPreElement>(null);
  const showScreen = asking || peekOpen;
  const screenLines = menu ? menu.lines : peek.slice(-PEEK_LINES);
  useEffect(() => {
    const el = screenRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [screenLines.length, showScreen]);

  return (
    // Full-screen over the app chrome: every pixel matters on a phone. Sized
    // to what the on-screen keyboard leaves visible.
    <div className="fixed inset-x-0 top-[var(--vv-top,0px)] z-40 flex h-[var(--vv-height,100dvh)] flex-col bg-background">
      <div className="shrink-0 flex items-center gap-2 border-b border-border px-2 py-1.5 bg-card">
        <Button variant="ghost" size="sm" className="h-9 w-9 p-0" onClick={() => ((window.history.state as { idx?: number } | null)?.idx ? navigate(-1) : navigate('/sessions'))} aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{title || sessionId.slice(0, 8)}</div>
        <span className={cn('flex items-center gap-1 text-[11px]', connected ? 'text-green-400' : 'text-muted-foreground')}>
          <span className={cn('h-2 w-2 rounded-full', connected ? 'bg-green-400' : 'bg-muted-foreground')} />
          {connected ? 'Live' : 'Connecting…'}
        </span>
      </div>

      <div className="relative flex-1 min-h-0">
        <div
          ref={listRef}
          className="h-full overflow-y-auto overscroll-contain px-3 py-3 space-y-3"
          onScroll={(e) => {
            const el = e.currentTarget;
            const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
            stickToBottom.current = bottom;
            if (bottom !== atBottom) setAtBottom(bottom);
          }}
        >
          {items.length === 0 && <div className="py-8 text-center text-xs text-muted-foreground">No messages yet.</div>}
          {items.map((it) =>
            it.kind === 'tools' ? (
              <ToolsRow key={it.key} tools={it.tools} />
            ) : it.kind === 'question' ? (
              <div key={it.key} className={cn(MARKDOWN_CLASSES, 'rounded-lg border border-yellow-500/40 bg-yellow-500/5 px-3 py-2 text-sm text-foreground')}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{it.text}</ReactMarkdown>
              </div>
            ) : it.kind === 'note' ? (
              <div key={it.key} className="truncate text-center text-[11px] italic text-muted-foreground">{it.text}</div>
            ) : it.role === 'user' ? (
              <div key={it.key} className="ml-auto w-fit max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm text-primary-foreground">
                {it.text}
              </div>
            ) : (
              <div key={it.key} className={cn(MARKDOWN_CLASSES, 'text-sm text-foreground')}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{it.text}</ReactMarkdown>
              </div>
            ),
          )}
        </div>
        {!atBottom && (
          <button
            type="button"
            onClick={scrollToBottom}
            className="absolute bottom-3 right-3 flex items-center gap-1 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-foreground shadow-lg"
          >
            <ArrowDown className="h-3.5 w-3.5" /> Latest
          </button>
        )}
      </div>

      {showScreen && screenLines.length > 0 && (
        <div className="shrink-0 border-t border-border bg-black">
          {asking && <div className="px-3 pt-1.5 text-[11px] text-yellow-400">Claude is asking — tap an option, or type your own answer below</div>}
          <pre ref={screenRef} className={cn('overflow-auto px-3 py-1.5 font-mono text-[10px] leading-snug text-zinc-200', asking ? 'max-h-[35dvh]' : 'max-h-36')}>{screenLines.join('\n')}</pre>
        </div>
      )}

      {asking ? (
        <div className="shrink-0 space-y-1.5 border-t border-border px-2 py-1.5">
          <div className="flex flex-wrap gap-1.5">
            {(menu?.options ?? FALLBACK_OPTIONS).map((o) => (
              <Button
                key={o.num}
                variant={o.current ? 'secondary' : 'outline'}
                size="sm"
                className="h-9 max-w-full justify-start truncate px-2.5 text-sm"
                disabled={!connected}
                onClick={() => sendRaw(o.num)}
              >
                {o.label === o.num ? o.num : `${o.num}. ${o.label}`}
              </Button>
            ))}
          </div>
          <div className="flex gap-1.5 overflow-x-auto">
            {NAV_KEYS.map((k) => (
              <Button key={k.label} variant="ghost" size="sm" className="h-8 min-w-10 shrink-0 px-2 text-xs" disabled={!connected} onClick={() => sendRaw(k.data)}>
                {k.label}
              </Button>
            ))}
            <Button variant="ghost" size="sm" className="h-8 shrink-0 px-2 text-xs" disabled={!connected} onClick={() => sendRaw(ESC)}>Esc</Button>
            {canCycleMode && (
              <Button variant="ghost" size="sm" className="h-8 shrink-0 px-2 text-xs" disabled={!connected} onClick={() => sendRaw(SHIFT_TAB)}>Shift+Tab</Button>
            )}
          </div>
        </div>
      ) : (
        <div className="shrink-0 flex items-center justify-between border-t border-border px-2 py-1">
          <button
            type="button"
            className={cn('flex items-center gap-1.5 rounded px-2 py-1 text-xs', peekOpen ? 'text-foreground' : 'text-muted-foreground')}
            onClick={() => setPeekOpen(!peekOpen)}
          >
            <Monitor className="h-3.5 w-3.5" /> Live screen
          </button>
          {canCycleMode && (
            <button
              type="button"
              className={cn('flex items-center gap-1.5 rounded px-2 py-1 text-xs disabled:opacity-40', mode === 'Default' ? 'text-muted-foreground' : 'text-primary')}
              disabled={!connected}
              onClick={() => sendRaw(SHIFT_TAB)}
              title="Switch mode (Shift+Tab)"
            >
              <Repeat className="h-3.5 w-3.5" /> Mode: {mode}
            </button>
          )}
          <button
            type="button"
            className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-muted-foreground disabled:opacity-40"
            disabled={!connected}
            onClick={() => sendRaw(ESC)}
            title="Interrupt Claude (Esc)"
          >
            <Square className="h-3 w-3" /> Stop
          </button>
        </div>
      )}

      {/* The keyboard covers the home indicator, so no safe-area gap above it. */}
      <div className="shrink-0 flex items-end gap-2 border-t border-border px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] [.keyboard-open_&]:pb-2">
        <textarea
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => setTyping(true)}
          onBlur={() => setTyping(false)}
          rows={1}
          placeholder={!connected ? 'Connecting…' : asking ? 'Or type your own answer…' : 'Message Claude…'}
          // Grows with the message; while typing it may take half the visible screen.
          className={cn(
            'flex-1 resize-none overflow-y-auto rounded-2xl border border-border bg-background px-3 py-2 text-base text-foreground placeholder:text-muted-foreground outline-none focus:border-primary',
            typing ? 'min-h-24 max-h-[calc(var(--vv-height,100dvh)*0.5)]' : 'min-h-10 max-h-32',
          )}
        />
        <Button size="sm" className="h-10 w-10 shrink-0 rounded-full p-0" onClick={sendMessage} disabled={!connected || !text.trim()} aria-label="Send">
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
