import { documentTitle, metaDescription, pageLead } from '@greed/domain';
import { Text } from '@bubltec/uiux';
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
      <Text variant="display" className="mb-6">{page.title}</Text>
      <Markdown source={page.body} />
    </div>
  );
}
