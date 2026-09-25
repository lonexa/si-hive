import { useEffect, useRef, useState, type RefObject, type ClipboardEvent, type DragEvent } from 'react';
import {
  ExternalLink, ArrowRight, Copy, ClipboardCheck, Camera, Image as ImageIcon,
  ScreenShare, X, Sparkles, Save, Pencil,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { API_BASE } from '@/lib/api-config';
import type { TerminalViewHandle } from '../TerminalView';

const CLAUDE_DESIGN_URL = 'https://claude.ai/design';
const POPUP_NAME = 'hive-claude-design';
const POPUP_FEATURES = 'popup=yes,width=900,height=900';

const DEFAULT_FIX_PROMPT =
  "Here's what Claude Code produced (attached screenshot). Compare it to the design and reply with a single concrete prompt I can paste into Claude Code to fix the differences. Reference exact element names where possible. Keep it actionable.";

const LS_PREVIEW_URL = 'hive-design-preview-url';
const LS_FIX_PROMPT = 'hive-design-fix-prompt';

type CopyStatus = 'idle' | 'copied';
type CaptureBusy = 'idle' | 'preview' | 'window';

interface DesignPanelProps {
  terminalRef: RefObject<TerminalViewHandle | null>;
  sessionId?: string;
}

function lsGet(key: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  try { return window.localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function lsSet(key: string, value: string): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(key, value); } catch { /* ignore */ }
}

export default function DesignPanel({ terminalRef, sessionId }: DesignPanelProps) {
  const popupRef = useRef<Window | null>(null);

  // Capture state
  const [previewUrl, setPreviewUrl] = useState(() => lsGet(LS_PREVIEW_URL, ''));
  const [imageBlob, setImageBlob] = useState<Blob | null>(null);
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [captureBusy, setCaptureBusy] = useState<CaptureBusy>('idle');
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [imgCopyStatus, setImgCopyStatus] = useState<CopyStatus>('idle');

  // Fix-it prompt
  const [fixPrompt, setFixPrompt] = useState(() => lsGet(LS_FIX_PROMPT, DEFAULT_FIX_PROMPT));
  const [editingFix, setEditingFix] = useState(false);
  const [fixCopyStatus, setFixCopyStatus] = useState<CopyStatus>('idle');

  // Prompt-back to terminal
  const [prompt, setPrompt] = useState('');
  const [autoSubmit, setAutoSubmit] = useState(true);

  // Terminal selection copy
  const [selCopyStatus, setSelCopyStatus] = useState<CopyStatus>('idle');

  useEffect(() => { lsSet(LS_PREVIEW_URL, previewUrl); }, [previewUrl]);
  useEffect(() => { lsSet(LS_FIX_PROMPT, fixPrompt); }, [fixPrompt]);

  function openClaudeDesign() {
    const existing = popupRef.current;
    if (existing && !existing.closed) {
      existing.focus();
      return;
    }
    popupRef.current = window.open(CLAUDE_DESIGN_URL, POPUP_NAME, POPUP_FEATURES);
  }

  async function setImage(blob: Blob) {
    setImageBlob(blob);
    setCaptureError(null);
    const reader = new FileReader();
    reader.onload = () => setImageDataUrl(typeof reader.result === 'string' ? reader.result : null);
    reader.readAsDataURL(blob);
  }

  function clearImage() {
    setImageBlob(null);
    setImageDataUrl(null);
    setCaptureError(null);
  }

  async function capturePreviewUrl() {
    if (!sessionId) return;
    const target = previewUrl.trim();
    if (!target) {
      setCaptureError('Enter a preview URL first (e.g. http://localhost:3000)');
      return;
    }
    setCaptureBusy('preview');
    setCaptureError(null);
    try {
      const res = await fetch(`${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}/screenshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: target }),
      });
      const data = await res.json() as { pngBase64?: string; error?: string };
      if (!res.ok || !data.pngBase64) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const bytes = Uint8Array.from(atob(data.pngBase64), (c) => c.charCodeAt(0));
      await setImage(new Blob([bytes], { type: 'image/png' }));
    } catch (err) {
      setCaptureError(err instanceof Error ? err.message : String(err));
    } finally {
      setCaptureBusy('idle');
    }
  }

  async function captureWindow() {
    if (!('mediaDevices' in navigator) || !('getDisplayMedia' in navigator.mediaDevices)) {
      setCaptureError('Window capture is not supported in this browser.');
      return;
    }
    setCaptureBusy('window');
    setCaptureError(null);
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: { displaySurface: 'window' } as MediaTrackConstraints });
      const video = document.createElement('video');
      video.srcObject = stream;
      video.muted = true;
      await video.play();
      // Tiny delay so the first frame is real
      await new Promise((r) => setTimeout(r, 150));
      const w = video.videoWidth || 1280;
      const h = video.videoHeight || 800;
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Could not get canvas context');
      ctx.drawImage(video, 0, 0, w, h);
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
      if (!blob) throw new Error('Canvas produced no image');
      await setImage(blob);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // User cancelling the picker is not an error
      if (!/permission|cancelled|not allowed|NotAllowed/i.test(msg)) {
        setCaptureError(msg);
      }
    } finally {
      stream?.getTracks().forEach((t) => t.stop());
      setCaptureBusy('idle');
    }
  }

  function onPaste(e: ClipboardEvent<HTMLDivElement>) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.type.startsWith('image/')) {
        const file = it.getAsFile();
        if (file) {
          e.preventDefault();
          void setImage(file);
          return;
        }
      }
    }
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) {
      void setImage(file);
    }
  }

  async function copyImageToClipboard() {
    if (!imageBlob) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ [imageBlob.type]: imageBlob })]);
      setImgCopyStatus('copied');
      setTimeout(() => setImgCopyStatus('idle'), 1200);
    } catch (err) {
      setCaptureError(err instanceof Error ? err.message : 'Could not copy image (clipboard permission?)');
    }
  }

  async function copyImageAndOpenDesign() {
    await copyImageToClipboard();
    openClaudeDesign();
  }

  async function copyFixPrompt() {
    try {
      await navigator.clipboard.writeText(fixPrompt);
      setFixCopyStatus('copied');
      setTimeout(() => setFixCopyStatus('idle'), 1200);
    } catch {
      // ignore
    }
  }

  function sendToTerminal() {
    const text = prompt.trim();
    if (!text) return;
    terminalRef.current?.sendInput(text, autoSubmit);
    setPrompt('');
  }

  async function copyTerminalSelection() {
    const selection = terminalRef.current?.getSelection() ?? '';
    if (!selection) return;
    try {
      await navigator.clipboard.writeText(selection);
      setSelCopyStatus('copied');
      setTimeout(() => setSelCopyStatus('idle'), 1200);
    } catch {
      // ignore
    }
  }

  function onPromptKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      sendToTerminal();
    }
  }

  return (
    <div className="flex flex-col h-full p-3 gap-4 overflow-y-auto bg-secondary text-sm">
      <section>
        <Button
          variant="outline"
          size="sm"
          onClick={openClaudeDesign}
          className="w-full justify-start gap-2"
        >
          <ExternalLink className="h-4 w-4" />
          Open Claude Design
        </Button>
        <p className="text-[11px] text-muted-foreground mt-1.5 leading-snug">
          Opens claude.ai/design in a managed popup. Click again to focus the existing window.
        </p>
      </section>

      {/* Capture → push to Design */}
      <section className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Camera className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">
            Capture & push to Design
          </h3>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] text-muted-foreground">Preview URL</label>
          <div className="flex gap-1.5">
            <Input
              value={previewUrl}
              onChange={(e) => setPreviewUrl(e.target.value)}
              placeholder="http://localhost:3000"
              className="h-8 text-xs"
            />
            <Button
              size="sm"
              variant="outline"
              onClick={capturePreviewUrl}
              disabled={captureBusy !== 'idle' || !sessionId || !previewUrl.trim()}
              className="h-8 shrink-0 gap-1.5"
              title="Screenshot the preview URL using Playwright"
            >
              <Camera className="h-3.5 w-3.5" />
              {captureBusy === 'preview' ? 'Capturing…' : 'Capture'}
            </Button>
          </div>
        </div>

        <Button
          size="sm"
          variant="outline"
          onClick={captureWindow}
          disabled={captureBusy !== 'idle'}
          className="justify-start gap-2"
          title="Pick a window or screen to capture one frame from"
        >
          <ScreenShare className="h-4 w-4" />
          {captureBusy === 'window' ? 'Capturing window…' : 'Capture a window'}
        </Button>

        <div
          tabIndex={0}
          onPaste={onPaste}
          onDrop={onDrop}
          onDragOver={(e) => e.preventDefault()}
          className={
            'rounded border-2 border-dashed border-border bg-background/50 p-3 text-[11px] text-muted-foreground ' +
            'focus:outline-none focus:border-primary hover:border-muted-foreground transition-colors text-center'
          }
        >
          <ImageIcon className="h-4 w-4 mx-auto mb-1 opacity-60" />
          <div>Click here, then <kbd className="px-1 py-0.5 rounded bg-muted text-[10px]">Ctrl+V</kbd> to paste a screenshot</div>
          <div className="mt-0.5 opacity-70">…or drag a PNG/JPG file in</div>
        </div>

        {captureError && (
          <div className="rounded border border-red-700/40 bg-red-950/30 px-2 py-1.5 text-[11px] text-red-300">
            {captureError}
          </div>
        )}

        {imageDataUrl && (
          <div className="flex flex-col gap-1.5 rounded border border-border bg-background/40 p-2">
            <div className="flex items-start gap-2">
              <img
                src={imageDataUrl}
                alt="Captured preview"
                className="max-h-32 w-auto rounded border border-border object-contain"
              />
              <Button
                variant="ghost"
                size="icon"
                onClick={clearImage}
                className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
                title="Discard"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <Button
                size="sm"
                onClick={copyImageAndOpenDesign}
                className="gap-1.5"
              >
                <Copy className="h-3.5 w-3.5" />
                Copy + Open Design
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={copyImageToClipboard}
                className="gap-1.5"
              >
                {imgCopyStatus === 'copied' ? (
                  <><ClipboardCheck className="h-3.5 w-3.5 text-green-400" />Copied</>
                ) : (
                  <><Copy className="h-3.5 w-3.5" />Copy image</>
                )}
              </Button>
            </div>
          </div>
        )}

        {/* Fix-it prompt template */}
        <div className="flex flex-col gap-1.5">
          {!editingFix ? (
            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                variant="outline"
                onClick={copyFixPrompt}
                className="flex-1 justify-start gap-2"
                title="Copy the fix-it prompt to paste alongside the screenshot"
              >
                {fixCopyStatus === 'copied' ? (
                  <><ClipboardCheck className="h-3.5 w-3.5 text-green-400" />Prompt copied</>
                ) : (
                  <><Sparkles className="h-3.5 w-3.5" />Copy fix-it prompt</>
                )}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEditingFix(true)}
                className="h-8 w-8 p-0 shrink-0 text-muted-foreground"
                title="Edit prompt template"
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <Textarea
                value={fixPrompt}
                onChange={(e) => setFixPrompt(e.target.value)}
                className="min-h-[100px] font-mono text-xs resize-y"
              />
              <div className="flex gap-1.5">
                <Button size="sm" variant="outline" className="flex-1 gap-1.5" onClick={() => { setFixPrompt(DEFAULT_FIX_PROMPT); }}>
                  Reset to default
                </Button>
                <Button size="sm" className="flex-1 gap-1.5" onClick={() => setEditingFix(false)}>
                  <Save className="h-3.5 w-3.5" />
                  Done
                </Button>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Prompt back → terminal */}
      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">
          Prompt from Design → Claude Code
        </h3>
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={onPromptKeyDown}
          placeholder="Paste the prompt Claude Design generated, then click Send."
          className="min-h-[120px] font-mono text-xs resize-y"
        />
        <label className="flex items-center gap-2 text-[11px] text-muted-foreground select-none cursor-pointer">
          <input
            type="checkbox"
            checked={autoSubmit}
            onChange={(e) => setAutoSubmit(e.target.checked)}
            className="h-3 w-3"
          />
          Submit (press Enter) after sending
        </label>
        <Button
          size="sm"
          onClick={sendToTerminal}
          disabled={!prompt.trim()}
          className="w-full justify-center gap-2"
        >
          <ArrowRight className="h-4 w-4" />
          Send to Claude Code
        </Button>
        <p className="text-[11px] text-muted-foreground leading-snug">
          Tip: Ctrl/Cmd+Enter sends. Multi-line text is pasted as a single block.
        </p>
      </section>

      {/* Reverse direction: terminal → Design */}
      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">
          Send terminal text to Design
        </h3>
        <Button
          variant="outline"
          size="sm"
          onClick={copyTerminalSelection}
          className="w-full justify-start gap-2"
        >
          {selCopyStatus === 'copied' ? (
            <>
              <ClipboardCheck className="h-4 w-4 text-green-400" />
              Copied to clipboard
            </>
          ) : (
            <>
              <Copy className="h-4 w-4" />
              Copy terminal selection
            </>
          )}
        </Button>
        <p className="text-[11px] text-muted-foreground leading-snug">
          Select text in the terminal first (errors, code), then paste into Claude Design as context.
        </p>
      </section>
    </div>
  );
}
