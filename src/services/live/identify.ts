/**
 * Rozpoznawanie zdjęcia (IdentifyService) – to samo w trybie mock i Supabase, gdy aplikacja zna adres i klucz
 * serwera (EXPO_PUBLIC_SUPABASE_URL / _PUBLISHABLE_KEY): zdjęcie z camera.ts (JPEG ~720 px, bez EXIF) → base64 →
 * Edge Function `identify` (supabase/functions/identify – model Claude) → odpowiedź znormalizowana drugi raz
 * (contract.ts – aplikacja nie ufa jej ślepo) → wynik gry (src/utils/identify.ts).
 *
 * Podpisane rozpoznanie: serwer zapisuje wynik (i zdjęcie główne – to, które widział model) i oddaje `recognitionId`;
 * znalezisko niesie je w `find.submit`, a submit_find bierze gatunek, wymiary, gminę i czas z rekordu serwera. To samo
 * zdjęcie drugi raz (u kogokolwiek) serwer odrzuca bez wołania modelu → odrzucenie z powodem („zrób własne zdjęcie”).
 *
 * Bez serwera – ServiceError('UNAVAILABLE'), nigdy wynik zmyślony. Wymuszony wynik skanu z panelu dev (tylko
 * narzędzia dev: gatunek / nie grzyb / niewyraźne) zastępuje rozpoznanie – bez zdjęcia, bez sieci i bez kosztów;
 * w trybie mock „z odniesieniem skali” symuluje podpisane rozpoznanie, w trybie Supabase jest niezweryfikowany.
 *
 * Prywatność – do serwera idą tylko: zdjęcie (skan 3D: do 4 ujęć – src/scan/views.ts), miesiąc, województwo i bieżąca
 * pozycja, jeśli jest znana (≤ 15 min). Model dostaje zdjęcia, miesiąc i województwo; z pozycji serwer liczy gminę
 * znaleziska (`gmina_at`) i zapisuje tylko ją – współrzędnych nie zapisuje i nie przekazuje modelowi.
 */
import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from '@supabase/supabase-js';

import { DEV_TOOLS } from '@/config';
import { SPECIES } from '@/data/mock/species';
import { identifyViews } from '@/scan/views';
import { useCatalogStore } from '@/store/useCatalogStore';
import { useSimStore } from '@/store/useSimStore';
import { useTrackStore } from '@/store/useTrackStore';
import type { GeoPosition, IdentifyOutcome, Species } from '@/types';
import { bytesToBase64 } from '@/utils/bytes';
import { devScanOutcome, LOW_CONFIDENCE, toIdentifyOutcome } from '@/utils/identify';
import { sleep } from '@/utils/random';

import {
  IMAGE_REUSED_REASON,
  normalizeIdent,
  normalizeRecognition,
  type IdentExtraView,
  type IdentifyErrorBody,
  type IdentifyRequestBody,
} from '../../../supabase/functions/identify/contract';
import { identifyClient, supabaseConfigured, supabaseEnabled } from '../supabase/client';
import { ensureSession } from '../supabase/session';
import { ServiceError, type IdentifyService } from '../types';
import { readImageBytes } from './photoBytes';

/** Limit całego rozpoznania (Edge Function: model z jednym ponowieniem po 12 s). */
export const IDENTIFY_TIMEOUT_MS = 25_000;
/** Pozycja starsza niż tyle nie idzie z rozpoznaniem (gmina mogła się zmienić). */
export const POSITION_MAX_AGE_MS = 15 * 60_000;
/** Tryb Supabase: grzyb bez podpisanego rozpoznania nie może stać się znaleziskiem. */
export const UNCONFIRMED = 'Serwer nie potwierdził rozpoznania – spróbuj ponownie.';

/** Katalog z serwera / mocków; przed wczytaniem słowników – katalog z aplikacji. */
function catalog(): Species[] {
  const loaded = useCatalogStore.getState().species;
  return loaded.length ? loaded : SPECIES;
}

/** Czy aplikacja ma serwer do rozpoznawania (adres i klucz Supabase w konfiguracji). */
export const identifyAvailable = () => supabaseConfigured;

/** Wymuszony wynik skanu z panelu dev jest włączony (zawsze false w wydaniu bez narzędzi dev). */
export const devScanForced = () => DEV_TOOLS && useSimStore.getState().scan.force !== 'off';

/** Tryb mock (gra bez backendu Supabase): wymuszony wynik „z odniesieniem skali” symuluje podpisane rozpoznanie. */
export const devScanSimulatesSigned = () => !supabaseEnabled;

/**
 * Pozycja do rozpoznania (gmina na serwerze): z kontekstu (ekran skanu – ostatnio wykryty region), a bez niej ostatni
 * punkt śladu trwającej wyprawy. Starsza niż POSITION_MAX_AGE_MS albo bez współrzędnych → brak (żądanie bez pól).
 */
export function positionForIdentify(ctx: GeoPosition | undefined, now = Date.now()): Pick<IdentifyRequestBody, 'lat' | 'lon' | 'accuracyM'> {
  const points = useTrackStore.getState().points;
  const last = points.length ? points[points.length - 1] : undefined;
  const pos =
    ctx && Number.isFinite(ctx.lat) && Number.isFinite(ctx.lon) && now - Date.parse(ctx.at) <= POSITION_MAX_AGE_MS
      ? { lat: ctx.lat, lon: ctx.lon, accuracyM: ctx.accuracyM }
      : last && now - last.t <= POSITION_MAX_AGE_MS
        ? { lat: last.lat, lon: last.lon, accuracyM: last.accuracyM }
        : null;
  if (!pos) return {};
  // ~1 m dokładności wystarcza do gminy; mniej cyfr – mniej śladu w logach sieciowych.
  const round = (v: number) => Math.round(v * 1e5) / 1e5;
  return {
    lat: round(pos.lat),
    lon: round(pos.lon),
    ...(Number.isFinite(pos.accuracyM) && pos.accuracyM >= 0 ? { accuracyM: Math.round(pos.accuracyM) } : {}),
  };
}

/** Treść błędu funkcji (status ≠ 200) – raz, bo ciało odpowiedzi da się przeczytać tylko jeden raz. */
async function errorBodyOf(e: unknown): Promise<{ status?: number; body: Partial<IdentifyErrorBody> }> {
  if (!(e instanceof FunctionsHttpError)) return { body: {} };
  const res = e.context as { status?: number; json?: () => Promise<unknown> } | undefined;
  let body: Partial<IdentifyErrorBody> = {};
  try {
    body = ((await res?.json?.()) ?? {}) as Partial<IdentifyErrorBody>;
  } catch {
    body = {};
  }
  return { status: res?.status, body: body && typeof body === 'object' ? body : {} };
}

/** Błąd wywołania funkcji (z przeczytaną treścią) → ServiceError z komunikatem po polsku (z serwera, gdy go podał). */
function identifyErrorFrom(e: unknown, http: { status?: number; body: Partial<IdentifyErrorBody> }, signal?: AbortSignal): ServiceError {
  if (e instanceof ServiceError) return e;
  if (signal?.aborted) return new ServiceError('CANCELLED', 'Rozpoznawanie przerwane');
  if (e instanceof FunctionsHttpError) {
    const { status, body } = http;
    const msg = typeof body.message === 'string' && body.message.trim() ? body.message.trim() : null;
    // Globalny dzienny limit gry – ponowienie za chwilę nic nie da.
    if (body.error === 'service_busy') {
      return new ServiceError('RATE_LIMITED', msg ?? 'Dzienny limit rozpoznań w grze został wyczerpany – spróbuj później albo jutro.');
    }
    if (body.error === 'rate_limited' || status === 429) {
      return new ServiceError('RATE_LIMITED', msg ?? 'Za dużo rozpoznań naraz – spróbuj za chwilę.');
    }
    if (status === 401) return new ServiceError('SERVER', 'Sesja wygasła – spróbuj ponownie.');
    // Funkcja niewdrożona na tym serwerze.
    if (status === 404) return new ServiceError('UNAVAILABLE', 'Rozpoznawanie nie jest jeszcze włączone na serwerze.');
    return new ServiceError('SERVER', msg ?? 'Serwer rozpoznawania odpowiedział błędem – spróbuj ponownie.');
  }
  if (e instanceof FunctionsRelayError) {
    return new ServiceError('SERVER', 'Serwer rozpoznawania jest chwilowo niedostępny – spróbuj za chwilę.');
  }
  if (e instanceof FunctionsFetchError) {
    const name = (e.context as { name?: string } | undefined)?.name;
    if (name === 'AbortError' || name === 'TimeoutError') {
      return new ServiceError('TIMEOUT', 'Rozpoznawanie trwa zbyt długo – spróbuj ponownie.');
    }
  }
  return new ServiceError('NETWORK', 'Brak połączenia – rozpoznanie wymaga internetu.');
}

/** Błąd wywołania funkcji → ServiceError z komunikatem po polsku (z serwera, gdy go podał). */
export async function identifyError(e: unknown, signal?: AbortSignal): Promise<ServiceError> {
  return identifyErrorFrom(e, await errorBodyOf(e), signal);
}

export const liveIdentify: IdentifyService = {
  async identify(scan, opts) {
    // Panel dev: wymuszony wynik (bez zdjęcia i sieci). Chwila „analizy”, żeby ekran zachowywał się jak naprawdę.
    if (DEV_TOOLS) {
      const forced = devScanOutcome(useSimStore.getState().scan, catalog(), { simulateSigned: devScanSimulatesSigned() });
      if (forced) {
        await sleep(700);
        if (opts?.signal?.aborted) throw new ServiceError('CANCELLED', 'Rozpoznawanie przerwane');
        return forced;
      }
    }
    if (!scan.photoUri) throw new ServiceError('NO_PHOTO', 'Brak zdjęcia – rozpoznawanie wymaga zdjęcia z aparatu.');
    const client = identifyClient();
    if (!client) throw new ServiceError('UNAVAILABLE', 'Rozpoznawanie wymaga połączenia z serwerem.');
    // Przełącznik sieci z panelu dev (w wydaniu zawsze włączona).
    if (!useSimStore.getState().networkEnabled) throw new ServiceError('NETWORK', 'Brak sieci – rozpoznanie wymaga połączenia.');

    const bytes = await readImageBytes(scan.photoUri);
    if (!bytes) throw new ServiceError('NO_PHOTO', 'Nie udało się odczytać zdjęcia – zrób nowe.');
    // Skan 3D: dodatkowe ujęcia (przy ziemi, z góry, druga strona) – nieczytelne pomijamy, główne wystarczy.
    const views: IdentExtraView[] = [];
    for (const v of identifyViews(scan.views ?? []).filter((v) => v.uri !== scan.photoUri)) {
      const extra = await readImageBytes(v.uri);
      if (extra) views.push({ image: bytesToBase64(extra), view: v.kind });
    }
    const ctx = opts?.context ?? {};
    const body: IdentifyRequestBody = {
      image: bytesToBase64(bytes),
      ...(views.length ? { views } : {}),
      month: ctx.month ?? new Date().getMonth() + 1,
      ...(ctx.voivodeship ? { voivodeship: ctx.voivodeship } : {}),
      ...positionForIdentify(ctx.position),
    };

    try {
      await ensureSession(client);
    } catch (e) {
      throw await identifyError(e, opts?.signal);
    }
    if (opts?.signal?.aborted) throw new ServiceError('CANCELLED', 'Rozpoznawanie przerwane');

    const { data, error } = await client.functions.invoke('identify', {
      body,
      signal: opts?.signal,
      timeout: IDENTIFY_TIMEOUT_MS,
    });
    if (error) {
      const http = await errorBodyOf(error);
      // Ten sam obraz już w grze (u innego gracza albo zużyty) – odrzucenie zdjęcia jak „niewyraźne”: nowe ujęcie.
      if (!opts?.signal?.aborted && http.body.error === 'image_reused') {
        const reason = typeof http.body.message === 'string' && http.body.message.trim() ? http.body.message.trim() : IMAGE_REUSED_REASON;
        return { kind: 'unclear', reason };
      }
      throw identifyErrorFrom(error, http, opts?.signal);
    }

    const species = catalog();
    const byId = Object.fromEntries(species.map((s) => [s.id, s]));
    const res = normalizeIdent(data, (id) => !!byId[id]);
    if (!res) throw new ServiceError('SERVER', 'Serwer rozpoznawania zwrócił niezrozumiałą odpowiedź – spróbuj ponownie.');
    const out = toIdentifyOutcome(res, byId, normalizeRecognition(data, res)) satisfies IdentifyOutcome;
    // Tryb Supabase (poza narzędziami dev): grzyb do odebrania musi mieć podpisane rozpoznanie – bez niego (np. starsza
    // Edge Function, inny gatunek niż na serwerze) serwer i tak odrzuciłby znalezisko.
    if (
      supabaseEnabled &&
      !DEV_TOOLS &&
      out.kind === 'mushroom' &&
      out.identification.confidence >= LOW_CONFIDENCE &&
      !out.identification.recognitionId
    ) {
      throw new ServiceError('SERVER', UNCONFIRMED);
    }
    return out;
  },
};
