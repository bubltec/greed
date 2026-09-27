import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { TOPIC_KINDS } from '@greed/domain';
import { ErrorBox, Loading, SectionTitle } from '../../components/bits';
import { api } from '../../lib/api';
import { KIND_LABEL } from '../../lib/labels';
import { useSession } from '../../lib/session';
import type { Reference, TopicInput, TopicView } from '../../lib/types';
import { useTitle } from '../../lib/useTitle';
import { Field, RefPicker } from './fields';
import { PerspectivesPanel } from './PerspectivesPanel';
import { TopicPublishBar } from './PublishControls';
import { ReferencesPanel } from './ReferencesPanel';
import { RelationsPanel } from './RelationsPanel';

const EMPTY: TopicInput = {
  kind: 'case',
  title: '',
  summary: '',
  sections: [{ label: 'What happened', points: [{ text: '', refIds: [] }] }],
  disputed: '',
  notes: '',
  tags: [],
};

function toInput(view: TopicView): TopicInput {
  const { topic } = view;
  return {
    kind: topic.kind,
    title: topic.title,
    summary: topic.summary,
    sections: topic.sections.map((s) => ({ id: s.id, label: s.label, points: s.points.map((p) => ({ ...p })) })),
    disputed: topic.disputed,
    notes: topic.notes,
    tags: topic.tags,
  };
}

export function TopicEditor() {
  const { id } = useParams();
  const { session } = useSession();
  const navigate = useNavigate();
  const [view, setView] = useState<TopicView>();
  const [error, setError] = useState<Error>();
  const isNew = !id;
  useTitle(isNew ? 'New entry' : view ? `Edit: ${view.topic.title}` : 'Edit');

  useEffect(() => {
    setView(undefined);
    setError(undefined);
    if (id) api.topic(id, true).then(setView, setError);
  }, [id]);

  if (session && !session.editor) {
    return (
      <p className="text-steel">
        Editors only. <Link to="/admin">Sign in</Link>
      </p>
    );
  }
  if (error) return <ErrorBox error={error} />;
  if (!isNew && !view) return <Loading />;

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="pixel text-sm">{isNew ? 'New entry' : 'Edit entry'}</h1>
        <div className="flex gap-2">
          <Link to="/admin" className="btn btn-ghost">
            ← Worklist
          </Link>
          {view && (
            <Link to={`/t/${view.topic.id}`} className="btn btn-ghost">
              View page
            </Link>
          )}
        </div>
      </div>

      {view ? (
        <TopicPublishBar view={view} onChange={setView} />
      ) : (
        <p className="text-sm text-steel">New entries start as drafts. Publish when they’re ready.</p>
      )}

      <TopicForm
        key={view?.topic.id ?? 'new'}
        initial={view ? toInput(view) : EMPTY}
        references={view?.references ?? []}
        onSave={async (input) => {
          if (view) {
            const next = await api.updateTopic(view.topic.id, input);
            setView(next);
            return toInput(next);
          } else {
            const created = await api.createTopic(input);
            navigate(`/admin/t/${created.topic.id}`, { replace: true });
          }
        }}
        onDelete={
          view
            ? async () => {
                await api.deleteTopic(view.topic.id);
                navigate('/admin', { replace: true });
              }
            : undefined
        }
      />

      {view ? (
        <>
          <ReferencesPanel view={view} onChange={setView} />
          <PerspectivesPanel view={view} onChange={setView} />
          <RelationsPanel view={view} onChange={() => api.topic(view.topic.id, true).then(setView)} />
        </>
      ) : (
        <p className="text-sm text-steel">Save the entry first, then add sources, perspectives and connections.</p>
      )}
    </div>
  );
}

function TopicForm({
  initial,
  references,
  onSave,
  onDelete,
}: {
  initial: TopicInput;
  references: Reference[];
  /** Resolves with the saved, server-normalised input (e.g. new section ids). */
  onSave: (input: TopicInput) => Promise<TopicInput | void>;
  onDelete?: () => Promise<void>;
}) {
  const [form, setForm] = useState<TopicInput>(initial);
  const [tags, setTags] = useState(initial.tags.join(', '));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error>();
  const [saved, setSaved] = useState(false);
  const [armDelete, setArmDelete] = useState(false);

  const set = <K extends keyof TopicInput>(key: K, value: TopicInput[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setSaved(false);
  };
  const setSection = (i: number, patch: Partial<TopicInput['sections'][number]>) =>
    set(
      'sections',
      form.sections.map((s, j) => (j === i ? { ...s, ...patch } : s)),
    );
  const moveSection = (i: number, delta: number) => {
    const next = [...form.sections];
    const [s] = next.splice(i, 1);
    next.splice(i + delta, 0, s!);
    set('sections', next);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const result = await onSave({
        ...form,
        tags: tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      });
      if (result) {
        setForm(result);
        setTags(result.tags.join(', '));
      }
      setSaved(true);
    } catch (err) {
      setError(err as Error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <div className="grid gap-5 sm:grid-cols-[10rem_1fr]">
        <Field label="Kind">
          <select value={form.kind} onChange={(e) => set('kind', e.target.value as TopicInput['kind'])}>
            {TOPIC_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Title">
          <input value={form.title} onChange={(e) => set('title', e.target.value)} required minLength={3} />
        </Field>
      </div>
      <Field label="Summary" hint="Two or three sentences a reader can trust without clicking anything.">
        <textarea rows={4} value={form.summary} onChange={(e) => set('summary', e.target.value)} />
      </Field>
      <Field label="Disputed or unproven" hint="Denials, anonymous sourcing, what isn’t established. Leave empty if nothing.">
        <textarea rows={3} value={form.disputed} onChange={(e) => set('disputed', e.target.value)} />
      </Field>

      <div>
        <SectionTitle
          right={
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => set('sections', [...form.sections, { label: '', points: [{ text: '', refIds: [] }] }])}
            >
              + Section
            </button>
          }
        >
          Sections
        </SectionTitle>
        <div className="flex flex-col gap-4">
          {form.sections.map((section, i) => (
            <fieldset key={section.id ?? `new-${i}`} className="panel flex flex-col gap-3 p-4">
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-48 flex-1">
                  <Field label={`Section ${i + 1}`}>
                    <input
                      value={section.label}
                      onChange={(e) => setSection(i, { label: e.target.value })}
                      placeholder="Heading"
                      required
                    />
                  </Field>
                </div>
                <button type="button" className="btn btn-ghost" disabled={i === 0} onClick={() => moveSection(i, -1)} aria-label="Move up">
                  ↑
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={i === form.sections.length - 1}
                  onClick={() => moveSection(i, 1)}
                  aria-label="Move down"
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => set('sections', form.sections.filter((_, j) => j !== i))}
                >
                  Remove
                </button>
              </div>
              {section.points.map((point, p) => (
                <div key={p} className="flex flex-col gap-2 border-l-2 border-deep pl-3">
                  <textarea
                    rows={3}
                    value={point.text}
                    placeholder="One factual point…"
                    aria-label={`Section ${i + 1} point ${p + 1}`}
                    onChange={(e) =>
                      setSection(i, {
                        points: section.points.map((x, q) => (q === p ? { ...x, text: e.target.value } : x)),
                      })
                    }
                  />
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <RefPicker
                      references={references}
                      value={point.refIds}
                      onChange={(refIds) =>
                        setSection(i, { points: section.points.map((x, q) => (q === p ? { ...x, refIds } : x)) })
                      }
                    />
                    <button
                      type="button"
                      className="text-xs text-hurt underline"
                      onClick={() => setSection(i, { points: section.points.filter((_, q) => q !== p) })}
                    >
                      remove point
                    </button>
                  </div>
                </div>
              ))}
              <button
                type="button"
                className="self-start text-xs text-ice underline"
                onClick={() => setSection(i, { points: [...section.points, { text: '', refIds: [] }] })}
              >
                + add point
              </button>
            </fieldset>
          ))}
        </div>
      </div>

      <Field label="Research notes" hint="Open questions, leads, things to verify. Shown publicly under the entry.">
        <textarea rows={4} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
      </Field>
      <Field label="Tags" hint="Comma-separated, e.g. oil, pardons, press freedom">
        <input value={tags} onChange={(e) => (setTags(e.target.value), setSaved(false))} />
      </Field>

      {error && <ErrorBox error={error} />}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn" disabled={busy}>
          {busy ? 'Saving…' : 'Save entry'}
        </button>
        {saved && <span className="pixel text-[0.5rem] text-bolt">Saved</span>}
        {onDelete && (
          <button
            type="button"
            className="btn btn-danger ml-auto"
            onBlur={() => setArmDelete(false)}
            onClick={() => (armDelete ? onDelete().catch(setError) : setArmDelete(true))}
          >
            {armDelete ? 'Click again to delete everything' : 'Delete entry'}
          </button>
        )}
      </div>
    </form>
  );
}
