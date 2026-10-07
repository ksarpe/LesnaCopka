/**
 * Konto (tryb Supabase, etap 6 – docs/backend.md): adres e-mail z kodem OTP (zabezpieczenie konta anonimowego
 * i logowanie na innym telefonie), wylogowanie, usunięcie konta, eksport danych z serwera.
 *
 * Zmiana konta (logowanie na inne, wylogowanie, usunięcie) idzie przez switchAccount (./sync.ts) – pod blokadą
 * silnika synchronizacji, więc zdarzenia starego konta nie wyjdą z sesją nowego. Komunikaty błędów: src/utils/account.ts.
 */
import { createClient, type User as AuthUser } from '@supabase/supabase-js';

import { useOutboxStore } from '@/store/useOutboxStore';
import { ServiceError } from '../types';
import { serviceCall } from './api';
import { supabase, SUPABASE_KEY, SUPABASE_URL } from './client';
import { deleteServerObjects } from './photos';
import { rpc } from './rpc';
import { establishSession, withTimeout } from './session';
import { backendStatus } from './status';
import { createStorageApi } from './storage';
import { BUCKETS, type StorageBucket } from './storagePaths';
import { storagePathsOf, switchAccount, switchAccountLocked, withSyncLock, type SwitchResult } from './sync';
import { classifyError, errorMessage, type SyncError } from './syncRpc';

/** Wysłanie / sprawdzenie kodu – dłużej niż zwykłe zapytanie (serwer wysyła e-mail). */
const AUTH_TIMEOUT_MS = 15_000;

export interface AccountInfo {
  userId: string;
  /** Potwierdzony adres (konto zabezpieczone) – null = konto anonimowe. */
  email: string | null;
  /** Adres czekający na kod (`updateUser({ email })` przed `verifyOtp`). */
  pendingEmail: string | null;
  anonymous: boolean;
}

export function accountInfoOf(u: Pick<AuthUser, 'id' | 'email' | 'new_email' | 'is_anonymous'>): AccountInfo {
  const email = u.email || null;
  return { userId: u.id, email, pendingEmail: u.new_email || null, anonymous: u.is_anonymous === true || !email };
}

/** Konto bieżącej sesji: z serwera (świeże `email` / `is_anonymous`), bez sieci – z zapisanej sesji. Brak sesji → null. */
export async function getAccountInfo(): Promise<AccountInfo | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await withTimeout(supabase.auth.getUser(), 6_000);
    if (!error && data.user) return accountInfoOf(data.user);
  } catch {
    // offline – niżej sesja z pamięci telefonu
  }
  const { data } = await supabase.auth.getSession();
  return data.session ? accountInfoOf(data.session.user) : null;
}

async function authCall<T extends { error: unknown }>(p: PromiseLike<T>): Promise<T> {
  const r = await withTimeout(p, AUTH_TIMEOUT_MS);
  if (r.error) throw r.error;
  return r;
}

function client() {
  if (!supabase) throw new ServiceError('NETWORK', 'Backend wyłączony');
  return supabase;
}

/* ───────────────────────── Zabezpieczenie konta e-mailem ───────────────────────── */

/** Kod na NOWY adres (`updateUser({ email })`, szablon email_change). Rzuca błąd GoTrue (authFailure w UI). */
export async function sendLinkCode(email: string): Promise<void> {
  await authCall(client().auth.updateUser({ email }));
}

/** Kod z e-maila → konto staje się stałe (ten sam `user.id`, dane gry zostają). */
export async function confirmLinkCode(email: string, code: string): Promise<AccountInfo> {
  const r = await authCall(client().auth.verifyOtp({ email, token: code, type: 'email_change' }));
  const user = r.data.user;
  if (!user) throw new ServiceError('SERVER', 'Serwer nie potwierdził adresu');
  return accountInfoOf(user);
}

/* ───────────────────────── Logowanie na inne konto ───────────────────────── */

/** Kod logowania na istniejące konto (`shouldCreateUser: false` – nieznany adres → `otp_disabled`). */
export async function sendLoginCode(email: string): Promise<void> {
  await authCall(client().auth.signInWithOtp({ email, options: { shouldCreateUser: false } }));
}

/**
 * Kod z e-maila → sesja konta z tym adresem. Zdarzenia starego konta przepadają, stan lokalny – `wipeLocal`, potem
 * stan nowego konta z serwera (`replace`, także onboarding). Stare konto anonimowe (bez adresu nie da się do niego
 * wrócić) usuwamy w tle jego własną, jeszcze ważną sesją. Zły kod → `error` w wyniku, nic się nie zmienia.
 */
export async function loginWithCode(email: string, code: string, wipeLocal: () => void): Promise<SwitchResult> {
  let orphan: { userId: string; token: string } | null = null;
  const r = await switchAccount({
    dropReason: 'porzucone: logowanie na inne konto',
    wipeLocal,
    establish: async () => {
      const prev = (await client().auth.getSession()).data.session;
      await authCall(client().auth.verifyOtp({ email, token: code, type: 'email' }));
      if (prev?.user.is_anonymous) orphan = { userId: prev.user.id, token: prev.access_token };
    },
  });
  const old = orphan as { userId: string; token: string } | null;
  if (r.ok && !r.sameAccount && old && old.userId !== r.userId) void deleteOrphanAccount(old.token);
  return r;
}

/**
 * Osierocone konto anonimowe (po zalogowaniu na inne): pliki i dane usuwa ono samo – klient pomocniczy z jego tokenem
 * (ważny do wygaśnięcia, ≤ 1 h). Best effort: błąd tylko w panelu /dev (w chmurze sprzątnie je cron – konto bez sesji).
 */
async function deleteOrphanAccount(token: string): Promise<void> {
  try {
    const c = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'grzyb-orphan' },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const prep = await withTimeout(c.rpc('prepare_account_deletion'), 10_000);
    if (!prep.error) await removeStoragePaths(createStorageApi(c), storagePathsOf(prep.data));
    const del = await withTimeout(c.rpc('delete_my_account'), 15_000);
    if (del.error) throw del.error;
  } catch (e) {
    backendStatus().set({ error: `Stare konto anonimowe nie zostało usunięte: ${e instanceof Error ? e.message : String(e)}` });
  }
}

async function removeStoragePaths(api: ReturnType<typeof createStorageApi>, raw: unknown) {
  if (!raw || typeof raw !== 'object') return;
  for (const [bucket, paths] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(paths) || !Object.values(BUCKETS).includes(bucket as StorageBucket)) continue;
    const list = paths.filter((p): p is string => typeof p === 'string');
    if (list.length) await api.remove(bucket as StorageBucket, list);
  }
}

/* ───────────────────────── Wylogowanie ───────────────────────── */

/** „Wyloguj” (konto z e-mailem): sesja tylko z tego telefonu, potem nowe konto anonimowe i onboarding. */
export function signOutToAnonymous(wipeLocal: () => void): Promise<SwitchResult> {
  return switchAccount({
    dropReason: 'porzucone: wylogowanie',
    wipeLocal,
    establish: async () => {
      await client().auth.signOut({ scope: 'local' });
    },
  });
}

/* ───────────────────────── Eksport ───────────────────────── */

/** `export_my_data()` – wszystko o graczu z serwera (format „grzybobranie-export-v1”). Bez sieci → ServiceError. */
export async function exportServerData(): Promise<Record<string, unknown>> {
  const data = await serviceCall('export_my_data', undefined, 20_000);
  const obj = typeof data === 'string' ? (JSON.parse(data) as unknown) : data;
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new ServiceError('SERVER', 'Nieprawidłowa odpowiedź serwera');
  return obj as Record<string, unknown>;
}

/* ───────────────────────── Usunięcie konta ───────────────────────── */

export interface DeletionPreview {
  trips: number;
  finds: number;
  species: number;
  posts: number;
  comments: number;
  friends: number;
}

const count = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);

/** `prepare_account_deletion().counts` – co zniknie (ekran potwierdzenia). Bez sieci → ServiceError. */
export async function deletionPreview(): Promise<DeletionPreview> {
  const data = await serviceCall('prepare_account_deletion');
  const c = ((data as { counts?: Record<string, unknown> } | null)?.counts ?? {}) as Record<string, unknown>;
  return {
    trips: count(c.trips),
    finds: count(c.finds),
    species: count(c.species),
    posts: count(c.posts),
    comments: count(c.comments),
    friends: count(c.friends),
  };
}

export type DeleteOutcome =
  | { ok: true; filesError: string | null }
  | { ok: false; reason: 'network' | 'needs_production' | 'unsupported' | 'server'; message: string };

const NEEDS_PRODUCTION = 'Usunięcie konta wymaga połączenia z serwerem produkcyjnym – spróbuj ponownie później';

function failure(e: SyncError): DeleteOutcome {
  const kind = classifyError(e);
  if (e.code === 'PGRST202') return { ok: false, reason: 'unsupported', message: 'Serwer nie obsługuje jeszcze usuwania konta' };
  if (kind === 'network' || kind === 'auth') return { ok: false, reason: 'network', message: 'Brak połączenia z serwerem – usunięcie konta wymaga internetu' };
  return { ok: false, reason: 'server', message: `Serwer nie usunął konta (${errorMessage(e)})` };
}

/** Wynik `delete_my_account()`: czy konto auth zniknęło (false → Edge Function `delete-account`). */
export function authUserDeleted(data: unknown): boolean {
  const d = typeof data === 'string' ? (() => { try { return JSON.parse(data) as unknown; } catch { return null; } })() : data;
  const o = Array.isArray(d) ? d[0] : d;
  if (!o || typeof o !== 'object') return true; // starszy kontrakt (void) – usunięte w całości
  return (o as { authUserDeleted?: unknown }).authUserDeleted !== false;
}

/**
 * Usunięcie konta (docs/backend.md → „Usunięcie konta”), pod blokadą silnika: `prepare_account_deletion` → pliki
 * w Storage (+ własne foldery) → `delete_my_account` → (Edge Function `delete-account`, gdy SQL nie usunął konta
 * auth) → wylogowanie, `wipeLocal`, nowe konto anonimowe → onboarding. Błąd przed `delete_my_account` – nic nie
 * znika. Edge Function niedostępna – komunikat i dane w telefonie zostają (konto na serwerze jest już puste
 * i zanonimizowane; ponowna próba jest bezpieczna).
 */
export function deleteAccount(wipeLocal: () => void): Promise<DeleteOutcome> {
  return withSyncLock(async () => {
    if (!supabase || !(await establishSession())) {
      return { ok: false, reason: 'network', message: 'Brak połączenia z serwerem – usunięcie konta wymaga internetu' };
    }
    const uid = backendStatus().userId!;
    const prep = await rpc('prepare_account_deletion', undefined, 15_000);
    if (prep.error) return failure(prep.error);

    // Pliki – zanim zniknie konto (potem nikt nie wskaże, które są jego). Błąd plików nie blokuje usunięcia.
    let filesError: string | null = null;
    const removed = await deleteServerObjects(storagePathsOf(prep.data));
    if (removed?.error) filesError = removed.error;
    const api = createStorageApi(supabase);
    for (const bucket of Object.values(BUCKETS)) {
      const { paths } = await api.list(bucket, uid);
      if (paths.length) {
        const err = await api.remove(bucket, paths);
        if (err) filesError = errorMessage(err);
      }
    }

    const del = await rpc('delete_my_account', undefined, 20_000);
    if (del.error) return failure(del.error);
    if (!authUserDeleted(del.data)) {
      const fn = await supabase.functions.invoke('delete-account', { method: 'POST' }).catch((e: unknown) => ({ error: e }));
      if (fn.error) {
        backendStatus().set({ error: `Usunięcie konta: Edge Function delete-account – ${String((fn.error as Error).message ?? fn.error)}` });
        return { ok: false, reason: 'needs_production', message: NEEDS_PRODUCTION };
      }
    }

    // Zdarzenia usuniętego konta nie mają dokąd iść.
    if (useOutboxStore.getState().items.length) useOutboxStore.getState().drop('porzucone: konto usunięte');
    await switchAccountLocked({
      dropReason: 'porzucone: konto usunięte',
      wipeLocal,
      establish: async () => {
        // Sesja na serwerze już nie istnieje – supabase-js i tak czyści ją w telefonie.
        await supabase!.auth.signOut({ scope: 'local' }).catch(() => {});
      },
    });
    if (filesError) backendStatus().set({ error: `Usunięcie konta – pliki: ${filesError}` });
    return { ok: true, filesError };
  });
}
