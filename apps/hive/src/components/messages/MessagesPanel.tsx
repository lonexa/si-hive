import { useState } from 'react';
import { ArrowLeft, X, Pencil } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMessagesStore } from '@/stores/messages-store';
import RecipientPicker from './RecipientPicker';
import ConversationView from './ConversationView';
import ComposeView from './ComposeView';

type View = 'list' | 'picker';

export default function MessagesPanel() {
  const threads = useMessagesStore((s) => s.threads);
  const activeThreadId = useMessagesStore((s) => s.activeThreadId);
  const composeWith = useMessagesStore((s) => s.composeWith);
  const composeBroadcast = useMessagesStore((s) => s.composeBroadcast);
  const openThread = useMessagesStore((s) => s.openThread);
  const startCompose = useMessagesStore((s) => s.startCompose);
  const startBroadcast = useMessagesStore((s) => s.startBroadcast);
  const clearCompose = useMessagesStore((s) => s.clearCompose);
  const closeWidget = useMessagesStore((s) => s.closeWidget);

  const [view, setView] = useState<View>('list');

  const inThread = activeThreadId !== null;
  const inCompose = composeWith !== null || composeBroadcast;
  const inPicker = view === 'picker' && !inThread && !inCompose;

  function backToList() {
    clearCompose();
    setView('list');
    useMessagesStore.setState({ activeThreadId: null });
  }

  const activeThread = threads.find((t) => t.id === activeThreadId);
  const header =
    inThread ? (activeThread?.title ?? 'Conversation')
    : inCompose ? (composeBroadcast ? 'Broadcast' : 'New message')
    : inPicker ? 'New message'
    : 'Messages';

  const showBack = inThread || inCompose || inPicker;

  return (
    <div className="w-80 h-[28rem] flex flex-col bg-card border border-border rounded-lg shadow-2xl overflow-hidden">
      <div className="flex items-center gap-1.5 px-2 py-2 border-b border-border">
        {showBack ? (
          <button onClick={backToList} className="h-6 w-6 flex items-center justify-center rounded hover:bg-accent text-muted-foreground">
            <ArrowLeft className="h-4 w-4" />
          </button>
        ) : null}
        <span className="flex-1 text-xs font-semibold text-foreground truncate">{header}</span>
        {!showBack && (
          <button
            onClick={() => setView('picker')}
            className="h-6 w-6 flex items-center justify-center rounded hover:bg-accent text-muted-foreground"
            title="New message"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}
        <button onClick={closeWidget} className="h-6 w-6 flex items-center justify-center rounded hover:bg-accent text-muted-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 min-h-0">
        {inThread ? (
          <ConversationView threadId={activeThreadId!} />
        ) : inCompose ? (
          <ComposeView recipients={composeWith} broadcast={composeBroadcast} />
        ) : inPicker ? (
          <RecipientPicker
            onStartDirect={(oids) => { setView('list'); startCompose(oids); }}
            onStartBroadcast={() => { setView('list'); startBroadcast(); }}
          />
        ) : (
          <ThreadList onOpen={openThread} />
        )}
      </div>
    </div>
  );
}

function ThreadList({ onOpen }: { onOpen: (id: number) => void }) {
  const threads = useMessagesStore((s) => s.threads);

  if (threads.length === 0) {
    return (
      <div className="h-full flex items-center justify-center px-4 text-center text-xs text-muted-foreground">
        No conversations yet. Tap the pencil to start one.
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      {threads.map((t) => (
        <button
          key={t.id}
          onClick={() => onOpen(t.id)}
          className={cn(
            'w-full text-left px-3 py-2.5 border-b border-border last:border-0 hover:bg-accent/50 transition-colors',
            t.unreadCount > 0 && 'bg-accent/20',
          )}
        >
          <div className="flex items-center gap-2">
            {t.kind === 'broadcast' && <span className="text-[11px]">📢</span>}
            <span className="flex-1 text-xs font-medium text-foreground truncate">{t.title}</span>
            {t.unreadCount > 0 && (
              <span className="h-4 min-w-4 px-1 flex items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground">
                {t.unreadCount}
              </span>
            )}
          </div>
          {t.lastMessage && (
            <div className="text-[10px] text-muted-foreground truncate mt-0.5">
              {t.lastMessage.kind === 'ping' ? '👋 ping' : t.lastMessage.body}
            </div>
          )}
        </button>
      ))}
    </div>
  );
}
