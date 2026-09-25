import type { TaskQueue, QueueTask } from '@/stores/types';

import { API_BASE } from '@/lib/api-config';

export async function fetchQueue(sessionId: string): Promise<{ queue: TaskQueue | null; tasks: QueueTask[] }> {
  const res = await fetch(`${API_BASE}/api/queues/${encodeURIComponent(sessionId)}`);
  return res.json();
}

export async function createQueue(sessionId: string): Promise<{ queue: TaskQueue; tasks: QueueTask[] }> {
  const res = await fetch(`${API_BASE}/api/queues/${encodeURIComponent(sessionId)}`, {
    method: 'POST',
  });
  return res.json();
}

export async function setQueuePaused(sessionId: string, paused: boolean): Promise<{ queue: TaskQueue; tasks: QueueTask[] }> {
  const res = await fetch(`${API_BASE}/api/queues/${encodeURIComponent(sessionId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paused }),
  });
  return res.json();
}

export async function addQueueTask(sessionId: string, prompt: string): Promise<QueueTask> {
  const res = await fetch(`${API_BASE}/api/queues/${encodeURIComponent(sessionId)}/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  });
  return res.json();
}

export async function reorderQueue(sessionId: string, taskIds: string[]): Promise<{ tasks: QueueTask[] }> {
  const res = await fetch(`${API_BASE}/api/queues/${encodeURIComponent(sessionId)}/reorder`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskIds }),
  });
  return res.json();
}

export async function clearCompleted(sessionId: string): Promise<{ tasks: QueueTask[] }> {
  const res = await fetch(`${API_BASE}/api/queues/${encodeURIComponent(sessionId)}/completed`, {
    method: 'DELETE',
  });
  return res.json();
}

export async function updateQueueTask(taskId: string, updates: { prompt?: string; status?: string }): Promise<{ ok: boolean }> {
  const res = await fetch(`${API_BASE}/api/queue-tasks/${encodeURIComponent(taskId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  return res.json();
}

export async function deleteQueueTask(taskId: string): Promise<{ ok: boolean }> {
  const res = await fetch(`${API_BASE}/api/queue-tasks/${encodeURIComponent(taskId)}`, {
    method: 'DELETE',
  });
  return res.json();
}
