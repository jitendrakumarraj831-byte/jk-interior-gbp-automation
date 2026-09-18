'use client';

/**
 * Onboarding checklist.
 *
 * Reads the non-sensitive config summary from /api/settings — booleans only,
 * never a credential value — and turns it into four actionable steps.
 */

import { AutomationIcon, CheckIcon, GoogleIcon, InboxIcon, SparkIcon } from './icons';
import { ButtonLink, Card, ChecklistItem, Progress, SectionHeader, type Tone } from './ui';

export type SetupConfig = {
  oauthConfigured: boolean;
  googleConfigured: boolean;
  aiConfigured: boolean;
  cronConfigured: boolean;
  durableStore: boolean;
  aiProviderOrder?: string[];
  aiProvidersConfigured?: Record<string, boolean>;
  /** Business Profile API access state, tracked separately from OAuth. */
  gbpAccess?: string;
};

type Step = {
  key: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  done: boolean;
  status: string;
  tone: Tone;
  href?: string;
  cta?: string;
};

const PROVIDER_LABELS: Record<string, string> = {
  groq: 'Groq',
  gemini: 'Gemini',
  openai: 'OpenAI',
};

/** e.g. "Groq, with Gemini as fallback" — names only, never a key. */
function describeProviders(config: SetupConfig): string {
  const active = (config.aiProviderOrder ?? []).filter(
    (name) => config.aiProvidersConfigured?.[name],
  );
  if (active.length === 0) return 'AI provider';
  const [primary, ...rest] = active.map((name) => PROVIDER_LABELS[name] ?? name);
  if (rest.length === 0) return `${primary} is`;
  return `${primary} is, with ${rest.join(' and ')} as fallback,`;
}

/** Status chip for the Google step. Pending is never "not configured". */
function googleStatus(config: SetupConfig): string {
  if (!config.oauthConfigured) return 'Not configured';
  if (!config.googleConfigured) return 'Not connected';
  switch (config.gbpAccess) {
    case 'available':
      return 'Connected';
    case 'auth_error':
      return 'Reconnect needed';
    case 'permission_error':
      return 'Permission error';
    case 'rate_limited':
      return 'Rate limited';
    default:
      return 'Pending';
  }
}

function googleDescription(config: SetupConfig): string {
  if (!config.oauthConfigured) {
    return 'Add your Google OAuth credentials, then connect your Business Profile.';
  }
  if (!config.googleConfigured) {
    return 'OAuth credentials are set. Connect the Google account that manages your profile.';
  }
  switch (config.gbpAccess) {
    case 'available':
      return 'Your Google account is linked and syncing reviews, posts and performance.';
    case 'auth_error':
      return 'Google rejected the stored credentials. Reconnect the account to resume syncing.';
    case 'permission_error':
      return 'The connected account does not manage this Business Profile.';
    default:
      return 'Google account is connected. Waiting for Business Profile API access approval.';
  }
}

export function buildSteps(config: SetupConfig): Step[] {
  return [
    {
      key: 'google',
      icon: <GoogleIcon size={18} />,
      title: 'Google Business Profile',
      description: googleDescription(config),
      /*
       * A linked account whose API access is still under review counts as done:
       * there is no action left for the operator, and showing it as an
       * outstanding task would misread a Google-side wait as a setup failure.
       */
      done: config.googleConfigured && config.gbpAccess !== 'auth_error',
      status: googleStatus(config),
      tone: config.oauthConfigured ? 'warning' : 'neutral',
      href: '/dashboard/connection',
      cta: config.oauthConfigured ? 'Connect Google' : 'View setup',
    },
    {
      key: 'ai',
      icon: <SparkIcon size={18} />,
      title: 'AI reply drafts',
      description: config.aiConfigured
        ? `${describeProviders(config)} drafting replies for reviews that need an answer.`
        : 'Add a Groq API key (or Gemini / OpenAI) to have replies drafted for you. You still approve every one.',
      done: config.aiConfigured,
      status: config.aiConfigured ? 'Active' : 'Not configured',
      tone: 'ai',
      href: '/dashboard/settings',
      cta: 'Open settings',
    },
    {
      key: 'cron',
      icon: <AutomationIcon size={18} />,
      title: 'Scheduled automation',
      description: config.cronConfigured
        ? 'Daily jobs sync reviews, prepare drafts and publish scheduled posts.'
        : 'Set CRON_SECRET so the scheduled jobs can run. They are rejected until you do.'
        ,
      done: config.cronConfigured,
      status: config.cronConfigured ? 'Running' : 'Not configured',
      tone: 'warning',
      href: '/dashboard/automation',
      cta: 'View automation',
    },
    {
      key: 'storage',
      icon: <InboxIcon size={18} />,
      title: 'Persistent storage',
      description: config.durableStore
        ? 'Drafts, posts and the run history are stored durably.'
        : 'Without a durable store, drafts and scheduled posts are lost when the server restarts.'
        ,
      done: config.durableStore,
      status: config.durableStore ? 'Connected' : 'Not configured',
      tone: 'warning',
      href: '/dashboard/settings',
      cta: 'How to fix',
    },
  ];
}

export function SetupChecklist({ config }: { config: SetupConfig }) {
  const steps = buildSteps(config);
  const done = steps.filter((step) => step.done).length;
  const complete = done === steps.length;

  return (
    <Card>
      <SectionHeader
        title={complete ? 'Setup complete' : 'Finish setting up'}
        description={
          complete
            ? 'Everything is configured. Your profile is running on autopilot.'
            : 'A few steps left before automation runs end to end.'
        }
        icon={complete ? <CheckIcon size={18} /> : <AutomationIcon size={18} />}
        tone={complete ? 'success' : 'brand'}
        action={
          <span className="tnum whitespace-nowrap rounded-full bg-subtle px-2.5 py-1 text-xs font-semibold text-ink-700 ring-1 ring-inset ring-line">
            {done} / {steps.length} completed
          </span>
        }
      />

      <Progress value={done} total={steps.length} tone={complete ? 'success' : 'brand'} />

      <ul className="mt-1 divide-y divide-line">
        {steps.map((step) => (
          <ChecklistItem
            key={step.key}
            icon={step.icon}
            title={step.title}
            description={step.description}
            done={step.done}
            status={step.status}
            tone={step.tone}
            action={
              step.done || !step.href ? null : (
                <ButtonLink href={step.href} variant="secondary" size="sm">
                  {step.cta}
                </ButtonLink>
              )
            }
          />
        ))}
      </ul>
    </Card>
  );
}
