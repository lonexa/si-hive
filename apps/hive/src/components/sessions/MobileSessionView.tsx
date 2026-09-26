import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Terminal } from '@xterm/xterm';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowDown, ArrowLeft, ChevronDown, ChevronRight, Monitor, Send, Square, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { API_BASE, WS_BASE } from '@/lib/api-config';
import type { ProviderId } from '@/lib/launch-flags';

/**
 * Phone view of a session. The desktop owns the terminal; the phone never
 * renders or resizes it (a shared terminal can only have one size, and every
 * resize made the CLI redraw badly on the desktop). Instead it shows the
 * conversation from the session transcript, a peek at the bottom of the live
 * screen, choice keys while the CLI is asking something, and a text box that
 * types into the same running session.
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

const CHOICE_KEYS: { label: string; data: string }[] = [
  { label: '1', data: '1' },
  { label: '2', data: '2' },
  { label: '3', data: '3' },
  { label: '↑', data: '\x1b[A' },
  { label: '↓', data: '\x1b[B' },
  { label: 'Enter', data: '\r' },
];
const ESC = '\x1b';
const PEEK_LINES = 14;

/** A real choice menu: a line starting with "❯ 1." followed by more numbered options. */
function isChoicePrompt(lines: string[]): boolean {
  const tail = lines.slice(-12);
  const cursor = tail.findIndex((l) => /^\s{0,6}❯\s*\d+\.\s/.test(l));
  if (cursor === -1) return false;
  return tail.some((l, i) => i !== cursor && /^\s{0,8}\d+\.\s/.test(l));
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
    if (m.type === 'tool_use') {
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
  const navigate = useNavigate();
  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
  const [connected, setConnected] = useState(false);
  const [peek, setPeek] = useState<string[]>([]);
  const [peekOpen, setPeekOpen] = useState(false);
  const [asking, setAsking] = useState(false);
  const [text, setText] = useState('');
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
      const shown = lines.slice(-PEEK_LINES);
      setPeek(shown);
      setAsking(isChoicePrompt(shown));
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
    sendRaw(provider === 'codex' ? value : `\x1b[200~${value}\x1b[201~`);
    setTimeout(() => sendRaw('\r'), 150);
    setText('');
    scrollToBottom();
  };

  const showScreen = asking || peekOpen;

  return (
    // Full-screen over the app chrome: every pixel matters on a phone.
    <div className="fixed inset-0 z-40 flex h-dvh flex-col bg-background">
      <div className="shrink-0 flex items-center gap-2 border-b border-border px-2 py-1.5 bg-card">
        <Button variant="ghost" size="sm" className="h-9 w-9 p-0" onClick={() => navigate('/sessions')} aria-label="Back to sessions">
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

      {showScreen && peek.length > 0 && (
        <div className="shrink-0 border-t border-border bg-black">
          {asking && <div className="px-3 pt-1.5 text-[11px] text-yellow-400">Claude is asking — pick an option below</div>}
          <pre className="max-h-36 overflow-auto px-3 py-1.5 font-mono text-[10px] leading-snug text-zinc-200">{peek.join('\n')}</pre>
        </div>
      )}

      {asking ? (
        <div className="shrink-0 flex gap-1.5 overflow-x-auto border-t border-border px-2 py-1.5">
          {CHOICE_KEYS.map((k) => (
            <Button key={k.label} variant="outline" size="sm" className="h-9 min-w-11 shrink-0 px-2 text-sm" onClick={() => sendRaw(k.data)}>
              {k.label}
            </Button>
          ))}
          <Button variant="outline" size="sm" className="h-9 shrink-0 px-2 text-sm" onClick={() => sendRaw(ESC)}>Esc</Button>
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

      <div className="shrink-0 flex items-end gap-2 border-t border-border px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={Math.min(5, Math.max(1, text.split('\n').length))}
          placeholder={connected ? 'Message Claude…' : 'Connecting…'}
          className="min-h-10 flex-1 resize-none rounded-2xl border border-border bg-background px-3 py-2 text-base text-foreground placeholder:text-muted-foreground outline-none focus:border-primary"
        />
        <Button size="sm" className="h-10 w-10 shrink-0 rounded-full p-0" onClick={sendMessage} disabled={!connected || !text.trim()} aria-label="Send">
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
