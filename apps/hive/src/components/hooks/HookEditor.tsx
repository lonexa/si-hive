import { useState } from 'react';
import { ArrowLeft, Save, Loader2, CheckCircle2, AlertTriangle, Code2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { API_BASE } from '@/lib/api-config';
import type { HookEntry, HookScope } from './HooksPage';

const EVENTS = [
  'PreToolUse',
  'PostToolUse',
  'UserPromptSubmit',
  'Notification',
  'Stop',
  'SubagentStop',
  'PreCompact',
  'SessionStart',
  'SessionEnd',
] as const;

// Only these events use a matcher, and against different values.
const MATCHER_HINTS: Record<string, string> = {
  PreToolUse: 'Tool name — e.g. Write|Edit, Bash, mcp__.*  (blank = all)',
  PostToolUse: 'Tool name — e.g. Write|Edit, Bash, mcp__.*  (blank = all)',
  SessionStart: 'Source — startup, resume, clear, compact  (blank = all)',
  Notification: 'Type — idle_prompt, permission_prompt  (blank = all)',
  SubagentStop: 'Agent type — e.g. general-purpose  (blank = all)',
};

interface HookObject {
  type: 'command' | 'http';
  command?: string;
  url?: string;
  headers?: Record<string, string>;
  timeout?: number;
  statusMessage?: string;
  [key: string]: unknown;
}

export default function HookEditor({
  hook,
  scope,
  projectDir,
  onClose,
  onSaved,
}: {
  hook?: HookEntry;
  scope: HookScope;
  projectDir: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = !hook;
  const [event, setEvent] = useState<string>(hook?.event ?? 'PostToolUse');
  const [matcher, setMatcher] = useState(hook?.matcher ?? '');
  const [type, setType] = useState<'command' | 'http'>((hook?.type as 'command' | 'http') ?? 'command');
  const [command, setCommand] = useState(hook?.command ?? '');
  const [url, setUrl] = useState(hook?.url ?? '');
  const [timeout, setTimeout] = useState<string>(hook?.timeout != null ? String(hook.timeout) : '');
  const [statusMessage, setStatusMessage] = useState(hook?.statusMessage ?? '');
  const [jsonMode, setJsonMode] = useState(false);
  const [rawJson, setRawJson] = useState('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [error, setError] = useState('');

  const supportsMatcher = event in MATCHER_HINTS;

  function buildHookObj(): HookObject {
    const obj: HookObject = { type };
    if (type === 'command') obj.command = command;
    else obj.url = url;
    if (timeout.trim()) obj.timeout = Number(timeout);
    if (statusMessage.trim()) obj.statusMessage = statusMessage.trim();
    return obj;
  }

  function toggleJsonMode() {
    if (!jsonMode) {
      // form -> json
      setRawJson(JSON.stringify(buildHookObj(), null, 2));
      setJsonMode(true);
    } else {
      // json -> form: try to parse back into the form fields
      try {
        const parsed = JSON.parse(rawJson) as HookObject;
        setType((parsed.type as 'command' | 'http') ?? 'command');
        setCommand(parsed.command ?? '');
        setUrl(parsed.url ?? '');
        setTimeout(parsed.timeout != null ? String(parsed.timeout) : '');
        setStatusMessage(parsed.statusMessage ?? '');
        setError('');
        setJsonMode(false);
      } catch {
        setError('Raw JSON is invalid — fix it before switching back to the form');
      }
    }
  }

  async function handleSave() {
    setError('');

    let hookObj: HookObject;
    if (jsonMode) {
      try {
        hookObj = JSON.parse(rawJson) as HookObject;
      } catch {
        setError('Raw JSON is invalid');
        return;
      }
      if (!hookObj.type) {
        setError('Hook JSON must include a "type" field (command or http)');
        return;
      }
    } else {
      if (type === 'command' && !command.trim()) {
        setError('Command is required');
        return;
      }
      if (type === 'http' && !url.trim()) {
        setError('URL is required');
        return;
      }
      hookObj = buildHookObj();
    }

    setSaveStatus('saving');
    try {
      const res = await fetch(`${API_BASE}/api/hooks`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope,
          projectDir: scope === 'project' ? projectDir : undefined,
          event,
          matcher: supportsMatcher ? matcher.trim() : '',
          hookObj,
          originalId: hook?.id,
        }),
      });
      if (res.ok) {
        setSaveStatus('saved');
        window.setTimeout(() => onSaved(), 400);
      } else {
        const data = (await res.json()) as { error?: string };
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
          <span className="text-sm font-medium text-foreground">{isNew ? 'New Hook' : `Edit ${event} hook`}</span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={toggleJsonMode} className="gap-1.5">
            <Code2 className="h-3.5 w-3.5" />
            {jsonMode ? 'Form' : 'Raw JSON'}
          </Button>
          <Button size="sm" onClick={() => void handleSave()} disabled={saveStatus === 'saving'} className="gap-1.5">
            {saveStatus === 'saving' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : saveStatus === 'saved' ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            Save
          </Button>
        </div>
      </div>

      {/* Security warning — hooks run arbitrary shell commands with the user's privileges */}
      <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2">
        <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
        <p className="text-xs text-amber-200/90">
          Hooks run shell commands automatically with your full user privileges. Only add commands you trust —
          a malicious hook can read credentials or run arbitrary code.
        </p>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="text-sm font-medium text-foreground">Event</label>
          <select
            value={event}
            onChange={(e) => setEvent(e.target.value)}
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {EVENTS.map((ev) => (
              <option key={ev} value={ev}>{ev}</option>
            ))}
          </select>
        </div>
        {supportsMatcher && (
          <div>
            <label className="text-sm font-medium text-foreground">Matcher</label>
            <input
              type="text"
              value={matcher}
              onChange={(e) => setMatcher(e.target.value)}
              placeholder={MATCHER_HINTS[event]}
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        )}
      </div>

      {jsonMode ? (
        <div className="flex flex-col flex-1">
          <label className="text-sm font-medium text-foreground mb-1">Hook JSON</label>
          <p className="text-xs text-muted-foreground mb-2">
            The object stored under <code className="bg-secondary px-1 rounded">hooks.{event}[].hooks[]</code>
          </p>
          <textarea
            value={rawJson}
            onChange={(e) => setRawJson(e.target.value)}
            className="flex-1 min-h-[260px] rounded-md border border-border bg-background px-4 py-3 text-sm font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none"
          />
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium text-foreground">Type</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as 'command' | 'http')}
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="command">command</option>
                <option value="http">http</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">Timeout (seconds, optional)</label>
              <input
                type="number"
                value={timeout}
                onChange={(e) => setTimeout(e.target.value)}
                placeholder="30"
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </div>

          {type === 'command' ? (
            <div>
              <label className="text-sm font-medium text-foreground">Command</label>
              <textarea
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder={'npx prettier --write "$CLAUDE_PROJECT_DIR/$file"'}
                className="mt-1 w-full min-h-[120px] rounded-md border border-border bg-background px-4 py-3 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-y"
              />
            </div>
          ) : (
            <div>
              <label className="text-sm font-medium text-foreground">URL</label>
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="http://localhost:3000/hooks/audit"
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Use <Badge variant="outline" className="text-[10px]">Raw JSON</Badge> to add headers / allowedEnvVars.
              </p>
            </div>
          )}

          <div>
            <label className="text-sm font-medium text-foreground">Status message (optional)</label>
            <input
              type="text"
              value={statusMessage}
              onChange={(e) => setStatusMessage(e.target.value)}
              placeholder="Formatting..."
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </div>
      )}
    </div>
  );
}
