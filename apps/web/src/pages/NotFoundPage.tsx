import { documentTitle, NOT_FOUND_LEAD } from '@greed/domain';
import { Link } from 'react-router-dom';
import { usePageMeta } from '../lib/usePageMeta';

export function NotFoundPage() {
  usePageMeta({
    title: documentTitle('Not found'),
    description: NOT_FOUND_LEAD,
    path: typeof window === 'undefined' ? '/' : window.location.pathname,
    robots: 'noindex, nofollow',
    type: 'website',
  });
  return (
    <div className="py-16 text-center">
      <p className="pixel mb-4 text-sm text-hurt">Game over</p>
      <p className="mb-6 text-steel">That page doesn’t exist.</p>
      <Link to="/" className="btn">
        Continue
      </Link>
    </div>
  );
}
