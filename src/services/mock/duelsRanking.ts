/**
 * Ranking grzybiarzy w mockach (docs/rywalizacja.md §4): gracz, grzybiarze z puli mocków (PLAYERS – wszyscy
 * z podlaskiego) i wygenerowane boty gminy, województwa i Polski. Punkty botów są deterministyczne dla tygodnia /
 * roku, punkty gracza podaje serwis (z jego stanu). Czysta funkcja – testy: ./__tests__/duels.test.ts.
 */
import { PLAYERS, toAuthor } from '@/data/mock/social';
import type { PlayerRanking, PlayerRankingPeriod, PlayerRankingScope, PlayerRankRow, PostAuthor, Rarity } from '@/types';
import { rankByXp, weekStartMs } from '@/utils/duels';
import { hashString, mulberry32 } from '@/utils/random';

/** Województwo grzybiarzy z puli mocków (ich gminy domowe leżą w podlaskim). */
const POOL_VOIVODESHIP = 'podlaskie';
/** Wierszy rankingu (jak serwer). */
const ROWS_MAX = 50;

const FIRST = [
  'Ania', 'Bartek', 'Celina', 'Darek', 'Ela', 'Franek', 'Gośka', 'Henio', 'Iza', 'Janek', 'Kasia', 'Leszek',
  'Marta', 'Norbert', 'Olek', 'Paula', 'Renata', 'Staszek', 'Teresa', 'Wiktor', 'Zuza', 'Basia', 'Igor', 'Ludwik',
];
const SECOND = [
  'Kania', 'Rydz', 'Borowik', 'Kurka', 'Maślak', 'Koźlarz', 'Gąska', 'Opieńka', 'Sitarz', 'Podgrzybek', 'Smardz',
  'Purchawka', 'zLasu', 'Mchy', 'Koszyk', 'Puszcza', 'Bór', 'Grzybek',
];
const RINGS: Rarity[] = ['pospolity', 'pospolity', 'rzadki', 'pospolity', 'epicki', 'rzadki', 'legendarny', 'pospolity'];

interface RankEntry {
  author: PostAuthor;
  /** Bot / grzybiarz z puli: deterministyczne punkty; gracz – podane. */
  xp: number;
  isMe: boolean;
}

function botAuthor(id: string): PostAuthor {
  const r = mulberry32(hashString(`rank-bot:${id}`));
  const sep = ['_', '.', ''][Math.floor(r() * 3)];
  const name = `${FIRST[Math.floor(r() * FIRST.length)]}${sep}${SECOND[Math.floor(r() * SECOND.length)]}`;
  return { id, name, level: 2 + Math.floor(Math.pow(r(), 1.4) * 33), ringRarity: RINGS[Math.floor(r() * RINGS.length)] };
}

const bots = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => botAuthor(`${prefix}-${i + 1}`));
/** Boty z gminy (5–10, zależnie od gminy). */
const localBots = (gminaId: string) => bots(`rk-g-${gminaId}`, 5 + (hashString(gminaId) % 6));
const regionBots = (voivodeship: string) => bots(`rk-w-${voivodeship}`, 26);
const countryBots = () => bots('rk-pl', 70);

/**
 * Punkty bota: tydzień (od poniedziałku) 0–3400, sezon (rok) = tydzień + 1,5–50 tys. Wielu z niewielką liczbą,
 * nieliczni z dużą (rozkład potęgowy); co tydzień inaczej.
 */
export function botRankXp(id: string, period: PlayerRankingPeriod, now: number): number {
  const week = mulberry32(hashString(`${id}:w:${weekStartMs(now)}`))();
  const weekXp = Math.round((Math.pow(week, 1.7) * 3400) / 10) * 10;
  if (period === 'week') return weekXp;
  const season = mulberry32(hashString(`${id}:s:${new Date(now).getFullYear()}`))();
  return weekXp + Math.round((1500 + Math.pow(season, 1.5) * 48_500) / 10) * 10;
}

export interface MockRankingInput {
  scope: PlayerRankingScope;
  period: PlayerRankingPeriod;
  /** Gmina (slug) / województwo; null – domowe gracza. */
  scopeId: string | null;
  now: number;
  /** Gracz (z avatarem). */
  me: PostAuthor;
  /** Punkty gracza w okresie (z ostatnimi 24 h). */
  myXp: number;
  /** Punkty gracza z ostatnich 24 h (zasięgi publiczne pokazują je dopiero po opóźnieniu prywatności). */
  pendingXp: number;
  /** Gmina domowa gracza (null – jeszcze niewybrana). */
  home: { gminaId: string; voivodeship: string } | null;
  /** „Gmina Supraśl” dla sluga. */
  gminaName: (id: string) => string;
  friendIds: string[];
  isBlocked: (id: string) => boolean;
  /** Gracz ukryty w rankingach (Ustawienia → Prywatność). */
  hidden: boolean;
}

/** Ranking jednego zasięgu i okresu (jak `get_player_ranking`). */
export function mockPlayerRanking(x: MockRankingInput): PlayerRanking {
  const { scope, period, now } = x;
  const players = PLAYERS.filter((p) => !x.isBlocked(p.id));
  const fromPool = (list: PostAuthor[]): RankEntry[] => list.map((a) => ({ author: a, xp: botRankXp(a.id, period, now), isMe: false }));
  const publicXp = Math.max(0, x.myXp - x.pendingXp);
  const mine = (xp: number): RankEntry[] => [{ author: x.me, xp, isMe: true }];

  let scopeId: string | null = null;
  let scopeName = 'Polska';
  let entries: RankEntry[] = [];
  if (scope === 'znajomi') {
    scopeName = 'Znajomi';
    // Znajomi widzą się na żywo – także świeże punkty i mimo ukrycia w rankingach publicznych.
    entries = [...mine(x.myXp), ...fromPool(players.filter((p) => x.friendIds.includes(p.id)).map(toAuthor))];
  } else if (scope === 'gmina') {
    scopeId = x.scopeId ?? x.home?.gminaId ?? null;
    scopeName = scopeId ? x.gminaName(scopeId) : 'Twoja gmina';
    if (scopeId) {
      const atHome = scopeId === x.home?.gminaId;
      entries = [
        ...(atHome && !x.hidden ? mine(publicXp) : []),
        ...fromPool([...players.filter((p) => p.homeGminaId === scopeId).map(toAuthor), ...localBots(scopeId)]),
      ];
    }
  } else if (scope === 'wojewodztwo') {
    scopeId = x.scopeId ?? x.home?.voivodeship ?? null;
    scopeName = scopeId ?? 'Twoje województwo';
    if (scopeId) {
      const atHome = scopeId === x.home?.voivodeship;
      entries = [
        ...(atHome && !x.hidden ? mine(publicXp) : []),
        ...fromPool([
          ...(scopeId === POOL_VOIVODESHIP ? players.map(toAuthor) : []),
          ...(atHome && x.home ? localBots(x.home.gminaId) : []),
          ...regionBots(scopeId),
        ]),
      ];
    }
  } else {
    const region = x.home?.voivodeship ?? POOL_VOIVODESHIP;
    entries = [
      ...(x.hidden ? [] : mine(publicXp)),
      ...fromPool([
        ...players.map(toAuthor),
        ...(x.home ? localBots(x.home.gminaId) : []),
        ...regionBots(region),
        ...(region === POOL_VOIVODESHIP ? [] : regionBots(POOL_VOIVODESHIP)),
        ...countryBots(),
      ]),
    ];
  }

  const ranked = rankByXp(entries.map((e) => ({ ...e, name: e.author.name })));
  const toRow = (e: (typeof ranked)[number]): PlayerRankRow => ({ rank: e.rank, user: e.author, xp: e.xp, isMe: e.isMe });
  const meRow = ranked.find((e) => e.isMe);
  return {
    scope,
    scopeId,
    scopeName,
    period,
    live: scope === 'znajomi',
    rows: ranked.slice(0, ROWS_MAX).map(toRow),
    me: meRow ? toRow(meRow) : null,
    pendingXp: scope === 'znajomi' || x.hidden ? 0 : Math.min(x.pendingXp, x.myXp),
    total: ranked.length,
    hidden: x.hidden,
  };
}
