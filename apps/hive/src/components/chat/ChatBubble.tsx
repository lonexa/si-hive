import { User, Bot, ChevronDown, CheckCircle2 } from 'lucide-react';
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import MessageActions from './MessageActions';
import type { ChatMessage } from '@/stores/chat-store';

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

function friendlyToolName(name: string): string {
  return TOOL_LABELS[name] ?? name;
}

function extractPreview(content: string, toolName?: string | null): string {
  if (!content) return '';
  // For Read/Edit/Write, try to extract a file path
  if (toolName && ['Read', 'Write', 'Edit'].includes(toolName)) {
    const pathMatch = content.match(/"file_path"\s*:\s*"([^"]+)"/);
    if (pathMatch) return pathMatch[1].split(/[\\/]/).pop() ?? pathMatch[1];
  }
  // For Bash, try to extract the command
  if (toolName === 'Bash') {
    const cmdMatch = content.match(/"command"\s*:\s*"([^"]+)"/);
    if (cmdMatch) return cmdMatch[1].slice(0, 40);
  }
  return content.slice(0, 40).replace(/\n/g, ' ');
}

interface Props {
  message: ChatMessage;
  toolResult?: ChatMessage;
  onRetry?: () => void;
}

export default function ChatBubble({ message, toolResult, onRetry }: Props) {
  const [expanded, setExpanded] = useState(false);

  // Tool use card
  if (message.type === 'tool_use') {
    const preview = extractPreview(message.content, message.toolName);
    return (
      <div className="flex gap-2 my-1">
        <div className="flex-1 min-w-0 max-w-[90%]">
          <Collapsible open={expanded} onOpenChange={setExpanded}>
            <CollapsibleTrigger asChild>
              <button className="flex items-center gap-2 text-xs font-medium text-blue-400 hover:text-blue-300 bg-muted border border-border rounded-lg px-3 py-2 w-full text-left transition-colors">
                <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                <span className="flex-1">{friendlyToolName(message.toolName ?? '')}</span>
                {preview && <span className="text-[10px] text-muted-foreground truncate max-w-[200px] font-mono">{preview}</span>}
                <ChevronDown className={`h-3 w-3 transition-transform duration-200 shrink-0 ${expanded ? 'rotate-180' : ''}`} />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="ml-4 mt-1 border-l-2 border-border pl-3">
                <pre className="text-[11px] text-muted-foreground bg-secondary rounded-md p-2 overflow-x-auto whitespace-pre-wrap break-words max-h-[200px] overflow-y-auto">
                  {message.content}
                </pre>
                {toolResult && (
                  <pre className="mt-1 text-[11px] text-muted-foreground bg-secondary rounded-md p-2 overflow-x-auto whitespace-pre-wrap break-words max-h-[200px] overflow-y-auto">
                    {toolResult.content}
                  </pre>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>
      </div>
    );
  }

  // Tool result (rendered inline with tool_use above, skip standalone)
  if (message.type === 'tool_result') {
    return null;
  }

  // Regular user/assistant message
  const isUser = message.role === 'user';

  function handleCopy() {
    void navigator.clipboard.writeText(message.content);
  }

  return (
    <div className={`flex gap-2 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div className="shrink-0 mt-1">
        {isUser ? (
          <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center">
            <User className="h-3.5 w-3.5 text-primary-foreground" />
          </div>
        ) : (
          <div className="w-7 h-7 rounded-full bg-green-600 flex items-center justify-center">
            <Bot className="h-3.5 w-3.5 text-white" />
          </div>
        )}
      </div>
      <div className={`flex-1 min-w-0 max-w-[80%] ${isUser ? 'text-right' : ''}`}>
        <div className="relative group inline-block">
          <div
            className={`inline-block rounded-2xl px-4 py-2.5 text-sm ${
              isUser
                ? 'bg-primary text-primary-foreground rounded-br-sm'
                : 'bg-secondary text-foreground rounded-bl-sm'
            }`}
          >
            {isUser ? (
              <div className="whitespace-pre-wrap break-words">{message.content}</div>
            ) : (
              <div className="prose prose-sm prose-invert max-w-none break-words [&_pre]:bg-background [&_pre]:rounded-md [&_pre]:p-3 [&_pre]:text-xs [&_pre]:overflow-x-auto [&_code]:bg-background/50 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-xs [&_a]:text-primary [&_a]:underline [&_table]:text-xs [&_th]:px-2 [&_th]:py-1 [&_td]:px-2 [&_td]:py-1 [&_p]:mb-2 [&_p:last-child]:mb-0 [&_ul]:mb-2 [&_ol]:mb-2 [&_li]:mb-0.5">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {message.content}
                </ReactMarkdown>
              </div>
            )}
          </div>

          {/* Hover actions */}
          <MessageActions
            isUser={isUser}
            onCopy={handleCopy}
            onRetry={!isUser ? onRetry : undefined}
          />
        </div>
        {message.timestamp && (
          <div className="text-[10px] text-muted-foreground mt-0.5">
            {new Date(message.timestamp).toLocaleTimeString()}
          </div>
        )}
      </div>
    </div>
  );
}
