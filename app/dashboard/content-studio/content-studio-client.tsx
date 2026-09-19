'use client';

/**
 * AI Content Studio.
 *
 * Generates draft Facebook/Instagram copy through the existing AI router
 * (Groq → Gemini → OpenAI). This page only previews what the model returns —
 * nothing is saved or published from here. Saving as a draft happens on the
 * Content Calendar, which takes this preview as its starting point.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { api, ApiError } from '@/lib/client';
import {
  AlertIcon,
  CheckCircleIcon,
  FacebookIcon,
  InstagramIcon,
  RefreshIcon,
  SparkIcon,
} from '@/components/icons';
import { Badge, Button, Callout, Card, PageHeader, Segmented } from '@/components/ui';
import { CONTENT_TYPE_OPTIONS } from '@/lib/social/content-types';
import type { SocialContentType, SocialLanguage, SocialPlatformTarget, SocialPost } from '@/lib/social/types';

const inputClass =
  'w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-ink-900 outline-none transition-colors placeholder:text-ink-300 focus:border-brand-500';
const labelClass = 'mb-1.5 block text-[0.8125rem] font-medium text-ink-800';

type PlatformContent = { caption: string; hashtags: string[] };
type Generated = {
  title: string;
  facebookContent: PlatformContent | null;
  instagramContent: PlatformContent | null;
  provider: string;
  model: string;
};

export default function ContentStudioClient() {
  const router = useRouter();
  const [contentType, setContentType] = useState<SocialContentType>('gypsum_false_ceiling');
  const [platforms, setPlatforms] = useState<SocialPlatformTarget>('both');
  const [language, setLanguage] = useState<SocialLanguage>('en');
  const [topic, setTopic] = useState('');
  const [campaign, setCampaign] = useState('');
  const [generated, setGenerated] = useState<Generated | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function generate() {
    setLoading(true);
    setError(null);
    setSaved(false);
    try {
      const response = await api.post<{ generated: Generated }>('/api/social/generate', {
        contentType,
        platforms,
        language,
        topic: topic.trim() || undefined,
        campaign: campaign.trim() || undefined,
      });
      setGenerated(response.data?.generated ?? null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not generate content.');
    } finally {
      setLoading(false);
    }
  }

  async function saveAsDraft() {
    if (!generated) return;
    setSaving(true);
    setError(null);
    try {
      const response = await api.post<{ post: SocialPost }>('/api/social/posts', {
        title: generated.title,
        contentType,
        platforms,
        language,
        content: topic.trim(),
        facebookContent: generated.facebookContent,
        instagramContent: generated.instagramContent,
        campaign: campaign.trim() || undefined,
      });
      setSaved(true);
      if (response.data?.post) {
        router.push('/dashboard/content-calendar');
      }
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not save the draft.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="AI"
        title="Content Studio"
        description="Draft Facebook and Instagram copy for JK Interior's services and campaigns."
      />

      {error ? (
        <div className="mb-4">
          <Callout tone="danger" title="Could not generate" icon={<AlertIcon size={18} />}>
            <p>{error}</p>
          </Callout>
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,22rem)_1fr]">
        <Card>
          <div className="space-y-4">
            <div>
              <label htmlFor="cs-type" className={labelClass}>
                Content type
              </label>
              <select
                id="cs-type"
                value={contentType}
                onChange={(e) => setContentType(e.target.value as SocialContentType)}
                className={inputClass}
              >
                {CONTENT_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <span className={labelClass}>Platforms</span>
              <Segmented<SocialPlatformTarget>
                label="Platforms"
                value={platforms}
                onChange={setPlatforms}
                options={[
                  { value: 'both', label: 'Both' },
                  { value: 'facebook', label: 'Facebook' },
                  { value: 'instagram', label: 'Instagram' },
                ]}
              />
            </div>

            <div>
              <span className={labelClass}>Language</span>
              <Segmented<SocialLanguage>
                label="Language"
                value={language}
                onChange={setLanguage}
                options={[
                  { value: 'en', label: 'English' },
                  { value: 'hi', label: 'Hindi' },
                  { value: 'hinglish', label: 'Hinglish' },
                ]}
              />
            </div>

            <div>
              <label htmlFor="cs-topic" className={labelClass}>
                Specific brief <span className="font-normal text-ink-400">optional</span>
              </label>
              <textarea
                id="cs-topic"
                rows={3}
                maxLength={500}
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="e.g. Completed gypsum false ceiling for a 2BHK living room in Forbesganj"
                className={inputClass}
              />
              <p className="mt-1 text-xs text-ink-400">
                Only facts given here (or already known about the business) are used — nothing is
                invented.
              </p>
            </div>

            <div>
              <label htmlFor="cs-campaign" className={labelClass}>
                Campaign <span className="font-normal text-ink-400">optional</span>
              </label>
              <input
                id="cs-campaign"
                value={campaign}
                onChange={(e) => setCampaign(e.target.value)}
                placeholder="e.g. Diwali 2026"
                className={inputClass}
              />
            </div>

            <Button
              className="w-full"
              loading={loading}
              icon={<SparkIcon size={16} />}
              onClick={() => void generate()}
            >
              Generate
            </Button>
          </div>
        </Card>

        <div className="space-y-5">
          {!generated && !loading ? (
            <Card className="flex flex-col items-center justify-center py-16 text-center text-ink-400">
              <SparkIcon size={28} />
              <p className="mt-3 text-sm">Generated Facebook and Instagram copy will appear here.</p>
            </Card>
          ) : null}

          {loading ? (
            <Card className="flex items-center justify-center gap-2.5 py-16 text-ink-400">
              <RefreshIcon size={18} className="animate-spin" />
              <span className="text-sm">Drafting with the AI router…</span>
            </Card>
          ) : null}

          {generated ? (
            <>
              <Card>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-ink-950">{generated.title}</h3>
                    <Badge tone="ai" className="mt-1.5">
                      {generated.provider} · {generated.model}
                    </Badge>
                  </div>
                  <Button
                    size="sm"
                    loading={saving}
                    icon={saved ? <CheckCircleIcon size={16} /> : undefined}
                    onClick={() => void saveAsDraft()}
                  >
                    {saved ? 'Saved' : 'Save as draft'}
                  </Button>
                </div>
              </Card>

              {generated.facebookContent ? (
                <PlatformPreview
                  icon={<FacebookIcon size={18} />}
                  label="Facebook"
                  content={generated.facebookContent}
                />
              ) : null}
              {generated.instagramContent ? (
                <PlatformPreview
                  icon={<InstagramIcon size={18} />}
                  label="Instagram"
                  content={generated.instagramContent}
                />
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </>
  );
}

function PlatformPreview({
  icon,
  label,
  content,
}: {
  icon: React.ReactNode;
  label: string;
  content: PlatformContent;
}) {
  return (
    <Card>
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-subtle text-ink-600">
          {icon}
        </span>
        <h4 className="text-sm font-semibold text-ink-950">{label}</h4>
      </div>
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-800">{content.caption}</p>
      {content.hashtags.length > 0 ? (
        <p className="mt-3 text-sm text-brand-600">{content.hashtags.map((h) => `#${h.replace(/^#/, '')}`).join(' ')}</p>
      ) : null}
    </Card>
  );
}
