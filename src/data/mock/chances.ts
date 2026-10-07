/**
 * Mocki szans na gatunki i mapy gatunku – z tych samych generatorów co „Co tu się zbiera” (buildGminaStats):
 * udziały gatunków w zbiorach gminy = 4 gatunki z rozkładu gminy wg procentów, „Inne” – reszta katalogu wg prioru
 * modelu szans (rzadkość × popularność × siedlisko × sezon). Deterministycznie (gmina × tydzień), bez sieci.
 * Te same reguły prywatności co RPC na serwerze: gatunek / gmina z < 2 znalazcami pominięte, zbiory gminy z mniej
 * niż 3 znalazcami albo 5 znaleziskami w oknie → brak danych.
 */
import type { Gmina, GminaSpeciesEvidence, Species, SpeciesMap, SpeciesMapPeriod } from '@/types';
import {
  abundanceOf,
  EVIDENCE_DAYS,
  habitatFit,
  habitatsOf,
  RARITY_WEIGHT,
  seasonActivity,
  seasonAt,
  seasonWeightsOf,
} from '@/utils/chances';
import { addDays } from '@/utils/forecast';
import { hashString, mulberry32 } from '@/utils/random';
import { buildGminaStats } from './gminy';

/** Progi prywatności – jak w get_gmina_species_evidence / get_species_map (supabase/migrations/20261013120000_chances.sql). */
export const MIN_SPECIES_FINDERS = 2;
export const MIN_TOTAL_FINDERS = 3;
export const MIN_TOTAL_FINDS = 5;

/** Efektywna długość sezonu (dni) – zbiory sezonu gminy („mushrooms”) rozłożone na tyle dni. */
const SEASON_DAYS = 120;

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/** „Pieprznik jadalny (kurka)” → „Pieprznik jadalny” – tak gatunki nazywa rozkład gminy. */
const baseName = (name: string) => name.replace(/ \(.*\)$/, '');

/** Średnia waga sezonu w miesiącach VI–X (sezon w rozkładzie gminy). */
function seasonMean(w: readonly number[]): number {
  let s = 0;
  for (let m = 5; m <= 9; m++) s += w[m] ?? 0;
  return s / 5;
}

/** Numer tygodnia (od poniedziałku) – ziarno mocków stałe w tygodniu. */
function weekKey(date: string): number {
  const days = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
  return Math.floor((days + 3) / 7);
}

/**
 * Udziały gatunków w zbiorach gminy (suma 1). `date` – dzień (okno danych: gatunki poza sezonem słabną), brak – cały
 * sezon (jak „Co tu się zbiera”).
 */
export function mockSpeciesShares(gmina: Gmina, species: Species[], date?: string): Map<string, number> {
  const stats = buildGminaStats(gmina, 0);
  const byName = new Map(species.map((s) => [baseName(s.name), s]));
  const out = new Map<string, number>();
  let inne = 0;
  for (const d of stats.distribution) {
    const s = d.name === 'Inne' ? undefined : byName.get(d.name);
    if (!s) {
      inne += d.pct;
      continue;
    }
    const w = seasonWeightsOf(s);
    const adj = date ? clamp(seasonAt(w, date) / Math.max(0.05, seasonMean(w)), 0, 2) : 1;
    out.set(s.id, (d.pct / 100) * adj);
  }
  const others = species.filter((s) => !out.has(s.id));
  const prior = (s: Species, season: number) =>
    RARITY_WEIGHT[s.rarity] * abundanceOf(s) * habitatFit(habitatsOf(s), gmina.forestPct) * Math.max(0, season);
  const raw = others.map((s) => prior(s, date ? seasonAt(seasonWeightsOf(s), date) : seasonMean(seasonWeightsOf(s))));
  const rawSeason = others.map((s) => prior(s, seasonMean(seasonWeightsOf(s))));
  const sum = raw.reduce((a, b) => a + b, 0);
  const sumSeason = rawSeason.reduce((a, b) => a + b, 0);
  // „Inne” w oknie: ta sama masa co w sezonie × sezonowość pozostałych gatunków w tym dniu.
  const inneMass = (inne / 100) * (date && sumSeason > 0 ? clamp(sum / sumSeason, 0, 2) : 1);
  others.forEach((s, i) => out.set(s.id, sum > 0 ? (inneMass * raw[i]) / sum : 0));
  const total = [...out.values()].reduce((a, b) => a + b, 0);
  if (total > 0) out.forEach((v, k) => out.set(k, v / total));
  return out;
}

/** Losowe zaokrąglenie (wartość oczekiwana bez zmian) i liczba znalazców dla `n` znalezisk. */
function draw(rnd: () => number, expected: number): { finds: number; finders: number } {
  const finds = Math.max(0, Math.floor(expected + rnd()));
  const finders = finds === 0 ? 0 : clamp(Math.round(finds / (1.5 + rnd() * 2)), 1, finds);
  return { finds, finders };
}

/**
 * Zbiory gminy z ostatnich `days` dni przed `date` (mock RPC get_gmina_species_evidence): łącznie ≈ zbiory sezonu
 * gminy × days / 120 × aktywność sezonu (±25% na tydzień), gatunki wg `mockSpeciesShares`.
 */
export function mockEvidence(gmina: Gmina, species: Species[], date: string, days = EVIDENCE_DAYS): GminaSpeciesEvidence {
  const rnd = mulberry32(hashString(`evidence:${gmina.id}:${weekKey(date)}:${days}`));
  const mid = addDays(date, -Math.round(days / 2));
  const season = buildGminaStats(gmina, 0).mushrooms;
  const expectedTotal = ((season * days) / SEASON_DAYS) * seasonActivity(species, mid) * (0.75 + rnd() * 0.5);
  const shares = mockSpeciesShares(gmina, species, mid);
  const list: GminaSpeciesEvidence['species'] = [];
  let total = 0;
  let maxFinders = 0;
  for (const s of species) {
    const { finds, finders } = draw(rnd, expectedTotal * (shares.get(s.id) ?? 0));
    total += finds;
    maxFinders = Math.max(maxFinders, finders);
    if (finders >= MIN_SPECIES_FINDERS) list.push({ speciesId: s.id, finds, finders });
  }
  const totalFinders = Math.max(maxFinders, Math.round(total / 3.5));
  if (total < MIN_TOTAL_FINDS || totalFinders < MIN_TOTAL_FINDERS) return { gminaId: gmina.id, days, total: 0, species: [] };
  list.sort((a, b) => b.finds - a.finds || a.speciesId.localeCompare(b.speciesId));
  return { gminaId: gmina.id, days, total, species: list };
}

/** Część sezonu, która już minęła (zbiory od 1 stycznia do `date` względem całego roku). */
function seasonElapsed(species: Species[], date: string): number {
  const year = date.slice(0, 4);
  let done = 0;
  let all = 0;
  for (let m = 1; m <= 12; m++) {
    const day = `${year}-${String(m).padStart(2, '0')}-15`;
    const a = seasonActivity(species, day);
    all += a;
    if (day <= date) done += a;
  }
  return all > 0 ? done / all : 1;
}

/**
 * Mapa gatunku w województwie (mock RPC get_species_map): znaleziska gatunku w każdej gminie z generatora
 * (sezon – zbiory sezonu gminy dotąd, tydzień – ostatnie 7 dni), gminy z < 2 znalazcami pominięte; stopnie 1–4
 * wg miejsca (remis = ten sam stopień), 5 gmin z największą liczbą znalezisk.
 */
export function mockSpeciesMap(
  speciesId: string,
  voivodeship: string,
  gminy: Gmina[],
  species: Species[],
  date: string,
  period: SpeciesMapPeriod,
): SpeciesMap {
  const elapsed = period === 'season' ? seasonElapsed(species, date) : 0;
  const mid = addDays(date, -3);
  const activity = period === 'week' ? seasonActivity(species, mid) : 0;
  const rows: { gminaId: string; name: string; finds: number }[] = [];
  for (const g of gminy) {
    const rnd = mulberry32(hashString(`map:${speciesId}:${g.id}:${period}:${weekKey(date)}`));
    const season = buildGminaStats(g, 0).mushrooms;
    const share = mockSpeciesShares(g, species, period === 'week' ? mid : undefined).get(speciesId) ?? 0;
    const n = period === 'season' ? season * elapsed : ((season * 7) / SEASON_DAYS) * activity;
    const { finds, finders } = draw(rnd, n * share * (0.7 + rnd() * 0.6));
    if (finders >= MIN_SPECIES_FINDERS) rows.push({ gminaId: g.id, name: g.name, finds });
  }
  rows.sort((a, b) => b.finds - a.finds || a.name.localeCompare(b.name, 'pl') || a.gminaId.localeCompare(b.gminaId));
  const heat: Record<string, number> = {};
  let rank = 0;
  rows.forEach((r, i) => {
    if (i === 0 || r.finds !== rows[i - 1].finds) rank = i + 1;
    heat[r.gminaId] = 4 - Math.floor((4 * (rank - 1)) / rows.length);
  });
  return {
    speciesId,
    voivodeship,
    period,
    heat,
    top: rows.slice(0, 5),
    total: rows.reduce((a, r) => a + r.finds, 0),
  };
}
