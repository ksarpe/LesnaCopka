import { describe, expect, it } from '@jest/globals';

import { DESIGN_TODAY, designWeather, simulatedForecast } from '../../services/mock/weather';
import type { WeatherDay } from '../../types';
import {
  addDays,
  computeForecast,
  daysAfterRain,
  forecastPillLabel,
  rainPillLabel,
  seasonFactor,
  weatherCell,
  weatherIcon,
} from '../forecast';

const TODAY = '2026-09-15';

/** 14 dni historii + dziś + 2 dni prognozy; `rain[i]` = opad i dni temu (ujemne = przyszłość). */
function series(opts: { today?: string; rain?: Record<number, number>; tMean?: number; tMin?: number; humidity?: number }): WeatherDay[] {
  const today = opts.today ?? TODAY;
  const t = opts.tMean ?? 14;
  return Array.from({ length: 17 }, (_, i) => {
    const ago = 14 - i;
    return {
      date: addDays(today, -ago),
      precipMm: opts.rain?.[ago] ?? 0,
      tMeanC: t,
      tMinC: opts.tMin ?? t - 5,
      tMaxC: t + 5,
      humidityPct: opts.humidity ?? 85,
      weatherCode: 3,
    };
  });
}

const forecast = (days: WeatherDay[], today = TODAY) => computeForecast(days, { today, source: 'open-meteo' });

describe('daysAfterRain', () => {
  it('dni od ostatniego dnia z opadem ≥ 3 mm; mżawka się nie liczy', () => {
    expect(daysAfterRain(series({ rain: { 9: 12, 4: 5, 1: 2.9 } }), TODAY)).toBe(4);
    expect(daysAfterRain(series({ rain: { 0: 3 } }), TODAY)).toBe(0);
  });

  it('null, gdy przez 14 dni nie padało; prognoza na jutro się nie liczy', () => {
    expect(daysAfterRain(series({ rain: { [-1]: 20, 1: 1 } }), TODAY)).toBeNull();
    expect(daysAfterRain(series({ rain: { 14: 10 } }), TODAY)).toBe(14);
    const older = [{ ...series({})[0], date: addDays(TODAY, -15), precipMm: 30 }];
    expect(daysAfterRain(older, TODAY)).toBeNull();
  });
});

describe('computeForecast', () => {
  it('makieta: Supraśl w październiku → 4/5 „Bardzo dobra”, 2 dni po deszczu', () => {
    const f = computeForecast(designWeather(), { today: DESIGN_TODAY, source: 'sim' });
    expect(f.score).toBe(4);
    expect(f.label).toBe('Bardzo dobra');
    expect(f.daysAfterRain).toBe(2);
    expect(f.rain14Mm).toBe(24);
    expect(f.reasons).toContain('Ciepło, 12 °C');
    expect(f.outlook.map((d) => d.date)).toEqual(['2026-10-04', '2026-10-05', '2026-10-06']);
  });

  it('mokro, ciepło i wilgotno w sezonie → 5/5 z uzasadnieniem', () => {
    const f = forecast(series({ rain: { 12: 15, 9: 12, 6: 10, 5: 4 } }));
    expect(f.score).toBe(5);
    expect(f.label).toBe('Wyśmienita');
    expect(f.daysAfterRain).toBe(5);
    expect(f.reasons).toEqual([
      'Dużo deszczu w ostatnich 2 tygodniach (41 mm)',
      '5 dni po deszczu – najlepszy moment',
      'Ciepło, 14 °C',
      'Wilgotne powietrze (85%)',
      'Pełnia sezonu grzybowego',
    ]);
  });

  it('susza → co najwyżej 2/5 („Bez deszczu od 2 tygodni”)', () => {
    const f = forecast(series({ rain: { 3: 1 }, humidity: 60 }));
    expect(f.score).toBeLessThanOrEqual(2);
    expect(f.daysAfterRain).toBeNull();
    expect(f.reasons[0]).toBe('Sucho – tylko 1 mm deszczu w 2 tygodnie');
    expect(f.reasons).toContain('Bez większego deszczu od 2 tygodni');
  });

  it('świeży deszcz to jeszcze nie wysyp – wynik niższy niż tydzień później', () => {
    const fresh = forecast(series({ rain: { 0: 15, 1: 5 } }));
    const later = forecast(series({ rain: { 7: 15, 8: 5 } }));
    expect(fresh.daysAfterRain).toBe(0);
    expect(fresh.score).toBeLessThan(later.score);
    expect(fresh.reasons).toContain('Pada dziś – wysyp zwykle 3–10 dni po deszczu');
  });

  it('pora roku: ta sama pogoda w styczniu i w maju słabsza niż we wrześniu', () => {
    const rain = { 9: 15, 6: 15, 4: 10 };
    const sep = forecast(series({ rain }));
    const may = forecast(series({ rain, today: '2026-05-15' }), '2026-05-15');
    const jan = forecast(series({ rain, today: '2026-01-15' }), '2026-01-15');
    expect(sep.score).toBe(5);
    expect(may.score).toBeLessThan(sep.score);
    expect(jan.score).toBeLessThanOrEqual(2);
    expect(jan.reasons).toContain('Poza sezonem grzybowym');
    expect([seasonFactor(8), seasonFactor(11), seasonFactor(2)]).toEqual([1, 0.75, 0.3]);
  });

  it('mróz i przymrozki obniżają ocenę', () => {
    const rain = { 9: 15, 6: 15, 4: 10 };
    const frost = forecast(series({ rain, tMean: 4, tMin: -3 }));
    expect(frost.score).toBeLessThanOrEqual(2);
    expect(frost.reasons).toContain('Przymrozki w ostatnich dniach');
    expect(frost.reasons).toContain('Zimno, 4 °C');
    expect(forecast(series({ rain, tMean: -2 })).reasons).toContain('Mróz, −2 °C');
  });

  it('brak części danych (null) nie psuje wyniku', () => {
    const days = series({ rain: { 5: 20, 8: 10 } }).map((d) => ({ ...d, humidityPct: null, tMeanC: null }));
    const f = forecast(days);
    expect(f.score).toBeGreaterThanOrEqual(1);
    expect(f.reasons.some((r) => /wilgotn/i.test(r))).toBe(false);
    expect(f.reasons).toContain('Ciepło, 14 °C');
  });
});

describe('etykiety i pomocnicze', () => {
  it('pigułki z makiety', () => {
    expect(forecastPillLabel(4)).toBe('Prognoza grzybowa 4/5');
    expect(rainPillLabel(2)).toBe('2 dni po deszczu');
    expect(rainPillLabel(1)).toBe('1 dzień po deszczu');
    expect(rainPillLabel(0)).toBe('Deszcz dziś');
    expect(rainPillLabel(null)).toBe('Bez deszczu od 2 tygodni');
  });

  it('kratka 0,1° – do API idzie tylko przybliżona okolica', () => {
    expect(weatherCell(53.21, 23.34)).toEqual({ lat: 53.2, lon: 23.3, key: '53.2,23.3' });
    expect(weatherCell(50.0612, 19.9373)).toEqual({ lat: 50.1, lon: 19.9, key: '50.1,19.9' });
    expect(weatherCell(53.2049, 23.2951).key).toBe(weatherCell(53.21, 23.34).key);
  });

  it('ikona dnia z kodu WMO', () => {
    expect(weatherIcon(0, 0)).toBe('wb_sunny');
    expect(weatherIcon(3, 0)).toBe('cloud');
    expect(weatherIcon(61, 4)).toBe('water_drop');
    expect(weatherIcon(95, 10)).toBe('thunderstorm');
  });
});

describe('symulacja', () => {
  it('Supraśl zawsze jak w makiecie – także zimą', () => {
    const f = simulatedForecast({ lat: 53.2, lon: 23.3, gminaId: 'suprasl' }, new Date(2027, 0, 20, 12));
    expect([f.score, f.daysAfterRain, f.source]).toEqual([4, 2, 'sim']);
  });

  it('inne gminy: deterministycznie w ciągu dnia', () => {
    const at = new Date(2026, 8, 10, 9);
    const a = simulatedForecast({ lat: 52.2, lon: 21, gminaId: 'warszawa' }, at);
    const b = simulatedForecast({ lat: 52.2, lon: 21, gminaId: 'warszawa' }, new Date(2026, 8, 10, 18));
    expect(b.score).toBe(a.score);
    expect(b.reasons).toEqual(a.reasons);
    expect(a.outlook).toHaveLength(3);
    expect(a.score).toBeGreaterThanOrEqual(1);
    expect(a.score).toBeLessThanOrEqual(5);
  });
});
