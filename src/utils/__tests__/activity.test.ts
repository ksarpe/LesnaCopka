import { describe, expect, it } from '@jest/globals';

import type { ActivityItem } from '@/types';
import { ACTIVITY_LOOKBACK_MS, activityEntries, activityEntry, looksFeminine, quote } from '../activity';

const actor = (name: string) => ({ id: `u-${name}`, name, level: 10, ringRarity: 'rzadki' as const });
const item = (o: Partial<ActivityItem> & Pick<ActivityItem, 'kind'>): ActivityItem => ({
  id: `${o.kind}:1`,
  actor: actor('Ola_W'),
  postId: 'p1',
  text: null,
  createdAt: '2026-10-06T10:00:00.000Z',
  ...o,
});

describe('aktywność → powiadomienia', () => {
  it('reakcja i komentarz prowadzą do komentarzy wpisu; formy czasownika wg imienia', () => {
    expect(activityEntry(item({ kind: 'reaction' }))).toEqual({
      key: 'activity.reaction:1',
      kind: 'social',
      title: 'Ola_W dała „Darz grzyb!” Twojej wyprawie',
      body: 'Zobacz wpis i komentarze pod nim.',
      icon: 'favorite',
      href: '/komentarze/p1',
      createdAt: '2026-10-06T10:00:00.000Z',
    });
    const c = activityEntry(item({ kind: 'comment', id: 'comment:c1', actor: actor('Marek_K'), text: 'Piękne okazy!\nGdzie takie rosną?' }));
    expect(c).toMatchObject({ key: 'activity.comment:c1', title: 'Marek_K skomentował: „Piękne okazy! Gdzie takie rosną?”', href: '/komentarze/p1', icon: 'chat_bubble' });
  });

  it('zaproszenia prowadzą do ekranu Znajomi', () => {
    expect(activityEntry(item({ kind: 'friend_request', actor: actor('Ewa'), postId: null }))).toMatchObject({
      title: 'Ewa zaprasza Cię do znajomych',
      href: '/znajomi',
      icon: 'person_add',
    });
    expect(activityEntry(item({ kind: 'friend_accepted', actor: actor('Bartek'), postId: null }))).toMatchObject({
      title: 'Bartek przyjął Twoje zaproszenie',
      body: 'Jesteście znajomymi – jego wyprawy zobaczysz w feedzie.',
      href: '/znajomi',
    });
    expect(activityEntry(item({ kind: 'friend_accepted', actor: actor('Kasia_P'), postId: null })).title).toBe('Kasia_P przyjęła Twoje zaproszenie');
  });

  it('heurystyka imion i skracanie cytatu', () => {
    expect(['Ola_W', 'Ewa.las', 'MagdaLeśna', 'Zosia_Kania', 'ania.rydz'].every(looksFeminine)).toBe(true);
    expect(['Marek_K', 'Kuba', 'Bartek', 'Jurek_z_Puszczy', 'Grzybiarz', 'x', ''].some(looksFeminine)).toBe(false);
    expect(quote('a'.repeat(80), 60)).toHaveLength(60);
    expect(quote('a'.repeat(80), 60).endsWith('…')).toBe(true);
  });

  it('nowe wpisy od najstarszego, `since` = najnowszy znacznik z serwera (bez zmiany zapisu)', () => {
    const items = [
      item({ kind: 'comment', id: 'c2', createdAt: '2026-10-06T10:05:00.654321+00:00', text: 'b' }),
      item({ kind: 'reaction', id: 'r1', createdAt: '2026-10-06T10:01:00+00:00' }),
    ];
    const r = activityEntries(items, '2026-10-06T09:00:00+00:00');
    expect(r.entries.map((e) => e.key)).toEqual(['activity.r1', 'activity.c2']);
    expect(r.since).toBe('2026-10-06T10:05:00.654321+00:00');
    // Pusta odpowiedź – znacznik bez zmian.
    expect(activityEntries([], r.since)).toEqual({ entries: [], since: r.since });
    // Serwer zwraca ponownie pozycję z chwili `since` (ms vs µs) – pomijamy ją.
    expect(activityEntries([items[0]], r.since).entries).toEqual([]);
  });

  it('pierwsze pobranie (bez `since`) – tylko ostatnie 7 dni', () => {
    const now = new Date('2026-10-06T12:00:00Z').getTime();
    const old = new Date(now - ACTIVITY_LOOKBACK_MS - 60_000).toISOString();
    const r = activityEntries([item({ kind: 'reaction', id: 'old', createdAt: old }), item({ kind: 'reaction', id: 'new' })], undefined, now);
    expect(r.entries.map((e) => e.key)).toEqual(['activity.new']);
    expect(r.since).toBe('2026-10-06T10:00:00.000Z');
  });
});
