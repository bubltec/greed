import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ErrorBox, Loading, SectionTitle } from '../../components/bits';
import { api } from '../../lib/api';
import { usePreview } from '../../lib/preview';
import { useSession } from '../../lib/session';
import type { ContentSnapshot, DraftEntry } from '../../lib/types';
import { useAsync } from '../../lib/useAsync';
import { useTitle } from '../../lib/useTitle';

export function AdminHome() {
  useTitle('Editors');
  const { session, reload } = useSession();
  if (!session) return <Loading />;
  if (!session.user) return <SignIn onSignedIn={reload} github={session.signIn.github} local={session.signIn.local} />;
  if (!session.editor) {
    return (
      <div className="max-w-xl">
        <h1 className="pixel mb-4 text-sm">Not an editor yet</h1>
        <p className="mb-4 text-steel">
          You’re signed in as <strong className="text-snow">{session.user.displayName}</strong>, but this account
          isn’t on the editors list. Add one of these to <code className="text-bolt">EDITORS</code>:
        </p>
        <ul className="mb-6 list-disc pl-5 text-snow">
          {session.user.email && <li>{session.user.email}</li>}
          <li>
            {session.user.provider}:{session.user.providerAccountId}
          </li>
        </ul>
        <a className="btn btn-ghost" href="/api/auth/logout">
          Sign out
        </a>
      </div>
    );
  }
  return <Worklist />;
}

function SignIn({ onSignedIn, github, local }: { onSignedIn: () => void; github: boolean; local: boolean }) {
  const [error, setError] = useState<Error>();
  return (
    <div className="max-w-md">
      <h1 className="pixel mb-4 text-sm">Editors</h1>
      <p className="mb-6 text-steel">Reading is open to everyone. Adding and editing entries needs an editor account.</p>
      <div className="flex flex-col items-start gap-3">
        {github && (
          <a className="btn" href="/api/auth/github">
            Sign in with GitHub
          </a>
        )}
        {local && (
          <button
            className="btn btn-ghost"
            onClick={() => api.localSignIn().then(onSignedIn, setError)}
          >
            Local editor sign-in
          </button>
        )}
        {!github && !local && <p className="text-steel">No sign-in method is configured for this stage.</p>}
      </div>
      {error && (
        <div className="mt-4">
          <ErrorBox error={error} />
        </div>
      )}
    </div>
  );
}

/** What to work on next: the gaps the old single document made invisible. */
function Worklist() {
  const { session } = useSession();
  const { data, error, loading } = useAsync(() => api.exportAll(), []);
  const lists = useMemo(() => (data ? buildWorklist(data) : undefined), [data]);
  return (
    <div>
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="pixel mb-2 text-sm">Editors</h1>
          <p className="text-sm text-steel">
            Signed in as {session?.user?.email ?? session?.user?.displayName} ·{' '}
            <a href="/api/auth/logout">sign out</a>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <PreviewButton />
          <Link to="/admin/new" className="btn">
            + New entry
          </Link>
        </div>
      </div>
      <DraftsPanel />
      <ConnectClaude />
      {loading && <Loading />}
      {error && <ErrorBox error={error} />}
      {lists && (
        <div className="grid gap-8 md:grid-cols-2">
          <WorkPanel title="Sources missing a link" items={lists.unlinkedSources} unit="source" />
          <WorkPanel title="Entries with no perspectives" items={lists.noPerspectives} />
          <WorkPanel title="Entries with no connections" items={lists.orphans} />
          <WorkPanel title="Entries with no sources" items={lists.unsourced} />
        </div>
      )}
    </div>
  );
}

interface WorkItem {
  id: string;
  title: string;
  count?: number;
}

function WorkPanel({ title, items, unit }: { title: string; items: WorkItem[]; unit?: string }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, 8);
  return (
    <section className="panel p-4">
      <SectionTitle right={<span className="pixel text-[0.5625rem] text-bolt">{items.length}</span>}>
        {title}
      </SectionTitle>
      {items.length === 0 ? (
        <p className="text-sm text-steel">All clear.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {shown.map((item) => (
            <li key={item.id} className="text-sm">
              <Link to={`/admin/t/${item.id}`}>{item.title}</Link>
              {item.count !== undefined && (
                <span className="text-slate">
                  {' '}
                  · {item.count} {unit}
                  {item.count === 1 ? '' : 's'}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {items.length > 8 && (
        <button className="mt-3 text-xs text-ice underline" onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `Show all ${items.length}`}
        </button>
      )}
    </section>
  );
}

function buildWorklist(data: ContentSnapshot) {
  const byTitle = (a: WorkItem, b: WorkItem) => a.title.localeCompare(b.title);
  const linked = new Set(data.relations.flatMap((r) => [r.fromId, r.toId]));
  const withPerspective = new Set(data.perspectives.map((p) => p.topicId));
  const refCount = new Map<string, number>();
  const unlinked = new Map<string, number>();
  for (const r of data.references) {
    refCount.set(r.topicId, (refCount.get(r.topicId) ?? 0) + 1);
    if (!r.url) unlinked.set(r.topicId, (unlinked.get(r.topicId) ?? 0) + 1);
  }
  const topics = data.topics.map((t) => ({ id: t.id, title: t.title }));
  return {
    unlinkedSources: topics
      .filter((t) => unlinked.has(t.id))
      .map((t) => ({ ...t, count: unlinked.get(t.id) }))
      .sort((a, b) => (b.count ?? 0) - (a.count ?? 0)),
    noPerspectives: topics.filter((t) => !withPerspective.has(t.id)).sort(byTitle),
    orphans: topics.filter((t) => !linked.has(t.id)).sort(byTitle),
    unsourced: data.topics
      .filter((t) => !refCount.has(t.id) && t.kind !== 'thesis')
      .map((t) => ({ id: t.id, title: t.title }))
      .sort(byTitle),
  };
}

/** How to add this site to Claude as a connector (see docs/mcp.md). */
function ConnectClaude() {
  const url = `${window.location.origin}/api/mcp`;
  const [copied, setCopied] = useState(false);
  return (
    <section className="panel mb-8 p-4">
      <SectionTitle>Connect Claude</SectionTitle>
      <p className="mb-3 text-sm text-steel">
        Add GREED as a custom connector and Claude can search, add and link entries for you, as you. In Claude:
        Settings → Connectors → Add custom connector, paste this URL, then sign in here when asked.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <code className="border-2 border-deep px-2 py-1.5 text-sm break-all text-bolt">{url}</code>
        <button
          className="btn btn-ghost"
          onClick={() =>
            navigator.clipboard.writeText(url).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            })
          }
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </section>
  );
}

function PreviewButton() {
  const { setPreview } = usePreview();
  const navigate = useNavigate();
  return (
    <button
      className="btn btn-ghost"
      onClick={() => {
        setPreview(true);
        navigate('/');
      }}
    >
      Preview site
    </button>
  );
}

const TYPE_LABEL: Record<DraftEntry['type'], string> = {
  topic: 'Entry',
  reference: 'Source',
  perspective: 'Perspective',
  relation: 'Link',
};

/** The review queue: drafts grouped by entry, with one publish button per entry. */
function DraftsPanel() {
  const { data, error, loading, reload } = useAsync(() => api.drafts(), []);
  const [busy, setBusy] = useState<string>();
  const [publishError, setPublishError] = useState<Error>();
  const groups = useMemo(() => {
    const map = new Map<string, { title: string; items: DraftEntry[] }>();
    for (const d of data ?? []) {
      const g = map.get(d.topicId) ?? { title: d.topicTitle, items: [] };
      g.items.push(d);
      map.set(d.topicId, g);
    }
    return [...map.entries()];
  }, [data]);

  return (
    <section className="panel mb-8 border-bolt p-4">
      <SectionTitle right={<span className="pixel text-[0.5625rem] text-bolt">{data?.length ?? ''}</span>}>
        Drafts to review
      </SectionTitle>
      {loading && <Loading />}
      {error && <ErrorBox error={error} />}
      {publishError && <ErrorBox error={publishError} />}
      {data && data.length === 0 && <p className="text-sm text-steel">Nothing waiting. Everything is published.</p>}
      <ul className="flex flex-col gap-4">
        {groups.map(([topicId, g]) => (
          <li key={topicId} className="border-l-2 border-bolt pl-3">
            <div className="flex flex-wrap items-center gap-2">
              <Link to={`/admin/t/${topicId}`} className="font-semibold">
                {g.title}
              </Link>
              <a className="text-xs text-ice" href={`/t/${topicId}?preview=1`} target="_blank" rel="noreferrer">
                preview
              </a>
              <button
                className="btn ml-auto"
                disabled={busy === topicId}
                onClick={() => {
                  setBusy(topicId);
                  setPublishError(undefined);
                  api
                    .publishTopic(topicId, true)
                    .then(reload, setPublishError)
                    .finally(() => setBusy(undefined));
                }}
              >
                Publish
              </button>
            </div>
            <ul className="mt-1 text-sm text-steel">
              {g.items.map((d) => (
                <li key={`${d.type}:${d.id}`}>
                  <span className="pixel mr-2 text-[0.4375rem] text-bolt">{TYPE_LABEL[d.type]}</span>
                  {d.label}
                  <span className="text-xs text-slate">
                    {' '}
                    · {d.updatedBy ?? 'unknown'}
                  </span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}
