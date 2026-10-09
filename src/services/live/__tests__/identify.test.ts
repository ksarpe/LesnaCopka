/**
 * IdentifyService (src/services/live/identify.ts) z atrapą Supabase – bez prawdziwych wywołań Claude:
 * treść żądania (base64, miesiąc, województwo, pozycja do gminy), mapowanie odpowiedzi (podpisane rozpoznanie),
 * błędy (limit, serwer, sieć, czas, przerwanie, to samo zdjęcie w grze), brak zdjęcia / serwera i wymuszony wynik
 * z panelu dev (bez wywołania funkcji; w mockach „z odniesieniem skali” – symulacja podpisanego rozpoznania).
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from '@supabase/supabase-js';

import { ServiceError } from '../../types';

/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
/* eslint-enable @typescript-eslint/no-require-imports */

type Invoke = (name: string, opts: { body: Record<string, unknown>; signal?: AbortSignal; timeout?: number }) => Promise<{ data: unknown; error: unknown }>;

/** Atrapa serwera (prefiks `mock` – dozwolony w fabrykach jest.mock). */
const mockServer = {
  configured: true,
  /** Gra na backendzie Supabase (false = tryb mock). */
  enabled: false,
  invoke: jest.fn<Invoke>(),
  ensureSession: jest.fn(async (_client?: unknown) => 'uid-1'),
  bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]) as Uint8Array | null,
};

jest.mock('../../supabase/client', () => ({
  supabaseConfigured: true,
  get supabaseEnabled() {
    return mockServer.enabled;
  },
  identifyClient: () => (mockServer.configured ? { functions: { invoke: (...a: Parameters<Invoke>) => mockServer.invoke(...a) } } : null),
}));
jest.mock('../../supabase/session', () => ({ ensureSession: (c: unknown) => mockServer.ensureSession(c) }));
jest.mock('../photoBytes', () => ({ readImageBytes: async () => mockServer.bytes }));

// eslint-disable-next-line import/first -- po jest.mock
import { liveIdentify } from '../identify';
// eslint-disable-next-line import/first
import { useSimStore } from '@/store/useSimStore';
// eslint-disable-next-line import/first
import { useTrackStore } from '@/store/useTrackStore';
// eslint-disable-next-line import/first
import { NO_SCAN_OVERRIDE } from '@/utils/identify';

const SCAN = { id: 'scan-1', capturedAt: '2026-10-08T10:00:00.000Z', photoUri: 'file:///finds/photo-1.jpg' };

const OK = {
  verdict: 'mushroom',
  reason: '',
  candidates: [{ speciesId: 'borowik-szlachetny', confidence: 0.9 }],
  visibleParts: ['cap', 'underside', 'stem'],
  count: 1,
  capCm: null,
  heightCm: null,
  maturity: 'mature',
  scaleReference: 'none',
  reproduction: false,
};
const RID = '6f1c2b0a-3d4e-4f50-8a6b-7c8d9e0f1a2b';

/** Odpowiedź HTTP z błędem (FunctionsHttpError.context = Response). */
const httpError = (status: number, body: unknown) =>
  new FunctionsHttpError({ status, json: async () => body } as unknown as Response);

async function failure(p: Promise<unknown>): Promise<ServiceError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ServiceError) return e;
    throw e;
  }
  throw new Error('oczekiwano błędu');
}

beforeEach(() => {
  mockServer.configured = true;
  mockServer.enabled = false;
  useTrackStore.getState().clear();
  mockServer.bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  mockServer.invoke.mockReset();
  mockServer.ensureSession.mockClear();
  useSimStore.setState({ scan: { ...NO_SCAN_OVERRIDE }, networkEnabled: true });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('liveIdentify – prawdziwe rozpoznanie (Edge Function identify)', () => {
  it('wysyła zdjęcie (base64), miesiąc i województwo po sesji; odpowiedź → grzyb z gatunkiem', async () => {
    mockServer.invoke.mockResolvedValue({ data: OK, error: null });
    const out = await liveIdentify.identify(SCAN, { context: { month: 10, voivodeship: 'podlaskie' } });
    expect(mockServer.ensureSession).toHaveBeenCalledTimes(1);
    expect(mockServer.invoke).toHaveBeenCalledTimes(1);
    const [name, opts] = mockServer.invoke.mock.calls[0];
    expect(name).toBe('identify');
    expect(opts.body).toEqual({ image: '/9j/4AECAw==', month: 10, voivodeship: 'podlaskie' });
    expect(opts.timeout).toBe(25_000);
    expect(out.kind).toBe('mushroom');
    expect(out.kind === 'mushroom' && out.identification.speciesId).toBe('borowik-szlachetny');
    expect(out.kind === 'mushroom' && out.visibleParts).toEqual(['cap', 'underside', 'stem']);
  });

  it('skan 3D: główne zdjęcie i najwyżej 3 ujęcia (przy ziemi, z góry, druga strona) z rodzajem widoku', async () => {
    mockServer.invoke.mockResolvedValue({ data: OK, error: null });
    const side = (az: number) => ({ uri: `file:///finds/view-${az}.jpg`, kind: 'side' as const, az, el: -40 });
    const views = [
      { ...side(0), uri: SCAN.photoUri },
      side(30),
      { uri: 'file:///finds/view-top.jpg', kind: 'top' as const, az: 60, el: -75 },
      side(180),
      { uri: 'file:///finds/view-low.jpg', kind: 'low' as const, az: 200, el: -10 },
    ];
    await liveIdentify.identify({ ...SCAN, views }, { context: { month: 10 } });
    const [, opts] = mockServer.invoke.mock.calls[0];
    expect(opts.body).toEqual({
      image: '/9j/4AECAw==',
      views: [
        { image: '/9j/4AECAw==', view: 'low' },
        { image: '/9j/4AECAw==', view: 'top' },
        { image: '/9j/4AECAw==', view: 'side' },
      ],
      month: 10,
    });
  });

  it('nie grzyb → odrzucenie z powodem modelu (bez znaleziska)', async () => {
    mockServer.invoke.mockResolvedValue({
      data: { ...OK, verdict: 'not_mushroom', reason: 'Nie widzę tu grzyba – to wygląda na liść.', candidates: [] },
      error: null,
    });
    expect(await liveIdentify.identify(SCAN)).toEqual({ kind: 'not_mushroom', reason: 'Nie widzę tu grzyba – to wygląda na liść.' });
    // Bez kontekstu – bieżący miesiąc, bez województwa.
    expect(mockServer.invoke.mock.calls[0][1].body).toEqual({ image: '/9j/4AECAw==', month: new Date().getMonth() + 1 });
  });

  it('podpisane rozpoznanie: recognitionId, zmierzony kapelusz i termin z odpowiedzi serwera trafiają do wyniku', async () => {
    mockServer.invoke.mockResolvedValue({
      data: { ...OK, scaleReference: 'hand', capCm: 15.5, heightCm: 17, recognitionId: RID, sizeMeasured: true, expiresAt: '2026-10-12T10:00:00.000Z' },
      error: null,
    });
    const out = await liveIdentify.identify(SCAN);
    expect(out.kind === 'mushroom' && out.identification).toMatchObject({
      speciesId: 'borowik-szlachetny',
      recognitionId: RID,
      sizeMeasured: true,
      reproduction: false,
      expiresAt: '2026-10-12T10:00:00.000Z',
    });
    // Starszy serwer (bez pól) – wynik niezweryfikowany.
    mockServer.invoke.mockResolvedValue({ data: OK, error: null });
    const old = await liveIdentify.identify(SCAN);
    expect(old.kind === 'mushroom' && old.identification.recognitionId).toBeUndefined();
  });

  it('pozycja do gminy (serwer): z kontekstu (≤ 15 min, ~1 m), bez niej – ostatni punkt śladu wyprawy; starsza – bez pól', async () => {
    mockServer.invoke.mockResolvedValue({ data: OK, error: null });
    const now = new Date().toISOString();
    await liveIdentify.identify(SCAN, { context: { month: 10, position: { lat: 53.2512345, lon: 23.3498765, accuracyM: 12.4, at: now } } });
    expect(mockServer.invoke.mock.calls[0][1].body).toMatchObject({ lat: 53.25123, lon: 23.34988, accuracyM: 12 });

    const old = new Date(Date.now() - 20 * 60_000).toISOString();
    await liveIdentify.identify(SCAN, { context: { month: 10, position: { lat: 53.25, lon: 23.35, accuracyM: 10, at: old } } });
    expect(mockServer.invoke.mock.calls[1][1].body).not.toHaveProperty('lat');

    useTrackStore.getState().begin('trip-1', 'device');
    useTrackStore.getState().add('trip-1', [{ lat: 52.1, lon: 21.0, accuracyM: 8, t: Date.now() - 60_000 }]);
    await liveIdentify.identify(SCAN, { context: { month: 10 } });
    expect(mockServer.invoke.mock.calls[2][1].body).toMatchObject({ lat: 52.1, lon: 21, accuracyM: 8 });
  });

  it('to samo zdjęcie już w grze (409 image_reused) → odrzucenie z powodem serwera (nowe zdjęcie), nie błąd', async () => {
    mockServer.invoke.mockResolvedValue({
      data: null,
      error: httpError(409, { error: 'image_reused', message: 'To zdjęcie jest już w grze – zrób własne zdjęcie grzyba.' }),
    });
    expect(await liveIdentify.identify(SCAN)).toEqual({ kind: 'unclear', reason: 'To zdjęcie jest już w grze – zrób własne zdjęcie grzyba.' });
    mockServer.invoke.mockResolvedValue({
      data: null,
      error: httpError(503, { error: 'service_busy', message: 'Rozpoznawanie zdjęć jest dziś przeciążone – spróbuj ponownie jutro.' }),
    });
    const e = await failure(liveIdentify.identify(SCAN));
    // Globalny limit dobowy – jak limit (ekran „Limit rozpoznań”), z opisem „spróbuj później / jutro”.
    expect([e.code, e.message]).toEqual(['RATE_LIMITED', 'Rozpoznawanie zdjęć jest dziś przeciążone – spróbuj ponownie jutro.']);
    mockServer.invoke.mockResolvedValue({ data: null, error: httpError(503, { error: 'service_busy' }) });
    const e2 = await failure(liveIdentify.identify(SCAN));
    expect([e2.code, e2.message]).toEqual(['RATE_LIMITED', 'Dzienny limit rozpoznań w grze został wyczerpany – spróbuj później albo jutro.']);
  });

  it('tryb Supabase bez narzędzi dev: grzyb bez podpisanego rozpoznania (starsza funkcja, inny gatunek niż na serwerze) → błąd, nie znalezisko', async () => {
    // Wydanie (DEV_TOOLS = false) – osobna instancja modułu z podmienioną flagą.
    let release!: typeof import('../identify');
    jest.isolateModules(() => {
      jest.doMock('@/config', () => ({ ...(jest.requireActual('@/config') as object), DEV_TOOLS: false }));
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      release = require('../identify') as typeof import('../identify');
    });
    const liveIdentify = release.liveIdentify;
    // ServiceError z osobnej instancji modułów – bez instanceof.
    const failure = async (p: Promise<unknown>) => {
      try {
        await p;
      } catch (e) {
        return e as { code: string; message: string };
      }
      throw new Error('oczekiwano błędu');
    };
    mockServer.enabled = true;
    mockServer.invoke.mockResolvedValue({ data: OK, error: null });
    const e = await failure(liveIdentify.identify(SCAN));
    expect([e.code, e.message]).toEqual(['SERVER', 'Serwer nie potwierdził rozpoznania – spróbuj ponownie.']);
    // Gatunek z serwera nieznany telefonowi – telefon pokazałby innego grzyba niż zapisał serwer.
    mockServer.invoke.mockResolvedValue({
      data: {
        ...OK,
        candidates: [{ speciesId: 'nowy-gatunek', confidence: 0.95 }, { speciesId: 'borowik-szlachetny', confidence: 0.9 }],
        recognitionId: RID,
        expiresAt: '2026-10-22T10:00:00.000Z',
      },
      error: null,
    });
    expect((await failure(liveIdentify.identify(SCAN))).message).toBe('Serwer nie potwierdził rozpoznania – spróbuj ponownie.');
    // Z rozpoznaniem – grzyb; niska pewność (bez rozpoznania z definicji) i odrzucenia – bez zmian.
    mockServer.invoke.mockResolvedValue({ data: { ...OK, recognitionId: RID, expiresAt: '2026-10-22T10:00:00.000Z' }, error: null });
    const ok = await liveIdentify.identify(SCAN);
    expect(ok.kind === 'mushroom' && ok.identification.recognitionId).toBe(RID);
    mockServer.invoke.mockResolvedValue({ data: { ...OK, candidates: [{ speciesId: 'borowik-szlachetny', confidence: 0.4 }] }, error: null });
    expect((await liveIdentify.identify(SCAN)).kind).toBe('mushroom');
    // Tryb mock (gra bez serwera) – wynik bez rozpoznania przechodzi (znalezisko niezweryfikowane).
    mockServer.enabled = false;
    mockServer.invoke.mockResolvedValue({ data: OK, error: null });
    expect((await liveIdentify.identify(SCAN)).kind).toBe('mushroom');
  });

  it('niezrozumiała odpowiedź → SERVER', async () => {
    mockServer.invoke.mockResolvedValue({ data: 'ok', error: null });
    expect((await failure(liveIdentify.identify(SCAN))).code).toBe('SERVER');
  });

  it('429 rate_limited → RATE_LIMITED z komunikatem serwera', async () => {
    mockServer.invoke.mockResolvedValue({
      data: null,
      error: httpError(429, { error: 'rate_limited', message: 'Dzienny limit rozpoznań (60) został wyczerpany. Spróbuj ponownie później.' }),
    });
    const e = await failure(liveIdentify.identify(SCAN));
    expect(e.code).toBe('RATE_LIMITED');
    expect(e.message).toContain('Dzienny limit rozpoznań (60)');
  });

  it('5xx z opisem → SERVER z opisem; 404 (funkcja niewdrożona) → UNAVAILABLE; przekaźnik → SERVER', async () => {
    mockServer.invoke.mockResolvedValue({
      data: null,
      error: httpError(503, { error: 'model_unavailable', message: 'Serwer rozpoznawania jest teraz przeciążony – spróbuj za chwilę.' }),
    });
    const e = await failure(liveIdentify.identify(SCAN));
    expect([e.code, e.message]).toEqual(['SERVER', 'Serwer rozpoznawania jest teraz przeciążony – spróbuj za chwilę.']);
    mockServer.invoke.mockResolvedValue({ data: null, error: httpError(404, 'Not found') });
    expect((await failure(liveIdentify.identify(SCAN))).code).toBe('UNAVAILABLE');
    mockServer.invoke.mockResolvedValue({ data: null, error: new FunctionsRelayError({}) });
    expect((await failure(liveIdentify.identify(SCAN))).code).toBe('SERVER');
  });

  it('brak sieci → NETWORK; limit czasu → TIMEOUT; przerwanie (ekran zamknięty) → CANCELLED', async () => {
    mockServer.invoke.mockResolvedValue({ data: null, error: new FunctionsFetchError(new TypeError('Network request failed')) });
    expect((await failure(liveIdentify.identify(SCAN))).code).toBe('NETWORK');

    const abortErr = Object.assign(new Error('aborted'), { name: 'AbortError' });
    mockServer.invoke.mockResolvedValue({ data: null, error: new FunctionsFetchError(abortErr) });
    expect((await failure(liveIdentify.identify(SCAN))).code).toBe('TIMEOUT');

    const ctrl = new AbortController();
    mockServer.invoke.mockImplementation(async () => {
      ctrl.abort();
      return { data: null, error: new FunctionsFetchError(abortErr) };
    });
    expect((await failure(liveIdentify.identify(SCAN, { signal: ctrl.signal }))).code).toBe('CANCELLED');
  });

  it('sesja nie powstała (offline) → NETWORK, bez wywołania funkcji', async () => {
    mockServer.ensureSession.mockRejectedValueOnce(new Error('Brak odpowiedzi serwera (4 s)'));
    expect((await failure(liveIdentify.identify(SCAN))).code).toBe('NETWORK');
    expect(mockServer.invoke).not.toHaveBeenCalled();
  });
});

describe('liveIdentify – bez zdjęcia, bez serwera, wymuszony wynik dev', () => {
  it('bez zdjęcia albo nieczytelny plik → NO_PHOTO; bez serwera → UNAVAILABLE; nic nie jest zmyślane', async () => {
    expect((await failure(liveIdentify.identify({ ...SCAN, photoUri: undefined }))).code).toBe('NO_PHOTO');
    mockServer.bytes = null;
    expect((await failure(liveIdentify.identify(SCAN))).code).toBe('NO_PHOTO');
    mockServer.configured = false;
    const e = await failure(liveIdentify.identify(SCAN));
    expect([e.code, e.message]).toEqual(['UNAVAILABLE', 'Rozpoznawanie wymaga połączenia z serwerem.']);
    expect(mockServer.invoke).not.toHaveBeenCalled();
  });

  it('przełącznik sieci z panelu dev → NETWORK', async () => {
    useSimStore.setState({ networkEnabled: false });
    expect((await failure(liveIdentify.identify(SCAN))).code).toBe('NETWORK');
  });

  it('wymuszony wynik (dev): bez zdjęcia, bez sieci i bez wywołania funkcji', async () => {
    jest.useFakeTimers();
    useSimStore.setState({ scan: { force: 'unclear', speciesId: null, xxl: false, lowConfidence: false }, networkEnabled: false });
    const p = liveIdentify.identify({ ...SCAN, photoUri: undefined });
    await jest.advanceTimersByTimeAsync(800);
    expect((await p).kind).toBe('unclear');

    useSimStore.setState({ scan: { force: 'species', speciesId: 'czubajka-kania', xxl: false, lowConfidence: false } });
    const p2 = liveIdentify.identify({ ...SCAN, photoUri: undefined });
    await jest.advanceTimersByTimeAsync(800);
    const out = await p2;
    expect(out.kind === 'mushroom' && out.identification.speciesId).toBe('czubajka-kania');
    expect(mockServer.invoke).not.toHaveBeenCalled();
  });

  it('wymuszony wynik „z odniesieniem skali”: tryb mock – symulacja podpisanego rozpoznania; tryb Supabase – niezweryfikowany', async () => {
    jest.useFakeTimers();
    useSimStore.setState({ scan: { force: 'species', speciesId: 'borowik-szlachetny', xxl: false, lowConfidence: false, scaleRef: true } });
    const p = liveIdentify.identify({ ...SCAN, photoUri: undefined });
    await jest.advanceTimersByTimeAsync(800);
    const mock = await p;
    expect(mock.kind === 'mushroom' && mock.identification).toMatchObject({ simulated: true, sizeMeasured: true });

    mockServer.enabled = true;
    const p2 = liveIdentify.identify({ ...SCAN, photoUri: undefined });
    await jest.advanceTimersByTimeAsync(800);
    const supa = await p2;
    expect(supa.kind === 'mushroom' && supa.identification.simulated).toBeUndefined();
    expect(supa.kind === 'mushroom' && supa.identification.recognitionId).toBeUndefined();
  });
});
