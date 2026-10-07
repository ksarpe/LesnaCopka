/**
 * Rankingi i statystyki gmin z serwera (RPC `get_ranking`, `get_gmina_stats`, `get_species_percentile`) → typy
 * aplikacji. Czyste funkcje bez zależności od React Native (testy: ./__tests__/statsMap.test.ts). Parsowanie
 * obronne (brakujące pola → wartości neutralne), formatowanie jak w mockach (src/data/mock/gminy.ts): punkty
 * „18 420”, rekordy „42 rek.”, podpis „Puszcza Knyszyńska · 1 248 grzybiarzy”, rekord „2,3 kg” / „Ø 27 cm”.
 * Kontrakt (camelCase jsonb): docs/backend.md.
 */
import type { AcceptedChallenge } from '@/store/useUserStore';
import type {
  GminaChallenge,
  GminaRecord,
  GminaStats,
  Ranking,
  RankingPeriod,
  RankingRow,
  Rarity,
  SpeciesPercentile,
} from '@/types';
import { fmtDaysAgo, fmtInt, fmtMushroomers, fmtWeight, placeLabel } from '@/utils/format';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, d = 0): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : d;
};
const numOrNull = (v: unknown): number | null => (v == null || v === '' ? null : Number.isFinite(num(v, NaN)) ? num(v) : null);
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : v == null ? d : String(v));
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
/** Odpowiedź RPC: obiekt, tablica z jednym wierszem albo JSON w tekście. */
const parse = (raw: unknown): unknown => {
  let r = raw;
  if (typeof r === 'string') {
    try {
      r = JSON.parse(r) as unknown;
    } catch {
      return null;
    }
  }
  return Array.isArray(r) && r.length <= 1 && (r.length === 0 || isObj(r[0])) ? (r[0] ?? null) : r;
};
const list = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : []);

const RARITIES: Rarity[] = ['pospolity', 'rzadki', 'epicki', 'legendarny'];
const PERIODS: RankingPeriod[] = ['week', 'season', 'records'];

/* ───────────────────────── Ranking ───────────────────────── */

/** Punkty jak w mockach: „18 420”, w rankingu rekordów „42 rek.”. */
export function rankingPoints(period: RankingPeriod, points: number): string {
  return period === 'records' ? `${fmtInt(points)} rek.` : fmtInt(points);
}

/** Podpis wiersza: kompleks leśny albo miejsce gminy + aktywni grzybiarze okresu („1 grzybiarz”, „5 grzybiarzy”). */
export function rankingSub(g: { forest?: string | null; kind?: string; powiat?: string | null; mushroomers: number }): string {
  const n = Math.max(0, Math.round(g.mushroomers));
  return `${g.forest || placeLabel(g)} · ${fmtMushroomers(n)}`;
}

/**
 * `get_ranking` → Ranking. Wiersze tylko z gmin z punktami w okresie (od 1. miejsca); stopnie mapy cieplnej
 * z serwera (gmina bez wpisu = 0), grzybiarze do podpowiedzi na mapie – z wierszy.
 */
export function mapRanking(raw: unknown, period: RankingPeriod, voivodeship: string): Ranking {
  const r = parse(raw);
  const o = isObj(r) ? r : {};
  const p = PERIODS.includes(o.period as RankingPeriod) ? (o.period as RankingPeriod) : period;
  const mushroomers: Record<string, number> = {};
  const rows: RankingRow[] = list(o.rows)
    .filter((x) => str(x.gminaId))
    .map((x, i) => {
      const id = str(x.gminaId);
      const m = Math.max(0, num(x.mushroomers));
      mushroomers[id] = m;
      const trend = numOrNull(x.trend);
      return {
        gminaId: id,
        rank: Math.max(1, Math.round(num(x.rank, i + 1))),
        name: str(x.name) || id,
        sub: rankingSub({ forest: strOrNull(x.forest), kind: str(x.kind), powiat: strOrNull(x.powiat), mushroomers: m }),
        points: rankingPoints(p, num(x.points)),
        trend: trend ? Math.round(trend) : null,
      };
    })
    .sort((a, b) => a.rank - b.rank);
  const heat: Record<string, number> = {};
  Object.entries(isObj(o.heat) ? o.heat : {}).forEach(([id, v]) => {
    const level = Math.max(0, Math.min(4, Math.round(num(v))));
    if (level > 0) heat[id] = level;
  });
  return {
    period: p,
    voivodeship: str(o.voivodeship) || voivodeship,
    rows,
    heat,
    mushroomers,
    userContribution: Math.max(0, num(o.userContribution)),
  };
}

/* ───────────────────────── Statystyki gminy ───────────────────────── */

const fmtCm = (cm: number) => String(Math.round(cm * 10) / 10).replace('.', ',');

/** Wartość rekordu: waga („410 g”, „2,3 kg”), a bez wagi – średnica kapelusza („Ø 27 cm”). */
export function recordValue(rec: { weightG?: number | null; capCm?: number | null }): string {
  if (rec.weightG != null && rec.weightG > 0) return fmtWeight(rec.weightG);
  if (rec.capCm != null && rec.capCm > 0) return `Ø ${fmtCm(rec.capCm)} cm`;
  return '';
}

export function mapGminaRecord(x: Obj, now = Date.now()): GminaRecord {
  return {
    rarity: RARITIES.includes(x.rarity as Rarity) ? (x.rarity as Rarity) : 'pospolity',
    speciesName: str(x.speciesName),
    value: recordValue({ weightG: numOrNull(x.weightG), capCm: numOrNull(x.capCm) }),
    author: str(x.author) || 'Grzybiarz',
    when: fmtDaysAgo(str(x.foundOn), now),
  };
}

/** Wyzwanie z serwera (odznaka i termin opcjonalne). */
export function mapChallenge(raw: unknown): GminaChallenge | null {
  if (!isObj(raw) || !str(raw.id)) return null;
  const c: GminaChallenge = {
    id: str(raw.id),
    title: str(raw.title),
    speciesId: str(raw.speciesId),
    description: str(raw.description),
    xp: Math.max(0, num(raw.xp)),
  };
  const badgeId = strOrNull(raw.badgeId);
  const badgeName = strOrNull(raw.badgeName);
  const endsAt = strOrNull(raw.endsAt);
  if (badgeId) c.badgeId = badgeId;
  if (badgeName) c.badgeName = badgeName;
  if (endsAt) c.endsAt = endsAt;
  return c;
}

/** `get_gmina_stats` → GminaStats (rekordy, rozkład gatunków, wyzwanie i stan gracza wobec gminy). */
export function mapGminaStats(raw: unknown, gminaId: string, now = Date.now()): GminaStats {
  const r = parse(raw);
  const o = isObj(r) ? r : {};
  const rank = numOrNull(o.rank);
  const stats: GminaStats = {
    gminaId: str(o.gminaId) || gminaId,
    rank: rank != null && rank >= 1 ? Math.round(rank) : null,
    mushroomers: Math.max(0, num(o.mushroomers)),
    mushrooms: Math.max(0, num(o.mushrooms)),
    species: Math.max(0, num(o.species)),
    records: list(o.records)
      .filter((x) => str(x.speciesName))
      .map((x) => mapGminaRecord(x, now)),
    distribution: list(o.distribution)
      .filter((x) => str(x.name))
      .map((x) => ({ name: str(x.name), pct: Math.max(0, Math.round(num(x.pct))) })),
    challenge: mapChallenge(o.challenge),
    challengeAccepted: o.challengeAccepted === true,
    challengeCompleted: o.challengeCompleted === true,
    followed: o.followed === true,
  };
  const name = strOrNull(o.name);
  if (name) stats.name = name;
  return stats;
}

/* ───────────────────────── Percentyl okazu ───────────────────────── */

/** `get_species_percentile` → SpeciesPercentile; `collected = 0` = brak danych w gminie w tym sezonie. */
export function mapPercentile(raw: unknown, ids: { speciesId: string; gminaId: string }): SpeciesPercentile {
  const r = parse(raw);
  const o = isObj(r) ? r : {};
  const collected = Math.max(0, Math.round(num(o.collected)));
  return {
    speciesId: str(o.speciesId) || ids.speciesId,
    gminaId: str(o.gminaId) || ids.gminaId,
    collected,
    mushroomers: Math.max(0, Math.round(num(o.mushroomers))),
    sizeRank: Math.max(1, Math.round(num(o.sizeRank, 1))),
    percentile: Math.max(0, Math.min(100, Math.round(num(o.percentile)))),
    biggerCount: Math.max(0, Math.round(num(o.biggerCount))),
  };
}

/* ───────────────────────── Stan gracza wobec gminy ───────────────────────── */

export interface GminaPlayerState {
  followedGminy: string[];
  challenges: AcceptedChallenge[];
}

/**
 * Ekran gminy (tryb Supabase): „Obserwuj” i „Wyzwanie przyjęte” z serwera, o ile w kolejce nie czeka nowsza
 * zmiana gracza (`pending`). Wyzwanie przyjęte na serwerze (np. na innym telefonie) trafia do zadań dnia, odrzucone
 * znika; ukończonego nie dokładamy (pobranie stanu gry da je z datą ukończenia). Zwraca zmiany albo null.
 */
export function reconcileGminaState(
  local: GminaPlayerState,
  stats: GminaStats,
  pending: { follow: boolean; accept: boolean },
  now = Date.now(),
): Partial<GminaPlayerState> | null {
  const out: Partial<GminaPlayerState> = {};
  const id = stats.gminaId;
  if (stats.followed != null && !pending.follow && local.followedGminy.includes(id) !== stats.followed) {
    out.followedGminy = stats.followed ? [...local.followedGminy, id] : local.followedGminy.filter((g) => g !== id);
  }
  const ch = stats.challenge;
  if (ch && stats.challengeAccepted != null && !pending.accept) {
    const has = local.challenges.some((c) => c.id === ch.id);
    if (stats.challengeAccepted && !has && !stats.challengeCompleted) {
      out.challenges = [...local.challenges, { ...ch, gminaId: id, acceptedAt: new Date(now).toISOString() }];
    } else if (!stats.challengeAccepted && has) {
      out.challenges = local.challenges.filter((c) => c.id !== ch.id);
    }
  }
  return Object.keys(out).length ? out : null;
}
