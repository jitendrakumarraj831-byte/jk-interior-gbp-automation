'use client';

import { useState } from 'react';

import { api, ApiError } from '@/lib/client';
import { LockIcon } from '@/components/icons';
import { Button, Callout } from '@/components/ui';

export default function LoginForm({ next }: { next: string }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/auth/login', { password });
      // Full navigation so the new session cookie is picked up by middleware.
      window.location.href = next;
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Sign-in failed.');
      setBusy(false);
    }
  }

  return (
    <div className="rounded-panel border border-line bg-surface p-5 shadow-raised sm:p-6">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-ink-800">
            Admin password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            autoFocus
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full rounded-xl border border-line bg-surface px-3.5 py-3 text-ink-900 outline-none transition-colors focus:border-brand-500"
          />
        </div>

        {error ? <Callout tone="danger" title="Could not sign you in">{error}</Callout> : null}

        <Button
          type="submit"
          size="lg"
          loading={busy}
          disabled={password.length === 0}
          className="w-full"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>

      <p className="mt-4 flex items-start gap-2 border-t border-line pt-4 text-xs leading-relaxed text-ink-500">
        <LockIcon size={15} className="mt-px shrink-0 text-ink-400" />
        Your session is stored in a secure, HTTP-only cookie and expires after 12 hours.
      </p>
    </div>
  );
}
