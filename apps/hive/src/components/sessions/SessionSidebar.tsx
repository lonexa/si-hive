import { useEffect, useState, type RefObject } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import DesignPanel from './sidebar/DesignPanel';
import type { TerminalViewHandle } from './TerminalView';

const STORAGE_KEY = 'hive-session-sidebar';

type SidebarTab = 'design' | 'tasks' | 'agents';

interface SidebarState {
  open: boolean;
  tab: SidebarTab;
  size: number;
}

const DEFAULT_STATE: SidebarState = { open: false, tab: 'design', size: 40 };

export function readSidebarState(): SidebarState {
  if (typeof window === 'undefined') return DEFAULT_STATE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_STATE;
    const parsed = JSON.parse(raw) as Partial<SidebarState>;
    return {
      open: typeof parsed.open === 'boolean' ? parsed.open : DEFAULT_STATE.open,
      tab: parsed.tab === 'tasks' || parsed.tab === 'agents' ? parsed.tab : 'design',
      size: typeof parsed.size === 'number' && parsed.size >= 20 && parsed.size <= 60
        ? parsed.size
        : DEFAULT_STATE.size,
    };
  } catch {
    return DEFAULT_STATE;
  }
}

export function writeSidebarState(state: Partial<SidebarState>): void {
  if (typeof window === 'undefined') return;
  try {
    const merged = { ...readSidebarState(), ...state };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  } catch {
    // storage full or denied — non-critical
  }
}

interface SessionSidebarProps {
  terminalRef: RefObject<TerminalViewHandle | null>;
  sessionId?: string;
  initialTab?: SidebarTab;
}

export default function SessionSidebar({ terminalRef, sessionId, initialTab }: SessionSidebarProps) {
  const [tab, setTab] = useState<SidebarTab>(initialTab ?? readSidebarState().tab);

  useEffect(() => {
    writeSidebarState({ tab });
  }, [tab]);

  return (
    <div className="flex flex-col h-full bg-secondary border-l border-border">
      <Tabs value={tab} onValueChange={(v) => setTab(v as SidebarTab)} className="flex flex-col h-full">
        <TabsList className="w-full justify-start rounded-none border-b border-border bg-card h-9 px-2">
          <TabsTrigger value="design" className="text-xs">Design</TabsTrigger>
          <TabsTrigger value="tasks" className="text-xs" disabled title="Coming in PR3">Tasks</TabsTrigger>
          <TabsTrigger value="agents" className="text-xs" disabled title="Coming in PR3">Agents</TabsTrigger>
        </TabsList>
        <TabsContent value="design" className="flex-1 min-h-0 m-0 outline-none">
          <DesignPanel terminalRef={terminalRef} sessionId={sessionId} />
        </TabsContent>
        <TabsContent value="tasks" className="flex-1 min-h-0 m-0 p-3 outline-none text-xs text-muted-foreground">
          Tasks panel arrives in PR3 (consolidates Queue + Loops here).
        </TabsContent>
        <TabsContent value="agents" className="flex-1 min-h-0 m-0 p-3 outline-none text-xs text-muted-foreground">
          Agent teams panel arrives in PR3.
        </TabsContent>
      </Tabs>
    </div>
  );
}
