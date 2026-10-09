/**
 * Czysta część synchronizacji: zdarzenie z kolejki → wywołanie RPC (kontrakt z docs/backend.md)
 * i klasyfikacja błędów serwera. Bez zależności od React Native – testy i skrypty node.
 */
import type { OutboxItem } from '@/store/useOutboxStore';

export interface SyncError {
  /** Stabilny kod błędu biznesowego („trip_not_found”) albo opis błędu sieci. */
  message: string;
  /** Kod Postgresa / PostgREST ('P0001', 'PGRST202'…); '' = brak odpowiedzi serwera. */
  code: string;
  /** Status HTTP; 0 = brak sieci / przerwane. */
  status: number;
  /** Polskie wyjaśnienie z serwera (`detail` / `hint`). */
  details?: string;
  /** Podpowiedź serwera, np. `retry_after=<ISO>` przy limicie (etap 7). */
  hint?: string;
}

/**
 * - `network` – brak sieci, limit czasu, bramka bez odpowiedzi bazy (5xx bez kodu): ponawiamy bez końca;
 * - `auth` – brak / wygasła sesja (28000, JWT): sesja od nowa i ponowienie;
 * - `server` – chwilowe po stronie bazy (zakleszczenie 40P01, konflikt serializacji, limit czasu zapytania,
 *   PostgREST bez połączenia z bazą, funkcja jeszcze nie wdrożona – PGRST202): ponawiamy z limitem prób;
 * - `rate_limited` – limit tempa serwera (P0001 rate_limited): zdarzenie czeka do `retry_after` i idzie ponownie;
 * - `permanent` – wszystko inne, m.in. błędy biznesowe P0001 / P0002 (unknown_gmina, trip_not_found,
 *   low_confidence…), walidacja, klucze: zdarzenie wypada z kolejki.
 */
export type ErrorKind = 'network' | 'auth' | 'server' | 'rate_limited' | 'permanent';

/** Domyślne odłożenie zdarzenia przy limicie serwera bez podanego terminu. */
export const RATE_LIMIT_DEFER_MS = 10 * 60_000;

/**
 * Termin ponowienia po `rate_limited` (etap 7): `hint` = `retry_after=<ISO>`; bez niego – za 10 min.
 * Termin z serwera przycinamy do [30 s, 24 h], żeby zły zegar nie zablokował kolejki na zawsze.
 */
export function retryAfterMs(e: SyncError, now = Date.now()): number {
  const m = /retry_after=([^\s,;]+)/.exec(e.hint ?? '') ?? /retry_after=([^\s,;]+)/.exec(e.details ?? '');
  const at = m ? Date.parse(m[1]) : NaN;
  const wait = Number.isFinite(at) ? at - now : RATE_LIMIT_DEFER_MS;
  return Math.min(24 * 3_600_000, Math.max(30_000, wait));
}

export function classifyError(e: SyncError): ErrorKind {
  const code = e.code ?? '';
  // Limit tempa (etap 7): zdarzenie jest poprawne, tylko za wcześnie – odkładamy zamiast wyrzucać,
  // inaczej po pobraniu stanu z serwera gracz straciłby np. znalezisko z kolejki offline.
  if (code === 'P0001' && e.message === 'rate_limited') return 'rate_limited';
  if (!code) {
    if (!e.status || e.status >= 500 || e.status === 408 || e.status === 429) return 'network';
    if (e.status === 401) return 'auth';
    return 'permanent';
  }
  if (code === '28000' || code === 'PGRST301' || code === 'PGRST302' || code === 'PGRST303') return 'auth';
  if (code === '40P01' || code === '40001' || code === '57014' || code === 'PGRST202' || /^PGRST00\d$/.test(code)) return 'server';
  // Storage bez koszyka (migracja etapu 5 jeszcze niewgrana) – jak brak funkcji: ponawiamy z limitem prób.
  if (code === 'storage_unavailable') return 'server';
  return 'permanent';
}

export function errorMessage(e: SyncError): string {
  const base = e.message || (e.status ? `HTTP ${e.status}` : 'Brak odpowiedzi serwera');
  return e.details && e.details !== e.message && e.code ? `${base} (${e.details})` : base;
}

/** Odpowiedzi, które dla danego zdarzenia znaczą „nie ma czego robić” – nie zaśmiecają listy błędów. */
export function tolerated(item: OutboxItem, e: SyncError): boolean {
  // Raport dystansu wyprawy, której serwer nie zna (jej start odrzucono) – bez znaczenia.
  if (item.type === 'trip.progress' && e.code === 'P0002') return true;
  // Serwer sprzed etapu 6 (bez accept_terms / complete_onboarding) – nie ma gdzie tego zapisać, a kolejka gry
  // nie powinna na to czekać (FIFO); gracz i tak przeszedł onboarding w telefonie.
  return (item.type === 'terms.accept' || item.type === 'onboarding.complete') && e.code === 'PGRST202';
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, Number.isFinite(v) ? v : min));

/**
 * Zdarzenie → funkcja RPC i jej parametry. `profile.update` idzie osobno (update tabeli `profiles`), zdjęcia – przez
 * Storage (./photos.ts), a `trip.publish` dostaje jeszcze `p_cover_path`, gdy okładka zdążyła się wysłać.
 */
export function rpcFor(item: OutboxItem): { fn: string; params: Record<string, unknown> } | null {
  switch (item.type) {
    case 'trip.start':
      return {
        fn: 'start_trip',
        params: { p_gmina_id: item.payload.gminaId, p_trip_id: item.payload.tripId, p_started_at: item.payload.startedAt },
      };
    case 'find.submit': {
      const p = item.payload;
      const d = p.dimensions;
      return {
        fn: 'submit_find',
        params: {
          p_find_id: p.findId,
          p_trip_id: p.tripId,
          p_gmina_id: p.gminaId,
          p_species_id: p.speciesId,
          p_rarity: p.rarity,
          p_confidence: clamp(p.confidence, 0, 1),
          p_xxl: p.xxl,
          // Wynik rozpoznania z mocka – w granicach walidacji serwera (wysokość ≤ 100 cm, wiek ≤ 365 dni, ≥ 0).
          p_dimensions: {
            cap_cm: clamp(d.capCm, 0, 999),
            height_cm: clamp(d.heightCm, 0, 100),
            weight_g: Math.round(clamp(d.weightG, 0, 1e6)),
            age_days: Math.round(clamp(d.ageDays, 0, 365)),
            ...(d.pieces != null ? { pieces: Math.round(clamp(d.pieces, 0, 9999)) } : {}),
          },
          p_candidates: (p.candidates ?? []).map((c) => ({ species_id: c.speciesId, confidence: clamp(c.confidence, 0, 1) })),
          p_parts: p.parts ?? [],
          p_found_at: p.foundAt,
          // Podpisane rozpoznanie – tylko gdy jest (starszy serwer bez parametru przyjmuje resztę jak dotąd).
          ...(p.recognitionId ? { p_recognition_id: p.recognitionId } : {}),
        },
      };
    }
    case 'find.claim':
      return { fn: 'claim_find', params: { p_find_id: item.payload.findId } };
    case 'find.discard':
      return { fn: 'discard_find', params: { p_find_id: item.payload.findId } };
    case 'trip.progress':
      return { fn: 'report_trip_progress', params: { p_trip_id: item.payload.tripId, p_distance_m: item.payload.distanceM } };
    case 'trip.finish':
      return {
        fn: 'finish_trip',
        params: {
          p_trip_id: item.payload.tripId,
          p_distance_m: item.payload.distanceM,
          p_duration_s: item.payload.durationS,
          // Prywatność: ślad GPS zostaje w pamięci telefonu – nigdy go nie wysyłamy.
          p_track_geojson: null,
          p_ended_at: item.payload.endedAt,
        },
      };
    case 'trip.publish':
      // Idempotentne per wyprawa (ponowienie zwraca istniejący wpis); kolejka FIFO gwarantuje, że `trip.finish` już doszedł.
      return {
        fn: 'publish_trip',
        params: { p_trip_id: item.payload.tripId, p_hide_route: item.payload.hideRoute, p_title: item.payload.title ?? null },
      };
    case 'challenge.accept':
      // Idempotentne – drugie przyjęcie nic nie zmienia; nieaktywne wyzwanie → P0001 challenge_inactive (trwały).
      return { fn: 'accept_challenge', params: { p_challenge_id: item.payload.challengeId } };
    case 'gmina.follow':
      return { fn: 'follow_gmina', params: { p_gmina_id: item.payload.gminaId, p_follow: item.payload.follow } };
    case 'terms.accept':
      // Idempotentne – ta sama wersja zostaje z pierwszym czasem akceptacji (czas serwera).
      return { fn: 'accept_terms', params: { p_version: item.payload.version } };
    case 'onboarding.complete':
      return { fn: 'complete_onboarding', params: {} };
    case 'profile.update':
    // Zdjęcia: najpierw Storage, potem RPC / profil – wysyła je ./photos.ts (bajty czytane w chwili wysyłki).
    case 'photo.find':
    case 'photo.avatar':
    case 'photo.delete':
      return null;
  }
}
