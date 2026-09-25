import { useState, useEffect, useCallback, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CheckCircle2, AlertCircle, Loader2, RefreshCw, Download, GitCommitHorizontal, Circle } from 'lucide-react';
import { useDashboardStore } from '@/stores/dashboard-store';
import { API_BASE } from '@/lib/api-config';
import UpdateSourceCard from './UpdateSourceCard';

const CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutes

interface UpdateInfo {
  upToDate: boolean;
  currentCommit: string;
  remoteCommit: string;
  behindBy: number;
}

interface ChangelogEntry {
  commitId: string;
  message: string;
  author: string;
  date: string;
}

const STEP_LABELS: Record<string, string> = {
  starting: 'Preparing',
  downloading: 'Downloading',
  extracting: 'Extracting',
  copying: 'Copying files',
  versioning: 'Updating version',
  installing: 'Installing deps',
  building: 'Building',
  restarting: 'Restarting',
  done: 'Complete',
  error: 'Failed',
};

const STEP_ORDER = ['starting', 'downloading', 'extracting', 'copying', 'versioning', 'installing', 'building', 'restarting', 'done'];

export default function UpdatePage() {
  const setUpdatesAvailable = useDashboardStore((s) => s.setUpdatesAvailable);

  const [checkStatus, setCheckStatus] = useState<'idle' | 'checking' | 'checked' | 'error'>('idle');
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [applyStatus, setApplyStatus] = useState<'idle' | 'applying' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [changelog, setChangelog] = useState<ChangelogEntry[]>([]);
  const [currentStep, setCurrentStep] = useState('');
  const [stepDetail, setStepDetail] = useState('');
  const [completedSteps, setCompletedSteps] = useState<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const fetchChangelog = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/updates/changelog`);
      if (res.ok) {
        const entries = await res.json() as ChangelogEntry[];
        setChangelog(entries);
      }
    } catch {
      // silently fail
    }
  }, []);

  const checkForUpdates = useCallback(async (silent = false) => {
    if (!silent) setCheckStatus('checking');
    setMessage('');
    try {
      const res = await fetch(`${API_BASE}/api/updates/check`);
      const data = await res.json() as UpdateInfo & { error?: string };
      if ('error' in data && data.error) {
        if (!silent) {
          setCheckStatus('error');
          setMessage(data.error);
        }
      } else {
        setUpdateInfo(data);
        setCheckStatus('checked');
        setUpdatesAvailable(!data.upToDate);
        setLastChecked(new Date());
        if (!data.upToDate) void fetchChangelog();
        else setChangelog([]);
      }
    } catch {
      if (!silent) {
        setCheckStatus('error');
        setMessage('Network error — is the server running?');
      }
    }
  }, [setUpdatesAvailable, fetchChangelog]);

  // Check on mount and periodically
  useEffect(() => {
    void checkForUpdates();
    const interval = setInterval(() => void checkForUpdates(true), CHECK_INTERVAL);
    return () => clearInterval(interval);
  }, [checkForUpdates]);

  async function handleApplyUpdate() {
    setApplyStatus('applying');
    setCurrentStep('starting');
    setStepDetail('Preparing update...');
    setCompletedSteps([]);
    setMessage('');

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(`${API_BASE}/api/updates/apply`, {
        method: 'POST',
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        setApplyStatus('error');
        setMessage('Failed to start update');
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let prevStep = 'starting';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6)) as Record<string, unknown>;

            if (data.type === 'progress') {
              const step = data.step as string;
              const detail = data.detail as string;

              // Mark previous step as completed when moving to a new step
              if (prevStep && step !== prevStep) {
                setCompletedSteps(prev => prev.includes(prevStep) ? prev : [...prev, prevStep]);
              }
              prevStep = step;
              setCurrentStep(step);
              setStepDetail(detail);
            }

            if (data.type === 'result') {
              if (data.success) {
                setApplyStatus('success');
                setMessage('Update applied. Page will reload...');
                setUpdatesAvailable(false);
                setCompletedSteps(STEP_ORDER);
                setCurrentStep('done');
                setTimeout(() => window.location.reload(), 5000);
              } else {
                setApplyStatus('error');
                setMessage((data.message as string) || 'Update failed');
                setCurrentStep('error');
              }
            }
          } catch {
            // skip malformed SSE lines
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setApplyStatus('error');
        setMessage('Network error during update');
        setCurrentStep('error');
      }
    }
  }

  function formatDate(iso: string) {
    try {
      return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch {
      return iso;
    }
  }

  function renderStepIcon(step: string) {
    if (completedSteps.includes(step)) {
      return <CheckCircle2 className="h-3.5 w-3.5 text-green-400 shrink-0" />;
    }
    if (step === currentStep) {
      return <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-400 shrink-0" />;
    }
    return <Circle className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />;
  }

  return (
    <div className="max-w-lg space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Updates</h1>
        <p className="text-sm text-muted-foreground mt-1">Check for and apply updates from the repository</p>
      </div>

      <UpdateSourceCard onSaved={() => void checkForUpdates()} />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <RefreshCw className="h-4 w-4" />
            Refresh from Repo
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Button
              size="sm"
              variant="outline"
              data-track="updates.check"
              data-track-category="action"
              onClick={() => void checkForUpdates()}
              disabled={checkStatus === 'checking' || applyStatus === 'applying'}
              className="gap-1.5"
            >
              {checkStatus === 'checking' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Check for Updates
            </Button>
            {checkStatus === 'checked' && updateInfo?.upToDate && (
              <Badge variant="outline" className="text-green-400 border-green-800 gap-1">
                <CheckCircle2 className="h-3 w-3" />
                Up to date
              </Badge>
            )}
          </div>

          {lastChecked && (
            <p className="text-xs text-muted-foreground">
              Last checked: {lastChecked.toLocaleTimeString()} · Auto-checks every 5 minutes
            </p>
          )}

          {checkStatus === 'checked' && updateInfo && !updateInfo.upToDate && (
            <div className="space-y-3 pt-1">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
                <span className="text-sm font-medium text-amber-400">
                  {changelog.length > 0 ? `${changelog.length} commit${changelog.length !== 1 ? 's' : ''} behind` : 'Update available'}
                </span>
              </div>
              <div className="text-xs text-muted-foreground font-mono space-y-0.5 bg-muted/50 rounded-md p-3">
                <p>Current: {updateInfo.currentCommit?.slice(0, 7) ?? 'unknown'}</p>
                <p>Latest:  {updateInfo.remoteCommit?.slice(0, 7) ?? 'unknown'}</p>
              </div>
              <Button
                size="sm"
                data-track="updates.apply"
                data-track-category="action"
                onClick={() => void handleApplyUpdate()}
                disabled={applyStatus === 'applying'}
                className="gap-1.5"
              >
                {applyStatus === 'applying' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="h-3.5 w-3.5" />
                )}
                {applyStatus === 'applying' ? 'Updating...' : 'Apply Update'}
              </Button>
            </div>
          )}

          {/* Progress steps during update */}
          {applyStatus === 'applying' && (
            <div className="space-y-2 pt-2">
              <div className="bg-muted/50 rounded-md p-3 space-y-1.5">
                {STEP_ORDER.filter(s => s !== 'done').map(step => {
                  const isVisible = completedSteps.includes(step) || step === currentStep ||
                    STEP_ORDER.indexOf(step) <= STEP_ORDER.indexOf(currentStep);
                  if (!isVisible) return null;
                  return (
                    <div key={step} className="flex items-center gap-2 text-xs">
                      {renderStepIcon(step)}
                      <span className={step === currentStep ? 'text-foreground font-medium' : 'text-muted-foreground'}>
                        {STEP_LABELS[step] ?? step}
                      </span>
                      {step === currentStep && stepDetail && (
                        <span className="text-muted-foreground/60 ml-1 truncate">
                          — {stepDetail}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {applyStatus === 'success' && (
            <Badge variant="outline" className="text-green-400 border-green-800 gap-1">
              <CheckCircle2 className="h-3 w-3" />
              {message}
            </Badge>
          )}

          {(checkStatus === 'error' || applyStatus === 'error') && message && (
            <Badge variant="outline" className="text-red-400 border-red-800 gap-1">
              <AlertCircle className="h-3 w-3" />
              {message}
            </Badge>
          )}
        </CardContent>
      </Card>

      {changelog.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <GitCommitHorizontal className="h-4 w-4" />
              What's New
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              {changelog.map((entry) => (
                <li key={entry.commitId} className="flex gap-3">
                  <span className="text-xs font-mono text-muted-foreground shrink-0 pt-0.5">{entry.commitId.slice(0, 7)}</span>
                  <div className="min-w-0">
                    <p className="text-sm text-foreground break-words">{entry.message}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {entry.author} · {formatDate(entry.date)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
