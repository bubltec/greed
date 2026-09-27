import { useState } from 'react';
import { STANCES } from '@greed/domain';
import { ErrorBox, SectionTitle } from '../../components/bits';
import { api } from '../../lib/api';
import { STANCE_COLOR, STANCE_LABEL } from '../../lib/labels';
import type { PerspectiveInput, TopicView } from '../../lib/types';
import { Field, RefPicker } from './fields';
import { ItemStatus } from './PublishControls';

const blank: PerspectiveInput = { stance: 'critic', holder: '', body: '', refIds: [] };

export function PerspectivesPanel({ view, onChange }: { view: TopicView; onChange: (v: TopicView) => void }) {
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  return (
    <section>
      <SectionTitle
        right={
          editing === null && (
            <button className="btn btn-ghost" onClick={() => setEditing('new')}>
              + Perspective
            </button>
          )
        }
      >
        Perspectives ({view.perspectives.length})
      </SectionTitle>
      <p className="mb-3 text-xs text-slate">
        Attribute each view to who holds it, and state it the way they would. Cite their own words where possible.
      </p>
      {editing === 'new' && (
        <PerspectiveForm
          view={view}
          initial={blank}
          onCancel={() => setEditing(null)}
          onSubmit={async (input) => {
            onChange(await api.addPerspective(view.topic.id, input));
            setEditing(null);
          }}
        />
      )}
      <div className="flex flex-col gap-2">
        {view.perspectives.map((p) =>
          editing === p.id ? (
            <PerspectiveForm
              key={p.id}
              view={view}
              initial={{ stance: p.stance, holder: p.holder, body: p.body, refIds: p.refIds }}
              onCancel={() => setEditing(null)}
              onSubmit={async (input) => {
                onChange(await api.updatePerspective(view.topic.id, p.id, input));
                setEditing(null);
              }}
              onDelete={async () => {
                onChange(await api.deletePerspective(view.topic.id, p.id));
                setEditing(null);
              }}
            />
          ) : (
            <div key={p.id} className="flex items-start gap-3 border-l-2 pl-3 text-sm" style={{ borderColor: STANCE_COLOR[p.stance] }}>
              <div className="min-w-0 flex-1">
                <span className="pixel mr-2 text-[0.4375rem]" style={{ color: STANCE_COLOR[p.stance] }}>
                  {STANCE_LABEL[p.stance]}
                </span>
                <strong>{p.holder}</strong>{' '}
                <ItemStatus
                  type="perspective"
                  id={p.id}
                  status={p.status}
                  onChanged={() => api.topic(view.topic.id, true).then(onChange)}
                />
                <p className="line-clamp-2 text-steel">{p.body}</p>
              </div>
              <button className="text-xs text-ice underline" onClick={() => setEditing(p.id)}>
                edit
              </button>
            </div>
          ),
        )}
      </div>
    </section>
  );
}

function PerspectiveForm({
  view,
  initial,
  onSubmit,
  onCancel,
  onDelete,
}: {
  view: TopicView;
  initial: PerspectiveInput;
  onSubmit: (input: PerspectiveInput) => Promise<void>;
  onCancel: () => void;
  onDelete?: () => Promise<void>;
}) {
  const [form, setForm] = useState(initial);
  const [error, setError] = useState<Error>();
  const [busy, setBusy] = useState(false);
  const [armDelete, setArmDelete] = useState(false);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
    } catch (err) {
      setError(err as Error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="panel mb-3 flex flex-col gap-3 border-sky p-4"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => onSubmit(form));
      }}
    >
      <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
        <Field label="Stance">
          <select value={form.stance} onChange={(e) => setForm({ ...form, stance: e.target.value as PerspectiveInput['stance'] })}>
            {STANCES.map((s) => (
              <option key={s} value={s}>
                {STANCE_LABEL[s]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Held by">
          <input value={form.holder} onChange={(e) => setForm({ ...form, holder: e.target.value })} required placeholder="Pentagon spokesperson" />
        </Field>
      </div>
      <Field label="Their view">
        <textarea rows={4} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} required />
      </Field>
      <RefPicker references={view.references} value={form.refIds} onChange={(refIds) => setForm({ ...form, refIds })} />
      {error && <ErrorBox error={error} />}
      <div className="flex flex-wrap gap-2">
        <button className="btn" disabled={busy}>
          Save perspective
        </button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        {onDelete && (
          <button
            type="button"
            className="btn btn-danger ml-auto"
            disabled={busy}
            onBlur={() => setArmDelete(false)}
            onClick={() => (armDelete ? void run(onDelete) : setArmDelete(true))}
          >
            {armDelete ? 'Confirm delete' : 'Delete'}
          </button>
        )}
      </div>
    </form>
  );
}
