import { describe, expect, it } from '@jest/globals';

import { mapEvidence, mapSpeciesMap, MIN_FINDERS } from '../chancesMap';

describe('mapEvidence (get_gmina_species_evidence)', () => {
  it('kształt z docs/backend.md → GminaSpeciesEvidence, gatunki od najczęstszego', () => {
    const e = mapEvidence(
      {
        gminaId: 'suprasl',
        days: 14,
        total: 120,
        species: [
          { speciesId: 'borowik-szlachetny', finds: 20, finders: 6 },
          { speciesId: 'podgrzybek-brunatny', finds: 70, finders: 15 },
        ],
      },
      'x',
    );
    expect(e).toEqual({
      gminaId: 'suprasl',
      days: 14,
      total: 120,
      species: [
        { speciesId: 'podgrzybek-brunatny', finds: 70, finders: 15 },
        { speciesId: 'borowik-szlachetny', finds: 20, finders: 6 },
      ],
    });
  });

  it('k-anonimowość także w telefonie: gatunek z < 2 znalazcami albo bez znalezisk – poza listą (zostaje w total)', () => {
    const e = mapEvidence(
      {
        total: 30,
        species: [
          { speciesId: 'a', finds: 10, finders: 1 },
          { speciesId: 'b', finds: 0, finders: 3 },
          { speciesId: 'c', finds: '12', finders: '2' },
          { speciesId: '', finds: 5, finders: 5 },
          'zły wiersz',
        ],
      },
      'suprasl',
    );
    expect(MIN_FINDERS).toBe(2);
    expect(e.species).toEqual([{ speciesId: 'c', finds: 12, finders: 2 }]);
    expect(e.total).toBe(30);
    expect(e.gminaId).toBe('suprasl');
    expect(e.days).toBe(14);
  });

  it('obronnie: tablica z wierszem, JSON w tekście, brak danych, total mniejszy niż suma listy', () => {
    expect(mapEvidence([{ gminaId: 'g', total: 0, species: [] }], 'g')).toEqual({ gminaId: 'g', days: 14, total: 0, species: [] });
    expect(mapEvidence('{"total": 5, "days": 7, "species": [{"speciesId": "a", "finds": 5, "finders": 2}]}', 'g').days).toBe(7);
    expect(mapEvidence(null, 'g')).toEqual({ gminaId: 'g', days: 14, total: 0, species: [] });
    expect(mapEvidence('nie json', 'g').total).toBe(0);
    expect(mapEvidence({ total: 3, species: [{ speciesId: 'a', finds: 8, finders: 2 }] }, 'g').total).toBe(8);
    expect(mapEvidence({ total: -4, days: 0 }, 'g')).toMatchObject({ total: 0, days: 1 });
  });
});

describe('mapSpeciesMap (get_species_map)', () => {
  const ids = { speciesId: 'borowik-szlachetny', voivodeship: 'podlaskie', period: 'season' as const };

  it('kształt z docs/backend.md → SpeciesMap', () => {
    const m = mapSpeciesMap(
      {
        speciesId: 'borowik-szlachetny',
        voivodeship: 'podlaskie',
        period: 'week',
        heat: { suprasl: 4, michalowo: 3, grodek: 1 },
        top: [
          { gminaId: 'suprasl', name: 'Supraśl', finds: 41 },
          { gminaId: 'michalowo', name: 'Michałowo', finds: 22 },
        ],
        total: 70,
      },
      ids,
    );
    expect(m).toEqual({
      speciesId: 'borowik-szlachetny',
      voivodeship: 'podlaskie',
      period: 'week',
      heat: { suprasl: 4, michalowo: 3, grodek: 1 },
      top: [
        { gminaId: 'suprasl', name: 'Supraśl', finds: 41 },
        { gminaId: 'michalowo', name: 'Michałowo', finds: 22 },
      ],
      total: 70,
    });
  });

  it('stopnie obcięte do 1–4 (0 / złe pominięte), top najwyżej 5, nazwa zastępcza, okres i ids z żądania', () => {
    const m = mapSpeciesMap(
      {
        period: 'records',
        heat: { a: 7, b: 0, c: 'x', d: '2' },
        top: Array.from({ length: 7 }, (_, i) => ({ gminaId: `g${i}`, finds: 10 - i })).concat([{ gminaId: '', finds: 99 }] as never[]),
        total: 1,
      },
      ids,
    );
    expect(m.heat).toEqual({ a: 4, d: 2 });
    expect(m.top).toHaveLength(5);
    expect(m.top[0]).toEqual({ gminaId: 'g0', name: 'g0', finds: 10 });
    expect(m.period).toBe('season');
    expect(m.speciesId).toBe('borowik-szlachetny');
    expect(m.voivodeship).toBe('podlaskie');
    expect(m.total).toBe(10 + 9 + 8 + 7 + 6);
  });

  it('pusta odpowiedź → pusta mapa', () => {
    expect(mapSpeciesMap([{}], ids)).toEqual({ ...ids, heat: {}, top: [], total: 0 });
    expect(mapSpeciesMap(undefined, ids)).toEqual({ ...ids, heat: {}, top: [], total: 0 });
  });
});
