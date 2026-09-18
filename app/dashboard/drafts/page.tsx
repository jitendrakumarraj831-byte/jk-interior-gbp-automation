import DraftsClient from './drafts-client';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'AI Reply Drafts' };

export default function DraftsPage() {
  return <DraftsClient />;
}
