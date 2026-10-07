/**
 * Wywołania PostgREST z limitem czasu – wspólne dla silnika synchronizacji (./sync.ts) i feedu (./feed.ts).
 * Nigdy nie rzucają: błąd sieci / serwera wraca jako SyncError (klasyfikacja w ./syncRpc.ts).
 */
import { supabase } from './client';
import type { SyncError } from './syncRpc';

export const RPC_TIMEOUT_MS = 10_000;

export const asSyncError = (e: unknown): SyncError => {
  if (e && typeof e === 'object' && 'message' in e) {
    const o = e as { message?: unknown; code?: unknown; status?: unknown; details?: unknown; hint?: unknown };
    return {
      message: String(o.message ?? ''),
      code: typeof o.code === 'string' ? o.code : '',
      status: typeof o.status === 'number' ? o.status : 0,
      details: typeof o.details === 'string' ? o.details : undefined,
      hint: typeof o.hint === 'string' ? o.hint : undefined,
    };
  }
  return { message: String(e), code: '', status: 0 };
};

export type Thenable<R> = PromiseLike<R> & { abortSignal?: (s: AbortSignal) => Thenable<R> };
export type PgResult = {
  data: unknown;
  error: { message: string; code?: string; details?: string | null; hint?: string | null } | null;
  status?: number;
};

/** Zapytanie PostgREST z limitem czasu (przerwane = błąd sieci → ponowienie). Nie rzuca. */
export async function call(build: () => Thenable<PgResult>, ms = RPC_TIMEOUT_MS): Promise<{ data: unknown; error: SyncError | null }> {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    let q = build();
    if (ctrl && typeof q.abortSignal === 'function') q = q.abortSignal(ctrl.signal);
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        ctrl?.abort();
        reject(new Error(`Brak odpowiedzi serwera (${ms / 1000} s)`));
      }, ms);
    });
    const res = await Promise.race([Promise.resolve(q), timeout]);
    if (res.error) {
      return {
        data: null,
        error: {
          message: res.error.message,
          code: res.error.code ?? '',
          status: res.status ?? 0,
          details: res.error.details || res.error.hint || undefined,
        },
      };
    }
    return { data: res.data, error: null };
  } catch (e) {
    return { data: null, error: { ...asSyncError(e), code: '', status: 0 } };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Funkcja RPC (`supabase.rpc`) z limitem czasu. Nie rzuca. */
export const rpc = (fn: string, params?: Record<string, unknown>, ms?: number) =>
  call(() => supabase!.rpc(fn, params) as unknown as Thenable<PgResult>, ms);
