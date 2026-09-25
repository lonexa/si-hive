import { useState, useRef } from 'react';
import { X, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PROVIDER_SHORT_NAMES, type ProviderId } from '@/lib/launch-flags';
import TerminalView from './TerminalView';

interface ConsultPanelProps {
  sourceSessionId: string;
  targetProvider: ProviderId;
  command: string;
  args: string[];
  initialPrompt: string;
  cwd?: string;
  onClose: () => void;
}

export default function ConsultPanel({
  sourceSessionId,
  targetProvider,
  command,
  args,
  initialPrompt,
  cwd,
  onClose,
}: ConsultPanelProps) {
  // Stable terminal ID — must not change across re-renders or StrictMode double-mount
  const terminalIdRef = useRef(`consult-${sourceSessionId}-${targetProvider}-${Date.now()}`);
  const terminalId = terminalIdRef.current;
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex flex-col h-full border-l border-border bg-background">
      {/* Header */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-border bg-card">
        <Eye className="h-4 w-4 text-muted-foreground" />
        <span className="text-xs font-medium text-foreground">
          Second Opinion
        </span>
        <span className="text-[10px] font-mono rounded bg-accent px-1 py-0.5 text-muted-foreground">
          {PROVIDER_SHORT_NAMES[targetProvider]}
        </span>
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => {
            // Try to select all text in the terminal for copying
            const el = document.querySelector(`[data-terminal-id="${terminalId}"]`);
            if (el) {
              const text = el.textContent ?? '';
              navigator.clipboard.writeText(text).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              });
            }
          }}
        >
          {copied ? 'Copied!' : 'Copy Output'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
          onClick={onClose}
          title="Close consult panel"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Terminal */}
      <div className="flex-1 min-h-0">
        <TerminalView
          terminalId={terminalId}
          cwd={cwd}
          command={command}
          args={args}
          initialPrompt={initialPrompt}
          provider={targetProvider}
        />
      </div>
    </div>
  );
}
