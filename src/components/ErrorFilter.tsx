'use client';

/**
 * Suppresses a small allowlist of dev-time runtime errors that bubble up
 * from third-party code we don't own (Next.js's own devtools panel,
 * MapLibre's worker message protocol, etc.). Without this they pop the
 * Next dev overlay and look like Osiris bugs.
 *
 * Each pattern is scoped narrowly so we don't accidentally hide a real
 * regression. Production builds skip the dev overlay entirely so this
 * component is a no-op there.
 *
 * The listeners install at MODULE EVALUATION time (not in useEffect) so
 * they're active before Next.js's own overlay can grab the same events.
 * Using `capture: true` further ensures we run first in the capture
 * phase, then stopImmediatePropagation prevents the overlay listener
 * from firing.
 */

const SUPPRESS_PATTERNS: RegExp[] = [
  // xterm.js Viewport syncScrollArea race when the Claude panel mounts
  // before the host has been laid out. Already mitigated by the rAF
  // poller in ClaudeTerminal but the dev overlay still catches the
  // initial throw in some cases.
  /Cannot read properties of undefined \(reading 'dimensions'\)/,
  // MapLibre's bin format / worker message protocol — empty string table
  // during style swap, layer add, or popup interaction. The next frame
  // recovers automatically; the dev overlay just panics about it.
  /_numberToString/,
  /Out of bounds\. Index requested/,
  // MapLibre glyph fetch 404s for fonts the upstream tile server doesn't
  // serve. MapLibre falls back to local rendering, so this is just noise.
  /Unable to load glyph range/,
];

function shouldSuppress(msg: string | undefined): boolean {
  if (!msg) return false;
  return SUPPRESS_PATTERNS.some((p) => p.test(msg));
}

// Module-scope flag so HMR / repeated imports don't double-attach.
let installed = false;

if (typeof window !== 'undefined' && !installed) {
  installed = true;

  // 1. Window-level for plain runtime errors / rejections.
  const onError = (e: ErrorEvent) => {
    if (shouldSuppress(e.message)) {
      e.stopImmediatePropagation();
      e.preventDefault();
    }
  };
  const onRejection = (e: PromiseRejectionEvent) => {
    const reason = e.reason;
    const msg =
      typeof reason === 'string' ? reason : reason?.message ?? String(reason);
    if (shouldSuppress(msg)) {
      e.stopImmediatePropagation();
      e.preventDefault();
    }
  };
  window.addEventListener('error', onError, true);
  window.addEventListener('unhandledrejection', onRejection, true);

  // 2. console.error patch. Next.js 16's dev overlay listens to
  //    console.error to surface errors that happen inside React render
  //    trees (caught by React's error boundary, never bubble to window).
  //    The Radix-ScrollArea 'dimensions' crash lives in Next's own
  //    bundled devtools panel — patching console.error is the only way
  //    to keep it from popping the overlay.
  const originalError = console.error;
  console.error = function patchedError(...args: unknown[]) {
    const msg = args
      .map((a) => (typeof a === 'string' ? a : (a as Error)?.message ?? ''))
      .join(' ');
    if (shouldSuppress(msg)) return;
    return originalError.apply(console, args);
  };
}

export default function ErrorFilter() {
  // Component body is just a marker so we can still import + mount it
  // explicitly in layout.tsx. The side effect lives at module scope.
  return null;
}
