/**
 * Przyjmowanie wyzwań gmin – czyste funkcje (testy: src/utils/__tests__/challenges.test.ts). Lustro `accept_challenge`
 * (supabase/migrations/20261015103000_uszczelnienia.sql): wyzwanie przyjmuje się tylko w gminie domowej albo
 * obserwowanej i najwyżej CHALLENGE_ACTIVE_MAX naraz (przyjęte, nieukończone, trwające, przyjęte w ostatnich
 * CHALLENGE_ACTIVE_DAYS dniach – stałe wyzwania bez końca nie blokują miejsca na zawsze).
 */

/** Najwyżej tyle przyjętych, nieukończonych wyzwań naraz (`challenge_active_max` na serwerze). */
export const CHALLENGE_ACTIVE_MAX = 3;
/** Przyjęte wcześniej nie zajmują miejsca (`challenge_active_days`). */
export const CHALLENGE_ACTIVE_DAYS = 7;

export interface ChallengeAcceptState {
  homeGminaId: string;
  /** Gmina domowa jeszcze niewybrana (wartość zastępcza – serwer jej nie zna). */
  homeGminaPending?: boolean;
  followedGminy: readonly string[];
  challenges: readonly { acceptedAt: string; completedAt?: string; endsAt?: string }[];
}

/** Przyjęte wyzwania, które zajmują miejsce w limicie. */
export function activeChallengeCount(challenges: ChallengeAcceptState['challenges'], now = Date.now()): number {
  const since = now - CHALLENGE_ACTIVE_DAYS * 86_400_000;
  return challenges.filter(
    (c) => !c.completedAt && (!c.endsAt || Date.parse(c.endsAt) > now) && Date.parse(c.acceptedAt) > since,
  ).length;
}

/** Powód odmowy (do toastu) albo null, gdy wyzwanie gminy `gminaId` można przyjąć. */
export function challengeAcceptBlock(s: ChallengeAcceptState, gminaId: string, now = Date.now()): string | null {
  const home = !s.homeGminaPending && s.homeGminaId === gminaId;
  if (!home && !s.followedGminy.includes(gminaId)) {
    return 'Wyzwanie przyjmiesz w gminie domowej albo obserwowanej – najpierw obserwuj tę gminę';
  }
  const active = activeChallengeCount(s.challenges, now);
  if (active >= CHALLENGE_ACTIVE_MAX) {
    return `Masz już ${active} przyjęte wyzwania gmin – ukończ któreś, zanim przyjmiesz kolejne`;
  }
  return null;
}
