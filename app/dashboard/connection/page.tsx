import ConnectionClient from './connection-client';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Google Connection' };

export default async function ConnectionPage({
  searchParams,
}: {
  searchParams: Promise<{ connect?: string; reason?: string; account?: string }>;
}) {
  const params = await searchParams;
  return (
    <ConnectionClient
      connectResult={params.connect ?? null}
      connectReason={params.reason ?? null}
      connectedAccount={params.account ?? null}
    />
  );
}
