/**
 * Mock społecznej części feedu: komentarze, ukrywanie wpisów, znajomi, wyszukiwarka grzybiarzy i blokowanie.
 * Stan w „bazie” mocków (useMockDb) – reset z panelu /dev czyści go razem z postami.
 *
 * Blokada działa jak na serwerze (docs/backend.md → „Blokowanie”): wpisy i komentarze zablokowanego znikają z feedu,
 * komentarzy i wyszukiwarki, jego wpis „nie istnieje”, znajomość znika, a zaproszenie jest odrzucane.
 */
import { commentCount, dueFriendComments, generateComments } from '@/data/mock/comments';
import { friendPosts, insertByDate, playerById, PLAYERS, toAuthor, type MockPlayer } from '@/data/mock/social';
import { useUserStore } from '@/store/useUserStore';
import type { BlockedUser, Post, PostAuthor, PostComment, SocialUser } from '@/types';
import { makeId } from '@/utils/random';
import { matchesUserQuery, matchRank, prepareComment } from '@/utils/social';
import { ServiceError, type FeedService } from '../types';
import { useMockDb } from './db';
import { net } from './net';

type SocialApi = Omit<FeedService, 'getFeed' | 'loadNewer' | 'publishTrip' | 'toggleReaction'>;

const db = () => useMockDb.getState();
const COMMENT_AUTHORS = PLAYERS.map(toAuthor);
const byDate = (a: PostComment, b: PostComment) => a.createdAt.localeCompare(b.createdAt);

function findPost(postId: string): Post {
  const p = db().posts.find((x) => x.id === postId);
  // Wpis zablokowanego – jak na serwerze „nie istnieje”.
  if (!p || !notBlocked(p)) throw new ServiceError('NOT_FOUND', 'Ten wpis już nie istnieje');
  return p;
}

function findPlayer(userId: string): MockPlayer {
  const p = playerById(userId);
  if (!p) throw new ServiceError('NOT_FOUND', 'Nie znaleziono grzybiarza');
  return p;
}

/** Czy gracz zablokował grzybiarza (mock: blokada tylko po stronie gracza – boty nikogo nie blokują). */
export const isBlocked = (userId: string) => db().blocked.some((b) => b.id === userId);

/** Wpis widoczny mimo blokad (autor niezablokowany). */
export const notBlocked = (p: Post) => !isBlocked(p.author.id);

/** Liczba komentarzy wpisu bez komentarzy zablokowanych (tylko gdy lista już jest w „bazie”). */
export function visibleCommentCount(p: Post): Post {
  if (p.kind !== 'trip') return p;
  const stored = db().comments[p.id];
  if (!stored || !db().blocked.length) return p;
  return { ...p, comments: stored.filter((c) => !isBlocked(c.author.id)).length };
}

/** Mock nie ma zaproszeń: dodanie znajomego działa od razu (grzybiarze z puli „akceptują natychmiast”). */
const toSocial = (p: MockPlayer): SocialUser => {
  const friend = db().friendIds.includes(p.id);
  const user: SocialUser = { ...p, friend, friendStatus: friend ? 'friends' : 'none' };
  if (isBlocked(p.id)) user.blocked = true;
  return user;
};

function playerAuthor(): PostAuthor {
  const u = useUserStore.getState().user;
  return { id: u.id, name: u.firstName, level: u.level, ringRarity: 'primary' };
}

/** Komentarze wpisu: przy pierwszym odczycie generowane („serwer” je ma) i od tej chwili trwałe. */
function ensureComments(post: Post): PostComment[] {
  const stored = db().comments[post.id];
  if (stored) return stored;
  const list = generateComments(post, commentCount(post), COMMENT_AUTHORS, Date.now());
  db().set({ comments: { ...db().comments, [post.id]: list } });
  return list;
}

/** Zapis listy + licznik `comments` wpisu (feed pokazuje go bez pobierania komentarzy). */
function saveComments(postId: string, list: PostComment[]) {
  const s = db();
  s.set({
    comments: { ...s.comments, [postId]: list },
    posts: s.posts.map((p) => (p.id === postId && p.kind === 'trip' ? { ...p, comments: list.length } : p)),
  });
}

/**
 * Znajomi komentują wpisy gracza, gdy te staną się dla nich widoczne (po 24 h) –
 * „dopisujemy” komentarze, które do teraz by padły. Wołane przy pobieraniu feedu i komentarzy.
 */
export function settleOwnPosts(now = Date.now()) {
  const s = db();
  const friends = s.friendIds.map(playerById).filter((p): p is MockPlayer => !!p).map(toAuthor);
  for (const p of s.posts) {
    if (p.kind !== 'trip' || !p.mine || new Date(p.visibleFrom).getTime() > now) continue;
    const due = dueFriendComments(p, friends, now);
    if (!due.length) continue;
    const list = ensureComments(p);
    const fresh = due.filter((c) => !list.some((x) => x.id === c.id));
    if (fresh.length) saveComments(p.id, [...list, ...fresh].sort(byDate));
  }
}

export const mockSocial: SocialApi = {
  async getPost(postId) {
    await net(`post:${postId}`, 300, 700);
    settleOwnPosts();
    return visibleCommentCount(findPost(postId));
  },

  /* ── Komentarze ── */

  async getComments(postId) {
    await net(`comments:${postId}`, 400, 900);
    settleOwnPosts();
    return ensureComments(findPost(postId)).filter((c) => !isBlocked(c.author.id));
  },
  async addComment(postId, raw) {
    const text = prepareComment(raw);
    if (!text) throw new Error('Pusty komentarz');
    await net(`comment:${postId}:${text.length}`, 350, 800);
    const post = findPost(postId);
    const comment: PostComment = {
      id: makeId('c'),
      postId,
      author: playerAuthor(),
      text,
      createdAt: new Date().toISOString(),
      mine: true,
    };
    saveComments(postId, [...ensureComments(post), comment]);
    return comment;
  },
  async deleteComment(postId, commentId) {
    await net(`uncomment:${commentId}`, 250, 600);
    const list = ensureComments(findPost(postId));
    const c = list.find((x) => x.id === commentId);
    if (!c) throw new ServiceError('NOT_FOUND', 'Komentarz już nie istnieje');
    if (!c.mine) throw new ServiceError('PERMISSION', 'Możesz usuwać tylko własne komentarze');
    saveComments(postId, list.filter((x) => x.id !== commentId));
  },

  /* ── Ukryte wpisy ── */

  async hidePost(postId) {
    await net(`hide:${postId}`, 200, 450);
    const s = db();
    if (!s.hiddenPostIds.includes(postId)) s.set({ hiddenPostIds: [postId, ...s.hiddenPostIds] });
  },
  async unhidePosts(postIds) {
    await net('unhide', 250, 550);
    const s = db();
    s.set({ hiddenPostIds: postIds ? s.hiddenPostIds.filter((id) => !postIds.includes(id)) : [] });
  },
  async getHiddenPosts() {
    await net('hidden', 200, 450);
    const s = db();
    return s.posts.filter((p) => s.hiddenPostIds.includes(p.id) && notBlocked(p));
  },
  async reportPost(postId) {
    // Zgłoszenie tylko „wysyłamy” – mock nie ma moderacji.
    await net(`report:${postId}`, 250, 600);
  },

  /* ── Znajomi ── */

  async getFriends() {
    await net('friends', 350, 800);
    return db()
      .friendIds.map(playerById)
      .filter((p): p is MockPlayer => !!p && !isBlocked(p.id))
      .map(toSocial);
  },
  async getFriendsOverview() {
    return { friends: await mockSocial.getFriends(), incoming: [], outgoing: [] };
  },
  async searchUsers(query) {
    await net(`search:${query}`, 250, 600);
    const q = query.trim();
    if (!q) {
      // Propozycje: spoza znajomych, najpierw z gminy gracza, potem wg poziomu.
      const home = useUserStore.getState().user.homeGminaId;
      const friends = db().friendIds;
      return PLAYERS.filter((p) => !friends.includes(p.id) && !isBlocked(p.id))
        .sort((a, b) => Number(b.homeGminaId === home) - Number(a.homeGminaId === home) || b.level - a.level)
        .slice(0, 5)
        .map(toSocial);
    }
    return PLAYERS.filter((p) => matchesUserQuery(p, q) && !isBlocked(p.id))
      .sort((a, b) => matchRank(a, q) - matchRank(b, q) || a.name.localeCompare(b.name, 'pl'))
      .slice(0, 20)
      .map(toSocial);
  },
  async getUser(userId) {
    await net(`user:${userId}`, 200, 450);
    return toSocial(findPlayer(userId));
  },
  async getUserByHandle(handle) {
    await net(`handle:${handle}`, 200, 450);
    const h = handle.replace(/^@+/, '').trim().toLowerCase();
    const p = PLAYERS.find((x) => x.handle.replace(/^@+/, '').toLowerCase() === h);
    return p ? toSocial(p) : null;
  },
  async addFriend(userId) {
    await net(`follow:${userId}`, 300, 700);
    const player = findPlayer(userId);
    if (isBlocked(userId)) throw new ServiceError('SERVER', 'Odblokuj tę osobę, żeby zaprosić ją do znajomych');
    const s = db();
    if (!s.friendIds.includes(userId)) s.set({ friendIds: [userId, ...s.friendIds] });
    // Nowy znajomy bez wpisów dla znajomych → jego dwa ostatnie wpisy trafiają do feedu.
    const hasPosts = s.posts.some((p) => p.author.id === userId && p.scopes.includes('friends'));
    if (!hasPosts) db().set({ posts: insertByDate(db().posts, friendPosts(player, Date.now())) });
    return toSocial(player);
  },
  async respondFriendRequest(userId, accept) {
    // Mock nie ma przychodzących zaproszeń – akceptacja działa jak dodanie znajomego.
    if (!accept) {
      await net(`reject:${userId}`, 250, 600);
      return 'none';
    }
    return (await mockSocial.addFriend(userId)).friendStatus;
  },
  async removeFriend(userId) {
    await net(`unfollow:${userId}`, 300, 700);
    const s = db();
    s.set({ friendIds: s.friendIds.filter((id) => id !== userId) });
  },

  /* ── Blokowanie ── */

  async blockUser(userId) {
    await net(`block:${userId}`, 250, 600);
    findPlayer(userId);
    const s = db();
    s.set({
      blocked: [{ id: userId, at: new Date().toISOString() }, ...s.blocked.filter((b) => b.id !== userId)],
      // Znajomość znika (jak block_user na serwerze); odblokowanie jej nie przywraca.
      friendIds: s.friendIds.filter((id) => id !== userId),
    });
  },
  async unblockUser(userId) {
    await net(`unblock:${userId}`, 250, 600);
    const s = db();
    s.set({ blocked: s.blocked.filter((b) => b.id !== userId) });
  },
  async getBlockedUsers() {
    await net('blocked', 200, 450);
    return db().blocked.flatMap((b): BlockedUser[] => {
      const p = playerById(b.id);
      return p ? [{ ...toAuthor(p), handle: p.handle, blockedAt: b.at }] : [];
    });
  },
};
