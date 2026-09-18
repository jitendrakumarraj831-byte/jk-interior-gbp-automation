/**
 * The approval workflow that sits between an AI draft and Google.
 *
 * These tests read the shipped source rather than mocking it, because the
 * guarantee being protected is structural: there must be exactly one publish
 * path, it must demand an approved draft, and it must offer no override.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (relative: string) => readFileSync(root + relative, 'utf8');

const publishRoute = read('app/api/reviews/reply/publish/route.ts');
const draftRoute = read('app/api/reviews/reply/route.ts');
const aiReply = read('lib/ai-reply.ts');
const router = read('lib/ai/router.ts');
const groqAdapter = read('lib/ai/providers/groq.ts');
const geminiAdapter = read('lib/ai/providers/gemini.ts');
const tasks = read('lib/tasks.ts');

describe('8. AI produces drafts only', () => {
  it('the AI module contains no publish call', () => {
    expect(aiReply).not.toContain('publishReviewReply');
    expect(aiReply).not.toContain('createLocalPost');
  });

  it('a newly generated draft is stored as draft_pending', () => {
    expect(tasks).toContain("status: 'draft_pending'");
  });

  it('generating a draft does not publish it', () => {
    const generateBlock = draftRoute.slice(draftRoute.indexOf('export async function POST'));
    expect(generateBlock).not.toContain('publishReviewReply');
  });
});

describe('9. publishing requires an approved draft', () => {
  it('the publish route refuses anything not approved', () => {
    expect(publishRoute).toContain("draft.status !== 'approved'");
    expect(publishRoute).toContain('Approve the draft before publishing');
  });

  it('the publish route is admin-gated', () => {
    expect(publishRoute).toContain('assertAdmin(request)');
  });

  it('cron auto-publish stays behind an explicit switch that defaults off', () => {
    expect(tasks).toContain('settings.autoPublishReplies || env().AUTO_PUBLISH_REPLIES');
    expect(tasks).toContain('if (!autoPublish)');
    // Only drafts an admin approved are ever considered.
    expect(tasks).toContain("filter((d) => d.status === 'approved')");
  });
});

describe('10. no force / bypass mechanism', () => {
  it('the publish route accepts no force flag', () => {
    expect(publishRoute).not.toMatch(/force\s*:\s*z\./);
    expect(publishRoute).not.toMatch(/&&\s*!force/);
    expect(publishRoute).not.toMatch(/\bconst\s*\{\s*id,\s*force\s*\}/);
  });

  it('no route anywhere accepts a force/override/skipApproval field', () => {
    for (const file of [publishRoute, draftRoute]) {
      expect(file).not.toMatch(/(force|bypass|skipApproval|overrideApproval)\s*:\s*z\.boolean/);
    }
  });
});

describe('provider wiring', () => {
  it('11. provider endpoints live in the adapters and are correct', () => {
    expect(groqAdapter).toContain('GROQ_BASE_URL');
    expect(geminiAdapter).toContain('GEMINI_BASE_URL');
    // The prompt layer knows nothing about transports or keys.
    expect(aiReply).not.toContain('API_KEY');
    expect(aiReply).not.toContain('baseURL');
  });

  it('11b. the router, not the prompt layer, owns fallback', () => {
    expect(router).toContain('shouldFallBack');
    expect(aiReply).toContain("from './ai/router'");
  });

  it('11c. no provider adapter can publish to Google', () => {
    for (const adapter of [groqAdapter, geminiAdapter, router]) {
      expect(adapter).not.toContain('publishReviewReply');
      expect(adapter).not.toContain('google-business');
    }
  });

  it('12. no NEXT_PUBLIC_ variable is ever declared or read', () => {
    // Matches a real declaration or access, not prose warning against one.
    const declaration = /NEXT_PUBLIC_[A-Z0-9_]*\s*[=:]|process\.env\.NEXT_PUBLIC_/;
    const files = [
      'lib/config.ts',
      'lib/ai-reply.ts',
      'lib/ai/router.ts',
      'lib/ai/providers/groq.ts',
      'lib/ai/providers/gemini.ts',
      'lib/ai/providers/openai.ts',
      '.env.example',
    ];
    for (const file of files) expect(read(file)).not.toMatch(declaration);
  });

  it('13. the AI module is never imported by a client component', () => {
    const clientPages = [
      'app/dashboard/settings/settings-client.tsx',
      'app/dashboard/drafts/drafts-client.tsx',
      'app/dashboard/overview.tsx',
    ];
    for (const page of clientPages) {
      expect(read(page)).not.toContain("@/lib/ai-reply");
    }
  });
});
