/**
 * Implementacja serwisów na Supabase: konto anonimowe, słowniki z bazy, stan gry na serwerze, feed,
 * znajomi i aktywność. Gra jest local-first: akcje liczą się w telefonie (src/store/game.ts), a ich zdarzenia
 * idą przez kolejkę (src/store/useOutboxStore.ts) do RPC – silnik w ./sync.ts, przyjęcie stanu z serwera
 * w ./gameState.ts. Feed (./feed.ts) i statystyki gmin – rankingi, szczegóły gminy, porównanie okazu (./stats.ts) –
 * czytają z serwera na bieżąco (bez sieci – stany offline ekranów), a publikacja wyprawy, przyjęcie wyzwania
 * i obserwowanie gminy idą kolejką. Bez sieci gra działa lokalnie, kolejka rośnie i wysyła się później.
 * Zdjęcia (znalezisk, okładki wpisów, profilowe) idą do Supabase Storage tą samą kolejką – ./photos.ts.
 */
import type { CatalogService, Services } from '../types';
import { setOutboxEnabled, useOutboxStore } from '@/store/useOutboxStore';
import { setFreshInstallOnboarded } from '@/store/useUserStore';
import type { Badge, Edibility, Habitat, Protection, Quest, QuestPeriod, Rarity, Species } from '@/types';
import { questKindFromSql } from '@/utils/quests';
import { supabase } from './client';
import { createSupabaseFeed } from './feed';
import { establishSession, withTimeout } from './session';
import { backendStatus } from './status';
import { createSupabaseStats } from './stats';
import { requestSync, startSync } from './sync';

export { ensureSession } from './session';

/** Sesja + synchronizacja (kolejka → serwer, potem stan gry z serwera). Nie rzuca. */
export async function connect() {
  if (await establishSession()) void requestSync('connect');
}

type SpeciesRow = {
  id: string;
  name: string;
  latin: string;
  short_name: string;
  rarity: Rarity;
  edibility: Edibility;
  habitat: string;
  clustered: boolean;
  typical_cap_cm: number;
  typical_height_cm: number;
  typical_weight_g: number;
  /** Kolumny treści (migracja 20261013100000_species_content.sql). */
  season_weights: (number | string)[] | null;
  habitats: Habitat[] | null;
  protection: Protection | null;
  description: string | null;
  species_lookalikes: { lookalike_name: string; lookalike_edibility: Edibility; tip: string; sort: number | null }[];
};

async function fetchSpecies(): Promise<Species[]> {
  const { data, error } = await withTimeout(
    supabase!
      .from('species')
      .select(
        'id, name, latin, short_name, rarity, edibility, habitat, clustered, typical_cap_cm, typical_height_cm, typical_weight_g, season_weights, habitats, protection, description, species_lookalikes!species_lookalikes_species_id_fkey(lookalike_name, lookalike_edibility, tip, sort)',
      )
      .eq('active', true)
      .order('atlas_no'),
  );
  if (error) throw error;
  return (data as SpeciesRow[]).map((r) => {
    // Wszystkie sobowtóry w kolejności z katalogu (sort 0 = główny, `lookalike` dla zgodności).
    const looks = [...(r.species_lookalikes ?? [])]
      .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
      .map((x) => ({ name: x.lookalike_name, edibility: x.lookalike_edibility, tip: x.tip }));
    const l = looks[0];
    return {
      id: r.id,
      name: r.name,
      latin: r.latin,
      shortName: r.short_name,
      rarity: r.rarity,
      edibility: r.edibility,
      habitat: r.habitat,
      clustered: r.clustered || undefined,
      typical: { capCm: Number(r.typical_cap_cm), heightCm: Number(r.typical_height_cm), weightG: r.typical_weight_g },
      lookalike: l,
      lookalikes: looks.length ? looks : undefined,
      seasonWeights: r.season_weights?.length === 12 ? r.season_weights.map(Number) : undefined,
      habitats: r.habitats?.length ? r.habitats : undefined,
      protection: r.protection ?? undefined,
      description: r.description ?? undefined,
    };
  });
}

async function fetchBadges(): Promise<Badge[]> {
  const { data, error } = await withTimeout(
    supabase!.from('badges').select('id, name, description, icon, color, icon_color').order('sort'),
  );
  if (error) throw error;
  return (data as { id: string; name: string; description: string; icon: string; color: string; icon_color: string }[]).map(
    (b) => ({ id: b.id, name: b.name, description: b.description, icon: b.icon, color: b.color, iconColor: b.icon_color }),
  );
}

/**
 * Pula zadań (dzienne i tygodniowe) w kolejności `sort` – od niej zależy losowanie (src/utils/quests.ts ↔ SQL
 * `quests_for`). Rodzaj z bazy w snake_case; nieznany (nowszy serwer) – zadanie pomijamy.
 */
async function fetchQuests(): Promise<Quest[]> {
  const { data, error } = await withTimeout(
    supabase!
      .from('quest_templates')
      .select('id, kind, title, icon, icon_filled, icon_bg, icon_color, xp, target, period, difficulty, params')
      .eq('active', true)
      .order('sort')
      .order('id'),
  );
  if (error) throw error;
  return (
    data as {
      id: string;
      kind: string;
      title: string;
      icon: string;
      icon_filled: boolean;
      icon_bg: string;
      icon_color: string;
      xp: number;
      target: number;
      period: QuestPeriod;
      difficulty: number;
      params: { speciesId?: string; months?: number[]; minutes?: number; beforeHour?: number } | null;
    }[]
  ).flatMap((q): Quest[] => {
    const kind = questKindFromSql(q.kind);
    if (!kind) return [];
    const p = q.params ?? {};
    return [
      {
        id: q.id,
        kind,
        title: q.title,
        icon: q.icon,
        iconFilled: q.icon_filled || undefined,
        iconBg: q.icon_bg,
        iconColor: q.icon_color,
        xp: q.xp,
        target: Number(q.target),
        period: q.period === 'weekly' ? 'weekly' : 'daily',
        difficulty: q.difficulty === 3 ? 3 : q.difficulty === 2 ? 2 : 1,
        ...(p.speciesId ? { speciesId: p.speciesId } : {}),
        ...(Array.isArray(p.months) && p.months.length ? { months: p.months.map(Number) } : {}),
        ...(p.minutes != null ? { minutes: Number(p.minutes) } : {}),
        ...(p.beforeHour != null ? { beforeHour: Number(p.beforeHour) } : {}),
      },
    ];
  });
}

/**
 * Słowniki z bazy (gatunki z sobowtórami, odznaki, zadania dnia). Gminy i liczba gatunków w atlasie
 * zostają z mocków – aplikacja potrzebuje pól, których w bazie jeszcze nie ma (prognoza, liczba grzybiarzy).
 */
function supabaseCatalog(fallback: CatalogService): CatalogService {
  let loaded: Promise<{ species: Species[]; badges: Badge[]; quests: Quest[] } | null> | null = null;
  const load = () => {
    loaded ??= Promise.all([fetchSpecies(), fetchBadges(), fetchQuests()])
      .then(([species, badges, quests]) => {
        backendStatus().set({ catalogSource: 'supabase' });
        return { species, badges, quests };
      })
      .catch((e) => {
        backendStatus().set({ catalogSource: 'mock (fallback)', error: e instanceof Error ? e.message : String(e) });
        return null;
      });
    return loaded;
  };
  return {
    getSpecies: async () => (await load())?.species ?? fallback.getSpecies(),
    getBadges: async () => (await load())?.badges ?? fallback.getBadges(),
    getDailyQuests: async () => (await load())?.quests ?? fallback.getDailyQuests(),
    getGminy: () => fallback.getGminy(),
    getTotalSpecies: () => fallback.getTotalSpecies(),
  };
}

export function createSupabaseServices(base: Services): Services {
  // Od teraz akcje gry trafiają do kolejki synchronizacji (w trybie mock jest wyłączona).
  setOutboxEnabled(true);
  // Pierwsze uruchomienie z serwerem: prawdziwy nowy gracz zaczyna od onboardingu (nie od gracza demo z makiety).
  setFreshInstallOnboarded(false);
  return {
    ...base,
    async init() {
      await base.init();
      // Połączenie nie blokuje startu – bez sieci gra działa lokalnie, a kolejka czeka na serwer.
      startSync();
      void connect();
    },
    catalog: supabaseCatalog(base.catalog),
    feed: createSupabaseFeed(),
    stats: createSupabaseStats(),
    dev: {
      // „Wyczyść dane” / reset panelu: dane mocków + własne wpisy czekające na serwer (stan konta wróci z serwera).
      reset: (opts) => {
        base.dev?.reset(opts);
        useOutboxStore.getState().patch({ localPosts: [] });
      },
    },
  };
}
