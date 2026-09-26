import { Link } from 'react-router-dom';
import { ErrorBox, Loading } from '../components/bits';
import { api } from '../lib/api';
import { formatDate } from '../lib/labels';
import { useAsync } from '../lib/useAsync';
import { useTitle } from '../lib/useTitle';

const TYPE_LABEL = { topic: 'Entry', reference: 'Source', perspective: 'Perspective', relation: 'Link' };

export function ActivityPage() {
  useTitle('Log');
  const { data, error, loading } = useAsync(() => api.activity(), []);
  return (
    <div className="max-w-3xl">
      <h1 className="pixel mb-2 text-sm text-snow">Log</h1>
      <p className="mb-6 text-sm text-steel">The most recent additions and edits across the record.</p>
      {loading && <Loading />}
      {error && <ErrorBox error={error} />}
      <ol className="flex flex-col">
        {data?.map((entry) => (
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
    </div>
  );
}
