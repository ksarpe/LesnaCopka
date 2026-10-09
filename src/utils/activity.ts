/**
 * Aktywność innych wobec gracza (tryb Supabase, `get_activity`) → wpisy centrum powiadomień: społeczność (reakcje,
 * komentarze, zaproszenia) i rywalizacja (pojedynki, walki o okaz – docs/rywalizacja.md §5).
 * Czyste funkcje; doręczanie i zapamiętanie `since` – src/store/notify.ts (pollActivity).
 * Testy: src/utils/__tests__/activity.test.ts.
 */
import type { IconName } from '@/components/Icon';
import type { ActivityItem } from '@/types';
import { daysLabel, DUEL_KINDS, isDuelKind } from './duels';
import { fmtInt } from './format';

/** Bez zapamiętanego `since` (pierwsze pobranie, po „Wyczyść dane”) bierzemy aktywność z ostatnich 7 dni. */
export const ACTIVITY_LOOKBACK_MS = 7 * 24 * 3600_000;
/** Cytat komentarza w tytule powiadomienia. */
export const ACTIVITY_QUOTE_MAX = 60;

/** Imiona męskie zakończone na „-a” (reszta na „-a” → forma żeńska czasownika). */
const MASCULINE_A = new Set(['kuba', 'barnaba', 'kosma', 'bonawentura', 'jarema', 'zawisza', 'juda', 'mustafa']);

/**
 * Czy nick/imię brzmi kobieco (pierwszy człon: „Ola_W”, „Ewa.las”, „MagdaLeśna” → tak; „Marek_K”, „Kuba” → nie).
 * Do form czasownika w powiadomieniach („dała” / „dał”) – w profilu nie ma płci; przy wątpliwościach forma męska.
 */
export function looksFeminine(name: string): boolean {
  const first = name
    .replace(/([a-ząćęłńóśźż])([A-ZĄĆĘŁŃÓŚŹŻ])/g, '$1 $2')
    .split(/[\s_.\-@0-9]+/)
    .filter(Boolean)[0]
    ?.toLowerCase();
  if (!first || first.length < 2) return false;
  return first.endsWith('a') && !MASCULINE_A.has(first);
}

/** „Piękne okazy! Gdzie…” – jedna linia, maks. `max` znaków. */
export function quote(text: string, max = ACTIVITY_QUOTE_MAX): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** Wpis do centrum powiadomień (kształt `useNotificationStore.push`). */
export interface ActivityEntry {
  /** `activity.<id>` – stabilny: to samo zdarzenie nie przyjdzie drugi raz. */
  key: string;
  /** Kategoria powiadomień: 'social' (reakcje, komentarze, znajomi) albo 'rivalry' (pojedynki, walki o okaz). */
  kind: 'social' | 'rivalry';
  title: string;
  body: string;
  icon: IconName;
  href: string;
  createdAt: string;
}

const metaStr = (a: ActivityItem, k: string): string | null => {
  const v = a.meta?.[k];
  return typeof v === 'string' && v ? v : null;
};
const metaNum = (a: ActivityItem, k: string): number | null => {
  const v = a.meta?.[k];
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** „„Największy okaz” · 3 dni” z `meta` zaproszenia (brak / nieznane – pusto). */
function duelWhat(a: ActivityItem): string {
  const kind = metaStr(a, 'kind');
  const days = metaNum(a, 'days');
  const label = isDuelKind(kind) ? `„${DUEL_KINDS[kind].label}”` : '';
  return [label, days ? daysLabel(days) : ''].filter(Boolean).join(' · ');
}

/** Pojedynki, walki o okaz – kategoria „Rywalizacja”. */
function rivalryEntry(a: ActivityItem, base: { key: string; createdAt: string }): ActivityEntry | null {
  const name = a.actor.name;
  const fem = looksFeminine(name);
  const r = { ...base, kind: 'rivalry' as const };
  const duel = a.refId ? `/rywalizacja/pojedynek/${encodeURIComponent(a.refId)}` : '/rywalizacja/pojedynki';
  const contest = a.refId ? `/rywalizacja/walka/${encodeURIComponent(a.refId)}` : '/rywalizacja';
  switch (a.kind) {
    case 'duel_invite': {
      const what = duelWhat(a);
      return {
        ...r,
        title: `${name} wyzywa Cię na pojedynek`,
        body: `${what ? `${what}. ` : ''}Przyjmij wyzwanie, zanim wygaśnie (48 h).`,
        icon: 'bolt',
        href: duel,
      };
    }
    case 'duel_accepted': {
      const what = duelWhat(a);
      return {
        ...r,
        title: `${name} ${fem ? 'przyjęła' : 'przyjął'} Twoje wyzwanie`,
        body: `Pojedynek${what ? ` ${what}` : ''} trwa – liczą się znaleziska od teraz.`,
        icon: 'bolt',
        href: duel,
      };
    }
    case 'duel_finished': {
      const outcome = metaStr(a, 'outcome');
      const xp = metaNum(a, 'xp') ?? 0;
      const reward = xp > 0 ? ` +${fmtInt(xp)} XP.` : '';
      if (outcome === 'won') return { ...r, title: `Wygrywasz pojedynek z ${name}!`, body: `Gratulacje!${reward} Zobacz wynik.`, icon: 'trophy', href: duel };
      if (outcome === 'lost') {
        return { ...r, title: `${name} ${fem ? 'wygrała' : 'wygrał'} Wasz pojedynek`, body: 'Zobacz wynik i weź rewanż.', icon: 'flag', href: duel };
      }
      if (outcome === 'draw') return { ...r, title: `Remis w pojedynku z ${name}`, body: `${reward ? `${reward.trim()} ` : ''}Zobacz wynik.`, icon: 'military_tech', href: duel };
      return { ...r, title: `Pojedynek z ${name} dobiegł końca`, body: 'Zobacz, kto wygrał.', icon: 'military_tech', href: duel };
    }
    case 'contest_award': {
      const place = metaNum(a, 'place');
      const title = metaStr(a, 'title') ?? 'Walka o okaz';
      const scopeName = metaStr(a, 'scopeName');
      const xp = metaNum(a, 'xp') ?? 0;
      return {
        ...r,
        title: place ? `${place}. miejsce: ${title}` : `Nagroda: ${title}`,
        body: `${scopeName ? `${scopeName}. ` : ''}${xp > 0 ? `+${fmtInt(xp)} XP. ` : ''}Zobacz tablicę wyników.`,
        icon: 'workspace_premium',
        href: contest,
      };
    }
    case 'contest_overtaken': {
      const rank = metaNum(a, 'rank');
      const title = metaStr(a, 'title');
      const verb = `${name} ${fem ? 'wyprzedziła' : 'wyprzedził'} Cię`;
      return {
        ...r,
        title: title ? `${verb}: ${title}` : `${verb} w walce o okaz`,
        body: `${rank ? `Jesteś teraz ${rank}. w województwie. ` : ''}Masz jeszcze czas na większy okaz!`,
        icon: 'trending_up',
        href: contest,
      };
    }
    default:
      return null;
  }
}

export function activityEntry(a: ActivityItem): ActivityEntry {
  const name = a.actor.name;
  const fem = looksFeminine(name);
  const post = a.postId ? `/komentarze/${a.postId}` : '/feed';
  const base = { key: `activity.${a.id}`, kind: 'social' as const, createdAt: a.createdAt };
  const rivalry = rivalryEntry(a, base);
  if (rivalry) return rivalry;
  switch (a.kind) {
    case 'reaction':
      return {
        ...base,
        title: `${name} ${fem ? 'dała' : 'dał'} „Darz grzyb!” Twojej wyprawie`,
        body: 'Zobacz wpis i komentarze pod nim.',
        icon: 'favorite',
        href: post,
      };
    case 'comment':
      return {
        ...base,
        title: `${name} ${fem ? 'skomentowała' : 'skomentował'}: „${quote(a.text ?? '')}”`,
        body: 'Odpowiedz w komentarzach pod wpisem.',
        icon: 'chat_bubble',
        href: post,
      };
    case 'friend_request':
      return {
        ...base,
        title: `${name} zaprasza Cię do znajomych`,
        body: 'Przyjmij zaproszenie, żeby widzieć nawzajem swoje wyprawy w feedzie.',
        icon: 'person_add',
        href: '/znajomi',
      };
    case 'friend_accepted':
      return {
        ...base,
        title: `${name} ${fem ? 'przyjęła' : 'przyjął'} Twoje zaproszenie`,
        body: `Jesteście znajomymi – ${fem ? 'jej' : 'jego'} wyprawy zobaczysz w feedzie.`,
        icon: 'group',
        href: '/znajomi',
      };
    default:
      // Rodzaje rywalizacji obsłużył rivalryEntry; tu tylko dla kompletności typu.
      return { ...base, title: `${name} – nowa aktywność`, body: 'Zobacz w aplikacji.', icon: 'notifications', href: '/powiadomienia' };
  }
}

const time = (iso: string | undefined) => (iso ? new Date(iso).getTime() : NaN);

/**
 * Nowa aktywność → wpisy (od najstarszego) i nowy znacznik `since`: najnowszy `createdAt` z serwera (nie zegar
 * telefonu). Serwer podaje czas z dokładnością do ms, a porównuje w µs – najnowsza pozycja wraca przy każdym
 * pobraniu, więc odrzucamy też to, co nie jest późniejsze niż `since` (duplikaty i tak blokuje klucz wpisu).
 * Bez `since` bierzemy tylko ostatnie 7 dni.
 */
export function activityEntries(
  items: ActivityItem[],
  since: string | undefined,
  now = Date.now(),
): { entries: ActivityEntry[]; since: string | undefined } {
  const from = since ? time(since) : now - ACTIVITY_LOOKBACK_MS;
  const fresh = items
    .filter((a) => {
      const t = time(a.createdAt);
      return Number.isFinite(t) && (since && Number.isFinite(from) ? t > from : t >= from);
    })
    .sort((a, b) => time(a.createdAt) - time(b.createdAt));
  const newest = items.reduce<string | undefined>((m, a) => (!m || time(a.createdAt) > time(m) ? a.createdAt : m), since);
  return { entries: fresh.map(activityEntry), since: newest };
}
