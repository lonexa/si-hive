import { useState, useEffect, useCallback } from 'react';
import { Sparkles, Plus, Loader2, ListChecks, CheckCircle2, X, ClipboardList, Calendar, List, Check } from 'lucide-react';
import { Button } from '@hive/shared/components/ui/button';
import { Input } from '@hive/shared/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@hive/shared/components/ui/card';
import { Badge } from '@hive/shared/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@hive/shared/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@hive/shared/components/ui/select';
import AISessionButton from '@hive/shared/components/AISessionButton';
import { API_BASE } from '@/lib/api-config';
import { useTodoStore } from '@/stores/todo-store';
import type { TodoItem as TodoItemType, TrackerItem, CalendarItem, TodoFilter } from '@/stores/todo-store';
import TodoItem from './TodoItem';

function formatDate(): string {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

const FILTER_OPTIONS: Array<{ value: TodoFilter; label: string; icon: typeof List }> = [
  { value: 'all', label: 'All', icon: List },
  { value: 'tickets', label: 'Tickets', icon: ClipboardList },
  { value: 'todos', label: 'Todos', icon: ListChecks },
  { value: 'calendar', label: 'Calendar', icon: Calendar },
];

export default function TodoPage() {
  const {
    todos,
    trackerItems,
    calendarItems,
    activeFilter,
    generating,
    loading,
    error,
    setTodos,
    setTrackerItems,
    setCalendarItems,
    setActiveFilter,
    addTodo,
    updateTodo,
    removeTodo,
    setGenerating,
    setLoading,
    setError,
  } = useTodoStore();

  const [showAddForm, setShowAddForm] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newPriority, setNewPriority] = useState('medium');

  // AI generation preview
  const [previewItems, setPreviewItems] = useState<TodoItemType[]>([]);
  const [previewSelected, setPreviewSelected] = useState<Set<number>>(new Set());
  const [previewOpen, setPreviewOpen] = useState(false);

  const fetchCombined = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/todo/combined`);
      if (!res.ok) throw new Error('Failed to fetch todos');
      const data = await res.json() as {
        todos: TodoItemType[];
        trackerItems: TrackerItem[];
        calendarItems: CalendarItem[];
      };
      setTodos(data.todos || []);
      setTrackerItems(data.trackerItems || []);
      setCalendarItems(data.calendarItems || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch todos');
    } finally {
      setLoading(false);
    }
  }, [setTodos, setTrackerItems, setCalendarItems, setLoading, setError]);

  useEffect(() => {
    fetchCombined();
  }, [fetchCombined]);

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/todo/generate`);
      if (!res.ok) throw new Error('Failed to generate todos');
      const data = await res.json() as { todos: TodoItemType[] };
      // Deduplicate against existing todos (match by title, case-insensitive)
      const existingTitles = new Set(todos.map((t) => t.title.toLowerCase().trim()));
      const newItems = (data.todos || []).filter(
        (t: TodoItemType) => !existingTitles.has(t.title.toLowerCase().trim())
      );
      // Show preview dialog — user approves which ones to add
      setPreviewItems(newItems);
      setPreviewSelected(new Set(newItems.map((_: TodoItemType, i: number) => i)));
      setPreviewOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate todos');
    } finally {
      setGenerating(false);
    }
  }

  function togglePreviewItem(idx: number) {
    setPreviewSelected((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }

  async function handleApproveGenerated() {
    const approved = previewItems.filter((_, i) => previewSelected.has(i));
    if (approved.length > 0) {
      // Save each approved item to the DB via the items endpoint
      const saved: TodoItemType[] = [];
      for (const item of approved) {
        try {
          const res = await fetch(`${API_BASE}/api/todo/items`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: item.title,
              description: item.description || undefined,
              priority: item.priority,
            }),
          });
          if (res.ok) {
            const savedTodo: TodoItemType = await res.json();
            saved.push(savedTodo);
          }
        } catch (err) {
          console.error('Failed to save generated todo:', err);
        }
      }
      if (saved.length > 0) {
        setTodos([...todos, ...saved]);
      }
    }
    setPreviewOpen(false);
    setPreviewItems([]);
    setPreviewSelected(new Set());
  }

  async function handleAddTodo(e: React.FormEvent) {
    e.preventDefault();
    if (!newTitle.trim()) return;

    try {
      const res = await fetch(`${API_BASE}/api/todo/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newTitle.trim(),
          priority: newPriority,
          source: 'manual',
        }),
      });
      if (!res.ok) throw new Error('Failed to add todo');
      const todo: TodoItemType = await res.json();
      addTodo(todo);
      setNewTitle('');
      setNewPriority('medium');
      setShowAddForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add todo');
    }
  }

  function handleToggle(id: number, newStatus: string) {
    updateTodo(id, { status: newStatus });
  }

  function handleDelete(id: number) {
    removeTodo(id);
  }

  // Build unified list based on filter
  const allItems: TodoItemType[] = [];

  // Add calendar events as TodoItemType shape
  if (activeFilter === 'all' || activeFilter === 'calendar') {
    for (const cal of calendarItems) {
      allItems.push({
        id: parseInt(cal.id.replace(/\D/g, '').slice(0, 9)) || Math.random() * 100000,
        userEmail: '',
        todoDate: '',
        title: cal.title,
        description: cal.description,
        priority: 'medium',
        status: 'todo',
        source: 'calendar',
        sourceRef: cal.htmlLink || null,
        createdAt: cal.time || '',
        updatedAt: '',
      });
    }
  }

  // Add tracker issues
  if (activeFilter === 'all' || activeFilter === 'tickets') {
    trackerItems.forEach((ticket, i) => {
      allItems.push({
        // Synthetic negative id keeps list keys unique; the issue key lives in sourceRef.
        id: -(i + 1),
        userEmail: '',
        todoDate: '',
        title: ticket.title,
        description: `${ticket.state} · ${ticket.type}`,
        priority: ticket.priority,
        status: ticket.status || 'todo',
        source: 'tracker',
        sourceRef: ticket.id,
        createdAt: '',
        updatedAt: '',
      });
    });
  }

  // Add manual/AI todos
  if (activeFilter === 'all' || activeFilter === 'todos') {
    allItems.push(...todos);
  }

  const pendingItems = allItems.filter((t) => t.status !== 'done');
  const doneItems = allItems.filter((t) => t.status === 'done');

  const prioritizePrompt = todos.length > 0
    ? `Here are my todos for today. Help me prioritize them and suggest an efficient order:\n\n${todos
        .filter((t) => t.status !== 'done')
        .map((t) => `- [${t.priority}] ${t.title}${t.description ? ': ' + t.description : ''}`)
        .join('\n')}`
    : 'I need help planning my day. Help me create a prioritized todo list.';

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Today's Tasks</h1>
          <p className="text-sm text-muted-foreground">{formatDate()}</p>
        </div>
        <div className="flex items-center gap-2">
          <AISessionButton
            cwd="~"
            prompt={prioritizePrompt}
            label="+Claude"
            dialogLabel="Help me prioritize"
            dialogSubtitle="Ask Claude to help organize and prioritize your todos"
            variant="outline"
            size="sm"
            tooltip="Help me prioritize my todos"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={handleGenerate}
            disabled={generating}
            data-track="todo.generate_ai"
            data-track-category="action"
          >
            {generating ? (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4 mr-1.5" />
            )}
            {generating ? 'Generating...' : 'Generate with AI'}
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={() => setShowAddForm(!showAddForm)}
            data-track="todo.toggle_add_form"
            data-track-category="modal"
          >
            {showAddForm ? (
              <X className="h-4 w-4 mr-1.5" />
            ) : (
              <Plus className="h-4 w-4 mr-1.5" />
            )}
            {showAddForm ? 'Cancel' : 'Add Todo'}
          </Button>
        </div>
      </div>

      {/* Filter chips */}
      <div className="flex items-center gap-2">
        {FILTER_OPTIONS.map(({ value, label, icon: Icon }) => {
          const isActive = activeFilter === value;
          const count = value === 'all'
            ? todos.length + trackerItems.length + calendarItems.length
            : value === 'tickets' ? trackerItems.length
            : value === 'todos' ? todos.length
            : calendarItems.length;
          return (
            <Button
              key={value}
              variant={isActive ? 'default' : 'outline'}
              size="sm"
              className="gap-1.5 h-7 text-xs"
              onClick={() => setActiveFilter(value)}
              data-track={`todo.filter.${value}`}
              data-track-category="nav"
            >
              <Icon className="h-3 w-3" />
              {label}
              {count > 0 && (
                <Badge variant="secondary" className="text-[10px] px-1 py-0 ml-0.5">
                  {count}
                </Badge>
              )}
            </Button>
          );
        })}
      </div>

      {/* Error banner */}
      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Add todo inline form */}
      {showAddForm && (
        <Card>
          <CardContent className="pt-4">
            <form onSubmit={handleAddTodo} className="flex items-end gap-3">
              <div className="flex-1">
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                  Title
                </label>
                <Input
                  placeholder="What needs to be done?"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="w-32">
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                  Priority
                </label>
                <Select value={newPriority} onValueChange={setNewPriority}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button type="submit" size="sm" disabled={!newTitle.trim()} data-track="todo.add_todo" data-track-category="action">
                <Plus className="h-4 w-4 mr-1" />
                Add
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-sm text-muted-foreground">Loading tasks...</span>
        </div>
      )}

      {/* Empty state */}
      {!loading && pendingItems.length === 0 && doneItems.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <ListChecks className="h-12 w-12 text-muted-foreground/40 mb-4" />
            <h3 className="text-lg font-medium text-muted-foreground mb-1">
              No tasks for today
            </h3>
            <p className="text-sm text-muted-foreground/70 max-w-sm">
              Click "Generate with AI" to create todos from your emails and calendar,
              or add one manually.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Active items */}
      {!loading && pendingItems.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <ListChecks className="h-4 w-4 text-muted-foreground" />
              Active
              <span className="text-xs text-muted-foreground font-normal">
                ({pendingItems.length})
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {pendingItems.map((item, idx) => (
              <TodoItem
                key={`${item.source}-${item.id}-${idx}`}
                todo={item}
                onToggle={handleToggle}
                onDelete={handleDelete}
              />
            ))}
          </CardContent>
        </Card>
      )}

      {/* Done section */}
      {!loading && doneItems.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
              <CheckCircle2 className="h-4 w-4" />
              Done
              <span className="text-xs font-normal">
                ({doneItems.length})
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {doneItems.map((item, idx) => (
              <TodoItem
                key={`${item.source}-${item.id}-${idx}`}
                todo={item}
                onToggle={handleToggle}
                onDelete={handleDelete}
              />
            ))}
          </CardContent>
        </Card>
      )}
      {/* AI Generation Preview Dialog */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-purple-400" />
              AI Generated Todos
              <span className="text-xs text-muted-foreground font-normal">
                {previewSelected.size} of {previewItems.length} selected
              </span>
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto space-y-2 py-2">
            {previewItems.map((item, idx) => {
              const selected = previewSelected.has(idx);
              const prioClass = item.priority === 'high'
                ? 'bg-red-500/15 text-red-400 border-red-500/30'
                : item.priority === 'medium'
                  ? 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30'
                  : 'bg-green-500/15 text-green-400 border-green-500/30';
              return (
                <div
                  key={idx}
                  className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                    selected ? 'border-primary/50 bg-primary/5' : 'border-border/50 bg-card opacity-50'
                  }`}
                  onClick={() => togglePreviewItem(idx)}
                >
                  <div className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                    selected ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40'
                  }`}>
                    {selected && <Check className="h-3 w-3" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="font-medium text-sm">{item.title}</span>
                      <Badge className={`text-[10px] px-1.5 py-0 ${prioClass}`}>
                        {item.priority}
                      </Badge>
                      {item.source && item.source !== 'ai' && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                          {item.source}
                        </Badge>
                      )}
                    </div>
                    {item.description && (
                      <p className="text-xs text-muted-foreground line-clamp-2">{item.description}</p>
                    )}
                  </div>
                </div>
              );
            })}
            {previewItems.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">No todos were generated.</p>
            )}
          </div>
          <DialogFooter className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPreviewSelected(new Set(previewItems.map((_, i) => i)))}
              >
                Select All
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPreviewSelected(new Set())}
              >
                Deselect All
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setPreviewOpen(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleApproveGenerated} disabled={previewSelected.size === 0} data-track="todo.approve_generated" data-track-category="action">
                <Plus className="h-3.5 w-3.5 mr-1" />
                Add {previewSelected.size} Todo{previewSelected.size !== 1 ? 's' : ''}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
