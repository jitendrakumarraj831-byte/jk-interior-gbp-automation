import SocialConnectionClient from './connection-client';
import SocialSettingsSection from './settings-section';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Social Automation' };

export default async function SocialPage({
  searchParams,
}: {
  searchParams: Promise<{ connect?: string; reason?: string; page?: string }>;
}) {
  const params = await searchParams;
  return (
    <>
      <SocialConnectionClient
        connectResult={params.connect ?? null}
        connectReason={params.reason ?? null}
        connectedPage={params.page ?? null}
      />
      <div className="mt-5">
        <SocialSettingsSection />
      </div>
    </>
  );
}
