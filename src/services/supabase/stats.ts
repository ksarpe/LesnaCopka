/**
 * Statystyki gmin na RPC Supabase (etap 4): ranking województwa (`get_ranking`), szczegóły gminy (`get_gmina_stats`)
 * i porównanie okazu (`get_species_percentile`). Mapowanie odpowiedzi: ./statsMap.ts (czyste funkcje).
 * Bez sieci metody rzucają ServiceError('NETWORK') – ekrany pokazują swoje stany offline, bez cichego powrotu
 * do mocków. Rankingi liczy serwer z XP starszych niż 24 h (prywatność) – świeża wyprawa dochodzi później.
 *
 * Przyjęcie wyzwania i obserwowanie gminy to akcje gry (src/store/game.ts) – idą kolejką synchronizacji
 * (`challenge.accept`, `gmina.follow`), a ekran gminy przyjmuje stan z serwera, gdy w kolejce nic na niego nie czeka.
 */
import { DESIGN_VOIVODESHIP } from '@/geo/voivodeships';
import { useOutboxStore } from '@/store/useOutboxStore';
import { patchFromServer, useUserStore } from '@/store/useUserStore';
import type { GminaSpeciesEvidence, GminaStats, SpeciesMap } from '@/types';
import { EVIDENCE_DAYS } from '@/utils/chances';
import { CHANCES_TTL_MS, createTtlCache } from '@/utils/ttlCache';
import { buildChances } from '../chances';
import type { StatsService } from '../types';
import { describeCounts, devCall, one, resolveGminy, serviceCall } from './api';
import { mapEvidence, mapSpeciesMap } from './chancesMap';
import { mapGminaStats, mapPercentile, mapRanking, reconcileGminaState } from './statsMap';

/** Stan „Obserwuj” / „Wyzwanie przyjęte” z serwera → telefon (bez zdarzeń w kolejce i bez powitań w powiadomieniach). */
function applyPlayerState(stats: GminaStats) {
  const items = useOutboxStore.getState().items;
  const pending = {
    follow: items.some((x) => x.type === 'gmina.follow' && x.payload.gminaId === stats.gminaId),
    accept: items.some((x) => x.type === 'challenge.accept' && x.payload.challengeId === stats.challenge?.id),
  };
  const u = useUserStore.getState();
  const patch = reconcileGminaState({ followedGminy: u.followedGminy, challenges: u.challenges }, stats, pending);
  if (patch) patchFromServer(patch);
}

export function createSupabaseStats(): StatsService {
  // Zbiory gmin (szanse) i mapy gatunków zmieniają się najwyżej co kilka godzin (opóźnienie prywatności) – 10 min w pamięci.
  const evidence = createTtlCache<GminaSpeciesEvidence>(CHANCES_TTL_MS);
  const speciesMaps = createTtlCache<SpeciesMap>(CHANCES_TTL_MS);
  return {
    live: true,
    async getRanking(period, opts) {
      const voivodeship = opts?.voivodeship ?? DESIGN_VOIVODESHIP;
      const data = await serviceCall('get_ranking', { p_period: period, p_voivodeship: voivodeship });
      const ranking = mapRanking(data, period, voivodeship);
      // Nazwy z serwera są w wierszach; katalog (baner, szczegóły gminy) uzupełniamy z indeksu PRG.
      resolveGminy(ranking.rows.map((r) => r.gminaId));
      return ranking;
    },
    async getGminaStats(id) {
      const stats = mapGminaStats(one(await serviceCall('get_gmina_stats', { p_gmina_id: id })), id);
      applyPlayerState(stats);
      return stats;
    },
    async getSpeciesPercentile(speciesId, gminaId, size) {
      const data = await serviceCall('get_species_percentile', {
        p_species_id: speciesId,
        p_gmina_id: gminaId,
        p_weight_g: Math.max(0, Math.round(size.weightG)),
      });
      return mapPercentile(one(data), { speciesId, gminaId });
    },
    // Serwer daje tylko agregat zbiorów gminy z 14 dni (k-anonimowy, po opóźnieniu prywatności); szanse liczy telefon.
    async getSpeciesChances(gminaId, date, opts) {
      const ev = await evidence.get(gminaId, async () =>
        mapEvidence(one(await serviceCall('get_gmina_species_evidence', { p_gmina_id: gminaId, p_days: EVIDENCE_DAYS })), gminaId),
      );
      return buildChances(gminaId, ev, date, opts);
    },
    getSpeciesMap(speciesId, voivodeship, period = 'season') {
      return speciesMaps.get(`${speciesId}:${voivodeship}:${period}`, async () => {
        const data = await serviceCall('get_species_map', { p_species_id: speciesId, p_voivodeship: voivodeship, p_period: period });
        const map = mapSpeciesMap(one(data), { speciesId, voivodeship, period });
        // Nazwy gmin z serwera są w `top`; katalog (szczegóły gminy po tapnięciu) uzupełniamy z indeksu PRG.
        resolveGminy(Object.keys(map.heat));
        return map;
      });
    },
  };
}

/* ───────────────────────── Panel /dev ───────────────────────── */

/** Ile tygodni wstecz generator dokłada aktywności (trend tygodnia, sezon) – jak domyślnie serwer. */
export const DEV_ACTIVITY_WEEKS = 8;

const asObj = (v: unknown): Record<string, unknown> | null => {
  const o = one(v);
  return o && typeof o === 'object' && !Array.isArray(o) ? (o as Record<string, unknown>) : null;
};

/**
 * „Wygeneruj aktywność w gminach”: ciche boty z historią zebranych grzybów (już po 24 h – liczą się w rankingach,
 * rekordach i porównaniu okazów) w gminach województwa – i zawsze w podlaskim (makieta); serwer na końcu przelicza
 * rankingi. Ponowne wywołanie dopisuje aktywność od ostatniej. Wymaga `app_config.dev_tools`.
 */
export async function devSeedActivity(voivodeship: string, weeks = DEV_ACTIVITY_WEEKS): Promise<{ ok: boolean; message: string }> {
  const r = await devCall('dev_seed_activity', { p_voivodeship: voivodeship, p_weeks: weeks }, 'etapu 4');
  if (!r.ok) return r;
  const o = asObj(r.data);
  const parts = [`${typeof o?.voivodeship === 'string' ? o.voivodeship : voivodeship}: ${describeCounts(o)}`];
  if (o?.podlaskie && typeof o.podlaskie === 'object') parts.push(`podlaskie: ${describeCounts(o.podlaskie)}`);
  return { ok: true, message: `${parts.join(' · ')} – rankingi przeliczone` };
}

/** „Przelicz rankingi”: `dev_refresh_rankings()` – bez czekania na odświeżenie przy odczycie (co 15 min). */
export async function devRefreshRankings(): Promise<{ ok: boolean; message: string }> {
  const r = await devCall('dev_refresh_rankings', undefined, 'etapu 4');
  if (!r.ok) return r;
  const counts = describeCounts(r.data);
  return { ok: true, message: counts === 'gotowe' ? 'rankingi przeliczone' : `rankingi przeliczone – gminy z punktami: ${counts}` };
}
