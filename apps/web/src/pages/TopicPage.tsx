import { Fragment, useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { DraftFlag, ErrorBox, KindBadge, Loading, RichText, SectionTitle } from '../components/bits';
import { api } from '../lib/api';
import { formatDate, RELATION_LABEL, STANCE_COLOR, STANCE_LABEL } from '../lib/labels';
import { usePreview } from '../lib/preview';
import { useSession } from '../lib/session';
import type { RelatedTopic, TopicView } from '../lib/types';
import { useAsync } from '../lib/useAsync';
import { useTitle } from '../lib/useTitle';

export function TopicPage() {
  const { id = '' } = useParams();
  const { preview } = usePreview();
  const { data, error, loading } = useAsync(() => api.topic(id, preview), [id, preview]);
  const list = useAsync(() => api.topics(preview), [preview]);
  const titles = useMemo(() => new Map((list.data ?? []).map((t) => [t.id, t.title])), [list.data]);
  useTitle(data?.topic.title);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  return <TopicBody view={data} titles={titles} />;
}

function TopicBody({ view, titles }: { view: TopicView; titles: Map<string, string> }) {
  const { topic, references, perspectives, related } = view;
  const { session } = useSession();
  // Footnotes are numbered by first citation on the page (sections, then
  // perspectives), so they read [1], [2], [3] top to bottom; uncited sources follow.
  const ordered = useMemo(() => {
    const seen = new Set<string>();
    const cited = [
      ...topic.sections.flatMap((s) => s.points.flatMap((p) => p.refIds)),
      ...perspectives.flatMap((p) => p.refIds),
    ].filter((id) => !seen.has(id) && seen.add(id));
    const byId = new Map(references.map((r) => [r.id, r]));
    return [
      ...cited.map((id) => byId.get(id)).filter((r) => r !== undefined),
      ...references.filter((r) => !seen.has(r.id)),
    ];
  }, [topic.sections, perspectives, references]);
  const refNumber = new Map(ordered.map((r, i) => [r.id, i + 1]));
  const cite = (ids: string[]) =>
    ids.length > 0 && (
      <span className="ml-1 whitespace-nowrap">
        {ids.map((rid) => (
          <a key={rid} href={`#ref-${rid}`} className="pixel ml-0.5 text-[0.5rem] text-bolt no-underline">
            [{refNumber.get(rid)}]
          </a>
        ))}
      </span>
    );

  return (
    <article className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_17rem]">
      <div className="min-w-0">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <KindBadge kind={topic.kind} />
          {topic.status === 'draft' && <DraftFlag />}
          {topic.tags.map((tag) => (
            <Link key={tag} to={`/?q=${encodeURIComponent(tag)}`} className="text-xs text-ice">
              #{tag}
            </Link>
          ))}
        </div>
        <h1 className="mb-4 text-2xl font-bold leading-tight text-snow sm:text-3xl">{topic.title}</h1>
        <p className="mb-2 text-xs text-slate">
          Updated {formatDate(topic.updatedAt)}
          {session?.editor && (
            <>
              {' · '}
              <Link to={`/admin/t/${topic.id}`} className="text-bolt">
                Edit this entry
              </Link>
            </>
          )}
        </p>
        <p className="prose-body mb-8 text-lg text-snow">
          <RichText text={topic.summary} titles={titles} />
        </p>

        {topic.sections.map((section) => (
          <section key={section.id} className="mb-8">
            <SectionTitle>{section.label}</SectionTitle>
            <ul className="flex flex-col gap-3">
              {section.points.map((point, i) => (
                <li key={i} className="prose-body border-l-2 border-deep pl-4 text-snow">
                  <RichText text={point.text} titles={titles} />
                  {cite(point.refIds)}
                </li>
              ))}
            </ul>
          </section>
        ))}

        {perspectives.length > 0 && (
          <section className="mb-8">
            <SectionTitle>Perspectives</SectionTitle>
            <div className="flex flex-col gap-3">
              {perspectives.map((p) => (
                <div key={p.id} className="border-2 p-4" style={{ borderColor: STANCE_COLOR[p.stance] }}>
                  <p className="mb-2 flex flex-wrap items-baseline gap-2">
                    <span className="pixel text-[0.5rem]" style={{ color: STANCE_COLOR[p.stance] }}>
                      {STANCE_LABEL[p.stance]}
                    </span>
                    <span className="font-semibold text-snow">{p.holder}</span>
                    {p.status === 'draft' && <DraftFlag small />}
                  </p>
                  <p className="prose-body text-sm text-snow">
                    <RichText text={p.body} titles={titles} />
                    {cite(p.refIds)}
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}

        {topic.notes && (
          <section className="mb-8">
            <SectionTitle>Research notes</SectionTitle>
            <p className="prose-body whitespace-pre-line text-sm text-steel">
              <RichText text={topic.notes} titles={titles} />
            </p>
          </section>
        )}

        {topic.disputed && (
          <p className="mb-8 border-t border-deep pt-3 text-sm text-slate">
            <span className="pixel mr-2 text-[0.4375rem] text-steel">Note</span>
            <RichText text={topic.disputed} titles={titles} />
          </p>
        )}

        <section className="mb-8">
          <SectionTitle>Sources</SectionTitle>
          {references.length === 0 ? (
            <p className="text-sm text-steel">No sources attached yet.</p>
          ) : (
            <ol className="flex flex-col gap-2">
              {ordered.map((r, i) => (
                <li key={r.id} id={`ref-${r.id}`} className="flex gap-3 text-sm target:bg-night">
                  <span className="pixel w-8 shrink-0 pt-0.5 text-[0.5rem] text-bolt">[{i + 1}]</span>
                  <span className="min-w-0">
                    {r.url ? (
                      <a href={r.url} target="_blank" rel="noopener noreferrer" className="break-words">
                        {r.label}
                      </a>
                    ) : (
                      <span className="text-snow">{r.label}</span>
                    )}
                    {r.publishedOn && <span className="text-slate"> · {r.publishedOn}</span>}
                    {r.status === 'draft' && (
                      <>
                        {' '}
                        <DraftFlag small />
                      </>
                    )}
                    {!r.url && <span className="text-slate"> · link needed</span>}
                    {r.excerpt && <span className="mt-1 block italic text-steel">“{r.excerpt}”</span>}
                    {r.note && <span className="mt-1 block text-steel">{r.note}</span>}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      <aside className="lg:sticky lg:top-6 lg:self-start">
        <SectionTitle>Connections</SectionTitle>
        {related.length === 0 ? (
          <p className="text-sm text-steel">Not linked to anything yet.</p>
        ) : (
          <RelatedList related={related} />
        )}
      </aside>
    </article>
  );
}

function RelatedList({ related }: { related: RelatedTopic[] }) {
  const byKind = new Map<string, RelatedTopic[]>();
  for (const r of related) {
    const list = byKind.get(r.relation.kind) ?? [];
    list.push(r);
    byKind.set(r.relation.kind, list);
  }
  return (
    <div className="flex flex-col gap-5">
      {[...byKind.entries()].map(([kind, items]) => (
        <Fragment key={kind}>
          <div>
            <p className="label mb-2">{RELATION_LABEL[kind as keyof typeof RELATION_LABEL]}</p>
            <ul className="flex flex-col gap-3">
              {items.map(({ relation, other, direction }) => (
                <li key={relation.id} className="border-l-2 border-mega pl-3">
                  <Link to={`/t/${other.id}`} className="text-sm font-semibold leading-snug">
                    {relation.kind === 'cause-effect' && (direction === 'outgoing' ? '→ ' : '← ')}
                    {other.title}
                  </Link>
                  {relation.note && <p className="mt-1 text-xs leading-relaxed text-steel">{relation.note}</p>}
                  <p className="pixel mt-1 text-[0.4375rem] text-slate">
                    {relation.provenance}
                    {relation.status === 'draft' && <span className="ml-2 text-bolt">draft</span>}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </Fragment>
      ))}
    </div>
  );
}
