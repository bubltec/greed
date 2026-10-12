import { documentTitle, metaDescription, pageLead } from '@greed/domain';
import { Markdown } from '../components/Markdown';
import { usePage } from '../lib/usePage';
import { usePageMeta } from '../lib/usePageMeta';
import { usePreview } from '../lib/preview';

/** Content comes from the editable "about" page (Editors → Pages). */
export function AboutPage() {
  const { preview } = usePreview();
  const page = usePage('about');
  usePageMeta({
    title: documentTitle(page.title),
    description: metaDescription(pageLead(page.body) || page.title),
    path: '/about',
    robots: preview ? 'noindex, nofollow' : 'index, follow',
    type: 'website',
  });
  return (
    <div className="prose-body max-w-2xl text-snow">
      <h1 className="pixel mb-6 text-sm">{page.title}</h1>
      <Markdown source={page.body} />
    </div>
  );
}
