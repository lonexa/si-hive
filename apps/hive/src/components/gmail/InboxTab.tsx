import { useState, useEffect, useCallback } from 'react';
import { Search, Mail, MailOpen, Loader2 } from 'lucide-react';
import { Input } from '@hive/shared/components/ui/input';
import { Badge } from '@hive/shared/components/ui/badge';
import { Switch } from '@hive/shared/components/ui/switch';
import { cn } from '@hive/shared/lib/utils';
import { useGmailStore } from '@/stores/gmail-store';
import { API_BASE } from '@/lib/api-config';

export default function InboxTab() {
  const {
    messages,
    setMessages,
    setSelectedMessage,
    setUnreadCount,
    loading,
    setLoading,
    setError,
  } = useGmailStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [debouncedQuery, setDebouncedQuery] = useState('');

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), 400);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const fetchMessages = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (debouncedQuery) params.set('q', debouncedQuery);
      if (unreadOnly) params.set('unread', 'true');
      const url = `${API_BASE}/api/gmail/messages${params.toString() ? `?${params}` : ''}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setMessages(data.messages || []);
      if (typeof data.unreadCount === 'number') {
        setUnreadCount(data.unreadCount);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch messages');
    } finally {
      setLoading(false);
    }
  }, [debouncedQuery, unreadOnly, setMessages, setUnreadCount, setLoading, setError]);

  useEffect(() => {
    fetchMessages();
  }, [fetchMessages]);

  async function handleSelectMessage(messageId: string) {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/api/gmail/messages/${messageId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const detail = await res.json();
      setSelectedMessage(detail);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch message');
    } finally {
      setLoading(false);
    }
  }

  function formatDate(dateStr: string) {
    const date = new Date(dateStr);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    if (isToday) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  return (
    <div className="space-y-3">
      {/* Search and filter bar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search emails..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground whitespace-nowrap">
          <Switch
            checked={unreadOnly}
            onCheckedChange={setUnreadOnly}
            id="unread-toggle"
          />
          <label htmlFor="unread-toggle" className="cursor-pointer select-none">
            Unread only
          </label>
        </div>
      </div>

      {/* Message list */}
      {loading && messages.length === 0 ? (
        <div className="flex items-center justify-center h-32">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : messages.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
          <MailOpen className="h-8 w-8 mb-2 opacity-40" />
          <p className="text-sm">No messages found</p>
        </div>
      ) : (
        <div className="divide-y divide-border rounded-md border">
          {messages.map((msg) => (
            <button
              key={msg.id}
              onClick={() => handleSelectMessage(msg.id)}
              className={cn(
                'w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors flex items-start gap-3',
                msg.isUnread && 'bg-muted/30'
              )}
            >
              {/* Unread indicator */}
              <div className="pt-1.5 flex-shrink-0">
                {msg.isUnread ? (
                  <Mail className="h-4 w-4 text-blue-500" />
                ) : (
                  <MailOpen className="h-4 w-4 text-muted-foreground" />
                )}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={cn(
                      'text-sm truncate',
                      msg.isUnread ? 'font-semibold' : 'font-normal'
                    )}
                  >
                    {msg.from}
                  </span>
                  <span className="text-xs text-muted-foreground flex-shrink-0">
                    {formatDate(msg.date)}
                  </span>
                </div>
                <p
                  className={cn(
                    'text-sm truncate',
                    msg.isUnread ? 'font-medium text-foreground' : 'text-foreground'
                  )}
                >
                  {msg.subject}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {msg.snippet}
                </p>
              </div>

              {/* Unread badge */}
              {msg.isUnread && (
                <Badge variant="default" className="flex-shrink-0 text-[10px] px-1.5 py-0">
                  New
                </Badge>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
