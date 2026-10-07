/**
 * Zapytania ekranów do serwera (feed, statystyki gmin, panel /dev): sesja + RPC z limitem czasu → dane albo
 * ServiceError. Bez sieci rzucają ServiceError('NETWORK') – ekrany pokazują swoje stany offline (bez cichego
 * powrotu do mocków). Silnik synchronizacji gry ma własną ścieżkę (./sync.ts – kolejka i ponowienia).
 */
import { missingGminy } from '@/geo';
import { useCatalogStore } from '@/store/useCatalogStore';
import { ServiceError } from '../types';
import { supabase } from './client';
import { toServiceError } from './feedMap';
import { rpc } from './rpc';
import { establishSession } from './session';
import { backendStatus, useBackendStatus } from './status';
import { classifyError, errorMessage } from './syncRpc';

/** Ekrany czekają krócej niż silnik synchronizacji – potem stan offline z „Spróbuj ponownie”. */
export const SCREEN_TIMEOUT_MS = 8_000;

/** Trwające łączenie (connect() przy starcie) – czekamy, zamiast zakładać drugie konto anonimowe. */
function whenNotConnecting(): Promise<void> {
  if (backendStatus().state !== 'connecting') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      unsub();
      resolve();
    };
    const unsub = useBackendStatus.subscribe((s) => {
      if (s.state !== 'connecting') done();
    });
    const timer = setTimeout(done, SCREEN_TIMEOUT_MS);
  });
}

/** Sesja do zapytań (bez niej – np. pierwsze uruchomienie offline – próbujemy ją założyć). */
export async function ensureOnline(): Promise<void> {
  if (!supabase) throw new ServiceError('NETWORK', 'Backend wyłączony');
  await whenNotConnecting();
  const st = backendStatus();
  if (st.state === 'online' && st.userId) return;
  if (!(await establishSession())) throw new ServiceError('NETWORK', 'Brak połączenia z serwerem');
}

/** RPC → dane albo ServiceError. Wygasła sesja – raz od nowa i ponowienie. */
export async function serviceCall(fn: string, params?: Record<string, unknown>, ms = SCREEN_TIMEOUT_MS): Promise<unknown> {
  await ensureOnline();
  let r = await rpc(fn, params, ms);
  if (r.error && classifyError(r.error) === 'auth' && (await establishSession())) r = await rpc(fn, params, ms);
  if (r.error) throw toServiceError(r.error);
  return r.data;
}

/** Funkcja zwracająca jeden wiersz: obiekt albo tablica z jednym elementem. */
export const one = (data: unknown): unknown => (Array.isArray(data) ? data[0] : data);

/** Gminy spoza danych gry (wpisy, grzybiarze, rankingi z całej Polski) – do katalogu z indeksu PRG, w tle. */
export function resolveGminy(ids: string[]) {
  const wanted = ids.filter(Boolean);
  if (!wanted.length) return;
  missingGminy(wanted, useCatalogStore.getState().gminaById)
    .then((list) => list.forEach((g) => useCatalogStore.getState().upsertGmina(g)))
    .catch(() => {});
}

/* ───────────────────────── Panel /dev ───────────────────────── */

export interface DevCallResult {
  ok: boolean;
  message: string;
  data?: unknown;
}

const COUNT_LABELS: Record<string, string> = {
  bots: 'grzybiarze',
  friends: 'znajomi',
  incoming: 'zaproszenia do Ciebie',
  outgoing: 'wysłane zaproszenia',
  posts: 'wpisy',
  reactions: 'reakcje',
  comments: 'komentarze',
  requests: 'zaproszenia',
  friendRequests: 'zaproszenia',
  accepted: 'przyjęte zaproszenia',
  visible: 'wpisy widoczne od razu',
  finds: 'znaleziska',
  gminy: 'gminy',
  week: 'tydzień',
  season: 'sezon',
  records: 'rekordy',
};

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s) as unknown;
  } catch {
    return null;
  }
}

/** `{bots: 6, posts: 12}` → „grzybiarze 6 · wpisy 12”. */
export function describeCounts(data: unknown): string {
  const o = one(typeof data === 'string' ? safeJson(data) : data);
  if (!o || typeof o !== 'object') return 'gotowe';
  const parts = Object.entries(o as Record<string, unknown>)
    .filter(([, v]) => typeof v === 'number')
    .map(([k, v]) => `${COUNT_LABELS[k] ?? k} ${v as number}`);
  return parts.length ? parts.join(' · ') : 'gotowe';
}

export const DEV_DISABLED_MESSAGE =
  'Narzędzia dev są wyłączone na serwerze (app_config.dev_tools ≠ true – lokalnie włącza je seed.sql).';

/**
 * Akcja dev na serwerze (boty, generator aktywności): wynik albo czytelny komunikat – wyłączone narzędzia dev,
 * brak funkcji (`stage` – która migracja ją dodaje), brak sieci. Nie rzuca.
 */
export async function devCall(fn: string, params: Record<string, unknown> | undefined, stage: string): Promise<DevCallResult> {
  try {
    await ensureOnline();
  } catch {
    return { ok: false, message: 'Brak połączenia z serwerem' };
  }
  const r = await rpc(fn, params, 30_000);
  if (!r.error) return { ok: true, message: 'gotowe', data: r.data };
  if (r.error.message.includes('dev_tools_disabled')) return { ok: false, message: DEV_DISABLED_MESSAGE };
  if (r.error.code === 'PGRST202') return { ok: false, message: `Serwer nie ma tej funkcji – wgraj migrację ${stage} (${r.error.message})` };
  return { ok: false, message: errorMessage(r.error) };
}
