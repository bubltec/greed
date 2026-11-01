import type { SortDir } from '@greed/domain';
import { Select } from '@bubltec/uiux';

/** Order menu shared by the home list and the log. */
export function SortDirSelect({ dir, onChange }: { dir: SortDir; onChange: (dir: SortDir) => void }) {
  return (
    <Select
      value={dir}
      onChange={(e) => onChange(e.target.value === 'asc' ? 'asc' : 'desc')}
      aria-label="Order"
      className="control-auto shrink-0"
      options={[
        { value: 'desc', label: 'Descending' },
        { value: 'asc', label: 'Ascending' },
      ]}
    />
  );
}
