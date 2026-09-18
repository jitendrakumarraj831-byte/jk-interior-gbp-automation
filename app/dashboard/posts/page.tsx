import PostsClient from './posts-client';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Posts' };

export default function PostsPage() {
  return <PostsClient />;
}
