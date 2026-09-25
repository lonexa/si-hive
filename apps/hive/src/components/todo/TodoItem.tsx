import { Link } from 'react-router-dom';
import { Bot, Mail, Calendar, PenLine, Trash2, Check, ClipboardList, ExternalLink, Clock } from 'lucide-react';
import { Badge } from '@hive/shared/components/ui/badge';
import { Button } from '@hive/shared/components/ui/button';
import { API_BASE } from '@/lib/api-config';
import type { TodoItem as TodoItemType } from '@/stores/todo-store';

interface TodoItemProps {
  todo: TodoItemType;
  onToggle: (id: number, newStatus: string) => void;
  onDelete: (id: number) => void;
}

const priorityStyles: Record<string, string> = {
  high: 'bg-red-500/15 text-red-400 border-red-500/30',
  medium: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  low: 'bg-green-500/15 text-green-400 border-green-500/30',
};

const sourceIcons: Record<string, typeof Bot> = {
  ai: Bot,
  email: Mail,
  calendar: Calendar,
  manual: PenLine,
  tracker: ClipboardList,
};

export default function TodoItem({ todo, onToggle, onDelete }: TodoItemProps) {
  const isDone = todo.status === 'done';
  const isCalendar = todo.source === 'calendar';
  const isTracker = todo.source === 'tracker';
  const SourceIcon = sourceIcons[todo.source] || PenLine;
  const prioClass = priorityStyles[todo.priority] || priorityStyles.medium;

  async function handleToggle() {
    if (isCalendar) return;
    const newStatus = isDone ? 'todo' : 'done';
    try {
      if (isTracker) {
        const res = await fetch(`${API_BASE}/api/todo/tracker-toggle`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ticketId: todo.sourceRef, title: todo.title, status: newStatus, priority: todo.priority }),
        });
        if (!res.ok) throw new Error('Failed to toggle ticket');
      } else {
        const res = await fetch(`${API_BASE}/api/todo/${todo.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: newStatus }),
        });
        if (!res.ok) throw new Error('Failed to update todo');
      }
      onToggle(todo.id, newStatus);
    } catch (err) {
      console.error('Error toggling todo:', err);
    }
  }

  async function handleDelete() {
    if (isCalendar || isTracker) return; // Can't delete external items
    try {
      const res = await fetch(`${API_BASE}/api/todo/${todo.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete todo');
      onDelete(todo.id);
    } catch (err) {
      console.error('Error deleting todo:', err);
    }
  }

  // Calendar event rendering
  if (isCalendar) {
    return (
      <div className="group flex items-start gap-3 rounded-lg border border-blue-500/20 bg-blue-500/5 p-3">
        <Clock className="mt-0.5 h-4 w-4 shrink-0 text-blue-400" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="font-medium text-sm leading-tight text-foreground">
              {todo.title}
            </span>
            <Calendar className="h-3.5 w-3.5 text-blue-400 shrink-0" />
          </div>
          {todo.description && (
            <p className="text-xs text-blue-400/80 mt-0.5">{todo.description}</p>
          )}
        </div>
        {todo.sourceRef && (
          <a href={todo.sourceRef} target="_blank" rel="noopener noreferrer">
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground">
              <ExternalLink className="h-3.5 w-3.5" />
            </Button>
          </a>
        )}
      </div>
    );
  }

  // Tracker issue rendering
  if (isTracker) {
    return (
      <div className="group flex items-start gap-3 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
        <button
          type="button"
          role="checkbox"
          aria-checked={isDone}
          onClick={handleToggle}
          className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
            isDone
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-muted-foreground/40 hover:border-primary'
          }`}
        >
          {isDone && <Check className="h-3 w-3" />}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            {todo.sourceRef ? (
              <Link
                to={`/work?issue=${encodeURIComponent(todo.sourceRef)}`}
                className="text-[10px] font-mono text-muted-foreground hover:text-primary hover:underline"
                title="Open ticket"
              >
                {todo.sourceRef}
              </Link>
            ) : null}
            <span
              className={`font-medium text-sm leading-tight ${
                isDone ? 'line-through text-muted-foreground' : 'text-foreground'
              }`}
            >
              {todo.title}
            </span>
            <Badge className={`text-[10px] px-1.5 py-0 ${prioClass}`}>
              {todo.priority}
            </Badge>
            <ClipboardList className="h-3.5 w-3.5 text-amber-400 shrink-0" />
          </div>
          {todo.description && (
            <p className="text-xs text-muted-foreground mt-0.5">{todo.description}</p>
          )}
        </div>
      </div>
    );
  }

  // Standard todo rendering (manual, ai, email)
  return (
    <div className="group flex items-start gap-3 rounded-lg border border-border/50 bg-card p-3 transition-colors hover:bg-accent/30">
      <button
        type="button"
        role="checkbox"
        aria-checked={isDone}
        onClick={handleToggle}
        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
          isDone
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-muted-foreground/40 hover:border-primary'
        }`}
      >
        {isDone && <Check className="h-3 w-3" />}
      </button>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span
            className={`font-medium text-sm leading-tight ${
              isDone ? 'line-through text-muted-foreground' : 'text-foreground'
            }`}
          >
            {todo.title}
          </span>
          <Badge className={`text-[10px] px-1.5 py-0 ${prioClass}`}>
            {todo.priority}
          </Badge>
          <SourceIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        </div>
        {todo.description && (
          <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
            {todo.description}
          </p>
        )}
      </div>

      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
        onClick={handleDelete}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
