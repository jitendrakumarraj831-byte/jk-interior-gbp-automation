/**
 * Safe logging.
 *
 * Anything that looks like a credential is redacted before it reaches the
 * Vercel log drain, because logs are retained and widely readable.
 */

const SECRET_KEY_PATTERN =
  /(secret|token|password|authorization|api[_-]?key|client[_-]?secret|refresh)/i;

const SECRET_VALUE_PATTERNS: RegExp[] = [
  /ya29\.[\w.-]+/g, // Google access tokens
  /1\/\/[\w-]{20,}/g, // Google refresh tokens
  /sk-[A-Za-z0-9_-]{16,}/g, // OpenAI-style keys
  /gsk_[A-Za-z0-9_-]{16,}/g, // Groq keys
  /Bearer\s+[A-Za-z0-9._~+/-]+=*/gi,
  /GOCSPX-[\w-]+/g, // Google client secrets
];

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[depth-limit]';
  if (value == null) return value;

  if (typeof value === 'string') {
    let out = value;
    for (const pattern of SECRET_VALUE_PATTERNS) out = out.replace(pattern, '[redacted]');
    return out;
  }
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SECRET_KEY_PATTERN.test(key) ? '[redacted]' : redact(val, depth + 1);
  }
  return out;
}

function emit(level: 'info' | 'warn' | 'error', scope: string, message: string, meta?: unknown) {
  const line = `[${scope}] ${message}`;
  const args: unknown[] = meta === undefined ? [line] : [line, redact(meta)];

  // Written out rather than indexed so the console allowlist still applies.
  if (level === 'error') console.error(...args);
  else if (level === 'warn') console.warn(...args);
  else console.info(...args);
}

export const log = {
  info: (scope: string, message: string, meta?: unknown) => emit('info', scope, message, meta),
  warn: (scope: string, message: string, meta?: unknown) => emit('warn', scope, message, meta),
  error: (scope: string, message: string, meta?: unknown) => emit('error', scope, message, meta),
};
