import { describe, expect, it } from '@jest/globals';

import type { Find, Trip } from '@/types';
import { buildOwnTripPost, claimedFindsOf, highlightText, PRIVACY_DELAY_MS, tripPostTitle } from '../tripPost';

const find = (id: string, o: Partial<Find> = {}): Find => ({
  id,
  tripId: 't1',
  speciesId: 'maslak-zwyczajny',
  gminaId: 'suprasl',
  rarity: 'pospolity',
  confidence: 0.9,
  xxl: false,
  dimensions: { capCm: 7, heightCm: 6, weightG: 70, ageDays: 3 },
  collected: true,
  status: 'claimed',
  foundAt: '2026-10-06T10:00:00.000Z',
  xp: { lines: [], total: 40 },
  ...o,
});

const trip: Trip = {
  id: 't1',
  gminaId: 'suprasl',
  status: 'finished',
  startedAt: '2026-10-06T09:00:00.000Z',
  endedAt: '2026-10-06T11:14:00.000Z',
  elapsedMs: 134 * 60000,
  segmentStartedAt: 0,
  distanceKm: 6.43,
  findIds: ['a', 'b', 'c', 'gone'],
  xp: 1840,
  hideRoute: false,
};

describe('wpis z własnej wyprawy', () => {
  it('liczby, wyróżnienie najrzadszego, okładka ze zdjęciem, widoczny za 24 h', () => {
    const finds = {
      a: find('a', { photoUri: 'file:///a.jpg' }),
      b: find('b', { speciesId: 'borowik-szlachetny', rarity: 'rzadki', dimensions: { capCm: 14, heightCm: 17, weightG: 2340, ageDays: 5 } }),
      c: find('c', { collected: false, speciesId: 'muchomor-sromotnikowy' }),
    };
    const now = new Date('2026-10-06T12:00:00.000Z');
    const post = buildOwnTripPost({
      id: 'local:t1',
      trip,
      finds: claimedFindsOf(trip, finds),
      author: { id: 'me', name: 'Kuba', level: 14, ringRarity: 'primary' },
      speciesName: (id) => ({ 'borowik-szlachetny': 'Borowik szlachetny (prawdziwek)' })[id],
      hideRoute: true,
      now,
    });
    expect(post).toMatchObject({
      id: 'local:t1',
      tripId: 't1',
      mine: true,
      title: 'Długa wyprawa po Puszczy',
      distanceKm: 6.4,
      durationMin: 134,
      mushrooms: 2,
      species: 2,
      xp: 1840,
      routePrecision: 'gmina',
      highlight: { rarity: 'rzadki', text: 'Borowik szlachetny 2,3 kg' },
      coverFindId: 'a',
      createdAt: trip.endedAt,
      publishedAt: now.toISOString(),
      visibleFrom: new Date(now.getTime() + PRIVACY_DELAY_MS).toISOString(),
      reactions: 0,
      comments: 0,
    });
  });

  it('tytuł i etykieta wyróżnienia', () => {
    expect(tripPostTitle({ distanceKm: 2 })).toBe('Wyprawa po grzyby');
    expect(highlightText('Borowik szlachetny (prawdziwek)', 410)).toBe('Borowik szlachetny 410 g');
    expect(highlightText('Czubajka kania', null, 31)).toBe('Czubajka kania 31 cm');
    expect(highlightText('Pieprznik jadalny')).toBe('Pieprznik jadalny');
  });
});
