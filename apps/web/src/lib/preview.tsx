import { createContext, type ReactNode, useContext, useState } from 'react';

const KEY = 'greed:preview';

function initial(): boolean {
  const param = new URLSearchParams(window.location.search).get('preview');
  try {
    if (param === '1') sessionStorage.setItem(KEY, '1');
    if (param === '0') sessionStorage.removeItem(KEY);
    return sessionStorage.getItem(KEY) === '1';
  } catch {
    return param === '1';
  }
}

const PreviewContext = createContext<{ preview: boolean; setPreview: (on: boolean) => void }>({
  preview: false,
  setPreview: () => {},
});

/**
 * Preview mode: public pages ask the API for drafts too (`?preview=1`). The
 * API only honours it for signed-in editors. Turned on by visiting any page
 * with `?preview=1`, and remembered for the tab until turned off.
 */
export function PreviewProvider({ children }: { children: ReactNode }) {
  const [preview, set] = useState(initial);
  const setPreview = (on: boolean) => {
    try {
      if (on) sessionStorage.setItem(KEY, '1');
      else sessionStorage.removeItem(KEY);
    } catch {
      /* storage unavailable; state still works for this page */
    }
    set(on);
  };
  return <PreviewContext.Provider value={{ preview, setPreview }}>{children}</PreviewContext.Provider>;
}

export const usePreview = () => useContext(PreviewContext);
