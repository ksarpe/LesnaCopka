/**
 * Implementacja serwisów na Supabase (etap 1): konto anonimowe + słowniki z bazy.
 * Pozostałe serwisy (wyprawy, znaleziska, feed, statystyki) na razie zostają mockami –
 * następny krok to przeniesienie akcji gry na RPC (claim_find, start_trip… – docs/backend.md).
 * Gdy baza jest nieosiągalna (np. telefon poza domowym Wi-Fi), aplikacja wraca do mocków.
 */
import type { CatalogService, Services } from '../types';
import type { Badge, Edibility, Quest, QuestKind, Rarity, Species } from '@/types';
import { supabase } from './client';
import { backendStatus } from './status';

const TIMEOUT_MS = 4000;

function withTimeout<T>(p: PromiseLike<T>, ms = TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Brak odpowiedzi serwera (${ms / 1000} s)`)), ms);
    Promise.resolve(p).then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/** Sesja: anonimowe konto tworzone przy pierwszym uruchomieniu (profil zakłada trigger w bazie). */
export async function ensureSession(): Promise<string> {
  if (!supabase) throw new Error('Supabase wyłączony');
  const { data } = await withTimeout(supabase.auth.getSession());
  if (data.session) return data.session.user.id;
  const res = await withTimeout(supabase.auth.signInAnonymously());
  if (res.error || !res.data.user) throw res.error ?? new Error('Nie udało się utworzyć konta');
  return res.data.user.id;
}

export async function connect() {
  const st = backendStatus();
  st.set({ state: 'connecting', error: null });
  try {
    const userId = await ensureSession();
    st.set({ state: 'online', userId, checkedAt: new Date().toISOString() });
  } catch (e) {
    st.set({ state: 'offline', error: e instanceof Error ? e.message : String(e), checkedAt: new Date().toISOString() });
  }
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
  species_lookalikes: { lookalike_name: string; lookalike_edibility: Edibility; tip: string }[];
};

async function fetchSpecies(): Promise<Species[]> {
  const { data, error } = await withTimeout(
    supabase!
      .from('species')
      .select(
        'id, name, latin, short_name, rarity, edibility, habitat, clustered, typical_cap_cm, typical_height_cm, typical_weight_g, species_lookalikes!species_lookalikes_species_id_fkey(lookalike_name, lookalike_edibility, tip)',
      )
      .eq('active', true)
      .order('atlas_no'),
  );
  if (error) throw error;
  return (data as SpeciesRow[]).map((r) => {
    const l = r.species_lookalikes?.[0];
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
      lookalike: l ? { name: l.lookalike_name, edibility: l.lookalike_edibility, tip: l.tip } : undefined,
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

async function fetchQuests(): Promise<Quest[]> {
  const { data, error } = await withTimeout(
    supabase!
      .from('quest_templates')
      .select('id, kind, title, icon, icon_filled, icon_bg, icon_color, xp, target')
      .eq('active', true)
      .order('sort'),
  );
  if (error) throw error;
  return (
    data as {
      id: string;
      kind: QuestKind;
      title: string;
      icon: string;
      icon_filled: boolean;
      icon_bg: string;
      icon_color: string;
      xp: number;
      target: number;
    }[]
  ).map((q) => ({
    id: q.id,
    kind: q.kind,
    title: q.title,
    icon: q.icon,
    iconFilled: q.icon_filled || undefined,
    iconBg: q.icon_bg,
    iconColor: q.icon_color,
    xp: q.xp,
    target: Number(q.target),
  }));
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
  return {
    ...base,
    async init() {
      await base.init();
      // Połączenie nie blokuje startu – bez sieci aplikacja działa na mockach.
      void connect();
    },
    catalog: supabaseCatalog(base.catalog),
  };
}
