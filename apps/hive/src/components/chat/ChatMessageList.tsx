import { useEffect, useRef } from 'react';
import ChatBubble from './ChatBubble';
import TypingIndicator from './TypingIndicator';
import type { ChatMessage } from '@/stores/chat-store';
import { useChatStore } from '@/stores/chat-store';

interface Props {
  messages: ChatMessage[];
  onRetry?: (userMessage: string) => void;
}

export default function ChatMessageList({ messages, onRetry }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const { isTyping, typingText, toolProgress } = useChatStore();

  // Auto-scroll to bottom on new messages or typing
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, isTyping, typingText]);

  // Build tool_result lookup for collapsing into tool_use cards
  const toolResultMap = new Map<string, ChatMessage>();
  for (const msg of messages) {
    if (msg.type === 'tool_result' && msg.toolId) {
      toolResultMap.set(msg.toolId, msg);
    }
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
      {messages.length === 0 && !isTyping && (
        <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
          Start a conversation by typing a message below.
        </div>
      )}

      {messages.map((msg) => {
        // Skip standalone tool_result — it's rendered inside ToolActivityCard
        if (msg.type === 'tool_result') return null;

        const toolResult = msg.type === 'tool_use' && msg.toolId
          ? toolResultMap.get(msg.toolId)
          : undefined;

        // Find the user message that preceded this assistant message for retry
        const retryHandler = msg.role === 'assistant' && msg.type === 'text' && onRetry
          ? () => {
            const idx = messages.indexOf(msg);
            for (let i = idx - 1; i >= 0; i--) {
              if (messages[i].role === 'user' && messages[i].type === 'text') {
                onRetry(messages[i].content);
                break;
              }
            }
          }
          : undefined;

        return <ChatBubble key={msg.id} message={msg} toolResult={toolResult} onRetry={retryHandler} />;
      })}

      {isTyping && (
        <TypingIndicator text={toolProgress ? toolProgress.detail : undefined} />
      )}

      <div ref={bottomRef} />
    </div>
  );
}
