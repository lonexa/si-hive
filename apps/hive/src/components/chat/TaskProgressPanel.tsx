import { CheckCircle2, Loader2 } from 'lucide-react';
import type { ChatMessage } from '@/stores/chat-store';
import { useChatStore } from '@/stores/chat-store';

const TOOL_LABELS: Record<string, string> = {
  Read: 'Reading file',
  Write: 'Creating file',
  Edit: 'Editing file',
  Bash: 'Running command',
  Grep: 'Searching code',
  Glob: 'Finding files',
  WebSearch: 'Searching the web',
  WebFetch: 'Fetching web page',
  Agent: 'Delegating to agent',
  TaskCreate: 'Creating task',
  TaskUpdate: 'Updating task',
};

interface Props {
  messages: ChatMessage[];
}

export default function TaskProgressPanel({ messages }: Props) {
  const { toolProgress, status } = useChatStore();

  // Extract completed tool steps from messages
  const toolSteps = messages
    .filter((m) => m.type === 'tool_use' && m.toolName)
    .map((m) => ({
      name: m.toolName!,
      label: TOOL_LABELS[m.toolName!] ?? m.toolName!,
      timestamp: m.timestamp,
    }));

  if (toolSteps.length === 0 && !toolProgress) {
    return (
      <div className="w-[280px] border-l border-border bg-card p-4 hidden lg:block">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
          Activity
        </h3>
        <p className="text-xs text-muted-foreground">
          Tool activity will appear here as Claude works.
        </p>
      </div>
    );
  }

  return (
    <div className="w-[280px] border-l border-border bg-card p-4 overflow-y-auto hidden lg:block">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
        Activity
      </h3>
      <div className="space-y-2">
        {toolSteps.map((step, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
            <span className="text-foreground truncate">{step.label}</span>
            <span className="text-muted-foreground ml-auto text-[10px] shrink-0">
              {new Date(step.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        ))}

        {toolProgress && status === 'working' && (
          <div className="flex items-center gap-2 text-xs">
            <Loader2 className="h-3.5 w-3.5 text-blue-400 shrink-0 animate-spin" />
            <span className="text-blue-400 truncate">{toolProgress.detail}</span>
          </div>
        )}
      </div>
    </div>
  );
}
