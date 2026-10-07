/**
 * Kolejka zdarzeń gry do serwera (tryb Supabase, local-first).
 *
 * Każda akcja gry liczy się od razu lokalnie (store'y + utils/xp.ts – UI natychmiast, działa offline
 * w lesie), a jej zdarzenie trafia tutaj. Silnik synchronizacji (services/supabase/sync.ts) wysyła
 * zdarzenia po kolei (FIFO), gdy jest sieć. Serwer jest źródłem prawdy: przy pustej kolejce aplikacja
 * przyjmuje jego stan (services/supabase/gameState.ts). W trybie mock kolejka jest wyłączona.
 *
 * Czyste funkcje (łączenie, kolejność, backoff) są eksportowane do testów.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type { Rarity, ScanPart, TripPost } from '@/types';
import { uuid } from '@/utils/random';
import { persistStorage, STORAGE_KEYS } from './storage';

export interface FindSubmitPayload {
  findId: string;
  tripId: string | null;
  gminaId: string;
  speciesId: string;
  rarity: Rarity;
  confidence: number;
  xxl: boolean;
  dimensions: { capCm: number; heightCm: number; weightG: number; ageDays: number; pieces?: number };
  candidates: { speciesId: string; confidence: number }[];
  parts: ScanPart[];
  foundAt: string;
}

/** Cały profil (ostatnia wersja wygrywa) – nick bez „@”. */
export interface ProfileUpdatePayload {
  displayName: string;
  firstName: string;
  handle: string;
  homeGminaId: string;
  /** Motyw avatara (`profiles.avatar_preset`); null = zdjęcie albo brak. Brak pola = zdarzenie sprzed etapu 3. */
  avatarPreset?: string | null;
}

/**
 * Publikacja wyprawy w feedzie (po `trip.finish` – kolejka jest FIFO). Okładkę (najlepsze znalezisko ze zdjęciem)
 * silnik wysyła do `post-media` tuż przed `publish_trip` – bajty czyta w chwili wysyłki, tu tylko id wyprawy.
 */
export interface TripPublishPayload {
  tripId: string;
  hideRoute: boolean;
  title?: string;
}

/** Zdjęcie profilowe – stan docelowy czyta silnik z profilu w chwili wysyłki (w kolejce tylko najnowsze). */
export interface AvatarPhotoPayload {
  /** Czy avatar to zdjęcie (false = motyw albo brak → `avatar_path = null`). Do panelu /dev. */
  photo: boolean;
  /** Znacznik czasu zmiany – nazwa pliku `avatar-{ts}.jpg` (stała przy ponowieniach, nowa przy kolejnej zmianie). */
  ts: number;
}

/** Usunięcie obiektów ze Storage (np. zdjęcie porzuconego znaleziska, które zdążyło się wysłać). */
export interface StorageDeletePayload {
  bucket: 'scan-photos' | 'post-media' | 'avatars';
  paths: string[];
}

export type OutboxEvent =
  | { type: 'trip.start'; payload: { tripId: string; gminaId: string; startedAt: string } }
  | { type: 'find.submit'; payload: FindSubmitPayload }
  | { type: 'find.claim'; payload: { findId: string } }
  | { type: 'find.discard'; payload: { findId: string } }
  | { type: 'trip.progress'; payload: { tripId: string; distanceM: number } }
  | { type: 'trip.finish'; payload: { tripId: string; distanceM: number; durationS: number; endedAt: string } }
  | { type: 'trip.publish'; payload: TripPublishPayload }
  | { type: 'profile.update'; payload: ProfileUpdatePayload }
  /** „Przyjmij wyzwanie” na ekranie gminy (id wyzwania z serwera). */
  | { type: 'challenge.accept'; payload: { challengeId: string; gminaId: string } }
  /** „Obserwuj” / „Obserwujesz” – stan docelowy (w kolejce tylko najnowszy per gmina). */
  | { type: 'gmina.follow'; payload: { gminaId: string; follow: boolean } }
  /** Zdjęcie znaleziska → `scan-photos` + `set_find_photo` (po `find.submit`; bajty czytane przy wysyłce). */
  | { type: 'photo.find'; payload: { findId: string } }
  /** Zdjęcie profilowe → `avatars` + `profiles.avatar_path` (albo null przy motywie / usunięciu). */
  | { type: 'photo.avatar'; payload: AvatarPhotoPayload }
  /** Sprzątanie Storage (best effort, ale przetrwa brak sieci). */
  | { type: 'photo.delete'; payload: StorageDeletePayload }
  /** Akceptacja regulaminu i polityki prywatności w onboardingu (`accept_terms`, wersja = LEGAL_VERSION). */
  | { type: 'terms.accept'; payload: { version: string } }
  /** Koniec onboardingu (`complete_onboarding`) – po profilu i regulaminie (FIFO). */
  | { type: 'onboarding.complete'; payload: { at: string } };

export type OutboxEventType = OutboxEvent['type'];

export interface OutboxMeta {
  id: string;
  createdAt: string;
  /** Nieudane próby wysłania (błąd sieci / serwera). */
  attempts: number;
  lastError?: string;
  /** Epoch ms – wcześniej silnik nie ponawia (backoff); „Synchronizuj teraz” to pomija. */
  nextAttemptAt?: number;
}

export type OutboxItem = OutboxEvent & OutboxMeta;

/** Zdarzenie odrzucone przez serwer (błąd trwały) – do panelu /dev. */
export interface FailedItem {
  item: OutboxItem;
  error: string;
  failedAt: string;
}

export const FAILED_LIMIT = 20;
/** Raport dystansu wyprawy najwyżej co tyle (końcowy dystans niesie `trip.finish`). */
export const PROGRESS_INTERVAL_MS = 60_000;
/** Backoff po kolejnych nieudanych próbach: 5 s, 15 s, 60 s, potem co 2 min. */
export const BACKOFF_MS = [5_000, 15_000, 60_000, 120_000];

export const backoffMs = (attempts: number) => BACKOFF_MS[Math.min(Math.max(attempts, 1), BACKOFF_MS.length) - 1];

export function makeItem(e: OutboxEvent, now = Date.now()): OutboxItem {
  return { ...e, id: uuid(), createdAt: new Date(now).toISOString(), attempts: 0 } as OutboxItem;
}

const findIdOf = (x: OutboxItem) => ('findId' in x.payload ? x.payload.findId : null);
const tripIdOf = (x: OutboxItem) => ('tripId' in x.payload ? x.payload.tripId : null);

/** Zdarzenia ze zdjęciami (licznik „Zdjęcia: X w kolejce” w panelu /dev). */
export const PHOTO_EVENT_TYPES: readonly OutboxEventType[] = ['photo.find', 'photo.avatar', 'photo.delete'];
export const isPhotoEvent = (x: Pick<OutboxItem, 'type'>) => PHOTO_EVENT_TYPES.includes(x.type);

/**
 * Dokłada zdarzenie do kolejki z regułami łączenia. `inFlightId` – element właśnie wysyłany:
 * nigdy go nie podmieniamy ani nie usuwamy (silnik usuwa go po odpowiedzi serwera).
 * - `trip.progress`: dystans jest narastający – czekający raport tej wyprawy dostaje nowszą wartość
 *   (zostaje na swoim miejscu, z licznikiem prób);
 * - `trip.finish`: niesie końcowy dystans, więc czekające raporty tej wyprawy wypadają;
 * - `profile.update`: zawsze cały profil – czekająca zmiana dostaje nowszą wersję;
 * - `find.discard`: znalezisko, które nie wyszło jeszcze z telefonu, po prostu znika z kolejki;
 * - `trip.publish`: czekająca publikacja tej samej wyprawy dostaje nowsze ustawienia (bez dubla);
 * - `gmina.follow`: liczy się stan docelowy – czekające zdarzenie tej gminy dostaje nowszy (obserwuj ↔ przestań);
 * - `challenge.accept`: drugie przyjęcie tego samego wyzwania (czekające) nic nie dokłada;
 * - `photo.find`: jedno na znalezisko (drugie czekające nic nie dokłada); porzucenie znaleziska usuwa czekające zdjęcie;
 * - `photo.avatar`: liczy się najnowszy avatar – czekające zdarzenie dostaje nowszą zmianę;
 * - `terms.accept`: ta sama wersja już czeka – nic nie dokłada; `onboarding.complete`: jedno w kolejce.
 */
export function enqueueItem(queue: OutboxItem[], item: OutboxItem, inFlightId: string | null = null): OutboxItem[] {
  const idle = (x: OutboxItem) => x.id !== inFlightId;
  const replaceAt = (i: number) => queue.map((x, j) => (j === i ? ({ ...x, payload: item.payload } as OutboxItem) : x));
  switch (item.type) {
    case 'trip.progress': {
      const i = queue.findIndex((x) => x.type === 'trip.progress' && tripIdOf(x) === item.payload.tripId && idle(x));
      return i >= 0 ? replaceAt(i) : [...queue, item];
    }
    case 'trip.finish':
      return [
        ...queue.filter((x) => !(x.type === 'trip.progress' && tripIdOf(x) === item.payload.tripId && idle(x))),
        item,
      ];
    case 'profile.update': {
      const i = queue.findIndex((x) => x.type === 'profile.update' && idle(x));
      return i >= 0 ? replaceAt(i) : [...queue, item];
    }
    case 'trip.publish': {
      const i = queue.findIndex((x) => x.type === 'trip.publish' && x.payload.tripId === item.payload.tripId && idle(x));
      return i >= 0 ? replaceAt(i) : [...queue, item];
    }
    case 'gmina.follow': {
      const i = queue.findIndex((x) => x.type === 'gmina.follow' && x.payload.gminaId === item.payload.gminaId && idle(x));
      return i >= 0 ? replaceAt(i) : [...queue, item];
    }
    case 'challenge.accept':
      return queue.some((x) => x.type === 'challenge.accept' && x.payload.challengeId === item.payload.challengeId && idle(x))
        ? queue
        : [...queue, item];
    case 'photo.find':
      return queue.some((x) => x.type === 'photo.find' && x.payload.findId === item.payload.findId && idle(x))
        ? queue
        : [...queue, item];
    case 'photo.avatar': {
      const i = queue.findIndex((x) => x.type === 'photo.avatar' && idle(x));
      return i >= 0 ? replaceAt(i) : [...queue, item];
    }
    case 'terms.accept':
      return queue.some((x) => x.type === 'terms.accept' && x.payload.version === item.payload.version && idle(x))
        ? queue
        : [...queue, item];
    case 'onboarding.complete':
      return queue.some((x) => x.type === 'onboarding.complete' && idle(x)) ? queue : [...queue, item];
    case 'find.discard': {
      const submit = queue.find((x) => x.type === 'find.submit' && x.payload.findId === item.payload.findId);
      if (submit && idle(submit)) return queue.filter((x) => findIdOf(x) !== item.payload.findId || !idle(x));
      // Skan już na serwerze: czekające zdjęcie porzuconego znaleziska nie ma po co wychodzić z telefonu.
      const rest = queue.filter((x) => !(x.type === 'photo.find' && x.payload.findId === item.payload.findId && idle(x)));
      return [...rest, item];
    }
    default:
      return [...queue, item];
  }
}

/** Nieudana próba: licznik, błąd i termin następnej (backoff). */
export function markAttempt(queue: OutboxItem[], id: string, error: string, now = Date.now()): OutboxItem[] {
  return queue.map((x) => {
    if (x.id !== id) return x;
    const attempts = x.attempts + 1;
    return { ...x, attempts, lastError: error, nextAttemptAt: now + backoffMs(attempts) };
  });
}

/** Odłożenie do konkretnej chwili (limit serwera) – bez zwiększania licznika prób. */
export function deferUntil(queue: OutboxItem[], id: string, error: string, until: number): OutboxItem[] {
  return queue.map((x) => (x.id === id ? { ...x, lastError: error, nextAttemptAt: until } : x));
}

/** Pierwszy element kolejki, o ile minął jego termin (FIFO – kolejne czekają za nim). */
export function headDue(queue: OutboxItem[], now = Date.now(), ignoreBackoff = false): { item: OutboxItem | null; waitMs: number } {
  const item = queue[0] ?? null;
  if (!item || ignoreBackoff || !item.nextAttemptAt || item.nextAttemptAt <= now) return { item, waitMs: 0 };
  return { item: null, waitMs: item.nextAttemptAt - now };
}

export function pushFailed(failed: FailedItem[], entry: FailedItem, limit = FAILED_LIMIT): FailedItem[] {
  return [entry, ...failed].slice(0, limit);
}

/** Etykieta zdarzenia do panelu /dev i komunikatów błędów. */
export const EVENT_LABEL: Record<OutboxEventType, string> = {
  'trip.start': 'start wyprawy',
  'find.submit': 'skan znaleziska',
  'find.claim': 'odbiór nagrody',
  'find.discard': 'porzucenie skanu',
  'trip.progress': 'dystans wyprawy',
  'trip.finish': 'koniec wyprawy',
  'trip.publish': 'publikacja wyprawy',
  'profile.update': 'profil',
  'challenge.accept': 'przyjęcie wyzwania',
  'gmina.follow': 'obserwowanie gminy',
  'photo.find': 'zdjęcie znaleziska',
  'photo.avatar': 'zdjęcie profilowe',
  'photo.delete': 'usunięcie zdjęć',
  'terms.accept': 'akceptacja regulaminu',
  'onboarding.complete': 'koniec onboardingu',
};

/* ───────────────────────── Sygnały dla silnika (bez zapisu) ───────────────────────── */

let enabled = false;
let revision = 0;
let holds = 0;
const kickListeners = new Set<() => void>();
/** Ostatni raport dystansu per wyprawa (throttling `trip.progress`). */
const lastProgressAt = new Map<string, number>();

/** Włącza kolejkę (tylko tryb Supabase – wywołuje createSupabaseServices). */
export function setOutboxEnabled(on: boolean) {
  enabled = on;
}

export const outboxEnabled = () => enabled;

/** Rośnie przy każdej zmianie kolejki – stan z serwera pobrany przed zmianą jest nieaktualny. */
export const outboxRevision = () => revision;

/** Silnik nasłuchuje: nowe zdarzenie / zwolnienie blokady → synchronizacja (z debounce). */
export function onOutboxKick(listener: () => void): () => void {
  kickListeners.add(listener);
  return () => kickListeners.delete(listener);
}

export function kickSync() {
  kickListeners.forEach((l) => l());
}

/**
 * Ekran Nagroda: wstrzymuje przyjęcie stanu z serwera, żeby liczby nie zmieniły się w trakcie animacji.
 * Zwraca funkcję zwalniającą (cleanup efektu), która od razu prosi o synchronizację.
 */
export function holdHydration(): () => void {
  holds += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds -= 1;
    kickSync();
  };
}

export const hydrationHeld = () => holds > 0;

/* ───────────────────────── Store ───────────────────────── */

export interface OutboxState {
  items: OutboxItem[];
  /** Ostatnie zdarzenia odrzucone przez serwer (najnowsze pierwsze). */
  failed: FailedItem[];
  /** Konto serwera, z którym powiązany jest stan lokalny (inne = pierwsze połączenie → stan z serwera). */
  syncedUserId: string | null;
  lastSyncAt: string | null;
  lastHydrateAt: string | null;
  /** Element właśnie wysyłany (bez zapisu). */
  inFlightId: string | null;
  /**
   * Własne wpisy opublikowane w telefonie (`trip.publish`), których feed z serwera jeszcze nie zwrócił –
   * feed pokazuje je na górze z adnotacją „wysyłanie…” (najnowsze pierwsze).
   */
  localPosts: TripPost[];

  enqueue: (e: OutboxEvent, opts?: { kick?: boolean }) => void;
  /** Dystans wyprawy (m, narastająco) – do kolejki najwyżej co PROGRESS_INTERVAL_MS. */
  enqueueTripProgress: (tripId: string, distanceM: number, now?: number) => void;
  remove: (id: string) => void;
  markAttempt: (id: string, error: string, now?: number) => void;
  /** Limit serwera: element czeka do `until` (epoch ms), licznik prób bez zmian. */
  defer: (id: string, error: string, until: number) => void;
  /** Błąd trwały: element wypada z kolejki do `failed`. */
  fail: (id: string, error: string) => void;
  /** Usuwa całą kolejkę (np. nowe konto w panelu /dev) – elementy trafiają do `failed`. */
  drop: (reason: string) => void;
  setInFlight: (id: string | null) => void;
  /** Wpis czekający na serwer (ta sama wyprawa = podmiana). */
  addLocalPost: (post: TripPost) => void;
  /** Usuwa czekające wpisy tych wypraw (serwer je zwrócił albo odrzucił publikację). */
  removeLocalPosts: (tripIds: string[]) => void;
  patch: (p: Partial<Pick<OutboxState, 'syncedUserId' | 'lastSyncAt' | 'lastHydrateAt' | 'localPosts'>>) => void;
  reset: () => void;
}

const initial = {
  items: [] as OutboxItem[],
  failed: [] as FailedItem[],
  syncedUserId: null as string | null,
  lastSyncAt: null as string | null,
  lastHydrateAt: null as string | null,
  inFlightId: null as string | null,
  localPosts: [] as TripPost[],
};

export const useOutboxStore = create<OutboxState>()(
  persist(
    (set, get) => ({
      ...initial,
      enqueue: (e, opts) => {
        if (!enabled) return;
        revision += 1;
        set({ items: enqueueItem(get().items, makeItem(e), get().inFlightId) });
        if (opts?.kick !== false) kickSync();
      },
      enqueueTripProgress: (tripId, distanceM, now = Date.now()) => {
        if (!enabled) return;
        const last = lastProgressAt.get(tripId);
        if (last != null && now - last < PROGRESS_INTERVAL_MS) return;
        lastProgressAt.set(tripId, now);
        get().enqueue({ type: 'trip.progress', payload: { tripId, distanceM } });
      },
      remove: (id) => set({ items: get().items.filter((x) => x.id !== id) }),
      markAttempt: (id, error, now) => set({ items: markAttempt(get().items, id, error, now) }),
      defer: (id, error, until) => set({ items: deferUntil(get().items, id, error, until) }),
      fail: (id, error) => {
        const item = get().items.find((x) => x.id === id);
        if (!item) return;
        set({
          items: get().items.filter((x) => x.id !== id),
          failed: pushFailed(get().failed, { item, error, failedAt: new Date().toISOString() }),
        });
      },
      drop: (reason) => {
        revision += 1;
        const at = new Date().toISOString();
        const failed = get().items.reduce((acc, item) => pushFailed(acc, { item, error: reason, failedAt: at }), get().failed);
        // Wpisy czekające na serwer należały do porzuconych zdarzeń (np. inne konto).
        set({ items: [], failed, inFlightId: null, localPosts: [] });
      },
      setInFlight: (id) => set({ inFlightId: id }),
      addLocalPost: (post) => set({ localPosts: [post, ...get().localPosts.filter((p) => p.tripId !== post.tripId)] }),
      removeLocalPosts: (tripIds) => {
        if (!get().localPosts.some((p) => p.tripId && tripIds.includes(p.tripId))) return;
        set({ localPosts: get().localPosts.filter((p) => !p.tripId || !tripIds.includes(p.tripId)) });
      },
      patch: (p) => set(p),
      reset: () => {
        revision += 1;
        lastProgressAt.clear();
        set({ ...initial });
      },
    }),
    {
      name: STORAGE_KEYS.outbox,
      storage: persistStorage,
      version: 1,
      partialize: (s) => ({
        items: s.items,
        failed: s.failed,
        syncedUserId: s.syncedUserId,
        lastSyncAt: s.lastSyncAt,
        lastHydrateAt: s.lastHydrateAt,
        localPosts: s.localPosts,
      }),
    },
  ),
);
