/**
 * Pojedynki i ranking grzybiarzy – czysta logika (docs/rywalizacja.md §3–4): opisy rodzajów i zasad, wynik strony
 * ze znalezisk (mocki liczą nim wynik gracza), rozstrzygnięcie i XP, fazy pojedynku i teksty ekranów.
 * Bez zależności od React Native. Testy: src/utils/__tests__/duels.test.ts.
 */
import type { IconName } from '@/components/Icon';
import type {
  Duel,
  DuelDays,
  DuelKind,
  DuelOutcome,
  DuelSide,
  Find,
  PlayerRankingPeriod,
  PlayerRankingScope,
  Species,
} from '@/types';
import { contestWeekStart, warsawMidnight } from './contests';
import { fmtDaysAgo, fmtInt, plural } from './format';

const H = 3_600_000;
const DAY = 24 * H;

/** Zaproszenie wygasa po 48 h. */
export const DUEL_INVITE_TTL_MS = 48 * H;
/** Znaleziska z kolejki offline liczą się jeszcze tyle po końcu (`rivalry_queue_grace_h`) – potem rozstrzygnięcie. */
export const DUEL_GRACE_MS = 6 * H;
/** XP za wynik (źródło `duel`) – tylko gdy obie strony mają wynik > 0 i konta mogą odbierać nagrody. */
export const DUEL_XP: Record<DuelOutcome, number> = { won: 100, draw: 30, lost: 0 };
/** Limity: aktywne + oczekujące pojedynki gracza, nowe wyzwania na dobę, nagrodzone pojedynki na tydzień. */
export const DUEL_LIMITS = { open: 3, perDay: 5, rewardedPerWeek: 3, rewardedPerPairWeek: 1 } as const;
export const DUEL_DAYS: DuelDays[] = [1, 3, 7];
export const DUEL_KIND_ORDER: DuelKind[] = ['biggest', 'count', 'species'];
export const isDuelKind = (v: unknown): v is DuelKind => typeof v === 'string' && (DUEL_KIND_ORDER as string[]).includes(v);

export interface DuelKindDef {
  label: string;
  icon: IconName;
  /** Jedno zdanie zasad (arkusz „Wyzwij”, szczegóły pojedynku). */
  rule: string;
}

export const DUEL_KINDS: Record<DuelKind, DuelKindDef> = {
  biggest: {
    label: 'Największy okaz',
    icon: 'straighten',
    rule:
      'Wygrywa największy kapelusz w stosunku do typowego dla gatunku (borowik 18 cm przy typowych 12 cm = 150%). ' +
      'Liczą się tylko okazy zmierzone przy odniesieniu skali – dłoni albo monecie obok grzyba.',
  },
  count: {
    label: 'Najwięcej grzybów',
    icon: 'shopping_basket',
    rule: 'Liczy się każde znalezisko zebrane do koszyka.',
  },
  species: {
    label: 'Najwięcej gatunków',
    icon: 'eco',
    rule: 'Liczy się liczba różnych gatunków – także tych, które tylko fotografujesz (trujące, chronione).',
  },
};

/** Zasada wspólna wszystkich rodzajów. */
export const DUEL_COMMON_RULE =
  'Liczą się tylko znaleziska rozpoznane na zdjęciu i zweryfikowane przez serwer, znalezione w czasie pojedynku.';

/** Kiedy pojedynek daje XP – podpis przy wyniku bez nagrody i w zasadach. */
export const DUEL_XP_RULE =
  `Wygrana +${DUEL_XP.won} XP, remis +${DUEL_XP.draw} XP – gdy oboje macie wynik, a konta są zabezpieczone e-mailem. ` +
  `Nagradzamy ${DUEL_LIMITS.rewardedPerWeek} pojedynki tygodniowo (z tą samą osobą – 1).`;

/** „1 dzień”, „3 dni”, „7 dni”. */
export const daysLabel = (d: number) => `${d} ${plural(d, 'dzień', 'dni', 'dni')}`;

/** Kapelusz względem typowego dla gatunku, w % z jednym miejscem po przecinku (jak „Okaz tygodnia”). */
export function relativePct(capCm: number, typicalCapCm: number): number {
  if (!(typicalCapCm > 0) || !(capCm > 0)) return 0;
  return Math.round((capCm / typicalCapCm) * 1000) / 10;
}

/** „152,4%” (bez zbędnego „,0”). */
export function fmtPct(v: number): string {
  const r = Math.round(v * 10) / 10;
  return `${Number.isInteger(r) ? String(r) : r.toFixed(1).replace('.', ',')}%`;
}

/** „12,5 cm” */
export function fmtCm(v: number): string {
  const r = Math.round(v * 10) / 10;
  return `${Number.isInteger(r) ? String(r) : r.toFixed(1).replace('.', ',')} cm`;
}

/** Wynik do dużej cyfry: „152,4%” / „12” / „4”; biggest bez okazu – „–”. */
export function duelScoreShort(kind: DuelKind, score: number): string {
  if (kind === 'biggest') return score > 0 ? fmtPct(score) : '–';
  return fmtInt(score);
}

/** Wynik z jednostką: „152,4% typowego”, „12 grzybów”, „4 gatunki”. */
export function duelScoreText(kind: DuelKind, score: number): string {
  if (kind === 'biggest') return score > 0 ? `${fmtPct(score)} typowego` : 'jeszcze bez okazu';
  if (kind === 'count') return `${fmtInt(score)} ${plural(score, 'grzyb', 'grzyby', 'grzybów')}`;
  return `${fmtInt(score)} ${plural(score, 'gatunek', 'gatunki', 'gatunków')}`;
}

/* ───────────────────────── Wynik ze znalezisk ───────────────────────── */

export interface DuelScoreOptions {
  /** Okno pojedynku (ms): od przyjęcia do końca. */
  from: number;
  to: number;
  /**
   * true – jak serwer: tylko `verified` / `sizeVerified === true`. false (mocki) – pomijamy tylko znaleziska jawnie
   * oznaczone jako niezweryfikowane (`false`); brak flagi (stare znaleziska, mocki bez serwera) się liczy.
   */
  strict: boolean;
}

type ScoreFind = Pick<Find, 'id' | 'speciesId' | 'status' | 'collected' | 'foundAt' | 'dimensions' | 'verified' | 'sizeVerified' | 'photoPath'>;
type ScoreSpecies = Pick<Species, 'typical' | 'clustered' | 'protection'>;

const flagOk = (v: boolean | undefined, strict: boolean) => (strict ? v === true : v !== false);

/** Okaz może walczyć w „Największym okazie”: zmierzony przy skali, pojedynczy owocnik, gatunek nie kępkowy i bez ochrony. */
export function biggestEligible(f: ScoreFind, s: ScoreSpecies | undefined, strict: boolean): boolean {
  return (
    !!s &&
    flagOk(f.sizeVerified, strict) &&
    !s.clustered &&
    !s.protection &&
    (f.dimensions.pieces ?? 1) <= 1 &&
    s.typical.capCm > 0 &&
    f.dimensions.capCm > 0
  );
}

/**
 * Wynik jednej strony pojedynku z jej znalezisk (odebranych, w oknie): count – zebrane do koszyka, species – różne
 * gatunki, biggest – najlepszy okaz (kapelusz / typowy, %; remis – wcześniejszy).
 */
export function duelSideScore(
  kind: DuelKind,
  finds: ScoreFind[],
  speciesById: Record<string, ScoreSpecies | undefined>,
  opts: DuelScoreOptions,
): Pick<DuelSide, 'score' | 'best'> {
  const inWindow = finds.filter((f) => {
    const t = new Date(f.foundAt).getTime();
    return f.status === 'claimed' && t >= opts.from && t <= opts.to;
  });
  if (kind === 'count') {
    return { score: inWindow.filter((f) => f.collected && flagOk(f.verified, opts.strict)).length, best: null };
  }
  if (kind === 'species') {
    return { score: new Set(inWindow.filter((f) => flagOk(f.verified, opts.strict)).map((f) => f.speciesId)).size, best: null };
  }
  let best: DuelSide['best'] = null;
  let bestAt = Infinity;
  for (const f of inWindow) {
    const s = speciesById[f.speciesId];
    if (!biggestEligible(f, s, opts.strict)) continue;
    const pct = relativePct(f.dimensions.capCm, s!.typical.capCm);
    const at = new Date(f.foundAt).getTime();
    if (!best || pct > best.relativePct || (pct === best.relativePct && at < bestAt)) {
      best = { findId: f.id, speciesId: f.speciesId, capCm: f.dimensions.capCm, relativePct: pct, photoPath: f.photoPath ?? null };
      bestAt = at;
    }
  }
  return { score: best?.relativePct ?? 0, best };
}

/* ───────────────────────── Rozstrzygnięcie ───────────────────────── */

export function duelOutcome(me: number, opponent: number): DuelOutcome {
  const a = Math.round(me * 10);
  const b = Math.round(opponent * 10);
  return a > b ? 'won' : a < b ? 'lost' : 'draw';
}

export interface DuelXpInput {
  /** Obie strony mają wynik > 0. */
  bothScored: boolean;
  /** Obie strony mogą dostać nagrodę (rywalizacja + konto zabezpieczone e-mailem). */
  eligible: boolean;
  /** Nagrodzone pojedynki gracza w tym tygodniu (bez tego). */
  rewardedThisWeek: number;
  /** Ta para miała już w tym tygodniu nagrodzony pojedynek. */
  pairRewardedThisWeek: boolean;
}

/** XP gracza za wynik (docs/rywalizacja.md §3): przegrana 0, bez wyniku obu stron / ponad limit – 0. */
export function duelXp(outcome: DuelOutcome, x: DuelXpInput): number {
  if (outcome === 'lost' || !x.bothScored || !x.eligible) return 0;
  if (x.rewardedThisWeek >= DUEL_LIMITS.rewardedPerWeek || x.pairRewardedThisWeek) return 0;
  return DUEL_XP[outcome];
}

/** Udział gracza w pasku wyników (0..1); 0 : 0 – po równo. */
export function duelShare(me: number, opponent: number): number {
  const sum = Math.max(0, me) + Math.max(0, opponent);
  return sum > 0 ? Math.max(0, me) / sum : 0.5;
}

/* ───────────────────────── Fazy i teksty ───────────────────────── */

/**
 * Faza pojedynku w UI: incoming / outgoing – zaproszenie czeka; active – trwa; settling – okno minęło, czekamy na
 * znaleziska z kolejki offline (do 6 h) i rozstrzygnięcie; won / lost / draw – wynik; reszta – bez pojedynku.
 */
export type DuelPhase = 'incoming' | 'outgoing' | 'active' | 'settling' | DuelOutcome | 'declined' | 'cancelled' | 'expired';

export function duelPhase(d: Pick<Duel, 'status' | 'iAmChallenger' | 'endsAt' | 'outcome'>, now = Date.now()): DuelPhase {
  switch (d.status) {
    case 'pending':
      return d.iAmChallenger ? 'outgoing' : 'incoming';
    case 'active':
      return d.endsAt && new Date(d.endsAt).getTime() <= now ? 'settling' : 'active';
    case 'finished':
      return d.outcome ?? 'draw';
    default:
      return d.status;
  }
}

export const PHASE_LABEL: Record<DuelPhase, string> = {
  incoming: 'Wyzwanie do Ciebie',
  outgoing: 'Czeka na odpowiedź',
  active: 'Trwa',
  settling: 'Liczymy wyniki',
  won: 'Wygrana',
  lost: 'Przegrana',
  draw: 'Remis',
  declined: 'Odrzucony',
  cancelled: 'Anulowany',
  expired: 'Wygasł',
};

/** Pojedynek się zakończył (także bez gry: odrzucony, anulowany, wygasły) – „Rewanż” zamiast akcji. */
export const isClosedPhase = (p: DuelPhase) => p === 'won' || p === 'lost' || p === 'draw' || p === 'declined' || p === 'cancelled' || p === 'expired';

/** „2 d 5 h”, „5 h 12 min”, „12 min”. */
export function fmtTimeLeft(ms: number): string {
  const min = Math.max(0, Math.ceil(ms / 60_000));
  const d = Math.floor(min / (24 * 60));
  const h = Math.floor((min % (24 * 60)) / 60);
  const m = min % 60;
  if (d > 0) return h ? `${d} d ${h} h` : `${d} d`;
  if (h > 0) return m ? `${h} h ${m} min` : `${h} h`;
  return `${Math.max(1, m)} min`;
}

/** Podpis czasu: „Koniec za 2 d 5 h”, „Wygasa za 40 h”, „Wyniki za 3 h”, „Zakończony wczoraj”. */
export function duelTimeText(d: Pick<Duel, 'status' | 'iAmChallenger' | 'endsAt' | 'outcome' | 'expiresAt' | 'finishedAt' | 'createdAt'>, now = Date.now()): string {
  const phase = duelPhase(d, now);
  const at = (iso: string | null) => (iso ? new Date(iso).getTime() : NaN);
  switch (phase) {
    case 'incoming':
    case 'outgoing':
      return Number.isFinite(at(d.expiresAt)) ? `Wygasa za ${fmtTimeLeft(at(d.expiresAt) - now)}` : 'Czeka na odpowiedź';
    case 'active':
      return `Koniec za ${fmtTimeLeft(at(d.endsAt) - now)}`;
    case 'settling': {
      const left = at(d.endsAt) + DUEL_GRACE_MS - now;
      return left > 0 ? `Wyniki za ${fmtTimeLeft(left)}` : 'Wyniki lada chwila';
    }
    default: {
      const done = d.finishedAt ?? d.createdAt;
      return `${PHASE_LABEL[phase]} ${fmtDaysAgo(done, now)}`;
    }
  }
}

/** Wynik zakończonego pojedynku do banera: tytuł i podpis z XP (bez XP przy wygranej / remisie – dlaczego). */
export function duelResultText(d: Pick<Duel, 'outcome' | 'xp' | 'status'>): { title: string; body: string } | null {
  if (d.status === 'declined') return { title: 'Wyzwanie odrzucone', body: 'Pojedynek się nie odbył.' };
  if (d.status === 'cancelled') return { title: 'Wyzwanie anulowane', body: 'Pojedynek się nie odbył.' };
  if (d.status === 'expired') return { title: 'Wyzwanie wygasło', body: 'Nikt go nie przyjął w ciągu 48 h.' };
  if (d.status !== 'finished' || !d.outcome) return null;
  const xp = d.xp ?? 0;
  if (d.outcome === 'lost') return { title: 'Tym razem przegrana', body: 'Weź rewanż – następnym razem las może być łaskawszy.' };
  const title = d.outcome === 'won' ? 'Wygrana!' : 'Remis';
  return { title, body: xp > 0 ? `+${fmtInt(xp)} XP` : `Bez XP. ${DUEL_XP_RULE}` };
}

/** Bilans: „3 wygrane · 1 remis · 2 przegrane”. */
export function recordText(r: { won: number; lost: number; draw: number }): string {
  return [
    `${r.won} ${plural(r.won, 'wygrana', 'wygrane', 'wygranych')}`,
    `${r.draw} ${plural(r.draw, 'remis', 'remisy', 'remisów')}`,
    `${r.lost} ${plural(r.lost, 'przegrana', 'przegrane', 'przegranych')}`,
  ].join(' · ');
}

/* ───────────────────────── Ranking grzybiarzy ───────────────────────── */

/** Zasięgi rankingu; `short` – etykieta w przełączniku (4 segmenty na wąskim ekranie). */
export const RANKING_SCOPES: { value: PlayerRankingScope; label: string; short: string }[] = [
  { value: 'znajomi', label: 'Znajomi', short: 'Znajomi' },
  { value: 'gmina', label: 'Gmina', short: 'Gmina' },
  { value: 'wojewodztwo', label: 'Województwo', short: 'Woj.' },
  { value: 'polska', label: 'Polska', short: 'Polska' },
];

/** Nagłówek rankingu: „Gmina Supraśl”, „Województwo podlaskie”, „Polska”, „Znajomi”. */
export function rankingTitle(r: { scope: PlayerRankingScope; scopeName: string }): string {
  return r.scope === 'wojewodztwo' && r.scopeName && !/województwo/i.test(r.scopeName) ? `Województwo ${r.scopeName}` : r.scopeName;
}

export const RANKING_PERIODS: { value: PlayerRankingPeriod; label: string }[] = [
  { value: 'week', label: 'Tydzień' },
  { value: 'season', label: 'Sezon' },
];

/** „+120 pkt wejdzie do rankingu jutro” – świeże punkty gracza (opóźnienie prywatności 24 h). */
export const pendingXpText = (xp: number) => `+${fmtInt(xp)} pkt wejdzie do rankingu jutro`;

/** Wiersze rankingu od największej liczby punktów (remis – alfabetycznie), miejsca 1..n; bez punktów – pomijane. */
export function rankByXp<T extends { xp: number; name: string }>(list: T[]): (T & { rank: number })[] {
  return list
    .filter((x) => x.xp > 0)
    .sort((a, b) => b.xp - a.xp || a.name.localeCompare(b.name, 'pl'))
    .map((x, i) => ({ ...x, rank: i + 1 }));
}

/**
 * Poniedziałek 00:00 w strefie Europe/Warsaw (jak serwer i walki o okaz – niezależnie od strefy telefonu) tygodnia
 * chwili `now`: okres „Tydzień” rankingu, limit nagrodzonych pojedynków.
 */
export function weekStartMs(now: number): number {
  return warsawMidnight(contestWeekStart(now));
}

/** Długość pojedynku w ms. */
export const duelLengthMs = (days: number) => days * DAY;
