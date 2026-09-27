import { DEFAULT_PAGES, type PageId, type PageView } from '@greed/domain';
import { api } from './api';
import { usePreview } from './preview';
import { useAsync } from './useAsync';

/** A site page's content; shows the built-in default while loading or if the API is unreachable. */
export function usePage(id: PageId): PageView {
  const { preview } = usePreview();
  const { data } = useAsync(() => api.page(id, preview), [id, preview]);
  return data ?? { id, ...DEFAULT_PAGES[id], state: 'default' };
}
