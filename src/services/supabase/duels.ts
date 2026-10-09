/**
 * Pojedynki i ranking grzybiarzy z serwera (RPC z migracji 20261015110000_rywalizacja.sql, docs/rywalizacja.md §7).
 * Mapowanie odpowiedzi: ./duelsMap.ts (czyste funkcje). Pojedynki działają tylko z siecią (bez kolejki) – bez niej
 * ServiceError('NETWORK'); odmowy serwera (P0001 z polskim `detail`: nie jesteście znajomymi, limit…) – 'SERVER'
 * z tym opisem (./feedMap.ts → toServiceError).
 */
import { useUserStore } from '@/store/useUserStore';
import { isUuid, uuid } from '@/utils/random';
import { ServiceError, type DuelService } from '../types';
import { describeCounts, devCall, one, serviceCall as call } from './api';
import { mapDuel, mapDuelsOverview, mapPlayerRanking, mapRivalryStatus, type DuelMapContext } from './duelsMap';

const ctx = (): DuelMapContext => ({ selfAvatar: useUserStore.getState().user.avatar });

/** Id spoza formatu UUID (np. stary link z mocków) – serwer i tak by go nie znalazł (22P02); bez zapytania. */
function checkId(duelId: string) {
  if (!isUuid(duelId)) throw new ServiceError('NOT_FOUND', 'Nie ma takiego pojedynku');
}

function duelOrThrow(data: unknown) {
  const d = mapDuel(one(data), ctx());
  if (!d) throw new ServiceError('SERVER', 'Nieprawidłowa odpowiedź serwera');
  return d;
}

export function createSupabaseDuels(): DuelService {
  return {
    live: true,
    async getDuels() {
      return mapDuelsOverview(await call('get_duels'), ctx());
    },
    async getDuel(duelId) {
      checkId(duelId);
      const d = mapDuel(one(await call('get_duel', { p_duel_id: duelId })), ctx());
      if (!d) throw new ServiceError('NOT_FOUND', 'Nie ma takiego pojedynku');
      return d;
    },
    async createDuel(opponentId, kind, days, duelId) {
      // UUID z telefonu (arkusz „Wyzwij” trzyma go między ponowieniami): powtórka po zerwanym połączeniu nie dubluje wyzwania.
      return duelOrThrow(await call('create_duel', { p_duel_id: duelId ?? uuid(), p_opponent: opponentId, p_kind: kind, p_days: days }));
    },
    async respondDuel(duelId, accept) {
      checkId(duelId);
      return duelOrThrow(await call('respond_duel', { p_duel_id: duelId, p_accept: accept }));
    },
    async cancelDuel(duelId) {
      checkId(duelId);
      await call('cancel_duel', { p_duel_id: duelId });
    },
    async getPlayerRanking(scope, period, scopeId) {
      const data = await call('get_player_ranking', { p_scope: scope, p_period: period, p_scope_id: scopeId ?? null });
      return mapPlayerRanking(data, { scope, period }, ctx());
    },
    async setRankingVisibility(visible) {
      await call('set_ranking_visibility', { p_visible: visible });
    },
    async getRivalryStatus() {
      return mapRivalryStatus(await call('get_rivalry_status'));
    },
  };
}

/* ───────────────────────── Panel /dev ───────────────────────── */

export interface DevRivalryResult {
  ok: boolean;
  message: string;
}

async function devRivalry(fn: string, params?: Record<string, unknown>): Promise<DevRivalryResult> {
  const r = await devCall(fn, params, 'rywalizacji (20261015110000_rywalizacja.sql)');
  return r.ok ? { ok: true, message: describeCounts(r.data) } : { ok: false, message: r.message };
}

/** „Dodaj rywali”: boty z okazami tygodnia, boty-znajomi, wyzwanie bota do gracza, aktywny pojedynek. */
export const devSeedRivalry = (voivodeship?: string) => devRivalry('dev_seed_rivalry', { p_voivodeship: voivodeship ?? null });
/** „Rywale działają”: boty przyjmują wyzwania gracza, dokładają okazy w pojedynkach, wyprzedzają gracza w walce. */
export const devRivalryAct = () => devRivalry('dev_rivalry_act');
/** „Rozstrzygnij teraz”: zakończone tygodnie walk i pojedynki bez czekania na `resultsAt`. */
export const devFinalizeRivalry = () => devRivalry('dev_finalize_rivalry');
