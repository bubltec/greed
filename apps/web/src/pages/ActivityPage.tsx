import { Link } from 'react-router-dom';
import { ACTIVITY_TYPES, parseActivityQuery } from '@greed/domain';
import { ErrorBox, Loading } from '../components/bits';
import { Pagination } from '../components/Pagination';
import { api } from '../lib/api';
import { formatDate } from '../lib/labels';
import { usePreview } from '../lib/preview';
import { useAsync } from '../lib/useAsync';
import { useTitle } from '../lib/useTitle';
import { useUrlState } from '../lib/useUrlState';

const TYPE_LABEL = { topic: 'Entry', reference: 'Source', perspective: 'Perspective', relation: 'Link' };
const FILTER_LABEL = { topic: 'Entries', reference: 'Sources', perspective: 'Perspectives', relation: 'Links' };

export function ActivityPage() {
  useTitle('Log');
  const { preview } = usePreview();
  const [params, set] = useUrlState();
  const view = parseActivityQuery(Object.fromEntries(params));
  const { data, error, loading } = useAsync(() => api.activity(params, preview), [params.toString(), preview]);
  const all = Object.values(data?.types ?? {}).reduce((n, c) => n + c, 0);
  return (
    <div className="max-w-3xl">
      <h1 className="pixel mb-2 text-sm text-snow">Log</h1>
      <p className="mb-4 text-sm text-steel">Additions and edits across the record.</p>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by type">
          <button className={`btn ${view.type ? 'btn-ghost' : ''}`} onClick={() => set({ type: null })}>
            All{data ? ` (${all})` : ''}
          </button>
          {ACTIVITY_TYPES.filter((t) => data?.types[t] || t === view.type).map((t) => (
            <button key={t} className={`btn ${view.type === t ? '' : 'btn-ghost'}`} onClick={() => set({ type: view.type === t ? null : t })}>
              {FILTER_LABEL[t]} ({data?.types[t] ?? 0})
            </button>
          ))}
        </div>
        <select value={view.dir} onChange={(e) => set({ dir: e.target.value === 'desc' ? null : e.target.value })} aria-label="Order" className="sm:w-auto">
          <option value="desc">Newest first</option>
          <option value="asc">Oldest first</option>
        </select>
      </div>

      {loading && !data && <Loading />}
      {error && <ErrorBox error={error} />}
      {data && (
        <div aria-busy={loading} className={loading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
          <ol className="flex flex-col">
            {data.items.map((entry) => (
              <li key={`${entry.type}:${entry.id}`} className="flex gap-4 border-b border-deep py-3">
                <span className="pixel w-24 shrink-0 pt-1 text-[0.5rem] text-bolt">{TYPE_LABEL[entry.type]}</span>
                <span className="min-w-0 flex-1">
                  <Link to={`/t/${entry.topicId}`} className="font-semibold">
                    {entry.topicTitle}
                  </Link>
                  {entry.type !== 'topic' && <span className="text-steel"> · {entry.label}</span>}
                  <span className="block text-xs text-slate">
                    {formatDate(entry.updatedAt)}
                    {entry.updatedBy && entry.updatedBy !== 'import' ? ` · ${entry.updatedBy}` : ''}
                  </span>
                </span>
              </li>
            ))}
          </ol>
          {data.total === 0 && <p className="text-steel">Nothing logged yet.</p>}
          <Pagination
            page={data.page}
            pages={data.pages}
            total={data.total}
            size={data.size}
            noun="log entries"
            onPage={(page) => set({ page: page > 1 ? String(page) : null })}
            onSize={(size) => set({ size: size === 25 ? null : String(size) })}
          />
        </div>
      )}
    </div>
  );
}
