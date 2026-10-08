'use client';

/**
 * Onboarding checklist.
 *
 * Reads the non-sensitive config summary from /api/settings — booleans only,
 * never a credential value — and the live Business Profile access status from
 * the same snapshot every other screen uses. A step is only "done" when the
 * thing it names is actually working: a connected account whose API access is
 * still pending, or rejected, is NOT complete — so "Setup complete" can never
 * appear next to a Google status that says otherwise.
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
  /**
   * Business Profile API access status from the shared snapshot:
   * unknown | available | pending | rate_limited | auth_error | permission_error | error.
   */
  gbpAccess?: string;
  /** Business Profile APIs that are not working even though access is proven (e.g. "reviews"). */
  gbpDegraded?: string[];
  /** Mock Business Profile (development/preview only) stands in for Google. */
  mockMode?: boolean;
  /** False when the store is configured but did not answer a round trip. */
  storeReachable?: boolean;
  /** When any scheduled job last ran, and whether the latest run of any job failed. */
  lastCronRunAt?: string | null;
  cronFailed?: boolean;
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

/** True only when Google has actually answered — never on a guess. */
export function isGoogleStepDone(config: SetupConfig): boolean {
  if (config.mockMode) return true;
  // One working API proves the account is linked, not that everything works:
  // a failing Reviews or Posts API means setup is not complete.
  return (
    config.googleConfigured &&
    config.gbpAccess === 'available' &&
    (config.gbpDegraded?.length ?? 0) === 0
  );
}

const SERVICE_NAMES: Record<string, string> = {
  accounts: 'Accounts',
  locations: 'Locations',
  reviews: 'Reviews',
  posts: 'Posts',
  performance: 'Performance',
};

function degradedNames(config: SetupConfig): string {
  return (config.gbpDegraded ?? []).map((name) => SERVICE_NAMES[name] ?? name).join(', ');
}

function googleStatus(config: SetupConfig): { label: string; tone: Tone } {
  if (config.mockMode) return { label: 'Mock mode', tone: 'warning' };
  if (!config.oauthConfigured) return { label: 'Not configured', tone: 'neutral' };
  if (!config.googleConfigured) return { label: 'Not connected', tone: 'warning' };
  switch (config.gbpAccess) {
    case 'available':
      return (config.gbpDegraded?.length ?? 0) > 0
        ? { label: 'Partly working', tone: 'warning' }
        : { label: 'Connected & Active', tone: 'success' };
    case 'auth_error':
      return { label: 'Reconnect needed', tone: 'danger' };
    case 'permission_error':
      return { label: 'Needs attention', tone: 'danger' };
    case 'rate_limited':
      return { label: 'Rate limited', tone: 'warning' };
    case 'error':
      return { label: 'Connection problem', tone: 'danger' };
    case 'pending':
      return { label: 'Awaiting approval', tone: 'warning' };
    default:
      return { label: 'Not checked yet', tone: 'neutral' };
  }
}

function googleDescription(config: SetupConfig): string {
  if (config.mockMode) {
    return 'A simulated Business Profile is standing in for Google. Nothing reaches your real profile.';
  }
  if (!config.oauthConfigured) {
    return 'Add your Google OAuth credentials, then connect your Business Profile.';
  }
  if (!config.googleConfigured) {
    return 'OAuth credentials are set. Connect the Google account that manages your profile.';
  }
  switch (config.gbpAccess) {
    case 'available':
      return (config.gbpDegraded?.length ?? 0) > 0
        ? `Your Google account is linked, but ${degradedNames(config)} ${
            config.gbpDegraded!.length === 1 ? 'is' : 'are'
          } not working yet. Open the connection page to see what to fix.`
        : 'Your Google account is linked and syncing reviews, posts and performance.';
    case 'auth_error':
      return 'Google rejected the saved sign-in. Reconnect the account to resume syncing.';
    case 'permission_error':
      return 'Google is refusing access. Open the connection page to see what needs fixing.';
    case 'rate_limited':
      return 'Google is rate limiting requests right now. This is temporary and clears on its own.';
    case 'error':
      return 'Google returned an unexpected error. Check access again in a few minutes.';
    case 'pending':
      return 'Google account is connected. Waiting for Google to open Business Profile API access.';
    default:
      return 'Google account is connected. Access has not been verified yet — check it now.';
  }
}

export function buildSteps(config: SetupConfig): Step[] {
  const google = googleStatus(config);
  return [
    {
      key: 'google',
      icon: <GoogleIcon size={18} />,
      title: 'Google Business Profile',
      description: googleDescription(config),
      done: isGoogleStepDone(config),
      status: google.label,
      tone: google.tone,
      href: '/dashboard/connection',
      cta: !config.oauthConfigured
        ? 'View setup'
        : !config.googleConfigured
          ? 'Connect Google'
          : config.gbpAccess === 'auth_error'
            ? 'Reconnect'
            : 'Check connection',
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
      description: !config.cronConfigured
        ? 'Set CRON_SECRET so the scheduled jobs can run. They are rejected until you do.'
        : config.cronFailed
          ? 'A scheduled job failed on its last run. Open Automation to see which one and why.'
          : config.lastCronRunAt
            ? 'Daily jobs sync reviews, prepare drafts and publish scheduled posts.'
            : 'Protected and scheduled. The first daily run has not happened yet.',
      // Configured is not the same as working: a failing job is not "done".
      done: config.cronConfigured && !config.cronFailed,
      status: !config.cronConfigured
        ? 'Not configured'
        : config.cronFailed
          ? 'Last run failed'
          : config.lastCronRunAt
            ? 'Running'
            : 'Waiting for first run',
      tone: config.cronFailed ? 'danger' : 'warning',
      href: '/dashboard/automation',
      cta: 'View automation',
    },
    {
      key: 'storage',
      icon: <InboxIcon size={18} />,
      title: 'Persistent storage',
      description: !config.durableStore
        ? 'Without a durable store, drafts and scheduled posts are lost when the server restarts.'
        : config.storeReachable === false
          ? 'The storage service is configured but did not respond. Check the Upstash credentials and status.'
          : 'Drafts, posts and the run history are stored durably.',
      done: config.durableStore && config.storeReachable !== false,
      status: !config.durableStore
        ? 'Not configured'
        : config.storeReachable === false
          ? 'Not responding'
          : 'Connected',
      tone: config.storeReachable === false ? 'danger' : 'warning',
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
            ? 'Everything is configured and working. Your profile is running on autopilot.'
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
