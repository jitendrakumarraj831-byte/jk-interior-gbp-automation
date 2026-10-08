/**
 * Post-login redirect targets.
 *
 * `?next=` comes from the URL, so it is untrusted. Only a same-origin,
 * absolute-path target is accepted. A prefix check on "/" is NOT enough:
 * browsers treat a backslash as a slash in URLs, so `/\evil.example` is really
 * `//evil.example` — a protocol-relative redirect off-site. The value is
 * therefore parsed against a throwaway origin and accepted only if it stays on
 * it, and anything containing a backslash or control character is refused.
 */

const FALLBACK = '/dashboard';
const PROBE_ORIGIN = 'http://same-origin.invalid';

export function safeNextPath(next: string | null | undefined, fallback = FALLBACK): string {
  if (!next || typeof next !== 'string') return fallback;
  if (!next.startsWith('/') || next.startsWith('//')) return fallback;
  if (/[\\\u0000-\u001f\u007f]/.test(next)) return fallback;

  try {
    const parsed = new URL(next, PROBE_ORIGIN);
    if (parsed.origin !== PROBE_ORIGIN) return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}
