/**
 * Rozpoznanie → wynik gry (src/utils/identify.ts): gatunek i pewność z bezpiecznikiem sobowtórów, wymiary bez
 * losowania (skala tylko z odniesienia na zdjęciu), XXL, kępki, odrzucenia, podpowiedź części i wymuszony wynik dev.
 */
import { describe, expect, it } from '@jest/globals';

import type { IdentifyResponse } from '../../../supabase/functions/identify/contract';
import { SPECIES } from '@/data/mock/species';
import type { Species } from '@/types';
import {
  devScanOutcome,
  estimateDimensions,
  LOW_CONFIDENCE,
  NO_SCAN_OVERRIDE,
  NO_SPECIES_REASON,
  partsHint,
  safeConfidence,
  toIdentifyOutcome,
} from '../identify';

const BY_ID: Record<string, Species> = Object.fromEntries(SPECIES.map((s) => [s.id, s]));
const sp = (id: string) => BY_ID[id]!;

const mushroom = (over: Partial<IdentifyResponse> = {}): IdentifyResponse => ({
  verdict: 'mushroom',
  reason: '',
  candidates: [{ speciesId: 'borowik-szlachetny', confidence: 0.91 }],
  visibleParts: ['cap', 'underside', 'stem'],
  count: 1,
  capCm: null,
  heightCm: null,
  maturity: 'mature',
  ...over,
});

describe('toIdentifyOutcome', () => {
  it('grzyb: gatunek z katalogu, rzadkość gatunku, sobowtóry, widoczne części; bez skali – typowe wymiary, bez XXL', () => {
    const out = toIdentifyOutcome(mushroom(), BY_ID);
    expect(out.kind).toBe('mushroom');
    if (out.kind !== 'mushroom') return;
    const t = sp('borowik-szlachetny').typical;
    expect(out.identification).toMatchObject({
      speciesId: 'borowik-szlachetny',
      confidence: 0.91,
      rarity: sp('borowik-szlachetny').rarity,
      xxl: false,
      dimensions: { capCm: t.capCm, heightCm: t.heightCm, weightG: t.weightG, ageDays: 5 },
      candidates: [{ speciesId: 'borowik-szlachetny', confidence: 0.91 }],
    });
    expect(out.identification.lookalikes.length).toBeGreaterThan(0);
    expect(out.visibleParts).toEqual(['cap', 'underside', 'stem']);
  });

  it('ten sam wynik za każdym razem (nic nie jest losowane)', () => {
    expect(toIdentifyOutcome(mushroom(), BY_ID)).toEqual(toIdentifyOutcome(mushroom(), BY_ID));
  });

  it('XXL tylko z odniesieniem skali: kapelusz 16 cm borowika (typowo 12) → waga ≥ 1,25 × typowej', () => {
    const out = toIdentifyOutcome(mushroom({ capCm: 16, heightCm: 18 }), BY_ID);
    if (out.kind !== 'mushroom') throw new Error('oczekiwano grzyba');
    expect(out.identification.dimensions.capCm).toBe(16);
    expect(out.identification.dimensions.heightCm).toBe(18);
    expect(out.identification.xxl).toBe(true);
    expect(out.identification.dimensions.weightG).toBeGreaterThanOrEqual(sp('borowik-szlachetny').typical.weightG * 1.25);
  });

  it('nie grzyb / niewyraźne → odrzucenie z powodem; grzyb bez gatunku z atlasu → niewyraźne', () => {
    expect(toIdentifyOutcome({ ...mushroom(), verdict: 'not_mushroom', reason: 'To liść.', candidates: [] }, BY_ID)).toEqual({
      kind: 'not_mushroom',
      reason: 'To liść.',
    });
    expect(toIdentifyOutcome({ ...mushroom(), verdict: 'unclear', reason: 'Za ciemno.', candidates: [] }, BY_ID)).toEqual({
      kind: 'unclear',
      reason: 'Za ciemno.',
    });
    expect(toIdentifyOutcome(mushroom({ candidates: [] }), BY_ID)).toEqual({ kind: 'unclear', reason: NO_SPECIES_REASON });
    expect(toIdentifyOutcome(mushroom({ candidates: [], reason: 'Tego gatunku nie ma w atlasie gry.' }), BY_ID)).toEqual({
      kind: 'unclear',
      reason: 'Tego gatunku nie ma w atlasie gry.',
    });
    // Gatunek nieznany katalogowi telefonu (np. starszy katalog) – pomijany.
    const out = toIdentifyOutcome(
      mushroom({ candidates: [{ speciesId: 'nowy-gatunek', confidence: 0.9 }, { speciesId: 'czubajka-kania', confidence: 0.7 }] }),
      BY_ID,
    );
    expect(out.kind === 'mushroom' && out.identification.speciesId).toBe('czubajka-kania');
  });
});

describe('safeConfidence – bezpiecznik sobowtórów', () => {
  it('jadalny zwycięzca, a wśród kandydatów śmiertelny (≥ 15%) → pewność < 60% („Nie jestem pewien”)', () => {
    const c = [
      { speciesId: 'czubajka-kania', confidence: 0.8 },
      { speciesId: 'muchomor-zielonawy', confidence: 0.2 },
    ];
    expect(safeConfidence(c, BY_ID)).toBeLessThan(LOW_CONFIDENCE);
    const out = toIdentifyOutcome(mushroom({ candidates: c }), BY_ID);
    expect(out.kind === 'mushroom' && out.identification.candidates[0].confidence).toBeLessThan(LOW_CONFIDENCE);
  });

  it('groźny kandydat z marginalną pewnością albo niejadalny sobowtór – bez zmian; trujący zwycięzca – bez zmian', () => {
    expect(safeConfidence([{ speciesId: 'czubajka-kania', confidence: 0.8 }, { speciesId: 'muchomor-zielonawy', confidence: 0.1 }], BY_ID)).toBe(0.8);
    expect(safeConfidence([{ speciesId: 'muchomor-zielonawy', confidence: 0.85 }, { speciesId: 'czubajka-kania', confidence: 0.3 }], BY_ID)).toBe(0.85);
    expect(safeConfidence([], BY_ID)).toBe(0);
  });
});

describe('estimateDimensions', () => {
  it('kępki: sztuki × waga jednej, bez XXL', () => {
    const clustered = SPECIES.find((s) => s.clustered)!;
    const d = estimateDimensions(clustered, { capCm: null, heightCm: null, count: 12, maturity: 'young' });
    expect(d.pieces).toBe(12);
    expect(d.weightG).toBe(12 * Math.max(5, Math.round(clustered.typical.weightG / 5) * 5));
    expect(d.ageDays).toBe(2);
    const out = toIdentifyOutcome(mushroom({ candidates: [{ speciesId: clustered.id, confidence: 0.9 }], count: 12, capCm: 9 }), BY_ID);
    expect(out.kind === 'mushroom' && out.identification.xxl).toBe(false);
  });

  it('skala przycięta (0,3–3), sama wysokość też skaluje; pojedynczy grzyb bez sztuk', () => {
    const t = sp('borowik-szlachetny');
    const tiny = estimateDimensions(t, { capCm: 1, heightCm: null, count: 1, maturity: 'unknown' });
    expect(tiny.heightCm).toBe(Math.round(t.typical.heightCm * 0.3));
    expect(tiny).not.toHaveProperty('pieces');
    const tall = estimateDimensions(t, { capCm: null, heightCm: t.typical.heightCm * 2, count: 1, maturity: 'old' });
    expect(tall.capCm).toBe(t.typical.capCm * 2);
    expect(tall.ageDays).toBe(9);
  });
});

describe('partsHint', () => {
  it('brak podstawy trzonu przy śmiertelnym sobowtórze → podpowiedź o bulwie / pochwie', () => {
    expect(partsHint(sp('czubajka-kania'), ['cap', 'underside', 'stem'])).toContain('podstawę trzonu');
  });

  it('brak spodu kapelusza przy sobowtórze → podpowiedź o spodzie; wszystko widać albo brak danych → null', () => {
    expect(partsHint(sp('borowik-szlachetny'), ['cap', 'stem'])).toContain('spód kapelusza');
    expect(partsHint(sp('borowik-szlachetny'), ['cap', 'underside', 'stem', 'base'])).toBeNull();
    expect(partsHint(sp('borowik-szlachetny'), undefined)).toBeNull();
    expect(partsHint(sp('borowik-szlachetny'), [])).toBeNull();
  });
});

describe('devScanOutcome – wymuszony wynik z panelu dev', () => {
  it('wyłączony → null; nie grzyb / niewyraźne → odrzucenie oznaczone jako wymuszone', () => {
    expect(devScanOutcome(NO_SCAN_OVERRIDE, SPECIES)).toBeNull();
    const nm = devScanOutcome({ ...NO_SCAN_OVERRIDE, force: 'not_mushroom' }, SPECIES);
    expect(nm?.kind).toBe('not_mushroom');
    expect(nm && 'reason' in nm && nm.reason).toContain('panelu dev');
    expect(devScanOutcome({ ...NO_SCAN_OVERRIDE, force: 'unclear' }, SPECIES)?.kind).toBe('unclear');
  });

  it('gatunek: pewny wynik, XXL z „odniesieniem skali”, niska pewność z kandydatami; brak id → pierwszy z katalogu', () => {
    const sure = devScanOutcome({ force: 'species', speciesId: 'podgrzybek-brunatny', xxl: false, lowConfidence: false }, SPECIES);
    expect(sure?.kind === 'mushroom' && sure.identification).toMatchObject({ speciesId: 'podgrzybek-brunatny', xxl: false });
    expect(sure?.kind === 'mushroom' && sure.identification.confidence).toBeGreaterThanOrEqual(LOW_CONFIDENCE);

    const xxl = devScanOutcome({ force: 'species', speciesId: 'borowik-szlachetny', xxl: true, lowConfidence: false }, SPECIES);
    expect(xxl?.kind === 'mushroom' && xxl.identification.xxl).toBe(true);

    const low = devScanOutcome({ force: 'species', speciesId: 'czubajka-kania', xxl: false, lowConfidence: true }, SPECIES);
    if (low?.kind !== 'mushroom') throw new Error('oczekiwano grzyba');
    expect(low.identification.confidence).toBeLessThan(LOW_CONFIDENCE);
    expect(low.identification.candidates.length).toBe(3);
    expect(new Set(low.identification.candidates.map((c) => c.speciesId)).size).toBe(3);

    const first = devScanOutcome({ force: 'species', speciesId: null, xxl: false, lowConfidence: false }, SPECIES);
    expect(first?.kind === 'mushroom' && first.identification.speciesId).toBe(SPECIES[0].id);
  });
});
