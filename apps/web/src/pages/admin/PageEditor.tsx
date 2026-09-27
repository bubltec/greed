import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { isPageId, type PageView } from '@greed/domain';
import { ErrorBox, Loading, SectionTitle } from '../../components/bits';
import { Markdown } from '../../components/Markdown';
import { api } from '../../lib/api';
import { useSession } from '../../lib/session';
import { useTitle } from '../../lib/useTitle';
import { Field } from './fields';

export const PAGE_LABEL = { home: 'Home intro', about: 'About' } as const;

export const PAGE_STATE_LABEL: Record<PageView['state'], string> = {
  default: 'Built-in default',
  unpublished: 'Never published',
  changed: 'Unpublished changes',
  published: 'Live',
};

/** Edit a site page's working copy with a live preview; publish makes it live. */
export function PageEditor() {
  const { id = '' } = useParams();
  const { session } = useSession();
  const [page, setPage] = useState<PageView>();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState<Error>();
  const [busy, setBusy] = useState(false);
  useTitle(isPageId(id) ? `Edit ${PAGE_LABEL[id]}` : 'Page');

  useEffect(() => {
    if (!isPageId(id)) return;
    api.page(id, true).then((p) => {
      setPage(p);
      setTitle(p.title);
      setBody(p.body);
    }, setError);
  }, [id]);

  if (!isPageId(id)) return <p className="text-steel">No such page.</p>;
  if (session && !session.editor) {
    return (
      <p className="text-steel">
        Editors only. <Link to="/admin">Sign in</Link>
      </p>
    );
  }
  if (error && !page) return <ErrorBox error={error} />;
  if (!page) return <Loading />;

  const dirty = title !== page.title || body !== page.body;
  const run = async (fn: () => Promise<PageView>) => {
    setBusy(true);
    setError(undefined);
    try {
      const next = await fn();
      setPage(next);
      setTitle(next.title);
      setBody(next.body);
    } catch (err) {
      setError(err as Error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="pixel text-sm">Edit page: {PAGE_LABEL[id]}</h1>
        <div className="flex gap-2">
          <Link to="/admin" className="btn btn-ghost">
            ← Editors
          </Link>
          <Link to={id === 'home' ? '/' : '/about'} className="btn btn-ghost">
            View live
          </Link>
        </div>
      </div>

      <div className={`panel flex flex-wrap items-center gap-3 p-4 ${page.state === 'published' ? '' : 'border-bolt'}`}>
        <span className="pixel border-2 border-bolt px-1.5 py-0.5 text-[0.5rem] text-bolt">{PAGE_STATE_LABEL[page.state]}</span>
        <span className="text-sm text-steel">
          Saving changes the working copy only. Publish makes it live.
          {dirty && ' You have unsaved edits.'}
        </span>
        <div className="ml-auto flex gap-2">
          <button className="btn btn-ghost" disabled={busy || !dirty} onClick={() => run(() => api.savePage(id, { title, body }))}>
            Save
          </button>
          <button
            className="btn"
            disabled={busy || (page.state === 'published' && !dirty)}
            onClick={() =>
              run(async () => {
                if (dirty) await api.savePage(id, { title, body });
                return api.publishPage(id);
              })
            }
          >
            {dirty ? 'Save & publish' : 'Publish'}
          </button>
        </div>
      </div>
      {error && <ErrorBox error={error} />}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <Field label={id === 'home' ? 'Headline' : 'Title'}>
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field
            label="Body"
            hint="Blank line between paragraphs · ## Heading · - list item · **bold** · [text](https://…) · [[topic-id]]"
          >
            <textarea rows={28} value={body} onChange={(e) => setBody(e.target.value)} className="font-mono text-sm" />
          </Field>
        </div>
        <div>
          <SectionTitle>Preview</SectionTitle>
          <div className="panel prose-body p-4">
            <h2 className={id === 'home' ? 'pixel mb-4 text-sm leading-relaxed' : 'pixel mb-6 text-sm'}>{title}</h2>
            <Markdown source={body} lead={id !== 'home'} />
          </div>
        </div>
      </div>
    </div>
  );
}
