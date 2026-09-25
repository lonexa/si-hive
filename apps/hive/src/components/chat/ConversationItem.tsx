import { useState, useRef, useEffect } from 'react';
import { MessageCircle, Trash2, Star, Pencil, FolderOpen } from 'lucide-react';
import {
  ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator,
} from '@/components/ui/context-menu';
import type { ChatConversation } from '@/stores/chat-store';

interface Props {
  conversation: ChatConversation;
  active: boolean;
  onClick: () => void;
  onDelete: () => void;
  onStar: () => void;
  onUnstar: () => void;
  onRename: (title: string) => void;
  onMoveToProject?: () => void;
}

export default function ConversationItem({
  conversation, active, onClick, onDelete, onStar, onUnstar, onRename, onMoveToProject,
}: Props) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(conversation.title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isRenaming) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isRenaming]);

  function commitRename() {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== conversation.title) {
      onRename(trimmed);
    } else {
      setRenameValue(conversation.title);
    }
    setIsRenaming(false);
  }

  const statusDot: Record<string, string> = {
    active: 'bg-green-500',
    exited: 'bg-zinc-500',
    error: 'bg-red-500',
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          onClick={onClick}
          className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-sm transition-colors group ${
            active
              ? 'bg-primary/10 text-foreground'
              : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
          }`}
        >
          {conversation.isStarred ? (
            <Star className="h-3.5 w-3.5 shrink-0 text-amber-500 fill-amber-500" />
          ) : (
            <MessageCircle className="h-3.5 w-3.5 shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            {isRenaming ? (
              <input
                ref={inputRef}
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename();
                  if (e.key === 'Escape') { setRenameValue(conversation.title); setIsRenaming(false); }
                  e.stopPropagation();
                }}
                onClick={(e) => e.stopPropagation()}
                className="w-full bg-transparent border-b border-primary text-xs font-medium text-foreground outline-none px-0 py-0"
              />
            ) : (
              <div className="truncate text-xs font-medium">{conversation.title}</div>
            )}
            <div className="text-[10px] text-muted-foreground">
              {new Date(conversation.updatedAt).toLocaleDateString()}
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <div className={`w-1.5 h-1.5 rounded-full ${statusDot[conversation.status] ?? 'bg-zinc-500'}`} />
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
              title="Delete"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        </button>
      </ContextMenuTrigger>

      <ContextMenuContent className="w-48">
        <ContextMenuItem
          className="gap-2 cursor-pointer"
          onClick={() => { conversation.isStarred ? onUnstar() : onStar(); }}
        >
          <Star className={`h-3.5 w-3.5 ${conversation.isStarred ? 'text-amber-500 fill-amber-500' : ''}`} />
          {conversation.isStarred ? 'Unstar' : 'Star'}
        </ContextMenuItem>
        <ContextMenuItem
          className="gap-2 cursor-pointer"
          onClick={() => { setRenameValue(conversation.title); setIsRenaming(true); }}
        >
          <Pencil className="h-3.5 w-3.5" />
          Rename
        </ContextMenuItem>
        {onMoveToProject && (
          <ContextMenuItem className="gap-2 cursor-pointer" onClick={onMoveToProject}>
            <FolderOpen className="h-3.5 w-3.5" />
            Move to Project
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem
          className="gap-2 cursor-pointer text-destructive focus:text-destructive focus:bg-destructive/10"
          onClick={onDelete}
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
