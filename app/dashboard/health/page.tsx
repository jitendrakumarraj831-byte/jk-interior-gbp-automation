import HealthClient from './health-client';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'System Health' };

export default function HealthPage() {
  return <HealthClient />;
}
