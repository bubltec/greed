import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { RELATION_KINDS } from '@greed/domain';
import { ErrorBox, SectionTitle } from '../../components/bits';
import { api } from '../../lib/api';
import { RELATION_LABEL } from '../../lib/labels';
import type { RelationKind, TopicView } from '../../lib/types';
import { useAsync } from '../../lib/useAsync';
import { Field } from './fields';
import { ItemStatus } from './PublishControls';

export function RelationsPanel({ view, onChange }: { view: TopicView; onChange: () => Promise<void> }) {
  const topics = useAsync(() => api.topics(true), []);
  const [target, setTarget] = useState('');
  const [kind, setKind] = useState<RelationKind>('related');
  const [note, setNote] = useState('');
  const [reverse, setReverse] = useState(false);
  const [error, setError] = useState<Error>();
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState<string | null>(null);

  const options = useMemo(
    () => (topics.data ?? []).filter((t) => t.id !== view.topic.id),
    [topics.data, view.topic.id],
  );
  // The datalist shows titles; resolve the typed title back to an id.
  const targetId = options.find((t) => t.title === target || t.id === target)?.id;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
      await onChange();
    } catch (err) {
      setError(err as Error);
    } finally {
      setBusy(false);
      setArmed(null);
    }
  };

  return (
    <section>
      <SectionTitle>Connections ({view.related.length})</SectionTitle>
      <ul className="mb-4 flex flex-col gap-2">
        {view.related.map(({ relation, other, direction }) => (
          <li key={relation.id} className="flex items-start gap-3 border-b border-deep pb-2 text-sm">
            <span className="pixel w-28 shrink-0 pt-0.5 text-[0.4375rem] text-sky">{RELATION_LABEL[relation.kind]}</span>
            <span className="min-w-0 flex-1">
              {relation.kind === 'cause-effect' && (direction === 'outgoing' ? '→ ' : '← ')}
              <Link to={`/admin/t/${other.id}`}>{other.title}</Link>
              {' '}
              <ItemStatus type="relation" id={relation.id} status={relation.status} onChanged={() => void onChange()} />
              {relation.note && <span className="block text-xs text-steel">{relation.note}</span>}
            </span>
            <button
              className="text-xs text-hurt underline"
              disabled={busy}
              onBlur={() => setArmed(null)}
              onClick={() => (armed === relation.id ? void run(() => api.deleteRelation(relation.id)) : setArmed(relation.id))}
            >
              {armed === relation.id ? 'confirm' : 'unlink'}
            </button>
          </li>
        ))}
      </ul>

      <form
        className="panel flex flex-col gap-3 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!targetId) {
            setError(new Error('Pick an existing entry from the list.'));
            return;
          }
          const [fromId, toId] = reverse ? [targetId, view.topic.id] : [view.topic.id, targetId];
          void run(async () => {
            await api.addRelation({ fromId, toId, kind, note });
            setTarget('');
            setNote('');
          });
        }}
      >
        <p className="label">Link to another entry</p>
        <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
          <Field label="Entry">
            <input list="topic-options" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="Start typing a title…" required />
            <datalist id="topic-options">
              {options.map((t) => (
                <option key={t.id} value={t.title} />
              ))}
            </datalist>
          </Field>
          <Field label="Link type">
            <select value={kind} onChange={(e) => setKind(e.target.value as RelationKind)}>
              {RELATION_KINDS.map((k) => (
                <option key={k} value={k}>
                  {RELATION_LABEL[k]}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {kind === 'cause-effect' && (
          <label className="flex items-center gap-2 text-sm text-steel">
            <input type="checkbox" className="w-auto" checked={reverse} onChange={(e) => setReverse(e.target.checked)} />
            The other entry is the cause of this one
          </label>
        )}
        <Field label="How are they connected?">
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Same agency head; the order implemented the memo…" />
        </Field>
        {error && <ErrorBox error={error} />}
        <button className="btn self-start" disabled={busy}>
          Add link
        </button>
      </form>
    </section>
  );
}
