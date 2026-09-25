import { useState, useRef, useCallback } from 'react';
import {
  Plus,
  Pause,
  Play,
  Trash2,
  GripVertical,
  X,
  CheckCircle2,
  Circle,
  Loader2,
  AlertCircle,
  Send,
  SkipForward,
  Eraser,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { useDashboardStore } from '@/stores/dashboard-store';
import {
  createQueue,
  setQueuePaused,
  addQueueTask,
  deleteQueueTask,
  updateQueueTask,
  clearCompleted,
  reorderQueue,
} from '@/lib/queue-api';
import type { QueueTask } from '@/stores/types';

interface TaskQueuePanelProps {
  sessionId: string;
}

function taskStatusIcon(status: QueueTask['status']) {
  switch (status) {
    case 'completed':
      return <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />;
    case 'in_progress':
      return <Loader2 className="h-3.5 w-3.5 text-blue-400 animate-spin" />;
    case 'sending':
      return <Send className="h-3.5 w-3.5 text-blue-300 animate-pulse" />;
    case 'failed':
      return <AlertCircle className="h-3.5 w-3.5 text-red-400" />;
    case 'skipped':
      return <SkipForward className="h-3.5 w-3.5 text-zinc-500" />;
    default:
      return <Circle className="h-3.5 w-3.5 text-zinc-500" />;
  }
}

function taskStatusLabel(status: QueueTask['status']): string {
  switch (status) {
    case 'pending': return 'Pending';
    case 'sending': return 'Sending';
    case 'in_progress': return 'Running';
    case 'completed': return 'Done';
    case 'failed': return 'Failed';
    case 'skipped': return 'Skipped';
    default: return status;
  }
}

export default function TaskQueuePanel({ sessionId }: TaskQueuePanelProps) {
  const queueData = useDashboardStore((s) => s.queues[sessionId]);
  const queue = queueData?.queue;
  const tasks = queueData?.tasks ?? [];

  const [newPrompt, setNewPrompt] = useState('');
  const [adding, setAdding] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Drag state
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const pendingTasks = tasks.filter((t) => t.status === 'pending');
  const activeTasks = tasks.filter((t) => t.status === 'in_progress' || t.status === 'sending');
  const completedTasks = tasks.filter((t) => t.status === 'completed' || t.status === 'failed' || t.status === 'skipped');

  const handleCreateQueue = useCallback(async () => {
    await createQueue(sessionId);
  }, [sessionId]);

  const handleTogglePause = useCallback(async () => {
    if (!queue) return;
    await setQueuePaused(sessionId, !queue.paused);
  }, [sessionId, queue]);

  const handleAddTask = useCallback(async () => {
    const prompt = newPrompt.trim();
    if (!prompt) return;
    setAdding(true);
    try {
      await addQueueTask(sessionId, prompt);
      setNewPrompt('');
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    } finally {
      setAdding(false);
    }
  }, [sessionId, newPrompt]);

  const handleDeleteTask = useCallback(async (taskId: string) => {
    await deleteQueueTask(taskId);
  }, []);

  const handleSkipTask = useCallback(async (taskId: string) => {
    await updateQueueTask(taskId, { status: 'skipped' });
  }, []);

  const handleClearCompleted = useCallback(async () => {
    await clearCompleted(sessionId);
  }, [sessionId]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleAddTask();
    }
  }, [handleAddTask]);

  const handleTextareaInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setNewPrompt(e.target.value);
    // Auto-resize
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  }, []);

  // Drag and drop for reordering pending tasks
  const handleDragStart = useCallback((index: number) => {
    setDragIndex(index);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    setDragOverIndex(index);
  }, []);

  const handleDrop = useCallback(async (dropIndex: number) => {
    if (dragIndex === null || dragIndex === dropIndex) {
      setDragIndex(null);
      setDragOverIndex(null);
      return;
    }

    // Reorder pending tasks
    const reordered = [...pendingTasks];
    const [moved] = reordered.splice(dragIndex, 1);
    reordered.splice(dropIndex, 0, moved);

    // Build new ordering: keep non-pending task IDs in place, replace pending ones
    const nonPendingIds = tasks.filter((t) => t.status !== 'pending').map((t) => t.id);
    const newPendingIds = reordered.map((t) => t.id);
    const allIds = [...nonPendingIds, ...newPendingIds];

    await reorderQueue(sessionId, allIds);

    setDragIndex(null);
    setDragOverIndex(null);
  }, [dragIndex, pendingTasks, tasks, sessionId]);

  // No queue exists yet — show create button
  if (!queue) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 p-4 text-center">
        <p className="text-sm text-muted-foreground">No task queue for this session</p>
        <Button size="sm" variant="outline" onClick={handleCreateQueue} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          Create Queue
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="shrink-0 px-3 py-2 border-b border-zinc-800 flex items-center gap-2">
        <span className="text-xs font-semibold text-zinc-300">Task Queue</span>
        <Badge variant="outline" className={cn(
          'text-[10px] px-1.5 py-0',
          queue.paused ? 'text-yellow-400 border-yellow-800' : 'text-green-400 border-green-800'
        )}>
          {queue.paused ? 'Paused' : 'Active'}
        </Badge>
        {pendingTasks.length > 0 && (
          <span className="text-[10px] text-muted-foreground">
            {pendingTasks.length} pending
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleTogglePause}
            className="h-6 w-6 p-0 text-zinc-400 hover:text-zinc-200"
            title={queue.paused ? 'Resume queue' : 'Pause queue'}
          >
            {queue.paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
          </Button>
          {completedTasks.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClearCompleted}
              className="h-6 w-6 p-0 text-zinc-400 hover:text-zinc-200"
              title="Clear completed tasks"
            >
              <Eraser className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* Task list */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-2 space-y-1">
          {/* Active tasks */}
          {activeTasks.map((task) => (
            <div
              key={task.id}
              className="flex items-start gap-2 px-2 py-1.5 rounded bg-blue-950/30 border border-blue-900/40 group"
            >
              {taskStatusIcon(task.status)}
              <div className="flex-1 min-w-0">
                <p className="text-xs text-zinc-200 break-words whitespace-pre-wrap">{task.prompt}</p>
                <span className="text-[10px] text-blue-400">{taskStatusLabel(task.status)}</span>
              </div>
              <button
                onClick={() => void handleSkipTask(task.id)}
                className="p-0.5 text-zinc-500 hover:text-yellow-400 opacity-0 group-hover:opacity-100 shrink-0"
                title="Skip this task"
              >
                <SkipForward className="h-3 w-3" />
              </button>
            </div>
          ))}

          {/* Pending tasks (draggable) */}
          {pendingTasks.map((task, i) => (
            <div
              key={task.id}
              draggable
              onDragStart={() => handleDragStart(i)}
              onDragOver={(e) => handleDragOver(e, i)}
              onDrop={() => void handleDrop(i)}
              onDragEnd={() => { setDragIndex(null); setDragOverIndex(null); }}
              className={cn(
                'flex items-start gap-1.5 px-2 py-1.5 rounded border border-zinc-800 hover:border-zinc-700 group cursor-grab active:cursor-grabbing',
                dragOverIndex === i && dragIndex !== null && dragIndex !== i && 'border-blue-600 bg-blue-950/20',
                dragIndex === i && 'opacity-50',
              )}
            >
              <GripVertical className="h-3.5 w-3.5 text-zinc-600 shrink-0 mt-0.5" />
              {taskStatusIcon(task.status)}
              <div className="flex-1 min-w-0">
                <p className="text-xs text-zinc-300 break-words whitespace-pre-wrap">{task.prompt}</p>
              </div>
              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 shrink-0">
                <button
                  onClick={(e) => { e.stopPropagation(); void handleSkipTask(task.id); }}
                  className="p-0.5 text-zinc-500 hover:text-yellow-400"
                  title="Skip this task"
                >
                  <SkipForward className="h-3 w-3" />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); void handleDeleteTask(task.id); }}
                  className="p-0.5 text-zinc-500 hover:text-red-400"
                  title="Delete task"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            </div>
          ))}

          {/* Completed tasks */}
          {completedTasks.map((task) => (
            <div
              key={task.id}
              className="flex items-start gap-2 px-2 py-1.5 rounded opacity-50"
            >
              {taskStatusIcon(task.status)}
              <div className="flex-1 min-w-0">
                <p className="text-xs text-zinc-500 break-words whitespace-pre-wrap line-through">{task.prompt}</p>
                {task.errorMessage && (
                  <span className="text-[10px] text-red-400">{task.errorMessage}</span>
                )}
              </div>
              <button
                onClick={() => void handleDeleteTask(task.id)}
                className="p-0.5 text-zinc-600 hover:text-red-400 shrink-0"
                title="Remove"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}

          {tasks.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-4">
              No tasks in queue. Add one below.
            </p>
          )}
        </div>
      </ScrollArea>

      {/* Add task input */}
      <div className="shrink-0 border-t border-zinc-800 p-2">
        <div className="flex gap-1.5">
          <textarea
            ref={textareaRef}
            value={newPrompt}
            onChange={handleTextareaInput}
            onKeyDown={handleKeyDown}
            placeholder="Add a task prompt..."
            rows={1}
            className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 resize-none focus:outline-none focus:border-zinc-500 min-h-[32px]"
          />
          <Button
            size="sm"
            variant="outline"
            onClick={() => void handleAddTask()}
            disabled={adding || !newPrompt.trim()}
            className="h-8 px-2 shrink-0"
          >
            {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          </Button>
        </div>
        <p className="text-[10px] text-zinc-600 mt-1">Enter to add, Shift+Enter for newline</p>
      </div>
    </div>
  );
}
