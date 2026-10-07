/**
 * FeedService na Supabase z atrapą klienta: wywołania RPC (kontrakt z docs/backend.md), wpisy „wysyłanie…”
 * z telefonu, błędy sieci. Mapowanie pól – feedMap.test.ts.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import type { Trip } from '@/types';

type Row = Record<string, unknown>;
type Res = { data?: unknown; error?: { message: string; code: string } };

const mockRpc = {
  online: true,
  calls: [] as { fn: string; params: Row }[],
  handlers: {} as Record<string, (p: Row) => Res>,
  reset() {
    this.online = true;
    this.calls = [];
    this.handlers = {};
  },
  respond(fn: string, params: Row) {
    if (!this.online) return { data: null, error: { message: 'TypeError: Network request failed', code: '' }, status: 0 };
    this.calls.push({ fn, params });
    const r = this.handlers[fn]?.(params) ?? { error: { message: `Could not find the function public.${fn}`, code: 'PGRST202' } };
    return r.error ? { data: null, error: r.error, status: 400 } : { data: r.data ?? null, error: null, status: 200 };
  },
};

/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@/geo', () => ({ missingGminy: () => Promise.resolve([]) }));
jest.mock('../client', () => ({
  BACKEND: 'supabase',
  SUPABASE_URL: 'http://test',
  supabaseEnabled: true,
  supabase: {
    rpc: (fn: string, params?: Row) => {
      const p = Promise.resolve().then(() => mockRpc.respond(fn, params ?? {}));
      return Object.assign(p, { abortSignal: () => p });
    },
    auth: {
      getSession: async () => ({ data: { session: { user: { id: 'me' } } } }),
      signInAnonymously: async () => ({ data: { user: { id: 'me' } }, error: null }),
    },
  },
}));

const { createSupabaseFeed } = require('../feed') as typeof import('../feed');
const { publishLocally } = require('../publish') as typeof import('../publish');
const { backendStatus } = require('../status') as typeof import('../status');
const { setOutboxEnabled, useOutboxStore } = require('../../../store/useOutboxStore') as typeof import('../../../store/useOutboxStore');
const { useTripStore } = require('../../../store/useTripStore') as typeof import('../../../store/useTripStore');
const { useUserStore } = require('../../../store/useUserStore') as typeof import('../../../store/useUserStore');
const { ServiceError } = require('../../types') as typeof import('../../types');
/* eslint-enable @typescript-eslint/no-require-imports */

const author = (id: string, name: string) => ({ id, handle: name.toLowerCase(), name, level: 7, avatarPreset: null, ringRarity: 'pospolity' });
const postRow = (id: string, tripId: string | null, mine = false) => ({
  id,
  kind: 'trip',
  author: mine ? author('me', 'Kuba') : author('u-ola', 'Ola_W'),
  gminaId: 'suprasl',
  tripId,
  routePrecision: 'gmina',
  payload: { title: 'Wyprawa po grzyby', distance_km: 2.5, duration_min: 60, mushrooms: 3, species: 2, xp: 120, highlight: null, route: null },
  reactions: 0,
  comments: 0,
  reacted: false,
  mine,
  createdAt: '2026-10-06T10:00:00Z',
  publishedAt: '2026-10-06T10:00:00Z',
  visibleFrom: '2026-10-07T10:00:00Z',
});

const trip: Trip = {
  id: 'trip-1',
  gminaId: 'suprasl',
  status: 'finished',
  startedAt: '2026-10-06T09:00:00.000Z',
  endedAt: '2026-10-06T10:00:00.000Z',
  elapsedMs: 3600_000,
  segmentStartedAt: 0,
  distanceKm: 2.5,
  findIds: [],
  xp: 120,
  hideRoute: false,
};

beforeEach(() => {
  mockRpc.reset();
  setOutboxEnabled(true);
  useOutboxStore.getState().reset();
  useTripStore.getState().reset();
  useUserStore.getState().reset();
  backendStatus().set({ state: 'online', userId: 'me', error: null });
});

describe('FeedService (Supabase)', () => {
  it('własny wpis „wysyłanie…” na górze feedu, aż serwer zwróci wpis tej wyprawy', async () => {
    const feed = createSupabaseFeed();
    useTripStore.getState().upsertTrip(trip);
    const local = await feed.publishTrip(trip, { hideRoute: false });
    useTripStore.getState().upsertTrip({ ...trip, status: 'published', postId: local.id });
    expect(useOutboxStore.getState().items.map((x) => x.type)).toEqual(['trip.publish']);

    mockRpc.handlers.get_feed = () => ({ data: [postRow('p-ola', null)] });
    const before = await feed.getFeed('friends');
    expect(before.map((p) => p.id)).toEqual(['local:trip-1', 'p-ola']);
    expect(mockRpc.calls[0]).toEqual({ fn: 'get_feed', params: { p_scope: 'friends', p_limit: 30 } });
    // Reakcje i komentarze czekają na synchronizację.
    await expect(feed.toggleReaction(local.id)).rejects.toMatchObject({ code: 'SERVER' });
    await expect(feed.getComments(local.id)).resolves.toEqual([]);
    await expect(feed.getPost(local.id)).resolves.toMatchObject({ id: local.id, mine: true });

    mockRpc.handlers.get_feed = () => ({ data: [postRow('p-mine', 'trip-1', true), postRow('p-ola', null)] });
    const after = await feed.getFeed('friends');
    expect(after.map((p) => p.id)).toEqual(['p-mine', 'p-ola']);
    expect(useOutboxStore.getState().localPosts).toEqual([]);
  });

  it('wpis lokalny bez wyprawy w telefonie (inne konto, reset) znika', async () => {
    const feed = createSupabaseFeed();
    useTripStore.getState().upsertTrip(trip);
    publishLocally(trip, true); // wyprawa nie oznaczona jako opublikowana – np. cofnięta
    mockRpc.handlers.get_feed = () => ({ data: [] });
    expect(await feed.getFeed('friends')).toEqual([]);
    expect(useOutboxStore.getState().localPosts).toEqual([]);
  });

  it('komentarz z UUID z telefonu, reakcja z tablicy, zgłoszenie i ukrywanie – parametry RPC', async () => {
    const feed = createSupabaseFeed();
    mockRpc.handlers.add_comment = (p) => ({
      data: { id: p.p_comment_id, postId: p.p_post_id, author: author('me', 'Kuba'), text: p.p_text, createdAt: '2026-10-06T10:00:00Z', mine: true },
    });
    mockRpc.handlers.toggle_reaction = () => ({ data: [{ reacted: true, reactions: 5 }] });
    mockRpc.handlers.report_post = () => ({ data: null });
    mockRpc.handlers.unhide_posts = () => ({ data: null });
    const c = await feed.addComment('p1', '  Darz grzyb!  ', 'c0ffee00-0000-4000-8000-000000000001');
    expect(c).toMatchObject({ id: 'c0ffee00-0000-4000-8000-000000000001', text: 'Darz grzyb!', mine: true });
    expect(await feed.toggleReaction('p1')).toEqual({ reacted: true, reactions: 5 });
    await feed.reportPost('p1', 'c9');
    await feed.unhidePosts();
    expect(mockRpc.calls.map((x) => [x.fn, x.params])).toEqual([
      ['add_comment', { p_post_id: 'p1', p_text: 'Darz grzyb!', p_comment_id: 'c0ffee00-0000-4000-8000-000000000001' }],
      ['toggle_reaction', { p_post_id: 'p1' }],
      ['report_post', { p_post_id: 'p1', p_comment_id: 'c9', p_reason: null }],
      ['unhide_posts', { p_post_ids: null }],
    ]);
  });

  it('znajomi: zaproszenie → status z serwera w grzybiarzu z wyszukiwarki; profil po nicku', async () => {
    const feed = createSupabaseFeed();
    mockRpc.handlers.search_users = () => ({ data: [{ ...author('u-ewa', 'Ewa'), homeGminaId: 'suprasl', tripsCount: 4, mushroomsCount: 9, friendStatus: 'none' }] });
    mockRpc.handlers.send_friend_request = () => ({ data: 'outgoing' });
    mockRpc.handlers.get_user_by_handle = (p) => ({ data: p.p_handle === 'ewa' ? { ...author('u-ewa', 'Ewa'), friendStatus: 'outgoing' } : null });
    const [ewa] = await feed.searchUsers(' ew ');
    expect(mockRpc.calls[0].params).toEqual({ p_query: 'ew', p_limit: 20 });
    const sent = await feed.addFriend(ewa.id);
    expect(sent).toMatchObject({ id: 'u-ewa', name: 'Ewa', friendStatus: 'outgoing', friend: false, tripsCount: 4 });
    expect(mockRpc.calls.map((x) => x.fn)).toEqual(['search_users', 'send_friend_request']); // bez dodatkowego get_user
    expect(await feed.getUserByHandle('%40Ewa')).toMatchObject({ id: 'u-ewa', friendStatus: 'outgoing' });
    expect(await feed.getUserByHandle('nikt')).toBeNull();
  });

  it('bez sieci – ServiceError NETWORK (bez cichego powrotu do mocków); brak funkcji – SERVER', async () => {
    const feed = createSupabaseFeed();
    mockRpc.online = false;
    const err = await feed.getFeed('gmina').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ServiceError);
    expect(err).toMatchObject({ code: 'NETWORK' });
    mockRpc.online = true;
    await expect(feed.getActivity!()).rejects.toMatchObject({ code: 'SERVER' });
  });
});
