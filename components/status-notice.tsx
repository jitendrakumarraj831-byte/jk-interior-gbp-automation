'use client';

/**
 * Explains why a Google-backed section has no data.
 *
 * "Approval pending" is deliberately styled differently from a real failure:
 * one is an expected waiting state the user cannot act on, the other is a
 * problem they can. Collapsing them into one red box would be misleading.
 */

import { ClockIcon, GoogleIcon } from './icons';
import { Button, ButtonLink, Callout } from './ui';

export function StatusNotice({
  status,
  message,
  onRetry,
  subject = 'data',
}: {
  status: string;
  message: string;
  onRetry?: () => void;
  /** What could not be loaded, e.g. "reviews". Used in the headline. */
  subject?: string;
}) {
  if (status === 'pending_approval') {
    return (
      <Callout tone="warning" title="Google API approval pending" icon={<ClockIcon size={18} />}>
        <p>{message}</p>
        <p className="mt-2 text-ink-500">
          Everything here is wired up and waiting. Once Google approves your project, your real{' '}
          {subject} appear with no further setup.
        </p>
      </Callout>
    );
  }

  if (status === 'not_connected') {
    return (
      <Callout
        tone="brand"
        title={`Connect Google to see your ${subject}`}
        icon={<GoogleIcon size={18} />}
        action={
          <ButtonLink href="/dashboard/connection" size="sm">
            Connect Google
          </ButtonLink>
        }
      >
        <p>{message}</p>
      </Callout>
    );
  }

  return (
    <Callout
      tone="danger"
      title={`We could not load your ${subject}`}
      action={
        onRetry ? (
          <Button size="sm" variant="secondary" onClick={onRetry}>
            Try again
          </Button>
        ) : undefined
      }
    >
      <p>{message}</p>
    </Callout>
  );
}
