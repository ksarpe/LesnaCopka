/**
 * Zadania (dzienne z rotacji, tygodniowe, wyzwania gmin) i odznaki z liczników – stan w useUserStore.
 * Logika losowania i postępu jest czysta (src/utils/quests.ts, src/utils/counters.ts); tu tylko zapis w store'ach.
 * Akcje gry (src/store/game.ts) wołają te funkcje; nagrody XP wypłaca grantPendingRewards (game.ts).
 */
import { QUEST_POOL } from '@/data/mock/game';
import type { Quest, QuestProgress } from '@/types';
import { BADGE_RULES } from '@/utils/badges';
import type { PlayerCounters } from '@/utils/counters';
import { DESIGN_DAILY_QUEST_IDS, questDelta, questPeriod, selectQuests, weekStartKey, type QuestEvent } from '@/utils/quests';
import { catalog } from './useCatalogStore';
import { todayKey, useUserStore, type DailyQuestsState, type WeeklyQuestsState } from './useUserStore';

/** Pula szablonów: z katalogu (mocki / `quest_templates`), przed jego wczytaniem – z mocków. */
export function questPool(): Quest[] {
  const p = catalog().dailyQuests;
  return p.length ? p : QUEST_POOL;
}

const resolve = (ids: readonly string[] | undefined, pool: Quest[]) => {
  const byId = new Map(pool.map((q) => [q.id, q]));
  return (ids ?? []).map((id) => byId.get(id)).filter((q): q is Quest => !!q);
};

/**
 * Bieżące zadania gracza: zapisane wylosowane id, jeśli są z dziś / z tego tygodnia i istnieją w puli,
 * inaczej losowanie (src/utils/quests.ts) – np. po północy, zanim cokolwiek zapisze nowy dzień.
 */
export function currentQuests(now = new Date()): { daily: Quest[]; weekly: Quest[] } {
  const u = useUserStore.getState();
  const pool = questPool();
  const today = todayKey(now);
  const week = weekStartKey(today);
  let sel: ReturnType<typeof selectQuests> | null = null;
  const pick = () => (sel ??= selectQuests(pool, u.user.id, today));
  const daily = u.quests.date === today ? resolve(u.quests.ids, pool) : [];
  const weekly = u.weeklyQuests?.week === week ? resolve(u.weeklyQuests.ids, pool) : [];
  return {
    daily: daily.length ? daily : pick().daily,
    // Przypięte zadania z makiety (scenariusz) – bez tygodniowych, jak na zrzutach.
    weekly: weekly.length || (u.quests.pinned && u.quests.date === today) ? weekly : pick().weekly,
  };
}

/** Nowy dzień / tydzień: puste postępy i wylosowane zadania. Zwraca fragment do `patch` (pusty = bez zmian). */
export function questPeriodsPatch(now = new Date()): { quests?: DailyQuestsState; weeklyQuests?: WeeklyQuestsState } {
  const u = useUserStore.getState();
  const today = todayKey(now);
  const week = weekStartKey(today);
  const out: { quests?: DailyQuestsState; weeklyQuests?: WeeklyQuestsState } = {};
  if (u.quests.date !== today || !u.quests.ids?.length || u.weeklyQuests?.week !== week) {
    const sel = selectQuests(questPool(), u.user.id, today);
    if (u.quests.date !== today) out.quests = { date: today, progress: {}, pendingRewards: [], ids: sel.daily.map((q) => q.id) };
    else if (!u.quests.ids?.length) out.quests = { ...u.quests, ids: sel.daily.map((q) => q.id) };
    if (u.weeklyQuests?.week !== week) out.weeklyQuests = { week, ids: sel.weekly.map((q) => q.id), progress: {}, km: 0 };
  }
  return out;
}

/** Scenariusze dev-linków: zadania dnia z makiety (Zeskanuj 5 · Znajdź rzadki · Przejdź 5 km), bez tygodniowych. */
export function pinDesignQuests(now = new Date()) {
  const u = useUserStore.getState();
  const today = todayKey(now);
  u.patch({
    quests: { date: today, progress: {}, pendingRewards: [], ids: [...DESIGN_DAILY_QUEST_IDS], pinned: true },
    weeklyQuests: { week: weekStartKey(today), ids: [], progress: {}, km: 0 },
  });
}

/**
 * Postęp zadania (dziennego / tygodniowego / wyzwania `ch:…`). Ukończenie: kolejka wypłaty XP i licznik
 * wykonanych zadań (osiągnięcia „Sumienny”, „Tygodniowy rytm”, „Duma gminy”). Zwraca true, gdy właśnie ukończono.
 */
export function setQuestProgress(q: Pick<Quest, 'id' | 'target' | 'period'>, progress: number): boolean {
  const u = useUserStore.getState();
  const weekly = questPeriod(q) === 'weekly';
  const map = weekly ? u.weeklyQuests.progress : u.quests.progress;
  if (map[q.id]?.completed) return false;
  const completed = progress >= q.target;
  const next: QuestProgress = { questId: q.id, progress: Math.min(Math.round(progress * 10) / 10, q.target), completed };
  const counters = { ...u.counters };
  if (completed) {
    if (q.id.startsWith('ch:')) counters.challengesDone += 1;
    else if (weekly) counters.weeklyQuestsDone += 1;
    else counters.dailyQuestsDone += 1;
  }
  u.patch({
    ...(weekly
      ? { weeklyQuests: { ...u.weeklyQuests, progress: { ...map, [q.id]: next } } }
      : { quests: { ...u.quests, progress: { ...map, [q.id]: next } } }),
    ...(completed ? { counters } : {}),
  });
  if (completed) {
    const now = useUserStore.getState();
    now.patch({ quests: { ...now.quests, pendingRewards: [...now.quests.pendingRewards, q.id] } });
  }
  return completed;
}

const progressOf = (q: Quest) => {
  const u = useUserStore.getState();
  return (questPeriod(q) === 'weekly' ? u.weeklyQuests.progress : u.quests.progress)[q.id]?.progress ?? 0;
};

/** Zdarzenie gry → postęp bieżących zadań (dziennych i tygodniowych). Zwraca id właśnie ukończonych. */
export function bumpQuests(e: QuestEvent): string[] {
  const { daily, weekly } = currentQuests();
  const done: string[] = [];
  [...daily, ...weekly].forEach((q) => {
    const d = questDelta(q, e);
    if (d > 0 && setQuestProgress(q, progressOf(q) + d)) done.push(q.id);
  });
  return done;
}

/**
 * Dystans: zadanie dnia liczy kilometry dnia (`today.km`), tygodniowe – kilometry tygodnia (`weeklyQuests.km`).
 * Zwraca true, gdy któreś właśnie ukończono.
 */
export function bumpDistanceQuests(deltaKm: number): boolean {
  const { daily, weekly } = currentQuests();
  const u = useUserStore.getState();
  const weekKm = u.weeklyQuests.km + deltaKm;
  u.patch({ weeklyQuests: { ...u.weeklyQuests, km: weekKm } });
  let done = false;
  daily.filter((q) => q.kind === 'distance').forEach((q) => (done = setQuestProgress(q, Math.floor(useUserStore.getState().today.km * 10) / 10) || done));
  weekly.filter((q) => q.kind === 'distance').forEach((q) => (done = setQuestProgress(q, Math.floor(weekKm * 10) / 10) || done));
  return done;
}

/* ───────────────────────── Odznaki ───────────────────────── */

/** Odznaki z liczników (src/utils/badges.ts), których gracz jeszcze nie ma – te same warunki co `evaluate_badges` w SQL. */
export function badgesToUnlock(counters: PlayerCounters, owned: readonly string[]): string[] {
  return (Object.keys(BADGE_RULES) as (keyof typeof BADGE_RULES)[]).filter((id) => {
    const rule = BADGE_RULES[id];
    return !owned.includes(id) && counters[rule.counter] >= rule.target;
  });
}

/** Przyznaje odznaki wynikające z bieżących liczników; zwraca nowe (toast robi wywołujący). */
export function unlockBadges(): string[] {
  const u = useUserStore.getState();
  const unlocked = badgesToUnlock(u.counters, u.badges);
  if (unlocked.length) u.patch({ badges: [...u.badges, ...unlocked] });
  return unlocked;
}
