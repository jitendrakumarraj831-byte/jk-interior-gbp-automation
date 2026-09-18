'use client';

/**
 * Onboarding checklist.
 *
 * Reads the non-sensitive config summary from /api/settings — booleans only,
 * never a credential value — and turns it into four actionable steps.
 */

import { AutomationIcon, GoogleIcon, InboxIcon, SparkIcon } from './icons';
import { ButtonLink, Card, ChecklistItem, Progress, SectionHeader, type Tone } from './ui';

export type SetupConfig = {
  oauthConfigured: boolean;
  googleConfigured: boolean;
  aiConfigured: boolean;
  cronConfigured: boolean;
  durableStore: boolean;
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

export function buildSteps(config: SetupConfig): Step[] {
  return [
    {
      key: 'google',
      icon: <GoogleIcon size={18} />,
      title: 'Google Business Profile',
      description: config.googleConfigured
        ? 'Your Google account is linked and ready to sync reviews and posts.'
        : config.oauthConfigured
          ? 'OAuth credentials are set. Connect the Google account that manages your profile.'
          : 'Add your Google OAuth credentials, then connect your Business Profile.',
      done: config.googleConfigured,
      status: config.googleConfigured ? 'Connected' : config.oauthConfigured ? 'Pending' : 'Not configured',
      tone: config.oauthConfigured ? 'warning' : 'neutral',
      href: '/dashboard/connection',
      cta: config.oauthConfigured ? 'Connect Google' : 'View setup',
    },
    {
      key: 'ai',
      icon: <SparkIcon size={18} />,
      title: 'AI reply drafts',
      description: config.aiConfigured
        ? 'Reply drafts are generated automatically for reviews that need an answer.'
        : 'Add an OpenAI API key to have replies drafted for you. You still approve every one.',
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
        icon={complete ? <GoogleIcon size={18} /> : <AutomationIcon size={18} />}
        tone={complete ? 'success' : 'brand'}
        action={
          <span className="tnum text-sm font-semibold text-ink-700">
            {done}
            <span className="font-normal text-ink-400">/{steps.length}</span>
          </span>
        }
      />

      <Progress value={done} total={steps.length} tone={complete ? 'success' : 'brand'} />

      <ul className="mt-2 divide-y divide-line">
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
