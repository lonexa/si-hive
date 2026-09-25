import { useState } from 'react';
import { ArrowLeft, Save, Loader2, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

import { API_BASE } from '@/lib/api-config';

interface AgentInfo {
  filename: string;
  name: string;
  description: string;
  content: string;
}

interface Props {
  agent?: AgentInfo;
  onClose: () => void;
  onSaved: () => void;
}

export default function AgentEditor({ agent, onClose, onSaved }: Props) {
  const isNew = !agent;
  const [filename, setFilename] = useState(agent?.filename ?? '');
  const [content, setContent] = useState(agent?.content ?? '---\ndescription: \n---\n\n# Agent Name\n\nInstructions for this agent...\n');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [error, setError] = useState('');

  async function handleSave() {
    setError('');
    const fname = filename.endsWith('.md') ? filename : `${filename}.md`;
    if (!fname || fname === '.md') {
      setError('Filename is required');
      return;
    }

    setSaveStatus('saving');
    try {
      const res = await fetch(`${API_BASE}/api/agents/${encodeURIComponent(fname)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      if (res.ok) {
        setSaveStatus('saved');
        setTimeout(() => onSaved(), 500);
      } else {
        const data = await res.json() as { error?: string };
        setError(data.error ?? 'Failed to save');
        setSaveStatus('idle');
      }
    } catch {
      setError('Network error');
      setSaveStatus('idle');
    }
  }

  return (
    <div className="flex flex-col h-full space-y-4">
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onClose} className="gap-1.5 text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
          <div className="h-4 w-px bg-border" />
          <span className="text-sm font-medium text-foreground">
            {isNew ? 'New Agent' : agent.filename}
          </span>
        </div>
        <Button size="sm" onClick={() => void handleSave()} disabled={saveStatus === 'saving'} className="gap-1.5">
          {saveStatus === 'saving' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> :
           saveStatus === 'saved' ? <CheckCircle2 className="h-3.5 w-3.5 text-green-400" /> :
           <Save className="h-3.5 w-3.5" />}
          Save
        </Button>
      </div>

      {isNew && (
        <div>
          <label className="text-sm font-medium text-foreground">Filename</label>
          <input
            type="text"
            value={filename}
            onChange={(e) => setFilename(e.target.value)}
            placeholder="my-agent.md"
            className="mt-1 w-full max-w-xs rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}

      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        className="flex-1 min-h-[300px] rounded-md border border-border bg-background px-4 py-3 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none"
      />
    </div>
  );
}
