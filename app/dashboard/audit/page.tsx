import AuditClient from './audit-client';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Audit Log' };

export default function AuditPage() {
  return <AuditClient />;
}
