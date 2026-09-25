import { useEffect, useRef, useState } from 'react';
import { Send } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { useMessagesStore } from '@/stores/messages-store';
import { messagesApi, type ThreadDetail } from '@/lib/messages-api';
import { cn } from '@/lib/utils';

interface ConversationViewProps {
  threadId: number;
}

export default function ConversationView({ threadId }: ConversationViewProps) {
  const { user } = useAuth();
  const meOid = user?.oid ?? '';
  const [thread, setThread] = useState<ThreadDetail | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // The store's latest view of this thread — used to detect new incoming messages.
  const storeLastId = useMessagesStore(
    (s) => s.threads.find((t) => t.id === threadId)?.lastMessage?.id ?? 0,
  );

  async function load() {
    try {
      const { thread } = await messagesApi.thread(threadId);
      setThread(thread);
      await messagesApi.markRead(threadId);
    } catch {
      /* ignore */
    }
  }

  // Reload on thread change and whenever the poll reports a newer message.
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId, storeLastId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [thread]);

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      await messagesApi.send(threadId, text);
      setDraft('');
      await load();
    } catch {
      /* ignore */
    } finally {
      setSending(false);
    }
  }

  if (!thread) {
    return <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground">Loading…</div>;
  }

  // Read receipts: who (besides me) has read up to my latest sent message.
  const myLastSent = [...thread.messages].reverse().find((m) => m.senderOid === meOid);
  const seenBy = myLastSent
    ? thread.members
        .filter((m) => m.oid !== meOid && m.lastReadMessageId !== null && m.lastReadMessageId >= myLastSent.id)
        .map((m) => m.name)
    : [];

  return (
    <div className="flex flex-col h-full">
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2">
        {thread.messages.map((m) => {
          const mine = m.senderOid === meOid;
          const isPing = m.kind === 'ping';
          const isAnnouncement = m.kind === 'announcement';

          return (
            <div key={m.id} className={cn('flex flex-col', mine ? 'items-end' : 'items-start')}>
              {!mine && thread.kind !== 'direct' && (
                <span className="text-[10px] text-muted-foreground px-1 mb-0.5">{m.senderName}</span>
              )}
              <div
                className={cn(
                  'max-w-[80%] rounded-2xl px-3 py-1.5 text-xs whitespace-pre-wrap break-words',
                  isAnnouncement
                    ? 'bg-primary/15 text-foreground border border-primary/30'
                    : isPing
                      ? 'bg-amber-500/15 text-foreground border border-amber-500/30'
                      : mine
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-foreground',
                )}
              >
                {isAnnouncement && <span className="mr-1">📢</span>}
                {m.body}
              </div>
              <span className="text-[9px] text-muted-foreground px-1 mt-0.5">
                {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          );
        })}
      </div>

      {seenBy.length > 0 && (
        <div className="px-3 pb-1 text-[9px] text-muted-foreground text-right">
          Seen by {seenBy.join(', ')}
        </div>
      )}

      <div className="p-2 border-t border-border flex items-end gap-1.5">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          rows={1}
          placeholder="Type a message…"
          className="flex-1 resize-none max-h-24 px-2.5 py-1.5 text-xs rounded-md bg-background border border-border text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <button
          onClick={() => void send()}
          disabled={!draft.trim() || sending}
          className="h-7 w-7 shrink-0 flex items-center justify-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors"
        >
          <Send className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
