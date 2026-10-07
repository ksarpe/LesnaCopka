/**
 * Feed, komentarze, ukryte wpisy, zgłoszenia, znajomi (zaproszenia w obie strony) i aktywność – na RPC Supabase.
 * Mapowanie odpowiedzi: ./feedMap.ts (czyste funkcje). Bez sieci metody rzucają ServiceError('NETWORK') –
 * ekrany pokazują swoje stany offline (bez cichego powrotu do mocków).
 *
 * Wyjątek – publikacja: idzie przez kolejkę synchronizacji (./publish.ts), więc działa offline, a feed pokazuje
 * własny wpis „wysyłanie…”, dopóki serwer go nie zwróci. Na takim wpisie reakcje i komentarze czekają.
 */
import { useOutboxStore } from '@/store/useOutboxStore';
import { useTripStore } from '@/store/useTripStore';
import { useUserStore } from '@/store/useUserStore';
import type { Post, SocialUser, TripPost } from '@/types';
import { uuid } from '@/utils/random';
import { handleFromInvite, isLocalPost, prepareComment } from '@/utils/social';
import { claimedFindsOf, coverFind } from '@/utils/tripPost';
import { ServiceError, type FeedService } from '../types';
import { describeCounts, devCall as devRpc, one, resolveGminy, serviceCall as call } from './api';
import {
  mapActivity,
  mapBlockedUsers,
  mapComment,
  mapComments,
  mapFriendsOverview,
  mapFriendStatus,
  mapPost,
  mapPosts,
  mapReaction,
  mapSocialUser,
  mapSocialUsers,
  mergeLocalPosts,
  type PostMapContext,
} from './feedMap';
import { publishLocally } from './publish';

/** Wpisów na stronę feedu (serwer ogranicza do 50). */
const FEED_LIMIT = 30;
const SEARCH_LIMIT = 20;
const ACTIVITY_LIMIT = 30;

const PENDING_POST = 'Wpis jeszcze się wysyła – reakcje i komentarze po synchronizacji';

/** Okładka własnego wpisu (zdjęcie znaleziska z telefonu) i avatar gracza. */
function mapContext(): PostMapContext {
  const { trips, finds } = useTripStore.getState();
  return {
    selfAvatar: useUserStore.getState().user.avatar,
    coverFindId: (tripId) => {
      const trip = trips[tripId];
      return trip ? coverFind(claimedFindsOf(trip, finds))?.id : undefined;
    },
  };
}


const localPost = (postId: string): TripPost | undefined => useOutboxStore.getState().localPosts.find((p) => p.id === postId);

export function createSupabaseFeed(): FeedService {
  /** Ostatnio widziani grzybiarze – odpowiedź na zaproszenie bez dodatkowego zapytania o profil. */
  const seen = new Map<string, SocialUser>();
  const remember = (users: SocialUser[]) => {
    users.forEach((u) => seen.set(u.id, u));
    resolveGminy(users.map((u) => u.homeGminaId));
    return users;
  };

  async function getFeed(scope: Parameters<FeedService['getFeed']>[0]): Promise<Post[]> {
    const server = mapPosts(await call('get_feed', { p_scope: scope, p_limit: FEED_LIMIT }), mapContext());
    const ob = useOutboxStore.getState();
    const trips = useTripStore.getState().trips;
    // Wpisy czekające na serwer, których wyprawy już nie ma (inne konto, reset gracza) albo publikację cofnięto.
    const stale = ob.localPosts.filter((p) => !p.tripId || trips[p.tripId]?.status !== 'published').map((p) => p.tripId ?? '');
    const local = ob.localPosts.filter((p) => !stale.includes(p.tripId ?? ''));
    const { posts, confirmed } = mergeLocalPosts(server, local, scope, useUserStore.getState().user.homeGminaId);
    if (confirmed.length || stale.length) ob.removeLocalPosts([...confirmed, ...stale]);
    resolveGminy(posts.map((p) => p.gminaId));
    return posts;
  }

  async function getUser(userId: string): Promise<SocialUser> {
    const u = mapSocialUser(one(await call('get_user', { p_user_id: userId })));
    if (!u) throw new ServiceError('NOT_FOUND', 'Nie znaleziono grzybiarza');
    return remember([u])[0];
  }

  const feed: FeedService = {
    twoSidedFriends: true,
    getFeed,
    // Pull-to-refresh = feed od nowa (serwer zwraca najnowsze wpisy na górze).
    loadNewer: getFeed,

    async publishTrip(trip, { hideRoute }) {
      return publishLocally(trip, hideRoute);
    },

    async toggleReaction(postId) {
      if (isLocalPost(postId)) throw new ServiceError('SERVER', PENDING_POST);
      return mapReaction(await call('toggle_reaction', { p_post_id: postId }));
    },

    async getPost(postId) {
      if (isLocalPost(postId)) {
        const p = localPost(postId);
        if (!p) throw new ServiceError('NOT_FOUND', 'Ten wpis już nie istnieje');
        return p;
      }
      const post = mapPost(one(await call('get_post', { p_post_id: postId })), mapContext());
      if (!post) throw new ServiceError('NOT_FOUND', 'Ten wpis już nie istnieje');
      resolveGminy([post.gminaId]);
      return post;
    },

    /* ── Komentarze ── */

    async getComments(postId) {
      if (isLocalPost(postId)) return [];
      return mapComments(await call('get_comments', { p_post_id: postId }), mapContext());
    },
    async addComment(postId, raw, clientId) {
      const text = prepareComment(raw);
      if (!text) throw new ServiceError('SERVER', 'Pusty komentarz');
      if (isLocalPost(postId)) throw new ServiceError('SERVER', PENDING_POST);
      // UUID z telefonu: ponowienie po zerwanym połączeniu nie dubluje komentarza.
      const data = await call('add_comment', { p_post_id: postId, p_text: text, p_comment_id: clientId ?? uuid() });
      const comment = mapComment(one(data), mapContext());
      if (!comment) throw new ServiceError('SERVER', 'Nieprawidłowa odpowiedź serwera');
      return comment;
    },
    async deleteComment(_postId, commentId) {
      await call('delete_comment', { p_comment_id: commentId });
    },

    /* ── Ukryte wpisy, zgłoszenia ── */

    async hidePost(postId) {
      await call('hide_post', { p_post_id: postId });
    },
    async unhidePosts(postIds) {
      await call('unhide_posts', { p_post_ids: postIds ?? null });
    },
    async getHiddenPosts() {
      return mapPosts(await call('get_hidden_posts'), mapContext());
    },
    async reportPost(postId, commentId) {
      if (isLocalPost(postId)) return;
      await call('report_post', { p_post_id: postId, p_comment_id: commentId ?? null, p_reason: null });
    },

    /* ── Znajomi ── */

    async getFriendsOverview() {
      const o = mapFriendsOverview(await call('get_friends'));
      remember([...o.friends, ...o.incoming, ...o.outgoing]);
      return o;
    },
    async getFriends() {
      return (await feed.getFriendsOverview()).friends;
    },
    async searchUsers(query) {
      return remember(mapSocialUsers(await call('search_users', { p_query: query.trim(), p_limit: SEARCH_LIMIT })));
    },
    getUser,
    async getUserByHandle(handle) {
      const h = handleFromInvite(handle);
      if (!h) return null;
      const u = mapSocialUser(one(await call('get_user_by_handle', { p_handle: h })));
      return u ? remember([u])[0] : null;
    },
    async addFriend(userId) {
      const status = mapFriendStatus(await call('send_friend_request', { p_user_id: userId }));
      const known = seen.get(userId) ?? (await getUser(userId));
      const user: SocialUser = { ...known, friendStatus: status, friend: status === 'friends' };
      seen.set(userId, user);
      return user;
    },
    async respondFriendRequest(userId, accept) {
      return mapFriendStatus(await call('respond_friend_request', { p_user_id: userId, p_accept: accept }));
    },
    async removeFriend(userId) {
      await call('remove_friend', { p_user_id: userId });
    },

    /* ── Blokowanie (etap 6) ── */

    async blockUser(userId) {
      await call('block_user', { p_user_id: userId });
      const known = seen.get(userId);
      if (known) seen.set(userId, { ...known, blocked: true, friendStatus: 'none', friend: false });
    },
    async unblockUser(userId) {
      await call('unblock_user', { p_user_id: userId });
      const known = seen.get(userId);
      if (known) seen.set(userId, { ...known, blocked: false });
    },
    async getBlockedUsers() {
      return mapBlockedUsers(await call('get_blocked_users'));
    },

    /* ── Aktywność (powiadomienia) ── */

    async getActivity(since) {
      return mapActivity(await call('get_activity', { p_since: since ?? null, p_limit: ACTIVITY_LIMIT }));
    },
  };
  return feed;
}

/* ───────────────────────── Panel /dev ───────────────────────── */

export interface DevSocialResult {
  ok: boolean;
  message: string;
}

async function devCall(fn: string): Promise<DevSocialResult> {
  const r = await devRpc(fn, undefined, 'etapu 3');
  return r.ok ? { ok: true, message: describeCounts(r.data) } : { ok: r.ok, message: r.message };
}

/** „Dodaj testowych grzybiarzy”: boty z wpisami, część znajomych, zaproszenia do gracza. */
export const devSeedSocial = () => devCall('dev_seed_social');

/** „Grzybiarze reagują”: boty reagują i komentują wpisy gracza, wysyłają / przyjmują zaproszenia. */
export const devBotsAct = () => devCall('dev_bots_act');
