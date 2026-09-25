import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Save, Loader2, CheckCircle2, FileText, Plus, Copy } from 'lucide-react';

import { API_BASE } from '@/lib/api-config';

type Provider = 'claude' | 'gemini' | 'codex';

const PROVIDER_FILES: Record<Provider, string> = {
  claude: 'CLAUDE.md',
  gemini: 'GEMINI.md',
  codex: 'AGENTS.md',
};

interface Props {
  encodedPath?: string;
  mode?: 'project' | 'global';
}

export default function ClaudeMdEditor({ encodedPath, mode = 'project' }: Props) {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [exists, setExists] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [activeFile, setActiveFile] = useState<'project' | 'global'>(mode);
  const [provider, setProvider] = useState<Provider>('claude');
  const [allStatus, setAllStatus] = useState<Record<string, { exists: boolean }>>({});
  const [copying, setCopying] = useState(false);
  const [copyResult, setCopyResult] = useState<string | null>(null);

  // Fetch which instruction files exist for this project
  useEffect(() => {
    if (!encodedPath || activeFile === 'global') return;
    fetch(`${API_BASE}/api/projects/${encodeURIComponent(encodedPath)}/instructions/all`)
      .then(r => r.json())
      .then(setAllStatus)
      .catch(() => {});
  }, [encodedPath, activeFile, saveStatus]); // re-fetch after save

  async function handleCopyToProviders() {
    if (!encodedPath) return;
    setCopying(true);
    setCopyResult(null);
    try {
      const res = await fetch(
        `${API_BASE}/api/projects/${encodeURIComponent(encodedPath)}/instructions/copy-to-providers?source=${provider}`,
        { method: 'POST' }
      );
      const data = await res.json();
      if (data.created?.length > 0) {
        setCopyResult(`Created: ${data.created.join(', ')}`);
      } else {
        setCopyResult('All providers already have instruction files');
      }
      setTimeout(() => setCopyResult(null), 4000);
      // Refresh status
      fetch(`${API_BASE}/api/projects/${encodeURIComponent(encodedPath)}/instructions/all`)
        .then(r => r.json())
        .then(setAllStatus)
        .catch(() => {});
    } catch {
      setCopyResult('Failed to copy');
    } finally {
      setCopying(false);
    }
  }

  useEffect(() => {
    setLoading(true);
    const url = activeFile === 'global'
      ? `${API_BASE}/api/instructions/global?provider=${provider}`
      : `${API_BASE}/api/projects/${encodeURIComponent(encodedPath ?? '')}/instructions?provider=${provider}`;

    fetch(url)
      .then((r) => r.json())
      .then((data: { content?: string; exists: boolean }) => {
        setContent(data.content ?? '');
        setExists(data.exists);
      })
      .catch(() => {
        setContent('');
        setExists(false);
      })
      .finally(() => setLoading(false));
  }, [encodedPath, activeFile, provider]);

  async function handleSave() {
    setSaveStatus('saving');
    const url = activeFile === 'global'
      ? `${API_BASE}/api/instructions/global?provider=${provider}`
      : `${API_BASE}/api/projects/${encodeURIComponent(encodedPath ?? '')}/instructions?provider=${provider}`;

    try {
      const res = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      if (res.ok) {
        setExists(true);
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 2000);
      }
    } catch {
      setSaveStatus('idle');
    }
  }

  const placeholders: Record<Provider, string> = {
    claude: '# Project Instructions\n\nWrite instructions for AI here...',
    gemini: '# Project Instructions\n\nWrite instructions for Gemini here...',
    codex: '# Project Instructions\n\nWrite instructions for Codex here...',
  };

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="shrink-0">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Instructions Editor
          </CardTitle>
          <div className="flex items-center gap-2">
            {/* Provider tabs */}
            <div className="flex border border-border rounded-md overflow-hidden">
              {(Object.keys(PROVIDER_FILES) as Provider[]).map((p, i) => (
                <button
                  key={p}
                  onClick={() => setProvider(p)}
                  className={`px-2 py-1 text-xs ${i > 0 ? 'border-l border-border' : ''} ${provider === p ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  {PROVIDER_FILES[p]}
                </button>
              ))}
            </div>

            {/* Project / Global toggle */}
            {encodedPath && (
              <div className="flex border border-border rounded-md overflow-hidden">
                <button
                  onClick={() => setActiveFile('project')}
                  className={`px-2 py-1 text-xs ${activeFile === 'project' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  Project
                </button>
                <button
                  onClick={() => setActiveFile('global')}
                  className={`px-2 py-1 text-xs border-l border-border ${activeFile === 'global' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  Global
                </button>
              </div>
            )}
            <Button size="sm" variant="outline" onClick={() => void handleSave()} disabled={saveStatus === 'saving'} className="gap-1.5">
              {saveStatus === 'saving' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : saveStatus === 'saved' ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />
              ) : !exists ? (
                <Plus className="h-3.5 w-3.5" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              {!exists ? 'Create' : 'Save'}
            </Button>
            {/* Copy to missing providers — only show when current provider has content and others are missing */}
            {exists && activeFile === 'project' && Object.entries(allStatus).some(([pid, s]) => pid !== provider && !s.exists) && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void handleCopyToProviders()}
                disabled={copying}
                className="gap-1.5"
                title="Copy this content to providers that don't have an instruction file yet"
              >
                {copying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Copy className="h-3.5 w-3.5" />}
                Copy to others
              </Button>
            )}
            {copyResult && <span className="text-xs text-green-500">{copyResult}</span>}
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex-1 min-h-0">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="w-full h-full min-h-[300px] rounded-md border border-border bg-background px-4 py-3 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none"
            placeholder={placeholders[provider]}
          />
        )}
      </CardContent>
    </Card>
  );
}
