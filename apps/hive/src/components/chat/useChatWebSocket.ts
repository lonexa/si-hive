import { useEffect, useRef, useCallback } from 'react';
import { WS_BASE } from '@/lib/api-config';
import { useChatStore } from '@/stores/chat-store';
import type { ChatMessage } from '@/stores/chat-store';

const MAX_RECONNECT_DELAY = 30000;

export function useChatWebSocket(conversationId: string | null) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectDelayRef = useRef(1000);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { addMessage, setIsTyping, setTypingText, setStatus, setToolProgress, setPendingApproval, setConversations } = useChatStore();

  const send = useCallback((type: string, payload?: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type, ...payload }));
    } else {
      console.warn(`[chat-ws] WebSocket not open (state=${wsRef.current?.readyState}), dropping ${type} message`);
    }
  }, []);

  const sendMessage = useCallback((message: string) => {
    // Show user message immediately as a chat bubble (optimistic UI)
    // Don't wait for server echo — WebSocket may not be connected
    addMessage({
      id: crypto.randomUUID(),
      conversationId: activeConvRef.current ?? '',
      role: 'user',
      type: 'text',
      content: message,
      timestamp: new Date().toISOString(),
    });
    send('send', { message });
  }, [send, addMessage]);

  const approve = useCallback(() => {
    send('approve');
  }, [send]);

  const reject = useCallback(() => {
    send('reject');
  }, [send]);

  const abort = useCallback(() => {
    send('abort');
  }, [send]);

  // Track whether the effect is still active to prevent stale reconnects
  const activeConvRef = useRef<string | null>(null);

  useEffect(() => {
    if (!conversationId) return;

    // Mark this conversation as the active one
    activeConvRef.current = conversationId;

    function connect() {
      // Don't reconnect if conversation changed (stale closure)
      if (activeConvRef.current !== conversationId) return;
      if (wsRef.current?.readyState === WebSocket.OPEN) return;

      const ws = new WebSocket(`${WS_BASE}/ws/chat/${conversationId}`);
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectDelayRef.current = 1000;
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as Record<string, unknown>;

          switch (msg.event) {
            case 'message':
              addMessage(msg as unknown as ChatMessage);
              break;
            case 'typing':
              setTypingText(msg.text as string);
              break;
            case 'status':
              setStatus(msg.status as string);
              if (msg.status === 'ready' || msg.status === 'exited') {
                setIsTyping(false);
                setToolProgress(null);
              }
              break;
            case 'tool_progress':
              setToolProgress({ tool: msg.tool as string, detail: msg.detail as string });
              break;
            case 'needs_approval':
              setPendingApproval({
                description: msg.description as string,
                rawText: msg.rawText as string,
              });
              break;
            case 'approval_resolved':
              setPendingApproval(null);
              break;
            case 'title_updated': {
              const updatedId = msg.conversationId as string;
              const updatedTitle = msg.title as string;
              const current = useChatStore.getState().conversations;
              setConversations(current.map((c) =>
                c.id === updatedId ? { ...c, title: updatedTitle } : c
              ));
              break;
            }
            case 'error':
              console.error('[chat-ws] Error:', msg.message);
              setStatus('error');
              break;
          }
        } catch {
          // Ignore malformed messages
        }
      };

      ws.onclose = () => {
        // Only null out the ref if it still points to THIS websocket
        // (a new conversation may have already replaced it)
        if (wsRef.current === ws) {
          wsRef.current = null;
        }
        // Only reconnect if this conversation is still the active one
        if (activeConvRef.current === conversationId) {
          scheduleReconnect();
        }
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    function scheduleReconnect() {
      if (reconnectTimerRef.current) return;
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        reconnectDelayRef.current = Math.min(
          reconnectDelayRef.current * 2,
          MAX_RECONNECT_DELAY,
        );
        connect();
      }, reconnectDelayRef.current);
    }

    connect();

    return () => {
      // Mark this conversation as no longer active so stale onclose won't reconnect
      if (activeConvRef.current === conversationId) {
        activeConvRef.current = null;
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [conversationId, addMessage, setIsTyping, setTypingText, setStatus, setToolProgress, setPendingApproval, setConversations]);

  return { sendMessage, approve, reject, abort };
}
