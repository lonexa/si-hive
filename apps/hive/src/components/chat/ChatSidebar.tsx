import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, ChevronDown, ChevronRight, FolderOpen, Star, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { useChatStore } from '@/stores/chat-store';
import type { ChatConversation } from '@/stores/chat-store';
import ConversationItem from './ConversationItem';
import { API_BASE } from '@/lib/api-config';

interface LiteProject {
  id: number;
  name: string;
  path: string | null;
  color: string;
}

function timeGroup(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays <= 7) return 'Last 7 Days';
  return 'Older';
}

const TIME_GROUP_ORDER: Record<string, number> = { 'Today': 0, 'Yesterday': 1, 'Last 7 Days': 2, 'Older': 3 };

export default function ChatSidebar() {
  const {
    conversations,
    activeConversationId,
    setActiveConversationId,
    createConversation,
    deleteConversation,
    starConversation,
    unstarConversation,
    renameConversation,
    moveConversation,
    loadMessages,
    setMessages,
    setStatus,
    sidebarSearch,
    setSidebarSearch,
  } = useChatStore();

  const [searchParams, setSearchParams] = useSearchParams();
  const [showNewChat, setShowNewChat] = useState(false);
  const [projects, setProjects] = useState<LiteProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [chatTitle, setChatTitle] = useState('');
  const [folderPath, setFolderPath] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [searchResultIds, setSearchResultIds] = useState<Set<string> | null>(null);
  const [moveDialogConv, setMoveDialogConv] = useState<ChatConversation | null>(null);
  const [moveProjectId, setMoveProjectId] = useState<string>('');

  // Load projects for the dropdown
  useEffect(() => {
    fetch(`${API_BASE}/api/projects`)
      .then((r) => r.json())
      .then((data: { projects?: LiteProject[] } | LiteProject[]) => {
        const list = Array.isArray(data) ? data : (data.projects ?? []);
        setProjects(list);
      })
      .catch(() => {});
  }, []);

  // Handle deep-link from project detail page (?project=123&projectName=...)
  useEffect(() => {
    const projectParam = searchParams.get('project');
    const projectName = searchParams.get('projectName');
    const projectPath = searchParams.get('projectPath');
    if (projectParam) {
      setSelectedProjectId(projectParam);
      setChatTitle(projectName ? `Chat - ${projectName}` : 'New Chat');
      setFolderPath(projectPath || '');
      setShowNewChat(true);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // Server-side search for message content when query is long enough
  useEffect(() => {
    if (sidebarSearch.trim().length < 3) {
      setSearchResultIds(null);
      return;
    }
    const controller = new AbortController();
    fetch(`${API_BASE}/api/chat/conversations/search?q=${encodeURIComponent(sidebarSearch.trim())}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((data: { results: Array<{ conversationId: string }> }) => {
        setSearchResultIds(new Set((data.results ?? []).map((r) => r.conversationId)));
      })
      .catch(() => {});
    return () => controller.abort();
  }, [sidebarSearch]);

  // Filter conversations by search (title match + server results)
  const filteredConversations = useMemo(() => {
    if (!sidebarSearch.trim()) return conversations;
    const q = sidebarSearch.toLowerCase();
    return conversations.filter((c) =>
      c.title.toLowerCase().includes(q) || (searchResultIds?.has(c.id) ?? false)
    );
  }, [conversations, sidebarSearch, searchResultIds]);

  // Split into starred and non-starred
  const starredConversations = useMemo(
    () => filteredConversations.filter((c) => c.isStarred),
    [filteredConversations]
  );
  const unstarredConversations = useMemo(
    () => filteredConversations.filter((c) => !c.isStarred),
    [filteredConversations]
  );

  // Group non-starred conversations by project
  // Also include empty project groups so users can see available projects
  const grouped = useMemo(() => {
    const groups: Record<string, typeof conversations> = {};
    // Initialize groups for all projects
    for (const p of projects) {
      const key = p.path || `project:${p.id}`;
      if (!groups[key]) groups[key] = [];
    }
    // Assign conversations to groups
    for (const conv of unstarredConversations) {
      const key = conv.projectPath || '';
      if (!groups[key]) groups[key] = [];
      groups[key].push(conv);
    }
    return groups;
  }, [unstarredConversations, projects]);

  // Find project for a group key (path or project:id)
  function projectForKey(key: string): LiteProject | undefined {
    if (key.startsWith('project:')) {
      const id = parseInt(key.replace('project:', ''), 10);
      return projects.find((p) => p.id === id);
    }
    return projects.find((p) => p.path === key);
  }
  function projectNameForPath(path: string): string {
    const proj = projectForKey(path);
    return proj?.name || path.split(/[\\/]/).pop() || 'Project';
  }
  function projectColorForPath(path: string): string | undefined {
    return projectForKey(path)?.color;
  }

  function toggleGroup(key: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Group conversations by time within a list
  function groupByTime(convs: typeof conversations) {
    const groups: Record<string, typeof conversations> = {};
    for (const conv of convs) {
      const tg = timeGroup(conv.updatedAt);
      if (!groups[tg]) groups[tg] = [];
      groups[tg].push(conv);
    }
    return Object.entries(groups).sort(([a], [b]) => (TIME_GROUP_ORDER[a] ?? 99) - (TIME_GROUP_ORDER[b] ?? 99));
  }

  async function handleNewChat() {
    const title = chatTitle.trim() || 'New Chat';
    const selectedProject = projects.find((p) => String(p.id) === selectedProjectId);
    const projectPath = folderPath.trim() || selectedProject?.path || (selectedProject ? `project:${selectedProject.id}` : undefined);

    const id = await createConversation({ title, projectPath });
    if (id) {
      setActiveConversationId(id);
      setMessages([]);
    }
    setShowNewChat(false);
    setChatTitle('');
    setSelectedProjectId('');
    setFolderPath('');
  }

  function handleSelect(id: string) {
    setActiveConversationId(id);
    setStatus('connecting');
    void loadMessages(id);
  }

  async function handleDelete(id: string) {
    await deleteConversation(id);
  }

  // Sort groups: project groups alphabetically, unassigned last
  const groupKeys = Object.keys(grouped).sort((a, b) => {
    if (a === '') return 1;
    if (b === '') return -1;
    return projectNameForPath(a).localeCompare(projectNameForPath(b));
  });

  function renderConversationItem(conv: typeof conversations[0]) {
    return (
      <ConversationItem
        key={conv.id}
        conversation={conv}
        active={conv.id === activeConversationId}
        onClick={() => handleSelect(conv.id)}
        onDelete={() => handleDelete(conv.id)}
        onStar={() => starConversation(conv.id)}
        onUnstar={() => unstarConversation(conv.id)}
        onRename={(title) => renameConversation(conv.id, title)}
        onMoveToProject={() => setMoveDialogConv(conv)}
      />
    );
  }

  function renderTimeGrouped(convs: typeof conversations) {
    const timeGroups = groupByTime(convs);
    if (timeGroups.length <= 1) {
      return <div className="space-y-0.5">{convs.map(renderConversationItem)}</div>;
    }
    return (
      <div className="space-y-1">
        {timeGroups.map(([label, items]) => (
          <div key={label}>
            <div className="px-4 py-0.5 text-[9px] font-medium text-muted-foreground/60 uppercase tracking-wider">
              {label}
            </div>
            <div className="space-y-0.5">{items.map(renderConversationItem)}</div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="w-[260px] border-r border-border bg-card flex flex-col shrink-0">
      <div className="p-3 space-y-2 border-b border-border">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            data-sidebar-search
            value={sidebarSearch}
            onChange={(e) => setSidebarSearch(e.target.value)}
            placeholder="Search conversations..."
            className="w-full bg-secondary text-xs rounded-md px-3 py-1.5 pl-8 border border-border text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        {/* New Chat */}
        <Button
          data-new-chat-trigger
          data-track="chat.new_conversation"
          data-track-category="action"
          onClick={() => setShowNewChat(true)}
          variant="outline"
          size="sm"
          className="w-full gap-2"
        >
          <Plus className="h-3.5 w-3.5" />
          New Chat
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {filteredConversations.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
            {sidebarSearch ? (
              <>
                <Search className="h-6 w-6 opacity-20 mb-2" />
                <p className="text-xs">No conversations match &quot;{sidebarSearch}&quot;</p>
              </>
            ) : (
              <>
                <p className="text-xs text-center">No conversations yet</p>
                <p className="text-[10px] mt-1">Click &quot;New Chat&quot; to begin</p>
              </>
            )}
          </div>
        )}

        {/* Starred section — always visible with distinct styling */}
        {starredConversations.length > 0 && (
          <div className="mb-2">
            <button
              onClick={() => toggleGroup('__starred__')}
              className="w-full flex items-center gap-1.5 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-amber-500 hover:text-amber-400 transition-colors"
            >
              {collapsedGroups.has('__starred__')
                ? <ChevronRight className="h-3 w-3" />
                : <ChevronDown className="h-3 w-3" />
              }
              <Star className="h-3 w-3 fill-current" />
              <span>Starred</span>
              <span className="ml-auto text-[9px] bg-amber-500/15 text-amber-500 px-1.5 rounded-full">{starredConversations.length}</span>
            </button>
            {!collapsedGroups.has('__starred__') && (
              <div className="space-y-0.5 border-l-2 border-amber-500/20 ml-3">
                {starredConversations.map(renderConversationItem)}
              </div>
            )}
          </div>
        )}

        {/* Project groups — always show headers, including empty projects */}
        {groupKeys.map((groupKey) => {
          const convs = grouped[groupKey] ?? [];
          const isUnassigned = groupKey === '';
          const isCollapsed = collapsedGroups.has(groupKey);
          const groupName = isUnassigned ? 'All Chats' : projectNameForPath(groupKey);
          const groupColor = isUnassigned ? undefined : projectColorForPath(groupKey);

          return (
            <div key={groupKey} className="mb-1">
              <button
                onClick={() => toggleGroup(groupKey)}
                className={`w-full flex items-center gap-1.5 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider transition-colors ${
                  !isUnassigned && groupColor
                    ? 'text-foreground/70 hover:text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {isCollapsed
                  ? <ChevronRight className="h-3 w-3" />
                  : <ChevronDown className="h-3 w-3" />
                }
                {groupColor ? (
                  <div className="w-2.5 h-2.5 rounded-full shrink-0 ring-1 ring-border" style={{ backgroundColor: groupColor }} />
                ) : !isUnassigned ? (
                  <FolderOpen className="h-3 w-3" />
                ) : null}
                <span className="truncate">{groupName}</span>
                <span className="ml-auto text-[9px] bg-secondary px-1.5 rounded-full">{convs.length}</span>
              </button>

              {!isCollapsed && (
                <div className={groupColor ? 'border-l-2 ml-3' : ''} style={groupColor ? { borderColor: `${groupColor}33` } : undefined}>
                  {convs.length > 0 ? renderTimeGrouped(convs) : (
                    <p className="px-4 py-2 text-[10px] text-muted-foreground/50 italic">No chats yet</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* New Chat Dialog */}
      <Dialog open={showNewChat} onOpenChange={setShowNewChat}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>New Chat</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium">Title</label>
              <Input
                value={chatTitle}
                onChange={(e) => setChatTitle(e.target.value)}
                placeholder="New Chat"
                className="mt-1"
                autoFocus
              />
            </div>
            {projects.length > 0 && (
              <div>
                <label className="text-xs font-medium">Project (optional)</label>
                <select
                  value={selectedProjectId}
                  onChange={(e) => {
                    setSelectedProjectId(e.target.value);
                    const proj = projects.find((p) => String(p.id) === e.target.value);
                    if (proj?.path) setFolderPath(proj.path);
                  }}
                  className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                >
                  <option value="">No project</option>
                  {projects.map((p) => (
                    <option key={p.id} value={String(p.id)}>{p.name}</option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="text-xs font-medium">Working Folder (optional)</label>
              <Input
                value={folderPath}
                onChange={(e) => setFolderPath(e.target.value)}
                placeholder="C:\Users\..."
                className="mt-1 font-mono text-xs"
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                Sets the folder context for the AI assistant
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewChat(false)}>Cancel</Button>
            <Button
              data-track="chat.create_conversation"
              data-track-category="action"
              onClick={handleNewChat}
            >Start Chat</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Move to Project Dialog */}
      <Dialog open={!!moveDialogConv} onOpenChange={(open) => { if (!open) setMoveDialogConv(null); }}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle>Move to Project</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Move &quot;{moveDialogConv?.title}&quot; to a different project:
            </p>
            <select
              value={moveProjectId}
              onChange={(e) => setMoveProjectId(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            >
              <option value="">Unassigned</option>
              {projects.map((p) => (
                <option key={p.id} value={p.path || `project:${p.id}`}>{p.name}</option>
              ))}
            </select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoveDialogConv(null)}>Cancel</Button>
            <Button
              data-track="chat.move_conversation"
              data-track-category="action"
              onClick={() => {
                if (moveDialogConv) {
                  void moveConversation(moveDialogConv.id, moveProjectId || null);
                }
                setMoveDialogConv(null);
                setMoveProjectId('');
              }}
            >Move</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
