import { useEffect, useMemo, useState } from 'react';
import {
  Package,
  Database,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  FileCode,
  Layers,
  Box,
  FlaskConical,
  Wrench,
  Search,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { API_BASE } from '@/lib/api-config';

// --- Types matching server response ---

interface Dependency {
  name: string;
  version: string;
  type: 'runtime' | 'dev' | 'build' | 'test';
}

interface DependencyFile {
  filePath: string;
  ecosystem: string;
  framework?: string;
  dependencies: Dependency[];
}

interface DatabaseDependency {
  name: string;
  connectionType: string;
  source: string;
}

interface ProjectDependencies {
  projectType: string;
  files: DependencyFile[];
  databases: DatabaseDependency[];
  summary: {
    totalPackages: number;
    ecosystems: string[];
    frameworks: string[];
  };
}

interface ProjectInfo {
  name: string;
  path: string;
}

// --- Helpers ---

const ecosystemColors: Record<string, string> = {
  nuget: 'bg-purple-900/50 text-purple-300 border-purple-700/50',
  npm: 'bg-red-900/50 text-red-300 border-red-700/50',
  python: 'bg-yellow-900/50 text-yellow-300 border-yellow-700/50',
};

const typeIcons: Record<string, React.ReactNode> = {
  runtime: <Box className="h-3 w-3 text-blue-400" />,
  dev: <Wrench className="h-3 w-3 text-gray-400" />,
  build: <Layers className="h-3 w-3 text-orange-400" />,
  test: <FlaskConical className="h-3 w-3 text-green-400" />,
};

const typeBadgeColors: Record<string, string> = {
  runtime: 'bg-blue-900/40 text-blue-300 border-blue-700/40',
  dev: 'bg-gray-800 text-gray-400 border-gray-700',
  build: 'bg-orange-900/40 text-orange-300 border-orange-700/40',
  test: 'bg-green-900/40 text-green-300 border-green-700/40',
};

const dbTypeColors: Record<string, string> = {
  'SQL Server': 'bg-blue-900/50 text-blue-300 border-blue-700/50',
  'SQLite': 'bg-emerald-900/50 text-emerald-300 border-emerald-700/50',
  'PostgreSQL': 'bg-sky-900/50 text-sky-300 border-sky-700/50',
  'MongoDB': 'bg-green-900/50 text-green-300 border-green-700/50',
};

export default function DependenciesTab() {
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ProjectDependencies | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [collapsedFiles, setCollapsedFiles] = useState<Set<number>>(new Set());

  // Fetch project list
  useEffect(() => {
    fetch(`${API_BASE}/api/projects`)
      .then((r) => r.json())
      .then((list: ProjectInfo[]) => {
        setProjects(list);
        if (list.length > 0 && !selectedProject) {
          setSelectedProject(list[0].path);
        }
      })
      .catch(() => {});
  }, []);

  // Fetch dependencies when project changes
  useEffect(() => {
    if (!selectedProject) return;
    setLoading(true);
    setError(null);
    setData(null);
    setCollapsedFiles(new Set());

    const encoded = encodeURIComponent(selectedProject);
    fetch(`${API_BASE}/api/projects/${encoded}/dependencies`)
      .then((r) => {
        if (!r.ok) throw new Error('Failed to fetch dependencies');
        return r.json();
      })
      .then((result: ProjectDependencies) => {
        setData(result);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setLoading(false));
  }, [selectedProject]);

  // Filter dependencies
  const filteredFiles = useMemo(() => {
    if (!data) return [];
    const searchLower = filter.toLowerCase();

    return data.files.map((file) => {
      let deps = file.dependencies;
      if (typeFilter !== 'all') {
        deps = deps.filter((d) => d.type === typeFilter);
      }
      if (searchLower) {
        deps = deps.filter(
          (d) =>
            d.name.toLowerCase().includes(searchLower) ||
            d.version.toLowerCase().includes(searchLower)
        );
      }
      return { ...file, dependencies: deps };
    }).filter((file) => file.dependencies.length > 0);
  }, [data, filter, typeFilter]);

  const totalFiltered = filteredFiles.reduce((s, f) => s + f.dependencies.length, 0);

  const toggleFile = (idx: number) => {
    setCollapsedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  if (projects.length === 0 && !loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-gray-500">
        <Package className="h-12 w-12 mb-4 opacity-30" />
        <p className="text-sm">No projects found</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header: project selector + search + refresh */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={selectedProject} onValueChange={setSelectedProject}>
          <SelectTrigger className="w-[320px]">
            <SelectValue placeholder="Select a project..." />
          </SelectTrigger>
          <SelectContent>
            {projects.map((p) => (
              <SelectItem key={p.path} value={p.path}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {data && (
          <>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-500" />
              <input
                type="text"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter packages..."
                className="pl-8 pr-3 py-1.5 text-sm bg-gray-900 border border-gray-700 rounded-md text-gray-300 placeholder:text-gray-600 w-[200px] focus:outline-none focus:border-gray-500"
              />
            </div>

            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                <SelectItem value="runtime">Runtime</SelectItem>
                <SelectItem value="dev">Dev</SelectItem>
                <SelectItem value="build">Build</SelectItem>
                <SelectItem value="test">Test</SelectItem>
              </SelectContent>
            </Select>
          </>
        )}

        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            // Re-trigger fetch
            const p = selectedProject;
            setSelectedProject('');
            setTimeout(() => setSelectedProject(p), 0);
          }}
          disabled={loading}
          className="ml-auto"
        >
          <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
          Scan
        </Button>
      </div>

      {/* Error */}
      {error && (
        <div className="p-3 rounded-lg bg-red-900/30 border border-red-800 text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="h-6 w-6 animate-spin text-gray-500" />
          <span className="ml-2 text-sm text-gray-500">Scanning project dependencies...</span>
        </div>
      )}

      {data && !loading && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <SummaryCard
              icon={<Package className="h-4 w-4" />}
              label="Project Type"
              value={data.projectType}
            />
            <SummaryCard
              icon={<Box className="h-4 w-4 text-blue-400" />}
              label="Total Packages"
              value={String(data.summary.totalPackages)}
              subValue={filter || typeFilter !== 'all' ? `${totalFiltered} shown` : undefined}
            />
            <SummaryCard
              icon={<Layers className="h-4 w-4 text-purple-400" />}
              label="Ecosystems"
              value={data.summary.ecosystems.join(', ') || 'None'}
            />
            <SummaryCard
              icon={<Database className="h-4 w-4 text-emerald-400" />}
              label="Database Deps"
              value={String(data.databases.length)}
            />
          </div>

          {/* Framework badges */}
          {data.summary.frameworks.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-gray-500">Frameworks:</span>
              {data.summary.frameworks.map((fw) => (
                <span
                  key={fw}
                  className="px-2 py-0.5 text-xs rounded-full bg-gray-800 text-gray-300 border border-gray-700"
                >
                  {fw}
                </span>
              ))}
            </div>
          )}

          {/* Database dependencies */}
          {data.databases.length > 0 && (
            <div className="border border-gray-700 rounded-lg overflow-hidden">
              <div className="px-3 py-2 bg-gray-800/50 text-sm font-medium text-gray-300 flex items-center gap-2">
                <Database className="h-4 w-4 text-emerald-400" />
                Database Dependencies
              </div>
              <div className="divide-y divide-gray-800/50">
                {data.databases.map((db, i) => (
                  <div key={i} className="flex items-center gap-3 px-3 py-2 hover:bg-gray-800/20">
                    <span className={`px-2 py-0.5 text-[10px] font-medium rounded border ${dbTypeColors[db.connectionType] || 'bg-gray-800 text-gray-400 border-gray-700'}`}>
                      {db.connectionType}
                    </span>
                    <span className="text-sm text-gray-200 font-medium">{db.name}</span>
                    <span className="text-xs text-gray-600 ml-auto font-mono">{db.source}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Dependency files */}
          {filteredFiles.length === 0 ? (
            <div className="text-center py-8 text-gray-500 text-sm">
              {data.files.length === 0
                ? 'No dependency files found in this project'
                : 'No packages match the current filter'}
            </div>
          ) : (
            <div className="space-y-2">
              {filteredFiles.map((file, fi) => (
                <div key={fi} className="border border-gray-700 rounded-lg overflow-hidden">
                  {/* File header */}
                  <button
                    onClick={() => toggleFile(fi)}
                    className="w-full flex items-center gap-2 px-3 py-2 bg-gray-800/50 hover:bg-gray-800 text-sm transition-colors"
                  >
                    {collapsedFiles.has(fi) ? (
                      <ChevronRight className="h-3.5 w-3.5 text-gray-500" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5 text-gray-500" />
                    )}
                    <FileCode className="h-3.5 w-3.5 text-gray-400" />
                    <span className="text-gray-300 font-mono text-xs">{file.filePath}</span>
                    <span className={`px-1.5 py-0.5 text-[10px] rounded border ${ecosystemColors[file.ecosystem] || 'bg-gray-800 text-gray-400 border-gray-700'}`}>
                      {file.ecosystem}
                    </span>
                    {file.framework && (
                      <span className="px-1.5 py-0.5 text-[10px] rounded bg-gray-800 text-gray-400 border border-gray-700">
                        {file.framework}
                      </span>
                    )}
                    <span className="text-xs text-gray-600 ml-auto">
                      {file.dependencies.length} package{file.dependencies.length !== 1 ? 's' : ''}
                    </span>
                  </button>

                  {/* Package list */}
                  {!collapsedFiles.has(fi) && (
                    <div className="divide-y divide-gray-800/30">
                      {file.dependencies.map((dep, di) => (
                        <div
                          key={di}
                          className="flex items-center gap-3 px-3 py-1.5 hover:bg-gray-800/20 text-sm"
                        >
                          {typeIcons[dep.type] || <Box className="h-3 w-3 text-gray-500" />}
                          <span className="text-gray-200">{dep.name}</span>
                          <span className="text-xs text-gray-500 font-mono">{dep.version}</span>
                          <span className={`ml-auto px-1.5 py-0.5 text-[10px] rounded border ${typeBadgeColors[dep.type] || ''}`}>
                            {dep.type}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  subValue,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  subValue?: string;
}) {
  return (
    <div className="border border-gray-700 rounded-lg p-3 bg-gray-900/50">
      <div className="flex items-center gap-2 text-gray-400 text-xs mb-1">
        {icon}
        {label}
      </div>
      <div className="text-lg font-semibold text-gray-100 truncate">{value}</div>
      {subValue && <div className="text-xs text-gray-500 mt-0.5">{subValue}</div>}
    </div>
  );
}
