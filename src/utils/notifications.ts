/**
 * Powiadomienia – czyste funkcje: kategorie, plan przypomnień, cykle tygodniowe,
 * grupowanie centrum powiadomień i deterministyczne reakcje znajomych (mock).
 * Testy: src/utils/__tests__/notifications.test.ts.
 */
import type { IconName } from '@/components/Icon';
import type { PostAuthor } from '@/types';
import { plural } from './format';
import { hashString } from './random';

export type NotifCategory = 'streak' | 'visible' | 'social' | 'gminy' | 'weekly' | 'longTrip';
/** 'system' = wpisy techniczne (test, powitanie) – nie podlegają przełącznikom kategorii. */
export type NotifKind = NotifCategory | 'system';

export interface NotifCategoryDef {
  id: NotifCategory;
  label: string;
  description: string;
  icon: IconName;
}

export const NOTIF_CATEGORIES: NotifCategoryDef[] = [
  {
    id: 'streak',
    label: 'Przypomnienie o serii',
    description: 'Codziennie o wybranej godzinie – tylko gdy nie było Cię jeszcze w lesie.',
    icon: 'local_fire_department',
  },
  {
    id: 'visible',
    label: 'Wpis widoczny dla innych',
    description: 'Gdy po 24 h znajomi zobaczą Twoją opublikowaną wyprawę.',
    icon: 'visibility',
  },
  {
    id: 'social',
    label: 'Reakcje i komentarze znajomych',
    description: '„Darz grzyb!” i komentarze pod Twoimi wpisami.',
    icon: 'favorite',
  },
  {
    id: 'gminy',
    label: 'Wyzwania w obserwowanych gminach',
    description: 'Nowe wyzwania tygodnia w gminach, które obserwujesz.',
    icon: 'flag',
  },
  {
    id: 'weekly',
    label: 'Podsumowanie tygodnia',
    description: 'W niedzielę o 19:00 – miejsce Twojej gminy w rankingu.',
    icon: 'emoji_events',
  },
  {
    id: 'longTrip',
    label: 'Długa wyprawa',
    description: 'Gdy wyprawa trwa ponad 3 h – żeby nie zapomnieć jej zakończyć.',
    icon: 'hiking',
  },
];

export const NOTIF_CATEGORY_BY_ID = Object.fromEntries(NOTIF_CATEGORIES.map((c) => [c.id, c])) as Record<
  NotifCategory,
  NotifCategoryDef
>;

export const DEFAULT_NOTIF_PREFS: Record<NotifCategory, boolean> = {
  streak: true,
  visible: true,
  social: true,
  gminy: true,
  weekly: true,
  longTrip: true,
};

/** Szybki wybór godziny przypomnienia. */
export const REMINDER_HOURS = [8, 12, 16, 18, 20] as const;
export const DEFAULT_REMINDER_HOUR = 18;

/** Podsumowanie tygodnia: niedziela 19:00 (getDay: 0 = niedziela). */
export const WEEKLY_SUMMARY = { weekday: 0, hour: 19 } as const;
/** Nowe wyzwania w obserwowanych gminach: poniedziałek 9:00. */
export const GMINY_CHALLENGES = { weekday: 1, hour: 9 } as const;
/** Po tylu godzinach wyprawy pytamy „Wciąż w lesie?”. */
export const LONG_TRIP_MS = 3 * 3600 * 1000;

/** Element zaplanowany: wpis w centrum (gdy nadejdzie `dueAt`) i opcjonalnie powiadomienie systemowe. */
export interface PlannedNotification {
  /** Stabilny klucz = identyfikator powiadomienia systemowego (bez prefiksu „grzyb.”). */
  key: string;
  kind: NotifKind;
  title: string;
  body: string;
  icon: IconName;
  href?: string;
  dueAt: number;
}

/** „18:00” */
export function fmtHour(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

/** Klucz dnia „2026-10-06” (lokalnie). */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Dzień `base` przesunięty o `dayOffset` dni, o pełnej godzinie `hour` (czas lokalny). */
export function atHour(base: Date, dayOffset: number, hour: number): Date {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + dayOffset, hour, 0, 0, 0);
}

/** Ostatnie (≤ now) wystąpienie dnia tygodnia `weekday` (0 = niedziela) o godzinie `hour`. */
export function lastWeeklyOccurrence(now: Date, weekday: number, hour: number): Date {
  const back = (now.getDay() - weekday + 7) % 7;
  const d = atHour(now, -back, hour);
  return d.getTime() > now.getTime() ? atHour(now, -back - 7, hour) : d;
}

export interface StreakPlanInput {
  now: Date;
  hour: number;
  /** Wyprawa albo skan dziś (albo trwająca wyprawa). */
  activeToday: boolean;
  /** Ostatni aktywny dzień („2026-10-05”). */
  lastActiveDate: string;
  streakDays: number;
  /** Na ile dni do przodu planujemy jednorazowe przypomnienia. */
  days?: number;
}

const STREAK_GENERIC = [
  { title: 'Las czeka na Ciebie', body: 'Krótka wyprawa wystarczy – zadania dnia czekają na odbiór.' },
  { title: 'Grzyby same się nie znajdą', body: 'Rozpocznij wyprawę i zbierz XP za dzisiejsze zadania.' },
  { title: 'Dawno nie było Cię w lesie', body: 'Twoja gmina walczy o miejsce w rankingu – dorzuć swoje punkty.' },
];

/**
 * Przypomnienia o serii jako jednorazowe powiadomienia na `days` kolejnych dni o godzinie `hour`.
 * Dziś – tylko jeśli nie było jeszcze aktywności i godzina nie minęła. Po aktywności plan liczymy
 * od nowa (bez dzisiejszego), więc przypomnienie nie przychodzi w dniu wyprawy.
 */
export function streakReminderPlan({ now, hour, activeToday, lastActiveDate, streakDays, days = 7 }: StreakPlanInput): PlannedNotification[] {
  const out: PlannedNotification[] = [];
  const yesterday = dayKey(atHour(now, -1, 12));
  for (let d = 0; d < days + 1 && out.length < days; d++) {
    const at = atHour(now, d, hour);
    if (d === 0 && (activeToday || at.getTime() <= now.getTime())) continue;
    // Seria jest „żywa” w dniu przypomnienia: dziś (aktywność wczoraj) albo jutro (aktywność dziś).
    const alive = streakDays >= 2 && ((d === 0 && lastActiveDate === yesterday) || (d === 1 && activeToday));
    const generic = STREAK_GENERIC[d % STREAK_GENERIC.length];
    out.push({
      key: `streak.${dayKey(at)}`,
      kind: 'streak',
      title: alive ? `Nie przerwij serii ${streakDays} dni!` : generic.title,
      body: alive ? 'Wystarczy krótka wyprawa albo jeden skan przed północą.' : generic.body,
      icon: 'local_fire_department',
      href: '/',
      dueAt: at.getTime(),
    });
  }
  return out;
}

/** Wyprawa trwa ponad 3 h – „Wciąż w lesie?”. */
export function longTripNotification(tripId: string, dueAt: number): PlannedNotification {
  return {
    key: `longTrip.${tripId}`,
    kind: 'longTrip',
    title: 'Wciąż w lesie?',
    body: 'Wyprawa trwa już ponad 3 godziny. Zakończ ją, żeby zapisać wynik – albo zbieraj dalej.',
    icon: 'hiking',
    href: '/',
    dueAt,
  };
}

/** Wpis widoczny dla innych (po opóźnieniu prywatności); `detail` np. „z gminy Supraśl (6,4 km, 9 grzybów)”. */
export function visibleNotification(postId: string, detail: string, visibleFrom: number): PlannedNotification {
  return {
    key: `visible.${postId}`,
    kind: 'visible',
    title: 'Twoja wyprawa jest już widoczna',
    body: `Znajomi widzą już Twoją wyprawę${detail ? ` ${detail}` : ''} – bez dokładnej lokalizacji.`,
    icon: 'visibility',
    href: '/feed',
    dueAt: visibleFrom,
  };
}

const COMMENTS = [
  'Piękne okazy! Gdzie takie rosną?',
  'Ale koszyk! Darz grzyb!',
  'Zazdroszczę – u nas w lesie sucho.',
  'Następnym razem idę z Tobą!',
  'Widzę, że las dopisał!',
];

/**
 * Symulowane reakcje znajomych po publikacji – deterministyczne dla danego wpisu.
 * Przychodzą dopiero, gdy wpis widzą inni (`visibleFrom`), w odstępach kilku minut–godzin.
 */
export function mockSocialNotifications(postId: string, visibleFrom: number, friends: PostAuthor[]): PlannedNotification[] {
  if (friends.length < 3) return [];
  const h = hashString(postId);
  // Trzy różne osoby: kolejne od pozycji wyznaczonej przez hash wpisu.
  const pick = (i: number) => friends[(h + i) % friends.length];
  const [a, b, c] = [pick(0), pick(1), pick(2)];
  const others = 2 + (h % 5);
  const min = 60000;
  return [
    {
      key: `social.${postId}.1`,
      kind: 'social',
      title: `${a.name}: Darz grzyb!`,
      body: 'Pierwsza reakcja na Twoją wyprawę – wpis właśnie pojawił się u znajomych.',
      icon: 'favorite',
      href: '/feed',
      dueAt: visibleFrom + 4 * min,
    },
    {
      key: `social.${postId}.2`,
      kind: 'social',
      title: `Nowy komentarz od ${b.name}`,
      body: `„${COMMENTS[h % COMMENTS.length]}”`,
      icon: 'chat_bubble',
      href: '/feed',
      dueAt: visibleFrom + 35 * min,
    },
    {
      key: `social.${postId}.3`,
      kind: 'social',
      title: `${c.name} i ${others} ${plural(others, 'inna osoba', 'inne osoby', 'innych osób')} reagują na Twój wpis`,
      body: `Twoja wyprawa ma już ${others + 2} ${plural(others + 2, 'reakcję', 'reakcje', 'reakcji')} „Darz grzyb!”.`,
      icon: 'thumb_up',
      href: '/feed',
      dueAt: visibleFrom + 120 * min,
    },
  ];
}

/** Grupy centrum powiadomień: „Dzisiaj” i „Wcześniej” (kolejność od najnowszych). */
export function groupByDay<T extends { createdAt: string }>(items: T[], now = new Date()): { today: T[]; earlier: T[] } {
  const today = dayKey(now);
  const sorted = [...items].sort((x, y) => y.createdAt.localeCompare(x.createdAt));
  return {
    today: sorted.filter((i) => dayKey(new Date(i.createdAt)) === today),
    earlier: sorted.filter((i) => dayKey(new Date(i.createdAt)) !== today),
  };
}
