import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

const { mockSocial } = require('../social') as typeof import('../social');
const { useMockDb } = require('../db') as typeof import('../db');
const { useSimStore } = require('../../../store/useSimStore') as typeof import('../../../store/useSimStore');
const { ServiceError } = require('../../types') as typeof import('../../types');
/* eslint-enable @typescript-eslint/no-require-imports */

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

const tripComments = (id: string) => {
  const p = useMockDb.getState().posts.find((x) => x.id === id);
  return p?.kind === 'trip' ? p.comments : -1;
};

beforeEach(() => {
  jest.useFakeTimers();
  useMockDb.getState().reset();
  useSimStore.getState().set({ networkEnabled: true });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('komentarze (mock)', () => {
  it('lista ma tyle komentarzy, ile pokazuje feed; własny komentarz podbija licznik i da się go usunąć', async () => {
    const list = await call(mockSocial.getComments('p-ola-1'));
    expect(list).toHaveLength(12);

    const mine = await call(mockSocial.addComment('p-ola-1', '  Piękny szmaciak!  '));
    expect(mine).toMatchObject({ mine: true, text: 'Piękny szmaciak!', postId: 'p-ola-1' });
    expect(tripComments('p-ola-1')).toBe(13);
    const after = await call(mockSocial.getComments('p-ola-1'));
    expect(after.at(-1)?.id).toBe(mine.id);
    // Wygenerowane komentarze są trwałe – drugi odczyt zwraca te same.
    expect(after.slice(0, 12)).toEqual(list);

    await call(mockSocial.deleteComment('p-ola-1', mine.id));
    expect(tripComments('p-ola-1')).toBe(12);
  });

  it('cudzego komentarza nie da się usunąć, pustego nie da się wysłać', async () => {
    const [first] = await call(mockSocial.getComments('p-ewa-1'));
    await expect(call(mockSocial.deleteComment('p-ewa-1', first.id))).rejects.toMatchObject({ code: 'PERMISSION' });
    await expect(call(mockSocial.addComment('p-ewa-1', '   '))).rejects.toThrow();
    expect(tripComments('p-ewa-1')).toBe(4);
  });

  it('bez sieci – błąd NETWORK i licznik bez zmian', async () => {
    await call(mockSocial.getComments('p-ola-1'));
    useSimStore.getState().set({ networkEnabled: false });
    const err = await call(mockSocial.addComment('p-ola-1', 'Darz grzyb!')).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ServiceError);
    expect((err as InstanceType<typeof ServiceError>).code).toBe('NETWORK');
    expect(tripComments('p-ola-1')).toBe(12);
  });

  it('nieistniejący wpis – NOT_FOUND', async () => {
    await expect(call(mockSocial.getPost('p-nie-ma'))).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('ukryte wpisy (mock)', () => {
  it('ukrycie, lista ukrytych i przywrócenie', async () => {
    await call(mockSocial.hidePost('p-ola-1'));
    await call(mockSocial.hidePost('p-ewa-1'));
    expect((await call(mockSocial.getHiddenPosts())).map((p) => p.id).sort()).toEqual(['p-ewa-1', 'p-ola-1']);
    await call(mockSocial.unhidePosts(['p-ola-1']));
    expect(useMockDb.getState().hiddenPostIds).toEqual(['p-ewa-1']);
    await call(mockSocial.unhidePosts());
    expect(useMockDb.getState().hiddenPostIds).toEqual([]);
  });
});

describe('znajomi (mock)', () => {
  it('start: znajomi z makiety; reset „nowy użytkownik” – bez znajomych', async () => {
    const friends = await call(mockSocial.getFriends());
    expect(friends.map((f) => f.name)).toEqual(['Ola_W', 'Marek_K', 'Bartek', 'Ewa.las', 'Kasia_P', 'Tomek_B']);
    expect(friends.every((f) => f.friend)).toBe(true);
    useMockDb.getState().reset({ emptyFeed: true });
    expect(await call(mockSocial.getFriends())).toEqual([]);
  });

  it('nowy znajomy dostaje dwa wpisy (raz), usunięcie zdejmuje go z listy', async () => {
    const before = useMockDb.getState().posts.length;
    const u = await call(mockSocial.addFriend('u-g77'));
    expect(u.friend).toBe(true);
    expect(useMockDb.getState().friendIds[0]).toBe('u-g77');
    expect(useMockDb.getState().posts.length).toBe(before + 2);
    await call(mockSocial.addFriend('u-g77'));
    expect(useMockDb.getState().posts.length).toBe(before + 2);

    // Znajomy z wpisami w makiecie nie dostaje dodatkowych.
    await call(mockSocial.removeFriend('u-ola'));
    expect(useMockDb.getState().friendIds).not.toContain('u-ola');
    await call(mockSocial.addFriend('u-ola'));
    expect(useMockDb.getState().posts.length).toBe(before + 2);
  });

  it('wyszukiwarka: po nicku bez polskich znaków; puste zapytanie = propozycje spoza znajomych', async () => {
    const res = await call(mockSocial.searchUsers('lukasz'));
    expect(res.map((u) => u.name)).toEqual(['Łukasz_Borowik']);
    const suggested = await call(mockSocial.searchUsers(''));
    expect(suggested.length).toBeGreaterThan(0);
    expect(suggested.every((u) => !u.friend)).toBe(true);
    expect((await call(mockSocial.getUser('u-ola'))).friend).toBe(true);
  });
});
