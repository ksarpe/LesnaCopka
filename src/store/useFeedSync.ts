import { create } from 'zustand';

/**
 * Most między feedem a ekranami Komentarze / Znajomi (bez persist – źródłem prawdy jest serwis).
 * Feed po powrocie od razu nakłada nowe liczniki komentarzy, a gdy zmienili się znajomi
 * albo ukryte wpisy – pobiera listę ponownie (po cichu, bez szkieletów).
 */
interface FeedSyncState {
  /** postId → aktualna liczba komentarzy (zmieniona poza feedem). */
  commentCounts: Record<string, number>;
  /** Lista wpisów feedu jest nieaktualna (znajomi, ukryte wpisy). */
  stale: boolean;
  setCommentCount: (postId: string, count: number) => void;
  markStale: () => void;
  /** Reset danych serwera (panel /dev): stare liczniki do kosza, feed pobierze wszystko od nowa. */
  invalidate: () => void;
  /** Odbiera zaległe zmiany i czyści je. */
  take: () => { commentCounts: Record<string, number>; stale: boolean };
}

export const useFeedSync = create<FeedSyncState>()((set, get) => ({
  commentCounts: {},
  stale: false,
  setCommentCount: (postId, count) => set((s) => ({ commentCounts: { ...s.commentCounts, [postId]: count } })),
  markStale: () => set({ stale: true }),
  invalidate: () => set({ commentCounts: {}, stale: true }),
  take: () => {
    const { commentCounts, stale } = get();
    set({ commentCounts: {}, stale: false });
    return { commentCounts, stale };
  },
}));
