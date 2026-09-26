import type { ReactNode } from 'react';
import type { Reference } from '../../lib/types';

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="text-xs text-slate">{hint}</span>}
    </label>
  );
}

/** Toggle chips for citing this topic's references by footnote number. */
export function RefPicker({
  references,
  value,
  onChange,
}: {
  references: Reference[];
  value: string[];
  onChange: (next: string[]) => void;
}) {
  if (references.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Cite sources">
      <span className="pixel mr-1 text-[0.4375rem] text-slate">Cite</span>
      {references.map((r, i) => {
        const on = value.includes(r.id);
        return (
          <button
            type="button"
            key={r.id}
            title={r.label}
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((v) => v !== r.id) : [...value, r.id])}
            className={`pixel border px-1.5 py-1 text-[0.4375rem] ${on ? 'border-bolt bg-bolt text-void' : 'border-deep text-steel hover:border-sky'}`}
          >
            {i + 1}
          </button>
        );
      })}
    </div>
  );
}

export function useConfirm() {
  // Two-click confirm instead of window.confirm: no modal, no surprise.
  return (armed: boolean, arm: () => void, run: () => void) => (armed ? run() : arm());
}
