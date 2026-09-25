import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { FolderOpen, ChevronDown, Search, Folder, ArrowLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

import { API_BASE } from '@/lib/api-config';

interface BrowseEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

interface ProjectPathPickerProps {
  value: string;
  onChange: (path: string) => void;
  availableDirs?: string[];
}

export default function ProjectPathPicker({ value, onChange, availableDirs = [] }: ProjectPathPickerProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'suggested' | 'browse'>('suggested');
  const [search, setSearch] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Browse state
  const [browsePath, setBrowsePath] = useState('');
  const [browseEntries, setBrowseEntries] = useState<BrowseEntry[]>([]);
  const [browseLoading, setBrowseLoading] = useState(false);

  // Close on outside click / escape
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

  // Focus search on open
  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 50);
  }, [open]);

  const fetchBrowse = useCallback((dirPath?: string) => {
    setBrowseLoading(true);
    const params = dirPath ? `?path=${encodeURIComponent(dirPath)}` : '';
    fetch(`${API_BASE}/api/browse${params}`)
      .then((r) => r.json())
      .then((data) => {
        if (!data.error) {
          setBrowsePath(data.current);
          setBrowseEntries(data.entries);
        }
      })
      .catch(() => {})
      .finally(() => setBrowseLoading(false));
  }, []);

  // Fetch browse when switching to browse tab
  useEffect(() => {
    if (tab === 'browse' && !browsePath) {
      // Start browsing from the current value's parent or the value itself
      fetchBrowse(value || undefined);
    }
  }, [tab, browsePath, value, fetchBrowse]);

  const q = search.toLowerCase();

  const filteredDirs = useMemo(() => {
    if (!q) return availableDirs;
    return availableDirs.filter((d) => d.toLowerCase().includes(q));
  }, [availableDirs, q]);

  const filteredBrowse = useMemo(() => {
    const dirs = browseEntries.filter((e) => e.isDirectory);
    if (!q) return dirs;
    return dirs.filter((e) => e.name.toLowerCase().includes(q));
  }, [browseEntries, q]);

  // Parse path segments for breadcrumbs
  const pathSegments = useMemo(() => {
    if (!browsePath) return [];
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

  function selectDir(dir: string) {
    onChange(dir);
    setOpen(false);
    setSearch('');
  }

  const displayName = value ? value.split(/[\\/]/).pop() || value : 'Select directory...';

  return (
    <div className="relative" ref={menuRef}>
      <label className="text-xs font-medium text-foreground">Project Directory</label>
      <button
        type="button"
        onClick={() => {
          setOpen(!open);
          setSearch('');
          setTab('suggested');
        }}
        className="mt-1 w-full flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-left hover:bg-secondary/30 transition-colors"
      >
        <FolderOpen className="h-4 w-4 text-blue-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-sm text-foreground truncate">{displayName}</div>
          <div className="text-[11px] text-muted-foreground truncate font-mono">{value}</div>
        </div>
        <ChevronDown className={cn('h-4 w-4 text-muted-foreground shrink-0 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div
          className="absolute left-0 right-0 top-full mt-1 z-50 rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl flex flex-col"
          style={{ maxHeight: '320px' }}
        >
          {/* Header */}
          <div className="shrink-0 p-2.5 border-b border-zinc-800">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-500" />
              <input
                ref={searchRef}
                type="text"
                placeholder={tab === 'browse' ? 'Filter folders...' : 'Search directories...'}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full bg-zinc-800 text-zinc-200 text-sm rounded-md px-3 py-1.5 pl-8 border border-zinc-700 outline-none focus:border-zinc-500 placeholder:text-zinc-600"
              />
            </div>
          </div>

          {/* Tabs */}
          <div className="shrink-0 flex gap-0.5 px-2.5 py-1.5 border-b border-zinc-800">
            <button
              onClick={() => { setTab('suggested'); setSearch(''); }}
              className={cn(
                'text-xs px-2.5 py-1 rounded transition-colors',
                tab === 'suggested' ? 'bg-zinc-700 text-zinc-200 font-medium' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800',
              )}
            >
              Projects{availableDirs.length > 0 && <span className="ml-1 text-zinc-600">{availableDirs.length}</span>}
            </button>
            <button
              onClick={() => { setTab('browse'); setSearch(''); }}
              className={cn(
                'text-xs px-2.5 py-1 rounded transition-colors',
                tab === 'browse' ? 'bg-zinc-700 text-zinc-200 font-medium' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800',
              )}
            >
              Browse
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto min-h-0">
            {tab === 'suggested' ? (
              filteredDirs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-zinc-600">
                  <p className="text-sm">{q ? 'No matches' : 'No directories available'}</p>
                </div>
              ) : (
                <div className="py-1">
                  {filteredDirs.map((dir) => {
                    const name = dir.split(/[\\/]/).pop() || dir;
                    const isSelected = dir === value;
                    return (
                      <button
                        key={dir}
                        onClick={() => selectDir(dir)}
                        className={cn(
                          'w-full text-left px-3 py-2 transition-colors flex items-start gap-2.5 group',
                          isSelected ? 'bg-blue-500/10' : 'hover:bg-zinc-800',
                        )}
                      >
                        <FolderOpen className={cn('h-3.5 w-3.5 shrink-0 mt-0.5', isSelected ? 'text-blue-400' : 'text-zinc-500')} />
                        <div className="flex-1 min-w-0">
                          <div className={cn('text-sm truncate', isSelected ? 'text-blue-400 font-medium' : 'text-zinc-200')}>
                            {name}
                          </div>
                          <div className="text-[11px] text-zinc-500 truncate font-mono mt-0.5">{dir}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )
            ) : (
              // Browse tab
              <div className="flex flex-col">
                {/* Breadcrumbs */}
                {browsePath && (
                  <div className="shrink-0 flex items-center gap-1 px-3 py-1.5 border-b border-zinc-800/50 overflow-x-auto">
                    {parentPath !== null && (
                      <button
                        onClick={() => fetchBrowse(parentPath)}
                        className="shrink-0 p-0.5 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors"
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
                    {/* Select current directory button */}
                    <button
                      onClick={() => selectDir(browsePath)}
                      className="ml-auto shrink-0 text-[10px] px-2 py-0.5 rounded bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 transition-colors"
                    >
                      Use this folder
                    </button>
                  </div>
                )}

                {browseLoading ? (
                  <div className="flex items-center justify-center py-8 text-zinc-500 text-sm">Loading...</div>
                ) : filteredBrowse.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 text-zinc-600">
                    <p className="text-sm">{q ? 'No matches' : 'No subfolders'}</p>
                  </div>
                ) : (
                  <div className="py-1">
                    {filteredBrowse.map((entry) => (
                      <button
                        key={entry.path}
                        onClick={() => {
                          fetchBrowse(entry.path);
                          setSearch('');
                        }}
                        className="w-full text-left px-3 py-1.5 transition-colors flex items-center gap-2.5 hover:bg-zinc-800"
                      >
                        <Folder className="h-3.5 w-3.5 text-blue-400 shrink-0" />
                        <span className="text-sm text-zinc-200 truncate">{entry.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
