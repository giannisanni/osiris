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
  // Next.js 16 devtools panel — Radix ScrollArea inside the panel calls
  // .dimensions on a Viewport ref before it mounts in some interaction
  // paths. Non-fatal; the panel itself is hidden by devIndicators:false.
  /Cannot read properties of undefined \(reading 'dimensions'\)/,
  // MapLibre's bin format / worker message protocol — empty string table
  // during style swap. The next frame recovers automatically.
  /_numberToString\.length\s*0/,
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
}

export default function ErrorFilter() {
  // Component body is just a marker so we can still import + mount it
  // explicitly in layout.tsx. The side effect lives at module scope.
  return null;
}
