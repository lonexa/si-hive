import { useEffect, useState } from 'react';
import { Loader2, User, Bot, Wrench, ChevronDown, ChevronRight, Search } from 'lucide-react';

import { API_BASE } from '@/lib/api-config';

interface TranscriptMessage {
  role: string;
  type: string;
  content: unknown;
  timestamp: string;
  model?: string;
  toolName?: string;
  toolId?: string;
}

interface Props {
  sessionId: string;
}

export default function TranscriptViewer({ sessionId }: Props) {
  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [collapsedTools, setCollapsedTools] = useState<Set<string>>(new Set());

  useEffect(() => {
    setLoading(true);
    fetch(`${API_BASE}/api/sessions/${sessionId}/transcript`)
      .then((r) => r.json())
      .then((data: { messages: TranscriptMessage[] }) => {
        setMessages(data.messages ?? []);
        // Collapse all tool results by default
        const toolIds = new Set<string>();
        for (const m of data.messages ?? []) {
          if ((m.type === 'tool_use' || m.type === 'tool_result') && m.toolId) {
            toolIds.add(m.toolId);
          }
        }
        setCollapsedTools(toolIds);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [sessionId]);

  function toggleTool(toolId: string) {
    setCollapsedTools((prev) => {
      const next = new Set(prev);
      if (next.has(toolId)) next.delete(toolId);
      else next.add(toolId);
      return next;
    });
  }

  const filtered = searchQuery
    ? messages.filter((m) => {
        const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
        return text.toLowerCase().includes(searchQuery.toLowerCase());
      })
    : messages;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Search bar */}
      <div className="shrink-0 px-4 py-2 border-b border-border">
        <div className="flex items-center gap-2 border border-border rounded-md px-2 py-1">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search transcript..."
            className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground outline-none"
          />
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {filtered.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">
            {searchQuery ? 'No matching messages' : 'No transcript data available'}
          </div>
        ) : (
          filtered.map((msg, i) => {
            if (msg.type === 'tool_use') {
              const isCollapsed = msg.toolId ? collapsedTools.has(msg.toolId) : false;
              return (
                <div key={i} className="flex gap-2">
                  <div className="shrink-0 mt-1">
                    <Wrench className="h-4 w-4 text-blue-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <button
                      onClick={() => msg.toolId && toggleTool(msg.toolId)}
                      className="flex items-center gap-1.5 text-xs font-medium text-blue-400 hover:text-blue-300"
                    >
                      {isCollapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                      {msg.toolName}
                    </button>
                    {!isCollapsed && (
                      <pre className="mt-1 text-[11px] text-muted-foreground bg-secondary rounded-md p-2 overflow-x-auto whitespace-pre-wrap break-words">
                        {typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content, null, 2)}
                      </pre>
                    )}
                  </div>
                </div>
              );
            }

            if (msg.type === 'tool_result') {
              const isCollapsed = msg.toolId ? collapsedTools.has(msg.toolId) : false;
              if (isCollapsed) return null;
              return (
                <div key={i} className="ml-6 border-l-2 border-border pl-3">
                  <pre className="text-[11px] text-muted-foreground bg-secondary rounded-md p-2 overflow-x-auto whitespace-pre-wrap break-words max-h-[200px] overflow-y-auto">
                    {typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content, null, 2)}
                  </pre>
                </div>
              );
            }

            const isUser = msg.role === 'user';
            return (
              <div key={i} className={`flex gap-2 ${isUser ? 'flex-row-reverse' : ''}`}>
                <div className="shrink-0 mt-1">
                  {isUser ? (
                    <User className="h-4 w-4 text-primary" />
                  ) : (
                    <Bot className="h-4 w-4 text-green-400" />
                  )}
                </div>
                <div className={`flex-1 min-w-0 max-w-[80%] ${isUser ? 'text-right' : ''}`}>
                  <div className={`inline-block rounded-lg px-3 py-2 text-sm ${
                    isUser
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-secondary text-foreground'
                  }`}>
                    <div className="whitespace-pre-wrap break-words">
                      {typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)}
                    </div>
                  </div>
                  {msg.timestamp && (
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      {new Date(msg.timestamp).toLocaleTimeString()}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
