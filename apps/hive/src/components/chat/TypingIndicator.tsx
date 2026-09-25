import { Bot } from 'lucide-react';

interface Props {
  text?: string;
}

export default function TypingIndicator({ text }: Props) {
  return (
    <div className="flex gap-2">
      <div className="shrink-0 mt-1">
        <div className="w-7 h-7 rounded-full bg-green-600 flex items-center justify-center">
          <Bot className="h-3.5 w-3.5 text-white" />
        </div>
      </div>
      <div className="inline-block rounded-2xl rounded-bl-sm bg-secondary px-4 py-2.5">
        <div className="flex items-center gap-1.5">
          <div className="flex gap-1">
            <span className="w-1.5 h-1.5 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
            <span className="w-1.5 h-1.5 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
            <span className="w-1.5 h-1.5 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
          {text && (
            <span className="text-xs text-muted-foreground ml-2 max-w-[200px] truncate">
              {text}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
