import { useStore } from 'zustand';
import { authSession } from '../services/runtime';
export function useAuth() {
  return useStore(authSession.store);
}
