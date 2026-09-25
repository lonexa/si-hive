import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, Wand2, Bot, Trash2, HelpCircle, Repeat, ListTodo } from 'lucide-react';
import { useChatStore } from '@/stores/chat-store';
import { API_BASE } from '@/lib/api-config';

interface CommandItem {
  id: string;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  category: 'skill' | 'agent' | 'action';
  action: () => void;
}

interface Props {
  query: string;
  onSelect: () => void;
  onClose: () => void;
}

export default function SlashCommandPalette({ query, onSelect, onClose }: Props) {
  const [items, setItems] = useState<CommandItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const { addActiveSkill, addActiveAgent, setMessages, setInputValue } = useChatStore();

  // Build the commands list
  useEffect(() => {
    const builtins: CommandItem[] = [
      { id: 'clear', label: 'clear', description: 'Clear conversation messages', icon: Trash2, category: 'action', action: () => { setMessages([]); } },
      { id: 'help', label: 'help', description: 'Show available commands', icon: HelpCircle, category: 'action', action: () => { setInputValue('What commands are available?'); } },
      { id: 'queue', label: 'queue', description: 'Open task queue', icon: ListTodo, category: 'action', action: () => { /* TODO Phase 6 */ } },
      { id: 'loop', label: 'loop', description: 'Create a recurring task', icon: Repeat, category: 'action', action: () => { /* TODO Phase 6 */ } },
    ];

    // Fetch skills and agents
    Promise.all([
      fetch(`${API_BASE}/api/skills`).then((r) => r.json()).catch(() => []),
      fetch(`${API_BASE}/api/agents`).then((r) => r.json()).catch(() => []),
    ]).then(([skillsData, agentsData]) => {
      // APIs return bare arrays
      const skillsList = Array.isArray(skillsData) ? skillsData as Array<{ name: string; description: string }> : [];
      const agentsList = Array.isArray(agentsData) ? agentsData as Array<{ filename: string; name: string; description: string }> : [];
      const skillItems: CommandItem[] = skillsList.map((s) => ({
        id: `skill:${s.name}`,
        label: s.name,
        description: s.description,
        icon: Wand2,
        category: 'skill' as const,
        action: () => addActiveSkill(s.name),
      }));
      const agentItems: CommandItem[] = agentsList.map((a) => ({
        id: `agent:${a.filename}`,
        label: a.name,
        description: a.description,
        icon: Bot,
        category: 'agent' as const,
        action: () => addActiveAgent(a.name),
      }));
      setItems([...builtins, ...skillItems, ...agentItems]);
    });
  }, [addActiveSkill, addActiveAgent, setMessages, setInputValue]);

  // Filter items by query
  const q = query.toLowerCase();
  const filtered = items.filter((item) =>
    item.label.toLowerCase().includes(q) || item.description.toLowerCase().includes(q)
  );

  // Reset selection when filter changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Scroll selected item into view
  useEffect(() => {
    const el = listRef.current?.children[selectedIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[selectedIndex]) {
        filtered[selectedIndex].action();
        onSelect();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }, [filtered, selectedIndex, onSelect, onClose]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  if (filtered.length === 0) {
    return (
      <div className="absolute bottom-full left-0 right-0 mb-2 z-50">
        <div className="w-full max-w-lg rounded-lg border border-border bg-popover shadow-2xl overflow-hidden animate-in fade-in-0 slide-in-from-bottom-2 duration-150">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
            <Search className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-sm text-foreground">/{query}</span>
            <kbd className="ml-auto text-[10px] text-muted-foreground border border-border rounded px-1.5 py-0.5">ESC</kbd>
          </div>
          <div className="px-3 py-4 text-center text-sm text-muted-foreground">No matching commands</div>
        </div>
      </div>
    );
  }

  // Group by category
  const actions = filtered.filter((i) => i.category === 'action');
  const skillList = filtered.filter((i) => i.category === 'skill');
  const agentList = filtered.filter((i) => i.category === 'agent');

  let globalIndex = 0;

  function renderSection(label: string, sectionItems: CommandItem[], iconColor: string) {
    if (sectionItems.length === 0) return null;
    return (
      <div>
        <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </div>
        {sectionItems.map((item) => {
          const idx = globalIndex++;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              onClick={() => { item.action(); onSelect(); }}
              className={`w-full flex items-center gap-3 px-3 py-1.5 text-sm text-left transition-colors rounded-sm ${
                idx === selectedIndex ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/50'
              }`}
            >
              <Icon className={`h-4 w-4 shrink-0 ${iconColor}`} />
              <span className="font-medium text-foreground">/{item.label}</span>
              <span className="text-xs text-muted-foreground truncate">{item.description}</span>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="absolute bottom-full left-0 right-0 mb-2 z-50">
      <div className="w-full max-w-lg rounded-lg border border-border bg-popover shadow-2xl overflow-hidden animate-in fade-in-0 slide-in-from-bottom-2 duration-150">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-sm text-foreground">/{query}</span>
          <kbd className="ml-auto text-[10px] text-muted-foreground border border-border rounded px-1.5 py-0.5">ESC</kbd>
        </div>
        <div ref={listRef} className="max-h-[280px] overflow-y-auto p-1">
          {renderSection('Quick Actions', actions, 'text-amber-500')}
          {renderSection('Skills', skillList, 'text-primary')}
          {renderSection('Agents', agentList, 'text-green-500')}
        </div>
      </div>
    </div>
  );
}
