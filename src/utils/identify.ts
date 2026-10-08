/**
 * Rozpoznanie zdjęcia → wynik gry – czyste funkcje (testy: src/utils/__tests__/identify.test.ts).
 *
 *  · toIdentifyOutcome: znormalizowana odpowiedź Edge Function `identify` + katalog gatunków → IdentifyOutcome
 *    (gatunek, pewność z bezpiecznikiem sobowtórów, wymiary, XXL, widoczne części) albo odrzucenie z powodem;
 *  · estimateDimensions: wymiary tylko z odniesienia skali na zdjęciu, bez niego – typowe dla gatunku (bez losowania);
 *  · partsHint: podpowiedź na Analizie, gdy na zdjęciu brakuje części ważnej dla odróżnienia sobowtóra;
 *  · devScanOutcome: wymuszony wynik skanu z panelu dev (ta sama ścieżka mapowania co prawdziwy wynik).
 */
import type { IdentifyResponse } from '../../supabase/functions/identify/contract';
import type { Dimensions, IdentifyOutcome, ScanPart, Species } from '@/types';
import { isPoisonousEdibility, speciesLookalikes } from './species';
import { isXxl } from './xp';

/** Poniżej – „Nie jestem pewien” z listą możliwych gatunków, bez nagrody (Analiza). */
export const LOW_CONFIDENCE = 0.6;
/** Groźny gatunek wśród kandydatów z co najmniej taką pewnością obniża pewność jadalnego zwycięzcy. */
const DANGER_CANDIDATE_MIN = 0.15;
/** …do tej wartości (poniżej LOW_CONFIDENCE). */
const DANGER_CAP = 0.55;

/** Grzyb, ale bez gatunku z atlasu. */
export const NO_SPECIES_REASON = 'Widzę grzyba, ale nie umiem dopasować gatunku z atlasu – pokaż kapelusz, spód i trzon.';

const AGE_BY_MATURITY: Record<IdentifyResponse['maturity'], number> = { young: 2, mature: 5, old: 9, unknown: 4 };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Wymiary okazu. Model podaje kapelusz / wysokość tylko przy odniesieniu skali (dłoń, nóż, moneta…); bez niego
 * zostają typowe wymiary gatunku (skala 1 – bez XXL), nic nie jest losowane. Waga jak dotąd: typowa × skala²
 * (te same progi co XXL i anty-cheat na serwerze); kępki – sztuki × waga jednej.
 */
export function estimateDimensions(
  species: Pick<Species, 'typical' | 'clustered'>,
  r: Pick<IdentifyResponse, 'capCm' | 'heightCm' | 'count' | 'maturity'>,
): Dimensions {
  const t = species.typical;
  const raw = r.capCm != null ? r.capCm / t.capCm : r.heightCm != null ? r.heightCm / t.heightCm : 1;
  const scale = clamp(raw, 0.3, 3);
  const capCm = r.capCm != null ? r.capCm : t.capCm * scale;
  const heightCm = r.heightCm != null ? r.heightCm : t.heightCm * scale;
  const pieceG = Math.max(5, Math.round((t.weightG * scale * scale) / 5) * 5);
  const pieces = species.clustered ? clamp(Math.round(r.count || 1), 1, 200) : undefined;
  return {
    capCm: Math.max(1, Math.round(capCm)),
    heightCm: Math.max(1, Math.round(heightCm)),
    weightG: pieces ? pieces * pieceG : pieceG,
    ageDays: AGE_BY_MATURITY[r.maturity] ?? AGE_BY_MATURITY.unknown,
    ...(pieces ? { pieces } : {}),
  };
}

/**
 * Pewność zwycięzcy z bezpiecznikiem: gatunek niegroźny, a wśród kandydatów jest trujący / śmiertelny z pewnością
 * ≥ 15% → najwyżej 55% („Nie jestem pewien”). Model ma to robić sam (prompt) – to druga linia obrony.
 */
export function safeConfidence(
  candidates: IdentifyResponse['candidates'],
  speciesById: Record<string, Pick<Species, 'edibility'> | undefined>,
): number {
  const [top, ...rest] = candidates;
  if (!top) return 0;
  const topSp = speciesById[top.speciesId];
  if (!topSp || isPoisonousEdibility(topSp.edibility)) return top.confidence;
  const danger = rest.some((c) => {
    const sp = speciesById[c.speciesId];
    return !!sp && isPoisonousEdibility(sp.edibility) && c.confidence >= DANGER_CANDIDATE_MIN;
  });
  return danger ? Math.min(top.confidence, DANGER_CAP) : top.confidence;
}

/**
 * Odpowiedź rozpoznania → wynik gry. Werdykt „nie grzyb” / „niewyraźne” → odrzucenie z powodem; grzyb bez gatunku
 * z atlasu (puste / nieznane id kandydatów) → „niewyraźne” z powodem modelu albo NO_SPECIES_REASON.
 */
export function toIdentifyOutcome(r: IdentifyResponse, speciesById: Record<string, Species | undefined>): IdentifyOutcome {
  if (r.verdict !== 'mushroom') return { kind: r.verdict, reason: r.reason };
  const candidates = r.candidates.filter((c) => !!speciesById[c.speciesId]);
  const top = candidates[0];
  const species = top ? speciesById[top.speciesId] : undefined;
  if (!top || !species) return { kind: 'unclear', reason: r.reason || NO_SPECIES_REASON };
  const dimensions = estimateDimensions(species, r);
  const confidence = safeConfidence(candidates, speciesById);
  return {
    kind: 'mushroom',
    identification: {
      speciesId: species.id,
      confidence,
      rarity: species.rarity,
      xxl: !species.clustered && isXxl(dimensions.weightG, species.typical.weightG),
      dimensions,
      lookalikes: speciesLookalikes(species),
      candidates: candidates.map((c, i) => (i === 0 ? { ...c, confidence } : c)),
    },
    visibleParts: r.visibleParts,
  };
}

/**
 * Podpowiedź do Analizy, gdy na zdjęciu brakuje części potrzebnej do odróżnienia sobowtóra: podstawa trzonu
 * (bulwa, pochwa – muchomory) przy śmiertelnie trujących sobowtórach, spód kapelusza przy każdym sobowtórze.
 * Brak informacji o częściach (stare znalezisko) albo wszystko widać → null.
 */
export function partsHint(
  species: Pick<Species, 'lookalike' | 'lookalikes' | 'edibility'>,
  parts: ScanPart[] | undefined,
): string | null {
  if (!parts?.length) return null;
  const looks = speciesLookalikes(species);
  if (!looks.length) return null;
  const deadly = looks.some((l) => l.edibility === 'smiertelny') || species.edibility === 'smiertelny';
  if (deadly && !parts.includes('base')) {
    return 'Następnym razem odsłoń też podstawę trzonu (bulwa, pochwa) – to klucz do odróżnienia śmiertelnie trujących sobowtórów.';
  }
  if (!parts.includes('underside')) {
    return 'Pokaż też spód kapelusza (blaszki albo rurki) – po nim najłatwiej odróżnić ten gatunek od sobowtóra.';
  }
  return null;
}

/* ───────────────────────── Panel dev: wymuszony wynik skanu ───────────────────────── */

export type ScanForce = 'off' | 'species' | 'not_mushroom' | 'unclear';

/** Wymuszony wynik skanu z panelu /dev (tylko narzędzia dev) – zastępuje rozpoznanie zdjęcia. */
export interface ScanOverride {
  /** off = prawdziwe rozpoznanie zdjęcia (Edge Function). */
  force: ScanForce;
  /** Gatunek przy force = 'species' (null = pierwszy z katalogu). */
  speciesId: string | null;
  /** Okaz XXL: wymiary jak z odniesieniem skali (×1,35 typowych). */
  xxl: boolean;
  /** Pewność < 60% → „Nie jestem pewien” z kandydatami. */
  lowConfidence: boolean;
}

export const NO_SCAN_OVERRIDE: ScanOverride = { force: 'off', speciesId: null, xxl: false, lowConfidence: false };

const DEV_SUFFIX = ' (wynik wymuszony w panelu dev)';

/** Gatunki-sobowtóry z katalogu (po nazwie), uzupełnione sąsiadami w atlasie – kandydaci przy niskiej pewności. */
function devAlternatives(species: Species, catalog: Species[]): string[] {
  const names = speciesLookalikes(species).map((l) => l.name.toLowerCase());
  const byName = catalog.filter((s) => s.id !== species.id && names.some((n) => s.name.toLowerCase().startsWith(n)));
  const idx = catalog.findIndex((s) => s.id === species.id);
  const neighbours = [catalog[idx + 1], catalog[idx - 1], catalog[idx + 2]].filter((s): s is Species => !!s && s.id !== species.id);
  return [...new Set([...byName, ...neighbours].map((s) => s.id))].slice(0, 2);
}

/**
 * Wymuszony wynik (deterministyczny, bez zdjęcia i sieci) przez to samo mapowanie co odpowiedź modelu.
 * null = wymuszenie wyłączone albo pusty katalog.
 */
export function devScanOutcome(o: ScanOverride, catalog: Species[]): IdentifyOutcome | null {
  if (o.force === 'off') return null;
  if (o.force === 'not_mushroom') return { kind: 'not_mushroom', reason: `Nie widzę tu grzyba – to wygląda na liść.${DEV_SUFFIX}` };
  if (o.force === 'unclear') {
    return { kind: 'unclear', reason: `Zdjęcie jest zbyt ciemne – podejdź bliżej i spróbuj jeszcze raz.${DEV_SUFFIX}` };
  }
  const species = catalog.find((s) => s.id === o.speciesId) ?? catalog[0];
  if (!species) return null;
  const confs = o.lowConfidence ? [0.48, 0.34, 0.21] : [0.93, 0.05];
  const ids = [species.id, ...devAlternatives(species, catalog)];
  const response: IdentifyResponse = {
    verdict: 'mushroom',
    reason: '',
    candidates: ids.slice(0, o.lowConfidence ? 3 : 1).map((speciesId, i) => ({ speciesId, confidence: confs[i] })),
    visibleParts: ['cap', 'underside', 'stem', 'base'],
    count: species.clustered ? 8 : 1,
    capCm: o.xxl ? Math.round(species.typical.capCm * 1.35) : null,
    heightCm: o.xxl ? Math.round(species.typical.heightCm * 1.35) : null,
    maturity: 'mature',
  };
  return toIdentifyOutcome(response, Object.fromEntries(catalog.map((s) => [s.id, s])));
}
