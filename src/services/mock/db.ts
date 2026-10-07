/**
 * „Serwer” mocków – trwały stan, który w prawdziwej aplikacji żyłby w backendzie
 * (posty, reakcje, komentarze, ukryte wpisy, znajomi). Znika po podpięciu API.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { initialPosts } from '@/data/mock/feed';
import { DEFAULT_FRIEND_IDS } from '@/data/mock/social';
import { persistStorage, STORAGE_KEYS } from '@/store/storage';
import type { Post, PostComment } from '@/types';

type DbData = {
  posts: Post[];
  refreshCount: number;
  /**
   * Komentarze wpisów, które ktoś już otworzył. Pozostałe generują się przy pierwszym odczycie
   * (tyle, ile wynosi `post.comments`), potem `post.comments` = długość listy.
   */
  comments: Record<string, PostComment[]>;
  /** Wpisy ukryte przez gracza („Ukryj wpis”). */
  hiddenPostIds: string[];
  /** Znajomi gracza (id z puli PLAYERS) – od najnowszego. */
  friendIds: string[];
  /** Zablokowani przez gracza (id z puli PLAYERS) – od ostatnio zablokowanego. */
  blocked: { id: string; at: string }[];
};

interface MockDbState extends DbData {
  set: (patch: Partial<DbData>) => void;
  reset: (opts?: { emptyFeed?: boolean }) => void;
}

function initialData(emptyFeed?: boolean): DbData {
  return {
    posts: emptyFeed ? [] : initialPosts(Date.now()),
    refreshCount: 0,
    comments: {},
    hiddenPostIds: [],
    // Nowy użytkownik nie ma jeszcze znajomych („Dodaj znajomych” w pustym feedzie).
    friendIds: emptyFeed ? [] : [...DEFAULT_FRIEND_IDS],
    blocked: [],
  };
}

export const useMockDb = create<MockDbState>()(
  persist(
    (set) => ({
      ...initialData(),
      set: (patch) => set(patch),
      reset: (opts) => set(initialData(opts?.emptyFeed)),
    }),
    // Nowe pola (komentarze, ukryte, znajomi, zablokowani) dopełnia domyślny merge persist – bez migracji.
    { name: STORAGE_KEYS.mockDb, storage: persistStorage, version: 1 },
  ),
);
