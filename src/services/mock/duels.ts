/**
 * Pojedynki ze znajomymi i ranking grzybiarzy – implementacja mock (docs/rywalizacja.md §3–4).
 *
 * Przeciwnikami są boty-znajomi z puli mocków (src/data/mock/social.ts, lista znajomych w useMockDb). Stan trwały:
 * ./duelsDb.ts. Wszystko liczy się z czasu przy odczycie (settle), bez timerów w tle: bot przyjmuje wyzwanie gracza
 * po kilku minutach, dokłada znaleziska w deterministycznych odstępach (z id pojedynku), po końcu + 6 h (kolejka
 * offline) pojedynek się rozstrzyga. Wynik gracza – z jego znalezisk w telefonie (useTripStore) w oknie pojedynku.
 * Na start (pierwszy odczyt) zestaw: wyzwanie bota do gracza, trwający pojedynek i trzy zakończone (bilans).
 * Z narzędziami dev boty „wysyłają” powiadomienia (kategoria „Rywalizacja”) – jak symulowane reakcje znajomych.
 */
import { DEV_TOOLS } from '@/config';
import { playerById, toAuthor, type MockPlayer } from '@/data/mock/social';
import { SPECIES } from '@/data/mock/species';
import { useCatalogStore } from '@/store/useCatalogStore';
import { useNotificationStore } from '@/store/useNotificationStore';
import { useTripStore } from '@/store/useTripStore';
import { useUserStore } from '@/store/useUserStore';
import type { ActivityItem, Duel, DuelDays, DuelKind, DuelSide, DuelsOverview, PostAuthor, Species } from '@/types';
import { activityEntry } from '@/utils/activity';
import {
  DUEL_DAYS,
  DUEL_GRACE_MS,
  DUEL_INVITE_TTL_MS,
  DUEL_LIMITS,
  duelLengthMs,
  duelOutcome,
  duelSideScore,
  duelXp,
  isDuelKind,
  relativePct,
  weekStartMs,
} from '@/utils/duels';
import { gminaTitle } from '@/utils/format';
import { hashString, mulberry32, uuid } from '@/utils/random';
import { applyXp } from '@/utils/xp';
import { ServiceError, type DuelService } from '../types';
import { useMockDb } from './db';
import { mockDuelsReady, useMockDuelsDb, type MockDuelRecord, type MockSideSnapshot } from './duelsDb';
import { mockPlayerRanking } from './duelsRanking';
import { net } from './net';
import { isBlocked } from './social';

const H = 3_600_000;
const DAY = 24 * H;
const db = () => useMockDuelsDb.getState();
const iso = (t: number) => new Date(t).toISOString();
const ms = (s: string | null | undefined) => (s ? new Date(s).getTime() : NaN);

const SPECIES_BY_ID: Record<string, Species> = Object.fromEntries(SPECIES.map((s) => [s.id, s]));
/** Gatunki „zbierane” przez boty: jadalne, nie kępkowe, bez ochrony, z wyraźnym kapeluszem (kolejność atlasu). */
const BOT_SPECIES = SPECIES.filter((s) => s.edibility === 'jadalny' && !s.clustered && !s.protection && s.typical.capCm >= 4).slice(0, 24);

/* ───────────────────────── Strony pojedynku ───────────────────────── */

function meAuthor(): PostAuthor {
  const u = useUserStore.getState().user;
  const a: PostAuthor = { id: u.id, name: u.firstName, level: u.level, ringRarity: 'primary' };
  if (u.handle) a.handle = u.handle;
  if (u.avatar) a.avatar = u.avatar;
  return a;
}

const botOf = (r: MockDuelRecord): MockPlayer | undefined => playerById(r.botId);
const endOf = (r: MockDuelRecord) => ms(r.startsAt) + duelLengthMs(r.days);

interface BotFind {
  at: number;
  speciesId: string;
  capCm: number;
  pct: number;
}

/**
 * Znaleziska bota w pojedynku – deterministyczne z id pojedynku: wypady co 2–14 h (zależnie od siły bota), na każdym
 * 1–3 znaleziska co 12 min; gatunki i okazy losowe. Jedno znalezisko = jeden grzyb (jak na serwerze – kępka też 1).
 */
export function botFinds(r: Pick<MockDuelRecord, 'id' | 'botId' | 'startsAt' | 'days'>): BotFind[] {
  if (!r.startsAt) return [];
  const rnd = mulberry32(hashString(`duel:${r.id}:${r.botId}`));
  const start = ms(r.startsAt);
  const end = start + duelLengthMs(r.days);
  const skill = 0.6 + rnd() * 0.8;
  const out: BotFind[] = [];
  let t = start + (0.5 + rnd() * 4) * H;
  while (t < end && out.length < 80) {
    const n = 1 + Math.floor(rnd() * 3 * skill);
    for (let i = 0; i < n && t + i * 12 * 60_000 < end; i++) {
      const s = BOT_SPECIES[Math.floor(rnd() * BOT_SPECIES.length)];
      const capCm = Math.round(s.typical.capCm * (0.7 + rnd() * 0.55 * skill + (rnd() < 0.12 ? 0.2 : 0)) * 10) / 10;
      out.push({ at: t + i * 12 * 60_000, speciesId: s.id, capCm, pct: relativePct(capCm, s.typical.capCm) });
    }
    t += (2 + (rnd() * 12) / skill) * H;
  }
  return out;
}

/** Wynik bota w chwili `at` (najwyżej do końca pojedynku). */
function botSide(r: MockDuelRecord, at: number): MockSideSnapshot {
  if (!r.startsAt) return { score: 0, best: null };
  const upTo = Math.min(at, endOf(r));
  const finds = botFinds(r).filter((f) => f.at <= upTo);
  if (r.kind === 'count') return { score: finds.length, best: null };
  if (r.kind === 'species') return { score: new Set(finds.map((f) => f.speciesId)).size, best: null };
  let best: DuelSide['best'] = null;
  for (let i = 0; i < finds.length; i++) {
    const f = finds[i];
    // Remis – wcześniejszy okaz (lista jest chronologiczna).
    if (!best || f.pct > best.relativePct) {
      best = { findId: `${r.id}:bot:${i}`, speciesId: f.speciesId, capCm: f.capCm, relativePct: f.pct, photoPath: null };
    }
  }
  return { score: best?.relativePct ?? 0, best };
}

/** Wynik gracza z jego znalezisk w telefonie (mocki: brak flagi weryfikacji się liczy – patrz duelSideScore). */
function mySide(r: MockDuelRecord, at: number): MockSideSnapshot {
  if (!r.startsAt) return { score: 0, best: null };
  const speciesById = { ...SPECIES_BY_ID, ...useCatalogStore.getState().speciesById };
  return duelSideScore(r.kind, Object.values(useTripStore.getState().finds), speciesById, {
    from: ms(r.startsAt),
    to: Math.min(at, endOf(r)),
    strict: false,
  });
}

function toDuel(r: MockDuelRecord, now: number): Duel {
  const bot = botOf(r);
  const live = r.status === 'active';
  const me = r.result?.me ?? (live ? mySide(r, now) : { score: 0, best: null });
  const opp = r.result?.opponent ?? (live ? botSide(r, now) : { score: 0, best: null });
  return {
    id: r.id,
    kind: r.kind,
    days: r.days,
    status: r.status,
    iAmChallenger: r.iAmChallenger,
    createdAt: r.createdAt,
    expiresAt: r.status === 'pending' ? iso(ms(r.createdAt) + DUEL_INVITE_TTL_MS) : null,
    startsAt: r.startsAt,
    endsAt: r.startsAt ? iso(endOf(r)) : null,
    finishedAt: r.finishedAt,
    me: { user: meAuthor(), ...me },
    opponent: { user: bot ? toAuthor(bot) : { id: r.botId, name: 'Grzybiarz', level: 1, ringRarity: 'pospolity' }, ...opp },
    outcome: r.result?.outcome ?? null,
    xp: r.result ? r.result.xp : null,
  };
}

/* ───────────────────────── Powiadomienia (symulacja) ───────────────────────── */

/** Zdarzenie bota → zaplanowany wpis w centrum powiadomień (i systemowy) – tylko z narzędziami dev. */
function plan(r: MockDuelRecord, kind: ActivityItem['kind'], dueAt: number) {
  const bot = botOf(r);
  if (!DEV_TOOLS || !bot) return;
  const e = activityEntry({
    id: `mock.${r.id}.${kind}`,
    kind,
    actor: toAuthor(bot),
    postId: null,
    text: null,
    createdAt: iso(dueAt),
    refId: r.id,
    meta: { kind: r.kind, days: r.days },
  });
  useNotificationStore.getState().enqueue([{ key: e.key, kind: e.kind, title: e.title, body: e.body, icon: e.icon, href: e.href, dueAt, system: true }]);
}

const unplan = (id: string) => useNotificationStore.getState().cancel(`activity.mock.${id}.`);

/* ───────────────────────── Rozstrzyganie z czasu ───────────────────────── */

/** XP za pojedynek trafia do gracza (mocki: poziom i wkład tygodnia – jak xp_events na serwerze). */
function grantXp(xp: number) {
  if (xp <= 0) return;
  const u = useUserStore.getState();
  const r = applyXp({ level: u.user.level, xp: u.user.xp }, xp);
  u.patch({ user: { ...u.user, level: r.level, xp: r.xp }, weeklyContribution: u.weeklyContribution + xp });
}

function finish(r: MockDuelRecord, done: MockDuelRecord[]): MockDuelRecord {
  const end = endOf(r);
  const finishedAt = end + DUEL_GRACE_MS;
  const me = mySide(r, end);
  const opponent = botSide(r, end);
  const outcome = duelOutcome(me.score, opponent.score);
  const week = weekStartMs(finishedAt);
  const rewarded = done.filter((d) => d.result && d.result.xp > 0 && d.finishedAt && weekStartMs(ms(d.finishedAt)) === week);
  const xp = duelXp(outcome, {
    bothScored: me.score > 0 && opponent.score > 0,
    // Mocki: bez serwera i weryfikacji – „konto” gracza demo może odbierać nagrody.
    eligible: true,
    rewardedThisWeek: rewarded.length,
    pairRewardedThisWeek: rewarded.some((d) => d.botId === r.botId),
  });
  grantXp(xp);
  return { ...r, status: 'finished', finishedAt: iso(finishedAt), result: { me, opponent, outcome, xp } };
}

/** Przejścia stanów do chwili `now`: przyjęcie przez bota, wygaśnięcie, rozstrzygnięcie, blokada przeciwnika. */
function settle(now = Date.now()) {
  const list = db().duels;
  const done = list.filter((d) => d.status === 'finished');
  let changed = false;
  // Od najwcześniej kończących się – limit nagrodzonych pojedynków w tygodniu liczy się po kolei.
  const order = [...list].sort((a, b) => (ms(a.startsAt) || Infinity) - (ms(b.startsAt) || Infinity));
  const next = new Map<string, MockDuelRecord>();
  for (const r0 of order) {
    let r = r0;
    if ((r.status === 'pending' || r.status === 'active') && isBlocked(r.botId)) {
      // Blokada działa w obie strony – pojedynek z zablokowanym znika z gry.
      r = { ...r, status: 'cancelled', finishedAt: iso(now) };
      unplan(r.id);
    }
    if (r.status === 'pending' && r.iAmChallenger && r.acceptAt && ms(r.acceptAt) <= now) {
      r = { ...r, status: 'active', startsAt: r.acceptAt };
    }
    if (r.status === 'pending' && ms(r.createdAt) + DUEL_INVITE_TTL_MS <= now) {
      r = { ...r, status: 'expired', finishedAt: iso(ms(r.createdAt) + DUEL_INVITE_TTL_MS) };
    }
    if (r.status === 'active' && endOf(r) + DUEL_GRACE_MS <= now) {
      r = finish(r, done);
      done.push(r);
    }
    if (r !== r0) changed = true;
    next.set(r.id, r);
  }
  if (changed) db().set({ duels: list.map((d) => next.get(d.id) ?? d) });
}

/* ───────────────────────── Zestaw startowy ───────────────────────── */

const friendBots = (): MockPlayer[] =>
  useMockDb
    .getState()
    .friendIds.filter((id) => !isBlocked(id))
    .map(playerById)
    .filter((p): p is MockPlayer => !!p);

function snapshot(speciesId: string, capCm: number, findId: string): MockSideSnapshot {
  const s = SPECIES_BY_ID[speciesId];
  const pct = relativePct(capCm, s?.typical.capCm ?? 0);
  return { score: pct, best: { findId, speciesId, capCm, relativePct: pct, photoPath: null } };
}

/**
 * Pierwszy odczyt: wyzwanie bota do gracza (żeby było co przyjąć), trwający pojedynek z botem i trzy zakończone
 * (wygrana, przegrana, remis). Nowy gracz (reset z `emptyFeed`) i gracz bez znajomych – bez zestawu.
 */
function ensureSeed(now = Date.now()) {
  const s = db();
  if (s.seeded) return;
  const bots = friendBots();
  const id = () => uuid();
  const duels: MockDuelRecord[] = [];
  const base = { acceptAt: null, result: null } as const;
  const [a, b, c, d, e] = bots;
  if (a) {
    duels.push({ ...base, id: id(), kind: 'biggest', days: 3, botId: a.id, iAmChallenger: false, status: 'pending', createdAt: iso(now - 3 * H), startsAt: null, finishedAt: null });
  }
  if (b) {
    const startsAt = now - 26 * H;
    duels.push({ ...base, id: id(), kind: 'count', days: 3, botId: b.id, iAmChallenger: true, status: 'active', createdAt: iso(startsAt - 40 * 60_000), acceptAt: iso(startsAt), startsAt: iso(startsAt), finishedAt: null });
  }
  const past = (bot: MockPlayer, kind: DuelKind, days: DuelDays, agoDays: number, result: NonNullable<MockDuelRecord['result']>, iAmChallenger: boolean): MockDuelRecord => {
    const finishedAt = now - agoDays * DAY;
    const startsAt = finishedAt - DUEL_GRACE_MS - days * DAY;
    return { id: id(), kind, days, botId: bot.id, iAmChallenger, status: 'finished', createdAt: iso(startsAt - 2 * H), acceptAt: iso(startsAt), startsAt: iso(startsAt), finishedAt: iso(finishedAt), result };
  };
  if (c) duels.push(past(c, 'species', 1, 3, { me: { score: 5, best: null }, opponent: { score: 3, best: null }, outcome: 'won', xp: 100 }, true));
  if (d) {
    const me = snapshot('borowik-szlachetny', 14.2, 'mock-find-1');
    const opp = snapshot('czubajka-kania', 33.5, 'mock-find-2');
    duels.push(past(d, 'biggest', 3, 9, { me, opponent: opp, outcome: 'lost', xp: 0 }, false));
  }
  if (e) duels.push(past(e, 'count', 7, 16, { me: { score: 7, best: null }, opponent: { score: 7, best: null }, outcome: 'draw', xp: 30 }, true));
  s.set({ seeded: true, duels });
  for (const r of duels) {
    if (r.status === 'pending') plan(r, 'duel_invite', now);
    if (r.status === 'active') plan(r, 'duel_finished', endOf(r) + DUEL_GRACE_MS);
  }
}

/** Odczyt „serwera”: odtworzony stan, zestaw startowy, przejścia do teraz. */
async function ready(key: string, min?: number, max?: number) {
  await mockDuelsReady();
  await net(key, min, max);
  ensureSeed();
  settle();
}

function record(id: string): MockDuelRecord {
  const r = db().duels.find((d) => d.id === id);
  if (!r) throw new ServiceError('NOT_FOUND', 'Nie znaleziono pojedynku');
  return r;
}

function update(r: MockDuelRecord) {
  db().set({ duels: db().duels.map((d) => (d.id === r.id ? r : d)) });
  return r;
}

const isOpen = (r: MockDuelRecord) => r.status === 'pending' || r.status === 'active';
const CLOSED_DAYS = 30;

/* ───────────────────────── Ranking: punkty gracza ───────────────────────── */

/** Punkty gracza w okresie i świeże (ostatnie 24 h) z jego znalezisk – mocki: XP gry w telefonie. */
function myRankingXp(period: 'week' | 'season', now: number): { xp: number; pending: number } {
  const u = useUserStore.getState();
  const finds = Object.values(useTripStore.getState().finds);
  const pending = finds
    .filter((f) => f.status === 'claimed' && now - ms(f.foundAt) < DAY && ms(f.foundAt) >= weekStartMs(now))
    .reduce((n, f) => n + (f.xp?.total ?? 0), 0);
  // Tydzień – wkład tygodnia (jak ranking gmin w mockach); sezon – całe XP gracza (próg poziomów + bieżące XP).
  let xp = u.weeklyContribution;
  if (period === 'season') xp = 100 * (u.user.level - 1) * (u.user.level + 2) + u.user.xp;
  return { xp, pending: Math.min(pending, xp) };
}

/* ───────────────────────── Serwis ───────────────────────── */

export const mockDuels: DuelService = {
  async getDuels(): Promise<DuelsOverview> {
    await ready('duels', 400, 900);
    const now = Date.now();
    const all = db().duels;
    const duels = all.map((r) => toDuel(r, now));
    const by = (k: 'createdAt' | 'endsAt', dir: 1 | -1) => (x: Duel, y: Duel) => dir * ((ms(x[k]) || 0) - (ms(y[k]) || 0));
    const closed = duels
      .filter((d) => !['pending', 'active'].includes(d.status) && now - ms(d.finishedAt ?? d.createdAt) <= CLOSED_DAYS * DAY)
      .sort((x, y) => ms(y.finishedAt ?? y.createdAt) - ms(x.finishedAt ?? x.createdAt))
      .slice(0, 20);
    const outcomes = all.flatMap((r) => (r.result ? [r.result.outcome] : []));
    return {
      active: duels.filter((d) => d.status === 'active').sort(by('endsAt', 1)),
      incoming: duels.filter((d) => d.status === 'pending' && !d.iAmChallenger).sort(by('createdAt', -1)),
      outgoing: duels.filter((d) => d.status === 'pending' && d.iAmChallenger).sort(by('createdAt', -1)),
      finished: closed,
      record: {
        won: outcomes.filter((o) => o === 'won').length,
        lost: outcomes.filter((o) => o === 'lost').length,
        draw: outcomes.filter((o) => o === 'draw').length,
      },
    };
  },

  async getDuel(duelId) {
    await ready(`duel:${duelId}`, 300, 700);
    return toDuel(record(duelId), Date.now());
  },

  async createDuel(opponentId, kind, days, duelId) {
    await ready(`duel-create:${opponentId}`, 500, 1000);
    // Ponowienie z tym samym id (zapis się udał, odpowiedź nie dotarła) – ten sam pojedynek, jak na serwerze.
    const existing = duelId ? db().duels.find((d) => d.id === duelId && d.iAmChallenger && d.botId === opponentId) : undefined;
    if (existing) return toDuel(existing, Date.now());
    if (!isDuelKind(kind) || !DUEL_DAYS.includes(days)) throw new ServiceError('SERVER', 'Nieznany rodzaj albo czas pojedynku');
    const bot = playerById(opponentId);
    if (!bot || isBlocked(opponentId) || !useMockDb.getState().friendIds.includes(opponentId)) {
      throw new ServiceError('SERVER', 'Wyzwać możesz tylko znajomych');
    }
    const now = Date.now();
    const s = db();
    if (s.duels.some((d) => d.botId === opponentId && isOpen(d))) {
      throw new ServiceError('SERVER', 'Z tą osobą masz już pojedynek w toku – poczekaj na jego koniec');
    }
    if (s.duels.filter(isOpen).length >= DUEL_LIMITS.open) {
      throw new ServiceError('SERVER', `Masz już ${DUEL_LIMITS.open} pojedynki w toku – dokończ któryś, zanim wyzwiesz kolejną osobę`);
    }
    const sent = s.sentAt.filter((t) => now - ms(t) < DAY);
    if (sent.length >= DUEL_LIMITS.perDay) throw new ServiceError('SERVER', `Limit ${DUEL_LIMITS.perDay} wyzwań na dobę – kolejne jutro`);
    const id = duelId ?? uuid();
    // Bot „odpowiada” po 2–10 min (deterministycznie z id wyzwania).
    const acceptAt = now + (2 + (hashString(id) % 9)) * 60_000;
    const r: MockDuelRecord = {
      id,
      kind,
      days,
      botId: opponentId,
      iAmChallenger: true,
      status: 'pending',
      createdAt: iso(now),
      acceptAt: iso(acceptAt),
      startsAt: null,
      finishedAt: null,
      result: null,
    };
    s.set({ duels: [r, ...s.duels], sentAt: [...sent, iso(now)] });
    plan(r, 'duel_accepted', acceptAt);
    plan(r, 'duel_finished', acceptAt + duelLengthMs(days) + DUEL_GRACE_MS);
    return toDuel(r, now);
  },

  async respondDuel(duelId, accept) {
    await ready(`duel-respond:${duelId}`, 350, 800);
    const r = record(duelId);
    if (r.status !== 'pending' || r.iAmChallenger) throw new ServiceError('SERVER', 'To wyzwanie jest już nieaktualne');
    const now = Date.now();
    if (!accept) {
      unplan(r.id);
      return toDuel(update({ ...r, status: 'declined', finishedAt: iso(now) }), now);
    }
    // Limit pojedynków w toku (aktywne + oczekujące, poza tym wyzwaniem) – jak przy wyzywaniu.
    const open = db().duels.filter((d) => d.id !== r.id && isOpen(d)).length;
    if (open >= DUEL_LIMITS.open) {
      throw new ServiceError('SERVER', `Masz już ${open} pojedynki w toku (aktywne i oczekujące) – to limit.`);
    }
    const next = update({ ...r, status: 'active', startsAt: iso(now) });
    plan(next, 'duel_finished', endOf(next) + DUEL_GRACE_MS);
    return toDuel(next, now);
  },

  async cancelDuel(duelId) {
    await ready(`duel-cancel:${duelId}`, 300, 700);
    const r = record(duelId);
    if (r.status !== 'pending' || !r.iAmChallenger) throw new ServiceError('SERVER', 'Tego wyzwania nie da się już anulować');
    unplan(r.id);
    update({ ...r, status: 'cancelled', finishedAt: iso(Date.now()) });
  },

  async getPlayerRanking(scope, period, scopeId) {
    await mockDuelsReady();
    await net(`player-ranking:${scope}:${period}:${scopeId ?? ''}`, 400, 900);
    const now = Date.now();
    const u = useUserStore.getState();
    const catalog = useCatalogStore.getState().gminaById;
    const homeGmina = u.homeGminaPending ? undefined : catalog[u.user.homeGminaId];
    const { xp, pending } = myRankingXp(period, now);
    return mockPlayerRanking({
      scope,
      period,
      scopeId: scopeId ?? null,
      now,
      me: meAuthor(),
      myXp: xp,
      pendingXp: pending,
      home: u.homeGminaPending ? null : { gminaId: u.user.homeGminaId, voivodeship: homeGmina?.voivodeship ?? 'podlaskie' },
      gminaName: (id) => gminaTitle(catalog[id]) || id,
      friendIds: useMockDb.getState().friendIds,
      isBlocked,
      hidden: !db().showInRankings,
    });
  },

  async setRankingVisibility(visible) {
    await mockDuelsReady();
    await net(`ranking-visibility:${visible}`, 250, 600);
    db().set({ showInRankings: visible });
  },

  async getRivalryStatus() {
    await mockDuelsReady();
    await net('rivalry-status', 200, 500);
    // Mocki: bez serwera nie ma weryfikacji ani konta – gracz bierze udział i może odbierać nagrody.
    return { showInRankings: db().showInRankings, standing: 'ok', accountSecured: true };
  },
};
