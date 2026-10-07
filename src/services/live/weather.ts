/**
 * Pogoda do prognozy grzybowej: Open-Meteo Forecast API (bez klucza, dane CC BY 4.0 – podpis
 * `WEATHER_ATTRIBUTION` z src/utils/forecast.ts tam, gdzie pokazujemy prognozę).
 *
 * Prywatność: do Open-Meteo trafiają tylko współrzędne zaokrąglone do 0,1° (kratka ok. 11 × 7 km),
 * nigdy dokładna pozycja. Dane z kratki trzymamy 3 h w pamięci i (best effort) w AsyncStorage,
 * więc w obrębie kratki kolejne odczyty nie wysyłają nic. Prognozę liczy telefon – src/utils/forecast.ts.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import type { WeatherDay } from '@/types';
import { computeForecast, weatherCell, type WeatherCell } from '@/utils/forecast';

import { ServiceError, type ForecastRequest, type WeatherService } from '../types';

export const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';
export const WEATHER_CACHE_TTL_MS = 3 * 3600_000;
export const WEATHER_TIMEOUT_MS = 8000;
export const WEATHER_STORAGE_KEY = 'grzyb.weather.v1';

const PAST_DAYS = 14;
/** Dziś + 2 dni. */
const FORECAST_DAYS = 3;
const MAX_STORED_CELLS = 6;
const DAILY = [
  'precipitation_sum',
  'temperature_2m_max',
  'temperature_2m_min',
  'temperature_2m_mean',
  'relative_humidity_2m_mean',
  'weather_code',
] as const;

export function forecastUrl(cell: WeatherCell): string {
  return (
    `${OPEN_METEO_URL}?latitude=${cell.lat.toFixed(1)}&longitude=${cell.lon.toFixed(1)}` +
    `&daily=${DAILY.join(',')}&past_days=${PAST_DAYS}&forecast_days=${FORECAST_DAYS}&timezone=Europe%2FWarsaw`
  );
}

type Daily = Partial<Record<(typeof DAILY)[number] | 'time', (number | string | null)[]>>;

/** Odpowiedź Open-Meteo → dni (dzisiejszy dzień to `FORECAST_DAYS`-ty od końca). */
export function parseOpenMeteo(json: unknown): { days: WeatherDay[]; today: string } {
  const daily = (json as { daily?: Daily } | null)?.daily;
  const time = daily?.time;
  if (!daily || !Array.isArray(time) || time.length < FORECAST_DAYS || time.some((t) => typeof t !== 'string')) {
    throw new ServiceError('SERVER', 'Nieoczekiwana odpowiedź serwera pogody');
  }
  const num = (key: (typeof DAILY)[number], i: number) => {
    const v = daily[key]?.[i];
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  };
  const days = (time as string[]).map((date, i) => ({
    date,
    precipMm: num('precipitation_sum', i),
    tMinC: num('temperature_2m_min', i),
    tMaxC: num('temperature_2m_max', i),
    tMeanC: num('temperature_2m_mean', i),
    humidityPct: num('relative_humidity_2m_mean', i),
    weatherCode: num('weather_code', i),
  }));
  return { days, today: days[days.length - FORECAST_DAYS].date };
}

interface CacheEntry {
  /** Czas pobrania (ms). */
  at: number;
  today: string;
  days: WeatherDay[];
}

const memory = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<CacheEntry>>();
let restored: Promise<void> | null = null;

const fresh = (e: CacheEntry | undefined, now = Date.now()): e is CacheEntry =>
  !!e && now - e.at >= 0 && now - e.at < WEATHER_CACHE_TTL_MS;

/** Odtwarza kratki z AsyncStorage (raz na uruchomienie; błędy ignorujemy – to tylko pamięć podręczna). */
function restore(): Promise<void> {
  restored ??= AsyncStorage.getItem(WEATHER_STORAGE_KEY)
    .then((raw) => {
      const stored = raw ? (JSON.parse(raw) as Record<string, CacheEntry>) : {};
      for (const [key, e] of Object.entries(stored)) if (fresh(e) && !fresh(memory.get(key))) memory.set(key, e);
    })
    .catch(() => {});
  return restored;
}

/** Zapisuje świeże kratki (najwyżej kilka – stare i nadmiarowe znikają). */
function persist() {
  const keep = [...memory.entries()]
    .filter(([, e]) => fresh(e))
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, MAX_STORED_CELLS);
  AsyncStorage.setItem(WEATHER_STORAGE_KEY, JSON.stringify(Object.fromEntries(keep))).catch(() => {});
}

/** „Wyczyść dane”: pamięć podręczna pogody też znika (zawiera przybliżone współrzędne kratek). */
export function clearWeatherCache() {
  memory.clear();
  inflight.clear();
  restored = Promise.resolve();
  AsyncStorage.removeItem(WEATHER_STORAGE_KEY).catch(() => {});
}

async function download(cell: WeatherCell): Promise<CacheEntry> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), WEATHER_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(forecastUrl(cell), { signal: ctrl.signal, headers: { Accept: 'application/json' } });
  } catch {
    throw new ServiceError(
      'NETWORK',
      ctrl.signal.aborted ? 'Serwer pogody nie odpowiada' : 'Brak połączenia – prognoza niedostępna',
    );
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new ServiceError('SERVER', `Prognoza pogody niedostępna (${res.status})`);
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new ServiceError('SERVER', 'Nieoczekiwana odpowiedź serwera pogody');
  }
  const { days, today } = parseOpenMeteo(json);
  return { at: Date.now(), today, days };
}

/** Kratka z pamięci albo z sieci; jedno pobranie naraz na kratkę (wspólne dla wszystkich ekranów). */
async function loadCell(cell: WeatherCell): Promise<CacheEntry> {
  await restore();
  const hit = memory.get(cell.key);
  if (fresh(hit)) return hit;
  let job = inflight.get(cell.key);
  if (!job) {
    job = download(cell).then((e) => {
      memory.set(cell.key, e);
      persist();
      return e;
    });
    const settle = () => inflight.delete(cell.key);
    job.then(settle, settle);
    inflight.set(cell.key, job);
  }
  return job;
}

/** Przerwanie przez wołającego kończy tylko jego oczekiwanie – wspólne pobranie trwa dalej (dla innych ekranów). */
function abortable<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return p;
  if (signal.aborted) return Promise.reject(new ServiceError('CANCELLED', 'Anulowano'));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new ServiceError('CANCELLED', 'Anulowano'));
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

export const liveWeather: WeatherService = {
  async getForecast(req: ForecastRequest, opts) {
    const cell = weatherCell(req.lat, req.lon);
    const e = await abortable(loadCell(cell), opts?.signal);
    return computeForecast(e.days, { today: e.today, fetchedAt: new Date(e.at), source: 'open-meteo' });
  },
};
