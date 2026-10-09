/**
 * Pojedynki i ranking grzybiarzy z serwera (RPC `get_duels`, `get_duel`, `create_duel`, `get_player_ranking`,
 * `get_rivalry_status` – docs/rywalizacja.md §7) → typy aplikacji. Czyste funkcje bez React Native
 * (testy: ./__tests__/duelsMap.test.ts). Parsowanie obronne jak w ./feedMap.ts: brakujące pola – wartości neutralne,
 * nieznane rodzaje / statusy – pozycja pominięta. Autorzy (`user`) to surowe `author_json` → mapAuthor z feedu.
 */
import type {
  Duel,
  DuelDays,
  DuelKind,
  DuelOutcome,
  DuelSide,
  DuelsOverview,
  DuelStatus,
  PlayerRanking,
  PlayerRankingPeriod,
  PlayerRankingScope,
  PlayerRankRow,
  RivalryStatus,
  UserAvatar,
} from '@/types';
import { mapAuthor } from './feedMap';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, d = 0): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : d;
};
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : v == null ? d : String(v));
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const parse = (raw: unknown): unknown => {
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
};
const list = (raw: unknown): unknown[] => {
  const r = parse(raw);
  return Array.isArray(r) ? r : [];
};
/** Funkcja zwracająca jeden obiekt: obiekt albo tablica z jednym elementem. */
const obj = (raw: unknown): Obj => {
  const r = parse(raw);
  if (isObj(r)) return r;
  return Array.isArray(r) && isObj(r[0]) ? r[0] : {};
};

const KINDS: DuelKind[] = ['biggest', 'count', 'species'];
const DAYS: DuelDays[] = [1, 3, 7];
const STATUSES: DuelStatus[] = ['pending', 'active', 'finished', 'declined', 'cancelled', 'expired'];
const OUTCOMES: DuelOutcome[] = ['won', 'lost', 'draw'];
const SCOPES: PlayerRankingScope[] = ['znajomi', 'gmina', 'wojewodztwo', 'polska'];
const PERIODS: PlayerRankingPeriod[] = ['week', 'season'];

/** Kontekst telefonu: avatar gracza (także zdjęcie) – do jego strony pojedynku i wiersza rankingu. */
export interface DuelMapContext {
  selfAvatar?: UserAvatar;
}

function mapBest(raw: unknown): DuelSide['best'] {
  const b = parse(raw);
  if (!isObj(b) || !str(b.speciesId)) return null;
  return {
    findId: str(b.findId),
    speciesId: str(b.speciesId),
    capCm: num(b.capCm),
    relativePct: num(b.relativePct),
    photoPath: strOrNull(b.photoPath),
  };
}

export function mapDuelSide(raw: unknown, mine: boolean, ctx: DuelMapContext = {}): DuelSide {
  const s = isObj(parse(raw)) ? (parse(raw) as Obj) : {};
  const user = mapAuthor(s.user);
  if (mine && ctx.selfAvatar) user.avatar = ctx.selfAvatar;
  return { user, score: Math.max(0, num(s.score)), best: mapBest(s.best) };
}

/** Pojedynek; nieznany rodzaj / status albo brak id → null. Czas pojedynku spoza 1 / 3 / 7 – najbliższy dozwolony. */
export function mapDuel(raw: unknown, ctx: DuelMapContext = {}): Duel | null {
  const d = parse(raw);
  if (!isObj(d) || !str(d.id)) return null;
  if (!KINDS.includes(d.kind as DuelKind) || !STATUSES.includes(d.status as DuelStatus)) return null;
  const daysRaw = num(d.days, 3);
  const days = DAYS.reduce((best, x) => (Math.abs(x - daysRaw) < Math.abs(best - daysRaw) ? x : best), DAYS[0]);
  const outcome = OUTCOMES.includes(d.outcome as DuelOutcome) ? (d.outcome as DuelOutcome) : null;
  return {
    id: str(d.id),
    kind: d.kind as DuelKind,
    days,
    status: d.status as DuelStatus,
    iAmChallenger: d.iAmChallenger === true,
    createdAt: str(d.createdAt),
    expiresAt: strOrNull(d.expiresAt),
    startsAt: strOrNull(d.startsAt),
    endsAt: strOrNull(d.endsAt),
    finishedAt: strOrNull(d.finishedAt),
    me: mapDuelSide(d.me, true, ctx),
    opponent: mapDuelSide(d.opponent, false),
    outcome,
    xp: d.xp == null || d.xp === '' ? null : Math.max(0, num(d.xp)),
  };
}

export function mapDuels(raw: unknown, ctx: DuelMapContext = {}): Duel[] {
  return list(raw)
    .map((x) => mapDuel(x, ctx))
    .filter((d): d is Duel => !!d);
}

/** `get_duels()` → `{active, incoming, outgoing, finished, record}`. */
export function mapDuelsOverview(raw: unknown, ctx: DuelMapContext = {}): DuelsOverview {
  const o = obj(raw);
  const r = isObj(parse(o.record)) ? (parse(o.record) as Obj) : {};
  return {
    active: mapDuels(o.active, ctx),
    incoming: mapDuels(o.incoming, ctx),
    outgoing: mapDuels(o.outgoing, ctx),
    finished: mapDuels(o.finished, ctx),
    record: { won: Math.max(0, num(r.won)), lost: Math.max(0, num(r.lost)), draw: Math.max(0, num(r.draw)) },
  };
}

function mapRankRow(raw: unknown, ctx: DuelMapContext): PlayerRankRow | null {
  const r = parse(raw);
  if (!isObj(r)) return null;
  const user = mapAuthor(r.user);
  if (!user.id) return null;
  const isMe = r.isMe === true;
  if (isMe && ctx.selfAvatar) user.avatar = ctx.selfAvatar;
  return { rank: Math.max(1, Math.round(num(r.rank, 1))), user, xp: Math.max(0, num(r.xp)), isMe };
}

/**
 * `get_player_ranking(scope, period, scopeId)` → ranking. Brakujący zasięg / okres – z zapytania (`asked`); wiersze od
 * pierwszego miejsca; `me` – wiersz gracza (też spoza listy) albo null.
 */
export function mapPlayerRanking(
  raw: unknown,
  asked: { scope: PlayerRankingScope; period: PlayerRankingPeriod },
  ctx: DuelMapContext = {},
): PlayerRanking {
  const o = obj(raw);
  const rows = list(o.rows)
    .map((x) => mapRankRow(x, ctx))
    .filter((x): x is PlayerRankRow => !!x)
    .sort((a, b) => a.rank - b.rank);
  const me = o.me == null ? null : mapRankRow(o.me, ctx);
  const scope = SCOPES.includes(o.scope as PlayerRankingScope) ? (o.scope as PlayerRankingScope) : asked.scope;
  return {
    scope,
    scopeId: strOrNull(o.scopeId),
    scopeName: str(o.scopeName) || (scope === 'znajomi' ? 'Znajomi' : scope === 'polska' ? 'Polska' : ''),
    period: PERIODS.includes(o.period as PlayerRankingPeriod) ? (o.period as PlayerRankingPeriod) : asked.period,
    live: typeof o.live === 'boolean' ? o.live : scope === 'znajomi',
    rows,
    me: me ? { ...me, isMe: true } : null,
    pendingXp: Math.max(0, num(o.pendingXp)),
    total: Math.max(rows.length, num(o.total)),
    hidden: o.hidden === true,
  };
}

/** `get_rivalry_status()`; brak pól – domyślnie widoczny, bierze udział, konto niezabezpieczone. */
export function mapRivalryStatus(raw: unknown): RivalryStatus {
  const o = obj(raw);
  return {
    showInRankings: o.showInRankings !== false,
    // Poza rywalizacją z innego powodu (np. blokada konta) – jak weryfikacja: wyniki wstrzymane.
    standing: o.standing == null || o.standing === 'ok' ? 'ok' : 'review',
    accountSecured: o.accountSecured === true,
  };
}
