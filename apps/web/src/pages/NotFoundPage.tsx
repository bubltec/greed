import { documentTitle, NOT_FOUND_LEAD } from '@greed/domain';
import { buttonClass, Text } from '@bubltec/uiux';
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
      <Text variant="display" className="mb-4 text-hurt">Game over</Text>
      <Text variant="muted" className="mb-6">That page doesn’t exist.</Text>
      <Link to="/" className={buttonClass()}>
        Continue
      </Link>
    </div>
  );
}
