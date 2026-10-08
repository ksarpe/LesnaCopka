/**
 * Akcje gry spinające store'y (wyprawa ↔ użytkownik ↔ zadania ↔ odznaki ↔ osiągnięcia).
 * Cała arytmetyka XP pochodzi z czystych funkcji w utils/xp.ts.
 */
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

import { pruneAvatarFiles } from '@/services/live/avatarPhoto';
import { clearFindPhotos, deleteFindPhoto } from '@/services/live/findPhotos';
import { clearWeatherCache } from '@/services/live/weather';
import type {
  AchievementUnlock,
  Find,
  GminaChallenge,
  Identification,
  Quest,
  Rarity,
  ScanPart,
  Trip,
  User,
} from '@/types';
import { ACHIEVEMENT_BY_ID, evaluateAchievements, newlyReached, tierKind, TIER_LABEL } from '@/utils/achievements';
import {
  countActiveDay,
  countFind,
  countSocial,
  countTripFinish,
  countTripStart,
  effectiveStreak,
  EMPTY_COUNTERS,
  type SocialEvent,
} from '@/utils/counters';
import { isDataUri, trimPhotoBudget } from '@/utils/findPhoto';
import { uuid } from '@/utils/random';
import { isPhotoOnlySpecies, isPoisonousEdibility, isProtectedSpecies } from '@/utils/species';
import { applyXp, computeFindXp } from '@/utils/xp';
import {
  addDistanceProgress,
  badgesToUnlock,
  bumpQuests,
  currentQuests,
  pinDesignQuests,
  questPeriodsPatch,
  setQuestProgress,
  unlockBadges,
} from './progress';
import { catalog } from './useCatalogStore';
import { outboxEnabled, useOutboxStore, type OutboxEvent } from './useOutboxStore';
import { usePrefsStore } from './usePrefsStore';
import { useSimStore } from './useSimStore';
import { useTrackStore } from './useTrackStore';
import { tripElapsedMs, useTripStore } from './useTripStore';
import { persistLazily } from './storage';
import { ui } from './useUiStore';
import { initialUserState, questsFor, todayKey, useUserStore, type AcceptedChallenge, type UserState } from './useUserStore';
import { useVoivodeshipStore } from './useVoivodeshipStore';

function successHaptic() {
  if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}

/**
 * Tryb Supabase (local-first): zdarzenie gry do kolejki synchronizacji – stan lokalny jest już policzony,
 * serwer powtarza akcję i przy pustej kolejce aplikacja przyjmuje jego liczby. W trybie mock – nic.
 * Akcje dev (XP, gatunki, odznaki, scenariusze, reset) zostają lokalne: w trybie Supabase nadpisze je
 * następne pobranie stanu z serwera.
 */
function emit(e: OutboxEvent) {
  useOutboxStore.getState().enqueue(e);
}

function yesterdayKey() {
  return todayKey(new Date(Date.now() - 86400000));
}

/**
 * Reset dzienny i tygodniowy (zadania z nowego losowania, „pierwszy w gminie dziś”) i przerwana seria: ostatni dzień
 * w lesie przed wczoraj → seria 0 (pigułka na Starcie, odznaka „seria-7”). Następna aktywność zacznie ją od 1
 * (bumpStreakForToday); serwer liczy to samo (effectiveStreak przy przyjęciu stanu), więc nic nie idzie do kolejki.
 * Wołane po hydratacji store'ów, przed akcjami gry i po powrocie aplikacji na pierwszy plan (NotificationsHost).
 */
export function ensureDailyReset() {
  const u = useUserStore.getState();
  const today = todayKey();
  const patch: Parameters<typeof u.patch>[0] = { ...questPeriodsPatch() };
  if (u.today.date !== today) patch.today = { date: today, keys: [], km: 0 };
  if (effectiveStreak(u.user.streakDays, u.lastActiveDate, today, yesterdayKey()) === 0) {
    if (u.user.streakDays) patch.user = { ...u.user, streakDays: 0 };
    if (u.counters.streakDays) patch.counters = { ...u.counters, streakDays: 0 };
  }
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
    counters: countActiveDay(u.counters, streak),
  });
}

/** Odznaki z liczników poza znaleziskiem (seria, ranny ptaszek, 100 km) – od razu, z toastem. */
function unlockBadgesWithToast() {
  const ids = unlockBadges();
  if (!ids.length) return;
  successHaptic();
  ids.forEach((id, i) => {
    const name = catalog().badgeById[id]?.name ?? id;
    setTimeout(() => ui.toast(`Nowa odznaka: ${name}`, 'military_tech'), i * 1300);
  });
}

/** Po zdarzeniu spoza ekranu Nagroda: osiągnięcia + wypłata ukończonych zadań od razu. */
function settleProgress(questsDone: boolean) {
  const unlocks = syncAchievements();
  if (questsDone || unlocks.length) grantPendingRewards();
}

/** Początek tygodnia (poniedziałek 00:00, czas lokalny) dla daty. */
function weekStartMs(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x.getTime();
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

/**
 * Przyjęte wyzwania widoczne w zadaniach dnia (tryb Supabase – pola z serwera; mocki ich nie mają): ukończone
 * tylko w dniu ukończenia, nieukończone – do końca wyzwania (tygodniowe trwają do niedzieli).
 */
export function visibleChallenges(list: AcceptedChallenge[], now = Date.now()): AcceptedChallenge[] {
  const today = todayKey(new Date(now));
  return list.filter((c) =>
    c.completedAt ? todayKey(new Date(c.completedAt)) === today : !c.endsAt || new Date(c.endsAt).getTime() > now,
  );
}

/** Zadania dnia (wylosowane – src/store/progress.ts) + przyjęte wyzwania gmin. */
export function allQuests(): Quest[] {
  return [...currentQuests().daily, ...visibleChallenges(useUserStore.getState().challenges).map(challengeQuest)];
}

/** Zadania tygodnia (reset w poniedziałek). */
export function weeklyQuestList(): Quest[] {
  return currentQuests().weekly;
}

/* ───────────────────────── Osiągnięcia ───────────────────────── */

/**
 * Porównuje postęp (liczony z atlasu) z nagrodzonymi stopniami; nowe stopnie zapisuje jako
 * nagrodzone i dokłada do kolejki wypłat. Zwraca odblokowane stopnie.
 */
export function syncAchievements(): AchievementUnlock[] {
  const u = useUserStore.getState();
  const states = evaluateAchievements({ atlas: u.atlas, species: catalog().species, counters: u.counters });
  const unlocks = newlyReached(u.achievements, states);
  if (!unlocks.length) return [];
  const awarded = { ...u.achievements };
  unlocks.forEach((x) => (awarded[x.id] = Math.max(awarded[x.id] ?? 0, x.tier)));
  u.patch({ achievements: awarded, pendingAchievements: [...u.pendingAchievements, ...unlocks] });
  return unlocks;
}

/** „Kolekcjoner · Srebro” / „Wielka trójka”. */
export function achievementTitle(x: AchievementUnlock) {
  const def = ACHIEVEMENT_BY_ID[x.id];
  if (!def) return x.id;
  return def.tiers.length > 1 ? `${def.name} · ${TIER_LABEL[tierKind(def.tiers.length, x.tier)]}` : def.name;
}

/** Wypłaca XP za ukończone zadania i zdobyte stopnie osiągnięć (po ekranie Nagroda albo od razu – dystans). */
export function grantPendingRewards() {
  const u = useUserStore.getState();
  const pending = u.quests.pendingRewards;
  const achievements = u.pendingAchievements;
  if (!pending.length && !achievements.length) return;
  const quests = [...allQuests(), ...weeklyQuestList()];
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
      if (ch?.badgeId && !u.badges.includes(ch.badgeId)) unlocked.push(ch.badgeId);
    }
    ui.toast(`Zadanie wykonane: ${q.title} · +${q.xp} XP`, 'check_circle');
  });
  let achievementXp = 0;
  achievements.forEach((a) => {
    const r = applyXp(level, a.xp);
    level = { level: r.level, xp: r.xp };
    ups.push(...r.levelUps);
    achievementXp += a.xp;
  });
  total += achievementXp;
  if (achievements.length) {
    const text =
      achievements.length === 1
        ? `Osiągnięcie: ${achievementTitle(achievements[0])} · +${achievementXp} XP`
        : `Zdobyto ${achievements.length} osiągnięcia · +${achievementXp} XP`;
    // Po toastach zadań (jeden toast naraz) – osiągnięcie pokazujemy chwilę później.
    if (pending.length) setTimeout(() => ui.toast(text, 'emoji_events'), 1300);
    else ui.toast(text, 'emoji_events');
  }
  u.patch({
    user: { ...u.user, level: level.level, xp: level.xp },
    badges: [...u.badges, ...unlocked.filter((b) => !u.badges.includes(b))],
    weeklyContribution: u.weeklyContribution + total,
    quests: { ...u.quests, pendingRewards: [] },
    pendingAchievements: [],
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
    id: uuid(),
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
  emit({ type: 'trip.start', payload: { tripId: trip.id, gminaId, startedAt: trip.startedAt } });
  // Liczniki (ranny ptaszek), zadanie „Wyrusz przed 7:00”, odznaki serii i rannego ptaszka.
  const u = useUserStore.getState();
  u.patch({ counters: countTripStart(u.counters, new Date(now)) });
  const done = bumpQuests({ type: 'tripStart', hour: new Date(now).getHours() });
  unlockBadgesWithToast();
  settleProgress(done.length > 0);
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
    // Ustawienia → Prywatność: „Domyślnie ukrywaj trasę” (w Podsumowaniu można to zmienić).
    hideRoute: usePrefsStore.getState().hideRouteByDefault,
  };
  ts.upsertTrip(finished);
  ts.patch({ activeTripId: null });
  const u = useUserStore.getState();
  u.patch({
    user: { ...u.user, tripsCount: u.user.tripsCount + 1 },
    counters: countTripFinish(u.counters, { distanceKm: finished.distanceKm, minutes: elapsed / 60000 }),
  });
  // Zadania „Zakończ 3 wyprawy”, „Ponad godzinę w lesie”; osiągnięcia wypraw – XP od razu.
  settleProgress(bumpQuests({ type: 'tripFinish', minutes: elapsed / 60000 }).length > 0);
  // Serwer dostaje czas rzeczywisty (przyspieszenie ×10 z panelu dev nie wybiega w przyszłość).
  const startMs = new Date(trip.startedAt).getTime();
  const durationS = Math.max(0, Math.min(Math.round(elapsed / 1000), Math.floor((now - startMs) / 1000)));
  emit({
    type: 'trip.finish',
    payload: {
      tripId: trip.id,
      distanceM: Math.round(finished.distanceKm * 1000),
      durationS,
      endedAt: new Date(startMs + durationS * 1000).toISOString(),
    },
  });
  return trip.id;
}

/**
 * Dystans z GPS (co ok. 5 m / 4 s – TripTracker). Wyprawa i kilometry gracza zmieniają się w pamięci od razu (UI,
 * zadania, osiągnięcia, kolejka `trip.progress`), ale na dysk trafiają leniwie – najpóźniej po 30 s, w tle aplikacji
 * i przy najbliższym zwykłym zapisie (koniec wyprawy, znalezisko, wypłata XP) – patrz persistLazily. Bez tego każdy
 * odczyt GPS serializował cały store wypraw (na webie ze zdjęciami) i kilka razy stan gracza.
 */
export function addDistance(deltaKm: number) {
  ensureDailyReset();
  const ts = useTripStore.getState();
  const trip = ts.activeTripId ? ts.trips[ts.activeTripId] : null;
  if (!trip || deltaKm <= 0) return;
  const distanceKm = trip.distanceKm + deltaKm;
  const questDone = persistLazily(() => {
    ts.upsertTrip({ ...trip, distanceKm });
    // Kilometry dnia, tygodnia i łączne + zadania dystansu – jeden zapis stanu gracza.
    return addDistanceProgress(deltaKm);
  });
  useOutboxStore.getState().enqueueTripProgress(trip.id, Math.round(distanceKm * 1000));
  // Ukończone zadania dystansu – XP od razu (zwykły zapis: utrwala też kilometry); odznaka „100 km”.
  if (questDone) grantPendingRewards();
  unlockBadgesWithToast();
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
  if (!trip) return;
  const first = trip.status !== 'published';
  ts.upsertTrip({ ...trip, status: 'published', postId });
  if (first) noteSocial('published');
}

/**
 * Akcje społeczności (feed, komentarze, znajomi, publikacja): liczniki osiągnięć „Społeczność” i zadania
 * („Daj Darz grzyb! 3 wyprawom”, „Opublikuj wyprawę”). Tryb Supabase: serwer liczy to samo w wyzwalaczach
 * (post_reactions / post_comments / friendships / posts) – po synchronizacji wygrywają jego liczby.
 */
export function noteSocial(e: SocialEvent) {
  const u = useUserStore.getState();
  u.patch({ counters: countSocial(u.counters, e) });
  const done = e === 'reactionGiven' ? bumpQuests({ type: 'reaction' }) : e === 'published' ? bumpQuests({ type: 'publish' }) : [];
  settleProgress(done.length > 0);
}

/* ───────────────────────── Znaleziska ───────────────────────── */

/**
 * Znalezisko z rozpoznania zdjęcia (IdentifyOutcome „mushroom”). `parts` – części owocnika widoczne na zdjęciu
 * (podpowiedź na Analizie, wysyłane z rozpoznaniem na serwer jako ujęcia skanu).
 */
export function createPendingFind(
  id: Identification,
  gminaId: string,
  opts?: { photoUri?: string; parts?: ScanPart[] },
): Find {
  const species = catalog().speciesById[id.speciesId];
  // Trujący albo chroniony → tylko zdjęcie (serwer: submit_find liczy collected tak samo).
  const photoOnly = !!species && isPhotoOnlySpecies(species);
  const find: Find = {
    id: uuid(),
    tripId: useTripStore.getState().activeTripId,
    speciesId: id.speciesId,
    gminaId,
    rarity: id.rarity,
    confidence: id.confidence,
    xxl: id.xxl,
    dimensions: id.dimensions,
    collected: !photoOnly,
    status: 'pending',
    foundAt: new Date().toISOString(),
    candidates: id.candidates,
    ...(opts?.parts?.length ? { visibleParts: opts.parts } : {}),
    photoUri: opts?.photoUri,
  };
  useTripStore.getState().upsertFind(find);
  // Web: zdjęcia (data URI) siedzą w localStorage – najstarsze oddają miejsce nowym.
  if (isDataUri(find.photoUri)) {
    const trimmed = trimPhotoBudget(useTripStore.getState().finds);
    if (trimmed) useTripStore.getState().patch({ finds: trimmed });
  }
  // Wynik rozpoznania (Edge Function `identify`) przekazuje telefon – serwer go nie podpisuje (do zrobienia: identify
  // zapisuje znalezisko sama albo zwraca podpis wyniku, który sprawdzi submit_find – docs/backend.md, etap 7).
  emit({
    type: 'find.submit',
    payload: {
      findId: find.id,
      tripId: find.tripId,
      gminaId,
      speciesId: find.speciesId,
      rarity: find.rarity,
      confidence: find.confidence,
      xxl: find.xxl,
      dimensions: find.dimensions,
      candidates: id.candidates,
      parts: opts?.parts ?? [],
      foundAt: find.foundAt,
    },
  });
  // Zdjęcie do prywatnego Storage – po skanie (FIFO); bajty silnik czyta przy wysyłce, w kolejce tylko id.
  if (find.photoUri) emit({ type: 'photo.find', payload: { findId: find.id } });
  return find;
}

export function discardPendingFind(findId: string) {
  const f = useTripStore.getState().finds[findId];
  if (f && f.status === 'pending') {
    useTripStore.getState().removeFind(findId);
    deleteFindPhoto(f.photoUri);
    emit({ type: 'find.discard', payload: { findId } });
    // Zdjęcie zdążyło trafić na serwer – usuwamy je też ze Storage (kolejką, więc także po powrocie sieci).
    if (f.photoPath) emit({ type: 'photo.delete', payload: { bucket: 'scan-photos', paths: [f.photoPath] } });
  }
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
  // W trybie Supabase `trip.start` trafia do kolejki przed `find.claim` – serwer przypnie znalezisko do tej wyprawy.
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
    protectedSpecies: !find.collected && isProtectedSpecies(species),
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

  // Liczniki odznak i osiągnięć (okazy, odkrywca, pory roku, sekretne).
  const poisonous = isPoisonousEdibility(species.edibility);
  const counters = countFind(u.counters, {
    find,
    poisonous,
    gmina,
    homeGminaId: u.user.homeGminaId,
    tripFinds: (useTripStore.getState().trips[trip.id]?.findIds.length ?? 0) + 1,
  });
  const unlocked = badgesToUnlock(counters, u.badges);

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

  // Osiągnięcia z nowego stanu atlasu (XP po ekranie Nagroda).
  const unlockedAchievements = syncAchievements();

  // Zadania dnia i tygodnia (nagrody wypłacane po ekranie Nagroda).
  const weekStart = weekStartMs(new Date(find.foundAt));
  const sameSpecies = Object.values(ts.finds).filter((f) => f.status === 'claimed' && f.speciesId === find.speciesId && f.id !== find.id);
  const completedQuestIds = bumpQuests({
    type: 'find',
    rarity: find.rarity,
    speciesId: find.speciesId,
    xxl: find.xxl,
    collected: find.collected,
    edible: species.edibility === 'jadalny',
    poisonous,
    newInAtlas,
    away: !!u.user.homeGminaId && find.gminaId !== u.user.homeGminaId,
    firstOfSpeciesToday: !u.today.keys.some((k) => k.endsWith(`:${find.speciesId}`)),
    firstOfSpeciesThisWeek: !sameSpecies.some((f) => new Date(f.foundAt).getTime() >= weekStart),
  });
  // Przyjęte wyzwania gmin. Tryb Supabase (kolejka włączona): serwer zalicza wyzwanie tylko znaleziskiem z gminy
  // wyzwania – telefon tak samo.
  const inChallengeGmina = (q: Quest) =>
    !outboxEnabled() || useUserStore.getState().challenges.find((c) => `ch:${c.id}` === q.id)?.gminaId === find.gminaId;
  allQuests()
    .filter((q) => q.kind === 'challenge' && q.speciesId === find.speciesId && inChallengeGmina(q))
    .forEach((q) => {
      if (setQuestProgress(q, 1)) completedQuestIds.push(q.id);
    });
  // Ukończone zadania i wyzwania liczą się do osiągnięć „Wyzwania” – drugie sprawdzenie po zadaniach.
  if (completedQuestIds.length) unlockedAchievements.push(...syncAchievements());

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
      unlockedAchievements,
      completedQuestIds,
      personalRecord,
    },
  };
  const tsNow = useTripStore.getState();
  const tripNow = tsNow.trips[trip.id];
  tsNow.upsertFind(claimed);
  tsNow.upsertTrip({ ...tripNow, findIds: [...tripNow.findIds, claimed.id], xp: tripNow.xp + xp.total });
  if (after.levelUps.length || unlocked.length || unlockedAchievements.length) successHaptic();
  emit({ type: 'find.claim', payload: { findId } });
  return claimed;
}

/* ───────────────────────── Gminy ───────────────────────── */

/** „Obserwuj” / „Obserwujesz” – od razu w telefonie; w trybie Supabase stan docelowy idzie kolejką (`follow_gmina`). */
export function toggleFollow(gminaId: string): boolean {
  const u = useUserStore.getState();
  const on = !u.followedGminy.includes(gminaId);
  u.patch({ followedGminy: on ? [...u.followedGminy, gminaId] : u.followedGminy.filter((g) => g !== gminaId) });
  emit({ type: 'gmina.follow', payload: { gminaId, follow: on } });
  return on;
}

/**
 * „Przyjmij wyzwanie”: od razu w zadaniach dnia (ukończenie liczy claimFind lokalnie), w trybie Supabase
 * przyjęcie idzie kolejką (`accept_challenge`) – przed odbiorem znaleziska, więc serwer zaliczy je tak samo.
 */
export function acceptChallenge(gminaId: string, challenge: GminaChallenge): boolean {
  const u = useUserStore.getState();
  if (u.challenges.some((c) => c.id === challenge.id)) return false;
  u.patch({ challenges: [...u.challenges, { ...challenge, gminaId, acceptedAt: new Date().toISOString() }] });
  emit({ type: 'challenge.accept', payload: { challengeId: challenge.id, gminaId } });
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

/** Dev: dopisuje do atlasu losowe nieodkryte gatunki i od razu wypłaca osiągnięcia. */
export function devDiscoverSpecies(count: number) {
  const u = useUserStore.getState();
  const missing = catalog().species.filter((s) => !u.atlas[s.id]);
  if (!missing.length) {
    ui.toast('Atlas kompletny – wszystkie gatunki z katalogu odkryte', 'celebration');
    return;
  }
  const picked = [...missing].sort(() => Math.random() - 0.5).slice(0, count);
  const now = new Date().toISOString();
  const atlas = { ...u.atlas };
  picked.forEach((s) => (atlas[s.id] = { count: 1, firstFoundAt: now, bestCapCm: s.typical.capCm, bestWeightG: s.typical.weightG }));
  u.patch({ atlas });
  const unlocks = syncAchievements();
  ui.toast(`Odkryto: ${picked.map((s) => s.shortName).join(', ')}`, 'menu_book');
  if (unlocks.length) setTimeout(grantPendingRewards, 1300);
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
  clearFindPhotos();
  // Ustawienia gracza (prywatność) i pliki zdjęć profilowych – profil wraca do domyślnego.
  usePrefsStore.getState().reset();
  pruneAvatarFiles();
  // Ekran Gminy wraca do województwa z lokalizacji (scenariusze z makiety → podlaskie); ślad tylko w pamięci.
  useVoivodeshipStore.getState().pick(null);
  useTrackStore.getState().clear();
  // Pogoda z kratek 0,1° (przybliżone okolice gracza) – też znika.
  clearWeatherCache();
  // Celowo BEZ map offline (src/store/useOfflineMapsStore.ts) i pamięci podręcznej kafli: to nie są dane gry, a gracz
  // pobrał je świadomie (często przez Wi-Fi, przed wyjazdem) – usuwa je tylko ekran Ustawienia → Mapy offline.
}

/**
 * Nowy gracz bez postępów (Lv 1, pusty atlas, bez odznak i osiągnięć) – scenariusz „Nowy użytkownik” i stan po
 * wylogowaniu / usunięciu konta. `user` nadpisuje pola profilu (np. imię).
 */
export function freshPlayerState(user: Partial<User> = {}): Partial<Omit<UserState, 'patch' | 'reset'>> {
  const base = initialUserState();
  const next = { ...base.user, level: 1, xp: 0, streakDays: 0, tripsCount: 0, mushroomsCount: 0, ...user };
  return {
    user: next,
    atlas: {},
    badges: [],
    counters: { ...EMPTY_COUNTERS },
    achievements: {},
    pendingAchievements: [],
    // Zadania wylosowane dla tego gracza (inne id → inne losowanie niż gracz demo).
    ...questsFor(next.id, todayKey()),
    // Jeszcze ani dnia w lesie – pierwsza wyprawa zaczyna serię (jak last_active_date = null na serwerze).
    lastActiveDate: '',
    weeklyContribution: 0,
  };
}

export type Scenario = 'start' | 'newUser' | 'designActive' | 'designSummary';

/** Scenariusze z panelu /dev – m.in. odtworzenie stanów z makiety do porównań zrzutów. */
export function loadScenario(s: Scenario): string | null {
  const sim = useSimStore.getState();
  const keepPerms = sim.permissions;
  const keepSource = sim.locationSource;
  const keepCamera = sim.cameraSource;
  resetAll();
  useSimStore.getState().set({
    permissions: { ...keepPerms, location: 'granted', camera: 'granted' },
    // Stany z makiety dzieją się w Supraślu – niezależnie od prawdziwego GPS.
    locationSource: s.startsWith('design') ? 'sim' : keepSource,
    cameraSource: keepCamera,
  });
  // Stany z makiety: zadania dnia z makiety (Zeskanuj 5 · Znajdź rzadki · Przejdź 5 km), bez tygodniowych.
  if (s !== 'newUser') pinDesignQuests();
  if (s === 'start') return null;
  if (s === 'newUser') {
    // Nowy użytkownik zaczyna od onboardingu (dev-link `onboarding=0` go pomija).
    // Gmina domowa jak u nowego gracza – z pierwszego wykrycia GPS na Starcie.
    useUserStore.getState().reset({ ...freshPlayerState(), onboarded: false, homeGminaPending: true });
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
    id: uuid(),
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
    const id = uuid();
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
  const id = uuid();
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
