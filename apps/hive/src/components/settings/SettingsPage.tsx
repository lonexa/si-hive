import { useState, useEffect, useCallback } from 'react';
import { useDashboardStore } from '@/stores/dashboard-store';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { CheckCircle2, AlertCircle, Loader2, Sun, Moon, FolderOpen, Save, Plus, X, Share2, RefreshCw, Database, Star, ChevronDown, ChevronRight, Cpu, FlaskConical, Terminal as TerminalIcon } from 'lucide-react';
import TeamItemsSection from '@/components/shared/TeamItemsSection';
import { toggleTheme } from '@/hooks/useTheme';
import { useTerminalSettings } from '@/stores/terminal-settings-store';
import { THEMES } from '@/components/sessions/themes';
import { SCENES } from '@/components/sessions/scenes/registry';

import { API_BASE } from '@/lib/api-config';

type ProviderId = 'claude' | 'gemini' | 'codex';

interface ProviderStatus {
  id: ProviderId;
  displayName: string;
  installed: boolean;
  enabled: boolean;
  isPrimary: boolean;
  resolvedPath: string | null;
}

interface ProvidersConfig {
  primary: ProviderId;
  providers: Partial<Record<ProviderId, { enabled: boolean; customPath?: string }>>;
  reviewProvider?: ProviderId;
}

export default function SettingsPage() {
  const notificationConfig = useDashboardStore((s) => s.notificationConfig);
  const updateNotificationConfig = useDashboardStore((s) => s.updateNotificationConfig);
  const theme = useDashboardStore((s) => s.theme);
  const projectsRoot = useDashboardStore((s) => s.projectsRoot);
  const updateAppConfig = useDashboardStore((s) => s.updateAppConfig);

  const [macOS, setMacOS] = useState(notificationConfig.macOS);
  const [browser, setBrowser] = useState(notificationConfig.browser);
  const [hookStatus, setHookStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [hookMessage, setHookMessage] = useState('');
  const [localProjectsRoot, setLocalProjectsRoot] = useState(projectsRoot);
  const [projectsSaveStatus, setProjectsSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [autostartStatus, setAutostartStatus] = useState<'idle' | 'loading' | 'enabled' | 'disabled' | 'error'>('idle');
  const [autostartMessage, setAutostartMessage] = useState('');

  // AI Providers
  const [providerStatuses, setProviderStatuses] = useState<ProviderStatus[]>([]);
  const [providersConfig, setProvidersConfig] = useState<ProvidersConfig>({
    primary: 'claude',
    providers: {},
  });
  const [expandedProviders, setExpandedProviders] = useState<Set<ProviderId>>(new Set());
  const [providerTestResults, setProviderTestResults] = useState<Record<string, { status: 'idle' | 'testing' | 'success' | 'error'; message: string }>>({});
  const [providerSaveStatus, setProviderSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [providerValidationError, setProviderValidationError] = useState('');

  // Project Roots (extra folders scanned for local checkouts)
  const [projectRoots, setProjectRoots] = useState<string[]>([]);
  const [newProjectRoot, setNewProjectRoot] = useState('');
  const [projectRootsSaveStatus, setProjectRootsSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');

  const [shareSettingsStatus, setShareSettingsStatus] = useState<'idle' | 'sharing' | 'shared'>('idle');
  const [appVersion, setAppVersion] = useState('0.0.0');

  // Fetch version on mount
  useState(() => {
    fetch(`${API_BASE}/api/version`)
      .then((r) => r.json())
      .then((data: { version: string }) => { if (data.version) setAppVersion(data.version); })
      .catch(() => {});
  });

  // Load AI Providers config + project roots on mount
  const loadProviderData = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/config`);
      const data = await res.json();
      if (data.aiProviders) {
        setProvidersConfig(data.aiProviders);
      }
      if (data.providerStatus) {
        setProviderStatuses(data.providerStatus);
      }
      if (data.projectRoots) {
        setProjectRoots(data.projectRoots);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    void loadProviderData();
  }, [loadProviderData]);

  function toggleProviderExpanded(id: ProviderId) {
    setExpandedProviders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleProviderEnabledChange(id: ProviderId, enabled: boolean) {
    setProviderValidationError('');
    setProvidersConfig((prev) => {
      const updated = {
        ...prev,
        providers: {
          ...prev.providers,
          [id]: { ...prev.providers[id], enabled },
        },
      };
      // Validate: at least one provider must remain enabled
      const anyEnabled = Object.values(updated.providers).some((p) => p?.enabled);
      if (!anyEnabled) {
        setProviderValidationError('At least one provider must be enabled');
        return prev;
      }
      // If disabling the primary, switch primary to first enabled
      if (!enabled && prev.primary === id) {
        const firstEnabled = (Object.entries(updated.providers) as [ProviderId, { enabled: boolean }][])
          .find(([, p]) => p?.enabled);
        if (firstEnabled) {
          updated.primary = firstEnabled[0];
        }
      }
      return updated;
    });
  }

  function handleProviderCustomPathChange(id: ProviderId, customPath: string) {
    setProvidersConfig((prev) => ({
      ...prev,
      providers: {
        ...prev.providers,
        [id]: { ...prev.providers[id], enabled: prev.providers[id]?.enabled ?? false, customPath: customPath || undefined },
      },
    }));
  }

  function handleSetPrimary(id: ProviderId) {
    setProviderValidationError('');
    const providerConf = providersConfig.providers[id];
    if (!providerConf?.enabled) {
      setProviderValidationError('Primary provider must be enabled');
      return;
    }
    setProvidersConfig((prev) => ({ ...prev, primary: id }));
  }

  async function handleTestProvider(id: ProviderId) {
    setProviderTestResults((prev) => ({ ...prev, [id]: { status: 'testing', message: '' } }));
    try {
      const res = await fetch(`${API_BASE}/api/providers/${id}/test`, { method: 'POST' });
      const data = await res.json() as { ok: boolean; version?: string; error?: string };
      if (data.ok) {
        setProviderTestResults((prev) => ({ ...prev, [id]: { status: 'success', message: data.version ?? 'OK' } }));
      } else {
        setProviderTestResults((prev) => ({ ...prev, [id]: { status: 'error', message: data.error ?? 'Test failed' } }));
      }
    } catch {
      setProviderTestResults((prev) => ({ ...prev, [id]: { status: 'error', message: 'Network error' } }));
    }
  }

  async function handleSaveProviders() {
    setProviderValidationError('');
    // Validate
    const anyEnabled = Object.values(providersConfig.providers).some((p) => p?.enabled);
    if (!anyEnabled) {
      setProviderValidationError('At least one provider must be enabled');
      return;
    }
    const primaryConf = providersConfig.providers[providersConfig.primary];
    if (!primaryConf?.enabled) {
      setProviderValidationError('Primary provider must be enabled');
      return;
    }
    setProviderSaveStatus('saving');
    try {
      const res = await fetch(`${API_BASE}/api/config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aiProviders: providersConfig }),
      });
      if (res.ok) {
        setProviderSaveStatus('saved');
        void loadProviderData();
        setTimeout(() => setProviderSaveStatus('idle'), 2000);
      } else {
        setProviderSaveStatus('error');
      }
    } catch {
      setProviderSaveStatus('error');
    }
  }

  // Check if sessions are running (for primary switch warning)
  const sessions = useDashboardStore((s) => s.sessions);
  const hasRunningSessions = sessions && sessions.length > 0;

  async function patchConfig(updates: Record<string, unknown>) {
    try {
      const res = await fetch(`${API_BASE}/api/config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (res.ok) {
        const data = await res.json() as { ok: boolean; notifications?: { macOS: boolean; browser: boolean }; projectsRoot?: string; theme?: 'dark' | 'light' };
        if (data.notifications) updateNotificationConfig(data.notifications);
        updateAppConfig({ projectsRoot: data.projectsRoot, theme: data.theme });
      }
    } catch {
      // Network error
    }
  }

  function handleMacOSChange(checked: boolean) {
    setMacOS(checked);
    void patchConfig({ notifications: { macOS: checked } });
  }

  function handleBrowserChange(checked: boolean) {
    setBrowser(checked);
    void patchConfig({ notifications: { browser: checked } });
  }

  async function handleSetupHook() {
    setHookStatus('loading');
    setHookMessage('');
    try {
      const res = await fetch(`${API_BASE}/api/hooks/setup`, { method: 'POST' });
      const data = await res.json() as { ok: boolean; error?: string; message?: string };
      if (data.ok) {
        setHookStatus('success');
        setHookMessage(data.message ?? 'Stop hook configured successfully');
      } else {
        setHookStatus('error');
        setHookMessage(data.error ?? 'Failed to configure hook');
      }
    } catch {
      setHookStatus('error');
      setHookMessage('Network error — is the server running?');
    }
  }

  async function handleSaveProjectsRoot() {
    setProjectsSaveStatus('saving');
    await patchConfig({ projectsRoot: localProjectsRoot });
    setProjectsSaveStatus('saved');
    setTimeout(() => setProjectsSaveStatus('idle'), 2000);
  }

  function addProjectRoot() {
    const val = newProjectRoot.trim();
    if (val && !projectRoots.includes(val)) {
      setProjectRoots((prev) => [...prev, val]);
      setNewProjectRoot('');
    }
  }

  function removeProjectRoot(index: number) {
    setProjectRoots((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSaveProjectRoots() {
    setProjectRootsSaveStatus('saving');
    try {
      const res = await fetch(`${API_BASE}/api/config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectRoots }),
      });
      if (res.ok) {
        setProjectRootsSaveStatus('saved');
        setTimeout(() => setProjectRootsSaveStatus('idle'), 2000);
      }
    } catch { /* ignore */ }
  }

  async function handleShareSettings() {
    const name = prompt('Name for this settings template:');
    if (!name) return;
    setShareSettingsStatus('sharing');
    try {
      const configRes = await fetch(`${API_BASE}/api/config`);
      const configData = await configRes.json();
      // Strip sensitive fields before sharing
      const safeConfig = { ...configData };
      if (safeConfig.sqlServer) delete safeConfig.sqlServer;
      if (safeConfig.azureOpenAI?.apiKey) safeConfig.azureOpenAI = { ...safeConfig.azureOpenAI, apiKey: '(redacted)' };
      delete safeConfig.sharingDrivePath;
      const res = await fetch(`${API_BASE}/api/sharing/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          item_type: 'settings_template',
          description: 'Settings template (sensitive fields redacted)',
          files: [{
            file_path: 'settings.json',
            content: JSON.stringify(safeConfig, null, 2),
            is_primary: true,
          }],
        }),
      });
      if (res.ok) {
        setShareSettingsStatus('shared');
        setTimeout(() => setShareSettingsStatus('idle'), 2000);
      }
    } catch { /* ignore */ }
    setShareSettingsStatus('idle');
  }

  async function handleAutostart(enable: boolean) {
    setAutostartStatus('loading');
    setAutostartMessage('');
    try {
      const res = await fetch(`${API_BASE}/api/system/autostart`, {
        method: enable ? 'POST' : 'DELETE',
      });
      const data = await res.json() as { ok: boolean; error?: string; message?: string };
      if (data.ok) {
        setAutostartStatus(enable ? 'enabled' : 'disabled');
        setAutostartMessage(data.message ?? (enable ? 'Auto-start enabled' : 'Auto-start disabled'));
      } else {
        setAutostartStatus('error');
        setAutostartMessage(data.error ?? 'Failed');
      }
    } catch {
      setAutostartStatus('error');
      setAutostartMessage('Network error');
    }
  }


  return (
    <div className="max-w-lg space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">Configure SI Hive preferences</p>
      </div>

      {/* Appearance */}
      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <span className="text-sm font-medium text-foreground">Theme</span>
              <p className="text-xs text-muted-foreground">Switch between light and dark mode</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={toggleTheme}
              className="gap-1.5"
              data-track="settings.toggle_theme"
              data-track-category="feature"
            >
              {theme === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
              {theme === 'dark' ? 'Light' : 'Dark'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Terminal */}
      <TerminalSettingsCard />

      {/* Projects */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FolderOpen className="h-4 w-4" />
            Projects
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Projects root directory */}
          <div className="space-y-3">
            <div className="space-y-1">
              <span className="text-sm font-medium text-foreground">Projects root directory</span>
              <p className="text-xs text-muted-foreground">Folder containing your project directories</p>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={localProjectsRoot}
                onChange={(e) => setLocalProjectsRoot(e.target.value)}
                placeholder="e.g. C:\Users\You\Projects"
                className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => void handleSaveProjectsRoot()}
                disabled={projectsSaveStatus === 'saving'}
                className="gap-1.5"
                data-track="settings.save_projects_root"
                data-track-category="action"
              >
                {projectsSaveStatus === 'saving' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : projectsSaveStatus === 'saved' ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
                Save
              </Button>
            </div>
          </div>

          <div className="h-px bg-border" />

          {/* Project roots */}
          <div className="space-y-3">
            <div className="space-y-1">
              <span className="text-sm font-medium text-foreground">Project roots</span>
              <p className="text-xs text-muted-foreground">Extra local folders that contain project checkouts (used to match tickets and repos to local code)</p>
            </div>
            {projectRoots.map((root, i) => (
              <div key={i} className="flex items-center gap-2">
                <code className="flex-1 text-xs bg-secondary px-2 py-1 rounded truncate">{root}</code>
                <button
                  onClick={() => removeProjectRoot(i)}
                  className="text-muted-foreground hover:text-foreground shrink-0"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            <div className="flex gap-2">
              <Input
                value={newProjectRoot}
                onChange={(e) => setNewProjectRoot(e.target.value)}
                placeholder="C:\Users\You\Projects"
                onKeyDown={(e) => e.key === 'Enter' && addProjectRoot()}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={addProjectRoot}
                className="shrink-0"
                data-track="settings.add_project_root"
                data-track-category="action"
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void handleSaveProjectRoots()}
              disabled={projectRootsSaveStatus === 'saving'}
              className="gap-1.5"
              data-track="settings.save_project_roots"
              data-track-category="action"
            >
              {projectRootsSaveStatus === 'saving' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : projectRootsSaveStatus === 'saved' ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              Save
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Notifications */}
      <Card>
        <CardHeader>
          <CardTitle>Notifications</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-0.5">
              <span className="text-sm font-medium text-foreground">Desktop notifications</span>
              <p className="text-xs text-muted-foreground">Native OS alerts (macOS / Windows toast)</p>
            </div>
            <Switch
              checked={macOS}
              onCheckedChange={handleMacOSChange}
              aria-label="Toggle desktop notifications"
              data-track="settings.toggle_desktop_notifications"
              data-track-category="feature"
            />
          </div>

          <div className="h-px bg-border" />

          <div className="flex items-start justify-between gap-4">
            <div className="space-y-0.5">
              <span className="text-sm font-medium text-foreground">Browser notifications</span>
              <p className="text-xs text-muted-foreground">Web push notifications when tab is open</p>
            </div>
            <Switch
              checked={browser}
              onCheckedChange={handleBrowserChange}
              aria-label="Toggle browser notifications"
              data-track="settings.toggle_browser_notifications"
              data-track-category="feature"
            />
          </div>
        </CardContent>
      </Card>

      {/* Task Queue */}
      <Card>
        <CardHeader>
          <CardTitle>Task Queue</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <div className="space-y-0.5">
              <span className="text-sm font-medium text-foreground">Stop hook</span>
              <p className="text-xs text-muted-foreground">
                The task queue requires an AI stop hook to detect when sessions finish.
                This will add a hook to <code className="text-[11px] bg-secondary px-1 rounded">~/.claude/settings.json</code>.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Button
                size="sm"
                variant="outline"
                onClick={() => void handleSetupHook()}
                disabled={hookStatus === 'loading'}
                className="gap-1.5"
                data-track="settings.setup_stop_hook"
                data-track-category="action"
              >
                {hookStatus === 'loading' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {hookStatus === 'loading' ? 'Setting up...' : 'Setup Stop Hook'}
              </Button>
              {hookStatus === 'success' && (
                <Badge variant="outline" className="text-green-400 border-green-800 gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  {hookMessage}
                </Badge>
              )}
              {hookStatus === 'error' && (
                <Badge variant="outline" className="text-red-400 border-red-800 gap-1">
                  <AlertCircle className="h-3 w-3" />
                  {hookMessage}
                </Badge>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Auto-Start (Windows) */}
      <Card>
        <CardHeader>
          <CardTitle>Auto-Start</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-0.5">
            <span className="text-sm font-medium text-foreground">Launch on startup</span>
            <p className="text-xs text-muted-foreground">Start SI Hive server automatically when Windows starts</p>
          </div>
          <div className="flex items-center gap-3">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void handleAutostart(true)}
              disabled={autostartStatus === 'loading'}
              className="gap-1.5"
              data-track="settings.enable_autostart"
              data-track-category="action"
            >
              {autostartStatus === 'loading' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Enable
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void handleAutostart(false)}
              disabled={autostartStatus === 'loading'}
              className="gap-1.5"
              data-track="settings.disable_autostart"
              data-track-category="action"
            >
              Disable
            </Button>
            {(autostartStatus === 'enabled' || autostartStatus === 'disabled') && (
              <Badge variant="outline" className="text-green-400 border-green-800 gap-1">
                <CheckCircle2 className="h-3 w-3" />
                {autostartMessage}
              </Badge>
            )}
            {autostartStatus === 'error' && (
              <Badge variant="outline" className="text-red-400 border-red-800 gap-1">
                <AlertCircle className="h-3 w-3" />
                {autostartMessage}
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {/* AI Providers */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Cpu className="h-4 w-4" />
            AI Providers
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Configure which AI coding assistants SI Hive can use. Mark one as primary for new sessions.
          </p>

          {providerStatuses.length === 0 && (
            <p className="text-xs text-muted-foreground italic">Loading provider information...</p>
          )}

          {providerStatuses.map((ps) => {
            const conf = providersConfig.providers[ps.id];
            const isEnabled = conf?.enabled ?? ps.enabled;
            const isPrimary = providersConfig.primary === ps.id;
            const isExpanded = expandedProviders.has(ps.id);
            const testResult = providerTestResults[ps.id] ?? { status: 'idle', message: '' };

            return (
              <div key={ps.id} className="border border-border rounded-md p-3 space-y-2">
                {/* Main row */}
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <button
                      type="button"
                      onClick={() => handleSetPrimary(ps.id)}
                      className={`shrink-0 ${isPrimary ? 'text-amber-400' : 'text-muted-foreground hover:text-foreground'}`}
                      title={isPrimary ? 'Primary provider' : 'Set as primary'}
                    >
                      <Star className={`h-4 w-4 ${isPrimary ? 'fill-current' : ''}`} />
                    </button>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground">{ps.displayName}</span>
                        {isPrimary && (
                          <Badge variant="outline" className="text-amber-400 border-amber-800 text-[10px] px-1.5 py-0">
                            Primary
                          </Badge>
                        )}
                        {ps.installed ? (
                          <Badge variant="outline" className="text-green-400 border-green-800 text-[10px] px-1.5 py-0">
                            Installed
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground border-border text-[10px] px-1.5 py-0">
                            Not found
                          </Badge>
                        )}
                      </div>
                      {ps.resolvedPath && (
                        <p className="text-[11px] text-muted-foreground font-mono truncate mt-0.5" title={ps.resolvedPath}>
                          {ps.resolvedPath}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void handleTestProvider(ps.id)}
                      disabled={testResult.status === 'testing'}
                      className="gap-1 h-7 px-2 text-xs"
                      data-track="settings.test_provider"
                      data-track-category="action"
                      data-track-props={JSON.stringify({ provider: ps.id })}
                    >
                      {testResult.status === 'testing' ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <FlaskConical className="h-3 w-3" />
                      )}
                      Test
                    </Button>
                    <Switch
                      checked={isEnabled}
                      onCheckedChange={(checked) => handleProviderEnabledChange(ps.id, checked)}
                      aria-label={`Toggle ${ps.displayName}`}
                      data-track="settings.toggle_provider"
                      data-track-category="feature"
                      data-track-props={JSON.stringify({ provider: ps.id })}
                    />
                    <button
                      type="button"
                      onClick={() => toggleProviderExpanded(ps.id)}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                {/* Test result */}
                {testResult.status === 'success' && (
                  <Badge variant="outline" className="text-green-400 border-green-800 gap-1">
                    <CheckCircle2 className="h-3 w-3" />
                    {testResult.message}
                  </Badge>
                )}
                {testResult.status === 'error' && (
                  <Badge variant="outline" className="text-red-400 border-red-800 gap-1">
                    <AlertCircle className="h-3 w-3" />
                    {testResult.message}
                  </Badge>
                )}

                {/* Expanded: custom path override */}
                {isExpanded && (
                  <div className="space-y-1.5 pt-1 pl-6">
                    <label className="text-xs font-medium text-foreground">Custom binary path override</label>
                    <Input
                      value={conf?.customPath ?? ''}
                      onChange={(e) => handleProviderCustomPathChange(ps.id, e.target.value)}
                      placeholder={ps.resolvedPath ?? `Path to ${ps.displayName} binary`}
                      className="text-xs font-mono"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Leave empty to use auto-detected path. Set a custom path if the binary is in a non-standard location.
                    </p>
                  </div>
                )}
              </div>
            );
          })}

          {/* Review Provider override */}
          <div className="space-y-1.5 pt-1">
            <label className="text-xs font-medium text-foreground">PR Review Provider</label>
            <p className="text-[11px] text-muted-foreground">
              Which AI provider runs PR code reviews. Defaults to the primary provider if not set.
            </p>
            <select
              value={providersConfig.reviewProvider ?? ''}
              onChange={(e) => {
                const val = e.target.value as ProviderId | '';
                setProvidersConfig(prev => ({
                  ...prev,
                  reviewProvider: val || undefined,
                }));
              }}
              className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-xs text-foreground"
            >
              <option value="">Use primary ({providerStatuses.find(p => p.id === providersConfig.primary)?.displayName ?? providersConfig.primary})</option>
              {providerStatuses.filter(p => p.enabled && p.installed).map(p => (
                <option key={p.id} value={p.id}>{p.displayName}</option>
              ))}
            </select>
          </div>

          {/* Primary switch warning */}
          {hasRunningSessions && (
            <div className="flex items-start gap-2 text-xs text-amber-400 bg-amber-400/10 rounded-md px-3 py-2">
              <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>Sessions are currently running. Changing the primary provider will only affect new sessions.</span>
            </div>
          )}

          {/* Validation error */}
          {providerValidationError && (
            <Badge variant="outline" className="text-red-400 border-red-800 gap-1">
              <AlertCircle className="h-3 w-3" />
              {providerValidationError}
            </Badge>
          )}

          {/* Save button */}
          <div className="flex items-center gap-3 pt-1">
            <Button
              size="sm"
              onClick={() => void handleSaveProviders()}
              disabled={providerSaveStatus === 'saving'}
              className="gap-1.5"
              data-track="settings.save_providers"
              data-track-category="action"
            >
              {providerSaveStatus === 'saving' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : providerSaveStatus === 'saved' ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              Save
            </Button>
            {providerSaveStatus === 'error' && (
              <Badge variant="outline" className="text-red-400 border-red-800 gap-1">
                <AlertCircle className="h-3 w-3" />
                Save failed
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Shared Settings Templates */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Shared Settings</span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void handleShareSettings()}
              disabled={shareSettingsStatus === 'sharing'}
              className="gap-1.5"
              data-track="settings.share_settings"
              data-track-category="action"
            >
              {shareSettingsStatus === 'sharing' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : shareSettingsStatus === 'shared' ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />
              ) : (
                <Share2 className="h-3.5 w-3.5" />
              )}
              Share Current
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Export your non-sensitive configuration (project roots, preferences) as a template
            that team members can import. Sensitive fields like passwords and SQL credentials are
            automatically redacted before sharing.
          </p>
          <TeamItemsSection itemType="settings_template" />
        </CardContent>
      </Card>

      {/* Server */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-4 w-4" />
            Server
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3 pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                if (!confirm('This will restart the SI Hive server. The page will reload automatically.')) return;
                try {
                  await fetch(`${API_BASE}/api/server/restart`, { method: 'POST' });
                  setTimeout(() => window.location.reload(), 3000);
                } catch { /* server is restarting */ }
              }}
              data-track="settings.restart_server"
              data-track-category="action"
            >
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              Restart Server
            </Button>
            <span className="text-xs text-muted-foreground">Restarts the server process to pick up config changes</span>
          </div>
        </CardContent>
      </Card>

      {/* About */}
      <Card>
        <CardHeader>
          <CardTitle>About</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground space-y-1">
            <p>SI Hive v{appVersion}</p>
            <p>A developer environment for monitoring and controlling AI sessions.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function TerminalSettingsCard() {
  const settings = useTerminalSettings();
  const isClassic = settings.mode === 'classic';
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TerminalIcon className="h-4 w-4" />
          Terminal
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Visual enhancements for the in-app terminal. Sessions opened after a change pick up
          the new settings; existing sessions keep the settings they were spawned with.
        </p>

        {/* Master mode switch */}
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-0.5">
            <span className="text-sm font-medium text-foreground">Classic terminal</span>
            <p className="text-xs text-muted-foreground">
              Skip every enhancement — pure xterm. Use this if anything below looks wrong or
              you want the lightest renderer.
            </p>
          </div>
          <Switch
            checked={isClassic}
            onCheckedChange={(checked) => settings.setMode(checked ? 'classic' : 'enhanced')}
            aria-label="Toggle classic terminal mode"
          />
        </div>

        <div className="h-px bg-border" />

        {/* Theme picker — re-skins the xterm palette and backdrop colors together */}
        <ThemePickerRow />

        <div className="h-px bg-border" />

        {/* Scene picker — which animated graphic plays behind the terminal */}
        <ScenePickerRow />

        <div className="h-px bg-border" />

        {/* Sub-toggles — disabled when classic mode is on */}
        <SubToggle
          label="GPU renderer"
          description="WebGL-accelerated text rendering. Auto-falls back to DOM on context loss."
          checked={settings.gpu}
          onChange={settings.setGpu}
          disabled={isClassic}
        />
        <SubToggle
          label="Inline image previews"
          description="Show images Claude reads (Read(file.png)) right under the line."
          checked={settings.inlineImages}
          onChange={settings.setInlineImages}
          disabled={isClassic}
        />
        <SubToggle
          label="Clickable web links"
          description="Auto-detect URLs in terminal output (ctrl+click to open)."
          checked={settings.webLinks}
          onChange={settings.setWebLinks}
          disabled={isClassic}
        />
        <SubToggle
          label="Ctrl+F search"
          description="Find-in-scrollback overlay for long sessions."
          checked={settings.search}
          onChange={settings.setSearch}
          disabled={isClassic}
        />
        <SubToggle
          label="Drag-and-drop files"
          description="Drop files onto a terminal to upload + paste the path into the prompt. Hold Shift to wrap images in a prompt."
          checked={settings.dragDrop}
          onChange={settings.setDragDrop}
          disabled={isClassic}
        />
        <SubToggle
          label="Tool-call decorations"
          description="Colored left-edge bar per tool type (Read/Edit/Bash/Write/Grep/Task/WebFetch) so long transcripts are easier to scan."
          checked={settings.toolDecorations}
          onChange={settings.setToolDecorations}
          disabled={isClassic}
        />
        <SubToggle
          label="Sticky tool banner"
          description="Pin a small banner top-right showing the in-flight tool (e.g., 'Read file.ts'). Clears when the result lands or after 15s."
          checked={settings.stickyToolBanner}
          onChange={settings.setStickyToolBanner}
          disabled={isClassic}
        />
        <SubToggle
          label="Tool timing chips"
          description="Right-aligned ⏱ chip on each tool result showing elapsed time (1.2s, 350ms, etc.), color-matched to the tool."
          checked={settings.toolTimingChips}
          onChange={settings.setToolTimingChips}
          disabled={isClassic}
        />
        <SubToggle
          label="Work-item hover cards"
          description="Detect ticket references (e.g. #123, ABC-42) from your connected tracker in terminal output. Hover for title/state/assignee, click to open."
          checked={settings.workItemCards}
          onChange={settings.setWorkItemCards}
          disabled={isClassic}
        />
        <SubToggle
          label="Clickable file paths"
          description="Underline absolute file paths (with optional :LINE:COL) in terminal output. Click to open in VS Code at that location."
          checked={settings.filePathLinks}
          onChange={settings.setFilePathLinks}
          disabled={isClassic}
        />
        <SubToggle
          label="Backdrop scene"
          description="Animated graphic behind the terminal — pick the scene above. Reacts to output and tool calls, dimmed so text stays readable. On by default."
          checked={settings.ambientCanvas}
          onChange={settings.setAmbientCanvas}
          disabled={isClassic}
        />
      </CardContent>
    </Card>
  );
}

function SubToggle({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (on: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className={`flex items-start justify-between gap-4 ${disabled ? 'opacity-50' : ''}`}>
      <div className="space-y-0.5">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch
        checked={!disabled && checked}
        onCheckedChange={onChange}
        disabled={disabled}
        aria-label={`Toggle ${label}`}
      />
    </div>
  );
}

/**
 * Theme picker — a grid of preset swatches. Clicking applies the theme to
 * future sessions; existing terminal tabs need to be reopened to pick up the
 * new xterm palette + backdrop colors.
 */
function ThemePickerRow() {
  const theme = useTerminalSettings((s) => s.theme);
  const setTheme = useTerminalSettings((s) => s.setTheme);
  return (
    <div className="space-y-2">
      <div className="space-y-0.5">
        <span className="text-sm font-medium text-foreground">Theme</span>
        <p className="text-xs text-muted-foreground">
          Re-skins the terminal palette and the 3D backdrop together. Applies to
          newly-opened sessions.
        </p>
      </div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {THEMES.map((t) => {
          const active = t.id === theme;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTheme(t.id)}
              className={`group flex flex-col items-stretch gap-1 rounded-md border p-2 text-left transition ${
                active
                  ? 'border-foreground/60 bg-foreground/5'
                  : 'border-border hover:border-foreground/30 hover:bg-foreground/[0.02]'
              }`}
              aria-pressed={active}
              aria-label={`Theme: ${t.name}`}
              title={t.description}
            >
              <div className="flex h-6 overflow-hidden rounded-sm">
                <div className="flex-1" style={{ background: t.backdrop.bg }} />
                <div className="flex-1" style={{ background: t.backdrop.primary }} />
                <div className="flex-1" style={{ background: t.backdrop.secondary }} />
                <div className="flex-1" style={{ background: t.backdrop.particle }} />
              </div>
              <span className="text-[11px] font-medium text-foreground">{t.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Scene picker — chooses which animated graphic plays behind the terminal
 * (Planet, Matrix Rain, Horse Race, …). Independent of the color theme:
 * any scene runs in any theme's palette. Applies to newly-opened sessions.
 */
function ScenePickerRow() {
  const scene = useTerminalSettings((s) => s.terminalScene);
  const setScene = useTerminalSettings((s) => s.setTerminalScene);
  return (
    <div className="space-y-2">
      <div className="space-y-0.5">
        <span className="text-sm font-medium text-foreground">Backdrop scene</span>
        <p className="text-xs text-muted-foreground">
          The animated graphic behind the terminal. Reacts to activity and is
          dimmed to keep text readable. Applies to newly-opened sessions.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {SCENES.map((s) => {
          const active = s.id === scene;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => setScene(s.id)}
              className={`flex flex-col gap-0.5 rounded-md border p-2 text-left transition ${
                active
                  ? 'border-foreground/60 bg-foreground/5'
                  : 'border-border hover:border-foreground/30 hover:bg-foreground/[0.02]'
              }`}
              aria-pressed={active}
              aria-label={`Backdrop scene: ${s.name}`}
              title={s.description}
            >
              <span className="text-xs font-medium text-foreground">{s.name}</span>
              <span className="text-[10px] leading-snug text-muted-foreground">
                {s.description}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
