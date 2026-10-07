/**
 * Prognoza grzybowa w symulacji (pozycja z panelu dev / scenariusze makiety): bez sieci, deterministyczna.
 * Pogoda jest zmyślona, ale prognozę liczy ten sam model co dla Open-Meteo (src/utils/forecast.ts).
 *
 * - Supraśl (gmina z makiety, też `?scenario=…`): stały przebieg pogody zakotwiczony w październiku – zawsze
 *   „Prognoza grzybowa 4/5” i „2 dni po deszczu” jak w pliku, niezależnie od daty uruchomienia.
 * - Inne gminy / punkty: pogoda z ziarna (gmina albo kratka) i dzisiejszej daty – stała w ciągu dnia,
 *   temperatury z polskich norm miesięcznych, więc zimą prognoza jest słaba jak naprawdę.
 */
import type { MushroomForecast, WeatherDay } from '@/types';
import { addDays, computeForecast, localYmd } from '@/utils/forecast';
import { hashString, mulberry32 } from '@/utils/random';

import type { ForecastRequest } from '../types';

/** Gmina z makiety – jej prognoza jest stała (4/5, 2 dni po deszczu). */
export const DESIGN_FORECAST_GMINA = 'suprasl';
/** „Dziś” przebiegu z makiety (październik = pełnia sezonu). */
export const DESIGN_TODAY = '2026-10-04';

/** Opady (mm), średnia / min / maks (°C), wilgotność (%) i kod WMO – 14 dni przed DESIGN_TODAY, dziś i 2 dni. */
const DESIGN_DAYS: [number, number, number, number, number, number][] = [
  [0, 13.1, 8.2, 18.0, 78, 2],
  [0, 12.6, 7.9, 17.2, 76, 1],
  [2.1, 11.4, 8.8, 14.0, 88, 61],
  [6.8, 10.9, 8.1, 13.6, 94, 63],
  [1.2, 11.8, 7.4, 15.9, 90, 51],
  [0, 12.9, 6.8, 18.4, 82, 2],
  [0, 13.4, 7.1, 19.0, 79, 1],
  [0, 12.2, 6.5, 17.6, 80, 3],
  [3.4, 11.8, 8.3, 14.9, 86, 61],
  [0.6, 12.4, 8.0, 16.1, 84, 51],
  [0, 13.1, 7.0, 18.3, 80, 2],
  [0.3, 12.6, 7.6, 17.0, 81, 3],
  [9.2, 11.2, 8.9, 13.4, 92, 63],
  [0.4, 11.9, 7.8, 15.6, 88, 51],
  [0, 12.5, 7.2, 16.8, 79, 2],
  [0.4, 11.8, 7.0, 15.1, 83, 3],
  [4.1, 10.6, 6.4, 13.2, 90, 61],
];

function day(date: string, [precipMm, tMeanC, tMinC, tMaxC, humidityPct, weatherCode]: (typeof DESIGN_DAYS)[number]): WeatherDay {
  return { date, precipMm, tMeanC, tMinC, tMaxC, humidityPct, weatherCode };
}

/** Pogoda z makiety: 14 dni przed DESIGN_TODAY, ten dzień i 2 kolejne. */
export function designWeather(): WeatherDay[] {
  return DESIGN_DAYS.map((d, i) => day(addDays(DESIGN_TODAY, i - 14), d));
}

/** Średnia temperatura miesiąca w Polsce (°C, przybliżone normy 1991–2020). */
const MONTH_MEAN_C = [-1.5, -0.5, 3, 8.5, 13.5, 17, 19, 18.5, 14, 9, 4, 0.5];

/** Zmyślona, ale wiarygodna pogoda: 14 dni przed `today`, dziś i 2 dni – stała dla ziarna i dnia. */
export function simulatedWeather(seed: string, today: string): WeatherDay[] {
  const rnd = mulberry32(hashString(`${seed}|${today}`));
  const normal = MONTH_MEAN_C[Number(today.slice(5, 7)) - 1];
  const wetness = rnd();
  const shift = (rnd() - 0.5) * 4;
  return Array.from({ length: 17 }, (_, i) => {
    const rainy = rnd() < 0.12 + 0.36 * wetness;
    const precip = rainy ? 1 + rnd() * 11 * (0.4 + wetness) : rnd() < 0.2 ? rnd() * 1.2 : 0;
    const mean = normal + shift + (rnd() - 0.5) * 5;
    const r1 = (x: number) => Math.round(x * 10) / 10;
    return {
      date: addDays(today, i - 14),
      precipMm: r1(precip),
      tMeanC: r1(mean),
      tMinC: r1(mean - 3 - rnd() * 3),
      tMaxC: r1(mean + 3 + rnd() * 4),
      humidityPct: Math.min(99, Math.round(62 + wetness * 16 + (rainy ? 10 : 0) + rnd() * 8)),
      weatherCode: precip >= 1 ? 61 : rnd() < 0.5 ? 3 : 1,
    };
  });
}

/** Prognoza w trybie symulacji (bez sieci). */
export function simulatedForecast(req: ForecastRequest, now: Date = new Date()): MushroomForecast {
  if (req.gminaId === DESIGN_FORECAST_GMINA) {
    return computeForecast(designWeather(), { today: DESIGN_TODAY, fetchedAt: now, source: 'sim' });
  }
  const today = localYmd(now);
  const seed = req.gminaId ?? `${req.lat.toFixed(1)},${req.lon.toFixed(1)}`;
  return computeForecast(simulatedWeather(seed, today), { today, fetchedAt: now, source: 'sim' });
}
