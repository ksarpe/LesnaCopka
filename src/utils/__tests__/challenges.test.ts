import { describe, expect, it } from '@jest/globals';

import { activeChallengeCount, CHALLENGE_ACTIVE_MAX, challengeAcceptBlock, type ChallengeAcceptState } from '../challenges';

const NOW = Date.parse('2026-10-09T10:00:00.000Z');
const DAY = 86_400_000;
const at = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const state = (o: Partial<ChallengeAcceptState> = {}): ChallengeAcceptState => ({
  homeGminaId: 'suprasl',
  followedGminy: ['michalowo'],
  challenges: [],
  ...o,
});

describe('przyjmowanie wyzwań gmin (lustro accept_challenge)', () => {
  it('gmina domowa albo obserwowana – tak; inna – powód do toastu', () => {
    expect(challengeAcceptBlock(state(), 'suprasl', NOW)).toBeNull();
    expect(challengeAcceptBlock(state(), 'michalowo', NOW)).toBeNull();
    expect(challengeAcceptBlock(state(), 'hajnowka', NOW)).toMatch(/obserwuj tę gminę/);
  });

  it('gmina domowa jeszcze niewybrana (wartość zastępcza) nie liczy się jako domowa', () => {
    expect(challengeAcceptBlock(state({ homeGminaPending: true }), 'suprasl', NOW)).toMatch(/obserwuj/);
  });

  it(`najwyżej ${CHALLENGE_ACTIVE_MAX} aktywne: ukończone, zakończone i przyjęte > 7 dni temu nie zajmują miejsca`, () => {
    const active = [
      { acceptedAt: at(DAY) },
      { acceptedAt: at(2 * DAY), endsAt: at(-DAY) },
      { acceptedAt: at(3 * DAY) },
    ];
    expect(activeChallengeCount(active, NOW)).toBe(3);
    expect(challengeAcceptBlock(state({ challenges: active }), 'suprasl', NOW)).toMatch(/Masz już 3 przyjęte/);
    const freed = [
      { acceptedAt: at(DAY), completedAt: at(1000) },
      { acceptedAt: at(2 * DAY), endsAt: at(1000) },
      { acceptedAt: at(8 * DAY) },
      { acceptedAt: at(DAY) },
    ];
    expect(activeChallengeCount(freed, NOW)).toBe(1);
    expect(challengeAcceptBlock(state({ challenges: freed }), 'suprasl', NOW)).toBeNull();
  });
});
