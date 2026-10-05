/**
 * Akcje gry spinające store'y (wyprawa ↔ użytkownik ↔ zadania ↔ odznaki).
 * Cała arytmetyka XP pochodzi z czystych funkcji w utils/xp.ts.
 */
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

import type { Find, GminaChallenge, Identification, Quest, QuestProgress, Rarity, Trip } from '@/types';
import { BADGE_RULES } from '@/utils/badges';
import { makeId } from '@/utils/random';
import { applyXp, computeFindXp } from '@/utils/xp';
import { catalog } from './useCatalogStore';
import { useSimStore } from './useSimStore';
import { tripElapsedMs, useTripStore } from './useTripStore';
import { ui } from './useUiStore';
import { initialUserState, todayKey, useUserStore, type AcceptedChallenge } from './useUserStore';

const RARITY_RANK: Record<Rarity, number> = { pospolity: 0, rzadki: 1, epicki: 2, legendarny: 3 };

function successHaptic() {
  if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}

function yesterdayKey() {
  return todayKey(new Date(Date.now() - 86400000));
}

/** Reset dzienny (zadania, „pierwszy w gminie dziś”) + aktualizacja serii dni. */
export function ensureDailyReset() {
  const u = useUserStore.getState();
  const today = todayKey();
  const patch: Parameters<typeof u.patch>[0] = {};
  if (u.quests.date !== today) patch.quests = { date: today, progress: {}, pendingRewards: [] };
  if (u.today.date !== today) patch.today = { date: today, keys: [], km: 0 };
  if (Object.keys(patch).length) u.patch(patch);
}

function bumpStreakForToday() {
  const u = useUserStore.getState();
  const today = todayKey();
  if (u.lastActiveDate === today) return;
  const streak = u.lastActiveDate === yesterdayKey() ? u.user.streakDays + 1 : 1;
  u.patch({
    lastActiveDate: today,
    user: { ...u.user, streakDays: streak },
    counters: { ...u.counters, streakDays: streak },
  });
}

/* ───────────────────────── Zadania ───────────────────────── */

export function challengeQuest(c: AcceptedChallenge): Quest {
  return {
    id: `ch:${c.id}`,
    kind: 'challenge',
    title: c.title,
    icon: 'flag',
    iconFilled: true,
    iconBg: '#2F4A1E',
    iconColor: '#BDE38E',
    xp: c.xp,
    target: 1,
    speciesId: c.speciesId,
  };
}

export function allQuests(): Quest[] {
  return [...catalog().dailyQuests, ...useUserStore.getState().challenges.map(challengeQuest)];
}

function setQuestProgress(questId: string, progress: number, target: number): boolean {
  const u = useUserStore.getState();
  const prev = u.quests.progress[questId];
  if (prev?.completed) return false;
  const completed = progress >= target;
  const next: QuestProgress = { questId, progress: Math.min(progress, target), completed };
  u.patch({
    quests: {
      ...u.quests,
      progress: { ...u.quests.progress, [questId]: next },
      pendingRewards: completed ? [...u.quests.pendingRewards, questId] : u.quests.pendingRewards,
    },
  });
  return completed;
}

/** Wypłaca XP za ukończone zadania (po ekranie Nagroda albo od razu – dystans). */
export function grantPendingQuestRewards() {
  const u = useUserStore.getState();
  const pending = u.quests.pendingRewards;
  if (!pending.length) return;
  const quests = allQuests();
  let level = { level: u.user.level, xp: u.user.xp };
  let total = 0;
  const ups: number[] = [];
  const unlocked: string[] = [];
  pending.forEach((qid) => {
    const q = quests.find((x) => x.id === qid);
    if (!q) return;
    const r = applyXp(level, q.xp);
    level = { level: r.level, xp: r.xp };
    ups.push(...r.levelUps);
    total += q.xp;
    if (q.kind === 'challenge') {
      const ch = u.challenges.find((c) => `ch:${c.id}` === qid);
      if (ch && !u.badges.includes(ch.badgeId)) unlocked.push(ch.badgeId);
    }
    ui.toast(`Zadanie wykonane: ${q.title} · +${q.xp} XP`, 'check_circle');
  });
  u.patch({
    user: { ...u.user, level: level.level, xp: level.xp },
    badges: [...u.badges, ...unlocked.filter((b) => !u.badges.includes(b))],
    weeklyContribution: u.weeklyContribution + total,
    quests: { ...u.quests, pendingRewards: [] },
  });
  addXpToActiveTrip(total);
  if (ups.length) {
    successHaptic();
    setTimeout(() => ui.toast(`LEVEL UP! Poziom ${ups[ups.length - 1]}`, 'celebration'), 1400);
  } else {
    successHaptic();
  }
}

function addXpToActiveTrip(xp: number) {
  const ts = useTripStore.getState();
  const trip = ts.activeTripId ? ts.trips[ts.activeTripId] : null;
  if (trip && xp) ts.upsertTrip({ ...trip, xp: trip.xp + xp });
}

/* ───────────────────────── Wyprawa ───────────────────────── */

export function startTrip(gminaId: string): Trip {
  ensureDailyReset();
  bumpStreakForToday();
  const ts = useTripStore.getState();
  const existing = ts.activeTripId ? ts.trips[ts.activeTripId] : null;
  if (existing) return existing;
  const now = Date.now();
  const trip: Trip = {
    id: makeId('trip'),
    gminaId,
    status: 'active',
    startedAt: new Date(now).toISOString(),
    elapsedMs: 0,
    segmentStartedAt: now,
    distanceKm: 0,
    findIds: [],
    xp: 0,
    hideRoute: false,
  };
  ts.upsertTrip(trip);
  ts.patch({ activeTripId: trip.id });
  return trip;
}

export function finishTrip(): string | null {
  const ts = useTripStore.getState();
  const trip = ts.activeTripId ? ts.trips[ts.activeTripId] : null;
  if (!trip) return null;
  const speed = useSimStore.getState().timeSpeed;
  const now = Date.now();
  const elapsed = tripElapsedMs(trip, speed, now);
  const finished: Trip = {
    ...trip,
    status: 'finished',
    elapsedMs: elapsed,
    segmentStartedAt: now,
    endedAt: new Date(new Date(trip.startedAt).getTime() + elapsed).toISOString(),
  };
  ts.upsertTrip(finished);
  ts.patch({ activeTripId: null });
  const u = useUserStore.getState();
  u.patch({ user: { ...u.user, tripsCount: u.user.tripsCount + 1 } });
  return trip.id;
}

export function addDistance(deltaKm: number) {
  ensureDailyReset();
  const ts = useTripStore.getState();
  const trip = ts.activeTripId ? ts.trips[ts.activeTripId] : null;
  if (!trip || deltaKm <= 0) return;
  ts.upsertTrip({ ...trip, distanceKm: trip.distanceKm + deltaKm });
  const u = useUserStore.getState();
  const km = u.today.km + deltaKm;
  u.patch({ today: { ...u.today, km }, counters: { ...u.counters, totalKm: u.counters.totalKm + deltaKm } });
  const q = catalog().dailyQuests.find((x) => x.kind === 'distance');
  if (q && setQuestProgress(q.id, Math.floor(km * 10) / 10, q.target)) grantPendingQuestRewards();
}

/** Zmiana przyspieszenia czasu bez „skoku” licznika. */
export function setTimeSpeed(speed: 1 | 10) {
  const sim = useSimStore.getState();
  const ts = useTripStore.getState();
  const trip = ts.activeTripId ? ts.trips[ts.activeTripId] : null;
  if (trip) {
    const now = Date.now();
    ts.upsertTrip({ ...trip, elapsedMs: tripElapsedMs(trip, sim.timeSpeed, now), segmentStartedAt: now });
  }
  sim.set({ timeSpeed: speed });
}

export function setHideRoute(tripId: string, hideRoute: boolean) {
  const ts = useTripStore.getState();
  const trip = ts.trips[tripId];
  if (trip) ts.upsertTrip({ ...trip, hideRoute });
}

export function markPublished(tripId: string, postId: string) {
  const ts = useTripStore.getState();
  const trip = ts.trips[tripId];
  if (trip) ts.upsertTrip({ ...trip, status: 'published', postId });
}

/* ───────────────────────── Znaleziska ───────────────────────── */

export function createPendingFind(id: Identification, gminaId: string): Find {
  const species = catalog().speciesById[id.speciesId];
  const poisonous = species?.edibility === 'trujacy' || species?.edibility === 'smiertelny';
  const find: Find = {
    id: makeId('find'),
    tripId: useTripStore.getState().activeTripId,
    speciesId: id.speciesId,
    gminaId,
    rarity: id.rarity,
    confidence: id.confidence,
    xxl: id.xxl,
    dimensions: id.dimensions,
    collected: !poisonous,
    status: 'pending',
    foundAt: new Date().toISOString(),
    candidates: id.candidates,
  };
  useTripStore.getState().upsertFind(find);
  return find;
}

export function discardPendingFind(findId: string) {
  const f = useTripStore.getState().finds[findId];
  if (f && f.status === 'pending') useTripStore.getState().removeFind(findId);
}

/** „Odbierz nagrodę” / „Zapisz w atlasie”: XP, atlas, odznaki, zadania, wyprawa. */
export function claimFind(findId: string): Find | null {
  ensureDailyReset();
  const ts = useTripStore.getState();
  const find = ts.finds[findId];
  if (!find || find.status === 'claimed') return find ?? null;
  const species = catalog().speciesById[find.speciesId];
  const gmina = catalog().gminaById[find.gminaId];
  if (!species) return null;

  // Znalezisko poza wyprawą → automatycznie rozpoczynamy wyprawę (jak „Zbieram dalej” w makiecie).
  let trip = ts.activeTripId ? ts.trips[ts.activeTripId] : null;
  if (!trip) {
    trip = startTrip(find.gminaId);
    ui.toast('Rozpoczęto wyprawę', 'hiking');
  }

  const u = useUserStore.getState();
  const key = `${find.gminaId}:${find.speciesId}`;
  const prevAtlas = u.atlas[find.speciesId];
  const newInAtlas = !prevAtlas;
  const xp = computeFindXp({
    rarity: find.rarity,
    xxl: find.xxl,
    photoOnly: !find.collected,
    firstOfSpeciesInGminaToday: !u.today.keys.includes(key),
    streakDays: u.user.streakDays,
    newInAtlas,
    speciesShortName: species.shortName,
  });
  const before = { level: u.user.level, xp: u.user.xp };
  const after = applyXp(before, xp.total);

  // Atlas + rekord osobisty.
  const personalRecord = !!prevAtlas && prevAtlas.bestCapCm > 0 && find.dimensions.capCm > prevAtlas.bestCapCm;
  const atlasEntry = {
    count: (prevAtlas?.count ?? 0) + 1,
    firstFoundAt: prevAtlas?.firstFoundAt ?? find.foundAt,
    bestCapCm: Math.max(prevAtlas?.bestCapCm ?? 0, find.dimensions.capCm),
    bestWeightG: Math.max(prevAtlas?.bestWeightG ?? 0, find.dimensions.weightG),
  };

  // Liczniki odznak.
  const counters = { ...u.counters };
  if (find.collected && species.id === 'borowik-szlachetny' && gmina?.forest === 'Puszcza Knyszyńska') {
    counters.borowikiKnyszynska += 1;
  }
  if (find.rarity === 'legendarny') counters.legendaryFinds += 1;
  const unlocked = (Object.keys(BADGE_RULES) as (keyof typeof BADGE_RULES)[]).filter((id) => {
    const rule = BADGE_RULES[id];
    return !u.badges.includes(id) && counters[rule.counter] >= rule.target;
  });

  u.patch({
    user: {
      ...u.user,
      level: after.level,
      xp: after.xp,
      mushroomsCount: u.user.mushroomsCount + (find.collected ? 1 : 0),
    },
    atlas: { ...u.atlas, [find.speciesId]: atlasEntry },
    counters,
    badges: [...u.badges, ...unlocked],
    weeklyContribution: u.weeklyContribution + xp.total,
    today: { ...u.today, keys: u.today.keys.includes(key) ? u.today.keys : [...u.today.keys, key] },
  });

  // Zadania (nagrody wypłacane po ekranie Nagroda).
  const completedQuestIds: string[] = [];
  const quests = allQuests();
  const prog = (id: string) => useUserStore.getState().quests.progress[id]?.progress ?? 0;
  quests.forEach((q) => {
    let done = false;
    if (q.kind === 'scans') done = setQuestProgress(q.id, prog(q.id) + 1, q.target);
    if (q.kind === 'rare' && RARITY_RANK[find.rarity] >= RARITY_RANK.rzadki) done = setQuestProgress(q.id, prog(q.id) + 1, q.target);
    if (q.kind === 'challenge' && q.speciesId === find.speciesId) done = setQuestProgress(q.id, 1, 1);
    if (done) completedQuestIds.push(q.id);
  });

  const claimed: Find = {
    ...find,
    tripId: trip.id,
    status: 'claimed',
    xp,
    reward: {
      levelBefore: before.level,
      xpBefore: before.xp,
      levelAfter: after.level,
      xpAfter: after.xp,
      unlockedBadgeIds: unlocked,
      completedQuestIds,
      personalRecord,
    },
  };
  const tsNow = useTripStore.getState();
  const tripNow = tsNow.trips[trip.id];
  tsNow.upsertFind(claimed);
  tsNow.upsertTrip({ ...tripNow, findIds: [...tripNow.findIds, claimed.id], xp: tripNow.xp + xp.total });
  if (after.levelUps.length || unlocked.length) successHaptic();
  return claimed;
}

/* ───────────────────────── Gminy ───────────────────────── */

export function toggleFollow(gminaId: string): boolean {
  const u = useUserStore.getState();
  const on = !u.followedGminy.includes(gminaId);
  u.patch({ followedGminy: on ? [...u.followedGminy, gminaId] : u.followedGminy.filter((g) => g !== gminaId) });
  return on;
}

export function acceptChallenge(gminaId: string, challenge: GminaChallenge): boolean {
  const u = useUserStore.getState();
  if (u.challenges.some((c) => c.id === challenge.id)) return false;
  u.patch({ challenges: [...u.challenges, { ...challenge, gminaId, acceptedAt: new Date().toISOString() }] });
  return true;
}

/* ───────────────────────── Dev ───────────────────────── */

export function devAddXp(amount: number) {
  const u = useUserStore.getState();
  const r = applyXp({ level: u.user.level, xp: u.user.xp }, amount);
  u.patch({ user: { ...u.user, level: r.level, xp: r.xp } });
  if (r.levelUps.length) {
    successHaptic();
    ui.toast(`LEVEL UP! Poziom ${r.level}`, 'celebration');
  } else ui.toast(`+${amount} XP`, 'auto_awesome');
}

export function devUnlockBadge(id: string) {
  const u = useUserStore.getState();
  if (u.badges.includes(id)) return;
  u.patch({ badges: [...u.badges, id] });
  successHaptic();
}

/** Reset stanu klienta. Dane „serwera” mocków resetuje Services.dev.reset(). */
export function resetAll() {
  useUserStore.getState().reset();
  useTripStore.getState().reset();
  useSimStore.getState().reset();
}

export type Scenario = 'start' | 'newUser' | 'designActive' | 'designSummary';

/** Scenariusze z panelu /dev – m.in. odtworzenie stanów z makiety do porównań zrzutów. */
export function loadScenario(s: Scenario): string | null {
  const sim = useSimStore.getState();
  const keepPerms = sim.permissions;
  const keepSource = sim.locationSource;
  resetAll();
  useSimStore.getState().set({
    permissions: { ...keepPerms, location: 'granted', camera: 'granted' },
    // Stany z makiety dzieją się w Supraślu – niezależnie od prawdziwego GPS.
    locationSource: s.startsWith('design') ? 'sim' : keepSource,
  });
  if (s === 'start') return null;
  if (s === 'newUser') {
    const base = initialUserState();
    useUserStore.getState().reset({
      user: { ...base.user, level: 1, xp: 0, streakDays: 0, tripsCount: 0, mushroomsCount: 0 },
      atlas: {},
      badges: [],
      counters: { borowikiKnyszynska: 0, totalKm: 0, streakDays: 0, legendaryFinds: 0 },
      weeklyContribution: 0,
    });
    return null;
  }
  const now = Date.now();
  const mk = (
    speciesId: string,
    rarity: Rarity,
    dims: Find['dimensions'],
    total: number,
    minutesAgo: number,
    tripId: string,
  ): Find => ({
    id: makeId('find'),
    tripId,
    speciesId,
    gminaId: 'suprasl',
    rarity,
    confidence: 0.94,
    xxl: false,
    dimensions: dims,
    collected: true,
    status: 'claimed',
    foundAt: new Date(now - minutesAgo * 60000).toISOString(),
    xp: { lines: [{ label: `Bazowe XP (${rarity})`, xp: total }], total },
  });
  const ts = useTripStore.getState();
  if (s === 'designActive') {
    const id = makeId('trip');
    const finds = [
      mk('maslak-zwyczajny', 'pospolity', { capCm: 7, heightCm: 6, weightG: 70, ageDays: 3 }, 40, 70, id),
      mk('podgrzybek-brunatny', 'pospolity', { capCm: 8, heightCm: 9, weightG: 100, ageDays: 3 }, 25, 62, id),
      mk('kozlarz-babka', 'pospolity', { capCm: 9, heightCm: 12, weightG: 110, ageDays: 4 }, 15, 51, id),
      mk('maslak-zwyczajny', 'pospolity', { capCm: 6, heightCm: 5, weightG: 55, ageDays: 2 }, 15, 40, id),
      mk('pieprznik-jadalny', 'pospolity', { capCm: 5, heightCm: 6, weightG: 160, ageDays: 3, pieces: 12 }, 35, 22, id),
      mk('podgrzybek-brunatny', 'pospolity', { capCm: 9, heightCm: 10, weightG: 120, ageDays: 4 }, 40, 12, id),
      mk('borowik-szlachetny', 'rzadki', { capCm: 14, heightCm: 17, weightG: 410, ageDays: 5 }, 250, 3, id),
    ];
    finds.forEach((f) => ts.upsertFind(f));
    const elapsed = (1 * 3600 + 24 * 60 + 10) * 1000;
    ts.upsertTrip({
      id,
      gminaId: 'suprasl',
      status: 'active',
      startedAt: new Date(now - elapsed).toISOString(),
      elapsedMs: elapsed,
      segmentStartedAt: now,
      distanceKm: 3.8,
      findIds: finds.map((f) => f.id),
      xp: 420,
      hideRoute: false,
    });
    ts.patch({ activeTripId: id });
    return id;
  }
  // designSummary: 7,4 km · 3 h 12 min · 11 grzybów · 6 gatunków · +1 280 XP · łup 7/3/1/0
  const id = makeId('trip');
  const P = (sp: string, w: number, xp: number, m: number) =>
    mk(sp, 'pospolity', { capCm: 8, heightCm: 9, weightG: w, ageDays: 3 }, xp, m, id);
  const R = (sp: string, w: number, xp: number, m: number) =>
    mk(sp, 'rzadki', { capCm: 12, heightCm: 13, weightG: w, ageDays: 4 }, xp, m, id);
  const finds = [
    P('podgrzybek-brunatny', 110, 40, 180),
    P('podgrzybek-brunatny', 95, 40, 170),
    P('maslak-zwyczajny', 70, 40, 160),
    P('pieprznik-jadalny', 150, 40, 150),
    P('podgrzybek-brunatny', 120, 110, 120),
    P('maslak-zwyczajny', 130, 40, 100),
    P('maslak-zwyczajny', 60, 40, 90),
    R('borowik-szlachetny', 380, 220, 80),
    R('mleczaj-rydz', 90, 160, 60),
    R('borowik-szlachetny', 300, 160, 40),
    {
      ...mk('czubajka-kania', 'epicki', { capCm: 31, heightCm: 34, weightG: 260, ageDays: 4 }, 390, 20, id),
      reward: {
        levelBefore: 14,
        xpBefore: 0,
        levelAfter: 14,
        xpAfter: 0,
        unlockedBadgeIds: [],
        completedQuestIds: [],
        personalRecord: true,
      },
    },
  ];
  finds.forEach((f) => ts.upsertFind(f));
  const start = new Date(now);
  start.setHours(7, 12, 0, 0);
  if (start.getTime() > now) start.setDate(start.getDate() - 1);
  const elapsed = (3 * 3600 + 12 * 60) * 1000;
  ts.upsertTrip({
    id,
    gminaId: 'suprasl',
    status: 'finished',
    startedAt: start.toISOString(),
    endedAt: new Date(start.getTime() + elapsed).toISOString(),
    elapsedMs: elapsed,
    segmentStartedAt: now,
    distanceKm: 7.4,
    findIds: finds.map((f) => f.id),
    xp: 1280,
    hideRoute: false,
  });
  return id;
}
