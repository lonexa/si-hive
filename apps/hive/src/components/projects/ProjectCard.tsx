import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { GitBranch, FileText, Monitor, Clock, ScrollText, Plus, ChevronDown, EyeOff, Eye } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import AISessionButton from '@/components/shared/AISessionButton';
import GenericLaunchDialog from '@/components/shared/GenericLaunchDialog';
import { useAISession } from '@/hooks/useAISession';
import { useIncognito } from '@/hooks/useIncognito';
import { projectGeneral } from '@/lib/prompt-templates';
import { getProviderStatus, getPrimaryProviderId, PROVIDER_SHORT_NAMES } from '@/lib/launch-flags';
import type { CodexReasoningEffort, ProviderId, ProviderStatus } from '@/lib/launch-flags';
import type { ProjectInfo } from './ProjectsPage';

function timeAgo(dateStr?: string): string {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function ProjectCard({ project, selectedProvider: parentProvider }: { project: ProjectInfo; selectedProvider?: ProviderId }) {
  const navigate = useNavigate();
  const { launchSession } = useAISession();
  const { canToggle, busy: incognitoBusy, notice: incognitoNotice, isProjectIncognito, toggleProject } = useIncognito();
  const incognito = isProjectIncognito(project.path);
  const encoded = encodeURIComponent(project.path);
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<ProviderId>(parentProvider ?? 'claude');
  const [providerMenuOpen, setProviderMenuOpen] = useState(false);
  const [launchOpen, setLaunchOpen] = useState(false);
  const chevronRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getProviderStatus().then((ps) => {
      setProviders(ps.filter((p) => p.enabled));
    });
    if (!parentProvider) {
      getPrimaryProviderId().then(setSelectedProvider);
    }
  }, []);

  // Sync with parent provider selection
  useEffect(() => {
    if (parentProvider) setSelectedProvider(parentProvider);
  }, [parentProvider]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!providerMenuOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        chevronRef.current?.contains(target) ||
        dropdownRef.current?.contains(target)
      ) return;
      setProviderMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [providerMenuOpen]);

  return (
    <Card className="hover:border-primary/30 transition-colors">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between">
          <div className="min-w-0">
            <h3 className="text-sm font-medium text-foreground truncate">{project.name}</h3>
            <p className="text-xs text-muted-foreground truncate mt-0.5 font-mono">{project.path}</p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0 ml-2">
            {incognito && (
              <Badge
                variant="outline"
                className="gap-1 border-violet-500/40 text-violet-300"
                title="Incognito project — no session from here is logged off this machine"
              >
                <EyeOff className="h-3 w-3" />
                Incognito
              </Badge>
            )}
            {project.sessionCount > 0 && (
              <Badge variant="secondary" className="gap-1" title="Active sessions">
                <Monitor className="h-3 w-3" />
                {project.sessionCount}
              </Badge>
            )}
            {project.totalSessions > 0 && (
              <Badge variant="outline" className="text-[10px] gap-1" title="Total sessions">
                <ScrollText className="h-3 w-3" />
                {project.totalSessions}
              </Badge>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {project.hasGit && (
            <Badge variant="outline" className="text-[10px] gap-1">
              <GitBranch className="h-3 w-3" />
              {project.gitBranch || 'git'}
            </Badge>
          )}
          {project.hasCLAUDEmd && (
            <Badge variant="outline" className="text-[10px] gap-1">
              <FileText className="h-3 w-3" />
              CLAUDE.md
            </Badge>
          )}
          {project.instructionFiles?.gemini && (
            <Badge variant="outline" className="text-[10px] gap-1">
              <FileText className="h-3 w-3" />
              GEMINI.md
            </Badge>
          )}
          {project.instructionFiles?.codex && (
            <Badge variant="outline" className="text-[10px] gap-1">
              <FileText className="h-3 w-3" />
              AGENTS.md
            </Badge>
          )}
          {project.lastActivity && (
            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {timeAgo(project.lastActivity)}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 pt-1">
          <Button
            size="sm"
            variant="outline"
            className="text-xs h-7"
            onClick={() => navigate(`/sessions?project=${encodeURIComponent(project.path)}`)}
          >
            Sessions
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="text-xs h-7"
            onClick={() => navigate(`/projects/${encoded}/claude-md?provider=${selectedProvider}`)}
          >
            Instructions
          </Button>
          <div className="inline-flex">
            <Button
              size="sm"
              className={`text-xs h-7 gap-1 ${providers.length > 1 ? 'rounded-r-none' : ''}`}
              onClick={() => setLaunchOpen(true)}
            >
              <Plus className="h-3 w-3" />
              AI
            </Button>
            {providers.length > 1 && (
              <Button
                ref={chevronRef}
                size="sm"
                className="text-xs h-7 px-1 rounded-l-none border-l border-primary-foreground/20"
                onClick={() => setProviderMenuOpen((prev) => !prev)}
              >
                <ChevronDown className="h-3 w-3" />
              </Button>
            )}
            {providerMenuOpen && chevronRef.current && createPortal(
              <div
                ref={dropdownRef}
                style={{
                  position: 'fixed',
                  top: chevronRef.current.getBoundingClientRect().bottom + 4,
                  left: chevronRef.current.getBoundingClientRect().right - 140,
                  zIndex: 9999,
                }}
                className="min-w-[140px] rounded-md border border-border bg-popover py-1 shadow-lg"
              >
                {providers.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setSelectedProvider(p.id);
                      setProviderMenuOpen(false);
                    }}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-xs transition-colors
                      ${p.id === selectedProvider
                        ? 'bg-accent text-accent-foreground'
                        : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                      }`}
                  >
                    <span className="font-mono text-[10px] rounded bg-muted px-1 py-0.5">{PROVIDER_SHORT_NAMES[p.id]}</span>
                    <span>{p.displayName}</span>
                    {p.isPrimary && <span className="text-[10px] text-amber-400 ml-auto">★</span>}
                  </button>
                ))}
              </div>,
              document.body
            )}
          </div>
          <AISessionButton
            cwd={project.path}
            prompt={projectGeneral(project.name, project.path)}
            variant="icon-only"
            size="icon"
            tooltip="Open in AI"
            providerId={selectedProvider}
          />
          {canToggle && (
            <div className="flex items-center gap-1 ml-auto">
              {/* One-off incognito session from a normal project. Redundant on
                  an incognito project, where every session is already private. */}
              {!incognito && (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs h-7 gap-1 border-violet-500/40 text-violet-300 hover:bg-violet-500/10"
                  title="Start a session that is never logged off this machine"
                  onClick={() => void launchSession({
                    cwd: project.path,
                    prompt: '',
                    providerId: selectedProvider,
                    incognito: true,
                  })}
                >
                  <EyeOff className="h-3 w-3" />
                  Incognito
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                disabled={incognitoBusy}
                className={`text-xs h-7 gap-1 ${incognito ? 'text-violet-300' : 'text-muted-foreground'}`}
                title={incognito
                  ? 'Stop treating this project as incognito'
                  : 'Mark this project incognito — every session started from it stays on this machine'}
                onClick={() => void toggleProject(project.path, !incognito)}
              >
                {incognito ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                {incognito ? 'Turn off' : 'Go incognito'}
              </Button>
            </div>
          )}
        </div>
        {/* What the last toggle cleared out of team analytics, or why it couldn't. */}
        {canToggle && incognito && incognitoNotice && (
          <p className="text-[11px] text-violet-300/80 mt-2">{incognitoNotice}</p>
        )}
      </CardContent>
      <GenericLaunchDialog
        open={launchOpen}
        onOpenChange={setLaunchOpen}
        label="Start AI Session"
        subtitle={project.name}
        suggestedPrompt=""
        projectDir={project.path}
        availableDirs={[project.path]}
        initialProvider={selectedProvider}
        onLaunch={(
          finalPrompt: string,
          projectDir: string,
          providerId?: ProviderId,
          options?: { model?: string; reasoningEffort?: CodexReasoningEffort; accountId?: string },
        ) => {
          setLaunchOpen(false);
          void launchSession({
            cwd: projectDir,
            prompt: finalPrompt,
            providerId: providerId ?? selectedProvider,
            model: options?.model,
            reasoningEffort: options?.reasoningEffort,
            accountId: options?.accountId,
          });
        }}
      />
    </Card>
  );
}
