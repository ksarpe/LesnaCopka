/**
 * Sesja Supabase (konto anonimowe) i limity czasu zapytań – wspólne dla serwisów i silnika synchronizacji.
 */
import { supabase } from './client';
import { backendStatus } from './status';

export const TIMEOUT_MS = 4000;

export function withTimeout<T>(p: PromiseLike<T>, ms = TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Brak odpowiedzi serwera (${ms / 1000} s)`)), ms);
    Promise.resolve(p).then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/** Sesja: anonimowe konto tworzone przy pierwszym uruchomieniu (profil zakłada trigger w bazie). */
export async function ensureSession(): Promise<string> {
  if (!supabase) throw new Error('Supabase wyłączony');
  const { data } = await withTimeout(supabase.auth.getSession());
  if (data.session) return data.session.user.id;
  const res = await withTimeout(supabase.auth.signInAnonymously());
  if (res.error || !res.data.user) throw res.error ?? new Error('Nie udało się utworzyć konta');
  return res.data.user.id;
}

/** Ustala sesję i zapisuje stan połączenia (panel /dev). Nie rzuca – zwraca, czy jest sesja. */
export async function establishSession(): Promise<boolean> {
  const st = backendStatus();
  st.set({ state: 'connecting', error: null });
  try {
    const userId = await ensureSession();
    st.set({ state: 'online', userId, checkedAt: new Date().toISOString() });
    return true;
  } catch (e) {
    st.set({ state: 'offline', error: e instanceof Error ? e.message : String(e), checkedAt: new Date().toISOString() });
    return false;
  }
}
