/**
 * „Serwer” mocków – trwały stan, który w prawdziwej aplikacji żyłby w backendzie
 * (posty, reakcje). Znika po podpięciu API.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { initialPosts } from '@/data/mock/feed';
import { persistStorage, STORAGE_KEYS } from '@/store/storage';
import type { Post } from '@/types';

interface MockDbState {
  posts: Post[];
  refreshCount: number;
  set: (patch: Partial<Pick<MockDbState, 'posts' | 'refreshCount'>>) => void;
  reset: (opts?: { emptyFeed?: boolean }) => void;
}

export const useMockDb = create<MockDbState>()(
  persist(
    (set) => ({
      posts: initialPosts(Date.now()),
      refreshCount: 0,
      set: (patch) => set(patch),
      reset: (opts) => set({ posts: opts?.emptyFeed ? [] : initialPosts(Date.now()), refreshCount: 0 }),
    }),
    { name: STORAGE_KEYS.mockDb, storage: persistStorage, version: 1 },
  ),
);
