/**
 * Walki o okaz – implementacja mock (docs/rywalizacja.md §2). Boty są deterministyczne (seed = walka × grzybiarz):
 * grzybiarze z puli mocków (src/data/mock/social.ts – podlaskie, mini profil działa), kilkunastu grzybiarzy z innych
 * województw (Polska) i – gdy gmina domowa gracza leży poza nimi – kilku „sąsiadów” z jego gminy. Okaz bota istnieje
 * od chwili znalezienia (w obrębie tygodnia), inni widzą go po 24 h (opóźnienie prywatności), znajomi – od razu.
 *
 * Okazy gracza to jego znaleziska z telefonu (useTripStore) z rozmiarem potwierdzonym (`sizeVerified`); zgłoszenia
 * są trwałe (./contestsDb.ts). Gracz demo z makiety ma historię z poprzednich tygodni (trofea). Nagrody XP z walk
 * w mockach są tylko informacją (trofea) – nie dopisują się do poziomu gracza. Sieć: ./net.ts (opóźnienia, offline).
 */
import { GMINY } from '@/data/mock/gminy';
import { missingGminy } from '@/geo';
import { PLAYERS, toAuthor } from '@/data/mock/social';
import { SPECIES } from '@/data/mock/species';
import { START_USER } from '@/data/mock/users';
import { useCatalogStore } from '@/store/useCatalogStore';
import { useTripStore } from '@/store/useTripStore';
import { useUserStore } from '@/store/useUserStore';
import type {
  Contest,
  ContestBoard,
  ContestEligibility,
  ContestEntry,
  ContestMatch,
  ContestScope,
  ContestWeek,
  PostAuthor,
  Rarity,
  Species,
  Trophy,
  TrophyCase,
} from '@/types';
import {
  contestAwards,
  contestCheck,
  contestScore,
  contestSpeciesPool,
  contestWeekBounds,
  contestWeekStart,
  matchingContests,
  parseContestId,
  PRIVACY_DELAY_H,
  rankAmong,
  relativePct,
  sortEntries,
  weekContests,
} from '@/utils/contests';
import { addDays } from '@/utils/forecast';
import { gminaTitle } from '@/utils/format';
import { hashString, makeId, mulberry32 } from '@/utils/random';
import { ServiceError, type ContestService } from '../types';
import { contestsDbReady, useContestsDb, type StoredContestEntry } from './contestsDb';
import { mockDuelsReady, useMockDuelsDb } from './duelsDb';
import { useMockDb } from './db';
import { net } from './net';

const H = 3_600_000;
const DAY = 24 * H;
/** Na tablicy najwyżej tylu graczy (jak na serwerze). */
const BOARD_LIMIT = 50;
/** Trofea liczymy z tylu ostatnich rozstrzygniętych tygodni. */
const TROPHY_WEEKS = 8;

/* ───────────────────────── Grzybiarze (boty) ───────────────────────── */

interface Bot {
  author: PostAuthor;
  gminaId: string;
  voivodeship: string;
  /** Szansa, że bot walczy w danej walce. */
  activity: number;
}

const ring = (level: number): Rarity =>
  level >= 25 ? 'legendarny' : level >= 18 ? 'epicki' : level >= 10 ? 'rzadki' : 'pospolity';

function genBot(id: string, name: string, gminaId: string, voivodeship: string, activity: number): Bot {
  const level = 3 + (hashString(id) % 28);
  return { author: { id, name, level, ringRarity: ring(level) }, gminaId, voivodeship, activity };
}

/** Pula mocków (podlaskie) – te same osoby co w feedzie i wyszukiwarce. */
const LOCAL_BOTS: Bot[] = PLAYERS.map((p) => ({
  author: toAuthor(p),
  gminaId: p.homeGminaId,
  voivodeship: 'podlaskie',
  activity: 0.85,
}));

/** Grzybiarze z innych województw (zasięg „Polska”). */
const FAR_BOTS: Bot[] = (
  [
    ['Hania_z_Gorców', 'zakopane', 'małopolskie'],
    ['Krynicki_Grzybiarz', 'krynica-zdroj', 'małopolskie'],
    ['Karkonoska_Ola', 'szklarska-poreba', 'dolnośląskie'],
    ['Rafał.Karpacz', 'karpacz', 'dolnośląskie'],
    ['Basia_Kaczawska', 'swierzawa', 'dolnośląskie'],
    ['Beskidzki_Janek', 'wisla', 'śląskie'],
    ['Stefan_Żywiecki', 'wegierska-gorka', 'śląskie'],
    ['Kaszub_Marcin', 'ustka', 'pomorskie'],
    ['Łebski_Grzyb', 'leba', 'pomorskie'],
    ['Bieszczadnik', 'ustrzyki-dolne', 'podkarpackie'],
    ['Ania_z_Leska', 'lesko', 'podkarpackie'],
    ['Piotr_Bory_Tucholskie', 'tuchola', 'kujawsko-pomorskie'],
    ['Grześ_Janowski', 'janow-lubelski', 'lubelskie'],
    ['Iza.Roztocze', 'krasnobrod', 'lubelskie'],
    ['Woliński_Darek', 'miedzyzdroje', 'zachodniopomorskie'],
  ] as const
).map(([name, gminaId, voivodeship]) => genBot(`u-bot-${gminaId}`, name, gminaId, voivodeship, 0.8));

const NEIGHBOUR_NAMES = [
  'Leśny_Adam',
  'Kasia.Kurka',
  'Michał_Grzyb',
  'Ewelina_Las',
  'Jacek.Borowik',
  'Ania_Podgrzybek',
  'Tadek_Mech',
];

const BOT_GMINY = new Set([...LOCAL_BOTS, ...FAR_BOTS].map((b) => b.gminaId));

/** Gmina domowa gracza spoza gmin botów – czterech „sąsiadów”, żeby tablica gminy i województwa nie była pusta. */
function neighbourBots(gminaId: string, voivodeship: string): Bot[] {
  if (!gminaId || BOT_GMINY.has(gminaId)) return [];
  const rnd = mulberry32(hashString(`sasiedzi:${gminaId}`));
  const names = [...NEIGHBOUR_NAMES].sort(() => rnd() - 0.5).slice(0, 4);
  return names.map((name, i) => genBot(`u-bot-${gminaId}-${i}`, name, gminaId, voivodeship, 0.8));
}

/* ───────────────────────── Gracz ───────────────────────── */

const db = () => useContestsDb.getState();

/** Widoczność w rankingach i na tablicach walk – przełącznik w Ustawieniach (stan mocków pojedynków, ./duelsDb.ts). */
const hiddenInRankings = () => !useMockDuelsDb.getState().showInRankings;

/** Zgłoszenia gracza i ustawienie widoczności odtworzone z AsyncStorage. */
const ready = () => Promise.all([contestsDbReady(), mockDuelsReady()]);

function playerAuthor(): PostAuthor {
  const u = useUserStore.getState().user;
  const a: PostAuthor = { id: u.id, name: u.firstName, level: u.level, ringRarity: 'primary' };
  if (u.avatar) a.avatar = u.avatar;
  return a;
}

const gminaOf = (id: string) => useCatalogStore.getState().gminaById[id] ?? GMINY.find((g) => g.id === id);
const voivodeshipOf = (gminaId: string) => gminaOf(gminaId)?.voivodeship ?? 'podlaskie';

/** Gmina domowa gracza i jej województwo (domyślne zasięgi tablic). */
function home() {
  const gminaId = useUserStore.getState().user.homeGminaId || START_USER.homeGminaId;
  return { gminaId, voivodeship: voivodeshipOf(gminaId) };
}

const speciesById = (id: string): Species | undefined =>
  useCatalogStore.getState().speciesById[id] ?? SPECIES.find((s) => s.id === id);

/* ───────────────────────── Okazy w walce ───────────────────────── */

interface Row {
  entryId: string;
  contestId: string;
  findId: string;
  author: PostAuthor;
  speciesId: string;
  capCm: number;
  gminaId: string;
  voivodeship: string;
  foundAt: string;
  score: number;
  mine: boolean;
  photoUri?: string;
}

const visibleAt = (r: Pick<Row, 'foundAt'>) => Date.parse(r.foundAt) + PRIVACY_DELAY_H * H;

/** Gatunki okazów botów w „Okazie tygodnia”: sezonowe jadalne, nie kępkowe, bez ochrony (pula tygodnia jako zapas). */
function relativeSpecies(weekStart: string): Species[] {
  const month = Number(addDays(weekStart, 3).slice(5, 7));
  const list = SPECIES.filter(
    (s) =>
      s.edibility === 'jadalny' &&
      !s.clustered &&
      !s.protection &&
      s.typical.capCm >= 4 &&
      (s.seasonWeights?.[month - 1] ?? 0) >= 0.6,
  ).slice(0, 24);
  return list.length ? list : contestSpeciesPool(weekStart, SPECIES);
}

function rowFrom(contest: Contest, base: Omit<Row, 'score' | 'contestId'>): Row {
  const sp = speciesById(base.speciesId);
  return { ...base, contestId: contest.id, score: contestScore(contest.kind, base.capCm, sp?.typical.capCm ?? base.capCm) };
}

/** Okazy botów w walce – istnieją od chwili znalezienia (tydzień walki). */
function botRows(contest: Contest, bots: Bot[], now: number): Row[] {
  const start = Date.parse(contest.startsAt);
  const end = Date.parse(contest.endsAt);
  const week = contest.id.slice(0, 10);
  const pool =
    contest.kind === 'species' ? [speciesById(contest.speciesId!)].filter((s): s is Species => !!s) : relativeSpecies(week);
  if (!pool.length) return [];
  const rows: Row[] = [];
  for (const bot of bots) {
    const rnd = mulberry32(hashString(`${contest.id}|${bot.author.id}`));
    if (rnd() > bot.activity) continue;
    const sp = pool[Math.floor(rnd() * pool.length)];
    // Zwykle 100–150% typowego kapelusza, czasem prawdziwy okaz (do ~215%).
    const factor = 0.95 + rnd() * rnd() * 1.2;
    // Częściej w pierwszej połowie tygodnia – w piątek tablice nie są puste mimo opóźnienia prywatności.
    const foundAt = start + H + Math.floor(Math.pow(rnd(), 1.4) * (end - start - 3 * H));
    if (foundAt > now) continue;
    rows.push(
      rowFrom(contest, {
        entryId: `ce-${contest.id}-${bot.author.id}`,
        findId: `f-${contest.id}-${bot.author.id}`,
        author: bot.author,
        speciesId: sp.id,
        capCm: Math.round(sp.typical.capCm * factor * 10) / 10,
        gminaId: bot.gminaId,
        voivodeship: bot.voivodeship,
        foundAt: new Date(foundAt).toISOString(),
        mine: false,
      }),
    );
  }
  return rows;
}

/**
 * Historia gracza demo (makieta): okazy z trzech poprzednich tygodni – na tablicach minionych walk i w trofeach.
 * Znalezisk nie ma w telefonie („starsze znaleziska nie są dostępne na tym urządzeniu”).
 */
function demoRows(contest: Contest, current: string): Row[] {
  if (!db().demo) return [];
  const week = contest.id.slice(0, 10);
  const ago = Math.round((Date.parse(current) - Date.parse(week)) / (7 * DAY));
  if (ago < 1 || ago > 3) return [];
  const { gminaId, voivodeship } = home();
  const base = (speciesId: string, factor: number, day: number) => {
    const sp = speciesById(speciesId);
    if (!sp) return [];
    return [
      rowFrom(contest, {
        entryId: `ce-${contest.id}-demo`,
        findId: `f-demo-${contest.id}`,
        author: playerAuthor(),
        speciesId,
        capCm: Math.round(sp.typical.capCm * factor * 10) / 10,
        gminaId,
        voivodeship,
        foundAt: new Date(Date.parse(contest.startsAt) + day * DAY + 9 * H).toISOString(),
        mine: true,
      }),
    ];
  };
  if (contest.kind === 'relative') {
    if (ago === 1) return base('borowik-szlachetny', 1.8, 2);
    if (ago === 2) return base('czubajka-kania', 1.62, 4);
    return base('kozlarz-czerwony', 1.45, 1);
  }
  // Walka gatunku minionego tygodnia – pierwszy z gatunków tygodnia.
  if (ago === 1 && contest.id.endsWith(`:${weekContests(week, SPECIES)[1].speciesId}`)) return base(contest.speciesId!, 1.5, 3);
  return [];
}

function storedRow(contest: Contest, e: StoredContestEntry): Row {
  return rowFrom(contest, {
    entryId: e.entryId,
    findId: e.findId,
    author: playerAuthor(),
    speciesId: e.speciesId,
    capCm: e.capCm,
    gminaId: e.gminaId,
    voivodeship: e.voivodeship,
    foundAt: e.foundAt,
    mine: true,
    photoUri: useTripStore.getState().finds[e.findId]?.photoUri,
  });
}

/** Wszystkie okazy walki (boty + gracz), bez zablokowanych. */
function contestRows(contest: Contest, now: number): Row[] {
  const h = home();
  const bots = [...LOCAL_BOTS, ...FAR_BOTS, ...neighbourBots(h.gminaId, h.voivodeship)];
  const blocked = new Set(useMockDb.getState().blocked.map((b) => b.id));
  const own = db()
    .entries.filter((e) => e.contestId === contest.id)
    .map((e) => storedRow(contest, e));
  const mine = own.length ? own : demoRows(contest, contestWeekStart(now));
  return [...botRows(contest, bots, now).filter((r) => !blocked.has(r.author.id)), ...mine.slice(0, 1)];
}

const inScope = (scope: ContestScope, scopeId: string | null, friends: Set<string>) => (r: Row) => {
  switch (scope) {
    case 'gmina':
      return r.gminaId === scopeId;
    case 'wojewodztwo':
      return r.voivodeship === scopeId;
    case 'polska':
      return true;
    case 'znajomi':
      return r.mine || friends.has(r.author.id);
  }
};

/** `live` – zasięg znajomych: cudze okazy bez gminy (znajomi widzą tylko liczby i gatunek). */
function toEntry(r: Row, rank: number | null, now: number, live = false): ContestEntry {
  const sp = speciesById(r.speciesId);
  const hidden = r.mine && visibleAt(r) > now;
  const entry: ContestEntry = {
    id: r.entryId,
    contestId: r.contestId,
    findId: r.findId,
    author: r.author,
    speciesId: r.speciesId,
    capCm: r.capCm,
    relativePct: relativePct(r.capCm, sp?.typical.capCm ?? r.capCm),
    score: r.score,
    rank,
    gminaId: live && !r.mine ? '' : r.gminaId,
    foundAt: r.foundAt,
    photoPath: null,
    status: 'active',
    isMine: r.mine,
    visibleFrom: hidden ? new Date(visibleAt(r)).toISOString() : null,
  };
  if (r.photoUri) entry.photoUri = r.photoUri;
  return entry;
}

/**
 * Tablica zasięgu jak na serwerze: cudze okazy w zasięgach publicznych po 24 h, znajomi na żywo; okaz gracza
 * zawsze (dopóki inni go nie widzą – bez miejsca, z `visibleFrom`).
 */
function rankRows(rows: Row[], scope: ContestScope, scopeId: string | null, now: number) {
  const friends = new Set(useMockDb.getState().friendIds);
  const live = scope === 'znajomi';
  // Gracz ukryty w rankingach (Ustawienia → Prywatność): jego okazy walczą tylko wśród znajomych.
  const hidden = !live && hiddenInRankings();
  const own = rows.find((r) => r.mine);
  const inside = rows.filter(inScope(scope, scopeId, friends));
  const mineRow = hidden ? undefined : inside.find((r) => r.mine);
  const mineVisible = !!mineRow && (live || visibleAt(mineRow) <= now);
  const ranked = sortEntries(inside.filter((r) => (r.mine ? r === mineRow && mineVisible : live || visibleAt(r) <= now)));
  const entries = ranked.map((r, i) => toEntry(r, i + 1, now, live));
  let mine = mineRow && mineVisible ? entries.find((e) => e.isMine)! : null;
  if (mineRow && !mineVisible) {
    // Okaz gracza przed upływem 24 h: na swojej pozycji, bez miejsca.
    mine = toEntry(mineRow, null, now);
    const at = rankAmong(mineRow, ranked) - 1;
    entries.splice(at, 0, mine);
  }
  // Jak serwer: okaz gracza zawsze w `mine` – z innej gminy / województwa niż zasięg albo ukryty – bez miejsca.
  if (!mine && own) mine = hidden ? { ...toEntry(own, null, now, live), visibleFrom: null } : toEntry(own, null, now, live);
  return { entries, mine, total: ranked.length + (mineRow && !mineVisible ? 1 : 0), ranked };
}

/* ───────────────────────── Walki ───────────────────────── */

/** Walka po id (tylko tygodnie, które już się zaczęły); liczba uczestników – okazy widoczne w Polsce. */
function contestById(id: string, now: number): Contest {
  const parsed = parseContestId(id);
  const notFound = () => new ServiceError('NOT_FOUND', 'Nie znaleziono walki');
  if (!parsed || parsed.weekStart > contestWeekStart(now)) throw notFound();
  const c = weekContests(parsed.weekStart, SPECIES, now).find((x) => x.id === id);
  if (!c) throw notFound();
  return withEntrants(c, now);
}

function withEntrants(c: Contest, now: number): Contest {
  const rows = contestRows(c, now);
  const hidden = hiddenInRankings();
  return { ...c, entrants: rows.filter((r) => visibleAt(r) <= now && !(r.mine && hidden)).length };
}

/** Ostatnio rozstrzygnięty tydzień przed `weekStart`. */
function previousResolved(weekStart: string, now: number): string {
  let w = addDays(weekStart, -7);
  while (Date.parse(contestWeekBounds(w).resultsAt) > now) w = addDays(w, -7);
  return w;
}

/** Gminy okazów spoza danych gry (boty z całej Polski) – nazwy do katalogu z indeksu PRG, w tle. */
function resolveGminaNames(ids: string[]) {
  missingGminy(ids.filter(Boolean), useCatalogStore.getState().gminaById)
    .then((list) => list.forEach((g) => useCatalogStore.getState().upsertGmina(g)))
    .catch(() => {});
}

async function scopeName(scope: ContestScope, scopeId: string | null): Promise<string> {
  if (scope === 'polska') return 'Polska';
  if (scope === 'znajomi') return 'Znajomi';
  if (scope === 'wojewodztwo') return scopeId ?? '';
  const g = scopeId ? gminaOf(scopeId) : undefined;
  return g ? gminaTitle(g) : 'Twoja gmina';
}

/* ───────────────────────── Kwalifikacja ───────────────────────── */

function eligibilityOf(findId: string, now: number): ContestEligibility {
  const find = useTripStore.getState().finds[findId];
  if (!find) throw new ServiceError('NOT_FOUND', 'Nie znaleziono znaleziska');
  const sp = speciesById(find.speciesId);
  const check = contestCheck(find, sp, { now });
  const out: ContestEligibility = { findId, eligible: check.ok, reason: check.reason, prizeEligible: true, contests: [] };
  if (!check.ok || !check.weekStart || !sp) return out;
  const voivodeship = voivodeshipOf(find.gminaId);
  const contests = matchingContests(find.speciesId, weekContests(check.weekStart, SPECIES, now));
  out.contests = contests.map((c): ContestMatch => {
    const rows = contestRows(c, now);
    const score = contestScore(c.kind, find.dimensions.capCm, sp.typical.capCm);
    const me = { score, foundAt: find.foundAt };
    // Miejsce wśród okazów, które inni widzą teraz (bez własnego zgłoszenia).
    const others = rows.filter((r) => !r.mine && visibleAt(r) <= now);
    const stored = db().entries.find((e) => e.contestId === c.id);
    const current = stored && stored.findId !== findId ? rows.find((r) => r.mine) : undefined;
    return {
      contest: withEntrants(c, now),
      score,
      projectedRank: {
        gmina: rankAmong(
          me,
          others.filter((r) => r.gminaId === find.gminaId),
        ),
        wojewodztwo: rankAmong(
          me,
          others.filter((r) => r.voivodeship === voivodeship),
        ),
        polska: rankAmong(me, others),
      },
      entered: stored?.findId === findId,
      currentBest: current ? current.score : null,
    };
  });
  return out;
}

/* ───────────────────────── Trofea ───────────────────────── */

async function trophiesOf(userId: string, now: number): Promise<TrophyCase> {
  const items: Trophy[] = [];
  let week = previousResolved(contestWeekStart(now), now);
  for (let i = 0; i < TROPHY_WEEKS; i++, week = addDays(week, -7)) {
    for (const c of weekContests(week, SPECIES, now)) {
      const rows = contestRows(c, now);
      const byUser = new Map(rows.map((r) => [r.author.id, r]));
      for (const a of contestAwards(rows.map((r) => ({ ...r, userId: r.author.id })))) {
        if (a.userId !== userId) continue;
        const r = byUser.get(userId)!;
        items.push({
          id: `${c.id}:${a.scope}:${a.scopeId ?? 'pl'}`,
          contestId: c.id,
          contestTitle: c.title,
          scope: a.scope,
          scopeName: await scopeName(a.scope, a.scopeId),
          place: a.place,
          speciesId: r.speciesId,
          capCm: r.capCm,
          xp: a.xp,
          awardedAt: c.resultsAt,
        });
      }
    }
  }
  const count = (p: number) => items.filter((t) => t.place === p).length;
  return { gold: count(1), silver: count(2), bronze: count(3), items: items.slice(0, 20) };
}

/* ───────────────────────── Serwis ───────────────────────── */

export const mockContests: ContestService = {
  async getContestWeek(weekStart) {
    await ready();
    await net(`contest-week:${weekStart ?? ''}`, 350, 900);
    const now = Date.now();
    const ws = weekStart ?? contestWeekStart(now);
    if (ws > contestWeekStart(now)) throw new ServiceError('NOT_FOUND', 'Ten tydzień jeszcze się nie zaczął');
    const h = home();
    const contests = weekContests(ws, SPECIES, now).map((c) => withEntrants(c, now));
    const mine: ContestWeek['mine'] = {};
    const leaders: ContestWeek['leaders'] = {};
    for (const c of contests) {
      const rows = contestRows(c, now);
      const own = rows.find((r) => r.mine);
      // Okaz gracza – z miejscem w województwie, w którym go znalazł.
      if (own) {
        const m = rankRows(rows, 'wojewodztwo', own.voivodeship, now).mine;
        if (m) mine[c.id] = m;
      }
      leaders[c.id] = rankRows(rows, 'wojewodztwo', h.voivodeship, now).entries.find((e) => e.rank === 1) ?? null;
    }
    return { weekStart: ws, contests, mine, leaders, previousWeekStart: previousResolved(ws, now) };
  },

  async getContestBoard(contestId, scope, scopeId) {
    await ready();
    await net(`contest-board:${contestId}:${scope}:${scopeId ?? ''}`, 350, 900);
    const now = Date.now();
    const contest = contestById(contestId, now);
    const h = home();
    const id: string | null =
      scope === 'gmina' ? (scopeId ?? h.gminaId) : scope === 'wojewodztwo' ? (scopeId ?? h.voivodeship) : null;
    const { entries, mine, total } = rankRows(contestRows(contest, now), scope, id, now);
    const top = entries.slice(0, BOARD_LIMIT);
    resolveGminaNames([...top.map((e) => e.gminaId), mine?.gminaId ?? '']);
    const board: ContestBoard = { contest, scope, scopeId: id, scopeName: await scopeName(scope, id), entries: top, mine, total };
    return board;
  },

  async getContestEligibility(findId) {
    await ready();
    await net(`contest-elig:${findId}`, 250, 600);
    return eligibilityOf(findId, Date.now());
  },

  async enterContest(findId) {
    await ready();
    await net(`contest-enter:${findId}`, 400, 900);
    const now = Date.now();
    const elig = eligibilityOf(findId, now);
    if (!elig.eligible) throw new ServiceError('SERVER', elig.reason ?? 'Ten okaz nie może walczyć');
    if (!elig.contests.length) throw new ServiceError('SERVER', 'Walki tego tygodnia są już zamknięte');
    const find = useTripStore.getState().finds[findId]!;
    const ids = new Set(elig.contests.map((m) => m.contest.id));
    const fresh: StoredContestEntry[] = elig.contests.map((m) => ({
      contestId: m.contest.id,
      entryId: makeId('ce'),
      findId,
      speciesId: find.speciesId,
      capCm: find.dimensions.capCm,
      gminaId: find.gminaId,
      voivodeship: voivodeshipOf(find.gminaId),
      foundAt: find.foundAt,
      enteredAt: new Date(now).toISOString(),
    }));
    // Jeden okaz gracza w walce – nowe zgłoszenie zastępuje poprzednie.
    db().set({ entries: [...db().entries.filter((e) => !ids.has(e.contestId)), ...fresh] });
    return eligibilityOf(findId, now);
  },

  async withdrawContestEntry(contestId) {
    await ready();
    await net(`contest-withdraw:${contestId}`, 300, 700);
    const now = Date.now();
    const c = contestById(contestId, now);
    if (c.status !== 'open') throw new ServiceError('SERVER', 'Walka już się skończyła – okazu nie można wycofać');
    db().set({ entries: db().entries.filter((e) => e.contestId !== contestId) });
  },

  async reportContestEntry(entryId) {
    await ready();
    await net(`contest-report:${entryId}`, 250, 600);
    if (db().entries.some((e) => e.entryId === entryId)) throw new ServiceError('SERVER', 'Nie możesz zgłosić własnego okazu');
    if (!db().reported.includes(entryId)) db().set({ reported: [...db().reported, entryId] });
  },

  async getTrophies(userId) {
    await ready();
    await net(`trophies:${userId ?? ''}`, 300, 800);
    return trophiesOf(userId ?? useUserStore.getState().user.id, Date.now());
  },
};
