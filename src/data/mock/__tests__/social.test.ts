import { describe, expect, it } from '@jest/globals';

import { commentCount, dueFriendComments, generateComments } from '../comments';
import { initialPosts, refreshPool } from '../feed';
import { GMINY } from '../gminy';
import { DEFAULT_FRIEND_IDS, friendPosts, insertByDate, PLAYERS, toAuthor } from '../social';
import type { Post, TripPost } from '../../../types';

const NOW = new Date(2026, 9, 6, 12).getTime();
const H = 3600_000;
const AUTHORS = PLAYERS.map(toAuthor);

describe('pula grzybiarzy', () => {
  it('~15 osób, unikalne id i handle, gminy z danych gry', () => {
    expect(PLAYERS.length).toBeGreaterThanOrEqual(15);
    expect(new Set(PLAYERS.map((p) => p.id)).size).toBe(PLAYERS.length);
    expect(new Set(PLAYERS.map((p) => p.handle)).size).toBe(PLAYERS.length);
    const gminy = new Set(GMINY.map((g) => g.id));
    PLAYERS.forEach((p) => expect(gminy.has(p.homeGminaId)).toBe(true));
  });

  it('domyślni znajomi odtwarzają zakładkę „Znajomi” z makiety (start i pull-to-refresh)', () => {
    const friendScoped = [...initialPosts(NOW), ...refreshPool(NOW)].filter((p) => p.scopes.includes('friends'));
    friendScoped.forEach((p) => expect(DEFAULT_FRIEND_IDS).toContain(p.author.id));
    DEFAULT_FRIEND_IDS.forEach((id) => expect(PLAYERS.some((p) => p.id === id)).toBe(true));
  });
});

describe('wpisy nowego znajomego', () => {
  const g77 = PLAYERS.find((p) => p.id === 'u-g77')!;

  it('dwa deterministyczne wpisy w zakresie „Znajomi”, z przeszłości', () => {
    const a = friendPosts(g77, NOW);
    expect(a).toEqual(friendPosts(g77, NOW));
    expect(a).toHaveLength(2);
    a.forEach((p) => {
      expect(p.author.id).toBe(g77.id);
      expect(p.scopes).toContain('friends');
      expect(new Date(p.createdAt).getTime()).toBeLessThan(NOW);
      expect(new Date(p.visibleFrom).getTime()).toBeLessThanOrEqual(NOW);
    });
  });

  it('insertByDate wstawia przed pierwszy starszy wpis', () => {
    const at = (h: number) => new Date(NOW - h * H).toISOString();
    const mk = (id: string, h: number) => ({ ...initialPosts(NOW)[2], id, createdAt: at(h) }) as Post;
    const out = insertByDate([mk('a', 1), mk('b', 5), mk('c', 3)], [mk('x', 2), mk('y', 10)]);
    expect(out.map((p) => p.id)).toEqual(['a', 'x', 'b', 'c', 'y']);
  });
});

describe('generowane komentarze', () => {
  const trips = initialPosts(NOW).filter((p): p is TripPost => p.kind === 'trip');

  it('liczba = licznik wpisu, deterministycznie, bez autora wpisu', () => {
    trips.forEach((post) => {
      const list = generateComments(post, commentCount(post), AUTHORS, NOW);
      expect(list).toHaveLength(post.comments);
      expect(list).toEqual(generateComments(post, commentCount(post), AUTHORS, NOW));
      expect(new Set(list.map((c) => c.id)).size).toBe(list.length);
      list.forEach((c) => {
        expect(c.postId).toBe(post.id);
        expect(c.author.id).not.toBe(post.author.id);
        expect(c.text.length).toBeGreaterThan(0);
      });
      for (let i = 1; i < list.length; i++) expect(list[i].author.id).not.toBe(list[i - 1].author.id);
    });
  });

  it('czasy rosnąco, po publikacji i przed „teraz”', () => {
    trips.forEach((post) => {
      const from = new Date(post.visibleFrom).getTime();
      const times = generateComments(post, commentCount(post), AUTHORS, NOW).map((c) => new Date(c.createdAt).getTime());
      times.forEach((t, i) => {
        expect(t).toBeGreaterThan(from);
        expect(t).toBeLessThanOrEqual(NOW);
        if (i > 0) expect(t).toBeGreaterThanOrEqual(times[i - 1]);
      });
    });
  });

  it('świeży wpis z wieloma komentarzami też mieści się w oknie', () => {
    const fresh = { ...trips[0], id: 'p-fresh', createdAt: new Date(NOW - 60_000).toISOString(), visibleFrom: new Date(NOW - 60_000).toISOString() };
    const list = generateComments(fresh, 12, AUTHORS, NOW);
    expect(list).toHaveLength(12);
    list.forEach((c) => expect(new Date(c.createdAt).getTime()).toBeLessThanOrEqual(NOW));
  });

  it('wpisy bez komentarzy (krótkie, awans) – pusta lista', () => {
    const compact = initialPosts(NOW).find((p) => p.kind === 'compact')!;
    expect(commentCount(compact)).toBe(0);
    expect(generateComments(compact, 0, AUTHORS, NOW)).toEqual([]);
  });
});

describe('komentarze znajomych pod wpisem gracza', () => {
  const own: TripPost = {
    ...(initialPosts(NOW)[0] as TripPost),
    id: 'post_own',
    mine: true,
    comments: 0,
    visibleFrom: new Date(NOW + 24 * H).toISOString(),
  };
  const friends = AUTHORS.slice(0, 3);

  it('nikt nie komentuje, zanim wpis stanie się widoczny (24 h)', () => {
    expect(dueFriendComments(own, friends, NOW)).toEqual([]);
    expect(dueFriendComments(own, [], NOW + 48 * H)).toEqual([]);
  });

  it('po czasie 1–3 komentarze, stabilne id, tylko od znajomych', () => {
    const later = dueFriendComments(own, friends, NOW + 48 * H);
    expect(later.length).toBeGreaterThanOrEqual(1);
    expect(later.length).toBeLessThanOrEqual(3);
    later.forEach((c) => expect(friends.map((f) => f.id)).toContain(c.author.id));
    const early = dueFriendComments(own, friends, NOW + 24 * H + 30 * 60_000);
    expect(early.length).toBeLessThanOrEqual(1);
    early.forEach((c, i) => expect(c).toEqual(later[i]));
  });
});
