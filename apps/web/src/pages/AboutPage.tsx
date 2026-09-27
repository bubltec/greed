import { Markdown } from '../components/Markdown';
import { usePage } from '../lib/usePage';
import { useTitle } from '../lib/useTitle';

/** Content comes from the editable "about" page (Editors → Pages). */
export function AboutPage() {
  const page = usePage('about');
  useTitle(page.title);
  return (
    <div className="prose-body max-w-2xl text-snow">
      <h1 className="pixel mb-6 text-sm">{page.title}</h1>
      <Markdown source={page.body} />
    </div>
  );
}
