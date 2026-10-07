/**
 * Prognoza grzybowa z pogody – HEURYSTYKA, nie model naukowy. Ma być prosta i dać się wytłumaczyć
 * graczowi (lista `reasons`), a nie przewidywać wysyp co do dnia.
 *
 * Wejście: dni z Open-Meteo (14 dni wstecz, dziś, 2 dni naprzód). Składniki (każdy 0..1):
 * - **deszcz** – suma opadów z 14 dni (grzybnia potrzebuje ~2–3 tygodni wilgotnej ściółki):
 *   ≤ 5 mm → 0, liniowo do 35 mm → 1;
 * - **dni po deszczu** – od ostatniego dnia z opadem ≥ 3 mm: owocniki wyrastają zwykle 3–10 dni po
 *   opadach (0 dni → 0,5; 2 dni → 0,8; 3–10 → 1; 11 → 0,7, potem spada do 0,3; brak → 0);
 * - **temperatura** – średnia dobowa z 7 dni: najlepiej 10–20 °C, mróz → 0, upał > 26 °C → słabo;
 *   przymrozek (min ≤ −1 °C w ostatnich 5 dniach) połowi wynik;
 * - **wilgotność** – średnia z 7 dni: ≤ 55% → 0,1, liniowo do 85% → 1 (brak danych → 0,75).
 *
 * wilgoć = 0,65·deszcz + 0,35·dni po deszczu; warunki = temperatura × (0,55 + 0,45·wilgotność);
 * wynik = wilgoć × warunki × sezon (lip–paź 1; maj, cze, lis 0,75; gru–kwi 0,3 – wiosenne smardze pomijamy).
 * Iloczyn, bo bez wilgoci nie pomoże najlepsza temperatura (i odwrotnie). Skala 1–5: progi 0,2 / 0,4 / 0,6 / 0,8.
 */
import type { ForecastLabel, MushroomForecast, WeatherDay } from '@/types';
import { plural } from '@/utils/format';

/** Dzień „po deszczu” liczymy od opadu co najmniej tylu mm. */
export const RAIN_DAY_MM = 3;
/** Okno dni po deszczu (dalej = null, „bez deszczu od 2 tygodni”). */
export const MAX_DAYS_AFTER_RAIN = 14;

export const FORECAST_LABELS: readonly ForecastLabel[] = ['Słaba', 'Umiarkowana', 'Dobra', 'Bardzo dobra', 'Wyśmienita'];

const DAY_MS = 86_400_000;

/** Dni kalendarzowe od `from` do `to` (YYYY-MM-DD); dodatnie, gdy `to` jest później. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** Data YYYY-MM-DD przesunięta o `n` dni. */
export function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Zaokrąglenie współrzędnych wysyłanych do API pogodowego (stopnie; ~11 × 7 km w Polsce). */
export const WEATHER_CELL_DEG = 0.1;

export interface WeatherCell {
  lat: number;
  lon: number;
  /** „53.2,23.3” – klucz pamięci podręcznej. */
  key: string;
}

/** Kratka 0,1° – jedyne współrzędne, jakie opuszczają telefon (prognoza jest wspólna dla całej kratki). */
export function weatherCell(lat: number, lon: number): WeatherCell {
  const r = (v: number) => Number((Math.round(v / WEATHER_CELL_DEG) * WEATHER_CELL_DEG).toFixed(1));
  const cell = { lat: r(lat), lon: r(lon) };
  return { ...cell, key: `${cell.lat.toFixed(1)},${cell.lon.toFixed(1)}` };
}

/** Dzisiejsza data lokalna YYYY-MM-DD. */
export function localYmd(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const lerp = (x: number, x0: number, x1: number, y0: number, y1: number) => y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);

function mean(values: (number | null)[]): number | null {
  const v = values.filter((x): x is number => x != null && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

const dayMean = (d: WeatherDay) => d.tMeanC ?? (d.tMinC != null && d.tMaxC != null ? (d.tMinC + d.tMaxC) / 2 : null);

/** Dni od ostatniego dnia z opadem ≥ 3 mm (0 = dziś); null, gdy nie było go w ostatnich 14 dniach. */
export function daysAfterRain(days: WeatherDay[], today: string): number | null {
  let best: number | null = null;
  for (const d of days) {
    const ago = daysBetween(d.date, today);
    if (ago < 0 || ago > MAX_DAYS_AFTER_RAIN || (d.precipMm ?? 0) < RAIN_DAY_MM) continue;
    if (best == null || ago < best) best = ago;
  }
  return best;
}

export function rainScore(rain14Mm: number): number {
  return clamp01((rain14Mm - 5) / 30);
}

export function afterRainScore(days: number | null): number {
  if (days == null) return 0;
  if (days <= 0) return 0.5;
  if (days === 1) return 0.6;
  if (days === 2) return 0.8;
  if (days <= 10) return 1;
  return Math.max(0.3, 0.85 - (days - 10) * 0.15);
}

export function temperatureScore(meanC: number | null, frost = false): number {
  if (meanC == null) return 0.5;
  let s: number;
  if (meanC <= 0) s = 0;
  else if (meanC < 5) s = lerp(meanC, 0, 5, 0, 0.3);
  else if (meanC < 10) s = lerp(meanC, 5, 10, 0.3, 1);
  else if (meanC <= 20) s = 1;
  else if (meanC <= 26) s = lerp(meanC, 20, 26, 1, 0.5);
  else s = Math.max(0.2, lerp(meanC, 26, 30, 0.5, 0.2));
  return frost ? s * 0.5 : s;
}

export function humidityScore(pct: number | null): number {
  if (pct == null) return 0.75;
  return clamp01(lerp(pct, 55, 85, 0.1, 1));
}

/** Mnożnik pory roku (miesiąc 1–12): lip–paź pełnia, maj–cze i listopad średnio, gru–kwi nisko. */
export function seasonFactor(month: number): number {
  if (month >= 7 && month <= 10) return 1;
  if (month === 5 || month === 6 || month === 11) return 0.75;
  return 0.3;
}

/** Wynik 0..1 → skala 1–5. */
export function scoreFromRaw(raw: number): number {
  if (raw >= 0.8) return 5;
  if (raw >= 0.6) return 4;
  if (raw >= 0.4) return 3;
  if (raw >= 0.2) return 2;
  return 1;
}

const fmtMm = (mm: number) => `${Math.round(mm)} mm`;
const fmtC = (c: number) => `${Math.round(c) === 0 ? 0 : Math.round(c)}`.replace('-', '−') + ' °C';

function rainReason(mm: number): string {
  if (mm >= 35) return `Dużo deszczu w ostatnich 2 tygodniach (${fmtMm(mm)})`;
  if (mm >= 15) return `Umiarkowane opady w ostatnich 2 tygodniach (${fmtMm(mm)})`;
  if (mm >= 5) return `Mało deszczu w ostatnich 2 tygodniach (${fmtMm(mm)})`;
  return mm >= 1 ? `Sucho – tylko ${fmtMm(mm)} deszczu w 2 tygodnie` : 'Sucho – grzybnia potrzebuje wilgoci';
}

function afterRainReason(d: number | null): string {
  if (d == null) return 'Bez większego deszczu od 2 tygodni';
  if (d === 0) return 'Pada dziś – wysyp zwykle 3–10 dni po deszczu';
  if (d === 1) return 'Deszcz wczoraj – grzyby ruszą za kilka dni';
  if (d === 2) return 'Deszcz 2 dni temu – grzyby zaczynają rosnąć';
  if (d <= 10) return `${d} dni po deszczu – najlepszy moment`;
  return `Ostatni deszcz ${d} dni temu – ściółka przesycha`;
}

function temperatureReason(c: number): string {
  const word = c <= 0 ? 'Mróz' : c < 5 ? 'Zimno' : c < 10 ? 'Chłodno' : c <= 20 ? 'Ciepło' : c <= 26 ? 'Gorąco' : 'Upał';
  return `${word}, ${fmtC(c)}`;
}

function humidityReason(pct: number): string {
  const p = `${Math.round(pct)}%`;
  if (pct >= 85) return `Wilgotne powietrze (${p})`;
  if (pct >= 70) return `Umiarkowana wilgotność (${p})`;
  return `Suche powietrze (${p})`;
}

function seasonReason(month: number): string {
  if (month >= 7 && month <= 10) return 'Pełnia sezonu grzybowego';
  if (month === 5 || month === 6) return 'Początek sezonu grzybowego';
  if (month === 11) return 'Koniec sezonu grzybowego';
  return 'Poza sezonem grzybowym';
}

export interface ForecastOptions {
  /** Dzisiejsza data (YYYY-MM-DD) w strefie danych – dni wcześniejsze to historia, późniejsze to prognoza. */
  today: string;
  /** Czas pobrania danych (→ `updatedAt`). */
  fetchedAt?: Date;
  source: MushroomForecast['source'];
}

/** Prognoza grzybowa z dni pogodowych (heurystyka z nagłówka pliku). */
export function computeForecast(days: WeatherDay[], opts: ForecastOptions): MushroomForecast {
  const { today } = opts;
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const ago = (d: WeatherDay) => daysBetween(d.date, today);
  const lastDays = (n: number) => sorted.filter((d) => ago(d) >= 0 && ago(d) < n);

  const rain14Mm = Math.round(lastDays(14).reduce((a, d) => a + (d.precipMm ?? 0), 0) * 10) / 10;
  const dar = daysAfterRain(sorted, today);
  const week = lastDays(7);
  const tMean = mean(week.map(dayMean));
  const frost = lastDays(5).some((d) => d.tMinC != null && d.tMinC <= -1);
  const humidity = mean(week.map((d) => d.humidityPct));
  const month = Number(today.slice(5, 7));

  const moisture = 0.65 * rainScore(rain14Mm) + 0.35 * afterRainScore(dar);
  const conditions = temperatureScore(tMean, frost) * (0.55 + 0.45 * humidityScore(humidity));
  const raw = moisture * conditions * seasonFactor(month);
  const score = scoreFromRaw(raw);

  const reasons = [rainReason(rain14Mm), afterRainReason(dar)];
  if (tMean != null) reasons.push(temperatureReason(tMean));
  if (frost) reasons.push('Przymrozki w ostatnich dniach');
  if (humidity != null) reasons.push(humidityReason(humidity));
  reasons.push(seasonReason(month));

  return {
    score,
    label: FORECAST_LABELS[score - 1],
    daysAfterRain: dar,
    rain14Mm,
    reasons,
    outlook: sorted.filter((d) => ago(d) <= 0 && ago(d) > -3),
    updatedAt: (opts.fetchedAt ?? new Date()).toISOString(),
    source: opts.source,
  };
}

/** Pigułka „2 dni po deszczu” / „1 dzień po deszczu” / „Deszcz dziś” / „Bez deszczu od 2 tygodni”. */
export function rainPillLabel(daysAfterRain: number | null): string {
  if (daysAfterRain == null) return 'Bez deszczu od 2 tygodni';
  if (daysAfterRain === 0) return 'Deszcz dziś';
  return `${daysAfterRain} ${plural(daysAfterRain, 'dzień', 'dni', 'dni')} po deszczu`;
}

/** „Prognoza grzybowa 4/5” */
export function forecastPillLabel(score: number): string {
  return `Prognoza grzybowa ${score}/5`;
}

/** Ikona dnia z kodu pogody WMO (tylko ikony dostępne w aplikacji). */
export function weatherIcon(code: number | null, precipMm: number | null): 'wb_sunny' | 'cloud' | 'water_drop' | 'thunderstorm' {
  if (code != null && code >= 95) return 'thunderstorm';
  if ((precipMm ?? 0) >= 1 || (code != null && code >= 51 && code <= 82)) return 'water_drop';
  if (code != null && code <= 1) return 'wb_sunny';
  return 'cloud';
}

/** „Dziś” / „Jutro” / „Pojutrze” dla kolejnych dni prognozy. */
export const OUTLOOK_NAMES = ['Dziś', 'Jutro', 'Pojutrze'] as const;

/** Wymagany podpis danych Open-Meteo (CC BY 4.0) – wszędzie, gdzie pokazujemy prognozę. */
export const WEATHER_ATTRIBUTION = 'Dane pogodowe: Open-Meteo.com (CC BY 4.0)';
export const WEATHER_ATTRIBUTION_URL = 'https://open-meteo.com/';

/** Podpis źródła prognozy (symulacja nie korzysta z Open-Meteo). */
export function forecastAttribution(source: MushroomForecast['source']): string {
  return source === 'sim' ? 'Prognoza symulowana (panel dev) – dane przykładowe' : WEATHER_ATTRIBUTION;
}
