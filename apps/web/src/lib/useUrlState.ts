import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * The page's filters live in the URL, so a view can be linked and Back works.
 * `set` changes some keys (null or '' removes one) and, unless the change is
 * only the page number, returns to page 1: a new search should not land on page 9.
 */
export function useUrlState() {
  const [params, setParams] = useSearchParams();
  const set = useCallback(
    (changes: Record<string, string | null>) => {
      const next = new URLSearchParams(params);
      for (const [key, value] of Object.entries(changes)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      if (!('page' in changes)) next.delete('page');
      if (next.toString() !== params.toString()) setParams(next, { replace: true });
    },
    [params, setParams],
  );
  return [params, set] as const;
}
