/**
 * Silnik synchronizacji gry (tryb Supabase, local-first).
 *
 * Kolejka zdarzeń (src/store/useOutboxStore.ts) → RPC po kolei (FIFO, jedno naraz). Gdy kolejka jest
 * pusta → `get_game_state()` → stan z serwera w store'ach (./gameState.ts). Nigdy nie blokuje UI i nie
 * rzuca do UI – błędy lądują w panelu /dev (Backend).
 *
 * Wyzwalacze: nowe zdarzenie (debounce 300 ms), połączenie (connect), powrót aplikacji na pierwszy plan,
 * co 60 s, dopóki kolejka nie jest pusta, i ręcznie („Synchronizuj teraz”).
 * Błąd sieci / limit czasu → przerwa i ponowienie (5 s, 15 s, 60 s, potem co 2 min); brak sesji (28000)
 * → sesja od nowa i ponowienie; błąd trwały (P0001 / P0002 – np. trip_not_found, low_confidence,
 * walidacja; Storage 413 / 415) → zdarzenie wypada do `failed`. Kolejność ściśle FIFO (odbiór znaleziska
 * przed końcem wyprawy, zdjęcie znaleziska po jego skanie). Zdjęcia (Storage) wysyła ./photos.ts, a po przyjęciu
 * stanu z serwera odtwarza w tle zdjęcia znalezisk, których telefon nie ma (nowe urządzenie).
 */
import { AppState, type AppStateStatus, type NativeEventSubscription } from 'react-native';

import { useCatalogStore } from '@/store/useCatalogStore';
import { useFeedSync } from '@/store/useFeedSync';
import {
  backoffMs,
  EVENT_LABEL,
  headDue,
  hydrationHeld,
  onOutboxKick,
  outboxRevision,
  useOutboxStore,
  type OutboxItem,
  type ProfileUpdatePayload,
} from '@/store/useOutboxStore';
import { useTripStore } from '@/store/useTripStore';
import { ui } from '@/store/useUiStore';
import { initialUserState, useUserStore } from '@/store/useUserStore';
import { supabase } from './client';
import { applyGameState, buildImportState, parseGameState, type HydrateMode, type MergeMode } from './gameState';
import {
  deleteServerObjects,
  resetPhotoSession,
  restoreFindPhotos,
  sendAvatarPhoto,
  sendFindPhoto,
  sendPublish,
  sendStorageDelete,
} from './photos';
import { rejectLocalPublish } from './publish';
import { asSyncError, call, rpc, type PgResult, type Thenable } from './rpc';
import { establishSession } from './session';
import { backendStatus } from './status';
import { classifyError, errorMessage, retryAfterMs, rpcFor, tolerated, type SyncError } from './syncRpc';

export { RPC_TIMEOUT_MS } from './rpc';
export { classifyError, errorMessage, rpcFor, type ErrorKind, type SyncError } from './syncRpc';

const DEBOUNCE_MS = 300;
const INTERVAL_MS = 60_000;
/** Ekran Nagroda / wypłata zadań po „Zbieram dalej” – ponawiamy przyjęcie stanu po chwili. */
const DEFER_RETRY_MS = 2_000;
/** Dłużej niż tyle czekające nagrody (np. aplikacja zamknięta na ekranie Nagroda) nie blokują stanu z serwera. */
const PENDING_REWARDS_GRACE_MS = 10_000;
/** Chwilowy błąd bazy (zakleszczenie, brak funkcji po migracji) – po tylu próbach zdarzenie wypada z kolejki. */
const MAX_SERVER_ATTEMPTS = 10;

/* ───────────────────────── Wywołania serwera ───────────────────────── */

const HANDLE_RE = /^[a-z0-9._]{3,24}$/;

/**
 * Profil: nick/imię, gmina domowa i motyw avatara osobno – gmina spoza słownika (klucz obcy), zajęty nick
 * albo baza bez kolumny `avatar_preset` nie blokują pozostałych zmian. Błąd sieci → ponowienie całości
 * (update jest idempotentny).
 */
async function sendProfile(p: ProfileUpdatePayload, userId: string): Promise<SyncError | null> {
  const row: Record<string, string> = { display_name: p.displayName, first_name: p.firstName };
  if (HANDLE_RE.test(p.handle)) row.handle = p.handle;
  const errors: SyncError[] = [];
  const steps: Record<string, string | null>[] = [
    row,
    ...(p.homeGminaId ? [{ home_gmina_id: p.homeGminaId }] : []),
    // Motyw avatara widzą inni (zdjęcie zostaje w telefonie do czasu Storage). Zdarzenia sprzed etapu 3 go nie mają.
    ...(p.avatarPreset !== undefined ? [{ avatar_preset: p.avatarPreset }] : []),
  ];
  for (const values of steps) {
    const r = await call(() => supabase!.from('profiles').update(values).eq('id', userId) as unknown as Thenable<PgResult>);
    if (!r.error) continue;
    if (classifyError(r.error) !== 'permanent') return r.error;
    errors.push(r.error);
  }
  if (!errors.length) return null;
  return { ...errors[0], message: errors.map(errorMessage).join(' · ') };
}

async function send(item: OutboxItem, userId: string): Promise<SyncError | null> {
  switch (item.type) {
    case 'profile.update':
      return sendProfile(item.payload, userId);
    case 'trip.publish':
      return sendPublish(item, userId);
    case 'photo.find':
      return sendFindPhoto(item.payload.findId, userId);
    case 'photo.avatar':
      return sendAvatarPhoto(item.payload, userId);
    case 'photo.delete':
      return sendStorageDelete(item.payload);
  }
  const c = rpcFor(item);
  if (!c) return null;
  const r = await rpc(c.fn, c.params);
  if (r.error && tolerated(item, r.error)) return null;
  return r.error;
}

/* ───────────────────────── Silnik ───────────────────────── */

export type SyncReason = 'enqueue' | 'connect' | 'appActive' | 'interval' | 'retry' | 'manual';

export interface SyncReport {
  sent: number;
  dropped: number;
  remaining: number;
  hydrate: 'applied' | 'skipped' | 'deferred' | 'error' | 'offline' | 'blocked' | 'none';
  mode?: MergeMode;
  error?: string;
}

let started = false;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryAt = 0;
let intervalTimer: ReturnType<typeof setInterval> | null = null;
let appStateSub: NativeEventSubscription | null = null;
let unsubKick: (() => void) | null = null;
let lock: Promise<unknown> = Promise.resolve();
let pendingReq: { reason: SyncReason; promise: Promise<SyncReport> } | null = null;
let pendingRewardsSince: number | null = null;
let connectFailures = 0;
let nextConnectAt = 0;
/** Toast o limicie serwera – raz na uruchomienie aplikacji, bez zasypywania gracza. */
let rateLimitToastShown = false;
let hydrateFailures = 0;

const ob = () => useOutboxStore.getState();
const nowIso = () => new Date().toISOString();

/** Jedno zadanie naraz (synchronizacja, akcje panelu /dev). */
function exclusive<T>(task: () => Promise<T>): Promise<T> {
  const p = lock.then(task, task);
  lock = p.catch(() => {});
  return p;
}

/**
 * Zadanie pod blokadą silnika (konto: logowanie na inne, wylogowanie, usunięcie) – w tym czasie kolejka nic nie
 * wysyła, więc zdarzenia jednego konta nie trafią z sesją drugiego. Czeka na wczytanie store'ów.
 */
export function withSyncLock<T>(task: () => Promise<T>): Promise<T> {
  return exclusive(async () => {
    await whenReady();
    return task();
  });
}

function scheduleRetry(ms: number) {
  const at = Date.now() + ms;
  if (retryTimer && retryAt <= at) return;
  if (retryTimer) clearTimeout(retryTimer);
  retryAt = at;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void requestSync('retry');
  }, ms);
}

/** Store'y z AsyncStorage (gra, kolejka) i słowniki muszą być wczytane – inaczej nadpisalibyśmy zapis. */
function whenReady(): Promise<void> {
  const persisted = [useOutboxStore, useUserStore, useTripStore];
  const ready = () => persisted.every((s) => s.persist.hasHydrated()) && useCatalogStore.getState().ready;
  if (ready()) return Promise.resolve();
  return new Promise((resolve) => {
    const check = () => {
      if (!ready()) return;
      unsubs.forEach((u) => u());
      resolve();
    };
    const unsubs = [...persisted.map((s) => s.persist.onFinishHydration(check)), useCatalogStore.subscribe(check)];
    check();
  });
}

/** Sesja do zapytań. Bez niej (np. pierwsze uruchomienie offline) próbujemy ją założyć – z przerwami. */
async function ensureOnline(reason: SyncReason): Promise<string | null> {
  const st = backendStatus();
  if (st.state === 'online' && st.userId) return st.userId;
  if (st.state === 'connecting') return null; // connect() sam poprosi o synchronizację
  const force = reason === 'manual' || reason === 'appActive';
  if (!force && Date.now() < nextConnectAt) return null;
  if (await establishSession()) {
    connectFailures = 0;
    return backendStatus().userId;
  }
  connectFailures += 1;
  const wait = backoffMs(connectFailures);
  nextConnectAt = Date.now() + wait;
  scheduleRetry(wait);
  return null;
}

/** Odmowy `submit_find` dotyczące podpisanego rozpoznania (P0001 / P0002) – znalezisko nie powstanie na serwerze. */
const RECOGNITION_REJECT = /^recognition_/;

/**
 * `find.submit` trwale odrzucony z powodu rozpoznania: toast z polskim opisem serwera, zależne zdarzenia tego
 * znaleziska (odbiór, zdjęcie, porzucenie) wypadają z kolejki, a znalezisko zostaje w telefonie oznaczone
 * `serverRejected` (niezweryfikowane). Inaczej `find.claim` dostałby find_not_found, a scalenie stanu z serwera
 * usunęłoby odebrane znalezisko bez słowa.
 */
export function rejectLocalFind(findId: string, err: SyncError) {
  const reason = err.details?.trim() || 'Serwer nie potwierdził rozpoznania tego znaleziska.';
  ob()
    .items.filter((x) => x.type !== 'find.submit' && 'findId' in x.payload && x.payload.findId === findId)
    .forEach((x) => ob().remove(x.id));
  const ts = useTripStore.getState();
  const f = ts.finds[findId];
  if (f) ts.upsertFind({ ...f, verified: false, sizeVerified: false, serverRejected: { code: err.message, reason, at: nowIso() } });
  ui.toast(`Znalezisko nie trafiło na serwer: ${reason}`, 'cloud_off');
}

/** Wysyła kolejkę po kolei. true = pusta. */
async function drain(reason: SyncReason, uid: string, report: SyncReport): Promise<boolean> {
  const ignoreBackoff = reason === 'manual' || reason === 'connect' || reason === 'appActive';
  let userId = uid;
  let sessionRenewed = false;
  for (;;) {
    const { item, waitMs } = headDue(ob().items, Date.now(), ignoreBackoff);
    if (!item) {
      if (waitMs > 0) scheduleRetry(waitMs);
      return waitMs === 0;
    }
    ob().setInFlight(item.id);
    const err = await send(item, userId).catch((e: unknown) => asSyncError(e));
    ob().setInFlight(null);
    if (!err) {
      ob().remove(item.id);
      ob().patch({ lastSyncAt: nowIso() });
      // Wpis „wysyłanie…” jest już na serwerze – feed pobiera listę od nowa i podmienia go na wpis z serwera.
      if (item.type === 'trip.publish') useFeedSync.getState().markStale();
      report.sent += 1;
      continue;
    }
    const kind = classifyError(err);
    const msg = errorMessage(err);
    if (kind === 'permanent' || (kind === 'server' && item.attempts + 1 >= MAX_SERVER_ATTEMPTS)) {
      ob().fail(item.id, msg);
      backendStatus().set({ error: `Synchronizacja (${EVENT_LABEL[item.type]}): ${msg}` });
      // Profil to jedyna zmiana, którą gracz wpisuje sam – mówimy mu, że serwer jej nie przyjął
      // (następne pobranie stanu przywróci wartości z serwera).
      if (item.type === 'profile.update') {
        ui.toast(err.code === '23505' ? 'Ten nick jest już zajęty – zmień go w profilu' : 'Serwer nie przyjął zmian profilu', 'error');
      }
      if (item.type === 'photo.avatar') ui.toast('Serwer nie przyjął zdjęcia profilowego – inni widzą poprzedni avatar', 'error');
      // Publikacja odrzucona (np. koniec wyprawy nie dotarł na serwer) – wpis znika z feedu, można spróbować ponownie.
      if (item.type === 'trip.publish') rejectLocalPublish(item.payload.tripId);
      // Podpisane rozpoznanie odrzucone (wygasło, zużyte, nieznane, wymagane) – znalezisko zostaje oznaczone w telefonie.
      if (item.type === 'find.submit' && RECOGNITION_REJECT.test(err.message)) rejectLocalFind(item.payload.findId, err);
      // Wyzwanie zakończyło się, zanim przyjęcie dotarło na serwer – zniknie z zadań przy pobraniu stanu.
      if (item.type === 'challenge.accept' && err.message.includes('challenge_inactive')) {
        ui.toast('To wyzwanie gminy już się zakończyło', 'flag');
      }
      // Uszczelnienia: gmina spoza domowej / obserwowanych albo limit aktywnych – powód po polsku z serwera (`detail`).
      if (item.type === 'challenge.accept' && /challenge_(not_allowed|limit)/.test(err.message)) {
        ui.toast(err.details || 'Serwer nie przyjął wyzwania gminy', 'flag');
      }
      report.dropped += 1;
      continue;
    }
    // Limit serwera: kolejka (FIFO) czeka do terminu z serwera; raz na przebieg informujemy gracza.
    if (kind === 'rate_limited') {
      const wait = retryAfterMs(err);
      ob().defer(item.id, msg, Date.now() + wait);
      scheduleRetry(wait);
      if (!rateLimitToastShown) {
        rateLimitToastShown = true;
        ui.toast('Serwer chwilowo ogranicza zapisy – dokończymy synchronizację później', 'schedule');
      }
      report.error = msg;
      return false;
    }
    // Brak / wygasła sesja (28000, JWT): raz na przebieg zakładamy sesję od nowa i ponawiamy od razu.
    if (kind === 'auth' && !sessionRenewed) {
      sessionRenewed = true;
      if (await establishSession()) {
        userId = backendStatus().userId ?? userId;
        continue;
      }
    }
    ob().markAttempt(item.id, msg);
    const next = ob().items.find((x) => x.id === item.id)?.nextAttemptAt;
    scheduleRetry(next ? Math.max(0, next - Date.now()) : 5_000);
    report.error = msg;
    return false;
  }
}

/** Czy przyjęcie stanu trzeba odłożyć (ekran Nagroda, nagrody czekające na „Zbieram dalej”). */
function hydrationBlocked(): boolean {
  if (hydrationHeld()) {
    // Po zejściu z ekranu Nagroda nagrody wypłaca „Zbieram dalej” – okres karencji liczymy od nowa.
    pendingRewardsSince = null;
    return true;
  }
  const u = useUserStore.getState();
  if (!u.pendingAchievements.length && !u.quests.pendingRewards.length) {
    pendingRewardsSince = null;
    return false;
  }
  pendingRewardsSince ??= Date.now();
  return Date.now() - pendingRewardsSince < PENDING_REWARDS_GRACE_MS;
}

/** `get_game_state()` → store'y, o ile kolejka nadal jest pusta i nic lokalnie nie czeka na wyświetlenie. */
async function hydrate(mode: HydrateMode, report: SyncReport): Promise<void> {
  if (hydrationBlocked()) {
    report.hydrate = 'deferred';
    // Zwolnienie ekranu Nagroda samo prosi o synchronizację; czekające nagrody – sprawdzamy co chwilę.
    if (!hydrationHeld()) scheduleRetry(DEFER_RETRY_MS);
    return;
  }
  const rev = outboxRevision();
  const r = await rpc('get_game_state');
  if (r.error) {
    report.hydrate = 'error';
    report.error = errorMessage(r.error);
    backendStatus().set({ error: `Stan gry: ${report.error}` });
    hydrateFailures += 1;
    const kind = classifyError(r.error);
    if (kind === 'auth') await establishSession();
    if (kind !== 'permanent') scheduleRetry(backoffMs(hydrateFailures));
    return;
  }
  hydrateFailures = 0;
  // W trakcie zapytania gracz coś zrobił → ten stan jest już nieaktualny (kolejka wyśle zdarzenie i pobierze nowy).
  if (ob().items.length || outboxRevision() !== rev) {
    report.hydrate = 'skipped';
    return;
  }
  if (hydrationBlocked()) {
    report.hydrate = 'deferred';
    if (!hydrationHeld()) scheduleRetry(DEFER_RETRY_MS);
    return;
  }
  applyState(r.data, mode, report);
}

function applyState(data: unknown, mode: HydrateMode, report: SyncReport) {
  try {
    report.mode = applyGameState(parseGameState(data), mode);
    report.hydrate = 'applied';
    const st = backendStatus();
    if (st.error?.startsWith('Stan gry')) st.set({ error: null });
    // Zdjęcia znalezisk z serwera, których nie ma w telefonie (nowe urządzenie, reinstalacja) – w tle.
    void restoreFindPhotos();
  } catch (e) {
    report.hydrate = 'error';
    report.error = e instanceof Error ? e.message : String(e);
    backendStatus().set({ error: `Stan gry: ${report.error}` });
  }
}

async function run(reason: SyncReason, mode: HydrateMode = 'auto'): Promise<SyncReport> {
  const report: SyncReport = { sent: 0, dropped: 0, remaining: 0, hydrate: 'none' };
  await whenReady();
  const userId = await ensureOnline(reason);
  if (!userId) {
    report.hydrate = 'offline';
    report.remaining = ob().items.length;
    return report;
  }
  const empty = await drain(reason, userId, report);
  report.remaining = ob().items.length;
  if (!empty) {
    report.hydrate = 'blocked';
    return report;
  }
  await hydrate(mode, report);
  return report;
}

async function runSafe(reason: SyncReason, mode: HydrateMode = 'auto'): Promise<SyncReport> {
  try {
    return await run(reason, mode);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    backendStatus().set({ error: `Synchronizacja: ${error}` });
    return { sent: 0, dropped: 0, remaining: ob().items.length, hydrate: 'error', error };
  }
}

/**
 * Prośba o synchronizację: wysyła kolejkę, a gdy jest pusta – pobiera stan z serwera.
 * Najwyżej jedno przebieganie naraz + jedno oczekujące (kolejne prośby się z nim łączą). Nie rzuca.
 */
export function requestSync(reason: SyncReason = 'manual'): Promise<SyncReport> {
  if (!supabase) return Promise.resolve({ sent: 0, dropped: 0, remaining: 0, hydrate: 'none' });
  if (pendingReq) {
    if (reason !== 'enqueue' && reason !== 'interval' && reason !== 'retry') pendingReq.reason = reason;
    return pendingReq.promise;
  }
  const req = { reason } as { reason: SyncReason; promise: Promise<SyncReport> };
  req.promise = exclusive(() => {
    pendingReq = null;
    return runSafe(req.reason);
  });
  pendingReq = req;
  return req.promise;
}

function onKick() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void requestSync('enqueue');
  }, DEBOUNCE_MS);
}

function onAppState(state: AppStateStatus) {
  if (state === 'active') void requestSync('appActive');
}

/** Start wyzwalaczy (raz, z createSupabaseServices().init()). */
export function startSync() {
  if (started || !supabase) return;
  started = true;
  unsubKick = onOutboxKick(onKick);
  appStateSub = AppState.addEventListener('change', onAppState);
  intervalTimer = setInterval(() => {
    if (ob().items.length) void requestSync('interval');
  }, INTERVAL_MS);
}

/** Zatrzymuje wyzwalacze i timery (testy). */
export function stopSync() {
  started = false;
  unsubKick?.();
  unsubKick = null;
  appStateSub?.remove();
  appStateSub = null;
  if (intervalTimer) clearInterval(intervalTimer);
  if (debounceTimer) clearTimeout(debounceTimer);
  if (retryTimer) clearTimeout(retryTimer);
  intervalTimer = debounceTimer = retryTimer = null;
  pendingReq = null;
  pendingRewardsSince = null;
  connectFailures = 0;
  nextConnectAt = 0;
  hydrateFailures = 0;
  lock = Promise.resolve();
}

/* ───────────────────────── Panel /dev ───────────────────────── */

export interface DevResult {
  ok: boolean;
  message: string;
}

const DEV_DISABLED = 'Narzędzia dev są wyłączone na serwerze (app_config.dev_tools ≠ true – lokalnie włącza je seed.sql).';

function devError(e: SyncError): DevResult {
  if (e.message.includes('dev_tools_disabled')) return { ok: false, message: DEV_DISABLED };
  if (e.code === 'PGRST202') return { ok: false, message: `Serwer nie ma tej funkcji – wgraj migrację etapu 2 (${e.message})` };
  return { ok: false, message: errorMessage(e) };
}

const describe = (r: SyncReport): string => {
  const parts = [`wysłano ${r.sent}`];
  if (r.dropped) parts.push(`odrzucono ${r.dropped}`);
  if (r.remaining) parts.push(`w kolejce ${r.remaining}`);
  const h: Record<SyncReport['hydrate'], string> = {
    applied: r.mode === 'replace' ? 'stan z serwera przyjęty (nowe powiązanie)' : 'stan z serwera przyjęty',
    skipped: 'stan z serwera pominięty (nowe zdarzenia)',
    deferred: 'stan z serwera odłożony (nagroda na ekranie)',
    error: `błąd: ${r.error ?? ''}`,
    offline: 'brak połączenia z serwerem',
    blocked: `kolejka czeka (${r.error ?? 'błąd sieci'})`,
    none: '',
  };
  return [parts.join(' · '), h[r.hydrate]].filter(Boolean).join(' – ');
};

/** „Synchronizuj teraz”: kolejka (bez czekania na backoff) + stan z serwera. */
export async function devSyncNow(): Promise<DevResult> {
  const r = await requestSync('manual');
  return { ok: r.hydrate === 'applied' || (r.remaining === 0 && r.hydrate !== 'error'), message: describe(r) };
}

/** `{storagePaths}` z odpowiedzi akcji dev / `prepare_account_deletion` (obiekt albo JSON w tekście). */
export function storagePathsOf(data: unknown): unknown {
  let d = data;
  if (typeof d === 'string') {
    try {
      d = JSON.parse(d) as unknown;
    } catch {
      return null;
    }
  }
  return d && typeof d === 'object' && !Array.isArray(d) ? (d as { storagePaths?: unknown }).storagePaths : null;
}

/**
 * Wynik akcji dev (stan gracza z serwera) → store'y jak przy pierwszym powiązaniu. Onboarding zostaje, jak był –
 * import gracza demo / reset to narzędzia dev, nie nowe konto.
 */
async function devReplace(fn: string, params?: Record<string, unknown>): Promise<DevResult> {
  return exclusive(async () => {
    await whenReady();
    const userId = await ensureOnline('manual');
    if (!userId) return { ok: false, message: 'Brak połączenia z serwerem' };
    const report: SyncReport = { sent: 0, dropped: 0, remaining: 0, hydrate: 'none' };
    await drain('manual', userId, report);
    const r = await rpc(fn, params, 20_000);
    if (r.error) return devError(r.error);
    // Gracz na serwerze zaczyna od nowa – zdarzenia sprzed resetu (jeśli zostały) nie mają już sensu.
    if (ob().items.length) ob().drop('porzucone: reset gracza w panelu /dev');
    // Pliki skasowanego gracza w Storage (dev_reset_player → storagePaths: zdjęcia znalezisk, okładki, zdjęcie profilowe).
    const removed = await deleteServerObjects(storagePathsOf(r.data));
    const onboarded = useUserStore.getState().onboarded;
    applyState(r.data, 'replace', report);
    if (report.hydrate !== 'applied') return { ok: false, message: report.error ?? 'Nie udało się przyjąć stanu' };
    if (onboarded) useUserStore.getState().patch({ onboarded: true });
    const u = useUserStore.getState().user;
    const photos = removed
      ? removed.error
        ? ` · zdjęcia: ${removed.error}`
        : ` · usunięto zdjęć z serwera: ${removed.deleted}`
      : '';
    return { ok: true, message: `Gracz ${u.name} (${u.handle}) · Lv ${u.level} · ${u.xp} XP${photos}` };
  });
}

/** „Wgraj gracza demo”: Kuba Nowak, Lv 14 z mocków (do porównań z makietą). */
export function devImportDemoPlayer(): Promise<DevResult> {
  return devReplace('dev_import_state', { p_state: buildImportState(initialUserState()) });
}

/** „Nowy gracz (reset na serwerze)”: Lv 1, pusty atlas – nick, imię i gmina zostają. */
export function devResetPlayer(): Promise<DevResult> {
  return devReplace('dev_reset_player');
}

/** „Pobierz stan z serwera”: wysyła kolejkę i przyjmuje stan (bez odkładania przez czekające nagrody). */
export function devPullState(): Promise<DevResult> {
  return exclusive(async () => {
    await whenReady();
    const userId = await ensureOnline('manual');
    if (!userId) return { ok: false, message: 'Brak połączenia z serwerem' };
    const report: SyncReport = { sent: 0, dropped: 0, remaining: 0, hydrate: 'none' };
    if (!(await drain('manual', userId, report))) {
      return { ok: false, message: `Kolejka nie wysłana (${report.error ?? 'błąd'}) – stan z serwera pominięty` };
    }
    const r = await rpc('get_game_state');
    if (r.error) return devError(r.error);
    if (ob().items.length) return { ok: false, message: 'W międzyczasie doszły zdarzenia – spróbuj ponownie' };
    applyState(r.data, 'auto', report);
    return { ok: report.hydrate === 'applied', message: describe(report) };
  });
}

/* ───────────────────────── Zmiana konta ───────────────────────── */

export interface SwitchResult {
  ok: boolean;
  /** Konto po zmianie (ok) – null, gdy nowej sesji nie udało się jeszcze założyć (brak sieci). */
  userId: string | null;
  /** To samo konto co przed zmianą (np. logowanie na adres, na którym już jesteś) – stan lokalny bez zmian. */
  sameAccount: boolean;
  /** Stan nowego konta przyjęty od razu; false = przyjmie go następna synchronizacja (tryb `replace`). */
  hydrated: boolean;
  /** Błąd ustalania sesji (np. zły kod) – nic się nie zmieniło. */
  error?: unknown;
}

export interface SwitchOptions {
  /**
   * Ustala nową sesję (np. `verifyOtp`, wylogowanie). Rzuca → nic się nie zmienia (kolejka i stan zostają).
   * Bez sesji po nim – zakładamy nowe konto anonimowe.
   */
  establish: () => Promise<void>;
  /** Powód porzucenia zdarzeń starego konta (panel /dev → „Odrzucone”). */
  dropReason: string;
  /** Wyczyszczenie stanu lokalnego starego konta, zanim przyjmiemy stan nowego (np. resetAll + powiadomienia). */
  wipeLocal?: () => void;
}

/**
 * Zmiana konta pod blokadą silnika: nowa sesja → zdarzenia starego konta porzucone → stan lokalny wyczyszczony →
 * stan nowego konta z serwera jak przy pierwszym uruchomieniu (`replace` – w tym onboarding z `onboardedAt`).
 * Wspólne dla „Zaloguj się na inne konto”, „Wyloguj”, usunięcia konta i „Nowe konto” w panelu /dev. Nie rzuca.
 */
export function switchAccount(opts: SwitchOptions): Promise<SwitchResult> {
  return withSyncLock(() => switchAccountLocked(opts));
}

/** Jak switchAccount – dla wywołującego, który już trzyma blokadę (withSyncLock, np. usunięcie konta). */
export async function switchAccountLocked(opts: SwitchOptions): Promise<SwitchResult> {
  if (!supabase) return { ok: false, userId: null, sameAccount: false, hydrated: false, error: new Error('Supabase wyłączony') };
  const before = backendStatus().userId ?? ob().syncedUserId;
  try {
    await opts.establish();
  } catch (error) {
    return { ok: false, userId: before, sameAccount: false, hydrated: false, error };
  }
  backendStatus().set({ state: 'off', userId: null });
  const online = await establishSession();
  const userId = online ? backendStatus().userId : null;
  if (userId && userId === before) {
    // To samo konto (np. ponowne zalogowanie tym samym adresem) – kolejka i stan lokalny zostają.
    setTimeout(() => void requestSync('manual'), 0);
    return { ok: true, userId, sameAccount: true, hydrated: false };
  }
  if (ob().items.length) ob().drop(opts.dropReason);
  ob().patch({ localPosts: [] });
  opts.wipeLocal?.();
  resetPhotoSession();
  if (!userId) {
    // Bez sieci (np. wylogowanie offline): konto anonimowe powstanie przy następnej synchronizacji (`replace`).
    return { ok: true, userId: null, sameAccount: false, hydrated: false };
  }
  const r = await rpc('get_game_state');
  const report: SyncReport = { sent: 0, dropped: 0, remaining: 0, hydrate: 'none' };
  if (!r.error) applyState(r.data, 'replace', report);
  else backendStatus().set({ error: `Stan gry: ${errorMessage(r.error)}` });
  return { ok: true, userId, sameAccount: false, hydrated: report.hydrate === 'applied' };
}

/**
 * „Nowe konto”: wylogowanie (lokalnie), nowe konto anonimowe i stan z serwera jak przy pierwszym
 * uruchomieniu (świeży gracz). Niewysłane zdarzenia starego konta wypadają do `failed`.
 */
export async function devNewAccount(): Promise<DevResult> {
  if (!supabase) return { ok: false, message: 'Supabase wyłączony' };
  const onboarded = useUserStore.getState().onboarded;
  const r = await switchAccount({
    establish: async () => {
      await supabase!.auth.signOut({ scope: 'local' }).catch(() => {});
    },
    dropReason: 'porzucone: nowe konto w panelu /dev',
  });
  if (!r.ok || !r.userId) return { ok: false, message: backendStatus().error ?? 'Nie udało się utworzyć konta' };
  if (!r.hydrated) return { ok: false, message: backendStatus().error ?? 'Nie udało się przyjąć stanu' };
  // Narzędzie dev – bez onboardingu (nowe konto „naprawdę” przechodzi go po wylogowaniu w Ustawieniach → Konto).
  if (onboarded) useUserStore.getState().patch({ onboarded: true });
  return { ok: true, message: `Nowe konto ${r.userId.slice(0, 8)}… · ${useUserStore.getState().user.handle}` };
}

/** Czy serwer ma włączone narzędzia dev (null = nie wiadomo, np. brak sieci / stara baza). */
export async function devToolsEnabled(): Promise<boolean | null> {
  if (!supabase || backendStatus().state !== 'online') return null;
  const r = await rpc('dev_tools_enabled', undefined, 4_000);
  return r.error ? null : r.data === true;
}
