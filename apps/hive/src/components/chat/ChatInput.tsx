import { useRef, useEffect, useState } from 'react';
import { Send, Square, X, Wand2, Bot } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';
import { useChatStore } from '@/stores/chat-store';
import ChatAttachMenu from './ChatAttachMenu';
import SlashCommandPalette from './SlashCommandPalette';

interface Props {
  onSend: (message: string) => void;
  onAbort: () => void;
  disabled?: boolean;
}

export default function ChatInput({ onSend, onAbort, disabled }: Props) {
  const {
    inputValue, setInputValue, status,
    activeSkills, activeAgents,
    removeActiveSkill, removeActiveAgent, clearActiveItems,
  } = useChatStore();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isWorking = status === 'working' || status === 'starting';
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [slashQuery, setSlashQuery] = useState('');
  const [isDragging, setIsDragging] = useState(false);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [inputValue]);

  // Focus textarea on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  function handleSend() {
    const trimmed = inputValue.trim();
    if (!trimmed || disabled) return;

    // Prepend active skills/agents context if any
    let message = trimmed;
    if (activeSkills.length > 0 || activeAgents.length > 0) {
      const context: string[] = [];
      if (activeSkills.length > 0) context.push(`Use skills: ${activeSkills.join(', ')}`);
      if (activeAgents.length > 0) context.push(`Use agents: ${activeAgents.join(', ')}`);
      message = `[${context.join('; ')}]\n\n${trimmed}`;
      clearActiveItems();
    }

    onSend(message);
    setInputValue('');
    setSlashMenuOpen(false);
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value;
    setInputValue(val);

    // Detect slash command trigger
    if (val === '/') {
      setSlashMenuOpen(true);
      setSlashQuery('');
    } else if (slashMenuOpen) {
      if (val.startsWith('/')) {
        setSlashQuery(val.slice(1));
      } else {
        setSlashMenuOpen(false);
      }
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (slashMenuOpen) {
      // Let SlashCommandPalette handle arrow keys, Enter, Escape
      if (['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(e.key)) {
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleSlashSelect() {
    setSlashMenuOpen(false);
    setInputValue('');
    textareaRef.current?.focus();
  }

  function handleSlashClose() {
    setSlashMenuOpen(false);
    setInputValue('');
    textareaRef.current?.focus();
  }

  const hasActiveItems = activeSkills.length > 0 || activeAgents.length > 0;

  return (
    <div
      className="border-t border-border bg-card relative"
      onDragEnter={() => setIsDragging(true)}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setIsDragging(false); }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); setIsDragging(false); }}
    >
      {/* Drag overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-10 bg-primary/5 border-2 border-dashed border-primary/30 rounded-lg flex items-center justify-center pointer-events-none">
          <div className="text-sm text-primary flex items-center gap-2">Drop files here</div>
        </div>
      )}

      {/* Active skills/agents badges */}
      {hasActiveItems && (
        <div className="flex flex-wrap items-center gap-1.5 px-3 pt-2">
          {activeSkills.map((skill) => (
            <Badge key={skill} variant="secondary" className="gap-1 pr-1 text-[11px] h-5">
              <Wand2 className="h-2.5 w-2.5 text-primary" />
              {skill}
              <button onClick={() => removeActiveSkill(skill)} className="ml-0.5 rounded-full hover:bg-destructive/20 p-0.5">
                <X className="h-2 w-2" />
              </button>
            </Badge>
          ))}
          {activeAgents.map((agent) => (
            <Badge key={agent} variant="secondary" className="gap-1 pr-1 text-[11px] h-5">
              <Bot className="h-2.5 w-2.5 text-green-500" />
              {agent}
              <button onClick={() => removeActiveAgent(agent)} className="ml-0.5 rounded-full hover:bg-destructive/20 p-0.5">
                <X className="h-2 w-2" />
              </button>
            </Badge>
          ))}
        </div>
      )}

      {/* Main input row */}
      <div className="flex items-end gap-2 p-3">
        {/* "+" attach button */}
        <ChatAttachMenu />

        {/* Textarea with slash command palette */}
        <div className="flex-1 relative">
          {slashMenuOpen && (
            <SlashCommandPalette
              query={slashQuery}
              onSelect={handleSlashSelect}
              onClose={handleSlashClose}
            />
          )}
          <textarea
            ref={textareaRef}
            value={inputValue}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder={isWorking ? 'Claude is working...' : 'Type a message... (/ for commands)'}
            disabled={disabled}
            rows={1}
            className="flex-1 w-full resize-none bg-secondary rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
          />
        </div>

        {/* Send/Stop button */}
        {isWorking ? (
          <Button
            data-track="chat.stop_generation"
            data-track-category="action"
            size="icon"
            variant="ghost"
            onClick={onAbort}
            className="shrink-0 h-10 w-10 rounded-xl bg-destructive/10 text-destructive hover:bg-destructive/20"
            title="Stop"
          >
            <Square className="h-4 w-4" />
          </Button>
        ) : (
          <Button
            data-track="chat.send_message"
            data-track-category="action"
            size="icon"
            onClick={handleSend}
            disabled={!inputValue.trim() || disabled}
            className="shrink-0 h-10 w-10 rounded-xl"
            title="Send"
          >
            <Send className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-3 pb-2 text-[10px] text-muted-foreground">
        <span>Enter to send, Shift+Enter for new line, / for commands</span>
        <div className="flex items-center gap-3">
          {inputValue.length > 0 && (
            <span className={inputValue.length > 4000 ? 'text-amber-500' : ''}>
              ~{Math.ceil(inputValue.length / 4)} tokens
            </span>
          )}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button className="h-4 w-4 rounded-full border border-border flex items-center justify-center hover:bg-secondary transition-colors">
                  <span className="text-[9px]">?</span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[200px] text-xs">
                <div className="space-y-1">
                  <div><kbd className="bg-secondary px-1 rounded text-[10px]">Enter</kbd> Send message</div>
                  <div><kbd className="bg-secondary px-1 rounded text-[10px]">Shift+Enter</kbd> New line</div>
                  <div><kbd className="bg-secondary px-1 rounded text-[10px]">/</kbd> Commands</div>
                </div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>
    </div>
  );
}
