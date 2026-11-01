import type { SortDir } from '@greed/domain';

/** Order menu shared by the home list and the log. */
export function SortDirSelect({ dir, onChange }: { dir: SortDir; onChange: (dir: SortDir) => void }) {
  return (
    <select value={dir} onChange={(e) => onChange(e.target.value === 'asc' ? 'asc' : 'desc')} aria-label="Order" className="w-auto shrink-0">
      <option value="desc">Descending</option>
      <option value="asc">Ascending</option>
    </select>
  );
}
