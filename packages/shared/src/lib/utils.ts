import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function timeAgo(date: string): string {
  if (!date) return 'never';

  const now = Date.now();
  const then = new Date(date).getTime();
  const seconds = Math.floor((now - then) / 1000);

  if (seconds < 0) return 'just now';
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;

  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

export function statusColor(status: string): string {
  switch (status) {
    case 'working':
      return 'text-status-green';
    case 'done':
    case 'completed':
      return 'text-status-done';
    case 'waiting-approval':
    case 'waiting-input':
    case 'in-progress':
    case 'in_progress':
    case 'review':
      return 'text-status-yellow';
    case 'error':
    case 'stopped':
      return 'text-status-red';
    case 'paused':
    case 'idle':
    case 'not-started':
    case 'pending':
      return 'text-status-gray';
    default:
      return 'text-text-muted';
  }
}

export function statusBgColor(status: string): string {
  switch (status) {
    case 'working':
      return 'bg-status-green';
    case 'done':
    case 'completed':
      return 'bg-status-done';
    case 'waiting-approval':
    case 'waiting-input':
    case 'in-progress':
    case 'in_progress':
    case 'review':
      return 'bg-status-yellow';
    case 'error':
    case 'stopped':
      return 'bg-status-red';
    case 'paused':
    case 'idle':
    case 'not-started':
    case 'pending':
      return 'bg-status-gray';
    default:
      return 'bg-status-gray';
  }
}

export function eventTypeColor(type: string): string {
  switch (type) {
    case 'task_completed':
    case 'stop':
      return 'text-status-green';
    case 'teammate_idle':
    case 'idle_prompt':
      return 'text-status-yellow';
    case 'error':
      return 'text-status-red';
    case 'permission_prompt':
      return 'text-status-yellow';
    default:
      return 'text-status-blue';
  }
}

export function eventTypeBgColor(type: string): string {
  switch (type) {
    case 'task_completed':
    case 'stop':
      return 'bg-status-green/15 text-status-green';
    case 'teammate_idle':
    case 'idle_prompt':
      return 'bg-status-yellow/15 text-status-yellow';
    case 'error':
      return 'bg-status-red/15 text-status-red';
    case 'permission_prompt':
      return 'bg-status-yellow/15 text-status-yellow';
    default:
      return 'bg-status-blue/15 text-status-blue';
  }
}

export function eventTypeIcon(type: string): string {
  switch (type) {
    case 'task_completed':
      return '\u2713';
    case 'stop':
      return '\u25a0';
    case 'teammate_idle':
      return '\u25cb';
    case 'error':
      return '\u2717';
    case 'permission_prompt':
      return '\u26a0';
    case 'idle_prompt':
      return '\u2026';
    default:
      return '\u2022';
  }
}

export function sessionStatusLabel(status: string): string {
  switch (status) {
    case 'working':
      return 'Working';
    case 'waiting-approval':
      return 'Waiting Approval';
    case 'waiting-input':
      return 'Waiting Input';
    case 'done':
      return 'Done';
    case 'paused':
      return 'Paused';
    case 'idle':
      return 'Idle';
    case 'error':
      return 'Error';
    default:
      return status;
  }
}

export function terminalLabel(app?: string): string {
  switch (app) {
    case 'tmux': return 'tmux';
    case 'iterm2': return 'iTerm';
    case 'warp': return 'Warp';
    case 'terminal': return 'Terminal';
    case 'windows-terminal': return 'Windows Terminal';
    case 'conemu': return 'ConEmu';
    case 'pwsh': return 'PowerShell';
    case 'cmd': return 'CMD';
    case 'mintty': return 'Git Bash';
    default: return '';
  }
}

export function formatFullDate(date: string): string {
  if (!date) return '';
  return new Date(date).toLocaleString();
}

/**
 * Extract the last meaningful segment from a project path.
 * e.g. "alice/code/my-app" → "my-app"
 */
export function shortProject(project: string): string {
  const parts = project.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? project;
}

/**
 * Returns a human-readable display name for a session.
 * Prioritises descriptive fields over raw IDs / long paths.
 */
export function getSessionDisplayName(
  session: { initialPrompt?: string; latestPrompt?: string; project?: string; slug?: string; gitBranch?: string; id: string },
  teamInfo?: { teamName: string; memberName: string } | null,
  maxLen = 80,
): string {
  if (teamInfo) return `${teamInfo.teamName} / ${teamInfo.memberName}`;
  if (session.initialPrompt) return truncate(session.initialPrompt, maxLen);
  if (session.latestPrompt) return truncate(session.latestPrompt, maxLen);
  if (session.slug) return session.slug;
  if (session.project && session.project !== 'unknown') return shortProject(session.project);
  if (session.gitBranch && session.gitBranch !== 'main') return session.gitBranch;
  return session.id.slice(0, 12);
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '…' : s;
}
