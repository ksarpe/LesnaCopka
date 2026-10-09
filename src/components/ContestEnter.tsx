/**
 * Zgłoszenie okazu do walki – wspólny przebieg dla ekranu Nagroda, dziennika znalezisk i ekranu walki: zgoda na
 * pokazanie zdjęcia (bez lokalizacji – tylko gmina, po 24 h), pytanie przy zastąpieniu większego okazu mniejszym,
 * zgłoszenie, toast i odświeżenie ekranów rywalizacji (useStatsSync).
 */
import { useMemo } from 'react';

import { useNow } from '@/hooks/useNow';
import type { ContestService } from '@/services/types';
import { useCatalogStore } from '@/store/useCatalogStore';
import { useOutboxStore, type OutboxItem } from '@/store/useOutboxStore';
import { useStatsSync } from '@/store/useStatsSync';
import { useTripStore } from '@/store/useTripStore';
import { ui } from '@/store/useUiStore';
import type { ContestEligibility, ContestKind, Find } from '@/types';
import { bestPlace, contestCheck, contestScore, fmtContestScore } from '@/utils/contests';
import { claimedFinds } from '@/utils/history';
import { failText } from '@/utils/social';

/** Informacja o prywatności przy zgłoszeniu (Nagroda, dialog zgłoszenia). */
export const CONTEST_PRIVACY_NOTE = 'Zdjęcie okazu zobaczą inni grzybiarze – bez lokalizacji (tylko gmina), po 24 h.';

const titles = (e: ContestEligibility) => e.contests.map((m) => `„${m.contest.title}”`).join(' i ');

/** Walki, w których nowy okaz zastąpiłby większy zgłoszony wcześniej. */
const smallerThanCurrent = (e: ContestEligibility) =>
  e.contests.filter((m) => !m.entered && m.currentBest != null && m.currentBest > m.score);

/**
 * Zgłasza okaz po potwierdzeniu. `askFirst` – dialog z walkami, miejscem i informacją o zdjęciu (dziennik, ekran walki);
 * bez niego (Nagroda – informacja jest na karcie) pyta tylko, gdy nowy okaz jest mniejszy od zgłoszonego.
 * Zwraca kwalifikację po zgłoszeniu albo null (rezygnacja, odmowa, błąd – z toastem).
 */
export async function confirmAndEnter(
  contests: ContestService,
  elig: ContestEligibility,
  opts: { askFirst: boolean },
): Promise<ContestEligibility | null> {
  if (!elig.eligible) {
    ui.toast(elig.reason ?? 'Ten okaz nie może walczyć', 'info');
    return null;
  }
  if (!elig.contests.length) {
    ui.toast('Walki tego tygodnia są już zamknięte', 'schedule');
    return null;
  }
  if (elig.contests.every((m) => m.entered)) {
    ui.toast(`Ten okaz już walczy: ${titles(elig)}`, 'check_circle');
    return elig;
  }
  const smaller = smallerThanCurrent(elig);
  const replace = smaller.length
    ? ` W ${smaller.map((m) => `„${m.contest.title}”`).join(' i ')} masz już większy okaz (${smaller
        .map((m) => fmtContestScore(m.contest.kind, m.currentBest!))
        .join(', ')}) – nowe zgłoszenie go zastąpi.`
    : '';
  if (opts.askFirst || smaller.length) {
    const place = bestPlace(elig.contests[0].projectedRank).text;
    const message = opts.askFirst
      ? `Walczy w: ${titles(elig)}. Twój okaz byłby ${place}. ${CONTEST_PRIVACY_NOTE}${replace}`
      : replace.trim();
    const ok = await ui.choose({
      title: smaller.length && !opts.askFirst ? 'Zastąpić większy okaz?' : 'Zgłosić okaz do walki?',
      message,
      icon: 'emoji_events',
      actions: [
        { label: 'Anuluj', style: 'cancel', value: null },
        { label: smaller.length ? 'Zgłoś mimo to' : 'Zgłoś okaz', style: 'primary', value: 'yes' },
      ],
    });
    if (ok !== 'yes') return null;
  }
  try {
    const after = await contests.enterContest(elig.findId);
    useStatsSync.getState().invalidate();
    ui.toast(
      after.prizeEligible
        ? 'Okaz walczy! Wyniki – na ekranie Rywalizacja'
        : 'Okaz walczy – nagrody po zabezpieczeniu konta e-mailem',
      'emoji_events',
    );
    return after;
  } catch (e) {
    ui.toast(failText(e, 'Brak sieci – zgłoś okaz, gdy wróci zasięg'), 'wifi_off');
    return null;
  }
}

/**
 * Tryb Supabase: znalezisko albo jego odbiór (`find.submit` / `find.claim`) czeka jeszcze w kolejce synchronizacji –
 * serwer go nie zna albo uważa za nieodebrane („Najpierw odbierz nagrodę…”). Tryb mock: kolejka zawsze pusta.
 */
export const findSyncPending = (items: readonly OutboxItem[], findId: string) =>
  items.some((x) => (x.type === 'find.submit' || x.type === 'find.claim') && x.payload.findId === findId);

/** Czy znalezisko czeka w kolejce synchronizacji (subskrypcja – zmienia się, gdy kolejka je wyśle). */
export function useFindSyncPending(findId: string): boolean {
  return useOutboxStore((s) => findSyncPending(s.items, findId));
}

/** Dziennik / ekran walki: pobiera kwalifikację z serwisu i zgłasza okaz po potwierdzeniu. */
export async function enterFindFlow(contests: ContestService, findId: string): Promise<ContestEligibility | null> {
  if (findSyncPending(useOutboxStore.getState().items, findId)) {
    ui.toast('Okaz jeszcze się wysyła na serwer – zgłoś go za chwilę', 'cloud_off');
    return null;
  }
  let elig: ContestEligibility;
  try {
    elig = await contests.getContestEligibility(findId);
  } catch (e) {
    ui.toast(failText(e, 'Brak sieci – zgłoś okaz, gdy wróci zasięg'), 'wifi_off');
    return null;
  }
  return confirmAndEnter(contests, elig, { askFirst: true });
}

/** Wycofanie okazu z walki (dopóki trwa); ekrany odświeżają się przez useStatsSync. */
export function confirmWithdraw(contests: ContestService, contest: { id: string; title: string }) {
  ui.confirm({
    title: 'Wycofać okaz z walki?',
    message: `Okaz zniknie z tablicy „${contest.title}”. Możesz zgłosić go ponownie, dopóki walka trwa.`,
    icon: 'undo',
    confirmLabel: 'Wycofaj',
    danger: true,
    onConfirm: async () => {
      try {
        await contests.withdrawContestEntry(contest.id);
        useStatsSync.getState().invalidate();
        ui.toast('Okaz wycofany z walki', 'undo');
      } catch (e) {
        ui.toast(failText(e, 'Brak sieci – nie udało się wycofać okazu'), 'wifi_off');
      }
    },
  });
}

/** Zgłoszenie cudzego okazu do moderacji (jak „Zgłoś” wpisu w feedzie): powód, toast od razu, wysyłka w tle. */
export async function reportEntryFlow(contests: ContestService, entryId: string, author: string) {
  const reason = await ui.choose({
    title: 'Zgłoś okaz',
    message: `Co jest nie tak z okazem: ${author}? Zgłoszenie trafi do moderacji – okaz z kilkoma zgłoszeniami znika z tablic do sprawdzenia.`,
    icon: 'flag',
    actions: [
      { label: 'Zdjęcie ekranu lub wydruku', style: 'danger', value: 'reproduction' },
      { label: 'To inny gatunek', style: 'danger', value: 'wrong_species' },
      { label: 'Coś innego', style: 'danger', value: 'other' },
      { label: 'Anuluj', style: 'cancel', value: null },
    ],
  });
  if (!reason) return;
  ui.toast('Dziękujemy – zgłoszenie wysłane', 'flag');
  try {
    await contests.reportContestEntry(entryId, reason);
  } catch (e) {
    ui.toast(failText(e, 'Brak sieci – zgłoszenie nie zostało wysłane'), 'wifi_off');
  }
}

export interface ContestCandidate {
  find: Find;
  /** Tydzień walk okazu. */
  weekStart: string;
  /** Wynik w walce danego rodzaju (cm / %). */
  score: number;
}

/**
 * Okazy z telefonu, które mogą walczyć (warunki z utils/contests.ts – bez dopuszczenia gracza, które zna serwer),
 * od największego w danej walce. `weekStart` / `speciesId` – zawężenie do tygodnia i gatunku walki.
 */
export function useContestCandidates(
  filter: { weekStart?: string; speciesId?: string | null; kind?: ContestKind } = {},
): ContestCandidate[] {
  const finds = useTripStore((s) => s.finds);
  const speciesById = useCatalogStore((s) => s.speciesById);
  const { weekStart, speciesId, kind = 'relative' } = filter;
  // Co minutę od nowa – okaz z minionego tygodnia przestaje się kwalifikować bez przeładowania ekranu.
  const now = useNow(60_000);
  return useMemo(() => {
    return claimedFinds(finds)
      .flatMap((find): ContestCandidate[] => {
        const sp = speciesById[find.speciesId];
        const check = contestCheck(find, sp, { now });
        if (!check.ok || !check.weekStart || !sp) return [];
        if (weekStart && check.weekStart !== weekStart) return [];
        if (speciesId && find.speciesId !== speciesId) return [];
        return [{ find, weekStart: check.weekStart, score: contestScore(kind, find.dimensions.capCm, sp.typical.capCm) }];
      })
      .sort((a, b) => b.score - a.score);
  }, [finds, speciesById, weekStart, speciesId, kind, now]);
}
