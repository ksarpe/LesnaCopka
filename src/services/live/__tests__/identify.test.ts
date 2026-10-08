/**
 * IdentifyService (src/services/live/identify.ts) z atrapą Supabase – bez prawdziwych wywołań Claude:
 * treść żądania (base64, miesiąc, województwo), mapowanie odpowiedzi, błędy (limit, serwer, sieć, czas, przerwanie),
 * brak zdjęcia / serwera i wymuszony wynik z panelu dev (bez wywołania funkcji).
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
  invoke: jest.fn<Invoke>(),
  ensureSession: jest.fn(async (_client?: unknown) => 'uid-1'),
  bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]) as Uint8Array | null,
};

jest.mock('../../supabase/client', () => ({
  supabaseConfigured: true,
  identifyClient: () => (mockServer.configured ? { functions: { invoke: (...a: Parameters<Invoke>) => mockServer.invoke(...a) } } : null),
}));
jest.mock('../../supabase/session', () => ({ ensureSession: (c: unknown) => mockServer.ensureSession(c) }));
jest.mock('../photoBytes', () => ({ readImageBytes: async () => mockServer.bytes }));

// eslint-disable-next-line import/first -- po jest.mock
import { liveIdentify } from '../identify';
// eslint-disable-next-line import/first
import { useSimStore } from '@/store/useSimStore';
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
};

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
});
