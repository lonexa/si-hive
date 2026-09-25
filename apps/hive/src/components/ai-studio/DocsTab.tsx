import { useState, useCallback, useEffect } from 'react';
import { Loader2, FileText, FolderOpen, Copy, Download, ChevronRight, ChevronDown, Settings, AlertTriangle, Check, File, Folder } from 'lucide-react';
import { Button } from '@/components/ui/button';
import AISessionButton from '@/components/shared/AISessionButton';
import { docsGenerate } from '@/lib/prompt-templates';
import { resolveDefaultProjectDir } from '@/lib/project-mappings';

import { API_BASE } from '@/lib/api-config';

type DocType = 'api' | 'schema' | 'readme' | 'onboarding';

interface ProjectFile {
  path: string;
  size: number;
  isDirectory: boolean;
}

interface AIConfig {
  configured: boolean;
  endpoint: string | null;
  model: string | null;
}

const DOC_TYPES: Array<{ value: DocType; label: string; description: string }> = [
  { value: 'api', label: 'API Docs', description: 'Document API endpoints from controllers and route handlers' },
  { value: 'schema', label: 'Schema Docs', description: 'Document database schema from models, migrations, or SQL files' },
  { value: 'readme', label: 'README', description: 'Generate a comprehensive project README' },
  { value: 'onboarding', label: 'Onboarding Guide', description: 'Create a developer onboarding guide for the project' },
];

export default function DocsTab() {
  const [aiConfig, setAIConfig] = useState<AIConfig | null>(null);
  const [configChecked, setConfigChecked] = useState(false);

  // File picker state
  const [projectRoot, setProjectRoot] = useState('');
  const [projectFiles, setProjectFiles] = useState<ProjectFile[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());

  // Doc generation state
  const [docType, setDocType] = useState<DocType>('api');
  const [additionalContext, setAdditionalContext] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generatedMarkdown, setGeneratedMarkdown] = useState<string | null>(null);
  const [filesProcessed, setFilesProcessed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [claudeProjectDir, setClaudeProjectDir] = useState('');

  useEffect(() => {
    resolveDefaultProjectDir().then(setClaudeProjectDir);
  }, []);

  const checkConfig = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/ai-studio/config`);
      const data = await res.json() as AIConfig;
      setAIConfig(data);
      setConfigChecked(true);
    } catch {
      setAIConfig({ configured: false, endpoint: null, model: null });
      setConfigChecked(true);
    }
  }, []);

  useEffect(() => {
    if (!configChecked) checkConfig();
  }, [configChecked, checkConfig]);

  const loadProjectFiles = useCallback(async () => {
    if (!projectRoot.trim()) return;
    setLoadingFiles(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/ai-studio/project-files?root=${encodeURIComponent(projectRoot)}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to list project files');
        return;
      }
      setProjectFiles(data.files ?? []);
      setSelectedFiles(new Set());
      setExpandedDirs(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setLoadingFiles(false);
    }
  }, [projectRoot]);

  const generateDocs = useCallback(async () => {
    if (selectedFiles.size === 0) {
      setError('Select at least one file to generate documentation');
      return;
    }
    setGenerating(true);
    setError(null);
    setGeneratedMarkdown(null);
    try {
      const res = await fetch(`${API_BASE}/api/ai-studio/generate-docs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filePaths: Array.from(selectedFiles),
          docType,
          projectRoot: projectRoot.trim() || undefined,
          additionalContext: additionalContext.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to generate documentation');
        return;
      }
      setGeneratedMarkdown(data.markdown ?? '');
      setFilesProcessed(data.filesProcessed ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setGenerating(false);
    }
  }, [selectedFiles, docType, projectRoot, additionalContext]);

  const toggleFile = (filePath: string) => {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(filePath)) {
        next.delete(filePath);
      } else {
        next.add(filePath);
      }
      return next;
    });
  };

  const toggleDir = (dirPath: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(dirPath)) {
        next.delete(dirPath);
      } else {
        next.add(dirPath);
      }
      return next;
    });
  };

  const selectAllInDir = (dirPath: string) => {
    const filesInDir = projectFiles.filter((f) =>
      !f.isDirectory && f.path.startsWith(dirPath + '/')
    );
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      const allSelected = filesInDir.every((f) => next.has(f.path));
      for (const f of filesInDir) {
        if (allSelected) {
          next.delete(f.path);
        } else {
          next.add(f.path);
        }
      }
      return next;
    });
  };

  const copyToClipboard = () => {
    if (generatedMarkdown) {
      navigator.clipboard.writeText(generatedMarkdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const downloadMarkdown = () => {
    if (!generatedMarkdown) return;
    const blob = new Blob([generatedMarkdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${docType}-docs.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!configChecked) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Checking configuration...
      </div>
    );
  }

  if (aiConfig && !aiConfig.configured) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
        <Settings className="h-10 w-10 mb-3 opacity-40" />
        <p className="text-sm font-medium text-foreground mb-1">No AI backend configured</p>
        <p className="text-xs text-center max-w-md mb-4">
          Choose one in <a href="/settings?tab=ai" className="text-primary hover:underline">Settings → AI</a> — your installed AI CLI works without an API key.
        </p>
      </div>
    );
  }

  // Build file tree structure
  const rootDirs = new Set<string>();
  for (const f of projectFiles) {
    const firstSlash = f.path.indexOf('/');
    if (firstSlash > 0) {
      rootDirs.add(f.path.substring(0, firstSlash));
    }
  }

  function getFilesInDir(dirPath: string): ProjectFile[] {
    return projectFiles.filter(
      (f) => !f.isDirectory && f.path.startsWith(dirPath + '/') && !f.path.substring(dirPath.length + 1).includes('/')
    );
  }

  function getSubDirs(dirPath: string): string[] {
    const dirs = new Set<string>();
    for (const f of projectFiles) {
      if (f.isDirectory && f.path.startsWith(dirPath + '/') && !f.path.substring(dirPath.length + 1).includes('/')) {
        dirs.add(f.path);
      }
    }
    return Array.from(dirs).sort();
  }

  function renderDir(dirPath: string, depth: number) {
    const isExpanded = expandedDirs.has(dirPath);
    const dirName = dirPath.split('/').pop() || dirPath;
    const subDirs = getSubDirs(dirPath);
    const filesInDir = getFilesInDir(dirPath);

    return (
      <div key={dirPath} style={{ paddingLeft: depth * 16 }}>
        <div
          className="flex items-center gap-1 py-0.5 cursor-pointer hover:bg-muted/30 rounded px-1 group"
          onClick={() => toggleDir(dirPath)}
        >
          {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          <Folder className="h-3 w-3 text-blue-400" />
          <span className="text-xs">{dirName}</span>
          <button
            className="text-xs text-muted-foreground opacity-0 group-hover:opacity-100 ml-auto px-1 hover:text-foreground"
            onClick={(e) => { e.stopPropagation(); selectAllInDir(dirPath); }}
          >
            toggle all
          </button>
        </div>
        {isExpanded && (
          <>
            {subDirs.map((sd) => renderDir(sd, depth + 1))}
            {filesInDir.map((f) => (
              <div
                key={f.path}
                style={{ paddingLeft: (depth + 1) * 16 }}
                className={`flex items-center gap-1 py-0.5 cursor-pointer hover:bg-muted/30 rounded px-1 ${selectedFiles.has(f.path) ? 'bg-blue-500/10' : ''}`}
                onClick={() => toggleFile(f.path)}
              >
                <input
                  type="checkbox"
                  checked={selectedFiles.has(f.path)}
                  onChange={() => toggleFile(f.path)}
                  className="h-3 w-3"
                  onClick={(e) => e.stopPropagation()}
                />
                <File className="h-3 w-3 text-muted-foreground" />
                <span className="text-xs">{f.path.split('/').pop()}</span>
                <span className="text-xs text-muted-foreground ml-auto">{(f.size / 1024).toFixed(1)}KB</span>
              </div>
            ))}
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <FileText className="h-5 w-5" /> Documentation Generator
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Select source files and generate documentation using AI
            {aiConfig?.model && <> ({aiConfig.model})</>}
          </p>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-sm text-red-400 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        {/* Left: File Picker */}
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Project Root</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={projectRoot}
                onChange={(e) => setProjectRoot(e.target.value)}
                placeholder="C:/path/to/project"
                className="flex-1 bg-background border rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={loadProjectFiles}
                disabled={loadingFiles || !projectRoot.trim()}
                data-track="ai_studio.docs.load_project_files"
                data-track-category="action"
              >
                {loadingFiles ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderOpen className="h-4 w-4" />}
              </Button>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Documentation Type</label>
            <div className="grid grid-cols-2 gap-2">
              {DOC_TYPES.map((dt) => (
                <button
                  key={dt.value}
                  className={`text-left p-2 rounded border text-xs transition-colors ${
                    docType === dt.value
                      ? 'border-blue-500 bg-blue-500/10 text-foreground'
                      : 'border-border hover:border-muted-foreground/50 text-muted-foreground'
                  }`}
                  onClick={() => setDocType(dt.value)}
                  data-track={`ai_studio.docs.select_doc_type_${dt.value}`}
                  data-track-category="feature"
                >
                  <p className="font-medium">{dt.label}</p>
                  <p className="text-[10px] mt-0.5 opacity-70">{dt.description}</p>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Additional Context (optional)</label>
            <textarea
              value={additionalContext}
              onChange={(e) => setAdditionalContext(e.target.value)}
              placeholder="Any extra instructions or context for the AI..."
              className="w-full bg-background border rounded px-2 py-1.5 text-sm h-16 resize-none focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          {/* File tree */}
          {projectFiles.length > 0 && (
            <div className="border rounded-lg p-2 max-h-[300px] overflow-y-auto">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-muted-foreground">{projectFiles.filter((f) => !f.isDirectory).length} files</span>
                <span className="text-xs text-muted-foreground">{selectedFiles.size} selected</span>
              </div>
              {Array.from(rootDirs).sort().map((dir) => renderDir(dir, 0))}
              {/* Files at root level */}
              {projectFiles.filter((f) => !f.isDirectory && !f.path.includes('/')).map((f) => (
                <div
                  key={f.path}
                  className={`flex items-center gap-1 py-0.5 cursor-pointer hover:bg-muted/30 rounded px-1 ${selectedFiles.has(f.path) ? 'bg-blue-500/10' : ''}`}
                  onClick={() => toggleFile(f.path)}
                >
                  <input
                    type="checkbox"
                    checked={selectedFiles.has(f.path)}
                    onChange={() => toggleFile(f.path)}
                    className="h-3 w-3"
                    onClick={(e) => e.stopPropagation()}
                  />
                  <File className="h-3 w-3 text-muted-foreground" />
                  <span className="text-xs">{f.path}</span>
                  <span className="text-xs text-muted-foreground ml-auto">{(f.size / 1024).toFixed(1)}KB</span>
                </div>
              ))}
            </div>
          )}

          <Button
            onClick={generateDocs}
            disabled={generating || selectedFiles.size === 0}
            className="w-full"
            data-track="ai_studio.docs.generate_docs"
            data-track-category="action"
          >
            {generating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Generating documentation...
              </>
            ) : (
              <>
                <FileText className="h-4 w-4 mr-2" />
                Generate {DOC_TYPES.find((d) => d.value === docType)?.label} ({selectedFiles.size} files)
              </>
            )}
          </Button>
        </div>

        {/* Right: Generated docs preview */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Generated Documentation</span>
            {generatedMarkdown && (
              <div className="flex gap-1">
                <AISessionButton
                  cwd={projectRoot.trim() || claudeProjectDir}
                  prompt={docsGenerate(projectRoot.trim() || claudeProjectDir, docType, generatedMarkdown.substring(0, 2000))}
                  label="Refine"
                  variant="ghost"
                  size="sm"
                  tooltip="Refine docs in AI"
                />
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={copyToClipboard}
                  data-track="ai_studio.docs.copy_markdown"
                  data-track-category="action"
                >
                  {copied ? <Check className="h-3 w-3 text-green-400" /> : <Copy className="h-3 w-3" />}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={downloadMarkdown}
                  data-track="ai_studio.docs.download_markdown"
                  data-track-category="action"
                >
                  <Download className="h-3 w-3" />
                </Button>
              </div>
            )}
          </div>

          {generatedMarkdown ? (
            <div className="border rounded-lg p-4 bg-muted/20 max-h-[500px] overflow-y-auto">
              <div className="text-xs text-muted-foreground mb-2">
                {filesProcessed} files processed
              </div>
              <pre className="text-sm whitespace-pre-wrap font-mono leading-relaxed">{generatedMarkdown}</pre>
            </div>
          ) : (
            <div className="border rounded-lg p-4 bg-muted/10 flex flex-col items-center justify-center h-[400px] text-muted-foreground">
              <FileText className="h-10 w-10 mb-3 opacity-20" />
              <p className="text-xs text-center max-w-xs">
                Select files and click Generate to create documentation. The AI will analyze the source code and produce Markdown output.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
