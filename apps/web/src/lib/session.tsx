import { createContext, type ReactNode, useContext } from 'react';
import { api, type Session } from './api';
import { useAsync } from './useAsync';

const SessionContext = createContext<{ session?: Session; reload: () => void }>({ reload: () => {} });

export function SessionProvider({ children }: { children: ReactNode }) {
  const { data, reload } = useAsync(() => api.session(), []);
  return <SessionContext.Provider value={{ session: data, reload }}>{children}</SessionContext.Provider>;
}

export const useSession = () => useContext(SessionContext);
