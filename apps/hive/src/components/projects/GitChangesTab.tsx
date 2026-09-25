import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  GitBranch,
  GitCommit,
  FileText,
  AlertTriangle,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Plus,
  Minus,
  Clock,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import AISessionButton from '@/components/shared/AISessionButton';
import { gitFileChange } from '@/lib/prompt-templates';

import { API_BASE } from '@/lib/api-config';

// --- Types matching server responses ---

interface GitFileStatus {
  status: string;
  staged: boolean;
  file: string;
  origFile?: string;
}

interface GitStatusResult {
  branch: string;
  files: GitFileStatus[];
  ahead: number;
  behind: number;
}

interface GitDiffResult {
  staged: string;
  unstaged: string;
  fullDiff: string;
  stagedDiff: string;
  summary: {
    filesChanged: number;
    insertions: number;
    deletions: number;
  };
}

interface GitBranchInfo {
  name: string;
  shortHash: string;
  date: string;
  subject: string;
  isCurrent: boolean;
  isRemote: boolean;
  isStale: boolean;
}

interface GitBranchesResult {
  current: string;
  branches: GitBranchInfo[];
}

interface ProjectInfo {
  name: string;
  path: string;
  hasGit: boolean;
}

// --- Status badge helpers ---

function statusLabel(s: string): string {
  switch (s) {
    case 'M': return 'Modified';
    case 'A': return 'Added';
    case 'D': return 'Deleted';
    case '?': return 'Untracked';
    case 'R': return 'Renamed';
    case 'C': return 'Copied';
    case 'U': return 'Unmerged';
    default: return s;
  }
}

function statusBadgeClass(s: string): string {
  switch (s) {
    case 'M': return 'bg-yellow-900/50 text-yellow-400 border border-yellow-700/50';
    case 'A': return 'bg-green-900/50 text-green-400 border border-green-700/50';
    case 'D': return 'bg-red-900/50 text-red-400 border border-red-700/50';
    case '?': return 'bg-blue-900/50 text-blue-400 border border-blue-700/50';
    case 'R': return 'bg-purple-900/50 text-purple-400 border border-purple-700/50';
    default: return 'bg-gray-800 text-gray-400 border border-gray-700';
  }
}

// --- Side-by-side diff parsing and rendering ---

interface SideBySideLine {
  leftNum: number | null;
  leftContent: string;
  leftType: 'removed' | 'context' | 'empty';
  rightNum: number | null;
  rightContent: string;
  rightType: 'added' | 'context' | 'empty';
}

interface DiffFileHunk {
  fileName: string;
  lines: SideBySideLine[];
}

function parseUnifiedDiff(diff: string): DiffFileHunk[] {
  const files: DiffFileHunk[] = [];
  const rawLines = diff.split('\n');
  let i = 0;

  while (i < rawLines.length) {
    // Find next diff header
    if (!rawLines[i].startsWith('diff ')) {
      i++;
      continue;
    }

    // Extract file name from diff header
    let fileName = '';
    const diffLine = rawLines[i];
    const match = diffLine.match(/diff --git a\/(.+?) b\/(.+)/);
    if (match) {
      fileName = match[2];
    }
    i++;

    // Skip to first hunk (past ---, +++, index lines)
    while (i < rawLines.length && !rawLines[i].startsWith('@@') && !rawLines[i].startsWith('diff ')) {
      i++;
    }

    const allLines: SideBySideLine[] = [];

    // Process all hunks for this file
    while (i < rawLines.length && !rawLines[i].startsWith('diff ')) {
      if (rawLines[i].startsWith('@@')) {
        // Parse hunk header: @@ -oldStart,oldCount +newStart,newCount @@
        const hunkMatch = rawLines[i].match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
        let leftNum = hunkMatch ? parseInt(hunkMatch[1]) : 1;
        let rightNum = hunkMatch ? parseInt(hunkMatch[2]) : 1;

        // Add hunk separator
        if (allLines.length > 0) {
          allLines.push({
            leftNum: null, leftContent: rawLines[i], leftType: 'context',
            rightNum: null, rightContent: rawLines[i], rightType: 'context',
          });
        }

        i++;

        // Collect hunk lines, pairing removals with additions
        while (i < rawLines.length && !rawLines[i].startsWith('@@') && !rawLines[i].startsWith('diff ')) {
          const line = rawLines[i];

          if (line.startsWith('-')) {
            // Collect consecutive removals
            const removals: string[] = [];
            while (i < rawLines.length && rawLines[i].startsWith('-') && !rawLines[i].startsWith('---')) {
              removals.push(rawLines[i].substring(1));
              i++;
            }
            // Collect consecutive additions that follow
            const additions: string[] = [];
            while (i < rawLines.length && rawLines[i].startsWith('+') && !rawLines[i].startsWith('+++')) {
              additions.push(rawLines[i].substring(1));
              i++;
            }

            // Pair them side by side
            const maxLen = Math.max(removals.length, additions.length);
            for (let j = 0; j < maxLen; j++) {
              allLines.push({
                leftNum: j < removals.length ? leftNum++ : null,
                leftContent: j < removals.length ? removals[j] : '',
                leftType: j < removals.length ? 'removed' : 'empty',
                rightNum: j < additions.length ? rightNum++ : null,
                rightContent: j < additions.length ? additions[j] : '',
                rightType: j < additions.length ? 'added' : 'empty',
              });
            }
          } else if (line.startsWith('+')) {
            // Standalone addition (no preceding removal)
            allLines.push({
              leftNum: null,
              leftContent: '',
              leftType: 'empty',
              rightNum: rightNum++,
              rightContent: line.substring(1),
              rightType: 'added',
            });
            i++;
          } else if (line.startsWith('\\')) {
            // "\ No newline at end of file" -- skip
            i++;
          } else {
            // Context line (starts with space or is plain text)
            const content = line.startsWith(' ') ? line.substring(1) : line;
            allLines.push({
              leftNum: leftNum++,
              leftContent: content,
              leftType: 'context',
              rightNum: rightNum++,
              rightContent: content,
              rightType: 'context',
            });
            i++;
          }
        }
      } else {
        i++;
      }
    }

    if (allLines.length > 0 || fileName) {
      files.push({ fileName, lines: allLines });
    }
  }

  return files;
}

function SideBySideDiffViewer({ diff, title }: { diff: string; title: string }) {
  const [expanded, setExpanded] = useState(true);
  const [collapsedFiles, setCollapsedFiles] = useState<Set<number>>(new Set());
  const files = useMemo(() => parseUnifiedDiff(diff), [diff]);

  if (!diff) return null;

  const toggleFile = (idx: number) => {
    setCollapsedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const lineNumCls = 'w-[50px] min-w-[50px] px-2 py-0 text-right text-gray-600 select-none border-r border-gray-800 shrink-0';
  const contentCls = 'flex-1 px-2 py-0 whitespace-pre overflow-hidden';

  return (
    <div className="border border-gray-700 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-gray-800/50 hover:bg-gray-800 text-sm font-medium text-gray-300 transition-colors"
      >
        {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        {title}
        <span className="text-xs text-gray-500 ml-2">{files.length} file{files.length !== 1 ? 's' : ''}</span>
      </button>
      {expanded && (
        <div className="bg-gray-950 overflow-x-auto max-h-[700px] overflow-y-auto">
          {files.length === 0 ? (
            <div className="text-center py-6 text-gray-500 text-sm">No changes to display</div>
          ) : (
            files.map((file, fi) => (
              <div key={fi} className="border-b border-gray-800 last:border-b-0">
                {/* File header */}
                <button
                  onClick={() => toggleFile(fi)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 bg-gray-900/80 hover:bg-gray-800/80 text-xs font-mono text-yellow-300 transition-colors"
                >
                  {collapsedFiles.has(fi) ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  <FileText className="h-3 w-3" />
                  {file.fileName}
                </button>

                {/* Side-by-side content */}
                {!collapsedFiles.has(fi) && (
                  <div className="font-mono text-xs leading-[20px]">
                    {file.lines.map((row, li) => {
                      // Hunk separator
                      if (row.leftNum === null && row.rightNum === null && row.leftContent.startsWith('@@')) {
                        return (
                          <div key={li} className="flex bg-cyan-900/20 text-cyan-400 border-y border-gray-800">
                            <div className="w-full px-3 py-0.5 text-center text-[10px]">{row.leftContent}</div>
                          </div>
                        );
                      }

                      const leftBg =
                        row.leftType === 'removed' ? 'bg-red-900/25' :
                        row.leftType === 'empty' ? 'bg-gray-900/30' : '';
                      const rightBg =
                        row.rightType === 'added' ? 'bg-green-900/25' :
                        row.rightType === 'empty' ? 'bg-gray-900/30' : '';
                      const leftText =
                        row.leftType === 'removed' ? 'text-red-300' : 'text-gray-400';
                      const rightText =
                        row.rightType === 'added' ? 'text-green-300' : 'text-gray-400';

                      return (
                        <div key={li} className="flex">
                          {/* Left side (old) */}
                          <div className={`flex w-1/2 min-w-0 ${leftBg} border-r border-gray-800`}>
                            <div className={lineNumCls}>
                              {row.leftNum ?? ''}
                            </div>
                            <div className={`${contentCls} ${leftText}`}>
                              {row.leftType === 'removed' && <span className="text-red-500 mr-1">-</span>}
                              {row.leftContent || '\u00A0'}
                            </div>
                          </div>
                          {/* Right side (new) */}
                          <div className={`flex w-1/2 min-w-0 ${rightBg}`}>
                            <div className={lineNumCls}>
                              {row.rightNum ?? ''}
                            </div>
                            <div className={`${contentCls} ${rightText}`}>
                              {row.rightType === 'added' && <span className="text-green-500 mr-1">+</span>}
                              {row.rightContent || '\u00A0'}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// --- Main component ---

type TabView = 'status' | 'diff' | 'branches';

export default function GitChangesTab() {
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [activeView, setActiveView] = useState<TabView>('status');

  // Data
  const [gitStatus, setGitStatus] = useState<GitStatusResult | null>(null);
  const [gitDiff, setGitDiff] = useState<GitDiffResult | null>(null);
  const [gitBranches, setGitBranches] = useState<GitBranchesResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Branch selector for diff view
  const [selectedBranch, setSelectedBranch] = useState<string>('');
  const [branchList, setBranchList] = useState<GitBranchInfo[]>([]);

  // Branch filter
  const [showRemote, setShowRemote] = useState(false);
  const [showStaleOnly, setShowStaleOnly] = useState(false);

  // Fetch project list
  useEffect(() => {
    fetch(`${API_BASE}/api/projects`)
      .then((r) => r.json())
      .then((data: ProjectInfo[]) => {
        const gitProjects = data.filter((p) => p.hasGit);
        setProjects(gitProjects);
        if (gitProjects.length > 0 && !selectedProject) {
          setSelectedProject(gitProjects[0].path);
        }
      })
      .catch(() => {});
  }, []);

  // Fetch branch list whenever project changes (for branch dropdown)
  useEffect(() => {
    if (!selectedProject) return;
    const encoded = encodeURIComponent(selectedProject);
    fetch(`${API_BASE}/api/projects/${encoded}/git-branches`)
      .then((r) => r.json())
      .then((data: GitBranchesResult) => {
        setBranchList(data.branches.filter((b) => !b.isRemote));
        // Reset branch selection when project changes
        setSelectedBranch('');
      })
      .catch(() => {});
  }, [selectedProject]);

  // Fetch git data when project, view, or branch changes
  const fetchGitData = useCallback(async () => {
    if (!selectedProject) return;
    setLoading(true);
    setError(null);

    const encoded = encodeURIComponent(selectedProject);
    const branchParam = selectedBranch ? `?branch=${encodeURIComponent(selectedBranch)}` : '';

    try {
      if (activeView === 'status' || activeView === 'diff') {
        const [statusRes, diffRes] = await Promise.all([
          fetch(`${API_BASE}/api/projects/${encoded}/git-status${branchParam}`),
          fetch(`${API_BASE}/api/projects/${encoded}/git-diff${branchParam}`),
        ]);
        if (!statusRes.ok) {
          const e = await statusRes.json();
          throw new Error(e.error || 'Failed to fetch status');
        }
        if (!diffRes.ok) {
          const e = await diffRes.json();
          throw new Error(e.error || 'Failed to fetch diff');
        }
        setGitStatus(await statusRes.json());
        setGitDiff(await diffRes.json());
      }

      if (activeView === 'branches') {
        const branchRes = await fetch(`${API_BASE}/api/projects/${encoded}/git-branches`);
        if (!branchRes.ok) {
          const e = await branchRes.json();
          throw new Error(e.error || 'Failed to fetch branches');
        }
        setGitBranches(await branchRes.json());
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [selectedProject, activeView, selectedBranch]);

  useEffect(() => {
    fetchGitData();
  }, [fetchGitData]);

  // Filtered branches
  const filteredBranches = useMemo(() => {
    if (!gitBranches) return [];
    let list = gitBranches.branches;
    if (!showRemote) list = list.filter((b) => !b.isRemote);
    if (showStaleOnly) list = list.filter((b) => b.isStale);
    return list;
  }, [gitBranches, showRemote, showStaleOnly]);

  const staleBranchCount = useMemo(
    () => (gitBranches?.branches.filter((b) => b.isStale && !b.isRemote).length ?? 0),
    [gitBranches]
  );

  if (projects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-gray-500">
        <GitBranch className="h-12 w-12 mb-4 opacity-30" />
        <p className="text-sm">No git-enabled projects found</p>
        <p className="text-xs mt-1 text-gray-600">Projects need to be git repositories to show here</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header: project selector + view tabs + refresh */}
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

        <Select
          value={selectedBranch || '__current__'}
          onValueChange={(v) => setSelectedBranch(v === '__current__' ? '' : v)}
        >
          <SelectTrigger className="w-[220px]">
            <div className="flex items-center gap-1.5">
              <GitBranch className="h-3.5 w-3.5 text-gray-400" />
              <SelectValue placeholder="Current branch" />
            </div>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__current__">
              Current branch
            </SelectItem>
            {branchList.map((b) => (
              <SelectItem key={b.name} value={b.name}>
                {b.name}{b.isCurrent ? ' (current)' : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex rounded-lg border border-gray-700 overflow-hidden">
          {(['status', 'diff', 'branches'] as TabView[]).map((v) => (
            <button
              key={v}
              onClick={() => setActiveView(v)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                activeView === v
                  ? 'bg-gray-700 text-white'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
              }`}
            >
              {v === 'status' && 'Status'}
              {v === 'diff' && 'Diff'}
              {v === 'branches' && 'Branches'}
            </button>
          ))}
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={fetchGitData}
          disabled={loading}
          className="ml-auto"
        >
          <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-red-900/30 border border-red-800 text-red-300 text-sm">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Summary cards */}
      {gitStatus && (activeView === 'status' || activeView === 'diff') && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <SummaryCard
            icon={<GitBranch className="h-4 w-4" />}
            label="Branch"
            value={gitStatus.branch}
          />
          <SummaryCard
            icon={<FileText className="h-4 w-4" />}
            label="Changed Files"
            value={String(gitDiff?.summary.filesChanged ?? gitStatus.files.length)}
          />
          <SummaryCard
            icon={<Plus className="h-4 w-4 text-green-400" />}
            label="Insertions"
            value={`+${gitDiff?.summary.insertions ?? 0}`}
            valueClass="text-green-400"
          />
          <SummaryCard
            icon={<Minus className="h-4 w-4 text-red-400" />}
            label="Deletions"
            value={`-${gitDiff?.summary.deletions ?? 0}`}
            valueClass="text-red-400"
          />
          <SummaryCard
            icon={<GitCommit className="h-4 w-4" />}
            label="Ahead / Behind"
            value={`${gitStatus.ahead} / ${gitStatus.behind}`}
            subValue={
              gitStatus.ahead > 0
                ? `${gitStatus.ahead} commit${gitStatus.ahead > 1 ? 's' : ''} to push`
                : gitStatus.behind > 0
                  ? `${gitStatus.behind} commit${gitStatus.behind > 1 ? 's' : ''} to pull`
                  : 'Up to date'
            }
          />
        </div>
      )}

      {/* STATUS VIEW */}
      {activeView === 'status' && gitStatus && (
        <div className="space-y-3">
          {gitStatus.files.length === 0 ? (
            <div className="text-center py-8 text-gray-500 text-sm">
              {selectedBranch
                ? `No differences between HEAD and ${selectedBranch}`
                : 'Working tree clean -- no uncommitted changes'}
            </div>
          ) : selectedBranch ? (
            <FileSection
              title={`Changes: ${selectedBranch}...HEAD`}
              files={gitStatus.files}
              bgClass="border-blue-800/50"
              projectPath={selectedProject}
              branch={selectedBranch || gitStatus.branch}
            />
          ) : (
            <>
              {/* Staged files */}
              {gitStatus.files.some((f) => f.staged) && (
                <FileSection
                  title="Staged Changes"
                  files={gitStatus.files.filter((f) => f.staged)}
                  bgClass="border-green-800/50"
                  projectPath={selectedProject}
                  branch={gitStatus.branch}
                />
              )}
              {/* Unstaged files */}
              {gitStatus.files.some((f) => !f.staged) && (
                <FileSection
                  title="Unstaged Changes"
                  files={gitStatus.files.filter((f) => !f.staged)}
                  bgClass="border-yellow-800/50"
                  projectPath={selectedProject}
                  branch={gitStatus.branch}
                />
              )}
            </>
          )}
        </div>
      )}

      {/* DIFF VIEW */}
      {activeView === 'diff' && gitDiff && (
        <div className="space-y-3">
          {!gitDiff.stagedDiff && !gitDiff.fullDiff ? (
            <div className="text-center py-8 text-gray-500 text-sm">
              No diff to display -- working tree is clean
            </div>
          ) : (
            <>
              <SideBySideDiffViewer diff={gitDiff.stagedDiff} title="Staged Changes (git diff --cached)" />
              <SideBySideDiffViewer diff={gitDiff.fullDiff} title="Unstaged Changes (git diff)" />
            </>
          )}
        </div>
      )}

      {/* BRANCHES VIEW */}
      {activeView === 'branches' && gitBranches && (
        <div className="space-y-3">
          {/* Branch filters */}
          <div className="flex items-center gap-3 text-sm">
            <label className="flex items-center gap-1.5 text-gray-400 cursor-pointer">
              <input
                type="checkbox"
                checked={showRemote}
                onChange={(e) => setShowRemote(e.target.checked)}
                className="rounded border-gray-600"
              />
              Show remote
            </label>
            <label className="flex items-center gap-1.5 text-gray-400 cursor-pointer">
              <input
                type="checkbox"
                checked={showStaleOnly}
                onChange={(e) => setShowStaleOnly(e.target.checked)}
                className="rounded border-gray-600"
              />
              Stale only
              {staleBranchCount > 0 && (
                <span className="px-1.5 py-0.5 text-xs rounded bg-orange-900/50 text-orange-400 border border-orange-700/50">
                  {staleBranchCount}
                </span>
              )}
            </label>
            <span className="text-gray-600 ml-auto">
              {filteredBranches.length} branch{filteredBranches.length !== 1 ? 'es' : ''}
            </span>
          </div>

          {/* Branch table */}
          <div className="border border-gray-700 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-800/50 text-gray-400 text-xs">
                  <th className="text-left px-3 py-2 font-medium">Branch</th>
                  <th className="text-left px-3 py-2 font-medium">Hash</th>
                  <th className="text-left px-3 py-2 font-medium">Message</th>
                  <th className="text-left px-3 py-2 font-medium">Age</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {filteredBranches.map((b) => (
                  <tr
                    key={b.name}
                    className={`hover:bg-gray-800/30 ${b.isCurrent ? 'bg-blue-900/20' : ''}`}
                  >
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        <GitBranch className={`h-3.5 w-3.5 ${b.isCurrent ? 'text-blue-400' : 'text-gray-500'}`} />
                        <span className={b.isCurrent ? 'text-blue-300 font-medium' : 'text-gray-300'}>
                          {b.name}
                        </span>
                        {b.isCurrent && (
                          <span className="px-1.5 py-0.5 text-[10px] rounded bg-blue-900/50 text-blue-400 border border-blue-700/50">
                            current
                          </span>
                        )}
                        {b.isStale && (
                          <span className="px-1.5 py-0.5 text-[10px] rounded bg-orange-900/50 text-orange-400 border border-orange-700/50">
                            stale
                          </span>
                        )}
                        {b.isRemote && (
                          <span className="px-1.5 py-0.5 text-[10px] rounded bg-gray-800 text-gray-500 border border-gray-700">
                            remote
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-gray-500">{b.shortHash}</td>
                    <td className="px-3 py-2 text-gray-400 text-xs max-w-[400px] truncate">
                      {b.subject}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1 text-xs text-gray-500">
                        <Clock className="h-3 w-3" />
                        {b.date}
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredBranches.length === 0 && (
                  <tr>
                    <td colSpan={4} className="text-center py-6 text-gray-500 text-sm">
                      No branches match the current filters
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Sub-components ---

function SummaryCard({
  icon,
  label,
  value,
  valueClass,
  subValue,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  valueClass?: string;
  subValue?: string;
}) {
  return (
    <div className="border border-gray-700 rounded-lg p-3 bg-gray-900/50">
      <div className="flex items-center gap-2 text-gray-400 text-xs mb-1">
        {icon}
        {label}
      </div>
      <div className={`text-lg font-semibold truncate ${valueClass ?? 'text-gray-100'}`}>{value}</div>
      {subValue && <div className="text-xs text-gray-500 mt-0.5">{subValue}</div>}
    </div>
  );
}

function FileSection({
  title,
  files,
  bgClass,
  projectPath,
  branch,
}: {
  title: string;
  files: GitFileStatus[];
  bgClass: string;
  projectPath?: string;
  branch?: string;
}) {
  return (
    <div className={`border ${bgClass} rounded-lg overflow-hidden`}>
      <div className="px-3 py-2 bg-gray-800/30 text-sm font-medium text-gray-300 flex items-center justify-between">
        {title}
        <span className="text-xs text-gray-500">{files.length} file{files.length !== 1 ? 's' : ''}</span>
      </div>
      <div className="divide-y divide-gray-800/50">
        {files.map((f, i) => (
          <div key={`${f.file}-${i}`} className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-800/20">
            <span className={`px-1.5 py-0.5 text-[10px] font-mono rounded ${statusBadgeClass(f.status)}`}>
              {f.status}
            </span>
            <span className="text-sm text-gray-300 font-mono truncate">
              {f.origFile ? (
                <>
                  <span className="text-gray-500">{f.origFile}</span>
                  <span className="text-gray-600 mx-1">{'->'}</span>
                  {f.file}
                </>
              ) : (
                f.file
              )}
            </span>
            <span className="text-[10px] text-gray-600 ml-auto mr-1">{statusLabel(f.status)}</span>
            {projectPath && (
              <AISessionButton
                cwd={projectPath}
                prompt={gitFileChange(projectPath, branch || 'HEAD', f.file, statusLabel(f.status))}
                variant="icon-only"
                size="icon"
                tooltip="Review in AI"
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
