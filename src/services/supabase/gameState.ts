/**
 * Stan gry z serwera (`get_game_state()`) → store'y aplikacji (tryb Supabase, local-first).
 *
 * - Pierwsze powiązanie z kontem (`syncedUserId` ≠ konto) – tryb `replace`: lokalny stan (np. gracz demo
 *   z mocków) ZASTĘPUJE stan serwera (nowy gracz od zera). Zostają: avatar, bio i oczekujące skany.
 * - Kolejne – tryb `merge`: profil, atlas, odznaki, osiągnięcia, zadania, przyjęte wyzwania gmin i obserwowane
 *   gminy (etap 4; starszy serwer – zostają lokalne) z serwera; wyprawy i znaleziska
 *   scalane (ten sam id → wygrywa serwer, ale zdjęcie, publikacja w feedzie, ukrycie trasy i czas
 *   trwającej wyprawy zostają z telefonu; starsze lokalne wyprawy spoza okna serwera zostają).
 * - Etap 5 (Storage): znaleziska niosą `photoPath` (zdjęcie na serwerze – telefon bez zdjęcia pobiera je w tle,
 *   ./photos.ts), profil `avatarPath` – avatar z serwera, gdy w telefonie go nie ma (nowe urządzenie).
 * Liczniki odznak/osiągnięć: z serwera (`counters` = `player_metrics()`, cała historia gracza – progresja);
 * starszy serwer bez nich – część liczymy ze znalezisk (patrz deriveCounters), resztę zostawiamy lokalnie.
 * Zadania: wylosowane id dzienne (`quests.daily`) i tygodniowe (`quests.weekly`) z serwera – te same co losuje telefon.
 *
 * Czyste funkcje mapujące są eksportowane do testów; `applyGameState` zapisuje wynik w store'ach.
 */
import { missingGminy } from '@/geo';
import { QUEST_POOL } from '@/data/mock/game';
import { useCatalogStore } from '@/store/useCatalogStore';
import { useOutboxStore, type ProfileUpdatePayload } from '@/store/useOutboxStore';
import { useTripStore } from '@/store/useTripStore';
import { patchFromServer, todayKey, useUserStore, type AcceptedChallenge, type UserState } from '@/store/useUserStore';
import type {
  AchievementUnlock,
  AtlasEntry,
  Find,
  Gmina,
  Quest,
  QuestProgress,
  Rarity,
  Trip,
  TripStatus,
  User,
  UserAvatar,
  XpBreakdown,
} from '@/types';
import { countersFromServer, effectiveStreak, normalizeCounters, type PlayerCounters } from '@/utils/counters';
import { remotePhotoPath } from '@/utils/findPhoto';
import { firstNameOf } from '@/utils/profile';
import { selectQuests, weekStartKey } from '@/utils/quests';
import { BUCKETS, isOwnPath, publicObjectUrl } from './storagePaths';

/* ───────────────────────── Kształt odpowiedzi serwera ───────────────────────── */

export interface ServerProfile {
  handle: string;
  displayName: string;
  firstName: string | null;
  homeGminaId: string | null;
  totalXp: number;
  level: number;
  xpInLevel: number;
  streakDays: number;
  /** YYYY-MM-DD albo null (nigdy nie był aktywny). */
  lastActiveDate: string | null;
  tripsCount: number;
  mushroomsCount: number;
  totalDistanceM: number;
  /** Etap 5: zdjęcie profilowe w koszyku `avatars` (null = brak); undefined = serwer sprzed Storage. */
  avatarPath?: string | null;
  /** Motyw avatara, jeśli serwer go zwraca (undefined = nie zwraca). */
  avatarPreset?: string | null;
  /** Etap 6: zaakceptowana wersja regulaminu (null = brak akceptacji); undefined = serwer sprzed etapu 6. */
  termsVersion?: string | null;
  termsAcceptedAt?: string | null;
  /** Etap 6: koniec onboardingu (null = jeszcze nie); undefined = serwer sprzed etapu 6. */
  onboardedAt?: string | null;
}

export interface ServerAtlasEntry {
  speciesId: string;
  count: number;
  firstFoundAt: string;
  bestCapCm: number;
  bestWeightG: number;
}

export interface ServerTrip {
  id: string;
  gminaId: string;
  status: TripStatus;
  startedAt: string;
  endedAt: string | null;
  durationS: number | null;
  distanceM: number;
  xp: number;
  hideRoute: boolean;
}

export type ServerFindStatus = 'pending' | 'claimed' | 'discarded';

export interface ServerFind {
  id: string;
  tripId: string | null;
  speciesId: string;
  gminaId: string;
  rarity: Rarity;
  confidence: number;
  xxl: boolean;
  capCm: number | null;
  heightCm: number | null;
  weightG: number | null;
  ageDays: number | null;
  pieces: number | null;
  collected: boolean;
  status: ServerFindStatus;
  foundAt: string;
  xp: number;
  /** Rozpiska z `claim_find` (kształt Find.reward + `xp: {lines, total}`). */
  reward: unknown;
  /** Etap 5: zdjęcie w prywatnym koszyku `scan-photos` (null = brak); undefined = serwer sprzed Storage. */
  photoPath?: string | null;
}

/** Wyzwanie gminy przyjęte przez gracza (etap 4). */
export interface ServerChallenge {
  id: string;
  gminaId: string;
  title: string;
  speciesId: string;
  description: string;
  xp: number;
  badgeId: string | null;
  badgeName: string | null;
  acceptedAt: string;
  completedAt: string | null;
  /** Koniec wyzwania – serwer etapu 4 go nie zwraca (null); telefon zna go z ekranu gminy (get_gmina_stats). */
  endsAt: string | null;
}

export interface ServerGameState {
  userId: string;
  serverTime: string | null;
  profile: ServerProfile;
  atlas: ServerAtlasEntry[];
  badges: string[];
  /** Nagrodzone stopnie per osiągnięcie. */
  achievements: Record<string, number>;
  /**
   * Zadania: `progress` – zadania dnia z postępem; progresja: `daily` (wylosowane id, kolejność z losowania),
   * `week` (poniedziałek) i `weekly` (zadania tygodnia z postępem). null = starszy serwer (stała lista zadań dnia).
   */
  quests: { day: string | null; progress: QuestProgress[]; daily: string[] | null; week: string | null; weekly: QuestProgress[] | null };
  /** Liczniki `player_metrics()` (klucze snake_case jak enum `achievement_metric`); null = serwer sprzed progresji. */
  counters: Record<string, unknown> | null;
  trips: ServerTrip[];
  finds: ServerFind[];
  /** Przyjęte wyzwania gmin; null = serwer sprzed etapu 4 (zostają lokalne). */
  challenges: ServerChallenge[] | null;
  /** Obserwowane gminy; null = serwer sprzed etapu 4 (zostają lokalne). */
  followedGminy: string[] | null;
}

/* ───────────────────────── Parsowanie (obronne) ───────────────────────── */

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, d = 0): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : d;
};
const numOrNull = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = num(v, NaN);
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : v == null ? d : String(v));
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const strArr = (v: unknown): string[] => arr(v).filter((x): x is string => typeof x === 'string');

const TRIP_STATUSES: TripStatus[] = ['active', 'finished', 'published'];
const FIND_STATUSES: ServerFindStatus[] = ['pending', 'claimed', 'discarded'];
const RARITIES: Rarity[] = ['pospolity', 'rzadki', 'epicki', 'legendarny'];

const questProgressList = (v: unknown): QuestProgress[] =>
  arr(v)
    .filter(isObj)
    .map((q) => ({ questId: str(q.questId), progress: num(q.progress), completed: q.completed === true }))
    .filter((q) => q.questId);

/** Odpowiedź `get_game_state` / `dev_*` → typy aplikacji. Rzuca, gdy brak podstawowych pól. */
export function parseGameState(raw: unknown): ServerGameState {
  const r = typeof raw === 'string' ? (JSON.parse(raw) as unknown) : raw;
  if (!isObj(r) || !isObj(r.profile) || typeof r.userId !== 'string') {
    throw new Error('Nieprawidłowy stan gry z serwera');
  }
  const p = r.profile;
  const quests = isObj(r.quests) ? r.quests : {};
  return {
    userId: r.userId,
    serverTime: strOrNull(r.serverTime),
    profile: {
      handle: str(p.handle),
      displayName: str(p.displayName),
      firstName: strOrNull(p.firstName),
      homeGminaId: strOrNull(p.homeGminaId),
      totalXp: num(p.totalXp),
      level: Math.max(1, num(p.level, 1)),
      xpInLevel: num(p.xpInLevel),
      streakDays: num(p.streakDays),
      lastActiveDate: strOrNull(p.lastActiveDate)?.slice(0, 10) ?? null,
      tripsCount: num(p.tripsCount),
      mushroomsCount: num(p.mushroomsCount),
      totalDistanceM: num(p.totalDistanceM),
      ...('avatarPath' in p ? { avatarPath: strOrNull(p.avatarPath) } : {}),
      ...('avatarPreset' in p ? { avatarPreset: strOrNull(p.avatarPreset) } : {}),
      ...('termsVersion' in p ? { termsVersion: strOrNull(p.termsVersion), termsAcceptedAt: strOrNull(p.termsAcceptedAt) } : {}),
      ...('onboardedAt' in p ? { onboardedAt: strOrNull(p.onboardedAt) } : {}),
    },
    atlas: arr(r.atlas)
      .filter(isObj)
      .map((a) => ({
        speciesId: str(a.speciesId),
        count: num(a.count),
        firstFoundAt: str(a.firstFoundAt),
        bestCapCm: num(a.bestCapCm),
        bestWeightG: num(a.bestWeightG),
      }))
      .filter((a) => a.speciesId),
    badges: strArr(r.badges),
    achievements: Object.fromEntries(
      Object.entries(isObj(r.achievements) ? r.achievements : {})
        .map(([k, v]) => [k, num(v)] as const)
        .filter(([, v]) => v > 0),
    ),
    quests: {
      day: strOrNull(quests.day)?.slice(0, 10) ?? null,
      progress: questProgressList(quests.progress),
      daily: Array.isArray(quests.daily) ? strArr(quests.daily).filter(Boolean) : null,
      week: strOrNull(quests.week)?.slice(0, 10) ?? null,
      weekly: Array.isArray(quests.weekly) ? questProgressList(quests.weekly) : null,
    },
    counters: isObj(r.counters) ? r.counters : null,
    trips: arr(r.trips)
      .filter(isObj)
      .map((t) => ({
        id: str(t.id),
        gminaId: str(t.gminaId),
        status: TRIP_STATUSES.includes(t.status as TripStatus) ? (t.status as TripStatus) : 'finished',
        startedAt: str(t.startedAt),
        endedAt: strOrNull(t.endedAt),
        durationS: numOrNull(t.durationS),
        distanceM: num(t.distanceM),
        xp: num(t.xp),
        hideRoute: t.hideRoute === true,
      }))
      .filter((t) => t.id),
    finds: arr(r.finds)
      .filter(isObj)
      .map((f) => ({
        id: str(f.id),
        tripId: strOrNull(f.tripId),
        speciesId: str(f.speciesId),
        gminaId: str(f.gminaId),
        rarity: RARITIES.includes(f.rarity as Rarity) ? (f.rarity as Rarity) : 'pospolity',
        confidence: num(f.confidence),
        xxl: f.xxl === true,
        capCm: numOrNull(f.capCm),
        heightCm: numOrNull(f.heightCm),
        weightG: numOrNull(f.weightG),
        ageDays: numOrNull(f.ageDays),
        pieces: numOrNull(f.pieces),
        collected: f.collected !== false,
        status: FIND_STATUSES.includes(f.status as ServerFindStatus) ? (f.status as ServerFindStatus) : 'pending',
        foundAt: str(f.foundAt),
        xp: num(f.xp),
        reward: f.reward ?? null,
        ...('photoPath' in f ? { photoPath: strOrNull(f.photoPath) } : {}),
      }))
      .filter((f) => f.id),
    challenges: Array.isArray(r.challenges)
      ? r.challenges
          .filter(isObj)
          .map((c) => ({
            id: str(c.id),
            gminaId: str(c.gminaId),
            title: str(c.title),
            speciesId: str(c.speciesId),
            description: str(c.description),
            xp: num(c.xp),
            badgeId: strOrNull(c.badgeId),
            badgeName: strOrNull(c.badgeName),
            acceptedAt: str(c.acceptedAt),
            completedAt: strOrNull(c.completedAt),
            endsAt: strOrNull(c.endsAt),
          }))
          .filter((c) => c.id && c.gminaId)
      : null,
    followedGminy: Array.isArray(r.followedGminy) ? [...new Set(strArr(r.followedGminy).filter(Boolean))] : null,
  };
}

/**
 * Przyjęte wyzwania z serwera → `useUserStore.challenges` (jak lokalne przyjęcie): ukończone przed dziś znikają
 * (zadanie już rozliczone), ukończone dziś zostają z `completedAt` – zadania dnia pokazują je jako zrobione.
 * Serwer zwraca też nieukończone wyzwania z ostatnich 30 dni, które już się skończyły – termin (`endsAt`) bierzemy
 * z serwera albo z telefonu (przyjęcie z ekranu gminy) i takie pomijamy.
 */
export function mapAcceptedChallenges(
  list: ServerChallenge[],
  ctx: { today: string; now: number; local?: AcceptedChallenge[] },
): AcceptedChallenge[] {
  const localEnds = new Map((ctx.local ?? []).filter((c) => c.endsAt).map((c) => [c.id, c.endsAt!]));
  return list
    .map((c) => ({ ...c, endsAt: c.endsAt ?? localEnds.get(c.id) ?? null }))
    .filter((c) => (c.completedAt ? todayKey(new Date(c.completedAt)) === ctx.today : !c.endsAt || ms(c.endsAt) > ctx.now))
    .map((c) => {
      const out: AcceptedChallenge = {
        id: c.id,
        gminaId: c.gminaId,
        title: c.title,
        speciesId: c.speciesId,
        description: c.description,
        xp: c.xp,
        acceptedAt: c.acceptedAt,
      };
      if (c.badgeId) out.badgeId = c.badgeId;
      if (c.badgeName) out.badgeName = c.badgeName;
      if (c.completedAt) out.completedAt = c.completedAt;
      if (c.endsAt) out.endsAt = c.endsAt;
      return out;
    });
}

/* ───────────────────────── Mapowanie na typy aplikacji ───────────────────────── */

/** Rozpiska z serwera → `Find.xp` i `Find.reward` (ekran Nagroda). */
export function mapReward(raw: unknown): { xp?: XpBreakdown; reward?: NonNullable<Find['reward']> } {
  const r = typeof raw === 'string' ? (JSON.parse(raw) as unknown) : raw;
  if (!isObj(r)) return {};
  const x = r.xp;
  const xp: XpBreakdown | undefined = isObj(x)
    ? { lines: arr(x.lines).filter(isObj).map((l) => ({ label: str(l.label), xp: num(l.xp) })), total: num(x.total) }
    : undefined;
  if (r.levelBefore == null || r.levelAfter == null) return { xp };
  const unlockedAchievements: AchievementUnlock[] | undefined = Array.isArray(r.unlockedAchievements)
    ? r.unlockedAchievements.filter(isObj).map((a) => ({ id: str(a.id), tier: num(a.tier), xp: num(a.xp) }))
    : undefined;
  return {
    xp,
    reward: {
      levelBefore: num(r.levelBefore, 1),
      xpBefore: num(r.xpBefore),
      levelAfter: num(r.levelAfter, 1),
      xpAfter: num(r.xpAfter),
      unlockedBadgeIds: strArr(r.unlockedBadgeIds),
      ...(unlockedAchievements ? { unlockedAchievements } : {}),
      completedQuestIds: strArr(r.completedQuestIds),
      personalRecord: r.personalRecord === true,
    },
  };
}

/**
 * Znalezisko z serwera; zdjęcie i alternatywy z rozpoznania zostają z telefonu. `photoPath` (zdjęcie na serwerze)
 * – z serwera (starszy serwer bez pola → z telefonu); znacznik `sb-photo:` innej ścieżki niż serwerowa znika.
 */
export function mapFind(sf: ServerFind, local?: Find): Find {
  const { xp, reward } = mapReward(sf.reward);
  const claimed = sf.status === 'claimed';
  const find: Find = {
    id: sf.id,
    tripId: sf.tripId,
    speciesId: sf.speciesId,
    gminaId: sf.gminaId,
    rarity: sf.rarity,
    confidence: sf.confidence,
    xxl: sf.xxl,
    dimensions: {
      capCm: sf.capCm ?? 0,
      heightCm: sf.heightCm ?? 0,
      weightG: sf.weightG ?? 0,
      ageDays: sf.ageDays ?? 0,
      ...(sf.pieces ? { pieces: sf.pieces } : {}),
    },
    collected: sf.collected,
    status: claimed ? 'claimed' : 'pending',
    foundAt: sf.foundAt,
  };
  if (local?.candidates) find.candidates = local.candidates;
  const photoPath = sf.photoPath === undefined ? local?.photoPath : (sf.photoPath ?? undefined);
  if (photoPath) find.photoPath = photoPath;
  const marker = remotePhotoPath(local?.photoUri);
  if (local?.photoUri && (!marker || marker === photoPath)) find.photoUri = local.photoUri;
  if (claimed) {
    find.xp = xp ?? (sf.xp ? { lines: [{ label: 'XP za znalezisko', xp: sf.xp }], total: sf.xp } : local?.xp);
    const rw = reward ?? local?.reward;
    if (rw) find.reward = rw;
  }
  return find;
}

const STATUS_RANK: Record<TripStatus, number> = { active: 0, finished: 1, published: 2 };
const ms = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : NaN);

/**
 * Wyprawa z serwera. Telefon zostaje przy swoim, gdy jest „dalej” (zakończył wyprawę, której koniec
 * serwer odrzucił; opublikował ją w feedzie, a `trip.publish` jeszcze czeka w kolejce), a przy trwającej wyprawie trzyma
 * czas (odcinki, przyspieszenie z panelu dev) i dystans, jeśli lokalny jest większy.
 * XP wyprawy: większa z wartości – aplikacja dolicza do wyprawy XP zadań dnia i osiągnięć, a serwer
 * (`trips.xp`) tylko XP znalezisk; inaczej podsumowanie „chudłoby” po synchronizacji.
 */
export function mapTrip(st: ServerTrip, findIds: string[], local: Trip | undefined, now = Date.now()): Trip {
  const localAhead = !!local && STATUS_RANK[local.status] > STATUS_RANK[st.status];
  if (local && localAhead) return { ...local, findIds };
  const status = st.status;
  const base: Trip = {
    id: st.id,
    gminaId: st.gminaId,
    status,
    startedAt: st.startedAt,
    elapsedMs: 0,
    segmentStartedAt: now,
    distanceKm: st.distanceM / 1000,
    findIds,
    xp: Math.max(st.xp, local?.xp ?? 0),
    // Ukrycie trasy ustawia się w Podsumowaniu, a publikacja idzie kolejką (`trip.publish`) – do jej wysłania serwer o nich nie wie.
    hideRoute: local ? local.hideRoute : st.hideRoute,
  };
  if (st.endedAt) base.endedAt = st.endedAt;
  if (local?.postId) base.postId = local.postId;
  if (status === 'active') {
    if (local?.status === 'active') {
      base.elapsedMs = local.elapsedMs;
      base.segmentStartedAt = local.segmentStartedAt;
      base.distanceKm = Math.max(local.distanceKm, base.distanceKm);
    } else {
      // Czas liczy się od startu z serwera (np. wyprawa zaczęta na innym telefonie).
      const started = ms(st.startedAt);
      base.segmentStartedAt = Number.isFinite(started) ? Math.min(started, now) : now;
    }
    return base;
  }
  const span = ms(st.endedAt) - ms(st.startedAt);
  base.elapsedMs = st.durationS != null ? st.durationS * 1000 : Number.isFinite(span) ? Math.max(0, span) : (local?.elapsedMs ?? 0);
  return base;
}

export type MergeMode = 'replace' | 'merge';

export interface TripsSnapshot {
  trips: Record<string, Trip>;
  finds: Record<string, Find>;
  activeTripId: string | null;
}

const byFoundAt = (a: Find, b: Find) => ms(a.foundAt) - ms(b.foundAt);
/** Najstarszy znacznik czasu; pusta lista = serwer nie ma nic, więc nic lokalnego nie jest „starsze od okna”. */
const oldest = (isos: string[]) => {
  const t = isos.map(ms).filter(Number.isFinite);
  return t.length ? Math.min(...t) : -Infinity;
};

/**
 * Wyprawy i znaleziska: serwer + to, co telefon ma zachować.
 * - ten sam id → wersja z serwera (mapTrip / mapFind); odrzucone na serwerze znaleziska znikają;
 * - `merge`: lokalne wyprawy starsze niż najstarsza z serwera (poza jego oknem) zostają z całymi znaleziskami,
 *   a znaleziska starsze niż najstarsze z serwera – jeśli ich wyprawa została;
 * - oczekujące skany, o których serwer nie wie (ekran Analiza), zostają w obu trybach;
 * - reszta lokalnych (nigdy nie dotarły na serwer, scenariusze z panelu dev, gracz demo) – znika.
 */
export function mergeTripsAndFinds(local: TripsSnapshot, state: ServerGameState, mode: MergeMode, now = Date.now()): TripsSnapshot {
  const serverFindIds = new Set(state.finds.map((f) => f.id));
  const finds: Record<string, Find> = {};
  state.finds.filter((f) => f.status !== 'discarded').forEach((sf) => (finds[sf.id] = mapFind(sf, local.finds[sf.id])));

  const serverTripIds = new Set(state.trips.map((t) => t.id));
  const oldestTrip = oldest(state.trips.map((t) => t.startedAt));
  const oldestFind = oldest(state.finds.map((f) => f.foundAt));
  const keptTrips: Record<string, Trip> = {};
  if (mode === 'merge') {
    Object.values(local.trips).forEach((t) => {
      if (!serverTripIds.has(t.id) && ms(t.startedAt) < oldestTrip) keptTrips[t.id] = t;
    });
  }

  Object.values(local.finds).forEach((f) => {
    if (serverFindIds.has(f.id)) return;
    const keepOld = mode === 'merge' && f.status === 'claimed' && ms(f.foundAt) < oldestFind;
    if (f.status === 'pending' || (f.tripId && keptTrips[f.tripId]) || keepOld) finds[f.id] = f;
  });

  const claimedByTrip = new Map<string, string[]>();
  Object.values(finds)
    .filter((f) => f.status === 'claimed')
    .sort(byFoundAt)
    .forEach((f) => {
      if (f.tripId) claimedByTrip.set(f.tripId, [...(claimedByTrip.get(f.tripId) ?? []), f.id]);
    });

  const trips: Record<string, Trip> = {};
  state.trips.forEach((st) => (trips[st.id] = mapTrip(st, claimedByTrip.get(st.id) ?? [], local.trips[st.id], now)));
  // Zachowane lokalne wyprawy: lista znalezisk tylko z tych, które zostały.
  Object.values(keptTrips).forEach((t) => (trips[t.id] = { ...t, findIds: claimedByTrip.get(t.id) ?? [] }));

  const active = Object.values(trips)
    .filter((t) => t.status === 'active')
    .sort((a, b) => ms(b.startedAt) - ms(a.startedAt))[0];
  return { trips, finds, activeTripId: active?.id ?? null };
}

/** Seria dni do pokazania (reguła wspólna z telefonem – src/utils/counters.ts). */
export { effectiveStreak };

export interface DerivedCounters {
  borowikiKnyszynska: number;
  legendaryFinds: number;
  xxlFinds: number;
}

/**
 * Liczniki odznak / osiągnięć, których serwer nie zwraca wprost – ze znalezisk (odebranych), tak jak liczy
 * je claimFind. Serwer zwraca okno ostatnich znalezisk, więc przy długiej historii to dolne oszacowanie
 * (tryb `merge` bierze większą z wartości lokalnej i policzonej). Odznaki i nagrodzone stopnie i tak
 * przychodzą z serwera – liczniki służą tylko do paska postępu w aplikacji.
 */
export function deriveCounters(finds: Find[], gminaById: Record<string, Gmina>): DerivedCounters {
  const claimed = finds.filter((f) => f.status === 'claimed');
  return {
    borowikiKnyszynska: claimed.filter(
      (f) => f.collected && f.speciesId === 'borowik-szlachetny' && gminaById[f.gminaId]?.forest === 'Puszcza Knyszyńska',
    ).length,
    legendaryFinds: claimed.filter((f) => f.rarity === 'legendarny').length,
    xxlFinds: claimed.filter((f) => f.xxl && f.collected).length,
  };
}

/**
 * Liczniki po synchronizacji. Serwer z progresją (`counters`): jego liczby (cała historia; pola tylko-w-telefonie –
 * bieżąca seria gatunku – zostają). Starszy serwer: dystans i seria z profilu, część ze znalezisk (deriveCounters –
 * `merge` bierze większą z wartości), reszta lokalna (`merge`) albo od zera (`replace` – inne konto).
 */
export function buildCounters(state: ServerGameState, local: UserData, merge: boolean, ctx: UserMergeContext): PlayerCounters {
  const today = todayKey(new Date(ctx.now));
  const yesterday = todayKey(new Date(ctx.now - 86400000));
  const streak = effectiveStreak(state.profile.streakDays, state.profile.lastActiveDate, today, yesterday);
  const base = merge ? normalizeCounters(local.counters) : normalizeCounters(undefined);
  if (state.counters) return { ...countersFromServer(state.counters, base), streakDays: streak };
  const derived = deriveCounters(ctx.finds, ctx.gminaById);
  const keep = (k: keyof DerivedCounters) => (merge ? Math.max(base[k], derived[k]) : derived[k]);
  return {
    ...base,
    borowikiKnyszynska: keep('borowikiKnyszynska'),
    totalKm: state.profile.totalDistanceM / 1000,
    streakDays: streak,
    legendaryFinds: keep('legendaryFinds'),
    xxlFinds: keep('xxlFinds'),
    trips: merge ? Math.max(base.trips, state.profile.tripsCount) : state.profile.tripsCount,
  };
}

/** Początek bieżącego tygodnia (poniedziałek 00:00, czas lokalny). */
function weekStart(now: number) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

export type UserData = Omit<UserState, 'patch' | 'reset'>;

export interface UserMergeContext {
  now: number;
  gminaById: Record<string, Gmina>;
  /** Id zadania „Przejdź 5 km” (dystans dnia liczy addDistance) – gdy nie wynika z puli i wylosowanych zadań. */
  distanceQuestId?: string;
  /** Pula zadań (katalog); brak – z mocków (= seed bazy). */
  questPool?: Quest[];
  /** Znaleziska po scaleniu (mergeTripsAndFinds). */
  finds: Find[];
  trips: Trip[];
}

/** Avatar zapisany na serwerze: zdjęcie (publiczny adres z `avatars`) albo motyw; brak → undefined. */
export function serverAvatar(p: Pick<ServerProfile, 'avatarPath' | 'avatarPreset'>): UserAvatar | undefined {
  if (p.avatarPath) return { kind: 'photo', uri: publicObjectUrl(BUCKETS.avatars, p.avatarPath), path: p.avatarPath };
  if (p.avatarPreset) return { kind: 'preset', id: p.avatarPreset };
  return undefined;
}

/**
 * Avatar po synchronizacji. Zostaje lokalny (jak dotąd), z dwoma wyjątkami (serwer z etapu 5, `avatarPath` w profilu):
 * - w telefonie nie ma avatara (nowe urządzenie, reinstalacja) → avatar z serwera;
 * - lokalne zdjęcie było już na serwerze tego konta (`path`), a serwer ma inne (zmiana na innym urządzeniu) → z serwera.
 * Zdjęcie bez `path` (jeszcze niewysłane) albo z innego konta zostaje – wyśle je zdarzenie `photo.avatar`.
 */
export function mergeAvatar(local: UserAvatar | undefined, p: ServerProfile, userId: string): UserAvatar | undefined {
  if (p.avatarPath === undefined) return local;
  if (!local) return serverAvatar(p);
  if (local.kind === 'photo' && local.path && isOwnPath(userId, local.path) && local.path !== p.avatarPath) return serverAvatar(p);
  return local;
}

/**
 * Stan gracza z serwera; avatar (poza wyjątkami z mergeAvatar) i bio zostają lokalne. Obserwowane gminy i przyjęte
 * wyzwania – z serwera (etap 4), a gdy serwer ich nie zwraca (starsza baza) – lokalne.
 */
export function buildUserState(state: ServerGameState, local: UserData, mode: MergeMode, ctx: UserMergeContext): Partial<UserData> {
  const today = todayKey(new Date(ctx.now));
  const yesterday = todayKey(new Date(ctx.now - 86400000));
  const p = state.profile;
  const streak = effectiveStreak(p.streakDays, p.lastActiveDate, today, yesterday);
  const merge = mode === 'merge';

  const user: User = {
    ...local.user,
    id: state.userId,
    name: p.displayName || local.user.name,
    firstName: p.firstName?.trim() || firstNameOf(p.displayName) || local.user.firstName,
    handle: p.handle ? `@${p.handle}` : local.user.handle,
    level: p.level,
    xp: p.xpInLevel,
    streakDays: streak,
    tripsCount: p.tripsCount,
    mushroomsCount: p.mushroomsCount,
    homeGminaId: p.homeGminaId ?? local.user.homeGminaId,
  };
  const avatar = mergeAvatar(local.user.avatar, p, state.userId);
  if (avatar) user.avatar = avatar;
  else delete user.avatar;

  const atlas: Record<string, AtlasEntry> = {};
  state.atlas.forEach((a) => {
    atlas[a.speciesId] = { count: a.count, firstFoundAt: a.firstFoundAt, bestCapCm: a.bestCapCm, bestWeightG: a.bestWeightG };
  });

  // Zadania dnia z serwera. Wyzwania gmin (`ch:…`): serwer z etapu 4 – przyjęte i ukończone dziś z serwera;
  // starszy serwer (bez `challenges`) – postęp zostaje lokalny. Przypięte zadania z makiety (scenariusz dev) – lokalne.
  const localToday = local.quests.date === today;
  const pinned = !!local.quests.pinned && localToday;
  const progress: Record<string, QuestProgress> = {};
  if (pinned) Object.assign(progress, local.quests.progress);
  else if (state.quests.day === today) state.quests.progress.forEach((q) => (progress[q.questId] = q));
  else if (merge && localToday) Object.assign(progress, local.quests.progress);
  Object.keys(progress)
    .filter((id) => id.startsWith('ch:'))
    .forEach((id) => delete progress[id]);
  const challenges = state.challenges ? mapAcceptedChallenges(state.challenges, { today, now: ctx.now, local: local.challenges }) : null;
  if (challenges) {
    challenges
      .filter((c) => c.completedAt)
      .forEach((c) => (progress[`ch:${c.id}`] = { questId: `ch:${c.id}`, progress: 1, completed: true }));
  } else if (localToday) {
    Object.values(local.quests.progress)
      .filter((q) => q.questId.startsWith('ch:'))
      .forEach((q) => (progress[q.questId] = q));
  }

  // Wylosowane zadania: z serwera (progresja), starszy serwer – jego stała lista zadań dnia; inaczej losowanie lokalne.
  const pool = ctx.questPool?.length ? ctx.questPool : QUEST_POOL;
  const fresh = selectQuests(pool, state.userId, today);
  const serverToday = state.quests.day === today;
  const dailyIds = pinned
    ? (local.quests.ids ?? [])
    : serverToday && state.quests.daily
      ? state.quests.daily
      : serverToday && state.quests.progress.some((q) => !q.questId.startsWith('ch:'))
        ? state.quests.progress.map((q) => q.questId).filter((id) => !id.startsWith('ch:'))
        : merge && localToday && local.quests.ids?.length
          ? local.quests.ids
          : fresh.daily.map((q) => q.id);
  const week = weekStartKey(today);
  const localWeek = local.weeklyQuests?.week === week ? local.weeklyQuests : null;
  let weeklyQuests: UserData['weeklyQuests'];
  if (pinned && localWeek) weeklyQuests = localWeek;
  else if (state.quests.weekly && state.quests.week === week) {
    const wp: Record<string, QuestProgress> = {};
    state.quests.weekly.forEach((q) => (wp[q.questId] = q));
    const kmQuest = state.quests.weekly.find((q) => pool.find((x) => x.id === q.questId)?.kind === 'distance');
    weeklyQuests = {
      week,
      ids: state.quests.weekly.map((q) => q.questId),
      progress: wp,
      km: Math.max(merge && localWeek ? localWeek.km : 0, kmQuest?.progress ?? 0),
    };
  } else if (merge && localWeek) weeklyQuests = localWeek;
  else weeklyQuests = { week, ids: fresh.weekly.map((q) => q.id), progress: {}, km: 0 };

  const counters = buildCounters(state, local, merge, ctx);

  // „Pierwszy w gminie dziś”: pary gmina:gatunek z dzisiejszych odebranych znalezisk.
  const keys = new Set(merge && local.today.date === today ? local.today.keys : []);
  ctx.finds
    .filter((f) => f.status === 'claimed' && todayKey(new Date(f.foundAt)) === today)
    .forEach((f) => keys.add(`${f.gminaId}:${f.speciesId}`));
  const distanceId = dailyIds.find((id) => pool.find((q) => q.id === id)?.kind === 'distance') ?? ctx.distanceQuestId;
  const questKm = distanceId ? (progress[distanceId]?.progress ?? 0) : 0;
  const localKm = merge && local.today.date === today ? local.today.km : 0;

  const out: Partial<UserData> = {
    user,
    atlas,
    badges: [...state.badges],
    achievements: { ...state.achievements },
    pendingAchievements: [],
    quests: { date: today, progress, pendingRewards: [], ids: [...dailyIds], ...(pinned ? { pinned: true } : {}) },
    weeklyQuests,
    counters,
    today: { date: today, keys: [...keys], km: Math.max(localKm, questKm) },
    lastActiveDate: p.lastActiveDate ?? '',
  };
  // Etap 4: wyzwania i obserwowane gminy – serwer wygrywa (zdarzenia z kolejki już do niego doszły).
  if (challenges) out.challenges = challenges;
  if (state.followedGminy) out.followedGminy = [...state.followedGminy];
  // Etap 6: onboarding i regulamin. Nowe powiązanie (`replace` – inne konto) – jak na serwerze; kolejne – onboarding
  // zakończony na innym telefonie też się liczy, a lokalnego nie cofamy. Serwer sprzed etapu 6 – zostają lokalne.
  const onboarding = onboardingFromServer(p, { onboarded: local.onboarded, terms: local.terms }, mode);
  out.onboarded = onboarding.onboarded;
  if ('terms' in onboarding) out.terms = onboarding.terms;
  // Gmina domowa z serwera (wybrana na innym telefonie / wcześniej) – nie podmieniamy jej wykryciem GPS (adoptHomeGmina).
  if (p.homeGminaId && local.homeGminaPending) out.homeGminaPending = false;
  if (!merge) {
    // Wkład w punkty gminy (mock rankingu): XP wypraw z bieżącego tygodnia.
    const from = weekStart(ctx.now);
    out.weeklyContribution = ctx.trips.filter((t) => ms(t.startedAt) >= from).reduce((s, t) => s + t.xp, 0);
  }
  return out;
}

/**
 * Onboarding i regulamin po synchronizacji. `replace` (pierwsze powiązanie z kontem: nowe konto, logowanie na inne):
 * stan konta z serwera – `onboardedAt = null` → onboarding od nowa. `merge`: zakończony gdziekolwiek = zakończony.
 * Pole nieobecne (serwer sprzed etapu 6) – zostaje stan lokalny. Klucz `terms` w wyniku = do zapisania (także undefined).
 */
export function onboardingFromServer(
  p: Pick<ServerProfile, 'onboardedAt' | 'termsVersion' | 'termsAcceptedAt'>,
  local: Pick<UserData, 'onboarded' | 'terms'>,
  mode: MergeMode,
): { onboarded: boolean; terms?: UserData['terms'] } {
  const replace = mode === 'replace';
  const onboarded = p.onboardedAt === undefined ? local.onboarded : replace ? !!p.onboardedAt : local.onboarded || !!p.onboardedAt;
  if (p.termsVersion === undefined) return { onboarded };
  if (p.termsVersion) return { onboarded, terms: { version: p.termsVersion, acceptedAt: p.termsAcceptedAt ?? local.terms?.acceptedAt ?? '' } };
  return replace ? { onboarded, terms: undefined } : { onboarded };
}

/* ───────────────────────── Dane do serwera ───────────────────────── */

/** Profil do `profiles` (nick bez „@”). Motyw avatara widzą inni; zdjęcie idzie osobno (`photo.avatar` → Storage). */
export function profilePayload(user: User): ProfileUpdatePayload {
  return {
    displayName: user.name,
    firstName: user.firstName,
    handle: user.handle.replace(/^@+/, ''),
    homeGminaId: user.homeGminaId,
    avatarPreset: user.avatar?.kind === 'preset' ? user.avatar.id : null,
  };
}

/** `dev_import_state`: gracz (np. demo „Kuba, Lv 14” z mocków) – profil, atlas, odznaki. */
export function buildImportState(u: Pick<UserData, 'user' | 'atlas' | 'badges'>) {
  const { displayName, firstName, handle, homeGminaId } = profilePayload(u.user);
  return {
    profile: {
      displayName,
      firstName,
      handle,
      homeGminaId,
      level: u.user.level,
      xpInLevel: u.user.xp,
      streakDays: u.user.streakDays,
      tripsCount: u.user.tripsCount,
      mushroomsCount: u.user.mushroomsCount,
    },
    atlas: Object.entries(u.atlas).map(([speciesId, e]) => ({
      speciesId,
      count: e.count,
      firstFoundAt: e.firstFoundAt,
      bestCapCm: e.bestCapCm,
      bestWeightG: e.bestWeightG,
    })),
    badges: [...u.badges],
  };
}

/* ───────────────────────── Zapis w store'ach ───────────────────────── */

export type HydrateMode = 'auto' | MergeMode;

/** Zdjęcia profilowe (URI), które raz w tej sesji próbowaliśmy dosłać na serwer – bez pętli przy trwałym błędzie. */
const avatarBackfill = new Set<string>();

/**
 * Zdjęcie profilowe, którego serwer nie ma (sprzed Storage, z innego konta, po odrzuconej wysyłce), a serwer nie ma
 * żadnego – raz na sesję do kolejki (`photo.avatar`). Cudzego zdjęcia z serwera nie nadpisujemy.
 */
export function needsAvatarBackfill(avatar: UserAvatar | undefined, serverPath: string | null | undefined, userId: string): boolean {
  return serverPath === null && avatar?.kind === 'photo' && !(avatar.path && isOwnPath(userId, avatar.path));
}

/**
 * Przyjmuje stan z serwera. `auto` = `replace` przy pierwszym powiązaniu z kontem, potem `merge`.
 * Warunki (pusta kolejka, brak ekranu Nagroda) sprawdza wywołujący (sync.ts). Zwraca użyty tryb.
 */
export function applyGameState(state: ServerGameState, mode: HydrateMode = 'auto', now = Date.now()): MergeMode {
  const ob = useOutboxStore.getState();
  const m: MergeMode = mode === 'auto' ? (ob.syncedUserId === state.userId ? 'merge' : 'replace') : mode;
  const ts = useTripStore.getState();
  const merged = mergeTripsAndFinds({ trips: ts.trips, finds: ts.finds, activeTripId: ts.activeTripId }, state, m, now);
  ts.patch(merged);

  const cat = useCatalogStore.getState();
  const u = useUserStore.getState();
  // Zmiana z serwera (np. obserwowane gminy z innego telefonu) – bez powiadomień „Obserwujesz gminę…”.
  patchFromServer(
    buildUserState(state, u, m, {
      now,
      gminaById: cat.gminaById,
      questPool: cat.dailyQuests,
      finds: Object.values(merged.finds),
      trips: Object.values(merged.trips),
    }),
  );
  ob.patch({ syncedUserId: state.userId, lastHydrateAt: new Date(now).toISOString() });

  const avatar = useUserStore.getState().user.avatar;
  if (needsAvatarBackfill(avatar, state.profile.avatarPath, state.userId) && avatar?.kind === 'photo' && !avatarBackfill.has(avatar.uri)) {
    avatarBackfill.add(avatar.uri);
    useOutboxStore.getState().enqueue({ type: 'photo.avatar', payload: { photo: true, ts: now } });
  }

  // Gminy spoza danych gry (wyprawy z GPS, gmina domowa, obserwowane) – nazwy z indeksu PRG, jak w app/_layout.tsx.
  const ids = [
    useUserStore.getState().user.homeGminaId,
    ...useUserStore.getState().followedGminy,
    ...Object.values(merged.trips).map((t) => t.gminaId),
    ...Object.values(merged.finds).map((f) => f.gminaId),
  ];
  missingGminy(ids, cat.gminaById)
    .then((list) => list.forEach((g) => useCatalogStore.getState().upsertGmina(g)))
    .catch(() => {});
  return m;
}
