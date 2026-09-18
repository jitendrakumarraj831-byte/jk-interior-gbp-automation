'use client';

import { useState } from 'react';

import { api, ApiError } from '@/lib/client';
import { Button, Card } from '@/components/ui';

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
      // Full navigation so the new cookie is picked up by middleware.
      window.location.href = next;
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Sign-in failed.');
      setBusy(false);
    }
  }

  return (
    <Card>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-ink-900">
            Admin password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full rounded-xl border border-hairline bg-surface px-3.5 py-2.5 text-ink-900 outline-none focus:border-brand-500"
          />
        </div>

        {error ? (
          <p className="rounded-xl bg-danger-50 px-3 py-2 text-sm text-danger-600">{error}</p>
        ) : null}

        <Button type="submit" disabled={busy || password.length === 0} className="w-full">
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </Card>
  );
}
