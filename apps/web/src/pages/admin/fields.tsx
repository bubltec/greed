import { ChipSelect, Field } from '@bubltec/uiux';
import type { Reference } from '../../lib/types';

export { Field };

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
    <ChipSelect
      label="Cite sources"
      value={value}
      onChange={onChange}
      options={references.map((r, i) => ({ value: r.id, label: String(i + 1), title: r.label }))}
    />
  );
}

export function useConfirm() {
  // Two-click confirm instead of window.confirm: no modal, no surprise.
  return (armed: boolean, arm: () => void, run: () => void) => (armed ? run() : arm());
}
