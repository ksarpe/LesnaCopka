import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

/** AsyncStorage wspólny dla kolejnych „uruchomień” modułu (jest.resetModules) – jak pamięć telefonu. */
const mockStore = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async (k: string) => mockStore.get(k) ?? null,
    setItem: async (k: string, v: string) => void mockStore.set(k, v),
    removeItem: async (k: string) => void mockStore.delete(k),
    clear: async () => mockStore.clear(),
  },
}));

/* eslint-disable @typescript-eslint/no-require-imports */
type WeatherModule = typeof import('../weather');
type AsyncStorageModule = { getItem(k: string): Promise<string | null>; clear(): Promise<void> };

/** Świeży moduł (pusta pamięć podręczna) dla każdego testu. */
function load(): { w: WeatherModule; storage: AsyncStorageModule } {
  jest.resetModules();
  return {
    w: require('../weather') as WeatherModule,
    storage: (require('@react-native-async-storage/async-storage') as { default: AsyncStorageModule }).default,
  };
}
/* eslint-enable @typescript-eslint/no-require-imports */

const NOW = new Date('2026-10-07T08:00:00Z');

/** Odpowiedź Open-Meteo: 14 dni wstecz, dziś (2026-10-07), 2 dni naprzód. */
function payload() {
  const time = Array.from({ length: 17 }, (_, i) => new Date(Date.UTC(2026, 8, 23 + i)).toISOString().slice(0, 10));
  const fill = (v: number) => time.map(() => v);
  const precip = fill(0);
  precip[12] = 8; // 2026-10-05 → 2 dni po deszczu
  precip[6] = 12;
  return {
    latitude: 53.195797,
    longitude: 23.291336,
    daily: {
      time,
      precipitation_sum: precip,
      temperature_2m_max: fill(17),
      temperature_2m_min: fill(8),
      temperature_2m_mean: fill(12.5),
      relative_humidity_2m_mean: fill(84),
      weather_code: fill(3),
    },
  };
}

let fetchMock: jest.Mock<(url: string, init?: RequestInit) => Promise<Response>>;
/** Pobrane adresy (licznik niezależny od jest.resetModules, które zeruje historię wywołań mocka). */
let fetched: string[] = [];

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
  mockStore.clear();
  fetched = [];
  fetchMock = jest.fn(async (url: string) => {
    fetched.push(url);
    return { ok: true, status: 200, json: async () => payload() } as unknown as Response;
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  jest.useRealTimers();
});

describe('liveWeather', () => {
  it('wysyła tylko kratkę 0,1° i liczy prognozę z odpowiedzi', async () => {
    const { w } = load();
    const f = await w.liveWeather.getForecast({ lat: 53.2134, lon: 23.3417, gminaId: 'suprasl' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = fetchMock.mock.calls[0][0];
    expect(url).toContain('latitude=53.2&longitude=23.3&');
    expect(url).not.toContain('53.21');
    expect(url).not.toContain('suprasl');
    expect(url).toContain('past_days=14&forecast_days=3&timezone=Europe%2FWarsaw');
    expect(f.source).toBe('open-meteo');
    expect(f.daysAfterRain).toBe(2);
    expect(f.rain14Mm).toBe(20);
    expect(f.outlook.map((d) => d.date)).toEqual(['2026-10-07', '2026-10-08', '2026-10-09']);
    expect(f.updatedAt).toBe(NOW.toISOString());
  });

  it('pamięć podręczna 3 h na kratkę (także po restarcie – AsyncStorage), potem pobiera od nowa', async () => {
    const { w } = load();
    await w.liveWeather.getForecast({ lat: 53.21, lon: 23.34 });
    await w.liveWeather.getForecast({ lat: 53.24, lon: 23.31 }); // ta sama kratka
    expect(fetched).toHaveLength(1);

    // „Restart aplikacji”: nowy moduł, dane z AsyncStorage (mock zachowuje zawartość między modułami).
    const again = load();
    await jest.advanceTimersByTimeAsync(60 * 60_000);
    await again.w.liveWeather.getForecast({ lat: 53.21, lon: 23.34 });
    expect(fetched).toHaveLength(1);

    await jest.advanceTimersByTimeAsync(2 * 3600_000 + 1000);
    await again.w.liveWeather.getForecast({ lat: 53.21, lon: 23.34 });
    expect(fetched).toHaveLength(2);

    // Inna kratka – osobne pobranie; jednoczesne zapytania o nią – jedno pobranie.
    await Promise.all([
      again.w.liveWeather.getForecast({ lat: 52.23, lon: 21.01 }),
      again.w.liveWeather.getForecast({ lat: 52.22, lon: 21.04 }),
    ]);
    expect(fetched).toHaveLength(3);
  });

  it('„Wyczyść dane” usuwa pamięć podręczną (także z AsyncStorage)', async () => {
    const { w, storage } = load();
    await w.liveWeather.getForecast({ lat: 53.21, lon: 23.34 });
    expect(await storage.getItem(w.WEATHER_STORAGE_KEY)).toContain('53.2,23.3');
    w.clearWeatherCache();
    await jest.advanceTimersByTimeAsync(0);
    expect(await storage.getItem(w.WEATHER_STORAGE_KEY)).toBeNull();
    await w.liveWeather.getForecast({ lat: 53.21, lon: 23.34 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('brak sieci → NETWORK; błąd serwera / dziwna odpowiedź → SERVER', async () => {
    const { w } = load();
    fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));
    await expect(w.liveWeather.getForecast({ lat: 50, lon: 20 })).rejects.toMatchObject({ code: 'NETWORK' });

    fetchMock.mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) } as unknown as Response);
    await expect(w.liveWeather.getForecast({ lat: 50, lon: 20 })).rejects.toMatchObject({ code: 'SERVER' });

    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ daily: {} }) } as unknown as Response);
    await expect(w.liveWeather.getForecast({ lat: 50, lon: 20 })).rejects.toMatchObject({ code: 'SERVER' });
  });

  it('serwer nie odpowiada 8 s → NETWORK', async () => {
    const { w } = load();
    fetchMock.mockImplementationOnce(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('Aborted')));
        }),
    );
    const p = w.liveWeather.getForecast({ lat: 51, lon: 17 });
    const settled = p.catch((e: unknown) => e);
    await jest.advanceTimersByTimeAsync(w.WEATHER_TIMEOUT_MS + 10);
    expect(await settled).toMatchObject({ code: 'NETWORK', message: 'Serwer pogody nie odpowiada' });
  });

  it('przerwanie przez wołającego → CANCELLED, wspólne pobranie trwa dla innych', async () => {
    const { w } = load();
    const ctrl = new AbortController();
    const a = w.liveWeather.getForecast({ lat: 49.3, lon: 19.9 }, { signal: ctrl.signal }).catch((e: unknown) => e);
    const b = w.liveWeather.getForecast({ lat: 49.3, lon: 19.9 });
    ctrl.abort();
    expect(await a).toMatchObject({ code: 'CANCELLED' });
    expect((await b).source).toBe('open-meteo');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('parseOpenMeteo', () => {
  it('brakujące wartości → null; dzisiejszy dzień to trzeci od końca', () => {
    const { w } = load();
    const p = payload();
    p.daily.relative_humidity_2m_mean[16] = null as unknown as number;
    const { days, today } = w.parseOpenMeteo(p);
    expect(today).toBe('2026-10-07');
    expect(days).toHaveLength(17);
    expect(days[16].humidityPct).toBeNull();
    expect(days[0]).toEqual({
      date: '2026-09-23',
      precipMm: 0,
      tMinC: 8,
      tMaxC: 17,
      tMeanC: 12.5,
      humidityPct: 84,
      weatherCode: 3,
    });
  });
});
