import { useEffect } from 'react';

export function useTitle(title?: string) {
  useEffect(() => {
    document.title = title ? `${title} · GREED` : 'GREED — power, money & oversight';
  }, [title]);
}
