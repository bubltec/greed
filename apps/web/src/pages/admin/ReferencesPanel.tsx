import { useState } from 'react';
import { ErrorBox, SectionTitle } from '../../components/bits';
import { api } from '../../lib/api';
import type { Reference, ReferenceInput, TopicView } from '../../lib/types';
import { Field } from './fields';

const blank: ReferenceInput = { label: '', url: '', publishedOn: '', excerpt: '', note: '' };

function clean(input: ReferenceInput): ReferenceInput {
  // Empty optional strings would fail the BFF's URL/date validators; omit them.
  return Object.fromEntries(
    Object.entries(input).filter(([k, v]) => k === 'label' || (typeof v === 'string' && v.trim())),
  ) as unknown as ReferenceInput;
}

export function ReferencesPanel({ view, onChange }: { view: TopicView; onChange: (v: TopicView) => void }) {
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  return (
    <section>
      <SectionTitle
        right={
          editing === null && (
            <button className="btn btn-ghost" onClick={() => setEditing('new')}>
              + Source
            </button>
          )
        }
      >
        Sources ({view.references.length})
      </SectionTitle>
      {editing === 'new' && (
        <ReferenceForm
          initial={blank}
          onCancel={() => setEditing(null)}
          onSubmit={async (input) => {
            onChange(await api.addReference(view.topic.id, clean(input)));
            setEditing(null);
          }}
        />
      )}
      <ol className="mt-3 flex flex-col gap-2">
        {view.references.map((ref, i) =>
          editing === ref.id ? (
            <li key={ref.id}>
              <ReferenceForm
                initial={{ ...blank, ...ref }}
                onCancel={() => setEditing(null)}
                onSubmit={async (input) => {
                  onChange(await api.updateReference(view.topic.id, ref.id, clean(input)));
                  setEditing(null);
                }}
                onDelete={async () => {
                  onChange(await api.deleteReference(view.topic.id, ref.id));
                  setEditing(null);
                }}
              />
            </li>
          ) : (
            <ReferenceRow key={ref.id} n={i + 1} reference={ref} onEdit={() => setEditing(ref.id)} />
          ),
        )}
      </ol>
    </section>
  );
}

function ReferenceRow({ n, reference, onEdit }: { n: number; reference: Reference; onEdit: () => void }) {
  return (
    <li className="flex items-start gap-3 border-b border-deep pb-2 text-sm">
      <span className="pixel w-8 shrink-0 pt-0.5 text-[0.5rem] text-bolt">[{n}]</span>
      <span className="min-w-0 flex-1">
        {reference.url ? (
          <a href={reference.url} target="_blank" rel="noopener noreferrer">
            {reference.label}
          </a>
        ) : (
          <>
            {reference.label} <span className="pixel text-[0.4375rem] text-hurt">needs link</span>
          </>
        )}
        {reference.publishedOn && <span className="text-slate"> · {reference.publishedOn}</span>}
      </span>
      <button className="text-xs text-ice underline" onClick={onEdit}>
        edit
      </button>
    </li>
  );
}

function ReferenceForm({
  initial,
  onSubmit,
  onCancel,
  onDelete,
}: {
  initial: ReferenceInput;
  onSubmit: (input: ReferenceInput) => Promise<void>;
  onCancel: () => void;
  onDelete?: () => Promise<void>;
}) {
  const [form, setForm] = useState(initial);
  const [error, setError] = useState<Error>();
  const [busy, setBusy] = useState(false);
  const [armDelete, setArmDelete] = useState(false);
  const set = (key: keyof ReferenceInput, value: string) => setForm((f) => ({ ...f, [key]: value }));
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
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Source name">
          <input value={form.label} onChange={(e) => set('label', e.target.value)} required placeholder="Washington Post" />
        </Field>
        <Field label="Published" hint="YYYY, YYYY-MM or YYYY-MM-DD">
          <input value={form.publishedOn ?? ''} onChange={(e) => set('publishedOn', e.target.value)} placeholder="2026-09-14" />
        </Field>
      </div>
      <Field label="URL">
        <input type="url" value={form.url ?? ''} onChange={(e) => set('url', e.target.value)} placeholder="https://…" />
      </Field>
      <Field label="Key excerpt" hint="A short quote from the source that supports the point.">
        <textarea rows={2} value={form.excerpt ?? ''} onChange={(e) => set('excerpt', e.target.value)} />
      </Field>
      <Field label="Note">
        <input value={form.note ?? ''} onChange={(e) => set('note', e.target.value)} placeholder="e.g. paywalled; archived copy at…" />
      </Field>
      {error && <ErrorBox error={error} />}
      <div className="flex flex-wrap gap-2">
        <button className="btn" disabled={busy}>
          Save source
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
