import { useEffect, useMemo, useState } from 'react';
import { Search, Megaphone, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { messagesApi, type MessagingUser } from '@/lib/messages-api';

interface RecipientPickerProps {
  onStartDirect: (oids: string[]) => void; // 1 = direct, 2+ = group
  onStartBroadcast: () => void;
}

/** "New message" view: pick one person, a small group, or everyone (broadcast). */
export default function RecipientPicker({ onStartDirect, onStartBroadcast }: RecipientPickerProps) {
  const [users, setUsers] = useState<MessagingUser[]>([]);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    messagesApi.users()
      .then(({ users }) => { if (active) setUsers(users); })
      .catch(() => { /* ignore */ })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => u.displayName.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
  }, [users, search]);

  function toggle(oid: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(oid)) next.delete(oid); else next.add(oid);
      return next;
    });
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-2 border-b border-border">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search people…"
            className="w-full pl-7 pr-2 py-1.5 text-xs rounded-md bg-background border border-border text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>

      <button
        onClick={onStartBroadcast}
        className="flex items-center gap-2 px-3 py-2 border-b border-border hover:bg-accent/50 transition-colors text-left"
      >
        <span className="h-6 w-6 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
          <Megaphone className="h-3.5 w-3.5 text-primary" />
        </span>
        <div className="min-w-0">
          <div className="text-xs font-medium text-foreground">Everyone</div>
          <div className="text-[10px] text-muted-foreground">Broadcast an announcement</div>
        </div>
      </button>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">No people found</div>
        ) : (
          filtered.map((u) => (
            <button
              key={u.oid}
              onClick={() => toggle(u.oid)}
              className="w-full flex items-center gap-2 px-3 py-2 border-b border-border last:border-0 hover:bg-accent/50 transition-colors text-left"
            >
              <span className="relative h-6 w-6 rounded-full bg-muted flex items-center justify-center shrink-0 text-[10px] font-semibold text-foreground">
                {u.displayName.slice(0, 1).toUpperCase()}
                <span
                  className={cn(
                    'absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-card',
                    u.online ? 'bg-green-500' : 'bg-muted-foreground/40',
                  )}
                />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium text-foreground truncate">{u.displayName}</div>
                <div className="text-[10px] text-muted-foreground truncate">{u.email}</div>
              </div>
              {selected.has(u.oid) && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
            </button>
          ))
        )}
      </div>

      {selected.size > 0 && (
        <div className="p-2 border-t border-border">
          <button
            onClick={() => onStartDirect(Array.from(selected))}
            className="w-full py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            {selected.size === 1 ? 'Start chat' : `Start group (${selected.size})`}
          </button>
        </div>
      )}
    </div>
  );
}
