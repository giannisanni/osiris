'use client';

/**
 * Claude Code terminal panel for the Mentat World view.
 *
 * Opens a WebSocket to the Mentat backend's PTY endpoint at
 * substrate:8100/api/terminal/claude — same backend the Mentat Home
 * dashboard already talks to, so this Claude session has the project's
 * MCP, skills, and CLAUDE.md auto-loaded. The operator can ask "what's
 * happening at the Korean DMZ" or "show me satellites over Suriname"
 * and Claude can hit Osiris's own /api/* endpoints via Bash.
 *
 * Renders as a draggable floating panel anchored bottom-right by default.
 * Collapses to a small Brain icon button when not in use. Designed to
 * live alongside the OSINT map without stealing focus.
 */

import { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { Brain, X, Minus, Maximize2 } from 'lucide-react';
import '@xterm/xterm/css/xterm.css';

type Status = 'connecting' | 'open' | 'closed' | 'error';

// Defaults to the same Mentat backend that the Home dashboard uses.
// Override via NEXT_PUBLIC_MENTAT_WS_URL for cross-host deployments.
const WS_URL =
  (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_MENTAT_WS_URL) ||
  'ws://substrate:8100/api/terminal/claude';

function ClaudePanel({
  onClose,
  consumePendingPrompt,
}: {
  onClose: () => void;
  consumePendingPrompt?: () => string | null;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<Status>('connecting');
  const [reconnectTick, setReconnectTick] = useState(0);
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!hostRef.current) return;

    const term = new XTerm({
      cursorBlink: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: 12,
      theme: {
        background: '#0a0a0a',
        foreground: '#E8E6E0',
        cursor: '#D4AF37',
      },
      convertEol: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current);
    fit.fit();
    xtermRef.current = term;
    fitRef.current = fit;

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus('open');
      ws.send(JSON.stringify({ type: 'resize', rows: term.rows, cols: term.cols }));
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'output' && typeof msg.data === 'string') {
          term.write(msg.data);
        } else if (msg.type === 'exit') {
          term.writeln(`\r\n[claude exited${msg.code != null ? ` with code ${msg.code}` : ''}]`);
          setStatus('closed');
        } else if (msg.type === 'error') {
          term.writeln(`\r\n[error: ${msg.message ?? 'unknown'}]`);
          setStatus('error');
        }
      } catch {
        // Non-JSON frame — server only sends JSON, ignore.
      }
    };
    ws.onerror = () => setStatus('error');
    ws.onclose = () => {
      if (status !== 'error') setStatus('closed');
    };

    const onData = term.onData((d) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data: d }));
      }
    });

    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'resize', rows: term.rows, cols: term.cols }));
        }
      } catch {
        // Host element can detach during fast panel-resize; swallow.
      }
    });
    ro.observe(hostRef.current);

    return () => {
      onData.dispose();
      ro.disconnect();
      try {
        ws.close();
      } catch {
        // already closed
      }
      term.dispose();
      xtermRef.current = null;
      fitRef.current = null;
      wsRef.current = null;
    };
  }, [reconnectTick]);

  // Drain a queued "ask Claude about this" prompt once the WS is open
  // AND Claude's TUI has settled. Brute timing: wait 2.5s after the
  // socket opens for the splash + trust prompt to clear, then type the
  // prompt followed by a return. Crude but works for the first-pass UX;
  // a cleaner approach would be to wait for a specific glyph from the
  // PTY output stream.
  useEffect(() => {
    if (status !== 'open' || !consumePendingPrompt) return;
    const prompt = consumePendingPrompt();
    if (!prompt) return;
    const ws = wsRef.current;
    if (!ws) return;
    const timer = setTimeout(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data: prompt + '\r' }));
      }
    }, 2500);
    return () => clearTimeout(timer);
  }, [status, consumePendingPrompt]);

  const dotColor =
    status === 'open' ? '#39FF14'
    : status === 'connecting' ? '#FF9500'
    : status === 'error' ? '#FF3D3D'
    : '#888';

  return (
    <div
      className="fixed z-[400] glass-panel border border-[var(--gold-primary)]/30 shadow-2xl flex flex-col pointer-events-auto"
      style={
        maximized
          ? { top: 60, right: 12, bottom: 60, left: '40%' }
          : { bottom: 12, right: 12, width: 'min(640px, 90vw)', height: 'min(420px, 60vh)' }
      }
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--gold-primary)]/20">
        <div className="flex items-center gap-2">
          <Brain className="w-3.5 h-3.5 text-[var(--gold-primary)]" />
          <span className="text-[11px] font-mono tracking-wider text-[var(--text-primary)]">
            CLAUDE CODE
          </span>
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ backgroundColor: dotColor, boxShadow: `0 0 6px ${dotColor}` }}
          />
          <span className="text-[9px] font-mono text-[var(--text-muted)]">
            {status === 'open' ? '~/mentat' : status.toUpperCase()}
          </span>
          {(status === 'closed' || status === 'error') && (
            <button
              onClick={() => setReconnectTick((n) => n + 1)}
              className="ml-1 px-2 py-0.5 text-[9px] font-mono rounded text-[var(--gold-primary)] hover:bg-[var(--gold-primary)]/10 transition-colors"
            >
              RECONNECT
            </button>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setMaximized((m) => !m)}
            className="p-1 rounded hover:bg-[var(--hover-accent)] text-[var(--text-muted)] hover:text-[var(--gold-primary)] transition-colors"
            title={maximized ? 'Restore size' : 'Maximize'}
          >
            {maximized ? <Minus className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
          </button>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-[var(--alert-red)]/20 text-[var(--text-muted)] hover:text-[var(--alert-red)] transition-colors"
            title="Close"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>
      {/* Terminal host */}
      <div ref={hostRef} className="flex-1 min-h-0 bg-[#0a0a0a] p-1" style={{ minHeight: 0 }} />
    </div>
  );
}

// Module-level queue for the prompt-on-open flow. The "ask Claude about
// this incident" buttons in popup HTML dispatch a window event that
// lands here; the panel reads from it after the WebSocket comes up.
// Using a module ref instead of state so popping the value doesn't race
// with React's render cycle (the popup buttons fire from raw HTML, not
// React events).
let pendingPrompt: string | null = null;
let setOpenFromAnywhere: ((v: boolean) => void) | null = null;

if (typeof window !== 'undefined') {
  window.addEventListener('mentat:ask-claude', ((ev: CustomEvent) => {
    const prompt = ev.detail?.prompt;
    if (typeof prompt === 'string' && prompt.trim()) {
      pendingPrompt = prompt;
      setOpenFromAnywhere?.(true);
    }
  }) as EventListener);
}

export default function ClaudeTerminal() {
  const [open, setOpen] = useState(false);

  // Expose setOpen so the global window listener (above) can pop the
  // panel on demand. Cleared on unmount.
  useEffect(() => {
    setOpenFromAnywhere = setOpen;
    return () => { setOpenFromAnywhere = null; };
  }, []);

  if (open) {
    return (
      <ClaudePanel
        onClose={() => setOpen(false)}
        consumePendingPrompt={() => {
          const p = pendingPrompt;
          pendingPrompt = null;
          return p;
        }}
      />
    );
  }

  // Launcher: floating button bottom-right. Same Mentat-gold treatment
  // as the rest of the OSIRIS UI.
  return (
    <button
      onClick={() => setOpen(true)}
      className="fixed bottom-12 right-3 z-[400] glass-panel p-3 pointer-events-auto group hover:border-[var(--gold-primary)]/60 transition-colors flex items-center gap-2"
      title="Open Claude Code"
    >
      <Brain className="w-4 h-4 text-[var(--gold-primary)] group-hover:scale-110 transition-transform" />
      <span className="text-[10px] font-mono tracking-wider text-[var(--gold-primary)] hidden md:inline">
        CLAUDE
      </span>
    </button>
  );
}
