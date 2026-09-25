import { useEffect } from 'react';
import { MessageCircle, Plus, Sparkles, Zap, Database } from 'lucide-react';
import { Button } from '@/components/ui/button';
import ChatHeader from './ChatHeader';
import ChatMessageList from './ChatMessageList';
import ChatInput from './ChatInput';
import ApprovalBanner from './ApprovalBanner';
import ArtifactsPanel from './ArtifactsPanel';
import AdvancedTerminalView from './AdvancedTerminalView';
import { useChatWebSocket } from './useChatWebSocket';
import { useChatStore } from '@/stores/chat-store';
import { API_BASE } from '@/lib/api-config';

export default function ChatMain() {
  const {
    activeConversationId,
    conversations,
    messages,
    status,
    viewMode,
    pendingApproval,
    deleteConversation,
    renameConversation,
    starConversation,
    unstarConversation,
    loadMessages,
    setStatus,
  } = useChatStore();

  const activeConversation = conversations.find((c) => c.id === activeConversationId);
  const { sendMessage, approve, reject, abort } = useChatWebSocket(activeConversationId);

  // Load messages when conversation changes
  useEffect(() => {
    if (activeConversationId) {
      void loadMessages(activeConversationId);
      // Fetch PTY status
      fetch(`${API_BASE}/api/chat/conversations/${activeConversationId}/status`)
        .then((r) => r.json())
        .then((data: { status: string }) => setStatus(data.status))
        .catch(() => setStatus('error'));
    }
  }, [activeConversationId, loadMessages, setStatus]);

  // No conversation selected — rich empty state
  if (!activeConversationId || !activeConversation) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <div className="text-center max-w-md space-y-6">
          <div className="mx-auto w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
            <MessageCircle className="h-8 w-8 text-primary opacity-60" />
          </div>
          <div>
            <p className="text-xl font-semibold text-foreground">Welcome to SI Hive Chat</p>
            <p className="text-sm mt-2 text-muted-foreground">
              Chat with Claude to get help with your projects, data analysis, coding, and more.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 text-left">
            <SuggestionCard icon={Sparkles} label="Ask a question" description="Get help with any topic" />
            <SuggestionCard icon={Database} label="Analyze data" description="Query and explore data" />
            <SuggestionCard icon={Zap} label="Automate tasks" description="Create workflows and scripts" />
            <SuggestionCard icon={MessageCircle} label="Brainstorm" description="Get creative ideas" />
          </div>
          <Button
            data-track="chat.new_conversation_empty_state"
            data-track-category="action"
            variant="outline"
            className="gap-2"
            onClick={() => {
              // Trigger new chat creation via the sidebar
              const btn = document.querySelector('[data-new-chat-trigger]') as HTMLButtonElement | null;
              btn?.click();
            }}
          >
            <Plus className="h-4 w-4" />
            Start a new chat
          </Button>
        </div>
      </div>
    );
  }

  // Get terminal ID for Advanced mode
  const terminalId = activeConversation.ptyTerminalId ?? `chat-${activeConversationId}`;

  return (
    <div className="flex-1 flex min-w-0">
      <div className="flex-1 flex flex-col min-w-0">
        <ChatHeader
          title={activeConversation.title}
          status={status}
          projectPath={activeConversation.projectPath}
          projectName={activeConversation.projectPath ? activeConversation.projectPath.split(/[\\/]/).pop() ?? undefined : undefined}
          isStarred={activeConversation.isStarred}
          onDelete={() => deleteConversation(activeConversationId)}
          onRename={(title) => renameConversation(activeConversationId, title)}
          onToggleStar={() => activeConversation.isStarred ? unstarConversation(activeConversationId) : starConversation(activeConversationId)}
        />

        {viewMode === 'chat' ? (
          <>
            <ChatMessageList messages={messages} onRetry={(msg) => sendMessage(msg)} />
            {pendingApproval && (
              <ApprovalBanner
                approval={pendingApproval}
                onApprove={approve}
                onReject={reject}
              />
            )}
            <ChatInput
              onSend={sendMessage}
              onAbort={abort}
              disabled={status === 'exited' || status === 'error'}
            />
          </>
        ) : (
          <AdvancedTerminalView terminalId={terminalId} />
        )}
      </div>

      {viewMode === 'chat' && <ArtifactsPanel messages={messages} />}
    </div>
  );
}

function SuggestionCard({ icon: Icon, label, description }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border p-3 hover:bg-secondary/50 transition-colors cursor-default">
      <Icon className="h-4 w-4 text-primary shrink-0 mt-0.5" />
      <div>
        <div className="text-xs font-medium text-foreground">{label}</div>
        <div className="text-[11px] text-muted-foreground">{description}</div>
      </div>
    </div>
  );
}
