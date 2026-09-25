import { useState } from 'react';
import { Timer, Plus, Square, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { LiveLoop } from '@/stores/types';

import { API_BASE } from '@/lib/api-config';

const INTERVAL_PRESETS = ['30s', '1m', '5m', '15m', '30m', '1h'] as const;

interface LiveLoopsPanelProps {
  sessionId: string;
  loops: LiveLoop[];
}

export default function LiveLoopsPanel({ sessionId, loops }: LiveLoopsPanelProps) {
  const [showForm, setShowForm] = useState(false);
  const [interval, setInterval] = useState('5m');
  const [prompt, setPrompt] = useState('');
  const [sending, setSending] = useState(false);

  const activeLoops = loops.filter((l) => l.status === 'active');

  async function handleCreate() {
    if (!prompt.trim() || !interval) return;
    setSending(true);
    try {
      const res = await fetch(`${API_BASE}/api/loops/${encodeURIComponent(sessionId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interval, prompt: prompt.trim() }),
      });
      if (res.ok) {
        setPrompt('');
        setShowForm(false);
      }
    } catch {
      // ignore
    } finally {
      setSending(false);
    }
  }

  async function handleStop(loopId: string) {
    try {
      await fetch(`${API_BASE}/api/loops/${encodeURIComponent(loopId)}`, {
        method: 'DELETE',
      });
    } catch {
      // ignore
    }
  }

  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-medium text-foreground">
          <Timer className="h-3.5 w-3.5" />
          Live Loops
          {activeLoops.length > 0 && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
              {activeLoops.length}
            </Badge>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => setShowForm(!showForm)}
        >
          <Plus className="h-3 w-3 mr-1" />
          Add
        </Button>
      </div>

      {/* Add loop form */}
      {showForm && (
        <div className="space-y-2 p-2 rounded-md border border-border bg-card">
          <div className="flex gap-1 flex-wrap">
            {INTERVAL_PRESETS.map((preset) => (
              <button
                key={preset}
                onClick={() => setInterval(preset)}
                className={cn(
                  'px-2 py-0.5 text-[10px] rounded border',
                  interval === preset
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-border text-muted-foreground hover:text-foreground hover:border-foreground/20'
                )}
              >
                {preset}
              </button>
            ))}
          </div>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="What should AI do on each loop?"
            className="w-full h-16 text-xs p-2 rounded border border-border bg-background text-foreground resize-none focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <div className="flex gap-2 justify-end">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => setShowForm(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-6 px-2 text-xs"
              disabled={!prompt.trim() || sending}
              onClick={() => void handleCreate()}
            >
              {sending ? 'Sending...' : 'Send /loop'}
            </Button>
          </div>
        </div>
      )}

      {/* Active loops */}
      {activeLoops.length === 0 && !showForm && (
        <p className="text-xs text-muted-foreground py-2">
          No active loops. Loops created from SI Hive are tracked here.
        </p>
      )}

      {loops.map((loop) => (
        <div
          key={loop.id}
          className={cn(
            'flex items-start gap-2 p-2 rounded-md border text-xs',
            loop.status === 'active'
              ? 'border-border bg-card'
              : 'border-border/50 bg-card/50 opacity-60'
          )}
        >
          <Clock className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
          <div className="flex-1 min-w-0 space-y-1">
            <div className="flex items-center gap-1.5">
              <Badge
                variant="outline"
                className={cn(
                  'text-[10px] px-1 py-0',
                  loop.status === 'active' && 'text-green-400 border-green-800',
                  loop.status === 'stopped' && 'text-muted-foreground',
                  loop.status === 'session_ended' && 'text-yellow-500 border-yellow-800',
                )}
              >
                {loop.interval}
              </Badge>
              <Badge
                variant="outline"
                className={cn(
                  'text-[10px] px-1 py-0',
                  loop.status === 'active' && 'text-green-400 border-green-800',
                  loop.status !== 'active' && 'text-muted-foreground',
                )}
              >
                {loop.status}
              </Badge>
            </div>
            <p className="text-muted-foreground truncate">{loop.prompt}</p>
          </div>
          {loop.status === 'active' && (
            <Button
              variant="ghost"
              size="sm"
              className="h-5 w-5 p-0 shrink-0 text-muted-foreground hover:text-red-400"
              onClick={() => void handleStop(loop.id)}
              title="Stop loop"
            >
              <Square className="h-3 w-3" />
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}
