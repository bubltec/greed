import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { parseBrowseQuery, TOPIC_KINDS, TOPIC_SORTS } from '@greed/domain';
import { DraftFlag, EnergyBar, ErrorBox, KindBadge, Loading } from '../components/bits';
import { Pagination } from '../components/Pagination';
import { api } from '../lib/api';
import { KIND_LABEL } from '../lib/labels';
import { usePreview } from '../lib/preview';
import { usePage } from '../lib/usePage';
import { Markdown } from '../components/Markdown';
import { useAsync } from '../lib/useAsync';
import { useDebounced } from '../lib/useDebounced';
import { useTitle } from '../lib/useTitle';
import { useUrlState } from '../lib/useUrlState';

const SORT_LABEL: Record<(typeof TOPIC_SORTS)[number], string> = {
  title: 'Title',
  updated: 'Recently updated',
  created: 'Date added',
  links: 'Most connected',
  sources: 'Most sources',
  perspectives: 'Most perspectives',
  kind: 'Kind',
};

export function HomePage() {
  useTitle();
  const { preview } = usePreview();
  const intro = usePage('home');
  const [params, set] = useUrlState();
  // What the URL means after defaults (a sort's natural direction, a clamped page size).
  const view = parseBrowseQuery(Object.fromEntries(params));
  const [text, setText] = useState(view.q);
  const typed = useDebounced(text);
  useEffect(() => {
    if (typed.trim() !== view.q) set({ q: typed.trim() || null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typed]);
  useEffect(() => setText(view.q), [view.q]);

  const key = params.toString();
  const { data, error, loading } = useAsync(() => api.browse(params, preview), [key, preview]);

  const top = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) first.current = false;
    else top.current?.scrollIntoView({ block: 'start' });
  }, [view.page]);

  const kinds = TOPIC_KINDS.filter((k) => data?.kinds[k] || k === view.kind);
  const matched = Object.values(data?.kinds ?? {}).reduce((n, c) => n + c, 0);

  return (
    <div>
      <section className="mb-8 max-w-3xl">
        <h1 className="pixel mb-4 text-sm leading-relaxed text-snow sm:text-base">{intro.title}</h1>
        <div className="prose-body [&_p]:mb-3 [&_p]:text-base [&_p]:text-steel">
          <Markdown source={intro.body} lead={false} />
        </div>
      </section>

      <div ref={top} className="mb-4 flex scroll-mt-4 flex-col gap-3 sm:flex-row sm:items-center">
        <input
          type="search"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Search titles, summaries, tags…"
          aria-label="Search topics"
          className="sm:max-w-sm"
        />
        <div className="flex gap-2">
          <select
            value={view.sort}
            onChange={(e) => set({ sort: e.target.value === 'title' ? null : e.target.value, dir: null })}
            aria-label="Sort by"
            className="sm:w-auto"
          >
            {TOPIC_SORTS.map((s) => (
              <option key={s} value={s}>
                {SORT_LABEL[s]}
              </option>
            ))}
          </select>
          <button
            className="btn btn-ghost"
            onClick={() => set({ dir: view.dir === 'asc' ? 'desc' : 'asc' })}
            aria-label={view.dir === 'asc' ? 'Ascending. Switch to descending' : 'Descending. Switch to ascending'}
            title={view.dir === 'asc' ? 'Ascending' : 'Descending'}
          >
            {view.dir === 'asc' ? '▲ Asc' : '▼ Desc'}
          </button>
        </div>
      </div>

      <div className="mb-6 flex flex-wrap gap-2" role="group" aria-label="Filter by kind">
        <button className={`btn ${view.kind ? 'btn-ghost' : ''}`} onClick={() => set({ kind: null })}>
          All{data ? ` (${matched})` : ''}
        </button>
        {kinds.map((k) => (
          <button key={k} className={`btn ${view.kind === k ? '' : 'btn-ghost'}`} onClick={() => set({ kind: view.kind === k ? null : k })}>
            {KIND_LABEL[k]} ({data?.kinds[k] ?? 0})
          </button>
        ))}
      </div>

      {loading && !data && <Loading />}
      {error && <ErrorBox error={error} />}
      {data && (
        <div aria-busy={loading} className={loading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
          <ul className="flex flex-col gap-3">
            {data.items.map((t) => (
              <li key={t.id}>
                <Link
                  to={`/t/${t.id}`}
                  className="panel block p-4 no-underline transition-colors hover:border-sky"
                >
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <KindBadge kind={t.kind} />
                    {t.status === 'draft' && <DraftFlag />}
                  </div>
                  <h2 className="mb-1 text-lg font-semibold leading-snug text-snow">{t.title}</h2>
                  <p className="line-clamp-2 text-sm leading-relaxed text-steel">{t.summary}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
                    <EnergyBar value={t.counts.relations} label="links" />
                    <span className="text-xs text-steel">{t.counts.references} sources</span>
                    {t.counts.perspectives > 0 && (
                      <span className="text-xs text-steel">{t.counts.perspectives} perspectives</span>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          {data.total === 0 && <p className="text-steel">Nothing matches that search.</p>}
          <Pagination
            page={data.page}
            pages={data.pages}
            total={data.total}
            size={data.size}
            noun={data.total === data.all ? 'entries' : `entries (of ${data.all})`}
            onPage={(page) => set({ page: page > 1 ? String(page) : null })}
            onSize={(size) => set({ size: size === 25 ? null : String(size) })}
          />
        </div>
      )}
    </div>
  );
}
