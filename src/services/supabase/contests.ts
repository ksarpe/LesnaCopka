/**
 * Walki o okaz z serwera (RPC z migracji 20261015110000_rywalizacja.sql, docs/rywalizacja.md §7). Mapowanie odpowiedzi:
 * ./contestsMap.ts (czyste funkcje). Bez sieci metody rzucają ServiceError('NETWORK') – ekrany pokazują stany offline,
 * bez cichego powrotu do mocków. Odmowy serwera (P0001 / P0002) mają polski powód w `detail` – serviceCall (toServiceError
 * w ./feedMap.ts) przekazuje go do komunikatu błędu.
 *
 * Zdjęcia okazów (`photoPath` w prywatnym `scan-photos`) podpisuje ekran: znacznik `sb-photo:` (utils/contests.ts →
 * entryPhotoUri) → useFindPhotoSource → ./remotePhotos.ts (zbiorcze podpisane adresy z pamięcią do godziny).
 */
import { useCatalogStore } from '@/store/useCatalogStore';
import { useUserStore } from '@/store/useUserStore';
import type { ContestService } from '../types';
import { one, resolveGminy, serviceCall as call } from './api';
import { mapContestBoard, mapContestEligibility, mapContestWeek, mapTrophyCase, type ContestMapContext } from './contestsMap';

/** Nazwy gatunków z katalogu (tytuły walk gatunku z odmianą) i avatar gracza z telefonu (jego okazy na tablicach). */
const ctx = (): ContestMapContext => {
  const byId = useCatalogStore.getState().speciesById;
  return { speciesName: (id) => byId[id]?.name, selfAvatar: useUserStore.getState().user.avatar };
};

export function createSupabaseContests(): ContestService {
  return {
    live: true,
    async getContestWeek(weekStart) {
      const data = await call('get_contest_week', { p_week_start: weekStart ?? null });
      return mapContestWeek(one(data), ctx());
    },
    async getContestBoard(contestId, scope, scopeId) {
      const data = await call('get_contest_board', { p_contest_id: contestId, p_scope: scope, p_scope_id: scopeId ?? null });
      const board = mapContestBoard(one(data), { contestId, scope, scopeId }, ctx());
      // Gminy okazów (zasięgi publiczne) – nazwy do katalogu z indeksu PRG, w tle.
      resolveGminy([...board.entries.map((e) => e.gminaId), board.mine?.gminaId ?? '']);
      return board;
    },
    async getContestEligibility(findId) {
      return mapContestEligibility(one(await call('get_contest_eligibility', { p_find_id: findId })), findId, ctx());
    },
    async enterContest(findId) {
      return mapContestEligibility(one(await call('enter_contest', { p_find_id: findId })), findId, ctx());
    },
    async withdrawContestEntry(contestId) {
      await call('withdraw_contest_entry', { p_contest_id: contestId });
    },
    async reportContestEntry(entryId, reason) {
      await call('report_contest_entry', { p_entry_id: entryId, p_reason: reason ?? null });
    },
    async getTrophies(userId) {
      return mapTrophyCase(one(await call('get_trophies', { p_user: userId ?? null })), ctx());
    },
  };
}
