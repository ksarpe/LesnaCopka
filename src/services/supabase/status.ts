import { create } from 'zustand';

/** Stan połączenia z Supabase – do panelu /dev (bez trwałego zapisu). */
export interface BackendStatus {
  state: 'off' | 'connecting' | 'online' | 'offline';
  userId: string | null;
  error: string | null;
  /** Skąd przyszły słowniki przy ostatnim ładowaniu. */
  catalogSource: 'mock' | 'supabase' | 'mock (fallback)';
  checkedAt: string | null;
  set: (p: Partial<Omit<BackendStatus, 'set'>>) => void;
}

export const useBackendStatus = create<BackendStatus>()((set) => ({
  state: 'off',
  userId: null,
  error: null,
  catalogSource: 'mock',
  checkedAt: null,
  set: (p) => set(p),
}));

export const backendStatus = () => useBackendStatus.getState();
