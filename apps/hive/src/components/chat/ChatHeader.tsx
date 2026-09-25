import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Monitor, MessageCircle, Trash2, ChevronRight, Star, Mail, CheckSquare, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useChatStore } from '@/stores/chat-store';
import ModelSelector from './ModelSelector';

interface Props {
  title: string;
  status: string;
  projectPath?: string | null;
  projectName?: string;
  isStarred?: boolean;
  onDelete: () => void;
  onRename: (title: string) => void;
  onToggleStar: () => void;
}

export default function ChatHeader({
  title, status, projectName, isStarred, onDelete, onRename, onToggleStar,
}: Props) {
  const { viewMode, setViewMode } = useChatStore();
  const navigate = useNavigate();
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(title);
  const [model, setModel] = useState('claude-sonnet-4-6');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  useEffect(() => {
    setEditTitle(title);
  }, [title]);

  function commitRename() {
    const trimmed = editTitle.trim();
    if (trimmed && trimmed !== title) onRename(trimmed);
    else setEditTitle(title);
    setIsEditing(false);
  }

  const statusLabel: Record<string, string> = {
    idle: 'Idle',
    starting: 'Starting...',
    connecting: 'Connecting...',
    ready: 'Ready',
    working: 'Working...',
    needs_input: 'Waiting for input',
    exited: 'Session ended',
    error: 'Error',
  };

  const statusColor: Record<string, string> = {
    idle: 'bg-zinc-500',
    starting: 'bg-yellow-500',
    connecting: 'bg-yellow-500',
    ready: 'bg-green-500',
    working: 'bg-blue-500 animate-pulse',
    needs_input: 'bg-amber-500',
    exited: 'bg-zinc-500',
    error: 'bg-red-500',
  };

  return (
    <div className="border-b border-border bg-card">
      {/* Row 1: Breadcrumb + status + actions */}
      <div className="flex items-center justify-between px-4 py-2">
        <div className="flex items-center gap-1.5 min-w-0 text-sm">
          {/* Breadcrumb */}
          {projectName && (
            <>
              <button
                onClick={() => navigate('/projects')}
                className="text-muted-foreground text-xs truncate max-w-[120px] hover:text-foreground transition-colors"
              >
                {projectName}
              </button>
              <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
            </>
          )}

          {/* Inline-editable title */}
          {isEditing ? (
            <input
              ref={inputRef}
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename();
                if (e.key === 'Escape') { setEditTitle(title); setIsEditing(false); }
              }}
              className="bg-transparent border-b border-primary text-sm font-medium text-foreground outline-none px-0 py-0 min-w-[100px] max-w-[300px]"
            />
          ) : (
            <button
              onClick={() => setIsEditing(true)}
              className="text-sm font-medium text-foreground hover:text-primary truncate transition-colors cursor-text max-w-[300px]"
              title="Click to rename"
            >
              {title}
            </button>
          )}

          {/* Star */}
          <button
            data-track="chat.star_conversation"
            data-track-category="action"
            onClick={onToggleStar}
            className="shrink-0 text-muted-foreground hover:text-amber-500 transition-colors ml-1"
            title={isStarred ? 'Unstar' : 'Star'}
          >
            <Star className={`h-3.5 w-3.5 ${isStarred ? 'text-amber-500 fill-amber-500' : ''}`} />
          </button>

          {/* Status */}
          <div className="flex items-center gap-1.5 shrink-0 ml-2">
            <div className={`w-2 h-2 rounded-full ${statusColor[status] ?? 'bg-zinc-500'}`} />
            <span className="text-[11px] text-muted-foreground">
              {statusLabel[status] ?? status}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {/* Quick nav icons */}
          <Button data-track="chat.nav_gmail" data-track-category="nav" variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" title="Gmail" onClick={() => navigate('/gmail')}>
            <Mail className="h-3.5 w-3.5" />
          </Button>
          <Button data-track="chat.nav_todo" data-track-category="nav" variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" title="Todo" onClick={() => navigate('/todo')}>
            <CheckSquare className="h-3.5 w-3.5" />
          </Button>
          <Button data-track="chat.nav_workflows" data-track-category="nav" variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" title="Workflows" onClick={() => navigate('/workflows')}>
            <Zap className="h-3.5 w-3.5" />
          </Button>

          {/* Separator */}
          <div className="w-px h-5 bg-border mx-1" />

          {/* Chat / Advanced mode toggle */}
          <div className="flex bg-secondary rounded-lg p-0.5">
            <ModeButton
              track="chat.view_mode_chat"
              active={viewMode === 'chat'}
              onClick={() => setViewMode('chat')}
              icon={<MessageCircle className="h-3.5 w-3.5" />}
              label="Chat"
            />
            <ModeButton
              track="chat.view_mode_advanced"
              active={viewMode === 'advanced'}
              onClick={() => setViewMode('advanced')}
              icon={<Monitor className="h-3.5 w-3.5" />}
              label="Advanced"
            />
          </div>

          <Button
            data-track="chat.delete_conversation"
            data-track-category="action"
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
            onClick={onDelete}
            title="Delete conversation"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Row 2: Model selector */}
      <div className="flex items-center gap-2 px-4 py-1 border-t border-border/50">
        <ModelSelector value={model} onChange={setModel} />
      </div>
    </div>
  );
}

function ModeButton({ active, onClick, icon, label, track }: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  track?: string;
}) {
  return (
    <button
      data-track={track}
      data-track-category="feature"
      onClick={onClick}
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
        active
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
