import { useEffect, useState } from 'react';
import { Shield, Loader2, X, Plus, ChevronDown, ChevronUp, Info, Zap, ShieldOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { invalidateLaunchFlagsCache } from '@/lib/launch-flags';

import { API_BASE } from '@/lib/api-config';

interface Permissions {
  allow: string[];
  deny: string[];
  ask: string[];
}

interface Project {
  path: string;
  name: string;
  encodedPath: string;
}

type SectionKey = keyof Permissions;

const SECTIONS: { key: SectionKey; label: string; description: string; color: string; badgeClass: string }[] = [
  {
    key: 'allow',
    label: 'Allow',
    description: 'Tools permitted without prompting',
    color: 'text-green-500',
    badgeClass: 'bg-green-500/10 text-green-500 border-green-500/20 hover:bg-green-500/20',
  },
  {
    key: 'deny',
    label: 'Deny',
    description: 'Tools that are always blocked',
    color: 'text-red-500',
    badgeClass: 'bg-red-500/10 text-red-500 border-red-500/20 hover:bg-red-500/20',
  },
  {
    key: 'ask',
    label: 'Ask',
    description: 'Tools that require approval each time',
    color: 'text-yellow-500',
    badgeClass: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20 hover:bg-yellow-500/20',
  },
];

const PRESET_GROUPS: { group: string; presets: { label: string; rules: string[]; target: SectionKey }[] }[] = [
  {
    group: 'Allow Presets',
    presets: [
      { label: 'File reads', rules: ['Read', 'Grep', 'Glob'], target: 'allow' },
      { label: 'File edits', rules: ['Edit', 'Write'], target: 'allow' },
      { label: 'Git commands', rules: ['Bash(git *)'], target: 'allow' },
      { label: 'MCP tools', rules: ['mcp__*'], target: 'allow' },
      { label: 'Web access', rules: ['WebFetch', 'WebSearch'], target: 'allow' },
      { label: 'Subagents', rules: ['Agent(Explore)', 'Agent(Plan)'], target: 'allow' },
      { label: 'npm/node', rules: ['Bash(npm run *)', 'Bash(npx *)', 'Bash(node *)'], target: 'allow' },
      { label: 'All Bash', rules: ['Bash'], target: 'allow' },
    ],
  },
  {
    group: 'Safety Presets',
    presets: [
      { label: 'Block destructive git', rules: ['Bash(git push --force *)', 'Bash(git reset --hard *)', 'Bash(rm -rf *)'], target: 'deny' },
      { label: 'Block env files', rules: ['Read(.env)', 'Read(.env.*)', 'Read(*.pem)'], target: 'deny' },
      { label: 'Ask before push', rules: ['Bash(git push *)'], target: 'ask' },
      { label: 'Ask before delete', rules: ['Bash(rm *)'], target: 'ask' },
    ],
  },
];

const TOOL_REFERENCE: { tool: string; description: string; examples: string[] }[] = [
  { tool: 'Bash', description: 'Shell command execution', examples: ['Bash', 'Bash(git *)', 'Bash(npm run *)', 'Bash(* --version)'] },
  { tool: 'Read', description: 'File reads (also covers Grep/Glob)', examples: ['Read', 'Read(.env)', 'Read(~/secrets/**)', 'Read(/src/**/*.ts)'] },
  { tool: 'Edit', description: 'Edit existing files', examples: ['Edit', 'Edit(/src/**/*.ts)'] },
  { tool: 'Write', description: 'Create or overwrite files', examples: ['Write', 'Write(/src/**/*.ts)'] },
  { tool: 'Grep', description: 'Content search across files', examples: ['Grep'] },
  { tool: 'Glob', description: 'File pattern matching', examples: ['Glob'] },
  { tool: 'WebFetch', description: 'Fetch content from URLs', examples: ['WebFetch', 'WebFetch(domain:example.com)'] },
  { tool: 'WebSearch', description: 'Web search queries', examples: ['WebSearch'] },
  { tool: 'mcp__*', description: 'MCP server tools', examples: ['mcp__*', 'mcp__puppeteer__*', 'mcp__slack__read_channel'] },
  { tool: 'Agent(*)', description: 'Subagent control', examples: ['Agent(Explore)', 'Agent(Plan)', 'Agent(my-agent)'] },
];

const PATH_PATTERNS = [
  { pattern: '//path', meaning: 'Absolute filesystem path', example: 'Read(//Users/alice/secrets/**)' },
  { pattern: '~/path', meaning: 'Home directory relative', example: 'Read(~/Documents/*.pdf)' },
  { pattern: '/path', meaning: 'Project root relative', example: 'Edit(/src/**/*.ts)' },
  { pattern: 'path', meaning: 'Current directory relative', example: 'Read(*.env)' },
];

interface LaunchFlags {
  autoMode: boolean;
  dangerouslySkipPermissions: boolean;
}

export default function PermissionsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [scope, setScope] = useState<string>('global');
  const [permissions, setPermissions] = useState<Permissions>({ allow: [], deny: [], ask: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showLegend, setShowLegend] = useState(false);
  const [launchFlags, setLaunchFlags] = useState<LaunchFlags>({ autoMode: false, dangerouslySkipPermissions: false });
  const [newRules, setNewRules] = useState<Record<SectionKey, string>>({
    allow: '',
    deny: '',
    ask: '',
  });

  // Fetch projects list and launch flags
  useEffect(() => {
    fetch(`${API_BASE}/api/permissions/projects`)
      .then((res) => res.json())
      .then((data) => setProjects(data.projects ?? []))
      .catch(() => setProjects([]));

    fetch(`${API_BASE}/api/config`)
      .then((res) => res.json())
      .then((data) => {
        if (data.launchFlags) {
          setLaunchFlags(data.launchFlags);
        }
      })
      .catch(() => {});
  }, []);

  // Fetch permissions when scope changes
  useEffect(() => {
    setLoading(true);
    const url =
      scope === 'global'
        ? `${API_BASE}/api/permissions`
        : `${API_BASE}/api/permissions/projects/${scope}`;

    fetch(url)
      .then((res) => res.json())
      .then((data) => {
        setPermissions(data.permissions ?? { allow: [], deny: [], ask: [] });
      })
      .catch(() => {
        setPermissions({ allow: [], deny: [], ask: [] });
      })
      .finally(() => setLoading(false));
  }, [scope]);

  const removeRule = (section: SectionKey, rule: string) => {
    setPermissions((prev) => ({
      ...prev,
      [section]: prev[section].filter((r) => r !== rule),
    }));
  };

  const addRule = (section: SectionKey) => {
    const rule = newRules[section].trim();
    if (!rule) return;
    if (permissions[section].includes(rule)) return;
    setPermissions((prev) => ({
      ...prev,
      [section]: [...prev[section], rule],
    }));
    setNewRules((prev) => ({ ...prev, [section]: '' }));
  };

  const applyPreset = (rules: string[], target: SectionKey) => {
    setPermissions((prev) => {
      const existing = new Set(prev[target]);
      const toAdd = rules.filter((r) => !existing.has(r));
      return { ...prev, [target]: [...prev[target], ...toAdd] };
    });
  };

  const toggleLaunchFlag = async (flag: keyof LaunchFlags) => {
    const updated = { ...launchFlags, [flag]: !launchFlags[flag] };
    // Auto mode and skip-permissions are mutually exclusive
    if (flag === 'autoMode' && updated.autoMode) {
      updated.dangerouslySkipPermissions = false;
    } else if (flag === 'dangerouslySkipPermissions' && updated.dangerouslySkipPermissions) {
      updated.autoMode = false;
    }
    setLaunchFlags(updated);
    invalidateLaunchFlagsCache();
    try {
      await fetch(`${API_BASE}/api/config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ launchFlags: updated }),
      });
    } catch { /* ignore */ }
  };

  const save = async () => {
    setSaving(true);
    try {
      const url =
        scope === 'global'
          ? `${API_BASE}/api/permissions`
          : `${API_BASE}/api/permissions/projects/${scope}`;

      await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permissions }),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Shield className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Permissions</h1>
            <p className="text-sm text-muted-foreground">
              Manage tool permissions for AI
            </p>
          </div>
        </div>
        <Button onClick={save} disabled={saving || loading}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {saving ? 'Saving...' : 'Save'}
        </Button>
      </div>

      {/* Scope selector */}
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium text-muted-foreground">Scope</label>
        <select
          className="rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground"
          value={scope}
          onChange={(e) => setScope(e.target.value)}
        >
          <option value="global">Global</option>
          {projects.map((p) => (
            <option key={p.encodedPath} value={p.encodedPath}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      {/* Launch Flags */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Launch Flags</CardTitle>
          <p className="text-xs text-muted-foreground">
            CLI flags applied when launching sessions from this app
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <label className="flex items-start gap-3 cursor-pointer rounded-lg border border-border p-3 hover:bg-accent/50 transition-colors">
            <div className="flex items-center gap-2 mt-0.5">
              <Zap className="h-4 w-4 text-amber-500" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Auto Mode</span>
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-blue-500/10 text-blue-500 border-blue-500/20">NEW</Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                AI autonomously decides which actions need approval. Safer than skip-permissions but more autonomous than default. Uses <code className="text-[11px] bg-muted px-1 rounded">--enable-auto-mode</code>
              </p>
            </div>
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 rounded border-border"
              checked={launchFlags.autoMode}
              onChange={() => void toggleLaunchFlag('autoMode')}
            />
          </label>

          <label className="flex items-start gap-3 cursor-pointer rounded-lg border border-red-500/20 p-3 hover:bg-red-500/5 transition-colors">
            <div className="flex items-center gap-2 mt-0.5">
              <ShieldOff className="h-4 w-4 text-red-500" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-red-500">Dangerously Skip Permissions</span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Bypasses ALL permission prompts. Only use in sandboxed/isolated environments. Uses <code className="text-[11px] bg-muted px-1 rounded">--dangerously-skip-permissions</code>
              </p>
            </div>
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 rounded border-border"
              checked={launchFlags.dangerouslySkipPermissions}
              onChange={() => void toggleLaunchFlag('dangerouslySkipPermissions')}
            />
          </label>
        </CardContent>
      </Card>

      {/* Quick presets */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Quick Presets</CardTitle>
          <p className="text-xs text-muted-foreground">Click to add rules to the corresponding section</p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {PRESET_GROUPS.map((group) => (
            <div key={group.group}>
              <p className="text-xs font-medium text-muted-foreground mb-2">{group.group}</p>
              <div className="flex flex-wrap gap-2">
                {group.presets.map((preset) => {
                  const section = SECTIONS.find((s) => s.key === preset.target);
                  return (
                    <Button
                      key={preset.label}
                      variant="outline"
                      size="sm"
                      onClick={() => applyPreset(preset.rules, preset.target)}
                      disabled={loading}
                      className={cn(
                        'text-xs',
                        preset.target === 'deny' && 'border-red-500/30 text-red-400 hover:bg-red-500/10',
                        preset.target === 'ask' && 'border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/10',
                      )}
                      title={`Adds to ${section?.label}: ${preset.rules.join(', ')}`}
                    >
                      <Plus className="mr-1 h-3 w-3" />
                      {preset.label}
                    </Button>
                  );
                })}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Permission Reference Legend */}
      <Card>
        <CardHeader className="pb-3">
          <button
            className="flex items-center gap-2 w-full text-left"
            onClick={() => setShowLegend(!showLegend)}
          >
            <Info className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-sm font-medium">Permission Reference</CardTitle>
            {showLegend ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground ml-auto" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground ml-auto" />
            )}
          </button>
        </CardHeader>
        {showLegend && (
          <CardContent className="flex flex-col gap-5 pt-0">
            {/* Rule evaluation order */}
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">Rule Evaluation Order</p>
              <div className="flex items-center gap-2 text-xs">
                <Badge variant="outline" className="bg-red-500/10 text-red-500 border-red-500/20">Deny</Badge>
                <span className="text-muted-foreground">&rarr;</span>
                <Badge variant="outline" className="bg-yellow-500/10 text-yellow-500 border-yellow-500/20">Ask</Badge>
                <span className="text-muted-foreground">&rarr;</span>
                <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/20">Allow</Badge>
                <span className="text-muted-foreground ml-2">(first match wins, deny always takes precedence)</span>
              </div>
            </div>

            {/* Settings precedence */}
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">Settings Precedence (highest to lowest)</p>
              <ol className="text-xs text-muted-foreground list-decimal list-inside space-y-0.5">
                <li>Managed settings (admin, cannot be overridden)</li>
                <li>Command line arguments</li>
                <li>Local project settings (<code className="bg-muted px-1 rounded">.claude/settings.local.json</code>)</li>
                <li>Shared project settings (<code className="bg-muted px-1 rounded">.claude/settings.json</code>)</li>
                <li>User settings (<code className="bg-muted px-1 rounded">~/.claude/settings.json</code>)</li>
              </ol>
            </div>

            {/* Available tools */}
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">Available Tools</p>
              <div className="grid gap-2">
                {TOOL_REFERENCE.map((t) => (
                  <div key={t.tool} className="flex items-start gap-3 text-xs">
                    <code className="bg-muted px-1.5 py-0.5 rounded font-mono text-foreground min-w-[80px]">{t.tool}</code>
                    <div className="flex-1">
                      <span className="text-muted-foreground">{t.description}</span>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {t.examples.map((ex) => (
                          <button
                            key={ex}
                            className="bg-accent/50 hover:bg-accent px-1.5 py-0.5 rounded text-[11px] font-mono cursor-pointer transition-colors"
                            onClick={() => setNewRules((prev) => ({ ...prev, allow: ex }))}
                            title={`Click to populate Allow input with: ${ex}`}
                          >
                            {ex}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Path patterns */}
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">Path Specifier Patterns</p>
              <div className="grid gap-1.5">
                {PATH_PATTERNS.map((p) => (
                  <div key={p.pattern} className="flex items-center gap-3 text-xs">
                    <code className="bg-muted px-1.5 py-0.5 rounded font-mono min-w-[60px]">{p.pattern}</code>
                    <span className="text-muted-foreground min-w-[160px]">{p.meaning}</span>
                    <code className="text-[11px] text-muted-foreground font-mono">{p.example}</code>
                  </div>
                ))}
              </div>
            </div>

            {/* Permission modes */}
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">Permission Modes (CLI)</p>
              <div className="grid gap-1.5 text-xs">
                <div className="flex gap-3">
                  <code className="bg-muted px-1.5 py-0.5 rounded font-mono min-w-[130px]">default</code>
                  <span className="text-muted-foreground">Prompts on first use of each tool</span>
                </div>
                <div className="flex gap-3">
                  <code className="bg-muted px-1.5 py-0.5 rounded font-mono min-w-[130px]">acceptEdits</code>
                  <span className="text-muted-foreground">Auto-accepts file edits, Bash still prompts</span>
                </div>
                <div className="flex gap-3">
                  <code className="bg-muted px-1.5 py-0.5 rounded font-mono min-w-[130px]">plan</code>
                  <span className="text-muted-foreground">Read-only mode, no modifications allowed</span>
                </div>
                <div className="flex gap-3">
                  <code className="bg-muted px-1.5 py-0.5 rounded font-mono min-w-[130px]">bypassPermissions</code>
                  <span className="text-muted-foreground">Skips all prompts (sandboxed environments only)</span>
                </div>
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Loading state */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        /* Permission sections */
        <div className="grid gap-4">
          {SECTIONS.map((section) => (
            <Card key={section.key}>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <CardTitle className={cn('text-sm font-medium', section.color)}>
                    {section.label}
                  </CardTitle>
                  <span className="text-xs text-muted-foreground">— {section.description}</span>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {/* Current rules */}
                {permissions[section.key].length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {permissions[section.key].map((rule) => (
                      <Badge
                        key={rule}
                        variant="outline"
                        className={cn('gap-1 pr-1', section.badgeClass)}
                      >
                        {rule}
                        <button
                          onClick={() => removeRule(section.key, rule)}
                          className="ml-1 rounded-sm p-0.5 hover:bg-foreground/10"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No rules configured</p>
                )}

                {/* Add rule input */}
                <div className="flex items-center gap-2">
                  <input
                    className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                    placeholder={`Add ${section.key} rule (e.g. Bash(git *), Read, mcp__*)...`}
                    value={newRules[section.key]}
                    onChange={(e) =>
                      setNewRules((prev) => ({ ...prev, [section.key]: e.target.value }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') addRule(section.key);
                    }}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => addRule(section.key)}
                    disabled={!newRules[section.key].trim()}
                  >
                    <Plus className="mr-1.5 h-3 w-3" />
                    Add
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
