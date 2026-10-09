/**
 * Walki o okaz z serwera (RPC `get_contest_week`, `get_contest_board`, `get_contest_eligibility`, `enter_contest`,
 * `get_trophies` – docs/rywalizacja.md §7) → typy aplikacji. Czyste funkcje bez zależności od React Native (testy:
 * ./__tests__/contestsMap.test.ts), parsowanie obronne jak ./statsMap.ts. Autorzy (`author_json`) – jak w feedzie
 * (./feedMap.ts → mapAuthor). Tytuł walki gatunku liczy telefon z katalogu (odmiana: „Największa czubajka kania”),
 * gdy zna gatunek – inaczej zostaje tytuł z serwera.
 */
import type {
  Contest,
  ContestBoard,
  ContestEligibility,
  ContestEntry,
  ContestKind,
  ContestMatch,
  ContestScope,
  ContestStatus,
  ContestWeek,
  Trophy,
  TrophyCase,
  TrophyPlace,
  UserAvatar,
} from '@/types';
import { contestTitle, parseContestId } from '@/utils/contests';
import { mapAuthor } from './feedMap';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, d = 0): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : d;
};
const int = (v: unknown, d = 0) => Math.max(0, Math.round(num(v, d)));
const numOrNull = (v: unknown): number | null => (v == null || v === '' ? null : Number.isFinite(num(v, NaN)) ? num(v) : null);
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : v == null ? d : String(v));
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
/** Odpowiedź RPC: obiekt, tablica z jednym wierszem albo JSON w tekście. */
const parse = (raw: unknown): Obj => {
  let r = raw;
  if (typeof r === 'string') {
    try {
      r = JSON.parse(r) as unknown;
    } catch {
      return {};
    }
  }
  if (Array.isArray(r)) r = r[0];
  return isObj(r) ? r : {};
};
const list = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : []);

const STATUSES: ContestStatus[] = ['open', 'judging', 'final'];
const SCOPES: ContestScope[] = ['gmina', 'wojewodztwo', 'polska', 'znajomi'];

/** Kontekst telefonu: nazwa gatunku z katalogu (tytuły walk) i avatar gracza (także zdjęcie) – do jego okazów. */
export interface ContestMapContext {
  speciesName?: (speciesId: string) => string | undefined;
  selfAvatar?: UserAvatar;
}

/* ───────────────────────── Walka ───────────────────────── */

export function mapContest(raw: unknown, ctx: ContestMapContext = {}): Contest {
  const c = parse(raw);
  const id = str(c.id);
  const parsed = parseContestId(id);
  const kind: ContestKind = c.kind === 'relative' || c.kind === 'species' ? c.kind : (parsed?.kind ?? 'relative');
  const speciesId = kind === 'species' ? (strOrNull(c.speciesId) ?? parsed?.speciesId ?? null) : null;
  const name = speciesId ? ctx.speciesName?.(speciesId) : undefined;
  const status = str(c.status) as ContestStatus;
  return {
    id,
    kind,
    speciesId,
    title: kind === 'species' && name ? contestTitle('species', name) : str(c.title) || contestTitle(kind),
    startsAt: str(c.startsAt),
    endsAt: str(c.endsAt),
    resultsAt: str(c.resultsAt),
    status: STATUSES.includes(status) ? status : 'open',
    entrants: int(c.entrants),
  };
}

/* ───────────────────────── Okaz na tablicy ───────────────────────── */

/** `mine` – wpis z pola „mój okaz” (flaga `isMine` niezależnie od serwera). Własny okaz – avatar z telefonu. */
export function mapContestEntry(raw: unknown, contestId = '', ctx: ContestMapContext = {}, mine = false): ContestEntry | null {
  const e = parse(raw);
  const id = str(e.id);
  if (!id) return null;
  const capCm = num(e.capCm);
  const relativePct = num(e.relativePct);
  const isMine = mine || e.isMine === true;
  const author = mapAuthor(e.author ?? e.user);
  if (isMine && ctx.selfAvatar) author.avatar = ctx.selfAvatar;
  return {
    id,
    contestId: str(e.contestId) || contestId,
    findId: str(e.findId),
    author,
    speciesId: str(e.speciesId),
    capCm,
    relativePct,
    score: num(e.score, parseContestId(str(e.contestId) || contestId)?.kind === 'species' ? capCm : relativePct),
    rank: numOrNull(e.rank),
    gminaId: str(e.gminaId),
    foundAt: str(e.foundAt),
    photoPath: strOrNull(e.photoPath),
    status: e.status === 'review' ? 'review' : 'active',
    isMine,
    visibleFrom: strOrNull(e.visibleFrom),
  };
}

const entries = (v: unknown, contestId: string, ctx: ContestMapContext): ContestEntry[] =>
  list(v).flatMap((x) => {
    const e = mapContestEntry(x, contestId, ctx);
    return e ? [e] : [];
  });

export function mapContestBoard(
  raw: unknown,
  fallback: { contestId: string; scope: ContestScope; scopeId?: string | null },
  ctx: ContestMapContext = {},
): ContestBoard {
  const b = parse(raw);
  const contest = mapContest(isObj(b.contest) ? b.contest : { id: fallback.contestId }, ctx);
  const id = contest.id || fallback.contestId;
  const scope = SCOPES.includes(b.scope as ContestScope) ? (b.scope as ContestScope) : fallback.scope;
  const rows = entries(b.entries, id, ctx);
  const mine = isObj(b.mine) ? mapContestEntry(b.mine, id, ctx, true) : null;
  return {
    contest: { ...contest, id },
    scope,
    scopeId: strOrNull(b.scopeId) ?? (scope === 'polska' || scope === 'znajomi' ? null : (fallback.scopeId ?? null)),
    scopeName: str(b.scopeName) || (scope === 'polska' ? 'Polska' : scope === 'znajomi' ? 'Znajomi' : 'Twoja gmina'),
    entries: rows,
    // Okaz gracza (także spoza listy) – zawsze z flagą `isMine`.
    mine,
    total: int(b.total, rows.length),
  };
}

/* ───────────────────────── Tydzień ───────────────────────── */

/** `{ idWalki: wpis }` – wpisy bez id (null) zostają null tylko tam, gdzie typ na to pozwala. */
function entryRecord(v: unknown, ctx: ContestMapContext, mine = false): Record<string, ContestEntry | null> {
  const out: Record<string, ContestEntry | null> = {};
  if (!isObj(v)) return out;
  Object.entries(v).forEach(([k, x]) => {
    out[k] = isObj(x) ? mapContestEntry(x, k, ctx, mine) : null;
  });
  return out;
}

export function mapContestWeek(raw: unknown, ctx: ContestMapContext = {}): ContestWeek {
  const w = parse(raw);
  const contests = list(w.contests).map((c) => mapContest(c, ctx));
  const mine: Record<string, ContestEntry> = {};
  Object.entries(entryRecord(w.mine, ctx, true)).forEach(([k, e]) => {
    if (e) mine[k] = e;
  });
  const leaders = entryRecord(w.leaders, ctx);
  // Każda walka ma wpis w `leaders` (null – nikt jeszcze nie walczy w województwie).
  contests.forEach((c) => {
    if (!(c.id in leaders)) leaders[c.id] = null;
  });
  return {
    weekStart: str(w.weekStart) || (contests[0] ? contests[0].id.slice(0, 10) : ''),
    contests,
    mine,
    leaders,
    previousWeekStart: strOrNull(w.previousWeekStart),
  };
}

/* ───────────────────────── Kwalifikacja ───────────────────────── */

export function mapContestEligibility(raw: unknown, findId: string, ctx: ContestMapContext = {}): ContestEligibility {
  const o = parse(raw);
  const matches = list(o.contests).map((m): ContestMatch => {
    const rank = isObj(m.projectedRank) ? m.projectedRank : {};
    const r = (k: string) => Math.max(1, int(rank[k], 1));
    return {
      contest: mapContest(m.contest, ctx),
      score: num(m.score),
      projectedRank: { gmina: r('gmina'), wojewodztwo: r('wojewodztwo'), polska: r('polska') },
      entered: m.entered === true,
      currentBest: numOrNull(m.currentBest),
    };
  });
  const eligible = o.eligible === true;
  return {
    findId: str(o.findId) || findId,
    eligible,
    reason: eligible ? null : (strOrNull(o.reason) ?? 'Ten okaz nie może walczyć'),
    prizeEligible: o.prizeEligible !== false,
    contests: eligible ? matches.filter((m) => m.contest.id) : [],
  };
}

/* ───────────────────────── Trofea ───────────────────────── */

export function mapTrophyCase(raw: unknown, ctx: ContestMapContext = {}): TrophyCase {
  const o = parse(raw);
  const items = list(o.items).flatMap((t): Trophy[] => {
    const place = int(t.place);
    const scope = str(t.scope);
    if (place < 1 || place > 3 || !(scope === 'gmina' || scope === 'wojewodztwo' || scope === 'polska')) return [];
    const contestId = str(t.contestId);
    const parsed = parseContestId(contestId);
    const speciesId = str(t.speciesId);
    const name = parsed?.kind === 'species' && parsed.speciesId ? ctx.speciesName?.(parsed.speciesId) : undefined;
    return [
      {
        id: str(t.id) || `${contestId}:${scope}:${place}`,
        contestId,
        contestTitle: name ? contestTitle('species', name) : str(t.contestTitle) || contestTitle(parsed?.kind ?? 'relative'),
        scope,
        scopeName: str(t.scopeName),
        place: place as TrophyPlace,
        speciesId,
        capCm: num(t.capCm),
        xp: int(t.xp),
        awardedAt: str(t.awardedAt),
      },
    ];
  });
  const count = (p: number) => items.filter((t) => t.place === p).length;
  // Liczniki z serwera obejmują też trofea spoza listy (najnowsze 20) – nie mniej niż na liście.
  return {
    gold: Math.max(int(o.gold), count(1)),
    silver: Math.max(int(o.silver), count(2)),
    bronze: Math.max(int(o.bronze), count(3)),
    items,
  };
}
