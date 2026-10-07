/**
 * Blokowanie w mockach – zachowanie jak na serwerze (docs/backend.md → „Blokowanie”): feed, komentarze, wpis,
 * wyszukiwarka, znajomi, zaproszenia i lista zablokowanych.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@/geo', () => ({ missingGminy: () => Promise.resolve([]), gminaIndex: () => Promise.reject(new Error('brak indeksu')) }));
// Moduły z natywnymi zależnościami (mapa, aparat, GPS) – feed ich nie używa.
jest.mock('../../live/map', () => ({ liveMap: {} }));
jest.mock('../../live/camera', () => ({ liveCamera: {} }));
jest.mock('../../live/location', () => ({ livePermissions: {}, readDevicePosition: () => null, regionAt: () => null }));
jest.mock('../geo', () => ({}));

const { mockServices } = require('../index') as typeof import('../index');
const { useMockDb } = require('../db') as typeof import('../db');
const { useSimStore } = require('../../../store/useSimStore') as typeof import('../../../store/useSimStore');
/* eslint-enable @typescript-eslint/no-require-imports */

const feed = mockServices.feed;

/** Mocki czekają 150–1300 ms („sieć”) – przewijamy zegar. */
async function call<T>(p: Promise<T>): Promise<T> {
  const settled = p.then(
    (v) => ({ ok: true as const, v }),
    (e: unknown) => ({ ok: false as const, e }),
  );
  await jest.advanceTimersByTimeAsync(3000);
  const r = await settled;
  if (!r.ok) throw r.e;
  return r.v;
}

beforeEach(() => {
  jest.useFakeTimers();
  useMockDb.getState().reset();
  useSimStore.getState().set({ networkEnabled: true });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('blokowanie (mock)', () => {
  it('zablokowany znika z feedu i znajomych, jego wpis „nie istnieje”; odblokowanie przywraca wpisy, ale nie znajomość', async () => {
    const before = await call(feed.getFeed('friends'));
    expect(before.some((p) => p.author.id === 'u-ola')).toBe(true);
    expect((await call(feed.getFriends())).map((u) => u.id)).toContain('u-ola');

    await call(feed.blockUser('u-ola'));

    const after = await call(feed.getFeed('friends'));
    expect(after.some((p) => p.author.id === 'u-ola')).toBe(false);
    expect((await call(feed.getFriends())).map((u) => u.id)).not.toContain('u-ola');
    await expect(call(feed.getPost('p-ola-1'))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(call(feed.getComments('p-ola-1'))).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const blocked = await call(feed.getBlockedUsers());
    expect(blocked).toEqual([expect.objectContaining({ id: 'u-ola', handle: expect.stringMatching(/^@/), blockedAt: expect.any(String) })]);
    // Mini profil: wiadomo, że zablokowany (przycisk „Odblokuj”).
    expect(await call(feed.getUser('u-ola'))).toMatchObject({ blocked: true, friend: false, friendStatus: 'none' });

    await call(feed.unblockUser('u-ola'));
    expect(await call(feed.getBlockedUsers())).toEqual([]);
    expect((await call(feed.getPost('p-ola-1'))).id).toBe('p-ola-1');
    // Znajomość nie wraca sama (jak unblock_user na serwerze).
    expect((await call(feed.getFriends())).map((u) => u.id)).not.toContain('u-ola');
  });

  it('komentarze zablokowanego znikają spod cudzych wpisów, licznik w feedzie też', async () => {
    const all = await call(feed.getComments('p-ewa-1'));
    const author = all[0].author;
    const own = all.filter((c) => c.author.id === author.id).length;
    expect(own).toBeGreaterThan(0);

    await call(feed.blockUser(author.id));

    const visible = await call(feed.getComments('p-ewa-1'));
    expect(visible.some((c) => c.author.id === author.id)).toBe(false);
    expect(visible).toHaveLength(all.length - own);
    const post = await call(feed.getPost('p-ewa-1'));
    expect(post.kind === 'trip' ? post.comments : -1).toBe(all.length - own);
    // Feed liczy tak samo (wpis z listy wszystkich widocznych).
    const listed = [...(await call(feed.getFeed('friends'))), ...(await call(feed.getFeed('gmina')))].find((p) => p.id === 'p-ewa-1');
    if (listed?.kind === 'trip') expect(listed.comments).toBe(all.length - own);
  });

  it('wyszukiwarka i propozycje bez zablokowanych; zaproszenie zablokowanego odrzucone', async () => {
    const found = await call(feed.searchUsers('zosia'));
    expect(found.length).toBeGreaterThan(0);
    const zosia = found[0];

    await call(feed.blockUser(zosia.id));

    expect((await call(feed.searchUsers('zosia'))).some((u) => u.id === zosia.id)).toBe(false);
    expect((await call(feed.searchUsers(''))).some((u) => u.id === zosia.id)).toBe(false);
    await expect(call(feed.addFriend(zosia.id))).rejects.toMatchObject({ code: 'SERVER', message: expect.stringMatching(/Odblokuj/) });
  });

  it('blokada jest idempotentna, najnowsza na górze listy; nieznany grzybiarz → NOT_FOUND', async () => {
    await call(feed.blockUser('u-marek'));
    await call(feed.blockUser('u-ola'));
    await call(feed.blockUser('u-marek'));
    expect((await call(feed.getBlockedUsers())).map((u) => u.id)).toEqual(['u-marek', 'u-ola']);
    await expect(call(feed.blockUser('u-nikt'))).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('reset „serwera” mocków (nowe konto) czyści blokady', async () => {
    await call(feed.blockUser('u-ola'));
    useMockDb.getState().reset({ emptyFeed: true });
    expect(await call(feed.getBlockedUsers())).toEqual([]);
  });
});
