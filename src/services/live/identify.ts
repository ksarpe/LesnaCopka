/**
 * Rozpoznawanie zdjęcia (IdentifyService) – to samo w trybie mock i Supabase, gdy aplikacja zna adres i klucz
 * serwera (EXPO_PUBLIC_SUPABASE_URL / _PUBLISHABLE_KEY): zdjęcie z camera.ts (JPEG ~720 px, bez EXIF) → base64 →
 * Edge Function `identify` (supabase/functions/identify – model Claude) → odpowiedź znormalizowana drugi raz
 * (contract.ts – aplikacja nie ufa jej ślepo) → wynik gry (src/utils/identify.ts).
 *
 * Bez serwera – ServiceError('UNAVAILABLE'), nigdy wynik zmyślony. Wymuszony wynik skanu z panelu dev (tylko
 * narzędzia dev: gatunek / nie grzyb / niewyraźne) zastępuje rozpoznanie – bez zdjęcia, bez sieci i bez kosztów.
 * Do serwera idą tylko: zdjęcie (skan 3D: do 4 ujęć – src/scan/views.ts), miesiąc i województwo (nie gmina,
 * nie współrzędne).
 */
import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from '@supabase/supabase-js';

import { DEV_TOOLS } from '@/config';
import { SPECIES } from '@/data/mock/species';
import { identifyViews } from '@/scan/views';
import { useCatalogStore } from '@/store/useCatalogStore';
import { useSimStore } from '@/store/useSimStore';
import type { IdentifyOutcome, Species } from '@/types';
import { bytesToBase64 } from '@/utils/bytes';
import { devScanOutcome, toIdentifyOutcome } from '@/utils/identify';
import { sleep } from '@/utils/random';

import {
  normalizeIdent,
  type IdentExtraView,
  type IdentifyErrorBody,
  type IdentifyRequestBody,
} from '../../../supabase/functions/identify/contract';
import { identifyClient, supabaseConfigured } from '../supabase/client';
import { ensureSession } from '../supabase/session';
import { ServiceError, type IdentifyService } from '../types';
import { readImageBytes } from './photoBytes';

/** Limit całego rozpoznania (Edge Function: model z jednym ponowieniem po 12 s). */
export const IDENTIFY_TIMEOUT_MS = 25_000;

/** Katalog z serwera / mocków; przed wczytaniem słowników – katalog z aplikacji. */
function catalog(): Species[] {
  const loaded = useCatalogStore.getState().species;
  return loaded.length ? loaded : SPECIES;
}

/** Czy aplikacja ma serwer do rozpoznawania (adres i klucz Supabase w konfiguracji). */
export const identifyAvailable = () => supabaseConfigured;

/** Wymuszony wynik skanu z panelu dev jest włączony (zawsze false w wydaniu bez narzędzi dev). */
export const devScanForced = () => DEV_TOOLS && useSimStore.getState().scan.force !== 'off';

/** Błąd wywołania funkcji → ServiceError z komunikatem po polsku (z serwera, gdy go podał). */
export async function identifyError(e: unknown, signal?: AbortSignal): Promise<ServiceError> {
  if (e instanceof ServiceError) return e;
  if (signal?.aborted) return new ServiceError('CANCELLED', 'Rozpoznawanie przerwane');
  if (e instanceof FunctionsHttpError) {
    const res = e.context as { status?: number; json?: () => Promise<unknown> } | undefined;
    let body: Partial<IdentifyErrorBody> = {};
    try {
      body = ((await res?.json?.()) ?? {}) as Partial<IdentifyErrorBody>;
    } catch {
      body = {};
    }
    const msg = typeof body.message === 'string' && body.message.trim() ? body.message.trim() : null;
    if (body.error === 'rate_limited' || res?.status === 429) {
      return new ServiceError('RATE_LIMITED', msg ?? 'Za dużo rozpoznań naraz – spróbuj za chwilę.');
    }
    if (res?.status === 401) return new ServiceError('SERVER', 'Sesja wygasła – spróbuj ponownie.');
    // Funkcja niewdrożona na tym serwerze.
    if (res?.status === 404) return new ServiceError('UNAVAILABLE', 'Rozpoznawanie nie jest jeszcze włączone na serwerze.');
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

export const liveIdentify: IdentifyService = {
  async identify(scan, opts) {
    // Panel dev: wymuszony wynik (bez zdjęcia i sieci). Chwila „analizy”, żeby ekran zachowywał się jak naprawdę.
    if (DEV_TOOLS) {
      const forced = devScanOutcome(useSimStore.getState().scan, catalog());
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
    if (error) throw await identifyError(error, opts?.signal);

    const species = catalog();
    const byId = Object.fromEntries(species.map((s) => [s.id, s]));
    const res = normalizeIdent(data, (id) => !!byId[id]);
    if (!res) throw new ServiceError('SERVER', 'Serwer rozpoznawania zwrócił niezrozumiałą odpowiedź – spróbuj ponownie.');
    return toIdentifyOutcome(res, byId) satisfies IdentifyOutcome;
  },
};
