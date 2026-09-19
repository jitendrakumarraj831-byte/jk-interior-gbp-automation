import MediaManagerClient from './media-client';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Media Manager' };

export default function MediaPage() {
  return <MediaManagerClient />;
}
