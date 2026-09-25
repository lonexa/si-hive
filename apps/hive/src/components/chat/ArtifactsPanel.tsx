import { useState, useMemo } from 'react';
import { FileCode2, FileText, FileSpreadsheet, Image, Copy, Download, ChevronLeft, ChevronRight, CheckCircle2, Package, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ChatMessage } from '@/stores/chat-store';
import { API_BASE } from '@/lib/api-config';

interface Artifact {
  id: string;
  type: 'code' | 'csv' | 'image' | 'document';
  title: string;
  content: string;
  language?: string;
  filePath?: string;
  timestamp: string;
}

function extractArtifacts(messages: ChatMessage[]): Artifact[] {
  const artifacts: Artifact[] = [];
  const seen = new Set<string>();

  const fileExts = ['csv', 'tsv', 'xlsx', 'xls', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp',
    'md', 'txt', 'html', 'pdf', 'doc', 'docx', 'json', 'xml', 'py', 'js', 'ts', 'sql', 'sh', 'bat'];

  function classifyExt(ext: string): Artifact['type'] {
    if (['csv', 'tsv', 'xlsx', 'xls'].includes(ext)) return 'csv';
    if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp'].includes(ext)) return 'image';
    if (['md', 'txt', 'html', 'pdf', 'doc', 'docx'].includes(ext)) return 'document';
    return 'code';
  }

  function addArtifact(id: string, filePath: string, content: string, timestamp: string) {
    const fileName = filePath.split(/[\\/]/).pop() || 'file';
    if (seen.has(fileName)) return;
    seen.add(fileName);
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    artifacts.push({ id, type: classifyExt(ext), title: fileName, content, language: ext, filePath, timestamp });
  }

  // 1. Extract file operations (Write/Edit tools)
  for (const msg of messages) {
    if (msg.type !== 'tool_use' || (msg.toolName !== 'Write' && msg.toolName !== 'Edit')) continue;
    try {
      const input = JSON.parse(msg.content);
      if (input.file_path) addArtifact(msg.id, input.file_path, input.content || input.new_string || '', msg.timestamp);
    } catch { /* skip */ }
  }

  // 2. Extract file paths from Bash tool_use (commands that create files)
  //    and from tool_result messages (output mentioning saved/created files)
  for (const msg of messages) {
    if (msg.type === 'tool_result' || (msg.type === 'tool_use' && msg.toolName === 'Bash')) {
      // Look for file paths in the content
      const pathRegex = /(?:saved?\s+(?:to|as|at|file)?|created?|wrote?\s+to|output\s+(?:to|file)?|generated?)\s*:?\s*[`"']?([A-Za-z]:\\[^\s`"']+\.\w+|\/[^\s`"']+\.\w+)/gi;
      let pathMatch;
      while ((pathMatch = pathRegex.exec(msg.content)) !== null) {
        const fp = pathMatch[1];
        const ext = fp.split('.').pop()?.toLowerCase() || '';
        if (fileExts.includes(ext)) addArtifact(`${msg.id}-path`, fp, '', msg.timestamp);
      }
    }
  }

  // 3. Extract file paths from assistant text messages ("I've saved...", "Created file...")
  for (const msg of messages) {
    if (msg.role !== 'assistant' || msg.type !== 'text') continue;
    const pathRegex = /(?:saved?\s+(?:to|as|at|the\s+file)?|created?\s+(?:the\s+file)?|wrote?\s+to|generated?\s+(?:the\s+)?(?:image|file|chart)?)\s*:?\s*[`"']?([A-Za-z]:\\[^\s`"'\n]+\.\w+|\/[^\s`"'\n]+\.\w+)/gi;
    let pathMatch;
    while ((pathMatch = pathRegex.exec(msg.content)) !== null) {
      const fp = pathMatch[1].replace(/[`"'.,)]+$/, ''); // trim trailing punctuation
      const ext = fp.split('.').pop()?.toLowerCase() || '';
      if (fileExts.includes(ext)) addArtifact(`${msg.id}-fp`, fp, '', msg.timestamp);
    }

    // Also extract large code blocks
    const codeRegex = /```(\w+)?\n([\s\S]*?)```/g;
    let codeMatch;
    while ((codeMatch = codeRegex.exec(msg.content)) !== null) {
      const lang = codeMatch[1] || 'text';
      const code = codeMatch[2].trim();
      if (code.length < 50) continue;
      const beforeBlock = msg.content.slice(0, codeMatch.index);
      const fileMatch = beforeBlock.match(/[`"]([^`"]+\.\w+)[`"]\s*[:\n]*$/);
      const title = fileMatch ? fileMatch[1] : `${lang} snippet`;
      if (seen.has(title)) continue;
      seen.add(title);
      artifacts.push({ id: `${msg.id}-code-${artifacts.length}`, type: lang === 'csv' ? 'csv' : 'code', title, content: code, language: lang, timestamp: msg.timestamp });
    }
  }
  return artifacts;
}

function iconForType(type: Artifact['type']) {
  switch (type) {
    case 'code': return <FileCode2 className="h-3.5 w-3.5 text-blue-400" />;
    case 'csv': return <FileSpreadsheet className="h-3.5 w-3.5 text-green-400" />;
    case 'image': return <Image className="h-3.5 w-3.5 text-purple-400" />;
    case 'document': return <FileText className="h-3.5 w-3.5 text-amber-400" />;
  }
}

export default function ArtifactsPanel({ messages }: { messages: ChatMessage[] }) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const artifacts = useMemo(() => extractArtifacts(messages), [messages]);
  const selected = selectedIndex !== null ? artifacts[selectedIndex] : null;

  function handleCopy(content: string) {
    void navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleDownload(a: Artifact) {
    if (a.content) {
      const blob = new Blob([a.content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const el = document.createElement('a');
      el.href = url; el.download = a.title; el.click();
      URL.revokeObjectURL(url);
    } else if (a.filePath) {
      // Open the file location via the API
      void fetch(`${API_BASE}/api/open-path?path=${encodeURIComponent(a.filePath)}`).catch(() => {});
    }
  }

  // Detail view
  if (selected) {
    return (
      <div className="w-[340px] border-l border-border bg-card flex flex-col hidden lg:flex">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0">
          <button onClick={() => setSelectedIndex(null)} className="h-6 w-6 rounded-md hover:bg-secondary flex items-center justify-center text-muted-foreground hover:text-foreground">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="flex-1 min-w-0 flex items-center gap-1.5">
            {iconForType(selected.type)}
            <span className="text-xs font-medium text-foreground truncate">{selected.title}</span>
          </div>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleCopy(selected.content)} title="Copy">
            {copied ? <CheckCircle2 className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleDownload(selected)} title="Download">
            <Download className="h-3 w-3" />
          </Button>
        </div>
        {artifacts.length > 1 && (
          <div className="flex items-center justify-between px-3 py-1 border-b border-border/50 text-[10px] text-muted-foreground">
            <button disabled={selectedIndex === 0} onClick={() => setSelectedIndex((i) => Math.max(0, (i ?? 0) - 1))} className="disabled:opacity-30 hover:text-foreground"><ChevronLeft className="h-3 w-3" /></button>
            <span>{(selectedIndex ?? 0) + 1} of {artifacts.length}</span>
            <button disabled={selectedIndex === artifacts.length - 1} onClick={() => setSelectedIndex((i) => Math.min(artifacts.length - 1, (i ?? 0) + 1))} className="disabled:opacity-30 hover:text-foreground"><ChevronRight className="h-3 w-3" /></button>
          </div>
        )}
        <div className="flex-1 overflow-auto p-3">
          {selected.type === 'image' && selected.filePath ? (
            <div className="space-y-3">
              <img
                src={`${API_BASE}/api/file-preview?path=${encodeURIComponent(selected.filePath)}`}
                alt={selected.title}
                className="max-w-full rounded-md border border-border"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
              <button
                onClick={() => handleDownload(selected)}
                className="flex items-center gap-2 text-xs text-primary hover:underline"
              >
                <ExternalLink className="h-3 w-3" />
                Open {selected.filePath}
              </button>
            </div>
          ) : selected.content ? (
            <pre className="text-[11px] text-foreground font-mono bg-secondary rounded-md p-3 whitespace-pre-wrap break-words">{selected.content}</pre>
          ) : selected.filePath ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              {iconForType(selected.type)}
              <p className="text-xs text-foreground mt-2">{selected.title}</p>
              <p className="text-[10px] text-muted-foreground mt-1 break-all px-2">{selected.filePath}</p>
              <button
                onClick={() => handleDownload(selected)}
                className="flex items-center gap-2 text-xs text-primary hover:underline mt-3"
              >
                <ExternalLink className="h-3 w-3" />
                Open file location
              </button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No content available</p>
          )}
        </div>
      </div>
    );
  }

  // List view
  return (
    <div className="w-[280px] border-l border-border bg-card flex flex-col hidden lg:flex">
      <div className="p-3 border-b border-border shrink-0">
        <h3 className="text-xs font-semibold text-foreground uppercase tracking-wide flex items-center gap-1.5">
          <Package className="h-3.5 w-3.5 text-primary" />
          Artifacts
        </h3>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {artifacts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground text-center px-4">
            <Package className="h-8 w-8 opacity-20 mb-3" />
            <p className="text-xs font-medium">No artifacts yet</p>
            <p className="text-[10px] mt-1">Generated files, code, spreadsheets, and images will appear here for quick access.</p>
          </div>
        ) : (
          <div className="space-y-1">
            {artifacts.map((a, i) => (
              <button key={a.id} onClick={() => setSelectedIndex(i)} className="w-full flex items-center gap-2 px-2 py-2 text-left rounded-md hover:bg-secondary transition-colors group">
                {iconForType(a.type)}
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-foreground truncate">{a.title}</div>
                  <div className="text-[10px] text-muted-foreground">{a.language}</div>
                </div>
                <ChevronRight className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
