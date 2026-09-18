import ReviewsClient from './reviews-client';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Reviews' };

export default function ReviewsPage() {
  return <ReviewsClient />;
}
