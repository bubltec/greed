import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { TOPIC_KINDS } from '@greed/domain';
import { DisputedFlag, EnergyBar, ErrorBox, KindBadge, Loading } from '../components/bits';
import { api } from '../lib/api';
import { KIND_LABEL } from '../lib/labels';
import type { TopicKind, TopicSummary } from '../lib/types';
import { useAsync } from '../lib/useAsync';
import { useTitle } from '../lib/useTitle';

type Sort = 'title' | 'recent' | 'connected';

function matches(t: TopicSummary, words: string[]) {
  const hay = `${t.title} ${t.summary} ${t.tags.join(' ')}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}

export function HomePage() {
  useTitle();
  const { data, error, loading } = useAsync(() => api.topics(), []);
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState(params.get('q') ?? '');
  const kind = (params.get('kind') as TopicKind | null) ?? null;
  const sort = (params.get('sort') as Sort | null) ?? 'title';

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const topics = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const list = (data ?? []).filter((t) => (!kind || t.kind === kind) && matches(t, words));
    if (sort === 'recent') list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    if (sort === 'connected') list.sort((a, b) => b.counts.relations - a.counts.relations);
    return list;
  }, [data, query, kind, sort]);

  const kindsPresent = TOPIC_KINDS.filter((k) => data?.some((t) => t.kind === k));

  return (
    <div>
      <section className="mb-8 max-w-3xl">
        <h1 className="pixel mb-4 text-sm leading-relaxed text-snow sm:text-base">
          Who holds power, who pays for it, and who is supposed to be watching.
        </h1>
        <p className="prose-body text-steel">
          A cross-linked record of documented cases. Each entry carries its sources, what is still
          disputed, the competing perspectives on it, and the other entries it connects to.
        </p>
      </section>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setParam('q', e.target.value || null);
          }}
          placeholder="Search titles, summaries, tags…"
          aria-label="Search topics"
          className="sm:max-w-sm"
        />
        <select
          value={sort}
          onChange={(e) => setParam('sort', e.target.value === 'title' ? null : e.target.value)}
          aria-label="Sort"
          className="sm:w-auto"
        >
          <option value="title">A–Z</option>
          <option value="recent">Recently updated</option>
          <option value="connected">Most connected</option>
        </select>
      </div>

      <div className="mb-6 flex flex-wrap gap-2" role="group" aria-label="Filter by kind">
        <button className={`btn ${kind ? 'btn-ghost' : ''}`} onClick={() => setParam('kind', null)}>
          All
        </button>
        {kindsPresent.map((k) => (
          <button
            key={k}
            className={`btn ${kind === k ? '' : 'btn-ghost'}`}
            onClick={() => setParam('kind', kind === k ? null : k)}
          >
            {KIND_LABEL[k]}
          </button>
        ))}
      </div>

      {loading && <Loading />}
      {error && <ErrorBox error={error} />}
      {data && (
        <>
          <p className="pixel mb-3 text-[0.5rem] text-slate">
            {topics.length} of {data.length} entries
          </p>
          <ul className="flex flex-col gap-3">
            {topics.map((t) => (
              <li key={t.id}>
                <Link
                  to={`/t/${t.id}`}
                  className="panel block p-4 no-underline transition-colors hover:border-sky"
                >
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <KindBadge kind={t.kind} />
                    {t.disputed && <DisputedFlag />}
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
          {topics.length === 0 && <p className="text-steel">Nothing matches that search.</p>}
        </>
      )}
    </div>
  );
}
