import AutomationClient from './automation-client';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Automation Status' };

export default function AutomationPage() {
  return <AutomationClient />;
}
