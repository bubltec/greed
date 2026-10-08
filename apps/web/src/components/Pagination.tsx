import { pageWindow, PAGE_SIZES } from '@greed/domain';

interface Props {
  page: number;
  pages: number;
  total: number;
  size: number;
  /** "entries", "log entries": what is being counted. */
  noun: string;
  onPage: (page: number) => void;
  onSize?: (size: number) => void;
}

/** "26–50 of 134 entries", page buttons with gaps, and an optional page-size picker. Renders nothing for an empty list. */
export function Pagination({ page, pages, total, size, noun, onPage, onSize }: Props) {
  if (total === 0) return null;
  const from = (page - 1) * size + 1;
  const to = Math.min(page * size, total);
  return (
    <nav aria-label={`${noun} pages`} className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="pixel text-[0.5rem] text-slate" aria-live="polite">
        {from}–{to} of {total} {noun}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {pages > 1 && (
          <>
            <button className="btn btn-ghost" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
              ‹ Prev
            </button>
            {pageWindow(page, pages).map((p, i) =>
              p === '…' ? (
                <span key={`gap-${i}`} className="px-1 text-slate" aria-hidden>
                  …
                </span>
              ) : (
                <button
                  key={p}
                  className={`btn ${p === page ? '' : 'btn-ghost'}`}
                  aria-current={p === page ? 'page' : undefined}
                  aria-label={`Page ${p}`}
                  onClick={() => onPage(p)}
                >
                  {p}
                </button>
              ),
            )}
            <button className="btn btn-ghost" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">
              Next ›
            </button>
          </>
        )}
        {onSize && (
          <select value={size} onChange={(e) => onSize(Number(e.target.value))} aria-label="Per page" className="w-auto">
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n} per page
              </option>
            ))}
          </select>
        )}
      </div>
    </nav>
  );
}
