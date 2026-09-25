import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { FolderOpen, Search, FileText, Monitor, Check, Copy, Clock, SortAsc, HardDrive, Folder, File, ChevronRight, ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useDashboardStore } from '@/stores/dashboard-store';
import type { PlanEntry } from '@/stores/types';

import { API_BASE } from '@/lib/api-config';

interface ProjectInfo {
  name: string;
  path: string;
  lastActivity?: string;
}

interface PathInsertMenuProps {
  sessionId?: string;
  compact?: boolean;
}

type Tab = 'all' | 'projects' | 'plans' | 'sessions' | 'browse';
type SortMode = 'name' | 'recent';

interface PathItem {
  label: string;
  path: string;
  type: 'project' | 'plan' | 'session' | 'browse';
  modifiedAt?: string;
}

interface BrowseEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

export default function PathInsertMenu({ compact }: PathInsertMenuProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [plans, setPlans] = useState<PlanEntry[]>([]);
  const [tab, setTab] = useState<Tab>('all');
  const [sortMode, setSortMode] = useState<SortMode>('name');
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Browse state
  const [browsePath, setBrowsePath] = useState('');
  const [browseEntries, setBrowseEntries] = useState<BrowseEntry[]>([]);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseError, setBrowseError] = useState<string | null>(null);

  const sessions = useDashboardStore((s) => s.sessions);

  // Unique cwds from active sessions
  const sessionDirs = useMemo(() => {
    const map = new Map<string, string>(); // path -> lastActivity
    for (const s of sessions) {
      const dir = s.cwd || s.projectDir;
      if (dir) {
        const existing = map.get(dir);
        if (!existing || s.lastActivity > existing) {
          map.set(dir, s.lastActivity);
        }
      }
    }
    return [...map.entries()].map(([path, lastActivity]) => ({ path, lastActivity }));
  }, [sessions]);

  // Fetch browse directory
  const fetchBrowse = useCallback((dirPath?: string) => {
    setBrowseLoading(true);
    setBrowseError(null);
    const params = dirPath ? `?path=${encodeURIComponent(dirPath)}` : '';
    fetch(`${API_BASE}/api/browse${params}`)
      .then((r) => {
        if (!r.ok && r.headers.get('content-type')?.includes('text/html')) {
          throw new Error('Server needs restart to enable browse API');
        }
        return r.json();
      })
      .then((data) => {
        if (data.error) {
          setBrowseError(data.error);
        } else {
          setBrowsePath(data.current);
          setBrowseEntries(data.entries);
        }
      })
      .catch((err) => setBrowseError(err.message))
      .finally(() => setBrowseLoading(false));
  }, []);

  // Fetch data when opened
  useEffect(() => {
    if (!open) return;
    fetch(`${API_BASE}/api/projects`)
      .then((r) => r.json())
      .then((data: ProjectInfo[]) => setProjects(data))
      .catch(() => {});
    fetch(`${API_BASE}/api/insights/plans`)
      .then((r) => r.json())
      .then((data: PlanEntry[]) => setPlans(data))
      .catch(() => {});
  }, [open]);

  // Fetch browse when tab switches to browse
  useEffect(() => {
    if (tab === 'browse' && browseEntries.length === 0 && !browsePath) {
      fetchBrowse();
    }
  }, [tab, browseEntries.length, browsePath, fetchBrowse]);

  // Focus search on open
  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 50);
  }, [open]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  const copyPath = useCallback((path: string) => {
    navigator.clipboard.writeText(path).then(() => {
      setCopied(path);
      setTimeout(() => {
        setCopied(null);
        setOpen(false);
      }, 600);
    });
  }, []);

  const q = search.toLowerCase();

  // Build unified item list (excludes browse items)
  const allItems = useMemo((): PathItem[] => {
    const items: PathItem[] = [];

    if (tab === 'all' || tab === 'projects') {
      for (const p of projects) {
        if (q && !p.name.toLowerCase().includes(q) && !p.path.toLowerCase().includes(q)) continue;
        items.push({ label: p.name, path: p.path, type: 'project', modifiedAt: p.lastActivity });
      }
    }

    if (tab === 'all' || tab === 'plans') {
      for (const p of plans) {
        const fp = p.filePath;
        if (!fp) continue;
        if (q && !p.title.toLowerCase().includes(q) && !fp.toLowerCase().includes(q)) continue;
        items.push({ label: p.title, path: fp, type: 'plan', modifiedAt: p.modifiedAt });
      }
    }

    if (tab === 'all' || tab === 'sessions') {
      for (const d of sessionDirs) {
        const name = d.path.split(/[\\/]/).pop() ?? d.path;
        if (q && !name.toLowerCase().includes(q) && !d.path.toLowerCase().includes(q)) continue;
        items.push({ label: name, path: d.path, type: 'session', modifiedAt: d.lastActivity });
      }
    }

    // Sort
    if (sortMode === 'name') {
      items.sort((a, b) => a.label.localeCompare(b.label));
    } else {
      items.sort((a, b) => {
        const ta = a.modifiedAt ? new Date(a.modifiedAt).getTime() : 0;
        const tb = b.modifiedAt ? new Date(b.modifiedAt).getTime() : 0;
        return tb - ta;
      });
    }

    return items;
  }, [projects, plans, sessionDirs, q, tab, sortMode]);

  // Filtered browse entries
  const filteredBrowse = useMemo(() => {
    if (!q) return browseEntries;
    return browseEntries.filter((e) => e.name.toLowerCase().includes(q));
  }, [browseEntries, q]);

  // Parse path segments for breadcrumbs
  const pathSegments = useMemo(() => {
    if (!browsePath) return [];
    // Handle Windows (C:\Users\...) and Unix (/home/...)
    const isWindowsPath = /^[A-Z]:\\/i.test(browsePath);
    const parts = browsePath.split(/[\\/]/).filter(Boolean);
    const segments: { label: string; path: string }[] = [];
    for (let i = 0; i < parts.length; i++) {
      const segPath = isWindowsPath
        ? parts.slice(0, i + 1).join('\\')
        : '/' + parts.slice(0, i + 1).join('/');
      segments.push({ label: parts[i], path: segPath });
    }
    return segments;
  }, [browsePath]);

  const parentPath = useMemo(() => {
    if (pathSegments.length <= 1) return null;
    return pathSegments[pathSegments.length - 2].path;
  }, [pathSegments]);

  const typeIcon = (type: PathItem['type']) => {
    switch (type) {
      case 'project': return <FolderOpen className="h-3.5 w-3.5 text-blue-400 shrink-0" />;
      case 'plan': return <FileText className="h-3.5 w-3.5 text-amber-400 shrink-0" />;
      case 'session': return <Monitor className="h-3.5 w-3.5 text-green-400 shrink-0" />;
      case 'browse': return <HardDrive className="h-3.5 w-3.5 text-purple-400 shrink-0" />;
    }
  };

  const typeLabel = (type: PathItem['type']) => {
    switch (type) {
      case 'project': return 'project';
      case 'plan': return 'plan';
      case 'session': return 'session';
      case 'browse': return 'file';
    }
  };

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: 'all', label: 'All', count: allItems.length },
    { key: 'projects', label: 'Projects', count: projects.length },
    { key: 'plans', label: 'Plans', count: plans.length },
    { key: 'sessions', label: 'Sessions', count: sessionDirs.length },
    { key: 'browse', label: 'Browse' },
  ];

  return (
    <div className="relative" ref={menuRef}>
      {/* Trigger button - bigger and more visible */}
      <button
        onClick={() => {
          setOpen(!open);
          setSearch('');
          setCopied(null);
        }}
        className={cn(
          'flex items-center gap-1.5 shrink-0 rounded px-1.5 py-0.5 transition-colors text-xs',
          open
            ? 'bg-blue-500/20 text-blue-400'
            : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/50',
          compact && 'px-1 py-0.5',
        )}
        title="Copy a path to clipboard"
      >
        <Copy className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
        {!compact && <span>Paths</span>}
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-1.5 z-50 rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl flex flex-col"
          style={{ width: '420px', height: '480px' }}
        >
          {/* Header with search */}
          <div className="shrink-0 p-3 border-b border-zinc-800">
            <div className="flex items-center justify-between mb-2.5">
              <h3 className="text-sm font-medium text-zinc-200">Copy Path</h3>
              {tab !== 'browse' && (
                <button
                  onClick={() => setSortMode(sortMode === 'name' ? 'recent' : 'name')}
                  className="flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors px-1.5 py-0.5 rounded hover:bg-zinc-800"
                  title={`Sort by ${sortMode === 'name' ? 'recent' : 'name'}`}
                >
                  {sortMode === 'name' ? <SortAsc className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
                  {sortMode === 'name' ? 'A-Z' : 'Recent'}
                </button>
              )}
            </div>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-500" />
              <input
                ref={searchRef}
                type="text"
                placeholder={tab === 'browse' ? 'Filter current directory...' : 'Search paths...'}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full bg-zinc-800 text-zinc-200 text-sm rounded-md px-3 py-2 pl-8 border border-zinc-700 outline-none focus:border-zinc-500 placeholder:text-zinc-600"
              />
            </div>
          </div>

          {/* Tabs */}
          <div className="shrink-0 flex gap-0.5 px-3 py-1.5 border-b border-zinc-800 bg-zinc-900/50">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => { setTab(t.key); setSearch(''); }}
                className={cn(
                  'text-xs px-2.5 py-1 rounded transition-colors',
                  tab === t.key
                    ? 'bg-zinc-700 text-zinc-200 font-medium'
                    : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800',
                )}
              >
                {t.label}
                {t.count !== undefined && t.key !== 'all' && (
                  <span className="ml-1 text-zinc-600">{t.count}</span>
                )}
              </button>
            ))}
          </div>

          {/* Scrollable content area */}
          <div className="flex-1 overflow-y-auto min-h-0">
            {tab === 'browse' ? (
              // Browse tab content
              <div className="flex flex-col h-full">
                {/* Breadcrumbs */}
                {browsePath && (
                  <div className="shrink-0 flex items-center gap-1 px-3 py-2 border-b border-zinc-800/50 bg-zinc-900/80 overflow-x-auto">
                    {parentPath !== null && (
                      <button
                        onClick={() => fetchBrowse(parentPath)}
                        className="shrink-0 p-0.5 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors"
                        title="Go up"
                      >
                        <ArrowLeft className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <div className="flex items-center gap-0.5 text-xs min-w-0 overflow-x-auto">
                      {pathSegments.map((seg, i) => (
                        <span key={seg.path} className="flex items-center gap-0.5 shrink-0">
                          {i > 0 && <ChevronRight className="h-3 w-3 text-zinc-600" />}
                          <button
                            onClick={() => fetchBrowse(seg.path)}
                            className={cn(
                              'hover:text-zinc-200 transition-colors px-1 py-0.5 rounded hover:bg-zinc-800',
                              i === pathSegments.length - 1 ? 'text-zinc-200 font-medium' : 'text-zinc-500',
                            )}
                          >
                            {seg.label}
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Browse listing */}
                <div className="flex-1 overflow-y-auto">
                  {browseLoading ? (
                    <div className="flex items-center justify-center h-32 text-zinc-500 text-sm">
                      Loading...
                    </div>
                  ) : browseError ? (
                    <div className="flex flex-col items-center justify-center h-32 text-zinc-500">
                      <p className="text-sm text-red-400/80">Cannot access directory</p>
                      <p className="text-xs mt-1 text-zinc-600">{browseError}</p>
                    </div>
                  ) : filteredBrowse.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-32 text-zinc-600">
                      <Search className="h-5 w-5 mb-2 opacity-40" />
                      <p className="text-sm">{q ? 'No matches' : 'Empty directory'}</p>
                    </div>
                  ) : (
                    <div className="py-1">
                      {filteredBrowse.map((entry) => (
                        <div
                          key={entry.path}
                          className={cn(
                            'w-full text-left px-3 py-2 transition-colors flex items-center gap-2.5 group',
                            copied === entry.path ? 'bg-green-500/10' : 'hover:bg-zinc-800',
                          )}
                        >
                          {entry.isDirectory ? (
                            <Folder className="h-3.5 w-3.5 text-blue-400 shrink-0" />
                          ) : (
                            <File className="h-3.5 w-3.5 text-zinc-500 shrink-0" />
                          )}
                          <button
                            onClick={() => {
                              if (entry.isDirectory) {
                                fetchBrowse(entry.path);
                                setSearch('');
                              } else {
                                copyPath(entry.path);
                              }
                            }}
                            className={cn(
                              'text-sm truncate flex-1 text-left',
                              entry.isDirectory ? 'text-zinc-200 hover:text-blue-400 transition-colors' : 'text-zinc-400',
                            )}
                          >
                            {entry.name}
                          </button>
                          {copied === entry.path ? (
                            <div className="flex items-center gap-1 shrink-0">
                              <Check className="h-3.5 w-3.5 text-green-400" />
                              <span className="text-xs text-green-400">Copied!</span>
                            </div>
                          ) : (
                            <button
                              onClick={(e) => { e.stopPropagation(); copyPath(entry.path); }}
                              className="shrink-0 p-1 rounded hover:bg-zinc-700 text-zinc-600 hover:text-zinc-300 opacity-0 group-hover:opacity-100 transition-all"
                              title="Copy path"
                            >
                              <Copy className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : allItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-zinc-600">
                <Search className="h-6 w-6 mb-2 opacity-40" />
                <p className="text-sm">No matching paths</p>
                {search && <p className="text-xs mt-1">Try a different search term</p>}
              </div>
            ) : (
              <div className="py-1">
                {allItems.map((item) => (
                  <button
                    key={`${item.type}-${item.path}`}
                    onClick={() => copyPath(item.path)}
                    className={cn(
                      'w-full text-left px-3 py-2.5 transition-colors flex items-start gap-2.5 group',
                      copied === item.path ? 'bg-green-500/10' : 'hover:bg-zinc-800',
                    )}
                  >
                    <div className="mt-0.5">{typeIcon(item.type)}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-zinc-200 truncate">{item.label}</span>
                        {tab === 'all' && (
                          <span className="text-[10px] text-zinc-600 shrink-0">{typeLabel(item.type)}</span>
                        )}
                      </div>
                      <div className="text-xs text-zinc-500 truncate font-mono mt-0.5">{item.path}</div>
                    </div>
                    {copied === item.path ? (
                      <div className="flex items-center gap-1 shrink-0 mt-0.5">
                        <Check className="h-3.5 w-3.5 text-green-400" />
                        <span className="text-xs text-green-400">Copied!</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Copy className="h-3 w-3 text-zinc-500" />
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="shrink-0 px-3 py-1.5 border-t border-zinc-800 flex items-center justify-between text-[11px] text-zinc-600">
            <span>
              {tab === 'browse'
                ? `${filteredBrowse.length} item${filteredBrowse.length !== 1 ? 's' : ''}`
                : `${allItems.length} path${allItems.length !== 1 ? 's' : ''}`}
            </span>
            <span>{tab === 'browse' ? 'Click folder to open • Click file to copy' : 'Click to copy • Ctrl+V to paste'}</span>
          </div>
        </div>
      )}
    </div>
  );
}
