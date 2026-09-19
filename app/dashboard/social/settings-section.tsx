'use client';

/**
 * Social Automation settings. Auto Publish is the only pair of toggles with
 * a live safety effect (lib/social/tasks.ts) — everything else here is
 * genuinely wired except defaultApprovalMode, which is stored but not yet
 * consulted anywhere; that is said plainly in the UI rather than implied.
 */

import { useCallback, useEffect, useState } from 'react';

import { api, ApiError } from '@/lib/client';
import { AlertIcon, CheckCircleIcon, SettingsIcon } from '@/components/icons';
import { Callout, Card, SectionHeader } from '@/components/ui';
import { CONTENT_TYPE_OPTIONS } from '@/lib/social/content-types';
import type { SocialSettings } from '@/lib/social/settings';

const DAYS = [
  { day: 1, label: 'Monday' },
  { day: 2, label: 'Tuesday' },
  { day: 3, label: 'Wednesday' },
  { day: 4, label: 'Thursday' },
  { day: 5, label: 'Friday' },
  { day: 6, label: 'Saturday' },
  { day: 0, label: 'Sunday' },
];

const inputClass =
  'w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-ink-900 outline-none transition-colors placeholder:text-ink-300 focus:border-brand-500';
const labelClass = 'mb-1.5 block text-[0.8125rem] font-medium text-ink-800';

function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-3 py-2">
      <span>
        <span className="block text-sm font-medium text-ink-900">{label}</span>
        {hint ? <span className="block text-xs text-ink-500">{hint}</span> : null}
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-5 w-9 shrink-0 cursor-pointer appearance-none rounded-full bg-line transition-colors checked:bg-brand-500 relative before:absolute before:left-0.5 before:top-0.5 before:h-4 before:w-4 before:rounded-full before:bg-white before:transition-transform checked:before:translate-x-4"
      />
    </label>
  );
}

export default function SocialSettingsSection() {
  const [settings, setSettings] = useState<SocialSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await api.get<{ settings: SocialSettings }>('/api/social/settings');
      setSettings(response.data?.settings ?? null);
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not load settings.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(patch: Partial<SocialSettings>) {
    setError(null);
    try {
      const response = await api.patch<{ settings: SocialSettings }>('/api/social/settings', patch);
      setSettings(response.data?.settings ?? null);
      setFlash(response.message);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not save.');
    }
  }

  if (loading || !settings) return null;

  return (
    <Card>
      <SectionHeader
        title="Social Automation settings"
        description="Auto Publish is OFF by default — scheduled posts wait for a manual publish until switched on."
        icon={<SettingsIcon size={18} />}
      />

      {error ? (
        <Callout tone="danger" title="Something went wrong" icon={<AlertIcon size={18} />}>
          <p>{error}</p>
        </Callout>
      ) : null}
      {flash ? (
        <div className="mb-3">
          <Callout tone="success" title="Saved" icon={<CheckCircleIcon size={18} />}>
            <p>{flash}</p>
          </Callout>
        </div>
      ) : null}

      <div className="divide-y divide-line">
        <Toggle
          checked={settings.facebookEnabled}
          onChange={(v) => void save({ facebookEnabled: v })}
          label="Facebook enabled"
        />
        <Toggle
          checked={settings.instagramEnabled}
          onChange={(v) => void save({ instagramEnabled: v })}
          label="Instagram enabled"
        />
        <Toggle
          checked={settings.facebookAutoPublish}
          onChange={(v) => void save({ facebookAutoPublish: v })}
          label="Facebook Auto Publish"
          hint="When on, the cron publisher posts due scheduled Facebook content automatically."
        />
        <Toggle
          checked={settings.instagramAutoPublish}
          onChange={(v) => void save({ instagramAutoPublish: v })}
          label="Instagram Auto Publish"
          hint="When on, the cron publisher posts due scheduled Instagram content automatically."
        />
        <Toggle
          checked={settings.duplicateProtectionEnabled}
          onChange={(v) => void save({ duplicateProtectionEnabled: v })}
          label="Duplicate content protection"
          hint="Blocks scheduling content identical to a recent post. The final publish-time check always runs regardless of this setting."
        />
      </div>

      {(settings.facebookAutoPublish || settings.instagramAutoPublish) && (
        <div className="mt-3">
          <Callout tone="warning" title="Auto Publish is ON">
            <p>Approved, scheduled posts for the enabled platform(s) will go live without a manual click.</p>
          </Callout>
        </div>
      )}

      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="ss-time" className={labelClass}>
            Default posting time
          </label>
          <input
            id="ss-time"
            type="time"
            value={settings.defaultPostingTime}
            onChange={(e) => void save({ defaultPostingTime: e.target.value })}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="ss-timezone" className={labelClass}>
            Timezone
          </label>
          <input id="ss-timezone" value={settings.timezone} disabled className={`${inputClass} opacity-60`} />
        </div>
        <div>
          <label htmlFor="ss-retries" className={labelClass}>
            Max retries
          </label>
          <input
            id="ss-retries"
            type="number"
            min={1}
            max={20}
            value={settings.maxRetries}
            onChange={(e) => void save({ maxRetries: Number(e.target.value) })}
            className={inputClass}
          />
        </div>
      </div>

      <div className="mt-5">
        <label className={labelClass}>
          Default approval mode <span className="font-normal text-ink-400">(stored — not yet enforced; every AI draft always requires manual approval)</span>
        </label>
        <select
          value={settings.defaultApprovalMode}
          onChange={(e) => void save({ defaultApprovalMode: e.target.value as 'manual' | 'auto' })}
          className={`${inputClass} sm:w-64`}
        >
          <option value="manual">Manual</option>
          <option value="auto">Auto</option>
        </select>
      </div>

      <div className="mt-5">
        <span className={labelClass}>Weekly content plan</span>
        <div className="grid gap-2 sm:grid-cols-2">
          {DAYS.map(({ day, label }) => (
            <div key={day} className="flex items-center gap-2">
              <span className="w-24 shrink-0 text-xs text-ink-500">{label}</span>
              <select
                value={settings.weeklyPlan[day]}
                onChange={(e) => void save({ weeklyPlan: { [day]: e.target.value as SocialSettings['weeklyPlan'][number] } })}
                className={inputClass}
              >
                {CONTENT_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-ink-400">Drives the daily AI draft — never auto-approved or auto-scheduled.</p>
      </div>
    </Card>
  );
}
