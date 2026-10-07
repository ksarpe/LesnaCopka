import { describe, expect, it } from '@jest/globals';

import type { TripPost } from '@/types';
import { ServiceError } from '../../types';
import {
  mapActivity,
  mapAuthor,
  mapComment,
  mapComments,
  mapFriendsOverview,
  mapFriendStatus,
  mapPost,
  mapPosts,
  mapReaction,
  mapSocialUser,
  mergeLocalPosts,
  toServiceError,
} from '../feedMap';

const author = (o: Record<string, unknown> = {}) => ({
  id: 'u-ola',
  handle: 'ola.w',
  name: 'Ola_W',
  level: 18,
  avatarPreset: 'lis',
  ringRarity: 'rzadki',
  ...o,
});

const tripRow = (o: Record<string, unknown> = {}) => ({
  id: 'p1',
  kind: 'trip',
  author: author(),
  gminaId: 'suprasl',
  tripId: 't1',
  routePrecision: 'approximate',
  payload: {
    title: 'Mgła, mech i pełny kosz',
    distance_km: 6.42,
    duration_min: 134,
    mushrooms: 9,
    species: 4,
    xp: 1840,
    highlight: { rarity: 'rzadki', species: 'Borowik szlachetny (prawdziwek)', weight_g: 410, cap_cm: 14 },
    route: null,
  },
  reactions: 12,
  comments: 3,
  reacted: true,
  mine: false,
  createdAt: '2026-10-06T08:00:00.000Z',
  publishedAt: '2026-10-06T08:05:00.000Z',
  visibleFrom: '2026-10-07T08:05:00.000Z',
  ...o,
});

describe('mapAuthor / mapSocialUser', () => {
  it('autor: nick z „@”, motyw avatara, nieznana rzadkość obwódki → pospolity', () => {
    expect(mapAuthor(author())).toEqual({
      id: 'u-ola',
      name: 'Ola_W',
      level: 18,
      ringRarity: 'rzadki',
      handle: '@ola.w',
      avatar: { kind: 'preset', id: 'lis' },
    });
    expect(mapAuthor(author({ avatarPreset: null, ringRarity: 'tęczowy', handle: '@ewa' }))).toEqual({
      id: 'u-ola',
      name: 'Ola_W',
      level: 18,
      ringRarity: 'pospolity',
      handle: '@ewa',
    });
    expect(mapAuthor(author({ ringRarity: 'primary' })).ringRarity).toBe('primary');
  });

  it('etap 5: zdjęcie profilowe (avatarPath) → publiczny adres z koszyka avatars, ma pierwszeństwo przed motywem', () => {
    const url = /\/storage\/v1\/object\/public\/avatars\/u-ola\/avatar-17\.jpg$/;
    expect(mapAuthor(author({ avatarPath: 'u-ola/avatar-17.jpg' })).avatar).toEqual({ kind: 'photo', uri: expect.stringMatching(url) });
    expect(mapAuthor(author({ avatarPath: null })).avatar).toEqual({ kind: 'preset', id: 'lis' });
    expect(mapAuthor(author({ avatarPath: '', avatarPreset: null }))).not.toHaveProperty('avatar');
    // Grzybiarz (wyszukiwarka, znajomi) i autor aktywności – ten sam autor.
    expect(mapSocialUser({ ...author({ avatarPath: 'u-ola/avatar-17.jpg' }), friendStatus: 'none' })?.avatar).toMatchObject({ kind: 'photo' });
    expect(mapActivity([{ id: 'a1', kind: 'reaction', actor: author({ avatarPath: 'u-ola/avatar-17.jpg' }), createdAt: 'x' }])[0].actor.avatar).toMatchObject({
      kind: 'photo',
    });
  });

  it('grzybiarz: liczniki, status relacji i zgodna flaga `friend`; serwer bez imienia i nazwiska', () => {
    const u = mapSocialUser({ ...author(), homeGminaId: 'suprasl', tripsCount: 212, mushroomsCount: 1840, friendStatus: 'incoming', speciesCount: 31 });
    expect(u).toMatchObject({
      id: 'u-ola',
      handle: '@ola.w',
      fullName: '',
      homeGminaId: 'suprasl',
      tripsCount: 212,
      mushroomsCount: 1840,
      speciesCount: 31,
      friendStatus: 'incoming',
      friend: false,
    });
    expect(mapSocialUser({ ...author(), friendStatus: 'friends', homeGminaId: null })).toMatchObject({ friend: true, homeGminaId: '' });
    expect(mapSocialUser({ ...author(), friendStatus: 'kumple' })?.friendStatus).toBe('none');
    expect(mapSocialUser(null)).toBeNull();
    expect(mapSocialUser({ name: 'bez id' })).toBeNull();
  });

  it('get_friends → trzy listy; status z odpowiedzi RPC (tekst, obiekt albo tablica)', () => {
    const o = mapFriendsOverview({
      friends: [{ ...author(), friendStatus: 'friends' }],
      incoming: [{ ...author({ id: 'u-ewa', name: 'Ewa' }), friendStatus: 'incoming' }],
      outgoing: [],
    });
    expect(o.friends.map((u) => u.id)).toEqual(['u-ola']);
    expect(o.incoming.map((u) => u.name)).toEqual(['Ewa']);
    expect(o.outgoing).toEqual([]);
    expect(mapFriendsOverview(null)).toEqual({ friends: [], incoming: [], outgoing: [] });
    expect(mapFriendStatus('outgoing')).toBe('outgoing');
    expect(mapFriendStatus(['friends'])).toBe('friends');
    expect(mapFriendStatus({ friendStatus: 'none' })).toBe('none');
    expect(mapFriendStatus(42)).toBe('none');
  });
});

describe('mapPost', () => {
  it('wyprawa: payload ze snake_case, wyróżnienie jak w mocku („Borowik szlachetny 410 g”)', () => {
    const p = mapPost(tripRow());
    expect(p).toEqual({
      id: 'p1',
      kind: 'trip',
      author: { id: 'u-ola', name: 'Ola_W', level: 18, ringRarity: 'rzadki', handle: '@ola.w', avatar: { kind: 'preset', id: 'lis' } },
      gminaId: 'suprasl',
      tripId: 't1',
      createdAt: '2026-10-06T08:00:00.000Z',
      publishedAt: '2026-10-06T08:05:00.000Z',
      visibleFrom: '2026-10-07T08:05:00.000Z',
      scopes: ['friends', 'gmina'],
      title: 'Mgła, mech i pełny kosz',
      distanceKm: 6.4,
      durationMin: 134,
      mushrooms: 9,
      species: 4,
      xp: 1840,
      routePrecision: 'approximate',
      highlight: { rarity: 'rzadki', text: 'Borowik szlachetny 410 g' },
      reactions: 12,
      reacted: true,
      comments: 3,
    });
  });

  it('wyróżnienie: kilogramy z przecinkiem, bez wagi – kapelusz, bez gatunku – brak', () => {
    const hl = (h: unknown) => {
      const p = mapPost(tripRow({ payload: { ...tripRow().payload, highlight: h } }));
      return p?.kind === 'trip' ? p.highlight : 'x';
    };
    expect(hl({ rarity: 'epicki', species: 'Borowik szlachetny', weight_g: 2340, cap_cm: 22 })).toEqual({ rarity: 'epicki', text: 'Borowik szlachetny 2,3 kg' });
    expect(hl({ rarity: 'epicki', species: 'Czubajka kania', weight_g: null, cap_cm: 31 })).toEqual({ rarity: 'epicki', text: 'Czubajka kania 31 cm' });
    expect(hl(null)).toBeUndefined();
    expect(hl({ rarity: 'zwykły', species: 'Maślak' })).toBeUndefined();
  });

  it('własny wpis: okładka ze zdjęcia znaleziska tej wyprawy i avatar gracza (także zdjęcie)', () => {
    const photo = { kind: 'photo' as const, uri: 'file:///avatar.jpg' };
    const p = mapPost(tripRow({ mine: true }), { selfAvatar: photo, coverFindId: (t) => (t === 't1' ? 'f-best' : undefined) });
    expect(p).toMatchObject({ mine: true, coverFindId: 'f-best', author: { avatar: photo } });
    const other = mapPost(tripRow(), { selfAvatar: photo, coverFindId: () => 'f-best' });
    expect(other).not.toHaveProperty('mine');
    expect(other).not.toHaveProperty('coverFindId');
  });

  it('etap 5: okładka z serwera (coverPath) → publiczny adres z post-media; własny wpis ma też okładkę z telefonu', () => {
    const cover = /\/storage\/v1\/object\/public\/post-media\/u-ola\/t1-a1b2c3d4\.jpg$/;
    expect(mapPost(tripRow({ coverPath: 'u-ola/t1-a1b2c3d4.jpg' }))).toMatchObject({ coverUrl: expect.stringMatching(cover) });
    // Starszy kształt: tylko payload.cover_path.
    const row = tripRow();
    const fromPayload = mapPost({ ...row, payload: { ...row.payload, cover_path: 'u-ola/t1-a1b2c3d4.jpg' } });
    expect(fromPayload).toMatchObject({ coverUrl: expect.stringMatching(cover) });
    expect(mapPost(tripRow({ coverPath: null }))).not.toHaveProperty('coverUrl');
    const mine = mapPost(tripRow({ mine: true, coverPath: 'me/t1-a1b2c3d4.jpg' }), { coverFindId: () => 'f-best' });
    expect(mine).toMatchObject({ coverFindId: 'f-best', coverUrl: expect.stringContaining('/post-media/me/t1-a1b2c3d4.jpg') });
  });

  it('awans; nieznany rodzaj i śmieci są pomijane; tablica w tekście JSON', () => {
    const lvl = mapPost({ ...tripRow(), kind: 'levelup', tripId: null, payload: { level: 15, badge_name: 'Tropiciel' } });
    expect(lvl).toMatchObject({ kind: 'levelup', level: 15, badgeName: 'Tropiciel', author: { name: 'Ola_W' } });
    expect(lvl).not.toHaveProperty('reactions');
    const list = mapPosts(JSON.stringify([tripRow(), { ...tripRow({ id: 'p2' }), kind: 'compact' }, null, 'x', tripRow({ id: 'p3' })]));
    expect(list.map((p) => p.id)).toEqual(['p1', 'p3']);
    expect(mapPosts({ error: 'x' })).toEqual([]);
  });

  it('reakcja: obiekt albo tablica z jednym wierszem', () => {
    expect(mapReaction({ reacted: true, reactions: 13 })).toEqual({ reacted: true, reactions: 13 });
    expect(mapReaction([{ reacted: false, reactions: '12' }])).toEqual({ reacted: false, reactions: 12 });
    expect(mapReaction(null)).toEqual({ reacted: false, reactions: 0 });
  });
});

describe('komentarze i aktywność', () => {
  it('komentarz: autor z avatarem, własny – avatar gracza; lista od najstarszego', () => {
    const c = mapComment({ id: 'c1', postId: 'p1', author: author(), text: 'Darz grzyb!', createdAt: '2026-10-06T09:00:00Z', mine: false });
    expect(c).toEqual({
      id: 'c1',
      postId: 'p1',
      author: { id: 'u-ola', name: 'Ola_W', level: 18, ringRarity: 'rzadki', handle: '@ola.w', avatar: { kind: 'preset', id: 'lis' } },
      text: 'Darz grzyb!',
      createdAt: '2026-10-06T09:00:00Z',
    });
    const mine = mapComment({ id: 'c2', postId: 'p1', author: author({ id: 'me' }), text: 'Dzięki', createdAt: 'x', mine: true }, { selfAvatar: { kind: 'preset', id: 'sowa' } });
    expect(mine).toMatchObject({ mine: true, author: { avatar: { kind: 'preset', id: 'sowa' } } });
    const list = mapComments([
      { id: 'b', postId: 'p1', author: author(), text: '2', createdAt: '2026-10-06T10:00:00Z' },
      { id: 'a', postId: 'p1', author: author(), text: '1', createdAt: '2026-10-06T09:00:00Z' },
    ]);
    expect(list.map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('aktywność: znane rodzaje z aktorem, reszta pomijana', () => {
    const items = mapActivity([
      { id: 'reaction:p1:u-ola', kind: 'reaction', actor: author(), postId: 'p1', text: null, createdAt: '2026-10-06T10:00:00.123456+00:00' },
      { id: 'comment:c1', kind: 'comment', actor: author({ id: 'u-marek', name: 'Marek_K' }), postId: 'p1', text: 'Gdzie?', createdAt: '2026-10-06T10:01:00Z' },
      { id: 'x', kind: 'poke', actor: author(), createdAt: '2026-10-06T10:02:00Z' },
      { id: 'friend_request:u-ewa', kind: 'friend_request', actor: author({ id: 'u-ewa', name: 'Ewa' }), postId: null, text: null, createdAt: '2026-10-06T10:03:00Z' },
    ]);
    expect(items.map((a) => [a.kind, a.actor.name, a.postId, a.text])).toEqual([
      ['reaction', 'Ola_W', 'p1', null],
      ['comment', 'Marek_K', 'p1', 'Gdzie?'],
      ['friend_request', 'Ewa', null, null],
    ]);
  });
});

describe('wpisy „wysyłanie…” z telefonu', () => {
  const local = (tripId: string, gminaId = 'suprasl', publishedAt = '2026-10-06T12:00:00Z'): TripPost => ({
    ...(mapPost(tripRow({ id: `local:${tripId}`, tripId, gminaId, mine: true, publishedAt })) as TripPost),
  });

  it('na górze, dopóki serwer nie zwróci wpisu tej wyprawy; potem do usunięcia', () => {
    const server = mapPosts([tripRow({ id: 'p9', tripId: 't9' })]);
    const a = local('t1', 'suprasl', '2026-10-06T12:00:00Z');
    const b = local('t2', 'suprasl', '2026-10-06T13:00:00Z');
    const r = mergeLocalPosts(server, [a, b], 'friends', 'suprasl');
    expect(r.posts.map((p) => p.id)).toEqual(['local:t2', 'local:t1', 'p9']);
    expect(r.confirmed).toEqual([]);

    const synced = mapPosts([tripRow({ id: 'p1', tripId: 't1', mine: true }), tripRow({ id: 'p9', tripId: 't9' })]);
    const r2 = mergeLocalPosts(synced, [a, b], 'friends', 'suprasl');
    expect(r2.posts.map((p) => p.id)).toEqual(['local:t2', 'p1', 'p9']);
    expect(r2.confirmed).toEqual(['t1']);
  });

  it('„Moja gmina” – tylko wpisy z gminy domowej', () => {
    const r = mergeLocalPosts([], [local('t1', 'hajnowka'), local('t2', 'suprasl')], 'gmina', 'suprasl');
    expect(r.posts.map((p) => p.id)).toEqual(['local:t2']);
  });
});

describe('toServiceError', () => {
  const err = (message: string, code = '', status = 400) => toServiceError({ message, code, status });

  it('sieć → NETWORK, P0002 → NOT_FOUND, kody biznesowe → komunikat po polsku', () => {
    expect(err('TypeError: Network request failed', '', 0)).toMatchObject({ code: 'NETWORK' });
    expect(err('Brak odpowiedzi serwera (8 s)', '', 0)).toMatchObject({ code: 'NETWORK' });
    expect(err('post_not_found', 'P0002')).toMatchObject({ code: 'NOT_FOUND', message: 'Ten wpis już nie istnieje' });
    expect(err('cos_innego', 'P0002')).toMatchObject({ code: 'NOT_FOUND' });
    expect(err('invalid_comment', 'P0001')).toMatchObject({ code: 'SERVER', message: 'Komentarz jest pusty albo za długi' });
    expect(err('Could not find the function public.get_activity', 'PGRST202', 404)).toMatchObject({ code: 'SERVER' });
    const generic = err('duplicate key', '23505', 409);
    expect(generic).toBeInstanceOf(ServiceError);
    expect(generic).toMatchObject({ code: 'SERVER', message: expect.stringContaining('Serwer') });
  });
});
