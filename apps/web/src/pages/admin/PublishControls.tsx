import { useState } from 'react';
import { DraftFlag, ErrorBox } from '../../components/bits';
import { api } from '../../lib/api';
import type { ItemType, TopicView } from '../../lib/types';

/** Status line and publish/unpublish buttons for a whole topic. */
export function TopicPublishBar({ view, onChange }: { view: TopicView; onChange: (v: TopicView) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error>();
  const draftChildren =
    view.references.filter((r) => r.status === 'draft').length +
    view.perspectives.filter((p) => p.status === 'draft').length +
    view.related.filter((r) => r.relation.status === 'draft').length;
  const isDraft = view.topic.status === 'draft';

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
      onChange(await api.topic(view.topic.id, true));
    } catch (err) {
      setError(err as Error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`panel flex flex-col gap-3 p-4 ${isDraft ? 'border-bolt' : ''}`}>
      <div className="flex flex-wrap items-center gap-3">
        {isDraft ? (
          <DraftFlag />
        ) : (
          <span className="pixel border-2 border-sky px-1.5 py-0.5 text-[0.5rem] text-sky">Published</span>
        )}
        <span className="text-sm text-steel">
          {isDraft ? 'Only editors can see this entry.' : 'Live on the site.'}
          {draftChildren > 0 && ` ${draftChildren} draft item${draftChildren === 1 ? '' : 's'} waiting.`}
        </span>
        <div className="ml-auto flex flex-wrap gap-2">
          <a className="btn btn-ghost" href={`/t/${view.topic.id}?preview=1`} target="_blank" rel="noreferrer">
            Preview
          </a>
          {(isDraft || draftChildren > 0) && (
            <button className="btn" disabled={busy} onClick={() => run(() => api.publishTopic(view.topic.id, true))}>
              {isDraft ? 'Publish entry' : 'Publish drafts'}
            </button>
          )}
          {!isDraft && (
            <button
              className="btn btn-ghost"
              disabled={busy}
              onClick={() => run(() => api.setStatus('draft', [{ type: 'topic', id: view.topic.id }]))}
            >
              Unpublish
            </button>
          )}
        </div>
      </div>
      {error && <ErrorBox error={error} />}
    </div>
  );
}

/** Inline draft marker with a one-click publish, for a single source, perspective or link. */
export function ItemStatus({
  type,
  id,
  status,
  onChanged,
}: {
  type: ItemType;
  id: string;
  status?: 'draft' | 'published';
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  if (status !== 'draft') return null;
  return (
    <span className="inline-flex items-center gap-1.5">
      <DraftFlag small />
      <button
        className="text-xs text-bolt underline"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          api
            .setStatus('published', [{ type, id }])
            .then(onChanged)
            .finally(() => setBusy(false));
        }}
      >
        publish
      </button>
    </span>
  );
}
