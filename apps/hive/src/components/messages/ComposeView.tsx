import { useState } from 'react';
import { Send, Megaphone } from 'lucide-react';
import { useMessagesStore } from '@/stores/messages-store';
import { messagesApi } from '@/lib/messages-api';

interface ComposeViewProps {
  recipients: string[] | null; // oids; null when broadcasting
  broadcast: boolean;
}

/** Composer for a brand-new conversation (direct/group) or a broadcast. */
export default function ComposeView({ recipients, broadcast }: ComposeViewProps) {
  const openThread = useMessagesStore((s) => s.openThread);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      if (broadcast) {
        const { threadId } = await messagesApi.broadcast(text);
        openThread(threadId);
      } else if (recipients && recipients.length > 0) {
        const { thread } = await messagesApi.createThread(recipients);
        await messagesApi.send(thread.id, text);
        openThread(thread.id);
      }
    } catch {
      /* ignore */
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 flex items-center justify-center p-4 text-center">
        {broadcast ? (
          <div className="text-muted-foreground">
            <Megaphone className="h-6 w-6 mx-auto mb-2 text-primary" />
            <div className="text-xs font-medium text-foreground">Broadcast to everyone</div>
            <div className="text-[10px]">All users will see this announcement pinned at the top.</div>
          </div>
        ) : (
          <div className="text-muted-foreground text-xs">
            New message to {recipients?.length ?? 0} {recipients?.length === 1 ? 'person' : 'people'}
          </div>
        )}
      </div>

      <div className="p-2 border-t border-border flex items-end gap-1.5">
        <textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          rows={1}
          placeholder={broadcast ? 'Announcement…' : 'Type a message…'}
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
