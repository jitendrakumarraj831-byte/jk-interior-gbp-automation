import SettingsClient from './settings-client';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Settings' };

export default function SettingsPage() {
  return <SettingsClient />;
}
