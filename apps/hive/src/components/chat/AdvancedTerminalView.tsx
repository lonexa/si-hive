import { useEffect, useRef } from 'react';
import type { Terminal } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';
import { WS_BASE } from '@/lib/api-config';
import '@xterm/xterm/css/xterm.css';
import { createTerminal, loadEnhancements } from '@/components/sessions/terminal-setup';
import { useTerminalSettings } from '@/stores/terminal-settings-store';

interface Props {
  terminalId: string;
}

export default function AdvancedTerminalView({ terminalId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const settingsSnapshot = useRef(useTerminalSettings.getState());

  useEffect(() => {
    if (!containerRef.current || !terminalId) return;

    const { term, fit } = createTerminal();
    term.open(containerRef.current);
    fit.fit();
    const { webglDisposer } = loadEnhancements(term, settingsSnapshot.current);

    termRef.current = term;
    fitRef.current = fit;

    // Connect to the terminal WebSocket (same as regular TerminalView)
    const ws = new WebSocket(`${WS_BASE}/ws/terminal/${terminalId}`);
    wsRef.current = ws;

    ws.onopen = () => {
      // Just reattach — the PTY already exists from chat
      ws.send(JSON.stringify({
        type: 'spawn',
        cols: term.cols,
        rows: term.rows,
      }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as { type: string; data?: string; code?: number };
        switch (msg.type) {
          case 'output':
            if (msg.data) term.write(msg.data);
            break;
          case 'ready':
            break;
          case 'exit':
            term.write(`\r\n[Process exited with code ${msg.code}]\r\n`);
            break;
        }
      } catch { /* ignore */ }
    };

    // Forward terminal input to PTY
    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }));
      }
    });

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      fit.fit();
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      }
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      ws.close();
      if (webglDisposer) webglDisposer();
      term.dispose();
    };
  }, [terminalId]);

  return (
    <div
      ref={containerRef}
      className="flex-1 bg-[#0a0a0a] p-2"
      style={{ minHeight: 0 }}
    />
  );
}
