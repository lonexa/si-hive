import { useState, useEffect, useCallback } from 'react';
import { Loader2, RefreshCw, Shield, AlertTriangle, ShieldAlert, ShieldCheck, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

import { API_BASE } from '@/lib/api-config';

interface SecretFinding {
  file: string;
  line: number;
  column: number;
  type: string;
  severity: 'high' | 'medium' | 'low';
  description: string;
  match: string;
}

interface SecretsReport {
  projectPath: string;
  scanDate: string;
  totalFindings: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  findings: SecretFinding[];
  filesScanned: number;
  filesSkipped: number;
  errors: string[];
}

interface ProjectOption {
  name: string;
  path: string;
}

const SEVERITY_COLORS: Record<string, string> = {
  high: 'bg-red-500/20 text-red-400 border-red-500/30',
  medium: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  low: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
};

export default function SecretsTab() {
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>('');
  const [report, setReport] = useState<SecretsReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [severityFilter, setSeverityFilter] = useState<'all' | 'high' | 'medium' | 'low'>('all');
  const [showRedacted, setShowRedacted] = useState(false);
  const [groupByFile, setGroupByFile] = useState(false);

  // Load projects
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
      const res = await fetch(`${API_BASE}/api/security/scan-secrets?projectPath=${encodeURIComponent(selectedProject)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Scan failed');
      setReport(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [selectedProject]);

  const filteredFindings = report?.findings.filter(f =>
    severityFilter === 'all' || f.severity === severityFilter
  ) ?? [];

  // Group by file
  const groupedFindings: Record<string, SecretFinding[]> = {};
  if (groupByFile) {
    for (const f of filteredFindings) {
      if (!groupedFindings[f.file]) groupedFindings[f.file] = [];
      groupedFindings[f.file].push(f);
    }
  }

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
        <Button onClick={runScan} disabled={loading || !selectedProject} size="sm">
          {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
          {loading ? 'Scanning...' : 'Scan for Secrets'}
        </Button>
      </div>

      {error && (
        <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-md p-3">
          {error}
        </div>
      )}

      {report && (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Card>
              <CardHeader className="p-3 pb-1">
                <CardTitle className="text-xs text-muted-foreground flex items-center gap-1">
                  <Shield className="h-3 w-3" /> Total Findings
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3 pt-0">
                <div className={`text-2xl font-bold ${report.totalFindings === 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {report.totalFindings}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="p-3 pb-1">
                <CardTitle className="text-xs text-muted-foreground flex items-center gap-1">
                  <ShieldAlert className="h-3 w-3" /> High
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3 pt-0">
                <div className="text-2xl font-bold text-red-400">{report.highCount}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="p-3 pb-1">
                <CardTitle className="text-xs text-muted-foreground flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" /> Medium
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3 pt-0">
                <div className="text-2xl font-bold text-yellow-400">{report.mediumCount}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="p-3 pb-1">
                <CardTitle className="text-xs text-muted-foreground flex items-center gap-1">
                  <Shield className="h-3 w-3" /> Low
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3 pt-0">
                <div className="text-2xl font-bold text-blue-400">{report.lowCount}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="p-3 pb-1">
                <CardTitle className="text-xs text-muted-foreground">Files Scanned</CardTitle>
              </CardHeader>
              <CardContent className="p-3 pt-0">
                <div className="text-2xl font-bold">{report.filesScanned.toLocaleString()}</div>
                <div className="text-xs text-muted-foreground">{report.filesSkipped.toLocaleString()} skipped</div>
              </CardContent>
            </Card>
          </div>

          {/* Clean report */}
          {report.totalFindings === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-green-400">
              <ShieldCheck className="h-12 w-12 mb-3 opacity-60" />
              <p className="text-sm font-medium">No secrets detected</p>
              <p className="text-xs text-muted-foreground mt-1">Scanned {report.filesScanned} files in {report.projectPath}</p>
            </div>
          )}

          {/* Findings */}
          {report.totalFindings > 0 && (
            <>
              {/* Filters */}
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex gap-1">
                  {(['all', 'high', 'medium', 'low'] as const).map(sev => (
                    <button
                      key={sev}
                      onClick={() => setSeverityFilter(sev)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                        severityFilter === sev ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                      }`}
                    >
                      {sev === 'all' ? `All (${report.totalFindings})` :
                       sev === 'high' ? `High (${report.highCount})` :
                       sev === 'medium' ? `Medium (${report.mediumCount})` :
                       `Low (${report.lowCount})`}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2 ml-auto">
                  <button
                    onClick={() => setGroupByFile(!groupByFile)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                      groupByFile ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    Group by File
                  </button>
                  <button
                    onClick={() => setShowRedacted(!showRedacted)}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                  >
                    {showRedacted ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                    {showRedacted ? 'Show Values' : 'Hide Values'}
                  </button>
                </div>
              </div>

              {/* Findings Table */}
              {!groupByFile ? (
                <div className="border border-border rounded-md overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium">Severity</th>
                        <th className="text-left px-3 py-2 font-medium">Type</th>
                        <th className="text-left px-3 py-2 font-medium">File</th>
                        <th className="text-left px-3 py-2 font-medium">Line</th>
                        <th className="text-left px-3 py-2 font-medium">Match</th>
                        <th className="text-left px-3 py-2 font-medium">Description</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredFindings.map((f, i) => (
                        <tr key={i} className="border-t border-border hover:bg-muted/30">
                          <td className="px-3 py-1.5">
                            <Badge variant="outline" className={SEVERITY_COLORS[f.severity]}>{f.severity}</Badge>
                          </td>
                          <td className="px-3 py-1.5 font-medium">{f.type}</td>
                          <td className="px-3 py-1.5 font-mono text-muted-foreground max-w-[200px] truncate" title={f.file}>{f.file}</td>
                          <td className="px-3 py-1.5 text-muted-foreground">{f.line}</td>
                          <td className="px-3 py-1.5 font-mono text-xs">
                            {showRedacted ? f.match : '***'}
                          </td>
                          <td className="px-3 py-1.5 text-muted-foreground max-w-[250px] truncate" title={f.description}>{f.description}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="space-y-3">
                  {Object.entries(groupedFindings)
                    .sort(([, a], [, b]) => b.length - a.length)
                    .map(([file, findings]) => (
                      <Card key={file}>
                        <CardHeader className="p-3 pb-1">
                          <CardTitle className="text-xs font-mono flex items-center justify-between">
                            <span className="text-muted-foreground truncate max-w-[500px]" title={file}>{file}</span>
                            <Badge variant="outline" className="ml-2">{findings.length}</Badge>
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="p-3 pt-1">
                          <div className="space-y-1">
                            {findings.map((f, i) => (
                              <div key={i} className="flex items-center gap-2 text-xs">
                                <Badge variant="outline" className={`${SEVERITY_COLORS[f.severity]} text-[10px] px-1.5`}>{f.severity}</Badge>
                                <span className="text-muted-foreground">L{f.line}</span>
                                <span className="font-medium">{f.type}</span>
                                <span className="text-muted-foreground">-</span>
                                <span className="text-muted-foreground truncate">{f.description}</span>
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                </div>
              )}
            </>
          )}

          {/* Errors */}
          {report.errors.length > 0 && (
            <div className="text-xs text-yellow-400 bg-yellow-500/10 border border-yellow-500/20 rounded-md p-3">
              <div className="font-medium mb-1">Scan warnings:</div>
              {report.errors.map((e, i) => (
                <div key={i}>{e}</div>
              ))}
            </div>
          )}
        </>
      )}

      {/* No scan yet */}
      {!report && !loading && !error && (
        <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
          <Shield className="h-8 w-8 mb-2 opacity-40" />
          <p className="text-sm">Select a project and click "Scan for Secrets" to detect exposed credentials</p>
          <p className="text-xs mt-1">Scans for API keys, passwords, tokens, connection strings, and more</p>
        </div>
      )}
    </div>
  );
}
