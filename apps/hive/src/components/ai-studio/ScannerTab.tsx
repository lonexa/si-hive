import { useState, useEffect, useCallback } from 'react';
import { Loader2, RefreshCw, Activity, FileText, AlertTriangle, Package, TrendingUp, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import AISessionButton from '@/components/shared/AISessionButton';
import { scannerTodo, scannerFixme, scannerOutdatedDep, scannerLargeFile } from '@/lib/prompt-templates';
import { resolveDefaultProjectDir } from '@/lib/project-mappings';

import { API_BASE } from '@/lib/api-config';

interface TodoItem {
  file: string;
  line: number;
  text: string;
  type: 'TODO' | 'FIXME' | 'HACK' | 'XXX';
}

interface LargeFile {
  path: string;
  sizeKb: number;
}

interface OutdatedDep {
  name: string;
  current: string;
  wanted: string;
  latest: string;
}

interface ScanResult {
  projectPath: string;
  scanDate: string;
  healthScore: number;
  todoCount: number;
  fixmeCount: number;
  totalFiles: number;
  totalSizeMb: number;
  outdatedDeps: number;
  largeFiles: LargeFile[];
  todoItems: TodoItem[];
  outdatedDepsList: OutdatedDep[];
  filesByExtension: Record<string, { count: number; totalSizeKb: number }>;
  hasTests: boolean;
  testFileCount: number;
  sourceFileCount: number;
  testCoverageRatio: number;
  errors: string[];
}

interface ScanHistoryEntry {
  id: number;
  projectPath: string;
  scanDate: string;
  healthScore: number | null;
  todoCount: number | null;
  fixmeCount: number | null;
  totalFiles: number | null;
  totalSizeMb: number | null;
  outdatedDeps: number | null;
}

interface ProjectOption {
  name: string;
  path: string;
}

function healthScoreColor(score: number): string {
  if (score >= 80) return 'text-green-400';
  if (score >= 60) return 'text-yellow-400';
  if (score >= 40) return 'text-orange-400';
  return 'text-red-400';
}

const TODO_TYPE_COLORS: Record<string, string> = {
  TODO: 'bg-blue-500/20 text-blue-400',
  FIXME: 'bg-red-500/20 text-red-400',
  HACK: 'bg-orange-500/20 text-orange-400',
  XXX: 'bg-purple-500/20 text-purple-400',
};

function TrendChart({ history }: { history: ScanHistoryEntry[] }) {
  if (history.length < 2) {
    return <div className="text-xs text-muted-foreground text-center py-4">Need at least 2 scans for trend data</div>;
  }

  const data = [...history].reverse(); // oldest first
  const width = 500;
  const height = 140;
  const pad = { top: 10, right: 10, bottom: 25, left: 35 };
  const chartW = width - pad.left - pad.right;
  const chartH = height - pad.top - pad.bottom;

  const scores = data.map(d => d.healthScore ?? 0);
  const maxY = 100;
  const scaleX = (i: number) => pad.left + (i / (data.length - 1)) * chartW;
  const scaleY = (v: number) => pad.top + chartH - (v / maxY) * chartH;

  const linePath = scores.map((s, i) => `${i === 0 ? 'M' : 'L'}${scaleX(i)},${scaleY(s)}`).join(' ');

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto">
      {/* Grid */}
      {[0, 25, 50, 75, 100].map(v => (
        <g key={v}>
          <line x1={pad.left} y1={scaleY(v)} x2={width - pad.right} y2={scaleY(v)} stroke="currentColor" strokeOpacity={0.1} />
          <text x={pad.left - 5} y={scaleY(v) + 4} textAnchor="end" fill="currentColor" fillOpacity={0.4} fontSize={9}>{v}</text>
        </g>
      ))}
      {/* Line */}
      <path d={linePath} fill="none" stroke="#3b82f6" strokeWidth={2} />
      {/* Points */}
      {scores.map((s, i) => (
        <circle key={i} cx={scaleX(i)} cy={scaleY(s)} r={3} fill="#3b82f6" />
      ))}
      {/* X labels */}
      {data.map((d, i) => {
        if (data.length > 8 && i % Math.ceil(data.length / 6) !== 0 && i !== data.length - 1) return null;
        const label = new Date(d.scanDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        return (
          <text key={i} x={scaleX(i)} y={height - 4} textAnchor="middle" fill="currentColor" fillOpacity={0.4} fontSize={8}>{label}</text>
        );
      })}
    </svg>
  );
}

export default function ScannerTab() {
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>('');
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [history, setHistory] = useState<ScanHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<'todos' | 'deps' | 'files' | 'extensions'>('todos');
  const [todoExpanded, setTodoExpanded] = useState(true);
  const [projectDir, setProjectDir] = useState('');

  useEffect(() => {
    resolveDefaultProjectDir().then(setProjectDir);
  }, []);

  // Load projects from /api/projects
  useEffect(() => {
    fetch(`${API_BASE}/api/projects`)
      .then(r => r.json())
      .then((data: { name: string; path: string }[]) => {
        const projs: ProjectOption[] = data.map(p => ({ name: p.name, path: p.path }));
        setProjects(projs);
        if (projs.length > 0 && !selectedProject) {
          setSelectedProject(projs[0].path);
        }
      })
      .catch(() => {});
  }, []);

  const runScan = useCallback(async () => {
    if (!selectedProject) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/ai-studio/scan?projectPath=${encodeURIComponent(selectedProject)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Scan failed');
      setScanResult(data);
      // Refresh history after scan
      loadHistory(selectedProject);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [selectedProject]);

  const loadHistory = useCallback(async (projectPath: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/ai-studio/scan-history?projectPath=${encodeURIComponent(projectPath)}&limit=20`);
      const data = await res.json();
      if (res.ok) {
        setHistory(data.history || []);
      }
    } catch {
      // ignore
    }
  }, []);

  // Load history when project changes
  useEffect(() => {
    if (selectedProject) {
      loadHistory(selectedProject);
    }
  }, [selectedProject, loadHistory]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Select value={selectedProject} onValueChange={setSelectedProject}>
            <SelectTrigger className="w-[320px]">
              <SelectValue placeholder="Select project..." />
            </SelectTrigger>
            <SelectContent>
              {projects.map(p => (
                <SelectItem key={p.path} value={p.path}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          onClick={runScan}
          disabled={loading || !selectedProject}
          size="sm"
          data-track="ai_studio.scanner.start_scan"
          data-track-category="action"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
          {loading ? 'Scanning...' : 'Run Scan'}
        </Button>
      </div>

      {error && (
        <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-md p-3">
          {error}
        </div>
      )}

      {/* Summary Cards */}
      {scanResult && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            <Card>
              <CardHeader className="p-3 pb-1">
                <CardTitle className="text-xs text-muted-foreground flex items-center gap-1">
                  <Activity className="h-3 w-3" /> Health Score
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3 pt-0">
                <div className={`text-2xl font-bold ${healthScoreColor(scanResult.healthScore)}`}>
                  {scanResult.healthScore}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="p-3 pb-1">
                <CardTitle className="text-xs text-muted-foreground flex items-center gap-1">
                  <FileText className="h-3 w-3" /> Total Files
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3 pt-0">
                <div className="text-2xl font-bold">{scanResult.totalFiles.toLocaleString()}</div>
                <div className="text-xs text-muted-foreground">{scanResult.totalSizeMb} MB</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="p-3 pb-1">
                <CardTitle className="text-xs text-muted-foreground flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" /> TODOs
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3 pt-0">
                <div className="text-2xl font-bold text-blue-400">{scanResult.todoCount}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="p-3 pb-1">
                <CardTitle className="text-xs text-muted-foreground flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" /> FIXMEs
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3 pt-0">
                <div className="text-2xl font-bold text-red-400">{scanResult.fixmeCount}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="p-3 pb-1">
                <CardTitle className="text-xs text-muted-foreground flex items-center gap-1">
                  <Package className="h-3 w-3" /> Outdated Deps
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3 pt-0">
                <div className="text-2xl font-bold text-orange-400">{scanResult.outdatedDeps}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="p-3 pb-1">
                <CardTitle className="text-xs text-muted-foreground flex items-center gap-1">
                  <TrendingUp className="h-3 w-3" /> Test Coverage
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3 pt-0">
                <div className="text-2xl font-bold">
                  {Math.round(scanResult.testCoverageRatio * 100)}%
                </div>
                <div className="text-xs text-muted-foreground">{scanResult.testFileCount} test files / {scanResult.sourceFileCount} source</div>
              </CardContent>
            </Card>
          </div>

          {/* Trend Chart */}
          {history.length >= 2 && (
            <Card>
              <CardHeader className="p-3 pb-1">
                <CardTitle className="text-xs text-muted-foreground">Health Score Trend</CardTitle>
              </CardHeader>
              <CardContent className="p-3 pt-0">
                <TrendChart history={history} />
              </CardContent>
            </Card>
          )}

          {/* View Tabs */}
          <div className="flex gap-2 border-b border-border pb-2">
            {(['todos', 'deps', 'files', 'extensions'] as const).map(view => (
              <button
                key={view}
                onClick={() => setActiveView(view)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  activeView === view ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                }`}
                data-track={`ai_studio.scanner.view_${view}`}
                data-track-category="nav"
              >
                {view === 'todos' ? `TODOs / FIXMEs (${scanResult.todoItems.length})` :
                 view === 'deps' ? `Outdated Deps (${scanResult.outdatedDeps})` :
                 view === 'files' ? `Large Files (${scanResult.largeFiles.length})` :
                 'File Types'}
              </button>
            ))}
          </div>

          {/* TODO/FIXME List */}
          {activeView === 'todos' && (
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <button onClick={() => setTodoExpanded(!todoExpanded)} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                  {todoExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  {scanResult.todoItems.length} items found
                </button>
              </div>
              {todoExpanded && (
                <div className="border border-border rounded-md overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium">Type</th>
                        <th className="text-left px-3 py-2 font-medium">File</th>
                        <th className="text-left px-3 py-2 font-medium">Line</th>
                        <th className="text-left px-3 py-2 font-medium">Text</th>
                        <th className="text-right px-3 py-2 font-medium"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {scanResult.todoItems.map((item, i) => (
                        <tr key={i} className="border-t border-border hover:bg-muted/30">
                          <td className="px-3 py-1.5">
                            <Badge variant="outline" className={TODO_TYPE_COLORS[item.type] || ''}>{item.type}</Badge>
                          </td>
                          <td className="px-3 py-1.5 font-mono text-muted-foreground max-w-[200px] truncate" title={item.file}>{item.file}</td>
                          <td className="px-3 py-1.5 text-muted-foreground">{item.line}</td>
                          <td className="px-3 py-1.5 max-w-[400px] truncate" title={item.text}>{item.text}</td>
                          <td className="px-3 py-1.5 text-right">
                            {item.type === 'FIXME' ? (
                              <AISessionButton
                                cwd={selectedProject || projectDir}
                                prompt={scannerFixme(item.file, item.line, item.text, 'medium')}
                                variant="icon-only"
                                size="icon"
                                tooltip="Fix"
                              />
                            ) : (
                              <AISessionButton
                                cwd={selectedProject || projectDir}
                                prompt={scannerTodo(item.file, item.line, item.text)}
                                variant="icon-only"
                                size="icon"
                                tooltip="Resolve"
                              />
                            )}
                          </td>
                        </tr>
                      ))}
                      {scanResult.todoItems.length === 0 && (
                        <tr><td colSpan={5} className="px-3 py-4 text-center text-muted-foreground">No TODO/FIXME items found</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Outdated Dependencies */}
          {activeView === 'deps' && (
            <div className="border border-border rounded-md overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Package</th>
                    <th className="text-left px-3 py-2 font-medium">Current</th>
                    <th className="text-left px-3 py-2 font-medium">Wanted</th>
                    <th className="text-left px-3 py-2 font-medium">Latest</th>
                    <th className="text-left px-3 py-2 font-medium">Status</th>
                    <th className="text-right px-3 py-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {scanResult.outdatedDepsList.map((dep, i) => {
                    const isMajor = dep.current.split('.')[0] !== dep.latest.split('.')[0];
                    return (
                      <tr key={i} className="border-t border-border hover:bg-muted/30">
                        <td className="px-3 py-1.5 font-mono">{dep.name}</td>
                        <td className="px-3 py-1.5 text-muted-foreground">{dep.current}</td>
                        <td className="px-3 py-1.5 text-yellow-400">{dep.wanted}</td>
                        <td className="px-3 py-1.5 text-green-400">{dep.latest}</td>
                        <td className="px-3 py-1.5">
                          <Badge variant="outline" className={isMajor ? 'bg-red-500/20 text-red-400' : 'bg-yellow-500/20 text-yellow-400'}>
                            {isMajor ? 'Major' : 'Minor/Patch'}
                          </Badge>
                        </td>
                        <td className="px-3 py-1.5 text-right">
                          <AISessionButton
                            cwd={selectedProject || projectDir}
                            prompt={scannerOutdatedDep(dep.name, dep.current, dep.latest)}
                            variant="icon-only"
                            size="icon"
                            tooltip="Upgrade"
                          />
                        </td>
                      </tr>
                    );
                  })}
                  {scanResult.outdatedDepsList.length === 0 && (
                    <tr><td colSpan={6} className="px-3 py-4 text-center text-muted-foreground">All dependencies are up to date</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Large Files */}
          {activeView === 'files' && (
            <div className="border border-border rounded-md overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">File</th>
                    <th className="text-right px-3 py-2 font-medium">Size</th>
                    <th className="text-right px-3 py-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {scanResult.largeFiles.map((file, i) => (
                    <tr key={i} className="border-t border-border hover:bg-muted/30">
                      <td className="px-3 py-1.5 font-mono text-muted-foreground">{file.path}</td>
                      <td className="px-3 py-1.5 text-right">
                        {file.sizeKb >= 1024
                          ? `${(file.sizeKb / 1024).toFixed(1)} MB`
                          : `${file.sizeKb} KB`}
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        <AISessionButton
                          cwd={selectedProject || projectDir}
                          prompt={scannerLargeFile(file.path, file.sizeKb >= 1024 ? `${(file.sizeKb / 1024).toFixed(1)} MB` : `${file.sizeKb} KB`, 0)}
                          variant="icon-only"
                          size="icon"
                          tooltip="Refactor"
                        />
                      </td>
                    </tr>
                  ))}
                  {scanResult.largeFiles.length === 0 && (
                    <tr><td colSpan={3} className="px-3 py-4 text-center text-muted-foreground">No large files found (threshold: 500 KB)</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* File Type Distribution */}
          {activeView === 'extensions' && (
            <div className="border border-border rounded-md overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Extension</th>
                    <th className="text-right px-3 py-2 font-medium">Files</th>
                    <th className="text-right px-3 py-2 font-medium">Total Size</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(scanResult.filesByExtension)
                    .sort(([, a], [, b]) => b.count - a.count)
                    .slice(0, 30)
                    .map(([ext, info], i) => (
                      <tr key={i} className="border-t border-border hover:bg-muted/30">
                        <td className="px-3 py-1.5 font-mono">{ext || '(no extension)'}</td>
                        <td className="px-3 py-1.5 text-right">{info.count}</td>
                        <td className="px-3 py-1.5 text-right text-muted-foreground">
                          {info.totalSizeKb >= 1024
                            ? `${(info.totalSizeKb / 1024).toFixed(1)} MB`
                            : `${Math.round(info.totalSizeKb)} KB`}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Errors */}
          {scanResult.errors.length > 0 && (
            <div className="text-xs text-yellow-400 bg-yellow-500/10 border border-yellow-500/20 rounded-md p-3">
              <div className="font-medium mb-1">Scan warnings:</div>
              {scanResult.errors.map((e, i) => (
                <div key={i}>{e}</div>
              ))}
            </div>
          )}
        </>
      )}

      {/* No scan yet */}
      {!scanResult && !loading && !error && (
        <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
          <Activity className="h-8 w-8 mb-2 opacity-40" />
          <p className="text-sm">Select a project and click "Run Scan" to analyze codebase health</p>
        </div>
      )}
    </div>
  );
}
