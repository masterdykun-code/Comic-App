import { createContext, useContext } from 'react';
import type { Session, SessionView } from './session';

interface AuthContextValue {
  session: Session;
  view: SessionView;
  checking: boolean;
  recheck: () => void;
  logout: () => Promise<boolean>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('AuthProvider is required.');
  return context;
}
