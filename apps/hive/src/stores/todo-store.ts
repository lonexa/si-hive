import { create } from 'zustand';

export interface TodoItem {
  id: number;
  userEmail: string;
  todoDate: string;
  title: string;
  description: string | null;
  priority: string;
  status: string;
  source: string;
  sourceRef: string | null;
  createdAt: string;
  updatedAt: string;
}

/** An open issue from the connected ticket tracker. */
export interface TrackerItem {
  /** Tracker issue key (e.g. `123`, `ABC-42`). */
  id: string;
  title: string;
  type: string;
  state: string;
  priority: string;
  source: string;
  assignedTo?: string;
  status?: string; // 'todo' | 'done' — persisted completion state
  url?: string;
}

export interface CalendarItem {
  id: string;
  title: string;
  description: string;
  time: string;
  source: string;
  htmlLink?: string;
  meetLink?: string;
  isAllDay: boolean;
}

export type TodoFilter = 'all' | 'tickets' | 'todos' | 'calendar';

interface TodoState {
  todos: TodoItem[];
  trackerItems: TrackerItem[];
  calendarItems: CalendarItem[];
  activeFilter: TodoFilter;
  generating: boolean;
  loading: boolean;
  error: string | null;

  setTodos: (todos: TodoItem[]) => void;
  setTrackerItems: (items: TrackerItem[]) => void;
  setCalendarItems: (items: CalendarItem[]) => void;
  setActiveFilter: (filter: TodoFilter) => void;
  addTodo: (todo: TodoItem) => void;
  updateTodo: (id: number, updates: Partial<TodoItem>) => void;
  removeTodo: (id: number) => void;
  setGenerating: (generating: boolean) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

export const useTodoStore = create<TodoState>((set) => ({
  todos: [],
  trackerItems: [],
  calendarItems: [],
  activeFilter: 'all',
  generating: false,
  loading: false,
  error: null,

  setTodos: (todos) => set({ todos }),
  setTrackerItems: (items) => set({ trackerItems: items }),
  setCalendarItems: (items) => set({ calendarItems: items }),
  setActiveFilter: (filter) => set({ activeFilter: filter }),
  addTodo: (todo) => set((s) => ({ todos: [...s.todos, todo] })),
  updateTodo: (id, updates) => set((s) => ({
    todos: s.todos.map((t) => t.id === id ? { ...t, ...updates } : t),
  })),
  removeTodo: (id) => set((s) => ({ todos: s.todos.filter((t) => t.id !== id) })),
  setGenerating: (generating) => set({ generating }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
}));
